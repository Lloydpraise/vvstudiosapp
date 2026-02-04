// Shared auth utilities
// Updated import to use esm.sh for better compatibility and to resolve AuthClient null error
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- SUPABASE CONFIGURATION ---
const supabaseUrl = 'https://xgtnbxdxbbywvzrttixf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';

// Create Supabase client directly
const supabase = createClient(supabaseUrl, supabaseKey);

const firebaseConfig = {
    apiKey: "AIzaSyCHz35J4yav-16whNExV9V93VKkwApLO3A",
    authDomain: "sasa-ai-datastore.firebaseapp.com",
    projectId: "sasa-ai-datastore",
    storageBucket: "sasa-ai-datastore.firebasestorage.app",
    messagingSenderId: "798817915915",
    appId: "1:798817915915:web:c77688e67bb4e609a2a30e",
    measurementId: "G-0R1L2NXXYM"
};

let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (e) {
    // Firebase already initialized
}

function normalizePhoneNumber(phone) {
    if (typeof phone !== 'string') {
        phone = String(phone);
    }
    let normalized = phone.trim().replace(/\s+/g, '');

    if (normalized.startsWith('+')) {
        normalized = normalized.substring(1);
    }

    if (normalized.startsWith('0')) {
        normalized = '254' + normalized.substring(1);
    } else if (normalized.length === 9 && normalized.startsWith('7')) {
        normalized = '254' + normalized;
    }

    return normalized;
}

function getLoggedInUser() {
    const saved = localStorage.getItem('vvUser');
    return saved ? JSON.parse(saved) : null;
}

function getBusinessId() {
    const user = getLoggedInUser();
    return user ? user.business_id : null;
}

function checkLoginAndRedirect() {
    if (!getLoggedInUser()) {
        window.location.href = 'index.html';
    }
}

function logout() {
    localStorage.removeItem('vvUser');
    window.location.href = 'index.html';
}

window.authUtils = {
    normalizePhoneNumber,
    getLoggedInUser,
    getBusinessId,
    checkLoginAndRedirect,
    logout,
    switchBusiness
};

// Helpers to toggle services locally (useful for admin to enable features)
function _saveLoggedInUser(userObj) {
    try {
            const copy = Object.assign({}, userObj);
        // Do not strip active_services or pending_services as applyDefaultPackageSettings handles defaults
        // if (copy.active_services) delete copy.active_services;
        // if (copy.pending_services) delete copy.pending_services;
            localStorage.setItem('vvUser', JSON.stringify(copy));
        } catch (e) {
        console.warn('failed saving vvUser', e);
        // Fallback attempts removed to simplify and centralize error handling
    }
}

function enableServiceForCurrentUser(serviceName) {
    const raw = getLoggedInUser();
    if (!raw) return false;
    const user = applyDefaultPackageSettings(raw);
    const svc = String(serviceName || '').trim();
    if (!svc) return false;
    const active = new Set((user.active_services || []).map(s => String(s)));
    active.add(svc);
    user.active_services = Array.from(active);
    // If pending_services existed, remove from it
    if (Array.isArray(user.pending_services)) {
        user.pending_services = user.pending_services.filter(s => String(s).toLowerCase() !== svc.toLowerCase());
    }
    _saveLoggedInUser(user);
    return true;
}

function disableServiceForCurrentUser(serviceName) {
    const raw = getLoggedInUser();
    if (!raw) return false;
    const user = applyDefaultPackageSettings(raw);
    const svc = String(serviceName || '').trim();
    if (!svc) return false;
    user.active_services = (user.active_services || []).filter(s => String(s).toLowerCase() !== svc.toLowerCase());
    // add to pending_services
    user.pending_services = Array.isArray(user.pending_services) ? user.pending_services : [];
    if (!user.pending_services.some(s => String(s).toLowerCase() === svc.toLowerCase())) user.pending_services.push(svc);
    _saveLoggedInUser(user);
    return true;
}

window.authUtils.enableServiceForCurrentUser = enableServiceForCurrentUser;
window.authUtils.disableServiceForCurrentUser = disableServiceForCurrentUser;

// --- Package helpers ---
function normalizePackageName(pkg) {
    if (!pkg) return 'Free';
    const p = String(pkg).trim();
    if (!p) return 'Free';
    if (/^trial$/i.test(p)) return 'Free';
    // Accept common names and normalize casing
    if (/^free$/i.test(p)) return 'Free';
    if (/^growth$/i.test(p)) return 'Growth';
    if (/^pro$/i.test(p)) return 'Pro';
    if (/^premium$/i.test(p)) return 'Premium';
    return p.charAt(0).toUpperCase() + p.slice(1);
}

function getPackageDetails(pkg) {
    const name = normalizePackageName(pkg);
    // Default package definitions
    const packages = {
        'Free': {
            durationDays: 365, // Changed from 3 to 365 days
            amount: 0,
            services: ['My Business']
        },
        'Growth': {
            durationDays: 30,
            amount: 6000,
            services: ['My Business', 'Ads', 'Business Assistant', 'Sales and Follow Ups']
        },
        'Pro': {
            durationDays: 30,
            amount: 12000,
            services: ['My Business', 'Ads', 'Business Assistant', 'Sales and Follow Ups', 'AI Assistant', 'Live Chat']
        },
        'Premium': {
            durationDays: 30,
            amount: 30000,
            services: ['My Business', 'Ads', 'Business Assistant', 'Sales and Follow Ups', 'AI Assistant', 'Live Chat', 'Marketing Systems', 'Automations']
        }
    };
    return packages[name] || { durationDays: null, amount: null, services: [] };
}

// --- Business Switching Logic ---
async function switchBusiness(biz) {
    // 1. Get current user data
    const user = JSON.parse(localStorage.getItem('vvUser') || '{}');

    // 2. Check if login record exists for this business
    const phone = normalizePhoneNumber(user.phone_number || user.phone);
    if (phone) {
        try {
            const { data: existingRecord, error } = await supabase
                .from('logins')
                .select('*')
                .eq('phone_number', phone)
                .eq('business id', biz.business_id)
                .limit(1);

            if (error) {
                console.warn('Error checking for existing login record:', error);
            } else if (!existingRecord || existingRecord.length === 0) {
                // No record exists, create one
                const newRecord = Object.assign({}, user, {
                    'business id': biz.business_id,
                    business_id: biz.business_id,
                    business_name: biz.name,
                    phone_number: phone
                });
                // Remove id if present to avoid conflict
                if (newRecord.id) delete newRecord.id;
                if (newRecord.user_id) delete newRecord.user_id;

                const { error: insertError } = await supabase
                    .from('logins')
                    .insert([newRecord]);

                if (insertError) {
                    console.warn('Error creating login record for business:', insertError);
                } else {
                    console.log('Created login record for business:', biz.business_id);
                }
            }
        } catch (e) {
            console.warn('Exception in switchBusiness check:', e);
        }
    }

    // 3. Update LocalStorage
    user.business_id = biz.business_id;
    user['business id'] = biz.business_id; // Support both keys
    user.business_name = biz.name;
    // Keep other user fields (phone, name, etc) the same
    try{
        const toSave = Object.assign({}, user);
        if (toSave.active_services) delete toSave.active_services;
        if (toSave.pending_services) delete toSave.pending_services;
        localStorage.setItem('vvUser', JSON.stringify(toSave));
    }catch(e){ try{ const f = Object.assign({}, user); if (f.active_services) delete f.active_services; if (f.pending_services) delete f.pending_services; localStorage.setItem('vvUser', JSON.stringify(f)); }catch(_){} }

    // 4. Show loading feedback
    const dd = document.getElementById('business-dropdown');
    if(dd) dd.classList.add('hidden');
    const nameEl = document.getElementById('businessName');
    if(nameEl) nameEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Switching...';

    // 5. Reload Page to refresh all data
    setTimeout(() => window.location.reload(), 500);
}

function computePackageExpiryDate(joinedDate, pkg) {
    const details = getPackageDetails(pkg);
    if (!details || !details.durationDays) return null;
    const base = joinedDate ? new Date(joinedDate) : new Date();
    // Ensure we work in UTC and add days
    const expiry = new Date(base.getTime());
    expiry.setUTCDate(expiry.getUTCDate() + details.durationDays);
    return expiry.toISOString();
}

function applyDefaultPackageSettings(loginRecord) {
    // Does not persist to DB. Returns a shallow copy with computed fields filled.
    if (!loginRecord || typeof loginRecord !== 'object') return loginRecord;
    const out = { ...loginRecord };
    out.package = normalizePackageName(out.package || out.package_name || out.package_type);
    // Always compute package_expiry_date from renew date if present (30 days), else joined_date (package duration)
    const renewDate = out['renewed date'] || out.renewed_date;
    const joinedDate = out.joined_date || out.created_at || new Date().toISOString();
    const baseDate = renewDate || joinedDate;
    const pkgDetails = getPackageDetails(out.package);
    const durationDays = renewDate ? 30 : (pkgDetails.durationDays || 30);
    // Compute expiry
    const base = new Date(baseDate);
    const expiry = new Date(base.getTime());
    expiry.setUTCDate(expiry.getUTCDate() + durationDays);
    out.package_expiry_date = expiry.toISOString();
    // Attach amount and services for UI convenience
    const det = getPackageDetails(out.package);
    if (det.amount != null) out.package_amount = det.amount;
    out.active_services = Array.isArray(out.active_services) && out.active_services.length ? out.active_services : det.services.slice();
    // For Growth customers we keep Business Assistant locked by default
    // The admin can enable it later (user will toggle it on when ready).
    try {
        if (String(out.package).toLowerCase() === 'growth') {
            out.active_services = (out.active_services || []).filter(s => String(s).toLowerCase() !== 'business assistant');
            // Keep a record of services that are available but admin-disabled
            out.pending_services = (det.services || []).filter(s => String(s).toLowerCase() === 'business assistant');
        }
    } catch (e) {
        // ignore failures and leave services as-is
    }
    // Mark is_active based on expiry (if expiry exists)
    if (out.package_expiry_date) {
        const now = new Date();
        const exp = new Date(out.package_expiry_date);
        out.is_active = exp > now;
    }
    return out;
}

// Expose package helpers
window.authUtils.getPackageDetails = getPackageDetails;
window.authUtils.computePackageExpiryDate = computePackageExpiryDate;
window.authUtils.applyDefaultPackageSettings = applyDefaultPackageSettings;

/* Locked-item toast: shared across pages. Shows a contextual message when a locked sidebar
   item is clicked. On mobile it appears above the tapped item with a down-arrow; on desktop
   it appears to the right. Uses .pro and .growth classes for token coloring. */
(function(){
    function createLockedToast() {
        let toast = document.getElementById('locked-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'locked-toast';
            toast.className = 'locked-toast';
            toast.style.position = 'absolute';
            toast.style.zIndex = 140;
            toast.style.pointerEvents = 'auto';
            toast.style.maxWidth = '280px';
            toast.style.background = 'linear-gradient(180deg, rgba(26,29,35,0.98), rgba(15,17,21,0.98))';
            toast.style.border = '1px solid rgba(255,255,255,0.06)';
            toast.style.padding = '10px 12px';
            toast.style.borderRadius = '10px';
            toast.style.boxShadow = '0 8px 20px rgba(2,6,23,0.6)';
            toast.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(4px)';
            toast.style.fontSize = '13px';
            toast.style.lineHeight = '1.2';
            toast.style.display = 'flex';
            toast.style.alignItems = 'center';
            toast.style.gap = '8px';

            const arrow = document.createElement('span');
            arrow.id = 'locked-toast-arrow';
            arrow.style.position = 'absolute';
            arrow.style.width = '0';
            arrow.style.height = '0';

            document.body.appendChild(toast);
            document.body.appendChild(arrow);
        }
        return document.getElementById('locked-toast');
    }

    let lockedToastTimeout = null;
    function hideLockedToast() {
        const toast = document.getElementById('locked-toast');
        const arrow = document.getElementById('locked-toast-arrow');
        if (toast) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(4px)';
            setTimeout(() => {
                if (toast.parentElement) toast.parentElement.removeChild(toast);
                if (arrow && arrow.parentElement) arrow.parentElement.removeChild(arrow);
            }, 220);
        }
        if (lockedToastTimeout) {
            clearTimeout(lockedToastTimeout);
            lockedToastTimeout = null;
        }
    }

    function showLockedToast(target) {
        const toast = createLockedToast();

        // Determine section title
        let sectionTitle = '';
        try {
            const spans = Array.from(target.querySelectorAll('span'));
            const titleSpan = spans.find(s => !s.classList.contains('tooltip')) || spans[0];
            sectionTitle = titleSpan ? titleSpan.textContent.trim() : (target.textContent || '').trim();
        } catch (e) {
            sectionTitle = (target.textContent || '').trim();
        }

        // Custom mapping for locked items: define package and color per item
        const map = {
            'ai sales assistant': { pkg: 'Pro', color: '#FFD700' },
            'ai sales automation': { pkg: 'Pro', color: '#FFD700' },
            'live chat': { pkg: 'Pro', color: '#FFD700' },
            'automations': { pkg: 'Premium', color: '#7C3AED' },
            'marketing systems': { pkg: 'Premium', color: '#7C3AED' }
        };

        const norm = (sectionTitle || '').toLowerCase().trim();
        let messageHtml = '';
        if (map[norm]) {
            const p = map[norm];
            messageHtml = `Get <span style="color: ${p.color}; font-weight:700">${p.pkg}</span> to unlock ${sectionTitle}`;
        } else {
            // Fallbacks: keep previous behaviour (Growth items -> Growth, others -> Pro)
            const growthItems = ['ai sales assistant', 'live chat'];
            const proItems = ['marketing systems', 'automations'];
            if (growthItems.includes(norm)) {
                messageHtml = `Get <span style="color:#10B981;font-weight:700">Growth</span> to unlock ${sectionTitle}`;
            } else if (proItems.includes(norm)) {
                messageHtml = `Get <span style="color:#FFD700;font-weight:700">Pro</span> to unlock ${sectionTitle}`;
            } else {
                messageHtml = `Get <span style="color:#FFD700;font-weight:700">Pro</span> to unlock ${sectionTitle}`;
            }
        }
        toast.innerHTML = messageHtml;

        const rect = target.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const arrow = document.getElementById('locked-toast-arrow');

        if (!toast.parentElement) document.body.appendChild(toast);
        if (!arrow.parentElement) document.body.appendChild(arrow);

        toast.style.opacity = '0';
        toast.style.transform = 'translateY(4px)';
        toast.style.left = '0px';
        toast.style.top = '0px';
        toast.style.display = 'flex';

        requestAnimationFrame(() => {
            const tW = Math.min(280, toast.offsetWidth || 200);
            const tH = toast.offsetHeight || 44;
            if (vw < 1024) {
                const left = Math.max(8, Math.min(vw - tW - 8, rect.left + (rect.width / 2) - (tW / 2)));
                const top = Math.max(8, rect.top - tH - 12 + window.scrollY);
                toast.style.left = `${left}px`;
                toast.style.top = `${top}px`;
                arrow.style.borderLeft = '8px solid transparent';
                arrow.style.borderRight = '8px solid transparent';
                arrow.style.borderTop = '10px solid rgba(26,29,35,0.98)';
                arrow.style.left = `${left + (tW / 2) - 8}px`;
                arrow.style.top = `${top + tH}px`;
            } else {
                const left = rect.right + 12;
                const top = rect.top + window.scrollY + (rect.height / 2) - (tH / 2);
                toast.style.left = `${left}px`;
                toast.style.top = `${top}px`;
                arrow.style.borderTop = '8px solid transparent';
                arrow.style.borderBottom = '8px solid transparent';
                arrow.style.borderRight = '10px solid rgba(26,29,35,0.98)';
                arrow.style.left = `${left - 10}px`;
                arrow.style.top = `${top + (tH / 2) - 8}px`;
            }

            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';

            if (lockedToastTimeout) clearTimeout(lockedToastTimeout);
            lockedToastTimeout = setTimeout(hideLockedToast, 3500);
        });
    }

    // Attach click listeners to locked sidebar links (works across pages that include auth.js)
    document.addEventListener('DOMContentLoaded', () => {
        const sidebarLinks = document.querySelectorAll('#sidebar nav ul li a');
        sidebarLinks.forEach(link => {
            // Respect explicit allow flag on links (e.g., data-always-allow="true")
            if (link.dataset && (link.dataset.alwaysAllow === 'true' || link.dataset.alwaysAllow === '1')) return;

            const hasLock = !!link.querySelector('.fa-lock');
            const isDisabledHref = link.getAttribute('href') === '#';
            if ((hasLock || isDisabledHref) && !(link.textContent||'').includes('Content Creation')) {
                link.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    showLockedToast(link);
                });
            }
        });

        window.addEventListener('scroll', hideLockedToast, { passive: true });
        window.addEventListener('resize', hideLockedToast);
    });
    
    // Also handle dynamic locking/unlocking of sidebar based on current user's package
    document.addEventListener('DOMContentLoaded', () => {
        try {
            const rawUser = getLoggedInUser();
            if (!rawUser) return;
            const user = applyDefaultPackageSettings(rawUser);
            const active = (user.active_services || []).map(s => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''));

            const sidebarLinks = document.querySelectorAll('#sidebar nav ul li a');
            sidebarLinks.forEach(link => {
                // If explicitly allowed on the element, skip locking logic
                if (link.dataset && (link.dataset.alwaysAllow === 'true' || link.dataset.alwaysAllow === '1')) {
                    link.classList.remove('text-white/30');
                    link.classList.add('text-white');
                    const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
                    // make sure href remains navigable
                    try { if (!link.getAttribute('href') || link.getAttribute('href') === '#') link.setAttribute('href', 'ecommerce.html'); } catch(e){}
                    return;
                }
                let title = '';
                try {
                    const spans = Array.from(link.querySelectorAll('span'));
                    const titleSpan = spans.find(s => !s.classList.contains('tooltip')) || spans[0];
                    title = titleSpan ? titleSpan.textContent.trim() : (link.textContent || '').trim();
                } catch (e) {
                    title = (link.textContent || '').trim();
                }
                const norm = String(title).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

                // Special-case: keep Messaging unlocked for Pro/Premium users
                try {
                    if (norm === 'messaging') {
                        const pkg = String(user.package || '').toLowerCase();
                        if (pkg === 'pro' || pkg === 'premium') {
                            link.classList.remove('text-white/30');
                            link.classList.add('text-white');
                            const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
                            try { if (!link.getAttribute('href') || link.getAttribute('href') === '#') link.setAttribute('href', 'messages.html'); } catch(e){}
                            return;
                        }
                    }
                } catch (e) { /* ignore */ }

                // Always allow My Business, Content Creation and Ecommerce
                if (norm === 'mybusiness' || norm === 'contentcreation' || norm === 'ecommerce') {
                    link.classList.remove('text-white/30');
                    link.classList.add('text-white');
                    const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
                    // We don't return here so that the 'isActive' check below can still run
                    // and ensure the link is properly set up if it's already in active_services.
                    // This prevents potential issues if 'ecommerce' is explicitly in active_services.
                }

                // Determine if this title is covered by active services
                // Also, explicitly consider 'ecommerce' as active, regardless of package services.
                const isEcommerce = (norm === 'ecommerce');
                const isActive = isEcommerce || active.some(a => {
                    return a && (norm.includes(a) || a.includes(norm) || norm === a);
                });

                if (isActive) {
                    link.classList.remove('text-white/30');
                    link.classList.add('text-white');
                    const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
                    // keep existing href
                } else {
                    link.classList.remove('text-white');
                    link.classList.add('text-white/30');
                    const existingLock = link.querySelector('.fa-lock');
                    if (!existingLock) {
                        const lockIcon = document.createElement('i');
                        lockIcon.className = 'fa-solid fa-lock w-3 h-3 text-white/30 ml-auto';
                        link.appendChild(lockIcon);
                    }
                    // disable navigation
                    link.setAttribute('href', '#');
                }
            });
        } catch (e) {
            // quiet failure
            console.warn('sidebar lock handling failed', e);
        }
    });
})();

