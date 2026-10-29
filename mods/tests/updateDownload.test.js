import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function run(bridge) {
    const toasts = [];
    const context = vm.createContext({ window: { h5vcc: { tizentube: bridge } } });
    const ui = new vm.SyntheticModule(['showToast'], function () {
        this.setExport('showToast', (...args) => toasts.push(args));
    }, { context });
    const i18n = new vm.SyntheticModule(['t'], function () {
        this.setExport('t', key => key);
    }, { context });
    const module = new vm.SourceTextModule(await readFile(new URL('../features/updateDownload.js', import.meta.url), 'utf8'), { context });
    await module.link(name => name === 'i18next' ? i18n : ui);
    await module.evaluate();
    const accepted = await module.namespace.startUpdate('https://example.com/app.apk');
    return { accepted, toasts };
}

test('reports acceptance only after the native request resolves', async () => {
    const result = await run({ InstallAppFromURL: async url => {
        assert.equal(url, 'https://example.com/app.apk');
        return true;
    } });
    assert.equal(result.accepted, true);
    assert.equal(result.toasts[0][0], 'settings.options.updater.downloading.title');
});

test('handles rejection, thrown errors, and missing native API', async () => {
    for (const bridge of [
        { InstallAppFromURL: () => false },
        { InstallAppFromURL: () => { throw new Error('unavailable'); } },
        { InstallAppFromURL: async () => { throw new Error('disconnected'); } },
        {}
    ]) {
        const result = await run(bridge);
        assert.equal(result.accepted, false);
        assert.equal(result.toasts.length, 1);
        assert.equal(result.toasts[0][0], 'settings.options.updater.startFailed.title');
    }
});
