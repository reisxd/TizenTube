import { SettingActionRenderer, SettingsCategory } from './ytUI.js';
import { t } from 'i18next';
import rootPkg from '../../package.json';
const APP_VERSION = rootPkg.version;

function PatchSettings(settingsObject) {
    const tizentubeOpenAction = SettingActionRenderer(
        t('settings.ttSettings.title'),
        'tizentube_open_action',
        {
            customAction: {
                action: 'TT_SETTINGS_SHOW',
                parameters: []
            }
        },
        `Version: ${APP_VERSION}`,
        'https://www.gstatic.com/ytlr/img/parent_code.png'
    )

    const tizenTubeCategory = SettingsCategory(
        'tizentube_category',
        [tizentubeOpenAction]
    );
    // Add it as the first item in the settings object
    settingsObject.items.unshift(tizenTubeCategory);

}

export {
    PatchSettings
}
