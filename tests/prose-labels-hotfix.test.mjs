import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateQualityProse} from '../dist/story-generation/quality-adapter.js';
import {assertValid} from '../dist/story-generation/schemas.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {getLevelSpec} from '../dist/reading-levels.js';
import * as qualityModule from '../story-quality/dist/pipeline.js';

/**
 * 2026-10-19 hotfix 4, Codex report §5-4: a quality-path prose answer wrapped in
 * a code fence, with '[비트1]' (no space) or '**[Beat 1 · type]**' labels, is
 * ordinary labeled text. The labels are stripped as before and no sentence
 * changes; missing labels or paragraphs still stop the stage.
 */
const read = async file => JSON.parse(await readFile(new URL(`../story-quality/data/${file}.json`, import.meta.url), 'utf8'));
const goldPart = async part => JSON.parse(await readFile(new URL(`../story-quality/gold/gold_outlines_part${part}.json`, import.meta.url), 'utf8'));
const DATA = {inventories: await read('inventories'), gestureDictionary: await read('gesture_dictionary'), plotPatterns: await read('plot_patterns'), worldLibrary: await read('worlds'), goldBooks: [...await goldPart(1), ...await goldPart(2)]};
const CAST = [{id: 'yuha', name: '유하', nameEn: 'Yuha', traits: ['관찰하는 아이']}, {id: 'green', name: '그린이', nameEn: 'Green', traits: ['느긋한 친구']}];
const PLACES = [{id: 'home', type: 'home', name: '유하의 집'}, {id: 'garden', name: '꽃 정원'}, {id: 'pond', name: '연못 길'}];
const input = normalizeStoryInput({bookId: 'labels-hotfix', topic: '비 오는 날', characters: CAST, backgrounds: PLACES, pageCount: 16, endingType: 'home_sleep', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, storyQuality: {enabled: true, useBeamSearch: false, twoPass: true, childSimulator: false}});
const outline = (() => {
  const types = ['setup', 'want', 'attempt', 'attempt', 'attempt', 'turn', 'resolution', 'close'];
  const base = demoOutline(input);
  return {...base, beats: base.beats.map((beat, i) => ({...beat, type: types[i]})), refrain: null};
})();
const services = () => ({engineFor: async options => options.engine, qualityData: DATA, qualityModule: async () => qualityModule, baseSystem: 'APP_BASE_RULES', levelRules: () => 'FROZEN_LEVEL_SPECS', assertValid, normalizeStoryInput});
const koBeat = (n, i) => Array.from({length: n}, (_, k) => `유하가 작은 잎을 ${i}번 만져요${k ? ` 그리고 ${k}번 더 만져요` : ''}.`).join(' ');
const enBeat = (n, i) => Array.from({length: n}, (_, k) => `Yuha sees a small leaf ${i} times${k ? ` and ${k} more` : ''}.`).join(' ');
/** rich/simplify answers in the three wrappings the parser now accepts (shape per call). */
function engine(shape) {
  const calls = [];
  return {id: 'openai', calls, async complete(request) {
    const lang = /return English plain/u.test(request.system) ? 'en' : 'ko';
    const outlineJson = JSON.parse(request.user.match(/FROZEN_APPROVED_OUTLINE_JSON: (.*)\n/u)[1]);
    const n = calls.push({lang, request});
    const label = beat => shape(lang, beat, n);
    const body = outlineJson.beats.map(beat => `${label(beat)} ${(lang === 'ko' ? koBeat : enBeat)(lang === 'ko' ? 5 : 3, beat.index)}`).join('\n\n');
    const text = shape.fence && lang === 'ko' ? `\`\`\`text\n${body}\n\`\`\`` : body;
    return {text, usage: {input: 10, output: 5}, meta: {requests: 1}};
  }};
}

test('a fenced answer, [비트1] without a space and **[Beat 1 · type]** parse to the same prose as the plain labels', async () => {
  const plainShape = (lang, beat) => lang === 'ko' ? `[비트 ${beat.index} · ${beat.type}]` : `[Beat ${beat.index} · ${beat.type}]`;
  const plain = await generateQualityProse(outline, input, {engine: engine(plainShape)}, services());
  const oddShape = Object.assign((lang, beat) => lang === 'ko' ? `[비트${beat.index}·${beat.type}]` : `**[Beat ${beat.index} · ${beat.type}]**`, {fence: true});
  const odd = await generateQualityProse(outline, input, {engine: engine(oddShape)}, services());
  assert.equal(odd.data.ko, plain.data.ko);
  assert.equal(odd.data.en, plain.data.en);
  assert.deepEqual(odd.data.paragraphBeats, plain.data.paragraphBeats);
  assert.deepEqual(odd.data.paragraphBeats.ko, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.doesNotMatch(odd.data.ko, /```|\[비트/u);
  assert.doesNotMatch(odd.data.en, /\*\*|\[Beat/u);
  assert.match(plain.data.ko, /^유하가 작은 잎을 1번 만져요\./u);
});

test('a label missing from one beat still stops the stage; nothing is guessed', async () => {
  const dropShape = (lang, beat) => beat.index === 3 ? '' : lang === 'ko' ? `[비트 ${beat.index} · ${beat.type}]` : `[Beat ${beat.index} · ${beat.type}]`;
  await assert.rejects(generateQualityProse(outline, input, {engine: engine(dropShape)}, services()), e => e.name === 'StoryValidationError' && /비트 라벨|승인 비트/u.test(e.message));
});
