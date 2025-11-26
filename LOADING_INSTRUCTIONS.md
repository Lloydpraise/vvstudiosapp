Usage: Global Loading Overlay

Files added
- `loading.js` — JavaScript file that injects a global loading overlay and styles.

How to use
1. Add the loader script as the very first script in the `<head>` of each page so it appears while other scripts load:

   <script src="loading.js"></script>

2. App readiness and data loading

    The loader now waits for all external `<script src="...">` elements to finish loading. However, if your app performs additional async work (fetching data, rendering after data arrives), signal readiness explicitly from your app when everything is ready for the user:

    - Call the helper directly when your app is finished:

       <script>
          // when app and its data are ready for interaction:
          window.vvAppReady();
       </script>

    - Or dispatch an event:

       <script>
          document.dispatchEvent(new Event('vv-app-ready'));
       </script>

    Both options immediately hide the global loader. If you don't call them, the loader will still wait for all external scripts and will auto-hide as a fallback after a short timeout.

Notes
- The loader auto-hides on the `load` event as a fallback if you don't call `hideGlobalLoading()`.
- For SPA frameworks, call `hideGlobalLoading()` once route/page code has finished rendering.
- Theme: the loader respects `prefers-color-scheme`. If your app toggles theme by adding `data-theme="light"` on `html`, the overlay becomes light automatically.

Example integration (simple):

1. In your HTML `<head>` near the top:

   <script src="loading.js"></script>
   <script src="router.js" defer></script>
   <script src="dashboard.js" defer></script>

2. In your main app bootstrap (after initialization):

   window.hideGlobalLoading();

If you want, I can automatically add the `<script>` tag to all pages in the project. Ask me to proceed and I'll update the HTML files.
