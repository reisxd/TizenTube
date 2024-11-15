import { configRead } from './config.js';
import { showModal, buttonItem } from './ytUI.js';

export default function modernUI(update, parameters) {
    const settings = [
        {
            name: 'Ad block',
            icon: 'DOLLAR_SIGN',
            value: 'enableAdBlock'
        },
        {
            name: 'SponsorBlock',
            icon: 'MONEY_HAND',
            value: 'enableSponsorBlock'
        },
        {
            name: 'Manual SponsorBlock Segment Skip',
            icon: 'DOLLAR_SIGN',
            value: null,
            options: [
                {
                    name: 'Skip Sponsor Segments',
                    icon: 'MONEY_HEART',
                    value: 'sponsor'
                },
                {
                    name: 'Skip Intro Segments',
                    icon: 'PLAY_CIRCLE',
                    value: 'intro'
                },
                {
                    name: 'Skip Outro Segments',
                    value: 'outro'
                },
                {
                    name: 'Skip Interaction Reminder Segments',
                    value: 'interaction'
                },
                {
                    name: 'Skip Self-Promotion Segments',
                    value: 'selfpromo'
                },
                {
                    name: 'Skip Off-Topic Music Segments',
                    value: 'music_offtopic'
                }
            ]
        },
        {
            name: 'Skip Sponsor Segments',
            icon: 'MONEY_HEART',
            value: 'enableSponsorBlockSponsor'
        },
        {
            name: 'Skip Intro Segments',
            icon: 'PLAY_CIRCLE',
            value: 'enableSponsorBlockIntro'
        },
        {
            name: 'Skip Outro Segments',
            value: 'enableSponsorBlockOutro'
        },
        {
            name: 'Skip Interaction Reminder Segments',
            value: 'enableSponsorBlockInteraction'
        },
        {
            name: 'Skip Self-Promotion Segments',
            value: 'enableSponsorBlockSelfPromo'
        },
        {
            name: 'Skip Off-Topic Music Segments',
            value: 'enableSponsorBlockMusicOfftopic'
        },
        {
            name: 'DeArrow',
            icon: 'VISIBILITY_OFF',
            value: 'enableDeArrow'
        },
        {
            name: 'DeArrow Thumbnails',
            icon: 'TV',
            value: 'enableDeArrowThumbnails'
        },
        {
            name: 'Fix UI',
            icon: 'STAR',
            value: 'enableFixedUI'
        },
        {
            name: 'High Quality Thumbnails',
            icon: 'VIDEO_QUALITY',
            value: 'enableHqThumbnails'
        },
        {
            name: 'Chapters',
            icon: 'BOOKMARK_BORDER',
            value: 'enableChapters'
        },
        {
            name: 'Long Press',
            value: 'enableLongPress'
        },
        {
            name: 'Shorts',
            icon: 'YOUTUBE_SHORTS_FILL_24',
            value: 'enableShorts'
        }
    ]

    const buttons = [];

    let index = 0;
    for (const setting of settings) {
        const currentVal = setting.value ? configRead(setting.value) : null;
        buttons.push(
            buttonItem(
                { title: setting.name, subtitle: setting.subtitle },
                { icon: setting.icon ? setting.icon : 'CHEVRON_DOWN', secondaryIcon: currentVal === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK' },
                currentVal !== null ? [
                    {
                        setClientSettingEndpoint: {
                            settingDatas: [
                                {
                                    clientSettingEnum: {
                                        item: setting.value
                                    },
                                    boolValue: !configRead(setting.value)
                                }
                            ]
                        }
                    },
                    {
                        customAction: {
                            action: 'SETTINGS_UPDATE',
                            parameters: [index]
                        }
                    }
                ] : [
                    {
                        customAction: {
                            action: 'OPTIONS_SHOW',
                            parameters: {
                                options: setting.options,
                                selectedIndex: 0,
                                update: false
                            }
                        }
                    }
                ]
            )
        );
        index++;
    }

    showModal('TizenTube Settings', buttons, parameters && parameters.length > 0 ? parameters[0] : 0, 'tt-settings', update);
}

export function optionShow(parameters, update) {
    const buttons = [];
    const manualSkipValue = configRead('sponsorBlockManualSkips');
    for (const option of parameters.options) {
        buttons.push(
            buttonItem(
                { title: option.name },
                { icon: option.icon ? option.icon : 'CHEVRON_DOWN', secondaryIcon: manualSkipValue.includes(option.value) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK' },
                [
                    {
                        setClientSettingEndpoint: {
                            settingDatas: [
                                {
                                    clientSettingEnum: {
                                        item: 'sponsorBlockManualSkips'
                                    },
                                    arrayValue: option.value
                                }
                            ]
                        }
                    },
                    {
                        customAction: {
                            action: 'OPTIONS_SHOW',
                            parameters: {
                                options: parameters.options,
                                selectedIndex: parameters.options.indexOf(option),
                                update: true
                            }
                        }
                    }
                ]
            )
        );
    }

    showModal('TizenTube Settings', buttons, parameters.selectedIndex, 'tt-settings-options', update);
}