// R11 통합 검수: 실제 dist/cloud-sync.js·family-auth.js 클라이언트를 실제 server/cloud-api.js에
// (node:sqlite D1, 메모리 R2) 연결해 가족 계정의 용량 초과·세션 만료 이유·출처 거절 문구를 확인합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleCloudRequest} from '../server/cloud-api.js';
import {createCloudSync, CLOUD_QUOTA_MESSAGE} from '../dist/cloud-sync.js';
import {derivePasswordKey, familyAuthMessage} from '../dist/family-auth.js';

const ORIGIN = 'https://donghwa.example';
const INVITE = 'family-invite-0123456789-abcdef';
const PASSWORD = 'blue-whale-42!';
const copy = value => JSON.parse(JSON.stringify(value));
const fastKey = (username, password) => derivePasswordKey(username, password, {iterations: 1000});
const library = () => ({books: [{id: 'book-one', title: '우리 집 모험', pages: [{ko: '첫 쪽이에요.', en: 'First.'}]}], characters: [{id: 'child', name: '유하'}], backgrounds: [{id: 'home', name: '우리 집'}], worlds: [], settings: {}, storyDrafts: {}, daily: {}});

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../server/cloud-schema.sql', import.meta.url), 'utf8'));
  const objects = new Map();
  return {
    sqlite, objects, log: [], FAMILY_SIGNUP_CODE: INVITE,
    DB: {prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {bind(...args) {return {
        async first() {return statement.get(...args) || null;},
        async all() {return {results: statement.all(...args)};},
        async run() {return {meta: {changes: Number(statement.run(...args).changes)}};},
      };}};
    }},
    BUCKET: {
      async put(key, value) {objects.set(key, value instanceof Uint8Array ? value.slice() : new Uint8Array(await new Response(value).arrayBuffer())); return {};},
      async get(key) {const bytes = objects.get(key); return bytes ? {body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.slice().buffer} : null;},
      async delete(key) {objects.delete(key);},
    },
  };
}
/** What a browser sends: Origin on writes and Sec-Fetch-Site; `origin` overrides both for one device. */
function browserFetch(env, {origin = ORIGIN, site = 'same-origin', after = null} = {}) {
  return async (url, init = {}) => {
    const headers = new Headers(init.headers || {}), method = (init.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) headers.set('Origin', origin);
    headers.set('Sec-Fetch-Site', site);
    const {signal, keepalive, cache, credentials, redirect, ...rest} = init;
    const target = new URL(url, ORIGIN);
    const response = await handleCloudRequest(new Request(target, {...rest, method, headers, signal, duplex: 'half'}), env);
    env.log.push({method, path: target.pathname + target.search, status: response.status});
    await after?.(target, response);
    return response;
  };
}
function memoryStorage() {
  const values = new Map();
  return {getItem: key => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
}
function device(env, {fetchOptions, makeBackup} = {}) {
  const local = {state: library()};
  const sync = createCloudSync({
    getState: () => local.state, hasLocalData: () => true, isParent: () => true, canApplyRemote: () => true,
    storage: memoryStorage(), fetchImpl: browserFetch(env, fetchOptions), pollInterval: 0, eventTarget: null, document: null, debounceMs: 1e9,
    derivePasswordKey: fastKey, locks: null,
    applyRemote: async candidate => {local.state = candidate;},
    createLibraryBackup: makeBackup || (async state => ({snapshot: copy(state), imageAssets: [], audioAssets: []})),
  });
  return {sync, local};
}
const mediaPuts = (env, from) => env.log.slice(from).filter(entry => entry.method === 'PUT' && entry.path.startsWith('/api/cloud/media/'));

test('a family over its quota sees the quota message and the same library is not uploaded again until it changes or the parent pushes', async () => {
  const env = environment(), big = new Uint8Array(3 * 1024 * 1024);
  big.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let pictures = 0;
  // The device's pictures: `pictures` 3 MB images with their own ids.
  const makeBackup = async state => {
    const snapshot = copy(state), assets = new Map();
    for (let index = 0; index < pictures; index++) {
      const id = `image-new-picture-${String(index).padStart(6, '0')}`, bytes = big.slice();
      bytes[100] = index;
      assets.set(id, new Blob([bytes], {type: 'image/png'}));
      snapshot.characters[0]['sheet' + index] = {imageAssetId: id, imageUrl: 'asset:' + id};
    }
    return {snapshot, assets};
  };
  const {sync, local} = device(env, {makeBackup});
  try {
    await sync.start();
    assert.equal((await sync.familySignup({username: 'mom_kim', password: PASSWORD, inviteCode: INVITE})).ok, true);
    await sync.push({force: true});
    assert.equal(sync.getStatus().phase, 'ready');
    const owner = sync.getStatus().user.id, fill = env.sqlite.prepare("INSERT INTO cloud_assets VALUES (?, ?, 'image', 'image/png', 41943040, ?, 'k', 't')");
    for (let index = 0; index < 128; index++) fill.run(owner, 'image-filler-' + String(index).padStart(8, '0'), 'a'.repeat(64));
    // The parent adds a picture on this device.
    pictures = 1; local.state = {...copy(local.state), characters: [{id: 'child', name: '유하 (새 그림)'}]}; sync.changed();
    let start = env.log.length;
    for (let index = 0; index < 3; index++) {
      await sync.refresh();
      const status = sync.getStatus();
      assert.equal(status.phase, 'error');assert.equal(status.reason, 'quota');
      assert.equal(status.error, CLOUD_QUOTA_MESSAGE);
      assert.doesNotMatch(status.error, /HTTP \d+/);
    }
    assert.equal(mediaPuts(env, start).length, 1, 'the refused picture is sent once, not on every refresh');
    assert.equal(mediaPuts(env, start)[0].status, 413);
    // The library changes: one more try.
    start = env.log.length;
    local.state = {...copy(local.state), characters: [{id: 'child', name: '유하 (그림 둘)'}]}; sync.changed();
    await sync.refresh();
    assert.equal(mediaPuts(env, start).length, 1, 'a changed library is tried again');
    assert.equal(sync.getStatus().reason, 'quota');
    await sync.refresh();
    assert.equal(mediaPuts(env, start).length, 1);
    // The parent presses 이 기기 자료 클라우드에 저장.
    start = env.log.length;
    await assert.rejects(sync.push(), error => error.code === 'QUOTA_EXCEEDED' && error.message === CLOUD_QUOTA_MESSAGE);
    assert.equal(mediaPuts(env, start).length, 1, 'a push always tries');
    // Space is freed on the server and the parent pushes: saved, the block is gone.
    env.sqlite.prepare('DELETE FROM cloud_assets WHERE asset_id LIKE ?').run('image-filler-%');
    await sync.push();
    assert.equal(sync.getStatus().phase, 'ready');assert.equal(sync.getStatus().error, null);
  } finally {sync.stop();}
});

test('a family session revoked between GET /session and the next request keeps reason family-session-expired', async () => {
  const env = environment();
  let revoke = false;
  const after = async target => {if (revoke && target.pathname === '/api/cloud/session') {revoke = false; env.sqlite.exec('DELETE FROM family_sessions');}};
  const {sync} = device(env, {fetchOptions: {after}});
  try {
    await sync.start();
    await sync.familySignup({username: 'mom_kim', password: PASSWORD, inviteCode: INVITE});
    await sync.push({force: true});
    revoke = true;
    await sync.refresh();
    const status = sync.getStatus();
    assert.equal(status.phase, 'signed-out');
    assert.equal(status.reason, 'family-session-expired', 'the 401 from /library?meta=1 says why');
  } finally {sync.stop();}
});

test('push and pull after another device revoked the family session report family-session-expired', async () => {
  for (const action of ['push', 'pull']) {
    const env = environment(), {sync} = device(env);
    try {
      await sync.start();
      await sync.familySignup({username: 'mom_kim', password: PASSWORD, inviteCode: INVITE});
      await sync.push({force: true});
      env.sqlite.exec('DELETE FROM family_sessions');
      await assert.rejects(sync[action](), error => error.code === 'SIGNED_OUT' && error.reason === 'family-session-expired');
      assert.equal(sync.getStatus().phase, 'signed-out');
      assert.equal(sync.getStatus().reason, 'family-session-expired', action);
    } finally {sync.stop();}
  }
});

test('an origin refusal on /auth/* shows the address message, not a generic HTTP 403', async () => {
  for (const fetchOptions of [{origin: 'https://www.donghwa.example', site: 'same-site'}, {site: 'cross-site'}, {site: 'same-site'}]) {
    const env = environment(), {sync} = device(env, {fetchOptions});
    try {
      await sync.start();
      for (const result of [
        await sync.familyLogin({username: 'mom_kim', password: PASSWORD}),
        await sync.familySignup({username: 'mom_kim', password: PASSWORD, inviteCode: INVITE}),
      ]) {
        assert.equal(result.ok, false);assert.equal(result.code, 'origin_forbidden');assert.equal(result.status, 403);
        assert.equal(result.message, '이 주소에서는 로그인할 수 없어요. 동화공방 주소로 직접 열어 주세요.');
      }
    } finally {sync.stop();}
  }
});

test('every error code the /auth/* routes can return has its own Korean message', () => {
  const source = readFileSync(new URL('../server/cloud-api.js', import.meta.url), 'utf8');
  // The family section and the shared helpers the auth routes call.
  const body = name => {const at = source.indexOf(`function ${name}(`); assert.ok(at > 0, name); return source.slice(at, source.indexOf('\n}\n', at));};
  const family = source.slice(source.indexOf('// Family ID/password accounts'), source.indexOf('export async function handleCloudRequest'));
  const scanned = [family, ...['checkAccount', 'checkMutationOrigin', 'storage', 'boundedBody'].map(body)].join('\n');
  const codes = new Set([...scanned.matchAll(/fail\(\s*\d+,\s*"([a-z_]+)"|code: "([a-z_]+)"/g)].map(match => match[1] || match[2]));
  codes.add('cloud_unavailable');
  const expected = ['signup_closed', 'invite_invalid', 'username_taken', 'invalid_credentials', 'invalid_recovery', 'family_only', 'authentication_required', 'account_changed', 'origin_forbidden', 'too_many_attempts', 'json_required', 'request_too_large', 'storage_unavailable', 'cloud_unavailable', 'invalid_username', 'reserved_username', 'invalid_password_key', 'invalid_display_name', 'confirm_required', 'invalid_json', 'invalid_request', 'method_not_allowed', 'not_found'];
  for (const code of expected) assert.ok(codes.has(code), `${code} is still an /auth/* code`);
  const status = {signup_closed: 503, storage_unavailable: 503, cloud_unavailable: 503, too_many_attempts: 429, request_too_large: 413, json_required: 415, origin_forbidden: 403, family_only: 403, account_changed: 403, invite_invalid: 403, username_taken: 409, method_not_allowed: 405, not_found: 404, invalid_credentials: 401, invalid_recovery: 401, authentication_required: 401};
  const generic = /HTTP \d+|^요청을 완료하지 못했어요/;
  for (const code of codes) {
    const message = familyAuthMessage(code, {status: status[code] || 400, retryAfter: 120});
    assert.match(message, /[가-힣]/, code);
    assert.doesNotMatch(message, generic, `${code} -> ${message}`);
  }
  assert.equal(familyAuthMessage('origin_forbidden', {status: 403}), '이 주소에서는 로그인할 수 없어요. 동화공방 주소로 직접 열어 주세요.');
});
