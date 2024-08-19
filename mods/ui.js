/*global navigate*/
import './spatial-navigation-polyfill.js';
import css from './ui.css';
import { configRead, configWrite } from './config.js';
import updateStyle from './theme.js';

// It just works, okay?
const interval = setInterval(() => {
  const videoElement = document.querySelector('video');
  if (videoElement) {
    execute_once_dom_loaded();
    clearInterval(interval);
  }
}, 250);

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

  uiContainer.innerHTML = `
<h1>TizenTube Configuration</h1>
<label for="__adblock"><input type="checkbox" id="__adblock" /> Enable AdBlocking</label>
<label for="__fixedUI"><input type="checkbox" id="__fixedUI" /> Enable Fixed UI</label>
<label for="__sponsorblock"><input type="checkbox" id="__sponsorblock" /> Enable SponsorBlock</label>
<blockquote>
<label for="__sponsorblock_sponsor"><input type="checkbox" id="__sponsorblock_sponsor" /> Skip Sponsor Segments</label>
<label for="__sponsorblock_intro"><input type="checkbox" id="__sponsorblock_intro" /> Skip Intro Segments</label>
<label for="__sponsorblock_outro"><input type="checkbox" id="__sponsorblock_outro" /> Skip Outro Segments</label>
<label for="__sponsorblock_interaction"><input type="checkbox" id="__sponsorblock_interaction" /> Skip Interaction Reminder Segments</label>
<label for="__sponsorblock_selfpromo"><input type="checkbox" id="__sponsorblock_selfpromo" /> Skip Self Promotion Segments</label>
<label for="__sponsorblock_music_offtopic"><input type="checkbox" id="__sponsorblock_music_offtopic" /> Skip Music and Off-topic Segments</label>
</blockquote>
<label for="__dearrow"><input type="checkbox" id="__dearrow" /> Enable DeArrow</label>
<blockquote>
<label for="__dearrow_thumbnails"><input type="checkbox" id="__dearrow_thumbnails" /> Enable DeArrow Thumbnails</label>
<div><small>DeArrow Thumbnail changing might break the shelve renderer. Be warned.</small></div>
</blockquote>
<label for="__barColor">Navigation Bar Color: <input type="text" id="__barColor"/></label>
<label for="__routeColor">Main Content Color: <input type="text" id="__routeColor"/></label>
<div><small>Sponsor segments skipping - https://sponsor.ajay.app</small></div>
`;
  document.querySelector('body').appendChild(uiContainer);

  uiContainer.querySelector('#__adblock').checked = configRead('enableAdBlock');
  uiContainer.querySelector('#__adblock').addEventListener('change', (evt) => {
    configWrite('enableAdBlock', evt.target.checked);
  });

  uiContainer.querySelector('#__sponsorblock').checked =
    configRead('enableSponsorBlock');
  uiContainer
    .querySelector('#__sponsorblock')
    .addEventListener('change', (evt) => {
      configWrite('enableSponsorBlock', evt.target.checked);
    });

  uiContainer.querySelector('#__sponsorblock_sponsor').checked = configRead(
    'enableSponsorBlockSponsor'
  );
  uiContainer
    .querySelector('#__sponsorblock_sponsor')
    .addEventListener('change', (evt) => {
      configWrite('enableSponsorBlockSponsor', evt.target.checked);
    });

  uiContainer.querySelector('#__sponsorblock_intro').checked = configRead(
    'enableSponsorBlockIntro'
  );
  uiContainer
    .querySelector('#__sponsorblock_intro')
    .addEventListener('change', (evt) => {
      configWrite('enableSponsorBlockIntro', evt.target.checked);
    });

  uiContainer.querySelector('#__sponsorblock_outro').checked = configRead(
    'enableSponsorBlockOutro'
  );
  uiContainer
    .querySelector('#__sponsorblock_outro')
    .addEventListener('change', (evt) => {
      configWrite('enableSponsorBlockOutro', evt.target.checked);
    });

  uiContainer.querySelector('#__sponsorblock_interaction').checked = configRead(
    'enableSponsorBlockInteraction'
  );
  uiContainer
    .querySelector('#__sponsorblock_interaction')
    .addEventListener('change', (evt) => {
      configWrite('enableSponsorBlockInteraction', evt.target.checked);
    });

  uiContainer.querySelector('#__sponsorblock_selfpromo').checked = configRead(
    'enableSponsorBlockSelfPromo'
  );
  uiContainer
    .querySelector('#__sponsorblock_selfpromo')
    .addEventListener('change', (evt) => {
      configWrite('enableSponsorBlockSelfPromo', evt.target.checked);
    });

  uiContainer.querySelector('#__sponsorblock_music_offtopic').checked =
    configRead('enableSponsorBlockMusicOfftopic');
  uiContainer
    .querySelector('#__sponsorblock_music_offtopic')
    .addEventListener('change', (evt) => {
      configWrite('enableSponsorBlockMusicOfftopic', evt.target.checked);
    });

  uiContainer.querySelector('#__dearrow').checked = configRead('enableDeArrow');
  uiContainer.querySelector('#__dearrow').addEventListener('change', (evt) => {
    configWrite('enableDeArrow', evt.target.checked);
  });

  uiContainer.querySelector('#__dearrow_thumbnails').checked = configRead('enableDeArrowThumbnails');
  uiContainer.querySelector('#__dearrow_thumbnails').addEventListener('change', (evt) => {
    configWrite('enableDeArrowThumbnails', evt.target.checked);
  });

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

  uiContainer.querySelector('#__fixedUI').checked = configRead('enableFixedUI');
  uiContainer.querySelector('#__fixedUI').addEventListener('change', (evt) => {
    configWrite('enableFixedUI', evt.target.checked);
  });

  var eventHandler = (evt) => {
    // We handle key events ourselves.
    console.info(
      'Key event:',
      evt.type,
      evt.keyCode,
      evt.keyCode,
      evt.defaultPrevented
    );
    if (evt.keyCode == 404 || evt.keyCode == 172) {
      console.info('Taking over!');
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.type === 'keydown') {
        if (uiContainer.style.display === 'none') {
          console.info('Showing and focusing!');
          uiContainer.style.display = 'block';
          uiContainer.focus();
        } else {
          console.info('Hiding!');
          uiContainer.style.display = 'none';
          uiContainer.blur();
        }
      }
      return false;
    }
    return true;
  };

  // Red, Green, Yellow, Blue
  // 403, 404, 405, 406
  // ---, 172, 170, 191
  document.addEventListener('keydown', eventHandler, true);
  document.addEventListener('keypress', eventHandler, true);
  document.addEventListener('keyup', eventHandler, true);

  setTimeout(() => {
    showNotification('Press [GREEN] to open TizenTube configuration screen\nPress [BLUE] to open Video Speed configuration screen');
  }, 2000);

  // Fix UI issues, again. Love, Googol.

  if (configRead('enableFixedUI')) {
    try {
      const observer = new MutationObserver((_, _2) => {
        const body = document.querySelector('body');
        if (body.classList.contains('app-quality-root')) {
          body.classList.remove('app-quality-root');
        }
      });
      observer.observe(document.getElementsByTagName('body')[0], { attributes: true, childList: false, subtree: false });
    } catch (e) { }
  }
}

export function showNotification(text, time = 3000) {
  if (!document.querySelector('.ytaf-notification-container')) {
    console.info('Adding notification container');
    const c = document.createElement('div');
    c.classList.add('ytaf-notification-container');
    document.body.appendChild(c);
  }

  const elm = document.createElement('div');
  const elmInner = document.createElement('div');
  elmInner.innerText = text;
  elmInner.classList.add('message');
  elmInner.classList.add('message-hidden');
  elm.appendChild(elmInner);
  document.querySelector('.ytaf-notification-container').appendChild(elm);

  setTimeout(() => {
    elmInner.classList.remove('message-hidden');
  }, 100);
  setTimeout(() => {
    elmInner.classList.add('message-hidden');
    setTimeout(() => {
      elm.remove();
    }, 1000);
  }, time);
}