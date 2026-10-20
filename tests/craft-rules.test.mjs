import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getLevelSpec} from '../dist/reading-levels.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {normalizeStoryInput, inspectOutlineRules, inspectStory, generateOutline, generateProse, paginateStory} from '../dist/story-generation/pipeline.js';
import {hardOutlineViolations} from '../dist/story-generation/schemas.js';
import {craftPolicy, hasCraftPolicy, soundRefrainRequired, craftOutlineRules, craftProseRules, craftPaginationRules, keyPropsNamed, samePlaceStreak, craftPictureRules} from '../dist/story-generation/craft-rules.js';
import {buildScenePrompt} from '../dist/image-generation/scene-prompt.js';
import {qualityReferenceBooks} from '../dist/story-generation/quality-adapter.js';
import {revisionRules, REVISION_ASPECTS} from '../dist/story-generation/book-revision.js';

/**
 * Picture-book craft rules (2026-10-20): suspense kept until the turn, a sound
 * refrain for K1/K2, a sidekick who does something, key props in the picture,
 * camera variety at one place, a daytime sky. New drafts only (input.craftPolicy).
 */
const POLICY = {version: 1};
function inputFor({ko = 'K2', en = 'E2', policy = true, language = 'bilingual'} = {}) {
  return normalizeStoryInput({bookId: 'craft', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'toto', name: '토토', nameEn: 'Toto'}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'garden', name: '정원'}], topic: '달까지 따라온 작은 소리', pageCount: 12, endingType: 'home_sleep', language, specs: {ko: getLevelSpec(ko), en: getLevelSpec(en)}, ...(policy ? {craftPolicy: POLICY} : {})});
}
const fake = fn => ({id: 'openai', calls: [], async complete(req) { this.calls.push(req); return {json: await fn(req, this.calls.length), usage: {input: 1, output: 1}, meta: {requests: 1}}; }});

test('the policy is frozen for new drafts, kept by normalizeStoryInput, and hidden from the model', async () => {
  const {inputFromWizard} = await import('../dist/story-generation/ui.js');
  const {seedState} = await import('../dist/engine.js');
  const {migrateWorldState} = await import('../dist/image-generation/world.js');
  const {migrateReadingSettings} = await import('../dist/reading-ui.js');
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const prepared = inputFromWizard(state, {characterIds: ['yuha'], backgroundIds: [], topic: '달', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'});
  assert.deepEqual(prepared.input.craftPolicy, craftPolicy());
  assert.equal(hasCraftPolicy(normalizeStoryInput({...prepared.input, bookId: 'x'})), true);
  assert.equal(hasCraftPolicy(inputFor({policy: false})), false);
  const input = inputFor();
  const engine = fake(() => demoOutline(input));
  await generateOutline(input, {engine}).catch(() => {});
  const sent = JSON.parse(engine.calls[0].user);
  assert.equal(sent.input.craftPolicy, undefined, 'not story data');
  assert.match(engine.calls[0].system, /SUSPENSE: the story asks one question/);
  assert.match(engine.calls[0].system, /SOUND REFRAIN \(required for this K1\/K2 book\)/);
  assert.match(engine.calls[0].system, /SIDEKICK/);
  const legacy = fake(() => demoOutline(input));
  await generateOutline(inputFor({policy: false}), {engine: legacy}).catch(() => {});
  assert.doesNotMatch(legacy.calls[0].system, /SUSPENSE|SOUND REFRAIN|SIDEKICK/);
});

test('rule text by level and language: the sound refrain is K1/K2 Korean only; K3 keeps suspense and sidekick', () => {
  assert.equal(soundRefrainRequired(inputFor({ko: 'K1', en: 'E0'})), true);
  assert.equal(soundRefrainRequired(inputFor({ko: 'K3', en: 'E3'})), false);
  assert.equal(soundRefrainRequired(inputFor({ko: 'K2', en: 'E2', language: 'en'})), false);
  assert.equal(soundRefrainRequired(inputFor({policy: false})), false);
  const k3 = craftOutlineRules(inputFor({ko: 'K3', en: 'E3'}));
  assert.match(k3, /SUSPENSE/); assert.match(k3, /SIDEKICK/); assert.doesNotMatch(k3, /SOUND REFRAIN/);
  assert.equal(craftOutlineRules(inputFor({policy: false})), '');
  assert.match(craftProseRules(inputFor()), /ONE ACTION PER SENTENCE/);
  assert.doesNotMatch(craftProseRules(inputFor({ko: 'K4', en: 'E4'})), /ONE ACTION PER SENTENCE/);
  assert.match(craftPaginationRules(inputFor()), /KEY PROP/);
  assert.equal(craftPaginationRules(inputFor({policy: false})), '');
});

test('a K1/K2 outline without a sound refrain is a soft issue; the quality path puts the craft rules in its canon', async () => {
  const input = inputFor({ko: 'K1', en: 'E0'});
  const outline = demoOutline(input);
  const none = {...outline, refrain: null};
  const report = inspectOutlineRules(none, input);
  const missing = report.violations.filter(v => v.code === 'refrain_missing');
  assert.equal(missing.length, 1);
  assert.equal(hardOutlineViolations({violations: missing}).length, 0, 'soft: never stops the book');
  const planned = {...outline, refrain: {text: '딸랑!', usedAtBeats: [2, 4, 6], variation: ''}};
  assert.ok(!inspectOutlineRules(planned, input).violations.some(v => v.code === 'refrain_missing'));
  assert.ok(!inspectOutlineRules(none, inputFor({ko: 'K1', en: 'E0', policy: false})).violations.some(v => v.code === 'refrain_missing'), 'legacy drafts: no new rule');
  // Prose and pagination requests carry the craft lines for a craft draft only.
  const prose = fake(() => demoProse(outline, input));
  await generateProse(outline, input, {engine: prose, sceneBriefs: demoSceneBriefs(outline, input)}).catch(() => {});
  assert.match(prose.calls[0].system, /SUSPENSE IN PROSE/);
  assert.match(prose.calls[0].system, /SOUND WORDS/);
  const legacyInput = inputFor({ko: 'K1', en: 'E0', policy: false});
  const legacyProse = fake(() => demoProse(outline, legacyInput));
  await generateProse(outline, legacyInput, {engine: legacyProse, sceneBriefs: demoSceneBriefs(outline, legacyInput)}).catch(() => {});
  assert.doesNotMatch(legacyProse.calls[0].system, /SUSPENSE IN PROSE|SOUND WORDS/);
});

test('pagination asks for key props and camera variety; checkStory notes a named prop missing from scene.action', async () => {
  const input = inputFor({ko: 'K1', en: 'E0'}), outline = demoOutline(input), prose = demoProse(outline, input), briefs = demoSceneBriefs(outline, input);
  const engine = fake(req => {
    const props = req.jsonSchema?.properties || {};
    if (props.passed && props.issues) return {passed: true, issues: []};
    return demoPagination(outline, prose, input);
  });
  const result = await paginateStory(outline, prose, input, {engine, sceneBriefs: briefs, repair: false, skipCoherence: true});
  const pagination = engine.calls.find(c => c.jsonSchema?.properties?.cover);
  assert.match(pagination.system, /KEY PROP: when a page's words name a small object/);
  assert.match(pagination.system, /CAMERA: three or more consecutive pages/);
  // A page whose words name a brief prop but whose scene.action does not: an advisory note, not a failure.
  const pages = result.data;
  const page = pages.pages[1], brief = briefs.find(b => b.beatIndex === page.beatIndex);
  page.textKo = `${page.textKo} 유하가 ${brief.props[0].ko}을 들어요.`;
  page.scene.action = 'Yuha stands on the grass path and looks up at the tall green trees near the fence.';
  const checked = inspectStory(outline, pages, input);
  const note = checked.warnings.find(w => w.code === 'key-prop-missing');
  assert.ok(note, JSON.stringify(checked.warnings));
  assert.equal(note.pageNo, page.pageNo);
  assert.ok(note.props.includes(brief.props[0].en), JSON.stringify(note.props));
  assert.equal(checked.violations.some(v => v.type === 'drawable_scene' && v.pageNo === page.pageNo), false);
  assert.ok(!inspectStory(outline, pages, inputFor({ko: 'K1', en: 'E0', policy: false})).warnings.some(w => w.code === 'key-prop-missing'), 'legacy: no note');
  assert.ok(keyPropsNamed(brief, page).includes(brief.props[0].en));
  assert.deepEqual(keyPropsNamed(brief, {ko: '유하가 웃어요.', en: 'Yuha laughs.'}), []);
});

test('picture requests: camera variety from the third page at one place, key props, daytime sky; never for legacy books or the cover', () => {
  const input = inputFor(), outline = demoOutline(input), briefs = demoSceneBriefs(outline, input);
  const snapshot = {characterSheets: [{characterId: 'yuha', characterSnapshot: {nameEn: 'Yuha'}}]};
  const brief = briefs[2];
  const at = (where, extra = {}) => ({pageNo: 1, beatIndex: 3, ko: `유하가 ${brief.props[0].ko}을 들어요.`, en: `Yuha lifts the ${brief.props[0].en}.`, scene: {where, action: 'Yuha lifts a leaf on the path.', timeOfDay: 'day'}, ...extra});
  const book = (policy, sceneBriefs = briefs) => ({characterIds: ['yuha'], sceneBriefs, storyInput: policy ? {craftPolicy: POLICY} : {}});
  const prompt = (policy, earlierPages, page = at('forest'), sceneBriefs = briefs) => buildScenePrompt({book: book(policy, sceneBriefs), page, pageIndex: earlierPages.length, snapshot, place: {background: {name: '숲길'}}, earlierPages});
  const sameTwice = [at('forest'), at('forest')];
  assert.equal(samePlaceStreak(at('forest'), sameTwice), 2);
  assert.equal(samePlaceStreak(at('forest'), [at('forest'), at('garden')]), 0);
  const third = prompt(true, sameTwice);
  assert.match(third, /CAMERA VARIETY: this is page 3 in a row at this place/);
  assert.match(third, new RegExp(`KEY PROPS: the words on this page name ${brief.props[0].en}`));
  assert.match(third, /DAYTIME SKY: it is daytime; no moon and no stars/);
  assert.doesNotMatch(prompt(true, [at('forest')]), /CAMERA VARIETY/);
  assert.match(prompt(true, [], at('forest', {ko: '유하가 달을 봐요.', en: 'Yuha looks at the moon.'})), /the moon only as this page's words describe it/);
  // The brief's time wins when there is one; without a brief the page's night is respected.
  assert.doesNotMatch(prompt(true, [], at('forest', {scene: {where: 'forest', action: 'Yuha lifts a leaf.', timeOfDay: 'night'}}), []), /DAYTIME SKY/);
  const legacy = prompt(false, sameTwice);
  assert.doesNotMatch(legacy, /CAMERA VARIETY|KEY PROPS|DAYTIME SKY/);
  const cover = buildScenePrompt({book: book(true), page: at('forest'), pageIndex: 0, snapshot, place: {background: {name: '숲길'}}, earlierPages: sameTwice, cover: true});
  assert.doesNotMatch(cover, /CAMERA VARIETY|KEY PROPS|DAYTIME SKY/);
  assert.equal(craftPictureRules({book: book(true), page: at('forest'), brief, earlierPages: [], time: 'evening'}).includes('DAYTIME'), false);
});

test('distilled examples: a craft draft prefers its own Korean level; legacy keeps every example', () => {
  const gold = [{bookId: 'g1', topic: '바다'}];
  const distilled = [...Array.from({length: 12}, (_, i) => ({bookId: `k1-${i}`, topic: `k1 ${i}`, levelKo: 'K1', outline: {}})), ...Array.from({length: 12}, (_, i) => ({bookId: `k2-${i}`, topic: `k2 ${i}`, levelKo: 'K2', outline: {}}))];
  const data = {goldBooks: gold, distilledBooks: distilled};
  assert.equal(qualityReferenceBooks(data, '달', true, []).length, 25);
  const k1 = qualityReferenceBooks(data, '달', true, [], {levelKo: 'K1'});
  assert.equal(k1.length, 13);
  assert.ok(k1.filter(b => b.referenceSource === 'distilled').every(b => b.levelKo === 'K1'));
  assert.equal(qualityReferenceBooks(data, '달', true, [], {levelKo: 'K4'}).length, 25, 'too few of a level: keep all');
  assert.equal(qualityReferenceBooks(data, '달', false, [], {levelKo: 'K1'}).length, 1, 'examples off: gold only');
});

test('the editor read-through judges suspense and sound words on craft drafts', () => {
  assert.ok(REVISION_ASPECTS.includes('suspense') && REVISION_ASPECTS.includes('sound'));
  const craft = revisionRules(inputFor({ko: 'K1', en: 'E0'}), 12);
  assert.match(craft, /already tells the story's answer/);
  assert.match(craft, /sound refrain stays word for word/);
  assert.doesNotMatch(revisionRules(inputFor({policy: false}), 12), /story's answer|sound refrain/);
  assert.doesNotMatch(revisionRules(inputFor({ko: 'K3', en: 'E3'}), 12), /sound refrain stays/);
});

test('the shell precaches the module', async () => {
  const sw = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /"\.\/story-generation\/craft-rules\.js"/);
});
