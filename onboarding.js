// Simple onboarding / tutorial foundation
// Exposes window.Onboarding with init, trackSectionVisit, startSetupFlow
;(function (global) {
  if (global.Onboarding) return;

  const LS_PREFIX = 'vv_onboard';

  function lsKey(...parts) { return [LS_PREFIX].concat(parts).join(':'); }

  function nowISO(){ return new Date().toISOString(); }

  const defaultMessages = {
    ads: ['This is Ads Management. Create and monitor ad campaigns here.', 'Click "View Details" to open ads dashboard.'],
    crmlanding: ['Sales & Follow-Ups: manage leads and conversations here.','Click the Sales & Follow-Ups card to view contacts.'],
    aiassistant: ['AI Assistant helps you automate tasks and replies.','Try asking it to follow up with a lead.'],
    livechat: ['Live Chat keeps you connected to customers in real-time.','Enable and configure widgets from this page.'],
    mybusiness: ['This is your business profile. Complete these details to get started.','Add business name, address, and logo for a better experience.']
  };

  function safeGet(obj, key, fallback=null){ try{ return obj && obj[key] ? obj[key] : fallback; }catch(e){return fallback;} }

  function createModal(title, html) {
    const wrapper = document.createElement('div');
    wrapper.className = 'vv-onboard-modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60';
    wrapper.innerHTML = `
      <div class="bg-[#1a1d23] p-6 rounded-2xl border border-[#2b2f3a] max-w-lg w-full mx-4 relative">
        <button class="vv-onboard-close absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
        <h3 class="text-xl font-bold text-white mb-4">${title}</h3>
        <div class="vv-onboard-body text-white/80 text-sm">${html}</div>
      </div>
    `;
    wrapper.querySelector('.vv-onboard-close').addEventListener('click', ()=> wrapper.remove());
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function showTooltipNear(el, text, opts={duration:6000}){
    try{
      if(!el || !(el instanceof HTMLElement)){
        const m = document.createElement('div');
        m.className = 'vv-onboard-toast fixed bottom-6 right-6 bg-[#111318] text-white p-3 rounded shadow';
        m.textContent = text;
        document.body.appendChild(m);
        setTimeout(()=>m.remove(), opts.duration || 4000);
        return m;
      }
      const rect = el.getBoundingClientRect();
      const tip = document.createElement('div');
      tip.className = 'vv-onboard-tooltip bg-[#111318] text-white p-2 rounded shadow z-70';
      tip.style.position = 'fixed';
      tip.style.maxWidth = '320px';
      tip.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
      tip.style.top = Math.max(8, rect.top + window.scrollY - 48) + 'px';
      tip.style.padding = '8px 10px';
      tip.textContent = text;
      document.body.appendChild(tip);
      setTimeout(()=>{ try{ tip.remove(); }catch(e){} }, opts.duration || 4000);
      return tip;
    }catch(e){ console.warn('showTooltipNear', e); }
  }

  const Onboarding = {
    init(options={}){
      this.userId = safeGet(options,'userId',null);
      this.businessId = safeGet(options,'businessId',null);
      this.tutorialLimit = safeGet(options,'tutorialLimit',3);
      this.analytics = safeGet(options,'analytics', null);
      // If first-time setup not completed, offer setup after small delay
      setTimeout(()=>{
        if(!this.isSetupCompleted()){
          this.startSetupFlow();
        }
      }, 600);
    },

    isSetupCompleted(){
      const key = lsKey('setup_done', this.businessId || 'anon');
      return !!localStorage.getItem(key);
    },

    markSetupCompleted(){
      const key = lsKey('setup_done', this.businessId || 'anon');
      try{ localStorage.setItem(key, nowISO()); }catch(e){}
      try{ this.analytics && this.analytics.track && this.analytics.track({type:'onboarding', name:'setup_completed', data:{businessId:this.businessId}}); }catch(e){}
    },

    startSetupFlow(){
      try{
        if(this.isSetupCompleted()) return;
        const html = `
          <p>Please complete a few setup steps to get the best experience.</p>
          <ul class="mt-3 text-sm text-white/70">
            <li>1. Add business name and contact details.</li>
            <li>2. Add payment and subscription preferences.</li>
            <li>3. Invite team members (optional).</li>
          </ul>
          <div class="mt-4 flex gap-3">
            <button id="vv-setup-now" class="px-4 py-2 bg-blue-600 text-white rounded">Setup Now</button>
            <button id="vv-setup-later" class="px-4 py-2 bg-transparent border border-white/20 text-white rounded">Remind me later</button>
          </div>
        `;
        const modal = createModal('Welcome! Let\'s set up your Business', html);
        modal.querySelector('#vv-setup-now').addEventListener('click', ()=>{
          try{ modal.remove(); }catch(e){}
          // navigate to My Business page
          try{ window.location.href = 'mybusiness.html'; }catch(e){}
          this.markSetupCompleted();
          try{ this.analytics && this.analytics.track && this.analytics.track({type:'onboarding', name:'setup_started', data:{businessId:this.businessId}}); }catch(e){}
        });
        modal.querySelector('#vv-setup-later').addEventListener('click', ()=>{
          try{ modal.remove(); }catch(e){}
          // set a short cooldown so we don't immediately show again
          const key = lsKey('setup_snooze', this.businessId || 'anon');
          try{ localStorage.setItem(key, nowISO()); }catch(e){}
          try{ this.analytics && this.analytics.track && this.analytics.track({type:'onboarding', name:'setup_snoozed', data:{businessId:this.businessId}}); }catch(e){}
        });
        try{ this.analytics && this.analytics.track && this.analytics.track({type:'onboarding', name:'setup_shown', data:{businessId:this.businessId}}); }catch(e){}
      }catch(e){ console.warn('startSetupFlow', e); }
    },

    _visitKey(section){ return lsKey('visits', this.businessId || 'anon', section); },

    trackSectionVisit(section, el){
      try{
        const key = this._visitKey(section);
        const raw = localStorage.getItem(key) || '0';
        let n = parseInt(raw,10) || 0;
        n = n + 1;
        localStorage.setItem(key, String(n));
        try{ this.analytics && this.analytics.track && this.analytics.track({type:'onboarding', name:'section_visit', data:{section, count:n}}); }catch(e){}
        if(n <= this.tutorialLimit){
          // show a short tutorial/toast for this section
          const msgs = defaultMessages[section] || defaultMessages[section.toLowerCase()] || [`Welcome to ${section}`];
          const first = msgs[0];
          showTooltipNear(el || document.querySelector('a[href*="'+section+'"], [data-section="'+section+'"]'), first, {duration: 6000});
          try{ this.analytics && this.analytics.track && this.analytics.track({type:'onboarding', name:'section_tutorial_shown', data:{section, count:n}}); }catch(e){}
        }
      }catch(e){ console.warn('trackSectionVisit', e); }
    },

    resetSectionVisits(section){ try{ localStorage.removeItem(this._visitKey(section)); }catch(e){} },

    // helper to attach a click listener for sidebar nav to track visits
    attachNavTracker(selector='#sidebar a'){
      try{
        document.addEventListener('click', (ev)=>{
          try{
            const a = ev.target.closest ? ev.target.closest(selector) : null;
            if(!a) return;
            const href = a.getAttribute('href') || '';
            // derive a section key from href or data-section
            const ds = a.getAttribute('data-section');
            let section = ds || href.split('/').pop().split('.').shift() || a.textContent.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
            section = section.toString().toLowerCase();
            this.trackSectionVisit(section, a);
          }catch(e){}
        }, {capture:true});
      }catch(e){ console.warn('attachNavTracker', e); }
    }
  };

  global.Onboarding = Onboarding;

})(window);
