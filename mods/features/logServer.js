/**
 * logServer.js — Remote log forwarding for TizenTube
 *
 * Compatible with https://github.com/KrX3D/TizenYouTube/blob/main/scripts_log_receiver.ps1
 * Run the PS1 script on your Windows PC; it listens on port 3030 at /tv-log by default.
 *
 * Configuration (Settings → Debug → Remote Log Server):
 *   logServerEnabled  bool    default false
 *   logServerIp       string  default '192.168.10.11'   (configurable from settings)
 *   logServerPort     number  default 3030
 *
 * To change the IP (no text input on TV remote — use the debug console):
 *   const c = JSON.parse(localStorage['ytaf-configuration']);
 *   c.logServerIp = '192.168.1.X';
 *   localStorage['ytaf-configuration'] = JSON.stringify(c);
 *
 * Each log entry is POSTed as JSON to http://{ip}:{port}/tv-log:
 *   { ts, label, payload, _formatted, context, message, data }
 * The _formatted field is used by the PS1 receiver for clean display.
 */

import { configRead } from '../config.js';

let _queue = [];
let _draining = false;
let _failCount = 0;
let _disabledUntil = 0;
let _lastUrl = '';
const MAX_QUEUE = 300;
const MAX_FAILS = 10;
const FAIL_BACKOFF_MS = 30 * 1000;

function isEnabled() {
  try { return !!configRead('logServerEnabled'); } catch { return false; }
}

function getUrl() {
  if (!isEnabled()) return '';
  try {
    const ip = String(configRead('logServerIp') || '').trim();
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

function drain() {
  if (_draining || _queue.length === 0) return;
  const url = getUrl();
  if (!url || (_failCount >= MAX_FAILS && Date.now() < _disabledUntil)) { _queue = []; return; }
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

function sendRemotePayload(url, entry) {
  const body = JSON.stringify(entry);
  // Use text/plain to avoid CORS preflight (simple request — no OPTIONS needed).
  // The PS1 receiver reads the raw body and parses it as JSON regardless of Content-Type.
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
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error('xhr_error'));
      xhr.ontimeout = () => reject(new Error('xhr_timeout'));
      xhr.send(body);
    } catch (err) {
      reject(err);
    }
  });
}

function enqueue(rawLine) {
  if (!isEnabled()) return;
  if (_failCount >= MAX_FAILS && Date.now() >= _disabledUntil) {
    console.info('[LogServer] Backoff elapsed, resuming log forwarding');
    _failCount = 0;
    _disabledUntil = 0;
  }
  if (_failCount >= MAX_FAILS && Date.now() < _disabledUntil) return;
  try {
    const m = rawLine.match(/^\[([^\]]+)\] \[TT_ADBLOCK_FILE\] (\S+) ([\s\S]*)$/);
    let entry;
    if (m) {
      const ts = m[1];
      const label = m[2];
      const payload = (() => { try { return JSON.parse(m[3]); } catch { return m[3]; } })();
      const payloadStr = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
      entry = {
        ts,
        label,
        payload,
        // PS1-compatible fields (scripts_log_receiver.ps1 uses _formatted for display):
        _formatted: `[${ts}] [INFO] [TizenTube] ${label} ${payloadStr}`,
        context: 'TizenTube',
        message: `${label} ${payloadStr}`,
        data: payload,
      };
    } else {
      const ts = new Date().toISOString();
      entry = {
        ts,
        label: 'raw',
        payload: rawLine,
        _formatted: `[${ts}] [INFO] [TizenTube] ${rawLine}`,
        context: 'TizenTube',
        message: rawLine,
      };
    }
    if (_queue.length >= MAX_QUEUE) _queue.shift();
    _queue.push(entry);
    setTimeout(drain, 0);
  } catch (_) {}
}

/**
 * Patches window.__ttFileOnlyLogs.push so every appendFileOnlyLog call
 * from any module is automatically forwarded. No circular imports needed.
 */
function install() {
  if (window.__ttLogServerInstalled) return;
  window.__ttLogServerInstalled = true;
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
