const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/entry.js', 'utf8');

function load(failure) {
    const messages = [];
    let loads = 0;
    const context = {
        module: { exports: {} }, process: { version: 'v6.14.4' }, console: { error() {} },
        require(path) { assert.equal(path, './dist/index.js'); loads++; if (failure) throw failure; },
        tizen: {
            application: { getAppInfo: () => ({ packageId: 'testpkg' }) },
            messageport: { requestRemoteMessagePort(app, port) {
                assert.equal(app, 'testpkg.TizenTubeStandalone');
                assert.equal(port, 'TizenTubeStartup');
                return { sendMessage: data => messages.push(JSON.parse(data[0].value)) };
            } }
        }
    };
    vm.runInNewContext(source, context);
    return { callbacks: context.module.exports, messages, loads: () => loads };
}

test('service waits for lifecycle and initializes exactly once', () => {
    const service = load();
    assert.equal(service.loads(), 0);
    service.callbacks.onStart();
    service.callbacks.onStart();
    service.callbacks.onRequest();
    assert.equal(service.loads(), 1);
    assert.deepEqual(service.messages.map(x => x.phase), ['loading', 'loaded', 'loaded', 'loaded']);
});

test('bundle parse or dependency failure reaches main app with runtime', () => {
    const service = load(new SyntaxError('Unexpected token in bundle'));
    service.callbacks.onStart();
    service.callbacks.onRequest();
    const status = service.messages.at(-1);
    assert.equal(status.phase, 'error');
    assert.equal(status.runtime, 'v6.14.4');
    assert.match(status.error, /Unexpected token in bundle/);
});
