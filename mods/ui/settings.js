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
            value: null,
            menuId: 'tt-sponsorblock-settings',
            options: [
                {
                    name: 'Enable SponsorBlock',
                    icon: 'MONEY_HAND',
                    value: 'enableSponsorBlock'
                },
                {
                    name: 'Manual SponsorBlock Segment Skip',
                    icon: 'DOLLAR_SIGN',
                    value: null,
                    arrayToEdit: 'sponsorBlockManualSkips',
                    menuId: 'tt-sponsorblock-manual-segment-skip',
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
                    name: 'Segments',
                    icon: 'SETTINGS',
                    value: null,
                    menuId: 'tt-sponsorblock-segments',
                    options: [
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
                    ]
                }
            ]
        },
        {
            name: 'DeArrow',
            icon: 'VISIBILITY_OFF',
            value: null,
            options: [
                {
                    name: 'Enable DeArrow',
                    icon: 'VISIBILITY_OFF',
                    value: 'enableDeArrow'
                },
                {
                    name: 'DeArrow Thumbnails',
                    icon: 'TV',
                    value: 'enableDeArrowThumbnails'
                }
            ]
        },
        {
            name: 'Miscellaneous',
            icon: 'SETTINGS',
            value: null,
            options: [
                {
                    name: 'Hide End Screen Cards',
                    icon: 'VISIBILITY_OFF',
                    value: 'enableHideEndScreenCards'
                },
                {
                    name: 'You There Renderer',
                    icon: 'HELP',
                    value: 'enableYouThereRenderer'
                },
                {
                    name: 'Paid Promotion Overlay',
                    icon: 'MONEY_HAND',
                    value: 'enablePaidPromotionOverlay'
                },
                {
                    name: "Who's Watching Menu",
                    icon: 'ACCOUNT_CIRCLE',
                    value: 'enableWhoIsWatchingMenu'
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
                    name: 'Video Previews',
                    value: 'enablePreviews'
                },
            ]
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
            name: 'Patch Video Player',
            icon: 'SETTINGS',
            value: null,
            options: [
                {
                    name: 'Enable Video Player Patching',
                    icon: 'SETTINGS',
                    value: 'enablePatchingVideoPlayer'
                },
                {
                    name: 'Previous and Next Buttons',
                    icon: 'SKIP_NEXT',
                    value: 'enablePreviousNextButtons'
                },
                {
                    name: 'Super Thanks Button',
                    icon: 'SUPER_THANKS',
                    value: 'enableSuperThanksButton'
                }
            ]
        },
        {
            name: 'Preferred Video Quality',
            icon: 'VIDEO_QUALITY',
            value: null,
            options: {
                title: 'Preferred Video Quality',
                subtitle: 'Choose the preferred or next best video quality applied when playback starts',
                content: overlayPanelItemListRenderer(
                    ['Auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'].map((quality) =>
                        buttonItem(
                            { title: quality },
                            { icon: '' },
                            [
                                {
                                    setClientSettingEndpoint: {
                                        settingDatas: [
                                            {
                                                clientSettingEnum: {
                                                    item: 'preferredVideoQuality'
                                                },
                                                stringValue: quality === 'Auto' ? 'auto' : quality
                                            }
                                        ]
                                    }
                                },
                                {
                                    customAction: {
                                        action: 'SHOW_TOAST',
                                        parameters: `Preferred quality set to ${quality}`
                                    }
                                }
                            ]
                        )
                    ),
                    (() => {
                        const savedVal = configRead('preferredVideoQuality');
                        const idx = ['auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'].indexOf(savedVal);
                        return idx !== -1 ? idx : null;
                    })()
                )
            }
        },
        {
            name: 'Hide Watched Videos',
            icon: 'VISIBILITY_OFF',
            value: null,
            options: [
                {
                    name: 'Enable Hide Watched Videos',
                    icon: 'VISIBILITY_OFF',
                    value: 'enableHideWatchedVideos'
                },
                {
                    name: 'Watched Videos Threshold',
                    value: null,
                    options: {
                        title: 'Watched Videos Threshold',
                        subtitle: 'Set the percentage threshold for hiding watched videos',
                        content: overlayPanelItemListRenderer(
                            [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percent) =>
                                buttonItem(
                                    { title: `${percent}%` },
                                    {
                                        icon: 'CHEVRON_DOWN'
                                    },
                                    [
                                        {
                                            setClientSettingEndpoint: {
                                                settingDatas: [
                                                    {
                                                        clientSettingEnum: {
                                                            item: 'hideWatchedVideosThreshold'
                                                        },
                                                        intValue: percent.toString()
                                                    }
                                                ]
                                            }
                                        },
                                        {
                                            customAction: {
                                                action: 'SHOW_TOAST',
                                                parameters: `Watched videos threshold set to ${percent}%`
                                            }
                                        }
                                    ]
                                )

                            ),
                            (() => {
                                const savedVal = parseFloat(configRead('hideWatchedVideosThreshold'));
                                const idx = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].indexOf(savedVal);
                                return idx !== -1 ? idx : null;
                            })()
                        )
                    }
                },
                {
                    name: 'Set Pages to Hide Watched Videos',
                    value: null,
                    arrayToEdit: 'hideWatchedVideosPages',
                    menuId: 'tt-hide-watched-videos-pages',
                    options: [
                        {
                            name: 'Search Results',
                            value: 'search'
                        },
                        {
                            name: 'Home',
                            value: 'home'
                        },
                        {
                            name: 'Music',
                            value: 'music'
                        },
                        {
                            name: 'Gaming',
                            value: 'gaming'
                        },
                        {
                            name: 'Subscriptions',
                            value: 'subscriptions'
                        },
                        {
                            name: 'Library',
                            value: 'library'
                        },
                        {
                            name: 'More',
                            value: 'more'
                        }
                    ]
                }
            ]
        },
        {
            name: 'Screen Dimming',
            icon: 'EYE_OFF',
            value: null,
            options: [
                {
                    name: 'Enable Screen Dimming',
                    icon: 'EYE_OFF',
                    value: 'enableScreenDimming'
                },
                {
                    name: 'Dimming Timeout',
                    icon: 'TIMER',
                    value: null,
                    options: {
                        title: 'Dimming Timeout',
                        subtitle: 'Set the inactivity timeout (in seconds) before the screen dims',
                        content: overlayPanelItemListRenderer(
                            [10, 20, 30, 60, 120, 180, 240, 300].map((seconds) => {
                                const title = seconds >= 60 ? `${seconds / 60} minute${seconds / 60 > 1 ? 's' : ''}` : `${seconds} seconds`;
                                return buttonItem(
                                    { title: title },
                                    { icon: 'CHEVRON_DOWN' },
                                    [
                                        {
                                            setClientSettingEndpoint: {
                                                settingDatas: [
                                                    {
                                                        clientSettingEnum: {
                                                            item: 'dimmingTimeout'
                                                        },
                                                        intValue: seconds.toString()
                                                    }
                                                ]
                                            }
                                        },
                                        {
                                            customAction: {
                                                action: 'SHOW_TOAST',
                                                parameters: `Dimming timeout set to ${title}`
                                            }
                                        }
                                    ]
                                );
                            }),
                            (() => {
                                const savedVal = parseFloat(configRead('dimmingTimeout'));
                                const idx = [10, 20, 30, 60, 120, 180, 240, 300].indexOf(savedVal);
                                return idx !== -1 ? idx : null;
                            })()
                        )
                    }
                },
                {
                    name: 'Dimming Opacity',
                    icon: 'LENS_BLUE',
                    value: null,
                    options: {
                        title: 'Dimming Opacity',
                        subtitle: 'Set the opacity level for screen dimming',
                        content: overlayPanelItemListRenderer(
                            [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((opacity) =>
                                buttonItem(
                                    { title: `${Math.round(opacity * 100)}%` },
                                    { icon: 'CHEVRON_DOWN' },
                                    [
                                        {
                                            setClientSettingEndpoint: {
                                                settingDatas: [
                                                    {
                                                        clientSettingEnum: {
                                                            item: 'dimmingOpacity'
                                                        },
                                                        intValue: opacity
                                                    }
                                                ]
                                            }
                                        },
                                        {
                                            customAction: {
                                                action: 'SHOW_TOAST',
                                                parameters: `Dimming opacity set to ${Math.round(opacity * 100)}%`
                                            }
                                        }
                                    ]
                                )
                            ),
                            (() => {
                                const savedVal = parseFloat(configRead('dimmingOpacity'));
                                const idx = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].indexOf(savedVal);
                                return idx !== -1 ? idx : null;
                            })()
                        )
                    }
                }
            ]
        },
        {
            name: 'Speed Settings Increments',
            icon: 'SLOW_MOTION_VIDEO',
            value: null,
            options: {
                title: 'Speed Settings Increments',
                subtitle: 'Set the speed increments for video playback speed adjustments',
                content: overlayPanelItemListRenderer(
                    [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map((increment) =>
                        buttonItem(
                            { title: `${increment}x` },
                            { icon: 'CHEVRON_DOWN' },
                            [
                                {
                                    setClientSettingEndpoint: {
                                        settingDatas: [
                                            {
                                                clientSettingEnum: {
                                                    item: 'speedSettingsIncrement'
                                                },
                                                intValue: increment.toString()
                                            }
                                        ]
                                    }
                                },
                                {
                                    customAction: {
                                        action: 'SHOW_TOAST',
                                        parameters: `Speed settings increment set to ${increment}x`
                                    }
                                }
                            ]
                        )
                    ),
                    (() => {
                        const savedVal = parseFloat(configRead('speedSettingsIncrement'));
                        const idx = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].indexOf(savedVal);
                        return idx !== -1 ? idx : null;
                    })()
                )
            }
        },
        {
            name: 'Preferred Video Codec',
            icon: 'VIDEO_QUALITY',
            value: null,
            options: {
                title: 'Preferred Video Codec',
                subtitle: 'Choose the preferred video codec for playback',
                content: overlayPanelItemListRenderer(
                    ['any', 'vp9', 'av01', 'avc1'].map((codec) =>
                        buttonItem(
                            { title: codec.toUpperCase() },
                            { icon: 'CHEVRON_DOWN' },
                            [
                                {
                                    setClientSettingEndpoint: {
                                        settingDatas: [
                                            {
                                                clientSettingEnum: {
                                                    item: 'videoPreferredCodec'
                                                },
                                                stringValue: codec
                                            }
                                        ]
                                    }
                                },
                                {
                                    customAction: {
                                        action: 'SHOW_TOAST',
                                        parameters: `Preferred video codec set to ${codec.toUpperCase()}`
                                    }
                                }
                            ]
                        )
                    ),
                    (() => {
                        const savedVal = configRead('videoPreferredCodec');
                        const idx = ['any', 'vp9', 'av01', 'avc1'].indexOf(savedVal);
                        return idx !== -1 ? idx : null;
                    })()
                )
            }
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
    const isArrayBasedOptions = parameters.arrayToEdit !== undefined;

    if (isArrayBasedOptions) {
        // Legacy handling for sponsorBlockManualSkips
        const value = configRead(parameters.arrayToEdit);
        for (const option of parameters.options) {
            buttons.push(
                buttonItem(
                    { title: option.name },
                    {
                        icon: option.icon ? option.icon : 'CHEVRON_DOWN',
                        secondaryIcon: value.includes(option.value) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                    },
                    [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: parameters.arrayToEdit
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
                                    update: true,
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit
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
                        secondaryIcon: option.value === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                    },
                    option.value === null ? [
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: option.options,
                                    selectedIndex: 0,
                                    update: option.options?.title ? 'customUI' : false,
                                    menuId: option.menuId,
                                    arrayToEdit: option.arrayToEdit
                                }
                            }
                        }
                    ] : [
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
                                    update: option.options?.title ? 'customUI' : true,
                                    menuId: parameters.menuId,
                                    arrayToEdit: option.arrayToEdit
                                }
                            }
                        }
                    ]
                )
            );
            index++;
        }
    }

    showModal('TizenTube Settings', overlayPanelItemListRenderer(buttons, parameters.selectedIndex), parameters.menuId || 'tt-settings-options', update);
}
