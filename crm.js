// crm.js - FULL merged: original UI behaviours + Supabase live backend
// -------------------------------------------------------------------
// 1) CONFIG & SAFE INIT
console.log('[INIT] Attempting to connect to Supabase...');
if (!window.supabase) {
  console.error('❌ Supabase JS not found! Add this before crm.js in your HTML:');
  console.error(`<script src="https://unpkg.com/@supabase/supabase-js@2"></script>`);
  throw new Error('Supabase library not loaded before crm.js');
}
const SUPABASE_URL = 'https://xgtnbxdxbbywvzrttixf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndG5ieGR4YmJ5d3Z6cnR0aXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0Nzg5NTAsImV4cCI6MjA3MjA1NDk1MH0.YGk0vFyIJEiSpu5phzV04Mh4lrHBlfYLFtPP_afFtMQ';
// Disable automatic session persistence to avoid storage access being blocked by
// browser tracking protection when loading the Supabase client from a CDN.
// This prevents console messages like "Tracking Prevention blocked access to storage".
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});
console.log('[INIT] Supabase client created ✅', client);

// NOTE: Removed global debug click listener that previously caused an alert
// and could interrupt normal modal opening flow.

// Load business info from localStorage
let BUSINESS_ID = (function(){
  try {
    const vvRaw = localStorage.getItem('vvUser');
    if (vvRaw) {
      const vv = JSON.parse(vvRaw);
      return vv?.business_id || vv?.['business id'] || localStorage.getItem('business_id') || null;
    }
    return localStorage.getItem('business_id') || null;
  } catch (e) {
    return localStorage.getItem('business_id') || null;
  }
})();

let BUSINESS_NAME = localStorage.getItem('business_name') || 'VV Studios'; // Added default name for WhatsApp reminder
let ADMIN_NAME = localStorage.getItem('admin_name');

if (!BUSINESS_ID) {
  console.warn('⚠️ No BUSINESS_ID found in localStorage. Please login to access business-specific data.');
}

// Quick connection test
client.from('contacts').select('*').limit(1).then(({ data, error }) => {
  if (error) console.error('❌ Test query failed:', error);
  else console.log('✅ Supabase connection OK (test contact):', data && data[0]);
});

// -------------------------------------------------------------------
// STATE (keeps parity with the original script's variables)
let selectedContactIds = [];
let currentPageView = 10;
// Default deals view for desktop. Set to 'list' so desktop opens on the deals-list view by default.
let currentDealsView = 'list';
let currentMeetingsView = 'list'; // NEW: Default view for Meetings
let openDropZone = null;
let draggedDealId = null;
let selectedDealContact = null;       // { id, name, phone }
let selectedFollowUpDeal = null;      // { id, name, contactName, contactPhone }
let formOrigin = null;                // 'deal' or 'follow-up' when nested add
let selectedFollowUp = null;          // selected follow-up object when acting on a follow-up
let selectedMeeting = null;           // NEW: selected meeting object for modal actions
let selectedContact = null;           // selected contact for follow-up actions
let selectedContactAction = null;    // fallback contact context for Call/WhatsApp actions (from contact details)
let currentCalendarDate = new Date(); // NEW: The date currently centered in the calendar view
let selectedDailyDate = null;         // NEW: The date selected in the calendar for daily view
let mobileContactsSearchQuery = '';   // NEW: Search query for mobile contacts

// Selected schedule card when viewing details
let selectedScheduleCard = null;
// Currently hovered schedule card (used by the section-level info button)
let hoveredScheduleCard = null;

let contacts = [];    // loaded from supabase.contacts
let dealsData = [];   // loaded from deals_pipeline_view (mapped)
let followUps = [];   // loaded from supabase.follow_ups
let meetingsData = []; // NEW: Loaded meetings data
let afterSaleGroupedCache = [];
let mobileAddSubMenu = null;
// Track context for the current WhatsApp modal session
let currentWhatsAppContext = {
  type: null,            // "followup", "deal", "meeting", "referral", "review", etc
  contactName: "",
  contactId: null,
  BUSINESS_ID: null,
  dealId: null,          // ✅ Added here
  extra: {}
};


// Track AI suggestions and accepted selection
let aiWhatsAppSuggestions = {
  currentIndex: 0,
  all: [] // array of { text: string, timestamp: number }
};


const PIPELINE_STAGES = ['New Leads', 'Qualified Leads', 'Awaiting Payment', 'Closed Won'];
const HIDDEN_STAGES = ['Unqualified', 'Lost'];
const ALL_STAGES = [...PIPELINE_STAGES, ...HIDDEN_STAGES];

function logStep(step, data = '') { console.log(`🟦 [${step}]`, data); }

// -------------------------------------------------------------------
// HELPERS (formatting)
function formatKES(amount) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 }).format(amount || 0);
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const d = new Date(dateString);
  if (isNaN(d)) return 'N/A';
  const day = d.getDate();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  let suffix = 'th';
  if (day % 10 === 1 && day !== 11) suffix = 'st';
  if (day % 10 === 2 && day !== 12) suffix = 'nd';
  if (day % 10 === 3 && day !== 13) suffix = 'rd';
  return `${day}${suffix} ${month} ${year}`;
}

function getCloseDateColor(dateString) {
  if (!dateString) return 'bg-white/30';
  const closeDate = new Date(dateString);
  const today = new Date(); today.setHours(0,0,0,0);
  const diffDays = Math.ceil((closeDate - today) / (1000*60*60*24));
  if (diffDays <= 0) return 'bg-red-500';
  if (diffDays <= 7) return 'bg-yellow-500';
  if (diffDays <= 30) return 'bg-green-500';
  return 'bg-white/30';
}

// Helper for formatting date and time together
function getFormattedDateTime(dateString) {
  if (!dateString) return 'N/A';
  const d = new Date(dateString);
  if (isNaN(d)) return 'N/A';
  const datePart = formatDate(dateString);
  const timePart = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

// Helper for calculating time remaining
function getTimeRemaining(dateString) {
  if (!dateString) return { text: 'N/A', colorClass: 'text-white/70' };
  const targetDate = new Date(dateString);
  const now = new Date();
  const diffMs = targetDate - now;

  if (diffMs <= 0) return { text: `Past: ${Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24))} days ago`, colorClass: 'text-red-400' };

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffDays > 0) return { text: `${diffDays} Day${diffDays > 1 ? 's' : ''}, ${diffHours} hr${diffHours !== 1 ? 's' : ''}`, colorClass: 'text-add-green' };
  if (diffHours > 0) return { text: `${diffHours} hr${diffHours !== 1 ? 's' : ''}, ${diffMinutes} min${diffMinutes !== 1 ? 's' : ''}`, colorClass: 'text-yellow-400' };
  return { text: `${diffMinutes} min${diffMinutes !== 1 ? 's' : ''}`, colorClass: 'text-yellow-400' };
}

// Helper for date suffix
function getSuffix(day) {
    if (day % 10 === 1 && day !== 11) return 'st';
    if (day % 10 === 2 && day !== 12) return 'nd';
    if (day % 10 === 3 && day !== 13) return 'rd';
    return 'th';
}

// Debounce helper
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

/* ------------------ Alerts UI (small side panel + unread bubble) ------------------ */
const _alertsState = { count: 0, items: [] };

function initAlertsUI() {
  try {
    const btn = document.getElementById('alerts-button');
    const panel = document.getElementById('alerts-panel');
    const closeBtn = document.getElementById('alerts-close-btn');
    const markReadBtn = document.getElementById('alerts-mark-read');

    if (!btn || !panel) return; // nothing to wire

    btn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      // Position panel under the bell
      positionAlertsPanel();
      toggleAlertsPanel();
    });

    if (closeBtn) closeBtn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); closeAlertsPanel(); });
    if (markReadBtn) markReadBtn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); markAllAlertsRead(); });

    // click outside to close
    document.addEventListener('click', (ev) => {
      const open = panel.classList.contains('open');
      if (!open) return;
      const inside = ev.target.closest && (ev.target.closest('#alerts-panel') || ev.target.closest('#alerts-button'));
      if (!inside) closeAlertsPanel();
    });

    // ensure items are rendered if there are any stored
    renderAlertsList();
    setAlertsUnreadCount(_alertsState.count);
  } catch (e) { console.warn('initAlertsUI failed', e); }
}

function toggleAlertsPanel() {
  const panel = document.getElementById('alerts-panel');
  const btn = document.getElementById('alerts-button');
  if (!panel || !btn) return;
  const open = panel.classList.toggle('open');
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  btn.setAttribute('aria-expanded', String(open));
}

function openAlertsPanel() { const panel = document.getElementById('alerts-panel'); if (!panel) return; panel.classList.add('open'); panel.setAttribute('aria-hidden','false'); document.getElementById('alerts-button')?.setAttribute('aria-expanded','true'); }
function closeAlertsPanel(){ const panel = document.getElementById('alerts-panel'); if (!panel) return; panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); document.getElementById('alerts-button')?.setAttribute('aria-expanded','false'); }

function setAlertsUnreadCount(count){
  _alertsState.count = Number(count) || 0;
  const bubble = document.getElementById('alerts-bubble');
  if (!bubble) return;
  if (_alertsState.count > 0) {
    bubble.textContent = _alertsState.count > 99 ? '99+' : String(_alertsState.count);
    bubble.classList.remove('hidden');
    bubble.classList.add('unread');
  } else {
    bubble.textContent = '0';
    bubble.classList.add('hidden');
    bubble.classList.remove('unread');
  }
}

function addAlert({ title = '', message = '', unread = true } = {}){
  const id = 'a_' + Date.now();
  const item = { id, title, message, unread: !!unread };
  _alertsState.items.unshift(item);
  if (unread) _alertsState.count = (_alertsState.count || 0) + 1;
  renderAlertsList();
  setAlertsUnreadCount(_alertsState.count);
}

function markAllAlertsRead(){
  _alertsState.items = _alertsState.items.map(it => ({ ...it, unread: false }));
  _alertsState.count = 0;
  renderAlertsList();
  setAlertsUnreadCount(0);
}

function renderAlertsList(){
  const list = document.getElementById('alerts-list');
  if (!list) return;
  list.innerHTML = '';
  if (!_alertsState.items || _alertsState.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'alerts-empty';
    empty.textContent = 'Your Alerts will Appear Here';
    list.appendChild(empty);
    return;
  }
  _alertsState.items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'alerts-item' + (it.unread ? ' unread' : '');
    el.innerHTML = `<div style="font-weight:600">${escapeHtml(it.title || 'Alert')}</div><div style="font-size:0.9rem;color:#cbd5e1;margin-top:6px">${escapeHtml(it.message || '')}</div>`;
    list.appendChild(el);
  });
}

function positionAlertsPanel(){
  const btn = document.getElementById('alerts-button');
  const panel = document.getElementById('alerts-panel');
  if (!btn || !panel) return;
  // Reset transform to measure
  panel.style.left = '';
  panel.style.top = '';
  // Get bounding rects
  const b = btn.getBoundingClientRect();
  const panelWidth = Math.min(280, window.innerWidth - 32);
  // prefer aligning left edges, but ensure it stays inside viewport
  let left = b.left;
  // if space to the right is insufficient, shift left
  if (left + panelWidth + 12 > window.innerWidth) left = window.innerWidth - panelWidth - 12;
  if (left < 8) left = 8;
  // place the panel just below the button
  const top = b.bottom + 8 + window.scrollY;
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
}

// Defensive init: if script loaded after DOMContentLoaded, ensure alerts are still wired
try {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // small delay so elements have a chance to exist
    setTimeout(() => { try { initAlertsUI(); } catch (e) { /* ignore */ } }, 50);
  } else {
    document.addEventListener('DOMContentLoaded', () => { try { initAlertsUI(); } catch (e) { /* ignore */ } });
  }
} catch (e) { /* ignore */ }

// small util to escape text in DOM insertions
function escapeHtml(s){ if (!s && s !== 0) return ''; return String(s).replace(/[&<>"]+/g, function(chr){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[chr] || chr; }); }


// Schedules & Follow-up templates UI removed
// The original implementation (modal, detail views, create/edit flows) was removed
// per request. We keep small no-op stubs so other parts of the app can call
// these names without throwing runtime errors.

// Initialize lightweight interactions inside the schedules modal. Keep minimal
// so we don't reintroduce the previous conflicting handlers.
function initSchedulesModalInteractions() {
  try {
    // Attach a close handler to any element inside the modal that has
    // `data-schedules-close` to allow closing from template markup.
    const bd = document.getElementById('schedules-modal-backdrop');
    if (!bd) return;
    bd.querySelectorAll('[data-schedules-close]').forEach(btn => {
      if (btn._schedulesInit) return;
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hideSchedulesModal(); });
      btn._schedulesInit = true;
    });
    // ESC to close
    if (!initSchedulesModalInteractions._escAttached) {
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideSchedulesModal(); });
      initSchedulesModalInteractions._escAttached = true;
    }
  } catch (e) { console.warn('initSchedulesModalInteractions failed', e); }
}

// Show the Schedules / Templates modal and load templates from DB.
async function showSchedulesModal() {
  try {
    console.debug('[schedules] showSchedulesModal called');
    const bd = document.getElementById('schedules-modal-backdrop');
    if (!bd) { console.warn('[schedules] modal backdrop not found'); return; }
    // Bring backdrop into view
    bd.classList.remove('hidden'); bd.style.display = 'flex'; bd.style.zIndex = '120000'; bd.setAttribute('aria-hidden','false');
    try { if (bd.parentNode !== document.body) document.body.appendChild(bd); } catch (e) {}

    // Ensure basic layout for inner modal
    try {
      const inner = bd.querySelector('#schedules-modal');
      if (inner) { inner.style.display = 'block'; }
    } catch (e) {}

    // Minimal init of interactions
    try { initSchedulesModalInteractions(); } catch (e) { console.warn('[schedules] initSchedulesModalInteractions error', e); }
    // Ensure Create button handlers are attached so Create opens immediately
    try { setupCreateFollowupHandlers(); } catch (e) { console.warn('[schedules] setupCreateFollowupHandlers error', e); }

    // Default to system tab if present
    try {
      const sysBtn = document.querySelector('[data-schedules-tab="system"]');
      if (sysBtn) { document.querySelectorAll('[data-schedules-tab]').forEach(b => b.classList.remove('active')); sysBtn.classList.add('active'); }
      document.getElementById('schedules-system')?.classList.remove('hidden');
      document.getElementById('schedules-special')?.classList.add('hidden');
    } catch (e) {}

    // Load templates and render
    try { const loaded = await loadPersonalizedTemplates(); console.debug('[schedules] loadPersonalizedTemplates returned', (loaded && loaded.length) || 0); } catch (e) { console.warn('showSchedulesModal: loadPersonalizedTemplates failed', e); }
  } catch (e) { console.warn('showSchedulesModal failed', e); }
}

function hideSchedulesModal() {
  try {
    const bd = document.getElementById('schedules-modal-backdrop');
    if (!bd) return;
    bd.classList.add('hidden'); bd.style.display = 'none'; bd.setAttribute('aria-hidden','true'); bd.style.zIndex = '';
  } catch (e) { console.warn('hideSchedulesModal failed', e); }
}

// Load templates from Supabase and render them into the modal containers.
async function loadPersonalizedTemplates() {
  try {
    const sysContainer = document.getElementById('schedules-system');
    const specContainer = document.getElementById('schedules-special');
    if (sysContainer) sysContainer.innerHTML = '';
    if (specContainer) specContainer.innerHTML = '';
    if (!BUSINESS_ID) return [];
    const { data, error } = await client.from('personalized_business_templates').select('*').eq('business_id', BUSINESS_ID).order('recommended_delay_days', { ascending: true });
    if (error) { console.warn('loadPersonalizedTemplates: query error', error); return []; }
    const templates = data || [];
    templates.forEach(tpl => {
      const el = createScheduleCardFromTemplate(tpl);
      if ((tpl.template_stage || '').toLowerCase() === 'system') {
        sysContainer && sysContainer.appendChild(el);
      } else {
        specContainer && specContainer.appendChild(el);
      }
    });
    return templates;
  } catch (e) { console.warn('loadPersonalizedTemplates failed', e); return []; }
}

// Minimal card renderer. Cards open the detail modal when clicked.
function createScheduleCardFromTemplate(tpl) {
  try {
    console.debug('[schedules] rendering card for template id=', tpl && tpl.id);
    const days = tpl.recommended_delay_days || 0;
    const title = tpl.template_title || 'Untitled';
    const msg = tpl.personalized_message || '';
    const card = document.createElement('div');
    card.className = 'schedule-card bg-bg-dark border border-border-dark rounded-xl p-4 flex items-start gap-3 relative cursor-pointer';
    card.setAttribute('data-days', String(days));
    card.setAttribute('data-type', tpl.template_stage || 'special');
    card.setAttribute('data-info', tpl.personalized_message || '');
    card.setAttribute('data-template-id', String(tpl.id || ''));
    card.innerHTML = `
      <div class="w-12 h-12 flex items-center justify-center rounded-lg ${tpl.template_stage === 'special' ? 'bg-orange-500' : 'bg-blue-600'} text-white font-bold text-lg flex-shrink-0">${escapeHtml(String(days))}</div>
      <div class="flex-1">
        <div class="font-semibold text-white">${escapeHtml(title)}</div>
        <div class="text-sm text-white/60 mt-1">${escapeHtml(msg.length > 120 ? msg.slice(0, 117) + '...' : msg)}</div>
      </div>
    `;
    card.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      try { console.debug('[schedules] card clicked, opening detail for template id=', tpl && tpl.id); openScheduleDetailFromCard(card, { edit: false }); } catch (e) { console.warn('open detail failed', e); }
    });
    return card;
  } catch (e) { console.warn('createScheduleCardFromTemplate failed', e); return document.createElement('div'); }
}

// Fallback detail opener: populate the detail modal with card data and show it.
function openScheduleDetailFromCard(card, opts = { edit: false }) {
  try {
    const days = card.getAttribute('data-days') || '';
    const stage = card.getAttribute('data-type') || '';
    const title = card.querySelector('.font-semibold') ? card.querySelector('.font-semibold').textContent.trim() : '';
    const msgEl = card.querySelector('.text-sm');
    const message = msgEl ? msgEl.textContent.trim() : '';
    const bd = document.getElementById('schedule-detail-modal-backdrop');
    if (!bd) return;
    const dd = document.getElementById('detail-days'); if (dd) dd.textContent = days;
    const ds = document.getElementById('detail-stage'); if (ds) ds.textContent = stage;
    const dt = document.getElementById('detail-title'); if (dt) dt.textContent = title;
    const dm = document.getElementById('detail-message'); if (dm) dm.textContent = message;
    bd.classList.remove('hidden'); bd.style.display = 'flex'; bd.style.zIndex = '121000'; bd.setAttribute('aria-hidden','false');
  } catch (e) { console.warn('openScheduleDetailFromCard failed', e); }
}

// -----------------------
// Create Follow-Up (Templates) modal handlers
// -----------------------
function showCreateFollowupModal() {
  try {
    // Prefer to use global openModal utility if present
    const bd = document.getElementById('create-followup-modal-backdrop');
    if (!bd) { console.warn('[create] create modal backdrop not found'); return; }
    // Ensure modal is attached to body so it can overlay other modals
    try { if (bd.parentNode !== document.body) document.body.appendChild(bd); } catch (e) { console.warn('[create] append to body failed', e); }
    // Ensure create modal appears above the schedules modal
    try { bd.classList.remove('hidden'); bd.style.display = 'flex'; bd.style.zIndex = '130500'; bd.setAttribute('aria-hidden','false'); } catch (e) { console.warn('[create] show failed', e); }
    // Also bump inner wrapper if present
    try { const inner = bd.querySelector('.bg-bg-card'); if (inner) inner.style.zIndex = '130600'; } catch (e) {}
    try { setupCreateFollowupHandlers(); } catch (e) { console.warn('setupCreateFollowupHandlers failed', e); }
  } catch (e) { console.warn('showCreateFollowupModal failed', e); }
}

function hideCreateFollowupModal() {
  try {
    if (typeof closeModal === 'function') closeModal('create-followup-modal-backdrop');
    else {
      const bd = document.getElementById('create-followup-modal-backdrop');
      if (!bd) return; bd.classList.add('hidden'); bd.style.display = 'none'; bd.setAttribute('aria-hidden','true'); bd.style.zIndex = '';
    }
  } catch (e) { console.warn('hideCreateFollowupModal failed', e); }
}

async function _insertTemplateToDB(payload) {
  try {
    if (!BUSINESS_ID) throw new Error('Missing BUSINESS_ID');
    const tpl = {
      business_id: BUSINESS_ID,
      template_stage: payload.template_stage || 'special',
      template_title: payload.name || payload.template_title || 'Untitled',
      personalized_message: payload.message || '',
      recommended_delay_days: payload.interval != null ? Number(payload.interval) : null,
      tone: payload.tone || null,
      ai_created: false,
      step_number: payload.step_number || null,
      is_active: payload.is_active != null ? !!payload.is_active : true
    };
    const { data, error } = await client.from('personalized_business_templates').insert([tpl]).select();
    if (error) throw error;
    return data && data[0];
  } catch (e) {
    console.error('Insert template failed', e);
    throw e;
  }
}

function setupCreateFollowupHandlers() {
  try {
    if (setupCreateFollowupHandlers._inited) return;
    setupCreateFollowupHandlers._inited = true;

    // Attach create button inside schedules modal
    const createBtn = document.getElementById('create-followup-btn');
    if (createBtn && !createBtn._attached) {
      createBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showCreateFollowupModal(); });
      createBtn._attached = true;
    }

    // Cancel button
    const cancel = document.getElementById('create-cancel-btn');
    if (cancel && !cancel._attached) {
      cancel.addEventListener('click', (e) => { try { e.preventDefault(); e.stopPropagation(); hideCreateFollowupModal(); } catch (err){} });
      cancel._attached = true;
    }

    // Submit -> show confirm
    const submitBtn = document.getElementById('create-submit-btn');
    if (submitBtn && !submitBtn._attached) {
      submitBtn.addEventListener('click', (e) => {
        try {
          e.preventDefault(); e.stopPropagation();
          const name = document.getElementById('create-name')?.value?.trim();
          const reason = document.getElementById('create-reason')?.value?.trim();
          if (!name || !reason) { try { if (typeof showInAppAlert === 'function') showInAppAlert('Please provide a name and a short reason'); else alert('Please provide a name and a short reason'); } catch (e) {} return; }
          const confirm = document.getElementById('create-followup-confirm');
          if (confirm) { confirm.classList.remove('hidden'); if (confirm.parentNode !== document.body) document.body.appendChild(confirm); }
        } catch (err) { console.warn('create submit failed', err); }
      });
      submitBtn._attached = true;
    }

    // Confirm modal handlers
    const confirmCancel = document.getElementById('confirm-cancel');
    if (confirmCancel && !confirmCancel._attached) { confirmCancel.addEventListener('click', (e) => { try { e.preventDefault(); e.stopPropagation(); document.getElementById('create-followup-confirm')?.classList.add('hidden'); } catch (err){} }); confirmCancel._attached = 1; }

    const confirmSubmit = document.getElementById('confirm-submit');
    if (confirmSubmit && !confirmSubmit._attached) {
      confirmSubmit.addEventListener('click', async (e) => {
        try {
          e.preventDefault(); e.stopPropagation();
          const payload = {
            name: document.getElementById('create-name')?.value?.trim(),
            reason: document.getElementById('create-reason')?.value?.trim(),
            message: document.getElementById('create-message')?.value || '',
            trigger: document.getElementById('create-trigger')?.value || '',
            pipeline: document.getElementById('create-pipeline')?.value || '',
            interval: Number(document.getElementById('create-interval')?.value || 0),
            template_stage: 'special'
          };
          document.getElementById('create-followup-confirm')?.classList.add('hidden');
          // Insert into DB
          try {
            await _insertTemplateToDB(payload);
            try { if (typeof showInAppAlert === 'function') showInAppAlert('Template submitted for review'); else console.log('Template submitted for review'); } catch (e) {}
          } catch (err) {
            try { if (typeof showInAppAlert === 'function') showInAppAlert('Failed to submit template'); else console.error(err); } catch (e) {}
          }
          hideCreateFollowupModal();
          try { await loadPersonalizedTemplates(); } catch (e) { console.warn('reload templates failed', e); }
        } catch (err) { console.warn('confirm submit failed', err); }
      });
      confirmSubmit._attached = true;
    }

  } catch (e) { console.warn('setupCreateFollowupHandlers failed', e); }
}

// Attach a single sidebar click handler that opens the templates modal.
(function attachSchedulesSidebar() {
  function attach() {
    const btn = document.getElementById('sidebar-followup-schedules');
    if (!btn) return;
    if (btn._schedulesAttached) return;
    btn.addEventListener('click', (e) => {
      try { e.preventDefault(); e.stopPropagation(); console.debug('[schedules] sidebar clicked'); showSchedulesModal(); } catch (err) { console.warn('schedules click failed', err); }
    });
    btn._schedulesAttached = true;
    console.debug('[schedules] attached sidebar handler to #sidebar-followup-schedules');
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(attach, 40);
  else document.addEventListener('DOMContentLoaded', attach);
})();

// Also ensure create handlers are attached on DOM ready so Create button inside the modal
// is responsive even before the modal is opened for the first time.
try {
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(() => { try { setupCreateFollowupHandlers(); console.debug('[schedules] setupCreateFollowupHandlers attached at init'); } catch(e){} }, 60);
  else document.addEventListener('DOMContentLoaded', () => { try { setupCreateFollowupHandlers(); console.debug('[schedules] setupCreateFollowupHandlers attached on DOMContentLoaded'); } catch(e){} });
} catch (e) {}


// -----------------------
// AUTO-SAVE HELPERS
// -----------------------
// small registry for per-element debounce timers
const _autoSaveTimers = new Map();

function showAutoSaveToast(targetEl, text = 'Saving…', status = 'saving') {
  // remove existing
  let toast = document.getElementById('autosave-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'autosave-toast';
    toast.style.position = 'fixed';
    toast.style.zIndex = 20050;
    toast.style.padding = '8px 12px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '13px';
    toast.style.boxShadow = '0 6px 18px rgba(3,8,23,0.6)';
    toast.style.transition = 'opacity .18s ease, transform .18s ease';
    toast.innerHTML = '';
    document.body.appendChild(toast);
  }

  // style based on status
  if (status === 'saving') {
    toast.style.background = '#0b1220';
    toast.style.color = '#fff';
  } else {
    toast.style.background = '#052e14';
    toast.style.color = '#d1fae5';
  }

  toast.textContent = text;

  // Position: mobile -> top center, desktop -> near targetEl
  if (isMobile()) {
    toast.style.left = '50%';
    toast.style.top = '12px';
    toast.style.transform = 'translateX(-50%)';
  } else {
    // try to position near target
    try {
      const rect = targetEl.getBoundingClientRect();
      const left = Math.min(window.innerWidth - 200, Math.max(8, rect.left + (rect.width / 2) - 100));
      const top = Math.max(8, rect.top + window.scrollY - 40);
      toast.style.left = left + 'px';
      toast.style.top = top + 'px';
      toast.style.transform = 'none';
    } catch (e) {
      toast.style.left = '50%';
      toast.style.top = '12px';
      toast.style.transform = 'translateX(-50%)';
    }
  }

  toast.style.opacity = '1';
  toast.style.pointerEvents = 'none';
}

function hideAutoSaveToast(delay = 700) {
  const toast = document.getElementById('autosave-toast');
  if (!toast) return;
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { try { toast.remove(); } catch (e) {} }, 200);
  }, delay);
}

// Save handler that inspects data attributes / context to persist notes to the right table
async function persistNotesForElement(el, value) {
  if (!el) return;
  const v = (value || '').trim();
  // Determine context via dataset (dealId, followupId, contactId) or currentWhatsAppContext
  const dealId = el.dataset.dealId ? parseInt(el.dataset.dealId, 10) : null;
  const followupId = el.dataset.followupId ? parseInt(el.dataset.followupId, 10) : null;
  const contactId = el.dataset.contactId ? parseInt(el.dataset.contactId, 10) : null;

  try {
    showAutoSaveToast(el, 'Saving…', 'saving');
    if (followupId) {
      await updateFollowUp(followupId, { notes: v });
    } else if (dealId) {
      // NOTE: We avoid writing directly to deals.notes (deals.notes will become Activity Log later).
      // Instead persist notes to the associated contact's notes when possible to prevent touching deal enums
      const dealObj = (dealsData || []).find(d => Number(d.id) === Number(dealId));
      const targetContactId = dealObj ? (dealObj.contactId || dealObj.contact_id) : null;
      if (targetContactId) {
        await updateContact(targetContactId, { notes: v });
      } else {
        // No contact found for this deal — stash in local context so it isn't lost and alert the user
        window.currentWhatsAppContext = window.currentWhatsAppContext || {};
        window.currentWhatsAppContext.contact_notes = v;
      }
    } else if (contactId) {
      await updateContact(contactId, { notes: v });
    } else if (window.currentWhatsAppContext) {
      // fallback to context object
      const ctx = window.currentWhatsAppContext || {};
      if (ctx.dealId || ctx.deal_id) {
        const did = ctx.dealId || ctx.deal_id;
        const dealObj = (dealsData || []).find(d => Number(d.id) === Number(did));
        const targetContactId = dealObj ? (dealObj.contactId || dealObj.contact_id) : null;
        if (targetContactId) await updateContact(targetContactId, { notes: v });
        else window.currentWhatsAppContext.contact_notes = v;
      } else if (ctx.contactId || ctx.contact_id) await updateContact(ctx.contactId || ctx.contact_id, { notes: v });
      else if (ctx.followup_id) await updateFollowUp(ctx.followup_id, { notes: v });
      else {
        // no target: store in local context for now
        window.currentWhatsAppContext = window.currentWhatsAppContext || {};
        window.currentWhatsAppContext.contact_notes = v;
      }
    }

    showAutoSaveToast(el, 'Saved', 'saved');
    hideAutoSaveToast(900);
  } catch (err) {
    console.error('Auto-save notes failed', err);
    showAutoSaveToast(el, 'Save failed', 'error');
    hideAutoSaveToast(1500);
  }
}

function setupAutoSaveHandlers() {
  // Contact details modal notes
  const contactNotesEl = document.getElementById('contact-details-notes');
  if (contactNotesEl && !contactNotesEl.dataset.autosaveInit) {
    contactNotesEl.dataset.autosaveInit = '1';
    contactNotesEl.addEventListener('input', (e) => {
      const el = e.currentTarget;
      const existing = _autoSaveTimers.get(el);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => persistNotesForElement(el, el.value), 900);
      _autoSaveTimers.set(el, t);
    });
    contactNotesEl.addEventListener('blur', (e) => {
      const el = e.currentTarget;
      const t = _autoSaveTimers.get(el); if (t) clearTimeout(t);
      persistNotesForElement(el, el.value);
    });
  }

  // Generic modal notes (deal/follow-up) - element id 'modal-notes'
  const modalNotes = document.getElementById('modal-notes');
  if (modalNotes && !modalNotes.dataset.autosaveInit) {
    modalNotes.dataset.autosaveInit = '1';
    modalNotes.addEventListener('input', (e) => {
      const el = e.currentTarget; const existing = _autoSaveTimers.get(el); if (existing) clearTimeout(existing);
      const t = setTimeout(() => persistNotesForElement(el, el.value), 900);
      _autoSaveTimers.set(el, t);
    });
    modalNotes.addEventListener('blur', (e) => { const el = e.currentTarget; const t = _autoSaveTimers.get(el); if (t) clearTimeout(t); persistNotesForElement(el, el.value); });
  }

  // WhatsApp modal notes (the display textarea created in updateWhatsAppNotesDisplay)
  // Use event delegation: when the textarea exists, attach handlers
  document.body.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.id === 'whatsapp-modal-notes-textarea') {
      const existing = _autoSaveTimers.get(el); if (existing) clearTimeout(existing);
      const t = setTimeout(() => persistNotesForElement(el, el.value), 900);
      _autoSaveTimers.set(el, t);
    }
  });
  document.body.addEventListener('blur', (e) => {
    const el = e.target;
    if (el && el.id === 'whatsapp-modal-notes-textarea') {
      const t = _autoSaveTimers.get(el); if (t) clearTimeout(t);
      persistNotesForElement(el, el.value);
    }
  }, true);
}

// Simple avatar color generator based on name string
function avatarColor(name) {
  const palette = ['#6b21a8','#0ea5e9','#ef4444','#f59e0b','#10b981','#8b5cf6','#d946ef','#f97316','#06b6d4','#f43f5e'];
  if (!name) return palette[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  const idx = Math.abs(h) % palette.length;
  return palette[idx];
}

// Helper to escape text when inserting into innerHTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Helper to determine if the screen is mobile (less than 768px, Tailwind's 'md' breakpoint)
function isMobile() {
    return window.innerWidth < 768;
}

// Helper to filter meetings from the global meetingsData array by a YYYY-MM-DD date string
function getMeetingsByDate(dateString) {
    const targetDate = dateString.slice(0, 10); // Ensure we only compare YYYY-MM-DD
    return meetingsData.filter(m => m.setDate.slice(0, 10) === targetDate);
}

// -------------------------------------------------------------------
// In-app modal for system toasts (replaces browser alert())
// Creates a small modal with a message and an OK button.
function ensureInAppModal() {
  if (document.getElementById('inapp-system-modal')) return;
  const html = `
    <div id="inapp-system-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div class="max-w-md w-full bg-bg-dark border border-border-dark rounded-lg p-5 text-left shadow-lg" style="backdrop-filter: blur(4px);">
        <h3 id="inapp-system-modal-title" class="text-white font-semibold text-lg mb-2">Notice</h3>
        <div id="inapp-system-modal-body" class="text-white/90 text-sm mb-4">Message</div>
        <div class="text-right">
          <button id="inapp-system-modal-ok" class="px-4 py-2 bg-main-purple text-white rounded hover:opacity-90">OK</button>
        </div>
      </div>
    </div>`;
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div.firstElementChild);
  const ok = document.getElementById('inapp-system-modal-ok');
  ok.addEventListener('click', () => {
    const modal = document.getElementById('inapp-system-modal');
    if (modal) modal.classList.add('hidden');
  });
}

/**
 * showInAppAlert(message, title)
 * Displays an in-app modal with an OK button. Non-blocking (returns immediately).
 */
function showInAppAlert(message, title = 'Notice') {
  try {
    ensureInAppModal();
    const modal = document.getElementById('inapp-system-modal');
    if (!modal) return console.warn('In-app modal not available');
    const titleEl = document.getElementById('inapp-system-modal-title');
    const bodyEl = document.getElementById('inapp-system-modal-body');
    titleEl.textContent = title || 'Notice';
    if (typeof message === 'string') bodyEl.textContent = message;
    else bodyEl.textContent = JSON.stringify(message);
    modal.classList.remove('hidden');
  } catch (e) { console.error('showInAppAlert failed', e); }
}

// Placeholder opener for Deal Activity Log (future backend: deal_logs)
function openDealLogs(dealId) {
  if (!dealId) return showInAppAlert('No deal selected for Activity Log', 'Activity Log');
  // Open a simple modal-like alert for now with clearer text per request
  showInAppAlert('All Activities for this Lead will Appear Here', 'Activity Log');
  console.info('[openDealLogs] placeholder called for dealId=', dealId);
}

// -------------------------------------------------------------------
// CALENDAR VIEW HANDLERS (Needed for both desktop and mobile views)
// -------------------------------------------------------------------

// Function to handle the desktop schedule panel update
function updateSchedulePanel(date) {
  console.log("🟦 [updateSchedulePanel] starting for date:", date);

  selectedDailyDate = date;
  const meetingsForDay = Array.isArray(meetingsData) && date ? getMeetingsByDate(date) : [];

  // Try to get a readable date label
  let dateLabel = date;
  try {
    dateLabel = new Date(date).toDateString();
  } catch (e) {
    console.warn("⚠️ Invalid date passed to updateSchedulePanel:", date);
  }

  const titleEl = document.getElementById('daily-meetings-title');
  const contentEl = document.getElementById('daily-meetings-list');
  if (!titleEl || !contentEl) {
    console.warn('🟠 [updateSchedulePanel] Missing elements: #daily-meetings-title or #daily-meetings-list');
    return;
  }

  // Update title and clear previous content
  titleEl.textContent = `Schedule for ${dateLabel}`;
  contentEl.innerHTML = '';

  // Handle empty schedule
  if (!meetingsForDay || meetingsForDay.length === 0) {
    contentEl.innerHTML = '<p class="text-white/60 text-center py-8">No meetings scheduled for this day.</p>';
    console.log("🟨 [updateSchedulePanel] No meetings for this day:", date);
    return;
  }

  // Render meetings for that day
  meetingsForDay.forEach(meeting => {
    try {
      const time = new Date(meeting.setDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const timeRemaining = getTimeRemaining(meeting.setDate) || { text: '', colorClass: 'text-white/70' };

      const meetingDiv = document.createElement('div');
      meetingDiv.className = 'p-3 bg-bg-dark border border-border-dark rounded-lg flex items-start space-x-3';

      meetingDiv.innerHTML = `
        <i class="fa-solid fa-clock text-main-purple flex-shrink-0 mt-1"></i>
        <div class="flex-1">
          <p class="text-white font-semibold">${meeting.agenda || 'Meeting'}</p>
          <p class="text-sm text-white/70">
            <span class="mr-3">${time}</span>
            <span class="${timeRemaining.colorClass} text-xs font-medium">${timeRemaining.text}</span>
          </p>
          <p class="text-xs text-white/50 mt-1">Contact: ${meeting.contactName || 'N/A'}</p>
        </div>
      `;
      contentEl.appendChild(meetingDiv);
    } catch (err) {
      console.error('❌ [updateSchedulePanel] failed rendering a meeting', meeting, err);
    }
  });

  console.log("✅ [updateSchedulePanel] complete — rendered", meetingsForDay.length, "meetings for", date);
}

// -------------------------------------------------------------------
function attachCalendarDayListeners() {
  console.log('🟦 [attachCalendarDayListeners] attaching to .day-square elements');
  const dayEls = document.querySelectorAll('.day-square');
  if (!dayEls || dayEls.length === 0) {
    console.warn('🟡 [attachCalendarDayListeners] no .day-square found in DOM');
    return;
  }

  dayEls.forEach(el => {
    // if click listener already attached via dataset flag, skip
    if (el.dataset.listenerAttached) return;
    el.addEventListener('click', (e) => {
      const date = e.currentTarget.dataset.date;
      console.log('🟦 [attachCalendarDayListeners] day clicked', date);
      const normalized = getLocalDateString(date) || date;

      // If this day element belongs to the Add Meeting modal (step-2) or the
      // step-2 calendar (#add-meeting-calendar), handle it locally by
      // selecting the date and rendering the time grid instead of opening the
      // global day-details modal which belongs to the main Meetings view.
      const inAddMeeting = !!e.currentTarget.closest('#add-meeting-modal') || !!e.currentTarget.closest('#add-meeting-calendar');

      if (inAddMeeting) {
        try { e.stopPropagation(); } catch (err) {}
        // clear selection only within the modal calendar to avoid clobbering
        // the main calendar's selection
        document.querySelectorAll('#add-meeting-calendar .day-square').forEach(d => d.classList.remove('selected-day'));
        e.currentTarget.classList.add('selected-day');

        // update hidden inputs + time grid in step 2
        try {
          const ds = (normalized && normalized.slice) ? normalized.slice(0,10) : (new Date(normalized)).toISOString().slice(0,10);
          if ($id('new-meeting-date')) $id('new-meeting-date').value = normalized;
          renderTimeGridForDate(ds);
          const selectedDateEl = document.getElementById('daily-selected-date');
          if (selectedDateEl) selectedDateEl.textContent = ds;
          const title = document.getElementById('daily-meetings-title');
          if (title) title.textContent = `Schedule for ${ds}`;
        } catch (err) { console.warn('Failed to update step-2 date/time UI', err); }

        return;
      }

      if (isMobile()) {
        // Prevent this click from bubbling to generic document handlers which
        // may hide modals/menus immediately after we open the day details modal.
        try { e.stopPropagation(); } catch (err) {}
        showDayDetailsModal(e.currentTarget);
      } else {
        updateSchedulePanel(normalized);
      }

      document.querySelectorAll('.day-square').forEach(d => d.classList.remove('selected-day'));
      e.currentTarget.classList.add('selected-day');
    });
    el.dataset.listenerAttached = 'true';
  });

  // mobile modal close hook
  const cancelBtn = document.getElementById('cancel-day-details-modal');
  if (cancelBtn) {
    cancelBtn.removeEventListener('click', closeDayDetailsModal);
    cancelBtn.addEventListener('click', closeDayDetailsModal);
  }

  console.log('🟦 [attachCalendarDayListeners] attached to', dayEls.length, 'day elements');
}

// Function to handle showing the day's meetings in the new mobile modal
function showDayDetailsModal(dayElement) {
    const date = dayElement.dataset.date;
    const meetingsForDay = getMeetingsByDate(date); 
    
    let dateLabel = date; 
    try {
        dateLabel = new Date(date).toDateString();
    } catch (e) {
        // use raw date if invalid
    }
    
    const modal = document.getElementById('meetings-day-details-modal');
    const title = document.getElementById('day-details-title');
    const content = document.getElementById('day-details-content');
    
    if (!modal) return;
    
    title.textContent = `Schedule for ${dateLabel}`;
    content.innerHTML = ''; 

    if (meetingsForDay.length === 0) {
        content.innerHTML = '<p class="text-white/60 text-center py-8">No meetings scheduled for this day.</p>';
    } else {
        meetingsForDay.forEach(meeting => {
            const meetingDiv = document.createElement('div');
            // Assuming the meeting object has 'setDate', 'agenda', and 'contactName'
            const time = new Date(meeting.setDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            meetingDiv.className = 'p-3 bg-bg-dark border border-border-dark rounded-lg flex items-start space-x-3';
            
            meetingDiv.innerHTML = `
                <i class="fa-solid fa-clock text-main-purple flex-shrink-0 mt-1"></i>
                <div>
                    <p class="text-white font-semibold">${meeting.agenda || 'Meeting'}</p>
                    <p class="text-sm text-white/70">${time} with ${meeting.contactName || 'N/A'}</p>
                    <p class="text-xs text-white/50 mt-1">Phone: ${meeting.contactPhone || 'N/A'}</p>
                </div>
            `;
            content.appendChild(meetingDiv);
        });
    }

  // Modal display animation - ensure backdrop is visible above other UI
  // Move modal to body so it's not constrained by parent stacking contexts
  try { if (modal.parentNode !== document.body) document.body.appendChild(modal); } catch (e) {}
  modal.classList.remove('hidden');
  try { modal.style.display = 'flex'; modal.style.zIndex = '120000'; modal.style.pointerEvents = 'auto'; modal.style.position = 'fixed'; } catch (e) {}
  void modal.offsetWidth; // Trigger reflow
  modal.classList.add('opacity-100');
  // Mobile slide-up effect: remove translate on the inner panel
  const inner = modal.querySelector(':scope > div');
  if (inner) {
    inner.classList.remove('translate-y-full');
    // also clear any inline top/left that might accidentally position it
    try { inner.style.top = ''; inner.style.left = ''; } catch (e) {}
  }
}

// Function to close the Day Details Modal
function closeDayDetailsModal() {
    const modal = document.getElementById('meetings-day-details-modal');
    if (modal) {
        modal.classList.remove('opacity-100');
    modal.querySelector(':scope > div').classList.add('translate-y-full');
        
        // Wait for the slide-down transition to finish before hiding
        setTimeout(() => {
            modal.classList.add('hidden');
      modal.querySelector(':scope > div').classList.remove('translate-y-full');
      try { modal.style.zIndex = ''; modal.style.display = ''; modal.style.pointerEvents = ''; } catch (e) {}
        }, 300); 
    }
}

// -------------------------------------------------------------------
// SUPABASE LOADERS (map DB rows to the UI-friendly objects)
async function loadContacts() {
  try {
    logStep('Loading contacts...');
    // ADD .eq('business_id', BUSINESS_ID)
    const { data, error } = await client.from('contacts')
      .select('*')
      .eq('business_id', BUSINESS_ID)
      // Order by creation time descending so most recently added contacts appear first
      .order('created_at', { ascending: false });
    if (error) throw error;
    contacts = data || [];
    logStep('Contacts loaded', contacts.length);
    renderContacts(currentPageView);
  } catch (err) {
    console.error('❌ loadContacts error', err);
  }
}

async function loadDeals() {
  try {
    logStep('Loading deals...');
    // ADD .eq('business_id', BUSINESS_ID)
    const { data, error } = await client.from('deals_pipeline_view')
      .select('*')
      .eq('business_id', BUSINESS_ID)
      // Return newest deals first
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Normalize to the shape used by the original UI (dealName, contactName, contactPhone, amount, closeDate, stage)
    dealsData = (data || []).map(d => ({
      id: d.id,
      dealName: d.deal_name,
      contactId: d.contact_id,
      contactName: d.contact_name || '',
      contactPhone: d.contact_phone || '',
      stage: d.stage,
      amount: Number(d.amount || 0),
      closeDate: d.close_date,
      // Prefer contact notes for follow-up flows. We'll surface contact notes in the follow-up modal
      contactNotes: d.contact_notes || d.contactNotes || '',
      notes: (d.contact_notes || d.contactNotes) ? (d.contact_notes || d.contactNotes) : (d.notes || ''),
      created_at: d.created_at
    }));
    logStep('Deals loaded', dealsData.length);
    const totalEl = document.getElementById('total-deals-count'); if (totalEl) totalEl.textContent = dealsData.length;
    // Render depending on view
  // NEW Responsive Rendering Logic in loadDeals():
if (isMobile()) {
    renderDealsMobileCardView(); // Render the new mobile card view
} else {
    // Existing logic for desktop (only renders list or pipeline view)
    if (currentDealsView === 'pipeline') renderDealsPipeline();
    else renderDealsList();
}
  } catch (err) {
    console.error('❌ loadDeals error', err);
  }
}

/// -------------------------
// AFTER SALE: loader + renderer (safe minimal version)
// -------------------------
// -----------------------------
// Step 4: Supabase-only After Sale Loader
// -----------------------------
async function loadAfterSale() {
  console.log("🟣 [AfterSale] Loading after-sale data for", BUSINESS_ID);
  try {
    const { data, error } = await client
      .from("after_sale_view")
      .select("*")
      .eq("business_id", BUSINESS_ID)
      .order("timestamp", { ascending: false });

    if (error) throw error;
    if (!data?.length) {
      console.warn("🟡 No after-sale data found.");
      renderAfterSale([]);
      return;
    }

    // Group by contact_id
    const grouped = {};
    for (const row of data) {
      const cid = row.contact_id;
      if (!grouped[cid]) {
        grouped[cid] = {
          id: cid,
          name: row.contact_name,
          phone: row.contact_phone,
          history: [],
          amount: 0,
          date: row.timestamp,
        };
      }
      // Merge purchases & amounts
      const products = Array.isArray(row.products)
        ? row.products.map(p => p.name || JSON.stringify(p))
        : [];
      grouped[cid].history.push(...products);
      grouped[cid].amount += Number(row.amount || 0);
    }

    const customers = Object.values(grouped);
    console.table(customers, ["name", "phone", "amount", "history"]);

    renderAfterSale(customers);
    console.log("🟣 [AfterSale] Rendered grouped customers:", customers.length);
    afterSaleGroupedCache = customers;
      attachHistoryButtons();
  } catch (err) {
    console.error("🛑 [AfterSale] Load failed:", err);
  }
}

function renderAfterSale(customers = []) {
  const list = document.getElementById('after-sale-list-container');
  const header = document.getElementById('after-sale-header');
  const mobile = document.getElementById('after-sale-mobile-view');
  if (!list || !mobile) {
    console.warn('After Sale containers missing in DOM');
    return;
  }

  // clear previous content
  list.innerHTML = '';
  mobile.innerHTML = '';

  // empty state
  if (!customers.length) {
    header.classList.add('hidden');
    const emptyMsg = '<p class="text-white/60 text-center py-6">Your Customers will Appear Here</p>';
    list.innerHTML = emptyMsg;
    mobile.innerHTML = emptyMsg;
    return;
  }

  header.classList.remove('hidden');

  // Ensure after-sale customers are ordered newest-first (by date or added_date)
  customers = (customers || []).slice().sort((a, b) => new Date(b.date || b.added_date || 0) - new Date(a.date || a.added_date || 0));

  // Desktop rows (grid like deals)
  // ---------------------------------------------------
// 🖥️ DESKTOP VIEW (continuous grid + single-line rows + hover "History" button)
// ---------------------------------------------------
customers.forEach((c) => {
  const history = Array.isArray(c.history) ? c.history : (c.item ? [c.item] : ['—']);
  const lastItem = history[history.length - 1] || '—';
  const hasHistory = history.length > 1;

  const row = document.createElement('div');
  row.className =
    'grid grid-cols-[1.2fr_1.2fr_1.2fr_1fr_1fr_0.6fr] text-white/90 text-sm border-b border-border-dark hover:bg-bg-dark/60 transition-colors';
  // mark desktop row with data attributes for search targeting
  row.setAttribute('data-after-sale-id', c.id);
  row.setAttribute('data-id', c.id);

  row.innerHTML = `
    <div class="truncate border-r border-border-dark px-4 py-3 flex items-center">${c.name || '—'}</div>
    <div class="truncate border-r border-border-dark px-4 py-3 flex items-center">${c.phone || '—'}</div>
    <div class="truncate relative border-r border-border-dark px-4 py-3 flex items-center justify-between group">
      <span class="truncate">${lastItem}</span>
      ${
        hasHistory
          ? `<button class="history-btn bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium px-2 py-1 rounded-md ml-2 hidden group-hover:inline-flex items-center justify-center whitespace-nowrap">History</button>
             <div class="purchase-popup hidden absolute -top-3 translate-y-[-100%] left-1/2 -translate-x-1/2 bg-bg-card border border-border-dark rounded-xl shadow-2xl p-3 z-[9999] w-56 text-sm">
               <p class="text-white/70 font-semibold mb-2 border-b border-border-dark pb-1 text-center">Purchase History</p>
               ${history.map((i) => `<p class="text-white/80 text-center py-0.5">${i}</p>`).join('')}
             </div>`
          : ''
      }
    </div>
    <div class="truncate border-r border-border-dark px-4 py-3 flex items-center">${formatKES(c.amount || 0)}</div>
    <div class="truncate border-r border-border-dark px-4 py-3 flex items-center">${formatDate(c.date)}</div>
    <div class="px-4 py-3 flex justify-center items-center">
      <button class="after-sale-action bg-main-purple hover:bg-purple-700 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap" data-id="${c.id}" data-name="${c.name}">
        After Sale
      </button>
      <button class="text-white/60 hover:text-blue-500 after-sale-actions-btn ml-2" title="More Actions" data-id="${c.id}">
        <i class="fa-solid fa-ellipsis-v"></i>
      </button>
    </div>
  `;

  // Attach logic for History button (fix popup visibility)
  if (hasHistory) {
    const historyBtn = row.querySelector('.history-btn');
    const popup = row.querySelector('.purchase-popup');

    if (historyBtn && popup) {
      popup.style.zIndex = '9999';
      popup.style.pointerEvents = 'auto';

      historyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // hide other popups and toggle this one
        document.querySelectorAll('.purchase-popup').forEach((p) => {
          if (p !== popup) p.classList.add('hidden');
        });
        popup.classList.toggle('hidden');
      });

      // Close popup when clicking outside (scoped to this popup)
      const outsideHandler = (e) => {
        const clickedInside = popup.contains(e.target) || historyBtn.contains(e.target);
        if (!clickedInside) popup.classList.add('hidden');
      };
      document.addEventListener('click', outsideHandler);

      // Store reference for potential cleanup later
      popup._outsideHandler = outsideHandler;
    }
  }

  // Attach After Sale button logic
  const btn = row.querySelector('.after-sale-action');
  if (btn) {
    btn.addEventListener('click', () => {
      openAfterSalePopup && openAfterSalePopup(c.id, c.name);
    });
  }

  list.appendChild(row);
});

// -------------------------------------------------------------------
// AFTER-SALE ACTIONS MENU (three-dots menu for after-sale rows)
// The real handler is implemented below as attachAfterSaleActionsHandlers().
// (Removed an accidental duplicate helper that attempted to wire schedules UI inside
// the after-sale rendering area — that logic lived in a different place and caused
// collisions with the meetings scheduler. Keeping after-sale menu wiring minimal here.)

async function deleteAfterSale(contactId) {
  try {
    // attempt to delete underlying after_sale records for the contact
    const { error } = await client.from('after_sales').delete().eq('contact_id', contactId).eq('business_id', BUSINESS_ID);
    if (error) throw error;
    logStep('After-sale records deleted for', contactId);
    await loadAfterSale();
  } catch (err) {
    console.error('❌ deleteAfterSale error', err);
    throw err;
  }
}

// Attach mobile swipe handlers and delete wiring to after-sale cards
function attachMobileAfterSaleSwipeHandlers() {
  if (!isMobile()) return; // only apply on mobile
  const container = document.getElementById('after-sale-mobile-view');
  if (!container) return;

  const REVEAL_PX = 72; // how much to reveal the delete button
  const THRESHOLD = 40; // gesture threshold to lock reveal

  const cards = Array.from(container.children).filter(c => c && (c.getAttribute && c.getAttribute('data-after-sale-id')));
  cards.forEach(card => {
    const slideEl = card.querySelector('.after-sale-card-slide');
    const deleteBtn = card.querySelector('.after-sale-delete-btn');
    if (!slideEl || !deleteBtn) return;

    let startX = 0, startY = 0, dx = 0, swiping = false;

    function reset() {
      slideEl.style.transition = 'transform .2s ease';
      slideEl.style.transform = 'translateX(0px)';
  const detailModal = document.getElementById('schedule-detail-modal-backdrop');
  if (detailModal) detailModal._activeCard = card;
      // hide delete btn
      deleteBtn.style.opacity = '0';
      deleteBtn.style.pointerEvents = 'none';
      swiping = false;
    }

    function reveal() {
      slideEl.style.transition = 'transform .18s ease';
      slideEl.style.transform = `translateX(-${REVEAL_PX}px)`;
      card.dataset.revealed = 'true';
      // show delete btn
      deleteBtn.style.opacity = '1';
      deleteBtn.style.pointerEvents = 'auto';
      swiping = false;
    }

    card.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      swiping = false;
      slideEl.style.transition = '';
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!e.touches || !e.touches[0]) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      dx = x - startX;
      // detect horizontal swipe intent
      if (!swiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
        swiping = true;
      }
      if (!swiping) return;
      // prevent vertical scroll when swiping horizontally
      e.preventDefault();
      // only allow left swipe (negative dx)
      const translate = Math.max(Math.min(dx, 0), -REVEAL_PX);
      slideEl.style.transform = `translateX(${translate}px)`;
      // progressively reveal deleteBtn during swipe
      try {
        const frac = Math.min(1, Math.abs(translate) / REVEAL_PX);
        deleteBtn.style.opacity = String(frac);
        if (frac > 0.6) deleteBtn.style.pointerEvents = 'auto'; else deleteBtn.style.pointerEvents = 'none';
      } catch (e) { /* ignore UI calc errors */ }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      if (!swiping) return;
      if (dx <= -THRESHOLD) reveal();
      else reset();
    });

    // Click on delete button
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(deleteBtn.dataset['afterSaleId'] || deleteBtn.getAttribute('data-after-sale-id') || deleteBtn.dataset.afterSaleId, 10);
      if (isNaN(id)) return;
      // Animate removal then call backend
      const el = card;
      try {
        // slide away animation
        el.style.transition = 'transform .25s ease, opacity .25s ease, height .25s ease, margin .25s ease, padding .25s ease';
        el.style.transform = 'translateX(-120%)';
        el.style.opacity = '0';
        // collapse height after a short delay
        setTimeout(() => {
          el.style.height = '0px';
          el.style.margin = '0px';
          el.style.padding = '0px';
        }, 220);

        // call backend delete
        await deleteAfterSale(id);

        // finally remove element from DOM
        setTimeout(() => {
          el.remove();
          // refresh list to ensure order/counts update
          try { loadAfterSale(); } catch (err) { /* ignore */ }
        }, 360);
        } catch (err) {
        console.error('❌ delete failed', err);
        // revert
        reset();
        showInAppAlert('Failed to delete after-sale records — see console.');
      }
    });

    // If user taps the card while revealed, close it instead of opening details
    card.addEventListener('click', (e) => {
      if (card.dataset.revealed === 'true') {
        e.stopPropagation();
        reset();
        return;
      }
    });
  });

  // Close any revealed card when user clicks elsewhere (attach once)
  try {
    if (!container.dataset.swipeDocHandlerAttached) {
      const docHandler = (e) => {
        // If click is inside an after-sale card or on a delete button, ignore
        if (e.target.closest && e.target.closest('[data-after-sale-id]')) return;
        const openCards = Array.from(container.children).filter(c => c && c.dataset && c.dataset.revealed === 'true');
        openCards.forEach(c => {
          const slide = c.querySelector('.after-sale-card-slide');
          const del = c.querySelector('.after-sale-delete-btn');
          if (slide) { slide.style.transition = 'transform .18s ease'; slide.style.transform = 'translateX(0px)'; }
          c.dataset.revealed = 'false';
          if (del) { del.style.opacity = '0'; del.style.pointerEvents = 'none'; }
        });
      };
      document.addEventListener('click', docHandler);
      container.dataset.swipeDocHandlerAttached = 'true';
    }
  } catch (err) { /* ignore */ }
}

// Expose after-sale swipe handler to window for robustness
try { window.attachMobileAfterSaleSwipeHandlers = attachMobileAfterSaleSwipeHandlers; } catch (e) { /* ignore */ }

// Expose deal swipe handler to window for robustness
try { window.attachMobileDealSwipeHandlers = attachMobileDealSwipeHandlers; } catch (e) { /* ignore */ }

// Attach after-sale three-dots handlers for desktop
// Provides the actions dropdown shown when the user clicks the ellipsis button
function attachAfterSaleActionsHandlers() {
  try {
    const list = document.getElementById('after-sale-list-container');
    if (!list) return;
    list.querySelectorAll('.after-sale-actions-btn').forEach(btn => {
      if (btn.dataset.listenerAttached) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showAfterSaleMenuForButton(e.currentTarget);
      });
      btn.dataset.listenerAttached = 'true';
    });
  } catch (err) {
    console.warn('attachAfterSaleActionsHandlers failed', err);
  }
}

function showAfterSaleMenuForButton(btn) {
  if (!btn) return;
  // remove existing
  const existing = document.getElementById('after-sale-actions-popup');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'after-sale-actions-popup';
  menu.className = 'bg-bg-card border border-border-dark rounded-xl p-3 text-sm text-white shadow-2xl';
  menu.style.position = 'absolute';
  menu.style.zIndex = 99999;
  const rect = btn.getBoundingClientRect();
  menu.style.left = (rect.left + window.scrollX) + 'px';
  menu.style.top = (rect.top + window.scrollY + rect.height + 8) + 'px';

  menu.innerHTML = `
    <div class="font-semibold mb-2">Actions</div>
    <button class="block w-full text-left py-1 px-2 hover:bg-white/5" id="after-sale-view-btn">View</button>
    <button class="block w-full text-left py-1 px-2 hover:bg-white/5" id="after-sale-delete-btn">Delete</button>
  `;
  document.body.appendChild(menu);

  document.getElementById('after-sale-view-btn')?.addEventListener('click', () => { menu.remove(); showInAppAlert('View action not implemented'); });
  document.getElementById('after-sale-delete-btn')?.addEventListener('click', () => { menu.remove(); showInAppAlert('Delete action not implemented'); });

  setTimeout(() => {
    const outside = (ev) => { if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener('click', outside); } };
    document.addEventListener('click', outside);
  }, 10);
}

  // Attach after-sale three-dots handlers for desktop
  // call the global attach function (defined at module scope)
  if (typeof attachAfterSaleActionsHandlersGlobal === 'function') attachAfterSaleActionsHandlersGlobal();
  else attachAfterSaleActionsHandlers();

  // Mobile view (swipeable cards with last item + delete)
  customers.forEach((c) => {
    const lastItem = (Array.isArray(c.history) && c.history[c.history.length - 1]) || c.item || 'N/A';
    const outer = document.createElement('div');
    outer.className = 'relative overflow-visible mb-3';
    outer.setAttribute('data-after-sale-id', c.id);

    outer.innerHTML = `
      <button class="after-sale-delete-btn absolute right-3 top-1/2 -translate-y-1/2 bg-red-600 hover:bg-red-700 text-white p-2 rounded-md z-10" data-after-sale-id="${c.id}" aria-label="Delete After Sale"
              style="opacity:0; pointer-events:none; transform:translateX(6px); transition:opacity .18s ease, transform .18s ease;">
        <i class="fa-solid fa-trash"></i>
      </button>

      <div class="after-sale-card-slide bg-bg-card rounded-xl border border-border-dark p-4 transition-transform duration-150 relative z-20 flex items-center justify-between" style="min-height:3.5rem;">
        <div class="flex-1">
          <h3 class="font-bold text-lg text-white">${c.name}</h3>
          <p class="text-white/70 text-sm"><i class="fa-solid fa-phone mr-2"></i>${c.phone || 'N/A'}</p>
          <p class="text-white/70 text-sm">Last Item: ${lastItem}</p>
        </div>
        <button class="bg-main-purple hover:bg-purple-700 text-white text-sm font-semibold py-1.5 px-4 rounded-lg transition-colors flex-shrink-0 after-sale-open-btn" data-contact-id="${c.id}" data-name="${c.name}">
          After Sale
        </button>
      </div>
    `;

    mobile.appendChild(outer);
  });

  // Attach listeners to the After Sale buttons (respect revealed state)
  mobile.querySelectorAll('.after-sale-open-btn').forEach(btn => {
    if (btn.dataset.listenerAttached) return;
    btn.addEventListener('click', (e) => {
      const outer = e.currentTarget.closest('[data-after-sale-id]');
      if (outer && outer.dataset.revealed === 'true') {
        // close instead of opening
        const slide = outer.querySelector('.after-sale-card-slide');
        const del = outer.querySelector('.after-sale-delete-btn');
        if (slide) { slide.style.transition = 'transform .18s ease'; slide.style.transform = 'translateX(0px)'; }
        outer.dataset.revealed = 'false';
        if (del) { del.style.opacity = '0'; del.style.pointerEvents = 'none'; }
        return;
      }
      const id = parseInt(e.currentTarget.dataset.contactId, 10);
      openAfterSalePopup && openAfterSalePopup(id, e.currentTarget.dataset.name);
    });
    btn.dataset.listenerAttached = 'true';
  });

  // Attach swipe handlers for after-sale mobile cards
  try { attachMobileAfterSaleSwipeHandlers(); } catch (e) { console.warn('attachMobileAfterSaleSwipeHandlers failed', e); }
}



async function loadFollowUps() {
  try {
    logStep('Loading follow-ups (using view `followups_today`)...');
    console.time('loadFollowUps');
    // Use the DB view `followups_today` (combines user and system followups for today)
    const { data, error } = await client.from('followups_today')
      .select('*')
      .eq('business_id', BUSINESS_ID)
      .order('followup_time', { ascending: true, nullsFirst: true });
    if (error) throw error;
    const items = data || [];
    console.debug('[DEBUG] followups_today raw rows:', items.length, items.slice(0,5));
    // warn if any row is missing followup_id (indicates view/data mismatch)
    const missingIds = items.filter(r => !r.followup_id);
    if (missingIds.length) console.warn('⚠️ followups_today returned rows without followup_id:', missingIds.length, missingIds.slice(0,3));

    // Fetch related feedback rows in one call for efficiency
    const followupIds = items.map(i => i.followup_id).filter(Boolean);
    let feedbackRows = [];
    if (followupIds.length) {
      try {
        const { data: fbData, error: fbError } = await client.from('followup_feedback')
          .select('id,followup_id,feedback_stage,feedback_notes,created_at')
          .in('followup_id', followupIds)
          .eq('business_id', BUSINESS_ID);
        if (fbError) console.warn('⚠️ followup_feedback fetch warning', fbError);
        feedbackRows = fbData || [];
        console.debug('[DEBUG] followup_feedback rows fetched:', feedbackRows.length, feedbackRows.slice(0,6));
      } catch (e) {
        console.warn('⚠️ followup_feedback fetch failed', e);
      }
    }

    // Map DB rows to the UI-friendly shape expected elsewhere in the app
    followUps = (items || []).map(f => {
      const fbs = feedbackRows.filter(r => r.followup_id === f.followup_id);
      const stage1 = fbs.find(r => String(r.feedback_stage) === '1');
      const stage2 = fbs.find(r => String(r.feedback_stage) === '2');
      const stage1CreatedAt = stage1 ? new Date(stage1.created_at) : null;
      const stage1AgeMs = stage1CreatedAt ? (Date.now() - stage1CreatedAt.getTime()) : null;
      const stage1OlderThan6h = stage1AgeMs !== null && stage1AgeMs >= 6 * 60 * 60 * 1000;

      return {
        // preserve original friendly names used across the UI
        id: f.followup_id,
        followup_id: f.followup_id,
        business_id: f.business_id,
        contact_id: f.contact_id,
        contactId: f.contact_id,
        contactName: f.contact_name || '',
        contactPhone: f.contact_phone || '',
        deal_id: f.deal_id,
        dealId: f.deal_id,
        dealName: f.deal_name || f.dealName || '',
        title: f.title || f.followup_title || '',
        followup_title: f.followup_title || f.title || '',
        message_prompt: f.message_prompt || '',
        followup_date: f.followup_date,
        followup_time: f.followup_time,
        status: f.status,
        response_notes: f.response_notes || null,
        source: f.source || 'user',
        created_at: f.created_at,

        // feedback metadata (used to compute widget state)
        feedback_stage1_exists: !!stage1,
        feedback_stage2_exists: !!stage2,
        feedback_stage1_created_at: stage1 ? stage1.created_at : null,
        feedback_needs_stage2: (!!stage1 && !stage2 && stage1OlderThan6h)
      };
    });

    // Toggle feedback widget visibility based on whether any feedback rows exist
    try {
      const feedbackWidget = document.getElementById('feedback-widget');
      const hasAnyFeedback = (feedbackRows && feedbackRows.length > 0) || followUps.some(f => f.feedback_stage1_exists || f.feedback_stage2_exists);
      if (feedbackWidget) {
        if (hasAnyFeedback) feedbackWidget.classList.remove('hidden');
        else feedbackWidget.classList.add('hidden');
      }
    } catch (e) { console.warn('Failed to toggle feedback widget visibility', e); }

    logStep('Follow-ups loaded', followUps.length);
    // Provide a breakdown of feedback stages for quick debugging
    const stats = followUps.reduce((acc, fu) => {
      if (fu.feedback_stage1_exists) acc.stage1++;
      if (fu.feedback_stage2_exists) acc.stage2++;
      if (fu.feedback_needs_stage2) acc.needsStage2++;
      return acc;
    }, { stage1: 0, stage2: 0, needsStage2: 0 });
    console.debug('[DEBUG] followUps (first 10)', followUps.slice(0, 10));
    console.debug('[DEBUG] followUps feedback stats', stats);
    console.timeEnd('loadFollowUps');
    renderFollowUps();
  } catch (err) {
    console.error('❌ loadFollowUps error', err);
  }
}

// -----------------------------
// REPLACE: loadMeetings() - Supabase-backed and normalized
// -----------------------------
async function loadMeetings() {
  try {
    logStep('Loading meetings from Supabase...');

    // ✅ Fixed: use actual column names from your schema
    const { data, error } = await client
      .from('meetings')
      .select(`
        id,
        name,
        details,
        start_at,
        end_at,
        business_id,
        contact_id,
        contacts (id, name)
      `)
      .eq('business_id', BUSINESS_ID)
      .order('start_at', { ascending: true });

    if (error) throw error;

    // ✅ Normalize to UI shape
    meetingsData = (data || []).map(row => {
      // Use real date fields from schema
      const rawDate = row.start_at || row.setDate || row.due_date || null;
      let setDateIso = null;

      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d)) {
          // Keep in local time (avoid UTC shift)
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          const ss = String(d.getSeconds()).padStart(2, '0');
          setDateIso = `${y}-${m}-${day}T${hh}:${mm}:${ss}`;
        } else {
          setDateIso = rawDate;
        }
      }

      const contactName = row.contacts?.name || '';
      const contactId = row.contact_id || null;
      const setDateForCompare = setDateIso?.slice?.(0, 10) || null;
      const isPast = setDateForCompare ? new Date(setDateForCompare) < new Date() : false;

      return {
        id: row.id,
        agenda: row.name || 'Meeting',
        details: row.details || '',
        contactName,
        contactPhone: '', // You can add this once your contacts table includes phone
        setDate: setDateIso,
        endDate: row.end_at || null,
        contactId,
        contactNotes: '',
        isPast,
        businessName: BUSINESS_NAME || '',
        raw: row
      };
    });

    logStep('Meetings loaded', meetingsData.length);

    // ✅ Build map for calendar quick lookups
    window.meetingsMap = new Map();
    meetingsData.forEach(m => {
      if (!m.setDate) return;
      const key = m.setDate.slice(0, 10);
      const arr = window.meetingsMap.get(key) || [];
      arr.push(m);
      window.meetingsMap.set(key, arr);
    });

    // ✅ Re-render UI (list + calendar + panel)
    if (typeof renderMeetingsList === 'function') renderMeetingsList();
    if (typeof attachMeetingActionsHandlers === 'function') attachMeetingActionsHandlers();
    if (typeof renderCalendarMonth === 'function') renderCalendarMonth(currentCalendarDate);
    if (selectedDailyDate)
      updateSchedulePanel(
        typeof selectedDailyDate === 'string'
          ? selectedDailyDate
          : selectedDailyDate.toISOString?.() || ''
      );
  } catch (err) {
    console.error('❌ loadMeetings error', err);
    meetingsData = [];
    window.meetingsMap = new Map();
  }
}

// -------------------------------------------------------------------
// CREATE / INSERT HANDLERS
async function addContact(event) {
  if (event && event.preventDefault) event.preventDefault();
  const submitButton = document.getElementById('add-contact-submit-btn');
  const originalHtml = submitButton ? submitButton.innerHTML : '';
  const originalClasses = submitButton ? submitButton.className : '';

  try {
    logStep('Creating contact...');
    const name = document.getElementById('new-contact-name')?.value?.trim();
    const phone = document.getElementById('new-contact-phone')?.value?.trim();
    const notes = document.getElementById('new-contact-notes')?.value?.trim();
  if (!name) { showInAppAlert('Please provide a name'); return; }
    const payload = { name, phone: phone || null, notes: notes || null, added_date: new Date().toISOString().slice(0,10), business_id: BUSINESS_ID };
    const { data, error } = await client.from('contacts').insert([payload]).select().single();
    if (error) throw error;
    logStep('Contact inserted', data);
    // Sanity check: ensure business_id was written
    if (!data || data.business_id !== BUSINESS_ID) {
      console.error('❗ addContact: inserted contact missing or wrong business_id', { expected: BUSINESS_ID, got: data?.business_id, data });
      showInAppAlert('Warning: contact inserted but business_id was not set correctly. Check console for details.');
    }
    await loadContacts();

  // NEW: SUCCESS FEEDBACK LOGIC
  if (submitButton) {
    submitButton.innerHTML = '<i class="fa-solid fa-check mr-2"></i> Added Successfully';
    submitButton.classList.remove('bg-main-purple', 'hover:bg-purple-700');
    submitButton.classList.add('bg-add-green', 'hover:bg-green-700');

    // If this was opened from the Meeting modal, select the new contact into the meeting form
    if (formOrigin === 'meeting') {
      const searchInput = document.getElementById('new-meeting-contact-search');
      if (searchInput) searchInput.value = `${data.name} (${data.phone || ''})`;
      const contactIdInput = document.getElementById('new-meeting-contact-id');
      if (contactIdInput) contactIdInput.value = data.id;
      // Update the meeting contact card / associated deal
      if (typeof renderSelectedMeetingContactCard === 'function') renderSelectedMeetingContactCard();
      // Reset origin
      formOrigin = null;
      // Close only the add modal and restore z-index so meeting modal remains visible underneath
      setTimeout(() => {
        closeModal('add-main-modal');
        const addModal = document.getElementById('add-main-modal'); if (addModal) addModal.style.zIndex = '';
        // Revert button state for next use
        submitButton.className = originalClasses;
        submitButton.innerHTML = originalHtml;
      }, 900);

    // Only close the modal and revert if not from nested deal flow
    } else if (formOrigin !== 'deal') {
      setTimeout(() => {
        closeModal('add-main-modal');
        // Revert button state for next use
        submitButton.className = originalClasses;
        submitButton.innerHTML = originalHtml;
      }, 1500); // Show success for 1.5 seconds
    } else {
      // Nested form logic - revert button immediately after switching back
      selectedDealContact = data;
      const searchInput = document.getElementById('deal-contact-search');
      if (searchInput) searchInput.value = `${data.name} (${data.phone || ''})`;
      const contactIdInput = document.getElementById('new-deal-contact-id');
      if (contactIdInput) contactIdInput.value = data.id;
      formOrigin = null;
      switchAddForm('deal');
            
      submitButton.className = originalClasses;
      submitButton.innerHTML = originalHtml;
    }
  }
    
  document.getElementById('add-contact-form')?.reset();
  showInAppAlert(`Contact ${name} added`);

  } catch (err) {
  console.error('❌ addContact error', err);
  showInAppAlert('Failed to add contact — see console.');
    // Revert button on failure
    if (submitButton) {
        submitButton.className = originalClasses;
        submitButton.innerHTML = originalHtml;
    }
  }
}


async function createDeal(event) {
  if (event && event.preventDefault) event.preventDefault();
  try {
    logStep('Creating deal...');
    const dealName = document.getElementById('new-deal-name')?.value?.trim();
  const amount = parseFloat(document.getElementById('new-deal-amount')?.value || 0) || 0;
  const stage = document.getElementById('new-deal-stage')?.value || 'New Leads';
  const closeDate = document.getElementById('new-deal-close-date')?.value || null;
  const notes = document.getElementById('new-deal-notes')?.value?.trim() || '';
    const contactId = parseInt(document.getElementById('new-deal-contact-id')?.value || 0, 10) || null;
  if (!dealName) { showInAppAlert('Please provide a product or service'); return; }
  if (!contactId) { showInAppAlert('Please select a contact'); return; }

  const payload = { deal_name: dealName, contact_id: contactId, stage, amount, close_date: closeDate, notes, business_id: BUSINESS_ID };
    const { data, error } = await client.from('deals').insert([payload]).select().single();
    if (error) throw error;
    logStep('Deal created', data);
    // Sanity check: ensure business_id was written
    if (!data || data.business_id !== BUSINESS_ID) {
  console.error('❗ createDeal: inserted deal missing or wrong business_id', { expected: BUSINESS_ID, got: data?.business_id, data });
  showInAppAlert('Warning: deal inserted but business_id was not set correctly. Check console for details.');
    }
    await loadDeals();

    // if nested origin then continue the flow
    if (formOrigin === 'follow-up') {
      selectedFollowUpDeal = { id: data.id, name: data.deal_name, contactName: contacts.find(c => c.id === data.contact_id)?.name || '' };
      formOrigin = null;
      switchAddForm('follow-up');
    } else {
      closeModal('add-main-modal');
    }
    document.getElementById('add-deal-form')?.reset();
    document.getElementById('deal-contact-search') && (document.getElementById('deal-contact-search').value = '');
    selectedDealContact = null;
  showInAppAlert(`Deal "${dealName}" created`);
  } catch (err) {
  console.error('❌ createDeal error', err);
  showInAppAlert('Failed to create deal — see console.');
  }
}



async function createFollowUp(event) {
  if (event && event.preventDefault) event.preventDefault();
  try {
    logStep('Creating follow-up...');
    const reason = document.getElementById('new-follow-up-reason')?.value?.trim();
    const notes = document.getElementById('new-follow-up-notes')?.value?.trim() || null;
    const dueAt = document.getElementById('new-follow-up-due-date')?.value || null;
    const dealIdInput = document.getElementById('new-follow-up-deal-id');
    const dealId = parseInt(dealIdInput?.value || '0', 10) || null; // Use new-follow-up-deal-id

    if (!reason || !dueAt) { showInAppAlert('Please fill reason and due date'); return; }

    // Parse datetime-local into date + time to match `user_followups` schema
    let followup_date = null;
    let followup_time = null;
    try {
      const dt = new Date(dueAt);
      if (!isNaN(dt.getTime())) {
        followup_date = dt.toISOString().slice(0,10); // YYYY-MM-DD
        // Format time as HH:MM:SS (remove timezone influence by using local time)
        const hh = String(dt.getHours()).padStart(2, '0');
        const mm = String(dt.getMinutes()).padStart(2, '0');
        const ss = String(dt.getSeconds()).padStart(2, '0');
        followup_time = `${hh}:${mm}:${ss}`;
      }
    } catch (e) { console.warn('createFollowUp: could not parse dueAt', dueAt, e); }

    // Determine contact_id if a deal was selected
    const contactIdFromDom = document.getElementById('new-follow-up-contact-id')?.value || null;
    const contactId = contactIdFromDom ? (parseInt(contactIdFromDom, 10) || null) : (dealsData.find(d => Number(d.id) === Number(dealId))?.contactId || selectedDealContact?.id || null);

    const payload = {
      business_id: BUSINESS_ID,
      contact_id: contactId,
      deal_id: dealId,
      followup_title: reason,
      message_prompt: notes,
      followup_date: followup_date,
      followup_time: followup_time,
      status: 'pending'
    };

    console.debug('[DEBUG] createFollowUp payload', payload);
    const { data, error } = await client.from('user_followups').insert([payload]).select().single();
    if (error) throw error;
    logStep('Follow-up created', data);
    // Sanity check: ensure business_id was written
    if (!data || data.business_id !== BUSINESS_ID) {
      console.error('❗ createFollowUp: inserted user_followups missing or wrong business_id', { expected: BUSINESS_ID, got: data?.business_id, data });
      showInAppAlert('Warning: follow-up inserted but business_id was not set correctly. Check console for details.');
    }
    await loadFollowUps();
  closeModal('add-main-modal');
  document.getElementById('add-follow-up-form')?.reset();
  showInAppAlert('Follow-up scheduled');
  } catch (err) {
  console.error('❌ createFollowUp error', err);
  showInAppAlert('Failed to create follow-up — see console.');
  }
}

// NEW: Meeting creation function
// NEW: Meeting creation function (FIXED for Supabase insert)
async function scheduleMeeting(event) {
    if (event && event.preventDefault) event.preventDefault();
    try {
        logStep('Scheduling meeting...');
        const contactIdInput = document.getElementById('new-meeting-contact-id');
        const contactId = parseInt(contactIdInput?.value || '0', 10) || null; // Use new-meeting-contact-id
        const agenda = document.getElementById('new-meeting-agenda')?.value?.trim();
        const date = document.getElementById('new-meeting-date')?.value;
        const time = document.getElementById('new-meeting-time')?.value;

  if (!contactId) { showInAppAlert('Please select or add an associated contact'); return; }
  if (!agenda || !date || !time) { showInAppAlert('Please fill all required fields'); return; }
        
        const setDate = `${date}T${time}:00`;

    // *** CORRECT PAYLOAD WITH business_id ***
    // Use the actual DB column name for meeting title ("name") instead of "agenda" which isn't in the schema
    const payload = { 
      contact_id: contactId, 
      name: agenda, 
      start_at: setDate, 
      business_id: BUSINESS_ID // <-- CRITICAL ADDITION
    };

        const { data, error } = await client.from('meetings').insert([payload]).select().single();
        if (error) throw error;
        logStep('Meeting scheduled in DB', data);
        // Sanity check: ensure business_id was written
        if (!data || data.business_id !== BUSINESS_ID) {
          console.error('❗ scheduleMeeting: inserted meeting missing or wrong business_id', { expected: BUSINESS_ID, got: data?.business_id, data });
          showInAppAlert('Warning: meeting inserted but business_id was not set correctly. Check console for details.');
        }
        
          await loadMeetings(); // Loaders should now be fixed to filter by business_id

        // Close the meeting modal and wait for the fade-out animation to finish
        // so the in-app alert can appear above other UI. closeModal() performs
        // a 200ms fade; wait slightly longer to be safe.
        try { closeModal('add-meeting-modal'); } catch (e) {}
        try { document.getElementById('confirm-meeting-modal')?.classList.add('hidden'); } catch (e) {}
        await new Promise(res => setTimeout(res, 260));

        document.getElementById('add-meeting-form')?.reset();
        // Show success alert and ensure it sits above other modals/backdrops
        showInAppAlert(`Meeting scheduled!`);
        try { const im = document.getElementById('inapp-system-modal'); if (im) im.style.zIndex = '200500'; } catch (e) {}

    } catch (err) {
  console.error('❌ scheduleMeeting error', err);
  showInAppAlert('Failed to schedule meeting — see console.');
    }
}
async function handleAIWhatsAppAssist() {
  const bodyEl = document.getElementById('whatsapp-message-body');
  if (!bodyEl) return console.warn('Missing textarea for AI assist');

  const toEl = document.getElementById('whatsapp-to');
  const subjectEl = document.getElementById('whatsapp-subject');
  // ✅ Build a rich context that will be sent to Edge AI.
  // We derive values from (in order): currentWhatsAppContext, selected* variables,
  // DOM hidden inputs (if present), or fallbacks from loaded global arrays (contacts, dealsData, meetingsData).

  // Helper to safely parse int or return null
  // Robust helpers and fallbacks for resolving IDs and objects
  const getFromCtx = (...keys) => {
    if (!currentWhatsAppContext) return undefined;
    for (const k of keys) {
      if (k in currentWhatsAppContext && currentWhatsAppContext[k] != null) return currentWhatsAppContext[k];
    }
    return undefined;
  };

  const toInt = (v) => {
    if (v == null) return null;
    // If an object with id was passed
    if (typeof v === 'object') {
      if ('id' in v) return toInt(v.id);
      return null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };

  // Try multiple sources for ids (cover different naming conventions)
  const businessId = getFromCtx('BUSINESS_ID', 'business_id', 'businessId') || BUSINESS_ID || null;

  const domContactId = document.getElementById('whatsapp-contact-id')?.value || document.getElementById('new-meeting-contact-id')?.value || null;
  const rawContactCandidate = getFromCtx('contact_id', 'contactId', 'contact', 'CONTACT_ID') || domContactId || selectedDealContact?.id || selectedContact?.id || selectedMeeting?.contactId || null;
  const contactId = toInt(rawContactCandidate);

  const domDealId = document.getElementById('whatsapp-deal-id')?.value || document.getElementById('new-follow-up-deal-id')?.value || null;
  let rawDealCandidate = getFromCtx('dealId', 'deal_id', 'deal', 'DEAL_ID') || domDealId || selectedFollowUpDeal?.id || null;
  // If we're in the follow-up flow, selectedFollowUp may carry the deal_id
  if (!rawDealCandidate && typeof selectedFollowUp === 'object' && selectedFollowUp?.deal_id) {
    rawDealCandidate = selectedFollowUp.deal_id;
  }
  if (!rawDealCandidate && contactId) {
    rawDealCandidate = (dealsData || []).find(d => Number(d.contactId) === Number(contactId))?.id || null;
  }
  const dealId = toInt(rawDealCandidate);

  // Resolve contact and deal objects from loaded arrays where possible
  // Try to resolve contact object more aggressively: by id, then selectedDealContact, selectedContact,
  // then selectedFollowUp contact info (phone/name), then by deal association.
  let contactObj = (contacts || []).find(c => Number(c.id) === Number(contactId)) || selectedDealContact || selectedContact || null;
  if (!contactObj && typeof selectedFollowUp === 'object') {
    // selectedFollowUp may provide contactPhone or contactName
    const phone = selectedFollowUp.contactPhone || selectedFollowUp.phone || null;
    const name = selectedFollowUp.contactName || selectedFollowUp.name || null;
    if (phone) contactObj = (contacts || []).find(c => (c.phone || '').replace(/\D/g,'') === (phone || '').replace(/\D/g,''));
    if (!contactObj && name) contactObj = (contacts || []).find(c => (c.name || '').toLowerCase() === (name || '').toLowerCase());
  }
  // If still unresolved, but we have a deal, infer contact from deal
  if (!contactObj && dealId) {
    const inferred = (dealsData || []).find(d => Number(d.id) === Number(dealId));
    if (inferred && inferred.contactId) contactObj = (contacts || []).find(c => Number(c.id) === Number(inferred.contactId)) || null;
  }
  const dealObj = (dealsData || []).find(d => Number(d.id) === Number(dealId)) || (contactId ? (dealsData || []).find(d => Number(d.contactId) === Number(contactId)) : null) || selectedFollowUpDeal || null;

  // Meeting context if present
  const meetingObj = (selectedMeeting && selectedMeeting.id) ? selectedMeeting : (getFromCtx('meetingId', 'meeting_id') ? (meetingsData || []).find(m=>Number(m.id)===Number(getFromCtx('meetingId','meeting_id'))) : null);

  // Debug raw candidates to help trace why values might be null
  console.debug('AI Assist raw candidates ->', { rawContactCandidate, rawDealCandidate, businessId, selectedDealContact, selectedContact, selectedMeeting, selectedFollowUp });

  // Determine the message type: prefer explicit context, otherwise infer from the open modal
  const inferTypeFromOpenModal = () => {
    if (currentWhatsAppContext?.type) return currentWhatsAppContext.type;
    try {
      // Find the first visible modal backdrop
      const modals = Array.from(document.querySelectorAll('.modal-backdrop'));
      const openModal = modals.find(m => m && !m.classList.contains('hidden'));
      const id = (openModal && openModal.id) ? openModal.id : '';
      const lower = id.toLowerCase();
      if (/follow[-_]?up|followup/.test(lower)) return 'followup';
      if (/meeting|schedule|calendar|reminder/.test(lower)) return 'meeting-reminder';
      if (/deal/.test(lower)) return 'deal';
      if (/referral/.test(lower)) return 'referral';
      if (/review/.test(lower)) return 'review';
      if (/whatsapp[-_]?compose|whatsapp[-_]?modal|compose/.test(lower)) return 'follow up';
    } catch (e) {
      // ignore
    }
    return 'follow-up';
  };

  const finalType = inferTypeFromOpenModal();
  // persist back to the shared context so subsequent actions see the resolved type
  if (!currentWhatsAppContext) window.currentWhatsAppContext = {};
  window.currentWhatsAppContext.type = finalType;

  // Build a comprehensive context object
  // If a contact object was resolved but no explicit contactId was found, use it
  const resolvedContactId = contactId || (contactObj && contactObj.id ? Number(contactObj.id) : null);
  const resolvedDealId = dealId || (dealObj && dealObj.id ? Number(dealObj.id) : null);

  const context = {
    // Business + sender info
    // Prefer the locally-stored BUSINESS_NAME (from localStorage) over any temporary modal override
    business_name: BUSINESS_NAME || currentWhatsAppContext?.businessName || "",
    sender_name: ADMIN_NAME || currentWhatsAppContext?.sender_name || "",

    // canonical ids (use resolved ids from objects if available)
    business_id: businessId,
    contact_id: resolvedContactId || null,
    deal_id: resolvedDealId || null,
    meeting_id: meetingObj?.id || null,

    // high-level type (preserve if provided)
    type: currentWhatsAppContext?.type || "follow up",

    // contact & deal friendly fields (prefer explicit objects when available)
  contact_name: currentWhatsAppContext?.contact_name || currentWhatsAppContext?.contactName || contactObj?.name || "",
  contact_phone: contactObj?.phone || currentWhatsAppContext?.contact_phone || "",

  deal_name: dealObj?.dealName || currentWhatsAppContext?.deal_name || currentWhatsAppContext?.dealName || "",
  deal_stage: dealObj?.stage || currentWhatsAppContext?.deal_stage || "",
  deal_amount: dealObj?.amount != null ? Number(dealObj.amount) : (currentWhatsAppContext?.deal_amount != null ? Number(currentWhatsAppContext.deal_amount) : null),
  

    // meeting fields if present
    meeting_agenda: meetingObj?.agenda || currentWhatsAppContext?.meeting_agenda || null,
    meeting_date: meetingObj?.setDate || currentWhatsAppContext?.meeting_date || null,

  // To/subject/draft
  to: toEl?.value || "",
  subject: subjectEl?.value || "",
  // Clearly labelled: this is the ephemeral WhatsApp draft the user types in the message box.
  whatsapp_draft: bodyEl.value || "",

  // Explicitly include contact/deal/meeting notes as separate fields so AI can distinguish
  contact_notes: contactObj?.notes || currentWhatsAppContext?.contact_notes || "",
  deal_notes: dealObj?.notes || currentWhatsAppContext?.deal_notes || "",
  // Helpful flag indicating where the notes came from (contact, deal, or the modal's notes)
  notes_source: contactObj ? 'contact' : (dealObj ? 'deal' : (currentWhatsAppContext?.notes_source || 'modal')),

    // Preserve any extra context but ensure we don't overwrite the explicit fields above
    extra: {
      ...(currentWhatsAppContext?.extra || {}),
      // include a snapshot of resolved objects for easier AI prompt building
      resolved: {
        contact: contactObj ? { id: contactObj.id, name: contactObj.name, phone: contactObj.phone, notes: contactObj.notes } : null,
        deal: dealObj ? { id: dealObj.id, name: dealObj.dealName, stage: dealObj.stage, amount: dealObj.amount, notes: dealObj.notes } : null,
        meeting: meetingObj ? { id: meetingObj.id, agenda: meetingObj.agenda, setDate: meetingObj.setDate } : null
      }
    }
  };

  // Debug log assembled context
  console.log("📤 AI Assist: assembled context:", context);

  console.log("📤 Sending request to AI:", context);
  toggleAIButtons(true);

  try {
    const res = await fetch(
      "https://xgtnbxdxbbywvzrttixf.supabase.co/functions/v1/ai-copywriter",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}` // remove later when RLS done
        },
        body: JSON.stringify({ mode: "generate", context })
      }
    );

    const data = await res.json();
    console.log("✅ AI Suggestions Received:", data);

    if (!data.suggestions || data.suggestions.length === 0) {
      console.warn("⚠️ AI returned no suggestions");
      return;
    }

    const suggestion = data.suggestions[0];

    // Save suggestions
    aiWhatsAppSuggestions.all.push({
      text: suggestion,
      timestamp: Date.now(),
      type: context.type
    });
    aiWhatsAppSuggestions.currentIndex = aiWhatsAppSuggestions.all.length - 1;

    // Apply to textbox
    bodyEl.value = suggestion;

    // Save context for "store" mode later
    window.lastAcceptedAISuggestion = {
      accepted_text: suggestion,
      accepted_at: new Date().toISOString(),
      context,
      all_suggestions: [...aiWhatsAppSuggestions.all]
    };

    console.log("✍️ Suggestion applied:", suggestion);
    console.log("AI updated the message ✔");

  } catch (err) {
    console.error("❌ AI Assist Error:", err);
  } finally {
    toggleAIButtons(false);
  }
}


function toggleAIButtons(isLoading) {
  const aiBtn = document.getElementById('ai-assist-btn');
  if (!aiBtn) return;
  aiBtn.disabled = isLoading;
  aiBtn.textContent = isLoading ? "Thinking…" : "AI";
}

function cycleAISuggestion(direction = 1) {
  if (aiWhatsAppSuggestions.all.length < 2) return;

  aiWhatsAppSuggestions.currentIndex =
    (aiWhatsAppSuggestions.currentIndex + direction + aiWhatsAppSuggestions.all.length) %
    aiWhatsAppSuggestions.all.length;

  const bodyEl = document.getElementById('whatsapp-message-body');
  bodyEl.value = aiWhatsAppSuggestions.all[aiWhatsAppSuggestions.currentIndex].text;
}

function acceptAISuggestion() {
  const selected = aiWhatsAppSuggestions.all[aiWhatsAppSuggestions.currentIndex];
  if (!selected) return;

  window.lastAcceptedAISuggestion = {
    accepted_text: selected.text,
    accepted_at: new Date().toISOString(),
    context: currentWhatsAppContext,
    all_suggestions: [...aiWhatsAppSuggestions.all]
  };

  console.log("AI text applied ✔");
}

// ✅ Store accepted AI suggestion in Supabase
if (window.lastAcceptedAISuggestion) {
  fetch("https://xgtnbxdxbbywvzrttixf.supabase.co/functions/v1/ai-copywriter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({
      mode: "store",
      ...window.lastAcceptedAISuggestion
    })
  })
  .then(res => res.json())
  .then(data => console.log("✅ Learning stored:", data))
  .catch(err => console.error("❌ Store failed:", err));
}

// NEW: Nested contact logic for meeting form
function handleMeetingNestedContact() {
    document.getElementById('meeting-contact-select-area').classList.toggle('hidden');
    document.getElementById('add-meeting-nested-contact').classList.toggle('hidden');
}

async function createAndSelectMeetingContact() {
    const name = document.getElementById('nested-meeting-contact-name')?.value?.trim();
    const phone = document.getElementById('nested-meeting-contact-phone')?.value?.trim();
  if (!name) { showInAppAlert('Please provide a name'); return; }

    const payload = { name, phone: phone || null, added_date: new Date().toISOString().slice(0,10), business_id: BUSINESS_ID };
  const { data, error } = await client.from('contacts').insert([payload]).select().single();
  if (error) { console.error('Nested contact error', error); showInAppAlert('Failed to add contact.'); return; }
    // Sanity check: ensure business_id was written for nested contact
    if (!data || data.business_id !== BUSINESS_ID) {
  console.error('❗ createAndSelectMeetingContact: inserted nested contact missing or wrong business_id', { expected: BUSINESS_ID, got: data?.business_id, data });
  showInAppAlert('Warning: contact inserted but business_id was not set correctly. Check console for details.');
    }
    
    // Select the newly created contact
    document.getElementById('new-meeting-contact-search').value = `${data.name} (${data.phone || ''})`;
    document.getElementById('new-meeting-contact-id').value = data.id;

    // Toggle back to main meeting form view
    handleMeetingNestedContact(); 
    document.getElementById('nested-meeting-contact-name').value = '';
    document.getElementById('nested-meeting-contact-phone').value = '';
  await loadContacts();
  showInAppAlert(`Contact ${data.name} created and selected.`);
}
/* ================= MEETING MODAL HANDLERS ================= */

// quick helper
const $id = (id) => document.getElementById(id);

/* ---------- STEP 1: Contact & Location ---------- */

// ensure hidden field for transport
(function ensureTransportField() {
  if (!$id('new-meeting-transport')) {
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'new-meeting-transport';
    $id('add-meeting-modal')?.appendChild(hidden);
  }
})();

// initialize big location buttons
function initMeetingLocationButtons() {
  document.querySelectorAll('.meeting-location-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.meeting-location-btn').forEach(b => {
        b.classList.remove('selected');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
      $id('new-meeting-transport').value = btn.dataset.transport;
    });
  });
}

// render selected contact card
function renderSelectedMeetingContactCard() {
  const card = $id('meeting-selected-contact-card');
  const contactId = parseInt($id('new-meeting-contact-id')?.value || '0', 10);
  if (!card) return;
  if (!contactId) {
    card.innerHTML = '<p class="text-white/60 text-sm">No contact selected.</p>';
    $id('meeting-associated-deal-text').textContent = '—';
    return;
  }
  const c = (contacts || []).find(x => Number(x.id) === Number(contactId));
  if (!c) {
    card.innerHTML = '<p class="text-white/60 text-sm">Contact not found.</p>';
    return;
  }
  card.innerHTML = `
    <div class="bg-bg-card p-3 rounded-lg border border-border-dark flex items-center space-x-3">
      <div class="w-10 h-10 rounded-full bg-main-purple flex items-center justify-center text-white font-semibold">
        ${(c.name || '?').charAt(0)}
      </div>
      <div class="flex-1">
        <div class="font-semibold text-white">${c.name}</div>
        <div class="text-sm text-white/70">${c.phone || ''}</div>
      </div>
      <button id="meeting-contact-change-btn"
              class="text-sm text-white/60 hover:text-white">Change</button>
    </div>
  `;
  const deal = (dealsData || []).find(d => Number(d.contactId) === Number(contactId));
  $id('meeting-associated-deal-text').textContent =
    deal ? (deal.dealName || 'Deal') : 'No deal found';

  $id('meeting-contact-change-btn').addEventListener('click', () => {
    $id('new-meeting-contact-id').value = '';
    $id('new-meeting-contact-search').value = '';
    renderSelectedMeetingContactCard();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initMeetingLocationButtons();
  renderSelectedMeetingContactCard();
});

// Initialize inference for WhatsApp opener buttons so we reliably capture the origin modal
function initWhatsAppOpenerInference() {
  document.addEventListener('click', (e) => {
    try {
      const btn = e.target.closest && e.target.closest('button, a');
      if (!btn) return;

      // Only act for elements that look like WhatsApp openers (id contains 'whatsapp' or class contains 'whatsapp')
      const id = (btn.id || '').toLowerCase();
      const cls = (btn.className || '').toLowerCase();
      if (!id.includes('whatsapp') && !cls.includes('whatsapp') && !btn.dataset?.action?.toLowerCase?.().includes('whatsapp')) return;

      // Find the modal this button is inside (if any)
      const modal = btn.closest('.modal-backdrop');
      const modalId = (modal && modal.id) ? modal.id.toLowerCase() : '';

      const infer = (mid) => {
        if (!mid) return 'follow up';
        if (/follow[-_]?up|followup/.test(mid)) return 'followup';
        if (/meeting|schedule|calendar|reminder/.test(mid)) return 'meeting-reminder';
        if (/deal/.test(mid)) return 'deal';
        if (/referral/.test(mid)) return 'referral';
        if (/review/.test(mid)) return 'review';
        return 'follow up';
      };

      const resolvedType = infer(modalId);
      if (!window.currentWhatsAppContext) window.currentWhatsAppContext = {};
      window.currentWhatsAppContext.type = resolvedType;
      console.debug('WhatsApp opener clicked - inferred type:', resolvedType, 'from modalId:', modalId, 'buttonId:', btn.id);
    } catch (err) {
      // swallow
    }
  }, true); // capture so this runs before handlers that close modals
}

// Start inference early
initWhatsAppOpenerInference();

/**
 * Ensure the WhatsApp modal shows a clear, read-only area for saved notes
 * and keeps the message textarea as an ephemeral draft (cleared on close).
 * @param {string} notes
 */
function updateWhatsAppNotesDisplay(notes) {
  const modal = document.getElementById('whatsapp-modal');
  if (!modal) return;

  // Try to find an existing notes display area
  let display = modal.querySelector('#whatsapp-modal-notes-display');
  if (!display) {
    // Create a small labeled, readonly textarea to show saved notes
    const wrapper = document.createElement('div');
    wrapper.id = 'whatsapp-modal-notes-display';
    wrapper.className = 'mb-4';

  const label = document.createElement('label');
  label.className = 'block text-sm font-medium text-white/70 mb-1';
  label.textContent = 'Saved Notes';

  const ta = document.createElement('textarea');
  ta.rows = 3;
  // Make editable so user can update notes directly from WhatsApp modal
  ta.readOnly = false;
  ta.className = 'w-full bg-bg-dark border border-border-dark rounded-lg p-3 text-white/60 resize-none';
  ta.id = 'whatsapp-modal-notes-textarea';

  wrapper.appendChild(label);
  wrapper.appendChild(ta);

    // Insert the notes display before the Message Body area (if present) or at top
    const messageBody = modal.querySelector('#whatsapp-message-body');
    if (messageBody && messageBody.parentElement) {
      // messageBody is inside a div; insert before that container
      const container = messageBody.closest('div') || messageBody.parentElement;
      container.parentElement.insertBefore(wrapper, container);
    } else {
      // fallback: append to modal content
      modal.querySelector(':scope > div')?.appendChild(wrapper);
    }
    display = wrapper;
  }

  // Update textarea content
  const ta = display.querySelector('#whatsapp-modal-notes-textarea');
    if (ta) {
      ta.value = notes || '';
      // Attach context so autosave knows where to persist
      try {
        if (window.currentWhatsAppContext) {
          const ctx = window.currentWhatsAppContext;
          if (ctx.contactId) ta.dataset.contactId = ctx.contactId;
          if (ctx.dealId) ta.dataset.dealId = ctx.dealId;
          if (ctx.meeting_id) ta.dataset.meetingId = ctx.meeting_id;
          if (ctx.deal_id) ta.dataset.dealId = ctx.deal_id;
          if (ctx.contact_id) ta.dataset.contactId = ctx.contact_id;
          if (ctx.followup_id) ta.dataset.followupId = ctx.followup_id;
        }
      } catch (e) {}
    }

  // Update placeholder of the message body to make difference clear
  const body = document.getElementById('whatsapp-message-body');
  if (body) body.placeholder = 'WhatsApp Draft (temporary — cleared when modal closes). Type your message here.';
}

function clearWhatsAppDraft() {
  const body = document.getElementById('whatsapp-message-body');
  if (body) body.value = '';
}

/* ---------- STEP 1 -> STEP 2 Navigation ---------- */
$id('meeting-step-1-next')?.addEventListener('click', () => {
  const contactId = $id('new-meeting-contact-id')?.value;
  const agenda = $id('new-meeting-agenda')?.value.trim();
  if (!contactId) { showInAppAlert('Please select a contact.'); return; }
  if (!agenda) { showInAppAlert('Please add an agenda.'); return; }
  $id('meeting-step-1').classList.add('hidden');
  $id('meeting-step-2').classList.remove('hidden');
  // Defer calendar rendering so the modal/step layout can settle and the
  // calendar container reports correct sizes. Using requestAnimationFrame
  // or a short timeout avoids cases where clientWidth is 0 and the
  // scroll/centering logic fails.
  if (typeof renderMeetingsCalendar === 'function') {
    requestAnimationFrame(() => setTimeout(() => {
      try { renderMeetingsCalendar(); } catch (err) { console.warn('renderMeetingsCalendar failed', err); }
    }, 40));
  }
  // Fallback: if after a short delay the calendar container is still empty, render a dedicated
  // Step-2 calendar that mirrors the main calendar rendering (handles edge cases where
  // renderMeetingsCalendar couldn't populate due to sizing or race conditions).
  setTimeout(() => {
    try {
      const step2Container = document.getElementById('add-meeting-calendar') || document.getElementById('calendar-months-scroll-container');
      if (step2Container && step2Container.children.length === 0) {
        console.warn('🟡 [Fallback] step2 calendar empty — invoking renderStep2Calendar fallback');
        if (typeof renderStep2Calendar === 'function') renderStep2Calendar();
      }
    } catch (e) { console.warn('Fallback calendar check failed', e); }
  }, 360);
});

/* ---------- STEP 2: Calendar & Slots ---------- */

// simple times generator
// Default generates 30-min slots from 09:00 up to 17:00 (last slot 16:30)
function generateTimeSlots(start = 9, end = 16, step = 30) {
  const out = [];
  for (let h = start; h <= end; h++) {
    for (let m = 0; m < 60; m += step) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      out.push(`${hh}:${mm}`);
    }
  }
  return out;
}

// render time slots for date
function renderTimeGridForDate(dateStr) {
  // Choose container depending on viewport: desktop uses #meeting-times-grid, mobile uses #meeting-times-grid-mobile
  const desktopContainer = $id('meeting-times-grid');
  const mobileContainer = $id('meeting-times-grid-mobile');
  const container = (typeof isMobile === 'function' && isMobile() && mobileContainer) ? mobileContainer : desktopContainer || mobileContainer;
  if (!container) return;
  // Clear both to avoid duplicate content when switching views
  try { if (desktopContainer) desktopContainer.innerHTML = ''; } catch (e) {}
  try { if (mobileContainer) mobileContainer.innerHTML = ''; } catch (e) {}

  // Put the human-readable date under the step title (if present)
  try {
    const d = new Date(dateStr);
    const dayNum = d.getDate();
    const suffix = getSuffix(dayNum);
    const monthShort = d.toLocaleString('en-US', { month: 'short' });
    const nice = `${dayNum}${suffix} ${monthShort}`;
    const selectedDateEl = document.getElementById('daily-selected-date');
    if (selectedDateEl) selectedDateEl.textContent = nice;
  } catch (e) { /* ignore */ }

  // Determine occupied slots from meetingsData (map or helper)
  const meetingsForDay = (typeof getMeetingsByDate === 'function') ? getMeetingsByDate(dateStr) : (window.meetingsMap && window.meetingsMap.get(dateStr.slice(0,10))) || [];

  function timeToMinutes(t) {
    const [hh, mm] = (t || '').split(':').map(x => parseInt(x, 10) || 0);
    return hh * 60 + mm;
  }

  // Precompute meeting intervals in minutes relative to day
  const meetingIntervals = (meetingsForDay || []).map(m => {
    try {
      const s = new Date(m.setDate);
      const e = m.endDate ? new Date(m.endDate) : new Date(new Date(m.setDate).getTime() + (30 * 60000));
      return { start: s.getHours() * 60 + s.getMinutes(), end: e.getHours() * 60 + e.getMinutes() };
    } catch (err) {
      return null;
    }
  }).filter(Boolean);

  // Slots: use CSS-driven horizontal grid (left-to-right flow)
  const slotsGrid = document.createElement('div');
  // Use a vertical list on mobile for better use of modal space
  if (typeof isMobile === 'function' && isMobile()) slotsGrid.className = 'time-slots-list';
  else slotsGrid.className = 'time-slots-grid';
  const slots = generateTimeSlots();
  const todayKey = new Date().toISOString().slice(0,10);
  const targetKey = dateStr.slice(0,10);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  slots.forEach(time => {
    const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'meeting-time-slot text-white/80';
  // Display with dot separator (9.00) while keeping underlying value as HH:MM
  btn.textContent = time.replace(':', '.');
    btn.dataset.time = time;

    // Decide if this slot is occupied or in the past
    const slotMinutes = timeToMinutes(time);
    let occupied = false;
    for (const iv of meetingIntervals) {
      if (slotMinutes >= iv.start && slotMinutes < iv.end) { occupied = true; break; }
    }

    // If the selected date is before today, mark all as past
    if (targetKey < todayKey) {
      btn.classList.add('past-day');
      btn.disabled = true;
    } else if (targetKey === todayKey && slotMinutes < nowMinutes) {
      // For today, disable earlier times
      btn.classList.add('past-day');
      btn.disabled = true;
    }

    if (occupied) {
      btn.classList.add('past-day');
      btn.disabled = true;
      btn.title = 'Occupied';
    }

    btn.addEventListener('click', () => {
      if (btn.disabled) return; // ignore clicks on disabled/occupied slots
      slotsGrid.querySelectorAll('.meeting-time-slot').forEach(s => s.classList.remove('selected'));
      btn.classList.add('selected');
      $id('new-meeting-date').value = dateStr;
      $id('new-meeting-time').value = time;
    });
    slotsGrid.appendChild(btn);
  });

  container.appendChild(slotsGrid);
}



// hook into calendar day click (if your calendar calls updateSchedulePanel)
(function patchUpdateSchedulePanel() {
  if (typeof updateSchedulePanel !== 'function') return;
  const original = updateSchedulePanel;
  window.updateSchedulePanel = (date) => {
    original(date);
    const ds = (date && date.slice) ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
    renderTimeGridForDate(ds);
    $id('daily-meetings-title').textContent = `Schedule for ${ds}`;
  };
})();

// populate duration dropdown
(function fillDurations() {
  const sel = $id('meeting-duration-select');
  if (!sel) return;
  ['30min', '1hr', '1.30hrs', '2hrs', '2.30hrs'].forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  });
})();

$id('meeting-back-to-step1')?.addEventListener('click', () => {
  $id('meeting-step-2').classList.add('hidden');
  $id('meeting-step-1').classList.remove('hidden');
});

/* ---------- STEP 3: Confirmation ---------- */

// hidden inputs to hold date/time
(function ensureHiddenDateTime() {
  if (!$id('new-meeting-date')) {
    const d = document.createElement('input');
    d.type = 'hidden';
    d.id = 'new-meeting-date';
    $id('add-meeting-modal').appendChild(d);
  }
  if (!$id('new-meeting-time')) {
    const t = document.createElement('input');
    t.type = 'hidden';
    t.id = 'new-meeting-time';
    $id('add-meeting-modal').appendChild(t);
  }
})();

$id('meeting-schedule-btn')?.addEventListener('click', () => {
  const cName = $id('new-meeting-contact-search').value;
  const agenda = $id('new-meeting-agenda').value;
  const transport = $id('new-meeting-transport').value;
  const date = $id('new-meeting-date').value;
  const time = $id('new-meeting-time').value;
  const duration = $id('meeting-duration-select').value;
  if (!cName || !agenda || !date || !time) {
    showInAppAlert('Please complete all details before scheduling.');
    return;
  }
  $id('confirm-meeting-summary').innerHTML = `
    <div><b>Contact:</b> ${cName}</div>
    <div><b>Agenda:</b> ${agenda}</div>
    <div><b>Location:</b> ${transport}</div>
    <div><b>Date:</b> ${date}</div>
    <div><b>Time:</b> ${time} (${duration})</div>
  `;
  $id('confirm-meeting-modal').classList.remove('hidden');
});

$id('confirm-meeting-cancel')?.addEventListener('click', () => {
  $id('confirm-meeting-modal').classList.add('hidden');
});

$id('confirm-meeting-confirm')?.addEventListener('click', async () => {
  try {
    if (typeof scheduleMeeting === 'function') await scheduleMeeting();
    $id('confirm-meeting-modal').classList.add('hidden');
    $id('add-meeting-modal').classList.add('hidden');
  } catch (err) {
    console.error(err);
  }
});

// -------------------------------------------------------------------
// UPDATES (persist inline edits & stage changes)
async function updateContact(id, updates) {
  try {
    logStep(`Updating contact ${id}`, updates);
    // Ensure RLS/permissions only allow updating contacts for this business
    const { error } = await client.from('contacts')
      .update(updates)
      .eq('id', id)
      .eq('business_id', BUSINESS_ID);
    if (error) throw error;
    logStep('✅ Contact updated');
    await loadContacts();
  } catch (err) {
    console.error('❌ updateContact error', err);
    throw err;
  }
}

async function updateDeal(id, updates) {
  try {
    logStep(`Updating deal ${id}`, updates);
    // Map UI keys to DB column names
    const dbUpdates = {};
    if ('dealName' in updates) dbUpdates.deal_name = updates.dealName;
    if ('stage' in updates) dbUpdates.stage = updates.stage;
    if ('amount' in updates) dbUpdates.amount = updates.amount;
    if ('closeDate' in updates) dbUpdates.close_date = updates.closeDate;
    if ('notes' in updates) dbUpdates.notes = updates.notes;
    // Ensure we only update rows belonging to this business (important for RLS)
    const { error } = await client
      .from('deals')
      .update(dbUpdates)
      .eq('id', id)
      .eq('business_id', BUSINESS_ID);

    if (error) throw error;
    logStep('✅ Deal updated in DB');
    // Refresh local state
    await loadDeals();
  } catch (err) {
    console.error('❌ updateDeal error', err);
    // Re-throw so callers can handle failures (UI feedback / retries)
    throw err;
  }
}

 
async function updateFollowUp(id, updates) {
  try {
    logStep(`Updating follow_up ${id}`, updates);
    // Update the `user_followups` table and ensure we only touch rows for this business
    const { error } = await client.from('user_followups')
      .update(updates)
      .eq('id', id)
      .eq('business_id', BUSINESS_ID);
    if (error) throw error;
    await loadFollowUps();
  } catch (err) {
    console.error('❌ updateFollowUp error', err);
    throw err;
  }
}

// -------------------------------------------------------------------
// EDITABLE CELL HANDLERS (UI) - call DB update functions
function handleEditClick(event, id, type, field) {
  if (event) event.stopPropagation();
  const cell = event.currentTarget.closest('.edit-cell');
  const content = cell.querySelector('.editable-content');
  // close others
  document.querySelectorAll('.editable-content[contenteditable="true"]').forEach(el => {
    if (el !== content) { el.setAttribute('contenteditable', 'false'); el.blur(); }
  });
  content.setAttribute('contenteditable', 'true');
  content.focus();
}

async function handleSaveEdit(event, id, type, field) {
  const content = event.currentTarget;
  content.setAttribute('contenteditable', 'false');
  let newValue = content.textContent.trim();

  // Normalize
  if (field === 'amount') {
    newValue = newValue.replace(/[^0-9.-]/g, '');
    newValue = newValue.includes(',') ? newValue.replace(/,/g, '') : newValue;
    newValue = parseFloat(newValue) || 0;
  }
  if (type === 'contact') {
    const updates = {};
    if (field === 'name') updates.name = newValue;
    if (field === 'phone') updates.phone = newValue;
    if (field === 'notes') updates.notes = newValue;
    await updateContact(id, updates);
  } else if (type === 'deal') {
    const updates = {};
    if (field === 'dealName') updates.dealName = newValue;
    if (field === 'amount') updates.amount = newValue;
    if (field === 'closeDate') {
      const parsed = new Date(newValue);
      if (!isNaN(parsed)) updates.closeDate = parsed.toISOString().slice(0,10);
      else updates.closeDate = null;
    }
    if (field === 'notes') updates.notes = newValue;
    await updateDeal(id, updates);
  }
}

// -------------------------------------------------------------------
// CONTACTS RENDERER (keeps original styling/structure)
function renderContacts(limit = currentPageView) {
  const listContainer = document.getElementById('contacts-list-container');
  const contactCountSpan = document.getElementById('contact-count');
  if (!listContainer) return console.warn('contacts list container not found');
  listContainer.innerHTML = '';
  if (contactCountSpan) contactCountSpan.textContent = contacts.length;

  // Ensure contacts are shown with most-recently-added first. Use `added_date` or `created_at`.
  const toRender = contacts
    .slice()
    .sort((a, b) => new Date(b.added_date || b.created_at || 0) - new Date(a.added_date || a.created_at || 0))
    .slice(0, limit);
  toRender.forEach(contact => {
    const row = document.createElement('div');
    row.className = `contact-row text-sm`;
    row.setAttribute('data-id', contact.id);

    row.innerHTML = `
      <input type="checkbox" class="w-4 h-4 mr-2">
      <div class="edit-cell font-medium">
        <span class="editable-content" contenteditable="false" data-field="name" data-id="${contact.id}">${contact.name}</span>
        <i class="fa-solid fa-pen-to-square text-white/50 hover:text-white edit-icon cursor-pointer" data-id="${contact.id}" data-field="name" data-type="contact"></i>
      </div>
      <div class="edit-cell text-white/70">
        <span class="editable-content" contenteditable="false" data-field="phone" data-id="${contact.id}">${contact.phone || ''}</span>
        <i class="fa-solid fa-pen-to-square text-white/50 hover:text-white edit-icon cursor-pointer" data-id="${contact.id}" data-field="phone" data-type="contact"></i>
      </div>
      <div class="edit-cell text-white/70">
        <span class="editable-content text-xs" contenteditable="false" data-field="notes" data-id="${contact.id}">${contact.notes || 'No notes.'}</span>
        <i class="fa-solid fa-pen-to-square text-white/50 hover:text-white edit-icon cursor-pointer" data-id="${contact.id}" data-field="notes" data-type="contact"></i>
      </div>
      <div class="flex justify-center items-center">
        <button class="text-white/60 hover:text-blue-500 contact-actions-btn" title="More Actions" data-contact-id="${contact.id}">
          <i class="fa-solid fa-ellipsis-v"></i>
        </button>
      </div>
    `;
    listContainer.appendChild(row);
  });

  // Attach listeners
  listContainer.querySelectorAll('.edit-icon').forEach(icon => {
    icon.addEventListener('click', e => {
      const id = parseInt(e.currentTarget.dataset.id, 10);
      const field = e.currentTarget.dataset.field;
      handleEditClick(e, id, 'contact', field);
      // focus the contenteditable element
      const content = e.currentTarget.closest('.edit-cell').querySelector('.editable-content');
      content && content.setAttribute('contenteditable', 'true');
      content && content.focus();
    });
  });
  // Blur -> save
  listContainer.querySelectorAll('.editable-content').forEach(el => {
    el.addEventListener('blur', (e) => {
      const id = parseInt(e.target.dataset.id, 10);
      const field = e.target.dataset.field;
      handleSaveEdit(e, id, 'contact', field);
    });
    // Also debounce-save while typing for notes fields
    if (el.dataset && el.dataset.field === 'notes') {
      el.addEventListener('input', (ev) => {
        const target = ev.target;
        // treat contenteditable as textarea value
        const val = target.textContent || '';
        const existing = _autoSaveTimers.get(target);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          // set dataset.contactId if missing (try to infer from id)
          if (!target.dataset.contactId && target.dataset.id) target.dataset.contactId = target.dataset.id;
          persistNotesForElement(target, val);
        }, 900);
        _autoSaveTimers.set(target, t);
      });
    }
  });

  document.getElementById('selected-contact-count') && (document.getElementById('selected-contact-count').textContent = 0);

  // Render mobile cards
  renderMobileContacts(limit);
  // Attach actions handlers for the desktop three-dots buttons
  attachContactActionsHandlers();
}

// -------------------------------------------------------------------
// CONTACT ACTIONS MENU (three-dots menu for desktop contacts)
// Creates a small contextual menu with actions like Delete
function ensureContactActionsMenu() {
  let menu = document.getElementById('contact-actions-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'contact-actions-menu';
  menu.style.position = 'absolute';
  menu.style.zIndex = 2000;
  menu.style.minWidth = '120px';
  menu.style.background = '#0b1220';
  menu.style.border = '1px solid rgba(255,255,255,0.06)';
  menu.style.borderRadius = '8px';
  menu.style.padding = '6px 0';
  menu.style.boxShadow = '0 6px 18px rgba(3,8,23,0.6)';
  menu.className = 'text-sm text-white';
  menu.innerHTML = `
    <button id="contact-action-delete" class="w-full text-left px-4 py-2 hover:bg-white/5" style="background: transparent; border: none; color: inherit;">Delete</button>
  `;
  document.body.appendChild(menu);

  // Click outside to close
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!menu.contains(target) && !target.closest('.contact-actions-btn')) {
      menu.style.display = 'none';
      menu.dataset.contactId = '';
    }
  });

  return menu;
}

function showContactMenuForButton(btn) {
  const contactId = btn.dataset.contactId;
  const rect = btn.getBoundingClientRect();
  const menu = ensureContactActionsMenu();
  menu.style.display = 'block';
  // Position below the button (desktop)
  const left = Math.min(window.innerWidth - 140, rect.left);
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  menu.dataset.contactId = contactId;

  // attach handler for Delete button (one-time safe attach)
const delBtn = document.getElementById('contact-action-delete');

delBtn.onclick = async (e) => {
  e.stopPropagation();
  const cId = parseInt(menu.dataset.contactId, 10);
  if (!cId) return;

  if (!confirm('Delete this contact? This action cannot be undone.')) return;

  try {
    delBtn.disabled = true;

    // Delete contact — include business_id to satisfy RLS policies (same structure as deals/meetings)
    const { error } = await client
      .from('contacts')
      .delete()
      .eq('id', cId)
      .eq('business_id', BUSINESS_ID);

    if (error) throw error;

  // Refresh local state from backend to ensure UI matches DB
  await loadContacts();
  menu.style.display = 'none';
  menu.dataset.contactId = '';

  } catch (err) {
    console.error('❌ Failed to delete contact', err);
    alert('Failed to delete contact. Check console.');
  } finally {
    delBtn.disabled = false;
  }
};
}
// Attach click handlers to the actions buttons (safe re-attach)
function attachContactActionsHandlers() {
  const listContainer = document.getElementById('contacts-list-container');
  if (!listContainer) return;
  listContainer.querySelectorAll('.contact-actions-btn').forEach(btn => {
    // avoid double-binding
    if (btn.dataset.listenerAttached) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContactMenuForButton(e.currentTarget);
    });
    btn.dataset.listenerAttached = 'true';
  });
}

// Ensure handlers are attached after render
setTimeout(() => attachContactActionsHandlers(), 50);

// -------------------------------------------------------------------
// MOBILE CONTACTS CARDS RENDERER
function renderMobileContacts(limit = currentPageView) {
  const container = document.getElementById('contacts-mobile-view');
  if (!container) return console.warn('contacts mobile view container not found');
  container.innerHTML = '';

  // Render contact cards with swipe-delete support (mobile)
  // Keep newest contacts at the top on mobile as well
  const toRender = contacts
    .slice()
    .sort((a, b) => new Date(b.added_date || b.created_at || 0) - new Date(a.added_date || a.created_at || 0))
    .slice(0, limit);
  toRender.forEach(contact => {
    const outer = document.createElement('div');
    outer.className = 'relative overflow-visible mb-3';
    outer.setAttribute('data-contact-id', contact.id);

    outer.innerHTML = `
      <button class="contact-delete-btn absolute right-3 top-1/2 -translate-y-1/2 bg-red-600 hover:bg-red-700 text-white p-2 rounded-md z-10" data-contact-id="${contact.id}" aria-label="Delete Contact"
              style="opacity:0; pointer-events:none; transform:translateX(6px); transition:opacity .18s ease, transform .18s ease;">
        <i class="fa-solid fa-trash"></i>
      </button>

      <div class="contact-card-slide bg-bg-card rounded-xl border border-border-dark p-4 transition-transform duration-150 relative z-20 flex items-center justify-between" style="min-height:3.5rem;">
        <div class="flex-1">
          <h3 class="font-bold text-lg text-white">${contact.name}</h3>
          <p class="text-white/70 text-sm"><i class="fa-solid fa-phone mr-2"></i>${contact.phone || 'N/A'}</p>
        </div>
        <button class="bg-gray-500 hover:bg-gray-600 text-white text-sm font-semibold py-1 px-3 rounded-lg transition-colors flex-shrink-0 contact-details-btn" data-contact-id="${contact.id}">
          Details
        </button>
      </div>
    `;

    container.appendChild(outer);
  });

  // Attach listeners to details buttons (respect revealed state)
  container.querySelectorAll('.contact-details-btn').forEach(btn => {
    if (btn.dataset.listenerAttached) return;
    btn.addEventListener('click', (e) => {
      const outer = e.currentTarget.closest('[data-contact-id]');
      if (outer && outer.dataset.revealed === 'true') {
        // If revealed, tapping details should close reveal instead of opening details
        const slide = outer.querySelector('.contact-card-slide');
        const del = outer.querySelector('.contact-delete-btn');
        if (slide) { slide.style.transition = 'transform .18s ease'; slide.style.transform = 'translateX(0px)'; }
        outer.dataset.revealed = 'false';
        if (del) { del.style.opacity = '0'; del.style.pointerEvents = 'none'; }
        return;
      }
      const id = parseInt(e.currentTarget.dataset.contactId, 10);
      openContactDetailsModal(id);
    });
    btn.dataset.listenerAttached = 'true';
  });

  // Attach swipe handlers for mobile contacts
  try { attachMobileContactSwipeHandlers(); } catch (e) { console.warn('attachMobileContactSwipeHandlers failed', e); }
}

// -------------------------------------------------------------------
// CONTACT DETAILS MODAL HANDLER
function openContactDetailsModal(id) {
  const contact = contacts.find(c => c.id === id);
  if (!contact) return console.warn('Contact not found', id);

  document.getElementById('contact-details-title').textContent = `Contact Details - ${contact.name}`;
  document.getElementById('contact-details-name').textContent = contact.name;
  document.getElementById('contact-details-phone').textContent = contact.phone || 'N/A';
  const cdNotes = document.getElementById('contact-details-notes');
  if (cdNotes) {
    cdNotes.value = contact.notes || '';
    cdNotes.dataset.contactId = contact.id;
  }

  // Delete button removed as per user request

  // Clear contact-action context and wire contact-level action buttons
  selectedContactAction = null;
  try {
    const callBtn = document.getElementById('contact-call-btn');
    const waBtn = document.getElementById('contact-whatsapp-btn');

    if (callBtn) {
      callBtn.removeEventListener('click', callBtn._listener || (() => {}));
      const cb = () => {
        selectedContactAction = { id: contact.id, contactId: contact.id, contactPhone: contact.phone || '', contactName: contact.name || '' };
        const callContactText = `${contact.name} (${contact.phone || ''})`;
        document.getElementById('call-log-contact') && (document.getElementById('call-log-contact').textContent = `Logging call for: ${callContactText}`);
        closeModal('contact-details-modal');
        openModal('call-log-modal');
      };
      callBtn.addEventListener('click', cb);
      callBtn._listener = cb;
    }

    if (waBtn) {
      waBtn.removeEventListener('click', waBtn._listener || (() => {}));
      const wb = () => {
        selectedContactAction = { id: contact.id, contactId: contact.id, contactPhone: contact.phone || '', contactName: contact.name || '' };
        window.currentWhatsAppContext = {
          type: 'contact',
          business_id: BUSINESS_ID || null,
          contact_id: contact.id || null,
          contact_name: contact.name || ''
        };
        const waTo = document.getElementById('whatsapp-to');
        const waMsg = document.getElementById('whatsapp-message-body');
        if (waTo) waTo.value = contact.phone || '';
        if (waMsg) waMsg.value = '';
        updateWhatsAppNotesDisplay(document.getElementById('contact-details-notes')?.value || '');
        closeModal('contact-details-modal');
        openModal('whatsapp-modal');
      };
      waBtn.addEventListener('click', wb);
      waBtn._listener = wb;
    }
  } catch (e) { console.warn('Failed to wire contact action buttons', e); }

  openModal('contact-details-modal');
}
// --- NEW MOBILE HELPER AND RENDERING LOGIC ---

// Helper to determine if the device is mobile (matches Tailwind's 'md' breakpoint)
function isMobile() {
    return window.innerWidth < 768; 
}

// Function to handle deal stage change (copied from crmmobile.js)
async function handleDealStageChange(e) {
  const selectEl = e.currentTarget;
  const dId = parseInt(selectEl.dataset.dealId, 10);
  const newStage = selectEl.value;
  // Provide immediate UI feedback by disabling the control while updating
  try {
    selectEl.disabled = true;
    await updateDeal(dId, {
      stage: newStage,
      // set closeDate when moving to hidden stages
      closeDate: (HIDDEN_STAGES.includes(newStage) ? new Date().toISOString().slice(0,10) : null)
    });
    logStep('Stage change persisted', `${dId} -> ${newStage}`);
  } catch (err) {
  console.error('❌ handleDealStageChange error', err);
  showInAppAlert('Failed to update deal stage — changes were not saved. See console for details.');
    // Optionally revert select to previous value by reloading deals
    await loadDeals();
  } finally {
    selectEl.disabled = false;
  }
}

// Function to generate the mobile deal card HTML
// Function to generate the mobile deal card HTML with new layout
function renderDealCardHtml(deal) {
    const closeColor = getCloseDateColor(deal.closeDate); // Existing helper in crm.js
    const formattedAmount = formatKES(deal.amount);       // Existing helper in crm.js
    
    // Determine the color class for the date dot (use a golden color class or fallback)
    // We will use 'bg-yellow-500' for the dot to make it stand out.
    const dotColor = closeColor.replace('text-xs font-medium px-2 py-0.5 rounded-full', 'w-2 h-2 rounded-full'); 

    // Use the onchange handler directly for stage updates
    return `
  <div id="deal-card-${deal.id}" data-deal-id="${deal.id}" class="bg-bg-card p-4 rounded-xl border border-border-dark shadow-lg active:ring-2 active:ring-main-purple/50" onclick="handleFollowUpClick(${deal.id}, 'deal', event)">
            
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="text-lg font-semibold text-white">${deal.dealName}</h3>
                    <p class="text-sm text-white/70 mt-1 mb-3">${deal.contactName} (${deal.contactPhone})</p>
                </div>

                <div class="text-2xl font-bold text-yellow-500 whitespace-nowrap">
                    ${formattedAmount}
                </div>
            </div>
            
            <div class="flex justify-between items-end border-t border-border-dark pt-3">
                
                <div class="flex items-center space-x-2">
                    <div class="${dotColor} bg-yellow-500"></div> 
                    <span class="text-sm text-white/70">Closes: ${formatDate(deal.closeDate)}</span>
                </div>

                <div>
                    <select data-deal-id="${deal.id}" onchange="handleDealStageChange(event)" class="text-sm p-1 rounded-md bg-bg-dark border border-border-dark text-white focus:ring-main-purple focus:border-main-purple">
                        ${ALL_STAGES.map(stage => 
                            `<option value="${stage}" ${deal.stage === stage ? 'selected' : ''}>${stage}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
        </div>
    `;
}
    // -------------------------------------------------------------------
// NEW MOBILE HELPER AND RENDERING LOGIC (INSERT THIS BLOCK)
// -------------------------------------------------------------------

// Helper to determine if the device is mobile (matches Tailwind's 'md' breakpoint: 768px)
function isMobile() {
    return window.innerWidth < 768; 
}

// Function to handle deal stage change (copied from crmmobile.js)
async function handleDealStageChange(e) {
  const selectEl = e.currentTarget;
  const dId = parseInt(selectEl.dataset.dealId, 10);
  const newStage = selectEl.value;
  // Provide immediate UI feedback by disabling the control while updating
  try {
    selectEl.disabled = true;
    await updateDeal(dId, {
      stage: newStage,
      // set closeDate when moving to hidden stages
      closeDate: (HIDDEN_STAGES.includes(newStage) ? new Date().toISOString().slice(0,10) : null)
    });
    logStep('Stage change persisted', `${dId} -> ${newStage}`);
  } catch (err) {
  console.error('❌ handleDealStageChange error', err);
  showInAppAlert('Failed to update deal stage — changes were not saved. See console for details.');
    // Optionally revert select to previous value by reloading deals
    await loadDeals();
  } finally {
    selectEl.disabled = false;
  }
}

// Function to generate the mobile deal card HTML
function renderDealCardHtml(deal) {
    const closeColor = getCloseDateColor(deal.closeDate); // Existing helper in crm.js
    const formattedAmount = formatKES(deal.amount);       // Existing helper in crm.js
    
    // Use the onchange handler directly for stage updates
    return `
        <div id="deal-card-${deal.id}" data-deal-id="${deal.id}" class="bg-bg-card p-4 rounded-xl border border-border-dark shadow-lg active:ring-2 active:ring-main-purple/50">
            <div class="flex justify-between items-start">
                <h3 class="text-lg font-semibold text-white">${deal.dealName}</h3>
                <div class="text-xs font-medium px-2 py-0.5 rounded-full ${closeColor} whitespace-nowrap">${formatDate(deal.closeDate)}</div>
            </div>
            <p class="text-sm text-white/70 mt-1 mb-3">${deal.contactName} (${deal.contactPhone})</p>
            <div class="flex justify-between items-end border-t border-border-dark pt-3">
                <div class="text-sm">
                    <span class="font-bold text-lg text-main-purple">${formattedAmount}</span>
                </div>
                <div>
                    <select data-deal-id="${deal.id}" onchange="handleDealStageChange(event)" class="text-sm p-1 rounded-md bg-bg-dark border border-border-dark text-white focus:ring-main-purple focus:border-main-purple">
                        ${ALL_STAGES.map(stage => 
                            `<option value="${stage}" ${deal.stage === stage ? 'selected' : ''}>${stage}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
        </div>
    `;
}

// Main function to render the mobile-only card view
// Main function to render the mobile-only card view with sorting
function renderDealsMobileCardView() {
    logStep('Rendering deals in mobile card view (sorted by Close Date)');
    const container = document.getElementById('mobile-deals-card-container');
    if (!container) return;

    // Filter to show only active pipeline stages for the mobile card view
    let activeDeals = dealsData.filter(d => PIPELINE_STAGES.includes(d.stage));
    
    // NEW: Sort the deals by closeDate (Soonest date first)
    activeDeals.sort((a, b) => {
        const dateA = new Date(a.closeDate);
        const dateB = new Date(b.closeDate);
        return dateA - dateB; // Ascending sort (earlier dates first)
    });
    
  container.innerHTML = activeDeals.map(deal => renderDealCardHtml(deal)).join('');

  // Attach click handlers to each rendered mobile deal card to reliably open the follow-up modal.
  // Ignore clicks on inner controls like selects or buttons so those still work.
  try {
    const cards = Array.from(container.children).filter(c => c && (c.getAttribute && c.getAttribute('data-deal-id')));
    cards.forEach(card => {
      card.addEventListener('click', function(e) {
        // If user clicked a control inside the card (select, option, button), do nothing here
        if (e.target.closest('select') || e.target.closest('button') || e.target.dataset && e.target.dataset.action) return;
        const idAttr = this.dataset.dealid || this.dataset.dealId || this.getAttribute('data-deal-id');
        const id = parseInt(idAttr, 10);
        if (!isNaN(id)) {
          handleFollowUpClick(id, 'deal', e);
        }
      });
    });
  } catch (err) {
    console.warn('Failed to attach mobile deal card listeners', err);
  }

  if (activeDeals.length === 0) {
    container.innerHTML = '<p class="text-white/50 text-center py-8">No active deals found.</p>';
  }
}
// -------------------------------------------------------------------
    
    // Function to generate the mobile deal card HTML with the final requested layout
function renderDealCardHtml(deal) {
    const closeColor = getCloseDateColor(deal.closeDate); // Existing helper in crm.js
    const formattedAmount = formatKES(deal.amount);       // Existing helper in crm.js
    
    // Determine the color class for the date dot (use a small dot class based on closeColor)
    // We will use 'bg-yellow-500' if a specific closeColor is not easily translated to a background.
    // Assuming getCloseDateColor returns classes like 'text-red-500', we'll try to convert it.
    // If not, we fall back to a generic dot color:
    let dotColor = 'bg-gray-400'; 
    if (closeColor.includes('red')) dotColor = 'bg-red-500';
    else if (closeColor.includes('yellow')) dotColor = 'bg-yellow-500';
    else if (closeColor.includes('green')) dotColor = 'bg-green-500';

  // Use the onchange handler directly for stage updates
  // Structure: outer card (relative) -> inner content (.deal-card-inner) which will be translated on swipe
  return `
    <div id="deal-card-${deal.id}" data-deal-id="${deal.id}" class="relative overflow-visible">
      <!-- Delete button sits behind the sliding card and is revealed as the slide moves left -->
      <button class="deal-delete-btn absolute right-3 top-1/2 -translate-y-1/2 bg-red-600 hover:bg-red-700 text-white p-2 rounded-md z-10" data-deal-id="${deal.id}" aria-label="Delete Deal"
              style="opacity:0; pointer-events:none; transform:translateX(6px); transition:opacity .18s ease, transform .18s ease;">
        <i class="fa-solid fa-trash"></i>
      </button>

      <div class="deal-card-slide bg-bg-card rounded-xl border border-border-dark shadow-lg overflow-hidden p-4 transition-transform duration-150 relative z-20">
        <div class="flex justify-between items-start">
          <div>
            <h3 class="text-lg font-semibold text-white">${deal.dealName}</h3>
          </div>

          <div class="text-2xl font-bold text-yellow-500 whitespace-nowrap">
            ${formattedAmount}
          </div>
        </div>

        <p class="text-sm text-white/70 mt-1 mb-3">${deal.contactName} (${deal.contactPhone})</p>
                
        <div class="flex justify-between items-end border-t border-border-dark pt-3">
          <div class="flex items-center space-x-2">
            ${deal.stage === 'Closed Won' ? '<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-green-600 text-white">Won!</span>' : '<div class="w-2 h-2 rounded-full ' + dotColor + '"></div><span class="text-xs text-white/70">Closes: ' + formatDate(deal.closeDate) + '</span>'}
          </div>

          <div>
            <select data-deal-id="${deal.id}" onchange="handleDealStageChange(event)" class="text-sm p-1 rounded-md bg-bg-dark border border-border-dark text-white focus:ring-main-purple focus:border-main-purple">
              ${ALL_STAGES.map(stage => 
                `<option value="${stage}" ${deal.stage === stage ? 'selected' : ''}>${stage}</option>`
              ).join('')}
            </select>
          </div>
        </div>
      </div>
    </div>
  `;
}
// Attach mobile swipe handlers and delete wiring to deal cards
function attachMobileDealSwipeHandlers() {
  if (!isMobile()) return; // only apply on mobile
  const container = document.getElementById('mobile-deals-card-container');
  if (!container) return;

  const REVEAL_PX = 72; // how much to reveal the delete button
  const THRESHOLD = 40; // gesture threshold to lock reveal

  const cards = Array.from(container.children).filter(c => c && (c.getAttribute && c.getAttribute('data-deal-id')));
  cards.forEach(card => {
    const slideEl = card.querySelector('.deal-card-slide');
    const deleteBtn = card.querySelector('.deal-delete-btn');
    if (!slideEl || !deleteBtn) return;

    let startX = 0, startY = 0, dx = 0, swiping = false;

    function reset() {
      slideEl.style.transition = 'transform .2s ease';
      slideEl.style.transform = 'translateX(0px)';
      card.dataset.revealed = 'false';
      // hide delete btn
      deleteBtn.style.opacity = '0';
      deleteBtn.style.pointerEvents = 'none';
      swiping = false;
    }

    function reveal() {
      slideEl.style.transition = 'transform .18s ease';
      slideEl.style.transform = `translateX(-${REVEAL_PX}px)`;
      card.dataset.revealed = 'true';
      // show delete btn
      deleteBtn.style.opacity = '1';
      deleteBtn.style.pointerEvents = 'auto';
      swiping = false;
    }

    card.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      swiping = false;
      slideEl.style.transition = '';
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!e.touches || !e.touches[0]) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      dx = x - startX;
      // detect horizontal swipe intent
      if (!swiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
        swiping = true;
      }
      if (!swiping) return;
      // prevent vertical scroll when swiping horizontally
      e.preventDefault();
      // only allow left swipe (negative dx)
      const translate = Math.max(Math.min(dx, 0), -REVEAL_PX);
      slideEl.style.transform = `translateX(${translate}px)`;
      // progressively reveal deleteBtn during swipe
      try {
        const frac = Math.min(1, Math.abs(translate) / REVEAL_PX);
        deleteBtn.style.opacity = String(frac);
        if (frac > 0.6) deleteBtn.style.pointerEvents = 'auto'; else deleteBtn.style.pointerEvents = 'none';
      } catch (e) { /* ignore UI calc errors */ }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      if (!swiping) return;
      if (dx <= -THRESHOLD) reveal();
      else reset();
    });

    // Click on delete button
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(deleteBtn.dataset.dealId || deleteBtn.getAttribute('data-deal-id'), 10);
      if (isNaN(id)) return;
      // Animate removal then call backend
      const el = card;
      try {
        // slide away animation
        el.style.transition = 'transform .25s ease, opacity .25s ease, height .25s ease, margin .25s ease, padding .25s ease';
        el.style.transform = 'translateX(-120%)';
        el.style.opacity = '0';
        // collapse height after a short delay
        setTimeout(() => {
          el.style.height = '0px';
          el.style.margin = '0px';
          el.style.padding = '0px';
        }, 220);

        // call backend delete
        await deleteDeal(id);

        // finally remove element from DOM
        setTimeout(() => {
          el.remove();
          // refresh list to ensure order/counts update
          try { renderDealsMobileCardView(); } catch (err) { loadDeals(); }
        }, 360);
        } catch (err) {
        console.error('❌ delete failed', err);
        // revert
        reset();
        showInAppAlert('Failed to delete deal — see console.');
      }
    });

    // If user taps the card while revealed, close it instead of opening the follow-up
    card.addEventListener('click', (e) => {
      if (card.dataset.revealed === 'true') {
        e.stopPropagation();
        reset();
        return;
      }
    });
  });

  // Close any revealed card when user clicks elsewhere (attach once)
  try {
    if (!container.dataset.swipeDocHandlerAttached) {
      const docHandler = (e) => {
        // If click is inside a deal card or on a delete button, ignore
        if (e.target.closest && e.target.closest('[data-deal-id]')) return;
        const openCards = Array.from(container.children).filter(c => c && c.dataset && c.dataset.revealed === 'true');
        openCards.forEach(c => {
          const slide = c.querySelector('.deal-card-slide');
          const del = c.querySelector('.deal-delete-btn');
          if (slide) { slide.style.transition = 'transform .18s ease'; slide.style.transform = 'translateX(0px)'; }
          c.dataset.revealed = 'false';
          if (del) { del.style.opacity = '0'; del.style.pointerEvents = 'none'; }
        });
      };
      document.addEventListener('click', docHandler);
      container.dataset.swipeDocHandlerAttached = 'true';
    }
  } catch (err) { /* ignore */ }
}

// Expose contact swipe handler to window for robustness
try { window.attachMobileContactSwipeHandlers = attachMobileContactSwipeHandlers; } catch (e) { /* ignore */ }

// Deletes a deal row from the backend and reloads deals
async function deleteDeal(id) {
  try {
    const { error } = await client.from('deals').delete().eq('id', id).eq('business_id', BUSINESS_ID);
    if (error) throw error;
    logStep('Deal deleted', id);
    // reload local state
    await loadDeals();
  } catch (err) {
    console.error('❌ deleteDeal error', err);
    throw err;
  }
}

// Attach mobile swipe handlers and delete wiring to contact cards
function attachMobileContactSwipeHandlers() {
  if (!isMobile()) return; // only apply on mobile
  const container = document.getElementById('contacts-mobile-view');
  if (!container) return;

  const REVEAL_PX = 72; // how much to reveal the delete button
  const THRESHOLD = 40; // gesture threshold to lock reveal

  const cards = Array.from(container.children).filter(c => c && (c.getAttribute && c.getAttribute('data-contact-id')));
  cards.forEach(card => {
    const slideEl = card.querySelector('.contact-card-slide');
    const deleteBtn = card.querySelector('.contact-delete-btn');
    if (!slideEl || !deleteBtn) return;

    let startX = 0, startY = 0, dx = 0, swiping = false;

    function reset() {
      slideEl.style.transition = 'transform .2s ease';
      slideEl.style.transform = 'translateX(0px)';
      card.dataset.revealed = 'false';
      // hide delete btn
      deleteBtn.style.opacity = '0';
      deleteBtn.style.pointerEvents = 'none';
      swiping = false;
    }

    function reveal() {
      slideEl.style.transition = 'transform .18s ease';
      slideEl.style.transform = `translateX(-${REVEAL_PX}px)`;
      card.dataset.revealed = 'true';
      // show delete btn
      deleteBtn.style.opacity = '1';
      deleteBtn.style.pointerEvents = 'auto';
      swiping = false;
    }

    card.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      swiping = false;
      slideEl.style.transition = '';
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!e.touches || !e.touches[0]) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      dx = x - startX;
      // detect horizontal swipe intent
      if (!swiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
        swiping = true;
      }
      if (!swiping) return;
      // prevent vertical scroll when swiping horizontally
      e.preventDefault();
      // only allow left swipe (negative dx)
      const translate = Math.max(Math.min(dx, 0), -REVEAL_PX);
      slideEl.style.transform = `translateX(${translate}px)`;
      // progressively reveal deleteBtn during swipe
      try {
        const frac = Math.min(1, Math.abs(translate) / REVEAL_PX);
        deleteBtn.style.opacity = String(frac);
        if (frac > 0.6) deleteBtn.style.pointerEvents = 'auto'; else deleteBtn.style.pointerEvents = 'none';
      } catch (e) { /* ignore UI calc errors */ }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      if (!swiping) return;
      if (dx <= -THRESHOLD) reveal();
      else reset();
    });

    // Click on delete button
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(deleteBtn.dataset.contactId || deleteBtn.getAttribute('data-contact-id'), 10);
      if (isNaN(id)) return;
      // Animate removal then call backend
      const el = card;
      try {
        // slide away animation
        el.style.transition = 'transform .25s ease, opacity .25s ease, height .25s ease, margin .25s ease, padding .25s ease';
        el.style.transform = 'translateX(-120%)';
        el.style.opacity = '0';
        // collapse height after a short delay
        setTimeout(() => {
          el.style.height = '0px';
          el.style.margin = '0px';
          el.style.padding = '0px';
        }, 220);

        // call backend delete
        await deleteContact(id);

        // finally remove element from DOM
        setTimeout(() => {
          el.remove();
          // refresh list to ensure order/counts update
          try { renderContacts(currentPageView); } catch (err) { loadContacts(); }
        }, 360);
        } catch (err) {
        console.error('❌ delete failed', err);
        // revert
        reset();
        showInAppAlert('Failed to delete contact — see console.');
      }
    });

    // If user taps the card while revealed, close it instead of opening details
    card.addEventListener('click', (e) => {
      if (card.dataset.revealed === 'true') {
        e.stopPropagation();
        reset();
        return;
      }
    });
  });

  // Close any revealed card when user clicks elsewhere (attach once)
  try {
    if (!container.dataset.swipeDocHandlerAttached) {
      const docHandler = (e) => {
        // If click is inside a contact card or on a delete button, ignore
        if (e.target.closest && e.target.closest('[data-contact-id]')) return;
        const openCards = Array.from(container.children).filter(c => c && c.dataset && c.dataset.revealed === 'true');
        openCards.forEach(c => {
          const slide = c.querySelector('.contact-card-slide');
          const del = c.querySelector('.contact-delete-btn');
          if (slide) { slide.style.transition = 'transform .18s ease'; slide.style.transform = 'translateX(0px)'; }
          c.dataset.revealed = 'false';
          if (del) { del.style.opacity = '0'; del.style.pointerEvents = 'none'; }
        });
      };
      document.addEventListener('click', docHandler);
      container.dataset.swipeDocHandlerAttached = 'true';
    }
  } catch (err) { /* ignore */ }
}

// Deletes a contact row from the backend and reloads contacts
async function deleteContact(id) {
  try {
    const { error } = await client.from('contacts').delete().eq('id', id).eq('business_id', BUSINESS_ID);
    if (error) throw error;
    logStep('Contact deleted', id);
    // reload local state
    await loadContacts();
  } catch (err) {
    console.error('❌ deleteContact error', err);
    throw err;
  }
}
// Main function to render the mobile-only card view
function renderDealsMobileCardView() {
    logStep('Rendering deals in mobile card view');
    const container = document.getElementById('mobile-deals-card-container');
    if (!container) return;

    // Filter to show only active pipeline stages for the mobile card view
    const activeDeals = dealsData.filter(d => PIPELINE_STAGES.includes(d.stage));
    
  container.innerHTML = activeDeals.map(deal => renderDealCardHtml(deal)).join('');

  // Attach click handlers to each rendered mobile deal card to reliably open the follow-up modal.
  try {
    const cards = Array.from(container.children).filter(c => c && (c.getAttribute && c.getAttribute('data-deal-id')));
    cards.forEach(card => {
      card.addEventListener('click', function(e) {
        // If card is revealed (delete shown), close reveal on tap instead of opening follow-up
        if (this.dataset.revealed === 'true') {
          e.stopPropagation();
          const slide = this.querySelector('.deal-card-slide');
          const del = this.querySelector('.deal-delete-btn');
          if (slide) { slide.style.transition = 'transform .18s ease'; slide.style.transform = 'translateX(0px)'; }
          this.dataset.revealed = 'false';
          if (del) { del.style.opacity = '0'; del.style.pointerEvents = 'none'; }
          return;
        }
        if (e.target.closest('select') || e.target.closest('button') || e.target.dataset && e.target.dataset.action) return;
        const idAttr = this.dataset.dealid || this.dataset.dealId || this.getAttribute('data-deal-id');
        const id = parseInt(idAttr, 10);
        if (!isNaN(id)) {
          handleFollowUpClick(id, 'deal', e);
        }
      });
    });
  } catch (err) {
    console.warn('Failed to attach mobile deal card listeners', err);
  }

  // Attach swipe/delete handlers for mobile
  try { attachMobileDealSwipeHandlers(); } catch (e) { console.warn('attachMobileDealSwipeHandlers failed', e); }

  if (activeDeals.length === 0) {
    container.innerHTML = '<p class="text-white/50 text-center py-8">No active deals found.</p>';
  }
}
// --- END NEW MOBILE RENDERING LOGIC ---
// -------------------------------------------------------------------
// DEALS: pipeline and list renderers (restores original UX)
function renderDealsPipeline() {
  const pipelineContainer = document.getElementById('deals-pipeline-view');
  if (!pipelineContainer) return console.warn('deals pipeline container missing');
  pipelineContainer.innerHTML = '';

  PIPELINE_STAGES.forEach(stage => {
    const stageDeals = dealsData.filter(d => d.stage === stage);
    const column = document.createElement('div');
    column.className = 'pipeline-column p-4 bg-bg-card rounded-xl border border-border-dark flex flex-col';
    column.setAttribute('data-stage', stage);
    column.addEventListener('dragover', handleDragOver);
    column.addEventListener('drop', handleDrop);
    column.addEventListener('dragleave', handleDragLeave);

    const stageHeader = document.createElement('h3');
    stageHeader.className = `font-bold text-lg mb-3 ${stage === 'Closed Won' ? 'text-green-400' : 'text-blue-400'}`;
    stageHeader.innerHTML = `${stage} (<span class="text-white">${stageDeals.length}</span>)`;

    const cardContainer = document.createElement('div');
    cardContainer.className = 'space-y-3 flex-1';

    stageDeals.forEach(deal => {
      const card = document.createElement('div');
      card.className = 'deals-card p-3 bg-bg-dark rounded-lg border border-border-dark shadow-md hover:border-blue-500 card-animate';
      card.setAttribute('draggable', 'true');
      card.setAttribute('data-id', deal.id);
      card.addEventListener('dragstart', handleDragStart);
      card.addEventListener('dragend', handleDragEnd);

      const formattedAmount = formatKES(deal.amount);
      const formattedCloseDate = formatDate(deal.closeDate);
      const isClosed = (deal.stage && String(deal.stage).toLowerCase() === 'closed won');

      // Close date / Won badge
      const closeHtml = isClosed
        ? `<p class="text-sm text-center"><span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-green-600 text-white">Won</span></p>`
        : `<p class="text-sm text-center text-white/70">Close: ${formattedCloseDate}</p>`;

      // Follow up button (omit for closed deals)
      const followUpHtml = isClosed
        ? ''
        : `<div class="deals-card-follow-up mt-2">
             <button class="w-full bg-blue-600 text-white text-sm font-semibold py-1 rounded-md" data-deal-id="${deal.id}" data-action="follow-up">
               Follow Up
             </button>
           </div>`;

      card.innerHTML = `
        <p class="font-bold text-lg mb-1">${deal.dealName}</p>
        <p class="text-sm text-white/70">${deal.contactName || ''}</p>
        <p class="font-extrabold text-center text-faint-gold my-3">${formattedAmount}</p>
        ${closeHtml}
        ${followUpHtml}
      `;
      cardContainer.appendChild(card);
    });

    column.appendChild(stageHeader);
    column.appendChild(cardContainer);
    pipelineContainer.appendChild(column);
  });

  // delegated follow-up click
  pipelineContainer.removeEventListener('click', delegateFollowUpClick);
  pipelineContainer.addEventListener('click', delegateFollowUpClick);
}

function renderDealsList(deals = dealsData.filter(d => PIPELINE_STAGES.includes(d.stage)), containerId = 'deals-list-container', isModal = false) {
  const listContainer = document.getElementById(containerId);
  if (!listContainer) return;

  listContainer.innerHTML = '';

  // Ensure deals are shown newest-first by created_at (or fallback to added_date)
  const sortedDeals = (deals || [])
    .slice()
    .sort((a, b) => new Date(b.created_at || b.added_date || 0) - new Date(a.created_at || a.added_date || 0));

  sortedDeals.forEach((deal, index) => {
  const formattedAmount = formatKES(deal.amount);
  const formattedCloseDate = formatDate(deal.closeDate);
  const dealNumber = index + 1;
  const isClosed = (deal.stage && String(deal.stage).toLowerCase() === 'closed won');

  const stageOptions = ALL_STAGES.map(stage => `<option value="${stage}" ${deal.stage === stage ? 'selected' : ''}>${stage}</option>`).join('');

    const row = document.createElement('div');
    row.className = `deal-list-row text-sm relative`;
    row.setAttribute('data-id', deal.id);

    row.innerHTML = `
      <div></div>
      <div class="text-white/80 font-semibold">${dealNumber}</div>
      <div class="edit-cell">
        <span class="editable-content" contenteditable="false" data-field="dealName" data-id="${deal.id}">${deal.dealName}</span>
        <i class="fa-solid fa-pen-to-square text-white/50 hover:text-white edit-icon cursor-pointer" data-id="${deal.id}" data-field="dealName" data-type="deal"></i>
      </div>
      <div class="edit-cell text-white/70">
        <span class="editable-content" contenteditable="false" data-field="contactName" data-id="${deal.id}">
          <span class="block font-medium">${deal.contactName || ''}</span>
          <span class="block text-xs">${deal.contactPhone || ''}</span>
        </span>
        <i class="fa-solid fa-pen-to-square text-white/50 hover:text-white edit-icon cursor-pointer" data-id="${deal.id}" data-field="contactName" data-type="deal"></i>
      </div>
      <div class="text-white/80">
        <select class="w-full bg-bg-dark border border-border-dark rounded-lg py-1 px-2 text-white text-sm" data-deal-id="${deal.id}">
          ${stageOptions}
        </select>
      </div>
      <div class="edit-cell font-bold text-yellow-400">
        <span class="editable-content" contenteditable="false" data-field="amount" data-id="${deal.id}">${formattedAmount}</span>
        <i class="fa-solid fa-pen-to-square text-white/50 hover:text-white edit-icon cursor-pointer" data-id="${deal.id}" data-field="amount" data-type="deal"></i>
      </div>
      <div class="edit-cell flex items-center space-x-2 text-white/70">
        <span class="w-3 h-3 rounded-full ${isClosed ? 'bg-green-500' : getCloseDateColor(deal.closeDate)} flex-shrink-0"></span>
        ${isClosed ? `<span class="editable-content" contenteditable="false" data-field="closeDate" data-id="${deal.id}"><span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-green-600 text-white">Won</span></span>` : `<span class="editable-content" contenteditable="false" data-field="closeDate" data-id="${deal.id}">${formattedCloseDate}</span>`}
        <i class="fa-solid fa-pen-to-square text-white/50 hover:text-white edit-icon cursor-pointer" data-id="${deal.id}" data-field="closeDate" data-type="deal"></i>
      </div>
      <div class="deal-list-row-actions">
        ${isClosed ? '' : `<button class="bg-blue-600 text-white text-xs font-semibold py-1 px-3 rounded-xl" data-deal-id="${deal.id}" data-action="follow-up">Follow Up</button>`}
        <button class="text-white/60 hover:text-blue-500 deal-actions-btn ml-2" title="More Actions" data-deal-id="${deal.id}">
          <i class="fa-solid fa-ellipsis-v"></i>
        </button>
      </div>
    `;
    listContainer.appendChild(row);

    // Wire stage select change
    const selectEl = row.querySelector('select[data-deal-id]');
    if (selectEl) selectEl.addEventListener('change', async (e) => {
      const sel = e.currentTarget;
      const dId = parseInt(sel.dataset.dealId, 10);
      const newStage = sel.value;
      sel.disabled = true;
      try {
        await updateDeal(dId, { stage: newStage, closeDate: (HIDDEN_STAGES.includes(newStage) ? new Date().toISOString().slice(0,10) : null) });
        logStep('Deal stage updated from list', `${dId} -> ${newStage}`);
      } catch (err) {
        console.error('❌ list stage change failed', err);
        showInAppAlert('Failed to update deal stage — changes were not saved. See console for details.');
        await loadDeals();
      } finally {
        sel.disabled = false;
      }
    });
  });

  // attach listeners to row edit icons and editable content
  attachDealListListeners(containerId);

  // Attach actions handlers for desktop three-dots on deals
  attachDealActionsHandlers(containerId);
}

// -------------------------------------------------------------------
// DEAL ACTIONS MENU (three-dots menu for desktop deals)
function ensureDealActionsMenu() {
  let menu = document.getElementById('deal-actions-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'deal-actions-menu';
  menu.style.position = 'absolute';
  menu.style.zIndex = 2000;
  menu.style.minWidth = '120px';
  menu.style.background = '#0b1220';
  menu.style.border = '1px solid rgba(255,255,255,0.06)';
  menu.style.borderRadius = '8px';
  menu.style.padding = '6px 0';
  menu.style.boxShadow = '0 6px 18px rgba(3,8,23,0.6)';
  menu.className = 'text-sm text-white';
  menu.innerHTML = `
    <button id="deal-action-delete" class="w-full text-left px-4 py-2 hover:bg-white/5" style="background: transparent; border: none; color: inherit;">Delete</button>
  `;
  document.body.appendChild(menu);

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!menu.contains(target) && !target.closest('.deal-actions-btn')) {
      menu.style.display = 'none';
      menu.dataset.dealId = '';
    }
  });
  return menu;
}

function showDealMenuForButton(btn) {
  const dealId = btn.dataset.dealId;
  const rect = btn.getBoundingClientRect();
  const menu = ensureDealActionsMenu();
  menu.style.display = 'block';
  const left = Math.min(window.innerWidth - 140, rect.left);
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  menu.dataset.dealId = dealId;

  const delBtn = document.getElementById('deal-action-delete');
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    const dId = parseInt(menu.dataset.dealId, 10);
    if (!dId) return;
    if (!confirm('Delete this deal? This action cannot be undone.')) return;
    try {
      delBtn.disabled = true;
      await deleteDeal(dId);
      menu.style.display = 'none';
      menu.dataset.dealId = '';
      // optimistic UI: remove row(s)
      document.querySelectorAll(`[data-id="${dId}"]`).forEach(el => el.remove());
      await loadDeals();
    } catch (err) {
      console.error('❌ Failed to delete deal', err);
      showInAppAlert('Failed to delete deal — see console.');
    } finally {
      delBtn.disabled = false;
    }
  };
}

function attachDealActionsHandlers(containerId = 'deals-list-container') {
  const listContainer = document.getElementById(containerId);
  if (!listContainer) return;
  listContainer.querySelectorAll('.deal-actions-btn').forEach(btn => {
    if (btn.dataset.listenerAttached) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDealMenuForButton(e.currentTarget);
    });
    btn.dataset.listenerAttached = 'true';
  });
}

function attachDealListListeners(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Follow-up buttons
  container.querySelectorAll('[data-action="follow-up"]').forEach(button => {
    button.addEventListener('click', (e) => {
      const dealId = parseInt(e.currentTarget.dataset.dealId, 10);
      handleFollowUpClick(dealId, 'deal', e);
    });
  });

  // Edit icons
  container.querySelectorAll('.edit-icon').forEach(icon => {
    icon.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.dataset.id, 10);
      const field = e.currentTarget.dataset.field;
      handleEditClick(e, id, 'deal', field);
      const content = e.currentTarget.closest('.edit-cell').querySelector('.editable-content');
      content && content.setAttribute('contenteditable', 'true');
      content && content.focus();
    });
  });

  // Blur -> save for editable fields
  container.querySelectorAll('.editable-content').forEach(cell => {
    cell.addEventListener('blur', (e) => {
      const id = parseInt(e.target.dataset.id, 10);
      const field = e.target.dataset.field;
      handleSaveEdit(e, id, 'deal', field);
    });
    // Debounced save for inline notes fields
    if (cell.dataset && cell.dataset.field === 'notes') {
      cell.addEventListener('input', (ev) => {
        const target = ev.target; const val = target.textContent || '';
        const existing = _autoSaveTimers.get(target); if (existing) clearTimeout(existing);
        const t = setTimeout(() => { if (!target.dataset.dealId && target.dataset.id) target.dataset.dealId = target.dataset.id; persistNotesForElement(target, val); }, 900);
        _autoSaveTimers.set(target, t);
      });
    }
  });
}

// -------------------------------------------------------------------
// DRAG & DROP (updates DB on drop)
function handleDragStart(e) {
  const el = e.currentTarget;
  draggedDealId = parseInt(el.dataset.id, 10);
  try {
    // some environments may not allow setting dataTransfer (guard for safety)
    e.dataTransfer && e.dataTransfer.setData && e.dataTransfer.setData('text/plain', String(draggedDealId));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  } catch (err) {
    // ignore
  }
  // capture element reference for async callback to avoid using the reused event object
  setTimeout(() => { try { el.classList.add('opacity-50', 'shadow-2xl'); } catch (err) {} }, 0);
  showHiddenDropZones(true);
}
function handleDragEnd(e) {
  e.currentTarget.classList.remove('opacity-50', 'shadow-2xl');
  draggedDealId = null; // Clear dragged deal ID
  showHiddenDropZones(false);
}
function handleDragOver(e) {
  e.preventDefault();
  const target = e.currentTarget;
  document.querySelectorAll('.pipeline-column, .drop-zone-drawer').forEach(el => el.classList.remove('drag-over', 'drop-zone-drag-over'));
  target.classList.add('drag-over');
  if (target.classList.contains('drop-zone-drawer')) target.classList.add('drop-zone-drag-over');
}
function handleDragLeave(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over', 'drop-zone-drag-over');
}
async function handleDrop(e) {
  e.preventDefault();
  const droppedId = parseInt(e.dataTransfer.getData('text/plain'), 10) || draggedDealId;
  const target = e.currentTarget;
  target.classList.remove('drag-over', 'drop-zone-drag-over');
  const newStage = target.dataset.stage;
  if (newStage && droppedId) {
    // Optimistic UI update: move the deal locally and re-render pipeline immediately
    try {
      const localDeal = (dealsData || []).find(d => Number(d.id) === Number(droppedId));
      if (localDeal) {
        localDeal.stage = newStage;
        if (HIDDEN_STAGES.includes(newStage)) localDeal.closeDate = new Date().toISOString().slice(0,10);
        // immediate render so user sees the move
        try { renderDealsPipeline(); } catch (err) { console.warn('optimistic renderDealsPipeline failed', err); }
      }

      // Persist to DB (updateDeal will refresh local state via loadDeals on success)
      await updateDeal(droppedId, { stage: newStage, closeDate: (HIDDEN_STAGES.includes(newStage) ? new Date().toISOString().slice(0,10) : null) });
      logStep('Dropped deal updated to stage', `${droppedId} -> ${newStage}`);
    } catch (err) {
      console.error('❌ handleDrop error', err);
      // Revert to authoritative state from server if the update failed
      try { await loadDeals(); } catch (e) { console.warn('Failed to reload deals after drop error', e); }
    }
  }
  showHiddenDropZones(false);
}

function showHiddenDropZones(isDragging) {
  const dropZoneContainer = document.getElementById('hidden-drop-zones');
  const dealsSection = document.getElementById('deals-section');
  if (!dropZoneContainer) return;
  // Guard dealsSection in case DOM structure is different on some pages
  if (isDragging && dealsSection && !dealsSection.classList.contains('hidden')) {
    dropZoneContainer.classList.add('active'); dropZoneContainer.classList.remove('hidden-zone');
    // Wire standard drag handlers on the small tiles so they behave like pipeline columns
    const unq = document.getElementById('unqualified-drop-zone');
    const lost = document.getElementById('lost-drop-zone');
    if (unq && !unq.dataset.dzInit) {
      unq.addEventListener('dragover', handleDragOver);
      unq.addEventListener('dragenter', handleDragOver);
      unq.addEventListener('dragleave', handleDragLeave);
      unq.addEventListener('drop', handleDrop);
      unq.dataset.dzInit = '1';
    }
    if (lost && !lost.dataset.dzInit) {
      lost.addEventListener('dragover', handleDragOver);
      lost.addEventListener('dragenter', handleDragOver);
      lost.addEventListener('dragleave', handleDragLeave);
      lost.addEventListener('drop', handleDrop);
      lost.dataset.dzInit = '1';
    }
  } else {
    dropZoneContainer.classList.remove('active'); dropZoneContainer.classList.add('hidden-zone');
  }
}

function toggleDropZoneDrawer(stage = null) {
  const modal = document.getElementById('drop-zone-table-modal');
  if (!modal) return;
  if (modal.classList.contains('hidden') && stage) {
    openDropZone = stage;
    const stageDeals = dealsData.filter(d => d.stage === stage).sort((a,b)=> new Date(b.closeDate) - new Date(a.closeDate));
    document.getElementById('drop-zone-modal-title') && (document.getElementById('drop-zone-modal-title').textContent = `${stage} Deals (${stageDeals.length})`);
    document.getElementById('header-date') && (document.getElementById('header-date').textContent = stage === 'Lost' ? 'Date Lost' : 'Date Disqualified');
    renderDealsList(stageDeals, 'drop-zone-table-container', true);
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
    openDropZone = null;
    renderDealsPipeline();
  }
}

// -------------------------------------------------------------------
// FOLLOW-UP handling (UPDATED for deal data auto-population)
function delegateFollowUpClick(e) {
  const action = e.target.dataset && e.target.dataset.action;
  if (action === 'follow-up' && e.target.dataset.dealId) {
    e.stopPropagation();
    const dealId = parseInt(e.target.dataset.dealId, 10);
    handleFollowUpClick(dealId, 'deal', e);
  }
}

function handleFollowUpClick(id, type, e) {
  // debug log to help verify click wiring
  try { console.debug && console.debug('handleFollowUpClick invoked', { id, type }); } catch (err) {}
  // If it's a deal id - prefill follow-up add modal
  if (type === 'deal') {
    const deal = dealsData.find(d => d.id === id);
    if (!deal) return;

    // If deal is already closed (Closed Won), show the closed-deal modal instead of follow-up flow
    if (String(deal.stage).toLowerCase() === 'closed won' || deal.stage === 'Closed Won') {
      openClosedDealModal && openClosedDealModal(deal);
      return;
    }

    const formattedAmount = formatKES(deal.amount);
    const closeDotClass = getCloseDateColor(deal.closeDate);
    const formattedCloseDate = formatDate(deal.closeDate);

    // Populate Follow-up Modal
    document.getElementById('modal-title') && (document.getElementById('modal-title').textContent = `Follow up on ${deal.dealName}`);
  const modalNotesEl = document.getElementById('modal-notes');
  if (modalNotesEl) {
    // Prefer contact notes for follow-up flows. Attach contactId so autosave will update contacts.notes
    const contactObj = (contacts || []).find(c => Number(c.id) === Number(deal.contactId));
    const contactNotes = contactObj ? (contactObj.notes || '') : (deal.contactNotes || deal.contact_notes || deal.notes || '');
    modalNotesEl.value = contactNotes || '';
    modalNotesEl.dataset.contactId = contactObj ? contactObj.id : (deal.contactId || '');
    // clear followup/deal dataset markers to avoid updating deals directly
    modalNotesEl.dataset.dealId = '';
    modalNotesEl.dataset.followupId = '';
  }

  // Add a small, sleek Activity Log button aligned to the top-right of the notes label
  try {
    const ta = document.getElementById('modal-notes');
    if (ta) {
      // Find the label immediately above the textarea (the Notes label in the modal)
      const possibleLabel = ta.previousElementSibling && ta.previousElementSibling.tagName && ta.previousElementSibling.tagName.toLowerCase() === 'label' ? ta.previousElementSibling : null;
      if (possibleLabel) {
        // Avoid wrapping multiple times
        if (!possibleLabel.dataset.notesHeaderWrapped) {
          const wrapper = document.createElement('div');
          wrapper.style.display = 'flex';
          wrapper.style.justifyContent = 'space-between';
          wrapper.style.alignItems = 'center';
          wrapper.style.marginBottom = '8px';

          // Replace label with wrapper and move label inside
          possibleLabel.parentNode.replaceChild(wrapper, possibleLabel);
          wrapper.appendChild(possibleLabel);

          // Create the sleek small button and append to the right
          const actBtn = document.createElement('button');
          actBtn.id = 'modal-activity-log-btn';
          actBtn.type = 'button';
          actBtn.textContent = 'Activity Log';
          actBtn.title = 'Activity Log';
          // Use classes similar to after-sale referral button but grey and with a visible border
          actBtn.className = 'bg-gray-500 hover:bg-gray-600 text-white text-sm font-medium py-1 px-3 rounded-lg transition-colors border border-gray-400';
          actBtn.style.boxSizing = 'border-box';
          actBtn.dataset.dealId = deal.id;
          actBtn.onclick = (ev) => { ev.stopPropagation(); openDealLogs && openDealLogs(deal.id); };

          wrapper.appendChild(actBtn);
          // Mark wrapped to avoid duplicate wrappers
          possibleLabel.dataset.notesHeaderWrapped = '1';
        } else {
          // If already wrapped, just ensure button has correct deal id
          const existing = document.getElementById('modal-activity-log-btn');
          if (existing) existing.dataset.dealId = deal.id;
        }
      }
    }
  } catch (e) { console.debug('Unable to attach Activity Log button', e); }

    // NEW: Auto-populate Close Date and Amount
    document.getElementById('modal-close-date-container') && (document.getElementById('modal-close-date-container').innerHTML = `
      <span class="w-3 h-3 rounded-full ${closeDotClass} flex-shrink-0"></span>
      <span class="text-white/80 text-sm">${formattedCloseDate}</span>
    `);
    document.getElementById('modal-amount') && (document.getElementById('modal-amount').textContent = formattedAmount);

    selectedFollowUp = {
      id: null, // it's a new follow-up, but we use the same modal flow
      reason: `Follow up on ${deal.dealName}`,
      notes: (modalNotesEl && modalNotesEl.value) ? modalNotesEl.value : (deal.notes || ''),
      due_at: new Date().toISOString(),
      deal_id: deal.id,
      contactName: deal.contactName,
      contactPhone: deal.contactPhone
    };

    openModal('follow-up-modal');

  } else if (type === 'followUpItem') {
    // from the follow-ups list - open follow-up modal to act on it
    const fu = followUps.find(f => Number(f.id) === Number(id));
    if (!fu) return;
    // Normalize selectedFollowUp for downstream code
    selectedFollowUp = {
      ...fu,
      id: fu.id,
      followup_id: fu.followup_id || fu.id,
      title: fu.title || fu.followup_title || '',
      message_prompt: fu.message_prompt || fu.response_notes || ''
    };

    // fill modal with fu info
    const displayTitle = selectedFollowUp.title || selectedFollowUp.followup_title || 'Follow up';
    document.getElementById('modal-title') && (document.getElementById('modal-title').textContent = `${displayTitle}`);
    const modalNotesEl = document.getElementById('modal-notes');
    if (modalNotesEl) {
      // Prefer writing notes to the contact record so all notes live in one place.
      // Therefore we DO NOT set a followupId on the textarea; instead set only contactId.
      modalNotesEl.dataset.followupId = '';
      modalNotesEl.dataset.dealId = '';

      // Try to resolve contact from the follow-up itself or via the associated deal
      const contactIdFromFu = selectedFollowUp.contactId || selectedFollowUp.contact_id || null;
      let resolvedContact = null;
      if (contactIdFromFu) resolvedContact = (contacts || []).find(c => Number(c.id) === Number(contactIdFromFu));

      // If follow-up references a deal, try to get contact from that deal
      const fuDealId = selectedFollowUp.dealId || selectedFollowUp.deal_id || null;
      if (!resolvedContact && fuDealId) {
        const d = (dealsData || []).find(dd => Number(dd.id) === Number(fuDealId));
        if (d && d.contactId) resolvedContact = (contacts || []).find(c => Number(c.id) === Number(d.contactId));
      }

      // Set textarea value to contact notes when available, otherwise fall back to follow-up prompt
      modalNotesEl.value = (resolvedContact && (resolvedContact.notes || '')) || selectedFollowUp.message_prompt || '';
      if (resolvedContact && resolvedContact.id) modalNotesEl.dataset.contactId = resolvedContact.id;
      else modalNotesEl.dataset.contactId = contactIdFromFu || '';
    }

  // If this follow-up is tied to a deal, show a small Activity Log button in the notes header
  try {
    const dealIdForFu = fu.deal_id || fu.dealId || null;
    const ta = document.getElementById('modal-notes');
    if (ta && dealIdForFu) {
      const possibleLabel = ta.previousElementSibling && ta.previousElementSibling.tagName && ta.previousElementSibling.tagName.toLowerCase() === 'label' ? ta.previousElementSibling : null;
      if (possibleLabel) {
        if (!possibleLabel.dataset.notesHeaderWrapped) {
          const wrapper = document.createElement('div');
          wrapper.style.display = 'flex';
          wrapper.style.justifyContent = 'space-between';
          wrapper.style.alignItems = 'center';
          wrapper.style.marginBottom = '8px';
          possibleLabel.parentNode.replaceChild(wrapper, possibleLabel);
          wrapper.appendChild(possibleLabel);

          const actBtn = document.createElement('button');
          actBtn.id = 'modal-activity-log-btn';
          actBtn.type = 'button';
          actBtn.textContent = 'Activity Log';
          actBtn.title = 'Activity Log';
          // Use classes similar to after-sale referral button but grey and with a visible border
          actBtn.className = 'bg-gray-500 hover:bg-gray-600 text-white text-sm font-medium py-1 px-3 rounded-lg transition-colors border border-gray-400';
          actBtn.style.boxSizing = 'border-box';
          actBtn.dataset.dealId = dealIdForFu;
          actBtn.onclick = (ev) => { ev.stopPropagation(); openDealLogs && openDealLogs(dealIdForFu); };
          wrapper.appendChild(actBtn);
          possibleLabel.dataset.notesHeaderWrapped = '1';
        } else {
          const existing = document.getElementById('modal-activity-log-btn');
          if (existing) existing.dataset.dealId = dealIdForFu;
        }
      }
    }
  } catch (e) { console.debug('Unable to attach Activity Log button for followUp', e); }
    
    // If this follow-up is tied to a deal, populate the modal just like the Deal modal
    const dealIdForFu = fu.deal_id || fu.dealId || null;
    if (dealIdForFu) {
      const dealObj = (dealsData || []).find(d => Number(d.id) === Number(dealIdForFu));
      if (dealObj) {
        try {
          const formattedAmount = formatKES(dealObj.amount);
          const closeDotClass = getCloseDateColor(dealObj.closeDate);
          const formattedCloseDate = formatDate(dealObj.closeDate);
          document.getElementById('modal-amount') && (document.getElementById('modal-amount').textContent = formattedAmount);
          document.getElementById('modal-close-date-container') && (document.getElementById('modal-close-date-container').innerHTML = `\n            <span class="w-3 h-3 rounded-full ${closeDotClass} flex-shrink-0"></span>\n            <span class="text-white/80 text-sm">${formattedCloseDate}</span>\n          `);

          // Show contact name in the Details area (per request: replace Details with contact name)
          const contactName = dealObj.contactName || dealObj.contact_name || '';
          document.getElementById('modal-details') && (document.getElementById('modal-details').textContent = contactName);
        } catch (e) {
          console.warn('Failed to populate deal info for follow-up modal', e);
        }
      }
    } else {
      // Fallback: no deal associated — show N/A placeholders
      document.getElementById('modal-amount') && (document.getElementById('modal-amount').textContent = 'N/A');
      document.getElementById('modal-close-date-container') && (document.getElementById('modal-close-date-container').innerHTML = `\n        <span class="w-3 h-3 rounded-full bg-white/30 flex-shrink-0"></span>\n        <span class="text-white/80 text-sm">N/A</span>\n      `);
      document.getElementById('modal-details') && (document.getElementById('modal-details').textContent = '');
    }

    // Existing follow-up date population
    const dateContainer = document.getElementById('follow-up-date');
    if (dateContainer) {
      const formattedCloseDate = formatDate(fu.due_at);
      const closeDotClass = getCloseDateColor(fu.due_at);
      dateContainer.innerHTML = `
        <span class="w-3 h-3 rounded-full ${closeDotClass} flex-shrink-0"></span>
        <span class="text-white/80 text-sm">${formattedCloseDate}</span>
      `;
    }
    openModal('follow-up-modal');
  }
}

async function completeFollowUp(id) {
  try {
    await updateFollowUp(id, { is_completed: true });
    selectedFollowUp = null;
    await loadFollowUps();
  } catch (err) {
    console.error('❌ completeFollowUp error', err);
  }
}

// Complete follow-up but animate its card sliding out to the left and remove from DOM
async function completeFollowUpAnimated(id, cardEl) {
  if (!id) throw new Error('Invalid follow-up id');
  // Perform DB update directly (avoid triggering full UI reload inside updateFollowUp)
  try {
    // Update the row in DB for this business
    const { error } = await client.from('user_followups')
      .update({ is_completed: true })
      .eq('id', id)
      .eq('business_id', BUSINESS_ID);
    if (error) throw error;

    // Remove local followUps item to keep state consistent
    try {
      followUps = (followUps || []).filter(f => Number(f.id) !== Number(id) && Number(f.followup_id) !== Number(id));
    } catch (e) { /* ignore */ }

    // Animate and remove DOM card
    if (cardEl) await animateAndRemoveCard(cardEl);

    // If no follow-ups remain for today, show empty banner
    try {
      const container = document.getElementById('follow-up-list');
      const inner = container && container.querySelector('#followups-list-inner');
      if (inner && inner.children.length === 0) {
        const banner = document.getElementById('followups-empty-banner');
        if (banner) banner.classList.remove('hidden');
      }
    } catch (e) { /* ignore */ }

  } catch (err) {
    console.error('❌ completeFollowUpAnimated error', err);
    throw err;
  }
}

function animateAndRemoveCard(cardEl, duration = 320) {
  return new Promise((resolve) => {
    try {
      // ensure it's visible for transition start
      cardEl.style.transition = `transform ${duration}ms ease, opacity ${duration}ms ease, height ${duration}ms ease, margin ${duration}ms ease, padding ${duration}ms ease`;
      cardEl.style.transformOrigin = 'left center';
      // compute current height to animate to 0 smoothly
      const rect = cardEl.getBoundingClientRect();
      const height = rect.height + 'px';
      cardEl.style.height = height;
      // force reflow so the height set takes effect
      // eslint-disable-next-line no-unused-expressions
      cardEl.offsetHeight;
      // start animation: slide left and fade
      cardEl.style.transform = 'translateX(-110%)';
      cardEl.style.opacity = '0';
      cardEl.style.height = '0px';
      cardEl.style.margin = '0px';
      cardEl.style.padding = '0px';

      setTimeout(() => {
        try { cardEl.remove(); } catch (e) {}
        resolve();
      }, duration + 20);
    } catch (e) { resolve(); }
  });
}

// -------------------------------------------------------------------
// ADD MODAL logic (forms switching & search) - reuse original UX but backed by DB
function openAddModal() { openModal('add-main-modal'); switchAddForm('placeholder'); formOrigin = null; }
function switchAddForm(formName) {
  document.querySelectorAll('.add-form-menu-item').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.add-form-content').forEach(form => form.classList.add('hidden'));
  const targetForm = document.getElementById(`add-${formName}-form`);
  const targetMenuItem = document.querySelector(`.add-form-menu-item[data-form="${formName}"]`);
  if (targetForm) targetForm.classList.remove('hidden');
  if (targetMenuItem) targetMenuItem.classList.add('active');

  // If switching away from the deal form, ensure any readonly/preloaded state is cleared
  try {
    if (formName !== 'deal') {
      const dealSearch = document.getElementById('deal-contact-search');
      if (dealSearch && dealSearch.dataset.prefilled === 'true') {
        dealSearch.removeAttribute('readonly');
        delete dealSearch.dataset.prefilled;
      }
      const dealResults = document.getElementById('deal-contact-results');
      if (dealResults) dealResults.classList.add('hidden');
    }
  } catch (e) { /* non-fatal */ }

  if (formName === 'deal') {
    populateDealStageSelect();
    initDealContactSearch();
    document.getElementById('new-deal-close-date') && (document.getElementById('new-deal-close-date').value = new Date().toISOString().slice(0,10));
  } else if (formName === 'follow-up') {
    initFollowUpDealSearch();
    document.getElementById('new-follow-up-due-date') && (document.getElementById('new-follow-up-due-date').value = new Date().toISOString().slice(0,16));
  }
}

function populateDealStageSelect() {
  const select = document.getElementById('new-deal-stage');
  if (!select) return;
  select.innerHTML = PIPELINE_STAGES.map(stage => `<option value="${stage}" ${stage === 'New Leads' ? 'selected' : ''}>${stage}</option>`).join('');
}

// Contact search for deal form (uses live contacts)
function initDealContactSearch() {
  const searchInput = document.getElementById('deal-contact-search');
  const resultsContainer = document.getElementById('deal-contact-results');
  console.log('[init] initDealContactSearch() called', { hasInput: !!searchInput, hasResults: !!resultsContainer });
  if (!searchInput || !resultsContainer) return;
  function renderContactSearchResults(list) {
    resultsContainer.innerHTML = list.map(c => `
      <div class="contacts-search-item p-2 cursor-pointer hover:bg-bg-dark border-b border-border-dark flex items-center gap-3" data-id="${c.id}" data-name="${c.name}" data-phone="${c.phone}">
        <div class="avatar" style="background:${avatarColor(c.name)}; width:36px; height:36px; border-radius:9999px; display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600; flex-shrink:0">${((c.name||'?').charAt(0) || '?')}</div>
        <div class="meta">
          <div class="name font-medium text-white">${c.name}</div>
          <div class="phone text-xs text-white/70">${c.phone || ''}</div>
        </div>
      </div>
    `).join('');
    resultsContainer.querySelectorAll('.contacts-search-item').forEach(item => {
      item.onclick = (e) => selectDealContact(e.currentTarget);
    });
  }
  // initial list (recent)
  renderContactSearchResults(contacts.slice().sort((a,b)=> new Date(b.added_date) - new Date(a.added_date)));
  resultsContainer.classList.remove('hidden');

  searchInput.oninput = (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    if (!q) {
      renderContactSearchResults(contacts.slice().sort((a,b)=> new Date(b.added_date) - new Date(a.added_date)));
      resultsContainer.classList.remove('hidden');
      return;
    }

    // scoring so best matches appear first
    const scored = contacts
      .filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
      .map(c => {
        const name = (c.name || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        let score = 0;
        if (name.startsWith(q)) score += 200;
        if (name === q) score += 300;
        if (name.includes(q) && !name.startsWith(q)) score += 80;
        if (phone.includes(q)) score += 120;
        // small boost for more recent contacts
        const added = new Date(c.added_date || 0).getTime() || 0;
        score += Math.min(50, Math.max(0, Math.floor((Date.now() - added) / (1000*60*60*24)) * -0.1));
        return { c, score };
      })
      .sort((a,b) => b.score - a.score)
      .map(x => x.c);

    renderContactSearchResults(scored);
    resultsContainer.classList.remove('hidden');
    selectedDealContact = null;
  };
  searchInput.onfocus = () => resultsContainer.classList.remove('hidden');
  searchInput.onblur = () => setTimeout(()=> resultsContainer.classList.add('hidden'), 200);
}

function selectDealContact(element) {
  selectedDealContact = { id: parseInt(element.dataset.id,10), name: element.dataset.name, phone: element.dataset.phone };
  document.getElementById('deal-contact-search') && (document.getElementById('deal-contact-search').value = `${selectedDealContact.name} (${selectedDealContact.phone || ''})`);
  document.getElementById('new-deal-contact-id') && (document.getElementById('new-deal-contact-id').value = selectedDealContact.id);
  document.getElementById('deal-contact-results') && document.getElementById('deal-contact-results').classList.add('hidden');
}

function initFollowUpDealSearch() {
  const input = document.getElementById('follow-up-deal-search');
  const results = document.getElementById('follow-up-deal-results');
  if (!input || !results) return;
  function render(items) {
    results.innerHTML = items.map(d => `<div class="p-2 cursor-pointer hover:bg-bg-dark" data-id="${d.id}" data-name="${d.deal_name || d.dealName}"><p class="font-medium text-white">${d.deal_name || d.dealName}</p></div>`).join('');
    results.querySelectorAll('div').forEach(it => {
      it.onclick = (e) => {
        const id = parseInt(e.currentTarget.dataset.id, 10);
        const name = e.currentTarget.dataset.name;
        document.getElementById('follow-up-deal-search').value = name;
        document.getElementById('new-follow-up-deal-id').value = id;
        results.classList.add('hidden');

        // Load the contact info associated with this deal into the contact box
        const contactInfoEl = document.getElementById('follow-up-contact-info');
        const selected = dealsData.find(dd => dd.id === id);
        if (selected) {
          const contactName = selected.contactName || selected.contact_name || 'Unknown';
          const contactPhone = selected.contactPhone || selected.contact_phone || '';
          if (contactInfoEl) contactInfoEl.textContent = `${contactName} ${contactPhone ? `(${contactPhone})` : ''}`;
        } else {
          if (contactInfoEl) contactInfoEl.textContent = 'Select a Deal above to load contact info.';
        }
      };
    });
  }
  render(dealsData);
  input.oninput = (e) => render(dealsData.filter(d => (d.dealName || d.deal_name || '').toLowerCase().includes(e.target.value.toLowerCase())));
  input.onfocus = () => results.classList.remove('hidden');
  input.onblur = () => setTimeout(()=> results.classList.add('hidden'), 200);
}

// Close modal when clicking on the backdrop (outside the modal content)
function attachBackdropCloseHandlers() {
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    // ensure we don't attach multiple listeners
    if (modal.dataset.backdropAttached) return;
    // Do NOT add backdrop-to-close behavior for feedbackModal (we want to prevent accidental closing)
    if (modal.id === 'feedbackModal') {
      console.log('[DEBUG] Skipping backdrop close handler for feedbackModal to avoid accidental dismissals');
    } else {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModal(modal.id);
        }
      });
    }
    modal.dataset.backdropAttached = 'true';
  });
}

// Attach backdrop handlers on load
document.addEventListener('DOMContentLoaded', () => attachBackdropCloseHandlers());

// NEW: Contact search for New Meeting form
function initMeetingContactSearch() {
    const searchInput = document.getElementById('new-meeting-contact-search');
    const resultsContainer = document.getElementById('new-meeting-contact-results');
  console.log('[init] initMeetingContactSearch() called', { hasInput: !!searchInput, hasResults: !!resultsContainer });
    if (!searchInput || !resultsContainer) return;

    function renderContactSearchResults(list) {
    resultsContainer.innerHTML = list.map(c => `
    <div class="contacts-search-item p-2 cursor-pointer hover:bg-bg-dark border-b border-border-dark flex items-center gap-3" data-id="${c.id}" data-name="${c.name}" data-phone="${c.phone}">
      <div class="avatar" style="background:${avatarColor(c.name)}; width:36px; height:36px; border-radius:9999px; display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600; flex-shrink:0">${((c.name||'?').charAt(0) || '?')}</div>
      <div class="meta">
        <div class="name font-medium text-white">${c.name}</div>
        <div class="phone text-xs text-white/70">${c.phone || ''}</div>
      </div>
    </div>
    `).join('');
    resultsContainer.querySelectorAll('.contacts-search-item').forEach(item => {
      item.onclick = (e) => selectMeetingContact(e.currentTarget);
    });
    }
    
    renderContactSearchResults(contacts.slice().sort((a,b)=> new Date(b.added_date) - new Date(a.added_date)));
    resultsContainer.classList.remove('hidden');

  searchInput.oninput = (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    if (!q) {
      renderContactSearchResults(contacts.slice().sort((a,b)=> new Date(b.added_date) - new Date(a.added_date)));
      resultsContainer.classList.remove('hidden');
      return;
    }

    const scored = contacts
      .filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
      .map(c => {
        const name = (c.name || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        let score = 0;
        if (name.startsWith(q)) score += 200;
        if (name === q) score += 300;
        if (name.includes(q) && !name.startsWith(q)) score += 80;
        if (phone.includes(q)) score += 120;
        const added = new Date(c.added_date || 0).getTime() || 0;
        score += Math.min(50, Math.max(0, Math.floor((Date.now() - added) / (1000*60*60*24)) * -0.1));
        return { c, score };
      })
      .sort((a,b) => b.score - a.score)
      .map(x => x.c);

    renderContactSearchResults(scored);
    resultsContainer.classList.remove('hidden');
  };
    searchInput.onfocus = () => resultsContainer.classList.remove('hidden');
    searchInput.onblur = () => setTimeout(()=> resultsContainer.classList.add('hidden'), 200);
}

function selectMeetingContact(element) {
    const contact = { id: parseInt(element.dataset.id,10), name: element.dataset.name, phone: element.dataset.phone };
    document.getElementById('new-meeting-contact-search') && (document.getElementById('new-meeting-contact-search').value = `${contact.name} (${contact.phone || ''})`);
    document.getElementById('new-meeting-contact-id') && (document.getElementById('new-meeting-contact-id').value = contact.id);
    document.getElementById('new-meeting-contact-results') && document.getElementById('new-meeting-contact-results').classList.add('hidden');
  // Update the visible selected contact card and associated deal
  if (typeof renderSelectedMeetingContactCard === 'function') renderSelectedMeetingContactCard();
}

// -------------------------------------------------------------------
// CONTACTS SEARCH (main contacts view)
function initContactsSearch() {
  const searchInput = document.getElementById('contacts-search');
  const results = document.getElementById('contacts-search-results');
  if (!searchInput || !results) return;

  function render(list) {
    results.innerHTML = list.map(c => `
      <div class="contacts-search-item" data-id="${c.id}" data-name="${(c.name||'').replace(/"/g,'&quot;')}" data-phone="${(c.phone||'').replace(/"/g,'&quot;')}">
        <div class="avatar" style="background:${avatarColor(c.name)}">${((c.name||'?').charAt(0) || '?')}</div>
        <div class="meta">
          <div class="name">${c.name || 'Unnamed'}</div>
          <div class="phone">${c.phone || ''}</div>
        </div>
      </div>
    `).join('');

    results.querySelectorAll('.contacts-search-item').forEach(item => {
      item.onclick = (e) => {
  const id = item.dataset.id;
  // Prefer desktop list row
  let target = document.querySelector(`#contacts-list-container .contact-row[data-id="${id}"]`);
  // Mobile cards use data-contact-id on an outer wrapper
  if (!target) target = document.querySelector(`#contacts-mobile-view [data-contact-id="${id}"]`);
        if (target) {
          try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) { target.scrollIntoView(); }
          // Add a short-lived highlight class that does not shift layout
          // For mobile, prefer the visible inner card element (.contact-card-slide)
          let highlightTarget = target;
          try {
            if (target && target.getAttribute && target.getAttribute('data-contact-id')) {
              const inner = target.querySelector && target.querySelector('.contact-card-slide');
              if (inner) highlightTarget = inner;
            }
          } catch (err) {
            /* ignore */
          }

          // Apply to both inner and outer when possible so highlight is visible
          try {
            highlightTarget.classList.add('search-highlight-brief');
            if (target && target !== highlightTarget) target.classList.add('search-highlight-brief');
          } catch (err) { /* ignore */ }

          // Remove after ~1 second
          setTimeout(() => {
            try { highlightTarget.classList.remove('search-highlight-brief'); } catch (e) {}
            try { if (target && target !== highlightTarget) target.classList.remove('search-highlight-brief'); } catch (e) {}
          }, 1000);
        }
        results.classList.add('hidden');
        searchInput.blur();
      };
    });
  }

  // initial (recent contacts)
  render((contacts || []).slice().sort((a,b)=> new Date(b.added_date || 0) - new Date(a.added_date || 0)).slice(0,20));
  // hide initially
  results.classList.add('hidden');

  const doFilter = debounce((q) => {
    const low = q.toLowerCase();
    const filtered = (contacts || []).filter(c => {
      return (c.name || '').toLowerCase().includes(low) || (c.phone || '').toLowerCase().includes(low) || (c.notes || '').toLowerCase().includes(low);
    }).slice(0,50);
    render(filtered);
  }, 150);

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value || '';
    if (!q.trim()) {
      render((contacts || []).slice().sort((a,b)=> new Date(b.added_date || 0) - new Date(a.added_date || 0)).slice(0,20));
      results.classList.remove('hidden');
      return;
    }
    doFilter(q);
    results.classList.remove('hidden');
  });

  searchInput.addEventListener('focus', () => results.classList.remove('hidden'));
  searchInput.addEventListener('blur', () => setTimeout(()=> results.classList.add('hidden'), 180));
}

// -------------------------------------------------------------------
// AFTER-SALE SEARCH (customers list)
function initAfterSaleSearch() {
  const searchInput = document.getElementById('after-sale-search');
  const results = document.getElementById('after-sale-search-results');
  console.log('[init] initAfterSaleSearch() called', { hasInput: !!searchInput, hasResults: !!results });
  if (!searchInput || !results) return;

  // Disable rendering of search results for the after-sale section while
  // keeping the search input/bar visible. This preserves the UI but prevents
  // any results from showing or interacting. Adjusting here avoids touching
  // other sections or global search behavior.
  const disableAfterSaleSearchResults = true;
  if (disableAfterSaleSearchResults) {
    try { results.innerHTML = ''; } catch (e) {}
    try { results.classList.add('hidden'); } catch (e) {}
    // Keep input responsive visually but do not render or reveal results
    searchInput.addEventListener('input', () => { /* intentionally no-op */ });
    searchInput.addEventListener('focus', () => { try { results.classList.add('hidden'); } catch (e) {} });
    searchInput.addEventListener('blur', () => { try { results.classList.add('hidden'); } catch (e) {} });
    return;
  }

  function render(list) {
    results.innerHTML = list.map(c => `
      <div class="contacts-search-item" data-id="${c.id}" data-name="${(c.name||'').replace(/"/g,'&quot;')}" data-phone="${(c.phone||'').replace(/"/g,'&quot;')}">
        <div class="avatar" style="background:${avatarColor(c.name)}">${((c.name||'?').charAt(0) || '?')}</div>
        <div class="meta">
          <div class="name">${c.name || 'Unnamed'}</div>
          <div class="phone">${c.phone || ''}</div>
        </div>
      </div>
    `).join('');

    results.querySelectorAll('.contacts-search-item').forEach(item => {
      item.onclick = (e) => {
        const id = item.dataset.id;
        // Try desktop row first (we tag rows with data-after-sale-id)
        let target = document.querySelector(`#after-sale-list-container [data-after-sale-id="${id}"]`);
        if (!target) target = document.querySelector(`#after-sale-mobile-view [data-after-sale-id="${id}"]`);
        if (target) {
          try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) { target.scrollIntoView(); }

          // Highlight inner card for mobile or the row for desktop
          let highlightTarget = target;
          try {
            if (target.getAttribute && target.getAttribute('data-after-sale-id')) {
              const inner = target.querySelector && target.querySelector('.after-sale-card-slide');
              if (inner) highlightTarget = inner;
            }
          } catch (err) { /* ignore */ }

          try { highlightTarget.classList.add('search-highlight-brief'); } catch (e) {}
          try { if (target !== highlightTarget) target.classList.add('search-highlight-brief'); } catch (e) {}
          setTimeout(() => {
            try { highlightTarget.classList.remove('search-highlight-brief'); } catch (e) {}
            try { if (target !== highlightTarget) target.classList.remove('search-highlight-brief'); } catch (e) {}
          }, 1000);
        }
        results.classList.add('hidden');
        searchInput.blur();
      };
    });
  }

  // initial render from cached grouped customers
  render((afterSaleGroupedCache || []).slice().sort((a,b)=> (b.date || 0) - (a.date || 0)).slice(0,20));
  results.classList.add('hidden');

  const doFilter = debounce((q) => {
    const low = q.toLowerCase();
    // Score each candidate so best matches bubble to top
    const scored = (afterSaleGroupedCache || [])
      .map(c => {
        const name = (c.name || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const historyText = Array.isArray(c.history) ? c.history.join(' ').toLowerCase() : '';
        let score = 0;
        if (name === low) score += 400;
        if (name.startsWith(low)) score += 200;
        if (name.includes(low) && !name.startsWith(low)) score += 80;
        if (phone.includes(low)) score += 120;
        if (historyText.includes(low)) score += 30;
        // small recency tie-breaker: more recent purchases get slight boost
        const ts = new Date(c.date || 0).getTime() || 0;
        if (ts) score += Math.max(0, Math.min(40, Math.floor((Date.now() - ts) / (1000*60*60*24)) * -0.05));
        return { c, score };
      })
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0,50)
      .map(x => x.c);

    render(scored);
  }, 150);

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value || '';
    if (!q.trim()) {
      render((afterSaleGroupedCache || []).slice().sort((a,b)=> (b.date || 0) - (a.date || 0)).slice(0,20));
      results.classList.remove('hidden');
      return;
    }
    doFilter(q);
    results.classList.remove('hidden');
  });

  searchInput.addEventListener('focus', () => results.classList.remove('hidden'));
  searchInput.addEventListener('blur', () => setTimeout(()=> results.classList.add('hidden'), 180));
}

// -------------------------------------------------------------------
// FOLLOW-UPS RENDER (today filter and actions)
function renderFollowUps() {
    const container = document.getElementById('follow-up-list');
    if (!container) return;
  // The follow-up list now has two areas:
  //  - #feedback-widget (static/floating feedback cards inside the bordered section)
  //  - #followups-list-inner (where today's follow-ups are rendered)
  const followupsInner = container.querySelector('#followups-list-inner');
  const feedbackWidgetCards = container.querySelector('#feedback-widget-cards');
  if (!followupsInner) {
    // create the inner container if not present (defensive)
    const el = document.createElement('div');
    el.id = 'followups-list-inner';
    container.appendChild(el);
  }
  // Determine today's date in YYYY-MM-DD to match `followup_date` returned from the view
  const todayISO = new Date().toISOString().slice(0,10);
  const todayFollowUps = followUps.filter(f => {
    if (!f.followup_date) return false;
    return String(f.followup_date) === String(todayISO);
  });

    const target = container.querySelector('#followups-list-inner');

    if (!todayFollowUps.length) {
        // No follow-ups returned from the backend for today.
        // Show the empty banner and clear any previously rendered rows so the UI
        // waits for live data from the database.
        const banner = document.getElementById('followups-empty-banner');
        if (banner) {
            banner.classList.remove('hidden');
        }
        // Clear any existing follow-up rows (remove stale/static/demo items)
        target.innerHTML = '';
        target.classList.add('hidden');
        return;
    }

    // Render follow-ups into the inner area below the feedback widget
    target.classList.remove('hidden');
    target.classList.add('p-6');
    const followupsHtml = todayFollowUps.map(f => {
        // Compose display time (followup_time may be null)
        let time = 'All day';
        try {
          if (f.followup_time) {
            const t = new Date(`${f.followup_date}T${f.followup_time}`);
            if (!isNaN(t)) time = t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          }
        } catch (e) { }

        // Text fields
        const title = f.title || f.followup_title || 'Follow up';
        const notes = f.message_prompt || f.response_notes || '';

        return `
      <div class="followup-card p-4 bg-bg-dark rounded-lg border-2 border-border-dark mb-4 flex justify-between items-center shadow-lg hover:bg-bg-card transition-all cursor-pointer" data-fu-id="${f.followup_id}">
        <div class="min-w-0">
          <div class="flex items-center gap-3">
            <span class="font-bold text-blue-400 mr-2">${time}</span>
            <span class="text-white font-semibold truncate">${escapeHtml(title)}</span>
          </div>
          <div class="text-white/60 text-sm mt-1 truncate">${escapeHtml(notes)}</div>
        </div>
        <button class="followup-action-btn bg-green-600 text-white text-xs font-semibold py-1 px-3 rounded-xl hover:bg-green-700 transition-colors" data-fu-id="${f.followup_id}" data-action="complete-followup">Complete</button>
      </div>
    `;
  }).join('');

    target.innerHTML = followupsHtml;

  // Ensure empty banner is hidden when follow-ups are present
  const banner = document.getElementById('followups-empty-banner');
  if (banner) banner.classList.add('hidden');

  // attach action listeners only within the followups area
  // Button handler: stop propagation to avoid double-firing when card is clicked
  target.querySelectorAll('.followup-action-btn').forEach(btn => {
    if (btn.dataset.action === 'complete-followup') {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fuId = parseInt(e.currentTarget.dataset.fuId, 10);
        console.debug('[DEBUG] complete followup button clicked', { fuId });
        // disable to avoid double-clicks
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = 'Completing...';
        // find card element
        const card = e.currentTarget.closest('.followup-card');
        try {
          await completeFollowUpAnimated(fuId, card);
        } catch (err) {
          console.error('Failed to complete follow-up', err);
          e.currentTarget.disabled = false;
          e.currentTarget.textContent = 'Complete';
        }
      });
    } else {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fuId = parseInt(e.currentTarget.dataset.fuId, 10);
        console.debug('[DEBUG] followup action button clicked', { fuId });
        handleFollowUpClick(fuId, 'followUpItem', e);
      });
    }
  });

  // Make the whole card clickable (delegated to the same handler)
  target.querySelectorAll('.followup-card[data-fu-id]').forEach(card => {
    // avoid attaching multiple times
    if (card._followupClickAttached) return;
    card.addEventListener('click', (e) => {
      const fuId = parseInt(card.dataset.fuId, 10);
      console.debug('[DEBUG] followup card clicked', { fuId });
      handleFollowUpClick(fuId, 'followUpItem', e);
    });
    card._followupClickAttached = true;
  });
}
// -------------------------------------------------------------------
function setupRealtime() {
    logStep('Setting up Realtime...');
    
    const handleRealtimeChange = (payload) => {
        logStep(`Realtime Update: ${payload.table} (${payload.eventType})`);
  if (payload.table === 'contacts') loadContacts();
  if (payload.table === 'deals') loadDeals(); // This will fail until step 2 is fixed
  if (payload.table === 'user_followups' || payload.table === 'system_followups' || payload.table === 'followups_today') loadFollowUps();
  if (payload.table === 'meetings') loadMeetings();
    };

    // --- CRITICAL: FILTER BY business_id ---
    // The 'filter' MUST use the column name and the business ID value
    const filter = `business_id=eq.${BUSINESS_ID}`;

    client.channel('crm_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter }, handleRealtimeChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deals', filter }, handleRealtimeChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'follow_ups', filter }, handleRealtimeChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', filter }, handleRealtimeChange)
        .subscribe();
    
    logStep('✅ Realtime subscribed successfully for business ID:', BUSINESS_ID);
}
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// MEETINGS RENDERERS (UPDATED FOR SCROLLING AND BADGES)
// -------------------------------------------------------------------

function switchMeetingsView(view) {
  currentMeetingsView = view;
  document.querySelectorAll('#meetings-section .meeting-view-switch-btn').forEach(btn => btn.classList.remove('active'));
  const sel = document.querySelector(`#meetings-section .meeting-view-switch-btn[data-view="${view}"]`);
  sel && sel.classList.add('active');
  const listView = document.getElementById('meetings-list-view');
  const calendarView = document.getElementById('meetings-calendar-view');

  if (view === 'list') {
    calendarView && calendarView.classList.add('hidden');
    listView && listView.classList.remove('hidden');
    renderMeetingsList();
  } else {
    listView && listView.classList.add('hidden');
    calendarView && calendarView.classList.remove('hidden');
    renderMeetingsCalendar();
  }
}

// ---------------------------
// FIXED MEETINGS RENDERING
// ---------------------------

// Safe local date string helper (YYYY-MM-DD) to avoid UTC shifts
function getLocalDateString(input) {
  if (!input) return null;
  const d = (typeof input === 'string') ? new Date(input) : input;
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Renders the full meetings list view
function renderMeetingsList() {
  console.log('🟦 [renderMeetingsList] start — meetingsData length:', (meetingsData || []).length);
  const container = document.getElementById('meetings-list-container');
  if (!container) {
    console.error('🛑 [renderMeetingsList] container #meetings-list-container not found');
    return;
  }
  container.innerHTML = '';

  if (!Array.isArray(meetingsData) || meetingsData.length === 0) {
    console.log('🟡 [renderMeetingsList] no meetings — showing empty state card');
    container.innerHTML = `
      <div class="text-center py-12 text-white/60">
        <div class="text-lg font-semibold mb-2">Your Meetings Will Appear Here</div>
        <p class="text-sm">Once you schedule meetings with your clients, they’ll show up in this list.</p>
      </div>`;
    return;
  }

  // Clone then sort (do not mutate original order)
  const sortedMeetings = [...meetingsData].sort((a, b) => {
    const da = new Date(a.setDate || a.start_at || a.raw?.start_at || a.raw?.setDate || null);
    const db = new Date(b.setDate || b.start_at || b.raw?.start_at || b.raw?.setDate || null);
    return da - db;
  });

  console.log('🟦 [renderMeetingsList] rendering', sortedMeetings.length, 'meetings');

  sortedMeetings.forEach(meeting => {
    try {
      const setDateTime = getFormattedDateTime(meeting.setDate);
      const { text: timeRemainingText, colorClass: timeColor } = getTimeRemaining(meeting.setDate);

      const buttonHtml = meeting.isPast
        ? `<button class="remind-meeting-btn bg-gray-500 text-white text-xs font-semibold py-1.5 px-3 rounded-lg cursor-not-allowed" disabled>
             <i class="fa-solid fa-circle-check mr-1"></i> Completed
           </button>`
        : `<button class="remind-meeting-btn bg-add-green hover:bg-green-700 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors" data-meeting-id="${meeting.id}">
             <i class="fa-solid fa-bell mr-1"></i> Remind
           </button>`;

      const row = document.createElement('div');
      row.className = 'meeting-list-row deal-list-row text-sm hover:bg-bg-dark transition-colors';
      row.style.gridTemplateColumns = 'minmax(150px, 1.5fr) minmax(200px, 2fr) minmax(120px, 1fr) minmax(150px, 1.5fr) 100px';

      row.innerHTML = `
        <div title="${meeting.contactName || 'No contact'}">${meeting.contactName || 'No contact'}</div>
        <div class="truncate" title="${meeting.agenda || '—'}">${meeting.agenda || '—'}</div>
        <div class="${timeColor} font-semibold">${timeRemainingText}</div>
        <div class="text-white/70">${setDateTime}</div>
        <div class="flex justify-center items-center space-x-2">
          ${buttonHtml}
          <button class="text-white/60 hover:text-blue-500 meeting-actions-btn" title="More Actions" data-meeting-id="${meeting.id}">
            <i class="fa-solid fa-ellipsis-v"></i>
          </button>
        </div>
      `;
      container.appendChild(row);
    } catch (err) {
      console.error('❌ [renderMeetingsList] failed rendering a meeting', meeting, err);
    }
  });

 // Attach reminder button listeners
  container.querySelectorAll('.remind-meeting-btn[data-meeting-id]').forEach(btn => {
    btn.removeEventListener('click', btn._meetingHandler); // avoid duplicates
    const handler = (e) => {
      const id = parseInt(e.currentTarget.dataset.meetingId, 10);
      console.log('🟦 [remind click] meetingId=', id);
      handleMeetingReminderClick(id);
    };
    btn._meetingHandler = handler;
    btn.addEventListener('click', handler);
  });

  // Attach three-dots handlers for meetings
  attachMeetingActionsHandlers();

  console.log('🟦 [renderMeetingsList] complete');
}

// -------------------------------------------------------------------
// MEETING ACTIONS MENU (three-dots menu for meetings)
function ensureMeetingActionsMenu() {
  let menu = document.getElementById('meeting-actions-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'meeting-actions-menu';
  menu.style.position = 'absolute';
  menu.style.zIndex = 2000;
  menu.style.minWidth = '120px';
  menu.style.background = '#0b1220';
  menu.style.border = '1px solid rgba(255,255,255,0.06)';
  menu.style.borderRadius = '8px';
  menu.style.padding = '6px 0';
  menu.style.boxShadow = '0 6px 18px rgba(3,8,23,0.6)';
  menu.className = 'text-sm text-white';
  menu.innerHTML = `
    <button id="meeting-action-delete" class="w-full text-left px-4 py-2 hover:bg-white/5" style="background: transparent; border: none; color: inherit;">Delete</button>
  `;
  document.body.appendChild(menu);

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!menu.contains(target) && !target.closest('.meeting-actions-btn')) {
      menu.style.display = 'none';
      menu.dataset.meetingId = '';
    }
  });
  return menu;
}

function showMeetingMenuForButton(btn) {
  const meetingId = btn.dataset.meetingId;
  const rect = btn.getBoundingClientRect();
  const menu = ensureMeetingActionsMenu();
  menu.style.display = 'block';
  const left = Math.min(window.innerWidth - 140, rect.left);
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  menu.dataset.meetingId = meetingId;

  const delBtn = document.getElementById('meeting-action-delete');
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    const mId = parseInt(menu.dataset.meetingId, 10);
    if (!mId) return;
    if (!confirm('Delete this meeting? This action cannot be undone.')) return;
    try {
      delBtn.disabled = true;
      await deleteMeeting(mId);
      menu.style.display = 'none';
      menu.dataset.meetingId = '';
      document.querySelectorAll(`[data-id="${mId}"]`).forEach(el => el.remove());
      await loadMeetings();
    } catch (err) {
      console.error('❌ Failed to delete meeting', err);
      showInAppAlert('Failed to delete meeting — see console.');
    } finally {
      delBtn.disabled = false;
    }
  };
}

function attachMeetingActionsHandlers() {
  const container = document.getElementById('meetings-list-container');
  if (!container) return;
  container.querySelectorAll('.meeting-actions-btn').forEach(btn => {
    if (btn.dataset.listenerAttached) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showMeetingMenuForButton(e.currentTarget);
    });
    btn.dataset.listenerAttached = 'true';
  });
}

// Delete meeting helper
async function deleteMeeting(id) {
  try {
    const { error } = await client.from('meetings').delete().eq('id', id).eq('business_id', BUSINESS_ID);
    if (error) throw error;
    logStep('Meeting deleted', id);
    await loadMeetings();
  } catch (err) {
    console.error('❌ deleteMeeting error', err);
    throw err;
  }
}

function updateCalendarTitle(date) {
  try {
    const title = document.getElementById('calendar-title');
    if (!title) { console.warn('⚠️ [updateCalendarTitle] #calendar-title not found'); return; }
    if (!(date instanceof Date)) date = new Date(date);
    const monthName = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear();
    title.textContent = `Meetings for ${monthName} ${year}`;
    console.log(`🟦 [updateCalendarTitle] set to: ${title.textContent}`);
    // Also update modal calendar title if present
    const modalTitle = document.getElementById('add-meeting-calendar-title');
    if (modalTitle) modalTitle.textContent = `${monthName} ${year}`;
  } catch (err) {
    console.error('❌ [updateCalendarTitle] error', err);
  }
}
// ---------------- CALENDAR ----------------

function createCalendarDayElement(day, dateString = null, dayData = null, isToday = false) {
  const dayEl = document.createElement('div');
  if (!day) {
    dayEl.className = 'day-square text-white/50 pt-2 h-16 border border-border-dark rounded-lg cursor-default';
    dayEl.textContent = '';
    return dayEl;
  }

  // Base style + relative for badge positioning
  let dayClass = 'text-white pt-2 h-16 border border-border-dark rounded-lg cursor-pointer relative';
  let badgeHtml = '';

  // ✅ Add badge for days that have meetings
  if (dayData && dayData.hasMeeting) {
    // visually distinct dot in top-right corner
    badgeHtml = `
      <div class="absolute top-1 right-1 w-2.5 h-2.5 rounded-full ${
        dayData.isPast ? 'bg-gray-500' : 'bg-main-purple'
      }" aria-hidden="true"></div>
    `;
    dayClass += dayData.isPast ? ' past-meeting-day' : ' upcoming-meeting-day';
  }

  // ✅ Highlight today with ring
  if (isToday) dayClass += ' ring-2 ring-blue-400 today-day';

  dayEl.className = `day-square ${dayClass}`;
  dayEl.setAttribute('data-date', dateString || getLocalDateString(new Date()));

  // ✅ Keep your existing text span and structure
  dayEl.innerHTML = `<span class="block pt-2 text-center">${day}</span>${badgeHtml}`;

  // Determine if this day is in the past (by date only)
  const todayStr = getLocalDateString(new Date());
  const isPast = (() => {
    try {
      const d = dateString || getLocalDateString(new Date());
      return d < todayStr;
    } catch (e) { return false; }
  })();

  if (isPast) {
    // make it visually disabled
    dayEl.classList.add('past-day');
    dayEl.style.cursor = 'default';
  }

  // ✅ Keep your click listener logic but guard against past days
  dayEl.addEventListener('click', (e) => {
    if (isPast) return; // do nothing for past days
    const ds = e.currentTarget.dataset.date;
    console.log('🟦 [calendar day click] date attr:', ds);
    // Ensure consistent ISO date string (YYYY-MM-DD)
    const normalized = getLocalDateString(ds) || ds;

    // If this day element is inside the Add Meeting modal calendar, render time slots in the modal
    const modalCal = document.getElementById('add-meeting-calendar');
    const inModal = modalCal && modalCal.contains(e.currentTarget);

    if (inModal) {
      // Render times in the modal's right-hand area
      renderTimeGridForDate(normalized);
      // Update the small title inside the modal (if present)
      const step2 = document.getElementById('meeting-step-2');
      if (step2) {
        const stepTitle = step2.querySelector('#daily-meetings-title');
        if (stepTitle) stepTitle.textContent = formatDate(normalized);
      }
    } else if (isMobile()) {
      // Mobile modal
      showDayDetailsModal(e.currentTarget);
    } else {
      // Desktop panel
      updateSchedulePanel(normalized);
    }

    // Toggle selected classes visually
    document.querySelectorAll('.day-square').forEach(el => el.classList.remove('selected-day'));
    e.currentTarget.classList.add('selected-day');
  });

  return dayEl;
}


function renderSingleMonth(monthDate, scrollContainer) {
  try {
    const monthIndex = monthDate.getMonth();
    const year = monthDate.getFullYear();
    const today = new Date();
    const todayString = getLocalDateString(today);

  // Use Monday-first layout: convert JS Sunday(0)-Saturday(6) to Monday-first index
  const rawFirst = new Date(year, monthIndex, 1).getDay();
  const firstDayOfMonth = (rawFirst + 6) % 7; // 0=Mon, ..., 6=Sun
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    // Build map of meeting dates for this month
    const meetingDates = (meetingsData || []).reduce((acc, m) => {
      const key = getLocalDateString(m.setDate || m.start_at || m.raw?.start_at);
      if (!key) return acc;
      const dateObj = new Date(key);
      if (dateObj.getMonth() === monthIndex && dateObj.getFullYear() === year) {
        acc[key] = { isPast: (new Date(key) < today), hasMeeting: true };
      }
      return acc;
    }, {});

  const monthView = document.createElement('div');
    monthView.className = 'month-view-container';
    // Create header row (Mon..Sun)
    const headerRow = document.createElement('div');
    headerRow.className = 'day-grid text-center text-sm font-medium day-names-row';
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(dn => {
      const h = document.createElement('div');
      h.className = 'text-white/70';
      h.textContent = dn;
      headerRow.appendChild(h);
    });

    const dayGrid = document.createElement('div');
    dayGrid.className = 'day-grid text-center text-sm font-medium';
    dayGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';

    // append header and padding
    monthView.appendChild(headerRow);
    // padding (empty squares to align first day under correct weekday)
    for (let i = 0; i < firstDayOfMonth; i++) {
      dayGrid.appendChild(createCalendarDayElement(null));
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const fullDate = new Date(year, monthIndex, day);
      const dateString = getLocalDateString(fullDate);
      const isToday = dateString === todayString;
      const dayData = meetingDates[dateString];
      const dayEl = createCalendarDayElement(day, dateString, dayData, isToday);
      dayGrid.appendChild(dayEl);
    }

  monthView.appendChild(dayGrid);
    scrollContainer.appendChild(monthView);
    console.log(`🟦 [renderSingleMonth] rendered month ${monthDate.toLocaleString('en-US', { month: 'short' })} ${year}`);
  } catch (err) {
    console.error('❌ [renderSingleMonth] error', err);
  }
}

function renderMeetingsCalendar() {
  console.log('🟦 [renderMeetingsCalendar] starting — meetingsData length:', (meetingsData || []).length);
  // Prefer the main calendar container first so the Meetings page shows the full
  // months scroll/calendar. Fall back to the Add Meeting modal container (step 2)
  // if the main container isn't present (ensures modal still works).
  let scrollContainer = document.getElementById('calendar-months-scroll-container') || document.getElementById('add-meeting-calendar');
  if (!scrollContainer) {
    console.error('🛑 [renderMeetingsCalendar] calendar container not found');
    return;
  }
  scrollContainer.innerHTML = '';

  const monthRange = 3;
  const initialMonth = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() - monthRange, 1);

  for (let i = 0; i < monthRange * 2 + 1; i++) {
    const d = new Date(initialMonth);
    d.setMonth(d.getMonth() + i);
    renderSingleMonth(d, scrollContainer);
  }

  // scroll handler
  const handleScroll = debounce(() => {
    try {
      const clientWidth = scrollContainer.clientWidth || 1;
      const scrollLeft = scrollContainer.scrollLeft || 0;
      const centeredMonthIndex = Math.round(scrollLeft / clientWidth);
      const newMonthDate = new Date(initialMonth);
      newMonthDate.setMonth(newMonthDate.getMonth() + centeredMonthIndex);
      updateCalendarTitle(newMonthDate);
    } catch (err) { console.error('❌ [calendar scroll] error', err); }
  }, 150);

  scrollContainer.removeEventListener('scroll', scrollContainer._scrollHandler);
  scrollContainer._scrollHandler = handleScroll;
  scrollContainer.addEventListener('scroll', scrollContainer._scrollHandler);

  // initial positioning to center month
  setTimeout(() => {
    try {
      scrollContainer.scrollLeft = monthRange * (scrollContainer.clientWidth || 0);
      updateCalendarTitle(currentCalendarDate);
      // Attach click listeners once DOM is stable
      attachCalendarDayListeners();
    } catch (e) { console.warn('Failed to position calendar scroll', e); }
  }, 60);

  // Wire left/right arrows (modal step 2) if present
  try {
    const prevBtn = document.getElementById('add-cal-prev');
    const nextBtn = document.getElementById('add-cal-next');
    if (prevBtn && nextBtn) {
      prevBtn.onclick = () => {
        try { scrollContainer.scrollBy({ left: -(scrollContainer.clientWidth || 300), behavior: 'smooth' }); } catch (e) {}
      };
      nextBtn.onclick = () => {
        try { scrollContainer.scrollBy({ left: (scrollContainer.clientWidth || 300), behavior: 'smooth' }); } catch (e) {}
      };
    }
  } catch (e) { /* ignore */ }

  // Also render the daily schedule for today by default (use updateSchedulePanel)
  const todayLocal = getLocalDateString(new Date()); 
   if (todayLocal && typeof updateSchedulePanel === 'function') {
    updateSchedulePanel(todayLocal);
  }
  console.log('🟦 [renderMeetingsCalendar] complete');
}

// Fallback calendar renderer specifically for the Add Meeting modal (Step 2).
// Mirrors the main renderMeetingsCalendar logic but targets the step-2 container
// and is slightly more defensive about sizing and attachment.
function renderStep2Calendar() {
  console.log('🟦 [renderStep2Calendar] starting fallback renderer');
  const scrollContainer = document.getElementById('add-meeting-calendar') || document.getElementById('calendar-months-scroll-container');
  if (!scrollContainer) {
    console.error('🛑 [renderStep2Calendar] calendar container (#add-meeting-calendar or #calendar-months-scroll-container) not found');
    return;
  }
  try {
    scrollContainer.innerHTML = '';
    const monthRange = 3;
    const initialMonth = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() - monthRange, 1);

    for (let i = 0; i < monthRange * 2 + 1; i++) {
      const d = new Date(initialMonth);
      d.setMonth(d.getMonth() + i);
      renderSingleMonth(d, scrollContainer);
    }

    const handleScroll = debounce(() => {
      try {
        const clientWidth = scrollContainer.clientWidth || 1;
        const scrollLeft = scrollContainer.scrollLeft || 0;
        const centeredMonthIndex = Math.round(scrollLeft / clientWidth);
        const newMonthDate = new Date(initialMonth);
        newMonthDate.setMonth(newMonthDate.getMonth() + centeredMonthIndex);
        updateCalendarTitle(newMonthDate);
      } catch (err) { console.error('❌ [step2 calendar scroll] error', err); }
    }, 150);

    scrollContainer.removeEventListener('scroll', scrollContainer._step2ScrollHandler);
    scrollContainer._step2ScrollHandler = handleScroll;
    scrollContainer.addEventListener('scroll', scrollContainer._step2ScrollHandler);

    // center the current month after a short delay so sizing stabilizes
    setTimeout(() => {
      scrollContainer.scrollLeft = monthRange * (scrollContainer.clientWidth || 0);
      updateCalendarTitle(currentCalendarDate);
      attachCalendarDayListeners();
    }, 80);

    // render today's panel
    const todayLocal = getLocalDateString(new Date());
    if (todayLocal && typeof updateSchedulePanel === 'function') updateSchedulePanel(todayLocal);
    console.log('🟦 [renderStep2Calendar] complete');
  } catch (err) {
    console.error('❌ [renderStep2Calendar] error', err);
  }
}

function handleEmptyHourClick(dateString, hour) {
  console.log("🟦 [handleEmptyHourClick] opening add meeting modal for", dateString, "hour", hour);
  openModal('add-meeting-modal');

  // Prefill date & time inputs
  const dateInput = document.getElementById('new-meeting-date');
  const timeInput = document.getElementById('new-meeting-time');
  if (dateInput) dateInput.value = dateString;
  if (timeInput) timeInput.value = `${hour.toString().padStart(2, '0')}:00`;

  // Reset other fields
  // Reset other fields safely
const contactSearchInput = document.getElementById('new-meeting-contact-search');
const agendaInput = document.getElementById('new-meeting-agenda');

if (contactSearchInput) contactSearchInput.value = '';
if (agendaInput) agendaInput.value = '';

  // Re-init contact search (from your crm.js)
  if (typeof initMeetingContactSearch === 'function') {
    initMeetingContactSearch();
  }
}
// -------------------------------------------------------------------
// MEETING REMINDER MODAL HANDLERS (NEW)
// -------------------------------------------------------------------

function handleMeetingReminderClick(meetingId) {
  console.log('🟦 [handleMeetingReminderClick] called for ID:', meetingId);
  selectedMeeting = meetingsData.find(m => m.id === meetingId);
  if (!selectedMeeting) {
    console.warn('⚠️ Meeting not found for id', meetingId, 'meetingsData length', (meetingsData || []).length);
    return;
  }

  const meeting = selectedMeeting;
  const modal = document.getElementById('meeting-reminder-modal');
  if (!modal) return console.error('🛑 Modal not found!');

  // Format fields
  const rawDateVal = meeting.setDate || meeting.start_at || meeting.raw?.start_at || meeting.raw?.setDate || null;
  let dateFormatted = '—';
  try {
    dateFormatted = rawDateVal ? new Date(rawDateVal).toLocaleString() : '—';
  } catch (e) { console.warn('⚠️ date parse failed', rawDateVal, e); }
  const timeRemaining = getTimeRemaining(rawDateVal);

  // Populate modal fields
  // Prefer getElementById to be robust against structure changes
  const titleEl = document.getElementById('meeting-modal-title');
  const dateEl = document.getElementById('meeting-modal-time');
  const contactNameEl = document.getElementById('meeting-modal-contact-name');
  const dealNameEl = document.getElementById('meeting-modal-deal-name');
  const notesEl = document.getElementById('meeting-modal-notes');

  // Log what we're about to populate for debugging
  console.log('🟦 [handleMeetingReminderClick] meeting object:', meeting);
  if (!titleEl) console.warn('⚠️ meeting modal title element not found');
  if (!dateEl) console.warn('⚠️ meeting modal date element not found');
  if (!contactNameEl) console.warn('⚠️ meeting modal contact name element not found');
  if (!dealNameEl) console.warn('⚠️ meeting modal deal name element not found');
  if (!notesEl) console.warn('⚠️ meeting modal notes element not found');

  if (titleEl) titleEl.textContent = `Meeting with ${meeting.contactName || meeting.raw?.contacts?.name || 'N/A'}`;
  if (dateEl) dateEl.textContent = dateFormatted || '—';
  if (contactNameEl) {
    contactNameEl.textContent = meeting.contactName || meeting.raw?.contacts?.name || 'No contact';
    if (meeting.contactId) contactNameEl.dataset.contactId = meeting.contactId;
  }
  if (dealNameEl) {
    const dealName = meeting.raw?.deal_name || meeting.raw?.deal?.name || meeting.raw?.deal || 'Associated Deal';
    const dealId = meeting.raw?.deal_id || meeting.raw?.deal?.id || '';
    dealNameEl.textContent = dealName;
    if (dealId) dealNameEl.dataset.dealId = dealId;
  }
  if (notesEl) notesEl.value = meeting.contactNotes || meeting.notes || meeting.raw?.details || '';

  console.log('✅ [handleMeetingReminderClick] Populated Meeting Modal:', {
    contact: meeting.contactName,
    date: dateFormatted,
    agenda: meeting.agenda,
    remaining: timeRemaining?.text
  });

  // Open the modal (small timeout to ensure DOM updates are painted)
  setTimeout(() => openModal('meeting-reminder-modal'), 20);
}

function handleMeetingCallClick() {
  if (!selectedMeeting) return console.warn('⚠️ No meeting selected for call');

  const meeting = selectedMeeting;
  console.log('📞 [handleMeetingCallClick] Contact:', meeting.contactName, meeting.contactPhone);

  // Grab the Call Log modal
  const callModal = document.getElementById('call-log-modal');
  if (!callModal) return console.error('🛑 Call log modal not found!');

  // Populate modal fields
  const nameEl = callModal.querySelector('#call-contact-name');
  const phoneEl = callModal.querySelector('#call-contact-phone');
  const notesEl = callModal.querySelector('#call-notes');

  if (nameEl) nameEl.textContent = meeting.contactName || 'Unknown Contact';
  if (phoneEl) phoneEl.textContent = meeting.contactPhone || 'N/A';
  if (notesEl) notesEl.value = `Follow-up regarding meeting: ${meeting.agenda || 'General Discussion'}`;

  // Close current and open call modal
  closeModal('meeting-reminder-modal');
  openModal('call-log-modal');

  console.log('✅ [handleMeetingCallClick] Opened call-log-modal with contact:', meeting.contactName);
}


function handleMeetingWhatsAppClick() {
  if (!selectedMeeting) {
    console.warn('⚠️ No selected meeting found for WhatsApp reminder.');
    return;
  }
// ✅ Set AI Messaging Context
  window.currentWhatsAppContext = {
    type: "meeting-reminder",
    business_id: BUSINESS_ID,
    contact_id: selectedMeeting.contact_id,
    contact_name: selectedMeeting.contactName,
    extra: {
      meeting_id: selectedMeeting.id,
      agenda: selectedMeeting.agenda,
      start_at: selectedMeeting.setDate
    }
  };
  const meeting = selectedMeeting;
  const { text: timeRemainingText } = getTimeRemaining(meeting.setDate);

  // Format readable meeting date/time
  const friendlyDate = new Date(meeting.setDate).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  

  // Locate WhatsApp modal
  const whatsappModal = document.getElementById('whatsapp-reminder-modal');
  if (!whatsappModal) {
    console.error('🛑 WhatsApp Reminder Modal not found!');
    return;
  }

  // Populate modal fields
  const toField = whatsappModal.querySelector('#reminder-whatsapp-to');
  const subjectField = whatsappModal.querySelector('#reminder-whatsapp-subject');
  const bodyField = whatsappModal.querySelector('#reminder-whatsapp-message-body');

  if (toField) toField.value = meeting.contactPhone || 'N/A';
  if (subjectField) subjectField.value = 'Meeting Reminder';
  if (bodyField) bodyField.value = message;

  // Close the meeting reminder modal before showing WhatsApp
  closeModal('meeting-reminder-modal');

  // Wait for animations/DOM to settle before opening WhatsApp modal
  setTimeout(() => {
    openModal('whatsapp-reminder-modal');
    console.log('✅ [handleMeetingWhatsAppClick] Opened WhatsApp Reminder Modal for:', meeting.contactName);
  }, 250);
}

function handleLogReminderClick() {
    const outcome = document.getElementById('meeting-call-outcome')?.value;
    const notes = document.getElementById('meeting-call-notes')?.value;
    console.log(`[Meeting] Reminder Logged: Outcome - ${outcome}, Notes: ${notes}, Meeting ID: ${selectedMeeting?.id}`);
    
    // In a real scenario, you'd log this interaction/activity
    
    selectedMeeting = null;
    closeModal('meeting-call-log-modal');
}

function handleSendReminderWhatsAppClick() {
    const to = document.getElementById('reminder-whatsapp-to')?.value;
    const message = document.getElementById('reminder-whatsapp-message-body')?.value;
    console.log(`[Meeting] WhatsApp Reminder Sent to ${to}. Message: ${message}, Meeting ID: ${selectedMeeting?.id}`);
    
    // In a real scenario, you'd trigger a WhatsApp API call or open the WhatsApp link here.
    
    selectedMeeting = null;
    closeModal('whatsapp-reminder-modal');
}

function handleAIReminderAssist() {
    if (!selectedMeeting) return;
    const meeting = selectedMeeting;
    const currentMessage = document.getElementById('reminder-whatsapp-message-body')?.value;
    
    // AI enhancement logic as instructed (just prepending the AI text)
    const enhancedMessage = `[AI Enhanced] ${currentMessage}\n\nWe look forward to discussing the agenda of ${meeting.agenda.toLowerCase()}. Please confirm your availability.`;
    
    document.getElementById('reminder-whatsapp-message-body') && (document.getElementById('reminder-whatsapp-message-body').value = enhancedMessage);
    console.log('AI Enhanced Reminder Message');
}

// --- Meeting Reminder Modal Buttons ---
document.addEventListener('DOMContentLoaded', () => {
  const callBtn = document.getElementById('meeting-reminder-call-btn');
  const whatsappBtn = document.getElementById('meeting-reminder-whatsapp-btn');

  if (callBtn) {
    callBtn.addEventListener('click', () => handleMeetingCallClick());
  }

  if (whatsappBtn) {
    whatsappBtn.addEventListener('click', () => handleMeetingWhatsAppClick());
  }
});

// -------------------------------------------------------------------
// EVENT ATTACHMENT (wire up all UI controls)
function attachEventListeners() {
  // tabs
  document.querySelectorAll('.tab-button[data-section]').forEach(button => {
    button.addEventListener('click', (e) => switchSection(e.currentTarget.dataset.section));
  });
  // deals view switch
  document.querySelectorAll('.view-switch-btn[data-view]').forEach(button => {
    button.addEventListener('click', (e) => switchDealsView(e.currentTarget.dataset.view));
  });
  // NEW: meetings view switch
  document.querySelectorAll('.meeting-view-switch-btn[data-view]').forEach(button => {
    button.addEventListener('click', (e) => switchMeetingsView(e.currentTarget.dataset.view));
  });
  // drop zone drawer
  document.getElementById('lost-drop-zone')?.addEventListener('click', () => toggleDropZoneDrawer('Lost'));
  document.getElementById('unqualified-drop-zone')?.addEventListener('click', () => toggleDropZoneDrawer('Unqualified'));
  // hamburger menu toggle
  document.getElementById('hamburger-btn')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-backdrop')?.addEventListener('click', closeSidebar);
  // add button (Original)
  document.getElementById('add-new-btn')?.addEventListener('click', openAddModal);
  // Sidebar settings button (bottom of sidebar)
  const settingsBtn = document.getElementById('sidebar-settings-btn');
  const settingsMenu = document.getElementById('sidebar-settings-menu');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { settingsMenu && settingsMenu.classList.toggle('hidden'); } catch (err) { /* ignore */ }
    });
  }
  // Close settings menu when clicking outside
  try {
    if (settingsMenu && !settingsMenu._closeHandlerAttached) {
      const _docHandler = (ev) => {
        if (!settingsMenu.contains(ev.target) && ev.target !== settingsBtn) settingsMenu.classList.add('hidden');
      };
      document.addEventListener('click', _docHandler);
      // allow ESC to close
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') settingsMenu.classList.add('hidden'); });
      settingsMenu._closeHandlerAttached = true;
    }
  } catch (e) { /* ignore */ }
  // Delegated fallback: ensure clicks on the Settings -> Schedules item open schedules modal
  // Schedules feature disabled: clicks on the sidebar schedules item no longer open the modal.
  // (Previously there was a delegated click handler here.)
  // NEW: New Meeting button
  document.getElementById('new-meeting-btn')?.addEventListener('click', () => {
    // Ensure any other modals (like schedules) are hidden to avoid overlap
    try { console.debug('[schedules] hiding schedules modal before opening meeting'); hideSchedulesModal(); } catch (e) { console.debug('[schedules] hideSchedulesModal failed', e); }
    openModal('add-meeting-modal');
    // Set default date/time to now
    const now = new Date();
    document.getElementById('new-meeting-date').value = now.toISOString().slice(0, 10);
    document.getElementById('new-meeting-time').value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    initMeetingContactSearch();
  });
  // add modal menu switch
  document.querySelectorAll('.add-form-menu-item').forEach(item => item.addEventListener('click', (e) => switchAddForm(e.currentTarget.dataset.form)));
  // add form submits
  document.getElementById('add-contact-form')?.addEventListener('submit', addContact);
  document.getElementById('add-deal-form')?.addEventListener('submit', createDeal);
  document.getElementById('add-follow-up-form')?.addEventListener('submit', createFollowUp);
  // Business Profile: open from sidebar and form submit
  document.getElementById('sidebar-business-profile')?.addEventListener('click', (e) => {
    e.preventDefault();
    // close sidebar then open modal so modal sits above
    try { closeSidebar(); } catch (err) {}
    openBusinessProfileModal();
  });
  // Follow-Up Schedules item intentionally left inactive. No direct click handler attached.
  document.getElementById('business-profile-form')?.addEventListener('submit', saveBusinessProfile);
  // Cancel with unsaved changes guard
  const bpCancel = document.getElementById('bp-cancel-btn');
  if (bpCancel && !bpCancel._handlerAttached) {
    bpCancel.addEventListener('click', (ev) => {
      try {
        if (isBusinessProfileDirty()) {
          // show confirm modal
          openModal('business-profile-confirm-modal');
        } else {
          // no changes, close immediately
          closeModal('business-profile-modal');
        }
      } catch (e) { closeModal('business-profile-modal'); }
    });
    bpCancel._handlerAttached = true;
  }
  // Confirm modal buttons
  document.getElementById('bp-discard-btn')?.addEventListener('click', () => {
    // discard: reset to snapshot and close modals
    resetBusinessProfileToSnapshot();
    closeModal('business-profile-confirm-modal');
    closeModal('business-profile-modal');
  });
  document.getElementById('bp-confirm-save-btn')?.addEventListener('click', async () => {
    // save then close both modals
    try {
      await saveBusinessProfile();
      closeModal('business-profile-confirm-modal');
      closeModal('business-profile-modal');
    } catch (e) {
      // saveBusinessProfile shows alerts on error
      closeModal('business-profile-confirm-modal');
    }
  });
  // NEW: Add Meeting Form submit
  document.getElementById('add-meeting-form')?.addEventListener('submit', scheduleMeeting);
  // nested-add actions (Original)
  document.getElementById('deal-add-contact-btn')?.addEventListener('click', () => { formOrigin = 'deal'; switchAddForm('contact'); });
  document.getElementById('follow-up-new-deal-btn')?.addEventListener('click', () => { formOrigin = 'follow-up'; switchAddForm('deal'); });
  // NEW: When user clicks Add (from meeting modal) open Add Contact modal on top
  document.getElementById('meeting-add-contact-btn')?.addEventListener('click', () => {
    // Mark origin so addContact knows to return to the meeting modal
    formOrigin = 'meeting';
    // Open the Add modal directly to Contact form
    openModal('add-main-modal', 'contact');
    // Ensure add-main-modal appears above the meeting modal (meeting modal uses very high z-index)
    const addModal = document.getElementById('add-main-modal');
    if (addModal) addModal.style.zIndex = 10010;
  });
  document.getElementById('nested-meeting-contact-submit-btn')?.addEventListener('click', createAndSelectMeetingContact);

  // modal close controls
  document.querySelectorAll('[data-modal-close]').forEach(btn => btn.addEventListener('click', (e)=> closeModal(e.currentTarget.dataset.modalClose)));

  // Ensure schedules interactions are available if modal already present in DOM
  // (this is safe to call multiple times)
  try { initSchedulesModalInteractions(); } catch (e) { /* ignore */ }
  
  // call / whatsapp actions in follow-up modal (Original)
  document.getElementById('call-btn')?.addEventListener('click', () => {
    if (!selectedFollowUp) return;
    // ... original call log prep ...
  const callContactText = `${selectedFollowUp.contactName || selectedFollowUp.name || '(unknown)'} (${selectedFollowUp.contactPhone || selectedFollowUp.phone || ''})`;
  document.getElementById('call-log-contact') && (document.getElementById('call-log-contact').textContent = `Logging call for: ${callContactText}`);
    closeModal('follow-up-modal');
    openModal('call-log-modal');
  });
  document.getElementById('whatsapp-btn')?.addEventListener('click', () => {
  if (!selectedFollowUp) return;

  // ✅ AI Context for Follow-Up
  window.currentWhatsAppContext = {
    type: "followup",
    business_id: BUSINESS_ID || null,
    contact_id: selectedFollowUp.contactId || selectedFollowUp.id || null,
    contact_name: selectedFollowUp.contactName || selectedFollowUp.name || '',
    extra: {
      followup_id: selectedFollowUp.id,
      related_to: selectedFollowUp.type || selectedFollowUp.source || '',
      last_interaction: selectedFollowUp.lastUpdate || null,
      deal_stage: selectedFollowUp.stage || null
    }
  };
document.getElementById('ai-assist-btn')?.addEventListener('click', async () => {
  await handleAIWhatsAppAssist();
});

  // ✅ Pre-fill WhatsApp modal (existing code preserved)
  const waTo = document.getElementById('whatsapp-to');
  const waMsg = document.getElementById('whatsapp-message-body');
  const modalNotes = document.getElementById('modal-notes')?.value;

  if (waTo) waTo.value = selectedFollowUp.contactPhone || selectedFollowUp.phone || '';
  // Do NOT populate the WhatsApp message body with the saved notes. The WhatsApp
  // message box is a temporary draft the user composes; it should not overwrite
  // or replace the persistent notes on the deal/contact. Instead show the saved
  // notes in the WhatsApp modal notes display area and keep the message box empty
  // (draft will be lost when the modal closes).
  if (waMsg) waMsg.value = '';
  // Show the saved notes (read-only) inside the WhatsApp modal so user can reference them
  updateWhatsAppNotesDisplay(modalNotes || '');

  closeModal('follow-up-modal');
  openModal('whatsapp-modal');
});

  // ---------- Replace existing handlers for final Call and WhatsApp send ----------

// Final Call button: save call_log + followup_feedback, then complete follow-up
document.getElementById('log-call-btn')?.addEventListener('click', async () => {
  try {
    const outcome = document.getElementById('call-outcome')?.value || '';
    const notes = document.getElementById('call-notes')?.value || '';

    // Prefer selectedFollowUp context, fall back to contact modal action context
    const ctx = selectedFollowUp || selectedContactAction || {};
    const contactId = ctx?.contactId || ctx?.contact_id || null;
    const contactPhone = ctx?.contactPhone || ctx?.phone || '';
    const contactName = ctx?.contactName || ctx?.name || '';
    const dealId = ctx?.deal_id || ctx?.dealId || null;
    const followUpId = ctx?.followup_id || ctx?.followUpId || ctx?.id || null;

    // 1) Insert into call_logs
    try {
      const callPayload = {
        business_id: BUSINESS_ID,
        contact_id: contactId,
        deal_id: dealId,
        call_direction: 'outbound',
        call_start: new Date().toISOString(),
        call_end: new Date().toISOString(),
        duration_seconds: null,
        call_summary: notes || null,
        call_outcome: outcome || null,
        created_at: new Date().toISOString()
      };
      const { data: callData, error: callErr } = await client.from('call_logs').insert([callPayload]).select().single();
      if (callErr) console.warn('call_logs insert warning', callErr);
    } catch (e) {
      console.warn('call_logs insert failed (non-fatal)', e);
    }

    // 2) Insert feedback entry (call)
    try {
      const fbPayload = {
        business_id: BUSINESS_ID,
        contact_id: contactId,
        deal_id: dealId,
        feedback_type: 'call',
        feedback_stage: '1',
        feedback_notes: notes || '',
        created_at: new Date().toISOString(),
        ...(followUpId ? { followup_id: followUpId } : {})
      };
      console.debug('[DEBUG] inserting followup_feedback (call) payload', fbPayload);
      const { data, error } = await client.from('followup_feedback').insert([fbPayload]).select().single();
      if (error) throw error;
      console.log('[DEBUG] followup_feedback (call) inserted', data);
    } catch (e) {
      console.error('❌ followup_feedback insert (call) failed', e);
      showInAppAlert('Failed to save call feedback — check console.');
    }

    // 3) Mark follow-up complete when this action originated from a follow-up
    if (selectedFollowUp && selectedFollowUp.id) {
      await completeFollowUp(selectedFollowUp.id);
    }

    // Close modals and notify
    closeModal('call-log-modal');
    showInAppAlert('Call logged and feedback saved.');
  } catch (err) {
    console.error('❌ log-call-btn error', err);
    showInAppAlert('Error logging call — see console.');
  }
});

// ===== Helper: normalize Kenyan numbers =====
function normalizeKenyanPhone(raw) {
  if (!raw) return null;
  let n = raw.replace(/[^0-9+]/g, '');

  if (n.startsWith('+254')) return '254' + n.slice(4);
  if (n.startsWith('254')) return n;
  if (n.startsWith('0')) return '254' + n.slice(1);
  if (n.startsWith('7') || n.startsWith('1')) return '254' + n;

  return null;
}

// ===== Helper: fast WhatsApp open system =====
async function openWhatsAppWithFallback(contactPhone, message) {
  const phone = normalizeKenyanPhone(contactPhone);
  if (!phone) {
    showInAppAlert('Invalid phone number.');
    return;
  }

  const encoded = encodeURIComponent(message);

  // --- 1) Fast deep link ---
  try {
    window.location.href = `whatsapp://send?phone=${phone}&text=${encoded}`;
    await new Promise(r => setTimeout(r, 900));
  } catch (e) {
    console.warn('Deep link failed', e);
  }

  // --- 3) Final fallback — copy text ---
  try {
    await navigator.clipboard.writeText(message);
    showInAppAlert('Could not open WhatsApp, message copied.');
  } catch {
    showInAppAlert('WhatsApp failed and clipboard copy failed.');
  }
}

// button handlers //

document.getElementById('send-whatsapp-btn')?.addEventListener('click', async () => {
  try {
    const to = document.getElementById('whatsapp-to')?.value || '';
    const message = document.getElementById('whatsapp-message-body')?.value || '';

    // Prefer selectedFollowUp context, fall back to contact modal action context
    const ctx = selectedFollowUp || selectedContactAction || {};
    const contactPhone = ctx?.contactPhone || ctx?.phone || to || '';
    const contactId = ctx?.contactId || ctx?.contact_id || null;
    const followUpId = ctx?.id || ctx?.followup_id || null;
    const dealId = ctx?.deal_id || ctx?.dealId || null;

    if (!message) {
      showInAppAlert('Please enter a message');
      return;
    }

    // 1) Save feedback to DB
    try {
      const fbPayload = {
        business_id: BUSINESS_ID,
        contact_id: contactId,
        followup_id: followUpId,
        deal_id: dealId,
        feedback_type: 'whatsapp',
        feedback_notes: message,
        created_at: new Date().toISOString()
      };

      console.debug('[DEBUG] inserting followup_feedback (whatsapp) payload', fbPayload);
      const { data, error } = await client.from('followup_feedback').insert([fbPayload]).select().single();
      if (error) throw error;
      console.log('[DEBUG] followup_feedback (whatsapp) inserted', data);

    } catch (e) {
      console.error('❌ followup_feedback insert (whatsapp) failed', e);
      showInAppAlert('Failed to save WhatsApp feedback — check console.');
    }

    // 2) Mark follow-up complete when this action originated from a follow-up
    if (selectedFollowUp && selectedFollowUp.id) {
      await completeFollowUp(selectedFollowUp.id);
    }

    // 3) Open WhatsApp using fast → fallback → copy
    await openWhatsAppWithFallback(contactPhone, message);

    // 4) Close modal and clear draft
    closeModal('whatsapp-modal');
    clearWhatsAppDraft && clearWhatsAppDraft();
    showInAppAlert('WhatsApp message prepared and feedback saved.');

  } catch (err) {
    console.error('❌ send-whatsapp-btn error', err);
    showInAppAlert('Failed to send WhatsApp message — see console.');
  }
});


// Clear draft when modal is canceled
const cancelWaBtn = document.getElementById('cancel-whatsapp-modal');
if (cancelWaBtn) {
  cancelWaBtn.removeEventListener('click', () => {});
  cancelWaBtn.addEventListener('click', () => {
    clearWhatsAppDraft();
  });
}


  // NEW: call / whatsapp actions in MEETING reminder modal
  document.getElementById('reminder-call-btn')?.addEventListener('click', handleReminderCallClick);
  document.getElementById('reminder-whatsapp-btn')?.addEventListener('click', handleReminderWhatsAppClick);
  document.getElementById('log-reminder-btn')?.addEventListener('click', handleLogReminderClick);
  document.getElementById('send-reminder-whatsapp-btn')?.addEventListener('click', handleSendReminderWhatsAppClick);
  document.getElementById('reminder-ai-assist-btn')?.addEventListener('click', handleAIReminderAssist);


  // modal inner click prevention for specific modals if present
  document.getElementById('follow-up-modal-content')?.addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('drop-zone-table-content')?.addEventListener('click', (e) => e.stopPropagation());
}
  document.addEventListener('click', (e) => {
        // We only want this logic to run on mobile
        if (!isMobile()) return;
        const mobileAddToggleBtn = document.getElementById('mobile-add-toggle-btn');
        const mobileAddIcon = document.getElementById('mobile-add-icon');
        
        // If the menu is visible...
        if (mobileAddSubMenu && !mobileAddSubMenu.classList.contains('hidden')) {
            
            // Check if the click target is NOT the button AND NOT inside the menu
            const clickedToggleButton = mobileAddToggleBtn && mobileAddToggleBtn.contains(e.target);
            const clickedInsideMenu = mobileAddSubMenu.contains(e.target);
            
            if (!clickedToggleButton && !clickedInsideMenu) {
                // Apply closing animation
                mobileAddSubMenu.classList.add('opacity-0');
                mobileAddIcon.classList.remove('rotate-45');
                
                // Wait for animation (200ms) before hiding it completely
                setTimeout(() => {
                    mobileAddSubMenu.classList.add('hidden');
                }, 200); 
            }
        }
    });
  // NEW: Handle clicks on the mobile sub-menu buttons to open the specific form directly
document.getElementById('mobile-add-contact-btn')?.addEventListener('click', () => {
  // Close the floating submenu (animation + hide) and reset icon
  const mobileAddIcon = document.getElementById('mobile-add-icon');
  if (mobileAddSubMenu && !mobileAddSubMenu.classList.contains('hidden')) {
    mobileAddSubMenu.classList.add('opacity-0');
    mobileAddIcon?.classList.remove('rotate-45');
    setTimeout(() => mobileAddSubMenu.classList.add('hidden'), 200);
  }
  // Open the add modal directly to the Contact form (use form name expected by switchAddForm)
  openModal('add-main-modal', 'contact');
});

document.getElementById('mobile-add-deal-btn')?.addEventListener('click', () => {
  const mobileAddIcon = document.getElementById('mobile-add-icon');
  if (mobileAddSubMenu && !mobileAddSubMenu.classList.contains('hidden')) {
    mobileAddSubMenu.classList.add('opacity-0');
    mobileAddIcon?.classList.remove('rotate-45');
    setTimeout(() => mobileAddSubMenu.classList.add('hidden'), 200);
  }
  // Open directly to the Deal form
  openModal('add-main-modal', 'deal');
});

document.getElementById('mobile-add-followup-btn')?.addEventListener('click', () => {
  const mobileAddIcon = document.getElementById('mobile-add-icon');
  if (mobileAddSubMenu && !mobileAddSubMenu.classList.contains('hidden')) {
    mobileAddSubMenu.classList.add('opacity-0');
    mobileAddIcon?.classList.remove('rotate-45');
    setTimeout(() => mobileAddSubMenu.classList.add('hidden'), 200);
  }
  // Open directly to the Follow-up form
  openModal('add-main-modal', 'follow-up');
});
const meetingsCalendar = document.getElementById('meetings-calendar-view');
    if (meetingsCalendar) {
        meetingsCalendar.addEventListener('click', (e) => {
            // Check for the dynamically generated day cell class and date attribute
            const dayCell = e.target.closest('.calendar-day-cell'); 
            
            // Validate the click target
            if (dayCell && !dayCell.classList.contains('empty-day') && dayCell.dataset.date) {
                const date = dayCell.dataset.date;

                // 1. Manage active state visual cue
                document.querySelectorAll('.calendar-day-cell').forEach(cell => {
                    cell.classList.remove('bg-main-purple/50', 'ring-2', 'ring-main-purple');
                });
                dayCell.classList.add('bg-main-purple/50', 'ring-2', 'ring-main-purple');
                
                // 2. Decide function based on screen size
                if (isMobile()) {
                    showDayDetailsModal(dayCell); // Opens the modal pop-up (mobile UX)
                } else {
                    updateSchedulePanel(date); // Updates the right-hand panel (desktop UX)
                }
            }
        });
    }

    // Listener to close the Day Details Modal
    document.getElementById('cancel-day-details-modal')?.addEventListener('click', closeDayDetailsModal);
// -------------------------------------------------------------------
// DEALS VIEW SWITCH (REPLACE ENTIRE FUNCTION)
// -------------------------------------------------------------------
function switchDealsView(view) {
    // 1. If it's a mobile device, we only ever want to see the Card View. 
    //    We don't need to switch between 'pipeline' and 'list' views on mobile.
    if (isMobile()) {
        renderDealsMobileCardView(); // Render the new mobile card view
        return; // Exit the function to skip desktop view switching
    }

    // 2. DESKTOP LOGIC (Original behavior for desktops)
    const sel = document.querySelector(`#deals-section .view-switch-btn[data-view="${view}"]`);
    
    // Deactivate all view buttons, then activate the current one
    document.querySelectorAll('#deals-section .view-switch-btn').forEach(btn => btn.classList.remove('active'));
    sel && sel.classList.add('active');

    const desktopView = document.getElementById('deals-desktop-view');
    const pipelineView = document.getElementById('deals-pipeline-view');
    const listView = document.getElementById('deals-list-view');

    // Ensure the main desktop view container is visible
    desktopView && desktopView.classList.remove('hidden');

    // Toggle between Pipeline and List view containers
    if (view === 'pipeline') {
        pipelineView && pipelineView.classList.remove('hidden');
        listView && listView.classList.add('hidden');
        // Re-render the pipeline view after switching
        renderDealsPipeline(); 
    } else {
        pipelineView && pipelineView.classList.add('hidden');
        listView && listView.classList.remove('hidden');
        // Re-render the list view after switching
        renderDealsList(); 
    }
}
// -------------------------------------------------------------------
// crm.js - REPLACEMENT FOR setupRealtime()
function setupRealtime() {
    logStep('Setting up Realtime listeners...');
    
  const handleRealtimeChange = (payload) => {
    // payload.table will be contacts, deals, user_followups, system_followups, etc.
    logStep(`Realtime Update: ${payload.table} (${payload.eventType})`);
    if (payload.table === 'contacts') loadContacts();
    if (payload.table === 'deals') loadDeals();
    // Watch both user_followups and system_followups (view is read-only in many DBs)
    if (payload.table === 'user_followups' || payload.table === 'system_followups' || payload.table === 'followups_today') loadFollowUps();
    if (payload.table === 'meetings') loadMeetings();
  };

    // --- CRITICAL: FILTER BY business_id ---
    // This filter tells Supabase to only send events where the business_id column equals the BUSINESS_ID value.
    const filter = `business_id=eq.${BUSINESS_ID}`;

  client.channel('crm_realtime_channel') // Use a unique channel name
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter }, handleRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deals', filter }, handleRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_followups', filter }, handleRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'system_followups', filter }, handleRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', filter }, handleRealtimeChange)
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') console.log('✅ Realtime subscribed for business ID:', BUSINESS_ID);
            else console.log('Realtime status:', status);
        });
}

// -------------------------------------------------------------------
// SIDEBAR TOGGLE FUNCTIONS (for hamburger menu)
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar.classList.contains('-translate-x-full')) {
    sidebar.classList.remove('-translate-x-full');
    backdrop.classList.remove('hidden');
    // When opening on small screens, pin the settings button to viewport so it isn't hidden by scrolling content
    try {
      const wrapper = document.getElementById('sidebar-settings-wrapper');
      if (wrapper && window.innerWidth < 1024) wrapper.classList.add('mobile-fixed');
    } catch (e) {}
  } else {
    sidebar.classList.add('-translate-x-full');
    backdrop.classList.add('hidden');
    try {
      const wrapper = document.getElementById('sidebar-settings-wrapper');
      if (wrapper) wrapper.classList.remove('mobile-fixed');
    } catch (e) {}
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  sidebar.classList.add('-translate-x-full');
  backdrop.classList.add('hidden');
  try {
    const wrapper = document.getElementById('sidebar-settings-wrapper');
    if (wrapper) wrapper.classList.remove('mobile-fixed');
  } catch (e) {}
}

// Keep settings wrapper pinned when resizing or if sidebar is programmatically shown
window.addEventListener('resize', () => {
  try {
    const sidebar = document.getElementById('sidebar');
    const wrapper = document.getElementById('sidebar-settings-wrapper');
    if (!wrapper) return;
    if (window.innerWidth < 1024 && sidebar && !sidebar.classList.contains('-translate-x-full')) wrapper.classList.add('mobile-fixed');
    else wrapper.classList.remove('mobile-fixed');
  } catch (e) {}
});

// Keep deals view consistent with the CSS breakpoint when the window is resized.
// This ensures that if the user loads on desktop then resizes to mobile (or vice versa),
// the correct mobile/desktop deals UI is shown without a full page reload.
(function(){
  let lastWasMobile = isMobile();
  window.addEventListener('resize', debounce(() => {
    try {
      const nowMobile = isMobile();
      if (nowMobile === lastWasMobile) return; // only act on crossing the breakpoint
      lastWasMobile = nowMobile;

      const mobileView = document.getElementById('deals-mobile-view');
      const pipelineView = document.getElementById('deals-pipeline-view');
      const listView = document.getElementById('deals-list-view');

      if (nowMobile) {
        // entering mobile: hide desktop containers and show mobile container
        pipelineView && pipelineView.classList.add('hidden');
        listView && listView.classList.add('hidden');
        mobileView && mobileView.classList.remove('hidden');
        // render mobile cards (safe-guarded)
        try { renderDealsMobileCardView(); } catch (err) { /* fallback: loadDeals will handle it later */ }
      } else {
        // entering desktop: hide mobile container and show the selected desktop view
        mobileView && mobileView.classList.add('hidden');
        if (currentDealsView === 'pipeline') {
          pipelineView && pipelineView.classList.remove('hidden');
          listView && listView.classList.add('hidden');
          try { renderDealsPipeline(); } catch (err) { /* ignore */ }
        } else {
          listView && listView.classList.remove('hidden');
          pipelineView && pipelineView.classList.add('hidden');
          try { renderDealsList(); } catch (err) { /* ignore */ }
        }
      }
    } catch (e) { console.debug('[resize->deals] handler error', e); }
  }, 150));
})();

// -------------------------------------------------------------------

// UTIL: open/close modal and section switcher
// UTIL: open/close modal and section switcher
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  if (typeof mobileAddSubMenu === 'function') {
    try { mobileAddSubMenu(false); } catch (err) { console.warn('⚠️ mobileAddSubMenu failed silently:', err); }
  }

  modal.classList.remove('hidden');

  // 🟣 Fade/scale animation
  modal.style.opacity = '0';
  modal.style.transform = 'scale(0.95)';
  modal.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
  requestAnimationFrame(() => {
    modal.style.opacity = '1';
    modal.style.transform = 'scale(1)';
  });

  // zIndex
  if (
    modalId === 'call-log-modal' ||
    modalId === 'whatsapp-modal' ||
    modalId === 'meeting-call-log-modal' ||
    modalId === 'whatsapp-reminder-modal'
  ) {
    modal.style.zIndex = 60;
  } else {
    // Business Profile modal should appear above the sidebar on desktop/tablet
    if (modalId === 'business-profile-modal' && !isMobile()) {
      // Use a higher z-index than the sidebar (sidebar uses z-50 or z-75 in CSS)
      modal.style.zIndex = 110;
    } else {
      modal.style.zIndex = 50;
    }
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  // 🟣 Fade-out animation before hiding
  modal.style.opacity = '0';
  modal.style.transform = 'scale(0.95)';

  setTimeout(() => {
    modal.classList.add('hidden');
    modal.style.transition = '';
    modal.style.opacity = '';
    modal.style.transform = '';
  }, 200);
}
// Function to open the main Add Modal and switch to a specific form
function openModal(modalId, formName = 'contact') {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  // Ensure modal is displayed and visible
  try {
    // Prefer to respect the modal's layout class: if it is a flex container in markup
    // (common for centered backdrops) use 'flex' so centering utilities work.
    if (modal.classList.contains('flex')) modal.style.display = 'flex';
    else modal.style.display = 'block';
    // Ensure the modal is attached to body so it's not constrained by ancestor stacking contexts
    if (modal.parentNode !== document.body) document.body.appendChild(modal);
  } catch (e) {}
  // Show modal container
  modal.classList.remove('hidden');

  // If on mobile, toggle a class that hides the left selector so the form spans the modal
  const addModalContentEl = document.getElementById('add-main-modal-content');
  if (isMobile()) {
    addModalContentEl?.classList.add('mobile-full');
  } else {
    addModalContentEl?.classList.remove('mobile-full');
  }

  // Normalize formName: allow callers to pass 'add-deal' or 'deal'
  let name = (formName || 'contact').toString();
  if (name.startsWith('add-')) name = name.slice(4);

  // Ensure placeholder is hidden and switch to the requested form
  document.getElementById('add-form-placeholder')?.classList.add('hidden');
  try {
    switchAddForm(name);
  } catch (err) {
    console.warn('switchAddForm failed for', name, err);
  }

  // Close the mobile add submenu (if visible) with the same animation used elsewhere
  const mobileAddIcon = document.getElementById('mobile-add-icon');
  if (mobileAddSubMenu && !mobileAddSubMenu.classList.contains('hidden')) {
    mobileAddSubMenu.classList.add('opacity-0');
    mobileAddIcon?.classList.remove('rotate-45');
    setTimeout(() => mobileAddSubMenu.classList.add('hidden'), 200);
  }
}
// crm.js - NEW HELPER FUNCTION
/**
 * Opens a modal for a nested item (Meeting/Follow-up) and sets the FK ID.
 * @param {string} formName - The name of the form ('meeting' or 'follow-up').
 * @param {number} fkId - The ID of the associated item (contact_id or deal_id).
 * @param {string} fkInputId - The ID of the hidden input field in the modal.
 */
function openNestedModal(formName, fkId, fkInputId) {
  if (!fkId || fkId === 0) {
    console.error(`Cannot open nested form: Missing ID for ${formName}.`);
    showInAppAlert(`Error: Cannot open ${formName} form without a valid associated ID.`);
    return;
  }
    
    // 1. Open the main modal and switch to the correct form
    openModal('add-main-modal', 'add-' + formName); 

    // 2. Set the necessary hidden ID
    const fkInput = document.getElementById(fkInputId);
    if (fkInput) {
        fkInput.value = fkId;
        console.log(`FK set: ${fkInputId} set to ID ${fkId}`);
    } else {
        console.error(`Missing input field: ${fkInputId}`);
    }
}
/**
 * Open the Business Profile modal and load existing data for this BUSINESS_ID.
 */
async function openBusinessProfileModal() {
  try {
    // Load existing profile then show modal
    await loadBusinessProfile();
  } catch (e) {
    console.warn('openBusinessProfileModal: failed to load profile', e);
  }
  openModal('business-profile-modal');
}

/**
 * Loads the business_profile row for the current BUSINESS_ID and populates the form inputs.
 */
async function loadBusinessProfile() {
  if (!BUSINESS_ID) return;
  try {
  // Use maybeSingle() to avoid a 406 when no row exists for this business_id
  const { data, error } = await client.from('business_profile').select('*').eq('business_id', BUSINESS_ID).maybeSingle();
    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('No rows')) {
        // no existing profile — that's fine
        return null;
      }
      throw error;
    }
    if (!data) return null;
  // populate fields
    try {
      document.getElementById('bp-business-name') && (document.getElementById('bp-business-name').value = data.business_name || '');
      document.getElementById('bp-industry') && (document.getElementById('bp-industry').value = data.industry || '');
      document.getElementById('bp-location') && (document.getElementById('bp-location').value = data.location || '');
      document.getElementById('bp-tagline') && (document.getElementById('bp-tagline').value = data.tagline || '');
      document.getElementById('bp-short-desc') && (document.getElementById('bp-short-desc').value = data.short_description || '');
      document.getElementById('bp-long-desc') && (document.getElementById('bp-long-desc').value = data.long_description || '');
      document.getElementById('bp-target-audience') && (document.getElementById('bp-target-audience').value = data.target_audience || '');
      document.getElementById('bp-unique-value') && (document.getElementById('bp-unique-value').value = data.unique_value || '');
      document.getElementById('bp-main-offer') && (document.getElementById('bp-main-offer').value = data.main_offer || '');
      document.getElementById('bp-secondary-offers') && (document.getElementById('bp-secondary-offers').value = data.secondary_offers || '');
      document.getElementById('bp-tone-of-voice') && (document.getElementById('bp-tone-of-voice').value = data.tone_of_voice || '');
      // brand_personality removed from UI — skip applying it to any inputs
      // social_links may be json
      const socials = data.social_links || {};
      document.getElementById('bp-website') && (document.getElementById('bp-website').value = socials.website || data.website || '');
      document.getElementById('bp-facebook') && (document.getElementById('bp-facebook').value = socials.facebook || '');
      document.getElementById('bp-instagram') && (document.getElementById('bp-instagram').value = socials.instagram || '');
      document.getElementById('bp-twitter') && (document.getElementById('bp-twitter').value = socials.twitter || '');
    } catch (err) {
      console.warn('loadBusinessProfile: failed to populate fields', err);
    }
    // take a snapshot for change detection
    try {
      businessProfileSnapshot = captureBusinessProfileSnapshot();
    } catch (e) {}
    return data;
  } catch (err) {
    console.error('loadBusinessProfile error', err);
    return null;
  }
}

// snapshot & dirty-check utilities for Business Profile form
let businessProfileSnapshot = null;
function captureBusinessProfileSnapshot() {
  try {
    return {
      business_name: document.getElementById('bp-business-name')?.value || '',
      industry: document.getElementById('bp-industry')?.value || '',
      location: document.getElementById('bp-location')?.value || '',
      tagline: document.getElementById('bp-tagline')?.value || '',
      short_description: document.getElementById('bp-short-desc')?.value || '',
      long_description: document.getElementById('bp-long-desc')?.value || '',
      target_audience: document.getElementById('bp-target-audience')?.value || '',
      unique_value: document.getElementById('bp-unique-value')?.value || '',
      main_offer: document.getElementById('bp-main-offer')?.value || '',
      secondary_offers: document.getElementById('bp-secondary-offers')?.value || '',
      tone_of_voice: document.getElementById('bp-tone-of-voice')?.value || '',
  // brand_personality removed from UI
      website: document.getElementById('bp-website')?.value || '',
      facebook: document.getElementById('bp-facebook')?.value || '',
      instagram: document.getElementById('bp-instagram')?.value || '',
      twitter: document.getElementById('bp-twitter')?.value || '',
    };
  } catch (e) { return null; }
}

function isBusinessProfileDirty() {
  try {
    if (!businessProfileSnapshot) return false;
    const cur = captureBusinessProfileSnapshot();
    // simple deep-compare for primitive values and arrays
    for (const k of Object.keys(businessProfileSnapshot)) {
      const a = businessProfileSnapshot[k];
      const b = cur[k];
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return true;
        const as = a.slice().map(x=>x.toString());
        const bs = b.slice().map(x=>x.toString());
        as.sort(); bs.sort();
        if (as.join('|') !== bs.join('|')) return true;
      } else {
        if ((a||'') !== (b||'')) return true;
      }
    }
    return false;
  } catch (e) { return false; }
}

function resetBusinessProfileToSnapshot() {
  try {
    if (!businessProfileSnapshot) return;
    const s = businessProfileSnapshot;
    document.getElementById('bp-business-name') && (document.getElementById('bp-business-name').value = s.business_name || '');
    document.getElementById('bp-industry') && (document.getElementById('bp-industry').value = s.industry || '');
    document.getElementById('bp-location') && (document.getElementById('bp-location').value = s.location || '');
    document.getElementById('bp-tagline') && (document.getElementById('bp-tagline').value = s.tagline || '');
    document.getElementById('bp-short-desc') && (document.getElementById('bp-short-desc').value = s.short_description || '');
    document.getElementById('bp-long-desc') && (document.getElementById('bp-long-desc').value = s.long_description || '');
    document.getElementById('bp-target-audience') && (document.getElementById('bp-target-audience').value = s.target_audience || '');
    document.getElementById('bp-unique-value') && (document.getElementById('bp-unique-value').value = s.unique_value || '');
    document.getElementById('bp-main-offer') && (document.getElementById('bp-main-offer').value = s.main_offer || '');
    document.getElementById('bp-secondary-offers') && (document.getElementById('bp-secondary-offers').value = s.secondary_offers || '');
    document.getElementById('bp-tone-of-voice') && (document.getElementById('bp-tone-of-voice').value = s.tone_of_voice || '');
  // brand_personality removed from UI — nothing to reset here
    document.getElementById('bp-website') && (document.getElementById('bp-website').value = s.website || '');
    document.getElementById('bp-facebook') && (document.getElementById('bp-facebook').value = s.facebook || '');
    document.getElementById('bp-instagram') && (document.getElementById('bp-instagram').value = s.instagram || '');
    document.getElementById('bp-twitter') && (document.getElementById('bp-twitter').value = s.twitter || '');
  } catch (e) { console.warn('resetBusinessProfileToSnapshot failed', e); }
}

/**
 * Save handler for the Business Profile form. Performs upsert by business_id.
 */
async function saveBusinessProfile(ev) {
  try {
    ev && ev.preventDefault && ev.preventDefault();
    if (!BUSINESS_ID) { showInAppAlert('Missing business context.'); return; }
    const payload = {
      business_id: BUSINESS_ID,
      business_name: document.getElementById('bp-business-name')?.value || null,
      industry: document.getElementById('bp-industry')?.value || null,
      location: document.getElementById('bp-location')?.value || null,
      tagline: document.getElementById('bp-tagline')?.value || null,
      short_description: document.getElementById('bp-short-desc')?.value || null,
      long_description: document.getElementById('bp-long-desc')?.value || null,
      target_audience: document.getElementById('bp-target-audience')?.value || null,
      unique_value: document.getElementById('bp-unique-value')?.value || null,
      main_offer: document.getElementById('bp-main-offer')?.value || null,
      secondary_offers: document.getElementById('bp-secondary-offers')?.value || null,
      tone_of_voice: document.getElementById('bp-tone-of-voice')?.value || null,
      // brand_personality field removed from the form/UI
      social_links: {
        website: document.getElementById('bp-website')?.value || null,
        facebook: document.getElementById('bp-facebook')?.value || null,
        instagram: document.getElementById('bp-instagram')?.value || null,
        twitter: document.getElementById('bp-twitter')?.value || null,
      }
    };

    showTransientNote('Saving...');

    const { data, error } = await client.from('business_profile').upsert([payload], { onConflict: 'business_id' }).select().single();
    if (error) {
      console.error('saveBusinessProfile error', error);
      showInAppAlert('Failed to save Business Profile — check console.');
      hideTransientNote();
      return;
    }
    hideTransientNote();
    showInAppAlert('Business Profile saved.');
    // refresh snapshot to reflect saved state
    try { businessProfileSnapshot = captureBusinessProfileSnapshot(); } catch (e) {}
    // close modal
    closeModal('business-profile-modal');
    return data;
  } catch (err) {
    console.error('saveBusinessProfile caught', err);
    hideTransientNote();
    showInAppAlert('Error saving Business Profile — see console.');
  }
}
function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.classList.add('hidden');
  try { m.style.display = 'none'; } catch (e) {}
  console.log('[DEBUG] closeModal called for', modalId);
}

// -------------------------------------------------------------------
// SECTION SWITCH LOGIC (Final Merged Version)
// -------------------------------------------------------------------
function switchSection(sectionId) {
    // Check for existing section, as your original code didn't use this check at the top.
    // We will trust your original structure.
    
    logStep('Switching section to:', sectionId);

    // 1. Deactivate all Desktop Buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    
    // 2. Deactivate all Mobile Buttons (NEW)
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.removeAttribute('data-active'));
    
    // 3. Hide all sections (using your specific working selector)
    document.querySelectorAll('section[id$="-section"]').forEach(section => section.classList.add('hidden'));
    
    const targetSection = document.getElementById(`${sectionId}-section`);
    
    // Find button matches for activation
    const desktopButton = document.querySelector(`.tab-button[data-section="${sectionId}"]`);
    const mobileButton = document.querySelector(`.mobile-nav-btn[data-section="${sectionId}"]`); // NEW

    if (targetSection) {
        // Activate buttons (Desktop)
        desktopButton && desktopButton.classList.add('active');
        
        // Activate buttons (Mobile) (NEW)
        mobileButton && mobileButton.setAttribute('data-active', 'true');

        // Show the target section
        targetSection.classList.remove('hidden');

    // hide drop zones and any open drop-zone modal when switching to a different section
    // (Previously this only hid them on non-mobile which left the drop-zone UI active
    //  on mobile and caused the unqualified/leads table to capture clicks.)
    if (sectionId !== 'deals') {
      const dz = document.getElementById('hidden-drop-zones');
      dz && dz.classList.add('hidden-zone');
      // also ensure any open drop-zone table modal is closed so its backdrop doesn't block interaction
      const dropModal = document.getElementById('drop-zone-table-modal');
      if (dropModal && !dropModal.classList.contains('hidden')) {
        dropModal.classList.add('hidden');
        // reset openDropZone state so other UI flows don't think a drawer is active
        try { openDropZone = null; } catch (e) { /* ignore if undefined */ }
      }
    }
        
        // Update current section state
        currentSection = sectionId;

        // render relevant section
        if (sectionId === 'contacts') renderContacts(currentPageView);
        else if (sectionId === 'deals') switchDealsView(currentDealsView);
        else if (sectionId === 'follow-ups') renderFollowUps();
    else if (sectionId === 'meetings') switchMeetingsView(currentMeetingsView); // Meetings Section Switch
    else if (sectionId === 'after-sale') loadAfterSale(); // renders after sales section
    }
}
const mobileAddToggleBtn = document.getElementById('mobile-add-toggle-btn');
  const mobileAddIcon = document.getElementById('mobile-add-icon');
  // Defensive assignment: ensure mobileAddSubMenu points to the element even if DOMContentLoaded assignment hasn't run yet
  if (!mobileAddSubMenu) mobileAddSubMenu = document.getElementById('mobile-add-sub-menu');

    // Toggle the floating Add submenu
    mobileAddToggleBtn?.addEventListener('click', () => {
        const isHidden = mobileAddSubMenu.classList.contains('hidden');
        
        // Toggle the submenu visibility and fade animation
        if (isHidden) {
            mobileAddSubMenu.classList.remove('hidden');
            // Force reflow for transition
            void mobileAddSubMenu.offsetWidth; 
            mobileAddSubMenu.classList.remove('opacity-0');
            mobileAddIcon.classList.add('rotate-45'); // Rotate '+' icon
        } else {
            mobileAddSubMenu.classList.add('opacity-0');
            mobileAddIcon.classList.remove('rotate-45');
            // Hide after transition completes (200ms based on CSS)
            setTimeout(() => {
                mobileAddSubMenu.classList.add('hidden');
            }, 200);
        }
    });
  document.querySelectorAll('.mobile-add-item-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const form = e.currentTarget.dataset.form; // Gets 'contact', 'deal', 'follow-up', etc.
            if (form) {
                // Call openModal with the main modal ID and the dynamically created form name.
                openModal('add-main-modal', 'add-' + form); 
            }
        });
    });
    // Handle clicks on the new mobile section buttons (Bottom Bar)
    document.querySelectorAll('.mobile-nav-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const section = e.currentTarget.dataset.section;
            if (section) {
                switchSection(section);
            }
        });
    });
  
    // 🟣 After Sale Modal controls
const afterSaleModal = document.getElementById('after-sale-modal');
const closeAfterSaleModal = document.getElementById('close-after-sale-modal');

    // Small transient helper used to show a quick green note while after-sale data loads
    function showTransientNote(text = 'Just a sec', duration = 0) {
      try {
        // If already present, update text
        let note = document.getElementById('transient-note');
        if (!note) {
          note = document.createElement('div');
          note.id = 'transient-note';
          note.style.position = 'fixed';
          note.style.top = '12px';
          note.style.left = '50%';
          note.style.transform = 'translateX(-50%)';
          note.style.background = '#10B981'; // green
          note.style.color = 'white';
          note.style.padding = '6px 12px';
          note.style.borderRadius = '999px';
          note.style.boxShadow = '0 6px 18px rgba(16,185,129,0.18)';
          note.style.zIndex = '12000';
          note.style.fontSize = '13px';
          note.style.fontWeight = '600';
          note.style.opacity = '0';
          note.style.transition = 'opacity 180ms ease';
          document.body.appendChild(note);
        }
        note.textContent = text;
        // force reflow then fade in
        // eslint-disable-next-line no-unused-expressions
        note.offsetHeight;
        note.style.opacity = '1';

        if (duration && duration > 0) {
          setTimeout(() => {
            try { hideTransientNote(); } catch (e) {}
          }, duration);
        }
      } catch (err) {
        console.warn('showTransientNote error', err);
      }
    }

    function hideTransientNote() {
      try {
        const note = document.getElementById('transient-note');
        if (!note) return;
        note.style.opacity = '0';
        setTimeout(() => {
          if (note && note.parentElement) note.parentElement.removeChild(note);
        }, 220);
      } catch (err) {
        console.warn('hideTransientNote error', err);
      }
    }

// 🟣 Open After Sale Modal + Load Data
// 🟣 Fully live After-Sale popup (Supabase-integrated)
async function openAfterSalePopup(id, name, phone) {
  if (!afterSaleModal) return;
  console.log("🟣 [AfterSalePopup] Opening popup for contact:", id, name);
  // show a quick transient note so the user knows details are being fetched
  try { showTransientNote('Getting details...'); } catch (e) { /* swallow */ }

  try {
    // 🔹 1.  Fetch all after-sale records for this contact
    const { data: sales, error } = await client
      .from("after_sale_view")
      .select("*")
      .eq("business_id", BUSINESS_ID)
      .eq("contact_id", id)
      .order("timestamp", { ascending: false });

    if (error) throw error;
    if (!sales?.length) {
      console.warn("🟡 [AfterSalePopup] No after-sale rows for contact:", id);
    }

    // 🔹 2.  Build purchase history
    const purchaseHistory = sales.flatMap((row) =>
      Array.isArray(row.products)
        ? row.products.map((p) => p.name || JSON.stringify(p))
        : []
    );

    // 🔹 3.  Optionally load referrals & reviews (if separate tables exist)
    const { data: referralsData } = await client
      .from("referrals")
      .select("*")
      .eq("business_id", BUSINESS_ID)
      .eq("contact_id", id);

    const { data: reviewsData } = await client
      .from("reviews")
      .select("*")
      .eq("business_id", BUSINESS_ID)
      .eq("contact_id", id);

    // 🔹 4.  Prepare unified customer object
    const customer = {
      id,
      name: name || sales[0]?.contact_name || "Customer",
      phone: phone || sales[0]?.contact_phone || "",
      history: purchaseHistory,
      referrals:
        referralsData?.map((r) => r.referred_name || r.details || "Referral") ||
        [],
      review: reviewsData?.[0] || null,
    };

    // 🔹 5.  Bind to DOM
    const nameEl = document.getElementById("after-sale-customer-name");
    const phoneEl = document.getElementById("after-sale-customer-phone");
    const purchaseEl = document.getElementById("after-sale-purchases");
    const referralEl = document.getElementById("after-sale-referrals");
    const reviewEl = document.getElementById("after-sale-review");
    const reviewBtn = document.getElementById("review-action-btn");
    const referralBtn = document.getElementById("ask-referral-btn");

    if (nameEl) nameEl.textContent = customer.name;
    if (phoneEl) phoneEl.textContent = customer.phone;

    // Purchases
    if (purchaseEl) {
      purchaseEl.innerHTML = customer.history.length
        ? customer.history.map((p, i) => `<p>${i + 1}. ${p}</p>`).join("")
        : "<p>No purchases found.</p>";
    }

    // Bind Upsell button (added to modal HTML)
    const upsellBtn = document.getElementById("upsell-btn");
    if (upsellBtn) {
      // attach contact metadata for possible future use
      upsellBtn.dataset.contactId = id;
      upsellBtn.dataset.contactName = customer.name || '';
      upsellBtn.onclick = () => {
        try {
          // Open the Add Deal form and prefill with this contact
          openAddDealForContact(customer);
        } catch (e) {
          // Fail silently for UX (don't show distracting alert)
          console.warn('Upsell open failed', e);
        }
      };
    }

    // Referrals
    if (referralEl)
      referralEl.innerHTML = customer.referrals.length
        ? customer.referrals.map((r, i) => `<p>${i + 1}. ${r}</p>`).join("")
        : "<p>No referrals yet.</p>";

    // Review
    if (reviewEl && reviewBtn) {
      const review = customer.review;
      if (review?.text || review?.comment) {
        const text = review.text || review.comment;
        const stars = review.stars || review.rating || 0;
        reviewEl.innerHTML = `
          <p class="italic">"${text}"</p>
          <p class="text-yellow-400">⭐ ${"⭐".repeat(stars)}</p>
        `;
        reviewBtn.textContent = "Download";
        reviewBtn.classList.remove("bg-main-purple");
        reviewBtn.classList.add("bg-purple-800");
        reviewBtn.onclick = () => downloadReviewCard(customer);
      } else {
        reviewEl.innerHTML = "<p>No review given yet.</p>";
        reviewBtn.textContent = "Ask for Review";
        reviewBtn.classList.remove("bg-purple-800");
        reviewBtn.classList.add("bg-main-purple");
        reviewBtn.onclick = () => openAskForReviewModal(customer);
      }
    }

    if (referralBtn)
      referralBtn.onclick = () => openAskForReferralModal(customer);

    // 🔹 6.  Show modal
    // Remove hide classes, ensure it's a flex container and force visible z/opacity in case
    // other modal helpers left inline styles that keep it invisible.
    afterSaleModal.classList.remove("hidden", "opacity-0");
    afterSaleModal.classList.add("flex");
    // Clear any leftover inline transform/opacity and force a very high z-index so the
    // after-sale popup appears above other modals/backdrops consistently.
    try {
      afterSaleModal.style.opacity = '1';
      afterSaleModal.style.transform = '';
      afterSaleModal.style.zIndex = '11000';
      // Ensure modal is positioned at the end of the document so it stacks above siblings
      try {
        if (afterSaleModal.parentElement !== document.body) document.body.appendChild(afterSaleModal);
        afterSaleModal.style.display = 'flex';
        afterSaleModal.style.visibility = 'visible';
        // Also ensure the inner modal card is not transformed/hidden
        const innerCard = afterSaleModal.querySelector('.bg-bg-card');
        if (innerCard) {
          innerCard.style.opacity = '1';
          innerCard.style.transform = '';
          innerCard.style.zIndex = '11001';
        }
      } catch (e) {
        console.warn('Could not move/force display for afterSaleModal', e);
      }
    } catch (e) {
      console.warn('Could not set inline styles for afterSaleModal', e);
    }
    // hide the transient note once UI is shown
    try { hideTransientNote(); } catch (e) {}
    console.log("✅ [AfterSalePopup] Popup rendered successfully for:", customer);
  } catch (err) {
    try { hideTransientNote(); } catch (e) {}
    console.error("🛑 [AfterSalePopup] Error:", err);
  }
}

// Close handler that clears inline styles applied when opening the after-sale modal
function closeAfterSale() {
  if (!afterSaleModal) return;
  afterSaleModal.classList.add('hidden');
  afterSaleModal.classList.remove('flex');
  // Reset inline styles to allow other modal helpers to manage stacking normally
  afterSaleModal.style.zIndex = '';
  afterSaleModal.style.opacity = '';
  afterSaleModal.style.transform = '';
  afterSaleModal.style.display = '';
  afterSaleModal.style.visibility = '';
  // Reset inner card styles if present
  const innerCard = afterSaleModal.querySelector('.bg-bg-card');
  if (innerCard) {
    innerCard.style.opacity = '';
    innerCard.style.transform = '';
    innerCard.style.zIndex = '';
  }
}

if (typeof closeAfterSaleModal !== 'undefined' && closeAfterSaleModal) {
  closeAfterSaleModal.addEventListener('click', closeAfterSale);
}

// Close when clicking on backdrop (click outside inner card)
if (typeof afterSaleModal !== 'undefined' && afterSaleModal) {
  afterSaleModal.addEventListener('click', (e) => {
    // if user clicked directly on the backdrop (the modal container) close it
    if (e.target === afterSaleModal) closeAfterSale();
  });

  // Close on Escape key for accessibility
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !afterSaleModal.classList.contains('hidden')) closeAfterSale();
  });
}

// 🟢 Open Closed Deal Modal (simple prompt directing user to After Sales)
function openClosedDealModal(deal) {
  const modalId = 'closed-deal-modal';
  const modal = document.getElementById(modalId);
  if (!modal) return console.warn('closed-deal-modal not found');

  // Title and message
  const titleEl = document.getElementById('closed-deal-title');
  const msgEl = document.getElementById('closed-deal-message');
  if (titleEl) titleEl.textContent = 'Deal Closed!';
  if (msgEl) msgEl.textContent = `Deal "${deal.dealName}" is closed. Manage it in the After Sales section.`;

  // Ensure button wiring: open after-sales section and optionally open contact in after-sale popup
  const btn = document.getElementById('closed-deal-after-sales-btn');
  if (btn) {
    // remove previous handlers to avoid duplicate actions
    btn.replaceWith(btn.cloneNode(true));
  }

  const freshBtn = document.getElementById('closed-deal-after-sales-btn');
    if (freshBtn) {
    freshBtn.addEventListener('click', (e) => {
      // close this modal
      closeModal(modalId);
      // Previously this opened the After Sale popup directly for the contact.
      // That led to unexpected popups in some flows (e.g., when scheduling meetings).
      // Instead, switch to the After Sales section and let the user open the popup
      // explicitly by clicking an After Sale action — this avoids accidental modals.
      try {
        switchSection('after-sale');
        // If needed in the future: prefetch after-sale data here WITHOUT opening the modal.
        // const contactId = deal.contactId || deal.contact_id || null;
        // if (contactId) prefetchAfterSale(contactId);
      } catch (err) {
        console.warn('Error switching to after-sale', err);
      }
    });
  }

  // show modal
  modal.classList.remove('hidden');
}



// 🟣 Global variable for popup
let purchaseHistoryPopup = null;

// 🟣 Function to open purchase history popup
function openPurchaseHistoryPopup(event, customer) {
  console.log("🟣 [Popup] Triggered for:", customer?.name);

  if (!customer) {
    console.warn("🟡 [Popup] No customer data provided.");
    return;
  }

  // Remove any existing popup
  if (purchaseHistoryPopup) {
    purchaseHistoryPopup.remove();
    purchaseHistoryPopup = null;
  }

  // Create popup element matching your HTML
  purchaseHistoryPopup = document.createElement("div");
  purchaseHistoryPopup.className =
    "purchase-popup absolute -top-3 translate-y-[-100%] left-1/2 -translate-x-1/2 bg-bg-card border border-border-dark rounded-xl shadow-2xl p-3 z-[9999] w-56 text-sm";
  purchaseHistoryPopup.style.pointerEvents = "auto";
  purchaseHistoryPopup.innerHTML = `
    <p class="text-white/70 font-semibold mb-2 border-b border-border-dark pb-1 text-center">Purchase History</p>
    ${
      customer.history?.length
        ? customer.history
            .map(
              (p) =>
                `<p class="text-white/80 text-center py-0.5">${p}</p>`
            )
            .join("")
        : `<p class="text-white/50 italic text-center py-1">No purchases yet.</p>`
    }
  `;

  // Position popup above the clicked History button
  const rect = event.currentTarget.getBoundingClientRect();
  const top = rect.top + window.scrollY - purchaseHistoryPopup.offsetHeight - 10;
  const left =
    rect.left +
    window.scrollX +
    rect.width / 2 -
    (purchaseHistoryPopup.offsetWidth || 224) / 2;

  purchaseHistoryPopup.style.position = "absolute";
  purchaseHistoryPopup.style.top = `${top}px`;
  purchaseHistoryPopup.style.left = `${left}px`;

  document.body.appendChild(purchaseHistoryPopup);

  console.log("✅ [Popup] Created above:", customer.name);

  // Close on outside click
  const closePopup = (e) => {
    if (purchaseHistoryPopup && !purchaseHistoryPopup.contains(e.target)) {
      console.log("🟤 [Popup] Closing...");
      purchaseHistoryPopup.remove();
      purchaseHistoryPopup = null;
      document.removeEventListener("click", closePopup);
    }
  };
  setTimeout(() => document.addEventListener("click", closePopup), 100);
}


function attachHistoryButtons() {
  const buttons = document.querySelectorAll(".history-btn");
  console.log("🟢 [Popup] Found History buttons:", buttons.length);

  buttons.forEach((btn) => {
    const id = btn.dataset.id || btn.getAttribute("data-id");
    console.log("🔹 [Popup] Button data-id:", id);

    btn.onclick = (e) => {
      e.stopPropagation();
      const customer = afterSaleGroupedCache.find(
        (c) => String(c.id) === String(id) || String(c.contact_id) === String(id)
      );
      if (!customer) {
        console.warn("🟠 [Popup] No customer found for ID:", id);
        return;
      }
      openPurchaseHistoryPopup(e, customer);
    };
  });
}


function downloadReviewCard(customer) {
  showInAppAlert(`Downloading review card for ${customer.name}`);
}

function openAskForReviewModal(customer) {
  showInAppAlert(`Open Ask for Review modal for ${customer.name}`);
}
// 🟣 Ask for Referral Modal logic
const referralModal = document.getElementById('ask-referral-modal');
const closeReferralModal = document.getElementById('close-referral-modal');

function openAskForReferralModal(customer) {
  if (!referralModal) return;
  document.getElementById('referral-customer-name').textContent = customer.name || 'Customer';
  document.getElementById('referral-customer-phone').textContent = customer.phone || '';
  document.getElementById('referral-offer-input').value = '';
  // store contact id on modal so handlers can read it later
  try { referralModal.dataset.contactId = customer.id; } catch (e) {}
  referralModal.classList.remove('hidden');
  referralModal.classList.add('flex');
}

if (closeReferralModal) {
  closeReferralModal.addEventListener('click', () => referralModal.classList.add('hidden'));
}

// 🟣 Ask for Review Modal logic
const reviewModal = document.getElementById('ask-review-modal');
const closeReviewModal = document.getElementById('close-review-modal');

function openAskForReviewModal(customer) {
  if (!reviewModal) return;
  document.getElementById('review-customer-name').textContent = customer.name || 'Customer';
  document.getElementById('review-customer-phone').textContent = customer.phone || '';
  document.getElementById('review-offer-input').value = '';
  // store contact id on modal so handlers can read it later
  try { reviewModal.dataset.contactId = customer.id; } catch (e) {}
  reviewModal.classList.remove('hidden');
  reviewModal.classList.add('flex');
}

if (closeReviewModal) {
  closeReviewModal.addEventListener('click', () => reviewModal.classList.add('hidden'));
}
// Open Add Deal prefilled for a contact (used by Upsell button)
function openAddDealForContact(customer) {
  try {
    if (!customer) return;
    // Mark origin so nested flows can behave accordingly
    formOrigin = 'after-sale-upsell';
    // Set selectedDealContact so deal form behaves as if the user picked the contact
    selectedDealContact = { id: customer.id, name: customer.name || '', phone: customer.phone || '' };

    // Prefill DOM elements used by the add-deal form
    const dealSearchEl = document.getElementById('deal-contact-search');
    const contactIdEl = document.getElementById('new-deal-contact-id');
    if (dealSearchEl) dealSearchEl.value = `${selectedDealContact.name} (${selectedDealContact.phone || ''})`;
    if (contactIdEl) contactIdEl.value = selectedDealContact.id;

    // Ensure the deal-stage select is populated
    populateDealStageSelect();
    // Open the Add modal and switch to Deal form
    // Open the Add modal and switch to Deal form. Ensure it appears above any open parent modal
    openAddModal();
    switchAddForm('deal');

      try {
        // Hide nested contact selector to prevent nested-contacts flow when opening from an upsell
        const nestedArea = document.getElementById('nested-selector-area');
        if (nestedArea) nestedArea.classList.add('hidden');

        // Also hide any nested-search-results and clear selected chips so no nested contacts remain applied
        const nestedResults = document.getElementById('nested-search-results');
        if (nestedResults) nestedResults.classList.add('hidden');
        const nestedSelected = document.getElementById('nested-selected-list');
        if (nestedSelected) nestedSelected.innerHTML = '';

        // Ensure the deal contact input is readonly and results hidden so only prefilled contact shows
        const dealSearch = document.getElementById('deal-contact-search');
        const dealResults = document.getElementById('deal-contact-results');
        if (dealSearch) {
          dealSearch.setAttribute('readonly', 'true');
          dealSearch.dataset.prefilled = 'true';
        }
        if (dealResults) dealResults.classList.add('hidden');

        // Bring the add modal to the front so it overlays the after-sale modal
        const addModalEl = document.getElementById('add-main-modal');
        const afterSaleEl = document.getElementById('after-sale-modal');
        const afterSaleZ = afterSaleEl ? parseInt(getComputedStyle(afterSaleEl).zIndex) || 9998 : 9998;
        if (addModalEl) {
          // use a value safely above the after-sale modal
          addModalEl.style.zIndex = (afterSaleZ + 2).toString();
        }
      } catch (e) { console.warn('openAddDealForContact post-open adjustments failed', e); }
  } catch (e) { console.warn('openAddDealForContact failed', e); }
}
// 🟣 Ask for Referral buttons
const referralCallBtn = document.getElementById('referral-call-btn');
const referralWhatsappBtn = document.getElementById('referral-whatsapp-btn');

if (referralCallBtn && referralWhatsappBtn) {
  referralCallBtn.addEventListener('click', () => {
    // 🔹 collapse parent modal first
    closeModal('ask-referral-modal');

    const name  = document.getElementById('referral-customer-name').textContent;
    const phone = document.getElementById('referral-customer-phone').textContent;
    const offer = document.getElementById('referral-offer-input').value || 'We value your referrals!';

    const callLog = document.getElementById('call-log-contact');
    if (callLog) callLog.textContent = `Logging call for: ${name} (${phone})`;

    // open the call modal now that parent is closed
    showModal('call-log-modal');
  });

  referralWhatsappBtn.addEventListener('click', () => {
    // 🔹 collapse parent modal first
    closeModal('ask-referral-modal');

    const name  = document.getElementById('referral-customer-name').textContent;
    const phone = document.getElementById('referral-customer-phone').textContent;
    const offer = document.getElementById('referral-offer-input').value || 'We value your referrals!';
    
      // ✅ Set AI Messaging Context (include contact id if available)
      const contactId = (() => {
        try { return parseInt(referralModal?.dataset?.contactId || null, 10) || null; } catch (e) { return null; }
      })();
      window.currentWhatsAppContext = {
        type: "referral",
        business_id: BUSINESS_ID,
        contact_id: contactId,
        contact_name: name,
        extra: { offer }
      };
    const waTo      = document.getElementById('whatsapp-to');
    const waMsg     = document.getElementById('whatsapp-message-body');
    const waSubject = document.getElementById('whatsapp-subject');

    if (waTo)      waTo.value      = phone;
    if (waMsg)     waMsg.value     = `Hi ${name}, we’d love if you referred a friend! ${offer}`;
    if (waSubject) waSubject.value = 'Get Referral Offer';

    showModal('whatsapp-modal');
  });
}

// 🟣 Ask for Review buttons
const reviewCallBtn = document.getElementById('review-call-btn');
const reviewWhatsappBtn = document.getElementById('review-whatsapp-btn');

if (reviewCallBtn && reviewWhatsappBtn) {
  reviewCallBtn.addEventListener('click', () => {
    // 🔹 collapse parent modal first
    closeModal('ask-review-modal');

    const name  = document.getElementById('review-customer-name').textContent;
    const phone = document.getElementById('review-customer-phone').textContent;

    const callLog = document.getElementById('call-log-contact');
    if (callLog) callLog.textContent = `Logging call for: ${name} (${phone})`;

    showModal('call-log-modal');
  });

  reviewWhatsappBtn.addEventListener('click', () => {
    // 🔹 collapse parent modal first
    closeModal('ask-review-modal');

    const name  = document.getElementById('review-customer-name').textContent;
    const phone = document.getElementById('review-customer-phone').textContent;
    const offer = document.getElementById('review-offer-input').value || 'We’d love your feedback!';

    // ✅ Set AI Messaging Context (include contact id if available)
    const contactId = (() => {
      try { return parseInt(reviewModal?.dataset?.contactId || null, 10) || null; } catch (e) { return null; }
    })();
    window.currentWhatsAppContext = {
      type: "review",
      business_id: BUSINESS_ID,
      contact_id: contactId,
      contact_name: name,
      extra: { offer }
    };
    const waTo      = document.getElementById('whatsapp-to');
    const waMsg     = document.getElementById('whatsapp-message-body');
    const waSubject = document.getElementById('whatsapp-subject');

    if (waTo)      waTo.value      = phone;
    if (waMsg)     waMsg.value     = `Hi ${name}, could you please leave us a short review? ${offer}`;
    if (waSubject) waSubject.value = 'Customer Review Request';

    showModal('whatsapp-modal');
  });
}

    const waModal = document.getElementById('whatsapp-modal');
    if (waModal) {
      // Try to locate a parent modal that was visible before the WhatsApp modal opened.
      // Guard its use so we don't reference an undefined variable when no parent modal exists.
      const parentModal = document.querySelector('.modal-backdrop:not(.hidden):not(#whatsapp-modal)') || null;
      const restore = new MutationObserver(() => {
        if (waModal.classList.contains('hidden')) {
          try {
            if (parentModal && parentModal.style) parentModal.style.display = 'flex';
          } catch (e) { /* ignore errors when restoring */ }
          restore.disconnect();
        }
      });
      restore.observe(waModal, { attributes: true });
    }

// 🟣 VV Studios Premium Review Card (Full Upgrade)
async function downloadReviewCard(customer) {
  // Ensure we have all fields
  const name = customer.name || 'John';
  const review = customer.review || 'I really enjoyed their customer service they are just the best!';
  const rating = customer.rating || 5;
  const business = customer.business || 'Fortune Books';
  const date = customer.review_date || '25th Oct 2025';

  // --- CARD CREATION ---
  const card = document.createElement('div');
  card.style.position = 'fixed';
  card.style.top = '-9999px';
  card.style.left = '0';
  card.style.width = '500px';
  card.style.height = '500px';
  card.style.padding = '40px';
  card.style.background = '#230E36'; // Deep violet background
  card.style.color = '#ffffff';
  card.style.fontFamily = 'Poppins, sans-serif';
  card.style.boxShadow = '0 0px 30px rgba(0,0,0,0.5)';
  card.style.textAlign = 'center';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.justifyContent = 'space-between';
  card.style.boxSizing = 'border-box';

  // --- CARD CONTENT ---
  card.innerHTML = `
    <!-- Top Section: Stars and Review -->
    <div style="flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start;">
      <!-- Star Rating -->
      <div style="
        font-size: 50px;
        color: #FACC15;
        margin-top: 5px;
        margin-bottom: 25px;
        letter-spacing: 5px;
        text-shadow: 0 0 8px rgba(255, 200, 0, 0.6);
      ">
        ${'★'.repeat(rating)}
      </div>

      <!-- Review Quote -->
      <p style="font-size: 28px; font-weight: 700; color: #FFFFFF; line-height: 1.4; margin: 0 10px;">
        “${review}”
      </p>
    </div>

    <!-- Middle Section: Attribution -->
    <div style="display: flex; justify-content: space-between; align-items: flex-end; width: 100%; margin-top: 40px; margin-bottom: 20px;">
      <div style="font-size: 20px; color: #FACC15; font-weight: 700; text-align: left;">
        ${business}
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; text-align: right;">
        <span style="font-size: 20px; color: #FACC15; font-weight: 700;">${name}</span>
        <span style="font-size: 16px; color: #D0D0D0; margin-top: 4px;">${date}</span>
      </div>
    </div>

    <!-- Bottom Section: Verified Footer -->
    <div style="display: flex; align-items: center; justify-content: center; width: 100%; font-size: 16px; font-weight: 500; color: #D0D0D0;">
      <!-- Verified Icon (Clean Final SVG) -->
      <svg width="22" height="22" viewBox="0 0 24 24" style="margin-right: 8px; flex-shrink: 0;" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="#9D4EDD" stroke-width="2" fill="none" />
        <path d="M8 12.5L11 15.5L16 9.5" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>Verified by VV Studios</span>
    </div>
  `;

  document.body.appendChild(card);
document.getElementById('ai-assist-btn')
  ?.addEventListener('click', () => handleAIWhatsAppAssist());

document.getElementById('regenerate-ai-btn')
  ?.addEventListener('click', () => handleAIWhatsAppAssist());

document.getElementById('next-ai-btn')
  ?.addEventListener('click', () => cycleAISuggestion());

document.getElementById('save-ai-btn')
  ?.addEventListener('click', () => acceptAISuggestion());

  // --- CAPTURE IMAGE ---
  const canvas = await html2canvas(card, {
    backgroundColor: null,
    scale: 2,
    useCORS: true
  });

  // --- DOWNLOAD IMAGE ---
  const link = document.createElement('a');
  link.download = `${name}-review-card.png`;
  link.href = canvas.toDataURL('image/png', 1.0);
  link.click();

  // --- CLEANUP ---
  document.body.removeChild(card);
  console.log(`Review card downloaded for ${name}`);
}


// 🩵 Z-INDEX PATCH — keeps new modals (showModal) on top of previous ones
(function () {
  // helper to bring the latest opened modal to front
  const bringToFront = (id) => {
    const modals = document.querySelectorAll('.fixed.inset-0');
    modals.forEach(modal => (modal.style.zIndex = 9998)); // reset all modals
    const activeModal = document.getElementById(id);
    if (activeModal) activeModal.style.zIndex = 10000; // bring current one to top
  };

  // patch the showModal function so it always triggers bringToFront
  if (typeof showModal === 'function') {
    const originalShowModal = showModal;
    window.showModal = function (id) {
      originalShowModal(id);
      bringToFront(id);
    };
  }
})();


  // also handle direct open logic (like referralModal.classList.remove)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const modal = mutation.target;
        if (!modal.classList.contains('hidden') && modal.classList.contains('fixed')) {
          modal.style.zIndex = 10000; // push to top when shown
        }
      }
    });
  });

  // watch all modals for class changes
  document.querySelectorAll('.fixed.inset-0').forEach(modal => observer.observe(modal, { attributes: true }));

// -------------------------------------------------------------------
// BOOTSTRAP: attach listeners, load initial data, and subscribe realtime
// -------------------------------------------------------------------
// Tablet-only sidebar toggle: shows/hides the left sidebar on tablet widths (>=640 && <1024)
function initSidebarTabletToggle() {
  try {
    const btn = document.getElementById('sidebar-toggle-tablet');
    const sidebar = document.getElementById('sidebar');
    if (!btn || !sidebar) return;

    const isTablet = () => window.innerWidth >= 640 && window.innerWidth < 1024;

    const setOpen = (open) => {
      if (open) {
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
        btn.textContent = '<';
        localStorage.setItem('sidebar_tablet_open', '1');
      } else {
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        btn.textContent = '>';
        localStorage.setItem('sidebar_tablet_open', '0');
      }
    };

    // initialize: default closed on tablet unless user preference says otherwise
    const pref = localStorage.getItem('sidebar_tablet_open');
    if (isTablet()) {
      if (pref === '1') setOpen(true);
      else setOpen(false);
    } else {
      // ensure sidebar visible on desktop (LG) by removing any leftover translate class
      if (window.innerWidth >= 1024) {
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
      }
    }

    btn.addEventListener('click', (e) => {
      if (!isTablet()) return;
      const currentlyOpen = sidebar.classList.contains('translate-x-0') && !sidebar.classList.contains('-translate-x-full');
      setOpen(!currentlyOpen);
    });

    // keep state correct on resize
    window.addEventListener('resize', () => {
      if (!isTablet()) {
        // On non-tablet, ensure the button shows correct glyph for when returned to tablet
        const stored = localStorage.getItem('sidebar_tablet_open');
        const open = stored === '1';
        // On desktop, sidebar should be visible (lg css handles it), but keep stored pref
        if (window.innerWidth >= 1024) {
          sidebar.classList.remove('-translate-x-full');
          sidebar.classList.add('translate-x-0');
        }
        // On mobile (<640) keep sidebar hidden by default.
        if (window.innerWidth < 640) {
          sidebar.classList.add('-translate-x-full');
          sidebar.classList.remove('translate-x-0');
        }
        // ensure button text syncs when returning to tablet
        const btnText = open ? '<' : '>';
        btn.textContent = btnText;
      } else {
        // when entering tablet, apply stored pref
        const stored = localStorage.getItem('sidebar_tablet_open');
        setOpen(stored === '1');
      }
    });
  } catch (e) { console.debug('initSidebarTabletToggle failed', e); }
}

function openFeedbackModal(dealTitle, contactName, channel, timestamp) {
  console.log('[DEBUG] openFeedbackModal called', { dealTitle, contactName, channel });
  const fbModal = document.getElementById('feedbackModal');
  if (!fbModal) {
    console.error('[DEBUG] feedbackModal element not found in DOM');
  } else {
    // If the modal isn't a direct child of body, move it to document.body to avoid stacking-context/overflow issues
    if (fbModal.parentElement && fbModal.parentElement !== document.body) {
      console.log('[DEBUG] feedbackModal parent is not body — moving it to document.body to avoid stacking context issues');
      try { document.body.appendChild(fbModal); } catch (err) { console.warn('Failed to move feedbackModal to body', err); }
    }
    console.log('[DEBUG] feedbackModal classList before:', fbModal.className);
    // Remove Tailwind `hidden` and ensure the modal is rendered and on top
    fbModal.classList.remove('hidden');
    try {
      fbModal.style.display = 'block';
      fbModal.style.zIndex = '11000';
      fbModal.style.opacity = '1';
    } catch (err) { /* ignore inline style failures */ }

    const inner = fbModal.querySelector('.bg-bg-card, .card-animate');
    if (inner) {
      console.log('[DEBUG] feedback inner element found, rect:', inner.getBoundingClientRect());
      inner.style.transform = 'none';
      inner.style.opacity = '1';
      inner.style.zIndex = '11001';
    } else {
      console.warn('[DEBUG] feedback inner element NOT found');
    }
    console.log('[DEBUG] feedbackModal classList after:', fbModal.className, 'computed display:', window.getComputedStyle(fbModal).display);
  }
  document.getElementById('feedbackDealTitle').innerText = dealTitle;
  document.getElementById('feedbackContactName').innerText = contactName;
  // Track current channel for submit logic
  window.currentFeedbackChannel = channel || '';

  // Channel specific UI adjustments
  const outcomeSelect = document.getElementById('feedbackOutcome');
  const outcomeWhatsApp = document.getElementById('feedbackOutcomeWhatsApp');
  const outcomeContainer = document.getElementById('feedbackOutcomeContainer');
  const whatsappSentTime = document.getElementById('feedbackWhatsAppSentTime');
  // Note: 'feedbackWhatsAppOther' checkbox was removed; 'Other' is now an option on the select

  // Compute a human-friendly relative time if timestamp provided, otherwise 'just now'
  function timeAgo(ts) {
    if (!ts) return 'just now';
    const then = new Date(ts).getTime();
    if (isNaN(then)) return 'just now';
    const diff = Date.now() - then;
    const mins = Math.floor(diff / (1000 * 60));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  if (channel === 'whatsapp') {
    // Show WhatsApp-specific UI; keep the general select visible (user requested the dropdown restored)
    if (outcomeSelect) outcomeSelect.classList.remove('hidden');
    if (outcomeWhatsApp) outcomeWhatsApp.classList.remove('hidden');
    if (whatsappSentTime) whatsappSentTime.textContent = `Sent ${timeAgo(timestamp)}`;
  } else {
    // Show general select for calls and others
    if (outcomeSelect) outcomeSelect.classList.remove('hidden');
    if (outcomeWhatsApp) outcomeWhatsApp.classList.add('hidden');
  }
  
  // Dynamic channel icon
  const iconDiv = document.getElementById('feedbackIcon');
  const helperEl = document.getElementById('feedbackHelper');
  const notesEl = document.getElementById('feedbackNotes');
  const outcomeEl = document.getElementById('feedbackOutcome');
  if (channel === 'whatsapp') {
    iconDiv.innerHTML = `<img src="https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/whatsapp.svg" alt="WhatsApp" class="w-8 h-8 text-green-500"/>`;
    if (helperEl) helperEl.textContent = 'WhatsApp message was sent — paste the message or summarise any reply.';
    if (notesEl) notesEl.placeholder = 'Paste the WhatsApp message or summarise the reply...';
    if (outcomeEl) outcomeEl.value = '';
  } else if (channel === 'call') {
    iconDiv.innerHTML = `<img src="https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/phone.svg" alt="Call" class="w-8 h-8 text-blue-500"/>`;
    if (helperEl) helperEl.textContent = 'Record a short summary of the call and select the outcome.';
    if (notesEl) notesEl.placeholder = 'Summarise the call (what was discussed, next steps)...';
    if (outcomeEl) outcomeEl.value = '';
  } else {
    iconDiv.innerHTML = '';
    if (helperEl) helperEl.textContent = '';
    if (notesEl) notesEl.placeholder = 'Write what the client said or how the conversation went...';
    if (outcomeEl) outcomeEl.value = '';
  }
}

function closeFeedbackModal() {
  console.log('[DEBUG] closeFeedbackModal called');
  const fbModal = document.getElementById('feedbackModal');
  if (fbModal) {
    fbModal.classList.add('hidden');
    try { fbModal.style.display = 'none'; } catch (e) {}
  }
}

function submitFeedback(e) {
  e.preventDefault();
  const notes = document.getElementById('feedbackNotes').value.trim();
  const channel = window.currentFeedbackChannel || '';

  let outcome = '';
  // Read the selected outcome from the dropdown for all channels
  outcome = document.getElementById('feedbackOutcome') ? document.getElementById('feedbackOutcome').value : '';

  // If user didn't pick an outcome and didn't write notes, reject
  if (!outcome && !notes) {
    alert("Please select an outcome or write some feedback before saving.");
    return;
  }

  // If user selected 'other', require notes
  if (outcome === 'other' && !notes) {
    alert('Please explain the outcome in the notes when selecting Other.');
    return;
  }

  console.log("Feedback submitted:", { channel, outcome, notes });
  // Insert the user-written feedback as stage '2' into followup_feedback
  (async () => {
    try {
      // Resolve followup context (selectedFollowUp should be set by the UI before opening the modal)
      const followUpId = selectedFollowUp?.followup_id || selectedFollowUp?.id || null;
      const contactId = selectedFollowUp?.contact_id || selectedFollowUp?.contactId || null;
      const dealId = selectedFollowUp?.deal_id || selectedFollowUp?.dealId || null;

      const fbPayload = {
        business_id: BUSINESS_ID,
        followup_id: followUpId,
        contact_id: contactId,
        deal_id: dealId,
        feedback_type: channel || outcome || 'user',
        feedback_notes: notes || null,
        feedback_stage: '2',
        created_at: new Date().toISOString()
      };

  console.debug('[DEBUG] submitFeedback payload', fbPayload);
  const { data, error } = await client.from('followup_feedback').insert([fbPayload]).select().single();
  if (error) throw error;
  console.log('[DEBUG] followup_feedback (modal submit) inserted', data);

      // Refresh follow-ups so UI reflects new feedback state
      await loadFollowUps();
      showInAppAlert('Feedback saved.');
      closeFeedbackModal();
    } catch (err) {
      console.error('❌ submitFeedback error', err);
      showInAppAlert('Failed to save feedback — check console.');
    }
  })();
}

window.addEventListener('DOMContentLoaded', async () => {
  logStep('Startup - attaching listeners & loading data...');

  // ✅ Initialize global mobile submenu reference once
  mobileAddSubMenu = document.getElementById('mobile-add-sub-menu');

  try {
  attachEventListeners();
  // Attach autosave handlers for notes fields (contact modal, deal/follow-up modal, WhatsApp modal)
  try { setupAutoSaveHandlers(); } catch (e) { console.warn('setupAutoSaveHandlers failed', e); }
  // Tablet sidebar toggle (button in HTML): wire up behavior
  try { initSidebarTabletToggle(); } catch (e) { console.warn('initSidebarTabletToggle failed', e); }

    console.time('Initial Load');
    await Promise.all([
      loadContacts(),
      loadDeals(),
      loadAfterSale(),
      loadFollowUps(),
      loadMeetings()
    ]);
    console.timeEnd('Initial Load');
    logStep('Initial data loaded');

  // Initialize contacts & after-sale searches once data is loaded
  try { if (typeof initContactsSearch === 'function') initContactsSearch(); } catch (e) { console.warn('initContactsSearch failed', e); }
  try { if (typeof initAfterSaleSearch === 'function') initAfterSaleSearch(); } catch (e) { console.warn('initAfterSaleSearch failed', e); }

    // default open deals section (like original)
    // Wire feedback widget buttons (delegated) to the modal handler
    try {
      const fbCards = document.getElementById('feedback-widget-cards');
      if (fbCards) {
        fbCards.addEventListener('click', (e) => {
          // If the feedback button was clicked, prefer that (has dataset attributes)
          const btn = e.target.closest('button[data-feedback-deal]');
          if (btn) {
            const deal = btn.dataset.feedbackDeal || '';
            const contact = btn.dataset.feedbackContact || '';
            const channel = btn.dataset.feedbackChannel || '';
            console.log('[DEBUG] feedback button clicked', { deal, contact, channel });
            try { openFeedbackModal(deal, contact, channel); } catch (err) { console.error('openFeedbackModal failed', err); }
            return;
          }

          // Otherwise if the card itself was clicked, open the modal too (but keep badge/button intact)
          const card = e.target.closest('.preserve-top');
          if (!card) return;
          // Try to find the inner feedback button to read the dataset
          const innerBtn = card.querySelector('button[data-feedback-deal]');
          const deal = innerBtn ? (innerBtn.dataset.feedbackDeal || '') : '';
          const contact = innerBtn ? (innerBtn.dataset.feedbackContact || '') : '';
          const channel = innerBtn ? (innerBtn.dataset.feedbackChannel || '') : '';
          console.log('[DEBUG] feedback card clicked', { deal, contact, channel });
          try { openFeedbackModal(deal, contact, channel); } catch (err) { console.error('openFeedbackModal (card) failed', err); }
        });
      }
    } catch (e) { console.warn('Feedback widget wiring failed', e); }

  // Initialize alerts UI (side panel + unread bubble)
  try { initAlertsUI(); } catch (e) { console.warn('initAlertsUI error', e); }

  switchSection('deals');

  setupRealtime();
    logStep('CRM initialization complete');
  } catch (err) {
    console.error('🔥 Fatal init error:', err);
  }
});
