import { configRead } from '../../config.js';
import { PatchSettings } from '../../ui/customYTSettings.js';
import { registerJsonParseHook } from '../jsonParseHooks.js';
import { applyAdCleanup, applyBrowseAdFiltering } from './adblock.js';
import { applyPreferredVideoCodec } from './videoCodecPreference.js';
import { processShelves, processHorizontalItems } from '../processShelves.js';
import { applySponsorBlockHighlight, applySponsorBlockTimelyActions } from './sponsorblock.js';
import { applyPaidContentOverlay } from './paidContentOverlay.js';
import { applyEndscreen } from './endscreen.js';
import { applyYouThereRenderer } from './youThereRenderer.js';
import { applyQueueShelf } from './queueShelf.js';

function buildShelfProcessingOptions() {
  return {
    deArrowEnabled: configRead('enableDeArrow'),
    deArrowThumbnailsEnabled: configRead('enableDeArrowThumbnails'),
    hqThumbnailsEnabled: configRead('enableHqThumbnails'),
    longPressEnabled: configRead('enableLongPress'),
    previewsEnabled: configRead('enablePreviews'),
    hideWatchedPages: configRead('hideWatchedVideosPages'),
    hideWatchedThreshold: configRead('hideWatchedVideosThreshold'),
    shortsEnabled: configRead('enableShorts')
  };
}

registerJsonParseHook((parsedResponse) => {
  const adBlockEnabled = configRead('enableAdBlock');

  applyAdCleanup(parsedResponse, adBlockEnabled);
  applyPaidContentOverlay(parsedResponse, configRead('enablePaidPromotionOverlay'));
  applyPreferredVideoCodec(parsedResponse, configRead('videoPreferredCodec'));

  applyBrowseAdFiltering(parsedResponse, adBlockEnabled);

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    processShelves(
      parsedResponse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents,
      buildShelfProcessingOptions()
    );
  }

  applyEndscreen(parsedResponse, configRead('enableHideEndScreenCards'));
  applyYouThereRenderer(parsedResponse, configRead('enableYouThereRenderer'));

  if (parsedResponse?.title?.runs) {
    PatchSettings(parsedResponse);
  }

  if (parsedResponse?.contents?.sectionListRenderer?.contents) {
    processShelves(parsedResponse.contents.sectionListRenderer.contents, buildShelfProcessingOptions());
  }

  if (parsedResponse?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(parsedResponse.continuationContents.sectionListContinuation.contents, buildShelfProcessingOptions());
  }

  if (parsedResponse?.continuationContents?.horizontalListContinuation?.items) {
    parsedResponse.continuationContents.horizontalListContinuation.items = processHorizontalItems(
      parsedResponse.continuationContents.horizontalListContinuation.items,
      buildShelfProcessingOptions()
    );
  }

  if (parsedResponse?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
    for (const section of parsedResponse.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections) {
      for (const tab of section.tvSecondaryNavSectionRenderer.tabs) {
        processShelves(
          tab.tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents,
          buildShelfProcessingOptions()
        );
      }
    }
  }

  if (parsedResponse?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    processShelves(
      parsedResponse.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents,
      { ...buildShelfProcessingOptions(), shouldAddPreviews: false }
    );

    applyQueueShelf(parsedResponse);
  }

  applySponsorBlockTimelyActions(parsedResponse, configRead('sponsorBlockManualSkips'));
  applySponsorBlockHighlight(parsedResponse, configRead('enableSponsorBlockHighlight'));

  return parsedResponse;
});