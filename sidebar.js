// sidebar.js - State-Driven Rendering

(function(){
    // 1. Helper to check permission BEFORE generating HTML
    function getPackageStatus() {
        try {
            const raw = localStorage.getItem('vvUser');
            if (!raw) return 'free';
            const user = JSON.parse(raw);
            const pkg = (user.package || user.package_name || user.packageType || user.plan || '').toLowerCase();
            
            if (pkg.indexOf('premium') !== -1) return 'premium';
            if (pkg.indexOf('pro') !== -1) return 'pro';
            if (pkg.indexOf('growth') !== -1) return 'growth';
            return 'free';
        } catch (e) { return 'free'; }
    }

    // 2. Dynamic HTML Generator
    function generateSidebarHTML() {
        const pkg = getPackageStatus();

        // Logic variables
        const isProOrBetter = (pkg === 'pro' || pkg === 'premium');
        const isPremium = (pkg === 'premium');

        // Dynamic Classes & Links
        const msgClass = isProOrBetter ? "text-white hover:text-white" : "text-white/30 hover:text-white";
        const msgHref = isProOrBetter ? "messages.html" : "#";
        const msgLock = isProOrBetter ? "" : '<i class="fa-solid fa-lock w-3 h-3 text-white/30 ml-auto" id="messaging-lock"></i>';

        const isGrowthOrBetter = (pkg === 'growth' || pkg === 'pro' || pkg === 'premium');
        const ecomClass = isGrowthOrBetter ? "text-white hover:text-white" : "text-white/30 hover:text-white";
        const ecomHref = isGrowthOrBetter ? "ecommerce.html" : "#";
        const ecomLock = isGrowthOrBetter ? "" : '<i class="fa-solid fa-lock w-3 h-3 text-white/30 ml-auto" id="ecommerce-lock"></i>';

        // Helper for Premium-only items
        const premiumClass = isPremium ? "text-white hover:text-white" : "text-white/30 hover:text-white";
        const premiumLock = isPremium ? "" : '<i class="fa-solid fa-lock w-3 h-3 text-white/30 ml-auto"></i>';

        return `
<aside id="sidebar" class="unified-sidebar w-64 bg-[#14161a] p-6 flex-shrink-0 fixed inset-y-0 left-0 transform -translate-x-full transition-transform duration-300 z-50 lg:relative lg:translate-x-0">
    <div class="flex flex-col items-center space-y-2 mb-8 relative">
        <img src="assets/logo.png" alt="VV Studios Logo" class="w-16 h-16">
        <span class="text-xl font-bold">VV Studios</span>
        <span class="text-sm text-white/60">Client Portal</span>
        <button id="sidebar-close-button" class="absolute top-2 right-2 lg:hidden text-white focus:outline-none" aria-label="Close sidebar">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    </div>
    <nav>
        <ul class="space-y-2">
            <li class="mb-4">
                <a href="index.html" class="flex items-center space-x-3 text-white hover:text-white sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-briefcase w-5 h-5"></i>
                    <span>My Business</span>
                </a>
            </li>
            <li class="mb-4">
                <a href="ads_management_dashboard.html" class="flex items-center space-x-3 text-white hover:text-white sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-bullhorn w-5 h-5"></i>
                    <span>Ads</span>
                </a>
            </li>
            <li class="mb-4">
                <a href="crmlanding.html" class="flex items-center space-x-3 text-white hover:text-white sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-handshake w-5 h-5"></i>
                    <span>Sales & Follow-Ups</span>
                </a>
            </li>
            <li class="mb-4" id="sidebar-ecommerce-item">
                <a href="${ecomHref}" class="flex items-center space-x-3 ${ecomClass} sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-store w-5 h-5"></i>
                    <span>Ecommerce</span>
                    ${ecomLock}
                </a>
            </li>
            <li class="mb-4">
                <a href="copilot.html" class="flex items-center space-x-3 text-white hover:text-white sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-robot w-5 h-5"></i>
                    <span>Business Assistant</span>
                </a>
            </li>
            
            <li class="mb-4" id="messaging-item">
                <a href="${msgHref}" id="messaging-link" class="w-full flex items-center space-x-3 ${msgClass} sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-comments w-5 h-5"></i>
                    <span>Messaging</span>
                    ${msgLock}
                </a>
            </li>

            <li class="mb-4">
                <a href="#" class="flex items-center space-x-3 ${premiumClass} sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-arrows-spin w-5 h-5"></i>
                    <span>Automations</span>
                    ${premiumLock}
                </a>
            </li>
            <li class="mb-4">
                <a href="#" class="flex items-center space-x-3 ${premiumClass} sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-gear w-5 h-5"></i>
                    <span>Marketing Systems</span>
                    ${premiumLock}
                </a>
            </li>
            <li class="mb-4">
                <a href="contentcreation.html" class="flex items-center space-x-3 text-white hover:text-white sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-pen-nib w-5 h-5"></i>
                    <span>Content Creation</span>
                </a>
            </li>
        </ul>
    </nav>
    <div class="p-4 border-t border-white/5">
        <button id="logout-btn" class="w-full py-2 px-4 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium transition-colors">
            <i class="fa-solid fa-sign-out-alt mr-2"></i> Log Out
        </button>
    </div>
</aside>`;
    }

    function injectSidebar(){
        try{
            // Remove existing sidebar if any (prevents duplicates)
            const existing = document.getElementById('sidebar');
            if(existing) existing.remove();

            const html = generateSidebarHTML();
            const container = document.getElementById('dashboard-container');
            
            // Logic to insert into DOM
            if (container) {
                const flex = container.querySelector('.flex') || container.firstElementChild;
                if (flex) {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = html;
                    flex.insertBefore(wrapper.firstElementChild, flex.firstChild);
                    return document.getElementById('sidebar');
                }
            }
            // Fallback
            const div = document.createElement('div');
            div.innerHTML = html;
            document.body.insertBefore(div.firstElementChild, document.body.firstChild);
            return document.getElementById('sidebar');
        }catch(e){ return null; }
    }

    function setupSidebarBehavior(sidebar){
        if(!sidebar) return;
        
        // --- Standard Event Listeners (Toggle, Active State, Logout) ---
        const backdrop = document.getElementById('mobile-menu-backdrop') || (function(){
            let b = document.getElementById('sidebar-backdrop');
            if (!b){ b = document.createElement('div'); b.id = 'sidebar-backdrop'; b.className = 'fixed inset-0 bg-black bg-opacity-50 z-40 hidden'; document.body.appendChild(b); }
            return b;
        })();

        const closeBtn = document.getElementById('sidebar-close-button');
        if (closeBtn) closeBtn.addEventListener('click', ()=>{ sidebar.classList.add('-translate-x-full'); sidebar.classList.remove('open'); backdrop.classList.add('hidden'); });
        
        window.vv_toggleSidebarGuarded = function(){
            sidebar.classList.toggle('-translate-x-full');
            sidebar.classList.toggle('open');
            backdrop.classList.toggle('hidden');
        };

        // Active link highlighter
        function updateActive(){
            const links = Array.from(document.querySelectorAll('#sidebar a'));
            const path = (location.pathname||'').split('/').pop();
            links.forEach(a=> {
                a.classList.remove('active');
                if(a.getAttribute('href') === path) a.classList.add('active');
            });
        }
        updateActive();

        // Attach mobile menu button listener
        const mobileMenuBtn = document.getElementById('mobile-menu-button');
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', window.vv_toggleSidebarGuarded);
        }
    }

    // Run Logic
    function init(){
        const s = injectSidebar();
        setupSidebarBehavior(s);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    
    // Allow external apps (like dashboard.js) to force a refresh if user data changes
    window.vv_refreshSidebar = init; 
})();