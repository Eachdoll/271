import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getLevelSpec} from '../dist/reading-levels.js';
import {seedState, safeTopic} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {inputFromWizard, storyIdeaFor} from '../dist/story-generation/ui.js';
import {runStoryCouncil, chairScores} from '../dist/story-generation/council.js';
import {renderCouncilReviewForm} from '../dist/story-generation/council-room.js';
import {leanOutlineRules, leanBeatWriterRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {storyDramaViolations, storyDramaWriterLine, storyDramaOutlineRule, dramaPitchInstructions} from '../dist/story-generation/story-drama.js';
import {ecoInput} from '../dist/eco-mode.js';
import {
  IDEA_DECK, IDEA_SLOTS, drawIdea, storyIdeaRef, ideaOf, ideaRepeatsTries, ideaOutlineBlock, ideaWriterLine, ideaDirection, ideaSummary,
  recentIdeaIds, sparkTopic, roomDevices, ideaCandidateLines, ideaGrowthLine, ideaInputFor, withoutDevice, withDevice, pitchMaterials, pitchMaterialsLine, ROOM_ANGLES,
} from '../dist/story-generation/idea-deck.js';

/**
 * R46 아이디어 카드 (2026-10-29). A new draft freezes input.storyIdea
 * {version: 1, cards: {spark?, cast, device?, ending}, from}: ① '아이디어 뽑기'
 * draws all four and fills the topic from the spark; otherwise cast, device and
 * ending come from the topic's seed (the device left to the writers' room when
 * one weighs three candidates — each candidate gets its own device, kind of
 * turn and curve shape, so the three really differ). The room's record keeps
 * the drawer materials so each candidate card says who and where it uses.
 * The device "same plan again" lets the R39 tries share a kind.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'forest'], topic: '우주 정거장으로 편지 띄우기', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}) => normalizeStoryInput({...inputFromWizard(state, wizard(extra)).input, bookId: 'r46'});

test('R46 the deck: four slots, unique ids, spark topics that are safe one-liners, no real books or authors', () => {
  assert.deepEqual(IDEA_SLOTS, ['spark', 'cast', 'device', 'ending']);
  assert.equal(IDEA_DECK.spark.length, 24);
  assert.equal(IDEA_DECK.cast.length, 8);
  assert.equal(IDEA_DECK.device.length, 10);
  assert.equal(IDEA_DECK.ending.length, 6);
  const ids = IDEA_SLOTS.flatMap((slot) => IDEA_DECK[slot].map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const card of IDEA_DECK.spark) {
    assert.equal(card.topics.length, 2, card.id);
    for (const topic of card.topics) {
      assert.ok(safeTopic(topic).ok, topic);
      assert.ok(topic.length <= 24, topic);
      assert.doesNotMatch(topic, /[!?]/, topic);
    }
  }
  for (const slot of IDEA_SLOTS) for (const c of IDEA_DECK[slot]) assert.ok(c.name && c.ko && c.en, c.id);
  assert.equal(IDEA_DECK.device.find((c) => c.id === 'same_plan').sameTry, true);
  const module = readFileSync(new URL('../dist/story-generation/idea-deck.js', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /Haughton|호튼|Oh No, George|Shh! We Have a Plan|Little Owl Lost|A Bit Lost|Goodnight Already/i);
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v(?:9[6-9])";/);
  assert.match(sw, /"\.\/story-generation\/idea-deck\.js",/);
});

test('R46 drawing: one card per slot from the seed, the latest books last, K1 skips the see-past-the-hero devices, the spark optional', () => {
  const a = drawIdea({seed: 's1'}), b = drawIdea({seed: 's1'});
  assert.deepEqual(a, b, 'the seed decides');
  assert.deepEqual(Object.keys(a.cards), IDEA_SLOTS);
  assert.equal(a.from, 'pick');
  const auto = drawIdea({seed: 's1', spark: false});
  assert.equal('spark' in auto.cards, false);
  assert.equal(auto.from, 'auto');
  // The latest books' cards come last.
  const recent = [a.cards.cast, a.cards.device, a.cards.ending];
  const next = drawIdea({seed: 's1', recentIds: recent});
  for (const slot of ['cast', 'device', 'ending']) assert.notEqual(next.cards[slot], a.cards[slot], slot);
  for (let i = 0; i < 40; i++) assert.ok(!['misreads', 'child_sees'].includes(drawIdea({seed: `k${i}`, k1: true}).cards.device));
  // A spark's own example topic, never the current one.
  assert.ok(IDEA_DECK.spark[0].topics.includes(sparkTopic(IDEA_DECK.spark[0].id, '', 'x')));
  assert.equal(sparkTopic(IDEA_DECK.spark[0].id, IDEA_DECK.spark[0].topics[0], 'x'), IDEA_DECK.spark[0].topics[1]);
  // The book record and the recent ids.
  assert.deepEqual(recentIdeaIds([{usedElements: {idea: {cast: 'odd_one', device: 'same_plan', ending: 'starts_again'}}}, {usedElements: {idea: {cast: 'nope'}}}]), ['odd_one', 'same_plan', 'starts_again']);
});

test('R46 the frozen reference: cast and ending required, spark and device optional, unknown ids out; the diet only', () => {
  assert.equal(storyIdeaRef(null), null);
  assert.equal(storyIdeaRef({version: 1, cards: {cast: 'odd_one'}}), null, 'no ending');
  assert.deepEqual(storyIdeaRef({version: 1, cards: {cast: 'odd_one', ending: 'starts_again', device: 'nope', spark: 'odd_one'}, from: 'x'}), {version: 1, cards: {cast: 'odd_one', ending: 'starts_again'}, from: 'auto'});
  const ref = {version: 1, cards: {cast: 'odd_one', device: 'same_plan', ending: 'starts_again'}, from: 'auto'};
  assert.equal(ideaOf({storyIdea: ref}), null, 'not a diet draft');
  assert.deepEqual(ideaOf({promptDiet: {version: 1}, storyIdea: ref}), ref);
  assert.equal(ideaRepeatsTries({promptDiet: {version: 1}, storyIdea: ref}), true);
  assert.deepEqual(withoutDevice(ref).cards, {cast: 'odd_one', ending: 'starts_again'});
  assert.ok(withDevice(withoutDevice(ref), 'seed').cards.device, 'a device drawn for a draft with no room');
  assert.equal(ideaInputFor({promptDiet: {version: 1}, storyIdea: withoutDevice(ref)}, 'countdown').storyIdea.cards.device, 'countdown');
  assert.equal(ideaInputFor({promptDiet: {version: 1}, storyIdea: ref}, 'countdown').storyIdea.cards.device, 'same_plan', 'a frozen device is never replaced');
});

test('R46 inputFromWizard: room drafts leave the device to the room, K1 keeps one, the parent\'s draw keeps its spark only for its topic; normalize keeps, the model never sees it', () => {
  const state = setup();
  const k2 = draft(state);
  assert.deepEqual(Object.keys(k2.storyIdea.cards).sort(), ['cast', 'ending']);
  assert.equal(k2.storyIdea.from, 'auto');
  assert.ok(draft(state, {koreanLevel: 'K1', pageCount: 12}).storyIdea.cards.device, 'K1 has no room: the device is frozen');
  state.settings.textGeneration = {...(state.settings.textGeneration || {}), orchestration: false};
  assert.ok(draft(state).storyIdea.cards.device, 'no three candidates: the device is frozen');
  const drawn = {...drawIdea({seed: 'p'}), topic: '우주 정거장으로 편지 띄우기'};
  const picked = draft(state, {storyIdea: drawn});
  assert.deepEqual(picked.storyIdea.cards, drawn.cards);
  assert.equal(picked.storyIdea.from, 'pick');
  const edited = draft(state, {storyIdea: drawn, topic: '바닷가에서 편지 띄우기'});
  assert.equal('spark' in edited.storyIdea.cards, false, 'the topic was rewritten: the spark goes');
  assert.equal(edited.storyIdea.cards.device, drawn.cards.device);
  assert.deepEqual(storyIdeaFor(state, {topic: 'x', storyIdea: drawn}).cards.cast, drawn.cards.cast);
  assert.doesNotMatch(JSON.stringify(leanVisibleInput(k2, 'outline')), /storyIdea/);
  // The eco flow (no room) draws its device.
  assert.ok(ecoInput(k2).storyIdea.cards.device);
});

test('R46 the requests: the outline hears the IDEA block, the writers a spark line, the room a direction; drafts without cards are unchanged', () => {
  const state = setup(), input = draft(state), bare = {...input};
  delete bare.storyIdea;
  const rules = leanOutlineRules(input, {count: 6, attempts: 1});
  assert.match(rules, /IDEA FOR THIS BOOK \(drawn at random so that no two books feel alike — a spark, not a checklist[^\n]*Cast — [^\n]*Ending — /);
  assert.equal(leanOutlineRules(bare, {count: 6, attempts: 1}), rules.replace(/\nIDEA FOR THIS BOOK[^\n]*/, ''), 'only the block differs');
  const outline = {beats: [], bible: {device: 'countdown'}};
  const w = leanBeatWriterRules(input, outline);
  assert.match(w.ko, /\[이 책의 아이디어 — 불씨예요, 점검표가 아니에요\] 인물 짜임 · [^\n]* 장치 · 줄어드는 수: [^\n]* 끝 · /);
  assert.match(w.en, /This book's idea \(a spark, not a checklist\): /);
  assert.doesNotMatch(leanBeatWriterRules(bare, outline).ko, /아이디어/);
  assert.match(ideaDirection(input), /^아이디어: 인물 짜임 .+ · 끝 .+$/);
  assert.match(ideaSummary(input.storyIdea), /^아이디어 · 인물 짜임 .+ · 끝 .+$/);
  assert.equal(ideaWriterLine(bare), '');
  assert.equal(ideaOutlineBlock(bare), '');
});

test('R46 same plan again: the tries may share a kind, the writer says "the same plan again", the room does not zero the ladder', () => {
  const state = setup(), base = draft(state), same = {...base, storyIdea: {version: 1, cards: {cast: 'odd_one', device: 'same_plan', ending: 'starts_again'}, from: 'pick'}};
  const outline = {secret: '창문 뒤 고양이', beats: [{index: 1, type: 'setup'}, {index: 2, type: 'want'}, {index: 3, type: 'attempt', tryKind: 'trick', consequence: '그물이 찢어져요'}, {index: 4, type: 'attempt', tryKind: 'trick', consequence: '풀이 쏟아져요'}, {index: 5, type: 'turn'}]};
  assert.deepEqual(storyDramaViolations(outline, same), []);
  assert.match(storyDramaViolations(outline, base).map((v) => v.message).join(' '), /서로 달라야/);
  // A room-chosen device on the outline's bible counts too.
  assert.deepEqual(storyDramaViolations({...outline, bible: {device: 'same_plan'}}, base), []);
  assert.match(storyDramaOutlineRule(same), /the same plan tried again: the attempt beats may share a kind/);
  assert.match(storyDramaOutlineRule(base), /Two attempt beats never share a kind\./);
  assert.match(storyDramaWriterLine(outline, outline.beats[3]), /이번에도 같은 계획을 꾀로 다시 해 봐요 — 이번엔 새로운 방식으로 어긋나요/);
  assert.match(storyDramaWriterLine(outline, outline.beats[2]), /앞 시도와 다른 방법이에요/);
  assert.match(dramaPitchInstructions(3, {sameTry: true}), /같은 종류를 다시 써도 되지만/);
  assert.equal(dramaPitchInstructions(3), dramaPitchInstructions(3, {sameTry: false}));
  const editor = [{ladder: 2, stakes: 2, lowPoint: 2, turn: 2, payoff: 2, direction: 2}];
  const repeat = [{tryKinds: ['trick', 'trick']}];
  assert.ok(chairScores(editor, [null], [null], 1, repeat)[0].editor < chairScores(editor, [null], [null], 1, [{...repeat[0], device: 'same_plan'}])[0].editor);
});

const roomInput = () => normalizeStoryInput({bookId: 'r46', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'haeni', name: '해니', nameEn: 'Haeni'}, {id: 'dongdong', name: '동동', nameEn: 'Dongdong'}, {id: 'toto', name: '토토', nameEn: 'Toto'}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'station', name: '우주 정거장'}, {id: 'post', name: '편지방'}], topic: '우주 정거장으로 편지 띄우기', pageCount: 12, language: 'bilingual', endingType: 'home_sleep', moral: '', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, craftPolicy: {version: 1}, arcPolicy: {version: 1}, councilPolicy: {version: 1}, orchestrationPolicy: {version: 1, writerTier: 'medium'}, promptDiet: {version: 1}, storyIdea: {version: 1, cards: {cast: 'grown_ups_busy', ending: 'small_question'}, from: 'auto'}});
const pitch = (angle, who) => ({title: `${angle} 편지`, logline: `${who}가 편지를 띄워요`, stakes: '동동이 기다려요', planted: {name: '종이별', nameEn: 'a paper star', firstSeen: '책상'}, ladder: ['접어요', '던져요'], lowPoint: '"안 되나 봐"', turn: {seen: '편지방 창', realized: '"저기다!"', overturns: '큰 게 좋다는 생각'}, payoff: '창으로 넣어요', echo: '책상 위 별', angle, tension: [1, 2, 3, 3, 4, 2, 1]});
function room() {
  return {id: 'openai', calls: [], async complete(req) {
    this.calls.push(req);
    const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
    const user = String(req.user), system = String(req.system);
    if (/\[성장 설계 — 후보를 쓰기 전에/u.test(user)) return reply({growth: {want: '멋진 편지 보내기', need: '받는 이를 떠올리기', flaw: '서두름'}, theme: '마음', lesson: '받는 사람을 생각해요'});
    if (/\[피치 1개 쓰기\]/u.test(user)) {
      const angle = /angle="(\w+)"/u.exec(user)[1];
      return reply({pitch: pitch(angle, angle === 'humor' ? '유하와 토토' : angle === 'heart' ? '유하와 해니, 동동' : '유하')});
    }
    if (/\[바이블 확정\]/u.test(user)) return reply({bible: {...pitch('adventure', '유하'), visual: {pictures: [], motifs: [], plantedPlacementEn: ''}}});
    if (/그림책 편집자/u.test(system)) return reply({verdicts: [1, 2, 3].map((p) => ({pitch: p, stakes: 2, ladder: 2, lowPoint: 2, turn: 2, payoff: 2, direction: p === 2 ? 2 : 1, veto: false, vetoReason: '', fixes: []})), pick: 2});
    if (/아트 디렉터/u.test(system)) return reply({verdicts: [1, 2, 3].map((p) => ({pitch: p, drawableTurn: 2, plantedVisible: 2, lowPointVisible: 2, variety: 2, motifs: [], veto: false, vetoReason: '', fixes: []})), pick: 2});
    if (/세 아이다/u.test(system)) return reply({reactions: [1, 2, 3].map((p) => ({pitch: p, nextQuestion: 2, retell: '창으로 넣었어', retellHasTurn: true, scary: ''})), favorite: 2});
    throw new Error(`unexpected request: ${user.slice(0, 60)}`);
  }};
}

test('R46 the room: three candidates with their own device, turn and curve shape; the growth leaves the solution open; the bible carries the chosen device; each card says who and where', async () => {
  const input = roomInput(), devices = roomDevices(input);
  assert.equal(new Set(Object.values(devices)).size, 3, 'three different devices');
  assert.deepEqual(Object.keys(devices), Object.keys(ROOM_ANGLES));
  const parent = {...input, storyIdea: {...input.storyIdea, cards: {...input.storyIdea.cards, device: 'same_plan'}}};
  assert.deepEqual(Object.values(roomDevices(parent)), ['same_plan', 'same_plan', 'same_plan'], 'the parent\'s device for all three');
  assert.equal(roomDevices({...input, storyIdea: undefined}), null);
  assert.equal(ideaCandidateLines({...input, storyIdea: undefined}, 'heart', 'countdown'), '');
  const engine = room();
  const result = await runStoryCouncil(input, {engine}, {engineFor: async () => engine});
  const users = engine.calls.map((c) => String(c.user));
  assert.ok(users[0].includes(ideaGrowthLine(input)), 'the growth design leaves the solution to the candidates');
  const candidates = users.filter((u) => /\[피치 1개 쓰기\]/u.test(u));
  assert.equal(candidates.length, 3);
  const deviceLines = candidates.map((u) => /\[이번 후보의 장치\] ([^\n]+)/u.exec(u)[1]);
  assert.equal(new Set(deviceLines).size, 3, 'each candidate hears its own device');
  const turns = candidates.map((u) => /\[이번 후보의 반전\] ([^\n]+)/u.exec(u)[1]);
  assert.equal(new Set(turns).size, 3, 'each its own kind of turn');
  const curves = candidates.map((u) => /\[이번 후보의 곡선 모양\] ([^\n]+)/u.exec(u)[1]);
  assert.equal(new Set(curves).size, 3, 'each its own curve shape');
  for (const u of candidates) assert.match(u, /\[말\] 제목·한 줄 줄거리와 모든 글은 한국어로만/u);
  assert.match(String(engine.calls[1].user + engine.calls[2].user + engine.calls[3].user), /작은 표시를 다시 보는 반전은 쓰지 않는다/u);
  const record = result.record;
  for (const p of record.pitches) assert.equal(p.device, devices[p.angle]);
  assert.equal(record.bible.device, record.pitches[record.chosen.pick - 1]?.device ?? record.bible.device);
  assert.ok(record.bible.device);
  assert.deepEqual(record.materials.characters.map((c) => c.name), ['유하', '해니', '동동', '토토']);
  // Who and where, measured from each pitch's own text.
  const heart = record.pitches.find((p) => p.angle === 'heart');
  assert.deepEqual(pitchMaterials(heart, record.materials).characters.map((c) => c.name), ['유하', '해니', '동동']);
  assert.equal(pitchMaterialsLine(heart, record.materials), '등장인물 3명 · 유하·해니·동동 (고른 4명 중) / 장소 1곳 · 편지방 (고른 3곳 중)');
  const form = renderCouncilReviewForm({...record, recommended: 2});
  assert.match(form, /<span class="pitch-materials">등장인물 3명 · 유하·동동·토토 \(고른 4명 중\) \/ 장소 1곳 · 편지방 \(고른 3곳 중\)<\/span>/u);
  assert.match(form, /pitch-device">장치 · /u);
  // A record without materials (an older meeting) shows no line.
  assert.doesNotMatch(renderCouncilReviewForm({...record, materials: undefined, recommended: 2}), /pitch-materials/u);
  // Resume replays without a call and keeps the devices.
  const again = room();
  const saved = [];
  const first = room();
  await runStoryCouncil(input, {engine: first, onCheckpoint: (cp) => saved.push(cp)}, {engineFor: async () => first});
  const replay = await runStoryCouncil(input, {engine: again, councilCheckpoint: saved.at(-1).councilCheckpoint}, {engineFor: async () => again});
  assert.equal(again.calls.length, 0);
  assert.deepEqual(replay.record.pitches.map((p) => p.device), result.record.pitches.map((p) => p.device));
});
