import resolveCommand from '../resolveCommand.js';

function requestNextAndNavigateChannel(params) {
    const mappings = Object.values(window._yttv).find(a => a && a.mappings);
    const CurrentIdentityService = mappings.get('CurrentIdentityService');
    const KabukiInnerTubeClient = mappings.get('KabukiInnerTubeClient');
    const data = params.tileRenderer;
    const randomDelay = Math.floor(Math.random() * 2000);

    CurrentIdentityService.get().then(identity => {
        const request = {
            identity,
            isPrefetch: false,
            path: '/youtubei/v1/next',
            payload: {
                videoId: data.contentId,
                params: data.onSelectCommand.watchEndpoint.params,
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

export {
    requestNextAndNavigateChannel,
    getGuide
}