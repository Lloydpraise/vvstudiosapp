// Expose a startTour function so it can be triggered on demand (e.g., by a button).
function startTour(force = false) {
    // 1. Check if tour has already been completed
    const TOUR_KEY = 'vv_onboarding_tour_completed';
    const isTourDone = localStorage.getItem(TOUR_KEY);

    // If tour already completed and not forced, don't run
    if (isTourDone && !force) return;

    // 2. Initialize the Driver
    const driver = window.driver && window.driver.js && window.driver.js.driver;
    if (!driver) return; // driver.js not available

    const tour = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        doneBtnText: 'Get Started',
        nextBtnText: 'Next',
        prevBtnText: 'Back',
        popoverClass: 'vv-tour-theme',
        steps: [
            { element: '#sidebar', popover: { title: 'Your Command Center', description: 'Navigate between your Business Dashboard, Ecommerce store, and Content tools here. <br><br>🔒 <b>Note:</b> Features with a lock icon require an upgrade to access.', side: 'right', align: 'start' } },
            { element: '.grid.grid-cols-1.md\\:grid-cols-2', popover: { title: 'Your Roadmap to Success', description: 'Complete these 5 tasks to set up your profile and create your first offer. Once completed, you will unlock a <b>1-on-1 Strategy Call</b>.', side: 'bottom', align: 'center' } },
            { element: '#vision-board-data', popover: { title: 'Your Vision Board', description: 'This is where the magic happens. We calculate your potential Monthly Sales, Leads, and Profit based on your inputs. Watch these numbers grow!', side: 'top', align: 'center' } },
            { element: '#learn-services-card', popover: { title: 'Learn About Our Services', description: 'Explore how our services help you scale. Click "About Services" to dive deeper.', side: 'top', align: 'center' } },
            { element: '#qualifier-copywriter-cards', popover: { title: 'Qualifier & Copywriter', description: 'Use the Lead Qualifier to identify high-intent prospects, and the AI Copywriter to craft compelling copy for ads and products. Try either tool to boost conversions.', side: 'top', align: 'center' } },
            { element: '#learn-digital-card', popover: { title: 'Start Learning', description: 'Master digital marketing fundamentals with our learning resources. Click "Start Learning" to begin.', side: 'top', align: 'center' } }
        ],
        onDestroyStarted: () => {
            localStorage.setItem(TOUR_KEY, 'true');
            try { tour.destroy(); } catch (e) { }
        }
    });

    // Handle Vision Board visibility (fallback if hidden)
    try {
        const visionStepIndex = 2;
        const visionBoardEl = document.getElementById('vision-board-data');
        const visionBoardVisible = visionBoardEl && !visionBoardEl.classList.contains('hidden');
        if (!visionBoardVisible) {
            tour.getConfig().steps[visionStepIndex].element = '#vision-board-empty';
            const emptyEl = document.getElementById('vision-board-empty');
            if (emptyEl && emptyEl.classList.contains('hidden')) {
                tour.getConfig().steps[visionStepIndex].element = 'h2.text-xl.font-bold';
            }
        }
    } catch (e) { }

    // Start the tour with a slight delay to ensure UI is ready
    setTimeout(() => { try { tour.drive(); } catch (e) { } }, 500);
}

// Auto-start on initial page load if appropriate
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startTour);
} else {
    try { startTour(); } catch (e) { }
}

    // Make function callable from other scripts (e.g., button onclick)
window.startTour = startTour;