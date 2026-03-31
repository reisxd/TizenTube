import { appendFileOnlyLog } from './hideWatched.js';

function _log(label, payload) {
  appendFileOnlyLog(label, payload);
}

// ── Button injection helpers (shared shape with playlistContinue.js) ──────────

function getButtons(r) {
  const twoCol = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer;
  if (!twoCol) return null;
  const leftCol = twoCol?.leftColumn;
  const headerA = leftCol?.playlistHeaderRenderer;
  const headerB = leftCol?.entityMetadataRenderer;
  let headerC = null;
  const slrContents = leftCol?.sectionListRenderer?.contents;
  if (Array.isArray(slrContents)) {
    for (const item of slrContents) {
      if (item?.playlistHeaderRenderer) { headerC = item.playlistHeaderRenderer; break; }
      if (item?.entityMetadataRenderer) { headerC = item.entityMetadataRenderer; break; }
    }
  }
  const header = headerA || headerB || headerC;
  if (!header) return null;
  return header.buttons || header.actionButtons || (Array.isArray(header.actions) ? header.actions : null);
}

function injectButton(buttons, actionName, label, iconType) {
  if (!Array.isArray(buttons) || !buttons.length) return false;
  if (buttons.some(b =>
    b?.buttonRenderer?.command?.customAction?.action === actionName ||
    b?.buttonRenderer?.serviceEndpoint?.customAction?.action === actionName
  )) return false;
  const existing = buttons.find(b => b?.buttonRenderer);
  if (!existing) return false;
  const btn = { buttonRenderer: JSON.parse(JSON.stringify(existing.buttonRenderer)) };
  const br = btn.buttonRenderer;
  if (br.text?.runs) br.text.runs[0].text = label;
  else if (br.text?.simpleText) br.text.simpleText = label;
  if (br.icon) br.icon.iconType = iconType;
  const cmd = { clickTrackingParams: null, customAction: { action: actionName } };
  br.command = cmd;
  br.serviceEndpoint = cmd;
  if (br.navigationEndpoint) delete br.navigationEndpoint;
  if (br.onLongPressCommand) delete br.onLongPressCommand;
  if (br.accessibilityData) br.accessibilityData = { accessibilityData: { label } };
  buttons.push(btn);
  return true;
}

// ── PLAYLIST_LOAD_ALL action ──────────────────────────────────────────────────
// Strategy: the YouTube TV playlist virtual list only loads the next batch when it
// detects that focus has reached the LAST currently-rendered tile. A single ArrowDown
// per 2s is far too slow — it just walks focus down one item at a time through a batch
// of ~20, taking ~40s per batch, and leaks focus outside the playlist on navigation.
//
// Instead we use a BURST approach:
//   1. Focus the last rendered tile.
//   2. Fire BURST_COUNT ArrowDown events BURST_MS apart (blasts through all rendered tiles).
//   3. After the burst, poll every POLL_MS for a new batch fetch (max BATCH_WAIT_MS).
//   4. If a batch arrived → repeat from step 1.
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

  // Tuning — adjust if the TV is too slow to render tiles between bursts
  const BURST_COUNT   = 30;   // ArrowDowns per burst (covers a full batch of ~20 tiles)
  const BURST_MS      = 80;   // ms between each ArrowDown in the burst
  const BATCH_WAIT_MS = 5000; // max ms to wait for a new batch after a burst
  const POLL_MS       = 200;  // how often to check if a new batch arrived

  _log('playlist.loadall.start', { startItemCount, startFetchCount });
  showToastFn('TizenTube', 'Loading all batches…');

  // ── Navigation guard ─────────────────────────────────────────────────────────
  function onNavigate() {
    if (window.__ttLoadAllRunning) stop('navigation');
  }
  window.addEventListener('hashchange', onNavigate, { once: true });
  window.addEventListener('popstate',   onNavigate, { once: true });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function getLastTile() {
    const plRoot = document.querySelector('ytlr-playlist-video-list-renderer');
    if (!plRoot) return null;
    const tiles = plRoot.querySelectorAll('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer');
    return tiles.length ? tiles[tiles.length - 1] : null;
  }

  function fireArrowDown(target) {
    const opts = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true };
    try { target.dispatchEvent(new KeyboardEvent('keydown', opts)); } catch (_) {}
    try { target.dispatchEvent(new KeyboardEvent('keyup',   opts)); } catch (_) {}
  }

  // ── Core loop ────────────────────────────────────────────────────────────────
  function doBurst() {
    if (!window.__ttLoadAllRunning) return;

    // Check the playlist is still in the DOM — user may have navigated
    if (!document.querySelector('ytlr-playlist-video-list-renderer')) {
      stop('no_playlist_dom');
      return;
    }

    const lastTile = getLastTile();
    const target = lastTile
      || document.querySelector('ytlr-playlist-video-list-renderer')
      || document.body;

    // Focus the last rendered tile so the virtual list knows position
    try {
      if (lastTile && typeof lastTile.focus === 'function') lastTile.focus({ preventScroll: true });
    } catch (_) {}

    _log('playlist.loadall.burst', { burst: burstCount, tag: target.tagName, lastFetchCount });
    burstCount++;

    // Fire BURST_COUNT ArrowDowns spaced BURST_MS apart
    let i = 0;
    const burstInterval = setInterval(() => {
      if (!window.__ttLoadAllRunning) { clearInterval(burstInterval); return; }
      fireArrowDown(target);
      i++;
      if (i >= BURST_COUNT) {
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
      const buttons = getButtons(r);
      if (buttons) {
        const injected = injectButton(buttons, 'PLAYLIST_SCROLL_BOTTOM', 'Load All', 'ARROW_DOWNWARD');
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