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

const originalClasses = {
    ytlrSearchVoice: {
        length: 0,
        classes: []
    },
    ytlrSearchVoiceMicButton: {
        length: 0,
        classes: []
    }
}

const observerPipEnter = new MutationObserver(() => {
    if (!window.isPipPlaying) return;
    const searchBar = document.querySelector('ytlr-search-bar');
    if (searchBar) {
        const pipButtonExists = document.querySelector('#tt-pip-button');
        if (!pipButtonExists) {
            const voiceButton = searchBar.querySelector('ytlr-search-voice');
            if (voiceButton) {
                const iconClassNames = Object.values(window._yttv).find(a => a instanceof Map && a.has("CLEAR_COOKIES"));
                const iconClassToBeRemoved = iconClassNames.get('MICROPHONE_ON');
                const iconClearCookiesClass = iconClassNames.get('CLEAR_COOKIES');
                const pipButton = document.createElement('ytlr-search-voice');
                for (let i = 0; i < voiceButton.classList.length; i++) {
                    if (originalClasses.ytlrSearchVoice.length === 0) {
                        originalClasses.ytlrSearchVoice.length = voiceButton.classList.length;
                    }

                    if (originalClasses.ytlrSearchVoice.length !== voiceButton.classList.length) {
                        for (const className of originalClasses.ytlrSearchVoice.classes) {
                            pipButton.classList.add(className);
                        }
                        break;
                    }

                    if (!originalClasses.ytlrSearchVoice.classes.includes(voiceButton.classList[i]))
                        originalClasses.ytlrSearchVoice.classes.push(voiceButton.classList[i]);

                    pipButton.classList.add(voiceButton.classList[i]);

                }
                pipButton.style.left = '10.25em';
                pipButton.id = 'tt-pip-button';
                const pipButtonMicButton = document.createElement('ytlr-search-voice-mic-button');
                for (let i = 0; i < voiceButton.children[0].classList.length; i++) {
                    if (originalClasses.ytlrSearchVoiceMicButton.length === 0) {
                        originalClasses.ytlrSearchVoiceMicButton.length = voiceButton.children[0].classList.length;
                    }
                    
                    if (originalClasses.ytlrSearchVoiceMicButton.length !== voiceButton.children[0].classList.length) {
                        for (const className of originalClasses.ytlrSearchVoiceMicButton.classes) {
                            pipButtonMicButton.classList.add(className);
                        }
                        break;
                    }

                    if (!originalClasses.ytlrSearchVoiceMicButton.classes.includes(voiceButton.children[0].classList[i]))
                        originalClasses.ytlrSearchVoiceMicButton.classes.push(voiceButton.children[0].classList[i]);

                    pipButtonMicButton.classList.add(voiceButton.children[0].classList[i]);
                }
                const pipIcon = document.createElement('yt-icon');
                for (let i = 0; i < voiceButton.children[0].children[0].classList.length; i++) {
                    pipIcon.classList.add(voiceButton.children[0].children[0].classList[i]);
                }
                pipIcon.classList.remove(iconClassToBeRemoved);
                pipIcon.classList.add(iconClearCookiesClass);

                pipButtonMicButton.appendChild(pipIcon);
                pipButton.appendChild(pipButtonMicButton);
                searchBar.appendChild(pipButton);
            } else {
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
    }
});

observerPipEnter.observe(document.body, { childList: true, subtree: true });

export {
    enablePip,
    pipToFullscreen
}