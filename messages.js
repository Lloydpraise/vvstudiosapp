// --- 0. SUPABASE CONFIGURATION ---
const bizId = 'vvstudios10';

// Safety check: Ensure the script waits for Supabase to be initialized from index.html
const getSupabase = () => window.supabase;

// --- 1. CRM DATA STORE ---
const crmStore = {
    businessId: bizId,
    contacts: [],
    conversations: [],
    messages: [],
    lists: [],
    templates: [],
    activeChatId: null,
    activeSubscription: null,
    activePlatform: 'whatsapp' // Track context (whatsapp, facebook, instagram)
};

// --- 2. CRM CONTROLLER ---
const crm = {
    async init() {
        if (!getSupabase()) {
            console.warn("Waiting for Supabase client...");
            setTimeout(() => this.init(), 500);
            return;
        }
        console.log("CRM Initialized for:", crmStore.businessId);
        await this.loadConversations();
        await this.loadLists();
        await this.loadTemplates();
        this.setupRealtime();
    },

    setupRealtime() {
        getSupabase()
            .channel('sidebar_updates')
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'conversations', 
                filter: `business_id=eq.${crmStore.businessId}` 
            }, (payload) => {
                console.log("Sidebar update received:", payload);
                this.loadConversations(); 
            })
            .subscribe();
    },

    async subscribeToMessages(convId, platform = 'whatsapp') {
        if (crmStore.activeSubscription) getSupabase().removeChannel(crmStore.activeSubscription);

        crmStore.activeSubscription = getSupabase()
            .channel(`chat_${convId}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages', 
                filter: `conversation_id=eq.${convId}` 
            }, (payload) => {
                if (!crmStore.messages.find(m => m.id === payload.new.id)) {
                    crmStore.messages.push(payload.new);
                    // Decide which renderer to use based on platform
                    if (platform === 'whatsapp') this.renderMessages(convId);
                    else this.renderSocialMessages(convId, platform);
                }
            })
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'messages', 
                filter: `conversation_id=eq.${convId}` 
            }, (payload) => {
                const index = crmStore.messages.findIndex(m => m.id === payload.new.id);
                if (index !== -1) {
                    crmStore.messages[index] = payload.new;
                    if (platform === 'whatsapp') this.renderMessages(convId);
                    else this.renderSocialMessages(convId, platform);
                }
            })
            .subscribe();
    },

    // --- DATA FETCHING ---
    async loadConversations() {
        // Fetch conversations AND the contact details
        const { data, error } = await getSupabase()
            .from('conversations')
            .select('*, contacts(*)') 
            .eq('business_id', crmStore.businessId)
            .order('updated_at', { ascending: false });

        if (!error && data) {
            crmStore.conversations = data;
            
            // REFRESH ALL VIEWS
            this.renderContacts(); // WhatsApp
            this.renderSocialMessenger('facebook');
            this.renderSocialMessenger('instagram');
            this.renderCommentFeed('facebook');
            this.renderCommentFeed('instagram');
            // Update unread totals and AI indicators for headers
            try {
                const fbUnread = crmStore.conversations.filter(c => c.channel === 'facebook').reduce((s,x) => s + (Number(x.unread_count)||0), 0);
                const igUnread = crmStore.conversations.filter(c => c.channel === 'instagram').reduce((s,x) => s + (Number(x.unread_count)||0), 0);
                const fbEl = document.getElementById('fb-unread-total');
                const igEl = document.getElementById('ig-unread-total');
                if (fbEl) { if (fbUnread > 0) { fbEl.textContent = `${fbUnread} unread`; fbEl.classList.remove('hidden'); } else { fbEl.classList.add('hidden'); } }
                if (igEl) { if (igUnread > 0) { igEl.textContent = `${igUnread} unread`; igEl.classList.remove('hidden'); } else { igEl.classList.add('hidden'); } }

                const fbAi = crmStore.conversations.some(c => c.channel === 'facebook' && c.ai_enabled);
                const igAi = crmStore.conversations.some(c => c.channel === 'instagram' && c.ai_enabled);
                const fbAiEl = document.getElementById('fb-ai-indicator');
                const igAiEl = document.getElementById('ig-ai-indicator');
                if (fbAiEl) { if (fbAi) fbAiEl.classList.remove('hidden'); else fbAiEl.classList.add('hidden'); }
                if (igAiEl) { if (igAi) igAiEl.classList.remove('hidden'); else igAiEl.classList.add('hidden'); }
            } catch (e) { /* ignore header updates */ }
        }
    },

    // Alias for compatibility with admin.html calls
    renderConversations() {
        this.renderContacts();
    },

    async loadLists() {
        const { data } = await getSupabase().from('lists').select('*').eq('business_id', crmStore.businessId);
        crmStore.lists = data || [];
        this.renderLists();
    },

    async loadTemplates() {
        const { data } = await getSupabase().from('message_templates').select('*').eq('business_id', crmStore.businessId);
        crmStore.templates = data || [];
        this.renderTemplates();
    },

    // --- NAVIGATION ---
    switchTab(tab) {
        document.querySelectorAll('.crm-tab-btn').forEach(b => {
            b.classList.remove('active', 'border-purple-500', 'text-white');
            b.classList.add('border-transparent', 'text-white/60');
            if(b.dataset.tab === tab) {
                b.classList.add('active', 'border-purple-500', 'text-white');
                b.classList.remove('border-transparent', 'text-white/60');
            }
        });
        document.querySelectorAll('.crm-view').forEach(v => v.classList.add('hidden-force'));
        const targetView = document.getElementById(`crm-${tab}`);
        if (targetView) targetView.classList.remove('hidden-force');
        
        if(tab === 'chats') this.renderContacts();
        if(tab === 'lists') this.renderLists();
        if(tab === 'templates') this.renderTemplates();
        if(tab === 'campaigns') this.renderCampaigns();
        if(tab === 'settings') this.loadSettings('whatsapp');
    },

    isWindowActive(timestamp) {
        if (!timestamp) return false;
        return (Date.now() - new Date(timestamp).getTime()) < (24 * 60 * 60 * 1000);
    },

    // ============================================================
    // 1. WHATSAPP UI LOGIC
    // ============================================================
    renderContacts() {
        const list = document.getElementById('crm-contact-list');
        if (!list) return;
        
        // FILTER: Only show WhatsApp chats here
        const waChats = crmStore.conversations.filter(c => c.channel === 'whatsapp');

        list.innerHTML = waChats.map(conv => {
            const contact = conv.contacts;
            const isActive = this.isWindowActive(conv.last_user_message_at);
            const isSelected = conv.id === crmStore.activeChatId;
            
            return `
                <div onclick="crm.openChat('${conv.id}')" class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-white/10' : 'hover:bg-white/5'}">
                    <div class="relative w-10 h-10">
                        <div class="w-full h-full rounded-full bg-gray-700 flex items-center justify-center text-white font-bold text-sm">${contact?.name?.[0] || '?'}</div>
                        ${isActive ? '<div class="absolute bottom-0 left-0 w-3 h-3 bg-green-500 border-2 border-[#1a1d23] rounded-full"></div>' : ''}
                        ${conv.ai_enabled ? '<div class="absolute -top-1 -left-1 bg-[#202c33] border border-gray-600 rounded-full w-4 h-4 flex items-center justify-center"><i class="fa-solid fa-robot text-[9px] text-purple-400"></i></div>' : ''}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-center">
                            <span class="font-medium text-sm truncate">${contact?.name || 'Unknown'}</span>
                            ${conv.unread_count > 0 ? `<span class="bg-green-500 text-[10px] px-1.5 rounded-full">${conv.unread_count}</span>` : ''}
                        </div>
                        <p class="text-xs text-white/50 truncate">${conv.last_message_preview || ''}</p>
                    </div>
                </div>`;
        }).join('');
    },

    async openChat(convId) {
        crmStore.activeChatId = convId;
        crmStore.activePlatform = 'whatsapp';
        const conv = crmStore.conversations.find(c => c.id === convId);
        
        if(window.innerWidth < 768) {
            document.getElementById('crm-chat-list-panel').classList.add('mobile-chat-list-hidden');
            document.getElementById('crm-chat-window').classList.add('mobile-chat-view-active');
            document.getElementById('crm-chat-window').style.display = 'flex';
        }

        await getSupabase().from('conversations').update({ unread_count: 0 }).eq('id', convId);
        
        document.getElementById('chat-header-name').textContent = conv.contacts?.name || 'Unknown';
        document.getElementById('chat-header-avatar').textContent = conv.contacts?.name?.[0] || '?';
        // clicking header opens contact modal for quick view/notes
        try { document.getElementById('chat-header-name').onclick = () => this.openContactModal(); } catch(e) {}
        
        const isActive = this.isWindowActive(conv.last_user_message_at);
        document.getElementById('chat-header-status').textContent = isActive ? "Active Session" : "Session Expired";
        document.getElementById('chat-header-indicator').className = isActive ? "w-2 h-2 rounded-full bg-green-500" : "w-2 h-2 rounded-full bg-yellow-500";

        this.updateInputVisibility(isActive, conv.ai_enabled);
        this.updateAIToggleUI(Boolean(conv.ai_enabled));
        
        const { data } = await getSupabase().from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: true });
        crmStore.messages = data || [];
        
        this.renderMessages(convId);
        this.subscribeToMessages(convId, 'whatsapp');
        this.renderContacts(); 
    },

    // Open contact details modal and allow editing notes
    async openContactModal(contactId = null) {
        try {
            // allow explicit id or use active chat's contact
            let cid = contactId;
            if (!cid && crmStore.activeChatId) {
                const conv = crmStore.conversations.find(c => c.id === crmStore.activeChatId);
                cid = conv ? conv.contact_id : null;
            }

            const modal = document.getElementById('contact-modal');
            if (!modal) return alert('Contact modal not found');

            let contact = null;
            // prefer embedded contact record
            if (crmStore.conversations && crmStore.activeChatId) {
                const conv = crmStore.conversations.find(c => c.id === crmStore.activeChatId);
                if (conv && conv.contacts) contact = conv.contacts;
            }

            if ((!contact || !contact.id) && cid) {
                const { data, error } = await getSupabase().from('contacts').select('*').eq('id', cid).maybeSingle();
                if (!error && data) contact = data;
            }

            // Populate UI
            document.getElementById('contact-modal-id').value = contact?.id || cid || '';
            document.getElementById('contact-modal-name').textContent = contact?.name || contact?.display_name || 'Unknown';
            document.getElementById('contact-modal-phone').textContent = contact?.phone || contact?.phone_number || '—';
            document.getElementById('contact-modal-avatar').textContent = (contact && contact.name && contact.name[0]) ? contact.name[0] : '?';
            document.getElementById('contact-modal-notes').value = contact?.notes || contact?.note || '';

            // wire save
            const saveBtn = document.getElementById('contact-modal-save');
            if (saveBtn) {
                saveBtn.onclick = async () => { await this.saveContactNotes(document.getElementById('contact-modal-id').value); };
            }

            modal.classList.remove('hidden-force');
        } catch (err) {
            console.error('openContactModal error', err);
        }
    },

    async saveContactNotes(contactId) {
        try {
            if (!contactId) return alert('No contact id available');
            const notes = document.getElementById('contact-modal-notes').value || '';
            const { error } = await getSupabase().from('contacts').update({ notes: notes, updated_at: new Date().toISOString() }).eq('id', contactId);
            if (error) {
                console.error('Failed saving contact notes', error);
                return alert('Error saving notes.');
            }

            // update local store conversations if present
            crmStore.conversations = crmStore.conversations.map(c => {
                if (c.contact_id && String(c.contact_id) === String(contactId)) {
                    if (!c.contacts) c.contacts = {};
                    c.contacts.notes = notes;
                }
                return c;
            });

            document.getElementById('contact-modal').classList.add('hidden-force');
        } catch (err) {
            console.error('saveContactNotes error', err);
            alert('Error saving notes.');
        }
    },

    // ============================================================
    // 2. SOCIAL MEDIA LOGIC (FB & IG) - THE MISSING CODES
    // ============================================================

    // Renders the list of DMs for FB or IG
    renderSocialMessenger(platform) {
        const listId = platform === 'facebook' ? 'fb-conversation-list' : 'ig-conversation-list';
        const listContainer = document.getElementById(listId);
        if (!listContainer) return;

        // Filter: Channel = platform AND Type = dm
        const chats = crmStore.conversations.filter(c => c.channel === platform && c.type === 'dm');
        
        listContainer.innerHTML = chats.map(c => {
            const name = c.contacts?.name || "Social User";
            const isActive = c.id === crmStore.activeChatId;
            const timeVal = c.last_user_message_at || c.updated_at || null;
            const time = timeVal ? new Date(timeVal).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
            const unreadBadge = (c.unread_count && Number(c.unread_count) > 0) ? `<span class="bg-green-500 text-[10px] px-1.5 rounded-full">${c.unread_count}</span>` : '';
            const preview = c.last_message_preview || 'New Message';
            
            return `
                <div onclick="crm.selectSocialChat('${c.id}', '${platform}')" class="p-3 mx-2 rounded-lg hover:bg-white/5 cursor-pointer flex gap-3 items-center border-b border-white/5 ${isActive ? 'bg-white/10' : ''}">
                    <div class="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold">${name[0]}</div>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between">
                            <h4 class="font-semibold text-sm truncate text-white/90">${name}</h4>
                            <span class="text-xs text-white/40">${time}</span>
                        </div>
                        <p class="text-xs text-white/60 truncate">${preview}</p>
                    </div>
                    <div class="ml-2 flex-shrink-0">
                        ${unreadBadge}
                    </div>
                </div>`;
        }).join('') || `<div class="p-4 text-center text-white/20 text-xs">No DMs found</div>`;
    },

    // Handles clicking a Facebook/Instagram DM
    async selectSocialChat(convId, platform) {
        crmStore.activeChatId = convId;
        crmStore.activePlatform = platform;
        
        // 1. Mark Read
        await getSupabase().from('conversations').update({ unread_count: 0 }).eq('id', convId);
        
        // 2. Fetch Messages
        const { data } = await getSupabase().from('messages')
            .select('*')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: true });
        
        crmStore.messages = data || [];

        // 3. Render and Subscribe
        this.renderSocialMessages(convId, platform);
        this.subscribeToMessages(convId, platform);
        
        // 4. Refresh List to show active state
        this.renderSocialMessenger(platform);
    },

    // Renders bubbles inside the social view (FB or IG DMs)
    renderSocialMessages(convId, platform) {
        const areaId = platform === 'facebook' ? 'fb-messages-area' : 'ig-messages-area';
        const area = document.getElementById(areaId);
        if(!area) return;

        // Filter messages for this conversation
        const msgs = crmStore.messages.filter(m => m.conversation_id === convId);
        
        // Dynamic Colors
        const brandColor = platform === 'facebook' ? 'bg-blue-600' : 'bg-gradient-to-r from-purple-600 to-pink-600';

        area.innerHTML = msgs.map(m => {
            // Logic: Is this message "outgoing" (from us)?
            const isMe = m.direction === 'out' || m.role === 'admin' || m.role === 'ai';
            const isAI = m.role === 'ai';
            
            // Alignment classes
            const align = isMe ? 'ml-auto flex-row-reverse' : '';
            const bubbleShape = isMe ? 'rounded-tr-none' : 'rounded-tl-none';
            const bgClass = isMe ? brandColor + ' text-white' : 'bg-[#242526] text-white/90';
            
            // Content Extraction (Handle JSONB)
            let displayText = '';
            if (m.content && typeof m.content === 'object') {
                displayText = m.content.text || JSON.stringify(m.content);
            } else {
                displayText = m.raw_payload?.text || 'Media/Attachment'; // Fallback
            }

            // AI Badge / Admin Badge logic
            let badge = '';
            if (isAI) {
                badge = `<div class="flex items-center gap-1 mb-1 text-[10px] font-bold uppercase tracking-wider text-white/80 border-b border-white/20 pb-1">
                            <i class="fa-solid fa-robot"></i> AI Auto-Reply
                         </div>`;
            } else if (isMe && m.role === 'admin') {
                badge = `<div class="flex items-center gap-1 mb-1 text-[10px] font-bold uppercase tracking-wider text-white/50 border-b border-white/10 pb-1">
                            <i class="fa-solid fa-user-shield"></i> Admin
                         </div>`;
            }

            return `
            <div class="flex gap-2 max-w-[75%] ${align} mb-3 group">
                ${!isMe ? `<div class="w-8 h-8 rounded-full bg-gray-600 flex-shrink-0 flex items-center justify-center text-xs text-white/50"><i class="fa-solid fa-user"></i></div>` : ''}
                
                <div class="${bgClass} p-3 rounded-2xl ${bubbleShape} shadow-sm text-sm relative min-w-[100px]">
                    ${badge}
                    <div class="whitespace-pre-wrap leading-relaxed">${displayText}</div>
                    
                    <div class="text-[10px] text-white/50 text-right mt-1 flex justify-end items-center gap-1">
                        ${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                        ${isMe && m.status === 'read' ? '<i class="fa-solid fa-check-double text-[10px]"></i>' : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
        
        area.scrollTop = area.scrollHeight;
    },

    // ============================================================
    // 3. COMMENTS FEED LOGIC (Grouped by Post)
    // ============================================================
    renderCommentFeed(platform) {
        const viewId = platform === 'facebook' ? 'view-facebook-comments' : 'view-instagram-comments';
        const view = document.getElementById(viewId);
        if (!view) return;

        const postListEl = view.querySelector('.overflow-y-auto'); // Left column
        const comments = crmStore.conversations.filter(c => c.channel === platform && c.type === 'comment');
        
        // Group by Post ID
        const posts = {};
        comments.forEach(c => {
            const pid = c.external_id || 'unknown';
            if(!posts[pid]) posts[pid] = [];
            posts[pid].push(c);
        });

        if (postListEl) {
            postListEl.innerHTML = Object.keys(posts).map(pid => `
                <div onclick="crm.openPostThread('${pid}', '${platform}')" class="p-4 border-b border-white/5 hover:bg-white/5 cursor-pointer flex gap-3">
                    <div class="w-12 h-12 bg-gray-800 rounded flex items-center justify-center text-[10px] text-white/30">POST</div>
                    <div class="flex-1">
                        <h4 class="text-sm font-medium text-white/90 truncate">Thread: ${pid.substring(0,8)}...</h4>
                        <div class="mt-1 text-xs text-blue-400">${posts[pid].length} comments</div>
                    </div>
                </div>
            `).join('') || '<div class="p-4 text-white/30">No active comments</div>';
        }
    },

    // Renders the Thread View for Comments
    async openPostThread(postId, platform) {
        const viewId = platform === 'facebook' ? 'view-facebook-comments' : 'view-instagram-comments';
        const centerCol = document.getElementById(viewId)?.querySelector('.bg-\\[\\#0f1115\\]');
        if(!centerCol) return;

        // 1. Get all conversations (User Threads) linked to this Post
        const userThreads = crmStore.conversations.filter(c => c.external_id === postId);

        // 2. Fetch the actual messages for these threads so we can show replies
        // (In a real app, you might do this via a separate DB call, but here we filter loaded messages)
        // If messages aren't loaded globally, we might need to fetch them. 
        // For now, let's assume we fetch them on demand or rely on what's in store.
        
        let threadsHTML = '';

        for (const thread of userThreads) {
            // Fetch messages specifically for this comment thread
            const { data: threadMsgs } = await getSupabase()
                .from('messages')
                .select('*')
                .eq('conversation_id', thread.id)
                .order('created_at', { ascending: true }); // Oldest first (User comment -> AI Reply)

            if (!threadMsgs || threadMsgs.length === 0) continue;

            const userComment = threadMsgs.find(m => m.direction === 'in');
            const replies = threadMsgs.filter(m => m.direction === 'out' || m.role === 'ai' || m.role === 'admin');

            // Skip if logic is weird (no user comment)
            if (!userComment) continue;

            const userText = userComment.content?.text || "Attachment";
            
            // Build Replies HTML
            const repliesHTML = replies.map(r => {
                const rText = r.content?.text || JSON.stringify(r.content);
                const isAI = r.role === 'ai';
                return `
                    <div class="ml-10 mt-2 flex gap-3 max-w-[85%]">
                        <div class="bg-[#2a3942] p-3 rounded-2xl rounded-tl-none border border-white/5 w-full">
                            <div class="flex items-center gap-2 mb-1">
                                ${isAI 
                                    ? `<span class="bg-purple-500/20 text-purple-300 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold"><i class="fa-solid fa-robot"></i> AI Reply</span>`
                                    : `<span class="bg-blue-500/20 text-blue-300 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold"><i class="fa-solid fa-user-shield"></i> Admin</span>`
                                }
                                <span class="text-[10px] text-white/30">${new Date(r.created_at).toLocaleTimeString()}</span>
                            </div>
                            <p class="text-sm text-white/80">${rText}</p>
                        </div>
                    </div>
                `;
            }).join('');

            // Build Main Comment Block
            threadsHTML += `
                <div class="group mb-8 relative">
                    <div class="absolute left-4 top-10 bottom-0 w-0.5 bg-white/5"></div>

                    <div class="flex gap-3 relative z-10">
                        <div class="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-xs font-bold ring-4 ring-[#0f1115]">
                            ${thread.contacts?.name?.[0] || '?'}
                        </div>
                        <div class="flex-1">
                            <div class="bg-[#242526] px-4 py-3 rounded-2xl rounded-tl-none inline-block min-w-[200px]">
                                <div class="flex justify-between items-center mb-1">
                                    <span class="font-bold text-xs text-white/90">${thread.contacts?.name || 'Social User'}</span>
                                    <span class="text-[10px] text-white/40">${new Date(userComment.created_at).toLocaleTimeString()}</span>
                                </div>
                                <p class="text-sm text-white">${userText}</p>
                            </div>
                            
                            <div class="flex gap-4 mt-1 ml-2 text-xs text-white/40 font-medium">
                                <button onclick="crm.toggleReplyBox('${thread.id}')" class="hover:text-blue-400 transition-colors">
                                    <i class="fa-solid fa-reply"></i> Reply
                                </button>
                                <button class="hover:text-yellow-400 transition-colors">
                                    <i class="fa-regular fa-paper-plane"></i> DM User
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="relative z-10">
                        ${repliesHTML}
                    </div>

                    <div id="reply-box-${thread.id}" class="hidden ml-11 mt-3 flex gap-2 items-center">
                        <div class="w-6 h-0.5 bg-white/10"></div> <div class="flex-1 flex gap-2 bg-[#242526] p-1.5 rounded-full border border-white/10">
                            <input type="text" id="input-${thread.id}" 
                                class="bg-transparent text-white px-3 text-sm w-full focus:outline-none" 
                                placeholder="Write a public reply...">
                            <button onclick="crm.sendCommentReply('${thread.id}', '${platform}')" 
                                class="w-8 h-8 bg-blue-600 hover:bg-blue-500 rounded-full flex items-center justify-center text-white transition-colors">
                                <i class="fa-solid fa-paper-plane text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        // Final Render
        centerCol.innerHTML = `
            <div class="bg-[#18191a] rounded-xl p-5 mb-8 border border-white/5 shadow-lg">
                <div class="flex items-center gap-3 mb-4 border-b border-white/5 pb-4">
                    <div class="w-10 h-10 bg-gray-700 rounded-lg flex items-center justify-center text-white/20">IMG</div>
                    <div>
                        <h3 class="font-bold text-white text-sm">Post Context</h3>
                        <p class="text-xs text-white/40 font-mono">ID: ${postId}</p>
                    </div>
                    <div class="ml-auto bg-white/5 px-3 py-1 rounded text-xs text-white/60">
                        ${userThreads.length} active threads
                    </div>
                </div>
                <div class="text-sm text-white/60 italic">
                    "This is a placeholder for the post caption. In a full version, we would fetch the post text from Graph API."
                </div>
            </div>
            
            <div class="pl-2">
                ${threadsHTML || '<div class="text-white/30 text-center py-10">No comments loaded.</div>'}
            </div>
        `;
    },

    // Helper to toggle the reply box
    toggleReplyBox(threadId) {
        const box = document.getElementById(`reply-box-${threadId}`);
        if(box) box.classList.toggle('hidden');
    },

    async sendCommentReply(conversationId, platform) {
        const input = document.getElementById(`input-${conversationId}`);
        const text = input.value.trim();
        if(!text) return;

        // Call the Edge Function
        await fetch('https://xgtnbxdxbbywvzrttixf.supabase.co/functions/v1/whatsapp-webhook', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${getSupabase().supabaseKey}`,
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
                recipientId: 'system_lookup', // Backend handles this
                platform: platform === 'facebook' ? 'fb_comment' : 'ig_comment',
                conversationId: conversationId,
                businessId: crmStore.businessId,
                payload: { text: text }
            })
        });
        
        alert("Reply sent!");
        input.value = '';
    },

    // ============================================================
    // 4. SHARED UTILS (Sending, Toggles, etc)
    // ============================================================

    closeMobileChat() {
        document.getElementById('crm-chat-list-panel').classList.remove('mobile-chat-list-hidden');
        document.getElementById('crm-chat-window').classList.remove('mobile-chat-view-active');
        document.getElementById('crm-chat-window').style.display = 'none';
        crmStore.activeChatId = null;
        this.renderContacts();
    },

    async sendMessage() {
        const input = document.getElementById('chat-input'); // NOTE: Social views need their own inputs if not reusing this one
        if (!input) return;

        const text = input.value.trim();
        if (!text || !crmStore.activeChatId) return;

        const conv = crmStore.conversations.find(c => c.id === crmStore.activeChatId);
        
        // Optimistic UI
        const tempId = 'temp-' + Date.now();
        crmStore.messages.push({
            id: tempId,
            conversation_id: crmStore.activeChatId,
            direction: 'out',
            role: 'admin',
            content: { text: text },
            status: 'pending', 
            created_at: new Date().toISOString()
        });

        // Render immediately based on active platform
        if(crmStore.activePlatform === 'whatsapp') this.renderMessages(crmStore.activeChatId);
        else this.renderSocialMessages(crmStore.activeChatId, crmStore.activePlatform);

        input.value = '';

        // API Call
        try {
            await fetch('https://xgtnbxdxbbywvzrttixf.supabase.co/functions/v1/whatsapp-webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipientId: conv.contacts.phone, // Or PSID for social
                    platform: conv.channel,
                    conversationId: crmStore.activeChatId,
                    businessId: crmStore.businessId,
                    payload: { text: text },
                    contactId: conv.contact_id
                })
            });
            // Realtime will replace the temp message
            crmStore.messages = crmStore.messages.filter(m => m.id !== tempId);
        } catch (err) {
            console.error("Send Error:", err);
            alert("Failed to send");
        }
    },

    async toggleAI() {
        if(!crmStore.activeChatId) return;
        const conv = crmStore.conversations.find(c => c.id === crmStore.activeChatId);
        const newState = !conv.ai_enabled;

        const { error } = await getSupabase().from('conversations').update({ ai_enabled: newState }).eq('id', crmStore.activeChatId);
        if(!error) {
            conv.ai_enabled = newState;
            this.updateAIToggleUI(newState);
        }
    },

    updateAIToggleUI(isEnabled) {
        const toggle = document.getElementById('ai-toggle-btn');
        if(toggle) {
            const dot = toggle.querySelector('div');
            toggle.className = `relative w-8 h-4 rounded-full transition-colors cursor-pointer ${isEnabled ? 'bg-green-500' : 'bg-gray-600'}`;
            dot.style.left = isEnabled ? 'calc(100% - 10px)' : '4px';
        }
    },

    updateInputVisibility(isActive, aiEnabled) {
        const inputContainer = document.getElementById('chat-input-container');
        const disabledMsg = document.getElementById('chat-input-disabled');
        if(!inputContainer || !disabledMsg) return;

        if (!isActive) {
            inputContainer.classList.add('hidden');
            disabledMsg.classList.remove('hidden');
            disabledMsg.innerHTML = '<i class="fa-solid fa-clock mr-2"></i> Session expired.';
        } else if (aiEnabled) {
            inputContainer.classList.add('hidden');
            disabledMsg.classList.remove('hidden');
            disabledMsg.innerHTML = '<i class="fa-solid fa-robot mr-2"></i> AI Auto-Pilot active.';
        } else {
            inputContainer.classList.remove('hidden');
            disabledMsg.classList.add('hidden');
        }
    },

    // Standard WhatsApp Renderer
    renderMessages(convId) {
        const area = document.getElementById('crm-messages-area');
        if (!area) return;

        const msgs = crmStore.messages.filter(m => m.conversation_id === convId);

        area.innerHTML = msgs.map(m => {
            const isOutgoing = m.direction === 'out' || m.role === 'admin' || m.role === 'ai';
            const isAI = m.role === 'ai';
            const align = isOutgoing ? 'justify-end' : 'justify-start';
            const bubbleClass = isOutgoing ? 'bg-[#005c4b] text-white rounded-tr-none' : 'bg-[#202c33] text-white rounded-tl-none';
            
            let statusIcon = '';
            if (isOutgoing) {
                if (m.status === 'read') statusIcon = '<i class="fa-solid fa-check-double text-[10px] text-[#53bdeb]"></i>';
                else statusIcon = '<i class="fa-solid fa-check text-[10px] opacity-50"></i>';
            }

            return `
                <div class="flex ${align} mb-2 px-4">
                    <div class="${bubbleClass} max-w-[75%] p-2 px-3 shadow-sm rounded-xl relative min-w-[70px]">
                        ${isAI ? `<div class="flex items-center gap-1 text-[10px] text-green-300 font-bold mb-1 uppercase tracking-tight"><i class="fa-solid fa-robot"></i> AI</div>` : ''}
                        <span class="text-[14.5px] leading-relaxed whitespace-pre-wrap">${m.content?.text || m.text || ''}</span>
                        <div class="flex items-center justify-end gap-1 mt-1 leading-none">
                            <span class="text-[10px] opacity-50">${new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            ${statusIcon}
                        </div>
                    </div>
                </div>`;
        }).join('');
        area.scrollTop = area.scrollHeight;
    },

    // --- LISTS & TEMPLATES ---
    renderLists() {
        const container = document.getElementById('crm-lists-container');
        if (!container) return;
        container.innerHTML = crmStore.lists.length > 0 
            ? crmStore.lists.map(list => `<div class="bg-[#232730] p-4 rounded-xl border border-white/5"><h4 class="font-bold text-white">${list.name}</h4></div>`).join('')
            : `<div class="p-5 text-white/40">No lists created.</div>`;
    },

    renderTemplates() {
        const container = document.getElementById('crm-templates-container');
        if (container) {
            container.innerHTML = crmStore.templates.length > 0 
                ? crmStore.templates.map(t => `<div class="p-3 bg-white/5 rounded-lg mb-2">${t.name}</div>`).join('')
                : `<div class="p-5 text-white/40">No templates found.</div>`;
        }
    },
    
    renderCampaigns() {
        const tbody = document.getElementById('crm-campaigns-table');
        if (tbody) tbody.innerHTML = `<tr><td class="p-4 text-white/40" colspan="3">No active campaigns</td></tr>`;
    }
    ,

    // --- SETTINGS & CONFIGURATION ---

    // 1. Load Settings when opening the tab
    async loadSettings(platform) {
        // A. Fetch Business AI Config
        const { data: biz } = await getSupabase()
            .from('businesses')
            .select('system_prompt, ai_config')
            .eq('business_id', crmStore.businessId)
            .single();

        // B. Fetch Connection Credentials
        const { data: conn } = await getSupabase()
            .from('platform_connections')
            .select('*')
            .eq('business_id', crmStore.businessId)
            .eq('platform', platform)
            .maybeSingle();

        // C. Populate Forms
        if (platform === 'whatsapp') {
            document.getElementById('wa-system-prompt').value = biz?.system_prompt || '';
            document.getElementById('wa-phone-id').value = conn?.platform_identifier || ''; // Phone ID stored here
            document.getElementById('wa-token').value = conn?.access_token || '';
        } 
        else if (platform === 'facebook') {
            const config = biz?.ai_config || {};
            document.getElementById('fb-ai-config').value = config.platforms?.facebook || '';
            document.getElementById('fb-page-id').value = conn?.platform_identifier || '';
            document.getElementById('fb-token').value = conn?.access_token || '';
        }
        else if (platform === 'instagram') {
            const config = biz?.ai_config || {};
            document.getElementById('ig-ai-config').value = config.platforms?.instagram || '';
            document.getElementById('ig-account-id').value = conn?.platform_identifier || '';
            document.getElementById('ig-token').value = conn?.access_token || '';
        }
    },

    // 2. Save Settings
    async saveSettings(platform) {
        const btn = event?.target || null;
        const originalText = btn ? btn.innerText : 'Save';
        if(btn) btn.innerText = "Saving...";
        
        try {
            // A. Prepare Data
            let aiUpdates = {};
            let credUpdates = {};
            let promptUpdate = null;

            if (platform === 'whatsapp') {
                promptUpdate = document.getElementById('wa-system-prompt').value;
                credUpdates = {
                    platform_identifier: document.getElementById('wa-phone-id').value,
                    access_token: document.getElementById('wa-token').value
                };
            }
            else if (platform === 'facebook') {
                const { data: b } = await getSupabase().from('businesses').select('ai_config').eq('business_id', crmStore.businessId).single();
                let newConfig = b?.ai_config || { platforms: {} };
                if(!newConfig.platforms) newConfig.platforms = {};
                
                newConfig.platforms.facebook = document.getElementById('fb-ai-config').value;
                aiUpdates = { ai_config: newConfig };
                
                credUpdates = {
                    platform_identifier: document.getElementById('fb-page-id').value,
                    access_token: document.getElementById('fb-token').value
                };
            }
            else if (platform === 'instagram') {
                const { data: b } = await getSupabase().from('businesses').select('ai_config').eq('business_id', crmStore.businessId).single();
                let newConfig = b?.ai_config || { platforms: {} };
                if(!newConfig.platforms) newConfig.platforms = {};
                
                newConfig.platforms.instagram = document.getElementById('ig-ai-config').value;
                aiUpdates = { ai_config: newConfig };
                
                credUpdates = {
                    platform_identifier: document.getElementById('ig-account-id').value,
                    access_token: document.getElementById('ig-token').value
                };
            }

            // B. Update Business Table (AI Instructions)
            if (promptUpdate !== null) {
                await getSupabase().from('businesses').update({ system_prompt: promptUpdate }).eq('business_id', crmStore.businessId);
            }
            if (Object.keys(aiUpdates).length > 0) {
                await getSupabase().from('businesses').update(aiUpdates).eq('business_id', crmStore.businessId);
            }

            // C. Update Connections Table (Credentials)
            const { error } = await getSupabase().from('platform_connections').upsert({
                business_id: crmStore.businessId,
                platform: platform,
                platform_identifier: credUpdates.platform_identifier,
                access_token: credUpdates.access_token
            }, { onConflict: 'platform_identifier' });

            if(error) throw error;

            alert(`${platform} settings saved successfully!`);

        } catch (err) {
            console.error("Save Error:", err);
            alert("Error saving settings. Check console.");
        } finally {
            if(btn) btn.innerText = originalText;
        }
    },

    // 3. UI Toggles
    toggleSocialSettings(platform) {
        const id = `settings-${platform}`;
        const el = document.getElementById(id);
        console.log('toggleSocialSettings called for', platform, 'element found?', !!el);
        if (!el) return;
        const isHidden = el.classList.contains('hidden') || el.classList.contains('hidden-force');
        if (isHidden) {
            el.classList.remove('hidden');
            el.classList.remove('hidden-force');
            // Small delay to ensure DOM paints before loading data
            setTimeout(() => {
                try { this.loadSettings(platform); } catch (e) { console.error('loadSettings error', e); }
                // focus first input for accessibility
                const firstInput = el.querySelector('input, textarea, select');
                if (firstInput) firstInput.focus();
            }, 10);
        } else {
            el.classList.add('hidden');
            el.classList.add('hidden-force');
        }
    },
};

// Start logic when DOM is ready
document.addEventListener('DOMContentLoaded', () => crm.init());
window.crm = crm;

// Global helper to toggle password visibility on settings forms
window.togglePass = function(id) {
    const input = document.getElementById(id);
    if(!input) return;
    if(input.type === 'password') input.type = 'text';
    else input.type = 'password';
}