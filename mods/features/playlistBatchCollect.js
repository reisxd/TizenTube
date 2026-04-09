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
 * XHR delivery: synthetic responses are delivered via Object.defineProperty
 * (to shadow read-only properties) + dispatchEvent (readystatechange/load).
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

// ── Deliver synthetic response to an XHR object ───────────────────────────────

function _deliverXHRResponse(xhr, bodyStr, status) {
  try {
    // Shadow read-only XHR properties with own configurable properties
    const def = (prop, val) => {
      try {
        Object.defineProperty(xhr, prop, { value: val, configurable: true, writable: true });
      } catch (_) {
        try { xhr[prop] = val; } catch (_2) {}
      }
    };

    def('status',       status || 200);
    def('statusText',   'OK');
    def('responseText', bodyStr);
    def('response',     bodyStr);

    // Fire readystatechange for states 1 (open), 2 (headers), 3 (loading), 4 (done)
    // YouTube TV typically only cares about state 4, but fire them all for safety.
    for (const state of [1, 2, 3, 4]) {
      def('readyState', state);
      try { xhr.dispatchEvent(new Event('readystatechange')); } catch (_) {}
      if (state === 4) {
        if (typeof xhr.onreadystatechange === 'function') {
          try { xhr.onreadystatechange(); } catch (_) {}
        }
      }
    }

    // Fire load / loadend
    try { xhr.dispatchEvent(new Event('load')); } catch (_) {}
    try { xhr.dispatchEvent(new Event('loadend')); } catch (_) {}
    if (typeof xhr.onload === 'function') {
      try { xhr.onload(); } catch (_) {}
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
//
// contextOverride: pass the request context object directly when the caller
// already has it (XHR path) — avoids re-parsing the body.

async function _collectAll(url, plc, contextOverride) {
  const MAX = Math.max(1, Math.min(500, Number(configRead('playlistBatchCollectMaxBatches') || 50)));

  const context = contextOverride;
  if (!context) return null; // Can't reconstruct sub-requests without context

  if (!_nativeFetch) return null; // No native fetch available

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
  const _origXHROpen        = XMLHttpRequest.prototype.open;
  const _origXHRSetHeader   = XMLHttpRequest.prototype.setRequestHeader;
  const _origXHRSend        = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ttUrl    = url;
    this.__ttMethod = method;
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
    if (!_isBrowseUrl(url)) {
      return _origXHRSend.apply(this, arguments);
    }

    // Must be a continuation request
    const reqBody = _parseBody({ body });
    if (!reqBody?.continuation || !reqBody?.context) {
      return _origXHRSend.apply(this, arguments);
    }

    // Feature flag
    if (!configRead('enablePlaylistBatchCollect')) {
      return _origXHRSend.apply(this, arguments);
    }

    // Async interception — do NOT call _origXHRSend
    const xhr     = this;
    const method  = xhr.__ttMethod || 'POST';
    const headers = Object.assign(
      { 'content-type': 'application/json' },
      xhr.__ttReqHeaders || {}
    );

    window.__ttBatchCollectActive = true;

    ;(async () => {
      let data;
      let rawStatus = 200;

      try {
        const resp = await _nativeFetch(url, {
          method,
          headers,
          body,
          credentials: 'include',
          mode: 'cors',
        });
        rawStatus = resp.status;
        data = await resp.json();
      } catch (err) {
        _log('playlist.batch_collect.xhr_fetch_error', { err: String(err?.message || err) });
        window.__ttBatchCollectActive = false;
        // Fall back to real XHR
        try { _origXHRSend.call(xhr, body); } catch (_) {}
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
          plc.contents     = collected.allContents;
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
  };

  _log('playlist.batch_collect.xhr_installed', {});
}

// ── Fetch override ────────────────────────────────────────────────────────────

if (_nativeFetch) {
  window.fetch = async function playlistBatchCollectFetch(url, options) {
    // Fast path: only care about YouTube InnerTube browse API
    if (!_isBrowseUrl(url)) return _nativeFetch(url, options);

    // Must be a continuation request
    const reqBody = _parseBody(options);
    if (!reqBody?.continuation || !reqBody?.context) return _nativeFetch(url, options);

    // Feature flag
    if (!configRead('enablePlaylistBatchCollect')) return _nativeFetch(url, options);

    // Make the original request first
    let response;
    try { response = await _nativeFetch(url, options); }
    catch (err) { throw err; }

    // Read the response — clone so `response` is still usable as fallback
    let data;
    try { data = await response.clone().json(); }
    catch (_) { return response; }

    // Only intercept playlist continuation responses that have more batches
    const plc = data?.continuationContents?.playlistVideoListContinuation;
    if (!plc || !Array.isArray(plc.contents) || !plc.continuations) {
      return response;
    }

    window.__ttBatchCollectActive = true;

    // Collect all remaining batches
    let collected;
    try { collected = await _collectAll(url, plc, reqBody.context); }
    catch (err) {
      _log('playlist.batch_collect.error', { err: String(err?.message || err) });
      window.__ttBatchCollectActive = false;
      return response;
    }

    window.__ttBatchCollectActive = false;

    if (!collected) return response;

    // Mutate the response data in-place
    plc.contents      = collected.allContents;
    plc.continuations = collected.continuations;

    try { return _makeResponse(data, response); }
    catch (_) { return response; }
  };

  _log('playlist.batch_collect.fetch_installed', {});
}
