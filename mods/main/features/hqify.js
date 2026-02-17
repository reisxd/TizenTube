export function hqify(items, hqThumbnailsEnabled) {
  if (!hqThumbnailsEnabled) return;

  for (const item of items) {
    if (!item.tileRenderer) continue;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;

    const videoID = item.tileRenderer.onSelectCommand.watchEndpoint.videoId;
    const queryArgs = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0].url.split('?')[1];

    item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
      {
        url: `https://i.ytimg.com/vi/${videoID}/sddefault.jpg${queryArgs ? `?${queryArgs}` : ''}`,
        width: 640,
        height: 480
      }
    ];
  }
}