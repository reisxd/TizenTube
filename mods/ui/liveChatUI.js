// Live chat overlay UI — DOM creation and message rendering.
// Data fetching and state live in features/liveChat.js.

export const OVERLAY_ID = 'tt-live-chat-overlay';

const MAX_MESSAGES = 50;
const FADE_AFTER_MS = 20000;

export function createOverlay(visible) {
    let el = document.getElementById(OVERLAY_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = OVERLAY_ID;
    Object.assign(el.style, {
        position:       'fixed',
        right:          '2vw',
        bottom:         '7vh',
        width:          '28vw',
        height:         '50vh',
        overflowY:      'hidden',
        display:        visible ? 'flex' : 'none',
        flexDirection:  'column',
        justifyContent: 'flex-end',
        gap:            '4px',
        zIndex:         '99999',
        pointerEvents:  'none',
        fontFamily:     'sans-serif',
        boxSizing:      'border-box',
    });

    document.body.appendChild(el);
    return el;
}

export function removeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
}

export function setOverlayVisible(visible) {
    const el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    el.style.display = visible ? 'flex' : 'none';
    if (!visible) {
        while (el.firstChild) el.removeChild(el.firstChild);
    }
}

export function appendMessage(authorName, messageText, badgeColor) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    const row = document.createElement('div');
    Object.assign(row.style, {
        background:   'rgba(0,0,0,0.65)',
        borderRadius: '4px',
        padding:      '0.5vh 0.8vw',
        color:        '#fff',
        fontSize:     '2.0vw',
        lineHeight:   '1.4',
        opacity:      '1',
        transition:   'opacity 1s ease',
        wordBreak:    'break-word',
        width:        '100%',
        boxSizing:    'border-box',
        flexShrink:   '0',
    });

    // Build DOM nodes manually — no innerHTML (blocked by Trusted Types CSP)
    const authorColor = badgeColor || 'aaaaaa';

    const authorSpan = document.createElement('span');
    Object.assign(authorSpan.style, {
        fontWeight:  'bold',
        color:       '#' + authorColor,
        marginRight: '4px',
    });

    if (badgeColor) {
        const badge = document.createElement('span');
        Object.assign(badge.style, {
            display:       'inline-block',
            width:         '0.7vw',
            height:        '0.7vw',
            borderRadius:  '50%',
            background:    '#' + badgeColor,
            marginRight:   '5px',
            verticalAlign: 'middle',
        });
        authorSpan.appendChild(badge);
    }

    authorSpan.appendChild(document.createTextNode(authorName + ':'));

    const messageSpan = document.createElement('span');
    messageSpan.textContent = ' ' + messageText;

    row.appendChild(authorSpan);
    row.appendChild(messageSpan);

    overlay.appendChild(row);
    while (overlay.children.length > MAX_MESSAGES) overlay.removeChild(overlay.firstChild);

    setTimeout(() => {
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 1000);
    }, FADE_AFTER_MS);
}
