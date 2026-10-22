// Offline analysis of the approved one-book R31D paid test. No provider calls or keys.
import fs from 'node:fs';
import {inspectStory} from '../../../dist/story-generation/pipeline.js';
import {buildStoryWords} from '../../../dist/story-reading-context.js';
import {unitSpec,unitKind} from '../../../dist/book-layout.js';
import {analyzeEstimatedPage} from '../../../dist/reading-checker.js';
const folder=new URL('../',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,folder),'utf8'));
const j=read('K2-diet.json'), old=read('../r31c-ab/K2-diet.json');
const pages=j.pagination?.pages||[], input=j.input||{};
const words=buildStoryWords(input,j.outline,[],{briefs:j.sceneBriefs,lean:true});
const names=(input.characters||[]).flatMap(c=>[c.name,c.nameEn]).filter(Boolean);
const perPage=pages.map(p=>{
 const results={};
 for(const lang of ['ko','en']){
  let spec=unitSpec(input.specs[lang],unitKind(p));
  if(lang==='en')spec={...spec,storyWordsAllowed:true,inflections:true};
  const c=analyzeEstimatedPage(p[lang==='ko'?'textKo':'textEn']||'',spec,{language:lang,allowedNames:names,storyWords:words});
  results[lang]={metrics:c.metrics,violations:c.violations,warnings:c.warnings};
 }
 return {entryNo:p.pageNo,kind:p.kind,...results};
});
const calls=j.usage?.calls||[];
if(new Set(calls.map(c=>c.callId)).size!==calls.length)throw Error('Duplicate ledger call IDs');
const stageCost=Object.values(j.usageSummary.stages).reduce((n,s)=>n+s.costUsd,0);
if(Math.abs(stageCost-j.usageSummary.costUsd)>1e-8)throw Error('Cost ledger mismatch');
const norm=t=>String(t||'').normalize('NFC').replace(/\s+/gu,' ').trim();
const before=(lang,b)=>String(j.writerOriginal?.[lang]||'').split(/\n\s*\n/u).map((text,i)=>({text,index:j.writerOriginal?.paragraphBeats?.[lang]?.[i]??j.outline?.beats?.[i]?.index??i+1})).filter(r=>r.index===b).map(r=>r.text).join(' ');
const compare=(j.outline?.beats||[]).map(b=>{
 const rows=pages.filter(p=>p.beatIndex===b.index);const koBefore=before('ko',b.index),enBefore=before('en',b.index),koAfter=rows.map(p=>p.textKo).join(' '),enAfter=rows.map(p=>p.textEn).join(' ');
 return {beatIndex:b.index,entryNos:rows.map(p=>p.pageNo),koBefore,koAfter,enBefore,enAfter,koChanged:norm(koBefore)!==norm(koAfter),enChanged:norm(enBefore)!==norm(enAfter)};
});
const en=pages.map(p=>p.textEn||'').join(' ');
const seatbelt=t=>/안전띠|안전벨트|좌석벨트/u.test(t||'');
const paginationCalls=calls.filter(c=>c.stage==='pagination');
const writerRetries=language=>Object.entries(j.writerReport?.attempts||{}).filter(([key])=>key.startsWith(language+':')).reduce((n,[key,count])=>n+Math.max(0,count-1),0);
const s={date:'2026-10-22',source:'4b42288',checkoutSource:'d6eb9cf',topic:input.topic,levels:{ko:input.specs?.ko?.id,en:input.specs?.en?.id},status:j.status,error:j.error,complete:j.status==='text-review'&&!j.error,seconds:j.seconds,entries:pages.length,printedPages:pages.reduce((n,p)=>n+(p.kind==='spread'?2:1),0),usage:j.usageSummary,paidImages:0,canonicalPageChecks:perPage,fullBookCheck:pages.length?inspectStory(j.outline,j.pagination,input):null,storyWords:words,originalComparison:compare,englishSearch:{rag:(en.match(/\brag\b/giu)||[]).length,wasDown:(en.match(/\bwas\s+down\b/giu)||[]).length,handkerchief:(en.match(/\bhandkerchief\b/giu)||[]).length},seatbeltMentions:{finalEntries:pages.filter(p=>seatbelt(p.textKo)).map(p=>p.pageNo),writerBeats:compare.filter(r=>seatbelt(r.koBefore)).map(r=>r.beatIndex),baselineR31CEntries:(old.pagination?.pages||[]).filter(p=>seatbelt(p.textKo)).map(p=>p.pageNo),note:'Term occurrence is a screening measure, not proof of redundant state narration. Read the text in context.'},writerStageExtraAttempts:{ko:writerRetries('ko'),en:writerRetries('en')},rawRunnerMeasured:j.measured?.totals,paginationRepairMeta:paginationCalls.map(c=>({repairAttempts:c.repairAttempts,repairRequestCount:c.repairRequestCount,repairBudget:c.repairBudget,richnessRepairAttempts:c.richnessRepairAttempts,checks:c.checks,revision:c.revision})),repairHistory:j.repairHistory,progress:j.progress,writerReport:j.writerReport,revision:j.revision,pageCoherence:j.pageCoherence,baselineR31C:{costUsd:old.usageSummary.costUsd,requests:old.usageSummary.requests,seconds:old.seconds,englishLevelRewrites:6,remainingEnglishFlags:3},limitations:['One independently sampled story per version, with independently generated materials; not a controlled statistical comparison.','Token usage multiplied by catalogue rates is not the provider invoice.','writerOriginal is the writer-stage return; it can already include writer-stage fixes.','Repair history omits violation language; do not infer an exact English-only count from page repair totals unless there were no page repairs.','No paid images or real-child comprehension study.']};
fs.writeFileSync(new URL('SUMMARY.json',folder),JSON.stringify(s,null,2)+'\n');
const cell=t=>norm(t).replace(/\|/gu,'\\|');
const lines=['# R31d 작가 원문과 최종 원고','','쪽 나누기 전 비트 문단과 같은 비트의 최종 쪽들을 합쳐 비교했습니다. 공백만 정규화합니다.',''];
for(const r of compare)lines.push(`## ${r.beatIndex}비트 · 엔트리 ${r.entryNos.join(', ')}`,'','| 언어 | 작가 원문 | 최종 | 변경 |','| --- | --- | --- | --- |',`| 한글 | ${cell(r.koBefore)} | ${cell(r.koAfter)} | ${r.koChanged?'있음':'없음'} |`,`| 영어 | ${cell(r.enBefore)} | ${cell(r.enAfter)} | ${r.enChanged?'있음':'없음'} |`,'');
fs.writeFileSync(new URL('ORIGINAL_VS_FINAL.md',folder),lines.join('\n'));
console.log(JSON.stringify({complete:s.complete,status:s.status,costUsd:s.usage.costUsd,requests:s.usage.requests,seconds:s.seconds,printedPages:s.printedPages,englishIssueEntries:perPage.filter(p=>p.en.violations.length).length,koIssueEntries:perPage.filter(p=>p.ko.violations.length).length,englishSearch:s.englishSearch,seatbeltMentions:s.seatbeltMentions,repairs:s.paginationRepairMeta.map(r=>({repairAttempts:r.repairAttempts,repairRequestCount:r.repairRequestCount,budget:r.repairBudget})),bookPassed:s.fullBookCheck?.passed}));
