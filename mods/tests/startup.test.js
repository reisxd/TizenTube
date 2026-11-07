import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const bundle = new vm.Script(readFileSync(
    process.env.TIZENTUBE_TEST_BUNDLE || new URL('../../dist/userScript.js', import.meta.url),
    'utf8'
));
const actionsKey = 'yt.leanback.default::recurring_actions';

function eventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
        },
        dispatch(type) {
            for (const listener of listeners.get(type) || []) listener();
        },
    };
}

function element() {
    return {
        ...eventTarget(),
        style: {},
        children: [],
        classList: { contains: () => false },
        appendChild(child) { this.children.push(child); },
        setAttribute() {},
    };
}

// Exercise the shipped IIFE with a new JS realm per page. Timers are queued so
// YouTube's DOM and services can arrive after TizenBrew injects the cached mod.
function page(stage, storedActions, config = {}) {
    const document = {
        ...eventTarget(),
        readyState: stage === 'loaded' ? 'complete' : 'loading',
        documentElement: stage === 'empty' ? null : element(),
        head: stage === 'empty' ? null : element(),
        body: ['empty', 'head'].includes(stage) ? null : element(),
        createElement: element,
        querySelector: () => null,
        getElementById: () => null,
    };
    const timers = [];
    const observations = [];
    const registeredProperties = [];
    const storage = { 'ytaf-configuration': JSON.stringify(config) };
    if (storedActions !== undefined) storage[actionsKey] = storedActions;
    const context = vm.createContext({
        ...eventTarget(),
        document,
        navigator: { language: 'en-US', userAgent: 'Tizen' },
        location: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/tv', hash: '' },
        localStorage: storage,
        console: { log() {}, info() {}, warn() {}, error() {} },
        setTimeout(callback) { timers.push(callback); },
        setInterval() {},
        clearTimeout() {},
        clearInterval() {},
        fetch() {},
        MutationObserver: class {
            observe(target) {
                assert.ok(target, 'MutationObserver needs a DOM node');
                observations.push(target);
            }
        },
        Element: class {},
        CSS: { registerProperty(property) { registeredProperties.push(property.name); } },
        getComputedStyle(target) {
            assert.ok(target, 'getComputedStyle needs a DOM element');
            return { getPropertyValue: () => '' };
        },
    });
    vm.runInContext('window = self = globalThis;', context);
    bundle.runInContext(context);
    return { context, document, timers, observations, storage, registeredProperties };
}

function assertCoreFeatures(context) {
    const parsed = vm.runInContext(`JSON.parse('${JSON.stringify({
        adPlacements: [{}], playerAds: [{}], adSlots: [{}], videoDetails: { videoId: 'test' },
    })}')`, context);
    assert.equal(parsed.adPlacements.length, 0);
    assert.equal(parsed.playerAds, false);
    assert.equal(parsed.adSlots.length, 0);
    assert.equal(parsed.videoDetails.videoId, 'test');

    const settings = vm.runInContext('JSON.parse(\'{"title":{"runs":[]},"items":[]}\')', context);
    assert.equal(settings.items.length, 1, 'TizenTube settings are installed');
    assert.ok(context.captionStyleHandler, 'initialization continues past account-picker setup');
    assert.ok(context.queuedVideos, 'later features also initialize');
}

const validActions = JSON.stringify({
    data: { data: {
        'startup-screen-account-selector-with-guest': { lastFired: 0 },
        whos_watching_fullscreen_zero_accounts: { lastFired: 0 },
        'startup-screen-signed-out-welcome-back': { lastFired: 0 },
    } },
});

for (const stage of ['empty', 'head', 'body', 'loaded']) {
    for (const [name, storedActions] of Object.entries({
        missing: undefined,
        malformed: 'not JSON',
        null: 'null',
        incomplete: '{"data":{}}',
        changed: '{"data":{"data":{"new-action":{"lastFired":0}}}}',
        valid: validActions,
    })) {
        test(`startup at ${stage} with ${name} recurring actions keeps ads blocked and settings installed`, () => {
            const { context, storage } = page(stage, storedActions);
            assertCoreFeatures(context);
            if (name === 'valid') {
                const actions = JSON.parse(storage[actionsKey]).data.data;
                assert.ok(actions.whos_watching_fullscreen_zero_accounts.lastFired > Date.now());
            } else {
                assert.equal(storage[actionsKey], storedActions);
            }
        });
    }
}

test('early injection attaches the theme and PiP observer when the DOM arrives', () => {
    const { context, document, observations, registeredProperties } = page('empty');
    assert.equal(observations.length, 0);
    assert.equal(registeredProperties.length, 0);
    assert.ok(context.__spatialNavigation__, 'navigation APIs are available before the DOM');
    document.documentElement = element();
    document.head = element();
    document.body = element();
    document.readyState = 'interactive';
    document.dispatch('DOMContentLoaded');
    assert.ok(observations.includes(document.body));
    assert.ok(document.head.children.some(child => child.textContent.includes('#container')));
    assert.equal(registeredProperties.length, 3, 'navigation CSS registers after the root element exists');
    context.dispatch('load');
    assertCoreFeatures(context);
});

test('PiP waits for YouTube services when injected into an already loaded page', () => {
    const { context, timers } = page('loaded');
    vm.runInContext(`
        previewCalls = 0;
        preview = { start() { previewCalls++; }, stop() { previewCalls++; } };
        services = new Map([['PlayerService', {}], ['PlaybackPreviewService', preview]]);
        services.mappings = true;
        _yttv = { services };
    `, context);
    for (const callback of timers.splice(0)) callback();
    vm.runInContext('preview.start(); preview.stop(); isPipPlaying = true; preview.start(); preview.stop();', context);
    assert.equal(context.previewCalls, 2, 'PiP hooks install after services become available');
    assertCoreFeatures(context);
});

test('enabling the account picker tolerates a missing legacy action', () => {
    const storedActions = '{"data":{"data":{"startup-screen-signed-out-welcome-back":{"lastFired":0}}}}';
    const { context, storage } = page('body', storedActions, { enableWhoIsWatchingMenu: true });
    assertCoreFeatures(context);
    assert.ok(JSON.parse(storage[actionsKey]).data.data['startup-screen-signed-out-welcome-back'].lastFired > 0);
});
