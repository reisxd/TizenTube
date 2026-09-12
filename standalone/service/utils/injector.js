// The TizenBrew-way of TizenTube. Uses CDP and SDB to inject the userscript.

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');


var isConnecting = false;
// `0 debug` only succeeds when the app is NOT already running. The app exits
// just before we get here, but getAppsContext() reports it gone before Tizen has
// finished tearing the process down, so the first attempt often returns nothing.
const DEBUG_LAUNCH_RETRIES = 8;
const DEBUG_LAUNCH_RETRY_MS = 400;
// getAppsContext() reports the app gone before Tizen has finished tearing the
// process down, so an immediate `0 debug` almost always lands too early. A short
// head start lets the first attempt succeed on most TVs; the retries above
// remain the safety net for slower ones.
const DEBUG_LAUNCH_INITIAL_DELAY_MS = 500;
const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');

function connectToDebugger(host, port, args) {
    fetch(`http://${host}:${port}`).then(_ => {
        CDP({ host, port, local: true }, client => {
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
        })
    }).catch(e => {
        return setTimeout(() => connectToDebugger(host, port, args), 100);
    })
}

function canConnectToDaemon() {
    return fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
        .then(json => {
            return { canConnectToDaemon: (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1', ip: json.device.ip, isConnecting }
        }).catch(e => {
            return canConnectToDaemon();
        });
}

function attemptDebugLaunch(ip, args, attempt) {
    const client = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });

    client._stream.on('connect', () => {
        const packageId = tizen.application.getAppInfo().packageId;
        let gotDebugPort = false;
        const shellCmd = client.createStream(`shell:0 debug ${packageId}.TizenTubeStandalone${isTizen3 ? ' 0' : ''}`);

        shellCmd.on('data', (data) => {
            const dataString = data.toString();
            if (dataString.includes('debug')) {
                gotDebugPort = true;
                const port = Number(dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', ''));
                connectToDebugger(ip, port, args);
                setTimeout(() => client._stream.end(), 1000);
            }
        });

        // `0 debug` returns NOTHING (not an error) when the app is still running,
        // so silence means "too early" -- retry rather than give up. Without this,
        // isConnecting stays true for the lifetime of the service and every later
        // launch dead-ends on the splash screen until the TV is restarted.
        setTimeout(() => {
            if (gotDebugPort) return;
            try {
                client._stream.end();
            } catch (e) {
                // Stream may already be gone; nothing to do.
            }
            if (attempt < DEBUG_LAUNCH_RETRIES) {
                attemptDebugLaunch(ip, args, attempt + 1);
            } else {
                // Out of retries: clear the flag so the app falls back to the proxy
                // path on its next launch instead of hanging forever.
                isConnecting = false;
            }
        }, DEBUG_LAUNCH_RETRY_MS);
    });

    client._stream.on('error', () => {
        if (attempt >= DEBUG_LAUNCH_RETRIES) isConnecting = false;
    });
}

function startDebugger(args) {
    return canConnectToDaemon().then(res => {
        if (!res.canConnectToDaemon) return false;
        isConnecting = true;
        setTimeout(() => attemptDebugLaunch(res.ip, args, 1), DEBUG_LAUNCH_INITIAL_DELAY_MS);
        return true;
    });
}

module.exports = {
    startDebugger,
    canConnectToDaemon
};