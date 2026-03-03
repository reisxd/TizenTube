// ==UserScript==
// @name         TizenTube Loader
// @namespace    https://github.com/KrX3D/TizenTube
// @version      0.4
// @description  Load TizenTube userscript bundle for local /tv debugging
// @match        https://www.youtube.com/tv*
// @match        https://youtube.com/tv*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/KrX3D/TizenTube/main/scripts/tampermonkey/tizentube-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/KrX3D/TizenTube/main/scripts/tampermonkey/tizentube-loader.user.js
// @require      https://raw.githubusercontent.com/KrX3D/TizenTube/main/dist/userScript.js
// ==/UserScript==

(function () {
  // The actual TizenTube code is loaded via @require.
  // Tampermonkey updates this script by @version and update checks.
})();