import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getLevelSpec} from '../dist/reading-levels.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {normalizeStoryInput, generateOutline} from '../dist/story-generation/pipeline.js';
import {OUTLINE_SCHEMA, assertValid, STORY_STAGE_LABELS} from '../dist/story-generation/schemas.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {isCouncilHold, normalizeCouncilChoice, councilPolicy, hasCouncilPolicy, COUNCIL_CALLS, readerCard, readerAge, directionLine, conditionBlock, runStoryCouncil, attachCouncil, chairScores, bibleOutlineRules, bibleBriefRules, biblePaginationRules, biblePictureRules, appendDecision, recordParentDecision, councilSummaryLine, renderCouncilCard, councilReportRows, MAX_DECISIONS} from '../dist/story-generation/council.js';
import {generateQualityOutline} from '../dist/story-generation/quality-adapter.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import {buildStopReport} from '../dist/story-generation/stop-report.js';
import {inspectChildStory} from '../dist/story-generation/quality-gates.js';
import * as qualityModule from '../story-quality/dist/pipeline.js';

/**
 * 2026-10-20 R20 기획 회의: before the outline, four roles with different
 * standards meet once in structured JSON (author pitches, editor, art
 * director, a reader of the book's own age); the chair is code (direction,
 * conditions, vetoes, scores, the decision log). The bible binds the outline,
 * the briefs, the pagination and the pictures. Drafts without the policy never
 * meet and send byte-identical requests.
 */
function baseInput(extra = {}) {
  return {bookId: 'council', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha', traits: ['관찰하는 아이', '씩씩함']}, {id: 'toto', name: '토토', nameEn: 'Toto', traits: ['느긋한 친구']}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'pond', name: '연못 길'}], topic: '비 오는 날 달팽이 찾기', pageCount: 12, language: 'bilingual', endingType: 'home_sleep', moral: '함께 기다리기', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, craftPolicy: {version: 1}, arcPolicy: {version: 1}, ...extra};
}
const councilInput = (extra = {}) => normalizeStoryInput(baseInput({councilPolicy: {version: 1}, ...extra}));
const clone = v => JSON.parse(JSON.stringify(v));
const legacyInput = (extra = {}) => normalizeStoryInput(baseInput(extra));

const pitch = (n, planted = '작은 종') => ({title: `피치 ${n}`, logline: `유하가 ${planted} 소리를 따라가요 ${n}`, stakes: '못 찾으면 토토와 약속한 저녁 노래를 못 불러요', planted: {name: planted, nameEn: 'a small bell', firstSeen: '거실 가방 고리에 매달려 흔들림'}, ladder: ['꿀길로 뛰어가 발이 붙음', '풍차에 올라가 무당벌레만 봄'], lowPoint: '유하가 젖은 손을 보며 "그냥 집에 갈까" 하고 작게 말해요', turn: {seen: '개울 돌 틈에서 흔들리는 작은 종', realized: '"내 종이잖아!"', overturns: '남의 자전거 종이 아니라 유하가 떨어뜨린 종'}, payoff: '유하가 종을 짜서 길게 울리고 토토가 대답해요', echo: '머리맡의 종을 살짝 한 번 울리고 잠들어요'});
/** A scripted room: the author's three pitches, the three verdicts, the bible, then an outline. */
function roomEngine({vetoAllFirst = false} = {}) {
  let pitchRounds = 0;
  const engine = {id: 'openai', calls: [], async complete(req) {
    this.calls.push(req);
    const system = String(req.system), user = String(req.user);
    const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
    if (/20년 써 온 작가/u.test(system) && /\[피치 3개 쓰기\]/u.test(user)) {
      pitchRounds++;
      // A second round brings different pitches (identical ones would replay from the journal).
      const tag = vetoAllFirst && pitchRounds > 1 ? ' 다시' : '';
      return reply({pitches: [pitch(1), pitch(2, '빨간 장화'), pitch(3, '노란 우산')].map(p => ({...p, title: `${p.title}${tag}`}))});
    }
    if (/\[바이블 확정\]/u.test(user)) return reply({bible: {...pitch(2, '빨간 장화'), title: '빨간 장화의 종', visual: {pictures: [1, 2, 3, 4, 5, 6, 7].map(i => ({beatIndex: i, ko: `${i}비트 그림`, en: `Yuha holds a red boot on beat ${i}`})), motifs: [{ko: '빨간 장화', en: 'red boots'}, {ko: '물방울', en: 'raindrops'}], plantedPlacementEn: 'by the front door, tipped over'}}});
    if (/그림책 편집자/u.test(system)) {
      const veto = vetoAllFirst && pitchRounds === 1;
      return reply({verdicts: [{pitch: 1, stakes: 2, ladder: 1, lowPoint: 2, turn: 2, payoff: 2, direction: 1, veto, vetoReason: veto ? '방향 미달' : '', fixes: ['시도 2의 대가를 키울 것']}, {pitch: 2, stakes: 2, ladder: 2, lowPoint: 2, turn: 2, payoff: 2, direction: 2, veto, vetoReason: veto ? '방향 미달' : '', fixes: ['바닥 문장을 더 조용하게']}, {pitch: 3, stakes: 0, ladder: 1, lowPoint: 0, turn: 1, payoff: 1, direction: 0, veto: true, vetoReason: '잃는 것이 없음', fixes: []}], pick: 2});
    }
    if (/아트 디렉터/u.test(system)) return reply({verdicts: [{pitch: 1, drawableTurn: 2, plantedVisible: 2, lowPointVisible: 1, variety: 2, motifs: [{ko: '종', en: 'bell'}], veto: false, vetoReason: '', fixes: []}, {pitch: 2, drawableTurn: 2, plantedVisible: 2, lowPointVisible: 2, variety: 2, motifs: [{ko: '빨간 장화', en: 'red boots'}, {ko: '물방울', en: 'raindrops'}], veto: false, vetoReason: '', fixes: ['반전 펼침면에 장화를 크게']}, {pitch: 3, drawableTurn: 1, plantedVisible: 1, lowPointVisible: 1, variety: 1, motifs: [], veto: false, vetoReason: '', fixes: []}], pick: 2});
    if (/세 아이다/u.test(system)) return reply({reactions: [{pitch: 1, nextQuestion: 2, retell: '종이 울렸어', retellHasTurn: false, scary: ''}, {pitch: 2, nextQuestion: 2, retell: '유하 장화가 종이었어', retellHasTurn: true, scary: ''}, {pitch: 3, nextQuestion: 1, retell: '우산', retellHasTurn: true, scary: '풍차가 무서워'}], favorite: 2});
    // The outline request (the app path): a demo outline shaped for this input.
    const input = engine.input;
    const o = clone(demoOutline(input)); o.plotContract = demoPlotContract(o, input);
    return reply(o);
  }};
  return engine;
}

test('the wizard freezes the council policy and the parent direction; the model never sees the policy', () => {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '비 오는 날', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', direction: '  절정에서 아이가 아기 여우의 두려움에 공감하게  '};
  const {input} = inputFromWizard(state, wizard);
  assert.deepEqual(input.councilPolicy, {version: 1});
  assert.equal(input.direction, '절정에서 아이가 아기 여우의 두려움에 공감하게');
  const normalized = normalizeStoryInput(input);
  assert.deepEqual(normalized.councilPolicy, {version: 1});
  assert.equal(normalized.direction, '절정에서 아이가 아기 여우의 두려움에 공감하게');
  assert.equal(hasCouncilPolicy(legacyInput()), false);
  assert.equal('direction' in legacyInput(), false, 'no key without a written direction: the input stays byte-identical');
  assert.deepEqual(councilPolicy(), {version: 1});
  assert.equal(STORY_STAGE_LABELS.council, '기획 회의');
});

test('reader cards, the direction line and the condition block come from the level, the parent and the fixed materials', () => {
  assert.equal(readerCard(councilInput()).age, '5~6세');
  assert.equal(readerCard(normalizeStoryInput(baseInput({specs: {ko: getLevelSpec('K1'), en: getLevelSpec('E0')}}))).age, '3~4세');
  assert.equal(readerCard(normalizeStoryInput(baseInput({language: 'en', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E3')}}))).id, 'K2', 'a bilingual book follows its Korean level');
  assert.equal(readerAge(councilInput()), '5세');
  assert.equal(readerAge(legacyInput()), null, 'legacy drafts keep the package age');
  assert.match(directionLine(councilInput()), /^5~6세 독자가 절정에서 '함께 기다리기'을\(를\) 말이 아니라 사건으로 느끼고, 마지막에는 처음의 물건이나 말이 달라진 모습으로 돌아온다\.$/u);
  assert.equal(directionLine(councilInput({direction: '아이가 아기 여우의 두려움에 공감하게'})), '5~6세 독자. 아이가 아기 여우의 두려움에 공감하게');
  assert.match(directionLine(councilInput({moral: '', endingType: 'custom', endingNote: '바닷가에서 노래하며 끝나요'})), /심은 물건이 다시 보이는 순간 '아!'.*부모가 적은 끝\(바닷가에서 노래하며 끝나요\)/u);
  const rows = conditionBlock(councilInput());
  assert.match(rows[0], /^독자: 5~6세 · 집중 8~10분/u);
  assert.match(rows[1], /^분량: 12쪽, 비트 7개 \(setup · want · attempt×2 · turn · resolution · close\)\. 한글 쪽당 2~3문장, 문장당 5~7어절 \/ 영어 쪽당 1~2문장, 문장당 5~9단어$/u);
  assert.match(rows[2], /^끝맺음: 집에 돌아와 차분히$/u);
  assert.match(rows[3], /^가치: 함께 기다리기 — 말로/u);
  assert.match(rows[4], /^등장인물\(고정, 새 인물 금지\): 유하\(yuha: 관찰하는 아이·씩씩함\), 토토\(toto: 느긋한 친구\)$/u);
  assert.match(rows[5], /^장소\(고정, 새 장소 금지\): 집\(home, 집\), 숲길\(forest\), 연못 길\(pond\) — 처음은 집, 끝도 집, 중간은/u);
  assert.match(rows[7], /^소리말 후렴/u, 'K2 Korean book plans a sound refrain');
  const custom = conditionBlock(councilInput({endingType: 'custom', endingNote: '바닷가에서 끝나요'}));
  assert.match(custom[2], /부모가 적은 끝 그대로 — 바닷가에서 끝나요/u);
  assert.match(custom[5], /처음은 집, 중간은/u, 'no home at the end for a custom ending');
});

test('the room: five economy calls, the chair scores with vetoes, the bible is normalised, the log is written; a resume replays without a call', async () => {
  const input = councilInput(), engine = roomEngine(); engine.input = input;
  const saved = [], events = [];
  const result = await runStoryCouncil(input, {engine, onCheckpoint: (cp) => saved.push(cp), onProgress: (e) => events.push(e)}, {engineFor: async () => engine});
  assert.equal(engine.calls.length, COUNCIL_CALLS);
  // R21: the room follows the meeting: a snapshot with the phase and who speaks after every answer.
  const phases = saved.map(cp => cp.councilCheckpoint?.record?.phase).filter(Boolean);
  assert.deepEqual([...new Set(phases)], ['pitches', 'verdicts', 'bible', 'done']);
  const roomEvents = events.filter(e => e.stage === 'council' && e.council);
  assert.deepEqual(roomEvents[0].council.roles, {chair: 'speaking', author: 'speaking', editor: 'waiting', art: 'waiting', reader: 'waiting'});
  const judging = roomEvents.find(e => e.phase === 'verdicts');
  assert.deepEqual(judging.council.roles, {chair: 'waiting', author: 'done', editor: 'speaking', art: 'speaking', reader: 'speaking'});
  assert.equal(judging.council.pitches.length, 3);
  const landed = roomEvents.filter(e => e.phase === 'verdicts' && e.council.verdicts);
  assert.ok(landed.length >= 3, 'each verdict lands in the room as it arrives');
  assert.ok(landed.some(e => e.council.roles.editor === 'done' && e.council.verdicts.editor));
  const bibleEvent = roomEvents.find(e => e.phase === 'bible');
  assert.deepEqual(bibleEvent.council.roles, {chair: 'done', author: 'speaking', editor: 'done', art: 'done', reader: 'done'});
  assert.equal(bibleEvent.council.chosen, 2);
  assert.equal(roomEvents.at(-1).phase, 'done');
  assert.equal(roomEvents.at(-1).council.bible.title, '빨간 장화의 종');
  const {record} = result;
  assert.equal(record.pitches.length, 3);
  assert.equal(record.chosen, 2);
  assert.equal(record.overrode, false);
  assert.deepEqual(record.scores.map(r => [r.pitch, r.editor, r.art, r.reader, r.vetoes.length]), [[1, 10, 7, 2, 1], [2, 12, 8, 4, 0], [3, 3, 4, 3, 1]]);
  assert.deepEqual(record.scores[1], {pitch: 2, editor: 12, art: 8, reader: 4, score: 12, vetoes: []});
  assert.match(record.scores[0].vetoes[0], /^독자: 반전을 되말하지 못함/u);
  assert.match(record.scores[2].vetoes[0], /^편집자: 잃는 것이 없음/u);
  assert.equal(record.bible.title, '빨간 장화의 종');
  assert.equal(record.bible.visual.pictures.length, 7);
  assert.equal(record.bible.visual.revealBeat, 5);
  assert.deepEqual(record.bible.visual.motifs, [{ko: '빨간 장화', en: 'red boots'}, {ko: '물방울', en: 'raindrops'}]);
  assert.equal(record.bible.visual.plantedPlacementEn, 'by the front door, tipped over');
  assert.deepEqual(record.decisions.map(d => d.kind), ['proposed', 'reviewed', 'reviewed', 'reviewed', 'dropped', 'dropped', 'adopted', 'revised']);
  assert.match(record.decisions.at(-1).why, /반영한 지적 2개: 바닥 문장을 더 조용하게 \/ 반전 펼침면에 장화를 크게/u);
  assert.equal(result.meta.requests, 5);
  assert.equal(result.usage.input, 50);
  // The requests: the direction and the conditions go to every bot, the reader speaks as a 5-year-old.
  const [pitches, editor, art, reader, bible] = engine.calls;
  for (const call of [pitches, editor, art]) assert.match(call.user, /\[방향\] 5~6세 독자가 절정에서[\s\S]*\[조건\]\n1 독자: 5~6세/u);
  assert.match(editor.user, /\[점검표 — 항목마다 0\(없음\)·1\(약함\)·2\(분명함\)\]\n1 stakes:/u);
  assert.doesNotMatch(editor.user, /\[참조/u, 'no references yet: the slot stays empty');
  assert.match(reader.system, /^너는 5세 아이다\. 글을 못 읽고 소리로만 듣는다\./u);
  assert.match(bible.user, /\[고른 피치\]\n\{"title":"피치 2"/u);
  assert.match(bible.user, /\[고칠 점\]\n1 바닥 문장을 더 조용하게\n2 반전 펼침면에 장화를 크게/u);
  assert.equal(pitches.jsonSchema.properties.pitches.items.properties.ladder.minItems, 2, 'two attempts for seven beats');
  // Resume: the checkpoint replays every answer; nothing is bought.
  const checkpoint = saved.at(-1).councilCheckpoint;
  assert.equal(checkpoint.kind, 'council');
  assert.equal(Object.keys(checkpoint.completed).length, 5);
  assert.equal(checkpoint.record.chosen, 2, 'the record rides on the checkpoint for the stop report');
  const again = roomEngine(); again.input = input;
  const replay = await runStoryCouncil(input, {engine: again, councilCheckpoint: checkpoint}, {engineFor: async () => again});
  assert.equal(again.calls.length, 0);
  assert.equal(replay.meta.requests, 0);
  assert.equal(replay.meta.resumedCalls, 5);
  assert.deepEqual(replay.record.bible, record.bible);
  // References, when supplied, reach the editor only.
  const refEngine = roomEngine(); refEngine.input = input;
  await runStoryCouncil(input, {engine: refEngine, councilReferences: ['예시 카드: 심은 물건 …']}, {engineFor: async () => refEngine});
  assert.match(refEngine.calls[1].user, /\[참조 — 좋은 책의 뼈대 카드[^\]]*\]\n예시 카드: 심은 물건 …/u);
  assert.doesNotMatch(refEngine.calls[2].user, /예시 카드/u);
});

test('when every pitch is vetoed the author pitches once more with the reasons; the chair then picks the best', async () => {
  const input = councilInput(), engine = roomEngine({vetoAllFirst: true}); engine.input = input;
  const {record} = await runStoryCouncil(input, {engine}, {engineFor: async () => engine});
  assert.equal(engine.calls.length, COUNCIL_CALLS + 4, 'pitches + 3 verdicts twice, then the bible');
  assert.match(engine.calls[4].user, /\[이전 피치의 거부 사유[^\]]*\]\n피치 1: 편집자: 방향 미달 \/ 독자: 반전을 되말하지 못함\n피치 2: 편집자: 방향 미달/u);
  assert.equal(record.chosen, 2);
  assert.equal(record.overrode, false);
  assert.ok(record.decisions.some(d => d.kind === 'dropped' && /모두 거부권/u.test(d.what)));
  assert.deepEqual(chairScores([{veto: true, vetoReason: 'x'}], [null], [null], 1)[0].vetoes, ['편집자: x'], 'a missing reaction is not a veto');
  assert.deepEqual(chairScores([null], [{veto: true, vetoReason: ''}], [{retellHasTurn: false}], 1)[0].vetoes, ['그림 감독: 그릴 수 없는 반전', '독자: 반전을 되말하지 못함']);
});

test('generateOutline (app path): the room runs first, the bible binds the outline request, usage and requests include the room; a legacy draft is unchanged', async () => {
  // The fixed demo outline is about the wind pipe; only soft rules remain, which the
  // third pass accepts (so the outline stage buys three requests, as before R20).
  const input = councilInput({topic: '바람 피리 찾기'}), engine = roomEngine(); engine.input = input;
  const result = await generateOutline(input, {engine});
  assert.equal(engine.calls.length, COUNCIL_CALLS + 3);
  const outlineRequest = engine.calls[5];
  assert.match(outlineRequest.system, /STORY BIBLE \(binding; settled by the writers' room — author, editor, art director and a 5~6세 reader — before this outline\)\./u);
  assert.match(outlineRequest.system, /\nBeat 1 \(setup\): plant "빨간 장화" where the child can see it: 거실 가방 고리에 매달려 흔들림\nBeat 2 \(want\): .* STAKES \(said in the beat\): 못 찾으면/u);
  assert.match(outlineRequest.system, /Beat 4 \(attempt 2\): 풍차에 올라가 무당벌레만 봄 LOW POINT at its end: 유하가 젖은 손을 보며/u);
  assert.match(outlineRequest.system, /Beat 5 \(turn\): seen: 개울 돌 틈에서 흔들리는 작은 종 \| realized aloud by the protagonist: "내 종이잖아!" \| what it overturns:/u);
  assert.match(outlineRequest.system, /Picture promises \(what the child sees, one per beat\): 1: Yuha holds a red boot on beat 1 · 2: /u);
  assert.match(outlineRequest.system, /Recurring visual motifs: red boots, raindrops$/mu);
  assert.doesNotMatch(JSON.stringify(outlineRequest), /councilPolicy/u);
  assert.equal(result.data.bible.title, '빨간 장화의 종');
  assert.equal(result.data.council.chosen, 2);
  assert.equal(result.data.council.decisions.length, 8);
  assert.equal(result.meta.requests, 8);
  assert.equal(result.meta.council.requests, 5);
  assert.equal(result.usage.input, 80);
  assert.ok(engine.calls.slice(5).every(call => /STORY BIBLE \(binding/u.test(call.system)), 'the repair passes carry the bible too');
  const legacy = legacyInput({topic: '바람 피리 찾기'}), legacyEngine = roomEngine(); legacyEngine.input = legacy;
  const plain = await generateOutline(legacy, {engine: legacyEngine});
  assert.equal(legacyEngine.calls.length, 3);
  assert.ok(legacyEngine.calls.every(call => !/STORY BIBLE/u.test(call.system)));
  assert.ok(!('bible' in plain.data) && !('council' in plain.data));
  assert.equal(plain.meta.requests, 3);
});

const read = async file => JSON.parse(await readFile(new URL(`../story-quality/data/${file}.json`, import.meta.url), 'utf8'));
const goldPart = async part => JSON.parse(await readFile(new URL(`../story-quality/gold/gold_outlines_part${part}.json`, import.meta.url), 'utf8'));
const data = {inventories: await read('inventories'), gestureDictionary: await read('gesture_dictionary'), plotPatterns: await read('plot_patterns'), worldLibrary: await read('worlds'), goldBooks: [...await goldPart(1), ...await goldPart(2)]};
const schema = () => {const v = clone(OUTLINE_SCHEMA); v.required.push('plotContract'); return v;};
const services = (engine) => ({engineFor: async o => o.engine || engine, qualityData: data, qualityModule: async () => qualityModule, outlineRequestSchema: schema, baseSystem: 'APP_BASE_RULES', levelRules: i => `FROZEN_LEVEL_SPECS:${JSON.stringify(i.specs)}`, assertValid, inspectOutlineRules: () => ({valid: true, violations: []})});

test('the quality path puts the story bible rules into every outline request canon', async () => {
  const input = councilInput({storyQuality: {enabled: true, useBeamSearch: false, twoPass: true, patternId: 'mystery_sound', approvedBooks: []}});
  const engine = {id: 'openai', calls: [], async complete(req) { this.calls.push(req); throw new Error('captured'); }};
  await generateQualityOutline(input, {engine, storyBibleRules: 'STORY BIBLE (binding; test)\nBeat 1 (setup): plant "x"'}, services(engine)).catch(() => {});
  assert.match(engine.calls[0].system, /^[\s\S]*STORY BIBLE \(binding; test\)\nBeat 1 \(setup\): plant "x"\n/u);
  const plainEngine = {id: 'openai', calls: [], async complete(req) { this.calls.push(req); throw new Error('captured'); }};
  await generateQualityOutline(input, {engine: plainEngine}, services(plainEngine)).catch(() => {});
  assert.doesNotMatch(plainEngine.calls[0].system, /STORY BIBLE/u);
});

test('the bible binds the scene briefs, the pagination and the pictures; nothing without it', () => {
  const input = councilInput(), outline = clone(demoOutline(input));
  assert.equal(bibleBriefRules(outline), '');
  assert.equal(biblePaginationRules(outline, input), '');
  outline.bible = {...pitch(2, '빨간 장화'), visual: {pictures: [{beatIndex: 1, ko: '장화', en: 'a red boot by the door'}], revealBeat: 5, motifs: [{ko: '물방울', en: 'raindrops'}], plantedPlacementEn: 'by the door'}};
  assert.match(bibleBriefRules(outline), /^\nSTORY BIBLE PICTURES \(binding for pose and props\): beat 1: a red boot by the door\. Beat 1's props include the planted thing "a small bell"\. The turn beat's pose shows the moment of seeing \(개울 돌 틈에서 흔들리는 작은 종\), never a narrated explanation\. Recurring motifs to place as small props where natural: raindrops\.$/u);
  assert.match(biblePaginationRules(outline, input), /^\nREVEAL \(story bible\): the first page of beat 5 \(the turn\) shows 개울 돌 틈에서 흔들리는 작은 종 with the planted thing "a small bell" large and clear; the last page of beat 4 is the low point/u);
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const openings = normalizeStoryInput(inputFromWizard(state, {characterIds: ['yuha'], backgroundIds: [], topic: '비', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'}, {layout: 'openings'}).input);
  // A 12-page openings book has six beats (one per opening), so its turn is beat 4.
  assert.match(biblePaginationRules(outline, openings), /^\nREVEAL SPREAD \(story bible\): beat 4 \(the turn\) is ONE spread entry with cue "reveal" whose scene\.action shows 개울 돌 틈에서 흔들리는 작은 종; the beat before it ends on the low point/u);
  const book = {outline, storyInput: input};
  assert.match(biblePictureRules({book, page: {beatIndex: 1}}), /^PLANTED OBJECT: a small bell is visible in this picture \(by the door\), clearly recognisable but not the centre of attention\.\nMOTIFS: keep raindrops as small recurring details/u);
  assert.match(biblePictureRules({book, page: {beatIndex: 5}}), /^REVEAL: this is the turn; a small bell is seen plainly/u);
  assert.equal(biblePictureRules({book, page: {beatIndex: 3}}), 'MOTIFS: keep raindrops as small recurring details where natural, never replacing the key props.');
  assert.equal(biblePictureRules({book, page: {beatIndex: 1}, cover: true}), '');
  assert.equal(biblePictureRules({book: {outline: clone(demoOutline(input))}, page: {beatIndex: 1}}), '');
});

test('the decision log, the summary line, the card and the stop report rows', () => {
  const target = {};
  for (let i = 0; i < MAX_DECISIONS + 5; i++) appendDecision(target, {by: '의장', kind: 'reviewed', what: `${i}`});
  assert.equal(target.decisions.length, MAX_DECISIONS);
  assert.equal(target.decisions[0].what, '5');
  assert.equal(appendDecision(null, {}), null);
  const outline = {council: {version: 1, direction: '5~6세 독자. 공감', conditions: ['독자: 5~6세'], reader: {id: 'K2', age: '5~6세'}, pitches: [pitch(1), pitch(2, '빨간 장화')], scores: [{pitch: 1, editor: 9, art: 6, reader: 2, score: 8.3, vetoes: ['독자: 반전을 되말하지 못함']}, {pitch: 2, editor: 12, art: 8, reader: 4, score: 12, vetoes: []}], picks: {editor: 2, art: 2, reader: 2}, reactions: [{retell: '종이 울렸어'}, {retell: '장화가 종이었어'}], chosen: 2, overrode: false, decisions: [{at: 'x', by: '의장', kind: 'adopted', what: "피치 2 '피치 2'", why: '점수'}]}, bible: {...pitch(2, '빨간 장화'), visual: {pictures: [], motifs: [{ko: '물방울', en: 'raindrops'}]}}};
  assert.equal(councilSummaryLine(outline), "기획 회의 · 피치 2개 중 '피치 2' 채택 · 편집자 12/12 · 그림 8/8 · 독자 4/4");
  assert.equal(councilSummaryLine({}), '');
  const card = renderCouncilCard(outline);
  assert.match(card, /<details class="story-card story-council"><summary>기획 회의/u);
  assert.match(card, /<li class="council-chosen"><strong>✓ 피치 2<\/strong>/u);
  assert.match(card, /독자\(5~6세\) 되말하기: “장화가 종이었어”/u);
  assert.match(card, /<dt>반전<\/dt><dd>개울 돌 틈에서 흔들리는 작은 종 → “&quot;내 종이잖아!&quot;” →/u);
  assert.match(card, /<ul class="council-log"><li><small>의장 · 채택<\/small> 피치 2 &#39;피치 2&#39; <small>— 점수<\/small><\/li><\/ul>/u);
  assert.equal(renderCouncilCard({}), '');
  recordParentDecision({outline}, '쪽 3 글을 고침', '④에서');
  assert.deepEqual(outline.council.decisions.at(-1).by, '부모');
  assert.equal(recordParentDecision({outline: {}}, 'x'), null, 'no record without a council');
  const rows = councilReportRows({outline});
  assert.equal(rows[1], '## 기획 회의');
  assert.ok(rows.some(r => /^- 피치 2 \(채택\): 피치 2 — /u.test(r)));
  assert.ok(rows.some(r => /^- 바이블: 잃는 것 못 찾으면/u.test(r)));
  assert.deepEqual(councilReportRows({outline: clone(demoOutline(councilInput()))}), []);
  const fromCheckpoint = councilReportRows({councilCheckpoint: {record: outline.council}});
  assert.equal(fromCheckpoint[1], '## 기획 회의', 'a job that stopped before its outline still reports the meeting');
  const job = {id: 'j', status: 'failed', phase: '줄거리', error: 'x', input: councilInput(), outline, textSettings: {engine: 'openai', providers: {}, storyQuality: {enabled: true}}, usage: {calls: []}, completed: {}, failure: {at: '2026-10-20T00:00:00.000Z', step: 'outline', name: 'Error', message: 'x', violations: [], requests: 1}};
  assert.match(buildStopReport(job, {now: new Date('2026-10-20T00:00:00Z')}), /## 기획 회의\n- 방향: 5~6세 독자\. 공감/u);
});

test('the cost estimate counts the room for new jobs only', () => {
  const settings = {engine: 'openai', providers: {}, storyQuality: {enabled: true}};
  const withRoom = estimateStoryTextCost({settings, pageCount: 12, editor: true, council: true}), without = estimateStoryTextCost({settings, pageCount: 12, editor: true});
  const stage = withRoom.stages.find(s => s.stage === 'council');
  assert.equal(stage.requestCount, 5);
  assert.equal(stage.qualityRole, 'cheap');
  assert.equal(without.stages.find(s => s.stage === 'council'), undefined);
  assert.ok(withRoom.costUsd > without.costUsd);
  assert.match(withRoom.note, /^기획 회의 5회\(작가 피치·편집자·그림 감독·독자·바이블\), 인과/u);
  assert.doesNotMatch(without.note, /기획 회의/u);
  assert.equal(withRoom.council, true);
});

test('the child simulator of a council draft speaks at the reader card age; a legacy draft keeps 4세', async () => {
  const outline = {plan: {pattern: 'discovery', planted: '노란 컵'}, logline: '유하가 컵에 빗물을 모아요.', want: '유하가 꽃에 빗물을 주고 싶어요.', beats: [{index: 1, type: 'want', summary: '유하가 노란 컵을 정원으로 가져가요.'}, {index: 2, type: 'turn', summary: '유하가 빗물이 잎 끝에 모인 것을 보고 컵을 옮겨요.'}, {index: 3, type: 'resolution', summary: '유하가 컵에 모은 빗물을 꽃뿌리에 부어요.'}]};
  const prose = {ko: '유하가 컵을 가져가요. 유하가 비를 바라봐요.\n\n유하가 잎 끝의 빗물을 봐요. 유하가 컵을 옮겨요.\n\n유하가 꽃에 물을 주어요. 유하가 집에서 쉬어요.', en: 'Yuha has a cup. Yuha looks at the rain.\n\nYuha sees drops on a leaf. Yuha moves the cup.\n\nYuha waters the flower. Yuha rests at home.', paragraphBeats: {ko: [1, 2, 3], en: [1, 2, 3]}};
  const pagination = {cover: {title: '빗물 한 컵', sceneAction: 'Yuha carries a cup.'}, pages: prose.ko.split('\n\n').map((textKo, index) => ({pageNo: index + 1, beatIndex: index + 1, textKo, textEn: prose.en.split('\n\n')[index], scene: {who: ['yuha'], where: index === 2 ? 'home' : 'garden', action: 'Yuha carries a yellow cup.', props: ['yellow cup'], emotion: 'curious', timeOfDay: 'day'}, variantByCharacter: {yuha: null}, isRefrainPage: false}))};
  const answers = {curiosity: {pages: [1, 2, 3].map(pageNo => ({pageNo, score: 2, childQuestion: pageNo === 3 ? null : '다음에는?', why: ''})), dropPages: [], overall: 8}, retell: {retell: ['유하가 꽃에게 물을 주고 싶었어요.', '유하가 잎 끝으로 컵을 옮겼어요.', '유하가 꽃에 빗물을 주었어요.'], coveredBeats: [1, 2, 3], missingCore: [], confusions: [], coherence: 2}};
  const run = async (input) => {
    const engine = {id: 'fake-cheap', calls: [], async complete(request) { this.calls.push(request); return {json: clone(request.system.includes('다음엔?') ? answers.curiosity : answers.retell), usage: {input: 10, output: 5}, meta: {requests: 1}}; }};
    const result = await inspectChildStory(outline, prose, pagination, input, {now: '2026-10-20T00:00:00.000Z', engine});
    return {engine, result};
  };
  const council = await run({language: 'both', storyQuality: {enabled: true, childSimulator: true}, specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, councilPolicy: {version: 1}});
  assert.equal(council.engine.calls.length, 2);
  assert.ok(council.engine.calls.every(call => /5세 아이/u.test(call.system) && !/4세/u.test(call.system)), council.engine.calls.map(c => c.system.slice(0, 60)).join(' | '));
  assert.equal(council.result.meta.childGate.pass, true);
  const legacy = await run({language: 'both', storyQuality: {enabled: true, childSimulator: true}, specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}});
  assert.ok(legacy.engine.calls.every(call => /4세 아이/u.test(call.system)));
  assert.equal(legacy.result.meta.childGate.pass, true);
});

/* ---------- R22 회의 결과 보고 진행 ---------- */
test('R22 councilHold parks the meeting after the chair scores: four calls, phase review, the recommendation, no failure', async () => {
  const input = councilInput(), engine = roomEngine(); engine.input = input;
  const saved = [], events = [];
  const error = await runStoryCouncil(input, {engine, councilHold: true, onCheckpoint: (cp) => saved.push(cp), onProgress: (e) => events.push(e)}, {engineFor: async () => engine}).then(() => null, (e) => e);
  assert.ok(error, 'the meeting stops');
  assert.equal(isCouncilHold(error), true);
  assert.equal(error.name, 'CouncilHold');
  assert.equal(engine.calls.length, COUNCIL_CALLS - 1, 'the bible is not written yet');
  assert.equal(error.usageRecorded, true, 'the rounds were billed through onCheckpoint; a step adds no failed row');
  assert.equal(error.usage.input, 40);
  assert.equal(error.meta.held, true);
  assert.equal(error.meta.requests, 4);
  const record = error.councilCheckpoint.record;
  assert.equal(record.phase, 'review');
  assert.equal(record.recommended, 2);
  assert.equal(record.chosen, null);
  assert.equal(record.parentChoice, null);
  assert.deepEqual(record.roles, {chair: 'speaking', author: 'waiting', editor: 'done', art: 'done', reader: 'done'});
  assert.equal(record.pitches.length, 3);
  assert.deepEqual(record.scores.map(r => r.pitch), [1, 2, 3]);
  assert.deepEqual(record.decisions.at(-1), {...record.decisions.at(-1), by: '의장', kind: 'reviewed', what: "피치 2 '피치 2' 추천", why: '부모님의 선택을 기다림'});
  assert.equal(saved.at(-1).councilCheckpoint.record.phase, 'review', 'the parked room is saved for the screen');
  assert.equal(events.at(-1).phase, 'review');
  assert.match(events.at(-1).message, /^기획 회의 결과 확인/u);
  assert.equal(Object.keys(error.councilCheckpoint.completed).length, 4, 'four paid answers in the journal');
  // Without the hold the same input meets to the end (R20 behaviour).
  const plain = roomEngine(); plain.input = input;
  const result = await runStoryCouncil(input, {engine: plain}, {engineFor: async () => plain});
  assert.equal(plain.calls.length, COUNCIL_CALLS);
  assert.equal(result.record.recommended, 2);
  assert.equal(result.record.parentChoice, null);
});

test('R22 the resumed meeting takes the parent\'s pitch and note: the rounds replay, only the bible is bought, the log says who chose', async () => {
  const input = councilInput(), engine = roomEngine(); engine.input = input;
  const held = await runStoryCouncil(input, {engine, councilHold: true}, {engineFor: async () => engine}).then(() => null, (e) => e);
  assert.equal(engine.calls.length, 4);
  const resumed = await runStoryCouncil(input, {engine, councilHold: true, councilCheckpoint: held.councilCheckpoint, councilChoice: {pick: 1, note: ' 토토가  더 많이 나오게 '}}, {engineFor: async () => engine});
  assert.equal(engine.calls.length, 5, 'only the bible call is new');
  assert.equal(resumed.meta.requests, 1);
  assert.equal(resumed.meta.resumedCalls, 4);
  const bibleRequest = engine.calls[4];
  assert.match(bibleRequest.user, /\[고른 피치\]\n\{"title":"피치 1"/u);
  assert.match(bibleRequest.user, /\[독자 되말하기\] 종이 울렸어\n\n\[부모 메모 — 반드시 반영\] 토토가 더 많이 나오게\n\n\[바이블 확정\]/u);
  const {record} = resumed;
  assert.equal(record.chosen, 1);
  assert.equal(record.recommended, 2);
  assert.equal(record.overrode, true, 'pitch 1 carried a veto; the parent went past it');
  assert.deepEqual(record.parentChoice, {pick: 1, note: '토토가 더 많이 나오게'});
  assert.equal(record.phase, 'done');
  const parent = record.decisions.filter(d => d.by === '부모');
  assert.deepEqual(parent.map(d => [d.kind, d.what, d.why]), [
    ['adopted', "피치 1 '피치 1'", '의장 추천(피치 2) 대신 회의 결과를 보고 고름 · 거부권을 넘어 택함'],
    ['revised', '한마디: 토토가 더 많이 나오게', '작가 봇이 바이블에 반영'],
  ]);
  assert.ok(record.decisions.some(d => d.kind === 'dropped' && d.what.startsWith("피치 2") && d.why === '부모가 다른 피치를 고름'));
  const outline = attachCouncil({}, resumed);
  assert.equal(outline.council.parentChoice.pick, 1);
  assert.equal(outline.council.recommended, 2);
  assert.match(councilSummaryLine(outline), /채택 · 편집자 10\/12 · 그림 7\/8 · 독자 2\/4 · 거부권을 넘어 택함 · 부모가 고름$/u);
  assert.match(renderCouncilCard(outline), /<p class="story-note">부모 선택: 피치 1 \(의장 추천 피치 2 대신\) · 한마디: “토토가 더 많이 나오게”<\/p>/u);
  assert.ok(councilReportRows({outline}).some(row => row === '- 부모 선택: 피치 1 (의장 추천 피치 2 대신) · 한마디: 토토가 더 많이 나오게'));
  // The recommendation kept as is: a byte-identical bible request to the never-parked meeting, logged as the parent's confirmation.
  const again = roomEngine(); again.input = input;
  const held2 = await runStoryCouncil(input, {engine: again, councilHold: true}, {engineFor: async () => again}).then(() => null, (e) => e);
  const confirmed = await runStoryCouncil(input, {engine: again, councilHold: true, councilCheckpoint: held2.councilCheckpoint, councilChoice: {pick: 2}}, {engineFor: async () => again});
  const plain = roomEngine(); plain.input = input;
  await runStoryCouncil(input, {engine: plain}, {engineFor: async () => plain});
  assert.deepEqual(again.calls[4], plain.calls[4], 'no note, same pitch: the same bible request');
  assert.deepEqual(confirmed.record.parentChoice, {pick: 2, note: ''});
  assert.equal(confirmed.record.overrode, false);
  assert.deepEqual(confirmed.record.decisions.filter(d => d.by === '부모').map(d => [d.kind, d.what, d.why]), [['adopted', "피치 2 '피치 2'", '의장 추천대로 회의 결과를 보고 확인']]);
  assert.match(councilSummaryLine(attachCouncil({}, confirmed)), / · 부모 확인$/u);
  assert.deepEqual(normalizeCouncilChoice({pick: '9', note: 'x'}, 3), {pick: null, note: 'x'}, 'an impossible pick falls back to the chair');
  assert.equal(normalizeCouncilChoice(null, 3), null);
});

test('R22 a rewritten direction opens the log of the next meeting; generateOutline parks on the hold and goes on with the choice', async () => {
  const input = councilInput({topic: '바람 피리 찾기', direction: '절정에서 아이가 아기 여우의 두려움에 공감하게'}), engine = roomEngine(); engine.input = input;
  const history = [{kind: 'revised', what: '방향 고침: “반전이 분명하게” → “절정에서 아이가 아기 여우의 두려움에 공감하게”', why: '회의 결과를 보고 부모가 다시 회의를 요청'}];
  const held = await generateOutline(input, {engine, councilHold: true, councilHistory: history}).then(() => null, (e) => e);
  assert.equal(isCouncilHold(held), true);
  assert.equal(engine.calls.length, 4, 'no outline request before the parent chose');
  assert.deepEqual(held.councilCheckpoint.record.decisions[0], {...held.councilCheckpoint.record.decisions[0], by: '부모', kind: 'revised', what: history[0].what, why: history[0].why});
  assert.match(held.councilCheckpoint.record.direction, /^5~6세 독자\. 절정에서 아이가/u);
  const result = await generateOutline(input, {engine, councilHold: true, councilHistory: history, councilCheckpoint: held.councilCheckpoint, councilChoice: {pick: 2, note: '바닥은 덜 무섭게'}});
  assert.equal(engine.calls.length, 4 + 1 + 3, 'the bible, then the outline passes (soft issues → three outline calls, as in R20)');
  assert.equal(result.data.council.parentChoice.note, '바닥은 덜 무섭게');
  assert.equal(result.data.council.decisions[0].by, '부모');
  assert.equal(result.meta.council.requests, 1);
  assert.equal(result.meta.requests, 4);
  assert.match(engine.calls[5].system, /STORY BIBLE \(binding/u);
  // A legacy draft and a council draft without the hold are untouched by these options.
  const legacy = legacyInput({topic: '바람 피리 찾기'}), legacyEngine = roomEngine(); legacyEngine.input = legacy;
  const plain = await generateOutline(legacy, {engine: legacyEngine, councilHold: true, councilChoice: {pick: 1}});
  assert.equal(legacyEngine.calls.length, 3);
  assert.ok(!('council' in plain.data));
});
