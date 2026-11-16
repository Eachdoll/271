// 15.64 품목(제품코드) 완전 삭제: 어디에도 쓰이지 않은 품목만 지우고, 쓰이는 품목은 사용처를 알려 준다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bomdel-'));
const { env, sqlite } = localEnvironment(dir, 'bomdel-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://bomdel.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client();
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'bomdel-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'bomdel-test' });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const makeBom = (product, code, extra = {}) => admin('POST', '/api/boms', { product, product_code: code, item_category: '부자재', kind: 'finished', base_qty: 1, unit: 'EA', materials: [], ...extra }).then(r => r.body);
const all = async () => (await admin('GET', '/api/boms?include_archived=1&temp=1')).body;

test('An unused product code is deleted for good; only administrators can', async () => {
  const bom = await makeBom('안쓰는 품목', 'UNUSED-1');
  assert.deepEqual((await admin('GET', `/api/boms/${bom.id}/usage`)).body, { uses: [], total: 0 });
  assert.equal((await staff('DELETE', `/api/boms/${bom.id}?purge=1`)).status, 403);
  assert.equal((await staff('GET', `/api/boms/${bom.id}/usage`)).status, 403);
  const del = await admin('DELETE', `/api/boms/${bom.id}?purge=1`);
  assert.equal(del.status, 200, JSON.stringify(del.body)); assert.equal(del.body.deleted, true);
  assert.ok(!(await all()).some(b => b.id === bom.id));
});

test('A product code used by records is not deleted; the reason lists where, and plain DELETE still only deactivates', async () => {
  const bom = await makeBom('쓰는 품목', 'USED-1');
  assert.equal((await admin('POST', '/api/po', { req_no: 'R1', vendor: '공급사', item: '쓰는 품목', bom_id: bom.id, qty: 3, due_date: '2026-12-01', item_category: '부자재' })).status, 200);
  const usage = (await admin('GET', `/api/boms/${bom.id}/usage`)).body;
  assert.deepEqual(usage.uses, [{ label: '발주', count: 1 }]);
  const refused = await admin('DELETE', `/api/boms/${bom.id}?purge=1`);
  assert.equal(refused.status, 409); assert.match(refused.body.error, /발주 1건/);
  assert.equal((await admin('DELETE', `/api/boms/${bom.id}`)).status, 200);
  assert.ok(!(await all()).find(b => b.id === bom.id).active, 'deactivated, not deleted');
  // 다른 제품의 구성자재로 쓰여도 막는다
  const part = await makeBom('구성 자재', 'PART-1');
  await makeBom('완제품', 'FIN-1', { item_category: '제품', materials: [{ item: '구성 자재', item_category: '부자재', qty: 1, unit: 'EA' }] });
  assert.deepEqual((await admin('GET', `/api/boms/${part.id}/usage`)).body.uses, [{ label: '다른 제품의 구성자재', count: 1 }]);
  assert.equal((await admin('DELETE', `/api/boms/${part.id}?purge=1`)).status, 409);
});

test('A temporary code can be deleted after it is merged into a formal item', async () => {
  const formal = await makeBom('정식 장갑', 'GL-001');
  await admin('POST', '/api/po', { req_no: 'R2', vendor: '공급사', item: '임시로 친 장갑', qty: 2, due_date: '2026-12-01', item_category: '부자재' });
  const temp = (await all()).find(b => b.is_temp && b.product === '임시로 친 장갑');
  assert.ok(temp && /^TMP-/.test(temp.product_code));
  assert.equal((await admin('DELETE', `/api/boms/${temp.id}?purge=1`)).status, 409, 'still used by the order');
  assert.equal((await admin('POST', `/api/boms/${temp.id}/merge`, { target_id: formal.id })).status, 200);
  assert.equal((await admin('GET', `/api/boms/${temp.id}/usage`)).body.total, 0, 'the order now points at the formal item');
  assert.equal((await admin('DELETE', `/api/boms/${temp.id}?purge=1`)).status, 200);
  assert.ok(!(await all()).some(b => b.id === temp.id));
  assert.equal((await admin('GET', '/api/po')).body.find(p => p.req_no === 'R2').product_code, 'GL-001');
});
