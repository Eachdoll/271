import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Organization selectors filter positions and clear incompatible values when department changes', () => {
  let onChange;
  const c = vm.createContext({ document: { addEventListener(type, cb) { if (type === 'change') onChange = cb; } }, esc: x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'), $: (s, root) => root[s] });
  vm.runInContext(fs.readFileSync(new URL('../public/org.js', import.meta.url), 'utf8'), c);
  const lists = { departments: [{ id: 1, name: '영업', active: 1 }, { id: 2, name: '연구소', active: 1, position_names: ['연구소장', '수석', '선임', '연구원'] }], positions: [{ name: '과장', sort: 1, active: 1 }] };
  const lab = c.orgPositionField(lists, { department: '연구소' }, true);
  assert.match(lab, /required/); assert.match(lab, /연구소장/); assert.doesNotMatch(lab, /과장/);
  assert.doesNotMatch(c.orgPositionField(lists, { department: '영업' }, true), /연구원/);
  assert.match(c.orgFields(lists, {}, { required: true }), /data-org-picker/);
  const output = { innerHTML: '' }, picker = { dataset: { orgLists: JSON.stringify(lists), required: '1' }, '[name=position]': { value: '과장' }, '[data-org-position]': output };
  onChange({ target: { name: 'department', value: '연구소', closest: () => picker } });
  assert.match(output.innerHTML, /연구원/); assert.doesNotMatch(output.innerHTML, /過長|과장|selected/);
  picker['[name=position]'].value = '연구원';
  onChange({ target: { name: 'department', value: '연구소', closest: () => picker } });
  assert.match(output.innerHTML, /value="연구원" selected/);
});
