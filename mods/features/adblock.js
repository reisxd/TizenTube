import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer, showToast } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';
import './logServer.js';
import './playlistBatchCollect.js';
import {
  appendFileOnlyLog,
  detectAndStorePage,
  detectPageFromResponse,
  detectCurrentPage,
  hideVideo,
  processTileArraysDeep,
  consolidateShelves,
  clearCarryover,
  normalizeHorizontalListRenderer,
  normalizeGridRenderer,
  getItemVideoId,
  collectWatchProgressEntries,
  updateProgressCache,
  updateHelperHideStyle,
} from './hideWatched.js';
import {
  collectAllText,
  extractNavTabBrowseId,
  isShortsShelf,
  filterShortsFromItems,
} from './shorts.js';
import { applyLibraryTabHiding } from './libraryTabHider.js';

// ===== Local utilities =====

// ===== Playlist Helper System =====

function getPlaylistHelperVideoIdSet() {
  if (!window.__ttPlaylistHelperVideoIds) window.__ttPlaylistHelperVideoIds = new Set();
  return window.__ttPlaylistHelperVideoIds;
}

function getRetiredPlaylistHelperVideoIdSet() {
  if (!window.__ttRetiredPlaylistHelperVideoIds) window.__ttRetiredPlaylistHelperVideoIds = new Set();
  return window.__ttRetiredPlaylistHelperVideoIds;
}

// Updates the CSS hide rule to cover both active helpers AND retired helpers.
// The virtual list re-renders retired tiles from its internal data model on every scroll,
// so DOM removal alone causes a visible flash (tile appears → 50ms later removed → repeat).
// CSS visibility:hidden persists across re-renders and eliminates the flash entirely.
function updateAllHelperHideStyles() {
  const combined = new Set([
    ...getPlaylistHelperVideoIdSet(),
    ...getRetiredPlaylistHelperVideoIdSet(),
  ]);
  updateHelperHideStyle(combined);
}

function storePlaylistContinuationToken(continuations, label = '') {
  try {
    const token = continuations?.[0]?.nextContinuationData?.continuation
      || continuations?.[0]?.reloadContinuationData?.continuation;
    if (token && typeof token === 'string') {
      window.__ttPlaylistContinuationToken = token;
      appendFileOnlyLog('playlist.continuation.token.stored', { label, tokenLen: token.length });
    }
  } catch (_) {}
}


function attemptPlaylistAutoLoad(reason = 'playlist.auto_load', attempt = 0) {
  if ((window.__ttLastDetectedPage || detectCurrentPage()) !== 'playlist') return;

  // Primary: use YouTube TV's own resolveCommand with the stored continuation token.
  // This is the most reliable trigger since it goes through the same code path as
  // the TV's internal "load more" mechanism.
  const token = window.__ttPlaylistContinuationToken;
  if (token) {
    try {
      resolveCommand({
        clickTrackingParams: '',
        continuationCommand: {
          token,
          request: 'CONTINUATION_REQUEST_TYPE_BROWSE',
        },
      });
      appendFileOnlyLog('playlist.auto_load.trigger', { reason, attempt, method: 'resolveCommand', tokenLen: token.length });
      return;
    } catch (_) {}
  }

  // Fallback 1: activate the <yt-continuation> sentinel element directly.
  // YouTube TV uses this element to detect when the user has scrolled to the bottom;
  // clicking/activating it triggers the same continuation fetch as reaching the end.
  try {
    const cont = document.querySelector('ytlr-playlist-video-list-renderer yt-continuation');
    if (cont) {
      if (typeof cont.activate === 'function') cont.activate();
      else if (typeof cont.click === 'function') cont.click();
      else cont.dispatchEvent(new Event('activate', { bubbles: true }));
      appendFileOnlyLog('playlist.auto_load.trigger', { reason, attempt, method: 'yt-continuation' });
      return;
    }
  } catch (_) {}

  // Fallback 2: ArrowDown events on document. The virtual list's focus manager routes
  // these through its own item-index system; reaching the last item triggers the fetch.
  const arrowOpts = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true };
  for (let i = 0; i < 4; i++) {
    setTimeout(() => {
      try { document.dispatchEvent(new KeyboardEvent('keydown', arrowOpts)); } catch (_) {}
      try { document.dispatchEvent(new KeyboardEvent('keyup', arrowOpts)); } catch (_) {}
    }, i * 120);
  }
  appendFileOnlyLog('playlist.auto_load.trigger', { reason, attempt, method: 'arrowdown_fallback' });
}

function schedulePlaylistAutoLoad(reason = 'playlist.auto_load') {
  if ((window.__ttLastDetectedPage || detectCurrentPage()) !== 'playlist') return;
  const reasonText = String(reason || '');
  const allowAutoLoad = reasonText.includes('keep-one') || reasonText.includes('empty_batch');
  if (!allowAutoLoad) return;
  const now = Date.now();
  if (reasonText.includes('empty_batch')) {
    window.__ttEmptyBatchAutoLoadCount = Number(window.__ttEmptyBatchAutoLoadCount || 0) + 1;
    if (window.__ttEmptyBatchAutoLoadCount > 6) return;
  } else {
    window.__ttEmptyBatchAutoLoadCount = 0;
  }
  const cooldownUntil = Number(window.__ttPlaylistAutoLoadCooldownUntil || 0);
  if (now < cooldownUntil) return;
  window.__ttPlaylistAutoLoadCooldownUntil = now + 2600;
  [0, 150, 500, 1000, 1800].forEach((delay, index) => setTimeout(() => attemptPlaylistAutoLoad(reason, index), delay));
}

function showPlaylistAllHiddenNotice(reason = 'playlist.all_hidden') {
  if (typeof document === 'undefined') return;
  const id = 'tt-playlist-empty-notice';
  let notice = document.getElementById(id);
  if (!notice) {
    notice = document.createElement('div');
    notice.id = id;
    Object.assign(notice.style, {
      position: 'fixed', left: '50%', bottom: '4%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '12px 16px',
      borderRadius: '10px', zIndex: '999999', fontSize: '18px'
    });
    document.body?.appendChild(notice);
  }
  notice.textContent = 'All videos in this playlist are hidden. Leave playlist to dismiss.';
  const cleanup = () => {
    if (detectCurrentPage() === 'playlist') return;
    document.getElementById(id)?.remove();
    if (window.__ttPlaylistNoticeInterval) { clearInterval(window.__ttPlaylistNoticeInterval); window.__ttPlaylistNoticeInterval = null; }
  };
  if (!window.__ttPlaylistNoticeCleanupBound) {
    window.__ttPlaylistNoticeCleanupBound = true;
    window.addEventListener('hashchange', cleanup);
    window.addEventListener('popstate', cleanup);
  }
  if (!window.__ttPlaylistNoticeInterval) window.__ttPlaylistNoticeInterval = setInterval(cleanup, 500);
}

function getPlaylistTileNodes() {
  if (typeof document === 'undefined' || !document?.querySelectorAll) return [];
  const listRoot = document.querySelector('ytlr-playlist-video-list-renderer');
  if (!listRoot) return [];
  return Array.from(listRoot.querySelectorAll('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer'));
}

function parseTranslateYRem(transformValue, fallbackRem = 0) {
  const text = String(transformValue || '');
  const remMatch = text.match(/translateY\(([-\d.]+)rem\)/i);
  if (remMatch) { const v = Number(remMatch[1]); return Number.isFinite(v) ? v : fallbackRem; }
  const pxMatch = text.match(/translateY\(([-\d.]+)px\)/i);
  if (pxMatch) { const v = Number(pxMatch[1]); return Number.isFinite(v) ? (v / 16) : fallbackRem; }
  return fallbackRem;
}

function isHelperLikePlaylistNode(rowNode, tileNode) {
  const rowClass = String(rowNode?.className || '');
  const tileClass = String(tileNode?.className || '');
  return rowClass.includes('fitbrf') || rowClass.includes('B3hoEd') ||
    rowClass.includes('tt-helper-soft-hidden') || tileClass.includes('HTybHf') || tileClass.includes('IYlICe');
}

function restoreSoftHiddenPlaylistRow(rowNode, tileNode) {
  if (!rowNode) return;
  rowNode.classList?.remove('tt-helper-soft-hidden');
  rowNode.style.removeProperty('visibility');
  rowNode.style.removeProperty('pointer-events');
  if (rowNode.getAttribute('aria-hidden') === 'true') rowNode.removeAttribute('aria-hidden');
  if (rowNode.getAttribute('tabindex') === '-1') rowNode.removeAttribute('tabindex');
  if (tileNode) {
    tileNode.style.removeProperty('display');
    if (tileNode.getAttribute('tabindex') === '-1') tileNode.removeAttribute('tabindex');
  }
}

function isPlaylistDetailView() {
  if (typeof location === 'undefined') return false;
  const hash = String(location.hash || '').toLowerCase();
  if (hash.includes('c=feplaylist_aggregation')) return false;
  return detectCurrentPage() === 'playlist';
}

function compactPlaylistVirtualRows(reason = 'playlist.row_compact') {
  if (!isPlaylistDetailView()) return { rows: 0, removedPlaceholders: 0, adjusted: 0 };
  const roots = Array.from(document.querySelectorAll('.NUDen'));
  let rows = 0, removedPlaceholders = 0, removedHiddenShells = 0, skippedScrolledRoots = 0;
  for (const root of roots) {
    const rootOffset = parseTranslateYRem(root?.style?.transform, 0);
    const rowNodes = Array.from(root.querySelectorAll(':scope > .TXB27d'));
    if (!rowNodes.length) continue;
    rows += rowNodes.length;
    for (const row of rowNodes) {
      const hasTile = !!row.querySelector('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer');
      const hasButtonRow = !!row.querySelector('ytlr-button-renderer, ytlr-button');
      const classText = String(row.className || '');
      const softHidden = classText.includes('tt-helper-soft-hidden');
      const tileNode = row.querySelector('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer');
      const rowHtml = String(row.innerHTML || '').trim();
      const childCount = Number(row.children?.length || 0);
      const noRenderableContent = !hasTile && !hasButtonRow && !rowHtml;
      const explicitPlaceholderShell = !hasTile && !hasButtonRow && (classText.includes('fitbrf') || classText.includes('B3hoEd') || childCount === 0);
      const isHardHiddenShell = row.getAttribute('aria-hidden') === 'true' && String(row.style?.visibility || '').toLowerCase() === 'hidden';
      if (softHidden) restoreSoftHiddenPlaylistRow(row, tileNode);
      if (noRenderableContent || explicitPlaceholderShell) { row.remove(); removedHiddenShells++; continue; }
      if (isHardHiddenShell) {
        if (Math.abs(rootOffset) <= 0.1) { row.remove(); removedHiddenShells++; }
        else skippedScrolledRoots++;
        continue;
      }
      if (Math.abs(rootOffset) > 0.1) continue;
      const focused = classText.includes('lxpVI') || classText.includes('zylon-focus') || !!row.querySelector('.zylon-focus');
      const isPlaceholder = softHidden || (!hasButtonRow && (!hasTile || classText.includes('fitbrf') || classText.includes('B3hoEd')));
      if ((isPlaceholder && !focused) || softHidden) { row.remove(); removedPlaceholders++; }
    }
    if (Math.abs(rootOffset) > 0.1) skippedScrolledRoots++;
  }
  appendFileOnlyLog('playlist.row_compact', { reason, rows, removedPlaceholders, removedHiddenShells, skippedScrolledRoots });
  return { rows, removedPlaceholders, adjusted: 0 };
}

function removeRetiredHelpersFromTiles(reason = 'playlist.helper.tile_scan') {
  if (window.__ttRemovingHelperTiles) return { scannedTiles: 0, removed: 0, matchedIds: [] };
  const retiredIds = Array.from(getRetiredPlaylistHelperVideoIdSet());
  if (!retiredIds.length) return { scannedTiles: 0, removed: 0, matchedIds: [] };
  const tiles = getPlaylistTileNodes();
  if (!tiles.length) return { scannedTiles: 0, removed: 0, matchedIds: [] };
  window.__ttRemovingHelperTiles = true;
  let matchedTiles = 0, removed = 0, focusRedirected = 0, deferredNoContent = 0;
  const removedTiles = new Set(), matchedIds = new Set();
  try {
    for (const tile of tiles) {
      const html = String(tile?.outerHTML || '');
      if (!html) continue;
      for (const id of retiredIds) {
        if (!id || !html.includes(id)) continue;
        matchedIds.add(id);
        matchedTiles++;
        try {
          // Only remove this helper tile if there are other non-retired tiles already in DOM.
          // If it's the only tile, keeping it is critical: the virtual list needs at least one
          // rendered element as a scroll anchor. Removing it empties the list, which causes
          // YouTube TV to reload the whole page when yt-continuation is triggered.
          // The MutationObserver will retry once the next batch renders a replacement tile.
          const nonRetiredTiles = tiles.filter(t => {
            if (t === tile) return false;
            const h = String(t?.outerHTML || '');
            return h && !retiredIds.some(rid => rid && h.includes(rid));
          });
          if (nonRetiredTiles.length === 0) { deferredNoContent++; break; }
          const rowNode = tile.closest('.TXB27d');
          const rowClass = String(rowNode?.className || '');
          const isFocused = rowClass.includes('lxpVI') || rowClass.includes('zylon-focus') || tile.classList?.contains('zylon-focus');
          if (isFocused) {
            focusRedirected++;
            // Redirect focus away from the removed tile.
            // Do NOT call vlist.focus() — on Tizen 5.0 that triggers a full playlist
            // page restart (YouTube TV re-fetches the initial response), which causes
            // all retired IDs to be re-rendered and breaks the helper cleanup cycle.
            try { document.body?.focus?.(); } catch (_) {}
          }
          if (!removedTiles.has(tile)) {
            removedTiles.add(tile);
            try { tile.remove(); } catch (_) {}
            removed++;
          }
        } catch (_) { }
        break;
      }
    }
    // Do NOT call compactPlaylistVirtualRows or schedulePlaylistAutoLoad after removal.
    // schedulePlaylistAutoLoad on an empty virtual list causes YouTube TV to reload the
    // whole page. YouTube TV's own continuation mechanism handles loading more content.
  } finally {
    window.__ttRemovingHelperTiles = false;
  }
  appendFileOnlyLog('playlist.helper.tile_scan', { reason, retiredCount: retiredIds.length, scannedTiles: tiles.length, removed, matchedTiles, focusRedirected, deferredNoContent, matchedIds: Array.from(matchedIds) });
  return { scannedTiles: tiles.length, removed, matchedIds: Array.from(matchedIds), matchedTiles };
}

function ensurePlaylistHelperObserver() {
  if (window.__ttPlaylistHelperObserverInstalled) return;
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document?.documentElement) return;
  let debounceTimer = null, isProcessing = false;
  const process = () => {
    if (isProcessing) return;
    if (detectCurrentPage() !== 'playlist') return;
    if (getRetiredPlaylistHelperVideoIdSet().size === 0) return;
    isProcessing = true;
    try {
      const result = removeRetiredHelpersFromTiles('observer.mutation');
      if (result.removed > 0) appendFileOnlyLog('playlist.helper.observer.tick', { removed: result.removed, matchedTiles: result.matchedTiles || 0 });
    } finally { isProcessing = false; }
  };
  const observer = new MutationObserver(() => {
    if (isProcessing) return;
    if (detectCurrentPage() !== 'playlist') return;
    if (getRetiredPlaylistHelperVideoIdSet().size === 0) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    // 50ms debounce: fast enough that helpers are invisible when re-rendered by the
    // virtual list during scroll, but not so tight that we thrash on every mutation.
    debounceTimer = setTimeout(process, 50);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__ttPlaylistHelperObserverInstalled = true;
}

function retirePlaylistHelperVideoId(videoId, label = 'playlist.helper') {
  const id = String(videoId || '').trim();
  if (!id) return;
  getRetiredPlaylistHelperVideoIdSet().add(id);
  // CSS-hide the retired tile immediately so it stays invisible even when the virtual
  // list re-renders it during scroll (DOM removal alone causes a flash: tile appears →
  // observer removes → vlist re-renders → repeat). CSS persists across re-renders.
  updateAllHelperHideStyles();
  ensurePlaylistHelperObserver();
  // Do NOT call removeRetiredHelpersFromTiles immediately. At retirement time the new
  // batch content has not yet been rendered, so the helper is the only tile in DOM.
  // Removing it immediately empties the virtual list and causes a page restart.
  // The scheduled cleanup (300ms+) and MutationObserver handle removal once new content exists.
}

function registerPlaylistHelperVideoId(videoId, label = 'playlist.helper') {
  const id = String(videoId || '').trim();
  if (!id) return;
  const set = getPlaylistHelperVideoIdSet();
  const staleIds = Array.from(set).filter(knownId => knownId !== id);
  if (staleIds.length > 0) {
    schedulePlaylistHelperDomCleanup(staleIds, `${label}.register.stale`);
    for (const staleId of staleIds) unregisterPlaylistHelperVideoId(staleId, `${label}.register.stale`);
  }
  set.add(id);
  const retired = getRetiredPlaylistHelperVideoIdSet();
  if (retired.delete(id)) appendFileOnlyLog(`${label}.register.unretire`, { videoId: id });
  appendFileOnlyLog(`${label}.register`, { videoId: id, total: set.size });
  updateAllHelperHideStyles();
}

function unregisterPlaylistHelperVideoId(videoId, label = 'playlist.helper') {
  const id = String(videoId || '').trim();
  if (!id) return;
  const set = getPlaylistHelperVideoIdSet();
  if (set.delete(id)) {
    retirePlaylistHelperVideoId(id, label);
    appendFileOnlyLog(`${label}.unregister`, { videoId: id, total: set.size });
  }
}

function clearPlaylistHelperVideoIdSet(label = 'playlist.helper') {
  const set = getPlaylistHelperVideoIdSet();
  const helperIds = Array.from(set);
  if (helperIds.length > 0) {
    schedulePlaylistHelperDomCleanup(helperIds, `${label}.registry.cleared`);
    for (const helperId of helperIds) retirePlaylistHelperVideoId(helperId, `${label}.registry`);
    set.clear();
    updateAllHelperHideStyles();
    appendFileOnlyLog(`${label}.registry.cleared`, { cleared: helperIds.length, helperIds });
  }
}

function cleanupPlaylistHelpersFromDom(helperIds, reason = 'playlist.helper.cleanup', attempt = 0) {
  if (!Array.isArray(helperIds) || helperIds.length === 0) return { matched: 0, removed: 0 };
  if (typeof document === 'undefined' || !document?.querySelectorAll) return { matched: 0, removed: 0 };
  let matched = 0, removed = 0, skippedUnsafe = 0;
  const removedNodes = new Set();
  const playlistRoot = document.querySelector('ytlr-playlist-video-list-renderer') || document;
  for (const rawId of helperIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    for (const selector of [`[data-video-id="${id}"]`, `[video-id="${id}"]`, `[data-content-id="${id}"]`, `[content-id="${id}"]`]) {
      let nodes = [];
      try { nodes = Array.from(playlistRoot.querySelectorAll(selector)); } catch (_) { }
      if (!nodes.length) continue;
      matched += nodes.length;
      for (const node of nodes) {
        const safeNode = node?.closest?.('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer') || null;
        if (!safeNode) { skippedUnsafe++; continue; }
        const rowNode = safeNode.closest?.('.TXB27d');
        const rowClass = String(rowNode?.className || '');
        const focused = rowClass.includes('lxpVI') || rowClass.includes('zylon-focus') || safeNode.classList?.contains('zylon-focus');
        if (!isHelperLikePlaylistNode(rowNode, safeNode) || focused) { skippedUnsafe++; continue; }
        if (removedNodes.has(safeNode)) continue;
        try { removedNodes.add(safeNode); safeNode.remove(); removed++; } catch (_) { skippedUnsafe++; }
      }
    }
  }
  const tileScanResult = removeRetiredHelpersFromTiles(`${reason}.cleanup_attempt_${attempt}`);
  removed += Number(tileScanResult.removed || 0);
  appendFileOnlyLog('playlist.helper.dom.cleanup', { reason, helperIds, attempt, matched, removed, skippedUnsafe });
  return { matched, removed };
}

function schedulePlaylistHelperDomCleanup(helperIds, reason = 'playlist.helper.cleanup') {
  if (!Array.isArray(helperIds) || helperIds.length === 0) return;
  // Start at 300ms: YouTube TV renders new batch content within ~100ms of JSON parse.
  // 300ms ensures replacement content is in DOM before we attempt removal.
  [300, 700, 1500].forEach((delay, index) => setTimeout(() => cleanupPlaylistHelpersFromDom(helperIds, reason, index), delay));
}

function clearKeepOneMarkers(items, label = 'continuation') {
  if (!Array.isArray(items)) return 0;
  let cleared = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.__ttKeepOneForContinuation) {
      const helperVideoId = getItemVideoId(item);
      delete item.__ttKeepOneForContinuation;
      delete item.__ttKeepOneForContinuationLabel;
      delete item.__ttKeepOneForContinuationParseSeq;
      unregisterPlaylistHelperVideoId(helperVideoId, `${label}.keep-one`);
      cleared++;
    }
  }
  return cleared;
}

function filterContinuationItems(items, pageName, hasContinuation = false, label = 'continuation') {
  if (pageName === 'playlist' && !hasContinuation) {
    clearPlaylistHelperVideoIdSet(label);
    // Also wipe the retired set. On Tizen 5.0 YouTube TV can "restart" a playlist page
    // (re-fetch the initial response without a browser reload) when e.g. vlist.focus()
    // was called. window state survives that restart, so stale retired IDs remain in the
    // set and cause the MutationObserver to remove freshly-rendered tiles immediately,
    // creating a deadlock where the only visible tile is perpetually deferred.
    const retiredSet = getRetiredPlaylistHelperVideoIdSet();
    if (retiredSet.size > 0) {
      appendFileOnlyLog('playlist.retired.cleared_on_fresh', { count: retiredSet.size, ids: Array.from(retiredSet) });
      retiredSet.clear();
      updateAllHelperHideStyles();
    }
  }
  clearKeepOneMarkers(items, label);
  let filteredItems = hideVideo(items, pageName);
  filteredItems = filterShortsFromItems(filteredItems, pageName);
  if (pageName === 'playlist' && hasContinuation && filteredItems.length === 0 && Array.isArray(items) && items.length > 0) {
    const reverseItems = [...items].reverse();
    const fallbackItem =
      reverseItems.find(item => item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.length) ||
      reverseItems.find(item => item?.tileRenderer) || items[items.length - 1];
    if (fallbackItem && typeof fallbackItem === 'object') {
      fallbackItem.__ttKeepOneForContinuation = true;
      fallbackItem.__ttKeepOneForContinuationLabel = `${label}.visible`;
      fallbackItem.__ttKeepOneForContinuationParseSeq = Number(window.__ttParseSeq || 0);
      registerPlaylistHelperVideoId(getItemVideoId(fallbackItem), `${label}.keep-one`);
    }
    // All items in this batch are watched — auto-fetch the next batch without waiting
    // for the user to scroll. The continuation token is already stored at this point.
    // This cascades through all-watched batches automatically until unwatched content appears.
    schedulePlaylistAutoLoad(`${label}.keep-one`);
    return [fallbackItem];
  }
  if (pageName === 'playlist' && !hasContinuation && filteredItems.length === 0) showPlaylistAllHiddenNotice(`${label}.no_continuation_all_hidden`);
  if (pageName === 'playlist' && hasContinuation && filteredItems.length === 0) {
    appendFileOnlyLog(`${label}.empty_batch.autoload`, { pageName, originalCount: Array.isArray(items) ? items.length : 0 });
    schedulePlaylistAutoLoad(`${label}.empty_batch`);
  }
  return filteredItems;
}

function filterPlaylistRendererContents(playlistRenderer, pageName, label = 'playlist.renderer') {
  if (!playlistRenderer || !Array.isArray(playlistRenderer.contents)) return;
  const hasContinuation = !!playlistRenderer?.continuations;
  const before = playlistRenderer.contents.length;
  playlistRenderer.contents = filterContinuationItems(playlistRenderer.contents, pageName, hasContinuation, label);
  if (pageName === 'playlist' && !hasContinuation && playlistRenderer.contents.length === 0) showPlaylistAllHiddenNotice(`${label}.all_hidden_after_filter`);
  appendFileOnlyLog(`${label}.result`, { pageName, hasContinuation, before, after: playlistRenderer.contents.length });
}

// ===== processResponsePayload (array-root responses) =====

function processResponsePayload(payload, detectedPage) {
  if (!payload || typeof payload !== 'object') return;
  if (payload?.contents?.sectionListRenderer?.contents) {
    const slr = payload.contents.sectionListRenderer;
    processShelves(slr.contents, true, detectedPage);
    consolidateShelves(slr.contents, 'arrayPayload.sectionList', detectedPage, !!slr.continuations, filterShortsFromItems);
  }
  if (payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    const tvBrowseSlr = payload.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer;
    processShelves(tvBrowseSlr.contents, true, detectedPage);
    consolidateShelves(tvBrowseSlr.contents, 'arrayPayload.tvBrowse.sectionList', detectedPage, !!tvBrowseSlr.continuations, filterShortsFromItems);
  }
  if (payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
    const grid = payload.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer;
    grid.items = hideVideo(grid.items, detectedPage);
    normalizeGridRenderer(grid, 'arrayPayload.contents.tvBrowseRenderer.grid');
  }
  if (payload?.continuationContents?.sectionListContinuation?.contents) {
    const slc = payload.continuationContents.sectionListContinuation;
    processShelves(slc.contents, true, detectedPage);
    consolidateShelves(slc.contents, 'arrayPayload.continuation.sectionList', detectedPage, !!slc.continuations, filterShortsFromItems);
  }
  if (payload?.continuationContents?.tvSurfaceContentContinuation?.content?.sectionListRenderer?.contents) {
    const tvSlc = payload.continuationContents.tvSurfaceContentContinuation.content.sectionListRenderer;
    clearCarryover();
    processShelves(tvSlc.contents, true, detectedPage);
    consolidateShelves(tvSlc.contents, 'arrayPayload.continuation.tvSurface.sectionList', detectedPage, !!tvSlc.continuations, filterShortsFromItems);
  }
  if (payload?.continuationContents?.horizontalListContinuation?.items) {
    const continuation = payload.continuationContents.horizontalListContinuation;
    deArrowify(continuation.items);
    hqify(continuation.items);
    addLongPress(continuation.items);
    continuation.items = filterContinuationItems(continuation.items, detectedPage, !!continuation?.continuations, 'arrayPayload.horizontalListContinuation');
    normalizeHorizontalListRenderer(continuation, 'arrayPayload.continuation.horizontal');
  }
  if (payload?.continuationContents?.gridContinuation?.items) {
    const gc = payload.continuationContents.gridContinuation;
    gc.items = filterContinuationItems(gc.items, detectedPage, !!gc?.continuations, 'arrayPayload.gridContinuation');
    normalizeGridRenderer(gc, 'arrayPayload.continuation.grid');
  }
  if (payload?.continuationContents?.playlistVideoListContinuation?.contents) {
    const plc = payload.continuationContents.playlistVideoListContinuation;
    plc.contents = filterContinuationItems(plc.contents, detectedPage, !!plc?.continuations, 'arrayPayload.playlist.continuation');
  }
  const arrayTopPlaylistRenderer = payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer;
  if (arrayTopPlaylistRenderer?.contents) filterPlaylistRendererContents(arrayTopPlaylistRenderer, detectedPage, 'arrayPayload.playlist.renderer');
  processTileArraysDeep(payload, detectedPage, 'arrayPayload', 0, filterShortsFromItems);
}

// ===== DeArrow request queue =====

const _deArrowQueue = [];
let _deArrowInFlight = 0;
const _DEARROW_MAX_CONCURRENT = 5;

function _deArrowRunNext() {
  if (_deArrowInFlight >= _DEARROW_MAX_CONCURRENT || _deArrowQueue.length === 0) return;
  const task = _deArrowQueue.shift();
  _deArrowInFlight++;
  try {
    const result = task();
    if (result && typeof result.finally === 'function') result.finally(() => { _deArrowInFlight--; _deArrowRunNext(); });
    else { _deArrowInFlight--; _deArrowRunNext(); }
  } catch (_) { _deArrowInFlight--; _deArrowRunNext(); }
}

function _deArrowEnqueue(taskFn) { _deArrowQueue.push(taskFn); _deArrowRunNext(); }

// ===== JSON.parse Patch =====

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  try {
    const detectedPage = detectPageFromResponse(r) || detectCurrentPage();
    window.__ttLastDetectedPage = detectedPage;
    window.__ttParseSeq = Number(window.__ttParseSeq || 0) + 1;
    appendFileOnlyLog('parse.begin', { detectedPage, hash: location.hash || '' });

    if (Array.isArray(r)) {
      for (let i = 0; i < r.length; i++) processResponsePayload(r[i], detectedPage);
      return r;
    }

    const adBlockEnabled = configRead('enableAdBlock');
    if (r.adPlacements && adBlockEnabled) r.adPlacements = [];
    if (r.playerAds && adBlockEnabled) r.playerAds = false;
    if (r.adSlots && adBlockEnabled) r.adSlots = [];

    const hiddenLibraryTabIds = configRead('hiddenLibraryTabIds');
    if (Array.isArray(hiddenLibraryTabIds) && hiddenLibraryTabIds.length > 0) {
      applyLibraryTabHiding(r, hiddenLibraryTabIds);
    }

    updateProgressCache(r);
    if (detectedPage !== 'watch' && r?.frameworkUpdates?.entityBatchUpdate?.mutations) {
      if (!window._ttVideoProgressCache) window._ttVideoProgressCache = {};
      for (const mutation of r.frameworkUpdates.entityBatchUpdate.mutations) {
        try {
          for (const entry of collectWatchProgressEntries(mutation?.payload || {})) {
            if (window._ttVideoProgressCache[entry.id] === undefined) window._ttVideoProgressCache[entry.id] = Number(entry.percent);
          }
        } catch (_) { }
      }
    }

    // =========================================================
    // === WATCH PAGE FAST PATH                               ===
    // =========================================================
    if (detectedPage === 'watch') {
      if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) r.paidContentOverlay = null;
      if (r.endscreen && configRead('enableHideEndScreenCards')) r.endscreen = null;
      if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) r.messages = r.messages.filter(msg => !msg?.youThereRenderer);
      if (r?.title?.runs) PatchSettings(r);
      if (r?.streamingData?.adaptiveFormats && configRead('videoPreferredCodec') !== 'any') {
        try {
          const preferredCodec = configRead('videoPreferredCodec');
          if (r.streamingData.adaptiveFormats.find(f => f.mimeType.includes(preferredCodec))) {
            r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('audio/') || f.mimeType.includes(preferredCodec));
          }
        } catch (_) { }
      }
      if (configRead('sponsorBlockManualSkips').length > 0 && r?.playerOverlays?.playerOverlayRenderer) {
        try {
          const manualSkippedSegments = configRead('sponsorBlockManualSkips');
          const timelyActions = [];
          if (window?.sponsorblock?.segments) {
            for (const segment of window.sponsorblock.segments) {
              if (manualSkippedSegments.includes(segment.category)) {
                timelyActions.push(timelyAction(`Skip ${segment.category}`, 'SKIP_NEXT', { clickTrackingParams: null, showEngagementPanelEndpoint: { customAction: { action: 'SKIP', parameters: { time: segment.segment[1] } } } }, segment.segment[0] * 1000, segment.segment[1] * 1000 - segment.segment[0] * 1000));
              }
            }
            r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = timelyActions;
          }
        } catch (_) { }
      } else if (r?.playerOverlays?.playerOverlayRenderer) {
        r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = [];
      }
      if (r?.transportControls?.transportControlsRenderer?.promotedActions && configRead('enableSponsorBlockHighlight')) {
        try {
          if (window?.sponsorblock?.segments) {
            const category = window.sponsorblock.segments.find(seg => seg.category === 'poi_highlight');
            if (category) {
              r.transportControls.transportControlsRenderer.promotedActions.push({ type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT', button: { buttonRenderer: ButtonRenderer(false, 'Skip to highlight', 'SKIP_NEXT', { clickTrackingParams: null, customAction: { action: 'SKIP', parameters: { time: category.segment[0] } } }) } });
            }
          }
        } catch (_) { }
      }
      if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
        try {
          const signinReminderEnabled = configRead('enableSigninReminder');
          const watchNextSlr = r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer;
          if (!signinReminderEnabled) watchNextSlr.contents = watchNextSlr.contents.filter(elm => !elm.alertWithActionsRenderer);
          processShelves(watchNextSlr.contents, false, detectedPage);
          consolidateShelves(watchNextSlr.contents, 'watchNext', detectedPage, !!watchNextSlr.continuations, filterShortsFromItems);
          if (window.queuedVideos.videos.length > 0) {
            const queuedVideosClone = window.queuedVideos.videos.slice();
            queuedVideosClone.unshift(TileRenderer('Clear Queue', { customAction: { action: 'CLEAR_QUEUE' } }));
            watchNextSlr.contents.unshift(ShelfRenderer('Queued Videos', queuedVideosClone, queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ? queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) : 0));
          }
        } catch (_) { }
      }
      if (r?.continuationContents?.sectionListContinuation?.contents) {
        const wNextSlc = r.continuationContents.sectionListContinuation;
        processShelves(wNextSlc.contents, false, detectedPage);
        consolidateShelves(wNextSlc.contents, 'watchNext.continuation.sectionList', detectedPage, !!wNextSlc.continuations, filterShortsFromItems);
      }
      if (r?.continuationContents?.horizontalListContinuation?.items) {
        const continuation = r.continuationContents.horizontalListContinuation;
        addLongPress(continuation.items);
        continuation.items = filterContinuationItems(continuation.items, detectedPage, !!continuation?.continuations, 'watchNext.continuation.horizontal');
        normalizeHorizontalListRenderer(continuation, 'watchNext.continuation.horizontal');
      }
      if (r?.continuationContents?.pivotContinuation?.contents) {
        const wNextPivot = r.continuationContents.pivotContinuation;
        processShelves(wNextPivot.contents, false, detectedPage);
        consolidateShelves(wNextPivot.contents, 'watchNext.continuation.pivot', detectedPage, !!wNextPivot.continuations, filterShortsFromItems);
      }
      return r;
    }
    // =========================================================
    // === END WATCH PAGE FAST PATH                           ===
    // =========================================================

    const signinReminderEnabled = configRead('enableSigninReminder');
    if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) r.paidContentOverlay = null;
    if (r?.streamingData?.adaptiveFormats && configRead('videoPreferredCodec') !== 'any') {
      try {
        const preferredCodec = configRead('videoPreferredCodec');
        if (r.streamingData.adaptiveFormats.find(f => f.mimeType.includes(preferredCodec))) {
          r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.filter(f => f.mimeType.startsWith('audio/') || f.mimeType.includes(preferredCodec));
        }
      } catch (_) { }
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
      const tvBrowseMainSlr = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer;
      if (!signinReminderEnabled) tvBrowseMainSlr.contents = tvBrowseMainSlr.contents.filter(elm => !elm.feedNudgeRenderer);
      if (adBlockEnabled) {
        tvBrowseMainSlr.contents = tvBrowseMainSlr.contents.filter(elm => !elm.adSlotRenderer);
        for (const shelve of tvBrowseMainSlr.contents) {
          if (shelve.shelfRenderer) {
            try { shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => !item.adSlotRenderer); } catch (_) { }
          }
        }
      }
      processShelves(tvBrowseMainSlr.contents, true, detectedPage);
      consolidateShelves(tvBrowseMainSlr.contents, 'tvBrowse.sectionList', detectedPage, !!tvBrowseMainSlr.continuations, filterShortsFromItems);
    }

    if (r.endscreen && configRead('enableHideEndScreenCards')) r.endscreen = null;
    if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) r.messages = r.messages.filter(msg => !msg?.youThereRenderer);
    if (!Array.isArray(r) && r?.entries && adBlockEnabled) r.entries = r.entries?.filter(elm => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd);
    if (r?.title?.runs) PatchSettings(r);

    if (r?.contents?.sectionListRenderer?.contents) {
      processShelves(r.contents.sectionListRenderer.contents, true, detectedPage);
      consolidateShelves(r.contents.sectionListRenderer.contents, 'sectionList', detectedPage, !!r.contents.sectionListRenderer.continuations, filterShortsFromItems);
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
      const grid = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer;
      let gridItems = hideVideo(grid.items, detectedPage);
      gridItems = filterShortsFromItems(gridItems, detectedPage);
      grid.items = gridItems;
      normalizeGridRenderer(grid, 'contents.tvBrowseRenderer.grid');
    }

    const topPlaylistRenderer = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer;
    if (topPlaylistRenderer?.contents) {
      storePlaylistContinuationToken(topPlaylistRenderer.continuations, 'topPlaylist');
      filterPlaylistRendererContents(topPlaylistRenderer, detectedPage, 'playlist.renderer');
    }

    if (r?.continuationContents?.sectionListContinuation?.contents) {
      const contSlc = r.continuationContents.sectionListContinuation;
      processShelves(contSlc.contents, false, detectedPage);
      consolidateShelves(contSlc.contents, 'continuation.sectionList', detectedPage, !!contSlc.continuations, filterShortsFromItems);
    }

    if (r?.continuationContents?.tvSurfaceContentContinuation?.content?.sectionListRenderer?.contents) {
      const tvSlc = r.continuationContents.tvSurfaceContentContinuation.content.sectionListRenderer;
      clearCarryover();
      processShelves(tvSlc.contents, false, detectedPage);
      consolidateShelves(tvSlc.contents, 'continuation.tvSurface.sectionList', detectedPage, !!tvSlc.continuations, filterShortsFromItems);
    }

    if (r?.continuationContents?.pivotContinuation?.contents) {
      const contPivot = r.continuationContents.pivotContinuation;
      appendFileOnlyLog('pivot.continuation.hit', { count: contPivot.contents.length });
      processShelves(contPivot.contents, false, detectedPage);
      consolidateShelves(contPivot.contents, 'continuation.pivot', detectedPage, !!contPivot.continuations, filterShortsFromItems);
    }

    if (r?.continuationContents?.horizontalListContinuation?.items) {
      const continuation = r.continuationContents.horizontalListContinuation;
      deArrowify(continuation.items);
      hqify(continuation.items);
      addLongPress(continuation.items);
      continuation.items = filterContinuationItems(continuation.items, detectedPage, !!continuation?.continuations, 'continuation.horizontal');
      normalizeHorizontalListRenderer(continuation, 'continuation.horizontal');
    }

    if (r?.continuationContents?.gridContinuation?.items) {
      const gc = r.continuationContents.gridContinuation;
      gc.items = filterContinuationItems(gc.items, detectedPage, !!gc?.continuations, 'gridContinuation');
      normalizeGridRenderer(gc, 'continuation.grid');
    }

    if (r?.continuationContents?.playlistVideoListContinuation?.contents) {
      const plc = r.continuationContents.playlistVideoListContinuation;
      const hasContinuation = !!plc?.continuations;
      storePlaylistContinuationToken(plc.continuations, 'plc');
      appendFileOnlyLog('playlist.continuation.detected', { detectedPage, itemCount: Array.isArray(plc.contents) ? plc.contents.length : 0, hasContinuation });
      plc.contents = filterContinuationItems(plc.contents, detectedPage, hasContinuation, 'playlist.continuation');
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
      for (const section of r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
        if (!Array.isArray(section?.tvSecondaryNavSectionRenderer?.tabs)) continue;
        if (configRead('sortSubscriptionsByAlphabet')) {
          try {
            section.tvSecondaryNavSectionRenderer.tabs.sort((a, b) => {
              if (a.tabRenderer.selected && !b.tabRenderer.selected) return -1;
              if (!a.tabRenderer.selected && b.tabRenderer.selected) return 1;
              return a.tabRenderer.title.localeCompare(b.tabRenderer.title);
            });
          } catch (sortErr) { appendFileOnlyLog('tabs.sort.error', { msg: String(sortErr?.message || sortErr) }); }
        }
        if (!configRead('enableShorts')) {
          const tabs = section.tvSecondaryNavSectionRenderer.tabs;
          for (let i = tabs.length - 1; i >= 0; i--) {
            const tab = tabs[i];
            const tabTitle = String(tab?.tabRenderer?.title?.simpleText || collectAllText(tab?.tabRenderer?.title).join(' ')).toLowerCase();
            const tabBrowseId = String(extractNavTabBrowseId(tab)).toLowerCase();
            if (tabTitle.includes('short') || tabBrowseId.includes('short')) {
              appendFileOnlyLog('shorts.navtab.removed', { tabTitle, tabBrowseId, index: i });
              tabs.splice(i, 1);
            }
          }
        }
        for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
          try {
            const tabBrowseId = String(extractNavTabBrowseId(tab)).toLowerCase();
            let tabPage = detectedPage;
            if (tabBrowseId.includes('fesubscription')) tabPage = 'subscriptions';
            else if (tabBrowseId.startsWith('uc')) tabPage = 'channel';
            else if (tabBrowseId === 'fehistory') tabPage = 'history';
            else if (tabBrowseId === 'felibrary') tabPage = 'library';
            else if (tabBrowseId === 'feplaylist_aggregation') tabPage = 'playlists';
            else if (tabBrowseId === 'femy_youtube' || tabBrowseId === 'vlwl' || tabBrowseId === 'vlll' || tabBrowseId.startsWith('vlpl')) tabPage = 'playlist';

            const tabPath = `tab.${tabBrowseId || 'unknown'}`;
            const tabSlr = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer;
            if (tabSlr && Array.isArray(tabSlr.contents)) {
              processShelves(tabSlr.contents, true, tabPage);
              consolidateShelves(tabSlr.contents, tabPath, tabPage, !!tabSlr.continuations, filterShortsFromItems);
            }
            const tabGridItems = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items;
            if (Array.isArray(tabGridItems)) {
              let filteredTabGrid = hideVideo(tabGridItems, tabPage);
              filteredTabGrid = filterShortsFromItems(filteredTabGrid, tabPage);
              tab.tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = filteredTabGrid;
              normalizeGridRenderer(tab.tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer, 'tab.grid');
            }
            const tabPlaylistRenderer = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.playlistVideoListRenderer;
            if (tabPlaylistRenderer?.contents) filterPlaylistRendererContents(tabPlaylistRenderer, tabPage, 'tab.playlist.renderer');
          } catch (tabErr) { appendFileOnlyLog('tab.process.error', { msg: String(tabErr?.message || tabErr) }); }
        }
      }
    }

    if (r?.contents?.singleColumnWatchNextResults) {
      appendFileOnlyLog('watchNext.shape', { hasPivot: !!r.contents.singleColumnWatchNextResults.pivot, keys: Object.keys(r.contents.singleColumnWatchNextResults) });
    }

    if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
      try {
        const nonWatchWnSlr = r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer;
        if (!signinReminderEnabled) nonWatchWnSlr.contents = nonWatchWnSlr.contents.filter(elm => !elm.alertWithActionsRenderer);
        processShelves(nonWatchWnSlr.contents, false, detectedPage);
        consolidateShelves(nonWatchWnSlr.contents, 'watchNext', detectedPage, !!nonWatchWnSlr.continuations, filterShortsFromItems);
        if (window.queuedVideos.videos.length > 0) {
          const queuedVideosClone = window.queuedVideos.videos.slice();
          queuedVideosClone.unshift(TileRenderer('Clear Queue', { customAction: { action: 'CLEAR_QUEUE' } }));
          nonWatchWnSlr.contents.unshift(ShelfRenderer('Queued Videos', queuedVideosClone, queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ? queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) : 0));
        }
      } catch (_) { }
    }

    if (configRead('sponsorBlockManualSkips').length > 0 && r?.playerOverlays?.playerOverlayRenderer) {
      try {
        const manualSkippedSegments = configRead('sponsorBlockManualSkips');
        const timelyActions = [];
        if (window?.sponsorblock?.segments) {
          for (const segment of window.sponsorblock.segments) {
            if (manualSkippedSegments.includes(segment.category)) {
              timelyActions.push(timelyAction(`Skip ${segment.category}`, 'SKIP_NEXT', { clickTrackingParams: null, showEngagementPanelEndpoint: { customAction: { action: 'SKIP', parameters: { time: segment.segment[1] } } } }, segment.segment[0] * 1000, segment.segment[1] * 1000 - segment.segment[0] * 1000));
            }
          }
          r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = timelyActions;
        }
      } catch (_) { }
    } else if (r?.playerOverlays?.playerOverlayRenderer) {
      r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = [];
    }

    if (r?.transportControls?.transportControlsRenderer?.promotedActions && configRead('enableSponsorBlockHighlight')) {
      try {
        if (window?.sponsorblock?.segments) {
          const category = window.sponsorblock.segments.find(seg => seg.category === 'poi_highlight');
          if (category) {
            r.transportControls.transportControlsRenderer.promotedActions.push({ type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT', button: { buttonRenderer: ButtonRenderer(false, 'Skip to highlight', 'SKIP_NEXT', { clickTrackingParams: null, customAction: { action: 'SKIP', parameters: { time: category.segment[0] } } }) } });
          }
        }
      } catch (_) { }
    }

    processTileArraysDeep(r, detectedPage, 'response', 0, filterShortsFromItems);
    return r;
  } catch (error) {
    appendFileOnlyLog('parse.error', { msg: String(error), stack: String(error?.stack || '').slice(0, 200) });
    if (!window.__ttAdblockParseWarned && configRead('enableDebugConsole')) {
      window.__ttAdblockParseWarned = true;
      console.warn('[TizenTube] adblock parser patch failed', error);
    }
    return r;
  }
};

window.JSON.parse = JSON.parse;

function _patchYttvJsonParse() {
  let patched = 0;
  try {
    for (const key in window._yttv) {
      if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) { window._yttv[key].JSON.parse = JSON.parse; patched++; }
    }
  } catch (_) { }
  return patched;
}

_patchYttvJsonParse();
const _yttvPatchInterval = setInterval(() => {
  try {
    if (!window._yttv || !Object.keys(window._yttv).length) return;
    const patched = _patchYttvJsonParse();
    if (patched > 0) clearInterval(_yttvPatchInterval);
  } catch (_) { }
}, 300);
setTimeout(() => clearInterval(_yttvPatchInterval), 15000);


// ===== processShelves =====

function processShelves(shelves, shouldAddPreviews = true, pageHint = null) {
  if (!Array.isArray(shelves)) return;
  const activePage = pageHint || window.__ttLastDetectedPage || detectCurrentPage();
  for (let i = shelves.length - 1; i >= 0; i--) {
    try {
      const shelve = shelves[i];
      if (!configRead('enableShorts') && isShortsShelf(shelve)) { shelves.splice(i, 1); continue; }
      if (!configRead('enableShorts') && !shelve?.shelfRenderer) {
        const allText = collectAllText(shelve).join(' ').toLowerCase();
        if (/\bshorts?\b/i.test(allText)) { shelves.splice(i, 1); continue; }
      }
      if (!shelve.shelfRenderer) continue;
      const shelfItems = shelve?.shelfRenderer?.content?.horizontalListRenderer?.items;
      if (!Array.isArray(shelfItems)) continue;
      deArrowify(shelfItems);
      hqify(shelfItems);
      addLongPress(shelfItems);
      if (shouldAddPreviews) addPreviews(shelfItems);
      shelve.shelfRenderer.content.horizontalListRenderer._originalRowSize = shelfItems.length;
      shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(shelfItems, activePage);
      normalizeHorizontalListRenderer(shelve.shelfRenderer.content.horizontalListRenderer, `shelf:${activePage}:${i}`);
      if (!configRead('enableShorts')) {
        if (isShortsShelf(shelve)) { shelves.splice(i, 1); continue; }
        const base = shelve?.richSectionRenderer?.content || shelve;
        if (Array.isArray(base?.shelfRenderer?.content?.horizontalListRenderer?.items)) {
          base.shelfRenderer.content.horizontalListRenderer.items = filterShortsFromItems(base.shelfRenderer.content.horizontalListRenderer.items, activePage);
          normalizeHorizontalListRenderer(base.shelfRenderer.content.horizontalListRenderer, `shelf:${activePage}:${i}:shorts`);
        }
        if (Array.isArray(base?.shelfRenderer?.content?.verticalListRenderer?.items)) base.shelfRenderer.content.verticalListRenderer.items = filterShortsFromItems(base.shelfRenderer.content.verticalListRenderer.items, activePage);
        if (Array.isArray(base?.shelfRenderer?.content?.gridRenderer?.items)) base.shelfRenderer.content.gridRenderer.items = filterShortsFromItems(base.shelfRenderer.content.gridRenderer.items, activePage);
        if (Array.isArray(base?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items)) base.shelfRenderer.content.expandedShelfContentsRenderer.items = filterShortsFromItems(base.shelfRenderer.content.expandedShelfContentsRenderer.items, activePage);
        if (Array.isArray(base?.richShelfRenderer?.content?.richGridRenderer?.contents)) base.richShelfRenderer.content.richGridRenderer.contents = filterShortsFromItems(base.richShelfRenderer.content.richGridRenderer.contents, activePage);
        if (Array.isArray(base?.reelShelfRenderer?.items)) base.reelShelfRenderer.items = filterShortsFromItems(base.reelShelfRenderer.items, activePage);
        const contentArrays = [
          base?.shelfRenderer?.content?.horizontalListRenderer?.items,
          base?.shelfRenderer?.content?.verticalListRenderer?.items,
          base?.shelfRenderer?.content?.gridRenderer?.items,
          base?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items,
          base?.richShelfRenderer?.content?.richGridRenderer?.contents,
          base?.reelShelfRenderer?.items,
        ].filter(arr => Array.isArray(arr));
        if (contentArrays.length > 0 && contentArrays.every(arr => arr.length === 0)) { shelves.splice(i, 1); continue; }
      }
      if (shelve.shelfRenderer.content.horizontalListRenderer.items.length === 0) shelves.splice(i, 1);
    } catch (shelfErr) { appendFileOnlyLog('processShelves.shelf.error', { index: i, msg: String(shelfErr?.message || shelfErr) }); }
  }
}

// ===== addPreviews =====

function addPreviews(items) {
  if (!configRead('enablePreviews')) return;
  for (const item of items) {
    try {
      if (item.tileRenderer) {
        const watchEndpoint = item.tileRenderer.onSelectCommand;
        if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) continue;
        if (item.tileRenderer?.onFocusCommand?.commandExecutorCommand) continue;
        item.tileRenderer.onFocusCommand = { startInlinePlaybackCommand: { blockAdoption: true, caption: false, delayMs: 3000, durationMs: 40000, muted: false, restartPlaybackBeforeSeconds: 10, resumeVideo: true, playbackEndpoint: watchEndpoint } };
      }
    } catch (_) { }
  }
}

// ===== deArrowify =====

function deArrowify(items) {
  if (!Array.isArray(items)) return;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    if (item.adSlotRenderer) { items.splice(i, 1); continue; }
    if (!item?.tileRenderer) continue;
    if (!configRead('enableDeArrow')) continue;
    const capturedItem = item;
    const videoID = String(capturedItem.tileRenderer.contentId || capturedItem.tileRenderer.onSelectCommand?.watchEndpoint?.videoId || '');
    if (!videoID || videoID.length !== 11) { appendFileOnlyLog('dearrow.skip', { reason: 'no_video_id', contentId: capturedItem.tileRenderer.contentId || null }); continue; }
    _deArrowEnqueue(() =>
      fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`)
        .then(res => { if (!res.ok) return null; return res.json(); })
        .then(data => {
          if (!data) return;
          if (Array.isArray(data.titles) && data.titles.length > 0) {
            try { const mostVoted = data.titles.reduce((max, title) => max.votes > title.votes ? max : title); capturedItem.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title; } catch (_) { }
          }
          if (Array.isArray(data.thumbnails) && data.thumbnails.length > 0 && configRead('enableDeArrowThumbnails')) {
            try {
              const mostVotedThumbnail = data.thumbnails.reduce((max, thumbnail) => max.votes > thumbnail.votes ? max : thumbnail);
              if (mostVotedThumbnail.timestamp !== null && mostVotedThumbnail.timestamp !== undefined) {
                capturedItem.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [{ url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${mostVotedThumbnail.timestamp}`, width: 1280, height: 640 }];
              }
            } catch (_) { }
          }
        })
        .catch(err => appendFileOnlyLog('dearrow.fetch.error', { videoID, msg: String(err?.message || err) }))
    );
  }
}

// ===== hqify =====

function hqify(items) {
  items.forEach((item, index) => {
    try {
      if (!item.tileRenderer) return;
      if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') return;
      if (!configRead('enableHqThumbnails')) return;
      const videoID = item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId;
      if (!videoID) return;
      const existingUrl = item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url;
      if (!existingUrl) return;
      const thumbs = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails;
      thumbs[0] = { url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`, width: 480, height: 360 };
      setTimeout(() => {
        fetch(`https://i.ytimg.com/vi/${videoID}/sddefault.jpg`, { method: 'HEAD' })
          .then(res => { if (res.ok) thumbs[0] = { url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg`, width: 640, height: 480 }; })
          .catch(() => {});
      }, index * 50);
    } catch (_) { }
  });
}

// ===== addLongPress =====

function addLongPress(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    try {
      if (!item?.tileRenderer) continue;
      if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT' && item.tileRenderer.style !== 'TILE_STYLE_YTLR_VERTICAL_LIST') continue;
      if (item.tileRenderer.onLongPressCommand?.showMenuCommand) {
        item.tileRenderer.onLongPressCommand.showMenuCommand?.menu?.menuRenderer?.items?.push(MenuServiceItemRenderer('Add to Queue', { clickTrackingParams: null, playlistEditEndpoint: { customAction: { action: 'ADD_TO_QUEUE', parameters: item } } }));
        continue;
      }
      if (!configRead('enableLongPress')) continue;
      if (!item.tileRenderer?.metadata?.tileMetadataRenderer) continue;
      const subtitle = item.tileRenderer.metadata.tileMetadataRenderer.lines[0].lineRenderer.items[0].lineItemRenderer.text;
      const data = longPressData({ videoId: item.tileRenderer.contentId, thumbnails: item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails, title: item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText, subtitle: subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText, watchEndpointData: item.tileRenderer.onSelectCommand.watchEndpoint, item });
      item.tileRenderer.onLongPressCommand = data;
    } catch (error) { appendFileOnlyLog('addLongPress.item.error', { message: error?.message || String(error) }); }
  }
}

