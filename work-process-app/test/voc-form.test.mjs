import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const forms = fs.readFileSync(new URL('../public/forms.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
test('VOC form exposes required customer/product/quantity/content, optional LOT and photos, and collects its payload', () => {
  const context = vm.createContext({ window: {},
    esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]),
    photoPicker: () => '<input name="photos" type="file" multiple>',
    formObj: () => ({ customer: '고객사', title: '제품', qty: '12', lot: 'LOT-1', unit: 'EA', extra: '오염 확인', due_date: '' }),
  });
  vm.runInContext(forms + '\nconst REQ = window.REQ;\n' + app.slice(app.indexOf('function fieldInput('), app.indexOf('function statusChip(')), context);
  const html = vm.runInContext('requestForm("voc")', context);
  for (const field of ['customer','title','qty','extra']) assert.match(html, new RegExp(`(?:input|textarea)[^>]*name="${field}"[^>]*required`));
  assert.match(html, /name="qty" type="number"/); assert.match(html, /name="photos" type="file" multiple/);
  assert.match(html, /VOC 접수/); assert.match(html, /name="lot"/);
  const collected = vm.runInContext('collectRequest("voc", {})', context);
  assert.equal(collected.type, 'voc'); assert.equal(collected.customer, '고객사'); assert.equal(collected.title, '제품');
  assert.equal(collected.data.qty, '12'); assert.equal(collected.data.lot, 'LOT-1'); assert.equal(collected.data.extra, '오염 확인');
  const edited = vm.runInContext('requestForm("voc", {title:"<script>", customer:"고객", data:{qty:3, lot:"LOT-X", extra:"<img>"}})', context);
  assert.ok(edited.includes('&lt;script&gt;')); assert.ok(edited.includes('&lt;img&gt;')); assert.ok(edited.includes('LOT-X'));
});
