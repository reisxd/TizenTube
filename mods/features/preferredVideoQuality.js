import { configRead, configChangeEmitter } from "../config.js";
import resolveCommand from "../resolveCommand.js";

const SELECTORS = {
    PLAYER: '.html5-video-player',
};

const EVENTS = {
    YT_STATE_CHANGE: 'onStateChange',
    CONFIG_CHANGE: 'configChange',
};

const CONFIG_KEYS = {
    QUALITY: 'preferredVideoQuality',
};

class PreferredQualityHandler {
    #player = null;
    #attachTimeout = null;

    constructor() {
        this.init();
    }

    init() {
        this.#pollForPlayer();
        this.#setupConfigListener();
    }

    #pollForPlayer() {
        clearTimeout(this.#attachTimeout);

        const playerElement = document.querySelector(SELECTORS.PLAYER);

        if (!playerElement) {
            this.#attachTimeout = setTimeout(() => this.#pollForPlayer(), 100);
            return;
        }

        this.#player = playerElement;

        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);

        this.#handleStateChange();
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
            if (ev.detail?.key === CONFIG_KEYS.QUALITY) {
                this.#applyQuality();
            }
        });
    }

    #handleStateChange = () => {
        const state = this.#player?.getPlayerStateObject?.();

        if (state?.isPlaying) {
            this.#applyQuality();
        }
    };

    #applyQuality() {
        const preferredQuality = configRead(CONFIG_KEYS.QUALITY);
        if (!preferredQuality || !this.#player) return;

        try {
            const qualityData = this.#determineQualityData(preferredQuality);

            if (qualityData) {
                this.#dispatchQualityCommand(qualityData);
            }
        } catch (e) {
            console.warn('[PreferredQuality] Failed to apply quality:', e);
        }
    }

    #determineQualityData(preference) {
        if (preference === 'auto') {
            return { quality: 'auto' };
        }

        const availableQualities = this.#player.getAvailableQualityData();
        if (!availableQualities?.length) return null;

        const getQualityValue = (label) => parseInt((label || '').toString().replace(/\D/g, ''), 10) || 0;
        const targetValue = getQualityValue(preference);

        const sorted = availableQualities
            .map(q => ({ original: q, val: getQualityValue(q.qualityLabel) }))
            .sort((a, b) => b.val - a.val);

        const bestMatch = sorted.find(q => q.val <= targetValue) || sorted[sorted.length - 1];

        return bestMatch ? {
            quality: bestMatch.original.quality,
            formatId: bestMatch.original.formatId
        } : null;
    }

    #dispatchQualityCommand(qualityData) {
        resolveCommand({
            setClientSettingEndpoint: {
                settingDatas: [{
                    clientSettingEnum: { item: "PLAYBACK_QUALITY" },
                    stringValue: JSON.stringify(qualityData)
                }]
            }
        });
    }
}

window.preferredVideoQualityHandler = new PreferredQualityHandler();
