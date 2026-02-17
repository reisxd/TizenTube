export function deArrowify(items, deArrowEnabled, deArrowThumbnailsEnabled) {
  for (const item of items) {
    if (item.adSlotRenderer) {
      const index = items.indexOf(item);
      items.splice(index, 1);
      continue;
    }

    if (!item.tileRenderer || !deArrowEnabled) continue;

    const videoID = item.tileRenderer.contentId;
    fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.titles.length > 0) {
          const mostVoted = data.titles.reduce((max, title) => (max.votes > title.votes ? max : title));
          item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title;
        }

        if (data.thumbnails.length > 0 && deArrowThumbnailsEnabled) {
          const mostVotedThumbnail = data.thumbnails.reduce((max, thumbnail) =>
            max.votes > thumbnail.votes ? max : thumbnail
          );
          if (mostVotedThumbnail.timestamp) {
            item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
              {
                url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${mostVotedThumbnail.timestamp}`,
                width: 1280,
                height: 640
              }
            ];
          }
        }
      })
      .catch(() => {});
  }
}