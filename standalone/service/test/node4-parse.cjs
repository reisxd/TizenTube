'use strict';
var fs = require('fs');
var vm = require('vm');
process.argv.slice(2).forEach(function (path) {
    try {
        new vm.Script(fs.readFileSync(path, 'utf8'), { filename: path });
        console.log(path + ': PARSE OK on ' + process.version);
    } catch (error) {
        console.log(path + ': ' + error.stack);
        process.exitCode = 1;
    }
});
