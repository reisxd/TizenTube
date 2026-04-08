/**
 * logServer.js — Remote log forwarding for TizenTube
 *
 * When `logServerUrl` is configured, every appendFileOnlyLog entry is also
 * POSTed to that URL as a JSON body: { label, payload, ts }
 * Any HTTP server that accepts POST requests can receive the logs.
 *
 * Example — simple Node.js receiver (run on your PC):
 *   node -e "
 *     const h=require('http');
 *     h.createServer((q,s)=>{
 *       let b='';
 *       q.on('data',d=>b+=d);
 *       q.on('end',()=>{ try{const e=JSON.parse(b); console.log(e.ts,e.label,JSON.stringify(e.payload));}catch{console.log(b);} s.end(); });
 *     }).listen(8765, ()=>console.log('Listening on :8765'));
 *   "
 *
 * Set logServerUrl in TizenTube settings to e.g. "http://192.168.1.50:8765/log"
 *
 * This module patches window.__ttFileOnlyLogs.push so ALL modules benefit
 * automatically without circular import issues.
 */

import { configRead } from '../config.js';

let _queue = [];
let _draining = false;
let _failCount = 0;
const MAX_QUEUE = 300;
const MAX_FAILS = 10; // stop trying after 10 consecutive failures

function getUrl() {
  try { return String(configRead('logServerUrl') || '').trim(); } catch { return ''; }
}

function drain() {
  if (_draining || _queue.length === 0) return;
  const url = getUrl();
  if (!url || _failCount >= MAX_FAILS) { _queue = []; return; }
  _draining = true;
  const entry = _queue[0];
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).then(() => {
    _failCount = 0;
    _queue.shift();
  }).catch(() => {
    _failCount++;
    _queue.shift(); // drop on error to avoid retrying the same entry indefinitely
  }).finally(() => {
    _draining = false;
    if (_queue.length > 0) setTimeout(drain, 50);
  });
}

function enqueue(rawLine) {
  const url = getUrl();
  if (!url || _failCount >= MAX_FAILS) return;
  // Parse the line written by appendFileOnlyLog:
  // "[<iso>] [TT_ADBLOCK_FILE] <label> <jsonPayload>"
  try {
    const m = rawLine.match(/^\[([^\]]+)\] \[TT_ADBLOCK_FILE\] (\S+) ([\s\S]*)$/);
    const entry = m
      ? { ts: m[1], label: m[2], payload: (() => { try { return JSON.parse(m[3]); } catch { return m[3]; } })() }
      : { ts: new Date().toISOString(), label: 'raw', payload: rawLine };
    if (_queue.length >= MAX_QUEUE) _queue.shift();
    _queue.push(entry);
    setTimeout(drain, 0);
  } catch (_) {}
}

/**
 * Install a proxy on window.__ttFileOnlyLogs so every appendFileOnlyLog
 * call (from any module) is automatically forwarded to the log server.
 * Called once at module load time.
 */
function install() {
  if (window.__ttLogServerInstalled) return;
  window.__ttLogServerInstalled = true;

  // Ensure the array exists and wrap its push method.
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
}
