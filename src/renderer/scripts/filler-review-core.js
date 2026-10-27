(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;if(root)root.FillerReviewCore=api;})(typeof window==='undefined'?null:window,()=>{
    function map(transcripts,segments,source){
        const result=[];let elapsed=0;
        for(const segment of segments){
            const speed=segment.speed||1,duration=(segment.end-segment.start)/speed;
            const transcript=transcripts.find(t=>t.sourcePath===(segment.sourceFile||source));
            for(const candidate of transcript?.fillers||[]){
                if(!Number.isFinite(candidate.start)||!Number.isFinite(candidate.end)||candidate.end<=candidate.start
                    ||candidate.start<segment.start||candidate.end>segment.end)continue;
                result.push({...candidate,start:elapsed+(candidate.start-segment.start)/speed,end:elapsed+(candidate.end-segment.start)/speed,
                    lower:elapsed,upper:elapsed+duration,approved:candidate.highConfidence===true});
            }elapsed+=duration;
        }return result.sort((a,b)=>a.start-b.start);
    }
    function ranges(items){
        const result=[];
        for(const item of items.filter(x=>x.approved).sort((a,b)=>a.start-b.start)){
            if(!Number.isFinite(item.start)||!Number.isFinite(item.end)||item.start<item.lower||item.end>item.upper||item.end<=item.start)throw Error('invalid_range');
            const last=result.at(-1);if(last&&item.start<=last.end)last.end=Math.max(last.end,item.end);else result.push({start:item.start,end:item.end});
        }return result;
    }
    return {map,ranges};
});
