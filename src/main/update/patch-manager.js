const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createRequire } = require('module');

const PATCH_SCHEMA_VERSION = 1;
const DEFAULT_MANIFEST_URL = 'https://evd.drenginyilmaz.net/patches/stable.json';
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const ALLOWED_PATH = /^(main\.js|renderer\.js|assets\/|locales\/|docs\/)/i;

function canonicalize(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function manifestPayload(manifest) {
    const payload = { ...manifest };
    delete payload.signature;
    return Buffer.from(canonicalize(payload), 'utf8');
}

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function normalizePatchPath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || normalized.includes('../') || /^[a-z]:/i.test(normalized)) {
        throw new Error('patch_path_invalid');
    }
    if (!ALLOWED_PATH.test(normalized)) throw new Error('patch_path_not_allowed');
    return normalized;
}

function readJson(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_error) {
        return fallback;
    }
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
}

async function fetchBuffer(url, { maxBytes = MAX_PACKAGE_BYTES, onProgress = null } = {}) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') throw new Error('patch_https_required');
    const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`patch_http_${response.status}`);
    const expectedLength = Number(response.headers.get('content-length') || 0);
    if (expectedLength > maxBytes) throw new Error('patch_package_too_large');
    const reader = response.body?.getReader();
    if (!reader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes) throw new Error('patch_package_too_large');
        return buffer;
    }
    const chunks = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) throw new Error('patch_package_too_large');
        chunks.push(Buffer.from(value));
        onProgress?.(expectedLength > 0 ? Math.min(100, received / expectedLength * 100) : 0);
    }
    return Buffer.concat(chunks);
}

class PatchManager {
    constructor({ app, publicKeyPath = path.join(__dirname, 'patch-public-key.pem'), publicKey = '' } = {}) {
        this.app = app;
        this.publicKeyPath = publicKeyPath;
        this.publicKey = publicKey;
        this.rootPath = '';
        this.statePath = '';
        this.state = { active: null, pending: null, previous: null, health: null };
        this.activeManifest = null;
        this.activeDirectory = '';
        this.progressCallback = null;
        this.rendererInjectionFailed = false;
        this.rendererInjectionPending = 0;
        this.ipcRegistered = false;
    }

    async initialize() {
        this.rootPath = path.join(this.app.getPath('userData'), 'updates', 'patches');
        this.statePath = path.join(this.rootPath, 'state.json');
        fs.mkdirSync(this.rootPath, { recursive: true });
        this.state = readJson(this.statePath, this.state) || this.state;

        if (this.state.health?.status === 'booting' && this.state.active) {
            this.state.active = this.state.previous || null;
            this.state.previous = null;
            this.state.health = { status: 'rolled_back', at: new Date().toISOString() };
            writeJsonAtomic(this.statePath, this.state);
        }

        if (this.state.pending) {
            this.state.previous = this.state.active || null;
            this.state.active = this.state.pending;
            this.state.pending = null;
            this.state.health = {
                status: 'booting',
                revision: this.state.active.revision,
                at: new Date().toISOString()
            };
            writeJsonAtomic(this.statePath, this.state);
        }

        await this.loadActivePatch();
        return this.getStatus();
    }

    getPublicKey() {
        if (this.publicKey) return this.publicKey;
        return fs.readFileSync(this.publicKeyPath, 'utf8');
    }

    verifyManifest(manifest) {
        if (!manifest || Number(manifest.schemaVersion) !== PATCH_SCHEMA_VERSION) throw new Error('patch_schema_unsupported');
        if (!manifest.signature) throw new Error('patch_signature_missing');
        const valid = crypto.verify(
            null,
            manifestPayload(manifest),
            this.getPublicKey(),
            Buffer.from(String(manifest.signature), 'base64')
        );
        if (!valid) throw new Error('patch_signature_invalid');
        if (String(manifest.baseVersion) !== String(this.app.getVersion())) throw new Error('patch_base_version_mismatch');
        if (!Number.isInteger(Number(manifest.revision)) || Number(manifest.revision) < 1) throw new Error('patch_revision_invalid');
        if (Array.isArray(manifest.platforms) && !manifest.platforms.includes(process.platform)) throw new Error('patch_platform_unsupported');
        if (Array.isArray(manifest.architectures) && !manifest.architectures.includes(process.arch)) throw new Error('patch_architecture_unsupported');
        if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('patch_files_missing');
        const uniquePaths = new Set();
        for (const item of manifest.files) {
            const normalizedPath = normalizePatchPath(item.path);
            if (uniquePaths.has(normalizedPath)) throw new Error('patch_file_duplicate');
            uniquePaths.add(normalizedPath);
            if (!/^[a-f0-9]{64}$/i.test(String(item.sha256 || ''))) throw new Error('patch_file_hash_invalid');
        }
        if (manifest.mainEntrypoint) normalizePatchPath(manifest.mainEntrypoint);
        if (manifest.rendererEntrypoint) normalizePatchPath(manifest.rendererEntrypoint);
        for (const localePath of Object.values(manifest.localeFiles || {})) normalizePatchPath(localePath);
        return true;
    }

    async checkForUpdate(manifestUrl = DEFAULT_MANIFEST_URL) {
        const buffer = await fetchBuffer(manifestUrl, { maxBytes: 2 * 1024 * 1024 });
        const manifest = JSON.parse(buffer.toString('utf8'));
        this.verifyManifest(manifest);
        const activeRevision = this.state.active?.baseVersion === manifest.baseVersion
            ? Number(this.state.active.revision || 0)
            : 0;
        const pendingRevision = this.state.pending?.baseVersion === manifest.baseVersion
            ? Number(this.state.pending.revision || 0)
            : 0;
        return {
            available: Number(manifest.revision) > Math.max(activeRevision, pendingRevision),
            manifest,
            activeRevision,
            pendingRevision
        };
    }

    async install(manifest) {
        this.verifyManifest(manifest);
        if (!manifest.packageUrl || !/^[a-f0-9]{64}$/i.test(String(manifest.packageSha256 || ''))) {
            throw new Error('patch_package_metadata_invalid');
        }
        this.progressCallback?.({ stage: 'download', percent: 0 });
        const packageBuffer = await fetchBuffer(manifest.packageUrl, {
            maxBytes: Math.min(MAX_PACKAGE_BYTES, Math.max(Number(manifest.packageSize || 0) + 1024 * 1024, 2 * 1024 * 1024)),
            onProgress: (percent) => this.progressCallback?.({ stage: 'download', percent })
        });
        if (sha256(packageBuffer) !== String(manifest.packageSha256).toLowerCase()) throw new Error('patch_package_hash_mismatch');
        return this.stagePackage(manifest, packageBuffer);
    }

    stagePackage(manifest, packageBuffer) {
        this.verifyManifest(manifest);
        this.progressCallback?.({ stage: 'verify', percent: 0 });
        let archive;
        try {
            archive = JSON.parse(zlib.gunzipSync(packageBuffer).toString('utf8'));
        } catch (_error) {
            throw new Error('patch_package_invalid');
        }
        if (Number(archive.schemaVersion) !== PATCH_SCHEMA_VERSION || !Array.isArray(archive.files)) {
            throw new Error('patch_package_invalid');
        }
        const manifestFiles = new Map(manifest.files.map((item) => [normalizePatchPath(item.path), item]));
        if (archive.files.length !== manifestFiles.size) throw new Error('patch_file_count_mismatch');

        const finalDirectory = path.join(this.rootPath, String(manifest.baseVersion), String(manifest.revision));
        const stagingDirectory = `${finalDirectory}.staging-${process.pid}-${Date.now()}`;
        fs.mkdirSync(stagingDirectory, { recursive: true });
        try {
            archive.files.forEach((item, index) => {
                const relativePath = normalizePatchPath(item.path);
                const expected = manifestFiles.get(relativePath);
                if (!expected) throw new Error('patch_file_unlisted');
                const data = Buffer.from(String(item.data || ''), 'base64');
                if (data.length !== Number(expected.size) || sha256(data) !== String(expected.sha256).toLowerCase()) {
                    throw new Error('patch_file_verification_failed');
                }
                const destination = path.join(stagingDirectory, ...relativePath.split('/'));
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.writeFileSync(destination, data);
                this.progressCallback?.({ stage: 'verify', percent: (index + 1) / archive.files.length * 100 });
            });
            fs.writeFileSync(path.join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
            fs.mkdirSync(path.dirname(finalDirectory), { recursive: true });
            if (fs.existsSync(finalDirectory)) fs.rmSync(finalDirectory, { recursive: true, force: true });
            fs.renameSync(stagingDirectory, finalDirectory);
        } catch (error) {
            fs.rmSync(stagingDirectory, { recursive: true, force: true });
            throw error;
        }

        this.state.pending = {
            patchId: String(manifest.patchId || `${manifest.baseVersion}-${manifest.revision}`),
            baseVersion: String(manifest.baseVersion),
            revision: Number(manifest.revision),
            directory: finalDirectory
        };
        writeJsonAtomic(this.statePath, this.state);
        this.progressCallback?.({ stage: 'ready', percent: 100 });
        return { success: true, revision: Number(manifest.revision), restartRequired: true };
    }

    async loadActivePatch() {
        this.activeManifest = null;
        this.activeDirectory = '';
        const active = this.state.active;
        if (!active || active.baseVersion !== String(this.app.getVersion())) return;
        const directory = path.resolve(active.directory || '');
        const relativeDirectory = path.relative(path.resolve(this.rootPath), directory);
        if (!relativeDirectory || relativeDirectory.startsWith('..') || path.isAbsolute(relativeDirectory)) return;
        const manifest = readJson(path.join(directory, 'manifest.json'));
        try {
            this.verifyManifest(manifest);
            for (const item of manifest.files) {
                const filePath = path.join(directory, ...normalizePatchPath(item.path).split('/'));
                if (!fs.existsSync(filePath) || sha256(fs.readFileSync(filePath)) !== String(item.sha256).toLowerCase()) {
                    throw new Error('patch_active_file_invalid');
                }
            }
            this.activeManifest = manifest;
            this.activeDirectory = directory;
        } catch (error) {
            console.error('[EVD Patch] Active patch rejected:', error);
            this.state.active = this.state.previous || null;
            this.state.previous = null;
            this.state.health = { status: 'rolled_back', at: new Date().toISOString(), reason: error.message };
            writeJsonAtomic(this.statePath, this.state);
        }
    }

    applyMainPatch(context = {}) {
        const entrypoint = this.activeManifest?.mainEntrypoint;
        if (!entrypoint) return false;
        const modulePath = path.join(this.activeDirectory, ...normalizePatchPath(entrypoint).split('/'));
        const patchModule = require(modulePath);
        const apply = typeof patchModule === 'function' ? patchModule : patchModule?.apply;
        if (typeof apply !== 'function') throw new Error('patch_main_entrypoint_invalid');
        apply({
            ...context,
            app: this.app,
            appRoot: this.app.getAppPath(),
            patchDirectory: this.activeDirectory,
            requireFromApp: createRequire(path.join(this.app.getAppPath(), 'package.json'))
        });
        return true;
    }

    async injectRendererPatch(webContents) {
        const entrypoint = this.activeManifest?.rendererEntrypoint;
        if (!entrypoint || !webContents || webContents.isDestroyed()) return false;
        this.rendererInjectionPending += 1;
        try {
            const sourcePath = path.join(this.activeDirectory, ...normalizePatchPath(entrypoint).split('/'));
            const source = fs.readFileSync(sourcePath, 'utf8');
            const context = JSON.stringify({
                patchId: this.activeManifest.patchId,
                revision: Number(this.activeManifest.revision),
                baseVersion: this.activeManifest.baseVersion
            });
            await webContents.executeJavaScript(`(async () => {\nconst EVD_PATCH_CONTEXT = ${context};\n${source}\n})()\n//# sourceURL=evd-patch-renderer.js`, true);
            return true;
        } finally {
            this.rendererInjectionPending = Math.max(0, this.rendererInjectionPending - 1);
        }
    }

    noteRendererInjectionFailure(error) {
        this.rendererInjectionFailed = true;
        console.error('[EVD Patch] Renderer patch failed:', error);
    }

    getLocaleOverrides() {
        const result = {};
        for (const [locale, relativePath] of Object.entries(this.activeManifest?.localeFiles || {})) {
            const filePath = path.join(this.activeDirectory, ...normalizePatchPath(relativePath).split('/'));
            result[locale] = readJson(filePath, {});
        }
        return result;
    }

    markHealthy() {
        if (this.rendererInjectionFailed) {
            return { ...this.getStatus(), success: false, error: 'patch_renderer_injection_failed' };
        }
        if (this.rendererInjectionPending > 0) {
            return { ...this.getStatus(), success: false, error: 'patch_renderer_injection_pending' };
        }
        if (this.state.health?.status !== 'booting') return this.getStatus();
        this.state.health = {
            status: 'healthy',
            revision: this.state.active?.revision || 0,
            at: new Date().toISOString()
        };
        this.state.previous = null;
        writeJsonAtomic(this.statePath, this.state);
        return this.getStatus();
    }

    rollback() {
        if (!this.state.previous) return { success: false, error: 'patch_previous_missing' };
        this.state.pending = this.state.previous;
        this.state.previous = null;
        writeJsonAtomic(this.statePath, this.state);
        return { success: true, restartRequired: true };
    }

    getStatus() {
        return {
            active: this.state.active,
            pending: this.state.pending,
            health: this.state.health,
            revision: Number(this.state.active?.revision || 0),
            baseVersion: this.state.active?.baseVersion || String(this.app.getVersion())
        };
    }

    setupIpc(ipcMain, BrowserWindow) {
        if (this.ipcRegistered) return;
        this.ipcRegistered = true;
        this.progressCallback = (payload) => {
            for (const window of BrowserWindow.getAllWindows()) {
                if (!window.isDestroyed()) window.webContents.send('patch-update-progress', payload);
            }
        };
        ipcMain.handle('patch-update-check', async (_event, options = {}) => {
            try {
                return { success: true, ...(await this.checkForUpdate(options.manifestUrl || DEFAULT_MANIFEST_URL)) };
            } catch (error) {
                return { success: false, available: false, error: error.message };
            }
        });
        ipcMain.handle('patch-update-install', async (_event, manifest) => {
            try {
                return await this.install(manifest);
            } catch (error) {
                return { success: false, error: error.message };
            }
        });
        ipcMain.handle('patch-update-status', () => ({ success: true, ...this.getStatus() }));
        ipcMain.handle('patch-update-mark-healthy', () => ({ success: true, ...this.markHealthy() }));
        ipcMain.handle('patch-update-rollback', () => this.rollback());
        ipcMain.handle('patch-update-relaunch', () => {
            this.app.relaunch();
            this.app.exit(0);
            return { success: true };
        });
    }
}

module.exports = {
    PatchManager,
    PATCH_SCHEMA_VERSION,
    DEFAULT_MANIFEST_URL,
    canonicalize,
    manifestPayload,
    normalizePatchPath,
    sha256,
    fetchBuffer
};
