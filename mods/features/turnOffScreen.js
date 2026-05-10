export function turnOffScreen() {
    const container = document.getElementById('container');
    const captionBlock = document.getElementById('ytp-caption-window-container');

    container.style.setProperty('opacity', '0', 'important');
    container.style.setProperty('pointer-events', 'none', 'important');

    if (captionBlock) {
        captionBlock.style.setProperty('opacity', '0', 'important');
        captionBlock.style.setProperty('pointer-events', 'none', 'important');
    }

    const wakeUpScreen = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const container = document.getElementById('container');
        const captionBlock = document.getElementById('ytp-caption-window-container');

        container.style.removeProperty('opacity');
        container.style.removeProperty('pointer-events');

        if (captionBlock) {
            captionBlock.style.removeProperty('opacity');
            captionBlock.style.removeProperty('pointer-events');
        }

        document.removeEventListener('keydown', wakeUpScreen, true);
    };

    document.addEventListener('keydown', wakeUpScreen, true);
}
