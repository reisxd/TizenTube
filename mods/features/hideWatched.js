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

// Single source of truth for browseId → page name.
// Used by all three detection paths (response, hash, browseId).
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

// adblock.js calls detectPageFromBrowseId(tab.browseId) directly.
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
    // Watch page first — highest priority, no browseId needed.
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

// Sync stored page on hash navigation — runs once on import.
if (!window.__ttHideWatchedLocationTrackingInit) {
  window.__ttHideWatchedLocationTrackingInit = true;
  const sync = () => {
    try {
      const p = detectCurrentPage();
      if (p && p !== 'home' && p !== 'search') detectAndStorePage(p, 'nav');
    } catch (_) { }
  };
  try { sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync); } catch (_) {}
}

// ── Watch progress extraction ─────────────────────────────────────────────────

function getWatchPercent(item) {
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

    // Fallback: entity mutation cache populated by adblock.js from frameworkUpdates.
    // YouTube often sends watch progress via mutations separately, not in the tile JSON.
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
      if (!item?.tileRenderer?.contentId) return true; // skip channel cards, nav buttons etc.

      // Keep-one marker: set by filterContinuationItems in adblock.js so YouTube sees at least
      // one visible item and triggers the next batch load.
      if (item.__ttKeepOneForContinuation) {
        const currentSeq = Number(window.__ttParseSeq || 0);
        const itemSeq = Number(item.__ttKeepOneForContinuationParseSeq || 0);
        if (pageName === 'playlist' && itemSeq > 0 && itemSeq === currentSeq) {
          appendFileOnlyLog('hideVideo.keep_one', { pageName, videoId: item?.tileRenderer?.contentId });
          return true;
        }
        // Expired marker — fall through and filter normally.
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

// FIX: The module-level WeakSet prevents the same contents array reference from being
// consolidated twice within a single parse cycle. This is intentional — if the same
// array object appears in two different response paths in one call (unusual but possible),
// the second consolidation would operate on already-merged data and produce wrong row
// counts. WeakSet entries are GC'd automatically when the array itself is collected
// (i.e. after the YouTube TV renderer releases its reference), so between page
// navigations / fresh responses this resets naturally without any manual clearing.
const _seen = new WeakSet();
const CONSOLIDATE_PAGES = new Set(['subscriptions', 'watch']);

export function consolidateShelves(contents, path = 'unknown', pageName = null) {
  appendFileOnlyLog('consolidate.check', { path, contentsLength: contents?.length, pageName });
  if (!configRead('enableHideWatchedVideos')) return;
  if (pageName && !CONSOLIDATE_PAGES.has(pageName)) return;
  if (!Array.isArray(contents)) return;
  if (_seen.has(contents)) { appendFileOnlyLog('consolidate.skip.weakset', { path }); return; }
  _seen.add(contents);

  try {
    const shelves = contents.filter(c => c.shelfRenderer);
    if (!shelves.length) return;

    const allItems = shelves.flatMap(s => s.shelfRenderer.content.horizontalListRenderer.items || []);
    if (!allItems.length) return;

    // Deduplicate by contentId — continuations sometimes re-send items from the
    // previous batch as context, causing the same video to appear twice in allItems.
    const seenIds = new Set();
    const dedupedItems = allItems.filter(item => {
      const id = item?.tileRenderer?.contentId
        || item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId
        || null;
      if (!id) return true; // non-video items (buttons etc) — always keep
      if (seenIds.has(id)) {
        appendFileOnlyLog('consolidate.dedup', { path, videoId: id });
        return false;
      }
      seenIds.add(id);
      return true;
    });

    if (!dedupedItems.length) return;

    const insertAt = contents.findIndex(c => c.shelfRenderer);
    for (let i = contents.length - 1; i >= 0; i--) if (contents[i].shelfRenderer) contents.splice(i, 1);

    const perRow = shelves[0].shelfRenderer.content.horizontalListRenderer._originalRowSize
      || Math.max(...shelves.map(s => s.shelfRenderer.content.horizontalListRenderer.items?.length || 0), 3);
    const template = shelves[0];
    const newShelves = [];

    for (let i = 0; i + perRow <= dedupedItems.length; i += perRow) {
      newShelves.push({
        shelfRenderer: {
          ...template.shelfRenderer,
          content: { horizontalListRenderer: { ...template.shelfRenderer.content.horizontalListRenderer, items: dedupedItems.slice(i, i + perRow) } }
        }
      });
    }

    // If the last batch doesn't fill a complete row, add it as a partial row
    // rather than silently dropping those videos.
    const remainder = dedupedItems.length % perRow;
    if (remainder > 0) {
      const lastBatch = dedupedItems.slice(dedupedItems.length - remainder);
      newShelves.push({
        shelfRenderer: {
          ...template.shelfRenderer,
          content: { horizontalListRenderer: { ...template.shelfRenderer.content.horizontalListRenderer, items: lastBatch } }
        }
      });
    }

    contents.splice(insertAt, 0, ...newShelves);
    appendFileOnlyLog('consolidate.done', { path, totalItems: allItems.length, deduped: allItems.length - dedupedItems.length, newRows: newShelves.length });
  } catch (err) {
    appendFileOnlyLog('consolidate.error', { path, msg: String(err?.message || err) });
  }
}

// ── Entity mutation progress cache ────────────────────────────────────────────
// Called from adblock.js whenever a response contains frameworkUpdates.
// YouTube frequently sends watch progress separately from tile JSON via mutations.

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

export function startEmptyTileObserver() {} // no-op, kept for import compatibility