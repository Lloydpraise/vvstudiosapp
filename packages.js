// packages.js - The "Nuclear" Unlocker

// 1. Early Free Redirect
(function(){
    try {
        if (location.pathname && location.pathname.toLowerCase().endsWith('free.html')) return;
        var raw = localStorage.getItem('vvUser');
        if (!raw) return;
        var user = JSON.parse(raw);
        var pkg = (user.package || user.package_name || user.packageType || user.plan || '') + '';
        if (pkg.toLowerCase() === 'free') window.location.replace('free.html');
    } catch (e) { /* ignore */ }
})();

// 2. Main Logic
(function(){
    function safeGetVVUser(){
        try{ const raw = localStorage.getItem('vvUser'); if(!raw) return null; return JSON.parse(raw); }catch(e){return null}
    }

    function detectPackage(){
        const u = safeGetVVUser(); 
        if(!u) return 'free';
        const pkg = ((u.package||u.package_name||u.packageType||u.plan||'')+'').toLowerCase();
        
        if (pkg.indexOf('premium') !== -1) return 'premium';
        if (pkg.indexOf('pro') !== -1) return 'pro';
        if (pkg.indexOf('growth') !== -1 || pkg.indexOf('starter') !== -1) return 'growth';
        return 'free';
    }

    // NEW FUNCTION: Completely replaces the HTML of the messaging item
    window.vv_force_unlock_messaging = function() {
        // Target the container LI, not the link itself
        const li = document.getElementById('messaging-item');
        
        if (li) {
            // Check if it's already unlocked to avoid flickering (check for absence of lock icon)
            if (!li.querySelector('.fa-lock') && li.querySelector('a').getAttribute('href') === 'messages.html') {
                return; 
            }

            // Completely overwrite the inner HTML with the "Active" version
            li.innerHTML = `
                <a href="messages.html" id="messaging-link" class="w-full flex items-center space-x-3 text-white hover:text-white sidebar-link p-3 rounded-xl transition-colors">
                    <i class="fa-solid fa-comments w-5 h-5"></i>
                    <span>Messaging</span>
                </a>
            `;
        }
    };

    // FUNCTION: Ensure ecommerce is always unlocked and functional
    window.vv_force_unlock_ecommerce = function() {
        const li = document.getElementById('sidebar-ecommerce-item');
        if (li) {
            const a = li.querySelector('a');
            if (a) {
                a.setAttribute('href', 'ecommerce.html');
                a.classList.remove('text-white/30', 'text-white/60');
                a.classList.add('text-white');
            }
            const lock = li.querySelector('.fa-lock');
            if (lock) lock.remove();
        }
    };

    function unlockByText(text){
        const nav = document.querySelector('#sidebar'); 
        if(!nav) return;
        const allItems = Array.from(nav.querySelectorAll('a, li, div'));
        allItems.forEach(el=>{
            if(el.textContent.includes(text)){
                el.classList.remove('text-white/30', 'text-white/60');
                el.classList.add('text-white');
                const lock = el.querySelector('.fa-lock');
                if(lock) lock.remove();
            }
        });
    }

    function runUnlocks(){
        try{
            const pkg = detectPackage();

            // ALWAYS ensure Ecommerce is open for everyone
            window.vv_force_unlock_ecommerce();

            if (pkg === 'growth') {
                ['Sales & Follow-Ups','Ads','Content Creation','My Business'].forEach(s=> unlockByText(s));
            }
            else if (pkg === 'pro') {
                ['Sales & Follow-Ups','Ads','Content Creation','My Business'].forEach(s=> unlockByText(s));
                window.vv_force_unlock_messaging(); // Unlock messaging for Pro users
            }
            else if (pkg === 'premium') {
                ['Sales & Follow-Ups','Ads','Content Creation','My Business'].forEach(s=> unlockByText(s));
                ['Automations','Marketing Systems','Live Chat'].forEach(s=> unlockByText(s));
                window.vv_force_unlock_messaging(); // Unlock messaging for Premium users
            }
        }catch(e){ }
    }

    // Expose for dashboard.js
    window.vv_applyPackageUnlocks = runUnlocks;

    // Run repeatedly to catch any re-renders
    let attempts = 0;
    const enforcer = setInterval(() => {
        attempts++;
        runUnlocks();
        if (attempts > 15) clearInterval(enforcer);
    }, 500);

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runUnlocks); 
    else runUnlocks();

})();