const ncc = require('@vercel/ncc');
const fs = require('fs');
const path = require('path');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');

async function build() {
    const { code, assets } = await ncc(path.join(__dirname, 'transpiled/index.js'), {
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

    fs.writeFileSync(path.join(outDir, 'index.js'), fixedCode);

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
} else build();