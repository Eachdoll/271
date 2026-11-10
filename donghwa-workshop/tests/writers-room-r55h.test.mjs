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
 * R55h (2026-11-09): "the characters are simple and so is the conflict — what
 * is there besides adding rules?" Five things that are not rules on the
 * story: richer material (the cast speaks before the drafts), varied
 * candidates (three drafts woven three ways), a different selection pressure
 * (the readers say what came back and whom the story would not miss), a place
 * for the second thread that does not load the K2 text (art notes the pictures
 * carry), and the writer's own process (a backward look in the rewrite) — and
 * the result is measured from the finished pages, never asked of a model.
 * A job frozen before R55h (no weave in its marker) is unchanged.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
/* R56 moved new drafts to weave 2 (the staged room); this file pins weave 1 — a job frozen by R55h keeps exactly these requests. */
const freshInput = (id) => normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: id});
const roomInput = (id) => { const input = freshInput(id); return {...input, writersRoom: {...input.writersRoom, weave: 1}}; };
const preWeave = (input) => { const {weave, ...room} = input.writersRoom; return {...input, writersRoom: room}; };
const PREMISE = {title: '쉿, 콩이', line: '콩이는 늘 유하 등 뒤에 있어요', engine: 'reader_knows', laugh: '엄마도 못 찾아요', picture: '등 뒤의 작은 뿔', cast: [
  {name: '유하', isNew: false, want: '콩이를 찾고 싶다', flaw: '뒤를 안 본다', speech: '"어디 갔지?"', nameEn: '', kind: '', look: ''},
  {name: '엄마', isNew: false, want: '빨래를 걷고 싶다', flaw: '바쁘다', speech: '"응, 그래."', nameEn: '', kind: '', look: ''},
  {name: '콩이', isNew: true, want: '들키고 싶지 않다', flaw: '꼬리가 삐죽', speech: '"쉿."', nameEn: 'Kongi', kind: 'deer', look: 'a small fawn'}]};
const outlineOf = (input) => ({...W.roomOutline(input, {premise: PREMISE, pitches: []}), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [], premises: [PREMISE]}});
const NOTES = [{name: '유하', today: '도토리 열 개를 줍는다', unsaid: '어제 콩이 밥그릇을 엎었다', habit: '주머니에 돌멩이'}, {name: '엄마', today: '비 오기 전에 빨래를 걷는다', unsaid: '콩이를 벌써 봤다', habit: '빨래집게를 옷깃에 꽂는다'}, {name: '콩이', today: '유하 그림자만 밟는다', unsaid: '혼자 있기 싫다', habit: '꼬리를 까딱인다'}];

test('R55h the marker: a new room draft carries weave 1; normalize keeps it; a marker without it stays without it', () => {
  const input = roomInput('h1');
  assert.deepEqual(freshInput('h1').writersRoom, {version: 1, weave: 6}, 'R56: a new draft is a staged room; R57: and a wide one; R59: and a lean one; R60: and a counted one');
  assert.deepEqual(normalizeStoryInput(input).writersRoom, {version: 1, weave: 1}, 'an R55h job keeps weave 1');
  assert.equal(W.hasRoomWeave(input), true);
  assert.equal(W.hasRoomStages(input), false);
  assert.equal(W.hasRoomWeave(freshInput('h1')) && W.hasRoomStages(freshInput('h1')), true);
  assert.deepEqual(W.writersRoomRef({version: 1}), {version: 1});
  assert.deepEqual(W.writersRoomRef({version: 1, weave: 9}), {version: 1});
  assert.equal(W.hasRoomWeave(preWeave(input)), false);
});

test('R55h material: the cast speaks before the drafts — own business, a thing unsaid, a habit; only the premise\'s own names are kept; the drafts receive it as material', () => {
  const input = roomInput('h2');
  const req = W.castNotesRequest(input, PREMISE);
  assert.match(req.system, /오늘 하려던 제 볼일\(today[^)]*\), 주인공에게 말하지 않은 것 하나\(unsaid[^)]*\), 버릇이나 늘 지니는 물건 하나\(habit/);
  assert.match(req.system, /이건 재료예요 — 줄거리를 정하지 않아요\.$/);
  assert.match(req.user, /\[인물표\]\n- 유하: 바람 — 콩이를 찾고 싶다/);
  assert.deepEqual(req.jsonSchema.properties.notes.items.required, ['name', 'today', 'unsaid', 'habit']);
  const settled = W.settleCastNotes({notes: [...NOTES, {name: '유하', today: '둘째 줄', unsaid: '', habit: ''}, {name: '지나가는 곰', today: 'x', unsaid: 'y', habit: 'z'}, {name: '엄마'}, 3]}, PREMISE);
  assert.deepEqual(settled, NOTES, 'one per name, the premise\'s cast only, empty rows dropped');
  assert.equal(W.castNotesBlock([]), '');
  const draft = W.draftRequest(input, PREMISE, {castNotes: NOTES});
  assert.match(draft.user, /\n\n\[인물들이 제 입으로 한 말 — 재료예요, 점검표가 아니에요\. 쓰고 싶은 것만 써요\]\n- 유하: 오늘 하려던 일 — 도토리 열 개를 줍는다; 말 안 한 것 — 어제 콩이 밥그릇을 엎었다; 버릇·물건 — 주머니에 돌멩이\n- 엄마: /);
  assert.match(draft.system, /그림 메모\(art\)를 한 줄 적어요 — 뒤에서 쓰일 것을 미리 놓아 두거나, 조연이 제 볼일을 하는 모습처럼\. 없는 쪽은 적지 않아요\. 그림에는 설명하는 글자나 숫자\(자막, 귀퉁이의 표시\)를 넣을 수 없어요 — 세는 것은 물건의 개수나 몸짓으로 보여요\. 물건에 원래 적혀 있는 짧은 글자\(로켓의 이름, 버스 번호, 간판\)는 한 그림에 하나까지 돼요 — 숫자와 영문 대문자만, 그림 메모에 따옴표로 그대로 적어요\("13", "APOLLO 13"\)\.$/);
  assert.equal(draft.jsonSchema.properties.pages.items.properties.art.maxLength, 200);
  assert.deepEqual(draft.jsonSchema.properties.pages.items.required, ['ko'], 'an art note is never required');
  // A job frozen before R55h: no notes, no art, the old schema object.
  const old = W.draftRequest(preWeave(input), PREMISE, {castNotes: NOTES});
  assert.doesNotMatch(old.user + old.system, /인물들이 제 입으로|그림 메모/);
  assert.equal('art' in old.jsonSchema.properties.pages.items.properties, false);
});

test('R55h variation: the three drafts are woven three ways — straight, two threads, from the end; an older job keeps "be different"', () => {
  const input = roomInput('h3');
  assert.match(W.draftWeaveLine(input, 0, 3), /^\[초고 1\/3 — 한 줄기로 곧게 가요/);
  assert.match(W.draftWeaveLine(input, 1, 3), /^\[초고 2\/3 — 두 줄기로 써 봐요 — 조연 한 사람의 제 볼일이[^\]]*끝에서 두 줄기가 만나요/);
  assert.match(W.draftWeaveLine(input, 2, 3), /^\[초고 3\/3 — 끝에서부터 써 봐요 — 끝 장면을 먼저 정하고, 끝이 쓰는 물건·말·버릇 두세 가지를 앞쪽에/);
  assert.equal(W.draftWeaveLine(preWeave(input), 1, 3), '[초고 2/3 — 다른 초고와 다르게, 네 식대로]');
});

test('R55h selection: the readers say what came back and whom the story would not miss; an echo nudges the pull (never past the votes); the rewrite hears both and looks backward', () => {
  const input = roomInput('h4');
  const drafts = [{title: 'a', pages: [{ko: '가.', art: '창밖에 노란 장화'}, {ko: '나.'}]}, {title: 'b', pages: [{ko: '다.'}]}];
  const req = W.panelReadRequest(input, drafts);
  const row = req.jsonSchema.properties.readers.items.properties.drafts.items;
  assert.deepEqual(row.required.slice(-4), ['echoFrom', 'echoTo', 'echo', 'flat']);
  assert.match(req.system, /처음 나온 쪽\(echoFrom\)·다시 쓰인 쪽\(echoTo\)·그게 무엇인지\(echo\)를 적어요 — 없으면 0·0·빈 문자열, 있는 척하지 않아요; 빠져도 이야기가 그대로일 인물이 있으면 그 이름 하나\(flat/);
  assert.match(req.user, /1쪽: 가\. \[그림: 창밖에 노란 장화\]\n2쪽: 나\./, 'the readers see what only the picture shows');
  const old = W.panelReadRequest(preWeave(input), drafts);
  assert.deepEqual(old.jsonSchema.properties.readers.items.properties.drafts.items.required.slice(-2), ['hardPage', 'mannersPage']);
  assert.doesNotMatch(old.system, /echoFrom|flat/);
  // Draft 1: straight, three votes. Draft 2: three votes too, and four readers saw the boots come back; two would not miss Mom.
  let n = 0; // every reader skips a different page, so no page is 'skipped' (it takes two) and the pull is the votes alone
  const reader = (id, favorite, echo, flat = '', skip = ++n) => ({reader: id, favorite, again: false, drafts: [
    {draft: 1, skipPage: skip, lostPage: 0, laughPages: [], change: '', hardPage: 0, mannersPage: 0, echoFrom: 0, echoTo: 0, echo: '', flat: ''},
    {draft: 2, skipPage: skip, lostPage: 0, laughPages: [], change: '', hardPage: 0, mannersPage: 0, echoFrom: echo ? 3 : 0, echoTo: echo ? 12 : 0, echo: echo ? '노란 장화' : '', flat}]});
  const answer = {readers: [reader('action', 1, false), reader('laugh', 1, true), reader('heart', 1, true, '엄마'), reader('eye', 2, true, '엄마'), reader('ours', 2, true), reader('parent', 2, false)]};
  const rows = W.countReadings(answer, 2);
  assert.equal(rows[0].pull, 12);
  assert.equal(rows[1].pull, 12 + 3, 'four readers saw it; the nudge stops at 3');
  assert.deepEqual([rows[1].echoes, rows[1].echoList, rows[1].flatCast], [4, ['3쪽→12쪽 노란 장화'], ['엄마']]);
  assert.equal('echoes' in rows[0], false, 'a row with no echo has the shape it had before');
  assert.equal(W.pickDraft(rows), 2, 'the tie goes to the draft whose early pages came back');
  const backwards = W.countReadings({readers: [{reader: 'eye', favorite: 1, again: false, drafts: [{draft: 1, skipPage: 1, lostPage: 0, laughPages: [], change: '', echoFrom: 9, echoTo: 4, echo: 'x', flat: ''}]}]}, 1);
  assert.equal(backwards[0].pull, 4, 'an echo that does not name an earlier and a later page is not counted');
  const notes = W.rewriteNotes(rows[1]);
  assert.match(notes, /독자가 알아본 되돌아옴: 3쪽→12쪽 노란 장화 — 살려요\.\n빠져도 그대로일 것 같다는 인물: 엄마 — 제 볼일을 한 번 하게 하거나, 나오는 쪽을 줄여요\./);
  assert.equal(W.nothingToRewrite({boredPages: [], lostPages: [], hardPages: [], mannersPages: [], words: [], flatCast: ['엄마']}), false);
  const rewrite = W.rewriteRequest(input, drafts[0], notes, {castNotes: NOTES});
  assert.match(rewrite.system, /끝에서 거꾸로 읽어, 끝이 쓰는 물건·말·버릇이 앞에서 한 번도 보이지 않았다면 앞쪽 한 곳에 아무렇지 않게 먼저 놓아요 — 그림 메모\(art\) 한 줄이면 충분하고, 글은 한 줄까지; 설명은 붙이지 않아요\./);
  assert.match(rewrite.system, /그림에는 설명하는 글자나 숫자\(자막, 귀퉁이의 표시\)를 넣을 수 없어요 — 세는 것은 물건의 개수나 몸짓으로 보여요\. 물건에 원래 적혀 있는 짧은 글자\(로켓의 이름, 버스 번호, 간판\)는 한 그림에 하나까지 돼요 — 숫자와 영문 대문자만, 그림 메모에 따옴표로 그대로 적어요\("13", "APOLLO 13"\)\. 그림 메모가 설명하는 글자를 그려 넣으라고 하면 그렇게 바꿔 적어요\.$/, 'R56a');
  assert.match(rewrite.user, /\[인물들이 제 입으로 한 말[^\n]*\n- 유하: [^\n]*\n- 엄마: [^\n]*\n- 콩이: [^\n]*\n\n\[독자 반응\]/);
  assert.match(rewrite.user, /1쪽: 가\. \[그림: 창밖에 노란 장화\]/);
  assert.doesNotMatch(W.rewriteRequest(preWeave(input), drafts[0], notes, {castNotes: NOTES}).system, /거꾸로/);
});

test('R55h the run: cast notes first, then the three woven drafts; the art notes ride through the English, the binding and the reading; the resumed run buys nothing; unreadable notes do not stop the book', async () => {
  const input = roomInput('h5'), outline = outlineOf(input);
  const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
  const calls = [];
  const engineOf = ({notes = {notes: NOTES}} = {}) => ({id: 'openai', async complete(req) {
    calls.push(req);
    const props = req.jsonSchema?.properties || {}, items = props.pages?.items?.properties || {};
    if (props.notes) return notes === null ? {text: 'not json at all', usage: {input: 1, output: 1}, meta: {requests: 1, model: 'mock'}} : reply(notes);
    if (props.readers) return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader, i) => ({reader, favorite: 3, again: true, drafts: [1, 2, 3].map((d) => ({draft: d, skipPage: i + 1, lostPage: 0, laughPages: [], change: '', hardPage: 0, mannersPage: 0, echoFrom: d === 3 ? 2 : 0, echoTo: d === 3 ? 7 : 0, echo: d === 3 ? '빨래집게' : '', flat: ''}))}))});
    if (items.en && !items.ko) return reply({pages: Array.from({length: Number(props.pages.minItems)}, (_, i) => ({en: `Page ${i + 1}.`}))});
    const m = /\[초고 (\d)\/3/.exec(req.user);
    if (m) return reply({title: `초고 ${m[1]}`, pages: Array.from({length: 8}, (_, i) => ({ko: `${m[1]}권 ${i + 1}쪽이에요. 유하가 걸어요.`, ...(i === 1 && m[1] === '3' ? {art: '엄마 옷깃에 빨래집게 하나'} : {})}))});
    throw new Error(`unexpected request: ${req.system.slice(0, 40)}`);
  }});
  let engine = engineOf(), checkpoint = null;
  const progress = [];
  const options = () => ({engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine}, roomPolish: false, onProgress: (p) => progress.push(p.phase), onCheckpoint: async (cp) => { checkpoint = cp.writerCheckpoint; }});
  const result = await W.runRoomDrafts(input, outline, options(), {engineFor: () => engine});
  assert.ok(calls[0].jsonSchema.properties.notes, 'the cast speaks first');
  assert.deepEqual(calls.slice(1, 4).map((c) => /\[초고 (\d)\/3 — ([^ ]+ [^ ]+)/.exec(c.user).slice(1).join(':')).sort(), ['1:한 줄기로', '2:두 줄기로', '3:끝에서부터 써']);
  assert.ok(calls.slice(1, 4).every((c) => /인물들이 제 입으로 한 말/.test(c.user)));
  assert.equal(progress[0], 'cast');
  assert.deepEqual(result.data.room.castNotes, NOTES);
  assert.equal(result.data.room.chosen, 3);
  assert.equal(result.data.room.rewriteSkipped, true, 'no page named twice, nothing to change: the pick stands');
  assert.equal(result.data.pages[1].art, '엄마 옷깃에 빨래집게 하나', 'the art note survives the English edition');
  assert.match(W.roomDraftLine(result.data), / · 8쪽 · 인물 노트 3명 · 그림 메모 1쪽 · 독자가 알아본 되돌아옴 1곳$/);
  // Resumed: everything is replayed from the journal.
  const before = calls.length;
  await W.runRoomDrafts(input, outline, {...options(), writerCheckpoint: checkpoint}, {engineFor: () => engine});
  assert.equal(calls.length, before, 'a resumed run buys nothing');
  // The binding keeps the note; the reading request shows it and says what it is.
  const clamped = W.clampPages(result.data.pages, {min: 8, max: 16});
  assert.equal(clamped[1].art, '엄마 옷깃에 빨래집게 하나');
  const joined = W.clampPages([{ko: '가.', art: 'a'}, {ko: '나.', art: 'b'}, {ko: '다.'}], {min: 2, max: 2});
  assert.equal(joined.find((p) => p.art).art, 'a / b', 'joined pages keep both notes');
  const reading = W.extractRequest(input, outline, clamped);
  assert.match(reading.system, /A page may carry the writer's art note \(\[art\] …\): something its picture shows that the words do not say — put it into that page's action and props, and into hidden when someone in the story does not notice it\. A picture cannot hold captions or labels: when a note asks for explanatory words or numbers in the picture \(a count in a corner, a caption\), give countable things or a gesture instead and never write "labeled"; writing that is on a thing in the story's world goes into lettering\./);
  assert.match(reading.user, /2쪽: [^\n]*\n   EN: Page 2\.\n   \[art\] 엄마 옷깃에 빨래집게 하나/);
  assert.doesNotMatch(W.extractRequest(input, outline, [{ko: '가.'}]).system, /A page may carry the writer's art note/, 'no art note, no sentence');
  // Unreadable notes: the drafts are written without them.
  calls.length = 0;
  engine = engineOf({notes: null});
  const bare = await W.runRoomDrafts({...input, bookId: 'h5b'}, outline, options(), {engineFor: () => engine});
  assert.deepEqual(bare.data.room.castNotes, []);
  assert.ok(calls.slice(1, 4).every((c) => !/인물들이 제 입으로 한 말/.test(c.user)));
});

test('R55h measured, not asked: the weave of the finished pages — every character\'s page count, the one-page characters, the things that come back after a gap', () => {
  const page = (who, props) => ({scene: {who, props}});
  const report = W.weaveReport([
    page(['yuha', 'mom'], ['a red Ball', 'clothespins']),
    page(['yuha'], ['basket']),
    page(['yuha', 'kongi'], ['the basket']),
    page(['yuha'], ['acorns']),
    page(['yuha', 'kongi'], ['one clothespin', 'ball']),
  ], {artNotes: 2});
  assert.deepEqual(report.cast, [{id: 'yuha', pages: 5}, {id: 'mom', pages: 1}, {id: 'kongi', pages: 2}]);
  assert.deepEqual(report.single, ['mom']);
  assert.deepEqual(report.returning, [{prop: 'ball', from: 1, to: 5}, {prop: 'clothespin', from: 1, to: 5}], 'the basket on neighbouring pages is not a return');
  assert.equal(report.artNotes, 2);
});

test('R55h the estimate: one more writer call for a weave draft; a room job frozen before R55h is priced as before', () => {
  const settings = {engine: 'openai'};
  const now = estimateStoryTextCost({settings, pageCount: 16, diet: true, editor: true, room: true, roomStages: false});
  const was = estimateStoryTextCost({settings, pageCount: 16, diet: true, editor: true, room: true, roomWeave: false});
  assert.equal(now.stages.find((s) => s.stage === 'roomCastNotes').requestCount, 1);
  assert.equal(was.stages.some((s) => s.stage === 'roomCastNotes'), false);
  const requests = (est) => est.stages.reduce((n, s) => n + s.requestCount, 0);
  assert.equal(requests(now) - requests(was), 1);
  const job = (room) => ({status: 'running', input: {writersRoom: room, promptDiet: {version: 1}, pageCount: 16}, completed: {}, textSettings: settings, usage: {calls: []}});
  assert.ok(jobTextBudget(job({version: 1, weave: 1})).remainingUsd > jobTextBudget(job({version: 1})).remainingUsd);
});
