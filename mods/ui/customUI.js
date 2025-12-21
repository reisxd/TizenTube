// Custom UI for video player

import { extractAssignedFunctions } from "../utils/ASTParser.js";
import { configRead } from "../config.js";
import { ButtonRenderer } from "./ytUI.js";

function applyPatches() {
    if (!window._yttv) return setTimeout(applyPatches, 250);
    if (!document.querySelector('video')) return setTimeout(applyPatches, 250);
    const methods = Object.keys(window._yttv).filter(key => {
        return typeof window._yttv[key] === 'function' && window._yttv[key].toString().includes('TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION');
    });

    if (methods.length === 0) {
        setTimeout(applyPatches, 250);
        return;
    }

    const origMethod = window._yttv[methods[0]];

    function YtlrPlayerActionsContainer() {
        const args = Array.prototype.slice.call(arguments);
        const isClass = /^class\s/.test(origMethod.toString());

        function constructAsNew(ctor, argsList) {
            if (typeof Reflect !== 'undefined' && typeof Reflect.construct === 'function') {
                return Reflect.construct(ctor, argsList, YtlrPlayerActionsContainer);
            }
            return new origMethod(...argsList);
        }

        if (!(this instanceof YtlrPlayerActionsContainer)) {
            if (isClass) return constructAsNew(origMethod, args);
            return origMethod.apply(this, args);
        }

        let inst;
        if (isClass) {
            inst = constructAsNew(origMethod, args);
        } else {
            origMethod.apply(this, args);
            inst = this;
        }

        const functions = extractAssignedFunctions(origMethod.toString());

        const pipCommand = {
            "type": "TRANSPORT_CONTROLS_BUTTON_TYPE_PIP",
            "button": {
                "buttonRenderer": ButtonRenderer(
                    false,
                    'Mini Player',
                    'CLEAR_COOKIES',
                    {
                        customAction: {
                            action: 'ENTER_PIP'
                        }
                    }
                )
            }
        }

        const settingActionGroup = functions.find(func => {
            return func.rhs.includes('TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS');
        }).left.split('.')[1];

        if (!settingActionGroup) return inst;

        const origSettingActionGroup = inst[settingActionGroup];
        inst[settingActionGroup] = function () {
            const res = origSettingActionGroup.apply(this, arguments);
            res.find(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP') || res.splice(1, 0, pipCommand);
            return res;
        };

        const previousButtonName = functions.find(func => {
            if (func.rhs.includes('skipNextButton')) {
                const skipNextButtonIndex = func.rhs.indexOf('skipNextButton');
                const skipPreviousButtonIndex = func.rhs.indexOf('skipPreviousButton');
                if (skipPreviousButtonIndex > skipNextButtonIndex) {
                    return true;
                }
            }
        }).left.split('.')[1];

        const nextButtonName = functions.find(func => {
            if (func.rhs.includes('skipPreviousButton')) {
                const skipNextButtonIndex = func.rhs.indexOf('skipNextButton');
                const skipPreviousButtonIndex = func.rhs.indexOf('skipPreviousButton');
                if (skipNextButtonIndex > skipPreviousButtonIndex) {
                    return true;
                }
            }
        }).left.split('.')[1];

        const engagementActionButton = functions.find(func => func.rhs.includes('props.data.engagementActions')).left.split('.')[1];

        if (engagementActionButton && configRead('enableSpeedControlsButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                res.find(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED') || res.push({
                    type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED',
                    button: {
                        buttonRenderer: ButtonRenderer(
                            false,
                            "Speed Controls",
                            'SLOW_MOTION_VIDEO',
                            {
                                customAction:
                                {
                                    action: 'TT_SPEED_SETTINGS_SHOW',
                                }
                            }
                        )
                    }
                });
                return res;
            }
        }

        if (!configRead('enableSuperThanksButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                const superThanksFiltered = res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SUPER_THANKS');
                const shoppingFiltered = superThanksFiltered.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SHOPPING');
                return shoppingFiltered;
            }
        }

        if (configRead('enablePreviousNextButtons')) {
            if (!previousButtonName || !nextButtonName) return inst;
            inst[previousButtonName] = function () {
                return ButtonRenderer(
                    false,
                    'Previous',
                    'SKIP_PREVIOUS',
                    {
                        signalAction: {
                            signal: 'PLAYER_PLAY_PREVIOUS'
                        }
                    }
                )
            }

            inst[nextButtonName] = function () {
                return ButtonRenderer(
                    false,
                    'Next',
                    'SKIP_NEXT',
                    {
                        signalAction: {
                            signal: 'PLAYER_PLAY_NEXT'
                        }
                    }
                )
            }

        }

        return inst;
    }

    if (configRead('enablePatchingVideoPlayer')) {
        YtlrPlayerActionsContainer.prototype = origMethod.prototype;
        window._yttv[methods[0]] = YtlrPlayerActionsContainer;
    }
}


if (document.readyState === 'complete' || document.readyState === 'interactive') {
    applyPatches();
} else {
    window.addEventListener('DOMContentLoaded', applyPatches);
}