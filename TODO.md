# Subscription Calculator Fix

## Tasks
- [ ] Edit auth.js: Modify applyDefaultPackageSettings to compute expiry from renew date if present (30 days), else from joined date (package duration).
- [ ] Edit dashboard.js: Update updateSubscriptionStatus to set joinTimestamp to renew date if present, else joined date; set period to 30 if renew, else package duration.
- [ ] Edit ads-dashboard.js: Same as dashboard.js.
- [ ] Test the changes by checking subscription status in dashboard.

## Notes
- Renew date takes priority over joined date.
- Expiry is always 30 days from renew date if present.
- For joined date, expiry is package duration from joined date.
