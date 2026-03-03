/*global navigate*/
import '../spatial-navigation-polyfill.js';
import css from './ui.css';
import { configRead, configWrite } from '../config.js';
import updateStyle from './theme.js';
import { showToast } from './ytUI.js';
import modernUI from './settings.js';
import resolveCommand, { patchResolveCommand } from '../resolveCommand.js';
import { pipToFullscreen } from '../features/pictureInPicture.js';
import getCommandExecutor from './customCommandExecution.js';

// It just works, okay?
const interval = setInterval(() => {
  const videoElement = document.querySelector('video');
  if (videoElement) {
    execute_once_dom_loaded();
    patchResolveCommand();
    clearInterval(interval);
  }
}, 250);

let keyTimeout = null;


function mapDesktopColorKey(evt) {
  const code = evt.code || '';
  const key = (evt.key || '').toLowerCase();

  // Desktop fallbacks for TV remote color keys when testing on Windows.
  if (code === 'KeyR' || key === 'r' || code === 'F1' || code === 'Digit1') return 403; // RED
  if (code === 'KeyG' || key === 'g' || code === 'F2' || code === 'Digit2') return 404; // GREEN
  if (code === 'KeyY' || key === 'y' || code === 'F3' || code === 'Digit3') return 405; // YELLOW
  if (code === 'KeyB' || key === 'b' || code === 'F4' || code === 'Digit4') return 406; // BLUE

  return evt.keyCode;
}

function execute_once_dom_loaded() {

  // Add CSS to head.

  const existingStyle = document.querySelector('style[nonce]');
  if (existingStyle) {
    existingStyle.textContent += css;
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Fix UI issues.
  const ui = configRead('enableFixedUI');
  if (ui) {
    try {
      window.tectonicConfig.featureSwitches.isLimitedMemory = false;
      window.tectonicConfig.clientData.legacyApplicationQuality = 'full-animation';
      window.tectonicConfig.featureSwitches.enableAnimations = true;
      window.tectonicConfig.featureSwitches.enableOnScrollLinearAnimation = true;
      window.tectonicConfig.featureSwitches.enableListAnimations = true;
    } catch (e) { }
  }

  // We handle key events ourselves.
  window.__spatialNavigation__.keyMode = 'NONE';

  var ARROW_KEY_CODE = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

  var uiContainer = document.createElement('div');
  uiContainer.classList.add('ytaf-ui-container');
  uiContainer.style['display'] = 'none';
  uiContainer.setAttribute('tabindex', 0);
  uiContainer.addEventListener(
    'focus',
    () => { },
    true
  );
  uiContainer.addEventListener(
    'blur',
    () => { },
    true
  );

  uiContainer.addEventListener(
    'keydown',
    (evt) => {
      if (evt.keyCode !== 404 && evt.keyCode !== 172) {
        if (evt.keyCode in ARROW_KEY_CODE) {
          navigate(ARROW_KEY_CODE[evt.keyCode]);
        } else if (evt.keyCode === 13 || evt.keyCode === 32) {
          // "OK" button
          const focusedElement = document.querySelector(':focus');
          if (focusedElement.type === 'checkbox') {
            focusedElement.checked = !focusedElement.checked;
            focusedElement.dispatchEvent(new Event('change'));
          }
          evt.preventDefault();
          evt.stopPropagation();
          return;
        } else if (evt.keyCode === 27 && document.querySelector(':focus').type !== 'text') {
          // Back button
          uiContainer.style.display = 'none';
          uiContainer.blur();
        } else if (document.querySelector(':focus').type === 'text' && evt.keyCode === 27) {
          const focusedElement = document.querySelector(':focus');
          focusedElement.value = focusedElement.value.slice(0, -1);
        }


        if (evt.key === 'Enter' || evt.Uc?.key === 'Enter') {
          // If the focused element is a text input, emit a change event.
          if (document.querySelector(':focus').type === 'text') {
            document.querySelector(':focus').dispatchEvent(new Event('change'));
          }
        }
      }
    },
    true
  );

  try {
    uiContainer.innerHTML = `
<h1>TizenTube Theme Configuration</h1>
<label for="__barColor">Navigation Bar Color: <input type="text" id="__barColor"/></label>
<label for="__routeColor">Main Content Color: <input type="text" id="__routeColor"/></label>
<div><small>Sponsor segments skipping - https://sponsor.ajay.app</small></div>
`;
    document.querySelector('body').appendChild(uiContainer);

    uiContainer.querySelector('#__barColor').value = configRead('focusContainerColor');
    uiContainer.querySelector('#__barColor').addEventListener('change', (evt) => {
      configWrite('focusContainerColor', evt.target.value);
      updateStyle();
    });

    uiContainer.querySelector('#__routeColor').value = configRead('routeColor');
    uiContainer.querySelector('#__routeColor').addEventListener('change', (evt) => {
      configWrite('routeColor', evt.target.value);
      updateStyle();
    });
  } catch (e) { }

  var eventHandler = (evt) => {
    const mappedKeyCode = mapDesktopColorKey(evt);

    // We handle key events ourselves.
    if (configRead('enableScreenDimming')) {
      if (keyTimeout) {
        clearTimeout(keyTimeout);
      }
      document.getElementById('container').style.setProperty('opacity', '1', 'important');
      keyTimeout = setTimeout(() => {
        const videoPlayer = document.querySelector('.html5-video-player');
        const playerStateObject = videoPlayer.getPlayerStateObject();
        if (playerStateObject.isPlaying) return;
        document.getElementById('container').style.setProperty('opacity', (1 - configRead('dimmingOpacity')).toString(), 'important');
      }, configRead('dimmingTimeout') * 1000);
    }
    if (mappedKeyCode == 403) {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.type === 'keydown') {
        try {
          if (uiContainer.style.display === 'none') {
            uiContainer.style.display = 'block';
            uiContainer.focus();
          } else {
            uiContainer.style.display = 'none';
            uiContainer.blur();
          }
        } catch (e) { }
      }
      return false;
    } else if (mappedKeyCode == 404) {
      if (evt.type === 'keydown') {
        modernUI();
      }
    } else if (mappedKeyCode == 405 || mappedKeyCode == 170) {
      if (evt.type === 'keydown' && typeof window.toggleDebugConsole === 'function') {
        evt.preventDefault();
        evt.stopPropagation();
        window.toggleDebugConsole();
      }
    } else if (evt.keyCode == 39) {
      // Right key, for PiP
      if (evt.type === 'keydown') {
        if (document.querySelector('ytlr-search-text-box > .zylon-focus') && window.isPipPlaying) {
          const ytlrPlayer = document.querySelector('ytlr-player');
          ytlrPlayer.style.setProperty('background-color', 'rgb(0, 0, 0)');
          pipToFullscreen();
        }
      }
    };
    return true;
  };

  // Red, Green, Yellow, Blue
  // TV key codes: 403, 404, 405, 406
  // Alternative key codes: ---, 172, 170, 191
  // Desktop test fallbacks: R/G/Y/B, F1/F2/F3/F4, 1/2/3/4
  document.addEventListener('keydown', eventHandler, true);
  if (configRead('showWelcomeToast')) {
    setTimeout(() => {
      showToast('Welcome to TizenTube', 'Press [GREEN]/G to open TizenTube Settings, [RED]/R for Theme Settings, [YELLOW]/Y for Debug Console.');
    }, 2000);
  }

  if (configRead('launchToOnStartup')) {
    resolveCommand(JSON.parse(configRead('launchToOnStartup')));
  } else {
    resolveCommand({
      signalAction: {
        signal: 'SOFT_RELOAD_PAGE'
      }
    });
  }

  const commandExecutor = getCommandExecutor();
  if (commandExecutor) {
    commandExecutor.executeFunction(new commandExecutor.commandFunction('reloadGuideAction'));
  }

  // Fix UI issues, again. Love, Googol.

  if (configRead('enableFixedUI')) {
    try {
      const observer = new MutationObserver((_, _2) => {
        const body = document.body;
        if (body.classList.contains('app-quality-root')) {
          body.classList.remove('app-quality-root');
        }
      });
      observer.observe(document.body, { attributes: true, childList: false, subtree: false });
    } catch (e) { }
  }
}