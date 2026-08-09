import { configRead } from '../config.js';

const LEFT_KEY_CODE = 37;
const RIGHT_KEY_CODE = 39;
const DEFAULT_SEEK_INTERVAL = 10;

let handledKeyCode = null;

function getPlayingVideo() {
    const video = document.querySelector('video');
    if (!video || video.paused || video.ended) return null;
    return video;
}

function getSeekInterval() {
    const configuredInterval = Number(configRead('seekInterval'));
    return [5, 10, 15, 20, 30, 60].includes(configuredInterval)
        ? configuredInterval
        : DEFAULT_SEEK_INTERVAL;
}

function consumeEvent(evt) {
    evt.preventDefault();
    evt.stopImmediatePropagation();
}

function handleKeyDown(evt) {
    if (evt.keyCode !== LEFT_KEY_CODE && evt.keyCode !== RIGHT_KEY_CODE) return;

    const video = getPlayingVideo();
    if (!video) return;

    consumeEvent(evt);

    if (handledKeyCode === evt.keyCode && evt.repeat) return;
    handledKeyCode = evt.keyCode;

    const direction = evt.keyCode === LEFT_KEY_CODE ? -1 : 1;
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.min(duration, Math.max(0, video.currentTime + direction * getSeekInterval()));
}

function handleKeyUp(evt) {
    if (evt.keyCode !== handledKeyCode) return;

    if (getPlayingVideo()) consumeEvent(evt);
    handledKeyCode = null;
}

window.addEventListener('keydown', handleKeyDown, true);
window.addEventListener('keyup', handleKeyUp, true);
window.addEventListener('blur', () => {
    handledKeyCode = null;
});
