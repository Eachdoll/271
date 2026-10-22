// Offline only: inspect the saved paid run using the same reading spec as the app.
import fs from 'node:fs';
import {inspectStory} from '../../../dist/story-generation/pipeline.js';
import {pageReadingSpec} from '../../../dist/story-generation/checker.js';
import {buildStoryWords} from '../../../dist/story-reading-context.js';
import {analyzeEstimatedPage,splitSentences} from '../../../dist/reading-checker.js';
const folder=new URL('../',import.meta.url);
const read=n=>JSON.parse(fs.readFileSync(new URL(n,folder),'utf8'));
const j=read('K2-diet.json'),old=read('../r31d-ab/K2-diet.json'),pages=j.pagination?.pages||[],input=j.input||{};
const names=(input.characters||[]).flatMap(c=>[c.name,c.nameEn]).filter(Boolean),storyWords=buildStoryWords(input,j.outline,[],{briefs:j.sceneBriefs,lean:true});
const perPage=pages.map(p=>{
 const row={entryNo:p.pageNo,kind:p.kind};
 for(const language of ['ko','en']){
  const r=analyzeEstimatedPage(p[language==='ko'?'textKo':'textEn']||'',pageReadingSpec(input.specs,language,p,{lean:true}),{language,allowedNames:names,storyWords});
  row[language]={metrics:r.metrics,violations:r.violations,warnings:r.warnings};
 }
 return row;
});
const writerRetries=language=>Object.entries(j.writerReport?.attemptLog||{}).filter(([key])=>key.startsWith(language+':')).flatMap(([key,rows])=>rows.filter(a=>a.retry).map(a=>({key,...a})));
const weather=run=>(run.pagination?.pages||[]).flatMap(p=>splitSentences(p.textKo||'').filter(text=>/햇살|햇빛|바람|꽃|나비/u.test(text)).map(text=>({entryNo:p.pageNo,text})));
const enText=pages.map(p=>p.textEn||'').join(' '),norm=t=>String(t||'').normalize('NFC').replace(/\s+/gu,' ').trim();
const before=(language,beat)=>String(j.writerOriginal?.[language]||'').split(/\n\s*\n/u).map((text,i)=>({text,index:j.writerOriginal?.paragraphBeats?.[language]?.[i]??j.outline?.beats?.[i]?.index??i+1})).filter(r=>r.index===beat).map(r=>r.text).join(' ');
const comparison=(j.outline?.beats||[]).map(beat=>{
 const rows=pages.filter(p=>p.beatIndex===beat.index),koBefore=before('ko',beat.index),enBefore=before('en',beat.index),koAfter=rows.map(p=>p.textKo).join(' '),enAfter=rows.map(p=>p.textEn).join(' ');
 return {beatIndex:beat.index,entryNos:rows.map(p=>p.pageNo),koBefore,koAfter,enBefore,enAfter,koChanged:norm(koBefore)!==norm(koAfter),enChanged:norm(enBefore)!==norm(enAfter)};
});
const calls=j.usage?.calls||[];if(new Set(calls.map(c=>c.callId)).size!==calls.length)throw Error('Duplicate usage IDs');
const sum=Object.values(j.usageSummary.stages).reduce((n,r)=>n+r.costUsd,0);if(Math.abs(sum-j.usageSummary.costUsd)>1e-8)throw Error('Usage cost sum mismatch');
const paginationMeta=calls.filter(c=>c.stage==='pagination').map(c=>({repairAttempts:c.repairAttempts,repairRequestCount:c.repairRequestCount,repairBudget:c.repairBudget,richnessRepairAttempts:c.richnessRepairAttempts,coherence:c.coherence,revision:c.revision}));
const history=j.repairHistory||[];
const transitions=history.slice(1).map((next,i)=>{
 const prior=history[i],changes=[];
 for(const b of prior.texts||[]){const a=(next.texts||[]).find(t=>t.pageNo===b.pageNo);if(a&&(norm(a.ko)!==norm(b.ko)||norm(a.en)!==norm(b.en)))changes.push({pageNo:b.pageNo,koBefore:b.ko,koAfter:a.ko,enBefore:b.en,enAfter:a.en,koChanged:norm(b.ko)!==norm(a.ko),enChanged:norm(b.en)!==norm(a.en),priorViolations:(prior.violations||[]).filter(v=>v.pageNo===b.pageNo)});}
 return {fromRequests:prior.requests,toRequests:next.requests,stage:next.stage,changes};
});
const s={date:'2026-10-22',source:'2b1ccf3',checkoutSource:'66923d3',topic:input.topic,levels:{ko:input.specs?.ko?.id,en:input.specs?.en?.id},complete:j.status==='text-review'&&!j.error,status:j.status,error:j.error,seconds:j.seconds,entries:pages.length,printedPages:pages.reduce((n,p)=>n+(p.kind==='spread'?2:1),0),paidImages:0,usage:j.usageSummary,writerAttempts:j.writerReport?.attempts,writerAttemptLog:j.writerReport?.attemptLog,writerEnglishRetryCount:writerRetries('en').length,writerKoreanRetryCount:writerRetries('ko').length,writerEnglishRetries:writerRetries('en'),writerReport:j.writerReport,canonicalPageChecks:perPage,bookCheck:pages.length?inspectStory(j.outline,j.pagination,input):null,rawRunnerMeasured:j.measured,rawAndAppIssueCountsMatch:j.measured?.totals?.koIssuePages===perPage.filter(p=>p.ko.violations.length).length&&j.measured?.totals?.enIssuePages===perPage.filter(p=>p.en.violations.length).length,englishSearch:{semicolons:(enText.match(/;/gu)||[]).length,outByTheSide:(enText.match(/out by the side/giu)||[]).length,rag:(enText.match(/\brag\b/giu)||[]).length,wasDown:(enText.match(/\bwas\s+down\b/giu)||[]).length},weatherKeywordSentences:{pattern:'햇살|햇빛|바람|꽃|나비',current:weather(j),baselineR31D:weather(old),limitation:'Keyword screening, not a semantic judgment of redundant description.'},dialogue:{writerKoreanShare:j.writerReport?.dialogue_ko,writerEnglishShare:j.writerReport?.dialogue_en,measuredKoreanQuoteSentences:j.measured?.totals?.quotes,measuredKoreanSentences:j.measured?.totals?.sentences},paginationMeta,repairHistory:history,repairTransitions:transitions,repairViolationCount:history.reduce((n,h)=>n+h.violations.length,0),outlineRepairProgressCount:(j.progress||[]).filter(text=>/주제·등장인물·장소를 맞춰 줄거리를 다시/u.test(text)).length,repairRecordHasLanguageMessageAndTexts:history.every(h=>Array.isArray(h.texts)&&h.violations.every(v=>typeof v==='object'&&'language'in v&&'message'in v)),outlineRepairs:j.outlineRepairs||[],hasPlotContract:!!j.outline?.plotContract,proseCoherence:j.proseCoherence,pageCoherence:j.pageCoherence,revision:j.revision,originalComparison:comparison,baselineR31D:{costUsd:old.usageSummary.costUsd,requests:old.usageSummary.requests,seconds:old.seconds,writerEnglishRetryCount:9,pageRepairRequests:2,writerKoreanDialogue:old.writerReport?.dialogue_ko,writerEnglishDialogue:old.writerReport?.dialogue_en,measured:old.measured?.totals},limitations:['One independently sampled story per version; different material plans and model randomness.','Token usage multiplied by catalogue rates is not the provider invoice.','writerOriginal is the writer-stage return, after any internal retries.','Weather keyword counts and quoted-sentence shares are screening metrics, not human quality scores.','No illustrations or real-child comprehension study.']};
fs.writeFileSync(new URL('SUMMARY.json',folder),JSON.stringify(s,null,2)+'\n');
const cell=t=>norm(t).replace(/\|/gu,'\\|');const lines=['# R31e 작가 원문·최종 원고 비교','','공백만 정규화해 같은 비트의 최종 엔트리를 합쳐 비교했습니다.',''];
for(const r of comparison)lines.push(`## ${r.beatIndex}비트 · 엔트리 ${r.entryNos.join(', ')}`,'','| 언어 | 작가 원문 | 최종 | 변경 |','| --- | --- | --- | --- |',`| 한글 | ${cell(r.koBefore)} | ${cell(r.koAfter)} | ${r.koChanged?'있음':'없음'} |`,`| 영어 | ${cell(r.enBefore)} | ${cell(r.enAfter)} | ${r.enChanged?'있음':'없음'} |`,'');
fs.writeFileSync(new URL('ORIGINAL_VS_FINAL.md',folder),lines.join('\n'));
console.log(JSON.stringify({complete:s.complete,status:s.status,costUsd:s.usage.costUsd,requests:s.usage.requests,seconds:s.seconds,printedPages:s.printedPages,englishRetries:s.writerEnglishRetryCount,koreanRetries:s.writerKoreanRetryCount,englishSearch:s.englishSearch,weatherSentences:s.weatherKeywordSentences.current.length,baselineWeatherSentences:s.weatherKeywordSentences.baselineR31D.length,dialogue:s.dialogue,bookPassed:s.bookCheck?.passed,rawAndAppIssueCountsMatch:s.rawAndAppIssueCountsMatch,paginationMeta:s.paginationMeta.map(({coherence,revision,...rest})=>rest)}));
