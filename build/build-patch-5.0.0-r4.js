'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const asar = require('@electron/asar');
const { createPatchArtifacts, verifyPatchManifest } = require('./evd-patch-tool');
const root = path.resolve(__dirname, '..');
const revision = Number(process.env.EVD_PATCH_REVISION || 4);
if (![4, 5, 6].includes(revision)) throw new Error('unsupported_patch_revision');
const output = path.join(root, `dist/patch-5.0.0-r${revision}`);
const payload = path.join(output, 'payload');
const archive = path.join(root, 'dist/win-unpacked/resources/app.asar');
const audit = [], baseline = {};
const normalize = data => data.toString().replace(/\r\n/g, '\n');
function original(file) { try { return asar.extractFile(archive, path.normalize(file)); } catch { return null; } }
function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const file = `${relative}/${entry.name}`;
        if (entry.isDirectory()) walk(file);
        else if (/\.(js|cjs|json|html|css|py)$/.test(file) && !/generated|restoration_block|temp_render|test-main/.test(file)) {
            const old = original(file), current = fs.readFileSync(path.join(root, file));
            if (old) baseline[file] = crypto.createHash('sha256').update(normalize(old)).digest('hex');
            if (!old || !old.equals(current)) audit.push({ file, size: current.length, added: !old });
        }
    }
}
for (const dir of ['src/main', 'src/preload', 'src/renderer', 'src/shared', 'src/studio', 'src/locales']) walk(dir);
// Fail closed if future startup/preload changes exceed this reviewed adapter.
const startup = normalize(fs.readFileSync(path.join(root, 'src/main/index.js')))
    .replace(/^.*require\('\.\/room-account-client'\)\.setupRoomAccountHandlers\(\);\n/m, '');
if (startup !== normalize(original('src/main/index.js'))) throw new Error('unreviewed_startup_change');
const preload = normalize(fs.readFileSync(path.join(root, 'src/preload/index.js')))
    .replace(/^.*getTimelinePreviewAudio:.*\n/m, '')
    .replace(/    speechSearchInspect:[\s\S]*?(?=    \/\/ Video)/, '')
    .replace(/    refreshAiModels:[\s\S]*?\n    },\n/, '');
const withoutBlankLines = text => text.split('\n').filter(line => line.trim()).join('\n');
if (withoutBlankLines(preload) !== withoutBlankLines(normalize(original('src/preload/index.js')))) throw new Error('unreviewed_preload_change');
const adapted = ['src/main/index.js', 'src/preload/index.js'];
const deferred = ['src/main/update/patch-manager.js'];
const files = audit.map(item => item.file).filter(file => ![...adapted, ...deferred].includes(file));
const modules = files.filter(file => /^src\/(main|shared|studio)\/.*\.js$/.test(file));
const scripts = files.filter(file => file.startsWith('src/renderer/') && file.endsWith('.js'));
const styles = files.filter(file => file.startsWith('src/renderer/') && file.endsWith('.css'));
const pages = [];
function findPages(relative) {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const file = `${relative}/${item.name}`;
        if (item.isDirectory()) findPages(file); else if (file.endsWith('.html')) pages.push(file);
    }
}
findPages('src/renderer');
const supported = new Set([...modules, ...scripts, ...styles, ...pages, ...files.filter(file => file.startsWith('src/locales/'))]);
const unsupported = files.filter(file => !supported.has(file));
if (unsupported.length) throw new Error(`unhandled_patch_asset:${unsupported.join(',')}`);
if (path.dirname(payload) !== output || !output.startsWith(root + path.sep)) throw new Error('unsafe_payload_path');
fs.rmSync(payload, { recursive: true, force: true });
function write(relative, data) {
    const target = path.join(payload, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
}
for (const file of ['main.js', 'worker-overlay.js', 'preload-bridge.js', 'renderer-bootstrap.js']) {
    let data = fs.readFileSync(path.join(root, 'patches/5.0.0-revision-4', file), 'utf8').replaceAll('5.0.0-r4', `5.0.0-r${revision}`).replaceAll('r4', `r${revision}`);
    if (revision >= 5 && file === 'preload-bridge.js') data = data.replace('const api = {', "const api = {\n        getTimelinePreviewAudio: options => ipcRenderer.invoke('timeline-preview-audio', options),");
    write(file === 'main.js' ? file : `assets/${file}`, data);
}
write('assets/base-main.js', fs.readFileSync(path.join(root, 'patches/5.0.0-revision-3/main.js'), 'utf8').replaceAll('5.0.0.3', `5.0.0.${revision}`).replaceAll('5.0.0-r3', `5.0.0-r${revision}`).replace("require('./assets/replacements.json')", "require('./replacements.json')")
    .replace('<head><base href="${base}">', '<head><base href="${base}"><script src="${pathToFileURL(path.join(patchDirectory, \'assets/renderer-bootstrap.js\')).href}"></script>'));
const transformed = [];
for (const file of new Set([...modules, ...scripts, ...styles, ...pages])) {
    let data = fs.readFileSync(path.join(root, file));
    if (scripts.includes(file)) {
        const text = data.toString();
        const updated = text.replace(/window\.api\.(?=(?:speechSearch\w+|onSpeechSearch\w+|refreshAiModels|getTimelinePreviewAudio)\b)/g, '(window.evdPatchApi || window.api).');
        if (updated !== text) { transformed.push(file); data = Buffer.from(updated); }
    }
    write(`assets/${file}`, data);
}
write('assets/replacements.json', JSON.stringify({ modules, scripts, styles, pages }, null, 2));
for (const locale of ['tr','en','de','es','fr']) write(`locales/${locale}.json`, fs.readFileSync(path.join(root, `src/locales/${locale}.json`)));
const notes = JSON.parse(fs.readFileSync(path.join(root, `patches/5.0.0-revision-${revision}/notes.json`), 'utf8'));
const result = createPatchArtifacts({ input: payload, output, base: '5.0.0', revision,
    platforms: 'win32,darwin', architectures: 'x64,arm64',
    'package-url': `https://evd.drenginyilmaz.net/patches/evd-5.0.0-patch-${revision}.evdpatch`,
    'private-key': path.join(os.homedir(), '.evd-signing/patch-private-key.pem'),
    ...Object.fromEntries(Object.entries(notes).map(([locale, note]) => [`notes-${locale}`, note])) });
verifyPatchManifest(result.manifestPath, path.join(root, 'src/main/update/patch-public-key.pem'));
for (const [name, data] of Object.entries({ 'source-audit': audit, 'baseline-hashes': baseline,
    coverage: { baseArchive: path.relative(root, archive), included: files, adapted, deferred, transformed, cumulative: true,
        reason: 'Signed preload supplemented on local pages; room-account startup handler registered once; updater already loaded.' } })) {
    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(data, null, 2));
}
console.log(JSON.stringify({ package: result.packagePath, bytes: result.manifest.packageSize, files: result.manifest.files.length, transformed }, null, 2));
