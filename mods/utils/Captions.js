// Shared utils for caption features

import { configRead, configWrite } from '../config.js';

export const EVENTS = {
    YT_STATE_CHANGE: 'onStateChange',
    YT_CAPTIONS_SETTINGS_CHANGED: 'captionssettingschanged',
    YT_CAPTIONS_TRACKLIST_CHANGED: 'onCaptionsTrackListChanged',
    CONFIG_CHANGE: 'configChange',
}

const RAW_BACKUPS_KEY = 'captionRawKeyBackups';
const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * Keeps the given localStorage keys alive.
 * Set expiration far into the future and restore them from our own backups if YouTube dropped them.
 */
export function refreshRawKeys(keys, logPrefix) {
    const backups = configRead(RAW_BACKUPS_KEY) || {};
    let backupsChanged = false;

    for (const key of keys) {
        try {
            const stored = localStorage[key];
            if (stored) {
                const wrapper = JSON.parse(stored);
                if (backups[key] !== wrapper.data) {
                    backups[key] = wrapper.data;
                    backupsChanged = true;
                }
                localStorage[key] = JSON.stringify({ data: wrapper.data, expiration: Date.now() + FAR_FUTURE_MS, creation: Date.now() });
            } else if (backups[key] !== undefined) {
                localStorage[key] = JSON.stringify({ data: backups[key], expiration: Date.now() + FAR_FUTURE_MS, creation: Date.now() });
            }
        } catch (e) {
            console.warn(`${logPrefix} failed to refresh key`, key, e);
        }
    }

    if (backupsChanged) configWrite(RAW_BACKUPS_KEY, backups);
}
