export function hideShorts(shelves, shortsEnabled) {
  if (shortsEnabled) return;

  for (const shelve of shelves) {
    if (!shelve.shelfRenderer) continue;

    if (shelve.shelfRenderer.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
      shelves.splice(shelves.indexOf(shelve), 1);
      continue;
    }

    shelve.shelfRenderer.content.horizontalListRenderer.items =
      shelve.shelfRenderer.content.horizontalListRenderer.items.filter(
        (item) => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS'
      );
  }
}