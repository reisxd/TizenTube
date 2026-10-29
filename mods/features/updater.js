// TizenTube Cobalt Update Checker

import { buttonItem, showModal, showToast, overlayPanelItemListRenderer, scrollPaneRenderer, overlayMessageRenderer } from '../ui/ytUI.js';
import { configRead } from '../config.js';
import { t } from 'i18next';
import { compareVersions, getCompatibleApkUrl } from '../utils/updateRelease.js';

// If TizenTube is not running on Cobalt, do nothing
// Add a timeout since reloading the home page while the updater pop up is shown causes the pop up to instantly disappear.
setTimeout(() => {
    if (window.h5vcc && window.h5vcc.tizentube && configRead('enableUpdater')) {
        const currentEpoch = Math.floor(Date.now() / 1000);
        if (configRead('dontCheckUpdateUntil') > currentEpoch) {
            console.info('Skipping update check until', new Date(configRead('dontCheckUpdateUntil') * 1000).toLocaleString());
        } else checkForUpdates();
    }
}, 2500);

function getLatestRelease() {
    return fetch('https://api.github.com/repos/reisxd/TizenTubeCobalt/releases/latest')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        });
}

function checkForUpdates(showNoUpdateToast) {
    const currentAppVersion = window.h5vcc.tizentube.GetVersion();
    const currentEpoch = Math.floor(Date.now() / 1000);

    return getLatestRelease()
        .then(release => {
            const latestVersion = release.tag_name.replace(/^v/, '');
            const releaseDate = new Date(release.published_at).getTime() / 1000;

            if (compareVersions(latestVersion, currentAppVersion) > 0) {
                const architecture = window.h5vcc.tizentube.GetArchitecture
                    ? window.h5vcc.tizentube.GetArchitecture() : null;
                const downloadUrl = getCompatibleApkUrl(release.assets, architecture);
                if (!downloadUrl) {
                    console.error('No compatible update APK available for architecture:', architecture);
                    showToast(t('settings.options.updater.checkFailed.title'), t('settings.options.updater.noCompatibleApk'), null);
                    return;
                }
                console.info(`New version available: ${latestVersion} (current: ${currentAppVersion})`);
                const msg = `${t('settings.options.updater.releaseDate', { date: new Date(releaseDate * 1000).toLocaleString() })}\n${release.body}`.replace(/#/g, '').replace(/\*/g, '').trim();

                const buttons = [
                    buttonItem(
                        { title: t('settings.options.updater.updateNow.title'), subtitle: t('settings.options.updater.updateNow.subtitle') },
                        { icon: 'DOWN_ARROW' },
                        [
                            {
                                customAction: {
                                    action: 'UPDATE_DOWNLOAD',
                                    parameters: downloadUrl
                                }
                            },
                            {
                                signalAction: {
                                    signal: 'POPUP_BACK'
                                }
                            }
                        ]
                    ),
                    buttonItem(
                        { title: t('settings.options.updater.remindLater.title'), subtitle: t('settings.options.updater.remindLater.subtitle') },
                        { icon: 'SEARCH_HISTORY' },
                        [
                            {
                                customAction: {
                                    action: 'UPDATE_REMIND_LATER',
                                    parameters: currentEpoch + 86400
                                }
                            },
                            {
                                signalAction: {
                                    signal: 'POPUP_BACK'
                                }
                            }
                        ]
                    )
                ];

                // Add an empty message so the CSS doesn't get screwed after user input
                buttons.push(overlayMessageRenderer(' '));
                buttons.push(overlayMessageRenderer(msg));

                showModal(
                    {
                        title: t('settings.options.updater.updateAvailable.title'),
                        subtitle: t('settings.options.updater.updateAvailable.subtitle', { latestVersion, currentVersion: currentAppVersion })
                    },
                    overlayPanelItemListRenderer(buttons),
                    'tt-update-modal',
                    false
                )
            } else {
                console.info('You are using the latest version of TizenTube.');
                if (showNoUpdateToast) {
                    showToast(t('settings.options.updater.upToDate.title'), t('settings.options.updater.upToDate.subtitle', { version: currentAppVersion }), null);
                }
            }
        })
        .catch(error => {
            console.error('Error fetching the latest release:', error);
            showToast(t('settings.options.updater.checkFailed.title'), t('settings.options.updater.checkFailed.subtitle'), null);
        });
}

export default checkForUpdates;
