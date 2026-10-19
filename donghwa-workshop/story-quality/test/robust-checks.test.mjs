import test from 'node:test';
import assert from 'node:assert/strict';
import { plotCheck, normalizeFailureReason } from '../dist/plotCheck.js';

const outline = (summary, extra = {}) => ({ beats: [{ index: 1, type: 'setup', summary, newElement: '단추' }], ...extra });
const forbidden = (summary, legacyChecks) =>
  plotCheck({ outline: outline(summary), topic: '꿀벌', protagonistName: '유하', inventories: { forbiddenKeywords: ['벌을 주', '총으로', '때리', '쫓아와', '칼로', '괴물'] }, legacyChecks }).regenerate.filter((m) => m.startsWith('금지 소재'));

test('forbidden words match at a word start only, everyday contexts pass, real hits stay; legacyChecks keeps the old substring test', () => {
  for (const s of ['꿀벌을 주머니에 넣어요.', '물총으로 물을 뿌려요.', '빗방울이 창문을 톡톡 때리는 소리가 나요.', '강아지가 꼬리를 흔들며 쫓아와요.', '엄마가 칼로 사과를 잘라요.']) {
    assert.deepEqual(forbidden(s, false), [], s);
    assert.equal(forbidden(s, true).length, 1, `legacy: ${s}`);
  }
  for (const s of ['선생님이 벌을 주었어요.', '유하가 친구를 때리고 울어요.', '늑대가 쫓아와요.', '도둑이 칼로 위협해요.', '괴물이 나타나요.']) assert.equal(forbidden(s, false).length, 1, s);
});

test('failure reasons in other spellings normalize to ids; legacy keeps the old patterns', () => {
  assert.equal(normalizeFailureReason('Wrong Place'), 'wrong_place');
  assert.equal(normalizeFailureReason('wrong-method'), 'wrong_method');
  assert.equal(normalizeFailureReason('엉뚱한 곳을 찾았어요'), 'wrong_place');
  assert.equal(normalizeFailureReason('방법이 맞지 않아요'), 'wrong_method');
  assert.equal(normalizeFailureReason('거의 성공했는데 바람이 불어요'), 'interrupted');
  assert.equal(normalizeFailureReason('Wrong Place', true), 'Wrong Place');
  assert.equal(normalizeFailureReason('거의 됐는데 방해: 바람', true), 'interrupted');
});

test('a one-syllable topic noun at a word start counts as the topic ("달에 놀러 간 날", "비 오는 날의 모험"); legacy keeps the old keyword test', () => {
  const regen = (topic, summary, legacyChecks) => plotCheck({ outline: outline(summary), topic, protagonistName: '유하', legacyChecks }).regenerate.filter((m) => m.startsWith('주제 키워드'));
  assert.deepEqual(regen('달에 놀러 간 날', '유하가 달나라에 도착해요.', false), []);
  assert.deepEqual(regen('비 오는 날의 모험', '유하가 비를 맞으며 걸어요.', false), []);
  assert.equal(regen('비 오는 날의 모험', '유하가 비를 맞으며 걸어요.', true).length, 1);
  assert.equal(regen('비 오는 날의 모험', '유하가 집에서 블록을 쌓아요.', false).length, 1);
});
