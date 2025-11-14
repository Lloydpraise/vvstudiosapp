// Shared auth utilities
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
    logout
};

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

        // Mapping per request: Live Chat & AI Sales Assistant -> Growth; Marketing Systems & Automations -> Pro
        const growthItems = ['AI Sales Assistant', 'Live Chat'];
        const proItems = ['Marketing Systems', 'Automations'];
        let messageHtml = '';
        if (growthItems.includes(sectionTitle)) {
            messageHtml = `Get <span class="growth">Growth</span> to unlock ${sectionTitle}`;
        } else if (proItems.includes(sectionTitle)) {
            messageHtml = `Get <span class="pro">Pro</span> to unlock ${sectionTitle}`;
        } else {
            messageHtml = `Get <span class="pro">Pro</span> to unlock ${sectionTitle}`;
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
})();
