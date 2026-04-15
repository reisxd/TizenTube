/**
 * logServer.js — Remote log forwarding for TizenTube via TizenBrew relay
 *
 * Logs are forwarded through TizenBrew's Node.js service over WebSocket:
 *   TizenTube (Cobalt JS) → ws://127.0.0.1:8081 (LogEvent type 15)
 *     → TizenBrew logBus → remoteLogger → http.request → PS1 server on PC
 *
 * This bypasses Cobalt's mixed-content block (HTTPS page → HTTP local server).
 * IP/port for the PS1 server is configured in TizenBrew's Remote Logging settings.
 *
 * Enable/disable: Settings → Miscellaneous → Remote Log Server → Enable Remote Logging
 */

import { configRead } from '../config.js';

// ── Enable check ─────────────────────────────────────────────────────────────
function isEnabled() {
  try { return !!configRead('logServerEnabled'); } catch { return false; }
}

// ── TizenBrew WebSocket relay ─────────────────────────────────────────────────
const TB_WS_URL = 'ws://127.0.0.1:8081';
const TB_LOG_EVENT = 15; // wsCommunication.Events.LogEvent

let _wsTB = null;
let _wsTBReady = false;
let _wsTBReconnectTimer = 0;

function connectTizenBrew() {
  clearTimeout(_wsTBReconnectTimer);
  if (typeof WebSocket === 'undefined') return;
  try {
    const ws = new WebSocket(TB_WS_URL);
    ws.onopen = () => {
      _wsTB = ws;
      _wsTBReady = true;
      if (_queue.length > 0) setTimeout(drain, 0);
    };
    ws.onclose = () => {
      if (_wsTB === ws) { _wsTB = null; _wsTBReady = false; }
      _wsTBReconnectTimer = setTimeout(connectTizenBrew, 8000);
    };
    ws.onerror = () => {
      if (_wsTB === ws) { _wsTB = null; _wsTBReady = false; }
    };
  } catch (_) {
    _wsTBReconnectTimer = setTimeout(connectTizenBrew, 8000);
  }
}

function sendViaTizenBrew(entry) {
  if (!_wsTBReady || !_wsTB || _wsTB.readyState !== 1 /* OPEN */) return false;
  try {
    _wsTB.send(JSON.stringify({
      type: TB_LOG_EVENT,
      payload: {
        level:   entry.level   || 'INFO',
        source:  entry.context || 'TizenTube',
        message: entry._formatted || entry.message || JSON.stringify(entry)
      }
    }));
    return true;
  } catch (_) {
    return false;
  }
}

// HTTP relay — POST to TizenBrew's local /tv-log endpoint on the same server
// that already serves module files. Cobalt can always reach http://127.0.0.1:8081.
const TB_HTTP_URL = 'http://127.0.0.1:8081/tv-log';

function sendViaHttp(entry) {
  const body = JSON.stringify(entry);
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', TB_HTTP_URL, true);
      xhr.timeout = 2000;
      xhr.onload    = () => resolve();
      xhr.onerror   = () => reject(new Error('http_relay_error'));
      xhr.ontimeout = () => reject(new Error('http_relay_timeout'));
      xhr.send(body);
    } catch (err) {
      reject(err);
    }
  });
}

export function sendRemotePayload(_url, entry) {
  // 1. WebSocket relay (if Cobalt supports WebSocket and connection is open)
  if (sendViaTizenBrew(entry)) return Promise.resolve();
  // 2. HTTP relay to TizenBrew's local server (always reachable from Cobalt)
  return sendViaHttp(entry);
}

// ── Queue / drain ─────────────────────────────────────────────────────────────
let _queue = [];
let _draining = false;
const MAX_QUEUE = 300;

function drain() {
  if (_draining || _queue.length === 0) return;
  if (!_wsTBReady) { _queue = []; return; }
  _draining = true;
  const entry = _queue[0];
  sendRemotePayload(null, entry)
    .then(() => { _queue.shift(); })
    .catch(() => { _queue.shift(); })
    .finally(() => {
      _draining = false;
      if (_queue.length > 0) setTimeout(drain, 50);
    });
}

function enqueue(rawLine) {
  if (!isEnabled()) return;
  try {
    const m = rawLine.match(/^\[([^\]]+)\] \[TT_ADBLOCK_FILE\] (\S+) ([\s\S]*)$/);
    let entry;
    if (m) {
      const ts      = m[1];
      const label   = m[2];
      const payload = (() => { try { return JSON.parse(m[3]); } catch { return m[3]; } })();
      const payloadStr = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
      entry = {
        ts,
        level:      'INFO',
        label,
        payload,
        _formatted: `[${ts}] [INFO] [TizenTube] ${label} ${payloadStr}`,
        context:    'TizenTube',
        message:    `${label} ${payloadStr}`,
        data:       payload,
      };
    } else {
      const ts = new Date().toISOString();
      entry = {
        ts,
        level:      'INFO',
        label:      'raw',
        payload:    rawLine,
        _formatted: `[${ts}] [INFO] [TizenTube] ${rawLine}`,
        context:    'TizenTube',
        message:    rawLine,
      };
    }
    if (_queue.length >= MAX_QUEUE) _queue.shift();
    _queue.push(entry);
    setTimeout(drain, 0);
  } catch (_) {}
}

// ── Install ───────────────────────────────────────────────────────────────────
function install() {
  if (window.__ttLogServerInstalled) return;
  window.__ttLogServerInstalled = true;

  connectTizenBrew();

  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];
  const origPush = Array.prototype.push;
  const arr = window.__ttFileOnlyLogs;
  arr.push = function (...args) {
    const result = origPush.apply(this, args);
    for (const line of args) { try { enqueue(String(line)); } catch (_) {} }
    return result;
  };
}

install();
