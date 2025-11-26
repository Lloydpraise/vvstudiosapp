/* Global loading overlay script
   - Injects a sleek 3-color circular loader (orange, purple, green)
   - Exposes `hideGlobalLoading()` and `showGlobalLoading()` on `window`
   - Auto-hides on `window.load` if not manually hidden
   - Include as the very first script in your pages to show while JS loads
*/
(function(){
  if (document.getElementById('global-loading')) return;

  const css = `:root{--accent1:#ff8a00;--accent2:#9b59b6;--accent3:#2ecc71;--overlay-dark:rgba(6,7,9,0.72);--overlay-light:rgba(255,255,255,0.86)}
  #global-loading{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
  #global-loading .overlay{position:absolute;inset:0;background:var(--overlay-dark)}
  @media (prefers-color-scheme: light){#global-loading .overlay{background:var(--overlay-light)}}
  .gl-loader{position:relative;display:flex;align-items:center;justify-content:center;width:110px;height:110px}
  .gl-ring{position:absolute;border-radius:50%;border:6px solid transparent;border-top-color:var(--accent1);box-sizing:border-box;}
  .gl-ring.r1{width:110px;height:110px;animation:gl-spin 1.4s linear infinite}
  .gl-ring.r2{width:78px;height:78px;border-top-color:var(--accent2);animation:gl-spin 1.9s linear infinite}
  .gl-ring.r3{width:46px;height:46px;border-top-color:var(--accent3);animation:gl-spin 1.0s linear infinite;animation-direction:reverse}
  .gl-center{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent1),var(--accent2));box-shadow:0 10px 30px rgba(0,0,0,0.45)}
  @keyframes gl-spin{to{transform:rotate(360deg)}}
  /* subtle entrance */
  #global-loading{opacity:1;transition:opacity 280ms ease}
  `;

  const style = document.createElement('style');
  style.id = 'global-loading-styles';
  style.textContent = css;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'global-loading';
  container.setAttribute('aria-hidden','false');
  container.innerHTML = `
    <div class="overlay" aria-hidden="true"></div>
    <div class="gl-loader" role="status" aria-label="Loading">
      <div class="gl-ring r1" aria-hidden="true"></div>
      <div class="gl-ring r2" aria-hidden="true"></div>
      <div class="gl-ring r3" aria-hidden="true"></div>
      <div class="gl-center" aria-hidden="true"></div>
    </div>`;

  // Insert as early as possible so it's visible while other scripts load
  if (document.documentElement) document.documentElement.appendChild(container);

  // Expose controls
  window.hideGlobalLoading = function(delay = 180){
    setTimeout(()=>{
      const el = document.getElementById('global-loading');
      if (!el) return;
      el.style.opacity = '0';
      el.setAttribute('aria-hidden','true');
      setTimeout(()=>{ el.remove(); const s = document.getElementById('global-loading-styles'); if(s) s.remove(); }, 340);
    }, delay);
  };

  window.showGlobalLoading = function(){
    if (!document.getElementById('global-loading')){
      document.documentElement.appendChild(container);
    }
  };

  // Wait for all scripts to load, but allow the app to explicitly signal readiness.
  // Behavior:
  // - Track existing <script src="..."> elements and listen for their load/error events.
  // - Observe newly added scripts and track them as well.
  // - When there are no pending scripts, hide the loader after a short debounce.
  // - The app can call `window.vvAppReady()` or dispatch `new Event('vv-app-ready')` to immediately hide the loader (useful after async data loads).
  // - A hard timeout ensures the loader won't block forever (30s default).

  (function waitForScripts(){
    const loadingDebounce = 180; // ms after last script finishes
    const hardTimeout = 30000; // 30s
    const pending = new Set();
    let hideTimer = null;
    let finished = false;

    function checkAndHide(){
      if (finished) return;
      if (pending.size === 0){
        clearTimeout(hideTimer);
        hideTimer = setTimeout(()=>{ finished = true; window.hideGlobalLoading(0); }, loadingDebounce);
      }
    }

    function onScriptDone(ev){
      const el = ev.currentTarget;
      pending.delete(el);
      el.removeEventListener('load', onScriptDone);
      el.removeEventListener('error', onScriptDone);
      checkAndHide();
    }

    function watchScript(el){
      if (!el || pending.has(el)) return;
      // Ignore the loader itself
      if (el.id === 'global-loading') return;
      if (!el.src) return;
      pending.add(el);
      el.addEventListener('load', onScriptDone);
      el.addEventListener('error', onScriptDone);
    }

    // Attach to existing scripts (except this file)
    Array.from(document.getElementsByTagName('script')).forEach(s => {
      try{ if (s.src && !s.src.includes('loading.js')) watchScript(s); }catch(e){}
    });

    // Observe newly added scripts
    const mo = new MutationObserver(muts => {
      for (const m of muts){
        for (const n of m.addedNodes){
          if (n.tagName && n.tagName.toLowerCase() === 'script'){
            try{ if (n.src && !n.src.includes('loading.js')) watchScript(n); }catch(e){}
          }
        }
      }
    });
    mo.observe(document.documentElement || document, { childList: true, subtree: true });

    // Expose a manual ready signal for app code that also needs to wait for data
    window.vvAppReady = function(){ finished = true; mo.disconnect(); window.hideGlobalLoading(80); };
    window.addEventListener('vv-app-ready', ()=> window.vvAppReady());

    // Fallbacks: if nothing was pending (e.g. no external scripts), hide after short debounce
    checkAndHide();

    // Hard timeout to prevent infinite loading
    setTimeout(()=>{ if (!finished){ finished = true; mo.disconnect(); window.hideGlobalLoading(0); } }, hardTimeout);
  })();

  // For module consumers
  try{ if (typeof module !== 'undefined') module.exports = { hideGlobalLoading: window.hideGlobalLoading, showGlobalLoading: window.showGlobalLoading }; }catch(e){}

})();
