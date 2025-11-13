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
        window.location.href = 'dashboardlanding.html';
    }
}

function logout() {
    localStorage.removeItem('vvUser');
    window.location.href = 'dashboardlanding.html';
}

window.authUtils = {
    normalizePhoneNumber,
    getLoggedInUser,
    getBusinessId,
    checkLoginAndRedirect,
    logout
};
