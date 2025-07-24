import { configChangeEmitter, configRead } from '../config.js';

configChangeEmitter.addEventListener('configChange', (event) => {
    const { key, value } = event.detail;
    if (key === 'enableWhoIsWatchingMenu') {
        disableWhosWatching(value);
    }
});

function disableWhosWatching(value) {
    const LeanbackRecurringActions = JSON.parse(localStorage['yt.leanback.default::recurring_actions']);
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
        if (date.getTime() - LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"]?.lastFired > 0 && date.getTime() - LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"]?.lastFired < 2 * 60 * 60 * 1000) {
            return;
        }
        LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"] && 
            (LeanbackRecurringActions.data.data["startup-screen-account-selector-with-guest"].lastFired = date.getTime());
        LeanbackRecurringActions.data.data.whos_watching_fullscreen_zero_accounts.lastFired = date.getTime();
        LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"] &&
            (LeanbackRecurringActions.data.data["startup-screen-signed-out-welcome-back"].lastFired = date.getTime());
        localStorage['yt.leanback.default::recurring_actions'] = JSON.stringify(LeanbackRecurringActions);
    }
}

disableWhosWatching(configRead('enableWhoIsWatchingMenu'));