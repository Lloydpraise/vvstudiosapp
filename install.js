let deferredPrompt = null;

const installButton = document.getElementById("install-button");
const dismissMessage = document.getElementById("dismiss-message");
const instructions = document.getElementById("install-instruction");

// Hide messages at load
dismissMessage.style.display = "none";
instructions.style.display = "none";

// Listen for BEFORE INSTALL PROMPT
window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();  
    deferredPrompt = e;

    // Enable install button
    installButton.disabled = false;
});

// Install button click
installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
        // No automatic prompt available → show manual help
        instructions.style.display = "block";
        return;
    }

    deferredPrompt.prompt();

    const choiceResult = await deferredPrompt.userChoice;

    if (choiceResult.outcome === "accepted") {
        // Installed → go to app
        window.location.replace("index.html");
    } else {
        // User dismissed → force install
        dismissMessage.style.display = "block";
    }

    deferredPrompt = null;
});

// Detect if installed AFTER prompt or from browser menu
window.addEventListener("appinstalled", () => {
    window.location.replace("index.html");
});
