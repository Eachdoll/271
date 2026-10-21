import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {normalizeStoryInput, alignEnglishText, alignProseParagraph} from '../dist/story-generation/pipeline.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {alignPageEnglish, canAlignEnglish, estimateAlignEnglish, requestPageEnglish} from '../dist/story-generation/page-tools.js';
import {renderStoryProseParagraphs} from '../dist/story-generation/ui.js';

/**
 * 2026-10-21 R30.1 영어 맞추기: after the parent edits the Korean of a page
 * (④, the pro book editor) or of a prose paragraph, one request rewrites
 * only the English to match — the Korean is never changed. Context: the text
 * before the edit, the neighbouring English, the beat and its brief, the
 * names, the refrain line when the old English had it. One more try when the
 * length check fails; then the closer attempt with notes, never an error.
 */
const input = (extra = {}) => normalizeStoryInput({bookId: 'r301', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}], topic: '바람 피리 찾기', pageCount: 12, language: 'bilingual', endingType: 'home_sleep', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, ...extra});
const fixture = (extra) => {
  const inp = input(extra), outline = structuredClone(demoOutline(inp));
  outline.plotContract = demoPlotContract(outline, inp);
  const prose = demoProse(outline, inp), pagination = demoPagination(outline, prose, inp);
  return {inp, outline, prose, pagination};
};
const reply = (json) => ({json, usage: {input: 100, output: 40}, meta: {requests: 1, model: 'mock-medium'}});
function engine(answers) {
  let n = 0;
  return {id: 'openai', calls: [], async complete(req) { this.calls.push(req); const a = answers[Math.min(n++, answers.length - 1)]; return typeof a === 'function' ? a(req) : reply(a); }};
}
const range = {min: 1, max: 3, target: 2};

test('R30.1 alignEnglishText: the Korean is the source, the old text says what changed, the refrain is kept, one retry then the closer answer', async () => {
  const {inp, outline} = fixture();
  const mock = engine([{en: 'Yuha runs to the old tree. "Look!" Yuha says.'}]);
  const r = await alignEnglishText({ko: '유하가 오래된 나무로 달려가요. "봐!" 유하가 말해요.', previousKo: '유하가 집으로 걸어가요.', previousEn: 'Yuha walks home. Slowly, slowly, look!', before: ['Yuha hears the wind.'], after: ['The wind stops.'], beatIndex: 2, brief: {beatIndex: 2, sounds: ['whoosh']}, range, refrainEn: 'Slowly, slowly, look!'}, outline, inp, {engine: mock});
  assert.equal(r.data.en, 'Yuha runs to the old tree. "Look!" Yuha says.');
  const req = mock.calls[0];
  assert.match(req.user, /\[Korean — final, match this\]\n유하가 오래된 나무로/u);
  assert.match(req.user, /\[Before the parent's edit\]\nKorean: 유하가 집으로 걸어가요\.\nEnglish: Yuha walks home/u);
  assert.match(req.user, /\[English just before\]\nYuha hears the wind\./u);
  assert.match(req.user, /\[English right after\]\nThe wind stops\./u);
  assert.match(req.user, /\[Names\] 유하 = Yuha/u);
  assert.match(req.user, /\[Refrain — keep this exact line once\] Slowly, slowly, look!/u, 'the old English had the refrain');
  assert.match(req.system, /Rewrite ONLY the English text/u);
  assert.match(req.system, /FROZEN ENGLISH LEVEL/u);
  // The refrain was required: the first answer misses it, so one retry.
  assert.equal(r.meta.attempts, 2);
  assert.match(mock.calls[1].user, /\[Problems with the last try/u);
  assert.match(r.meta.warnings.join(' '), /되풀이 말/u, 'kept with a note, never an error');
  // A passing first answer: one call.
  const ok = engine([{en: 'Yuha runs. Yuha smiles.'}]);
  const r2 = await alignEnglishText({ko: '유하가 달려요. 유하가 웃어요.', previousEn: 'Yuha walks.', range}, outline, inp, {engine: ok});
  assert.equal(ok.calls.length, 1);
  assert.deepEqual(r2.meta.warnings, []);
  assert.match(ok.calls[0].user, /\[Current English — out of date\]\nYuha walks\./u);
  assert.doesNotMatch(ok.calls[0].user, /Refrain/u, 'no refrain line unless the old English carried it');
  // The closer of two failing answers is kept.
  const long = 'Yuha runs. Yuha jumps. Yuha hops. Yuha sits. Yuha naps. Yuha eats. Yuha sings.';
  const twice = engine([{en: long}, {en: 'Yuha runs. Yuha jumps. Yuha hops. Yuha sits.'}]);
  const r3 = await alignEnglishText({ko: '유하가 놀아요.', range}, outline, inp, {engine: twice});
  assert.equal(r3.data.en, 'Yuha runs. Yuha jumps. Yuha hops. Yuha sits.');
  assert.equal(r3.meta.requests, 2);
  assert.match(r3.meta.warnings.join(' '), /많아요/u);
  // No usable answer: an error that carries the billed usage. Demo and empty Korean refuse before any call.
  const empty = engine([{en: ''}]);
  await assert.rejects(alignEnglishText({ko: '유하가 놀아요.', range}, outline, inp, {engine: empty}), (e) => e.usage?.input === 200 && /영어 글을 받지 못했어요/u.test(e.message));
  await assert.rejects(alignEnglishText({ko: '유하', range}, outline, inp, {engineId: 'demo'}), /데모/u);
  await assert.rejects(alignEnglishText({ko: '  ', range}, outline, inp, {engine: ok}), /비어/u);
});

test('R30.1 ④ page: only the English changes, the cost is recorded, the picture is only marked stale', async () => {
  const {inp, outline, prose, pagination} = fixture();
  const pages = pagination.pages.map((p) => ({...p, ko: p.textKo, en: p.textEn}));
  pages[2].imageAssetId = 'asset-3';
  pages[2].ko = pages[2].textKo = '유하가 새 길로 걸어가요. 바람이 휙 불어요.';
  const textSettings = {engine: 'openai', providers: {openai: {proxyEndpoint: 'https://story-proxy.invalid', transport: 'proxy'}}, hybrid: {enabled: false}};
  const book = {id: 'book-align', title: '바람', language: 'bilingual', storyInput: inp, outline, prose, pages, textGenerationSettings: textSettings};
  const state = {books: [book], characters: [], settings: {textGeneration: textSettings}, fullAutoJobs: {}};
  assert.ok(canAlignEnglish(book));
  assert.equal(canAlignEnglish({...book, textDemo: true}), false);
  assert.equal(canAlignEnglish({...book, language: 'ko'}), false);
  assert.ok(estimateAlignEnglish(state, book).usd > 0);
  const oldEn = pages[2].en, mock = engine([{en: 'Yuha walks a new path. The wind goes whoosh.'}]);
  let saved = 0;
  const r = await alignPageEnglish(state, book, 2, {engine: mock, save: () => { saved++; return true; }, previousKo: '옛 한글', previousEn: oldEn});
  assert.equal(r.changed, true);
  assert.equal(book.pages[2].en, 'Yuha walks a new path. The wind goes whoosh.');
  assert.equal(book.pages[2].textEn, book.pages[2].en);
  assert.equal(book.pages[2].ko, '유하가 새 길로 걸어가요. 바람이 휙 불어요.', 'the Korean is untouched');
  assert.equal(r.imageStale, true);
  assert.ok(saved >= 1);
  const row = book.textUsage.calls.at(-1);
  assert.equal(row.action, 'align-english');
  assert.equal(row.stage, 'alignEnglish');
  assert.match(mock.calls[0].user, /\[English just before\]/u);
  assert.match(mock.calls[0].user, new RegExp(`English: ${oldEn.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'));
  // A failed answer still records its cost and leaves the page as it was.
  const before = book.pages[3].en, bad = engine([{en: ''}]);
  await assert.rejects(alignPageEnglish(state, book, 3, {engine: bad, save: () => true}), /영어 글을 받지 못했어요/u);
  assert.equal(book.pages[3].en, before);
  assert.equal(book.textUsage.calls.at(-1).failed, true);
  // The pro editor asks without writing.
  const ask = await requestPageEnglish(state, book, 4, {engine: engine([{en: 'Yuha waves.'}])});
  assert.equal(ask.en, 'Yuha waves.');
  assert.notEqual(book.pages[4].en, 'Yuha waves.');
  assert.equal(ask.row.action, 'align-english');
});

test('R30.1 pro prose: the edited Korean paragraph’s beat gets one matching English paragraph; other beats stay', async () => {
  const {inp, outline, prose} = fixture();
  const edited = structuredClone(prose), koRows = edited.ko.split(/\n\s*\n/);
  koRows[1] = '유하가 숲길에서 빨간 장화를 찾아요.';
  edited.ko = koRows.join('\n\n');
  const beat = edited.paragraphBeats.ko[1];
  const mock = engine([{en: 'Yuha finds a red boot on the forest path.'}]);
  const r = await alignProseParagraph(edited, 1, outline, inp, {engine: mock});
  const enRows = r.data.en.split(/\n\s*\n/), labels = r.data.paragraphBeats.en;
  assert.equal(enRows[labels.indexOf(beat)], 'Yuha finds a red boot on the forest path.');
  assert.equal(labels.filter((l) => l === beat).length, 1);
  assert.equal(r.data.ko, edited.ko, 'the Korean is untouched');
  const oldEn = prose.en.split(/\n\s*\n/), oldLabels = prose.paragraphBeats.en;
  for (const [i, label] of oldLabels.entries()) if (label !== beat) assert.ok(enRows.includes(oldEn[i]), `beat ${label} unchanged`);
  assert.match(mock.calls[0].user, /빨간 장화/u);
  // The quality role picks the model when the caller passes the stage options.
  const roleEngine = engine([{en: 'Yuha finds a red boot.'}]);
  await alignProseParagraph(edited, 1, outline, inp, {engineId: 'openai', qualityEngines: {prose: roleEngine}});
  assert.equal(roleEngine.calls.length, 1);
  await assert.rejects(alignProseParagraph(edited, 1, outline, inp, {engineId: 'demo'}), /데모/u);
  // The EN button shows on the Korean tab only when asked.
  assert.match(renderStoryProseParagraphs(edited, 'ko', outline, {alignEn: true}), /data-story-action="align-paragraph-en"/u);
  assert.doesNotMatch(renderStoryProseParagraphs(edited, 'ko', outline), /align-paragraph-en/u);
});
