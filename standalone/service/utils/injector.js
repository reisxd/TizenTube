// The TizenBrew-way of TizenTube. Uses CDP and SDB to inject the userscript.

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');

var isConnecting = false;
var connectingSince = 0;
var debuggerFailedAt = 0;
// `0 debug` prints nothing (not an error) while the app is still running, and the
// app has only just started exiting when we get here, so early attempts land too
// soon. Space the retries out over a useful window, then give up for a while so
// the caller can fall back to the proxy.
const DEBUG_LAUNCH_RETRIES = 8;
const DEBUG_LAUNCH_INITIAL_DELAY_MS = 500;
const DEBUG_LAUNCH_RETRY_MS = 400;
// Backstop for a shell stream that neither returns a port nor finishes.
const DEBUG_LAUNCH_TIMEOUT_MS = 8000;
// A failure only disables the debugger path temporarily; a healthy launch after
// this window retries it instead of being stuck on the proxy until a TV restart.
const DEBUG_FAILED_TTL_MS = 300000;
// Self-heal a `connecting` state that never resolves (e.g. an inspector that
// accepts TCP but never answers), so it can't wedge every later launch.
const CONNECTING_TTL_MS = 30000;
const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');

function connectingActive() {
    return isConnecting && (Date.now() - connectingSince < CONNECTING_TTL_MS);
}

function markFailed() {
    isConnecting = false;
    debuggerFailedAt = Date.now();
}

// Find the debug port in sdbd's output. Scans every candidate line rather than
// locking onto the first one that merely contains "debug" and ":", and on a
// finished stream also considers the last line in case it wasn't newline-terminated.
function parsePort(text, complete) {
    if (!text.includes('debug')) return 0;
    const lines = text.split('\n');
    const candidates = complete ? lines : lines.slice(0, -1);
    for (let i = 0; i < candidates.length; i++) {
        const line = candidates[i];
        if (!line.includes('debug') || line.indexOf(':') === -1) continue;
        const port = Number(line.substr(line.indexOf(':') + 1, 6).trim());
        if (port) return port;
    }
    return 0;
}

// The `connectToDebugger` fetch retries below cover up to ~5s. The wait deadline
// in index.html (12s) must stay comfortably above that budget; raise both together.
function connectToDebugger(host, port, args, attempt) {
    if (!attempt) attempt = 1;
    fetch(`http://${host}:${port}`).then(_ => {
        function onClient(client) {
            isConnecting = false;
            client.Runtime.enable();
            client.Page.enable();

            client.on('Runtime.executionContextCreated', m => {
                fetch('https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js').then(res => res.text()).then(modFile => {
                    client.Runtime.evaluate({ expression: modFile, contextId: m.context.id });
                }).catch(e => {
                    client.Runtime.evaluate({ expression: 'alert("Failed to request to JSDelivr CDN.")', contextId: m.context.id });
                });
            });

            client.Page.navigate({ url: `https://youtube.com/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8085%2Fdial%2Fapps%2FYouTube${args ? `&${args}` : ''}` });
            client.Page.setBypassCSP({ enabled: true });
        }
        try {
            const cdp = CDP({ host, port, local: true }, onClient);
            if (cdp && typeof cdp.on === 'function') cdp.on('error', markFailed);
        } catch (e) {
            markFailed();
        }
    }).catch(e => {
        // The inspector can take a moment to come up; retry a bounded number of times.
        if (attempt < 50) {
            setTimeout(() => connectToDebugger(host, port, args, attempt + 1), 100);
        } else {
            markFailed();
        }
    })
}

function canConnectToDaemon() {
    return fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
        .then(json => {
            return {
                canConnectToDaemon: (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1',
                ip: json.device.ip,
                isConnecting: connectingActive(),
                debuggerFailed: debuggerFailedAt !== 0 && (Date.now() - debuggerFailedAt < DEBUG_FAILED_TTL_MS)
            }
        }).catch(e => {
            return canConnectToDaemon();
        });
}

function attemptDebugLaunch(ip, args, attempt) {
    // Heartbeat: a live retry chain can run longer than CONNECTING_TTL_MS, so
    // refresh the timestamp each attempt. The self-heal then means "no progress
    // for CONNECTING_TTL_MS" rather than a hard total, and can't fire mid-chain.
    connectingSince = Date.now();
    const client = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });
    let settled = false;

    function fail() {
        if (settled) return;
        settled = true;
        try { client._stream.end(); } catch (e) { /* already closed */ }
        if (attempt < DEBUG_LAUNCH_RETRIES) {
            setTimeout(() => attemptDebugLaunch(ip, args, attempt + 1), DEBUG_LAUNCH_RETRY_MS);
        } else {
            markFailed();
        }
    }

    client._stream.on('connect', () => {
        const packageId = tizen.application.getAppInfo().packageId;
        const shellCmd = client.createStream(`shell:0 debug ${packageId}.TizenTubeStandalone${isTizen3 ? ' 0' : ''}`);
        let buffer = '';

        function settleWithPort(port) {
            settled = true;
            connectToDebugger(ip, port, args);
            setTimeout(() => { try { client._stream.end(); } catch (e) { } }, 1000);
        }

        shellCmd.on('data', (data) => {
            if (settled) return;
            buffer += data.toString();
            // Parse only newline-terminated lines here so a port split across chunks
            // isn't read half-formed; the 'finish' handler covers an unterminated tail.
            const port = parsePort(buffer, false);
            if (port) settleWithPort(port);
        });

        // adbhost ends the writable side of the shell stream (-> 'finish') when sdbd
        // closes the command. Give the buffered output one last parse (including any
        // final line without a trailing newline); a finish with no port means
        // `0 debug` ran while the app was still up -> retry. Keying on this rather
        // than a fixed timeout means a slow-but-valid launch isn't aborted early.
        shellCmd.on('finish', () => {
            if (settled) return;
            const port = parsePort(buffer, true);
            if (port) settleWithPort(port);
            else fail();
        });
    });

    // Covers a connect error (sdbd not up yet) and a stream that never finishes.
    client._stream.on('error', fail);
    setTimeout(fail, DEBUG_LAUNCH_TIMEOUT_MS);
}

function startDebugger(args) {
    return canConnectToDaemon().then(res => {
        if (!res.canConnectToDaemon) return false;
        if (connectingActive()) return true; // a launch is already in progress
        isConnecting = true;
        connectingSince = Date.now();
        debuggerFailedAt = 0;
        setTimeout(() => attemptDebugLaunch(res.ip, args, 1), DEBUG_LAUNCH_INITIAL_DELAY_MS);
        return true;
    });
}

module.exports = {
    startDebugger,
    canConnectToDaemon
};
