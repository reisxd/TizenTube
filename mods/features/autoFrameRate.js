import { configRead } from "../config.js";

function attachToVideoPlayer() {
    const video = document.querySelector('.html5-video-player');
    if (!video) return setTimeout(attachToVideoPlayer, 500);

    video.addEventListener('onStateChange', state => {
        try {
            if (state === 1) {
                const statsForNerds = video.getStatsForNerds();

                const resolutionMatch = statsForNerds.resolution.match(/(\d+)x(\d+)@([\d.]+)/);
                if (resolutionMatch) {
                    const fps = resolutionMatch[3];
                    if (configRead('autoFrameRate') && window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate) {
                        window.h5vcc.tizentube.SetFrameRate(parseFloat(fps));
                    }
                }
            } else {
                if (configRead('autoFrameRate') && window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate) {
                    window.h5vcc.tizentube.SetFrameRate(60);
                }
            }
        } catch (e) {
            console.error('Error in auto frame rate handling:', e);
        }
    });
}

attachToVideoPlayer();