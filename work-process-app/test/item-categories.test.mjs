// 제품등록 (15.29): prepared sub-category tree, picked not typed; 반제품 kind follows its category into cutting/washing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'item-cat-'));
const { env, sqlite } = localEnvironment(dir, 'cat-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://cat.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client();
const nodes = async () => (await admin('GET', '/api/item-categories')).body;
const find = async (item_class, name, parent = null) => (await nodes()).find(n => n.item_class === item_class && n.name === name && (n.parent_id || null) === parent);
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'cat-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'cat-test' });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Seeded 반제품 kinds; tree rules: admin only, same class, three levels, unique per place', async () => {
  const wiper = await find('반제품', '와이퍼'); const cloth = await find('반제품', '천와이퍼', wiper.id);
  assert.equal(cloth.semi_type, '천와이퍼'); assert.equal((await find('반제품', '스무드', (await find('반제품', '심리스글러브')).id)).semi_type, '스무드');
  assert.equal((await staff('POST', '/api/item-categories', { item_class: '제품', name: '와이퍼' })).status, 403);
  const finished = (await admin('POST', '/api/item-categories', { item_class: '제품', name: '와이퍼' })).body.id;
  assert.equal((await admin('POST', '/api/item-categories', { item_class: '제품', name: '와이퍼' })).status, 409);
  const l2 = (await admin('POST', '/api/item-categories', { item_class: '제품', parent_id: finished, name: '천와이퍼' })).body.id;
  const l3 = (await admin('POST', '/api/item-categories', { item_class: '제품', parent_id: l2, name: '폴리에스테르와이퍼' })).body.id;
  assert.equal((await admin('POST', '/api/item-categories', { item_class: '제품', parent_id: l3, name: '4차' })).status, 400);
  assert.equal((await admin('POST', '/api/item-categories', { item_class: '상품', parent_id: l2, name: '다른 분류' })).status, 400);
  assert.equal((await admin('POST', '/api/item-categories', { item_class: '제품', name: 'X', semi_type: '천와이퍼' })).status, 400, 'kinds are for 반제품 only');
  const product = await admin('POST', '/api/boms', { product: 'NX-707', product_code: 'NX-707', item_category: '제품', kind: 'finished', base_qty: 1, unit: '매', materials: [{ item: '원단', item_category: '원자재', qty: 1, unit: 'yd' }], cat1: '와이퍼', cat2: '천와이퍼', cat3: '폴리에스테르와이퍼' });
  assert.equal(product.status, 200, JSON.stringify(product.body)); assert.equal(product.body.semi_type, '');
  assert.equal((await admin('POST', '/api/boms', { product: 'Y', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [{ item: '원단', item_category: '원자재', qty: 1, unit: 'yd' }], cat1: '와이퍼', cat2: '폴리에스테르와이퍼' })).status, 400, 'a level must sit under the chosen parent');
});

test('A 반제품 inherits the kind of its category and shows up in cutting and operator choices', async () => {
  const cloth = await find('반제품', '천와이퍼', (await find('반제품', '와이퍼')).id);
  const poly = (await admin('POST', '/api/item-categories', { item_class: '반제품', parent_id: cloth.id, name: '폴리에스테르와이퍼' })).body.id;
  const semi = (await admin('POST', '/api/boms', { product: 'NX-707D', product_code: 'NX-707D', item_category: '반제품', kind: 'semi', base_qty: 1, unit: '매', materials: [], cat1: '와이퍼', cat2: '천와이퍼', cat3: '폴리에스테르와이퍼' })).body;
  assert.equal(semi.semi_type, '천와이퍼');
  const listed = (await staff('GET', '/api/boms?item_category=' + encodeURIComponent('반제품'))).body.filter(b => b.semi_type).map(b => b.product_code);
  assert.deepEqual(listed, ['NX-707D']);
  const line = (await admin('POST', '/api/production-units', { kind: 'line', name: '1라인' })).body;
  const cut = await admin('POST', '/api/semi-batches', { process: 'cut', common: { work_date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()), unit_id: line.id }, items: [{ entry_mode: 'code', bom_id: semi.id, qty: 10, start_time: '08:00', end_time: '09:00' }] });
  assert.equal(cut.status, 200, JSON.stringify(cut.body)); assert.equal(cut.body.rows[0].product_type, '천와이퍼');
  // Moving the node's kind moves the items filed under it.
  assert.equal((await admin('PUT', `/api/item-categories/${poly}`, { semi_type: '부직포와이퍼' })).status, 200);
  assert.equal(sqlite.prepare('SELECT semi_type FROM boms WHERE id=?').get(semi.id).semi_type, '부직포와이퍼');
  assert.equal((await admin('PUT', `/api/item-categories/${poly}`, { semi_type: '' })).status, 200);
  assert.equal(sqlite.prepare('SELECT semi_type FROM boms WHERE id=?').get(semi.id).semi_type, '천와이퍼', 'falls back to the parent kind');
});

test('Renaming follows through to items; a stopped category hides from new picks but its items stay editable', async () => {
  const finished = await find('제품', '와이퍼'); const l2 = await find('제품', '천와이퍼', finished.id);
  assert.equal((await admin('PUT', `/api/item-categories/${l2.id}`, { name: '극세사와이퍼' })).status, 200);
  const item = sqlite.prepare("SELECT * FROM boms WHERE product='NX-707'").get();
  assert.deepEqual([item.cat1, item.cat2, item.cat3], ['와이퍼', '극세사와이퍼', '폴리에스테르와이퍼']);
  assert.equal((await admin('PUT', `/api/item-categories/${finished.id}`, { active: false })).status, 200);
  const base = { product: 'NX-707', product_code: 'NX-707', item_category: '제품', kind: 'finished', base_qty: 1, unit: '매', materials: [{ item: '원단', item_category: '원자재', qty: 1, unit: 'yd' }] };
  assert.equal((await admin('PUT', `/api/boms/${item.id}`, { ...base, note: '수정' })).status, 200, 'unchanged path is kept');
  assert.equal((await admin('POST', '/api/boms', { ...base, product: '새 제품', product_code: 'NEW', cat1: '와이퍼' })).status, 400, 'stopped category is not offered for new items');
  assert.ok(sqlite.prepare("SELECT 1 FROM item_category_nodes").get()); assert.ok((await admin('GET', '/api/admin/backup')).body.tables.includes('item_category_nodes'));
});

test('0023 turns categories already on items into selectable nodes without changing items', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-migration-'));
  let db = new DatabaseSync(path.join(d, 'app.db'));
  try {
    db.exec('CREATE TABLE _local_migrations(name TEXT PRIMARY KEY)');
    const folder = new URL('../drizzle/', import.meta.url);
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql') && f < '0023').sort()) { db.exec(fs.readFileSync(new URL(file, folder), 'utf8')); db.prepare('INSERT INTO _local_migrations VALUES(?)').run(file); }
    db.prepare("INSERT INTO boms(product,kind,base_qty,unit,materials,item_category,cat1,cat2,cat3,semi_type) VALUES('기존 원단','finished',1,'yd','[]','원자재','원단','폴리','40수','')").run();
    db.prepare("INSERT INTO boms(product,kind,base_qty,unit,materials,item_category,cat1,cat2,cat3,semi_type) VALUES('CF-707','semi',1,'매','[]','반제품','와이퍼','부직포와이퍼','','부직포와이퍼')").run();
    db.close(); ({ sqlite: db } = localEnvironment(d, 'test'));
    const rows = db.prepare('SELECT item_class,level,name,semi_type FROM item_category_nodes ORDER BY item_class,level,name').all().map(r => [r.item_class, r.level, r.name, r.semi_type]);
    assert.deepEqual(rows.filter(r => r[0] === '원자재'), [['원자재', 1, '원단', ''], ['원자재', 2, '폴리', ''], ['원자재', 3, '40수', '']]);
    assert.deepEqual(rows.filter(r => r[0] === '반제품'), [['반제품', 1, '심리스글러브', ''], ['반제품', 1, '와이퍼', ''], ['반제품', 2, '부직포와이퍼', '부직포와이퍼'], ['반제품', 2, '스무드', '스무드'], ['반제품', 2, '천와이퍼', '천와이퍼'], ['반제품', 2, '타키', '타키']]);
    assert.deepEqual({ ...db.prepare("SELECT cat1,cat2,cat3,semi_type FROM boms WHERE product='CF-707'").get() }, { cat1: '와이퍼', cat2: '부직포와이퍼', cat3: '', semi_type: '부직포와이퍼' });
  } finally { db.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('A product used for production too: kind, production unit and box conversion; stock lines show the other unit', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const base = { product: 'NX-707 박스', product_code: 'NX-707B', item_category: '제품', kind: 'finished', base_qty: 1, unit: '박스', materials: [{ item: '원단', item_category: '원자재', qty: 1, unit: 'yd' }] };
  assert.equal((await admin('POST', '/api/boms', { ...base, semi_type: '천와이퍼' })).status, 400, 'a kind needs the checkbox');
  assert.equal((await admin('POST', '/api/boms', { ...base, semi_enabled: ['on'], semi_type: '천와이퍼', semi_unit: '매' })).status, 400, 'boxes need a conversion');
  const nx = (await admin('POST', '/api/boms', { ...base, semi_enabled: ['on'], semi_type: '천와이퍼', semi_unit: '매', pack_qty: 1000 })).body;
  assert.deepEqual([nx.semi_type, nx.semi_unit, nx.pack_qty, nx.unit], ['천와이퍼', '매', 1000, '박스']);
  const line = (await admin('GET', '/api/production-units?kind=line')).body[0] || (await admin('POST', '/api/production-units', { kind: 'line', name: '2라인' })).body;
  const cut = await admin('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, items: [{ entry_mode: 'code', bom_id: nx.id, qty: 2500, start_time: '08:00', end_time: '09:00' }] });
  assert.equal(cut.status, 200, JSON.stringify(cut.body)); assert.deepEqual([cut.body.rows[0].unit, cut.body.rows[0].product_type], ['매', '천와이퍼']);
  const po = (await admin('POST', '/api/po', { req_no: 'P', vendor: 'V', bom_id: nx.id, qty: 3, due_date: today, item_category: '제품' })).body;
  await admin('POST', '/api/po/receive', { ids: [po.id], status: 'ok' });
  const rows = (await admin('GET', '/api/inventory')).body.rows.filter(r => r.item === 'NX-707 박스');
  assert.deepEqual(rows.map(r => [r.unit, r.stock, r.converted]).sort(), [['매', 2500, { qty: 2.5, unit: '박스' }], ['박스', 3, { qty: 3000, unit: '매' }]]);
  // Turning it off removes it from production choices; same-unit products need no conversion.
  assert.equal((await admin('PUT', `/api/boms/${nx.id}`, { ...base, semi_enabled: [] })).body.semi_type, '');
  const sheet = (await admin('POST', '/api/boms', { ...base, product: 'NX-707 낱장', product_code: 'NX-707S', unit: '매', semi_enabled: true, semi_type: '천와이퍼' })).body;
  assert.deepEqual([sheet.semi_unit, sheet.pack_qty], ['매', null]);
  assert.equal((await admin('POST', '/api/boms', { ...base, product: '코드없음', product_code: '', unit: '매', semi_enabled: true, semi_type: '천와이퍼' })).status, 400, 'production items need a code');
});

test('Size sets live on categories and are inherited by the items below', async () => {
  const garment = (await admin('POST', '/api/item-categories', { item_class: '상품', name: '방진복', sizes: 'xs, S,M L,XL' })).body.id;
  const onepiece = (await admin('POST', '/api/item-categories', { item_class: '상품', parent_id: garment, name: '원피스' })).body.id;
  assert.equal((await find('상품', '방진복')).sizes, 'XS,S,M,L,XL');
  const suit = (await admin('POST', '/api/boms', { product: '방진복 원피스 흰색', product_code: 'CR-OP-W', item_category: '상품', kind: 'finished', base_qty: 1, unit: '벌', materials: [], cat1: '방진복', cat2: '원피스' })).body;
  assert.deepEqual(suit.sizes, ['XS', 'S', 'M', 'L', 'XL']);
  await admin('PUT', `/api/item-categories/${onepiece}`, { sizes: 'S M L XL 2XL' });
  assert.deepEqual((await staff('GET', '/api/boms?q=CR-OP-W')).body[0].sizes, ['S', 'M', 'L', 'XL', '2XL'], 'the nearest category wins');
  assert.equal((await admin('PUT', `/api/item-categories/${onepiece}`, { sizes: Array.from({ length: 21 }, (_, i) => 'S' + i).join(',') })).status, 400);
  // Lines are saved per size like any other spec.
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const batch = await staff('POST', '/api/batches/purchase_order', { common: { req_no: 'PR-S', vendor: 'V', due_date: today }, items: ['S', 'M'].map((spec, i) => ({ bom_id: suit.id, item: suit.product, unit: '벌', spec, qty: 10 * (i + 1), item_category: '상품' })), request_id: crypto.randomUUID() });
  assert.equal(batch.status, 200, JSON.stringify(batch.body)); assert.deepEqual(batch.body.rows.map(r => [r.spec, r.qty]), [['S', 10], ['M', 20]]);
});
