import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {analyzeEstimatedPage} from '../dist/reading-checker.js';
import {withPageRhythm} from '../dist/page-rhythm.js';
import {withShortSentences, hasShortSentences, splitAtEllipsis, shortSentencePromptLine, SHORT_SENTENCES} from '../dist/short-sentences.js';
import {describeReadingViolation} from '../dist/reading-messages.js';
import {readFileSync} from 'node:fs';

/**
 * 2026-10-21 R31a K1 짧은 문장 규격. The golden K1 manuscript below (a
 * Dola-written draft, "쑥스러워요" spelling fixed) is what a K1 picture book
 * sounds like; the old K1 check blocked 4 of its 12 pages. Its numbers were
 * measured here, not taken from the author's own "self-check" (which claimed
 * 5.2 eojeol on average and ~200 eojeol; the text has 3.0 and 102).
 */
export const GOLDEN_K1 = Object.freeze([
  '오늘은 유치원 가는 날. 유하가 노란 모자를 써요. 분홍 가방도 메요.',
  '유하가 정류장에 섰어요. 두리번두리번. 노란 버스가 안 와요.',
  '부릉부릉! 띠리릭! 노란 스쿨버스가 왔어요. 버스가 웃고 있어요.',
  '유하가 버스에 올라타요. 빈자리에 앉아 창밖을 보아요.',
  '뒤에서 "안녕!" 해니가 왔어요. 초록 공룡 가방이 아주 커요.',
  '처음엔 쑥스러워요. 유하가 고개를 숙여요. 해니도 고개를 숙여요.',
  '유하가 창문에 손을 대요. 우와, 토끼 그림자! 해니가 까르륵 웃어요.',
  '까마귀도 하고, 강아지도 해요. 둘이서 손그림자 놀이!',
  '콩닥콩닥 손뼉 놀이. "하나, 둘, 셋!" 둘이서 같이 웃어요.',
  '띠리리릿! 유치원이 코앞. 아직 놀고 싶은데… 유하가 해니를 보아요.',
  '유하가 손을 내밀어요. "해니야, 같이 가자!" 해니가 손을 잡아요.',
  '둘이 손잡고 유치원에 들어가요. "내일도 같이 타요!"',
]);
const names = {language: 'ko', allowedNames: ['유하', '해니']};
const newK1 = () => withShortSentences(withPageRhythm({ko: getLevelSpec('K1'), en: getLevelSpec('E0')})).ko;

test('R31a the golden K1 manuscript passes the new K1 spec on every page (the old spec blocked 4)', () => {
  const spec = newK1();
  assert.ok(hasShortSentences(spec));
  GOLDEN_K1.forEach((text, i) => {
    const r = analyzeEstimatedPage(text, spec, names);
    const blocking = r.violations.filter((v) => /^sentence/u.test(v.code));
    assert.deepEqual(blocking, [], `${i + 1}쪽: ${blocking.map(describeReadingViolation).join(' / ')}`);
  });
  const old = getLevelSpec('K1');
  const failed = GOLDEN_K1.map((t, i) => (analyzeEstimatedPage(t, old, names).violations.some((v) => /^sentence/u.test(v.code)) ? i + 1 : 0)).filter(Boolean);
  assert.deepEqual(failed, [3, 5, 6, 10], 'the old spec (still used by every older draft and book) is unchanged');
});

test('R31a the registered golden file is this manuscript, with measured numbers only', () => {
  const gold = JSON.parse(readFileSync(new URL('../story-quality/gold/golden_k1_pages.json', import.meta.url), 'utf8'));
  assert.deepEqual(gold.pages.map((p) => p.ko), [...GOLDEN_K1]);
  assert.equal(gold.rubric, null, 'no self-reported score is kept');
  assert.deepEqual(gold.measured.oldK1CheckFailedPages, [3, 5, 6, 10]);
  assert.equal(gold.measured.eojeol, 102);
});

test('R31a the rules: rhythm lines (≤2 eojeol sound/exclamation/quote, ≤3 a page), page average 2.5–5, 1–4 ordinary sentences, the level maximum, the ellipsis', () => {
  const spec = newK1(), check = (t) => analyzeEstimatedPage(t, spec, names);
  const page3 = check('부릉부릉! 띠리릭! 노란 스쿨버스가 왔어요. 버스가 웃고 있어요.');
  assert.deepEqual(page3.metrics.rhythmSentenceIndices, [0, 1]);
  // A fourth rhythm line counts as an ordinary (very short) sentence.
  const many = check('쿵! 쾅! 우와! 와! 유하가 웃어요.');
  assert.deepEqual(many.metrics.rhythmSentenceIndices, [0, 1, 2]);
  assert.ok(many.violations.some((v) => v.code === 'sentence-average'), 'one-word ordinary sentence pulls the average under 2.5');
  // Page average too low.
  const low = check('유하가 와요. 해니도 와요. 둘이 웃어요.');
  assert.deepEqual(low.violations.map((v) => v.code), ['sentence-average']);
  assert.match(describeReadingViolation(low.violations[0]), /쪽 문장 평균 어절 2/u);
  // Too many ordinary sentences, a sentence over the level maximum.
  assert.ok(check('유하가 노란 버스를 타요. 해니가 초록 가방을 메요. 둘이 창밖을 봐요. 나무가 지나가요. 집도 지나가요.').violations.some((v) => v.code === 'sentence-count'));
  assert.ok(check('유하가 아주 커다란 노란 버스를 신나게 타요.').violations.some((v) => v.code === 'sentence-length'));
  // Only rhythm lines: no ordinary sentence.
  assert.ok(check('부릉부릉! 띠리릭!').violations.some((v) => v.code === 'sentence-count'));
  // The ellipsis ends a sentence only under the policy.
  assert.deepEqual(splitAtEllipsis(['아직 놀고 싶은데… 유하가 해니를 보아요.']), ['아직 놀고 싶은데…', '유하가 해니를 보아요.']);
  assert.equal(check('아직 놀고 싶은데… 유하가 해니를 보아요.').metrics.sentenceCount, 2);
  assert.equal(analyzeEstimatedPage('아직 놀고 싶은데… 유하가 해니를 보아요.', getLevelSpec('K1'), names).metrics.sentenceCount, 1);
});

test('R31a the policy is K1 Korean only, frozen as data, and named in the prompt', () => {
  const specs = withShortSentences(withPageRhythm({ko: getLevelSpec('K2'), en: getLevelSpec('E2')}));
  assert.equal(hasShortSentences(specs.ko), false);
  assert.equal(hasShortSentences(specs.en), false);
  assert.equal(shortSentencePromptLine(specs), '');
  const k1 = withShortSentences({ko: getLevelSpec('K1'), en: getLevelSpec('E0')});
  assert.deepEqual(k1.ko.shortSentences, JSON.parse(JSON.stringify(SHORT_SENTENCES)));
  assert.equal(k1.en.shortSentences, undefined);
  assert.match(shortSentencePromptLine(k1), /K1 SHORT LINES: rhythm lines of one or two eojeol/u);
  // An older K1 spec in a saved draft keeps the old metrics shape (no new key).
  assert.equal('rhythmSentenceIndices' in analyzeEstimatedPage(GOLDEN_K1[2], getLevelSpec('K1'), names).metrics, false);
});
