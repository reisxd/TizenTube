import { configRead, configChangeEmitter } from "../config.js";

class PreferredQualityHandler {
    constructor(videoID) {
        this.videoID = videoID;
        this.video = null;
        this.attachVideoTimeout = null;
        this.boundApplyQuality = this.applyQuality.bind(this);
    }

    init() {
        this.attachVideo();

        configChangeEmitter.addEventListener('configChange', (ev) => {
            if (ev.detail && ev.detail.key === 'preferredVideoQuality') {
                this.applyQuality();
            }
        });
    }

    attachVideo() {
        clearTimeout(this.attachVideoTimeout);
        this.attachVideoTimeout = null;

        this.video = document.querySelector('video');
        if (!this.video) {
            this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
            return;
        }

        this.video.addEventListener('loadedmetadata', this.boundApplyQuality);
        this.video.addEventListener('playing', this.boundApplyQuality);

        this.applyQuality();
    }

    destroy() {
        if (this.attachVideoTimeout) clearTimeout(this.attachVideoTimeout);
        if (this.video) {
            this.video.removeEventListener('loadedmetadata', this.boundApplyQuality);
            this.video.removeEventListener('playing', this.boundApplyQuality);
        }
    }

    applyQuality() {
        const quality = configRead('preferredVideoQuality');
        console.log("[PreferredQuality] Applying quality:", quality);

        if (!quality) return;

        try {
            const { player, app } = Object.values(window._yttv || {}).reduce((acc, obj) => {
                if (obj && typeof obj.getAvailableQualityData === 'function') {
                    acc.player = obj;
                }
                if (obj && obj.instance && typeof obj.instance.resolveCommand === 'function') {
                    acc.app = obj.instance;
                }
                return acc;
            }, { player: null, app: null });

            if (player && app) {
                let stringValue = null;
                let appliedLabel = "Auto";

                if (quality === 'auto') {
                    stringValue = JSON.stringify({
                        quality: "auto"
                    });
                }
                else {
                    const qualities = player.getAvailableQualityData();
                    // console.log("[PreferredQuality] Available qualities:", qualities);

                    if (qualities && qualities.length > 0) {
                        const parseQuality = (q) => parseInt((q || '').toString().replace(/[^0-9]/g, ''), 10) || 0;
                        const preferredNum = parseQuality(quality);

                        const sortedQualities = qualities.map(q => ({
                            original: q,
                            val: parseQuality(q.qualityLabel)
                        })).sort((a, b) => b.val - a.val);

                        let target = sortedQualities.find(q => q.val <= preferredNum);

                        if (!target) {
                            target = sortedQualities[sortedQualities.length - 1];
                        }

                        if (target) {
                            stringValue = JSON.stringify({
                                quality: target.original.quality,
                                formatId: target.original.formatId
                            });
                            appliedLabel = target.original.qualityLabel;
                        }
                    }
                }

                if (stringValue) {
                    const command = {
                        setClientSettingEndpoint: {
                            settingDatas: [{
                                clientSettingEnum: {
                                    item: "PLAYBACK_QUALITY"
                                },
                                stringValue: stringValue
                            }]
                        }
                    };
                    app.resolveCommand(command);
                    // console.log("[PreferredQuality] Applied quality:", appliedLabel);
                }
            }
        } catch (e) {
            console.warn('[PreferredQuality] Method failed:', e);
        }
    }
}

window.preferredVideoQualityHandler = null;

window.addEventListener('hashchange', () => {
    const newURL = new URL(location.hash.substring(1), location.href);
    const videoID = newURL.search.replace('?v=', '').split('&')[0];

    if (videoID) {
        if (window.preferredVideoQualityHandler) {
            try {
                window.preferredVideoQualityHandler.destroy();
            } catch (err) {
                console.warn('window.preferredVideoQualityHandler.destroy() failed!', err);
            }
            window.preferredVideoQualityHandler = null;
        }

        window.preferredVideoQualityHandler = new PreferredQualityHandler(videoID);
        window.preferredVideoQualityHandler.init();
    }
}, false);

if (location.hash.includes('watch')) {
    const newURL = new URL(location.hash.substring(1), location.href);
    const videoID = newURL.search.replace('?v=', '').split('&')[0];
    if (videoID) {
        window.preferredVideoQualityHandler = new PreferredQualityHandler(videoID);
        window.preferredVideoQualityHandler.init();
    }
}
