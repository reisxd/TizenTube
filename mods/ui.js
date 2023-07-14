/*global navigate*/
import './spatial-navigation-polyfill.js';
import './ui.css';
import { configRead, configWrite } from './config.js';

// We handle key events ourselves.
window.__spatialNavigation__.keyMode = 'NONE';

const ARROW_KEY_CODE = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

const uiContainer = document.createElement('div');
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
    console.info('uiContainer key event:', evt.type, evt.charCode);
    if (evt.charCode !== 404 && evt.charCode !== 172) {
      if (evt.keyCode in ARROW_KEY_CODE) {
        navigate(ARROW_KEY_CODE[evt.keyCode]);
      } else if (evt.keyCode === 13) {
        // "OK" button
        document.querySelector(':focus').click();
      } else if (evt.keyCode === 27) {
        // Back button
        uiContainer.style.display = 'none';
        uiContainer.blur();
      }
      evt.preventDefault();
      evt.stopPropagation();
    }
  },
  true
);

uiContainer.innerHTML = `
<h1>webOS YouTube Extended</h1>
<label for="__adblock"><input type="checkbox" id="__adblock" /> Enable AdBlocking</label>
<label for="__sponsorblock"><input type="checkbox" id="__sponsorblock" /> Enable SponsorBlock</label>
<blockquote>
<label for="__sponsorblock_sponsor"><input type="checkbox" id="__sponsorblock_sponsor" /> Skip Sponsor Segments</label>
<label for="__sponsorblock_intro"><input type="checkbox" id="__sponsorblock_intro" /> Skip Intro Segments</label>
<label for="__sponsorblock_outro"><input type="checkbox" id="__sponsorblock_outro" /> Skip Outro Segments</label>
<label for="__sponsorblock_interaction"><input type="checkbox" id="__sponsorblock_interaction" /> Skip Interaction Reminder Segments</label>
<label for="__sponsorblock_selfpromo"><input type="checkbox" id="__sponsorblock_selfpromo" /> Skip Self Promotion Segments</label>
<label for="__sponsorblock_music_offtopic"><input type="checkbox" id="__sponsorblock_music_offtopic" /> Skip Music and Off-topic Segments</label>
</blockquote>
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

const eventHandler = (evt) => {
  console.info(
    'Key event:',
    evt.type,
    evt.charCode,
    evt.keyCode,
    evt.defaultPrevented
  );
  if (evt.charCode == 404 || evt.charCode == 172) {
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

setTimeout(() => {
  showNotification('Press [GREEN] to open YTAF configuration screen');
}, 2000);
