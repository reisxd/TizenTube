// The TizenBrew-way of TizenTube. Uses CDP and SDB to inject the userscript.

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');
const { documentStartScript } = require('./earlyAdblock.js');


var isConnecting = false;
const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');

// Same budget as TizenBrew's debugger: 15 attempts, 750 ms apart.
const MAX_CDP_ATTEMPTS = 15;
const CDP_RETRY_MS = 750;
// How long to wait for the debug port of the relaunched app to open.
const MAX_PORT_WAIT_MS = 30000;

const USERSCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js';

// State of the current debug launch. Only one runs at a time.
//
// isConnecting stays true from the request until YouTube has loaded or the
// launch failed. The debug-launched app runs the same loader page, and if it
// saw isConnecting false while the debugger was still attaching, it would take
// itself for a fresh launch, request another relaunch and exit: a crash loop.
//
// The userscript download starts before the debug relaunch, so it is ready
// when the debugger attaches. The sdb session stays open until YouTube has
// loaded: on Tizen 5, closing it also closes the debugger connection.
const launch = { id: 0, userScript: null, endSdbSession: () => {} };
const MAX_APP_EXIT_WAIT_MS = 15000;
const MAX_LAUNCH_MS = 45000;

function beginLaunch() {
    isConnecting = true;
    launch.id++;
    launch.endSdbSession = () => {};
    const id = launch.id;
    // Never stay "connecting" forever, whatever happened.
    setTimeout(() => {
        if (launch.id === id && isConnecting) finishLaunch(id, new Error(`no YouTube load event within ${MAX_LAUNCH_MS} ms`), 'info: launch timeout');
    }, MAX_LAUNCH_MS);
    return id;
}

// Ends launch `id`. A failure is shown on the next start; an info entry is not.
function finishLaunch(id, err, stage) {
    if (id !== launch.id || !isConnecting) return;
    launch.endSdbSession();
    isConnecting = false;
    if (err) reportError(err, stage);
}

function downloadUserScript() {
    return fetch(USERSCRIPT_URL).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
    });
}

function evaluateOnEveryContext(client, modFile) {
    client.on('Runtime.executionContextCreated', m => {
        client.Runtime.evaluate({ expression: modFile, contextId: m.context.id });
    });
}

function reportError(err, stage) {
    if (typeof global.tizentubeReportError === 'function') global.tizentubeReportError(err, stage);
}

// Gives up on the current launch and records why.
function giveUp(err, stage) {
    // After the launch has ended (e.g. the debugger already disconnected), this
    // is a consequence of the recorded failure, not a new one.
    if (!isConnecting) return reportError(err, 'info: after the launch ended: ' + stage);
    finishLaunch(launch.id, err, stage);
}

function connectToDebugger(host, port, args, startedAt) {
    if (!startedAt) startedAt = Date.now();
    fetch(`http://${host}:${port}`).then(_ => {
        attachDebugger(host, port, args, 1);
    }).catch(e => {
        if (Date.now() - startedAt > MAX_PORT_WAIT_MS) {
            return giveUp(e, `debug port ${host}:${port} did not open within ${MAX_PORT_WAIT_MS} ms`);
        }
        return setTimeout(() => connectToDebugger(host, port, args, startedAt), 100);
    })
}

function retryAttach(host, port, args, attempts, err) {
    if (attempts >= MAX_CDP_ATTEMPTS) {
        return giveUp(err, `CDP attach to ${host}:${port} failed after ${attempts} attempts`);
    }
    setTimeout(() => attachDebugger(host, port, args, attempts + 1), CDP_RETRY_MS);
}

function attachDebugger(host, port, args, attempts) {
    try {
        CDP({ host, port, local: true }, client => {
            const id = launch.id;
            const attachedAt = Date.now();
            let loaded = false;
            reportError(new Error(`attached to ${host}:${port} on attempt ${attempts}`), 'info: CDP');
            client.on('disconnect', () => {
                const msg = `debugger disconnected ${Date.now() - attachedAt} ms after attaching`;
                // After YouTube has loaded this is normal; before, the launch failed.
                if (loaded) reportError(new Error(msg), 'info: CDP disconnect');
                else finishLaunch(id, new Error(msg), 'CDP disconnect before YouTube loaded');
            });
            client.Runtime.enable().catch(err => reportError(err, 'info: Runtime.enable not supported on this TV'));
            client.Debugger.enable().catch(err => reportError(err, 'info: Debugger.enable not supported on this TV'));
            client.Page.enable().catch(err => reportError(err, 'info: Page.enable not supported on this TV'));

            const youtubeUrl = `https://youtube.com/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8085%2Fdial%2Fapps%2FYouTube${args ? `&${args}` : ''}`;

            // Not available in older inspectors (Tizen 5 / Chromium 63); YouTube works without it there.
            client.Page.setBypassCSP({ enabled: true })
                .catch(err => reportError(err, 'info: Page.setBypassCSP not supported on this TV'));

            // The ad blocker hooks JSON.parse, so it must run before YouTube's
            // own code parses the first player response. Download the script
            // first, register it to run at the start of every new document,
            // and only then navigate to YouTube.
            const navigate = () => client.Page.navigate({ url: youtubeUrl })
                .catch(err => giveUp(err, 'Page.navigate to YouTube'));
            client.Page.loadEventFired(() => {
                if (loaded) return;
                loaded = true;
                finishLaunch(id, new Error(`YouTube loaded ${Date.now() - attachedAt} ms after attaching`), 'info: CDP');
            });

            (launch.userScript || downloadUserScript()).then(modFile => {
                return client.Page.addScriptToEvaluateOnNewDocument({ source: documentStartScript(modFile) })
                    .then(() => {
                        reportError(new Error('userScript registered to run at document start'), 'info: CDP');
                        navigate();
                    })
                    .catch(err => {
                        // Older inspectors: fall back to evaluating it when the page context appears.
                        reportError(err, 'info: addScriptToEvaluateOnNewDocument unsupported, injecting late');
                        evaluateOnEveryContext(client, modFile);
                        navigate();
                    });
            }).catch(err => {
                reportError(err, `userScript download from ${USERSCRIPT_URL}`);
                navigate();
                client.on('Runtime.executionContextCreated', m => {
                    client.Runtime.evaluate({ expression: 'alert("Failed to request to JSDelivr CDN.")', contextId: m.context.id });
                });
            });
        }).on('error', err => retryAttach(host, port, args, attempts, err));
    } catch (err) {
        retryAttach(host, port, args, attempts, err);
    }
}

function canConnectToDaemon() {
    return fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
        .then(json => {
            return { canConnectToDaemon: (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1', ip: json.device.ip, isConnecting }
        }).catch(e => {
            return canConnectToDaemon();
        });
}

// Called when the loader asks for a debug relaunch. Ignored while one runs.
function requestDebugLaunch(args) {
    if (isConnecting) {
        reportError(new Error('a debug launch is already in progress'), 'info: relaunch request ignored');
        return false;
    }
    const id = beginLaunch();
    launch.userScript = downloadUserScript();
    launch.userScript.catch(() => {}); // reported when it is used
    const startedAt = Date.now();
    // Wait for the loader app to exit; one check at a time.
    (function waitForExit() {
        tizen.application.getAppsContext(appsContext => {
            if (id !== launch.id) return;
            const packageId = tizen.application.getAppInfo().packageId;
            const running = appsContext.some(app => app.appId === `${packageId}.TizenTubeStandalone`);
            if (!running) return startDebugger(args, id);
            if (Date.now() - startedAt > MAX_APP_EXIT_WAIT_MS) {
                return finishLaunch(id, new Error(`the app did not exit within ${MAX_APP_EXIT_WAIT_MS} ms`), 'debug relaunch');
            }
            setTimeout(waitForExit, 50);
        }, err => finishLaunch(id, err, 'getAppsContext'));
    })();
    return true;
}

function startDebugger(args, id) {
    return canConnectToDaemon().then(res => {
        if (id !== launch.id) return false;
        if (!res.canConnectToDaemon) {
            finishLaunch(id, new Error('Developer Mode Host PC IP is not 127.0.0.1'), 'info: debug relaunch not possible');
            return false;
        }
        const client = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });
        let sessionEnded = false;
        launch.endSdbSession = () => {
            if (sessionEnded) return;
            sessionEnded = true;
            client._stream.end();
        };

        let gotPort = false;

        client._stream.on('error', e => {
            // Once the debug launch has printed its port, the session is closed
            // on purpose below and sdbd answers with a reset. That is expected.
            if (gotPort) return reportError(e, 'info: sdb connection closed after the debug launch');
            finishLaunch(id, e, 'sdb connection to 127.0.0.1:26101');
        });

        client._stream.on('connect', () => {
            const packageId = tizen.application.getAppInfo().packageId;
            const command = `0 debug ${packageId}.TizenTubeStandalone${isTizen3 ? ' 0' : ''}`;
            const shellCmd = client.createStream(`shell:${command}`);
            let output = '';
            // The relaunch prints the debug port; without it nothing can attach.
            const noPortTimer = setTimeout(() => {
                if (!gotPort) {
                    finishLaunch(id, new Error(`no debug port in output: ${JSON.stringify(output)}`), `sdb "${command}"`);
                }
            }, 15000);
            shellCmd.on('data', (data) => {
                const dataString = data.toString();
                output += dataString;
                if (dataString.includes('debug')) {
                    gotPort = true;
                    clearTimeout(noPortTimer);
                    const port = Number(dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', ''));
                    reportError(new Error(`output ${JSON.stringify(output)}, port ${port}, host ${res.ip}`), `info: sdb "${command}"`);
                    connectToDebugger(res.ip, port, args);
                    // Closed when YouTube has loaded (Page.loadEventFired); at the latest
                    // by the launch timeout.
                }
            });
        });

        return true;
    });
}

module.exports = {
    requestDebugLaunch,
    canConnectToDaemon
};