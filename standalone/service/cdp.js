"use strict";

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');
const os = require('os');

const SDB_PORT = 26101;
const DEVICE_API = 'http://127.0.0.1:8001/api/v2/';
const UI_APP_SUFFIX = '.TizenTubeStandalone';
const YOUTUBE_TV_URL = 'https://www.youtube.com/tv?additionalDataUrl=' +
    encodeURIComponent('http://localhost:8085/dial/apps/YouTube');

const state = {
    phase: 'idle',
    action: null,
    error: null
};

const isTizen3 = (function () {
    try {
        return tizen.systeminfo
            .getCapability('http://tizen.org/feature/platform.version')
            .startsWith('3.0');
    } catch (e) {
        return false;
    }
})();

function uiAppId() {
    return tizen.application.getAppInfo().packageId + UI_APP_SUFFIX;
}

function tvAddress() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
        for (const entry of interfaces[name]) {
            if (entry.family === 'IPv4' && !entry.internal) return entry.address;
        }
    }
    return '127.0.0.1';
}

function canLaunchInDebug() {
    return fetch(DEVICE_API)
        .then((res) => res.json())
        .then((json) =>
            (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') &&
            json.device.developerMode === '1')
        .catch(() => false);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let exitAcked = false;

function noteExitAck() {
    exitAcked = true;
}

function waitForExitAck(timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
        const check = () => {
            if (exitAcked || Date.now() - startedAt > timeoutMs) return resolve(exitAcked);
            setTimeout(check, 150);
        };
        check();
    });
}

function getDebugPort() {
    return new Promise((resolve, reject) => {
        const conn = adbhost.createConnection({ host: '127.0.0.1', port: SDB_PORT });
        let settled = false;

        const timer = setTimeout(
            () => finish(reject, new Error('sdbd did not return a debug port')), 8000);

        function finish(fn, arg) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(arg);
        }

        conn._stream.on('error', (e) => finish(reject, e));
        conn._stream.on('connect', () => {
            const stream = conn.createStream(
                'shell:0 debug ' + uiAppId() + (isTizen3 ? ' 0' : ''));

            stream.on('data', (data) => {
                const match = data.toString().match(/port:\s*(\d+)/);
                if (!match) return;
                finish(resolve, Number(match[1]));
                setTimeout(() => {
                    try { conn._stream.end(); } catch (e) { }
                }, 1000);
            });
            stream.on('error', (e) => finish(reject, e));
        });
    });
}

let liveClient = null;

function applyUserAgent(userAgent) {
    if (!liveClient || !userAgent) return Promise.resolve(false);
    return liveClient.Network.setUserAgentOverride({ userAgent: userAgent })
        .catch(() => liveClient.Emulation.setUserAgentOverride({ userAgent: userAgent }))
        .then(() => true)
        .catch(() => false);
}

function attach(port, options) {
    return CDP({ port: port, host: tvAddress(), local: true })
        .catch(() => CDP({ port: port, host: '127.0.0.1', local: true }))
        .then((client) => {
            liveClient = client;

            return client.Page.enable()
                .then(() => client.Runtime.enable())
                .then(() => client.Network.enable().catch(() => { }))
                .then(() => client.Page.setBypassCSP({ enabled: true }).catch(() => { }))
                .then(() => fetch(options.userScriptUrl).then((r) => r.text()))
                .then((source) => client.Page
                    .addScriptToEvaluateOnNewDocument({ expression: source })
                    .catch(() => {
                        client.on('Runtime.executionContextCreated', (msg) => {
                            client.Runtime.evaluate({
                                expression: source,
                                contextId: msg.context.id
                            }).catch(() => { });
                        });
                    }))
                .then(() => {
                    state.phase = 'ready';
                    return client.Page.navigate({ url: YOUTUBE_TV_URL });
                });
        });
}

let started = false;

function start(options) {
    if (started) return;
    started = true;

    canLaunchInDebug()
        .then((allowed) => {
            if (!allowed) {
                throw new Error('Developer mode must be on with Host PC IP set to 127.0.0.1');
            }

            state.phase = 'restarting';
            state.action = 'exit-for-debug';
            return waitForExitAck(6000);
        })
        .then((acked) => delay(acked ? 1200 : 300))
        .then(() => {
            state.action = null;
            state.phase = 'connecting';
            return getDebugPort();
        })
        .then((port) => attach(port, options))
        .catch((e) => {
            state.phase = 'failed';
            state.error = e && e.message ? e.message : String(e);
        });
}

module.exports = {
    start: start,
    state: state,
    noteExitAck: noteExitAck,
    applyUserAgent: applyUserAgent
};
