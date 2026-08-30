const ncc = require('@vercel/ncc');
const fs = require('fs');
const path = require('path');

async function build() {
    const { code, assets } = await ncc(path.join(__dirname, 'index.js'), {
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
}

build();