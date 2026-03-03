import { configRead } from '../config.js';
import Chapters from '../ui/chapters.js';
import resolveCommand from '../resolveCommand.js';
import { timelyAction, longPressData, MenuServiceItemRenderer, ShelfRenderer, TileRenderer, ButtonRenderer } from '../ui/ytUI.js';
import { PatchSettings } from '../ui/customYTSettings.js';


function appendFileOnlyLog(label, payload) {
  if (!configRead('enableDebugLogging')) return;
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

  if (cParam.includes('fesubscription')) pageName = 'subscriptions';
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

function collectWatchProgressEntries(node, out = [], depth = 0) {
  if (!node || depth > 10) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectWatchProgressEntries(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  const id = node.videoId || node.externalVideoId || node.contentId || null;
  const pctRaw = node.watchProgressPercentage ?? node.percentDurationWatched ?? node.watchedPercent ?? null;
  const pct = Number(pctRaw);
  if (id && Number.isFinite(pct)) {
    out.push({ id: String(id), percent: pct, source: 'deep_scan' });
  }

  for (const key of Object.keys(node)) {
    collectWatchProgressEntries(node[key], out, depth + 1);
  }
  return out;
}

function collectAllText(node, out = []) {
  if (!node) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectAllText(child, out);
    return out;
  }
  if (typeof node === 'object') {
    if (typeof node.simpleText === 'string') out.push(node.simpleText);
    if (Array.isArray(node.runs)) {
      for (const run of node.runs) if (typeof run?.text === 'string') out.push(run.text);
    }
    for (const key of Object.keys(node)) {
      if (key === 'runs' || key === 'simpleText') continue;
      collectAllText(node[key], out);
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

function filterHiddenLibraryTabs(items, context = '') {
  if (!Array.isArray(items)) return items;
  const before = items.length;
  const filtered = items.filter((item) => {
    const contentId = String(item?.tileRenderer?.contentId || '').toLowerCase();
    return !HIDDEN_LIBRARY_TAB_IDS.has(contentId);
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
      if (browseIds.some((id) => HIDDEN_LIBRARY_TAB_IDS.has(id))) {
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
      const browseId = String(extractNavTabBrowseId(tabs[i])).toLowerCase();
      appendFileOnlyLog('library.navtab.check', { browseId, index: i });
      if (HIDDEN_LIBRARY_TAB_IDS.has(browseId)) {
        appendFileOnlyLog('library.navtab.removed', { browseId, index: i });
        tabs.splice(i, 1);
      }
    }
    if (tabs.length !== before)
      appendFileOnlyLog('library.navtabs.result', { before, after: tabs.length });
  }
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
  const adBlockEnabled = configRead('enableAdBlock');

  const detectedPage = detectPageFromResponse(r) || detectCurrentPage();
  window.__ttLastDetectedPage = detectedPage;
  appendFileOnlyLog('json.parse.meta', {
    hash: location.hash || '',
    path: location.pathname || '',
    search: location.search || '',
    detectedPage,
    rootType: Array.isArray(r) ? 'array' : typeof r,
    rootKeys: r && typeof r === 'object' ? Object.keys(r).slice(0, 40) : []
  });
  appendFileOnlyLog('json.parse.full', r);
  const signinReminderEnabled = configRead('enableSigninReminder');

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

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(r.continuationContents.sectionListContinuation.contents, true, detectedPage);
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    deArrowify(r.continuationContents.horizontalListContinuation.items);
    hqify(r.continuationContents.horizontalListContinuation.items);
    addLongPress(r.continuationContents.horizontalListContinuation.items);
    r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items, detectedPage);
    if (detectedPage === 'library') {
      r.continuationContents.horizontalListContinuation.items = filterHiddenLibraryTabs(r.continuationContents.horizontalListContinuation.items, 'continuation.horizontalListContinuation.items');
      pruneLibraryTabsInResponse(r.continuationContents, 'response.continuationContents');
    }
  }

  // FIX (Bug 2): Handle playlist scroll-down continuations.
  // These use TILE_STYLE_YTLR_VERTICAL_LIST tiles and come through a different continuation key.
  if (r?.continuationContents?.playlistVideoListContinuation?.contents) {
    const playlistItems = r.continuationContents.playlistVideoListContinuation.contents;
    appendFileOnlyLog('playlist.continuation.detected', {
      detectedPage,
      itemCount: Array.isArray(playlistItems) ? playlistItems.length : 0,
      hasContinuation: !!r?.continuationContents?.playlistVideoListContinuation?.continuations
    });
    deArrowify(playlistItems);
    hqify(playlistItems);
    addLongPress(playlistItems);
    r.continuationContents.playlistVideoListContinuation.contents = hideVideo(playlistItems, detectedPage);
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
        const contents = tab?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents;
        if (Array.isArray(contents)) {
          processShelves(contents, true, detectedPage);
        }
      }
    }
  }

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

    if (!configRead('enableShorts') && shelve?.reelShelfRenderer) {
      appendFileOnlyLog('shorts.reelShelf.remove', {
        page: activePage,
        reason: 'reelShelfRenderer'
      });
      shelves.splice(i, 1);
      continue;
    }

    if (!shelve.shelfRenderer) continue;

    deArrowify(shelve.shelfRenderer.content.horizontalListRenderer.items);
    hqify(shelve.shelfRenderer.content.horizontalListRenderer.items);
    addLongPress(shelve.shelfRenderer.content.horizontalListRenderer.items);
    if (shouldAddPreviews) {
      addPreviews(shelve.shelfRenderer.content.horizontalListRenderer.items);
    }
    shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(shelve.shelfRenderer.content.horizontalListRenderer.items, activePage);
    if (activePage === 'library') {
      shelve.shelfRenderer.content.horizontalListRenderer.items = filterHiddenLibraryTabs(shelve.shelfRenderer.content.horizontalListRenderer.items, 'processShelves.shelfRenderer.horizontalListRenderer.items');
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
      if (
        shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS' ||
        shelfTitle.includes('short')
      ) {
        appendFileOnlyLog('shorts.shelf.remove', {
          page: activePage,
          reason: 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS',
          shelfTitle: shelve?.shelfRenderer?.title || ''
        });
        // Safe to splice because we are iterating in reverse
        shelves.splice(i, 1);
        continue;
      }

      const beforeShortsFilter = shelve.shelfRenderer.content.horizontalListRenderer.items.length;
      shelve.shelfRenderer.content.horizontalListRenderer.items = shelve.shelfRenderer.content.horizontalListRenderer.items.filter(item => !isLikelyShortItem(item));
      appendFileOnlyLog('shorts.tiles.filter', {
        page: activePage,
        before: beforeShortsFilter,
        after: shelve.shelfRenderer.content.horizontalListRenderer.items.length,
        removed: beforeShortsFilter - shelve.shelfRenderer.content.horizontalListRenderer.items.length
      });
    }
  }
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
  // Iterate in reverse so splicing an adSlotRenderer doesn't shift indices of unvisited items.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.adSlotRenderer) {
      items.splice(i, 1);
      continue;
    }
    if (!item.tileRenderer) continue;
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
  for (const item of items) {
    if (!item.tileRenderer) continue;
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
  }
}

function addLongPress(items) {
  for (const item of items) {
    if (!item.tileRenderer) continue;
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

function hideVideo(items, pageHint = null) {
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
    if (!item.tileRenderer) {
      appendFileOnlyLog('hideVideo.item.skip', {
        pageName,
        rendererKeys: item && typeof item === 'object' ? Object.keys(item).slice(0, 5) : typeof item,
        reason: 'no_tile_renderer'
      });
      return true;
    }

    const tileProgressBar = getTileWatchProgress(item);
    const videoId = String(item?.tileRenderer?.contentId || '');
    const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || videoId || 'unknown';
    const contentId = videoId.toLowerCase();
    const cachedProgress = window._ttVideoProgressCache?.[videoId] ?? null;
    const progressBar = tileProgressBar ?? cachedProgress;
    const progressSource = tileProgressBar?.source || (cachedProgress ? 'entity_cache' : 'none');

    if (pageName === 'library' && HIDDEN_LIBRARY_TAB_IDS.has(contentId)) {
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
      appendFileOnlyLog('hideVideo.item', { pageName, title, videoId, hasProgress: false, progressSource, remove: false, reason: 'no_progress' });
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
