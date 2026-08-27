const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PatchManager, sha256 } = require('../main/update/patch-manager');
const { createPatchArtifacts } = require('../../build/evd-patch-tool');

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-patch-test-'));
    const userData = path.join(root, 'user-data');
    const payload = path.join(root, 'payload');
    const output = path.join(root, 'output');
    const privateKeyPath = path.join(root, 'private.pem');
    const publicKeyPath = path.join(root, 'public.pem');
    const fakeApp = {
        getVersion: () => '5.0.0',
        getPath: (name) => name === 'userData' ? userData : root,
        getAppPath: () => path.resolve(__dirname, '..', '..')
    };

    try {
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
        fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
        fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
        fs.mkdirSync(path.join(payload, 'locales'), { recursive: true });
        fs.writeFileSync(path.join(payload, 'renderer.js'), 'globalThis.__evdPatchTest = EVD_PATCH_CONTEXT.revision;\n');
        fs.writeFileSync(path.join(payload, 'locales', 'tr.json'), JSON.stringify({ runtime: { update: { test: 'Yama etkin' } } }));

        const artifacts = createPatchArtifacts({
            input: payload,
            output,
            base: '5.0.0',
            revision: '1',
            'package-url': 'https://example.invalid/evd-5.0.0-patch-1.evdpatch',
            'private-key': privateKeyPath,
            platforms: process.platform,
            architectures: process.arch,
            'notes-tr': 'Test düzeltmesi'
        });
        const manifest = JSON.parse(fs.readFileSync(artifacts.manifestPath, 'utf8'));
        const packageBuffer = fs.readFileSync(artifacts.packagePath);
        assert.strictEqual(sha256(packageBuffer), manifest.packageSha256);

        const firstManager = new PatchManager({ app: fakeApp, publicKeyPath });
        await firstManager.initialize();
        firstManager.verifyManifest(manifest);
        const staged = firstManager.stagePackage(manifest, packageBuffer);
        assert.strictEqual(staged.success, true);
        assert.strictEqual(firstManager.getStatus().pending.revision, 1);

        const bootManager = new PatchManager({ app: fakeApp, publicKeyPath });
        await bootManager.initialize();
        assert.strictEqual(bootManager.getStatus().revision, 1);
        assert.strictEqual(bootManager.getStatus().health.status, 'booting');
        assert.strictEqual(bootManager.getLocaleOverrides().tr.runtime.update.test, 'Yama etkin');

        const rollbackManager = new PatchManager({ app: fakeApp, publicKeyPath });
        await rollbackManager.initialize();
        assert.strictEqual(rollbackManager.getStatus().revision, 0);
        assert.strictEqual(rollbackManager.getStatus().health.status, 'rolled_back');

        rollbackManager.stagePackage(manifest, packageBuffer);
        const healthyManager = new PatchManager({ app: fakeApp, publicKeyPath });
        await healthyManager.initialize();
        healthyManager.markHealthy();
        assert.strictEqual(healthyManager.getStatus().health.status, 'healthy');
        assert.strictEqual(healthyManager.getStatus().revision, 1);

        const tampered = { ...manifest, revision: 2 };
        assert.throws(() => healthyManager.verifyManifest(tampered), /patch_signature_invalid/);
        const tamperedPackage = Buffer.from(packageBuffer);
        tamperedPackage[tamperedPackage.length - 1] ^= 1;
        assert.notStrictEqual(sha256(tamperedPackage), manifest.packageSha256);

        console.log('Patch update architecture tests passed.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
