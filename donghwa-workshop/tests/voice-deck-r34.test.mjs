import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard, storyVoiceFor, renderStoryQualityPlan} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse} from '../dist/story-generation/pipeline.js';
import {leanBeatWriterRules, leanProseRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {approvedBookRecord} from '../dist/story-generation/quality-gates.js';
import {VOICE_DECK, VOICE_SLOTS, VOICE_PALETTE, chooseVoice, voiceRef, voiceBlock, voiceSummary, recentVoiceIds, voiceCardById, fillName} from '../dist/story-generation/voice-deck.js';
import {styleReport, styleSummaryLine, endsInPastYo} from '../dist/story-generation/style-report.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoPagesPrompt, ecoJobInit} from '../dist/eco-mode.js';
import {checkNotes, renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {buildStopReport} from '../dist/story-generation/stop-report.js';

/**
 * 2026-10-23 R34 목소리 카드. The paid manuscripts all read alike (a quarter of
 * the sentences opening on the hero's name, nine in ten ending in -었어요, one
 * in ten with dialogue, no questions). Each new diet draft now freezes a voice
 * — one card per slot (narrator, dialogue, rhythm, ending, opener), chosen
 * from the topic's seed, skipping the latest books' cards, leaning to the
 * story shape — and the writers get the cards with examples plus a palette
 * of what good prose does. Nothing counts it: the style numbers are advisory.
 * Drafts without the diet are byte-identical (R12 pins).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'beach'], topic: '유하가 바닷가에서 조개를 찾아요', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const legacy = (input) => { const copy = structuredClone(input); delete copy.promptDiet; return copy; };
const firstCalls = async (input, outline, {k1 = false} = {}) => {
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); throw new Error('stop after the first request'); }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine, cheap: engine}, ...(k1 ? {} : {})}).catch(() => {});
  return calls;
};

test('R34 the deck: five slots, 30 cards with unique ids, every card with a level list, a Korean card text, an example and (but for endings) an English hint', () => {
  assert.deepEqual(VOICE_SLOTS, ['narrator', 'dialogue', 'rhythm', 'ending', 'opener']);
  const ids = VOICE_SLOTS.flatMap((slot) => VOICE_DECK[slot].map((c) => c.id));
  assert.equal(ids.length, 30);
  assert.equal(new Set(ids).size, 30);
  for (const slot of VOICE_SLOTS) for (const c of VOICE_DECK[slot]) {
    assert.ok(c.levels.length >= 3 && c.ko.length > 10 && c.examples.length >= 1, c.id);
    if (slot !== 'ending') assert.ok(c.en.length > 10, c.id);
    assert.equal(voiceCardById(c.id).slot, slot);
  }
  assert.match(VOICE_PALETTE, /가능성이지 점검표가 아니에요/);
  assert.equal(fillName('{name}은 상자를 열었어요. {name}이 웃어요. {name} 가슴이', '{name}', '유하'), '유하는 상자를 열었어요. 유하가 웃어요. 유하 가슴이');
  assert.equal(fillName('{name}은 왔어요. {name}이 웃어요.', '{name}', '해님'), '해님은 왔어요. 해님이 웃어요.');
});

test('R34 the chooser: deterministic from the seed, one known card per slot, the level filter, the shape affinity and the latest books\' cards skipped', () => {
  const a = chooseVoice({seed: 'topic:0', level: 'K2', shapeId: 'search_wrong_answers'}), b = chooseVoice({seed: 'topic:0', level: 'K2', shapeId: 'search_wrong_answers'});
  assert.deepEqual(a, b);
  assert.deepEqual(voiceRef(a), a, 'a chosen voice is its own valid reference');
  for (const slot of VOICE_SLOTS) assert.equal(voiceCardById(a.cards[slot]).slot, slot);
  const seeds = Array.from({length: 40}, (_, i) => chooseVoice({seed: `topic:${i}`, level: 'K2', shapeId: 'search_wrong_answers'}).cards);
  for (const slot of VOICE_SLOTS) assert.ok(new Set(seeds.map((c) => c[slot])).size >= 3, `${slot}: the same shape still gets different cards from different seeds`);
  const k1 = chooseVoice({seed: 'topic:0', level: 'K1'});
  for (const slot of VOICE_SLOTS) assert.ok(voiceCardById(k1.cards[slot]).levels.includes('K1'), `${slot} ${k1.cards[slot]} suits K1`);
  const sounds = Array.from({length: 200}, (_, i) => chooseVoice({seed: `s:${i}`, level: 'K2', shapeId: 'sound_adventure'}).cards.dialogue);
  const soundShare = sounds.filter((id) => id === 'sound_first').length / sounds.length;
  assert.ok(soundShare > 0.22 && soundShare < 0.5, `a sound story leans to the sound card (${soundShare}), without owning it`);
  const skipped = chooseVoice({seed: 'topic:0', level: 'K2', shapeId: 'search_wrong_answers', recentIds: Object.values(a.cards)});
  for (const slot of VOICE_SLOTS) assert.notEqual(skipped.cards[slot], a.cards[slot], `${slot} avoids the latest book`);
  assert.equal(voiceRef({version: 1, cards: {...a.cards, narrator: 'nope'}}), null);
  assert.equal(voiceRef({version: 1, cards: {...a.cards, narrator: a.cards.dialogue}}), null, 'a card in the wrong slot is refused');
  assert.equal(voiceRef(null), null);
  assert.match(voiceSummary(a), /^문체 · .+ · .+ · .+ · .+ · .+$/);
  const block = voiceBlock({storyVoice: a, characters: [{name: '유하'}, {name: '해니'}]});
  assert.match(block, /^\[이 책의 목소리 — 불씨예요, 점검표가 아니에요\]\n화자: .+\n대화: .+\n리듬: .+\n끝맺음: .+\n첫 문장: .+$/);
  assert.doesNotMatch(block, /\{name\}|\{friend\}|유하은|유하이 /);
  assert.match(voiceBlock({storyVoice: a}, 'en'), /^This book's voice \(a spark, not a checklist\): .+\.$/);
  assert.equal(voiceBlock({}, 'ko'), '');
});

test('R34 a new draft freezes its voice next to its shape; the input carries it, the model\'s JSON never shows it, a pre-R34 job gains none on resume', () => {
  const state = setup();
  const {input} = inputFromWizard(state, wizardOf());
  assert.equal(input.storyVoice.version, 1);
  assert.deepEqual(input.storyVoice, storyVoiceFor(state, wizardOf(), {level: 'K2', shapeId: input.storyShape.id}));
  assert.deepEqual(normalizeStoryInput(input).storyVoice, input.storyVoice);
  assert.equal('storyVoice' in leanVisibleInput(normalizeStoryInput(input)), false);
  assert.equal(JSON.stringify(leanVisibleInput(normalizeStoryInput(input))).includes(input.storyVoice.cards.narrator), false);
  assert.equal(normalizeStoryInput({...input, storyVoice: {version: 1, cards: {narrator: 'nope'}}}).storyVoice, undefined, 'an unknown card is dropped');
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.storyVoice, input.storyVoice, 'the job freezes the same voice (same seed)');
});

test('R34 the writers hear the palette and the cards on the diet only; the voiced Korean budget line asks for contrast; legacy requests are byte-identical', async () => {
  const state = setup();
  const input = normalizeStoryInput({...inputFromWizard(state, wizardOf()).input, bookId: 'v'});
  delete input.councilPolicy;
  const rules = leanBeatWriterRules(input, demoOutline(input));
  assert.match(rules.ko, /가능성이지 점검표가 아니에요/);
  assert.match(rules.ko, /\[이 책의 목소리 — 불씨예요, 점검표가 아니에요\]/);
  assert.match(rules.en, /This book's voice \(a spark, not a checklist\)/);
  const bare = normalizeStoryInput({...input, storyVoice: undefined});
  assert.doesNotMatch(leanBeatWriterRules(bare, demoOutline(bare)).ko, /목소리|점검표/);
  assert.match(leanProseRules(input), /\[이 책의 목소리/);
  assert.doesNotMatch(leanProseRules(bare), /\[이 책의 목소리/);
  // The beat writer's first request (the K2 diet draft): the block in the system, the contrast line in the user message.
  const outline = demoOutline(input); outline.refrain = null;
  const calls = await firstCalls(input, outline);
  const ko = calls.find((c) => /그림책 작가다/u.test(c.system));
  assert.ok(ko, 'a Korean beat request was made');
  assert.match(ko.system, /\[이 책의 목소리 — 불씨예요/);
  // (R35: this is a page-layout draft, so the R34 line holds; an openings draft's picture-led line is in picture-led-r35.)
  assert.match(ko.user, /\[분량\] 이 비트는 \d+~\d+문장\. 짧은 문장과 긴 문장을 섞어요\(한 단어 문장도 좋아요\); 평균이 5~7어절 안이면 되고, 8어절을 넘는 문장은 셋에 하나까지\./);
  const en = calls.find((c) => /writing original English/u.test(c.system));
  assert.match(en.system, /This book's voice/);
  // Without the voice the diet request keeps its R31f wording; without the diet nothing of this appears.
  const bareCalls = await firstCalls(bare, outline);
  assert.match(bareCalls.find((c) => /그림책 작가다/u.test(c.system)).user, /\[분량\] 이 비트는 \d+문장 안팎\(범위 \d+~\d+\)\. 한 문장 7어절 안팎\./);
  const old = legacy(input), oldCalls = await firstCalls(old, demoOutline(old));
  assert.ok(oldCalls.length, 'the legacy beat writer was called');
  for (const call of oldCalls) assert.doesNotMatch(call.system + call.user, /목소리|점검표|spark, not a checklist/);
  const oldNoVoice = legacy({...input, storyVoice: undefined}), oldNoVoiceCalls = await firstCalls(oldNoVoice, demoOutline(oldNoVoice));
  assert.deepEqual(oldCalls.map((c) => [c.system, c.user]), oldNoVoiceCalls.map((c) => [c.system, c.user]), 'legacy requests do not change with a frozen voice');
  // The K1 writer (whole book at once) gets the block on the diet only.
  const k1 = normalizeStoryInput({...inputFromWizard(state, wizardOf({koreanLevel: 'K1', englishLevel: 'E0'})).input, bookId: 'k'});
  const k1Calls = await firstCalls(k1, demoOutline(k1));
  assert.match(k1Calls[0].system, /\[이 책의 목소리 — 불씨예요/);
  assert.match(k1Calls[0].system, /This book's voice/);
  const k1Old = legacy(k1), k1OldCalls = await firstCalls(k1Old, demoOutline(k1Old));
  assert.doesNotMatch(k1OldCalls[0].system, /목소리|점검표/);
  // Eco: the pages request carries it too.
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoPagesPrompt(job.input, demoOutline(normalizeStoryInput(job.input))), /\[이 책의 목소리 — 불씨예요/);
});

test('R34 the style numbers: name openers, past -었어요 endings, dialogue, questions, length spread — the r31e manuscript measures as the complaint said', async () => {
  assert.equal(endsInPastYo('유하는 달렸어요.'), true);
  assert.equal(endsInPastYo('"찾았다!" 유하가 말했어요!'), true);
  assert.equal(endsInPastYo('파도가 밀려와요.'), false);
  assert.equal(endsInPastYo('유하는 달렸지요.'), false);
  const report = styleReport(['유하는 모래 위를 걸었어요. 해니도 따라왔어요. "조개다!" 쏴아, 파도가 와요. 어디로 갔을까요?'], {names: ['유하', '해니']});
  assert.equal(report.sentences, 5);
  assert.equal(report.nameOpenerShare, 0.4);
  assert.equal(report.pastShare, 0.4);
  assert.equal(report.dialogueShare, 0.2);
  assert.equal(report.questions, 1);
  assert.equal(styleReport([]), null);
  assert.match(styleSummaryLine(report), /^문체 실측 · 이름으로 시작 40% · '-었어요' 끝 40% · 대화 20% · 물음 1 · 문장 길이 [\d.]+±[\d.]+어절$/);
  const data = JSON.parse(await readFile(new URL('../QA/r31e-ab/K2-diet.json', import.meta.url), 'utf8'));
  const pages = []; const walk = (n, d = 0) => { if (!n || typeof n !== 'object' || d > 12) return; if (Array.isArray(n)) return n.forEach((x) => walk(x, d + 1)); if (('pageNo' in n || 'entryId' in n) && typeof (n.textKo ?? n.ko) === 'string') pages.push(n.textKo ?? n.ko); for (const [k, v] of Object.entries(n)) if (k !== 'history') walk(v, d + 1); };
  walk(data);
  const paid = styleReport([...new Set(pages)], {names: ['유하', '해니']});
  assert.ok(paid.sentences > 60);
  assert.ok(paid.nameOpenerShare >= 0.4, `name openers ${paid.nameOpenerShare}`);
  assert.ok(paid.pastShare >= 0.75, `past endings ${paid.pastShare}`);
  assert.ok(paid.dialogueShare <= 0.2, `dialogue ${paid.dialogueShare}`);
  assert.equal(paid.questions, 0);
});

test('R34 the book remembers its voice, the next book avoids it, and the screens show the voice and the style numbers as notes', () => {
  const state = setup();
  const input = normalizeStoryInput(inputFromWizard(state, wizardOf()).input);
  const outline = demoOutline(input); outline.storyShape = structuredClone(input.storyShape);
  const record = approvedBookRecord({id: 'b1', approved: true, createdAt: new Date().toISOString(), topic: input.topic, outline, storyInput: input, pages: [], characterIds: ['yuha']});
  assert.deepEqual(record.usedElements.voice, input.storyVoice.cards);
  assert.deepEqual(recentVoiceIds([record]), Object.values(input.storyVoice.cards));
  assert.deepEqual(recentVoiceIds([{usedElements: {patternId: 'legacy'}}]), [], 'a pre-R34 record names no cards');
  const legacyRecord = approvedBookRecord({id: 'b0', approved: true, createdAt: new Date().toISOString(), topic: 'x', outline: demoOutline(input), storyInput: legacy({...input, storyVoice: undefined}), pages: [], characterIds: ['yuha']});
  assert.equal('voice' in legacyRecord.usedElements, false, 'a book without a voice records none');
  state.settings.storyQuality = {...(state.settings.storyQuality || {}), approvedBooks: [{bookId: 'b1', approved: true, createdAt: new Date().toISOString(), topic: input.topic, outline: {beats: outline.beats}, usedElements: record.usedElements}]};
  const next = inputFromWizard(state, wizardOf()).input.storyVoice;
  for (const slot of VOICE_SLOTS) assert.notEqual(next.cards[slot], input.storyVoice.cards[slot], `${slot} differs from the latest book`);
  // The pro outline card and ③.
  const card = renderStoryQualityPlan({outline, input});
  assert.match(card, /문체 · /);
  assert.doesNotMatch(renderStoryQualityPlan({outline: {...outline, storyShape: undefined}, input}), /문체 · /, 'no voice line without a shape (a legacy outline)');
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  job.status = 'text-review'; job.outline = outline; job.pagination = {pages: []}; job.completed = {outline: true, briefs: true, prose: true, pagination: true};
  job.styleReport = styleReport(['유하는 조개를 주웠어요. 해니가 웃었어요. "또 찾았다!"'], {names: ['유하', '해니']});
  assert.ok(checkNotes(job).some((note) => /^문체 실측 · 이름으로 시작 67%/.test(note)));
  const w = ensureSimpleWizard(state, {...wizardOf({simpleFlow: true}), step: 1, simpleStep: 3, simpleJobId: job.id, simplePicksTouched: true});
  const html = renderSimpleCreate({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
  assert.match(html, /이야기 모양 · [^<]+ · 문체 · /);
  assert.match(html, /문체 실측 · 이름으로 시작 67%/);
  assert.match(buildStopReport(job), /- 문체 실측 · 이름으로 시작 67%[^\n]*\(작가 원문 기준 · 참고\)/);
  const demo = {...job, demo: true};
  assert.doesNotMatch(renderSimpleCreate({getState: () => ({...state, fullAutoJobs: {...state.fullAutoJobs, [job.id]: demo}}), getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''}), /문체 · /, 'a demo book shows no voice');
});
