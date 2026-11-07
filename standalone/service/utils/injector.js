// The TizenBrew-way of TizenTube. Uses CDP and SDB to inject the userscript.

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');


var isConnecting = false;
var isDebuggerAttached = false;
const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');

// With the Developer Mode host set to 127.0.0.1, some TVs (e.g. Tizen 5.0) only expose the
// inspector on loopback, so try 127.0.0.1 first and alternate with the TV's own IP on retry.
function connectToDebugger(host, port, args, altHost) {
    const retry = () => setTimeout(() => connectToDebugger(altHost || host, port, args, host), 250);

    fetch(`http://${host}:${port}/json`).then(_ => {
        const cdp = CDP({ host, port, local: true }, client => {
            isConnecting = false;
            isDebuggerAttached = true;
            client.on('disconnect', () => {
                isDebuggerAttached = false;
            });
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
        });
        cdp.on('error', retry);
    }).catch(retry);
}

function canConnectToDaemon() {
    return fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
        .then(json => {
            return { canConnectToDaemon: (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1', ip: json.device.ip, isConnecting, isDebuggerAttached }
        }).catch(e => {
            return canConnectToDaemon();
        });
}

function startDebugger(args) {
    return canConnectToDaemon().then(res => {
        if (!res.canConnectToDaemon) return false;
        const client = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });

        client._stream.on('connect', () => {
            const packageId = tizen.application.getAppInfo().packageId;
            isConnecting = true;
            const shellCmd = client.createStream(`shell:0 debug ${packageId}.TizenTubeStandalone${isTizen3 ? ' 0' : ''}`);
            shellCmd.on('data', (data) => {
                const dataString = data.toString();
                if (dataString.includes('debug')) {
                    const port = Number(dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', ''));
                    connectToDebugger('127.0.0.1', port, args, res.ip);
                    setTimeout(() => client._stream.end(), 1000);
                }
            });
        });

        return true;
    });
}

module.exports = {
    startDebugger,
    canConnectToDaemon
};