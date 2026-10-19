const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { PatchManager, sha256 } = require('../main/update/patch-manager');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'dist/patch-5.0.0-r3');
(async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-r3-package-'));
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(output, 'stable.json'), 'utf8'));
        const data = fs.readFileSync(path.join(output, 'evd-5.0.0-patch-3.evdpatch'));
        const files = new Map(JSON.parse(zlib.gunzipSync(data)).files.map(file => [file.path, Buffer.from(file.data, 'base64')]));
        const coverage = JSON.parse(fs.readFileSync(path.join(output, 'coverage.json'), 'utf8'));
        for (const file of coverage.included) {
            const target = file.startsWith('src/locales/') ? file.replace('src/', '') : `assets/${file}`;
            assert(files.get(target)?.equals(fs.readFileSync(path.join(root, file))), `Stale or missing: ${file}`);
        }
        for (const file of manifest.files) assert.equal(sha256(files.get(file.path)), file.sha256);
        for (const file of ['assets/src/renderer/scripts/broadcast-room.js', 'assets/src/renderer/dialogs/broadcast-room.html',
            'assets/src/main/export/selection-audio-copy.js', 'assets/src/main/slideshow-audio-policy.js']) assert(files.has(file));
        const app = { isPackaged: true, getVersion: () => '5.0.0', getPath: () => temp, getAppPath: () => root };
        const manager = new PatchManager({ app });
        await manager.initialize();
        manager.verifyManifest(manifest);
        assert(manager.stagePackage(manifest, data).success);
        const reboot = new PatchManager({ app });
        await reboot.initialize();
        assert.equal(reboot.getStatus().revision, 3);
        assert.equal(Object.keys(reboot.getLocaleOverrides()).length, 5);
        reboot.markHealthy();
        console.log('Signed cumulative patch 3: source coverage, hashes, installation and activation passed.');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
