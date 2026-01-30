// --- Supabase Configuration (matching `dashboard.js` import style) ---
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { showRenewalPopup } from './dashboard.js';

const supabaseUrl = 'https://xgtnbxdxbbywvzrttixf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';

const supabase = createClient(supabaseUrl, supabaseKey);

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
      // Do NOT fallback to phone-derived business id during tests
      businessId = user.business_id || user['business id'] || null;
      console.log(`[DEBUG] Found stored user. Business ID set to: ${businessId}`);
    } else {
        console.log("[DEBUG] No stored user found.");
    }
    return user;
}

function logout() {
  console.log("[DEBUG] Logging out: Clearing localStorage and redirecting to login.");
  localStorage.removeItem("vvUser");
  window.location.href = 'index.html';
}

// --- UI Switch ---
function showDashboard(userData, rawPhone) {
    console.log("[DEBUG] Entering showDashboard function.");
    
    loggedInUser = userData;
    // Set business ID from fetched data (no fallback to phone)
    businessId = userData['business id'] || userData.business_id || null;
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
    // Show admin first name in small profile area and use its initial for avatar
    const adminFirstName = (adminName && typeof adminName === 'string') ? adminName.split(' ')[0] : adminName;
    const profileNameEl = document.getElementById("profileName");
    if (profileNameEl) profileNameEl.textContent = adminFirstName || businessName;
    const avatarEl = document.getElementById("profile-avatar");
    if (avatarEl) avatarEl.textContent = (adminFirstName && adminFirstName[0]) ? adminFirstName.charAt(0).toUpperCase() : (adminName && adminName[0] ? adminName.charAt(0).toUpperCase() : 'A');
    console.log(`[DEBUG] Header updated: Business Name: ${businessName}, Admin Name: ${adminName}`);
    
    // Package bar logic (now the comprehensive function)
    updateSubscriptionStatus(userData);
    
    // Load ads data
    fetchAdResults(businessId);

    // Wait for essential UI elements (admin, business, package) to appear before hiding global loader
    (function waitForEssentials(timeoutMs = 3000){
      const start = Date.now();
      function check(){
        const welcome = document.getElementById('welcomeName')?.textContent?.trim();
        const business = document.getElementById('businessName')?.textContent?.trim();
        const packageText = document.getElementById('packageName')?.textContent?.trim();
        if (welcome && business && packageText) {
          try{ if (window && typeof window.vvAppReady === 'function') { window.vvAppReady(); } else { document.dispatchEvent(new Event('vv-app-ready')); } }catch(e){}
          return;
        }
        if (Date.now() - start < timeoutMs) requestAnimationFrame(check);
        else { try{ if (window && typeof window.vvAppReady === 'function') { window.vvAppReady(); } else { document.dispatchEvent(new Event('vv-app-ready')); } }catch(e){} }
      }
      check();
    })();
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
                  // Do NOT fallback to the normalized phone as a business id; only use values from Supabase
                  business_id: userData['business id'] || userData.business_id || null,
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
        
        // Determine subscription period from package where possible.
        // Default to monthly (30) unless package is Free (3 days) or special mini package.
        let period = 30; // Default to Monthly
        let buttonText = "Renew Subscription";
        let buttonClass = "bg-purple-600 hover:bg-purple-700";
        let pkg = 'Free';
        try {
          const pkgRaw = userData.package || userData.package_name || userData.package_type || '';
          pkg = window.authUtils && window.authUtils.normalizePackageName ? window.authUtils.normalizePackageName(pkgRaw) : (String(pkgRaw).trim() || 'Free');
          if (!pkg || pkg === 'Free') {
            period = 3;
            buttonText = 'Upgrade';
            buttonClass = 'bg-blue-600 hover:bg-blue-700';
          } else {
            period = 30;
            buttonText = 'Renew';
            buttonClass = 'bg-purple-600 hover:bg-purple-700';
          }
        } catch (e) {
          period = 30;
        }
        
        // Logic for package duration based on service name
        if (services.some(s => s.toLowerCase().includes("ads management mini"))) {
          period = 10; // Mini Package
          buttonText = "Go Monthly!"; // Mini button prompts upgrade
          buttonClass = "bg-blue-600 hover:bg-blue-700"; // Mini button is blue
        }

        // Override period to 30 days if renew date exists
        const renewDate = userData['renewed date'] || userData.renewed_date;
        if (renewDate) {
            period = 30;
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

        console.log(`[DEBUG] Subscription Period: ${period} days. Days Remaining: ${daysRemaining}. Total Fees: KES ${totalAmount}`);

        const countdownTextEl = document.getElementById('countdown-text');
        const progressBar = document.getElementById('countdown-bar');
        const btn = document.getElementById('upgrade-button');

        // expose package & remaining days globally for other modules
        try { window.currentPackage = pkg; window.daysRemaining = daysRemaining; } catch (e) {}

        // Update package name label & color if present
        try {
          const pkgKey = (pkg || '').toString().toLowerCase();
          const mapping = { free: 'text-white', growth: 'text-green-400', pro: 'text-amber-400', premium: 'text-purple-400' };
          const packageNameEl = document.getElementById('packageName');
          if (packageNameEl) {
            const display = (pkg || 'Free').toString();
            const disp = display.charAt(0).toUpperCase() + display.slice(1);
            packageNameEl.textContent = disp;
            Object.values(mapping).forEach(c=>packageNameEl.classList.remove(c));
            const cls = mapping[pkgKey] || 'text-white';
            packageNameEl.classList.add(cls);
          }
        } catch (e) {}

        // Hide business copilot section for Free users
        try {
          const copilotSection = document.getElementById('business-copilot-section');
          if (copilotSection) copilotSection.style.display = (pkg === 'Free') ? 'none' : '';
        } catch (e) {}

        // Lock/unlock sidebar links according to package (Free/Growth/Pro/Premium)
        try {
          const sidebarLinks = Array.from(document.querySelectorAll('#sidebar a'));
          if (!sidebarLinks || sidebarLinks.length === 0) {
            // nothing to do
          } else {
            // derive package (string)
            let thePkg = String(pkg || 'Free').toLowerCase();
            const normKey = (s) => String(s).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
            const allowedFor = {
              free: new Set(['mybusiness']),
              // normalize 'Sales & Follow-Ups' -> 'salesandfollowups'
              // include 'contentcreation' so paid tiers keep Content Creation clickable
              growth: new Set(['mybusiness','ads','salesandfollowups','businessassistant','contentcreation']),
              pro: new Set(['mybusiness','ads','salesandfollowups','businessassistant','aisalesassistant','livechat','contentcreation']),
              premium: null
            };
                const allowed = allowedFor[thePkg] === undefined ? allowedFor['free'] : allowedFor[thePkg];

            sidebarLinks.forEach(link => {
              if (!link) return;
              // If link explicitly marked to always allow, restore and skip locking
              try {
                if (link.dataset && (link.dataset.alwaysAllow === 'true' || link.dataset.alwaysAllow === '1')) {
                  link.classList.remove('text-white/30');
                  link.classList.add('text-white');
                  const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
                  if (link.dataset.origHref) { link.setAttribute('href', link.dataset.origHref); delete link.dataset.origHref; }
                  if (link.dataset.origOnclick) { link.setAttribute('onclick', link.dataset.origOnclick); delete link.dataset.origOnclick; }
                  return;
                }
              } catch (e) {}
              let title = '';
              try {
                const spans = Array.from(link.querySelectorAll('span'));
                const titleSpan = spans.find(s => !s.classList.contains('tooltip')) || spans[0];
                title = titleSpan ? titleSpan.textContent.trim() : (link.textContent || '').trim();
              } catch (e) {
                title = (link.textContent || '').trim();
              }
              const norm = normKey(title);

              if (norm === 'mybusiness') {
                link.classList.remove('text-white/30');
                link.classList.add('text-white');
                const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
                if (link._lockedHandler) { try { link.removeEventListener('click', link._lockedHandler); } catch (e) {} delete link._lockedHandler; }
                if (link.dataset.origHref) { link.setAttribute('href', link.dataset.origHref); delete link.dataset.origHref; }
                if (link.dataset.origOnclick) { link.setAttribute('onclick', link.dataset.origOnclick); delete link.dataset.origOnclick; }
                return;
              }

              if (allowed === null) {
                link.classList.remove('text-white/30');
                link.classList.add('text-white');
                const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
                if (link._lockedHandler) { try { link.removeEventListener('click', link._lockedHandler); } catch (e) {} delete link._lockedHandler; }
                if (link.dataset.origHref) { link.setAttribute('href', link.dataset.origHref); delete link.dataset.origHref; }
                if (link.dataset.origOnclick) { link.setAttribute('onclick', link.dataset.origOnclick); delete link.dataset.origOnclick; }
                return;
              }

              const isAllowed = allowed.has(norm);
              if (isAllowed) {
                link.classList.remove('text-white/30');
                link.classList.add('text-white');
                const existingLock = link.querySelector('.fa-lock'); if (existingLock) existingLock.remove();
                if (link._lockedHandler) { try { link.removeEventListener('click', link._lockedHandler); } catch (e) {} delete link._lockedHandler; }
                if (link.dataset.origHref) { link.setAttribute('href', link.dataset.origHref); delete link.dataset.origHref; }
                if (link.dataset.origOnclick) { link.setAttribute('onclick', link.dataset.origOnclick); delete link.dataset.origOnclick; }
              } else {
                link.classList.remove('text-white');
                link.classList.add('text-white/30');
                if (!link.dataset.origHref) {
                  const h = link.getAttribute('href'); if (h) link.dataset.origHref = h;
                }
                if (!link.dataset.origOnclick) {
                  const oc = link.getAttribute('onclick'); if (oc) link.dataset.origOnclick = oc;
                }
                try { link.removeAttribute('onclick'); } catch (e) {}
                link.setAttribute('href', '#');
                if (!link.querySelector('.fa-lock')) {
                  const lockIcon = document.createElement('i');
                  lockIcon.className = 'fa-solid fa-lock w-3 h-3 text-white/30 ml-auto';
                  link.appendChild(lockIcon);
                }
                // Add a click handler for locked items so Free users see an upgrade prompt
                try {
                  if (!link._lockedHandler) {
                    const handler = function(e) {
                      try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
                      // Determine the minimal package that unlocks this item
                      const tiers = ['free','growth','pro','premium'];
                      const tierNames = { free: 'Free', growth: 'Growth', pro: 'Pro', premium: 'Premium' };
                      let required = 'Premium';
                      for (const t of tiers) {
                        const set = allowedFor[t];
                        if (!set || !(set instanceof Set)) continue;
                        if (set.has(norm)) { required = tierNames[t]; break; }
                      }
                      const itemName = title || (link.textContent || 'this feature').trim();
                      // Friendly message and open upgrade flow if available
                      try { alert(`Get ${required} to unlock ${itemName}`); } catch (err) {}
                      if (window.openUpgradeFlow) window.openUpgradeFlow();
                    };
                    link._lockedHandler = handler;
                    link.addEventListener('click', handler);
                  }
                } catch (e) {}
              }
            });
          }
        } catch (e) {}

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
                btn.onclick = () => showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, false, (period===10? 'Mini Package' : ''));
            }
              showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, false, (period===10? 'Mini Package' : ''));
        } else if (daysRemaining <= 3) {
          if (countdownTextEl) {
            if (pkg === 'Free') {
              countdownTextEl.textContent = `Your Free Trial Ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
            } else {
              countdownTextEl.textContent = `⏳ ${daysRemaining} days remaining in your package.`;
            }
          }
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = finalButtonText;
                // Use red color for general warning, unless it's the "Go Monthly!" button which remains blue.
                const warningClass = (period === 10) ? finalButtonClass : "bg-red-600 hover:bg-red-700";
                btn.className = `w-full ${warningClass} text-white font-semibold py-3 px-4 rounded-xl transition-colors`;
                btn.onclick = () => showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, false, (period===10? 'Mini Package' : ''));
            }
              showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, false, (period===10? 'Mini Package' : ''));
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
                btn.textContent = finalButtonText;
                btn.className = `w-full ${finalButtonClass} text-white font-semibold py-3 px-4 rounded-xl hover:bg-opacity-80 transition-colors`;
            // If Free package, open upgrade flow when clicked; otherwise keep renewal behavior
            if (pkg === 'Free') {
              btn.onclick = () => { if (window.openUpgradeFlow) window.openUpgradeFlow(userData); };
            } else {
              btn.onclick = () => showRenewalPopup(userData, finalButtonText, daysRemaining, totalAmount, false, (period===10? 'Mini Package' : ''));
            }
            }
        }
    });
}

// --- Renewal Popup (Refactored) ---
// Payment flow removed from Ads to reuse central business flow (dashboard.js)


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
    console.log('[DEBUG] Raw adData response length:', (adData || []).length);
    console.log('[DEBUG] Sample adData rows:', (adData && adData.length) ? adData.slice(0,3) : adData);
    if (adData) {
      adData.forEach(row => {
        row.Date = row.date || row.Date; // keep old code working
      });
    }

    // Use the exact schema: business_id (text) and date (date type).
    // Keep the returned docs as-is but normalize legacy Date field pointer.
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

  // Call the helper to update any spend UI that expects a total spend
  try { updateKeyMetricsTotalSpend(); } catch(e) { console.warn('[DEBUG] updateKeyMetricsTotalSpend call failed', e); }

  // Clear any prior status
  const statusEl = document.getElementById("status-message");
  if (statusEl) statusEl.textContent = "";

  // If no ad docs were returned, inform the user explicitly and avoid rendering empty charts
  if (!allAdDocs || allAdDocs.length === 0) {
    if (statusEl) statusEl.textContent = 'No ad metrics found for this business and selected date range.';
    console.warn('[DEBUG] No ad documents returned from Supabase for this business/date range.');
    // Trigger update to render zeros in the metrics UI
    try { updateAdDataForPeriod('today'); } catch (e) { console.warn('updateAdDataForPeriod on empty docs failed', e); }
    return; // nothing further to do
  }

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
  // Defensive sums for actual fields returned by Supabase
  let impressionsSum = 0;
  let reachSum = 0;
  let clicksSum = 0;
  let leadsSum = 0;
  let messagesStartedSum = 0;
  let conversionsSum = 0;
  let totalSpend = 0;

  docs.forEach(doc => {
    const safe = v => (v === undefined || v === null || v === '') ? 0 : Number(v);
    impressionsSum += safe(doc.impressions || doc.Impressions);
    reachSum += safe(doc.reach || doc.Reach);
    clicksSum += safe(doc.clicks || doc.Clicks);
    leadsSum += safe(doc.leads || doc.lead_count || 0);
    messagesStartedSum += safe(doc.messages_started || 0);
    conversionsSum += safe(doc.conversions || 0);

    const spendVal = (doc.total_spend !== undefined && doc.total_spend !== null) ? Number(doc.total_spend)
      : (doc.Spend !== undefined && doc.Spend !== null) ? Number(doc.Spend)
      : (doc.spend !== undefined && doc.spend !== null) ? Number(doc.spend)
      : 0;
    totalSpend += isFinite(spendVal) ? spendVal : 0;
  });

  // Derived metrics
  const impressions = impressionsSum;
  const frequency = reachSum > 0 ? (impressionsSum / reachSum) : 0; // avg times a person saw an ad
  const totalLeads = leadsSum + messagesStartedSum; // consider messages as leads as well
  const costPerLead = totalLeads > 0 ? (totalSpend / totalLeads) : 0;
  const ctr = impressionsSum > 0 ? ((clicksSum / impressionsSum) * 100) : 0;
  // linkCtr not available explicitly; fall back to ctr where appropriate
  const linkCtr = ctr;
  const cpm = impressionsSum > 0 ? (totalSpend / (impressionsSum / 1000)) : 0;
  const cpc = clicksSum > 0 ? (totalSpend / clicksSum) : 0;
  const conversionRate = totalLeads > 0 ? ((conversionsSum / totalLeads) * 100) : 0;

  // totalSales and roas will be handled by fetchTotalSales and updateAdDataForPeriod
  const aggregated = {
    impressions,
    frequency,
    totalLeads,
    costPerLead,
    ctr,
    linkCtr,
    cpm,
    cpc,
    totalSpend: Math.round((totalSpend + Number.EPSILON) * 100) / 100,
    totalSales: 0,
    roas: 0,
    conversionRate
  };

  console.log("[DEBUG] Aggregation complete.", aggregated);
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

// Fetch total sales using explicit start/end Date objects (inclusive start, exclusive end)
async function fetchTotalSalesForRange(businessId, startDateObj, endDateObj) {
  try {
    const startISO = startDateObj.toISOString();
    const endISO = endDateObj.toISOString();
    const { data, error } = await supabase
      .from('sales')
      .select('amount, timestamp')
      .eq('business_id', businessId)
      .gte('timestamp', startISO)
      .lt('timestamp', endISO);

    if (error) throw error;
    const totalSales = (data || []).reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0);
    console.log(`[DEBUG] Total Sales fetched for range ${startISO} - ${endISO}: ${totalSales}`);
    return totalSales;
  } catch (err) {
    console.error('[DEBUG] Error in fetchTotalSalesForRange', err);
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
 * Set the global `dateRangeStart` and `dateRangeEnd` strings (YYYY-MM-DD)
 * based on a logical period like 'today', 'yesterday', 'thisWeek', etc.
 */
function setDateRangeForPeriod(period) {
  const ranges = getPeriodRanges(period);
  const pad = (n) => n.toString().padStart(2, '0');
  const toYMD = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  dateRangeStart = toYMD(ranges.start);
  // Use the day before 'end' as inclusive end date when presenting YYYY-MM-DD
  const endInclusive = new Date(ranges.end.getFullYear(), ranges.end.getMonth(), ranges.end.getDate() - 1);
  dateRangeEnd = toYMD(endInclusive);
  console.log('[DEBUG] dateRange set:', { dateRangeStart, dateRangeEnd });
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

  // If the current user is Free, hardcode key business metrics to zero
  try {
    if (window.currentPackage === 'Free') {
      currentAgg.impressions = 0;
      currentAgg.frequency = 0;
      currentAgg.totalLeads = 0;
      currentAgg.costPerLead = 0;
      currentAgg.ctr = 0;
      currentAgg.linkCtr = 0;
      currentAgg.cpm = 0;
      currentAgg.cpc = 0;
      currentAgg.totalSpend = 0;
      currentAgg.totalSales = 0;
      currentAgg.roas = 0;
      currentAgg.conversionRate = 0;
    }
  } catch (e) {}

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
    if (window.currentPackage === 'Free') {
      const totalSalesEl = document.getElementById("totalSales");
      if (totalSalesEl) totalSalesEl.textContent = `KES 0.00`;
      const roasEl = document.getElementById("roas");
      if (roasEl) roasEl.textContent = `0.00x`;
      const conversionRateEl = document.getElementById("conversionRate");
      if (conversionRateEl) conversionRateEl.textContent = `0.0%`;

      // render changes comparing zeros
      renderChange('totalSpendChange', 0, 0);
      renderChange('totalSalesChange', 0, 0);
      renderChange('roasChange', 0, 0);
    } else {
      // Fetch sales totals for current and previous ranges
      const totalSalesCurrent = await fetchTotalSalesForRange(businessId, ranges.start, ranges.end);
      const totalSalesPrev = await fetchTotalSalesForRange(businessId, ranges.prevStart, ranges.prevEnd);

      const totalSalesEl = document.getElementById("totalSales");
      if (totalSalesEl) {
        totalSalesEl.textContent = `KES ${Number(totalSalesCurrent || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }

      // compute ROAS for both periods
      const roasCurrent = currentAgg.totalSpend > 0 ? (totalSalesCurrent / currentAgg.totalSpend) : 0;
      const roasPrev = prevAgg.totalSpend > 0 ? (totalSalesPrev / prevAgg.totalSpend) : 0;

      const roasEl = document.getElementById("roas");
      if (roasEl) roasEl.textContent = `${roasCurrent.toFixed(2)}x`;

      const conversionRateEl = document.getElementById("conversionRate");
      if (conversionRateEl) conversionRateEl.textContent = (currentAgg.conversionRate || 0).toFixed(1) + "%";

      // Render percent changes for money metrics
      renderChange('totalSpendChange', currentAgg.totalSpend || 0, prevAgg.totalSpend || 0, false);
      renderChange('totalSalesChange', totalSalesCurrent || 0, totalSalesPrev || 0, false);
      renderChange('roasChange', roasCurrent || 0, roasPrev || 0, false);
    }
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
    // Fetch ad spend within selected date range
    console.log('[DEBUG] loadCharts using dateRange:', { dateRangeStart, dateRangeEnd });
    const { data: adsData, error: adsError } = await supabase
      .from('ads')
      .select('date, total_spend')
      .eq('business_id', businessId)
      .gte('date', dateRangeStart)
      .lte('date', dateRangeEnd);

    if (adsError) throw adsError;

    // Fetch sales within selected date range (use timestamp bounds)
    const startISO = new Date(dateRangeStart + 'T00:00:00').toISOString();
    const endISO = new Date(new Date(dateRangeEnd + 'T00:00:00').getTime() + (24*60*60*1000)).toISOString();

    console.log('[DEBUG] loadCharts fetching sales with timestamp bounds:', { startISO, endISO });

    const { data: salesData, error: salesError } = await supabase
      .from('sales')
      .select('timestamp, amount')
      .eq('business_id', businessId)
      .gte('timestamp', startISO)
      .lt('timestamp', endISO); // use exclusive end to avoid double-counting

    if (salesError) throw salesError;

    // If both ad and sales data are empty, skip chart rendering and notify user
    if ((!adsData || adsData.length === 0) && (!salesData || salesData.length === 0)) {
      const statusEl2 = document.getElementById('status-message');
      if (statusEl2) statusEl2.textContent = 'No ad or sales data available for the selected date range.';
      console.warn('[DEBUG] No adsData and no salesData for selected dateRange — skipping charts.');
      // Destroy previous chart instances to ensure UI is clean
      if (adSalesChartInstance) { try { adSalesChartInstance.destroy(); } catch (e) {} }
      if (topAdsChartInstance) { try { topAdsChartInstance.destroy(); } catch (e) {} }
      return;
    }

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
    const rawLabels = Object.keys(grouped).sort();
    const labels = rawLabels.map(l => {
      const dt = new Date(l + '-01');
      return isNaN(dt) ? l : dt.toLocaleString(undefined, { month: 'short', year: 'numeric' });
    });
    const spendData = rawLabels.map(l => grouped[l].spend);
    const salesSeries = rawLabels.map(l => grouped[l].sales);

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
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, usePointStyle: true } },
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
  // 1️⃣ Fetch ad leads/messages within selected date range
  const { data: adsData2, error: adsErr2 } = await supabase
    .from('ads')
    .select('date, leads, messages_started')
    .eq('business_id', businessId)
    .gte('date', dateRangeStart)
    .lte('date', dateRangeEnd);

  if (adsErr2) throw adsErr2;

  // 2️⃣ Fetch sales count within selected date range
  const { data: salesData2, error: salesErr2 } = await supabase
    .from('sales')
    .select('timestamp')
    .eq('business_id', businessId)
    .gte('timestamp', startISO)
    .lte('timestamp', endISO);

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
  const rawLabels2 = Object.keys(groupedLeads).sort();
  const labels2 = rawLabels2.map(l => {
    const dt = new Date(l + '-01');
    return isNaN(dt) ? l : dt.toLocaleString(undefined, { month: 'short', year: 'numeric' });
  });
  const totalLeads = rawLabels2.map(l => groupedLeads[l].leads);
  const convertedLeads = rawLabels2.map(l => groupedLeads[l].converted);
  const conversionRate = rawLabels2.map(l => {
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
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, usePointStyle: true } },
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
      console.log("[DEBUG] No stored user. Redirecting to My Businesses login if no local login present.");
      // If this ads page still contains its own login container, allow it to show.
      // Otherwise redirect to the centralized My Businesses login at `index.html`.
      const loginEl = document.getElementById("login-container");
      if (loginEl) {
        loginEl.style.display = "flex";
        const dashboardEl = document.getElementById("dashboard-container");
        if (dashboardEl) dashboardEl.style.display = "none";
        const loginForm = document.getElementById("login-form");
        if (loginForm) loginForm.addEventListener("submit", handleLogin);
      } else {
        window.location.href = 'index.html';
      }
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
        const period = this.getAttribute('data-day');
        console.log(`[DEBUG] Day option clicked: ${period}`);
        // Remove active class from all
        dayOptions.forEach(opt => {
          opt.classList.remove('bg-blue-600', 'text-white', 'font-semibold');
          opt.classList.add('bg-[#2b2f3a]', 'text-white');
        });
        // Add active to clicked
        this.classList.remove('bg-[#2b2f3a]');
        this.classList.add('bg-blue-600', 'text-white', 'font-semibold');

        // 1) compute and set global dateRange strings
        try { setDateRangeForPeriod(period); } catch (e) { console.warn('setDateRangeForPeriod failed', e); }

        // 2) refetch ad results from Supabase for the new date range
        try {
          if (businessId) {
            fetchAdResults(businessId);
          } else {
            console.warn('[DEBUG] No businessId available to fetch ad results for selected period');
          }
        } catch (e) { console.warn('fetchAdResults failed', e); }
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