const ncc = require('@vercel/ncc');
const fs = require('fs');
const path = require('path');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');

// The service is split in two files:
// - dist/index.js: the small entry point from entry.js. Tizen loads it when
//   the service starts, so it must load fast.
// - dist/app.js: everything else, bundled by ncc (several MB). The entry point
//   loads it only after the service has started. Parsing it at startup takes
//   longer than Tizen waits on older TVs, and the launch fails with
//   "Launch Service failed: Unknown error" (issue #731).
async function build() {
    const { code } = await ncc(path.join(__dirname, 'transpiled/app.js'), {
        minify: false
    });

    const fixedCode = code.replace(
        /if\s*\(\/.*?\/i?\.exec\(urlStr\)\)\s*\{\s*urlStr\s*=\s*new\s+URL\(urlStr\)\.toString\(\);\s*\}/g,
        ''
    ).replace(
        /(method:\s*request\.method,)/,
        "$1 maxHeaderSize: 5*1024*1024,"
    );

    const outDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    fs.writeFileSync(path.join(outDir, 'app.js'), fixedCode);
    fs.copyFileSync(path.join(__dirname, 'transpiled/entry.js'), path.join(outDir, 'index.js'));

    fs.rmSync(path.join(__dirname, 'transpiled'), { recursive: true, force: true });
}

if (process.argv[2] === 'remove-cobalt-flags') {
    let configXml = fs.readFileSync(path.join(__dirname, '../config.xml'), 'utf8');
    fs.writeFileSync(path.join(__dirname, '../config.xml.bak'), configXml);
    configXml = configXml.replace(/^(\s*)\r?\n/gm, '$1<_blank_line_/>\n');

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: false,
        preserveOrder: true
    });
    const configObj = parser.parse(configXml);

    const widgetNode = configObj.find(node => node.widget);

    if (widgetNode && widgetNode.widget) {
        widgetNode.widget = widgetNode.widget.filter(child => {
            if (child['tizen:metadata']) {
                const attributes = child[':@'];
                if (attributes) {
                    const key = attributes.key;
                    if (
                        key === 'http://samsung.com/tv/metadata/pkgid' ||
                        key === 'http://samsung.com/tv/metadata/nativeID' ||
                        key === 'http://samsung.com/tv/metadata/native.userdata'
                    ) {
                        return false; // Remove these nodes
                    }
                }
            }
            return true;
        });

        const serviceNode = widgetNode.widget.find(child => child['tizen:service']);
        if (serviceNode && serviceNode[':@']) {
            delete serviceNode[':@']['auto-restart'];
            delete serviceNode[':@']['on-boot'];
        }
    }

    const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        format: true,
        indentBy: '    ',
        suppressEmptyNode: false,
        preserveOrder: true
    });

    let updatedConfigXml = builder.build(configObj);
    updatedConfigXml = updatedConfigXml.replace(/^\s*<_blank_line_>([\s\S]*?)<\/_blank_line_>\r?\n/gm, '\n');
    updatedConfigXml = updatedConfigXml.replace(/^\s*<_blank_line_.*\/>\r?\n/gm, '\n');

    fs.writeFileSync(path.join(__dirname, '../config.xml'), updatedConfigXml);

    // Tell the service at runtime that this build can't use the Cobalt proxy,
    // so it skips Cobalt setup and starts the DIAL server straight away.
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, 'no-cobalt'), '');
} else if (process.argv[2] === 'set-cobalt-proxy') {
    const configXml = fs.readFileSync(path.join(__dirname, '../config.xml'), 'utf8');
    fs.writeFileSync(path.join(__dirname, '../config.xml.bak'), configXml);
    fs.writeFileSync(path.join(__dirname, '../config.xml'), configXml.replace('http://127.0.0.2:8101', 'http://tizentube:8101'));
} else build();