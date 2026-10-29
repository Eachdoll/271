import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanBeatWriterRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {getPrintHTML, openingFitScript} from '../dist/output.js';
import {pocketOf, pocketShare, pocketPromptLine, POCKET_FIT_SOURCE, POCKET_SAMPLER_SCRIPT} from '../dist/text-pocket.js';
import {hasStoryLogic, storyLogicPolicy, storyLogicOutlineRule, storyLogicWriterLine} from '../dist/story-generation/story-logic.js';

/**
 * R47 (2026-10-29). The parent's bilingual K2 feedback file showed English only:
 * the R40 text field (30% of the picture) held the English first and the Korean
 * after it, and the Korean was cut off on 12 of 15 pages. Now the Korean comes
 * first, the field of a new picture is sized to its page's words (a drawn
 * picture keeps the field its own request asked for), and the print fits the
 * words: a little growth, then the English (or all words) under the picture,
 * never covering the art (scripts/r47-pocket-fit.mjs measures it in Chromium).
 * New pictures keep the place's left-right layout. A new draft also freezes
 * input.storyLogic for cause and effect a child can follow and varied tags.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'beach'], topic: '돌돌 말린 길', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const BOOK_INPUT = {promptDiet: {version: 1}, promptPolicy: {version: 1}, storyChange: {version: 1}, storyDrama: {version: 1}, textPocket: {version: 1}, bookFormat: {version: 1, id: 'pictureLed'}};
const plan = (extra = {}) => ({version: 1, carrier: 'both', picture: 'the rug', shot: 'wide', space: 'airy', hook: '', ...extra});
const clone = (v) => JSON.parse(JSON.stringify(v));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const LEGACY = JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8'));
const KO = '“기다리면 혼자 나올까?” 유하가 작게 중얼거려요. 꾸러미가 들썩이면 유하도 따라 들썩들썩해요. 기다려도 그대로라서 유하의 입이 조금 나와요.';
const EN = '“Will it come out if I wait?” The bundle bobbed, and Yuha bobbed too.';

test('R47 the field size: the plan alone keeps R40; with words a longer page gets a bigger field; a drawn picture keeps its own', () => {
  assert.equal(pocketShare(plan(), 'top'), 0.3);
  assert.equal(pocketShare(plan(), 'left'), 0.34);
  assert.equal(pocketShare(plan(), 'top', ['쾅!', 'Bang!']), 0.3, 'a sound keeps the base');
  assert.equal(pocketShare(plan(), 'top', [KO, EN]), 0.45, `${KO.length} Korean + ${EN.length} Latin letters (about 110 units)`);
  assert.equal(pocketShare(plan(), 'top', [KO + KO, EN]), 0.5, 'longer still: half the picture');
  assert.equal(pocketShare(plan(), 'left', [KO, EN]), 0.45);
  assert.equal(pocketShare(plan({carrier: 'words'}), 'top', ['짧은 말']), 0.4, 'the words carrier keeps its base');
  assert.match(pocketPromptLine(plan({pocket: 'top'}), 0.5), /^TEXT FIELD: leave the top 50% of the picture's height/);
  assert.match(pocketPromptLine(plan({pocket: 'top'})), /the top 30%/, 'without a size the R40 sentence');
  const book = {language: 'bilingual', storyInput: normalizeStoryInput({...LEGACY.storyInput, ...BOOK_INPUT}), outline: {beats: [{index: 1, picturePlan: plan({pocket: 'top'})}]}};
  const page = {beatIndex: 1, ko: KO, en: EN};
  assert.deepEqual(pocketOf(book, page), {side: 'top', share: 0.45});
  assert.deepEqual(pocketOf(book, {...page, imageMeta: {prompt: 'COMPOSITION FIRST … TEXT FIELD: leave the top 30% of the picture\'s height as one flat …'}}), {side: 'top', share: 0.3}, 'the drawn picture left 30%');
  assert.equal(pocketOf({...book, language: 'ko'}, page).share, 0.4, 'Korean alone: a little less');
});

test('R47 the print: the Korean comes first in a field; the openings fit counts the fields and fits them; the fit script grows, splits, spills, then shrinks', () => {
  const oinput = normalizeStoryInput({...LEGACY.storyInput, ...BOOK_INPUT, layoutPolicy: L.openingsLayoutPolicy(), specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, {}, {layout: 'openings'}).specs, pageCount: 16});
  const prose = demoProse(LEGACY.outline, oinput), pagination = demoPagination(LEGACY.outline, prose, oinput);
  const obook = {...clone(LEGACY), language: 'bilingual', storyInput: oinput, prose, pagination, pages: toLegacyPages(pagination).map((p) => ({...p, imageUrl: PNG})), cover: {imageUrl: PNG}};
  obook.outline = {...clone(LEGACY.outline), beats: clone(LEGACY.outline.beats).map((b) => ({...b, picturePlan: plan({pocket: 'top'})}))};
  const html = getPrintHTML(obook, {layout: 'single'}, []);
  assert.match(html, /<div class="text-pocket-inner"><p lang="ko" class="ko">[^<]+<\/p><p lang="en" class="en">/);
  assert.doesNotMatch(html, /<div class="text-pocket-inner"><p lang="en"/);
  assert.match(html, /<p id="print-pocket-warning" class="print-warning" hidden><\/p>/);
  assert.match(html, /pocketOver=leaf=>/);
  assert.match(html, /while\(\(over\(leaf\)\|\|pocketOver\(leaf\)\)&&pt>4\)/, 'the book font counts the fields');
  assert.match(html, /window\.__fitPockets\(document\);let font=/, 'the fields fit at the chosen font before the leaves');
  assert.match(html, /\.ob-pocket\.pocket-split \.ob-text,\.ob-pocket\.pocket-spill \.ob-text\{flex:1/);
  assert.match(html, /\.pocket-split \.text-pocket \.en,\.pocket-spill \.text-pocket\{display:none\}/);
  // A book without pockets gets the R12 script byte for byte.
  assert.equal(openingFitScript(), openingFitScript({pockets: false}));
  assert.doesNotMatch(openingFitScript(), /pocket/i);
  // The fit routine: grow a little, English under the picture, everything under it, else grow and shrink.
  for (const step of ["host.classList.add('pocket-split')", "host.classList.add('pocket-spill')", 'grow(max)', "frame.classList.add('pocket-overflow')", 'band?.15:.2']) assert.ok(POCKET_FIT_SOURCE.includes(step), step);
  assert.ok(POCKET_SAMPLER_SCRIPT.includes('window.__fitPockets=fitPockets') && POCKET_SAMPLER_SCRIPT.includes('window.__resetPockets'));
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v(?:9[7-9])";/);
  assert.match(sw, /"\.\/story-generation\/story-logic\.js",/);
});

test('R47 the picture lead keeps the place\'s left-right layout', () => {
  const src = readFileSync(new URL('../dist/image-generation/scene-prompt.js', import.meta.url), 'utf8');
  assert.match(src, /but from the same side: what stands on the left of the place stays on the left, nothing is mirrored, and the story's things stay where the earlier pages put them/);
  assert.doesNotMatch(src, /not from the angle the place reference was painted at/);
});

test('R47 story logic: frozen on new drafts, kept by normalize, never sent as data; the outline hears LOGIC, the writers the tag line; drafts without it are unchanged', () => {
  const state = setup(), input = normalizeStoryInput({...inputFromWizard(state, wizard, {layout: 'openings'}).input, bookId: 'r47'});
  assert.deepEqual(input.storyLogic, storyLogicPolicy());
  assert.ok(hasStoryLogic(input));
  assert.doesNotMatch(JSON.stringify(leanVisibleInput(input, 'outline')), /storyLogic/);
  const bare = {...input};
  delete bare.storyLogic;
  assert.equal(hasStoryLogic(bare), false);
  assert.equal(hasStoryLogic({storyLogic: {version: 1}}), false, 'the diet only');
  const rules = leanOutlineRules(input, {count: 8, attempts: 3});
  assert.match(rules, /LOGIC A CHILD CAN FOLLOW: everything that enters the story comes from somewhere the child has already seen or heard/);
  assert.equal(leanOutlineRules(bare, {count: 8, attempts: 3}), rules.replace(`\n${storyLogicOutlineRule(input)}`, ''));
  const w = leanBeatWriterRules(input, {beats: []});
  assert.ok(w.ko.includes(storyLogicWriterLine(input, 'ko')));
  assert.ok(w.en.includes(storyLogicWriterLine(input, 'en')));
  assert.doesNotMatch(leanBeatWriterRules(bare, {beats: []}).ko, /말꼬리/);
});
