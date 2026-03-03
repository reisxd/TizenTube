import { configRead, configWrite } from '../config.js';
import resolveCommand from '../resolveCommand.js';
import rootPkg from '../../package.json';

const APP_VERSION_LABEL = 'TizenTube';
const APP_VERSION = rootPkg.version;

function initVisualConsole() {
  const positions = {
    'top-left': { top: '0', left: '0', right: '', bottom: '', transform: '' },
    'top-right': { top: '0', right: '0', left: '', bottom: '', transform: '' },
    'bottom-left': { bottom: '0', left: '0', right: '', top: '', transform: '' },
    'bottom-right': { bottom: '0', right: '0', left: '', top: '', transform: '' },
    center: { top: '50%', left: '50%', right: '', bottom: '', transform: 'translate(-50%, -50%)' }
  };

  const consoleDiv = document.createElement('div');
  consoleDiv.id = 'tv-debug-console';

  const applyPosition = () => {
    const pos = configRead('debugConsolePosition') || 'bottom-right';
    Object.assign(consoleDiv.style, positions[pos] || positions['bottom-right']);
  };

  const applyHeight = () => {
    const h = Number(configRead('debugConsoleHeight') || 500);
    consoleDiv.style.height = `${h}px`;
  };

  consoleDiv.style.cssText = `
    position: fixed;
    width: 1054px;
    background: rgba(0, 0, 0, 0.95);
    color: #0f0;
    font-family: monospace;
    font-size: 13px;
    padding: 10px;
    overflow-y: auto;
    overflow-x: hidden;
    z-index: 999999;
    border: 3px solid #0f0;
    display: none;
    box-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
    pointer-events: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  `;

  applyPosition();
  applyHeight();

  const mount = () => {
    if (document.body && !document.getElementById('tv-debug-console')) document.body.appendChild(consoleDiv);
  };
  mount();
  document.addEventListener('DOMContentLoaded', mount);

  let logs = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  const esc = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const syncVisible = () => {
    const enabled = !!configRead('enableDebugConsole');
    consoleDiv.style.display = enabled ? 'block' : 'none';
    if (enabled) {
      applyPosition();
      applyHeight();
      consoleDiv.innerHTML = logs.join('');
      consoleDiv.scrollTop = 0;
    }
  };

  const addLog = (type, args) => {
    if (!configRead('enableDebugConsole') && !configRead('enableDebugLogging')) return;
    const color = type === 'error' ? '#f55' : type === 'warn' ? '#ff0' : '#0f0';
    const msg = args.map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    }).join(' ');
    logs.unshift(`<div style="color:${color};margin-bottom:4px;white-space:pre-wrap;word-wrap:break-word;">[${new Date().toLocaleTimeString()}] ${esc(msg)}</div>`);
    if (logs.length > 600) logs.pop();
    if (consoleDiv.style.display !== 'none') {
      consoleDiv.innerHTML = logs.join('');
      consoleDiv.scrollTop = 0;
    }
  };

  console.log = (...args) => { original.log.apply(console, args); addLog('log', args); };
  console.info = (...args) => { original.info.apply(console, args); addLog('info', args); };
  console.warn = (...args) => { original.warn.apply(console, args); addLog('warn', args); };
  console.error = (...args) => { original.error.apply(console, args); addLog('error', args); };
  console.debug = (...args) => { original.debug.apply(console, args); addLog('debug', args); };

  const downloadLogs = () => {
    try {
      const plainTextLogs = logs
        .map((entry) => entry.replace(/<div[^>]*>/g, '').replace(/<\/div>/g, ''))
        .join('\n');
      const blob = new Blob([plainTextLogs], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tizentube-logs-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      original.error('Failed to download logs', err);
    }
  };

  window.downloadTizenTubeLogs = downloadLogs;

  window.toggleDebugConsole = function () {
    configWrite('enableDebugConsole', !configRead('enableDebugConsole'));
    syncVisible();
  };

  setInterval(syncVisible, 500);
  syncVisible();

  console.log('[Console] ========================================');
  console.log('[Console] Use TizenTube settings to configure position/height');
  console.log(`[Console] Visual Console ${APP_VERSION_LABEL} v${APP_VERSION}`);
  console.log(`[Console] User-Agent: ${navigator.userAgent}`);
  console.log('[Console] User-Agent (raw):', navigator.userAgent);
  console.log('[Console] ========================================');

  const versionToastCmd = {
    openPopupAction: {
      popupType: 'TOAST',
      popupDurationSeconds: 5,
      popup: {
        overlayToastRenderer: {
          title: { simpleText: 'TizenTube started' },
          subtitle: { simpleText: 'Version ' + APP_VERSION }
        }
      }
    }
  };

  setTimeout(() => {
    try { resolveCommand(versionToastCmd); } catch (_) { }
  }, 1200);
}

const interval = setInterval(() => {
  if (document.querySelector('video')) {
    initVisualConsole();
    clearInterval(interval);
  }
}, 500);