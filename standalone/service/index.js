"use strict";

// TizenTube Standalone service

const express = require('express');
const app = express();
const PORT = 8099;
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const URL = require('url');

function rawRequest(targetUrl, options) {
    return new Promise((resolve, reject) => {
        const lib = targetUrl.indexOf('https:') === 0 ? https : http;
        const req = lib.request(targetUrl, {
            method: options.method,
            headers: options.headers,
            maxHeaderSize: 1024 * 1024
        }, (res) => resolve(res));
        req.on('error', reject);
        if (options.bodyStream) {
            options.bodyStream.pipe(req);
        } else {
            req.end();
        }
    });
}

function decompressStream(rawRes) {
    const encoding = (rawRes.headers['content-encoding'] || '').toLowerCase();
    if (encoding.indexOf('gzip') !== -1) return rawRes.pipe(zlib.createGunzip());
    if (encoding.indexOf('deflate') !== -1) return rawRes.pipe(zlib.createInflate());
    if (encoding.indexOf('br') !== -1) return rawRes.pipe(zlib.createBrotliDecompress());
    return rawRes;
}

function getHeaderCaseInsensitive(rawRes, name) {
    const lower = name.toLowerCase();
    for (const key in rawRes.headers) {
        if (key.toLowerCase() === lower) return rawRes.headers[key];
    }
    return undefined;
}

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
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

    rawRequest(targetUrl, {
        method: req.method,
        headers: headers,
        bodyStream: hasBody ? req : undefined
    })
        .then((rawRes) => {
            if (req.method === 'OPTIONS') {
                res.status(200);
            } else {
                res.status(rawRes.statusCode);
            }

            const headerKeys = rawRes.headers;
            for (const key in headerKeys) {
                if (Object.prototype.hasOwnProperty.call(headerKeys, key)) {
                    const lowerKey = key.toLowerCase();
                    const skipHeaders = ['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'alt-svc'];
                    if (isCorsBypass) skipHeaders.push('access-control-allow-origin');

                    if (skipHeaders.indexOf(lowerKey) !== -1) continue;

                    const value = headerKeys[key];
                    if (lowerKey === 'set-cookie') {
                        const rawCookies = Array.isArray(value) ? value : [value];
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

                    res.setHeader(key, value);
                }
            }

            res.setHeader('Access-Control-Allow-Origin', '*');

            const contentType = getHeaderCaseInsensitive(rawRes, 'content-type') || '';
            const bodyStream = decompressStream(rawRes);

            if (contentType.indexOf('text/html') !== -1 ||
                contentType.indexOf('application/json') !== -1 ||
                contentType.indexOf('javascript') !== -1 ||
                contentType.indexOf('text/css') !== -1) {

                const chunks = [];
                bodyStream.on('data', (chunk) => chunks.push(chunk));
                bodyStream.on('error', (error) => {
                    console.error(`Proxy body error for [${targetUrl}]: ${error}`);
                    if (!res.headersSent) {
                        res.status(500).send('Proxy Connection Broken');
                    }
                });
                bodyStream.on('end', () => {
                    let text = Buffer.concat(chunks).toString('utf8');

                    if (req.url.indexOf('/tv') === 0) {
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
                    text = text.replace(/:document\.location\.toString\(\)/g, ':document.location.toString().replace("http://localhost:8099", "https://www.youtube.com")');
                    text = text.replace(/euri:[^,]+,/g, 'euri:document.location.toString().replace("http://localhost:8099", "https://www.youtube.com"),')
                    text = text.replace(/https:\/\/s\.youtube\.com/g, `${proxyPrefix}https://s.youtube.com`);
                    text = text.replace(/redirector.googlevideo.com/g, `${proxyPrefix}https://redirector.googlevideo.com`);
                    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');
                    text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${proxyPrefix}https://jnn-pa.googleapis.com`);
                    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${proxyPrefix}https://yt3.googleusercontent.com`);
                    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${proxyPrefix}https://yt3.googleusercontent.com`);

                    res.send(text);
                });
            } else {
                bodyStream.pipe(res);
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

app.listen(PORT, "127.0.0.1");