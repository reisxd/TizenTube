export function onLoad(callback) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        callback();
    } else {
        let hasRun = false;
        const callbackOnce = () => {
            if (hasRun) return;
            hasRun = true;
            return callback();
        };

        // May not fire at all on Switch YouTube.
        window.addEventListener('DOMContentLoaded', callbackOnce);
        window.addEventListener('load', callbackOnce);
    }
}
