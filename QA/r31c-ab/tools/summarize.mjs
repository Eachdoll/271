#!/usr/bin/env node
// Offline analysis only. Reads saved manuscripts; never calls a provider or reads a key.
import {readFileSync,writeFileSync} from 'node:fs';
import {inspectStory} from '../../../dist/story-generation/pipeline.js';
import {unitSpec,unitKind} from '../../../dist/book-layout.js';
import {analyzeEstimatedPage} from '../../../dist/reading-checker.js';
import {describeReadingViolation} from '../../../dist/reading-messages.js';
import {buildStoryWords} from '../../../dist/story-reading-context.js';
const folder=new URL('../',import.meta.url);
const read=(name)=>JSON.parse(readFileSync(new URL(name,folder),'utf8'));
const normalize=(text)=>String(text||'').normalize('NFC').replace(/\s+/gu,' ').trim();
const cell=(text)=>normalize(text).replace(/\|/gu,'\\|');
const originalDiff=(run)=>{
 const original=run.writerOriginal||{},pages=run.pagination?.pages||[];
 if(original.pages?.length){
  const rows=original.pages.map(source=>{
   const final=pages.find(page=>page.pageNo===source.pageNo)||{};
   return {pageNo:source.pageNo,koBefore:source.ko,koAfter:final.textKo,enBefore:source.en,enAfter:final.textEn,koChanged:normalize(source.ko)!==normalize(final.textKo),enChanged:normalize(source.en)!==normalize(final.textEn)};
  });
  return {unit:'page',rows,koChanged:rows.filter(row=>row.koChanged).map(row=>row.pageNo),enChanged:rows.filter(row=>row.enChanged).map(row=>row.pageNo),anyChanged:rows.filter(row=>row.koChanged||row.enChanged).map(row=>row.pageNo)};
 }
 const beats=run.outline?.beats||[];
 const before=(lang,index)=>String(original[lang]||'').split(/\n\s*\n/u).map((text,i)=>({text,index:original.paragraphBeats?.[lang]?.[i]??beats[i]?.index??i+1})).filter(row=>row.index===index).map(row=>row.text).join(' ');
 const rows=beats.map(beat=>{
  const entries=pages.filter(page=>page.beatIndex===beat.index),koBefore=before('ko',beat.index),enBefore=before('en',beat.index),koAfter=entries.map(page=>page.textKo).join(' '),enAfter=entries.map(page=>page.textEn).join(' ');
  return {beatIndex:beat.index,entryNos:entries.map(page=>page.pageNo),koBefore,koAfter,enBefore,enAfter,koChanged:normalize(koBefore)!==normalize(koAfter),enChanged:normalize(enBefore)!==normalize(enAfter)};
 });
 return {unit:'beat',limitation:'The writer produced beat paragraphs before pagination, so changed printed-page counts cannot be inferred. Compare the same beat with its final entries instead.',rows,koChanged:rows.filter(row=>row.koChanged).map(row=>row.beatIndex),enChanged:rows.filter(row=>row.enChanged).map(row=>row.beatIndex),anyChanged:rows.filter(row=>row.koChanged||row.enChanged).map(row=>row.beatIndex)};
};
const runs=[];
for(const level of ['K1','K2']){
 const current=read(`${level}-diet.json`),baseline=read(`../r31b-ab/${level}-diet.json`),input=current.input||{},pages=current.pagination?.pages||[];
 const allowedNames=(input.characters||[]).flatMap(c=>[c.name,c.nameEn]).filter(Boolean),storyWords=buildStoryWords(input,current.outline);
 const pageChecks=pages.map(page=>{
  const check=language=>{
   let spec=unitSpec(input.specs[language],unitKind(page));
   if(language==='en'&&input.promptDiet?.version===1&&!spec.storyWordsAllowed)spec={...spec,storyWordsAllowed:true};
   return analyzeEstimatedPage(page[language==='ko'?'textKo':'textEn']||'',spec,{language,allowedNames,storyWords});
  };
  const ko=check('ko'),en=check('en');
  return {pageNo:page.pageNo,kind:unitKind(page),koIssues:ko.violations.map(describeReadingViolation),enIssues:en.violations.map(describeReadingViolation),koWarnings:ko.warnings,enWarnings:en.warnings};
 });
 const printedPages=pages.reduce((sum,page)=>sum+(page.kind==='spread'?2:1),0),calls=current.usage?.calls||[];
 if(new Set(calls.map(row=>row.callId)).size!==calls.length)throw Error(`${level}: duplicate usage call IDs`);
 const stageCost=Object.values(current.usageSummary.stages).reduce((sum,row)=>sum+row.costUsd,0);
 if(Math.abs(stageCost-current.usageSummary.costUsd)>1e-8)throw Error(`${level}: ledger cost mismatch`);
 if(current.status==='text-review'&&!current.error&&printedPages!==12)throw Error(`${level}: unexpected printed page count`);
 const history=current.repairHistory||[],enText=pages.map(page=>page.textEn||'').join(' ');
 const checks=pages.length?inspectStory(current.outline,current.pagination,input):null;
 const original=originalDiff(current);
 const writerCache=current.writerCheckpoint||calls.find(row=>row.stage==='prose'&&row.writerCheckpoint)?.writerCheckpoint;
 let firstWriterPages=null;
 for(const cached of Object.values(writerCache?.completed||{})){
  let value=cached.response?.json;
  if(!value){try{value=JSON.parse(cached.response?.text||'');}catch{continue;}}
  if(value?.pages?.length===12){firstWriterPages=value.pages;break;}
 }
 const initialWriterComparison=firstWriterPages?originalDiff({...current,writerOriginal:{pages:firstWriterPages}}):null;
 runs.push({level,englishLevel:input.specs?.en?.id,status:current.status,error:current.error,workflowComplete:current.status==='text-review'&&!current.error,seconds:current.seconds,printedPages,entries:pages.length,rawRunnerMeasured:current.measured.totals,canonicalPageChecks:pageChecks,canonicalIssueEntries:{ko:pageChecks.filter(page=>page.koIssues.length).length,en:pageChecks.filter(page=>page.enIssues.length).length},fullBookChecks:checks,usage:current.usageSummary,originalComparison:original,initialWriterComparison,sceneTimes:pages.map(page=>({entryNo:page.pageNo,beatIndex:page.beatIndex,timeOfDay:page.scene?.timeOfDay,action:page.scene?.action,lightMood:page.staging?.lightMood})),ending:pages.slice(-2).map(page=>({entryNo:page.pageNo,ko:page.textKo,en:page.textEn,scene:page.scene})),repairHistory:history,repairViolationTypes:[...new Set(history.flatMap(row=>row.violations||[]).map(value=>value.split('@')[0]))],richnessRepairMessages:(current.progress||[]).filter(message=>/쪽의 글 디테일/u.test(message)),revision:current.revision||null,childGate:calls.filter(row=>row.childGate).at(-1)?.childGate||null,writerReport:current.writerReport||null,pageCoherence:current.pageCoherence||null,storyWords,outlineNewWordsEn:current.outline?.newWordsEn||[],englishWordSearch:{rag:(enText.match(/\brag\b/giu)||[]).length,handkerchief:(enText.match(/\bhandkerchief\b/giu)||[]).length,hanky:(enText.match(/\bhanky\b/giu)||[]).length},characters:(input.characters||[]).map(({id,name,nameEn})=>({id,name,nameEn})),backgrounds:(input.backgrounds||[]).map(({id,name})=>({id,name})),baseline:{source:'r31b paid diet manuscript',usage:baseline.usageSummary,costUsd:baseline.usageSummary.costUsd,requests:baseline.usageSummary.requests,seconds:baseline.seconds,measured:baseline.measured.totals,originalChecksPassed:baseline.storyCheck?.passed,costReductionPercent:100*(1-current.usageSummary.costUsd/baseline.usageSummary.costUsd)}});
}
const summary={date:'2026-10-22',timezone:'Asia/Seoul',runtimeSource:'9cd6594',checkoutSource:'ca351b5bd9e9b5f15dba48c3ea471f3d21539897',topic:read('K1-diet.json').input.topic,paidImages:0,completed:runs.filter(run=>run.workflowComplete).length,totalCostUsdFromTokens:runs.reduce((sum,run)=>sum+run.usage.costUsd,0),totalRequests:runs.reduce((sum,run)=>sum+run.usage.requests,0),costMethod:'Reported provider token usage multiplied by the app price catalogue, not the provider invoice.',limitations:['One new story per level; independent automatic material plans and model sampling differ from the r31b baseline.','R31c changes which checks are advisory. Compare violations and texts, not just overall pass rates.','Canonical page checks use the story words and spread unit range, which the raw runner does not fully pass to its page analyzer. Raw JSON and reports are retained unchanged.','writerOriginal is the generateProse return snapshot; it can already include the writer stage own level fix. For K1 the first cached twelve-page response is compared separately in initialWriterComparison. K2 paragraphs are compared with final entries grouped by beat, not fabricated page-level edit counts.','No paid illustrations or real-child comprehension study.'],runs};
writeFileSync(new URL('SUMMARY.json',folder),JSON.stringify(summary,null,2)+'\n');
const lines=['# R31c 원문·최종 원고 비교','','공백과 줄바꿈은 비교에서 정규화했습니다. 문장부호와 단어 차이는 변경으로 셉니다. 생성·검사 과정의 문자 차이이며, 모두 의미 수정이라고 단정하지 않습니다.',''];
for(const run of runs){
 const comparison=run.originalComparison;
 lines.push(`## ${run.level} · ${comparison.unit==='page'?'쪽별':'비트별'} 비교`,'',`한글 변경: ${comparison.koChanged.join(', ')||'없음'} / 영어 변경: ${comparison.enChanged.join(', ')||'없음'}`,'');
 if(run.initialWriterComparison)lines.push(`작가 단계 내부 수정 전 첫 12쪽 응답과 최종 비교: 한글 ${run.initialWriterComparison.koChanged.join(', ')||'변경 없음'} / 영어 ${run.initialWriterComparison.enChanged.join(', ')||'변경 없음'}. 위의 작가 원문은 작가 단계 내부 수정이 끝난 반환본입니다.`,'');
 if(comparison.limitation)lines.push('K2는 원문이 쪽 나누기 전의 비트 문단이므로 바뀐 쪽 수를 직접 계산하지 않습니다. 같은 비트의 최종 쪽들을 합쳐 비교합니다.','');
 for(const row of comparison.rows){
  lines.push(`### ${comparison.unit==='page'?`${row.pageNo}쪽`:`${row.beatIndex}비트 · 최종 엔트리 ${row.entryNos.join(', ')}`}`,'','| 언어 | 작가 원문 | 최종 | 변경 |','| --- | --- | --- | --- |',`| 한글 | ${cell(row.koBefore)} | ${cell(row.koAfter)} | ${row.koChanged?'있음':'없음'} |`,`| 영어 | ${cell(row.enBefore)} | ${cell(row.enAfter)} | ${row.enChanged?'있음':'없음'} |`,'');
 }
}
writeFileSync(new URL('ORIGINAL_VS_FINAL.md',folder),lines.join('\n').trimEnd()+'\n');

const comparisonLines=['# R31b → R31c 관측 비교','','같은 버스 요청과 읽기 단계로 조건별 한 편씩 생성한 결과입니다. 자동 재료 계획과 샘플링은 서로 다르며, 검사 기준도 r31c에서 바뀌었습니다. 평균 절감률 또는 품질 우열을 일반화할 수 없습니다.','','| 단계 | 버전 | 토큰 기준 비용 | 요청 | 실행 초 | 한글 문장(리듬) | 어절 | 대사 문장 | 영어 단어 |','| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
for(const run of runs){
 const old=run.baseline,m=old.measured,n=run.rawRunnerMeasured;
 comparisonLines.push(`| ${run.level} | r31b diet | $${old.costUsd.toFixed(6)} | ${old.requests} | ${old.seconds} | ${m.sentences} (${m.rhythm}) | ${m.eojeol} | ${m.quotes} | ${m.enWords} |`,`| ${run.level} | r31c diet | $${run.usage.costUsd.toFixed(6)} | ${run.usage.requests} | ${run.seconds} | ${n.sentences} (${n.rhythm}) | ${n.eojeol} | ${n.quotes} | ${n.enWords} |`);
}
comparisonLines.push('','새 결과의 통과 여부와 위반 상세는 SUMMARY.json의 canonicalPageChecks 및 fullBookChecks를 보세요. 원고 원본은 각 실행의 MD/JSON에 그대로 남겼습니다. R31c JSON의 writerOriginal은 작가 단계 반환 시점이며, K1 최초 응답과의 추가 비교는 initialWriterComparison입니다.','');
writeFileSync(new URL('COMPARISON.md',folder),comparisonLines.join('\n'));

console.log(JSON.stringify({completed:summary.completed,totalCostUsdFromTokens:summary.totalCostUsdFromTokens,totalRequests:summary.totalRequests,runs:runs.map(run=>({level:run.level,status:run.status,costUsd:run.usage.costUsd,printedPages:run.printedPages,canonicalIssueEntries:run.canonicalIssueEntries,bookPassed:run.fullBookChecks?.passed,changedUnit:run.originalComparison.unit,changedKo:run.originalComparison.koChanged,changedEn:run.originalComparison.enChanged,repairTypes:run.repairViolationTypes}))}));
