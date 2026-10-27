import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, outlineRequestSchema, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {normalizeOutlineResponse} from '../dist/story-generation/outline-normalize.js';
import {picturePlanNote} from '../dist/story-generation/picture-plan.js';
import {buildScenePrompt} from '../dist/image-generation/scene-prompt.js';
import {getPrintHTML} from '../dist/output.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoPicturePrompt} from '../dist/eco-mode.js';
import {hasTextPocket, textPocketPolicy, POCKETS, settlePockets, pocketRule, pocketOf, pocketShare, pocketPromptLine, pocketOnHalf, isShout, pocketFrame, pocketPanel, pocketText, POCKET_CSS, POCKET_SAMPLER_SCRIPT, samplePocketColours} from '../dist/text-pocket.js';

/**
 * 2026-10-27 R40 글 자리. The parent: "I want the words to sit naturally
 * inside the picture, like the reference books — words → picture → fusion
 * (regenerate)? what does it cost?" Nothing is regenerated: a new diet
 * draft freezes input.textPocket {version: 1}; its picture plan decides
 * where the words sit (left/right/top/bottom/none), the picture request asks
 * for a flat single-colour field there, and the reader, ④ and the print set
 * the words on that field in the picture's own colour (sampled in the
 * browser; a translucent card when the field is busy). A one- or two-word
 * page is set big. Drafts without the marker are unchanged (R12 pins).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'beach'], topic: '놀이터에서 자꾸 도망가는 그림자 잡기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `p-${Object.keys(extra).join('-') || 'default'}`});
const dated = (input) => { const copy = structuredClone(input); delete copy.textPocket; return copy; };
const BOOK_INPUT = {promptDiet: {version: 1}, promptPolicy: {version: 1}, storyChange: {version: 1}, storyDrama: {version: 1}, textPocket: {version: 1}, bookFormat: {version: 1, id: 'pictureLed'}};
const plan = (extra = {}) => ({version: 1, carrier: 'both', picture: 'the shadow', shot: 'wide', space: 'airy', hook: '', ...extra});
const clone = (v) => JSON.parse(JSON.stringify(v));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const LEGACY = JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8'));

test('R40 the marker and the plan: every new diet draft freezes textPocket; the schema asks for picturePlan.pocket on picture-led drafts; the rule says what it is; clean-up keeps a side on asked-for drafts, drops it on a text-only beat and elsewhere; the note names it', () => {
  const state = setup(), led = draft(state), old = dated(led), wordy = draft(state, {bookFormatId: 'wordy'});
  assert.deepEqual(led.textPocket, textPocketPolicy());
  assert.equal(hasTextPocket(led), true);
  assert.equal(hasTextPocket(old), false);
  assert.equal(hasTextPocket({...led, storyDrama: undefined}), false, 'rides on the R39 plan');
  assert.equal('textPocket' in leanVisibleInput(led), false);
  assert.equal(normalizeStoryInput({...led, textPocket: {version: 2}}).textPocket, undefined);
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.textPocket, textPocketPolicy());
  const planSchema = outlineRequestSchema(led).properties.beats.items.properties.picturePlan;
  assert.deepEqual(planSchema.properties.pocket.enum, [...POCKETS]);
  assert.ok(planSchema.required.includes('pocket'));
  assert.equal('pocket' in outlineRequestSchema(old).properties.beats.items.properties.picturePlan.properties, false);
  assert.equal('picturePlan' in outlineRequestSchema(wordy).properties.beats.items.properties, false, '글이 많은 책 plans no pictures');
  const rules = leanOutlineRules(led, {count: 8, attempts: 3});
  assert.match(rules, /\nPICTURE PLAN, where the words sit: picturePlan\.pocket — "left", "right", "top" or "bottom": the part of the picture the artist leaves as one flat, even field[^\n]*the words are never painted into the picture[^\n]*"none" only for an entry whose words are a single sound word or when backdrop is "none"\.\n/);
  assert.doesNotMatch(leanOutlineRules(old, {count: 8, attempts: 3}), /where the words sit/);
  assert.equal(pocketRule(wordy), '');
  // Clean-up through the outline normalizer (the request path).
  const outline = demoOutline(led);
  outline.beats[1].picturePlan = plan({pocket: 'Left '});
  outline.beats[2].picturePlan = plan({pocket: 'middle'});
  outline.beats[3].picturePlan = plan({carrier: 'words', pocket: 'top', backdrop: 'none'});
  outline.beats[4].picturePlan = plan({pocket: 'none'});
  const shaped = normalizeOutlineResponse(clone(outline), led).outline;
  assert.equal(shaped.beats[1].picturePlan.pocket, 'left');
  assert.equal('pocket' in shaped.beats[2].picturePlan, false, 'an unknown side is dropped');
  assert.equal('pocket' in shaped.beats[3].picturePlan, false, 'a text-only beat has no pocket');
  assert.equal('pocket' in shaped.beats[4].picturePlan, false);
  assert.equal('pocket' in normalizeOutlineResponse(clone(outline), old).outline.beats[1].picturePlan, false, 'an R39 draft keeps none');
  assert.deepEqual(settlePockets({beats: [{picturePlan: plan({pocket: 'right'})}]}, old).beats[0].picturePlan.pocket, undefined);
  assert.match(picturePlanNote(plan({pocket: 'right'})), / \/ 글 자리 · 오른쪽$/);
  assert.doesNotMatch(picturePlanNote(plan()), /글 자리/);
  assert.equal(pocketShare(plan({carrier: 'words'}), 'left'), 0.45);
  assert.equal(pocketShare(plan(), 'top'), 0.3);
});

test('R40 the picture request: a pocketed page asks for a flat single-colour field of the planned share in place of the staged-text sentence (page and openings books, eco too); the cover, a text-only page and R39 books ask for none', () => {
  const snapshot = {characterSheets: [{characterId: 'yuha', characterSnapshot: {nameEn: 'Yuha'}}], backgrounds: [], backgroundReferenceByPage: {}};
  const page = {pageNo: 3, beatIndex: 3, kind: 'page', ko: '바람이 불어요.', en: 'The wind blows.', scene: {where: 'home', action: 'Yuha runs after the shadow.', timeOfDay: 'day'}, staging: {shot: 'wide', textSide: 'right'}};
  const bookOf = (input, extra) => ({characterIds: ['yuha'], sceneBriefs: [], storyInput: input, outline: {beats: [{index: 3, picturePlan: plan(extra)}]}, printSettings: {textPosition: 'staged'}});
  const pocketed = bookOf(BOOK_INPUT, {pocket: 'left'}), words = bookOf(BOOK_INPUT, {pocket: 'top', carrier: 'words'}), none = bookOf(BOOK_INPUT, {}), old = bookOf({...BOOK_INPUT, textPocket: undefined}, {pocket: 'left'});
  assert.deepEqual(pocketOf(pocketed, page), {side: 'left', share: 0.34});
  assert.deepEqual(pocketOf(words, page), {side: 'top', share: 0.4});
  assert.equal(pocketOf(none, page), null);
  assert.equal(pocketOf(old, page), null, 'an R39 book has no pocket');
  assert.equal(pocketOf(pocketed, {...page, backdrop: 'none'}), null);
  const prompt = (book, cover = false) => buildScenePrompt({book, page, pageIndex: 2, snapshot, place: {background: {name: '유하네 집'}}, earlierPages: [], cover});
  assert.match(prompt(pocketed), /side\. TEXT FIELD: leave the left 34% of the picture's width as one flat, even field of a single quiet colour from the style palette with nothing drawn in it — no details, no gradients, no figures, no texture; the words of this page will be printed there\. Keep the figures and the action in the rest of the picture\. One continuous scene/);
  assert.doesNotMatch(prompt(pocketed), /Leave quiet empty space on the right/, 'the pocket replaces the staged-text sentence');
  assert.match(prompt(words), /TEXT FIELD: leave the top 40% of the picture's height/);
  assert.match(prompt(none), /Leave quiet empty space on the right for separately typeset text/);
  assert.match(prompt(old), /Leave quiet empty space on the right/);
  assert.doesNotMatch(prompt(pocketed, true), /TEXT FIELD/);
  // An openings spread keeps its composition and gets the field after it.
  const spread = {...page, kind: 'spread', openingNo: 2}, openingsBook = {...pocketed, storyInput: {...BOOK_INPUT, pageCount: 16, layoutPolicy: L.openingsLayoutPolicy()}};
  assert.match(buildScenePrompt({book: openingsBook, page: spread, pageIndex: 2, snapshot, place: {background: {name: '집'}}, earlierPages: []}), /Wide double-page spread[^\n]* TEXT FIELD: leave the left 34%/);
  assert.equal(pocketPromptLine(plan()), '');
  // Eco's copied request carries the same sentence.
  const state = setup();
  const eco = {...pocketed, id: 'e', title: '책', language: 'bilingual', pages: [page, page, page], worldSettingsSnapshot: {stylePresetId: state.settings.style}};
  assert.match(ecoPicturePrompt(state, eco, 2), /\nTEXT FIELD: leave the left 34%/);
});

test('R40 the typesetting: the frame and the panel, half-spread geometry, the shout, and the print (page and openings books) sets the words on the field with the stylesheet and sampler for pocket books only; other books\' print is unchanged', () => {
  assert.equal(isShout(['휘이이!', 'Whoosh!']), true);
  assert.equal(isShout(['바람이 불어요.', '']), false, 'a two-word sentence is not a shout');
  assert.equal(isShout(['쾅!']), true);
  assert.equal(isShout([]), false);
  assert.deepEqual(pocketOnHalf({side: 'left', share: 0.34}, 'left'), {side: 'left', share: 0.68, sample: 0.34});
  assert.equal(pocketOnHalf({side: 'left', share: 0.34}, 'right'), null);
  assert.deepEqual(pocketOnHalf({side: 'top', share: 0.3}, 'right'), {side: 'top', share: 0.3});
  const frame = pocketFrame('<img src="x">', pocketText([{lang: 'ko', text: ' 바람 '}, {lang: 'en', text: ''}]), {side: 'right', share: 0.45}, {shout: true});
  assert.equal(frame, '<div class="pocket-frame pocket-right" style="--pocket-share:45%"><div class="pocket-picture"><img src="x"></div><div class="text-pocket text-pocket-shout" data-pocket="right" data-share="0.45"><div class="text-pocket-inner"><p lang="ko" class="ko">바람</p></div></div></div>');
  assert.equal(pocketFrame('<img>', 'x', null), '<img>');
  assert.match(pocketPanel('w', {side: 'left', share: 0.68, sample: 0.34}), /data-share="0\.34"/);
  assert.equal(samplePocketColours(), undefined, 'a no-op outside the browser');
  assert.match(POCKET_SAMPLER_SCRIPT, /sd<=0\.09/);
  // A page book: the pocketed page has no story card; the plain one keeps it; the shout page is big.
  const input = normalizeStoryInput({...LEGACY.storyInput, ...BOOK_INPUT});
  const book = {...clone(LEGACY), storyInput: input, outline: {...clone(LEGACY.outline), beats: clone(LEGACY.outline.beats).map((b, i) => ({...b, picturePlan: i === 1 ? plan({pocket: 'left'}) : i === 2 ? plan({pocket: 'bottom', carrier: 'words'}) : plan()}))}};
  book.pages = book.pages.map((p) => ({...p, imageUrl: PNG}));
  const beat2 = book.pages.find((p) => p.beatIndex === 2), beat3 = book.pages.find((p) => p.beatIndex === 3);
  beat3.ko = '쾅!'; beat3.en = 'Bang!';
  const html = getPrintHTML(book, {layout: 'single', pages: 'all'}, []);
  assert.match(html, new RegExp(`<article class="leaf story-page text-pocket-leaf" aria-label="${beat2.pageNo}쪽"><div class="picturebook-frame"><div class="pocket-frame pocket-left" style="--pocket-share:34%"><div class="pocket-picture"><img class="illustration"[^>]*></div><div class="text-pocket" data-pocket="left" data-share="0.34"><div class="text-pocket-inner"><p lang="en" class="en">`));
  assert.match(html, new RegExp(`aria-label="${beat3.pageNo}쪽"><div class="picturebook-frame"><div class="pocket-frame pocket-bottom" style="--pocket-share:40%">[^]*?<div class="text-pocket text-pocket-shout"`));
  assert.ok(html.includes('class="story"'), 'the other pages keep their story card');
  assert.ok(html.includes('.text-pocket{') && html.includes('samplePockets(document)'));
  const plain = getPrintHTML({...book, storyInput: dated(input)}, {layout: 'single', pages: 'all'}, []);
  assert.doesNotMatch(plain, /text-pocket|samplePockets/);
  // An openings book: a left pocket on a spread takes all the words on the left half; a page entry gets its own; a plain entry keeps the text block.
  const oinput = normalizeStoryInput({...LEGACY.storyInput, ...BOOK_INPUT, layoutPolicy: L.openingsLayoutPolicy(), specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, {}, {layout: 'openings'}).specs, pageCount: 16});
  const prose = demoProse(LEGACY.outline, oinput), pagination = demoPagination(LEGACY.outline, prose, oinput);
  const obook = {...clone(LEGACY), language: 'bilingual', storyInput: oinput, prose, pagination, pages: toLegacyPages(pagination).map((p) => ({...p, imageUrl: PNG})), cover: {imageUrl: PNG}};
  const openings = L.openingsOf(obook), spreadOpening = openings.find((o) => o.kind === 'spread'), pageOpening = openings.find((o) => o.kind === 'pair'), otherOpening = openings.find((o) => o.kind === 'pair' && o !== pageOpening);
  const spreadPage = obook.pages[spreadOpening.indices[0]], single = obook.pages[pageOpening.indices[0]], other = obook.pages[otherOpening.indices[0]];
  obook.outline = {...clone(LEGACY.outline), beats: clone(LEGACY.outline.beats).map((b) => ({...b, picturePlan: b.index === spreadPage.beatIndex ? plan({pocket: 'left'}) : b.index === single.beatIndex ? plan({pocket: 'top'}) : plan()}))};
  const ohtml = getPrintHTML(obook, {layout: 'single'}, []);
  // Leaves are named by printed page numbers (a spread takes two).
  const leafOf = (no) => ohtml.match(new RegExp(`<article class="ob-leaf[^"]*" aria-label="${no}쪽"[^]*?</article>`))[0];
  const left = leafOf(spreadOpening.printedPages[0]), right = leafOf(spreadOpening.printedPages[1]);
  assert.match(left, /class="ob-leaf ob-half ob-half-left ob-left ob-pocket"/);
  assert.match(left, /<div class="ob-art pocket-frame pocket-left" style="--pocket-share:68%"><img class="illustration"[^>]*><div class="text-pocket" data-pocket="left" data-share="0\.34">/);
  assert.match(left, /<div class="ob-text"><\/div>/);
  assert.doesNotMatch(right, /text-pocket|ob-pocket/);
  assert.match(right, /<div class="ob-text"><p lang="en" class="en"><\/p><p lang="ko" class="ko"><\/p><\/div>/, 'the right half carries no words: they all sit in the left field');
  assert.match(leafOf(pageOpening.printedPages[0]), /<div class="ob-art pocket-frame pocket-top" style="--pocket-share:30%">/);
  assert.match(leafOf(otherOpening.printedPages[0]), /<div class="ob-art"><img class="illustration"/);
  assert.ok(ohtml.includes('.ob-art .text-pocket{font-size:var(--ob-font') && ohtml.includes('samplePockets(document)'));
  // The app's stylesheet carries the frame rules and the shell precaches the module.
  const css = readFileSync(new URL('../dist/style.css', import.meta.url), 'utf8');
  for (const rule of POCKET_CSS.trim().split('\n').slice(0, 4)) assert.ok(css.includes(rule), rule);
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v9[0-9]";/);
  assert.match(sw, /"\.\/text-pocket\.js",/);
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /illustration\(b, r\.page, \{ words: readerPocketWords\(b, p\) \}\)/);
  assert.match(app, /samplePocketColours\(document\)/);
});
