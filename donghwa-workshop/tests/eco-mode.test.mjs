import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {assertValid} from '../dist/story-generation/schemas.js';
import {
  ECO_STATUS, isEcoJob, isEcoBook, ecoInput, ecoJobInit, ecoOutlinePrompt, ecoAcceptOutline, ecoRetryPrompt,
  ecoPagesPrompt, ecoAcceptPages, ecoFindings, ecoFixPrompt, ecoMergeFix, ecoProseFromPages,
  ecoPicturePrompt, ecoPicturePrompts, ecoUploadCheck, ecoAttachUpload, ecoMissingPictures, ECO_UPLOAD_MAX_BYTES,
} from '../dist/eco-mode.js';

/**
 * 2026-10-22 R32 에코 모드. The app never calls a model: ③ shows the request
 * the paid path would have sent, the parent pastes the answer, and the pasted
 * outline/pages go through the same free checks (normalize, rules, schema,
 * openings settlement, the reading checker). The demo story stands in for a
 * pasted answer here; the demo K1 pages fail the E1 vocabulary rule, which
 * exercises the fix request and the merge.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardFor = (level, pageCount = 12) => ({step: 4, characterIds: ['yuha'], backgroundIds: ['home', 'forest', 'garden'], topic: '유하가 유치원에 가요', language: 'bilingual', pageCount, koreanLevel: level, englishLevel: level === 'K1' ? 'E1' : 'E2', value: 'courage', ending: 'home', simpleFlow: true, allowNew: false});
function ecoJob(state, level) {
  return ecoJobInit(createFullAutoJob(state, wizardFor(level), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
}
/** A model-shaped pages answer (only the schema's fields) from the demo pagination. */
function pagesReply(job, outline) {
  const input = normalizeStoryInput(job.input), prose = demoProse(outline, input), pag = demoPagination(outline, prose, input);
  const pages = pag.pages.map(p => ({pageNo: p.pageNo, beatIndex: p.beatIndex, textKo: p.textKo, textEn: p.textEn, scene: p.scene, variantByCharacter: p.variantByCharacter || {}, isRefrainPage: !!p.isRefrainPage, ...(p.cue ? {cue: p.cue} : {})}));
  return {cover: pag.cover, pages};
}
const bookOf = (job, pagination) => ({id: job.bookId, title: pagination.cover?.title || job.outline.titleCandidates[0], characterIds: ['yuha'], backgroundIds: ['home', 'forest', 'garden'], pages: pagination.pages.map(x => ({...x, ko: x.textKo, en: x.textEn})), outline: job.outline, pagination, storyInput: job.input, summary: job.outline.logline, eco: true});

test('R32 eco job: the frozen input loses the paid policies, keeps the diet; the job starts at the outline step and never from a used job', () => {
  const state = setup(), job = ecoJob(state, 'K2');
  assert.equal(job.status, ECO_STATUS);
  assert.equal(job.stopBefore, 'text');
  assert.equal(job.eco.step, 'outline');
  assert.ok(isEcoJob(job));
  for (const key of ['councilPolicy', 'orchestrationPolicy', 'editorPolicy']) assert.equal(job.input[key], undefined, key);
  assert.equal(job.input.promptDiet?.version, 1);
  assert.equal(job.councilReview, undefined);
  const k1 = ecoJob(state, 'K1');
  assert.equal(k1.input.k1Policy?.version, 1, 'K1 keeps its own policy');
  assert.deepEqual(ecoInput({promptDiet: {version: 1}, councilPolicy: {version: 1}}), {promptDiet: {version: 1}});
  const used = createFullAutoJob(state, wizardFor('K2'), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  used.usage.calls.push({stage: 'outline', requests: 1});
  assert.throws(() => ecoJobInit(used), /새 이야기/);
  assert.ok(isEcoBook({eco: true}) && !isEcoBook({textDemo: true}));
});

test('R32 outline request: the lean head, the level, the outline rules, the input and the diet schema, as text', () => {
  const state = setup(), job = ecoJob(state, 'K2'), text = ecoOutlinePrompt(job.input);
  assert.match(text, /You write original picture books/);
  assert.match(text, /READING LEVEL/);
  assert.match(text, /Design the StoryOutline/);
  assert.match(text, /"topic":"유하가 유치원에 가요"/);
  assert.match(text, /homeBackgroundIds/);
  assert.match(text, /OUTPUT: exactly one JSON object/);
  assert.match(text, /"titleCandidates"/);
  assert.doesNotMatch(text, /plotContract/, 'a diet outline has no ledger');
  assert.doesNotMatch(text, /"tension"/, 'no paid tension curve');
  assert.ok(text.length < 12000, `request stays pasteable: ${text.length}`);
  const k1 = ecoOutlinePrompt(ecoJob(state, 'K1').input);
  assert.match(k1, /three-year-old/);
});

test('R32 outline answer: not JSON is named, a fenced answer is accepted with notes, a volunteered ledger is dropped, a wrong place is refused', () => {
  const state = setup(), job = ecoJob(state, 'K2'), input = normalizeStoryInput(job.input), outline = demoOutline(input);
  const bad = ecoAcceptOutline('I cannot help with that.', job.input);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /JSON/);
  const ok = ecoAcceptOutline('Here you go:\n```json\n' + JSON.stringify({...outline, plotContract: {events: []}}) + '\n```\nAnything else?', job.input);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.outline.plotContract, undefined);
  assert.equal(ok.outline.beats.length, outline.beats.length);
  assert.ok(ok.notes.length >= 1, 'soft rule findings become notes');
  const wrongPlace = {...outline, settings: outline.settings.map((s, i) => (i === 1 ? {...s, backgroundId: 'nowhere'} : s)), beats: outline.beats.map((b, i) => (i === 1 ? {...b, settingKey: 'nowhere'} : b))};
  const refused = ecoAcceptOutline(JSON.stringify(wrongPlace), job.input);
  assert.equal(refused.ok, false);
  assert.ok(refused.errors.length >= 1);
  assert.match(ecoRetryPrompt(refused.errors, 'outline'), /did not pass the app's checks[\s\S]*- /);
});

test('R32 pages request: writes the pages from the outline (no prose stage), openings mechanics and plan for K2, page plan for K1, the schema with cues', () => {
  const state = setup(), job = ecoJob(state, 'K2'), outline = ecoAcceptOutline(JSON.stringify(demoOutline(normalizeStoryInput(job.input))), job.input).outline;
  const text = ecoPagesPrompt(job.input, outline);
  assert.match(text, /ECO MODE: there is no separate prose stage/);
  assert.match(text, /OPENINGS: the book has exactly 6 openings/);
  assert.match(text, /"openingPlan"/);
  assert.match(text, /"approvedOutline"/);
  assert.match(text, /"cue"/);
  assert.doesNotMatch(text, /plotContract/);
  const k1 = ecoJob(state, 'K1'), k1Outline = ecoAcceptOutline(JSON.stringify(demoOutline(normalizeStoryInput(k1.input))), k1.input).outline;
  const k1Text = ecoPagesPrompt(k1.input, k1Outline);
  assert.match(k1Text, /"pagePlan"/);
  assert.match(k1Text, /exactly 12 pages/);
  assert.doesNotMatch(k1Text, /openingPlan/);
});

test('R32 K2 pages answer: settled and checked for free, passes as the app would judge it; a missing beat is a structure error', () => {
  const state = setup(), job = ecoJob(state, 'K2');
  job.outline = ecoAcceptOutline(JSON.stringify(demoOutline(normalizeStoryInput(job.input))), job.input).outline;
  const reply = pagesReply(job, job.outline);
  const result = ecoAcceptPages('Sure!\n' + JSON.stringify(reply), job.outline, job.input, {bookId: job.bookId});
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.passed, true);
  assert.equal(ecoFindings(result.report).length, 0);
  assert.ok(result.pagination.pages.every(p => p.kind === 'spread' || p.kind === 'page'), 'openings settled');
  assert.equal(ecoAcceptPages('nope', job.outline, job.input).ok, false);
  const broken = {...reply, pages: reply.pages.filter(p => p.beatIndex !== 3)};
  const structure = ecoAcceptPages(JSON.stringify(broken), job.outline, job.input, {bookId: job.bookId});
  assert.equal(structure.ok, false);
  assert.ok(structure.errors.length >= 1, 'a missing beat is named, never merged');
  const prose = ecoProseFromPages(job.outline, result.pagination);
  assertValid('prose', prose, normalizeStoryInput(job.input), job.outline);
  assert.equal(prose.paragraphBeats.ko.length, job.outline.beats.length);
});

test('R32 K1 pages answer that fails the checker: findings per entry, a fix request with only those entries, a merge by pageNo, unknown numbers refused', () => {
  const state = setup(), job = ecoJob(state, 'K1');
  job.outline = ecoAcceptOutline(JSON.stringify(demoOutline(normalizeStoryInput(job.input))), job.input).outline;
  const result = ecoAcceptPages(JSON.stringify(pagesReply(job, job.outline)), job.outline, job.input, {bookId: job.bookId});
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.passed, false, 'the demo K1 English is above E1');
  const findings = ecoFindings(result.report);
  assert.ok(findings.length >= 1);
  assert.ok(findings.every(f => f.pageNo && f.language && f.message));
  const failing = [...new Set(findings.map(f => f.pageNo))];
  const fix = ecoFixPrompt(job.input, job.outline, result.pagination, result.report);
  assert.match(fix, /Fix ONLY the entries listed/);
  assert.match(fix, /CURRENT TEXT OF THOSE ENTRIES/);
  for (const n of failing) assert.match(fix, new RegExp(`"pageNo":${n},`));
  const passing = result.pagination.pages.map(p => p.pageNo).filter(n => !failing.includes(n));
  for (const n of passing) assert.doesNotMatch(fix, new RegExp(`"pageNo":${n},`), `entry ${n} passed and is not sent`);
  assert.match(fix, /OUTPUT: exactly one JSON object \{"pages"/);
  const rows = failing.map(n => ({pageNo: n, textKo: result.pagination.pages.find(p => p.pageNo === n).textKo, textEn: 'I see a cat. The cat is big.'}));
  const merged = ecoMergeFix('```json\n' + JSON.stringify({pages: rows}) + '\n```', result.pagination, job.outline, job.input);
  assert.equal(merged.ok, true, JSON.stringify(merged.errors));
  assert.equal(merged.pagination.pages.length, result.pagination.pages.length, 'structure untouched');
  for (const n of failing) assert.equal(merged.pagination.pages.find(p => p.pageNo === n).textEn, 'I see a cat. The cat is big.');
  const unknown = ecoMergeFix(JSON.stringify({pages: [{pageNo: 99, textKo: 'x', textEn: 'y'}]}), result.pagination, job.outline, job.input);
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors[0], /99/);
  assert.equal(ecoMergeFix('hello', result.pagination, job.outline, job.input).ok, false);
});

test('R32 picture request: style, the drawer\'s cast, the place, the moment, the text, the size, continuity and no lettering; the cover variant', () => {
  const state = setup(), job = ecoJob(state, 'K2');
  job.outline = ecoAcceptOutline(JSON.stringify(demoOutline(normalizeStoryInput(job.input))), job.input).outline;
  const {pagination} = ecoAcceptPages(JSON.stringify(pagesReply(job, job.outline)), job.outline, job.input, {bookId: job.bookId});
  const book = bookOf(job, pagination);
  const first = ecoPicturePrompt(state, book, 0), second = ecoPicturePrompt(state, book, 1);
  assert.match(first, /Illustrate (spread|page) entry 1 of \d+/);
  assert.match(first, /Style: /);
  assert.match(first, /유하 \(Yuha\)/);
  assert.match(first, /a boy, 4 years old/);
  assert.match(first, /Place: /);
  assert.match(first, /The moment to draw: /);
  assert.match(first, /The entry reads — Korean: 「/);
  assert.match(first, /aspect ratio (21:9|3:2)/);
  assert.match(first, /No text, letters, numbers/);
  assert.match(second, /The previous entry showed: /);
  const spread = book.pages.findIndex(p => p.kind === 'spread');
  if (spread >= 0) assert.match(ecoPicturePrompt(state, book, spread), /21:9/);
  const cover = ecoPicturePrompt(state, book, 0, {cover: true});
  assert.match(cover, /front cover/);
  assert.match(cover, /where the app will print the title/);
  assert.doesNotMatch(cover, /The entry reads/);
  const all = ecoPicturePrompts(state, book);
  assert.equal(all.length, book.pages.length + 1);
  assert.equal(all.at(-1).cover, true);
});

test('R32 upload: only image files within the cap; the record is a final picture by the upload engine, markers are cleared, the old picture is kept in the history', () => {
  assert.match(ecoUploadCheck(null), /골라/);
  assert.match(ecoUploadCheck({type: 'text/plain', size: 10}), /PNG/);
  assert.match(ecoUploadCheck({type: 'image/png', size: ECO_UPLOAD_MAX_BYTES + 1}), /20MB/);
  assert.match(ecoUploadCheck({type: 'image/png', size: 0}), /빈 파일/);
  assert.equal(ecoUploadCheck({type: 'image/webp', size: 10}), '');
  const page = {pageNo: 1, scene: {action: 'runs'}, imageAssetId: 'image-old', imageUrl: 'asset:image-old', imageMeta: {quality: 'final', engine: 'openai'}, imageStale: true, imageStaleAssetId: 'image-old', simpleTextEditedAssetId: 'image-old'};
  const book = {pages: [page, {pageNo: 2}], cover: null};
  assert.deepEqual(ecoMissingPictures(book), [1]);
  const record = ecoAttachUpload(book, {index: 0}, {assetId: 'image-new'}, {fileName: 'p1.png', bytes: 1234, type: 'image/png', prompt: 'draw it'});
  assert.equal(record, page);
  assert.equal(page.imageAssetId, 'image-new');
  assert.equal(page.imageUrl, 'asset:image-new');
  assert.equal(page.imageMeta.quality, 'final');
  assert.equal(page.imageMeta.engine, 'upload');
  assert.equal(page.imageMeta.eco, true);
  assert.equal(page.imageMeta.bytes, 1234);
  assert.deepEqual(page.imageSceneSnapshot, {action: 'runs'});
  for (const key of ['imageStale', 'imageStaleAssetId', 'simpleTextEditedAssetId']) assert.equal(page[key], undefined, key);
  assert.equal(page.imageHistory.length, 1);
  assert.equal(page.imageHistory[0].imageAssetId, 'image-old');
  ecoAttachUpload(book, {cover: true}, {assetId: 'image-cover'}, {});
  assert.equal(book.cover.imageAssetId, 'image-cover');
  assert.equal(book.cover.meta.quality, 'final');
  ecoAttachUpload(book, {cover: true}, {assetId: 'image-cover-2'}, {});
  assert.equal(book.coverHistory.length, 1);
  assert.throws(() => ecoAttachUpload(book, {index: 5}, {assetId: 'x'}), /쪽을 찾지/);
  assert.throws(() => ecoAttachUpload(book, {index: 0}, {}), /보관한 그림/);
});
