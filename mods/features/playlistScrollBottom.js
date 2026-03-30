import { appendFileOnlyLog } from './hideWatched.js';

function _log(label, payload) {
  appendFileOnlyLog(label, payload);
}

function getPlaylistScrollTargets() {
  const targets = [];
  const seen = new Set();
  const push = (node) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    targets.push(node);
  };

  const playlistRoot = document.querySelector('ytlr-playlist-video-list-renderer');
  const browseRoot = document.querySelector('ytlr-browse-response');
  push(playlistRoot);
  push(playlistRoot?.querySelector?.('[role="list"]'));
  push(playlistRoot?.querySelector?.('yt-focus-container'));
  push(browseRoot?.querySelector?.('[role="list"]'));

  const scrollables = document.querySelectorAll('ytlr-playlist-video-list-renderer *, ytlr-browse-response *');
  for (const node of scrollables) {
    if (!(node instanceof HTMLElement)) continue;
    const style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    const canScroll = node.scrollHeight > node.clientHeight + 8;
    const overflowScrollable = style && (style.overflowY === 'auto' || style.overflowY === 'scroll');
    if (canScroll && overflowScrollable) push(node);
  }

  push(document.scrollingElement || document.documentElement || document.body);
  return targets;
}

function buildScrollBottomCommand() {
  return {
    clickTrackingParams: null,
    customAction: { action: 'PLAYLIST_SCROLL_BOTTOM' },
  };
}

function getButtons(r) {
  const twoCol = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer;
  if (!twoCol) return null;

  const leftCol = twoCol?.leftColumn;
  const headerA = leftCol?.playlistHeaderRenderer;
  const headerB = leftCol?.entityMetadataRenderer;

  const slrContents = leftCol?.sectionListRenderer?.contents;
  let headerC = null;
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

function tryInjectButton(r) {
  try {
    const buttons = getButtons(r);
    if (!Array.isArray(buttons) || !buttons.length) return;

    const already = buttons.some(b =>
      b?.buttonRenderer?.command?.customAction?.action === 'PLAYLIST_SCROLL_BOTTOM' ||
      b?.buttonRenderer?.serviceEndpoint?.customAction?.action === 'PLAYLIST_SCROLL_BOTTOM' ||
      b?.buttonRenderer?.command?.commandExecutorCommand?.commands?.[0]?.customAction?.action === 'PLAYLIST_SCROLL_BOTTOM' ||
      b?.buttonRenderer?.serviceEndpoint?.commandExecutorCommand?.commands?.[0]?.customAction?.action === 'PLAYLIST_SCROLL_BOTTOM'
    );
    if (already) return;

    const existingButton = buttons.find(b => b?.buttonRenderer);
    if (!existingButton) return;

    const scrollButton = { buttonRenderer: JSON.parse(JSON.stringify(existingButton.buttonRenderer)) };
    const br = scrollButton.buttonRenderer;

    if (br.text?.runs) br.text.runs[0].text = 'Bottom';
    else if (br.text?.simpleText) br.text.simpleText = 'Bottom';

    if (br.icon) br.icon.iconType = 'ARROW_DOWNWARD';

    const cmd = buildScrollBottomCommand();
    br.command = cmd;
    br.serviceEndpoint = cmd;
    if (br.navigationEndpoint) delete br.navigationEndpoint;
    if (br.onLongPressCommand) delete br.onLongPressCommand;
    if (br.longPressCommand) delete br.longPressCommand;

    if (br.accessibilityData) br.accessibilityData = { accessibilityData: { label: 'Scroll to bottom' } };

    buttons.push(scrollButton);
    _log('playlist.scroll.injected', { totalButtons: buttons.length });
  } catch (err) {
    _log('playlist.scroll.inject.error', { msg: String(err?.message || err) });
  }
}

export function playlistScrollBottom(showToastFn) {
  try {
    const targets = getPlaylistScrollTargets();

    if (targets.length) {
      const max = Number.MAX_SAFE_INTEGER;
      let attempt = 0;
      let unchangedCount = 0;
      let lastKey = '';
      const maxAttempts = 12;

      const stepScroll = () => {
        try {
          const metrics = [];
          for (const target of targets) {
            if (!target) continue;
            if (typeof target.scrollTo === 'function') {
              target.scrollTo({ top: max, behavior: 'auto' });
            } else {
              target.scrollTop = max;
            }
            try { target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (_) { }
            metrics.push(`${target.scrollTop}:${target.scrollHeight}:${target.clientHeight}`);
          }
          try {
            const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true });
            document.dispatchEvent(keyEvent);
          } catch (_) { }
          const key = metrics.join('|');
          unchangedCount = key === lastKey ? unchangedCount + 1 : 0;
          lastKey = key;
          attempt++;

          if (attempt >= maxAttempts || unchangedCount >= 2) {
            _log('playlist.scroll.bottom.done', { attempts: attempt, targets: targets.length });
            return;
          }
          setTimeout(stepScroll, 150);
        } catch (err) {
          _log('playlist.scroll.bottom.step_error', { msg: String(err?.message || err), attempt });
        }
      };

      stepScroll();
      return;
    }

    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: 'smooth' });
      _log('playlist.scroll.bottom.window', {});
      return;
    }

    showToastFn('TizenTube', 'Could not find playlist list to scroll.');
  } catch (err) {
    _log('playlist.scroll.action.error', { msg: String(err?.message || err) });
    showToastFn('TizenTube', 'Scroll to bottom failed.');
  }
}

const _origParse = JSON.parse;
JSON.parse = function () {
  const r = _origParse.apply(this, arguments);
  try {
    const isPlaylist = !!(r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer);
    if (isPlaylist && r?.contents?.tvBrowseRenderer) tryInjectButton(r);
  } catch (_) { }
  return r;
};

window.JSON.parse = JSON.parse;
