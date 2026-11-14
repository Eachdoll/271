// Wash entry (15.27): product code decides kind and unit; a blank run time on a new record is the current time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wash-entry-'));
const { env, sqlite } = localEnvironment(dir, 'wash-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://wash.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const nowHM = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
let washer, wiper, glove;
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'wash-test' });
  washer = (await admin('POST', '/api/production-units', { kind: 'washer', name: '1호기' })).body;
  const model = async (product, semi_type, unit) => (await admin('POST', '/api/boms', { product, product_code: product, item_category: '반제품', kind: 'semi', base_qty: 1, unit, materials: [], semi_type })).body;
  wiper = await model('NX-707D', '천와이퍼', '매'); glove = await model('HD-08p', '스무드', '켤레');
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Unit and kind come from the product code, not from the request', async () => {
  const r = await admin('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, request_id: crypto.randomUUID(), items: [
    { entry_mode: 'wash_quantity', bom_id: wiper.id, qty: 300, unit: 'kg', spec: '9', start_time: '09:00' },
    { entry_mode: 'wash_quantity', bom_id: glove.id, qty: 200, start_time: '09:00' } ] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.rows.map(x => [x.product_group, x.product_type, x.unit, x.spec, x.qty]), [['wiper', '천와이퍼', '매', '', 300], ['seamless', '스무드', '켤레', '', 200]]);
  assert.equal((await admin('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, items: [{ entry_mode: 'wash_quantity', bom_id: 999, qty: 1 }] })).status, 400);
});

test('A blank run time becomes the current time, shared by every row of one submission', async () => {
  const before = nowHM();
  const r = await admin('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, request_id: crypto.randomUUID(), items: [
    { entry_mode: 'wash_quantity', bom_id: wiper.id, qty: 10 }, { entry_mode: 'wash_quantity', bom_id: glove.id, qty: 20, start_time: '' }] });
  const after = nowHM(); const times = r.body.rows.map(x => x.start_time);
  assert.equal(times[0], times[1]); assert.ok(times[0] >= before && times[0] <= after, `${before} <= ${times[0]} <= ${after}`);
  const single = (await admin('POST', '/api/semi-records', { process: 'wash', entry_mode: 'wash_quantity', work_date: today, unit_id: washer.id, bom_id: wiper.id, qty: 5 })).body;
  assert.match(single.start_time ?? (await admin('GET', `/api/semi-records?process=wash&from=${today}&to=${today}`)).body.find(x => x.id === single.id).start_time, /^\d\d:\d\d$/);
  const summary = (await admin('GET', `/api/wash-summary?from=${today}&to=${today}`)).body[0];
  assert.ok(summary.runs >= 2 && summary.runs <= 3, 'the 09:00 run plus the run(s) at the current time');
});

test('Editing keeps the unit of an unchanged item; an old record without a time is not given one', async () => {
  const legacy = sqlite.prepare("INSERT INTO semi_records(process,work_date,unit_id,unit_name,product_group,product_type,bom_id,item_name,product_code,bom_snapshot,spec,qty,defect_qty,unit,created_by_id,created_by) VALUES('wash',?,?,?,'wiper','천와이퍼',?,'NX-707D','NX-707D','{}','9인치',40,0,'장',1,'관리자')").run(today, washer.id, washer.name, wiper.id);
  const id = Number(legacy.lastInsertRowid);
  const edited = await admin('PUT', `/api/semi-records/${id}`, { entry_mode: 'wash_quantity', work_date: today, unit_id: washer.id, bom_id: wiper.id, qty: 40, start_time: '', note: '메모', reason: '메모 추가', request_id: crypto.randomUUID() });
  assert.equal(edited.status, 200, JSON.stringify(edited.body)); assert.equal(edited.body.pending, false, 'only the note changed');
  const row = sqlite.prepare('SELECT unit,spec,start_time,note FROM semi_records WHERE id=?').get(id);
  assert.deepEqual({ ...row }, { unit: '장', spec: '9인치', start_time: null, note: '메모' });
});
