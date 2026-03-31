import { configRead } from '../config.js';
import { appendFileOnlyLog, hideVideo } from './hideWatched.js';

function _log(label, payload) {
  appendFileOnlyLog(label, payload);
}

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

function storePlItems(r) {
  try {
    const twoCol = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer;
    const plr = twoCol?.rightColumn?.playlistVideoListRenderer;
    if (Array.isArray(plr?.contents)) {
      window.__ttCurrentPlaylistItems = plr.contents.slice();
      _log('playlist.continue.items.stored', { count: window.__ttCurrentPlaylistItems.length });
    }
    const plc = r?.continuationContents?.playlistVideoListContinuation;
    if (Array.isArray(plc?.contents)) {
      if (!Array.isArray(window.__ttCurrentPlaylistItems)) window.__ttCurrentPlaylistItems = [];
      const existingIds = new Set(window.__ttCurrentPlaylistItems.map(i =>
        i?.tileRenderer?.contentId || i?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId
      ).filter(Boolean));
      const newItems = plc.contents.filter(i => {
        const id = i?.tileRenderer?.contentId || i?.tileRenderer?.onSelectCommand?.watchEndpoint?.videoId;
        return !id || !existingIds.has(id);
      });
      window.__ttCurrentPlaylistItems = window.__ttCurrentPlaylistItems.concat(newItems);
      _log('playlist.continue.items.continuation', { total: window.__ttCurrentPlaylistItems.length, added: newItems.length });
    }
  } catch (err) {
    _log('playlist.continue.items.error', { msg: String(err?.message || err) });
  }
}

export function playlistContinue(resolveCommandFn, showToastFn) { // showToastFn kept for signature compat
  try {
    const raw = window.__ttCurrentPlaylistItems || [];
    if (!raw.length) {
      _log('playlist.continue.no_data', {});
      return;
    }

    // Re-filter NOW using current _ttVideoProgressCache.
    // __ttCurrentPlaylistItems was stored when the response arrived; watch progress data
    // often arrives later via frameworkUpdates mutations. Re-filtering at press time
    // ensures videos that became "watched" after initial load are excluded.
    const items = hideVideo(raw, 'playlist');
    const helperIds = window.__ttPlaylistHelperVideoIds || new Set();
    const skipped = [];

    for (const item of items) {
      const cmd = item?.tileRenderer?.onSelectCommand;
      const videoId = item?.tileRenderer?.contentId || cmd?.watchEndpoint?.videoId;
      if (!videoId || !cmd) continue;

      if (item?.__ttKeepOneForContinuation || helperIds.has?.(videoId)) {
        skipped.push(videoId);
        continue;
      }

      _log('playlist.continue.play', { videoId, rawItems: raw.length, filteredItems: items.length, skipped: skipped.length });
      resolveCommandFn(cmd);
      return;
    }

    _log('playlist.continue.all_watched.silent', { rawItems: raw.length, filteredItems: items.length, skipped: skipped.length });
    _log('playlist.continue.none_found', { rawItems: raw.length, filteredItems: items.length, skipped: skipped.length });
  } catch (err) {
    _log('playlist.continue.error', { msg: String(err?.message || err) });
  }
}

const _origParse = JSON.parse;
JSON.parse = function () {
  const r = _origParse.apply(this, arguments);
  try {
    const hasPlaylist = !!(r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer);
    const hasContinuation = !!(r?.continuationContents?.playlistVideoListContinuation);
    if (hasPlaylist || hasContinuation) {
      storePlItems(r);
      if (hasPlaylist) {
        const buttons = getButtons(r);
        if (buttons) {
          const injected = injectButton(buttons, 'PLAYLIST_CONTINUE', 'Continue', 'PLAY_ARROW');
          if (injected) _log('playlist.continue.injected', { totalButtons: buttons.length });
        }
      }
    }
  } catch (_) {}
  return r;
};

window.JSON.parse = JSON.parse;