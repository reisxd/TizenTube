function parseTimestamps(input) {
    var lines = input.trim().split('\n');
    var result = [];
    var timestampRegex = /^\d+:\d{2}/;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var match = line.match(timestampRegex);
        if (match) {
            var timePart = match[0];
            var parts = line.split(' ');
            parts.shift();
            var timeParts = timePart.split(':');
            var minutes = parseInt(timeParts[0], 10);
            var seconds = parseInt(timeParts[1], 10);
            var milliseconds = (minutes * 60 + seconds) * 1000;
            var name = parts.join(' ');
            result.push({ time: milliseconds, name: name });
        }
    }
    return result;
}

function marker(title, start, duration, videoID, i) {
    return {
        title: {
            simpleText: title
        },
        startMillis: start,
        durationMillis: duration,
        thumbnailDetails: {
            thumbnails: [
                {
                    url: `https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`,
                    width: 320,
                    height: 180
                }
            ]
        },
        onActive: {
            innertubeCommand: {
                clickTrackingParams: null,
                entityUpdateCommand: {
                    entityBatchUpdate: {
                        mutations: [
                            {
                                entityKey: `${videoID}${start}${duration}`,
                                type: 'ENTITY_MUTATION_TYPE_REPLACE',
                                payload: {
                                    markersEngagementPanelSyncEntity: {
                                        key: `${videoID}${start}${duration}`,
                                        panelId: 'engagement-panel-macro-markers-description-chapters',
                                        activeItemIndex: i,
                                        syncEnabled: true
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        }
    }
}

function markerEntity(videoID, markers) {
    return {
        entityKey: `${videoID}-key`,
        type: 'ENTITY_MUTATION_TYPE_REPLACE',
        payload: {
            macroMarkersListEntity: {
                key: `${videoID}-key`,
                externalVideoId: videoID,
                markersList: {
                    markerType: 'MARKER_TYPE_CHAPTERS',
                    markers: markers,
                    headerTitle: {
                        runs: [{ text: 'Chapters' }]
                    },
                    onTap: {
                        innertubeCommand: {
                            clickTrackingParams: null,
                            changeEngagementPanelVisibilityAction: {
                                targetId: 'engagement-panel-macro-markers-description-chapters',
                                visibility: 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'
                            }
                        }
                    },
                    markersEdu: {
                        enterNudgeText: { runs: [{ text: 'To view chapters, press the up arrow button' }] },
                        enterNudgeA11yText: 'To view chapters, press the up arrow button',
                        navNudgeText: { runs: [{ text: 'Navigate between chapters' }] },
                        navNudgeA11yText: 'Press the left or right arrow button to navigate between chapters'
                    },
                    loggingDirectives: {
                        trackingParams: null,
                        enableDisplayloggerExperiment: true
                    }
                }
            }
        }
    }
}

export default function Chapters(video) {
    try {
        // FIX: The deep property chain and video element access can all throw if the
        // response structure changes or if the video element isn't ready yet.
        const videoMeta = video?.contents?.singleColumnWatchNextResults?.results?.results
            ?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.videoMetadataRenderer;

        if (!videoMeta) {
            console.warn('[Chapters] Could not find videoMetadataRenderer in response');
            return null;
        }

        const videoID = videoMeta.videoId;
        if (!videoID) {
            console.warn('[Chapters] videoId missing from videoMetadataRenderer');
            return null;
        }

        const descriptionRuns = videoMeta?.description?.runs;
        if (!Array.isArray(descriptionRuns) || descriptionRuns.length === 0) {
            console.info('[Chapters] No description runs found for', videoID);
            return null;
        }

        const videoDescription = descriptionRuns[0].text;
        if (!videoDescription) {
            console.info('[Chapters] Empty description for', videoID);
            return null;
        }

        const chapters = parseTimestamps(videoDescription);
        if (!chapters.length) {
            console.info('[Chapters] No timestamps found in description for', videoID);
            return null;
        }

        const videoEl = document.getElementsByTagName('video')[0];
        if (!videoEl || !videoEl.duration || !Number.isFinite(videoEl.duration)) {
            console.warn('[Chapters] Video element not ready or duration unavailable for', videoID);
            return null;
        }

        const videoDuration = videoEl.duration * 1000;
        const markers = [];

        for (let i = 0; i < chapters.length; i++) {
            try {
                const chapter = chapters[i];
                const nextChapter = chapters[i + 1];
                const duration = nextChapter ? nextChapter.time - chapter.time : videoDuration - chapter.time;
                markers.push(marker(chapter.name, String(chapter.time), String(duration), videoID, i));
            } catch (markerErr) {
                console.warn('[Chapters] Failed to build marker at index', i, markerErr);
            }
        }

        if (!markers.length) {
            console.warn('[Chapters] No markers built for', videoID);
            return null;
        }

        return markerEntity(videoID, markers);
    } catch (err) {
        console.warn('[Chapters] Chapters() failed:', err);
        return null;
    }
}