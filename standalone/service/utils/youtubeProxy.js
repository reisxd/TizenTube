"use strict";

// Proxies YouTube TV through this server, rewriting URLs and cookies so the page works from
// publicOrigin, and injects the TizenTube userscript. Used by the on-TV StandaloneService
// (publicOrigin http://localhost:8100) and by proxy-host.js for TVs that can't run the service.

const fetch = require('node-fetch');
const URL = require('url');

/**
 * @param {object} options
 * @param {string} options.publicOrigin Origin the TV loads the proxy from, e.g. "http://localhost:8100".
 * @param {string|null} options.cookieDomain Domain to rewrite Set-Cookie to; null makes cookies host-only.
 * @param {string} [options.headScript] Extra HTML inserted right after <head> on /tv pages.
 */
function createYouTubeProxy(options) {
    const publicOrigin = options.publicOrigin.replace(/\/$/, '');
    const escapedOrigin = publicOrigin.replace(/\//g, '\\/');
    const publicHost = URL.parse(publicOrigin).hostname;
    const cookieDomain = options.cookieDomain;
    const headScript = options.headScript || '';

    return (req, res) => {
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
                                        .replace(/Domain=[^;]+/i, cookieDomain ? `Domain=${cookieDomain}` : '')
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
                            if (headScript) text = text.replace(/<head[^>]*>/i, match => match + headScript);
                        }

                        const proxyPrefix = `${publicOrigin}/cors-bypass/`;

                        // Rewrite rules for replacing URLs so CORS and presumably YT is happy.
                        text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${proxyPrefix}https://$1.googlevideo.com`);
                        text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${escapedOrigin}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
                        text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `"${proxyPrefix}https://$1.googlevideo.com`);

                        text = text.replace(/https:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                        text = text.replace(/http:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                        text = text.replace(/"\/\/www\.gstatic\.com/g, `"${proxyPrefix}https://www.gstatic.com`);
                        text = text.replace(/\(\/\/www\.gstatic\.com/g, `(${proxyPrefix}https://www.gstatic.com`);

                        text = text.replace(/https:\/\/yt3\.ggpht\.com/g, `${proxyPrefix}https://yt3.ggpht.com`);

                        text = text.replace(/https:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                        text = text.replace(/http:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                        text = text.replace(/"\/\/clients1\.google\.com/g, `"${proxyPrefix}https://clients1.google.com`);

                        text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', `Set(["www.youtube.com", "accounts.google.com", "${publicHost}"]);`);
                        text = text.replace(/:document\.location\.toString\(\)/g, `:document.location.toString().replace("${publicOrigin}", "https://www.youtube.com")`);
                        text = text.replace(/euri:[^,]+,/g, `euri:document.location.toString().replace("${publicOrigin}", "https://www.youtube.com"),`)
                        text = text.replace(/https:\/\/s\.youtube\.com/g, `${proxyPrefix}https://s.youtube.com`);
                        text = text.replace(/redirector.googlevideo.com/g, `${proxyPrefix}https://redirector.googlevideo.com`);
                        if (publicOrigin.indexOf('http:') === 0) text = text.replace(/this.scheme="https"/, 'this.scheme="http"');
                        text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${proxyPrefix}https://jnn-pa.googleapis.com`);
                        text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${proxyPrefix}https://yt3.googleusercontent.com`);
                        text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${proxyPrefix}https://yt3.googleusercontent.com`);

                        // In order to fix history not working
                        text = text.replace(/=window\.location\.href;/, `=window.location.href.replace("${publicOrigin}", "https://www.youtube.com");`)
                        text = text.replace(/=document\.location\.href/, `=document.location.href.replace("${publicOrigin}", "https://www.youtube.com")`)

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
    };
}

module.exports = createYouTubeProxy;
