import { configChangeEmitter, configRead } from '../config.js';

configChangeEmitter.addEventListener('configChange', (event) => {
    const { key, value } = event.detail;
    if (key === 'enableWhoIsWatchingMenu') {
        retries = 0;
        disableWhosWatching(value);
    }
});

let interval;
let retryTimer;
let retries = 0;

function disableWhosWatching(value) {
    clearTimeout(retryTimer);
    let LeanbackRecurringActions;
    try {
        LeanbackRecurringActions = JSON.parse(localStorage['yt.leanback.default::recurring_actions']);
    } catch (_) {
        // YouTube creates this storage record after its first startup.
    }
    if (!LeanbackRecurringActions?.data?.data?.whos_watching_fullscreen_zero_accounts) {
        if (retries++ < 40) {
            retryTimer = setTimeout(() => disableWhosWatching(configRead('enableWhoIsWatchingMenu')), 250);
        }
        return;
    }
    retries = 0;
    const shouldPermanentlyEnable = configRead('permanentlyEnableWhoIsWatchingMenu');
    const date = new Date();
    if (!value) {
        // Setting it after 7 days should be enough, as it'll get executed every time the app launches.
        date.setDate(date.getDate() + 7);
        LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"] && 
            (LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"].lastFired = date.getTime());
        LeanbackRecurringActions.data.data.whos_watching_fullscreen_zero_accounts.lastFired = date.getTime();
        LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"] && 
            (LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"].lastFired = date.getTime());
        localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(LeanbackRecurringActions);
    } else {
        // Do nothing if the last fired action is less than 2 hours ago.
        if (date.getTime() - LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"]?.lastFired > 0 && date.getTime() - LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"]?.lastFired < 2 * 60 * 60 * 1000
        && !shouldPermanentlyEnable) {
            return;
        }
        function setActions() {
            LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"] && 
                (LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"].lastFired = date.getTime());
            LeanbackRecurringActions.data.data.whos_watching_fullscreen_zero_accounts.lastFired = date.getTime();
            LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"] &&
                (LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"].lastFired = date.getTime());
            localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(LeanbackRecurringActions);
        }
        setActions();
        if (shouldPermanentlyEnable) {
            date.setDate(date.getDate() - 7);
            setActions();
            interval = setInterval(setActions, 60 * 1000);
        } else if (interval) clearInterval(interval);
    }
}

disableWhosWatching(configRead('enableWhoIsWatchingMenu'));
