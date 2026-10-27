const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {isFiller,candidates}=require('../main/filler-analysis');
const core=require('../renderer/scripts/filler-review-core');
const {wordsFromFullJson}=require('../main/description-whisper-native');

test('DTW repairs a shifted filler without extending into the next word',()=>{
    const token=(text,from,to,t_dtw)=>({text,offsets:{from,to},t_dtw});
    const payload={transcription:[{offsets:{from:11000,to:15000},tokens:[
        token(' ben',12700,12940,1192),token(' e',12940,13020,1246),
        token('ee',13020,13180,1258),token(',',13180,13330,1276),token(' ben',13340,13570,1294)
    ]}]};
    const normal=wordsFromFullJson(payload),aligned=wordsFromFullJson(payload,true);
    assert.equal(normal[1].start,12.94);
    assert.equal(aligned[1].text,'eee,');assert.equal(aligned[1].start,12.46);assert.equal(aligned[1].end,12.94);
    assert.ok(aligned[0].end<=aligned[1].start&&aligned[1].end<=aligned[2].start);
    assert.ok(aligned[1].start<12.711&&aligned[1].end>12.711);
    payload.transcription[0].tokens[1].t_dtw=-1;
    assert.deepEqual(wordsFromFullJson(payload,true),[]);
    assert.equal(wordsFromFullJson(payload).length,3);
    payload.transcription[0].tokens[1].t_dtw=1100;
    assert.deepEqual(wordsFromFullJson(payload,true),[]);
});

test('outlying punctuation cannot discard valid spoken fillers',()=>{
    const payload={transcription:[{offsets:{from:0,to:3000},tokens:[
        {text:' ee',offsets:{from:1600,to:1950},t_dtw:164,p:.95},
        {text:'e',offsets:{from:1950,to:2130},t_dtw:240,p:.95},
        {text:' sonra',offsets:{from:2130,to:2900},t_dtw:272,p:.96},
        {text:'?',offsets:{from:2900,to:3000},t_dtw:340,p:.9}
    ]}]};
    const words=wordsFromFullJson(payload,true);
    assert.equal(words.length,2);assert.ok(words[0].start<2.221&&words[0].end>2.221);
});

test('only explicitly strong candidates are initially selected',()=>{
    const items=core.map([{sourcePath:'a',fillers:[{text:'eee',start:1,end:2,highConfidence:true},{text:'eee',start:3,end:4}]}],[{start:0,end:5}], 'a');
    assert.deepEqual(items.map(x=>x.approved),[true,false]);
});
test('conservative filler patterns do not consume meaningful words',()=>{
    for(const s of ['eee','ııı','ımm','hmm','hımm','eem'])assert.ok(isFiller(s),s);
    for(const s of ['hem','şey','yani','işte','aaa','e','ı','merhaba','hım'])assert.equal(isFiller(s),false,s);
});
test('acoustic gating rejects silence and boundaries retain neighbouring speech',t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evd-filler-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const file=path.join(dir,'audio.f32'),raw=Buffer.alloc(4*16000*4);
    for(let i=0;i<64000;i++)raw.writeFloatLE(.1*Math.sin(i*.05),i*4);fs.writeFileSync(file,raw);
    const words=[{text:'önce',start:0,end:1},{text:'eee',start:1.03,end:1.6},{text:'sonra',start:1.63,end:2}];
    const found=candidates(words,file);assert.equal(found.length,1);assert.ok(found[0].start>=1.02);assert.ok(found[0].end<=1.61);
    assert.equal(found[0].highConfidence,false);
    words[1].alignmentQuality={probability:.97,shift:.04,boundariesValid:true};
    assert.equal(candidates(words,file)[0].highConfidence,true);
    words[1].alignmentQuality.shift=.3;
    assert.equal(candidates(words,file)[0].highConfidence,true);
    words[1].alignmentQuality.boundariesValid=false;
    assert.equal(candidates(words,file)[0].highConfidence,false);
    words[1].alignmentQuality.boundariesValid=true;
    words[1].alignmentQuality.probability=.6;
    assert.equal(candidates(words,file)[0].highConfidence,false);
    words[1].alignmentQuality.probability=.97;
    words[0].end=1.05;
    assert.equal(candidates(words,file)[0].highConfidence,false);
    fs.writeFileSync(file,Buffer.alloc(raw.length));assert.equal(candidates(words,file).length,0);
});
test('candidate source times map to edited repeats and speed without crossing cuts',()=>{
    const result=core.map([{sourcePath:'a',fillers:[{text:'eee',start:4,end:5},{text:'hmm',start:6,end:8}]}],
        [{start:3,end:7,speed:2},{start:3,end:7,speed:1}], 'a');
    assert.equal(result.length,2);assert.equal(result[0].start,.5);assert.equal(result[0].end,1);assert.equal(result[1].start,3);
    assert.ok(result.every(x=>!x.approved));
});
test('approved ranges merge overlaps and reject invalid user edits',()=>{
    assert.deepEqual(core.ranges([{start:1,end:3,lower:0,upper:8,approved:true},{start:2,end:4,lower:0,upper:8,approved:true},{start:5,end:6,approved:false}]),[{start:1,end:4}]);
    assert.throws(()=>core.ranges([{start:-1,end:2,lower:0,upper:8,approved:true}]));
});
test('all filler UI strings are available in every active locale',()=>{
    const locales=['tr','en','de','es','fr'].map(lang=>require(`../locales/${lang}.json`).filler_review);
    for(const locale of locales){assert.deepEqual(Object.keys(locale).sort(),Object.keys(locales[0]).sort());assert.ok(Object.values(locale).every(v=>typeof v==='string'&&v));}
});

test('delete all includes unapproved candidates without changing approval state',()=>{
    const items=[{start:1,end:2,lower:0,upper:8,approved:false},{start:1.5,end:3,lower:0,upper:8,approved:true}];
    assert.deepEqual(core.ranges(items.map(item=>({...item,approved:true}))),[{start:1,end:3}]);
    assert.equal(items[0].approved,false);
});
