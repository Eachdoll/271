import test from 'node:test';
import assert from 'node:assert/strict';
import {checkStory} from '../dist/story-generation/checker.js';
// These authored one-sentence fixtures represent books frozen before r7.
import {readFileSync} from 'node:fs';
const legacySpecs=JSON.parse(readFileSync(new URL('./fixtures/reading-r6.json',import.meta.url),'utf8'));
const getLevelSpec=id=>structuredClone(legacySpecs[id]);

const clone = value => JSON.parse(JSON.stringify(value));
const specs = () => ({ko:getLevelSpec('K1'), en:getLevelSpec('E0')});
function fixture() {
  const beats = ['setup','want','attempt','attempt','turn','resolution','close']
    .map((type, i) => ({index:i + 1,type,summary:`사건 ${i + 1}`}));
  const korean = ['유하가 빨간 가방을 메어요.','초록이가 숲길로 먼저 걸어요.',
    '바위가 나무 밑에 보여요.','작은 손이 돌을 두드려요.',
    '개미들이 도시락 속에서 나와요.','공룡이 바위 앞에서 재채기해요.',
    '빈 통이 틈으로 굴러가요.','바람이 통을 후우 불어요.',
    '유하가 소리를 듣고 웃어요.','둘이 나란히 노래를 만들어요.',
    '집으로 돌아가는 발걸음이 가벼워요.','포근한 이불이 아이를 덮어요.'];
  const nouns = ['ball','leaf','bird','tree','bag','moon','star','stone','shell','crab','flower','home'];
  const mapping = [1,1,2,2,3,3,4,5,5,6,6,7];
  return {outline:{beats},pagination:{pages:korean.map((textKo, i) => ({pageNo:i + 1,
    beatIndex:mapping[i],textKo,textEn:`I see a ${nouns[i]} here.`,
    scene:{action:'Yuha carries a red bag beside a tall tree.'},isRefrainPage:false}))}};
}
const rule = (result, id) => result.checks.find(check => check.id === id);
const check = ({outline,pagination}, options={}) => checkStory(outline,pagination,{specs:specs(),...options});

test('All seven checks pass distinct K1/E0 pages with a legitimate recurring English frame',()=>{
  const input=fixture(),before=clone(input),frozenSpecs=specs(),beforeSpecs=clone(frozenSpecs);
  const result=check(input,{specs:frozenSpecs});
  assert.equal(result.passed,true,JSON.stringify(result.violations));
  assert.equal(result.checks.length,7);assert.deepEqual(result.failedPageNos,[]);
  assert.equal(result.needsRepagination,false);assert.deepEqual(input,before);
  assert.deepEqual(frozenSpecs,beforeSpecs);
});

test('Korean Jaccard threshold targets the later page; English E0 duplicate content is caught',()=>{
  const input=fixture();input.pagination.pages[0].textKo='아이 토끼 공룡 가방 나무.';
  input.pagination.pages[1].textKo='아이 토끼 공룡 가방 바위.';
  let result=check(input),duplicate=rule(result,'duplicate_pages');
  assert.equal(duplicate.passed,false);assert.ok(duplicate.violations.some(v=>v.pageNo===2&&v.language==='ko'));
  assert.equal(duplicate.violations.some(v=>v.pageNo===1),false);
  const english=fixture();english.pagination.pages[3].textEn=english.pagination.pages[0].textEn;
  result=check(english);assert.ok(rule(result,'duplicate_pages').violations.some(v=>v.pageNo===4&&v.language==='en'));
});

test('A six-eojeol sentence suffix on three pages fails every affected page',()=>{
  const input=fixture(),suffix='함께 걸으며 작은 숲을 천천히 지나가요.';
  for(let i=0;i<3;i++) input.pagination.pages[i].textKo=`서로다른${i} ${suffix}`;
  const result=check(input),tail=rule(result,'repeated_suffix');
  assert.equal(tail.passed,false);assert.deepEqual(tail.violations.map(v=>v.pageNo),[1,2,3]);
});

test('Beat omissions, reversed mapping, early twist and an unfinished ending require repagination',()=>{
  const missing=fixture();for(const page of missing.pagination.pages)if(page.beatIndex===4)page.beatIndex=3;
  let result=check(missing);assert.equal(result.needsRepagination,true);
  assert.ok(rule(result,'beat_mapping').violations.some(v=>v.message.includes('4번')));
  const backwards=fixture();backwards.pagination.pages[4].beatIndex=1;
  result=check(backwards);assert.ok(rule(result,'beat_mapping').violations.some(v=>v.pageNo===5&&v.message.includes('거꾸로')));
  const early=fixture();early.pagination.pages[6].beatIndex=5;
  result=check(early);assert.ok(rule(result,'beat_mapping').violations.some(v=>v.pageNo===7&&v.message.includes('8~9')));
  const ending=fixture();ending.pagination.pages[11].beatIndex=6;
  result=check(ending);assert.ok(rule(result,'beat_mapping').violations.some(v=>v.pageNo===12&&v.message.includes('마지막')));
});

test('Page numbering and unknown beat indices cannot silently become valid pagination',()=>{
  const input=fixture();input.pagination.pages[0].pageNo=2;input.pagination.pages[4].beatIndex=99;
  const result=check(input);assert.equal(result.needsRepagination,true);
  assert.ok(rule(result,'beat_mapping').violations.some(v=>v.message.includes('쪽 번호')));
  assert.ok(rule(result,'beat_mapping').violations.some(v=>v.message.includes('없는 비트')));
  const zeroBased=fixture();zeroBased.outline.beats.forEach(beat=>beat.index--);
  zeroBased.pagination.pages.forEach(page=>page.beatIndex--);zeroBased.pagination.pages[0].beatIndex=null;
  assert.ok(rule(check(zeroBased),'beat_mapping').violations.some(v=>v.pageNo===1&&v.message.includes('없는 비트')));
});

test('Planned refrain is exempt from duplicate and suffix checks but extra and misplaced occurrences fail',()=>{
  const input=fixture(),refrain='후우 바람이 우리 사이로 살짝 다시 불어요.';
  input.outline.refrain={text:refrain,usedAtBeats:[1,3,5]};
  for(const i of [0,4,7])input.pagination.pages[i].textKo+=` ${refrain}`;
  let result=check(input);
  assert.equal(rule(result,'refrain').passed,true);
  assert.equal(rule(result,'duplicate_pages').passed,true);
  assert.equal(rule(result,'repeated_suffix').passed,true);
  input.pagination.pages[8].textKo+=` ${refrain}`;
  result=check(input);assert.ok(rule(result,'refrain').violations.some(v=>v.pageNo===9&&v.message.includes('세 번')));
  const misplaced=fixture();misplaced.outline.refrain={text:'후우 바람이 불어요.',usedAtBeats:[3,5,7]};
  misplaced.pagination.pages[0].textKo+=' 후우 바람이 불어요.';
  assert.ok(rule(check(misplaced),'refrain').violations.some(v=>v.pageNo===1&&v.message.includes('계획')));
});

test('Adjacent refrains count independently and a short refrain does not match inside a word',()=>{
  const input=fixture();input.outline.refrain={text:'바람',usedAtBeats:[1]};
  input.pagination.pages[0].textKo='바람 바람 바람 바람.';
  input.pagination.pages[1].textKo='바람개비가 길에서 쌩쌩 돌아요.';
  const result=check(input);assert.equal(rule(result,'refrain').violations.length,1);
  assert.equal(rule(result,'refrain').violations[0].pageNo,1);
});

test('Reading checks use frozen ranges and allow proper names rather than current default rules',()=>{
  const input=fixture(),frozen=specs();
  frozen.ko.wordsPerSentence={min:4,max:4};
  frozen.en.vocabList=['i','see','a','here'];frozen.en.maxOutOfVocabRatio=0;
  frozen.en.newWordsPerBook=0;
  input.pagination.readingLevelSnapshot={koreanLevel:'K4',englishLevel:'E4',specs:frozen};
  const names=['ball','leaf','bird','tree','bag','moon','star','stone','shell','crab','flower','home'];
  const result=checkStory(input.outline,input.pagination,{allowedNames:names});
  assert.equal(rule(result,'level').passed,true,JSON.stringify(rule(result,'level').violations));
  input.pagination.pages[2].textKo+=' 덜컹.';
  const failed=checkStory(input.outline,input.pagination,{allowedNames:names});
  assert.ok(rule(failed,'level').violations.some(v=>v.pageNo===3&&v.language==='ko'));
  assert.equal(frozen.ko.wordsPerSentence.max,4);
});

test('Book-wide new-word budget identifies affected pages even with permissive per-page vocabulary ratio',()=>{
  const input=fixture(),frozen=specs();frozen.en.maxOutOfVocabRatio=1;frozen.en.newWordsPerBook=1;
  input.pagination.pages[0].textEn='I see a telescope here.';
  input.pagination.pages[1].textEn='I see a microscope here.';
  const result=check(input,{specs:frozen});
  assert.ok(rule(result,'level').violations.some(v=>v.pageNo===1&&v.message.includes('새 단어 2개')));
  assert.ok(rule(result,'level').violations.some(v=>v.pageNo===2&&v.message.includes('새 단어 2개')));
});

test('Drawable scene requires 8–30 English words and an observable verb; failures target scenes only',()=>{
  const input=fixture();input.pagination.pages[0].scene.action='Yuha feels very happy and proud about the adventure.';
  input.pagination.pages[1].scene.action='Yuha jumps.';
  input.pagination.pages[2].scene.action='Yuha is carrying a small bag along the forest path.';
  input.pagination.pages[3].scene.action=`Yuha walks ${Array(30).fill('slowly').join(' ')}.`;
  const result=check(input),scene=rule(result,'drawable_scene');
  assert.ok(scene.violations.some(v=>v.pageNo===1&&v.message.includes('동작')));
  assert.ok(scene.violations.some(v=>v.pageNo===2&&v.message.includes('단어')));
  assert.ok(scene.violations.some(v=>v.pageNo===4&&v.message.includes('단어')));
  assert.equal(scene.violations.some(v=>v.pageNo===3),false);
  assert.ok(scene.violations.every(v=>v.kind==='scene'));assert.equal(result.needsRepagination,false);
});

test('Moral tails on two pages fail even when wording differs; one ending and an exact planned refrain are allowed',()=>{
  const input=fixture();input.pagination.pages[0].textKo+=' 마음이 참 따뜻해요.';
  input.pagination.pages[1].textKo+=' 정말 행복했어요.';
  let result=check(input);assert.deepEqual(rule(result,'moral_tail').violations.map(v=>v.pageNo),[1,2]);
  const one=fixture();one.pagination.pages[11].textKo+=' 마음이 참 따뜻해요.';
  assert.equal(rule(check(one),'moral_tail').passed,true);
  const planned=fixture();planned.outline.refrain={text:'마음이 참 따뜻해요.',usedAtBeats:[1,3,5]};
  for(const i of [0,4,7])planned.pagination.pages[i].textKo+=' 마음이 참 따뜻해요.';
  result=check(planned);assert.equal(rule(result,'moral_tail').passed,true);
});

test('Empty results expose all seven check badges and require repagination',()=>{
  const result=checkStory({beats:[]},{pages:[]});
  assert.equal(result.passed,false);assert.equal(result.checks.length,7);
  assert.equal(result.needsRepagination,true);assert.equal(result.violations[0].kind,'pagination');
});
