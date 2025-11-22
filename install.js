let deferredPrompt = null;

const installButton = document.getElementById("install-button");
const dismissMessage = document.getElementById("dismiss-message");
const instructions = document.getElementById("install-instruction");

// Safe-initialize UI
if (dismissMessage) dismissMessage.style.display = "none";
if (instructions) instructions.style.display = "none";

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
                    window.location.replace("/index.html");
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
        window.location.replace("/index.html");
});