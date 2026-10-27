import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard, storyExpressionFor, renderStoryQualityPlan} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanBeatWriterRules, leanProseRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {demoOutline, demoProse} from '../dist/story-generation/demo.js';
import {approvedBookRecord} from '../dist/story-generation/quality-gates.js';
import {EXPRESSION_DECK, EXPRESSION_SLOTS, EXPRESSION_COUNTS, chooseExpression, expressionRef, expressionOf, expressionCardById, expressionSummary, recentExpressionIds} from '../dist/story-generation/expression-deck.js';
import {compositionRule, compositionDirection, pictureLedK1Line} from '../dist/book-format.js';
import {picturePlanOutlineRule} from '../dist/story-generation/picture-plan.js';
import {shapeById, chooseStoryShape} from '../dist/story-generation/story-shapes.js';
import {directionLine} from '../dist/story-generation/council.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {ecoPagesPrompt, ecoOutlinePrompt, ecoJobInit} from '../dist/eco-mode.js';
import {renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';

/**
 * 2026-10-24 R37 표현 원리 카드. The parent on R35: "similar ways of
 * expressing, writing and composing pictures — not a copy". R35 had put one
 * reference book's plot skeleton (three same-kind encounters each bigger, the
 * third tipping the turn, a quiet round ending) into every picture-led
 * outline. A new picture-led draft now freezes a few general principles —
 * how the words work, how the telling works, how a picture is composed —
 * drawn from the topic's seed, skipping the latest books' cards, and the
 * writers get them as a spark. The plot is the story shape's. R35/R36 drafts
 * without cards keep their requests byte for byte (picture-led-r35 tests the
 * old composition on such an input); legacy drafts are pinned by R12.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'beach'], topic: '유하가 바닷가에서 파도를 처음 만나요', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `e-${Object.keys(extra).join('-') || 'default'}`});
const withoutCards = (input) => { const copy = structuredClone(input); delete copy.storyExpression; return copy; };
const firstCalls = async (input, outline) => {
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); throw new Error('stop after the first request'); }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine, cheap: engine}}).catch(() => {});
  return calls;
};
const ctxOf = (state, w) => ({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
/** What R35 put in every picture-led request and R37 takes out of a carded one. */
const TEMPLATE = /THREE encounters|three quick encounters|each bigger|the third tips|quiet, round ending|the small one and the big one|세 번[^\n]*점점 크게|세 번째에 뒤집/;

test('R37 the deck: three slots of seven general principles, unique ids, a Korean name and line and an English spark each; no author, title or studio named anywhere in the prompt modules', () => {
  assert.deepEqual(EXPRESSION_SLOTS, ['words', 'telling', 'frame']);
  const ids = EXPRESSION_SLOTS.flatMap((slot) => EXPRESSION_DECK[slot].map((c) => c.id));
  // R39 adds the telling card 'aside' (한 발 물러선 화자): 22 cards, 8 in the telling slot.
  assert.equal(ids.length, 22);
  assert.equal(new Set(ids).size, 22);
  for (const slot of EXPRESSION_SLOTS) {
    assert.equal(EXPRESSION_DECK[slot].length, slot === 'telling' ? 8 : 7, slot);
    for (const card of EXPRESSION_DECK[slot]) {
      assert.ok(card.name.length >= 4 && card.ko.length > 10 && card.en.length > 30, card.id);
      assert.equal(expressionCardById(card.id).slot, slot);
      assert.doesNotMatch(card.en, /\b(three|third|bigger|biggest|wave)\b/i, `${card.id} is a principle, not a plot`);
    }
  }
  for (const file of ['story-generation/expression-deck.js', 'book-format.js', 'story-generation/picture-plan.js', 'story-generation/story-shapes.js', 'story-generation/demo.js', 'story-generation/prompt-diet.js', 'story-generation/story-change.js', 'story-generation/story-drama.js']) {
    const text = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /Haughton|호튼|Oh No, George|Shh! We Have a Plan|Little Owl Lost|A Bit Lost|Goodnight Already/i, file);
  }
});

test('R37 the chooser: deterministic from the seed, two known cards per slot, the latest books\' cards left for last, varied across topics; the ref keeps known cards in their own slot only', () => {
  const a = chooseExpression({seed: '바닷가:0'});
  assert.deepEqual(a, chooseExpression({seed: '바닷가:0'}));
  for (const slot of EXPRESSION_SLOTS) {
    assert.equal(a.cards[slot].length, EXPRESSION_COUNTS[slot]);
    assert.equal(new Set(a.cards[slot]).size, EXPRESSION_COUNTS[slot]);
    assert.ok(a.cards[slot].every((id) => expressionCardById(id)?.slot === slot));
  }
  const recent = Object.values(a.cards).flat(), b = chooseExpression({seed: '바닷가:0', recentIds: recent});
  for (const slot of EXPRESSION_SLOTS) assert.ok(b.cards[slot].every((id) => !recent.includes(id)), `${slot}: the latest book's cards are skipped`);
  const everything = EXPRESSION_SLOTS.flatMap((slot) => EXPRESSION_DECK[slot].map((c) => c.id));
  assert.equal(chooseExpression({seed: 'x', recentIds: everything}).cards.words.length, 2, 'all recent: still two cards');
  const sets = new Set(Array.from({length: 40}, (_, i) => JSON.stringify(chooseExpression({seed: `주제 ${i}:0`}).cards)));
  assert.ok(sets.size >= 30, `40 topics give ${sets.size} different hands`);
  const used = new Set(Array.from({length: 40}, (_, i) => Object.values(chooseExpression({seed: `주제 ${i}:0`}).cards).flat()).flat());
  assert.equal(used.size, 22, 'every card turns up');
  assert.deepEqual(expressionRef({version: 1, cards: {words: ['few_words', 'one_focus', 'nope'], telling: ['quiet_peak'], frame: ['one_focus']}}), {version: 1, cards: {words: ['few_words'], telling: ['quiet_peak'], frame: ['one_focus']}});
  assert.equal(expressionRef({version: 2, cards: a.cards}), null);
  assert.equal(expressionRef({version: 1, cards: {words: ['nope'], telling: ['quiet_peak'], frame: ['one_focus']}}), null, 'an empty slot is no hand');
  assert.equal(expressionSummary(a).startsWith('표현 · '), true);
});

test('R37 a new picture-led draft freezes its cards (글이 많은 책 and page books of that format none); the input carries them, the model\'s JSON never shows them; the wave shape is chosen only when the topic says so', () => {
  const state = setup();
  const led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'}), k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.deepEqual(led.storyExpression, storyExpressionFor(state, wizardOf()));
  assert.equal('storyExpression' in wordy, false);
  assert.ok(expressionRef(k1.storyExpression), 'a picture-led K1 page book has cards too');
  assert.equal('storyExpression' in leanVisibleInput(led), false);
  assert.equal('storyExpression' in leanVisibleInput(led, 'pagination'), false);
  assert.equal(JSON.stringify(leanVisibleInput(led)).includes(led.storyExpression.cards.words[0]), false);
  assert.equal(expressionOf({...led, promptDiet: undefined}), null, 'off the diet the cards are read by nothing');
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.storyExpression, led.storyExpression, 'the job freezes the same cards (same seed)');
  // three_waves: one selectable shape, generalized; only "세 번 / 점점 / 되풀이" pick it.
  assert.notEqual(led.storyShape.id, 'three_waves');
  assert.equal(chooseStoryShape('파도가 무서운 바다', {level: 'K2'}).id === 'three_waves', false);
  assert.equal(chooseStoryShape('문을 세 번 두드려요', {level: 'K2'}).id, 'three_waves');
  assert.doesNotMatch(shapeById('three_waves').line, /bigger|quiet and round|feared/);
});

test('R37 the outline request: no plot template on a carded draft — the shape decides the plot — plus the EXPRESSION block; the picture plan example is general and the frame cards follow; the room hears the card names; an R35 draft without cards keeps its request', () => {
  const state = setup(), led = draft(state), r35 = withoutCards(led);
  const rules = leanOutlineRules(led, {count: 8, attempts: 3});
  assert.doesNotMatch(rules, TEMPLATE);
  assert.match(rules, /\nPICTURE-LED BOOK: each beat is one opening with only a few sentences[^\n]*The plot follows the story shape; nothing here sets how many times something happens or how the book ends\.[^\n]*no lesson line\.\nEXPRESSION FOR THIS BOOK \(principles to lean on, a spark, not a checklist/);
  for (const slot of EXPRESSION_SLOTS) for (const id of led.storyExpression.cards[slot]) assert.ok(rules.includes(expressionCardById(id).en), `${id} in the request`);
  assert.equal((rules.match(/EXPRESSION FOR THIS BOOK/g) || []).length, 1);
  assert.doesNotMatch(picturePlanOutlineRule(led), /huge wave/);
  assert.match(picturePlanOutlineRule(led), /not a script\. This book's picture ideas: /);
  assert.equal(compositionRule(led, {k1: true}), compositionRule(led), 'K1 or not, the same general paragraph');
  // The R35 request (a draft frozen before R37) is the R35 text.
  assert.match(leanOutlineRules(r35, {count: 8, attempts: 3}), /THREE encounters of ONE kind/);
  assert.match(picturePlanOutlineRule(r35), /calm words over a huge wave/);
  assert.equal(compositionRule(r35).includes('EXPRESSION'), false);
  // The writers' room.
  const names = Object.values(led.storyExpression.cards).flat().map((id) => expressionCardById(id).name);
  assert.equal(compositionDirection(led), `책 결: 그림책 결 — 펼침마다 글은 몇 문장뿐이고 그림이 나머지를 말해요; 짜임은 이야기 모양을 따르고, 이 책의 표현: ${names.join(' · ')}`);
  assert.match(directionLine(led), /책 결: 그림책 결 — [^\n]*이 책의 표현: [^\n]+\.$/);
  assert.doesNotMatch(directionLine(led), /세 번|뒤집/);
  // Eco builds its outline request from the same lines.
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoOutlinePrompt(job.input), /EXPRESSION FOR THIS BOOK/);
  assert.doesNotMatch(ecoOutlinePrompt(job.input), TEMPLATE);
  // The request stays inside the R31b budget.
  // R39 adds the DRAMA paragraph and the plan's three fields (measured 6,891).
  assert.ok(rules.length <= 7500, `outline rules ${rules.length}`);
});

test('R37 the writers hear the words and telling cards (beat writer, app prose, K1 writer, eco pages); the K1 line has no plot template; drafts without cards hear none', async () => {
  const state = setup(), led = draft(state), outline = demoOutline(led);
  const rules = leanBeatWriterRules(led, outline);
  assert.match(rules.ko, /\n\[이 책의 표현 — 불씨예요, 점검표가 아니에요\] /);
  assert.match(rules.en, / This book's way of telling \(a spark, not a checklist\): /);
  for (const id of [...led.storyExpression.cards.words, ...led.storyExpression.cards.telling]) assert.ok(rules.ko.includes(expressionCardById(id).ko), id);
  for (const id of led.storyExpression.cards.frame) assert.equal(rules.ko.includes(expressionCardById(id).ko), false, `${id}: the frame cards are the picture plan's`);
  assert.match(leanProseRules(led), /\[이 책의 표현/);
  const bare = leanBeatWriterRules(withoutCards(led), outline);
  assert.doesNotMatch(bare.ko + bare.en, /이 책의 표현|way of telling/);
  const calls = await firstCalls(led, {...outline, refrain: null});
  const ko = calls.find((c) => /그림책 작가다/u.test(c.system));
  assert.match(ko.system, /\[이 책의 표현/);
  assert.ok(ko.system.length <= 3200, `beat writer system ${ko.system.length}`);
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.doesNotMatch(pictureLedK1Line(k1), TEMPLATE);
  assert.match(pictureLedK1Line(k1), /^그림책 결: 글은 그림이 못 하는 것만 써요\. 짜임은 줄거리 지도를 따라요\.\n\[이 책의 표현/);
  assert.match(pictureLedK1Line(withoutCards(k1)), /같은 일이 세 번/, 'an R35 K1 draft keeps its line');
  const k1Calls = await firstCalls(k1, demoOutline(k1));
  assert.match(k1Calls[0].system, /\[이 책의 표현[^\n]*\nThis book's way of telling/);
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoPagesPrompt(job.input, demoOutline(normalizeStoryInput(job.input))), /\[이 책의 표현/);
});

test('R37 the book remembers its cards and the next book draws others; ③ and the pro card name them; the input step keeps a job\'s own cards on resume', async () => {
  const state = setup(), input = draft(state);
  const outline = demoOutline(input); outline.storyShape = structuredClone(input.storyShape);
  const record = approvedBookRecord({id: 'b1', approved: true, createdAt: new Date().toISOString(), topic: input.topic, outline, storyInput: input, pages: [], characterIds: ['yuha']});
  assert.deepEqual(record.usedElements.expression, input.storyExpression.cards);
  assert.deepEqual(recentExpressionIds([record]), Object.values(input.storyExpression.cards).flat());
  const plain = approvedBookRecord({id: 'b0', approved: true, createdAt: new Date().toISOString(), topic: 'x', outline, storyInput: withoutCards(input), pages: [], characterIds: ['yuha']});
  assert.equal('expression' in plain.usedElements, false, 'a book without cards records none');
  state.settings.storyQuality = {...(state.settings.storyQuality || {}), approvedBooks: [{bookId: 'b1', approved: true, createdAt: new Date().toISOString(), topic: input.topic, outline: {beats: outline.beats}, usedElements: record.usedElements}]};
  const next = inputFromWizard(state, wizardOf(), {layout: 'openings'}).input.storyExpression;
  for (const slot of EXPRESSION_SLOTS) assert.ok(next.cards[slot].every((id) => !input.storyExpression.cards[slot].includes(id)), `${slot}: the next book draws other cards`);
  assert.match(renderStoryQualityPlan({outline, input}), /<br>표현 · [^<]+<br>달라지는 것 · [^<]+(?:<br>시도 · [^<]+)?<\/p>/);
  // ③ (the eco panel shows the line from the start)
  const fresh = setup();
  const job = ecoJobInit(createFullAutoJob(fresh, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  const withJob = {...fresh, fullAutoJobs: {...fresh.fullAutoJobs, [job.id]: job}};
  const w = ensureSimpleWizard(withJob, {...wizardOf({simpleFlow: true}), step: 3, simpleStep: 3, simpleJobId: job.id, simplePicksTouched: true});
  assert.match(renderSimpleCreate(ctxOf(withJob, w)), / · 표현 · /);
  // Resume at the input step after the topic changed: the job's own cards win (never re-chosen).
  const demoJob = createFullAutoJob(fresh, wizardOf({simpleFlow: true}), {demo: true, stopBefore: 'text', planMode: 'selection', councilReview: false});
  const closed = () => { throw new DOMException('tab closed', 'AbortError'); };
  await runFullAuto(fresh, demoJob, {operations: {prepare: closed}, buildBook: () => { throw Error('no book'); }}).catch(() => {});
  assert.ok(!demoJob.completed.input, "paused before the input step");
  const own = {version: 1, cards: {words: ['few_words', 'plain_words'], telling: ['quiet_peak', 'situation_humor'], frame: ['one_focus', 'vary_distance']}};
  demoJob.input.storyExpression = structuredClone(own);
  demoJob.wizard.topic = '완전히 다른 주제예요';
  const operations = {preflight: async () => {}, outline: async () => { throw new DOMException('stop before the outline', 'AbortError'); }};
  await runFullAuto(fresh, demoJob, {operations, buildBook: () => { throw Error('no book'); }}).catch(() => {});
  assert.ok(demoJob.completed.input, "the input step ran");
  assert.deepEqual(demoJob.input.storyExpression, own);
});

test('R37 the demo: the picture-led tries are three different things, not one thing growing; the turn is still the picture\'s', () => {
  const state = setup(), led = draft(state), outline = demoOutline(led), prose = demoProse(outline, led);
  assert.doesNotMatch(prose.ko, /더 큰|가장 큰|점점/);
  assert.doesNotMatch(prose.en, /\b(bigger|biggest)\b/);
  assert.match(prose.ko, /개구리[\s\S]*와르르[\s\S]*쉿…[\s\S]*휘이이!/);
  const plans = outline.beats.filter((beat) => beat.type === 'attempt').map((beat) => beat.picturePlan?.picture || '');
  assert.equal(plans.length, 3);
  assert.ok(plans.every((p) => !/bigger|biggest/.test(p)), plans.join(' | '));
});
