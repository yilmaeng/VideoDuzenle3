const fs = require('fs'), path = require('path'), crypto = require('crypto');
const project = path.join(require('os').homedir(), 'Projects/VideoDuzenle3');
const asar = require(path.join(project, 'node_modules/@electron/asar'));
const mounted = path.join(__dirname, '../released');
const bundle = fs.readdirSync(mounted).find(name => name.endsWith('.app'));
const appPath = path.join(mounted, bundle, 'Contents/Resources/app.asar');
const hashes = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/patch-5.0.0-r3/baseline-hashes.json')));
const differences = [];
for (const [file, hash] of Object.entries(hashes)) {
 try { if (crypto.createHash('sha256').update(asar.extractFile(appPath, file).toString('utf8').replace(/\r\n/g, '\n')).digest('hex') !== hash) differences.push(file); }
 catch (e) { differences.push({ file, missing: true }); }
}
console.log(JSON.stringify({ version: JSON.parse(asar.extractFile(appPath, 'package.json')).version, compared: Object.keys(hashes).length, differences }, null, 2));
fs.writeFileSync(path.join(__dirname, '../temp/mac-app-root.txt'), appPath);
