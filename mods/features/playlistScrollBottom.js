import { appendFileOnlyLog, getPlaylistButtons, injectPlaylistButton } from './hideWatched.js';

function _log(label, payload) {
  appendFileOnlyLog(label, payload);
}

// ── PLAYLIST_LOAD_ALL action ──────────────────────────────────────────────────
// Strategy: the YouTube TV playlist virtual list only loads the next batch when it
// detects that focus has reached the LAST currently-rendered tile. A single ArrowDown
// per 2s is far too slow — it just walks focus down one item at a time through a batch
// of ~20, taking ~40s per batch, and leaks focus outside the playlist on navigation.
//
// Instead we use a BURST approach:
//   1. Fire FIRST_BURST_COUNT ArrowDown events on the first burst (focus starts at the
//      header button on TV — needs enough events to traverse header + all tiles).
//   2. Fire BURST_COUNT ArrowDown events BURST_MS apart on subsequent bursts
//      (focus is already near the bottom after each batch load).
//   3. After the burst, poll every POLL_MS for a new batch fetch (max BATCH_WAIT_MS).
//   4. If a batch arrived → repeat from step 2.
//   5. If no batch after timeout → all loaded, stop.
//
// Navigation guard: hashchange/popstate stop the runner immediately so the user can
// safely leave the playlist without ArrowDown events bleeding into the next page.

export function playlistScrollBottom(showToastFn) {
  if (window.__ttLoadAllRunning) {
    _log('playlist.loadall.already_running', {});
    showToastFn('TizenTube', 'Load All is already running…');
    return;
  }

  window.__ttLoadAllRunning = true;
  const startFetchCount = window.__ttPlaylistRawFetchCount || 0;
  let lastFetchCount = startFetchCount;
  let burstCount = 0;
  const startItemCount = Array.isArray(window.__ttCurrentPlaylistItems)
    ? window.__ttCurrentPlaylistItems.length : 0;

  // Tuning
  // FIRST_BURST_COUNT: on TV the button lives in the playlist header, so the first burst
  // must traverse the entire header area PLUS all rendered tiles (~15) to reach the boundary.
  // 30 events is a safe upper bound: header area (~5) + up to 25 tiles.
  // BURST_COUNT: after each batch load, focus is already near the bottom — 8 events suffice.
  const FIRST_BURST_COUNT = 30;  // first burst: header → bottom of first batch
  const BURST_COUNT        = 8;  // subsequent bursts: already near bottom
  const BURST_MS           = 80; // comfortable spacing, avoids TV rate limiter
  const BATCH_WAIT_MS      = 6000; // max ms to wait for a new batch after a burst (TV fetch is slow)
  const POLL_MS            = 150;  // how often to check if a new batch arrived

  _log('playlist.loadall.start', { startItemCount, startFetchCount });
  showToastFn('TizenTube', 'Loading all batches…');

  // ── Navigation guard ─────────────────────────────────────────────────────────
  function onNavigate() {
    if (window.__ttLoadAllRunning) stop('navigation');
  }
  window.addEventListener('hashchange', onNavigate, { once: true });
  window.addEventListener('popstate',   onNavigate, { once: true });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function fireArrowDown() {
    // Dispatch on document — this is how the physical remote works on YouTube TV.
    // The TV's focus management system listens on document and routes to the focused element.
    // Dispatching on a specific tile only works if that tile is already focused; dispatching
    // on document works regardless of where focus currently is (e.g. on a header button).
    const opts = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true };
    try { document.dispatchEvent(new KeyboardEvent('keydown', opts)); } catch (_) {}
    try { document.dispatchEvent(new KeyboardEvent('keyup',   opts)); } catch (_) {}
  }

  // ── Core loop ────────────────────────────────────────────────────────────────
  function doBurst() {
    if (!window.__ttLoadAllRunning) return;

    // Check the playlist is still in the DOM — user may have navigated
    if (!document.querySelector('ytlr-playlist-video-list-renderer')) {
      stop('no_playlist_dom');
      return;
    }

    const count = burstCount === 0 ? FIRST_BURST_COUNT : BURST_COUNT;
    _log('playlist.loadall.burst', { burst: burstCount, count, lastFetchCount });
    burstCount++;

    // DO NOT call lastTile.focus() — doing so moves DOM focus to the tile but bypasses
    // the virtual list's internal focus manager. The virtual list then loses track of
    // its item index and never triggers the next batch load (hang before last batch).
    // The grey focus border visible on other pages is also caused by this stray focus call.
    // Dispatching ArrowDown on document is sufficient — the TV's focus system routes it
    // through the virtual list's own manager which correctly advances the item pointer.

    // Fire `count` ArrowDowns on document spaced BURST_MS apart.
    // document dispatch matches how the physical remote fires events.
    let i = 0;
    const burstInterval = setInterval(() => {
      if (!window.__ttLoadAllRunning) { clearInterval(burstInterval); return; }
      fireArrowDown();
      i++;
      if (i >= count) {
        clearInterval(burstInterval);
        // After the burst, poll for a new batch
        waitForBatch();
      }
    }, BURST_MS);
  }

  function waitForBatch() {
    if (!window.__ttLoadAllRunning) return;
    const deadline = Date.now() + BATCH_WAIT_MS;
    const poll = setInterval(() => {
      if (!window.__ttLoadAllRunning) { clearInterval(poll); return; }

      const currentFetchCount = window.__ttPlaylistRawFetchCount || 0;
      if (currentFetchCount > lastFetchCount) {
        clearInterval(poll);
        lastFetchCount = currentFetchCount;
        const currentItemCount = Array.isArray(window.__ttCurrentPlaylistItems)
          ? window.__ttCurrentPlaylistItems.length : 0;
        _log('playlist.loadall.batch', { fetchCount: currentFetchCount, currentItemCount, burst: burstCount });
        // Small delay to let the DOM update with the new tiles, then burst again
        setTimeout(doBurst, 500);
      } else if (Date.now() >= deadline) {
        clearInterval(poll);
        stop('no_new_batch');
      }
    }, POLL_MS);
  }

  function stop(reason) {
    window.__ttLoadAllRunning = false;
    window.removeEventListener('hashchange', onNavigate);
    window.removeEventListener('popstate',   onNavigate);
    // Blur whatever element the burst left focus on, so the grey CSS focus ring doesn't
    // persist when the user navigates back to the playlists page.
    try {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    } catch (_) {}
    const finalItemCount = Array.isArray(window.__ttCurrentPlaylistItems)
      ? window.__ttCurrentPlaylistItems.length : 0;
    const totalFetched = (window.__ttPlaylistRawFetchCount || 0) - startFetchCount;
    _log('playlist.loadall.done', { reason, startItemCount, finalItemCount, totalBatchesFetched: totalFetched, bursts: burstCount });
    if (reason !== 'navigation') {
      showToastFn('TizenTube', `Done. ${finalItemCount} unwatched, ${totalFetched} batch(es) loaded.`);
    }
  }

  doBurst();
}

// ── JSON.parse patch ──────────────────────────────────────────────────────────

const _origParse = JSON.parse;
JSON.parse = function () {
  const r = _origParse.apply(this, arguments);
  try {
    const hasPlaylist = !!(r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer);
    if (hasPlaylist) {
      const buttons = getPlaylistButtons(r);
      if (buttons) {
        const injected = injectPlaylistButton(buttons, 'PLAYLIST_SCROLL_BOTTOM', 'Load All', 'ARROW_DOWNWARD');
        if (injected) _log('playlist.loadall.injected', { totalButtons: buttons.length });
      }
    }
    // Count raw continuation items (pre-filter) so Load All can detect batch arrivals
    // regardless of how many items survived adblock filtering.
    const plc = r?.continuationContents?.playlistVideoListContinuation;
    if (plc) {
      window.__ttPlaylistRawFetchCount = (window.__ttPlaylistRawFetchCount || 0) + 1;
    }
  } catch (_) {}
  return r;
};

window.JSON.parse = JSON.parse;
