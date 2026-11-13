import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-bom-photos-'));
const { env, sqlite } = localEnvironment(dir, 'bom-photos');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const files = () => fs.readdirSync(path.join(dir, 'uploads')).sort();
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const response = await worker.fetch(new Request('https://bom.test' + url, {
      method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json().catch(() => null) };
  };
}
const admin = client(), owner = client(), other = client(), anon = client();
let bom, plan;
const bomBody = { product: '완제품 A', product_code: 'A-001', kind: 'finished', base_qty: 10, unit: 'EA', materials: [{ item: '원단', item_category: '원자재', qty: 2, unit: 'kg' }, { item: '포장재', item_category: '부자재', qty: 0.5, unit: 'BOX' }] };
before(async () => {
  for (const [user, name] of [[admin, 'BOM관리자'], [owner, '담당자'], [other, '다른사용자']]) assert.equal((await user('POST', '/api/auth/register', { name, password: 'test-password', invite: 'bom-photos' })).status, 200);
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Only administrators maintain BOMs; all signed-in staff can select active BOMs', async () => {
  assert.equal((await anon('GET', '/api/boms')).status, 401);
  assert.equal((await owner('POST', '/api/boms', bomBody)).status, 403);
  for (const invalid of [{ base_qty: 0 }, { materials: [] }, { materials: [null] }, { materials: [{ item: '원단', item_category: '원자재', qty: -1, unit: 'kg' }] }]) assert.equal((await admin('POST', '/api/boms', { ...bomBody, ...invalid })).status, 400);
  const result = await admin('POST', '/api/boms', bomBody); assert.equal(result.status, 200); bom = result.body;
  assert.equal(bom.materials.length, 2);
  assert.equal((await owner('GET', '/api/boms?kind=finished')).body[0].id, bom.id);
  assert.equal((await owner('GET', '/api/boms?include_archived=1')).status, 403);
  assert.equal((await owner('PUT', '/api/boms/' + bom.id, bomBody)).status, 403);
  assert.equal((await owner('DELETE', '/api/boms/' + bom.id)).status, 403);
});

test('Production plans derive quantities on the server and retain their BOM snapshot', async () => {
  const body = { kind: 'finished', period: 'day', start_date: '2026-11-13', qty: 25, bom_id: bom.id, product: 'forged product', bom_snapshot: { requirements: [] } };
  const result = await owner('POST', '/api/schedules', body); assert.equal(result.status, 200); plan = result.body;
  assert.equal(plan.product, '완제품 A'); assert.equal(plan.bom_snapshot.requirements[0].qty, 5); assert.equal(plan.bom_snapshot.requirements[1].qty, 1.25);
  assert.equal((await owner('POST', '/api/schedules', { ...body, kind: 'semi' })).status, 400);
  assert.equal((await admin('PUT', '/api/boms/' + bom.id, { ...bomBody, product: '변경한 제품', base_qty: 1 })).status, 200);
  assert.equal((await admin('DELETE', '/api/boms/' + bom.id)).status, 200);
  assert.equal((await owner('GET', '/api/boms')).body.length, 0);
  assert.equal((await owner('POST', '/api/schedules', body)).status, 400);
  const changed = await owner('PUT', '/api/schedules/' + plan.id, { ...body, qty: 50 });
  assert.equal(changed.body.product, '완제품 A'); assert.equal(changed.body.bom_snapshot.base_qty, 10); assert.equal(changed.body.bom_snapshot.requirements[0].qty, 10);
  const list = (await owner('GET', '/api/schedules?kind=finished&from=2026-11-13&to=2026-11-13')).body;
  assert.equal(list[0].bom_snapshot.requirements[1].qty, 2.5);
  assert.equal((await other('PUT', '/api/schedules/' + plan.id, { toggle_done: true })).status, 403);
  assert.equal((await admin('GET', '/api/boms?include_archived=1')).body[0].active, 0);
});

test('Development and sample attachments enforce the existing request ownership and status rules', async () => {
  for (const type of ['development', 'sample']) {
    const row = (await owner('POST', '/api/requests', { type, title: type + ' 사진', target_price: '1000' })).body;
    const endpoint = `/api/attachments/request/${row.id}`;
    assert.equal((await anon('GET', endpoint)).status, 401);
    assert.equal((await other('PUT', endpoint, { photos: [png] })).status, 403);
    const saved = await owner('PUT', endpoint, { photos: [png], note: '시제품 사진' });
    assert.equal(saved.status, 200); assert.equal(saved.body.photos.length, 1);
    const photo = saved.body.photos[0];
    assert.equal((await anon('GET', '/uploads/' + photo)).status, 401);
    assert.equal((await other('GET', '/uploads/' + photo)).status, 200);
    assert.equal((await other('GET', endpoint)).body.photos[0], photo);
    await admin('POST', `/api/requests/${row.id}/approve`);
    assert.equal((await owner('PUT', endpoint, { photos: [png] })).status, 403);
    assert.equal((await admin('PUT', endpoint, { note: '담당자 확인' })).status, 200);
    assert.equal((await admin('DELETE', '/api/requests/' + row.id)).status, 200);
    assert.equal((await other('GET', '/uploads/' + photo)).status, 404);
  }
});

test('Shipment photos, damage judgement and revision checks persist without losing existing files', async () => {
  const row = (await owner('POST', '/api/shipments', { ship_date: '2026-11-13', item: '검수박스', qty: 1, customer: '고객사' })).body;
  const endpoint = `/api/attachments/shipment/${row.id}`;
  const saved = await owner('PUT', endpoint, { photos: [png], inspection_status: 'abnormal', note: '박스 모서리 파손', revision: 0 });
  assert.equal(saved.status, 200); assert.equal(saved.body.inspection_status, 'abnormal'); const file = saved.body.photos[0];
  assert.equal((await other('PUT', endpoint, { photos: [png] })).status, 403);
  assert.equal((await owner('PUT', endpoint, { inspection_status: 'unknown' })).status, 400);
  assert.equal((await owner('PUT', endpoint, { keep_photos: ['a'.repeat(24) + '.png'] })).status, 400);
  assert.equal((await owner('PUT', endpoint, { photos: Array(10).fill(png) })).status, 400);
  const list = (await owner('GET', '/api/shipments?from=2026-11-13')).body;
  assert.equal(list.find(r => r.id === row.id).photo_count, 1); assert.equal(list.find(r => r.id === row.id).inspection_status, 'abnormal');
  const updated = await owner('PUT', endpoint, { inspection_status: 'normal', note: '재포장 완료', revision: saved.body.revision });
  assert.equal(updated.body.photos[0], file);
  const before = files();
  assert.equal((await owner('PUT', endpoint, { photos: [png], revision: saved.body.revision })).status, 409);
  assert.deepEqual(files(), before);
  const concurrent = await Promise.all([owner('PUT', endpoint, { photos: [png], revision: updated.body.revision }), owner('PUT', endpoint, { photos: [png], revision: updated.body.revision })]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const current = (await owner('GET', endpoint)).body;
  assert.equal(current.photos.length, 2);
  assert.equal((await owner('PUT', endpoint, { keep_photos: [], revision: current.revision })).body.photos.length, 0);
  assert.equal((await owner('GET', '/uploads/' + file)).status, 404);
});

test('Incoming analysis keeps access to receipt evidence after the source is deleted', async () => {
  const receipt = (await owner('POST', '/api/other-receipts', { received_date: '2026-11-13', item: '파손입고', item_category: '상품', qty: 2, vendor: '공급사' })).body;
  const endpoint = `/api/attachments/other_receipt/${receipt.id}`;
  const record = await owner('PUT', endpoint, { photos: [png], inspection_status: 'abnormal', note: '박스 눌림' });
  assert.equal(record.status, 200); const file = record.body.photos[0];
  await owner('DELETE', '/api/other-receipts/' + receipt.id);
  assert.equal((await other('GET', endpoint)).body.inspection_status, 'abnormal');
  assert.equal((await other('GET', '/uploads/' + file)).status, 200);
  assert.equal((await owner('PUT', endpoint, { note: '변경' })).status, 404);
  const order = (await owner('POST', '/api/po', { req_no: 'PHOTO-PO', item: '입고박스', vendor: '공급사', qty: 1, due_date: '2026-11-13', item_category: '부자재' })).body;
  assert.equal((await other('PUT', `/api/attachments/purchase_order/${order.id}`, { photos: [png], inspection_status: 'normal' })).status, 200);
  const list = (await owner('GET', '/api/po')).body.find(r => r.id === order.id); assert.equal(list.photo_count, 1); assert.equal(list.inspection_status, 'normal');
  const tables = (await admin('GET', '/api/admin/backup')).body.tables;
  assert.ok(tables.includes('boms')); assert.ok(tables.includes('attachments'));
  const backup = (await admin('GET', '/api/admin/backup?table=attachments')).body.rows;
  assert.ok(backup.some(r => JSON.parse(r.photos).includes(file)));
});

test('Failed metadata writes clean up newly uploaded files and preserve prior attachments', async () => {
  const row = (await owner('POST', '/api/shipments', { ship_date: '2026-11-13', item: '롤백', qty: 1, customer: '고객사' })).body;
  const endpoint = `/api/attachments/shipment/${row.id}`;
  const saved = await owner('PUT', endpoint, { photos: [png] }); const before = files();
  sqlite.exec("CREATE TEMP TRIGGER reject_attachment BEFORE UPDATE ON attachments BEGIN SELECT RAISE(ABORT, 'simulated metadata failure'); END;");
  const oldError = console.error; console.error = () => {};
  try {
    assert.equal((await owner('PUT', endpoint, { photos: [png], keep_photos: [] })).status, 500);
    assert.deepEqual(files(), before);
    assert.deepEqual((await owner('GET', endpoint)).body.photos, saved.body.photos);
  } finally { sqlite.exec('DROP TRIGGER reject_attachment'); console.error = oldError; }
});
