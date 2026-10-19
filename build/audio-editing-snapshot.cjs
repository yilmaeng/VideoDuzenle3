// Developer maintenance tool, intentionally not exposed in the shortcut manager.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const SCOPE = [
  'src/main/export',
  'src/main/ffmpeg-handler.js',
  'src/main/slideshow-audio-policy.js',
  'src/main/slideshow-audio-mix.js',
  'src/main/ipc-handlers.js',
  'src/preload/index.js',
  'src/renderer/index.html',
  'src/renderer/scripts/dialogs.js',
  ...['video-player', 'audio-player', 'timeline', 'selection', 'markers',
    'keyboard', 'app', 'transitions', 'transition-preview', 'insertion-queue']
    .map(name => `src/renderer/scripts/${name}.js`),
];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const allowed = name => SCOPE.some(entry => name === entry || name.startsWith(`${entry}/`));

function safePath(root, name) {
  if (typeof name !== 'string' || name.includes('\\') || name.includes(':') ||
      name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe relative path');
  }
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path escapes root');
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported: ${name}`);
    }
  }
  return target;
}

function enumerate(root, name) {
  const target = safePath(root, name);
  const stat = fs.statSync(target);
  if (stat.isFile()) return [name];
  if (!stat.isDirectory()) throw new Error(`Unsupported file: ${name}`);
  return fs.readdirSync(target).sort().flatMap(child => enumerate(root, `${name}/${child}`));
}

function create(root = ROOT, names = SCOPE.flatMap(name => enumerate(root, name)), prefix = 'audio-editing-baseline') {
  const relative = `backups/${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const directory = safePath(root, relative);
  fs.mkdirSync(directory, { recursive: true });
  const files = names.map(name => {
    if (!allowed(name)) throw new Error(`Out of scope: ${name}`);
    const source = safePath(root, name);
    if (!fs.existsSync(source)) return { path: name, absent: true };
    const data = fs.readFileSync(source);
    const destination = safePath(directory, `files/${name}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data, { flag: 'wx' });
    return { path: name, size: data.length, sha256: hash(data) };
  });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
    schema: 1, createdAt: new Date().toISOString(), scope: SCOPE, files,
  }, null, 2), { flag: 'wx' });
  verify(directory);
  return directory;
}

function verify(directory) {
  const manifest = JSON.parse(fs.readFileSync(safePath(directory, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid manifest');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!allowed(file.path) || seen.has(file.path)) throw new Error('Invalid manifest entry');
    seen.add(file.path);
    if (file.absent) continue;
    const data = fs.readFileSync(safePath(directory, `files/${file.path}`));
    if (data.length !== file.size || hash(data) !== file.sha256) {
      throw new Error(`Backup verification failed: ${file.path}`);
    }
  }
  return manifest;
}

function restore(directory, apply = false, root = ROOT) {
  const manifest = verify(directory);
  const changed = manifest.files.filter(file => {
    if (file.absent) return false; // Never delete a file during rollback.
    const target = safePath(root, file.path);
    return !fs.existsSync(target) || hash(fs.readFileSync(target)) !== file.sha256;
  });
  const result = { apply, changed: changed.map(file => file.path), safetyBackup: null };
  if (!apply || !changed.length) return result;
  result.safetyBackup = create(root, result.changed, 'audio-editing-before-restore');
  for (const file of changed) {
    const target = safePath(root, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(safePath(directory, `files/${file.path}`), target);
    if (hash(fs.readFileSync(target)) !== file.sha256) throw new Error(`Restore failed: ${file.path}`);
  }
  return result;
}

if (require.main === module) {
  try {
    const [command, name, flag] = process.argv.slice(2);
    if (command === 'create') console.log(create());
    else {
      if (!name || !name.replace(/\\/g, '/').startsWith('backups/')) throw new Error('Use a project-relative backups/... path');
      const directory = safePath(ROOT, name.replace(/\\/g, '/'));
      if (command === 'verify') console.log(JSON.stringify({ verifiedFiles: verify(directory).files.length }));
      else if (command === 'restore') console.log(JSON.stringify(restore(directory, flag === '--apply'), null, 2));
      else throw new Error('Usage: create | verify backups/... | restore backups/... [--apply]');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { create, verify, restore, safePath };
