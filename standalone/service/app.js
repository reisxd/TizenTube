"use strict";

// TizenTube Standalone service

const express = require('express');
const app = express();
const PORT = 8100;
const fetch = require('node-fetch');
const URL = require('url');
const path = require('path');
const fs = require('fs');
const injector = require('./utils/injector.js');
const { EARLY_HOOK } = require('./utils/earlyAdblock.js');

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
    // The injector waits for this app to exit, then relaunches it in debug mode.
    // A request while a launch is in progress is ignored.
    injector.requestDebugLaunch(args);
    res.end();
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
                        // The ad blocker must hook JSON.parse before YouTube's own
                        // scripts run, so put the early hook first in <head>.
                        const earlyHook = `<script>${EARLY_HOOK}</script>`;
                        const headAt = text.search(/<head[^>]*>/i);
                        if (headAt !== -1) {
                            const headEnd = text.indexOf('>', headAt) + 1;
                            text = text.slice(0, headEnd) + earlyHook + text.slice(headEnd);
                        } else {
                            text = earlyHook + text;
                        }
                        // Insert the userscript for TizenTube
                        text += `<script src="https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?ver=${Date.now()}"></script>`;
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

function startDialServer() {
    global.isTizenTube = true;
    require(path.join(__dirname, '../../../dist/service.js'));
}

// The Old Tizen build has the Cobalt flags stripped from config.xml, so the
// Cobalt proxy can never be used there. build-service.js drops this marker
// next to the bundled service when it strips the flags.
const isCobaltBuild = !fs.existsSync(path.join(__dirname, 'no-cobalt'));

// Defer the rest of the startup work until after this module has finished
// loading. Cobalt setup can copy the Cobalt content folder and generate an
// RSA key in pure JavaScript, which takes a long time on older TVs. Doing it
// synchronously here blocks the service from reporting that it started, and
// the launch from the UI app fails with "Launch Service failed: Unknown error".
setTimeout(() => {
    if (!isCobaltBuild) {
        startDialServer();
        return;
    }

    // Loaded only here: node-forge needs Node.js 6.13 or newer and is used
    // only for the Cobalt proxy, so the Old Tizen build must never load it.
    const cobaltSetup = require('./utils/cobaltSetup.js');
    cobaltSetup().then(isReady => {
        if (isReady) require('./utils/cobaltProxyServer.js')();
        else startDialServer();
    }).catch(() => startDialServer());
}, 0);
