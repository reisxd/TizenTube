import { configWrite, configRead } from './config.js';
import { enablePip } from './features/pictureInPicture.js';
import modernUI, { optionShow, buildLogServerIpEditorOptions } from './ui/settings.js';
import { speedSettings } from './ui/speedUI.js';
import { showToast, buttonItem } from './ui/ytUI.js';
import checkForUpdates from './features/updater.js';
import { playlistContinue } from './features/playlistContinue.js';

function parseLogServerIp() {
    const raw = String(configRead('logServerIp') || '').trim();
    const parts = raw.split('.').map((v) => Number(v));
    if (parts.length !== 4 || parts.some((v) => Number.isNaN(v))) return [0, 0, 0, 0];
    return parts.map((v) => Math.max(0, Math.min(255, Math.floor(v))));
}

function logServerUrlFromConfig() {
  const ip = String(configRead('logServerIp') || '').trim();
  const port = Number(configRead('logServerPort') || 3030);
  return `http://${ip}:${port}/tv-log`;
}

function sendRemotePayload(url, payload) {
    const body = JSON.stringify(payload);
    // Use text/plain to avoid CORS preflight (simple request — no OPTIONS needed).
    // The PS1 receiver reads the raw body and parses it as JSON regardless of Content-Type.
    try {
        if (navigator?.sendBeacon) {
            const ok = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
            if (ok) return Promise.resolve();
        }
    } catch (_) {}

    return new Promise((resolve, reject) => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.timeout = 4000;
            xhr.onload = () => resolve();
            xhr.onerror = () => reject(new Error('xhr_error'));
            xhr.ontimeout = () => reject(new Error('xhr_timeout'));
            xhr.send(body);
        } catch (err) {
            reject(err);
        }
    });
}

export default function resolveCommand(cmd, _) {
    // resolveCommand function is pretty OP, it can do from opening modals, changing client settings and way more.
    // Because the client might change, we should find it first.

    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {
            return window._yttv[key].instance.resolveCommand(cmd, _);
        }
    }
}

export function findFunction(funcName) {
    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key][funcName] && typeof window._yttv[key][funcName] === 'function') {
            return window._yttv[key][funcName];
        }
    }
}

// Patch resolveCommand to be able to change TizenTube settings

export function patchResolveCommand() {
    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {

            const ogResolve = window._yttv[key].instance.resolveCommand;
            window._yttv[key].instance.resolveCommand = function (cmd, _) {
                if (cmd.setClientSettingEndpoint) {
                    // Command to change client settings. Use TizenTube configuration to change settings.
                    for (const settings of cmd.setClientSettingEndpoint.settingDatas) {
                        if (!settings.clientSettingEnum.item.includes('_')) {
                            for (const setting of cmd.setClientSettingEndpoint.settingDatas) {
                                const valName = Object.keys(setting).find(key => key.includes('Value'));
                                const value = valName === 'intValue' ? Number(setting[valName]) : setting[valName];
                                if (valName === 'arrayValue') {
                                    const arr = configRead(setting.clientSettingEnum.item);
                                    if (arr.includes(value)) {
                                        arr.splice(arr.indexOf(value), 1);
                                    } else {
                                        arr.push(value);
                                    }
                                    configWrite(setting.clientSettingEnum.item, arr);
                                } else configWrite(setting.clientSettingEnum.item, value);
                            }
                        } else if (settings.clientSettingEnum.item === 'I18N_LANGUAGE') {
                            const lang = settings.stringValue;
                            const date = new Date();
                            date.setFullYear(date.getFullYear() + 10);
                            document.cookie = `PREF=hl=${lang}; expires=${date.toUTCString()};`;
                            resolveCommand({
                                signalAction: {
                                    signal: 'RELOAD_PAGE'
                                }
                            });
                            return true;
                        }
                    }
                } else if (cmd.customAction) {
                    customAction(cmd.customAction.action, cmd.customAction.parameters);
                    return true;
                } else if (cmd?.signalAction?.customAction) {
                    customAction(cmd.signalAction.customAction.action, cmd.signalAction.customAction.parameters);
                    return true;
                } else if (cmd?.showEngagementPanelEndpoint?.customAction) {
                    customAction(cmd.showEngagementPanelEndpoint.customAction.action, cmd.showEngagementPanelEndpoint.customAction.parameters);
                    return true;
                } else if (cmd?.playlistEditEndpoint?.customAction) {
                    customAction(cmd.playlistEditEndpoint.customAction.action, cmd.playlistEditEndpoint.customAction.parameters);
                    return true;
                } else if (cmd?.openPopupAction?.uniqueId === 'playback-settings') {
                    // Patch the playback settings popup to use TizenTube speed settings
                    const items = cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items;
                    for (const item of items) {
                        if (item?.compactLinkRenderer?.icon?.iconType === 'SLOW_MOTION_VIDEO') {
                            item.compactLinkRenderer.subtitle && (item.compactLinkRenderer.subtitle.simpleText = 'with TizenTube');
                            item.compactLinkRenderer.serviceEndpoint = {
                                clickTrackingParams: "null",
                                signalAction: {
                                    customAction: {
                                        action: 'TT_SPEED_SETTINGS_SHOW',
                                        parameters: []
                                    }
                                }
                            };
                        }
                    }

                    cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items.splice(2, 0,
                        buttonItem(
                            { title: 'Mini Player' },
                            { icon: 'CLEAR_COOKIES' }, [
                            {
                                customAction: {
                                    action: 'ENTER_PIP'
                                }
                            }
                        ])
                    );
                } else if (cmd?.watchEndpoint?.videoId) {
                    window.isPipPlaying = false;
                    const ytlrPlayerContainer = document.querySelector('ytlr-player-container');
                    ytlrPlayerContainer.style.removeProperty('z-index');
                }

                if (cmd.customAction) return window._yttv[key].instance.resolveCommand(cmd, _);

                if (cmd.commandExecutorCommand && cmd.commandExecutorCommand.commands) {
                    for (const command of cmd.commandExecutorCommand.commands) {
                        if (command.customAction) {
                            customAction(command.customAction.action, command.customAction.parameters);
                        } else if (command.signalAction?.customAction) {
                            customAction(command.signalAction.customAction.action, command.signalAction.customAction.parameters);
                        } else if (command.showEngagementPanelEndpoint?.customAction) {
                            customAction(command.showEngagementPanelEndpoint.customAction.action, command.showEngagementPanelEndpoint.customAction.parameters);
                        } else if (command.playlistEditEndpoint?.customAction) {
                            customAction(command.playlistEditEndpoint.customAction.action, command.playlistEditEndpoint.customAction.parameters);
                        } else {
                            window._yttv[key].instance.resolveCommand(command, _);
                        }
                    }
                    return true;
                }

                if (cmd?.requestAccountSelectorCommand 
                    && cmd.requestAccountSelectorCommand?.identityActionContext?.eventTrigger === 'ACCOUNT_EVENT_TRIGGER_ON_EXIT') {
                    if (!configRead('enableWhosWatchingMenuOnAppExit')) {
                        ogResolve.call(this, {
                            signalAction: {
                                signal: 'EXIT_APP'
                            }
                        });
                        return false;
                    }
                }

                return ogResolve.call(this, cmd, _);
            }
        }
    }
}

function customAction(action, parameters) {
    switch (action) {
        case 'SETTINGS_UPDATE':
            modernUI(true, parameters);
            break;
        case 'OPTIONS_SHOW':
            optionShow(parameters, parameters.update);
            break;
        case 'SKIP':
            const kE = document.createEvent('Event');
            kE.initEvent('keydown', true, true);
            kE.keyCode = 27;
            kE.which = 27;
            document.dispatchEvent(kE);

            document.querySelector('video').currentTime = parameters.time;
            break;
        case 'TT_SETTINGS_SHOW':
            modernUI();
            break;
        case 'TT_SPEED_SETTINGS_SHOW':
            speedSettings();
            break;
        case 'UPDATE_REMIND_LATER':
            configWrite('dontCheckUpdateUntil', parameters);
            break;
        case 'UPDATE_DOWNLOAD':
            window.h5vcc.tizentube.InstallAppFromURL(parameters);
            showToast('TizenTube Update', 'Downloading update, please wait...');
            break;
        case 'SET_PLAYER_SPEED':
            const speed = Number(parameters);
            document.querySelector('video').playbackRate = speed;
            break;
        case 'ENTER_PIP':
            enablePip();
            break;
        case 'SHOW_TOAST':
            showToast('TizenTube', parameters);
            break;
        case 'ADD_TO_QUEUE':
            window.queuedVideos.videos.push(parameters);
            showToast('TizenTube', 'Video added to queue.');
            break;
        case 'CLEAR_QUEUE':
            window.queuedVideos.videos = [];
            showToast('TizenTube', 'Video queue cleared.');
            break;
        case 'CHECK_FOR_UPDATES':
            checkForUpdates(true);
            break;
        case 'PLAYLIST_CONTINUE':
            playlistContinue(resolveCommand, showToast);
            break;
        case 'LOG_SERVER_IP_ADJUST': {
            const octetIndex = Number(parameters?.octetIndex);
            const delta = Number(parameters?.delta || 0);
            if (Number.isNaN(octetIndex) || octetIndex < 0 || octetIndex > 3 || Number.isNaN(delta)) break;
            const octets = parseLogServerIp();
            octets[octetIndex] = Math.max(0, Math.min(255, octets[octetIndex] + delta));
            const nextIp = octets.join('.');
            configWrite('logServerIp', nextIp);
            console.info('[LogServer] logServerIp changed to', nextIp);
            optionShow({
                options: buildLogServerIpEditorOptions(),
                selectedIndex: 0,
                update: true,
                menuId: 'tt-log-server-ip',
                menuHeader: {
                    title: 'Remote Log Server IP',
                    subtitle: 'Adjust each octet with +/- controls'
                }
            }, true);
            break;
        }
        case 'LOG_SERVER_TEST_PING': {
            const url = logServerUrlFromConfig();
            if (!url || url.includes('http://:')) {
                showToast('TizenTube', 'Set a valid Log Server IP first.');
                break;
            }
            if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];
            window.__ttFileOnlyLogs.push(`[${new Date().toISOString()}] [TT_ADBLOCK_FILE] logserver.test.start ${JSON.stringify({ url })}`);
            sendRemotePayload(url, {
                    ts: new Date().toISOString(),
                    level: 'INFO',
                    context: 'TizenTube',
                    message: 'Manual test ping from settings',
                    _formatted: `[${new Date().toISOString()}] [INFO] [TizenTube] Manual test ping from settings`,
                }).then(() => {
                window.__ttFileOnlyLogs.push(`[${new Date().toISOString()}] [TT_ADBLOCK_FILE] logserver.test.success ${JSON.stringify({ url })}`);
                showToast('TizenTube', `Log ping sent to ${url}`);
            }).catch((err) => {
                const msg = String(err?.message || err);
                window.__ttFileOnlyLogs.push(`[${new Date().toISOString()}] [TT_ADBLOCK_FILE] logserver.test.fail ${JSON.stringify({ url, msg })}`);
                console.warn('[LogServer] Test ping failed', { url, msg });
                showToast('TizenTube', `Log ping failed: ${String(err?.message || err)}`);
            });
            break;
        }
    }
}
