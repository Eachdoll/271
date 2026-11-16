// 15.73 BOM 트리에서 바로 고치기: 기준 수량·자재 소요량·사용 여부, 관리자만, 동시 수정 409, 자재 목록 고정, 진행 코멘트
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq73-'));
const { env, sqlite } = localEnvironment(dir, 'bq73-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://bq73.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client();
let wiper;
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'bq73-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'bq73-test' });
  wiper = (await admin('POST', '/api/boms', { product: 'CF-707 (5.5X4.5)', product_code: '10-005', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'PK', note: '1PK = 200SH', materials: [{ item: 'MAGNERA 8864_140MM', item_category: '원자재', qty: 22.86, unit: 'M' }, { item: '포장비닐', item_category: '부자재', qty: 1, unit: 'EA' }] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Quick edit changes base, material quantities and use flag, and leaves a comment', async () => {
  const before = b => ({ base_qty: b.base_qty, active: !!b.active, qty: b.materials.map(m => m.qty) });
  const send = (who, body) => who('POST', `/api/boms/${wiper.id}/quick`, { updated_at: wiper.updated_at, before: before(wiper), ...body });
  assert.equal((await send(staff, { base_qty: 2 })).status, 403, 'admin only');
  assert.equal((await send(admin, { materials: [{ item: 'MAGNERA 8864_140MM', qty: 0 }, { item: '포장비닐', qty: 1 }] })).status, 400);
  assert.equal((await send(admin, { materials: [{ item: '다른 자재', qty: 3 }, { item: '포장비닐', qty: 1 }] })).status, 409, 'material list must match');
  const r = await send(admin, { base_qty: 2, materials: [{ item: 'MAGNERA 8864_140MM', qty: 45.72 }, { item: '포장비닐', qty: 1 }], active: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.base_qty, r.body.materials.map(m => m.qty), r.body.materials[0].unit, r.body.note, r.body.active], [2, [45.72, 1], 'M', '1PK = 200SH', 1]);
  const comment = sqlite.prepare("SELECT content FROM progress_comments WHERE entity_type='bom' AND entity_id=? ORDER BY id DESC").get(wiper.id).content;
  assert.equal(comment, '[수정] 기준 수량 1 → 2 · MAGNERA 8864_140MM 소요량 22.86 → 45.72');
  assert.equal((await send(admin, { base_qty: 3 })).status, 409, 'values read before the last save are refused even within the same second');
  const off = await admin('POST', `/api/boms/${wiper.id}/quick`, { updated_at: r.body.updated_at, before: before(r.body), active: false });
  assert.equal(off.body.active, 0);
  const same = await admin('POST', `/api/boms/${wiper.id}/quick`, { updated_at: off.body.updated_at, before: before(off.body), active: false });
  assert.equal(same.status, 200, 'no change is a no-op');
});

test('Two quick edits in the same second do not overwrite each other', async () => {
  const fresh = (await admin('GET', '/api/boms?include_archived=1')).body.find(b => b.id === wiper.id);
  const original = env.DB;
  env.DB = { ...original, async batch(statements) { env.DB = original; sqlite.prepare("UPDATE boms SET materials=json_set(materials,'$[1].qty',9) WHERE id=?").run(wiper.id); return original.batch(statements); } };
  try { assert.equal((await admin('POST', `/api/boms/${wiper.id}/quick`, { updated_at: fresh.updated_at, before: { base_qty: fresh.base_qty, active: !!fresh.active, qty: fresh.materials.map(m => m.qty) }, base_qty: 5 })).status, 409); }
  finally { env.DB = original; }
  assert.equal(sqlite.prepare('SELECT base_qty FROM boms WHERE id=?').get(wiper.id).base_qty, fresh.base_qty);
});
