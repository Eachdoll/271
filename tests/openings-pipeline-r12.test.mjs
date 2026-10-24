import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import * as schemas from '../dist/story-generation/schemas.js';
import {normalizeStoryInput, paginateStory, repairPagination, rewriteStoryPage, finalizeStoryPagination, inspectStory, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {checkStory} from '../dist/story-generation/checker.js';
import {checkRichness} from '../dist/story-generation/richness.js';
import {inspectChildStory} from '../dist/story-generation/quality-gates.js';
import {configureStoryUI, resumeStoryDraft, cleanupStoryWorkflow, syncStoryDraft, inputFromWizard} from '../dist/story-generation/ui.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {validateStoredLibrary} from '../dist/library-storage.js';
import {validateImport} from '../dist/output.js';
import {validateWardrobeSelections} from '../dist/wardrobe.js';
import {estimateSimpleCosts, rewriteBookPage} from '../dist/story-generation/page-tools.js';
import {splitSentences} from '../dist/story-quality/dist/util.js';
import {CHILD_CURIOSITY_SYSTEM} from '../dist/story-quality/dist/prompts.js';
import {reviewStoryCoherence} from '../dist/story-generation/pipeline.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';

/**
 * R12-P4: openings pagination (normalize → merge → mix guard → validate →
 * staging → output checks), layout fields that survive every rewrite path,
 * combined and capped repairs, the child gate per opening, and the count guards
 * of pro approval and FULL AUTO. Page books keep every request and result (P0).
 */
const clone = value => JSON.parse(JSON.stringify(value));
const HOOK = '__DONGHWA_R12_OPENINGS__';
const CAST = [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'green', name: '초록이', nameEn: 'Greenie'}];
const PLACES = [{id: 'home', type: 'home', name: '유하네 집'}, {id: 'forest', name: '숲'}, {id: 'garden', name: '정원'}];
const SPECS = freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, {}, {layout: 'openings'}).specs;
function fixture(pageCount = 16, extra = {}) {
  const input = normalizeStoryInput({bookId: `p4-${pageCount}`, topic: '바람 피리 찾기', characters: CAST, backgrounds: PLACES, pageCount, endingType: 'home_sleep', layoutPolicy: L.openingsLayoutPolicy(), specs: SPECS, prosePolicy: {version: 1, condenseOverBudget: {ko: true, en: true}}, variants: [], ...extra});
  const outline = demoOutline(input), prose = demoProse(outline, input), pagination = demoPagination(outline, prose, input);
  return {input, outline, prose, pagination};
}
const reply = json => ({json, text: JSON.stringify(json), usage: {input: 10, output: 10}, meta: {requests: 1}});
/** A mock text engine: 'page' rewrites return a fixed page; 'pagination' answers come from `paginate`. */
function engine({fixPage = page => page, paginate} = {}) {
  const calls = {page: 0, pagination: 0, scene: 0, other: 0, requests: []};
  return {calls, id: 'openai', async complete(request) {
    calls.requests.push(request);
    const data = JSON.parse(request.user);
    if (data.openingPlan) { calls.pagination++; return reply(paginate(data, calls.pagination)); }
    if (data.targetPage && request.jsonSchema?.properties?.action) { calls.scene++; return reply({action: 'Yuha walks along the forest path and lifts a small stone beside the tall tree.'}); }
    if (data.targetPage) { calls.page++; const page = clone(data.targetPage); for (const key of L.LAYOUT_FIELDS) delete page[key]; delete page.staging; return reply(fixPage(page, data)); }
    calls.other++;
    throw Error(`unexpected request: ${request.system.slice(0, 80)}`);
  }};
}
/** Model-shaped entries (no layout fields) from a structured pagination. */
const modelEntries = pagination => pagination.pages.map(page => { const out = clone(page); for (const key of ['kind', 'side', 'openingNo', 'entryId']) delete out[key]; out.cue = page.cue === 'auto-merged' ? 'highlight' : page.cue || 'highlight'; return out; });
const koText = n => Array.from({length: n}, (_, i) => `유하가 숲길에서 작은 돌을 ${i + 1}번 찾아요.`).join(' ');
const OPTS = {skipCoherence: true, skipChildGate: true};

// ---------- pagination ----------
test('R12-P4 paginateStory: the free normalizer fixes model drift with 0 extra calls; the schema asks O..2O entries with a cue', async () => {
  const {input, outline, prose, pagination} = fixture();
  const entries = modelEntries(pagination);
  // Right-then-left on opening 2, a 3-entry opening 3 (split into 4+4+4), empty textEn on a pair page of opening 4.
  const o2 = entries.filter(e => e.beatIndex === 2), o3 = entries.filter(e => e.beatIndex === 3);
  const k3 = splitSentences(o3.map(e => e.textKo).join(' ')), e3 = splitSentences(o3.map(e => e.textEn).join(' '));
  const three = [0, 1, 2].map(i => ({...o3[0], textKo: k3.slice(i * 4, i * 4 + 4).join(' '), textEn: e3.slice(i, i + 1).join(' ') || e3.at(-1)}));
  const drifted = entries.filter(e => e.beatIndex !== 2 && e.beatIndex !== 3);
  drifted.splice(1, 0, o2[1], o2[0], ...three);
  drifted.forEach((e, i) => { e.pageNo = i + 1; });
  // Restore the right-then-left pageNos so they sort by pageNo.
  drifted[1].pageNo = 3; drifted[2].pageNo = 2;
  const pair4 = drifted.filter(e => e.beatIndex === 4);
  pair4[1].textEn = '';
  const mock = engine({paginate: () => ({cover: pagination.cover, pages: drifted})});
  const result = await paginateStory(outline, prose, input, {engine: mock, ...OPTS});
  assert.deepEqual([mock.calls.pagination, mock.calls.page, mock.calls.other], [1, 0, 0]);
  const request = mock.calls.requests[0];
  assert.equal(request.jsonSchema.properties.pages.minItems, 8);
  assert.equal(request.jsonSchema.properties.pages.maxItems, 16);
  assert.deepEqual(request.jsonSchema.properties.pages.items.properties.cue.enum, [...L.MODEL_CUES]);
  assert.match(request.system, /OPENINGS: the book has exactly 8 openings/u);
  assert.doesNotMatch(request.system, /Paginate the supplied APPROVED prose into exactly|Never return one page per beat|Start the turn at/u);
  assert.ok(JSON.parse(request.user).openingPlan.length === 8);
  assert.equal(L.validateOpenings(result.data, input, outline).valid, true, L.validateOpenings(result.data, input, outline).errors.join(' '));
  assert.equal(L.printedPagesOf(result.data.pages), 16);
  const byBeat = beat => result.data.pages.filter(p => p.beatIndex === beat);
  assert.deepEqual(byBeat(2).map(p => p.side), ['left', 'right']);
  assert.equal(byBeat(2)[0].textKo, o2[0].textKo, 'right-then-left is re-ordered by pageNo');
  assert.equal(byBeat(3).length, 2, 'three entries are joined into a pair');
  assert.deepEqual(byBeat(4).map(p => [p.kind, p.cue]), [['spread', 'auto-merged']], 'an empty-language pair page is merged, not a hard error');
  assert.deepEqual(result.data.openingAdjustments.map(a => [a.openingNo, a.action, a.detail]), [[3, 'joined', 'extra-entry'], [4, 'merged', 'empty-language']]);
  assert.equal(result.meta.checks.needsRepagination, false);
});

test('R12-P4 a beat with no entry costs exactly one repagination; beat indices are never rewritten', async () => {
  const {input, outline, prose, pagination} = fixture();
  const full = modelEntries(pagination), missing = full.filter(e => e.beatIndex !== 5).map((e, i) => ({...e, pageNo: i + 1}));
  const mock = engine({paginate: (_data, n) => ({cover: pagination.cover, pages: n === 1 ? missing : full})});
  const result = await paginateStory(outline, prose, input, {engine: mock, ...OPTS});
  assert.deepEqual([mock.calls.pagination, mock.calls.page], [2, 0]);
  const repagination = JSON.parse(mock.calls.requests[1].user);
  assert.ok(repagination.violations.some(v => v.kind === 'pagination' && /비트 5/u.test(v.message)));
  assert.equal(L.validateOpenings(result.data, input, outline).valid, true);
  // Beat 4's text stays beat 4 when beat 3 is missing and beat 4 is tagged 3.
  const shifted = full.map(e => (e.beatIndex === 3 ? null : e)).filter(Boolean);
  const fixed = L.normalizeOpenings(shifted, L.buildOpeningPlan(outline, 8), input.specs);
  assert.equal(fixed.needsRepagination, true);
  assert.ok(fixed.pages.filter(p => p.beatIndex === 4).every(p => full.some(e => e.beatIndex === 4 && e.textKo === p.textKo)));
});

test('R12-P4 the demo paginates openings 1, the turn and the close as spreads and passes its own checks (12 and 16 pages)', () => {
  for (const pageCount of [12, 16]) {
    const {input, outline, pagination} = fixture(pageCount);
    assert.equal(L.validateOpenings(pagination, input, outline).valid, true);
    const turn = outline.beats.find(b => b.type === 'turn').index;
    assert.deepEqual(pagination.pages.filter(p => p.kind === 'spread').map(p => p.beatIndex), [1, turn, outline.beats.length]);
    assert.equal(L.printedPagesOf(pagination.pages), pageCount);
    const report = inspectStory(outline, pagination, input);
    assert.equal(report.passed, true, JSON.stringify(report.violations));
    assert.equal(checkRichness(pagination, input, outline, []).valid, true);
    assert.equal(schemas.validatePagination(pagination, input, outline).valid, true);
  }
});

// ---------- layout fields survive every path ----------
test('R12-P4 rewrites keep every layout field: finishPageRewrite, the demo branch, a changed field is refused', async () => {
  const {input, outline, prose, pagination} = fixture();
  for (const index of [0, 1, 2]) {
    const mock = engine({fixPage: page => ({...page, textKo: `${page.textKo} 유하가 웃어요.`})});
    const result = await rewriteStoryPage(pagination, index + 1, outline, prose, input, {engine: mock});
    const before = pagination.pages[index], after = result.data.pages[index];
    for (const key of L.LAYOUT_FIELDS) assert.deepEqual(after[key], before[key], `${index}:${key}`);
    assert.match(after.textKo, /유하가 웃어요\.$/u);
    assert.match(mock.calls.requests[0].system, before.kind === 'spread' ? /This entry is a spread/u : /This entry is the (left|right) page of opening 2; its partner page \d+ stays unchanged/u);
    assert.equal(L.validateOpenings(result.data, input, outline).valid, true);
  }
  const bad = engine({fixPage: page => ({...page, kind: 'page'})});
  await assert.rejects(rewriteStoryPage(pagination, 1, outline, prose, input, {engine: bad}), /펼침 정보/u);
  const demo = await rewriteStoryPage(pagination, 2, outline, prose, input, {engineId: 'demo', sceneOnly: true});
  for (const key of L.LAYOUT_FIELDS) assert.deepEqual(demo.data.pages[1][key], pagination.pages[1][key]);
});

test('R12-P4 syncStoryDraft, toLegacyPages and export/import keep the layout fields; a picture stays only on its entry and kind', () => {
  const {input, outline, prose, pagination} = fixture();
  const book = {id: 'book-p4', storyDraftId: 'draft-p4', title: '바람', storyInput: input, outline, prose, pagination, pages: toLegacyPages(pagination)};
  for (const key of L.LAYOUT_FIELDS) assert.deepEqual(book.pages.map(p => p[key]), pagination.pages.map(p => p[key]));
  const state = {storyDrafts: {'draft-p4': {id: 'draft-p4', input, outline, prose, pagination: clone(pagination), wizard: {}}}, characters: [], books: [book], settings: {}};
  assert.equal(syncStoryDraft(book, state), true);
  const synced = state.storyDrafts['draft-p4'].pagination.pages;
  for (const key of L.LAYOUT_FIELDS) assert.deepEqual(synced.map(p => p[key]), pagination.pages.map(p => p[key]), key);
  // Export/import: the stored library and the JSON backup keep unknown page fields.
  const text = JSON.stringify({format: 'donghwa-workshop-library', version: 1, state: {version: 2, books: [book], characters: [{id: 'yuha', name: '유하'}], backgrounds: [], settings: {}}});
  const stored = validateStoredLibrary(text).state.books[0];
  const imported = validateImport(text).books[0];
  for (const copy of [stored, imported]) for (const key of L.LAYOUT_FIELDS) assert.deepEqual(copy.pages.map(p => p[key]), book.pages.map(p => p[key]), key);
  // A picture never moves to a different entry or kind: toLegacyPages drops it.
  const prior = toLegacyPages(pagination).map(page => ({...page, imageAssetId: 'asset-1', imageUrl: 'asset:asset-1'}));
  const same = toLegacyPages(pagination, prior);
  assert.ok(same.every(page => page.imageAssetId === 'asset-1'));
  const merged = clone(pagination);
  merged.pages[1] = {...merged.pages[1], kind: 'spread', side: 'spread', entryId: 'b2-spread'};
  assert.equal(toLegacyPages(merged, prior)[1].imageAssetId, undefined);
  // A legacy page book is untouched by the new comparison.
  const legacy = toLegacyPages({pages: [{pageNo: 1, beatIndex: 1, textKo: 'a', textEn: 'b', scene: {who: [], where: 'x', action: 'y', emotion: 'calm', timeOfDay: 'day', props: []}}]}, [{ko: 'a', en: 'b', scene: {who: [], where: 'x', action: 'y', emotion: 'calm', timeOfDay: 'day', props: []}, imageAssetId: 'keep'}]);
  assert.equal(legacy[0].imageAssetId, 'keep');
  // The app's keep-picture test compares entryId and kind, and wardrobe ranges are printed pages.
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /prior\.entryId === page\.entryId &&\s*prior\.kind === page\.kind/u);
  assert.match(app, /pageCount: printedPagesOf\(result\.pagination\.pages\)/u);
  const wardrobeState = {characters: [{id: 'yuha', wardrobe: [{id: 'raincoat', refImageIds: ['r'], characterId: 'yuha'}]}]};
  const wizard = {characterIds: ['yuha'], variantPageRanges: {yuha: [{from: 14, to: 16, variantId: null}]}};
  assert.throws(() => validateWardrobeSelections(wardrobeState, {...wizard, pageCount: pagination.pages.length}));
  assert.doesNotThrow(() => validateWardrobeSelections(wardrobeState, {...wizard, pageCount: L.printedPagesOf(pagination.pages)}));
});

test("R12-P4 the '이 쪽만 다시' book path rewrites text only and keeps the entry's layout fields", async () => {
  const {input, outline, prose, pagination} = fixture();
  const textSettings = {engine: 'openai', providers: {openai: {model: 'gpt-6-astra', proxyEndpoint: 'https://story-proxy.invalid', transport: 'proxy'}}, hybrid: {enabled: false}, storyEnrichment: false};
  const book = {id: 'book-rewrite', title: '바람', storyInput: input, outline, prose, pagination: clone(pagination), pages: toLegacyPages(pagination), textGenerationSettings: textSettings, storyDraftId: 'nope'};
  const state = {books: [book], characters: [], settings: {textGeneration: textSettings}, fullAutoJobs: {}};
  const mock = engine({fixPage: page => ({...page, textKo: `${page.textKo} 초록이가 웃어요.`})});
  const result = await rewriteBookPage(state, book, 2, {engine: mock, save: async () => {}});
  assert.equal(result.changed, true);
  for (const key of L.LAYOUT_FIELDS) {
    assert.deepEqual(book.pages[2][key], pagination.pages[2][key], key);
    assert.deepEqual(book.pagination.pages[2][key], pagination.pages[2][key], key);
  }
  // The rewrite estimate is sized per kind for openings books.
  const spreadUsd = estimateSimpleCosts(state, book, {pageIndex: 0}).pageTextUsd, pageUsd = estimateSimpleCosts(state, book, {pageIndex: 1}).pageTextUsd;
  assert.ok(spreadUsd > pageUsd, `${spreadUsd} > ${pageUsd}`);
});

// ---------- combined, capped repairs ----------
test('R12-P4 repairPagination: one failing spread costs exactly 1 rewrite and 0 paginations; a richness rewrite keeps 16 printed pages', async () => {
  const {input, outline, prose, pagination} = fixture();
  const broken = clone(pagination);
  broken.pages[0].textKo = koText(7); // a spread of 7 sentences blocks (band 9-17)
  const mock = engine({fixPage: (page, data) => ({...page, textKo: pagination.pages[data.targetPage.pageNo - 1].textKo})});
  const result = await repairPagination(outline, prose, broken, input, {engine: mock, ...OPTS});
  assert.deepEqual([mock.calls.page, mock.calls.pagination], [1, 0]);
  assert.deepEqual(result.meta.repairBudget, {used: 1, max: 16});
  assert.equal(result.data.pages[0].textKo, pagination.pages[0].textKo);
  // Reading and richness violations of one entry go out in ONE combined call.
  const both = clone(pagination);
  both.pages[3].textKo = `${koText(2)} 유하는 기뻤어요.`;
  const combined = engine({fixPage: (page, data) => ({...page, textKo: pagination.pages[data.targetPage.pageNo - 1].textKo})});
  const fixed = await repairPagination(outline, prose, both, input, {engine: combined, richness: true, ...OPTS});
  assert.equal(combined.calls.page, 1);
  const sent = JSON.parse(combined.calls.requests[0].user).violations;
  assert.ok(sent.some(v => v.type === 'richness' && v.code === 'direct_emotion') && sent.some(v => v.type === 'level'));
  assert.match(combined.calls.requests[0].system, /Enrich by replacing plain words/u);
  assert.equal(L.printedPagesOf(fixed.data.pages), 16);
  for (const key of L.LAYOUT_FIELDS) assert.deepEqual(fixed.data.pages.map(p => p[key]), pagination.pages.map(p => p[key]));
});

test('R12-P4 a mock engine that always fails stops at 2 × openings rewrites (16, shared with the richness loop; 12 at 12 pages)', async () => {
  for (const pageCount of [16, 12]) {
    const {input, outline, prose, pagination} = fixture(pageCount);
    const broken = clone(pagination);
    for (const page of broken.pages) page.textKo = `${koText(3)} 유하는 기뻤어요.`;
    const mock = engine();
    const result = await repairPagination(outline, prose, broken, input, {engine: mock, richness: true, ...OPTS});
    assert.equal(mock.calls.page, pageCount, `${pageCount}`);
    assert.equal(mock.calls.pagination, 0);
    assert.deepEqual(result.meta.repairBudget, {used: pageCount, max: pageCount});
    assert.equal(L.validateOpenings(result.data, input, outline).valid, true);
  }
});

test('R12-P4 the coherence page repair keeps layout fields even when the model sends a different kind', async () => {
  const {input, outline: base, prose, pagination} = fixture();
  const outline = {...base, plotContract: demoPlotContract(base, input)};
  let checks = 0;
  const mock = {id: 'openai', async complete(request) {
    const p = request.jsonSchema?.properties || {}, data = JSON.parse(request.user);
    if (p.passed && p.issues) {
      checks++;
      if (checks > 1) return reply({passed: true, issues: []});
      const page = data.pagination.pages[1];
      return reply({passed: false, issues: [{code: 'state_conflict', beatIndex: page.beatIndex, pageNo: page.pageNo, language: 'ko', severity: 'error', evidence: page.textKo.slice(0, 12), suggestion: '소품 상태를 맞춰 주세요.'}]});
    }
    if (p.pages) return reply({pages: data.repairTargets.map(t => { const page = clone(data.pagination.pages.find(x => x.pageNo === t.pageNo)); page.textKo = `${page.textKo} 통은 아직 차가워요.`; page.kind = 'spread'; page.side = 'spread'; return page; })});
    throw Error('unexpected');
  }};
  const result = await reviewStoryCoherence(outline, prose, pagination, input, {engine: mock, repair: true});
  const pages = result.data.pagination.pages;
  assert.match(pages[1].textKo, /통은 아직 차가워요\.$/u);
  for (const key of L.LAYOUT_FIELDS) assert.deepEqual(pages.map(p => p[key]), pagination.pages.map(p => p[key]), key);
});

// ---------- child gate per opening ----------
function childEngine({zeroOpening = null, missTurn = false} = {}) {
  const log = [];
  return {log, id: 'openai', async complete(request) {
    if (request.system.startsWith(CHILD_CURIOSITY_SYSTEM)) {
      const pageNos = [...request.user.matchAll(/^(\d+)\. /gmu)].map(m => Number(m[1]));
      log.push({mode: 'curiosity', pageNos});
      const zero = log.filter(row => row.mode === 'curiosity').length === 1 ? zeroOpening : null;
      return reply({pages: pageNos.map((pageNo, i) => ({pageNo, score: pageNo === zero ? 0 : 2, childQuestion: i === pageNos.length - 1 ? null : '다음은?', why: '이어져요.'})), dropPages: zero ? [zero] : [], overall: 8});
    }
    const beats = [...request.user.matchAll(/^(\d+) \[(\w+)\]/gmu)].map(m => ({index: Number(m[1]), type: m[2]}));
    const miss = missTurn && log.filter(row => row.mode === 'retell').length === 0;
    log.push({mode: 'retell'});
    return reply({retell: ['유하가 소리를 찾아요.', '유하가 통을 알아봐요.', '유하가 집에 와요.'], coveredBeats: beats.filter(b => !(miss && b.type === 'turn')).map(b => b.index), missingCore: miss ? ['turn'] : [], confusions: [], coherence: 2});
  }};
}
test('R12-P4 child gate: one item per opening (numbered by its last entry); a 0-score pair rewrites only its right page', async () => {
  const {input: base, outline, prose, pagination} = fixture();
  const input = {...base, storyQuality: {enabled: true, childSimulator: true}};
  const judge = childEngine({zeroOpening: 3}), rewrites = [];
  const services = {engineFor: async () => judge, rewriteStoryPage: async (pages, pageNo) => { rewrites.push(pageNo); const next = clone(pages); return {data: next, usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
  const result = await inspectChildStory(outline, prose, pagination, input, {engine: judge}, services);
  const last = L.openingsOf(pagination.pages).map(o => pagination.pages[o.indices.at(-1)].pageNo);
  assert.deepEqual(judge.log[0].pageNos, last, 'one simulator item per opening');
  assert.equal(pagination.pages[2].side, 'right');
  assert.deepEqual(rewrites, [3], 'the pair of opening 2 rewrites only its right page');
  // The ending repair spreads the original entry: every layout field stays.
  for (const key of L.LAYOUT_FIELDS) assert.deepEqual(result.data.pagination.pages.map(p => p[key]), pagination.pages.map(p => p[key]), key);
  assert.ok(!rewrites.includes(2));
  assert.equal(result.meta.childGate.phase, 'complete');
});

test('R12-P4 child gate: a post-turn repagination that changes one kind is accepted (the kinds go as a preference)', async () => {
  const {input: base, outline, prose, pagination} = fixture();
  const input = {...base, storyQuality: {enabled: true, childSimulator: true}};
  const judge = childEngine({missTurn: true});
  const changed = clone(pagination);
  // Opening 2 becomes a spread in the repagination.
  const o2 = changed.pages.filter(p => p.openingNo === 2), spread = {...o2[0], kind: 'spread', side: 'spread', entryId: 'b2-spread', cue: 'turn', textKo: `${o2[0].textKo} ${o2[1].textKo}`, textEn: `${o2[0].textEn} ${o2[1].textEn}`};
  changed.pages.splice(changed.pages.indexOf(o2[0]), 2, spread);
  changed.pages.forEach((p, i) => { p.pageNo = i + 1; });
  assert.equal(L.validateOpenings(changed, input, outline).valid, true);
  let repaginateOptions = null;
  const services = {
    engineFor: async () => judge,
    rewriteStoryPage: async pages => ({data: clone(pages), usage: {}, meta: {requests: 1}}),
    rewriteParagraph: async (current, language, index) => { const rows = current[language].split('\n\n'); rows[index] = `${rows[index]} ${language === 'ko' ? '유하가 단서를 떠올려요.' : 'Yuha remembers the clue.'}`; return {data: {...current, [language]: rows.join('\n\n')}, usage: {}, meta: {requests: 1}}; },
    repaginate: async (_outline, _prose, _input, options) => { repaginateOptions = options; return {data: clone(changed), usage: {}, meta: {requests: 1}}; },
  };
  const result = await inspectChildStory(outline, prose, pagination, input, {engine: judge}, services);
  assert.equal(repaginateOptions.openingKinds, 'S,P,P,P,P,S,P,S');
  assert.equal(result.data.pagination.pages.length, 12);
  assert.equal(result.meta.childGate.proseRevised, true);
});

// ---------- count guards ----------
const errorNode = {textContent: ''};
let currentState, rendered = '', readyCount = 0;
const handlers = {}, originalDocument = globalThis.document;
function uiDocument() {
  globalThis.document = {addEventListener: (type, handler) => { handlers[type] = handler; }, querySelectorAll: () => [], querySelector: selector => (selector === '#story-accept-failures' ? {checked: true} : selector === '#story-error' ? errorNode : null)};
  configureStoryUI({getState: () => currentState, isParent: () => true, protectedAction: fn => fn(), save: () => true, render: () => {}, toast: () => {}, modalHeader: title => `<h2>${title}</h2>`, showModal: value => { rendered = value; }, closeModal: () => {}, onReady: async () => { readyCount++; }});
}
const click = async (action, data = {}) => await handlers.click({target: {closest: () => ({dataset: {storyAction: action, ...data}})}, preventDefault: () => {}});
test('R12-P4 pro 쪽 나누기 and approval accept 13-entry/16-page and 9-entry/12-page books with 0 engine calls and no count banner', async () => {
  uiDocument();
  const priorFetch = globalThis.fetch;
  let network = 0;
  globalThis.fetch = async () => { network++; throw Error('no network'); };
  try {
    for (const pageCount of [16, 12]) {
      const {input, outline, prose, pagination} = fixture(pageCount);
      const textSettings = {engine: 'openai', providers: {openai: {model: 'gpt-6-astra'}}, hybrid: {enabled: false}, storyEnrichment: false};
      const draft = {id: `openings-ui-${pageCount}`, bookId: `openings-book-${pageCount}`, wizard: {}, input, outline, prose, pagination, textSettings, worldSnapshot: {imageEngine: 'sample'}, readingLevels: {specs: input.specs}, usage: {calls: []}, stage: 'paged', reviewMode: 'pages', demo: true};
      currentState = {settings: {textGeneration: textSettings}, backgrounds: PLACES, storyDrafts: {[draft.id]: draft}};
      readyCount = 0; errorNode.textContent = '';
      resumeStoryDraft(draft.id);
      assert.match(rendered, new RegExp(`펼침 ${pageCount / 2}개 · ${pageCount}쪽 · 그림 ${pagination.pages.length}장\\(펼침면 3 · 낱쪽 ${pagination.pages.length - 3}\\)`, 'u'));
      assert.doesNotMatch(rendered, /story-page-count|story-count-warning|split-page|merge-page|fit-page-count|다시 나누기 · API 요청/u);
      assert.match(rendered, /펼침 1 · 1–2쪽 펼침면/u);
      assert.match(rendered, /펼침 2 · 3쪽\(왼쪽\)/u);
      assert.match(rendered, /data-story-action="repaginate"/u);
      await click('approve-pages');
      assert.equal(readyCount, 1, errorNode.textContent);
      // Split/merge refuse on openings drafts; repagination is refused once a picture exists.
      const saved = () => currentState.storyDrafts[draft.id];
      Object.assign(saved(), {stage: 'paged', reviewMode: 'pages'});
      resumeStoryDraft(draft.id);
      await click('split-page', {index: '1'});
      assert.match(errorNode.textContent, /AI가 고른 펼침을 그대로/u);
      Object.assign(saved(), {pictureBook: {pages: [{imageAssetId: 'asset-1'}]}, stage: 'paged', reviewMode: 'pages'});
      resumeStoryDraft(draft.id);
      assert.doesNotMatch(rendered, /data-story-action="repaginate"/u);
      assert.match(rendered, /그림이 있는 책은 쪽을 다시 나누지 않아요/u);
      errorNode.textContent = '';
      await click('repaginate');
      assert.match(errorNode.textContent, /그림이 있는 책은 쪽을 다시 나누지 않아요/u);
      cleanupStoryWorkflow();
      // finalizeStoryPagination accepts the same book with no engine call.
      const final = await finalizeStoryPagination(outline, prose, pagination, input, {engine: engine(), ...OPTS});
      assert.equal(final.meta.requests, 0);
      assert.equal(final.meta.checks.needsRepagination, false);
    }
    // The beat card names the opening and its printed pages.
    const {input, outline} = fixture();
    const {renderStoryBeatCard} = await import('../dist/story-generation/ui.js');
    assert.match(renderStoryBeatCard({input, outline}, 3), /펼침 4 · 7–8쪽/u);
    assert.equal(network, 0);
  } finally {
    cleanupStoryWorkflow();
    globalThis.fetch = priorFetch;
    globalThis.document = originalDocument;
  }
});

test('R12-P4 free demo FULL AUTO (stopBefore text) at K2/E2 makes valid openings that pass their own checks (12 and 16 pages)', async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('no network'); };
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK];
  globalThis[HOOK] = true;
  try {
    for (const pageCount of [12, 16]) {
      const state = seedState();
      migrateWorldState(state);
      migrateReadingSettings(state.settings);
      const wizard = {characterIds: ['yuha', 'greenie'], backgroundIds: ['forest', 'garden'], topic: '바람 피리 찾기', pageCount, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', value: 'none', ending: 'home', storyDate: '2026-10-19T00:00:00.000Z'};
      const job = createFullAutoJob(state, wizard, {demo: true, stopBefore: 'text', planMode: 'selection'});
      assert.equal(job.input.layoutPolicy.kind, 'openings');
      const bookOf = payload => ({id: payload.bookId, storyInput: payload.input, outline: payload.outline, pagination: payload.pagination, pages: toLegacyPages(payload.pagination), readingLevelSnapshot: payload.readingLevels});
      await runFullAuto(state, job, {buildBook: bookOf});
      assert.equal(job.status, 'text-review', job.error || '');
      const input = normalizeStoryInput(job.input);
      assert.equal(L.validateOpenings(job.pagination, input, job.outline).valid, true);
      assert.equal(L.layoutOf(job.book), 'openings');
      assert.equal(L.printedPagesOf(job.book), pageCount);
      // R35: the demo job is a picture-led diet draft, judged the way the app judges it (lean, its own input).
      assert.deepEqual(input.bookFormat, {version: 1, id: 'pictureLed'});
      const story = checkStory(job.outline, job.pagination, {specs: input.specs, allowedNames: ['유하', 'Yuha', '초록이', 'Greenie'], storyInput: input});
      assert.equal(story.checks.find(c => c.id === 'level').passed, true, JSON.stringify(story.checks.find(c => c.id === 'level').violations));
      // 글이 많은 책: the R12 demo text under the strict checks, as before.
      const wordyJob = createFullAutoJob(state, {...wizard, bookFormatId: 'wordy'}, {demo: true, stopBefore: 'text', planMode: 'selection'});
      await runFullAuto(state, wordyJob, {buildBook: bookOf});
      assert.equal(wordyJob.status, 'text-review', wordyJob.error || '');
      const wordyInput = normalizeStoryInput(wordyJob.input);
      assert.deepEqual(wordyInput.specs.ko.units.spread, {min: 10, max: 15, target: 12});
      const wordyStory = checkStory(wordyJob.outline, wordyJob.pagination, {specs: wordyInput.specs, allowedNames: ['유하', 'Yuha', '초록이', 'Greenie']});
      assert.equal(wordyStory.checks.find(c => c.id === 'level').passed, true, JSON.stringify(wordyStory.checks.find(c => c.id === 'level').violations));
      // Inputs made by inputFromWizard carry the same policy.
      assert.equal(inputFromWizard(state, wizard, {layout: 'openings'}).input.layoutPolicy.kind, 'openings');
    }
  } finally {
    if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK];
    globalThis.fetch = priorFetch;
  }
});
