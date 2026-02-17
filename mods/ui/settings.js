import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer, scrollPaneRenderer, overlayMessageRenderer, QrCodeRenderer } from './ytUI.js';
import { getUserLanguageOptionName } from '../main/features/moreSubtitles.js';
import qrcode from 'qrcode-npm';

const qrcodes = {};

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
            name: 'Social Media Links',
            icon: 'PRIVACY_UNLISTED',
            value: null,
            options: [
                {
                    name: 'GitHub',
                    link: 'https://github.com/reisxd/TizenTube',
                },
                {
                    name: 'YouTube',
                    link: 'https://www.youtube.com/@tizenbrew',
                },
                {
                    name: 'Discord',
                    link: 'https://discord.gg/m2P7v8Y2qR',
                },
                {
                    name: 'Telegram (Announcements)',
                    link: 'https://t.me/tizentubecobaltofficial',
                },
                {
                    name: 'Telegram (Group)',
                    link: 'https://t.me/tizentubeofficial',
                },
                {
                    name: 'Website',
                    link: 'https://tizentube.6513006.xyz',
                }
            ].map((option) => {
                if (!qrcodes[option.name]) {
                    const qr = qrcode.qrcode(6, 'H');
                    qr.addData(option.link);
                    qr.make();

                    const qrDataImgTag = qr.createImgTag(8, 8);
                    const qrDataUrl = qrDataImgTag.match(/src="([^"]+)"/)[1];
                    qrcodes[option.name] = qrDataUrl;
                }
                return {
                    name: option.name,
                    icon: 'OPEN_IN_NEW',
                    value: null,
                    options: {
                        title: option.name,
                        subtitle: option.link,
                        content: overlayPanelItemListRenderer([
                            overlayMessageRenderer(`You can visit the ${option.name} page by scanning the QR code below.`),
                            QrCodeRenderer(qrcodes[option.name])
                        ])
                    }
                }
            })
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
            menuHeader: {
                title: 'SponsorBlock Settings',
                subtitle: 'https://sponsor.ajay.app/'
            },
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
                        {
                            name: 'Highlights',
                            icon: 'LOCATION_POINT',
                            value: 'enableSponsorBlockHighlight'
                        }
                    ]
                }
            ]
        },
        {
            name: 'DeArrow',
            icon: 'VISIBILITY_OFF',
            value: null,
            menuHeader: {
                title: 'DeArrow Settings',
                subtitle: 'https://dearrow.ajay.app/'
            },
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
                {
                    name: 'Welcome Message',
                    value: 'showWelcomeToast',
                }
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
            name: 'Video Player Settings',
            icon: 'VIDEO_YOUTUBE',
            value: null,
            menuHeader: {
                title: 'Video Player Settings',
                subtitle: 'Customize video player features'
            },
            options: [
                {
                    name: 'Patch Video Player UI',
                    icon: 'SETTINGS',
                    value: null,
                    menuId: 'tt-video-player-ui-patching',
                    options: [
                        {
                            name: 'Enable Video Player UI Patching',
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
                            icon: 'MONEY_HEART',
                            value: 'enableSuperThanksButton'
                        },
                        {
                            name: 'Speed Controls Button',
                            icon: 'SLOW_MOTION_VIDEO',
                            value: 'enableSpeedControlsButton'
                        }
                    ]
                },
                {
                    name: 'Preferred Video Quality',
                    icon: 'VIDEO_QUALITY',
                    value: null,
                    menuId: 'tt-preferred-video-quality',
                    menuHeader: {
                        title: 'Preferred Video Quality',
                        subtitle: 'Choose the preferred or next best video quality applied when playback starts'
                    },
                    options:
                        ['Auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'].map((quality) => {
                            return {
                                name: quality,
                                key: 'preferredVideoQuality',
                                value: quality.toLowerCase()
                            }
                        })

                },
                {
                    name: 'Speed Settings Increments',
                    icon: 'SLOW_MOTION_VIDEO',
                    value: null,
                    menuId: 'tt-speed-settings-increments',
                    menuHeader: {
                        title: 'Speed Settings Increments',
                        subtitle: 'Set the speed increments for video playback speed adjustments'
                    },
                    options: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map((increment) => {
                        return {
                            name: `${increment}x`,
                            key: 'speedSettingsIncrement',
                            value: increment
                        }
                    })
                },
                {
                    name: 'Preferred Video Codec',
                    icon: 'VIDEO_QUALITY',
                    value: null,
                    menuId: 'tt-preferred-video-codec',
                    menuHeader: {
                        title: 'Preferred Video Codec',
                        subtitle: 'Choose the preferred video codec for playback',
                    },
                    options: ['any', 'vp9', 'av01', 'avc1'].map((codec) => {
                        return {
                            name: codec === 'any' ? 'Any' : codec.toUpperCase(),
                            key: 'preferredVideoCodec',
                            value: codec
                        }
                    })
                },
                window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate ? {
                    name: 'Auto Frame Rate',
                    icon: 'SLOW_MOTION_VIDEO',
                    value: 'autoFrameRate'
                } : null,
                window.h5vcc && window.h5vcc.tizentube && window.h5vcc.tizentube.SetFrameRate ? {
                    name: 'Auto Frame Rate Pause Duration',
                    icon: 'TIMER',
                    value: null,
                    menuId: 'tt-auto-frame-rate-pause-duration',
                    menuHeader: {
                        title: 'Auto Frame Rate Pause Duration',
                        subtitle: 'Set the duration (in seconds) to pause video playback when adjusting frame rate'
                    },
                    options: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((seconds) => {
                        return {
                            name: `${seconds} seconds`,
                            key: 'autoFrameRatePauseVideoFor',
                            value: seconds * 1000
                        }
                    })
                } : null
            ]
        },
        {
            name: 'User Interface Settings',
            icon: 'SETTINGS',
            value: null,
            menuHeader: {
                title: 'User Interface Settings',
                subtitle: 'Customize the UI to your liking'
            },
            options: [
                {
                    name: 'Hide Watched Videos',
                    icon: 'VISIBILITY_OFF',
                    value: null,
                    menuId: 'tt-hide-watched-videos-settings',
                    options: [
                        {
                            name: 'Enable Hide Watched Videos',
                            icon: 'VISIBILITY_OFF',
                            value: 'enableHideWatchedVideos'
                        },
                        {
                            name: 'Watched Videos Threshold',
                            value: null,
                            menuId: 'tt-hide-watched-videos-threshold',
                            menuHeader: {
                                title: 'Watched Videos Threshold',
                                subtitle: 'Set the percentage threshold for hiding watched videos'
                            },
                            options: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percent) => {
                                return {
                                    name: `${percent}%`,
                                    key: 'hideWatchedVideosThreshold',
                                    value: percent
                                }
                            })
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
                    menuId: 'tt-screen-dimming-settings',
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
                            menuId: 'tt-dimming-timeout',
                            menuHeader: {
                                title: 'Dimming Timeout',
                                subtitle: 'Set the inactivity timeout (in seconds) before the screen dims'
                            },
                            options: [10, 20, 30, 60, 120, 180, 240, 300].map((seconds) => {
                                const title = seconds >= 60 ? `${seconds / 60} minute${seconds / 60 > 1 ? 's' : ''}` : `${seconds} seconds`;
                                return {
                                    name: title,
                                    key: 'dimmingTimeout',
                                    value: seconds
                                }
                            })
                        },
                        {
                            name: 'Dimming Opacity',
                            icon: 'LENS_BLUE',
                            value: null,
                            menuId: 'tt-dimming-opacity',
                            menuHeader: {
                                title: 'Dimming Opacity',
                                subtitle: 'Set the opacity level for screen dimming'
                            },
                            options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((opacity) => {
                                return {
                                    name: `${Math.round(opacity * 100)}%`,
                                    key: 'dimmingOpacity',
                                    value: opacity
                                }
                            })
                        }
                    ]
                },
                {
                    name: 'Disable Sidebar Contents (Guide Actions)',
                    icon: 'MENU',
                    value: null,
                    arrayToEdit: 'disabledSidebarContents',
                    menuId: 'tt-sidebar-contents',
                    menuHeader: {
                        title: 'Disable Sidebar Contents',
                        subtitle: 'Select sidebar contents (guide actions) to disable'
                    },
                    options: [
                        {
                            name: 'Search',
                            icon: 'SEARCH',
                            value: 'SEARCH'
                        },
                        {
                            name: 'Home',
                            icon: 'WHAT_TO_WATCH',
                            value: 'WHAT_TO_WATCH'
                        },
                        {
                            name: 'Sports',
                            icon: 'TROPHY',
                            value: 'TROPHY'
                        },
                        {
                            name: 'News',
                            icon: 'NEWS',
                            value: 'NEWS'
                        },
                        {
                            name: 'Music',
                            icon: 'YOUTUBE_MUSIC',
                            value: 'YOUTUBE_MUSIC'
                        },
                        {
                            name: 'Podcasts',
                            icon: 'BROADCAST',
                            value: 'BROADCAST'
                        },
                        {
                            name: 'Movies & TV',
                            icon: 'CLAPPERBOARD',
                            value: 'CLAPPERBOARD'
                        },
                        {
                            name: 'Live',
                            icon: 'LIVE',
                            value: 'LIVE'
                        },
                        {
                            name: 'Gaming',
                            icon: 'GAMING',
                            value: 'GAMING'
                        },
                        {
                            name: 'Subscriptions',
                            icon: 'SUBSCRIPTIONS',
                            value: 'SUBSCRIPTIONS'
                        },
                        {
                            name: 'Library',
                            icon: 'TAB_LIBRARY',
                            value: 'TAB_LIBRARY'
                        },
                        {
                            name: 'More',
                            icon: 'TAB_MORE',
                            value: 'TAB_MORE'
                        }
                    ]
                },
                {
                    name: 'Launch to on startup',
                    icon: 'TV',
                    value: null,
                    menuId: 'tt-launch-to-on-startup',
                    menuHeader: {
                        title: 'Launch to on startup',
                        subtitle: 'Choose the default page TizenTube opens to on startup'
                    },
                    options: [
                        {
                            name: 'Search',
                            icon: 'SEARCH',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                searchEndpoint: { query: '' }
                            })
                        },
                        {
                            name: 'Home',
                            icon: 'WHAT_TO_WATCH',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics' }
                            })
                        },
                        {
                            name: 'Sports',
                            icon: 'TROPHY',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_sports' }
                            })
                        },
                        {
                            name: 'News',
                            icon: 'NEWS',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_news' }
                            })
                        },
                        {
                            name: 'Music',
                            icon: 'YOUTUBE_MUSIC',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_music' }
                            })
                        },
                        {
                            name: 'Podcasts',
                            icon: 'BROADCAST',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_podcasts' }
                            })
                        },
                        {
                            name: 'Movies & TV',
                            icon: 'CLAPPERBOARD',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_movies' }
                            })
                        },
                        {
                            name: 'Gaming',
                            icon: 'GAMING',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_gaming' }
                            })
                        },
                        {
                            name: 'Live',
                            icon: 'LIVE',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_live' }
                            })
                        },
                        {
                            name: 'Subscriptions',
                            icon: 'SUBSCRIPTIONS',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEsubscriptions' }
                            })
                        },
                        {
                            name: 'Library',
                            icon: 'TAB_LIBRARY',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FElibrary' }
                            })
                        },
                        {
                            name: 'More',
                            icon: 'TAB_MORE',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_more' }
                            })
                        }
                    ]
                }
            ]
        },
        window.h5vcc && window.h5vcc.tizentube ?
            {
                name: 'TizenTube Cobalt Updater',
                icon: 'SYSTEM_UPDATE',
                value: null,
                menuHeader: {
                    title: 'TizenTube Cobalt Updater',
                    subtitle: 'Manage TizenTube Cobalt updates'
                },
                subtitle: `Current version: ${window.h5vcc.tizentube.GetVersion()}`,
                options: [
                    buttonItem(
                        { title: 'Check for Updates' },
                        { icon: 'SYSTEM_UPDATE' },
                        [
                            {
                                customAction: {
                                    action: 'CHECK_FOR_UPDATES',
                                }
                            }
                        ]
                    ),
                    {
                        name: 'Check for updates on startup',
                        icon: 'SYSTEM_UPDATE',
                        value: 'enableUpdater'
                    }
                ]
            } : null
    ];

    const buttons = [];

    let index = 0;
    for (const setting of settings) {
        if (!setting) continue;
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
                                    update: setting.options?.title ? 'customUI' : false,
                                    menuId: setting.menuId,
                                    arrayToEdit: setting.arrayToEdit,
                                    menuHeader: setting.menuHeader
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
                    { title: option.name, subtitle: option.subtitle },
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
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
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
            if (!option) continue;
            if (option.compactLinkRenderer) {
                buttons.push(option);
                index++;
                continue;
            }
            const isRadioChoice = option.key !== null && option.key !== undefined;
            const currentVal = configRead(isRadioChoice ? option.key : option.value);
            buttons.push(
                buttonItem(
                    { title: option.name, subtitle: option.subtitle },
                    {
                        icon: option.icon ? option.icon : 'CHEVRON_DOWN',
                        secondaryIcon: isRadioChoice ? currentVal === option.value ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED' : option.value === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
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
                                    arrayToEdit: option.arrayToEdit,
                                    menuHeader: option.menuHeader
                                }
                            }
                        }
                    ] : option.key !== null && option.key !== undefined ? [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: option.key
                                        },
                                        stringValue: option.value
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
                                    update: parameters.options?.title ? 'customUI' : true,
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
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
                                    update: parameters.options?.title ? 'customUI' : true,
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
                                }
                            }
                        }
                    ]
                )
            );
            index++;
        }
    }

    showModal(parameters.menuHeader ? parameters.menuHeader : 'TizenTube Settings', overlayPanelItemListRenderer(buttons, parameters.selectedIndex), parameters.menuId || 'tt-settings-options', update);
}