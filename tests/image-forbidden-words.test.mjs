import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {seedState, generateBook} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, captureBookGenerationSnapshot, sceneGenerationRequest, createCharacterSheetRequest, bookCastNames, coverActionEditedByParent} from '../dist/image-generation/world.js';
import {sceneBriefText} from '../dist/image-generation/scene-prompt.js';
import {createVariantGenerationRequest} from '../dist/wardrobe.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, runFullAuto, fullAutoProgress} from '../dist/full-auto.js';
import {toLegacyPages} from '../dist/story-generation/pipeline.js';
import {bindSeriesBackgrounds} from '../dist/story-generation/continuity.js';
import {generateImage} from '../dist/image-generation/providers.js';
import {STYLE_PRESETS, LEGACY_STYLE_PRESETS, forbiddenStyleMatches, validateStylePreset, DEFAULT_FORBIDDEN_STYLE_WORDS, checkForbiddenWords, forbiddenWordFindings, forbiddenWordAdvice, normalizeForbiddenText} from '../dist/image-generation/styles.js';
import {revokeImageURLs} from '../dist/image-generation/assets.js';

// In-memory IndexedDB for saveImage, as in device-transfer.test.mjs.
const oldDB = globalThis.indexedDB, oldFetch = globalThis.fetch, databases = new Map();
let paidFetches = 0;
before(() => {
  globalThis.indexedDB = {open(name) {
    const request = {};
    queueMicrotask(() => {
      if (!databases.has(name)) databases.set(name, new Map());
      const records = databases.get(name);
      request.result = {objectStoreNames: {contains: () => true}, close() {}, transaction() {
        const tx = {};
        const perform = fn => {const operation = {}; queueMicrotask(() => {operation.result = fn(); operation.onsuccess?.(); tx.oncomplete?.();}); return operation;};
        tx.objectStore = () => ({get: id => perform(() => records.get(id)), put: record => perform(() => {records.set(record.id, record); return record.id;}), delete: id => perform(() => records.delete(id))});
        return tx;
      }};
      request.onsuccess?.();
    });
    return request;
  }};
  // Only local data: URLs may be read; any network request would be a paid or external call.
  globalThis.fetch = async (url, ...rest) => {
    if (String(url?.url || url).startsWith('data:')) return oldFetch(url, ...rest);
    paidFetches++;
    throw Error('network is not allowed in this test: ' + String(url).slice(0, 60));
  };
  const store = new Map();
  globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
});
after(() => {globalThis.indexedDB = oldDB; globalThis.fetch = oldFetch; revokeImageURLs();});

function setup() {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha', 'toto'], backgroundIds: [], topic: '유하와 토토의 별 찾기', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'};
  return {state, wizard};
}
// The app's buildStoryResultBook, reduced to the fields the image path reads.
const appBuilder = state => result => {
  const options = {...result.wizard, pageCount: result.pagination.pages.length, koreanLevel: result.readingLevels.koreanLevel, englishLevel: result.readingLevels.englishLevel};
  const pages = toLegacyPages(result.pagination), book = generateBook(options, pages, state.characters, state.books);
  book.id = result.bookId; book.pages = pages;
  Object.assign(book, {outline: result.outline, storyQuality: result.outline.quality || null, proseCoherence: result.proseCoherence || null, pageCoherence: result.pageCoherence || null,
    sceneBriefs: result.sceneBriefs || [], prose: result.prose, pagination: result.pagination, stage: 'paged', storyInput: result.input, storyDraftId: result.id,
    textGenerationSettings: result.textSettings, textDemo: result.demo, localSample: result.demo, textUsage: result.usage, readingLevelSnapshot: result.readingLevels,
    worldId: result.worldId, worldSettingsSnapshot: structuredClone(result.worldSnapshot), approved: false,
    backgroundIds: [...new Set([...(result.outline.settings || []).map(s => s.backgroundId).filter(Boolean), ...(options.backgroundIds || [])])]});
  try {
    captureBookGenerationSnapshot(state, book);
    book.generationSnapshot.backgroundReferenceByPage = bindSeriesBackgrounds(book, book.generationSnapshot.backgrounds);
  } catch (error) {book.sheetSetupNotice = error.message;}
  return book;
};
const style = (patch = {}) => ({...structuredClone(STYLE_PRESETS[0]), ...patch});
const sample = request => generateImage({referenceImages: [], seed: 7, size: '1024x1024', quality: 'draft', ...request}, {engine: 'sample'});
const forbidden = {code: 'forbidden_style_name'};

test('style text keeps every default forbidden word and the parent-facing style checks', () => {
  for (const preset of [...STYLE_PRESETS, ...LEGACY_STYLE_PRESETS]) assert.equal(validateStylePreset(preset).valid, true, preset.id);
  for (const name of ['Frozen style', 'disney', 'Disney 수채화', '지브리풍 숲']) {
    const result = validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name}));
    assert.equal(result.valid, false, name); assert.ok(result.errors.some(e => e.includes('금칙어')), name);
  }
  assert.deepEqual(forbiddenStyleMatches('a Disneyesque castle'), ['disney']);
  assert.deepEqual(forbiddenStyleMatches('pixar-like faces, disney풍'), ['disney', 'pixar']);
  assert.deepEqual(forbiddenStyleMatches('Studio  Ghibli meadow').sort(), ['ghibli', 'studio ghibli']);
  assert.deepEqual(forbiddenStyleMatches('soft mooncat drawing', ['MoonCat']), ['mooncat']);
  // Latin words match whole words only.
  assert.deepEqual(forbiddenStyleMatches('unfrozen chelsea hotelsand'), []);
  // Style text treats "frozen" strictly; that is why the old ledger header broke every plotContract page.
  assert.deepEqual(forbiddenStyleMatches('FROZEN EVENT AND STATE LEDGER'), ['frozen']);
  for (const word of DEFAULT_FORBIDDEN_STYLE_WORDS) assert.ok(forbiddenStyleMatches(`soft pencil ${word.toUpperCase()}`).includes(word), word);
});

test('lenient story text: brand and Korean names only, and a cast name plus particle is not 토토로', () => {
  const description = (text, names) => forbiddenStyleMatches(text, [], {scope: 'description', names});
  assert.deepEqual(description('The pond was frozen. FROZEN EVENT AND STATE LEDGER'), []);
  assert.deepEqual(description('Toto stood frozen like a statue, with a frozen look.'), []);
  // FIX-IMG-3: model-written text has no title-word (frozen/elsa/mickey) check at all.
  for (const text of ['a frozen-style ice palace', 'a Frozen-like gown', 'Frozen movie princess dress', 'Elsa waves'])
    assert.deepEqual(description(text), [], text);
  assert.deepEqual(description('겨울왕국 같은 성'), ['겨울왕국']);
  assert.deepEqual(description('토토로 달려가요'), ['토토로'], 'without a known name it is the film');
  assert.deepEqual(description('토토로 달려가요', ['토토', 'Toto']), []);
  assert.deepEqual(description('유하와 토토로 달려가요', ['토토']), []);
  assert.deepEqual(description('꼬마토토로 인형', ['토토']), ['토토로'], 'only a token that starts with the name');
  assert.deepEqual(description('토토로 달려가요', ['토토로']), ['토토로'], 'a character named after the film is still refused');
});

test('provider check: supplied text only, style names still refused', async () => {
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style({name: 'Frozen style'})}), forbidden);
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style({name: 'disney'})}), forbidden);
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style({stylePrompt: 'soft pixar look'})}), forbidden);
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style(), negativePrompt: 'not ghibli'}), forbidden);
  // A parent's free prompt (no declared parts) is still checked as a whole.
  await assert.rejects(sample({prompt: 'a disney princess', stylePreset: style()}), forbidden);
  assert.ok((await sample({prompt: 'a cat on the frozen pond', stylePreset: style()})).imageUrl);
  // App scaffolding outside the declared parts is never checked.
  assert.ok((await sample({prompt: 'FROZEN LEDGER: Mickey', stylePreset: style(), forbiddenWordCheck: {text: ['a calm cat'], names: []}})).imageUrl);
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['Totoro ears'], names: []}}), forbidden);
});

test('character sheet requests still refuse forbidden names in the parent description', async () => {
  const {state} = setup();
  const toto = createCharacterSheetRequest(state, 'toto');
  assert.ok((await generateImage(toto, {engine: 'sample'})).imageUrl);
  state.characters.find(c => c.id === 'toto').description = '디즈니 공주 드레스';
  await assert.rejects(generateImage(createCharacterSheetRequest(state, 'toto'), {engine: 'sample'}), forbidden);
});

test('demo FULL AUTO with the sample engine draws every page and the cover of a plotContract book', async () => {
  paidFetches = 0;
  const {state, wizard} = setup();
  assert.equal(getActiveWorld(state).imageEngine, 'sample');
  const job = createFullAutoJob(state, wizard, {demo: true, planMode: 'selection', stopBefore: 'pages'});
  await runFullAuto(state, job, {buildBook: appBuilder(state)});
  assert.equal(job.status, 'pages-ready');
  const book = job.book;
  assert.ok(book.outline.plotContract, 'the demo outline carries a plot contract');
  // A scene request for this book passes the provider check with the real ledger in its prompt.
  const request = sceneGenerationRequest(state, book, 0, {quality: 'final'});
  assert.match(request.prompt, /LOCKED EVENT AND STATE LEDGER/); assert.doesNotMatch(request.prompt, /FROZEN EVENT/);
  assert.ok((await generateImage(request, {engine: 'sample'})).imageUrl);
  // Page text "토토로 달려가요" is 토토 + particle in a book where 토토 is in the cast.
  book.pages[1].ko = '토토로 달려가요.';
  assert.ok((await generateImage(sceneGenerationRequest(state, book, 1, {quality: 'final'}), {engine: 'sample'})).imageUrl);
  // A parent-entered place description is still checked.
  const place = book.generationSnapshot.backgrounds[0], kept = place.description;
  place.description = 'a Frozen-style ice palace';
  const placed = book.pages.findIndex((p, i) => sceneGenerationRequest(state, book, i).forbiddenWordCheck.text.includes('a Frozen-style ice palace'));
  assert.ok(placed >= 0);
  await assert.rejects(generateImage(sceneGenerationRequest(state, book, placed), {engine: 'sample'}), forbidden);
  place.description = kept;

  job.stopBefore = null;
  const finished = await runFullAuto(state, job, {buildBook: appBuilder(state)});
  assert.equal(job.status, 'review', job.error || ''); assert.equal(job.error, null);
  assert.equal(finished.pages.length, 12);
  assert.ok(finished.pages.every(p => p.imageAssetId && p.imageMeta?.quality === 'final' && p.imageMeta.engine === 'sample'));
  assert.match(finished.pages[0].imageMeta.prompt, /LOCKED EVENT AND STATE LEDGER/);
  assert.ok(finished.cover?.imageAssetId); assert.equal(fullAutoProgress(job).fraction, 1);
  assert.equal(paidFetches, 0);
  assert.ok(job.usage.calls.every(c => !c.costUsd && !c.costUsdEstimated));
});

// ---- FIX-IMG: whole-cast names on the cover, particle-only name exemption, joined brand spellings, "frozen" in parent-entered text ----
async function demoBook(characterIds) {
  const {state, wizard} = setup();
  if (characterIds) Object.assign(wizard, {characterIds, topic: '유하의 별 찾기'});
  const job = createFullAutoJob(state, wizard, {demo: true, planMode: 'selection', stopBefore: 'pages'});
  await runFullAuto(state, job, {buildBook: appBuilder(state)});
  assert.equal(job.status, 'pages-ready', job.error || '');
  return {state, job, book: job.book};
}
const draw = (state, book, index, options = {}) => generateImage(sceneGenerationRequest(state, book, index, {quality: 'final', ...options}), {engine: 'sample'});

test('the cover exempts every cast name, not only the lead it shows', async () => {
  paidFetches = 0;
  const {state, book} = await demoBook();
  assert.deepEqual(book.characterIds.slice(0, 2), ['yuha', 'toto']);
  book.pagination.cover = {...book.pagination.cover, sceneAction: '토토로 달려가요'};
  const cover = sceneGenerationRequest(state, book, 0, {cover: true, quality: 'final'});
  assert.ok(cover.forbiddenWordCheck.names.includes('토토'), 'a supporting character is part of the cast');
  assert.equal(cover.referenceImages.filter(r => r.role === 'character_front').length, 1, 'the cover still draws only the lead');
  assert.ok((await generateImage(cover, {engine: 'sample'})).imageUrl);
  // The topic fallback when no cover action was planned.
  delete book.pagination.cover.sceneAction; book.topic = '유하가 토토로 변신한 날';
  assert.ok((await draw(state, book, 0, {cover: true})).imageUrl);
  // The film itself is still refused on the cover.
  book.pagination.cover.sceneAction = 'Yuha hugs a Totoro plush';
  await assert.rejects(draw(state, book, 0, {cover: true}), forbidden);
  assert.equal(paidFetches, 0);
});

test('a cast name exempts only the name plus a particle, never a longer forbidden word', async () => {
  const check = (text, names, scope = 'description') => forbiddenStyleMatches(text, [], {scope, names});
  for (const scope of ['description', 'material', 'style']) {
    assert.deepEqual(check('미야자키풍 숲', ['미야'], scope), ['미야자키'], scope);
    assert.deepEqual(check('겨울왕국처럼 반짝이는 성', ['겨울'], scope), ['겨울왕국'], scope);
    assert.deepEqual(check('디즈니 공주 드레스', ['디즈'], scope), ['디즈니'], scope);
  }
  for (const text of ['토토로 달려가요', '유하와 토토로 달려가요', '토토로는 웃어요', '토토로도 가요', '토토로만 알아요', '토토로부터 온 편지'])
    assert.deepEqual(check(text, ['토토']), [], text);
  assert.deepEqual(check('토토로봇 장난감', ['토토']), ['토토로'], 'what follows the name is not a particle');
  assert.deepEqual(check('미야는 미야자키풍 숲에 살아요', ['미야']), ['미야자키']);
  // A character's own name never lets its description name the work it shares a prefix with.
  const {state} = setup(), toto = state.characters.find(c => c.id === 'toto');
  for (const [id, name, description] of [['miya', '미야', '미야자키풍 숲에 사는 고양이'], ['gyeoul', '겨울', '겨울왕국처럼 파란 드레스'], ['dizu', '디즈', '디즈니 공주 드레스']]) {
    state.characters.push({...structuredClone(toto), id, name, nameEn: '', description});
    await assert.rejects(generateImage(createCharacterSheetRequest(state, id), {engine: 'sample'}), forbidden, name);
  }
  state.characters.push({...structuredClone(toto), id: 'miya2', name: '미야', nameEn: 'Miya', description: '미야는 숲에 사는 고양이예요'});
  assert.ok((await generateImage(createCharacterSheetRequest(state, 'miya2'), {engine: 'sample'})).imageUrl);
});

test('distinctive brand names count even joined to other words; ordinary English words stay whole-word', async () => {
  for (const name of ['DisneyPixar look', 'studioghibli meadow', 'pixar3d render', 'mickeymouse ears', 'dreamworksstyle faces', 'MiyazakiForest'])
    assert.equal(validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name})).valid, false, name);
  assert.deepEqual(forbiddenStyleMatches('DisneyPixar look'), ['disney', 'pixar']);
  assert.deepEqual(forbiddenStyleMatches('studioghibli').sort(), ['ghibli', 'studio ghibli']);
  assert.deepEqual(forbiddenStyleMatches('pixar3d'), ['pixar']);
  assert.deepEqual(forbiddenStyleMatches('mickeymouse'), ['mickey']);
  for (const scope of ['material', 'description']) {
    assert.deepEqual(forbiddenStyleMatches('a DisneyPixar princess', [], {scope}), ['disney', 'pixar'], scope);
    assert.deepEqual(forbiddenStyleMatches('a totoroish forest spirit', [], {scope}), ['totoro'], scope);
  }
  // Ordinary English keeps whole-word matching: Chelsea is not Elsa, unfrozen is not Frozen.
  assert.deepEqual(forbiddenStyleMatches('unfrozen chelsea hotelsand'), []);
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style({stylePrompt: 'soft DisneyPixar look'})}), forbidden);
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['a studioghibli meadow'], names: []}}), forbidden);
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: [], generated: ['a pixar3d hero'], names: []}}), forbidden);
});

test('"frozen" in parent-entered text is refused as a style reference; story text and scaffolding stay lenient', async () => {
  const material = text => forbiddenStyleMatches(text, [], {scope: 'material'}), story = text => forbiddenStyleMatches(text, [], {scope: 'description'});
  for (const text of ['a gown like Frozen', 'a castle inspired by Frozen', 'drawn in the style of Frozen', 'Frozen style ice palace', 'a Frozen-inspired cape', 'a dress like frozen', 'like Frozen 2', 'the movie Frozen'])
    assert.deepEqual(material(text), ['frozen'], text);
  for (const text of ['a frozen lake', 'the pond looked like frozen glass', 'icicles hang from frozen branches']) {
    assert.deepEqual(material(text), [], text); assert.deepEqual(story(text), [], text);
  }
  // FIX-IMG-3: "look" right after "frozen" is a style cue in parent text; story text has no title-word check.
  assert.deepEqual(material('Toto stood frozen like a statue, with a frozen look.'), ['frozen']);
  assert.deepEqual(story('Toto stood frozen like a statue, with a frozen look.'), []);
  assert.deepEqual(story('a Frozen-style gown'), []); assert.deepEqual(story('a frozen lake like glass'), []);
  // Provider: declared parent text strictly, generated text leniently, scaffolding never.
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['a coat like Frozen'], generated: [], names: []}}), forbidden);
  assert.ok((await sample({prompt: 'FROZEN LEDGER: inspired by Frozen', stylePreset: style(), forbiddenWordCheck: {text: ['a calm cat by the frozen lake'], generated: ['The frozen lake shines.'], names: []}})).imageUrl);
  // A free prompt without declared parts is the parent's own text.
  await assert.rejects(sample({prompt: 'a winter castle inspired by Frozen', stylePreset: style()}), forbidden);
  assert.ok((await sample({prompt: 'a cat beside a frozen pond', stylePreset: style()})).imageUrl);
  // Character sheet: the parent's description.
  const {state: sheetState} = setup(), toto = sheetState.characters.find(c => c.id === 'toto');
  toto.description = '파란 망토, a cape like Frozen';
  await assert.rejects(generateImage(createCharacterSheetRequest(sheetState, 'toto'), {engine: 'sample'}), forbidden);
  toto.description = '파란 망토, a cape the color of a frozen lake';
  assert.ok((await generateImage(createCharacterSheetRequest(sheetState, 'toto'), {engine: 'sample'})).imageUrl);
  // Scene: place descriptions and a page's own image prompt are strict, page text is lenient.
  const {state, book} = await demoBook();
  const place = book.generationSnapshot.backgrounds[0], kept = place.description;
  const placed = book.pages.findIndex((p, i) => sceneGenerationRequest(state, book, i).forbiddenWordCheck.text.includes(kept));
  assert.ok(placed >= 0);
  place.description = 'a winter castle inspired by Frozen';
  await assert.rejects(draw(state, book, placed), forbidden);
  place.description = 'a castle beside a frozen lake';
  assert.ok((await draw(state, book, placed)).imageUrl);
  place.description = kept;
  const page = book.pages[2];
  page.imagePrompt = 'Yuha skates, in the style of Frozen';
  const override = sceneGenerationRequest(state, book, 2);
  assert.ok(override.forbiddenWordCheck.text.includes(page.imagePrompt)); assert.ok(!override.forbiddenWordCheck.generated.includes(page.imagePrompt));
  await assert.rejects(draw(state, book, 2), forbidden);
  page.imagePrompt = 'Yuha skates on the frozen lake';
  assert.ok((await draw(state, book, 2)).imageUrl);
  delete page.imagePrompt;
  page.ko = '유하가 얼어붙은 호수를 봐요.'; page.en = 'The frozen lake shines.';
  assert.ok(sceneGenerationRequest(state, book, 2).forbiddenWordCheck.generated.includes('The frozen lake shines.'));
  assert.ok((await draw(state, book, 2)).imageUrl);
});

// ---- FIX-IMG-2: Korean spellings, split brand names, particle chains after a cast name, pixel art, "frozen" precision, format characters ----
test('Korean spellings of DreamWorks, Elsa and Mickey Mouse, and DreamWorks written split, are refused', async () => {
  for (const word of ['드림웍스', '엘사', '미키마우스', '미키 마우스']) assert.ok(DEFAULT_FORBIDDEN_STYLE_WORDS.includes(word), word);
  for (const name of ['드림웍스풍 3D', '엘사 드레스풍', '미키마우스 수채화', '미키 마우스 수채화', 'Dream Works 3D', 'dream-works faces', 'DreamWorks look', 'dream_works'])
    assert.equal(validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name})).valid, false, name);
  for (const text of ['Dream Works 3D', 'dream-works', 'DreamWorks', 'dreamworks'])
    for (const scope of ['style', 'material', 'description']) assert.deepEqual(forbiddenStyleMatches(text, [], {scope}), ['dreamworks'], `${scope}: ${text}`);
  for (const scope of ['material', 'description']) {
    assert.deepEqual(forbiddenStyleMatches('엘사처럼 땋은 머리', [], {scope}), ['엘사'], scope);
    assert.ok(forbiddenStyleMatches('미키 마우스 귀 머리띠', [], {scope}).includes('미키 마우스'), scope);
  }
  // Strict scope reads Korean names with or without spaces, so both list spellings match there.
  assert.deepEqual(forbiddenStyleMatches('미키 마우스 귀 머리띠', [], {scope: 'material'}), ['미키마우스', '미키 마우스']);
  // Ordinary words that only share letters stay free, and model-written "her dream works" is English.
  assert.deepEqual(forbiddenStyleMatches('a dream about works of art, 호텔 사장'), []);
  assert.deepEqual(forbiddenStyleMatches('Her dream works!', [], {scope: 'description'}), []);
  assert.deepEqual(forbiddenStyleMatches('dream works 3d'), ['dreamworks'], 'style text counts every spelling');
  // A character sheet whose parent description names Elsa is refused before any request.
  const {state} = setup(), toto = state.characters.find(c => c.id === 'toto');
  toto.description = '엘사처럼 땋은 머리';
  await assert.rejects(generateImage(createCharacterSheetRequest(state, 'toto'), {engine: 'sample'}), forbidden);
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style({stylePrompt: 'soft Dream Works shading'})}), forbidden);
});

test('a cast name may carry a chain of particles (토토로서, 토토로써는, 토토로의, 토토로는요) in story text, never another word', async () => {
  const check = (text, names, scope = 'description') => forbiddenStyleMatches(text, [], {scope, names});
  for (const scope of ['description', 'material']) {
    // FIX-IMG-3: only model-written story text exempts a cast name; parent text never does.
    for (const text of ['토토로서 할 일', '토토로서는 처음 보는 바다였어요', '토토로써는 처음이에요', '토토로써 충분해요', '토토로의 모자', '토토로는요 몰라요', '토토로부터는 편지가 없어요', '토토로까지요', '토토로서의 하루'])
      assert.deepEqual(check(text, ['토토'], scope), scope === 'description' ? [] : ['토토로'], `${scope}: ${text}`);
    // Not a particle after the name: 토토 + 로봇 still spells the film's name.
    assert.deepEqual(check('토토로봇 장난감', ['토토'], scope), ['토토로'], scope);
    assert.deepEqual(check('토토로가 나타났어요', ['토토'], scope), ['토토로'], scope);
    // A cast name that is the start of a forbidden word never exempts it.
    assert.deepEqual(check('미야자키풍 숲', ['미야'], scope), ['미야자키'], scope);
    assert.deepEqual(check('겨울왕국처럼 반짝여요', ['겨울'], scope), ['겨울왕국'], scope);
    assert.deepEqual(check('디즈니 공주', ['디즈'], scope), ['디즈니'], scope);
  }
  // A real story page that says "토토로서" draws when 토토 is in the cast.
  const {state, book} = await demoBook();
  book.pages[3].ko = '토토로서는 처음 보는 바다였어요.';
  assert.ok((await draw(state, book, 3)).imageUrl);
  book.pages[3].ko = '토토로봇이 바다를 봐요.';
  await assert.rejects(draw(state, book, 3), forbidden);
});

test('pixel art ("Pixart") is not Pixar; Pixar joined or spaced still is', () => {
  for (const name of ['Pixart pastel', 'pixart 16bit', 'PixArt Alpha look'])
    assert.equal(validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name})).valid, true, name);
  for (const name of ['pixar3d', 'DisneyPixar', 'Pixar style', 'soft pixar look', 'PIXAR'])
    assert.equal(validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name})).valid, false, name);
  assert.deepEqual(forbiddenStyleMatches('pixart 16bit sprites'), []);
  assert.deepEqual(forbiddenStyleMatches('pixar3d'), ['pixar']);
  assert.deepEqual(forbiddenStyleMatches('DisneyPixar'), ['disney', 'pixar']);
});

test('"frozen" counts as the film when written as the title or tied to a style cue; ordinary ice stays free', async () => {
  const material = text => forbiddenStyleMatches(text, [], {scope: 'material'}), story = text => forbiddenStyleMatches(text, [], {scope: 'description'});
  // Lowercase "frozen" without a style cue right before or after it is ice, in parent text too.
  for (const text of ['like frozen, he waited', 'like frozen; then she ran', 'The frozen princess woke up', 'frozen-lake blue scarf', 'melted from frozen solid', 'a frozen-looking pond'])
    assert.deepEqual(material(text), [], text);
  // FIX-IMG-3: in parent text all caps is the title anywhere, and "film"/"look" right after "frozen" are style cues.
  for (const text of ['LIKE FROZEN SNOW', 'a thin frozen film on the window', 'a frozen look'])
    assert.deepEqual(material(text), ['frozen'], text);
  // Model-written text has no title-word check at all.
  for (const text of ['a thin frozen film on the window', 'The frozen princess woke up', 'LIKE FROZEN SNOW', 'a Frozen 2 style gown', 'Frozen2', 'Frozen 느낌의 성', 'Frozen princess dress', 'an ice dress like in Frozen'])
    assert.deepEqual(story(text), [], text);
  // The title: all caps after a cue, sequels, more cues before and after.
  for (const text of ['like FROZEN', 'Frozen 2 style', 'frozen 2 style', 'a Frozen2 cape', 'Frozen II', 'Frozen II-inspired gown', 'an ice dress like in Frozen', 'a dress from Frozen', 'similar to Frozen', 'as seen in Frozen', 'Frozen look', 'Frozen theme party', 'a Frozen vibe', 'Frozen 느낌', 'Frozen풍 드레스', 'Frozen princess dress', 'FROZEN PRINCESS DRESS', 'Frozen film poster'])
    assert.deepEqual(material(text), ['frozen'], text);
  // The strict style editor refuses "Frozen2" too.
  assert.equal(validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name: 'Frozen2 shimmer'})).valid, false);
  // Provider: the same rules for declared parent text and story text.
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['a cape like in Frozen'], names: []}}), forbidden);
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['LIKE FROZEN SNOW'], names: []}}), forbidden);
  assert.ok((await sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['like frozen, he waited', 'frozen-lake blue scarf'], generated: ['The frozen princess woke up.', 'LIKE FROZEN SNOW', 'Frozen film covered the pond.'], names: []}})).imageUrl);
});

test('zero-width and other format characters cannot hide a forbidden name', async () => {
  const zw = String.fromCharCode(0x200b), joiner = String.fromCharCode(0x2060), shy = String.fromCharCode(0xad), bom = String.fromCharCode(0xfeff);
  for (const text of ['Dis' + zw + 'ney', 'Gh' + joiner + 'ibli', 'Pix' + shy + 'ar', bom + 'totoro'])
    for (const scope of ['style', 'material', 'description']) assert.equal(forbiddenStyleMatches(text, [], {scope}).length, 1, `${scope}: ${JSON.stringify(text)}`);
  assert.deepEqual(forbiddenStyleMatches('디' + zw + '즈니 공주', [], {scope: 'material'}), ['디즈니']);
  assert.deepEqual(forbiddenStyleMatches('Fro' + zw + 'zen style'), ['frozen']);
  assert.deepEqual(forbiddenStyleMatches('soft moon' + zw + 'cat', ['moon' + zw + 'cat']), ['mooncat']);
  assert.equal(validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name: 'Dis' + zw + 'ney 수채화'})).valid, false);
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['a Dis' + zw + 'ney princess'], names: []}}), forbidden);
});

// ---- FIX-IMG-3: one policy. Strict = text a parent typed, lenient = model-written story text, scaffolding never. ----
const CAST = ['유하', 'Yuha', '토토', 'Toto'];
const u = code => String.fromCharCode(code);
const POLICY = [
  // [scope, text, refused]
  ...['Frozen 영화처럼', 'Frozen-esque gown', 'FROZEN II 드레스', 'a blue Frozen dress', '겨울 왕국 스타일', '드림 웍스 스타일', 'DisneyPixar', 'Dis' + u(0x200b) + 'ney', 'Dis' + u(0x3164) + 'ney', '토토로 인형']
    .map(text => ['strict', text, true]),
  ...['frozen lake blue scarf', 'cooked from frozen', 'pixart pastel', '유하는 토토에게서 받은 목도리'].map(text => ['strict', text, false]),
  ...['토토로 달려가요', '토토로서', '토토로의', 'Frozen look on his face', 'The frozen princess woke up', 'Frozen film covered the pond', 'frozen princess Mia'].map(text => ['lenient', text, false]),
  ...['디즈니 공주처럼', 'Pixar style'].map(text => ['lenient', text, true]),
];

test('FIX-IMG-3 policy table: strict parent text and lenient story text', async () => {
  for (const [scope, text, refused] of POLICY) {
    const verdict = checkForbiddenWords({[scope]: [text], names: CAST});
    assert.equal(!verdict.ok, refused, `${scope}: ${JSON.stringify(text)} → ${verdict.words}`);
    // The old scope names map onto the same two scopes.
    for (const alias of scope === 'strict' ? ['strict', 'style', 'material'] : ['lenient', 'description'])
      assert.equal(forbiddenStyleMatches(text, [], {scope: alias, names: CAST}).length > 0, refused, `${alias}: ${text}`);
    // The provider reads declared parts with the same check: strict as `text`, lenient as `generated`.
    const request = sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: scope === 'strict' ? {text: [text], generated: [], names: CAST} : {text: [], generated: [text], names: CAST}});
    if (refused) await assert.rejects(request, forbidden, text); else assert.ok((await request).imageUrl, text);
  }
});

test('FIX-IMG-3 strict scope: brand tokens anywhere, the written title anywhere, lowercase only with a style cue, Korean with spaces', () => {
  const strict = text => forbiddenStyleMatches(text, [], {scope: 'strict', names: CAST});
  const refused = {
    disney: ['a disney gown', 'Disneyland castle', 'DisneyPixar'], pixar: ['pixar3d', 'Pixar style', 'Pixartoon', 'pixartist'],
    ghibli: ['studioghibli', 'GHIBLI meadow'], dreamworks: ['dream works', 'Dream-Works', 'DREAMWORKS'], miyazaki: ['MiyazakiForest'],
    totoro: ['a totoroish spirit'], mickey: ['mickey mouse ears', 'Mickey-Mouse', 'Mickey ears', 'MICKEY'],
    frozen: ['Frozen', 'FROZEN', 'a blue Frozen dress', 'Frozen Lake path', 'frozen style', 'frozen-esque', 'frozenish', 'frozen 영화', 'frozen 애니 느낌', 'frozen풍', 'frozen look', 'inspired by frozen', 'inspired by frozen, icy blue gown', 'in the style of frozen, sparkling cape', 'like frozen', 'the movie frozen', 'frozen 2 style'],
    elsa: ['Elsa', 'ELSA braid', 'elsa style hair', 'like elsa', 'elsa처럼'],
    겨울왕국: ['겨울왕국', '겨울 왕국 드레스', '겨울-왕국'], 디즈니: ['디 즈 니 공주'], 픽사: ['픽 사 3D'], 지브리: ['지브리풍'], 미야자키: ['미야 자키 숲'],
    토토로: ['토토로부터 받은 목도리', '토토로 스타일', '토토로의 숲'], 엘사: ['엘 사 머리'], 미키마우스: ['미키마우스 귀'], 드림웍스: ['드림 웍스'],
  };
  for (const [word, texts] of Object.entries(refused))
    for (const text of texts) assert.ok(strict(text).includes(word), `${word}: ${text} → ${strict(text)}`);
  for (const text of ['frozen lake blue scarf', 'cooked from frozen', 'Thaw the fish from frozen.', 'like frozen, he waited', 'like frozen glass', 'inspired by frozen lakes', 'a frozen-looking pond', 'The frozen princess woke up', 'frozen 드레스', 'unfrozen chelsea hotelsand', 'pixart pastel', 'PixArt-α render', 'a dream about works of art', 'go to Toronto', '유하는 토토에게서 받은 목도리', '토토와 함께 받은 목도리', '다니엘 사과를 든 아이', '가브리엘 사자 인형'])
    assert.deepEqual(strict(text), [], text);
});

test('FIX-IMG-3 lenient scope: no title-word checks, joined Korean names, the book\'s cast names exempt particles only', () => {
  const lenient = (text, names = CAST) => forbiddenStyleMatches(text, [], {scope: 'lenient', names});
  for (const text of ['Frozen look on his face', 'Frozen film covered the pond.', 'frozen princess Mia', 'The frozen princess woke up', 'Elsa waved.', 'Mickey laughed.', 'LIKE FROZEN SNOW', 'Her dream works!', '겨울 왕국의 성에 눈이 와요', '토토로 달려가요', '토토로서', '토토로의', '토토로부터 온 편지', '토토로 인해 웃어요'])
    assert.deepEqual(lenient(text), [], text);
  for (const [text, words] of [['디즈니 공주처럼', ['디즈니']], ['Pixar style', ['pixar']], ['Dream Works', ['dreamworks']], ['Mickey Mouse ears', ['mickey']], ['겨울왕국', ['겨울왕국']], ['엘사처럼', ['엘사']], ['토토로봇', ['토토로']], ['꼬마토토로', ['토토로']]])
    assert.deepEqual(lenient(text), words, text);
  // A bare 로 followed by a noun or style word is the film again, even after a cast name.
  for (const text of ['토토로 인형을 안았어요', '토토로 같은 숲', '토토로 스타일 옷']) assert.deepEqual(lenient(text), ['토토로'], text);
  // Without 토토 in the names, 토토로 is the film.
  assert.deepEqual(lenient('토토로 달려가요', ['유하', 'Yuha']), ['토토로']);
});

test('FIX-IMG-3 normalisation: NFKC, \\p{Cf}, the grapheme joiner, Hangul fillers and variation selectors are removed first', () => {
  const hidden = [0x200b, 0x200d, 0x2060, 0xad, 0xfeff, 0x034f, 0x115f, 0x1160, 0x3164, 0xffa0, 0xfe00, 0xfe0f];
  for (const code of hidden) {
    assert.equal(normalizeForbiddenText('Dis' + u(code) + 'ney'), 'Disney', code.toString(16));
    for (const scope of ['strict', 'lenient']) {
      assert.deepEqual(forbiddenStyleMatches('Dis' + u(code) + 'ney', [], {scope}), ['disney'], `${scope} ${code.toString(16)}`);
      assert.deepEqual(forbiddenStyleMatches('디' + u(code) + '즈니', [], {scope}), ['디즈니'], `${scope} ${code.toString(16)}`);
    }
  }
  // Fullwidth letters are folded by NFKC.
  assert.deepEqual(forbiddenStyleMatches('Ｄｉｓｎｅｙ 공주'), ['disney']);
});

test('FIX-IMG-3 refusals tell the parent what to change, and a cast name plus 로 suggests 토토에게서', async () => {
  const {state} = setup(), yuha = state.characters.find(c => c.id === 'yuha');
  yuha.description = '강아지 토토로부터 받은 빨간 목도리를 한 아이';
  const request = createCharacterSheetRequest(state, 'yuha');
  assert.ok(request.forbiddenWordCheck.names.includes('토토'), 'drawer names shape the advice');
  await assert.rejects(generateImage(request, {engine: 'sample'}), error => error.code === 'forbidden_style_name' && /‘토토로부터’/.test(error.message) && /‘토토에게서’/.test(error.message) && /‘토토와 함께’/.test(error.message));
  yuha.description = '유하는 토토에게서 받은 목도리를 해요';
  assert.ok((await generateImage(createCharacterSheetRequest(state, 'yuha'), {engine: 'sample'})).imageUrl);
  yuha.description = 'a girl in a blue Frozen dress';
  await assert.rejects(generateImage(createCharacterSheetRequest(state, 'yuha'), {engine: 'sample'}), error => /‘Frozen’/.test(error.message) && /소문자 ‘frozen’/.test(error.message));
  yuha.description = '겨울 왕국 스타일 드레스';
  await assert.rejects(generateImage(createCharacterSheetRequest(state, 'yuha'), {engine: 'sample'}), error => /‘겨울 왕국’/.test(error.message) && /띄어 쓰거나 붙여 써도/.test(error.message));
  // The same advice in the style editor and the wardrobe pre-check.
  const styleResult = validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name: 'frozen 스타일 수채화'}));
  assert.equal(styleResult.valid, false); assert.ok(styleResult.errors.some(e => e.includes('금칙어') && e.includes('‘frozen’')));
  const consonant = checkForbiddenWords({strict: ['별님으로부터 받은 목도리'], names: ['별님']});
  assert.equal(consonant.ok, true, 'no forbidden word, no advice');
  const advice = forbiddenWordAdvice(forbiddenWordFindings('토토로까지 같이 가요', {names: ['토토']}));
  assert.match(advice, /토토와 함께/);
});

// The same strings through every path that checks parent text: what one accepts, all accept; what one refuses, all refuse.
test('FIX-IMG-3 consistency: sheet, wardrobe pre-check, wardrobe drawing and the scene that draws the text agree', async () => {
  paidFetches = 0;
  const {state, book} = await demoBook(['yuha']);
  assert.deepEqual(book.characterIds, ['yuha']);
  assert.deepEqual(bookCastNames(state, book), ['유하', 'Yuha'], 'the book\'s own cast, not the drawer');
  const yuha = state.characters.find(c => c.id === 'yuha'), sheet = book.generationSnapshot.characterSheets.find(s => s.characterId === 'yuha');
  const baseDescription = yuha.description, baseSnapshot = sheet.characterSnapshot.description;
  const variant = {id: 'variant-probe', characterId: 'yuha', name: '목도리', type: 'outfit', description: 'a red scarf', refImageIds: []};
  const outcome = async promise => {try {await promise; return 'drawn';} catch (error) {assert.equal(error.code, 'forbidden_style_name', error.message); return 'refused';}};
  const strings = ['강아지 토토로부터 받은 빨간 목도리', '토토로 인형을 안은 아이', '유하는 토토에게서 받은 목도리', 'Frozen 영화처럼 파란 드레스', 'a blue Frozen dress', 'frozen-lake blue scarf', 'cooked from frozen', '겨울 왕국 스타일 드레스', '드림 웍스 스타일 얼굴', 'Dis' + u(0x3164) + 'ney 공주 드레스', 'pixart pastel scarf', 'like frozen, he waited'];
  const accepted = new Set(['유하는 토토에게서 받은 목도리', 'frozen-lake blue scarf', 'cooked from frozen', 'pixart pastel scarf', 'like frozen, he waited']);
  for (const text of strings) {
    yuha.description = text;
    const sheetResult = await outcome(generateImage(createCharacterSheetRequest(state, 'yuha'), {engine: 'sample'}));
    yuha.description = baseDescription;
    let precheck = 'drawn', wardrobeDraw = 'refused';
    try {
      const request = createVariantGenerationRequest(state, 'yuha', {...variant, description: text}, 'front', 7);
      wardrobeDraw = await outcome(generateImage(request, {engine: 'sample'}));
    } catch (error) {
      assert.match(error.message, /옷장 설명/); precheck = 'refused';
    }
    // The book draws the same text as the character's frozen description, and as the outfit a page wears.
    sheet.characterSnapshot.description = text;
    const sceneCharacter = await outcome(draw(state, book, 1));
    sheet.characterSnapshot.description = baseSnapshot;
    Object.assign(book.generationSnapshot, {variants: [{...variant, description: text}], characterVariants: {yuha: variant.id}});
    const sceneOutfit = await outcome(draw(state, book, 1));
    Object.assign(book.generationSnapshot, {variants: [], characterVariants: {yuha: null}});
    const all = {sheetResult, precheck, wardrobeDraw: precheck === 'refused' ? 'refused' : wardrobeDraw, sceneCharacter, sceneOutfit};
    assert.equal(new Set(Object.values(all)).size, 1, `${text}: ${JSON.stringify(all)}`);
    assert.equal(sheetResult, accepted.has(text) ? 'drawn' : 'refused', text);
  }
  assert.equal(paidFetches, 0);
});

test('FIX-IMG-3 the book\'s own cast exempts "토토로" in story text, the same for pages and the cover', async () => {
  const solo = await demoBook(['yuha']);
  // 토토 is in the drawer but not in this book: page text and cover action name the film.
  solo.book.pages[2].ko = '토토로 달려가요.';
  await assert.rejects(draw(solo.state, solo.book, 2), forbidden);
  solo.book.pagination.cover = {...solo.book.pagination.cover, sceneAction: 'Yuha runs, 토토로 달려가요'};
  await assert.rejects(draw(solo.state, solo.book, 0, {cover: true}), forbidden);
  const duo = await demoBook();
  duo.book.pages[2].ko = '토토로 달려가요.';
  assert.ok((await draw(duo.state, duo.book, 2)).imageUrl);
  duo.book.pagination.cover = {...duo.book.pagination.cover, sceneAction: 'Yuha runs, 토토로 달려가요'};
  const cover = sceneGenerationRequest(duo.state, duo.book, 0, {cover: true});
  assert.deepEqual(cover.forbiddenWordCheck.names, sceneGenerationRequest(duo.state, duo.book, 2).forbiddenWordCheck.names);
  assert.ok((await generateImage(cover, {engine: 'sample'})).imageUrl);
  // Story text never checks title words.
  duo.book.pages[2].en = 'Frozen look on his face, Toto stopped.';
  assert.ok((await draw(duo.state, duo.book, 2)).imageUrl);
});

test('FIX-IMG-3 a cover action the parent edited is strict; a planned one is lenient', async () => {
  const {state, book} = await demoBook();
  const planned = book.pagination.cover.sceneAction;
  for (const text of ['A girl in a blue gown like Frozen, in front of an ice palace', 'Yuha wears a dress from Frozen', 'Yuha in an ice palace as seen in Frozen']) {
    // Without a record of the planned action it counts as generated: no title-word check.
    book.pagination.cover = {...book.pagination.cover, sceneAction: text}; delete book.pagination.coverSceneActionGenerated;
    assert.equal(coverActionEditedByParent(book), false);
    assert.ok((await draw(state, book, 0, {cover: true})).imageUrl, text);
    // Recorded at the parent's first edit: the edited action is parent text.
    book.pagination.coverSceneActionGenerated = planned;
    assert.equal(coverActionEditedByParent(book), true);
    const request = sceneGenerationRequest(state, book, 0, {cover: true});
    assert.ok(request.forbiddenWordCheck.text.includes(text)); assert.ok(!request.forbiddenWordCheck.generated.includes(text));
    await assert.rejects(generateImage(request, {engine: 'sample'}), forbidden, text);
  }
  book.pagination.cover.sceneAction = 'Yuha slid across the frozen lake like a penguin';
  assert.ok((await draw(state, book, 0, {cover: true})).imageUrl);
  // Edited back to the planned action (spacing aside): generated again.
  book.pagination.cover.sceneAction = ` ${planned} `;
  assert.equal(coverActionEditedByParent(book), false);
  assert.ok(sceneGenerationRequest(state, book, 0, {cover: true}).forbiddenWordCheck.generated.includes(book.pagination.cover.sceneAction));
});

test('FIX-IMG-3 scene briefs are lenient story text; app scaffolding is never checked', async () => {
  const {state, book} = await demoBook();
  const page = book.pages[1], brief = book.sceneBriefs.find(b => Number(b.beatIndex) === Number(page.beatIndex));
  assert.ok(brief, 'the demo plans a brief for this page');
  const request = sceneGenerationRequest(state, book, 1);
  for (const part of sceneBriefText(book, page)) assert.ok(request.forbiddenWordCheck.generated.includes(part), part);
  assert.ok(!request.forbiddenWordCheck.generated.some(part => /approved preset palette/.test(part)), 'the app\'s light-mood line is scaffolding');
  brief.pose = {ko: '포즈', en: 'a Pixar style pose'};
  await assert.rejects(draw(state, book, 1), forbidden);
  brief.pose = {ko: '포즈', en: 'a Frozen look on her face'};
  assert.ok((await draw(state, book, 1)).imageUrl);
  // The plot ledger and fixed instructions stay outside the check.
  assert.match(sceneGenerationRequest(state, book, 1).prompt, /LOCKED EVENT AND STATE LEDGER/);
});

test('a friend or place FULL AUTO wrote is story text until a parent edits it', async () => {
  const {updateBackground, updateCharacter} = await import('../dist/management.js');
  const {backgroundSheetRequest} = await import('../dist/background-sheets.js');
  // Scene: the planned place "Frozen Lake" (model text) is drawn; strict again once a parent edited it.
  const {state, book} = await demoBook();
  const place = book.generationSnapshot.backgrounds[0], kept = place.description;
  const placed = book.pages.findIndex((p, i) => sceneGenerationRequest(state, book, i).forbiddenWordCheck.text.includes(kept));
  assert.ok(placed >= 0);
  Object.assign(place, {source: 'full-auto', nameEn: 'Frozen Lake'});
  const request = sceneGenerationRequest(state, book, placed);
  assert.ok(request.forbiddenWordCheck.generated.includes('Frozen Lake') && !request.forbiddenWordCheck.text.includes('Frozen Lake'));
  assert.ok((await draw(state, book, placed)).imageUrl);
  place.description = 'a castle in the Pixar style';
  await assert.rejects(draw(state, book, placed), forbidden, 'brand names stay refused in story text');
  place.description = kept; place.parentEditedAt = '2026-10-18T00:00:00.000Z';
  await assert.rejects(draw(state, book, placed), forbidden);
  // Place sheet and character sheet read the same marker; management stamps it on a parent's edit.
  const {state: own} = setup();
  const background = own.backgrounds[0];
  Object.assign(background, {source: 'full-auto', name: 'Frozen Lake', description: 'a quiet lake under snow'});
  assert.ok((await sample(backgroundSheetRequest(own, background, {quality: 'draft'}))).imageUrl);
  const edited = updateBackground(own, background.id, {description: 'a quiet lake under deep snow'});
  const editedPlace = edited.backgrounds.find(b => b.id === background.id);
  assert.ok(editedPlace.parentEditedAt);
  await assert.rejects(sample(backgroundSheetRequest(edited, editedPlace, {quality: 'draft'})), forbidden);
  const toto = own.characters.find(c => c.id === 'toto');
  Object.assign(toto, {source: 'full-auto', description: '파란 망토, a cape like Frozen'});
  assert.ok((await generateImage(createCharacterSheetRequest(own, 'toto'), {engine: 'sample'})).imageUrl);
  const parentToto = updateCharacter(own, 'toto', {description: '파란 망토, a cape like Frozen!'});
  assert.ok(parentToto.characters.find(c => c.id === 'toto').parentEditedAt);
  await assert.rejects(generateImage(createCharacterSheetRequest(parentToto, 'toto'), {engine: 'sample'}), forbidden);
  // A parent's own material never gets the marker.
  const plain = updateBackground(own, own.backgrounds[1]?.id || background.id, {description: 'a sunny park'});
  if (own.backgrounds[1]) assert.equal(plain.backgrounds.find(b => b.id === own.backgrounds[1].id).parentEditedAt, undefined);
});

test('earlier pages that ride along in a later prompt are checked as story text', async () => {
  const {state, book} = await demoBook();
  book.pages[0].ko = '유하는 디즈니 공주처럼 웃었어요.';
  const later = sceneGenerationRequest(state, book, 1);
  assert.ok(later.forbiddenWordCheck.generated.includes('유하는 디즈니 공주처럼 웃었어요.'));
  await assert.rejects(draw(state, book, 1), forbidden);
  // Story text stays lenient there: the cast name plus a particle and a frozen lake are drawn.
  book.pages[0].ko = '유하는 토토로부터 얼음 조각을 받았어요.'; book.pages[0].en = 'The frozen lake shines.';
  assert.ok((await draw(state, book, 1)).imageUrl);
});
