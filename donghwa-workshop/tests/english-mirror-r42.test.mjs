import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse} from '../dist/story-generation/pipeline.js';
import {leanBeatWriterRules, leanProseRules, leanPaginationRules, leanOpeningsPaginationRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoPagesPrompt, ecoJobInit} from '../dist/eco-mode.js';
import {renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {hasEnglishMirror, englishMirrorPolicy, mirrorWriterSystem, mirrorWriterRule, mirrorWriterBlock, mirrorPaginationLine, mirrorK1Line, mirrorProseLine} from '../dist/story-generation/english-mirror.js';
import {storyChangePolicy, storyChangeRef, allowsWordless, wordlessRule, isWordlessEntry, wordlessPageIndexes} from '../dist/story-generation/story-change.js';

/**
 * 2026-10-27 R42 영어는 한글을 따라 · 말 없는 쪽 기본 끔. The parent on a
 * finished K2 draft: "the story is strange, and there is a blank page". The
 * beat writer wrote a beat's Korean and English in parallel, each from the
 * outline alone ("never a translation of Korean"), so on one page the English
 * gave away what the Korean kept for the turn; and the R38 wordless entry
 * landed on the turn opening. A new diet draft freezes input.englishMirror
 * {version: 1} (Korean first, the English written from it) and storyChange
 * {version: 1, wordless: false} (no wordless entry). Drafts frozen before
 * R42 are unchanged: the two calls stay parallel and a {version: 1} change
 * marker keeps its one wordless entry (R12 pins; the R38 tests on preR42
 * inputs).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie', 'toto', 'mom'], backgroundIds: ['home', 'beach'], topic: '놀이터에서 자꾸 도망가는 그림자 잡기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `m-${Object.keys(extra).join('-') || 'default'}`});
const dated = (input) => { const copy = structuredClone(input); delete copy.englishMirror; return copy; };
const reply = (json) => ({json, usage: {input: 100, output: 50}, meta: {requests: 1, model: 'mock'}});
/** A mock writer that records every request in order; Korean beats carry a marker the English must see. */
function writer() {
  return {id: 'mock-writer', calls: [], async complete(req) {
    this.calls.push(req);
    const user = String(req.user), system = String(req.system);
    if (/되풀이 말을 다른 언어로/u.test(system)) return reply({text: 'Slowly, slowly, look!'});
    if (/첫 장면의 두 초안/u.test(system)) return reply({pick: 1, reason: '리듬'});
    const en = /writing original English/u.test(system), beat = Number(/\[이번 비트\] (\d+)/u.exec(user)[1]);
    const refrain = en ? /\[Refrain — use this exact line once\] (.+)/u.exec(user)?.[1] : /\[되풀이 말 — 글자 그대로 한 번\] (.+)/u.exec(user)?.[1];
    return reply({text: en ? `Yuha looks at beat ${beat}.${refrain ? ` ${refrain}` : ''}` : `유하가 ${beat}번 비트를 봐요. 비밀번호 ${beat}${beat}${beat}.${refrain ? ` ${refrain}` : ''}`});
  }};
}
const run = (inp, outline, engine) => generateProse(outline, inp, {engineId: 'openai', engine: {id: 'base', complete: () => { throw new Error('the base prose engine is never called'); }}, qualityEngines: {beatWriter: engine, cheap: engine}});

test('R42 the marker: every new diet draft freezes englishMirror and storyChange {wordless: false}; normalize keeps both; the model JSON shows neither; a draft without the diet reads nothing', () => {
  const state = setup(), led = draft(state), k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.deepEqual(led.englishMirror, englishMirrorPolicy());
  assert.deepEqual(k1.englishMirror, englishMirrorPolicy());
  assert.deepEqual(led.storyChange, {version: 1, wordless: false});
  assert.equal(hasEnglishMirror(led), true);
  assert.equal(hasEnglishMirror({englishMirror: {version: 1}}), false, 'off the diet nothing reads it');
  assert.equal(hasEnglishMirror(dated(led)), false);
  assert.doesNotMatch(JSON.stringify(leanVisibleInput(led)), /englishMirror|wordless/);
  assert.deepEqual(normalizeStoryInput(led).englishMirror, englishMirrorPolicy());
  assert.deepEqual(normalizeStoryInput(led).storyChange, {version: 1, wordless: false});
  // A pre-R42 marker survives normalize as it was frozen.
  assert.deepEqual(normalizeStoryInput({...led, storyChange: {version: 1}}).storyChange, {version: 1});
  assert.deepEqual(storyChangeRef({version: 1}), {version: 1});
  assert.deepEqual(storyChangeRef({version: 1, wordless: false}), {version: 1, wordless: false});
  assert.deepEqual(storyChangeRef({version: 1, wordless: true}), {version: 1}, 'only false is a value');
  assert.equal(storyChangeRef({version: 2}), null);
  assert.deepEqual(storyChangePolicy(), {version: 1});
  // FULL AUTO keeps a job's own markers (a pre-R42 job never gains the mirror or loses its wordless entry).
  const job = createFullAutoJob(state, wizardOf(), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.englishMirror, englishMirrorPolicy());
  assert.deepEqual(job.input.storyChange, {version: 1, wordless: false});
});

test('R42 the wordless entry: a new draft is never offered one and never accepts one; a pre-R42 change marker keeps the R38 behaviour', () => {
  const state = setup();
  const fresh = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages'), old = {...structuredClone(fresh), storyChange: {version: 1}};
  assert.equal(allowsWordless(fresh), false);
  assert.equal(allowsWordless(old), true);
  assert.equal(wordlessRule(fresh), '');
  assert.match(wordlessRule(old), /^WORDLESS: /);
  assert.doesNotMatch(leanPaginationRules(fresh) + leanOpeningsPaginationRules(draft(state), {cues: ['arrival']}), /WORDLESS/);
  const outline = demoOutline(fresh), prose = demoProse(outline, fresh), pagination = demoPagination(outline, prose, fresh);
  outline.beats[2].picturePlan = {version: 1, carrier: 'picture', picture: 'the shadow stretches across the slide'};
  const idx = pagination.pages.findIndex((p) => p.beatIndex === 3);
  pagination.pages[idx].textKo = ''; pagination.pages[idx].textEn = '';
  assert.equal(isWordlessEntry(pagination.pages[idx], idx, pagination.pages, outline, old), true);
  assert.equal(isWordlessEntry(pagination.pages[idx], idx, pagination.pages, outline, fresh), false, 'a new draft needs text on every entry');
  assert.deepEqual([...wordlessPageIndexes(pagination.pages, outline, fresh)], []);
  // ③ names a pre-R42 draft's wordless entry instead of "문장 0 · 권장 …".
  const led = draft(state), oldLed = {...structuredClone(led), storyChange: {version: 1}};
  const o2 = demoOutline(oldLed), p2 = demoPagination(o2, demoProse(o2, oldLed), oldLed);
  o2.beats[2].picturePlan = {version: 1, carrier: 'picture', picture: 'the shadow stretches'};
  const at = p2.pages.findIndex((p) => p.beatIndex === 3);
  const pages = p2.pages.map((p, i) => ({...p, ko: i === at ? '' : p.textKo, en: i === at ? '' : p.textEn, textKo: i === at ? '' : p.textKo, textEn: i === at ? '' : p.textEn}));
  const book = {id: 'book-w', title: '그림자', language: 'bilingual', fullAutoRunId: 'auto-w', outline: o2, storyInput: oldLed, pages, readingCheck: {passed: true, pages: pages.map(() => ({passed: true}))}};
  const job = {id: 'auto-w', status: 'text-review', stopBefore: 'text', wizard: {simpleFlow: true, topic: wizardOf().topic}, input: oldLed, book, updatedAt: '2026-10-27T01:00:00Z'};
  state.fullAutoJobs = {[job.id]: job};
  let page = at;
  const ctx = {getState: () => state, getWizard: () => ensureSimpleWizard(state, {...wizardOf(), simpleStep: 4, simpleJobId: job.id}), setWizard() {}, getDraft: () => book, setDraft() {}, getEditPage: () => page, setEditPage: (v) => { page = v; }, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => '<img alt="">'};
  const html = renderSimpleCreate(ctx);
  assert.match(html, /simple-wordless">말 없는 쪽 · 그림이 말해요 \(글을 넣으려면 ‘글 고치기’\)</);
  assert.doesNotMatch(html, /문장 0 · 권장/);
  page = at + 1;
  assert.match(renderSimpleCreate(ctx), /문장 \d+ · 권장 /);
  assert.doesNotMatch(renderSimpleCreate(ctx), /simple-wordless/);
});

test('R42 the writers: the English of a mirrored beat is written after its Korean and from it; the system and rule lines follow; K1, the app prose, pagination and eco get one line each; a draft without the marker keeps the parallel calls and the old lines', async () => {
  const state = setup(), led = draft(state), outline = demoOutline(led);
  outline.refrain = {text: '천천히, 천천히 보자.', usedAtBeats: [2, 4, 6]};
  const engine = writer();
  const result = await run(led, outline, engine);
  const beatCalls = engine.calls.filter((c) => /\[이번 비트\]/u.test(String(c.user)));
  const langOf = (c) => (/writing original English/u.test(String(c.system)) ? 'en' : 'ko');
  const beatOf = (c) => Number(/\[이번 비트\] (\d+)/u.exec(String(c.user))[1]);
  // Order: every beat's Korean before its English (beat 1 has two Korean drafts first).
  for (const b of outline.beats.map((x) => x.index)) {
    const ko = beatCalls.findIndex((c) => langOf(c) === 'ko' && beatOf(c) === b), en = beatCalls.findIndex((c) => langOf(c) === 'en' && beatOf(c) === b);
    assert.ok(ko >= 0 && en > ko, `beat ${b}: Korean (${ko}) before English (${en})`);
  }
  // Every English call carries that beat's finished Korean (the marker the mock wrote into it).
  for (const c of beatCalls.filter((x) => langOf(x) === 'en')) {
    const b = beatOf(c);
    assert.match(String(c.user), new RegExp(`\\n\\n\\[이 비트의 한글 — 영어는 이 글을 따라요: 같은 일을 같은 순서로, 같은 대사를, 한글이 아직 말하지 않은 것은 말하지 않아요\\]\\n유하가 ${b}번 비트를 봐요\\. 비밀번호 ${b}${b}${b}\\.`));
    assert.match(String(c.system), /^You are a picture-book author writing original English at E2 for a bilingual picture book\. Write only this one beat's English: the short English telling of the Korean text you are given/);
    assert.doesNotMatch(String(c.system), /never a translation of Korean/);
    assert.match(String(c.system), / The English follows the Korean of the same beat: the same events in the same order, the same spoken lines, the same surprise kept for the same moment; it may say less, never something else\. One idea per sentence; no semicolons\./);
  }
  for (const c of beatCalls.filter((x) => langOf(x) === 'ko')) assert.doesNotMatch(String(c.user), /이 비트의 한글/);
  assert.equal(result.data.paragraphBeats.en.length, outline.beats.length);
  assert.match(result.data.en, /Slowly, slowly, look!/);
  // Without the marker: parallel (the two beat-1 Korean drafts and the two English drafts are issued together), the old lines.
  const plain = writer();
  await run(dated(led), outline, plain);
  const plainCalls = plain.calls.filter((c) => /\[이번 비트\]/u.test(String(c.user)));
  assert.deepEqual(plainCalls.slice(0, 4).map(langOf), ['ko', 'ko', 'en', 'en']);
  assert.ok(plainCalls.every((c) => !/이 비트의 한글/.test(String(c.user))));
  assert.ok(plainCalls.filter((c) => langOf(c) === 'en').every((c) => /never a translation of Korean/.test(String(c.system)) && /The English is the short telling of the same beat for an early reader/.test(String(c.system))));
  // The rule lines.
  assert.equal(mirrorWriterRule(dated(led)), '');
  assert.equal(mirrorWriterSystem(dated(led), 'E2'), '');
  assert.equal(mirrorWriterBlock(led, '  '), '');
  assert.equal(mirrorWriterBlock(dated(led), '유하'), '');
  assert.match(leanBeatWriterRules(led, outline).en, /The English follows the Korean of the same beat/);
  assert.match(leanBeatWriterRules(dated(led), outline).en, /The English is the short telling of the same beat for an early reader/);
  assert.match(leanProseRules(led), /The English paragraph of each beat is the short English telling of that beat's Korean paragraph/);
  assert.match(leanProseRules(dated(led)), /never a translation\. usedRefrainAt/);
  assert.equal(mirrorProseLine(dated(led)), '');
  // Pagination (pages, openings, eco) — after the other lines, before scene.who.
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.match(leanPaginationRules(k1), /\nENGLISH FOLLOWS KOREAN: every entry's textEn is the short English telling of that same entry's textKo[^\n]*\n(?:ENTRANCE: [^\n]*\n)?scene\.who/);
  assert.match(leanOpeningsPaginationRules(led, {cues: ['arrival']}), /\nENGLISH FOLLOWS KOREAN: [^\n]*\n(?:ENTRANCE: [^\n]*\n)?scene\.who/);
  assert.doesNotMatch(leanPaginationRules(dated(k1)) + leanOpeningsPaginationRules(dated(led), {cues: ['arrival']}), /ENGLISH FOLLOWS/);
  assert.equal(mirrorPaginationLine(dated(k1)), '');
  const ecoJob = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoPagesPrompt(ecoJob.input, demoOutline(normalizeStoryInput(ecoJob.input))), /ENGLISH FOLLOWS KOREAN/);
  // K1: the craft line about English is replaced.
  assert.match(mirrorK1Line(k1), /^영어\(en\)는 같은 쪽 한글의 짧은 영어 판이에요/);
  assert.equal(mirrorK1Line(dated(k1)), '');
  const k1Engine = {id: 'openai', calls: [], async complete(req) { this.calls.push(req); throw new Error('stop'); }};
  await generateProse(demoOutline(k1), k1, {engine: k1Engine, qualityEngines: {beatWriter: k1Engine, cheap: k1Engine}}).catch(() => {});
  assert.match(String(k1Engine.calls[0].system), /\n영어\(en\)는 같은 쪽 한글의 짧은 영어 판이에요: 같은 일을 같은 순서로, 같은 대사를, 한글이 아직 말하지 않은 것은 말하지 않아요\. 덜 말해도 되지만 다른 말은 안 돼요\. 이름은 영어 이름\.\n/);
  assert.doesNotMatch(String(k1Engine.calls[0].system), /번역이 아니에요/);
  const k1Old = {id: 'openai', calls: [], async complete(req) { this.calls.push(req); throw new Error('stop'); }};
  await generateProse(demoOutline(dated(k1)), dated(k1), {engine: k1Old, qualityEngines: {beatWriter: k1Old, cheap: k1Old}}).catch(() => {});
  assert.match(String(k1Old.calls[0].system), /번역이 아니에요/);
});
