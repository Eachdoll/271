// 15.249 LOT 체계: 업체 LOT(없으면 임시 SST) → 커팅·융착 봉투 LOT(투입 원자재 LOT, BOM 자재만) → 세탁(봉투 LOT) → 포장(세탁 완료 봉투 → 완제품 LOT) → LOT 연결 조회
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lot249-'));
const { env, sqlite } = localEnvironment(dir, 'lot249-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://lot249.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), prod = client();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const ymd = today.slice(2).replace(/-/g, '');
const rid = () => crypto.randomUUID();
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'lot249-test' });
  await approvedRegistration(admin, prod, { name: '생산', password: 'password', invite: 'lot249-test' });
  const u = (await admin('GET', '/api/admin/users')).body.find(x => x.name === '생산');
  await admin('PUT', `/api/admin/users/${u.id}`, { roles: ['production', 'logistics'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('15.249 vendor LOT or temporary SST LOT, bag LOTs from BOM material LOTs, wash and pack by bag, trace both ways', async () => {
  const cloth = (await admin('POST', '/api/boms', { product: '원단', product_code: 'CL-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  const film = (await admin('POST', '/api/boms', { product: '필름', product_code: 'FM-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  const other = (await admin('POST', '/api/boms', { product: '다른자재', product_code: 'OT-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  // 1) 입고: 업체 LOT 그대로, 비우면 SST-YYMMDD-01·02
  const rc = await admin('POST', '/api/receipts', { receipt_date: today, vendor: '원단상사', request_id: rid(), lines: [{ bom_id: cloth.id, lot: 'HS-0457', qty: 10 }, { bom_id: cloth.id, qty: 5 }, { bom_id: film.id, qty: 8 }, { bom_id: other.id, lot: 'OT-9', qty: 3 }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  const lots = sqlite.prepare('SELECT item, lot FROM other_receipts ORDER BY id').all().map(r => `${r.item}:${r.lot}`);
  assert.deepEqual(lots, ['원단:HS-0457', `원단:SST-${ymd}-01`, `필름:SST-${ymd}-02`, '다른자재:OT-9']);
  // 2) 커팅·융착: 봉투마다 LOT(생산일_코드_번호), 투입 원자재 LOT은 BOM 자재만, 재고 안에서
  const semi = (await admin('POST', '/api/boms', { product: 'NX808 반제품', product_code: 'NX808', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '원단', item_category: '원자재', qty: 0.01, unit: 'kg' }, { item: '필름', item_category: '원자재', qty: 0.01, unit: 'kg' }] })).body;
  const line = (await admin('POST', '/api/production-units', { kind: 'line', name: '1라인' })).body;
  const washer = (await admin('POST', '/api/production-units', { kind: 'washer', name: '1호기' })).body;
  const cut = (items) => prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, items, request_id: rid() });
  const base = { entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '12:00' };
  const notBom = await cut([{ ...base, qty: 100, inputs: [{ item: '다른자재', lot: 'OT-9', qty: 1 }] }]);
  assert.equal(notBom.status, 400); assert.match(notBom.body.error, /BOM에 없는 자재/);
  const over = await cut([{ ...base, qty: 100, inputs: [{ item: '원단', lot: 'HS-0457', qty: 6 }] }, { ...base, qty: 100, inputs: [{ item: '원단', lot: 'HS-0457', qty: 6 }] }]);
  assert.equal(over.status, 400, 'same LOT across bags is summed'); assert.match(over.body.error, /남은 수량/);
  const c = await cut([{ ...base, qty: 1200, inputs: [{ item: '원단', lot: 'HS-0457', qty: 4 }, { item: '필름', lot: `SST-${ymd}-02`, qty: 2 }] }, { ...base, qty: 1200, inputs: JSON.stringify([{ item: '원단', lot: 'HS-0457', qty: 4 }, { item: '원단', lot: `SST-${ymd}-01`, qty: 1 }]) }, { ...base, qty: 900, inputs: [{ item: '원단', lot: `SST-${ymd}-01`, qty: 3 }] }]);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const bags = c.body.rows.map(r => r.lot);
  assert.deepEqual(bags, [1, 2, 3].map(n => `${ymd}_NX808_${n}`));
  const more = await cut([{ ...base, qty: 10, inputs: [{ item: '원단', lot: 'HS-0457', qty: 1 }] }]);
  assert.equal(more.body.rows[0].lot, `${ymd}_NX808_4`, 'numbering continues the same day');
  const bal = Object.fromEntries((await prod('GET', '/api/inventory/lots?q=' + encodeURIComponent('원단'))).body.rows.map(r => [r.lot, r.balance]));
  assert.equal(bal['HS-0457'], 1, 'cut inputs leave the material LOT stock'); assert.equal(bal[`SST-${ymd}-01`], 1);
  // 3) 세탁: 봉투 LOT 그대로
  const unwashed = (await prod('GET', '/api/semi-bags?state=unwashed')).body.rows.map(r => r.lot);
  assert.equal(unwashed.length, 4);
  const w = await prod('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, items: bags.map((lot, i) => ({ entry_mode: 'wash_quantity', bom_id: semi.id, qty: [1200, 1200, 900][i], lot, bag_required: true, start_time: '13:00' })), request_id: rid() });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const badBag = await prod('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, items: [{ entry_mode: 'wash_quantity', bom_id: semi.id, qty: 1, lot: 'NOPE_1', bag_required: true }], request_id: rid() });
  assert.equal(badBag.status, 400, JSON.stringify(badBag.body));
  const washed = (await prod('GET', '/api/semi-bags?state=washed')).body.rows;
  assert.deepEqual(washed.map(r => r.lot).sort(), [...bags].sort()); assert.equal(washed.find(r => r.lot === bags[0]).washed_qty, 1200);
  // 4) 포장: 세탁 완료 봉투만, 완제품 LOT 포장일_코드_P순번
  const fin = (await admin('POST', '/api/boms', { product: 'NX808 완제품', product_code: 'NX808B', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [{ item: 'NX808 반제품', item_category: '반제품', qty: 100, unit: '매' }] })).body;
  assert.ok(fin.id, JSON.stringify(fin));
  const plan = (await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: today, qty: 50, bom_id: fin.id })).body;
  const notWashed = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 10, request_id: rid(), bags: [`${ymd}_NX808_4`] });
  assert.equal(notWashed.status, 400, JSON.stringify([plan, notWashed.body])); assert.match(notWashed.body.error, /세탁/);
  const a1 = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 30, request_id: rid(), bags: [bags[0], bags[1], bags[2]] });
  assert.equal(a1.status, 200, JSON.stringify(a1.body)); assert.equal(a1.body.lot, `${ymd}_NX808B_P1`);
  const a2 = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 5, request_id: rid(), bags: [bags[2]] });
  assert.equal(a2.body.lot, `${ymd}_NX808B_P2`, 'a leftover bag can go into the next finished LOT');
  // 5) 조회: 완제품 → 봉투 → 원자재
  const t1 = (await prod('GET', '/api/lot-trace?lot=' + encodeURIComponent(a1.body.lot))).body;
  assert.equal(t1.kind, 'finished'); assert.deepEqual(t1.bags.map(b => b.lot).sort(), [...bags].sort());
  assert.deepEqual(t1.materials.map(m => m.lot).sort(), ['HS-0457', `SST-${ymd}-01`, `SST-${ymd}-02`].sort());
  assert.equal(t1.materials.find(m => m.lot === 'HS-0457').receipts[0].vendor, '원단상사');
  // 원자재 → 봉투 → 완제품
  const t2 = (await prod('GET', '/api/lot-trace?lot=' + encodeURIComponent(`SST-${ymd}-01`))).body;
  assert.equal(t2.kind, 'material'); assert.deepEqual(t2.bags.map(b => b.lot).sort(), [bags[1], bags[2]].sort());
  assert.deepEqual(t2.finished.map(f => f.lot).sort(), [a1.body.lot, a2.body.lot].sort());
  // 봉투 → 양쪽
  const t3 = (await prod('GET', '/api/lot-trace?lot=' + encodeURIComponent(bags[0]))).body;
  assert.equal(t3.kind, 'bag'); assert.deepEqual(t3.finished.map(f => f.lot), [a1.body.lot]); assert.equal(t3.bags[0].washes.length, 1);
  assert.equal((await prod('GET', '/api/lot-trace?lot=ZZZ')).body.kind, '');
  const recent = (await prod('GET', '/api/lot-trace/recent')).body; assert.equal(recent.finished.length, 2); assert.equal(recent.bags.length, 4);
  // 봉투 LOT은 세탁·포장에 쓰인 뒤에는 바꿀 수 없음
  const rec = sqlite.prepare("SELECT id FROM semi_records WHERE lot=? AND process='cut'").get(bags[0]);
  assert.equal((await prod('PUT', `/api/semi-records/${rec.id}`, { lot: 'X-1', note: '바꿈' })).status, 400);
});

test('15.250 receipt keeps trade qty (yd) and physical pieces; cutting takes pieces per LOT and BOM computes the yd usage', async () => {
  const yarn = (await admin('POST', '/api/boms', { product: '야드원단', product_code: 'YD-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  const rc = await admin('POST', '/api/receipts', { receipt_date: today, vendor: '야드상사', request_id: rid(), lines: [{ bom_id: yarn.id, lot: 'YD-A', qty: 300, pieces: 30 }, { bom_id: yarn.id, lot: 'YD-B', qty: 100, pieces: 10 }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.deepEqual(rc.body.lines.map(l => [l.lot, l.qty, l.pieces]), [['YD-A', 300, 30], ['YD-B', 100, 10]]);
  assert.equal((await admin('POST', '/api/receipts', { receipt_date: today, vendor: '야드상사', request_id: rid(), lines: [{ bom_id: yarn.id, lot: 'YD-C', qty: 1, pieces: -1 }] })).status, 400);
  const lots = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('야드원단'))).body.rows;
  assert.deepEqual(lots.map(l => [l.lot, l.balance, l.pieces_left]), [['YD-A', 300, 30], ['YD-B', 100, 10]]);
  // 반제품 1매에 0.05yd: 양품 900 + 불량 100 = 1000매 → 50yd. 절 3:1로 나눔 → YD-A 37.5yd, YD-B 12.5yd
  const semi = (await admin('POST', '/api/boms', { product: 'YD 반제품', product_code: 'YDS', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '야드원단', item_category: '원자재', qty: 0.05, unit: 'yd' }] })).body;
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0];
  const c = await prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '10:00', qty: 900, defect_qty: 100, defect_reason: '오염', inputs: [{ item: '야드원단', lot: 'YD-A', pieces: 3 }, { item: '야드원단', lot: 'YD-B', pieces: 1 }] }] });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const used = sqlite.prepare('SELECT lot, qty, pieces FROM semi_lot_inputs WHERE record_id=? ORDER BY id').all(c.body.rows[0].id);
  assert.deepEqual(used.map(u => [u.lot, u.qty, u.pieces]), [['YD-A', 37.5, 3], ['YD-B', 12.5, 1]]);
  const after = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('야드원단'))).body.rows;
  assert.deepEqual(after.map(l => [l.lot, l.balance, l.pieces_left]), [['YD-A', 262.5, 27], ['YD-B', 87.5, 9]]);
  const over = await prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '11:00', end_time: '12:00', qty: 10, inputs: [{ item: '야드원단', lot: 'YD-B', pieces: 10 }] }] });
  assert.equal(over.status, 400); assert.match(over.body.error, /남은 실물 9절/);
  const tr = (await prod('GET', '/api/lot-trace?lot=YD-A')).body;
  assert.equal(tr.kind, 'material'); assert.equal(tr.bags[0].inputs.find(i => i.lot === 'YD-A').pieces, 3); assert.equal(tr.materials.find(m => m.lot === 'YD-A').receipts[0].pieces, 30);
});

test('15.251 one item received as several vendor LOTs with pieces; pieces get codes LOT-1..N; cutting picks piece numbers', async () => {
  const nx = (await admin('POST', '/api/boms', { product: 'NX-8 원단', product_code: 'NX-8R', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  const rc = await admin('POST', '/api/receipts', { receipt_date: today, vendor: '엔엑스', request_id: rid(), lines: [{ bom_id: nx.id, lot: 'L1', qty: 5000, pieces: 15 }, { bom_id: nx.id, lot: 'L2', qty: 5000, pieces: 15 }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.deepEqual(rc.body.lines.map(l => [l.lot, l.pieces, l.piece_from]), [['L1', 15, 1], ['L2', 15, 1]]);
  const rc2 = (await admin('POST', '/api/receipts', { receipt_date: today, vendor: '엔엑스', request_id: rid(), lines: [{ bom_id: nx.id, lot: 'L1', qty: 100, pieces: 2 }] })).body;
  assert.equal(rc2.lines[0].piece_from, 16, 'a later receipt of the same LOT continues the piece numbers');
  const avail = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('NX-8 원단'))).body.rows;
  assert.equal(avail.find(l => l.lot === 'L1').pieces_free.length, 17); assert.deepEqual(avail.find(l => l.lot === 'L2').pieces_free.slice(0, 3), [1, 2, 3]);
  const semi = (await admin('POST', '/api/boms', { product: 'NX-8 반제품', product_code: 'NX8S', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: 'NX-8 원단', item_category: '원자재', qty: 1, unit: 'yd' }] })).body;
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0];
  const cut = (inputs, qty = 300) => prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '09:00', qty, inputs }] });
  const ok1 = await cut([{ item: 'NX-8 원단', lot: 'L1', piece_nos: [3, 1] }, { item: 'NX-8 원단', lot: 'L2', piece_nos: '5' }]);
  assert.equal(ok1.status, 200, JSON.stringify(ok1.body));
  const used = sqlite.prepare('SELECT lot, qty, pieces, piece_nos FROM semi_lot_inputs WHERE record_id=? ORDER BY id').all(ok1.body.rows[0].id);
  assert.deepEqual(used.map(u => [u.lot, u.qty, u.pieces, u.piece_nos]), [['L1', 200, 2, '1,3'], ['L2', 100, 1, '5']]);
  const again = await cut([{ item: 'NX-8 원단', lot: 'L1', piece_nos: [3] }]);
  assert.equal(again.status, 400); assert.match(again.body.error, /L1-3은 없는 절이거나 이미 투입한 절/);
  assert.equal((await cut([{ item: 'NX-8 원단', lot: 'L2', piece_nos: [16] }])).status, 400, 'L2 has only 15 pieces');
  const after = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('NX-8 원단'))).body.rows.find(l => l.lot === 'L1');
  assert.equal(after.pieces_free.includes(1), false); assert.equal(after.pieces_free.includes(2), true); assert.equal(after.pieces_left, 15);
  const tr = (await prod('GET', '/api/lot-trace?lot=L1-3')).body;
  assert.equal(tr.kind, 'piece'); assert.deepEqual(tr.bags.map(b => b.lot), [ok1.body.rows[0].lot]);
  assert.equal((await prod('GET', '/api/lot-trace?lot=L1-2')).body.bags.length, 0, 'an unused piece has no bags');
});

test('15.252 raw material received without pieces gets a temporary piece LOT-1 that can be picked again; non-raw items do not', async () => {
  const raw = (await admin('POST', '/api/boms', { product: '임시절원단', product_code: 'TP-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  const goods = (await admin('POST', '/api/boms', { product: '임시절상품', product_code: 'TG-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const rc = (await admin('POST', '/api/receipts', { receipt_date: today, vendor: '임시상사', request_id: rid(), lines: [{ bom_id: raw.id, lot: 'TMP-A', qty: 500 }, { bom_id: goods.id, lot: 'G-A', qty: 5 }] })).body;
  assert.deepEqual(rc.lines.map(l => [l.lot, l.pieces, l.pieces_temp, l.piece_from]), [['TMP-A', 1, 1, 1], ['G-A', null, 0, null]]);
  const lot = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('임시절원단'))).body.rows[0];
  assert.deepEqual([lot.pieces_free, lot.pieces_temp], [[1], [1]]);
  const semi = (await admin('POST', '/api/boms', { product: '임시절 반제품', product_code: 'TPS', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '임시절원단', item_category: '원자재', qty: 1, unit: 'yd' }] })).body;
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0];
  const cut = () => prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '09:00', qty: 100, inputs: [{ item: '임시절원단', lot: 'TMP-A', piece_nos: [1] }] }] });
  assert.equal((await cut()).status, 200); assert.equal((await cut()).status, 200, 'a temporary piece can be picked again');
  const after = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('임시절원단'))).body.rows[0];
  assert.deepEqual([after.balance, after.pieces_free, after.pieces_left], [300, [1], 1]);
  assert.equal((await prod('GET', '/api/lot-trace?lot=TMP-A-1')).body.bags.length, 2);
});

test('15.253 review fixes: piece numbers per item, counts block numbers, replay, used receipts locked, used bag not deletable, 0 pieces, usage recalculated', async () => {
  const A = (await admin('POST', '/api/boms', { product: '리뷰원단A', product_code: 'RA-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  const Bm = (await admin('POST', '/api/boms', { product: '리뷰원단B', product_code: 'RB-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '리뷰상사', request_id: rid(), lines: [{ bom_id: Bm.id, lot: 'X1', qty: 50, pieces: 5 }] });
  const ra = (await admin('POST', '/api/receipts', { receipt_date: today, vendor: '리뷰상사', request_id: rid(), lines: [{ bom_id: A.id, lot: 'X1', qty: 30, pieces: 3 }, { bom_id: A.id, lot: 'M1', qty: 30, pieces: 3 }, { bom_id: A.id, lot: 'Z0', qty: 10, pieces: 0 }] })).body;
  assert.deepEqual(ra.lines.map(l => [l.lot, l.pieces, l.pieces_temp, l.piece_from]), [['X1', 3, 0, 1], ['M1', 3, 0, 1], ['Z0', 1, 1, 1]], 'numbers per item; 0 pieces = temporary 1');
  const semi = (await admin('POST', '/api/boms', { product: '리뷰 반제품', product_code: 'RVS', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '리뷰원단A', item_category: '원자재', qty: 0.1, unit: 'yd' }] })).body;
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0], washer = (await prod('GET', '/api/production-units?kind=washer')).body[0];
  const one = (inputs, extra = {}) => prod('POST', '/api/semi-records', { process: 'cut', work_date: today, unit_id: line.id, entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '09:00', qty: 100, inputs, ...extra });
  assert.equal((await one([{ item: '리뷰원단A', lot: 'M1', pieces: 3 }])).status, 200);
  const twice = await one([{ item: '리뷰원단A', lot: 'M1', piece_nos: [1] }]);
  assert.equal(twice.status, 400, 'pieces used by count cannot be picked again by number');
  const key = rid(), r1 = await one([{ item: '리뷰원단A', lot: 'X1', piece_nos: [1] }], { request_id: key }), r2 = await one([{ item: '리뷰원단A', lot: 'X1', piece_nos: [1] }], { request_id: key });
  assert.equal(r1.status, 200); assert.equal(r2.status, 200, 'replay returns the saved record'); assert.equal(r2.body.id, r1.body.id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM semi_lot_inputs WHERE record_id=?').get(r1.body.id).n, 1);
  const mRow = sqlite.prepare("SELECT id FROM other_receipts WHERE lot='M1' AND item='리뷰원단A'").get();
  assert.equal((await admin('DELETE', `/api/other-receipts/${mRow.id}`)).status, 409, 'a receipt used by cutting cannot be deleted');
  assert.equal((await admin('PUT', `/api/other-receipts/${mRow.id}/place`, { lot: 'M9' })).status, 409);
  await prod('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, request_id: rid(), items: [{ entry_mode: 'wash_quantity', bom_id: semi.id, qty: 100, lot: r1.body.lot, bag_required: true, start_time: '10:00' }] });
  assert.equal((await prod('DELETE', `/api/semi-records/${r1.body.id}`, { reason: '정리', request_id: rid() })).status, 409, 'a washed bag cannot be deleted');
  // 불량수량 바로 고치기 → 사용량 다시 계산(양품 100 + 불량 20) × 0.1 = 12
  const e = await prod('PUT', `/api/semi-records/${r1.body.id}`, { work_date: today, unit_id: line.id, entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '09:00', qty: 100, defect_qty: 20, defect_reason: '오염' });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(sqlite.prepare('SELECT qty FROM semi_lot_inputs WHERE record_id=?').get(r1.body.id).qty, 12);
  assert.equal((await prod('GET', '/api/lot-trace?lot=X1-01')).body.bags.length, 1, 'X1-01 means piece 1');
});

test('15.254 shipping within LOT balance, failed incoming inspection blocks use, vendor LOT alias for SST, VOC linked to finished LOT, LOT number collision guard', async () => {
  const g = (await admin('POST', '/api/boms', { product: '출하상품', product_code: 'SH-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '출하상사', request_id: rid(), lines: [{ bom_id: g.id, lot: 'SHL', qty: 10 }] });
  await admin('POST', '/api/vendors', { name: '고객A', is_sales: true });
  assert.equal((await admin('POST', '/api/shipments', { ship_date: today, item: '출하상품', bom_id: g.id, qty: 11, customer: '고객A', lot: 'SHL', request_id: rid() })).status, 400, 'more than the LOT balance');
  assert.equal((await admin('POST', '/api/shipments', { ship_date: today, item: '출하상품', bom_id: g.id, qty: 10, customer: '고객A', lot: 'SHL', request_id: rid() })).status, 200);
  // 수입검사 불합격 LOT
  const raw = (await admin('POST', '/api/boms', { product: '검사원단', product_code: 'QC-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '검사상사', request_id: rid(), lines: [{ bom_id: raw.id, lot: 'QC-BAD', qty: 100, pieces: 2 }, { bom_id: raw.id, qty: 50 }] });
  const req = sqlite.prepare("SELECT id FROM requests WHERE type='analysis' AND lot='QC-BAD'").get();
  sqlite.prepare("INSERT INTO inspection_measurements(request_id,values_json,result,save_token,updated_by) VALUES(?,?,?,?,?)").run(req.id, '[]', 'fail', rid(), '품질');
  const lots = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('검사원단'))).body.rows;
  assert.equal(lots.find(l => l.lot === 'QC-BAD').qc_fail, true);
  const semi = (await admin('POST', '/api/boms', { product: '검사 반제품', product_code: 'QCS', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '검사원단', item_category: '원자재', qty: 0.1, unit: 'yd' }] })).body;
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0];
  const cut = inputs => prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '09:00', qty: 100, inputs }] });
  const blocked = await cut([{ item: '검사원단', lot: 'QC-BAD', piece_nos: [1] }]);
  assert.equal(blocked.status, 400); assert.match(blocked.body.error, /수입검사 불합격/);
  // 임시 SST LOT에 업체 LOT 연결 → 업체 LOT으로도 조회
  const sst = lots.find(l => /^SST-/.test(l.lot)).lot;
  const c = await cut([{ item: '검사원단', lot: sst, piece_nos: [1] }]); assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await admin('POST', '/api/lots/vendor-lot', { item: '검사원단', lot: 'QC-BAD', vendor_lot: 'X' })).status, 400, 'only SST LOTs');
  assert.equal((await admin('POST', '/api/lots/vendor-lot', { item: '검사원단', lot: sst, vendor_lot: 'HS-REAL-7' })).status, 200);
  assert.equal((await prod('GET', '/api/lots/available?item=' + encodeURIComponent('검사원단'))).body.rows.find(l => l.lot === sst).vendor_lot, 'HS-REAL-7');
  const viaAlias = (await prod('GET', '/api/lot-trace?lot=HS-REAL-7')).body;
  assert.equal(viaAlias.alias_of, 'HS-REAL-7'); assert.equal(viaAlias.kind, 'material'); assert.equal(viaAlias.materials.find(m => m.lot === sst).receipts[0].vendor_lot, 'HS-REAL-7');
  // VOC ↔ 완제품 LOT
  const fp = (await admin('POST', '/api/boms', { product: 'VOC제품', product_code: 'VC-1', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  const plan = (await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: today, qty: 10, bom_id: fp.id, product: 'VOC제품' })).body;
  const act = (await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 5, request_id: rid() })).body;
  const vr = await admin('POST', '/api/requests', { type: 'voc', title: 'VOC제품', customer: '고객A', category: '', due_date: '', data: { lot: act.lot, qty: 1, unit: 'BOX', extra: '오염' } }); assert.equal(vr.status, 200, JSON.stringify(vr.body));
  const tv = (await prod('GET', '/api/lot-trace?lot=' + encodeURIComponent(act.lot))).body;
  assert.equal(tv.finished[0].vocs.length, 1);
  // 번호 겹침: 다음 번호를 다른 곳에서 먼저 써 버리면(동시 저장 흉내) 되돌리고 409
  const next = `${today.slice(2).replace(/-/g, '')}_VC-1_P2`;
  sqlite.prepare('INSERT INTO production_actuals(schedule_id,production_date,qty,note,author_id,author_name,request_id,lot) SELECT schedule_id,production_date,1,\'\',author_id,author_name,?,? FROM production_actuals WHERE id=?').run(rid(), next + 'x', act.id);
  sqlite.prepare('UPDATE production_actuals SET lot=? WHERE lot=?').run(next, next + 'x');
  const before = sqlite.prepare('SELECT COUNT(*) n FROM production_actuals').get().n;
  const dup = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 1, request_id: rid() });
  assert.notEqual(dup.body?.lot, next);
  assert.ok(dup.status === 200 || dup.status === 409);
  if (dup.status === 409) assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM production_actuals').get().n, before);
});

test('15.255 work in progress: cut/wash/pack save the LOT first with no quantity, entering the quantity completes them', async () => {
  const raw = (await admin('POST', '/api/boms', { product: '작업중원단', product_code: 'WIP-R', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  const semi = (await admin('POST', '/api/boms', { product: '작업중반', product_code: 'WIPS', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '작업중원단', item_category: '원자재', qty: 0.01, unit: 'yd' }] })).body;
  const fin = (await admin('POST', '/api/boms', { product: '작업중제품', product_code: 'WIPF', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [{ item: '작업중반', item_category: '반제품', qty: 10, unit: '매' }] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '작업상사', request_id: rid(), lines: [{ bom_id: raw.id, lot: 'WIP-L', qty: 50, pieces: 2 }] });
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0], washer = (await prod('GET', '/api/production-units?kind=washer')).body[0];
  // 커팅 작업중: 수량 없이 LOT·투입 절만
  const c = await prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', work_status: 'progress', qty: '', inputs: [{ item: '작업중원단', lot: 'WIP-L', piece_nos: [1] }] }] });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const bag = c.body.rows[0]; assert.equal(bag.work_status, 'progress'); assert.equal(bag.qty, 0); assert.match(bag.lot, /_WIPS_1$/);
  assert.ok(!(await prod('GET', '/api/semi-bags?state=unwashed')).body.rows.some(r => r.lot === bag.lot), 'in-progress bag is not ready for washing');
  const early = await prod('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, request_id: rid(), items: [{ entry_mode: 'wash_quantity', bom_id: semi.id, qty: 100, lot: bag.lot, bag_required: true, start_time: '10:00' }] });
  assert.equal(early.status, 400); assert.match(early.body.error, /작업중/);
  // 작업완료: 수량을 넣으면 원자재 사용량 BOM 계산
  const done = await prod('POST', `/api/semi-records/${bag.id}/complete`, { qty: 1000, defect_qty: 0, end_time: '11:00' });
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.work_status, 'done'); assert.equal(done.body.work_hours, 3);
  assert.equal(sqlite.prepare('SELECT qty FROM semi_lot_inputs WHERE record_id=?').get(bag.id).qty, 10);
  assert.equal((await prod('POST', `/api/semi-records/${bag.id}/complete`, { qty: 1 })).status, 409, 'already done');
  // 세탁 작업중 → 포장 대상 아님 → 완료
  const w = await prod('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, request_id: rid(), items: [{ entry_mode: 'wash_quantity', bom_id: semi.id, work_status: 'progress', qty: '', lot: bag.lot, bag_required: true, start_time: '10:00' }] });
  assert.equal(w.status, 200, JSON.stringify(w.body)); assert.equal(w.body.rows[0].work_status, 'progress');
  assert.ok(!(await prod('GET', '/api/semi-bags?state=washed')).body.rows.some(r => r.lot === bag.lot));
  const plan = (await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: today, qty: 100, bom_id: fin.id, product: '작업중제품' })).body;
  await admin('POST', '/api/schedules/confirm', { ids: [plan.id] });
  assert.equal((await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: '', work_status: 'progress', bags: [bag.lot], request_id: rid() })).status, 400, 'bag not washed yet');
  assert.equal((await prod('POST', `/api/semi-records/${w.body.rows[0].id}/complete`, { qty: 1000 })).status, 200);
  // 포장 작업중: 완제품 LOT 먼저, 수량은 나중에
  assert.equal((await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: '', work_status: 'progress', request_id: rid() })).status, 400, 'needs bags');
  const p = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: '', work_status: 'progress', bags: [bag.lot], request_id: rid() });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.match(p.body.lot, /_WIPF_P1$/); assert.equal(p.body.qty, 0);
  const list = (await prod('GET', '/api/actuals/progress')).body.rows; const it = list.find(r => r.id === p.body.id);
  assert.ok(it); assert.deepEqual(it.bags.map(b => b.lot), [bag.lot]);
  const pd = await prod('POST', `/api/actuals/${p.body.id}/complete`, { qty: 95 });
  assert.equal(pd.status, 200, JSON.stringify(pd.body)); assert.equal(pd.body.qty, 95); assert.equal(pd.body.work_status, 'done'); assert.equal(pd.body.lot, p.body.lot);
  assert.ok(!(await prod('GET', '/api/actuals/progress')).body.rows.some(r => r.id === p.body.id));
});

test('15.256 concession (특채) on a failed-inspection LOT allows use and shipping; LOT history lists in/out per LOT', async () => {
  const g = (await admin('POST', '/api/boms', { product: '특채상품', product_code: 'CC-G', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '상품상사', request_id: rid(), lines: [{ bom_id: g.id, lot: 'CC-L1', qty: 20 }] });
  const req = sqlite.prepare("SELECT id FROM requests WHERE type='analysis' AND lot='CC-L1'").get();
  sqlite.prepare("INSERT INTO inspection_measurements(request_id,values_json,result,save_token,updated_by) VALUES(?,?,?,?,?)").run(req.id, '[]', 'fail', rid(), '품질');
  await admin('POST', '/api/vendors', { name: '특채고객', is_sales: true });
  const ship = qty => admin('POST', '/api/shipments', { ship_date: today, item: '특채상품', bom_id: g.id, qty, customer: '특채고객', lot: 'CC-L1', request_id: rid() });
  const blocked = await ship(5); assert.equal(blocked.status, 400); assert.match(blocked.body.error, /불합격/);
  assert.equal((await prod('POST', '/api/lots/concession', { item: '특채상품', lot: 'CC-L1', reason: '고객 승인' })).status, 403, 'quality approver only');
  assert.equal((await admin('POST', '/api/lots/concession', { item: '특채상품', lot: 'NOPE', reason: 'x' })).status, 400, 'only failed LOTs');
  const c = await admin('POST', '/api/lots/concession', { item: '특채상품', lot: 'CC-L1', reason: '고객 승인' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await admin('POST', '/api/lots/concession', { item: '특채상품', lot: 'CC-L1', reason: '또' })).status, 409);
  assert.equal((await ship(5)).status, 200, 'shipping allowed after concession');
  const lr = (await prod('GET', '/api/inventory/lots?qc=1&q=CC-L1')).body.rows.find(r => r.lot === 'CC-L1');
  assert.equal(lr.qc, 'concession'); assert.equal(lr.balance, 15);
  assert.equal((await prod('GET', '/api/lots/available?item=' + encodeURIComponent('특채상품'))).body.rows.find(l => l.lot === 'CC-L1').concession, true);
  const h = (await prod('GET', '/api/inventory/lot-history?' + new URLSearchParams({ item: '특채상품', lot: 'CC-L1' }))).body;
  assert.deepEqual(h.rows.map(r => [r.kind, r.src, r.qty, r.balance]), [['in', '기타입고', 20, 20], ['out', '출고', 5, 15]]);
  assert.equal(h.rows[1].party, '특채고객'); assert.equal(h.qc.qc, 'concession');
  // 특채 취소 → 다시 막힘
  assert.equal((await admin('POST', `/api/lots/concession/${c.body.id}/void`, { reason: '재검토' })).status, 200);
  assert.equal((await ship(1)).status, 400);
  assert.equal((await prod('GET', '/api/inventory/lots?qc=1&q=CC-L1')).body.rows.find(r => r.lot === 'CC-L1').qc, 'fail');
});

test('15.258 review fixes: progress rows cannot be edited, one progress rule, atomic complete, shipment edits checked', async () => {
  const raw = (await admin('POST', '/api/boms', { product: '리뷰원단', product_code: 'RV-R', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  const semiR = await admin('POST', '/api/boms', { product: '리뷰반', product_code: 'RVW', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '리뷰원단', item_category: '원자재', qty: 0.01, unit: 'yd' }] }); assert.equal(semiR.status, 200, JSON.stringify(semiR.body)); const semi = semiR.body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '리뷰상사', request_id: rid(), lines: [{ bom_id: raw.id, lot: 'RV-L', qty: 5, pieces: 3 }] });
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0];
  const cut = extra => prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', ...extra }] });
  // 양품 0·불량만 있으면 작업중이 아님(종료 시각 필요)
  const d0 = await cut({ work_status: 'progress', qty: 0, defect_qty: 100, inputs: [{ item: '리뷰원단', lot: 'RV-L', piece_nos: [1] }] });
  assert.equal(d0.status, 400, JSON.stringify(d0.body)); assert.match(d0.body.error, /종료 시각/);
  const w = await cut({ work_status: 'progress', qty: '', inputs: [{ item: '리뷰원단', lot: 'RV-L', piece_nos: [1] }] }); assert.equal(w.status, 200, JSON.stringify(w.body));
  const rec = w.body.rows[0];
  // 작업중 기록은 수정 요청 불가
  assert.equal((await prod('PUT', `/api/semi-records/${rec.id}`, { ...rec, qty: 500, reason: 'x', request_id: rid() })).status, 409);
  // 잔량보다 많은 사용량 → 저장 전에 막히고 아무것도 바뀌지 않음
  const tooMuch = await prod('POST', `/api/semi-records/${rec.id}/complete`, { qty: 1000, end_time: '10:00' });
  assert.equal(tooMuch.status, 400); assert.match(tooMuch.body.error, /RV-L/);
  const after = sqlite.prepare('SELECT work_status, qty, end_time FROM semi_records WHERE id=?').get(rec.id);
  assert.deepEqual({ ...after }, { work_status: 'progress', qty: 0, end_time: null });
  assert.ok(sqlite.prepare('SELECT qty FROM semi_lot_inputs WHERE record_id=?').get(rec.id).qty < 0.00001);
  const ok = await prod('POST', `/api/semi-records/${rec.id}/complete`, { qty: 300, end_time: '10:00' }); assert.equal(ok.status, 200);
  assert.equal(sqlite.prepare('SELECT qty FROM semi_lot_inputs WHERE record_id=?').get(rec.id).qty, 3);
  assert.equal((await prod('POST', `/api/semi-records/${rec.id}/complete`, { qty: 300, end_time: '10:00' })).status, 200, 'retry returns the saved record');
  // 포장 작업중은 수정 요청 불가(취소는 가능)
  const fin = (await admin('POST', '/api/boms', { product: '리뷰제품', product_code: 'RVF', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  const plan = (await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: today, qty: 10, bom_id: fin.id, product: '리뷰제품' })).body;
  const act = (await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 5, request_id: rid() })).body;
  sqlite.prepare("UPDATE production_actuals SET work_status='progress', qty=0 WHERE id=?").run(act.id);
  assert.equal((await prod('POST', `/api/schedules/${plan.id}/actuals/${act.id}/changes`, { qty: 40, reason: 'x', request_id: rid() })).status, 409);
  // 출하 수정: 불합격 LOT·잔량 초과 막힘
  const g = (await admin('POST', '/api/boms', { product: '리뷰상품', product_code: 'RV-G', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '리뷰상사', request_id: rid(), lines: [{ bom_id: g.id, lot: 'RG-OK', qty: 50 }, { bom_id: g.id, lot: 'RG-BAD', qty: 50 }] });
  const req = sqlite.prepare("SELECT id FROM requests WHERE type='analysis' AND lot LIKE '%RG-BAD%'").get();
  sqlite.prepare("INSERT INTO inspection_measurements(request_id,values_json,result,save_token,updated_by) VALUES(?,?,?,?,?)").run(req.id, '[]', 'fail', rid(), '품질');
  await admin('POST', '/api/vendors', { name: '리뷰고객', is_sales: true });
  const sh = (await admin('POST', '/api/shipments', { ship_date: today, item: '리뷰상품', bom_id: g.id, qty: 30, customer: '리뷰고객', lot: 'RG-OK', request_id: rid() })).body;
  const put = b => admin('PUT', `/api/shipments/${sh.id}`, { ship_date: today, item: '리뷰상품', qty: 30, customer: '리뷰고객', note: '', lot: 'RG-OK', ...b });
  assert.equal((await put({ qty: 50 })).status, 200, 'same LOT: its own 30 is not counted twice');
  assert.equal((await put({ qty: 51 })).status, 400, 'over balance');
  assert.equal((await put({ lot: 'RG-BAD' })).status, 400, 'failed LOT');
  const lt = await admin('PUT', `/api/items/shipment/${sh.id}`, { spec: '', unit: 'EA', lot: 'RG-BAD' }); assert.notEqual(lt.status, 200);
});

test('15.262 purchase stock: price and incoming POs for purchase only; purchase can set safety stock', async () => {
  assert.equal((await prod('GET', '/api/purchase/stock-extra')).status, 403, 'production/logistics user is not purchase');
  const x = await admin('GET', '/api/purchase/stock-extra'); assert.equal(x.status, 200); assert.ok(Array.isArray(x.body.prices) && Array.isArray(x.body.incoming));
  const buyer = client(); await approvedRegistration(admin, buyer, { name: '구매담당', password: 'password', invite: 'lot249-test' });
  const u = (await admin('GET', '/api/admin/users')).body.find(v => v.name === '구매담당'); await admin('PUT', `/api/admin/users/${u.id}`, { roles: ['purchase'] });
  assert.equal((await buyer('GET', '/api/purchase/stock-extra')).status, 200);
  assert.equal((await buyer('PUT', '/api/inventory/levels', { item: '리뷰원단', unit: 'yd', min_qty: 10 })).status, 200);
});

test('15.265 stock adjustment by LOT and location: count and +/- change LOT, place and item stock; cutting usage leaves the place', async () => {
  const g = (await admin('POST', '/api/boms', { product: '조정상품', product_code: 'AJ-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  await admin('POST', '/api/warehouses', { name: '조정창고', locations: 'A,B' });
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '조정상사', request_id: rid(), lines: [{ bom_id: g.id, lot: 'AJ-L', qty: 30, warehouse: '조정창고', location: 'A' }] });
  const lotBal = async () => (await prod('GET', '/api/inventory/lots?q=AJ-L')).body.rows.find(r => r.lot === 'AJ-L').balance;
  const placeQty = async loc => (await prod('GET', '/api/inventory/places?q=AJ-L')).body.rows.filter(r => r.lot === 'AJ-L' && r.location === loc).reduce((t, r) => t + r.qty, 0);
  const itemStock = async () => (await prod('GET', '/api/inventory?q=' + encodeURIComponent('조정상품'))).body.rows.find(r => r.item === '조정상품').stock;
  assert.equal((await prod('POST', '/api/inventory/adjustments', { item: '조정상품', unit: 'EA', lot: 'AJ-L', kind: 'adjust', qty: -1, reason: 'x', request_id: rid() })).status, 403, 'logistics lead/admin only');
  // 위치 실사: A에서 센 수량 27 → −3
  const c = await admin('POST', '/api/inventory/adjustments', { item: '조정상품', unit: 'EA', lot: 'AJ-L', warehouse: '조정창고', location: 'A', kind: 'count', counted_qty: 27, by_item: true, reason: '실사', request_id: rid() });
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.qty, -3);
  assert.equal(await lotBal(), 27); assert.equal(await placeQty('A'), 27); assert.equal(await itemStock(), 27);
  // LOT 증감 +5(위치 없이)
  assert.equal((await admin('POST', '/api/inventory/adjustments', { item: '조정상품', unit: 'EA', lot: 'AJ-L', kind: 'adjust', qty: 5, reason: '찾음', request_id: rid() })).status, 200);
  assert.equal(await lotBal(), 32); assert.equal(await itemStock(), 32);
  assert.equal((await admin('POST', '/api/inventory/adjustments', { item: '조정상품', unit: 'EA', lot: 'AJ-L', warehouse: '조정창고', location: 'A', kind: 'count', counted_qty: 32, by_item: true, reason: '같음', request_id: rid() })).status, 400, 'no difference');
  assert.equal(await placeQty('A'), 32, 'LOT in one place: change without a location lands there');
  const h = (await prod('GET', '/api/inventory/lot-history?' + new URLSearchParams({ item: '조정상품', lot: 'AJ-L' }))).body.rows.map(r => [r.src, r.kind, r.qty]);
  assert.deepEqual(h.filter(r => /실사|조정/.test(r[0])).sort(), [['재고 실사', 'out', 3], ['재고 조정', 'in', 5]]);
  // 커팅 투입은 창고·위치 수량에서도 빠짐
  const raw = (await admin('POST', '/api/boms', { product: '위치원단', product_code: 'WC-R', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  const semi = (await admin('POST', '/api/boms', { product: '위치반', product_code: 'WCS', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '위치원단', item_category: '원자재', qty: 0.01, unit: 'yd' }] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '조정상사', request_id: rid(), lines: [{ bom_id: raw.id, lot: 'WC-L', qty: 50, pieces: 2, warehouse: '조정창고', location: 'B' }] });
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0];
  assert.equal((await prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '09:00', qty: 1000, inputs: [{ item: '위치원단', lot: 'WC-L', piece_nos: [1] }] }] })).status, 200);
  assert.equal((await prod('GET', '/api/inventory/places?q=WC-L')).body.rows.filter(r => r.lot === 'WC-L').reduce((t, r) => t + r.qty, 0), 40);
});

test('15.266 warehouse and location renames carry through receipts, moves and adjustments; vendor saved with business info at once', async () => {
  const w1 = (await admin('POST', '/api/warehouses', { name: '연동1동', locations: 'A,B' })).body;
  const g = (await admin('POST', '/api/boms', { product: '연동상품', product_code: 'LK-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '연동상사', request_id: rid(), lines: [{ bom_id: g.id, lot: 'LK-L', qty: 20, warehouse: '연동1동', location: 'A' }] });
  assert.equal((await admin('POST', '/api/stock-transfers', { item: '연동상품', unit: 'EA', lot: 'LK-L', qty: 5, from_place: '연동1동 A', to_warehouse: '연동1동', to_location: 'B', request_id: rid() })).status, 200);
  assert.equal((await admin('POST', '/api/inventory/adjustments', { item: '연동상품', unit: 'EA', lot: 'LK-L', warehouse: '연동1동', location: 'B', kind: 'adjust', qty: 2, reason: 'x', request_id: rid() })).status, 200);
  const places = async () => Object.fromEntries((await prod('GET', '/api/inventory/places?q=LK-L')).body.rows.filter(r => r.lot === 'LK-L').map(r => [`${r.warehouse} ${r.location}`, r.qty]));
  assert.deepEqual(await places(), { '연동1동 A': 15, '연동1동 B': 7 });
  // 창고 이름 + 위치 이름 바꾸기 → 위치별 재고가 새 이름으로 그대로
  const up = await admin('PUT', `/api/warehouses/${w1.id}`, { name: '연동2동', rename_locations: [{ from: 'B', to: 'B구역' }] });
  assert.equal(up.status, 200, JSON.stringify(up.body)); assert.equal(up.body.locations, 'A,B구역');
  assert.deepEqual(await places(), { '연동2동 A': 15, '연동2동 B구역': 7 });
  assert.equal((await admin('PUT', `/api/warehouses/${w1.id}`, { rename_locations: [{ from: 'A', to: 'B구역' }] })).status, 400, 'name already there');
  // 거래처: 기본 + 사업자 정보 한 번에
  const v = await admin('POST', '/api/vendors', { name: '한번상사', is_purchase: true, biz_no: '123-45-67890', ceo: '김대표', address: '서울', biz_type: '도소매', biz_item: '부자재', tax_email: 'a@b.co', tax_reverse: 1 });
  assert.equal(v.status, 200, JSON.stringify(v.body)); assert.equal(v.body.biz_no, '123-45-67890'); assert.equal(v.body.ceo, '김대표'); assert.equal(v.body.tax_reverse, 1);
  const e = await admin('PUT', `/api/vendors/${v.body.id}`, { name: '한번상사', contact_name: '이담당', ceo: '박대표', tax_reverse: 0 });
  assert.equal(e.status, 200); assert.equal(e.body.ceo, '박대표'); assert.equal(e.body.tax_reverse, 0); assert.equal(e.body.biz_no, '123-45-67890'); assert.equal(e.body.contact_name, '이담당');
  assert.equal((await prod('POST', '/api/vendors', { name: '권한상사', biz_no: '123-45-67891' })).status, 403, 'business info needs sales/purchase');
  assert.equal((await prod('POST', '/api/vendors', { name: '권한상사' })).status, 200, 'without business info is fine');
});

test('15.267 vendor keeps system name apart from tax-invoice business name, plus contact, bank and other details', async () => {
  const v = await admin('POST', '/api/vendors', { name: 'O&M Halyard(할야드)', biz_name: 'O&M Halyard Singapore Pte Ltd', ceo: 'Kim', name_en: 'O&M Halyard', tel: '+65 6305 6360', fax: '+65 6305 6376', addr: '101 Thomson Road', tax_contact: '회계담당', tax_dept: '재무팀', tax_phone: '02-1', contact_title: '과장', contact_mobile: '010-1', contact_email: 'buyer@om.co', bank_name: 'DBS', bank_account: '123', bank_holder: 'O&M', memo: '태국 글러브' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.name, 'O&M Halyard(할야드)'); assert.equal(v.body.biz_name, 'O&M Halyard Singapore Pte Ltd');
  for (const [k, x] of Object.entries({ name_en: 'O&M Halyard', tel: '+65 6305 6360', fax: '+65 6305 6376', addr: '101 Thomson Road', tax_contact: '회계담당', tax_dept: '재무팀', contact_title: '과장', contact_email: 'buyer@om.co', bank_name: 'DBS', bank_holder: 'O&M', memo: '태국 글러브' })) assert.equal(v.body[k], x, k);
  const e = await prod('PUT', `/api/vendors/${v.body.id}`, { name: 'O&M Halyard(할야드)', memo: '메모 바꿈', bank_account: '999' });
  assert.equal(e.status, 200, JSON.stringify(e.body)); assert.equal(e.body.memo, '메모 바꿈'); assert.equal(e.body.bank_account, '999'); assert.equal(e.body.tel, '+65 6305 6360', 'untouched fields kept');
  assert.equal((await admin('POST', '/api/vendors', { name: '메일틀림', contact_email: 'nope' })).status, 400);
  assert.equal((await admin('GET', '/api/vendors?q=' + encodeURIComponent('메일틀림'))).body.length, 0, 'nothing saved on a bad email');
});

test('15.268 a note payment from the partner book registers the note; cancelling the payment removes it', async () => {
  await admin('POST', '/api/vendors', { name: '어음거래처', is_sales: true, is_purchase: true });
  const pay = b => admin('POST', '/api/sales-payments', { customer: '어음거래처', pay_date: today, kind: 'payment', amount: 9981400, method: '', note: '외상매출금 입금', request_id: rid(), ...b });
  assert.equal((await pay({ note_info: { note_no: 'N-1' } })).status, 400, 'due date needed');
  const r = await pay({ note_info: { note_no: 'N-1', note_type: '자수어음', issue_date: today, due_date: '2027-02-20', bank: '하나은행', endorser: '어음거래처', storage: '금고' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.method, '어음 N-1'); assert.equal(r.body.bill_note.kind, 'receivable'); assert.equal(r.body.bill_note.amount, 9981400); assert.equal(r.body.bill_note.payment_id, r.body.id);
  const notes = (await admin('GET', '/api/notes?kind=receivable')).body; const list = Array.isArray(notes) ? notes : notes.rows;
  const n = list.find(x => x.note_no === 'N-1'); assert.ok(n); assert.equal(n.note_type, '자수어음'); assert.equal(n.storage, '금고');
  // 같은 어음번호 → 409, 입금도 안 생김
  const before = sqlite.prepare('SELECT COUNT(*) c FROM sales_payments').get().c;
  assert.equal((await pay({ note_info: { note_no: 'N-1', due_date: '2027-02-20' } })).status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM sales_payments').get().c, before);
  // 어음 관리에서 바로 지우기는 막힘, 입금 취소하면 함께 삭제
  assert.equal((await admin('POST', `/api/notes/${n.id}/cancel`, {})).status, 400);
  assert.equal((await admin('POST', `/api/sales-payments/${r.body.id}/cancel`, { reason: '잘못' })).status, 200);
  assert.equal(sqlite.prepare('SELECT status FROM bill_notes WHERE id=?').get(n.id).status, 'cancelled');
  // 지급어음
  const p = await admin('POST', '/api/purchase-payments', { vendor: '어음거래처', pay_date: today, kind: 'payment', amount: 500000, request_id: rid(), note_info: { note_no: 'P-1', due_date: '2027-01-31' } });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.bill_note.kind, 'payable');
  // 만기회수한 어음의 지급은 취소 막힘
  assert.equal((await admin('POST', `/api/notes/${p.body.bill_note.id}/collect`, { date: today })).status, 200);
  assert.equal((await admin('POST', `/api/purchase-payments/${p.body.id}/cancel`, { reason: 'x' })).status, 400);
});

test('15.269 note from the book can carry its own amount and partner', async () => {
  await admin('POST', '/api/vendors', { name: '어음다른', is_sales: true });
  const r = await admin('POST', '/api/sales-payments', { customer: '어음다른', pay_date: today, kind: 'payment', amount: 1000000, request_id: rid(), note_info: { note_no: 'D-1', issue_date: today, due_date: '2027-03-31', amount: 1000000, partner: '발행회사', bank: '기업은행', memo: '외상매출금 회수' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.bill_note.partner, '발행회사'); assert.equal(r.body.bill_note.memo, '외상매출금 회수'); assert.equal(r.body.bill_note.amount, 1000000);
});
