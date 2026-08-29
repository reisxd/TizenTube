// Shared utils for player interaction

const SELECTORS = {
    PLAYER: '.html5-video-player',
    VIDEO: 'video',
};

const EVENTS = {
    PLAYER_STATE_CHANGE: 'onStateChange',
    PLAYBACK_START: 'onPlaybackStartExternal',
};

PLAYER_POLL_MS = 100;

/** @type {Element|null} */
let player = null;
/** @type {Function[]} */
const playerWaiters = [];

/**
 * Poll for the player element. Run any pending waiters once found.
 */
function pollForPlayer() {
    const playerElement = document.querySelector(SELECTORS.PLAYER);

    if (!playerElement) {
        setTimeout(pollForPlayer, PLAYER_POLL_MS);
        return;
    }

    player = playerElement;
    for (const waiter of playerWaiters.splice(0)) waiter(player);
}

pollForPlayer();

/**
 * Calls back with the player element as soon as it exists.
 *
 * @param {Function} callback
 * */
export function onPlayer(callback) {
    if (player) {
        callback(player);
        return;
    }
    playerWaiters.push(callback);
}
