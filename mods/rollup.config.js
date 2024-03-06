import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import getBabelOutputPlugin from '@rollup/plugin-babel';

export default {
    input: "userScript.js",
    output: { file: "../dist/userScript.js", format: "iife" },
    plugins: [
        string({
            include: "**/*.css",
        }),
        terser({
            ecma: '5',
            mangle: true,
        }),
        getBabelOutputPlugin({
            babelHelpers: 'bundled',
            presets: [
                ['@babel/preset-env', {
                    targets: 'Chrome 47',
                }],
            ],
        }),
    ]
};