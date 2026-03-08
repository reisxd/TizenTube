import { SettingActionRenderer, SettingsCategory } from './ytUI.js';

function PatchSettings(settingsObject) {
    const tizentubeOpenAction = SettingActionRenderer(
        'TizenTube Settings',
        'tizentube_open_action',
        {
            customAction: {
                action: 'TT_SETTINGS_SHOW',
                parameters: []
            }
        },
        'Open TizenTube Settings',
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