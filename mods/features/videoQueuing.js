window.queuedVideos = {
    videos: [],
    lastVideoId: null
};

import resolveCommand from '../resolveCommand.js';

function addListener() {
    const videoPlayer = document.querySelector('.html5-video-player');
    if (!videoPlayer) return setTimeout(addListener, 250);

    videoPlayer.addEventListener('onStateChange', () => {
        try {
            const playerStateObject = videoPlayer.getPlayerStateObject();
            const videoData = videoPlayer.getVideoData();
            if (window.queuedVideos.videos.length === 0) return;

            if (playerStateObject.isEnded) {
                try {
                    const index = window.queuedVideos.videos.findIndex(v => v.tileRenderer.contentId === videoData.video_id);
                    if (index !== -1) {
                        if (index + 1 >= window.queuedVideos.videos.length) {
                            resolveCommand({ customAction: { action: 'CLEAR_QUEUE' } });
                            return;
                        }
                        const videoWatchEndpoint = window.queuedVideos.videos[index + 1].tileRenderer.onSelectCommand;
                        setTimeout(() => {
                            try { resolveCommand(videoWatchEndpoint); } catch (e) { console.warn('[videoQueuing] resolveCommand failed (index):', e); }
                        }, 500);
                    } else if (window.queuedVideos.lastVideoId) {
                        const lastIndex = window.queuedVideos.videos.findIndex(v => v.tileRenderer.contentId === window.queuedVideos.lastVideoId);
                        if (lastIndex !== -1 && lastIndex + 1 < window.queuedVideos.videos.length) {
                            const videoWatchEndpoint = window.queuedVideos.videos[lastIndex + 1].tileRenderer.onSelectCommand;
                            setTimeout(() => {
                                try { resolveCommand(videoWatchEndpoint); } catch (e) { console.warn('[videoQueuing] resolveCommand failed (lastIndex):', e); }
                            }, 500);
                        } else {
                            resolveCommand({ customAction: { action: 'CLEAR_QUEUE' } });
                            return;
                        }
                    } else {
                        const videoWatchEndpoint = window.queuedVideos.videos[0].tileRenderer.onSelectCommand;
                        setTimeout(() => {
                            try { resolveCommand(videoWatchEndpoint); } catch (e) { console.warn('[videoQueuing] resolveCommand failed (first):', e); }
                        }, 500);
                    }
                } catch (endedErr) {
                    console.warn('[videoQueuing] Error handling isEnded state:', endedErr);
                }
            } else if (playerStateObject.isPlaying) {
                try {
                    const container = document.getElementById('container');
                    if (container) container.style.setProperty('opacity', '1', 'important');
                    if (window.queuedVideos.videos.find(v => v.contentId === videoData.video_id)) {
                        window.queuedVideos.lastVideoId = videoData.video_id;
                    }
                } catch (playingErr) {
                    console.warn('[videoQueuing] Error handling isPlaying state:', playingErr);
                }
            }
        } catch (err) {
            console.warn('[videoQueuing] onStateChange error:', err);
        }
    });
}

addListener();