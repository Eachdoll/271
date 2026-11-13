const assert = require('node:assert/strict');
module.exports = async function approvedRegistration(admin, client, body) {
  const result = await client('POST', '/api/auth/register', body);
  assert.equal(result.status, 200);
  if (result.body.pending) {
    assert.equal((await admin('POST', `/api/admin/users/${result.body.account.id}/approval`, { status: 'approved' })).status, 200);
    return client('POST', '/api/auth/login', { name: body.name, password: body.password });
  }
  return result;
};
