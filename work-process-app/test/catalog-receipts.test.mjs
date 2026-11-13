import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-catalog-'));
const { env, sqlite } = localEnvironment(dir, 'catalog');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const response = await worker.fetch(new Request('https://catalog.test' + url, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  };
}
const admin = client(), member = client(), other = client();
const catalog = {};
const bomBody = category => ({ product: category + ' 품목', product_code: 'CODE-' + category, item_category: category, base_qty: 1, unit: category === '원자재' ? 'kg' : 'EA', materials: category === '제품' ? [{ item: '자재', item_category: '원자재', qty: 1, unit: 'kg' }] : [], created_by: '위조 입력자' });
before(async () => {
  for (const [user, name] of [[admin, '관리입력자'], [member, '입력직원'], [other, '입고처리자']]) await user('POST', '/api/auth/register', { name, password: 'test-password', invite: 'catalog' });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('BOMs have four top-level categories and searchable names and item codes', async () => {
  for (const category of ['원자재','부자재','제품','상품']) {
    const row = await admin('POST', '/api/boms', bomBody(category));
    assert.equal(row.status, 200); assert.equal(row.body.item_category, category); assert.equal(row.body.created_by, '관리입력자'); catalog[category] = row.body;
    const filtered = await member('GET', '/api/boms?item_category=' + encodeURIComponent(category));
    assert.equal(filtered.body.length, 1); assert.equal(filtered.body[0].id, row.body.id);
    assert.equal((await member('GET', '/api/boms?q=' + encodeURIComponent('CODE-' + category))).body[0].id, row.body.id);
  }
  assert.equal((await admin('POST', '/api/boms', { ...bomBody('원자재'), item_category: '' })).status, 400);
  assert.equal((await member('GET', '/api/boms?item_category=' + encodeURIComponent('잘못된 분류'))).status, 400);
  assert.equal((await member('GET', '/api/boms?q=' + encodeURIComponent("' OR 1=1 --"))).body.length, 0);
});

test('Other receipts require BOM selection and use server-controlled item snapshots', async () => {
  const body = { received_date: '2026-11-13', qty: 4, vendor: '입고처', item: '위조품목', item_category: '상품', created_by: '위조 입력자' };
  assert.equal((await member('POST', '/api/other-receipts', body)).status, 400);
  const created = await member('POST', '/api/other-receipts', { ...body, bom_id: catalog['원자재'].id });
  assert.equal(created.status, 200); assert.equal(created.body.item, '원자재 품목'); assert.equal(created.body.item_category, '원자재'); assert.equal(created.body.created_by, '입력직원');
  const original = JSON.parse(created.body.bom_snapshot); assert.equal(original.unit, 'kg'); assert.equal(original.product_code, 'CODE-원자재');
  await admin('PUT', '/api/boms/' + catalog['원자재'].id, { ...bomBody('원자재'), product: '변경한 품목', item_category: '부자재', unit: 'BOX' });
  await admin('DELETE', '/api/boms/' + catalog['원자재'].id);
  const changed = await admin('PUT', '/api/other-receipts/' + created.body.id, { ...body, bom_id: catalog['원자재'].id, qty: 8 });
  assert.equal(changed.body.item, '원자재 품목'); assert.equal(changed.body.item_category, '원자재'); assert.equal(changed.body.created_by, '입력직원'); assert.deepEqual(JSON.parse(changed.body.bom_snapshot), original);
  assert.equal((await member('POST', '/api/other-receipts', { ...body, bom_id: catalog['원자재'].id })).status, 400);
  const analysis = (await member('GET', '/api/requests?type=analysis&scope=list')).body.find(r => r.source_type === 'other_receipt' && r.source_id === created.body.id);
  assert.equal(analysis.requester_name, '입력직원'); assert.equal(analysis.data.unit, 'kg'); assert.equal(analysis.data.product_code, 'CODE-원자재'); assert.equal(analysis.data.received_qty, 4);
});

test('Existing unclassified BOMs and manually entered receipts are retained without guessing categories', async () => {
  const legacy = sqlite.prepare("INSERT INTO boms(product,kind,base_qty,unit,materials,created_by) VALUES('기존 미분류','finished',1,'EA','[]','기존작성자')").run();
  assert.equal((await member('GET', '/api/boms?q=' + encodeURIComponent('기존 미분류'))).body[0].item_category, '');
  assert.equal((await member('POST', '/api/other-receipts', { bom_id: Number(legacy.lastInsertRowid), received_date: '2026-11-13', qty: 1, vendor: '공급사' })).status, 400);
  const result = sqlite.prepare("INSERT INTO other_receipts(received_date,item,item_category,qty,vendor,created_by) VALUES('2026-11-13','기존수기품목','상품',1,'공급사','기존작성자')").run();
  const edited = await admin('PUT', '/api/other-receipts/' + result.lastInsertRowid, { received_date: '2026-11-13', item: '기존수기품목', item_category: '상품', qty: 2, vendor: '공급사', created_by: '변경시도' });
  assert.equal(edited.status, 200); assert.equal(edited.body.bom_id, null); assert.equal(edited.body.created_by, '기존작성자');
});

test('Every business registration records the authenticated author and preserves the original author on edit', async () => {
  const order = (await member('POST', '/api/po', { req_no: 'AUTHOR', vendor: '공급사', item: '품목', item_category: '부자재', qty: 1, due_date: '2026-11-13', created_by: '위조' })).body;
  assert.equal(order.created_by, '입력직원');
  await other('POST', '/api/po/receive', { ids: [order.id], status: 'ok', recv_by: '위조' });
  const incoming = (await member('GET', '/api/po')).body.find(r => r.id === order.id);
  assert.equal(incoming.created_by, '입력직원'); assert.equal(incoming.recv_by, '입고처리자');
  const schedule = (await member('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: '2026-11-13', product: '제품', qty: 1, created_by: '위조' })).body;
  assert.equal(schedule.created_by, '입력직원');
  const shipment = (await member('POST', '/api/shipments', { ship_date: '2026-11-13', item: '제품', qty: 1, customer: '고객사', created_by: '위조' })).body;
  assert.equal(shipment.created_by, '입력직원');
  const request = (await member('POST', '/api/requests', { type: 'sample', title: '샘플', requester_name: '위조' })).body;
  assert.equal(request.requester_name, '입력직원');
  const laundry = await member('POST', '/api/laundry', { in_date: '2026-11-13', discard_qty: 1, created_by: '위조' });
  assert.equal((await member('GET', '/api/laundry')).body.find(r => r.id === laundry.body.id).created_by, '입력직원');
  const attachment = await member('PUT', '/api/attachments/shipment/' + shipment.id, { note: '검수', updated_by: '위조' });
  assert.equal(attachment.body.updated_by, '입력직원');
});
