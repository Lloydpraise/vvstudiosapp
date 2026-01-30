// --- 0. SUPABASE CONFIGURATION ---
// Resolve the business id dynamically so the same file can serve admin and clients.
const DEFAULT_BIZ = 'vvstudios10';

function resolveBusinessId() {
    try {
        const params = new URLSearchParams(window.location.search);
        const keys = ['business_id', 'businessId', 'biz'];
        for (const k of keys) {
            const v = params.get(k);
            if (v) return v;
        }

        // If this is the admin messages section (admin.html path), use default admin business
        if (window.location.pathname && window.location.pathname.toLowerCase().includes('admin')) {
            return DEFAULT_BIZ;
        }

        // Check common globals that other pages might set (match index.html patterns)
        if (window.BUSINESS_ID) return window.BUSINESS_ID;
        if (window.APP_BUSINESS_ID) return window.APP_BUSINESS_ID;
        if (window.businessId) return window.businessId;
        if (window.currentBusinessId) return window.currentBusinessId;

        // Try localStorage (client apps may persist selected business)
        try {
            const ls = localStorage.getItem('business_id') || localStorage.getItem('businessId');
            if (ls) return ls;
        } catch (e) {}

        // index.html stores user object in `vvUser` — check for business_id there as well
        try {
            const vv = JSON.parse(localStorage.getItem('vvUser') || '{}');
            if (vv && vv.business_id) return vv.business_id;
        } catch (e) {}

    } catch (e) {
        console.warn('resolveBusinessId error', e);
    }

    // Fallback to default for safety
    return DEFAULT_BIZ;
}

const bizId = resolveBusinessId();

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
    messageSubscriptions: {},
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

    // Keep message subscriptions in sync for all known conversations so messages update in realtime
    async syncMessageSubscriptions() {
        try {
            const known = new Set(Object.keys(crmStore.messageSubscriptions || {}));
            const current = new Set((crmStore.conversations || []).map(c => String(c.id)));

            // Subscribe to new conversations
            for (const conv of crmStore.conversations || []) {
                const id = String(conv.id);
                if (!known.has(id)) {
                    this.subscribeMessageChannel(id, conv.channel || 'whatsapp');
                }
            }

            // Unsubscribe removed conversations
            for (const id of known) {
                if (!current.has(id)) {
                    this.removeMessageChannel(id);
                }
            }
        } catch (e) { console.warn('syncMessageSubscriptions error', e); }
    },

    subscribeMessageChannel(convId, platform = 'whatsapp') {
        if (!convId || crmStore.messageSubscriptions[convId]) return;

        try {
            const ch = getSupabase()
                .channel(`msgs_${convId}`)
                .on('postgres_changes', {
                    event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}`
                }, (payload) => {
                    if (!crmStore.messages.find(m => m.id === payload.new.id)) {
                        crmStore.messages.push(payload.new);
                        // If this conv is active, render; otherwise UI lists will be updated by loadConversations via conversation changes
                        if (crmStore.activeChatId === convId) {
                            if (platform === 'whatsapp') this.renderMessages(convId);
                            else this.renderSocialMessages(convId, platform);
                        }
                    }
                })
                .on('postgres_changes', {
                    event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}`
                }, (payload) => {
                    const idx = crmStore.messages.findIndex(m => m.id === payload.new.id);
                    if (idx !== -1) {
                        crmStore.messages[idx] = payload.new;
                        if (crmStore.activeChatId === convId) {
                            if (platform === 'whatsapp') this.renderMessages(convId);
                            else this.renderSocialMessages(convId, platform);
                        }
                    }
                })
                .subscribe();

            crmStore.messageSubscriptions[convId] = ch;
        } catch (e) { console.warn('subscribeMessageChannel error', e); }
    },

    removeMessageChannel(convId) {
        try {
            const existing = crmStore.messageSubscriptions[convId];
            if (existing) {
                try { getSupabase().removeChannel(existing); } catch (e) { /* ignore */ }
                delete crmStore.messageSubscriptions[convId];
            }
        } catch (e) { console.warn('removeMessageChannel error', e); }
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
            .order('last_user_message_at', { ascending: false, nullsFirst: false });

        if (!error && data) {
            crmStore.conversations = data;
            // Ensure we have realtime subscriptions for messages belonging to these conversations
            try { await this.syncMessageSubscriptions(); } catch (e) { /* ignore */ }
            
            // REFRESH ALL VIEWS
            this.renderContacts(); // WhatsApp
            this.renderSocialMessenger('facebook');
            this.renderSocialMessenger('instagram');
            this.renderSocialMessenger('tiktok');
            this.renderCommentFeed('facebook');
            this.renderCommentFeed('instagram');
            this.renderCommentFeed('tiktok');
            // Update unread totals and AI indicators for headers
            try {
                const waUnread = crmStore.conversations.filter(c => c.channel === 'whatsapp').reduce((s,x) => s + (Number(x.unread_count)||0), 0);
                const fbUnread = crmStore.conversations.filter(c => c.channel === 'facebook').reduce((s,x) => s + (Number(x.unread_count)||0), 0);
                const igUnread = crmStore.conversations.filter(c => c.channel === 'instagram').reduce((s,x) => s + (Number(x.unread_count)||0), 0);
                const ttUnread = crmStore.conversations.filter(c => c.channel === 'tiktok').reduce((s,x) => s + (Number(x.unread_count)||0), 0);
                
                // Update platform button badges (top navigation)
                const waBtn = document.getElementById('whatsapp-unread-badge');
                const fbBtn = document.getElementById('facebook-unread-badge');
                const igBtn = document.getElementById('instagram-unread-badge');
                const ttBtn = document.getElementById('tiktok-unread-badge');
                
                if (waBtn) { if (waUnread > 0) { waBtn.textContent = waUnread; waBtn.classList.remove('hidden'); } else { waBtn.classList.add('hidden'); } }
                if (fbBtn) { if (fbUnread > 0) { fbBtn.textContent = fbUnread; fbBtn.classList.remove('hidden'); } else { fbBtn.classList.add('hidden'); } }
                if (igBtn) { if (igUnread > 0) { igBtn.textContent = igUnread; igBtn.classList.remove('hidden'); } else { igBtn.classList.add('hidden'); } }
                if (ttBtn) { if (ttUnread > 0) { ttBtn.textContent = ttUnread; ttBtn.classList.remove('hidden'); } else { ttBtn.classList.add('hidden'); } }
                
                // Update platform header bars (admin.html specific)
                const fbEl = document.getElementById('fb-unread-total');
                const igEl = document.getElementById('ig-unread-total');
                const ttEl = document.getElementById('tt-unread-total');
                if (fbEl) { if (fbUnread > 0) { fbEl.textContent = `${fbUnread} unread`; fbEl.classList.remove('hidden'); } else { fbEl.classList.add('hidden'); } }
                if (igEl) { if (igUnread > 0) { igEl.textContent = `${igUnread} unread`; igEl.classList.remove('hidden'); } else { igEl.classList.add('hidden'); } }
                if (ttEl) { if (ttUnread > 0) { ttEl.textContent = `${ttUnread} unread`; ttEl.classList.remove('hidden'); } else { ttEl.classList.add('hidden'); } }

                const fbAi = crmStore.conversations.some(c => c.channel === 'facebook' && c.ai_enabled);
                const igAi = crmStore.conversations.some(c => c.channel === 'instagram' && c.ai_enabled);
                const ttAi = crmStore.conversations.some(c => c.channel === 'tiktok' && c.ai_enabled);
                const fbAiEl = document.getElementById('fb-ai-indicator');
                const igAiEl = document.getElementById('ig-ai-indicator');
                const ttAiEl = document.getElementById('tt-ai-indicator');
                if (fbAiEl) { if (fbAi) fbAiEl.classList.remove('hidden'); else fbAiEl.classList.add('hidden'); }
                if (igAiEl) { if (igAi) igAiEl.classList.remove('hidden'); else igAiEl.classList.add('hidden'); }
                if (ttAiEl) { if (ttAi) ttAiEl.classList.remove('hidden'); else ttAiEl.classList.add('hidden'); }
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
        const emptyState = document.getElementById('crm-empty-state');
        if (!list) return;
        
        // FILTER: Only show WhatsApp chats here
        const waChats = crmStore.conversations.filter(c => c.channel === 'whatsapp');

        if (waChats.length === 0) {
            list.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
        } else {
            if (emptyState) emptyState.classList.add('hidden');
            list.innerHTML = waChats.map(conv => {
                const contact = conv.contacts;
                const isActive = this.isWindowActive(conv.last_user_message_at);
                const isSelected = conv.id === crmStore.activeChatId;
                
                return `
                    <div onclick="crm.openChat('${conv.id}')" class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-white/10 border-l-4 border-purple-500' : 'hover:bg-white/5'}">
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
        }
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

        // Mark unread messages as read in the messages table
        await getSupabase().from('messages').update({ is_read: true }).eq('conversation_id', convId).eq('is_read', false);

        // Update local store immediately to remove unread badge
        const localConv = crmStore.conversations.find(c => c.id === convId);
        if (localConv) {
            localConv.unread_count = 0;
        }

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

            // Populate UI (we use inputs for name/phone to allow editing)
            document.getElementById('contact-modal-id').value = contact?.id || cid || '';
            const nameInput = document.getElementById('contact-modal-name-input');
            const phoneInput = document.getElementById('contact-modal-phone-input');
            const notesInput = document.getElementById('contact-modal-notes');
            const avatarEl = document.getElementById('contact-modal-avatar');

            if (nameInput) nameInput.value = contact?.name || contact?.display_name || `${(contact && contact.external_source) ? 'Social User' : 'Contact'}`;
            if (phoneInput) phoneInput.value = contact?.phone || contact?.phone_number || '';
            if (notesInput) notesInput.value = contact?.notes || contact?.note || '';
            if (avatarEl) avatarEl.textContent = (contact && (contact.name || contact.display_name)) ? (contact.name || contact.display_name)[0] : '?';

            // wire save — updates existing contact by id (do not create new contact here)
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
            if (!contactId) return alert('No contact id available — contact must exist to update.');

            const nameVal = (document.getElementById('contact-modal-name-input') || {}).value || '';
            const phoneVal = (document.getElementById('contact-modal-phone-input') || {}).value || '';
            const notes = (document.getElementById('contact-modal-notes') || {}).value || '';

            const updates = { updated_at: new Date().toISOString() };
            if (nameVal) updates.name = nameVal;
            if (phoneVal) updates.phone = phoneVal;
            updates.notes = notes;

            const { error } = await getSupabase().from('contacts').update(updates).eq('id', contactId);
            if (error) {
                console.error('Failed saving contact', error);
                return alert('Error saving contact. Check console.');
            }

            // update local store conversations if present (ensure embedded contact record stays in sync)
            crmStore.conversations = crmStore.conversations.map(c => {
                if (c.contact_id && String(c.contact_id) === String(contactId)) {
                    if (!c.contacts) c.contacts = {};
                    if (nameVal) c.contacts.name = nameVal;
                    if (phoneVal) c.contacts.phone = phoneVal;
                    c.contacts.notes = notes;
                }
                return c;
            });

            // Refresh lists and views that may depend on contact name
            try { this.renderContacts(); } catch (e) {}
            try { this.renderSocialMessenger('facebook'); this.renderSocialMessenger('instagram'); this.renderSocialMessenger('tiktok'); } catch(e) {}

            document.getElementById('contact-modal').classList.add('hidden-force');
        } catch (err) {
            console.error('saveContactNotes error', err);
            alert('Error saving notes.');
        }
    },

    // ============================================================
    // 2. SOCIAL MEDIA LOGIC (FB & IG) - THE MISSING CODES
    // ============================================================

    // Renders the list of DMs for FB, IG, or TikTok
    renderSocialMessenger(platform) {
        const listIdMap = {
            'facebook': 'fb-conversation-list',
            'instagram': 'ig-conversation-list',
            'tiktok': 'tt-conversation-list'
        };
        const emptyStateIdMap = {
            'facebook': 'fb-empty-state',
            'instagram': 'ig-empty-state',
            'tiktok': 'tt-empty-state'
        };
        const listId = listIdMap[platform];
        const emptyStateId = emptyStateIdMap[platform];
        const listContainer = document.getElementById(listId);
        const emptyState = document.getElementById(emptyStateId);
        if (!listContainer) return;

        // Filter: Channel = platform AND Type = dm
        const chats = crmStore.conversations.filter(c => c.channel === platform && c.type === 'dm');
        
        if (chats.length === 0) {
            listContainer.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
        } else {
            if (emptyState) emptyState.classList.add('hidden');
            listContainer.innerHTML = chats.map(c => {
                const name = c.contacts?.name || "Social User";
                const isActive = c.id === crmStore.activeChatId;
                const timeVal = c.last_user_message_at || c.updated_at || null;
                const time = timeVal ? new Date(timeVal).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
                const unreadBadge = (c.unread_count && Number(c.unread_count) > 0) ? `<span class="bg-green-500 text-[10px] px-1.5 rounded-full">${c.unread_count}</span>` : '';
                const preview = c.last_message_preview || 'New Message';
                
                return `
                    <div onclick="crm.selectSocialChat('${c.id}', '${platform}')" class="p-3 mx-2 rounded-lg hover:bg-white/5 cursor-pointer flex gap-3 items-center border-b border-white/5 ${isActive ? 'bg-white/10 border-l-4 border-purple-500' : ''}">
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
            }).join('');
        }
    },

    // Handles clicking a Facebook/Instagram DM
    async selectSocialChat(convId, platform) {
        crmStore.activeChatId = convId;
        crmStore.activePlatform = platform;

        // 1. Mark Read
        await getSupabase().from('conversations').update({ unread_count: 0 }).eq('id', convId);

        // Mark unread messages as read in the messages table
        await getSupabase().from('messages').update({ is_read: true }).eq('conversation_id', convId).eq('is_read', false);

        // Update local store immediately to remove unread badge
        const localConv = crmStore.conversations.find(c => c.id === convId);
        if (localConv) {
            localConv.unread_count = 0;
        }

        // 2. Fetch Messages
        const { data } = await getSupabase().from('messages')
            .select('*')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: true });
        
        crmStore.messages = data || [];

        // 3. Render and Subscribe
        this.renderSocialMessages(convId, platform);
        this.subscribeToMessages(convId, platform);
        
        // 4. Show the platform chat window (desktop) and update header + input visibility
        try {
            // On mobile, hide the conversation list and show the chat window overlay
            if (window.innerWidth < 768) {
                const listIdMap = {
                    'facebook': 'fb-conversation-list',
                    'instagram': 'ig-conversation-list',
                    'tiktok': 'tt-conversation-list'
                };
                const listId = listIdMap[platform];
                const listPanel = document.getElementById(listId);
                if (listPanel) {
                    listPanel.classList.add('mobile-chat-list-hidden');
                    listPanel.style.display = 'none';
                }
            }
            
            const conv = crmStore.conversations.find(c => c.id === convId) || {};
            const headerNameEl = document.getElementById(`${platform}-chat-header-name`);
            const headerAvatarEl = document.getElementById(`${platform}-chat-header-avatar`);
            const headerStatusEl = document.getElementById(`${platform}-chat-header-status`);
            const headerIndicatorEl = document.getElementById(`${platform}-chat-header-indicator`);
            const shortMap = platform === 'facebook' ? 'fb' : platform === 'instagram' ? 'ig' : platform === 'tiktok' ? 'tt' : platform;
            const aiIndicator = document.getElementById(`${shortMap}-ai-indicator`) || document.getElementById(`${platform}-ai-indicator`);

            if (headerNameEl) headerNameEl.textContent = conv.contacts?.name || 'Unknown';
            if (headerAvatarEl) headerAvatarEl.textContent = conv.contacts?.name?.[0] || '?';
            const isActive = this.isWindowActive(conv.last_user_message_at);
            if (headerStatusEl) headerStatusEl.textContent = isActive ? 'Active Session' : 'Session Expired';
            if (headerIndicatorEl) headerIndicatorEl.className = isActive ? 'w-2 h-2 rounded-full bg-green-500' : 'w-2 h-2 rounded-full bg-yellow-500';
            if (aiIndicator) {
                if (conv.ai_enabled) aiIndicator.classList.remove('hidden'); else aiIndicator.classList.add('hidden');
            }

            // Attach click handlers so clicking the chat header opens the contact modal for this contact
            try {
                const contactIdForModal = conv.contact_id || (conv.contacts && conv.contacts.id) || null;
                if (headerNameEl) headerNameEl.onclick = () => this.openContactModal(contactIdForModal);
                if (headerAvatarEl) headerAvatarEl.onclick = () => this.openContactModal(contactIdForModal);
            } catch (e) { /* ignore */ }

            // Show corresponding chat-window container
            const winId = `${platform}-chat-window`;
            const winEl = document.getElementById(winId) || document.getElementById(`${platform}-chat-window`) || document.getElementById(`${platform === 'facebook' ? 'facebook' : platform}-chat-window`);
            if (winEl) {
                winEl.classList.remove('hidden');
                // ensure messages area displays as flex on md
                winEl.style.display = 'flex';
            }

            // hide other social chat windows to avoid duplicates
            ['facebook','instagram','tiktok'].forEach(p => {
                if (p === platform) return;
                const other = document.getElementById(`${p}-chat-window`) || document.getElementById(`${p === 'facebook' ? 'facebook' : p}-chat-window`);
                if (other) other.classList.add('hidden');
            });

            // Update input visibility for this platform
            this.updateInputVisibility(isActive, conv.ai_enabled, platform);
        } catch (e) { console.warn('selectSocialChat UI update error', e); }

        // 5. Refresh List to show active state
        this.renderSocialMessenger(platform);
    },

    // Renders bubbles inside the social view (FB, IG, or TikTok DMs)
    renderSocialMessages(convId, platform) {
        const areaIdMap = {
            'facebook': 'fb-messages-area',
            'instagram': 'ig-messages-area',
            'tiktok': 'tt-messages-area'
        };
        const areaId = areaIdMap[platform];
        const area = document.getElementById(areaId);
        if(!area) return;

        // Filter messages for this conversation
        const msgs = crmStore.messages.filter(m => m.conversation_id === convId);
        
        // Dynamic Colors per platform
        const brandColorMap = {
            'facebook': 'bg-blue-600',
            'instagram': 'bg-gradient-to-r from-purple-600 to-pink-600',
            'tiktok': 'bg-cyan-600'
        };
        const brandColor = brandColorMap[platform] || 'bg-gray-600';

        area.innerHTML = msgs.map(m => {
            // Logic: Is this message "outgoing" (from us)?
            const isMe = m.direction === 'out' || m.role === 'admin' || m.role === 'ai';
            const isAI = m.role === 'ai';

            // Status Icon logic (similar to renderMessages)
            let statusIcon = '';
            if (isMe) {
                if (m.status === 'read') statusIcon = '<i class="fa-solid fa-check-double text-[10px] text-[#53bdeb]"></i>';
                else statusIcon = '<i class="fa-solid fa-check text-[10px] opacity-50"></i>';
            }

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
                        ${statusIcon}
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
        const viewIdMap = {
            'facebook': 'view-facebook-comments',
            'instagram': 'view-instagram-comments',
            'tiktok': 'view-tiktok-comments'
        };
        const viewId = viewIdMap[platform];
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
        const platform = crmStore.activePlatform || 'whatsapp';
        
        // Hide chat window overlay on mobile
        const chatWindowIds = {
            'whatsapp': 'crm-chat-window',
            'facebook': 'facebook-chat-window',
            'instagram': 'instagram-chat-window',
            'tiktok': 'tiktok-chat-window'
        };
        
        const chatWindowId = chatWindowIds[platform];
        const chatWindow = document.getElementById(chatWindowId);
        if (chatWindow) {
            chatWindow.classList.add('hidden');
            chatWindow.style.display = 'none';
        }
        
        // Show conversation list again
        const listPanelIds = {
            'whatsapp': 'crm-chat-list-panel',
            'facebook': 'fb-conversation-list',
            'instagram': 'ig-conversation-list',
            'tiktok': 'tt-conversation-list'
        };
        
        const listPanelId = listPanelIds[platform];
        const listPanel = document.getElementById(listPanelId);
        if (listPanel) {
            listPanel.classList.remove('mobile-chat-list-hidden');
            listPanel.style.display = '';
        }
        
        crmStore.activeChatId = null;
        
        // Re-render the appropriate list
        if (platform === 'whatsapp') {
            this.renderContacts();
        } else {
            this.renderSocialMessenger(platform);
        }
    },

    async sendMessage() {
        const platform = crmStore.activePlatform || 'whatsapp';
        const inputId = platform === 'whatsapp' ? 'chat-input' : `${platform}-chat-input`;
        const input = document.getElementById(inputId);
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
            // Update input visibility based on new AI state and active session
            const isActive = this.isWindowActive(conv.last_user_message_at);
            this.updateInputVisibility(isActive, newState);
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

    updateInputVisibility(isActive, aiEnabled, platform = crmStore.activePlatform) {
        // Determine element ids per platform. WhatsApp uses base ids; others are namespaced by platform name.
        const inputContainerId = platform === 'whatsapp' ? 'chat-input-container' : `${platform}-chat-input-container`;
        const disabledMsgId = platform === 'whatsapp' ? 'chat-input-disabled' : `${platform}-chat-input-disabled`;

        const inputContainer = document.getElementById(inputContainerId);
        const disabledMsg = document.getElementById(disabledMsgId);
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

// Handle browser back button on mobile to close chat window
window.addEventListener('popstate', () => {
    if (crmStore.activeChatId && window.innerWidth < 768) {
        crm.closeMobileChat();
    }
});

// Fallback for Android physical back button (hardware back)
document.addEventListener('backbutton', () => {
    if (crmStore.activeChatId && window.innerWidth < 768) {
        crm.closeMobileChat();
    }
}, false);

// Global helper to toggle password visibility on settings forms
window.togglePass = function(id) {
    const input = document.getElementById(id);
    if(!input) return;
    if(input.type === 'password') input.type = 'text';
    else input.type = 'password';
}

// Replace the empty profile icon with the provided SVG
const emptyProfileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-round-x-icon lucide-user-round-x"><path d="M2 21a8 8 0 0 1 11.873-7"/><circle cx="10" cy="8" r="5"/><path d="m17 17 5 5"/><path d="m22 17-5 5"/></svg>`;

// Example usage: Replace wherever the empty profile icon is dynamically rendered
// Assuming there is a placeholder for the profile icon in the DOM
const profileIconPlaceholder = document.querySelector('#profile-icon-placeholder');
if (profileIconPlaceholder) {
    profileIconPlaceholder.innerHTML = emptyProfileIcon;
}

/* ==========================================================================
   AI MANAGER & PLAYGROUND 
   ========================================================================== */

window.aiManager = {
    currentTab: 'global',
    currentPlatform: 'whatsapp', // Default

    // Called when the AI View is opened
    init: async function() {
        console.log("🧠 Initializing AI Manager...");
        
        // 1. Load Global Prompt
        const { data: globalData } = await supabase
            .from('global_config')
            .select('master_system_prompt')
            .eq('id', 1)
            .maybeSingle();
            
        if(globalData && document.getElementById('global-system-prompt')) {
            document.getElementById('global-system-prompt').value = globalData.master_system_prompt || '';
        }

        // 2. Populate Business Selector (Admin Only)
        const selectors = [
            document.getElementById('ai-business-selector'),
            document.getElementById('importerBusinessId')
        ];
        
        const activeSelectors = selectors.filter(s => s);
        if (activeSelectors.length > 0) {
            const { data: businesses } = await supabase
                .from('businesses')
                .select('business_id, name')
                .order('name');
                
            if(businesses) {
                activeSelectors.forEach(selector => {
                    selector.innerHTML = '<option value="">-- Select Business --</option>';
                    businesses.forEach(b => {
                        selector.innerHTML += `<option value="${b.business_id}">${b.name}</option>`;
                    });
                });
            }
        }
        
        // 3. Load Default Platform (WhatsApp)
        this.loadPlatform('whatsapp');
    },

    // Switch between Global, Platform, and Business Tabs
    switchTab: function(tab) {
        this.currentTab = tab;
        
        // Hide all panels
        document.querySelectorAll('.ai-tab-content').forEach(el => el.classList.add('hidden-force'));
        // Show selected
        const panel = document.getElementById(`ai-panel-${tab}`);
        if(panel) panel.classList.remove('hidden-force');
        
        // Update Buttons
        ['global', 'platform', 'business'].forEach(t => {
            const btn = document.getElementById(`tab-ai-${t}`);
            if(!btn) return;
            
            if(t === tab) {
                 btn.classList.remove('text-white/60', 'hover:bg-white/5');
                 btn.classList.add('bg-[#2b2f3a]', 'text-white', 'shadow-md');
            } else {
                 btn.classList.add('text-white/60', 'hover:bg-white/5');
                 btn.classList.remove('bg-[#2b2f3a]', 'text-white', 'shadow-md');
            }
        });
    },

    // Load Platform Rules (WhatsApp, IG, etc)
    loadPlatform: function(platform) {
        this.currentPlatform = platform;
        
        // Highlight Icons
        ['whatsapp', 'instagram', 'facebook', 'tiktok'].forEach(p => {
             const btn = document.getElementById(`btn-plat-${p}`);
             if(!btn) return;
             
             if(p === platform) {
                 btn.classList.add('bg-[#32363f]', 'scale-105', 'border-green-500/30', 'text-green-400');
                 btn.classList.remove('text-white/40', 'hover:bg-white/5'); 
             } else {
                 btn.classList.remove('bg-[#32363f]', 'scale-105', 'border-green-500/30', 'text-green-400');
                 btn.classList.add('text-white/40', 'hover:bg-white/5');
             }
        });

        // Update Title
        const titleEl = document.getElementById('lbl-plat-title');
        if(titleEl) titleEl.innerText = `${platform.charAt(0).toUpperCase() + platform.slice(1)} Rules`;

        // Fetch Data
        supabase.from('platform_rules')
            .select('instruction')
            .eq('platform', platform)
            .maybeSingle()
            .then(({ data }) => {
                const area = document.getElementById('platform-system-prompt');
                if(area) area.value = data?.instruction || '';
            });
    },

    // Load Business Context when dropdown changes
    loadBusinessContext: function() {
        const selector = document.getElementById('ai-business-selector');
        const editor = document.getElementById('ai-business-editor');
        const badge = document.getElementById('biz-status-badge');
        const promptArea = document.getElementById('business-system-prompt');

        if(!selector || !editor) return;

        const businessId = selector.value;

        if(!businessId) {
            // No business selected: Disable editor
            editor.classList.add('opacity-50', 'pointer-events-none');
            if(badge) badge.classList.add('hidden');
            promptArea.value = '';
            return;
        }

        // Enable Editor
        editor.classList.remove('opacity-50', 'pointer-events-none');
        if(badge) badge.classList.remove('hidden');
        promptArea.value = 'Loading...';

        supabase.from('businesses')
            .select('system_prompt')
            .eq('business_id', businessId)
            .single()
            .then(({ data }) => {
                promptArea.value = data?.system_prompt || '';
            });
    },

    // --- SAVE FUNCTIONS ---
    saveGlobal: async function() {
        const prompt = document.getElementById('global-system-prompt').value;
        const btn = event.target.closest('button'); // Get button for animation
        
        const { error } = await supabase.from('global_config')
            .upsert({ id: 1, master_system_prompt: prompt });

        this._animateSave(btn, error);
    },

    savePlatform: async function() {
        const prompt = document.getElementById('platform-system-prompt').value;
        const btn = event.target.closest('button');
        
        const { error } = await supabase.from('platform_rules')
            .upsert({ platform: this.currentPlatform, instruction: prompt }, { onConflict: 'platform' });

        this._animateSave(btn, error);
    },

    saveBusiness: async function() {
        const selector = document.getElementById('ai-business-selector');
        if(!selector.value) return alert("No business selected.");
        
        const prompt = document.getElementById('business-system-prompt').value;
        const btn = event.target.closest('button');

        const { error } = await supabase.from('businesses')
            .update({ system_prompt: prompt })
            .eq('business_id', selector.value);

        this._animateSave(btn, error);
    },

    _animateSave: function(btn, error) {
        if(error) {
            console.error(error);
            alert("Save failed! Check console.");
            return;
        }
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Saved';
        setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
    }
};

window.aiPlayground = {
    currentView: 'lab',
    activeSubscription: null, // Tracks the realtime listener
    selectedPlatform: 'whatsapp', // Default platform

    // Initialize: Start listening for results immediately
    init: function() {
        this.setupRealtime();
    },

    // Platform Selection with visual feedback
    selectPlatform: function(platform) {
        this.selectedPlatform = platform;
        window.aiManager.currentPlatform = platform;
        
        // Update platform label
        const labels = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
        document.getElementById('sim-platform-label').textContent = labels[platform];
        
        // Update button styles - reset all first
        document.querySelectorAll('.sim-platform-btn').forEach(btn => {
            btn.classList.remove('bg-[#2b2f3a]');
            btn.classList.add('text-white/40');
        });
        
        // Apply colors based on platform
        const platformColors = {
            'whatsapp': { icon: 'text-green-500', bg: 'bg-[#2b2f3a]' },
            'instagram': { icon: 'text-pink-500', bg: 'bg-[#2b2f3a]' },
            'facebook': { icon: 'text-blue-600', bg: 'bg-[#2b2f3a]' },
            'tiktok': { icon: 'text-cyan-500', bg: 'bg-[#2b2f3a]' }
        };
        
        const btnId = 'btn-sim-' + platform;
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.classList.remove('text-white/40');
            btn.classList.add(platformColors[platform].bg, platformColors[platform].icon);
            btn.querySelector('i').className = 'fa-brands fa-' + (platform === 'tiktok' ? 'tiktok' : platform);
        }
        
        // Update send button color
        const sendBtn = document.getElementById('pg-send-btn');
        const sendButtonColors = {
            'whatsapp': 'from-green-600 to-green-600 hover:from-green-500 hover:to-green-500',
            'instagram': 'from-pink-600 to-pink-600 hover:from-pink-500 hover:to-pink-500',
            'facebook': 'from-blue-600 to-blue-600 hover:from-blue-500 hover:to-blue-500',
            'tiktok': 'from-cyan-600 to-cyan-600 hover:from-cyan-500 hover:to-cyan-500'
        };
        
        if (sendBtn) {
            // Remove all color classes
            sendBtn.className = 'w-12 h-11 rounded-xl text-white flex items-center justify-center transition-all shadow-lg active:scale-95';
            sendBtn.classList.add('bg-gradient-to-br', ...sendButtonColors[platform].split(' '));
        }
        
        // Update chat background
        this.updateChatBackground();
    },

    // --- 1. REALTIME LISTENER (Fixes the "Wait for Response" issue) ---
    setupRealtime: function() {
        console.log("🟢 Listening for Playground Results...");
        
        if (this.activeSubscription) return; // Prevent double subscription

        this.activeSubscription = supabase.channel('playground-live')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'playground_simulations' },
                (payload) => {
                    const newRow = payload.new;
                    
                    // 1. Get currently selected business ID (or fallback for client view)
                    const selector = document.getElementById('ai-business-selector');
                    const currentBiz = selector ? selector.value : resolveBusinessId();

                    // 2. Only show results if they belong to the business we are currently looking at
                    if(newRow.business_id === currentBiz) {
                        
                        // Remove the "Thinking..." bubble
                        const loader = document.getElementById('sim-loading');
                        if(loader) {
                            // Find the parent div of the loader span and remove it
                            const bubble = loader.closest('.animate-fade-in'); 
                            if(bubble) bubble.remove(); 
                            else loader.remove();
                        }

                        // Display the AI response
                        this.appendMessage('assistant', newRow.ai_response);
                    }
                }
            )
            .subscribe();
    },

    // --- 2. TOGGLE VIEWS (Lab vs Inbox) ---
    switchView: function(view) {
        this.currentView = view;
        
        if(view === 'lab') {
            document.getElementById('pg-view-lab').classList.remove('hidden-force');
            document.getElementById('pg-view-suggestions').classList.add('hidden-force');
            
            // Tab Styles: Lab Active
            document.getElementById('btn-pg-lab').classList.add('bg-[#2b2f3a]', 'text-white', 'shadow');
            document.getElementById('btn-pg-lab').classList.remove('text-white/50');
            document.getElementById('btn-pg-suggestions').classList.remove('bg-[#2b2f3a]', 'text-white', 'shadow');
            document.getElementById('btn-pg-suggestions').classList.add('text-white/50');
        } else {
            document.getElementById('pg-view-lab').classList.add('hidden-force');
            document.getElementById('pg-view-suggestions').classList.remove('hidden-force');
            
            // Tab Styles: Suggestions Active
            document.getElementById('btn-pg-suggestions').classList.add('bg-[#2b2f3a]', 'text-white', 'shadow');
            document.getElementById('btn-pg-suggestions').classList.remove('text-white/50');
            document.getElementById('btn-pg-lab').classList.remove('bg-[#2b2f3a]', 'text-white', 'shadow');
            document.getElementById('btn-pg-lab').classList.add('text-white/50');
            
            this.fetchSuggestions();
        }
    },

    // --- 3. SEND MESSAGE (Via Proxy) ---
    send: async function() {
        const inputEl = document.getElementById('pg-input');
        const text = inputEl.value.trim();
        if(!text) return;

        // Check if platform is selected
        if (!this.selectedPlatform) {
            this.appendMessage('system', '⚠️ <b class="text-red-400">Action Required:</b> Please select a platform (WhatsApp, Instagram, Facebook, or TikTok) to continue testing.');
            return;
        }

        // Constraint: Check Business Selection
        const selector = document.getElementById('ai-business-selector');
        
        // If we are in Admin Mode (selector exists) and no value is selected
        if(selector && !selector.value) {
            this.appendMessage('system', '⚠️ <b class="text-red-400">Action Required:</b> Please select a Business on the left panel to continue.');
            return;
        }
        
        const businessId = selector ? selector.value : resolveBusinessId(); // Fallback for client side

        // UI Updates
        inputEl.value = '';
        this.appendMessage('user', text);
        this.appendMessage('system', '<i class="fa-solid fa-circle-notch fa-spin"></i> Thinking...', 'sim-loading');

        // Check for "Test Unsaved" toggle
        const useUnsaved = document.getElementById('pg-use-unsaved') ? document.getElementById('pg-use-unsaved').checked : false;
        let testPrompt = null;
        
        if(useUnsaved) {
             // Grab the text currently in the editor
             testPrompt = document.getElementById('business-system-prompt').value;
        }

        try {
            // CALL PROXY (Allows Browser Access -> Calls Brain -> Saves to DB)
            // We do NOT wait for the reply here. The Realtime Listener will catch it.
            const { data, error } = await supabase.functions.invoke('playground-proxy', {
                body: {
                    userText: text,
                    businessId: businessId,
                    // We send the prompt so the proxy can pass it to the brain
                    test_system_prompt: testPrompt 
                }
            });

            if(error) throw error;
            if(data && data.error) throw new Error(data.error);

            // Success! Now we just wait for the Realtime listener to fire.

        } catch(e) {
            // Clean up loader on error
            const loader = document.getElementById('sim-loading');
            if(loader) {
                const bubble = loader.closest('.animate-fade-in');
                if(bubble) bubble.remove();
            }
            
            console.error(e);
            this.appendMessage('system', `<span class="text-red-400">Error: ${e.message}</span>`);
        }
    },

    // --- 4. HELPER: APPEND MESSAGE ---
    appendMessage: function(role, text, id=null) {
        const container = document.getElementById('playground-chat-feed');
        const isUser = role === 'user';
        const isSystem = role === 'system';
        
        let html = '';
        if(isSystem) {
            // Small centered pill for system messages
            html = `
            <div class="flex justify-center my-2 animate-fade-in">
                <span id="${id || ''}" class="bg-[#1f2c34] border border-[#2b2f3a] text-[#8696a0] text-[10px] px-3 py-1 rounded-full shadow-sm">
                    ${text}
                </span>
            </div>`;
        } else {
            // Chat bubbles
            html = `
            <div class="flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 animate-fade-in-up">
                <div class="${isUser ? 'bg-[#005c4b]' : 'bg-[#202c33]'} text-white text-sm px-3 py-2 rounded-lg max-w-[85%] shadow-sm relative group">
                    ${text}
                    <div class="text-[9px] text-white/40 text-right mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        ${isUser ? 'Test Input' : 'AI Response'}
                    </div>
                </div>
            </div>`;
        }

        container.insertAdjacentHTML('beforeend', html);
        container.scrollTop = container.scrollHeight;
    },

    clearChat: function() {
        const container = document.getElementById('playground-chat-feed');
        container.innerHTML = `
            <div class="text-center mt-10 opacity-30">
                <i class="fa-solid fa-flask text-4xl mb-3"></i>
                <p class="text-xs">Type to test the AI.<br>No real messages are sent.</p>
            </div>`;
    },

    updateChatBackground: function() {
        const platform = window.aiManager?.currentPlatform || 'whatsapp';
        const feed = document.getElementById('playground-chat-feed');
        if (!feed) return;

        const backgroundStyles = {
            'whatsapp': "linear-gradient(rgba(15, 17, 21, 0.9), rgba(15, 17, 21, 0.9)), url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')",
            'instagram': "linear-gradient(135deg, rgba(245, 147, 51, 0.05) 0%, rgba(188, 24, 136, 0.05) 100%), linear-gradient(rgba(15, 17, 21, 0.85), rgba(15, 17, 21, 0.85))",
            'facebook': "linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0.05) 100%), linear-gradient(rgba(15, 17, 21, 0.85), rgba(15, 17, 21, 0.85))",
            'tiktok': "linear-gradient(135deg, rgba(46, 212, 191, 0.05) 0%, rgba(46, 212, 191, 0.05) 100%), linear-gradient(rgba(15, 17, 21, 0.85), rgba(15, 17, 21, 0.85))"
        };

        feed.style.backgroundImage = backgroundStyles[platform] || backgroundStyles['whatsapp'];
        feed.setAttribute('data-platform', platform);
    },

    // --- 5. SUGGESTIONS INBOX (CLIENT REQUESTS) ---
    fetchSuggestions: async function() {
        const list = document.getElementById('suggestions-list');
        list.innerHTML = '<div class="p-4 text-center text-white/30 text-xs">Loading...</div>';
        
        const { data, error } = await supabase
            .from('playground_suggestions')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if(!data || data.length === 0) {
            list.innerHTML = '<div class="p-8 text-center text-white/20 text-xs">No pending suggestions.</div>';
            return;
        }

        list.innerHTML = '';
        data.forEach(item => {
            const html = `
            <div class="p-3 border-b border-[#2b2f3a] bg-[#1a1d23] hover:bg-[#20242c] transition-colors">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded uppercase font-bold">${item.business_id}</span>
                    <span class="text-[10px] text-white/30">${new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <div class="text-xs text-white/80 italic mb-2">"${item.user_rationale || 'No reason provided'}"</div>
                
                <div class="bg-[#0f1115] p-2 rounded border border-[#2b2f3a] mb-2">
                    <div class="text-[10px] text-white/40 uppercase mb-1">Suggested Prompt:</div>
                    <div class="text-xs text-green-400 font-mono line-clamp-3">${item.suggested_system_prompt}</div>
                </div>

                <div class="flex gap-2 mt-2">
                    <button onclick="aiPlayground.handleSuggestion('${item.id}', 'approve')" class="flex-1 bg-green-600/20 hover:bg-green-600 text-green-400 hover:text-white text-[10px] py-1 rounded border border-green-600/30 transition-all">Approve</button>
                    <button onclick="aiPlayground.handleSuggestion('${item.id}', 'reject')" class="flex-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white text-[10px] py-1 rounded border border-red-600/30 transition-all">Reject</button>
                </div>
            </div>`;
            list.insertAdjacentHTML('beforeend', html);
        });
    },

    handleSuggestion: async function(id, action) {
        if(!confirm(`Are you sure you want to ${action} this?`)) return;

        const { error } = await supabase
            .from('playground_suggestions')
            .update({ status: action })
            .eq('id', id);

        if(!error) {
            this.fetchSuggestions(); // Refresh list
            if(action === 'approve') {
                alert("Approved! (Note: You still need to manually apply the prompt to the business if you want it live).");
            }
        }
    }
};

// Initialize the listener immediately
aiPlayground.init();

/* ==========================================================================
   CLIENT-SIDE EXTENSIONS FOR AI STUDIO
   (Paste this at the very bottom of messages.js)
   ========================================================================== */

// 1. EXTEND AI MANAGER (Client Features)
// Add these methods to the existing aiManager object logic
aiManager.loadMyBusinessPrompt = async function() {
    const promptArea = document.getElementById('business-system-prompt');
    if(!promptArea) return;

    // Use shared helper to get ID
    const myBizId = resolveBusinessId(); 
    if(!myBizId) return console.warn("No Business ID found for AI Lab");

    promptArea.value = "Loading your live instructions...";
    promptArea.disabled = true;

    const { data, error } = await supabase
        .from('businesses')
        .select('system_prompt')
        .eq('business_id', myBizId)
        .single();

    promptArea.disabled = false;
    
    if(data) {
        promptArea.value = data.system_prompt || "";
    } else {
        promptArea.value = "";
        promptArea.placeholder = "No instructions found. Start writing...";
    }
};

// Auto-load on Client Init if we are on the playground view
// (You might want to call this when the route changes to 'ai-playground')
if(window.location.hash === '#ai-playground' || document.getElementById('view-ai-playground')) {
    setTimeout(() => aiManager.loadMyBusinessPrompt(), 1000);
}


// 2. EXTEND AI PLAYGROUND (Submit Logic)
aiPlayground.submitSuggestion = async function() {
    const promptArea = document.getElementById('business-system-prompt');
    const prompt = promptArea.value.trim();
    
    if(!prompt) return alert("Please write some instructions first.");

    // Simple prompt for rationale
    const rationale = prompt("Please briefly explain your changes (e.g., 'Added weekend hours'):");
    if(rationale === null) return; // User cancelled

    const btn = event.currentTarget;
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending...';
    btn.disabled = true;

    const { error } = await supabase.from('playground_suggestions').insert({
        business_id: resolveBusinessId(),
        suggested_system_prompt: prompt,
        user_rationale: rationale || "No rationale provided",
        status: 'pending',
        // Optional: snapshot the test input used (if you tracked it)
        test_input: "Client Submission" 
    });

    btn.innerHTML = originalContent;
    btn.disabled = false;

    if(error) {
        console.error(error);
        alert("Failed to submit suggestion. Please try again.");
    } else {
        alert("✅ Suggestion sent! Admin will review it shortly.");
    }
};


/* ==========================================================================
   END OF MESSAGES.JS
   ========================================================================== */