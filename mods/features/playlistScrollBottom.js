import { appendFileOnlyLog } from './hideWatched.js';

function _log(label, payload) {
  appendFileOnlyLog(label, payload);
}

function buildScrollBottomCommand() {
  return {
    clickTrackingParams: null,
    commandExecutorCommand: {
      commands: [{ customAction: { action: 'PLAYLIST_SCROLL_BOTTOM' } }],
    },
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
      b?.buttonRenderer?.command?.commandExecutorCommand?.commands?.[0]?.customAction?.action === 'PLAYLIST_SCROLL_BOTTOM' ||
      b?.buttonRenderer?.serviceEndpoint?.commandExecutorCommand?.commands?.[0]?.customAction?.action === 'PLAYLIST_SCROLL_BOTTOM'
    );
    if (already) return;

    const existingButton = buttons.find(b => b?.buttonRenderer);
    if (!existingButton) return;

    const scrollButton = JSON.parse(JSON.stringify(existingButton));
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
    const playlistNode = document.querySelector('ytlr-playlist-video-list-renderer')
      || document.querySelector('ytlr-guide-response-panel-renderer [role="list"]')
      || document.querySelector('ytlr-browse-response yt-focus-container[role="list"]')
      || document.querySelector('[data-content-type="playlist"] [role="list"]');

    if (playlistNode) {
      const max = Number.MAX_SAFE_INTEGER;
      let attempt = 0;
      let unchangedCount = 0;
      let lastHeight = -1;
      const maxAttempts = 12;

      const stepScroll = () => {
        try {
          if (typeof playlistNode.scrollTo === 'function') {
            playlistNode.scrollTo({ top: max, behavior: 'auto' });
          } else {
            playlistNode.scrollTop = max;
          }

          const currentHeight = Number(playlistNode.scrollHeight || 0);
          unchangedCount = currentHeight === lastHeight ? unchangedCount + 1 : 0;
          lastHeight = currentHeight;
          attempt++;

          if (attempt >= maxAttempts || unchangedCount >= 2) {
            _log('playlist.scroll.bottom.done', { selector: playlistNode.tagName || 'unknown', attempts: attempt, scrollHeight: currentHeight });
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
