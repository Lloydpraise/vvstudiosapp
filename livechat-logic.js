// livechat-logic.js - SUPABASE FINAL VERSION WITH RENDERING FIX

// --- Configuration & Initialization ---
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// !!! IMPORTANT: REPLACE THESE WITH YOUR ACTUAL SUPABASE DETAILS !!!
const SUPABASE_URL = "https://xgtnbxdxbbywvzrttixf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ"; 

// !!! IMPORTANT: USE YOUR DEPLOYED EDGE FUNCTION URL !!!
// We assume the Edge Function is named 'admin-message'
const ADMIN_MESSAGE_ENDPOINT = `${SUPABASE_URL}/functions/v1/admin-message`; 

let supabase;
let currentConversationId = null;
let currentChannel = null;
let currentTab = 'open'; // default to open

try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase initialized successfully.");
} catch (error) {
    console.error("Supabase init error:", error);
}

// --- UTILITY FUNCTIONS ---

// Use a fixed business ID for the dashboard scope
if (!window.authUtils) {
    window.authUtils = {
        getBusinessId: () => {
            try {
                const vvRaw = localStorage.getItem('vvUser');
                if (vvRaw) {
                    const vv = JSON.parse(vvRaw);
                    return vv?.business_id || vv?.['business id'] || null;
                }
                return localStorage.getItem('business_id') || null;
            } catch (e) {
                return localStorage.getItem('business_id') || null;
            }
        }
    };
}

// Helper to format timestamp (e.g., 03:15 PM)
const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * FIX: Cleans message text by removing surrounding quotes from the RPC output.
 */
const cleanMessageText = (text) => {
    if (typeof text !== 'string') return String(text);

    let cleanedText = text.trim();

    // 1. Robustly remove surrounding double quotes (e.g., stripping '"Hello"' to 'Hello')
    // /^"|"$/g: finds a quote at the start (^) OR (|) a quote at the end ($).
    cleanedText = cleanedText.replace(/^"|"$/g, '').trim();

    // 2. Handle double-escaped newlines (replaces \\n with \n)
    cleanedText = cleanedText.replace(/\\n/g, '\n');

    return cleanedText;
};

/**
 * Checks if a conversation is active (last message within 24 hours).
 */
const isConversationActive = (lastMessageTimestamp) => {
    const now = new Date();
    const lastMsg = new Date(lastMessageTimestamp);
    const diffHours = (now - lastMsg) / (1000 * 60 * 60);
    return diffHours <= 24;
};

/**
 * Calculates active time in hours and minutes.
 */
const getActiveTime = (lastMessageTimestamp) => {
    const now = new Date();
    const lastMsg = new Date(lastMessageTimestamp);
    const diffMs = now - lastMsg;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
};


// --- DATA ACCESS FUNCTIONS (Using RPC) ---

/**
 * Fetches the list of conversations for the sidebar.
 */
async function getConversations(businessId) {
    console.log(`[DATA] Fetching conversation list for business: ${businessId}`);
    try {
        const { data, error } = await supabase.rpc('get_conversation_list', {
            p_business_id: businessId
        });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error("[ERROR] Error fetching conversations:", error);
        return [];
    }
}

/**
 * Fetches the detailed message history for a single thread.
 */
async function getMessages(threadId) {
    console.log(`[DATA] 1. Fetching message history for thread: ${threadId}`);
    try {
        const { data, error } = await supabase.rpc('get_thread_history', {
            p_thread_id: threadId
        });

        if (error) throw error;

        // *** DIAGNOSTIC LOG 1 ***
        console.log(`[DATA] 2. Raw message history received (${data.length} messages):`, data);

        const sortedData = data.sort((a, b) => new Date(a.msg_timestamp) - new Date(b.msg_timestamp));
        
        console.log(`[DATA] 3. Sorted message history:`, sortedData);
        
        return sortedData || [];
    } catch (error) {
        console.error("[ERROR] Error fetching messages:", error);
        return [];
    }
}

/**
 * Sends a message from the Admin to the WhatsApp user via the Edge Function.
 */
async function sendLivechatMessage(toUserId, messageText) {
    console.log(`[SEND] Attempting to send message to ${toUserId} via ${ADMIN_MESSAGE_ENDPOINT}`);
    
    const response = await fetch(ADMIN_MESSAGE_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
            to: toUserId,
            text: messageText,
            businessId: window.authUtils.getBusinessId(),
            senderRole: 'admin'
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to send message: ${errorData.error || response.statusText}`);
    }
    
    console.log("[SEND] Message successfully sent via Edge Function.");
    return response.json();
}

/**
 * Updates the conversation_status in the users table.
 */
async function updateConversationStatus(threadId, newStatus) {
    try {
        const { error } = await supabase
            .from('users')
            .update({ conversation_status: newStatus })
            .eq('id', threadId);

        if (error) throw error;
        console.log(`[UPDATE] Conversation status for ${threadId} set to ${newStatus}.`);
        return true;
    } catch (error) {
        console.error(`[ERROR] Error updating status for ${threadId}:`, error);
        return false;
    }
}


// --- REALTIME & RENDER FUNCTIONS ---

/**
 * Renders the list of conversations as cards in the container.
 */
function renderConversationList(conversations, filter = 'open') {
    const container = document.getElementById('conversations-container');
    if (!container) return;
    container.innerHTML = '';

    // Filter conversations based on tab
    const filteredConversations = conversations.filter(conv => {
        const status = conv.conversation_status?.toLowerCase();
        return filter === 'open' ? status === 'open' : status === 'closed';
    });

    filteredConversations.forEach((conv, index) => {
        const lastMsgTime = formatTime(conv.last_message_timestamp);
        const isActive = conv.user_id === currentConversationId;
        const active = isConversationActive(conv.last_message_timestamp);
        const activeTime = active ? getActiveTime(conv.last_message_timestamp) : 'Inactive';

        // Use the cleaner for the sidebar snippet
        const lastMessageSnippet = cleanMessageText(conv.last_message_content);

        const conversationElement = document.createElement('div');
        conversationElement.className = `p-6 bg-[#1a1d23] rounded-2xl border border-[#2b2f3a] card-animate cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 ${isActive ? 'ring-2 ring-blue-500' : ''}`;
        conversationElement.dataset.userId = conv.user_id;
        conversationElement.style.animationDelay = `${index * 0.1}s`;

        conversationElement.innerHTML = `
            <div class="flex items-center justify-between mb-4" onclick="window.handleConversationClick('${conv.user_id}', '${conv.user_name}')">
                <div class="flex items-center space-x-3">
                    <div class="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">${conv.user_name?.[0] || 'U'}</div>
                    <div>
                        <h3 class="text-sm font-semibold text-white truncate">${conv.user_name || conv.user_id}</h3>
                        <p class="text-xs text-gray-400">Phone: ${conv.user_phone || 'N/A'}</p>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <span class="text-xs text-gray-400">${lastMsgTime}</span>
                    <div class="w-3 h-3 rounded-full ${active ? 'bg-green-500' : 'bg-gray-500'}"></div>
                </div>
            </div>
            <p class="text-sm text-gray-300 mb-2 truncate">${lastMessageSnippet}</p>
            <div class="flex justify-between items-center">
                <span class="text-xs ${active ? 'text-green-400' : 'text-gray-500'}">${activeTime}</span>
            </div>
        `;
        container.appendChild(conversationElement);
    });
}


/**
 * Renders the detailed messages in the chat window.
 */
function renderChatMessages(messages) {
    const chatContainer = document.getElementById('chat-messages-container');
    if (!chatContainer) return;
    chatContainer.innerHTML = '';

    messages.forEach((msg, index) => {
        // *** DIAGNOSTIC LOG 5 (Critical) ***
        console.log(`[RENDER] 5. Processing message ${index}: Type: ${typeof msg.content}, Content:`, msg.content);

        // Classify the sender based on 'sender_type'
        const isUser = msg.sender_type === 'user';
        const isAI = msg.sender_type === 'assistant' || msg.sender_type === 'ai_log';
        const isAdmin = msg.sender_type === 'admin';

        // Skip rendering the 'ai_log' duplicate record
        if (msg.sender_type === 'ai_log') {
            return;
        }

        // Strip quotes from content if present (Supabase may return JSON-stringified strings)
        let contentText = String(msg.content);
        if (
            (contentText.startsWith('"') && contentText.endsWith('"')) ||
            (contentText.startsWith("'") && contentText.endsWith("'"))
        ) {
            try {
                // Attempt to parse it as JSON string
                contentText = JSON.parse(contentText);
            } catch (e) {
                contentText = contentText.slice(1, -1); // Fallback: remove quotes manually
            }
        }

        // Format timestamp
        const timestamp = formatTime(msg.msg_timestamp);

        // Construct the DOM with Tailwind classes for styling
        const messageDiv = document.createElement('div');
        messageDiv.className = `flex w-full ${isUser ? 'justify-start' : 'justify-end'} mb-4`;
        messageDiv.innerHTML = `
            <div class="max-w-[75%] ${isUser ? 'bg-gray-500' : 'bg-purple-500'} text-white p-3 rounded-lg">
                <p class="mb-1">${contentText}</p>
                <div class="text-xs text-gray-300">${timestamp}</div>
            </div>
        `;
        chatContainer.appendChild(messageDiv);
    });

    // Scroll to the bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}


/**
 * Handles clicks on the conversation cards.
 */
window.handleConversationClick = async (userId, userName) => {
    // 1. Update active state
    currentConversationId = userId;
    document.querySelectorAll('#conversations-container > div').forEach(el => {
        el.classList.remove('ring-2', 'ring-blue-500');
        if (el.dataset.userId === userId) {
            el.classList.add('ring-2', 'ring-blue-500');
        }
    });

    // 2. Update chat header and visibility 
    const chatHeaderName = document.getElementById('chat-user-name'); 
    const chatUserPhone = document.getElementById('chat-user-phone');
    const chatUserStatus = document.getElementById('chat-user-status');
    const chatWindow = document.getElementById('chat-window');
    
    if (chatHeaderName) chatHeaderName.textContent = userName;
    if (chatWindow) chatWindow.classList.remove('hidden'); 

    const welcomePane = document.getElementById('welcome-pane'); 
    if (welcomePane) welcomePane.classList.add('hidden'); 

    // 3. Get conversation details for status
    const currentConvs = await getConversations(window.authUtils.getBusinessId());
    const conv = currentConvs.find(c => c.user_id === userId);
    const active = isConversationActive(conv.last_message_timestamp);
    const activeTime = active ? getActiveTime(conv.last_message_timestamp) : 'Inactive';

    if (chatUserPhone) chatUserPhone.textContent = `Phone: ${conv.user_phone || 'N/A'}`;
    if (chatUserStatus) {
        chatUserStatus.textContent = activeTime;
        chatUserStatus.className = `text-sm ${active ? 'text-green-400' : 'text-gray-500'}`;
        chatUserStatus.classList.remove('hidden');
    }

    // 4. Show/hide input based on active status
    const chatInputArea = document.getElementById('chat-input-area');
    if (chatInputArea) {
        if (active) {
            chatInputArea.classList.remove('hidden');
        } else {
            chatInputArea.classList.add('hidden');
        }
    }

    // 5. Load messages (Phase 2 Query)
    const messages = await getMessages(userId);
    console.log(`[RENDER] 4. Rendering ${messages.length} messages.`);
    renderChatMessages(messages);

    // 6. Set up Realtime listener for the specific thread 
    listenToMessages(userId);

    // 7. Update Status Buttons
    const status = conv?.conversation_status?.toLowerCase() || 'closed';
    
    const closeChatBtn = document.getElementById('close-chat-btn');
    const reopenChatBtn = document.getElementById('reopen-chat-btn');

    if(closeChatBtn) closeChatBtn.style.display = status === 'open' ? 'block' : 'none';
    if(reopenChatBtn) reopenChatBtn.style.display = status === 'closed' ? 'block' : 'none';
};


/**
 * Subscribes to Supabase Realtime for new messages in the current thread.
 */
function listenToMessages(threadId) {
    if (currentChannel) {
        supabase.removeChannel(currentChannel);
    }
    
    currentChannel = supabase.channel(`thread:${threadId}`)
        .on(
            'postgres_changes',
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages', 
                filter: `thread_id=eq.${threadId}` 
            },
            async (payload) => {
                console.log('[REALTIME] New message received for current thread:', payload.new);
                const messages = await getMessages(currentConversationId);
                renderChatMessages(messages);
            }
        )
        .subscribe();
}

/**
 * Subscribes to the main channel for overall notification updates (sidebar).
 */
function listenForNotifications(businessId) {
    supabase.channel(`business-updates:${businessId}`)
        .on(
            'postgres_changes',
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages', 
                filter: `business_id=eq.${businessId}` 
            },
            async (payload) => {
                const convs = await getConversations(businessId);
                renderConversationList(convs);
            }
        )
        .subscribe();
}


// --- MAIN EXECUTION ---

document.addEventListener('DOMContentLoaded', async () => {
    const businessId = window.authUtils.getBusinessId();

    // Event listeners for mobile sidebar toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-button'); 
    const sidebar = document.getElementById('sidebar');
    const mobileMenuBackdrop = document.getElementById('mobile-menu-backdrop');
    
    if (mobileMenuBtn && sidebar && mobileMenuBackdrop) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.remove('-translate-x-full');
        mobileMenuBackdrop.classList.remove('hidden');
      });
      mobileMenuBackdrop.addEventListener('click', () => {
        sidebar.classList.add('-translate-x-full');
        mobileMenuBackdrop.classList.add('hidden');
      });
            // Close sidebar when any sidebar link is clicked (mobile behavior)
            try {
                document.querySelectorAll('#sidebar a').forEach(link => {
                    link.addEventListener('click', () => {
                        // only run for narrow viewports (mobile/tablet)
                        if (window.innerWidth <= 1024) {
                            sidebar.classList.add('-translate-x-full');
                            mobileMenuBackdrop.classList.add('hidden');
                        }
                    });
                });
            } catch (e) {
                console.warn('Failed to attach sidebar link close handlers', e);
            }
    }

    // Load initial conversation list
    const convs = await getConversations(businessId);
    renderConversationList(convs);
    
    // Set up Realtime listener for all incoming messages to refresh the sidebar
    listenForNotifications(businessId);


    // Event listener for sending a chat message
    const sendBtn = document.getElementById('send-btn');
    const messageInput = document.getElementById('chat-input'); 
    
    if (sendBtn && messageInput) {
        const sendMessage = async () => {
            const messageText = messageInput.value.trim();
            if (messageText && currentConversationId) {
                try {
                    // 1. Send message via the admin-message Edge Function
                    await sendLivechatMessage(currentConversationId, messageText);
                    
                    // 2. Clear input
                    messageInput.value = '';

                    // 3. Reload the chat list (sidebar) to ensure the last message updates
                    const updatedConvs = await getConversations(businessId);
                    renderConversationList(updatedConvs);
                    
                } catch (error) {
                    console.error("Failed to send livechat message:", error);
                    alert("Failed to send message. See console for details.");
                }
            }
        };

        sendBtn.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }


    // --- Status Toggle Event Listeners ---
    const closeChatBtn = document.getElementById('close-chat-btn');
    const reopenChatBtn = document.getElementById('reopen-chat-btn');

    const handleStatusToggle = async (newStatus, showBtn, hideBtn) => {
        if (currentConversationId) {
            await updateConversationStatus(currentConversationId, newStatus);
            const updatedConvs = await getConversations(businessId);
            renderConversationList(updatedConvs);
            // Toggle buttons visibility
            if(showBtn) showBtn.style.display = 'block';
            if(hideBtn) hideBtn.style.display = 'none';
        }
    };


    if (closeChatBtn && reopenChatBtn) {
        closeChatBtn.addEventListener('click', async () => {
            await handleStatusToggle('closed', reopenChatBtn, closeChatBtn);
        });

        reopenChatBtn.addEventListener('click', async () => {
            await handleStatusToggle('open', closeChatBtn, reopenChatBtn);
        });
    }
});