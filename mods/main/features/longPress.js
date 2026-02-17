import { longPressData, MenuServiceItemRenderer } from '../../ui/ytUI.js';

export function addLongPress(items, longPressEnabled) {
  for (const item of items) {
    if (!item.tileRenderer) continue;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;

    if (item.tileRenderer.onLongPressCommand) {
      item.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.push(
        MenuServiceItemRenderer('Add to Queue', {
          clickTrackingParams: null,
          playlistEditEndpoint: {
            customAction: {
              action: 'ADD_TO_QUEUE',
              parameters: item
            }
          }
        })
      );
      continue;
    }

    if (!longPressEnabled) continue;

    const subtitle = item.tileRenderer.metadata.tileMetadataRenderer.lines[0].lineRenderer.items[0].lineItemRenderer.text;
    const data = longPressData({
      videoId: item.tileRenderer.contentId,
      thumbnails: item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails,
      title: item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText,
      subtitle: subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText,
      watchEndpointData: item.tileRenderer.onSelectCommand.watchEndpoint,
      item
    });

    item.tileRenderer.onLongPressCommand = data;
  }
}