import { configRead } from './config.js';
import { showModal, buttonItem } from './ytUI.js';

const interval = setInterval(() => {
    const videoElement = document.querySelector('video');
    if (videoElement) {
        execute_once_dom_loaded_speed();
        clearInterval(interval);
    }
}, 1000);

function execute_once_dom_loaded_speed() {
    document.querySelector('video').addEventListener('canplay', () => {
        document.getElementsByTagName('video')[0].playbackRate = configRead('videoSpeed');;
    });

    const eventHandler = (evt) => {
        const currentSpeed = configRead('videoSpeed');
        if (evt.keyCode == 406 || evt.keyCode == 191) {
            evt.preventDefault();
            evt.stopPropagation();
            if (evt.type === 'keydown') {
                let selectedIndex = 0;
                const maxSpeed = 4;
                const increment = 0.25;
                const buttons = [];
                for (let speed = increment; speed <= maxSpeed; speed += increment) {
                    buttons.push(
                        buttonItem(
                            { title: `${speed}x` },
                            null,
                            [
                                {
                                    signalAction: {
                                        signal: 'POPUP_BACK'
                                    }
                                },
                                {
                                    setClientSettingEndpoint: {
                                        settingDatas: [
                                            {
                                                clientSettingEnum: {
                                                    item: 'videoSpeed'
                                                },
                                                intValue: speed.toString()
                                            }
                                        ]
                                    }
                                }
                            ]
                        )
                    );
                    if (currentSpeed === speed) {
                        selectedIndex = buttons.length - 1;
                    }
                }

                buttons.push(
                    buttonItem(
                        { title: `Fix stuttering (1.0001x)` },
                        null,
                        [
                            {
                                signalAction: {
                                    signal: 'POPUP_BACK'
                                }
                            },
                            {
                                setClientSettingEndpoint: {
                                    settingDatas: [
                                        {
                                            clientSettingEnum: {
                                                item: 'videoSpeed'
                                            },
                                            intValue: '1.0001'
                                        }
                                    ]
                                }
                            }
                        ]
                    )
                );

                showModal('Playback Speed', buttons, selectedIndex, 'tt-speed');

                let observer = new MutationObserver((mutationsList, observer) => {
                    let modal = null;
                    const elements = document.getElementsByTagName('yt-formatted-string');
                    for (const element of elements) {
                        if (element.innerText === 'Playback Speed') {
                            modal = element;
                            break;
                        }
                    }
                    if (!modal) {
                        document.getElementsByTagName('video')[0].playbackRate = configRead('videoSpeed');
                        observer.disconnect();
                    }
                }
                );
                observer.observe(document.body, { childList: true, subtree: true });
                return false;
            }
            return true;
        };
    }

    // Red, Green, Yellow, Blue
    // 403, 404, 405, 406
    // ---, 172, 170, 191
    document.addEventListener('keydown', eventHandler, true);
    document.addEventListener('keypress', eventHandler, true);
    document.addEventListener('keyup', eventHandler, true);
}