'use strict';

// TizenTube StandaloneService diagnostics wrapper.
//
// Retail Samsung TVs have dlog disabled, so this wrapper records a timeline of the
// service's startup itself and then loads the real (unmodified) service bundle
// synchronously, exactly like the Tizen service runtime would. The timeline goes to:
//   - a log file that survives the service being killed (see LOG_CANDIDATES)
//   - an HTTP endpoint on 0.0.0.0:8199 (readable from the dev PC on the LAN)
//   - a message port to the UI app ("ttdiag"), so lines arrive even while the
//     event loop is blocked
//
// Written in ES5 on purpose: we don't know which Node version the TV runs.

var T0 = Date.now();

// Proof of life before anything else can fail: one synchronous write into the package's
// private data folder, which the UI app can read back (sdb pull is blocked on retail TVs).
var PKG_DATA_DIRS = [
    __dirname + '/../../../data',
    '/opt/usr/home/owner/apps_rw/xvvl3S1TT1/data',
    '/home/owner/apps_rw/xvvl3S1TT1/data'
];
(function () {
    var marker = 'service JS executed at ' + new Date().toISOString() + ' pid ' + process.pid +
        ' node ' + process.version + ' __dirname ' + __dirname + '\n';
    for (var i = 0; i < PKG_DATA_DIRS.length; i++) {
        try { require('fs').appendFileSync(PKG_DATA_DIRS[i] + '/ttdiag-alive.txt', marker); } catch (e) { /* try next */ }
    }
})();

var DIAG_PORT = 8199;
var REAL_SERVICE = './dist/index.js';
var SHARE = '/home/owner/share/';
var LOG_CANDIDATES = PKG_DATA_DIRS.map(function (d) { return d + '/ttdiag.log'; }).concat([SHARE + 'ttdiag.log']);
var WATCHED_PATHS = [
    '/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content',
    '/usr/apps/com.samsung.tv.cobalt/content/data',
    SHARE + 'tizentube-content',
    SHARE + 'tizentube-content/ssl/certs',
    SHARE + 'tizentube-ca.crt',
    SHARE + 'tizentube-ca.key'
];

var lines = [];
var logFile = null;
var fs = null;
var http = null;
var net = null;
var uiAppId = null;
var remotePort = null;
var remoteRetryAt = 0;

function stamp() {
    return new Date().toISOString() + ' +' + (Date.now() - T0) + 'ms';
}

function sendToUi(line) {
    if (!uiAppId || Date.now() < remoteRetryAt) return;
    try {
        if (!remotePort) remotePort = tizen.messageport.requestRemoteMessagePort(uiAppId, 'ttdiag');
        remotePort.sendMessage([{ key: 'line', value: line }]);
    } catch (e) {
        remotePort = null;
        remoteRetryAt = Date.now() + 2000;
    }
}

function record(msg) {
    var line = stamp() + ' [pid ' + process.pid + '] ' + msg;
    lines.push(line);
    if (lines.length > 3000) lines.shift();
    if (fs && logFile) {
        try { fs.appendFileSync(logFile, line + '\n'); } catch (e) { /* keep in-memory copy */ }
    }
    sendToUi(line);
}

function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback !== undefined ? fallback : 'ERR ' + e; }
}

function tryRequire(name) {
    try {
        return require(name);
    } catch (e) {
        record('require("' + name + '") FAILED: ' + (e && e.stack || e));
        return null;
    }
}

// --- basic setup -----------------------------------------------------------

try {
    uiAppId = tizen.application.getAppInfo().packageId + '.TizenTubeStandalone';
} catch (e) {
    record('tizen.application.getAppInfo() FAILED: ' + e);
}

fs = tryRequire('fs');
http = tryRequire('http');
net = tryRequire('net');
tryRequire('path');

if (fs) {
    for (var i = 0; i < LOG_CANDIDATES.length && !logFile; i++) {
        try {
            var candidate = LOG_CANDIDATES[i];
            if (fs.existsSync(candidate) && fs.statSync(candidate).size > 512 * 1024) {
                fs.renameSync(candidate, candidate + '.old');
            }
            fs.appendFileSync(candidate, '\n===== service start ' + new Date().toISOString() + ' =====\n');
            logFile = candidate;
        } catch (e) {
            lines.push('log file ' + LOG_CANDIDATES[i] + ' not writable: ' + e);
        }
    }
}

record('diag.js loaded, log file: ' + logFile);
record('node ' + safe(function () { return process.version; }) +
    ' arch=' + safe(function () { return process.arch; }) +
    ' platform=' + safe(function () { return process.platform; }));
record('versions ' + safe(function () { return JSON.stringify(process.versions); }));
record('execPath=' + safe(function () { return process.execPath; }) +
    ' argv=' + safe(function () { return JSON.stringify(process.argv); }) +
    ' cwd=' + safe(function () { return process.cwd(); }) +
    ' __dirname=' + __dirname);
record('uid=' + safe(function () { return process.getuid(); }) +
    ' typeof tizen=' + typeof tizen + ' typeof webapis=' + typeof webapis);
record('tizen platform.version=' + safe(function () {
    return tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
}) + ' web.service=' + safe(function () {
    return tizen.systeminfo.getCapability('http://tizen.org/feature/web.service');
}));
record('memory ' + safe(function () { return JSON.stringify(process.memoryUsage()); }));

if (fs) {
    WATCHED_PATHS.forEach(function (p) {
        record('exists ' + p + ' = ' + safe(function () {
            if (!fs.existsSync(p)) return false;
            var st = fs.statSync(p);
            return (st.isDirectory() ? 'dir' : 'file ' + st.size + 'B') + ' mtime ' + st.mtime.toISOString();
        }));
    });
    record('share writable = ' + safe(function () {
        var probe = SHARE + 'ttdiag.probe';
        fs.writeFileSync(probe, 'x');
        fs.unlinkSync(probe);
        return true;
    }));
}

// --- process lifecycle -----------------------------------------------------

process.on('uncaughtException', function (e) {
    // Logged and swallowed so we keep serving diagnostics; the real service would crash here.
    record('UNCAUGHT EXCEPTION (real service would crash): ' + (e && e.stack || e));
});
process.on('unhandledRejection', function (e) {
    record('UNHANDLED REJECTION: ' + (e && e.stack || e));
});
process.on('exit', function (code) {
    record('process exit code=' + code);
});
['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGUSR1', 'SIGUSR2'].forEach(function (sig) {
    safe(function () {
        process.on(sig, function () {
            record('received ' + sig + ', exiting');
            process.exit(128);
        });
    });
});

// Event loop watchdog: reports when synchronous work blocks the loop.
var lastTick = Date.now();
var beats = 0;
setInterval(function () {
    var now = Date.now();
    var gap = now - lastTick;
    if (gap > 1000) record('event loop was BLOCKED for ~' + gap + 'ms');
    lastTick = now;
    if (++beats % 40 === 0) record('heartbeat, uptime ' + Math.round(process.uptime()) + 's');
}, 250);

// --- instrumentation of what the real service does --------------------------

if (fs) {
    var copyStats = { files: 0, bytes: 0, dirs: 0 };
    var origWriteFileSync = fs.writeFileSync;
    var origMkdirSync = fs.mkdirSync;

    fs.writeFileSync = function (p, data) {
        var watched = typeof p === 'string' && p.indexOf(SHARE + 'tizentube') === 0;
        try {
            var result = origWriteFileSync.apply(fs, arguments);
        } catch (e) {
            if (watched) record('writeFileSync FAILED ' + p + ': ' + e);
            throw e;
        }
        if (watched) {
            copyStats.files++;
            copyStats.bytes += (data && data.length) || 0;
            if (copyStats.files === 1 || copyStats.files % 250 === 0 ||
                p.indexOf('tizentube-ca') !== -1 || p.indexOf('/ssl/certs/') !== -1) {
                record('writeFileSync #' + copyStats.files + ' (' + copyStats.bytes + 'B so far) ' + p);
            }
        }
        return result;
    };

    fs.mkdirSync = function (p) {
        try {
            var result = origMkdirSync.apply(fs, arguments);
        } catch (e) {
            record('mkdirSync FAILED ' + p + ': ' + e);
            throw e;
        }
        copyStats.dirs++;
        if (copyStats.dirs === 1) record('mkdirSync first dir ' + p);
        return result;
    };
}

if (net) {
    var origListen = net.Server.prototype.listen;
    net.Server.prototype.listen = function () {
        var server = this;
        var desc = Array.prototype.slice.call(arguments)
            .filter(function (a) { return typeof a !== 'function'; })
            .map(function (a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); })
            .join(' ');
        record('listen() called: ' + desc);
        server.once('listening', function () {
            record('LISTENING ' + safe(function () { return JSON.stringify(server.address()); }));
        });
        server.once('error', function (e) {
            record('listen ERROR (' + desc + '): ' + e);
        });
        return origListen.apply(this, arguments);
    };
}

// --- diagnostics HTTP server ----------------------------------------------

function sendText(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(text);
}

function listDir(p) {
    return fs.readdirSync(p).map(function (name) {
        var full = p.replace(/\/$/, '') + '/' + name;
        return safe(function () {
            var st = fs.statSync(full);
            return (st.isDirectory() ? 'd ' : 'f ') + st.size + '\t' + st.mtime.toISOString() + '\t' + name;
        }, '? ' + name);
    }).join('\n');
}

function du(p, budget) {
    var total = { files: 0, dirs: 0, bytes: 0, truncated: false };
    (function walk(cur) {
        if (total.files + total.dirs > budget) { total.truncated = true; return; }
        var st = fs.statSync(cur);
        if (st.isDirectory()) {
            total.dirs++;
            fs.readdirSync(cur).forEach(function (n) { walk(cur + '/' + n); });
        } else {
            total.files++;
            total.bytes += st.size;
        }
    })(p);
    return JSON.stringify(total);
}

function probe(port, path, cb) {
    var done = false;
    var req = http.get({ host: '127.0.0.1', port: port, path: path }, function (r) {
        var body = '';
        r.on('data', function (c) { body += c; });
        r.on('end', function () { if (!done) { done = true; cb('HTTP ' + r.statusCode + ' ' + body.slice(0, 500)); } });
    });
    req.on('error', function (e) { if (!done) { done = true; cb('ERROR ' + e); } });
    req.setTimeout(4000, function () { if (!done) { done = true; cb('TIMEOUT after 4s'); req.abort(); } });
}

if (http) {
    var diagServer = http.createServer(function (req, res) {
        var u = require('url').parse(req.url, true);
        try {
            if (u.pathname === '/log') {
                var text = lines.join('\n');
                if (u.query.file && logFile) text = fs.readFileSync(logFile, 'utf8');
                if (u.query.tail) text = text.split('\n').slice(-Number(u.query.tail)).join('\n');
                return sendText(res, 200, text);
            }
            if (u.pathname === '/ls') return sendText(res, 200, listDir(u.query.p || SHARE));
            if (u.pathname === '/du') return sendText(res, 200, du(u.query.p || SHARE, Number(u.query.max) || 20000));
            if (u.pathname === '/probe') {
                return probe(Number(u.query.port) || 8100, u.query.path || '/tizentube/getState', function (r) {
                    sendText(res, 200, r);
                });
            }
            sendText(res, 200, 'endpoints: /log[?file=1&tail=N]  /ls?p=  /du?p=&max=  /probe?port=&path=');
        } catch (e) {
            sendText(res, 500, String(e && e.stack || e));
        }
    });
    diagServer.on('error', function (e) { record('diag server error: ' + e); });
    diagServer.listen(DIAG_PORT, '0.0.0.0');
}

// --- load the real service, synchronously, like the runtime does -----------

record('require(' + REAL_SERVICE + ') START');
var realExports = null;
try {
    realExports = require(REAL_SERVICE);
    record('require(' + REAL_SERVICE + ') RETURNED (sync part done); exports=' +
        safe(function () { return Object.keys(realExports || {}).join(','); }));
} catch (e) {
    record('require(' + REAL_SERVICE + ') THREW: ' + (e && e.stack || e));
}

function forward(name, args) {
    record('lifecycle ' + name + ' ' + safe(function () { return JSON.stringify(args[0]); }, ''));
    if (realExports && typeof realExports[name] === 'function') {
        try { return realExports[name].apply(realExports, args); } catch (e) { record(name + ' THREW: ' + e); }
    }
}

module.exports = {
    onStart: function () { return forward('onStart', arguments); },
    onRequest: function () { return forward('onRequest', arguments); },
    onExit: function () { return forward('onExit', arguments); },
    onStop: function () { return forward('onStop', arguments); }
};
