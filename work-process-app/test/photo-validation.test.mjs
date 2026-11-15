import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const block = app.slice(app.indexOf('const PHOTO_FILE_LIMIT'), app.indexOf('function inspectionFields('));
const limit = 8 * 1024 * 1024;
const small = 'data:image/jpeg;base64,AQID';
function browser() {
  const errors = [], opened = [], revoked = [];
  const c = vm.createContext({
    Image: class { width = 10; height = 10; set src(value) { queueMicrotask(() => this.onload()); } },
    URL: { createObjectURL(file) { opened.push(file.name); return 'blob:' + file.name; }, revokeObjectURL(value) { revoked.push(value); } },
    document: { createElement() { return { getContext: () => ({ drawImage() {} }), toDataURL: () => small }; } },
    $: (selector, root) => root.elements?.[selector] || null,
    $$: (selector, root) => selector === 'input[name=keep_photos]:checked' ? Array(root.kept || 0).fill({}) : [],
    esc: value => value, fail: error => errors.push(error.message),
  });
  vm.runInContext(block, c); return { c, errors, opened, revoked };
}
test('Client accepts exactly 8MB and rejects oversized selections before reading any image', async () => {
  const x = browser();
  assert.match(x.c.photoPicker(), /한 장당 최대 8MB/);
  assert.equal((await x.c.preparePhotos([{ name: '8MB.jpg', size: limit }])).length, 1);
  assert.equal(x.opened.length, 1); assert.equal(x.revoked.length, 1);
  x.opened.length = 0;
  await assert.rejects(x.c.preparePhotos([{ name: 'good.jpg', size: 3 }, { name: 'large.jpg', size: limit + 1 }]), /8MB.*large.jpg/);
  assert.equal(x.opened.length, 0);
  await assert.rejects(x.c.resizeImage({ name: 'large.jpg', size: limit + 1 }), /8MB/);
  assert.equal(x.opened.length, 0);
  await assert.rejects(x.c.preparePhotos(Array(11).fill({ name: 'small.jpg', size: 3 })), /10장/);
  await assert.rejects(x.c.preparePhotos([{ name: 'small.jpg', size: 3 }], [], 10), /10장/);
});
test('Client rejects oversized converted files and combined payloads before a save', () => {
  const x = browser(), eight = 'data:image/png;base64,' + Buffer.alloc(limit).toString('base64');
  x.c.validatePhotoPayload([eight]);
  assert.throws(() => x.c.validatePhotoPayload(['data:image/png;base64,' + Buffer.alloc(limit + 1).toString('base64')]), /8MB/);
  assert.throws(() => x.c.validatePhotoPayload([eight, eight, eight]), /전체 용량/);
  assert.throws(() => x.c.validatePhotoPayload([small], 10), /10장/);
});
test('Rejected gallery/camera selections preserve the prior draft and restore the save button', async () => {
  const x = browser(), input = { value: 'selected', files: [{ name: 'oversized.jpg', size: limit + 1 }] }, camera = { value: 'selected', files: input.files }, preview = { innerHTML: '' }, button = { disabled: false };
  const form = { kept: 0, elements: { '[data-photo-input]': input, '[data-photo-preview]': preview, '[data-photo-camera]': camera, '[data-photo-shoot]': {}, 'button[type=submit], button.primary': button } };
  const draft = x.c.bindPhotoDraft(form, [small]);
  await input.onchange();
  assert.deepEqual([...draft.photos], [small]); assert.equal(draft.busy, false); assert.equal(button.disabled, false); assert.equal(input.value, '');
  await camera.onchange(); assert.deepEqual([...draft.photos], [small]); assert.equal(x.errors.length, 2); assert.equal(x.opened.length, 0);
});
test('Signature image selection shares the same 8MB validation', async () => {
  const x = browser(), source = fs.readFileSync(new URL('../public/laundry-report.js', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function lrSignatureImage('), source.indexOf('// Past records')), x.c);
  await assert.rejects(x.c.lrSignatureImage({ name: 'signature.png', size: limit + 1 }), /8MB/); assert.equal(x.opened.length, 0);
});
test('Server accepts 8MB, rejects 8MB plus one byte, and preserves the original photo on rejection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-photo-limit-'));
  const { env, sqlite } = localEnvironment(dir, 'test-invite');
  const writes = [], deletes = [];
  env.BUCKET = { async put(key, bytes) { writes.push({ key, size: bytes.length }); }, async delete(key) { deletes.push(key); } };
  let cookie = '';
  const call = async (method, route, body) => {
    const response = await worker.fetch(new Request('https://work.test' + route, { method, headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  };
  const image = size => 'data:image/png;base64,' + Buffer.alloc(size).toString('base64');
  try {
    await call('POST', '/api/auth/register', { name: 'Admin', password: 'password', invite: 'test-invite' });
    const saved = await call('POST', '/api/laundry', { in_date: '2026-11-13', discard_qty: 1, photos: [image(limit)] });
    assert.equal(saved.status, 200); assert.equal(writes[0].size, limit);
    const prior = sqlite.prepare('SELECT photos FROM laundry WHERE id=?').get(saved.body.id).photos;
    const rejected = await call('PUT', '/api/laundry/' + saved.body.id, { in_date: '2026-11-13', discard_qty: 2, keep_photos: [], photos: [image(limit + 1)] });
    assert.equal(rejected.status, 400); assert.match(rejected.body.error, /8MB/);
    assert.equal(sqlite.prepare('SELECT photos FROM laundry WHERE id=?').get(saved.body.id).photos, prior);
    assert.equal(writes.length, 1); assert.equal(deletes.length, 0);
  } finally { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
