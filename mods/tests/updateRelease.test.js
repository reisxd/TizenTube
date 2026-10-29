import assert from 'node:assert/strict';
import test from 'node:test';
import { compareVersions, getCompatibleApkUrl } from '../utils/updateRelease.js';

test('orders versions numerically and prevents downgrades', () => {
    for (const [older, newer] of [
        ['2.0.2', '2.0.3'], ['2.0.9', '2.0.10'], ['2.9.9', '2.10.0'],
        ['2.99.99', '3.0.0'], ['2.0.3-rc.2', '2.0.3-rc.10'],
        ['2.0.3-rc.10', '2.0.3'], ['2.0.3-alpha', '2.0.3-beta'],
        ['2.0.3-alpha', '2.0.3-alpha.1'], ['2.0.3-1', '2.0.3-alpha'],
        ['2.0.9007199254740992', '2.0.9007199254740993']
    ]) {
        assert.equal(compareVersions(older, newer), -1, `${older} < ${newer}`);
        assert.equal(compareVersions(newer, older), 1, `${newer} > ${older}`);
    }
});

test('ignores the tag prefix and build metadata when comparing precedence', () => {
    assert.equal(compareVersions('v2.0.3', '2.0.3'), 0);
    assert.equal(compareVersions('2.0.3+local', '2.0.3+official'), 0);
    assert.equal(compareVersions('2.0.3-rc.1+local', 'v2.0.3-rc.1'), 0);
});

test('rejects unknown or malformed versions rather than guessing an update', () => {
    for (const version of ['unknown', '', undefined, null, '2.0', '2.0.3garbage', '02.0.3', '2.0.3-01', '2.0.3+']) {
        assert.throws(() => compareVersions(version, '2.0.3'), /Invalid update version/);
        assert.throws(() => compareVersions('2.0.3', version), /Invalid update version/);
    }
});

const assets = [
    { name: 'source.zip', browser_download_url: 'https://example.com/source.zip' },
    { name: 'cobalt-arm.apk', browser_download_url: 'https://example.com/arm.apk' },
    { name: 'cobalt-arm64.apk', browser_download_url: 'https://example.com/arm64.apk' }
];

test('selects the exact ARM or ARM64 APK independently of asset order', () => {
    assert.equal(getCompatibleApkUrl(assets, 'arm64-v8a'), 'https://example.com/arm64.apk');
    for (const architecture of ['armeabi-v7a', 'armeabi']) {
        assert.equal(getCompatibleApkUrl(assets, architecture), 'https://example.com/arm.apk');
    }
});

test('never falls back to an arbitrary asset or incompatible architecture', () => {
    for (const architecture of ['x86', 'x86_64', '', undefined, null, 'toString']) {
        assert.equal(getCompatibleApkUrl(assets, architecture), null);
    }
    assert.equal(getCompatibleApkUrl([assets[1]], 'arm64-v8a'), null);
    assert.equal(getCompatibleApkUrl([assets[2]], 'armeabi-v7a'), null);
    assert.equal(getCompatibleApkUrl([{ name: 'other-arm.apk', browser_download_url: 'https://example.com/other.apk' }], 'armeabi-v7a'), null);
});

test('handles absent, malformed and non-HTTPS assets safely', () => {
    for (const items of [undefined, null, {}, [], [null], [{ name: 'cobalt-arm.apk' }],
        [{ name: 'cobalt-arm.apk', browser_download_url: 42 }],
        [{ name: 'cobalt-arm.apk', browser_download_url: 'http://example.com/app.apk' }]]) {
        assert.equal(getCompatibleApkUrl(items, 'armeabi-v7a'), null);
    }
});
