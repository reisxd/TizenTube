import resolveCommand from '../resolveCommand.js';

function requestNextAndNavigateChannel(params) {
    const mappings = Object.values(window._yttv).find(a => a && a.mappings);
    const CurrentIdentityService = mappings.get('CurrentIdentityService');
    const KabukiInnerTubeClient = mappings.get('KabukiInnerTubeClient');
    const videoId = params.tileRenderer ? params.tileRenderer.contentId : params.lockupViewModel.contentId;
    const paramsValue = params.tileRenderer ? params.tileRenderer.onSelectCommand.watchEndpoint.params : params.lockupViewModel.rendererContext.commandContext.onTap.innertubeCommand.watchEndpoint.params;
    const randomDelay = Math.floor(Math.random() * 2000);

    CurrentIdentityService.get().then(identity => {
        const request = {
            identity,
            isPrefetch: false,
            path: '/youtubei/v1/next',
            payload: {
                videoId,
                params: paramsValue,
                racyCheckOk: true,
                contentCheckOk: true,
                playbackContext: {
                    lactMilliseconds: randomDelay,
                    isLyricsMode: false
                },
                autonavState: 'STATE_NONE',
                mdxContext: {
                    mdxReceiverContext: {
                        mdxConnectedDevices: []
                    }
                }
            },
            clickTracking: {
                clickTrackingParams: null,
            }
        }

        KabukiInnerTubeClient.fetch(request).subscribe((response) => {
            const contents = response?.contents?.singleColumnWatchNextResults?.results?.results?.contents;
            if (contents) {
                const itemSectionRenderer = contents.find(item => item.itemSectionRenderer);
                const videoMetadataRenderer = itemSectionRenderer?.itemSectionRenderer?.contents?.find(item => item.videoMetadataRenderer);
                if (videoMetadataRenderer) {
                    const navigation = videoMetadataRenderer.videoMetadataRenderer?.owner?.videoOwnerRenderer?.navigationEndpoint;
                    if (navigation) resolveCommand(navigation);
                }
            }
        });
    });
}

function getGuide() {
    const mappings = Object.values(window._yttv).find(a => a && a.mappings);
    const KabukiInnerTubeClient = mappings.get('KabukiInnerTubeClient');

    const request = {
        path: '/youtubei/v1/guide'
    };

    return new Promise((resolve, _) => {
        KabukiInnerTubeClient.fetch(request).subscribe((response) => {
           resolve(response);
        });
    });
}

// Recursively find a feedbackToken inside a (possibly nested) innertube command.
// The "Not interested" / "Don't recommend channel" panel items carry their token either
// directly (onTap.innertubeCommand.feedbackEndpoint) or wrapped in an openPopupAction
// (onTap.innertubeCommand.openPopupAction...commandExecutorCommand.commands[].feedbackEndpoint).
function findFeedbackToken(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.feedbackToken === 'string') return obj.feedbackToken;
    for (const value of Object.values(obj)) {
        const token = findFeedbackToken(value);
        if (token) return token;
    }
    return null;
}

// YouTube moved the feedback tokens out of the long press menu into an engagement
// panel (panelId + params). Fetch the panel and return its feedback tokens in order:
// [0] = "Not interested", [1] = "Don't recommend channel".
function getFeedbackPanelTokens(panelId, params) {
    const mappings = Object.values(window._yttv).find(a => a && a.mappings);
    const KabukiInnerTubeClient = mappings.get('KabukiInnerTubeClient');

    const request = {
        path: '/youtubei/v1/get_panel',
        payload: {
            panelId,
            params
        }
    };

    return new Promise((resolve, reject) => {
        KabukiInnerTubeClient.fetch(request).subscribe((response) => {
            const listItems = response?.content?.engagementPanelSectionListRenderer?.content?.listViewModel?.listItems;
            if (!Array.isArray(listItems)) {
                resolve([]);
                return;
            }
            resolve(
                listItems
                    .map((item) => findFeedbackToken(item?.listItemViewModel))
                    .filter(Boolean)
            );
        }, reject);
    });
}

// Send a feedback token (e.g. "Not interested" / "Don't recommend channel") to YouTube.
// The response may contain a followUpDialog with dismissal reasons that should be
// presented to the user (see markFeedback in resolveCommand.js).
function sendFeedbackToken(feedbackToken) {
    const mappings = Object.values(window._yttv).find(a => a && a.mappings);
    const KabukiInnerTubeClient = mappings.get('KabukiInnerTubeClient');

    const request = {
        path: '/youtubei/v1/feedback',
        payload: {
            feedbackTokens: [feedbackToken]
        }
    };

    return new Promise((resolve, reject) => {
        KabukiInnerTubeClient.fetch(request).subscribe((response) => {
            resolve(response);
        }, reject);
    });
}

export {
    requestNextAndNavigateChannel,
    getGuide,
    findFeedbackToken,
    getFeedbackPanelTokens,
    sendFeedbackToken
}