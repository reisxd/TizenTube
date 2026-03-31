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

// ── Find the scrollable container of the playlist virtual list ────────────────
// On YouTube TV, the playlist uses a yt-virtual-list inside ytlr-playlist-video-list-renderer.
// The yt-virtual-list element itself is the scrollable container — its scrollTop controls
// which virtual rows are in view, and the virtual list responds to scroll events on itself.
// We do NOT need focus to be inside the list; setting scrollTop directly works regardless.



// ── PLAYLIST_LOAD_ALL action ──────────────────────────────────────────────────
// Repeatedly scrolls the playlist virtual list to its bottom.
// When __ttCurrentPlaylistItems grows (new batch arrived via JSON.parse), scrolls again.
// Stops when no new items arrive after a timeout or max iterations are hit.

export function playlistScrollBottom(showToastFn) {
  if (window.__ttLoadAllRunning) {
    _log('playlist.loadall.already_running', {});
    showToastFn('TizenTube', 'Load All is already running…');
    return;
  }

  window.__ttLoadAllRunning = true;
  const startFetchCount = window.__ttPlaylistRawFetchCount || 0;
  let lastFetchCount = startFetchCount;
  let noGrowthTicks = 0;
  let totalTicks = 0;
  const startItemCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;

  // On YouTube TV the batch load trigger is the virtual list detecting that the last
  // rendered tile has focus, NOT a scroll event. scrollBy/scrollTo on the container
  // does nothing because ytlr-playlist-video-list-renderer has no CSS overflow scroll.
  // The only reliable approach: find the last rendered playlist tile, focus it,
  // then send ArrowDown to it so the virtual list advances focus and loads more.
  const MAX_NO_GROWTH = 15; // × TICK_MS before giving up
  const MAX_TICKS = 120;
  const TICK_MS = 2000;

  _log('playlist.loadall.start', { startItemCount, startFetchCount });
  showToastFn('TizenTube', 'Loading all batches…');

  function getLastTile() {
    const plRoot = document.querySelector('ytlr-playlist-video-list-renderer');
    if (!plRoot) return null;
    const tiles = plRoot.querySelectorAll('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer');
    return tiles.length ? tiles[tiles.length - 1] : null;
  }

  function nudgeDown() {
    const lastTile = getLastTile();
    const target = lastTile || document.querySelector('ytlr-playlist-video-list-renderer') || document.body;
    _log('playlist.loadall.nudge', { tag: target.tagName, tick: totalTicks });

    // Focus the last tile so the virtual list knows where we are
    try {
      if (lastTile && typeof lastTile.focus === 'function') lastTile.focus({ preventScroll: true });
    } catch (_) {}

    // Dispatch ArrowDown on the focused target — this is what the remote does
    try {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
      target.dispatchEvent(new KeyboardEvent('keyup',   { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
    } catch (_) {}

    // Also try on the playlist renderer and document as fallback
    try {
      const pl = document.querySelector('ytlr-playlist-video-list-renderer');
      if (pl && pl !== target) {
        pl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
      }
    } catch (_) {}

    totalTicks++;
  }

  const tick = () => {
    if (!window.__ttLoadAllRunning) return;
    if (totalTicks >= MAX_TICKS) { stop('max_ticks'); return; }

    const currentFetchCount = window.__ttPlaylistRawFetchCount || 0;
    if (currentFetchCount > lastFetchCount) {
      noGrowthTicks = 0;
      lastFetchCount = currentFetchCount;
      const currentItemCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;
      _log('playlist.loadall.batch', { currentFetchCount, currentItemCount, totalTicks });
    } else {
      noGrowthTicks++;
    }

    if (noGrowthTicks >= MAX_NO_GROWTH) { stop('no_growth'); return; }

    nudgeDown();
    setTimeout(tick, TICK_MS);
  };

  function stop(reason) {
    window.__ttLoadAllRunning = false;
    const finalItemCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;
    const totalFetched = (window.__ttPlaylistRawFetchCount || 0) - startFetchCount;
    _log('playlist.loadall.done', { reason, startItemCount, finalItemCount, totalBatchesFetched: totalFetched, totalTicks });
    showToastFn('TizenTube', `Done. ${finalItemCount} unwatched, ${totalFetched} batch(es) loaded.`);
  }

  nudgeDown();
  setTimeout(tick, TICK_MS);
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