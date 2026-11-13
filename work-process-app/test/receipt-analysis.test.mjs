import approvedRegistration from './helpers.cjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-receipt-analysis-'));
const { env, sqlite } = localEnvironment(dir, 'receipt-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const response = await worker.fetch(new Request('https://receipts.test' + url, {
      method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  };
}
const admin = client(); const receiver = client();
const orderBody = suffix => ({ req_no: 'PR-' + suffix, vendor: '공급사', item: '검사품목 ' + suffix, qty: 12, due_date: '2026-11-20', item_category: '원자재', coa_requested: true });
const catalogIds = {};
const receiptBody = (suffix, category = '제품') => ({ bom_id: catalogIds[category], received_date: '2026-11-13', item: '기타입고 ' + suffix, vendor: '입고처', qty: 3, item_category: '제품', note: '발주 없는 입고' });
const analyses = async () => (await admin('GET', '/api/requests?type=analysis&scope=list')).body;
before(async () => {
  assert.equal((await admin('POST', '/api/auth/register', { name: '관리자', password: 'pass1234', invite: 'receipt-test' })).status, 200);
  assert.equal((await approvedRegistration(admin, receiver, { name: '입고담당', password: 'pass1234', invite: 'receipt-test' })).status, 200);
  for (const category of ['제품','상품','원자재','부자재']) { const r = await admin('POST', '/api/boms', { product: '기타입고 ' + category, item_category: category, base_qty: 1, unit: 'EA', materials: [{ item: '원단', item_category: '원자재', qty: 1, unit: 'kg' }] }); assert.equal(r.status, 200); catalogIds[category] = r.body.id; }
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Confirmed and quantity-mismatch receipts enter the analysis work list immediately; checking does not', async () => {
  const order = await receiver('POST', '/api/po', orderBody('trigger'));
  assert.equal((await analyses()).length, 0);
  assert.equal((await receiver('POST', '/api/po/receive', { ids: [order.body.id], status: 'checking' })).status, 200);
  assert.equal((await analyses()).length, 0);
  const mismatch = await receiver('POST', '/api/po/receive', { ids: [order.body.id], status: 'mismatch', recv_qty: 10 });
  assert.equal(mismatch.status, 200); assert.equal(mismatch.body.analysis_created, 1);
  const result = await receiver('POST', '/api/po/receive', { ids: [order.body.id], status: 'ok' });
  assert.equal(result.status, 200); assert.equal(result.body.analysis_created, 0, 'later confirmation does not duplicate the inspection');
  assert.equal((await analyses()).length, 1);
  const row = (await analyses())[0];
  assert.equal(row.status, 'waiting'); assert.equal(row.category, '수입검사'); assert.match(row.req_no, /^Q-\d{6}-\d+$/);
  assert.equal(row.source_type, 'purchase_order'); assert.equal(row.source_id, order.body.id);
  assert.equal(row.title, order.body.item); assert.equal(row.customer, '공급사'); assert.equal(row.requester_name, '입고담당');
  assert.equal(row.data.received_qty, 10, 'snapshot keeps the quantity actually received at inspection time'); assert.equal(row.data.item_category, '원자재');
  assert.equal(row.data.coa_requested, 1); assert.equal(row.data.result_type, 'COA발행');
  assert.equal(row.data.purchase_req_no, 'PR-trigger');
  assert.equal((await receiver('GET', '/api/requests?type=analysis&scope=intake')).body.length, 0);
  assert.equal((await receiver('POST', '/api/requests/' + row.id + '/status', { status: 'done' })).status, 403);
});

test('Repeated, concurrent and reverted confirmations do not duplicate or reset analyses', async () => {
  const orders = await Promise.all(['batch-a', 'batch-b'].map(x => receiver('POST', '/api/po', orderBody(x))));
  const ids = orders.map(r => r.body.id);
  const results = await Promise.all(Array.from({ length: 3 }, () => receiver('POST', '/api/po/receive', { ids, status: 'ok' })));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(results.reduce((sum, r) => sum + r.body.analysis_created, 0), 2);
  let rows = (await analyses()).filter(r => ids.includes(r.source_id));
  assert.equal(rows.length, 2); assert.equal(new Set(rows.map(r => r.req_no)).size, 2);
  const row = rows[0];
  assert.equal((await admin('POST', '/api/requests/' + row.id + '/status', { status: 'done', result_note: '검사 완료' })).status, 200);
  assert.equal((await receiver('POST', '/api/po/receive', { ids, status: '' })).status, 409, 'reverting a recorded receipt needs approval');
  for (const id of ids) {
    const req = await receiver('POST', `/api/po/${id}/receipt-changes`, { action: 'revert', reason: '오입력' });
    assert.equal((await admin('POST', `/api/receipt-changes/${req.body.change.id}/approve`, {})).status, 200);
  }
  assert.ok((await receiver('GET', '/api/po')).body.filter(p => ids.includes(p.id)).every(p => p.recv_status === ''));
  const repeated = await receiver('POST', '/api/po/receive', { ids, status: 'ok' });
  assert.equal(repeated.body.analysis_created, 0);
  rows = await analyses();
  assert.equal(rows.find(r => r.id === row.id).status, 'done');
  assert.equal(rows.find(r => r.id === row.id).result_note, '검사 완료');
});

test('Other receipt registration atomically creates a waiting inspection for every classification', async () => {
  const before = (await analyses()).length;
  const receipts = [];
  for (const item_category of ['제품', '상품', '원자재', '부자재']) {
    const result = await receiver('POST', '/api/other-receipts', { ...receiptBody(item_category, item_category), item_category });
    assert.equal(result.status, 200); receipts.push(result.body);
  }
  const rows = await analyses(); assert.equal(rows.length, before + 4);
  assert.equal(new Set(rows.map(r => r.req_no)).size, rows.length);
  for (const receipt of receipts) {
    const row = rows.find(r => r.source_type === 'other_receipt' && r.source_id === receipt.id);
    assert.ok(row); assert.equal(row.title, receipt.item); assert.equal(row.customer, receipt.vendor);
    assert.equal(row.status, 'waiting'); assert.equal(row.data.item_category, receipt.item_category);
    assert.equal(row.data.received_date, receipt.received_date); assert.equal(row.data.received_qty, 3);
    assert.equal(row.data.coa_requested, 0);
  }
  assert.ok(rows.some(r => r.source_type === 'other_receipt' && r.source_id === 1));
  assert.ok(rows.some(r => r.source_type === 'purchase_order' && r.source_id === 1));
  const receipt = receipts[0];
  const row = rows.find(r => r.source_type === 'other_receipt' && r.source_id === receipt.id);
  await receiver('PUT', '/api/other-receipts/' + receipt.id, { ...receipt, qty: 9 });
  assert.equal((await analyses()).length, rows.length);
  await receiver('DELETE', '/api/other-receipts/' + receipt.id);
  assert.equal((await analyses()).find(r => r.id === row.id).data.received_qty, 3);
  await admin('PUT', '/api/requests/' + row.id, { title: row.title, category: '수입검사', data: { purpose: '추가 검사' } });
  const edited = (await analyses()).find(r => r.id === row.id);
  assert.equal(edited.data.received_qty, 3); assert.equal(edited.data.item_category, receipt.item_category);
});

test('A failure to register analysis rolls back the receipt write', async () => {
  const order = await receiver('POST', '/api/po', orderBody('rollback'));
  const count = sqlite.prepare('SELECT COUNT(*) c FROM other_receipts').get().c;
  sqlite.exec("CREATE TEMP TRIGGER reject_analysis BEFORE INSERT ON requests WHEN NEW.source_type IS NOT NULL BEGIN SELECT RAISE(ABORT, 'simulated analysis failure'); END;");
  const originalError = console.error; console.error = () => {};
  try {
    assert.equal((await receiver('POST', '/api/po/receive', { ids: [order.body.id], status: 'ok' })).status, 500);
    assert.equal(sqlite.prepare('SELECT recv_status FROM purchase_orders WHERE id=?').get(order.body.id).recv_status, '');
    assert.equal((await receiver('POST', '/api/other-receipts', receiptBody('rollback'))).status, 500);
    assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM other_receipts').get().c, count);
  } finally { sqlite.exec('DROP TRIGGER reject_analysis'); console.error = originalError; }
  assert.equal((await receiver('POST', '/api/po/receive', { ids: [order.body.id, 999999], status: 'ok' })).status, 404);
  assert.equal(sqlite.prepare('SELECT recv_status FROM purchase_orders WHERE id=?').get(order.body.id).recv_status, '');
});
