const ncc = require('@vercel/ncc');
const fs = require('fs');
const path = require('path');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');

async function build() {
    if (!fs.existsSync(path.join(__dirname, '../../dist/service.js'))) {
        throw new Error('Build the DIAL service first: cd service && npm install && npx rollup -c rollup.config.js');
    }
    const scriptFile = path.join(__dirname, '../../dist/userScript.js');
    if (!fs.existsSync(scriptFile)) {
        throw new Error('Build the userscript first: cd mods && npm install && npm run build');
    }
    const source = fs.readFileSync(scriptFile, 'utf8');
    if (!source.trim()) throw new Error('The built userscript is empty.');
    // Package the userscript built from this checkout, including first-run fixes.
    // No CDN request should race the first YouTube player response.
    fs.writeFileSync(path.join(__dirname, 'userscript.json'), JSON.stringify({ source }));
    const { code } = await ncc(path.join(__dirname, 'index.js'), {
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

    // Transform the complete bundle, including dependency code and ncc's wrapper.
    // A source-only transform can leave newer syntax in the shipped service.
    const babel = await import('@babel/core');
    const preset = await import('@babel/preset-env');
    const result = await babel.transformAsync(fixedCode, {
        configFile: false,
        babelrc: false,
        sourceType: 'script',
        presets: [[preset.default, { targets: { node: '4.4.3' } }]],
        comments: false,
        compact: false
    });
    fs.writeFileSync(path.join(outDir, 'index.js'), result.code);
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
} else if (process.argv[2] === 'set-cobalt-proxy') {
    const configXml = fs.readFileSync(path.join(__dirname, '../config.xml'), 'utf8');
    fs.writeFileSync(path.join(__dirname, '../config.xml.bak'), configXml);
    fs.writeFileSync(path.join(__dirname, '../config.xml'), configXml.replace('http://127.0.0.2:8101', 'http://tizentube:8101'));
} else build().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
