// 15.108 발주·출하·기타입고 표 입력: 줄 → 저장 내용 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/line-table.js', import.meta.url), 'utf8');
const c = vm.createContext({});
vm.runInContext(source, c);

test('Size lines without a quantity are dropped; empty note/due date do not override the common values', () => {
  const items = c.lineTableItems([
    { bom_id: 7, item: '방진복', spec: 'S', qty: '10', unit: '벌', sizeLine: true, price: 5000, due_date: '', note: '' },
    { bom_id: 7, item: '방진복', spec: 'M', qty: '', unit: '벌', sizeLine: true },
    { bom_id: 8, item: '장갑', spec: '9인치', qty: '3', unit: 'BOX', price: '', due_date: '2026-12-01', note: '급함', coa: true },
  ], 'purchase_order');
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].spec, items[0].qty, items[0].unit_price, 'note' in items[0], 'due_date' in items[0]], ['S', '10', 5000, false, false]);
  assert.deepEqual([items[1].due_date, items[1].note, items[1].coa_requested, items[1].item_category], ['2026-12-01', '급함', true, '']);
});

test('Free lines need a name, unit and (for POs) a category; other receipts need a catalog item', () => {
  assert.throws(() => c.lineTableItems([{ bom_id: '', item: '', qty: '1' }], 'purchase_order'), /품목명/);
  assert.throws(() => c.lineTableItems([{ bom_id: '', item: '새원단', qty: '1', unit: '' }], 'purchase_order'), /단위/);
  assert.throws(() => c.lineTableItems([{ bom_id: '', item: '새원단', qty: '1', unit: 'KG' }], 'purchase_order'), /분류/);
  assert.equal(c.lineTableItems([{ bom_id: '', item: '새원단', qty: '1', unit: 'KG', item_category: '원자재' }], 'purchase_order')[0].item_category, '원자재');
  assert.equal(c.lineTableItems([{ bom_id: '', item: '새상품', qty: '2', unit: 'EA' }], 'shipment').length, 1);
  assert.throws(() => c.lineTableItems([{ bom_id: '', item: '새것', qty: '1', unit: 'EA' }], 'other_receipt'), /품목 찾기/);
  assert.throws(() => c.lineTableItems([{ bom_id: 1, item: 'A', qty: '0', unit: 'EA' }], 'shipment'), /수량/);
  assert.throws(() => c.lineTableItems([{ bom_id: 1, item: 'A', qty: '', unit: 'EA', sizeLine: true }], 'shipment'), /수량을 넣은 품목이 없습니다/);
});
