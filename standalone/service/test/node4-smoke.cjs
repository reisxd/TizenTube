'use strict';
// Runs the actual service bundle on Node 4.4.3. Hardware APIs are fixtures;
// local HTTP, dependency loading, and Promise/async compatibility are real.
var http = require('http');
var path = require('path');
var listen = http.Server.prototype.listen;
var startup = [];
var expectedPort = Number(process.argv[3] || 8100);
http.Server.prototype.listen = function (port) {
    // Prevent the unrelated DIAL discovery server from broadcasting on the LAN.
    if (port === 8095) return this;
    return listen.apply(this, arguments);
};
global.tizen = {
    systeminfo: { getCapability: function (name) {
        if (name.indexOf('platform.version') !== -1) return '5.0';
        return 'test-device';
    } },
    application: {
        getAppInfo: function () { return { packageId: 'testpkg' }; },
        getAppsContext: function (callback) { callback([]); }
    },
    messageport: { requestRemoteMessagePort: function () {
        return { sendMessage: function (data) { startup.push(JSON.parse(data[0].value)); } };
    } }
};
var fixture = http.createServer(function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ device: { developerIP: '127.0.0.1', developerMode: '1', ip: '127.0.0.1' } }));
});
fixture.listen(8001, '127.0.0.1', function () {
    try {
        var entry = require(path.resolve(process.argv[2]));
        if (entry.onStart) entry.onStart();
        if (startup.some(function (status) { return status.phase === 'error'; })) {
            throw new Error('Service reported boot failure: ' + startup[startup.length - 1].error);
        }
    } catch (error) {
        console.error(error.stack);
        process.exit(1);
    }
    setTimeout(function () {
        http.get('http://127.0.0.1:' + expectedPort + '/tizentube/getState', function (response) {
            var body = '';
            response.on('data', function (chunk) { body += chunk; });
            response.on('end', function () {
                console.log(JSON.stringify({ runtime: process.version, startup: startup, status: response.statusCode, state: JSON.parse(body) }));
                process.exit(response.statusCode === 200 && JSON.parse(body).canConnectToDaemon === true ? 0 : 1);
            });
        }).on('error', function (error) { console.error(error.stack); process.exit(1); });
    }, 150);
});
setTimeout(function () { console.error('Smoke test timed out'); process.exit(1); }, 5000);
