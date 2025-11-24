// Lightweight frontend analytics util
// Exposes window.Analytics with init(options) and track(event)
;(function (global) {
  if (global.Analytics) return; // don't override

  const DEFAULTS = {
    endpoint: '/rpc/track_event',
    headers: { 'Content-Type': 'application/json' },
    autoTrack: true,
    batch: false,
    batchIntervalMs: 3000
  };

  function nowISO() { return new Date().toISOString(); }

  function guessDevice() {
    try {
      return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    } catch (e) { return 'unknown'; }
  }

  function safeJSON(v) {
    try { return JSON.stringify(v); } catch (e) { return JSON.stringify({ toString: String(v) }); }
  }

  const state = {
    opts: Object.assign({}, DEFAULTS),
    queue: [],
    sendFn: null
  };

  async function defaultSend(payload) {
    // payload is an object with keys matching the Postgres RPC params
    try {
      const res = await fetch(state.opts.endpoint, {
        method: 'POST',
        headers: state.opts.headers,
        body: JSON.stringify(payload)
      });
      return res;
    } catch (e) {
      console.warn('Analytics defaultSend error', e);
      return null;
    }
  }

  function flushQueue() {
    if (!state.queue.length) return;
    const q = state.queue.splice(0, state.queue.length);
    q.forEach(p => sendNow(p));
  }

  async function sendNow(payload) {
    try {
      if (state.sendFn) {
        await state.sendFn(payload);
        return;
      }
      await defaultSend(payload);
    } catch (e) {
      console.warn('Analytics sendNow error', e);
    }
  }

  function enqueueOrSend(payload) {
    if (state.opts.batch) {
      state.queue.push(payload);
    } else {
      sendNow(payload);
    }
  }

  function buildEvent({ type = 'interaction', name = '', data = {} } = {}) {
    const payload = {
      user_id: state.userId || null,
      business_id: state.businessId || null,
      event_type: type,
      event_name: name,
      event_data: (typeof data === 'string') ? { value: data } : (data || {}),
      page_url: window.location.href,
      screen_name: document.title || null,
      device_type: guessDevice(),
      platform: navigator.platform || null,
      browser: navigator.userAgent || null
    };
    return payload;
  }

  function detectModalOpen(mutationList) {
    for (const mut of mutationList) {
      if (mut.type === 'childList' && mut.addedNodes && mut.addedNodes.length) {
        mut.addedNodes.forEach(node => {
          try {
            if (!(node instanceof HTMLElement)) return;
            const cls = (node.className || '').toString().toLowerCase();
            const role = node.getAttribute && node.getAttribute('role');
            if (cls.includes('modal') || cls.includes('dialog') || role === 'dialog' || node.closest && node.closest('[role="dialog"],[class*=modal]')) {
              const id = node.id || node.getAttribute('aria-label') || node.getAttribute('data-modal-name') || node.className || 'modal';
              enqueueOrSend(buildEvent({ type: 'modal', name: 'open_modal', data: { id, html: node.outerHTML ? node.outerHTML.slice(0, 500) : null, timestamp: nowISO() } }));
            }
          } catch (e) {}
        });
      }
      if (mut.type === 'attributes' && mut.target) {
        try {
          const el = mut.target;
          if (!(el instanceof HTMLElement)) continue;
          const cls = (el.className || '').toString().toLowerCase();
          if (cls.includes('open') || cls.includes('show')) {
            const id = el.id || el.getAttribute('aria-label') || el.className || 'modal';
            enqueueOrSend(buildEvent({ type: 'modal', name: 'open_modal', data: { id, timestamp: nowISO() } }));
          }
        } catch (e) {}
      }
    }
  }

  function attachAutoTrack() {
    // click tracking
    document.addEventListener('click', function (ev) {
      try {
        const target = ev.target && (ev.target.closest ? ev.target.closest('[data-event-name], button, a, [role="button"], [role="link"]') : ev.target);
        const el = target || ev.target;
        if (!el) return;
        const name = el.getAttribute && (el.getAttribute('data-event-name') || el.getAttribute('aria-label') || el.textContent && el.textContent.trim().slice(0, 80)) || el.tagName;
        const data = {
          tag: el.tagName,
          id: el.id || null,
          classes: el.className || null,
          dataset: el.dataset || null,
          x: ev.clientX,
          y: ev.clientY,
          timestamp: nowISO()
        };
        enqueueOrSend(buildEvent({ type: 'interaction', name: String(name).trim().slice(0,120), data }));
      } catch (e) {}
    }, { capture: true, passive: true });

    // form submit
    document.addEventListener('submit', function (ev) {
      try {
        const form = ev.target;
        const name = form && (form.getAttribute && (form.getAttribute('name') || form.getAttribute('id')) ) || 'form_submit';
        const data = { id: form.id || null, name: name || null, action: form.action || null, timestamp: nowISO() };
        enqueueOrSend(buildEvent({ type: 'interaction', name: 'form_submit', data }));
      } catch (e) {}
    }, { capture: true });

    // observe DOM for modals
    try {
      const mo = new MutationObserver(detectModalOpen);
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
      state._mo = mo;
    } catch (e) {}

    if (state.opts.batch) {
      state._batchTimer = setInterval(() => { flushQueue(); }, state.opts.batchIntervalMs);
    }
  }

  const Analytics = {
    init(options = {}) {
      state.opts = Object.assign({}, state.opts, options || {});
      state.userId = options.userId || null;
      state.businessId = options.businessId || null;
      if (options.sendEvent && typeof options.sendEvent === 'function') {
        state.sendFn = async (payload) => {
          try { await options.sendEvent(payload); } catch (e) { console.warn('Analytics sendEvent wrapper error', e); }
        };
      }

      if (state.opts.autoTrack) {
        try { attachAutoTrack(); } catch (e) { console.warn('Analytics attachAutoTrack error', e); }
      }

      // initial page view
      enqueueOrSend(buildEvent({ type: 'page', name: 'page_view', data: { title: document.title, timestamp: nowISO() } }));
    },

    track({ type = 'interaction', name = '', data = {} } = {}) {
      const p = buildEvent({ type, name, data });
      enqueueOrSend(p);
    },

    setUser(userId, bizId) {
      state.userId = userId || state.userId;
      state.businessId = bizId || state.businessId;
    },

    _internal: state
  };

  global.Analytics = Analytics;

})(window);
