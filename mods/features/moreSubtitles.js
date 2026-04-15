// TizenTube Subtitle Localization Mod
// Automatically adds user's local language to subtitle auto-translate menu if not present

import { configRead } from "../config.js";
import languages from "../translations/language-names.js";

const LANGUAGE_CODES = [
    "af", "sq", "am", "ar", "hy", "as", "az", "eu", "be", "bn", "bs", "bg",
    "my", "ca", "zh-CN", "zh-TW", "zh-HK", "hr", "cs", "da", "nl", "en", "et",
    "fil", "fi", "fr", "gl", "ka", "de", "el", "gu", "he", "hi", "hu", "is",
    "id", "ga", "it", "ja", "kn", "kk", "km", "ko", "ky", "lo", "lv", "lt",
    "mk", "ms", "ml", "mt", "mr", "mn", "ne", "no", "or", "fa", "pl", "pt",
    "pa", "ro", "ru", "sr", "si", "sk", "sl", "es", "sw", "sv", "ta", "te",
    "th", "tr", "uk", "ur", "uz", "vi", "cy", "yi", "yo", "zu"
];

// Return an object mapping language code -> localized language name.
export function getComprehensiveLanguageList() {
    try {
        const map = {};
        LANGUAGE_CODES.forEach((code) => {
            if (code.includes("-")) {
                const [lang, region] = code.split("-");
                const languageName = languages.language.standard.long[lang] || code;
                const regionName = languages.region.long[region] || region;
                map[code] = `${languageName} (${regionName})`;
            } else {
                const name = languages.language.standard.long[code] || code;
                map[code] = name;
            }
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
export function getCountryLanguage(countryCode) {
    if (!countryCode) return null;
    try {
        const region = String(countryCode).toUpperCase();

        const zhRegionMap = { CN: "zh-CN", TW: "zh-TW", HK: "zh-HK", SG: "zh-CN" };
        if (zhRegionMap[region]) {
            const code = zhRegionMap[region];
            const name = languages.language.standard.long[code] || code;
            return { code, name };
        }

        const base = new Intl.Locale("und", { region });
        const maximized = base.maximize ? base.maximize() : base;
        const lang = maximized.language || "en";

        const name = languages.language.standard.long[lang] || lang;

        return { code: lang, name };
    } catch (e) {
        console.warn("TizenTube Subtitle Localization: Could not infer language for country", countryCode, e);
        return null;
    }
}

let isPatched = false;

// Get user's country code from YouTube's internal config.
// FIX: yt.config_.GL is an internal YouTube property with no stability guarantee.
// If YouTube restructures yt.config_ (as they have done in the past), this returns null
// silently. We now explicitly warn in that case so it shows up in debug logs.
function getUserCountryCode() {
    try {
        if (window.yt && window.yt.config_ && window.yt.config_.GL) {
            return window.yt.config_.GL;
        }
        // FIX: Promote to console.warn so this surfaces in the debug console and
        // log downloads, making it obvious when the config key has changed.
        console.warn(
            "TizenTube Subtitle Localization: window.yt.config_.GL is unavailable — " +
            "YouTube may have changed the config structure. User language detection will not work."
        );
        return null;
    } catch (error) {
        console.error(
            "TizenTube Subtitle Localization: Error accessing yt.config_.GL:",
            error
        );
        return null;
    }
}

// Function to get dynamic user language option name for settings UI
export function getUserLanguageOptionName() {
    try {
        const userCountryCode = getUserCountryCode();
        const userLanguage = getCountryLanguage(userCountryCode);
        if (userLanguage) {
            return `Show ${userLanguage.name} Subtitle`;
        }
    } catch (_) { }
    return "Show Local Subtitle";
}


// Function to check if language already exists in the menu
function languageExistsInMenu(items, languageCode, languageName) {
    try {
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
    } catch (_) {
        return false;
    }
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
                                    languageCode,
                                    languageName,
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
    try {
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
    } catch (_) { }
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

    const player = document.querySelector('.html5-video-player');
    if (!player) return setTimeout(patchSubtitleMenu, 250);

    if (!window._yttv) return setTimeout(patchSubtitleMenu, 250);

    let yttvInstance;
    try {
        yttvInstance = Object.values(window._yttv).find(
            (obj) =>
                obj &&
                obj.instance &&
                typeof obj.instance.resolveCommand === "function"
        );
    } catch (e) {
        console.error("TizenTube Subtitle Localization: Error finding resolveCommand instance:", e);
        return;
    }

    if (!yttvInstance) {
        console.error("TizenTube Subtitle Localization: Could not find resolveCommand instance.");
        return;
    }

    if (yttvInstance.instance.resolveCommand.isPatchedBySubtitleLocalization) {
        console.log("TizenTube Subtitle Localization: Already patched.");
        return;
    }

    const originalResolveCommand = yttvInstance.instance.resolveCommand;

    yttvInstance.instance.resolveCommand = function (cmd, _) {
        try {
            if (
                cmd?.openPopupAction?.uniqueId ===
                "CLIENT_OVERLAY_TYPE_CAPTIONS_AUTO_TRANSLATE"
            ) {
                const showUserLanguage = configRead("enableShowUserLanguage");
                const showOtherLanguages = configRead("enableShowOtherLanguages");

                if (!showUserLanguage && !showOtherLanguages) {
                    return originalResolveCommand.apply(this, arguments);
                }

                // Guard against unexpected menu structure changes
                const itemsPath = cmd?.openPopupAction?.popup?.overlaySectionRenderer
                    ?.overlay?.overlayTwoPanelRenderer?.actionPanel?.overlayPanelRenderer
                    ?.content?.overlayPanelItemListRenderer?.items;
                if (!Array.isArray(itemsPath)) {
                    return originalResolveCommand.apply(this, arguments);
                }
                const items = itemsPath;

                const existingLanguages = getExistingLanguages(items);

                if (showUserLanguage) {
                    try {
                        const userCountryCode = getUserCountryCode();
                        const userLanguage = getCountryLanguage(userCountryCode);

                        if (userLanguage) {
                            if (!languageExistsInMenu(items, userLanguage.code, userLanguage.name)) {
                                console.log(
                                    `%c[TizenTube Subtitle Localization] Adding user's local language: ${userLanguage.name} (${userLanguage.code})`,
                                    "background: #2196F3; color: #ffffff; font-size: 14px; font-weight: bold;"
                                );

                                const userLanguageOption = createLanguageOption(
                                    userLanguage.code,
                                    userLanguage.name
                                );

                                const recommendedIndex = items.findIndex(
                                    (item) =>
                                        item.overlayMessageRenderer?.subtitle
                                            ?.simpleText === "Recommended languages"
                                );

                                if (recommendedIndex > -1) {
                                    items.splice(recommendedIndex + 1, 0, userLanguageOption);
                                    existingLanguages.add(userLanguage.code);
                                    existingLanguages.add(userLanguage.name);
                                } else {
                                    const otherLanguagesIndex = items.findIndex(
                                        (item) =>
                                            item.overlayMessageRenderer?.subtitle
                                                ?.simpleText === "Other languages"
                                    );

                                    if (otherLanguagesIndex > -1) {
                                        items.splice(otherLanguagesIndex, 0, userLanguageOption);
                                    } else {
                                        items.unshift(userLanguageOption);
                                    }
                                    existingLanguages.add(userLanguage.code);
                                    existingLanguages.add(userLanguage.name);
                                }
                            } else {
                                console.log(
                                    `%c[TizenTube Subtitle Localization] User's language ${userLanguage.name} already exists in menu`,
                                    "background: #4CAF50; color: #ffffff; font-size: 12px;"
                                );
                            }
                        }
                        // getUserCountryCode() already warns when null, no need to repeat here
                    } catch (userLangErr) {
                        console.warn("TizenTube Subtitle Localization: Error adding user language:", userLangErr);
                    }
                }

                if (showOtherLanguages) {
                    try {
                        const missingLanguages = Object.entries(getComprehensiveLanguageList())
                            .filter(([code, name]) => !existingLanguages.has(code) && !existingLanguages.has(name))
                            .sort(([, a], [, b]) => a.localeCompare(b));

                        if (missingLanguages.length > 0) {
                            console.log(
                                `%c[TizenTube Subtitle Localization] Adding "Tizen Languages" section with ${missingLanguages.length} additional languages`,
                                "background: #FF9800; color: #ffffff; font-size: 12px;"
                            );

                            items.push(createSectionTitle("Other Languages"));

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
                    } catch (otherLangErr) {
                        console.warn("TizenTube Subtitle Localization: Error adding other languages:", otherLangErr);
                    }
                }
            }
        } catch (patchErr) {
            console.warn("TizenTube Subtitle Localization: Patch handler error:", patchErr);
        }

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