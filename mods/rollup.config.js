import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import getBabelOutputPlugin from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
    input: "userScript.js",
    output: { file: "../dist/userScript.js", format: "iife" },
    plugins: [
        string({
            include: "**/*.css",
        }),
        nodeResolve({
            browser: true,
            preferBuiltins: false,
        }),
        commonjs({
            include: [/node_modules/, /mods/],
            transformMixedEsModules: true,
        }),
        getBabelOutputPlugin({
            babelHelpers: 'bundled',
            presets: [
                ['@babel/preset-env', {
                    targets: 'Chrome 47',
                }],
            ],
        }),
        terser({
            ecma: '5',
            mangle: true,
        }),
    ]
};