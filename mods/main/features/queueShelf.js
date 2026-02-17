import { TileRenderer, ShelfRenderer } from '../../ui/ytUI.js';

export function applyQueueShelf(parsedResponse) {
  if (!parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) return;
  if (window.queuedVideos.videos.length === 0) return;

  const queuedVideosClone = window.queuedVideos.videos.slice();
  queuedVideosClone.unshift(
    TileRenderer('Clear Queue', {
      customAction: {
        action: 'CLEAR_QUEUE'
      }
    })
  );

  parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(
    ShelfRenderer(
      'Queued Videos',
      queuedVideosClone,
      queuedVideosClone.findIndex((video) => video.contentId === window.queuedVideos.lastVideoId) !== -1
        ? queuedVideosClone.findIndex((video) => video.contentId === window.queuedVideos.lastVideoId)
        : 0
    )
  );
}