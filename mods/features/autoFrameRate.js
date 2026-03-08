import { configRead } from "../config.js";

const currentVideo = '';

function attachToVideoPlayer() {
    const player = document.querySelector('.html5-video-player');
    const video = document.querySelector('video');
    if (!player) return setTimeout(attachToVideoPlayer, 500);

    player.addEventListener('onStateChange', state => {
        try {
            if (state === 1) {
                if (window.location.href.indexOf('watch') === -1) return;
                const statsForNerds = player.getStatsForNerds();
                const videoData = player.getVideoData();

                const resolutionMatch = statsForNerds.resolution.match(/(\d+)x(\d+)@([\d.]+)/);
                const pauseFor = configRead('autoFrameRatePauseVideoFor');

                if (resolutionMatch) {
                    const fps = resolutionMatch[3];
                    if (configRead('autoFrameRate') && window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate) {
                        if (pauseFor > 0 && currentVideo !== videoData.video_id) {
                            video.pause();
                            currentVideo = videoData.video_id;
                            setTimeout(() => {
                                video.play();
                            }, pauseFor);
                        }
                        window.h5vcc.tizentube.SetFrameRate(parseFloat(fps));
                    }
                }
            }
        } catch (e) {
            console.error('Error in auto frame rate handling:', e);
        }
    });

    window.addEventListener('hashchange', () => {
        if (window.location.href.indexOf('watch') > 0) {
            if (configRead('autoFrameRate') && window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate) {
                currentVideo = '';
                window.h5vcc.tizentube.SetFrameRate(0);
            }
        }
    });
}

attachToVideoPlayer();