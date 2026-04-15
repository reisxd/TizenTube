/**
 * logServer.js — Remote log forwarding via TizenBrew CDP queue
 *
 * TizenTube pushes log entries into window.__ttLogQueue (a plain JS array).
 * TizenBrew's service polls that queue every second via CDP Runtime.evaluate
 * and forwards entries into logBus → remoteLogger → PS1 receiver on PC.
 *
 * No XHR or WebSocket is used — Cobalt blocks both from the HTTPS YouTube TV
 * page context. The CDP channel (already open for module injection) is the
 * only reliable path back to the TizenBrew service.
 *
 * Enable/disable: Settings → Miscellaneous → Remote Log Server → Enable Remote Logging
 */

import { configRead } from '../config.js';

const MAX_QUEUE = 300;

function isEnabled() {
    try { return !!configRead('logServerEnabled'); } catch { return false; }
}

function pushToQueue(entry) {
    if (!Array.isArray(window.__ttLogQueue)) window.__ttLogQueue = [];
    if (window.__ttLogQueue.length < MAX_QUEUE) window.__ttLogQueue.push(entry);
}

export function sendRemotePayload(_url, entry) {
    if (!isEnabled()) return Promise.resolve();
    pushToQueue(entry);
    return Promise.resolve();
}

// ── Install ───────────────────────────────────────────────────────────────────

function install() {
    if (window.__ttLogServerInstalled) return;
    window.__ttLogServerInstalled = true;

    if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];
    const origPush = Array.prototype.push;
    const arr = window.__ttFileOnlyLogs;
    arr.push = function (...args) {
        const result = origPush.apply(this, args);
        if (!isEnabled()) return result;
        for (const line of args) {
            try {
                const raw = String(line);
                const m = raw.match(/^\[([^\]]+)\] \[TT_ADBLOCK_FILE\] (\S+) ([\s\S]*)$/);
                let entry;
                if (m) {
                    const ts      = m[1];
                    const label   = m[2];
                    const payload = (() => { try { return JSON.parse(m[3]); } catch { return m[3]; } })();
                    const payloadStr = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
                    entry = {
                        ts,
                        level:      'INFO',
                        label,
                        payload,
                        _formatted: `[${ts}] [INFO] [TizenTube] ${label} ${payloadStr}`,
                        context:    'TizenTube',
                        message:    `${label} ${payloadStr}`,
                        data:       payload,
                    };
                } else {
                    const ts = new Date().toISOString();
                    entry = {
                        ts,
                        level:      'INFO',
                        label:      'raw',
                        payload:    raw,
                        _formatted: `[${ts}] [INFO] [TizenTube] ${raw}`,
                        context:    'TizenTube',
                        message:    raw,
                    };
                }
                pushToQueue(entry);
            } catch (_) {}
        }
        return result;
    };
}

install();
