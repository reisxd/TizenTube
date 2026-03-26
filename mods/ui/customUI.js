// Custom UI for video player

import { extractAssignedFunctions } from "../utils/ASTParser.js";
import { configRead, configChangeEmitter } from "../config.js";
import { ButtonRenderer } from "./ytUI.js";

configChangeEmitter.addEventListener('configChange', (event) => {
    const { key, value } = event.detail;
    const listenedKeys = [
        'enablePatchingVideoPlayer',
        'enablePreviousNextButtons',
        'enableSuperThanksButton',
        'enableSpeedControlsButton',
        'enablePipButton',
        'enableTurnOffScreenButton',
    ]
    if (listenedKeys.includes(key)) {
        applyPatches();
    }
});

function applyPatches() {
    if (!window._yttv || !document.querySelector('video')) return setTimeout(applyPatches, 250);

    const methods = Object.keys(window._yttv).filter(key => {
        return typeof window._yttv[key] === 'function' && window._yttv[key].toString().includes('TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION');
    });

    if (methods.length === 0) return setTimeout(applyPatches, 250);

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
            return isClass ? constructAsNew(origMethod, args) : origMethod.apply(this, args);
        }

        let inst;
        if (isClass) {
            inst = constructAsNew(origMethod, args);
        } else {
            origMethod.apply(this, args);
            inst = this;
        }

        const functions = extractAssignedFunctions(origMethod.toString());
        const findKey = (targetStr) => {
            const found = functions.find(f => f.rhs.includes(targetStr));
            return found ? found.left.split('.')[1] : null;
        };

        // Patch buttons for playback settings group
        const settingActionGroup = findKey('TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS');
        if (settingActionGroup) {
            const origSettingActionGroup = inst[settingActionGroup];
            inst[settingActionGroup] = function () {
                const res = origSettingActionGroup.apply(this, arguments);

                // PIP button
                if (configRead('enablePipButton') && !res.some(i => i.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP')) {
                    res.splice(1, 0, {
                        type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP',
                        button: {
                            buttonRenderer: ButtonRenderer(
                                false,
                                'Mini player',
                                'CLEAR_COOKIES',
                                { customAction: { action: 'ENTER_PIP' } }
                            )
                        }
                    });
                }

                // Turn Off Screen button
                if (configRead('enableTurnOffScreenButton') && !res.some(i => i.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_TURN_OFF_SCREEN')) {
                    res.unshift({
                        type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_TURN_OFF_SCREEN',
                        button: {
                            buttonRenderer: ButtonRenderer(
                                false,
                                'Turn off screen',
                                'VISIBILITY_OFF',
                                { customAction: { action: 'TURN_OFF_SCREEN' } }
                            )
                        }
                    });
                }

                return res;
            };
        }

        // Patch buttons for engagement actions group
        const engagementActionButton = findKey('props.data.engagementActions');
        if (engagementActionButton) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                let res = origEngagementActionButton.apply(this, arguments);

                // Speed Control button
                if (configRead('enableSpeedControlsButton') && !res.some(i => i.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED')) {
                    res.push({
                        type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED',
                        button: {
                            buttonRenderer: ButtonRenderer(
                                false,
                                "Speed Controls",
                                'SLOW_MOTION_VIDEO',
                                { customAction: { action: 'TT_SPEED_SETTINGS_SHOW', } }
                            )
                        }
                    });
                }

                // Super Thank button
                if (!configRead('enableSuperThanksButton')) {
                    res = res.filter(i => i.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SUPER_THANKS' && i.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SHOPPING');
                }

                return res;
            }
        }

        // Patch Previous and Next button
        if (configRead('enablePreviousNextButtons')) {
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

            if (previousButtonName && nextButtonName) {
                inst[previousButtonName] = function () {
                    return ButtonRenderer(
                        false,
                        'Previous',
                        'SKIP_PREVIOUS',
                        { signalAction: { signal: 'PLAYER_PLAY_PREVIOUS' } }
                    )
                }

                inst[nextButtonName] = function () {
                    return ButtonRenderer(
                        false,
                        'Next',
                        'SKIP_NEXT',
                        { signalAction: { signal: 'PLAYER_PLAY_NEXT' } }
                    )
                }
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