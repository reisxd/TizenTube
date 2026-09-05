// This must be ran every time a new key is added to the
// English translation file. It'll add the missing keys to
// all other translation files.

// Note: must be ran from the /mods folder

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const files = readdirSync('translations/resources');

const enFile = readFileSync('translations/resources/en.json', 'utf-8');
const enData = JSON.parse(enFile);


function addMissingKeys(enObj, translationObj) {
    for (const key in enObj) {
        if (typeof enObj[key] === 'object' && !Array.isArray(enObj[key])) {
            if (!translationObj[key]) {
                translationObj[key] = enObj[key];
            }

            addMissingKeys(enObj[key], translationObj[key]);
        }
        else if (!translationObj[key]) {
            translationObj[key] = enObj[key];
        }
    }
}

function removeUnknownKeys(enObj, translationObj) {
    for (const key in translationObj) {
        if (!(key in enObj)) {
            delete translationObj[key];
        }
        else if (typeof enObj[key] === 'object' && !Array.isArray(enObj[key])
            && typeof translationObj[key] === 'object' && !Array.isArray(translationObj[key])) {
            removeUnknownKeys(enObj[key], translationObj[key]);
        }
    }
}

files.forEach(file => {
    if (file === 'en.json') return;

    const translationFile = readFileSync(`translations/resources/${file}`, 'utf-8');
    const translationData = JSON.parse(translationFile);

    removeUnknownKeys(enData, translationData);
    addMissingKeys(enData, translationData);

    const updatedTranslationFile = JSON.stringify(translationData, null, 4);
    writeFileSync(`translations/resources/${file}`, updatedTranslationFile);
    console.log(`Updated ${file} with missing keys.`);
});
        