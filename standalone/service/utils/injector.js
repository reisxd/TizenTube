// Keep the debugger and script loader on the TV, independent of an external PC.
const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');
const createBootstrap = require('../script-bootstrap.js');
const script = createBootstrap(require('../userscript.json').source);

const LAUNCH_ATTEMPTS = 8;
const LAUNCH_TIMEOUT_MS = 2500;
const CONNECTING_TIMEOUT_MS = 60000;
const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');
let generation = 0;
let client;
let connectingSince = 0;
let startupDeadline;
const state = { phase: 'idle', isConnecting: false, lastError: '', attempt: 0 };

function closeClient() {
    const previous = client;
    client = null;
    if (!previous) return;
    try {
        const closing = previous.close();
        if (closing && closing.catch) closing.catch(() => {});
    } catch (_) {}
}

function fail(run, error) {
    if (run !== generation) return;
    generation++;
    clearTimeout(startupDeadline);
    state.phase = 'error';
    state.isConnecting = false;
    state.lastError = String(error && error.message || error);
    console.error('TizenTube startup:', state.lastError);
    closeClient();
}

function canConnectToDaemon() {
    if (state.isConnecting && Date.now() - connectingSince > CONNECTING_TIMEOUT_MS) {
        fail(generation, 'Timed out while starting the TV debugger.');
    }
    return fetch('http://127.0.0.1:8001/api/v2/', { timeout: 2000 })
        .then(res => res.json())
        .then(json => Object.assign({
            canConnectToDaemon: (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1',
            ip: json.device.ip
        }, state));
}

function attachDebugger(run, host, port, args, attempt) {
    if (run !== generation) return;
    state.phase = 'connecting';
    fetch('http://' + host + ':' + port, { timeout: 1000 }).then(() => {
        if (run !== generation) return;
        let connected = false;
        const timer = setTimeout(() => {
            if (!connected) fail(run, 'The TV inspector did not accept the connection.');
        }, 5000);
        try {
            const connection = CDP({ host, port, local: true }, cdp => {
                connected = true;
                clearTimeout(timer);
                if (run !== generation) {
                    cdp.close();
                    return;
                }
                client = cdp;
                cdp.on('disconnect', () => {
                    if (run !== generation) return;
                    client = null;
                    state.phase = 'idle';
                    state.isConnecting = false;
                });
                // The script is registered before navigation, for every new document.
                // No second CDN request races YouTube's player requests.
                // Chromium M63 has no Page.setBypassCSP command.
                cdp.Page.enable()
                    .then(() => cdp.Runtime.enable())
                    .then(() => cdp.Page.addScriptToEvaluateOnLoad({ scriptSource: script }))
                    .then(() => cdp.Page.navigate({ url: 'https://youtube.com/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8085%2Fdial%2Fapps%2FYouTube' + (args ? '&' + args : '') }))
                    .then(() => {
                        if (run !== generation) return;
                        state.phase = 'running';
                        state.isConnecting = false;
                        state.lastError = '';
                        clearTimeout(startupDeadline);
                    }).catch(error => fail(run, error));
            });
            connection.on('error', error => {
                clearTimeout(timer);
                fail(run, error);
            });
        } catch (error) {
            clearTimeout(timer);
            fail(run, error);
        }
    }).catch(error => {
        if (run !== generation) return;
        if (attempt < 10) {
            setTimeout(() => attachDebugger(run, host, port, args, attempt + 1), 250);
        } else fail(run, error);
    });
}

function launchDebugger(run, host, args, attempt) {
    if (run !== generation) return;
    state.phase = 'launching';
    state.attempt = attempt;
    let connection;
    let settled = false;
    let output = '';
    const timer = setTimeout(retry, LAUNCH_TIMEOUT_MS);

    function close() {
        if (!connection) return;
        try { connection._stream.end(); } catch (_) {}
    }

    function retry() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        close();
        if (run !== generation) return;
        if (attempt < LAUNCH_ATTEMPTS) {
            setTimeout(() => launchDebugger(run, host, args, attempt + 1), 400);
        } else fail(run, 'The TV did not return a debugger port after repeated launches.');
    }

    function readPort(complete) {
        if (settled) return;
        const lines = output.split('\n');
        if (!complete) lines.pop(); // A port number can be split between packets.
        for (const line of lines) {
            const match = /\bdebug\b.*\bport:\s*(\d{1,5})\b/.exec(line);
            if (!match) continue;
            const port = Number(match[1]);
            if (!port || port > 65535) continue;
            settled = true;
            clearTimeout(timer);
            close();
            attachDebugger(run, host, port, args, 1);
            return;
        }
        if (complete) retry();
    }

    try {
        connection = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });
        connection._stream.on('error', retry);
        connection._stream.on('connect', () => {
            if (settled || run !== generation) return;
            try {
                const packageId = tizen.application.getAppInfo().packageId;
                const command = connection.createStream('shell:0 debug ' + packageId + '.TizenTubeStandalone' + (isTizen3 ? ' 0' : ''));
                command.on('data', data => { output += data.toString(); readPort(false); });
                command.on('finish', () => readPort(true));
                command.on('end', () => readPort(true));
                command.on('error', retry);
            } catch (_) { retry(); }
        });
    } catch (_) { retry(); }
}

function startDebugger(args) {
    return canConnectToDaemon().then(info => {
        if (!info.canConnectToDaemon) return false;
        if (state.isConnecting) return true;
        const run = ++generation;
        closeClient();
        clearTimeout(startupDeadline);
        startupDeadline = setTimeout(() => {
            if (run === generation && state.isConnecting) fail(run, 'Timed out while starting the TV debugger.');
        }, CONNECTING_TIMEOUT_MS);
        connectingSince = Date.now();
        state.isConnecting = true;
        state.phase = 'launching';
        state.lastError = '';
        state.attempt = 0;
        // Native teardown can finish after getAppsContext stops listing the app.
        setTimeout(() => launchDebugger(run, info.ip, args, 1), 600);
        return true;
    });
}

module.exports = { startDebugger, canConnectToDaemon };
