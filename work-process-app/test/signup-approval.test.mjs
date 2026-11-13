import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';

test('New signup requires administrator review, rejection revokes sessions, and reapproval works', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signup-review-'));
  const { env, sqlite } = localEnvironment(dir, 'review-test');
  function client() {
    let cookie = '';
    return async (method, url, body) => {
      const response = await worker.fetch(new Request('https://review.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
    };
  }
  try {
    const admin = client(), member = client(), outsider = client();
    const first = await admin('POST', '/api/auth/register', { name: '관리자', password: 'password', invite: 'review-test' });
    assert.equal(first.body.user.approval_status, 'approved');
    const registration = await member('POST', '/api/auth/register', { name: '새직원', password: 'password', invite: 'review-test' });
    assert.equal(registration.body.pending, true); assert.equal(registration.cookie, null); assert.equal(registration.body.user, null);
    const id = registration.body.account.id, url = `/api/admin/users/${id}/approval`;
    assert.equal((await member('GET', '/api/me')).body.user, null);
    assert.equal((await member('GET', '/api/po')).status, 401);
    assert.equal((await member('POST', '/api/auth/login', { name: '새직원', password: 'wrong' })).status, 401);
    const pending = await member('POST', '/api/auth/login', { name: '새직원', password: 'password' });
    assert.equal(pending.status, 403); assert.match(pending.body.error, /승인 대기/);
    assert.equal((await outsider('POST', url, { status: 'approved' })).status, 401);
    assert.equal((await admin('PUT', `/api/admin/users/${id}`, { is_admin: true })).status, 400);
    assert.equal((await admin('POST', url, { status: 'invalid' })).status, 400);
    const rejected = await admin('POST', url, { status: 'rejected', note: '소속 확인 필요' });
    assert.equal(rejected.body.reviewed_by, '관리자');
    assert.equal(rejected.body.approval_status, 'rejected');
    const blocked = await member('POST', '/api/auth/login', { name: '새직원', password: 'password' });
    assert.equal(blocked.status, 403); assert.match(blocked.body.error, /소속 확인 필요/);
    assert.equal((await admin('POST', url, { status: 'approved' })).status, 200);
    assert.equal((await member('POST', '/api/auth/login', { name: '새직원', password: 'password' })).status, 200);
    assert.equal((await member('GET', '/api/po')).status, 200);
    assert.equal((await member('POST', url, { status: 'approved' })).status, 403);
    assert.equal((await admin('POST', `/api/admin/users/${first.body.user.id}/approval`, { status: 'rejected' })).status, 400);
    assert.equal((await admin('POST', url, { status: 'rejected' })).status, 200);
    assert.equal((await member('GET', '/api/me')).body.user, null);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(id).n, 0);
    // Even a stale session restored by another process must fail the status check.
    sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run('stale', id, Date.now() + 60000);
    const stale = await worker.fetch(new Request('https://review.test/api/po', { headers: { cookie: 'wpa_sid=stale' } }), env);
    assert.equal(stale.status, 401);
  } finally { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Approval migration preserves existing accounts, roles and sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signup-migrate-'));
  let sqlite = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    sqlite.exec('CREATE TABLE _local_migrations(name TEXT PRIMARY KEY)');
    const migrationDir = new URL('../drizzle/', import.meta.url);
    for (const file of fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql') && !f.startsWith('0005')).sort()) {
      sqlite.exec(fs.readFileSync(new URL(file, migrationDir), 'utf8'));
      sqlite.prepare('INSERT INTO _local_migrations VALUES(?)').run(file);
    }
    sqlite.prepare('INSERT INTO users(name,pw_salt,pw_hash,is_admin,roles) VALUES(?,?,?,?,?)').run('기존직원', 'salt', 'hash', 1, 'quality');
    sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run('existing', 1, Date.now() + 60000);
    sqlite.close(); ({ sqlite } = localEnvironment(dir, 'review-test'));
    const existing = sqlite.prepare('SELECT * FROM users').get();
    assert.equal(existing.approval_status, 'approved'); assert.equal(existing.is_admin, 1); assert.equal(existing.roles, 'quality'); assert.equal(existing.pw_hash, 'hash');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  } finally { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
