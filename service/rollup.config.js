import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';
import fs from 'fs';

// Custom Rollup plugin to inject XML content
function injectXmlContent() {
    return {
        name: 'inject-xml-content',
        renderChunk(code) {

            const pattern = /var\s+(\w+)_TEMPLATE\s+=\s+fs\$3\.readFileSync\(__dirname\s+\+\s+'\/\.\.\/xml\/([^']+)'\s*,\s*'utf8'\);/g;

            const modifiedCode = code.replace(pattern, (match, varName, fileName) => {
                const xmlContent = fs.readFileSync(`node_modules/@patrickkfkan/peer-dial/xml/${fileName}`, 'utf8');
                return `var ${varName}_TEMPLATE = ${JSON.stringify(xmlContent)};`;
            });

            return { code: modifiedCode, map: null };
        }
    };
}

export default {
    input: 'service.js',
    output: {
        file: '../dist/service.js',
        format: 'cjs'
    },
    plugins: [
        injectXmlContent(),
        replace({
            'Gate.prototype.await = function await(callback)': 'Gate.prototype.await = function(callback)',
            'Async.prototype.await = function await(callback)': 'Async.prototype.await = function (callback)',
            delimiters: ['', ''],
        }),
        resolve(),
        json(),
        commonjs(),
        babel({
            babelHelpers: 'bundled',
            presets: ['@babel/preset-env']
        })
    ]
};