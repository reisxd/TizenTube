import { configWrite } from './config.js';
import modernUI from './modernUI.js';

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
                            configWrite(setting.clientSettingEnum.item, value);
                        }
                    }
                }
            } else if (cmd.customAction) {
                customAction(cmd.customAction.action, cmd.customAction.parameters);
                return true;
            }

            return ogResolve.call(this, cmd, _);
        }
    }
}

function customAction(action, parameters) {
    switch (action) {
        case 'SETTINGS_UPDATE':
            modernUI(true, parameters);
            break;
    }
}