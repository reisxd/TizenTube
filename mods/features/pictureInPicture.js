// Picture in Picture Mode for TizenTube

import resolveCommand from "../resolveCommand.js";

window.isPipPlaying = false;
let PlayerService = null;

function pipLoad() {
    const mappings = Object.values(window._yttv).find(a => a && a.mappings);
    PlayerService = mappings.get('PlayerService');
    const PlaybackPreviewService = mappings.get('PlaybackPreviewService');
    const PlaybackPreviewServiceStart = PlaybackPreviewService.start;
    const PlaybackPreviewServiceStop = PlaybackPreviewService.stop;


    PlaybackPreviewService.start = function (...args) {
        if (window.isPipPlaying) return;
        return PlaybackPreviewServiceStart.apply(this, args);
    }

    PlaybackPreviewService.stop = function (...args) {
        if (window.isPipPlaying) return;
        return PlaybackPreviewServiceStop.apply(this, args);
    }
}

if (document.readyState === 'complete') {
    pipLoad();
} else window.addEventListener('load', pipLoad);

function enablePip() {
    if (!PlayerService) return;
    const timestamp = Math.floor(document.querySelector('video').currentTime);
    const videoElement = document.querySelector('video');

    const ytlrPlayer = document.querySelector('ytlr-player');
    const ytlrPlayerContainer = document.querySelector('ytlr-player-container');

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                if (!ytlrPlayer.classList.contains('ytLrPlayerEnabled')) {
                    function setStyles() {
                        ytlrPlayerContainer.style.zIndex = '10';
                        ytlrPlayer.style.display = 'block';
                        ytlrPlayer.style.backgroundColor = 'rgba(0,0,0,0)';
                    }

                    setStyles();
                    setTimeout(setStyles, 500);

                    function onPipEnter() {
                        videoElement.style.removeProperty('inset');
                        const pipWidth = window.innerWidth / 3.5;
                        const pipHeight = window.innerHeight / 3.5;
                        videoElement.style.width = `${pipWidth}px`;
                        videoElement.style.height = `${pipHeight}px`;
                        videoElement.style.top = '68vh';
                        videoElement.style.left = '68vw';

                        window.isPipPlaying = true;
                        videoElement.removeEventListener('play', onPipEnter);
                    }

                    videoElement.addEventListener('play', onPipEnter);
                    observer.disconnect();

                    setTimeout(() => {
                        PlayerService.loadedPlaybackConfig.watchEndpoint.startTimeSeconds = timestamp;
                        PlayerService.loadVideo(PlayerService.loadedPlaybackConfig);
                    }, 1000);
                }
            }
        });
    });

    observer.observe(ytlrPlayer, { attributes: true });

    // Exit from the current video player
    resolveCommand({
        signalAction: {
            signal: "HISTORY_BACK"
        }
    });
}

function pipToFullscreen() {
    const { clickTrackingParams, commandMetadata, watchEndpoint } = PlayerService.loadedPlaybackConfig;
    watchEndpoint.startTimeSeconds = Math.floor(document.querySelector('video').currentTime);
    const command = {
        clickTrackingParams,
        commandMetadata,
        watchEndpoint
    };
    resolveCommand(command);
    window.isPipPlaying = false;
};

const observerPipEnter = new MutationObserver(() => {
    if (!window.isPipPlaying) return;
    const searchBar = document.querySelector('ytlr-search-bar');
    if (searchBar) {
        const pipButtonExists = document.querySelector('#tt-pip-button');
        if (!pipButtonExists) {
            const pipButton = document.createElement('ytlr-search-voice');
            pipButton.style.left = '10.25em';
            pipButton.id = 'tt-pip-button';
            pipButton.setAttribute('idomkey', 'ytLrSearchBarSearchVoice');
            pipButton.setAttribute('tabindex', '0');
            pipButton.classList.add('ytLrSearchVoiceHost', 'ytLrSearchBarSearchVoice');
            const pipButtonMicButton = document.createElement('ytlr-search-voice-mic-button');
            pipButtonMicButton.setAttribute('hybridnavfocusable', 'true');
            pipButtonMicButton.setAttribute('tabindex', '-1');
            pipButtonMicButton.classList.add('ytLrSearchVoiceMicButtonHost', 'zylon-ve');
            const pipIcon = document.createElement('yt-icon');
            pipIcon.setAttribute('tabindex', '-1');
            pipIcon.classList.add('ytContribIconTvArrowLeft', 'ytContribIconHost', 'ytLrSearchVoiceMicButtonIcon');

            pipButtonMicButton.appendChild(pipIcon);
            pipButton.appendChild(pipButtonMicButton);
            searchBar.appendChild(pipButton);
        }
    }
});

observerPipEnter.observe(document.body, { childList: true, subtree: true });

export {
    enablePip,
    pipToFullscreen
}