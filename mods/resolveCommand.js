import { configWrite, configRead } from './config.js';
import modernUI, { optionShow } from './modernUI.js';

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
                        }
                    }
                } else if (cmd.customAction) {
                    customAction(cmd.customAction.action, cmd.customAction.parameters);
                    return true;
                } else if (cmd?.showEngagementPanelEndpoint?.customAction) {
                    customAction(cmd.showEngagementPanelEndpoint.customAction.action, cmd.showEngagementPanelEndpoint.customAction.parameters);
                    return true;
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
    }
}