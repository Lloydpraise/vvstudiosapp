// Guided multi-step tour for Ads Management
;(function(global){
  if (global.AdsTour) return;

  // inject styles
  const STYLE_ID = 'vv-ads-tour-styles';
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .vv-tour-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 70; display:flex; align-items:center; justify-content:center; }
      .vv-tour-modal { background: #1a1d23; color: #fff; border-radius: 12px; padding: 18px; max-width: 520px; width: 92%; border: 1px solid rgba(139,92,246,0.2); box-shadow: 0 6px 30px rgba(0,0,0,0.6); }
      .vv-tour-buttons { display:flex; justify-content:space-between; gap:8px; margin-top:12px; }
      .vv-tour-btn { padding:8px 12px; border-radius:10px; font-weight:600; cursor:pointer; border: none; }
      .vv-tour-btn.positive { background: #f97316; color:#fff; }
      .vv-tour-btn.negative { background: #374151; color:#e5e7eb; }
      .vv-tour-highlight { position: relative; z-index: 75; box-shadow: 0 4px 20px rgba(99,102,241,0.12); outline: 3px solid rgba(139,92,246,0.18); border-radius: 12px; transition: box-shadow 0.18s ease, transform 0.18s ease; transform: translateZ(0); }
      .vv-tour-floating { position: fixed; bottom: 24px; right: 24px; z-index: 80; background:#7c3aed; color:#fff; padding:10px 14px; border-radius:999px; box-shadow: 0 6px 24px rgba(124,58,237,0.25); cursor:pointer; font-weight:600; }
      .vv-tour-step-footer { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:14px; }
      .vv-tour-step-counter { color: #c7b3ff; font-size:0.9rem; }
    `;
    document.head.appendChild(s);
  }

  const steps = [
    {
      key: 'period',
      title: 'Period Selector',
      selector: '#day-selector',
      text: 'Try sliding the period selector bar to see results from custom periods as shown.'
    },
    {
      key: 'top_metrics',
      title: 'Top Metrics',
      selector: '#totalSpend',
      text: 'These are the top metrics. They show quick numbers like spend and sales at a glance.'
    },
    {
      key: 'detailed',
      title: 'Detailed Metrics',
      selector: '#impressions',
      text: 'Here you can see more detailed metrics. Use these to understand what is working.'
    }
  ];

  let state = { index: 0, highlightEl: null, overlay: null, businessId: null };

  function lsKey(...parts){ return ['vv_ads_tour'].concat(parts).join(':'); }
  function getBizIdKey(biz){ return biz ? biz : 'anon'; }
  function getViews(biz){ try{ return parseInt(localStorage.getItem(lsKey('views', getBizIdKey(biz)))||'0',10)||0;}catch(e){return 0;} }
  function incViews(biz){ try{ const k = lsKey('views', getBizIdKey(biz)); const v = getViews(biz)+1; localStorage.setItem(k, String(v)); return v;}catch(e){return 0;} }
  function isCancelled(biz){ try{ return !!localStorage.getItem(lsKey('cancelled', getBizIdKey(biz))); }catch(e){return false;} }
  function setCancelled(biz){ try{ localStorage.setItem(lsKey('cancelled', getBizIdKey(biz)), new Date().toISOString()); }catch(e){} }

  function createOverlay() {
    const ov = document.createElement('div');
    ov.className = 'vv-tour-overlay';
    ov.innerHTML = `<div class="vv-tour-modal" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(ov);
    state.overlay = ov;
    return ov;
  }

  function removeOverlay(){
    if (state.overlay) { try{ state.overlay.remove(); }catch(e){} state.overlay = null; }
    if (state.highlightEl) { state.highlightEl.classList.remove('vv-tour-highlight'); state.highlightEl = null; }
  }

  function renderInitialPrompt(){
    removeOverlay();
    const ov = createOverlay();
    const modal = ov.querySelector('.vv-tour-modal');
    modal.innerHTML = `
      <button id="vv-close-tour" style="position:absolute;right:12px;top:10px;background:transparent;border:none;color:#9ca3af;font-size:20px;">&times;</button>
      <h3 style="font-size:1.15rem;margin-bottom:6px">Take a short tour of Ads</h3>
      <p style="color:#d1d5db;margin-bottom:10px">Learn how everything works.</p>
      <div class="vv-tour-buttons">
        <button class="vv-tour-btn negative" id="vv-skip-tour">Skip Tour</button>
        <button class="vv-tour-btn positive" id="vv-begin-tour">Begin Tour</button>
      </div>
    `;
    // skip sets cancelled flag
    modal.querySelector('#vv-skip-tour').addEventListener('click', ()=>{ try{ setCancelled(state.businessId); }catch(e){} removeOverlay(); });
    modal.querySelector('#vv-begin-tour').addEventListener('click', ()=>{ startSteps(); });
    const closeBtn = modal.querySelector('#vv-close-tour');
    if (closeBtn) closeBtn.addEventListener('click', ()=>{ try{ setCancelled(state.businessId); }catch(e){} removeOverlay(); });
  }

  function positionModalNearElement(el, contentHtml, stepIndex){
    removeOverlay();
    const ov = createOverlay();
    const modal = ov.querySelector('.vv-tour-modal');
    // build modal content with prev/next
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === steps.length -1;
    modal.innerHTML = `
      <div>
        <h3 style="font-size:1.05rem;margin-bottom:6px">${steps[stepIndex].title}</h3>
        <p style="color:#d1d5db">${contentHtml}</p>
        <div class="vv-tour-step-footer">
          <div>
            ${!isFirst ? '<button class="vv-tour-btn negative" id="vv-prev-step">Previous</button>' : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="vv-tour-step-counter">Step ${stepIndex+1} of ${steps.length}</div>
            ${isLast ? '<button class="vv-tour-btn positive" id="vv-finish-step">Finish Tour</button>' : '<button class="vv-tour-btn positive" id="vv-next-step">Next</button>'}
          </div>
        </div>
      </div>
    `;

    // Attach handlers
    if (!isFirst) modal.querySelector('#vv-prev-step').addEventListener('click', ()=>{ showStep(stepIndex -1); });
    if (!isLast) modal.querySelector('#vv-next-step').addEventListener('click', ()=>{ showStep(stepIndex +1); });
    if (isLast) modal.querySelector('#vv-finish-step').addEventListener('click', ()=>{ finishTour(); });

    // add a close button that does NOT mark cancelled (user can dismiss step modal)
    const closeX = document.createElement('button');
    closeX.innerHTML = '&times;';
    closeX.style.cssText = 'position:absolute;right:12px;top:10px;background:transparent;border:none;color:#9ca3af;font-size:20px;';
    closeX.addEventListener('click', ()=>{ removeOverlay(); });
    modal.appendChild(closeX);

    // Highlight element
    try{
      if (state.highlightEl) { state.highlightEl.classList.remove('vv-tour-highlight'); }
      if (el) { el.classList.add('vv-tour-highlight'); state.highlightEl = el; }
    }catch(e){}

    // Try to position modal visually near the element by scrolling it into view
    try{ if (el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){}
  }

  function showStep(i){
    state.index = i;
    const step = steps[i];
    let el = null;
    try{ el = document.querySelector(step.selector); }catch(e){ el = null; }
    // If element not found, fallback to center modal
    const text = step.text;
    positionModalNearElement(el, text, i);
    // track via Analytics if available
    try{ if (global.Analytics && typeof global.Analytics.track === 'function') global.Analytics.track({type:'onboarding', name:'ads_tour_step', data:{step: step.key, index: i+1}}); }catch(e){}
  }

  function startSteps(){
    showStep(0);
  }

  function finishTour(){
    // emit event
    try{ if (global.Analytics && typeof global.Analytics.track === 'function') global.Analytics.track({type:'onboarding', name:'ads_tour_finished', data:{}}); }catch(e){}
    removeOverlay();
  }

  function start(){
    renderInitialPrompt();
  }

  /**
   * Initialize AdsTour with optional context.
   * options: { businessId: string, autoShowMaxViews: number }
   */
  function init(options={}){
    try{
      const biz = options.businessId || null;
      state.businessId = biz;
      const views = incViews(biz);
      // auto show if views < limit and user has not cancelled previously
      const limit = (typeof options.autoShowMaxViews === 'number') ? options.autoShowMaxViews : 5;
      const cancelled = isCancelled(biz);
      if (!cancelled && views <= limit) {
        // show initial prompt after small delay
        setTimeout(()=>{ renderInitialPrompt(); }, 800);
      }
    }catch(e){ console.warn('AdsTour.init error', e); }
  }

  // add a floating Take Tour button when on ads page
  function addFloatingButton(){
    try{
      const existing = document.getElementById('vv-ads-tour-btn');
      if (existing) return existing;
      const btn = document.createElement('button');
      btn.id = 'vv-ads-tour-btn';
      btn.className = 'vv-tour-floating';
      btn.textContent = 'Take Tour';
      btn.title = 'Take a short tour of Ads Management';
      btn.addEventListener('click', start);
      document.body.appendChild(btn);
      return btn;
    }catch(e){ return null; }
  }

  const AdsTour = { init, start, startSteps, finishTour, addFloatingButton };
  global.AdsTour = AdsTour;

  // Auto-add floating button if body data-page indicates ads
  // Floating button auto-add removed; placement handled by page markup.

})(window);
