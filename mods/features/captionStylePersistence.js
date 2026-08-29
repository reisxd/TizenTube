import { configRead, configWrite, configChangeEmitter } from '../config.js';
import { EVENTS, onPlayer, refreshRawKeys } from '../utils/Captions.js';

const CONFIG_KEYS = {
    ENABLED: 'enableCaptionStylePersistence',
    STYLE: 'captionStyleSettings',
};

const YT_KEYS = [
    'yt-player-caption-display-settings',
];

const LOG_PREFIX = '[CaptionStyle]';

const SAVE_DEBOUNCE_MS = 500;
const APPLY_RETRY_MS = 500;
const APPLY_MAX_ATTEMPTS = 20;

function restoreAndRefreshRawKeys() {
    if (!configRead(CONFIG_KEYS.ENABLED)) return;

    refreshRawKeys(YT_KEYS, LOG_PREFIX);
}

class CaptionStyleHandler {
    #player = null;
    #saveTimeout = null;
    #applyTimeout = null;
    #applyAttempts = 0;
    #hasAppliedStyle = false;

    constructor() {
        this.init();
    }

    init() {
        onPlayer((player) => this.#attachToPlayer(player));
        this.#setupConfigListener();
    }

    #attachToPlayer(player) {
        this.#player = player;

        this.#player.addEventListener(EVENTS.YT_CAPTIONS_SETTINGS_CHANGED, this.#handleSettingsChanged);
        this.#player.addEventListener(EVENTS.YT_CAPTIONS_TRACKLIST_CHANGED, this.#handleTrackListChanged);
        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);

        this.#tryApplyStyle();
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
            if (ev.detail?.key === CONFIG_KEYS.ENABLED && ev.detail?.value) {
                restoreAndRefreshRawKeys();
                this.#hasAppliedStyle = false;
                this.#applyAttempts = 0;
                this.#tryApplyStyle();
            }
        });
    }

    #handleSettingsChanged = () => {
        clearTimeout(this.#saveTimeout);
        this.#saveTimeout = setTimeout(() => this.#saveStyle(), SAVE_DEBOUNCE_MS);
    };

    #handleTrackListChanged = () => {
        this.#applyAttempts = 0;
        this.#tryApplyStyle();
    };

    #handleStateChange = () => {
        if (this.#player?.getPlayerStateObject?.()?.isPlaying) this.#tryApplyStyle();
    };

    #saveStyle() {
        if (!configRead(CONFIG_KEYS.ENABLED)) return;

        const settings = this.#player?.getSubtitlesUserSettings?.();
        if (!settings) return;

        if (JSON.stringify(settings) !== JSON.stringify(configRead(CONFIG_KEYS.STYLE))) {
            console.log(`${LOG_PREFIX} saving new caption style`, settings);
            configWrite(CONFIG_KEYS.STYLE, JSON.parse(JSON.stringify(settings)));
        }
        restoreAndRefreshRawKeys();
    }

    #tryApplyStyle = () => {
        clearTimeout(this.#applyTimeout);

        if (this.#hasAppliedStyle) {
            console.info(`${LOG_PREFIX} #tryApplyStyle: style already applied, doing nothing`);
            return;
        }
        if !configRead(CONFIG_KEYS.ENABLED)) return;

        const savedStyle = configRead(CONFIG_KEYS.STYLE);
        if (!savedStyle) return;

        const settings = this.#player?.getSubtitlesUserSettings?.();
        if (!settings) {
            console.warn(`${LOG_PREFIX} couldn't get subtitle user settings yet, retrying in ${APPLY_RETRY_MS} (attempt ${this.#applyAttempts})`);
            if (this.#applyAttempts < APPLY_MAX_ATTEMPTS) {
                this.#applyAttempts++;
                this.#applyTimeout = setTimeout(this.#tryApplyStyle, APPLY_RETRY_MS);
            } else {
                console.error(`${LOG_PREFIX} hit max attempts to apply caption style, giving up`);
            }
            return;
        }

        try {
            this.#player.updateSubtitlesUserSettings(JSON.parse(JSON.stringify(savedStyle)), true);
            this.#hasAppliedStyle = true;
            console.log(`${LOG_PREFIX} applied caption style`);
        } catch (e) {
            console.warn(`${LOG_PREFIX} failed to apply caption style:`, e);
        }
    };
}

restoreAndRefreshRawKeys();

window.captionStyleHandler = new CaptionStyleHandler();
