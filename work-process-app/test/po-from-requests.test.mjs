// 15.56 구매 › 발주 입력에서 승인된 구매의뢰를 불러와 발주: 발주 대기 목록의 미발주 품목, 일부 품목만 발주, 대시보드 건수.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pofpr-'));
const { env, sqlite } = localEnvironment(dir, 'pofpr-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://pofpr.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), sales = client(), boss = client(), buyer = client();
const ids = {};
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [sales, '영업'], [boss, '팀장'], [buyer, '구매']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'pofpr-test' });
  for (const u of (await admin('GET', '/api/admin/users')).body) ids[u.name] = u.id;
  await admin('PUT', `/api/admin/users/${ids['구매']}`, { roles: ['purchase'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Approved requests list their unordered items for the purchase screen; ordering some leaves the rest waiting', async () => {
  const pr = (await sales('POST', '/api/purchase-requests', { doc_date: '2026-11-10', title: '핸드롤러', approvers: [ids['팀장']], items: [
    { item: '핸드롤러', spec: '34Φ*200', unit: 'SET', qty: 10, vendor: '롤러상사', due_text: '2026-12-01' },
    { item: '교체용 롤', unit: 'EA', qty: 40, vendor: '롤러상사', due_text: 'ASAP' }] })).body;
  assert.equal((await buyer('GET', '/api/my-tasks')).body.approvals.purchase_orders_waiting, undefined, 'nothing to order before approval');
  await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  const waiting = (await buyer('GET', '/api/my-tasks')).body.approvals.purchase_orders_waiting;
  assert.deepEqual([waiting.count, waiting.items[0].doc_no, waiting.items[0].first_item], [1, pr.doc_no, '핸드롤러']);
  assert.equal((await sales('GET', '/api/my-tasks')).body.approvals.purchase_orders_waiting, undefined, 'only purchase staff see it');
  const box = (await buyer('GET', '/api/purchase-requests?box=order&paged=1')).body;
  const row = box.rows.find(r => r.id === pr.id);
  assert.deepEqual(row.open_items.map(i => [i.item, i.spec, i.unit, i.qty, i.vendor, i.due_text]), [['핸드롤러', '34Φ*200', 'SET', 10, '롤러상사', '2026-12-01'], ['교체용 롤', '', 'EA', 40, '롤러상사', 'ASAP']]);
  assert.ok(!('open_items' in (await buyer('GET', '/api/purchase-requests')).body[0]), 'other boxes stay as they were');
  // 첫 품목만 발주
  const made = await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-01', item_category: '부자재', item_ids: [row.open_items[0].id] });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.deepEqual(made.body.created.map(p => [p.req_no, p.vendor, p.item, p.qty, p.unit, p.due_date]), [[pr.doc_no, '롤러상사', '핸드롤러', 10, 'SET', '2026-12-01']]);
  assert.ok((await buyer('GET', '/api/po')).body.some(p => p.id === made.body.created[0].id), 'shows in the order list');
  const rest = (await buyer('GET', '/api/purchase-requests?box=order&paged=1')).body.rows.find(r => r.id === pr.id);
  assert.deepEqual(rest.open_items.map(i => i.item), ['교체용 롤']);
  await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-11-20', item_category: '부자재' });
  assert.ok(!(await buyer('GET', '/api/purchase-requests?box=order&paged=1')).body.rows.some(r => r.id === pr.id), 'fully ordered requests leave the box');
  assert.equal((await buyer('GET', '/api/my-tasks')).body.approvals.purchase_orders_waiting, undefined);
});

test('15.66: quantities and unit prices can be changed when ordering; the order keeps spec and price for the PO sheet', async () => {
  const pr = (await sales('POST', '/api/purchase-requests', { doc_date: '2026-11-10', title: '수량 조정', approvers: [ids['팀장']], items: [
    { item: '롤러', spec: '34Φ*200', unit: 'SET', qty: 10, purchase_price: 5000, vendor: '롤러상사' },
    { item: '교체 롤', unit: 'EA', qty: 40, purchase_price: 700, vendor: '롤러상사' }] })).body;
  await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  const [a, b] = (await buyer('GET', `/api/purchase-requests/${pr.id}`)).body.items;
  const bad = await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-01', item_category: '부자재', lines: [{ id: a.id, qty: 0 }] });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /0보다 커야/);
  assert.equal((await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-01', item_category: '부자재', lines: [{ id: a.id, unit_price: -1 }] })).status, 400);
  const made = await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-01', item_category: '부자재', lines: [{ id: a.id, qty: 12, unit_price: 4800 }, { id: b.id, qty: 30, unit_price: '' }] });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const [pa, pb] = made.body.created;
  assert.deepEqual([pa.qty, pa.unit_price, pa.spec, pa.unit], [12, 4800, '34Φ*200', 'SET']);
  assert.match(pa.note, /의뢰 10 → 발주 12/);
  assert.deepEqual([pb.qty, pb.unit_price], [30, null], 'a cleared price stays empty');
  // 발주목록에서 단가 수정·삭제
  const edited = await buyer('PUT', `/api/po/${pb.id}`, { req_no: pb.req_no, vendor: pb.vendor, item: pb.item, qty: 30, due_date: '2026-12-01', item_category: '부자재', unit_price: 650 });
  assert.equal(edited.body.unit_price, 650);
  assert.equal((await buyer('PUT', `/api/po/${pb.id}`, { req_no: pb.req_no, vendor: pb.vendor, item: pb.item, qty: 30, due_date: '2026-12-01', item_category: '부자재', unit_price: '' })).body.unit_price, null);
  assert.equal((await buyer('GET', '/api/po')).body.find(p => p.id === pa.id).unit_price, 4800, 'the list carries the price for the sheet');
});

test('15.69: vendor freight terms, request freight in profit, internal note and freight carried once per vendor', async () => {
  const vendor = (await buyer('POST', '/api/vendors', { name: '운송상사', is_purchase: true, freight_terms: [{ when: 'gte', amount: 1000000, fee: 150000, per: 'order', note: '착불' }, { when: 'always', fee: 7000, per: 'line' }] })).body;
  assert.deepEqual(vendor.freight_terms.map(r => [r.when, r.amount, r.fee, r.per, r.note]), [['gte', 1000000, 150000, 'order', '착불'], ['always', null, 7000, 'line', '']]);
  assert.equal((await buyer('PUT', `/api/vendors/${vendor.id}`, { name: '운송상사', freight_terms: [{ when: 'sometimes', fee: 1 }] })).status, 400);
  assert.equal((await buyer('PUT', `/api/vendors/${vendor.id}`, { name: '운송상사', freight_terms: [{ when: 'always', fee: -1 }] })).status, 400);
  assert.equal((await buyer('PUT', `/api/vendors/${vendor.id}`, { name: '운송상사', freight_terms: Array(11).fill({ when: 'always', fee: 1 }) })).status, 400);
  assert.equal((await buyer('PUT', `/api/vendors/${vendor.id}`, { name: '운송상사', contact_name: '김' })).body.freight_terms.length, 2, 'kept when not sent');
  assert.equal((await buyer('GET', '/api/vendors?q=' + encodeURIComponent('운송상사'))).body[0].freight_terms.length, 2);
  assert.equal((await sales('POST', '/api/purchase-requests', { doc_date: '2026-11-10', title: 'x', approvers: [ids['팀장']], freight: { 운송상사: -5 }, items: [{ item: 'a', unit: 'EA', qty: 1, vendor: '운송상사' }] })).status, 400);
  const pr = (await sales('POST', '/api/purchase-requests', { doc_date: '2026-11-10', title: '운송비', approvers: [ids['팀장']], freight: { 운송상사: 20000, '': 5 }, items: [
    { item: '장갑', unit: 'EA', qty: 10, purchase_price: 1000, sale_price: 2000, vendor: '운송상사', customer: '풍림무약' },
    { item: '마스크', unit: 'EA', qty: 10, purchase_price: 500, sale_price: 900, vendor: '운송상사' }] })).body;
  assert.deepEqual([pr.freight, pr.freight_total, pr.purchase_total, pr.sale_total], [{ 운송상사: 20000 }, 20000, 15000, 29000]);
  assert.equal((await sales('GET', '/api/purchase-requests?box=mine')).body.find(r => r.id === pr.id).freight_total, 20000);
  await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  const [a, b] = pr.items;
  const first = (await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-01', item_category: '부자재', item_ids: [a.id], lines: [{ id: a.id, internal_note: '풍림무약향' }] })).body.created;
  assert.deepEqual([first[0].internal_note, first[0].freight], ['풍림무약향', 20000], 'request freight goes to the first order of that vendor');
  const second = (await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-01', item_category: '부자재' })).body.created;
  assert.deepEqual([second[0].item, second[0].freight, second[0].internal_note], ['마스크', null, ''], 'a later split order does not charge it again');
  const edited = await buyer('PUT', `/api/po/${second[0].id}`, { req_no: second[0].req_no, vendor: '운송상사', item: '마스크', qty: 10, due_date: '2026-12-01', item_category: '부자재', internal_note: '머크향', freight: 7000 });
  assert.deepEqual([edited.body.internal_note, edited.body.freight], ['머크향', 7000]);
  assert.equal((await buyer('PUT', `/api/po/${second[0].id}`, { req_no: second[0].req_no, vendor: '운송상사', item: '마스크', qty: 10, due_date: '2026-12-01', item_category: '부자재', freight: '' })).body.freight, null);
  const direct = (await buyer('POST', '/api/po', { req_no: 'D-1', vendor: '운송상사', item: '장화', qty: 1, due_date: '2026-12-01', item_category: '부자재', internal_note: '머크향', freight: 3000 })).body;
  assert.deepEqual([direct.internal_note, direct.freight], ['머크향', 3000]);
});

test('15.70: a registered item keeps its unit and only takes one of its registered sizes as spec', async () => {
  await admin('POST', '/api/item-categories', { item_class: '상품', name: '방진화', sizes: '240,250,260' });
  const shoe = (await admin('POST', '/api/boms', { product: '방진안전화', product_code: 'SH-01', item_category: '상품', kind: 'finished', base_qty: 1, unit: '켤레', materials: [], cat1: '방진화' })).body;
  const plain = (await admin('POST', '/api/boms', { product: '무사이즈 품목', product_code: 'NS-01', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  assert.deepEqual(shoe.sizes, ['240', '250', '260']);
  const send = items => sales('POST', '/api/purchase-requests', { doc_date: '2026-11-16', title: '고정', approvers: [ids['팀장']], items });
  const wrong = await send([{ bom_id: shoe.id, item: '아무거나', unit: 'BOX', spec: '999', qty: 1 }]);
  assert.equal(wrong.status, 400); assert.match(wrong.body.error, /등록된 사이즈\(240, 250, 260\)/);
  const ok = await send([{ bom_id: shoe.id, item: '아무거나', product_code: 'X', unit: 'BOX', spec: '250', qty: 1 }, { bom_id: plain.id, item: 'x', unit: 'BOX', spec: '흰색', qty: 2 }, { item: '직접 입력', unit: 'BOX', spec: '자유', qty: 3 }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.items.map(i => [i.item, i.product_code, i.unit, i.spec]), [['방진안전화', 'SH-01', '켤레', '250'], ['무사이즈 품목', 'NS-01', 'EA', '흰색'], ['직접 입력', '', 'BOX', '자유']]);
  const mr = await sales('POST', '/api/production-requests', { order_date: '2026-11-16', customer: '하라다', lines: [{ bom_id: shoe.id, item: 'x', unit: 'BOX', spec: '240', qty: 5 }] });
  assert.equal(mr.status, 200, JSON.stringify(mr.body)); assert.deepEqual([mr.body.lines[0].unit, mr.body.lines[0].spec], ['켤레', '240']);
  assert.equal((await sales('POST', '/api/production-requests', { order_date: '2026-11-16', customer: '하라다', lines: [{ bom_id: shoe.id, item: 'x', spec: 'XL', qty: 5 }] })).status, 400);
});

test('15.70: the PO-sheet note typed when ordering is kept after the automatic request text', async () => {
  const pr = (await sales('POST', '/api/purchase-requests', { doc_date: '2026-11-16', title: '비고', approvers: [ids['팀장']], items: [{ item: '비고장갑', spec: 'L', unit: 'EA', qty: 10, vendor: '비고상사' }] })).body;
  await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  const made = (await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-01', item_category: '부자재', note: '성적서 동봉', lines: [{ id: pr.items[0].id, qty: 12 }] })).body.created[0];
  assert.equal(made.note, `구매의뢰 ${pr.doc_no} · L · 의뢰 10 → 발주 12 · 성적서 동봉`);
});

test('15.75: re-submitting a request keeps a spec saved before sizes were registered', async () => {
  const bom = (await admin('POST', '/api/boms', { product: '사이즈후등록', product_code: 'SZ-9', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const pr = (await sales('POST', '/api/purchase-requests', { doc_date: '2026-11-16', title: '이전 규격', approvers: [ids['팀장']], items: [{ bom_id: bom.id, item: 'x', spec: '245', qty: 1 }] })).body;
  await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'rejected', comment: '수량 확인' });
  const node = (await admin('POST', '/api/item-categories', { item_class: '상품', name: '사이즈후등록분류', sizes: '240,250' })).body.id;
  await admin('PUT', `/api/boms/${bom.id}`, { ...bom, cat1: '사이즈후등록분류' });
  assert.ok(node);
  const again = await sales('PUT', `/api/purchase-requests/${pr.id}`, { doc_date: '2026-11-16', title: '이전 규격', approvers: [ids['팀장']], items: [{ bom_id: bom.id, item: 'x', spec: '245', qty: 2 }], revision: pr.revision + 1 });
  assert.equal(again.status, 200, JSON.stringify(again.body)); assert.equal(again.body.items[0].spec, '245');
  assert.equal((await sales('PUT', `/api/purchase-requests/${pr.id}`, { doc_date: '2026-11-16', title: '이전 규격', approvers: [ids['팀장']], items: [{ bom_id: bom.id, item: 'x', spec: '999', qty: 2 }], revision: again.body.revision })).status, 400, 'a new unregistered size is still refused');
});
