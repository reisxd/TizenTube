import { configChangeEmitter, configRead } from '../config.js';

configChangeEmitter.addEventListener('configChange', (event) => {
    const { key, value } = event.detail;
    if (key === 'enableWhoIsWatchingMenu') {
        disableWhosWatching(value);
    }
});

let interval;

function disableWhosWatching(value) {
    // FIX: Wrap the entire function body — localStorage may be missing or corrupt
    // (e.g. first boot, reset, or storage quota hit) and JSON.parse can throw.
    let LeanbackRecurringActions;
    try {
        const raw = localStorage['yt.leanback.default::recurring_actions'];
        if (!raw) {
            console.warn('[disableWhosWatching] recurring_actions not found in localStorage — skipping');
            return;
        }
        LeanbackRecurringActions = JSON.parse(raw);
    } catch (err) {
        console.warn('[disableWhosWatching] Failed to read/parse recurring_actions:', err);
        return;
    }

    const shouldPermanentlyEnable = configRead('permanentlyEnableWhoIsWatchingMenu');
    const date = new Date();

    if (!value) {
        try {
            // Setting it after 7 days should be enough, as it'll get executed every time the app launches.
            date.setDate(date.getDate() + 7);
            LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"] &&
                (LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"].lastFired = date.getTime());
            LeanbackRecurringActions.data.data.whos_watching_fullscreen_zero_accounts.lastFired = date.getTime();
            LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"] &&
                (LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"].lastFired = date.getTime());
            localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(LeanbackRecurringActions);
        } catch (err) {
            console.warn('[disableWhosWatching] Failed to disable who\'s watching menu:', err);
        }
    } else {
        try {
            // Do nothing if the last fired action is less than 2 hours ago.
            if (
                date.getTime() - LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"]?.lastFired > 0 &&
                date.getTime() - LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"]?.lastFired < 2 * 60 * 60 * 1000 &&
                !shouldPermanentlyEnable
            ) {
                return;
            }

            function setActions() {
                try {
                    LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"] &&
                        (LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"].lastFired = date.getTime());
                    LeanbackRecurringActions.data.data.whos_watching_fullscreen_zero_accounts.lastFired = date.getTime();
                    LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"] &&
                        (LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"].lastFired = date.getTime());
                    localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(LeanbackRecurringActions);
                } catch (err) {
                    console.warn('[disableWhosWatching] setActions failed:', err);
                }
            }

            setActions();
            if (shouldPermanentlyEnable) {
                date.setDate(date.getDate() - 7);
                setActions();
                interval = setInterval(setActions, 60 * 1000);
            } else if (interval) {
                clearInterval(interval);
            }
        } catch (err) {
            console.warn('[disableWhosWatching] Failed to enable who\'s watching menu:', err);
        }
    }
}

disableWhosWatching(configRead('enableWhoIsWatchingMenu'));