import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, '..', p), 'utf8'));
const inv = read('data/inventories.json');
const patterns = read('data/plot_patterns.json');
const { retrieveExamples, renderExamplesForPrompt, buildOutlinePrompt, composeSeed, buildBanList, writeRichThenSimplify } = await import('../dist/index.js');

/**
 * 2026-10-20 R19 "이야기가 너무 가벼워": the reference examples showed only a
 * one-line beat list, so the model saw a skeleton but never how an example
 * earns its turn. The 'arc' style renders a story-spine card (stakes, rising
 * tries, the low point, the turn in full, what the reveal overturns, the echo
 * at the end); the default style is byte-identical to before.
 */
const P = patterns.find((p) => p.id === 'mystery_sound');
function book(id, topic, rubric, extra = {}) {
  const planted = '작은 종';
  return {
    bookId: id, topic, patternId: 'mystery_sound', levelKo: 'K2', levelEn: 'E1', approved: true, createdAt: '2026-10-17T00:00:00.000Z',
    ...(rubric === undefined ? {} : { feedback: { rubricTotal: rubric } }),
    outline: {
      plan: { pattern: 'mystery_sound', planted, twistReveal: '소리의 정체는 가방에서 떨어진 작은 종이었다. 바람이 아니라 물살이 흔든 것이다', funnyMoment: '재채기', failureReasons: ['wrong_method', 'wrong_place', 'interrupted'] },
      titleCandidates: ['a', 'b', 'c'], logline: `유하가 ${topic}을 찾는다`, want: '유하는 따르릉 소리가 무엇인지 알고 싶다', problem: '소리가 들렸다 말았다 한다',
      beats: [
        { index: 1, type: 'setup', summary: '거실에서 유하가 작은 종을 울려 보고 가방에 매단다. 터널이 반짝인다.', characters: ['유하'], settingKey: 'home' },
        { index: 2, type: 'want', summary: '밭에서 따르릉 소리가 난다. 유하는 소리를 찾기로 한다.', characters: ['유하'], settingKey: 'field' },
        { index: 3, type: 'attempt', summary: '유하가 꿀길로 뛰어간다. 발이 붙어 소리가 안 들린다.', characters: ['유하'], settingKey: 'field', failureReason: 'wrong_method' },
        { index: 4, type: 'attempt', summary: '풍차 꼭대기에 올라간다. 무당벌레만 있고 소리는 아래서 난다. 유하는 거의 포기할 뻔한다.', characters: ['유하'], settingKey: 'mill', failureReason: 'wrong_place' },
        { index: 5, type: 'turn', summary: '가방 고리가 비어 있다. 개울 돌 틈에 작은 종이 걸려 물살에 흔들릴 때마다 따르릉 울린다.', characters: ['유하'], settingKey: 'stream' },
        { index: 6, type: 'resolution', summary: '유하가 종을 꼭 짜서 품에 안고 길게 울려 본다. 아저씨가 대답한다.', characters: ['유하'], settingKey: 'stream' },
        { index: 7, type: 'close', summary: '집에 돌아온 밤, 유하는 종을 머리맡에 두고 살짝 한 번 울려 보고 잠든다.', characters: ['유하'], settingKey: 'home' },
      ],
      newWordsKo: [], newWordsEn: [], endingType: 'home_sleep',
    },
    usedElements: { planted, creatures: ['무당벌레'], twistTypeId: 'familiar_thing', patternId: 'mystery_sound', places: [] },
    ...extra,
  };
}

test('the arc style renders a story-spine card; the default style is unchanged', () => {
  const got = retrieveExamples([book('b1', '튤립 밭 종소리', 10)], { topic: '종소리', patternId: 'mystery_sound' }, 1);
  const plain = renderExamplesForPrompt(got);
  assert.match(plain, /^\[참고 예시 — 구조·리듬만 참고\. 인물·물건·사건·장소 재사용 금지\]\n예시 1 \(주제: 튤립 밭 종소리, 패턴: mystery_sound\)\n plan: 심은 물건 작은 종 \/ 반전 /u);
  assert.match(plain, /비트: 1 거실에서 유하가 작은 종을 울려 보고 가방에 매단다\. · 2 /u, 'first sentences only');
  assert.doesNotMatch(plain, /바닥\(/u);
  const arc = renderExamplesForPrompt(got, 1300, 'arc');
  assert.match(arc, /^\[참고 예시 — 뼈대만 참고: 바라는 것이 왜 중요한지, 시도가 어떻게 더 커지는지, 바닥에서 반전이 무엇을 뒤집는지, 끝이 처음을 어떻게 비추는지\. 인물·물건·사건·장소 재사용 금지\]/u);
  assert.match(arc, / 심은 물건: 작은 종\n 바라는 것: 유하는 따르릉 소리가 무엇인지 알고 싶다 \/ 걸림돌: 소리가 들렸다 말았다 한다\n/u);
  assert.match(arc, / 시도 사다리: 3 wrong_method: 유하가 꿀길로 뛰어간다\. → 4 wrong_place: 풍차 꼭대기에 올라간다\.\n/u);
  assert.match(arc, / 바닥\(마지막 시도 4\): 풍차 꼭대기에 올라간다\. 무당벌레만 있고 소리는 아래서 난다\. 유하는 거의 포기할 뻔한다\.\n/u, 'the low point beat in full');
  assert.match(arc, / 반전\(5\): 가방 고리가 비어 있다\. 개울 돌 틈에 작은 종이 걸려 물살에 흔들릴 때마다 따르릉 울린다\.\n/u, 'the turn in full');
  assert.match(arc, / 뒤집힌 뜻: 소리의 정체는 가방에서 떨어진 작은 종이었다\. 바람이 아니라 물살이 흔든 것이다\n 되돌아옴: 6 유하가 종을 꼭 짜서 품에 안고 길게 울려 본다\. · 7 집에 돌아온 밤, 유하는 종을 머리맡에 두고 살짝 한 번 울려 보고 잠든다\.$/u);
  assert.ok(renderExamplesForPrompt(got, 200, 'arc').endsWith('…'), 'a long card is cut at the cap');
  assert.equal(renderExamplesForPrompt([], 1300, 'arc'), '');
});

test('a rubric floor drops low-scored distilled examples but keeps unscored gold', () => {
  const books = [book('eight', '종소리 하나', 8), book('nine', '종소리 둘', 9), book('gold', '종소리 셋', undefined, { referenceSource: 'gold' })];
  const q = { topic: '종소리', patternId: 'mystery_sound', levelKo: 'K2' };
  assert.deepEqual(retrieveExamples(books, q, 3).map((g) => g.record.bookId).sort(), ['eight', 'gold', 'nine']);
  assert.deepEqual(retrieveExamples(books, q, 3, { minRubric: 9 }).map((g) => g.record.bookId).sort(), ['gold', 'nine']);
  assert.deepEqual(retrieveExamples(books, q, 3, {}).map((g) => g.record.bookId).sort(), ['eight', 'gold', 'nine'], 'no floor, no change');
});

test('buildOutlinePrompt renders arc cards only when asked; the default prompt is byte-identical', () => {
  const ban = buildBanList([], { windowBooks: 10, patternWindow: 3 });
  const seed = composeSeed({ pattern: P, inventories: inv, backgroundType: 'forest', rngSeed: 7, ban });
  const base = { protagonist: { name: '유하', traits: ['씩씩한'] }, supporting: [], worldCore: ['집'], topic: '종소리', levelKo: 'K2', levelEn: 'E1', pages: 12, pattern: P, seed, inventories: inv, ban, approvedBooks: [book('b1', '튤립 밭 종소리', 10), book('b2', '풍차 종소리', 8)], endingType: 'home_sleep' };
  const plain = buildOutlinePrompt(base), again = buildOutlinePrompt({ ...base, exampleStyle: undefined, exampleMinRubric: undefined });
  assert.equal(plain.user, again.user, 'undefined options change nothing');
  assert.match(plain.user, /\[참고 예시 — 구조·리듬만 참고/u);
  assert.match(plain.user, /예시 2 \(주제: 풍차 종소리/u);
  const arc = buildOutlinePrompt({ ...base, exampleStyle: 'arc', exampleMinRubric: 9 });
  assert.match(arc.user, /\[참고 예시 — 뼈대만 참고/u);
  assert.match(arc.user, /바닥\(마지막 시도 4\)/u);
  assert.doesNotMatch(arc.user, /풍차 종소리/u, 'the 8-point example is left out');
  assert.equal(arc.system, plain.system);
});

test('keepLines reaches the simplify, fix and condense calls and is absent otherwise', async () => {
  const level = { label: 'K2', sentencesPerPage: [2, 3], eojeolPerSentence: [5, 7] };
  const many = '[비트 1 · setup]\n' + Array.from({ length: 50 }, (_, i) => `유하가 ${i + 1}번째로 종을 울려요.`).join(' ');
  const seen = [];
  const engine = { id: 'mock', complete: async (req) => { seen.push(req); return { text: many, usage: { input: 1, output: 1 }, costUsd: 0 }; } };
  const base = { engine, lang: 'ko', charactersCompact: '유하', beatsCompact: '1 [setup] 시작', briefsCompact: '[]', emotions: [], gestureDict: { emotions: [], moral_tails_ko: [] }, targetLevel: level, richLevel: { label: 'K3', sentencesPerPage: [3, 4], eojeolPerSentence: [7, 10] }, pageCount: 12, condenseOverBudget: true };
  await writeRichThenSimplify(base);
  const plainCalls = seen.map((r) => ({ system: r.system, user: r.user }));
  assert.equal(seen.length, 3, 'rich, simplify, condense');
  assert.ok(plainCalls.every((t) => !/뼈대는 줄이지 않는다/u.test(t.system + t.user)));
  seen.length = 0;
  const keep = '- 뼈대는 줄이지 않는다: 반전 비트의 세 걸음.';
  await writeRichThenSimplify({ ...base, keepLines: keep });
  assert.equal(seen.length, 3);
  assert.doesNotMatch(seen[0].user, /뼈대는 줄이지 않는다/u, 'the rich draft has no keep lines');
  assert.match(seen[1].user, /\[반드시 지킬 것\][\s\S]*- 뼈대는 줄이지 않는다: 반전 비트의 세 걸음\.\n\n\[원문\]/u, 'the simplify call keeps the lines in its must-keep list');
  assert.match(seen[2].system, /\n- 뼈대는 줄이지 않는다: 반전 비트의 세 걸음\.$/u, 'the condense call carries them in its system text');
  // fill() drops a line whose only placeholder is empty, so the plain prompt has no line there.
  assert.equal(seen[1].user.replace(keep + '\n', ''), plainCalls[1].user, 'otherwise the simplify prompt is unchanged');
  assert.equal(seen[2].system.replace('\n' + keep, ''), plainCalls[2].system, 'otherwise the condense system text is unchanged');
});
