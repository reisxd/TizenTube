import { configRead } from './config.js';

const style = document.createElement('style');
let css = '';

function updateStyle() {
    css = `
    ytlr-guide-response yt-focus-container {
        background-color: ${configRead('focusContainerColor')};
    }

    ytlr-surface-page {
        background-color: ${configRead('routeColor')};
    }

    ytlr-search-container {
        background-color: ${configRead('routeColor')};
    }

    ytlr-accounts-container {
        background-color: ${configRead('routeColor')};
    }
`;
    const existingStyle = document.querySelector('style[nonce]');
    if (existingStyle) {
        existingStyle.textContent += css;
    } else {
        style.textContent = css;
    }
};

document.head.appendChild(style);
updateStyle();
export default updateStyle;