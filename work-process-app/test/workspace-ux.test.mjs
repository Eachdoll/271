import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/workspace-ux.js', import.meta.url), 'utf8');
function setup() {
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: k => storage[k] ?? null }, setItem: { value: (k, v) => { storage[k] = v; } }, removeItem: { value: k => { delete storage[k]; } },
  });
  const events = {}, frames = [];
  const makeBox = () => { const nodes = {}; return { querySelector: s => nodes[s] ||= { hidden: false, textContent: '' } }; };
  const c = vm.createContext({ ME: { id: 7 }, Date, sessionStorage: storage, location: { hash: '#/one' }, window: { scrollY: 700, addEventListener: (name, fn) => { events[name] = fn; }, scrollTo: (_, y) => { c.window.scrollY = y; } }, document: { createElement: makeBox }, queueMicrotask: fn => fn(), requestAnimationFrame: fn => frames.push(fn), confirmBox: async () => true,
    esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])), fmtNum: n => String(n), RECV: { ok: '입고완료', mismatch: '수량상이' }, SEMI_FIELD_LABEL: { qty: '양품수량', spec: '규격' } });
  vm.runInContext(source, c);
  const input = (name, value, type = 'text') => ({ name, value, type, dataset: {}, closest: () => null });
  const form = controls => ({ controls, dataset: {}, id: 'filters', isConnected: true, events: {}, querySelectorAll: () => controls, addEventListener(name, fn) { this.events[name] = fn; }, prepend(box) { this.box = box; } });
  return { c, storage, events, frames, input, form };
}
test('Working state excludes credentials, signatures and file inputs; restores checkboxes and zero values', () => {
  const { c, input, form } = setup();
  const controls = [input('qty', '0'), input('note', '<b>draft</b>'), input('password', 'secret'), input('current', 'old-secret', 'password'), input('invite', 'secret'), input('signature', 'private'), input('photos', '', 'file'), { ...input('coa', '', 'checkbox'), checked: false }];
  const f = form(controls), saved = c.uxFormRead(f);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [['qty', '0'], ['note', '<b>draft</b>'], ['coa', false]]);
  controls[0].value = '99'; controls.at(-1).checked = true; c.uxFormRestore(f, saved);
  assert.equal(controls[0].value, '0'); assert.equal(controls.at(-1).checked, false);
});
test('Draft recovery is explicit, keeps retry identity and clears only after confirmed save', () => {
  const { c, storage, input, form } = setup();
  let model = { qty: 0, requestId: 'same-retry-key' };
  const f = form([input('qty', '0')]); const d = c.bindEntryDraft(f, 'multi', { read: () => model, restore: data => { model = data; } });
  f.events.input({ target: f.controls[0] }); const key = c.uxKey('draft', 'multi'); assert.equal(c.uxRead(key).requestId, 'same-retry-key');
  f.isConnected = false; model = { qty: '', requestId: 'new-key' };
  const g = form([input('qty', '')]); const restored = c.bindEntryDraft(g, 'multi', { read: () => model, restore: data => { model = data; } });
  assert.equal(model.requestId, 'new-key'); g.box.querySelector('[data-draft-restore]').onclick(); assert.equal(model.requestId, 'same-retry-key');
  restored.start(); restored.failure(); assert.ok(storage[key]); restored.clear(); assert.equal(storage[key], undefined);
  g.events.input({ target: g.controls[0] }); assert.equal(storage[key], undefined, 'saved form remains paused until explicitly reused');
});
test('Drafts expire, isolate users, and logout clears only the current user', () => {
  const { c, storage } = setup();
  const first = c.uxKey('draft', 'new'); c.uxWrite(first, 'first');
  c.ME = { id: 8 }; const second = c.uxKey('draft', 'new'); assert.equal(c.uxRead(second), null); c.uxWrite(second, 'second'); c.uxClearUser();
  assert.equal(c.uxRead(first), 'first'); assert.equal(c.uxRead(second), null);
  storage[first] = JSON.stringify({ at: Date.now() - 8 * 86400000, value: 'expired' }); assert.equal(c.uxRead(first), null);
});
test('Storage failure retains working values and warns against closing the screen', () => {
  const { c, form, input } = setup(); c.sessionStorage = { getItem: () => null, setItem() { throw Error('quota'); }, removeItem() {} };
  const f = form([input('qty', '42')]); const d = c.bindEntryDraft(f, 'new'); f.events.input({ target: f.controls[0] }); d.failure();
  assert.match(f.box.querySelector('[data-draft-status]').textContent, /초안도 보관하지 못/); assert.equal(f.controls[0].value, '42');
});
test('Filters survive revisits and clearing filters replaces the remembered values', () => {
  const { c, form, input } = setup(); const f = form([input('q', '서울'), input('from', '2026-01-01')]); c.rememberList(f); f.events.submit();
  const g = form([input('q', ''), input('from', '')]); c.rememberList(g); assert.equal(g.controls[0].value, '서울');
  g.controls.forEach(el => { el.value = ''; }); g.events.click(); const h = form([input('q', 'default')]); c.rememberList(h); assert.equal(h.controls[0].value, '');
  c.location.hash = '#/two'; const other = form([input('q', '')]); c.rememberList(other); assert.equal(other.controls[0].value, '');
});
test('Scroll restoration ignores layout collapse during route rendering', () => {
  const { c, events, frames } = setup(); c.uxBeforeRender(); c.uxAfterRender('#/one'); while (frames.length) frames.shift()();
  c.window.scrollY = 700; events.scroll(); c.location.hash = '#/two'; c.uxBeforeRender(); c.window.scrollY = 0; events.scroll(); c.uxAfterRender('#/two'); while (frames.length) frames.shift()();
  c.location.hash = '#/one'; c.uxBeforeRender(); c.window.scrollY = 0; events.scroll(); c.uxAfterRender('#/one'); while (frames.length) frames.shift()(); assert.equal(c.window.scrollY, 700);
});
test('Approval comparison escapes request text and shows cancellation effects', () => {
  const { c } = setup(); const html = c.approvalComparison('receipt', { action: 'revert', old_status: 'ok', old_recv_qty: 90, unit: 'EA', reason: '<img onerror=x>', requested_by: '<script>', item: '품목' });
  assert.match(html, /-90 EA/); assert.match(html, /변경 전/); assert.match(html, /승인 후/); assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>'));
  const actual = c.approvalComparison('actual', { action: 'void', old_qty: 20, old_date: '2026-01-01' }); assert.match(actual, /취소/); assert.match(actual, /BOM/);
});
test('Review fetches the exact pending request and never silently approves a missing request', async () => {
  const { c } = setup(); let url;
  c.api = async (_, path) => { url = path; return []; };
  await assert.rejects(c.reviewApproval('receipt', '250'), /찾을 수 없습니다/); assert.equal(url, '/api/receipt-changes?status=pending&id=250');
});
test('Receipts recorded without a quantity show the ordered quantity as the stock effect', () => {
  const { c } = setup();
  const revert = c.approvalComparison('receipt', { action: 'revert', old_status: 'ok', old_recv_qty: null, order_qty: 400, unit: 'EA', reason: '오기', requested_by: '직원', item: '옛 입고' });
  assert.match(revert, /기록 없음 \(발주 400 EA 기준\)/); assert.match(revert, /-400 EA/); assert.match(revert, /입고 기록 전체 취소/); assert.ok(!revert.includes('+0'));
  const qty = c.approvalComparison('receipt', { action: 'qty', old_status: 'ok', old_recv_qty: null, order_qty: 400, new_recv_qty: 380, unit: 'EA', reason: '실측', requested_by: '직원' });
  assert.match(qty, /-20 EA/);
  const unknown = c.approvalComparison('receipt', { action: 'revert', old_status: 'ok', old_recv_qty: null, order_qty: null, reason: 'x', requested_by: 'y' });
  assert.match(unknown, /계산하지 못했습니다/);
});
test('Semi requests are titled by product, size and line; a delete lists only filled fields', () => {
  const { c } = setup(); c.SEMI_FIELD_LABEL = { work_date: '작업일', unit_name: '라인', product_type: '종류', item_name: '모델', spec: '규격', qty: '양품수량', defect_qty: '불량', workers: '인원' };
  const html = c.approvalComparison('semi', { action: 'delete', process: 'cut', reason: '중복', requested_by: '직원', old_data: { work_date: '2026-11-14', unit_name: '1동', product_type: '스무드', item_name: '', spec: 'S', qty: 50, defect_qty: 0, workers: null }, new_data: null });
  assert.match(html, /스무드 · S · 1동 · 2026-11-14 — 삭제 요청/); assert.match(html, /양품수량/); assert.ok(!html.includes('불량</th>')); assert.ok(!html.includes('인원')); assert.ok(!html.includes('모델'));
});
