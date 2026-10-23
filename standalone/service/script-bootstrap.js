// The upstream UI modules require head/body; start them as soon as both exist.
module.exports = function createBootstrap(source) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('The packaged TizenTube script is missing.');
    return '(function () {' +
        'var started = false; var observer;' +
        'function start() {' +
        'if (started || !document.head || !document.body) return;' +
        'started = true; if (observer) observer.disconnect();' +
        source + '\n' +
        '}' +
        'if (document.head && document.body) start();' +
        'else { observer = new MutationObserver(start); observer.observe(document, {childList:true,subtree:true}); }' +
        '})();';
};
