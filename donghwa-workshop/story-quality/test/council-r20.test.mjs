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
