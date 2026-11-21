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

test('15.271 partner book add: 1-won sales/purchase adjustment bills (negative allowed) and memos show in the book', async () => {
  await admin('POST', '/api/vendors', { name: '조정거래처', is_sales: true, is_purchase: true });
  const add = b => admin('POST', '/api/book-entries', { party: '조정거래처', date: today, request_id: rid(), ...b });
  assert.equal((await add({ side: 'sales', kind: 'bill', supply: 0, vat: 0 })).status, 400);
  const s1 = await add({ side: 'sales', kind: 'bill', item: '세금계산서 1원 차이', supply: 1, vat: 0, note: '11월분' });
  assert.equal(s1.status, 200, JSON.stringify(s1.body)); assert.match(s1.body.bill_no, /^SB-/); assert.equal(s1.body.total, 1);
  const s2 = await add({ side: 'sales', kind: 'bill', supply: -1, vat: 0 }); assert.equal(s2.status, 200, JSON.stringify(s2.body)); assert.equal(s2.body.total, -1);
  const p1 = await add({ side: 'purchase', kind: 'bill', supply: 10, vat: 1 }); assert.equal(p1.status, 200, JSON.stringify(p1.body)); assert.match(p1.body.bill_no, /^PB-/); assert.equal(p1.body.total, 11);
  const m = await add({ side: 'sales', kind: 'memo', text: '1원 차이 거래처 확인' }); assert.equal(m.status, 200);
  const book = (await admin('GET', '/api/partner-book?' + new URLSearchParams({ side: 'sales', party: '조정거래처', from: today, to: today }))).body;
  assert.deepEqual(book.rows.map(r => [r.kind, r.total]).sort(), [['bill', -1], ['bill', 1], ['memo', 0]].sort());
  assert.equal(book.totals.balance, 0);
  const pb = (await admin('GET', '/api/partner-book?' + new URLSearchParams({ side: 'purchase', party: '조정거래처', from: today, to: today }))).body;
  assert.equal(pb.totals.total, 11);
  // 매입전표 상세가 조정 줄로도 열림
  assert.equal((await admin('GET', `/api/purchase-bills/${p1.body.id}`)).status, 200);
  // 메모 지우기
  assert.equal((await admin('POST', `/api/book-memos/${m.body.id}/delete`, {})).status, 200);
  assert.equal((await admin('GET', '/api/partner-book?' + new URLSearchParams({ side: 'sales', party: '조정거래처', from: today, to: today }))).body.rows.filter(r => r.kind === 'memo').length, 0);
  assert.equal((await prod('POST', '/api/book-entries', { side: 'sales', kind: 'memo', party: '조정거래처', date: today, text: 'x', request_id: rid() })).status, 403);
});

test('15.274 vendor contacts list: several contacts per site/role, replaced on edit, searchable', async () => {
  const v = await admin('POST', '/api/vendors', { name: '한솔아이원스', is_sales: true, contacts: [{ name: '백소민 선임', site: '본사', phone: '010-3767-5512', role: '발주' }, { name: '김윤수', site: '안성', email: 'yskim@hansol.com', role: '납품' }, { name: '', site: '빈줄' }] });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  let row = (await admin('GET', '/api/vendors?q=' + encodeURIComponent('한솔'))).body[0];
  assert.deepEqual(row.contacts.map(c => [c.name, c.site, c.role]), [['백소민 선임', '본사', '발주'], ['김윤수', '안성', '납품']]);
  assert.equal((await admin('GET', '/api/vendors?q=yskim')).body[0]?.name, '한솔아이원스', 'contact email is searchable');
  const e = await prod('PUT', `/api/vendors/${v.body.id}`, { name: '한솔아이원스', contacts: [{ name: '성하경', site: '본사', role: '세금계산서', email: 'hagyeong@hansol.com' }] });
  assert.equal(e.status, 200);
  row = (await admin('GET', '/api/vendors?q=' + encodeURIComponent('한솔'))).body[0];
  assert.deepEqual(row.contacts.map(c => c.name), ['성하경']);
  assert.equal((await admin('PUT', `/api/vendors/${v.body.id}`, { name: '한솔아이원스' })).status, 200);
  assert.equal((await admin('GET', '/api/vendors?q=' + encodeURIComponent('한솔'))).body[0].contacts.length, 1, 'edit without contacts keeps them');
  assert.equal((await admin('PUT', `/api/vendors/${v.body.id}`, { name: '한솔아이원스', contacts: [{ name: 'x', email: 'bad' }] })).status, 400);
});

test('15.276 development roadmap: term, dates, progress, current/next and process steps per development request', async () => {
  const dev = await admin('POST', '/api/requests', { type: 'development', title: '저분진 와이퍼 9인치', customer: '삼성SDI', due_date: '2027-03-31', target_price: '100', data: { extra: 'x' } });
  assert.equal(dev.status, 200, JSON.stringify(dev.body));
  const id = dev.body.id; await admin('POST', `/api/requests/${id}/approve`); // 15.285 접수대기는 스케줄에 안 나옴
  let row = (await admin('GET', '/api/dev-roadmap')).body.rows.find(r => r.id === id); assert.ok(row); assert.equal(row.term, '');
  assert.equal((await admin('PUT', `/api/dev-roadmap/${id}`, { term: 'x' })).status, 400);
  assert.equal((await admin('PUT', `/api/dev-roadmap/${id}`, { term: 'mid', start_date: '2026-12-01', target_date: '2026-11-01' })).status, 400, 'target before start');
  const ok = await admin('PUT', `/api/dev-roadmap/${id}`, { term: 'mid', start_date: '2026-11-01', target_date: '2027-03-31', progress: 40, current_stage: '1차 샘플 평가', next_step: '2차 샘플', next_date: '2026-12-15', steps: [{ name: '샘플 제작', start_date: '2026-11-01', end_date: '2026-11-20', status: 'done' }, { name: '고객 평가', start_date: '2026-11-21', end_date: '2026-12-10', status: 'doing' }, { name: '' }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  row = (await admin('GET', '/api/dev-roadmap')).body.rows.find(r => r.id === id);
  assert.equal(row.term, 'mid'); assert.equal(row.progress, 40); assert.equal(row.next_step, '2차 샘플'); assert.deepEqual(row.steps.map(s => [s.name, s.status]), [['샘플 제작', 'done'], ['고객 평가', 'doing']]);
  assert.equal((await prod('PUT', `/api/dev-roadmap/${id}`, { term: 'long' })).status, 403);
});

test('15.277 development owners (dev/sales) and the communication thread on a development request', async () => {
  const dev = await admin('POST', '/api/requests', { type: 'development', title: '항균 마스크', customer: '한솔', due_date: '2027-05-31', target_price: '50', data: { extra: 'x' } });
  const id = dev.body.id;
  const users = (await admin('GET', '/api/directory')).body, me = users.find(x => x.name !== '생산'), p = users.find(x => x.name === '생산');
  assert.equal((await prod('PUT', `/api/dev-roadmap/${id}/owners`, { dev_owner_id: p.id })).status, 403, 'production cannot assign');
  assert.equal((await admin('PUT', `/api/dev-roadmap/${id}/owners`, { dev_owner_id: 999999 })).status, 400);
  const ok = await admin('PUT', `/api/dev-roadmap/${id}/owners`, { dev_owner_id: me.id, sales_owner_id: p.id });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.changed, true);
  assert.equal((await admin('PUT', `/api/dev-roadmap/${id}/owners`, { dev_owner_id: me.id, sales_owner_id: p.id })).body.changed, false);
  // 스케줄 저장은 담당자를 지우지 않는다
  assert.equal((await admin('PUT', `/api/dev-roadmap/${id}`, { term: 'short', progress: 10 })).status, 200);
  let row = (await admin('GET', '/api/dev-roadmap?id=' + id)).body.rows[0];
  assert.equal(row.dev_owner_name, me.name); assert.equal(row.sales_owner_name, '생산'); assert.equal(row.term, 'short');
  assert.equal(row.comment_count, 1, 'owner change logged'); assert.match(row.last_comment, /\[담당자\] 개발 없음 → /);
  assert.equal((await prod('POST', `/api/comments/request/${id}`, { content: '[영업] 고객 2차 샘플 요청' })).status, 200);
  row = (await admin('GET', '/api/dev-roadmap?id=' + id)).body.rows[0];
  assert.equal(row.comment_count, 2); assert.match(row.last_comment, /고객 2차 샘플 요청/);
  const list = (await admin('GET', '/api/requests?type=development')).body.find(r => r.id === id);
  assert.equal(list.dev_owner_name, me.name); assert.equal(list.comment_count, 2);
  assert.equal((await admin('GET', '/api/dev-roadmap?id=abc')).status, 400);
});

test('15.279 non-woven (부직포) bags need no washing; a plan can be closed short and reopened', async () => {
  const nw = (await admin('POST', '/api/boms', { product: '부직포원단', product_code: 'NW-R', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '공급', request_id: rid(), lines: [{ bom_id: nw.id, lot: 'NW-L1', qty: 50 }] });
  const semi = (await admin('POST', '/api/boms', { product: 'NW 반제품', product_code: 'NWS', item_category: '반제품', kind: 'semi', semi_type: '부직포와이퍼', base_qty: 1, unit: '매', materials: [{ item: '부직포원단', item_category: '원자재', qty: 0.01, unit: 'kg' }] })).body;
  const line = (await admin('GET', '/api/production-units')).body.find(u => u.kind === 'line') || (await admin('POST', '/api/production-units', { kind: 'line', name: 'NW라인' })).body;
  const c = await prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '부직포와이퍼', start_time: '08:00', end_time: '10:00', qty: 500, inputs: [{ item: '부직포원단', lot: 'NW-L1', qty: 5 }] }], request_id: rid() });
  assert.equal(c.status, 200, JSON.stringify(c.body)); const bag = c.body.rows[0].lot;
  assert.ok(!(await prod('GET', '/api/semi-bags?state=unwashed')).body.rows.some(r => r.lot === bag), 'non-woven is not waiting for washing');
  const ready = (await prod('GET', '/api/semi-bags?state=washed')).body.rows.find(r => r.lot === bag);
  assert.ok(ready, 'non-woven bag can be packed without washing'); assert.equal(ready.wash_free, 1);
  const fin = (await admin('POST', '/api/boms', { product: 'NW 완제품', product_code: 'NWF', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [{ item: 'NW 반제품', item_category: '반제품', qty: 100, unit: '매' }] })).body;
  const plan = (await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: today, qty: 10, bom_id: fin.id })).body;
  const a = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 4, request_id: rid(), bags: [bag] });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.ok(!(await prod('GET', '/api/semi-wip')).body.some(r => /NW 반제품/.test(r.item)), 'non-woven not counted as waiting for washing');
  // 계획 10 중 4만 → 완료 처리 · 다시 열기
  const closed = await prod('PUT', `/api/schedules/${plan.id}`, { set_done: 1, reason: '원단 부족' });
  assert.equal(closed.status, 200, JSON.stringify(closed.body)); assert.equal(closed.body.done, 1);
  const log = (await prod('GET', `/api/comments/schedule/${plan.id}`)).body.rows.map(r => r.content);
  assert.ok(log.some(x => /\[완료 처리\] 계획 10 중 4 생산 \(부족 6\) · 원단 부족/.test(x)), JSON.stringify(log));
  assert.equal((await prod('PUT', `/api/schedules/${plan.id}`, { set_done: 0 })).body.done, 0);
});

test('15.283 product without a semi step (부직포와이퍼): work-in-progress without bags, then complete with chosen material LOTs', async () => {
  const raw = (await admin('POST', '/api/boms', { product: '부직포롤', product_code: 'NWR2', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  await admin('POST', '/api/receipts', { receipt_date: today, vendor: '공급', request_id: rid(), lines: [{ bom_id: raw.id, lot: 'NWR-A', qty: 30 }, { bom_id: raw.id, lot: 'NWR-B', qty: 30 }] });
  const fin = (await admin('POST', '/api/boms', { product: '부직포와이퍼 완제품', product_code: 'NWW', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [{ item: '부직포롤', item_category: '원자재', qty: 0.5, unit: 'kg' }] })).body;
  const plan = (await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: today, qty: 40, bom_id: fin.id })).body;
  const wip = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: '', work_status: 'progress', request_id: rid() });
  assert.equal(wip.status, 200, JSON.stringify(wip.body)); assert.equal(wip.body.lot, `${ymd}_NWW_P1`);
  const done = await prod('POST', `/api/actuals/${wip.body.id}/complete`, { qty: 20, inputs: [{ item: '부직포롤', lot: 'NWR-B', qty: 10 }] });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const bal = Object.fromEntries((await prod('GET', '/api/inventory/lots?q=' + encodeURIComponent('부직포롤'))).body.rows.map(r => [r.lot, r.balance]));
  assert.equal(bal['NWR-B'], 20); assert.equal(bal['NWR-A'], 30, 'chosen LOT used, not FIFO');
  // 반제품이 있는 품목은 여전히 봉투가 있어야 작업중
  const semiFin = sqlite.prepare("SELECT id FROM schedules WHERE bom_snapshot LIKE '%반제품%' LIMIT 1").get();
  if (semiFin) assert.equal((await prod('POST', `/api/schedules/${semiFin.id}/actuals`, { production_date: today, qty: '', work_status: 'progress', request_id: rid() })).status, 400);
});

test('15.284 purchase request made from a sales order keeps the order link; the order lists its purchase requests', async () => {
  const v = await admin('POST', '/api/vendors', { name: 'SO고객', type: 'sales' });
  const g = (await admin('POST', '/api/boms', { product: '니트릴 글러브', product_code: 'NG-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  const so = await admin('POST', '/api/sales-orders', { customer: 'SO고객', order_date: today, request_id: rid(), lines: [{ bom_id: g.id, qty: 50, unit_price: 12000 }] });
  assert.equal(so.status, 200, JSON.stringify([v.body, so.body]));
  const approver = (await admin('GET', '/api/directory')).body.find(x => x.name === '생산');
  const base = { doc_date: today, title: '', approvers: [approver.id], items: [{ item: '니트릴 글러브', unit: 'BOX', qty: 50, sale_price: 12000, customer: 'SO고객' }] };
  assert.equal((await admin('POST', '/api/purchase-requests', { ...base, request_id: rid(), sales_order_id: 999999 })).status, 400);
  const pr = await admin('POST', '/api/purchase-requests', { ...base, request_id: rid(), sales_order_id: so.body.id });
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.equal(pr.body.sales_order_id, so.body.id); assert.equal(pr.body.sales_order_no, so.body.order_no);
  const detail = (await admin('GET', '/api/sales-orders/' + so.body.id)).body;
  assert.deepEqual(detail.purchase_requests.map(p => [p.doc_no, p.status, p.items]), [[pr.body.doc_no, 'pending', 1]]);
  const found = (await admin('GET', '/api/purchase-requests?q=' + encodeURIComponent(so.body.order_no))).body;
  assert.ok(found.some(p => p.id === pr.body.id), 'search by order number');
  const plain = await admin('POST', '/api/purchase-requests', { ...base, request_id: rid() });
  assert.equal(plain.body.sales_order_id, null); assert.equal(plain.body.sales_order_no, '');
});

test('15.285 research-team analysis requests (rnd_analysis) and pending development requests stay off the schedule', async () => {
  assert.equal((await admin('POST', '/api/requests', { type: 'rnd_analysis', title: '경쟁사 와이퍼', customer: '자체', category: '수입검사', data: {} })).status, 400, 'quality categories are not research categories');
  const r = await admin('POST', '/api/requests', { type: 'rnd_analysis', title: '경쟁사 와이퍼', customer: '자체', category: '경쟁사분석', data: { items: ['파티클'], sample_qty: '2' } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'pending');
  assert.equal((await prod('POST', `/api/requests/${r.body.id}/approve`)).status, 403, 'only the research approver');
  const ok = await admin('POST', `/api/requests/${r.body.id}/approve`);
  assert.equal(ok.status, 200); assert.match(ok.body.req_no, /^RA-\d{6}-01$/);
  const list = (await admin('GET', '/api/requests?type=rnd_analysis&scope=list&category=' + encodeURIComponent('경쟁사분석'))).body;
  assert.deepEqual(list.map(x => x.id), [r.body.id]);
  assert.ok(!(await admin('GET', '/api/requests?type=analysis&scope=list')).body.some(x => x.id === r.body.id), 'separate from quality analysis');
  const mgr = (await admin('GET', '/api/approval-managers')).body; assert.ok(Array.isArray(mgr.rnd_analysis));
  // 개발 스케줄: 접수대기(승인 전) 의뢰는 안 나옴
  const dev = await admin('POST', '/api/requests', { type: 'development', title: '접수대기 과제', customer: 'X', due_date: '2027-01-31', target_price: '1', data: { extra: 'x' } });
  assert.ok(!(await admin('GET', '/api/dev-roadmap')).body.rows.some(x => x.id === dev.body.id), 'pending not on the roadmap');
  await admin('POST', `/api/requests/${dev.body.id}/approve`);
  assert.ok((await admin('GET', '/api/dev-roadmap')).body.rows.some(x => x.id === dev.body.id), 'approved shows');
});

test('15.286 research analyses linked to a development item and roadmap step; results kept as history on both', async () => {
  const dev = (await admin('POST', '/api/requests', { type: 'development', title: '항균 와이퍼', customer: 'A사', due_date: '2027-03-31', target_price: '1', data: { extra: 'x' } })).body;
  await admin('POST', `/api/requests/${dev.id}/approve`);
  await admin('PUT', `/api/dev-roadmap/${dev.id}`, { term: 'short', steps: [{ name: '1차 샘플', start_date: '2026-11-01', end_date: '2026-11-30', status: 'doing' }, { name: '고객 평가', start_date: '2026-12-01', end_date: '2026-12-31', status: 'todo' }] });
  assert.equal((await admin('POST', '/api/requests', { type: 'rnd_analysis', title: 'x', category: '원료분석', data: { dev_request_id: 999999 } })).status, 400);
  const a1 = (await admin('POST', '/api/requests', { type: 'rnd_analysis', title: '1차 샘플 파티클', category: '시제품분석', data: { items: ['파티클'], dev_request_id: dev.id, dev_step: '1차 샘플' } })).body;
  assert.equal(a1.data.dev_request_id, dev.id); assert.equal(a1.data.dev_step, '1차 샘플'); assert.equal(a1.data.dev_title, '항균 와이퍼');
  const a2 = (await admin('POST', '/api/requests', { type: 'rnd_analysis', title: '경쟁사 비교', category: '경쟁사분석', data: {} })).body;
  for (const a of [a1, a2]) await admin('POST', `/api/requests/${a.id}/approve`);
  // 결과 입력 → 분석 자체와 개발건 소통에 이력
  assert.equal((await admin('POST', `/api/requests/${a1.id}/status`, { status: 'progress', result_note: '파티클 120/ft² (기준 150 이하)' })).status, 200);
  await admin('POST', `/api/requests/${a1.id}/status`, { status: 'done', result_note: '파티클 95/ft² 합격' });
  const devTalk = (await admin('GET', `/api/comments/request/${dev.id}`)).body.rows.map(c => c.content);
  assert.ok(devTalk.some(c => /^\[분석\] 분석의뢰 등록 · 1차 샘플 파티클/.test(c)));
  assert.ok(devTalk.some(c => /^\[분석\] RA-.* 진행 · 결과: 파티클 120.*단계 「1차 샘플」/.test(c)), JSON.stringify(devTalk));
  assert.ok(devTalk.some(c => /완료 · 결과: 파티클 95\/ft² 합격/.test(c)));
  assert.equal((await admin('GET', `/api/comments/request/${a1.id}`)).body.rows.filter(c => /^\[분석결과\]/.test(c.content)).length, 2, 'own history too');
  // 나중에 연결: 단계 「고객 평가」
  const linked = await admin('POST', `/api/requests/${a2.id}/dev-link`, { dev_request_id: dev.id, dev_step: '고객 평가' });
  assert.equal(linked.status, 200, JSON.stringify(linked.body)); assert.equal(linked.body.data.dev_step, '고객 평가');
  assert.equal((await prod('POST', `/api/requests/${a2.id}/dev-link`, { dev_request_id: '' })).status, 403);
  const row = (await admin('GET', '/api/dev-roadmap?id=' + dev.id)).body.rows[0];
  assert.deepEqual(row.analyses.map(a => [a.title, a.dev_step, a.status, a.result_note]), [['1차 샘플 파티클', '1차 샘플', 'done', '파티클 95/ft² 합격'], ['경쟁사 비교', '고객 평가', 'waiting', '']]);
  assert.equal((await admin('GET', '/api/dev-roadmap')).body.rows.find(r => r.id === dev.id).analyses.length, 2);
  // 끊기
  await admin('POST', `/api/requests/${a2.id}/dev-link`, { dev_request_id: '' });
  assert.equal((await admin('GET', '/api/dev-roadmap?id=' + dev.id)).body.rows[0].analyses.length, 1);
});

test('15.287 analysis data entered directly on a development step: done RA- record linked to the step, history kept, research role only', async () => {
  const dev = (await admin('POST', '/api/requests', { type: 'development', title: '저분진 장갑', customer: 'B사', due_date: '2027-03-31', target_price: '1', data: { extra: 'x' } })).body;
  await admin('POST', `/api/requests/${dev.id}/approve`);
  await admin('PUT', `/api/dev-roadmap/${dev.id}`, { term: 'mid', steps: [{ name: '시제품', start_date: '2026-11-01', end_date: '2026-12-31', status: 'doing' }] });
  const body = { dev_step: '시제품', title: '시제품 A', category: '시제품분석', items: ['파티클', '인장,인열'], result_note: '파티클 80/ft² 합격', analysis_date: '2026-11-18' };
  assert.equal((await prod('POST', `/api/dev-roadmap/${dev.id}/analysis-data`, body)).status, 403);
  assert.equal((await admin('POST', `/api/dev-roadmap/${dev.id}/analysis-data`, { ...body, result_note: '' })).status, 400);
  const r = await admin('POST', `/api/dev-roadmap/${dev.id}/analysis-data`, body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.req_no, /^RA-261118-\d{2}$/); assert.equal(r.body.status, 'done'); assert.equal(r.body.result_note, '파티클 80/ft² 합격');
  assert.equal(r.body.data.dev_step, '시제품'); assert.deepEqual(r.body.data.items, ['파티클', '인장,인열']); assert.equal(r.body.data.token, undefined);
  const r2 = (await admin('POST', `/api/dev-roadmap/${dev.id}/analysis-data`, { ...body, title: '시제품 B', result_note: '흡수 4.1' })).body;
  assert.notEqual(r2.req_no, r.body.req_no, 'own number each');
  const row = (await admin('GET', '/api/dev-roadmap?id=' + dev.id)).body.rows[0];
  assert.deepEqual(row.analyses.map(a => [a.title, a.dev_step, a.status, a.analysis_date]), [['시제품 A', '시제품', 'done', '2026-11-18'], ['시제품 B', '시제품', 'done', '2026-11-18']]);
  const talk = (await admin('GET', `/api/comments/request/${dev.id}`)).body.rows.map(c => c.content);
  assert.ok(talk.some(c => /^\[분석\] 분석데이터 · RA-261118-\d{2} 시제품 A \(시제품분석\) · 단계 「시제품」 · 분석일 2026-11-18 · 결과: 파티클 80/.test(c)), JSON.stringify(talk));
  assert.equal((await admin('PUT', `/api/attachments/request/${r.body.id}`, { photos: [] })).status === 404, false, 'attachments allowed for research analysis');
});

test('15.288 research analysis data entry is researcher-only; unlinked data can later be matched to a roadmap step', async () => {
  assert.equal((await prod('POST', '/api/requests', { type: 'rnd_analysis', title: 'x', category: '원료분석', data: {} })).status, 403, 'not a researcher');
  assert.equal((await prod('POST', '/api/rnd-analysis-data', { title: 'x', category: '원료분석', result_note: 'y' })).status, 403);
  const free = await admin('POST', '/api/rnd-analysis-data', { title: '원료 롤 C', category: '원료분석', items: ['규격'], result_note: '평량 40.2g/㎡', analysis_date: '2026-11-15', customer: '자체' });
  assert.equal(free.status, 200, JSON.stringify(free.body)); assert.equal(free.body.status, 'done'); assert.match(free.body.req_no, /^RA-261115-\d{2}$/);
  assert.equal(free.body.data.dev_request_id, undefined, 'no development link chosen');
  const dev = (await admin('POST', '/api/requests', { type: 'development', title: '원료 변경 과제', customer: 'C사', due_date: '2027-02-28', target_price: '1', data: { extra: 'x' } })).body;
  await admin('POST', `/api/requests/${dev.id}/approve`);
  await admin('PUT', `/api/dev-roadmap/${dev.id}`, { term: 'long', steps: [{ name: '원료 검토', start_date: '2026-11-01', end_date: '2026-12-31', status: 'doing' }] });
  const done = (await admin('GET', '/api/requests?type=rnd_analysis&status=done')).body; assert.ok(done.some(a => a.id === free.body.id));
  // 로드맵 단계에서 불러와 맞추기 = dev-link
  assert.equal((await admin('POST', `/api/requests/${free.body.id}/dev-link`, { dev_request_id: dev.id, dev_step: '원료 검토' })).status, 200);
  const row = (await admin('GET', '/api/dev-roadmap?id=' + dev.id)).body.rows[0];
  assert.deepEqual(row.analyses.map(a => [a.title, a.dev_step, a.result_note, a.analysis_date]), [['원료 롤 C', '원료 검토', '평량 40.2g/㎡', '2026-11-15']]);
  const linkedAtEntry = (await admin('POST', '/api/rnd-analysis-data', { title: '원료 롤 D', category: '원료분석', result_note: '평량 39.8', dev_request_id: dev.id, dev_step: '원료 검토' })).body;
  assert.equal(linkedAtEntry.customer, 'C사', 'customer from the development item'); assert.equal(linkedAtEntry.data.dev_step, '원료 검토');
});

test('15.292 research analysis data in inspection format: spec items + readings, automatic judgement and summary, edit with history', async () => {
  const items = [{ name: '파티클', unit: 'ea/ft²', min: '', max: 150, count: 3 }, { name: '흡수속도', unit: '초', min: 0, max: 60, count: 2 }, { name: '평량', unit: 'g/㎡', min: '', max: '', count: 1 }];
  assert.equal((await admin('POST', '/api/rnd-analysis-data', { title: 'x', category: '시제품분석', spec_items: items, values: {} })).status, 400, 'at least one reading');
  const r = await admin('POST', '/api/rnd-analysis-data', { title: '시제품 C', category: '시제품분석', spec_items: items, values: { i0: [90, 100, 110], i1: [40, 45], i2: [40.2] }, result_note: '양호' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.result_note, /^전 항목 합격 \(2항목\) \/ 의견: 양호$/, r.body.result_note); // 15.299 짧은 요약
  const m = (await admin('GET', `/api/requests/${r.body.id}/rnd-measure`)).body;
  assert.equal(m.measurement.result, 'pass'); assert.deepEqual(m.spec.items.map(i => [i.name, i.min, i.max, i.count]), [['파티클', null, 150, 3], ['흡수속도', 0, 60, 2], ['평량', null, null, 1]]);
  assert.equal(m.memo, '양호');
  // 수정: 사유 필요, 불합격으로
  assert.equal((await admin('PUT', `/api/requests/${r.body.id}/rnd-measure`, { spec_items: items, values: { i0: [90, 200, 110], i1: [40, 45], i2: [40.2] } })).status, 400, 'reason required');
  assert.equal((await prod('PUT', `/api/requests/${r.body.id}/rnd-measure`, { spec_items: items, values: { i0: [1, 1, 1] }, reason: 'x' })).status, 403);
  const e = await admin('PUT', `/api/requests/${r.body.id}/rnd-measure`, { spec_items: items, values: { i0: [90, 200, 110], i1: [40, 45], i2: [40.2] }, reason: '재측정' });
  assert.equal(e.status, 200, JSON.stringify(e.body)); assert.match(e.body.result_note, /^불합격 1항목: 파티클 평균 133\.333 ea\/ft² \(≤150\) \/ 의견: 양호$/, e.body.result_note);
  const m2 = (await admin('GET', `/api/requests/${r.body.id}/rnd-measure`)).body; assert.equal(m2.measurement.result, 'fail'); assert.equal(m2.measurement.revision, 2);
  // 메모만으로도(측정 없이) 저장 가능
  assert.equal((await admin('POST', '/api/rnd-analysis-data', { title: '관찰', category: '기타', result_note: '외관 이상 없음' })).status, 200);
  assert.equal((await admin('POST', '/api/rnd-analysis-data', { title: '빈', category: '기타' })).status, 400);
});

test('15.293 research measurements with several samples (grid like quality analysis results)', async () => {
  const items = [{ name: '파티클', unit: 'ea', max: 150, count: 2 }, { name: '흡수', unit: 's', min: 0, max: 60, count: 1 }];
  const r = await admin('POST', '/api/rnd-analysis-data', { title: '비교 시험', category: '경쟁사분석', spec_items: items, samples: [{ lot: '당사', values: { i0: [90, 110], i1: [40] } }, { lot: '경쟁사 A', values: { i0: [180, 200], i1: [55] } }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.result_note, /^시료 2개 · 불합격 1항목: 파티클 평균 145 ea \(≤150\) \[경쟁사 A\]$/, r.body.result_note); const sm = (await admin('GET', `/api/requests/${r.body.id}/rnd-measure`)).body.summary; assert.equal(sm, '시료 2개 · 불합격 1항목: 파티클 평균 145 ea (≤150) [경쟁사 A]');
  const m = (await admin('GET', `/api/requests/${r.body.id}/rnd-measure`)).body;
  assert.deepEqual(m.measurement.rows.map(x => [x.lot, x.values.i0]), [['당사', [90, 110]], ['경쟁사 A', [180, 200]]]);
  assert.equal((await admin('POST', '/api/rnd-analysis-data', { title: 'x', category: '기타', spec_items: items, samples: Array.from({ length: 21 }, () => ({ values: { i0: [1, 1], i1: [1] } })) })).status, 400);
});

test('15.299 production request made from a sales order keeps the order link; the order lists its production requests', async () => {
  await admin('POST', '/api/vendors', { name: 'MR고객', type: 'sales' });
  const g = (await admin('POST', '/api/boms', { product: 'MR 와이퍼', product_code: 'MRW-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  const so = (await admin('POST', '/api/sales-orders', { customer: 'MR고객', customer_po: 'PO-77', order_date: today, request_id: rid(), lines: [{ bom_id: g.id, qty: 30, unit_price: 1000 }] })).body;
  const base = { customer: 'MR고객', order_no: 'PO-77', order_date: today, lines: [{ bom_id: g.id, item: g.product, qty: 30, unit: 'BOX' }] };
  assert.equal((await admin('POST', '/api/production-requests', { ...base, request_id: rid(), sales_order_id: 999999 })).status, 400);
  assert.equal((await admin('POST', '/api/production-requests', { ...base, request_id: rid(), sales_order_id: 'x' })).status, 400);
  const mr = await admin('POST', '/api/production-requests', { ...base, request_id: rid(), sales_order_id: so.id });
  assert.equal(mr.status, 200, JSON.stringify(mr.body)); assert.equal(mr.body.sales_order_id, so.id); assert.equal(mr.body.sales_order_no, so.order_no);
  const plain = (await admin('POST', '/api/production-requests', { ...base, request_id: rid() })).body; assert.equal(plain.sales_order_id, null);
  const d = (await admin('GET', `/api/sales-orders/${so.id}`)).body;
  assert.deepEqual(d.production_requests.map(x => [x.id, x.req_no, x.items]), [[mr.body.id, mr.body.req_no, 1]]);
});

test('15.299 production request linked to a sales order is marked shipped automatically once the whole order ships', async () => {
  await admin('POST', '/api/vendors', { name: '자동출고고객', is_sales: true, is_purchase: true });
  const g = (await admin('POST', '/api/boms', { product: '자동출고 와이퍼', product_code: 'AS-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  const rc = await admin('POST', '/api/receipts', { receipt_date: today, vendor: '자동출고고객', request_id: rid(), lines: [{ bom_id: g.id, lot: 'AS-LOT', qty: 100 }] }); assert.equal(rc.status, 200, JSON.stringify(rc.body));
  const so = (await admin('POST', '/api/sales-orders', { customer: '자동출고고객', order_date: today, request_id: rid(), lines: [{ bom_id: g.id, qty: 30, unit_price: 1000 }] })).body;
  const mr = (await admin('POST', '/api/production-requests', { customer: '자동출고고객', order_date: today, request_id: rid(), sales_order_id: so.id, lines: [{ bom_id: g.id, item: g.product, qty: 30, unit: 'BOX' }] })).body;
  const other = (await admin('POST', '/api/production-requests', { customer: '자동출고고객', order_date: today, request_id: rid(), lines: [{ bom_id: g.id, item: g.product, qty: 5, unit: 'BOX' }] })).body;
  const bill = async qty => admin('POST', '/api/sales-bills', { customer: '자동출고고객', bill_date: today, request_id: rid(), lines: [{ source_type: 'order', order_line_id: so.lines[0].id, qty }] });
  const ship = async () => { const ins = (await admin('GET', '/api/ship-instructions')).body.rows.filter(i => i.order_no === so.order_no && i.status !== 'shipped'); return admin('POST', '/api/ship-instructions/ship', { ids: ins.map(i => i.id), ship_date: today, lots: Object.fromEntries(ins.map(i => [i.id, 'AS-LOT'])) }); };
  assert.equal((await bill(20)).status, 200); assert.equal((await ship()).status, 200);
  assert.equal((await admin('GET', `/api/production-requests/${mr.id}`)).body.shipped, false, 'part shipped: not yet');
  assert.equal((await bill(10)).status, 200); const s2 = await ship(); assert.equal(s2.status, 200, JSON.stringify(s2.body));
  const after = (await admin('GET', `/api/production-requests/${mr.id}`)).body;
  assert.equal(after.shipped, true); assert.equal(after.shipped_date, today); assert.match(after.shipped_by, /수주 출하 완료 자동/);
  assert.equal((await admin('GET', `/api/production-requests/${other.id}`)).body.shipped, false, 'unlinked request untouched');
});

test('15.302 intellectual property rights: researchers register, edit and renew; dates and duplicates checked; others read only', async () => {
  const base = { kind: '특허', country: 'KR', title: '흡수성 부직포 와이퍼', app_no: '10-2020-0001', app_date: '2020-03-02', reg_date: '2022-05-10', reg_no: '10-2400001', expire_date: '2040-03-02', next_due: '2026-05-10', due_kind: '연차료 납부', status: 'registered', holder: '서울세미텍' };
  assert.equal((await admin('POST', '/api/ip-rights', { ...base, kind: '없는것' })).status, 400);
  assert.equal((await admin('POST', '/api/ip-rights', { ...base, reg_date: '2019-01-01' })).status, 400, 'reg before application');
  assert.equal((await admin('POST', '/api/ip-rights', { ...base, reg_no: '' })).status, 400, 'registered needs a number');
  assert.equal((await prod('POST', '/api/ip-rights', base)).status, 403);
  const r = await admin('POST', '/api/ip-rights', { ...base, request_id: rid() }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status_label, '등록완료'); assert.equal(r.body.history.length, 1);
  assert.equal((await admin('POST', '/api/ip-rights', { ...base, request_id: rid() })).status, 400, 'duplicate registration number');
  const list = await prod('GET', '/api/ip-rights'); assert.equal(list.status, 200); assert.equal(list.body.can_manage, false); assert.ok(list.body.rows.some(x => x.id === r.body.id));
  assert.equal((await admin('POST', `/api/ip-rights/${r.body.id}/renew`, { revision: r.body.revision, next_due: '2026-05-01' })).status, 400, 'next due must move forward');
  const n = await admin('POST', `/api/ip-rights/${r.body.id}/renew`, { revision: r.body.revision, next_due: '2027-05-10', note: '5년차' }); assert.equal(n.status, 200, JSON.stringify(n.body));
  assert.equal(n.body.next_due, '2027-05-10'); assert.equal(n.body.history.at(-1).what, '갱신'); assert.equal(n.body.history.at(-1).due, '2026-05-10');
  assert.equal((await admin('PUT', `/api/ip-rights/${r.body.id}`, { ...base, status: 'expired', revision: r.body.revision })).status, 409, 'stale revision');
  const e = await admin('PUT', `/api/ip-rights/${r.body.id}`, { ...base, next_due: '2027-05-10', status: 'expired', revision: n.body.revision }); assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.deepEqual(e.body.history.at(-1).status, ['registered', 'expired']);
  const tm = (await admin('POST', '/api/ip-rights', { kind: '상표', title: 'SST', status: 'filed', app_date: '2025-01-01' })).body; assert.equal(tm.reg_no, '');
  assert.equal((await admin('POST', `/api/ip-rights/${tm.id}/renew`, { revision: tm.revision, next_due: '2030-01-01' })).status, 400, 'only registered rights renew');
  assert.equal((await admin('DELETE', `/api/ip-rights/${tm.id}?revision=${tm.revision}`)).status, 200);
});

test('15.303 certifications: quality registers ISO/GRS certificates, records audits (surveillance, renewal, nonconformity), others read only', async () => {
  const base = { kind: 'ISO 9001', cert_no: 'FS 600001', scope: '와이퍼 제조', body: 'BSI', first_date: '2020-06-01', issue_date: '2023-06-01', expire_date: '2026-05-31', next_audit: '2025-06-01', audit_kind: '2차 사후심사', status: 'valid' };
  assert.equal((await admin('POST', '/api/certs', { ...base, kind: 'ISO 0000' })).status, 400);
  assert.equal((await admin('POST', '/api/certs', { ...base, expire_date: '2023-01-01' })).status, 400, 'expiry after issue');
  assert.equal((await admin('POST', '/api/certs', { ...base, cert_no: '' })).status, 400, 'valid needs a number');
  assert.equal((await admin('POST', '/api/certs', { kind: '기타', status: 'prep' })).status, 400, 'other needs a name');
  assert.equal((await prod('POST', '/api/certs', base)).status, 403);
  const c = await admin('POST', '/api/certs', { ...base, request_id: rid() }); assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.status_label, '유효');
  assert.equal((await admin('POST', '/api/certs', { ...base, request_id: rid() })).status, 400, 'duplicate number');
  const l = await prod('GET', '/api/certs'); assert.equal(l.status, 200); assert.equal(l.body.can_manage, false);
  // 사후심사 적합 → 다음 심사 넘김
  const s1 = await admin('POST', `/api/certs/${c.body.id}/audit`, { revision: c.body.revision, done_date: '2025-06-03', result: '적합', next_audit: '2026-03-01', next_kind: '갱신심사' }); assert.equal(s1.status, 200, JSON.stringify(s1.body));
  assert.equal(s1.body.next_audit, '2026-03-01'); assert.equal(s1.body.audit_kind, '갱신심사'); assert.equal(s1.body.history.at(-1).result, '적합');
  // 부적합 → 정지, 갱신심사 적합 → 새 유효기간·유효
  const s2 = await admin('POST', `/api/certs/${c.body.id}/audit`, { revision: s1.body.revision, done_date: '2026-03-02', result: '부적합', next_audit: '2026-04-01', next_kind: '특별심사' }); assert.equal(s2.body.status, 'suspended');
  assert.equal((await admin('POST', `/api/certs/${c.body.id}/audit`, { revision: s2.body.revision, done_date: '2026-04-02', next_audit: '2026-04-01' })).status, 400, 'next audit after the audit');
  const s3 = await admin('POST', `/api/certs/${c.body.id}/audit`, { revision: s2.body.revision, done_date: '2026-04-02', result: '적합', issue_date: '2026-06-01', expire_date: '2029-05-31', next_audit: '2027-06-01', next_kind: '1차 사후심사' });
  assert.equal(s3.status, 200, JSON.stringify(s3.body)); assert.equal(s3.body.status, 'valid'); assert.equal(s3.body.expire_date, '2029-05-31'); assert.deepEqual(s3.body.history.at(-1).expire, ['2026-05-31', '2029-05-31']);
  const g = (await admin('POST', '/api/certs', { kind: 'GRS', status: 'prep', body: 'Control Union' })).body;
  assert.equal((await admin('POST', `/api/certs/${g.id}/audit`, { revision: g.revision })).status, 400, 'prep cannot be audited');
  assert.equal((await admin('PUT', `/api/certs/${g.id}`, { kind: 'GRS', status: 'valid', cert_no: 'CU-GRS-1', issue_date: '2026-01-10', expire_date: '2027-01-09', revision: g.revision })).status, 200);
});

test('15.304 calibration: instrument register, next due = calibrated + cycle - 1 day, batch calibration, nonconforming takes it out of use', async () => {
  const t01 = { mgmt_no: 't-01', name: '온습도계', model: 'TR-72wb', maker: 'T&D', location: '1동', cycle_months: 12, cal_type: 'external', cal_agency: 'KTL', last_cal: '2026-12-01', last_result: '적합', status: 'in_use' };
  assert.equal((await prod('POST', '/api/instruments', t01)).status, 403);
  assert.equal((await admin('POST', '/api/instruments', { ...t01, cycle_months: 0 })).status, 400);
  assert.equal((await admin('POST', '/api/instruments', { ...t01, next_due: '2026-11-01' })).status, 400, 'next due after last');
  const a = await admin('POST', '/api/instruments', { ...t01, request_id: rid() }); assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.mgmt_no, 'T-01'); assert.equal(a.body.next_due, '2027-11-30', '2026-12-01 + 1 year - 1 day'); assert.equal(a.body.history.length, 2);
  assert.equal((await admin('POST', '/api/instruments', { ...t01, request_id: rid() })).status, 400, 'duplicate management number');
  const b = (await admin('POST', '/api/instruments', { ...t01, mgmt_no: 'B-01', name: '전자저울', cycle_months: 6, last_cal: '2026-01-31' })).body;
  assert.equal(b.next_due, '2026-07-30');
  const c = (await admin('POST', '/api/instruments', { ...t01, mgmt_no: 'C-01', name: '파티클 카운터', last_cal: '2025-11-01' })).body;
  assert.equal((await prod('GET', '/api/instruments')).body.can_manage, false);
  assert.equal((await admin('POST', '/api/instruments/calibrate', { items: [{ id: a.body.id, revision: a.body.revision }], done_date: today, result: '부적합' })).status, 400, 'nonconforming needs a note');
  assert.equal((await admin('POST', '/api/instruments/calibrate', { items: [{ id: a.body.id, revision: a.body.revision }], done_date: '2099-01-01', result: '적합' })).status, 400, 'no future date');
  const batch = await admin('POST', '/api/instruments/calibrate', { items: [{ id: c.id, revision: c.revision }, { id: b.id, revision: b.revision }], done_date: '2026-11-02', result: '적합', agency: 'KTC' });
  assert.equal(batch.status, 200, JSON.stringify(batch.body)); const byNo = Object.fromEntries(batch.body.rows.map(r => [r.mgmt_no, r]));
  assert.equal(byNo['C-01'].next_due, '2027-11-01'); assert.equal(byNo['B-01'].next_due, '2027-05-01'); assert.equal(byNo['B-01'].cal_agency, 'KTC'); assert.equal(byNo['C-01'].history.at(-1).due, '2026-10-31');
  assert.equal((await admin('POST', '/api/instruments/calibrate', { items: [{ id: b.id, revision: b.revision }], done_date: today, result: '적합' })).status, 409, 'stale revision');
  const bad = await admin('POST', '/api/instruments/calibrate', { items: [{ id: b.id, revision: byNo['B-01'].revision }], done_date: '2026-11-03', result: '부적합', note: '편차 0.5g 초과, 지난 측정 재검토' });
  assert.equal(bad.body.rows[0].status, 'out'); assert.deepEqual(bad.body.rows[0].history.at(-1).status, ['in_use', 'out']);
  const ok2 = await admin('POST', '/api/instruments/calibrate', { items: [{ id: b.id, revision: bad.body.rows[0].revision }], done_date: '2026-11-04', result: '조정 후 적합', next_due: '2027-03-01' });
  assert.equal(ok2.body.rows[0].status, 'in_use'); assert.equal(ok2.body.rows[0].next_due, '2027-03-01', 'single item can set next due');
});

test('15.305 quality analysis requests take measurements in the grid; COA per LOT from passing measurements (approve, reissue, void); CAPA steps', async () => {
  // 분석의뢰(의뢰검사): 접수 전에는 측정값 불가, 접수 뒤 항목·기준·데이터를 바로 넣음
  const q = (await admin('POST', '/api/requests', { type: 'analysis', title: 'CF707 와이퍼', category: '의뢰검사', data: { lot: '있음', lot_etc: 'COA-LOT-1', items: ['파티클'] } })).body;
  const items = [{ name: '파티클', unit: 'ea', max: 150, count: 2 }, { name: '흡수속도', unit: '초', min: 0, max: 60, count: 1 }];
  assert.equal((await admin('PUT', `/api/requests/${q.id}/rnd-measure`, { spec_items: items, samples: [{ lot: 'S1', values: { i0: [90, 110], i1: [40] } }] })).status, 400, 'needs intake first');
  assert.equal((await prod('PUT', `/api/requests/${q.id}/rnd-measure`, { spec_items: items, values: { i0: [1, 1] } })).status, 403);
  const ap = await admin('POST', `/api/requests/${q.id}/approve`); q.req_no = ap.body.req_no || (await admin('GET', '/api/requests?type=analysis')).body.find(x => x.id === q.id)?.req_no; assert.match(q.req_no || '', /^Q-/, JSON.stringify(ap.body).slice(0, 200));
  const fail1 = await admin('PUT', `/api/requests/${q.id}/rnd-measure`, { spec_items: items, samples: [{ lot: 'S1', values: { i0: [90, 210], i1: [40] } }] });
  assert.equal(fail1.status, 200, JSON.stringify(fail1.body)); assert.match(fail1.body.result_note, /^불합격 1항목: 파티클/);
  // 불합격이면 COA 발행 안 됨
  assert.match((await admin('POST', '/api/coas', { lot: 'COA-LOT-1' })).body.error, /합격이 아닙니다/);
  assert.match((await admin('POST', '/api/coas', { lot: 'NO-SUCH' })).body.error, /측정 기록/);
  await admin('PUT', `/api/requests/${q.id}/rnd-measure`, { spec_items: items, samples: [{ lot: 'S1', values: { i0: [90, 110], i1: [40] } }], reason: '재측정' });
  const src = (await admin('GET', '/api/coa/source?lot=COA-LOT-1')).body;
  assert.equal(src.candidates.length, 1); assert.deepEqual(src.source.items.map(i => [i.name, i.spec, i.avg, i.judge]), [['파티클', '≤ 150', 100, '적합'], ['흡수속도', '0 ~ 60', 40, '적합']]);
  assert.equal((await prod('POST', '/api/coas', { lot: 'COA-LOT-1' })).status, 403);
  const c = await admin('POST', '/api/coas', { lot: 'COA-LOT-1', customer: '삼성', mfg_date: '2026-01-10', lang: 'en', request_id: rid() });
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.match(c.body.coa_no, new RegExp(`^COA-${ymd}-01$`)); assert.equal(c.body.status, 'draft'); assert.equal(c.body.items.length, 2); assert.equal(c.body.source_no, q.req_no);
  const ok = await admin('POST', `/api/coas/${c.body.id}/approve`, { revision: c.body.revision }); assert.equal(ok.body.status, 'approved'); assert.equal(ok.body.approved_by, '관리자');
  const re = await admin('PUT', `/api/coas/${c.body.id}`, { customer: '삼성전자', revision: ok.body.revision }); assert.equal(re.status, 200);
  assert.equal(re.body.status, 'draft'); assert.equal(re.body.rev, 1, 'reissue raises Rev'); assert.equal(re.body.history.at(-1).prev.customer, '삼성');
  assert.equal((await admin('POST', `/api/coas/${c.body.id}/void`, { revision: re.body.revision })).status, 400, 'void needs a reason');
  assert.equal((await admin('POST', `/api/coas/${c.body.id}/void`, { revision: re.body.revision, reason: '고객사 오기' })).body.status, 'void');
  // CAPA: 분석의뢰에서 등록 → 단계마다 필요한 내용
  const n = await admin('POST', '/api/ncs', { source_type: 'analysis', source_id: q.id, title: '파티클 초과', request_id: rid() });
  assert.equal(n.status, 200, JSON.stringify(n.body)); assert.equal(n.body.source_no, q.req_no); assert.equal(n.body.lot, 'COA-LOT-1'); assert.match(n.body.nc_no, new RegExp(`^NC-${ymd}-01$`));
  assert.equal((await prod('POST', '/api/ncs', { title: 'x' })).status, 403);
  assert.match((await admin('PUT', `/api/ncs/${n.body.id}`, { status: 'action', revision: n.body.revision })).body.error, /원인분석/);
  const a1 = await admin('PUT', `/api/ncs/${n.body.id}`, { status: 'action', cause_json: { why1: '필터 교체 지연', root: 'PM 주기 누락' }, revision: n.body.revision }); assert.equal(a1.body.status, 'action');
  assert.match((await admin('PUT', `/api/ncs/${n.body.id}`, { status: 'verify', revision: a1.body.revision })).body.error, /시정조치/);
  const a2 = await admin('PUT', `/api/ncs/${n.body.id}`, { status: 'verify', corrective: '필터 교체 주기 PM 등록', revision: a1.body.revision });
  assert.match((await admin('PUT', `/api/ncs/${n.body.id}`, { status: 'closed', revision: a2.body.revision })).body.error, /유효/);
  const done = await admin('PUT', `/api/ncs/${n.body.id}`, { status: 'closed', verify_result: '유효', verify_date: today, revision: a2.body.revision });
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.status, 'closed'); assert.equal(done.body.closed_by, '관리자');
  assert.equal((await admin('PUT', `/api/ncs/${n.body.id}`, { title: '고침', revision: done.body.revision })).status, 400, 'closed is locked');
  assert.equal((await admin('GET', `/api/ncs?source_type=analysis&source_id=${q.id}`)).body.rows.length, 1);
});

test('15.306 QA system: controlled documents (draft, review, approve, revise, obsolete, dept access), change control steps, training and qualifications, supplier quality card and supplier COA', async () => {
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  const u = (await admin('GET', '/api/admin/users')).body.find(x => x.name === '생산');
  await admin('PUT', `/api/admin/users/${u.id}`, { roles: ['production', 'logistics'] });
  // A1 문서: 번호 자동(QP-01), 파일 없이 검토 불가, 승인 → 판 이력, 개정 → Rev.1, 폐지
  const d = await admin('POST', '/api/qdocs', { kind: 'procedure', title: '부적합품 관리 절차서', dept: '품질', training_needed: true, request_id: rid() });
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.equal(d.body.doc_no, 'QP-01'); assert.equal(d.body.status, 'draft'); assert.equal(d.body.rev, 0);
  assert.match((await admin('POST', `/api/qdocs/${d.body.id}/step`, { to: 'review', revision: d.body.revision })).body.error, /파일/);
  assert.match((await admin('PUT', `/api/qdocs/${d.body.id}`, { files: [{ data: 'data:application/pdf;base64,AAAA', name: 'x.pdf' }], revision: d.body.revision })).body.error, /PDF/);
  const d1 = await admin('PUT', `/api/qdocs/${d.body.id}`, { files: [{ data: pdf, name: 'QP-01 부적합품.pdf' }], revision: d.body.revision });
  assert.equal(d1.status, 200, JSON.stringify(d1.body)); assert.match(d1.body.file.file, /^[a-f0-9]{24}\.pdf$/);
  const got = await worker.fetch(new Request('https://lot249.test/uploads/' + d1.body.file.file), env); assert.equal(got.status, 401, 'files need login');
  const d2 = await admin('POST', `/api/qdocs/${d.body.id}/step`, { to: 'review', revision: d1.body.revision }); assert.equal(d2.body.status, 'review');
  const d3 = await admin('POST', `/api/qdocs/${d.body.id}/step`, { to: 'approved', revision: d2.body.revision });
  assert.equal(d3.body.status, 'approved'); assert.equal(d3.body.versions.length, 1); assert.equal(d3.body.training_suggest, true); assert.equal(d3.body.effective_date, today); assert.ok(d3.body.next_review > today);
  assert.equal((await admin('PUT', `/api/qdocs/${d.body.id}`, { title: '바꿈', revision: d3.body.revision })).body.title, '부적합품 관리 절차서', 'approved content locked');
  const d4 = (await admin('GET', '/api/qdocs')).body.rows.find(x => x.id === d.body.id);
  const r1 = await admin('POST', `/api/qdocs/${d.body.id}/step`, { to: 'draft', revision: d4.revision }); assert.equal(r1.body.rev, 1); assert.equal(r1.body.status, 'draft');
  assert.match((await admin('POST', `/api/qdocs/${d.body.id}/step`, { to: 'review', revision: r1.body.revision })).body.error, /개정 내용/);
  // 열람: 다른 부서는 승인된 것만, 지정 부서만
  { const seen = (await prod('GET', '/api/qdocs')).body.rows; assert.equal(seen.length, 1, 'during a revision others still see the current approved version'); assert.equal(seen[0].current.rev, 0); assert.equal(seen[0].file, null, 'working draft file hidden'); }
  const ext = await admin('POST', '/api/qdocs', { kind: 'std', title: 'KS K 0901 클린룸 와이퍼', issuer: '국가기술표준원', edition: '2024', access_depts: ['연구소'], request_id: rid() });
  assert.equal(ext.body.status, 'approved'); assert.equal(ext.body.doc_no, 'EX-01');
  assert.ok(!(await prod('GET', '/api/qdocs')).body.rows.some(x => x.id === ext.body.id), 'restricted to 연구소');
  assert.equal((await prod('POST', '/api/qdocs', { kind: 'form', title: 'x' })).status, 403);
  assert.equal((await admin('POST', `/api/qdocs/${ext.body.id}/step`, { to: 'obsolete', revision: ext.body.revision })).status, 400, 'reason');
  const ob = await admin('POST', `/api/qdocs/${ext.body.id}/step`, { to: 'obsolete', reason: '2025판으로 대체', revision: ext.body.revision }); assert.equal(ob.body.status, 'obsolete'); assert.ok(ob.body.dispose_date > today);
  // A2 변경: 누구나 요청, 영향평가 다 골라야 승인, 적용은 초물 LOT, 검증 유효
  const c = await prod('POST', '/api/changes', { kind: 'material', title: '원단 공급처 변경', item: '원단', reason: '단종', request_id: rid() });
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.match(c.body.change_no, new RegExp(`^CHG-${ymd}-01$`)); assert.equal(c.body.requester_name, '생산');
  assert.equal((await prod('PUT', `/api/changes/${c.body.id}`, { status: 'evaluating', revision: c.body.revision })).status, 403);
  const c1 = await admin('PUT', `/api/changes/${c.body.id}`, { status: 'evaluating', revision: c.body.revision }); assert.equal(c1.body.status, 'evaluating');
  assert.match((await admin('PUT', `/api/changes/${c.body.id}`, { status: 'approved', impact_json: { quality: { v: 'yes' } }, revision: c1.body.revision })).body.error, /영향평가/);
  const all = { quality: { v: 'yes', note: '흡수속도 재확인' }, customer: { v: 'yes' }, docs: { v: 'yes' }, validation: { v: 'no' }, training: { v: 'no' }, inspection: { v: 'no' }, stock: { v: 'no' } };
  const c2 = await admin('PUT', `/api/changes/${c.body.id}`, { status: 'approved', impact_json: all, revision: c1.body.revision }); assert.equal(c2.body.status, 'approved'); assert.equal(c2.body.approved_by, '관리자');
  assert.match((await admin('PUT', `/api/changes/${c.body.id}`, { status: 'applied', apply_date: today, revision: c2.body.revision })).body.error, /초물 LOT/);
  const c3 = await admin('PUT', `/api/changes/${c.body.id}`, { status: 'applied', apply_date: today, first_lot: 'L-NEW-1', revision: c2.body.revision }); assert.equal(c3.body.status, 'applied');
  const c4 = await admin('PUT', `/api/changes/${c.body.id}`, { status: 'verified', verify_date: today, verify_result: '유효', revision: c3.body.revision }); assert.equal(c4.body.status, 'verified');
  // 문서 개정을 변경에 연결 → 변경 목록에 보임
  const r2 = (await admin('GET', '/api/qdocs')).body.rows.find(x => x.id === d.body.id);
  await admin('PUT', `/api/qdocs/${d.body.id}`, { change_id: c.body.id, summary: '공급처 변경 반영', revision: r2.revision });
  assert.equal((await admin('GET', '/api/changes')).body.rows.find(x => x.id === c.body.id).docs[0].doc_no, 'QP-01');
  // CAPA에서 변경 요청
  const n = (await admin('POST', '/api/ncs', { title: '세척 누락', corrective: '세척 방법 변경', request_id: rid() })).body;
  const cc = await admin('POST', '/api/changes', { source_type: 'capa', source_id: n.id, kind: 'method', title: '세척 방법 변경', request_id: rid() }); assert.equal(cc.body.source_no, n.nc_no);
  // A3 교육: 대상자 본인 참석 확인, 실시는 시간·참석, 평가완료는 결과
  const t = await admin('POST', '/api/trainings', { title: 'QP-01 개정 교육', kind: '문서 개정 교육', plan_date: today, doc_id: d.body.id, change_id: c.body.id, attendees: [{ user_name: '생산' }, { user_name: '관리자' }], request_id: rid() });
  assert.equal(t.status, 200, JSON.stringify(t.body)); assert.equal(t.body.attendees.length, 2); assert.match(t.body.doc_label, /^QP-01 Rev\.1/);
  const ta = await prod('POST', `/api/trainings/${t.body.id}/attend`); assert.equal(ta.body.attendees.find(a => a.user_name === '생산').attended, 1);
  assert.match((await admin('PUT', `/api/trainings/${t.body.id}`, { status: 'done', revision: ta.body.revision })).body.error, /실시일/);
  const t1 = await admin('PUT', `/api/trainings/${t.body.id}`, { status: 'done', done_date: today, hours: 1.5, revision: ta.body.revision }); assert.equal(t1.status, 200, JSON.stringify(t1.body)); assert.equal(t1.body.status, 'done');
  assert.match((await admin('PUT', `/api/trainings/${t.body.id}`, { status: 'evaluated', revision: t1.body.revision })).body.error, /결과/);
  const t2 = await admin('PUT', `/api/trainings/${t.body.id}`, { status: 'evaluated', attendees: [{ user_name: '생산', attended: 1, score: 90, result: '이수' }, { user_name: '관리자', attended: 0 }], revision: t1.body.revision });
  assert.equal(t2.status, 200, JSON.stringify(t2.body)); assert.equal(t2.body.status, 'evaluated'); assert.ok(t2.body.attendees.find(a => a.user_name === '생산').confirmed_at, 'keeps self-confirm time');
  assert.equal((await admin('PUT', `/api/trainings/${t.body.id}`, { title: 'x', revision: t1.body.revision })).status, 409);
  const ql = await admin('POST', '/api/qualifications', { user_name: '생산', kind: '수입검사원', acquired_date: '2025-01-01', expire_date: '2027-12-31', request_id: rid() }); assert.equal(ql.body.user_id, u.id);
  assert.match((await admin('POST', '/api/qualifications', { user_name: '생산', kind: 'x', acquired_date: '2025-01-01', expire_date: '2024-01-01' })).body.error, /만료일/);
  // A5 협력업체: 수입검사 불합격률·COA 미수령 → 평가 등급 → 공급사 COA
  const film = (await admin('POST', '/api/boms', { product: '필름306', product_code: 'FM-306', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  assert.equal((await admin('POST', '/api/receipts', { receipt_date: today, vendor: '필름상사', request_id: rid(), lines: [{ bom_id: film.id, lot: 'F-1', qty: 1 }, { bom_id: film.id, lot: 'F-2', qty: 1 }] })).status, 200);
  const iq = sqlite.prepare("SELECT id FROM requests WHERE category='수입검사' AND customer='필름상사' ORDER BY id").all(); assert.equal(iq.length, 2);
  sqlite.prepare("INSERT INTO inspection_measurements(request_id,values_json,result,save_token,updated_by) VALUES(?,?,?,?,?)").run(iq[0].id, '{}', 'fail', 'x', 't');
  sqlite.prepare("INSERT INTO inspection_measurements(request_id,values_json,result,save_token,updated_by) VALUES(?,?,?,?,?)").run(iq[1].id, '{}', 'pass', 'y', 't');
  sqlite.prepare("UPDATE requests SET data=json_set(data,'$.coa_requested',1) WHERE id=?").run(iq[1].id);
  const card = (await admin('GET', '/api/supplier-quality')).body.rows.find(r => r.vendor === '필름상사');
  assert.deepEqual([card.iqc_total, card.iqc_fail, card.fail_rate, card.coa_missing], [2, 1, 50, 1]);
  const ev = await admin('POST', '/api/supplier-evals', { vendor: '필름상사', quality_score: 70, delivery_score: 90, response_score: 80 }); assert.equal(ev.status, 200, JSON.stringify(ev.body)); assert.deepEqual([ev.body.total, ev.body.grade, ev.body.iqc_fail], [78, 'C', 1]);
  assert.equal((await admin('POST', '/api/supplier-evals', { vendor: '필름 상사', quality_score: 95, delivery_score: 95, response_score: 95, revision: ev.body.revision })).body.grade, 'A', 'same vendor key re-evaluated');
  const sc = await admin('PUT', `/api/supplier-coas/${iq[1].id}`, { files: [{ data: pdf, name: 'COA F-2.pdf' }], revision: 0 }); assert.equal(sc.status, 200, JSON.stringify(sc.body)); assert.equal(sc.body.files.length, 1); assert.equal(sc.body.received_date, today);
  assert.equal((await admin('GET', '/api/supplier-quality')).body.rows.find(r => r.vendor === '필름상사').coa_missing, 0);
  const sch = await admin('POST', '/api/changes', { source_type: 'supplier', vendor: '필름상사', kind: 'material', title: '필름 원료 변경 통보', request_id: rid() }); assert.equal(sch.body.source_type, 'supplier');
  const det = (await admin('GET', '/api/supplier-quality/detail?vendor=' + encodeURIComponent('필름상사'))).body; assert.equal(det.inspections.length, 2); assert.equal(det.changes.length, 1); assert.equal(det.evals.length, 1);
  assert.equal((await admin('PUT', `/api/supplier-coas/${q0()}`, { revision: 0 })).status, 400, 'only incoming inspections');
  function q0() { return sqlite.prepare("SELECT id FROM requests WHERE category<>'수입검사' LIMIT 1").get().id; }
  // 지운 판이 없는 초안만 삭제
  const dd = await admin('POST', '/api/qdocs', { kind: 'form', title: '점검표', request_id: rid() }); assert.equal((await admin('DELETE', `/api/qdocs/${dd.body.id}?revision=${dd.body.revision}`)).body.ok, true);
});

test('15.307 equipment register with PM schedule and logs (production), process points and measures with SPC/Cp/Cpk, process abnormal NC by production, test methods and reliability tests', async () => {
  // 설비·PM: 생산도 등록, PM 수행 → 다음 예정일 넘김, 점검 이상 → 「이상」
  const e = await prod('POST', '/api/equipment', { name: '세탁기 1호기', unit_name: '세탁 1호기', location: '2동', pm_items: [{ name: '필터 교체', cycle: 1, unit: 'month', checks: ['필터 상태', '차압'], last_done: '2026-01-15' }], request_id: rid() });
  assert.equal(e.status, 200, JSON.stringify(e.body)); assert.equal(e.body.equip_no, 'EQ-01'); assert.equal(e.body.pm_items[0].next_due, '2026-02-15'); assert.equal(e.body.next_pm, '2026-02-15');
  const pmKey = e.body.pm_items[0].key;
  assert.match((await prod('POST', `/api/equipment/${e.body.id}/logs`, { kind: 'pm', pm_key: pmKey, checks: [{ item: '필터 상태', ok: true }], revision: e.body.revision })).body.error, /점검표/);
  const l1 = await prod('POST', `/api/equipment/${e.body.id}/logs`, { kind: 'pm', pm_key: pmKey, log_date: '2026-03-01', checks: [{ item: '필터 상태', ok: true }, { item: '차압', ok: false, note: '높음' }], revision: e.body.revision, request_id: rid() });
  assert.equal(l1.status, 200, JSON.stringify(l1.body)); assert.equal(l1.body.log_result, '이상'); assert.equal(l1.body.pm_items[0].last_done, '2026-03-01'); assert.equal(l1.body.pm_items[0].next_due, '2026-04-01');
  assert.equal((await prod('POST', `/api/equipment/${e.body.id}/logs`, { kind: 'failure', description: 'x', revision: e.body.revision })).status, 409);
  const l2 = await prod('POST', `/api/equipment/${e.body.id}/logs`, { kind: 'failure', log_date: today, description: '모터 과열 정지', action: '베어링 교체', downtime_hours: 3, status_after: 'maintenance', revision: l1.body.revision, request_id: rid() });
  assert.equal(l2.body.status, 'maintenance');
  const eq = (await admin('GET', '/api/equipment')).body.rows.find(x => x.id === e.body.id); assert.equal(eq.fails_year, today.startsWith('2026') ? 1 : 0); assert.equal(eq.log_count, 2);
  assert.equal((await admin('GET', `/api/equipment/${e.body.id}/logs`)).body.rows.length, 2);
  assert.match((await admin('DELETE', `/api/equipment/${e.body.id}?revision=${l2.body.revision}`)).body.error, /폐기/);
  // 공정 관리항목(품질) · 측정값(생산) · 이탈 표시 · SPC
  assert.equal((await prod('POST', '/api/pqc/points', { place: '세탁', item: '수온', lsl: 60, usl: 80 })).status, 403);
  const pt = await admin('POST', '/api/pqc/points', { place: '세탁', item: '수온', unit: '℃', lsl: 60, usl: 80, cycle: '2시간' }); assert.equal(pt.status, 200, JSON.stringify(pt.body));
  assert.match((await admin('POST', '/api/pqc/points', { place: '세탁', item: '수온', lsl: 1 })).body.error, /이미/);
  const vals = [70, 71, 69, 72, 70, 68, 71, 70, 69, 85];
  const ms = await prod('POST', '/api/pqc/measures', { rows: vals.map((v, i) => ({ point_id: pt.body.id, measured_on: `2026-03-0${1 + Math.floor(i / 2)}`, value: v, lot: 'L' + i })), request_id: rid() });
  assert.equal(ms.status, 200, JSON.stringify(ms.body)); assert.deepEqual([ms.body.saved, ms.body.out_of_spec], [10, 1]);
  const spc = (await admin('GET', `/api/pqc/spc?point_id=${pt.body.id}`)).body;
  assert.equal(spc.chart.type, 'xbar-r'); assert.equal(spc.chart.size, 2); assert.equal(spc.chart.points.length, 5); assert.equal(spc.n, 10); assert.equal(spc.enough, false); assert.equal(spc.out_of_spec, 1); assert.ok(spc.cpk < spc.cp);
  const imr = (await admin('GET', `/api/pqc/spc?point_id=${pt.body.id}&group=none`)).body; assert.equal(imr.chart.type, 'i-mr'); assert.equal(imr.chart.points.length, 10);
  assert.equal((await admin('GET', '/api/pqc/measures?out=1')).body.rows.length, 1);
  const nc = await prod('POST', '/api/ncs', { source_type: 'process', source_no: '세탁 · 수온', title: '수온 85℃ 이탈', lot: 'L9', kind: '공정 이상', request_id: rid() }); assert.equal(nc.status, 200, JSON.stringify(nc.body)); assert.equal(nc.body.source_type, 'process');
  assert.equal((await prod('POST', '/api/ncs', { source_type: 'iqc', title: 'x' })).status, 403);
  // 시험법(계측기 연결·개정) · 신뢰성
  const inst = (await admin('POST', '/api/instruments', { mgmt_no: 'PC-307', name: '파티클 카운터', status: 'in_use', cal_type: 'external', cycle_months: 12, request_id: rid() })).body;
  const tm = await admin('POST', '/api/test-methods', { name: '액중 파티클 시험', standard: 'IEST-RP-CC004', instrument_ids: [inst.id], request_id: rid() });
  assert.equal(tm.status, 200, JSON.stringify(tm.body)); assert.equal(tm.body.method_no, 'TM-01'); assert.equal(tm.body.instruments[0].mgmt_no, 'PC-307');
  assert.match((await admin('PUT', `/api/test-methods/${tm.body.id}`, { revise: true, revision: tm.body.revision })).body.error, /개정 내용/);
  const tm2 = await admin('PUT', `/api/test-methods/${tm.body.id}`, { revise: true, summary: '세척 조건 추가', conditions: '초순수 1L', revision: tm.body.revision }); assert.equal(tm2.body.rev, 1);
  const rel = await admin('POST', '/api/reliability', { title: '내열 500h', item: 'CF707', method_id: tm.body.id, request_id: rid() }); assert.match(rel.body.test_no, new RegExp(`^REL-${ymd}-01$`));
  assert.match((await admin('PUT', `/api/reliability/${rel.body.id}`, { status: 'testing', revision: rel.body.revision })).body.error, /평가 항목/);
  const r1 = await admin('PUT', `/api/reliability/${rel.body.id}`, { status: 'testing', spec_json: [{ name: '인장강도', unit: 'N', min: 10 }], revision: rel.body.revision }); assert.equal(r1.body.status, 'testing'); assert.equal(r1.body.start_date, today);
  assert.match((await admin('PUT', `/api/reliability/${rel.body.id}`, { status: 'done', revision: r1.body.revision })).body.error, /측정값/);
  const r2 = await admin('PUT', `/api/reliability/${rel.body.id}`, { status: 'done', points_json: [{ label: '초기', values: [15] }, { label: '500h', values: [9] }], revision: r1.body.revision });
  assert.equal(r2.status, 200, JSON.stringify(r2.body)); assert.equal(r2.body.judge, '부적합'); assert.equal(r2.body.status, 'done');
  assert.equal((await admin('PUT', `/api/reliability/${rel.body.id}`, { note: 'x', revision: r2.body.revision })).status, 400, 'done is locked');
});

test('15.308 audits (findings create CAPA, close only when CAPAs closed), validations (stages, approver judge, revalidation date), quality goals with auto KPI, risk register', async () => {
  // A4 심사: 계획 → 실시 → 지적(중·경 → CAPA 자동) → 시정 중 → CAPA 종결 뒤 종결
  const a = await admin('POST', '/api/audits', { title: '2026 내부심사', kind: 'internal', target: '생산팀', plan_date: today, checklist: [{ q: '작업표준서 최신판 비치?' }], request_id: rid() });
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.match(a.body.audit_no, new RegExp(`^AUD-${ymd}-01$`));
  const a1 = await admin('PUT', `/api/audits/${a.body.id}`, { status: 'done', checklist: [{ q: '작업표준서 최신판 비치?', result: '부적합' }], revision: a.body.revision }); assert.equal(a1.body.status, 'done'); assert.equal(a1.body.done_date, today);
  const f1 = await admin('POST', `/api/audits/${a.body.id}/findings`, { grade: 'minor', clause: '7.5.3', content: '구판 작업표준서 사용', request_id: rid() });
  assert.equal(f1.status, 200, JSON.stringify(f1.body)); assert.equal(f1.body.status, 'correcting'); const fnd = f1.body.findings[0]; assert.match(fnd.nc_no, /^NC-/); assert.ok(fnd.due_date > today);
  const nc = (await admin('GET', `/api/ncs?source_type=audit&source_id=${a.body.id}`)).body.rows[0]; assert.equal(nc.kind, '심사 지적'); assert.equal(nc.source_no, a.body.audit_no);
  const f2 = await admin('POST', `/api/audits/${a.body.id}/findings`, { grade: 'obs', content: '게시판 정리 권고', request_id: rid() }); assert.equal(f2.body.findings[1].nc_id, null);
  assert.match((await admin('PUT', `/api/audits/${a.body.id}`, { status: 'closed', revision: f2.body.revision })).body.error, /열린 지적사항 2건/);
  await admin('PUT', `/api/audits/${a.body.id}/findings/${f2.body.findings[1].id}`, { obs_done: true });
  let n1 = await admin('PUT', `/api/ncs/${nc.id}`, { status: 'action', cause_json: { why1: '배포 누락' }, revision: nc.revision });
  n1 = await admin('PUT', `/api/ncs/${nc.id}`, { status: 'verify', corrective: '문서관리 배포 확인', revision: n1.body.revision });
  await admin('PUT', `/api/ncs/${nc.id}`, { status: 'closed', verify_result: '유효', verify_date: today, revision: n1.body.revision });
  const a3 = (await admin('GET', '/api/audits')).body.rows.find(x => x.id === a.body.id); assert.equal(a3.open_findings, 0);
  const a4 = await admin('PUT', `/api/audits/${a.body.id}`, { status: 'closed', revision: a3.revision }); assert.equal(a4.body.status, 'closed', JSON.stringify(a4.body)); assert.equal(a4.body.closed_by, '관리자');
  assert.equal((await prod('POST', '/api/audits', { title: 'x', kind: 'internal', plan_date: today })).status, 403);
  // A6 밸리데이션: 설비 대상, 단계 결과 다 넣어야 판정, 적합이면 재밸리데이션 기한
  const eq = (await admin('POST', '/api/equipment', { name: '건조기', request_id: rid() })).body;
  const v = await admin('POST', '/api/validations', { title: '건조기 적격성', kind: 'equipment', target_type: 'equipment', target_id: eq.id, stages: [{ key: 'IQ' }, { key: 'OQ' }, { key: 'PQ' }], cycle_months: 12, request_id: rid() });
  assert.equal(v.status, 200, JSON.stringify(v.body)); assert.match(v.body.target_label, /건조기/); assert.match(v.body.val_no, /^VAL-/);
  const v1 = await admin('PUT', `/api/validations/${v.body.id}`, { stages: [{ key: 'IQ', done_date: today, result: '적합' }, { key: 'OQ' }, { key: 'PQ' }], revision: v.body.revision }); assert.equal(v1.body.status, 'running');
  assert.match((await admin('POST', `/api/validations/${v.body.id}/judge`, { result: 'pass', revision: v1.body.revision })).body.error, /모든 단계/);
  const v2 = await admin('PUT', `/api/validations/${v.body.id}`, { stages: [{ key: 'IQ', done_date: today, result: '적합' }, { key: 'OQ', done_date: today, result: '적합' }, { key: 'PQ', done_date: today, result: '부적합' }], revision: v1.body.revision });
  assert.match((await admin('POST', `/api/validations/${v.body.id}/judge`, { result: 'pass', revision: v2.body.revision })).body.error, /부적합 단계/);
  const v3 = await admin('PUT', `/api/validations/${v.body.id}`, { stages: [{ key: 'IQ', done_date: today, result: '적합' }, { key: 'OQ', done_date: today, result: '적합' }, { key: 'PQ', done_date: today, result: '적합' }], revision: v2.body.revision });
  const vj = await admin('POST', `/api/validations/${v.body.id}/judge`, { result: 'pass', revision: v3.body.revision }); assert.equal(vj.body.status, 'pass'); assert.ok(vj.body.valid_until > today);
  assert.equal((await admin('PUT', `/api/validations/${v.body.id}`, { title: 'x', revision: vj.body.revision })).status, 400, 'judged is locked');
  // M1 KPI: 자동 지표(VOC 건수·CAPA 기한 준수율) + 수동 지표 월별 값
  const g = await admin('POST', '/api/kpi/goals', { title: 'CAPA 기한 준수', metric: 'capa_ontime', target: 90, request_id: rid() }); assert.equal(g.body.unit, '%'); assert.equal(g.body.direction, 'up');
  const k = (await admin('GET', '/api/kpi')).body.rows.find(x => x.id === g.body.id); const mm = Number(today.slice(5, 7));
  assert.equal(k.months[mm - 1].actual, 100, 'closed today within due'); assert.equal(k.ytd, 100); assert.equal(k.met, true);
  const g2 = await admin('POST', '/api/kpi/goals', { title: '클레임 비용 절감', unit: '만원', direction: 'down', target: 500, budget: 2000000, request_id: rid() });
  const g3 = await admin('PUT', `/api/kpi/goals/${g2.body.id}`, { values: [{ month: 1, target: 50, actual: 40 }, { month: 2, target: 50, actual: 60 }], revision: g2.body.revision }); assert.equal(g3.status, 200, JSON.stringify(g3.body));
  const k2 = (await admin('GET', '/api/kpi')).body.rows.find(x => x.id === g2.body.id); assert.deepEqual([k2.months[0].actual, k2.months[1].target, k2.ytd], [40, 50, 50]);
  assert.equal((await admin('DELETE', `/api/kpi/goals/${g2.body.id}?revision=${g3.body.revision}`)).body.ok, true);
  // M2 리스크: 점수·등급, 대응 중은 계획·담당, 종결은 재평가
  const r = await admin('POST', '/api/risks', { content: '주요 원단 단일 공급처', area: '구매', likelihood: 4, impact: 5, request_id: rid() });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.risk_no, 'RSK-01'); assert.deepEqual([r.body.score, r.body.grade], [20, '상']);
  assert.match((await admin('PUT', `/api/risks/${r.body.id}`, { status: 'acting', revision: r.body.revision })).body.error, /대응계획/);
  const r1 = await admin('PUT', `/api/risks/${r.body.id}`, { status: 'acting', plan: '2차 공급처 승인', owner_name: '구매', revision: r.body.revision }); assert.equal(r1.body.status, 'acting');
  assert.match((await admin('PUT', `/api/risks/${r.body.id}`, { status: 'closed', revision: r1.body.revision })).body.error, /재평가/);
  const r2 = await admin('PUT', `/api/risks/${r.body.id}`, { status: 'closed', re_likelihood: 2, re_impact: 3, review_date: today, revision: r1.body.revision }); assert.deepEqual([r2.body.status, r2.body.re_score, r2.body.re_grade], ['closed', 6, '하']);
  assert.match((await admin('POST', '/api/risks', { content: 'x', likelihood: 6, impact: 1 })).body.error, /1~5/);
});

test('15.309 review fixes: losing concurrent writes leave nothing, negative values, document locked in review, audit CAPA void needs approver, approved change locked, bad input is 400 not 500', async () => {
  const qc = client(); await approvedRegistration(admin, qc, { name: '품질담당', password: 'password', invite: 'lot249-test' });
  const qu = (await admin('GET', '/api/admin/users')).body.find(x => x.name === '품질담당'); await admin('PUT', `/api/admin/users/${qu.id}`, { roles: ['quality'] });
  // 교육: 같은 판으로 두 사람이 저장 → 진 쪽 대상자 변경이 남지 않음
  const t = (await admin('POST', '/api/trainings', { title: '동시 저장', kind: 'OJT', plan_date: today, attendees: [{ user_name: '생산' }], request_id: rid() })).body;
  const w = await admin('PUT', `/api/trainings/${t.id}`, { attendees: [{ user_name: '생산' }, { user_name: '관리자' }], revision: t.revision });
  const l = await qc('PUT', `/api/trainings/${t.id}`, { attendees: [{ user_name: '품질담당' }], revision: t.revision });
  assert.equal(w.status, 200); assert.equal(l.status, 409);
  assert.deepEqual(sqlite.prepare('SELECT user_name FROM training_attendees WHERE training_id=? ORDER BY user_name').all(t.id).map(x => x.user_name), ['관리자', '생산']);
  // 설비 이력: 같은 판으로 두 번 → 진 쪽 이력 줄 없음
  const e = (await admin('POST', '/api/equipment', { name: '동시 설비', request_id: rid() })).body;
  const e1 = await admin('POST', `/api/equipment/${e.id}/logs`, { kind: 'failure', description: 'A', revision: e.revision });
  const e2 = await prod('POST', `/api/equipment/${e.id}/logs`, { kind: 'failure', description: 'B', status_after: 'maintenance', revision: e.revision });
  assert.equal(e1.status, 200); assert.equal(e2.status, 409); assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM equipment_logs WHERE equipment_id=?').get(e.id).c, 1);
  // 음수: 냉동고 온도 기준·측정값, 신뢰성 치수 변화, KPI
  const pt = await admin('POST', '/api/pqc/points', { kind: 'env', place: '냉동고', item: '온도', lsl: -25, usl: -15 }); assert.equal(pt.status, 200, JSON.stringify(pt.body));
  assert.equal((await admin('POST', '/api/pqc/measures', { rows: [{ point_id: pt.body.id, value: -30 }] })).body.out_of_spec, 1);
  assert.equal((await admin('POST', '/api/reliability', { title: '치수', spec_json: [{ name: '변화율', min: -2, max: 2 }], request_id: rid() })).status, 200);
  assert.equal((await admin('POST', '/api/reliability', { title: 'R', spec_json: { a: 1 }, points_json: { b: 2 } })).status, 200, 'object is treated as empty, not 500');
  const g = (await admin('POST', '/api/kpi/goals', { title: '편차', unit: '%', target: -1, request_id: rid() })).body; assert.equal(g.target, -1);
  assert.match((await admin('PUT', `/api/kpi/goals/${g.id}`, { values: [{ target: 1, actual: 2 }], revision: g.revision })).body.error, /월/);
  // 문서: 검토 중에는 파일·내용 잠금
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
  let d = (await admin('POST', '/api/qdocs', { kind: 'form', title: '점검표 A', files: [{ data: pdf, name: 'a.pdf' }], request_id: rid() })).body;
  d = (await admin('POST', `/api/qdocs/${d.id}/step`, { to: 'review', revision: d.revision })).body;
  const d1 = (await admin('PUT', `/api/qdocs/${d.id}`, { remove_file: 1, title: '바꿈', revision: d.revision })).body;
  assert.equal(d1.title, '점검표 A'); assert.ok(d1.file?.file, 'file kept while in review');
  // 심사 지적 CAPA 취소는 품질책임자만
  const au = (await admin('POST', '/api/audits', { title: '내부', kind: 'internal', plan_date: today, request_id: rid() })).body;
  const af = (await admin('POST', `/api/audits/${au.id}/findings`, { grade: 'minor', content: '지적', request_id: rid() })).body;
  const anc = (await admin('GET', `/api/ncs?source_type=audit&source_id=${au.id}`)).body.rows[0];
  assert.equal((await qc('PUT', `/api/ncs/${anc.id}`, { status: 'void', reason: '없앰', revision: anc.revision })).status, 403);
  assert.equal(af.history.filter(h => /지적/.test(h.what)).length, 1);
  // 승인된 변경은 내용·영향평가 잠금
  let c = (await admin('POST', '/api/changes', { kind: 'method', title: '원래 내용', request_id: rid() })).body;
  c = (await admin('PUT', `/api/changes/${c.id}`, { status: 'evaluating', revision: c.revision })).body;
  const imp = Object.fromEntries(['quality', 'customer', 'docs', 'validation', 'training', 'inspection', 'stock'].map(k => [k, { v: 'no' }]));
  c = (await admin('PUT', `/api/changes/${c.id}`, { status: 'approved', impact_json: imp, revision: c.revision })).body;
  const c2 = (await admin('PUT', `/api/changes/${c.id}`, { title: '몰래 바꿈', plan_date: today, revision: c.revision })).body;
  assert.equal(c2.title, '원래 내용'); assert.equal(c2.plan_date, today);
  // COA 승인: 오래된 판이면 409
  assert.equal((await admin('POST', '/api/coas/999999/approve', { revision: 1 })).status, 404);
});

test('15.310 per-user display prefs for dashboard/report are validated and kept; dashboard has quality/plant numbers; quality dept report adds CAPA/process stats', async () => {
  const p1 = await admin('PUT', '/api/me/prefs', { dash: { hidden: ['pipeline', 'ov:requests'], order: ['alerts', 'tasks', 'overview'] } });
  assert.equal(p1.status, 200, JSON.stringify(p1.body)); assert.deepEqual(p1.body.dash, { hidden: ['pipeline', 'ov:requests'], order: ['alerts', 'tasks', 'overview'] });
  assert.deepEqual((await admin('GET', '/api/me')).body.user.ui.dash.hidden, ['pipeline', 'ov:requests']);
  const p2 = await admin('PUT', '/api/me/prefs', { report: { hidden: ['common:kpi:매출액(공급가액)', 'dept:quality:table:거래처별 불합격률', 'detail:semi'], period: 'month', dept: 'quality', unit: 'BOX' } });
  assert.equal(p2.status, 200, JSON.stringify(p2.body)); assert.equal(p2.body.report.period, 'month'); assert.equal(p2.body.report.dept, 'quality'); assert.equal(p2.body.report.unit, 'BOX'); assert.equal(p2.body.report.hidden.length, 3);
  assert.equal((await admin('PUT', '/api/me/prefs', { report: { period: 'yesterday' } })).status, 400);
  assert.equal((await admin('PUT', '/api/me/prefs', { report: { dept: 'nope' } })).status, 400);
  assert.equal((await admin('PUT', '/api/me/prefs', { dash: { hidden: 'x' } })).status, 400);
  const p3 = await admin('PUT', '/api/me/prefs', { report: { period: '', hidden: [] } }); assert.equal(p3.body.report.period, undefined); assert.equal(p3.body.report.hidden, undefined); assert.equal(p3.body.report.dept, 'quality', 'other keys kept');
  const p4 = await admin('PUT', '/api/me/prefs', { dash: null }); assert.equal(p4.body.dash, undefined); assert.ok(p4.body.report, 'report kept');
  const p5 = await admin('PUT', '/api/me/prefs', { dash: { hidden: ['ov:sales', '<script>'] } }); assert.deepEqual(p5.body.dash.hidden, ['ov:sales'], 'bad names dropped');
  const d = (await admin('GET', '/api/dashboard')).body; assert.ok(d.quality, 'quality block'); assert.ok(d.quality.capaOpen >= 1); assert.equal(typeof d.quality.pmOverdue, 'number'); assert.equal(typeof d.quality.iqcFail, 'number'); assert.equal(typeof d.quality.kpiMissed, 'number');
  const q = (await admin('GET', `/api/reports/dept?section=quality&from=${today.slice(0, 4)}-01-01&to=${today}&grain=month`)).body;
  assert.ok(q.kpis.some(k => k.label === 'CAPA 등록' && k.value >= 1), JSON.stringify(q.kpis.map(k => k.label))); assert.ok(q.kpis.some(k => k.label === 'CAPA 기한 준수율')); assert.ok(q.kpis.some(k => k.label === '공정 기준 이탈' && k.value >= 1));
  assert.ok(q.charts.some(c => c.title === '부적합(CAPA) 등록 · 종결')); assert.ok(q.tables.some(t => t.title === '부적합 출처별(CAPA)' && t.rows.length >= 1)); assert.ok(q.tables.some(t => t.title === '공정 기준 이탈 항목' && t.rows.length >= 1));
  await admin('PUT', '/api/me/prefs', { report: null, dash: null });
});

test('15.312 find API: record numbers and titles across quality tables, restricted documents hidden, short query empty', async () => {
  const n = (await admin('POST', '/api/ncs', { title: '찾기용 부적합 XQ7', request_id: rid() })).body;
  const d = (await admin('POST', '/api/qdocs', { kind: 'form', title: '찾기용 양식 XQ7', access_depts: ['연구소'], request_id: rid() })).body;
  const r = (await admin('GET', '/api/find?q=' + encodeURIComponent(n.nc_no))).body.rows; assert.ok(r.some(x => x.type === 'nc' && x.id === n.id && x.href === '#/quality/capa'), JSON.stringify(r));
  const t = (await admin('GET', '/api/find?q=XQ7')).body.rows; assert.ok(t.some(x => x.type === 'nc') && t.some(x => x.type === 'doc'));
  assert.ok(!(await prod('GET', '/api/find?q=XQ7')).body.rows.some(x => x.type === 'doc'), 'draft/restricted doc hidden from others');
  assert.deepEqual((await admin('GET', '/api/find?q=X')).body.rows, []);
  assert.equal((await admin('GET', '/api/find?q=' + encodeURIComponent("%' OR 1=1 --"))).status, 200);
  void d;
});

test('15.313 risk assessment: FMEA AP table, KOSHA 3x3 action rule, review/approve by approver only, locked after approval, action result with residual risk, revise, HAZOP to CAPA, equipment reliability', async () => {
  const ap = async (s, o, d) => (await prod('POST', '/api/risk-assess', { method: 'fmea', title: 'AP', rows: [{ mode: 'x', s, o, d }], request_id: rid() })).body.rows[0].grade;
  for (const [s, o, d, g] of [[9, 4, 1, 'M'], [9, 4, 2, 'H'], [10, 1, 10, 'L'], [9, 2, 6, 'M'], [8, 6, 1, 'M'], [7, 4, 7, 'H'], [7, 2, 5, 'M'], [5, 8, 5, 'H'], [5, 6, 1, 'L'], [5, 4, 7, 'M'], [2, 8, 5, 'M'], [3, 9, 4, 'L'], [1, 10, 10, 'L']]) assert.equal(await ap(s, o, d), g, `S${s} O${o} D${d}`);
  // KOSHA 3×3: 가능성×중대성 6 이상 높음 · 3~4 보통 · 2 이하 낮음 → 보통·높음은 감소대책·담당·기한 없이는 검토 요청 불가
  let k = (await prod('POST', '/api/risk-assess', { method: 'kosha', title: '세탁 공정 위험성평가', kind: 'initial', scale: 3, process: '세탁', assess_date: today, rows: [{ task: '세탁기 투입', cat: 'machine', hazard: '회전 드럼에 손 끼임', f: 2, s: 3 }, { task: '세제 보충', cat: 'chemical', hazard: '세제 피부 접촉', f: 1, s: 2 }], request_id: rid() })).body;
  assert.deepEqual(k.rows.map(r => [r.score, r.grade]), [[6, 'H'], [2, 'L']]); assert.match(k.ra_no, /^RA-\d{4}-01$/);
  assert.equal((await prod('POST', '/api/risk-assess', { method: 'kosha', title: 'x', scale: 3, rows: [{ hazard: 'y', f: 4, s: 1 }] })).status, 400, '3x3 scale bounds');
  let r = await prod('POST', `/api/risk-assess/${k.id}/step`, { to: 'review', revision: k.revision }); assert.equal(r.status, 400); assert.match(r.body.error, /1번 줄.*감소대책/);
  k = (await prod('PUT', `/api/risk-assess/${k.id}`, { revision: k.revision, rows: k.rows.map((x, i) => i ? x : { ...x, action: '인터록 도어·투입 전 정지', owner: '생산', due: '2020-01-01' }) })).body;
  k = (await prod('POST', `/api/risk-assess/${k.id}/step`, { to: 'review', revision: k.revision })).body; assert.equal(k.status, 'review');
  assert.equal((await prod('PUT', `/api/risk-assess/${k.id}`, { revision: k.revision, title: '바꿈' })).status, 400, 'locked in review');
  assert.equal((await prod('POST', `/api/risk-assess/${k.id}/step`, { to: 'approved', revision: k.revision })).status, 403, 'production staff cannot approve');
  assert.ok((await admin('GET', '/api/my-tasks')).body.approvals.quality.some(x => x.key === 'risk_assess'));
  k = (await admin('POST', `/api/risk-assess/${k.id}/step`, { to: 'approved', revision: k.revision })).body; assert.equal(k.status, 'approved'); assert.equal(k.next_review, `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`.replace('-02-29', '-02-28'));
  assert.equal((await prod('PUT', `/api/risk-assess/${k.id}`, { revision: k.revision, title: '바꿈' })).status, 400, 'locked after approval');
  assert.equal(k.counts.over, 1); assert.ok((await prod('GET', '/api/alerts')).body.quality_alerts.some(a => /개선 조치 기한 지남/.test(a.label)));
  // 조치 결과: 재평가 없이 완료 불가 → 재평가(1×3=3 보통) 넣으면 완료, 잔여 위험 집계
  const key = k.rows[0].key;
  assert.equal((await prod('PUT', `/api/risk-assess/${k.id}/rows/${key}`, { revision: k.revision, done: today })).status, 400);
  k = (await prod('PUT', `/api/risk-assess/${k.id}/rows/${key}`, { revision: k.revision, done: today, f2: 1, s2: 1, result: '도어 인터록 설치' })).body;
  assert.deepEqual([k.rows[0].done, k.rows[0].grade2, k.rows[0].done_by, k.rows[0].result, k.counts.over, k.counts.residual], [today, 'L', '생산', '도어 인터록 설치', 0, 0]);
  assert.equal((await prod('DELETE', `/api/risk-assess/${k.id}?revision=${k.revision}`)).status, 400, 'approved cannot be deleted');
  assert.equal((await prod('POST', `/api/risk-assess/${k.id}/step`, { to: 'draft', revision: k.revision })).status, 400, 'revise needs note');
  k = (await prod('POST', `/api/risk-assess/${k.id}/step`, { to: 'draft', revision: k.revision, rev_note: '설비 교체' })).body; assert.deepEqual([k.status, k.rev, k.rows[0].done], ['draft', 1, today]);
  // HAZOP: 이탈 = 변수 + 가이드워드, 5×5(15 이상 높음), 줄 → CAPA(출처 위험성평가), 두 번은 안 됨, KOSHA 줄은 CAPA 안 됨
  let h = (await prod('POST', '/api/risk-assess', { method: 'hazop', title: '세탁수 순환', process: '세탁', assess_date: today, rows: [{ node: '순환 펌프', param: '유량', guide: '없음(No)', cause: '펌프 정지', cons: '세탁 불량', safeguard: '유량계', s: 4, l: 4, action: '저유량 경보', owner: '공무', due: today }], request_id: rid() })).body;
  assert.deepEqual([h.rows[0].dev, h.rows[0].score, h.rows[0].grade], ['유량 없음(No)', 16, 'H']); assert.match(h.ra_no, /^HZ-/);
  const n = (await prod('POST', `/api/risk-assess/${h.id}/rows/${h.rows[0].key}/nc`, { revision: h.revision })).body; assert.match(n.nc_no, /^NC-/); assert.equal(n.rows[0].nc_no, n.nc_no);
  const nc = (await admin('GET', '/api/ncs')).body.rows.find(x => x.id === n.nc_id); assert.deepEqual([nc.source_type, nc.source_no, nc.grade, nc.corrective], ['risk', h.ra_no, 'major', '저유량 경보']);
  assert.equal((await prod('POST', `/api/risk-assess/${h.id}/rows/${h.rows[0].key}/nc`, { revision: n.revision })).status, 400);
  assert.equal((await prod('POST', `/api/risk-assess/${k.id}/rows/${key}/nc`, { revision: k.revision })).status, 400);
  assert.equal((await prod('DELETE', `/api/risk-assess/${h.id}?revision=${n.revision}`)).status, 400, 'row sent to CAPA blocks delete');
  assert.ok((await admin('GET', '/api/find?q=' + h.ra_no)).body.rows.some(x => x.type === 'ra' && x.id === h.id));
  // 설비 신뢰도: 10일 × 24h = 240h, 고장 2건(비가동 4h+수리 2h) → MTBF 117h, MTTR 3h, 가용도 97.5%
  const from = new Date(Date.parse(today) - 9 * 86400000).toISOString().slice(0, 10);
  let e = (await prod('POST', '/api/equipment', { name: '신뢰도 세탁기', install_date: from, request_id: rid() })).body;
  for (const [kind, dt] of [['failure', 4], ['failure', null], ['repair', 2]]) { const lg = await prod('POST', `/api/equipment/${e.id}/logs`, { kind, log_date: today, description: '고장', downtime_hours: dt, revision: e.revision, request_id: rid() }); assert.equal(lg.status, 200, JSON.stringify(lg.body)); e = (await prod('GET', `/api/equipment/${e.id}/logs`)).body.equipment; }
  const rel = (await prod('GET', `/api/equipment-reliability?from=${from}&to=${today}&hours=24&mission=10`)).body, er = rel.rows.find(x => x.id === e.id);
  assert.deepEqual([er.planned, er.fails, er.down, er.mtbf, er.mttr, er.availability, er.reliability], [240, 2, 6, 117, 3, 97.5, Math.round(Math.exp(-10 / 117) * 10000) / 100]);
  assert.equal((await prod('GET', '/api/equipment-reliability?hours=30')).status, 400);
});

test('15.314 org chart (CEO, department head and duties) and designated officers (deputy, external, training cycle, alerts, dismissal keeps record)', async () => {
  const users = (await admin('GET', '/api/admin/users')).body, pu = users.find(x => x.name === '생산'), au = users.find(x => x.name === '관리자');
  const top = (await admin('POST', '/api/admin/org/departments', { name: '경영지원부' })).body, sub = (await admin('POST', '/api/admin/org/departments', { name: '안전환경팀', parent_id: top.id })).body;
  assert.equal((await prod('PUT', `/api/admin/org-chart/departments/${sub.id}`, { head_user_id: pu.id })).status, 403);
  assert.equal((await admin('PUT', `/api/admin/org-chart/departments/${sub.id}`, { head_user_id: pu.id, duties: '사업장 안전·환경 관리\n소방' })).status, 200);
  assert.equal((await admin('PUT', '/api/admin/org-chart', { ceo_user_id: au.id, ceo_title: '대표이사', company: '테스트상사' })).status, 200);
  let ch = (await prod('GET', '/api/org/chart')).body; const d = ch.departments.find(x => x.id === sub.id);
  assert.deepEqual([ch.company, ch.ceo.name, ch.ceo_title, d.parent_id, d.head.name, d.duties, ch.can_manage], ['테스트상사', '관리자', '대표이사', top.id, '생산', '사업장 안전·환경 관리\n소방', false]);
  // 지정: 관리자만, 정·부 같으면 안 됨, 외부 대행은 이름만, 교육 주기로 다음 기한 자동
  assert.equal((await prod('POST', '/api/admin/org-duties', { title: '소방안전관리자', user_id: pu.id })).status, 403);
  assert.equal((await admin('POST', '/api/admin/org-duties', { title: '소방안전관리자', user_id: pu.id, deputy_user_id: pu.id })).status, 400);
  assert.equal((await admin('POST', '/api/admin/org-duties', { title: '소방안전관리자' })).status, 400, 'person required');
  let f = (await admin('POST', '/api/admin/org-duties', { duty_key: 'fire_mgr', title: '소방안전관리자', category: 'fire', user_id: pu.id, deputy_user_id: au.id, scope: '전사', appointed_date: '2024-10-01', legal_basis: '화재의 예방 및 안전관리에 관한 법률 제24조', training_cycle: 24, last_training: '2024-10-01', tasks: '소방계획서 작성\n소방훈련', request_id: rid() })).body;
  assert.deepEqual([f.person_name, f.deputy_name, f.next_training, f.train, f.user.name], ['생산', '관리자', '2026-10-01', today > '2026-10-01' ? 'over' : today >= '2026-09-01' ? 'soon' : 'ok', '생산']);
  const ext = (await admin('POST', '/api/admin/org-duties', { title: '전기안전관리자', category: 'elec', person_name: '(주)전기안전대행 홍길동', training_cycle: 36, appointed_date: '2026-01-05', request_id: rid() })).body;
  assert.deepEqual([ext.user_id, ext.person_name, ext.next_training], [null, '(주)전기안전대행 홍길동', '2029-01-05']);
  if (f.train !== 'ok') { assert.ok((await prod('GET', '/api/alerts')).body.quality_alerts.some(a => /내 지정 업무 법정교육/.test(a.label))); assert.ok((await admin('GET', '/api/alerts')).body.quality_alerts.some(a => /지정 담당자 법정교육/.test(a.label))); }
  // 교육 이수 → 다음 기한 다시 계산
  f = (await admin('PUT', `/api/admin/org-duties/${f.id}`, { revision: f.revision, last_training: today, next_training: '' })).body; assert.equal(f.train, 'ok'); assert.match(f.history.at(-1).what, /교육 이수/);
  assert.equal((await admin('PUT', `/api/admin/org-duties/${f.id}`, { revision: f.revision - 1, note: 'x' })).status, 409);
  ch = (await prod('GET', '/api/org/chart')).body; assert.equal(ch.duties.length, 2);
  // 해임: 지우지 않고 종료(선임 이력 보존), 일반 사용자 목록에서는 사라짐
  assert.equal((await admin('DELETE', `/api/admin/org-duties/${f.id}?revision=${f.revision}`)).status, 400);
  f = (await admin('PUT', `/api/admin/org-duties/${f.id}`, { revision: f.revision, active: false })).body; assert.deepEqual([f.active, f.end_date], [false, today]); assert.match(f.history.at(-1).what, /해임·종료/);
  assert.equal((await prod('GET', '/api/org/duties')).body.rows.length, 1); assert.equal((await admin('GET', '/api/org/duties')).body.rows.length, 2);
  assert.equal((await admin('DELETE', `/api/admin/org-duties/${f.id}?revision=${f.revision}`)).status, 200);
});

test('15.315 review fixes: find keeps underscore, %/_ alone empty; reliability when always down; revise clears re-review date; done only via result route, not in review', async () => {
  const lotNc = (await admin('POST', '/api/ncs', { title: 'LOT 261121_NX808_P1 부적합', request_id: rid() })).body;
  assert.ok((await admin('GET', '/api/find?q=' + encodeURIComponent('261121_NX808'))).body.rows.some(x => x.id === lotNc.id));
  assert.ok(!(await admin('GET', '/api/find?q=' + encodeURIComponent('261121NX808'))).body.rows.some(x => x.id === lotNc.id), '_ is literal, not dropped');
  for (const q of ['__', '%%', '%_ ']) assert.deepEqual((await admin('GET', '/api/find?q=' + encodeURIComponent(q))).body.rows, []);
  // 기간 내내 멈춘 설비: MTBF 0 → 고장률 계산 불가(null), 신뢰도 0%
  const from = new Date(Date.parse(today) - 1 * 86400000).toISOString().slice(0, 10);
  let e = (await prod('POST', '/api/equipment', { name: '항상 고장 설비', install_date: from, request_id: rid() })).body;
  await prod('POST', `/api/equipment/${e.id}/logs`, { kind: 'failure', log_date: today, description: '고장', downtime_hours: 999, revision: e.revision, request_id: rid() });
  const er = (await prod('GET', `/api/equipment-reliability?from=${from}&to=${today}&hours=24`)).body.rows.find(x => x.id === e.id);
  assert.deepEqual([er.planned, er.down, er.mtbf, er.lambda, er.reliability, er.availability], [48, 48, 0, null, 0, 0]);
  // 조치 완료는 「조치 결과」로만 · 검토 요청 중에는 안 됨 · 개정하면 재평가 예정일 비움
  let k = (await prod('POST', '/api/risk-assess', { method: 'kosha', title: '15.315', scale: 3, assess_date: today, rows: [{ hazard: '끼임', f: 3, s: 3, action: '덮개', owner: '생산', due: today }], request_id: rid() })).body;
  k = (await prod('PUT', `/api/risk-assess/${k.id}`, { revision: k.revision, rows: k.rows.map(r => ({ ...r, done: today, f2: 1, s2: 1 })) })).body;
  assert.deepEqual([k.rows[0].done, k.rows[0].f2], [null, null], 'worksheet PUT cannot mark done');
  k = (await prod('POST', `/api/risk-assess/${k.id}/step`, { to: 'review', revision: k.revision })).body;
  const r1 = await prod('PUT', `/api/risk-assess/${k.id}/rows/${k.rows[0].key}`, { revision: k.revision, done: today, f2: 1, s2: 1 }); assert.equal(r1.status, 400); assert.match(r1.body.error, /검토 요청 중/);
  k = (await admin('POST', `/api/risk-assess/${k.id}/step`, { to: 'approved', revision: k.revision })).body; assert.ok(k.next_review);
  const bad = await prod('PUT', `/api/risk-assess/${k.id}/rows/${k.rows[0].key}`, { revision: k.revision, done: today, f2: 9, s2: 1 }); assert.match(bad.body.error, /^1번 줄/);
  k = (await prod('POST', `/api/risk-assess/${k.id}/step`, { to: 'draft', revision: k.revision, rev_note: '설비 교체' })).body; assert.equal(k.next_review, null);
});

test('15.316 development cost sheets: auto amounts (qty x price x fx), direct/SGA/total/unit cost/margin/suggested price, dev list matching, researcher-only, confirm lock', async () => {
  const dev = (await admin('POST', '/api/requests', { type: 'development', title: '저분진 와이퍼 원가', customer: '삼성SDI', due_date: '2027-03-31', target_price: '150', data: { extra: 'x' } })).body;
  assert.equal((await prod('GET', '/api/dev-costs')).status, 403);
  assert.equal((await admin('POST', '/api/dev-costs', { dev_request_id: 999999, lines: [] })).status, 400);
  let c = (await admin('POST', '/api/dev-costs', { dev_request_id: dev.id, product: '9인치 와이퍼', base_qty: 1000, unit: 'EA', sga_rate: 10, profit_rate: 20, target_price: 150, request_id: rid(), lines: [
    { date: '2026-11-01', cat: 'material', item: '폴리에스터 원단', qty: 50, unit: 'kg', unit_price: 12, currency: 'USD', fx: 1400 },
    { date: '2026-11-03', cat: 'incidental', item: '항공 운송비', qty: 1, unit_price: 80000 },
    { date: '2026-11-05', cat: 'test', item: '파티클 시험', qty: 2, unit_price: 50000 },
    { cat: 'sga', item: '영업 출장비', qty: 1, unit_price: 20000 },
  ] })).body;
  assert.deepEqual([c.title, c.customer, c.dev.req_no === dev.req_no, /^DC-\d{4}-01$/.test(c.cost_no)], ['저분진 와이퍼 원가', '삼성SDI', true, true]);
  assert.deepEqual(c.lines.map(l => l.amount), [840000, 80000, 100000, 20000]);
  // 직접비 1,020,000 · 판관비 = 20,000 + 102,000 · 총원가 1,142,000 · 단위원가 1,142 → 목표가 150은 적자, 권장가 = 1142/(1-0.2) = 1427.5 → 1428
  assert.deepEqual([c.calc.direct, c.calc.sga_auto, c.calc.sga, c.calc.total, c.calc.unit_cost, c.calc.margin, c.calc.margin_rate, c.calc.suggest, c.calc.first_date, c.calc.last_date], [1020000, 102000, 122000, 1142000, 1142, -992, -661.3, 1428, '2026-11-01', '2026-11-05']);
  assert.equal(c.calc.by.material, 840000);
  assert.equal((await admin('PUT', `/api/dev-costs/${c.id}`, { revision: c.revision, lines: [{ cat: 'material', item: '', qty: 1 }] })).status, 400, 'item required');
  assert.equal((await admin('PUT', `/api/dev-costs/${c.id}`, { revision: c.revision, sga_rate: 100 })).status, 400);
  c = (await admin('PUT', `/api/dev-costs/${c.id}`, { revision: c.revision, target_price: 2000 })).body; assert.deepEqual([c.calc.margin, c.calc.margin_rate], [858, 42.9]);
  const list = (await admin('GET', '/api/dev-costs')).body, d = list.dev_requests.find(x => x.id === dev.id); assert.deepEqual([d.cost_count, d.cost_total], [1, 1142000]);
  c = (await admin('POST', `/api/dev-costs/${c.id}/step`, { to: 'confirmed', revision: c.revision })).body; assert.equal(c.status, 'confirmed');
  assert.equal((await admin('PUT', `/api/dev-costs/${c.id}`, { revision: c.revision, note: 'x' })).status, 400, 'locked');
  assert.equal((await admin('POST', `/api/dev-costs/${c.id}/step`, { to: 'draft', revision: c.revision })).status, 400, 'reason');
  c = (await admin('POST', `/api/dev-costs/${c.id}/step`, { to: 'draft', revision: c.revision, reason: '단가 변경' })).body; assert.equal(c.status, 'draft');
  assert.equal((await admin('DELETE', `/api/dev-costs/${c.id}?revision=${c.revision}`)).status, 400, 'once confirmed cannot delete');
  assert.ok((await admin('GET', '/api/find?q=' + c.cost_no)).body.rows.some(x => x.type === 'devcost'));
  assert.ok(!(await prod('GET', '/api/find?q=' + c.cost_no)).body.rows.some(x => x.type === 'devcost'), 'non-researcher cannot find');
});

test('15.318 cost calculation reproduces the Excel sheets (nonwoven CF707 200SH, poly NX-808 25sh), point-in-time prices/rates, revisions on change, recalc, purchase-only', async () => {
  assert.equal((await prod('GET', '/api/cost/items')).status, 403);
  // 공통 기준: 1 WH 13,853.3979원 · 제조경비 10% · 판관비 12% · 불량률 0
  assert.equal((await admin('POST', '/api/cost/rates', { effective_date: '2026-01-01', labor_rate: 13853.3979, mfg_rate: 10, sga_rate: 12, defect_rate: 0, fx: { USD: 1400 }, request_id: rid() })).status, 200);
  // 백데이터: SONTARA 8864 = ($0.3632 + 0) × 1400 + 슬리팅·로스·운송 75.7891 = 584.2691원/SQM
  let mat = (await admin('POST', '/api/cost/materials', { code: 'SONTARA-8864', name: 'SONTARA 8864', category: '원단', supplier: '듀폰', unit: 'SQM', currency: 'USD', price: 0.3632, extra_krw: 75.7891, incoterms: 'CPT BUSAN', effective_date: '2026-01-01', request_id: rid() })).body;
  assert.equal(mat.current.krw_price, 584.2691);
  const lines = [
    { type: 'mat', material_id: mat.id, name: '원단', qty: '0.14*0.114*200', loss: 1 },
    { type: 'mat', name: '개별 포장지', price: '245000/1500*0.32' }, { type: 'mat', name: '대봉투', price: '187/50' }, { type: 'mat', name: 'BOX', price: '=2050/50' },
    { type: 'labor', name: '절단', qty: '200', capa: '9000*4' }, { type: 'labor', name: '1차포장', qty: '1', capa: '750/4' },
  ];
  let it = (await admin('POST', '/api/cost/items', { item_code: 'CF707-200', name: 'CF707 (5.5"*4.5") (200SH)', unit: 'PK', pieces: 200, sale_price: 2650, customer: '크린컨테크', lines, effective_date: '2026-01-02', request_id: rid() })).body;
  const t = it.totals;
  assert.deepEqual([t.material, t.labor, t.direct, t.mfg, t.sga, t.total, t.piece_cost, t.margin, t.margin_rate], [1980.64, 150.85, 2131.49, 213.15, 255.78, 2600.42, 13.0021, 49.58, 1.87]);
  assert.equal(it.rev, 0);
  assert.equal((await admin('POST', '/api/cost/items', { item_code: 'X', name: 'x', lines: [{ type: 'mat', name: 'a', price: '1/0' }] })).status, 400);
  assert.equal((await admin('POST', '/api/cost/items', { item_code: 'X', name: 'x', lines: [{ type: 'mat', name: 'a', price: 'alert(1)' }] })).status, 400);
  // 폴리 NX-808(25sh): 판관비 = (직접비+제조경비)×12%, 불량률 0.5% 가산(품목 덮어쓰기) → 엑셀 인상원가 80.0514
  const nx = (await admin('POST', '/api/cost/items', { item_code: 'NX-808-25', name: 'NX-808 (25sh)', kind: 'product', sga_base: 'mfg', overrides: { defect_rate: 0.5 }, sale_price: 102, lines: [
    { type: 'mat', name: '원단', price: '1370', qty: '1/36', loss: 5 }, { type: 'mat', name: '속포장지', price: '(3.09-2.79)/3.09' }, { type: 'mat', name: '박스내 포장지', price: '80/1000' }, { type: 'mat', name: 'BOX', price: '965/1000' },
    { type: 'labor', name: '재단', qty: '1', capa: '2200' }, { type: 'labor', name: '정렬/포장', qty: '1', capa: '800' }], effective_date: '2026-01-02', request_id: rid() })).body;
  assert.equal(nx.totals.total, 80.05); assert.equal(nx.totals.defect, 0.32);
  // 머리 정보만 바뀌면 리비전 없음 · 원가 바뀌면 사유 필수 · 시점은 마지막 리비전 이후
  it = (await admin('PUT', `/api/cost/items/${it.id}`, { revision: it.revision, customer: '크린컨테크 외' })).body; assert.equal(it.rev, 0);
  const l2 = it.lines.map(l => l.name === 'BOX' ? { ...l, price: '2200/50' } : l);
  assert.equal((await admin('PUT', `/api/cost/items/${it.id}`, { revision: it.revision, lines: l2 })).status, 400, 'reason required');
  assert.equal((await admin('PUT', `/api/cost/items/${it.id}`, { revision: it.revision, lines: l2, reason: 'BOX 단가', effective_date: '2025-12-31' })).status, 400, 'date before last rev');
  it = (await admin('PUT', `/api/cost/items/${it.id}`, { revision: it.revision, lines: l2, reason: 'BOX 단가 2,050 → 2,200', effective_date: '2026-03-01' })).body;
  assert.deepEqual([it.rev, it.rev_date, it.totals.total, it.prev_total, it.change_pct], [1, '2026-03-01', 2604.08, 2600.42, 0.14]);
  // 단가 변경(5월 +4%): 미리 보기 → 저장 + 영향 품목 재산출 → Rev.2(원인: 단가 변경)
  const dry = (await admin('POST', `/api/cost/materials/${mat.id}/prices`, { currency: 'USD', price: 0.3777, extra_krw: 75.7891, effective_date: '2026-05-01', reason: '5월 +4%', dry: true })).body;
  assert.equal(dry.impact.changed.length, 1); assert.equal(dry.impact.changed[0].id, it.id);
  const pr = (await admin('POST', `/api/cost/materials/${mat.id}/prices`, { currency: 'USD', price: 0.3777, extra_krw: 75.7891, effective_date: '2026-05-01', reason: '5월 +4%', recalc: true, request_id: rid() })).body;
  assert.equal(pr.impact.changed[0].rev, 2);
  const revs = (await admin('GET', `/api/cost/items/${it.id}/revs`)).body.rows;
  assert.deepEqual(revs.map(r => [r.rev, r.effective_date, r.cause]), [[0, '2026-01-02', 'create'], [1, '2026-03-01', 'manual'], [2, '2026-05-01', 'material']]);
  assert.equal(revs[2].lines[0].unit_price, cr(0.3777 * 1400 + 75.7891));
  assert.equal(revs[0].lines[0].unit_price, 584.2691, 'old revision keeps the price of its time');
  // 시점별 단가: 3월 기준 재계산은 옛 단가, 백데이터 목록은 지금(오늘) 단가
  const mats = (await admin('GET', '/api/cost/materials')).body.rows.find(m => m.id === mat.id); assert.equal(mats.price_count, 2); assert.deepEqual(mats.used_by.map(u => u.id), [it.id]);
  // 공통 기준 변경(인건비 인상) → 재산출: 공통 기준을 쓰는 품목만, 시점 이후 리비전
  await admin('POST', '/api/cost/rates', { effective_date: '2026-07-01', labor_rate: 14500, mfg_rate: 10, sga_rate: 12, defect_rate: 0, fx: { USD: 1400 }, reason: '하반기 인건비', request_id: rid() });
  const rc = (await admin('POST', '/api/cost/items/recalc', { rates: true, effective_date: '2026-07-01', reason: '하반기 인건비 반영' })).body;
  assert.ok(rc.changed.some(x => x.id === it.id && x.rev === 3) && rc.changed.some(x => x.id === nx.id));
  assert.equal((await admin('POST', '/api/cost/items/recalc', { rates: true, effective_date: '2026-07-01', reason: '다시' })).body.changed.length, 0, 'no change → no revision');
  assert.ok((await admin('GET', '/api/find?q=CF707-200')).body.rows.some(x => x.type === 'costitem'));
  assert.ok(!(await prod('GET', '/api/find?q=CF707-200')).body.rows.some(x => x.type === 'costitem'));
  // 엑셀 붙여넣기 백데이터: 새 코드는 등록, 같은 코드·다른 단가는 새 시점 단가, 같으면 건너뜀
  const bulk = (await admin('POST', '/api/cost/materials/bulk', { rows: [{ code: 'BOX-50', name: 'BOX', unit: 'EA', price: 2050, effective_date: '2026-01-01' }, { code: 'SONTARA-8864', name: 'SONTARA 8864', currency: 'USD', price: 0.3777, extra_krw: 75.7891, effective_date: '2026-05-01' }, { code: 'SONTARA-8864', name: 'x', currency: 'USD', price: 0.39, extra_krw: 75.7891, effective_date: '2026-09-01' }] })).body;
  assert.deepEqual([bulk.created, bulk.same, bulk.priced, bulk.errors.length], [1, 1, 1, 0]);
});
function cr(v) { return Math.round(v * 10000) / 10000; }
test('15.319 price impact preview works without a reason; bulk rejects rows without price or with an unknown currency', async () => {
  const mat = (await admin('POST', '/api/cost/materials', { code: 'T319-FILM', name: '필름', unit: 'EA', price: 10, effective_date: '2026-01-01', request_id: rid() })).body;
  await admin('POST', '/api/cost/items', { item_code: 'T319-A', name: '시험 품목', lines: [{ type: 'mat', material_id: mat.id, name: '필름', qty: '2' }], effective_date: '2026-01-02', request_id: rid() });
  const dry = await admin('POST', `/api/cost/materials/${mat.id}/prices`, { price: 12, effective_date: '2026-02-01', dry: true });
  assert.equal(dry.status, 200); assert.equal(dry.body.impact.changed[0].item_code, 'T319-A');
  assert.equal((await admin('POST', `/api/cost/materials/${mat.id}/prices`, { price: 12, effective_date: '2026-02-01', request_id: rid() })).status, 400, 'saving still needs a reason');
  const bulk = (await admin('POST', '/api/cost/materials/bulk', { rows: [{ code: 'T319-NOP', name: '단가 없음', unit: 'EA', price: '' }, { code: 'T319-GBP', name: '파운드', currency: 'GBP', price: 3 }, { code: 'T319-OK', name: '정상', currency: 'usd', price: 1, fx: 1400 }] })).body;
  assert.deepEqual([bulk.created, bulk.errors.length], [1, 2]);
  assert.match(bulk.errors.join(' '), /단가를 넣으세요/); assert.match(bulk.errors.join(' '), /GBP/);
  const ok = (await admin('GET', '/api/cost/materials')).body.rows.find(m => m.code === 'T319-OK'); assert.equal(ok.current.currency, 'USD'); assert.equal(ok.current.krw_price, 1400);
});
test('15.320 product spec is stored with the item and its revision header; spec-built lines reproduce the Excel CF707 per pack', async () => {
  const film = (await admin('POST', '/api/cost/materials', { code: 'T320-FILM', name: '개별 포장 필름', unit: 'M', price: '245000/1500', effective_date: '2026-01-01', request_id: rid() }));
  assert.equal(film.status, 400, 'price must be a plain number'); // 백데이터 단가는 숫자(식 아님)
  const f2 = (await admin('POST', '/api/cost/materials', { code: 'T320-FILM', name: '개별 포장 필름', unit: 'M', price: 163.3333, effective_date: '2026-01-01', request_id: rid() })).body;
  // 화면이 사양(이중 포장, 포장당 200sh, 박스당 50포장=10,000sh, 원단 폭 140mm·시트 139.7×114mm)으로 만든 줄
  const build = { on: true, pack: 'triple', unit: 'pack', dim: 'mm', fdim: 'mm', sw: '139.7', sl: '114', fw: '140', fprice: '584.2691', floss: '1', spp: '200', pmat: f2.id, puse: '0.32', spo: '10000', oprice: '187', spb: '10000', bprice: '2050', cut_capa: '9000*4', pk_capa: '750/4', bogus: 'x' };
  const lines = [
    { auto: 'fabric', type: 'mat', name: '원단', price: '584.2691', qty: '0.14*0.114*200', loss: 1 }, { auto: 'pack', type: 'mat', name: '속포장재', material_id: f2.id, qty: '0.32' },
    { auto: 'outer', type: 'mat', name: '외포장재', price: '187', qty: '200/10000' }, { auto: 'box', type: 'mat', name: '박스', price: '2050', qty: '200/10000' },
    { auto: 'cut', type: 'labor', name: '재단(절단)', qty: '200', capa: '9000*4' }, { auto: 'packing', type: 'labor', name: '포장', qty: '1', capa: '750/4' }];
  await admin('POST', '/api/cost/rates', { effective_date: '2026-01-01', labor_rate: 13853.3979, mfg_rate: 10, sga_rate: 12, defect_rate: 0, fx: { USD: 1400 }, reason: '320', request_id: rid() });
  const it = (await admin('POST', '/api/cost/items', { item_code: 'T320-CF707', name: 'CF707 200SH', unit: 'PK', pieces: 200, build, lines, effective_date: '2026-01-02', request_id: rid() })).body;
  assert.equal(it.build.on, true); assert.equal(it.build.spp, '200'); assert.equal(it.build.pmat, f2.id); assert.equal(it.build.bogus, undefined);
  assert.deepEqual(it.lines.map(l => l.auto), ['fabric', 'pack', 'outer', 'box', 'cut', 'packing']);
  assert.equal(it.totals.material, 1980.64); assert.equal(it.totals.labor, 150.85);
  const revs = (await admin('GET', `/api/cost/items/${it.id}/revs`)).body.rows; assert.equal(revs[0].header.build.spb, '10000');
  // 사양 연결을 끊어도(auto 표시만 빠짐) 원가가 같으면 리비전 없음
  const off = (await admin('PUT', `/api/cost/items/${it.id}`, { revision: it.revision, effective_date: '2026-01-02', build: { ...build, on: false }, lines: it.lines.map(({ auto, ...l }) => (void auto, l)) })).body;
  assert.equal(off.rev, 0); assert.equal(off.build.on, false);
  assert.equal((await admin('POST', '/api/cost/items', { item_code: 'T320-BAD', name: 'x', build: { on: true, spp: 'alert(1)' }, lines: [{ type: 'mat', name: 'a', price: '1' }] })).status, 400);
});
test('15.321 R&D estimates (stage=dev) share the purchase engine: researchers create/edit dev items only, purchase list excludes them, promote hands over to mass', async () => {
  const u = (await admin('GET', '/api/admin/users')).body.find(x => x.name === '생산');
  await admin('PUT', `/api/admin/users/${u.id}`, { roles: ['dev'] });
  try {
    const req = (await admin('POST', '/api/requests', { type: 'development', title: '저분진 와이퍼 9인치 양산', customer: '삼성SDI', due_date: '2027-03-31', target_price: '150', data: { extra: 'x' } })).body;
    assert.equal((await prod('GET', '/api/cost/items')).status, 403, 'mass list is purchase-only');
    const dl = (await prod('GET', '/api/cost/items?stage=dev')).body;
    assert.ok(dl.dev_requests.some(d => d.id === req.id)); assert.ok(Array.isArray(dl.materials)); assert.ok(dl.rates);
    assert.equal((await prod('POST', '/api/cost/items', { name: 'x', lines: [{ type: 'mat', name: 'a', price: '1' }] })).status, 403, 'researcher cannot create mass items');
    const est = (await prod('POST', '/api/cost/items', { stage: 'dev', dev_request_id: req.id, name: '저분진 와이퍼 9인치', unit: 'PK', pieces: 100, sale_price: 150, lines: [{ type: 'mat', name: '원단', price: '1230', qty: '100/36', loss: 5 }, { type: 'labor', name: '재단', qty: '100', capa: '2200' }], effective_date: '2026-01-02', request_id: rid() })).body;
    assert.equal(est.stage, 'dev'); assert.match(est.item_code, /^DEV-\d{4}$/); assert.equal(est.dev_request_id, req.id);
    assert.equal((await prod('POST', '/api/cost/items', { stage: 'dev', dev_request_id: 999999, name: 'x', lines: [{ type: 'mat', name: 'a', price: '1' }] })).status, 400);
    assert.ok(!(await admin('GET', '/api/cost/items')).body.rows.some(r => r.id === est.id), 'purchase list excludes dev estimates');
    assert.ok((await admin('GET', '/api/cost/items?stage=dev')).body.rows.some(r => r.id === est.id), 'purchase can still see estimates');
    const e2 = (await prod('PUT', `/api/cost/items/${est.id}`, { revision: est.revision, effective_date: '2026-02-01', reason: '원단 단가 가정 변경', lines: est.lines.map(l => l.name === '원단' ? { ...l, price: '1300' } : l) })).body;
    assert.equal(e2.rev, 1); assert.equal((await prod('GET', `/api/cost/items/${est.id}/revs`)).body.rows.length, 2);
    assert.equal((await prod('POST', '/api/cost/items/recalc', { ids: [est.id], effective_date: '2026-11-01', reason: '지금 단가', dry: true })).status, 200, 'researcher recalcs own estimates');
    const mass = (await admin('GET', '/api/cost/items')).body.rows[0];
    assert.equal((await prod('POST', '/api/cost/items/recalc', { ids: [mass.id], effective_date: '2026-11-01', reason: 'x' })).status, 403, 'not mass items');
    assert.equal((await prod('POST', '/api/cost/items/recalc', { rates: true, effective_date: '2026-11-01', reason: 'x' })).status, 403, 'not global recalc');
    assert.equal((await prod('PUT', `/api/cost/items/${mass.id}`, { revision: mass.revision, note: 'x' })).status, 403);
    assert.ok((await prod('GET', '/api/find?q=DEV-')).body.rows.some(r => r.type === 'costdev' && r.href === '#/dev/cost'));
    const pr = (await prod('POST', `/api/cost/items/${est.id}/promote`, { revision: e2.revision, note: '양산 확정' })).body;
    assert.equal(pr.stage, 'mass'); assert.equal(pr.rev, 1); assert.match(pr.history.at(-1).what, /양산 전환/);
    assert.ok((await admin('GET', '/api/cost/items')).body.rows.some(r => r.id === est.id), 'now in purchase list');
    assert.equal((await prod('GET', `/api/cost/items/${est.id}/revs`)).status, 403, 'after hand-over it is purchase-only');
    assert.equal((await admin('POST', `/api/cost/items/${est.id}/promote`, { revision: pr.revision })).status, 400);
  } finally { await admin('PUT', `/api/admin/users/${u.id}`, { roles: ['production', 'logistics'] }); }
});
test('15.322 goods landed cost: 40ft FOB Shanghai→Busan 1,600,000 ÷ 100 boxes = 16,000/box, duty % on CIF value (goods + freight + insurance), follows price changes', async () => {
  await admin('POST', '/api/cost/rates', { effective_date: '2026-01-01', labor_rate: 13853.3979, mfg_rate: 10, sga_rate: 12, defect_rate: 0, fx: { USD: 1400 }, reason: '322', request_id: rid() });
  const g = (await admin('POST', '/api/cost/materials', { code: 'T322-GLOVE', name: '니트릴 장갑(박스)', unit: 'BOX', currency: 'USD', price: 50, effective_date: '2026-01-01', request_id: rid() })).body;
  const build = { i_on: true, i_inc: 'FOB', i_mat: g.id, i_qty: '100', i_cont: '40ft', i_route: '상하이→부산', i_freight: '1600000', i_ins: '0', i_duty: '8', i_dest: '300000' };
  const lines = [
    { auto: 'goods', type: 'mat', name: '상품 매입가(FOB)', material_id: g.id, qty: '1' },
    { auto: 'freight', type: 'exp', name: '운임(40ft FOB 상하이→부산)', qty: '1/100', price: '1600000' },
    { auto: 'duty', type: 'exp', name: '관세(8% · CIF 과세가격)', pct: '8', base: ['goods', 'freight', 'insurance', 'bogus'] },
    { auto: 'dest', type: 'exp', name: '도착지 비용', qty: '1/100', price: '300000' }];
  const it = (await admin('POST', '/api/cost/items', { item_code: 'T322-GL', name: '니트릴 장갑 100매', kind: 'goods', unit: 'BOX', overrides: { mfg_rate: 0 }, build, lines, effective_date: '2026-01-02', request_id: rid() })).body;
  assert.deepEqual(it.lines[2].base, ['goods', 'freight', 'insurance'], 'unknown base keys dropped');
  assert.equal(it.build.i_inc, 'FOB'); assert.equal(it.build.i_route, '상하이→부산');
  const revs = (await admin('GET', `/api/cost/items/${it.id}/revs`)).body.rows, rl = revs[0].lines;
  assert.equal(rl[1].amount, 16000, 'freight per box');
  assert.equal(rl[2].amount, (70000 + 16000) * 0.08, 'duty on goods + freight'); assert.equal(rl[2].price_src, 'pct');
  assert.equal(it.totals.other, 16000 + 6880 + 3000); assert.equal(it.totals.direct, 95880); assert.equal(it.totals.mfg, 0); assert.equal(it.totals.total, 107385.6);
  // 매입가가 USD 55로 오르면 관세도 따라 바뀜(재산출)
  await admin('POST', `/api/cost/materials/${g.id}/prices`, { currency: 'USD', price: 55, effective_date: '2026-03-01', reason: '인상', recalc: true, request_id: rid() });
  const it2 = (await admin('GET', '/api/cost/items')).body.rows.find(r => r.id === it.id);
  assert.equal(it2.rev, 1); assert.equal(it2.totals.direct, 77000 + 16000 + (77000 + 16000) * 0.08 + 3000);
  assert.equal((await admin('POST', '/api/cost/items', { item_code: 'T322-BAD', name: 'x', lines: [{ type: 'exp', name: 'a', pct: 'alert(1)', base: ['goods'] }] })).status, 400);
});
test('15.323 multiple saved org charts: create from official copy / blank / another chart, validate nodes·members·cycles, admin-only, archive', async () => {
  const u = (await admin('GET', '/api/admin/users')).body.find(x => x.name === '생산');
  const d1 = (await admin('POST', '/api/admin/org/departments', { name: '경영지원' })).body;
  await admin('PUT', `/api/admin/users/${u.id}`, { department: '경영지원', position: '' });
  const off = (await admin('POST', '/api/admin/org-charts', { name: 'SBL 조직도', note: 'SBL 협업', copy: 'official', request_id: rid() })).body;
  assert.equal(off.name, 'SBL 조직도'); assert.ok(off.data.nodes.some(n => n.name === '경영지원' && n.members.some(m => m.user_id === u.id)), 'copied official departments and members');
  assert.equal((await admin('POST', '/api/admin/org-charts', { name: 'SBL 조직도' })).status, 400, 'unique name');
  assert.equal((await admin('POST', '/api/admin/org-charts', { name: '공식 조직도' })).status, 400);
  assert.equal((await prod('POST', '/api/admin/org-charts', { name: 'x' })).status, 403);
  const data = { title: 'SBL 사업', ceo_title: '사업 총괄', ceo_name: '외부 대표', nodes: [{ key: 'aaaa', name: 'SBL 영업', head: { user_id: u.id, role: 'PM' }, members: [{ name: '협력사 김과장', role: '물류' }, { user_id: 999999 }].slice(0, 1), duties: '수주\n물류' }, { key: 'bbbb', name: 'SBL 생산', parent: 'aaaa', members: [] }] };
  const s2 = (await admin('PUT', `/api/admin/org-charts/${off.id}`, { revision: off.revision, data, what: '상자 수정' })).body;
  assert.equal(s2.data.nodes.length, 2); assert.equal(s2.data.nodes[0].head.role, 'PM'); assert.equal(s2.data.nodes[0].members[0].name, '협력사 김과장'); assert.equal(s2.data.nodes[1].parent, 'aaaa');
  assert.equal((await admin('PUT', `/api/admin/org-charts/${off.id}`, { revision: off.revision, data })).status, 409, 'stale revision');
  assert.equal((await admin('PUT', `/api/admin/org-charts/${off.id}`, { revision: s2.revision, data: { nodes: [{ key: 'aaaa', name: 'A', parent: 'bbbb' }, { key: 'bbbb', name: 'B', parent: 'aaaa' }] } })).status, 400, 'cycle');
  assert.equal((await admin('PUT', `/api/admin/org-charts/${off.id}`, { revision: s2.revision, data: { nodes: [{ key: 'aaaa', name: 'A', members: [{ user_id: 999999 }] }] } })).status, 400, 'unknown user');
  const cp = (await admin('POST', '/api/admin/org-charts', { name: 'SBL 2027', copy: off.id, request_id: rid() })).body; assert.equal(cp.data.nodes.length, 2);
  const blank = (await admin('POST', '/api/admin/org-charts', { name: 'TF', copy: '', request_id: rid() })).body; assert.equal(blank.data.nodes.length, 0);
  const view = (await prod('GET', '/api/org/chart')).body; assert.deepEqual(view.charts.map(c => c.name), ['SBL 조직도', 'SBL 2027', 'TF']);
  assert.equal((await prod('GET', `/api/org/charts/${off.id}`)).body.data.nodes[0].name, 'SBL 영업', 'everyone can view');
  await admin('PUT', `/api/admin/org-charts/${blank.id}`, { revision: blank.revision, active: false });
  assert.ok(!(await prod('GET', '/api/org/chart')).body.charts.some(c => c.id === blank.id)); assert.equal((await prod('GET', `/api/org/charts/${blank.id}`)).status, 404);
  assert.match((await admin('GET', `/api/org/charts/${off.id}`)).body.history.at(-1).what, /상자 수정/);
  await admin('PUT', `/api/admin/users/${u.id}`, { department: '', position: '' }); await admin('PUT', `/api/admin/org/departments/${d1.id}`, { active: false });
});

test('15.329 login log with IP/location, last seen per user, country allowlist with exempt users, lock-out guard, env override', async () => {
  const geoClient = (cf, ip) => { let cookie = ''; return async (method, url, body) => {
    const req = new Request('https://lot249.test' + url, { method, headers: { cookie, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (cf) Object.defineProperty(req, 'cf', { value: cf });
    const r = await worker.fetch(req, env); if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  }; };
  const kr = geoClient({ country: 'KR', city: 'Seoul', region: 'Seoul' }, '211.36.1.10'), us = geoClient({ country: 'US', city: 'Los Angeles', region: 'California' }, '8.8.4.4');
  assert.equal((await kr('POST', '/api/auth/login', { name: '관리자', password: 'password' })).status, 200);
  assert.equal((await us('POST', '/api/auth/login', { name: '생산', password: 'wrong' })).status, 401);
  assert.equal((await us('POST', '/api/auth/login', { name: '생산', password: 'password' })).status, 200);
  let sec = (await kr('GET', '/api/admin/security')).body;
  assert.deepEqual([sec.here.ip, sec.here.country, sec.here.city, sec.here.known], ['211.36.1.10', 'KR', 'Seoul', true]);
  const p = sec.users.find(u => u.name === '생산'), a = sec.users.find(u => u.name === '관리자');
  assert.deepEqual([p.last_ip, p.last_country, p.last_city, p.fails_7d], ['8.8.4.4', 'US', 'Los Angeles', 1]);
  assert.equal(a.last_country, 'KR'); assert.ok(a.last_login_at);
  const logs = (await kr('GET', '/api/admin/security/logs?user_id=' + p.id)).body.rows;
  assert.deepEqual(logs.slice(0, 2).map(l => l.result), ['ok', 'fail']); assert.equal(logs[0].region, 'California');
  assert.equal((await prod('GET', '/api/admin/security')).status, 403);
  assert.deepEqual((await us('GET', '/api/me/logins')).body.rows.slice(0, 2).map(l => l.country), ['US', 'US']);
  // guards: unknown location (no cf) cannot enable; current country must stay allowed; codes validated
  assert.equal((await admin('PUT', '/api/admin/security/geo', { enabled: true, countries: ['KR'] })).status, 400);
  assert.match((await kr('PUT', '/api/admin/security/geo', { enabled: true, countries: ['US'] })).body.error, /KR/);
  assert.equal((await kr('PUT', '/api/admin/security/geo', { enabled: true, countries: ['KOR'] })).status, 400);
  assert.equal((await kr('PUT', '/api/admin/security/geo', { enabled: true, countries: ['KR'], exempt_user_ids: [99999] })).status, 400);
  assert.equal((await kr('PUT', '/api/admin/security/geo', { enabled: true, countries: ['kr', 'JP'] })).status, 200);
  // US blocked: existing session, /api/me reason, login (logged as blocked, password not checked)
  assert.equal((await us('GET', '/api/dashboard')).status, 403);
  assert.match((await us('GET', '/api/me')).body.geo_blocked, /US/);
  const bl = await us('POST', '/api/auth/login', { name: '생산', password: 'anything' }); assert.equal(bl.status, 403);
  assert.equal((await kr('GET', '/api/admin/security/logs?result=blocked')).body.rows[0].name, '생산');
  assert.equal((await kr('GET', '/api/dashboard')).status, 200);
  assert.equal((await admin('GET', '/api/me')).body.user.name, '관리자'); // no location (local) is not blocked
  // exempt user may connect from anywhere
  assert.equal((await kr('PUT', '/api/admin/security/geo', { enabled: true, countries: ['KR'], exempt_user_ids: [p.id], block_unknown: true })).status, 200);
  assert.equal((await us('POST', '/api/auth/login', { name: '생산', password: 'password' })).status, 200);
  const tor = geoClient({ country: 'T1' }, '185.220.101.1');
  assert.equal((await tor('POST', '/api/auth/login', { name: '관리자', password: 'password' })).status, 403);
  // emergency override
  env.GEO_BLOCK_OFF = '1';
  try { assert.equal((await tor('POST', '/api/auth/login', { name: '관리자', password: 'password' })).status, 200); } finally { delete env.GEO_BLOCK_OFF; }
  assert.equal((await kr('PUT', '/api/admin/security/geo', { enabled: false, countries: ['KR'] })).status, 200);
  assert.equal((await tor('GET', '/api/dashboard')).status, 200);
});

test('15.330 logistics operator: open POs / pending ship instructions without prices, receive against PO only, ship one instruction, no other APIs; production operator unchanged', async () => {
  const lg = client(), both = client();
  await admin('POST', '/api/admin/users', { name: '물류작업', password: 'password', roles: ['operator_logistics'] });
  await admin('POST', '/api/admin/users', { name: '겸직작업', password: 'password', roles: ['operator', 'operator_logistics'] });
  assert.equal((await lg('POST', '/api/auth/login', { name: '물류작업', password: 'password' })).status, 200);
  assert.equal((await both('POST', '/api/auth/login', { name: '겸직작업', password: 'password' })).status, 200);
  await admin('POST', '/api/po', { req_no: 'OP-330', vendor: '오퍼공급', item: '오퍼원단', unit: 'YD', qty: 10, due_date: today, item_category: '원자재' });
  const open = (await lg('GET', '/api/operator/open-po')).body, po = open.find(p => p.req_no === 'OP-330');
  assert.ok(po); assert.ok(!('price' in po) && !('unit_price' in po) && !('amount' in po));
  const r = await lg('POST', '/api/receipts', { request_id: rid(), receipt_date: today, vendor: '오퍼공급', lines: [{ po_id: po.id, qty: 4, lot: 'OPL-1' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match((await lg('POST', '/api/receipts', { request_id: rid(), receipt_date: today, vendor: '오퍼공급', lines: [{ item: '아무거나', qty: 1 }] })).body.error, /발주 입고만/);
  const h = (await lg('GET', '/api/operator/log-history')).body; assert.deepEqual(h.receipts.map(x => [x.item, x.qty, x.lot]), [['오퍼원단', 4, 'OPL-1']]);
  assert.ok(Array.isArray((await lg('GET', '/api/operator/ship-pending')).body));
  assert.equal((await lg('POST', '/api/ship-instructions/ship', { ids: [1, 2] })).status, 400, 'one at a time');
  const places = (await lg('GET', '/api/inventory/places')).body; assert.ok(places.rows.some(r => r.item === '오퍼원단' && r.lot === 'OPL-1' && r.qty === 4)); assert.ok(!JSON.stringify(places).includes('price')); // 15.331 재고 현황
  assert.equal((await lg('POST', '/api/ship-instructions/999999/ship-lots', { lines: [{ lot: 'X', qty: 1 }] })).status, 404, '15.331 operator may split by LOT');
  assert.equal((await lg('GET', '/api/inventory/lots')).status, 403);
  for (const u of ['/api/po', '/api/ship-instructions', '/api/operator/plans?date=' + today, '/api/sales-bills']) assert.equal((await lg('GET', u)).status, 403, u);
  assert.equal((await lg('POST', '/api/semi-batches', {})).status, 403);
  assert.equal((await prod('GET', '/api/operator/open-po')).status, 200, 'logistics staff may read it too');
  assert.equal((await both('GET', '/api/operator/plans?date=' + today)).status, 200);
  assert.equal((await both('GET', '/api/operator/open-po')).status, 200);
});

test('15.333 quality document folders: add (with parents), validate, move docs, rename carries docs and subfolders, delete only when empty, quality only', async () => {
  const f = b => admin('PUT', '/api/qdoc-folders', b);
  assert.deepEqual((await f({ action: 'add', path: '생산/세탁' })).body.folders, ['생산', '생산/세탁']);
  assert.equal((await f({ action: 'add', path: 'a/b/c/d' })).status, 400, 'depth 3');
  assert.equal((await f({ action: 'add', path: '생산' })).status, 400, 'duplicate');
  const d1 = (await admin('POST', '/api/qdocs', { kind: 'procedure', title: '세탁 절차', folder: '생산/세탁', request_id: rid() })).body;
  assert.equal(d1.folder, '생산/세탁');
  assert.equal((await admin('POST', '/api/qdocs', { kind: 'procedure', title: 'x', folder: '없는폴더', request_id: rid() })).status, 400);
  const d2 = (await admin('POST', '/api/qdocs', { kind: 'form', title: '점검표', request_id: rid() })).body;
  assert.equal(d2.folder, '');
  assert.equal((await admin('POST', '/api/qdocs/move', { ids: [d2.id], folder: '생산' })).body.moved, 1);
  const r = await f({ action: 'rename', from: '생산', name: '제조' });
  assert.deepEqual(r.body.folders, ['제조', '제조/세탁']);
  const rows = (await admin('GET', '/api/qdocs')).body.rows;
  assert.equal(rows.find(x => x.id === d1.id).folder, '제조/세탁'); assert.equal(rows.find(x => x.id === d2.id).folder, '제조');
  assert.match((await f({ action: 'delete', path: '제조' })).body.error, /문서 2건/);
  await admin('POST', '/api/qdocs/move', { ids: [d1.id, d2.id], folder: '' });
  assert.deepEqual((await f({ action: 'delete', path: '제조' })).body.folders, []);
  assert.equal((await prod('PUT', '/api/qdoc-folders', { action: 'add', path: 'x' })).status, 403);
  assert.equal((await prod('POST', '/api/qdocs/move', { ids: [d1.id], folder: '' })).status, 403);
});
