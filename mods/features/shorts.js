import { configRead } from '../config.js';
import { appendFileOnlyLog } from './hideWatched.js';

// ── Text / metadata helpers ───────────────────────────────────────────────────

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

function parseDurationToSeconds(lengthText) {
  const parts = String(lengthText).trim().split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return null;
}

function hasShortsEndpointMarkers(node, depth = 0, seen = new WeakSet()) {
  if (!node || depth > 7) return false;
  if (Array.isArray(node)) return node.some((child) => hasShortsEndpointMarkers(child, depth + 1, seen));
  if (typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'reelWatchEndpoint' || key === 'shortsLockupViewModel' || key === 'shortsPivotItemRenderer') return true;
    if (typeof value === 'string') {
      const str = value.toLowerCase();
      if (str.includes('/shorts/') || str.includes('web_page_type_shorts') || str.includes('reel_watch') || str.includes('tvhtml5_tile_renderer_type_shorts')) return true;
    }
    if (value && typeof value === 'object' && hasShortsEndpointMarkers(value, depth + 1, seen)) return true;
  }
  return false;
}

function getThumbnailCandidates(renderer, item) {
  return [
    ...(renderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails || []),
    ...(renderer?.thumbnail?.thumbnails || []),
    ...(renderer?.richThumbnail?.movingThumbnailRenderer?.movingThumbnailDetails?.thumbnails || []),
    ...(item?.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails || []),
    ...(item?.tileRenderer?.thumbnail?.thumbnails || []),
  ];
}

// ── Browse ID extraction (used for shorts shelf detection) ────────────────────

function extractBrowseIdsDeep(node, out = new Set(), depth = 0) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) { for (const child of node) extractBrowseIdsDeep(child, out, depth + 1); return out; }
  if (typeof node !== 'object') return out;
  const browseId = node?.browseEndpoint?.browseId;
  if (typeof browseId === 'string' && browseId) out.add(browseId);
  for (const key of Object.keys(node)) extractBrowseIdsDeep(node[key], out, depth + 1);
  return out;
}

export function extractNavTabBrowseId(tab) {
  return Array.from(extractBrowseIdsDeep(tab)).join(',');
}

// ── Short detection ───────────────────────────────────────────────────────────

export function getShortInfo(item, opts = {}) {
  const { pageName = null } = opts;
  if (!item) return { isShort: false, reason: 'no_item', title: 'unknown' };

  const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText
    || item?.videoRenderer?.title?.runs?.[0]?.text
    || item?.videoRenderer?.title?.simpleText
    || item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text
    || 'unknown';

  if (item.reelItemRenderer || item.richItemRenderer?.content?.reelItemRenderer) return { isShort: true, reason: 'reel', title };

  const renderer = item.tileRenderer || item.videoRenderer || item.playlistVideoRenderer
    || item.playlistPanelVideoRenderer || item.gridVideoRenderer || item.compactVideoRenderer
    || item.richItemRenderer?.content?.videoRenderer || item.richItemRenderer?.content?.playlistVideoRenderer
    || item.richItemRenderer?.content?.compactVideoRenderer || item.richItemRenderer?.content?.gridVideoRenderer
    || item.richItemRenderer?.content?.videoWithContextRenderer || item.richItemRenderer?.content?.lockupViewModel
    || item.lockupViewModel;

  if (!renderer) return { isShort: false, reason: 'no_renderer', title };
  if (renderer.tvhtml5ShelfRendererType === 'TVHTML5_TILE_RENDERER_TYPE_SHORTS') return { isShort: true, reason: 'renderer_type', title };
  if (renderer.onSelectCommand?.reelWatchEndpoint) return { isShort: true, reason: 'reelWatchEndpoint', title };
  if (hasShortsEndpointMarkers(item) || hasShortsEndpointMarkers(renderer)) return { isShort: true, reason: 'endpoint_marker', title };

  const allText = collectAllText(item).join(' ').toLowerCase();
  if (/\bshorts?\b/.test(allText)) return { isShort: true, reason: 'shorts_text', title };

  const commandUrl = String(
    renderer?.onSelectCommand?.watchEndpoint?.commandMetadata?.webCommandMetadata?.url
    || renderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
    || item?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || ''
  ).toLowerCase();
  if (commandUrl.includes('/shorts/') || commandUrl.includes('shorts')) return { isShort: true, reason: 'shorts_url', title };

  let lengthText = null;
  const thumbnailOverlays = renderer.header?.tileHeaderRenderer?.thumbnailOverlays || renderer.thumbnailOverlays;
  if (Array.isArray(thumbnailOverlays)) {
    for (const overlay of thumbnailOverlays) {
      const tsr = overlay?.thumbnailOverlayTimeStatusRenderer;
      if (!tsr) continue;
      const style = tsr.style;
      if (style === 'SHORTS' || style === 'SHORTS_TIME_STATUS_STYLE') return { isShort: true, reason: 'overlay_style', title };
      if (!lengthText) lengthText = tsr.text?.simpleText || null;
    }
  }

  if (!lengthText) lengthText = renderer.lengthText?.simpleText || renderer.lengthText?.runs?.[0]?.text || null;

  if (!lengthText) {
    const lines = renderer.metadata?.tileMetadataRenderer?.lines;
    if (Array.isArray(lines)) {
      for (const line of lines) {
        const found = line?.lineRenderer?.items?.find(
          (li) => li.lineItemRenderer?.badge || li.lineItemRenderer?.text?.simpleText
        )?.lineItemRenderer?.text?.simpleText;
        if (found && parseDurationToSeconds(found) !== null) { lengthText = found; break; }
      }
    }
  }

  if (!lengthText) return { isShort: false, reason: 'no_length', title };

  const totalSeconds = parseDurationToSeconds(lengthText);
  if (totalSeconds === null) return { isShort: false, reason: 'length_format_miss', title, lengthText };

  if (pageName === 'subscriptions' && totalSeconds <= 180) {
    return { isShort: true, reason: 'subscriptions_duration_fallback', title, lengthText, totalSeconds };
  }

  return { isShort: false, reason: 'duration_only_not_used', title, lengthText, totalSeconds };
}

// ── Shorts shelf detection ────────────────────────────────────────────────────

export function isShortsShelf(shelve) {
  const shelfRenderer = shelve?.shelfRenderer;
  if (!shelfRenderer) return !!shelve?.reelShelfRenderer;

  if (shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') return true;

  const titleText = [
    String(shelfRenderer?.title?.simpleText || ''),
    collectAllText(shelfRenderer?.header).join(' '),
    collectAllText(shelfRenderer?.headerRenderer).join(' '),
  ].join(' ').toLowerCase();

  if (titleText.includes('short') || titleText.includes('kurz')) return true;

  const browseIds = Array.from(extractBrowseIdsDeep(shelfRenderer)).map(id => String(id).toLowerCase());
  if (browseIds.some(id => id.includes('short') || id.includes('reel'))) return true;

  const firstItem = shelfRenderer?.content?.horizontalListRenderer?.items?.[0];
  if (firstItem?.tileRenderer?.onSelectCommand?.reelWatchEndpoint) return true;
  if (firstItem?.reelItemRenderer) return true;

  return false;
}

// ── Filter shorts from an item array ─────────────────────────────────────────

export function filterShortsFromItems(items, pageName) {
  // Playlist tiles (playlist/playlists pages) are never shorts. Skip the check
  // entirely to avoid noisy shorts.miss log entries for every tile.
  if (!Array.isArray(items) || configRead('enableShorts') || pageName === 'playlist' || pageName === 'playlists') return items;
  const before = items.length;
  const filtered = items.filter(item => {
    const info = getShortInfo(item, { pageName });
    if (info.isShort) return false;
    const r = item?.tileRenderer || item?.videoRenderer || item?.richItemRenderer?.content?.videoRenderer || null;
    const overlays = r?.header?.tileHeaderRenderer?.thumbnailOverlays || r?.thumbnailOverlays || [];
    const overlayStyles = Array.isArray(overlays) ? overlays.map(o => o?.thumbnailOverlayTimeStatusRenderer?.style).filter(Boolean) : [];
    const thumbnails = getThumbnailCandidates(r, item);
    const thumbnailRatios = thumbnails.map(t => { const w = Number(t?.width), h = Number(t?.height); return (w > 0 && Number.isFinite(w) && Number.isFinite(h)) ? Number((h/w).toFixed(3)) : null; }).filter(v => v !== null).slice(0, 6);
    const hasSuspiciousOverlay = overlayStyles.length > 0;
    const hasSuspiciousRatio = thumbnailRatios.some(r => r > 1.4);
    const hasSuspiciousDuration = typeof info.totalSeconds === 'number' && info.totalSeconds <= 180;
    if (hasSuspiciousOverlay || hasSuspiciousRatio || hasSuspiciousDuration) {
      const rendererType = item ? Object.keys(item)[0] : 'none';
      const lines = r?.metadata?.tileMetadataRenderer?.lines;
      const lineTexts = Array.isArray(lines) ? lines.flatMap(l => (l?.lineRenderer?.items||[]).map(li => li?.lineItemRenderer?.text?.simpleText).filter(Boolean)) : [];
      appendFileOnlyLog('shorts.miss', { reason: info.reason, title: info.title, rendererType, shelfType: r?.tvhtml5ShelfRendererType || null, overlayStyles, lengthText: info.lengthText || null, lineTexts, thumbnailRatios, hasReelCmd: !!(r?.onSelectCommand?.reelWatchEndpoint) });
    }
    return true;
  });
  if (before !== filtered.length) appendFileOnlyLog('shorts.continuation.filter', { pageName, before, after: filtered.length });
  return filtered;
}
