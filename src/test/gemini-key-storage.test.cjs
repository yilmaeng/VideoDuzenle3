const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('Gemini storage reads legacy keys, encrypts new keys, and fails closed without encryption', () => {
    const source = fs.readFileSync(path.join(__dirname, '../main/gemini-handler.js'), 'utf8');
    const extract = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\n/**', source.indexOf(`function ${name}(`)));
    let stored = Buffer.from('legacy-fixture').toString('base64'), available = true;
    const safeStorage = { isEncryptionAvailable: () => available, encryptString: value => Buffer.from(value.split('').reverse().join('')),
        decryptString: value => value.toString().split('').reverse().join('') };
    const context = { Buffer, CONFIG_DIR: 'fixture', API_KEY_FILE: 'fixture/key', console,
        fs: { existsSync: () => true, readFileSync: () => stored, writeFileSync: (_file,value) => { stored=value; } },
        require: name => { assert.equal(name,'electron'); return { safeStorage }; } };
    vm.createContext(context); vm.runInContext(extract('saveApiKey')+'\n'+extract('getApiKey'), context);
    assert.equal(context.getApiKey(), 'legacy-fixture'); context.saveApiKey('new-fixture');
    assert(stored.startsWith('safeStorage:')); assert.equal(context.getApiKey(), 'new-fixture');
    const encrypted = stored; available = false;
    assert.throws(() => context.saveApiKey('other-fixture'), /secure_storage/);
    assert.equal(stored, encrypted); assert.equal(context.getApiKey(), null);
});
