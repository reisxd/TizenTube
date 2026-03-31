import { appendFileOnlyLog } from './hideWatched.js';

function _log(label, payload) {
  appendFileOnlyLog(label, payload);
}

// ── Button injection helpers (shared shape with playlistContinue.js) ──────────

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

// ── Find the scrollable container of the playlist virtual list ────────────────
// On YouTube TV, the playlist uses a yt-virtual-list inside ytlr-playlist-video-list-renderer.
// The yt-virtual-list element itself is the scrollable container — its scrollTop controls
// which virtual rows are in view, and the virtual list responds to scroll events on itself.
// We do NOT need focus to be inside the list; setting scrollTop directly works regardless.

function findScrollContainers() {
  const containers = [];
  const seen = new Set();
  const push = (el) => { if (el && !seen.has(el)) { seen.add(el); containers.push(el); } };

  const plRoot = document.querySelector('ytlr-playlist-video-list-renderer');
  if (plRoot) {
    // Primary: the yt-virtual-list inside the playlist renderer
    push(plRoot.querySelector('yt-virtual-list'));
    // Fallback: any element with overflow:auto/scroll inside playlist renderer
    for (const el of plRoot.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      try {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
          push(el);
        }
      } catch (_) {}
    }
    push(plRoot);
  }

  // Last resort: the main scrolling element
  push(document.scrollingElement || document.documentElement);
  return containers;
}

// ── PLAYLIST_LOAD_ALL action ──────────────────────────────────────────────────
// Repeatedly scrolls the playlist virtual list to its bottom.
// When __ttCurrentPlaylistItems grows (new batch arrived via JSON.parse), scrolls again.
// Stops when no new items arrive after a timeout or max iterations are hit.

export function playlistScrollBottom(showToastFn) {
  if (window.__ttLoadAllRunning) {
    _log('playlist.loadall.already_running', {});
    showToastFn('TizenTube', 'Load All is already running…');
    return;
  }

  window.__ttLoadAllRunning = true;
  const startCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;
  let lastCount = startCount;
  let noGrowthTicks = 0;
  let totalScrolls = 0;
  const MAX_NO_GROWTH = 8;   // give up after 8 ticks (~4 s) with no new items
  const MAX_SCROLLS = 200;   // absolute safety limit
  const TICK_MS = 500;

  _log('playlist.loadall.start', { startCount });
  showToastFn('TizenTube', 'Loading all batches…');

  const containers = findScrollContainers();
  _log('playlist.loadall.containers', { count: containers.length, tags: containers.map(c => c.tagName + '.' + (c.className || '').split(' ')[0]) });

  function scrollAll() {
    for (const container of containers) {
      try {
        // Set scrollTop to a very large value — the element clamps it to max
        container.scrollTop = 9999999;
        // Also dispatch a scroll event in case the virtual list uses event listeners
        container.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: false }));
      } catch (_) {}
    }
    totalScrolls++;
  }

  const tick = () => {
    if (!window.__ttLoadAllRunning) return;
    if (totalScrolls >= MAX_SCROLLS) {
      stop('max_scrolls');
      return;
    }

    const currentCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;
    if (currentCount > lastCount) {
      noGrowthTicks = 0;
      lastCount = currentCount;
      _log('playlist.loadall.batch', { currentCount, totalScrolls });
    } else {
      noGrowthTicks++;
    }

    if (noGrowthTicks >= MAX_NO_GROWTH) {
      stop('no_growth');
      return;
    }

    scrollAll();
    setTimeout(tick, TICK_MS);
  };

  function stop(reason) {
    window.__ttLoadAllRunning = false;
    const finalCount = Array.isArray(window.__ttCurrentPlaylistItems) ? window.__ttCurrentPlaylistItems.length : 0;
    _log('playlist.loadall.done', { reason, startCount, finalCount, totalScrolls });
    showToastFn('TizenTube', `Loaded ${finalCount} videos. Press Continue to play first unwatched.`);
  }

  // Kick off first scroll immediately, then start polling
  scrollAll();
  setTimeout(tick, TICK_MS);
}

// ── JSON.parse patch ──────────────────────────────────────────────────────────

const _origParse = JSON.parse;
JSON.parse = function () {
  const r = _origParse.apply(this, arguments);
  try {
    const hasPlaylist = !!(r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer);
    if (hasPlaylist) {
      const buttons = getButtons(r);
      if (buttons) {
        const injected = injectButton(buttons, 'PLAYLIST_SCROLL_BOTTOM', 'Load All', 'ARROW_DOWNWARD');
        if (injected) _log('playlist.loadall.injected', { totalButtons: buttons.length });
      }
    }
  } catch (_) {}
  return r;
};

window.JSON.parse = JSON.parse;