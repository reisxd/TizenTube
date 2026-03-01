import { configRead } from "../config.js";

let voiceDimmer = null;
let voiceButtonInjected = false;
let isVoiceActive = false;

const originalClasses = {
    ytlrSearchVoice: {
        length: 0,
        classes: []
    },
    ytlrSearchVoiceMicButton: {
        length: 0,
        classes: []
    }
};

function initVoiceInteraction() {
    if (window.webapis && window.webapis.voiceinteraction) {
        try {
            window.webapis.voiceinteraction.setCallback({
                onupdatestate: function () {
                    //showToast("VoiceSearch", "[VoiceSearch] VIF requesting app state");
                    return "List";
                },
                onsearch: function (vt) {
                    // showToast("VoiceSearch", "[VoiceSearch] VIF onsearch triggered:", vt);
                    const utterance = window.webapis.voiceinteraction.getDataFromSearchTerm(vt, "SEARCH_TERM_UTTERANCE");
                    if (utterance) {
                        // showToast("VoiceSearch", "[VoiceSearch] Recognized utterance:", utterance);
                        performSearch(utterance);
                    }
                    return true;
                }
            });
            window.webapis.voiceinteraction.listen();
            //  showToast("VoiceSearch", "[VoiceSearch] VIF listen() called");
        } catch (e) {
            console.error("[VoiceSearch] VIF initialization failed:", e);
        }
    } else {
        console.warn("[VoiceSearch] webapis.voiceinteraction not available");
    }
}

function performSearch(text) {
    const searchTextBox = document.querySelector('ytlr-search-text-box');
    if (searchTextBox) {
        const input = searchTextBox.querySelector('input') || searchTextBox;
        input.value = text;

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        deactivateVoice();

        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        searchTextBox.dispatchEvent(enterEvent);
    }
}

function createDimmer() {
    if (voiceDimmer) return;

    voiceDimmer = document.createElement('div');
    voiceDimmer.id = 'tt-voice-dimmer';
    voiceDimmer.className = 'tt-voice-dimmer';
    voiceDimmer.style.display = 'none';

    document.body.appendChild(voiceDimmer);

    window.addEventListener('keydown', (e) => {
        if (isVoiceActive && (e.keyCode === 27 || e.keyCode === 10009)) {
            deactivateVoice();
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
}

function activateVoice() {
    if (!voiceDimmer) createDimmer();

    const btn = document.querySelector('#tt-voice-search-button');
    if (btn) btn.classList.add('tt-active');

    voiceDimmer.style.display = 'block';
    isVoiceActive = true;
}

function deactivateVoice() {
    const btn = document.querySelector('#tt-voice-search-button');
    if (btn) btn.classList.remove('tt-active');

    if (voiceDimmer) voiceDimmer.style.display = 'none';
    isVoiceActive = false;
}

function toggleVoice() {
    if (isVoiceActive) deactivateVoice();
    else activateVoice();
}

const observerVoiceInject = new MutationObserver(() => {
    if (!configRead('enableVoiceSearch')) return;
    const searchBar = document.querySelector('ytlr-search-bar');
    if (!searchBar) {
        voiceButtonInjected = false;
        return;
    }

    if (voiceButtonInjected && document.querySelector('#tt-voice-search-button')) return;

    // Mirrors pictureInPicture.js exactly
    const voiceButton = document.createElement('ytlr-search-voice');
    voiceButton.style.left = '10.25em'; // 10.25em is PiP, let's try 6.5em to be left of it
    voiceButton.id = 'tt-voice-search-button';
    voiceButton.setAttribute('idomkey', 'ytLrSearchBarVoiceSearch'); // Unique key to avoid conflict with PiP
    voiceButton.setAttribute('tabindex', '0');
    voiceButton.classList.add('ytLrSearchVoiceHost', 'ytLrSearchBarSearchVoice');

    const voiceMicButton = document.createElement('ytlr-search-voice-mic-button');
    voiceMicButton.setAttribute('hybridnavfocusable', 'true');
    voiceMicButton.setAttribute('tabindex', '-1');
    voiceMicButton.classList.add('ytLrSearchVoiceMicButtonHost', 'zylon-ve');

    const micIcon = document.createElement('yt-icon');
    micIcon.setAttribute('tabindex', '-1');
    micIcon.classList.add('ytContribIconHost', 'ytLrSearchVoiceMicButtonIcon');
    micIcon.style.width = '0.7em';
    micIcon.style.height = '0.7em';
    micIcon.style.display = 'inline-block';
    micIcon.innerHTML = `
        <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" style="pointer-events: none; display: block; width: 100%; height: 100%;">
            <g><path d="M12,14c1.66,0,3-1.34,3-3V5c0-1.66-1.34-3-3-3S9,3.34,9,5v6C9,12.66,10.34,14,12,14z M11,5c0-0.55,0.45-1,1-1s1,0.45,1,1v6 c0,0.55-0.45,1-1,1s-1-0.45-1-1V5z M17,11c0,2.76-2.24,5-5,5s-5-2.24-5-5H6c0,3.05,2.19,5.58,5,5.91V21h2v-4.09\tc2.81-0.34,5-2.87,5-5.91H17z" fill="currentColor"></path></g>
        </svg>
    `;

    voiceMicButton.appendChild(micIcon);
    voiceButton.appendChild(voiceMicButton);

    voiceButton.addEventListener('click', toggleVoice);
    voiceButton.addEventListener('keydown', (e) => {
        if (e.keyCode === 13 || e.keyCode === 32) {
            toggleVoice();
            e.preventDefault();
            e.stopPropagation();
        }
    });

    searchBar.appendChild(voiceButton);
    voiceButtonInjected = true;
    showToast("VoiceSearch", "[VoiceSearch] Injected microphone button mirroring PiP structure");
});

function start() {
    if (!configRead('enableVoiceSearch')) return;

    initVoiceInteraction();
    observerVoiceInject.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
} else {
    window.addEventListener('load', start);
}
