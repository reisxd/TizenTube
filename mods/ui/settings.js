import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, scrollPaneRenderer, overlayMessageRenderer } from './ytUI.js';
import { getUserLanguageOptionName } from '../features/moreSubtitles.js';

export default function modernUI(update, parameters) {
    const settings = [
        {
            name: 'Support TizenTube',
            icon: 'MONEY_HEART',
            value: null,
            options: {
                title: 'Support TizenTube',
                subtitle: '❤️ Show support for TizenTube and its development',
                content: scrollPaneRenderer([
                    overlayMessageRenderer('If you enjoy using TizenTube and would like to support its development, consider the following:'),
                    overlayMessageRenderer('1. Star the GitHub repository to help increase its visibility.'),
                    overlayMessageRenderer('2. Share TizenTube with others.'),
                    overlayMessageRenderer('If you would like to contribute financially, consider donating:'),
                    overlayMessageRenderer('- GitHub Sponsors: https://github.com/sponsors/reisxd')
                ])
            }
        },
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
                    name: 'Skip Preview/Recap Segments',
                    value: 'preview'
                },
                {
                    name: 'Skip Tangents/Jokes Segments',
                    value: 'filler'
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
            name: 'Skip Preview/Recap Segments',
            value: 'enableSponsorBlockPreview'
        },
        {
            name: 'Skip Tangents/Jokes Segments',
            value: 'enableSponsorBlockFiller'
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
        /*{
            name: 'Chapters',
            icon: 'BOOKMARK_BORDER',
            value: 'enableChapters'
        },*/
        {
            name: 'Long Press',
            value: 'enableLongPress'
        },
        {
            name: 'Shorts',
            icon: 'YOUTUBE_SHORTS_FILL_24',
            value: 'enableShorts'
        },
        {
            name: "Who's Watching Menu",
            icon: 'ACCOUNT_CIRCLE',
            value: 'enableWhoIsWatchingMenu'
        },
        {
            name: 'Subtitles',
            icon: 'TRANSLATE',
            value: null,
            options: [
                {
                    name: getUserLanguageOptionName(),
                    value: 'enableShowUserLanguage'
                },
                {
                    name: 'Show Hidden Subtitles',
                    value: 'enableShowOtherLanguages'
                }
            ]
        },
        {
            name: 'Welcome Message',
            value: 'showWelcomeToast',
        },
        {
            name: 'Previous and Next Buttons',
            icon: 'SKIP_NEXT',
            value: 'enablePreviousNextButtons'
        },
        {
            name: 'Patch Video Player',
            icon: 'SETTINGS',
            value: 'enablePatchingVideoPlayer'
        }
    ];

    const buttons = [];

    let index = 0;
    for (const setting of settings) {
        const currentVal = setting.value ? configRead(setting.value) : null;
        buttons.push(
            buttonItem(
                { title: setting.name, subtitle: setting.subtitle },
                {
                    icon: setting.icon ? setting.icon : 'CHEVRON_DOWN',
                    secondaryIcon:
                        currentVal === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                },
                currentVal !== null
                    ? [
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
                    ]
                    : [
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: setting.options,
                                    selectedIndex: 0,
                                    update: setting.options?.title ? 'customUI' : false
                                }
                            }
                        }
                    ]
            )
        );
        index++;
    }

    showModal(
        {
            title: 'TizenTube Settings',
            subtitle: 'Made by Reis Can (reisxd) with ❤️'
        },
        overlayPanelItemListRenderer(buttons, parameters && parameters.length > 0 ? parameters[0] : 0),
        'tt-settings',
        update
    );
}

export function optionShow(parameters, update) {
    if (update === 'customUI') {
        const option = parameters.options;
        showModal(
            {
                title: option.title,
                subtitle: option.subtitle
            },
            option.content,
            'tt-settings-support',
            false
        );
        return;
    }
        const buttons = [];

        // Check if this is the legacy sponsorBlockManualSkips (array-based) or new boolean-based options
        const isArrayBasedOptions = parameters.options.some(
            option => option.value === 'sponsor' || option.value === 'intro'
        );

        if (isArrayBasedOptions) {
            // Legacy handling for sponsorBlockManualSkips
            const manualSkipValue = configRead('sponsorBlockManualSkips');
            for (const option of parameters.options) {
                buttons.push(
                    buttonItem(
                        { title: option.name },
                        {
                            icon: option.icon ? option.icon : 'CHEVRON_DOWN',
                            secondaryIcon: manualSkipValue.includes(option.value) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                        },
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
        } else {
            // New handling for boolean-based options (like subtitle localization)
            let index = 0;
            for (const option of parameters.options) {
                const currentVal = configRead(option.value);
                buttons.push(
                    buttonItem(
                        { title: option.name },
                        {
                            icon: option.icon ? option.icon : 'CHEVRON_DOWN',
                            secondaryIcon: currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                        },
                        [
                            {
                                setClientSettingEndpoint: {
                                    settingDatas: [
                                        {
                                            clientSettingEnum: {
                                                item: option.value
                                            },
                                            boolValue: !currentVal
                                        }
                                    ]
                                }
                            },
                            {
                                customAction: {
                                    action: 'OPTIONS_SHOW',
                                    parameters: {
                                        options: parameters.options,
                                        selectedIndex: index,
                                        update: true
                                    }
                                }
                            }
                        ]
                    )
                );
                index++;
            }
        }

        showModal('TizenTube Settings', overlayPanelItemListRenderer(buttons, parameters.selectedIndex), 'tt-settings-options', update);
    }
