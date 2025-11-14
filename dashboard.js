import { processSalesData } from './sales-logic.js';

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
    loggedInUser = userData;
    const normalizedId = normalizePhoneNumber(rawPhone);
    businessId = loggedInUser['business id'] || loggedInUser.business_id || normalizedId;

    const dashboardContainer = document.getElementById('dashboard-container');
    const loginContainer = document.getElementById('login-container');
    
    // UI Updates
    const welcomeName = document.getElementById('welcomeName');
    const profileName = document.getElementById('profileName');
    const profileAvatar = document.getElementById('profile-avatar');
    const businessNameEl = document.getElementById('businessName');

    // NAME FIX: Use 'admin_name' for the user name and 'business_name' for the business.
    const adminName = loggedInUser.admin_name || 'Admin';
    const businessName = loggedInUser.business_name || 'Your Business';

    if (welcomeName) welcomeName.textContent = adminName;
    if (profileName) profileName.textContent = businessName; 
    if (profileAvatar) {
        profileAvatar.textContent = adminName.charAt(0).toUpperCase();
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
    const fullUserData = {
        ...userData,
        business_id: businessId,
        phone_number: normalizedId,
        phone: rawPhone // The RAW phone is CRUCIAL for auto-login form filling and lookup
    };
    localStorage.setItem('vvUser', JSON.stringify(fullUserData));
    console.log('[DEBUG] Final complete user data saved to localStorage.');

    // Subscription/Service logic
    if (loggedInUser['joined date'] || loggedInUser.joined_date) {
        updateSubscriptionStatus(loggedInUser);
    }

    const services = loggedInUser.services || [];
    activateServices(services);

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
    
    // Robust key extraction.
    const phoneToLookup = savedUser.phone || savedUser.phone_number || savedUser.business_id; 
    const rawPhone = savedUser.phone || phoneToLookup; 

    if (!phoneToLookup) {
        console.error('[DEBUG] FATAL: Saved user data is missing the phone ID. Clearing storage.');
        localStorage.removeItem('vvUser');
        return;
    }

    businessId = normalizePhoneNumber(phoneToLookup); 
    console.log('[DEBUG] ID from savedUser:', rawPhone, 'Normalized businessId:', businessId);

    console.log('[DEBUG] Fetching user data from Supabase...');
    // SUPABASE CALL: Fetch data using the normalized phone number
    const { data: userDataArray, error } = await supabase
        .from('logins')
        .select('*')
        .eq('phone_number', businessId) // Query by the normalized phone number
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
        let period = 30, buttonText = "Upgrade", buttonClass = "bg-blue-600 hover:bg-blue-700";

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

        if (daysRemaining === 0) {
            if (countdownTextEl) countdownTextEl.textContent = 'Your Subscription Period has ended! To Continue enjoying our Services Please Proceed to Renew.';
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
            if (countdownTextEl) countdownTextEl.textContent = `⏳ ${daysRemaining} days remaining in your package.`;
            if (btn) {
                btn.textContent = "Renew Now";
                btn.className = `w-full bg-red-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-red-700 transition-colors`;
            }
            showRenewalPopup(userData, "Renew Now", daysRemaining, totalAmount);
        } else {
            if (countdownTextEl) countdownTextEl.textContent = `⏳ ${daysRemaining} days remaining in your package.`;
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
                btn.onclick = () => showRenewalPopup(userData, buttonText, daysRemaining, totalAmount);
            }
        }

    });
}

export function activateServices(services) {
    // Enforce a strict sidebar policy: only the first four sidebar items are accessible for everyone.
    // This ignores the services list from the DB and ensures a consistent UI for all users.
    const sidebarLis = document.querySelectorAll('#sidebar nav ul li');
    if (!sidebarLis || sidebarLis.length === 0) return;

    sidebarLis.forEach((li, idx) => {
        const link = li.querySelector('a');
        if (!link) return;

        // normalize classes
        link.classList.remove('text-white', 'text-white/30');

        const existingLock = link.querySelector('.fa-lock');

        // determine the visible title for special-case rules (e.g., Content Creation)
        let title = '';
        try {
            const spans = Array.from(link.querySelectorAll('span'));
            const titleSpan = spans.find(s => !s.classList.contains('tooltip')) || spans[0];
            title = titleSpan ? titleSpan.textContent.trim() : (link.textContent || '').trim();
        } catch (e) {
            title = (link.textContent || '').trim();
        }

        // Content Creation should always be accessible regardless of position
        if (idx < 4 || title === 'Content Creation') {
            link.classList.add('text-white');
            if (existingLock) existingLock.remove();
            // keep existing href as-is for accessible items
        } else {
            // rest: locked UI
            link.classList.add('text-white/30');
            if (!existingLock) {
                const lockIcon = document.createElement('i');
                lockIcon.className = 'fa-solid fa-lock w-3 h-3 text-white/30 ml-auto';
                link.appendChild(lockIcon);
            }
            // disable navigation
            link.setAttribute('href', '#');
        }
    });
}

// --- DOM READY LISTENER ---

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[DEBUG] DOMContentLoaded fired');

    const loginContainer = document.getElementById('login-container');
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('errorMessage') || document.getElementById('error-message');
    const logoutButton = document.getElementById('logoutButton');

    const savedUser = localStorage.getItem('vvUser');
    console.log('[DEBUG] savedUser from localStorage:', savedUser);
    
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
                // SUPABASE CALL: Query to authenticate
                const { data: userDataArray, error } = await supabase
                    .from('logins')
                    .select('admin_name, business_name, services, joined_date, renewed_date, "business id"')
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
            window.location.reload();
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
    
    if (metrics.salesToday) metrics.salesToday.textContent = `Ksh ${(data.salesToday || 0).toLocaleString()}`;
    if (metrics.conversionRate) metrics.conversionRate.textContent = `${data.conversionRate || 0}%`;
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

        let calculatedMetrics;

        if (typeof processSalesData === 'function') {
            console.log('[DEBUG] Processing data with sales-logic.js...');
            calculatedMetrics = processSalesData(salesDocs);
        } else {
            console.log('[DEBUG] processSalesData not available. Using dummy metrics.');
            calculatedMetrics = {
                totalRevenue: 10000,
                revenueChange: 5,
                salesToday: 500, 
                averageOrderValue: 50,
                conversionRate: 10, 
                totalConversations: 100,
                activeConversations: 20,
                uniqueUsers: 50,
                bestSellingProducts: [{name: 'Product A', units: 10}, {name: 'Product B', units: 8}],
                monthlyRevenueTrend: [{month: 'Jan', revenue: 1000}, {month: 'Feb', revenue: 1200}]
            };
        }
        
        console.log('[DEBUG] Final calculated metrics:', calculatedMetrics);

        console.log('[DEBUG] Updating UI with metrics...');
        updateMetrics(calculatedMetrics);
        updateBestSellingProducts(calculatedMetrics.bestSellingProducts);
        
        if (typeof Chart !== 'undefined') {
             renderSalesChart(calculatedMetrics.monthlyRevenueTrend);
        }
        
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
            labels: data.map(d => d.month),
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

function showRenewalPopup(userData, buttonText, daysRemaining, totalAmount) {
    const services = userData.services || [];
    const activeServices = services.filter(s => !s.toLowerCase().includes('fees')).map(s => s.replace(/\(.*\)/, '').trim()).join(', ');

    const isWarning = daysRemaining > 0;
    const warningText = isWarning ? `<p class="text-yellow-400 text-lg font-bold mb-4">You have ${daysRemaining} days remaining to your subscription expiration!</p>` : '';

    const popup = document.createElement('div');
    popup.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

    // New 3-step payment flow - Step 1 (method selection) + container for Step 2
    popup.innerHTML = `
        <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4 relative">
            ${isWarning ? '<button id="close-popup" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>' : ''}
            <h3 class="text-xl font-bold text-white mb-2">To Continue Please Select Payment Method</h3>
            <p class="text-white/80 mb-4">Your subscription is ${daysRemaining === 0 ? 'expired' : 'expiring soon'}. Total: <span class="text-orange-400 font-bold">KES ${totalAmount}</span></p>

            <div id="payment-step-1" class="mb-4">
                <div class="flex gap-3 justify-between">
                    <button class="payment-method flex-1 bg-[#111316] border border-[#2b2f3a] rounded-xl py-3 px-2 text-white hover:bg-[#0f1316]" data-method="CARD">
                        <div class="flex items-center justify-center gap-3">
                            <!-- Card Icon (larger & brighter) -->
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
                            <!-- Use the M-Pesa logo image (words are part of the logo) -->
                            <img src="assets/M-PESA_LOGO-01.svg.png" alt="M-Pesa" style="height:72px; width:auto; object-fit:contain; display:block;" />
                        </div>
                    </button>
                    <button class="payment-method flex-1 bg-[#111316] border border-[#2b2f3a] rounded-xl py-3 px-2 text-white hover:bg-[#0f1316]" data-method="BANK">
                        <div class="flex items-center justify-center gap-3">
                            <!-- Bank Icon (larger & brighter) -->
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

            <!-- Step 2 container (hidden initially) -->
            <div id="payment-step-2" class="mt-4" style="display:none">
                <!-- MPESA form will be injected here when selected -->
            </div>

        </div>
    `;

    document.body.appendChild(popup);

    if (isWarning) {
        popup.querySelector('#close-popup').addEventListener('click', () => popup.remove());
    }

    // Helper: get a stable user id for backend
    const userId = userData['business id'] || userData.business_id || userData['business_id'] || userData.businessId || userData.phone_number || businessId || null;

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

