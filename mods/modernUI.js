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
        }
    ]

    const buttons = [];

    let index = 0;
    for (const setting of settings) {
        const currentVal = configRead(setting.value);
        buttons.push(
            buttonItem(
                { title: setting.name, subtitle: setting.subtitle },
                { icon: setting.icon ? setting.icon : 'CHEVRON_DOWN', secondaryIcon: currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK' },
                [
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
            )
        );
        index++;
    }

    showModal('TizenTube Settings', buttons, parameters && parameters.length > 0 ? parameters[0] : 0, 'tt-settings', update);
}