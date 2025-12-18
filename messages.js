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
    activeSubscription: null
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

    // --- REALTIME ---
    setupRealtime() {
        getSupabase()
            .channel('sidebar_updates')
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'conversations', 
                filter: `business_id=eq.${crmStore.businessId}` 
            }, () => this.loadConversations())
            .subscribe();
    },

    async subscribeToMessages(convId) {
        if (crmStore.activeSubscription) getSupabase().removeChannel(crmStore.activeSubscription);

        crmStore.activeSubscription = getSupabase()
            .channel(`chat_${convId}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages', 
                filter: `conversation_id=eq.${convId}` 
            }, (payload) => {
                crmStore.messages.push(payload.new);
                this.renderMessages(convId);
            })
            .subscribe();
    },

    // --- DATA FETCHING ---
    async loadConversations() {
        const { data, error } = await getSupabase()
            .from('conversations')
            .select('*, contacts(*)')
            .eq('business_id', crmStore.businessId)
            .order('last_user_message_at', { ascending: false });

        if (!error) {
            crmStore.conversations = data;
            this.renderContacts();
        }
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

    // --- NAVIGATION & TABS ---
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
    },

    isWindowActive(timestamp) {
        if (!timestamp) return false;
        return (Date.now() - new Date(timestamp).getTime()) < (24 * 60 * 60 * 1000);
    },

    // --- CHAT UI ---
    renderContacts() {
        const list = document.getElementById('crm-contact-list');
        if (!list) return;
        list.innerHTML = crmStore.conversations.map(conv => {
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

    // --- UPDATED OPEN CHAT WITH MOBILE LOGIC ---
    async openChat(convId) {
        crmStore.activeChatId = convId;
        const conv = crmStore.conversations.find(c => c.id === convId);
        
        // [RESTORED] Mobile Handling Logic
        if(window.innerWidth < 768) {
            document.getElementById('crm-chat-list-panel').classList.add('mobile-chat-list-hidden');
            document.getElementById('crm-chat-window').classList.add('mobile-chat-view-active');
            document.getElementById('crm-chat-window').style.display = 'flex';
        }

        // Reset unread locally and in DB
        await getSupabase().from('conversations').update({ unread_count: 0 }).eq('id', convId);
        
        document.getElementById('chat-header-name').textContent = conv.contacts?.name || 'Unknown';
        document.getElementById('chat-header-avatar').textContent = conv.contacts?.name?.[0] || '?';
        
        const isActive = this.isWindowActive(conv.last_user_message_at);
        document.getElementById('chat-header-status').textContent = isActive ? "Active Session" : "Session Expired";
        document.getElementById('chat-header-indicator').className = isActive ? "w-2 h-2 rounded-full bg-green-500" : "w-2 h-2 rounded-full bg-yellow-500";

        this.updateAIToggleUI(conv.ai_enabled);
        
        const { data } = await getSupabase().from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: true });
        crmStore.messages = data || [];
        this.renderMessages(convId);
        this.subscribeToMessages(convId);
        this.renderContacts(); // Refresh list to show active selection
    },

    // [RESTORED] NEW FUNCTION FOR MOBILE BACK BUTTON
    closeMobileChat() {
        document.getElementById('crm-chat-list-panel').classList.remove('mobile-chat-list-hidden');
        document.getElementById('crm-chat-window').classList.remove('mobile-chat-view-active');
        document.getElementById('crm-chat-window').style.display = 'none';
        crmStore.activeChatId = null;
        this.renderContacts();
    },

    async sendMessage() {
        const input = document.getElementById('chat-input'); // Corrected ID from index.html
        if (!input) return;
        const text = input.value.trim();
        if (!text || !crmStore.activeChatId) return;

        const conv = crmStore.conversations.find(c => c.id === crmStore.activeChatId);
        
        const { error } = await getSupabase().from('messages').insert({
            conversation_id: crmStore.activeChatId,
            contact_id: conv.contact_id.toString(),
            business_id: crmStore.businessId,
            direction: 'out',
            role: 'admin',
            content: { text: text }
        });

        if (!error) input.value = '';
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
        const dot = toggle.querySelector('div');
        toggle.className = `relative w-8 h-4 rounded-full transition-colors cursor-pointer ${isEnabled ? 'bg-green-500' : 'bg-gray-600'}`;
        dot.style.left = isEnabled ? 'calc(100% - 10px)' : '4px'; // Basic positioning for the dot
        
        document.getElementById('chat-input-container').classList.toggle('hidden', isEnabled);
        document.getElementById('chat-input-disabled').classList.toggle('hidden', !isEnabled);
    },

    renderMessages(convId) {
        const area = document.getElementById('crm-messages-area');
        if (!area) return;
        area.innerHTML = crmStore.messages.map(m => {
            const isMe = m.direction === 'out';
            return `
                <div class="flex ${isMe ? 'justify-end' : 'justify-start'} mb-2">
                    <div class="${isMe ? 'chat-bubble-user' : 'chat-bubble-contact'} max-w-[75%] p-2 px-3 rounded-lg">
                        ${m.role === 'ai' ? '<span class="text-[9px] text-purple-300 block">AI Pilot</span>' : ''}
                        <span class="text-sm">${m.content?.text || ''}</span>
                    </div>
                </div>`;
        }).join('');
        area.scrollTop = area.scrollHeight;
    },

    // --- LISTS UI ---
    renderLists() {
        const container = document.getElementById('crm-lists-container');
        if (!container) return;
        if (crmStore.lists.length === 0) {
            container.innerHTML = `<div class="p-5 text-white/40">No lists created yet.</div>`;
            return;
        }
        container.innerHTML = crmStore.lists.map(list => `
            <div onclick="crm.openListDetails('${list.id}')" class="bg-[#232730] p-4 rounded-xl border border-white/5 hover:border-purple-500/50 cursor-pointer transition-all">
                <h4 class="font-bold text-white mb-1">${list.name}</h4>
                <p class="text-xs text-white/50">Created: ${new Date(list.created_at).toLocaleDateString()}</p>
            </div>
        `).join('');
    },

    createNewList() {
        const name = prompt("Enter list name:");
        if (name) alert("List creation logic would go here.");
    },

    openListDetails(id) {
        document.getElementById('lists-grid-view').classList.add('hidden-force');
        document.getElementById('lists-detail-view').classList.remove('hidden-force');
    },

    closeListDetails() {
        document.getElementById('lists-detail-view').classList.add('hidden-force');
        document.getElementById('lists-grid-view').classList.remove('hidden-force');
    },

    // --- TEMPLATES UI ---
    openTemplateModal() {
        document.getElementById('template-modal').classList.remove('hidden-force');
    },

    renderTemplates() {
        const container = document.getElementById('crm-templates-container');
        if (container) {
            container.innerHTML = crmStore.templates.length > 0 
                ? crmStore.templates.map(t => `<div class="p-3 bg-white/5 rounded-lg mb-2">${t.name}</div>`).join('')
                : `<div class="p-5 text-white/40">No templates found.</div>`;
        }
    },

    submitTemplate() {
        alert("Template submitted for approval.");
        document.getElementById('template-modal').classList.add('hidden-force');
    },

    renderCampaigns() {
        const tbody = document.getElementById('crm-campaigns-table');
        if (tbody) tbody.innerHTML = `<tr><td class="p-4 text-white/40" colspan="3">No active campaigns</td></tr>`;
    }
};

// Start logic when DOM is ready
document.addEventListener('DOMContentLoaded', () => crm.init());
window.crm = crm;