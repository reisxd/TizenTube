// Picture in Picture Mode for TizenTube

import resolveCommand from "../resolveCommand.js";

window.isPipPlaying = false;
let PlayerService = null;

function pipLoad() {
    try {
        const mappings = Object.values(window._yttv).find(a => a && a.mappings);
        if (!mappings) {
            console.warn('[PiP] Could not find _yttv mappings — PiP will not be available');
            return;
        }

        PlayerService = mappings.get('PlayerService');
        if (!PlayerService) {
            console.warn('[PiP] PlayerService not found in mappings');
            return;
        }

        const PlaybackPreviewService = mappings.get('PlaybackPreviewService');
        if (!PlaybackPreviewService) {
            console.warn('[PiP] PlaybackPreviewService not found in mappings');
            return;
        }

        const PlaybackPreviewServiceStart = PlaybackPreviewService.start;
        const PlaybackPreviewServiceStop = PlaybackPreviewService.stop;

        PlaybackPreviewService.start = function (...args) {
            if (window.isPipPlaying) return;
            return PlaybackPreviewServiceStart.apply(this, args);
        };

        PlaybackPreviewService.stop = function (...args) {
            if (window.isPipPlaying) return;
            return PlaybackPreviewServiceStop.apply(this, args);
        };
    } catch (err) {
        console.warn('[PiP] pipLoad() failed:', err);
    }
}

if (document.readyState === 'complete') {
    pipLoad();
} else {
    window.addEventListener('load', pipLoad);
}

function enablePip() {
    try {
        if (!PlayerService) {
            console.warn('[PiP] enablePip() called but PlayerService is not initialised');
            return;
        }

        const videoElement = document.querySelector('video');
        if (!videoElement) {
            console.warn('[PiP] enablePip() called but no video element found');
            return;
        }

        const timestamp = Math.floor(videoElement.currentTime);

        const ytlrPlayer = document.querySelector('ytlr-player');
        const ytlrPlayerContainer = document.querySelector('ytlr-player-container');

        if (!ytlrPlayer || !ytlrPlayerContainer) {
            console.warn('[PiP] ytlr-player or ytlr-player-container not found');
            return;
        }

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class') {
                    try {
                        if (!ytlrPlayer.classList.contains('ytLrPlayerEnabled')) {
                            function setStyles() {
                                try {
                                    ytlrPlayerContainer.style.zIndex = '10';
                                    ytlrPlayer.style.display = 'block';
                                    ytlrPlayer.style.backgroundColor = 'rgba(0,0,0,0)';
                                } catch (e) {
                                    console.warn('[PiP] setStyles failed:', e);
                                }
                            }

                            setStyles();
                            setTimeout(setStyles, 500);

                            function onPipEnter() {
                                try {
                                    videoElement.style.removeProperty('inset');
                                    const pipWidth = window.innerWidth / 3.5;
                                    const pipHeight = window.innerHeight / 3.5;
                                    videoElement.style.width = `${pipWidth}px`;
                                    videoElement.style.height = `${pipHeight}px`;
                                    videoElement.style.top = '68vh';
                                    videoElement.style.left = '68vw';
                                    window.isPipPlaying = true;
                                } catch (e) {
                                    console.warn('[PiP] onPipEnter failed:', e);
                                }
                                videoElement.removeEventListener('play', onPipEnter);
                            }

                            videoElement.addEventListener('play', onPipEnter);
                            observer.disconnect();

                            setTimeout(() => {
                                try {
                                    PlayerService.loadedPlaybackConfig.watchEndpoint.startTimeSeconds = timestamp;
                                    PlayerService.loadVideo(PlayerService.loadedPlaybackConfig);
                                } catch (e) {
                                    console.warn('[PiP] loadVideo failed:', e);
                                }
                            }, 1000);
                        }
                    } catch (mutErr) {
                        console.warn('[PiP] MutationObserver callback error:', mutErr);
                    }
                }
            });
        });

        observer.observe(ytlrPlayer, { attributes: true });

        // Exit from the current video player
        resolveCommand({ signalAction: { signal: "HISTORY_BACK" } });
    } catch (err) {
        console.warn('[PiP] enablePip() failed:', err);
    }
}

function pipToFullscreen() {
    try {
        if (!PlayerService) {
            console.warn('[PiP] pipToFullscreen() called but PlayerService is not initialised');
            return;
        }
        const videoElement = document.querySelector('video');
        if (!videoElement) {
            console.warn('[PiP] pipToFullscreen() called but no video element found');
            return;
        }
        const { clickTrackingParams, commandMetadata, watchEndpoint } = PlayerService.loadedPlaybackConfig;
        watchEndpoint.startTimeSeconds = Math.floor(videoElement.currentTime);
        const command = { clickTrackingParams, commandMetadata, watchEndpoint };
        resolveCommand(command);
        window.isPipPlaying = false;
    } catch (err) {
        console.warn('[PiP] pipToFullscreen() failed:', err);
        window.isPipPlaying = false;
    }
}

const originalClasses = {
    ytlrSearchVoice: { length: 0, classes: [] },
    ytlrSearchVoiceMicButton: { length: 0, classes: [] }
};

const observerPipEnter = new MutationObserver(() => {
    if (!window.isPipPlaying) return;
    try {
        const searchBar = document.querySelector('ytlr-search-bar');
        if (!searchBar) return;

        const pipButtonExists = document.querySelector('#tt-pip-button');
        if (pipButtonExists) return;

        const voiceButton = searchBar.querySelector('ytlr-search-voice');
        if (voiceButton) {
            try {
                const iconClassNames = Object.values(window._yttv).find(a => a instanceof Map && a.has("CLEAR_COOKIES"));
                if (!iconClassNames) {
                    console.warn('[PiP] Could not find icon class map for PiP button');
                    return;
                }
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
            } catch (voiceErr) {
                console.warn('[PiP] Failed to build PiP button from voice button:', voiceErr);
            }
        } else {
            try {
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
            } catch (fallbackErr) {
                console.warn('[PiP] Failed to build fallback PiP button:', fallbackErr);
            }
        }
    } catch (err) {
        console.warn('[PiP] observerPipEnter callback error:', err);
    }
});

observerPipEnter.observe(document.body, { childList: true, subtree: true });

export { enablePip, pipToFullscreen };