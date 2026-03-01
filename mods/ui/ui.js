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
import { initMediaHooks } from '../features/mediaHooks.js';

// Initialize low-level media hooks as early as possible
initMediaHooks();

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
  const performanceMode = configRead('enablePerformanceMode');
  if (ui) {
    try {
      window.tectonicConfig.featureSwitches.isLimitedMemory = performanceMode ? true : false;
      window.tectonicConfig.clientData.legacyApplicationQuality = performanceMode ? 'low' : 'full-animation';
      window.tectonicConfig.featureSwitches.enableAnimations = performanceMode ? false : true;
      window.tectonicConfig.featureSwitches.enableOnScrollLinearAnimation = performanceMode ? false : true;
      window.tectonicConfig.featureSwitches.enableListAnimations = performanceMode ? false : true;
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
    () => console.info('uiContainer focused!'),
    true
  );
  uiContainer.addEventListener(
    'blur',
    () => console.info('uiContainer blured!'),
    true
  );

  uiContainer.addEventListener(
    'keydown',
    (evt) => {
      console.info('uiContainer key event:', evt.type, evt.keyCode, evt);
      if (evt.keyCode !== 404 && evt.keyCode !== 172) {
        if (evt.keyCode in ARROW_KEY_CODE) {
          navigate(ARROW_KEY_CODE[evt.keyCode]);
        } else if (evt.keyCode === 13 || evt.keyCode === 32) {
          // "OK" button
          console.log('OK button pressed');
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
    // We handle key events ourselves.
    console.info(
      'Key event:',
      evt.type,
      evt.keyCode,
      evt.keyCode,
      evt.defaultPrevented
    );
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
    if (evt.keyCode == 403) {
      console.info('Taking over!');
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.type === 'keydown') {
        try {
          if (uiContainer.style.display === 'none') {
            console.info('Showing and focusing!');
            uiContainer.style.display = 'block';
            uiContainer.focus();
          } else {
            console.info('Hiding!');
            uiContainer.style.display = 'none';
            uiContainer.blur();
          }
        } catch (e) { }
      }
      return false;
    } else if (evt.keyCode == 404) {
      if (evt.type === 'keydown') {
        modernUI();
      }
    } else if (evt.keyCode == 39) {
      // Right key, for PiP and Voice Search
      if (evt.type === 'keydown') {
        const isSearchFocused = document.querySelector('ytlr-search-text-box > .zylon-focus');
        const voiceButton = document.querySelector('#tt-voice-search-button');
        if (isSearchFocused && voiceButton) {
          //     showToast('Voice Search', 'Press [OK] to activate voice search');
          voiceButton.focus();
          evt.preventDefault();
          evt.stopPropagation();
        } else if ((isSearchFocused || (voiceButton && document.activeElement === voiceButton)) && window.isPipPlaying) {
          const ytlrPlayer = document.querySelector('ytlr-player');
          ytlrPlayer.style.setProperty('background-color', 'rgb(0, 0, 0)');
          pipToFullscreen();
        }
      }
    };
    return true;
  }

  // Red, Green, Yellow, Blue
  // 403, 404, 405, 406
  // ---, 172, 170, 191
  document.addEventListener('keydown', eventHandler, true);
  document.addEventListener('keypress', eventHandler, true);
  document.addEventListener('keyup', eventHandler, true);
  if (configRead('showWelcomeToast')) {
    setTimeout(() => {
      //showToast('Welcome to TizenTubeJX', 'Go to settings and click on TizenTube Settings for settings, press [RED] to open TizenTube Theme Settings.');
    }, 2000);
  }

  // Debug API availability
  setTimeout(() => {
    const apiKeys = window.webapis ? Object.keys(window.webapis).slice(0, 10).join(", ") : "none";
    const tizenKeys = window.tizen ? Object.keys(window.tizen).slice(0, 5).join(", ") : "none";
    //  showToast("Debug API", "Webapis: " + !!window.webapis + " | Tizen: " + !!window.tizen + " | Voice: " + (window.webapis ? !!window.webapis.voiceinteraction : "N/A"));
    //  showToast("API Keys", "WebAPI: " + apiKeys + " | Tizen: " + tizenKeys);
    console.log("Webapis:", !!window.webapis, "Tizen:", !!window.tizen);
  }, 5000);

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