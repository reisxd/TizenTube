import { configWrite, configRead } from './config.js';
import { enablePip } from './features/pictureInPicture.js';
import { turnOffScreen } from './features/turnOffScreen.js';
import modernUI, { optionShow } from './ui/settings.js';
import { speedSettings } from './ui/speedUI.js';
import { showToast, buttonItem } from './ui/ytUI.js';
import checkForUpdates from './features/updater.js';

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
                    // Patch the playback settings popup to use TizenTube speed settings.
                    // YouTube has shipped both a two-panel and a single-panel layout for this popup,
                    // so locate the items array defensively instead of drilling a hardcoded path.
                    // The try/catch is load-bearing: any unexpected throw here would otherwise
                    // prevent the native popup from opening at all.
                    try {
                        const oldPath = cmd?.openPopupAction?.popup?.overlaySectionRenderer?.overlay
                            ?.overlayTwoPanelRenderer?.actionPanel?.overlayPanelRenderer?.content
                            ?.overlayPanelItemListRenderer?.items;
                        const items = Array.isArray(oldPath)
                            ? oldPath
                            : findItemListItems(cmd?.openPopupAction?.popup);

                        if (Array.isArray(items)) {
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

                            items.splice(2, 0,
                                buttonItem(
                                    { title: 'Mini Player' },
                                    { icon: 'CLEAR_COOKIES' }, [
                                    {
                                        customAction: {
                                            action: 'ENTER_MP'
                                        }
                                    }
                                ])
                            );

                            if (window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube?.HasSystemFeature('android.software.picture_in_picture')) {
                                items.splice(3, 0,
                                    buttonItem(
                                        { title: 'Picture in Picture' },
                                        { icon: 'PIP' }, [
                                        {
                                            customAction: {
                                                action: 'ENTER_PIP'
                                            }
                                        },
                                        {
                                            signalAction: {
                                                 signal: 'POPUP_BACK'
                                            }
                                        }
                                    ])
                                );
                            }
                        }
                    } catch (err) {
                        console.warn('TizenTube: playback-settings patch threw, falling through to native handler:', err && err.message);
                    }
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

// BFS-walk the popup payload looking for the first overlayPanelItemListRenderer.items
// array. Depth-limited so a malformed payload can't trigger runaway traversal.
function findItemListItems(root) {
    if (!root || typeof root !== 'object') return null;
    const queue = [{ node: root, depth: 0 }];
    const seen = new Set();
    const MAX_DEPTH = 12;
    const MAX_NODES = 500;
    let visited = 0;
    while (queue.length && visited < MAX_NODES) {
        const { node, depth } = queue.shift();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        visited++;
        const items = node.overlayPanelItemListRenderer?.items;
        if (Array.isArray(items)) return items;
        if (depth >= MAX_DEPTH) continue;
        for (const key in node) {
            const child = node[key];
            if (child && typeof child === 'object') queue.push({ node: child, depth: depth + 1 });
        }
    }
    return null;
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
        case 'ENTER_MP':
            enablePip();
            break;
        case 'ENTER_PIP':
            window.h5vcc.tizentube.EnterPIP();
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
        case 'TURN_OFF_SCREEN':
            turnOffScreen();
            break;
    }
}