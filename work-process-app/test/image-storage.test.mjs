import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageStorage, signS3Request } from '../image-storage.mjs';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const key = 'a'.repeat(24) + '.png';
const nextKey = 'b'.repeat(24) + '.jpg';
const bytes = new Uint8Array([1, 2, 3]);
const company = { R2_S3_ENDPOINT: 'https://763841f86927008259380d1f28416826.r2.cloudflarestorage.com', R2_S3_BUCKET: 'seoulsemi-images', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret' };
function setup(extra = {}) {
  const source = new Map([[key, { bytes, contentType: 'image/png' }]]), target = new Map(), requests = [], deletes = [];
  const BUCKET = {
    async get(name) { const value = source.get(name); return value ? { body: value.bytes, httpMetadata: { contentType: value.contentType } } : null; },
    async put(name, body, options) { source.set(name, { bytes: new Uint8Array(body), contentType: options?.httpMetadata?.contentType }); },
    async delete(name) { deletes.push(name); source.delete(name); },
    async list({ cursor = '', limit }) {
      const names = [...source.keys()].sort().filter(name => name > cursor), page = names.slice(0, limit);
      return { objects: page.map(key => ({ key })), truncated: names.length > page.length, cursor: names.length > page.length ? page.at(-1) : undefined };
    },
  };
  const env = { BUCKET, ...company, ...extra };
  const outbound = async request => {
    requests.push(request);
    assert.equal(new URL(request.url).hostname, '763841f86927008259380d1f28416826.r2.cloudflarestorage.com');
    assert.match(request.headers.get('authorization'), /Credential=test-key\/\d{8}\/auto\/s3\/aws4_request/);
    assert.equal(request.redirect, 'error');
    const name = new URL(request.url).pathname.split('/').at(-1), value = target.get(name);
    if (request.method === 'HEAD') return new Response(null, { status: 200 });
    if (request.method === 'GET') return value ? new Response(value.bytes, { headers: { 'content-type': value.contentType } }) : new Response(null, { status: 404 });
    if (request.method === 'PUT') {
      if (value && request.headers.get('if-none-match') === '*') return new Response(null, { status: 412 });
      target.set(name, { bytes: new Uint8Array(await request.arrayBuffer()), contentType: request.headers.get('content-type') });
      return new Response(null, { status: 200 });
    }
    if (request.method === 'DELETE') { target.delete(name); return new Response(null, { status: 204 }); }
    throw new Error('Unexpected method');
  };
  return { env, source, target, requests, deletes, outbound, storage: createImageStorage(env, { outbound }) };
}

test('S3 SigV4 matches the AWS published GET Object example', async () => {
  // Public example credentials and expected signature, not production secrets:
  // https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
  const request = await signS3Request('https://examplebucket.s3.amazonaws.com/test.txt', { headers: { range: 'bytes=0-9' } }, { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' }, new Date('2013-05-24T00:00:00Z'));
  assert.equal(request.headers.get('authorization'), 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('Native mode preserves existing upload/read/delete behavior without configured secrets', async () => {
  const x = setup({ R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' });
  assert.equal(x.storage.status().ready, false);
  await x.storage.put(nextKey, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  assert.deepEqual(new Uint8Array(await new Response((await x.storage.get(nextKey)).body).arrayBuffer()), bytes);
  await x.storage.delete(nextKey);
  assert.equal(x.source.has(nextKey), false); assert.equal(x.requests.length, 0);
});

test('External mode writes privately to company R2, reads old photos, and retains original copies on deletion', async () => {
  const x = setup({ R2_STORAGE_MODE: 'external' });
  assert.equal(x.storage.status().ready, true);
  await x.storage.check();
  await x.storage.put(nextKey, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  assert.equal(x.source.has(nextKey), false); assert.equal(x.target.get(nextKey).contentType, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await new Response((await x.storage.get(nextKey)).body).arrayBuffer()), bytes);
  assert.ok(await x.storage.get(key));
  await x.storage.copyPage();
  await x.storage.delete(key);
  assert.equal(x.target.has(key), false); assert.equal(x.source.has(key), true); assert.equal(x.deletes.length, 0);
});

test('Migration copies all pages, verifies bytes, and is safe to restart without overwrites', async () => {
  const x = setup();
  for (let i = 0; i < 6; i++) x.source.set(i.toString(16).padStart(24, '0') + '.jpg', { bytes: new Uint8Array([i]), contentType: 'image/jpeg' });
  let cursor = '', copied = 0, verified = 0;
  do { const page = await x.storage.copyPage(cursor); copied += page.copied; verified += page.verified; cursor = page.next; } while (cursor);
  assert.equal(copied, 7); assert.equal(verified, 7); assert.equal(x.target.size, 7); assert.equal(x.source.size, 7);
  const first = await x.storage.copyPage(); assert.equal(first.copied, 0); assert.equal(first.verified, 3);
  assert.ok(x.requests.filter(r => r.method === 'PUT').every(r => r.headers.get('if-none-match') === '*'));
  assert.equal(x.target.get(key).contentType, 'image/png'); assert.equal(x.deletes.length, 0);
});

test('Migration refuses conflicting destination bytes without modifying either copy', async () => {
  const x = setup(); x.target.set(key, { bytes: new Uint8Array([9]), contentType: 'image/png' });
  await assert.rejects(x.storage.copyPage(), /검증 실패/);
  assert.deepEqual(x.target.get(key).bytes, new Uint8Array([9])); assert.deepEqual(x.source.get(key).bytes, bytes);
  assert.equal(x.requests.filter(r => r.method === 'PUT').length, 0);
  const sameBytes = setup(); sameBytes.target.set(key, { bytes, contentType: 'application/octet-stream' });
  await assert.rejects(sameBytes.storage.copyPage(), /형식 정보 검증 실패/);
  assert.equal(sameBytes.target.get(key).contentType, 'application/octet-stream');
});

test('Authentication/network errors are never hidden by a fallback to old photos', async () => {
  const x = setup({ R2_STORAGE_MODE: 'external' });
  for (const status of [403, 500]) {
    const storage = createImageStorage(x.env, { outbound: async () => new Response('do not expose this body', { status }) });
    await assert.rejects(storage.get(key), new RegExp('HTTP ' + status));
    await assert.rejects(storage.copyPage(), new RegExp('HTTP ' + status));
  }
  const storage = createImageStorage(x.env, { outbound: async () => { throw new Error('connection failed'); } });
  await assert.rejects(storage.get(key), /connection failed/);
});

test('Invalid configuration cannot send secrets to another host, and status never returns secret values', async () => {
  const x = setup({ R2_STORAGE_MODE: 'external' });
  for (const endpoint of ['https://other.test', company.R2_S3_ENDPOINT + '@other.test', company.R2_S3_ENDPOINT + '/?x=1', company.R2_S3_ENDPOINT.replace('https:', 'http:')]) {
    const storage = createImageStorage({ ...x.env, R2_S3_ENDPOINT: endpoint }, { outbound: () => assert.fail('no network allowed') });
    assert.equal(storage.status().ready, false); await assert.rejects(storage.get(key));
  }
  const storage = createImageStorage({ ...x.env, R2_SECRET_ACCESS_KEY: '' });
  assert.equal(storage.status().ready, false); await assert.rejects(storage.put(key, bytes));
  assert.doesNotMatch(JSON.stringify(x.storage.status()), /test-key|test-secret/);
  for (const name of ['../x', 'not-an-image', 'a'.repeat(24) + '.svg']) await assert.rejects(x.storage.get(name), /파일 이름/);
});

test('Migration detects a failed copy, a race collision, and oversized objects; original data survives', async () => {
  for (const race of [false, true]) {
    const x = setup();
    const storage = createImageStorage(x.env, { outbound: async request => {
      if (request.method === 'PUT') {
        if (race) x.target.set(key, { bytes: new Uint8Array([9]), contentType: 'image/png' });
        return new Response(null, { status: race ? 412 : 200 });
      }
      return x.outbound(request);
    } });
    await assert.rejects(storage.copyPage(), /검증 실패/); assert.deepEqual(x.source.get(key).bytes, bytes);
  }
  const x = setup(); x.source.set(key, { bytes: new Uint8Array(8 * 1024 * 1024 + 1), contentType: 'image/png' });
  await assert.rejects(x.storage.copyPage(), /8MB/); assert.equal(x.target.size, 0);
});

test('Only authenticated administrators can inspect or migrate image storage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-images-'));
  const { env, sqlite } = localEnvironment(dir, 'test-invite');
  const call = (method, route, cookie, body) => worker.fetch(new Request('https://work.test' + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  try {
    const register = await call('POST', '/api/auth/register', '', { name: 'Admin', password: 'password', invite: 'test-invite' });
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const signup = await call('POST', '/api/auth/register', '', { name: 'Staff', password: 'password', invite: 'test-invite' });
    const account = await signup.json();
    await call('POST', '/api/admin/users/' + account.account.id + '/approval', cookie, { status: 'approved' });
    const login = await call('POST', '/api/auth/login', '', { name: 'Staff', password: 'password' });
    const staff = login.headers.get('set-cookie').split(';')[0];
    for (const [method, route] of [['GET', '/api/admin/image-storage'], ['POST', '/api/admin/image-storage/check'], ['POST', '/api/admin/image-storage/copy']]) {
      assert.equal((await call(method, route, '', method === 'POST' ? {} : null)).status, 401);
      assert.equal((await call(method, route, staff, method === 'POST' ? {} : null)).status, 403);
    }
    const status = await call('GET', '/api/admin/image-storage', cookie);
    assert.equal(status.status, 200); assert.equal((await status.json()).mode, 'native');
    env.R2_SECRET_ACCESS_KEY = 'not-for-browser';
    const state = await (await call('GET', '/api/admin/image-storage', cookie)).text();
    assert.doesNotMatch(state, /not-for-browser/);
  } finally { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
