"use strict";

// TizenTube Standalone service

const express = require('express');
const app = express();
const PORT = 8100;
const cobaltSetup = require('./utils/cobaltSetup.js');
const startServer = require('./utils/cobaltProxyServer.js');
const path = require('path');
const injector = require('./utils/injector.js');
const createYouTubeProxy = require('./utils/youtubeProxy.js');

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.get('/tizentube/getState', (req, res) => {
    injector.canConnectToDaemon().then(r => {
        res.json(r);
    });
});

app.get('/tizentube/debugger', (req, res) => {
    const args = req.originalUrl.split('?')[1] || '';
    const interval = setInterval(() => {
        tizen.application.getAppsContext((appsContext) => {
            const packageId = tizen.application.getAppInfo().packageId;
            const app = appsContext.find(app => app.appId === `${packageId}.TizenTubeStandalone`);
            if (!app) {
                injector.startDebugger(args);
                clearInterval(interval)
            }
        });
    }, 50);
});

app.all('*', createYouTubeProxy({ publicOrigin: `http://localhost:${PORT}`, cookieDomain: 'localhost' }));

app.listen(PORT, '127.0.0.1');


if (cobaltSetup()) {
    startServer();
} else {
    // Start the DIAL server
    global.isTizenTube = true;
    require(path.join(__dirname, '../../../dist/service.js'));
}

// To avoid issues on newer versions of Tizen.
module.exports = {
    onStart: () => {},
    onRequest: () => {},
    onStop: () => {}
};