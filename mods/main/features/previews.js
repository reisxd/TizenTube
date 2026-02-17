export function addPreviews(items, previewsEnabled) {
  if (!previewsEnabled) return;

  for (const item of items) {
    if (!item.tileRenderer) continue;

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