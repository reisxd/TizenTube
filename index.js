import { WebSocketServer } from 'ws';
import { Socket } from 'node:net';
import startDebugging from './debuggerController.js';
import Config from './config.json' assert { type: 'json' };

const wss = new WebSocketServer({ port: 3000 });
const tvSdb = new Socket();
let reconnectionInterval = null;

const sendData = (hexData) => tvSdb.write(Buffer.from(hexData, 'hex'))

tvSdb.on('data', async data => {
    const dataString = data.toString();
    if (dataString.includes('CLSE')) {
        // Close it and send OKAY.
        sendData('4f4b41591d000000210000000000000000000000b0b4bea6');
        sendData('434c534500000000210000000000000000000000bcb3acba')
    }

    // After launching the app, request more log from the app. This is required to get the port
    if (dataString.includes('/app_launcher')) {
        // Get the character byte instead of the string. When the
        // character wasn't an ASCII character, it'd fail.
        const char = data[4].toString(16).padStart(2, '0');

        // Send OKAY to the TV. This'll make the TV send more logs.
        sendData(`4f4b415923000000${char}0000000000000000000000b0b4bea6`);
    }

    // The glorious win. Get the debugger port and start the debugger.
    if (dataString.includes('debug')) {
        const port = dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', '');
        startDebugging(port)
    }
});

tvSdb.connect(26101, Config.tvIP);

tvSdb.on('connect', () => {
    if (reconnectionInterval) {
        clearInterval(reconnectionInterval);
        reconnectionInterval = null;
    }

    sendData('434e584e00001000000004000700000032020000bcb1a7b1686f73743a3a00');
});

tvSdb.on('close', () => {
    // Reconnect to the TV if something happens (like turning it off).
    reconnectionInterval = setInterval(async () => {
        tvSdb.connect(26101, Config.tvIP);
    }, 5000);
});

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

                const appId = Buffer.from(Config.appId).toString('hex');
                // Launch the app with a debugger. Executes "sdb shell 0 debug app.id 0" (The last argument
                // is for timeout, but timeout doesn't exist. And when you dont supply it, it just says
                // "closed". Took me a little too long to figure out.).
                sendData(`4f50454e250000000000000021000000f60a0000b0afbab17368656c6c3a3020646562756720${appId}203000`)
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