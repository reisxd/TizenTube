import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the real updater module without a TV, network calls or startup timers.
async function loadUpdater({ current = '2.0.2', latest = 'v2.0.3', architecture = 'arm64-v8a', hasArchitecture = true, assets = [], networkError = false } = {}) {
    const calls = { modals: [], toasts: [] };
    const bridge = { GetVersion: () => current };
    if (hasArchitecture) bridge.GetArchitecture = () => architecture;
    const context = vm.createContext({
        window: { h5vcc: { tizentube: bridge } },
        console: { info() {}, error() {} },
        setTimeout() {},
        fetch: async () => {
            if (networkError) throw new Error('Network unavailable');
            return { ok: true, json: async () => ({ tag_name: latest, published_at: '2026-10-16T00:00:00Z', body: 'Release notes', assets }) };
        }
    });
    const ui = new vm.SyntheticModule([
        'buttonItem', 'showModal', 'showToast', 'overlayPanelItemListRenderer', 'scrollPaneRenderer', 'overlayMessageRenderer'
    ], function () {
        this.setExport('buttonItem', (...args) => args);
        this.setExport('showModal', (...args) => calls.modals.push(args));
        this.setExport('showToast', (...args) => calls.toasts.push(args));
        this.setExport('overlayPanelItemListRenderer', value => value);
        this.setExport('scrollPaneRenderer', value => value);
        this.setExport('overlayMessageRenderer', value => value);
    }, { context });
    const config = new vm.SyntheticModule(['configRead'], function () {
        this.setExport('configRead', () => false);
    }, { context });
    const i18n = new vm.SyntheticModule(['t'], function () {
        this.setExport('t', key => key);
    }, { context });
    const helpers = new vm.SourceTextModule(await readFile(new URL('../utils/updateRelease.js', import.meta.url), 'utf8'), { context });
    const updater = new vm.SourceTextModule(await readFile(new URL('../features/updater.js', import.meta.url), 'utf8'), { context });
    await updater.link(specifier => {
        const module = {
            '../ui/ytUI.js': ui,
            '../config.js': config,
            'i18next': i18n,
            '../utils/updateRelease.js': helpers
        }[specifier];
        if (!module) throw new Error(`Unexpected import: ${specifier}`);
        return module;
    });
    await updater.evaluate();
    await updater.namespace.default(true);
    return calls;
}

const assets = [
    { name: 'cobalt-arm.apk', browser_download_url: 'https://example.com/arm.apk' },
    { name: 'cobalt-arm64.apk', browser_download_url: 'https://example.com/arm64.apk' }
];

test('offers only a newer compatible update with the correct download action', async () => {
    const calls = await loadUpdater({ assets });
    assert.equal(calls.toasts.length, 0);
    assert.equal(calls.modals.length, 1);
    const action = calls.modals[0][1][0][2][0].customAction;
    assert.equal(action.action, 'UPDATE_DOWNLOAD');
    assert.equal(action.parameters, 'https://example.com/arm64.apk');
});

test('equal and newer installed versions never offer a downgrade, even without assets', async () => {
    for (const current of ['2.0.3', '2.0.4', '2.0.10', '2.0.3+local']) {
        const calls = await loadUpdater({ current });
        assert.equal(calls.modals.length, 0);
        assert.equal(calls.toasts[0][0], 'settings.options.updater.upToDate.title');
    }
});

test('unsupported architecture and missing APK show the compatibility error', async () => {
    for (const options of [{ assets, architecture: 'x86' }, { assets, architecture: null }, { assets, hasArchitecture: false }, { assets: [] }, { assets: [assets[0]] }]) {
        const calls = await loadUpdater(options);
        assert.equal(calls.modals.length, 0);
        assert.equal(calls.toasts[0][1], 'settings.options.updater.noCompatibleApk');
    }
});

test('invalid versions and network failures use the existing failure notification', async () => {
    for (const options of [{ current: 'unknown' }, { latest: 'invalid' }, { latest: '2.v0.3' }, { networkError: true }]) {
        const calls = await loadUpdater(options);
        assert.equal(calls.modals.length, 0);
        assert.equal(calls.toasts[0][1], 'settings.options.updater.checkFailed.subtitle');
    }
});
