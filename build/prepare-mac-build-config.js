const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const packagePath = path.join(projectRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const asciiProductName = 'Engelsiz Video Duzenleyicisi';
const displayProductName = 'Engelsiz Video Düzenleyicisi';
const signingEnabled = process.env.EVD_MAC_SIGNING_ENABLED === '1';

pkg.build = pkg.build || {};

// macOS code signing validates exact bundle paths. Keep signed file names ASCII
// to avoid Unicode normalization mismatches such as "ü" vs "u" + combining mark.
pkg.build.productName = asciiProductName;
pkg.build.executableName = asciiProductName;
pkg.build.afterPack = 'build/afterPackFixes.js';

pkg.build.mac = {
    ...(pkg.build.mac || {}),
    target: [
        {
            target: 'dmg',
            arch: ['arm64']
        }
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    hardenedRuntime: signingEnabled,
    gatekeeperAssess: false,
    entitlements: 'entitlements.mac.plist',
    entitlementsInherit: 'entitlements.mac.plist',
    extendInfo: {
        ...((pkg.build.mac && pkg.build.mac.extendInfo) || {}),
        CFBundleDisplayName: displayProductName,
        CFBundleName: displayProductName
    }
};

if (signingEnabled) {
    delete pkg.build.mac.type;
    // electron-builder 26 selects the imported Developer ID identity itself.
    delete pkg.build.mac.identity;
} else {
    pkg.build.mac.identity = null;
    pkg.build.mac.type = 'development';
}

const extraResources = Array.isArray(pkg.build.extraResources) ? pkg.build.extraResources : [];
pkg.build.extraResources = extraResources.filter((entry) => {
    const from = String(entry && entry.from || '');
    const to = String(entry && entry.to || '');
    if (!from) {
        return false;
    }
    if (to === 'native-audio' || from.includes('EvdProcessLoopbackCapture')) {
        return false;
    }
    if (to === 'obs-studio' || from.includes('obs-studio')) {
        return false;
    }
    return fs.existsSync(path.join(projectRoot, from));
});

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

console.log('Prepared macOS build configuration:');
console.log(`- bundle/executable name: ${asciiProductName}`);
console.log(`- display name: ${displayProductName}`);
console.log('- target: dmg arm64');
console.log(`- signing: ${signingEnabled ? 'Developer ID / notarization ready' : 'disabled (unsigned test build)'}`);

