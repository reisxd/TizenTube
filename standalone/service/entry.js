"use strict";

// TizenTube Standalone service entry point (dist/index.js).
//
// Tizen loads this file when the service starts and fails the launch with
// "Launch Service failed: Unknown error" if that takes too long. The bundled
// service (dist/app.js) is several MB, and on older TVs parsing it takes longer
// than Tizen waits (issue #731). So this file stays small, uses only Node.js
// core modules, and loads app.js after the service has started.
//
// It also serves the service's status and errors, with stack traces, on
// http://127.0.0.1:8099/tizentube/error, so the UI app can show them on screen.

const http = require('http');

const ERROR_PORT = 8099;
const errors = [];
const status = { state: 'starting', appLoadMs: null };

function describe(err, stage) {
    return {
        stage: stage,
        time: new Date().toISOString(),
        name: err && err.name ? String(err.name) : typeof err,
        message: err && err.message ? String(err.message) : String(err),
        stack: err && err.stack ? String(err.stack) : '',
        node: process.version
    };
}

function record(err, stage) {
    errors.push(describe(err, stage));
    if (errors.length > 20) errors.shift();
}

try {
    http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        if (req.url.indexOf('clear=1') !== -1) errors.length = 0;
        res.end(JSON.stringify({ node: process.version, status: status, errors: errors }));
    }).on('error', e => record(e, 'error-server')).listen(ERROR_PORT, '127.0.0.1');
} catch (e) {
    // Nothing else can report this, so keep going without the error server.
}

// Lets the rest of the service add entries, e.g. why a debugger attach failed.
global.tizentubeReportError = record;

process.on('uncaughtException', e => record(e, 'uncaughtException'));
process.on('unhandledRejection', e => record(e, 'unhandledRejection'));

setTimeout(() => {
    status.state = 'loading app.js';
    const startedAt = Date.now();
    try {
        require('./app.js');
        status.state = 'running';
    } catch (e) {
        status.state = 'app.js failed to load';
        record(e, 'startup');
    }
    status.appLoadMs = Date.now() - startedAt;
}, 0);

// To avoid issues on newer versions of Tizen.
module.exports = {
    onStart: () => {},
    onRequest: () => {},
    onStop: () => {}
};
