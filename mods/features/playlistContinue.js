import { configRead } from '../config.js';
import { appendFileOnlyLog, getWatchPercent } from './hideWatched.js';

// Walks an object up to maxDepth and logs every path that contains the word 'button'
// or 'playlist' in its key — used once to find the real playlistHeaderRenderer path.
function findInterestingPaths(obj, prefix = 'r', depth = 0, maxDepth = 6, out = []) {
  if (!obj || depth > maxDepth) return out;
  if (typeof obj !== 'object') return out;
  for (const key of Object.keys(obj)) {
    const path = `${prefix}.${key}`;
    const lk = key.toLowerCase();
    if (lk.includes('playlist') || lk.includes('button') || lk.includes('header') || lk.includes('action')) {
      out.push({ path, type: typeof obj[key], isArray: Array.isArray(obj[key]), keys: obj[key] && typeof obj[key] === 'object' ? Object.keys(obj[key]).slice(0, 12) : [] });
    }
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      findInterestingPaths(obj[key], path, depth + 1, maxDepth, out);
    }
  }
  return out;
}

function _log(label, payload) {
  appendFileOnlyLog(label, payload);
}

// ── Store current playlist items ─────────────────────────────────────────────
// Called from patchJsonParse whenever a playlist page response arrives.
// Stores the UNFILTERED items so PLAYLIST_CONTINUE can scan watched state.

function storePlItems(r) {
  try {
    const twoCol = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer;
    if (!twoCol) return;

    const plr = twoCol?.rightColumn?.playlistVideoListRenderer;
    if (Array.isArray(plr?.contents)) {
      window.__ttCurrentPlaylistItems = plr.contents.slice();
      _log('playlist.continue.items.stored', { count: window.__ttCurrentPlaylistItems.length });
    }

    // Also pick up items from continuation batches
    const plc = r?.continuationContents?.playlistVideoListContinuation;
    if (Array.isArray(plc?.contents)) {
      if (!Array.isArray(window.__ttCurrentPlaylistItems)) window.__ttCurrentPlaylistItems = [];
      window.__ttCurrentPlaylistItems = window.__ttCurrentPlaylistItems.concat(plc.contents);
      _log('playlist.continue.items.continuation', { total: window.__ttCurrentPlaylistItems.length, added: plc.contents.length });
    }
  } catch (err) {
    _log('playlist.continue.items.error', { msg: String(err?.message || err) });
  }
}

// ── Find and inject the Continue button ──────────────────────────────────────

function tryInjectButton(r) {
  try {
    const twoCol = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer;
    if (!twoCol) {
      // Dump interesting paths so we can find the real structure
      const interesting = findInterestingPaths(r?.contents, 'r.contents');
      _log('playlist.continue.debug.no_twoCol', { interesting: interesting.slice(0, 30) });
      return;
    }

    // Try all known locations for the playlist header
    const leftCol = twoCol?.leftColumn;
    _log('playlist.continue.debug.leftColKeys', { keys: leftCol ? Object.keys(leftCol) : null });

    // Path A: direct playlistHeaderRenderer in leftColumn
    const headerA = leftCol?.playlistHeaderRenderer;
    // Path B: entityMetadataRenderer (newer layout — matches the DOM you shared)
    const headerB = leftCol?.entityMetadataRenderer;
    // Path C: inside a sectionListRenderer
    const slrContents = leftCol?.sectionListRenderer?.contents;
    let headerC = null;
    if (Array.isArray(slrContents)) {
      for (const item of slrContents) {
        if (item?.playlistHeaderRenderer) { headerC = item.playlistHeaderRenderer; break; }
        if (item?.entityMetadataRenderer) { headerC = item.entityMetadataRenderer; break; }
      }
    }

    const header = headerA || headerB || headerC;
    if (!header) {
      const interesting = findInterestingPaths(twoCol.leftColumn, 'leftColumn');
      _log('playlist.continue.debug.no_header', {
        leftColKeys: leftCol ? Object.keys(leftCol) : null,
        interesting: interesting.slice(0, 20),
      });
      return;
    }

    _log('playlist.continue.debug.header_found', {
      path: headerA ? 'leftColumn.playlistHeaderRenderer' : headerB ? 'leftColumn.entityMetadataRenderer' : 'leftColumn.sectionListRenderer.contents[*]',
      headerKeys: Object.keys(header),
    });

    // Find the buttons array — it may be directly on header or nested
    let buttons = header.buttons || header.actionButtons || null;
    if (!buttons && Array.isArray(header.actions)) buttons = header.actions;
    if (!buttons) {
      _log('playlist.continue.debug.no_buttons', { headerKeys: Object.keys(header) });
      return;
    }

    // Don't inject twice
    if (buttons.some(b =>
      b?.buttonRenderer?.command?.commandExecutorCommand?.commands?.[0]?.customAction?.action === 'PLAYLIST_CONTINUE' ||
      b?.buttonRenderer?.serviceEndpoint?.commandExecutorCommand?.commands?.[0]?.customAction?.action === 'PLAYLIST_CONTINUE'
    )) {
      _log('playlist.continue.debug.already_injected', {});
      return;
    }

    // Clone an existing button to match exact structure YouTube TV expects,
    // then swap text/icon/command. This is more reliable than building from scratch.
    const existingButton = buttons.find(b => b?.buttonRenderer);
    if (!existingButton) {
      _log('playlist.continue.debug.no_existing_button', { buttonCount: buttons.length, sample: JSON.stringify(buttons[0])?.slice(0, 200) });
      return;
    }

    const continueButton = JSON.parse(JSON.stringify(existingButton));
    const br = continueButton.buttonRenderer;

    // Set text
    if (br.text?.runs) br.text.runs[0].text = 'Continue';
    else if (br.text?.simpleText) br.text.simpleText = 'Continue';

    // Set icon
    if (br.icon) br.icon.iconType = 'PLAY_ARROW';

    // Set command — try both serviceEndpoint and command shapes
    const cmd = { clickTrackingParams: null, commandExecutorCommand: { commands: [{ customAction: { action: 'PLAYLIST_CONTINUE' } }] } };
    if (br.serviceEndpoint !== undefined) br.serviceEndpoint = cmd;
    else if (br.command !== undefined) br.command = cmd;
    else br.serviceEndpoint = cmd;

    // Clear any accessibility label so it doesn't say the wrong thing
    if (br.accessibilityData) br.accessibilityData = { accessibilityData: { label: 'Continue' } };

    buttons.push(continueButton);
    _log('playlist.continue.injected', { totalButtons: buttons.length });
  } catch (err) {
    _log('playlist.continue.inject.error', { msg: String(err?.message || err) });
  }
}

// ── PLAYLIST_CONTINUE action ─────────────────────────────────────────────────
// Called from resolveCommand.js when the user presses the Continue button.

export function playlistContinue(resolveCommandFn, showToastFn) {
  try {
    const items = window.__ttCurrentPlaylistItems || [];

    if (!items.length) {
      showToastFn('TizenTube', 'No playlist data available. Scroll the playlist first.');
      return;
    }

    const threshold = Number(configRead('hideWatchedVideosThreshold'));

    for (const item of items) {
      // Skip keep-one helper items (watched videos kept temporarily to trigger next batch load)
      if (item?.__ttKeepOneForContinuation) continue;

      const cmd = item?.tileRenderer?.onSelectCommand;
      const videoId = item?.tileRenderer?.contentId || cmd?.watchEndpoint?.videoId;
      if (!videoId || !cmd) continue;

      const watchPercent = getWatchPercent(item);
      const isWatched = watchPercent !== null && Number.isFinite(watchPercent) && watchPercent > threshold;
      if (isWatched) continue;

      _log('playlist.continue.play', { videoId, watchPercent, threshold });
      resolveCommandFn(cmd);
      return;
    }

    showToastFn('TizenTube', 'No unwatched videos found in this playlist.');
    _log('playlist.continue.all_watched', { checked: items.length, threshold });
  } catch (err) {
    _log('playlist.continue.action.error', { msg: String(err?.message || err) });
  }
}

// ── JSON.parse patch ─────────────────────────────────────────────────────────
// Intercepts playlist page responses to store items and inject the button.

const _origParse = JSON.parse;
JSON.parse = function () {
  const r = _origParse.apply(this, arguments);
  try {
    const isPlaylist = (() => {
      try {
        const hash = String(location.hash || '').toLowerCase();
        if (!hash.includes('browse') && !hash.includes('playlist')) return false;
        // Must have a twoColumnRenderer with a rightColumn playlistVideoListRenderer
        return !!(r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer) ||
               !!(r?.continuationContents?.playlistVideoListContinuation);
      } catch { return false; }
    })();

    if (isPlaylist) {
      storePlItems(r);
      if (r?.contents?.tvBrowseRenderer) tryInjectButton(r);
    }
  } catch (_) {}
  return r;
};

window.JSON.parse = JSON.parse;