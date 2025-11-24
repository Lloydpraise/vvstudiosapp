// Simple theme toggler for VV Studios
(function(){
    const THEME_KEY = 'vvTheme';

    function setTheme(t){
        const theme = (t === 'light') ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
        if(theme === 'dark') document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem(THEME_KEY, theme); } catch(e){}
        updateButtons(theme);
    }

    function updateButtons(theme){
        document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
            if(btn.dataset.theme === theme) btn.classList.add('active'); else btn.classList.remove('active');
        });
    }

    function init(){
        let saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch(e){}
        if(!saved) saved = 'dark';
        setTheme(saved);

        document.addEventListener('click', function(e){
            const b = e.target.closest && e.target.closest('.theme-toggle-btn');
            if(!b) return;
            const t = b.dataset.theme;
            setTheme(t);
        });
    }

    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    // expose small helper for console/debug
    window.vvTheme = { set: setTheme, get: () => (localStorage.getItem(THEME_KEY) || 'dark') };
})();
