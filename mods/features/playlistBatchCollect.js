/**
 * playlistBatchCollect.js
 *
 * Intercepts YouTube TV playlist continuation requests (both XMLHttpRequest
 * and window.fetch). When a playlist continuation arrives, immediately fetches
 * ALL remaining batches in sequence and combines them into a single response
 * before returning it to YouTube TV.
 *
 * The existing JSON.parse filter then processes all items at once, so the
 * virtual list only sees unwatched videos — no empty spaces, no helper tile
 * cycling, and no repeated scroll-to-bottom triggers.
 *
 * Only active when enablePlaylistBatchCollect is true (default: true).
 * Falls back gracefully on any error.
 *
 * Transport note: YouTube TV on Tizen 5.0/5.5 uses XMLHttpRequest, not
 * window.fetch. Both transports are patched here. The fetch patch covers
 * environments where fetch is used (desktop browser dev/testing).
 *
 * XHR delivery: responses are injected via XMLHttpRequest.prototype getter
 * overrides backed by a WeakMap. This is more reliable than Object.defineProperty
 * on instances, which silently fails on old WebKit (Tizen 5.0) for native XHR
 * properties stored in internal slots.
 *
 * De-duplication: window.__ttBatchCollectActive is set synchronously in send()
 * before the async block starts, so subsequent duplicate XHR sends (fired by
 * schedulePlaylistAutoLoad's 5-attempt schedule) are dropped immediately.
 */

import { appendFileOnlyLog } from './hideWatched.js';
import { configRead } from '../config.js';

function _log(label, payload) {
  try { appendFileOnlyLog(label, payload); } catch (_) {}
}

// ── Save native implementations before any patching ──────────────────────────

// Native fetch — used by both the fetch patch and the XHR interceptor to make
// sub-requests without going through the patched XHR/fetch again.
const _nativeFetch = (typeof window.fetch === 'function')
  ? window.fetch.bind(window)
  : null;

// ── URL detection ─────────────────────────────────────────────────────────────

function _isBrowseUrl(url) {
  try { return String(url).includes('/youtubei/v1/browse'); }
  catch (_) { return false; }
}

// ── Request body parsing ──────────────────────────────────────────────────────

function _parseBody(options) {
  try {
    const b = options?.body;
    if (!b) return null;
    return JSON.parse(typeof b === 'string' ? b : new TextDecoder().decode(b));
  } catch (_) { return null; }
}

// ── Continuation token extraction ─────────────────────────────────────────────

function _getToken(continuations) {
  if (!Array.isArray(continuations)) return null;
  return continuations[0]?.nextContinuationData?.continuation
      || continuations[0]?.reloadContinuationData?.continuation
      || null;
}

// ── Synthesize a Response from a mutated data object (fetch path) ─────────────

function _makeResponse(data, originalResponse) {
  const headers = new Headers();
  try {
    originalResponse.headers.forEach((v, k) => {
      if (/^(content-encoding|transfer-encoding|content-length)$/i.test(k)) return;
      try { headers.set(k, v); } catch (_) {}
    });
  } catch (_) {}
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), {
    status: originalResponse.status || 200,
    headers,
  });
}

// ── WeakMap-based XHR property override ──────────────────────────────────────
//
// Object.defineProperty on XHR *instances* silently fails on old WebKit (Tizen
// 5.0) for properties backed by native internal slots (responseText, status,
// readyState, etc.). The own-property is never created, so the prototype getter
// always wins and returns the native (empty) value.
//
// Fix: patch the prototype getters themselves to check a WeakMap first. When
// we want to deliver a synthetic response to a specific XHR, we store its data
// in the WeakMap; the prototype getter returns that data instead of the native
// value. After delivery we clean up the entry.

const _xhrData = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

if (_xhrData && typeof XMLHttpRequest !== 'undefined') {
  const proto = XMLHttpRequest.prototype;

  // Properties to intercept: [property, fallback native getter]
  const props = ['responseText', 'response', 'status', 'statusText', 'readyState'];
  for (const prop of props) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.get) continue; // not a getter — skip
    const nativeGet = desc.get;
    try {
      Object.defineProperty(proto, prop, {
        get() {
          const override = _xhrData.get(this);
          if (override && prop in override) return override[prop];
          return nativeGet.call(this);
        },
        configurable: true,
      });
    } catch (_) {}
  }

  // Also intercept getAllResponseHeaders so callers don't see an empty string
  const nativeGetHeaders = proto.getAllResponseHeaders;
  if (typeof nativeGetHeaders === 'function') {
    try {
      proto.getAllResponseHeaders = function getAllResponseHeaders() {
        const override = _xhrData.get(this);
        if (override) return 'content-type: application/json\r\n';
        return nativeGetHeaders.call(this);
      };
    } catch (_) {}
  }

  _log('playlist.batch_collect.weakmap_installed', {});
}

// ── Deliver synthetic response to an XHR object ───────────────────────────────

function _deliverXHRResponse(xhr, bodyStr, status) {
  try {
    const payload = {
      responseText: bodyStr,
      response:     bodyStr,
      status:       status || 200,
      statusText:   'OK',
      readyState:   4,
    };

    if (_xhrData) {
      // Primary path: WeakMap prototype override (reliable on old WebKit)
      _xhrData.set(xhr, payload);
    } else {
      // Fallback: try Object.defineProperty on instance (may silently fail)
      for (const [prop, val] of Object.entries(payload)) {
        try {
          Object.defineProperty(xhr, prop, { value: val, configurable: true, writable: true });
        } catch (_) {
          try { xhr[prop] = val; } catch (_2) {}
        }
      }
    }

    // Check what YouTube TV will actually read back (diagnostic)
    const rtLen = (() => { try { return xhr.responseText?.length || 0; } catch (_) { return -1; } })();
    _log('playlist.batch_collect.deliver_check', { rtLen, status: xhr.status, readyState: xhr.readyState });

    // Fire readystatechange for states 2 → 4 (HEADERS_RECEIVED, LOADING, DONE)
    for (const state of [2, 3, 4]) {
      if (_xhrData) _xhrData.get(xhr) && (_xhrData.get(xhr).readyState = state);
      try { xhr.dispatchEvent(new Event('readystatechange')); } catch (_) {}
    }
    if (typeof xhr.onreadystatechange === 'function') {
      try { xhr.onreadystatechange(); } catch (_) {}
    }

    // Fire load / loadend
    try { xhr.dispatchEvent(new Event('load')); } catch (_) {}
    try { xhr.dispatchEvent(new Event('loadend')); } catch (_) {}
    if (typeof xhr.onload === 'function') {
      try { xhr.onload(); } catch (_) {}
    }

    // Clean up WeakMap entry after a short delay (let handlers finish first)
    if (_xhrData) {
      setTimeout(() => { try { _xhrData.delete(xhr); } catch (_) {} }, 5000);
    }
  } catch (err) {
    _log('playlist.batch_collect.deliver_error', { err: String(err?.message || err) });
  }
}

// ── Progress overlay ──────────────────────────────────────────────────────────

function _showProgress(msg) {
  if (typeof document === 'undefined') return;
  const id = 'tt-batch-collect-notice';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '4%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.88)', color: '#fff',
      padding: '12px 22px', borderRadius: '10px',
      zIndex: '999999', fontSize: '16px',
      pointerEvents: 'none',
    });
    document.body?.appendChild(el);
  }
  el.textContent = msg;
}

function _hideProgress() {
  if (typeof document === 'undefined') return;
  document.getElementById('tt-batch-collect-notice')?.remove();
}

// ── AbortController shim for older WebKit ─────────────────────────────────────

function _makeAbort() {
  if (typeof AbortController !== 'undefined') return new AbortController();
  const signal = { aborted: false };
  return { signal, abort() { signal.aborted = true; } };
}

// ── Core: collect all remaining batches ───────────────────────────────────────

async function _collectAll(url, plc, context) {
  const MAX = Math.max(1, Math.min(500, Number(configRead('playlistBatchCollectMaxBatches') || 50)));

  if (!context) return null;
  if (!_nativeFetch) return null;

  const allContents = Array.isArray(plc.contents) ? [...plc.contents] : [];
  let continuations = plc.continuations;
  let batchesLoaded = 1;
  const abort = _makeAbort();
  const nativeAbort = typeof AbortController !== 'undefined';

  const onNav = () => abort.abort();
  window.addEventListener('hashchange', onNav, { once: true });
  window.addEventListener('popstate',   onNav, { once: true });

  _showProgress(`Playlist: loading batch ${batchesLoaded}…`);

  try {
    while (continuations && batchesLoaded < MAX && !abort.signal.aborted) {
      const token = _getToken(continuations);
      if (!token) break;

      const fetchOpts = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, continuation: token }),
        credentials: 'include',
        mode: 'cors',
      };
      if (nativeAbort) fetchOpts.signal = abort.signal;

      let nextData;
      try {
        const nextResp = await _nativeFetch(url, fetchOpts);
        nextData = await nextResp.json();
      } catch (err) {
        _log('playlist.batch_collect.sub_error', {
          batch: batchesLoaded,
          aborted: abort.signal.aborted,
          err: String(err?.message || err),
        });
        break;
      }

      const nextPlc = nextData?.continuationContents?.playlistVideoListContinuation;
      if (!nextPlc) break;

      const newItems = Array.isArray(nextPlc.contents) ? nextPlc.contents : [];
      allContents.push(...newItems);
      continuations = nextPlc.continuations || null;
      batchesLoaded++;
      _showProgress(`Playlist: loading batch ${batchesLoaded}…`);
    }
  } finally {
    window.removeEventListener('hashchange', onNav);
    window.removeEventListener('popstate',   onNav);
    _hideProgress();
  }

  _log('playlist.batch_collect.done', {
    rawItems: allContents.length,
    batches: batchesLoaded,
    hasMore: !!continuations,
    hitLimit: batchesLoaded >= MAX,
  });

  return { allContents, continuations };
}

// ── XHR interception ──────────────────────────────────────────────────────────

if (typeof XMLHttpRequest !== 'undefined') {
  const _origXHROpen      = XMLHttpRequest.prototype.open;
  const _origXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const _origXHRSend      = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ttUrl        = url;
    this.__ttMethod     = method;
    this.__ttReqHeaders = {};
    return _origXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__ttReqHeaders) this.__ttReqHeaders[name] = value;
    return _origXHRSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const url = this.__ttUrl;

    // Fast path: not a browse URL
    if (!_isBrowseUrl(url)) return _origXHRSend.apply(this, arguments);

    // Must be a continuation request
    const reqBody = _parseBody({ body });
    if (!reqBody?.continuation || !reqBody?.context) return _origXHRSend.apply(this, arguments);

    // Feature flag
    if (!configRead('enablePlaylistBatchCollect')) return _origXHRSend.apply(this, arguments);

    // De-duplicate: if a batch collect is already in progress, drop this
    // duplicate continuation request. The running collect will deliver all
    // batches; this one can be safely discarded.
    if (window.__ttBatchCollectActive) return;

    // Mark active synchronously — before the first await — so any subsequent
    // send() calls that arrive before we yield see the flag immediately.
    window.__ttBatchCollectActive = true;

    const xhr     = this;
    const method  = xhr.__ttMethod || 'POST';
    const headers = Object.assign(
      { 'content-type': 'application/json' },
      xhr.__ttReqHeaders || {}
    );

    ;(async () => {
      let data;
      let rawStatus = 200;

      try {
        const resp = await _nativeFetch(url, {
          method, headers, body, credentials: 'include', mode: 'cors',
        });
        rawStatus = resp.status;
        data = await resp.json();
      } catch (err) {
        _log('playlist.batch_collect.xhr_fetch_error', { err: String(err?.message || err) });
        window.__ttBatchCollectActive = false;
        try { _origXHRSend.call(xhr, body); } catch (_) {} // fallback to real XHR
        return;
      }

      // Only intercept playlist continuation responses that have more batches
      const plc = data?.continuationContents?.playlistVideoListContinuation;
      if (plc && Array.isArray(plc.contents) && plc.continuations) {
        let collected;
        try {
          collected = await _collectAll(url, plc, reqBody.context);
        } catch (err) {
          _log('playlist.batch_collect.collect_error', { err: String(err?.message || err) });
        }
        if (collected) {
          plc.contents      = collected.allContents;
          plc.continuations = collected.continuations;
        }
      } else {
        _log('playlist.batch_collect.xhr_no_plc', {
          hasPlc: !!plc,
          hasContinuations: !!(plc?.continuations),
        });
      }

      window.__ttBatchCollectActive = false;

      _deliverXHRResponse(xhr, JSON.stringify(data), rawStatus);
    })();
    // Do NOT call _origXHRSend — we handle delivery ourselves
  };

  _log('playlist.batch_collect.xhr_installed', {});
}

// ── Fetch override ────────────────────────────────────────────────────────────

if (_nativeFetch) {
  window.fetch = async function playlistBatchCollectFetch(url, options) {
    if (!_isBrowseUrl(url)) return _nativeFetch(url, options);

    const reqBody = _parseBody(options);
    if (!reqBody?.continuation || !reqBody?.context) return _nativeFetch(url, options);

    if (!configRead('enablePlaylistBatchCollect')) return _nativeFetch(url, options);

    if (window.__ttBatchCollectActive) return _nativeFetch(url, options);

    let response;
    try { response = await _nativeFetch(url, options); }
    catch (err) { throw err; }

    let data;
    try { data = await response.clone().json(); }
    catch (_) { return response; }

    const plc = data?.continuationContents?.playlistVideoListContinuation;
    if (!plc || !Array.isArray(plc.contents) || !plc.continuations) return response;

    window.__ttBatchCollectActive = true;

    let collected;
    try { collected = await _collectAll(url, plc, reqBody.context); }
    catch (err) {
      _log('playlist.batch_collect.error', { err: String(err?.message || err) });
      window.__ttBatchCollectActive = false;
      return response;
    }

    window.__ttBatchCollectActive = false;

    if (!collected) return response;

    plc.contents      = collected.allContents;
    plc.continuations = collected.continuations;

    try { return _makeResponse(data, response); }
    catch (_) { return response; }
  };

  _log('playlist.batch_collect.fetch_installed', {});
}
