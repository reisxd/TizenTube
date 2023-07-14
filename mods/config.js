const CONFIG_KEY = 'ytaf-configuration';
const defaultConfig = {
  enableAdBlock: true,
  enableSponsorBlock: true,
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockMusicOfftopic: true
};

let localConfig;

try {
  localConfig = JSON.parse(window.localStorage[CONFIG_KEY]);
} catch (err) {
  console.warn('Config read failed:', err);
  localConfig = defaultConfig;
}

export function configRead(key) {
  if (localConfig[key] === undefined) {
    console.warn(
      'Populating key',
      key,
      'with default value',
      defaultConfig[key]
    );
    localConfig[key] = defaultConfig[key];
  }

  return localConfig[key];
}

export function configWrite(key, value) {
  console.info('Setting key', key, 'to', value);
  localConfig[key] = value;
  window.localStorage[CONFIG_KEY] = JSON.stringify(localConfig);
}
