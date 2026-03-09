import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer, showToast } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';
import {
  appendFileOnlyLog,
  detectAndStorePage,
  detectPageFromResponse,
  detectCurrentPage,
  hideVideo,
  processTileArraysDeep,
  consolidateShelves,
} from './hideWatched.js';

// ===== Local utilities (not exported from hideWatched.js) =====

function collectAllText(node, out = [], seen = new WeakSet(), depth = 0) {
  if (depth > 12) return out;
  if (!node) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) {
    for (const child of node) collectAllText(child, out, seen, depth + 1);
    return out;
  }
  if (typeof node === 'object') {
    if (seen.has(node)) return out;
    seen.add(node);
    if (typeof node.simpleText === 'string') out.push(node.simpleText);
    if (Array.isArray(node.runs)) {
      for (const run of node.runs) if (typeof run?.text === 'string') out.push(run.text);
    }
    for (const key of Object.keys(node)) {
      if (key === 'runs' || key === 'simpleText') continue;
      collectAllText(node[key], out, seen, depth + 1);
    }
  }
  return out;
}

function getItemVideoId(item) {
  return String(
    item?.tileRenderer?.contentId ||
    item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId ||
    item?.tileRenderer?.onSelectCommand?.watchEndpoint?.playlistId ||
    item?.tileRenderer?.onSelectCommand?.reelWatchEndpoint?.videoId ||
    ''
  );
}

// Shared duration parser — handles "M:SS" and "H:MM:SS".
function parseDurationToSeconds(lengthText) {
  const parts = String(lengthText).trim().split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return null;
}

function hasShortsEndpointMarkers(node, depth = 0, seen = new WeakSet()) {
  if (!node || depth > 7) return false;
  if (Array.isArray(node)) {
    return node.some((child) => hasShortsEndpointMarkers(child, depth + 1, seen));
  }
  if (typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);

  for (const [key, value] of Object.entries(node)) {
    if (
      key === 'reelWatchEndpoint' ||
      key === 'shortsLockupViewModel' ||
      key === 'shortsPivotItemRenderer'
    ) {
      return true;
    }
    if (typeof value === 'string') {
      const str = value.toLowerCase();
      if (
        str.includes('/shorts/') ||
        str.includes('web_page_type_shorts') ||
        str.includes('reel_watch') ||
        str.includes('tvhtml5_tile_renderer_type_shorts')
      ) {
        return true;
      }
    }
    if (value && typeof value === 'object' && hasShortsEndpointMarkers(value, depth + 1, seen)) {
      return true;
    }
  }
  return false;
}

// Comprehensive Shorts detection — ported from KrX3D/TizenTube working branch.
// Returns { isShort, reason, title, lengthText, totalSeconds }.
// Handles tileRenderer, videoRenderer, reelItemRenderer, lockupViewModel, and all
// richItemRenderer variants — not just tileRenderer — so it works across all feed types.
function getShortInfo(item, opts = {}) {
  const { pageName = null } = opts;
  if (!item) return { isShort: false, reason: 'no_item', title: 'unknown' };

  const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText
    || item?.videoRenderer?.title?.runs?.[0]?.text
    || item?.videoRenderer?.title?.simpleText
    || item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text
    || 'unknown';

  // reel items are always Shorts
  if (item.reelItemRenderer || item.richItemRenderer?.content?.reelItemRenderer) {
    return { isShort: true, reason: 'reel', title };
  }

  // Resolve the concrete renderer from all known shapes
  const renderer = item.tileRenderer
    || item.videoRenderer
    || item.playlistVideoRenderer
    || item.playlistPanelVideoRenderer
    || item.gridVideoRenderer
    || item.compactVideoRenderer
    || item.richItemRenderer?.content?.videoRenderer
    || item.richItemRenderer?.content?.playlistVideoRenderer
    || item.richItemRenderer?.content?.compactVideoRenderer
    || item.richItemRenderer?.content?.gridVideoRenderer
    || item.richItemRenderer?.content?.videoWithContextRenderer
    || item.richItemRenderer?.content?.lockupViewModel
    || item.lockupViewModel;

  if (!renderer) return { isShort: false, reason: 'no_renderer', title };

  // Explicit Shorts renderer type flag
  if (renderer.tvhtml5ShelfRendererType === 'TVHTML5_TILE_RENDERER_TYPE_SHORTS') {
    return { isShort: true, reason: 'renderer_type', title };
  }

  // reelWatchEndpoint on the select command
  if (renderer.onSelectCommand?.reelWatchEndpoint) {
    return { isShort: true, reason: 'reelWatchEndpoint', title };
  }

  if (hasShortsEndpointMarkers(item) || hasShortsEndpointMarkers(renderer)) {
    return { isShort: true, reason: 'endpoint_marker', title };
  }

  // URL/browse metadata hints (covers converted Shorts rendered as normal videos)
  const allText = collectAllText(item).join(' ').toLowerCase();
  if (/\bshorts?\b/.test(allText)) {
    return { isShort: true, reason: 'shorts_text', title };
  }

  const commandUrl = String(
    renderer?.onSelectCommand?.watchEndpoint?.commandMetadata?.webCommandMetadata?.url
    || renderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
    || item?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
    || ''
  ).toLowerCase();
  if (commandUrl.includes('/shorts/') || commandUrl.includes('shorts')) {
    return { isShort: true, reason: 'shorts_url', title };
  }

  // thumbnailOverlay style flags AND duration text
  let lengthText = null;
  const thumbnailOverlays = renderer.header?.tileHeaderRenderer?.thumbnailOverlays
    || renderer.thumbnailOverlays;
  if (Array.isArray(thumbnailOverlays)) {
    for (const overlay of thumbnailOverlays) {
      const tsr = overlay?.thumbnailOverlayTimeStatusRenderer;
      if (!tsr) continue;
      const style = tsr.style;
      if (style === 'SHORTS' || style === 'SHORTS_TIME_STATUS_STYLE') {
        return { isShort: true, reason: 'overlay_style', title };
      }
      // Capture duration text from this overlay for the seconds check below
      if (!lengthText) lengthText = tsr.text?.simpleText || null;
    }
  }

  // lengthText field (some renderer variants)
  if (!lengthText) {
    lengthText = renderer.lengthText?.simpleText || renderer.lengthText?.runs?.[0]?.text || null;
  }

  // metadata lines — subscription tiles store duration here across multiple line positions
  if (!lengthText) {
    const lines = renderer.metadata?.tileMetadataRenderer?.lines;
    if (Array.isArray(lines)) {
      for (const line of lines) {
        const found = line?.lineRenderer?.items?.find(
          (li) => li.lineItemRenderer?.badge || li.lineItemRenderer?.text?.simpleText
        )?.lineItemRenderer?.text?.simpleText;
        if (found && parseDurationToSeconds(found) !== null) {
          lengthText = found;
          break;
        }
      }
    }
  }

  if (!lengthText) return { isShort: false, reason: 'no_length', title };

  const totalSeconds = parseDurationToSeconds(lengthText);
  if (totalSeconds === null) return { isShort: false, reason: 'length_format_miss', title, lengthText };

  // Converted Shorts in subscriptions can arrive as plain tileRenderer entries with
  // no Shorts/reel endpoint marker. Keep duration fallback narrowly scoped there.
  if (pageName === 'subscriptions' && totalSeconds <= 95) {
    return { isShort: true, reason: 'subscriptions_duration_fallback', title, lengthText, totalSeconds };
  }

  // Do not classify Shorts by duration alone globally.
  return { isShort: false, reason: 'duration_only_not_used', title, lengthText, totalSeconds };
}

// Expose Shorts checker so hideWatched.js deep scan can filter continuation grids too.
window.__ttShortsFilterItem = (item, pageName = null) => getShortInfo(item, { pageName }).isShort;


function collectWatchProgressEntries(node, out = [], depth = 0, seen = new WeakSet()) {
  if (!node || depth > 10) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectWatchProgressEntries(child, out, depth + 1, seen);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);
  const id = node.videoId || node.externalVideoId || node.contentId || null;
  const pctRaw = node.watchProgressPercentage ?? node.percentDurationWatched ?? node.watchedPercent ?? null;
  const pct = Number(pctRaw);
  if (id && Number.isFinite(pct)) {
    out.push({ id: String(id), percent: pct, source: 'deep_scan' });
  }
  for (const key of Object.keys(node)) {
    collectWatchProgressEntries(node[key], out, depth + 1, seen);
  }
  return out;
}

// ===== Normalizers =====

function normalizeHorizontalListRenderer(horizontalListRenderer, context = '') {
  if (!horizontalListRenderer || !Array.isArray(horizontalListRenderer.items)) return;
  const count = horizontalListRenderer.items.length;
  if (typeof horizontalListRenderer.visibleItemCount === 'number') horizontalListRenderer.visibleItemCount = count;
  if (typeof horizontalListRenderer.collapsedItemCount === 'number') horizontalListRenderer.collapsedItemCount = count;
  if (typeof horizontalListRenderer.totalItemCount === 'number') horizontalListRenderer.totalItemCount = count;
  const clamp = (v) => (typeof v !== 'number') ? v : (count <= 0 ? 0 : Math.max(0, Math.min(count - 1, v)));
  if (typeof horizontalListRenderer.selectedIndex === 'number') horizontalListRenderer.selectedIndex = clamp(horizontalListRenderer.selectedIndex);
  if (typeof horizontalListRenderer.focusIndex === 'number') horizontalListRenderer.focusIndex = clamp(horizontalListRenderer.focusIndex);
  if (typeof horizontalListRenderer.currentIndex === 'number') horizontalListRenderer.currentIndex = clamp(horizontalListRenderer.currentIndex);
}

function normalizeGridRenderer(gridRenderer, context = '') {
  if (!gridRenderer || !Array.isArray(gridRenderer.items)) return;
  const count = gridRenderer.items.length;
  if (typeof gridRenderer.visibleItemCount === 'number') gridRenderer.visibleItemCount = count;
  if (typeof gridRenderer.totalItemCount === 'number') gridRenderer.totalItemCount = count;
  if (typeof gridRenderer.currentIndex === 'number') {
    gridRenderer.currentIndex = count <= 0 ? 0 : Math.max(0, Math.min(count - 1, gridRenderer.currentIndex));
  }
}

// ===== Shorts / Shelf Helpers =====

function extractBrowseIdsDeep(node, out = new Set(), depth = 0) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const child of node) extractBrowseIdsDeep(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;
  const browseId = node?.browseEndpoint?.browseId;
  if (typeof browseId === 'string' && browseId) out.add(browseId);
  for (const key of Object.keys(node)) extractBrowseIdsDeep(node[key], out, depth + 1);
  return out;
}

function extractNavTabBrowseId(tab) {
  return Array.from(extractBrowseIdsDeep(tab)).join(',');
}

function isShortsShelf(shelve) {
  const shelfRenderer = shelve?.shelfRenderer;
  if (!shelfRenderer) return !!shelve?.reelShelfRenderer;

  const titleText = [
    String(shelfRenderer?.title?.simpleText || ''),
    collectAllText(shelfRenderer?.header).join(' '),
    collectAllText(shelfRenderer?.headerRenderer).join(' ')
  ].join(' ').toLowerCase();

  const browseIds = Array.from(extractBrowseIdsDeep(shelfRenderer)).map(id => String(id).toLowerCase());
  const hasShortsBrowseId = browseIds.some(id => id.includes('short') || id.includes('reel'));

  return (
    shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS' ||
    titleText.includes('short') ||
    titleText.includes('kurz') ||
    hasShortsBrowseId
  );
}

// ===== Playlist Helper System =====

function getPlaylistHelperVideoIdSet() {
  if (!window.__ttPlaylistHelperVideoIds) window.__ttPlaylistHelperVideoIds = new Set();
  return window.__ttPlaylistHelperVideoIds;
}

function getRetiredPlaylistHelperVideoIdSet() {
  if (!window.__ttRetiredPlaylistHelperVideoIds) window.__ttRetiredPlaylistHelperVideoIds = new Set();
  return window.__ttRetiredPlaylistHelperVideoIds;
}

function attemptPlaylistAutoLoad(reason = 'playlist.auto_load', attempt = 0) {
  if ((window.__ttLastDetectedPage || detectCurrentPage()) !== 'playlist') return;
  const container = document.querySelector('ytlr-playlist-video-list-renderer, ytlr-surface-page, body') || document.body;
  try {
    if (container && typeof container.scrollBy === 'function') {
      container.scrollBy({ top: 900, left: 0, behavior: 'auto' });
    }
  } catch (_) { }

  if (String(reason || '').includes('empty_batch')) {
    const vlist = document.querySelector('ytlr-playlist-video-list-renderer yt-virtual-list, yt-virtual-list.rN5BTd');
    try {
      if (vlist && typeof vlist.scrollBy === 'function') vlist.scrollBy({ top: 1400, left: 0, behavior: 'auto' });
    } catch (_) { }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', code: 'PageDown', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageDown', code: 'PageDown', bubbles: true }));
    } catch (_) { }
  }
  appendFileOnlyLog('playlist.auto_load.trigger', { reason, attempt });
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

  [0, 150, 500, 1000, 1800].forEach((delay, index) => {
    setTimeout(() => attemptPlaylistAutoLoad(reason, index), delay);
  });
}

function showPlaylistAllHiddenNotice(reason = 'playlist.all_hidden') {
  if (typeof document === 'undefined') return;
  const id = 'tt-playlist-empty-notice';
  let notice = document.getElementById(id);
  if (!notice) {
    notice = document.createElement('div');
    notice.id = id;
    Object.assign(notice.style, {
      position: 'fixed', left: '50%', bottom: '4%',
      transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.85)',
      color: '#fff', padding: '12px 16px', borderRadius: '10px',
      zIndex: '999999', fontSize: '18px'
    });
    document.body?.appendChild(notice);
  }
  notice.textContent = 'All videos in this playlist are hidden. Leave playlist to dismiss.';

  const cleanup = () => {
    if (detectCurrentPage() === 'playlist') return;
    document.getElementById(id)?.remove();
    if (window.__ttPlaylistNoticeInterval) {
      clearInterval(window.__ttPlaylistNoticeInterval);
      window.__ttPlaylistNoticeInterval = null;
    }
  };

  if (!window.__ttPlaylistNoticeCleanupBound) {
    window.__ttPlaylistNoticeCleanupBound = true;
    window.addEventListener('hashchange', cleanup);
    window.addEventListener('popstate', cleanup);
  }
  if (!window.__ttPlaylistNoticeInterval) {
    window.__ttPlaylistNoticeInterval = setInterval(cleanup, 500);
  }
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
  const retiredIds = Array.from(getRetiredPlaylistHelperVideoIdSet());
  if (!retiredIds.length) return { scannedTiles: 0, removed: 0, matchedIds: [] };

  const tiles = getPlaylistTileNodes();
  let matchedTiles = 0, removed = 0, skippedUnsafe = 0;
  const removedTiles = new Set(), matchedIds = new Set();

  for (const tile of tiles) {
    const html = String(tile?.outerHTML || '');
    if (!html) continue;
    for (const id of retiredIds) {
      if (!id || !html.includes(id)) continue;
      matchedIds.add(id);
      matchedTiles++;
      try {
        const rowNode = tile.closest('.TXB27d');
        const rowClass = String(rowNode?.className || '');
        const focused = rowClass.includes('lxpVI') || rowClass.includes('zylon-focus') || tile.classList?.contains('zylon-focus');
        if (!isHelperLikePlaylistNode(rowNode, tile) || focused) { skippedUnsafe++; break; }
        if (!removedTiles.has(tile)) { removedTiles.add(tile); tile.remove(); removed++; }
      } catch (_) { }
      break;
    }
  }

  const compactResult = compactPlaylistVirtualRows(`${reason}.tile_scan`);
  if ((matchedTiles > 0 || removed > 0) && detectCurrentPage() === 'playlist') {
    schedulePlaylistAutoLoad(`${reason}.tile_detected`);
  }

  appendFileOnlyLog('playlist.helper.tile_scan', { reason, retiredCount: retiredIds.length, scannedTiles: tiles.length, removed, matchedTiles, skippedUnsafe, matchedIds: Array.from(matchedIds), compactRemovedPlaceholders: compactResult.removedPlaceholders });
  return { scannedTiles: tiles.length, removed, matchedIds: Array.from(matchedIds), matchedTiles };
}

function ensurePlaylistHelperObserver() {
  if (window.__ttPlaylistHelperObserverInstalled) return;
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document?.documentElement) return;

  const observer = new MutationObserver((mutations) => {
    if (detectCurrentPage() !== 'playlist') return;
    if (getRetiredPlaylistHelperVideoIdSet().size === 0) return;
    let added = 0;
    for (const mutation of mutations) added += mutation?.addedNodes?.length || 0;
    const result = removeRetiredHelpersFromTiles('observer.mutation');
    if (added > 0 || result.removed > 0) {
      appendFileOnlyLog('playlist.helper.observer.tick', { added, removed: result.removed, matchedTiles: result.matchedTiles || 0 });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__ttPlaylistHelperObserverInstalled = true;
}

function retirePlaylistHelperVideoId(videoId, label = 'playlist.helper') {
  const id = String(videoId || '').trim();
  if (!id) return;
  getRetiredPlaylistHelperVideoIdSet().add(id);
  ensurePlaylistHelperObserver();
  removeRetiredHelpersFromTiles(`${label}.retire`);
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
  [0, 200, 800, 2000].forEach((delay, index) => {
    setTimeout(() => cleanupPlaylistHelpersFromDom(helperIds, reason, index), delay);
  });
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
  if (pageName === 'playlist' && !hasContinuation) clearPlaylistHelperVideoIdSet(label);
  clearKeepOneMarkers(items, label);
  const filteredItems = hideVideo(items, pageName);

  if (pageName === 'playlist' && hasContinuation && filteredItems.length === 0 && Array.isArray(items) && items.length > 0) {
    const reverseItems = [...items].reverse();
    const fallbackItem =
      reverseItems.find(item => item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.length) ||
      reverseItems.find(item => item?.tileRenderer) ||
      items[items.length - 1];
    if (fallbackItem && typeof fallbackItem === 'object') {
      fallbackItem.__ttKeepOneForContinuation = true;
      fallbackItem.__ttKeepOneForContinuationLabel = `${label}.visible`;
      fallbackItem.__ttKeepOneForContinuationParseSeq = Number(window.__ttParseSeq || 0);
      registerPlaylistHelperVideoId(getItemVideoId(fallbackItem), `${label}.keep-one`);
    }
    return [fallbackItem];
  }

  if (pageName === 'playlist' && !hasContinuation && filteredItems.length === 0) {
    showPlaylistAllHiddenNotice(`${label}.no_continuation_all_hidden`);
  }

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
  if (pageName === 'playlist' && !hasContinuation && playlistRenderer.contents.length === 0) {
    showPlaylistAllHiddenNotice(`${label}.all_hidden_after_filter`);
  }
  appendFileOnlyLog(`${label}.result`, { pageName, hasContinuation, before, after: playlistRenderer.contents.length });
}

// ===== processResponsePayload (for array-root responses) =====

function processResponsePayload(payload, detectedPage) {
  if (!payload || typeof payload !== 'object') return;

  if (payload?.contents?.sectionListRenderer?.contents) {
    processShelves(payload.contents.sectionListRenderer.contents, true, detectedPage);
    consolidateShelves(payload.contents.sectionListRenderer.contents, 'arrayPayload.sectionList', detectedPage);
  }

  if (payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    const contents = payload.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
    processShelves(contents, true, detectedPage);
    consolidateShelves(contents, 'arrayPayload.tvBrowse.sectionList', detectedPage);
  }

  if (payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
    const grid = payload.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer;
    grid.items = hideVideo(grid.items, detectedPage);
    normalizeGridRenderer(grid, 'arrayPayload.contents.tvBrowseRenderer.grid');
  }

  if (payload?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(payload.continuationContents.sectionListContinuation.contents, true, detectedPage);
    consolidateShelves(payload.continuationContents.sectionListContinuation.contents, 'arrayPayload.continuation.sectionList', detectedPage);
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
  if (arrayTopPlaylistRenderer?.contents) {
    filterPlaylistRendererContents(arrayTopPlaylistRenderer, detectedPage, 'arrayPayload.playlist.renderer');
  }

  processTileArraysDeep(payload, detectedPage, 'arrayPayload');
}

// ===== JSON.parse Patch =====

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  try {
    const adBlockEnabled = configRead('enableAdBlock');
    const signinReminderEnabled = configRead('enableSigninReminder');
    const detectedPage = detectPageFromResponse(r) || detectCurrentPage();
    window.__ttLastDetectedPage = detectedPage;
    window.__ttParseSeq = Number(window.__ttParseSeq || 0) + 1;

    appendFileOnlyLog('parse.begin', { detectedPage, hash: location.hash || '' });

    // Array-root responses (some TV endpoints return arrays)
    if (Array.isArray(r)) {
      for (let i = 0; i < r.length; i++) processResponsePayload(r[i], detectedPage);
      return r;
    }

    // === Ads ===
    if (r.adPlacements && adBlockEnabled) r.adPlacements = [];
    if (r.playerAds && adBlockEnabled) r.playerAds = false;
    if (r.adSlots && adBlockEnabled) r.adSlots = [];

    // === Watch progress entity cache ===
    if (r?.frameworkUpdates?.entityBatchUpdate?.mutations) {
      if (!window._ttVideoProgressCache) window._ttVideoProgressCache = {};
      for (const mutation of r.frameworkUpdates.entityBatchUpdate.mutations) {
        const key = String(mutation?.entityKey || '');
        const payload = mutation?.payload || {};
        const pct = payload?.videoAttributionModel?.watchProgressPercentage
          ?? payload?.videoData?.watchProgressPercentage
          ?? payload?.macroMarkersListEntity?.watchProgressPercentage
          ?? null;
        if (pct !== null) {
          const videoId = key.includes('|') ? key.split('|')[0] : key;
          window._ttVideoProgressCache[videoId] = Number(pct);
          const explicitId = payload?.videoAttributionModel?.externalVideoId
            || payload?.videoData?.videoId || null;
          if (explicitId) window._ttVideoProgressCache[String(explicitId)] = Number(pct);
        }
        // Deep scan for any additional progress fields inside the mutation payload
        for (const entry of collectWatchProgressEntries(payload)) {
          if (window._ttVideoProgressCache[entry.id] === undefined) {
            window._ttVideoProgressCache[entry.id] = Number(entry.percent);
          }
        }
      }
    }

    if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) r.paidContentOverlay = null;

    if (r?.streamingData?.adaptiveFormats && configRead('videoPreferredCodec') !== 'any') {
      const preferredCodec = configRead('videoPreferredCodec');
      if (r.streamingData.adaptiveFormats.find(f => f.mimeType.includes(preferredCodec))) {
        r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.filter(f =>
          f.mimeType.startsWith('audio/') || f.mimeType.includes(preferredCodec)
        );
      }
    }

    // === Home screen (tvBrowse sectionList) ===
    if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
      const contents = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
      if (!signinReminderEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          contents.filter(elm => !elm.feedNudgeRenderer);
      }
      if (adBlockEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(elm => !elm.adSlotRenderer);
        for (const shelve of r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
          if (shelve.shelfRenderer) {
            shelve.shelfRenderer.content.horizontalListRenderer.items =
              shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => !item.adSlotRenderer);
          }
        }
      }
      processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents, true, detectedPage);
      consolidateShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents, 'tvBrowse.sectionList', detectedPage);
    }

    if (r.endscreen && configRead('enableHideEndScreenCards')) r.endscreen = null;

    if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
      r.messages = r.messages.filter(msg => !msg?.youThereRenderer);
    }

    if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
      r.entries = r.entries?.filter(elm => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd);
    }

    if (r?.title?.runs) PatchSettings(r);

    // === sectionListRenderer ===
    if (r?.contents?.sectionListRenderer?.contents) {
      processShelves(r.contents.sectionListRenderer.contents, true, detectedPage);
      consolidateShelves(r.contents.sectionListRenderer.contents, 'sectionList', detectedPage);
    }

    // === tvBrowse gridRenderer ===
    if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
      const grid = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer;
      grid.items = hideVideo(grid.items, detectedPage);
      normalizeGridRenderer(grid, 'contents.tvBrowseRenderer.grid');
    }

    // === Playlist renderer (top-level) ===
    const topPlaylistRenderer = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer;
    if (topPlaylistRenderer?.contents) {
      filterPlaylistRendererContents(topPlaylistRenderer, detectedPage, 'playlist.renderer');
    }

    // === sectionListContinuation ===
    if (r?.continuationContents?.sectionListContinuation?.contents) {
      processShelves(r.continuationContents.sectionListContinuation.contents, true, detectedPage);
      consolidateShelves(r.continuationContents.sectionListContinuation.contents, 'continuation.sectionList', detectedPage);
    }

    // === pivotContinuation ===
    if (r?.continuationContents?.pivotContinuation?.contents) {
      appendFileOnlyLog('pivot.continuation.hit', { count: r.continuationContents.pivotContinuation.contents.length });
      processShelves(r.continuationContents.pivotContinuation.contents, false, detectedPage);
      consolidateShelves(r.continuationContents.pivotContinuation.contents, 'continuation.pivot', detectedPage);
    }

    // === horizontalListContinuation ===
    if (r?.continuationContents?.horizontalListContinuation?.items) {
      const continuation = r.continuationContents.horizontalListContinuation;
      deArrowify(continuation.items);
      hqify(continuation.items);
      addLongPress(continuation.items);
      continuation.items = filterContinuationItems(continuation.items, detectedPage, !!continuation?.continuations, 'horizontalListContinuation');
      normalizeHorizontalListRenderer(continuation, 'continuation.horizontal');
    }

    // === gridContinuation ===
    if (r?.continuationContents?.gridContinuation?.items) {
      const gc = r.continuationContents.gridContinuation;
      gc.items = filterContinuationItems(gc.items, detectedPage, !!gc?.continuations, 'gridContinuation');
      normalizeGridRenderer(gc, 'continuation.grid');
    }

    // === playlistVideoListContinuation ===
    if (r?.continuationContents?.playlistVideoListContinuation?.contents) {
      const plc = r.continuationContents.playlistVideoListContinuation;
      const hasContinuation = !!plc?.continuations;
      appendFileOnlyLog('playlist.continuation.detected', { detectedPage, itemCount: Array.isArray(plc.contents) ? plc.contents.length : 0, hasContinuation });
      plc.contents = filterContinuationItems(plc.contents, detectedPage, hasContinuation, 'playlist.continuation');
    }

    // === Tab sections (channel nav, library tabs, etc.) ===
    if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
      for (const section of r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
        if (!Array.isArray(section?.tvSecondaryNavSectionRenderer?.tabs)) continue;

        if (!configRead('enableShorts')) {
          const tabs = section.tvSecondaryNavSectionRenderer.tabs;
          for (let i = tabs.length - 1; i >= 0; i--) {
            const tab = tabs[i];
            const tabTitle = String(
              tab?.tabRenderer?.title?.simpleText || collectAllText(tab?.tabRenderer?.title).join(' ')
            ).toLowerCase();
            const tabBrowseId = String(extractNavTabBrowseId(tab)).toLowerCase();
            if (tabTitle.includes('short') || tabBrowseId.includes('short')) {
              appendFileOnlyLog('shorts.navtab.removed', { tabTitle, tabBrowseId, index: i });
              tabs.splice(i, 1);
            }
          }
        }

        for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
          const tabBrowseId = String(extractNavTabBrowseId(tab)).toLowerCase();
          let tabPage = detectedPage;
          if (tabBrowseId.includes('fesubscription')) tabPage = 'subscriptions';
          else if (tabBrowseId.startsWith('uc')) tabPage = 'channel';
          else if (tabBrowseId === 'fehistory') tabPage = 'history';
          else if (tabBrowseId === 'felibrary') tabPage = 'library';
          else if (tabBrowseId === 'feplaylist_aggregation') tabPage = 'playlists';
          else if (tabBrowseId === 'femy_youtube' || tabBrowseId === 'vlwl' || tabBrowseId === 'vlll' || tabBrowseId.startsWith('vlpl')) tabPage = 'playlist';

          const tabSectionList = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
          if (Array.isArray(tabSectionList)) {
            processShelves(tabSectionList, true, tabPage);
            consolidateShelves(tabSectionList, `tab.${tabBrowseId || 'unknown'}`, tabPage);
          }

          const tabGridItems = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items;
          if (Array.isArray(tabGridItems)) {
            tab.tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = hideVideo(tabGridItems, tabPage);
            normalizeGridRenderer(tab.tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer, 'tab.grid');
          }

          const tabPlaylistRenderer = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.playlistVideoListRenderer;
          if (tabPlaylistRenderer?.contents) {
            filterPlaylistRendererContents(tabPlaylistRenderer, tabPage, 'tab.playlist.renderer');
          }
        }
      }
    }

    // === Watch Next ===
    if (r?.contents?.singleColumnWatchNextResults) {
      appendFileOnlyLog('watchNext.shape', {
        hasPivot: !!r.contents.singleColumnWatchNextResults.pivot,
        keys: Object.keys(r.contents.singleColumnWatchNextResults)
      });
    }

    if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
      if (!signinReminderEnabled) {
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents =
          r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.filter(elm => !elm.alertWithActionsRenderer);
      }
      processShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, false, detectedPage);
      consolidateShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, 'watchNext', detectedPage);
      if (window.queuedVideos.videos.length > 0) {
        const queuedVideosClone = window.queuedVideos.videos.slice();
        queuedVideosClone.unshift(TileRenderer('Clear Queue', { customAction: { action: 'CLEAR_QUEUE' } }));
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(ShelfRenderer(
          'Queued Videos',
          queuedVideosClone,
          queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1
            ? queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId)
            : 0
        ));
      }
    }

    // === SponsorBlock ===
    if (configRead('sponsorBlockManualSkips').length > 0 && r?.playerOverlays?.playerOverlayRenderer) {
      const manualSkippedSegments = configRead('sponsorBlockManualSkips');
      const timelyActions = [];
      if (window?.sponsorblock?.segments) {
        for (const segment of window.sponsorblock.segments) {
          if (manualSkippedSegments.includes(segment.category)) {
            timelyActions.push(timelyAction(
              `Skip ${segment.category}`, 'SKIP_NEXT',
              { clickTrackingParams: null, showEngagementPanelEndpoint: { customAction: { action: 'SKIP', parameters: { time: segment.segment[1] } } } },
              segment.segment[0] * 1000,
              segment.segment[1] * 1000 - segment.segment[0] * 1000
            ));
          }
        }
        r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = timelyActions;
      }
    } else if (r?.playerOverlays?.playerOverlayRenderer) {
      r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = [];
    }

    if (r?.transportControls?.transportControlsRenderer?.promotedActions && configRead('enableSponsorBlockHighlight')) {
      if (window?.sponsorblock?.segments) {
        const category = window.sponsorblock.segments.find(seg => seg.category === 'poi_highlight');
        if (category) {
          r.transportControls.transportControlsRenderer.promotedActions.push({
            type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
            button: { buttonRenderer: ButtonRenderer(false, 'Skip to highlight', 'SKIP_NEXT', { clickTrackingParams: null, customAction: { action: 'SKIP', parameters: { time: category.segment[0] } } }) }
          });
        }
      }
    }

    // === Safety net deep scan (skip watch page to avoid empty visual rows) ===
    if (detectedPage !== 'watch') {
      processTileArraysDeep(r, detectedPage, 'response');
    }

    return r;
  } catch (error) {
    appendFileOnlyLog('parse.error', { msg: String(error), stack: String(error?.stack || '').slice(0, 200) });
    if (!window.__ttAdblockParseWarned) {
      window.__ttAdblockParseWarned = true;
      console.warn('[TizenTube] adblock parser patch failed', error);
    }
    return r;
  }
};

window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}

// ===== processShelves =====

function processShelves(shelves, shouldAddPreviews = true, pageHint = null) {
  if (!Array.isArray(shelves)) return;
  const activePage = pageHint || window.__ttLastDetectedPage || detectCurrentPage();

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];

    if (!configRead('enableShorts') && isShortsShelf(shelve)) {
      shelves.splice(i, 1);
      continue;
    }

    if (!configRead('enableShorts') && !shelve?.shelfRenderer) {
      const allText = collectAllText(shelve).join(' ').toLowerCase();
      if (/\bshorts?\b/i.test(allText)) {
        shelves.splice(i, 1);
        continue;
      }
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
      // Filter Shorts from ALL list types — ported from KrX3D working branch.
      // getShortInfo handles every renderer type (tileRenderer, videoRenderer, reelItemRenderer,
      // lockupViewModel, etc.) and reads duration from overlays, lengthText, and metadata lines.
      const filterShortItems = (items) => {
        if (!Array.isArray(items)) return items;
        const before = items.length;
        const filtered = items.filter(item => {
          const info = getShortInfo(item, { pageName: activePage });
          if (!info.isShort) {
            // Diagnostic: dump renderer shape to understand what we're missing
            const r = item?.tileRenderer || item?.videoRenderer || item?.richItemRenderer?.content?.videoRenderer || null;
            const rendererType = item ? Object.keys(item)[0] : 'none';
            const overlays = r?.header?.tileHeaderRenderer?.thumbnailOverlays || r?.thumbnailOverlays || [];
            const overlayStyles = Array.isArray(overlays)
              ? overlays.map(o => o?.thumbnailOverlayTimeStatusRenderer?.style).filter(Boolean)
              : [];
            const shelfType = r?.tvhtml5ShelfRendererType || null;
            const lines = r?.metadata?.tileMetadataRenderer?.lines;
            const lineTexts = Array.isArray(lines)
              ? lines.flatMap(l => (l?.lineRenderer?.items || []).map(li => li?.lineItemRenderer?.text?.simpleText).filter(Boolean))
              : [];
            appendFileOnlyLog('shorts.miss', {
              reason: info.reason,
              title: info.title,
              rendererType,
              shelfType,
              overlayStyles,
              lengthText: info.lengthText || null,
              lineTexts,
              hasReelCmd: !!(r?.onSelectCommand?.reelWatchEndpoint),
            });
          }
          return !info.isShort;
        });
        if (before !== filtered.length) {
          appendFileOnlyLog('shorts.tiles.filter', { page: activePage, shelf: i, before, after: filtered.length });
        }
        return filtered;
      };
      const base = shelve?.richSectionRenderer?.content || shelve;
      if (Array.isArray(base?.shelfRenderer?.content?.horizontalListRenderer?.items)) {
        base.shelfRenderer.content.horizontalListRenderer.items =
          filterShortItems(base.shelfRenderer.content.horizontalListRenderer.items);
        normalizeHorizontalListRenderer(base.shelfRenderer.content.horizontalListRenderer, `shelf:${activePage}:${i}:shorts`);
      }
      if (Array.isArray(base?.shelfRenderer?.content?.verticalListRenderer?.items)) {
        base.shelfRenderer.content.verticalListRenderer.items =
          filterShortItems(base.shelfRenderer.content.verticalListRenderer.items);
      }
      if (Array.isArray(base?.shelfRenderer?.content?.gridRenderer?.items)) {
        base.shelfRenderer.content.gridRenderer.items =
          filterShortItems(base.shelfRenderer.content.gridRenderer.items);
      }
      if (Array.isArray(base?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items)) {
        base.shelfRenderer.content.expandedShelfContentsRenderer.items =
          filterShortItems(base.shelfRenderer.content.expandedShelfContentsRenderer.items);
      }
      if (Array.isArray(base?.richShelfRenderer?.content?.richGridRenderer?.contents)) {
        base.richShelfRenderer.content.richGridRenderer.contents =
          filterShortItems(base.richShelfRenderer.content.richGridRenderer.contents);
      }
      if (Array.isArray(base?.reelShelfRenderer?.items)) {
        base.reelShelfRenderer.items = filterShortItems(base.reelShelfRenderer.items);
      }
    }

    if (shelve.shelfRenderer.content.horizontalListRenderer.items.length === 0) {
      shelves.splice(i, 1);
    }
  }
}

// ===== addPreviews =====

function addPreviews(items) {
  if (!configRead('enablePreviews')) return;
  for (const item of items) {
    if (item.tileRenderer) {
      const watchEndpoint = item.tileRenderer.onSelectCommand;
      if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) continue;
      item.tileRenderer.onFocusCommand = {
        startInlinePlaybackCommand: {
          blockAdoption: true, caption: false, delayMs: 3000, durationMs: 40000,
          muted: false, restartPlaybackBeforeSeconds: 10, resumeVideo: true,
          playbackEndpoint: watchEndpoint
        }
      };
    }
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
    if (configRead('enableDeArrow')) {
      const capturedItem = item;
      const videoID = capturedItem.tileRenderer.contentId;
      if (!videoID) continue;
      fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`).then(res => res.json()).then(data => {
        if (data.titles.length > 0) {
          const mostVoted = data.titles.reduce((max, title) => max.votes > title.votes ? max : title);
          capturedItem.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title;
        }
        if (data.thumbnails.length > 0 && configRead('enableDeArrowThumbnails')) {
          const mostVotedThumbnail = data.thumbnails.reduce((max, thumbnail) => max.votes > thumbnail.votes ? max : thumbnail);
          if (mostVotedThumbnail.timestamp) {
            capturedItem.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [{
              url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${mostVotedThumbnail.timestamp}`,
              width: 1280, height: 640
            }];
          }
        }
      }).catch(() => { });
    }
  }
}

// ===== hqify =====

function hqify(items) {
  for (const item of items) {
    if (!item.tileRenderer) continue;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;
    if (!configRead('enableHqThumbnails')) continue;
    const videoID = item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId;
    if (!videoID) continue;
    // Guard: some home page tiles have no thumbnail yet (lazy-loaded) — skip rather than crash.
    const existingUrl = item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url;
    if (!existingUrl) continue;
    // Do NOT carry over query args: the original `sqp` param is a signed token tied to the
    // original filename — reusing it on a different filename causes a CDN signature mismatch
    // and YouTube returns the grey "not available" placeholder instead of the real thumbnail.
    // Start with hqdefault (guaranteed for every video), then async-upgrade to
    // sddefault (640x480) if it exists on the CDN. On a TV the JSON parse →
    // layout pipeline is slow enough that the HEAD usually resolves in time.
    const thumbs = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails;
    thumbs[0] = { url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`, width: 480, height: 360 };
    fetch(`https://i.ytimg.com/vi/${videoID}/sddefault.jpg`, { method: 'HEAD' })
      .then(res => { if (res.ok) thumbs[0] = { url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg`, width: 640, height: 480 }; })
      .catch(() => {});
  }
}

// ===== addLongPress =====

function addLongPress(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    try {
      if (!item?.tileRenderer) continue;
      if (
        item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT' &&
        item.tileRenderer.style !== 'TILE_STYLE_YTLR_VERTICAL_LIST'
      ) continue;
      if (item.tileRenderer.onLongPressCommand) {
        item.tileRenderer.onLongPressCommand.showMenuCommand?.menu?.menuRenderer?.items?.push(MenuServiceItemRenderer('Add to Queue', {
          clickTrackingParams: null,
          playlistEditEndpoint: { customAction: { action: 'ADD_TO_QUEUE', parameters: item } }
        }));
        continue;
      }
      if (!configRead('enableLongPress')) continue;
      const subtitle = item.tileRenderer.metadata.tileMetadataRenderer.lines[0].lineRenderer.items[0].lineItemRenderer.text;
      const data = longPressData({
        videoId: item.tileRenderer.contentId,
        thumbnails: item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails,
        title: item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText,
        subtitle: subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText,
        watchEndpointData: item.tileRenderer.onSelectCommand.watchEndpoint,
        item
      });
      item.tileRenderer.onLongPressCommand = data;
    } catch (error) {
      appendFileOnlyLog('addLongPress.item.error', { message: error?.message || String(error) });
    }
  }
}
