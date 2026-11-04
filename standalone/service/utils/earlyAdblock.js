"use strict";

// The ad blocker in the userscript (mods/features/adblock.js) hooks JSON.parse.
// The userscript itself can't run at document start: it touches document.head
// and document.body as soon as it loads. So the first player response, with
// its ads, used to be parsed before the hook existed.
//
// EARLY_HOOK is a minimal copy of the same ad rules that runs at document
// start, before any YouTube code. It honours the userscript's "enableAdBlock"
// setting. The full userscript still installs its own hook later; the two
// chain, and emptying an already empty list is harmless.
const EARLY_HOOK = `(function () {
    if (window.__tizentubeEarlyAdblock) return;
    window.__tizentubeEarlyAdblock = true;
    var origParse = JSON.parse;
    function adBlockEnabled() {
        try {
            var config = origParse(window.localStorage['ytaf-configuration']);
            return config.enableAdBlock !== false;
        } catch (e) {
            return true;
        }
    }
    JSON.parse = function () {
        var r = origParse.apply(this, arguments);
        try {
            if (r && typeof r === 'object' && adBlockEnabled()) {
                if (r.adPlacements) r.adPlacements = [];
                if (r.playerAds) r.playerAds = false;
                if (r.adSlots) r.adSlots = [];
            }
        } catch (e) {}
        return r;
    };
})();`;

// For the debugger path (Page.addScriptToEvaluateOnNewDocument): install the
// early hook at once, and run the full userscript when the DOM is ready.
function documentStartScript(userScript) {
    return EARLY_HOOK + `
(function () {
    var source = ${JSON.stringify(userScript)};
    function run() { (0, eval)(source); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
})();`;
}

module.exports = { EARLY_HOOK, documentStartScript };
