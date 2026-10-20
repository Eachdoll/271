import { test } from 'node:test';
import assert from 'node:assert/strict';
const { curiosityCheck, retellCheck, runChildGate, CHILD_CURIOSITY_SYSTEM, CHILD_RETELL_SYSTEM } = await import('../dist/index.js');

/**
 * 2026-10-20 R20: the simulated child speaks at the book's reader age when the
 * app passes one; without it the 4세 system text is byte-identical.
 */
const answer = { json: { pages: [{ pageNo: 1, score: 2, childQuestion: '다음엔?', why: '' }], overall: 10, retell: ['a', 'b', 'c'], coveredBeats: [1, 2, 3], missingCore: [], confusions: [], coherence: 2 }, usage: { input: 1, output: 1 }, costUsd: 0 };
const engine = () => { const seen = []; return { seen, id: 'mock', complete: async (req) => { seen.push(req); return answer; } }; };
const beats = [{ index: 1, type: 'setup', summary: 's' }, { index: 2, type: 'turn', summary: 't' }, { index: 3, type: 'resolution', summary: 'r' }];

test('the child simulator takes an age; without one the system text is unchanged', async () => {
  const plain = engine();
  await curiosityCheck(plain, [{ pageNo: 1, text: '유하가 종을 울려요.' }]);
  await retellCheck(plain, '유하가 종을 울려요.', beats);
  assert.equal(plain.seen[0].system, CHILD_CURIOSITY_SYSTEM);
  assert.equal(plain.seen[1].system, CHILD_RETELL_SYSTEM);
  const aged = engine();
  await curiosityCheck(aged, [{ pageNo: 1, text: '유하가 종을 울려요.' }], { age: '5세' });
  await retellCheck(aged, '유하가 종을 울려요.', beats, { age: '5세' });
  assert.equal(aged.seen[0].system, CHILD_CURIOSITY_SYSTEM.replace('4세', '5세'));
  assert.match(aged.seen[0].system, /듣고 있는 5세 아이의 반응/u);
  assert.doesNotMatch(aged.seen[0].system, /4세/u);
  assert.equal(aged.seen[1].system, CHILD_RETELL_SYSTEM.replace('4세', '5세'));
  assert.match(aged.seen[1].system, /^너는 방금 이 이야기를 다 들은 5세 아이다\./u);
  assert.equal(aged.seen[0].user, plain.seen[0].user, 'only the age changes');
  const gate = engine();
  await runChildGate({ cheap: gate }, [{ pageNo: 1, text: '유하가 종을 울려요.' }], '유하가 종을 울려요.', { beats }, { age: '7세' });
  assert.ok(gate.seen.every((req) => /7세/u.test(req.system)));
  const legacyGate = engine();
  await runChildGate({ cheap: legacyGate }, [{ pageNo: 1, text: '유하가 종을 울려요.' }], '유하가 종을 울려요.', { beats });
  assert.deepEqual(legacyGate.seen.map((req) => req.system), [CHILD_CURIOSITY_SYSTEM, CHILD_RETELL_SYSTEM]);
});

// ---- R23: seed overrides from a settled story bible ----
test('R23 applySeedOverrides: the bible replaces the planted object and the twist, drops the humour beat and the sub-locations; the renderer leaves those lines out', async () => {
  const {applySeedOverrides, renderSeedForPrompt} = await import('../dist/composeSeed.js');
  const seed = {patternId: 'mystery_sound', planted: {ko: '치즈 조각', en: 'a cheese bit'}, obstacles: [{id: 'grass', ko: '풀숲', en: 'grass', sense: 'touch', sound: '사각사각'}], twist: {id: 'role_swap', ko: '역할 뒤바뀜', en: 'role swap', hint: '도움을 받으러 갔는데'}, creature: {ko: '올빼미', en: 'owl'}, humor: {ko: '거울에 혀', en: 'tongue'}, subLocations: [{ko: '방파제', en: 'pier'}], failureReasons: ['wrong_method'], rngSeed: 1};
  const inv = {failureReasons: [{id: 'wrong_method', ko: '잘못된 방법'}]};
  const pattern = {id: 'mystery_sound'};
  const same = applySeedOverrides(seed, null);
  assert.deepEqual(same, seed);
  const over = applySeedOverrides(seed, {planted: {ko: '빨간 장화', en: 'a red boot'}, twist: {id: 'bible', ko: '설계서의 반전 — 장화 속 종', en: 'the bible turn', hint: '아이가 보는 것: 종'}, humor: null, subLocations: []});
  assert.equal(over.planted.ko, '빨간 장화');
  assert.equal(over.twist.id, 'bible');
  assert.deepEqual(over.humor, {ko: '', en: ''});
  assert.deepEqual(over.subLocations, []);
  assert.equal(over.creature.ko, '올빼미', 'the creature and failure reasons stay random');
  assert.deepEqual(over.failureReasons, ['wrong_method']);
  const text = renderSeedForPrompt(over, inv, pattern);
  assert.equal(text, '- 심을 물건: 빨간 장화 — 비트 1~2에 자연스럽게 등장시키고 반전에서 회수한다\n- 반전 유형: 설계서의 반전 — 장화 속 종 (아이가 보는 것: 종)\n- 장소·장애물 후보: 1) 풀숲(사각사각)\n- 시도별 실패 이유: 1차 잘못된 방법\n- 배경 생물: 올빼미 (한 번 이상 등장)');
  assert.match(renderSeedForPrompt(seed, inv, pattern), /- 웃음 포인트: 거울에 혀\n- 세부 장소 후보: 방파제$/u, 'a plain seed renders every line as before');
  // Partial overrides keep the rest of the seed.
  const partial = applySeedOverrides(seed, {planted: {ko: '종'}});
  assert.deepEqual(partial.planted, {ko: '종', en: '종'});
  assert.equal(partial.humor.ko, '거울에 혀');
});
