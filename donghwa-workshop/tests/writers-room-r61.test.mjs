// R61: the Codex R60 story-and-image audit, case by case — each reproduction now gives the right result.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../dist/story-generation/writers-room.js';
import * as G from '../dist/image-generation/world.js';
import * as F from '../dist/full-auto.js';
import * as S from '../dist/image-generation/scene-prompt.js';
import { castSheetsForPage } from '../dist/image-generation/reference-policy.js';
import { pageTextKey } from '../dist/story-generation/picture-plan.js';
import { seedState } from '../dist/engine.js';
import { migrateReadingSettings } from '../dist/reading-ui.js';
import { inputFromWizard } from '../dist/story-generation/ui.js';
import { normalizeStoryInput, toLegacyPages } from '../dist/story-generation/pipeline.js';
import { demoOutline } from '../dist/story-generation/demo.js';
import { renderImageRequest } from '../dist/image-generation/story-renderer.js';
import { getStylePreset } from '../dist/image-generation/styles.js';
import { splitSentences } from '../dist/story-quality/dist/util.js';

globalThis.fetch = async () => { throw Error('no network in tests'); };
const clone = (x) => structuredClone(x);
const setup = () => { const s = seedState(); G.migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '숲속에서 만나는 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', value: 'none', ending: 'home', simpleFlow: true};
const input = normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: 'r61'});
const fawn = {name: '폴짝이', isNew: true, want: '쉬어요', flaw: '', speech: '작게', nameEn: 'Hoppy', kind: 'fawn'};
const premise = {title: '숲의 하루', line: '숲에서 친구를 만나요.', engine: 'reader_knows', laugh: '귀가 보여요.', picture: '나무', cast: [{name: '유하', isNew: false, want: '찾아요'}, {name: '엄마', isNew: false}, fawn], places: []};
const outline = {...W.roomOutline(input, {premise, pitches: []}), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise, pitches: [], premises: [premise]}};
const response = (json) => ({json, usage: {input: 0, output: 0}, meta: {requests: 1, model: 'mock'}});
const pages = Array.from({length: 16}, (_, i) => ({ko: `유하가 ${i + 1}번째 나무를 봐요.`, en: `Yuha sees tree ${i + 1}.`}));
const looks = {cast: [{name: '폴짝이', build: 'four-legged', look: 'a tiny blue fawn with one gold ear and striped legs'}], places: []};

test('R61 the marker: a new room draft is weave 6 (kept); weave 5 and below stay as they were', () => {
  assert.deepEqual(input.writersRoom, {version: 1, weave: 6});
  assert.equal(W.hasRoomKept(input), true);
  assert.equal(W.hasRoomCounted(input), true, 'still counted');
  assert.equal(W.hasRoomKept({...input, writersRoom: {version: 1, weave: 5}}), false);
  assert.deepEqual(normalizeStoryInput({...input, writersRoom: {version: 1, weave: 5}}).writersRoom, {version: 1, weave: 5});
});

test('R61 (audit B, I) a one-page new animal keeps its page: no other sheets, its card words in the prompt, its card kept; an empty picture carries no sheet', async () => {
  const s = setup(), job = F.createFullAutoJob(s, wizard, {allowNew: false, planMode: 'selection', stopBefore: 'text'}), target = 4;
  const extract = {id: 'openai', async complete(req) {
    const id = s.characters.find((c) => c.name === '폴짝이').id;
    return response({cover: {title: '숲의 하루', sceneAction: 'Yuha alone'}, pages: Array.from({length: req.jsonSchema.properties.pages.minItems}, (_, i) => ({pageNo: i + 1, who: i === target ? [id] : i === 9 ? [] : ['yuha'], where: 'forest', action: i === target ? 'Hoppy rests alone under a tree.' : i === 9 ? 'An empty clearing.' : `Yuha looks at tree ${i + 1}.`, emotion: 'calm', timeOfDay: 'day', props: i === 9 ? [] : ['tree'], shot: 'middle', space: 'airy', carrier: 'both', focus: 'tree', backdrop: 'scene', hidden: '', holdBack: '', lettering: '', letteringOn: '', seenAs: ''}))});
  }};
  const dp = clone(pages);
  dp[target] = {ko: '폴짝이가 혼자 나무 아래 쉬어요.', en: 'Hoppy rests alone under a tree.'};
  dp[9] = {ko: '숲속 빈터가 조용해요.', en: 'The clearing is quiet.'};
  await F.runFullAuto(s, job, {operations: {preflight: async () => {}, outline: async (inp) => ({data: {...demoOutline(inp), writersRoom: outline.writersRoom}, meta: {requests: 0}}), roomDrafts: async () => ({data: {title: '숲의 하루', pages: dp, room: {looks}}, meta: {requests: 0}}), roomPages: (inp, ol, d, opts) => W.runRoomPages(inp, ol, d, {...opts, engine: extract, engineId: 'openai'}, {engineFor: () => extract})}, buildBook: (p) => ({id: p.bookId, title: '숲의 하루', characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, storyInput: p.input, outline: p.outline, pagination: p.pagination, pages: toLegacyPages(p.pagination)}), save: () => true});
  assert.equal(job.status, 'text-review', job.error || job.failure?.message);
  const id = job.roomSheets.cast[0].id, card = s.characters.find((c) => c.id === id), b = job.book, world = G.getActiveWorld(s);
  assert.equal(job.roomSheets.cast[0].pages, 1);
  assert.equal(card.archivedAt, undefined, 'the card is kept (the page draws from it)');
  assert.equal(job.plan.characterIds.includes(id), false, 'no sheet is bought');
  assert.ok(job.input.characters.some((c) => c.id === id), 'still in the cast');
  assert.deepEqual(b.pages[target].scene.who, [id], 'the page keeps its character');
  assert.ok(job.notes.some((n) => /인물 카드의 생김새 글로/.test(n)));
  b.generationSnapshot = {worldId: world.id, imageEngine: 'sample', stylePresetId: world.stylePresetId, stylePreset: getStylePreset(world.stylePresetId), styleReferences: [], characterSheets: b.characterIds.map((cid) => ({id: 'sheet-' + cid, characterId: cid, confirmedAt: 'now', imageUrl: 'https://qa.invalid/' + cid + '.png', characterSnapshot: s.characters.find((c) => c.id === cid)})), backgrounds: s.backgrounds.filter((x) => job.plan.backgroundIds.includes(x.id))};
  const one = G.sceneGenerationRequest(s, b, target);
  assert.equal(one.referenceImages.some((r) => /Yuha|Mom|유하|엄마/.test(r.label) && /sheet|시트|character/i.test(r.label)), false, 'no one else\'s sheet');
  assert.match(one.prompt, /Hoppy \(no reference image — draw from these words, the same way on every page\)/);
  assert.match(one.prompt, /gold ear/, 'the card\'s words reach the picture');
  // The empty clearing: nobody is in it — no character sheet at all, and the prompt says so.
  assert.equal(b.pages[9].scene.nobody, true);
  const none = G.sceneGenerationRequest(s, b, 9);
  assert.match(none.prompt, /Characters: none — no person or animal is in this picture\./);
  assert.equal(castSheetsForPage(b.generationSnapshot.characterSheets, b.pages[9], {strict: true}).length, 0);
});

test('R61 (audit C) a sequel: the previous book\'s facts reach the brief and the cast notes', () => {
  const sequel = {...input, previousSummary: '이전 책에서 파란 문을 잠갔어요.', previousStory: {id: 'previous-book', summaryForNext: '친구는 이미 만났어요.', pages: [{ko: '열쇠는 강바닥에 두었어요.'}]}};
  for (const [name, f] of Object.entries({premise: (i) => W.premisesRequest(i), cast: (i) => W.castNotesRequest(i, premise), flow: (i) => W.treatmentRequest(i, premise), draft: (i) => W.draftRequest(i, premise)})) {
    assert.match(JSON.stringify(f(sequel)), /강바닥/, name);
    assert.match(JSON.stringify(f(sequel)), /앞 이야기에서 정해진 것/, name);
    assert.doesNotMatch(JSON.stringify(f(input)), /앞 이야기에서 정해진 것/, name + ': no previous book, no block');
  }
  const old = {...sequel, writersRoom: {version: 1, weave: 5}};
  assert.equal(JSON.stringify(W.premisesRequest(old)), JSON.stringify(W.premisesRequest({...input, writersRoom: {version: 1, weave: 5}})), 'weave 5 unchanged');
});

const english = ['Yuha finds his small yellow hat.', 'Mom pushes a boat into water.', 'A deer eats some green leaves.', 'The butterfly flies high in the sky.', 'A duck swims across the pond.', 'The cat sleeps by a window.', 'A dog rolls the red ball.', 'The frog jumps between two rocks.', 'A bird sits on the roof.', 'Grandma cuts up a big melon.', 'The rabbit eats a fresh carrot.', 'A fox goes into its cave.', 'The bear tastes some sweet honey.', 'A giraffe reaches up with its neck.', 'The snail climbs a stone wall.', 'A squirrel hides a little nut.'];
const draftKo = ['유하가 모자를 주워요.', '엄마는 작은 배를 밀어요.', '사슴이 풀잎을 씹어요.', '나비는 하늘로 날아요.', '오리가 연못을 건너요.', '고양이는 창문에서 졸아요.', '강아지가 빨간 공을 굴려요.', '개구리는 돌 틈으로 뛰어요.', '참새가 지붕에 앉아요.', '할머니는 수박을 잘라요.', '토끼는 당근을 먹어요.', '여우가 동굴로 들어가요.', '곰은 꿀을 맛봐요.', '기린은 목을 뻗어요.', '달팽이가 담장을 넘어요.', '다람쥐는 도토리를 묻어요.'];
async function drafts(mode, {englishOf = (req) => english.map((en, i) => ({pageNo: i + 1, en}))} = {}) {
  const inp = {...clone(input), bookId: 'r61-' + mode}, calls = [];
  const engine = {id: 'openai', async complete(req) {
    const p = req.jsonSchema.properties, items = p.pages?.items?.properties || {};
    const k = p.ties ? 'cast' : p.flow ? 'flow' : p.kept ? 'threads' : p.readers ? (p.readers.items.properties.second ? 'pick' : 'read') : req.user.includes('[독자 반응]') ? 'rewrite' : req.user.includes('[등급 참고]') ? 'polish' : items.en && !items.ko ? 'english' : 'draft';
    calls.push(k);
    if (k === 'english') return response({pages: englishOf(req)});
    if (k === 'cast') return response({notes: [], ties: [], looks: [], placeLooks: []});
    if (k === 'flow') return response({flow: '처음부터 끝까지 걷는 이야기.', plants: []});
    if (k === 'read') return response({readers: W.PANEL_IDS.map((reader, i) => ({reader, favorite: 1, again: true, drafts: [{draft: 1, skipPage: i + 1, lostPage: 0, laughPages: [], change: mode === 'rewrite' && i < 2 ? '2쪽만 줄여요.' : '', changePage: mode === 'rewrite' && i < 2 ? 2 : 0, hardPage: 0, mannersPage: 0}]}))});
    if (k === 'threads') return response({kept: [], loose: [], unplanted: []});
    const dp = draftKo.map((ko) => ({ko}));
    // One sentence far over the word cap: the binding cannot fix it (it never cuts a sentence), so the polish is asked about page 2.
    if (mode === 'polish') dp[1].ko = '엄마는 아주 아주 작고 귀여운 노란 종이배를 숲속 맑은 시냇물 위에 살며시 올려놓고 천천히 밀어 보내며 활짝 웃어요.';
    if (k === 'rewrite' || k === 'polish') dp[11].ko = '외계인이 갑자기 유하를 화성으로 데려가요.';
    if (k === 'polish') dp[1].ko = '엄마는 작은 배를 밀어요.';
    return response({title: '숲의 하루', pages: k === 'polish' ? dp.map((q, i) => ({...q, en: english[i]})) : dp});
  }};
  const r = await W.runRoomDrafts(inp, outline, {engine, engineId: 'openai', roomFlowCount: 1, roomPolish: mode === 'polish', roomRewrite: mode === 'rewrite'}, {engineFor: () => engine});
  return {r, calls, room: r.data.room, pages: r.data.pages};
}

test('R61 (audit D) a rewrite and a polish only change the pages they were asked about', async () => {
  const rw = await drafts('rewrite');
  assert.ok(rw.calls.includes('rewrite'));
  assert.doesNotMatch(rw.pages.map((p) => p.ko).join(' '), /화성/, 'the out-of-scope page is restored');
  assert.ok(rw.room.rewriteScope && rw.room.rewriteScope.pages.includes(2), 'page 2 was in scope');
  assert.equal(rw.room.rewriteScope.pages.includes(12), false);
  const po = await drafts('polish');
  assert.ok(po.calls.includes('polish'));
  assert.doesNotMatch(po.pages.map((p) => p.ko).join(' '), /화성/, 'polish never takes an unnamed page');
  // The binding happened before the English (so the 18-sentence page was split in Korean first).
  assert.ok(po.room.binding, 'binding recorded');
  assert.ok(po.pages.every((p) => typeof p.en === 'string'));
});

test('R61 (audit H) the English is matched by page number; a missing page is asked once more; still missing, it is named, never the Korean', async () => {
  let asks = 0;
  const {room, pages: out, calls} = await drafts('plain', {englishOf: (req) => {
    asks++;
    const n = Number(req.jsonSchema.properties.pages.minItems);
    if (asks === 1) return english.slice(0, n).map((en, i) => ({pageNo: i + 1, en})).filter((x) => x.pageNo !== 3 && x.pageNo !== 5).reverse();
    return /Return ONLY pages 3, 5/.test(req.system) ? [{pageNo: 3, en: 'A deer eats some green leaves.'}] : [];
  }});
  assert.equal(calls.filter((k) => k === 'english').length, 2, 'one repair call');
  assert.equal(out[0].en, english[0], 'reversed answers land on their own page');
  assert.equal(out[2].en, 'A deer eats some green leaves.');
  assert.equal(out[4].en, undefined, 'page 5 has no English of its own');
  assert.deepEqual(room.englishMissing, [5]);
});

test('R61 (audit G) binding: a Korean-only join keeps the cap by moving sentences to a neighbour with room', () => {
  const d = Array.from({length: 17}, (_, i) => ({ko: `나무 ${i}번이 보여요. 유하가 걸어요. 엄마가 와요. 꽃이 피어요.`}));
  const clamped = W.clampPages(d, {min: 8, max: 16}, {cap: 5}), fit = W.fitSpreadMarks(clamped, 8, {cap: 5});
  assert.ok(Math.max(...fit.pages.map((p) => splitSentences(p.ko).length)) <= 5, 'no page over the cap');
  assert.equal(fit.pages.map((p) => p.ko).join(' ').replace(/\s+/g, ' '), d.map((p) => p.ko).join(' ').replace(/\s+/g, ' '), 'the words are the same, in order');
});

test('R61 (audit F) one writing policy per request: the named lettering survives the renderer', () => {
  const scene = 'LETTERING — the only writing in this picture: "APOLLO 13" on the rocket, in plain block capitals.';
  const r = renderImageRequest({prompt: scene, stylePreset: getStylePreset('watercolor'), referenceImages: []});
  assert.match(r.composedPrompt, /"APOLLO 13"/);
  assert.doesNotMatch(r.composedPrompt, /No text, no letters, no captions/);
  assert.match(r.composedPrompt, /Nothing written other than the lettering "APOLLO 13" named above/);
  assert.equal(r.negativePrompt.split(',').map((x) => x.trim()).includes('text'), false);
  const plain = renderImageRequest({prompt: 'A forest.', stylePreset: getStylePreset('watercolor'), referenceImages: []});
  assert.match(plain.composedPrompt, /No text, no letters, no captions, no logos, no watermarks\./, 'no lettering: the ban as before');
});

test('R61 (audit I) the reading: a missing row is marked, an empty who is "nobody", each scene keeps the key of its words', () => {
  const d = pages.slice(0, 8);
  const missing = W.settleExtraction({pages: []}, input, outline, d, 'empty reading');
  assert.equal(missing.pages[0].scene.readingMissing, true);
  const empty = W.settleExtraction({pages: d.map((p, i) => ({pageNo: i + 1, who: [], where: 'forest', action: 'An empty forest clearing.', emotion: 'calm', timeOfDay: 'day', props: []}))}, input, outline, d, 'empty forest');
  assert.equal(empty.pages[0].scene.nobody, true);
  assert.deepEqual(empty.pages[0].scene.who, ['yuha'], 'the validator still gets one ID');
  assert.equal(empty.pages[0].scene.textKey, pageTextKey(d[0].ko, d[0].en));
  // A shuffled answer without page 2 is not filled from another row.
  const shuffled = W.settleExtraction({pages: d.filter((_, i) => i !== 1).map((p, i) => ({pageNo: i + 1 >= 2 ? i + 2 : i + 1, who: ['yuha'], where: 'forest', action: `Moment ${i}.`, emotion: 'calm', timeOfDay: 'day', props: []}))}, input, outline, d, 'shuffled');
  assert.equal(shuffled.pages[1].scene.readingMissing, true);
});

test('R61 (audit A) + R61b (V1) a page whose words changed after the reading is drawn from its words now — the Korean first', () => {
  const sheet = {characterId: 'yuha', characterSnapshot: {id: 'yuha', name: '유하', nameEn: 'Yuha'}, confirmedAt: 'now', imageUrl: 'x'};
  const ask = (scene, ko, en) => {
    const book = {storyInput: input, outline, characterIds: ['yuha'], pages: [{ko, en, scene: {who: ['yuha'], where: 'forest', action: 'Yuha climbs a tall old tree.', emotion: 'calm', timeOfDay: 'day', props: ['tree'], ...scene}, imagePrompt: 'Yuha climbs a tall old tree.'}]};
    return S.buildScenePrompt({book, page: book.pages[0], pageIndex: 0, snapshot: {characterSheets: [sheet], backgrounds: []}, place: {}, sheets: [sheet]});
  };
  // Only the joint key: the Korean alone (an English a Korean edit left behind is the old story).
  const joint = ask({textKey: pageTextKey('유하가 옛 글이에요.', 'Yuha has old words.')}, '유하가 새로 쓴 글이에요.', 'Yuha has old words.');
  assert.match(joint, /the words of this page were changed after its picture was planned: draw what they say now/);
  assert.match(joint, /유하가 새로 쓴 글이에요/);
  assert.doesNotMatch(joint, /Yuha has old words|climbs a tall old tree/);
  // Per-language keys: the Korean changed and the English did not — still the Korean alone.
  const koOnly = ask({koKey: pageTextKey('유하가 옛 글이에요.'), enKey: pageTextKey('Yuha has old words.')}, '유하가 새로 쓴 글이에요.', 'Yuha has old words.');
  assert.doesNotMatch(koOnly, /Yuha has old words/);
  // Both changed (the English was aligned after the edit) — the English joins the Korean.
  const both = ask({koKey: pageTextKey('유하가 옛 글이에요.'), enKey: pageTextKey('Yuha has old words.')}, '유하가 새로 쓴 글이에요.', 'Yuha has new words.');
  assert.match(both, /Yuha has new words/);
  // Unchanged words: the plan as before.
  assert.doesNotMatch(ask({koKey: pageTextKey('같은 글이에요.'), enKey: pageTextKey('Same.')}, '같은 글이에요.', 'Same.'), /were changed after/);
});

test('R61 (audit §7) the sheet choice uses the camera the picture will use; female reads as woman; a reader counts once', () => {
  const d = Array.from({length: 2}, () => ({scene: {where: 'place', who: ['yuha']}, picturePlan: {version: 1, shot: 'middle'}, staging: {shot: 'over_shoulder'}}));
  const b = {storyInput: input, pages: d};
  assert.equal(S.effectiveStaging(b, d[0]).shot, 'over_shoulder');
  assert.deepEqual(W.roomSheetChoice(d, {places: ['place'], shotOf: (p) => S.effectiveStaging(b, p).shot}).places.keep, [], 'two close pictures: no place sheet');
  assert.deepEqual(W.roomSheetChoice(d, {places: ['place']}).places.keep, ['place'], 'without shotOf, as before');
  assert.equal(W.genderWord({kind: 'adult', gender: 'female'}), 'woman');
  assert.equal(W.genderWord({kind: 'adult', gender: 'male'}), 'man');
  const row = {reader: 'action', favorite: 1, again: true, drafts: [{draft: 1, skipPage: 2, lostPage: 0, laughPages: [], change: '2쪽 수정', changePage: 2}]};
  const twice = {readers: [row, clone(row)]};
  const once = W.countReadings(twice, 1, {agree: true, unique: true})[0], before = W.countReadings(twice, 1, {agree: true})[0];
  assert.equal(once.votes, 1, 'the repeated reader is one vote');
  assert.deepEqual(once.words, [], 'one reader cannot agree with itself');
  assert.equal(before.votes, 2, 'without unique, as before');
});

test('R61 (audit E) a mistaken thing: the reading\'s seenAs reaches the picture plan; who covers a part that shows; props may be none', async () => {
  const req = W.extractRequest(input, outline, pages.slice(0, 8));
  assert.ok(req.jsonSchema.properties.pages.items.properties.seenAs, 'asked');
  assert.match(req.system, /a pair of ears over a bush or a tail behind a tree is that character/);
  assert.match(req.system, /props \(0–6 concrete things/);
  const d = pages.slice(0, 8);
  const r = W.settleExtraction({pages: d.map((p, i) => ({pageNo: i + 1, who: ['yuha'], where: 'forest', action: `Moment ${i}.`, emotion: 'calm', timeOfDay: 'day', props: [], shot: 'middle', space: 'airy', carrier: 'both', focus: 'rock', backdrop: 'scene', hidden: '', holdBack: '', lettering: '', letteringOn: '', seenAs: i === 2 ? 'the brown rock is Kongi curled up; Mom thinks it is a rock; one white ear tip shows' : ''}))}, input, outline, d, 'seenAs');
  assert.match(r.pages[2].picturePlan.seenAs, /Kongi curled up/);
  assert.equal(r.pages[3].picturePlan?.seenAs, undefined);
  const {picturePlanPictureLine} = await import('../dist/story-generation/picture-plan.js');
  assert.match(picturePlanPictureLine(r.pages[2].picturePlan), /WHAT IT REALLY IS: the brown rock is Kongi curled up/);
  const old = W.extractRequest({...input, writersRoom: {version: 1, weave: 5}}, outline, pages.slice(0, 8));
  assert.equal(old.jsonSchema.properties.pages.items.properties.seenAs, undefined, 'weave 5 unchanged');
});

test('R61a a crowded picture (six of the cast) keeps five on who, the hero first, the rest on extra — it validates and every sheet still goes to the picture', async () => {
  const {validateStoryPage} = await import('../dist/story-generation/schemas.js');
  const ids = ['yuha', 'mom', 'c1', 'c2', 'c3', 'c4'];
  const inp = {...input, characters: ids.map((id) => ({id, name: id}))};
  const two = [{ko: '모두 모였어요.', en: 'Everyone is here.'}, {ko: '끝이에요.', en: 'The end.'}];
  for (const weave of [5, 6]) {
    const w = {...inp, writersRoom: {version: 1, weave}};
    const r = W.settleExtraction({pages: two.map((p, i) => ({pageNo: i + 1, who: i === 0 ? ['c4', 'c3', 'c2', 'c1', 'mom', 'yuha'] : ['yuha'], where: 'hill', action: 'All gather.', emotion: 'happy', timeOfDay: 'day', props: []}))}, w, outline, two, 't');
    assert.deepEqual(r.pages[0].scene.who, ['yuha', 'c4', 'c3', 'c2', 'c1'], `weave ${weave}: hero first, five`);
    assert.deepEqual(r.pages[0].scene.extra, ['mom']);
    assert.deepEqual(validateStoryPage(r.pages[0], w, outline).errors, [], 'the validator\'s five-ID limit holds');
    assert.equal(r.pages[1].scene.extra, undefined, 'a page of five or fewer is as before');
    const sheets = ids.map((id) => ({characterId: id, confirmedAt: 'now', imageUrl: 'x'}));
    assert.equal(castSheetsForPage(sheets, r.pages[0], {strict: true}).length, 6, 'all six are drawn (none named absent)');
  }
  const five = W.settleExtraction({pages: two.map((p, i) => ({pageNo: i + 1, who: ['c1', 'yuha'], where: 'hill', action: 'x', emotion: 'happy', timeOfDay: 'day', props: []}))}, inp, outline, two, 't');
  assert.deepEqual(five.pages[0].scene.who, ['c1', 'yuha'], 'order unchanged when it fits');
});

test('R61b (V1) a Korean edit through the real page tools: the request names the cast and place the new words name, not the old ones', async () => {
  const {applyPageText} = await import('../dist/story-generation/page-tools.js');
  const s = setup(), before = {ko: '유하가 숲에서 큰 나무를 올라가요.', en: 'Yuha climbs a tall tree in the forest.'};
  const p = {...before, staging: {shot: 'medium', characterSide: 'left', textSide: 'right'}, textKo: before.ko, textEn: before.en, scene: {who: ['yuha'], where: 'forest', action: before.en, props: ['tree'], timeOfDay: 'day', emotion: 'calm', textKey: pageTextKey(before.ko, before.en), koKey: pageTextKey(before.ko), enKey: pageTextKey(before.en)}};
  const b = {id: 'edit', storyInput: input, outline, characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], pages: [p], pagination: {pages: [clone(p)]}};
  const w = G.getActiveWorld(s);
  b.generationSnapshot = {worldId: w.id, imageEngine: 'sample', stylePresetId: w.stylePresetId, stylePreset: getStylePreset(w.stylePresetId), styleReferences: [], characterSheets: b.characterIds.map((id) => ({id: 's-' + id, characterId: id, confirmedAt: 'now', imageUrl: 'https://qa.invalid/' + id + '.png', characterSnapshot: clone(s.characters.find((c) => c.id === id))})), backgrounds: s.backgrounds.filter((x) => b.backgroundIds.includes(x.id))};
  await applyPageText(s, b, 0, {ko: '엄마가 집에서 물을 마셔요.', en: before.en, save: () => true});
  const req = G.sceneGenerationRequest(s, b, 0);
  assert.doesNotMatch(req.prompt, /climbs a tall tree|forest/i);
  assert.deepEqual(req.referenceImages.filter((r) => r.role !== 'background').map((r) => r.label).filter((l) => /Yuha|Mom/.test(l)).map((l) => l.split(' ')[0]), ['Mom', 'Mom']);
  assert.match(req.prompt, /Location: \{"name":"유하네 집"/, 'the home place the new words name');
  assert.equal(b.pages[0].scene.where, 'forest', 'the stored page is not changed');
});

test('R61b (V2) a rewrite that changes the page count keeps every page it was not asked about; an outside page keeps its art; a plant needs a named thread', () => {
  const before = Array.from({length: 8}, (_, i) => ({ko: `원래 ${i + 1}쪽이에요.`, art: 'a tree'}));
  const alien = clone(before);
  alien[7].ko = '외계인이 유하를 화성으로 데려가요.';
  alien.push({ko: '새 끝이에요.'});
  const rejected = W.mergeRewrite(before, alien, {pages: [1, 2, 3], laughs: [8]});
  assert.equal(rejected.structural, 'rejected');
  assert.deepEqual(rejected.pages.map((p) => p.ko), before.map((p) => p.ko));
  // A split inside the scope is taken: page 2 becomes two pages, the rest are the originals.
  const split = clone(before);
  split.splice(1, 1, {ko: '원래 2쪽 앞이에요.'}, {ko: '원래 2쪽 뒤예요.'});
  const ok = W.mergeRewrite(before, split, {pages: [1, 2, 3], laughs: []});
  assert.equal(ok.structural, true);
  assert.equal(ok.pages.length, 9);
  assert.equal(ok.pages[8].ko, before[7].ko);
  const art = clone(before);
  art[7].art = 'A monster destroys the house.';
  assert.equal(W.mergeRewrite(before, art, {pages: [1, 2, 3], laughs: []}).pages[7].art, 'a tree');
  const append = clone(before);
  append[6].ko += ' 외계인이 왔어요.';
  assert.equal(W.mergeRewrite(before, append, {pages: [1, 2, 3], laughs: []}).pages[6].ko, before[6].ko, 'no thread, no plant');
  const plant = clone(before);
  plant[6].ko += ' 도토리가 하나 떨어져 있어요.';
  assert.match(W.mergeRewrite(before, plant, {pages: [1, 2, 3], laughs: [], plants: ['도토리']}).pages[6].ko, /도토리/, 'a plant of a named thread');
  assert.deepEqual(W.rewriteScope({boredPages: [2]}, {loose: [{what: '빨간 도토리', page: 5}], unplanted: []}, 8).plants, ['빨간 도토리']);
});

test('R61b (V3) a page whose English never came back keeps an empty English, marked — it validates, and writing its English clears the mark', async () => {
  const {validateStoryPage} = await import('../dist/story-generation/schemas.js');
  const d = pages.slice(0, 4).map((p, i) => (i === 2 ? {ko: p.ko} : p));
  const r = W.settleExtraction({pages: d.map((p, i) => ({pageNo: i + 1, who: ['yuha'], where: 'forest', action: 'x', emotion: 'calm', timeOfDay: 'day', props: []}))}, input, outline, d, 't');
  assert.equal(r.pages[2].textEn, '');
  assert.equal(r.pages[2].scene.englishMissing, true);
  assert.deepEqual(validateStoryPage(r.pages[2], input, outline).errors, []);
  assert.equal(r.pages[1].textEn, d[1].en);
  const old = W.settleExtraction({pages: []}, {...input, writersRoom: {version: 1, weave: 5}}, outline, d, 't');
  assert.equal(old.pages[2].textEn, d[2].ko, 'weave 5 as before');
  const {applyPageText} = await import('../dist/story-generation/page-tools.js');
  const s = setup(), page = {...r.pages[2], ko: r.pages[2].textKo, en: ''};
  const book = {id: 'en', storyInput: input, outline, characterIds: ['yuha'], pages: [page], pagination: {pages: [clone(r.pages[2])]}};
  await applyPageText(s, book, 0, {ko: page.ko, en: 'Yuha sees tree 3.', save: () => true});
  assert.equal(book.pages[0].scene.englishMissing, undefined);
  assert.equal(book.pagination.pages[0].scene.englishMissing, undefined);
});

test('R61b (V5) one writing policy: the style\'s own "no text" leaves when a lettering is named (every built-in style)', () => {
  for (const id of ['watercolor', 'crayon', 'comic']) {
    const x = renderImageRequest({prompt: 'LETTERING — the only writing in this picture: "APOLLO 13" on the rocket.', stylePreset: getStylePreset(id), referenceImages: []});
    assert.doesNotMatch(x.stylePrompt, /\bno text\b/i, id);
    assert.doesNotMatch(x.composedPrompt, /\bno text\b/i, id);
    assert.match(x.composedPrompt, /other than the lettering "APOLLO 13"/, id);
  }
  const plain = renderImageRequest({prompt: 'A forest.', stylePreset: getStylePreset('watercolor'), referenceImages: []});
  assert.equal(plain.stylePrompt, getStylePreset('watercolor').stylePrompt, 'no lettering: the style as it is');
});

test('R61b Codex\'s free recheck (QA/r61-verification/tools/recheck.mjs): every acceptance value is true', async () => {
  const {execFileSync} = await import('node:child_process');
  const {mkdtempSync, readFileSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const out = mkdtempSync(join(tmpdir(), 'r61b-'));
  execFileSync(process.execPath, ['QA/r61-verification/tools/recheck.mjs'], {env: {...process.env, DONGHWA_APP_ROOT: process.cwd(), DONGHWA_AUDIT_OUT: out}, stdio: 'pipe'});
  const r = JSON.parse(readFileSync(join(out, 'recheck.json'), 'utf8'));
  assert.deepEqual(r.acceptance, {editedPageUsesCurrentKo: true, scopedRewritePreservesOtherPages: true, missingEnglishIsNotKorean: true, oneOffIdentityIsFrozen: true, letteringHasNoConflictingStyle: true});
  assert.equal(r.networkCalls, 0);
});
