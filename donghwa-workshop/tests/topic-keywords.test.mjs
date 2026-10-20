import test from 'node:test';
import assert from 'node:assert/strict';
import {storyTopicKeywords, inspectOutlineRules} from '../dist/story-generation/pipeline.js';
import {hardOutlineViolations} from '../dist/story-generation/schemas.js';

/**
 * 2026-10-20 production: "이야기 outline 결과를 확인해 주세요: 비트에 주제 키워드 ‘달에’가
 * 없어요. / ‘놀러’ / ‘간’ / ‘날’". The topic "달에 놀러 간 날" was cut into a
 * particle-bearing noun, a verb, an adnominal and a time word; an outline about
 * 달나라 matched none of them, "no topic word at all" is a hard stop, and
 * 다시 시도 replayed the same answer into the same stop.
 */
test('Korean topics give nouns only: particles by sound, no predicates, no time words', () => {
  const cases = {
    '달에 놀러 간 날': ['달'],
    '바닷가에서 조개 줍는 날': ['바닷가', '조개'],
    '비 오는 날 우산 쓰고 산책': ['비', '우산', '산책'],
    '눈사람 만들러 간 날': ['눈사람'],
    '우주로 날아간 고양이': ['우주', '고양이'],
    '잃어버린 장갑 한 짝을 찾는 날': ['장갑'],
    '텃밭에 처음 심은 방울토마토': ['텃밭', '방울토마토'],
    '기린의 긴 목': ['기린'],
    '사과를 따는 날': ['사과'],
    '고양이가 잃어버린 공': ['고양이', '공'],
    '공룡 친구와 소풍': ['공룡', '소풍'],
    '친구와 작은 우산을 찾아요': ['우산'],
    '바람 피리 찾기': ['바람', '피리', '찾기'],
  };
  for (const [topic, expected] of Object.entries(cases)) assert.deepEqual(storyTopicKeywords(topic), expected, topic);
});

test('an outline about 달나라 passes "달에 놀러 간 날"; one with no moon at all still stops', () => {
  const source = {topic: '달에 놀러 간 날', characters: [{id: 'yuha', name: '유하'}], backgrounds: []};
  const beats = summaries => ({beats: summaries.map((summary, i) => ({index: i + 1, summary}))});
  const moon = inspectOutlineRules(beats(['유하가 창밖의 둥근 달빛을 봐요.', '유하가 달나라로 가는 사다리를 찾아요.', '유하가 달에서 토끼를 만나요.']), source);
  assert.ok(!moon.violations.some(v => v.code === 'topic_keyword_missing'), JSON.stringify(moon.violations));
  const none = inspectOutlineRules(beats(['유하가 집에서 그림을 그려요.', '유하가 정원에서 꽃을 봐요.']), source);
  const missing = none.violations.filter(v => v.code === 'topic_keyword_missing');
  assert.deepEqual(missing.map(v => v.keyword), ['달']);
  assert.equal(hardOutlineViolations({violations: missing}).length, 1, 'a story with no moon is still off topic');
});

test('compound nouns and particles after a one-syllable topic count; unrelated words starting with it do not', () => {
  const source = {topic: '달에 놀러 간 날', characters: [], backgrounds: []};
  const has = summary => !inspectOutlineRules({beats: [{index: 1, summary}]}, source).violations.some(v => v.code === 'topic_keyword_missing');
  for (const summary of ['달나라에 가요.', '달빛이 비쳐요.', '달님이 웃어요.', '달을 봐요.', '달에서 놀아요.']) assert.ok(has(summary), summary);
  for (const summary of ['유하가 달려요.', '사탕이 달콤해요.', '달걀을 깨요.']) assert.ok(!has(summary), summary);
});
