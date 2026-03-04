import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';


function appendFileOnlyLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;

  const activePage = window.__ttLastDetectedPage || detectCurrentPage();
  const labelStr = String(label || '');
  const isPlaylistPage = activePage === 'playlist' || activePage === 'playlists';
  const isPlaylistLog = labelStr.startsWith('playlist.') || labelStr.startsWith('hideVideo.') || labelStr.startsWith('json.parse.meta') || labelStr.startsWith('page-detect');
  if (!isPlaylistPage && !isPlaylistLog) return;

  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];

  const stamp = new Date().toISOString();
  let message = '';
  if (typeof payload === 'string') message = payload;
  else {
    try { message = JSON.stringify(payload); } catch (_) { message = String(payload); }
  }

  window.__ttFileOnlyLogs.push(`[${stamp}] [TT_ADBLOCK_FILE] ${label} ${message}`);
  if (window.__ttFileOnlyLogs.length > 5000) window.__ttFileOnlyLogs.shift();
}

function appendFileOnlyLogOnce(key, payload) {
  if (!configRead('enableDebugLogging')) return;
  if (!window._ttFileDebugOnce) window._ttFileDebugOnce = new Map();

  let serialized = '';
  try { serialized = JSON.stringify(payload); } catch (_) { serialized = String(payload); }

  if (window._ttFileDebugOnce.get(key) === serialized) return;
  window._ttFileDebugOnce.set(key, serialized);
  appendFileOnlyLog(key, serialized);
}

function detectCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const cParam = (hash.match(/[?&]c=([^&]+)/i)?.[1] || '').toLowerCase();
  let pageName = 'home';

  if (hash.startsWith('/watch')) pageName = 'watch';
  else if (cParam.includes('fesubscription')) pageName = 'subscriptions';
  else if (cParam === 'fehistory') pageName = 'history';
  else if (cParam === 'felibrary') pageName = 'library';
  else if (cParam === 'feplaylist_aggregation') pageName = 'playlists';
  else if (cParam === 'femy_youtube' || cParam === 'vlwl' || cParam === 'vlll' || cParam.startsWith('vlpl')) pageName = 'playlist';
  else {
    try {
      pageName = hash === '/'
        ? 'home'
        : hash.startsWith('/search')
          ? 'search'
          : (hash.split('?')[1]?.split('&')[0]?.split('=')[1] || 'home').replace('FE', '').replace('topics_', '');
    } catch (_) {
      pageName = 'home';
    }
  }

  appendFileOnlyLogOnce(`page-detect:${pageName}`, {
    hash,
    cParam,
    pathname: location.pathname || '',
    search: location.search || '',
    pageName
  });

  return pageName;
}

function normalizeBrowseIdToPage(rawBrowseId = '') {
  const browseId = String(rawBrowseId || '').toLowerCase();
  if (!browseId) return null;
  if (browseId.includes('fesubscription')) return 'subscriptions';
  if (browseId.startsWith('uc')) return 'channel';
  if (browseId === 'fehistory') return 'history';
  if (browseId === 'felibrary') return 'library';
  if (browseId === 'feplaylist_aggregation') return 'playlists';
  if (browseId === 'femy_youtube' || browseId === 'vlwl' || browseId === 'vlll' || browseId.startsWith('vlpl')) return 'playlist';
  return null;
}

function detectPageFromResponse(response) {
  if (response?.contents?.singleColumnWatchNextResults || response?.playerOverlays || response?.videoDetails) {
    return 'watch';
  }

  const serviceParams = response?.responseContext?.serviceTrackingParams || [];
  for (const entry of serviceParams) {
    for (const param of (entry?.params || [])) {
      if (param?.key === 'browse_id') {
        const detected = normalizeBrowseIdToPage(param?.value);
        if (detected) return detected;
      }
    }
  }

  const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '');
  if (targetId.startsWith('browse-feed')) {
    const detected = normalizeBrowseIdToPage(targetId.replace('browse-feed', ''));
    if (detected) return detected;
  }

  return null;
}

function getActivePage() {
  return window.__ttLastDetectedPage || detectCurrentPage();
}

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

function collectAllText(node, out = [], seen = new WeakSet(), depth = 0) {
  if (depth > 12) return out;
  if (!node) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
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

function parseDurationToSeconds(text) {
  if (!text) return null;
  const m = String(text).match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (!m) return null;
  const parts = m[1].split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}


function getItemTitle(item) {
  return item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText
    || item?.tileRenderer?.contentId
    || 'unknown';
}

const HIDDEN_LIBRARY_TAB_IDS = new Set(['femusic_last_played', 'festorefront', 'fecollection_podcasts', 'femy_videos']);

function getConfiguredHiddenLibraryTabIds() {
  const configured = configRead('hiddenLibraryTabIds');
  if (!Array.isArray(configured) || configured.length === 0) return HIDDEN_LIBRARY_TAB_IDS;
  return new Set(configured.map((id) => String(id || '').toLowerCase()).filter(Boolean));
}

function isHiddenLibraryBrowseId(value) {
  const id = String(value || '').toLowerCase();
  if (!id) return false;

  for (const hiddenId of getConfiguredHiddenLibraryTabIds()) {
    if (id === hiddenId || id.includes(hiddenId)) return true;
  }
  return false;
}

function filterHiddenLibraryTabs(items, context = '') {
  if (!Array.isArray(items)) return items;
  const before = items.length;
  const filtered = items.filter((item) => {
    const contentId = String(item?.tileRenderer?.contentId || '').toLowerCase();
    return !isHiddenLibraryBrowseId(contentId);
  });

  if (before !== filtered.length) {
    appendFileOnlyLog('library.tabs.filter', {
      context,
      before,
      after: filtered.length,
      removed: before - filtered.length
    });
  }

  return filtered;
}



function pruneLibraryTabsInResponse(node, path = 'root') {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    const before = node.length;
    for (let i = node.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(node[i])).map((v) => String(v).toLowerCase());
      if (browseIds.some((id) => isHiddenLibraryBrowseId(id))) {
        appendFileOnlyLog('library.array.pruned', { path, index: i, browseIds });
        node.splice(i, 1);
      }
    }
    if (before !== node.length) {
      appendFileOnlyLog('library.array.pruned.summary', { path, before, after: node.length, removed: before - node.length });
    }
    for (let i = 0; i < node.length; i++) {
      pruneLibraryTabsInResponse(node[i], `${path}[${i}]`);
    }
    return;
  }

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = filterHiddenLibraryTabs(node.horizontalListRenderer.items, `${path}.horizontalListRenderer.items`);
  }

  for (const key of Object.keys(node)) {
    pruneLibraryTabsInResponse(node[key], `${path}.${key}`);
  }
}

// FIX (Bug 4): Broaden browseId extraction to cover all known TV nav tab endpoint paths,
// including navigationEndpoint which YouTube TV uses most commonly.
function extractBrowseIdsDeep(node, out = new Set(), depth = 0) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const child of node) extractBrowseIdsDeep(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  const browseId = node?.browseEndpoint?.browseId;
  if (typeof browseId === 'string' && browseId) out.add(browseId);

  for (const key of Object.keys(node)) {
    extractBrowseIdsDeep(node[key], out, depth + 1);
  }
  return out;
}

function extractNavTabBrowseId(tab) {
  return Array.from(extractBrowseIdsDeep(tab)).join(',');
}

function filterLibraryNavTabs(sections, detectedPage) {
  if (detectedPage !== 'library') return;
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    const tabs = section?.tvSecondaryNavSectionRenderer?.tabs;
    if (!Array.isArray(tabs)) continue;
    const before = tabs.length;
    for (let i = tabs.length - 1; i >= 0; i--) {
      const browseIds = Array.from(extractBrowseIdsDeep(tabs[i])).map((id) => String(id).toLowerCase());
      appendFileOnlyLog('library.navtab.check', { browseIds, index: i });
      if (browseIds.some((id) => isHiddenLibraryBrowseId(id))) {
        appendFileOnlyLog('library.navtab.removed', { browseIds, index: i });
        tabs.splice(i, 1);
      }
    }
    if (tabs.length !== before)
      appendFileOnlyLog('library.navtabs.result', { before, after: tabs.length });
  }
}

function isShortsShelf(shelve) {
  const shelfRenderer = shelve?.shelfRenderer;
  if (!shelfRenderer) return !!shelve?.reelShelfRenderer;

  const titleText = [
    String(shelfRenderer?.title?.simpleText || ''),
    collectAllText(shelfRenderer?.header).join(' '),
    collectAllText(shelfRenderer?.headerRenderer).join(' ')
  ].join(' ').toLowerCase();

  const browseIds = Array.from(extractBrowseIdsDeep(shelfRenderer)).map((id) => String(id).toLowerCase());
  const hasShortsBrowseId = browseIds.some((id) => id.includes('short') || id.includes('reel'));

  return (
    shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS' ||
    titleText.includes('short') ||
    titleText.includes('kurz') ||
    hasShortsBrowseId
  );
}

function getShelfItems(shelve) {
  return shelve?.shelfRenderer?.content?.horizontalListRenderer?.items || null;
}

function normalizeHorizontalListRenderer(horizontalListRenderer, context = '') {
  if (!horizontalListRenderer || !Array.isArray(horizontalListRenderer.items)) return;
  const count = horizontalListRenderer.items.length;

  const before = {
    visibleItemCount: horizontalListRenderer.visibleItemCount,
    collapsedItemCount: horizontalListRenderer.collapsedItemCount,
    totalItemCount: horizontalListRenderer.totalItemCount
  };

  if (typeof horizontalListRenderer.visibleItemCount === 'number') {
    horizontalListRenderer.visibleItemCount = count;
  }
  if (typeof horizontalListRenderer.collapsedItemCount === 'number') {
    horizontalListRenderer.collapsedItemCount = count;
  }
  if (typeof horizontalListRenderer.totalItemCount === 'number') {
    horizontalListRenderer.totalItemCount = count;
  }

  const after = {
    visibleItemCount: horizontalListRenderer.visibleItemCount,
    collapsedItemCount: horizontalListRenderer.collapsedItemCount,
    totalItemCount: horizontalListRenderer.totalItemCount,
    selectedIndex: horizontalListRenderer.selectedIndex,
    focusIndex: horizontalListRenderer.focusIndex,
    currentIndex: horizontalListRenderer.currentIndex
  };

  const clamp = (value) => {
    if (typeof value !== 'number') return value;
    if (count <= 0) return 0;
    return Math.max(0, Math.min(count - 1, value));
  };

  if (typeof horizontalListRenderer.selectedIndex === 'number') {
    horizontalListRenderer.selectedIndex = clamp(horizontalListRenderer.selectedIndex);
  }
  if (typeof horizontalListRenderer.focusIndex === 'number') {
    horizontalListRenderer.focusIndex = clamp(horizontalListRenderer.focusIndex);
  }
  if (typeof horizontalListRenderer.currentIndex === 'number') {
    horizontalListRenderer.currentIndex = clamp(horizontalListRenderer.currentIndex);
  }

  appendFileOnlyLogOnce(`list.normalize.${context}`.substring(0, 48), {
    context,
    count,
    before,
    after
  });
}

function normalizeGridRenderer(gridRenderer, context = '') {
  if (!gridRenderer || !Array.isArray(gridRenderer.items)) return;
  const count = gridRenderer.items.length;

  const before = {
    visibleItemCount: gridRenderer.visibleItemCount,
    totalItemCount: gridRenderer.totalItemCount,
    currentIndex: gridRenderer.currentIndex
  };

  if (typeof gridRenderer.visibleItemCount === 'number') gridRenderer.visibleItemCount = count;
  if (typeof gridRenderer.totalItemCount === 'number') gridRenderer.totalItemCount = count;
  if (typeof gridRenderer.currentIndex === 'number') {
    gridRenderer.currentIndex = count <= 0 ? 0 : Math.max(0, Math.min(count - 1, gridRenderer.currentIndex));
  }

  const after = {
    visibleItemCount: gridRenderer.visibleItemCount,
    totalItemCount: gridRenderer.totalItemCount,
    currentIndex: gridRenderer.currentIndex
  };

  appendFileOnlyLogOnce(`grid.normalize.${context}`.substring(0, 48), {
    context,
    count,
    before,
    after
  });
}


function getPlaylistHelperVideoIdSet() {
  if (!window.__ttPlaylistHelperVideoIds) window.__ttPlaylistHelperVideoIds = new Set();
  return window.__ttPlaylistHelperVideoIds;
}

function getRetiredPlaylistHelperVideoIdSet() {
  if (!window.__ttRetiredPlaylistHelperVideoIds) window.__ttRetiredPlaylistHelperVideoIds = new Set();
  return window.__ttRetiredPlaylistHelperVideoIds;
}

function attemptPlaylistAutoLoad(reason = 'playlist.auto_load', attempt = 0) {
  if (getActivePage() !== 'playlist') return;

  const containers = Array.from(document.querySelectorAll('ytlr-surface-page, ytlr-grid-renderer, ytlr-player, body'));
  for (const container of containers) {
    try {
      if (container && typeof container.scrollBy === 'function') {
        container.scrollBy({ top: 2000, left: 0, behavior: 'auto' });
      }
    } catch (_) {
      // ignore scroll failures
    }
  }

  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
  } catch (_) {
    // ignore keyboard simulation failures
  }

  appendFileOnlyLog('playlist.auto_load.trigger', { reason, attempt, page: getActivePage() });
}

function schedulePlaylistAutoLoad(reason = 'playlist.auto_load') {
  const delays = [0, 150, 500, 1000, 1800];
  delays.forEach((delay, index) => {
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
    notice.style.position = 'fixed';
    notice.style.left = '50%';
    notice.style.bottom = '4%';
    notice.style.transform = 'translateX(-50%)';
    notice.style.background = 'rgba(0,0,0,0.85)';
    notice.style.color = '#fff';
    notice.style.padding = '12px 16px';
    notice.style.borderRadius = '10px';
    notice.style.zIndex = '999999';
    notice.style.fontSize = '18px';
    document.body?.appendChild(notice);
  }
  notice.textContent = 'All videos in this playlist are hidden. Leave playlist to dismiss.';

  const cleanupNoticeIfNeeded = () => {
    const currentPage = detectCurrentPage();
    if (currentPage === 'playlist') return;
    const n = document.getElementById(id);
    if (n) n.remove();
    if (window.__ttPlaylistNoticeInterval) {
      clearInterval(window.__ttPlaylistNoticeInterval);
      window.__ttPlaylistNoticeInterval = null;
    }
  };

  if (!window.__ttPlaylistNoticeCleanupBound) {
    window.__ttPlaylistNoticeCleanupBound = true;
    window.addEventListener('hashchange', cleanupNoticeIfNeeded);
    window.addEventListener('popstate', cleanupNoticeIfNeeded);
  }
  if (!window.__ttPlaylistNoticeInterval) {
    window.__ttPlaylistNoticeInterval = setInterval(cleanupNoticeIfNeeded, 500);
  }

  appendFileOnlyLog('playlist.all_hidden.notice', { reason, page: detectCurrentPage() });
}


function retirePlaylistHelperVideoId(videoId, label = 'playlist.helper') {
  const id = String(videoId || '').trim();
  if (!id) return;
  const retired = getRetiredPlaylistHelperVideoIdSet();
  retired.add(id);
  ensurePlaylistHelperObserver();
  removeRetiredHelpersFromTiles(`${label}.retire`);
  appendFileOnlyLog(`${label}.retire`, { videoId: id, totalRetired: retired.size });
}


function getPlaylistTileNodes() {
  if (typeof document === 'undefined' || !document?.querySelectorAll) return [];
  return Array.from(document.querySelectorAll('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer'));
}

function removeRetiredHelpersFromTiles(reason = 'playlist.helper.tile_scan') {
  const retiredIds = Array.from(getRetiredPlaylistHelperVideoIdSet());
  if (!retiredIds.length) return { scannedTiles: 0, removed: 0, matchedIds: [] };

  const tiles = getPlaylistTileNodes();
  let removed = 0;
  const matchedIds = new Set();

  for (const tile of tiles) {
    const html = String(tile?.outerHTML || '');
    if (!html) continue;
    for (const id of retiredIds) {
      if (!id || !html.includes(id)) continue;
      matchedIds.add(id);
      try {
        tile.remove();
        removed++;
      } catch (_) {
        // ignore
      }
      break;
    }
  }

  if (removed > 0 && getActivePage() === 'playlist') schedulePlaylistAutoLoad(`${reason}.tile_removed`);

  appendFileOnlyLog('playlist.helper.tile_scan', {
    reason,
    retiredCount: retiredIds.length,
    scannedTiles: tiles.length,
    removed,
    matchedIds: Array.from(matchedIds)
  });

  return { scannedTiles: tiles.length, removed, matchedIds: Array.from(matchedIds) };
}

function ensurePlaylistHelperObserver() {
  if (window.__ttPlaylistHelperObserverInstalled) return;
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document?.documentElement) return;

  const observer = new MutationObserver((mutations) => {
    if (getActivePage() !== 'playlist') return;
    const retiredCount = getRetiredPlaylistHelperVideoIdSet().size;
    if (retiredCount === 0) return;

    let added = 0;
    for (const mutation of mutations) {
      added += mutation?.addedNodes?.length || 0;
    }

    const result = removeRetiredHelpersFromTiles('observer.mutation');
    if (added > 0 || result.removed > 0) {
      appendFileOnlyLog('playlist.helper.observer.tick', {
        added,
        retiredCount,
        removed: result.removed,
        scannedTiles: result.scannedTiles
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__ttPlaylistHelperObserverInstalled = true;
  window.__ttPlaylistHelperObserver = observer;
  appendFileOnlyLog('playlist.helper.observer.installed', { page: getActivePage() });
}

function logPlaylistDomSnapshot(reason = 'playlist.dom.snapshot', attempt = -1) {
  if (!configRead('enableDebugLogging')) return;
  if (typeof document === 'undefined') return;

  const root = document.querySelector('ytlr-player, ytlr-app, body');
  const html = String(root?.outerHTML || '');
  const chunkSize = 100000;
  const totalChunks = Math.max(1, Math.ceil(html.length / chunkSize));

  appendFileOnlyLog('playlist.helper.dom.snapshot.meta', {
    reason,
    attempt,
    length: html.length,
    rootTag: root?.tagName || 'none',
    activePage: getActivePage(),
    totalChunks
  });

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = start + chunkSize;
    appendFileOnlyLog(`playlist.helper.dom.snapshot.html.${i + 1}/${totalChunks}`, html.slice(start, end));
  }
}

function cleanupPlaylistHelpersFromDom(helperIds, reason = 'playlist.helper.cleanup', attempt = 0) {
  if (!Array.isArray(helperIds) || helperIds.length === 0) return { matched: 0, removed: 0 };
  if (typeof document === 'undefined' || !document?.querySelectorAll) return { matched: 0, removed: 0 };

  const seenContainers = new Set();
  let matched = 0;
  let removed = 0;
  let skippedUnsafe = 0;

  const isNodeMatchingVideoId = (node, id) => {
    if (!node || !id) return false;
    const attrCandidates = [
      node.getAttribute?.('data-video-id'),
      node.getAttribute?.('video-id'),
      node.getAttribute?.('data-content-id'),
      node.getAttribute?.('content-id')
    ].map((v) => String(v || '').trim());
    if (attrCandidates.includes(id)) return true;

    const href = String(node.getAttribute?.('href') || '').trim();
    if (!href) return false;
    return (
      href.includes(`v=${id}`) ||
      href.includes(`/watch/${id}`) ||
      href.includes(`/watch?v=${id}`)
    );
  };

  const tryRemoveNode = (node, id) => {
    const tileContainer = node?.closest?.('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer');
    const container = tileContainer || node;
    if (!container || container === document.body || container === document.documentElement) return;
    if (seenContainers.has(container)) return;

    const nestedTiles = container.querySelectorAll?.('ytlr-tile-renderer, ytlr-grid-tile, ytlr-rich-item-renderer')?.length || 0;
    const selfIsTile = /YTLR-(TILE-RENDERER|GRID-TILE|RICH-ITEM-RENDERER)/.test(container.tagName || '');
    if (!selfIsTile && nestedTiles > 1) {
      skippedUnsafe++;
      return;
    }

    if (!isNodeMatchingVideoId(node, id) && !isNodeMatchingVideoId(container, id)) {
      skippedUnsafe++;
      return;
    }

    seenContainers.add(container);
    if (container?.remove) {
      try {
        container.remove();
        removed++;
      } catch (_) {
        // ignore DOM remove failures
      }
    }
  };

  for (const rawId of helperIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;

    const selectors = [
      `[data-video-id="${id}"]`,
      `[video-id="${id}"]`,
      `[data-content-id="${id}"]`,
      `[content-id="${id}"]`,
      `a[href*="v=${id}"]`,
      `a[href*="/watch?v=${id}"]`
    ];

    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      if (!nodes.length) continue;
      matched += nodes.length;
      for (const node of nodes) tryRemoveNode(node, id);
    }
  }

  const tileScanResult = removeRetiredHelpersFromTiles(`${reason}.cleanup_attempt_${attempt}`);
  removed += Number(tileScanResult.removed || 0);

  appendFileOnlyLog('playlist.helper.dom.cleanup', {
    reason,
    helperIds,
    attempt,
    matched,
    removed,
    skippedUnsafe,
    tileScanRemoved: tileScanResult.removed,
    tileScanMatchedIds: tileScanResult.matchedIds,
    page: getActivePage()
  });

  if (attempt >= 3 && matched === 0 && removed === 0 && getActivePage() === 'playlist') {
    logPlaylistDomSnapshot(reason, attempt);
  }

  return { matched, removed };
}

function schedulePlaylistHelperDomCleanup(helperIds, reason = 'playlist.helper.cleanup') {
  if (!Array.isArray(helperIds) || helperIds.length === 0) return;
  const delays = [0, 200, 800, 2000];
  delays.forEach((delay, index) => {
    setTimeout(() => cleanupPlaylistHelpersFromDom(helperIds, reason, index), delay);
  });
}

function registerPlaylistHelperVideoId(videoId, label = 'playlist.helper') {
  const id = String(videoId || '').trim();
  if (!id) return;
  const set = getPlaylistHelperVideoIdSet();
  const staleIds = Array.from(set).filter((knownId) => knownId !== id);
  if (staleIds.length > 0) {
    schedulePlaylistHelperDomCleanup(staleIds, `${label}.register.stale`);
    for (const staleId of staleIds) unregisterPlaylistHelperVideoId(staleId, `${label}.register.stale`);
  }
  set.add(id);
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
  const cleared = helperIds.length;
  if (cleared > 0) {
    schedulePlaylistHelperDomCleanup(helperIds, `${label}.registry.cleared`);
    for (const helperId of helperIds) retirePlaylistHelperVideoId(helperId, `${label}.registry`);
    set.clear();
    appendFileOnlyLog(`${label}.registry.cleared`, { cleared, helperIds });
  }
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
  if (cleared > 0) {
    appendFileOnlyLog(`${label}.keep-one.cleared`, { cleared });
  }
  return cleared;
}

function filterContinuationItems(items, pageName, hasContinuation = false, label = 'continuation') {
  if (pageName === 'playlist' && !hasContinuation) {
    clearPlaylistHelperVideoIdSet(label);
  }
  clearKeepOneMarkers(items, label);
  const filteredItems = hideVideo(items, pageName);
  const allowKeepOneFallback = hasContinuation && pageName === 'playlist';
  if (allowKeepOneFallback && filteredItems.length === 0 && Array.isArray(items) && items.length > 0) {
    const reverseItems = [...items].reverse();
    const fallbackItem =
      reverseItems.find((item) => item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.length) ||
      reverseItems.find((item) => item?.tileRenderer) ||
      items[items.length - 1];

    const fallbackType = fallbackItem && typeof fallbackItem === 'object'
      ? Object.keys(fallbackItem).slice(0, 4)
      : typeof fallbackItem;

    appendFileOnlyLog(`${label}.keep-one`, {
      pageName,
      originalCount: items.length,
      fallbackType
    });
    if (fallbackItem && typeof fallbackItem === 'object') {
      fallbackItem.__ttKeepOneForContinuation = true;
      fallbackItem.__ttKeepOneForContinuationLabel = label;
      fallbackItem.__ttKeepOneForContinuationParseSeq = Number(window.__ttParseSeq || 0);
      const helperVideoId = getItemVideoId(fallbackItem);
      registerPlaylistHelperVideoId(helperVideoId, label);
      appendFileOnlyLog(`${label}.keep-one.marked`, {
        pageName,
        parseSeq: fallbackItem.__ttKeepOneForContinuationParseSeq,
        helperVideoId
      });
    }
    schedulePlaylistAutoLoad(`${label}.keep-one`);
    return [fallbackItem];
  }

  if (pageName === 'playlist' && !hasContinuation && filteredItems.length === 0) {
    showPlaylistAllHiddenNotice(`${label}.no_continuation_all_hidden`);
  }

  if (hasContinuation && filteredItems.length === 0 && pageName !== 'playlist') {
    appendFileOnlyLog(`${label}.no_keep_one`, { pageName, reason: 'disabled_for_page' });
  }

  return filteredItems;
}


function filterPlaylistRendererContents(playlistRenderer, pageName, label = 'playlist.renderer') {
  if (!playlistRenderer || !Array.isArray(playlistRenderer.contents)) return;
  const hasContinuation = !!playlistRenderer?.continuations;
  const before = playlistRenderer.contents.length;
  playlistRenderer.contents = filterContinuationItems(
    playlistRenderer.contents,
    pageName,
    hasContinuation,
    label
  );
  if (pageName === 'playlist' && !hasContinuation && playlistRenderer.contents.length === 0) {
    showPlaylistAllHiddenNotice(`${label}.all_hidden_after_filter`);
  }
  appendFileOnlyLog(`${label}.result`, {
    pageName,
    hasContinuation,
    before,
    after: playlistRenderer.contents.length
  });
}

function isLikelyShortItem(item) {
  const tile = item?.tileRenderer;
  if (!tile) return false;
  if (tile?.tvhtml5ShelfRendererType === 'TVHTML5_TILE_RENDERER_TYPE_SHORTS') return true;

  // Shorts tiles use reelWatchEndpoint instead of watchEndpoint — this is the most reliable signal.
  if (tile?.onSelectCommand?.reelWatchEndpoint) return true;

  const title = String(getItemTitle(item) || '').toLowerCase();
  if (title.includes('#shorts')) return true;
  
  // Videos with 2+ hashtags are almost always repurposed Shorts
  const hashtagMatches = title.match(/#[a-z0-9_]+/gi);
  if (hashtagMatches && hashtagMatches.length >= 2) {
    appendFileOnlyLog('shorts.hashtag.detected', { title, count: hashtagMatches.length });
    return true;
  }

  const allText = collectAllText(tile);
  const durationCandidate = allText.map(parseDurationToSeconds).find((v) => Number.isFinite(v));
  if (Number.isFinite(durationCandidate) && durationCandidate > 0 && durationCandidate <= 180) return true;

  return false;
}

function processResponsePayload(payload, detectedPage) {
  if (!payload || typeof payload !== 'object') return;

  if (payload?.contents?.sectionListRenderer?.contents) {
    processShelves(payload.contents.sectionListRenderer.contents, true, detectedPage);
  }

  if (payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    processShelves(payload.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents, true, detectedPage);
  }

  if (payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
    const grid = payload.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer;
    grid.items = hideVideo(grid.items, detectedPage);
    normalizeGridRenderer(grid, 'arrayPayload.contents.tvBrowseRenderer.grid');
  }

  if (payload?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(payload.continuationContents.sectionListContinuation.contents, true, detectedPage);
  }

  if (payload?.continuationContents?.horizontalListContinuation?.items) {
    const continuation = payload.continuationContents.horizontalListContinuation;
    deArrowify(continuation.items);
    hqify(continuation.items);
    addLongPress(continuation.items);
    continuation.items = filterContinuationItems(
      continuation.items,
      detectedPage,
      !!continuation?.continuations,
      'arrayPayload.horizontalListContinuation'
    );
    normalizeHorizontalListRenderer(continuation, 'arrayPayload.continuation.horizontal');
  }

  if (payload?.continuationContents?.gridContinuation?.items) {
    const gc = payload.continuationContents.gridContinuation;
    gc.items = filterContinuationItems(
      gc.items,
      detectedPage,
      !!gc?.continuations,
      'arrayPayload.gridContinuation'
    );
    normalizeGridRenderer(gc, 'arrayPayload.continuation.grid');
  }

  if (payload?.continuationContents?.playlistVideoListContinuation?.contents) {
    const plc = payload.continuationContents.playlistVideoListContinuation;
    plc.contents = filterContinuationItems(
      plc.contents,
      detectedPage,
      !!plc?.continuations,
      'arrayPayload.playlist.continuation'
    );
  }

  const arrayTopPlaylistRenderer = payload?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer;
  if (arrayTopPlaylistRenderer?.contents) {
    filterPlaylistRendererContents(arrayTopPlaylistRenderer, detectedPage, 'arrayPayload.playlist.renderer');
  }

  if (payload?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    filterLibraryNavTabs(payload.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, detectedPage);
  }

  if (detectedPage === 'library') {
    pruneLibraryTabsInResponse(payload, 'arrayPayload');
  }

  processTileArraysDeep(payload, detectedPage, 'arrayPayload');
}

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/3497eebd440f4871830b9b45af0afc406c6eb593/filters/filters.txt#L116
 *
 * This in turn calls the following snippet:
 * https://github.com/gorhill/uBlock/blob/bfdc81e9e400f7b78b2abc97576c3d7bf3a11a0b/assets/resources/scriptlets.js#L365-L470
 *
 * Seems like for now dropping just the adPlacements is enough for YouTube TV
 */
const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  try {
  const adBlockEnabled = configRead('enableAdBlock');

  const detectedPage = detectPageFromResponse(r) || detectCurrentPage();
  window.__ttLastDetectedPage = detectedPage;
  window.__ttParseSeq = Number(window.__ttParseSeq || 0) + 1;
  const parseSeq = window.__ttParseSeq;
  appendFileOnlyLog('json.parse.meta', {
    hash: location.hash || '',
    path: location.pathname || '',
    search: location.search || '',
    detectedPage,
    parseSeq,
    rootType: Array.isArray(r) ? 'array' : typeof r,
    rootKeys: r && typeof r === 'object' ? Object.keys(r).slice(0, 40) : []
  });
  appendFileOnlyLog('json.parse.full', r);
  const signinReminderEnabled = configRead('enableSigninReminder');

  if (Array.isArray(r)) {
    appendFileOnlyLog('json.parse.array.root', { detectedPage, length: r.length });
    for (let i = 0; i < r.length; i++) {
      processResponsePayload(r[i], detectedPage);
    }
    return r;
  }

  if (r.adPlacements && adBlockEnabled) {
    r.adPlacements = [];
  }

  // Also set playerAds to false, just incase.
  if (r.playerAds && adBlockEnabled) {
    r.playerAds = false;
  }

  // Also set adSlots to an empty array, emptying only the adPlacements won't work.
  if (r.adSlots && adBlockEnabled) {
    r.adSlots = [];
  }

  // NEW: build watch-progress cache from entity mutations.
  // Subscription/channel/playlist tiles often do not include resume overlays in tile JSON.
  // YouTube frequently sends watch progress in frameworkUpdates mutations only.
  if (r?.frameworkUpdates?.entityBatchUpdate?.mutations) {
    if (!window._ttVideoProgressCache) window._ttVideoProgressCache = {};
    let directHits = 0;
    let deepHits = 0;
    for (const mutation of r.frameworkUpdates.entityBatchUpdate.mutations) {
      const key = String(mutation?.entityKey || '');
      const payload = mutation?.payload || {};
      appendFileOnlyLogOnce('mutation.shape.' + key.substring(0, 20), {
        entityKey: key, type: mutation?.type,
        payloadKeys: Object.keys(payload).slice(0, 10),
        firstSubKeys: (() => { const v = payload[Object.keys(payload)[0]]; return v && typeof v === 'object' ? Object.keys(v).slice(0, 10) : []; })()
      });

      const pct =
        payload?.videoAttributionModel?.watchProgressPercentage ??
        payload?.videoData?.watchProgressPercentage ??
        payload?.macroMarkersListEntity?.watchProgressPercentage ??
        payload?.videoAnnotationsEntity?.watchProgressPercentage ?? null;
      if (pct !== null) {
        const videoId = key.includes('|') ? key.split('|')[0] : key;
        window._ttVideoProgressCache[videoId] = { percentDurationWatched: Number(pct), source: 'entityMutation' };
        directHits++;
      }
      const explicitId = payload?.videoAttributionModel?.externalVideoId ||
        payload?.videoData?.videoId || payload?.videoAnnotationsEntity?.externalVideoId || null;
      if (explicitId && pct !== null) {
        window._ttVideoProgressCache[String(explicitId)] = { percentDurationWatched: Number(pct), source: 'entityMutationExplicit' };
        directHits++;
      }

      const deepEntries = collectWatchProgressEntries(payload);
      for (const entry of deepEntries) {
        window._ttVideoProgressCache[entry.id] = { percentDurationWatched: Number(entry.percent), source: entry.source };
        deepHits++;
      }
    }
    appendFileOnlyLog('mutation.cache.result', {
      count: r.frameworkUpdates.entityBatchUpdate.mutations.length,
      directHits,
      deepHits,
      total: Object.keys(window._ttVideoProgressCache).length
    });
  }


  if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
    r.paidContentOverlay = null;
  }

  if (r?.streamingData?.adaptiveFormats && configRead('videoPreferredCodec') !== 'any') {
    const preferredCodec = configRead('videoPreferredCodec');
    const hasPreferredCodec = r.streamingData.adaptiveFormats.find(format => format.mimeType.includes(preferredCodec));
    if (hasPreferredCodec) {
      r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.filter(format => {
        if (format.mimeType.startsWith('audio/')) return true;
        return format.mimeType.includes(preferredCodec);
      });
    }
  }

  // Drop "masthead" ad from home screen
  if (
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
      ?.sectionListRenderer?.contents
  ) {
    if (!signinReminderEnabled) {
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
          (elm) => !elm.feedNudgeRenderer
        );
    }

    if (adBlockEnabled) {
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
          (elm) => !elm.adSlotRenderer
        );

      for (const shelve of r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
        if (shelve.shelfRenderer) {
          shelve.shelfRenderer.content.horizontalListRenderer.items =
            shelve.shelfRenderer.content.horizontalListRenderer.items.filter(
              (item) => !item.adSlotRenderer
            );
        }
      }
    }

    processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents, true, detectedPage);
  }

  // Library tab pruning: must run unconditionally whenever we're on the library page,
  // because the library page sends its nav tabs via tvSecondaryNavRenderer (not tvSurfaceContentRenderer),
  // so gating this inside the tvSurfaceContentRenderer block meant it never fired on library.
  if (detectedPage === 'library') {
    pruneLibraryTabsInResponse(r, 'response');
  }

  if (r.endscreen && configRead('enableHideEndScreenCards')) {
    r.endscreen = null;
  }

  if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
    r.messages = r.messages.filter(
      (msg) => !msg?.youThereRenderer
    );
  }

  // Remove shorts ads
  if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
    r.entries = r.entries?.filter(
      (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
    );
  }

  // Patch settings

  if (r?.title?.runs) {
    PatchSettings(r);
  }

  // DeArrow Implementation. I think this is the best way to do it. (DOM manipulation would be a pain)

  if (r?.contents?.sectionListRenderer?.contents) {
    processShelves(r.contents.sectionListRenderer.contents, true, detectedPage);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items) {
    const gridItems = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items;
    r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = hideVideo(gridItems, detectedPage);
    normalizeGridRenderer(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.gridRenderer, 'contents.tvBrowseRenderer.grid');
  }

  const topPlaylistRenderer = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer;
  if (topPlaylistRenderer?.contents) {
    filterPlaylistRendererContents(topPlaylistRenderer, detectedPage, 'playlist.renderer');
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(r.continuationContents.sectionListContinuation.contents, true, detectedPage);
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    const continuation = r.continuationContents.horizontalListContinuation;
    deArrowify(r.continuationContents.horizontalListContinuation.items);
    hqify(r.continuationContents.horizontalListContinuation.items);
    addLongPress(r.continuationContents.horizontalListContinuation.items);
    r.continuationContents.horizontalListContinuation.items = filterContinuationItems(
      r.continuationContents.horizontalListContinuation.items,
      detectedPage,
      !!continuation?.continuations,
      'horizontalListContinuation'
    );
    normalizeHorizontalListRenderer(r.continuationContents.horizontalListContinuation, 'continuation.horizontal');
    if (detectedPage === 'library') {
      r.continuationContents.horizontalListContinuation.items = filterHiddenLibraryTabs(r.continuationContents.horizontalListContinuation.items, 'continuation.horizontalListContinuation.items');
      pruneLibraryTabsInResponse(r.continuationContents, 'response.continuationContents');
    }
  }

  if (r?.continuationContents?.gridContinuation?.items) {
    const gridItems = r.continuationContents.gridContinuation.items;
    r.continuationContents.gridContinuation.items = filterContinuationItems(
      gridItems,
      detectedPage,
      !!r?.continuationContents?.gridContinuation?.continuations,
      'gridContinuation'
    );
    normalizeGridRenderer(r.continuationContents.gridContinuation, 'continuation.grid');
  }

  // FIX (Bug 2): Handle playlist scroll-down continuations.
  // These use TILE_STYLE_YTLR_VERTICAL_LIST tiles and come through a different continuation key.
  if (r?.continuationContents?.playlistVideoListContinuation?.contents) {
    const playlistItems = r.continuationContents.playlistVideoListContinuation.contents;
    const hasContinuation = !!r?.continuationContents?.playlistVideoListContinuation?.continuations;
    appendFileOnlyLog('playlist.continuation.detected', {
      detectedPage,
      itemCount: Array.isArray(playlistItems) ? playlistItems.length : 0,
      hasContinuation
    });
    r.continuationContents.playlistVideoListContinuation.contents = filterContinuationItems(
      playlistItems,
      detectedPage,
      hasContinuation,
      'playlist.continuation'
    );
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    filterLibraryNavTabs(r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections, detectedPage);

    for (const section of r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
      if (!Array.isArray(section?.tvSecondaryNavSectionRenderer?.tabs)) continue;

      // Remove the "Shorts" tab from the channel nav bar when shorts are disabled.
      // Previously only the tab's content was filtered; the tab button itself stayed visible.
      if (!configRead('enableShorts')) {
        const tabs = section.tvSecondaryNavSectionRenderer.tabs;
        for (let i = tabs.length - 1; i >= 0; i--) {
          const tab = tabs[i];
          const tabTitle = String(
            tab?.tabRenderer?.title?.simpleText ||
            collectAllText(tab?.tabRenderer?.title).join(' ')
          ).toLowerCase();
          // Also catch via the endpoint browseId (Shorts tabs often point to a shorts browseId)
          const tabBrowseId = String(extractNavTabBrowseId(tab)).toLowerCase();
          if (tabTitle.includes('short') || tabBrowseId.includes('short')) {
            appendFileOnlyLog('shorts.navtab.removed', { tabTitle, tabBrowseId, index: i });
            tabs.splice(i, 1);
            continue;
          }
        }
      }

      for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
        const tabBrowseId = String(extractNavTabBrowseId(tab)).toLowerCase();
        const tabPage = normalizeBrowseIdToPage(tabBrowseId) || detectedPage;
        const contents = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(contents)) {
          processShelves(contents, true, tabPage);
        }

        const gridItems = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items;
        if (Array.isArray(gridItems)) {
          tab.tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items = hideVideo(gridItems, tabPage);
          normalizeGridRenderer(tab.tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer, 'tab.grid');
        }

        const tabPlaylistRenderer = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.playlistVideoListRenderer;
        if (tabPlaylistRenderer?.contents) {
          filterPlaylistRendererContents(tabPlaylistRenderer, tabPage, 'tab.playlist.renderer');
        }
      }
    }
  }

  // Last-pass safety net for unknown/new TV response shapes that still carry tileRenderer arrays.
  processTileArraysDeep(r, detectedPage, 'response');

  if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    if (!signinReminderEnabled) {
      r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents =
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.filter(
          (elm) => !elm.alertWithActionsRenderer
        );
    }
    processShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, false, detectedPage);
    if (window.queuedVideos.videos.length > 0) {
      const queuedVideosClone = window.queuedVideos.videos.slice();
      queuedVideosClone.unshift(TileRenderer(
        'Clear Queue',
        {
          customAction: {
            action: 'CLEAR_QUEUE'
          }
        }));
      r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(ShelfRenderer(
        'Queued Videos',
        queuedVideosClone,
        queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ?
          queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId)
          : 0
      ));
    }
  }
  /*
 
  Chapters are disabled due to the API removing description data which was used to generate chapters
 
  if (r?.contents?.singleColumnWatchNextResults?.results?.results?.contents && configRead('enableChapters')) {
    const chapterData = Chapters(r);
    r.frameworkUpdates.entityBatchUpdate.mutations.push(chapterData);
    resolveCommand({
      "clickTrackingParams": "null",
      "loadMarkersCommand": {
        "visibleOnLoadKeys": [
          chapterData.entityKey
        ],
        "entityKeys": [
          chapterData.entityKey
        ]
      }
    });
  }*/

  // Manual SponsorBlock Skips

  if (configRead('sponsorBlockManualSkips').length > 0 && r?.playerOverlays?.playerOverlayRenderer) {
    const manualSkippedSegments = configRead('sponsorBlockManualSkips');
    let timelyActions = [];
    if (window?.sponsorblock?.segments) {
      for (const segment of window.sponsorblock.segments) {
        if (manualSkippedSegments.includes(segment.category)) {
          const timelyActionData = timelyAction(
            `Skip ${segment.category}`,
            'SKIP_NEXT',
            {
              clickTrackingParams: null,
              showEngagementPanelEndpoint: {
                customAction: {
                  action: 'SKIP',
                  parameters: {
                    time: segment.segment[1]
                  }
                }
              }
            },
            segment.segment[0] * 1000,
            segment.segment[1] * 1000 - segment.segment[0] * 1000
          );
          timelyActions.push(timelyActionData);
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
          button: {
            buttonRenderer: ButtonRenderer(
              false,
              'Skip to highlight',
              'SKIP_NEXT',
              {
                clickTrackingParams: null,
                customAction: {
                  action: 'SKIP',
                  parameters: {
                    time: category.segment[0]
                  }
                }
              })
          }
        });
      }
    }
  }

  return r;
  } catch (error) {
    appendFileOnlyLog('json.parse.error', {
      message: error?.message || String(error),
      stack: String(error?.stack || '').substring(0, 600)
    });
    return r;
  }
};

// Patch JSON.parse to use the custom one
window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}


// FIX (Bug 1): Replaced for...of + splice with a reverse for-loop.
// The old for...of loop mutated the array while iterating — when an item was spliced out at
// index i, the item that was at i+1 shifted to i, but the iterator advanced to i+1, silently
// skipping it. This caused the Shorts shelf (and any shelf immediately after a removed one)
// to be missed. Iterating in reverse avoids all index-shift problems.
function processShelves(shelves, shouldAddPreviews = true, pageHint = null) {
  if (!Array.isArray(shelves)) return;
  const activePage = pageHint || getActivePage();
  appendFileOnlyLog('processShelves.start', {
    page: activePage,
    shelfCount: shelves.length,
    shouldAddPreviews
  });

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];
    const shelfAllText = collectAllText(shelve).join(' ').toLowerCase();
    appendFileOnlyLog('processShelves.item', {
      page: activePage,
      index: i,
      keys: shelve && typeof shelve === 'object' ? Object.keys(shelve).slice(0, 8) : typeof shelve,
      hasShelfRenderer: !!shelve?.shelfRenderer,
      hasReelShelfRenderer: !!shelve?.reelShelfRenderer,
      textPreview: shelfAllText.substring(0, 80)
    });

    if (!configRead('enableShorts') && isShortsShelf(shelve)) {
      appendFileOnlyLog('shorts.reelShelf.remove', {
        page: activePage,
        reason: 'is_shorts_shelf'
      });
      shelves.splice(i, 1);
      continue;
    }

    // Some channel surfaces include "Shorts" shelf-like rows under non-shelf renderers.
    if (!configRead('enableShorts') && !shelve?.shelfRenderer && /\bshorts?\b/i.test(shelfAllText)) {
      appendFileOnlyLog('shorts.genericShelf.remove', {
        page: activePage,
        index: i,
        keys: shelve && typeof shelve === 'object' ? Object.keys(shelve).slice(0, 8) : typeof shelve,
        textPreview: shelfAllText.substring(0, 120)
      });
      shelves.splice(i, 1);
      continue;
    }

    if (!shelve.shelfRenderer) continue;

    const shelfItems = getShelfItems(shelve);
    if (!Array.isArray(shelfItems)) continue;

    deArrowify(shelfItems);
    hqify(shelfItems);
    addLongPress(shelfItems);
    if (shouldAddPreviews) {
      addPreviews(shelfItems);
    }
    shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(shelfItems, activePage);
    normalizeHorizontalListRenderer(shelve.shelfRenderer.content.horizontalListRenderer, `shelf:${activePage}:${i}`);
    if (activePage === 'library') {
      shelve.shelfRenderer.content.horizontalListRenderer.items = filterHiddenLibraryTabs(shelve.shelfRenderer.content.horizontalListRenderer.items, 'processShelves.shelfRenderer.horizontalListRenderer.items');
      normalizeHorizontalListRenderer(shelve.shelfRenderer.content.horizontalListRenderer, `shelf:${activePage}:${i}:library`);
    }
    if (!configRead('enableShorts')) {
      const shelfTitleDirect = String(shelve?.shelfRenderer?.title?.simpleText || '').toLowerCase();
      const shelfTitleFromHeader = collectAllText(shelve?.shelfRenderer?.header).join(' ').toLowerCase();
      const shelfTitle = shelfTitleDirect || shelfTitleFromHeader;
      appendFileOnlyLogOnce('shelf.title.' + shelfTitle.substring(0, 24), {
        page: activePage,
        rendererType: shelve?.shelfRenderer?.tvhtml5ShelfRendererType || '',
        direct: shelfTitleDirect, fromHeader: shelfTitleFromHeader.substring(0, 60)
      });
      if (isShortsShelf(shelve)) {
        appendFileOnlyLog('shorts.shelf.remove', {
          page: activePage,
          reason: 'is_shorts_shelf',
          shelfTitle: shelve?.shelfRenderer?.title || ''
        });
        // Safe to splice because we are iterating in reverse
        shelves.splice(i, 1);
        continue;
      }

      const beforeShortsFilter = shelve.shelfRenderer.content.horizontalListRenderer.items.length;
      shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => !isLikelyShortItem(item));
      normalizeHorizontalListRenderer(shelve.shelfRenderer.content.horizontalListRenderer, `shelf:${activePage}:${i}:shorts`);
      appendFileOnlyLog('shorts.tiles.filter', {
        page: activePage,
        before: beforeShortsFilter,
        after: shelve.shelfRenderer.content.horizontalListRenderer.items.length,
        removed: beforeShortsFilter - shelve.shelfRenderer.content.horizontalListRenderer.items.length
      });
    }

    if (shelve.shelfRenderer.content.horizontalListRenderer.items.length === 0) {
      appendFileOnlyLog('shelf.empty.remove', {
        page: activePage,
        shelfTitle: shelve?.shelfRenderer?.title?.simpleText || collectAllText(shelve?.shelfRenderer?.header).join(' ').substring(0, 80)
      });
      shelves.splice(i, 1);
    }
  }
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

function getGenericNodeProgress(item) {
  const entries = collectWatchProgressEntries(item);
  if (!entries.length) return null;
  const best = entries.reduce((max, entry) => Number(entry.percent) > Number(max.percent) ? entry : max, entries[0]);
  return { percentDurationWatched: Number(best.percent || 0), source: best.source || 'deep_scan' };
}


function addPreviews(items) {
  if (!configRead('enablePreviews')) return;
  for (const item of items) {
    if (item.tileRenderer) {
      const watchEndpoint = item.tileRenderer.onSelectCommand;
      if (item.tileRenderer?.onFocusCommand?.playbackEndpoint) continue;
      item.tileRenderer.onFocusCommand = {
        startInlinePlaybackCommand: {
          blockAdoption: true,
          caption: false,
          delayMs: 3000,
          durationMs: 40000,
          muted: false,
          restartPlaybackBeforeSeconds: 10,
          resumeVideo: true,
          playbackEndpoint: watchEndpoint
        }
      };
    }
  }
}

function deArrowify(items) {
  if (!Array.isArray(items)) return;
  // Iterate in reverse so splicing an adSlotRenderer doesn't shift indices of unvisited items.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    if (item.adSlotRenderer) {
      items.splice(i, 1);
      continue;
    }
    if (!item?.tileRenderer) continue;
    if (configRead('enableDeArrow')) {
      // Capture item reference so the async callback isn't affected by loop variable changes.
      const capturedItem = item;
      const videoID = capturedItem.tileRenderer.contentId;
      fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`).then(res => res.json()).then(data => {
        if (data.titles.length > 0) {
          const mostVoted = data.titles.reduce((max, title) => max.votes > title.votes ? max : title);
          capturedItem.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title;
        }

        if (data.thumbnails.length > 0 && configRead('enableDeArrowThumbnails')) {
          const mostVotedThumbnail = data.thumbnails.reduce((max, thumbnail) => max.votes > thumbnail.votes ? max : thumbnail);
          if (mostVotedThumbnail.timestamp) {
            capturedItem.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
              {
                url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${mostVotedThumbnail.timestamp}`,
                width: 1280,
                height: 640
              }
            ]
          }
        }
      }).catch(() => { });
    }
  }
}


function hqify(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    try {
    if (!item?.tileRenderer) continue;
    // FIX (Bug 3): Also handle vertical-list tiles used in playlists.
    if (
      item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT' &&
      item.tileRenderer.style !== 'TILE_STYLE_YTLR_VERTICAL_LIST'
    ) continue;
    if (configRead('enableHqThumbnails')) {
      const videoID = item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId;
      if (!videoID) continue;
      const queryArgs = item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]?.url?.split('?')[1];
      item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
        {
          url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
          width: 640,
          height: 480
        }
      ];
    }
    } catch (error) {
      appendFileOnlyLog('hqify.item.error', {
        message: error?.message || String(error),
        stack: String(error?.stack || '').substring(0, 400),
        keys: item && typeof item === 'object' ? Object.keys(item).slice(0, 8) : typeof item
      });
    }
  }
}

function addLongPress(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    try {
    if (!item?.tileRenderer) continue;
    // FIX (Bug 3): Also handle vertical-list tiles used in playlists.
    if (
      item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT' &&
      item.tileRenderer.style !== 'TILE_STYLE_YTLR_VERTICAL_LIST'
    ) continue;
    if (item.tileRenderer.onLongPressCommand) {
      item.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.push(MenuServiceItemRenderer('Add to Queue', {
        clickTrackingParams: null,
        playlistEditEndpoint: {
          customAction: {
            action: 'ADD_TO_QUEUE',
            parameters: item
          }
        }
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
      appendFileOnlyLog('addLongPress.item.error', {
        message: error?.message || String(error),
        stack: String(error?.stack || '').substring(0, 400),
        keys: item && typeof item === 'object' ? Object.keys(item).slice(0, 8) : typeof item
      });
    }
  }
}

function getTileWatchProgress(item) {
  const overlays = item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || [];
  const resumeOverlay = overlays.find((o) => o.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
  if (resumeOverlay?.percentDurationWatched !== undefined) {
    return { percentDurationWatched: Number(resumeOverlay.percentDurationWatched || 0), source: 'tile_overlay_resume' };
  }

  const progressOverlay = overlays.find((o) => o.thumbnailOverlayPlaybackProgressRenderer)?.thumbnailOverlayPlaybackProgressRenderer;
  if (progressOverlay?.percentDurationWatched !== undefined) {
    return { percentDurationWatched: Number(progressOverlay.percentDurationWatched || 0), source: 'tile_overlay_playback_progress' };
  }

  const playedOverlay = overlays.find((o) => o.thumbnailOverlayPlaybackStatusRenderer)?.thumbnailOverlayPlaybackStatusRenderer;
  if (playedOverlay?.status === 'PLAYBACK_STATUS_PLAYED' || playedOverlay?.status === 'WATCHED') {
    return { percentDurationWatched: 100, source: 'tile_overlay_played_status' };
  }

  return null;
}

function isWatchedByTextSignals(item) {
  const text = collectAllText(item?.tileRenderer || item).join(' ').toLowerCase();
  if (!text) return false;
  return (
    text.includes('watched') ||
    text.includes('already watched') ||
    text.includes('gesehen') ||
    text.includes('bereits angesehen')
  );
}

function isLikelyPlaceholderItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.continuationItemRenderer || item.adSlotRenderer) return true;

  const keys = Object.keys(item);
  return keys.some((key) => /placeholder|skeleton/i.test(key));
}

function processTileArraysDeep(node, pageHint = null, path = 'root', depth = 0) {
  if (!node || depth > 10) return;
  const pageName = pageHint || getActivePage();

  if (Array.isArray(node)) {
    if (node.some((item) => item?.tileRenderer)) {
      const before = node.length;
      let filtered = hideVideo(node, pageName);
      if (!configRead('enableShorts')) {
        const beforeShorts = filtered.length;
        filtered = filtered.filter(item => item?.__ttKeepOneForContinuation || !isLikelyShortItem(item));
        if (beforeShorts !== filtered.length) {
          appendFileOnlyLog('deep.tiles.shorts', {
            pageName,
            path,
            before: beforeShorts,
            after: filtered.length,
            removed: beforeShorts - filtered.length
          });
        }
      }
      if (pageName === 'library') {
        filtered = filterHiddenLibraryTabs(filtered, `deep:${path}`);
      }
      if (before !== filtered.length) {
        appendFileOnlyLog('deep.tiles.filtered', {
          pageName,
          path,
          before,
          after: filtered.length,
          removed: before - filtered.length
        });
      }
      node.splice(0, node.length, ...filtered);
      return;
    }

    for (let i = 0; i < node.length; i++) {
      processTileArraysDeep(node[i], pageName, `${path}[${i}]`, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    processTileArraysDeep(node[key], pageName, `${path}.${key}`, depth + 1);
  }
}

function hideVideo(items, pageHint = null) {
  if (!Array.isArray(items)) return [];
  const pages = configRead('hideWatchedVideosPages') || [];
  const pageName = pageHint || getActivePage();
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);

  const hideWatchedEnabled = !!configRead('enableHideWatchedVideos');
  const shortsEnabled = !!configRead('enableShorts');

  appendFileOnlyLog('hideVideo.start', {
    pageName,
    threshold,
    configuredPages: pages,
    inputCount: Array.isArray(items) ? items.length : 0,
    enableHideWatchedVideos: hideWatchedEnabled,
    enableShorts: shortsEnabled
  });

  let removedWatched = 0;
  let removedShorts = 0;
  const result = items.filter(item => {
    try {
    const hasTileRenderer = !!item?.tileRenderer;
    if (!hasTileRenderer) {
      if (isLikelyPlaceholderItem(item)) {
        appendFileOnlyLog('hideVideo.item.skip', {
          pageName,
          rendererKeys: item && typeof item === 'object' ? Object.keys(item).slice(0, 5) : typeof item,
          reason: 'placeholder_removed'
        });
        return false;
      }
      const genericTitle = collectAllText(item).join(' ').trim().substring(0, 120) || 'unknown';
      const genericProgress = getGenericNodeProgress(item) || (isWatchedByTextSignals(item) ? { percentDurationWatched: 100, source: 'text_signal' } : null);
      const genericShortLike = !shortsEnabled && /\bshorts?\b/i.test(genericTitle);

      if (genericShortLike) {
        removedShorts++;
        appendFileOnlyLog('hideVideo.item.generic', { pageName, title: genericTitle, remove: true, reason: 'generic_short_detected' });
        return false;
      }

      if (genericProgress && hideWatchedEnabled && pages.includes(pageName)) {
        const percentWatched = Number(genericProgress.percentDurationWatched || 0);
        const remove = percentWatched > threshold;
        if (remove) removedWatched++;
        appendFileOnlyLog('hideVideo.item.generic', {
          pageName,
          title: genericTitle,
          percentWatched,
          threshold,
          remove,
          source: genericProgress.source || 'generic'
        });
        return !remove;
      }

      appendFileOnlyLog('hideVideo.item.skip', {
        pageName,
        rendererKeys: item && typeof item === 'object' ? Object.keys(item).slice(0, 5) : typeof item,
        reason: 'no_tile_renderer'
      });
      return true;
    }

    const tileProgressBar = getTileWatchProgress(item);
    const videoId = getItemVideoId(item);
    const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || videoId || 'unknown';
    const contentId = videoId.toLowerCase();
    const cachedProgress = window._ttVideoProgressCache?.[videoId] ?? null;
    const textWatched = isWatchedByTextSignals(item);
    const progressBar = tileProgressBar ?? cachedProgress ?? (textWatched ? { percentDurationWatched: 100 } : null);
    const progressSource = tileProgressBar?.source || (cachedProgress ? 'entity_cache' : 'none');

    const currentParseSeq = Number(window.__ttParseSeq || 0);
    const itemParseSeq = Number(item?.__ttKeepOneForContinuationParseSeq || 0);
    const keepOneStillValid = pageName === 'playlist' && itemParseSeq > 0 && itemParseSeq === currentParseSeq;

    const playlistHelperIds = getPlaylistHelperVideoIdSet();
    const isKnownPlaylistHelper = pageName === 'playlist' && videoId && playlistHelperIds.has(videoId);
    if (isKnownPlaylistHelper && !keepOneStillValid) {
      appendFileOnlyLog('hideVideo.item.playlist_helper.pruned', {
        pageName,
        title,
        videoId,
        reason: item?.__ttKeepOneForContinuation ? 'stale_marker' : 'known_helper_reappeared_without_marker',
        itemParseSeq,
        currentParseSeq
      });
      unregisterPlaylistHelperVideoId(videoId, 'hideVideo.item.playlist_helper');
      return false;
    }

    if (item?.__ttKeepOneForContinuation) {
      if (keepOneStillValid) {
        appendFileOnlyLog('hideVideo.item.keep_one', {
          pageName,
          title,
          videoId,
          keepOneLabel: item?.__ttKeepOneForContinuationLabel || 'unknown',
          parseSeq: itemParseSeq
        });
        return true;
      }

      appendFileOnlyLog('hideVideo.item.keep_one.expired', {
        pageName,
        title,
        videoId,
        keepOneLabel: item?.__ttKeepOneForContinuationLabel || 'unknown',
        itemParseSeq,
        currentParseSeq,
        reason: pageName !== 'playlist' ? 'page_not_playlist' : 'parse_seq_mismatch'
      });
      delete item.__ttKeepOneForContinuation;
      delete item.__ttKeepOneForContinuationLabel;
      delete item.__ttKeepOneForContinuationParseSeq;
      unregisterPlaylistHelperVideoId(videoId, 'hideVideo.item.keep_one.expired');
    }

    const retiredHelperIds = getRetiredPlaylistHelperVideoIdSet();
    if (pageName === 'playlist' && videoId && retiredHelperIds.has(videoId)) {
      appendFileOnlyLog('hideVideo.item.playlist_helper.retired_pruned', {
        pageName,
        title,
        videoId,
        retiredCount: retiredHelperIds.size
      });
      return false;
    }

    if (pageName === 'library' && isHiddenLibraryBrowseId(contentId)) {
      appendFileOnlyLog('hideVideo.item', { pageName, title, contentId, hasProgress: !!progressBar, remove: true, reason: 'library_tab_hidden' });
      return false;
    }

    const shortLike = isLikelyShortItem(item);
    if (!shortsEnabled && shortLike) {
      removedShorts++;
      appendFileOnlyLog('hideVideo.item', { pageName, title, hasProgress: !!progressBar, remove: true, reason: 'short_detected' });
      return false;
    }

    if (!progressBar) {
      appendFileOnlyLog('hideVideo.item', { pageName, title, videoId, hasProgress: false, progressSource, textWatched, remove: false, reason: 'no_progress' });
      return true;
    }

    if (!hideWatchedEnabled || !pages.includes(pageName)) {
      appendFileOnlyLog('hideVideo.item', { pageName, title, hasProgress: true, percentWatched: Number(progressBar.percentDurationWatched || 0), remove: false, reason: hideWatchedEnabled ? 'page_not_enabled' : 'watched_feature_disabled' });
      return true;
    }

    const percentWatched = Number(progressBar.percentDurationWatched || 0);
    const remove = percentWatched > threshold;
    if (remove) removedWatched++;

    appendFileOnlyLog('hideVideo.item', {
      pageName,
      title,
      hasProgress: true,
      percentWatched,
      threshold,
      remove,
      reason: remove ? 'remove' : 'below_threshold'
    });

    return !remove;
    } catch (error) {
      appendFileOnlyLog('hideVideo.item.error', {
        pageName,
        message: error?.message || String(error),
        stack: String(error?.stack || '').substring(0, 500),
        itemKeys: item && typeof item === 'object' ? Object.keys(item).slice(0, 10) : typeof item
      });
      return true;
    }
  });

  appendFileOnlyLog('hideVideo.done', {
    pageName,
    input: Array.isArray(items) ? items.length : 0,
    output: result.length,
    removedWatched,
    removedShorts
  });

  return result;
}
