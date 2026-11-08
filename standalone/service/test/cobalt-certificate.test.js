const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const forge = require('node-forge');
const startServer = require('../utils/cobaltProxyServer');

function certificate(name, key, issuer, issuerKey, ca) {
    const cert = forge.pki.createCertificate();
    cert.publicKey = key.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 1000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    cert.setSubject([{ name: 'commonName', value: name }]);
    cert.setIssuer(issuer ? issuer.subject.attributes : cert.subject.attributes);
    cert.setExtensions(ca ? [{ name: 'basicConstraints', cA: true }] : [{ name: 'subjectAltName', altNames: [{ type: 2, value: name }] }]);
    cert.sign(issuerKey || key.privateKey, forge.md.sha256.create());
    return cert;
}

function observedCertificate(host) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ port: 8101, host: '127.0.0.1' });
        socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('Proxy connection timed out')); });
        socket.on('error', reject);
        socket.on('connect', () => socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
        let response = '';
        socket.on('data', function onData(chunk) {
            response += chunk.toString('latin1');
            if (!response.includes('\r\n\r\n')) return;
            socket.removeListener('data', onData);
            if (!response.startsWith('HTTP/1.1 200')) return reject(new Error('Proxy CONNECT failed'));
            const secure = tls.connect({ socket, servername: host, rejectUnauthorized: false }, () => {
                const peer = secure.getPeerCertificate();
                secure.destroy();
                resolve(peer);
            });
            secure.on('error', reject);
        });
    });
}

test('a YouTube subdomain receives a certificate valid for that hostname', async () => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const ca = certificate('test CA', keys, null, null, true);
    const leaf = certificate('m.youtube.com', keys, ca, keys.privateKey, false);
    const target = tls.createServer({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(leaf) });
    await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
    const originalRead = fs.readFileSync;
    const originalConnect = net.connect;
    fs.readFileSync = function (file, ...args) {
        if (file === '/home/owner/share/tizentube-ca.crt') return forge.pki.certificateToPem(ca);
        if (file === '/home/owner/share/tizentube-ca.key') return forge.pki.privateKeyToPem(keys.privateKey);
        return originalRead.call(this, file, ...args);
    };
    net.connect = function (port, host, callback) {
        if (host === 'm.youtube.com') return originalConnect.call(this, target.address().port, '127.0.0.1', callback);
        return originalConnect.apply(this, arguments);
    };
    const proxy = startServer();
    try {
        const peer = await observedCertificate('m.youtube.com');
        assert.ok(!tls.checkServerIdentity('m.youtube.com', peer), 'the certificate must match the requested subdomain');
    } finally {
        proxy.close();
        target.close();
        net.connect = originalConnect;
        fs.readFileSync = originalRead;
    }
});
