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
            name: 'Skipping Sponsor Segments',
            icon: 'MONEY_HEART',
            value: 'enableSponsorBlockSponsor'
        },
        {
            name: 'Skipping Intro Segments',
            icon: 'PLAY_CIRCLE',
            value: 'enableSponsorBlockIntro'
        },
        {
            name: 'Skipping Outro Segments',
            value: 'enableSponsorBlockOutro'
        },
        {
            name: 'Skipping Interaction Reminder Segments',
            value: 'enableSponsorBlockInteraction'
        },
        {
            name: 'Skipping Self-Promotion Segments',
            value: 'enableSponsorBlockSelfPromo'
        },
        {
            name: 'Skipping Off-Topic Music Segments',
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
            name: 'Fixed UI',
            icon: 'STAR',
            value: 'enableFixedUI'
        }
    ]

    const buttons = [];

    let index = 0;
    for (const setting of settings) {
        const currentVal = configRead(setting.value);
        buttons.push(
            buttonItem(
                { title: `${currentVal ? 'Disable' : 'Enable'} ${setting.name}`, subtitle: setting.subtitle },
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