import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const html = fs.readFileSync(new URL('../public/r2-key-handoff.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function start(protocol = 'https:', availableCrypto = webcrypto) {
  const nodes = Object.fromEntries(['keys', 'status', 'save', 'access', 'secret', 'boot', 'result', 'select', 'ciphertext', 'download'].map(id => [id, { value: '', disabled: true, hidden: true, textContent: '', removeAttribute(name) { delete this[name]; }, select() {} }]));
  const handlers = new Map(); let clipboard = '';
  for (const [id, node] of Object.entries(nodes)) node.addEventListener = (event, callback) => handlers.set(id + ':' + event, callback);
  nodes.keys.reset = () => { nodes.access.value = nodes.secret.value = ''; };
  const document = { getElementById: id => nodes[id] };
  vm.runInNewContext(script, { document, location: { protocol }, crypto: availableCrypto, TextEncoder, Uint8Array, atob, btoa, Blob, URL: { createObjectURL: () => 'blob:encrypted-only', revokeObjectURL() {} }, navigator: { clipboard: { async writeText(value) { clipboard = value; } } } });
  return { nodes, submit: () => handlers.get('keys:submit')({ preventDefault() {} }), copy: () => handlers.get('select:click')(), clipboard: () => clipboard };
}
test('Handoff encrypts keys in HTTPS, clears inputs, and copies only ciphertext without download', async () => {
  const x = start(); assert.equal(x.nodes.save.disabled, false);
  x.nodes.access.value = 'EXAMPLE_ACCESS_KEY_1234567890'; x.nodes.secret.value = 'test-secret-'.repeat(5);
  const plaintext = x.nodes.secret.value;
  await x.submit();
  assert.match(x.nodes.status.textContent, /암호화 완료/); assert.equal(x.nodes.result.hidden, false);
  const envelope = JSON.parse(x.nodes.ciphertext.value);
  assert.equal(envelope.format, 'work-process-r2-sealed-v1'); assert.equal(Buffer.from(envelope.ciphertext, 'base64').length, 512);
  assert.ok(!x.nodes.ciphertext.value.includes(plaintext)); assert.doesNotMatch(x.nodes.ciphertext.value, /EXAMPLE_ACCESS_KEY/);
  assert.equal(x.nodes.access.value, ''); assert.equal(x.nodes.secret.value, '');
  await x.copy(); assert.equal(x.clipboard(), x.nodes.ciphertext.value);
  x.nodes.access.value = 'short'; await x.submit(); assert.match(x.nodes.status.textContent, /실패:/); assert.equal(x.nodes.result.hidden, true); assert.equal(x.nodes.ciphertext.value, '');
});
test('Handoff refuses insecure contexts or missing Web Crypto, and CSP pins the exact script', async () => {
  for (const [protocol, crypto] of [['http:', webcrypto], ['https:', {}]]) {
    const x = start(protocol, crypto); assert.equal(x.nodes.save.disabled, true); assert.equal(x.nodes.access.disabled, true);
    await x.submit(); assert.match(x.nodes.status.textContent, /실패:/); assert.equal(x.nodes.save.disabled, true);
  }
  const digest = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes("script-src 'sha256-" + digest + "'"));
  assert.ok(html.includes("connect-src 'none'")); assert.ok(html.includes("form-action 'none'"));
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(html, /BEGIN (RSA )?PRIVATE KEY/);
});
test('Handoff response forbids framing and caching and includes the standalone page', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-handoff-'));
  const { env, sqlite } = localEnvironment(dir, 'test-invite');
  try {
    const response = await worker.fetch(new Request('https://work.test/r2-key-handoff.html'), env);
    assert.equal(response.status, 200); assert.equal(await response.text(), html);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
  } finally { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
