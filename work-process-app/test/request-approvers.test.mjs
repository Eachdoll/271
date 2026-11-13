import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';

test('Team responsibility grants separate approval rights, supports reassignment, and retains staff processing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'request-approvers-'));
  const { env, sqlite } = localEnvironment(dir, 'responsible-test');
  function client() {
    let cookie = '';
    return async (method, url, body) => {
      const response = await worker.fetch(new Request('https://responsible.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, body: await response.json() };
    };
  }
  try {
    const admin = client(), quality = client(), dev = client(), applicant = client(), anon = client();
    await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'responsible-test' });
    const q = (await approvedRegistration(admin, quality, { name: '품질직원', password: 'password', invite: 'responsible-test' })).body.user;
    const d = (await approvedRegistration(admin, dev, { name: '개발직원', password: 'password', invite: 'responsible-test' })).body.user;
    const pending = (await applicant('POST', '/api/auth/register', { name: '가입대기', password: 'password', invite: 'responsible-test' })).body.account;
    assert.equal((await admin('PUT', `/api/admin/users/${pending.id}`, { roles: ['quality_approver'] })).status, 400);
    assert.equal((await anon('GET', '/api/approval-managers')).status, 401);
    assert.deepEqual((await quality('GET', '/api/approval-managers')).body, { analysis: [], development: [] });
    await admin('PUT', `/api/admin/users/${q.id}`, { roles: ['quality'] });
    await admin('PUT', `/api/admin/users/${d.id}`, { roles: ['dev'] });
    assert.equal((await quality('PUT', `/api/admin/users/${q.id}`, { roles: ['quality_approver'] })).status, 403);
    const analysis = (await dev('POST', '/api/requests', { type: 'analysis', title: '분석 승인 검증', category: '의뢰검사' })).body;
    const development = (await quality('POST', '/api/requests', { type: 'development', title: '개발 승인 검증', target_price: '1000원' })).body;
    for (const [staff, request] of [[quality, analysis], [dev, development]]) {
      assert.equal((await staff('POST', `/api/requests/${request.id}/approve`)).status, 403);
      assert.equal((await staff('POST', `/api/requests/${request.id}/reject`, { reason: '권한 없음' })).status, 403);
    }
    assert.equal((await admin('GET', '/api/requests?type=analysis')).body.find(r => r.id === analysis.id).status, 'pending');
    await admin('PUT', `/api/admin/users/${q.id}`, { roles: ['quality_approver'] });
    await admin('PUT', `/api/admin/users/${d.id}`, { roles: ['dev_approver'] });
    assert.deepEqual((await dev('GET', '/api/approval-managers')).body, { analysis: [{ id: q.id, name: q.name }], development: [{ id: d.id, name: d.name }] });
    assert.equal((await quality('POST', `/api/requests/${development.id}/approve`)).status, 403);
    assert.equal((await dev('POST', `/api/requests/${analysis.id}/reject`, { reason: '다른팀' })).status, 403);
    const rejected = await quality('POST', `/api/requests/${analysis.id}/reject`, { reason: '분석항목 확인' });
    assert.equal(rejected.status, 200); assert.equal(rejected.body.approver_name, q.name);
    const approvedAnalysis = await quality('POST', `/api/requests/${analysis.id}/approve`);
    assert.equal(approvedAnalysis.body.status, 'waiting'); assert.equal(approvedAnalysis.body.approver_name, q.name);
    assert.match(approvedAnalysis.body.req_no, /^Q-/);
    assert.equal((await quality('POST', `/api/requests/${analysis.id}/status`, { status: 'progress' })).status, 200);
    const approvedDev = await dev('POST', `/api/requests/${development.id}/approve`);
    assert.equal(approvedDev.body.status, 'waiting'); assert.equal(approvedDev.body.approver_name, d.name);
    assert.match(approvedDev.body.req_no, /^D-/);
    assert.equal((await dev('POST', `/api/requests/${development.id}/status`, { status: 'progress' })).status, 200);
    // Removing only approval rights leaves ordinary team processing intact, immediately on existing sessions.
    await admin('PUT', `/api/admin/users/${q.id}`, { roles: ['quality'] });
    assert.equal((await quality('POST', `/api/requests/${analysis.id}/status`, { status: 'done' })).status, 200);
    const next = (await dev('POST', '/api/requests', { type: 'analysis', title: '책임자 변경', category: '의뢰검사' })).body;
    assert.equal((await quality('POST', `/api/requests/${next.id}/approve`)).status, 403);
    await admin('PUT', `/api/admin/users/${d.id}`, { roles: ['dev_approver', 'quality_approver'] });
    assert.equal((await dev('POST', `/api/requests/${next.id}/approve`)).status, 200);
    assert.deepEqual((await quality('GET', '/api/approval-managers')).body.analysis, [{ id: d.id, name: d.name }]);
    await admin('POST', `/api/admin/users/${d.id}/approval`, { status: 'rejected' });
    assert.deepEqual((await quality('GET', '/api/approval-managers')).body, { analysis: [], development: [] });
    // Administrator fallback remains available without implicitly assigning any team leader.
    const fallback = (await quality('POST', '/api/requests', { type: 'development', title: '관리자 대행', target_price: '1000원' })).body;
    assert.equal((await admin('POST', `/api/requests/${fallback.id}/approve`)).status, 200);
  } finally { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
