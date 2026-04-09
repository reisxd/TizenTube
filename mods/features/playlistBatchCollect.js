/**
 * playlistBatchCollect.js
 *
 * Intercepts YouTube TV playlist continuation fetch requests.
 * When a playlist continuation arrives, immediately fetches ALL remaining
 * batches in sequence and combines them into a single response before
 * returning it to YouTube TV.
 *
 * The existing JSON.parse filter then processes all items at once, so the
 * virtual list only sees unwatched videos — no empty spaces, no helper tile
 * cycling, and no repeated scroll-to-bottom triggers.
 *
 * Only active when enablePlaylistBatchCollect is true (default: true).
 * Falls back gracefully on any error: if a sub-request fails or the
 * Response constructor is unavailable, the original single-batch response
 * is returned unchanged.
 *
 * Transport note: this patches window.fetch. If YouTube TV uses
 * XMLHttpRequest instead, the patch is a no-op for those requests (the
 * JSON.parse filter still runs, just on one batch at a time as before).
 */

import { appendFileOnlyLog } from './hideWatched.js';
import { configRead } from '../config.js';

function _log(label, payload) {
  try { appendFileOnlyLog(label, payload); } catch (_) {}
}

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

// ── Synthesize a Response from a mutated data object ─────────────────────────

function _makeResponse(data, originalResponse) {
  const headers = new Headers();
  try {
    originalResponse.headers.forEach((v, k) => {
      // Strip encoding/length headers — we return plain uncompressed JSON
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

async function _collectAll(origFetch, url, options, plc) {
  const MAX = Math.max(1, Math.min(500, Number(configRead('playlistBatchCollectMaxBatches') || 50)));
  const context = _parseBody(options)?.context;
  if (!context) return null; // Can't reconstruct sub-requests without context

  const allContents = Array.isArray(plc.contents) ? [...plc.contents] : [];
  let continuations = plc.continuations;
  let batchesLoaded = 1;
  const nativeAbort = typeof AbortController !== 'undefined';
  const abort = _makeAbort();

  const onNav = () => abort.abort();
  window.addEventListener('hashchange', onNav, { once: true });
  window.addEventListener('popstate', onNav, { once: true });

  _showProgress(`Playlist: loading batch ${batchesLoaded}…`);

  try {
    while (continuations && batchesLoaded < MAX && !abort.signal.aborted) {
      const token = _getToken(continuations);
      if (!token) break;

      const fetchOpts = {
        ...options,
        body: JSON.stringify({ context, continuation: token }),
      };
      if (nativeAbort) fetchOpts.signal = abort.signal;

      let nextData;
      try {
        const nextResp = await origFetch(url, fetchOpts);
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
    window.removeEventListener('popstate', onNav);
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

// ── Fetch override ────────────────────────────────────────────────────────────

if (typeof window.fetch === 'function') {
  const _origFetch = window.fetch.bind(window);

  window.fetch = async function playlistBatchCollectFetch(url, options) {
    // Fast path: only care about YouTube InnerTube browse API
    if (!_isBrowseUrl(url)) return _origFetch(url, options);

    // Must be a continuation request (body has continuation + context)
    const reqBody = _parseBody(options);
    if (!reqBody?.continuation || !reqBody?.context) return _origFetch(url, options);

    // Feature flag
    if (!configRead('enablePlaylistBatchCollect')) return _origFetch(url, options);

    // Make the original request first
    let response;
    try { response = await _origFetch(url, options); }
    catch (err) { throw err; }

    // Read the response — clone so `response` is still usable as fallback
    let data;
    try { data = await response.clone().json(); }
    catch (_) { return response; }

    // Only intercept playlist continuation responses that have more batches
    const plc = data?.continuationContents?.playlistVideoListContinuation;
    if (!plc || !Array.isArray(plc.contents) || !plc.continuations) {
      return response; // Not a playlist continuation, or already the last batch
    }

    // Collect all remaining batches
    let collected;
    try { collected = await _collectAll(_origFetch, url, options, plc); }
    catch (err) {
      _log('playlist.batch_collect.error', { err: String(err?.message || err) });
      return response; // Fallback: return original single-batch response
    }
    if (!collected) return response;

    // Mutate the response data in-place
    plc.contents = collected.allContents;
    // null = all batches loaded (JSON.parse will see hasContinuation=false → clear helpers)
    // set  = hit MAX_BATCHES limit, normal continuation flow takes over for the rest
    plc.continuations = collected.continuations;

    try { return _makeResponse(data, response); }
    catch (_) { return response; } // Fallback if Response constructor fails (very old WebKit)
  };

  _log('playlist.batch_collect.installed', {});
}
