import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {splitSentences,analyzeEstimatedPage} from '../dist/reading-checker.js';
import {getLevelSpec} from '../dist/reading-levels.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
const cases=JSON.parse(readFileSync(new URL('../story-quality/test/fixtures/sentence-cases.json',import.meta.url),'utf8'));

test('R8-2 app uses shared quote-aware sentence cases and drops zero-word fragments for old snapshots too',()=>{
 for(const item of cases) assert.deepEqual(splitSentences(item.text),item.sentences,item.text);
 const legacy=JSON.parse(readFileSync(new URL('./fixtures/reading-r6.json',import.meta.url),'utf8'));
 const result=analyzeEstimatedPage('“I see a ball.”',legacy.E0,{language:'en'});
 assert.equal(result.metrics.sentenceCount,1);assert.ok(result.metrics.wordsPerSentence.every(count=>count>0));
});
test('R8-3 sound-only interjections skip only early-level minimum length, not page counts or maximums',()=>{
 for(const id of ['K1','K2']) for(const sound of ['톡, 톡, 톡.','딸꾹!','와!','딸꾹 딸꾹!','톡톡!','쨍쨍!']) {
  const report=analyzeEstimatedPage(sound,getLevelSpec(id),{language:'ko'});
  assert.ok(!report.violations.some(v=>v.code==='sentence-length'&&v.actual<v.expected.min),id+sound);
  assert.equal(report.metrics.sentenceCount,1);
 }
 for(const id of ['E0','E1']) for(const sound of ['Whoosh!','Oh, wow!','Yay!']) {
  const report=analyzeEstimatedPage(sound,getLevelSpec(id),{language:'en'});
  assert.ok(!report.violations.some(v=>v.code==='sentence-length'),id+sound);
 }
 assert.ok(analyzeEstimatedPage('유하가 가요.',getLevelSpec('K1'),{language:'ko'}).violations.some(v=>v.code==='sentence-length'));
 assert.ok(analyzeEstimatedPage('딸꾹!',getLevelSpec('K3'),{language:'ko'}).violations.some(v=>v.code==='sentence-length'));
 assert.ok(analyzeEstimatedPage('Oh!',getLevelSpec('E2'),{language:'en'}).violations.some(v=>v.code==='sentence-length'));
 const maximum=analyzeEstimatedPage('톡 톡 톡 톡 톡 톡.',getLevelSpec('K1'),{language:'ko'});assert.ok(maximum.violations.some(v=>v.code==='sentence-length'&&v.actual>v.expected.max));
 const page=analyzeEstimatedPage('와! 와! 와! 와!',getLevelSpec('K1'),{language:'ko'});assert.ok(page.violations.some(v=>v.code==='sentence-count'));
});
test('R8-4 present adjectives and reed nouns avoid grammar false positives while active past remains blocked',()=>{
 const spec=getLevelSpec('E0'),grammar=text=>analyzeEstimatedPage(text,spec,{language:'en',allowedNames:['Yuha','Choroki']}).violations.filter(v=>v.code==='grammar');
 for(const text of ['Yuha is tired.','The door is closed.','Choroki is so excited!','Yuha looks scared.','Yuha feels very tired.','Yuha seems too excited.','Yuha is not tired.','Yuha walks home, slow and tired.','I see a reed here.','I see a sled here.','I see a shed here.','I feed a bird here.']) assert.deepEqual(grammar(text),[],text);
 for(const text of ['Yuha said hi.','They went home.','Yuha closed the door.','Yuha jumped and closed the door.','Yuha is tired. They went home.','They were very tired.','Yuha very shouted at the door.']) assert.ok(grammar(text).length,text);
});
test('R8-1 normalizing a legacy input does not infer or add a new compression policy',()=>{
 const input={characters:[{id:'yuha',name:'유하'}],specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')}};
 assert.equal(Object.hasOwn(normalizeStoryInput(input),'prosePolicy'),false);
 const fixed={...input,prosePolicy:{version:1,condenseOverBudget:{ko:true,en:false}}};
 assert.deepEqual(normalizeStoryInput(JSON.parse(JSON.stringify(fixed))).prosePolicy,fixed.prosePolicy);
});
