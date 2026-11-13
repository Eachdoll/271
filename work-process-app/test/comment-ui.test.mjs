import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/comments.js', import.meta.url), 'utf8');
test('Comment UI escapes content, pages history, and preserves drafts when saving fails', async () => {
  const nodes = new Map(), calls = [];
  const field = { value: '', focus() {} };
  const form = { elements: { content: field }, reset() { field.value = ''; } };
  nodes.set('[data-comment-form]', form);
  const get = selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); };
  let html = '', failSave = true, capture;
  const context = vm.createContext({
    document: { addEventListener(type, callback, options) { capture = { type, callback, options }; } },
    esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]),
    $: get, $$: () => [], fail() {}, toast() {},
    modal(value) { html = value; return { el: { isConnected: true } }; },
    api: async (method, url, body) => {
      calls.push({ method, url, body });
      if (method === 'POST') {
        if (failSave) throw new Error('저장 실패');
        return { id: 4, content: body.content, author_name: '직원', created_at: '2026-11-13 20:03:00' };
      }
      if (url.includes('?before=')) return { rows: [{ id: 1, content: '이전 코멘트', author_name: '직원', created_at: '2026-11-13 20:00:00' }], next: null };
      return { rows: [{ id: 3, content: '<img src=x onerror=alert(1)>\n다음 줄', author_name: '<script>위조</script>', created_at: '2026-11-13 20:02:00' }, { id: 2, content: '먼저 작성', author_name: '직원', created_at: '2026-11-13 20:01:00' }], next: 2 };
    },
  });
  vm.runInContext(source, context);
  await context.openComments('request', 1, '<위험한 제목>');
  assert.ok(html.includes('&lt;위험한 제목&gt;'));
  const list = get('[data-comment-list]');
  assert.ok(list.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;\n다음 줄'));
  assert.ok(list.innerHTML.includes('&lt;script&gt;위조&lt;/script&gt;'));
  assert.ok(list.innerHTML.indexOf('먼저 작성') < list.innerHTML.indexOf('&lt;img'));
  await get('[data-comment-older]').onclick();
  assert.equal(calls.at(-1).url, '/api/comments/request/1?before=2');
  assert.equal(get('[data-comment-older]').hidden, true);
  assert.ok(list.innerHTML.indexOf('이전 코멘트') < list.innerHTML.indexOf('먼저 작성'));
  field.value = '저장할 진행사항';
  await form.onsubmit({ preventDefault() {} });
  assert.equal(field.value, '저장할 진행사항');
  assert.equal(get('[data-comment-status]').textContent, '저장 실패');
  failSave = false;
  await form.onsubmit({ preventDefault() {} });
  assert.equal(field.value, ''); assert.ok(list.innerHTML.includes('저장할 진행사항'));
  assert.equal(capture.type, 'click'); assert.equal(capture.options, true);
});
