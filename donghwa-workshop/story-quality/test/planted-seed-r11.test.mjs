import test from 'node:test';
import assert from 'node:assert/strict';
import { plantedFromSeed } from '../dist/pipeline.js';
import { plotCheck } from '../dist/plotCheck.js';

const seed = { planted: { ko: '엄마의 커다란 무늬 모자' } };
const outline = (planted) => ({ plan: { planted }, beats: [] });

test('a planted sentence that contains the seed material becomes the seed material', () => {
  const sentence = '엄마의 커다란 무늬 모자는 안쪽 띠가 좁다. 초록이는 떨어진 잎을 담으려고 모자를 빌린다.';
  assert.equal(plantedFromSeed(outline(sentence), seed).plan.planted, '엄마의 커다란 무늬 모자');
  assert.equal(plantedFromSeed(outline('엄마의 커다란 무늬 모자: 안쪽 띠가 좁아요'), seed).plan.planted, '엄마의 커다란 무늬 모자');
  // The same object, unchanged object, other object and missing values are left alone.
  const same = outline('엄마의 커다란 무늬 모자');
  assert.equal(plantedFromSeed(same, seed), same);
  assert.equal(plantedFromSeed(outline('빨간 우산'), seed).plan.planted, '빨간 우산');
  assert.equal(plantedFromSeed(outline(''), seed).plan.planted, '');
  assert.equal(plantedFromSeed(outline(sentence), undefined).plan.planted, sentence);
});

test('after normalisation the turn beat that names the hat recovers the planted object', () => {
  const sentence = '엄마의 커다란 무늬 모자는 안쪽 띠가 좁다. 초록이는 떨어진 잎을 담으려고 모자를 빌린다.';
  const beats = [
    { index: 1, type: 'setup', summary: '유하가 엄마의 커다란 무늬 모자를 들고 소풍을 가요.' },
    { index: 2, type: 'want', summary: '초록이가 잎을 모으고 싶어 해요.' },
    { index: 3, type: 'turn', summary: '유하가 모자를 뒤집어 잎을 담아요.' },
  ];
  const before = plotCheck({ outline: { plan: { planted: sentence }, beats }, topic: '공룡 친구와 소풍', protagonistName: '유하' });
  assert.ok(before.fix.some((m) => /반전 비트에서 회수되지 않음/.test(m)), 'the old sentence form fails the payoff check');
  const after = plotCheck({ outline: plantedFromSeed({ plan: { planted: sentence }, beats }, seed), topic: '공룡 친구와 소풍', protagonistName: '유하' });
  assert.ok(!after.fix.some((m) => /회수되지 않음|비트 1~2에 없음|plan.planted/.test(m)), after.fix.join(' / '));
});
