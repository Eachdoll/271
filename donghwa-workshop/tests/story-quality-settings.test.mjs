import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configureStoryQualityUI,renderStoryQualitySettings,renderQualityPatternSelector,validateQualityPatternCards,storyQualityBookRecords,checkDueQualityCoach,cleanupStoryQualityUI} from '../dist/story-generation/quality-settings.js';
import {renderStoryQualityPlan,renderStoryChildGate} from '../dist/story-generation/ui.js';

const plotPatterns=JSON.parse(await readFile(new URL('../dist/story-quality/data/plot_patterns.json',import.meta.url),'utf8'));
const qualityData={plotPatterns,inventories:{twistTypes:[{id:'wind',ko:'바람의 비밀'}]}};
const originalDocument=globalThis.document,handlers={};let state={settings:{storyQuality:{}}},saves=0,engines=0,renders=0,toasts=[];
const status={textContent:''};
globalThis.document={addEventListener:(type,handler)=>{handlers[type]=handler;},querySelector:selector=>selector==='#quality-coach-status'?status:null,querySelectorAll:()=>[]};
configureStoryQualityUI({getState:()=>state,isParent:()=>true,save:()=>{saves++;return true;},render:()=>{renders++;},toast:value=>{toasts.push(value);},getEngine:async()=>{engines++;throw Error('Engine should not be needed');},qualityData,isSettings:()=>false});

function record(index){return {bookId:`book-${index}`,approved:true,createdAt:new Date(Date.now()-index*86400000).toISOString(),topic:'바람',patternId:plotPatterns[index%6].id,outline:{beats:[{index:1,summary:'유하가 집에서 시작해요.'}]},usedElements:{planted:`물건 ${index}`,creatures:[`생물 ${index}`],twistTypeId:'wind',patternId:plotPatterns[index%6].id,places:[`자리 ${index}`]}};}

test('parent quality panel exposes six structural cards, stage roles and safe default toggles',()=>{
 const html=renderStoryQualitySettings(state),selector=renderQualityPatternSelector({storyQualityPatternId:'waiting'},{state});
 assert.match(html,/data-quality-flag="enabled" checked/);assert.match(html,/data-quality-flag="useBeamSearch">/);for(const flag of ['twoPass','childSimulator','weeklyCoach'])assert.match(html,new RegExp(`data-quality-flag="${flag}" checked`));
 for(const role of ['outline','prose','cheap','coach'])assert.ok(html.includes(`data-quality-role-engine="${role}"`));
 assert.match(html,/패턴 카드 편집 · 6종/);assert.match(selector,/value="waiting" selected/);assert.match(selector,/value="mystery_sound"/);
 assert.doesNotMatch(html,/data-quality-pattern-field="(?:bookTitle|text|characters|author)"/);assert.match(html,/창을 닫은 동안에는 실행하지 않으며 API 요금/);
 assert.equal(validateQualityPatternCards(plotPatterns).valid,true);
 const bad=structuredClone(plotPatterns);bad[0].bookTitle='레퍼런스 본문';assert.equal(validateQualityPatternCards(bad).valid,false);bad[0]=structuredClone(plotPatterns[0]);bad[0].beats[1].text='책의 실제 문장';assert.equal(validateQualityPatternCards(bad).valid,false);
});

test('reference card edits and coach evidence remain escaped and show only allowed structural fields',()=>{
 const custom=structuredClone(plotPatterns);custom[0].name='<script>bad</script>';state={settings:{storyQuality:{patterns:custom,coachProposal:{proposedRules:[{text:'<img src=x onerror=bad>',why:'이유',replaces:null}],proposedBanExamples:[],recurringWeaknesses:[{pattern:'반복',evidence:'<script>bad</script>'}]}}}};
 const html=renderStoryQualitySettings(state);assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/data-quality-coach-rule="0"/);assert.match(html,/선택한 제안 승인/);
});

test('repeat-material view uses configured book and pattern windows with approved records only',()=>{
 state={settings:{storyQuality:{approvedBooks:Array.from({length:8},(_,i)=>record(i)),banWindow:2,patternBanWindow:1}},books:[{approved:false,id:'unapproved',outline:{beats:[]}}]};
 const html=renderStoryQualitySettings(state);assert.match(html,/최근 2권 \/ 패턴 1권/);assert.match(html,/물건 0/);assert.match(html,/물건 1/);assert.doesNotMatch(html,/물건 2/);assert.equal(storyQualityBookRecords(state).length,8);
});

test('weekly due check skips fewer than three books without resolving an engine or disrupting the current wizard',async()=>{
 state={settings:{storyQuality:{approvedBooks:[record(0),record(1)]}}};saves=0;engines=0;renders=0;await checkDueQualityCoach();assert.equal(engines,0);assert.equal(renders,0);assert.ok(saves>0);assert.match(state.settings.storyQuality.coachLastResult.skipped,/3개 미만/);
 const before=saves;await checkDueQualityCoach();assert.equal(saves,before);assert.equal(engines,0);
});

test('no coach proposal is applied merely by viewing it or clicking approval without a selection',()=>{
 state={settings:{storyQuality:{rules:['기존 규칙'],banExamples:[],coachProposal:{id:'coach-test',basis:JSON.stringify({rules:['기존 규칙'],banExamples:[]}),proposedRules:[{text:'새 규칙',why:'근거',replaces:null}],proposedBanExamples:[]}}}};
 renderStoryQualitySettings(state);handlers.click({target:{closest:()=>({dataset:{qualityAction:'approve-coach'}})},preventDefault:()=>{}});assert.deepEqual(state.settings.storyQuality.rules,['기존 규칙']);assert.equal(state.settings.storyQuality.ruleVersions,undefined);assert.match(toasts.at(-1),/먼저 골라/);
});

test('seed chips and folded writer plan stay separate from printable prose; simulator is labelled as a model estimate',()=>{
 const html=renderStoryQualityPlan({outline:{quality:{seedSummary:'작은 통 · 바람의 비밀 · 달팽이'},plan:{pattern:'mystery_sound',planted:'작은 통',twistReveal:'바람이 통을 울려요.',funnyMoment:'통이 데굴데굴',failureReasons:['wrong_method']}}});
 assert.match(html,/심은 물건 · 작은 통/);assert.match(html,/data-story-action="reroll-quality-seed"/);assert.match(html,/<details class="quality-plan">/);assert.match(html,/방법이 맞지 않음/);
 const report=renderStoryChildGate({pass:true,curiosity:{overall:8},retell:{retell:['유하가 소리를 찾아요.','유하가 통을 살펴봐요.','유하가 직접 소리를 내요.'],missingCore:[]}});assert.match(report,/모의검사/);assert.match(report,/실제 아이의 평가나 공식 읽기 점수가 아닙니다/);assert.match(report,/약 8\/10/);
});

test.after(()=>{cleanupStoryQualityUI();globalThis.document=originalDocument;});
