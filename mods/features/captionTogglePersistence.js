import { configRead, configWrite, configChangeEmitter } from '../config.js';
import { EVENTS, onPlayer, refreshRawKeys } from '../utils/Captions.js';

const CONFIG_KEYS = {
    ENABLED: 'enableCaptionTogglePersistence',
    CAPTIONS_ON: 'captionsEnabled',
    CAPTIONS_ON_COMMAND: 'captionsOnCommand',
};

const YT_KEYS = [
    'yt-player-sticky-caption',
    'yt-player-caption-sticky-language',
];

const CAPTION_COMMAND_KEY = /^[a-z]*(subtitles?|captions?)[a-z]*(command|endpoint|action)$/i;

const LOG_PREFIX = '[CaptionToggle]';

const PATCH_RETRY_MS = 500;
const COMMAND_OUTCOME_MS = 1000;
const RESTORE_RETRY_MS = 1000;
const RESTORE_MAX_ATTEMPTS = 5;

function restoreAndRefreshRawKeys() {
    if (!configRead(CONFIG_KEYS.ENABLED)) return;

    refreshRawKeys(YT_KEYS, LOG_PREFIX);
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

class CaptionToggleHandler {
    #player = null;
    #resolveCommand = null;
    #patchTimeout = null;
    #restoreTimeout = null;
    #restoreAttempts = 0;
    #lastVideoId = null;
    #captionsRestored = false;

    constructor() {
        this.init();
    }

    init() {
        onPlayer((player) => this.#attachToPlayer(player));
        this.#patchResolveCommand();
        this.#setupConfigListener();
    }

    #attachToPlayer(player) {
        this.#player = player;

        this.#player.addEventListener(EVENTS.YT_CAPTIONS_TRACKLIST_CHANGED, this.#handleTrackListChanged);
        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);
    }

    #patchResolveCommand() {
        clearTimeout(this.#patchTimeout);

        const yttvInstance = window._yttv && Object.values(window._yttv).find(
            (obj) => obj && obj.instance && typeof obj.instance.resolveCommand === 'function'
        );

        if (!yttvInstance) {
            this.#patchTimeout = setTimeout(() => this.#patchResolveCommand(), PATCH_RETRY_MS);
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
                this.#captionsRestored = false;
                this.#restoreAttempts = 0;
                this.#tryRestoreCaptions();
            }
        });
    }

    #handleTrackListChanged = () => {
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

        if (state?.isPlaying) this.#tryRestoreCaptions();
    };

    #isSubtitlesOn() {
        try {
            return this.#player.isSubtitlesOn() === true;
        } catch (e) {
            console.error(`${LOG_PREFIX} unable to check if captions are on`);
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
        console.debug(`${LOG_PREFIX} #observeCaptionCommand:`, captionCommand);

        if (!configRead(CONFIG_KEYS.ENABLED) || !this.#player) return;

        setTimeout(() => {
            const isOn = this.#isSubtitlesOn();
            const isTrackSelection = !!captionCommand.selectSubtitlesTrackCommand;
            if (isOn === wasOn) {
                console.info(`${LOG_PREFIX} captions already on, nothing to do`);
                return;
            }
            if (!isTrackSelection) {
                console.info(`${LOG_PREFIX} caption command was track selection, not changing caption toggle`);
                return;
            }

            this.#captionsRestored = true;
            configWrite(CONFIG_KEYS.CAPTIONS_ON, isOn);
            if (isOn) configWrite(CONFIG_KEYS.CAPTIONS_ON_COMMAND, JSON.parse(JSON.stringify(captionCommand)));
        }, COMMAND_OUTCOME_MS);
    }

    #tryRestoreCaptions() {
        clearTimeout(this.#restoreTimeout);

        if (this.#captionsRestored) {
            console.info(`${LOG_PREFIX} #tryRestoreCaptions: captions already restored, doing nothing`);
            return;
        }
        if (!configRead(CONFIG_KEYS.ENABLED)) return;

        const command = configRead(CONFIG_KEYS.CAPTIONS_ON_COMMAND);
        if (command && !findCaptionCommand(command)) {
            console.warn(`${LOG_PREFIX} failed to find caption command, clearing config`);
            configWrite(CONFIG_KEYS.CAPTIONS_ON_COMMAND, null);
            configWrite(CONFIG_KEYS.CAPTIONS_ON, null);
        }
        if (configRead(CONFIG_KEYS.CAPTIONS_ON) !== true || !configRead(CONFIG_KEYS.CAPTIONS_ON_COMMAND) || !this.#resolveCommand) {
            this.#captionsRestored = true;
            return;
        }

        if (!this.#hasCaptionTracks()) {
            console.info(`${LOG_PREFIX} video has no caption tracks, not attempting to enable captions`);
            return;
        }

        if (!this.#player?.getPlayerStateObject?.()?.isPlaying) {
            console.info(`${LOG_PREFIX} no video playing, not attempting to toggle captions`);
            return;
        }

        if (this.#isSubtitlesOn()) {
            this.#captionsRestored = true;
            console.info(`${LOG_PREFIX} captions restored`);
            return;
        }

        if (this.#restoreAttempts < RESTORE_MAX_ATTEMPTS) {
            this.#restoreAttempts++;
            try {
                this.#resolveCommand(JSON.parse(JSON.stringify(command)));
            } catch (e) {
                console.warn(`${LOG_PREFIX} failed to restore captions:`, e);
            }

            this.#restoreTimeout = setTimeout(() => this.#tryRestoreCaptions(), RESTORE_RETRY_MS);
        } else {
            console.error(`${LOG_PREFIX} hit max attempts to restore caption toggle`);
            return;
        }
    }
}

restoreAndRefreshRawKeys();

window.captionToggleHandler = new CaptionToggleHandler();
