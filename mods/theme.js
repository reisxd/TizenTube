import { configRead, configWrite } from './config.js';

const style = document.createElement('style');

function updateStyle() {
    style.textContent = `
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
};

document.head.appendChild(style);
updateStyle();
export default updateStyle;