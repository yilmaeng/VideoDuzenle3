const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

for (const fail of [true, false]) test(`old ElevenLabs ${fail ? 'error' : 'result'} cannot replace computer voices`, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../renderer/scripts/description-subtitle-phase5.js'), 'utf8');
    const block = source.slice(source.indexOf('    let voiceRequestId'), source.indexOf('    function applyDefaultsToUi'));
    const select = () => ({ value: '', options: [], replaceChildren(o) { this.options = [o]; }, add(o) { this.options.push(o); } });
    const ui = { defaultService: { value: 'elevenlabs' }, defaultVoice: select(), eventVoice: select() };
    const errors = [];
    let finish, reject;
    const old = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    const context = { ui, defaults: () => ({}), t: key => key, setStatus: (...args) => errors.push(args),
        Option: function(text, value) { this.text = text; this.value = value; },
        window: { api: { descriptionSubtitleEditorTtsVoices: ({service}) => service === 'elevenlabs' ? old : Promise.resolve({ voices: ['local voice'] }) } } };
    vm.runInNewContext(block + '\nthis.load = loadVoices;', context);
    const first = context.load();
    ui.defaultService.value = 'system';
    await context.load();
    if (fail) reject(new Error('fetch failed')); else finish({ voices: ['remote voice'] });
    await first;
    assert.deepEqual(ui.defaultVoice.options.map(o => o.value), ['', 'local voice']);
    assert.equal(errors.length, 0);
});
