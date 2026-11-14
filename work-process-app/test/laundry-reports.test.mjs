// 세탁 검수·성적서: per-wash-date inspection record, cumulative totals, unit prices and issuing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'laundry-report-'));
const { env, sqlite } = localEnvironment(dir, 'lr-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://lr.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client(), other = client(), buyer = client();
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [staff, '직원'], [other, '다른직원'], [buyer, '구매담당']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'lr-test' });
  const users = (await admin('GET', '/api/admin/users')).body;
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '구매담당').id}`, { roles: ['purchase'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const wash = (garment, sizes) => Object.entries(sizes).map(([size, qty]) => ({ section: 'wash', garment, size, qty }));
// The 2026-11-10 sheet from the customer's workbook.
const nov10 = [
  ...wash('op_white', { '4XL': 66, '5XL': 12 }),
  ...wash('op_sky', { L: 4, XL: 7, '2XL': 30, '4XL': 40, '6XL': 5 }),
  ...wash('tp_navy', { L: 11, XL: 19, '2XL': 26, '3XL': 91, '4XL': 95, '5XL': 29, '6XL': 8, '7XL': 2 }),
  { section: 'discard', garment: 'op_sky', part: '후드', size: '3XL', qty: 1 },
];
const settings = { customer: 'Merck', vendor: 'CNC+', inspector: '㈜테스트 경영지원팀 홍길동',
  prices: { vendor: { onepiece: 3960, twopiece: 2340, gown: 2340, shoes: 2500 }, customer: { onepiece: 4700, twopiece: 2800, gown: 2800, shoes: 0 }, discard: { 방진복: 2800, 후드: 950, 덧신: 950, 상: 1400, 하: 1400, 가운: 2800, 안전화: 0 } } };

test('Inspection record: validation, totals that match the workbook, and money only for purchasing', async () => {
  const meta = (await staff('GET', '/api/laundry-report-meta')).body;
  assert.deepEqual(meta.forms.map(f => f.label), ['생산', 'QC']); assert.equal(meta.can_money, false); assert.equal(meta.prices, null);
  assert.equal((await staff('PUT', '/api/laundry-report-settings', settings)).status, 403);
  assert.equal((await buyer('PUT', '/api/laundry-report-settings', settings)).status, 200);
  assert.equal((await buyer('GET', '/api/laundry-report-meta')).body.prices.vendor.onepiece, 3960);

  const base = { wash_date: '2026-11-10', pickup_label: '261105', inspector: settings.inspector };
  for (const lines of [[{ section: 'wash', garment: 'nope', size: 'M', qty: 1 }], [{ section: 'wash', garment: 'op_white', size: '9XL', qty: 1 }], [{ section: 'wash', garment: 'op_white', size: 'M', qty: 1.5 }], [{ section: 'wash', garment: 'op_white', size: 'M', qty: -1 }],
    [{ section: 'discard', garment: 'tp_navy', part: '후드', size: 'M', qty: 1 }], [...wash('op_white', { M: 1 }), ...wash('op_white', { M: 2 })]])
    assert.equal((await staff('POST', '/api/laundry-reports', { ...base, lines })).status, 400, JSON.stringify(lines));
  const id = (await staff('POST', '/api/laundry-reports', { ...base, lines: [...nov10, { section: 'wash', garment: 'shoes', size: 'M', qty: 0 }, { section: 'wash', garment: 'shoes', size: 'L', qty: '' }] })).body.id;
  assert.equal((await staff('POST', '/api/laundry-reports', { ...base, lines: [] })).status, 409, 'one record per wash date');

  const seenByStaff = (await staff('GET', `/api/laundry-reports/${id}`)).body;
  assert.equal(seenByStaff.lines.length, nov10.length, 'zero and blank cells are not stored');
  assert.deepEqual([seenByStaff.summary.wash.op_white, seenByStaff.summary.wash.op_sky, seenByStaff.summary.wash.tp_navy, seenByStaff.summary.wash_total, seenByStaff.summary.discard_total], [78, 86, 281, 445, 1]);
  assert.equal(seenByStaff.summary.vendor_cost, undefined, 'amounts are hidden without the purchasing role'); assert.equal(seenByStaff.prices, undefined);
  const seenByBuyer = (await buyer('GET', `/api/laundry-reports/${id}`)).body.summary;
  assert.deepEqual([seenByBuyer.vendor_cost, seenByBuyer.customer_amount, seenByBuyer.profit, seenByBuyer.discard_amount], [1306980, 1557600, 250620, 950]);
});

test('Edit, issue, price snapshot, cancel and delete', async () => {
  const id = (await buyer('GET', '/api/laundry-reports')).body.rows[0].id;
  assert.equal((await other('PUT', `/api/laundry-reports/${id}`, { wash_date: '2026-11-10', lines: [] })).status, 403, 'only the author or purchasing');
  const qc = [...nov10, ...wash('tp_white', { S: 2, M: 11 }), { section: 'discard', garment: 'gown_zip', part: '가운', size: 'M', qty: 1 }];
  assert.equal((await staff('PUT', `/api/laundry-reports/${id}`, { wash_date: '2026-11-10', pickup_label: '261105', inspector: '확인자', lines: qc })).status, 200);
  let report = (await buyer('GET', `/api/laundry-reports/${id}`)).body;
  assert.deepEqual([report.summary.prod_total, report.summary.qc_total, report.summary.wash_total, report.summary.discard_total], [446, 14, 458, 2]);
  assert.equal(report.summary.vendor_cost, 1306980 + 13 * 2340);

  const empty = (await staff('POST', '/api/laundry-reports', { wash_date: '2026-11-17', lines: [] })).body.id;
  assert.equal((await staff('POST', `/api/laundry-reports/${empty}/issue`)).status, 400, 'nothing to certify');
  assert.equal((await other('POST', `/api/laundry-reports/${id}/issue`)).status, 403);
  assert.equal((await staff('POST', `/api/laundry-reports/${id}/issue`)).status, 200);
  assert.equal((await staff('POST', `/api/laundry-reports/${id}/issue`)).status, 409);
  report = (await buyer('GET', `/api/laundry-reports/${id}`)).body;
  assert.deepEqual([report.status, report.issued_by], ['issued', '직원']);
  assert.equal((await staff('PUT', `/api/laundry-reports/${id}`, { wash_date: '2026-11-10', lines: [] })).status, 409, 'issued sheets are locked');
  assert.equal((await staff('DELETE', `/api/laundry-reports/${id}`)).status, 409);
  assert.equal((await buyer('GET', `/api/laundry-reports/${id}`)).body.lines.length, qc.length, 'a refused edit leaves the lines alone');

  // A later price change does not move an issued sheet, but does move drafts.
  await buyer('PUT', '/api/laundry-report-settings', { ...settings, prices: { ...settings.prices, vendor: { ...settings.prices.vendor, onepiece: 5000 } } });
  await staff('PUT', `/api/laundry-reports/${empty}`, { wash_date: '2026-11-17', lines: wash('op_white', { M: 10 }) });
  const list = (await buyer('GET', '/api/laundry-reports?from=2026-11-01&to=2026-11-30')).body;
  assert.deepEqual(list.rows.map(r => [r.wash_date, r.summary.vendor_cost]), [['2026-11-17', 50000], ['2026-11-10', 1306980 + 13 * 2340]]);
  assert.equal(list.matrix['wash|op_white||4XL'], 66); assert.equal(list.matrix['wash|op_white||M'], 10); assert.equal(list.matrix['discard|op_sky|후드|3XL'], 1);
  assert.equal((await buyer('GET', '/api/laundry-reports?from=2026-11-11&to=2026-11-30')).body.rows.length, 1);
  assert.equal((await staff('GET', '/api/laundry-reports')).body.rows[0].summary.profit, undefined);

  assert.equal((await staff('POST', `/api/laundry-reports/${id}/unissue`)).status, 403, 'cancelling an issue needs purchasing');
  assert.equal((await buyer('POST', `/api/laundry-reports/${id}/unissue`)).status, 200);
  assert.equal((await buyer('GET', `/api/laundry-reports/${id}`)).body.summary.vendor_cost, 78 * 5000 + 86 * 5000 + 294 * 2340, 'a draft follows current prices again');
  assert.equal((await other('DELETE', `/api/laundry-reports/${empty}`)).status, 403);
  assert.equal((await staff('DELETE', `/api/laundry-reports/${empty}`)).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM laundry_report_lines WHERE report_id=?').get(empty).c, 0);
  assert.ok((await admin('GET', '/api/admin/backup')).body.tables.includes('laundry_report_lines'));
});

test('An administrator opens an approved account directly', async () => {
  assert.equal((await staff('POST', '/api/admin/users', { name: '새직원', password: 'password' })).status, 403);
  assert.equal((await admin('POST', '/api/admin/users', { name: '새직원', password: '123' })).status, 400);
  assert.equal((await admin('POST', '/api/admin/users', { name: '새직원', password: 'password', roles: ['nope'] })).status, 400);
  const made = (await admin('POST', '/api/admin/users', { name: '새직원', password: 'password', roles: ['purchase'] })).body;
  assert.deepEqual([made.approval_status, made.roles, made.is_admin], ['approved', ['purchase'], false]);
  assert.equal((await admin('POST', '/api/admin/users', { name: '새직원', password: 'password' })).status, 400, 'names are unique');
  const fresh = client(); assert.equal((await fresh('POST', '/api/auth/login', { name: '새직원', password: 'password' })).status, 200);
  assert.equal((await fresh('GET', '/api/laundry-report-meta')).body.can_money, true);
});

test('Past records are imported as issued sheets under the given author; repeats are skipped', async () => {
  const file = { format: 'laundry-reports-v1', author: '과거작성자', inspector: '과거 확인자', prices: { vendor: { onepiece: 1000, twopiece: 500 }, customer: { onepiece: 1500, twopiece: 800 }, discard: { 후드: 100 } },
    reports: [{ wash_date: '2026-03-09', pickup_label: '초도', lines: wash('op_white', { '6XL': 258 }) }, { wash_date: '2026-04-21', pickup_label: '260416', note: '메모', lines: [...wash('tp_navy', { L: 14 }), { section: 'discard', garment: 'op_sky', part: '후드', size: 'S', qty: 2 }] }] };
  assert.equal((await buyer('POST', '/api/laundry-report-import', file)).status, 403, 'administrators only');
  assert.equal((await admin('POST', '/api/laundry-report-import', { ...file, format: 'other' })).status, 400);
  assert.equal((await admin('POST', '/api/laundry-report-import', { ...file, reports: [file.reports[0], file.reports[0]] })).status, 400);
  assert.equal((await admin('POST', '/api/laundry-report-import', { ...file, reports: [{ wash_date: '2026-03-10', lines: [{ section: 'wash', garment: 'x', size: 'M', qty: 1 }] }] })).status, 400);
  assert.deepEqual((await admin('POST', '/api/laundry-report-import', file)).body, { imported: 2, skipped: 0, settings_filled: false }, 'existing unit prices are left alone');
  assert.deepEqual((await admin('POST', '/api/laundry-report-import', { ...file, reports: [...file.reports, { wash_date: '2026-04-28', lines: wash('op_sky', { M: 1 }) }] })).body, { imported: 1, skipped: 2, settings_filled: false });
  const rows = (await buyer('GET', '/api/laundry-reports?from=2026-03-01&to=2026-04-30')).body.rows;
  assert.deepEqual(rows.map(r => [r.wash_date, r.status, r.created_by, r.issued_by, r.inspector, r.summary.wash_total, r.summary.discard_total, r.summary.vendor_cost, r.summary.customer_amount, r.summary.discard_amount]),
    [['2026-04-28', 'issued', '과거작성자', '과거작성자', '과거 확인자', 1, 0, 1000, 1500, 0], ['2026-04-21', 'issued', '과거작성자', '과거작성자', '과거 확인자', 14, 2, 7000, 11200, 200], ['2026-03-09', 'issued', '과거작성자', '과거작성자', '과거 확인자', 258, 0, 258000, 387000, 0]]);
  assert.equal(rows.every(r => r.signature === ''), true, 'imported sheets carry no signature');
});

test('The registered signature is stamped at issue only under the registered confirmer', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const current = async () => { const m = (await buyer('GET', '/api/laundry-report-meta')).body; return { customer: m.customer, vendor: m.vendor, inspector: m.inspector, prices: m.prices }; };
  assert.equal((await buyer('PUT', '/api/laundry-report-settings', { ...(await current()), signature: 'data:text/html;base64,AAAA' })).status, 400);
  const first = (await buyer('PUT', '/api/laundry-report-settings', { ...(await current()), signature: png })).body.signature;
  assert.match(first, /^[a-f0-9]{24}\.png$/);
  assert.equal((await staff('GET', '/api/laundry-report-meta')).body.signature, '', 'only purchasing sees the settings copy');
  assert.equal((await buyer('PUT', '/api/laundry-report-settings', await current())).body.signature, first, 'saving other settings keeps the signature');
  const inspector = (await current()).inspector;

  const mine = (await staff('POST', '/api/laundry-reports', { wash_date: '2026-12-01', inspector, lines: wash('op_white', { M: 1 }) })).body.id;
  const theirs = (await staff('POST', '/api/laundry-reports', { wash_date: '2026-12-08', inspector: '다른 확인자', lines: wash('op_white', { M: 1 }) })).body.id;
  assert.equal((await staff('GET', `/api/laundry-reports/${mine}`)).body.signature, '', 'drafts are unsigned');
  assert.equal((await staff('POST', `/api/laundry-reports/${mine}/issue`)).body.signed, true);
  assert.equal((await staff('POST', `/api/laundry-reports/${theirs}/issue`)).body.signed, false);
  assert.equal((await staff('GET', `/api/laundry-reports/${mine}`)).body.signature, first);
  assert.equal((await staff('GET', `/api/laundry-reports/${theirs}`)).body.signature, '');
  // Replacing the signature keeps the image an issued sheet still shows; removing clears the setting.
  const second = (await buyer('PUT', '/api/laundry-report-settings', { ...(await current()), signature: png })).body.signature;
  assert.notEqual(second, first); assert.ok(await env.BUCKET.get(first), 'still shown on an issued sheet');
  assert.equal((await staff('GET', `/api/laundry-reports/${mine}`)).body.signature, first);
  assert.equal((await buyer('PUT', '/api/laundry-report-settings', { ...(await current()), remove_signature: true })).body.signature, '');
  assert.equal(await env.BUCKET.get(second), null, 'an unused image is deleted');
  assert.equal((await buyer('POST', `/api/laundry-reports/${mine}/unissue`)).status, 200);
  assert.equal((await staff('GET', `/api/laundry-reports/${mine}`)).body.signature, '');
});
