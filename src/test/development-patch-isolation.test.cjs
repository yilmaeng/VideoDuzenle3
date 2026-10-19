const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PatchManager } = require('../main/update/patch-manager');

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evd-dev-patch-isolation-'));
    try {
        const releaseState = path.join(root, 'updates', 'patches', 'state.json');
        fs.mkdirSync(path.dirname(releaseState), { recursive: true });
        const state = JSON.stringify({ active: { revision: 2 }, pending: { revision: 3 }, health: { status: 'booting' } });
        fs.writeFileSync(releaseState, state);
        const app = { isPackaged: false, getPath: () => root, getVersion: () => '5.0.0' };
        const manager = new PatchManager({ app, enableDevelopmentPatches: false });
        const status = await manager.initialize();
        assert.equal(status.active, null);
        assert.equal(status.pending, null);
        assert.equal(fs.readFileSync(releaseState, 'utf8'), state, 'Source startup must not activate/rollback a release patch');
        assert.equal((await manager.checkForUpdate('invalid-url')).available, false);
        // Even stale manifest assignments cannot activate hooks in a source run.
        manager.activeManifest = { mainEntrypoint: 'missing.js', rendererEntrypoint: 'missing.js', localeFiles: { tr: 'missing.json' } };
        assert.equal(manager.applyMainPatch(), false);
        assert.equal(await manager.injectRendererPatch({}), false);
        assert.deepEqual(manager.getLocaleOverrides(), {});
        manager.markHealthy();
        assert.equal(fs.readFileSync(releaseState, 'utf8'), state);
        const optIn = new PatchManager({ app, enableDevelopmentPatches: true });
        await optIn.initialize();
        assert.equal(optIn.state.active, null);
        assert.notEqual(optIn.statePath, releaseState);
        assert.equal(path.basename(optIn.rootPath), 'development-patches');
        const audio = require('../main/slideshow-audio-policy');
        assert.equal(typeof audio.aacEncodingArgs, 'function');
        assert(audio.aacEncodingArgs([{ channels: 2, sampleRate: 48000 }]).includes('twoloop'));
        console.log('Development/release patch isolation passed; current AAC policy available.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
