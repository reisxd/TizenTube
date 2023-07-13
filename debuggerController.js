import WebSocket from 'ws';

async function startDebugging(port) {
    const debuggerJsonReq = await fetch(`http://192.168.1.2:${port}/json`);
    const debuggerJson = await debuggerJsonReq.json();
    return attachDebugger(debuggerJson[0].webSocketDebuggerUrl);
}

async function attachDebugger(wsUrl) {
    const client = await new WebSocket(wsUrl);
    let id = 12;
    client.onmessage = (message) => {
        const msg = JSON.parse(message.data);
        console.log(msg);
        // Future-proof it just incase the page reloads/something happens.
        if (msg.method && msg.method == 'Runtime.executionContextCreated') {
            client.send(JSON.stringify({ "id": id, "method": "Runtime.evaluate", "params": { "expression": "const origParse = JSON.parse;\nJSON.parse = function () {\n  const r = origParse.apply(this, arguments);\n  if (r.adPlacements) {\n    r.adPlacements = [];\n  }\n  return r;\n};", "objectGroup": "console", "includeCommandLineAPI": true, "doNotPauseOnExceptionsAndMuteConsole": false, "contextId": msg.params.context.id, "returnByValue": false, "generatePreview": true } }))
            id++;
        }
    }
    client.onopen = () => {
        client.send(JSON.stringify({ "id": 7, "method": "Debugger.enable" }));
        client.send(JSON.stringify({ "id": 11, "method": "Runtime.enable" }));
    }
}

export default startDebugging;