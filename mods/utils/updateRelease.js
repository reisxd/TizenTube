function parseVersion(version) {
    const match = typeof version === 'string' && version.match(
        /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
    );
    if (!match) throw new Error(`Invalid update version: ${version}`);

    const prerelease = match[4] ? match[4].split('.') : [];
    if (prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) {
        throw new Error(`Invalid update version: ${version}`);
    }
    return { core: match.slice(1, 4), prerelease };
}

function compareNumericIdentifiers(left, right) {
    if (left.length !== right.length) return left.length > right.length ? 1 : -1;
    return left === right ? 0 : left > right ? 1 : -1;
}

// Compare SemVer precedence without treating build metadata as a new release.
export function compareVersions(leftVersion, rightVersion) {
    const left = parseVersion(leftVersion);
    const right = parseVersion(rightVersion);
    for (let index = 0; index < left.core.length; index++) {
        const difference = compareNumericIdentifiers(left.core[index], right.core[index]);
        if (difference) return difference;
    }

    if (!left.prerelease.length || !right.prerelease.length) {
        return left.prerelease.length ? -1 : right.prerelease.length ? 1 : 0;
    }
    for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
        const leftPart = left.prerelease[index];
        const rightPart = right.prerelease[index];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart === rightPart) continue;
        const leftNumeric = /^\d+$/.test(leftPart);
        const rightNumeric = /^\d+$/.test(rightPart);
        if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftPart, rightPart);
        if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
        return leftPart > rightPart ? 1 : -1;
    }
    return 0;
}

export function getCompatibleApkUrl(assets, architecture) {
    let fileName;
    if (architecture === 'arm64-v8a') fileName = 'cobalt-arm64.apk';
    else if (architecture === 'armeabi-v7a' || architecture === 'armeabi') fileName = 'cobalt-arm.apk';
    else return null;

    if (!Array.isArray(assets)) return null;
    const asset = assets.find(item => item && item.name === fileName);
    return asset && typeof asset.browser_download_url === 'string' && /^https:\/\//.test(asset.browser_download_url)
        ? asset.browser_download_url : null;
}
