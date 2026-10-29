import { showToast } from '../ui/ytUI.js';
import { t } from 'i18next';

export async function startUpdate(url) {
    try {
        const accepted = await window.h5vcc.tizentube.InstallAppFromURL(url);
        if (!accepted) throw new Error('Update request rejected');
        showToast(t('settings.options.updater.downloading.title'),
            t('settings.options.updater.downloading.subtitle'));
        return true;
    } catch (error) {
        showToast(t('settings.options.updater.startFailed.title'),
            t('settings.options.updater.startFailed.subtitle'));
        return false;
    }
}
