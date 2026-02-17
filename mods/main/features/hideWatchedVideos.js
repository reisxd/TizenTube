export function hideWatchedVideos(items, pages, watchedThreshold) {
  return items.filter((item) => {
    if (!item.tileRenderer) return true;

    const progressBar = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays
      ?.find((overlay) => overlay.thumbnailOverlayResumePlaybackRenderer)
      ?.thumbnailOverlayResumePlaybackRenderer;

    if (!progressBar) return true;

    const hash = location.hash.substring(1);
    const pageName = hash === '/'
      ? 'home'
      : hash.startsWith('/search')
        ? 'search'
        : hash.split('?')[1].split('&')[0].split('=')[1].replace('FE', '').replace('topics_', '');

    if (!pages.includes(pageName)) return true;

    const percentWatched = progressBar.percentDurationWatched || 0;
    return percentWatched <= watchedThreshold;
  });
}