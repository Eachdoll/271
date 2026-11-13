import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/reports.js', import.meta.url), 'utf8');
test('Report CSV preserves Korean, quotes and line breaks while neutralizing spreadsheet formulas', () => {
  const csv = vm.runInNewContext(source + '\nreportCsv([["품목", "값"], ["서울세미텍, 원단", 2.5], ["=1+1", "  @SUM(A1)"], ["인용\\"부호", "첫째\\n둘째"]])');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"서울세미텍, 원단","2.5"'));
  assert.ok(csv.includes('"\'=1+1","\'  @SUM(A1)"'));
  assert.ok(csv.includes('"인용""부호"'));
  assert.ok(csv.includes('"첫째\n둘째"'));
});
