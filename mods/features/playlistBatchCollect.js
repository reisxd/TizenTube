/**
 * playlistBatchCollect.js
 *
 * Strategy: let real XHR through immediately (no suppression, no timeout risk),
 * then collect all remaining batches in the background and store the result in
 * window.__ttPrefetchedBatch.  When adblock.js JSON.parse sees the next
 * playlist continuation response it injects the prefetched contents directly
 * into the parsed object — no XHR delivery, no re-parsing of large JSON strings.
 *
 * Flow:
 *   1. send() detects a playlist continuation XHR.
 *   2. Calls _origXHRSend immediately so YouTube TV gets a real response in ~200ms
 *      and never hits its ~800ms timeout / page-reset.
 *   3. Starts _collectAll() in the background (guarded by window.__ttPrefetchStarted
 *      so only one collection runs at a time).
 *   4. Sub-requests from _collectAll use the native XHR path:
 *      send() checks __ttPrefetchStarted and calls _origXHRSend directly.
 *   5. When _collectAll finishes it sets window.__ttPrefetchedBatch.
 *   6. adblock.js processResponsePayload() checks __ttPrefetchedBatch before
 *      calling filterContinuationItems and injects the full item list.
 *
 * Transport note: Tizen 5.0/5.5 uses XMLHttpRequest only.  The fetch override
 * covers desktop browser dev/testing and uses the same background-collect pattern.
 *
 * Only active when enablePlaylistBatchCollect is true (default: true).
 * Falls back gracefully on any error.
 */

import { appendFileOnlyLog } from './hideWatched.js';
import { configRead } from '../config.js';

function _log(label, payload) {
  try { appendFileOnlyLog(label, payload); } catch (_) {}
}

// ── Save native implementations before any patching ──────────────────────────

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

// ── Background collect launcher ───────────────────────────────────────────────
//
// Starts _collectAll only if not already running.  Stores the result in
// window.__ttPrefetchedBatch for adblock.js to consume in the next JSON.parse.
// Sets window.__ttPrefetchStarted before any await so send() knows to let
// all subsequent XHRs (including _collectAll sub-requests) through unchanged.

async function _startBackgroundCollect(url, plc, context) {
  if (window.__ttPrefetchStarted) return;
  // If prefetch data is already ready, don't overwrite it — adblock.js will consume it.
  if (window.__ttPrefetchedBatch) return;
  window.__ttPrefetchStarted = true;
  // Do NOT null __ttPrefetchedBatch here. adblock.js clears it at injection time.
  // Nulling it here creates a race: real XHR may complete before the seed fetch returns,
  // and JSON.parse would find null instead of the ready prefetch.

  let collected = null;
  try {
    collected = await _collectAll(url, plc, context);
  } catch (err) {
    _log('playlist.batch_collect.collect_error', { err: String(err?.message || err) });
  }

  window.__ttPrefetchStarted = false;

  if (!collected) return;

  window.__ttPrefetchedBatch = {
    allContents:   collected.allContents,
    continuations: collected.continuations,
  };
  _log('playlist.batch_collect.prefetch_ready', {
    items: collected.allContents.length,
    hasMore: !!collected.continuations,
  });
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

    // If background collect is running, let all XHRs through unchanged.
    // This covers both _collectAll sub-requests and YouTube TV's own
    // continuation retries fired while the collect is in progress.
    if (window.__ttPrefetchStarted) return _origXHRSend.apply(this, arguments);

    // Must be a continuation request
    const reqBody = _parseBody({ body });
    if (!reqBody?.continuation || !reqBody?.context) return _origXHRSend.apply(this, arguments);

    // Feature flag
    if (!configRead('enablePlaylistBatchCollect')) return _origXHRSend.apply(this, arguments);

    // Prefetch data already ready — let real XHR through; JSON.parse injection
    // in adblock.js will consume __ttPrefetchedBatch on the next response.
    // Do NOT start another seed fetch: that would race the real XHR and risk
    // overwriting (via _startBackgroundCollect) the prefetch before injection fires.
    if (window.__ttPrefetchedBatch) return _origXHRSend.apply(this, arguments);

    // Let the real XHR through immediately so YouTube TV gets its response
    // within ~200ms and never hits the ~800ms timeout / page-reset.
    _origXHRSend.apply(this, arguments);

    // Kick off background collection without awaiting it.
    // _nativeFetch is the whatwg-fetch polyfill; its internal XHRs will hit
    // send() again but __ttPrefetchStarted will be true by then, so they
    // fall through to _origXHRSend above without re-entering this branch.
    //
    // We need the first-batch plc to seed _collectAll.  We fetch it via
    // _nativeFetch here; when the real XHR above also returns we don't care
    // — adblock.js will handle that response normally (15 items for the first
    // batch) and will inject __ttPrefetchedBatch when the collect finishes.
    ;(async () => {
      let firstData;
      try {
        const headers = Object.assign(
          { 'content-type': 'application/json' },
          this.__ttReqHeaders || {}
        );
        const resp = await _nativeFetch(url, {
          method: this.__ttMethod || 'POST',
          headers,
          body,
          credentials: 'include',
          mode: 'cors',
        });
        firstData = await resp.json();
      } catch (err) {
        _log('playlist.batch_collect.seed_error', { err: String(err?.message || err) });
        return;
      }

      const plc = firstData?.continuationContents?.playlistVideoListContinuation;
      if (!plc || !Array.isArray(plc.contents) || !plc.continuations) {
        _log('playlist.batch_collect.xhr_no_plc', {
          hasPlc: !!plc,
          hasContinuations: !!(plc?.continuations),
        });
        return;
      }

      // _startBackgroundCollect sets __ttPrefetchStarted synchronously before
      // the first await, so subsequent send() calls will bypass this block.
      _startBackgroundCollect(url, plc, reqBody.context);
    })();
  };

  _log('playlist.batch_collect.xhr_installed', {});
}

// ── Fetch override ────────────────────────────────────────────────────────────

if (_nativeFetch) {
  window.fetch = async function playlistBatchCollectFetch(url, options) {
    if (!_isBrowseUrl(url)) return _nativeFetch(url, options);
    if (window.__ttPrefetchStarted)  return _nativeFetch(url, options);

    const reqBody = _parseBody(options);
    if (!reqBody?.continuation || !reqBody?.context) return _nativeFetch(url, options);

    if (!configRead('enablePlaylistBatchCollect')) return _nativeFetch(url, options);

    // Let the real fetch through immediately.
    const response = await _nativeFetch(url, options);

    let data;
    try { data = await response.clone().json(); }
    catch (_) { return response; }

    const plc = data?.continuationContents?.playlistVideoListContinuation;
    if (!plc || !Array.isArray(plc.contents) || !plc.continuations) return response;

    // Start background collect; result lands in window.__ttPrefetchedBatch.
    _startBackgroundCollect(url, plc, reqBody.context);

    return response;
  };

  _log('playlist.batch_collect.fetch_installed', {});
}
