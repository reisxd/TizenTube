/*global navigate*/
import './spatial-navigation-polyfill.js';
import './ui.css';
import { configRead, configWrite } from './config.js';

// Observer to catch when the video element is loaded, when it is -> execute the script
const observer = new MutationObserver((mutationsList, observer) => {
    mutationsList.forEach(mutation => {
        mutation.addedNodes.forEach(addedNode => {
            if (addedNode.tagName && addedNode.tagName.toLowerCase() === 'video') {
                execute_once_dom_loaded_speed();
                observer.disconnect();
            }
        });
    });
});

//Check if video element is already loaded. if not, wait for it once DOM is ready
const videoElement = document.querySelector('video');
if (videoElement) {
    execute_once_dom_loaded_speed();
} else {
    if (document.readyState !== 'loading') {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
}

function execute_once_dom_loaded_speed() {

    let selectedItem = null;
    let currentSpeed = configRead('videoSpeed');

    // We handle key events ourselves.
    window.__spatialNavigation__.keyMode = 'NONE';

    const ARROW_KEY_CODE = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
    const speedUIContainer = document.createElement('div');
    speedUIContainer.classList.add('ytaf-ui-container');
    speedUIContainer.style['display'] = 'none';
    speedUIContainer.setAttribute('tabindex', 0);
    speedUIContainer.addEventListener(
        'focus',
        () => console.info('speedUIContainer focused!'),
        true
    );
    speedUIContainer.addEventListener(
        'blur',
        () => console.info('speedUIContainer blured!'),
        true
    );

    speedUIContainer.addEventListener('navbeforefocus', (evt) => {
        console.info('navbeforefocus', evt.target);
        selectedItem = evt.target;
    });
    speedUIContainer.addEventListener(
        'keydown',
        (evt) => {
            console.info('speedUIContainer key event:', evt.type, evt.keyCode);
            if (evt.keyCode !== 404 && evt.keyCode !== 172) {
                if (evt.keyCode in ARROW_KEY_CODE) {
                    navigate(ARROW_KEY_CODE[evt.keyCode]);
                } else if (evt.keyCode === 13 || evt.keyCode === 32) {
                    // "OK" button
                    if (selectedItem) {
                        selectedItem.checked = true;
                        const speed = document.querySelector('input[name="speed"]:checked').value;
                        configWrite('videoSpeed', speed);
                        currentSpeed = speed;
                        document.getElementsByTagName('video')[0].playbackRate = currentSpeed;
                    }
                } else if (evt.keyCode === 27) {
                    // Back button
                    speedUIContainer.style.display = 'none';
                    speedUIContainer.blur();
                }
                evt.preventDefault();
                evt.stopPropagation();
            }
        },
        true
    );

    document.querySelector('video').addEventListener('canplay', () => {
        document.getElementsByTagName('video')[0].playbackRate = currentSpeed;
    });

    speedUIContainer.innerHTML = `
    <h1>TizenTube Video Speed Settings</h1>
    `;

    const maxSpeed = 4;
    const increment = 0.25;

    for (let speed = increment; speed <= maxSpeed; speed += increment) {
        const speedId = `speed${speed.toString().replace('.', '_')}`;
        speedUIContainer.innerHTML += `
    <label for="${speedId}"><input type="radio" id="${speedId}" name="speed" value="${speed}">${speed}x</label>
    `;
        //Additional speed option to fix videos stuttering
        if (speed == 1) {
            speed = 1.0001;
            const speedId = `speed${speed.toString().replace('.', '_')}`;
            speedUIContainer.innerHTML += `
        <label for="${speedId}"><input type="radio" id="${speedId}" name="speed" value="${speed}">${speed}x</label>
        `;
            speed = 1;
        }
    }

    document.querySelector('body').appendChild(speedUIContainer);

    const eventHandler = (evt) => {
        if (evt.keyCode == 406 || evt.keyCode == 191) {
            console.info('Taking over!');
            evt.preventDefault();
            evt.stopPropagation();
            if (evt.type === 'keydown') {
                if (speedUIContainer.style.display === 'none') {
                    console.info('Showing and focusing!');
                    speedUIContainer.style.display = 'block';
                    speedUIContainer.focus();
                } else {
                    console.info('Hiding!');
                    speedUIContainer.style.display = 'none';
                    speedUIContainer.blur();
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
}
