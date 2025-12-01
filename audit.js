/* ============================
   CLEANED AUDIT.JS WITH RUN-ONCE LOGIC
   ============================ */

// Read configuration (set in `config.js`) when available; fallback to defaults.
const APP_CONFIG = (window && window.__APP_CONFIG) ? window.__APP_CONFIG : {};
const SUPABASE_URL = APP_CONFIG.SUPABASE_URL || "https://xgtnbxdxbbywvzrttixf.supabase.co";
const SUPABASE_KEY = APP_CONFIG.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ";
const API_URL = `${SUPABASE_URL}/rest/v1/audit_results`;
const AUDIT_START_URL = "/functions/v1/audit-start";

let auditPolling = null;
let lastPollState = null;

/* -----------------------------
   DOM HELPERS
------------------------------ */

function $(id) {
  return document.getElementById(id);
}

// Safe helper: return trimmed value from the first matching id
function getElValueByIds(...ids) {
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    // input, textarea, select
    if (typeof el.value !== "undefined") return String(el.value).trim();
    // other elements (data attributes / textContent)
    if (typeof el.textContent !== "undefined") return String(el.textContent).trim();
  }
  return "";
}

// Resolve business id from DOM, URL params, or localStorage
function resolveBusinessId() {
  // 0) Prefer the shared auth util used across the app (login populates vvUser)
  try {
    if (window.authUtils && typeof window.authUtils.getBusinessId === "function") {
      const bid = window.authUtils.getBusinessId();
      if (bid) return String(bid).trim();
    }
  } catch (e) {
    // ignore
  }

  // 1) DOM inputs
  const fromDom = getElValueByIds("business_id", "businessId", "inputBusiness");
  if (fromDom) return fromDom;

  // 2) URL search params
  try {
    const params = new URLSearchParams(window.location.search);
    const viaUrl = params.get("business_id") || params.get("businessId") || params.get("id");
    if (viaUrl) return viaUrl.trim();
  } catch (e) {
    // ignore
  }

  // 3) localStorage
  try {
    // Prefer direct business_id keys
    const ls = localStorage.getItem("business_id") || localStorage.getItem("businessId");
    if (ls) return ls.trim();

    // Many pages store the logged in user as `vvUser` — parse it for business_id
    const rawUser = localStorage.getItem('vvUser');
    if (rawUser) {
      try {
        const u = JSON.parse(rawUser);
        if (u && (u.business_id || u.businessId)) return String(u.business_id || u.businessId).trim();
      } catch (e) {
        // ignore parse errors
      }
    }
  } catch (e) {
    // ignore (e.g., disabled storage)
  }

  return "";
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function showScreen(id) {
  ["screen-input", "screen-loading", "screen-results"].forEach((s) =>
    $(s).classList.add("hidden")
  );
  $(id).classList.remove("hidden");
}

function showError(msg) {
  const el = $("loading-error");
  el.textContent = msg || "Something went wrong.";
  el.classList.remove("hidden");
}

function hideError() {
  $("loading-error").classList.add("hidden");
}

/* -----------------------------
   PAGE LOAD: CHECK IF USER ALREADY HAS RESULTS
------------------------------ */

window.addEventListener("DOMContentLoaded", checkPreviousAudit);

async function checkPreviousAudit() {
  hideError();

  // Resolve business id from DOM / URL / localStorage. If none, show input.
  const business_id = resolveBusinessId();
  if (!business_id) {
    console.warn("No business ID provided (DOM / URL / localStorage).");
    return showScreen("screen-input");
  }

  try {
    const url = `${API_URL}?business_id=eq.${business_id}&select=*`;
    const res = await fetch(url, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });

    if (!res.ok) return showScreen("screen-input");

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      // No audits yet for this business id
      return showScreen("screen-input");
    }

    // Check if any successful audit exists (errors null)
    const successful = data.find((d) => !d.errors);

    if (successful) {
      showResults(successful);
      return;
    }

    // Only failed results exist → user can retry
    showScreen("screen-input");

  } catch (err) {
    console.error("Initial audit check error:", err);
    showScreen("screen-input");
  }
}

/* -----------------------------
   START AUDIT
------------------------------ */

async function startAudit() {
  hideError();
  // read values with fallbacks to the IDs present in the HTML or URL/localStorage
  const business_id = resolveBusinessId();
  const website = getElValueByIds("website", "inputUrl");
  const facebook = getElValueByIds("facebook", "inputFb");
  const instagram = getElValueByIds("instagram", "inputIg");
  const plan_level = getElValueByIds("plan_level") || "free";

  if (!business_id) return showError("Please enter your business ID.");

  if (website && !website.startsWith("http")) return showError("Invalid website link.");
  if (facebook && !facebook.includes("facebook.com")) return showError("Invalid Facebook link.");
  if (instagram && !instagram.includes("instagram.com")) return showError("Invalid Instagram link.");

  showScreen("screen-loading");
  setText("loading-text", "Checking links...");

  try {
    const res = await fetch(AUDIT_START_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id, website, facebook, instagram, plan_level })
    });

    if (!res.ok) return showError("Could not start audit.");

    const { audit_id } = await res.json();

    if (!audit_id) return showError("Audit failed to start.");

    setText("loading-text", "Audit started...");
    // store a transient business id if provided in the form so future page loads can detect it
    try { if (business_id) localStorage.setItem('business_id', business_id); } catch (e) {}
    beginPolling(audit_id);

  } catch (err) {
    console.error(err);
    showError("Network error, try again.");
  }
}

/* -----------------------------
   BEGIN POLLING
------------------------------ */

function beginPolling(auditId) {
  lastPollState = null;

  auditPolling = setInterval(() => {
    pollForResults(auditId);
  }, 2000);

  setText("loading-text", "Auditing your platforms...");
}

/* -----------------------------
   POLL RESULTS
------------------------------ */

async function pollForResults(auditId) {
  try {
    const url = `${API_URL}?audit_id=eq.${auditId}&select=*`;
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) return;

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      updateLoadingText();
      return;
    }

    const result = data[0];

    if (result.errors) {
      clearInterval(auditPolling);
      return showAuditError(result.errors);
    }

    clearInterval(auditPolling);
    showResults(result);

  } catch (err) {
    console.error("Polling error:", err);
  }
}

/* -----------------------------
   UPDATE LOADING TEXT
------------------------------ */

function updateLoadingText() {
  const steps = [
    "Auditing your website...",
    "Checking Facebook...",
    "Checking Instagram...",
    "Analyzing with AI...",
    "Finalizing results..."
  ];

  if (lastPollState === null) lastPollState = 0;
  else lastPollState = (lastPollState + 1) % steps.length;

  setText("loading-text", steps[lastPollState]);
}

/* -----------------------------
   SHOW AUDIT ERROR
------------------------------ */

function showAuditError(errObj) {
  const errText =
    typeof errObj === "string" ? errObj : JSON.stringify(errObj, null, 2);

  setText("loading-text", "Audit failed.");
  showError(errText);

  setTimeout(() => {
    showScreen("screen-input");
  }, 2000);
}

/* -----------------------------
   SHOW RESULTS
------------------------------ */

function showResults(result) {
  showScreen("screen-results");

  // Populate the debug box and a simple summary card area
  const debugRaw = $("debugRawAudit");
  if (debugRaw) debugRaw.textContent = JSON.stringify(result, null, 2);

  const debugContainer = $("debug-audit-raw");
  if (debugContainer) debugContainer.classList.remove("hidden");

  const cards = $("results-cards");
  if (cards) {
    const summary = result.summary || "No summary available.";
    const score = result.overall_score ?? "N/A";
    cards.innerHTML = `\
      <div class="col-span-2 bg-[#0b0d10] p-6 rounded-xl border border-[#22252b]">\
        <h3 class="text-lg font-bold mb-2">Summary</h3>\
        <p class="text-white/80">${summary}</p>\
      </div>\
      <div class="bg-[#0b0d10] p-6 rounded-xl border border-[#22252b] flex items-center justify-center">\
        <div>\
          <div class="text-sm text-white/60">Overall score</div>\
          <div class="text-3xl font-bold">${score}</div>\
        </div>\
      </div>\
    `;
  }

  // Persist the business id so future loads can skip the input screen
  try {
    const bid = result.business_id || result.businessId || resolveBusinessId();
    if (bid) localStorage.setItem("business_id", bid);
  } catch (e) {
    // ignore storage errors
  }
}

/* -----------------------------
   EXPORT FUNCTIONS FOR HTML
------------------------------ */
window.startAudit = startAudit;

// Bind start button (if present) so users can trigger the audit
document.addEventListener("DOMContentLoaded", () => {
  const btn = $("startAuditBtn");
  if (btn && !btn._bound) {
    btn.addEventListener("click", startAudit);
    btn._bound = true;
  }
});
