const assert = require('node:assert/strict');
const { resolveDeviceTiming, syncFilter } = require('../studio/obs-audio-timing');
const kind = 'net.nagater.obs.asynchronous-audio-filter';
(async () => {
    const run = (filters, requested) => resolveDeviceTiming(async (method, args) => {
        assert.equal(method, 'GetSourceFilterList');
        assert.deepEqual(args, { sourceName: 'Mic/Aux' });
        return { filters };
    }, 'Mic/Aux', requested);
    assert.equal(await run([], true), true);
    assert.equal(await run([], false), false);
    assert.equal(await run([{ filterKind: kind, filterEnabled: true }], true), false);
    assert.equal(await run([{ filterKind: kind, filterEnabled: true }], false), false);
    assert.equal(await run([{ filterKind: kind, filterEnabled: false }], true), true);
    assert.equal(await run([{ filterKind: 'gain_filter', filterEnabled: true }], true), true);
    await assert.rejects(resolveDeviceTiming(async () => { throw new Error('offline'); }, 'Mic/Aux', true));
    let filters = [], available = true, created = 0;
    const call = async (method, args) => {
        if (method === 'GetSourceFilterList') return { filters };
        if (method === 'GetSourceFilterKindList') return { sourceFilterKinds: available ? [kind] : [] };
        if (method === 'CreateSourceFilter') { created++; filters.push({ filterKind:kind, filterName:args.filterName, filterEnabled:true }); return {}; }
        if (method === 'SetSourceFilterEnabled') { filters.find(f=>f.filterName===args.filterName).filterEnabled=args.filterEnabled; return {}; }
        throw Error(method);
    };
    await syncFilter(call,'Mic/Aux',false,'test');
    assert.equal(created,0);
    await syncFilter(call,'Mic/Aux',true,'test');
    await syncFilter(call,'Mic/Aux',true,'test');
    assert.equal(created,1);
    await syncFilter(call,'Mic/Aux',false,'test');
    assert.equal(filters[0].filterEnabled,false);
    await syncFilter(call,'Mic/Aux',true,'test');
    assert.equal(filters[0].filterEnabled,true);
    filters=[];available=false;
    await assert.rejects(syncFilter(call,'Mic/Aux',true,'test'),/plugin_missing/);
    const fs=require('fs'),os=require('os'),path=require('path');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'evd-obs-package-test-'));
    const file=path.join(root,'scene.json');
    fs.writeFileSync(file,JSON.stringify({source:{filters:[{id:kind},{id:'gain_filter'}]}}));
    require('../../build/sanitize-obs-test-settings.cjs').sanitize(root);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)).source.filters,[{id:'gain_filter'}]);
    fs.unlinkSync(file);fs.rmdirSync(root);
    console.log('OBS timing: enabled/disabled/missing filter and inspection failure passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
