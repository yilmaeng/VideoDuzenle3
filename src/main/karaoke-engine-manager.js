const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const extractZip = require('extract-zip');

const DEFAULT_MANIFEST_URL = 'https://evd.drenginyilmaz.net/downloads/karaoke-engine/manifest.json';
const COMPONENT_NAME = 'karaoke-aligner';
let installationPromise = null;

function platformKey() {
    return `${process.platform}-${process.arch}`;
}

function componentRoot() {
    const userData = app && typeof app.getPath === 'function'
        ? app.getPath('userData')
        : path.join(process.env.APPDATA || process.env.HOME || process.cwd(), 'EVD');
    return path.join(userData, 'optional-components', COMPONENT_NAME);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (_error) {
        return null;
    }
}

function runtimeFromRoot(root) {
    if (!root || !fs.existsSync(root)) return null;
    const pythonCandidates = process.platform === 'win32'
        ? [path.join(root, 'python', 'python.exe'), path.join(root, 'python.exe'), path.join(root, 'bin', 'python.exe')]
        : [path.join(root, 'python', 'bin', 'python3'), path.join(root, 'bin', 'python3'), path.join(root, 'python3')];
    const python = pythonCandidates.find(candidate => fs.existsSync(candidate));
    const pythonPath = [path.join(root, 'packages'), path.join(root, 'python-packages'), root]
        .find(candidate => fs.existsSync(path.join(candidate, 'lyric_align')));
    return python && pythonPath ? { python, pythonPath, root } : null;
}

function findInstalledRuntime() {
    const pointer = readJson(path.join(componentRoot(), 'current.json'));
    if (pointer?.version) {
        const runtime = runtimeFromRoot(path.join(componentRoot(), String(pointer.version)));
        if (runtime) return runtime;
    }
    if (!fs.existsSync(componentRoot())) return null;
    const versions = fs.readdirSync(componentRoot(), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
        const runtime = runtimeFromRoot(path.join(componentRoot(), version));
        if (runtime) return runtime;
    }
    return null;
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
        if (!response.ok) throw new Error(`karaoke_engine_manifest_http_${response.status}`);
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > 256 * 1024) throw new Error('karaoke_engine_manifest_too_large');
        return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('karaoke_engine_manifest_timeout');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeManifest(manifest) {
    const entry = manifest?.platforms?.[platformKey()];
    const version = String(entry?.version || manifest?.version || '').trim();
    const url = String(entry?.url || '').trim();
    const sha256 = String(entry?.sha256 || '').trim().toLowerCase();
    const size = Math.max(0, Number(entry?.size || 0));
    if (!version || !/^https:\/\//i.test(url) || !/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error('karaoke_engine_platform_unavailable');
    }
    return { version, url, sha256, size };
}

async function loadManifest() {
    const manifestUrl = String(process.env.EVD_KARAOKE_ENGINE_MANIFEST_URL || DEFAULT_MANIFEST_URL).trim();
    return normalizeManifest(await fetchJson(manifestUrl));
}

function sha256(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

async function downloadFile(url, destination, onProgress) {
    const partial = `${destination}.part`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.rmSync(partial, { force: true });
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`karaoke_engine_download_http_${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    const output = fs.createWriteStream(partial);
    const reader = response.body.getReader();
    let received = 0;
    let lastReportedPercent = -10;
    let reportedUnknownSize = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            received += chunk.length;
            if (!output.write(chunk)) await new Promise(resolve => output.once('drain', resolve));
            const percent = total > 0 ? Math.min(100, Math.round(received * 100 / total)) : null;
            if ((percent === null && !reportedUnknownSize) || percent === 100 || percent >= lastReportedPercent + 10) {
                onProgress?.({ stage: 'downloading', percent, received, total });
                if (percent === null) reportedUnknownSize = true;
                else lastReportedPercent = percent;
            }
        }
    } catch (error) {
        output.destroy();
        fs.rmSync(partial, { force: true });
        throw error;
    }
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    if (!received) throw new Error('karaoke_engine_download_empty');
    fs.rmSync(destination, { force: true });
    fs.renameSync(partial, destination);
}

async function install(options = {}) {
    const installed = findInstalledRuntime();
    if (installed) return installed;
    const manifest = await loadManifest();
    const root = componentRoot();
    const archive = path.join(root, 'downloads', `${COMPONENT_NAME}-${platformKey()}-${manifest.version}.zip`);
    if (!fs.existsSync(archive) || sha256(archive) !== manifest.sha256) {
        fs.rmSync(archive, { force: true });
        await downloadFile(manifest.url, archive, options.onProgress);
    }
    if (sha256(archive) !== manifest.sha256) {
        fs.rmSync(archive, { force: true });
        throw new Error('karaoke_engine_checksum_failed');
    }

    options.onProgress?.({ stage: 'installing', percent: null });
    const target = path.join(root, manifest.version);
    const staging = path.join(root, `.installing-${manifest.version}-${process.pid}-${Date.now()}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
        await extractZip(archive, { dir: staging });
        let runtime = runtimeFromRoot(staging);
        if (!runtime) {
            const entries = fs.readdirSync(staging, { withFileTypes: true }).filter(entry => entry.isDirectory());
            if (entries.length === 1) runtime = runtimeFromRoot(path.join(staging, entries[0].name));
        }
        if (!runtime) throw new Error('karaoke_engine_runtime_missing');
        if (process.platform !== 'win32') fs.chmodSync(runtime.python, 0o755);

        const sourceRoot = runtime.root;
        fs.rmSync(target, { recursive: true, force: true });
        if (sourceRoot === staging) {
            fs.renameSync(staging, target);
        } else {
            fs.renameSync(sourceRoot, target);
            fs.rmSync(staging, { recursive: true, force: true });
        }
        const finalRuntime = runtimeFromRoot(target);
        if (!finalRuntime) throw new Error('karaoke_engine_runtime_missing');
        fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({
            component: COMPONENT_NAME,
            version: manifest.version,
            platform: platformKey(),
            installedAt: new Date().toISOString()
        }, null, 2), 'utf8');
        fs.rmSync(archive, { force: true });
        options.onProgress?.({ stage: 'installing', percent: 100 });
        return finalRuntime;
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}

async function ensureInstalled(options = {}) {
    const installed = findInstalledRuntime();
    if (installed) return installed;
    if (!installationPromise) {
        installationPromise = install(options).finally(() => { installationPromise = null; });
    }
    return installationPromise;
}

module.exports = {
    DEFAULT_MANIFEST_URL,
    ensureInstalled,
    findInstalledRuntime,
    platformKey,
    runtimeFromRoot
};
