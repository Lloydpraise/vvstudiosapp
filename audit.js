// audit.js - separated logic for audit.html
// Initialize Supabase client using keys from the project
const SUPABASE_URL = 'https://xgtnbxdxbbywvzrttixf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';
let supabaseClient = null;
try {
  if (!window.supabase) throw new Error('Supabase JS not loaded');
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  console.log('[audit] Supabase client initialized');
} catch (e) {
  console.warn('[audit] Could not initialize Supabase client:', e.message);
}

function normalizeWebsite(raw) {
  if (!raw) return '';
  let url = raw.trim();
  url = url.replace(/^http:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    u.protocol = 'https:';
    let normalized = u.toString();
    if (normalized.endsWith('/') && u.pathname === '/') normalized = normalized.slice(0, -1);
    return normalized;
  } catch (e) {
    return '';
  }
}

function getStoredBusinessInfo() {
  try {
    const raw = localStorage.getItem('vvUser');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        business_id: parsed?.business_id || parsed?.['business id'] || localStorage.getItem('business_id') || null,
        plan_level: (parsed?.package || parsed?.package_name || parsed?.packageType || localStorage.getItem('package') || localStorage.getItem('package_name') || '')
      };
    }
  } catch (e) {}
  return { business_id: localStorage.getItem('business_id') || null, plan_level: localStorage.getItem('package') || localStorage.getItem('package_name') || '' };
}

async function startAudit() {
  const screenInput = document.getElementById('screen-input');
  const screenLoading = document.getElementById('screen-loading');
  const screenResults = document.getElementById('screen-results');
  const statusText = document.getElementById('loading-text');
  const progressBar = document.getElementById('progress-bar');
  const startBtn = document.getElementById('startAuditBtn');

  const rawWebsite = document.getElementById('inputUrl').value || '';
  const website = normalizeWebsite(rawWebsite);
  if (!website) { alert('Please enter a valid website URL'); return; }

  let instagram = (document.getElementById('inputIg').value || '').trim();
  let facebook = (document.getElementById('inputFb').value || '').trim();
  const stored = getStoredBusinessInfo();
  const business_id = stored.business_id;
  const plan_level = stored.plan_level || 'free';

  console.log('[audit] startAudit called', { website, instagram, facebook, business_id, plan_level });

  if (startBtn) { startBtn.disabled = true; startBtn.classList.add('opacity-60','cursor-not-allowed'); }

  // Switch screens
  screenInput.classList.add('hidden');
  screenLoading.classList.remove('hidden');
  screenResults.classList.add('hidden');

  // Start animations
  setTimeout(()=>{ progressBar.classList.add('progress-bar-fill'); progressBar.style.width='100%'; }, 100);

  statusText.textContent = 'Starting Audit...';
  setTimeout(()=>{ statusText.textContent = 'Checking Links...'; }, 450);

  // Validate social links locally before sending to backend
  const loadErrEl = document.getElementById('loading-error');
  function returnToInputWithMessage(msg) {
    try { if (loadErrEl) { loadErrEl.textContent = msg; loadErrEl.classList.remove('hidden'); } } catch(e){}
    // show input screen again so user can correct links
    try { screenLoading.classList.add('hidden'); screenInput.classList.remove('hidden'); } catch(e){}
    if (startBtn) { startBtn.disabled = false; startBtn.classList.remove('opacity-60','cursor-not-allowed'); }
  }

  // Relaxed Instagram validation: accept usernames, @handles, or full URLs; normalize to https://instagram.com/handle
  if (instagram) {
    console.log('[audit] validating instagram input:', instagram);
    let ig = instagram.replace(/\s+/g,'');
    if (!/^https?:\/\//i.test(ig)) {
      if (ig.startsWith('@')) ig = 'https://instagram.com/' + ig.slice(1);
      else if (/^[A-Za-z0-9._-]+$/.test(ig)) ig = 'https://instagram.com/' + ig;
      else ig = 'https://' + ig;
    }
    try {
      const u = new URL(ig);
      if (!u.hostname.toLowerCase().includes('instagram.com')) {
        console.log('[audit] instagram validation failed - hostname:', u.hostname);
        returnToInputWithMessage('Check your Facebook link/Instagram link and retry.');
        return;
      }
      // use normalized form
      instagram = u.toString().replace(/\/?$/, '');
      console.log('[audit] instagram normalized to', instagram);
    } catch (e) {
      console.log('[audit] instagram parse error', e);
      returnToInputWithMessage('Check your Facebook link/Instagram link and retry.');
      return;
    }
  }

  // Relaxed Facebook validation: accept full facebook.com URLs or usernames; normalize to https://facebook.com/username
  if (facebook) {
    console.log('[audit] validating facebook input:', facebook);
    let fb = facebook.replace(/\s+/g,'');
    if (!/^https?:\/\//i.test(fb)) {
      if (fb.startsWith('@')) fb = 'https://facebook.com/' + fb.slice(1);
      else if (/^[A-Za-z0-9._-]+$/.test(fb)) fb = 'https://facebook.com/' + fb;
      else fb = 'https://' + fb;
    }
    try {
      const ufb = new URL(fb);
      if (!(ufb.hostname.toLowerCase().includes('facebook.com') || fb.toLowerCase().includes('.php'))) {
        console.log('[audit] facebook validation failed - hostname:', ufb.hostname);
        returnToInputWithMessage('Check your Facebook link/Instagram link and retry.');
        return;
      }
      facebook = ufb.toString().replace(/\/?$/, '');
      console.log('[audit] facebook normalized to', facebook);
    } catch (e) {
      console.log('[audit] facebook parse error', e);
      returnToInputWithMessage('Check your Facebook link/Instagram link and retry.');
      return;
    }
  }

  // If valid, save social links back to localStorage for convenience
  try {
    if (instagram) localStorage.setItem('business_instagram', instagram);
    if (facebook) localStorage.setItem('business_facebook', facebook);
  } catch (e) { console.warn('[audit] could not save social links to localStorage', e); }

  // reset polling-stopped flag (we are starting a new audit)
  window.auditPollingStopped = false;


  // POST to audit-start and wait for audit_id
  try {
    console.log('[audit] sending audit-start payload');
    const payload = { business_id, website, facebook, instagram, plan_level };
    const fnUrl = `${SUPABASE_URL}/functions/v1/audit-start`;
    const res = await fetch(fnUrl, { method: 'POST', headers: { 'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,'Authorization':`Bearer ${SUPABASE_ANON_KEY}` }, body: JSON.stringify(payload) });

    // Always read the response text for debugging, then try to parse JSON
    let respText = null;
    try { respText = await res.text(); } catch (e) { respText = null; }
    console.log('[audit] audit-start response status:', res.status, res.statusText);
    console.log('[audit] audit-start response text:', respText);

    let data = null;
    if (respText) {
      try { data = JSON.parse(respText); } catch (e) { data = null; }
    }

    // If the function returned non-JSON text that includes an id, try to extract it via regex
    let auditId = data?.audit_id || data?.id || null;
    if (!auditId && respText) {
      const m = respText.match(/(?:audit[_-]?id|id)["'\s:]*([A-Za-z0-9-_]{6,})/i);
      if (m && m[1]) auditId = m[1];
    }
    if (res.ok && auditId) {
      window.currentAuditId = auditId; try { localStorage.setItem('current_audit_id', String(auditId)); } catch(e){}
      console.log('[audit] started, audit_id=', auditId);
      console.log('[audit] starting poll for audit id', auditId);
      statusText.textContent = `Audit started (ID: ${auditId})`;
      pollForResults(auditId);
    } else if (res.ok && !auditId) {
      // Function returned 200 but no audit id in body — fallback to polling by business_id or website
      console.log('[audit] audit-start returned 200 but no audit_id; falling back to polling by business_id/website', { data, respText });
      statusText.textContent = 'Audit accepted, waiting for results...';
      pollForResults(null, { business_id, website });
    } else {
      // Non-ok status from function
      console.error('[audit] audit-start returned error status', res.status, res.statusText, respText);
      returnToInputWithMessage('Audit could not be run at this time, please try again later.');
      return;
    }
  } catch (err) {
    console.error('[audit] audit-start fetch error', err);
    returnToInputWithMessage('Audit could not be run at this time, please try again later.');
    return;
  }

  // Continue with other messages while polling
  const messagesAfterStart = ['Scanning SEO setup...','Checking call-to-action strength...','Reviewing mobile responsiveness...','Browsing Instagram profile...','Looking at profile bio...','Scanning Facebook page...','Checking recent engagement...','Finalizing your snapshot...'];
  await new Promise(r=>setTimeout(r,700));
  let msgIndex=0; statusText.textContent = messagesAfterStart[0];
  const interval = setInterval(()=>{ msgIndex++; if (msgIndex < messagesAfterStart.length) { statusText.style.opacity='0'; setTimeout(()=>{ statusText.textContent=messagesAfterStart[msgIndex]; statusText.style.opacity='1'; },150); } else clearInterval(interval); }, 550);

  // NOTE: do NOT auto-show results here. Results screen is shown only when actual results arrive.
}

// Poll REST table for results
function pollForResults(auditIdToPoll, fallback) {
  // fallback: { business_id, website }
  if (!auditIdToPoll) auditIdToPoll = window.currentAuditId || localStorage.getItem('current_audit_id');
  const useFallback = !auditIdToPoll && fallback && (fallback.business_id || fallback.website);
  if (!auditIdToPoll && !useFallback) throw new Error('No audit id or fallback filter for polling');
  if (window.auditPollInterval) { clearInterval(window.auditPollInterval); window.auditPollInterval = null; }
  if (window.auditPollingStopped) {
    console.log('[audit] polling disabled because results already shown');
    return null;
  }
  const pollStart = Date.now();
  const maxPollMs = 3 * 60 * 1000;

  window.auditPollInterval = setInterval(async () => {
    try {
      let url;
      if (auditIdToPoll) {
        url = `${SUPABASE_URL}/rest/v1/audit_results?audit_id=eq.${encodeURIComponent(auditIdToPoll)}`;
      } else if (useFallback) {
        // If both business_id and website are available, poll for either using an OR filter and return the latest record
        if (fallback.business_id && fallback.website) {
          const orPart = `business_id.eq.${encodeURIComponent(fallback.business_id)},website.eq.${encodeURIComponent(fallback.website)}`;
          url = `${SUPABASE_URL}/rest/v1/audit_results?or=(${orPart})&order=created_at.desc&limit=1`;
        } else if (fallback.business_id) {
          url = `${SUPABASE_URL}/rest/v1/audit_results?business_id=eq.${encodeURIComponent(fallback.business_id)}&order=created_at.desc&limit=1`;
        } else {
          url = `${SUPABASE_URL}/rest/v1/audit_results?website=eq.${encodeURIComponent(fallback.website)}&order=created_at.desc&limit=1`;
        }
      }
      console.log('[audit] poll attempt for', auditIdToPoll || '(fallback)', 'url', url, 'at', new Date().toISOString());
      const r = await fetch(url, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } });
      console.log('[audit] poll fetch status', r.status, r.statusText);
      if (!r.ok) {
        console.warn('[audit] poll fetch non-ok', r.status, r.statusText);
        try { const loadErr = document.getElementById('loading-error'); if (loadErr) { loadErr.textContent = 'Audit failed. Please check your links and try again.'; loadErr.classList.remove('hidden'); } } catch (e) {}
        clearInterval(window.auditPollInterval); window.auditPollInterval = null;
        try { const startBtn = document.getElementById('startAuditBtn'); if (startBtn) { startBtn.disabled = false; startBtn.classList.remove('opacity-60','cursor-not-allowed'); } const screenLoading = document.getElementById('screen-loading'); const screenInput = document.getElementById('screen-input'); if (screenLoading) screenLoading.classList.add('hidden'); if (screenInput) screenInput.classList.remove('hidden'); } catch(e){}
        return;
      }

      const data = await r.json().catch(() => null) || [];
      console.log('[audit] poll result raw length:', Array.isArray(data)?data.length:0, data);
      if (Array.isArray(data) && data.length > 0) {
        showResults(data[0]);
        if (window.auditPollInterval) { clearInterval(window.auditPollInterval); window.auditPollInterval = null; }
        return;
      }

      if (Date.now() - pollStart > maxPollMs) {
        console.warn('[audit] polling timed out');
        try { const loadErr = document.getElementById('loading-error'); if (loadErr) { loadErr.textContent = 'Audit timed out. Please check your links and try again.'; loadErr.classList.remove('hidden'); } } catch (e) {}
        clearInterval(window.auditPollInterval); window.auditPollInterval = null;
        try { const startBtn = document.getElementById('startAuditBtn'); if (startBtn) { startBtn.disabled = false; startBtn.classList.remove('opacity-60','cursor-not-allowed'); } const screenLoading = document.getElementById('screen-loading'); const screenInput = document.getElementById('screen-input'); if (screenLoading) screenLoading.classList.add('hidden'); if (screenInput) screenInput.classList.remove('hidden'); } catch(e){}
        return;
      }
    } catch (e) {
      console.error('[audit] polling error', e);
      try { const loadErr = document.getElementById('loading-error'); if (loadErr) { loadErr.textContent = 'Audit failed. Please check your links and try again.'; loadErr.classList.remove('hidden'); } } catch (ex) {}
      clearInterval(window.auditPollInterval); window.auditPollInterval = null;
      try { const startBtn = document.getElementById('startAuditBtn'); if (startBtn) { startBtn.disabled = false; startBtn.classList.remove('opacity-60','cursor-not-allowed'); } const screenLoading = document.getElementById('screen-loading'); const screenInput = document.getElementById('screen-input'); if (screenLoading) screenLoading.classList.add('hidden'); if (screenInput) screenInput.classList.remove('hidden'); } catch(e){}
      return;
    }
  }, 2500);
  return window.auditPollInterval;
}

function showResults(result) {
  // stop any active polling once we show results
  try { if (window.auditPollInterval) { clearInterval(window.auditPollInterval); window.auditPollInterval = null; } } catch(e){}
  window.auditPollingStopped = true;
  console.log('[audit] final result object:', result);
  try { const dbg=document.getElementById('debug-audit-raw'); const pre=document.getElementById('debugRawAudit'); if (pre && dbg) { pre.textContent=JSON.stringify(result,null,2); dbg.classList.remove('hidden'); } } catch(e){}
  try { const screenLoading=document.getElementById('screen-loading'); const screenResults=document.getElementById('screen-results'); if (screenLoading) screenLoading.classList.add('hidden'); if (screenResults) screenResults.classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'}); } catch(e){}
  try { const startBtn=document.getElementById('startAuditBtn'); if (startBtn) { startBtn.disabled=false; startBtn.classList.remove('opacity-60','cursor-not-allowed'); } } catch(e){}
}

// Wire start button
document.addEventListener('DOMContentLoaded', ()=>{ const b=document.getElementById('startAuditBtn'); if (b) b.addEventListener('click', startAudit); });
