// TizenTube Subtitle Localization Mod
// Automatically adds user's local language to subtitle auto-translate menu if not present

import { configRead } from "./config.js";

// Comprehensive language list for "Others" menu
const COMPREHENSIVE_LANGUAGE_LIST = {
    af: "Afrikaans",
    sq: "Albanian",
    am: "Amharic",
    ar: "Arabic",
    hy: "Armenian",
    as: "Assamese",
    az: "Azerbaijani",
    eu: "Basque",
    be: "Belarusian",
    bn: "Bangla",
    bs: "Bosnian",
    bg: "Bulgarian",
    my: "Burmese",
    ca: "Catalan",
    "zh-CN": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)",
    "zh-HK": "Chinese (Hong Kong)",
    hr: "Croatian",
    cs: "Czech",
    da: "Danish",
    nl: "Dutch",
    en: "English",
    et: "Estonian",
    fil: "Filipino",
    fi: "Finnish",
    fr: "French",
    gl: "Galician",
    ka: "Georgian",
    de: "German",
    el: "Greek",
    gu: "Gujarati",
    he: "Hebrew",
    hi: "Hindi",
    hu: "Hungarian",
    is: "Icelandic",
    id: "Indonesian",
    ga: "Irish",
    it: "Italian",
    ja: "Japanese",
    kn: "Kannada",
    kk: "Kazakh",
    km: "Khmer",
    ko: "Korean",
    ky: "Kyrgyz",
    lo: "Lao",
    lv: "Latvian",
    lt: "Lithuanian",
    mk: "Macedonian",
    ms: "Malay",
    ml: "Malayalam",
    mt: "Maltese",
    mr: "Marathi",
    mn: "Mongolian",
    ne: "Nepali",
    no: "Norwegian",
    or: "Odia",
    fa: "Persian",
    pl: "Polish",
    pt: "Portuguese",
    pa: "Punjabi",
    ro: "Romanian",
    ru: "Russian",
    sr: "Serbian",
    si: "Sinhala",
    sk: "Slovak",
    sl: "Slovenian",
    es: "Spanish",
    sw: "Swahili",
    sv: "Swedish",
    ta: "Tamil",
    te: "Telugu",
    th: "Thai",
    tr: "Turkish",
    uk: "Ukrainian",
    ur: "Urdu",
    uz: "Uzbek",
    vi: "Vietnamese",
    cy: "Welsh",
    yi: "Yiddish",
    yo: "Yoruba",
    zu: "Zulu",
};

// Country code to language mapping based on most commonly spoken languages
export const COUNTRY_TO_LANGUAGE = {
    // Major languages from the provided data
    US: { code: "en", name: "English" },
    GB: { code: "en", name: "English" },
    CA: { code: "en", name: "English" },
    AU: { code: "en", name: "English" },
    NZ: { code: "en", name: "English" },
    IE: { code: "en", name: "English" },
    ZA: { code: "en", name: "English" },

    ES: { code: "es", name: "Spanish" },
    MX: { code: "es", name: "Spanish" },
    AR: { code: "es", name: "Spanish" },
    CO: { code: "es", name: "Spanish" },
    CL: { code: "es", name: "Spanish" },
    PE: { code: "es", name: "Spanish" },
    VE: { code: "es", name: "Spanish" },

    FR: { code: "fr", name: "French" },
    BE: { code: "fr", name: "French" },
    CH: { code: "fr", name: "French" },
    LU: { code: "fr", name: "French" },
    MC: { code: "fr", name: "French" },

    DE: { code: "de", name: "German" },
    AT: { code: "de", name: "German" },

    IT: { code: "it", name: "Italian" },
    SM: { code: "it", name: "Italian" },
    VA: { code: "it", name: "Italian" },

    PT: { code: "pt", name: "Portuguese" },
    BR: { code: "pt", name: "Portuguese" },

    RU: { code: "ru", name: "Russian" },
    BY: { code: "ru", name: "Russian" },
    KZ: { code: "ru", name: "Russian" },

    CN: { code: "zh-CN", name: "Chinese (Simplified)" },
    TW: { code: "zh-TW", name: "Chinese (Traditional)" },
    HK: { code: "zh-HK", name: "Chinese (Traditional)" },
    SG: { code: "zh-CN", name: "Chinese (Simplified)" },

    JP: { code: "ja", name: "Japanese" },
    KR: { code: "ko", name: "Korean" },

    IN: { code: "hi", name: "Hindi" },
    PK: { code: "ur", name: "Urdu" },
    BD: { code: "bn", name: "Bangla" },

    IR: { code: "fa", name: "Persian" },
    AF: { code: "fa", name: "Persian" },

    SA: { code: "ar", name: "Arabic" },
    EG: { code: "ar", name: "Arabic" },
    AE: { code: "ar", name: "Arabic" },
    QA: { code: "ar", name: "Arabic" },
    KW: { code: "ar", name: "Arabic" },
    BH: { code: "ar", name: "Arabic" },
    OM: { code: "ar", name: "Arabic" },
    JO: { code: "ar", name: "Arabic" },
    LB: { code: "ar", name: "Arabic" },
    SY: { code: "ar", name: "Arabic" },
    IQ: { code: "ar", name: "Arabic" },
    MA: { code: "ar", name: "Arabic" },
    TN: { code: "ar", name: "Arabic" },
    DZ: { code: "ar", name: "Arabic" },
    LY: { code: "ar", name: "Arabic" },

    TR: { code: "tr", name: "Turkish" },
    TH: { code: "th", name: "Thai" },
    VN: { code: "vi", name: "Vietnamese" },
    ID: { code: "id", name: "Indonesian" },
    MY: { code: "ms", name: "Malay" },
    PH: { code: "fil", name: "Filipino" },

    NL: { code: "nl", name: "Dutch" },
    SE: { code: "sv", name: "Swedish" },
    NO: { code: "no", name: "Norwegian" },
    DK: { code: "da", name: "Danish" },
    FI: { code: "fi", name: "Finnish" },
    IS: { code: "is", name: "Icelandic" },

    PL: { code: "pl", name: "Polish" },
    CZ: { code: "cs", name: "Czech" },
    SK: { code: "sk", name: "Slovak" },
    HU: { code: "hu", name: "Hungarian" },
    RO: { code: "ro", name: "Romanian" },
    BG: { code: "bg", name: "Bulgarian" },
    HR: { code: "hr", name: "Croatian" },
    SI: { code: "sl", name: "Slovenian" },
    RS: { code: "sr", name: "Serbian" },
    BA: { code: "bs", name: "Bosnian" },
    MK: { code: "mk", name: "Macedonian" },
    AL: { code: "sq", name: "Albanian" },
    GR: { code: "el", name: "Greek" },

    UA: { code: "uk", name: "Ukrainian" },
    LT: { code: "lt", name: "Lithuanian" },
    LV: { code: "lv", name: "Latvian" },
    EE: { code: "et", name: "Estonian" },

    GE: { code: "ka", name: "Georgian" },
    AM: { code: "hy", name: "Armenian" },
    AZ: { code: "az", name: "Azerbaijani" },

    IL: { code: "he", name: "Hebrew" },
    ET: { code: "am", name: "Amharic" },
    KE: { code: "sw", name: "Swahili" },
    TZ: { code: "sw", name: "Swahili" },

    NG: { code: "en", name: "English" }, // Nigeria uses English officially
    GH: { code: "en", name: "English" }, // Ghana uses English officially
};

let isPatched = false;

// Function to get user's country code
function getUserCountryCode() {
    try {
        // Always use window.yt.config_.GL as primary source
        if (window.yt && window.yt.config_ && window.yt.config_.GL) {
            return window.yt.config_.GL;
        }

        // Fallback: try to get from other global variables
        if (window.data && window.data.GL) {
            return window.data.GL;
        }

        // Another fallback: try from clientData
        if (
            window.tectonicConfig &&
            window.tectonicConfig.clientData &&
            window.tectonicConfig.clientData.GL
        ) {
            return window.tectonicConfig.clientData.GL;
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
    if (userCountryCode && COUNTRY_TO_LANGUAGE[userCountryCode]) {
        const userLanguage = COUNTRY_TO_LANGUAGE[userCountryCode];
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

                if (userCountryCode && COUNTRY_TO_LANGUAGE[userCountryCode]) {
                    const userLanguage = COUNTRY_TO_LANGUAGE[userCountryCode];

                    // Check if the user's language already exists
                    if (
                        !languageExistsInMenu(
                            items,
                            userLanguage.code,
                            userLanguage.name
                        )
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
                const missingLanguages = Object.entries(
                    COMPREHENSIVE_LANGUAGE_LIST
                )
                    .filter(
                        ([code, name]) =>
                            !existingLanguages.has(code) &&
                            !existingLanguages.has(name)
                    )
                    .sort(([, a], [, b]) => a.localeCompare(b));

                if (missingLanguages.length > 0) {
                    console.log(
                        `%c[TizenTube Subtitle Localization] Adding "Tizen Languages" section with ${missingLanguages.length} additional languages`,
                        "background: #FF9800; color: #ffffff; font-size: 12px;"
                    );

                    // Add section title
                    items.push(createSectionTitle("Tizen Languages"));

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
