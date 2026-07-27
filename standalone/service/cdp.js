"use strict";

// Userscript injection over the Chrome DevTools Protocol.
//
// Why this exists: the proxy serves youtube.com from http://localhost:8099, and YouTube
// binds its Proof-of-Origin token to the page origin. With the wrong origin every SABR
// media POST comes back as a six-byte "stream protection status = 3 (PoToken required)"
// message and no video at all -- that is upstream #555 / #561, confirmed on hardware.
// Loading the real https://www.youtube.com/tv fixes it, but the page is then cross-origin
// and cannot be scripted by the app, so the userscript goes in over CDP instead. This is
// the same mechanism TizenBrew's module loader uses (service-nextgen/service/utils/
// debugger.js), which is why the TizenBrew module never had the problem.
//
// Requires developer mode ON with Host PC IP == 127.0.0.1. sdbd accepts a loopback TCP
// connection whatever that field says, but only completes the ADB handshake when the
// configured host matches the peer -- with a LAN IP configured the socket opens and then
// stays silent forever.

const net = require('net');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');

const SDB_PORT = 26101;
const UI_APP_ID = 'xvvl3S1TT1.TizenTubeStandalone';

// Matches the module's websiteURL in the repo root package.json.
const YOUTUBE_TV_URL =
    'https://www.youtube.com/tv?additionalDataUrl=' +
    encodeURIComponent('http://localhost:8085/dial/apps/YouTube');

const state = {
    phase: 'idle',
    attached: false,
    navigated: false,
    port: null,
    error: null,
    bypassedCsp: false,
    injectedVia: null,
    // Set to 'exit-for-debug' to ask index.html to close itself; see the retry ladder in
    // start() for why that helps.
    action: null,
    log: []
};

function record(message) {
    state.log.push(new Date().toISOString().substr(11, 8) + ' ' + message);
    if (state.log.length > 60) state.log.shift();
    console.log('[TizenTube CDP] ' + message);
}

function fail(phase, error) {
    state.phase = 'failed';
    state.error = (error && error.message ? error.message : String(error));
    record('FAILED at ' + phase + ': ' + state.error);
}

// --- minimal ADB/SDB host client -------------------------------------------------
//
// Hand-rolled rather than using the adbhost package. adbhost is unmaintained, ignores
// AUTH packets outright (there is a literal "TODO: handle AUTH" in its dispatcher), and
// reads its socket in 'readable' mode -- which also means any 'data' listener added for
// instrumentation never fires, so it silently hides what the device actually replied.
// Doing the framing here means every byte in both directions can be logged to screen.

const A_CNXN = 0x4e584e43;
const A_OPEN = 0x4e45504f;
const A_OKAY = 0x59414b4f;
const A_WRTE = 0x45545257;
const A_CLSE = 0x45534c43;
const A_AUTH = 0x48545541;

function commandName(cmd) {
    switch (cmd) {
        case A_CNXN: return 'CNXN';
        case A_OPEN: return 'OPEN';
        case A_OKAY: return 'OKAY';
        case A_WRTE: return 'WRTE';
        case A_CLSE: return 'CLSE';
        case A_AUTH: return 'AUTH';
        default: return '0x' + (cmd >>> 0).toString(16);
    }
}

function adbPacket(command, arg0, arg1, payload) {
    const data = payload ? Buffer.from(payload, 'latin1') : Buffer.alloc(0);
    let checksum = 0;
    for (let i = 0; i < data.length; i++) checksum = (checksum + data[i]) >>> 0;

    const header = Buffer.alloc(24);
    header.writeUInt32LE(command >>> 0, 0);
    header.writeUInt32LE(arg0 >>> 0, 4);
    header.writeUInt32LE(arg1 >>> 0, 8);
    header.writeUInt32LE(data.length, 12);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
    return Buffer.concat([header, data]);
}

// Ask the TV's own sdbd to relaunch our UI app with remote debugging enabled, and read
// the port out of its reply.
function getDebugPort(timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket.destroy(); } catch (e) { }
            fn(arg);
        };

        const timer = setTimeout(() => {
            done(reject, new Error('timeout; last state: ' + phase + ', rx=' + rxCount + ' pkts'));
        }, timeoutMs || 12000);

        let phase = 'connecting';
        let rxCount = 0;
        let buffer = Buffer.alloc(0);
        let shellOut = '';
        const localId = 12345;
        let remoteId = 0;

        const socket = net.connect({ host: '127.0.0.1', port: SDB_PORT });
        socket.on('error', (e) => done(reject, new Error('socket ' + phase + ': ' + e.message)));
        socket.on('close', () => {
            record('socket closed (phase ' + phase + ', ' + rxCount + ' packets in)');
            if (!tryParsePort()) {
                done(reject, new Error('closed during ' + phase + '; shell said: ' +
                    JSON.stringify(shellOut.substr(0, 120))));
            }
        });

        socket.on('connect', () => {
            phase = 'sent-CNXN';
            record('TCP connected to sdbd, sending CNXN');
            socket.write(adbPacket(A_CNXN, 0x01000000, 4096, 'host::\0'));
        });

        function tryParsePort() {
            const match = shellOut.match(/port:\s*(\d+)/);
            if (!match) return false;
            record('shell reply: ' + shellOut.trim().substr(0, 90));
            done(resolve, Number(match[1]));
            return true;
        }

        function handlePacket(cmd, arg0, arg1, payload) {
            rxCount++;
            const name = commandName(cmd);

            if (cmd === A_CNXN) {
                record('<- CNXN banner=' + JSON.stringify(payload.toString('latin1').substr(0, 60)));
                phase = 'sent-OPEN';
                socket.write(adbPacket(A_OPEN, localId, 0, 'shell:0 debug ' + UI_APP_ID + '\0'));
                return;
            }

            if (cmd === A_AUTH) {
                // Worth knowing explicitly: it would mean sdbd wants an RSA handshake,
                // which is a completely different problem from a silent connection.
                record('<- AUTH type=' + arg0 + ' (device demands key exchange)');
                done(reject, new Error('sdbd requires AUTH (type ' + arg0 + ')'));
                return;
            }

            if (cmd === A_OKAY) {
                if (!remoteId) remoteId = arg0;
                record('<- OKAY remote=' + arg0);
                return;
            }

            if (cmd === A_WRTE) {
                remoteId = remoteId || arg0;
                shellOut += payload.toString('latin1');
                socket.write(adbPacket(A_OKAY, localId, remoteId, null));
                tryParsePort();
                return;
            }

            if (cmd === A_CLSE) {
                record('<- CLSE');
                if (!tryParsePort()) {
                    done(reject, new Error('stream closed; shell said: ' +
                        JSON.stringify(shellOut.substr(0, 120))));
                }
                return;
            }

            record('<- ' + name + ' (unhandled) len=' + payload.length);
        }

        socket.on('data', (chunk) => {
            if (rxCount === 0) {
                record('first bytes in: ' + chunk.slice(0, 24).toString('hex'));
            }
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 24) {
                const cmd = buffer.readUInt32LE(0);
                const arg0 = buffer.readUInt32LE(4);
                const arg1 = buffer.readUInt32LE(8);
                const len = buffer.readUInt32LE(12);
                if (len > 4 * 1024 * 1024) {
                    return done(reject, new Error('bad frame len ' + len +
                        ' hdr=' + buffer.slice(0, 24).toString('hex')));
                }
                if (buffer.length < 24 + len) break;
                const payload = buffer.slice(24, 24 + len);
                buffer = buffer.slice(24 + len);
                handlePacket(cmd, arg0, arg1, payload);
                if (settled) return;
            }
        });
    });
}

function attach(port, options) {
    return CDP({ port: port, host: '127.0.0.1', local: true }).then((client) => {
        record('CDP client connected on ' + port);

        const enable = client.Page.enable()
            .then(() => client.Runtime.enable())
            .then(() => client.Network.enable().catch(() => {
                record('Network.enable unsupported, continuing');
            }));

        return enable
            .then(() => {
                // The proxy used to strip content-security-policy from every response
                // (see skipHeaders in index.js). Nothing is proxied on this path, so the
                // page gets YouTube's real CSP -- which is what #74 describes as blocking
                // SponsorBlock and DeArrow. This is the replacement for that stripping.
                return client.Page.setBypassCSP({ enabled: true })
                    .then(() => {
                        state.bypassedCsp = true;
                        record('CSP bypass enabled');
                    })
                    .catch((e) => record('Page.setBypassCSP unsupported: ' + e.message));
            })
            .then(() => fetch(options.userScriptUrl).then((r) => r.text()))
            .then((source) => {
                record('userscript fetched (' + source.length + ' bytes)');

                // Preferred: runs before any of YouTube's own scripts on every document.
                return client.Page.addScriptToEvaluateOnNewDocument({ expression: source })
                    .then(() => {
                        state.injectedVia = 'addScriptToEvaluateOnNewDocument';
                        record('injection armed at document start');
                    })
                    .catch((e) => {
                        // Older protocol builds: inject per execution context instead.
                        record('addScriptToEvaluateOnNewDocument unsupported (' + e.message + '), falling back');
                        state.injectedVia = 'Runtime.evaluate';
                        client.on('Runtime.executionContextCreated', (msg) => {
                            client.Runtime.evaluate({
                                expression: source,
                                contextId: msg.context.id
                            }).catch((err) => record('evaluate failed: ' + err.message));
                        });
                    });
            })
            .then(() => {
                state.attached = true;
                state.phase = 'navigating';
                record('navigating to the real youtube.com');
                return client.Page.navigate({ url: YOUTUBE_TV_URL });
            })
            .then(() => {
                state.navigated = true;
                state.phase = 'ready';
                record('navigation issued -- real origin, script injected');
            });
    });
}

// `shell:0 debug` restarts the UI app, so index.html runs a second time while this
// service keeps living. Without a guard we would relaunch forever.
let started = false;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function start(options) {
    if (started) {
        record('start() ignored, already running');
        return;
    }
    started = true;

    // CDP only exists for an app that was *launched* with remote debugging, and on Tizen
    // the only way to do that is `shell:0 debug <appid>` -- itself a launch. So the app
    // the user just opened has to be replaced by a debug-enabled one.
    //
    // It has to get out of the way first: sdbd opens the stream and then goes silent if
    // the target app is in the foreground (reproduced from a PC too, where the same
    // command timed out with the app up and returned instantly from the home screen).
    // Asking up front costs one quick restart; waiting for the foreground attempt to
    // stall first just adds a visible pause before the same restart.
    state.phase = 'restarting';
    state.action = 'exit-for-debug';
    record('asking the UI app to close so sdbd can relaunch it with debugging');

    delay(1800)
        .then(() => {
            state.action = null;
            state.phase = 'connecting-sdb';
            return getDebugPort(15000);
        })
        .catch((e) => {
            // The app may not have exited (an old page, or exit refused). One more go
            // with a longer window rather than giving up on direct mode outright.
            record('first debug launch failed: ' + e.message + ' -- retrying');
            state.phase = 'connecting-sdb';
            return getDebugPort(20000);
        })
        .then((port) => {
            state.port = port;
            state.phase = 'attaching';
            record('debug port ' + port);
            return attach(port, options);
        })
        .catch((e) => fail(state.phase, e));
}

module.exports = { start: start, state: state, YOUTUBE_TV_URL: YOUTUBE_TV_URL };
