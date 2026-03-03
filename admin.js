// --- 0. ADMIN BUSINESS ID ---
// Set the admin business ID globally so messages.js can detect and use it
window.BUSINESS_ID = 'vvstudios10';

// --- 1. SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://xgtnbxdxbbywvzrttixf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper: Resolve public image/storage URLs
function getPublicImageUrl(path) {
    if (!path) return '';
    if (path.startsWith('http') || path.startsWith('//')) return path;


// Avatar menu toggle helper
function toggleAvatarMenu() {
    const menu = document.getElementById('avatar-menu');
    if (!menu) return;
    if (menu.classList.contains('hidden')) menu.classList.remove('hidden');
    else menu.classList.add('hidden');
}
    try {
        if (typeof path === 'string' && (path.trim().startsWith('[') || path.trim().startsWith('{'))) {
            const parsed = JSON.parse(path);
            if (Array.isArray(parsed) && parsed.length > 0) path = parsed[0];
            else if (parsed && parsed.url) path = parsed.url;
        }
    } catch(e) { /* ignore */ }

    if (Array.isArray(path)) path = path[0];

    try {
        const bucket = 'ecommerce-assets';
        const cleanPath = path.replace(new RegExp(`^${bucket}\/`), '');
        const { data } = supabase.storage.from(bucket).getPublicUrl(cleanPath);
        if (data && data.publicUrl) return data.publicUrl;
    } catch (e) {}

    return path;
}

// Helper: mask phone numbers
function maskPhone(phone) {
    if (!phone) return '-';
    const s = String(phone);
    try {
        if (window.explorer && explorer.currentUserData && String(explorer.currentUserData.phone_number) === s) return s;
    } catch (e) {}

    if (s.length <= 6) return s.replace(/.(?=.{2})/g, '*');
    const first = s.slice(0, 6);
    const last = s.slice(-2);
    return `${first} *****${last}`;
}

// Helper: escape HTML
function escapeHtml(s){
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']+/g, function(chr){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[chr] || chr;
    });
}

// Helper: format joined date
function formatJoinedDate(value) {
    if (!value) return '';
    try {
        const d = new Date(value);
        if (isNaN(d)) return '';
        const day = d.getDate();
        const year = d.getFullYear();
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const month = months[d.getMonth()] || '';
        function ordinal(n) {
            const s = ["th","st","nd","rd"], v = n % 100;
            return (s[(v-20)%10] || s[v] || s[0]);
        }
        return `Joined ${day}${ordinal(day)} ${month} ${year}`;
    } catch (e) { return ''; }
}

const auth = {
    currentAdminId: null,
    
    async login(pin) {
        const errorEl = document.getElementById('login-error');
        const loginBtn = document.querySelector('#login-form button');

        try {
            if(loginBtn) loginBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>loading...';
            
            // Querying your specific table 'admin_profiles'
            const { data: profile, error } = await supabase
                .from('admin_profiles')
                .select('admin_id, name')
                .eq('pin', pin)
                .maybeSingle();

            if (error) throw error;

            if (profile && profile.admin_id) {
                this.currentAdminId = profile.admin_id;
                
                // Success logic
                document.getElementById('login-view').classList.add('hidden-force');
                document.getElementById('app-layout').classList.remove('hidden-force');
                
                // Set the header name from the 'name' column in admin_profiles
                setHeaderAdminDisplay(profile.name || 'Admin');

                await dataManager.loadDashboard();
                
                localStorage.setItem('vvManagerPin', String(pin));
                router.navigate('dashboard');
            } else {
                if(errorEl) {
                    errorEl.classList.remove('hidden');
                    errorEl.textContent = "Invalid PIN.";
                }
            }
        } catch (err) {
            console.error("Login Error:", err);
            if(errorEl) {
                errorEl.classList.remove('hidden');
                errorEl.textContent = "Database Error: " + err.message;
            }
        } finally {
            if(loginBtn) loginBtn.innerHTML = 'Access Portal';
        }
    },
    logout() {
        this.currentAdminId = null;
        document.getElementById('app-layout').classList.add('hidden-force');
        document.getElementById('login-view').classList.remove('hidden-force');
        document.getElementById('login-pin').value = '';
        // remove saved pin and any manager-specific cached keys
        try { localStorage.removeItem('vvManagerPin'); } catch(e) {}
    }
};
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    auth.login(document.getElementById('login-pin').value);
});

try {
    const savedPin = localStorage.getItem('vvManagerPin');
    if (savedPin) {
        document.getElementById('login-pin').value = savedPin;
        const errEl = document.getElementById('login-error');
        if (errEl) errEl.classList.add('hidden');
        setTimeout(() => { auth.login(savedPin); }, 50);
    }
} catch (e) {}

async function loadAdminProfile(adminId) {
    if (!adminId) return null;
    const tableCandidates = ['admins','admin_users','admin_profiles','account_managers','managers','users','profiles'];
    const nameFields = ['admin_name','name','full_name','display_name','first_name'];

    for (const table of tableCandidates) {
        try {
            let res = await supabase.from(table).select('*').eq('id', adminId).limit(1).maybeSingle();
            if ((!res || res.error) && table) {
                res = await supabase.from(table).select('*').eq('admin_id', adminId).limit(1).maybeSingle();
            }
            const data = res && res.data ? res.data : (res && !res.error && res.length ? res[0] : null);
            if (data) {
                for (const f of nameFields) {
                    if (data[f]) {
                        setHeaderAdminDisplay(String(data[f]).trim());
                        return data;
                    }
                }
            }
        } catch (e) {}
    }
    setHeaderAdminDisplay(null);
    return null;
}

function setHeaderAdminDisplay(name) {
    try {
        const nameEl = document.getElementById('header-admin-name');
        const idEl = document.getElementById('header-admin-id');
        const avatarEl = document.getElementById('header-admin-avatar');
        const displayName = name ? String(name).split(' ')[0] : 'Admin';
        if (nameEl) nameEl.textContent = displayName;
        if (idEl) { idEl.textContent = ''; idEl.classList.add('hidden'); }
        if (avatarEl) {
            const letter = (displayName && displayName[0]) ? String(displayName[0]).toUpperCase() : 'A';
            avatarEl.textContent = letter;
        }
    } catch (e) {}
}

// --- 3. DATA & RENDER SERVICE ---
const dataManager = {
    async loadDashboard() {
        const { data: users, error: userError } = await supabase.from('admin_users_matrix').select('*');
        if (!userError && users) {
            const totalUsers = users.length;
            const activeUsers = users.filter(u => u.is_active).length;
            const totalContacts = users.reduce((sum, u) => sum + (u.total_contacts || 0), 0);
            const totalSales = users.reduce((sum, u) => sum + (u.total_sales_month || 0), 0);
            const activeRate = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;

            document.getElementById('dash-total-users').textContent = totalUsers.toLocaleString();
            document.getElementById('dash-active-rate').textContent = `${activeRate}%`;
            document.getElementById('dash-active-today').textContent = totalContacts.toLocaleString();
            document.getElementById('dash-network-sales').textContent = `KES ${totalSales.toLocaleString()}`;
        }

        const { data: insights } = await supabase.from('admin_insights').select('*').eq('admin_id', auth.currentAdminId).order('created_at', { ascending: false });
        this.renderInsights(insights);

        const { data: meetings } = await supabase.from('admin_meetings').select('*').eq('admin_id', auth.currentAdminId).eq('is_completed', false).order('meeting_date', { ascending: true });
        this.renderMeetings(meetings);
        try { document.getElementById('manager-loading').classList.add('hidden-force'); } catch (e) {}
    },

    renderInsights(insights) {
        const container = document.getElementById('dash-insights-container');
        const fullList = document.getElementById('alerts-full-list');
        const navBadge = document.getElementById('nav-alert-badge');

        if (!insights || insights.length === 0) {
            const empty = `<div class="p-3 bg-[#0f1115]/50 rounded-xl text-center text-white/50 text-sm">No new insights or alerts.</div>`;
            container.innerHTML = empty;
            if(fullList) fullList.innerHTML = empty;
            navBadge.classList.add('hidden');
            return;
        }

        navBadge.textContent = insights.length;
        navBadge.classList.remove('hidden');

        const html = insights.map(i => {
            let icon = 'fa-circle-info';
            let color = 'text-blue-400';
            if (i.type === 'risk') { icon = 'fa-triangle-exclamation'; color = 'text-red-400'; }
            if (i.type === 'opportunity') { icon = 'fa-arrow-trend-up'; color = 'text-green-400'; }

            return `
                <div class="flex items-start gap-3 p-3 bg-[#0f1115]/50 rounded-xl">
                    <i class="fa-solid ${icon} ${color} mt-1"></i>
                    <div>
                        <p class="text-sm font-medium">${i.message}</p>
                        ${i.related_business_id && i.related_business_id !== 'N/A' 
                            ? `<button onclick="explorer.open('${i.related_business_id}')" class="text-xs text-blue-400 hover:underline mt-1">View Business</button>` 
                            : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
        if(fullList) fullList.innerHTML = html;
    },

    renderMeetings(meetings) {
        const container = document.getElementById('dash-meetings-container');
        const fullList = document.getElementById('meetings-full-list');

        if (!meetings || meetings.length === 0) {
            const empty = `
                <div class="flex flex-col items-center justify-center py-6 text-center">
                    <div class="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center mb-2">
                        <i class="fa-solid fa-calendar-check text-white/30"></i>
                    </div>
                    <p class="text-white/50 text-sm">No upcoming meetings scheduled.</p>
                </div>
            `;
            container.innerHTML = empty;
            if(fullList) fullList.innerHTML = empty;
            return;
        }

        const html = meetings.map(m => {
            const date = new Date(m.meeting_date);
            const timeString = date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            return `
                <div class="flex items-center justify-between p-3 bg-[#0f1115] rounded-xl border-l-4 border-blue-500">
                    <div>
                        <div class="font-medium">${m.title}</div>
                        <div class="text-xs text-white/50">${date.toDateString()} @ ${timeString}</div>
                        ${m.notes ? `<div class="text-xs text-white/40 italic mt-1">${m.notes}</div>` : ''}
                    </div>
                    <button class="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center"><i class="fa-solid fa-video"></i></button>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
        if(fullList) fullList.innerHTML = html;
    },

    async loadSupportTickets() {
        const container = document.getElementById('support-tickets-list');
        container.innerHTML = '<div class="p-8 text-center text-white/50"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Loading tickets...</div>';

        const { data: tickets, error } = await supabase.from('support_tickets').select(`id, subject, status, priority, created_at, business:business_id (business_name)`).order('created_at', { ascending: false });

        if (error || !tickets || tickets.length === 0) {
            container.innerHTML = `
                <div class="p-8 text-center text-white/50 border-2 border-dashed border-[#2b2f3a] rounded-xl">
                    <i class="fa-solid fa-inbox text-3xl mb-3 text-white/20"></i>
                    <p>No open support tickets.</p>
                </div>
            `;
            return;
        }

        const html = tickets.map(t => {
            const priorityColor = t.priority === 'urgent' ? 'border-red-400 text-red-400' : t.priority === 'high' ? 'border-yellow-400 text-yellow-400' : 'border-blue-400 text-blue-400';
            const statusColor = t.status === 'new' ? 'bg-green-500/10 text-green-400' : 'bg-blue-500/10 text-blue-400';
        
            return `
                <div class="bg-[#0f1115] p-4 rounded-xl border border-[#2b2f3a] flex justify-between items-center hover:border-purple-500/50 transition-all">
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-bold truncate">${t.subject}</div>
                        <div class="text-xs text-white/50 mt-1 flex gap-3 items-center">
                            <span class="text-white/80">${t.business.business_name || 'N/A'}</span>
                            <span class="${priorityColor} border px-2 py-0.5 rounded text-[10px] uppercase font-bold">${t.priority}</span>
                            <span class="text-white/50 ml-auto">Opened: ${new Date(t.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 ml-4">
                        <span class="text-xs ${statusColor} px-3 py-1 rounded-full capitalize">${t.status}</span>
                        <button onclick="explorer.openTicketThread('${t.id}')" class="w-8 h-8 rounded-full bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white flex items-center justify-center transition-all" title="View Ticket">
                            <i class="fa-solid fa-arrow-right-to-bracket"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;
    }
};

// --- 4. USER MANAGER ---
const userManager = {
    allUsers: [],
    async loadUsers() {
        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-white/50">Loading users...</td></tr>';
        
        const { data, error } = await supabase.from('admin_users_matrix').select('*');
        
        if (error) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-400">Error loading data</td></tr>';
            return;
        }

        this.allUsers = data;
        this.renderTable(data);
        
        document.getElementById('user-search-input').oninput = (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = this.allUsers.filter(u => (u.business_name && u.business_name.toLowerCase().includes(term)) || (u.business_id && u.business_id.toLowerCase().includes(term)));
            this.renderTable(filtered);
        };
    },

    renderTable(users) {
        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = '';
        
        if(users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-white/50">No users found.</td></tr>';
            return;
        }

        users.forEach(u => {
            const statusColor = u.is_active ? 'text-green-400' : 'text-red-400';
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-white/5 transition-colors group cursor-pointer';
            tr.onclick = () => explorer.open(u.business_id);

            const pkgName = (u.package || 'None');
            const pkgKey = String(pkgName).toLowerCase();
            let pkgBadgeClass = 'px-2 py-1 rounded text-xs';
            let pkgBgClass = 'bg-white/10';
            let pkgTextClass = 'text-white';

            if (pkgKey.includes('free')) { pkgBgClass = 'bg-white/10'; pkgTextClass = 'text-white'; } 
            else if (pkgKey.includes('growth')) { pkgBgClass = 'bg-green-500/10'; pkgTextClass = 'text-green-400'; } 
            else if (pkgKey.includes('pro')) { pkgBgClass = 'bg-yellow-600/10'; pkgTextClass = 'text-yellow-300'; } 
            else if (pkgKey.includes('premium')) { pkgBgClass = 'bg-purple-600/10'; pkgTextClass = 'text-purple-400'; } 
            else { pkgBgClass = 'bg-white/10'; pkgTextClass = 'text-white/60'; }

            const pkgHtml = `<span class="${pkgBadgeClass} ${pkgBgClass} ${pkgTextClass}">${escapeHtml(pkgName)}</span>`;

            tr.innerHTML = `
                <td class="p-4">
                    <div class="font-bold text-white">${escapeHtml(u.business_name || 'Unknown Business')}</div>
                    <div class="text-xs text-white/50">${escapeHtml(u.joined_date ? formatJoinedDate(u.joined_date) : '')}</div>
                </td>
                <td class="p-4">${pkgHtml}</td>
                <td class="p-4">
                    <span class="text-xs ${statusColor}">
                        <i class="fa-solid fa-circle text-[8px] mr-1"></i> ${escapeHtml(u.status_label || 'Unknown')}
                    </span>
                </td>
                <td class="p-4 font-mono text-white/80">KES ${(u.total_sales_month || 0).toLocaleString()}</td>
                <td class="p-4">
                    <button class="text-purple-400 hover:text-white text-sm" onclick="event.stopPropagation(); explorer.open('${u.business_id}')">
                        View <i class="fa-solid fa-arrow-right ml-1"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
};

// --- 5. USER EXPLORER ---
const explorer = {
    currentBusinessId: null,
    currentUserData: null,

    async open(businessId) {
        this.currentBusinessId = businessId;
        router.navigate('user-explorer');
        
        document.getElementById('exp-business-name').textContent = 'Loading...';
        document.getElementById('exp-business-id').textContent = 'ID: ...';
        document.getElementById('exp-tab-content').innerHTML = '<div class="p-12 text-center"><i class="fa-solid fa-circle-notch fa-spin text-purple-500 text-2xl"></i></div>';

        const { data: user, error } = await supabase.from('admin_users_matrix').select('*').eq('business_id', businessId).single();

        if (error || !user) {
            document.getElementById('exp-business-name').textContent = 'Error: User Not Found';
            return;
        }

        this.currentUserData = user;
        document.getElementById('exp-business-name').textContent = user.business_name;
        try {
            const joinedDisplay = user.joined_date ? formatJoinedDate(user.joined_date) : (user.business_id || '');
            document.getElementById('exp-business-id').textContent = joinedDisplay;
        } catch (e) {
            document.getElementById('exp-business-id').textContent = user.business_id;
        }
        // update package display without overwriting the edit icon
        const pkgTextEl = document.getElementById('exp-package-text');
        if (pkgTextEl) pkgTextEl.textContent = user.package;
        try { updateExpPackageDisplay(user.package); } catch(e) {}
        try {
            document.getElementById('exp-business-id').dataset.phone = user.phone_number || user.phone || '';
        } catch (e) {}
        
        const statusHtml = user.is_active 
            ? `<span class="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs rounded border border-green-500/20">Active</span>`
            : `<span class="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded border border-red-500/20">Inactive</span>`;
        document.getElementById('exp-status-indicator').innerHTML = statusHtml;

        this.switchTab('overview');
    },

    async openNotesModal() {
        const modal = document.getElementById('notes-modal');
        const businessId = this.currentBusinessId;
        document.getElementById('notes-business-name').textContent = this.currentUserData.business_name;
        document.getElementById('notes-business-id').value = businessId;

        const { data } = await supabase.from('admin_notes').select('note_body').eq('business_id', businessId).eq('admin_id', auth.currentAdminId).single();
        document.getElementById('notes-body').value = data ? data.note_body : '';
        modal.classList.remove('hidden-force');
    },

    // Refresh package value from DB and update explorer display
    async refreshPackage() {
        try {
            const businessId = this.currentBusinessId;
            if (!businessId) return;
            const { data, error } = await supabase.from('logins').select('package').eq('business id', businessId).single();
            if (error) {
                console.warn('Failed to refresh package:', error);
                return;
            }
            const pkg = data && data.package ? data.package : null;
            if (pkg) {
                this.currentUserData = this.currentUserData || {};
                this.currentUserData.package = pkg;
                const pkgTextEl = document.getElementById('exp-package-text');
                if (pkgTextEl) pkgTextEl.textContent = pkg;
                try { updateExpPackageDisplay(pkg); } catch (e) {}
            }
        } catch (e) { console.error('refreshPackage error', e); }
    },

    // Open package change modal (from explorer header pen icon)
    openPackageModal() {
        const modal = document.getElementById('package-modal');
        if (!modal) return alert('Modal not found');
        const bNameEl = document.getElementById('pkg-modal-business');
        const pkgOptions = document.querySelectorAll('#pkg-options .pkg-btn');
        const currentPkg = (this.currentUserData && this.currentUserData.package) ? this.currentUserData.package : 'Free';
        modal.dataset.businessId = this.currentBusinessId || '';
        modal.dataset.pending = currentPkg;
        bNameEl.textContent = this.currentUserData ? this.currentUserData.business_name : this.currentBusinessId || 'Business';

        const colors = { 'Free': '#9CA3AF', 'Growth': '#10B981', 'Pro': '#D97706', 'Premium': '#7C3AED' };

        pkgOptions.forEach(btn => {
            const pkg = btn.dataset.pkg;
            // reset
            btn.style.background = 'rgba(255,255,255,0.03)';
            btn.style.color = 'rgba(255,255,255,0.6)';
            btn.style.borderColor = 'rgba(255,255,255,0.06)';
            btn.style.boxShadow = 'none';

            // apply small color highlight for current package
            if (pkg === currentPkg) {
                btn.style.borderColor = colors[pkg] || '#9CA3AF';
                btn.style.boxShadow = `0 0 0 3px ${ (colors[pkg]||'#9CA3AF') }22`;
            }
        });

        modal.classList.remove('hidden-force');
    },
    
    openEditModal(key) {
        if (key === 'user_notes' || key === 'notes' || key === 'admin_notes') {
            return this.openNotesModal();
        }
    },
    
    async openTicketThread(ticketId) {
        const { data: ticket, error } = await supabase
            .from('support_tickets')
            .select(`*, business_id, business:business_id (business_name), messages:ticket_messages(sender_type, message_body, created_at)`)
            .eq('id', ticketId)
            .order('created_at', { foreignTable: 'messages', ascending: true })
            .single();

        if (error || !ticket) {
            alert('Error loading ticket thread.');
            return;
        }

        const messageHtml = ticket.messages.map(m => {
            const isAdmin = m.sender_type === 'admin';
            const alignment = isAdmin ? 'justify-end' : 'justify-start';
            const bubbleColor = isAdmin ? 'bg-purple-600' : 'bg-[#2b2f3a]';
            return `
                <div class="flex ${alignment} mb-3">
                    <div class="max-w-xl p-3 rounded-xl ${bubbleColor} shadow">
                        <div class="text-xs font-bold ${isAdmin ? 'text-white' : 'text-white/80'}">
                            ${isAdmin ? 'You (Admin)' : ticket.business.business_name}
                        </div>
                        <p class="text-sm mt-1">${m.message_body}</p>
                        <div class="text-[10px] text-right mt-1 ${isAdmin ? 'text-white/60' : 'text-white/40'}">
                            ${new Date(m.created_at).toLocaleTimeString()}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        document.getElementById('support-tickets-list').innerHTML = `
            <div class="bg-[#0f1115] p-5 rounded-xl border border-[#2b2f3a]">
                <button onclick="dataManager.loadSupportTickets()" class="text-xs text-white/50 hover:text-white mb-4"><i class="fa-solid fa-arrow-left"></i> Back to Inbox</button>
                <h4 class="text-xl font-bold mb-1">${ticket.subject}</h4>
                <div class="text-sm text-white/60 mb-4">Client: ${ticket.business.business_name} | Priority: <span class="capitalize">${ticket.priority}</span></div>
                <div class="h-96 overflow-y-auto p-4 bg-black/30 rounded-lg mb-4">
                    ${messageHtml}
                </div>
                <form onsubmit="explorer.sendTicketReply(event, '${ticketId}', '${ticket.business_id}')" class="flex gap-3">
                    <input type="text" id="reply-input-${ticketId}" placeholder="Type your reply (Admin)..." required class="flex-1 bg-[#232730] border border-[#2b2f3a] rounded-lg p-3 text-white focus:border-purple-500 outline-none">
                    <button type="submit" class="px-5 bg-purple-600 hover:bg-purple-500 rounded-lg text-white"><i class="fa-solid fa-paper-plane"></i> Send</button>
                </form>
            </div>
        `;
    },

    async sendTicketReply(e, ticketId, businessId) {
        e.preventDefault();
        const input = document.getElementById(`reply-input-${ticketId}`);
        const message = input.value.trim();
        if (!message) return;
        
        const { error } = await supabase.from('ticket_messages').insert([
            { ticket_id: ticketId, sender_type: 'admin', message_body: message, business_id: businessId }
        ]);
        
        if (!error) {
            input.value = '';
            await this.openTicketThread(ticketId); 
        } else {
            alert('Error sending message: ' + error.message);
        }
    },

    async switchTab(tabName) {
        document.querySelectorAll('.exp-tab-btn').forEach(btn => {
            if(btn.dataset.tab === tabName) {
                btn.className = 'exp-tab-btn active pb-3 border-b-2 border-purple-500 text-white font-medium whitespace-nowrap transition-all';
            } else {
                btn.className = 'exp-tab-btn pb-3 border-b-2 border-transparent text-white/60 hover:text-white whitespace-nowrap transition-all';
            }
        });

        const container = document.getElementById('exp-tab-content');
        container.innerHTML = '<div class="p-12 text-center text-white/30 animate-pulse">Fetching data...</div>';

        if (tabName === 'overview') {
            async function safeCount(table, filters = []) {
                try {
                    let q = supabase.from(table).select('id', { count: 'exact' }).limit(1);
                    for (const f of filters) {
                        if (f && f.method && Array.isArray(f.args)) q = q[f.method](...f.args);
                    }
                    const res = await q;
                    if (res && typeof res.count === 'number') return res.count;
                    return 0;
                } catch (err) { return 0; }
            }

            const [dealsCount, followUpsCount, productsCount, offersCount] = await Promise.all([
                safeCount('deals', [{ method: 'eq', args: ['business_id', this.currentBusinessId] }, { method: 'eq', args: ['status', 'closed'] }]),
                safeCount('feedback', [{ method: 'eq', args: ['business_id', this.currentBusinessId] }, { method: 'eq', args: ['status', 'completed'] }]),
                safeCount('products', [{ method: 'eq', args: ['business_id', this.currentBusinessId] }]),
                safeCount('offers', [{ method: 'eq', args: ['business_id', this.currentBusinessId] }])
            ]);

            const html = `
                <div class="grid grid-cols-1 md:grid-cols-4 gap-6 animate-fade-in">
                    <div class="bg-[#1a1d23] p-5 rounded-xl border border-[#2b2f3a] card-hover">
                        <div class="text-white/50 text-xs uppercase mb-1">Deals Closed</div>
                        <div class="text-2xl font-bold text-green-400">${dealsCount || 0}</div>
                    </div>
                    <div class="bg-[#1a1d23] p-5 rounded-xl border border-[#2b2f3a] card-hover">
                        <div class="text-white/50 text-xs uppercase mb-1">Follow Ups Done</div>
                        <div class="text-2xl font-bold text-blue-400">${followUpsCount || 0}</div>
                    </div>
                    <div class="bg-[#1a1d23] p-5 rounded-xl border border-[#2b2f3a] card-hover">
                        <div class="text-white/50 text-xs uppercase mb-1">Products</div>
                        <div class="text-2xl font-bold text-white">${productsCount || 0}</div>
                    </div>
                    <div class="bg-[#1a1d23] p-5 rounded-xl border border-[#2b2f3a] card-hover">
                        <div class="text-white/50 text-xs uppercase mb-1">Active Offers</div>
                        <div class="text-2xl font-bold text-purple-400">${offersCount || 0}</div>
                    </div>
                    
                    <div class="col-span-1 md:col-span-4 bg-[#1a1d23] p-6 rounded-xl border border-[#2b2f3a]">
                        <h4 class="font-bold mb-4 border-b border-white/10 pb-2">Account Details</h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4 text-sm">
                            <div class="flex justify-between border-b border-white/5 pb-2">
                                <span class="text-white/50">Owner</span>
                                <span>${this.currentUserData.admin_name || '-'}</span>
                            </div>
                            <div class="flex justify-between border-b border-white/5 pb-2">
                                <span class="text-white/50">Phone</span>
                                <span>${this.currentUserData.phone_number || '-'}</span>
                            </div>
                            <div class="flex justify-between border-b border-white/5 pb-2">
                                <span class="text-white/50">Industry</span>
                                <span>${this.currentUserData.industry || '-'}</span>
                            </div>
                            <div class="flex justify-between border-b border-white/5 pb-2">
                                <span class="text-white/50">Joined</span>
                                <span>${new Date(this.currentUserData.joined_date).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            container.innerHTML = html;
        }

        else if (tabName === 'contacts') {
            const { data } = await supabase.from('contacts').select('*').eq('business_id', this.currentBusinessId).limit(50);
            this.renderTable(container, data, ['Name', 'Phone', 'Created At'], (row) => `
                <td class="p-4 font-medium">${row.name}</td>
                <td class="p-4 text-white/70">${maskPhone(row.phone)}</td>
                <td class="p-4 text-white/50 text-xs">${new Date(row.created_at).toLocaleDateString()}</td>
            `);
        }

        else if (tabName === 'deals') {
            const { data } = await supabase.from('deals').select('*').eq('business_id', this.currentBusinessId).order('created_at', {ascending:false});
            this.renderTable(container, data, ['Deal Name', 'Product', 'Amount', 'Stage', 'Date'], (row) => {
                const dealName = row.name || row.deal_name || row.dealName || 'Untitled Deal';
                let productLabel = '-';
                try {
                    if (row.product_name) productLabel = row.product_name;
                    else if (row.product) productLabel = row.product;
                    else if (row.item) productLabel = row.item;
                    else if (row.products) {
                        if (Array.isArray(row.products)) productLabel = row.products.map(p => (p && (p.name || p.title)) || p).filter(Boolean).slice(0,3).join(', ');
                        else if (typeof row.products === 'string') {
                            try { const parsed = JSON.parse(row.products); if (Array.isArray(parsed)) productLabel = parsed.map(p => p.name || p).slice(0,3).join(', '); else productLabel = row.products; } catch(e){ productLabel = row.products; }
                        }
                    }
                } catch(e) { productLabel = '-'; }

                const amountNum = Number(row.amount || row.value || row.total || 0) || 0;
                const stageText = row.stage || row.status || 'New';
                const stageLower = String(stageText).toLowerCase();
                const isClosedWon = stageLower.includes('won') && stageLower.includes('closed') || stageLower === 'closed won' || stageLower === 'won';
                const stageClass = isClosedWon ? 'bg-green-500 text-white' : 'bg-white/10 text-white/60';

                return `
                    <td class="p-4 font-medium">${dealName}</td>
                    <td class="p-4 text-white/70">${productLabel}</td>
                    <td class="p-4 font-mono text-yellow-300">KES ${amountNum.toLocaleString()}</td>
                    <td class="p-4"><span class="text-xs px-2 py-1 rounded ${stageClass}">${stageText}</span></td>
                    <td class="p-4 text-white/50 text-xs text-right">${new Date(row.created_at).toLocaleDateString()}</td>
                `;
            });
        }

        else if (tabName === 'sales') {
            const { data } = await supabase.from('sales').select('*').eq('business_id', this.currentBusinessId).order('created_at', {ascending:false});
            this.renderTable(container, data, ['Date', 'Item', 'Amount'], (row) => `
                <td class="p-4 text-white/50 text-xs">${new Date(row.created_at).toLocaleDateString()}</td>
                <td class="p-4 font-medium">${row.item || 'Item Sale'}</td>
                <td class="p-4 font-mono text-green-400">KES ${(row.amount || 0).toLocaleString()}</td>
            `);
        }

        else if (tabName === 'followups') {
            const { data: stats } = await supabase.from('admin_followup_stats').select('*').eq('business_id', this.currentBusinessId).single();
            const s = stats || { system_scheduled_month: 0, system_completed_month: 0, user_total: 0, user_completed: 0 };

            container.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                    <div class="bg-[#1a1d23] rounded-xl border border-[#2b2f3a] p-6 relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10"><i class="fa-solid fa-calendar-check text-6xl"></i></div>
                        <h4 class="font-bold mb-4 text-lg">System Scheduled (Mo)</h4>
                        <div class="flex items-end gap-2 mb-2">
                            <span class="text-4xl font-bold text-white">${s.system_completed_month}</span>
                            <span class="text-lg text-white/50 mb-1">/ ${s.system_scheduled_month}</span>
                        </div>
                        <div class="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                            <div class="bg-purple-500 h-full" style="width: ${s.system_scheduled_month > 0 ? (s.system_completed_month / s.system_scheduled_month)*100 : 0}%"></div>
                        </div>
                        <p class="text-xs text-white/50 mt-2">Completion Rate based on Feedback Table</p>
                    </div>
                    <div class="bg-[#1a1d23] rounded-xl border border-[#2b2f3a] p-6 relative overflow-hidden">
                        <div class="absolute top-0 right-0 p-4 opacity-10"><i class="fa-solid fa-user-clock text-6xl"></i></div>
                        <h4 class="font-bold mb-4 text-lg">User Created Tasks</h4>
                        <div class="flex items-end gap-2 mb-2">
                            <span class="text-4xl font-bold text-blue-400">${s.user_completed}</span>
                            <span class="text-lg text-white/50 mb-1">/ ${s.user_total}</span>
                        </div>
                        <div class="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                            <div class="bg-blue-500 h-full" style="width: ${s.user_total > 0 ? (s.user_completed / s.user_total)*100 : 0}%"></div>
                        </div>
                        <p class="text-xs text-white/50 mt-2">From User Follow Ups Table</p>
                    </div>
                </div>
            `;
        }

        else if (tabName === 'templates') {
            const { data: temps } = await supabase.from('personalized_business_templates').select('*').eq('business_id', this.currentBusinessId).order('recommended_delay_days', {ascending: true});
            if(!temps || temps.length === 0) {
                 container.innerHTML = `<div class="p-8 text-center border-2 border-dashed border-[#2b2f3a] rounded-xl text-white/50">No templates found. <button class="text-purple-400 font-bold ml-2">Create Default Set</button></div>`;
                 return;
            }
            container.innerHTML = `
                <div class="space-y-3 animate-fade-in">
                    ${temps.map(t => `
                        <div class="group bg-[#1a1d23] border border-[#2b2f3a] rounded-xl p-4 cursor-pointer hover:border-purple-500/50 transition-all" onclick="explorer.openTemplateModal('${t.id}', '${(t.template_title||'').replace(/'/g, "\\'")}', '${t.recommended_delay_days || t.step_number || ''}', \`${(t.personalized_message||'').replace(/`/g,'\\`')}\`)">
                            <div class="flex items-start gap-4">
                                <div class="w-12 h-12 flex-shrink-0 bg-[#0f1115] border border-[#2b2f3a] rounded-lg flex flex-col items-center justify-center">
                                    <span class="text-[10px] text-white/40 uppercase">Days</span>
                                    <span class="text-xl font-bold text-white">${t.recommended_delay_days ?? (t.step_number ?? '-')}</span>
                                </div>
                                <div class="flex-1">
                                    <h4 class="font-bold text-white group-hover:text-purple-400 transition-colors">${t.template_title}</h4>
                                    <p class="text-sm text-white/60 mt-1 line-clamp-1 group-hover:line-clamp-none transition-all">${t.personalized_message}</p>
                                </div>
                                <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                                    <i class="fa-solid fa-pencil text-white/40 hover:text-white"></i>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        else if (tabName === 'products') {
            const { data } = await supabase.from('products').select('*').eq('business_id', this.currentBusinessId);
            this.renderTable(container, data, ['Image', 'Product Name', 'Price', 'Action'], (row) => {
                const productTitle = row.title || row.name || row.product_name || 'Unnamed Product';
                let thumb = '';
                try {
                    if (row.images && Array.isArray(row.images) && row.images.length > 0) thumb = getPublicImageUrl(row.images[0]);
                    else if (row.images && typeof row.images === 'string') {
                        const parsed = JSON.parse(row.images);
                        if (Array.isArray(parsed) && parsed.length > 0) thumb = getPublicImageUrl(parsed[0]);
                    } else if (row.thumbnail_url) thumb = getPublicImageUrl(row.thumbnail_url);
                } catch(e) { thumb = ''; }

                let imgHtml = `<div class="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center"><i class="fa-solid fa-box text-white/30"></i></div>`;
                if (thumb) {
                    imgHtml = `<img src="${thumb}" alt="${(productTitle)}" class="w-10 h-10 object-cover rounded-lg border border-white/5" loading="lazy" decoding="async">`;
                }
                const productLink = `product.html?id=${encodeURIComponent(row.id)}`;
                return `
                    <td class="p-4">${imgHtml}</td>
                    <td class="p-4 font-medium">${productTitle}</td>
                    <td class="p-4">KES ${Number(row.price || 0).toLocaleString()}</td>
                    <td class="p-4">
                        <a href="${productLink}" target="_blank" rel="noopener noreferrer" title="Open product page" class="w-8 h-8 rounded-full bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white flex items-center justify-center transition-all">
                            <i class="fa-solid fa-eye"></i>
                        </a>
                    </td>
                `;
            });
        }

        else if (tabName === 'offers') {
            const { data } = await supabase.from('offers').select('*').eq('business_id', this.currentBusinessId);
            this.renderTable(container, data, ['Offer Name', 'Status', 'Expires'], (row) => {
                const isActive = !!row.is_active;
                const now = new Date();
                const expires = row.end_date ? new Date(row.end_date) : null;
                let statusLabel = 'Inactive';
                let statusClass = 'text-white/50 bg-white/5';
                if (isActive && (!expires || expires > now)) { statusLabel = 'Active'; statusClass = 'text-green-400 bg-green-500/10'; }
                else if (expires && expires <= now) { statusLabel = 'Expired'; statusClass = 'text-red-400 bg-red-500/10'; }
                const expiresText = expires ? expires.toLocaleDateString() : 'N/A';
                const offerTitle = row.name || row.title || row.offer_name || 'Untitled Offer';
                return `
                    <td class="p-4 font-medium">${offerTitle}</td>
                    <td class="p-4"><span class="text-xs ${statusClass} px-2 py-1 rounded">${statusLabel}</span></td>
                    <td class="p-4 text-white/50 text-xs">${expiresText}</td>
                `;
            });
        }

        else if (tabName === 'referrals' || tabName === 'reviews') {
            const { data } = await supabase.from(tabName).select('*').eq('business_id', this.currentBusinessId);
            this.renderTable(container, data, ['Date', 'Content'], (row) => `
                <td class="p-4 text-white/50 text-xs">${new Date(row.created_at).toLocaleDateString()}</td>
                <td class="p-4 text-sm">${row.content || row.comment || row.name || 'View Details'}</td>
            `);
        }
    },
   async viewProduct(prodId) {
        console.log("Loading product:", prodId);
        
        // 1. Navigate the UI to the products section
        if (window.router) {
            router.navigate('products');
        }

        try {
            
            const { data, error } = await supabase
                .from('businesses') // Adjust table name if your products are in a different table
                .select('*')
                .eq('business_id', prodId)
                .single();

            if (error) throw error;

            // 3. Update the Product View UI with the data
            // Assumes you have elements with these IDs in your products view
            const nameEl = document.getElementById('product-detail-name');
            const descEl = document.getElementById('product-detail-desc');
            
            if (nameEl) nameEl.textContent = data.business_name || data.name;
            if (descEl) descEl.textContent = data.industry || 'No description available';

            // Optional: Store as active product
            this.activeProductId = prodId;

        } catch (err) {
            console.error("Error viewing product:", err);
        }
    },

    renderTable(container, data, headers, rowTemplateFn) {
        if (!data || data.length === 0) {
            container.innerHTML = `<div class="p-8 text-center text-white/50 bg-[#1a1d23] rounded-xl border border-[#2b2f3a]">No records found.</div>`;
            return;
        }
        const headerHtml = headers.map(h => `<th class="p-4 text-xs font-semibold text-white/40 uppercase tracking-wider">${h}</th>`).join('');
        const rowsHtml = data.map(item => `<tr class="border-b border-[#2b2f3a] last:border-0 hover:bg-white/5 transition-colors">${rowTemplateFn(item)}</tr>`).join('');
        
        container.innerHTML = `
            <div class="bg-[#1a1d23] rounded-xl border border-[#2b2f3a] overflow-hidden fade-in">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-[#232730] border-b border-[#2b2f3a]"><tr>${headerHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    },

    openTemplateModal(id, reason, delay, message) {
        const modal = document.getElementById('edit-modal');
        document.getElementById('edit-template-id').value = id;
        document.getElementById('edit-delay').value = delay;
        document.getElementById('edit-reason').value = reason;
        document.getElementById('edit-message').value = message;
        modal.classList.remove('hidden-force');
    }
};

// --- 5b. AI AUTO-TRAINER UI MANAGER ---
window.aiManager = window.aiManager || {};
Object.assign(window.aiManager, {
    init() {
        // placeholder init logic if needed later
    },

    // 1. Tab & Mode Switchers
    switchMainMode: function(mode) {
        const configBtn = document.getElementById('mode-config');
        const autoBtn = document.getElementById('mode-auto');
        const configPanel = document.getElementById('ai-mode-config');
        const autoPanel = document.getElementById('ai-mode-auto');

        if (mode === 'config') {
            configBtn.className = "px-5 py-2 rounded-lg text-sm font-medium transition-all bg-[#2b2f3a] text-white shadow-md flex items-center";
            autoBtn.className = "px-5 py-2 rounded-lg text-sm font-medium transition-all text-white/60 hover:text-white hover:bg-white/5 flex items-center";
            configPanel.classList.remove('hidden-force');
            autoPanel.classList.add('hidden-force');
        } else {
            autoBtn.className = "px-5 py-2 rounded-lg text-sm font-medium transition-all bg-[#2b2f3a] text-white shadow-md flex items-center";
            configBtn.className = "px-5 py-2 rounded-lg text-sm font-medium transition-all text-white/60 hover:text-white hover:bg-white/5 flex items-center";
            autoPanel.classList.remove('hidden-force');
            configPanel.classList.add('hidden-force');
            this.loadAutoTrainerData();
        }
    },

    switchAutoTab: function(tab) {
        ['queue', 'goldens', 'anomalies'].forEach(t => {
            document.getElementById(`tab-auto-${t}`).className = "px-6 py-2 rounded-lg text-sm font-medium transition-all text-white/60 hover:text-white hover:bg-white/5";
            document.getElementById(`ai-auto-${t}`).classList.add('hidden-force');
        });
        document.getElementById(`tab-auto-${tab}`).className = "px-6 py-2 rounded-lg text-sm font-medium transition-all bg-[#2b2f3a] text-white shadow-md";
        document.getElementById(`ai-auto-${tab}`).classList.remove('hidden-force');
    },

    // 2. Data Loader
    loadAutoTrainerData: async function() {
        const bizId = document.getElementById('ai-business-selector').value;
        if (!bizId) return;

        // Fetch all related data in parallel
        const [goldens, lessons, anomalies] = await Promise.all([
            supabase.from('eval_goldens').select('*').eq('business_id', bizId).order('created_at', { ascending: false }),
            supabase.from('business_lessons').select('*').eq('business_id', bizId).eq('status', 'pending_approval'),
            supabase.from('ai_anomalies').select('*').eq('business_id', bizId).order('created_at', { ascending: false })
        ]);

        this.renderGoldens(goldens.data || []);
        this.renderLessons(lessons.data || []);
        this.renderAnomalies(anomalies.data || []);
    },

    // 3. Renderer: Goldens Library (Deduplicated Intents)
    renderGoldens: function(goldens) {
        const container = document.getElementById('goldens-container');
        if (!goldens.length) {
            container.innerHTML = `<p class="text-xs text-white/20 text-center py-10">No intents identified for this business yet.</p>`;
            return;
        }

        container.innerHTML = goldens.map(g => {
            // Parse the complex logic JSON into a readable list
            let logicHtml = "";
            try {
                const logic = JSON.parse(g.perfect_answer_logic);
                if (logic.response_structure) {
                    logicHtml = logic.response_structure.map(s => `<li>${s.step || s}</li>`).join('');
                } else if (logic.steps) {
                    logicHtml = logic.steps.map(s => `<li>${s.description}</li>`).join('');
                } else {
                    logicHtml = `<li>${g.perfect_answer_logic.substring(0, 100)}...</li>`;
                }
            } catch(e) { logicHtml = `<li>${g.perfect_answer_logic}</li>`; }

            return `
                <div class="bg-[#1a1d23] border ${g.is_human_blessed ? 'border-purple-500/30' : 'border-[#2b2f3a]'} rounded-xl p-4 hover:bg-[#232730] transition-all">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h4 class="text-sm font-bold text-white flex items-center gap-2">
                                <span class="text-purple-400">#${g.intent_name}</span>
                                ${g.is_human_blessed ? '<span class="text-[9px] bg-purple-500/20 text-purple-400 px-2 rounded-full border border-purple-500/30">BLESSED</span>' : ''}
                            </h4>
                            <p class="text-[10px] text-white/40 mt-1">ID: ${g.id.split('-')[0]}</p>
                        </div>
                        <div class="flex items-center gap-3">
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" ${g.is_human_blessed ? 'checked' : ''} onchange="aiManager.toggleBlessing('${g.id}', this.checked)" class="sr-only peer">
                                <div class="w-8 h-4 bg-gray-700 rounded-full peer peer-checked:bg-purple-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-full"></div>
                            </label>
                            <button onclick="aiManager.editGolden('${g.id}', ${JSON.stringify(g.perfect_answer_logic)})" class="text-white/30 hover:text-white transition-colors"><i class="fa-solid fa-pen text-xs"></i></button>
                            <button onclick="aiManager.deleteGolden('${g.id}')" class="text-white/20 hover:text-red-400 transition-colors"><i class="fa-solid fa-trash-can text-xs"></i></button>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-[#0f1115] p-3 rounded-lg border border-[#2b2f3a]">
                            <label class="text-[9px] font-bold text-white/30 uppercase mb-2 block">Example Queries</label>
                            <div class="text-[11px] text-white/70 italic leading-relaxed">
                                ${g.user_prompt_template.replace(/[\[\]"]/g, '').split(',').slice(0,2).join('<br>')}...
                            </div>
                        </div>
                        <div class="bg-[#0f1115] p-3 rounded-lg border border-[#2b2f3a]">
                            <label class="text-[9px] font-bold text-white/30 uppercase mb-2 block">Perfect Logic Steps</label>
                            <ul class="text-[11px] text-blue-300 list-disc list-inside space-y-1">
                                ${logicHtml}
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // 3b. Renderer: Pending Lessons (Approval Queue)
    renderLessons: function(lessons) {
        const container = document.getElementById('pending-lessons-container');
        const badge = document.getElementById('pending-lessons-badge');
        if (!container) return;

        // Update badge
        if (badge) {
            if (lessons.length > 0) { badge.innerText = lessons.length; badge.classList.remove('hidden'); }
            else { badge.classList.add('hidden'); }
        }

        if (!lessons || lessons.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 opacity-20">
                    <i class="fa-solid fa-circle-check text-5xl mb-4"></i>
                    <p class="text-sm">Your queue is clear. The AI is fully trained.</p>
                </div>`;
            return;
        }

        container.innerHTML = lessons.map(lesson => {
            const parts = (lesson.lesson_text || '').split('\n');
            const observation = parts[0]?.replace('OBSERVATION:', '').trim() || 'Automated refinement suggested.';
            const instruction = parts[1]?.replace('NEW INSTRUCTION:', '').trim() || lesson.lesson_text || '';

            return `
                <div id="lesson-card-${lesson.id}" class="bg-[#1a1d23] border border-[#2b2f3a] rounded-xl p-4 shadow-lg relative overflow-hidden group">
                    <div class="absolute top-0 left-0 w-1 h-full ${lesson.priority >= 3 ? 'bg-red-500' : 'bg-yellow-500'}"></div>
                    <div class="flex justify-between items-start mb-3 pl-2">
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] font-bold ${lesson.priority >= 3 ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20'} px-2 py-1 rounded uppercase tracking-wider border">${lesson.priority >= 3 ? 'Urgent Fix' : 'Optimization'}</span>
                                <span class="text-[10px] text-white/30">${new Date(lesson.created_at).toLocaleDateString()}</span>
                            </div>
                            <p class="text-[11px] text-white/50 mt-2 italic"><i class="fa-solid fa-magnifying-glass-chart mr-1"></i> Root Cause: ${observation}</p>
                        </div>
                        <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onclick="aiManager.approveLesson('${lesson.id}', '${lesson.business_id}')" class="px-3 py-1.5 bg-green-600/20 text-green-400 hover:bg-green-600 hover:text-white rounded border border-green-500/30 transition-all text-xs font-bold flex items-center gap-1 shadow"><i class="fa-solid fa-check"></i> Approve</button>
                            <button onclick="aiManager.editLesson('${lesson.id}', ${JSON.stringify(lesson.lesson_text)})" class="px-3 py-1.5 bg-[#2b2f3a] text-white/80 hover:bg-[#373c47] rounded border border-white/10 transition-all text-xs flex items-center gap-1"><i class="fa-solid fa-pen"></i> Edit</button>
                            <button onclick="aiManager.discardLesson('${lesson.id}')" class="px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded border border-red-500/20 transition-all text-xs"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                    </div>
                    <div class="bg-[#0f1115] p-3 rounded-lg border border-[#2b2f3a] mt-2 ml-2">
                        <label class="text-[9px] font-bold text-blue-400 uppercase mb-1 block">New Behavioral Instruction</label>
                        <p class="text-sm text-white/90 font-mono leading-relaxed">${instruction}</p>
                    </div>
                </div>
            `;
        }).join('');
    },

    // 4. Rendering the Anomalies (The Radar)
    renderAnomalies: function(anomalies) {
        const container = document.querySelector('#ai-auto-anomalies .overflow-y-auto');
        if (!container) return;
        if (!anomalies || anomalies.length === 0) {
            container.innerHTML = `<p class="text-xs text-white/20 text-center py-10">No anomalies detected yet.</p>`;
            return;
        }

        container.innerHTML = anomalies.map(a => `
            <div class="bg-[#0f1115] p-3 rounded-lg border border-[#2b2f3a] group">
                <div class="flex justify-between items-start">
                    <span class="text-[10px] ${a.similarity_score < 0.3 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-500'} px-2 py-0.5 rounded uppercase tracking-wider border border-current opacity-70">
                        Similarity Score: ${a.similarity_score != null ? a.similarity_score.toFixed(2) : '-'}
                    </span>
                    <span class="text-[9px] text-white/20">${a.created_at ? new Date(a.created_at).toLocaleTimeString() : ''}</span>
                </div>
                <p class="text-xs text-white/80 mt-2 font-medium">"${(a.message_text||'').replace(/"/g,'\"')}"</p>
                <div class="mt-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="aiManager.createGoldenFromAnomaly('${a.id}')" class="text-[10px] px-2 py-1 bg-[#2b2f3a] hover:bg-purple-600 rounded text-white transition-colors">
                        <i class="fa-solid fa-star mr-1"></i> Make Golden
                    </button>
                </div>
            </div>
        `).join('');
    },

    // Inline/demo edit handler for static placeholder cards
    inlineEditHandler: function(btn) {
        try {
            // If inside a lesson card, trigger real edit flow
            const lessonCard = btn.closest('[id^="lesson-card-"]');
            if (lessonCard) {
                const id = lessonCard.id.split('-').pop();
                const textEl = lessonCard.querySelector('.text-sm') || lessonCard.querySelector('p');
                const current = textEl ? textEl.innerText : '';
                return this.editLesson(id, current);
            }

            // Otherwise, perform a harmless inline demo edit on the nearest paragraph
            const p = btn.closest('div') && btn.closest('div').querySelector('p');
            const current = p ? p.innerText : '';
            const updated = prompt('Edit content (demo):', current);
            if (updated !== null && p) p.innerText = updated;
        } catch (e) {
            console.error('inlineEditHandler error', e);
        }
    },

    // 4. Data Actions
    toggleBlessing: async function(id, isBlessed) {
        const { error } = await supabase.from('eval_goldens').update({ is_human_blessed: isBlessed }).eq('id', id);
        if (!error) showToast(isBlessed ? "Intent Blessed" : "Blessing Removed");
    },

    deleteGolden: async function(id) {
        if (!confirm("Delete this benchmark? This will affect AI training quality.")) return;
        await supabase.from('eval_goldens').delete().eq('id', id);
        this.loadAutoTrainerData();
    },

    // --- APPROVAL QUEUE BUTTONS ---
    approveLesson: async function(lessonId, businessId) {
        if(!confirm("Approve this lesson and inject it into the AI's Brain?")) return;
        try {
            const { data: lesson } = await supabase.from('business_lessons').select('lesson_text').eq('id', lessonId).single();
            const { data: biz } = await supabase.from('businesses').select('active_ai_lessons').eq('business_id', businessId).single();
            const rawInstruction = lesson.lesson_text.split('NEW INSTRUCTION:')[1] || lesson.lesson_text;
            const updatedLessons = (biz.active_ai_lessons || "") + "\n- " + rawInstruction.trim();
            await supabase.from('businesses').update({ active_ai_lessons: updatedLessons }).eq('business_id', businessId);
            await supabase.from('business_lessons').delete().eq('id', lessonId);
            showToast("Lesson Approved! AI has been updated.");
            this.loadAutoTrainerData();
            fetch(`${SUPABASE_URL}/functions/v1/eval-runner`, { method: 'POST', body: JSON.stringify({ businessId }) });
        } catch (err) {
            console.error("Approval Error:", err);
            alert("Failed to approve lesson.");
        }
    },

    editLesson: async function(lessonId, currentText) {
        const newText = prompt("Edit the new AI instruction:", currentText.split('NEW INSTRUCTION:')[1]?.trim() || currentText);
        if (!newText) return;
        const formattedText = `OBSERVATION: Manually Edited\nNEW INSTRUCTION: ${newText}`;
        const { error } = await supabase.from('business_lessons').update({ lesson_text: formattedText }).eq('id', lessonId);
        if (error) alert("Failed to update lesson");
        else {
            showToast("Lesson updated");
            this.loadAutoTrainerData();
        }
    },

    discardLesson: async function(lessonId) {
        if(!confirm("Discard this suggested lesson?")) return;
        const { error } = await supabase.from('business_lessons').delete().eq('id', lessonId);
        if (!error) this.loadAutoTrainerData();
    },

    // --- GOLDENS LIBRARY BUTTONS ---
    addGolden: async function() {
        const businessId = document.getElementById('ai-business-selector').value;
        if (!businessId) return alert("Select a business first.");
        const intentName = prompt("Enter a unique Intent Name (e.g., 'refund_policy'):");
        if (!intentName) return;
        const trigger = prompt("Enter an example user trigger (e.g., 'I want my money back'):");
        const logic = prompt("Enter the Perfect Logic the AI should follow:");
        if (intentName && logic) {
            const { error } = await supabase.from('eval_goldens').insert({
                business_id: businessId,
                intent_name: intentName.toLowerCase().replace(/\s+/g, '_'),
                user_prompt_template: `["${trigger}"]`,
                perfect_answer_logic: logic,
                is_human_blessed: true
            });
            if (error) alert("Error adding golden: " + error.message);
            else {
                showToast("Golden Rule Added");
                this.loadAutoTrainerData();
            }
        }
    },

    editGolden: async function(goldenId, currentLogic) {
        const newLogic = prompt("Update the Perfect Logic for this Intent:", currentLogic);
        if (!newLogic) return;
        const { error } = await supabase.from('eval_goldens').update({ perfect_answer_logic: newLogic }).eq('id', goldenId);
        if (!error) {
            showToast("Golden Rule Updated");
            this.loadAutoTrainerData();
        }
    },

    // --- ANOMALIES & RADAR BUTTONS ---
    forceScan: async function() {
        const businessId = document.getElementById('ai-business-selector').value || "all";
        const btn = document.querySelector('button[onclick="aiManager.forceScan()"]');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) { btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Scanning...`; btn.disabled = true; }
        try {
            const response = await fetch(`${SUPABASE_URL}/functions/v1/daily-harvester`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ businessId: businessId, targetDate: new Date().toISOString().split('T')[0] })
            });
            if (!response.ok) throw new Error("Harvester failed");
            showToast("Harvester scan complete!");
            this.loadAutoTrainerData();
        } catch (err) {
            console.error(err);
            alert("Scan failed. Check Edge Function logs.");
        } finally {
            if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
        }
    },

    convertAnomalyToGolden: async function(anomalyId, businessId, messageText) {
        const intentName = prompt("Convert this anomaly to a Golden Rule.\nEnter an Intent Name for this query:", "custom_intent");
        if (!intentName) return;
        const logic = prompt("How should the AI perfectly respond to this?", "Consult the admin.");
        if (!logic) return;
        const { error: insertErr } = await supabase.from('eval_goldens').insert({
            business_id: businessId,
            intent_name: intentName.toLowerCase().replace(/\s+/g, '_'),
            user_prompt_template: `["${messageText}"]`,
            perfect_answer_logic: logic,
            is_human_blessed: true
        });
        if (insertErr) {
            alert("Failed to create Golden.");
            return;
        }
        await supabase.from('ai_anomalies').delete().eq('id', anomalyId);
        showToast("Anomaly converted to Golden Rule!");
        this.loadAutoTrainerData();
    },

    // Wrapper: fetch anomaly details then delegate to convertAnomalyToGolden
    createGoldenFromAnomaly: async function(anomalyId) {
        try {
            const { data, error } = await supabase.from('ai_anomalies').select('business_id, message_text').eq('id', anomalyId).single();
            if (error || !data) {
                console.error('Failed to load anomaly', error);
                return alert('Failed to fetch anomaly details.');
            }
            return this.convertAnomalyToGolden(anomalyId, data.business_id, data.message_text);
        } catch (e) {
            console.error(e);
            alert('Error converting anomaly to golden.');
        }
    }
});

// access the shared `window.aiManager` directly (no top-level alias)

// --- 6. ROUTER ---
const router = {
    navigate(target) {
        document.querySelectorAll('.sidebar-link').forEach(btn => {
            btn.classList.remove('active');
            if(btn.dataset.target === target) btn.classList.add('active');
        });

        // Hide all view sections (use both classes to match switchMainView behaviour)
        document.querySelectorAll('.view-section').forEach(el => { el.classList.add('hidden-force'); el.classList.add('hidden'); });

        const targetView = document.getElementById(`view-${target}`);
        if(targetView) { targetView.classList.remove('hidden-force'); targetView.classList.remove('hidden'); }

        const titles = {
            'dashboard': 'Dashboard',
            'users': 'User Management',
            'user-explorer': 'User Explorer',
            'meetings': 'My Meetings',
            'support': 'Support Inbox',
            'alerts': 'Insights & Alerts',
            'ai-importer': 'AI Product Importer',
            'messaging': 'Messaging (CRM)' // Added Messaging Title
        };
        const pageTitle = document.getElementById('page-title');
        pageTitle.textContent = titles[target] || 'Portal';
        
        // Hide page title for AI training (has its own header)
        if (target === 'ai-training') {
            pageTitle.classList.add('hidden-force');
        } else {
            pageTitle.classList.remove('hidden-force');
        }

        if(target === 'users') userManager.loadUsers();
        if(target === 'dashboard') dataManager.loadDashboard();
        if(target === 'support') dataManager.loadSupportTickets();
        if(target === 'meetings') { loadMeetings(); loadLeads(); }
        if(target === 'ai-training' && window.aiManager && typeof aiManager.init === 'function') {
            aiManager.init();
        }
        if(target === 'ai-importer' && window.aiManager && typeof aiManager.init === 'function') {
            aiManager.init();
        }

        // Trigger CRM load if messaging is selected (depends on messages.js)
        if(target === 'messaging' && window.crm && typeof crm.switchTab === 'function') {
            crm.switchTab('chats');
        }
        // Ensure social headers (Facebook / Instagram) are hidden when navigating
        try {
            const fbHeader = document.getElementById('facebook-header');
            const igHeader = document.getElementById('instagram-header');
            if (fbHeader) { fbHeader.classList.add('hidden-force'); fbHeader.classList.add('hidden'); }
            if (igHeader) { igHeader.classList.add('hidden-force'); igHeader.classList.add('hidden'); }
        } catch (e) { /* ignore */ }
    }
};

// Package modal handlers (global)
function packageModalSelect(e) {
    const btn = e.currentTarget || e.target;
    const pkg = btn && btn.dataset ? btn.dataset.pkg : null;
    if (!pkg) return;
    const colors = { 'Free': '#9CA3AF', 'Growth': '#10B981', 'Pro': '#D97706', 'Premium': '#7C3AED' };
    const modal = document.getElementById('package-modal');
    if (!modal) return;
    modal.dataset.pending = pkg;

    document.querySelectorAll('#pkg-options .pkg-btn').forEach(b => {
        b.style.borderColor = 'rgba(255,255,255,0.06)';
        b.style.boxShadow = 'none';
        b.style.color = 'rgba(255,255,255,0.6)';
        b.style.background = 'rgba(255,255,255,0.03)';
    });

    btn.style.borderColor = colors[pkg] || '#9CA3AF';
    btn.style.boxShadow = `0 0 0 3px ${ (colors[pkg]||'#9CA3AF') }22`;
    btn.style.color = 'rgba(255,255,255,0.95)';
}

async function packageModalSave() {
    const modal = document.getElementById('package-modal');
    if (!modal) return;
    const selected = modal.dataset.pending;
    const businessId = modal.dataset.businessId;
    const saveBtn = document.getElementById('pkg-save-btn');
    if (!selected || !businessId) return closePackageModal();
    try {
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
        const { data, error } = await supabase.from('logins').update({ package: selected }).eq('business id', businessId);
        if (error) throw error;

        // update explorer UI if open
        if (window.explorer && explorer.currentBusinessId === businessId && explorer.currentUserData) {
            explorer.currentUserData.package = selected;
            const pText = document.getElementById('exp-package-text');
            if (pText) pText.textContent = selected;
            updateExpPackageDisplay(selected);
        }

        // update users table in-memory and re-render
        if (window.userManager && Array.isArray(userManager.allUsers)) {
            userManager.allUsers = userManager.allUsers.map(u => { if (u.business_id === businessId) u.package = selected; return u; });
            userManager.renderTable(userManager.allUsers);
        }

        closePackageModal();
    } catch (err) {
        console.error('Package save error', err);
        alert('Error saving package: ' + (err.message || err.error || String(err)));
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    }
}

function closePackageModal() {
    const modal = document.getElementById('package-modal');
    if (!modal) return;
    modal.classList.add('hidden-force');
    modal.dataset.pending = '';
    document.querySelectorAll('#pkg-options .pkg-btn').forEach(b => {
        b.style.borderColor = 'rgba(255,255,255,0.06)';
        b.style.boxShadow = 'none';
        b.style.color = 'rgba(255,255,255,0.6)';
        b.style.background = 'rgba(255,255,255,0.03)';
    });
}

function updateExpPackageDisplay(pkg) {
    const wrap = document.getElementById('exp-package');
    const text = document.getElementById('exp-package-text');
    if (!wrap || !text) return;
    const map = {
        'Free': { bg: 'rgba(255,255,255,0.03)', text: 'rgba(255,255,255,0.8)' },
        'Growth': { bg: 'rgba(16,185,129,0.08)', text: '#10B981' },
        'Pro': { bg: 'rgba(217,119,6,0.08)', text: '#D97706' },
        'Premium': { bg: 'rgba(124,58,237,0.08)', text: '#7C3AED' }
    };
    const s = map[pkg] || map['Free'];
    wrap.style.background = s.bg;
    text.style.color = s.text;
    text.textContent = pkg;
}

// --- WHATSAPP HELPERS ---
(function(){
    function normalizeTo2547(phone) {
        if (!phone) return null;
        let s = String(phone || '').trim();
        s = s.replace(/[^0-9+]/g, '');
        if (s.startsWith('+')) s = s.substring(1);
        if (s.startsWith('00')) s = s.substring(2);
        s = s.replace(/\D/g, '');
        if (s.length === 0) return null;
        if (s.startsWith('0')) s = '254' + s.substring(1);
        if (s.length === 9 && s.startsWith('7')) s = '254' + s;
        if (!s.startsWith('254') && s.length > 0) {
            if (s.startsWith('7') || s.length === 9) s = '254' + s;
        }
        return s;
    }

    window.openWhatsAppCompose = function(){
        let phone = (window.explorer && explorer.currentUserData && (explorer.currentUserData.phone_number || explorer.currentUserData.phone)) || null;
        try {
            const dataPhone = document.getElementById('exp-business-id') && document.getElementById('exp-business-id').dataset && document.getElementById('exp-business-id').dataset.phone;
            if (!phone && dataPhone) phone = dataPhone;
        } catch (e) {}
        if (!phone) { alert('No phone number available for this user'); return; }
        const normalized = normalizeTo2547(phone) || String(phone);
        const recipEl = document.getElementById('wa-recipient');
        const msgEl = document.getElementById('wa-message');
        const modal = document.getElementById('whatsapp-modal');
        if (recipEl) recipEl.textContent = normalized;
        if (msgEl) msgEl.value = '';
        if (modal) modal.classList.remove('hidden-force');
    };

    window.closeWhatsAppModal = function(){
        const modal = document.getElementById('whatsapp-modal');
        if (modal) modal.classList.add('hidden-force');
    };

    (function(){
        function isMobileDevice(){
            try { return /Android|iPhone|iPad|iPod|Windows Phone|webOS/i.test(navigator.userAgent); } catch(e){ return false; }
        }

        function attachWaSendHandler(){
            const sendBtn = document.getElementById('wa-send');
            const msgEl = document.getElementById('wa-message');
            if(!sendBtn) return;

            sendBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                const msg = (msgEl && msgEl.value) ? msgEl.value.trim() : '';
                const recip = (document.getElementById('wa-recipient').textContent || '').replace(/\D/g, '');
                if (!recip) { alert('Invalid recipient phone number'); return; }
                const encoded = encodeURIComponent(msg);
                const waApp = `whatsapp://send?phone=${recip}&text=${encoded}`;
                const waWeb = `https://wa.me/${recip}?text=${encoded}`;

                try {
                    if (isMobileDevice()) {
                        window.location.href = waApp;
                        setTimeout(() => { try { window.open(waWeb, '_blank'); } catch(e){} }, 600);
                    } else {
                        try { window.open(waApp, '_blank'); } catch(e){}
                        setTimeout(() => { try { window.open(waWeb, '_blank'); } catch(e){} }, 300);
                    }
                } catch (e) {
                    try { window.open(waWeb, '_blank'); } catch(err){}
                }
                try { closeWhatsAppModal(); } catch (e) {}
            });

            if (msgEl) {
                msgEl.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        sendBtn.click();
                    }
                });
            }
        }
        let attachAttempts = 0;
        function tryAttach(){
            attachAttempts++;
            attachWaSendHandler();
            const sendBtn = document.getElementById('wa-send');
            if(!sendBtn && attachAttempts < 6) setTimeout(tryAttach, 200);
        }
        tryAttach();
    })();
})();

// --- SIDEBAR TOGGLE ---
(function(){
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const overlay = document.getElementById('sidebar-overlay');

    function openSidebar(){
        if(!sidebar) return;
        sidebar.classList.remove('hidden');
        requestAnimationFrame(() => sidebar.classList.add('open'));
        if(overlay) overlay.classList.remove('hidden');
        try { document.body.classList.add('overflow-hidden'); } catch(e){}
        if(toggle) toggle.setAttribute('aria-expanded','true');
    }

    function closeSidebar(){
        if(!sidebar) return;
        sidebar.classList.remove('open');
        if(overlay) overlay.classList.add('hidden');
        try { document.body.classList.remove('overflow-hidden'); } catch(e){}
        if(toggle) toggle.setAttribute('aria-expanded','false');
        const onEnd = function(ev){
            if(ev && ev.propertyName && ev.propertyName !== 'transform') return;
            const isHamburgerVisible = function(){
                if(!toggle) return false;
                try{
                    const s = window.getComputedStyle(toggle);
                    return s && s.display !== 'none' && !toggle.classList.contains('hidden');
                }catch(e){ return false; }
            };
            if(isHamburgerVisible()) sidebar.classList.add('hidden');
            sidebar.removeEventListener('transitionend', onEnd);
        };
        sidebar.addEventListener('transitionend', onEnd);
    }

    if(toggle) toggle.addEventListener('click', () => {
        if(sidebar && (sidebar.classList.contains('hidden') || !sidebar.classList.contains('open'))) openSidebar(); else closeSidebar();
    });

    if(overlay) overlay.addEventListener('click', closeSidebar);

    function attachSidebarLinkHandlers(){
        const links = document.querySelectorAll('.sidebar-link');
        links.forEach(l => {
            l.addEventListener('click', (ev) => {
                if (window.innerWidth >= 1280) return;
                setTimeout(() => { try { closeSidebar(); } catch(e) {} }, 120);
            });
        });
    }

    const setSidebarVisibilityForViewport = function(){
        const isHamburgerVisible = function(){
            if(!toggle) return false;
            try{ const s = window.getComputedStyle(toggle); return s && s.display !== 'none' && !toggle.classList.contains('hidden'); }catch(e){ return false; }
        };

        if(!sidebar) return;
        if(isHamburgerVisible()){
            sidebar.classList.add('hidden');
            sidebar.classList.remove('open');
            if(overlay) overlay.classList.add('hidden');
        } else {
            sidebar.classList.remove('hidden');
            sidebar.classList.remove('open');
            if(overlay) overlay.classList.add('hidden');
        }
    };

    try{ setSidebarVisibilityForViewport(); window.addEventListener('resize', setSidebarVisibilityForViewport); }catch(e){}
    attachSidebarLinkHandlers();
    
    if(window.router && typeof router.navigate === 'function'){
        const original = router.navigate.bind(router);
        router.navigate = function(...args){
            closeSidebar();
            return original(...args);
        };
    }
})();

// --- EVENT LISTENERS ---
(function(){
    function safeAttach() {
        const waBtn = document.getElementById('whatsapp-btn');
        if (!waBtn) return setTimeout(safeAttach, 200);
        waBtn.style.pointerEvents = 'auto';
        waBtn.style.cursor = 'pointer';
        waBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (typeof window.openWhatsAppCompose === 'function') window.openWhatsAppCompose();
        });
    }
    safeAttach();
})();

document.getElementById('notes-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const businessId = document.getElementById('notes-business-id').value;
    const noteBody = document.getElementById('notes-body').value;
    
    const { error } = await supabase.from('admin_notes').upsert({ 
        business_id: businessId, 
        admin_id: auth.currentAdminId, 
        note_body: noteBody,
        updated_at: new Date().toISOString()
    }, { onConflict: 'business_id,admin_id', ignoreDuplicates: false });
        
    if(!error) {
        document.getElementById('notes-modal').classList.add('hidden-force');
    } else {
        alert('Error saving note.');
    }
});

document.getElementById('template-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-template-id').value;
    const reason = document.getElementById('edit-reason').value;
    const delay = document.getElementById('edit-delay').value;
    const message = document.getElementById('edit-message').value;

    const { error } = await supabase.from('personalized_templates').update({ reason, day_delay: delay, message }).eq('id', id);

    if(!error) {
        document.getElementById('edit-modal').classList.add('hidden-force');
        explorer.switchTab('templates');
    } else {
        alert('Error saving template');
    }
});

// Functions for meetings section
async function loadMeetings() {
    const container = document.getElementById('meetings-list');
    if (!container) return;
    container.innerHTML = '<div class="p-8 text-center text-white/50"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Loading meetings...</div>';

    const { data, error } = await supabase
        .from('businessmeetings')
        .select(`
            *,
            leads (
                full_name,
                phone_number,
                website_interest,
                business_name
            )
        `)
        .eq('status', 'scheduled')
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true });
    if (error) {
        console.error('Error loading meetings:', error);
        container.innerHTML = '<div class="p-8 text-center text-red-400">Error loading meetings</div>';
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="p-8 text-center text-white/50">No upcoming meetings</div>';
        return;
    }

    const html = data.map(m => {
        const lead = m.leads || {};
        const name = lead.full_name || 'Unknown';
        const phone = lead.phone_number || '';
        const interest = lead.website_interest || 'General';
        const business = m.leads.business_name || 'Business';
        const date = new Date(m.meeting_date);
        const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="bg-[#1a1d23] p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                <div class="flex items-start justify-between">
                    <div class="flex-1">
                        <div class="flex items-center gap-3 mb-2">
                            <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                                ${name.charAt(0)}
                            </div>
                            <div>
                                <h4 class="font-bold text-white">${name}</h4>
                                <p class="text-sm text-white/50">${business}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-4 text-sm text-white/60 mb-3">
                            <span><i class="fa-solid fa-calendar mr-1"></i>${date.toLocaleDateString()}</span>
                            <span><i class="fa-solid fa-clock mr-1"></i>${timeString}</span>
                            <span class="text-purple-400"><i class="fa-solid fa-cart-shopping mr-1"></i>${interest}</span>
                        </div>
                        <p class="text-sm text-white/40">${m.notes || 'No notes'}</p>
                    </div>
                    <div class="flex flex-col gap-2 ml-4">
                        <button onclick="viewMeetingDetails('${m.id}', '${name.replace(/'/g, '\\\'')}', '${phone.replace(/'/g, '\\\'')}', '${interest.replace(/'/g, '\\\'')}', '${business.replace(/'/g, '\\\'')}')" class="w-8 h-8 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white flex items-center justify-center transition-all">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        <button onclick="cancelMeeting('${m.id}')" class="w-8 h-8 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white flex items-center justify-center transition-all">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

async function loadLeads() {
    const container = document.getElementById('leads-list');
    if (!container) return;
    container.innerHTML = '<div class="p-4 text-center text-white/50"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';

    const { data: leads, error } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error loading leads:', error);
        container.innerHTML = '<div class="p-4 text-center text-red-400">Error loading leads</div>';
        return;
    }

    if (!leads || leads.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-white/50">No recent leads</div>';
        return;
    }

    const html = leads.map(lead => {
        const name = lead.name || 'Unknown';
        const phone = lead.phone || '';
        const interest = lead.interest || 'General';
        const created = new Date(lead.created_at).toLocaleDateString();

        return `
            <div class="bg-[#1a1d23] p-3 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 bg-gradient-to-br from-green-500 to-teal-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                            ${name.charAt(0)}
                        </div>
                        <div>
                            <h5 class="font-medium text-white text-sm">${name}</h5>
                            <p class="text-xs text-white/50">${interest}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-xs text-white/40">${created}</p>
                        <button onclick="viewLeadDetails('${lead.id}')" class="text-xs text-blue-400 hover:text-blue-300">View</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

function refreshCRM() {
    loadMeetings();
    loadLeads();
}

function closeMeetingDetails() {
    document.getElementById('meeting-details-modal').classList.add('hidden');
}

function viewMeetingDetails(id, name, phone, interest, business) {
    const modal = document.getElementById('meeting-details-modal');
    const drawer = document.getElementById('meeting-drawer');
    const content = document.getElementById('meeting-details-content');
    
    // Populate Data
    content.innerHTML = `
        <div class="space-y-6">
            <div class="bg-white/5 p-6 rounded-2xl border border-white/10 text-center">
                <div class="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mx-auto flex items-center justify-center text-3xl font-bold mb-3 shadow-lg">
                    ${name.charAt(0)}
                </div>
                <h2 class="text-2xl font-bold text-white">${name}</h2>
                <p class="text-white/50 text-sm">${business}</p>
                
                <div class="flex justify-center gap-3 mt-4">
                     <a href="tel:${phone}" class="px-4 py-2 bg-[#1a1d23] border border-white/10 rounded-lg text-sm hover:border-white/30 transition-colors"><i class="fa-solid fa-phone mr-2"></i>Call</a>
                     <a href="https://wa.me/${phone.replace(/[^0-9]/g, '')}" class="px-4 py-2 bg-[#1a1d23] border border-white/10 rounded-lg text-sm hover:border-green-500/50 hover:text-green-400 transition-colors"><i class="fa-brands fa-whatsapp mr-2"></i>Message</a>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="bg-[#1a1d23] p-4 rounded-xl border border-white/5">
                    <p class="text-xs text-white/40 uppercase font-bold mb-1">Interest</p>
                    <p class="text-purple-400 font-bold"><i class="fa-solid fa-cart-shopping mr-2"></i>${interest}</p>
                </div>
                <div class="bg-[#1a1d23] p-4 rounded-xl border border-white/5">
                    <p class="text-xs text-white/40 uppercase font-bold mb-1">Status</p>
                    <p class="text-orange-400 font-bold"><i class="fa-solid fa-calendar-check mr-2"></i>Scheduled</p>
                </div>
            </div>

            <div class="bg-[#1a1d23] p-4 rounded-xl border border-white/5">
                <h4 class="text-sm font-bold text-white mb-3">Meeting Agenda</h4>
                <ul class="text-sm text-white/60 space-y-2">
                    <li class="flex items-start gap-2"><i class="fa-solid fa-check text-green-500 mt-1"></i> Website Design Requirements</li>
                    <li class="flex items-start gap-2"><i class="fa-solid fa-check text-green-500 mt-1"></i> Feature Walkthrough (Demos)</li>
                    <li class="flex items-start gap-2"><i class="fa-solid fa-check text-green-500 mt-1"></i> Pricing & Timeline Discussion</li>
                </ul>
            </div>
            
            <div class="bg-blue-900/10 p-4 rounded-xl border border-blue-500/20">
                <p class="text-xs text-blue-300"><i class="fa-solid fa-circle-info mr-1"></i> <strong>Pro Tip:</strong> Prepare the ${interest} demo before the call.</p>
            </div>
        </div>
    `;

    // Show Modal
    modal.classList.remove('hidden');
    // Simple slide-in animation
    setTimeout(() => {
        drawer.classList.remove('translate-x-full');
    }, 10);
}

async function cancelMeeting(id) {
    if (!confirm('Are you sure you want to cancel this meeting?')) return;

    const { error } = await supabase
        .from('businessmeetings')
        .update({ status: 'cancelled' })
        .eq('id', id);

    if (error) {
        console.error('Error cancelling meeting:', error);
        alert('Error cancelling meeting');
        return;
    }

    // Refresh the meetings list
    loadMeetings();
}

function viewLeadDetails(id) {
    // Placeholder for lead details - could open a modal or navigate
    console.log('View lead details for:', id);
    // For now, just alert
    alert('Lead details functionality to be implemented');
}

function closeMeetingDetails() {
    const modal = document.getElementById('meeting-details-modal');
    const drawer = document.getElementById('meeting-drawer');

    drawer.classList.add('translate-x-full');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

// --- AI PLAYGROUND / SIMULATOR ---

window.aiPlayground = window.aiPlayground || {};
Object.assign(window.aiPlayground, {
    chatHistory: [],

    switchView: function(view) {
        document.getElementById('btn-pg-lab').className = `px-3 py-1 text-xs rounded font-medium ${view === 'lab' ? 'bg-[#2b2f3a] text-white shadow' : 'text-white/50 hover:text-white'}`;
        document.getElementById('btn-pg-suggestions').className = `px-3 py-1 text-xs rounded font-medium ${view === 'suggestions' ? 'bg-[#2b2f3a] text-white shadow' : 'text-white/50 hover:text-white'}`;
        // The inbox queue is handled by the left panel now, so we keep the simulator focused on the chat.
    },

    clearChat: function() {
        this.chatHistory = [];
        document.getElementById('playground-chat-feed').innerHTML = `
            <div class="text-center mt-10 opacity-30">
                <i class="fa-solid fa-flask text-4xl mb-3"></i>
                <p class="text-xs">Type to test the AI.<br>No real messages are sent.</p>
            </div>
        `;
    },

    // --- RENDERING COMPONENTS ---
    
    appendUserMessage: function(text) {
        const feed = document.getElementById('playground-chat-feed');
        // Remove the placeholder if it exists
        if (feed.querySelector('.fa-flask')) feed.innerHTML = '';
        
        feed.innerHTML += `
            <div class="flex justify-end mb-3 fade-in">
                <div class="bg-green-600 text-white text-sm py-2 px-3 rounded-l-xl rounded-tr-xl max-w-[85%] shadow">
                    ${text}
                </div>
            </div>
        `;
        this.scrollToBottom();
    },

    appendSystemLog: function(icon, text, isTool = false) {
        const feed = document.getElementById('playground-chat-feed');
        feed.innerHTML += `
            <div class="flex justify-center mb-2 fade-in">
                <div class="bg-[#2b2f3a] text-white/70 text-[10px] py-1 px-3 rounded-full font-mono flex items-center gap-2 border border-[#373c47]">
                    <i class="fa-solid ${icon} ${isTool ? 'text-purple-400 animate-pulse' : 'text-blue-400'}"></i> ${text}
                </div>
            </div>
        `;
        this.scrollToBottom();
    },

    appendAiMessage: function(text) {
        const feed = document.getElementById('playground-chat-feed');
        feed.innerHTML += `
            <div class="flex justify-start mb-3 fade-in">
                <div class="bg-[#232730] border border-[#2b2f3a] text-white text-sm py-2 px-3 rounded-r-xl rounded-tl-xl max-w-[85%] shadow">
                    ${text.replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
        this.scrollToBottom();
    },

    appendProductCard: function(product) {
        const feed = document.getElementById('playground-chat-feed');
        feed.innerHTML += `
            <div class="flex justify-start mb-3 fade-in w-full">
                <div class="bg-[#1a1d23] border border-[#2b2f3a] rounded-xl overflow-hidden shadow-lg w-[240px]">
                    <div class="h-32 bg-[#0f1115] relative">
                        <img src="${product.image || product.image_url}" class="w-full h-full object-cover opacity-90" onerror="this.src='https://via.placeholder.com/240x150?text=No+Image'">
                        <div class="absolute top-2 right-2 bg-black/60 backdrop-blur text-white text-[10px] px-2 py-0.5 rounded font-bold">
                            ${product.price}
                        </div>
                    </div>
                    <div class="p-3">
                        <h4 class="text-xs font-bold text-white truncate">${product.title}</h4>
                        <div class="mt-3 flex gap-2">
                            <button class="flex-1 bg-green-600 hover:bg-green-500 text-white text-[10px] py-1.5 rounded font-bold transition-colors">Buy Now</button>
                            <button class="flex-1 bg-[#2b2f3a] hover:bg-[#373c47] text-white/80 text-[10px] py-1.5 rounded transition-colors">Details</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        this.scrollToBottom();
    },

    scrollToBottom: function() {
        const feed = document.getElementById('playground-chat-feed');
        feed.scrollTop = feed.scrollHeight;
    },

    showTyping: function() {
        const feed = document.getElementById('playground-chat-feed');
        feed.innerHTML += `
            <div id="typing-indicator" class="flex justify-start mb-3 fade-in">
                <div class="bg-[#232730] border border-[#2b2f3a] text-white/50 text-xs py-2 px-4 rounded-r-xl rounded-tl-xl flex gap-1 items-center shadow">
                    <div class="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce"></div>
                    <div class="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
                    <div class="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
                </div>
            </div>
        `;
        this.scrollToBottom();
    },

    removeTyping: function() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    },

    // --- CORE LOGIC ---

    send: async function() {
        const inputEl = document.getElementById('pg-input');
        const text = inputEl.value.trim();
        if (!text) return;

        inputEl.value = '';
        this.appendUserMessage(text);
        this.chatHistory.push({ role: 'user', content: text });
        
        const businessId = document.getElementById('ai-business-selector')?.value || 'test_business';
        const useUnsaved = document.getElementById('pg-use-unsaved')?.checked;

        // Collect unsaved overrides if toggle is ON
        let overrides = null;
        if (useUnsaved) {
            overrides = {
                global: document.getElementById('global-system-prompt')?.value,
                platform: document.getElementById('platform-system-prompt')?.value,
                business: document.getElementById('business-system-prompt')?.value
            };
            this.appendSystemLog('fa-flask', 'Running with unsaved local overrides');
        }

        this.showTyping();

        try {
            // Hit the Brain Edge Function with SIMULATION flags
            const response = await fetch(`${SUPABASE_URL}/functions/v1/brain`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_KEY}` // Required if brain is protected
                },
                body: JSON.stringify({
                    userId: "simulator_user",
                    businessId: businessId,
                    platform: "whatsapp",
                    conversationId: "sim_" + Date.now(),
                    text: text,
                    // --- SIMULATION FLAGS ---
                    is_simulation: true, 
                    overrides: overrides,
                    history: this.chatHistory // Pass short history to keep context
                })
            });

            this.removeTyping();

            if (!response.ok) throw new Error(`Server error: ${response.status}`);
            
            // The simulation backend should return an array of "events" that happened
            const result = await response.json();

            if (result.events && Array.isArray(result.events)) {
                for (const event of result.events) {
                    if (event.type === 'tool_call') {
                        this.appendSystemLog('fa-microchip', `Calling Tool: ${event.name}`, true);
                    } 
                    else if (event.type === 'product_card') {
                        this.appendProductCard(event.data);
                    } 
                    else if (event.type === 'text') {
                        this.appendAiMessage(event.text);
                        this.chatHistory.push({ role: 'assistant', content: event.text });
                    }
                }
            } else if (result.reply) {
                // Fallback for simple text response
                this.appendAiMessage(result.reply);
                this.chatHistory.push({ role: 'assistant', content: result.reply });
            } else {
                this.appendSystemLog('fa-triangle-exclamation', 'Simulation returned unknown format');
            }

        } catch (err) {
            this.removeTyping();
            console.error("Simulation Error:", err);
            this.appendSystemLog('fa-triangle-exclamation', `Error: ${err.message}`);
        }
    }
});

// access the shared `window.aiPlayground` directly (no top-level alias)