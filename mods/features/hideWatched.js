import { configRead } from '../config.js';

function debugLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;
  appendFileOnlyLog(label, payload);
}

function appendFileOnlyLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;
  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];

  let serialized = '';
  try { serialized = JSON.stringify(payload); } catch (_) { serialized = String(payload); }
  window.__ttFileOnlyLogs.push(`[${new Date().toISOString()}] [TT_ADBLOCK_FILE] ${label} ${serialized}`);
  if (window.__ttFileOnlyLogs.length > 5000) window.__ttFileOnlyLogs.shift();
}

export function detectAndStorePage(pageName, source = 'unknown') {
  if (pageName) {
    const previous = window.__ttLastDetectedPage || null;
    window.__ttLastDetectedPage = pageName;
    if (previous !== pageName) {
      debugLog('page.store', { source, previous, next: pageName, hash: location.hash || '', search: location.search || '' });
    }
  }
  return pageName;
}

export function detectPageFromResponse(response) {
  const serviceParams = response?.responseContext?.serviceTrackingParams || [];
  for (const entry of serviceParams) {
    for (const param of (entry?.params || [])) {
      if (param?.key !== 'browse_id') continue;
      const browseId = String(param?.value || '').toLowerCase();
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
  }

  if (response?.contents?.singleColumnWatchNextResults) {
    debugLog('page.detect.response', { from: 'watchNext', detected: 'watch' });
    return 'watch';
  }

  const endpointBrowseId = String(response?.currentVideoEndpoint?.watchEndpoint?.browseEndpoint?.browseId || '').toLowerCase();
  if (endpointBrowseId.startsWith('uc')) {
    debugLog('page.detect.response', { from: 'endpointBrowseId', endpointBrowseId, detected: 'channel' });
    return 'channel';
  }

  debugLog('page.detect.response', { from: 'none', detected: null, hash: location.hash || '', lastDetected: window.__ttLastDetectedPage || null });
  return null;
}

export function detectPageFromBrowseId(browseId) {
  const normalizedBrowseId = String(browseId || '').toLowerCase();
  if (!normalizedBrowseId) {
    debugLog('page.detect.browseId', { browseId: browseId || null, detected: null });
    return null;
  }
  if (normalizedBrowseId.includes('fesubscription')) return 'subscriptions';
  if (normalizedBrowseId.startsWith('uc')) return 'channel';
  if (normalizedBrowseId === 'fehistory') return 'history';
  if (normalizedBrowseId === 'felibrary') return 'library';
  if (normalizedBrowseId === 'feplaylist_aggregation') return 'playlists';
  if (normalizedBrowseId === 'femy_youtube' || normalizedBrowseId === 'vlwl' || normalizedBrowseId === 'vlll' || normalizedBrowseId.startsWith('vlpl')) return 'playlist';
  debugLog('page.detect.browseId', { browseId: normalizedBrowseId, detected: null });
  return null;
}

function parsePercentValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function getThumbnailOverlaysFromNode(node) {
  return node?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays
    || node?.tileRenderer?.thumbnailOverlays
    || node?.tileRenderer?.thumbnail?.thumbnails?.[0]?.overlays
    || node?.videoRenderer?.thumbnailOverlays
    || node?.gridVideoRenderer?.thumbnailOverlays
    || node?.compactVideoRenderer?.thumbnailOverlays
    || node?.lockupViewModel?.contentImage?.thumbnailViewModel?.overlays
    || node?.lockupViewModel?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.overlays
    || [];
}

function extractWatchProgress(node, depth = 0, seen = new WeakSet()) {
  if (!node || depth > 7) return null;
  if (typeof node !== 'object') return null;
  if (seen.has(node)) return null;
  seen.add(node);

  const overlays = getThumbnailOverlaysFromNode(node);
  const resumeOverlay = overlays.find(overlay => overlay.thumbnailOverlayResumePlaybackRenderer)?.thumbnailOverlayResumePlaybackRenderer;
  if (resumeOverlay) {
    const resumePercent = parsePercentValue(resumeOverlay.percentDurationWatched);
    if (resumePercent !== null) return resumePercent;
    // Presence of resume overlay means watched progress exists; treat missing percent as watched.
    return 100;
  }

  const hasWatchedBadge = overlays.some(overlay =>
    overlay.thumbnailOverlayPlaybackStatusRenderer ||
    overlay.thumbnailOverlayPlayedRenderer
  );
  if (hasWatchedBadge) {
    return 100;
  }

  const badgeText = JSON.stringify(node?.tileRenderer?.metadata?.tileMetadataRenderer?.lines || []);
  const styleBadges = node?.tileRenderer?.badges || [];
  const hasWatchedStyleBadge = styleBadges.some((badge) => {
    const style = String(badge?.metadataBadgeRenderer?.style || '').toLowerCase();
    const label = String(badge?.metadataBadgeRenderer?.label || '').toLowerCase();
    return style.includes('watched') || label.includes('watched');
  });
  if (hasWatchedStyleBadge || badgeText.toLowerCase().includes('watched')) {
    return 100;
  }

  const direct = parsePercentValue(
    node.watchProgressPercentage
    ?? node.percentDurationWatched
    ?? node.watchedPercent
    ?? node?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched
    ?? node?.lockupViewModel?.progressPercentage
  );
  if (direct !== null) {
    return direct;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const childProgress = extractWatchProgress(child, depth + 1, seen);
      if (childProgress !== null) return childProgress;
    }
    return null;
  }

  for (const key of Object.keys(node)) {
    const childProgress = extractWatchProgress(node[key], depth + 1, seen);
    if (childProgress !== null) return childProgress;
  }

  return null;
}

function readChannelParamFromHash(hashValue) {
  const hash = String(hashValue || '');
  const match = hash.match(/(?:^|[?&])c=([^&]+)/i) || hash.match(/^c=([^&]+)/i);
  return (match?.[1] || '').toLowerCase();
}

export function detectCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const cParam = readChannelParamFromHash(hash) || readChannelParamFromHash(location.search);

  if (cParam.includes('fesubscription')) return 'subscriptions';
  if (cParam.startsWith('uc')) return 'channel';
  if (hash.startsWith('/channel/') || hash.startsWith('/c/') || hash.startsWith('/@')) return 'channel';
  if (cParam === 'felibrary') return 'library';
  if (cParam === 'fehistory') return 'history';
  if (cParam === 'feplaylist_aggregation') return 'playlists';
  if (cParam === 'femy_youtube' || cParam === 'vlwl' || cParam === 'vlll' || cParam.startsWith('vlpl')) return 'playlist';
  if (hash.startsWith('/watch')) return 'watch';

  try {
    return hash === '/'
      ? 'home'
      : hash.startsWith('/search')
        ? 'search'
        : (hash.split('?')[1]?.split('&')[0]?.split('=')[1] || 'home').replace('FE', '').replace('topics_', '');
  } catch {
    return 'home';
  }
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

export function hideVideo(items, pageHint = null) {
  initializeLocationPageTracking();
  let loggedContext = false;
  let loggedNoProgressChannel = false;

  return items.filter(item => {
    try {
      if (!configRead('enableHideWatchedVideos')) return true;

      const pages = configRead('hideWatchedVideosPages');
      const hashPage = detectCurrentPage();

      let pageName = pageHint;
      if (hashPage && hashPage !== 'home' && hashPage !== 'search') {
        pageName = hashPage;
      } else if (!pageName) {
        pageName = (hashPage === 'home' || hashPage === 'search')
          ? (window.__ttLastDetectedPage || hashPage)
          : hashPage;
      }

      if (configRead('enableDebugLogging') && !loggedContext) {
        loggedContext = true;
        appendFileOnlyLog('hideVideo.context', { pageHint, hashPage, pageName, lastDetected: window.__ttLastDetectedPage || null, hash: location.hash || '' });
      }
      if (configRead('enableDebugLogging') && pageHint && pageHint !== pageName) {
        appendFileOnlyLog('hideVideo.page.override', { pageHint, hashPage, pageName });
      }

      if (!pages.includes(pageName)) {
        return true;
      }

      if (!item?.tileRenderer?.contentId) return true; // skip non-video tiles (channel cards, nav buttons)
      const percentWatched = extractWatchProgress(item);

      if (percentWatched === null) {
        if (!loggedNoProgressChannel && configRead('enableDebugLogging') && (pageName === 'channel' || pageName === 'watch')) {
          loggedNoProgressChannel = true;
          appendFileOnlyLog('hideVideo.noProgress', {
            pageHint,
            hashPage,
            pageName,
            tileRendererKeys: Object.keys(item?.tileRenderer || {}).slice(0, 12),
            headerKeys: Object.keys(item?.tileRenderer?.header || {}).slice(0, 12),
            tileHeaderRendererKeys: Object.keys(item?.tileRenderer?.header?.tileHeaderRenderer || {}).slice(0, 12),
            thumbnailOverlaysLength: (item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || []).length,
            thumbnailOverlaysSample: (item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || []).map(o => Object.keys(o)).slice(0, 4),
          });
        }
        return true;
      }

      const keep = percentWatched <= configRead('hideWatchedVideosThreshold');
      if (!keep) {
        appendFileOnlyLog('hideVideo.removed', {
          pageName,
          percentWatched,
          videoId: item?.tileRenderer?.contentId || item?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId || null
        });
      }
      return keep;
    } catch {
      return true;
    }
  });
}

function isLikelyVideoItem(item) {
  return Boolean(
    item?.tileRenderer
    || item?.videoRenderer
    || item?.gridVideoRenderer
    || item?.compactVideoRenderer
    || item?.lockupViewModel
  );
}

export function processTileArraysDeep(node, pageHint = null, path = 'root', depth = 0) {
  if (!node || depth > 10) return;

  if (Array.isArray(node)) {
    if (node.some((item) => isLikelyVideoItem(item))) {
      const before = node.length;
      const filtered = hideVideo(node, pageHint);
      
      if (!configRead('enableShorts')) {
        filtered = filtered.filter(item => item?.__ttKeepOneForContinuation || !isLikelyShortItem(item));
      }

      if (before !== filtered.length) {
        appendFileOnlyLog('deep.tiles.filtered', {
          path,
          pageHint,
          before,
          after: filtered.length,
          removed: before - filtered.length
        });
      } else if (configRead('enableDebugLogging') && (pageHint === 'channel' || detectCurrentPage() === 'channel')) {
        appendFileOnlyLog('deep.tiles.noop.channel', {
          path,
          pageHint,
          before,
          sampleKeys: Object.keys(node.find(Boolean) || {}).slice(0, 8)
        });
      }
      node.splice(0, node.length, ...filtered);
      return;
    }

    for (let i = 0; i < node.length; i++) {
      processTileArraysDeep(node[i], pageHint, `${path}[${i}]`, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    processTileArraysDeep(node[key], pageHint, `${path}.${key}`, depth + 1);
  }
}

const _consolidatedArrays = new WeakSet();
const CONSOLIDATE_PAGES = new Set(['subscriptions', 'watch']);

export function consolidateShelves(contents, path = 'unknown', pageName = null) {
  appendFileOnlyLog('consolidate.check', { path, contentsLength: contents.length, pageName });
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
    allItems.push(...shelf.shelfRenderer.content.horizontalListRenderer.items);
  }
  if (allItems.length === 0) return;

  // ↓ Remember insertion point BEFORE removing shelves
  const insertAt = contents.findIndex(c => c.shelfRenderer);

  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].shelfRenderer) contents.splice(i, 1);
  }

  const ITEMS_PER_ROW = shelves[0].shelfRenderer.content.horizontalListRenderer._originalRowSize
    || Math.max(...shelves.map(s => s.shelfRenderer.content.horizontalListRenderer.items.length), 3);
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

  // ↓ Insert at original shelf position, not at the end
  contents.splice(insertAt, 0, ...newShelves);
  appendFileOnlyLog('consolidate.done', { path, totalItems: allItems.length, newRows: newShelves.length });
}