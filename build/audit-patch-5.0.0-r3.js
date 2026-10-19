const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'dist/win-unpacked/resources/app.asar');
const changed = [];
const baseline = {};
function walk(relative) {
 for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
  const file = `${relative}/${entry.name}`;
  if (entry.isDirectory()) walk(file);
  else if (/\.(js|cjs|json|html|css|py)$/.test(file) && !/generated|restoration_block|temp_render|test-main/.test(file)) {
   let old; try { old = asar.extractFile(archive, file.split('/').join(path.sep)); } catch (_) {}
   const current = fs.readFileSync(path.join(root, file));
   if (old) baseline[file] = require('crypto').createHash('sha256').update(old.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
   if (!old || !old.equals(current)) changed.push({ file, size: current.length, added: !old });
  }
 }
}
for (const dir of ['src/main','src/preload','src/renderer','src/shared','src/studio','src/locales']) walk(dir);
const destination = path.join(root, 'dist/patch-5.0.0-r3');
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, 'source-audit.json'), JSON.stringify(changed, null, 2));
fs.writeFileSync(path.join(destination, 'baseline-hashes.json'), JSON.stringify(baseline, null, 2));
console.log(changed);
