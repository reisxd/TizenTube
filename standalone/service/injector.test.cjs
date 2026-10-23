const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');

function source(file) {
    return process.env.TIZENTUBE_BASELINE
        ? execFileSync('git', ['show', 'HEAD:standalone/' + file], { cwd: __dirname, encoding: 'utf8' })
        : fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
}

function scheduler() {
    let now = 1000;
    let sequence = 0;
    const timers = new Map();
    const add = (fn, delay, repeat = false) => {
        const id = ++sequence;
        timers.set(id, { fn, at: now + delay, delay, repeat });
        return id;
    };
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    return {
        Date: class extends Date { static now() { return now; } },
        setTimeout: (fn, delay) => add(fn, delay),
        clearTimeout: id => timers.delete(id),
        setInterval: (fn, delay) => add(fn, delay, true),
        clearInterval: id => timers.delete(id),
        async advance(ms) {
            const end = now + ms;
            await flush();
            for (;;) {
                const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                const [id, timer] = next;
                now = timer.at;
                if (timer.repeat) timer.at += timer.delay;
                else timers.delete(id);
                timer.fn();
                await flush();
            }
            now = end;
            await flush();
        }
    };
}

function harness(options = {}) {
    const clock = scheduler();
    const events = [];
    const ports = [];
    let launches = 0;
    const cdp = new EventEmitter();
    const command = name => () => {
        events.push(name);
        if (name === 'csp' && options.legacyProtocol) return Promise.reject({ code: -32601, message: "'Page.setBypassCSP' wasn't found" });
        if (name === 'register-script' && options.scriptRegistrationFails) return Promise.reject(new Error('script registration failed'));
        return Promise.resolve({});
    };
    cdp.Page = {
        enable: command('page-enable'),
        setBypassCSP: command('csp'),
        addScriptToEvaluateOnLoad: command('register-script'),
        navigate: command('navigate')
    };
    cdp.Runtime = { enable: options.commandHangs ? () => new Promise(() => {}) : command('runtime-enable') };
    cdp.close = () => { events.push('close'); return Promise.resolve(); };
    const fetch = url => {
        if (url.includes(':8001/')) return Promise.resolve({ json: () => Promise.resolve({ device: { developerIP: '127.0.0.1', developerMode: '1', ip: '192.0.2.1' } }) });
        if (url.includes('cdn.jsdelivr.net')) {
            events.push('download-script');
            return options.cdnFails ? Promise.reject(new Error('CDN unreachable')) : Promise.resolve({ ok: true, text: () => Promise.resolve('// upstream TizenTube') });
        }
        return Promise.resolve({});
    };
    const dependencies = {
        '../script-bootstrap.js': require('./script-bootstrap.js'),
        '../userscript.json': { source: '// upstream TizenTube' },
        'node-fetch': fetch,
        'chrome-remote-interface': (settings, callback) => {
            ports.push(settings.port);
            if (!options.inspectorHangs) clock.setTimeout(() => callback(cdp), 0);
            return cdp;
        },
        adbhost: { createConnection() {
            const attempt = ++launches;
            const socket = new EventEmitter();
            socket.end = () => {};
            const connection = { _stream: socket, createStream() {
                const stream = new EventEmitter();
                if (options.alwaysEmpty || attempt === 1 && options.emptyFirst) {
                    clock.setTimeout(() => stream.emit('finish'), 1);
                } else {
                    clock.setTimeout(() => stream.emit('data', Buffer.from('... successfully launched pid = 100 with debug 1 port: 43')), 1);
                    clock.setTimeout(() => stream.emit('data', Buffer.from('484\n')), 2);
                    clock.setTimeout(() => stream.emit('finish'), 3);
                }
                return stream;
            } };
            clock.setTimeout(() => socket.emit('connect'), 0);
            return connection;
        } }
    };
    const context = {
        ...clock, console: { error() {} }, Buffer, module: { exports: {} },
        require: name => dependencies[name],
        tizen: {
            systeminfo: { getCapability: () => '5.0' },
            application: { getAppInfo: () => ({ packageId: 'xvvl3S1TT1' }) }
        }
    };
    vm.runInNewContext(source('service/utils/injector.js'), context);
    return { ...clock, api: context.module.exports, events, ports, launches: () => launches };
}

test('empty launch response retries and parses a port split across packets', async () => {
    const h = harness({ emptyFirst: true });
    await h.api.startDebugger('');
    await h.advance(3000);
    assert.equal(h.launches(), 2, 'empty SDB response must trigger a second launch');
    assert.deepEqual(h.ports, [43484]);
    const state = await h.api.canConnectToDaemon();
    assert.equal(state.phase, 'running');
    assert.equal(state.isConnecting, false);
    assert.ok(h.events.indexOf('register-script') < h.events.indexOf('navigate'));
    assert.equal(h.events.includes('download-script'), false, 'the on-TV package contains its own script');
});

test('repeated empty replies end in a recoverable error instead of permanent connecting', async () => {
    const h = harness({ alwaysEmpty: true });
    await h.api.startDebugger('');
    await h.advance(6000);
    let state = await h.api.canConnectToDaemon();
    assert.equal(state.phase, 'error');
    assert.equal(state.isConnecting, false);
    assert.equal(h.launches(), 8);
    await h.api.startDebugger('');
    await h.advance(700);
    state = await h.api.canConnectToDaemon();
    assert.equal(state.isConnecting, true);
    assert.ok(h.launches() > 8, 'retry must start a new launch sequence');
});

test('script registration failure prevents navigation', async () => {
    const h = harness({ scriptRegistrationFails: true });
    await h.api.startDebugger('');
    await h.advance(1500);
    assert.equal((await h.api.canConnectToDaemon()).phase, 'error');
    assert.equal(h.events.includes('navigate'), false);
});

test('Tizen 5 launch works with Chromium 63 protocol without setBypassCSP', async () => {
    const h = harness({ legacyProtocol: true });
    await h.api.startDebugger('');
    await h.advance(1500);
    assert.equal((await h.api.canConnectToDaemon()).phase, 'running');
    assert.equal(h.events.includes('csp'), false);
    assert.ok(h.events.indexOf('register-script') < h.events.indexOf('navigate'));
});

test('an inspector that never connects does not leave a stuck launch', async () => {
    const h = harness({ inspectorHangs: true });
    await h.api.startDebugger('');
    await h.advance(7000);
    const state = await h.api.canConnectToDaemon();
    assert.equal(state.isConnecting, false);
    assert.equal(state.phase, 'error');
});

test('overlapping launch requests share one launch', async () => {
    const h = harness();
    await Promise.all([h.api.startDebugger(''), h.api.startDebugger('')]);
    await h.advance(1500);
    assert.equal(h.launches(), 1);
});

test('a command that never answers closes the debugger without state polling', async () => {
    const h = harness({ commandHangs: true });
    await h.api.startDebugger('');
    await h.advance(61000);
    assert.equal(h.events.includes('close'), true, 'intrinsic startup deadline must close the connection');
    assert.equal((await h.api.canConnectToDaemon()).phase, 'error');
    assert.equal(h.events.includes('navigate'), false);
});

function launcherHarness(options = {}) {
    const html = source('index.html');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    const events = [];
    const listeners = {};
    let startupListener;
    const clock = scheduler();
    const application = {
        appInfo: { packageId: 'xvvl3S1TT1' },
        getRequestedAppControl: () => null,
        exit: () => events.push('exit')
    };
    const status = { textContent: '' };
    let statePolls = 0;
    const context = {
        ...clock, console, window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
        document: { getElementById: () => status, querySelector: () => ({ style: {} }) },
        tizen: {
            messageport: { requestLocalMessagePort: () => ({ addMessagePortListener: fn => { startupListener = fn; } }) },
            tvinputdevice: { registerKey() {} }, ApplicationControl: function () {},
            application: { getCurrentApplication: () => application, launchAppControl: (a, b, success) => success() }
        },
        fetch: url => {
            if (options.serviceHangs) return new Promise(() => {});
            if (url.includes('/getState')) {
                if (options.deferState) return new Promise(resolve => { options.resolveState = resolve; });
                const next = options.states ? options.states[Math.min(statePolls++, options.states.length - 1)] : { canConnectToDaemon: true, isConnecting: false, phase: 'idle' };
                return Promise.resolve({ ok: true, json: () => Promise.resolve(next) });
            }
            events.push('request');
            if (options.deferDebugger) return new Promise(resolve => { options.resolveDebugger = resolve; });
            return Promise.resolve({ ok: true, json: () => { events.push('acknowledge'); return Promise.resolve({ accepted: true }); } });
        }
    };
    vm.runInNewContext(script, context);
    if (listeners.DOMContentLoaded) listeners.DOMContentLoaded();
    return { clock, events, status, report: status => startupListener([{ key: 'status', value: JSON.stringify(status) }]) };
}

test('normal tile launch handles a missing app-control payload and exits after acknowledgement', async () => {
    const h = launcherHarness();
    await h.clock.advance(1);
    assert.deepEqual(h.events, ['request', 'acknowledge', 'exit']);
});

test('an HTTP request that never completes ends with a visible startup error', async () => {
    const h = launcherHarness({ serviceHangs: true });
    await h.clock.advance(61000);
    assert.match(h.status.textContent, /service did not respond/);
    assert.equal(h.events.includes('exit'), false);
});

test('a pending HTTP failure preserves the early service boot error', async () => {
    const h = launcherHarness({ serviceHangs: true });
    h.report({ phase: 'error', runtime: 'v6.14.4', error: 'Cannot find module example' });
    await h.clock.advance(61000);
    assert.match(h.status.textContent, /Service boot failed \(v6.14.4\): Cannot find module example/);
    assert.equal(h.events.includes('exit'), false);
});

test('a late successful state response cannot dismiss a service boot error', async () => {
    const options = { deferState: true };
    const h = launcherHarness(options);
    h.report({ phase: 'error', runtime: 'v6.14.4', error: 'DIAL startup failed' });
    options.resolveState({ ok: true, json: () => Promise.resolve({ canConnectToDaemon: true, phase: 'idle', isConnecting: false }) });
    await h.clock.advance(1);
    assert.deepEqual(h.events, []);
    assert.match(h.status.textContent, /DIAL startup failed/);
});

test('a late debugger acknowledgement cannot exit after a service boot error', async () => {
    const options = { deferDebugger: true };
    const h = launcherHarness(options);
    await h.clock.advance(1);
    h.report({ phase: 'error', runtime: 'v6.14.4', error: 'DIAL startup failed' });
    options.resolveDebugger({ ok: true, json: () => Promise.resolve({ accepted: true }) });
    await h.clock.advance(1);
    assert.deepEqual(h.events, ['request']);
    assert.match(h.status.textContent, /DIAL startup failed/);
});

test('running state waits for navigation instead of exiting the debug-launched app', async () => {
    const h = launcherHarness({ states: [
        { canConnectToDaemon: true, isConnecting: true, phase: 'connecting' },
        { canConnectToDaemon: true, isConnecting: false, phase: 'running' }
    ] });
    await h.clock.advance(2000);
    assert.deepEqual(h.events, []);
    assert.equal(h.status.textContent, '');
});

test('overlapping app-context callbacks only start one debugger', async () => {
    const clock = scheduler();
    const routes = {};
    const callbacks = [];
    let launches = 0;
    const app = { use() {}, get: (path, fn) => { routes[path] = fn; }, all() {}, listen() {} };
    const context = {
        ...clock, console, global: {}, __dirname, module: { exports: {} },
        require: name => {
            if (name === 'express') return () => app;
            if (name === './utils/cobaltSetup.js') return () => false;
            if (name === './utils/cobaltProxyServer.js') return () => {};
            if (name === 'node-fetch') return () => Promise.resolve({});
            if (name === './utils/injector.js') return { startDebugger: () => { launches++; return Promise.resolve(true); } };
            if (name.endsWith('/dist/service.js')) return {};
            return require(name);
        },
        tizen: {
            systeminfo: { getCapability: () => '5.0' },
            application: { getAppInfo: () => ({ packageId: 'xvvl3S1TT1' }), getAppsContext: fn => callbacks.push(fn) }
        }
    };
    vm.runInNewContext(source('service/index.js'), context);
    let acknowledged = false;
    routes['/tizentube/debugger']({ originalUrl: '/tizentube/debugger' }, { json: () => { acknowledged = true; } });
    assert.equal(acknowledged, true);
    await clock.advance(100);
    assert.equal(callbacks.length, 2);
    callbacks[0]([]);
    callbacks[1]([]);
    assert.equal(launches, 1);
});

for (const [version, setupSucceeds, expected] of [['5.0', true, 'dial'], ['6.0', true, 'cobalt'], ['6.0', false, 'dial']]) {
    test('service selection on Tizen ' + version + ', Cobalt setup=' + setupSucceeds, () => {
        const events = [];
        const app = { use() {}, get() {}, all() {}, listen() {} };
        vm.runInNewContext(source('service/index.js'), {
            console, global: {}, module: { exports: {} },
            tizen: { systeminfo: { getCapability: () => version } },
            require(name) {
                if (name === 'express') return () => app;
                if (name === './utils/injector.js') return {};
                if (name === './utils/cobaltSetup.js') { events.push('setup'); return () => setupSucceeds; }
                if (name === './utils/cobaltProxyServer.js') return () => events.push('cobalt');
                if (name === '../../dist/service.js') { events.push('dial'); return {}; }
                return require(name);
            }
        });
        assert.equal(events.at(-1), expected);
        assert.equal(events.includes('setup'), version !== '5.0');
    });
}
