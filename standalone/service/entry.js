"use strict";

// Keep this entry separate from the bundle so even a bundle parse error is reported.
var started = false;
var status = { phase: 'entry', runtime: process.version, error: '' };

function report() {
    try {
        var packageId = tizen.application.getAppInfo().packageId;
        tizen.messageport.requestRemoteMessagePort(
            packageId + '.TizenTubeStandalone', 'TizenTubeStartup'
        ).sendMessage([{ key: 'status', value: JSON.stringify(status) }]);
    } catch (error) {
        console.error('TizenTube startup report:', error.message);
    }
}

module.exports.onStart = function () {
    if (started) return report();
    started = true;
    status.phase = 'loading';
    report();
    try {
        require('./dist/index.js');
        status.phase = 'loaded';
    } catch (error) {
        status.phase = 'error';
        status.error = String(error.stack || error.message || error).slice(0, 2500);
        console.error('TizenTube service boot:', status.error);
    }
    report();
};

module.exports.onRequest = function () {
    report();
};
