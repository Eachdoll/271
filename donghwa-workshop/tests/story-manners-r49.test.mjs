import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, outlineRequestSchema} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanBeatWriterRules, leanProseRules, leanVisibleInput, leanSceneBriefRules} from '../dist/story-generation/prompt-diet.js';
import {inspectSceneBriefs, SCENE_BRIEFS_SCHEMA} from '../dist/story-generation/scene-briefs.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {storyDramaViolations} from '../dist/story-generation/story-drama.js';
import {approvedBookRecord} from '../dist/story-generation/quality-gates.js';
import {ROOM_ANGLES} from '../dist/story-generation/idea-deck.js';
import {mannersPolicy, mannersRef, hasStoryManners, recentHumorLines, outsideAdults, speechLevelLine, humorWriterLine, mannersBriefRule, mannersSecretRule} from '../dist/story-generation/story-manners.js';

/**
 * R49 (2026-10-31). The parent on a finished K2 book set in a hair salon:
 * "보라 is a grown-up — why does she talk down to everyone? What does 'the
 * curls were hiding' mean? And the nose-huge-in-the-mirror gag is in every
 * book." Nothing said who speaks politely; R39 required a secret of every
 * non-K1 outline and the adventure turn asked for a hidden thing revealed;
 * the scene briefs required a humor line per beat. A new diet draft freezes
 * input.storyManners; the writers hear the speech levels and that a laugh
 * comes only from what happens (never a stock gag, never a recent book's);
 * the outline is asked for a secret only when there is one; a beat's humor
 * may be "". Drafts without the marker are unchanged.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '뽀글머리', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const BORA = {id: 'bora', name: '보라', nameEn: 'Bora', role: '친구', kind: 'adult', traits: ['친절함']};
const draft = (state, extra = {}) => normalizeStoryInput({...inputFromWizard(state, wizard, {layout: 'openings'}).input, bookId: 'r49', ...extra});

test('R49 the marker: frozen on new drafts with the recent laughs, kept by normalize (deduped, capped), never sent as data; drafts without it read nothing', () => {
  const state = setup(), input = draft(state);
  assert.deepEqual(input.storyManners, {version: 1});
  assert.ok(hasStoryManners(input));
  assert.equal(hasStoryManners({storyManners: {version: 1}}), false, 'the diet only');
  assert.doesNotMatch(JSON.stringify(leanVisibleInput(input, 'outline')), /storyManners|recentHumor/);
  assert.deepEqual(mannersRef({version: 1, recentHumor: [' a ', 'a', 'b', '', 3]}), {version: 1, recentHumor: ['a', 'b']});
  assert.equal(mannersRef({version: 2}), null);
  assert.deepEqual(normalizeStoryInput({...input, storyManners: {version: 1, recentHumor: ['코가 커다랗게']}}).storyManners, {version: 1, recentHumor: ['코가 커다랗게']});
  assert.equal(normalizeStoryInput({...input, storyManners: {version: 7}}).storyManners, undefined);
  assert.deepEqual(mannersPolicy(Array.from({length: 12}, (_, i) => `laugh ${i}`)).recentHumor.length, 8);
  // The recent laughs come from the approved books' records (three newest).
  const records = [{usedElements: {humor: ['거울에 코만 커다래요', '재채기']}}, {usedElements: {}}, {usedElements: {humor: ['모자가 날아가요']}}, {usedElements: {humor: ['네 번째 책']}}];
  assert.deepEqual(recentHumorLines(records), ['거울에 코만 커다래요', '재채기', '모자가 날아가요']);
  const bare = {...input}; delete bare.storyManners;
  for (const fn of [speechLevelLine, humorWriterLine, mannersBriefRule, mannersSecretRule]) assert.equal(fn(bare), '');
});

test('R49 who speaks politely: an adult outside the family by name, the family adults not; the writers (beat, prose, K1, eco) hear it with the laugh line', () => {
  const state = setup(), input = draft(state, {characters: [...draft(state).characters, BORA]});
  assert.deepEqual(outsideAdults(input).map((c) => c.id), ['bora'], '엄마 (가족) is not one');
  assert.equal(speechLevelLine(input, 'ko'), "[말높임] 가족·친구끼리는 반말이에요. 보라(친구)는 가족이 아닌 어른이라 손님과 다른 어른에게 존댓말('~세요', '~예요')로 말하고, 아이들도 보라에게는 존댓말을 써요.");
  assert.match(speechLevelLine(input, 'en'), /^Speech levels: family and friends speak casually; Bora \(an adult outside the family\) speaks politely/);
  assert.match(speechLevelLine(draft(state), 'ko'), /^\[말높임\] 가족·친구끼리는 반말이에요\. 가족이 아닌 어른\(가게·미용실·선생님\)은/);
  assert.equal(humorWriterLine(input, 'ko'), '[웃음] 웃음은 이 이야기에서 벌어지는 일에서만 나와요. 어느 책에나 넣을 수 있는 흔한 개그(거울이나 숟가락에 코만 커다랗게 비치기)는 쓰지 않아요. 웃길 일이 없는 쪽은 웃기려 하지 않아요.');
  const recent = {...input, storyManners: mannersPolicy(['거울에 코만 커다래요'])};
  assert.match(humorWriterLine(recent, 'ko'), /최근 책에서 이미 쓴 웃음: "거울에 코만 커다래요" — 다시 쓰지 않아요\.$/);
  assert.match(humorWriterLine(recent, 'en'), /Not these, already in the family's recent books: "거울에 코만 커다래요"\.$/);
  const w = leanBeatWriterRules(recent, {beats: []});
  assert.ok(w.ko.includes(speechLevelLine(recent, 'ko')) && w.ko.includes(humorWriterLine(recent, 'ko')));
  assert.ok(w.en.includes(speechLevelLine(recent, 'en')) && w.en.includes(humorWriterLine(recent, 'en')));
  assert.ok(leanProseRules(recent).includes(`\n${speechLevelLine(recent, 'ko')}\n${speechLevelLine(recent, 'en')}\n${humorWriterLine(recent, 'ko')}\n${humorWriterLine(recent, 'en')}`));
  const bare = {...recent}; delete bare.storyManners;
  assert.doesNotMatch(leanBeatWriterRules(bare, {beats: []}).ko, /말높임|\[웃음\]/);
  for (const file of ['../dist/story-generation/k1-book.js', '../dist/eco-mode.js']) assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /speechLevelLine\(input, "ko"\)[\s\S]*humorWriterLine\(input, "ko"\)/);
});

test('R49 a secret only when there is one; a beat with nothing funny; the adventure turn does not hide what cannot hide; the record keeps the laughs', () => {
  const state = setup(), input = draft(state);
  const rules = leanOutlineRules(input, {count: 8, attempts: 3});
  assert.match(rules, /Return secret only when the story really has one[^\n]*never make something that cannot hide \(someone's own hair, a feeling\) the secret\./);
  assert.doesNotMatch(rules, /Return secret: one thing/);
  assert.equal(outlineRequestSchema(input).properties.secret.minLength, undefined);
  assert.ok(outlineRequestSchema(input).properties.secret);
  const outline = demoOutline(input);
  assert.deepEqual(storyDramaViolations({...outline, secret: ''}, input), []);
  const bare = {...input}; delete bare.storyManners;
  assert.ok(storyDramaViolations({...outline, secret: ''}, bare).some((v) => v.code === 'secret_missing'), 'drafts without the marker keep R39');
  // The briefs: humor "" passes on a manners draft only; the rule says so.
  assert.match(leanSceneBriefRules(input), /humor is this beat's own laugh only when the story has one[^\n]*"" on a beat with nothing funny\.$/);
  assert.doesNotMatch(leanSceneBriefRules(bare), /only when the story has one/);
  assert.match(leanSceneBriefRules({...input, storyManners: mannersPolicy(['재채기'])}), /Not these, used in the family's recent books: "재채기"\.$/);
  const briefs = outline.beats.map((b) => ({beatIndex: b.index, timeOfDay: 'morning', weather: {ko: '맑음', en: 'clear'}, light: {ko: '햇빛', en: 'sunlight'}, sounds: [{ko: '싹둑', en: 'snip'}, {ko: '웅', en: 'hum'}], smellOrTouch: {ko: '보들', en: 'soft'}, props: [{ko: '가위', en: 'scissors'}, {ko: '빗', en: 'comb'}, {ko: '망토', en: 'cape'}], creature: {ko: '참새', en: 'a sparrow'}, pose: {ko: '앉아요', en: 'sits in the chair'}, dialogueLine: '"다 됐어요?"', humor: ''}));
  assert.deepEqual(inspectSceneBriefs(briefs, outline, input).issues.filter((i) => /humor/.test(i.message)), []);
  assert.ok(inspectSceneBriefs(briefs, outline, bare).issues.some((i) => /humor를 한글로/.test(i.message)));
  assert.ok(inspectSceneBriefs(briefs.map((b) => ({...b, humor: 7})), outline, input).issues.some((i) => /humor를 한글로/.test(i.message)), 'a number is not an empty laugh');
  assert.equal(SCENE_BRIEFS_SCHEMA.properties.briefs.items.properties.humor.minLength, 1, 'the shared schema is untouched; the request clones it');
  assert.match(ROOM_ANGLES.adventure.turn, /주제에 정체가 드러날 것이 없으면 막힌 길이 다른 방법으로 열리는 반전으로 한다\(숨을 수 없는 것을 숨어 있던 것으로 만들지 않는다\)/);
  // The approved record keeps the laughs the book used (none → no key).
  const book = {id: 'b', approved: true, approvedAt: '2026-10-31T00:00:00.000Z', topic: '뽀글머리', outline, sceneBriefs: briefs.map((b, i) => ({...b, humor: i === 1 ? '망토가 펄럭 날아가요' : ''})), pages: []};
  assert.deepEqual(approvedBookRecord(book)?.usedElements.humor, ['망토가 펄럭 날아가요']);
  assert.equal('humor' in (approvedBookRecord({...book, sceneBriefs: briefs})?.usedElements || {}), false);
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v99";/);
  assert.match(sw, /"\.\/story-generation\/story-manners\.js",/);
});
