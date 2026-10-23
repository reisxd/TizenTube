const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const createBootstrap = require('./script-bootstrap.js');
const packaged = require('./userscript.json');

for (const [label, storage] of [['missing', undefined], ['invalid', '{broken']]) {
    test('document-start bootstrap handles ' + label + ' YouTube storage and blocks a player payload', async () => {
        const errors = [];
        const virtualConsole = new VirtualConsole();
        virtualConsole.on('jsdomError', error => errors.push(String(error)));
        const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
            url: 'https://www.youtube.com/tv', runScripts: 'outside-only',
            pretendToBeVisual: true, virtualConsole
        });
        const window = dom.window;
        // Model the YouTube services queried by the real userscript at load.
        const services = { PlayerService: {}, PlaybackPreviewService: { start() {}, stop() {} } };
        window._yttv = { services: { mappings: {}, get: name => services[name] } };
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        window.fetch = () => Promise.reject(new Error('Network disabled in this test'));
        if (storage !== undefined) window.localStorage['yt.leanback.default::recurring_actions'] = storage;
        window.document.body.remove();
        try {
            assert.doesNotThrow(() => window.eval(createBootstrap(packaged.source)));
            assert.equal(window.document.body, null);
            window.document.documentElement.appendChild(window.document.createElement('body'));
            await new Promise(resolve => setTimeout(resolve, 50));
            assert.deepEqual(errors, [], 'the built userscript must finish initialization');
            const payload = window.JSON.parse('{"adPlacements":[{}],"adSlots":[{}],"playerAds":[{}]}');
            assert.equal(payload.adPlacements.length, 0);
            assert.equal(payload.adSlots.length, 0);
            assert.equal(payload.playerAds, false);
        } finally { window.close(); }
    });
}
