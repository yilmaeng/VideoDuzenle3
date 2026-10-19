const assert = require('node:assert/strict');
const framing = require('../renderer/scripts/crop-framing');
const confidence = level => ({top:level,bottom:level,left:level,right:level});
const raw = { confidence: confidence('high'), handsConfidence: confidence('high'), internalGap: false, reason: 'Ceiling above the speaker.', frames: [
    { content: { left: 250, top: 400, right: 750, bottom: 1000 }, hands: { left: 100, top: 350, right: 900, bottom: 1000 } },
    { content: { left: 200, top: 380, right: 780, bottom: 1000 }, hands: { left: 50, top: 350, right: 950, bottom: 1000 } }
] };
const data = framing.validate(raw, 2);
const calc = (mode, hands = false, value = data) => framing.calculate(value, 1280, 720, mode, hands).crop;
for (const edge of ['top','bottom','left','right']) {
    assert(calc('careful')[edge] <= calc('balanced')[edge]);
    assert(calc('balanced')[edge] <= calc('tight')[edge]);
    assert(calc('tight', true)[edge] <= calc('tight')[edge]);
    assert.equal(calc('tight')[edge] % 2, 0);
}
assert.equal(calc('tight').bottom, 0);
assert(calc('balanced').top > calc('balanced').left);
assert.deepEqual(calc('tight', false, {...data, confidence:confidence('low')}), {left:0,right:0,top:0,bottom:0});
const medium = {...data, confidence:confidence('medium')};
assert(calc('tight',false,medium).top < calc('tight').top);
assert(calc('tight',false,medium).top > calc('balanced',false,medium).top);
for (const mode of ['careful','balanced','tight']) {
    const result = framing.calculate(data,1280,720,mode,true);
    for (const edge of ['top','bottom','left','right']) {
        assert(result.crop[edge] <= result.gaps[edge], 'Never cut into the sampled content union');
    }
}
const sample = {...data,frames:[{content:{left:100,top:198,right:900,bottom:1000},hands:{left:100,top:198,right:900,bottom:1000}}]};
assert.equal(calc('balanced',true,sample).top,106);
assert.equal(calc('tight',true,sample).top,120);
const smallGap = {...sample,frames:[{content:{left:0,top:10,right:1000,bottom:1000},hands:{left:0,top:10,right:1000,bottom:1000}}]};
assert.equal(calc('tight',true,smallGap).top,0);
const uncertainHands = {...data,handsConfidence:{...confidence('low'),top:'high'}};
const safeTop = calc('tight', true, uncertainHands);
assert(safeTop.top > 0, 'Uncertain hands must not disable the clear top edge');
assert.equal(safeTop.left,0);
assert.equal(safeTop.right,0);
assert(calc('tight',false,uncertainHands).left > 0);
const uncertainTop = {...data,confidence:{...confidence('high'),top:'low'}};
assert.equal(calc('tight',true,uncertainTop).top,0);
assert(calc('tight',true,uncertainTop).right > 0);
assert.throws(()=>framing.validate({...raw,frames:[]},2));
assert.throws(()=>framing.validate({...raw,confidence:'sure'},2));
assert.throws(()=>framing.validate({...raw,frames:[{content:{left:-2,top:0,right:1000,bottom:1000},hands:raw.frames[0].hands}]},1));
assert.throws(()=>framing.validate({...raw,frames:[{content:{left:0,top:0,right:NaN,bottom:1000},hands:raw.frames[0].hands}]},1));
assert.deepEqual(calc('tight', false, framing.validate({confidence:confidence('high'),handsConfidence:confidence('high'),internalGap:true,reason:'Two regions.',frames:[{content:{left:0,top:0,right:1000,bottom:1000},hands:raw.frames[0].hands}]},1)),{left:0,right:0,top:0,bottom:0});
console.log('Framing: monotonic tightness, multi-frame union, hand margins, low confidence, internal gap and invalid geometry passed.');
for (const wrapper of [s=>s,s=>'```json\n'+s+'\n```',s=>'Suggestion:\n'+s+'\nPlease review.']) {
    const value = {reason:'Literal { braces } and "quotes"',frames:[]};
    assert.deepEqual(framing.parseResponse(wrapper(JSON.stringify(value))),value);
}
for (const text of ['No suggestion','{"frames":','{} {}','{"reason":"missing comma" "frames":[]}']) {
    assert.throws(()=>framing.parseResponse(text));
}
