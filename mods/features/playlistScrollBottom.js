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

function findScrollContainers() {
  // Mirrors attemptPlaylistAutoLoad in adblock.js exactly:
  // Primary: ytlr-playlist-video-list-renderer scrolled by 900px — this is what triggers
  //          YouTube TV to render more virtual rows and fire continuation requests.
  // Secondary: yt-virtual-list scrolled by 1400px — used for empty_batch recovery.
  const primary = document.querySelector('ytlr-playlist-video-list-renderer, ytlr-surface-page, body')
    || document.body;
  const vlist = document.querySelector('ytlr-playlist-video-list-renderer yt-virtual-list, yt-virtual-list.rN5BTd');
  return { primary, vlist };
}

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
  // Track raw fetch count (incremented per continuation response, regardless of filtering)
  const startFetchCount = window.__ttPlaylistRawFetchCount || 0;
  let lastFetchCount = startFetchCount;
  let noGrowthTicks = 0;
  let totalScrolls = 0;
  const startItemCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;

  // 2 seconds between scroll attempts — Tizen needs time for network responses
  // Use same 1400px increment as attemptPlaylistAutoLoad in adblock.js (proven to work)
  const MAX_NO_GROWTH = 15;  // 15 × 2s = 30s max wait for a new batch
  const MAX_SCROLLS = 100;
  const TICK_MS = 2000;

  _log('playlist.loadall.start', { startItemCount, startFetchCount });
  showToastFn('TizenTube', 'Loading all batches…');

  const containers = findScrollContainers();
  _log('playlist.loadall.containers', { primary: containers.primary?.tagName || 'none', vlist: containers.vlist?.tagName || 'none' });

  function scrollAll() {
    // Replicate attemptPlaylistAutoLoad exactly — 900px on the playlist container,
    // plus 1400px on the virtual list (empty_batch mode), plus PageDown dispatch.
    try {
      if (typeof containers.primary.scrollBy === 'function') {
        containers.primary.scrollBy({ top: 900, left: 0, behavior: 'auto' });
      }
    } catch (_) {}
    try {
      if (containers.vlist && typeof containers.vlist.scrollBy === 'function') {
        containers.vlist.scrollBy({ top: 1400, left: 0, behavior: 'auto' });
      }
    } catch (_) {}
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup',  { key: 'PageDown', code: 'PageDown', bubbles: true }));
    } catch (_) {}
    totalScrolls++;
  }

  const tick = () => {
    if (!window.__ttLoadAllRunning) return;
    if (totalScrolls >= MAX_SCROLLS) { stop('max_scrolls'); return; }

    const currentFetchCount = window.__ttPlaylistRawFetchCount || 0;
    if (currentFetchCount > lastFetchCount) {
      // A new batch arrived (even if all its items were filtered as watched)
      noGrowthTicks = 0;
      lastFetchCount = currentFetchCount;
      const currentItemCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;
      _log('playlist.loadall.batch', { currentFetchCount, currentItemCount, totalScrolls });
    } else {
      noGrowthTicks++;
    }

    if (noGrowthTicks >= MAX_NO_GROWTH) { stop('no_growth'); return; }

    scrollAll();
    setTimeout(tick, TICK_MS);
  };

  function stop(reason) {
    window.__ttLoadAllRunning = false;
    const finalItemCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;
    const totalFetched = (window.__ttPlaylistRawFetchCount || 0) - startFetchCount;
    _log('playlist.loadall.done', { reason, startItemCount, finalItemCount, startFetchCount, totalBatchesFetched: totalFetched, totalScrolls });
    showToastFn('TizenTube', `Done. ${finalItemCount} unwatched videos found (${totalFetched} batches loaded).`);
  }

  scrollAll();
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