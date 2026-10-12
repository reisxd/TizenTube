"use strict";

// Runs the TizenTube YouTube proxy on a PC or server, for TVs that can't run the
// StandaloneService (tizen.systeminfo web.service = false, e.g. a 2026 S85H on Tizen 10).
// Pair it with the launcher in /remote, which opens <PUBLIC_ORIGIN>/tv on the TV.
//
//   PUBLIC_ORIGIN=http://192.168.10.20:8100 node proxy-host.js
//
// Environment:
//   PUBLIC_ORIGIN  origin the TV uses to reach this server (required)
//   PORT           listen port (default: the port in PUBLIC_ORIGIN, else 8100)
//   HOST           listen address (default 0.0.0.0)
//   CLIENT_LOG=1   relay the TV page's errors and console warnings to this console

const express = require('express');
const URL = require('url');
const createYouTubeProxy = require('./utils/youtubeProxy.js');

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN;
if (!PUBLIC_ORIGIN || !/^https?:\/\/[^/]+\/?$/.test(PUBLIC_ORIGIN)) {
    console.error('Set PUBLIC_ORIGIN to the origin the TV will use, e.g. PUBLIC_ORIGIN=http://192.168.10.20:8100');
    process.exit(1);
}
const PORT = Number(process.env.PORT || URL.parse(PUBLIC_ORIGIN).port || 8100);
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_LOG = process.env.CLIENT_LOG === '1';

// There are no DevTools on a retail TV, so optionally ship page errors back to us.
const clientLogScript = `<script>(function () {
    function send(level, args) {
        try {
            var parts = Array.prototype.map.call(args, function (v) {
                try { return typeof v === 'string' ? v : (v && v.stack) || JSON.stringify(v); } catch (e) { return String(v); }
            });
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/tizentube/client-log', true);
            xhr.setRequestHeader('Content-Type', 'text/plain');
            xhr.send(level + ' ' + parts.join(' '));
        } catch (e) { /* never break the page */ }
    }
    ['error', 'warn'].forEach(function (level) {
        var original = console[level];
        console[level] = function () { send(level, arguments); return original.apply(console, arguments); };
    });
    window.addEventListener('error', function (e) { send('onerror', [e.message + ' @ ' + e.filename + ':' + e.lineno]); });
    window.addEventListener('unhandledrejection', function (e) { send('unhandledrejection', [e.reason]); });
    send('info', ['page ' + location.href + ' secureContext=' + window.isSecureContext + ' UA ' + navigator.userAgent]);
})();</script>`;

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.get('/tizentube/ping', (req, res) => {
    res.json({ ok: true, publicOrigin: PUBLIC_ORIGIN });
});

app.post('/tizentube/client-log', express.text({ type: '*/*', limit: '64kb' }), (req, res) => {
    if (CLIENT_LOG) console.log(`[tv ${new Date().toISOString()}] ${req.body}`);
    res.status(204).end();
});

app.all('*', createYouTubeProxy({
    publicOrigin: PUBLIC_ORIGIN,
    cookieDomain: null,
    headScript: CLIENT_LOG ? clientLogScript : ''
}));

app.listen(PORT, HOST, () => {
    console.log(`TizenTube proxy listening on ${HOST}:${PORT}, TV should open ${PUBLIC_ORIGIN.replace(/\/$/, '')}/tv`);
});
