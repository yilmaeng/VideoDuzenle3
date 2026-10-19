const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const Module = require('module');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '../..');
const revision = Number(process.env.EVD_PATCH_REVISION || 4);
const output = path.join(root, `dist/patch-5.0.0-r${revision}`);
const archive = process.env.EVD_PATCH_APP_ROOT || path.join(root, 'dist/win-unpacked/resources/app.asar');
// Validate with the updater actually installed in 5.0, not just current sources.
const legacy = new Module(path.join(root, 'temp/base-patch-manager.js'), module);
legacy.filename = path.join(root, 'temp/base-patch-manager.js');
legacy.paths = module.paths;
legacy._compile(asar.extractFile(archive, path.normalize('src/main/update/patch-manager.js')).toString(), legacy.filename);
const { PatchManager, sha256 } = legacy.exports;
(async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-r4-package-'));
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(output, 'stable.json'), 'utf8'));
        const data = fs.readFileSync(path.join(output, `evd-5.0.0-patch-${revision}.evdpatch`));
        const files = new Map(JSON.parse(zlib.gunzipSync(data)).files.map(file => [file.path, Buffer.from(file.data, 'base64')]));
        const coverage = JSON.parse(fs.readFileSync(path.join(output, 'coverage.json'), 'utf8'));
        for (const file of coverage.included) {
            const target = file.startsWith('src/locales/') ? file.replace('src/', '') : `assets/${file}`;
            const sourceRoot = process.env.EVD_PATCH_SOURCE_ROOT || root;
            let expected = fs.readFileSync(path.join(sourceRoot, file));
            if (coverage.transformed.includes(file)) expected = Buffer.from(expected.toString().replace(/window\.api\.(?=(?:speechSearch\w+|onSpeechSearch\w+|refreshAiModels|getTimelinePreviewAudio)\b)/g, '(window.evdPatchApi || window.api).'));
            assert(files.get(target)?.equals(expected), `Stale or missing: ${file}`);
        }
        for (const file of manifest.files) assert.equal(sha256(files.get(file.path)), file.sha256);
        assert.equal(sha256(data), manifest.packageSha256);
        assert.deepEqual(manifest.platforms, ['win32', 'darwin']);
        for (const file of ['broadcast-room.js','desktop-cloud-controls.js','desktop-waiting-controls.js','speech-search.js','ai-model-picker.js']) assert(files.has(`assets/src/renderer/scripts/${file}`));
        const app = { isPackaged: true, getVersion: () => '5.0.0', getPath: () => temp, getAppPath: () => root };
        const publicKey = asar.extractFile(archive, path.normalize('src/main/update/patch-public-key.pem')).toString();
        const manager = new PatchManager({ app, publicKey });
        await manager.initialize();
        manager.verifyManifest(manifest);
        assert(manager.stagePackage(manifest, data).success);
        const reboot = new PatchManager({ app, publicKey });
        await reboot.initialize();
        assert.equal(reboot.getStatus().revision, revision);
        assert.equal(Object.keys(reboot.getLocaleOverrides()).length, 5);
        reboot.markHealthy();
        console.log('Patch 4: old updater signature, all source coverage, SHA-256, installation and activation passed.');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
