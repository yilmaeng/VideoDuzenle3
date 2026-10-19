const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../renderer/dialogs/slideshow-editor.html'), 'utf8');
assert(html.includes('<script src="../scripts/utils.js"></script>'));
const start = html.indexOf('        let exportProgressInterval = null;');
const end = html.indexOf("        ipcRenderer.on('slideshow-export-result'", start);
const sounds = [];
const timers = new Set();
let nextTimer = 0;
let listener;
vm.runInNewContext(html.slice(start, end), {
    ipcRenderer: { on: (_name, fn) => { listener = fn; } },
    document: { getElementById: () => ({}) },
    window: { Utils: { playProgressTone: percent => sounds.push(percent), playSound: type => sounds.push(type) } },
    announce() {}, t: key => key,
    setInterval: () => { timers.add(++nextTimer); return nextTimer; },
    clearInterval: id => timers.delete(id)
});
const emit = (status, percent) => listener({}, { status, percent, message: 'test' });
emit('started');
for (const percent of [0, 1, 2, 2, 3, 4, 3, 19, 20, 21, 99]) emit('progress', percent);
assert.deepEqual(sounds, [2, 4, 19, 21, 99]);
emit('completed'); emit('completed'); emit('progress', 90);
assert.equal(sounds.filter(value => value === 'success').length, 1);
assert.equal(timers.size, 0);
emit('started'); emit('started');
assert.equal(timers.size, 1);
emit('progress', 2);
assert.equal(sounds.at(-1), 2);
emit('error'); emit('error');
assert.equal(sounds.filter(value => value === 'error').length, 1);
assert.equal(timers.size, 0);
console.log('Slideshow progress sound tests passed.');
