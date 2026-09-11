const { writeFileSync, readFileSync, existsSync, statSync, mkdirSync, readdirSync } = require('fs');
const { pki, md, asn1 } = require('node-forge');
const { createHash } = require('crypto');
const { join } = require('path');
const ogPath = '/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content';
const oldTizenPath = '/usr/apps/com.samsung.tv.cobalt/content/data';
const newPath = '/home/owner/share/tizentube-content';

function copyRecursiveSync(src, dest) {
    const exists = existsSync(src);
    const stats = exists && statSync(src);
    const isDirectory = exists && stats.isDirectory();

    if (isDirectory) {
        if (!existsSync(dest)) {
            mkdirSync(dest);
        }
        readdirSync(src).forEach(function (childItemName) {
            copyRecursiveSync(join(src, childItemName), join(dest, childItemName));
        });
    } else {
        writeFileSync(dest, readFileSync(src));
    }
}

function copyCobaltContent() {
    const pathToUse = existsSync(ogPath) ? ogPath : (existsSync(oldTizenPath) ? oldTizenPath : null);
    if (!existsSync(pathToUse)) return false;
    try {
        if (existsSync(newPath)) return true;
        copyRecursiveSync(pathToUse, newPath);
        return true;
    } catch (err) {
        return false;
    }
}

function createX509Certificate() {
    try {
        if (existsSync('/home/owner/share/tizentube-ca.crt') && existsSync('/home/owner/share/tizentube-ca.key')) {
            return pki.certificateFromPem(readFileSync('/home/owner/share/tizentube-ca.crt', 'utf8'));
        }
        const keys = pki.rsa.generateKeyPair(2048);
        const caCert = pki.createCertificate();

        caCert.publicKey = keys.publicKey;
        caCert.serialNumber = '01';
        caCert.validity.notBefore = new Date();
        caCert.validity.notAfter = new Date();
        caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10);

        const attrs = [
            { name: 'commonName', value: 'TizenTube Proxy CA' }
        ];
        caCert.setSubject(attrs);
        caCert.setIssuer(attrs);

        caCert.setExtensions([
            { name: 'basicConstraints', cA: true, critical: true },
            { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
            { name: 'subjectKeyIdentifier' }
        ]);

        caCert.sign(keys.privateKey, md.sha256.create());

        // Convert to PEM format
        const caPemCert = pki.certificateToPem(caCert);
        const caPemPrivateKey = pki.privateKeyToPem(keys.privateKey);

        writeFileSync('/home/owner/share/tizentube-ca.crt', caPemCert);
        writeFileSync('/home/owner/share/tizentube-ca.key', caPemPrivateKey);
        return caCert;
    } catch (err) {
        return false;
    }
}

function copyCertToCertFolder(ca, maxSlots = 5) {
    try {
        const certsDir = newPath + '/ssl/certs';

        const pem = pki.certificateToPem(ca);
        const commonName = ca.subject.attributes.find(attribute => attribute.name === 'commonName').value;
        const encodedName = (value, outerSequence) => {
            const oid = asn1.create(
                asn1.Class.UNIVERSAL,
                asn1.Type.OID,
                false,
                asn1.oidToDer('2.5.4.3').getBytes()
            );
            const text = asn1.create(
                asn1.Class.UNIVERSAL,
                asn1.Type.UTF8,
                false,
                value
            );
            const attribute = asn1.create(
                asn1.Class.UNIVERSAL,
                asn1.Type.SEQUENCE,
                true,
                [oid, text]
            );
            const set = asn1.create(
                asn1.Class.UNIVERSAL,
                asn1.Type.SET,
                true,
                [attribute]
            );
            const name = outerSequence
                ? asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [set])
                : set;
            return new Buffer(asn1.toDer(name).getBytes(), 'binary');
        };
        const der = encodedName(commonName, true);
        const canonicalSubject = encodedName(
            commonName.replace(/\s+/g, ' ').trim().toLowerCase(),
            false
        );
        const hashName = (algorithm, value) => {
            const hex = createHash(algorithm)
                .update(value)
                .digest()
                .readUInt32LE(0)
                .toString(16)
            return ('00000000' + hex).slice(-8);
        };

        const hashes = [
            hashName('sha1', canonicalSubject),
            hashName('md5', der)
        ];

        let allHashesInstalled = true;

        for (const h of hashes) {
            let hashInstalled = false;

            for (let i = 0; i < maxSlots; i++) {
                const file = join(certsDir, `${h}.${i}`);
                try {
                    if (readFileSync(file, 'utf8') === pem) {
                        hashInstalled = true;
                        break;
                    }
                } catch {
                    writeFileSync(file, pem);
                    hashInstalled = true;
                    break;
                }
            }

            if (!hashInstalled) allHashesInstalled = false;
        }

        return allHashesInstalled;
    } catch (err) {
        return false;
    }
}

function checkAndSetupCobaltContent() {
    if (!copyCobaltContent()) {
        return false;
    }

    const caCert = createX509Certificate();
    if (!caCert) {
        return false;
    }

    return copyCertToCertFolder(caCert);
}

module.exports = checkAndSetupCobaltContent;