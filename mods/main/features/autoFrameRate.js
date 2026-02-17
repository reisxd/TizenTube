import { configRead } from "../config.js";

function attachToVideoPlayer() {
    const player = document.querySelector('.html5-video-player');
    const video = document.querySelector('video');
    if (!player) return setTimeout(attachToVideoPlayer, 500);

    player.addEventListener('onStateChange', state => {
        try {
            if (state === 1) {
                if (window.location.href.indexOf('watch') === -1) return;
                const statsForNerds = player.getStatsForNerds();

                const resolutionMatch = statsForNerds.resolution.match(/(\d+)x(\d+)@([\d.]+)/);
                const pauseFor = configRead('autoFrameRatePauseVideoFor');

                if (resolutionMatch) {
                    const fps = resolutionMatch[3];
                    if (configRead('autoFrameRate') && window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate) {
                        if (pauseFor > 0) {
                            video.pause();
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
                window.h5vcc.tizentube.SetFrameRate(0);
            }
        }
    });
}

attachToVideoPlayer();