"use strict";

// TizenTube Standalone service

const express = require('express');
const app = express();
const PORT = 8100;
const fetch = require('node-fetch');
const cobaltSetup = require('./utils/cobaltSetup.js');
const startServer = require('./utils/cobaltProxyServer.js');
const URL = require('url');
const path = require('path');
const injector = require('./utils/injector.js');

// The token the page last used for its own API calls. YouTube's history reports are sent as image and
// beacon requests, which cannot carry an Authorization header, so they get this one (see the handler).
let lastAuthorization = null;

// YouTube's player sends its history reports (/api/stats/playback, /watchtime and /qoe) to
// //www.youtube.com. From a page served by this proxy that is a plain http request straight to YouTube,
// without the account, so nothing is recorded. This sends them through the proxy instead.
const historyReportsScript = String.raw`<script>(function () {
  function route(u) {
    try {
      var s = String(u);
      if (s.indexOf('/api/stats/') === -1) return u;
      var a = document.createElement('a');
      a.href = s;
      if (a.host !== location.host && /(^|\.)youtube\.com$/.test(a.hostname)) {
        return location.origin + a.pathname + a.search;
      }
    } catch (e) {}
    return u;
  }
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    arguments[1] = route(url);
    return open.apply(this, arguments);
  };
  if (window.fetch) {
    var fetchOriginal = window.fetch;
    window.fetch = function (input, init) {
      return fetchOriginal.call(this, typeof input === 'string' ? route(input) : input, init);
    };
  }
  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return beacon(route(url), data); };
  }
  var src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (src && src.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get: src.get,
      set: function (value) { src.set.call(this, route(value)); }
    });
  }
})();</script>`;

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

app.all('*', (req, res) => {
    const isCorsBypass = req.path.indexOf('/cors-bypass/') === 0;

    let targetUrl;
    if (isCorsBypass) {
        const rawTarget = req.url.substring('/cors-bypass/'.length);
        targetUrl = rawTarget.indexOf('http') === 0 ? rawTarget : `https://${rawTarget}`;
    } else {
        targetUrl = `https://www.youtube.com${req.url}`;
    }

    const headers = {};
    for (const key in req.headers) {
        if (Object.prototype.hasOwnProperty.call(req.headers, key)) {
            if (key === 'cookie') {
                headers[key] = req.headers[key]
                    .replace(/__LocalSecure-/g, '__Secure-')
                    .replace(/__LocalHost-/g, '__Host-');
                continue;
            }
            headers[key] = req.headers[key]
        }
    }

    try {
        const parsedUrl = URL.parse(targetUrl);
        headers['host'] = parsedUrl.host;
    } catch (e) {
        headers['host'] = isCorsBypass ? 'www.youtube.com' : 'www.youtube.com';
    }

    headers['origin'] = 'https://www.youtube.com';
    if (headers['referer']) {
        headers['referer'] = 'https://www.youtube.com/tv';
    }

    headers['accept-encoding'] = 'gzip, deflate';

    // History reports cannot carry an Authorization header themselves, so give them the token
    // the page used for its own API calls.
    if (req.path.indexOf('/youtubei/') === 0 && headers['authorization']) {
        lastAuthorization = headers['authorization'];
    }
    if (req.path.indexOf('/api/stats/') === 0 && !headers['authorization'] && lastAuthorization) {
        headers['authorization'] = lastAuthorization;
    }

    const hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;
    const fetchOptions = {
        method: req.method,
        headers: headers,
        body: hasBody ? req : undefined,
        redirect: 'manual'
    };

    fetch(targetUrl, fetchOptions)
        .then((response) => {
            if (req.method === 'OPTIONS') {
                res.status(200);
            } else {
                res.status(response.status);
            }

            const headerKeys = response.headers.raw();
            for (const key in headerKeys) {
                if (Object.prototype.hasOwnProperty.call(headerKeys, key)) {
                    const lowerKey = key.toLowerCase();
                    const skipHeaders = ['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'alt-svc'];
                    if (isCorsBypass) skipHeaders.push('access-control-allow-origin');

                    if (skipHeaders.indexOf(lowerKey) !== -1) continue;

                    const value = response.headers.get(key);
                    if (lowerKey === 'set-cookie') {
                        const rawCookies = headerKeys[key];
                        if (Array.isArray(rawCookies)) {
                            const modifiedCookies = rawCookies.map(cookieStr => {
                                return cookieStr
                                    .replace(/^__Secure-/i, '__LocalSecure-')
                                    .replace(/^__Host-/i, '__LocalHost-')
                                    .replace(/Domain=[^;]+/i, 'Domain=localhost')
                                    .replace(/;\s*Secure/i, '')
                                    .replace(/;\s*SameSite=None/i, '')
                                    .replace(/;\s*;/g, ';')
                                    .replace(/;\s*$/, '');
                            });
                            res.setHeader('Set-Cookie', modifiedCookies);
                            continue;
                        }
                    }

                    res.setHeader(key, value);
                }
            }

            res.setHeader('Access-Control-Allow-Origin', '*');

            const contentType = response.headers.get('content-type') || '';

            if (contentType.indexOf('text/html') !== -1 ||
                contentType.indexOf('application/json') !== -1 ||
                contentType.indexOf('javascript') !== -1 ||
                contentType.indexOf('text/css') !== -1) {

                return response.text().then((text) => {
                    if (req.url.indexOf('/tv') === 0 && req.url.indexOf('/tv_config') === -1) {
                        // Insert the userscript for TizenTube
                        text += `<script src="https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?ver=${Date.now()}"></script>`;
                        text += historyReportsScript;
                    }

                    const proxyPrefix = `http://localhost:${PORT}/cors-bypass/`;

                    // Rewrite rules for replacing URLs so CORS and presumably YT is happy.
                    text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${proxyPrefix}https://$1.googlevideo.com`);
                    text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `http:\\\/\\\/localhost:${PORT}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
                    text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `"${proxyPrefix}https://$1.googlevideo.com`);

                    text = text.replace(/https:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/http:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/"\/\/www\.gstatic\.com/g, `"${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/\(\/\/www\.gstatic\.com/g, `(${proxyPrefix}https://www.gstatic.com`);

                    text = text.replace(/https:\/\/yt3\.ggpht\.com/g, `${proxyPrefix}https://yt3.ggpht.com`);

                    text = text.replace(/https:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                    text = text.replace(/http:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                    text = text.replace(/"\/\/clients1\.google\.com/g, `"${proxyPrefix}https://clients1.google.com`);

                    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');
                    text = text.replace(/:document\.location\.toString\(\)/g, ':document.location.toString().replace("http://localhost:${PORT}", "https://www.youtube.com")');
                    text = text.replace(/euri:[^,]+,/g, 'euri:document.location.toString().replace("http://localhost:${PORT}", "https://www.youtube.com"),')
                    text = text.replace(/https:\/\/s\.youtube\.com/g, `${proxyPrefix}https://s.youtube.com`);
                    text = text.replace(/redirector.googlevideo.com/g, `${proxyPrefix}https://redirector.googlevideo.com`);
                    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');
                    text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${proxyPrefix}https://jnn-pa.googleapis.com`);
                    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${proxyPrefix}https://yt3.googleusercontent.com`);
                    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${proxyPrefix}https://yt3.googleusercontent.com`);

                    // In order to fix history not working
                    text = text.replace(/=window\.location\.href;/, '=window.location.href.replace("http://localhost:${PORT}", "https://www.youtube.com");')
                    text = text.replace(/=document\.location\.href/, '=document.location.href.replace("http://localhost:${PORT}", "https://www.youtube.com")')

                    res.send(text);
                });
            } else {
                if (response.body) {
                    response.body.pipe(res);
                } else {
                    res.end();
                }
            }
        })
        .catch((error) => {
            console.error(`Proxy Error for [${targetUrl}]: ${error}`);
            console.error(error.stack)
            if (!res.headersSent) {
                res.status(500).send('Proxy Connection Broken');
            }
        });
});

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