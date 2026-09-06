import { getGuide } from '../utils/innerTubeCalls.js';
import { configRead, configWrite } from '../config.js';
import { buttonItem, overlayPanelItemListRenderer, showModal } from './ytUI.js';
import { t } from 'i18next';

function showSetting(settingType, parameters) {
    if (settingType === 'MOVE_GUIDE_BUTTON') {
        const order = configRead('sidebarContentsOrder');

        const browseId = parameters.item.guideEntryRenderer.navigationEndpoint?.browseEndpoint?.browseId
            || (parameters.item.guideEntryRenderer.navigationEndpoint?.searchEndpoint && 'search');
        const index = order.findIndex(item => {
            if (typeof item === 'object' && item !== null) {
                return item.browseId === browseId;
            } else {
                return item === browseId;
            }
        });

        if (index === -1) {
            return showSetting('', true);
        }

        if (parameters.direction === 'up' && index > 0) {
            const temp = order[index - 1];
            order[index - 1] = order[index];
            order[index] = temp;
        } else if (parameters.direction === 'down' && index < order.length - 1) {
            const temp = order[index + 1];
            order[index + 1] = order[index];
            order[index] = temp;
        }
        configWrite('sidebarContentsOrder', order);

        return showSetting('', true);
    } else if (settingType === 'SHOW_GUIDE_BUTTONS') {
        const title = parameters.item.guideEntryRenderer.formattedTitle.simpleText;

        const buttons = [];
        buttons.push(
            buttonItem(
                {
                    title: t('settings.options.uiSettings.options.sortSidebarContents.moveUp.title'),
                    subtitle: t('settings.options.uiSettings.options.sortSidebarContents.moveUp.subtitle')
                },
                {
                    icon: 'UP_ARROW'
                },
                [
                    {
                        customAction: {
                            action: 'MOVE_GUIDE_BUTTON',
                            parameters: {
                                settingType,
                                direction: 'up',
                                item: parameters.item
                            }
                        }
                    },
                    {
                        signalAction: {
                            signal: 'POPUP_BACK'
                        }
                    }
                ]
            )
        )

        buttons.push(
            buttonItem(
                {
                    title: t('settings.options.uiSettings.options.sortSidebarContents.moveDown.title'),
                    subtitle: t('settings.options.uiSettings.options.sortSidebarContents.moveDown.subtitle')
                },
                {
                    icon: 'DOWN_ARROW'
                },
                [
                    {
                        customAction: {
                            action: 'MOVE_GUIDE_BUTTON',
                            parameters: {
                                settingType,
                                direction: 'down',
                                item: parameters.item
                            }
                        }
                    },
                    {
                        signalAction: {
                            signal: 'POPUP_BACK'
                        }
                    }
                ]
            )
        )

        return showModal(
            title,
            overlayPanelItemListRenderer(buttons),
            'tt-move-guide-button-modal'
        );
    }
    getGuide().then(guide => {
        const buttons = [];

        let idx = 0;
        const guideItems = guide.items[0].guideSectionRenderer.originalItems
            || guide.items[0].guideSectionRenderer.items;
        for (const item of guideItems) {
            const title = item.guideEntryRenderer.formattedTitle.simpleText;
            const icon = item.guideEntryRenderer.icon?.iconType;
            const browseId = item.guideEntryRenderer.navigationEndpoint?.browseEndpoint ? item.guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId : 'search';

            buttons.push(
                buttonItem(
                    {
                        title,
                    },
                    {
                        icon,
                        secondaryIcon: settingType === 'disabledSidebarContents' ?
                            configRead(settingType)?.includes(browseId) ?
                                'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                            : null
                    },
                    [
                        settingType === 'disabledSidebarContents' ?
                            {
                                setClientSettingEndpoint: {
                                    settingDatas: [
                                        {
                                            clientSettingEnum: {
                                                item: 'disabledSidebarContents'
                                            },
                                            arrayValue: browseId
                                        }
                                    ]
                                }
                            } :
                            {
                                customAction: {
                                    action: 'SHOW_GUIDE_BUTTONS',
                                    parameters: {
                                        settingType,
                                        idx,
                                        item
                                    }
                                }
                            },
                        ...(settingType === 'disabledSidebarContents' ? [{
                            customAction: {
                                action: 'RELOAD_GUIDE_OPTIONS',
                                parameters: {
                                    settingType,
                                    idx,
                                    item
                                }
                            }
                        }] : [])
                    ]
                )
            );
            idx++;
        }

        showModal(
            {
                title: settingType === 'disabledSidebarContents' ? t('settings.options.uiSettings.options.disableSidebarContents.title') : t('settings.options.uiSettings.options.sortSidebarContents.title'),
                subtitle: settingType === 'disabledSidebarContents' ? t('settings.options.uiSettings.options.disableSidebarContents.subtitle') : t('settings.options.uiSettings.options.sortSidebarContents.subtitle')
            },
            overlayPanelItemListRenderer(buttons),
            'tt-sidebar-settings',
            parameters === true
        );
    });
}

export default showSetting;