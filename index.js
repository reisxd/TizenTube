import express from 'express';
import { Socket } from 'node:net';
import startDebugging from './debuggerController.js';
import Config from './config.json' assert { type: 'json' };

const app = express();
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

tvSdb.connect(26101, Config.tvIP, () => {
    // Identify the TV.
    sendData('434e584e00001000000004000700000032020000bcb1a7b1686f73743a3a00');
});

tvSdb.on('close', () => {
    // Reconnect to the TV if something happens (like turning it off).
    reconnectionInterval = setInterval(async () => {
        tvSdb.connect(26101, Config.tvIP, () => {
            // Identify the TV.
            sendData('434e584e00001000000004000700000032020000bcb1a7b1686f73743a3a00');
        });
    }, 5000);
});

tvSdb.on('connect', () => {
    if (reconnectionInterval) {
        clearInterval(reconnectionInterval);
        reconnectionInterval = null;
    }
});

app.get('/launch', async (_, res) => {
    // Launch the app with a debugger. Executes "sdb shell 0 debug app.id 0" (The last argument
    // is for timeout, but timeout doesn't exist. And when you dont supply it, it just says
    // "closed". Took me a little too long to figure out.).

    const appId = Buffer.from(Config.appId).toString('hex');
    sendData(`4f50454e250000000000000021000000f60a0000b0afbab17368656c6c3a3020646562756720${appId}203000`)
    return res.send('Sent');
});

app.listen(3000);