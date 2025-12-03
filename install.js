let deferredPrompt = null;

const installButton = document.getElementById("install-button");
const dismissMessage = document.getElementById("dismiss-message");
const instructions = document.getElementById("install-instruction");
const openAppButton = document.getElementById('open-app-button');
const START_URL = 'index.html'; // app start URL (adjust if your manifest uses a different start_url)

// Safe-initialize UI
if (dismissMessage) dismissMessage.style.display = "none";
if (instructions) instructions.style.display = "none";
if (openAppButton) openAppButton.style.display = 'none';

// Ensure install button is enabled and visible so user can trigger install
if (installButton) {
    installButton.disabled = false;
}

// Listen for BEFORE INSTALL PROMPT
window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;

        // Show the install button now that the app is installable
        if (installButton) {
                installButton.classList.remove('hidden');
                installButton.disabled = false;
        }

        console.log('beforeinstallprompt captured');
});

// Install button click
if (installButton) {
    installButton.addEventListener("click", async () => {
        try {
            if (!deferredPrompt) {
                // No automatic prompt available → show manual help
                if (instructions) instructions.style.display = "block";
                return;
            }

            installButton.disabled = true;
            await deferredPrompt.prompt();

            const choiceResult = await deferredPrompt.userChoice;

                if (choiceResult && choiceResult.outcome === "accepted") {
                 // Accepted the install prompt. Show install instructions and an explicit Open button.
                 if (instructions) instructions.style.display = "block";
                 if (openAppButton) openAppButton.style.display = 'block';

                 // Best-effort: attempt to navigate to start URL. Note: browsers may open this in the current tab,
                 // not launch the installed PWA. We keep an explicit button so user can tap to open the app.
                 try {
                     setTimeout(() => { window.location.href = START_URL; }, 800);
                 } catch (e) { /* ignore */ }
                } else {
                    // User dismissed → show message
                    if (dismissMessage) dismissMessage.style.display = "block";
                }
        } catch (err) {
            console.error('Error showing install prompt:', err);
            if (instructions) instructions.style.display = "block";
        } finally {
            deferredPrompt = null;
        }
    });
}

// Detect if installed AFTER prompt or from browser menu
window.addEventListener("appinstalled", () => {
    // The app was installed. Show confirmed instructions and an Open button.
    if (instructions) instructions.style.display = "block";
    if (openAppButton) {
        openAppButton.style.display = 'block';
        // Clicking open will navigate to the app start URL (best-effort). Some browsers
        // may not launch the native-like installed PWA automatically for security reasons.
        openAppButton.addEventListener('click', () => {
            try { window.location.href = START_URL; } catch (e) { window.location.replace(START_URL); }
        });
    }

    // Best-effort auto-redirect: try to open the start URL after a short delay. This may open
    // the app in some environments but not all. We still present the explicit button above.
    try { setTimeout(() => { window.location.href = START_URL; }, 700); } catch (e) {}
});
