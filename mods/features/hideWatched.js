import { configRead } from '../config.js';

// ===== Logging =====

export function appendFileOnlyLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;
  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];
  let serialized = '';
  try { serialized = JSON.stringify(payload); } catch (_) { serialized = String(payload); }
  window.__ttFileOnlyLogs.push(`[${new Date().toISOString()}] [TT_ADBLOCK_FILE] ${label} ${serialized}`);
  if (window.__ttFileOnlyLogs.length > 5000) window.__ttFileOnlyLogs.shift();
}

export function appendFileOnlyLogOnce(key, payload) {
  if (!configRead('enableDebugLogging')) return;
  if (!window._ttFileDebugOnce) window._ttFileDebugOnce = new Map();
  let serialized = '';
  try { serialized = JSON.stringify(payload); } catch (_) { serialized = String(payload); }
  if (window._ttFileDebugOnce.get(key) === serialized) return;
  window._ttFileDebugOnce.set(key, serialized);
  appendFileOnlyLog(key, serialized);
}

// ===== Page Detection =====

export function detectAndStorePage(pageName, source = 'unknown') {
  if (pageName) {
    const previous = window.__ttLastDetectedPage || null;
    window.__ttLastDetectedPage = pageName;
    if (previous !== pageName) {
      appendFileOnlyLog('page.store', { source, previous, next: pageName, hash: location.hash || '', search: location.search || '' });
    }
  }
  return pageName;
}

export function detectPageFromResponse(response) {
  // Watch page - check first, highest priority
  if (response?.contents?.singleColumnWatchNextResults || response?.playerOverlays || response?.videoDetails) {
    return 'watch';
  }

  const serviceParams = response?.responseContext?.serviceTrackingParams || [];
  for (const entry of serviceParams) {
    for (const param of (entry?.params || [])) {
      if (param?.key !== 'browse_id') continue;
      const browseId = String(param?.value || '').toLowerCase();
      if (!browseId) continue;
      if (browseId.includes('fesubscription')) return 'subscriptions';
      if (browseId.startsWith('uc')) return 'channel';
      if (browseId === 'fehistory') return 'history';
      if (browseId === 'felibrary') return 'library';
      if (browseId === 'feplaylist_aggregation') return 'playlists';
      if (browseId === 'femy_youtube' || browseId === 'vlwl' || browseId === 'vlll' || browseId.startsWith('vlpl')) return 'playlist';
    }
  }

  const targetId = String(response?.contents?.tvBrowseRenderer?.targetId || '').toLowerCase();
  if (targetId.startsWith('browse-feed')) {
    const browseId = targetId.replace('browse-feed', '');
    if (browseId.includes('fesubscription')) return 'subscriptions';
    if (browseId.startsWith('uc')) return 'channel';
    if (browseId === 'fehistory') return 'history';
    if (browseId === 'felibrary') return 'library';
    if (browseId === 'feplaylist_aggregation') return 'playlists';
    if (browseId === 'femy_youtube' || browseId === 'vlwl' || browseId === 'vlll' || browseId.startsWith('vlpl')) return 'playlist';
  }

  const endpointBrowseId = String(response?.currentVideoEndpoint?.watchEndpoint?.browseEndpoint?.browseId || '').toLowerCase();
  if (endpointBrowseId.startsWith('uc')) return 'channel';

  return null;
}

export function detectCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const cParam = (hash.match(/[?&]c=([^&]+)/i)?.[1] || '').toLowerCase();
  let pageName = 'home';

  if (hash.startsWith('/watch')) pageName = 'watch';
  else if (cParam.includes('fesubscription')) pageName = 'subscriptions';
  else if (cParam.startsWith('uc')) pageName = 'channel';
  else if (cParam === 'fehistory') pageName = 'history';
  else if (cParam === 'felibrary') pageName = 'library';
  else if (cParam === 'feplaylist_aggregation') pageName = 'playlists';
  else if (cParam === 'femy_youtube' || cParam === 'vlwl' || cParam === 'vlll' || cParam.startsWith('vlpl')) pageName = 'playlist';
  else if (hash.startsWith('/channel/') || hash.startsWith('/c/') || hash.startsWith('/@')) pageName = 'channel';
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

  return pageName;
}

function initializeLocationPageTracking() {
  if (window.__ttHideWatchedLocationTrackingInit) return;
  window.__ttHideWatchedLocationTrackingInit = true;
  const sync = () => {
    const page = detectCurrentPage();
    if (page && page !== 'home' && page !== 'search') {
      detectAndStorePage(page, 'location-tracker');
    }
  };
  try {
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
  } catch {
    // no-op
  }
}

// ===== Utility Functions =====

export function collectAllText(node, out = [], seen = new WeakSet(), depth = 0) {
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

export function collectWatchProgressEntries(node, out = [], depth = 0, seen = new WeakSet()) {
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

export function getItemVideoId(item) {
  return String(
    item?.tileRenderer?.contentId ||
    item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId ||
    item?.tileRenderer?.onSelectCommand?.watchEndpoint?.playlistId ||
    item?.tileRenderer?.onSelectCommand?.reelWatchEndpoint?.videoId ||
    ''
  );
}

// ===== Watch Progress Helpers =====

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

  // Fallback: any watched/played badge overlay
  const hasWatchedBadge = overlays.some(overlay =>
    overlay.thumbnailOverlayPlaybackStatusRenderer ||
    overlay.thumbnailOverlayPlayedRenderer
  );
  if (hasWatchedBadge) {
    return { percentDurationWatched: 100, source: 'tile_overlay_watched_badge' };
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
  return Object.keys(item).some((key) => /placeholder|skeleton/i.test(key));
}

function getGenericNodeProgress(item) {
  const entries = collectWatchProgressEntries(item);
  if (!entries.length) return null;
  const best = entries.reduce((max, entry) => Number(entry.percent) > Number(max.percent) ? entry : max, entries[0]);
  return { percentDurationWatched: Number(best.percent || 0), source: best.source || 'deep_scan' };
}

// ===== Shorts Detection =====

export function isLikelyShortItem(item) {
  const tile = item?.tileRenderer;
  if (!tile) return false;
  if (tile?.tvhtml5ShelfRendererType === 'TVHTML5_TILE_RENDERER_TYPE_SHORTS') return true;
  // Shorts tiles use reelWatchEndpoint instead of watchEndpoint — most reliable signal.
  if (tile?.onSelectCommand?.reelWatchEndpoint) return true;

  const title = String(getItemTitle(item) || '').toLowerCase();
  if (title.includes('#shorts')) return true;

  // Videos with 2+ hashtags are almost always repurposed Shorts
  const hashtagMatches = title.match(/#[a-z0-9_]+/gi);
  if (hashtagMatches && hashtagMatches.length >= 2) return true;

  const allText = collectAllText(tile);
  const durationCandidate = allText.map(parseDurationToSeconds).find((v) => Number.isFinite(v));
  if (Number.isFinite(durationCandidate) && durationCandidate > 0 && durationCandidate <= 180) return true;

  return false;
}

// ===== hideVideo =====

export function hideVideo(items, pageHint = null) {
  initializeLocationPageTracking();
  if (!Array.isArray(items)) return [];

  const pages = configRead('hideWatchedVideosPages') || [];
  const pageName = pageHint || window.__ttLastDetectedPage || detectCurrentPage();
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  const hideWatchedEnabled = !!configRead('enableHideWatchedVideos');
  const shortsEnabled = !!configRead('enableShorts');

  appendFileOnlyLog('hideVideo.start', {
    pageName,
    threshold,
    configuredPages: pages,
    inputCount: items.length,
    enableHideWatchedVideos: hideWatchedEnabled,
    enableShorts: shortsEnabled
  });

  let removedWatched = 0;
  let removedShorts = 0;

  const result = items.filter(item => {
    try {
      const hasTileRenderer = !!item?.tileRenderer;

      if (!hasTileRenderer) {
        if (isLikelyPlaceholderItem(item)) return false;

        const genericTitle = collectAllText(item).join(' ').trim().substring(0, 120) || 'unknown';
        const genericShortLike = !shortsEnabled && /\bshorts?\b/i.test(genericTitle);
        if (genericShortLike) {
          removedShorts++;
          appendFileOnlyLog('hideVideo.item.generic', { pageName, title: genericTitle, remove: true, reason: 'generic_short_detected' });
          return false;
        }

        const genericProgress = getGenericNodeProgress(item) || (isWatchedByTextSignals(item) ? { percentDurationWatched: 100, source: 'text_signal' } : null);
        if (genericProgress && hideWatchedEnabled && pages.includes(pageName)) {
          const percentWatched = Number(genericProgress.percentDurationWatched || 0);
          const remove = percentWatched > threshold;
          if (remove) removedWatched++;
          appendFileOnlyLog('hideVideo.item.generic', { pageName, title: genericTitle, percentWatched, threshold, remove, source: genericProgress.source });
          return !remove;
        }

        return true;
      }

      // Skip non-video tiles (channel cards, playlist nav buttons, etc.)
      if (!item.tileRenderer.contentId) return true;

      // Keep-one marker: filterContinuationItems in adblock.js marks one item per batch
      // to stay visible so YouTube triggers the next batch load. Always respect it here.
      if (item.__ttKeepOneForContinuation) {
        const currentParseSeq = Number(window.__ttParseSeq || 0);
        const itemParseSeq = Number(item.__ttKeepOneForContinuationParseSeq || 0);
        const stillValid = pageName === 'playlist' && itemParseSeq > 0 && itemParseSeq === currentParseSeq;
        if (stillValid) {
          appendFileOnlyLog('hideVideo.item.keep_one', { pageName, videoId: getItemVideoId(item), parseSeq: itemParseSeq });
          return true;
        }
        // Expired marker — fall through and filter normally
        appendFileOnlyLog('hideVideo.item.keep_one.expired', { pageName, videoId: getItemVideoId(item), itemParseSeq, currentParseSeq });
        delete item.__ttKeepOneForContinuation;
        delete item.__ttKeepOneForContinuationLabel;
        delete item.__ttKeepOneForContinuationParseSeq;
      }

      const shortLike = isLikelyShortItem(item);
      if (!shortsEnabled && shortLike) {
        removedShorts++;
        appendFileOnlyLog('hideVideo.item', { pageName, title: getItemTitle(item), remove: true, reason: 'short_detected' });
        return false;
      }

      const tileProgress = getTileWatchProgress(item);
      const videoId = getItemVideoId(item);
      const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || videoId || 'unknown';

      // Check entity mutation cache (populated from frameworkUpdates in adblock.js)
      const cachedProgress = window._ttVideoProgressCache?.[videoId] ?? null;
      const textWatched = isWatchedByTextSignals(item);
      const progressBar = tileProgress ?? cachedProgress ?? (textWatched ? { percentDurationWatched: 100, source: 'text_signal' } : null);
      const progressSource = tileProgress?.source || (cachedProgress ? 'entity_cache' : textWatched ? 'text_signal' : 'none');

      if (!progressBar) {
        appendFileOnlyLog('hideVideo.noProgress', {
          pageName,
          videoId,
          progressSource,
          tileRendererKeys: Object.keys(item?.tileRenderer || {}).slice(0, 12),
          thumbnailOverlaysLength: (item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || []).length,
          thumbnailOverlaysSample: (item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || []).map(o => Object.keys(o)).slice(0, 4),
        });
        return true;
      }

      if (!hideWatchedEnabled || !pages.includes(pageName)) {
        appendFileOnlyLog('hideVideo.item', { pageName, title, hasProgress: true, percentWatched: Number(progressBar.percentDurationWatched || 0), remove: false, reason: hideWatchedEnabled ? 'page_not_enabled' : 'watched_feature_disabled' });
        return true;
      }

      const percentWatched = Number(progressBar.percentDurationWatched || 0);
      const remove = percentWatched > threshold;
      if (remove) {
        removedWatched++;
        appendFileOnlyLog('hideVideo.removed', { pageName, percentWatched, videoId, source: progressSource });
      } else {
        appendFileOnlyLog('hideVideo.item', { pageName, title, hasProgress: true, percentWatched, threshold, remove: false, reason: 'below_threshold' });
      }
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
    input: items.length,
    output: result.length,
    removedWatched,
    removedShorts
  });

  return result;
}

// ===== processTileArraysDeep =====

export function processTileArraysDeep(node, pageHint = null, path = 'root', depth = 0) {
  if (!node || depth > 10) return;
  const pageName = pageHint || window.__ttLastDetectedPage || detectCurrentPage();

  if (Array.isArray(node)) {
    if (node.some((item) => item?.tileRenderer)) {
      const before = node.length;
      let filtered = hideVideo(node, pageName);

      if (!configRead('enableShorts')) {
        const beforeShorts = filtered.length;
        filtered = filtered.filter(item => !isLikelyShortItem(item));
        if (beforeShorts !== filtered.length) {
          appendFileOnlyLog('deep.tiles.shorts', {
            pageName, path,
            before: beforeShorts,
            after: filtered.length,
            removed: beforeShorts - filtered.length
          });
        }
      }

      if (before !== filtered.length) {
        appendFileOnlyLog('deep.tiles.filtered', {
          pageName, path,
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

// ===== consolidateShelves =====

const _consolidatedArrays = new WeakSet();
const CONSOLIDATE_PAGES = new Set(['subscriptions', 'watch']);

export function consolidateShelves(contents, path = 'unknown', pageName = null) {
  appendFileOnlyLog('consolidate.check', { path, contentsLength: contents?.length, pageName });
  if (!configRead('enableHideWatchedVideos')) return;
  if (pageName && !CONSOLIDATE_PAGES.has(pageName)) return;
  if (_consolidatedArrays.has(contents)) {
    appendFileOnlyLog('consolidate.skip.weakset', { path, contentsLength: contents.length });
    return;
  }
  _consolidatedArrays.add(contents);

  const shelves = contents.filter(c => c.shelfRenderer);
  appendFileOnlyLog('consolidate.begin', { path, contentsLength: contents.length, shelvesFound: shelves.length });
  if (shelves.length === 0) return;

  const allItems = [];
  for (const shelf of shelves) {
    allItems.push(...(shelf.shelfRenderer.content.horizontalListRenderer.items || []));
  }
  if (allItems.length === 0) return;

  // Remember insertion point BEFORE removing shelves so nav buttons stay at the bottom
  const insertAt = contents.findIndex(c => c.shelfRenderer);

  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].shelfRenderer) contents.splice(i, 1);
  }

  const ITEMS_PER_ROW = shelves[0].shelfRenderer.content.horizontalListRenderer._originalRowSize
    || Math.max(...shelves.map(s => s.shelfRenderer.content.horizontalListRenderer.items?.length || 0), 3);
  const template = shelves[0];
  const newShelves = [];

  for (let i = 0; i < allItems.length; i += ITEMS_PER_ROW) {
    const rowItems = allItems.slice(i, i + ITEMS_PER_ROW);
    if (rowItems.length < ITEMS_PER_ROW) break;
    newShelves.push({
      shelfRenderer: {
        ...template.shelfRenderer,
        content: {
          horizontalListRenderer: {
            ...template.shelfRenderer.content.horizontalListRenderer,
            items: rowItems
          }
        }
      }
    });
  }

  // Insert at original shelf position, not at end — keeps nav buttons at bottom
  contents.splice(insertAt, 0, ...newShelves);
  appendFileOnlyLog('consolidate.done', { path, totalItems: allItems.length, newRows: newShelves.length });
}

// ===== startEmptyTileObserver (stub for import compatibility) =====
export function startEmptyTileObserver() {
  // No-op: playlist DOM observation is handled in adblock.js
}