import { WebSocketServer } from 'ws';
import adbhost from 'adbhost';
import startDebugging from './debuggerController.js';
import Config from './config.json' assert { type: 'json' };

let adb = adbhost.createConnection({ host: Config.tvIP, port: 26101 });
let reconnectInterval = null;
adb._stream.on('error', () => {
    console.log('ADB connection closed, reconnecting...');
    reconnectInterval = setInterval(() => {
        adb._stream.connect(26101, Config.tvIP);
    }, 1000);
});

adb._stream.on('connect', () => {
    console.log('ADB connection established');
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
});

const wss = new WebSocketServer({ port: 3000 });
wss.on('connection', ws => {
    ws.on('message', message => {
        let msg;
        try {
            msg = JSON.parse(message.toString());
        } catch {
            ws.send(JSON.stringify({
                error: 'Invalid data'
            }));
            return;
        }
        switch (msg.e) {
            case 'launch': {
                ws.send(JSON.stringify({
                    ok: true
                }));

                // Launch the app
                const shellCmd = adb.createStream(`shell:0 debug ${Config.appId}${Config.isTizen3 ? ' 0' : ''}`);
                shellCmd.on('data', data => {
                    const dataString = data.toString();
                    if (dataString.includes('debug')) {
                        console.log(dataString);
                        const port = dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', '');
                        startDebugging(port)
                    }
                });
                break;
            }
            default: {
                ws.send(JSON.stringify({
                    error: 'Unknown event'
                }));
                break;
            }
        }
    });
});

// If the server is running on Android and the CWD is /, change it (required for the Android app)
if (process.cwd() === '/' && process.platform === 'android') {
    process.chdir('/data/user/0/io.gh.reisxd.tizentube/files/tizentube');
}