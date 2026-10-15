/* Explicit page allocation and parent-invoked structural editing; no generation. */
const clone=value=>JSON.parse(JSON.stringify(value));
const wordCount=text=>String(text||'').trim().split(/\s+/u).filter(Boolean).length;
function distribute(beats,total){
  if(total<beats.length)throw new Error('모든 비트를 담기에 쪽 수가 부족해요.');
  const counts=beats.map(()=>1);for(let extra=total-beats.length,i=0;extra>0;extra--,i++)counts[i%counts.length]++;
  return beats.flatMap((beat,index)=>Array.from({length:counts[index]},()=>beat.index));
}
/** One concrete page-to-beat plan, keeping the turn at two thirds and close last. */
export function buildBeatPagePlan(outline,pageCount){
  const beats=outline?.beats||[],count=Number(pageCount);
  if(!Number.isInteger(count)||count<1||count>24||!beats.length||count<beats.length)throw new Error('줄거리 비트와 목표 쪽 수를 확인해 주세요.');
  const turn=beats.findIndex(beat=>beat.type==='turn');let mapping;
  if(turn>0&&turn<beats.length){
    const before=Math.max(turn,Math.min(Math.floor(count*2/3)-1,count-(beats.length-turn)));
    mapping=[...distribute(beats.slice(0,turn),before),...distribute(beats.slice(turn),count-before)];
  }else mapping=distribute(beats,count);
  return mapping.map((beatIndex,index)=>({pageNo:index+1,beatIndex}));
}
function textParts(text,count){
  const original=String(text||'').trim();
  if(count===1)return [original];
  const sentences=original.match(/[^.!?。！？]+[.!?。！？]+[”’"']*|[^.!?。！？]+$/gu)?.map(part=>part.trim()).filter(Boolean)||[];
  const units=sentences.length>=count?sentences:original.split(/\s+/u).filter(Boolean);
  if(units.length<count)throw new Error('기존 글이 짧아 빈 쪽 없이 나눌 수 없어요. 전문을 보완하거나 AI로 쪽을 다시 나눠 주세요.');
  return Array.from({length:count},(_,index)=>units.slice(Math.floor(index*units.length/count),Math.floor((index+1)*units.length/count)).join(' '));
}
/**
 * Parent-selected 7→12 recovery. Existing edited texts are authoritative.
 * Repeated scene/cast/wardrobe data intentionally stays available for review.
 */
export function splitPaginationToCount(pagination,targetCount,{outline}={}){
  const target=Number(targetCount),pages=pagination?.pages;
  if(!Array.isArray(pages)||!pages.length||!Number.isInteger(target)||target<1||target>24)throw new Error('현재 쪽과 목표 쪽 수를 확인해 주세요.');
  if(target<pages.length)throw new Error('이 기능은 기존 글을 더 많은 쪽으로 나눠요. 쪽 수를 줄이려면 같은 비트의 쪽을 직접 합치거나 AI로 다시 나눠 주세요.');
  const capacities=pages.map(page=>Math.min(wordCount(page.textKo),wordCount(page.textEn)));
  if(capacities.some(count=>!count)||capacities.reduce((sum,count)=>sum+count,0)<target)throw new Error('기존 글이 짧아 빈 쪽 없이 나눌 수 없어요. 전문을 보완하거나 AI로 쪽을 다시 나눠 주세요.');
  const parts=pages.map(()=>1),desired=new Map();
  if(outline?.beats?.length)for(const item of buildBeatPagePlan(outline,target))desired.set(item.beatIndex,(desired.get(item.beatIndex)||0)+1);
  const existing=()=>pages.reduce((counts,page,index)=>counts.set(page.beatIndex,(counts.get(page.beatIndex)||0)+parts[index]),new Map());
  for(let remaining=target-pages.length;remaining>0;remaining--){
    const allocated=existing(),candidates=pages.map((page,index)=>({index,deficit:(desired.get(page.beatIndex)||0)-(allocated.get(page.beatIndex)||0),room:capacities[index]/parts[index]})).filter(item=>parts[item.index]<capacities[item.index]);
    candidates.sort((a,b)=>Math.max(0,b.deficit)-Math.max(0,a.deficit)||b.room-a.room||a.index-b.index);
    if(!candidates.length)throw new Error('빈 쪽 없이 목표 쪽 수로 나눌 수 없어요.');parts[candidates[0].index]++;
  }
  const result=clone(pagination);result.pages=pages.flatMap((page,index)=>{
    const ko=textParts(page.textKo,parts[index]),en=textParts(page.textEn,parts[index]);
    return ko.map((textKo,part)=>({...clone(page),textKo,textEn:en[part]}));
  });result.pages.forEach((page,index)=>page.pageNo=index+1);return result;
}
