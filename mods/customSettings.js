function SettingsCategory(categoryId, items, title) {
    const category = {
        settingCategoryCollectionRenderer: {
            items,
            categoryId,
            focused: false,
            trackingParams: "null"
        }
    }

    if (title) {
        category.settingCategoryCollectionRenderer.title = {
            runs: [
                {
                    text: title
                }
            ]
        };
    }

    return category;
}

function SettingActionRenderer(title, itemId, serviceEndpoint, summary, thumbnail) {
    return {
        settingActionRenderer: {
            title: {
                runs: [
                    {
                        text: title
                    }
                ]
            },
            serviceEndpoint,
            summary: {
                runs: [
                    {
                        text: summary
                    }
                ]
            },
            trackingParams: "null",
            actionLabel: {
                runs: [
                    {
                        text: title
                    }
                ]
            },
            itemId,
            thumbnail: {
                thumbnails: [
                    {
                        url: thumbnail
                    }
                ]
            }
        }
    }
}

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
        [tizentubeOpenAction],
        'TizenTube'
    );
    settingsObject.items.push(tizenTubeCategory);

}

export {
    PatchSettings
}