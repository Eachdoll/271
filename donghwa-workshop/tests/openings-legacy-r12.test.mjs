import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

/**
 * R12-P0 legacy pins (tests only). R12 adds the "openings" picture book for NEW
 * K2-K4 drafts with Korean text. K1, English-only books and every existing
 * draft, job and book must stay byte for byte as they were at 5f8d2f7, the last
 * pre-R12 commit. Each group below is computed from the real app modules with a
 * frozen clock, a seeded Math.random/crypto and a mock text engine (no network,
 * no paid call) and pinned by its sha256:
 *
 * - levels: LEVEL_SEED/LEVEL_SPECS, freezeReadingLevels (two arguments), beat counts and page plans.
 * - inputs: inputFromWizard (two arguments) and normalizeStoryInput for K1, K2-K4,
 *   English-only and a pre-R8 draft, with the page-count error texts.
 * - validation: validatePagination / inspectStory for 8/12/16/24 entries and count mismatches.
 * - requests: every text request (system, user, schema, maxTokens, temperature and
 *   the request keys, so a new timeoutMs shows) and every stage's output data of
 *   K1/E0 12p quality, K2/E2 16p quality and plain, K3/E3 24p plain, K4/E4 16p
 *   Korean-only plain and English-only K2/E2 drafts through
 *   outline, quality rich/simplify/fix/condense, prose, enrichment, coherence and
 *   its repairs, pagination, repagination, page and richness rewrites,
 *   rewriteStoryPage, the child gate and its repairs, beat/brief/paragraph edits,
 *   the material plan and the simple-mode page rewrite, plus the quality ledger
 *   fingerprints and cache keys.
 * - demo: the free demo text engine for page inputs.
 * - fullAutoResume: a pre-R12 FULL AUTO job (v3 readingLevels, plan and sheets
 *   done) resumed at the input step: job.input afterwards, 0 engine calls.
 * - fullAutoDemo: free demo FULL AUTO runs (K1, English-only and the pre-R12 job).
 * - scene: sceneGenerationRequest prompt, size and forbiddenWordCheck with and
 *   without staging and briefs, the cover, and the sample engine's pictures.
 * - print: getPrintHTML for layout × language × text position × range.
 * - review: simple ④/⑤ markup of the legacy book (and ③ for K1/English-only wizards).
 * - checks: checkStory/inspectStory, analyzeBook, checkRichness, toLegacyPages.
 * - estimates: estimateStoryTextCost, estimateFullAutoCost and estimateSimpleCosts.
 *
 * New K2-K4 Korean wizards are left out on purpose: they become openings books in
 * R12. The reader DOM of the seed book and of the generated legacy page book
 * (tests/fixtures/legacy-page-book-r12.json) is pinned in the browser by
 * scripts/r12-legacy-dom.mjs (QA/r12-legacy-dom.json, run it with --check).
 *
 * To compare directly with a checkout of the pre-R12 commit:
 * PRE_R12_APP_ROOT=/abs/path/to/5f8d2f7/donghwa-workshop node --test tests/openings-legacy-r12.test.mjs
 * (add R12_PIN_DUMP=/abs/file.json to write HEAD's groups for a diff).
 * A pin changes only when legacy behaviour is changed on purpose; R12 never does.
 * Since the merge with the main line (outline hotfixes, R13 model picker) the
 * pre-R12 reference is 6497efe: R13 (6ccc895) changed fullAutoDemo and review on
 * purpose, every other group is still identical to 5f8d2f7.
 */
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const FIXED_NOW = Date.parse('2026-10-19T09:00:00.000Z');

/**
 * R12's test hook turns the openings layout on before P8 makes it the default. Every
 * pin (and the module loading) runs with the hook ON, for HEAD and PRE_R12_APP_ROOT
 * alike, so from P1 on a flag-gated leak into page books, K1, English-only books or
 * pre-R12 jobs fails here at once instead of first at P8. 5f8d2f7 never reads it.
 */
const OPENINGS_HOOK = '__DONGHWA_R12_OPENINGS__';
const hookLog = [];
async function withOpeningsHook(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, OPENINGS_HOOK), previous = globalThis[OPENINGS_HOOK];
  globalThis[OPENINGS_HOOK] = true;
  try { return await fn(); }
  finally { if (had) globalThis[OPENINGS_HOOK] = previous; else delete globalThis[OPENINGS_HOOK]; }
}

async function deterministic(fn) {
  return withOpeningsHook(() => frozen(fn));
}
async function frozen(fn) {
  const RealDate = Date, realRandom = Math.random, realFetch = globalThis.fetch, cryptoObject = globalThis.crypto;
  class FrozenDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
    static now() { return FIXED_NOW; }
  }
  let state = 0x2f6b1d3c, uuid = 0;
  globalThis.Date = FrozenDate;
  Math.random = () => { state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  Object.defineProperty(cryptoObject, 'randomUUID', {configurable: true, writable: true, value: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`});
  Object.defineProperty(cryptoObject, 'getRandomValues', {configurable: true, writable: true, value: array => { const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength); for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); return array; }});
  globalThis.fetch = async url => {
    const href = String(url?.url || url);
    if (!href.startsWith('file:')) throw Error(`network is not allowed in the legacy pins: ${href.slice(0, 80)}`);
    return new Response(readFileSync(new URL(href), 'utf8'), {headers: {'Content-Type': 'application/json'}});
  };
  try { return await fn(); }
  finally { globalThis.Date = RealDate; Math.random = realRandom; globalThis.fetch = realFetch; delete cryptoObject.randomUUID; delete cryptoObject.getRandomValues; }
}

// ---------- the mock text engine ----------
// It answers every request shape of the app with deterministic, schema-valid JSON or
// labelled prose, built from the request itself (and the app's own demo helpers), so
// each stage runs for real. Scenario flags steer it into the repair paths:
// prose.{ko,en}.{rich,simplify,fix,condense,plain} sentences per beat (tell adds an
// emotion word, so the Korean fix pass runs), coherenceFail.{prose,pages} fails the
// first review, shortFirstPagination drops a page (repagination), childRepair scores
// page 3 zero and leaves the turn out of the retell, briefRepair omits beat 3's brief.
const KO_WHERE = ['집에서', '숲에서', '정원에서', '돌 옆에서', '길에서', '다리 위에서', '집 앞에서', '방에서'];
function koSentences(names, beat, count, {tell = false} = {}) {
  const [a, b] = [names[0], names[1] || names[0]];
  const pool = j => [
    `${a}가 ${beat}번째 길에서 ${j}번째 작은 잎을 살짝 만져요.`,
    `${b}가 “나는 ${j}번째 바람 소리를 들어요.”라고 말해요.`,
    `차가운 바람이 ${beat}번째 나무의 잎을 사각사각 흔들어요.`,
    `${a}가 ${j}번째 매끈한 돌을 두 손으로 들어 봐요.`,
    `${b}가 고개를 갸웃하며 ${j}번째 소리를 다시 들어요.`,
  ][j % 5];
  const rows = Array.from({length: count}, (_, j) => pool(j + 1));
  if (tell) rows[rows.length - 1] = `${a}는 작은 잎을 찾아서 정말 기뻐요.`;
  return rows;
}
function enSentences(names, beat, count) {
  const [a, b] = [names[0], names[1] || names[0]];
  const pool = j => [
    `${a} sees leaf ${j} near tree ${beat}.`,
    `${b} says, “I hear wind ${j}.”`,
    `The cold wind shakes tree ${beat} and leaf ${j}.`,
    `${a} picks up smooth stone ${j}.`,
    `${b} listens to sound ${j} again.`,
  ][j % 5];
  return Array.from({length: count}, (_, j) => pool(j + 1));
}
const label = (lang, beat) => `${lang === 'ko' ? '[비트' : '[Beat'} ${beat.index} · ${beat.type}] `;

function mockOutline(M, input, request, {plan, data}) {
  const count = M.schemas.frozenBeatCount(input),
    names = input.characters.map(c => c.name),
    types = ['setup', 'want', ...Array.from({length: count - 5}, () => 'attempt'), 'turn', 'resolution', 'close'],
    home = data?.homeBackgroundIds?.[0] || 'home',
    places = data?.locationBackgroundIds?.slice(0, 2) || ['forest', 'garden'],
    setting = index => (index === 0 || index === count - 1 ? home : places[index % 2]);
  const planted = plan ? request.user.match(/- 심을 물건: (.*?) —/u)?.[1] : '작은 잎',
    creature = plan ? request.user.match(/- 배경 생물: (.*?) \(/u)?.[1] : '바람',
    reasons = plan ? [...request.user.matchAll(/\d차 (잘못된 장소|잘못된 방법|거의 됐는데 방해)/gu)].map(match => ({'잘못된 장소': 'wrong_place', '잘못된 방법': 'wrong_method', '거의 됐는데 방해': 'interrupted'})[match[1]]) : [];
  let attempt = 0;
  const json = {
    ...(plan ? {plan: {pattern: request.jsonSchema.properties.plan.properties.pattern.enum[0], planted, twistReveal: '앞에서 살펴본 물건을 다시 이용해요.', funnyMoment: '바람에 잎이 코에 앉아요.', failureReasons: reasons}} : {}),
    titleCandidates: ['빗방울의 흔적', '바람을 듣는 날', '작은 잎의 소리'],
    logline: `${names[0]}와 친구가 ${input.topic}에서 빗방울의 흔적을 찾아요.`,
    want: '빗방울의 소리를 찾고 싶어요.',
    problem: '바람 때문에 소리의 위치가 달라져요.',
    twist: '앞에서 살펴본 물건이 바람을 받아 소리를 냈어요.',
    beats: types.map((type, index) => ({
      index: index + 1, type,
      summary: `${names[0]}와 ${names[1] || names[0]}가 ${KO_WHERE[index]} ${input.topic}의 흔적을 살펴요. ${names[index % names.length]}가 ${type === 'setup' || type === 'turn' ? planted : '작은 잎'}을 보며 ${type === 'turn' ? creature : '바람'}의 소리를 들어요.`,
      characters: input.characters.map(c => c.id),
      settingKey: setting(index),
      ...(plan ? {newElement: index === 2 ? '' : `${index + 1}번째 젖은 잎`, failureReason: type === 'attempt' ? reasons[attempt++] ?? null : null} : {}),
    })),
    settings: types.map((_, index) => ({beatIndex: index + 1, backgroundId: setting(index)})),
    emotionArc: types.map(() => '궁금'),
    newWordsKo: ['빗방울', '흔적', '바람'],
    newWordsEn: ['rain', 'leaf', 'wind'],
    endingType: input.endingType,
  };
  json.plotContract = M.plot.demoPlotContract(json, input);
  return json;
}

const jsonTail = (text, marker) => {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const rest = text.slice(at + marker.length).trimStart(), line = rest.split('\n')[0];
  return JSON.parse(line);
};
const paragraphsOf = text => String(text || '').split(/\n\s*\n/u).map(s => s.trim()).filter(Boolean);

/** The request's stage, from its shape (the same rule at every root); recorded with the request. */
function requestKind(request) {
  const schema = request.jsonSchema, p = schema?.properties || {};
  if (!schema) {
    if (request.user.startsWith('아래 줄거리 JSON에서')) return 'quality-fix-outline';
    const lang = /return English plain/u.test(request.system) ? 'en' : 'ko';
    if (/정해진 분량보다 길다/u.test(request.system)) return `quality-condense-${lang}`;
    if (request.temperature === 0.8) return `quality-rich-${lang}`;
    if (request.temperature === 0.4) return `quality-simplify-${lang}`;
    return `quality-fix-${lang}`;
  }
  if (request.user.startsWith('아래 줄거리 JSON에서')) return 'quality-fix-outline';
  if (p.beats && !request.user.startsWith('{')) return 'quality-outline';
  if (p.protagonistId && p.resolutionCriterion) return 'plot-contract';
  if (p.reuseCharacterIds) return 'materials';
  if (p.index && p.summary && !p.beats) return 'rewrite-beat';
  if (p.overall) return 'child-curiosity';
  if (p.retell) return 'child-retell';
  if (p.briefs) return 'scene-briefs';
  if (p.dialogueLine) return 'scene-brief';
  if (p.beats) return 'outline';
  if (p.passed && p.issues) return /"pagination":\{/u.test(request.user) ? 'coherence-pages' : 'coherence-prose';
  if (p.paragraphs) return 'coherence-repair-prose';
  if (p.cover) return 'pagination';
  if (p.pages) return 'coherence-repair-pages';
  if (p.paragraph) return /"fullProse":/u.test(request.user) ? 'rewrite-paragraph' : 'enrichment';
  if (p.pageNo && p.textKo) {
    if (/Preserve all earlier sentences byte-for-byte/u.test(request.system)) return 'rewrite-page-ending';
    const types = (JSON.parse(request.user).violations || []).map(v => v.type).filter(Boolean);
    return !types.length ? 'rewrite-page' : types.every(type => type === 'richness') ? 'rewrite-page-richness' : 'rewrite-page-repair';
  }
  if (p.action) return 'rewrite-scene';
  if (p.ko && p.en) return 'prose';
  return 'unknown';
}

function mockEngine(M, scenario, log) {
  const input = scenario.normalized, names = input.characters.map(c => c.name), namesEn = input.characters.map(c => c.nameEn || c.name);
  const seen = {};
  const counts = scenario.counts;
  return {id: 'openai', async complete(request) {
    const kind = requestKind(request), nth = (seen[kind] = (seen[kind] || 0) + 1);
    log.push({kind, system: request.system, user: request.user, jsonSchema: request.jsonSchema ?? null, temperature: request.temperature ?? null, maxTokens: request.maxTokens ?? null, keys: Object.keys(request).sort()});
    const reply = json => ({json, text: JSON.stringify(json), usage: {input: 100, output: 50}, costUsdEstimated: 0.001, meta: {requests: 1, modelId: 'legacy-pin-mock'}});
    const text = value => ({text: value, usage: {input: 100, output: 50}, costUsdEstimated: 0.001, meta: {requests: 1, modelId: 'legacy-pin-mock'}});
    let data = null;
    try { data = JSON.parse(request.user); } catch {}
    switch (true) {
      case kind === 'quality-outline': return reply(mockOutline(M, input, request, {plan: true}));
      case kind === 'quality-fix-outline': { const json = JSON.parse(request.user.split('\n\n').at(-1)); json.beats[2].newElement = '고친 젖은 잎'; return reply(json); }
      case kind === 'outline': return reply(mockOutline(M, input, request, {plan: false, data}));
      case kind === 'scene-briefs': { const briefs = M.briefs.demoSceneBriefs(data.approvedOutline, input); return reply({briefs: scenario.briefRepair && nth === 1 ? briefs.filter(b => b.beatIndex !== 3) : briefs}); }
      case kind === 'plot-contract': return reply(M.plot.demoPlotContract(data.approvedOutline, input));
      case kind === 'materials': return reply({reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['home', 'forest', 'garden'], newBackgrounds: [], reason: '고른 친구와 장소로 충분해요.'});
      case kind === 'rewrite-beat': return reply({...data.targetBeat, summary: `${data.targetBeat.summary} 바람이 한 번 더 불어요.`});
      case kind === 'scene-brief': return reply(M.briefs.demoSceneBriefs(data.approvedOutline, input).find(b => b.beatIndex === data.targetBeatIndex));
      case kind.startsWith('quality-'): {
        const lang = kind.endsWith('-en') ? 'en' : 'ko', role = kind.split('-')[1];
        const outline = jsonTail(request.user, 'FROZEN_APPROVED_OUTLINE_JSON:');
        const per = scenario.prose[lang][role] ?? scenario.prose[lang].simplify;
        const tell = lang === 'ko' && role === 'simplify' && scenario.prose.tell;
        return text(outline.beats.map(beat => label(lang, beat) + (lang === 'ko' ? koSentences(names, beat.index, per, {tell}) : enSentences(namesEn, beat.index, per)).join(' ')).join('\n\n'));
      }
      case kind === 'prose': {
        const outline = data.approvedOutline;
        return reply({ko: outline.beats.map(beat => koSentences(names, beat.index, scenario.prose.ko.plain).join(' ')).join('\n\n'), en: outline.beats.map(beat => enSentences(namesEn, beat.index, scenario.prose.en.plain).join(' ')).join('\n\n'), usedRefrainAt: [], paragraphBeats: {ko: outline.beats.map(b => b.index), en: outline.beats.map(b => b.index)}});
      }
      case kind === 'enrichment': return reply({paragraph: `${data.targetParagraph} ${data.language === 'ko' ? `${names[0]}가 보들보들한 잎을 만지며 휘잉 소리를 들어요.` : `${namesEn[0]} hears the wind go whoosh.`}`});
      case kind === 'rewrite-paragraph': return reply({paragraph: `${data.targetParagraph} ${data.language === 'ko' ? `${names[0]}가 앞에서 본 잎을 떠올리고 다시 달려가요.` : `${namesEn[0]} remembers the leaf and runs back.`}`});
      case kind === 'coherence-prose' || kind === 'coherence-pages': {
        const stage = kind === 'coherence-pages' ? 'pages' : 'prose';
        if (!scenario.coherenceFail?.[stage] || nth > 1) return reply({passed: true, issues: []});
        if (stage === 'prose') {
          const prose = data.approvedOriginalProse, rows = paragraphsOf(prose.ko), labels = prose.paragraphBeats.ko, index = labels.indexOf(2);
          return reply({passed: false, issues: [{code: 'causal_gap', beatIndex: 2, pageNo: null, language: 'ko', severity: 'error', evidence: rows[index].slice(0, 12), suggestion: '앞 비트의 원인을 이어 주세요.'}]});
        }
        const page = data.pagination.pages[1];
        return reply({passed: false, issues: [{code: 'state_conflict', beatIndex: page.beatIndex, pageNo: page.pageNo, language: 'ko', severity: 'error', evidence: page.textKo.slice(0, 12), suggestion: '소품 상태를 앞 쪽과 맞춰 주세요.'}]});
      }
      case kind === 'coherence-repair-prose': return reply({paragraphs: data.repairTargets.map(t => ({...t, text: `${t.text} ${t.language === 'ko' ? '그래서 둘은 다시 찾아보기로 해요.' : 'So they look again.'}`}))});
      case kind === 'coherence-repair-pages': return reply({pages: data.repairTargets.map(t => { const page = clone(data.pagination.pages.find(p => p.pageNo === t.pageNo)); page.textKo = `${page.textKo} 잎은 아직 젖어 있어요.`; return page; })});
      case kind === 'pagination': {
        counts.pagination = (counts.pagination || 0) + 1;
        const result = M.demo.demoPagination(data.approvedOutline, data.approvedOriginalProse, data.input);
        if (scenario.shortFirstPagination && counts.pagination === 1) result.pages = result.pages.slice(0, -1);
        return reply(result);
      }
      case kind === 'rewrite-page' || kind === 'rewrite-page-richness' || kind === 'rewrite-page-repair': {
        const page = clone(data.targetPage);
        return reply({pageNo: page.pageNo, beatIndex: page.beatIndex, textKo: page.textKo, textEn: page.textEn, scene: page.scene, variantByCharacter: page.variantByCharacter, isRefrainPage: page.isRefrainPage});
      }
      case kind === 'rewrite-page-ending': {
        const page = clone(data.targetPage);
        return reply({pageNo: page.pageNo, beatIndex: page.beatIndex, textKo: `${page.textKo} 다음에는 어디로 갈까요?`, textEn: `${page.textEn} Where will they go next?`, scene: page.scene, variantByCharacter: page.variantByCharacter, isRefrainPage: page.isRefrainPage});
      }
      case kind === 'rewrite-scene': return reply({action: `${namesEn[0]} lifts a small green leaf beside the round wooden door of the home.`});
      case kind === 'child-curiosity': {
        counts.curiosity = (counts.curiosity || 0) + 1;
        const pageNos = [...request.user.matchAll(/^(\d+)\. /gmu)].map(m => Number(m[1]));
        const zero = scenario.childRepair && counts.curiosity === 1 ? 3 : null;
        return reply({pages: pageNos.map((pageNo, i) => ({pageNo, score: pageNo === zero ? 0 : 2, childQuestion: i === pageNos.length - 1 ? null : '다음에는 어떻게 될까?', why: '앞선 행동과 다음 결과가 이어져요.'})), dropPages: zero ? [zero] : [], overall: 8});
      }
      case kind === 'child-retell': {
        counts.retell = (counts.retell || 0) + 1;
        const beats = [...request.user.matchAll(/^(\d+) \[(\w+)\]/gmu)].map(m => ({index: Number(m[1]), type: m[2]}));
        const missTurn = scenario.childRepair && counts.retell === 1;
        return reply({retell: ['아이가 소리의 흔적을 찾았어요.', '아이가 앞서 본 물건에서 단서를 알았어요.', '아이들이 결과를 확인하고 집으로 돌아왔어요.'], coveredBeats: beats.filter(b => !(missTurn && b.type === 'turn')).map(b => b.index), missingCore: missTurn ? ['turn'] : [], confusions: [], coherence: 2});
      }
      default: throw Error(`unhandled legacy pin mock request: ${kind}`);
    }
  }};
}

/** Data URLs are long and say nothing about layout: pin their hash instead. */
const compact = value => JSON.parse(JSON.stringify(value, (key, v) => (typeof v === 'string' && v.startsWith('data:') && v.length > 120 ? `data#${sha(v).slice(0, 16)}` : v)));
const failure = error => ({error: String(error?.message || error), name: error?.name || null, stage: error?.stage ?? null, violations: error?.violations ?? null});
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const STORY_DATE = '2026-10-19T00:00:00.000Z';

async function loadModules(rootUrl) {
  const load = path => import(new URL(path, rootUrl).href);
  const paths = {
    engine: 'dist/engine.js', world: 'dist/image-generation/world.js', readingUi: 'dist/reading-ui.js', ui: 'dist/story-generation/ui.js',
    pipeline: 'dist/story-generation/pipeline.js', schemas: 'dist/story-generation/schemas.js', demo: 'dist/story-generation/demo.js',
    briefs: 'dist/story-generation/scene-briefs.js', plot: 'dist/story-generation/plot-contract.js', levels: 'dist/reading-levels.js',
    readingChecker: 'dist/reading-checker.js', richness: 'dist/story-generation/richness.js', checker: 'dist/story-generation/checker.js',
    output: 'dist/output.js', simple: 'dist/simple-create.js', fullAuto: 'dist/full-auto.js', pageTools: 'dist/story-generation/page-tools.js',
    textModels: 'dist/text-generation/models.js', imageProviders: 'dist/image-generation/providers.js', textSettings: 'dist/text-generation/settings-ui.js', readingContext: 'dist/story-reading-context.js',
  };
  const modules = {};
  for (const [name, path] of Object.entries(paths)) modules[name] = await load(path);
  return modules;
}

function seed(M, {quality = true, imageEngine} = {}) {
  const state = M.engine.seedState();
  M.world.migrateWorldState(state);
  M.readingUi.migrateReadingSettings(state.settings);
  if (!quality) state.settings.storyQuality = {enabled: false};
  if (imageEngine) M.world.getActiveWorld(state).imageEngine = imageEngine;
  return state;
}
const wizardOf = (koreanLevel, englishLevel, pageCount, language, extra = {}) => ({
  characterIds: ['yuha', 'greenie'], backgroundIds: [], topic: '바람 피리 찾기', pageCount, koreanLevel, englishLevel,
  language, value: 'none', ending: 'home', storyDate: STORY_DATE, ...extra,
});
const WIZARDS = {
  'K1-E0-12-bilingual': wizardOf('K1', 'E0', 12, 'bilingual'),
  'K2-E2-16-bilingual': wizardOf('K2', 'E2', 16, 'bilingual'),
  'K2-E1-12-ko': wizardOf('K2', 'E1', 12, 'ko'),
  'K2-E2-8-dual': wizardOf('K2', 'E2', 8, 'dual'),
  'K3-E3-24-dual': wizardOf('K3', 'E3', 24, 'dual', {characterIds: ['toto', 'yuha'], topic: '달빛 산책'}),
  'K4-E4-16-ko': wizardOf('K4', 'E4', 16, 'ko', {characterIds: ['yuha', 'mom'], topic: '비 오는 날 우산 찾기'}),
  'K2-E2-16-en': wizardOf('K2', 'E2', 16, 'en'),
  'K3-E1-12-bilingual': wizardOf('K3', 'E1', 12, 'bilingual'),
};

// ---------- levels, inputs and structural validation ----------
function levelsGroup(M) {
  const state = seed(M), out = {
    version: M.levels.READING_LEVEL_VERSION, seed: M.levels.LEVEL_SEED, specs: M.levels.LEVEL_SPECS,
    pageCounts: M.schemas.PAGE_COUNTS, beatCounts: M.schemas.BEAT_COUNTS, frozen: {}, beatCount: {}, plans: {},
  };
  for (const ko of M.levels.KOREAN_LEVELS) for (const en of M.levels.ENGLISH_LEVELS)
    out.frozen[`${ko}-${en}`] = [M.levels.freezeReadingLevels({koreanLevel: ko, englishLevel: en}, state.settings), M.levels.freezeReadingLevels({koreanLevel: ko, englishLevel: en, koVocabulary: ['바람', '잎'], topicVocabulary: ['kite']})];
  out.frozen.defaults = M.levels.freezeReadingLevels({}, state.settings);
  for (const pageCount of [8, 12, 14, 16, 20, 24]) for (const ko of ['K1', 'K2', 'K3', 'K4']) {
    const specs = {ko: M.levels.getLevelSpec(ko)};
    out.beatCount[`${pageCount}-${ko}`] = [M.schemas.beatCountFor(pageCount, ko), M.schemas.frozenBeatCount({pageCount, specs}), M.schemas.frozenBeatCount({pageCount, specs: {ko: {...specs.ko, ruleVersion: 2}}}), M.schemas.frozenBeatCount({pageCount, outlineBeatCount: 6, specs})];
  }
  for (const beats of [6, 7, 8]) for (const pageCount of [8, 12, 16, 24]) {
    const outline = M.demo.demoOutline({characters: [{id: 'yuha', name: '유하'}], backgrounds: [{id: 'home'}], pageCount: {6: 8, 7: 12, 8: 16}[beats], outlineBeatCount: beats});
    out.plans[`${beats}-${pageCount}`] = M.pipeline.buildBeatPagePlan(outline, pageCount);
  }
  return out;
}

function inputsGroup(M) {
  const out = {wizard: {}, normalized: {}, errors: {}};
  for (const [name, wizard] of Object.entries(WIZARDS)) {
    const prepared = M.ui.inputFromWizard(seed(M), wizard);
    out.wizard[name] = compact(prepared);
    out.normalized[name] = M.pipeline.normalizeStoryInput({...prepared.input, bookId: `book-${name}`});
  }
  const plainState = seed(M, {quality: false});
  out.wizard['K2-E2-16-bilingual-plain'] = compact(M.ui.inputFromWizard(plainState, WIZARDS['K2-E2-16-bilingual']));
  // A draft frozen before R8/R9 (no prosePolicy, no catchphrasePolicy, no outlineBeatCount).
  const old = {bookId: 'old-draft', storyDate: '2026-10-01T02:00:00.000Z', topic: '바람 찾기', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha', catchphrase: '같이 가자!'}], backgrounds: [{id: 'home', type: 'home', name: '유하의 집'}], pageCount: 16, endingType: 'home_sleep', specs: {ko: M.levels.getLevelSpec('K2'), en: M.levels.getLevelSpec('E2')}, storyQuality: {enabled: true, twoPass: true}};
  out.normalized.old = M.pipeline.normalizeStoryInput(old);
  out.normalized['old-ruleVersion2'] = M.pipeline.normalizeStoryInput({...old, specs: {ko: {...old.specs.ko, ruleVersion: 2}, en: old.specs.en}});
  for (const [name, patch] of Object.entries({p14: {pageCount: 14}, p20: {pageCount: 20}, p10: {pageCount: 10}, noCast: {characters: []}, noSpecs: {specs: {ko: old.specs.ko}}}))
    try { out.errors[name] = M.pipeline.normalizeStoryInput({...old, ...patch}); } catch (error) { out.errors[name] = failure(error); }
  return out;
}

function pagedFixture(M, pageCount, koreanLevel = 'K2') {
  const input = M.pipeline.normalizeStoryInput({characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'greenie', name: '초록이', nameEn: 'Greenie'}], backgrounds: [{id: 'home', type: 'home', name: '유하네 집'}, {id: 'forest', name: '숲'}, {id: 'garden', name: '정원'}], pageCount, topic: '바람 피리 찾기', specs: {ko: M.levels.getLevelSpec(koreanLevel), en: M.levels.getLevelSpec('E2')}, bookId: `fixture-${pageCount}`});
  const outline = M.demo.demoOutline(input), prose = M.demo.demoProse(outline, input), pagination = M.demo.demoPagination(outline, prose, input);
  return {input, outline, prose, pagination};
}
function validationGroup(M) {
  const out = {};
  const check = (name, value, input, outline, options) => { out[name] = M.schemas.validatePagination(value, input, outline, options); };
  for (const count of [8, 12, 16, 24]) {
    const {input, outline, pagination} = pagedFixture(M, count);
    check(`${count}`, pagination, input, outline);
    check(`${count}-noCount`, pagination, {...input, pageCount: undefined}, outline);
    out[`${count}-inspect`] = M.pipeline.inspectStory(outline, pagination, input);
  }
  const f16 = pagedFixture(M, 16), f12 = pagedFixture(M, 12);
  const sliced = (fixture, n) => ({...clone(fixture.pagination), pages: clone(fixture.pagination.pages.slice(0, n))});
  check('13-of-16', sliced(f16, 13), f16.input, f16.outline);
  check('13-of-16-loose', sliced(f16, 13), f16.input, f16.outline, {exactCount: false});
  check('6-of-12', sliced(f12, 6), f12.input, f12.outline);
  check('16-of-12', f16.pagination, f12.input, f16.outline);
  check('12-of-16', sliced(f16, 12), f16.input, f16.outline);
  out['13-of-16-inspect'] = M.pipeline.inspectStory(f16.outline, sliced(f16, 13), f16.input);
  out['6-of-12-inspect'] = M.pipeline.inspectStory(f12.outline, sliced(f12, 6), f12.input);
  const broken = clone(f16.pagination);
  broken.pages[3].textEn = '';
  broken.pages[5].pageNo = 9;
  broken.pages[7].beatIndex = 42;
  broken.pages[8].scene.who = ['stranger'];
  broken.cover = {title: ''};
  check('broken', broken, f16.input, f16.outline);
  for (const [name, value] of Object.entries({empty: null, noPages: {cover: {title: 't', sceneAction: 'a b c'}}}))
    check(name, value, f16.input, f16.outline);
  try { M.schemas.assertValid('pagination', sliced(f16, 13), f16.input, f16.outline); out.assert = 'valid'; } catch (error) { out.assert = failure(error); }
  return out;
}

// ---------- every text request through the real pipeline ----------
const REQUEST_SCENARIOS = {
  'K1-E0-12-quality': {wizard: 'K1-E0-12-bilingual', quality: true, prose: {tell: true, ko: {rich: 3, simplify: 7, fix: 7, condense: 5}, en: {rich: 3, simplify: 5, condense: 3}},
    coherenceFail: {prose: true, pages: true}, shortFirstPagination: true, childRepair: true, extra: true},
  'K2-E2-16-quality': {wizard: 'K2-E2-16-bilingual', quality: true, prose: {ko: {rich: 3, simplify: 5}, en: {rich: 3, simplify: 3}}, finalize: true, simple: true},
  'K2-E2-16-plain': {wizard: 'K2-E2-16-bilingual', quality: false, prose: {ko: {plain: 5}, en: {plain: 3}}, enrich: true, extra: true, edits: true},
  'K3-E3-24-plain': {wizard: 'K3-E3-24-dual', quality: false, prose: {ko: {plain: 12}, en: {plain: 9}}, briefRepair: true},
  // An existing K4 page draft (Korean only): new K4 drafts become openings, this one must not.
  'K4-E4-16-plain': {wizard: 'K4-E4-16-ko', wizardPatch: {topic: '바람 피리 찾기'}, quality: false, prose: {ko: {plain: 12}, en: {plain: 10}}, finalize: true, extra: true},
  'K2-E2-16-en-quality': {wizard: 'K2-E2-16-en', quality: true, prose: {ko: {rich: 3, simplify: 5}, en: {rich: 3, simplify: 3}}, childRepair: true},
};
const ledger = meta => (meta?.qualityCheckpoint ? {contextFingerprint: meta.qualityCheckpoint.contextFingerprint, keys: Object.keys(meta.qualityCheckpoint.completed || {})} : null);
async function requestScenario(M, name, s, book) {
  const state = seed(M, {quality: s.quality}), prepared = M.ui.inputFromWizard(state, {...WIZARDS[s.wizard], ...s.wizardPatch});
  // An existing draft: saved before the editor round and page rhythm.
  const input = {...asExistingDraft(prepared.input), bookId: `legacy-${name}`};
  const scenario = {...s, normalized: M.pipeline.normalizeStoryInput(input), counts: {}};
  const log = [], engine = mockEngine(M, scenario, log), steps = [], options = {engine};
  // Each stage's output data is pinned too, not only what later requests happen to carry.
  const row = (stage, result) => steps.push({stage, requests: result.meta?.requests ?? null, ledger: ledger(result.meta), checks: result.meta?.checks?.passed ?? null, childGate: result.meta?.childGate?.pass ?? null, coherence: result.meta?.coherence?.passed ?? null, data: compact(result.data ?? null)});
  try {
    const a = await M.pipeline.generateOutline(clone(input), options); row('outline', a);
    const outline = a.data;
    const b = await M.pipeline.generateSceneBriefs(outline, clone(input), options); row('briefs', b);
    const c = await M.pipeline.generateProse(outline, clone(input), {...options, sceneBriefs: b.data}); row('prose', c);
    let prose = c.data;
    if (s.enrich) { const e = await M.pipeline.enrichProse(prose, outline, clone(input), {...options, sceneBriefs: b.data}); prose = e.data; row('enrichment', e); }
    const d = await M.pipeline.paginateStory(outline, prose, clone(input), {...options, sceneBriefs: b.data, richness: true, bookId: input.bookId}); row('pagination', d);
    prose = d.meta.approvedProse || prose;
    if (s.finalize) row('finalize', await M.pipeline.finalizeStoryPagination(outline, prose, d.data, clone(input), {...options, sceneBriefs: b.data, richness: true}));
    if (s.extra) {
      row('rewrite-page', await M.pipeline.rewriteStoryPage(d.data, 1, outline, prose, clone(input), {...options, sceneBriefs: b.data, violations: [{kind: 'page', language: 'ko', pageNo: 1, message: '문장을 짧게 해 주세요.'}]}));
      row('rewrite-scene', await M.pipeline.rewriteStoryPage(d.data, 2, outline, prose, clone(input), {...options, sceneBriefs: b.data, sceneOnly: true}));
      row('repair', await M.pipeline.repairPagination(outline, prose, d.data, clone(input), {...options, sceneBriefs: b.data, richness: true, skipChildGate: true, skipCoherence: true}));
    }
    if (s.edits) {
      const beat = await M.pipeline.rewriteBeat(outline, 1, clone(input), options); row('rewrite-beat', beat);
      row('plot-contract', await M.pipeline.ensurePlotContract(beat.data, clone(input), options));
      row('rewrite-brief', await M.pipeline.rewriteSceneBrief(b.data, 3, outline, clone(input), options));
      row('rewrite-paragraph', await M.pipeline.rewriteParagraph(prose, 'en', 2, outline, clone(input), options));
      row('materials', await M.pipeline.generateMaterialPlan(clone(input), {characters: state.characters, backgrounds: state.backgrounds, allowNew: true}, options));
    }
    if (s.simple) {
      const simpleBook = {...clone(book), textDemo: false, outline, prose, pagination: clone(d.data), pages: M.pipeline.toLegacyPages(d.data), storyInput: clone(input), sceneBriefs: b.data, id: `simple-${name}`};
      const result = await M.pageTools.rewriteBookPage(state, simpleBook, 2, {engine, save: () => true});
      steps.push({stage: 'simple-rewrite', changed: result.changed, page: compact(result.page), storyCheck: result.storyCheck?.passed ?? null});
    }
  } catch (error) { steps.push({...failure(error), stage: 'error', failedStage: error?.stage ?? null}); }
  return {steps, kinds: log.map(r => r.kind), requests: log};
}
async function requestsGroup(M, book) {
  const out = {};
  for (const [name, s] of Object.entries(REQUEST_SCENARIOS)) out[name] = await requestScenario(M, name, s, book);
  return out;
}

// ---------- free demo engine and FULL AUTO ----------
/**
 * A draft saved before the editor round and page rhythm (2026-10-19): no
 * editorPolicy and no `rhythm` in its frozen specs. Pre-round roots have
 * neither, so this is a no-op there.
 */
function asExistingDraft(input) {
  const {editorPolicy, craftPolicy, arcPolicy, councilPolicy, promptPolicy, councilRecent, orchestrationPolicy, k1Policy, topicEndingPolicy, promptDiet, ...rest} = input;
  const specs = Object.fromEntries(Object.entries(rest.specs || {}).map(([lang, spec]) => {
    const {rhythm, shortSentences, ...plain} = spec || {};
    return [lang, plain];
  }));
  return {...rest, specs};
}
async function demoGroup(M) {
  const out = {};
  for (const name of ['K1-E0-12-bilingual', 'K2-E2-16-bilingual', 'K3-E3-24-dual', 'K2-E2-8-dual', 'K2-E2-16-en', 'K4-E4-16-ko']) {
    const state = seed(M), input = {...asExistingDraft(M.ui.inputFromWizard(state, WIZARDS[name]).input), bookId: `demo-${name}`}, normalized = M.pipeline.normalizeStoryInput(input);
    const outline = M.demo.demoOutline(normalized), prose = M.demo.demoProse(outline, normalized);
    out[`${name}-raw`] = {outline, prose, pagination: M.demo.demoPagination(outline, prose, normalized)};
    const options = {engineId: 'demo'};
    try {
      const a = await M.pipeline.generateOutline(clone(input), options), b = await M.pipeline.generateSceneBriefs(a.data, clone(input), options);
      const c = await M.pipeline.generateProse(a.data, clone(input), {...options, sceneBriefs: b.data});
      const d = await M.pipeline.paginateStory(a.data, c.data, clone(input), {...options, sceneBriefs: b.data, richness: true, bookId: input.bookId});
      out[`${name}-pipeline`] = {outline: a, briefs: b, prose: c, pagination: d};
    } catch (error) { out[`${name}-pipeline`] = failure(error); }
  }
  return out;
}

/** The pre-R12 job fixture (16 pages) and the same job at the parent's 8 and 24 pages: never re-derived or snapped. */
async function fullAutoResumeGroup(M, fixture) {
  const out = {};
  for (const pageCount of [16, 8, 24]) {
    const job = clone(fixture);
    job.wizard.pageCount = job.input.pageCount = pageCount;
    out[pageCount] = await resumeAtInput(M, job);
  }
  return out;
}
async function resumeAtInput(M, job) {
  const state = seed(M, {imageEngine: 'openai'}), calls = [], STOP = 'legacy-pin-stop-before-outline';
  const counted = name => async () => { calls.push(name); throw Error(`no ${name} call expected`); };
  const operations = {preflight: async () => {}, plan: counted('plan'), characterSheet: counted('characterSheet'), backgroundSheet: counted('backgroundSheet'), briefs: counted('briefs'), prose: counted('prose'), enrichment: counted('enrichment'), pagination: counted('pagination'), repairPagination: counted('repairPagination'), coherence: counted('coherence'), scene: counted('scene'), cover: counted('cover'),
    outline: async () => { calls.push('outline-reached'); throw new DOMException(STOP, 'AbortError'); }};
  const before = fullAutoProgressSafe(M, job);
  let error = null;
  try { await M.fullAuto.runFullAuto(state, job, {operations, buildBook: () => { throw Error('no book'); }}); } catch (caught) { error = String(caught.message); }
  return {error, calls, input: job.input, wizard: job.wizard, plan: job.plan, completed: job.completed, status: job.status, phase: job.phase, currentStep: job.currentStep, progressBefore: before, progressAfter: fullAutoProgressSafe(M, job), payload: compact(M.fullAuto.fullAutoPayload({...job, outline: null, prose: null, pagination: null}))};
}
function fullAutoProgressSafe(M, job) { try { return M.fullAuto.fullAutoProgress(job); } catch (error) { return failure(error); } }

/**
 * Free demo FULL AUTO runs. New jobs only for wizards that stay page books forever
 * (K1, English-only); a K2 Korean job is the pre-R12 job fixture, rerun as a demo.
 */
async function fullAutoDemoGroup(M, fixture) {
  const out = {};
  const runs = [
    ['K1-E0-12-bilingual-text', () => { const state = seed(M); return {state, job: M.fullAuto.createFullAutoJob(state, {...WIZARDS['K1-E0-12-bilingual'], backgroundIds: ['forest', 'garden']}, {demo: true, stopBefore: 'text'})}; }],
    ['K2-E2-16-en-pages', () => { const state = seed(M); return {state, job: M.fullAuto.createFullAutoJob(state, {...WIZARDS['K2-E2-16-en'], backgroundIds: ['forest', 'garden']}, {demo: true, stopBefore: 'pages'})}; }],
    ['legacy-job-K2-E2-16-bilingual-text', () => { const state = seed(M, {imageEngine: 'openai'}), job = clone(fixture); Object.assign(job, {demo: true, stopBefore: 'text', status: 'ready', completed: {}, plan: undefined}); return {state, job}; }],
  ];
  for (const [name, make] of runs) {
    const {state, job} = make(), progress = [fullAutoProgressSafe(M, job)];
    const buildBook = payload => ({id: payload.bookId, title: payload.pagination.cover.title, characterIds: payload.wizard.characterIds, backgroundIds: payload.wizard.backgroundIds, pages: M.pipeline.toLegacyPages(payload.pagination), outline: payload.outline, prose: payload.prose, pagination: payload.pagination, storyInput: payload.input, sceneBriefs: payload.sceneBriefs, readingLevelSnapshot: payload.readingLevels, textDemo: payload.demo, worldSettingsSnapshot: payload.worldSnapshot});
    let error = null;
    try { await M.fullAuto.runFullAuto(state, job, {buildBook}); } catch (caught) { error = failure(caught); }
    progress.push(fullAutoProgressSafe(M, job));
    const {book, worldSnapshot, ...rest} = job, draft = state.storyDrafts?.[job.storyDraftId];
    out[name] = compact({error, progress, job: rest, bookPages: book?.pages?.length ?? null, draft: draft ? {stage: draft.stage, reviewMode: draft.reviewMode, selectedTitle: draft.selectedTitle} : null, snapshot: book?.generationSnapshot ? Object.keys(book.generationSnapshot) : null});
  }
  return out;
}

// ---------- pictures ----------
async function sceneGroup(M, fixture) {
  const out = {};
  const describe = request => compact({...request, referenceImages: request.referenceImages.map(ref => ({...ref, imageUrl: ref.imageUrl?.startsWith('data:') ? `data#${sha(ref.imageUrl).slice(0, 16)}` : ref.imageUrl}))});
  const variants = {
    staged: book => book,
    plain: book => { delete book.sceneBriefs; for (const page of book.pages) { delete page.staging; delete page.sceneBrief; } return book; },
    prompt: book => { book.pages[4].imagePrompt = 'A parent-written picture of the lunch box singing beside the stones.'; return book; },
    sized: book => { book.pages[6].imageSize = '1024x1024'; book.pages[6].imageQuality = 'draft'; return book; },
  };
  for (const [name, edit] of Object.entries(variants)) {
    const state = seed(M), book = edit(clone(fixture));
    M.world.captureBookGenerationSnapshot(state, book);
    for (const index of [0, 1, 4, 6, 8, book.pages.length - 1]) {
      try { out[`${name}-${index}`] = describe(M.world.sceneGenerationRequest(state, book, index, {quality: 'final'})); } catch (error) { out[`${name}-${index}`] = failure(error); }
    }
    try { out[`${name}-cover`] = describe(M.world.sceneGenerationRequest(state, book, 0, {cover: true, quality: 'final'})); } catch (error) { out[`${name}-cover`] = failure(error); }
    // The free sample engine draws 3:2 pages and the cover from the same requests.
    if (name === 'staged' || name === 'plain') for (const [key, options] of [['sample-1', {}], ['sample-cover', {cover: true}]]) {
      try {
        const image = await M.imageProviders.generateImage(M.world.sceneGenerationRequest(state, book, 1, {quality: 'final', ...options}), {engine: 'sample'});
        out[`${name}-${key}`] = {imageSha256: sha(image.imageUrl), seed: image.seed, model: image.model, generationMode: image.generationMode, keptReferences: compact(image.keptReferences ?? null)};
      } catch (error) { out[`${name}-${key}`] = failure(error); }
    }
  }
  return out;
}

// ---------- print, ④ markup, checks, estimates ----------
function printGroup(M, fixture) {
  const state = seed(M), out = {};
  for (const layout of ['single', 'two', 'booklet']) for (const language of ['ko', 'en', 'bilingual']) for (const textPosition of ['below', 'staged', 'bottom', 'top']) for (const pages of ['all', '2-3', 'cover']) {
    const key = `${layout}/${language}/${textPosition}/${pages}`;
    try { const html = M.output.getPrintHTML(clone(fixture), {layout, language, textPosition, pages}, state.characters); out[key] = {sha256: sha(html), bytes: html.length}; } catch (error) { out[key] = failure(error); }
  }
  for (const [name, settings] of Object.entries({normal: {fontSize: 'normal'}, gray: {color: 'grayscale', margin: 'binding'}, dual: {language: 'dual', layout: 'two'}, list: {pages: '1, 3, 5'}, bad: {pages: '0-40'}})) {
    try { const html = M.output.getPrintHTML(clone(fixture), settings, state.characters); out[`extra/${name}`] = {sha256: sha(html), bytes: html.length}; } catch (error) { out[`extra/${name}`] = failure(error); }
  }
  // One full document, so a diff shows what moved.
  out.sample = M.output.getPrintHTML(clone(fixture), {layout: 'single', language: 'bilingual', textPosition: 'staged', pages: '2-3'}, state.characters).replace(/data:image\/svg\+xml[^"]+/gu, m => `svg#${sha(m).slice(0, 16)}`);
  return out;
}

function reviewGroup(M, fixture) {
  const out = {};
  const render = (bookEdit, wizardPatch, page = 0) => {
    const state = seed(M), book = bookEdit(clone(fixture)), job = {id: 'auto-legacy-review', status: 'text-review', stopBefore: 'text', wizard: {simpleFlow: true, topic: book.topic}, updatedAt: '2026-10-19T09:00:00.000Z', book};
    book.fullAutoRunId = job.id;
    state.fullAutoJobs = {[job.id]: job};
    let w = M.simple.ensureSimpleWizard(state, {...WIZARDS['K2-E2-16-bilingual'], simpleJobId: job.id, ...wizardPatch}), d = book, p = page;
    const ctx = {getState: () => state, getWizard: () => w, setWizard: v => { w = v; }, getDraft: () => d, setDraft: v => { d = v; }, getEditPage: () => p, setEditPage: v => { p = v; }, isSimpleView: () => true, isSimpleMode: () => true,
      materialPortrait: c => `<svg aria-label="${c.name}"></svg>`, cover: () => '<div class="book-cover"></div>', illustration: (b, i) => `<img alt="${i + 1}">`};
    return M.simple.renderSimpleCreate(ctx);
  };
  const same = book => book;
  out.first = render(same, {simpleStep: 4}, 0);
  out.middle = render(same, {simpleStep: 4}, 6);
  out.last = render(same, {simpleStep: 4}, 15);
  out.editing = render(same, {simpleStep: 4, simpleEditing: true}, 2);
  out.badge = render(same, {simpleStep: 4, simpleBadgeOpen: true}, 1);
  out.ko = render(book => ({...book, language: 'ko'}), {simpleStep: 4}, 4);
  out.en = render(book => ({...book, language: 'en'}), {simpleStep: 4}, 4);
  out.stale = render(book => { Object.assign(book.pages[1], {imageStale: true, imageStaleAssetId: PNG}); return book; }, {simpleStep: 4}, 1);
  out.finish = render(same, {simpleStep: 5}, 0);
  // ③ before any job: only for wizards that stay page books (K1, English-only).
  for (const name of ['K1-E0-12-bilingual', 'K2-E2-16-en']) out[`generate-${name}`] = render(book => book, {...WIZARDS[name], simpleStep: 3, simpleJobId: undefined}, 0);
  const book = clone(fixture);
  out.helpers = {imageWork: M.simple.imageWork(book), imageCountLabel: M.simple.imageCountLabel(book), approval: M.simple.approvalImageWork(book, 'openai'), approvalSample: M.simple.approvalImageWork(book, 'sample'), needing: M.pageTools.pagesNeedingImages(book), missingText: M.simple.missingPageText(book), summary: ['K1-E0-12-bilingual', 'K2-E2-16-en'].map(name => M.simple.formatSummary(WIZARDS[name]))};
  return out;
}

async function checksGroup(M, fixture) {
  const out = {}, book = clone(fixture), input = M.pipeline.normalizeStoryInput(book.storyInput), outline = book.outline, pagination = book.pagination;
  out.inspect = M.pipeline.inspectStory(outline, pagination, input);
  out.checkStory = M.checker.checkStory(outline, pagination, {specs: input.specs, storyInput: input, storyWords: M.readingContext.buildStoryWords(input, outline), allowedNames: input.characters.flatMap(c => [c.name, c.nameEn].filter(Boolean))});
  out.analyzeBook = await M.readingChecker.analyzeBook(book, book.readingLevelSnapshot.specs);
  out.analyzeOwn = await M.readingChecker.analyzeBook({...book, readingLevelSnapshot: undefined}, {ko: M.levels.getLevelSpec('K1'), en: M.levels.getLevelSpec('E0')});
  out.richness = M.richness.checkRichness(pagination, input, outline, book.sceneBriefs);
  out.richnessNoBriefs = M.richness.checkRichness(pagination.pages, input, outline, []);
  for (const count of [12, 24]) {
    const f = pagedFixture(M, count, count === 12 ? 'K1' : 'K3');
    out[`demo-${count}`] = {inspect: M.pipeline.inspectStory(f.outline, f.pagination, f.input), richness: M.richness.checkRichness(f.pagination, f.input, f.outline, [])};
  }
  out.toLegacyPages = M.pipeline.toLegacyPages(pagination);
  const base = clone(book.pages);
  base[2].textKo = base[2].ko = '바뀐 글이에요.';
  base[3].scene = {...base[3].scene, action: 'A different picture.'};
  out.toLegacyPagesKeep = compact(M.pipeline.toLegacyPages(pagination, base));
  return out;
}

function estimatesGroup(M, fixture) {
  const out = {story: {}, fullAuto: {}, simple: {}};
  const at = new Date('2026-10-19T09:00:00.000Z');
  const base = M.textSettings.getTextGenerationSettings(seed(M));
  const settings = {
    default: base,
    plain: {...base, storyQuality: {...base.storyQuality, enabled: false}},
    beam: {...base, storyQuality: {...base.storyQuality, useBeamSearch: true, twoPass: false, childSimulator: false}},
    anthropic: {...base, engine: 'anthropic'},
    noEnrichment: {...base, storyQuality: {enabled: false}, storyEnrichment: false},
  };
  for (const [name, value] of Object.entries(settings)) for (const pageCount of [8, 12, 16, 24])
    out.story[`${name}-${pageCount}`] = M.textModels.estimateStoryTextCost({settings: value, pageCount, at});
  out.story.paragraphs = M.textModels.estimateStoryTextCost({settings: base, pageCount: 16, beatCount: 8, paragraphCount: {ko: 10, en: 9}, previousTextLength: 4000, at});
  for (const pageCount of [8, 12, 16, 24]) for (const [mode, options] of Object.entries({two: undefined, auto: {planMode: 'auto'}, selection: {planMode: 'selection'}, demo: {demo: true}, openai: {imageEngine: 'openai'}, google: {imageEngine: 'google'}})) {
    // Wizards that stay page books (K1, English-only); K2-K4 Korean wizards become openings in R12.
    for (const name of ['K1-E0-12-bilingual', 'K2-E2-16-en']) {
      const state = seed(M), wizard = {...WIZARDS[name], pageCount};
      out.fullAuto[`${name}-${pageCount}-${mode}`] = options ? M.fullAuto.estimateFullAutoCost(state, wizard, options) : M.fullAuto.estimateFullAutoCost(state, wizard);
      out.simple[`${name}-${pageCount}-${mode}`] = M.pageTools.estimateSimpleCosts(state, wizard, options || {});
    }
  }
  for (const [name, edit] of Object.entries({demoBook: b => b, paidBook: b => ({...b, textDemo: false}), openaiBook: b => ({...b, textDemo: false, imageEngine: 'openai'}), noCover: b => ({...b, textDemo: false, cover: null})})) {
    const state = seed(M, {imageEngine: 'openai'});
    out.simple[name] = M.pageTools.estimateSimpleCosts(state, edit(clone(fixture)));
  }
  return out;
}

/** Every group runs on its own frozen clock and fresh random sequence, so groups never shift each other. */
async function legacySnapshots(rootUrl, fixtures) {
  const M = await withOpeningsHook(() => { hookLog.push({root: rootUrl.href, group: 'load', hook: globalThis[OPENINGS_HOOK]}); return loadModules(rootUrl); }), groups = {
    levels: () => levelsGroup(M),
    inputs: () => inputsGroup(M),
    validation: () => validationGroup(M),
    requests: () => requestsGroup(M, fixtures.book),
    demo: () => demoGroup(M),
    fullAutoResume: () => fullAutoResumeGroup(M, fixtures.job),
    fullAutoDemo: () => fullAutoDemoGroup(M, fixtures.job),
    scene: () => sceneGroup(M, fixtures.book),
    print: () => printGroup(M, fixtures.book),
    review: () => reviewGroup(M, fixtures.book),
    checks: () => checksGroup(M, fixtures.book),
    estimates: () => estimatesGroup(M, fixtures.book),
  };
  const out = {};
  for (const [name, build] of Object.entries(groups)) out[name] = await deterministic(() => { hookLog.push({root: rootUrl.href, group: name, hook: globalThis[OPENINGS_HOOK]}); return build(); });
  return out;
}

// ---------- the pins ----------
const PINS = {
  levels: '1c6063ed356c55392fb2b3cf1f161c7f1060b804aacc4ad2fd7589f32c986188',
  // Re-pinned for the editor round (2026-10-19): a NEW draft's input gains
  // editorPolicy {version: 1} (inputFromWizard). Nothing else changes; the
  // 'requests' pin strips it to stand for an existing draft and is unchanged.
  // 8087d69: 3338fc4f…c415.
  // Page rhythm (2026-10-19): a new draft's frozen specs also gain `rhythm`
  // (every language but E0/E1). 23c3519: 19904f80…7e67.
  // Craft rules (2026-10-20): a new draft's input also gains craftPolicy
  // {version: 1}. 25e3760: 55c71176…3f2d.
  // Story spine (2026-10-20, R19): a new draft's input also gains arcPolicy
  // {version: 1}; nothing else in the group changes (dump-diffed against
  // 894ab59). 894ab59: f3db9e82…3e24.
  // Writers' room (2026-10-20, R20): a new draft's input also gains
  // councilPolicy {version: 1} (no other key: an unwritten direction is left
  // out). Dump-diffed against a113ead. a113ead: 8208a679…3e15.
  // Prompt tidy-up (R23): a new draft's input also gains promptPolicy {version: 1}
  // (the only change: dump-diffed against 9b7bd4b). 9b7bd4b: 770c6ce0…9ba0.
  // Council ban list (R25): a new draft's input also gains councilRecent
  // {version: 1, planted: []} (wizard and normalized; no approved books in the
  // fixture, so no request changes); nothing else differs (diffed against
  // 38cc8de). 38cc8de: 6eea4aab…a4cd.
  // 정성 모드 (R29): a new draft's input also gains orchestrationPolicy
  // {version: 1, writerTier: "medium"} (wizard and normalized); nothing else
  // differs (diffed against 035107a). 035107a: c80208e9…ec74.
  // K1 그림책 (R31a): a new K1 draft's input gains k1Policy and the K1
  // short-sentence spec and drops arcPolicy/councilPolicy/councilRecent; every
  // other level is unchanged (dump-diffed against 653b704). 653b704: 674fb65e…41ee.
  // 프롬프트 다이어트 (R31b): every new draft's input carries promptDiet {version: 1};
  // nothing else differs (dump-diffed against a3f361e). a3f361e: ae3bb686…b24f.
  inputs: '287d578508e546dc5aeb19f295629536f5b9d9480fd5a2b569e0930b914e1a26',
  validation: '4cc17c73b28f39909a913561e31ccc3252a9a206f1e0f49fa6d662555114fe44',
  requests: '7c04f7970b0878f5dd0a2bed0513ec8895e1fc4093a6ce8954d769eaa429bb12',
  // Re-pinned for hotfix 4 (2026-10-19, scene-brief checks): the demo stage's
  // meta.checks report gained advisories/softIssues/notes/hardBeatIndexes, and
  // the rain-prop rule is a note, so the rainy demo book reports passed:true
  // instead of a rain_topic error. Demo data, usage and every request byte are
  // unchanged (the 'requests' pin holds). ebfcbf9: 5e95fe43…911e.
  demo: '146ec0449bbaafbd49a22019eada3bcf8df83ee9c3e4580db4d07e67608ccd7d',
  fullAutoResume: '061cbf1cf0fb861ae9526b45385c3e2dc64693622982cf3fe1aa90a63701a6c3',
  // Re-pinned at the R12 × main-line merge: R13 (6ccc895) freezes the picture
  // model on every new job (job.imageModelConfig = imageModelSnapshot(world),
  // {googlePro:false, modelVariant:'default'} here). 5f8d2f7: 5675220d…37d4.
  // Hotfix 4 (scene-brief checks, see 'demo' above): the job's usage row for the
  // demo briefs call carries the new report shape. ebfcbf9: ebcf1dd9…b4ae.
  // Editor round: the new demo jobs' input carries editorPolicy (demo runs
  // never buy the read-through). 8087d69: 12e9fc3d…e2b.
  // Page rhythm: the new demo jobs' frozen specs carry `rhythm`. 23c3519: 6f236d08…cca8.
  // Craft rules: the new demo jobs' input carries craftPolicy. 25e3760: 0e922d9f…ec0f.
  // Story spine (R19): the new demo jobs' input carries arcPolicy (demo runs
  // buy nothing; the pre-R12 job fixture is unchanged). 894ab59: 063dc4a0…567c.
  // Writers' room (R20): the new demo jobs' input carries councilPolicy (the demo
  // never meets; the pre-R12 job fixture is unchanged). a113ead: 700e54fb…4e95.
  // Prompt tidy-up (R23): the new demo jobs' input carries promptPolicy (the demo
  // engine sends no prompt; the pre-R12 job fixture is unchanged). 9b7bd4b: f1752df6…e662.
  // Council ban list (R25): the demo jobs' input carries councilRecent (empty
  // list); nothing else differs (diffed against 38cc8de). 38cc8de: 06aaf633…82ab.
  // 정성 모드 (R29): the demo jobs' input carries orchestrationPolicy (a demo
  // never meets, so no request changes); nothing else differs (diffed against
  // 035107a). 035107a: 3b7c0695…fa92.
  // K1 그림책 (R31a): the K1 demo job's input as above (dump-diffed against 653b704). 653b704: 78059d1c…f150.
  // 프롬프트 다이어트 (R31b): the demo jobs' input carries promptDiet (the demo engine
  // sends no prompt; the pre-R12 job fixture is unchanged; dump-diffed against
  // a3f361e). a3f361e: f1ccd7ec…0440.
  // 검사 다이어트 (R31c): the demo K2 job's story check carries the whole-book
  // total and new-word notes instead of violations (the demo jobs are diet
  // drafts); nothing else differs (dump-diffed against 36fa25a). 36fa25a: efcb8465…582e.
  // 영어 어휘 허용 (R31d): the demo K2 job's story check has fewer new-word notes
  // (inflections folded, the briefs' props and the backgrounds' English names
  // are story words); nothing else differs (dump-diffed against ac45fbc). ac45fbc: e9526fe1…aa21.
  // 영어 허용 범위 (R31e): the demo jobs are diet drafts — the demo K2 job's
  // English is judged by the unit rules (its per-sentence violations are gone,
  // its out-of-list shares are notes) and lean notes carry their message (the
  // K1 demo's E0 vocabulary notes too); the demo outline keeps its ledger;
  // nothing else differs (dump-diffed against 071ba58). 071ba58: ba0173e4…7d53.
  fullAutoDemo: 'c20447c5c64b058fb41fa1af68c5fd11b497750bc3a9fc7391767fdcf22c624c',
  // 2026-10-20 identity line: every scene request names a character's gender
  // when the record has one (the seed protagonist does), so an outfit never
  // redraws the child. Existing books change on purpose. 263beca: 73b3552a…3a91.
  scene: '34ee02d12bfcaf889a73d076089ff1e8194f9315581f10f06e6159dbeec85394',
  print: '637653d97d300bb6c2d5f7b39f10ad741d070dda0f6b90f85b8856683699f654',
  // Re-pinned at the merge: R13 (6ccc895) renames the ③ text-engine options
  // ('GPT · OpenAI') and adds the ③ model selects (generate-K1/K2-en only;
  // ④/⑤ are unchanged). 5f8d2f7: c78d5e07…11d7.
  // Editor round: ③ before any job prices the read-through and the
  // author-model simplify (글 만들기 $1.94 → $2.46 at 12 pages) and its model
  // note names 글 다듬기·책 전체 퇴고. 8087d69: f17c0136…dfc3.
  // Story spine (R19): ③'s '승인 예시 함께 쓰기' help text says the 9-point
  // examples are always in as spine cards (title and aria-label only; buttons,
  // prices and ④/⑤ are unchanged). 894ab59: e1255f42…959d.
  // Writers' room (R20): ③ before any job prices the five council calls
  // (글 만들기 $2.46 → $2.48 at 12 pages); nothing else on ③, ④ or ⑤ changes.
  // a113ead: 21b16ee3…d5f6.
  // 회의 결과 보고 진행 (R22): ③ before any job gains the '회의 결과 보고 진행 ·
  // 켜짐' line (help text and its 끄기 button) under the 승인 예시 line; the
  // prices, ④ and ⑤ are byte-identical (diffed against 15db614's dump).
  // 15db614: b8f4af05…052a.
  // Monochrome UX: ③ now renders semantic slider switches and folded engine/cost details.
  // Before: 520fc68c7960c4598b05017f4e13f81f68724dcb30e5c422ddd6bd74ef346f09.
  // Baseline 08f09d4 dump vs current: only review differs; all request/data/price pins match.
  // Review model (R26): ③ before any job prices the new story with its coherence
  // judgement on the medium model (글 약 $2.48 → $1.94 at 12 pages) and its folded
  // engine/cost details gain the '검사는 최고 모델로' switch; ④ and ⑤ are unchanged
  // (diffed against 0109553). 0109553: 564133de…a1b9.
  // Screen finish (R24): ④'s empty-art button reads '이 쪽 그림 만들기' and ③'s
  // '승인 예시 더 참고' switch (renamed from '증류 추가 예시') moves into the folded
  // engine/cost details; no text, price or request changed (diffed against
  // 311e4df). 311e4df: a68b451f…54f2.
  // 정성 모드 (R29): ③ before any job prices the new story with the growth design
  // and three candidates (글 약 $1.94 → $2.08 at 12 pages) and its folded
  // engine/cost details gain the '정성 모드' and '작가는 최고 모델로' switches;
  // ④ and ⑤ are unchanged (diffed against 035107a). 035107a: add2f529…5b80.
  // 비트별 작가 (R30): ③ prices the new story with the beat writer in place of
  // the rich/simplify prose passes (12쪽 글 약 $2.08 → $2.18, 16쪽 $2.30 → $2.41);
  // nothing else changed (dump-diffed against 0157814). 0157814: f9cd8ef4…f25e.
  // K1 그림책 (R31a): ③ prices a new K1 book without the room, with one writer
  // call and no pagination request (글 약 $2.18 → $0.99); nothing else changed
  // (dump-diffed against 653b704). 653b704: bbc64451…c85b.
  // 프롬프트 다이어트 (R31b): ③ prices a new K2 book with the outline on the stage
  // model and without the quality prose passes (16쪽 글 약 .41 → .66); the K1
  // line and everything else are unchanged (dump-diffed against a3f361e). a3f361e: 823730df…e987.
  // 검사 다이어트 (R31c): ③ prices a new K1 book without the editor and with two
  // page fixes (글 약 $0.99 → $0.65), a new K2 book with two page fixes ($1.66 →
  // $1.71); nothing else changed (dump-diffed against 36fa25a). 36fa25a: d8e779d9…719e.
  // 영어 허용 범위·장부 없음 (R31e): ③ prices a new book without the two ledger
  // reviews (③ K1 12쪽 글 약 $0.65 → $0.51, K2 16쪽 영어 $1.71 → $1.56); nothing
  // else changed (dump-diffed against 071ba58). 071ba58: 72bd3a0f…61b0.
  review: '75314338885ab90e41c7c0eda58c2b4676949629da4774e2310dfd812650f875',
  checks: '60a704ac41283bf82a3e193c2f736e5ca1b3409b63e766c8118408b22d7b5cf6',
  // Editor round: FULL AUTO/simple estimates for a NEW job include the
  // read-through (+1 request) and the author-model simplify; estimateStoryTextCost
  // without `editor` and estimates of existing books are unchanged. 8087d69: b11df8a8…068f.
  // Writers' room (R20): FULL AUTO/simple estimates for a NEW job include the
  // five economy-model council calls (+5 requests, textUsd/baseUsd/
  // withMaterialsAndRetryUsd); estimates of existing jobs and books are
  // unchanged (dump-diffed: only those four fields of fullAuto.* differ).
  // a113ead: 6c157a3e…6d55.
  // Review model (R26): FULL AUTO/simple estimates for a NEW job price the two
  // coherence reviews on the medium model (textUsd/baseUsd/withMaterialsAndRetryUsd
  // only); estimateStoryTextCost of a snapshot without reviewTier, and estimates
  // of existing jobs and books, are unchanged. 0109553: bcdb6bbb…7f77.
  // 정성 모드 (R29): only a NEW job's estimate changed (+3 requests: four
  // author-model calls for the growth design and candidates, one economy
  // pitch call fewer; text $1.717 → $1.862); jobs and legacy rows are the same
  // (diffed against 035107a). 035107a: 7e95b83e…ee38.
  // 비트별 작가 (R30): only a NEW job's estimate changed (requests/textUsd/
  // baseUsd/withMaterialsAndRetryUsd: 21 → 37 requests, text $1.862 → $1.937 —
  // beat writer 16 + expected retries 4 + voice card and anchor sniffs 3 in
  // place of 2 rich + 2 simplify); jobs and legacy rows are the same
  // (dump-diffed against 0157814). 0157814: 20cde054…833b.
  // K1 그림책 (R31a): only NEW K1 jobs' estimates changed (37 → 10 requests,
  // text $1.937 → $0.875); K2+ and existing jobs are the same (dump-diffed
  // against 653b704). 653b704: e47fe78c…6784.
  // 프롬프트 다이어트 (R31b): only NEW K2+ jobs' text estimate changed (16쪽 .407 →
  // .655, 8쪽 .937 → .361; the request count is the same — the outline on the
  // stage model, no quality prose rows); K1 and existing jobs are the same
  // (dump-diffed against a3f361e). a3f361e: a91a4f43…cc53.
  // 검사 다이어트 (R31c): only NEW jobs' estimates changed — K1 10 → 11 requests,
  // text $0.875 → $0.579 (no editor, two page fixes); K2 16쪽 42 → 44, $1.655 →
  // $1.707 (two page fixes); existing jobs are the same (dump-diffed against
  // 36fa25a). 36fa25a: fa6bbbcd…6bbd.
  // 영어 허용 범위·장부 없음 (R31e): only NEW jobs' estimates changed — a diet
  // outline has no ledger, so the two coherence-review rows are gone (K1 12쪽
  // 11 → 9 requests, $0.579 → $0.450; K2 16쪽 39 → 37, $1.413 → $1.284); jobs
  // whose outline carries a ledger are the same (dump-diffed against 071ba58).
  // 071ba58: d19686db…dd47.
  estimates: '8b673b905788d400a759831728fc0a149dada73ed6292edf13568e1c8b821736',
};
/** scripts/r12-legacy-dom.mjs on 5f8d2f7's dist: the seed book's and the legacy page book's reader at 390px and 1280px. */
const READER_DOM_SHA256 = '0e5035cff5dcd72be00b346b4cb67aa455c1eab8c848b3fcc3a4e6e4b81f6c16';
const SEED_READER_HTML_SHA256 = {
  '390/1': '3b21019341bf4b83806e371c21496157434b992d72729735ad08a21dbf0f3e99',
  '390/2': '278a1af22903f2d6689929f3bd78b0f1f4a14f6e53b323b56dd9aef6d9a973f5',
  '390/12': '9b06955449547c58b293a2620d01fd7869f9ebc52a2a05d663188b5b64d871e5',
  '1280/1': '3b21019341bf4b83806e371c21496157434b992d72729735ad08a21dbf0f3e99',
  '1280/2': '278a1af22903f2d6689929f3bd78b0f1f4a14f6e53b323b56dd9aef6d9a973f5',
  '1280/12': '9b06955449547c58b293a2620d01fd7869f9ebc52a2a05d663188b5b64d871e5',
};
const PRE_R9_PIN = "const PRE_R9_APP_REQUESTS_SHA256='2c0b9c8c0508eb26b00c783187447cbf8a0914ec2d19d707bab52f0002d28f48';";

const FIXTURES = {
  book: JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8')),
  job: JSON.parse(readFileSync(new URL('./fixtures/legacy-fullauto-job-r12.json', import.meta.url), 'utf8')),
};
let head, pre;
before(async () => {
  head = await legacySnapshots(new URL('../', import.meta.url), FIXTURES);
  if (process.env.PRE_R12_APP_ROOT) pre = await legacySnapshots(pathToFileURL(`${process.env.PRE_R12_APP_ROOT.replace(/\/$/, '')}/`), FIXTURES);
  // R12_PIN_DUMP=/abs/file.json writes HEAD's groups, so a failing pin can be diffed against a PRE_R12 dump.
  if (process.env.R12_PIN_DUMP) writeFileSync(process.env.R12_PIN_DUMP, JSON.stringify(head, null, 1));
});

for (const [group, expected] of Object.entries(PINS))
  test(`R12-P0 legacy pin: ${group}`, () => {
    const actual = sha(head[group]);
    if (pre) {
      const before = sha(pre[group]);
      console.log(`pre-R12 ${group} sha256 ${before}`);
      assert.deepEqual(clone(head[group]), clone(pre[group]));
      assert.equal(actual, before, `${group}: same content, different serialisation`);
    }
    assert.equal(actual, expected, `${group}: legacy behaviour changed (sha256 ${actual})`);
  });

test('R12-P0 the request pins cover every text stage, carry no timeoutMs and end without an error', () => {
  const kinds = new Set(Object.values(head.requests).flatMap(scenario => scenario.kinds));
  for (const kind of [
    'quality-outline', 'quality-fix-outline', 'outline', 'scene-briefs', 'scene-brief',
    'quality-rich-ko', 'quality-simplify-ko', 'quality-fix-ko', 'quality-condense-ko', 'quality-rich-en', 'quality-simplify-en', 'quality-condense-en',
    'prose', 'enrichment', 'coherence-prose', 'coherence-repair-prose', 'coherence-pages', 'coherence-repair-pages',
    'pagination', 'rewrite-page', 'rewrite-page-repair', 'rewrite-page-richness', 'rewrite-page-ending', 'rewrite-scene',
    'child-curiosity', 'child-retell', 'rewrite-paragraph', 'rewrite-beat', 'plot-contract', 'materials',
  ]) assert.ok(kinds.has(kind), `no ${kind} request is pinned`);
  assert.ok(!kinds.has('unknown'));
  // K1: the short first pagination is repaginated, and the child gate's turn repair repaginates once more.
  assert.equal(head.requests['K1-E0-12-quality'].kinds.filter(kind => kind === 'pagination').length, 3);
  for (const [name, scenario] of Object.entries(head.requests)) {
    assert.ok(!scenario.steps.some(step => step.stage === 'error'), `${name}: ${JSON.stringify(scenario.steps.at(-1))}`);
    for (const request of scenario.requests) assert.ok(!request.keys.includes('timeoutMs'), `${name}: ${request.kind} has timeoutMs`);
  }
  for (const name of ['K1-E0-12-quality', 'K2-E2-16-quality', 'K2-E2-16-en-quality'])
    for (const stage of ['outline', 'prose']) assert.match(head.requests[name].steps.find(step => step.stage === stage).ledger.contextFingerprint, /^[0-9a-f]+$/);
});

test('R12-P0 every pin is computed with the openings test hook on, and the hook is restored afterwards', async () => {
  const roots = [new URL('../', import.meta.url).href, ...(process.env.PRE_R12_APP_ROOT ? [pathToFileURL(`${process.env.PRE_R12_APP_ROOT.replace(/\/$/, '')}/`).href] : [])];
  for (const root of roots) {
    const rows = hookLog.filter(row => row.root === root);
    assert.deepEqual(rows.map(row => row.group), ['load', ...Object.keys(PINS)], root);
    for (const row of rows) assert.equal(row.hook, true, `${root} ${row.group}`);
  }
  assert.ok(!(OPENINGS_HOOK in globalThis), 'the hook leaked out of the pins');
  // A caller that reads the hook at call time sees it on inside a pin, and the previous value comes back, also after a throw.
  assert.equal(await deterministic(() => globalThis[OPENINGS_HOOK]), true);
  assert.ok(!(OPENINGS_HOOK in globalThis));
  globalThis[OPENINGS_HOOK] = false;
  try {
    await assert.rejects(deterministic(() => { assert.equal(globalThis[OPENINGS_HOOK], true); throw Error('inside'); }), /inside/u);
    assert.equal(globalThis[OPENINGS_HOOK], false);
  } finally { delete globalThis[OPENINGS_HOOK]; }
});

test('R12-P0 the request pins hold each stage\'s output data, K3 24p and K4 16p included', () => {
  for (const [name, scenario] of Object.entries(head.requests))
    for (const step of scenario.steps) {
      if (step.stage === 'simple-rewrite') { assert.ok(step.page, name); continue; }
      assert.ok(step.data && typeof step.data === 'object', `${name}: ${step.stage} has no pinned data`);
    }
  for (const [name, pages] of [['K3-E3-24-plain', 24], ['K4-E4-16-plain', 16]]) {
    const scenario = head.requests[name], pagination = scenario.steps.find(step => step.stage === 'pagination');
    assert.equal(pagination.data.pages.length, pages, name);
    assert.ok(scenario.kinds.includes('pagination'), `${name} buys its pagination`);
    assert.equal(head.requests[name].steps.find(step => step.stage === 'outline').data.beats.length, 8, name);
  }
  assert.equal(head.requests['K4-E4-16-plain'].steps.find(step => step.stage === 'pagination').data.pages[0].scene.who.includes('mom'), true);
  // A paid-path change that only touches the stored pagination (no later request carries it) moves the pin.
  const moved = clone(head.requests);
  const k3 = moved['K3-E3-24-plain'].steps.find(step => step.stage === 'pagination');
  k3.data = {...k3.data, openingAdjustments: []};
  assert.notEqual(sha(moved), PINS.requests);
});

test('R12-P0 a pre-R12 FULL AUTO job resumed at the input step keeps its page input and buys nothing', () => {
  assert.equal(FIXTURES.job.readingLevels.version, 3);
  for (const [pageCount, beats] of [[16, 8], [8, 6], [24, 8]]) {
    const resumed = head.fullAutoResume[pageCount];
    assert.deepEqual(resumed.calls, ['outline-reached'], `${pageCount}`);
    assert.equal(resumed.status, 'paused');
    assert.ok(resumed.completed.input);
    assert.equal(resumed.input.pageCount, pageCount);
    assert.equal(resumed.input.outlineBeatCount, beats);
    assert.ok(!('layoutPolicy' in resumed.input));
    assert.deepEqual(resumed.input.prosePolicy, {version: 1, condenseOverBudget: {ko: false, en: false}});
    assert.deepEqual(resumed.input.specs, FIXTURES.job.readingLevels.specs);
  }
});

test('R12-P0 legacy guards keep their page rules', () => {
  assert.ok(head.validation['13-of-16'].errors.includes('정확히 16쪽이 필요해요.'));
  assert.ok(head.validation['6-of-12'].errors.includes('정확히 12쪽이 필요해요.'));
  assert.equal(head.validation['16'].valid, true);
  assert.equal(head.inputs.errors.p14.error, '이야기는 8·12·16·24쪽 중에서 골라 주세요.');
  for (const name of Object.keys(head.inputs.wizard)) assert.ok(!('layoutPolicy' in head.inputs.wizard[name].input), name);
  assert.equal(head.levels.frozen['K2-E2'][0].version, 3);
  assert.equal(Object.keys(head.print).filter(key => key.split('/').length === 4).length, 108);
  for (const [key, row] of Object.entries(head.scene)) if (!key.includes('sample') && !row.error) assert.equal(row.size, key.startsWith('sized-6') ? '1024x1024' : '1536x1024', key);
});

test('R12-P0 the pre-R9 request pin is unchanged', () => {
  assert.ok(readFileSync(new URL('./catchphrase-r9.test.mjs', import.meta.url), 'utf8').includes(PRE_R9_PIN));
});

test('R12-P0 the reader DOM pins of the seed book and the generated legacy page book are recorded at 390px and 1280px', () => {
  const report = JSON.parse(readFileSync(new URL('../QA/r12-legacy-dom.json', import.meta.url), 'utf8'));
  // seed-dinosaur is the local sample (12 pages, 'dual', SVG); the fixture is a generated K2/E2 16-page page book.
  assert.deepEqual(report.books, ['seed-dinosaur', FIXTURES.book.id]);
  assert.deepEqual(report.runs.map(run => [run.book, run.width, run.pageCount]), [['seed-dinosaur', 390, 12], ['seed-dinosaur', 1280, 12], [FIXTURES.book.id, 390, 16], [FIXTURES.book.id, 1280, 16]]);
  assert.equal(FIXTURES.book.pages.length, 16);
  // Pinned pages 1 and 2 show its PNG pictures; page 16 has no picture yet.
  assert.ok(FIXTURES.book.storyInput?.specs && FIXTURES.book.readingLevelSnapshot && FIXTURES.book.pages.every(page => page.staging));
  assert.deepEqual(FIXTURES.book.pages.map(page => page.imageUrl?.slice(0, 22) ?? null).filter((_, i) => [0, 1, 15].includes(i)), ['data:image/png;base64,', 'data:image/png;base64,', null]);
  for (const run of report.runs) {
    assert.deepEqual(Object.keys(run.pages), ['1', '2', String(run.pageCount)]);
    assert.deepEqual([run.pageErrors, run.paidRequests], [[], []]);
    for (const page of Object.values(run.pages)) assert.ok(page.layout.overflow <= 0);
  }
  const pins = Object.fromEntries(report.runs.flatMap(run => Object.entries(run.pages).map(([pageNo, row]) => [`${run.book}/${run.width}/${pageNo}`, {html: row.htmlSha256, layout: row.layoutSha256}])));
  assert.equal(sha(pins), report.readerSha256);
  assert.equal(report.readerSha256, READER_DOM_SHA256);
  // The seed book's pages keep the hashes first recorded at eed745d.
  for (const [key, html] of Object.entries(SEED_READER_HTML_SHA256)) assert.equal(pins[`seed-dinosaur/${key}`].html, html, key);
});
