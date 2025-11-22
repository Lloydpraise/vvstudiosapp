// Lightweight SPA loader: swaps HTML into #app without full reloads
async function loadPage(page) {
    try {
        // Try cache first (works offline if service worker cached pages)
        const cacheMatch = await caches.match('/' + page + '.html');
        if (cacheMatch) {
            const html = await cacheMatch.text();
            document.getElementById('app').innerHTML = html;
            return;
        }

        // Fallback to network fetch
        const res = await fetch('/' + page + '.html', { cache: 'no-cache' });
        if (!res.ok) throw new Error('Network response was not ok');
        const html = await res.text();
        document.getElementById('app').innerHTML = html;
    } catch (err) {
        document.getElementById('app').innerHTML = '<h1>Page not found</h1>';
        console.warn('loadPage error:', err);
    }
}

function go(page) {
    loadPage(page);
}

// Expose for inline handlers and other scripts
window.loadPage = loadPage;
window.go = go;

export { loadPage, go };
