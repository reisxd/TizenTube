// ==UserScript==
// @name         TizenTube Log Download Button
// @namespace    https://github.com/KrX3D/TizenTube
// @version      0.4
// @description  Inject a floating button to trigger window.downloadTizenTubeLogs()
// @match        https://www.youtube.com/tv*
// @match        https://youtube.com/tv*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/KrX3D/TizenTube/main/scripts/tampermonkey/tizentube-log-button.user.js
// @downloadURL  https://raw.githubusercontent.com/KrX3D/TizenTube/main/scripts/tampermonkey/tizentube-log-button.user.js
// ==/UserScript==

(function () {
  const buttonId = 'tt-log-download-btn';

  const ensureButton = () => {
    if (document.getElementById(buttonId)) return;

    const btn = document.createElement('button');
    btn.id = buttonId;
    btn.textContent = 'TT Logs';
    btn.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:2147483647',
      'padding:8px 10px',
      'font-size:12px',
      'font-family:monospace',
      'color:#0f0',
      'background:#111',
      'border:1px solid #0f0',
      'border-radius:4px',
      'cursor:pointer',
      'opacity:0.9'
    ].join(';');

    btn.addEventListener('click', () => {
      if (typeof window.downloadTizenTubeLogs === 'function') {
        window.downloadTizenTubeLogs();
      } else {
        console.warn('[TT_LOG_BUTTON] window.downloadTizenTubeLogs is not available yet');
      }
    });

    document.body.appendChild(btn);
  };

  const interval = setInterval(() => {
    if (document.body) ensureButton();
    if (document.getElementById(buttonId)) clearInterval(interval);
  }, 500);
})();