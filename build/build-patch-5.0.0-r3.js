'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createPatchArtifacts, verifyPatchManifest } = require('./evd-patch-tool');
require('./audit-patch-5.0.0-r3');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/patch-5.0.0-r3');
const payload = path.join(output, 'payload');
const audit = JSON.parse(fs.readFileSync(path.join(output, 'source-audit.json'), 'utf8'));
// Never re-execute startup or the live updater from an application patch.
const deferred = ['src/main/update/patch-manager.js'];
if (audit.some(item => item.file === 'src/main/index.js' || item.file.startsWith('src/preload/'))) throw new Error('startup_or_preload_requires_review');
const files = audit.map(item => item.file).filter(file => !deferred.includes(file));
const modules = files.filter(file => /^(src\/(main|shared|studio)\/).*\.js$/.test(file));
const scripts = files.filter(file => file.startsWith('src/renderer/') && file.endsWith('.js'));
const styles = files.filter(file => file.startsWith('src/renderer/') && file.endsWith('.css'));
// Include every renderer page so changed shared scripts/styles are used everywhere.
const pages = [];
function findPages(relative) {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const file = `${relative}/${item.name}`;
        if (item.isDirectory()) findPages(file);
        else if (file.endsWith('.html')) pages.push(file);
    }
}
findPages('src/renderer');
const supported = new Set([...modules, ...scripts, ...styles, ...pages, ...files.filter(file => file.startsWith('src/locales/'))]);
if (files.some(file => !supported.has(file))) throw new Error('unhandled_patch_asset');
// This generated staging tree is owned by this builder; remove stale payload files.
if (path.dirname(payload) !== output) throw new Error('unsafe_payload_path');
fs.rmSync(payload, { recursive: true, force: true });
function copy(relative, destination) {
    const target = path.join(payload, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target);
}
copy('patches/5.0.0-revision-3/main.js', 'main.js');
for (const file of new Set([...modules, ...scripts, ...styles, ...pages])) copy(file, `assets/${file}`);
fs.writeFileSync(path.join(payload, 'assets/replacements.json'), JSON.stringify({ modules, scripts, styles, pages }, null, 2));
for (const locale of ['tr', 'en', 'de', 'es', 'fr']) copy(`src/locales/${locale}.json`, `locales/${locale}.json`);
const notes = JSON.parse(fs.readFileSync(path.join(root, 'patches/5.0.0-revision-3/notes.json'), 'utf8'));
const result = createPatchArtifacts({ input: payload, output, base: '5.0.0', revision: 3,
    platforms: 'win32,darwin', architectures: 'x64,arm64',
    'package-url': 'https://evd.drenginyilmaz.net/patches/evd-5.0.0-patch-3.evdpatch',
    'private-key': path.join(os.homedir(), '.evd-signing/patch-private-key.pem'),
    ...Object.fromEntries(Object.entries(notes).map(([locale, note]) => [`notes-${locale}`, note])) });
verifyPatchManifest(result.manifestPath, path.join(root, 'src/main/update/patch-public-key.pem'));
fs.writeFileSync(path.join(output, 'coverage.json'), JSON.stringify({ baseArchive: 'dist/win-unpacked/resources/app.asar',
    included: files, deferred, reason: 'Updater is already loaded at patch activation; relaunch IPC is updated explicitly. Development isolation applies only to source runs.',
    cumulative: true, ...Object.fromEntries(Object.entries({ modules, scripts, styles, pages }).map(([k,v]) => [k,v.length])) }, null, 2));
console.log(JSON.stringify({ packagePath: result.packagePath, manifestPath: result.manifestPath,
    bytes: result.manifest.packageSize, files: result.manifest.files.length, signatureVerified: true }, null, 2));
