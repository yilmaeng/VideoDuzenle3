// Package a relocatable Windows runtime, never the developer's venv launcher.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const venv = path.join(root, 'temp/gtcrn-test-venv');
const cfg = fs.readFileSync(path.join(venv, 'pyvenv.cfg'), 'utf8');
const base = cfg.match(/^home = (.+)$/m)[1].trim();
const out = path.join(root, 'build/native-gtcrn/win-x64');
fs.mkdirSync(out, { recursive: true });
const copy = (source, target) => fs.cpSync(source, target, { recursive: true, filter: file => !['__pycache__', 'test', 'tests', 'site-packages', 'pip', 'ensurepip'].includes(path.basename(file)) });
for (const name of ['python.exe', 'python3.dll', 'python312.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt', 'Lib', 'DLLs']) copy(path.join(base, name), path.join(out, name));
const packages = path.join(venv, 'Lib/site-packages');
const target = path.join(out, 'Lib/site-packages');
fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(packages)) {
    if (name.startsWith('pip') || name === '__pycache__') continue;
    copy(path.join(packages, name), path.join(target, name));
}
fs.copyFileSync(path.join(root, 'tools/gtcrn-recording.py'), path.join(out, 'gtcrn-recording.py'));
fs.copyFileSync(path.join(root, 'temp/gtcrn-test/gtcrn_simple.onnx'), path.join(out, 'gtcrn_simple.onnx'));
// Restrict imports to this bundle, regardless of a user's installed Python.
fs.writeFileSync(path.join(out, 'python312._pth'), '.\nLib\nDLLs\nLib/site-packages\n');
cp.execFileSync(path.join(out, 'python.exe'), ['-c', 'import numpy, soundfile, sherpa_onnx; print("GTCRN packaged dependencies OK")'], { stdio: 'inherit' });
