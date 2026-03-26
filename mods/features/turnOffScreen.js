export function turnOffScreen() {
    // Turn off screen
    const container = document.getElementById('container');
    const captionBlock = document.getElementById('ytp-caption-window-container');

    container.style.setProperty('opacity', '0', 'important');
    container.style.setProperty('pointer-events', 'none', 'important');

    if (captionBlock) {
        captionBlock.style.setProperty('opacity', '0', 'important');
        captionBlock.style.setProperty('pointer-events', 'none', 'important');
    }

    console.log('Screen is turned off.');

    const wakeUpScreen = (event) => {
        // Prevent events
        // Prevent default key behavior (e.g., scrolling pages with Space/Arrows, submitting forms with Enter).
        event.preventDefault();
        // Prevent the event from continuing down to the elements below (other modules will not receive this key).
        event.stopPropagation();

        // Turn on screen
        const container = document.getElementById('container');
        const captionBlock = document.getElementById('ytp-caption-window-container');

        container.style.removeProperty('opacity');
        container.style.removeProperty('pointer-events');

        if (captionBlock) {
            captionBlock.style.removeProperty('opacity');
            captionBlock.style.removeProperty('pointer-events');
        }

        console.log('Screen is turned on.');

        // Important: Remove event listening after the screen has been reopened
        // to prevent this function from being called redundantly on subsequent keystrokes
        document.removeEventListener('keydown', wakeUpScreen, true);
    };

    // 3. Listen for any key press event (keydown).
    document.addEventListener('keydown', wakeUpScreen, true);
}