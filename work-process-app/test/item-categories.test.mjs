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
