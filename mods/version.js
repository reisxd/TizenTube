import packageInfo from '../package.json';

export const moduleVersion = packageInfo.version;

export function getStandaloneVersion() {
    if (window.__tizenTubeStandaloneVersion) {
        return window.__tizenTubeStandaloneVersion;
    }

    try {
        if (typeof tizen === 'undefined' || !tizen.application) return null;

        const appInfo = tizen.application.getCurrentApplication().appInfo;
        if (appInfo?.id.endsWith(".TizenTubeStandalone")) {
            return appInfo.version;
        }
    } catch (error) {
        console.warn('Failed to read the TizenTube standalone version:', error);
    }

    return null;
}
