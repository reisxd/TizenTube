/**
 * playlistBatchCollect.js
 *
 * Strategy: let real XHR through immediately, collect all remaining batches
 * in the background, store in window.__ttPrefetchedBatch.  adblock.js injects
 * the result into the next playlist continuation JSON.parse — no XHR delivery,
 * no 614KB re-parse.
 *
 * Recursive-XHR problem and solution
 * ────────────────────────────────────
 * _nativeFetch is the whatwg-fetch polyfill, which creates a real XMLHttpRequest
 * internally and calls xhr.send().  Our patched send() would normally intercept
 * that and start yet another seed fetch, causing an exponential chain.
 *
 * Fix: set window.__ttPrefetchStarted = true SYNCHRONOUSLY (before any await)
 * so that when the polyfill's internal XHR hits the patched send(), it sees the
 * flag and falls straight through to _origXHRSend without starting another seed.
 *
 * Filtered-data problem and solution
 * ────────────────────────────────────
 * The polyfill's response.json() calls JSON.parse, which adblock.js has patched
 * to filter out watched items.  _collectAll would therefore collect only keep-one
 * items per batch instead of raw items.
 *
 * Fix: save a reference to the native JSON.parse at module-init time (before
 * adblock.js patches it) and use that in all _collectAll response parsing.
 *
 * Navigation safety
 * ──────────────────
 * _collectAll aborts on hashchange/popstate.  Before storing the result we check
 * the URL still matches; stale prefetch from another playlist is discarded.
 * Global state is also cleared on every navigation so a fresh collect starts.
 *
 * Only active when enablePlaylistBatchCollect is true (default: true).
 */

import { appendFileOnlyLog } from './hideWatched.js';
import { configRead } from '../config.js';

function _log(label, payload) {
  try { appendFileOnlyLog(label, payload); } catch (_) {}
}

// ── Save native implementations BEFORE adblock.js patches them ───────────────
// playlistBatchCollect.js is imported at the top of adblock.js, so this module
// runs first — JSON.parse and window.fetch are still native at this point.

const _nativeJSONParse = JSON.parse.bind(JSON);

const _nativeFetch = (typeof window.fetch === 'function')
  ? window.fetch.bind(window)
  : null;

// ── Navigation: clear stale state when entering a new page ───────────────────
function _clearState() {
  window.__ttPrefetchedBatch  = null;
  window.__ttPrefetchStarted  = false;
}
window.addEventListener('hashchange', _clearState);
window.addEventListener('popstate',   _clearState);

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
    return _nativeJSONParse(typeof b === 'string' ? b : new TextDecoder().decode(b));
  } catch (_) { return null; }
}

// ── Continuation token extraction ─────────────────────────────────────────────
function _getToken(continuations) {
  if (!Array.isArray(continuations)) return null;
  return continuations[0]?.nextContinuationData?.continuation
      || continuations[0]?.reloadContinuationData?.continuation
      || null;
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
// IMPORTANT: uses _nativeJSONParse (not patched JSON.parse) so watched items
// are NOT filtered out during collection — we need the raw batch data.

async function _collectAll(url, plc, context) {
  const MAX = Math.max(1, Math.min(500, Number(configRead('playlistBatchCollectMaxBatches') || 50)));

  if (!context || !_nativeFetch) return null;

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
        method:      'POST',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify({ context, continuation: token }),
        credentials: 'include',
        mode:        'cors',
      };
      if (nativeAbort) fetchOpts.signal = abort.signal;

      let nextData;
      try {
        const nextResp = await _nativeFetch(url, fetchOpts);
        // Use _nativeJSONParse — the polyfill's .json() calls the patched
        // JSON.parse which would filter out watched items, corrupting the data.
        const text = await nextResp.text();
        nextData = _nativeJSONParse(text);
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
    rawItems:  allContents.length,
    batches:   batchesLoaded,
    hasMore:   !!continuations,
    hitLimit:  batchesLoaded >= MAX,
    aborted:   abort.signal.aborted,
  });

  return { allContents, continuations, aborted: abort.signal.aborted };
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

    // If background collect is running, let ALL XHRs through unchanged.
    // This covers _collectAll sub-requests (via _nativeFetch/polyfill) AND
    // YouTube TV's own continuation retries while collect is in progress.
    if (window.__ttPrefetchStarted) return _origXHRSend.apply(this, arguments);

    // Must be a continuation request
    const reqBody = _parseBody({ body });
    if (!reqBody?.continuation || !reqBody?.context) return _origXHRSend.apply(this, arguments);

    // Feature flag
    if (!configRead('enablePlaylistBatchCollect')) return _origXHRSend.apply(this, arguments);

    // Prefetch data already ready — let real XHR through; JSON.parse injection
    // in adblock.js will consume __ttPrefetchedBatch on the next response.
    if (window.__ttPrefetchedBatch) return _origXHRSend.apply(this, arguments);

    // Let the real XHR through immediately so YouTube TV gets its response
    // within ~200ms and never hits the ~800ms timeout / page-reset.
    _origXHRSend.apply(this, arguments);

    // CRITICAL: set __ttPrefetchStarted SYNCHRONOUSLY before any await.
    // The async block below calls _nativeFetch (the whatwg-fetch polyfill).
    // That polyfill creates a new XMLHttpRequest and calls xhr.send().
    // Our patched send() would run for that internal XHR — but since we set
    // the flag HERE (sync, before the async block can yield), the polyfill's
    // XHR hits the guard above and goes straight to _origXHRSend.
    // Without this, the polyfill XHR would trigger another seed fetch,
    // causing recursive/exponential XHR chains.
    window.__ttPrefetchStarted = true;

    const startHash  = String(window.location?.hash || '');
    const seedUrl    = url;
    const seedMethod = this.__ttMethod || 'POST';
    const seedHdrs   = Object.assign({ 'content-type': 'application/json' }, this.__ttReqHeaders || {});
    const context    = reqBody.context;

    ;(async () => {
      // Fetch the seed batch to get the starting plc (continuation token + first batch).
      // Use _nativeJSONParse so the raw unfiltered data is read.
      let firstData;
      try {
        const resp = await _nativeFetch(seedUrl, {
          method:      seedMethod,
          headers:     seedHdrs,
          body,
          credentials: 'include',
          mode:        'cors',
        });
        const text = await resp.text();
        firstData = _nativeJSONParse(text);
      } catch (err) {
        _log('playlist.batch_collect.seed_error', { err: String(err?.message || err) });
        window.__ttPrefetchStarted = false;
        return;
      }

      const plc = firstData?.continuationContents?.playlistVideoListContinuation;
      if (!plc || !Array.isArray(plc.contents) || !plc.continuations) {
        _log('playlist.batch_collect.xhr_no_plc', {
          hasPlc:          !!plc,
          hasContinuations: !!(plc?.continuations),
        });
        window.__ttPrefetchStarted = false;
        return;
      }

      // __ttPrefetchStarted is already true — _collectAll sub-requests will go
      // through the _origXHRSend fast path in send().
      let collected = null;
      try {
        collected = await _collectAll(seedUrl, plc, context);
      } catch (err) {
        _log('playlist.batch_collect.collect_error', { err: String(err?.message || err) });
      }

      window.__ttPrefetchStarted = false;

      if (!collected) return;

      // Discard if the user navigated to a different page while collecting.
      if (String(window.location?.hash || '') !== startHash) {
        _log('playlist.batch_collect.stale_discard', { startHash, currentHash: String(window.location?.hash || '') });
        return;
      }

      window.__ttPrefetchedBatch = {
        allContents:   collected.allContents,
        continuations: collected.continuations,
      };
      _log('playlist.batch_collect.prefetch_ready', {
        items:   collected.allContents.length,
        hasMore: !!collected.continuations,
      });
    })();
    // Do NOT call _origXHRSend again — it was already called above.
  };

  _log('playlist.batch_collect.xhr_installed', {});
}

// ── Fetch override ────────────────────────────────────────────────────────────
// Covers desktop browser dev/testing where window.fetch is used natively.
// Uses the same background-collect pattern as the XHR path.

if (_nativeFetch) {
  window.fetch = async function playlistBatchCollectFetch(url, options) {
    if (!_isBrowseUrl(url))              return _nativeFetch(url, options);
    if (window.__ttPrefetchStarted)      return _nativeFetch(url, options);
    if (window.__ttPrefetchedBatch)      return _nativeFetch(url, options);

    const reqBody = _parseBody(options);
    if (!reqBody?.continuation || !reqBody?.context) return _nativeFetch(url, options);
    if (!configRead('enablePlaylistBatchCollect'))   return _nativeFetch(url, options);

    // Let the real fetch through immediately.
    const response = await _nativeFetch(url, options);

    let data;
    try {
      const text = await response.clone().text();
      data = _nativeJSONParse(text);
    } catch (_) { return response; }

    const plc = data?.continuationContents?.playlistVideoListContinuation;
    if (!plc || !Array.isArray(plc.contents) || !plc.continuations) return response;

    const startHash = String(window.location?.hash || '');
    window.__ttPrefetchStarted = true;

    ;(async () => {
      let collected = null;
      try {
        collected = await _collectAll(String(url), plc, reqBody.context);
      } catch (err) {
        _log('playlist.batch_collect.error', { err: String(err?.message || err) });
      }
      window.__ttPrefetchStarted = false;
      if (!collected) return;
      if (String(window.location?.hash || '') !== startHash) return;
      window.__ttPrefetchedBatch = { allContents: collected.allContents, continuations: collected.continuations };
      _log('playlist.batch_collect.prefetch_ready', { items: collected.allContents.length, hasMore: !!collected.continuations });
    })();

    return response;
  };

  _log('playlist.batch_collect.fetch_installed', {});
}
