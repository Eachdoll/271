import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {seedState, generateBook} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, captureBookGenerationSnapshot, sceneGenerationRequest, createCharacterSheetRequest} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, runFullAuto, fullAutoProgress} from '../dist/full-auto.js';
import {toLegacyPages} from '../dist/story-generation/pipeline.js';
import {bindSeriesBackgrounds} from '../dist/story-generation/continuity.js';
import {generateImage} from '../dist/image-generation/providers.js';
import {STYLE_PRESETS, LEGACY_STYLE_PRESETS, forbiddenStyleMatches, validateStylePreset, DEFAULT_FORBIDDEN_STYLE_WORDS} from '../dist/image-generation/styles.js';
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

test('material and story text: "frozen" counts only as a style reference, and a cast name plus particle is not 토토로', () => {
  const description = (text, names) => forbiddenStyleMatches(text, [], {scope: 'description', names});
  assert.deepEqual(description('The pond was frozen. FROZEN EVENT AND STATE LEDGER'), []);
  assert.deepEqual(description('Toto stood frozen like a statue, with a frozen look.'), []);
  assert.deepEqual(description('a frozen-style ice palace'), ['frozen']);
  assert.deepEqual(description('a Frozen-like gown'), ['frozen']);
  assert.deepEqual(description('Frozen movie princess dress'), ['frozen']);
  assert.deepEqual(description('겨울왕국 같은 성'), ['겨울왕국']);
  assert.deepEqual(description('Elsa waves'), ['elsa']);
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
async function demoBook() {
  const {state, wizard} = setup();
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
  for (const text of ['a frozen lake', 'the pond looked like frozen glass', 'icicles hang from frozen branches', 'Toto stood frozen like a statue, with a frozen look.']) {
    assert.deepEqual(material(text), [], text); assert.deepEqual(story(text), [], text);
  }
  // Model-written story text counts only a cue after the word.
  assert.deepEqual(story('a Frozen-style gown'), ['frozen']); assert.deepEqual(story('a frozen lake like glass'), []);
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
    assert.deepEqual(forbiddenStyleMatches('미키 마우스 귀 머리띠', [], {scope}), ['미키 마우스'], scope);
  }
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

test('a cast name may carry a chain of particles (토토로서, 토토로써는, 토토로의, 토토로는요), never another word', async () => {
  const check = (text, names, scope = 'description') => forbiddenStyleMatches(text, [], {scope, names});
  for (const scope of ['description', 'material']) {
    for (const text of ['토토로서 할 일', '토토로서는 처음 보는 바다였어요', '토토로써는 처음이에요', '토토로써 충분해요', '토토로의 모자', '토토로는요 몰라요', '토토로부터는 편지가 없어요', '토토로까지요', '토토로서의 하루'])
      assert.deepEqual(check(text, ['토토'], scope), [], `${scope}: ${text}`);
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

test('"frozen" counts as the film only when written as the title or with a cue; ordinary ice stays free', async () => {
  const material = text => forbiddenStyleMatches(text, [], {scope: 'material'}), story = text => forbiddenStyleMatches(text, [], {scope: 'description'});
  // All caps or lowercase after a cue, followed by another word, is ice.
  for (const text of ['LIKE FROZEN SNOW', 'like frozen, he waited', 'like frozen; then she ran', 'a thin frozen film on the window', 'The frozen princess woke up', 'frozen-lake blue scarf', 'a frozen look', 'melted from frozen solid'])
    assert.deepEqual(material(text), [], text);
  for (const text of ['a thin frozen film on the window', 'The frozen princess woke up', 'LIKE FROZEN SNOW'])
    assert.deepEqual(story(text), [], text);
  // The title: all caps after a cue, sequels, more cues before and after.
  for (const text of ['like FROZEN', 'Frozen 2 style', 'frozen 2 style', 'a Frozen2 cape', 'Frozen II', 'Frozen II-inspired gown', 'an ice dress like in Frozen', 'a dress from Frozen', 'similar to Frozen', 'as seen in Frozen', 'Frozen look', 'Frozen theme party', 'a Frozen vibe', 'Frozen 느낌', 'Frozen풍 드레스', 'Frozen princess dress', 'FROZEN PRINCESS DRESS', 'Frozen film poster'])
    assert.deepEqual(material(text), ['frozen'], text);
  // Model-written text counts only a cue after the word; the title spelling decides the weak ones.
  for (const text of ['a Frozen 2 style gown', 'Frozen2', 'Frozen 느낌의 성', 'Frozen princess dress']) assert.deepEqual(story(text), ['frozen'], text);
  assert.deepEqual(story('an ice dress like in Frozen'), [], 'a cue before counts only in parent-entered text');
  // The strict style editor refuses "Frozen2" too.
  assert.equal(validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name: 'Frozen2 shimmer'})).valid, false);
  // Provider: the same rules for declared parent text.
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['a cape like in Frozen'], names: []}}), forbidden);
  assert.ok((await sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['LIKE FROZEN SNOW', 'a thin frozen film on the window'], generated: ['The frozen princess woke up.'], names: []}})).imageUrl);
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

test('a character sheet exempts the whole cast\'s names, not only its own character', async () => {
  const {state} = setup(), yuha = state.characters.find(c => c.id === 'yuha');
  yuha.description = '강아지 토토로부터 받은 빨간 목도리를 한 아이';
  const request = createCharacterSheetRequest(state, 'yuha');
  assert.ok(request.forbiddenWordCheck.names.includes('토토'), 'another character in the drawer');
  assert.ok(request.forbiddenWordCheck.names.includes('유하'));
  assert.ok((await generateImage(request, {engine: 'sample'})).imageUrl);
  // Only a particle chain is exempt: the film and a longer word are still refused.
  yuha.description = '토토로봇 장난감을 든 아이';
  await assert.rejects(generateImage(createCharacterSheetRequest(state, 'yuha'), {engine: 'sample'}), forbidden);
  yuha.description = 'a girl hugging a Totoro plush';
  await assert.rejects(generateImage(createCharacterSheetRequest(state, 'yuha'), {engine: 'sample'}), forbidden);
  // Without 토토 in the drawer, "토토로부터" is the film again.
  yuha.description = '강아지 토토로부터 받은 빨간 목도리를 한 아이';
  state.characters = state.characters.filter(c => c.id !== 'toto');
  await assert.rejects(generateImage(createCharacterSheetRequest(state, 'yuha'), {engine: 'sample'}), forbidden);
});
