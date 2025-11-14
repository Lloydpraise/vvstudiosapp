// --- Supabase Configuration (Matching Dashboard.js) ---
import * as Supabase from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://xgtnbxdxbbywvzrttixf.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';

const supabase = Supabase.createClient(supabaseUrl, supabaseKey);

// Global state variables
let loggedInUser = null;
let businessId = null;

// 🗓️ Default date range: show today's data
let today = new Date();
let startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

let dateRangeStart = startOfToday.toISOString().slice(0, 10);
let dateRangeEnd = endOfToday.toISOString().slice(0, 10);

let adSalesChartInstance = null;
let topAdsChartInstance = null;

// --- Utility ---
function normalizePhoneNumber(phone) {
    if (!phone) return "";
    let normalized = String(phone).trim().replace(/\s+/g, "");
    if (normalized.startsWith("+")) normalized = normalized.substring(1);
    // Assumes Kenyan mobile numbers starting with '0' or '7'
    if (normalized.startsWith("0")) normalized = "254" + normalized.substring(1);
    else if (normalized.length === 9 && normalized.startsWith("7")) normalized = "254" + normalized;
    console.log(`[DEBUG] Phone normalized: ${phone} -> ${normalized}`);
    return normalized;
}

function getLoggedInUser() {
    console.log("[DEBUG] Attempting to retrieve user from localStorage...");
    const saved = localStorage.getItem("vvUser");
    const user = saved ? JSON.parse(saved) : null;
    if (user) {
        loggedInUser = user;
        businessId = user.business_id || normalizePhoneNumber(user.phone);
        console.log(`[DEBUG] Found stored user. Business ID set to: ${businessId}`);
    } else {
        console.log("[DEBUG] No stored user found.");
    }
    return user;
}

function logout() {
    console.log("[DEBUG] Logging out: Clearing localStorage and reloading page.");
    localStorage.removeItem("vvUser");
    window.location.reload();
}

// --- UI Switch ---
function showDashboard(userData, rawPhone) {
    console.log("[DEBUG] Entering showDashboard function.");
    
    loggedInUser = userData;
    // Set business ID from fetched data or derived from phone
    businessId = userData['business id'] || userData.business_id || normalizePhoneNumber(rawPhone);
    console.log(`[DEBUG] Dashboard Business ID set: ${businessId}`);
    
  const loginContainerEl = document.getElementById("login-container");
  const dashboardEl = document.getElementById("dashboard-container");
  if (loginContainerEl) loginContainerEl.style.display = "none";
  if (dashboardEl) dashboardEl.style.display = "flex";
    console.log("[DEBUG] UI containers switched (Login hidden, Dashboard shown).");
    
    // NAME FIX: Use 'admin_name' for the user name and 'business_name' for the business.
    const adminName = userData.admin_name || 'Admin';
    const businessName = userData.business_name || 'Your Business';
    
    // Fill dashboard header
    document.getElementById("businessName").textContent = businessName;
    document.getElementById("welcomeName").textContent = adminName;
    document.getElementById("profileName").textContent = businessName;
    document.getElementById("profile-avatar").textContent = adminName.charAt(0).toUpperCase();
    console.log(`[DEBUG] Header updated: Business Name: ${businessName}, Admin Name: ${adminName}`);
    
    // Package bar logic (now the comprehensive function)
    updateSubscriptionStatus(userData);
    
    // Load ads data
    fetchAdResults(businessId);
}

// --- Login Logic (Unified Supabase) ---
async function handleLogin(e) {
    e.preventDefault();
    console.log("[DEBUG] Login form submitted.");
    
    const phone = document.getElementById("phone").value;
    const enteredFirstName = document.getElementById("firstName").value;
    const errorMessage = document.getElementById("errorMessage");
    
    if (!phone || !enteredFirstName) {
        errorMessage.textContent = "Please enter both phone number and first name.";
        errorMessage.style.display = "block";
        return;
    }
    
    const normalized = normalizePhoneNumber(phone);
    console.log(`[DEBUG] Querying 'logins' table for phone_number: ${normalized}`);
    
    try {
        // 🔥 UNIFIED LOGIC: Query the 'logins' table just like dashboard.js
        const { data: userDataArray, error } = await supabase
            .from('logins')
            .select('*')
            .eq('phone_number', normalized)
            .limit(1);

        if (error) throw error;
        const userData = userDataArray ? userDataArray[0] : null;

        if (userData) {
            console.log("[DEBUG] User data found in 'logins' table.");
            // Check first name for authentication
            const adminName = userData.admin_name || "";
            if (adminName.toLowerCase() === enteredFirstName.trim().toLowerCase()) {
                console.log("[DEBUG] First name matched. Login successful.");
                errorMessage.style.display = "none";
                
                // Save user data to localStorage (consistent with dashboard.js)
                const fullUserData = {
                    ...userData,
                    business_id: userData['business id'] || userData.business_id || normalized,
                    phone_number: normalized,
                    phone: phone // Raw phone for UX
                };
                localStorage.setItem("vvUser", JSON.stringify(fullUserData));
                console.log("[DEBUG] Full user data saved to localStorage.");
                
                showDashboard(userData, phone);
            } else {
                console.log(`[DEBUG] First name mismatch: Entered '${enteredFirstName}', Stored: '${adminName}'.`);
                errorMessage.textContent = "Invalid first name for this phone number.";
                errorMessage.style.display = "block";
                localStorage.removeItem("vvUser");
            }
        } else {
            console.log("[DEBUG] Business not found in 'logins' table for this phone number.");
            errorMessage.textContent = "Business not found for this phone number.";
            errorMessage.style.display = "block";
            localStorage.removeItem("vvUser");
        }
    } catch (error) {
        console.error("[DEBUG] Supabase Login Error:", error);
        errorMessage.textContent = "Error connecting to the service. Please try again.";
        errorMessage.style.display = "block";
    }
}

// --- Package Bar (Updated for full Dashboard.js logic) ---
function updateSubscriptionStatus(userData) {
    requestAnimationFrame(() => {
        const services = userData.services || [];
        
        let period = 30; // Default to Monthly
        let buttonText = "Renew Subscription"; 
        let buttonClass = "bg-purple-600 hover:bg-purple-700"; // Monthly button is purple
        
        // Logic for package duration based on service name
        if (services.some(s => s.toLowerCase().includes("ads management mini"))) {
            period = 10; // Mini Package
            buttonText = "Go Monthly!"; // Mini button prompts upgrade
            buttonClass = "bg-blue-600 hover:bg-blue-700"; // Mini button is blue
        }

        let totalAmount = 0;
        services.forEach(service => {
            const lowerService = service.toLowerCase();
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
            const startDate = new Date(joinTimestamp);
            const today = new Date();
            const diffDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
            daysRemaining = Math.max(0, period - (diffDays % period));
        }

        console.log(`[DEBUG] Subscription Period: ${period} days. Days Remaining: ${daysRemaining}. Total Fees: KES ${totalAmount}`);

        const countdownTextEl = document.getElementById('countdown-text');
        const progressBar = document.getElementById('countdown-bar');
        const btn = document.getElementById('upgrade-button');

        // Logic for UI and Pop-up Trigger
        const finalButtonText = (daysRemaining > 0 && daysRemaining <= 3 && period === 30) ? "Renew Now" : buttonText;
        const finalButtonClass = buttonClass;

        if (daysRemaining === 0) {
            if (countdownTextEl) countdownTextEl.textContent = 'Your Subscription Period has ended! To Continue enjoying our Services Please Proceed to Renew.';
            if (progressBar) progressBar.style.display = 'none';
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = finalButtonText;
                btn.className = `w-full ${finalButtonClass} text-white font-semibold py-3 px-4 rounded-xl hover:bg-opacity-80 transition-colors`;
                btn.onclick = () => showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, period);
            }
            showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, period);
        } else if (daysRemaining <= 3) {
            if (countdownTextEl) countdownTextEl.textContent = `⏳ ${daysRemaining} days remaining in your package.`;
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = finalButtonText;
                // Use red color for general warning, unless it's the "Go Monthly!" button which remains blue.
                const warningClass = (period === 10) ? finalButtonClass : "bg-red-600 hover:bg-red-700";
                btn.className = `w-full ${warningClass} text-white font-semibold py-3 px-4 rounded-xl transition-colors`;
                btn.onclick = () => showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, period);
            }
            showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, period);
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
                btn.textContent = finalButtonText;
                btn.className = `w-full ${finalButtonClass} text-white font-semibold py-3 px-4 rounded-xl hover:bg-opacity-80 transition-colors`;
                btn.onclick = () => showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, period);
            }
        }
    });
}

// --- Renewal Popup (Refactored) ---
function showRenewalPopup(userData, buttonText, daysRemaining, totalAmount, period) {
    console.log("[DEBUG] Showing renewal popup.");
    
    const isMini = period === 10;
    const isWarning = daysRemaining > 0;
    const activeServices = (userData.services || []).filter(s => !s.toLowerCase().includes('fees')).map(s => s.replace(/\(.*\)/, '').trim()).join(', ');

    let popupTitle, popupBodyHTML, popupAmount, upgradeButtonText, upgradeButtonClass, paymentAmount;

    if (isMini) {
        // Mini Package Upgrade Logic
        popupTitle = "Pay Only 4000sh and get Ads Management Monthly!";
        paymentAmount = 4000; // Hardcoded upgrade price
        upgradeButtonText = "Go Monthly!";
        upgradeButtonClass = "bg-purple-600 hover:bg-purple-700"; // Purple for Go Monthly
        
        popupBodyHTML = `
            <div class="text-center">
                <p class="text-white/80 mb-4 font-bold text-lg">You have ${daysRemaining} days left in your subscription.</p>
                <p class="text-white/80 mb-6">
                    Go monthly now and enjoy more features like:
                </p>
                <ul class="list-disc list-inside text-white/90 text-left mx-auto max-w-xs space-y-2">
                    <li>Ads Intelligence</li>
                    <li>CRM with powerful Capabilities</li>
                    <li>Real Time Ad Results Updates</li>
                    <li>Unlimited Copilot Credits!</li>
                </ul>
            </div>
        `;
        popupAmount = 'KES 4000'; // Displayed amount in popup
    } else {
        // Monthly Package Renewal Logic
        popupTitle = "Renew Your Subscription";
        paymentAmount = totalAmount; // Dynamic renewal price
        upgradeButtonText = buttonText;
        upgradeButtonClass = (daysRemaining <= 3 && daysRemaining > 0) ? "bg-red-600 hover:bg-red-700" : "bg-purple-600 hover:bg-purple-700";
        
        popupBodyHTML = `
            <p class="text-white/80 mb-4">Your subscription is ${daysRemaining === 0 ? 'expired' : 'expiring soon'}. ${daysRemaining > 0 ? 'Renew' : 'Upgrade'} to continue enjoying our services.</p>
            <p class="text-white/80 mb-4">Active Services: ${activeServices}</p>
        `;
        popupAmount = `KES ${totalAmount}`; // Displayed amount in popup
    }

    const popup = document.createElement('div');
    popup.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    
    // Use text-center class on the card container for alignment
    popup.innerHTML = `
        <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4 relative">
            ${isWarning ? '<button id="close-popup" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>' : ''}
            
            <h3 class="text-xl font-bold text-white mb-4 text-center">${popupTitle}</h3>
            
            ${popupBodyHTML}
            
            <p class="text-orange-400 text-lg font-bold mb-6 text-center">Total Amount: ${popupAmount}</p>
            
            <div class="flex justify-center">
                <button id="confirm-renewal" class="w-full ${upgradeButtonClass} text-white py-2 px-4 rounded-xl hover:bg-opacity-80 transition-colors">${upgradeButtonText}</button>
            </div>
        </div>
    `;
    document.body.appendChild(popup);

    if (isWarning) {
        document.getElementById('close-popup').addEventListener('click', () => {
            popup.remove();
        });
    }

    document.getElementById('confirm-renewal').addEventListener('click', () => {
        // Show payment details
        popup.innerHTML = `
            <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4">
                <h3 class="text-xl font-bold text-white mb-4 text-center">Payment Details</h3>
                <p class="text-white/80 mb-4 text-center">PAY VIA MPESA, Buy Goods and Services Till Number 3790912 Amount ${paymentAmount}. Once Paid Click Paid Below.</p>
                <div class="flex justify-center">
                    <button id="paid-button" class="w-full bg-purple-600 text-white py-2 px-4 rounded-xl hover:bg-purple-700 transition-colors">Paid</button>
                </div>
            </div>
        `;

        document.getElementById('paid-button').addEventListener('click', () => {
            // Show confirmation popup
            popup.innerHTML = `
                <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-md w-full mx-4">
                    <h3 class="text-xl font-bold text-white mb-4 text-center">Payment Confirmation</h3>
                    <p class="text-white/80 mb-6 text-center">Payment will be Confirmed in A few Minutes' would you like to chat with Your Assistant As you Wait?</p>
                    <div class="flex justify-center">
                        <button id="go-to-ai" class="w-full bg-blue-600 text-white py-2 px-4 rounded-xl hover:bg-blue-700 transition-colors">Go to AI Assistant</button>
                    </div>
                </div>
            `;

            document.getElementById('go-to-ai').addEventListener('click', () => {
                localStorage.setItem('paymentInitiated', 'true');
                window.location.href = 'aiassistant.html';
            });
        });
    });
}


// --- Ad Results (Supabase) ---
let allAdDocs = []; // Store all daily results docs
// ... (fetchAdResults, getDocsForPeriod, calculateAggregatedData, updateAdDataForPeriod, updateKeyMetricsTotalSpend, loadCharts functions remain unchanged from the previous version)

async function fetchAdResults(businessId) {
  console.log(`[DEBUG] Starting fetchAdResults for business ID: ${businessId}`);
  console.log('[DEBUG] Query params:', { businessId, dateRangeStart, dateRangeEnd });

  try {
    // Fetch all daily results from Supabase 'ads' table
    const { data: adData, error } = await supabase
      .from('ads')
      .select(`
        campaign_name,
        date,
        impressions,
        reach,
        clicks,
        ctr,
        cpc,
        cpm,
        total_spend,
        leads,
        messages_started,
        conversions,
        conversion_rate
      `)
      .eq('business_id', businessId)
      .gte('date', dateRangeStart)
      .lte('date', dateRangeEnd)
      .order('date', { ascending: true });

    if (error) throw error;

    // Make sure adData exists and fix for legacy 'Date' references
    if (adData) {
      adData.forEach(row => {
        row.Date = row.date; // keep old code working
      });
    }

    allAdDocs = adData || [];
    console.log(`[DEBUG] Ad results fetched. Total documents: ${allAdDocs.length}`);

    // Default to 'today'
    updateAdDataForPeriod('today');

    // Update Key Metrics Total Spend for this month
    // Summarize and display total spend from allAdDocs
function updateKeyMetricsTotalSpend() {
  try {
    // Ensure we have the global array
    if (typeof allAdDocs === 'undefined' || !Array.isArray(allAdDocs)) {
      console.warn('[DEBUG] updateKeyMetricsTotalSpend: allAdDocs is not defined or not an array.');
      return { totalSpend: 0 };
    }

    // Sum spend from different possible field names defensively
    const totalSpend = allAdDocs.reduce((sum, row) => {
      // Accept numbers, strings, or missing fields
      const raw =
        (row.total_spend !== undefined && row.total_spend !== null ? row.total_spend :
        (row.Spend !== undefined && row.Spend !== null ? row.Spend :
        (row.spend !== undefined && row.spend !== null ? row.spend : 0)));

      // parse to float safely
      const val = Number(raw);
      return sum + (isFinite(val) ? val : 0);
    }, 0);

    // Round to 2 decimals for display
    const totalSpendRounded = Math.round((totalSpend + Number.EPSILON) * 100) / 100;

    console.log(`[DEBUG] updateKeyMetricsTotalSpend: totalSpend = ${totalSpendRounded}`);

    // Format for KES display
    const formatted = `KES ${totalSpendRounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Try common element IDs used in dashboards (this won't throw if they don't exist)
    const possibleIds = [
      'total-spend', 'totalSpend', 'key-metric-spend', 'spendValue',
      'Spend', 'totalSpendKES', 'total_spend'
    ];

    let updatedAny = false;
    possibleIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = formatted;
        updatedAny = true;
      }
    });

    // If your UI uses a specific card with class rather than ID, try some common selectors
    if (!updatedAny) {
      const elByClass = document.querySelector('.total-spend, .totalSpend, .key-metric-spend');
      if (elByClass) {
        elByClass.textContent = formatted;
        updatedAny = true;
      }
    }

    // Return totals so other code can use it
    return { totalSpend: totalSpendRounded, formatted, updatedAny };

  } catch (err) {
    console.error('[DEBUG] updateKeyMetricsTotalSpend error:', err);
    return { totalSpend: 0 };
  }
}


    // Clear any prior status
    document.getElementById("status-message").textContent = "";

  } catch (error) {
    console.error("[DEBUG] Error fetching ad results:", error);
    document.getElementById("status-message").textContent =
      "Error loading ad data. Check console for details.";
  }
}

function getDocsForPeriod(period) {
    const now = new Date();
    let startDate, endDate;
    console.log(`[DEBUG] Filtering ad data for period: ${period}`);

    switch (period) {
        case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            break;
        case 'yesterday':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        case 'thisWeek':
            const dayOfWeek = now.getDay(); // 0 = Sunday
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek) + 1);
            break;
        case 'lastWeek':
            const lastWeekDay = now.getDay();
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - lastWeekDay - 7);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - lastWeekDay);
            break;
        case 'thisMonth':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;
        case 'lastMonth':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        default:
            return [];
    }

    const filteredDocs = allAdDocs.filter(doc => {
        const docDate = new Date(doc.Date); 
        return docDate >= startDate && docDate < endDate;
    });
    console.log(`[DEBUG] Filtered documents count: ${filteredDocs.length}`);
    return filteredDocs;
}

function calculateAggregatedData(docs) {
  console.log(`[DEBUG] Aggregating data from ${docs.length} documents.`);

  if (docs.length === 0) {
    return {
      impressions: 0,
      frequency: 0,
      totalLeads: 0,
      costPerLead: 0,
      ctr: 0,
      linkCtr: 0,
      cpm: 0,
      cpc: 0,
      totalSpend: 0,
      totalSales: 0,
      roas: 0,
      conversionRate: 0
    };
  }

  // ✅ Step 1: compute real spend
  let totalSpend = 0;
  docs.forEach(doc => {
    const spendVal =
      doc.total_spend !== undefined && doc.total_spend !== null
        ? parseFloat(doc.total_spend)
        : doc.Spend !== undefined && doc.Spend !== null
        ? parseFloat(doc.Spend)
        : 0;

    if (!isNaN(spendVal)) totalSpend += spendVal;
  });
  console.log(`[DEBUG] Total spend calculated in calculateAggregatedData: ${totalSpend}`);

  // ✅ Step 2: continue with your existing aggregation
  const sumFields = ['impressions', 'totalLeads'];
  const avgFields = ['frequency', 'costPerLead', 'ctr', 'linkCtr', 'cpm', 'cpc', 'totalSales', 'roas', 'conversionRate'];

  let aggregated = {};

  // Sum fields
  sumFields.forEach(field => {
    aggregated[field] = docs.reduce((sum, doc) => sum + (doc[field] || 0), 0);
  });

  // ✅ override totalSpend with the real one we just computed
  aggregated.totalSpend = totalSpend;

  // Average fields
  avgFields.forEach(field => {
    const sum = docs.reduce((sum, doc) => sum + (doc[field] || 0), 0);
    aggregated[field] = sum / docs.length;
  });

  console.log("[DEBUG] Aggregation complete.");
  return aggregated;
}
 
// ==========================
// Fetch Total Sales Function
// ==========================
async function fetchTotalSales(businessId, period = 'today') {
  console.log(`[DEBUG] Fetching total sales for business ID: ${businessId} and period: ${period}`);

  try {
    // Define date range filters
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let startDate = todayStart.toISOString();
    if (period === 'thisMonth') startDate = firstDayOfMonth.toISOString();

    // Fetch data from 'sales' table
    const { data, error } = await supabase
      .from('sales')
      .select('amount, timestamp')
      .eq('business_id', businessId)
      .gte('timestamp', startDate)
      .lte('timestamp', new Date().toISOString());

    if (error) throw error;

    const totalSales = data.reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0);
    console.log(`[DEBUG] Total Sales fetched from 'sales' table (${period}): ${totalSales}`);
    return totalSales;
  } catch (error) {
    console.error('[DEBUG] Error fetching total sales:', error);
    return 0;
  }
}
// --- START: Add / replace with this code in js/ads-dashboard.js ---

/**
 * Get start/end Date objects for "period" and for the previous comparable period.
 * period values: 'today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'
 */
function getPeriodRanges(period) {
  const now = new Date();
  let start, end, prevStart, prevEnd;

  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  if (period === 'today') {
    start = startOfDay(now);
    end = addDays(start, 1);
    prevStart = addDays(start, -1);
    prevEnd = start;
  } else if (period === 'yesterday') {
    start = addDays(startOfDay(now), -1);
    end = addDays(start, 1);
    prevStart = addDays(start, -1);
    prevEnd = start;
  } else if (period === 'thisWeek') {
    const dayOfWeek = now.getDay(); // 0=Sun
    start = startOfDay(addDays(now, -dayOfWeek));
    end = addDays(start, 7);
    prevStart = addDays(start, -7);
    prevEnd = start;
  } else if (period === 'lastWeek') {
    const dayOfWeek = now.getDay();
    // last week start = today - dayOfWeek - 7
    start = startOfDay(addDays(now, -dayOfWeek - 7));
    end = addDays(start, 7);
    prevStart = addDays(start, -7);
    prevEnd = start;
  } else if (period === 'thisMonth') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'lastMonth') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 1);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    prevEnd = start;
  } else {
    // fallback -> use today
    start = startOfDay(now);
    end = addDays(start, 1);
    prevStart = addDays(start, -1);
    prevEnd = start;
  }

  return { start, end, prevStart, prevEnd };
}

/**
 * Given an array of docs (allAdDocs) and a date range (start <= date < end),
 * return aggregated metrics using calculateAggregatedData semantics.
 * The docs use field row.Date (string YYYY-MM-DD) per fetchAdResults.
 */
function getAggregatedForRange(start, end) {
  // Defensive filter
  const filtered = allAdDocs.filter(d => {
    const dt = new Date(d.Date);
    return dt >= start && dt < end;
  });
  return calculateAggregatedData(filtered || []);
}

/**
 * Set change text and color on the DOM.
 * elementIdChange -> the span that should show arrow + percent (e.g. 'impressionsChange')
 * valueCurrent, valuePrevious -> numeric
 * lowerIsBetter -> boolean: when true, a decrease is green (used for CPM & CPC)
 */
function renderChange(elementIdChange, valueCurrent, valuePrevious, lowerIsBetter = false) {
  const span = document.getElementById(elementIdChange);
  if (!span) return;

  // Handle zero / no previous safely
  if (valuePrevious === 0 || valuePrevious === null || typeof valuePrevious === 'undefined') {
    span.innerHTML = valueCurrent === 0 ? '—' : 'N/A';
    // reset classes
    span.classList.remove('text-green-400', 'text-red-400');
    span.style.color = ''; // clear inline color
    return;
  }

  // percent change
  const diff = valueCurrent - valuePrevious;
  const pct = (diff / Math.abs(valuePrevious)) * 100;
  const roundedPct = Math.abs(pct).toFixed(1);

  // Decide direction and color
  let arrow = '▲';
  let isGood = true;

  if (diff === 0) {
    arrow = '▶';
  } else if (diff > 0) {
    arrow = '▲';
    // if lower is better (cpm/cpc), THEN an increase is bad
    isGood = lowerIsBetter ? false : true;
  } else {
    arrow = '▼';
    isGood = lowerIsBetter ? true : false;
  }

  // Build display text
  span.textContent = `${arrow} ${roundedPct}%`;

  // Color classes (you can replace with tailwind classes or apply style)
  span.classList.remove('text-green-400', 'text-red-400');
  if (diff === 0) {
    span.style.color = ''; // neutral
  } else if (isGood) {
    span.classList.add('text-green-400');
    span.style.color = ''; // allow classes to control color
  } else {
    span.classList.add('text-red-400');
    span.style.color = '';
  }
}

/**
 * NEW: Updated updateAdDataForPeriod to compute and render changes for previous period
 * Replace your existing updateAdDataForPeriod with this implementation.
 */
async function updateAdDataForPeriod(period) {
  console.log(`[DEBUG] (NEW) Updating dashboard data for period: ${period}`);

  // 1) compute ranges for this period and previous period
  const ranges = getPeriodRanges(period);
  const currentAgg = getAggregatedForRange(ranges.start, ranges.end);
  const prevAgg = getAggregatedForRange(ranges.prevStart, ranges.prevEnd);

  // 2) populate main metric values (same formatting you used)
  const spendEl = document.getElementById("totalSpend");
  if (spendEl) {
    const val = Number(currentAgg.totalSpend || 0);
    spendEl.textContent = `KES ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  document.getElementById("impressions").textContent = Math.round(currentAgg.impressions || 0).toLocaleString();
  document.getElementById("frequency").textContent = (currentAgg.frequency || 0).toFixed(1);
  document.getElementById("totalLeads").textContent = Math.round(currentAgg.totalLeads || 0).toLocaleString();
  document.getElementById("costPerLead").textContent = Math.round(currentAgg.costPerLead || 0) + " KES";
  document.getElementById("ctr").textContent = (currentAgg.ctr || 0).toFixed(1) + "%";
  document.getElementById("linkCtr").textContent = (currentAgg.linkCtr || 0).toFixed(1) + "%";
  document.getElementById("cpm").textContent = Math.round(currentAgg.cpm || 0) + " KES";
  document.getElementById("cpc").textContent = Math.round(currentAgg.cpc || 0) + " KES";

  // For totals that depend on sales table, keep your existing async fetch
  try {
    const totalSalesValue = await fetchTotalSales(businessId, period);
    const totalSalesEl = document.getElementById("totalSales");
    if (totalSalesEl) {
      totalSalesEl.textContent = `KES ${Number(totalSalesValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    const roasValue = currentAgg.totalSpend > 0 ? totalSalesValue / currentAgg.totalSpend : 0;
    const roasEl = document.getElementById("roas");
    if (roasEl) roasEl.textContent = `${roasValue.toFixed(2)}x`;

    // conversion rate: keep your existing logic if you prefer (we'll just show from aggregated)
    const conversionRateEl = document.getElementById("conversionRate");
    if (conversionRateEl) conversionRateEl.textContent = (currentAgg.conversionRate || 0).toFixed(1) + "%";
  } catch (e) {
    console.warn("[DEBUG] error fetching sales/roas in new updateAdDataForPeriod", e);
  }

  // 3) compute and render percent changes for each metric (use prevAgg)
  // For CPM and CPC pass lowerIsBetter = true
  renderChange('impressionsChange', currentAgg.impressions || 0, prevAgg.impressions || 0, false);
  renderChange('frequencyChange', currentAgg.frequency || 0, prevAgg.frequency || 0, false);
  renderChange('totalLeadsChange', currentAgg.totalLeads || 0, prevAgg.totalLeads || 0, false);
  renderChange('costPerLeadChange', currentAgg.costPerLead || 0, prevAgg.costPerLead || 0, false);
  renderChange('ctrChange', currentAgg.ctr || 0, prevAgg.ctr || 0, false);
  renderChange('linkCtrChange', currentAgg.linkCtr || 0, prevAgg.linkCtr || 0, false);
  renderChange('cpmChange', currentAgg.cpm || 0, prevAgg.cpm || 0, true);   // lower is better
  renderChange('cpcChange', currentAgg.cpc || 0, prevAgg.cpc || 0, true);   // lower is better

  // Also set changes for money metrics (totalSpend, totalSales, roas, conversionRate)
  renderChange('totalSpendChange', currentAgg.totalSpend || 0, prevAgg.totalSpend || 0, false);
  // If you fetched totalSalesValue earlier, you could compare sales across periods by computing prev sales similarly (not covered here) --
  // As a simple approach, we can compare roas via aggregated fields if present:
  renderChange('roasChange', (Number(document.getElementById('roas')?.textContent?.replace('x','')||0)), (prevAgg.roas || 0), false);
  renderChange('conversionRateChange', currentAgg.conversionRate || 0, prevAgg.conversionRate || 0, false);

  // 4) update "last updated" and charts as before
  const lastUpdatedEl = document.getElementById("last-updated");
  if (lastUpdatedEl) lastUpdatedEl.textContent = new Date().toLocaleString();

  // keep your existing chart load call but pass a simple default
  loadCharts('days');
}

async function loadCharts(period = 'days') {
  console.log(`[DEBUG] Attempting to load charts for period: ${period}`);

  // Destroy previous chart instances to prevent duplicates
  if (adSalesChartInstance) adSalesChartInstance.destroy();
  if (topAdsChartInstance) topAdsChartInstance.destroy();
  

  /* -------------------------------------------------------------------------- */
  /*  🟢 1. Fetch Ad Spend & Sales from Supabase                                */
  /* -------------------------------------------------------------------------- */
  try {
    // Fetch ad spend
    const { data: adsData, error: adsError } = await supabase
      .from('ads')
      .select('date, total_spend')
      .eq('business_id', businessId);

    if (adsError) throw adsError;

    // Fetch sales
    const { data: salesData, error: salesError } = await supabase
      .from('sales')
      .select('timestamp, amount')
      .eq('business_id', businessId);

    if (salesError) throw salesError;

    // Group data by day or month
    const grouped = {};
    if (period === 'days') {
      adsData.forEach(a => {
        const d = a.date;
        if (!grouped[d]) grouped[d] = { spend: 0, sales: 0 };
        grouped[d].spend += Number(a.total_spend || 0);
      });
      salesData.forEach(s => {
        const d = s.timestamp.split('T')[0];
        if (!grouped[d]) grouped[d] = { spend: 0, sales: 0 };
        grouped[d].sales += Number(s.amount || 0);
      });
    } else if (period === 'months') {
      adsData.forEach(a => {
        const m = a.date.slice(0, 7); // YYYY-MM
        if (!grouped[m]) grouped[m] = { spend: 0, sales: 0 };
        grouped[m].spend += Number(a.total_spend || 0);
      });
      salesData.forEach(s => {
        const m = s.timestamp.slice(0, 7);
        if (!grouped[m]) grouped[m] = { spend: 0, sales: 0 };
        grouped[m].sales += Number(s.amount || 0);
      });
    }

    // Prepare chart arrays
    const labels = Object.keys(grouped).sort();
    const spendData = labels.map(l => grouped[l].spend);
    const salesSeries = labels.map(l => grouped[l].sales);

    /* -------------------------------------------------------------------------- */
    /*  🧾 2. Render Ad Spend vs Sales Chart                                     */
    /* -------------------------------------------------------------------------- */
    const adSalesCtx = document.getElementById('adSalesChart');
    if (adSalesCtx) {
      adSalesChartInstance = new Chart(adSalesCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Ad Spend (KES)',
              data: spendData,
              borderColor: 'rgba(255, 99, 132, 1)',
              backgroundColor: 'rgba(255, 99, 132, 0.15)',
              tension: 0.3,
              fill: true,
            },
            {
              label: 'Sales (KES)',
              data: salesSeries,
              borderColor: 'rgba(16, 185, 129, 1)',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              tension: 0.3,
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'KES' },
            },
            x: {
              title: {
                display: true,
                text: period === 'days' ? 'Days' : 'Months',
              },
            },
          },
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                afterBody: items => {
                  const i = items[0].dataIndex;
                  const spend = spendData[i];
                  const sales = salesSeries[i];
                  const roas =
                    spend > 0 ? (sales / spend).toFixed(2) + 'x' : 'N/A';
                  return `ROAS: ${roas}`;
                },
              },
            },
          },
        },
      });
    }
    /* -------------------------------------------------------------------------- */
/*  🟣 2. Leads vs Converted Leads Chart                                      */
/* -------------------------------------------------------------------------- */
try {
  // 1️⃣ Fetch ad leads/messages
  const { data: adsData2, error: adsErr2 } = await supabase
    .from('ads')
    .select('date, leads, messages_started')
    .eq('business_id', businessId);

  if (adsErr2) throw adsErr2;

  // 2️⃣ Fetch sales count
  const { data: salesData2, error: salesErr2 } = await supabase
    .from('sales')
    .select('timestamp')
    .eq('business_id', businessId);

  if (salesErr2) throw salesErr2;

  // 3️⃣ Group & aggregate
  const groupedLeads = {};
  if (period === 'days') {
    adsData2.forEach(a => {
      const d = a.date;
      if (!groupedLeads[d]) groupedLeads[d] = { leads: 0, converted: 0 };
      groupedLeads[d].leads += Number(a.leads || 0) + Number(a.messages_started || 0);
    });
    salesData2.forEach(s => {
      const d = s.timestamp.split('T')[0];
      if (!groupedLeads[d]) groupedLeads[d] = { leads: 0, converted: 0 };
      groupedLeads[d].converted += 1;
    });
  } else {
    adsData2.forEach(a => {
      const m = a.date.slice(0, 7);
      if (!groupedLeads[m]) groupedLeads[m] = { leads: 0, converted: 0 };
      groupedLeads[m].leads += Number(a.leads || 0) + Number(a.messages_started || 0);
    });
    salesData2.forEach(s => {
      const m = s.timestamp.slice(0, 7);
      if (!groupedLeads[m]) groupedLeads[m] = { leads: 0, converted: 0 };
      groupedLeads[m].converted += 1;
    });
  }

  // 4️⃣ Prepare chart arrays
  const labels2 = Object.keys(groupedLeads).sort();
  const totalLeads = labels2.map(l => groupedLeads[l].leads);
  const convertedLeads = labels2.map(l => groupedLeads[l].converted);
  const conversionRate = labels2.map(l => {
    const { leads, converted } = groupedLeads[l];
    return leads > 0 ? ((converted / leads) * 100).toFixed(1) : 0;
  });

  // 5️⃣ Render chart
  const leadsCtx = document.getElementById('leadsChart');
  if (leadsCtx) {
    if (window.leadsChartInstance) window.leadsChartInstance.destroy();

    window.leadsChartInstance = new Chart(leadsCtx.getContext('2d'), {
      data: {
        labels: labels2,
        datasets: [
          {
            type: 'bar',
            label: 'Total Leads',
            data: totalLeads,
            backgroundColor: 'rgba(59, 130, 246, 0.6)',
          },
          {
            type: 'bar',
            label: 'Converted Leads',
            data: convertedLeads,
            backgroundColor: 'rgba(16, 185, 129, 0.6)',
          },
          {
            type: 'line',
            label: 'Conversion Rate (%)',
            data: conversionRate,
            yAxisID: 'y2',
            borderColor: 'rgba(255, 206, 86, 1)',
            backgroundColor: 'rgba(255, 206, 86, 0.3)',
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Leads Count' },
          },
          y2: {
            beginAtZero: true,
            position: 'right',
            title: { display: true, text: 'Conversion Rate (%)' },
            grid: { drawOnChartArea: false },
          },
          x: {
            title: { display: true, text: period === 'days' ? 'Days' : 'Months' },
          },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              afterBody: items => {
                const i = items[0].dataIndex;
                return `Conversion Rate: ${conversionRate[i]}%`;
              },
            },
          },
        },
      },
    });
  }
} catch (err2) {
  console.error('[DEBUG] Error rendering leads chart:', err2);
}

    /* -------------------------------------------------------------------------- */
    /*  🟣 3. Keep Top-Ads Chart Placeholder (Dummy for now)                     */
    /* -------------------------------------------------------------------------- */
    const topAdsCtx = document.getElementById('topAdsChart');
    if (topAdsCtx) {
      topAdsChartInstance = new Chart(topAdsCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['Ad 1', 'Ad 2', 'Ad 3', 'Ad 4', 'Ad 5'],
          datasets: [
            {
              label: 'Impressions',
              data: [5000, 4500, 4000, 3500, 3000],
              backgroundColor: 'rgba(59, 130, 246, 0.5)',
            },
            {
              label: 'Clicks',
              data: [150, 120, 100, 80, 60],
              backgroundColor: 'rgba(16, 185, 129, 0.5)',
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'top' },
          },
        },
      });
    }
  } catch (err) {
    console.error('[DEBUG] Error loading charts:', err);
  }
}


// --- On DOMContentLoaded
document.addEventListener("DOMContentLoaded", function() {
    console.log("-----------------------------------------");
    console.log("[DEBUG] DOMContentLoaded fired. Initializing.");
    
    // If already logged in, skip login form
    const savedUser = getLoggedInUser();
    
    if (savedUser) {
        console.log("[DEBUG] Stored user found. Attempting to show dashboard directly.");
        // Use stored data for immediate dashboard display
        showDashboard(savedUser, savedUser.phone); 
    } else {
        console.log("[DEBUG] No stored user. Showing login container.");
        document.getElementById("login-container").style.display = "flex";
        document.getElementById("dashboard-container").style.display = "none";
        const loginForm = document.getElementById("login-form");
        if (loginForm) loginForm.addEventListener("submit", handleLogin);
    }
    
    // Logout
    const logoutBtn = document.getElementById("dropdown-logout-btn");
    if (logoutBtn) logoutBtn.onclick = logout;
    // Profile Dropdown Toggle Logic
    const profileMenuButton = document.getElementById("profile-menu-button");
    const profileDropdown = document.getElementById("profile-dropdown");

    // Close the dropdown if the user clicks outside of it
    document.addEventListener('click', function(event) {
        // Check if the click is outside the button and the dropdown
        if (profileMenuButton && profileDropdown && !profileMenuButton.contains(event.target) && !profileDropdown.contains(event.target)) {
            profileDropdown.classList.add('hidden');
        }
    });

    // Day selector event listeners
    const dayOptions = document.querySelectorAll('.day-option');
    dayOptions.forEach(option => {
        option.addEventListener('click', function() {
            console.log(`[DEBUG] Day option clicked: ${this.getAttribute('data-day')}`);
            // Remove active class from all
            dayOptions.forEach(opt => {
                opt.classList.remove('bg-blue-600', 'text-white', 'font-semibold');
                opt.classList.add('bg-[#2b2f3a]', 'text-white');
            });
            // Add active to clicked
            this.classList.remove('bg-[#2b2f3a]');
            this.classList.add('bg-blue-600', 'text-white', 'font-semibold');
            // Update data
            const period = this.getAttribute('data-day');
            updateAdDataForPeriod(period);
        });
    });

    // Metric help popup functionality
    const metricDescriptions = {
        impressions: "The total number of times your ads were displayed.",
        frequency: "The average number of times each person saw your ad.",
        totalLeads: "The number of potential customers who showed interest in your business.",
        costPerLead: "The average cost to get one new lead. A key metric for profitability.",
        ctr: "The rate at which people click on your ad after seeing it. Higher is better.",
        linkCtr: "The click-through rate specifically for links in your ads.",
        cpm: "The cost to show your ad to 1,000 people. A good way to measure ad efficiency.",
        cpc: "The cost per click on your ad. Lower is generally better."
    };

    const metricHelpIcons = document.querySelectorAll('.metric-help');
    const metricPopup = document.getElementById('metric-popup');
    const metricDescriptionEl = document.getElementById('metric-description');

    metricHelpIcons.forEach(icon => {
        icon.addEventListener('click', function() {
            const metric = this.getAttribute('data-metric');
            const description = metricDescriptions[metric];
            if (description) {
                metricDescriptionEl.textContent = description;
                metricPopup.style.display = 'flex';
            }
        });
    });

    // Close popup when clicking outside
    metricPopup.addEventListener('click', function(e) {
        if (e.target === metricPopup) {
            metricPopup.style.display = 'none';
        }
    });
  document
  .getElementById('salesSpendDayBtn')
  .addEventListener('click', () => loadCharts('days'));
  document
  .getElementById('salesSpendMonthBtn')
  .addEventListener('click', () => loadCharts('months'));

  document.getElementById('leadsDayBtn').addEventListener('click', () => loadCharts('days'));
  document.getElementById('leadsMonthBtn').addEventListener('click', () => loadCharts('months'));


    // Mobile menu toggle
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('-translate-x-full');
        });

        // Close sidebar when clicking outside (not on sidebar or hamburger)
        document.addEventListener('click', (event) => {
            if (!sidebar.contains(event.target) && !menuToggle.contains(event.target) && !sidebar.classList.contains('-translate-x-full')) {
                sidebar.classList.add('-translate-x-full');
            }
        });
    }

    console.log("-----------------------------------------");
});