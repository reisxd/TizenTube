// TizenTube Cobalt Update Checker

import { buttonItem, showModal, showToast, overlayPanelItemListRenderer } from '../ui/ytUI.js';
import { configRead } from '../config.js';

// If TizenTube is not running on Cobalt, do nothing
if (window.h5vcc && window.h5vcc.tizentube && configRead('enableUpdater')) {
    const currentEpoch = Math.floor(Date.now() / 1000);
    if (configRead('dontCheckUpdateUntil') > currentEpoch) {
        console.info('Skipping update check until', new Date(configRead('dontCheckUpdateUntil') * 1000).toLocaleString());
    } else checkForUpdates();
}

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
    let architecture;
    let downloadUrl;

    if (window.h5vcc.tizentube.GetArchitecture) {
        architecture = window.h5vcc.tizentube.GetArchitecture();
    }

    if (architecture) {
        if (architecture === 'arm64-v8a') {
            downloadUrl = release.assets.find(asset => asset.name.includes('arm64.apk')).browser_download_url;
        } else {
            downloadUrl = release.assets.find(asset => asset.name.includes('arm.apk')).browser_download_url;
        }
    } else downloadUrl = release.assets[0].browser_download_url;

    const currentEpoch = Math.floor(Date.now() / 1000);

    getLatestRelease()
        .then(release => {
            const latestVersion = release.tag_name.replace('v', '');
            const releaseDate = new Date(release.published_at).getTime() / 1000;

            if (latestVersion !== currentAppVersion) {
                console.info(`New version available: ${latestVersion} (current: ${currentAppVersion})`);
                showModal(
                    {
                        title: 'Update Available',
                        subtitle: `A new version of TizenTube Cobalt is available: ${latestVersion}\nCurrent version: ${currentAppVersion}\nRelease Date: ${new Date(releaseDate * 1000).toLocaleString()}\nRelease Notes:\n${release.body}`,
                    },
                    overlayPanelItemListRenderer([
                        buttonItem(
                            { title: 'Update Now', subtitle: 'Click to download the latest version.' },
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
                            { title: 'Remind Me Later', subtitle: 'Check for updates later.' },
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
                    ]),
                    'tt-update-modal',
                    false
                )
            } else {
                console.info('You are using the latest version of TizenTube.');
                if (showNoUpdateToast) {
                    showToast('TizenTube is up to date', `You are using the latest version (${currentAppVersion}) of TizenTube Cobalt.`, null);
                }
            }
        })
        .catch(error => {
            console.error('Error fetching the latest release:', error);
            showToast('TizenTube update check failed', 'Could not check for updates.', null);
        });
}

export default checkForUpdates;