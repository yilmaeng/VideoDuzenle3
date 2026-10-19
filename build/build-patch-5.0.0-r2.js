'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createPatchArtifacts, verifyPatchManifest } = require('./evd-patch-tool');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'patches/5.0.0-revision-2');
const payload = path.join(root, 'dist/patch-5.0.0-r2/payload');
const modules = ['src/main/menu.js', 'src/shared/editor-menu-state.js', 'src/main/slideshow-handler.js', 'src/main/slideshow-audio-policy.js', 'src/main/slideshow-audio-mix.js', 'src/main/slideshow-progress.js'];
const pages = ['src/renderer/index.html', 'src/renderer/dialogs/slideshow-editor.html'];
const scripts = ['app', 'timeline', 'selection', 'markers', 'transitions', 'tab-manager', 'native-menu-availability', 'utils'].map(name => `src/renderer/scripts/${name}.js`);
function copy(from, to) {
    const destination = path.join(payload, to);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(from, destination);
}
copy(path.join(source, 'main.js'), 'main.js');
copy(path.join(root, 'patches/5.0.0-revision-1/payload/main.js'), 'assets/revision-1-main.js');
copy(path.join(root, 'patches/5.0.0-revision-1/payload/renderer.js'), 'renderer.js');
for (const relative of [...modules, ...pages, ...scripts]) copy(path.join(root, relative), `assets/${relative}`);
fs.writeFileSync(path.join(payload, 'assets/replacements.json'), JSON.stringify({ modules, pages, scripts }, null, 2));
for (const locale of ['tr', 'en', 'de', 'es', 'fr']) copy(path.join(root, `src/locales/${locale}.json`), `locales/${locale}.json`);
const notes = JSON.parse(fs.readFileSync(path.join(source, 'notes.json'), 'utf8'));
const result = createPatchArtifacts({
    input: payload, output: path.join(root, 'dist/patch-5.0.0-r2'), base: '5.0.0', revision: 2,
    'package-url': 'https://evd.drenginyilmaz.net/patches/evd-5.0.0-patch-2.evdpatch',
    'private-key': path.join(os.homedir(), '.evd-signing/patch-private-key.pem'),
    ...Object.fromEntries(Object.entries(notes).map(([locale, note]) => [`notes-${locale}`, note]))
});
verifyPatchManifest(result.manifestPath, path.join(root, 'src/main/update/patch-public-key.pem'));
console.log(JSON.stringify({ packagePath: result.packagePath, manifestPath: result.manifestPath, bytes: result.manifest.packageSize, files: result.manifest.files.length, signatureVerified: true }, null, 2));
