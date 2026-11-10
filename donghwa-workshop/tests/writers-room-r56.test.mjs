import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {estimateStoryTextCost, jobTextBudget} from '../dist/text-generation/models.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R56 (2026-11-09): the parent asked for the stages a broadcast writer goes
 * through, so the cast and the foreshadowing are finished over several
 * passes. The staged room (weave 2): the cast speaks and says what stands
 * between them → three treatments, the panel picks one → the cast revised
 * for that flow → three drafts of it → the panel reads → the editor's thread
 * check → the rewrite. The conditions the old staged pipeline taught:
 * every intermediate document is the writer's working note (nothing checks
 * it, a draft may leave it, an unreadable one is skipped), and the same
 * writer carries all of it into the draft.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
/* R59 moved new drafts to weave 4 (one draft, the app's text fields) and pictureRefs 2 (request hygiene); this file pins the room as R58 left it. */
const asR58 = (input) => ({...input, writersRoom: {...input.writersRoom, weave: 3}, ...(input.pictureRefs ? {pictureRefs: {version: 1}} : {})});
const roomInput = (id) => asR58(normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: id}));
const weave1 = (input) => ({...input, writersRoom: {...input.writersRoom, weave: 1}});
const PREMISE = {title: '쉿, 콩이', line: '콩이는 늘 유하 등 뒤에 있어요', engine: 'reader_knows', laugh: '엄마도 못 찾아요', picture: '등 뒤의 작은 뿔', cast: [
  {name: '유하', isNew: false, want: '콩이를 찾고 싶다', flaw: '뒤를 안 본다', speech: '"어디 갔지?"', nameEn: '', kind: '', look: ''},
  {name: '엄마', isNew: false, want: '빨래를 걷고 싶다', flaw: '바쁘다', speech: '"응, 그래."', nameEn: '', kind: '', look: ''},
  {name: '콩이', isNew: true, want: '들키고 싶지 않다', flaw: '꼬리가 삐죽', speech: '"쉿."', nameEn: 'Kongi', kind: 'deer', look: 'a small fawn'}]};
const outlineOf = (input) => ({...W.roomOutline(input, {premise: PREMISE, pitches: []}), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [], premises: [PREMISE]}});
const NOTES = [{name: '유하', today: '도토리 열 개를 줍는다', unsaid: '어제 콩이 밥그릇을 엎었다', habit: '주머니에 돌멩이'}, {name: '엄마', today: '비 오기 전에 빨래를 걷는다', unsaid: '콩이를 벌써 봤다', habit: '빨래집게를 옷깃에 꽂는다'}, {name: '콩이', today: '유하 그림자만 밟는다', unsaid: '혼자 있기 싫다', habit: '꼬리를 까딱인다'}];
const TIES = [{from: '엄마', to: '유하', wants: '빨래 바구니를 들어 줬으면', knows: '콩이가 어디 있는지'}, {from: '콩이', to: '엄마', wants: '모른 척해 줬으면', knows: ''}];
const FLOW = (n) => ({flow: `흐름 ${n}. 유하가 콩이를 찾고, 엄마는 빨래를 걷어요. 끝에서 셋이 빨랫줄 아래에서 만나요.`, plants: n === 1 ? [] : [{what: '빨래집게', plant: '엄마 옷깃에 하나', payoff: '끝에서 콩이 꼬리에 물려 있음'}, ...(n === 3 ? [{what: '돌멩이', plant: '유하 주머니', payoff: '길 표시'}] : [])]});

test('R56 stage 2 — the cast and what stands between them: the staged room asks for ties; only the premise\'s own names, one per ordered pair; an R55h job is asked for notes alone', () => {
  const input = roomInput('s1');
  const req = W.castNotesRequest(input, PREMISE);
  assert.deepEqual(req.jsonSchema.required, ['notes', 'ties']);
  assert.match(req.system, /인물 사이\(ties[^)]*\): 누가\(from\) 누구에게\(to\) 바라는 것 하나\(wants[^)]*\)와, from만 알고 to는 모르는 것 하나\(knows[^)]*\)\. 주인공과 조연 사이만이 아니라 조연끼리도요\. 이건 재료예요 — 줄거리를 정하지 않아요\.$/);
  const old = W.castNotesRequest(weave1(input), PREMISE);
  assert.deepEqual(old.jsonSchema.required, ['notes']);
  assert.doesNotMatch(old.system, /ties/);
  assert.deepEqual(W.settleTies({ties: [...TIES, {from: '엄마', to: '유하', wants: '둘째', knows: ''}, {from: '유하', to: '유하', wants: 'x', knows: ''}, {from: '곰', to: '유하', wants: 'x', knows: ''}, {from: '유하', to: '콩이', wants: '', knows: ''}]}, PREMISE), TIES);
  assert.match(W.castNotesBlock(NOTES, TIES), /\n\n\[인물 사이 — 재료예요\]\n- 엄마 → 유하: 바라는 것 — 빨래 바구니를 들어 줬으면; 혼자 아는 것 — 콩이가 어디 있는지\n- 콩이 → 엄마: 바라는 것 — 모른 척해 줬으면$/);
});

test('R56 stage 3 — the treatment: prose and a short plant-and-pay-off memo, one for each weave, no pages and no beats; the panel picks; a tie goes to the flow that puts more down', () => {
  const input = roomInput('s2');
  const req = W.treatmentRequest(input, PREMISE, {castNotes: NOTES, ties: TIES}, 1, 3);
  assert.match(req.system, /흐름을 반 쪽짜리 줄글로 적어 봐요\(flow\)/);
  assert.match(req.system, /쪽 번호도 비트도 없어요\./);
  assert.match(req.system, /글이 아니라 그림에만 놓아도 돼요\. 그림에는 설명하는 글자나 숫자\(자막, 귀퉁이의 표시\)를 넣을 수 없어요 — 세는 것은 물건의 개수나 몸짓으로 보여요\. 물건에 원래 적혀 있는 짧은 글자\(로켓의 이름, 버스 번호, 간판\)는 한 그림에 하나까지 돼요 — 숫자와 영문 대문자만, 그림 메모에 따옴표로 그대로 적어요\("13", "APOLLO 13"\)\./, 'R56a: the paid run planted numerals in the corners of seven pictures');
  assert.match(req.system, /이건 네 작업 노트예요: 초고를 쓰다 더 좋은 길이 보이면 벗어나도 돼요\.$/);
  assert.match(req.user, /\[인물 사이 — 재료예요\][\s\S]*\n\n\[흐름 2\/3 — 두 줄기로 써 봐요/);
  assert.deepEqual(Object.keys(req.jsonSchema.properties), ['flow', 'plants'], 'two fields — not a form');
  assert.equal(req.jsonSchema.properties.plants.minItems, undefined, 'a flow may plant nothing');
  assert.equal(W.settleTreatment({flow: '', plants: []}), null);
  assert.deepEqual(W.settleTreatment({flow: ' 가 \n 나 ', plants: [{what: '집게', plant: '옷깃', payoff: ''}, {what: '', plant: 'x', payoff: 'y'}, 3]}), {flow: '가 나', plants: [{what: '집게', plant: '옷깃', payoff: ''}]});
  const flows = [FLOW(1), FLOW(2), FLOW(3)];
  const panel = W.panelFlowsRequest(input, flows);
  assert.match(panel.system, /가장 듣고 싶은 흐름 하나\(favorite\)와 그다음 하나\(second/);
  assert.match(panel.user, /=== 흐름 3 ===\n흐름 3\.[^\n]*\n\(앞에 놓였다가 뒤에서 다시 쓰이는 것: 빨래집게, 돌멩이\)/);
  const reader = (id, favorite, second, lost = []) => ({reader: id, favorite, second, why: `${id}의 까닭`, lost});
  const rows = W.countFlows({readers: [reader('action', 1, 2), reader('laugh', 1, 3), reader('heart', 2, 3), reader('eye', 3, 2, [1]), reader('ours', 2, 1), reader('parent', 3, 2)]}, flows);
  assert.deepEqual(rows.map((r) => [r.first, r.second, r.lost, r.pull]), [[2, 1, 1, 5], [2, 3, 0, 9], [2, 2, 0, 8]]);
  assert.equal(W.pickFlow(rows, flows), 2);
  const tie = [{flow: 1, pull: 6}, {flow: 2, pull: 6}, {flow: 3, pull: 6}];
  assert.equal(W.pickFlow(tie, flows), 3, 'the tie goes to the flow with more to pick up later');
  assert.equal(W.pickFlow([], flows), 1);
  assert.match(W.flowBlock(FLOW(2)), /^\[흐름 — 네 작업 노트예요\. 쓰다가 더 좋은 길이 보이면 벗어나도 돼요\]\n흐름 2\.[^\n]*\n\[심고 거두기\]\n- 빨래집게: 엄마 옷깃에 하나 → 끝에서 콩이 꼬리에 물려 있음$/);
  assert.equal(W.flowBlock(null), '');
});

test('R56 stage 4 and 5 — the cast revised for the chosen flow (a turn per character); the drafts carry the notes, the ties and the flow, and differ in the telling', () => {
  const input = roomInput('s3');
  const revise = W.castReviseRequest(input, PREMISE, NOTES, TIES, FLOW(2));
  assert.match(revise.system, /인물 노트를 이 흐름에 맞춰 한 번 고쳐요/);
  assert.match(revise.system, /한 번 하는 결정이나 처음과 달라지는 점\(turn/);
  assert.deepEqual(revise.jsonSchema.properties.notes.items.required, ['name', 'today', 'unsaid', 'habit', 'turn']);
  assert.match(revise.user, /\[인물들이 제 입으로 한 말[\s\S]*\[인물 사이[\s\S]*\[흐름 — 네 작업 노트예요/);
  const revised = W.settleCastNotes({notes: NOTES.map((n) => ({...n, turn: n.name === '엄마' ? '끝에서 모른 척을 그만둔다' : ''}))}, PREMISE);
  assert.equal(revised[1].turn, '끝에서 모른 척을 그만둔다');
  assert.equal('turn' in revised[0], false);
  const draft = W.draftRequest(input, PREMISE, {castNotes: revised, ties: TIES, treatment: FLOW(2)});
  assert.match(draft.user, /- 엄마: [^\n]*; 이 이야기에서 — 끝에서 모른 척을 그만둔다\n[\s\S]*\n\n\[인물 사이 — 재료예요\]\n[\s\S]*\n\n\[흐름 — 네 작업 노트예요\. 쓰다가 더 좋은 길이 보이면 벗어나도 돼요\]\n흐름 2\./);
  assert.equal(W.draftWeaveLine(input, 1, 3, FLOW(2)), '[초고 2/3 — 같은 흐름을 네 식대로: 화자·호흡·무엇을 그림에 맡길지는 이 초고만의 것으로]');
  assert.match(W.draftWeaveLine(input, 1, 3, null), /두 줄기로 써 봐요/, 'no flow: the drafts carry the weaves themselves');
  // An R55h job: no ties and no flow in its draft, whatever is passed.
  const old = W.draftRequest(weave1(input), PREMISE, {castNotes: NOTES, ties: TIES, treatment: FLOW(2)});
  assert.doesNotMatch(old.user, /인물 사이|\[흐름 —/);
});

test('R56 stage 6 — the editor\'s thread check: kept, loose, unplanted; only real pages count; the notes join the readers\' and a loose thread alone is a reason to rewrite', () => {
  const input = roomInput('s4');
  const draft = {title: 't', pages: [{ko: '가.', art: '옷깃에 빨래집게'}, {ko: '나.'}, {ko: '다.'}, {ko: '라.'}]};
  const req = W.threadCheckRequest(input, draft, FLOW(2));
  assert.match(req.system, /고치지 않고 세 가지만 찾아 적어요/);
  assert.match(req.system, /없으면 빈 목록이에요 — 지어내지 않아요\./);
  assert.match(req.user, /^\[작가의 심고 거두기 메모\]\n- 빨래집게: 엄마 옷깃에 하나 → 끝에서 콩이 꼬리에 물려 있음\n\n=== 원고 · t ===\n1쪽: 가\. \[그림: 옷깃에 빨래집게\]/);
  assert.doesNotMatch(W.threadCheckRequest(input, draft, null).user, /심고 거두기 메모/);
  const threads = W.settleThreads({kept: [{what: '빨래집게', from: 1, to: 4}, {what: '거꾸로', from: 3, to: 2}, {what: '밖', from: 1, to: 9}], loose: [{what: '돌멩이', page: 2}, {what: '없는 쪽', page: 7}], unplanted: [{what: '우산', page: 4}, {what: '', page: 1}]}, 4);
  assert.deepEqual(threads, {kept: [{what: '빨래집게', from: 1, to: 4}], loose: [{what: '돌멩이', page: 2}], unplanted: [{what: '우산', page: 4}]});
  assert.equal(W.threadNotes(threads), '심고 거둔 것: 빨래집게 1쪽→4쪽 — 그대로 둬요.\n놓기만 하고 다시 쓰지 않은 것: 돌멩이 (2쪽) — 뒤에서 한 번 쓰거나 빼요.\n앞에 없이 나온 것: 우산 (4쪽) — 앞쪽 한 곳에 그림 메모나 한 줄로 먼저 놓아요.');
  assert.equal(W.threadsNeedWork(threads), true);
  assert.equal(W.threadsNeedWork({kept: [{what: 'a', from: 1, to: 2}], loose: [], unplanted: []}), false);
  assert.deepEqual(W.settleThreads(null, 4), {kept: [], loose: [], unplanted: []});
  assert.equal(W.threadNotes({kept: [], loose: [], unplanted: []}), '');
});

test('R56 the staged run: cast → three flows → the panel\'s pick → the cast revised → three drafts of that flow → the read → the thread check → the rewrite; the resumed run buys nothing; unreadable notes never stop the book', async () => {
  const input = roomInput('s5'), outline = outlineOf(input);
  const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
  const calls = [];
  const kind = (req) => {
    const props = req.jsonSchema?.properties || {}, items = props.pages?.items?.properties || {};
    if (props.ties) return 'cast';
    if (props.notes) return 'castRevise';
    if (props.flow) return 'flow';
    if (props.kept) return 'threads';
    if (props.readers) return props.readers.items.properties.second ? 'flowPick' : 'read';
    if (items.en && !items.ko) return 'english';
    return /\[독자 반응\]/.test(req.user) ? 'rewrite' : 'draft';
  };
  const engineOf = ({broken = false} = {}) => ({id: 'openai', async complete(req) {
    const k = kind(req);
    calls.push({k, req});
    const garbage = {text: '읽을 수 없는 답', usage: {input: 1, output: 1}, meta: {requests: 1, model: 'mock'}};
    if (k === 'cast') return broken ? garbage : reply({notes: NOTES, ties: TIES});
    if (k === 'flow') return broken ? garbage : reply(FLOW(Number(/\[흐름 (\d)\/3/.exec(req.user)[1])));
    if (k === 'flowPick') return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader, i) => ({reader, favorite: i < 4 ? 2 : 3, second: i < 4 ? 3 : 2, why: '끝이 궁금해요', lost: i === 0 ? [1] : []}))});
    if (k === 'castRevise') return reply({notes: NOTES.map((n) => ({...n, turn: `${n.name}의 결정`}))});
    if (k === 'threads') return broken ? garbage : reply({kept: [{what: '빨래집게', from: 2, to: 7}], loose: [{what: '돌멩이', page: 3}], unplanted: []});
    if (k === 'read') return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader, i) => ({reader, favorite: 1, again: true, drafts: [1, 2, 3].map((d) => ({draft: d, skipPage: i + 1, lostPage: 0, laughPages: [], change: '', hardPage: 0, mannersPage: 0, echoFrom: 0, echoTo: 0, echo: '', flat: ''}))}))});
    if (k === 'english') return reply({pages: Array.from({length: Number(req.jsonSchema.properties.pages.minItems)}, (_, i) => ({en: `Page ${i + 1}.`}))});
    if (k === 'rewrite') return reply({title: '고친 책', pages: Array.from({length: 8}, (_, i) => ({ko: `고친 ${i + 1}쪽이에요.`, ...(i === 2 ? {art: '유하 주머니에서 돌멩이가 떨어져요'} : {})}))});
    return reply({title: `초고 ${/\[초고 (\d)\/3/.exec(req.user)[1]}`, pages: Array.from({length: 8}, (_, i) => ({ko: `${i + 1}쪽이에요. 유하가 걸어요.`}))});
  }});
  let engine = engineOf(), checkpoint = null;
  const phases = [];
  const options = () => ({engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine}, roomPolish: false, onProgress: (p) => { if (p.stage === 'roomDrafts' && p.room) phases.push(p.phase); }, onCheckpoint: async (cp) => { checkpoint = cp.writerCheckpoint; }});
  const result = await W.runRoomDrafts(input, outline, options(), {engineFor: () => engine});
  assert.deepEqual(calls.map((c) => c.k), ['cast', 'flow', 'flow', 'flow', 'flowPick', 'castRevise', 'draft', 'draft', 'draft', 'read', 'threads', 'rewrite', 'english']);
  assert.deepEqual([...new Set(phases)], ['cast', 'flow', 'flowPick', 'castRevise', 'drafts', 'read', 'threads', 'rewrite', 'english', 'done']);
  const room = result.data.room;
  assert.equal(room.flowChosen, 2);
  assert.deepEqual(room.flowRows.map((r) => r.pull), [-2, 14, 10]);
  assert.equal(room.treatments.length, 3);
  assert.equal(room.castRevised, true);
  assert.equal(room.castNotes[1].turn, '엄마의 결정');
  assert.deepEqual(room.ties, TIES);
  // The three drafts were written from the chosen flow, with the revised cast, and differ in the telling.
  const drafts = calls.filter((c) => c.k === 'draft');
  assert.ok(drafts.every((c) => /\[흐름 — 네 작업 노트예요[^\n]*\n흐름 2\./.test(c.req.user) && /이 이야기에서 — 엄마의 결정/.test(c.req.user) && /같은 흐름을 네 식대로/.test(c.req.user)));
  // The readers named nothing twice, but the editor found a loose thread: the rewrite runs and hears it.
  assert.deepEqual(room.threads, {kept: [{what: '빨래집게', from: 2, to: 7}], loose: [{what: '돌멩이', page: 3}], unplanted: []});
  assert.equal(room.rewritten, true);
  const rewrite = calls.find((c) => c.k === 'rewrite').req;
  assert.match(rewrite.user, /\[독자 반응\]\n심고 거둔 것: 빨래집게 2쪽→7쪽 — 그대로 둬요\.\n놓기만 하고 다시 쓰지 않은 것: 돌멩이 \(3쪽\) — 뒤에서 한 번 쓰거나 빼요\./);
  assert.match(rewrite.user, /\[흐름 — 네 작업 노트예요/);
  assert.equal(result.data.pages[2].art, '유하 주머니에서 돌멩이가 떨어져요');
  assert.match(W.roomDraftLine(result.data), / · 흐름 3안 중 2번 · 복선 점검: 거둔 것 1 · 고칠 곳 1$/);
  // The folded writer's notes for ③.
  const view = W.roomNotesView(result.data);
  assert.equal(view.summary, '작가 노트 · 인물 3명 · 사이 2 · 흐름 · 심고 거두기 1 · 복선 점검');
  assert.deepEqual(view.sections.map((s) => s.title), ['인물 노트 · 흐름에 맞춰 한 번 고침', '인물 사이', '흐름 · 3안 중 독자단이 고른 2번', '복선 점검 · 고쳐 쓰기 전']);
  assert.equal(W.roomNotesView({room: {chosen: 1}}), null);
  // Resumed: every answer is replayed.
  const bought = calls.length;
  await W.runRoomDrafts(input, outline, {...options(), writerCheckpoint: checkpoint}, {engineFor: () => engine});
  assert.equal(calls.length, bought, 'a resumed run buys nothing');
  // Nothing readable from the cast, the flows or the editor: the book is written anyway, the drafts on the three weaves.
  calls.length = 0;
  engine = engineOf({broken: true});
  const bare = await W.runRoomDrafts({...input, bookId: 's5b'}, outline, options(), {engineFor: () => engine});
  assert.deepEqual(calls.map((c) => c.k), ['cast', 'flow', 'flow', 'flow', 'draft', 'draft', 'draft', 'read', 'threads', 'english']);
  assert.deepEqual([bare.data.room.castNotes, bare.data.room.treatments, bare.data.room.flowChosen, bare.data.room.rewriteSkipped], [[], [], undefined, true]);
  assert.ok(calls.filter((c) => c.k === 'draft').some((c) => /\[초고 2\/3 — 두 줄기로 써 봐요/.test(c.req.user)));
});

test('R56 the estimate: the staged room buys six more answers (three flows, their pick, the revised cast, the thread check); an R55h job and an older one are priced as they were', () => {
  const settings = {engine: 'openai'}, base = {settings, pageCount: 16, diet: true, editor: true, room: true};
  const staged = estimateStoryTextCost({...base, roomWide: false}), r55h = estimateStoryTextCost({...base, roomStages: false}), older = estimateStoryTextCost({...base, roomWeave: false});
  const requests = (est) => est.stages.reduce((n, s) => n + s.requestCount, 0), total = (est) => est.stages.reduce((n, s) => n + (Number(s.costUsd) || 0), 0);
  assert.deepEqual([requests(older), requests(r55h), requests(staged)], [10, 11, 17]);
  assert.deepEqual(staged.stages.filter((s) => /Flow|Revise|Threads/.test(s.stage)).map((s) => [s.stage, s.requestCount]), [['roomFlows', 3], ['roomFlowPick', 1], ['roomCastRevise', 1], ['roomThreads', 1]]);
  assert.ok(Math.abs(total(older) - 1.188) < 0.01 && Math.abs(total(r55h) - 1.288) < 0.01 && Math.abs(total(staged) - 1.704) < 0.01, `${total(older).toFixed(3)} ${total(r55h).toFixed(3)} ${total(staged).toFixed(3)}`);
  const job = (room) => ({status: 'running', input: {writersRoom: room, promptDiet: {version: 1}, pageCount: 16}, completed: {}, textSettings: settings, usage: {calls: []}});
  const left = (room) => jobTextBudget(job(room)).remainingUsd;
  assert.ok(left({version: 1, weave: 2}) > left({version: 1, weave: 1}) && left({version: 1, weave: 1}) > left({version: 1}));
  assert.ok(left({version: 1, weave: 3}) > left({version: 1, weave: 2}), 'R57: a wide job\'s premises are a longer answer');
});

test('R56 ③ shows the writer\'s notes folded under the room line (no button added); a job without them shows nothing', async () => {
  const {renderSimpleCreate, ensureSimpleWizard} = await import('../dist/simple-create.js');
  const state = setup();
  const room = {chosen: 1, drafts: [{title: 'a', pages: 8}], rows: [], castNotes: NOTES.map((n) => ({...n, turn: `${n.name}의 결정`})), castRevised: true, ties: TIES, treatments: [FLOW(1), FLOW(2), FLOW(3)], flowChosen: 2, threads: {kept: [{what: '빨래집게', from: 2, to: 7}], loose: [], unplanted: [{what: '<우산>', page: 6}]}, levelNotes: []};
  const pages = Array.from({length: 8}, (_, i) => ({pageNo: i + 1, ko: `${i + 1}쪽.`, en: `Page ${i + 1}.`}));
  const job = {id: 'auto-r56', status: 'text-review', stopBefore: 'text', wizard: {simpleFlow: true, topic: wizard.topic}, input: {topic: wizard.topic}, completed: {outline: true, pagination: true}, roomDraft: {title: 't', pages, room}, book: {id: 'b-r56', title: 't', pages: pages.map((p) => ({...p, textKo: p.ko, textEn: p.en})), characterIds: ['yuha'], backgroundIds: ['home']}, updatedAt: '2026-11-09T00:00:00Z'};
  state.fullAutoJobs = {[job.id]: job};
  const ctx = (w) => { let wiz = w; return {getState: () => state, getWizard: () => wiz, setWizard: (v) => { wiz = v; }, getDraft: () => null, setDraft: () => {}, getEditPage: () => 0, setEditPage: () => {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''}; };
  const html = renderSimpleCreate(ctx(ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: job.id})));
  assert.match(html, /<details class="simple-council-details simple-room-notes"><summary>작가 노트 · 인물 3명 · 사이 2 · 흐름 · 심고 거두기 1 · 복선 점검<\/summary>/);
  assert.match(html, /<strong>흐름 · 3안 중 독자단이 고른 2번<\/strong>/);
  assert.match(html, /<li>앞에 없이 나온 것 · &lt;우산&gt; \(6쪽\)<\/li>/, 'model text is escaped');
  const notes = html.slice(html.indexOf('simple-room-notes'), html.indexOf('</details>', html.indexOf('simple-room-notes')));
  assert.doesNotMatch(notes, /<button/);
  job.roomDraft = {title: 't', pages, room: {chosen: 1, drafts: [{title: 'a', pages: 8}], rows: [], levelNotes: []}};
  assert.doesNotMatch(renderSimpleCreate(ctx(ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: job.id}))), /simple-room-notes/);
});
