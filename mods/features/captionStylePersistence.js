import { configRead, configWrite, configChangeEmitter } from '../config.js';

const SELECTORS = {
    PLAYER: '.html5-video-player',
};

const EVENTS = {
    YT_STATE_CHANGE: 'onStateChange',
    YT_CAPTIONS_SETTINGS_CHANGED: 'captionssettingschanged',
    YT_CAPTIONS_TRACKLIST_CHANGED: 'onCaptionsTrackListChanged',
    CONFIG_CHANGE: 'configChange',
};

const CONFIG_KEYS = {
    ENABLED: 'enableCaptionStylePersistence',
    STYLE: 'captionStyleSettings',
    CAPTIONS_ON: 'captionsEnabled',
    CAPTIONS_ON_COMMAND: 'captionsOnCommand',
    RAW_BACKUPS: 'captionRawKeyBackups',
};

const YT_KEYS = [
    'yt-player-caption-display-settings',
    'yt-player-sticky-caption',
    'yt-player-caption-sticky-language',
];

const CAPTION_COMMAND_KEY = /^[a-z]*(subtitles?|captions?)[a-z]*(command|endpoint|action)$/i;

const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 500;
const APPLY_RETRY_MS = 500;
const APPLY_MAX_ATTEMPTS = 20;
const COMMAND_OUTCOME_MS = 1000;
const RESTORE_RETRY_MS = 1000;
const RESTORE_MAX_ATTEMPTS = 5;

function restoreAndRefreshRawKeys() {
    if (!configRead(CONFIG_KEYS.ENABLED)) return;

    const backups = configRead(CONFIG_KEYS.RAW_BACKUPS) || {};
    let backupsChanged = false;

    for (const key of YT_KEYS) {
        try {
            const stored = localStorage[key];
            if (stored) {
                const wrapper = JSON.parse(stored);
                if (backups[key] !== wrapper.data) {
                    backups[key] = wrapper.data;
                    backupsChanged = true;
                }
                localStorage[key] = JSON.stringify({ data: wrapper.data, expiration: Date.now() + FAR_FUTURE_MS, creation: Date.now() });
            } else if (backups[key] !== undefined) {
                localStorage[key] = JSON.stringify({ data: backups[key], expiration: Date.now() + FAR_FUTURE_MS, creation: Date.now() });
            }
        } catch (e) {
            console.warn('[CaptionStyle] Failed to refresh key', key, e);
        }
    }

    if (backupsChanged) configWrite(CONFIG_KEYS.RAW_BACKUPS, backups);
}

function findCaptionCommand(cmd, nested = false) {
    if (!cmd || typeof cmd !== 'object') return null;

    for (const key in cmd) {
        if (CAPTION_COMMAND_KEY.test(key) && cmd[key] && typeof cmd[key] === 'object') {
            return { [key]: cmd[key] };
        }
    }

    const commands = cmd.commandExecutorCommand?.commands;
    if (!nested && Array.isArray(commands)) {
        for (const command of commands) {
            const found = findCaptionCommand(command, true);
            if (found) return found;
        }
    }

    return null;
}

class CaptionStyleHandler {
    #player = null;
    #resolveCommand = null;
    #attachTimeout = null;
    #patchTimeout = null;
    #saveTimeout = null;
    #applyTimeout = null;
    #restoreTimeout = null;
    #applyAttempts = 0;
    #restoreAttempts = 0;
    #hasAppliedStyle = false;
    #lastVideoId = null;
    #captionsRestored = false;

    constructor() {
        this.init();
    }

    init() {
        this.#pollForPlayer();
        this.#patchResolveCommand();
        this.#setupConfigListener();
    }

    #pollForPlayer() {
        clearTimeout(this.#attachTimeout);

        const playerElement = document.querySelector(SELECTORS.PLAYER);

        if (!playerElement) {
            this.#attachTimeout = setTimeout(() => this.#pollForPlayer(), 500);
            return;
        }

        this.#player = playerElement;

        this.#player.addEventListener(EVENTS.YT_CAPTIONS_SETTINGS_CHANGED, this.#handleSettingsChanged);
        this.#player.addEventListener(EVENTS.YT_CAPTIONS_TRACKLIST_CHANGED, this.#handleTrackListChanged);
        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);

        this.#tryApplyStyle();
    }

    #patchResolveCommand() {
        clearTimeout(this.#patchTimeout);

        const yttvInstance = window._yttv && Object.values(window._yttv).find(
            (obj) => obj && obj.instance && typeof obj.instance.resolveCommand === 'function'
        );

        if (!yttvInstance) {
            this.#patchTimeout = setTimeout(() => this.#patchResolveCommand(), 500);
            return;
        }

        if (yttvInstance.instance.resolveCommand.isPatchedByCaptionPersistence) {
            this.#resolveCommand = (cmd) => yttvInstance.instance.resolveCommand(cmd);
            return;
        }

        const originalResolveCommand = yttvInstance.instance.resolveCommand;
        const handler = this;
        this.#resolveCommand = (cmd) => originalResolveCommand.call(yttvInstance.instance, cmd);

        yttvInstance.instance.resolveCommand = function (cmd, _) {
            const captionCommand = findCaptionCommand(cmd);
            if (captionCommand) handler.#observeCaptionCommand(captionCommand);
            return originalResolveCommand.call(this, cmd, _);
        };
        yttvInstance.instance.resolveCommand.isPatchedByCaptionPersistence = true;
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
            if (ev.detail?.key === CONFIG_KEYS.ENABLED && ev.detail?.value) {
                restoreAndRefreshRawKeys();
                this.#hasAppliedStyle = false;
                this.#applyAttempts = 0;
                this.#captionsRestored = false;
                this.#tryApplyStyle();
                this.#tryRestoreCaptions();
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
        this.#tryRestoreCaptions();
    };

    #handleStateChange = () => {
        const state = this.#player?.getPlayerStateObject?.();
        const videoId = this.#player?.getVideoData?.()?.video_id;

        if (videoId !== this.#lastVideoId) {
            this.#lastVideoId = videoId;
            this.#captionsRestored = false;
            this.#restoreAttempts = 0;
        }

        if (state?.isPlaying) {
            this.#tryApplyStyle();
            this.#tryRestoreCaptions();
        }
    };

    #isSubtitlesOn() {
        try {
            return this.#player.isSubtitlesOn() === true;
        } catch (e) {
            return false;
        }
    }

    #hasCaptionTracks() {
        try {
            const captionTracks = this.#player?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            return Array.isArray(captionTracks) && captionTracks.length > 0;
        } catch (e) {
            return false;
        }
    }

    #observeCaptionCommand(captionCommand) {
        if (!configRead(CONFIG_KEYS.ENABLED) || !this.#player) return;

        const wasOn = this.#isSubtitlesOn();

        setTimeout(() => {
            const isOn = this.#isSubtitlesOn();
            if (isOn === wasOn) return;

            this.#captionsRestored = true;
            configWrite(CONFIG_KEYS.CAPTIONS_ON, isOn);
            if (isOn) configWrite(CONFIG_KEYS.CAPTIONS_ON_COMMAND, JSON.parse(JSON.stringify(captionCommand)));
        }, COMMAND_OUTCOME_MS);
    }

    #saveStyle() {
        if (!configRead(CONFIG_KEYS.ENABLED)) return;

        const settings = this.#player?.getSubtitlesUserSettings?.();
        if (!settings) return;

        if (JSON.stringify(settings) !== JSON.stringify(configRead(CONFIG_KEYS.STYLE))) {
            configWrite(CONFIG_KEYS.STYLE, JSON.parse(JSON.stringify(settings)));
        }
        restoreAndRefreshRawKeys();
    }

    #tryRestoreCaptions() {
        clearTimeout(this.#restoreTimeout);

        if (this.#captionsRestored || !configRead(CONFIG_KEYS.ENABLED)) return;

        const command = configRead(CONFIG_KEYS.CAPTIONS_ON_COMMAND);
        if (command && !findCaptionCommand(command)) {
            configWrite(CONFIG_KEYS.CAPTIONS_ON_COMMAND, null);
            configWrite(CONFIG_KEYS.CAPTIONS_ON, null);
        }
        if (configRead(CONFIG_KEYS.CAPTIONS_ON) !== true || !configRead(CONFIG_KEYS.CAPTIONS_ON_COMMAND) || !this.#resolveCommand) {
            this.#captionsRestored = true;
            return;
        }

        if (!this.#hasCaptionTracks() || !this.#player?.getPlayerStateObject?.()?.isPlaying) return;

        if (this.#isSubtitlesOn() || this.#restoreAttempts >= RESTORE_MAX_ATTEMPTS) {
            this.#captionsRestored = true;
            return;
        }

        this.#restoreAttempts++;

        try {
            this.#resolveCommand(JSON.parse(JSON.stringify(command)));
        } catch (e) {
            console.warn('[CaptionStyle] Failed to restore captions:', e);
        }

        this.#restoreTimeout = setTimeout(() => this.#tryRestoreCaptions(), RESTORE_RETRY_MS);
    }

    #tryApplyStyle = () => {
        clearTimeout(this.#applyTimeout);

        if (this.#hasAppliedStyle || !configRead(CONFIG_KEYS.ENABLED)) return;

        const savedStyle = configRead(CONFIG_KEYS.STYLE);
        if (!savedStyle) return;

        const settings = this.#player?.getSubtitlesUserSettings?.();
        if (!settings) {
            if (this.#applyAttempts < APPLY_MAX_ATTEMPTS) {
                this.#applyAttempts++;
                this.#applyTimeout = setTimeout(this.#tryApplyStyle, APPLY_RETRY_MS);
            }
            return;
        }

        try {
            this.#player.updateSubtitlesUserSettings(JSON.parse(JSON.stringify(savedStyle)), true);
            this.#hasAppliedStyle = true;
        } catch (e) {
            console.warn('[CaptionStyle] Failed to apply caption style:', e);
        }
    };
}

restoreAndRefreshRawKeys();

window.captionStyleHandler = new CaptionStyleHandler();
