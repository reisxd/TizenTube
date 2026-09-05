import { configRead } from '../config.js';

const SELECT_KEY_CODE = 13;
const HOLD_DELAY_MS = 500;
const DEFAULT_HOLD_PLAYBACK_RATE = 2;
const SPEED_TOAST_ID = 'tt-hold-speed-toast';

let holdTimer = null;
let heldVideo = null;
let previousPlaybackRate = null;
let selectPressTarget = null;
let isReplayingSelectPress = false;

function getPlayingVideo() {
    const video = document.querySelector('video');
    if (!video || video.paused || video.ended) return null;
    return video;
}

function getHoldPlaybackRate() {
    const configuredSpeed = Number(configRead('holdToSpeed'));
    return configuredSpeed > 0 ? configuredSpeed : DEFAULT_HOLD_PLAYBACK_RATE;
}

function showSpeedToast(playbackRate) {
    let toast = document.getElementById(SPEED_TOAST_ID);
    if (toast) return;

    toast = document.createElement('div');
    toast.id = SPEED_TOAST_ID;
    toast.textContent = `${playbackRate}x`;
    toast.style.cssText = [
        'position:fixed',
        'top:48px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'padding:12px 22px',
        'border-radius:999px',
        'background:rgba(0, 0, 0, 0.82)',
        'color:#fff',
        'font:600 28px Roboto, Arial, sans-serif',
        'line-height:1',
        'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
}

function hideSpeedToast() {
    document.getElementById(SPEED_TOAST_ID)?.remove();
}

function restorePlaybackRate() {
    if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
    }

    if (heldVideo && previousPlaybackRate !== null) {
        heldVideo.playbackRate = previousPlaybackRate;
    }

    heldVideo = null;
    previousPlaybackRate = null;
    hideSpeedToast();
}

function consumeEvent(evt) {
    evt.preventDefault();
    evt.stopImmediatePropagation();
}

function replaySelectPress() {
    if (!selectPressTarget) return;

    isReplayingSelectPress = true;
    try {
        for (const type of ['keydown', 'keyup']) {
            const event = document.createEvent('Event');
            event.initEvent(type, true, true);
            event.keyCode = SELECT_KEY_CODE;
            event.which = SELECT_KEY_CODE;
            selectPressTarget.dispatchEvent(event);
        }
    } finally {
        isReplayingSelectPress = false;
    }
}

function handleKeyDown(evt) {
    if (evt.keyCode !== SELECT_KEY_CODE || isReplayingSelectPress) return;

    if (holdTimer !== null || heldVideo) {
        consumeEvent(evt);
        return;
    }

    const video = getPlayingVideo();
    if (!video) return;

    consumeEvent(evt);
    selectPressTarget = evt.target || document;
    holdTimer = setTimeout(() => {
        holdTimer = null;

        if (video !== getPlayingVideo()) return;

        heldVideo = video;
        previousPlaybackRate = video.playbackRate;
        const playbackRate = getHoldPlaybackRate();
        video.playbackRate = playbackRate;
        showSpeedToast(playbackRate);
    }, HOLD_DELAY_MS);
}

function handleKeyUp(evt) {
    if (evt.keyCode !== SELECT_KEY_CODE || isReplayingSelectPress || !selectPressTarget) return;

    consumeEvent(evt);

    const wasHeldForSpeed = Boolean(heldVideo);
    restorePlaybackRate();
    if (!wasHeldForSpeed) replaySelectPress();
    selectPressTarget = null;
}

window.addEventListener('keydown', handleKeyDown, true);
window.addEventListener('keyup', handleKeyUp, true);
window.addEventListener('blur', () => {
    restorePlaybackRate();
    selectPressTarget = null;
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        restorePlaybackRate();
        selectPressTarget = null;
    }
});
