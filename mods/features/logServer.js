/**
 * logServer.js — Remote log forwarding for TizenTube
 *
 * Compatible with https://github.com/KrX3D/TizenYouTube/blob/main/scripts_log_receiver.ps1
 * Run the PS1 script on your Windows PC; it listens on port 3030 at /tv-log by default.
 *
 * Forwarding strategy (in priority order):
 *   1. TizenBrew WebSocket relay — sends a LogEvent (type 15) to TizenBrew's service on
 *      ws://127.0.0.1:8081. TizenBrew's Node.js service then POSTs to the PS1 server via
 *      native http.request — no browser CORS or mixed-content restrictions apply.
 *      IP/port used is whichever is configured in TizenBrew's Remote Logging settings.
 *
 *   2. Direct HTTP fallback — if TizenBrew is not connected, posts directly from Cobalt
 *      to the IP/port configured in TizenTube's own Log Server settings.
 *
 * Configuration (Settings → Debug → Remote Log Server):
 *   logServerEnabled  bool    default false
 *   logServerIp       string  (configurable from settings)
 *   logServerPort     number  default 3030
 */

import { configRead } from '../config.js';

// ── Queue / backoff state ────────────────────────────────────────────────────
let _queue = [];
let _draining = false;
let _failCount = 0;
let _disabledUntil = 0;
let _lastUrl = '';
const MAX_QUEUE = 300;
const MAX_FAILS = 10;
const FAIL_BACKOFF_MS = 30 * 1000;

// ── TizenBrew WebSocket relay ────────────────────────────────────────────────
const TB_WS_URL = 'ws://127.0.0.1:8081';
const TB_LOG_EVENT = 15; // wsCommunication.Events.LogEvent

let _wsTB = null;
let _wsTBReady = false;
let _wsTBReconnectTimer = 0;

function connectTizenBrew() {
  clearTimeout(_wsTBReconnectTimer);
  if (typeof WebSocket === 'undefined') return; // Cobalt has no WebSocket — skip
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
      // onclose will fire after onerror — reconnect handled there
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

// ── Direct HTTP fallback ─────────────────────────────────────────────────────
function isEnabled() {
  try { return !!configRead('logServerEnabled'); } catch { return false; }
}

function getUrl() {
  if (!isEnabled()) return '';
  try {
    const ip   = String(configRead('logServerIp') || '').trim();
    const port = Number(configRead('logServerPort') || 3030);
    if (!ip) return '';
    const url = `http://${ip}:${port}/tv-log`;
    if (url !== _lastUrl) {
      if (_lastUrl) console.info('[LogServer] URL changed:', _lastUrl, '→', url);
      _lastUrl = url;
      _failCount = 0;
      _disabledUntil = 0;
    }
    return url;
  } catch { return ''; }
}

// ── Send (WS relay → HTTP fallback) ─────────────────────────────────────────
export function sendRemotePayload(url, entry) {
  // 1. Try TizenBrew WS relay — native Node.js POST, no CORS/mixed-content limits
  if (sendViaTizenBrew(entry)) return Promise.resolve();

  // 2. Direct HTTP fallback
  // Use text/plain (no Content-Type header) to avoid CORS preflight OPTIONS request.
  // The PS1 receiver reads the raw body and parses it as JSON regardless of Content-Type.
  const body = JSON.stringify(entry);
  try {
    if (navigator?.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      if (ok) return Promise.resolve();
    }
  } catch (_) {}

  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.timeout = 4000;
      xhr.onload  = () => resolve();
      xhr.onerror = () => reject(new Error('xhr_error'));
      xhr.ontimeout = () => reject(new Error('xhr_timeout'));
      xhr.send(body);
    } catch (err) {
      reject(err);
    }
  });
}

// ── Queue / drain ────────────────────────────────────────────────────────────
function drain() {
  if (_draining || _queue.length === 0) return;
  // If WS relay is available, URL/failcount don't gate us — send via relay regardless
  const url = _wsTBReady ? '' : getUrl();
  if (!_wsTBReady && (!url || (_failCount >= MAX_FAILS && Date.now() < _disabledUntil))) {
    _queue = [];
    return;
  }
  _draining = true;
  const entry = _queue[0];
  sendRemotePayload(url, entry).then(() => {
    _failCount = 0;
    _queue.shift();
  }).catch(() => {
    _failCount++;
    if (_failCount >= MAX_FAILS) {
      _disabledUntil = Date.now() + FAIL_BACKOFF_MS;
      console.warn('[LogServer] Entering backoff after repeated failures. Retry after', new Date(_disabledUntil).toISOString());
    }
    _queue.shift();
  }).finally(() => {
    _draining = false;
    if (_queue.length > 0) setTimeout(drain, 50);
  });
}

function enqueue(rawLine) {
  if (!isEnabled() && !_wsTBReady) return;
  if (_failCount >= MAX_FAILS && Date.now() >= _disabledUntil) {
    console.info('[LogServer] Backoff elapsed, resuming log forwarding');
    _failCount = 0;
    _disabledUntil = 0;
  }
  if (!_wsTBReady && _failCount >= MAX_FAILS && Date.now() < _disabledUntil) return;
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
        level:   'INFO',
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

// ── Install ──────────────────────────────────────────────────────────────────
function install() {
  if (window.__ttLogServerInstalled) return;
  window.__ttLogServerInstalled = true;

  // Connect to TizenBrew's WS service for relay forwarding
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

export function resetLogServerFailCount() {
  _failCount = 0;
  _disabledUntil = 0;
}
