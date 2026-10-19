const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const crc32 = require('buffer-crc32');
const Module = require('node:module');
const root = fs.mkdtempSync(path.resolve(__dirname, '../../temp/vocal-install-test-'));
const load = Module._load;
let currentRoot = root;
Module._load = function(id, ...args) {
    if (id === 'electron') return { app: { isPackaged: true, getPath: () => currentRoot } };
    return load.call(this, id, ...args);
};
const manager = require('../main/vocal-engine-manager');
Module._load = load;
function zip(files) {
    const local = [], central = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file), data = Buffer.from('fixture');
        const crc = crc32.unsigned(data), head = Buffer.alloc(30), dir = Buffer.alloc(46);
        head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4);
        head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
        dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
        dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
        local.push(head, name, data); central.push(dir, name); offset += head.length + name.length + data.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}
const files = [process.platform === 'win32' ? 'python/python.exe' : 'python/bin/python3',
    'packages/audio_separator/__init__.py', `models/${manager.MODEL}`, `models/${manager.CONFIG}`];
const archive = zip(files);
const entry = { version: '1.0.0', url: 'https://example.invalid/engine.zip', size: archive.length,
    unpackedSize: files.length * 7, sha256: crypto.createHash('sha256').update(archive).digest('hex') };
const realFetch = global.fetch;
let calls = 0;
function network(bytes = archive) {
    global.fetch = async url => {
        calls++;
        return url.endsWith('manifest.json')
            ? new Response(JSON.stringify({ platforms: { [`${process.platform}-${process.arch}`]: entry } }))
            : new Response(bytes);
    };
}
(async () => {
    network();
    const progress = [];
    const options = { signal: new AbortController().signal, onProgress: data => progress.push(data.stage) };
    await assert.rejects(manager.ensure(options), /consent/);
    const info = await manager.downloadInfo();
    assert.equal(info.size, archive.length);
    assert.equal(info.requiredSpace, entry.size + entry.unpackedSize + 512 * 1024 ** 2);
    options.approval = info.approval;
    calls = 0;
    const runtime = await manager.ensure(options);
    assert(runtime && fs.existsSync(runtime.python));
    assert(progress.includes('downloading') && progress.includes('installing'));
    assert.equal(calls, 2);
    await manager.ensure(options);
    assert.equal(calls, 2, 'Installed engine must not access the network again');
    currentRoot = path.join(root, 'corrupt');
    const originalSize = entry.size;
    entry.size++;
    await assert.rejects(manager.ensure(options), /consent/);
    entry.size = originalSize;
    const damaged = Buffer.from(archive); damaged[40] ^= 1;
    network(damaged);
    await assert.rejects(manager.ensure(options), /checksum/);
    assert.equal(manager.installed(), null);
    const remaining = fs.readdirSync(path.join(currentRoot, 'optional-components/vocal-separator'));
    assert.deepEqual(remaining, [], 'Corrupt package must leave no archive or installation');
    console.log('Optional engine download, checksum, extraction and offline reuse tests passed.');
})().finally(() => { global.fetch = realFetch; fs.rmSync(root, { recursive: true, force: true }); })
    .catch(error => { console.error(error); process.exitCode = 1; });
