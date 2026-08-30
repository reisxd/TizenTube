import { configRead } from '../config.js';

const LEFT_KEY_CODE = 37;
const RIGHT_KEY_CODE = 39;
const DEFAULT_SEEK_INTERVAL = 10;
const PROGRESS_BAR_SELECTOR = 'ytlr-progress-bar, ytlr-redux-connect-ytlr-progress-bar';

let handledKeyCode = null;

function getSeekInterval() {
    const configuredInterval = Number(configRead('seekInterval'));
    return [5, 10, 15, 20, 30, 60].includes(configuredInterval)
        ? configuredInterval
        : DEFAULT_SEEK_INTERVAL;
}

function isProgressBarFocused() {
    const progressBars = document.querySelectorAll(PROGRESS_BAR_SELECTOR);

    for (const progressBar of progressBars) {
        if (progressBar.matches(':focus, .zylon-focus')) return true;
        if (progressBar.querySelector(':focus, .zylon-focus')) return true;
    }

    return false;
}

function consumeEvent(evt) {
    evt.preventDefault();
    evt.stopImmediatePropagation();
}

function handleKeyDown(evt) {
    if (evt.keyCode !== LEFT_KEY_CODE && evt.keyCode !== RIGHT_KEY_CODE) return;
    if (!isProgressBarFocused()) return;

    const video = document.querySelector('video');
    if (!video || video.ended) return;

    consumeEvent(evt);
    handledKeyCode = evt.keyCode;

    const direction = evt.keyCode === LEFT_KEY_CODE ? -1 : 1;
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    const targetTime = video.currentTime + direction * getSeekInterval();
    video.currentTime = Math.min(duration, Math.max(0, targetTime));
}

function handleKeyUp(evt) {
    if (evt.keyCode !== handledKeyCode) return;

    consumeEvent(evt);
    handledKeyCode = null;
}

// Only take over directional input while the progress bar owns focus. All
// other player controls and closed-player-UI behavior remain native.
window.addEventListener('keydown', handleKeyDown, true);
window.addEventListener('keyup', handleKeyUp, true);
window.addEventListener('blur', () => {
    handledKeyCode = null;
});
