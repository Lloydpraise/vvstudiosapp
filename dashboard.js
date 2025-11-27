// sales-logic removed: metrics computed inline below

// CRITICAL FIX (Working): Reverting to the standard '+esm' CDN URL but using a namespace import 
// to resolve the 'createClient is undefined' error that happens with direct destructuring.
import * as Supabase from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// --- SUPABASE CONFIGURATION ---
const supabaseUrl = 'https://xgtnbxdxbbywvzrttixf.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';

// Access createClient from the Supabase namespace object
const supabase = Supabase.createClient(supabaseUrl, supabaseKey);

// Global state variables
let loggedInUser = null;
let businessId = null;
// Cached notification id returned by backend after prepare-payment
// Cached notification id returned by backend after prepare-payment
// Initialize from localStorage so the value survives short navigations
let cachedNotificationId = localStorage.getItem('vv_cached_notification_id') || null;
// Update this to your Supabase Functions / other serverless function base URL
const PROJECT_FN_BASE = 'https://xgtnbxdxbbywvzrttixf.functions.supabase.co'; // change this

// --- UTILITIES ---

export function normalizePhoneNumber(phone) {
    if (typeof phone !== 'string') {
        phone = String(phone);
    }
    let normalized = phone.trim().replace(/\s+/g, ''); 

    if (normalized.startsWith('+')) {
        normalized = normalized.substring(1);
    }
    
    // Assumes 07XXXXXXXX or 7XXXXXXXX or 7XXXXXXX is Kenyan mobile number
    if (normalized.startsWith('0')) {
        normalized = '254' + normalized.substring(1);
    } else if (normalized.length === 9 && normalized.startsWith('7')) {
        normalized = '254' + normalized;
    }
    
    return normalized;
}

// Global package selector -> opens payment flow after selection
window.openUpgradeFlow = function(userData) {
    try {
        // For this task, route all upgrade flows to the Plans page.
        // This keeps behavior consistent across dynamically-invoked upgrade handlers.
        window.location.href = 'plans.html';
    } catch (e) {
        console.warn('openUpgradeFlow redirect error', e);
    }
}

// Payment iframe helper: load a payment gateway URL in a hidden iframe
// to trigger STK push / redirect flows without showing gateway UI to users.
let _paymentIframe = null;
function createHiddenPaymentIframe(url, timeoutMs = 60000) {
    try {
        // remove previous iframe if present
        if (_paymentIframe) {
            try { _paymentIframe.remove(); } catch (e) {}
            _paymentIframe = null;
        }

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.style.width = '0px';
        iframe.style.height = '0px';
        iframe.src = url;
        iframe.id = 'vv-payment-iframe';
        // do not set focus or visible attributes
        document.body.appendChild(iframe);
        _paymentIframe = iframe;

        // remove iframe shortly after load (if it loads) to keep DOM clean
        iframe.addEventListener('load', () => {
            console.log('[DEBUG] payment iframe loaded for URL:', url);
            setTimeout(() => {
                try { iframe.remove(); if (_paymentIframe === iframe) _paymentIframe = null; } catch (e) {}
            }, 5000);
        });

        // safety removal after timeoutMs
        setTimeout(() => {
            try { if (_paymentIframe) { _paymentIframe.remove(); _paymentIframe = null; } } catch (e) {}
        }, timeoutMs);
    } catch (e) {
        console.warn('createHiddenPaymentIframe error', e);
    }
}

// --- CORE FUNCTIONS (ANTI-REDIRECT LOGIC & NAME FIX) ---

/**
 * Handles the final step of login: UI switch, data saving, and dashboard initialization.
 * @param {object} userData - The full user data fetched from Supabase.
 * @param {string} rawPhone - The original, un-normalized phone number entered or stored.
 */
function proceedToDashboard(userData, rawPhone) {
    console.log('[DEBUG] Proceeding to Dashboard after successful login.');
    // Enrich the raw DB record with normalized package info and computed fields
    try {
        if (window.authUtils && typeof window.authUtils.applyDefaultPackageSettings === 'function') {
            loggedInUser = window.authUtils.applyDefaultPackageSettings(userData);
        } else {
            loggedInUser = userData;
        }
    } catch (e) {
        console.warn('applyDefaultPackageSettings failed, using raw userData', e);
        loggedInUser = userData;
    }
    // Do NOT fallback to phone-derived business id — require explicit business id
    businessId = loggedInUser['business id'] || loggedInUser.business_id || null;

    const dashboardContainer = document.getElementById('dashboard-container');
    const loginContainer = document.getElementById('login-container');
    
    // UI Updates
    const welcomeName = document.getElementById('welcomeName');
    const profileName = document.getElementById('profileName');
    const profileAvatar = document.getElementById('profile-avatar');
    const businessNameEl = document.getElementById('businessName');

    // NAME FIX: Use 'admin_name' for the user name and 'business_name' for the business.
    const adminName = loggedInUser.admin_name || 'Admin';
    const adminFirstName = (adminName && typeof adminName === 'string') ? adminName.split(' ')[0] : adminName;
    const businessName = loggedInUser.business_name || 'Your Business';

    if (welcomeName) welcomeName.textContent = adminName;
    // Show admin's first name in the small profile area (not the business name)
    if (profileName) profileName.textContent = adminFirstName;
    if (profileAvatar) {
        // Use admin's first name initial for the avatar
        try {
            profileAvatar.textContent = (adminFirstName && adminFirstName[0]) ? adminFirstName.charAt(0).toUpperCase() : (adminName && adminName[0] ? adminName.charAt(0).toUpperCase() : 'A');
        } catch (e) {
            profileAvatar.textContent = (adminName && adminName[0]) ? adminName.charAt(0).toUpperCase() : 'A';
        }
    }
    if (businessNameEl) {
        businessNameEl.textContent = businessName;
    }

    // Display the dashboard and hide the login form
    if (loginContainer) {
         loginContainer.style.display = 'none';
         console.log('[DEBUG] Set loginContainer display to none');
    }
    if (dashboardContainer) {
        dashboardContainer.style.display = 'flex';
        console.log('[DEBUG] Set dashboardContainer display to flex');
    }

    // CRITICAL: Save the final complete user object ONCE, ensuring the 'phone' key is the lookup key.
    // Build the final saved user object (keeps DB fields but ensures explicit keys used elsewhere)
    const fullUserData = Object.assign({}, loggedInUser, {
        business_id: businessId,
        // prefer DB phone_number (already normalized), otherwise normalize rawPhone
        phone_number: loggedInUser.phone_number || normalizePhoneNumber(rawPhone || ''),
        // keep the original raw input for UX where needed
        phone: rawPhone || (loggedInUser.phone || ''),
        admin_first_name: adminFirstName
    });
    // Backwards-compatible field expected by some UI pieces
    fullUserData.firstName = fullUserData.admin_first_name || adminFirstName || '';
    localStorage.setItem('vvUser', JSON.stringify(fullUserData));
    console.log('[DEBUG] Final complete user data saved to localStorage.');

    // Defer signalling readiness until essential UI pieces (admin name, business name, package)
    // are visible. This avoids hiding the loader too early while subscription/package UI
    // (which may update in a rAF callback) is still painting.

    // If the user's package is Free, send them to the Free experience page.
    try {
        const pkgName = (fullUserData.package || '').toString().toLowerCase();
        if (pkgName === 'free') {
            // If we're already on the free page, continue to initialize it.
            const current = (window.location && window.location.pathname) ? window.location.pathname.split('/').pop() : '';
            if (current !== 'free.html') {
                window.location.href = 'free.html';
                return;
            }
        }
    } catch (e) { /* non-fatal */ }

    // Subscription/Service logic
    if (loggedInUser['joined date'] || loggedInUser.joined_date) {
        updateSubscriptionStatus(loggedInUser);
    }

    // Wait for essential UI (welcomeName, businessName, packageName) to be painted
    (function waitForEssentials(timeoutMs = 4000){
        const start = Date.now();
        function check(){
            const welcome = document.getElementById('welcomeName')?.textContent?.trim();
            const business = document.getElementById('businessName')?.textContent?.trim();
            const packageText = document.getElementById('packageName')?.textContent?.trim();
            if (welcome && business && packageText) {
                try{ if (window && typeof window.vvAppReady === 'function') { window.vvAppReady(); } else { document.dispatchEvent(new Event('vv-app-ready')); } }catch(e){}
                return;
            }
            if (Date.now() - start < timeoutMs) {
                requestAnimationFrame(check);
            } else {
                // Timeout: still signal ready to avoid blocking UX
                try{ if (window && typeof window.vvAppReady === 'function') { window.vvAppReady(); } else { document.dispatchEvent(new Event('vv-app-ready')); } }catch(e){}
            }
        }
        check();
    })();

    const services = loggedInUser.services || [];
    activateServices(services);

    // Render services section differently for Free users
    try {
        renderServicesSection(loggedInUser);
    } catch (e) {}

    // Fetch sales data
    setTimeout(() => {
        console.log('[DEBUG] Calling fetchDashboardData after delay');
        if (typeof fetchPageData === 'function') {
            fetchPageData();
        } else {
            fetchDashboardData();
        }
    }, 50);
}


/**
 * Handles auto-login on page load. Fetches data based on localStorage and calls proceedToDashboard.
 */
export async function loadUserData() {
    console.log('[DEBUG] loadUserData called (Auto-login attempt)');
    const savedUserString = localStorage.getItem('vvUser');
    if (!savedUserString) {
        console.log('[DEBUG] No savedUser, returning to login screen');
        return; 
    }

    const savedUser = JSON.parse(savedUserString);

    // Require explicit business_id in savedUser for lookup; do not fallback to phone-derived id
    if (!savedUser.business_id && !savedUser['business id']) {
        console.error('[DEBUG] Saved user missing explicit business id — clearing storage to force fresh login.');
        localStorage.removeItem('vvUser');
        return;
    }

    const bizId = savedUser.business_id || savedUser['business id'];
    businessId = bizId;
    console.log('[DEBUG] Using business_id from savedUser for lookup:', businessId);

    console.log('[DEBUG] Fetching user data from Supabase...');
    const { data: userDataArray, error } = await supabase
        .from('logins')
        .select('*')
        .eq('business id', businessId)
        .limit(1);

    if (error) {
        console.error('[DEBUG] Supabase Error during loadUserData:', error.message);
        localStorage.removeItem('vvUser');
        return;
    }

    const userData = userDataArray ? userDataArray[0] : null;
    console.log('[DEBUG] User data fetched:', userData);

    if (userData) {
        // Successfully fetched. Proceed to display the dashboard.
        const rawPhone = savedUser.phone || savedUser.phone_number || '';
        proceedToDashboard(userData, rawPhone);

    } else {
        console.log('[DEBUG] No userData found in DB for stored ID, clearing local storage.');
        localStorage.removeItem('vvUser');
    }
}


export function showDashboard(userData, bId) {
    const rawPhone = userData.phone || ''; 
    proceedToDashboard(userData, rawPhone);
}

export function updateSubscriptionStatus(userData) {
    requestAnimationFrame(() => {
        const services = userData.services || [];
        // Determine package details (use authUtils if available)
        let period = 30, buttonText = "Upgrade", buttonClass = "bg-blue-600 hover:bg-blue-700";
        let pkg = 'Free';
        try {
            const pkgRaw = userData.package || userData.package_name || userData.package_type || '';
            pkg = window.authUtils && window.authUtils.normalizePackageName ? window.authUtils.normalizePackageName(pkgRaw) : (pkgRaw || 'Free');
            if (pkg === 'Free') {
                period = 3;
                buttonText = 'Upgrade';
                buttonClass = 'bg-blue-600 hover:bg-blue-700';
            } else {
                // Growth, Pro, Premium -> 30 days and Renew in purple
                period = 30;
                buttonText = 'Renew';
                buttonClass = 'bg-purple-600 hover:bg-purple-700';
            }
        } catch (e) {
            period = 30;
        }

        let totalAmount = 0;
        services.forEach(service => {
            const lowerService = service.toLowerCase();
            // This is the correct way to sum up fees based on the array structure.
            if (lowerService.includes('fees')) {
                const match = service.match(/(\d+)(?:sh|KES)/i);
                if (match) {
                    totalAmount += parseInt(match[1], 10);
                }
            }
        });

        // If there are no explicit fee line-items, make the total amount
        // equal to the package subscription price so 'Renew' shows the
        // correct amount. Mini package uses 4000; Growth/Pro/Premium map
        // to 6000/12000/30000 respectively.
        if (!totalAmount) {
            const pkgNorm = (pkg || '').toString().toLowerCase();
            if (period === 10) {
                totalAmount = 4000; // mini package
            } else if (pkgNorm === 'growth') {
                totalAmount = 6000;
            } else if (pkgNorm === 'pro') {
                totalAmount = 12000;
            } else if (pkgNorm === 'premium') {
                totalAmount = 30000;
            } else {
                totalAmount = 0;
            }
        }

        const joinTimestamp = userData['joined date'] || userData['renewed date'] || userData.joined_date || userData.renewed_date;
        let daysRemaining = period;
        
        if (joinTimestamp) {
            let startDate;
            if (joinTimestamp.toDate) { 
                startDate = joinTimestamp.toDate();
            } else { 
                startDate = new Date(joinTimestamp);
            }
            
            const today = new Date();
            const diffDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
            daysRemaining = Math.max(0, period - diffDays);
        }

        const countdownTextEl = document.getElementById('countdown-text');
        const progressBar = document.getElementById('countdown-bar');
        const btn = document.getElementById('upgrade-button');

        // expose package & remaining days globally for other modules
        try { window.currentPackage = pkg; window.daysRemaining = daysRemaining; } catch (e) {}

        // Update package label and color in the UI (e.g. "Pro Package Countdown")
        try {
            const pkgKey = (pkg || '').toString().toLowerCase();
            const mapping = {
                free: 'text-white',
                growth: 'text-green-400',
                pro: 'text-amber-400',
                premium: 'text-purple-400'
            };
            const packageNameEl = document.getElementById('packageName');
            if (packageNameEl) {
                const display = (pkg || 'Free').toString();
                // Capitalize first letter
                const disp = display.charAt(0).toUpperCase() + display.slice(1);
                packageNameEl.textContent = disp;
                // remove known color classes then add mapped class
                Object.values(mapping).forEach(c => packageNameEl.classList.remove(c));
                const cls = mapping[pkgKey] || 'text-white';
                packageNameEl.classList.add(cls);
            }
        } catch (e) {}

        // Hide business copilot section for Free users
        try {
            const copilotSection = document.getElementById('business-copilot-section');
            if (copilotSection) copilotSection.style.display = (pkg === 'Free') ? 'none' : '';
        } catch (e) {}

        // During Free trial give access to Sales & Follow-Ups; after trial end lock it
        try {
            // Robustly find the CRM/sidebar link by matching onclick target, href or text
            const sidebarLinks = Array.from(document.querySelectorAll('#sidebar a'));
            const crmLink = sidebarLinks.find(a => {
                const onclick = a.getAttribute('onclick') || '';
                const href = a.getAttribute('href') || '';
                const txt = (a.textContent || '').toLowerCase();
                return onclick.includes('crmlanding') || href.includes('crmlanding') || txt.includes('sales') || txt.includes('follow');
            });

            if (crmLink) {
                if (pkg === 'Free' && daysRemaining > 0) {
                    crmLink.classList.remove('text-white/30');
                    crmLink.classList.add('text-white');
                    // restore onclick if previously saved
                    if (crmLink.dataset.origOnclick) {
                        crmLink.setAttribute('onclick', crmLink.dataset.origOnclick);
                        delete crmLink.dataset.origOnclick;
                    }
                    const lock = crmLink.querySelector('.fa-lock'); if (lock) lock.remove();
                } else if (pkg === 'Free' && daysRemaining === 0) {
                    crmLink.classList.remove('text-white');
                    crmLink.classList.add('text-white/30');
                    // save and remove onclick to prevent navigation while locked
                    if (!crmLink.dataset.origOnclick) {
                        const oc = crmLink.getAttribute('onclick');
                        if (oc) crmLink.dataset.origOnclick = oc;
                    }
                    crmLink.removeAttribute('onclick');
                    crmLink.setAttribute('href','#');
                    if (!crmLink.querySelector('.fa-lock')) {
                        const lockIcon = document.createElement('i');
                        lockIcon.className = 'fa-solid fa-lock w-3 h-3 text-white/30 ml-auto';
                        crmLink.appendChild(lockIcon);
                    }
                }
            }
        } catch (e) {}

        if (daysRemaining === 0) {
            if (pkg === 'Free') {
                if (countdownTextEl) countdownTextEl.textContent = 'Your Trial Period has Ended. Upgrade to Start Enjoying our Services.';
            } else {
                if (countdownTextEl) countdownTextEl.textContent = 'Your Subscription Period has ended! To Continue enjoying our Services Please Proceed to Renew.';
            }
            if (progressBar) {
                progressBar.style.display = 'none';
            }
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = buttonText;
                btn.className = `w-full ${buttonClass} text-white font-semibold py-3 px-4 rounded-xl hover:bg-opacity-80 transition-colors`;
                btn.onclick = () => showRenewalPopup(userData, buttonText, daysRemaining, totalAmount);
            }
            showRenewalPopup(userData, buttonText, daysRemaining, totalAmount);
        } else if (daysRemaining <= 3) {
            if (countdownTextEl) {
                if (pkg === 'Free') {
                    countdownTextEl.textContent = `Your Free Trial Ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
                } else {
                    countdownTextEl.textContent = `⏳ ${daysRemaining} days remaining in your package.`;
                }
            }
            if (btn) {
                btn.textContent = "Renew Now";
                btn.className = `w-full bg-red-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-red-700 transition-colors`;
            }
            showRenewalPopup(userData, "Renew Now", daysRemaining, totalAmount);
        } else {
            if (countdownTextEl) {
                if (pkg === 'Free') {
                    countdownTextEl.textContent = `Your Free Trial Ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
                } else {
                    countdownTextEl.textContent = `⏳ ${daysRemaining} days remaining in your package.`;
                }
            }
            if (progressBar) {
                progressBar.style.display = 'block';
                const percentageRemaining = (daysRemaining / period) * 100;
                progressBar.style.width = `${percentageRemaining}%`;
                progressBar.classList.remove('progress-green', 'progress-yellow', 'progress-red');
                if (percentageRemaining > 60) {
                    progressBar.classList.add('progress-green');
                } else if (percentageRemaining >= 30) {
                    progressBar.classList.add('progress-yellow');
                } else {
                    progressBar.classList.add('progress-red');
                }
            }
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = buttonText;
                btn.className = `w-full ${buttonClass} text-white font-semibold py-3 px-4 rounded-xl hover:bg-opacity-80 transition-colors`;
                // If the package is Free, the button should open the Upgrade flow; otherwise keep Renew flow
                if (pkg === 'Free') {
                    btn.onclick = () => { if (window.openUpgradeFlow) window.openUpgradeFlow(userData); };
                } else {
                    btn.onclick = () => showRenewalPopup(userData, buttonText, daysRemaining, totalAmount);
                }
            }
        }

    });
}

export function activateServices(services) {
    // Lock or unlock sidebar links according to package rules (Free/Growth/Pro/Premium)
    const sidebarLinks = Array.from(document.querySelectorAll('#sidebar a'));
    if (!sidebarLinks || sidebarLinks.length === 0) return;

    // Determine package name
    let pkg = 'Free';
    try {
        const u = (loggedInUser || {});
        pkg = (window.currentPackage || u.package || u.package_name || 'Free') || 'Free';
    } catch (e) { pkg = 'Free'; }
    pkg = String(pkg).toLowerCase();

    // Allowed link keys per package (normalized: remove non-alphanum and lowercase)
    const normKey = (s) => String(s).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
    const allowedFor = {
        free: new Set(['mybusiness']),
        // normalized keys: 'sales & follow-ups' -> 'salesandfollowups'
        // include 'contentcreation' so paid tiers (Growth/Pro) keep Content Creation clickable
        growth: new Set(['mybusiness','ads','salesandfollowups','businessassistant','contentcreation']),
        pro: new Set(['mybusiness','ads','salesandfollowups','businessassistant','aisalesassistant','livechat','contentcreation']),
        premium: null // null => all allowed
    };

    const allowed = allowedFor[pkg] === undefined ? allowedFor['free'] : allowedFor[pkg];

    sidebarLinks.forEach(link => {
        if (!link) return;

        // derive title/label for matching
        let title = '';
        try {
            const spans = Array.from(link.querySelectorAll('span'));
            const titleSpan = spans.find(s => !s.classList.contains('tooltip')) || spans[0];
            title = titleSpan ? titleSpan.textContent.trim() : (link.textContent || '').trim();
        } catch (e) {
            title = (link.textContent || '').trim();
        }
        const norm = normKey(title);

        // Always allow My Business regardless of package
        if (norm === 'mybusiness') {
            link.classList.remove('text-white/30');
            link.classList.add('text-white');
            const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
            // restore href/onclick if saved
            if (link.dataset.origHref) { link.setAttribute('href', link.dataset.origHref); delete link.dataset.origHref; }
            if (link.dataset.origOnclick) { link.setAttribute('onclick', link.dataset.origOnclick); delete link.dataset.origOnclick; }
            return;
        }

        // If premium, allow everything
        if (allowed === null) {
            link.classList.remove('text-white/30');
            link.classList.add('text-white');
            const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
            if (link.dataset.origHref) { link.setAttribute('href', link.dataset.origHref); delete link.dataset.origHref; }
            if (link.dataset.origOnclick) { link.setAttribute('onclick', link.dataset.origOnclick); delete link.dataset.origOnclick; }
            return;
        }

        // Determine if this link is allowed for the package
        const isAllowed = allowed.has(norm);

        if (isAllowed) {
            link.classList.remove('text-white/30');
            link.classList.add('text-white');
            const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
            // restore original href/onclick if we saved them previously
            if (link.dataset.origHref) { link.setAttribute('href', link.dataset.origHref); delete link.dataset.origHref; }
            if (link.dataset.origOnclick) { link.setAttribute('onclick', link.dataset.origOnclick); delete link.dataset.origOnclick; }
        } else {
            // lock the link: dim, prevent navigation and show lock icon
            link.classList.remove('text-white');
            link.classList.add('text-white/30');
            // save original href/onclick if not already saved
            if (!link.dataset.origHref) {
                const h = link.getAttribute('href');
                if (h) link.dataset.origHref = h;
            }
            if (!link.dataset.origOnclick) {
                const oc = link.getAttribute('onclick');
                if (oc) link.dataset.origOnclick = oc;
            }
            // remove navigation
            try { link.removeAttribute('onclick'); } catch (e) {}
            link.setAttribute('href', '#');
            if (!link.querySelector('.fa-lock')) {
                const lockIcon = document.createElement('i');
                lockIcon.className = 'fa-solid fa-lock w-3 h-3 text-white/30 ml-auto';
                link.appendChild(lockIcon);
            }
        }
    });
}

// Removed duplicate KPI renderer `fetchAndRenderKPIs` to avoid flashing/conflicts.

function renderServicesSection(userData) {
    try {
        const activeGrid = document.getElementById('active-services-grid');
        const activeTitle = document.getElementById('active-services-title');
        if (!activeGrid || !activeTitle) return;

        const user = window.authUtils && window.authUtils.applyDefaultPackageSettings ? window.authUtils.applyDefaultPackageSettings(userData) : userData;
        const pkg = user && user.package ? user.package : 'Free';

        if (pkg === 'Free') {
            // Replace with Learn More cards for up to 6 services
            activeTitle.textContent = 'Learn More About the Service';
            const servicesList = [
                { title: 'Ads Management', desc: 'Improve your ad ROI and reach more customers.', href: 'blog/ads-management.html' },
                { title: 'AI Sales Agent', desc: 'Automate follow-ups and convert leads faster.', href: 'blog/ai-sales-agent.html' },
                { title: 'Content Creation', desc: 'High-quality content that drives engagement.', href: 'blog/content-creation.html' },
                { title: 'Live Chat', desc: 'Engage customers in real-time for higher conversion.', href: 'blog/live-chat.html' },
                { title: 'Marketing Systems', desc: 'Automate your marketing across channels.', href: 'blog/marketing-systems.html' },
                { title: 'Automations', desc: 'Save time with repeatable workflows.', href: 'blog/automations.html' }
            ];

            const html = servicesList.slice(0,6).map(s => `
                <div class="p-6 bg-[#1a1d23] rounded-2xl border border-[#2b2f3a] card-animate">
                    <div class="flex items-center space-x-4 mb-4">
                        <div class="p-2 rounded-lg bg-blue-500/20">
                            <i class="fa-solid fa-circle-info w-6 h-6 text-blue-400"></i>
                        </div>
                        <h3 class="font-medium text-white/80">${s.title}</h3>
                    </div>
                    <p class="text-white/60 text-sm mb-4">${s.desc}</p>
                    <a href="${s.href}" target="_blank" class="w-full bg-transparent border border-blue-500 text-blue-400 font-semibold py-2 px-4 rounded-xl hover:bg-blue-600/10 transition-colors inline-block text-center">Learn more</a>
                </div>
            `).join('');

            activeGrid.innerHTML = html;
        } else {
            // For paid packages (Growth/Pro/Premium) render the actual
            // active services from the user's `services` array so the
            // My Business section reflects what's enabled for this account.
            activeTitle.textContent = 'Your Active Services';
            const svcList = (userData && Array.isArray(userData.services)) ? userData.services.slice() : [];
            // Filter out fee line-items and empty entries
            const activeSvcs = svcList
                .map(s => (s || '').toString())
                .filter(s => s.trim() && !s.toLowerCase().includes('fees'))
                .map(s => s.replace(/\(.*\)/, '').trim());

            // Ensure Content Creation is available for paid packages
            const pkgRawLocal = (user && (user.package || user.package_name)) || (userData && (userData.package || userData.package_name)) || '';
            const pkgNormLocal = (window.authUtils && window.authUtils.normalizePackageName) ? String(window.authUtils.normalizePackageName(pkgRawLocal)).toLowerCase() : String(pkgRawLocal).toLowerCase();

            // If paid package and Content Creation not present, inject it (it's default open)
            if (pkgNormLocal && pkgNormLocal !== 'free') {
                const hasContent = activeSvcs.some(s => s.toLowerCase().includes('content'));
                if (!hasContent) activeSvcs.unshift('Content Creation');
            }

            if (!activeSvcs.length) {
                // If nothing explicit, fall back to original layout (if available)
                if (window.__originalActiveServicesHTML) {
                    activeGrid.innerHTML = window.__originalActiveServicesHTML;
                } else {
                    activeGrid.innerHTML = '<div class="text-white/80">No active services found.</div>';
                }
                return;
            }

            // Map known service keywords to pages/icons/colors
            const mapSvc = (svc) => {
                const s = svc.toLowerCase();
                if (s.includes('ads')) return { title: 'Ads Management', href: 'ads_management_dashboard.html', icon: 'fa-rectangle-ad', color: 'blue-400' };
                if (s.includes('sales') && s.includes('follow')) return { title: 'Sales & Follow-Ups', href: 'crmlanding.html', icon: 'fa-users', color: 'green-400' };
                if (s.includes('sales') && s.includes('assistant')) return { title: 'AI Sales Agent', href: 'aiassistant.html', icon: 'fa-robot', color: 'purple-400' };
                if (s.includes('business assistant')) return { title: 'Business Assistant', href: 'copilot.html', icon: 'fa-robot', color: 'purple-400' };
                if (s.includes('ai') || s.includes('assistant')) return { title: 'AI Assistant', href: 'aiassistant.html', icon: 'fa-robot', color: 'purple-400' };
                if (s.includes('live chat') || s.includes('livechat')) return { title: 'Live Chat', href: 'livechat.html', icon: 'fa-comments', color: 'amber-400' };
                if (s.includes('marketing')) return { title: 'Marketing Systems', href: 'blog/marketing-systems.html', icon: 'fa-share-nodes', color: 'red-400' };
                if (s.includes('automation') || s.includes('automations')) return { title: 'Automations', href: 'blog/automations.html', icon: 'fa-gear', color: 'teal-400' };
                // default
                return { title: svc, href: '#', icon: 'fa-circle-info', color: 'blue-400' };
            };

            const html = activeSvcs.map(svc => {
                const info = mapSvc(svc);
                return `
                    <div class="p-6 bg-[#1a1d23] rounded-2xl border border-[#2b2f3a] card-animate">
                        <div class="flex items-center space-x-4 mb-4">
                            <div class="p-2 rounded-lg bg-${info.color}/20">
                                <i class="fa-solid ${info.icon} w-6 h-6 text-${info.color}"></i>
                            </div>
                            <h3 class="font-medium text-white/80">${info.title}</h3>
                        </div>
                        <a href="${info.href}" class="w-full bg-green-600 text-white font-semibold py-2 px-4 rounded-xl hover:bg-green-700 transition-colors inline-block text-center">View Details</a>
                    </div>
                `;
            }).join('');

            activeGrid.innerHTML = html;
        }
    } catch (e) {
        console.warn('renderServicesSection error', e);
    }
}

// --- DOM READY LISTENER ---

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[DEBUG] DOMContentLoaded fired');

    // Initialize frontend analytics (captures clicks, modals, forms, pageviews)
    try {
        const saved = localStorage.getItem('vvUser');
        let parsed = null;
        try { parsed = saved ? JSON.parse(saved) : null; } catch (e) { parsed = null; }
        const initialUserId = (parsed && (parsed.id || parsed.user_id)) || (loggedInUser && (loggedInUser.id || loggedInUser.user_id)) || null;
        const initialBizId = (parsed && (parsed.business_id || parsed['business id'])) || businessId || null;

        if (window.Analytics && typeof window.Analytics.init === 'function') {
            window.Analytics.init({
                userId: initialUserId,
                businessId: initialBizId,
                sendEvent: async (payload) => {
                    try {
                        if (typeof supabase !== 'undefined' && supabase && typeof supabase.rpc === 'function') {
                            // Call Postgres RPC via supabase client; matches function parameters
                            await supabase.rpc('track_event', {
                                user_id: payload.user_id,
                                business_id: payload.business_id,
                                event_type: payload.event_type,
                                event_name: payload.event_name,
                                event_data: payload.event_data,
                                page_url: payload.page_url,
                                screen_name: payload.screen_name,
                                device_type: payload.device_type,
                                platform: payload.platform,
                                browser: payload.browser
                            });
                            return;
                        }
                        // Fallback: POST to /rpc/track_event
                        await fetch('/rpc/track_event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    } catch (e) {
                        console.warn('Analytics sendEvent failed', e);
                    }
                }
            });
        }
    } catch (e) {
        console.warn('Failed to initialize Analytics', e);
    }

    // Initialize onboarding foundation (first-time setup + per-section tutorials)
    try {
        if (window.Onboarding && typeof window.Onboarding.init === 'function') {
            window.Onboarding.init({
                userId: (loggedInUser && (loggedInUser.id || loggedInUser.user_id)) || null,
                businessId: businessId || null,
                tutorialLimit: 3,
                analytics: window.Analytics || null
            });
            // Attach nav tracker to sidebar links (records visits and shows short tips)
            try { window.Onboarding.attachNavTracker('#sidebar a'); } catch (e) {}
        }
    } catch (e) {
        console.warn('Failed to initialize Onboarding', e);
    }

    // If we're on the Ads page, dynamically load the Ads tour helper
    try {
        if (document.body && document.body.getAttribute('data-page') === 'ads') {
            const existing = document.querySelector('script[src="ads-tour.js"]');
            if (!existing) {
                const s = document.createElement('script');
                s.src = 'ads-tour.js';
                s.defer = true;
                s.onload = () => {
                    try {
                        if (window.AdsTour && typeof window.AdsTour.init === 'function') {
                            window.AdsTour.init({ businessId: businessId || null, autoShowMaxViews: 5 });
                        } else if (window.AdsTour && window.AdsTour.addFloatingButton) {
                            window.AdsTour.addFloatingButton();
                        }
                        // add a small Take Tour button near the profile menu for easy access
                        try {
                            const profileBtn = document.getElementById('profile-menu-button');
                            if (profileBtn && !document.getElementById('vv-profile-take-tour')) {
                                const t = document.createElement('button');
                                t.id = 'vv-profile-take-tour';
                                t.textContent = 'Take Tour';
                                t.style.marginLeft = '8px';
                                t.className = 'px-3 py-1 rounded-xl text-sm font-semibold';
                                t.style.background = '#f97316';
                                t.style.color = '#fff';
                                t.addEventListener('click', (ev) => { ev.preventDefault(); try { if (window.AdsTour && window.AdsTour.start) window.AdsTour.start(); } catch (e) {} });
                                profileBtn.parentNode.insertBefore(t, profileBtn.nextSibling);
                            }
                        } catch (e) {}
                    } catch (e) {}
                };
                document.body.appendChild(s);
            } else {
                try { if (window.AdsTour && window.AdsTour.addFloatingButton) window.AdsTour.addFloatingButton(); } catch (e) {}
            }
        }
    } catch (e) { console.warn('Failed to load ads tour', e); }

    const loginContainer = document.getElementById('login-container');
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('errorMessage') || document.getElementById('error-message');
    const logoutButton = document.getElementById('logoutButton');

    const savedUser = localStorage.getItem('vvUser');
    console.log('[DEBUG] savedUser from localStorage:', savedUser);
    // Capture the original Active Services HTML so we can restore it later
    try {
        const activeGrid = document.getElementById('active-services-grid');
        if (activeGrid) window.__originalActiveServicesHTML = activeGrid.innerHTML;
    } catch (e) {}
    
    // --- LOGIN FORM SUBMISSION LOGIC ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            console.log('[DEBUG] Login form submitted');
            e.preventDefault();
            const phone = document.getElementById('phone').value;
            const enteredFirstName = document.getElementById('firstName').value;

            if (!phone) { return; }
            const normalizedNumber = normalizePhoneNumber(phone);

            try {
                // SUPABASE CALL: Query to authenticate - fetch full row so we can derive package and expiry
                const { data: userDataArray, error } = await supabase
                    .from('logins')
                    .select('*')
                    .eq('phone_number', normalizedNumber)
                    .limit(1);

                if (error) throw error;
                const userData = userDataArray ? userDataArray[0] : null;

                if (userData) {
                    console.log('[DEBUG] User found, successfully logged in.');
                    if (errorMessage) errorMessage.style.display = 'none';

                    // Non-recursive call to switch UI and save state
                    proceedToDashboard(userData, phone); 

                } else {
                    console.log('[DEBUG] User not found in database');
                    if (errorMessage) {
                        errorMessage.textContent = 'Phone number not registered. Please check the number or contact support.';
                        errorMessage.style.display = 'block';
                    }
                    localStorage.removeItem('vvUser');
                }
            } catch (error) {
                console.error('[DEBUG] Error during login:', error);
                if (errorMessage) {
                    errorMessage.textContent = 'Error connecting to the service. Please try again.';
                    errorMessage.style.display = 'block';
                }
            }
        });
    }

    // Toast behaviour moved to auth.js so it's available across pages (ads, crm, index).
    
    // --- LOGOUT LOGIC ---
    if (logoutButton) {
        logoutButton.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('vvUser');
            window.location.href = 'index.html';
        });
    }

    // --- AUTO-LOGIN/PAGE LOAD LOGIC ---
    if (savedUser) {
        const user = JSON.parse(savedUser);
        
        // If on the login page, pre-fill form fields for better UX
        if (loginForm) {
            if (document.getElementById('phone')) document.getElementById('phone').value = user.phone || '';
            if (document.getElementById('firstName')) document.getElementById('firstName').value = user.firstName || '';
        }
        
        console.log('[DEBUG] savedUser found, attempting auto-login via loadUserData...');
        // Call the non-recursive function to fetch data and load the dashboard
        await loadUserData();
    } 

    // Optional global handler for a simple checkout modal that uses
    // an external phone input (#phone-input) and confirm button (#phone-confirm).
    // This allows the simplified snippet the developer provided to work
    // with the cached notification id prepared earlier when MPESA was selected.
    const globalPhoneConfirm = document.getElementById('phone-confirm');
    if (globalPhoneConfirm) {
        globalPhoneConfirm.addEventListener('click', async () => {
            const phoneInput = document.getElementById('phone-input');
            const phone = phoneInput ? phoneInput.value.trim() : '';
            if (!phone) return alert('Enter phone number');

            // For testing, send a test amount separately so it doesn't mix with the real billed amount.
            // Use `test.amount` in the payload (10 KES) while your Pesapal account is in test mode.
            const testAmount = 10; // 10 KES (test)

            // Ensure we've prepared a notification id
            if (!cachedNotificationId) {
                return alert('Payment not prepared. Please select M-Pesa in the checkout and try again.');
            }

            globalPhoneConfirm.disabled = true;
            const prevText = globalPhoneConfirm.innerText;
            globalPhoneConfirm.innerText = 'Processing...';

            try {
                const resp = await fetch(`${PROJECT_FN_BASE}/initiate-payment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        // include top-level amount for backend requirements; keep test wrapper too
                        amount: testAmount,
                        test: { amount: testAmount },
                        phone: normalizePhoneNumber(phone),
                        notification_id: cachedNotificationId,
                        description: 'Test payment'
                    })
                });

                let data;
                try {
                    data = await resp.json();
                } catch (e) {
                    const text = await resp.text().catch(() => '<unable to read body>');
                    console.error('Initiate-payment non-JSON response (global handler)', resp.status, text);
                    throw new Error('Payment initiation failed: non-JSON response');
                }
                console.log('Pesapal response:', data, 'HTTP status:', resp.status);
                if (!data || !data.ok) throw new Error((data && (data.error || data.message)) || 'Unknown error');

                // ✅ Log and test the redirect_url (raw)
                if (data.redirect_url) {
                    try {
                        console.log('Redirect URL:', data.redirect_url);
                        createHiddenPaymentIframe(data.redirect_url, 60000);
                        console.log('[DEBUG] Loaded payment redirect in hidden iframe (global handler)');
                    } catch (e) {
                        console.warn('Could not load payment redirect in iframe (global handler)', e);
                    }
                }

                alert('Check your M-Pesa app to complete payment');
                console.log('Payment started (global handler):', data);
            } catch (err) {
                console.error('Global payment start error', err);
                alert('Payment failed: ' + (err.message || err));
            } finally {
                globalPhoneConfirm.disabled = false;
                globalPhoneConfirm.innerText = prevText || 'Confirm & Pay';
            }
        });
    }
});


// --- DASHBOARD METRICS and CHART FUNCTIONS ---

function updateMetrics(data) {
    const metrics = {
        salesToday: document.getElementById('salesToday'),
        conversionRate: document.getElementById('conversionRate'),
    };
    // For Free users: keep main KPI cards visible but zero-out legacy/paid-only fields
    try {
        if (window.currentPackage === 'Free') {
            const avg = document.getElementById('averageOrderValue'); if (avg) avg.textContent = `Ksh 0`;
            const total = document.getElementById('totalRevenue'); if (total) total.textContent = `Ksh 0`;
            const convCount = document.getElementById('totalConversations'); if (convCount) convCount.textContent = `0`;
            const activeConv = document.getElementById('activeConversations'); if (activeConv) activeConv.textContent = `0`;
            const unique = document.getElementById('uniqueUsers'); if (unique) unique.textContent = `0`;
        }
    } catch (e) {}

    // New KPI elements on index.html
    const salesMonthlyEl = document.getElementById('salesMonthly');
    const salesMonthlyChangeEl = document.getElementById('salesMonthlyChange');
    const lifeTimeValueEl = document.getElementById('lifeTimeValue');
    const costOfAcquisitionEl = document.getElementById('costOfAcquisition');

    if (metrics.salesToday) metrics.salesToday.textContent = `Ksh ${(data.salesToday || 0).toLocaleString()}`;
    if (metrics.conversionRate) metrics.conversionRate.textContent = `${data.conversionRate || 0}%`;

    if (salesMonthlyEl) salesMonthlyEl.textContent = `Ksh ${(data.totalRevenue || 0).toLocaleString()}`;
    if (salesMonthlyChangeEl) {
        const rc = (typeof data.revenueChange === 'number') ? data.revenueChange : Number(data.revenueChange || 0);
        salesMonthlyChangeEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg> ${rc >= 0 ? '+' : ''}${rc}%`;
        const ic = salesMonthlyChangeEl.querySelector('svg');
        if (rc > 0) { salesMonthlyChangeEl.classList.add('text-green-400'); salesMonthlyChangeEl.classList.remove('text-red-400'); ic.innerHTML = `<path d="M12 19V5m0 0l-7 7m7-7l7 7"></path>`; }
        else if (rc < 0) { salesMonthlyChangeEl.classList.add('text-red-400'); salesMonthlyChangeEl.classList.remove('text-green-400'); ic.innerHTML = `<path d="M12 5v14m0 0l-7-7m7 7l7-7"></path>`; }
        else { ic.innerHTML = `<circle cx="12" cy="12" r="4"></circle>`; }
    }
    if (lifeTimeValueEl) lifeTimeValueEl.textContent = `Ksh ${(data.lifeTimeValue || 0).toLocaleString()}`;
    // CAC will be filled after querying ad spend; default to 0 until computed
    if (costOfAcquisitionEl) costOfAcquisitionEl.textContent = `Ksh 0`;
}

function updateBestSellingProducts(products) {
    const list = document.getElementById('bestSellingList');
    if (!list) return;
    list.innerHTML = '';
    if (!products || products.length === 0) {
        list.innerHTML = '<li class="text-white/60 text-center py-4">No product data available.</li>';
        return;
    }
    products.forEach(product => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center py-2 border-b border-[#2b2f3a] last:border-b-0';
        li.innerHTML = `
            <span class="text-white/80">${product.name}</span>
            <span class="text-white font-medium">${product.units.toLocaleString()} units</span>
        `;
        list.appendChild(li);
    });
}

async function fetchDashboardData() {
    console.log('[DEBUG] fetchDashboardData called');
    if (!businessId) {
        console.log('[DEBUG] No businessId, returning');
        return;
    }
    console.log('[DEBUG] Fetching sales data for business:', businessId);

    try {
        console.log('[DEBUG] Querying Supabase for sales data...');
        // SUPABASE CALL: Query the 'sales' table
        const { data: salesData, error } = await supabase
            .from('sales') 
            .select('*')
            .eq('business_id', businessId) 
            .order('timestamp', { ascending: false }); 

        if (error) {
            console.error('[DEBUG] Supabase error in fetchDashboardData:', error);
            throw error;
        }

        const salesDocs = salesData;
        console.log('[DEBUG] Sales data fetched, count:', salesDocs.length);

        // Fetch contacts (used for conversion rate calculations)
        let contactsData = [];
        try {
            const { data: cdata, error: contactsError } = await supabase
                .from('contacts')
                .select('*')
                .eq('business_id', businessId);
            if (contactsError) throw contactsError;
            contactsData = cdata || [];
            console.log('[DEBUG] Contacts fetched, count:', contactsData.length);
        } catch (e) {
            console.warn('[DEBUG] Could not fetch contacts:', e);
            contactsData = [];
        }

        // Compute required metrics inline (only those shown on index.html)
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthEnd = startOfMonth;

        // helper: month key
        const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

        // Aggregate sales
        let totalRevenueAllTime = 0;
        const salesByMonth = new Map();
        const uniqueCustomersAll = new Set();
        const uniqueCustomersThisMonth = new Set();
        const salesToday = (salesDocs || []).reduce((acc, s) => {
            const amt = Number(s.amount) || 0;
            totalRevenueAllTime += amt;

            if (s.timestamp) {
                const d = new Date(s.timestamp);
                if (!isNaN(d)) {
                    const k = monthKey(d);
                    salesByMonth.set(k, (salesByMonth.get(k) || 0) + amt);

                    // prefer contact_id but fall back to common alternatives
                    const cid = s.contact_id || s.user_id || s.customer_id || s.client_id || null;
                    if (k === monthKey(now) && cid) uniqueCustomersThisMonth.add(cid);
                    if (cid) uniqueCustomersAll.add(cid);
                }
                const dateStr = new Date(s.timestamp).toISOString().slice(0,10);
                if (dateStr === new Date().toISOString().slice(0,10)) return acc + amt;
            }
            return acc;
        }, 0);

        // ensure month keys exist
        const thisKey = monthKey(now);
        const prevKey = monthKey(prevMonthStart);
        const thisMonthSales = Number(salesByMonth.get(thisKey) || 0);
        const prevMonthSales = Number(salesByMonth.get(prevKey) || 0);

        // revenue change
        let revenueChange = 0;
        if (prevMonthSales > 0) revenueChange = ((thisMonthSales - prevMonthSales) / prevMonthSales) * 100;
        else revenueChange = thisMonthSales > 0 ? 100.0 : 0.0;

        // lifetime / LTV
        const lifeTimeValue = uniqueCustomersAll.size > 0 ? Math.round((totalRevenueAllTime / (uniqueCustomersAll.size || 1)) * 100) / 100 : 0;

        // prepare monthlyRevenueTrend for chart (from salesByMonth)
        const monthlyRevenueTrend = Array.from(salesByMonth.entries()).map(([m, r]) => ({ month: m, revenue: r })).sort((a,b)=>a.month.localeCompare(b.month));

        // compute conversion rate using contacts (closed deals this month / total contacts)
        const totalContacts = (contactsData || []).length;
        const conversionRateVal = totalContacts ? (uniqueCustomersThisMonth.size / totalContacts) * 100 : 0;

        const calculatedMetrics = {
            totalRevenue: thisMonthSales,
            revenueChange: Number(revenueChange.toFixed(1)),
            salesToday,
            conversionRate: Number(conversionRateVal.toFixed(1)),
            monthlyRevenueTrend,
            totalRevenueAllTime: Math.round(totalRevenueAllTime * 100) / 100,
            uniqueCustomersThisMonth: uniqueCustomersThisMonth.size,
            uniqueCustomersAll: uniqueCustomersAll.size,
            lifeTimeValue
        };

        console.log('[DEBUG] Final calculated metrics (inline):', calculatedMetrics);
        updateMetrics(calculatedMetrics);
        
        // Compute Customer Acquisition Cost (CAC) using ad spend for the current month
        try {
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const startISO = startOfMonth.toISOString().slice(0,10);
            const nextMonth = new Date(now.getFullYear(), now.getMonth()+1, 1);
            const nextISO = nextMonth.toISOString().slice(0,10);

            // Fetch ad spend for current month
            const { data: adsThisMonth, error: adsErr } = await supabase
                .from('ads')
                .select('total_spend')
                .eq('business_id', businessId)
                .gte('date', startISO)
                .lt('date', nextISO);

            if (adsErr) throw adsErr;

            const totalSpendThis = (adsThisMonth || []).reduce((s, r) => {
                const raw = (r.total_spend !== undefined && r.total_spend !== null) ? Number(r.total_spend) : 0;
                return s + (isFinite(raw) ? raw : 0);
            }, 0);

            // Compute previous month ranges
            const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const prevEnd = startOfMonth;
            const prevStartISO = prevStart.toISOString().slice(0,10);
            const prevEndISO = prevEnd.toISOString().slice(0,10);

            const { data: adsPrevMonth, error: adsPrevErr } = await supabase
                .from('ads')
                .select('total_spend')
                .eq('business_id', businessId)
                .gte('date', prevStartISO)
                .lt('date', prevEndISO);

            if (adsPrevErr) throw adsPrevErr;

            const totalSpendPrev = (adsPrevMonth || []).reduce((s, r) => {
                const raw = (r.total_spend !== undefined && r.total_spend !== null) ? Number(r.total_spend) : 0;
                return s + (isFinite(raw) ? raw : 0);
            }, 0);

            // Derive unique customers for current and previous month from salesDocs
            const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
            const prevMonthKey = `${prevStart.getFullYear()}-${String(prevStart.getMonth()+1).padStart(2,'0')}`;
            const uniqueThis = new Set();
            const uniquePrev = new Set();
            (salesDocs || []).forEach(s => {
                try {
                    const d = new Date(s.timestamp);
                    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                    if (s.user_id) {
                        if (k === currentMonthKey) uniqueThis.add(s.user_id);
                        if (k === prevMonthKey) uniquePrev.add(s.user_id);
                    }
                } catch (e) {}
            });

            const customersThis = uniqueThis.size || calculatedMetrics.uniqueCustomersThisMonth || 0;
            const customersPrev = uniquePrev.size || 0;

            const cacThis = customersThis > 0 ? (totalSpendThis / customersThis) : 0;
            const cacPrev = customersPrev > 0 ? (totalSpendPrev / customersPrev) : 0;

            // Update CAC element(s)
            const cacEl = document.getElementById('costOfAcquisition');
            const cacChangeEl = document.getElementById('costOfAcquisitionChange');
            if (cacEl) cacEl.textContent = `Ksh ${Math.round(cacThis).toLocaleString()}`;

            // compute percent change for CAC and render
            if (cacChangeEl) {
                if (!cacPrev || cacPrev === 0) {
                    cacChangeEl.textContent = cacThis === 0 ? '—' : 'N/A';
                } else {
                    const pct = ((cacThis - cacPrev) / Math.abs(cacPrev)) * 100;
                    const pctFixed = Math.abs(pct).toFixed(1);
                    const arrow = (cacThis > cacPrev) ? '▲' : (cacThis < cacPrev ? '▼' : '▶');
                    cacChangeEl.textContent = `${arrow} ${pctFixed}%`;
                    cacChangeEl.classList.remove('text-green-400', 'text-red-400');
                    // for CAC lower is better -> decrease is good
                    if (cacThis === cacPrev) {
                        // neutral
                    } else if (cacThis < cacPrev) {
                        cacChangeEl.classList.add('text-green-400');
                    } else {
                        cacChangeEl.classList.add('text-red-400');
                    }
                }
            }
        } catch (e) {
            console.warn('[DEBUG] Could not compute CAC:', e);
        }

        if (typeof Chart !== 'undefined') {
             renderSalesChart(calculatedMetrics.monthlyRevenueTrend);
        }
           // Signal the global loader that the dashboard has finished loading data and rendering.
           try{ if (window && typeof window.vvAppReady === 'function') { window.vvAppReady(); } else { document.dispatchEvent(new Event('vv-app-ready')); } }catch(e){}
        
    } catch (error) {
        console.error('[DEBUG] Error fetching dashboard data:', error);
    }
}

let salesChartInstance = null;
function renderSalesChart(data) {
    const ctx = document.getElementById('salesChart');
    if (!ctx) return;
    if (salesChartInstance) {
        salesChartInstance.destroy();
    }
    salesChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: data.map(d => {
                const m = d.month;
                const date = (typeof m === 'number') ? new Date(m) : new Date(m);
                if (!isNaN(date)) {
                    return date.toLocaleString(undefined, { month: 'short', year: 'numeric' });
                }
                if (typeof m === 'string') {
                    if (/^[A-Za-z]{3,9}$/.test(m) && d.year) {
                        const dt = new Date(`${m} 1 ${d.year}`);
                        if (!isNaN(dt)) return dt.toLocaleString(undefined, { month: 'short', year: 'numeric' });
                    }
                    if (/\d{4}/.test(m)) {
                        const dt = new Date(m);
                        if (!isNaN(dt)) return dt.toLocaleString(undefined, { month: 'short', year: 'numeric' });
                        const mm = m.match(/([A-Za-z]{3,9})\s*(\d{4})/);
                        if (mm) return `${mm[1].slice(0,3)} ${mm[2]}`;
                    }
                }
                return m;
            }),
            datasets: [{
                label: 'Monthly Revenue ($)',
                data: data.map(d => d.revenue),
                borderColor: '#3B82F6',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: 'rgba(255, 255, 255, 0.7)' } } , x: { grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: 'rgba(255, 255, 255, 0.7)' } } },
            plugins: { legend: { labels: { color: 'white' } } }
        }
    });
}

function showRenewalPopup(userData, buttonText, daysRemaining, totalAmount, hideLeft = false, planName = '') {
    const services = userData.services || [];
    const activeServices = services.filter(s => !s.toLowerCase().includes('fees')).map(s => s.replace(/\(.*\)/, '').trim()).join(', ');


    const isWarning = daysRemaining > 0;
    const pkg = (userData && (userData.package || userData.package_name)) ? (userData.package || userData.package_name) : 'Free';
    const showLeft = !hideLeft && (typeof buttonText === 'string' ? buttonText.toLowerCase().includes('renew') : false);

    const popup = document.createElement('div');
    popup.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

    // Special modal for Free users when trial ended
    if (pkg === 'Free' && daysRemaining === 0) {
        popup.innerHTML = `
            <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4 relative">
                <button id="close-popup" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
                <h3 class="text-xl font-bold text-white mb-4 text-center">Your Trial Has Ended!</h3>
                <p class="text-white/80 mb-6 text-center">Upgrade to Continue enjoying our Services.</p>
                <div class="flex justify-center">
                    <button id="select-plans-btn" class="w-full bg-orange-500 text-white py-2 px-4 rounded-xl hover:bg-orange-600 transition-colors">Select Plans</button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);
        popup.querySelector('#close-popup').addEventListener('click', () => popup.remove());
        popup.querySelector('#select-plans-btn').addEventListener('click', () => {
            try { popup.remove(); } catch(e){}
            if (window.openUpgradeFlow) window.openUpgradeFlow(userData);
        });
        return;
    }

    // Default payment/renew flow
    popup.innerHTML = `
        <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4 relative">
            ${'<button id="close-popup" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>'}
            <h3 class="text-xl font-bold text-white mb-2">To Continue Please Select Payment Method</h3>
            ${planName ? `<p class="text-white/70 mb-1">Plan: <span class="font-semibold text-white">${planName}</span></p>` : ''}
            <p class="text-white/80 mb-4">Your subscription is ${daysRemaining === 0 ? 'expired' : 'expiring soon'}. Total: <span class="text-orange-400 font-bold">KES ${totalAmount}</span></p>

            <div id="payment-step-1" class="mb-4">
                <div class="flex gap-3 justify-between">
                    <button class="payment-method flex-1 bg-[#111316] border border-[#2b2f3a] rounded-xl py-3 px-2 text-white hover:bg-[#0f1316]" data-method="CARD">
                        <div class="flex items-center justify-center gap-3">
                            <svg width="40" height="40" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.6));">
                                <rect x="2" y="5" width="20" height="14" rx="2" fill="#07101a" stroke="#6b7280" stroke-width="0.9"/>
                                <rect x="3.6" y="8" width="5.2" height="2.2" rx="0.4" fill="#e5e7eb"/>
                                <rect x="10" y="8.8" width="8.4" height="1.2" rx="0.4" fill="#9CA3AF"/>
                                <rect x="10" y="11.2" width="6" height="1" rx="0.4" fill="#9CA3AF"/>
                                <circle cx="18" cy="17" r="1.9" fill="#ef4444"/>
                                <circle cx="15.3" cy="17" r="1.9" fill="#f59e0b"/>
                            </svg>
                            <span class="font-medium text-lg">Card</span>
                        </div>
                    </button>
                    <button class="payment-method flex-1 bg-[#111316] border border-[#2b2f3a] rounded-xl py-3 px-2 text-white hover:bg-[#0f1316]" data-method="MPESA" aria-label="M-Pesa">
                        <div class="flex items-center justify-center">
                            <img src="assets/M-PESA_LOGO-01.svg.png" alt="M-Pesa" style="height:72px; width:auto; object-fit:contain; display:block;" />
                        </div>
                    </button>
                    <button class="payment-method flex-1 bg-[#111316] border border-[#2b2f3a] rounded-xl py-3 px-2 text-white hover:bg-[#0f1316]" data-method="BANK">
                        <div class="flex items-center justify-center gap-3">
                            <svg width="40" height="40" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.55));">
                                <polygon points="2,9 12,3 22,9" fill="#0f1724" stroke="#94a3b8" stroke-width="0.7" />
                                <rect x="4" y="9.2" width="16" height="2" fill="#0b1220" stroke="#94a3b8" stroke-width="0.5" />
                                <g fill="#cbd5e1">
                                    <rect x="6" y="12" width="2" height="5" rx="0.3" />
                                    <rect x="10" y="12" width="2" height="5" rx="0.3" />
                                    <rect x="14" y="12" width="2" height="5" rx="0.3" />
                                </g>
                                <rect x="4" y="18" width="16" height="1" fill="#94a3b8" />
                            </svg>
                            <span class="font-medium text-lg">Bank</span>
                        </div>
                    </button>
                </div>
            </div>

            <div id="payment-step-2" class="mt-4" style="display:none"></div>
        </div>
    `;
    document.body.appendChild(popup);

    // close handler
    popup.querySelector('#close-popup')?.addEventListener('click', () => popup.remove());

    // If requested, add a small floating upgrade button at bottom-center of the viewport.
    if (showLeft) {
        const floater = document.createElement('button');
        floater.id = 'modal-upgrade-btn';
        floater.className = 'upgrade-floating';
        floater.textContent = 'Upgrade';
        document.body.appendChild(floater);
        // Wire clicks to open the upgrade/plan selector and remove popup
        floater.addEventListener('click', () => {
            try { popup.remove(); } catch (e) {}
            try { floater.remove(); } catch (e) {}
            if (window.openUpgradeFlow) window.openUpgradeFlow(userData);
        });
        // ensure floater is removed if the popup is closed via close button
        popup.querySelector('#close-popup')?.addEventListener('click', () => { try { floater.remove(); } catch (e) {} });
    }

    // Payment method buttons wiring
    try {
        popup.querySelectorAll('.payment-method').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const method = btn.getAttribute('data-method');
                // visual
                popup.querySelectorAll('.payment-method').forEach(b => b.classList.remove('ring-2', 'ring-offset-2', 'ring-blue-500'));
                btn.classList.add('ring-2', 'ring-offset-2', 'ring-blue-500');

                if (method === 'MPESA') {
                    // Determine payment amount: prefer explicit totalAmount, otherwise derive from package
                    let paymentAmount = Number(totalAmount) || 0;
                    const pkgNorm = String(pkg || '').toLowerCase();
                    if (!paymentAmount) {
                        if (pkgNorm === 'growth') paymentAmount = 6000;
                        else if (pkgNorm === 'pro') paymentAmount = 12000;
                        else if (pkgNorm === 'premium') paymentAmount = 30000;
                        else paymentAmount = 0;
                    }
                    const paymentAmountDisplay = paymentAmount ? paymentAmount : 'Amount';
                    popup.innerHTML = `
                        <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4">
                            <h3 class="text-xl font-bold text-white mb-4 text-center">Payment Details</h3>
                            <p class="text-white/80 mb-4 text-center">PAY VIA MPESA, Buy Goods and Services Till Number 3790912 Amount KES ${paymentAmountDisplay}. Once Paid Click Paid Below.</p>
                            <div class="flex justify-center">
                                <button id="paid-button" class="w-full bg-purple-600 text-white py-2 px-4 rounded-xl hover:bg-purple-700 transition-colors">Paid</button>
                            </div>
                        </div>
                    `;

                    // Paid handler
                    setTimeout(() => {
                        const paidBtn = popup.querySelector('#paid-button');
                        if (paidBtn) {
                            paidBtn.addEventListener('click', () => {
                                popup.innerHTML = `
                                    <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4">
                                        <h3 class="text-xl font-bold text-white mb-4 text-center">Payment Confirmation</h3>
                                        <p class="text-white/80 mb-6 text-center">Payment will be Confirmed in a few minutes. Would you like to chat with your Assistant while you wait?</p>
                                        <div class="flex justify-center">
                                            <button id="go-to-ai" class="w-full bg-blue-600 text-white py-2 px-4 rounded-xl hover:bg-blue-700 transition-colors">Go to AI Assistant</button>
                                        </div>
                                    </div>
                                `;
                                const goBtn = popup.querySelector('#go-to-ai');
                                if (goBtn) {
                                    goBtn.addEventListener('click', () => {
                                        try { localStorage.setItem('paymentInitiated', 'true'); } catch (e) {}
                                        window.location.href = 'aiassistant.html';
                                    });
                                }
                            });
                        }
                    }, 40);
                }
            });
        });
    } catch (e) {
        console.warn('payment wiring failed', e);
    }

    // Helper: get a stable user id for backend (do not fallback to phone)
    const userId = userData['business id'] || userData.business_id || null;

    // Delegate clicks on payment method buttons
    popup.querySelectorAll('.payment-method').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const method = btn.getAttribute('data-method');
            // Mark selected visually
            popup.querySelectorAll('.payment-method').forEach(b => b.classList.remove('ring-2', 'ring-offset-2', 'ring-blue-500'));
            btn.classList.add('ring-2', 'ring-offset-2', 'ring-blue-500');

            // If MPESA selected, show a simple Till-number style payment (same as Ads flow)
            if (method === 'MPESA') {
                // Use the totalAmount passed into showRenewalPopup as the payment amount
                const paymentAmount = typeof totalAmount !== 'undefined' ? totalAmount : 'Amount';

                // Replace popup with a simple till-number instruction and a Paid button
                popup.innerHTML = `
                    <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4">
                        <h3 class="text-xl font-bold text-white mb-4 text-center">Payment Details</h3>
                        <p class="text-white/80 mb-4 text-center">PAY VIA MPESA, Buy Goods and Services Till Number 3790912 Amount KES ${paymentAmount}. Once Paid Click Paid Below.</p>
                        <div class="flex justify-center">
                            <button id="paid-button" class="w-full bg-purple-600 text-white py-2 px-4 rounded-xl hover:bg-purple-700 transition-colors">Paid</button>
                        </div>
                    </div>
                `;

                // Handle Paid click: show confirmation and optional CTA
                popup.querySelector('#paid-button').addEventListener('click', () => {
                    popup.innerHTML = `
                        <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4">
                            <h3 class="text-xl font-bold text-white mb-4 text-center">Payment Confirmation</h3>
                            <p class="text-white/80 mb-6 text-center">Payment will be Confirmed in a few minutes. Would you like to chat with your Assistant while you wait?</p>
                            <div class="flex justify-center">
                                <button id="go-to-ai" class="w-full bg-blue-600 text-white py-2 px-4 rounded-xl hover:bg-blue-700 transition-colors">Go to AI Assistant</button>
                            </div>
                        </div>
                    `;

                    const goBtn = popup.querySelector('#go-to-ai');
                    if (goBtn) {
                        goBtn.addEventListener('click', () => {
                            try { localStorage.setItem('paymentInitiated', 'true'); } catch (e) {}
                            window.location.href = 'aiassistant.html';
                        });
                    }
                });
            }
            // TODO: implement Card/Bank flows later
        });
    });
}

