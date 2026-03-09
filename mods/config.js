const CONFIG_KEY = 'ytaf-configuration';
const defaultConfig = {
  enableAdBlock: true,
  enableSponsorBlock: true,
  enableSponsorBlockToasts: true,
  sponsorBlockManualSkips: ['intro', 'outro', 'filler'],
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockPreview: true,
  enableSponsorBlockMusicOfftopic: true,
  enableSponsorBlockFiller: false,
  enableSponsorBlockHighlight: true,
  videoSpeed: 1,
  preferredVideoQuality: 'auto',
  enableDeArrow: true,
  enableDeArrowThumbnails: false,
  focusContainerColor: '#0f0f0f',
  routeColor: '#0f0f0f',
  enableFixedUI: (window.h5vcc && window.h5vcc.tizentube) ? false : true,
  enableHqThumbnails: true,
  enableChapters: true,
  enableLongPress: true,
  enableShorts: false,
  dontCheckUpdateUntil: 0,
  enableWhoIsWatchingMenu: false,
  permanentlyEnableWhoIsWatchingMenu: false,
  enableWhosWatchingMenuOnAppExit: false,
  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,
  showWelcomeToast: false,
  enablePreviousNextButtons: false,
  enableSuperThanksButton: false,
  enableSpeedControlsButton: true,
  enablePatchingVideoPlayer: true,
  enablePreviews: false,
  enableHideWatchedVideos: true,
  hideWatchedVideosThreshold: 5,
  hideWatchedVideosPages: [
      'home',
      'search',
      'music',
      'gaming',
      'subscriptions',
      'channel',
      'playlist',
      'more',
      'watch'
  ],
  enableHideEndScreenCards: false,
  enableYouThereRenderer: false,
  lastAnnouncementCheck: 0,
  enableScreenDimming: false,
  dimmingTimeout: 60,
  dimmingOpacity: 0.5,
  enablePaidPromotionOverlay: false,
  speedSettingsIncrement: 0.25,
  videoPreferredCodec: 'any',
  launchToOnStartup: null,
  reloadHomeOnStartup: true,
  disabledSidebarContents: ['TROPHY', 'NEWS', 'YOUTUBE_MUSIC', 'BROADCAST', 'CLAPPERBOARD', 'LIVE', 'GAMING', 'TAB_MORE'],
  enableUpdater: true,
  autoFrameRate: false,
  autoFrameRatePauseVideoFor: 0,
  enableSigninReminder: false,
  enableDebugConsole: false,
  enableDebugLogging: true,
  debugConsolePosition: 'top-left',
  debugConsoleHeight: 500
};

let localConfig;
const populatedConfigWarnings = new Set();

try {
  const raw = window.localStorage[CONFIG_KEY];
  if (raw === undefined || raw === null || raw === '' || raw === 'undefined') {
    localConfig = { ...defaultConfig };
  } else {
    localConfig = JSON.parse(raw);
  }
} catch (err) {
  console.warn('Config read failed:', err);
  localConfig = { ...defaultConfig };
}

if (!localConfig || typeof localConfig !== 'object') {
  localConfig = { ...defaultConfig };
}

export function configRead(key) {
  if (localConfig[key] === undefined) {
    const hasDefault = Object.prototype.hasOwnProperty.call(defaultConfig, key);
    localConfig[key] = hasDefault ? defaultConfig[key] : undefined;
    if (hasDefault && !populatedConfigWarnings.has(key)) {
      populatedConfigWarnings.add(key);
      console.warn('Populating key', key, 'with default value', defaultConfig[key]);
    }
  }
  return localConfig[key];
}

export function configWrite(key, value) {
  console.info('Setting key', key, 'to', value);
  if (value === undefined) {
    delete localConfig[key];
  } else {
    localConfig[key] = value;
  }
  window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);
  configChangeEmitter.dispatchEvent(new CustomEvent('configChange', { detail: { key, value } }));
}

export const configChangeEmitter = {
  listeners: {},
  addEventListener(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(callback);
  },
  removeEventListener(type, callback) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(cb => cb !== callback);
  },
  dispatchEvent(event) {
    const type = event.type;
    if (!this.listeners[type]) return;
    this.listeners[type].forEach(cb => {
      try {
        cb.call(this, event)
      } catch (_) {};
    });
  }
};