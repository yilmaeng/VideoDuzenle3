'use strict';
const fs = require('node:fs');
const PROMPT = 'Eee, bugün bu konuyu konuşacağız. Iıı, önce bir örnek vereyim. Hımm, burada biraz düşünmem gerekiyor. Şimdi, ımm, diğer bölüme geçelim.';
const VERSION = 'tr-fillers-5-aligned-boundaries';
function isFiller(text) {
    return /^(?:e{2,}|ı{2,}|i{2,}|e{1,}m{1,}|ı{1,}m{1,}|h[ıi]?m{2,}|m{2,})$/u.test(String(text).toLocaleLowerCase('tr').replace(/[\s.,!?;:…]+/g,''));
}
function candidates(words, audioPath) {
    const fd = fs.openSync(audioPath,'r');
    const duration = fs.fstatSync(fd).size / 64000;
    const result = [];
    try {
        const ordered = words.slice().sort((a,b)=>a.start-b.start);
        for (let i=0;i<ordered.length;i++) {
            const word=ordered[i];
            if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || !isFiller(word.text) || word.end-word.start<0.12 || word.end-word.start>2.5) continue;
            // Never borrow time from adjacent recognized speech. Keep 20ms protection.
            const low=Math.max(0,word.start-0.04,(ordered[i-1]?.end ?? -1)+0.02);
            const high=Math.min(duration,word.end+0.04,(ordered[i+1]?.start ?? duration+1)-0.02);
            if(high-low<0.12)continue;
            const from=Math.floor(low*16000), to=Math.ceil(high*16000);
            const buffer=Buffer.alloc((to-from)*4);fs.readSync(fd,buffer,0,buffer.length,from*4);
            const rms=(a,b)=>{let sum=0,count=0;for(let n=Math.max(0,a);n<Math.min(to-from,b);n++){const v=buffer.readFloatLE(n*4);if(Number.isFinite(v)){sum+=v*v;count++;}}return Math.sqrt(sum/Math.max(1,count));};
            if(rms(0,to-from)<0.003)continue; // Reject hallucinations over near-silence, not a confidence score.
            const snap=(time)=>{
                let best=Math.max(low,Math.min(high,time)),energy=Infinity;
                for(let t=Math.max(low,time-0.04);t<=Math.min(high,time+0.04);t+=0.005){
                    const n=Math.round(t*16000)-from, value=rms(n-80,n+80);
                    if(value<energy){energy=value;best=t;}
                }return best;
            };
            const start=snap(word.start),end=snap(word.end);
            if(end-start<0.1)continue;
            // Conservative review priority, NOT a calibrated correctness probability.
            // A correction relative to old timestamps is not evidence against DTW.
            // Check the aligned boundaries themselves, including real neighbours.
            const highConfidence = word.alignmentQuality?.probability >= 0.9 && word.alignmentQuality?.boundariesValid === true
                && end-start >= 0.2 && end-start <= 1.5 && rms(0,to-from)>=0.01
                && i>0 && i<ordered.length-1
                && ordered[i-1].end <= word.start && word.end <= ordered[i+1].start
                && Math.abs(start-word.start)<=0.041 && Math.abs(end-word.end)<=0.041;
            result.push({text:word.text,start,end,highConfidence,context:ordered.slice(Math.max(0,i-3),i+4).map(x=>x.text).join(' ')});
        }
    } finally {fs.closeSync(fd);}
    return result;
}
module.exports={PROMPT,VERSION,isFiller,candidates};
