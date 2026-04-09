import { configRead } from '../config.js';

// ── Logging ───────────────────────────────────────────────────────────────────

export function appendFileOnlyLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;
  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];
  let msg = '';
  try { msg = JSON.stringify(payload); } catch { msg = String(payload); }
  window.__ttFileOnlyLogs.push(`[${new Date().toISOString()}] [TT_ADBLOCK_FILE] ${label} ${msg}`);
  if (window.__ttFileOnlyLogs.length > 5000) window.__ttFileOnlyLogs.shift();
}

// ── Page detection ────────────────────────────────────────────────────────────

function browseIdToPage(id) {
  const b = String(id || '').toLowerCase();
  if (b.includes('fesubscription')) return 'subscriptions';
  if (b.startsWith('uc')) return 'channel';
  if (b === 'fehistory') return 'history';
  if (b === 'felibrary') return 'library';
  if (b === 'feplaylist_aggregation') return 'playlists';
  if (b === 'femy_youtube' || b === 'vlwl' || b === 'vlll' || b.startsWith('vlpl')) return 'playlist';
  return null;
}

export const detectPageFromBrowseId = browseIdToPage;

export function detectCurrentPage() {
  try {
    const hash = location.hash ? location.hash.substring(1) : '';
    const cParam = (
      hash.match(/(?:^|[?&])c=([^&]+)/i)?.[1] ||
      location.search.match(/(?:^|[?&])c=([^&]+)/i)?.[1] || ''
    ).toLowerCase();
    if (hash.startsWith('/watch')) return 'watch';
    if (hash.startsWith('/channel/') || hash.startsWith('/c/') || hash.startsWith('/@')) return 'channel';
    const fromC = browseIdToPage(cParam);
    if (fromC) return fromC;
    return hash === '/' ? 'home'
      : hash.startsWith('/search') ? 'search'
      : (hash.split('?')[1]?.split('&')[0]?.split('=')[1] || 'home').replace('FE', '').replace('topics_', '');
  } catch {
    return 'home';
  }
}

export function detectPageFromResponse(response) {
  try {
    if (response?.contents?.singleColumnWatchNextResults) return 'watch';
    for (const entry of response?.responseContext?.serviceTrackingParams || []) {
      for (const param of entry?.params || []) {
        if (param?.key === 'browse_id') {
          const page = browseIdToPage(param.value);
          if (page) return page;
        }
      }
    }
    const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '').toLowerCase();
    if (targetId.startsWith('browse-feed')) {
      const page = browseIdToPage(targetId.replace('browse-feed', ''));
      if (page) return page;
    }
    return browseIdToPage(response?.currentVideoEndpoint?.watchEndpoint?.browseEndpoint?.browseId);
  } catch {
    return null;
  }
}

export function detectAndStorePage(pageName, source = 'unknown') {
  if (pageName) {
    const prev = window.__ttLastDetectedPage;
    window.__ttLastDetectedPage = pageName;
    if (prev !== pageName) appendFileOnlyLog('page.store', { source, previous: prev, next: pageName });
  }
  return pageName;
}

if (!window.__ttHideWatchedLocationTrackingInit) {
  window.__ttHideWatchedLocationTrackingInit = true;
  const sync = () => {
    try {
      const p = detectCurrentPage();
      if (p && p !== 'home' && p !== 'search') detectAndStorePage(p, 'nav');
      const keys = Object.keys(_carryover);
      if (keys.length) {
        appendFileOnlyLog('consolidate.carryover.navClear', { cleared: keys, page: p });
        keys.forEach(k => delete _carryover[k]);
      }
    } catch (_) { }
  };
  try { sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync); } catch (_) {}
}

// ── Watch progress extraction ─────────────────────────────────────────────────

export function getWatchPercent(item) {
  try {
    const overlays = item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays
      || item?.tileRenderer?.thumbnailOverlays || [];
    const resume = overlays.find(o => o.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
    if (resume) {
      const pct = resume.percentDurationWatched;
      return (pct !== null && pct !== undefined) ? Number(pct) : 100;
    }
    if (overlays.some(o => o.thumbnailOverlayPlaybackStatusRenderer || o.thumbnailOverlayPlayedRenderer)) return 100;
    const badges = item?.tileRenderer?.badges || [];
    if (badges.some(b => {
      const s = String(b?.metadataBadgeRenderer?.style || '') + String(b?.metadataBadgeRenderer?.label || '');
      return s.toLowerCase().includes('watched');
    })) return 100;
    const raw = item?.watchProgressPercentage ?? item?.percentDurationWatched
      ?? item?.lockupViewModel?.progressPercentage ?? null;
    if (raw !== null) return Number(raw);
    const videoId = item?.tileRenderer?.contentId
      || item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId;
    if (videoId && window._ttVideoProgressCache?.[videoId] !== undefined) {
      return window._ttVideoProgressCache[videoId];
    }
    return null;
  } catch {
    return null;
  }
}

// ── hideVideo ─────────────────────────────────────────────────────────────────

export function hideVideo(items, pageHint = null) {
  if (!Array.isArray(items) || !configRead('enableHideWatchedVideos')) return items;
  const pages = configRead('hideWatchedVideosPages');
  const threshold = configRead('hideWatchedVideosThreshold');
  const hashPage = detectCurrentPage();
  const pageName = (pageHint && pageHint !== 'home' && pageHint !== 'search') ? pageHint
    : (hashPage !== 'home' && hashPage !== 'search') ? hashPage
    : (window.__ttLastDetectedPage || hashPage);
  appendFileOnlyLog('hideVideo.context', { pageHint, hashPage, pageName, lastDetected: window.__ttLastDetectedPage || null });
  if (!pages.includes(pageName)) return items;
  return items.filter(item => {
    try {
      if (!item?.tileRenderer?.contentId) return true;
      if (item.__ttKeepOneForContinuation) {
        const currentSeq = Number(window.__ttParseSeq || 0);
        const itemSeq = Number(item.__ttKeepOneForContinuationParseSeq || 0);
        if (pageName === 'playlist' && itemSeq > 0 && itemSeq === currentSeq) {
          appendFileOnlyLog('hideVideo.keep_one', { pageName, videoId: item?.tileRenderer?.contentId });
          return true;
        }
        delete item.__ttKeepOneForContinuation;
        delete item.__ttKeepOneForContinuationLabel;
        delete item.__ttKeepOneForContinuationParseSeq;
      }
      const pct = getWatchPercent(item);
      if (pct === null) {
        appendFileOnlyLog('hideVideo.noProgress', { pageName, videoId: item?.tileRenderer?.contentId });
        return true;
      }
      const keep = pct <= threshold;
      if (!keep) appendFileOnlyLog('hideVideo.removed', { pageName, pct, videoId: item?.tileRenderer?.contentId });
      return keep;
    } catch { return true; }
  });
}

// ── processTileArraysDeep ─────────────────────────────────────────────────────

function isVideoItem(item) {
  return !!(item?.tileRenderer || item?.videoRenderer || item?.gridVideoRenderer
    || item?.compactVideoRenderer || item?.lockupViewModel);
}

export function processTileArraysDeep(node, pageHint = null, path = 'root', depth = 0, extraFilter = null) {
  if (!node || depth > 10) return;
  try {
    if (Array.isArray(node)) {
      if (node.some(isVideoItem)) {
        const before = node.length;
        let filtered = hideVideo(node, pageHint);
        if (extraFilter) filtered = extraFilter(filtered, pageHint);
        if (before !== filtered.length) appendFileOnlyLog('deep.tiles.filtered', { path, pageHint, before, after: filtered.length, removed: before - filtered.length });
        node.splice(0, node.length, ...filtered);
        return;
      }
      for (let i = 0; i < node.length; i++) processTileArraysDeep(node[i], pageHint, `${path}[${i}]`, depth + 1, extraFilter);
      return;
    }
    if (typeof node !== 'object') return;
    for (const key of Object.keys(node)) processTileArraysDeep(node[key], pageHint, `${path}.${key}`, depth + 1, extraFilter);
  } catch (_) { }
}

// ── consolidateShelves ────────────────────────────────────────────────────────

const _seen = new WeakSet();

const _carryover = {};

export function clearCarryover() {
  const keys = Object.keys(_carryover);
  if (keys.length) appendFileOnlyLog('consolidate.carryover.cleared', { cleared: keys });
  keys.forEach(k => delete _carryover[k]);
}

// Only subscriptions and watch benefit from consolidation.
// Channel page is intentionally excluded — it breaks the channel page layout.
const CONSOLIDATE_PAGES = new Set(['subscriptions', 'watch']);

export function consolidateShelves(contents, path = 'unknown', pageName = null, hasContinuation = false, itemFilter = null) {
  appendFileOnlyLog('consolidate.check', { path, contentsLength: contents?.length, pageName, hasContinuation });
  if (!configRead('enableHideWatchedVideos')) return;
  if (pageName && !CONSOLIDATE_PAGES.has(pageName)) return;
  if (!Array.isArray(contents)) return;
  if (_seen.has(contents)) { appendFileOnlyLog('consolidate.skip.weakset', { path }); return; }
  _seen.add(contents);

  try {
    const shelves = contents.filter(c => c.shelfRenderer);
    if (!shelves.length) return;

    // Collect only real video tiles: require watchEndpoint.videoId OR exactly 11-char contentId.
    // Channel cards use browseEndpoint only and have a 24-char browseId as contentId — excluded.
    const allItems = shelves.flatMap(s => s.shelfRenderer.content.horizontalListRenderer.items || []);
    let freshItems = allItems.filter(item => {
      const watchVideoId = item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId;
      if (watchVideoId) return true;
      const contentId = item?.tileRenderer?.contentId;
      return contentId && String(contentId).length === 11;
    });

    if (itemFilter) freshItems = itemFilter(freshItems, pageName);

    // Apply carryover from previous batch for this pageName.
    // Only discard if current path is a tab.* path and sourcePath differs (initial tab load
    // after a tab switch). Tab-switch clears are handled by clearCarryover() in adblock.js
    // which is called whenever tvSurfaceContentContinuation fires (channel tab initial load).
    const isTabPath = path.startsWith('tab.');
    let carried = [];
    if (pageName && _carryover[pageName]) {
      const stored = _carryover[pageName];
      const isStale = isTabPath && stored.sourcePath !== path;
      if (isStale) {
        delete _carryover[pageName];
        appendFileOnlyLog('consolidate.carryover.tabSwitch', { path, pageName, discarded: stored.items.length, oldPath: stored.sourcePath });
      } else {
        carried = [...stored.items];
        delete _carryover[pageName];
        appendFileOnlyLog('consolidate.carryover.apply', { path, pageName, carried: carried.length });
      }
    }

    if (!freshItems.length && !carried.length) return;

    // Deduplicate — seed seenIds with carried IDs so fresh items can't duplicate them.
    const seenIds = new Set();
    for (const item of carried) {
      const id = item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId || item?.tileRenderer?.contentId || null;
      if (id) seenIds.add(id);
    }
    const dedupedFresh = freshItems.filter(item => {
      const id = item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId || item?.tileRenderer?.contentId || null;
      if (!id) return true;
      if (seenIds.has(id)) { appendFileOnlyLog('consolidate.dedup', { path, videoId: id }); return false; }
      seenIds.add(id);
      return true;
    });
    const dedupedItems = [...carried, ...dedupedFresh];
    if (!dedupedItems.length) return;

    // perRow: max across all shelves' recorded original row size and current item counts.
    const perRow = Math.max(
      ...shelves.map(s => s.shelfRenderer.content.horizontalListRenderer._originalRowSize || 0),
      ...shelves.map(s => s.shelfRenderer.content.horizontalListRenderer.items?.length || 0),
      3
    );

    const insertAt = contents.findIndex(c => c.shelfRenderer);
    for (let i = contents.length - 1; i >= 0; i--) if (contents[i].shelfRenderer) contents.splice(i, 1);

    // Pick the template from the first shelf that has a non-empty title or no suspicious header.
    // Avoids using a Shorts shelf (which survived processShelves) as template, which would
    // copy the "Shorts" heading into all consolidated rows.
    const template = shelves.find(s => {
      const firstItem = s.shelfRenderer.content.horizontalListRenderer.items?.[0];
      return !firstItem?.tileRenderer?.onSelectCommand?.reelWatchEndpoint && !firstItem?.reelItemRenderer;
    }) || shelves[0];

    const newShelves = [];

    for (let i = 0; i + perRow <= dedupedItems.length; i += perRow) {
      const rowItems = dedupedItems.slice(i, i + perRow);
      const hlr = {
        ...template.shelfRenderer.content.horizontalListRenderer,
        items: rowItems,
        visibleItemCount: rowItems.length,
        collapsedItemCount: rowItems.length,
        totalItemCount: rowItems.length,
      };
      if (typeof hlr.selectedIndex === 'number') hlr.selectedIndex = 0;
      if (typeof hlr.focusIndex === 'number')    hlr.focusIndex = 0;
      if (typeof hlr.currentIndex === 'number')  hlr.currentIndex = 0;
      newShelves.push({ shelfRenderer: { ...template.shelfRenderer, content: { horizontalListRenderer: hlr } } });
    }

    // Partial remainder handling:
    // hasContinuation=true  → store as carryover; next batch prepends them before packing rows.
    // hasContinuation=false → last batch; render partial row as-is.
    const remainder = dedupedItems.length % perRow;
    if (remainder > 0) {
      const lastBatch = dedupedItems.slice(dedupedItems.length - remainder);
      if (hasContinuation && pageName) {
        _carryover[pageName] = { items: lastBatch, sourcePath: path };
        appendFileOnlyLog('consolidate.carryover.store', { path, pageName, stored: lastBatch.length, perRow });
      } else {
        const hlr = {
          ...template.shelfRenderer.content.horizontalListRenderer,
          items: lastBatch,
          visibleItemCount: lastBatch.length,
          collapsedItemCount: lastBatch.length,
          totalItemCount: lastBatch.length,
        };
        if (typeof hlr.selectedIndex === 'number') hlr.selectedIndex = 0;
        if (typeof hlr.focusIndex === 'number')    hlr.focusIndex = 0;
        if (typeof hlr.currentIndex === 'number')  hlr.currentIndex = 0;
        newShelves.push({ shelfRenderer: { ...template.shelfRenderer, content: { horizontalListRenderer: hlr } } });
      }
    }

    contents.splice(insertAt, 0, ...newShelves);
    appendFileOnlyLog('consolidate.done', {
      path, pageName, perRow,
      totalItems: allItems.length, freshItems: freshItems.length,
      carried: carried.length,
      deduped: (freshItems.length + carried.length) - dedupedItems.length,
      newRows: newShelves.length,
      carryoverStored: (hasContinuation && remainder > 0) ? remainder : 0,
    });
  } catch (err) {
    appendFileOnlyLog('consolidate.error', { path, msg: String(err?.message || err) });
  }
}

// ── Entity mutation progress cache ────────────────────────────────────────────

export function updateProgressCache(r) {
  if (!r?.frameworkUpdates?.entityBatchUpdate?.mutations) return;
  if (!window._ttVideoProgressCache) window._ttVideoProgressCache = {};
  for (const mutation of r.frameworkUpdates.entityBatchUpdate.mutations) {
    try {
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
    } catch (_) { }
  }
}

export function startEmptyTileObserver() {}

// ── Normalizers (shared by adblock + any future renderer filters) ─────────────

export function normalizeHorizontalListRenderer(hlr, _context = '') {
  if (!hlr || !Array.isArray(hlr.items)) return;
  const count = hlr.items.length;
  if (typeof hlr.visibleItemCount === 'number') hlr.visibleItemCount = count;
  if (typeof hlr.collapsedItemCount === 'number') hlr.collapsedItemCount = count;
  if (typeof hlr.totalItemCount === 'number') hlr.totalItemCount = count;
  const clamp = (v) => (typeof v !== 'number') ? v : (count <= 0 ? 0 : Math.max(0, Math.min(count - 1, v)));
  if (typeof hlr.selectedIndex === 'number') hlr.selectedIndex = clamp(hlr.selectedIndex);
  if (typeof hlr.focusIndex === 'number') hlr.focusIndex = clamp(hlr.focusIndex);
  if (typeof hlr.currentIndex === 'number') hlr.currentIndex = clamp(hlr.currentIndex);
}

export function normalizeGridRenderer(gridRenderer, _context = '') {
  if (!gridRenderer || !Array.isArray(gridRenderer.items)) return;
  const count = gridRenderer.items.length;
  if (typeof gridRenderer.visibleItemCount === 'number') gridRenderer.visibleItemCount = count;
  if (typeof gridRenderer.totalItemCount === 'number') gridRenderer.totalItemCount = count;
  if (typeof gridRenderer.currentIndex === 'number') {
    gridRenderer.currentIndex = count <= 0 ? 0 : Math.max(0, Math.min(count - 1, gridRenderer.currentIndex));
  }
}

// ── Video ID extraction helper ────────────────────────────────────────────────

export function getItemVideoId(item) {
  return String(
    item?.tileRenderer?.contentId ||
    item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId ||
    item?.tileRenderer?.onSelectCommand?.watchEndpoint?.playlistId ||
    item?.tileRenderer?.onSelectCommand?.reelWatchEndpoint?.videoId ||
    ''
  );
}

// ── Deep watch-progress extraction ───────────────────────────────────────────

export function collectWatchProgressEntries(node, out = [], depth = 0, seen = new WeakSet()) {
  if (!node || depth > 10) return out;
  if (Array.isArray(node)) { for (const child of node) collectWatchProgressEntries(child, out, depth + 1, seen); return out; }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);
  const id = node.videoId || node.externalVideoId || node.contentId || null;
  const pctRaw = node.watchProgressPercentage ?? node.percentDurationWatched ?? node.watchedPercent ?? null;
  const pct = Number(pctRaw);
  if (id && Number.isFinite(pct)) out.push({ id: String(id), percent: pct, source: 'deep_scan' });
  for (const key of Object.keys(node)) collectWatchProgressEntries(node[key], out, depth + 1, seen);
  return out;
}

// ── Shared playlist button helpers ────────────────────────────────────────────
// playlistContinue.js injects a custom button into the playlist header
// using these shared utilities.

export function getPlaylistButtons(r) {
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

export function injectPlaylistButton(buttons, actionName, label, iconType) {
  if (!Array.isArray(buttons) || !buttons.length) return false;
  if (buttons.some(b =>
    b?.buttonRenderer?.command?.customAction?.action === actionName ||
    b?.buttonRenderer?.serviceEndpoint?.customAction?.action === actionName
  )) return false;
  const existing =
    buttons.find(b => b?.buttonRenderer?.text?.runs || b?.buttonRenderer?.text?.simpleText) ||
    buttons.find(b => b?.buttonRenderer);
  if (!existing) return false;
  const btn = { buttonRenderer: JSON.parse(JSON.stringify(existing.buttonRenderer)) };
  const br = btn.buttonRenderer;
  if (br.text?.runs) {
    br.text.runs[0].text = label;
  } else if (br.text?.simpleText) {
    br.text.simpleText = label;
  } else {
    br.text = { runs: [{ text: label }] };
  }
  if (br.icon) br.icon.iconType = iconType;
  else br.icon = { iconType };
  const cmd = { clickTrackingParams: null, customAction: { action: actionName } };
  br.command = cmd;
  br.serviceEndpoint = cmd;
  if (br.navigationEndpoint) delete br.navigationEndpoint;
  if (br.onLongPressCommand) delete br.onLongPressCommand;
  if (br.accessibilityData) br.accessibilityData = { accessibilityData: { label } };
  buttons.push(btn);
  return true;
}

// ── CSS-based helper tile hider ───────────────────────────────────────────────
// Hides helper tiles by injecting a <style> rule keyed to the video ID.
// More robust than DOM removal because the virtual list re-renders from its
// internal data; CSS persists across re-renders.

const _HELPER_STYLE_ID = 'tt-playlist-helper-hide';

export function updateHelperHideStyle(helperIds) {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(_HELPER_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = _HELPER_STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  if (!helperIds || !helperIds.size) { style.textContent = ''; return; }
  const ids = Array.from(helperIds);
  const selectors = ids.flatMap(id => [
    `[data-video-id="${id}"]`,
    `[video-id="${id}"]`,
    `[data-content-id="${id}"]`,
    `[content-id="${id}"]`,
  ]);
  // visibility:hidden keeps the element in layout (virtual list can still
  // navigate to it), pointer-events:none prevents accidental clicks.
  style.textContent = `${selectors.join(', ')} { visibility: hidden !important; pointer-events: none !important; }`;
}
