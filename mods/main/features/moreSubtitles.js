// TizenTube Subtitle Localization Mod
// Automatically adds user's local language to subtitle auto-translate menu if not present

import { configRead } from "../config.js";

const LANGUAGE_CODES = [
    "af","sq","am","ar","hy","as","az","eu","be","bn","bs","bg",
    "my","ca","zh-CN","zh-TW","zh-HK","hr","cs","da","nl","en","et",
    "fil","fi","fr","gl","ka","de","el","gu","he","hi","hu","is",
    "id","ga","it","ja","kn","kk","km","ko","ky","lo","lv","lt",
    "mk","ms","ml","mt","mr","mn","ne","no","or","fa","pl","pt",
    "pa","ro","ru","sr","si","sk","sl","es","sw","sv","ta","te",
    "th","tr","uk","ur","uz","vi","cy","yi","yo","zu"
];

// Return an object mapping language code -> localized language name.
export function getComprehensiveLanguageList(locale = "en") {
    try {
        const displayNames = new Intl.DisplayNames([locale], { type: "language" });
        const map = {};
        LANGUAGE_CODES.forEach((code) => {
            const name = displayNames.of(code) || code;
            map[code] = name;
        });
        return map;
    } catch (e) {
        const fallback = {};
        LANGUAGE_CODES.forEach((c) => (fallback[c] = c));
        return fallback;
    }
}

// Infer the most likely language for a given ISO 3166-1 alpha-2 country code using Intl.Locale.
// Returns { code, name } or null if unknown.
export function getCountryLanguage(countryCode, locale = "en") {
    if (!countryCode) return null;
    try {
        const region = String(countryCode).toUpperCase();

        const zhRegionMap = { CN: "zh-CN", TW: "zh-TW", HK: "zh-HK", SG: "zh-CN" };
        if (zhRegionMap[region]) {
            const code = zhRegionMap[region];
            const name = new Intl.DisplayNames([locale], { type: "language" }).of(code) || code;
            return { code, name };
        }

        const base = new Intl.Locale("und", { region });
        const maximized = base.maximize ? base.maximize() : base;
        const lang = maximized.language || "en";

        const displayNames = new Intl.DisplayNames([locale], { type: "language" });
        const name = displayNames.of(lang) || lang;

        return { code: lang, name };
    } catch (e) {
        console.warn("TizenTube Subtitle Localization: Could not infer language for country", countryCode, e);
        return null;
    }
}

let isPatched = false;

// Function to get user's country code
function getUserCountryCode() {
    try {
        // Always use window.yt.config_.GL as primary source
        if (window.yt && window.yt.config_ && window.yt.config_.GL) {
            return window.yt.config_.GL;
        }

        console.warn(
            "TizenTube Subtitle Localization: Could not determine user country code"
        );
        return null;
    } catch (error) {
        console.error(
            "TizenTube Subtitle Localization: Error getting country code:",
            error
        );
        return null;
    }
}

// Function to get dynamic user language option name for settings UI
export function getUserLanguageOptionName() {
    const userCountryCode = getUserCountryCode();
    const userLanguage = getCountryLanguage(userCountryCode);
    if (userLanguage) {
        return `Show ${userLanguage.name} Subtitle`;
    }
    return "Show Local Subtitle";
}

// Function to check if language already exists in the menu
function languageExistsInMenu(items, languageCode, languageName) {
    return items.some((item) => {
        if (
            item.compactLinkRenderer &&
            item.compactLinkRenderer.serviceEndpoint
        ) {
            const commands =
                item.compactLinkRenderer.serviceEndpoint.commandExecutorCommand
                    ?.commands;
            if (
                commands &&
                commands[0] &&
                commands[0].selectSubtitlesTrackCommand
            ) {
                const translationLang =
                    commands[0].selectSubtitlesTrackCommand.translationLanguage;
                return (
                    translationLang &&
                    (translationLang.languageCode === languageCode ||
                        translationLang.languageName === languageName)
                );
            }
        }
        return false;
    });
}

// Function to create a language option
function createLanguageOption(languageCode, languageName) {
    return {
        compactLinkRenderer: {
            title: { simpleText: languageName },
            serviceEndpoint: {
                commandExecutorCommand: {
                    commands: [
                        {
                            selectSubtitlesTrackCommand: {
                                translationLanguage: {
                                    languageCode: languageCode,
                                    languageName: languageName,
                                },
                            },
                        },
                        {
                            openClientOverlayAction: {
                                type: "CLIENT_OVERLAY_TYPE_CAPTIONS_LANGUAGE",
                                updateAction: true,
                            },
                        },
                        {
                            signalAction: { signal: "POPUP_BACK" },
                        },
                    ],
                },
            },
            secondaryIcon: { iconType: "RADIO_BUTTON_UNCHECKED" },
        },
    };
}

// Function to get languages already present in menu
function getExistingLanguages(items) {
    const existingLanguages = new Set();

    items.forEach((item) => {
        if (
            item.compactLinkRenderer &&
            item.compactLinkRenderer.serviceEndpoint
        ) {
            const commands =
                item.compactLinkRenderer.serviceEndpoint.commandExecutorCommand
                    ?.commands;
            if (
                commands &&
                commands[0] &&
                commands[0].selectSubtitlesTrackCommand
            ) {
                const translationLang =
                    commands[0].selectSubtitlesTrackCommand.translationLanguage;
                if (translationLang) {
                    existingLanguages.add(translationLang.languageCode);
                    existingLanguages.add(translationLang.languageName);
                }
            }
        }
    });

    return existingLanguages;
}

// Function to create section title
function createSectionTitle(title) {
    return {
        overlayMessageRenderer: {
            title: { simpleText: "" },
            subtitle: { simpleText: title },
            style: "OVERLAY_MESSAGE_STYLE_SUBSECTION_TITLE",
        },
    };
}

// Main function to patch the subtitle menu
function patchSubtitleMenu() {
    if (isPatched) return;

    // Always patch if possible - settings will be checked dynamically
    if (!window._yttv) return setTimeout(patchSubtitleMenu, 250);
    const yttvInstance = Object.values(window._yttv).find(
        (obj) =>
            obj &&
            obj.instance &&
            typeof obj.instance.resolveCommand === "function"
    );

    if (
        !yttvInstance ||
        yttvInstance.instance.resolveCommand.isPatchedBySubtitleLocalization
    ) {
        if (!yttvInstance) {
            console.error(
                "TizenTube Subtitle Localization: Could not find resolveCommand instance."
            );
        } else {
            console.log("TizenTube Subtitle Localization: Already patched.");
        }
        return;
    }

    const originalResolveCommand = yttvInstance.instance.resolveCommand;

    yttvInstance.instance.resolveCommand = function (cmd, _) {
        // Identify the correct command using its uniqueId
        if (
            cmd?.openPopupAction?.uniqueId ===
            "CLIENT_OVERLAY_TYPE_CAPTIONS_AUTO_TRANSLATE"
        ) {
            // Check current settings dynamically each time menu opens
            const showUserLanguage = configRead("enableShowUserLanguage");
            const showOtherLanguages = configRead("enableShowOtherLanguages");

            // If neither feature is enabled, don't modify the menu
            if (!showUserLanguage && !showOtherLanguages) {
                return originalResolveCommand.apply(this, arguments);
            }

            const items =
                cmd.openPopupAction.popup.overlaySectionRenderer.overlay
                    .overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer
                    .content.overlayPanelItemListRenderer.items;

            // Get existing languages
            const existingLanguages = getExistingLanguages(items);

            // Add user's local language if enabled
            if (showUserLanguage) {
                const userCountryCode = getUserCountryCode();
                const userLanguage = getCountryLanguage(userCountryCode);

                if (userLanguage) {
                    // Check if the user's language already exists
                    if (
                        !languageExistsInMenu(items, userLanguage.code, userLanguage.name)
                    ) {
                        console.log(
                            `%c[TizenTube Subtitle Localization] Adding user's local language: ${userLanguage.name} (${userLanguage.code})`,
                            "background: #2196F3; color: #ffffff; font-size: 14px; font-weight: bold;"
                        );

                        const userLanguageOption = createLanguageOption(
                            userLanguage.code,
                            userLanguage.name
                        );

                        // Find the "Recommended languages" section and insert after it
                        const recommendedIndex = items.findIndex(
                            (item) =>
                                item.overlayMessageRenderer?.subtitle
                                    ?.simpleText === "Recommended languages"
                        );

                        if (recommendedIndex > -1) {
                            // Insert user's language as the first recommendation
                            items.splice(
                                recommendedIndex + 1,
                                0,
                                userLanguageOption
                            );
                            // Update existing languages set
                            existingLanguages.add(userLanguage.code);
                            existingLanguages.add(userLanguage.name);
                        } else {
                            // Find "Other languages" section and insert before it
                            const otherLanguagesIndex = items.findIndex(
                                (item) =>
                                    item.overlayMessageRenderer?.subtitle
                                        ?.simpleText === "Other languages"
                            );

                            if (otherLanguagesIndex > -1) {
                                items.splice(
                                    otherLanguagesIndex,
                                    0,
                                    userLanguageOption
                                );
                            } else {
                                // As a fallback, add it at the beginning
                                items.unshift(userLanguageOption);
                            }
                            // Update existing languages set
                            existingLanguages.add(userLanguage.code);
                            existingLanguages.add(userLanguage.name);
                        }
                    } else {
                        console.log(
                            `%c[TizenTube Subtitle Localization] User's language ${userLanguage.name} already exists in menu`,
                            "background: #4CAF50; color: #ffffff; font-size: 12px;"
                        );
                    }
                } else {
                    console.warn(
                        `TizenTube Subtitle Localization: No language mapping found for country code: ${userCountryCode}`
                    );
                }
            }

            // Create "Tizen Languages" section with all missing languages if enabled
            if (showOtherLanguages) {
                const missingLanguages = Object.entries(getComprehensiveLanguageList())
                    .filter(([code, name]) => !existingLanguages.has(code) && !existingLanguages.has(name))
                    .sort(([, a], [, b]) => a.localeCompare(b));

                if (missingLanguages.length > 0) {
                    console.log(
                        `%c[TizenTube Subtitle Localization] Adding "Tizen Languages" section with ${missingLanguages.length} additional languages`,
                        "background: #FF9800; color: #ffffff; font-size: 12px;"
                    );

                    // Add section title
                    items.push(createSectionTitle("Other Languages"));

                    // Add all missing languages
                    missingLanguages.forEach(([code, name]) => {
                        items.push(createLanguageOption(code, name));
                    });

                    console.log(
                        `%c[TizenTube Subtitle Localization] Added "Tizen Languages" section`,
                        "background: #FF9800; color: #ffffff; font-size: 12px;"
                    );
                } else {
                    console.log(
                        `%c[TizenTube Subtitle Localization] All languages already present in menu`,
                        "background: #4CAF50; color: #ffffff; font-size: 12px;"
                    );
                }
            }
        }

        // Let the original function run with our modified 'cmd' object
        return originalResolveCommand.apply(this, arguments);
    };

    yttvInstance.instance.resolveCommand.isPatchedBySubtitleLocalization = true;
    console.log("TizenTube Subtitle Localization: Patch successful!");
    isPatched = true;
}

// Wait for the YouTube TV app to be ready
const interval = setInterval(() => {
    if (window._yttv && Object.keys(window._yttv).length > 0) {
        patchSubtitleMenu();
        clearInterval(interval);
    }
}, 1000);

// Also try to patch when DOM is loaded
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patchSubtitleMenu);
} else {
    patchSubtitleMenu();
}

console.log(
    "TizenTube Subtitle Localization: Module loaded, waiting for YouTube TV..."
);
