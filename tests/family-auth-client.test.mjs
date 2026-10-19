import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync, randomBytes, randomUUID} from 'node:crypto';
import {createCloudSync, hashCloudState, CLOUD_SYNC_STORAGE_KEY} from '../dist/cloud-sync.js';
import {
  FAMILY_SESSION_KEY, FAMILY_MESSAGES, normalizeUsername, validateUsername, validatePassword,
  validateExistingPassword, validateDisplayName, derivePasswordKey, normalizeRecoveryCode,
  formatRecoveryCode, isRecoveryCode, readFamilySession, writeFamilySession, clearFamilySession,
  familySessionHeaders, isFullAutoRunActive, familyAuthMessage,
} from '../dist/family-auth.js';
import {requestAutoStop, createAutoStopWatcher} from '../dist/full-auto-control.js';

// ---- fixtures ---------------------------------------------------------------
const copy = value => JSON.parse(JSON.stringify(value));
const library = (name = '유하') => ({books: [{id: 'book-one', title: '우리 집 모험', pages: [{ko: '유하가 문을 열어요.', en: 'Yuha opens the door.'}]}], characters: [{id: 'child', name}], backgrounds: [{id: 'home', name: '우리 집', layout: '왼쪽 노란 문'}], worlds: [{id: 'world-one', name: '우리 세상'}], settings: {pinHash: 'device-pin'}, storyDrafts: {}});
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const newCode = () => Array.from(randomBytes(20), byte => CROCKFORD[byte & 31]).join('');
const newToken = () => randomBytes(32).toString('base64url');
/** The browser derivation with few iterations so the suite stays fast; the 600000 default has its own vector test. */
const fastKey = (username, password) => derivePasswordKey(username, password, {iterations: 1000});
const CHATGPT = {id: 'owner-A', email: 'family@example.test', displayName: '부모'};
const PASSWORD = 'blue-whale-42!';
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) {
  for (let i = 0; i < 200; i++) {if (check()) return; await sleep(2);}
  assert.fail('timed out waiting for ' + label);
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {getItem: key => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values};
}
async function baseline(state, revision = 1, accountId = CHATGPT.id) {
  return {[CLOUD_SYNC_STORAGE_KEY]: JSON.stringify({accountId, revision, stateHash: await hashCloudState(state), updatedAt: '2026-10-15T00:00:00Z'})};
}
const storedBaseline = storage => JSON.parse(storage.getItem(CLOUD_SYNC_STORAGE_KEY) || 'null');

/**
 * Implements the server contract (identity order, auth endpoints and their
 * errors) without importing the server track's code.
 */
function server({sitesUser = null} = {}) {
  const api = {sitesUser, invite: 'family-invite-2026', signupOpen: true, loginLimited: false, accounts: new Map(), sessions: new Map(), libraries: new Map(), calls: [], intercept: null};
  const familyUser = account => ({id: account.ownerId, kind: 'family', username: account.username, displayName: account.displayName, email: ''});
  api.addAccount = async (username, password = PASSWORD, {displayName = '', recoveryCode = newCode()} = {}) => {
    const account = {ownerId: 'family:' + randomUUID(), username, displayName, passwordKey: await fastKey(username, password), recoveryCode};
    api.accounts.set(username, account);
    return account;
  };
  api.addSession = account => {const token = newToken(); api.sessions.set(token, account.username); return token;};
  api.setLibrary = (ownerId, state, revision = 1) => api.libraries.set(ownerId, {state: copy(state), revision, manifest: []});
  const identity = headers => {
    const token = headers.get('X-Family-Session');
    if (token !== null) {
      const username = /^[A-Za-z0-9_-]{43}$/.test(token) ? api.sessions.get(token) : undefined, account = username && api.accounts.get(username);
      return account ? {user: familyUser(account), token} : {user: null, reason: 'family-session-expired'};
    }
    return api.sitesUser && !api.sitesUser.id.startsWith('family:') ? {user: api.sitesUser} : {user: null};
  };
  const error = (status, code, extra = {}) => json({error: {code, message: 'server wording'}, ...extra}, status);
  const signedIn = (account, status = 200, extra = {}) => json({user: familyUser(account), session: {token: api.addSession(account), expiresAt: '2027-04-17T00:00:00Z'}, ...extra}, status);
  const dropSessions = username => {for (const [token, owner] of api.sessions) if (owner === username) api.sessions.delete(token);};
  api.fetch = async (url, options = {}) => {
    const path = String(url).replace('/api/cloud', ''), method = options.method || 'GET', headers = new Headers(options.headers);
    const call = {path, method, headers, body: options.body, options}; api.calls.push(call);
    const intercepted = await api.intercept?.(call); if (intercepted) return intercepted;
    if (path.startsWith('/auth/')) {
      assert.equal(method, 'POST'); assert.equal(headers.get('Content-Type'), 'application/json');
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body), name = path.slice(6);
      if (name === 'signup') {
        if (!api.signupOpen) return error(503, 'signup_closed');
        if (body.inviteCode !== api.invite) return error(403, 'invite_invalid');
        if (api.accounts.has(body.username)) return error(409, 'username_taken');
        assert.match(body.passwordKey, /^[A-Za-z0-9_-]{43}$/);
        const account = {ownerId: 'family:' + randomUUID(), username: body.username, displayName: body.displayName || '', passwordKey: body.passwordKey, recoveryCode: newCode()};
        api.accounts.set(body.username, account);
        return signedIn(account, 201, {recoveryCode: account.recoveryCode});
      }
      if (name === 'login') {
        if (api.loginLimited) return json({error: {code: 'too_many_attempts', message: 'x'}, retryAfter: 600}, 429, {'Retry-After': '600'});
        const account = api.accounts.get(body.username);
        if (!account || account.passwordKey !== body.passwordKey) return error(401, 'invalid_credentials');
        return signedIn(account);
      }
      if (name === 'logout') {const token = headers.get('X-Family-Session'); if (token) api.sessions.delete(token); return json({ok: true});}
      if (name === 'recover') {
        const account = api.accounts.get(body.username);
        if (!account || account.recoveryCode !== body.recoveryCode) return error(401, 'invalid_recovery');
        account.passwordKey = body.newPasswordKey; dropSessions(account.username); account.recoveryCode = newCode();
        return signedIn(account, 200, {recoveryCode: account.recoveryCode});
      }
      const who = identity(headers);
      if (!who.user) return error(401, 'authentication_required');
      if (headers.get('X-Cloud-Account-ID') !== who.user.id) return error(403, 'account_mismatch');
      const account = api.accounts.get(who.user.username);
      if (name === 'password') {
        if (account.passwordKey !== body.currentPasswordKey) return error(401, 'invalid_credentials');
        account.passwordKey = body.newPasswordKey; api.sessions.delete(who.token);
        if (body.signOutOthers === true) dropSessions(account.username);
        return json({session: {token: api.addSession(account), expiresAt: '2027-04-17T00:00:00Z'}});
      }
      if (name === 'delete') {
        if (body.confirm !== '삭제') return error(400, 'confirm_required');
        if (account.passwordKey !== body.passwordKey) return error(401, 'invalid_credentials');
        api.accounts.delete(account.username); dropSessions(account.username); api.libraries.delete(account.ownerId);
        return json({deleted: true});
      }
      throw new Error('Unexpected auth endpoint ' + name);
    }
    const who = identity(headers);
    if (path === '/session') return json(who.user ? {authenticated: true, user: who.user} : {authenticated: false, signInPath: '/signin-with-chatgpt?return_to=%2F', ...(who.reason ? {reason: who.reason} : {})});
    if (!who.user) return json({error: {code: 'authentication_required'}}, 401);
    if (headers.get('X-Cloud-Account-ID') !== who.user.id) return json({error: {code: 'account_mismatch'}}, 403);
    const record = api.libraries.get(who.user.id);
    const summary = {bookCount: record?.state?.books?.length || 0, characterCount: record?.state?.characters?.length || 0, backgroundCount: record?.state?.backgrounds?.length || 0};
    if (path === '/library?meta=1') return json({exists: !!record, revision: record?.revision || 0, updatedAt: record ? '2026-10-19T01:00:00Z' : null, summary});
    if (path === '/library' && method === 'GET') return json({exists: !!record, revision: record?.revision || 0, state: record?.state || null, manifest: record?.manifest || [], updatedAt: record ? '2026-10-19T01:00:00Z' : null});
    if (path === '/library' && method === 'PUT') {
      const body = JSON.parse(options.body), revision = record?.revision || 0;
      if (body.expectedRevision !== revision) return json({error: {code: 'revision_conflict'}, revision}, 409);
      api.libraries.set(who.user.id, {state: body.state, revision: revision + 1, manifest: body.manifest});
      return json({revision: revision + 1, updatedAt: '2026-10-19T02:00:00Z'});
    }
    throw new Error('Unexpected request ' + method + ' ' + path);
  };
  return api;
}
function client(api, {state = library(), storage = memoryStorage(), isAutoRunning, locks = null, eventTarget = null, local: extra = {}} = {}) {
  const local = {state, available: true, parent: true, canApply: true, applies: [], changes: [], ...extra};
  const sync = createCloudSync({
    getState: () => local.state, hasLocalData: () => local.available, isParent: () => local.parent, canApplyRemote: () => local.canApply,
    storage, fetchImpl: api.fetch, pollInterval: 0, eventTarget, document: null, debounceMs: 100000,
    onChange: status => local.changes.push(status),
    applyRemote: async candidate => {local.applies.push(candidate); local.state = candidate; local.available = true;},
    derivePasswordKey: fastKey, isAutoRunning, locks,
  });
  return {sync, local, storage};
}
const writes = api => api.calls.filter(call => call.method === 'PUT');
const libraryCalls = calls => calls.filter(call => call.path.startsWith('/library') || call.path.startsWith('/media/'));
/** A device connected to the ChatGPT account and saved (ready, not dirty). */
async function savedChatGptDevice(api, options = {}) {
  const state = library();
  api.setLibrary(CHATGPT.id, state);
  const storage = memoryStorage(await baseline(state));
  const device = client(api, {state, storage, ...options});
  await device.sync.start();
  assert.equal(device.sync.getStatus().phase, 'ready');
  assert.equal(device.sync.getStatus().dirty, false);
  return device;
}

// ---- pure helpers -----------------------------------------------------------
test('usernames normalize with NFKC, trim and lower-case, and refuse bad or reserved names in Korean', () => {
  assert.equal(normalizeUsername('  ＹｕＨａ_Home '), 'yuha_home');
  assert.deepEqual(validateUsername(' YuHa_Home '), {ok: true, username: 'yuha_home'});
  for (const bad of ['', 'abc', '1yuha', '_yuha', 'yu-ha', 'yuha home', 'a'.repeat(21), '유하네가족'])
    assert.deepEqual(validateUsername(bad).message, '아이디는 영문 소문자로 시작하고 영문 소문자·숫자·밑줄(_)로 4~20자예요.', bad);
  for (const name of ['admin', 'Root', 'SYSTEM', 'support', 'chatgpt', 'openai', 'family', 'donghwa', 'guest', 'test'])
    assert.deepEqual(validateUsername(name), {ok: false, username: name.toLowerCase(), code: 'username_reserved', message: '쓸 수 없는 아이디예요.'});
});

test('new passwords: printable ASCII, 10-128 characters, no username, not a common password', () => {
  assert.deepEqual(validatePassword('blue-whale-42!', 'yuha_home'), {ok: true});
  assert.equal(validatePassword('비밀번호는열글자이상이에요', 'yuha_home').message, '비밀번호는 영문·숫자·기호로 만들어 주세요(아이폰 비밀번호 칸에서는 한글을 입력할 수 없어요).');
  assert.equal(validatePassword('abc\tdefghijk').code, 'password_ascii', 'control characters are not printable ASCII');
  assert.equal(validatePassword('short1!').message, '비밀번호는 10자 이상이에요.');
  assert.equal(validatePassword('a'.repeat(9) + 'b').ok, true);
  assert.equal(validatePassword('ab'.repeat(65)).code, 'password_long');
  assert.equal(validatePassword('my-YUHA_HOME-pw', ' YuHa_Home ').code, 'password_username');
  for (const common of ['1234567890', 'qwer1234!!', '1q2w3e4r5t', 'password12', 'asdf123456', 'qwertyuiop', 'QWERTYUIOP', 'zzzzzzzzzzzz'])
    assert.equal(validatePassword(common, 'yuha_home').code, 'password_common', common);
  assert.equal(validatePassword('').message, '비밀번호를 입력해 주세요.');
  // Signing in only needs something sign-up could have accepted.
  assert.deepEqual(validateExistingPassword('x'), {ok: true});
  assert.equal(validateExistingPassword('한글').code, 'password_ascii');
  assert.deepEqual(validateDisplayName('  유하네  '), {ok: true, displayName: '유하네'});
  assert.equal(validateDisplayName('가'.repeat(21)).code, 'display_name_long');
  assert.equal(validateDisplayName('유하\n네').code, 'display_name_invalid');
});

test('derivePasswordKey matches PBKDF2-HMAC-SHA-256 with the family salt and 600000 iterations', async () => {
  const expected = pbkdf2Sync(Buffer.from('blue-whale-42!', 'utf8'), Buffer.from('donghwa-family-pw-v1:yuha_home', 'utf8'), 600000, 32, 'sha256').toString('base64url');
  const key = await derivePasswordKey(' YuHa_Home ', 'blue-whale-42!');
  assert.equal(key, expected);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  const quick = pbkdf2Sync('blue-whale-42!', 'donghwa-family-pw-v1:yuha_home', 1000, 32, 'sha256').toString('base64url');
  assert.equal(await derivePasswordKey('yuha_home', 'blue-whale-42!', {iterations: 1000}), quick);
  await assert.rejects(derivePasswordKey('yuha_home', 'pw', {subtle: null}), {code: 'crypto_unavailable', message: FAMILY_MESSAGES.crypto});
});

test('recovery codes normalize O to 0 and I/L to 1, drop spaces and hyphens, and display in groups of four', () => {
  assert.equal(normalizeRecoveryCode(' abcd-efgh ijkl-mnop o1il '), 'ABCDEFGH1JK1MN0P0111');
  assert.equal(formatRecoveryCode('abcdefghjkmnpqrstvwx'), 'ABCD-EFGH-JKMN-PQRS-TVWX');
  assert.ok(isRecoveryCode('abcd efgh jkmn pqrs tvwx'));
  assert.ok(!isRecoveryCode('ABCD-EFGH-JKMN-PQRS'));
  assert.ok(!isRecoveryCode('ABCD-EFGH-JKMN-PQRS-TVWU'), 'U is not Crockford base32');
});

test('session storage keeps only token, owner, username, display name and time; unreadable storage reads as signed out', () => {
  const storage = memoryStorage(), token = newToken();
  const saved = writeFamilySession(storage, {token, ownerId: 'family:1234-abcd', username: 'yuha_home', displayName: '유하네', password: PASSWORD, passwordKey: 'k'.repeat(43), recoveryCode: 'ABCD-EFGH-JKMN-PQRS-TVWX'}, new Date('2026-10-19T00:00:00Z'));
  const raw = JSON.parse(storage.getItem(FAMILY_SESSION_KEY));
  assert.deepEqual(Object.keys(raw).sort(), ['displayName', 'ownerId', 'savedAt', 'token', 'username']);
  assert.deepEqual(raw, saved);
  assert.equal(raw.savedAt, '2026-10-19T00:00:00.000Z');
  assert.ok(!storage.getItem(FAMILY_SESSION_KEY).includes(PASSWORD) && !storage.getItem(FAMILY_SESSION_KEY).includes('ABCD'));
  assert.deepEqual(readFamilySession(storage), saved);
  assert.deepEqual(familySessionHeaders(storage), {'X-Family-Session': token});
  assert.throws(() => writeFamilySession(storage, {token: 'short', ownerId: 'family:x', username: 'yuha_home'}));
  assert.throws(() => writeFamilySession(storage, {token, ownerId: 'owner-A', username: 'yuha_home'}), 'only family owner ids');
  assert.ok(clearFamilySession(storage));
  assert.equal(readFamilySession(storage), null);
  assert.deepEqual(familySessionHeaders(storage), {});
  assert.equal(readFamilySession(memoryStorage({[FAMILY_SESSION_KEY]: '{not json'})), null);
  assert.equal(readFamilySession({getItem() {throw new Error('blocked');}}), null);
  assert.equal(readFamilySession(null), null);
});

test('FULL AUTO is detected in this tab or through any donghwa-full-auto-* Web Lock', async () => {
  assert.equal(await isFullAutoRunActive({isAutoRunning: () => true, locks: null}), true);
  assert.equal(await isFullAutoRunActive({isAutoRunning: () => false, locks: {query: async () => ({held: [{name: 'donghwa-full-auto-auto-123456789'}]})}}), true);
  assert.equal(await isFullAutoRunActive({locks: {query: async () => ({held: [{name: 'other-lock'}], pending: [{name: 'donghwa-full-auto-x'}]})}}), false);
  assert.equal(await isFullAutoRunActive({locks: {query: async () => {throw new Error('no');}}}), false);
  assert.equal(familyAuthMessage('too_many_attempts', {retryAfter: 61}), '시도가 너무 많아요. 2분 뒤 다시 해 주세요.');
});

// ---- cloud-sync integration ------------------------------------------------
test('request() sends X-Family-Session read from storage at call time, and nothing when no family session is stored', async () => {
  const api = server({sitesUser: CHATGPT}), {sync, storage} = await savedChatGptDevice(api);
  try {
    assert.ok(api.calls.length > 0);
    assert.ok(api.calls.every(call => !call.headers.has('X-Family-Session')));
    const account = await api.addAccount('yuha_home'), token = api.addSession(account);
    writeFamilySession(storage, {token, ownerId: account.ownerId, username: 'yuha_home', displayName: ''});
    const before = api.calls.length;
    await sync.refresh();
    const after = api.calls.slice(before);
    assert.ok(after.length > 0);
    assert.ok(after.every(call => call.headers.get('X-Family-Session') === token));
  } finally {sync.stop();}
});

test('a wrong password changes no phase, block or lock and makes no library request', async () => {
  const api = server({sitesUser: CHATGPT});
  await api.addAccount('yuha_home');
  const {sync, local, storage} = await savedChatGptDevice(api);
  try {
    const status = sync.getStatus(), changes = local.changes.length, before = api.calls.length, saved = storage.getItem(CLOUD_SYNC_STORAGE_KEY);
    const result = await sync.familyLogin({username: 'yuha_home', password: 'not-the-password-9'});
    assert.deepEqual(result, {ok: false, code: 'invalid_credentials', message: '아이디 또는 비밀번호가 맞지 않아요.', status: 401});
    assert.deepEqual(api.calls.slice(before).map(call => call.path), ['/auth/login']);
    assert.deepEqual(sync.getStatus(), status);
    assert.equal(local.changes.length, changes, 'no status was emitted');
    assert.equal(storage.getItem(FAMILY_SESSION_KEY), null);
    assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY), saved);
    // The plaintext password never left the page: only the derived key was sent.
    const body = JSON.parse(api.calls.at(-1).body);
    assert.deepEqual(Object.keys(body).sort(), ['passwordKey', 'username']);
    assert.equal(body.passwordKey, await fastKey('yuha_home', 'not-the-password-9'));
    // Validation failures never reach the server at all.
    const quiet = api.calls.length;
    assert.equal((await sync.familyLogin({username: 'yuha_home', password: '비밀번호'})).code, 'password_ascii');
    assert.equal((await sync.familyLogin({username: 'ad', password: PASSWORD})).code, 'username_format');
    assert.equal(api.calls.length, quiet);
    assert.deepEqual(sync.getStatus(), status);
    // The same holds on a locked, signed-out device.
    api.sitesUser = null; await sync.refresh();
    const locked = sync.getStatus(), lockedChanges = local.changes.length;
    assert.equal(locked.phase, 'signed-out');
    assert.equal((await sync.familyLogin({username: 'yuha_home', password: 'still-wrong-99'})).code, 'invalid_credentials');
    assert.deepEqual(sync.getStatus(), locked);
    assert.equal(local.changes.length, lockedChanges);
    assert.equal(writes(api).length, 0);
  } finally {sync.stop();}
});

test('family sign-in on an unlocked, saved device drops the old baseline and waits for the source choice without uploading', async () => {
  for (const familyHasBooks of [false, true]) {
    const api = server({sitesUser: CHATGPT}), account = await api.addAccount('yuha_home', PASSWORD, {displayName: '유하네'});
    if (familyHasBooks) api.setLibrary(account.ownerId, library('가족 클라우드'));
    const {sync, local, storage} = await savedChatGptDevice(api);
    try {
      const result = await sync.familyLogin({username: ' YuHa_Home ', password: PASSWORD});
      assert.equal(result.ok, true);
      assert.deepEqual(result.user, {id: account.ownerId, kind: 'family', username: 'yuha_home', displayName: '유하네', email: ''});
      const status = sync.getStatus();
      assert.equal(status.phase, 'choice');
      assert.equal(status.reason, familyHasBooks ? 'choose-source' : 'initial-upload');
      assert.equal(status.user.id, account.ownerId);
      assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY), null, 'the ChatGPT baseline is forgotten');
      assert.equal(readFamilySession(storage).ownerId, account.ownerId);
      assert.equal(writes(api).length, 0, 'nothing uploads before the parent confirms');
      assert.equal(local.applies.length, 0);
      assert.equal(local.state.characters[0].name, '유하');
      // Every request after the switch carries the family token and the family owner id.
      const token = readFamilySession(storage).token;
      const libraryAfter = libraryCalls(api.calls.filter(call => call.headers.get('X-Family-Session') === token));
      assert.ok(libraryAfter.length > 0 && libraryAfter.every(call => call.headers.get('X-Cloud-Account-ID') === account.ownerId));
    } finally {sync.stop();}
  }
});

test('a sign-in waits for the sync request already in flight, so no request mixes the old account with the new token', async () => {
  const api = server({sitesUser: CHATGPT}), account = await api.addAccount('yuha_home');
  const {sync, storage} = await savedChatGptDevice(api);
  try {
    let release, entered;
    const gate = new Promise(done => {release = done;}), reached = new Promise(done => {entered = done;});
    api.intercept = async call => {if (call.path === '/library?meta=1' && !call.headers.has('X-Family-Session')) {entered(); await gate;}};
    const refreshing = sync.refresh();
    await reached;
    const signingIn = sync.familyLogin({username: 'yuha_home', password: PASSWORD});
    await sleep(20);
    assert.equal(readFamilySession(storage), null, 'the switch waits for the running request');
    assert.equal(api.calls.filter(call => call.path === '/auth/login').length, 0);
    release();
    await refreshing;
    assert.equal((await signingIn).ok, true);
    assert.equal(sync.getStatus().phase, 'choice');
    const mixed = api.calls.filter(call => call.headers.has('X-Family-Session') && call.headers.get('X-Cloud-Account-ID') === CHATGPT.id);
    assert.deepEqual(mixed, []);
    assert.equal(writes(api).length, 0);
  } finally {sync.stop();}
});

test('a device without any cloud baseline also goes to the source choice after family sign-in', async () => {
  const api = server({sitesUser: CHATGPT});
  await api.addAccount('yuha_home');
  const {sync, storage} = client(api);
  try {
    await sync.start();
    assert.equal(sync.getStatus().phase, 'choice');
    assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY), null);
    assert.equal((await sync.familyLogin({username: 'yuha_home', password: PASSWORD})).ok, true);
    assert.equal(sync.getStatus().phase, 'choice', 'no account-changed lock for a never-uploaded library');
    assert.equal(sync.getStatus().reason, 'initial-upload');
    assert.equal(writes(api).length, 0);
  } finally {sync.stop();}
});

test('a locked or unsaved device keeps its baseline and gets the account-changed lock (pull only)', async () => {
  // Locked: signed out with a baseline of the ChatGPT account.
  {
    const api = server({sitesUser: null}), account = await api.addAccount('yuha_home'), state = library();
    api.setLibrary(account.ownerId, library('가족 클라우드'));
    const storage = memoryStorage(await baseline(state)), {sync} = client(api, {state, storage});
    try {
      await sync.start();
      assert.equal(sync.getStatus().phase, 'signed-out');
      assert.equal((await sync.familyLogin({username: 'yuha_home', password: PASSWORD})).ok, true);
      assert.equal(sync.getStatus().phase, 'account-changed');
      assert.equal(sync.getStatus().canPush, false);
      assert.equal(storedBaseline(storage).accountId, CHATGPT.id);
      assert.equal(writes(api).length, 0);
    } finally {sync.stop();}
  }
  // Unlocked but with unsaved local changes.
  {
    const api = server({sitesUser: CHATGPT});
    await api.addAccount('yuha_home');
    const {sync, local, storage} = await savedChatGptDevice(api);
    try {
      local.state = {...local.state, characters: [{id: 'child', name: '유하 편집'}]};
      sync.changed();
      assert.equal(sync.getStatus().dirty, true);
      assert.equal((await sync.familyLogin({username: 'yuha_home', password: PASSWORD})).ok, true);
      assert.equal(sync.getStatus().phase, 'account-changed');
      assert.equal(storedBaseline(storage).accountId, CHATGPT.id);
      assert.equal(writes(api).length, 0);
      await assert.rejects(sync.push({force: true}), {code: 'ACCOUNT_CHANGED'});
    } finally {sync.stop();}
  }
});

test('account changes are refused while FULL AUTO runs in this tab or holds a lock in another tab', async () => {
  const held = {query: async () => ({held: [{name: 'donghwa-full-auto-auto-0123456789'}]})};
  for (const options of [{isAutoRunning: () => true}, {locks: held}]) {
    const api = server({sitesUser: CHATGPT}), account = await api.addAccount('yuha_home'), {sync, local, storage} = await savedChatGptDevice(api, options);
    try {
      const status = sync.getStatus(), before = api.calls.length, changes = local.changes.length;
      const refused = {ok: false, code: 'auto_running', message: '자동 만들기가 끝난 뒤 계정을 바꿔 주세요.'};
      assert.deepEqual(await sync.familyLogin({username: 'yuha_home', password: PASSWORD}), refused);
      assert.deepEqual(await sync.familySignup({username: 'new_family', password: PASSWORD, inviteCode: api.invite}), refused);
      assert.deepEqual(await sync.familyRecover({username: 'yuha_home', recoveryCode: account.recoveryCode, newPassword: 'another-pass-77'}), refused);
      writeFamilySession(storage, {token: api.addSession(account), ownerId: account.ownerId, username: 'yuha_home'});
      assert.deepEqual(await sync.familyLogout(), refused);
      assert.deepEqual(await sync.continueLocalOnly(), refused);
      assert.deepEqual(await sync.checkAccountSwitch(), refused);
      assert.equal(api.calls.length, before, 'no auth request was made');
      assert.ok(readFamilySession(storage), 'the session is kept');
      assert.deepEqual(sync.getStatus(), status);
      assert.equal(local.changes.length, changes);
    } finally {sync.stop();}
  }
});

test('a storage event for the family session in another tab triggers a refresh and follows its carry decision', async () => {
  const target = new EventTarget(), api = server({sitesUser: CHATGPT}), account = await api.addAccount('yuha_home');
  const {sync, storage} = await savedChatGptDevice(api, {eventTarget: target});
  try {
    const sessions = () => api.calls.filter(call => call.path === '/session').length, before = sessions();
    target.dispatchEvent(Object.assign(new Event('storage'), {key: 'unrelated-key'}));
    await sleep(10);
    assert.equal(sessions(), before);
    // Another tab signed in to the family account and dropped the shared baseline.
    writeFamilySession(storage, {token: api.addSession(account), ownerId: account.ownerId, username: 'yuha_home'});
    storage.removeItem(CLOUD_SYNC_STORAGE_KEY);
    target.dispatchEvent(Object.assign(new Event('storage'), {key: FAMILY_SESSION_KEY}));
    await until(() => sync.getStatus().phase === 'choice' && !sync.getStatus().busy, 'choice after the other tab signed in');
    assert.ok(sessions() > before);
    assert.equal(sync.getStatus().user.id, account.ownerId);
    // Another tab signed out: this tab re-checks and is signed out too.
    clearFamilySession(storage);
    api.sitesUser = null;
    target.dispatchEvent(Object.assign(new Event('storage'), {key: FAMILY_SESSION_KEY}));
    await until(() => sync.getStatus().phase === 'signed-out', 'signed out after the other tab signed out');
    assert.equal(writes(api).length, 0);
  } finally {sync.stop();}
  target.dispatchEvent(Object.assign(new Event('storage'), {key: FAMILY_SESSION_KEY}));
  assert.equal(sync.getStatus().phase, 'stopped', 'stop() removes the listener');
});

test('continueLocalOnly unlocks a locked device by forgetting only its cloud baseline', async () => {
  // Signed out with a baseline (the app locks this device).
  {
    const api = server({sitesUser: null}), state = library();
    api.setLibrary(CHATGPT.id, library('클라우드'));
    const storage = memoryStorage(await baseline(state)), {sync, local} = client(api, {state, storage});
    try {
      await sync.start();
      assert.equal(sync.getStatus().phase, 'signed-out');
      assert.deepEqual(await sync.continueLocalOnly(), {ok: true});
      assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY), null);
      assert.equal(sync.getStatus().phase, 'signed-out');
      assert.equal(local.state.characters[0].name, '유하', 'the device library is untouched');
      // Signing in later offers the usual source choice instead of the account-changed lock.
      api.sitesUser = CHATGPT;
      await sync.refresh();
      assert.equal(sync.getStatus().phase, 'choice');
      assert.equal(sync.getStatus().reason, 'choose-source');
      assert.equal(writes(api).length, 0);
    } finally {sync.stop();}
  }
  // Account changed: signed in to a family account while holding the ChatGPT baseline.
  {
    const api = server({sitesUser: null}), account = await api.addAccount('yuha_home'), state = library();
    const storage = memoryStorage({...(await baseline(state)), [FAMILY_SESSION_KEY]: JSON.stringify({token: api.addSession(account), ownerId: account.ownerId, username: 'yuha_home', displayName: ''})});
    const {sync} = client(api, {state, storage});
    try {
      await sync.start();
      assert.equal(sync.getStatus().phase, 'account-changed');
      assert.deepEqual(await sync.continueLocalOnly(), {ok: true});
      assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY), null);
      assert.equal(sync.getStatus().phase, 'choice');
      assert.equal(sync.getStatus().reason, 'initial-upload');
      assert.equal(writes(api).length, 0);
    } finally {sync.stop();}
  }
});

test('deleting the family account clears the session and that account\'s baseline; the device keeps its books', async () => {
  const api = server({sitesUser: null}), account = await api.addAccount('yuha_home'), state = library();
  api.setLibrary(account.ownerId, state);
  const token = api.addSession(account);
  const storage = memoryStorage({...(await baseline(state, 1, account.ownerId)), [FAMILY_SESSION_KEY]: JSON.stringify({token, ownerId: account.ownerId, username: 'yuha_home', displayName: ''})});
  const {sync, local} = client(api, {state, storage});
  try {
    await sync.start();
    assert.equal(sync.getStatus().phase, 'ready');
    const quiet = api.calls.length;
    assert.equal((await sync.familyDeleteAccount({password: PASSWORD, confirm: '삭 제'})).code, 'confirm_required');
    assert.equal(api.calls.length, quiet);
    const status = sync.getStatus();
    assert.equal((await sync.familyDeleteAccount({password: 'wrong-password-1'})).code, 'invalid_credentials');
    assert.deepEqual(sync.getStatus(), status);
    assert.deepEqual(await sync.familyDeleteAccount({password: PASSWORD}), {ok: true, deleted: true});
    const call = api.calls.filter(item => item.path === '/auth/delete').at(-1);
    assert.equal(api.accounts.size, 0);
    assert.equal(call.headers.get('X-Family-Session'), token);
    assert.equal(call.headers.get('X-Cloud-Account-ID'), account.ownerId);
    assert.deepEqual(JSON.parse(call.body), {passwordKey: account.passwordKey, confirm: '삭제'});
    assert.equal(readFamilySession(storage), null);
    assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY), null);
    assert.equal(sync.getStatus().phase, 'signed-out');
    assert.equal(local.state.characters[0].name, '유하');
    assert.equal(writes(api).length, 0);
  } finally {sync.stop();}
});

test('logout clears the session best effort and keeps the device library and its baseline', async () => {
  const api = server({sitesUser: null}), account = await api.addAccount('yuha_home'), state = library();
  api.setLibrary(account.ownerId, state);
  const token = api.addSession(account);
  const storage = memoryStorage({...(await baseline(state, 1, account.ownerId)), [FAMILY_SESSION_KEY]: JSON.stringify({token, ownerId: account.ownerId, username: 'yuha_home', displayName: ''})});
  const {sync} = client(api, {state, storage});
  try {
    await sync.start();
    assert.equal(sync.getStatus().user.kind, 'family');
    assert.deepEqual(await sync.familyLogout(), {ok: true});
    const call = api.calls.find(item => item.path === '/auth/logout');
    assert.equal(call.headers.get('X-Family-Session'), token);
    assert.equal(call.options.keepalive, true);
    assert.equal(api.sessions.has(token), false);
    assert.equal(readFamilySession(storage), null);
    assert.equal(sync.getStatus().phase, 'signed-out');
    assert.equal(storedBaseline(storage).accountId, account.ownerId, 'locked as today, not wiped');
    // Even when the server cannot be reached the device is signed out.
    writeFamilySession(storage, {token: api.addSession(account), ownerId: account.ownerId, username: 'yuha_home'});
    api.intercept = async call => {if (call.path === '/auth/logout') throw new TypeError('offline');};
    assert.deepEqual(await sync.familyLogout(), {ok: true});
    assert.equal(readFamilySession(storage), null);
  } finally {sync.stop();}
});

test('sign-up returns a formatted one-time recovery code that is never stored; refusals map to Korean messages', async () => {
  const api = server({sitesUser: null}), {sync, storage} = client(api);
  try {
    await sync.start();
    const result = await sync.familySignup({username: 'Yuha_Home', password: PASSWORD, inviteCode: '  family-invite-2026 ', displayName: ' 유하네 '});
    assert.equal(result.ok, true);
    assert.match(result.recoveryCode, /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
    const account = api.accounts.get('yuha_home');
    assert.equal(result.recoveryCode, formatRecoveryCode(account.recoveryCode));
    assert.equal(account.displayName, '유하네');
    const body = JSON.parse(api.calls.find(call => call.path === '/auth/signup').body);
    assert.deepEqual(body, {username: 'yuha_home', passwordKey: await fastKey('yuha_home', PASSWORD), inviteCode: 'family-invite-2026', displayName: '유하네'});
    for (const value of storage.values.values())
      for (const secret of [PASSWORD, body.passwordKey, account.recoveryCode, result.recoveryCode]) assert.ok(!value.includes(secret), 'no secret in storage');
    assert.ok(api.calls.every(call => !String(call.body || '').includes(PASSWORD)), 'the password never leaves the page');
    assert.equal(sync.getStatus().user.username, 'yuha_home');
    assert.equal(sync.getStatus().phase, 'choice');
    // Refusals.
    const taken = await sync.familySignup({username: 'yuha_home', password: PASSWORD, inviteCode: api.invite});
    assert.equal(taken.code, 'username_taken');
    assert.equal(taken.message, '이미 있는 아이디예요. 로그인하거나 다른 아이디를 써 주세요.');
    assert.equal((await sync.familySignup({username: 'other_home', password: PASSWORD, inviteCode: 'wrong'})).message, '가족 초대 코드가 맞지 않아요.');
    assert.equal((await sync.familySignup({username: 'other_home', password: PASSWORD, inviteCode: ''})).code, 'invite_empty');
    api.signupOpen = false;
    assert.equal((await sync.familySignup({username: 'other_home', password: PASSWORD, inviteCode: api.invite})).message, '가족 계정 만들기가 아직 열리지 않았어요. 사이트 관리자에게 가족 초대 코드를 받아 주세요.');
    api.loginLimited = true;
    const limited = await sync.familyLogin({username: 'yuha_home', password: PASSWORD});
    assert.deepEqual([limited.code, limited.message, limited.retryAfter], ['too_many_attempts', '시도가 너무 많아요. 10분 뒤 다시 해 주세요.', 600]);
    assert.equal(sync.getStatus().user.username, 'yuha_home', 'a refused sign-in keeps the current account');
  } finally {sync.stop();}
});

test('recovery sends the normalized code, signs in with the new password and hands out a new code', async () => {
  const api = server({sitesUser: null}), account = await api.addAccount('yuha_home', PASSWORD, {recoveryCode: 'AB01CD01EF01GH01JK01'});
  const {sync, storage} = client(api);
  try {
    await sync.start();
    assert.equal((await sync.familyRecover({username: 'yuha_home', recoveryCode: 'ab0l cdol-ef01', newPassword: 'fresh-start-77'})).code, 'recovery_format');
    assert.equal((await sync.familyRecover({username: 'yuha_home', recoveryCode: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: 'fresh-start-77'})).message, '아이디나 복구 코드가 맞지 않아요.');
    const result = await sync.familyRecover({username: 'yuha_home', recoveryCode: 'ab0l-cdOI ef0l-gh01-jk0l', newPassword: 'fresh-start-77'});
    assert.equal(result.ok, true);
    const sent = JSON.parse(api.calls.filter(call => call.path === '/auth/recover').at(-1).body);
    assert.equal(sent.recoveryCode, 'AB01CD01EF01GH01JK01');
    assert.equal(sent.newPasswordKey, await fastKey('yuha_home', 'fresh-start-77'));
    assert.notEqual(result.recoveryCode, 'AB01-CD01-EF01-GH01-JK01');
    assert.equal(result.recoveryCode, formatRecoveryCode(account.recoveryCode));
    assert.equal(readFamilySession(storage).username, 'yuha_home');
    assert.equal(sync.getStatus().user.id, account.ownerId);
  } finally {sync.stop();}
});

test('changing the password swaps in the new token and keeps the account connected', async () => {
  const api = server({sitesUser: null}), account = await api.addAccount('yuha_home'), state = library();
  api.setLibrary(account.ownerId, state);
  const oldToken = api.addSession(account), otherDevice = api.addSession(account);
  const storage = memoryStorage({...(await baseline(state, 1, account.ownerId)), [FAMILY_SESSION_KEY]: JSON.stringify({token: oldToken, ownerId: account.ownerId, username: 'yuha_home', displayName: ''})});
  const {sync} = client(api, {state, storage});
  try {
    await sync.start();
    const status = sync.getStatus();
    assert.equal((await sync.familyChangePassword({currentPassword: 'wrong-current-1', newPassword: 'new-password-88'})).code, 'invalid_credentials');
    assert.deepEqual(sync.getStatus(), status);
    assert.equal(readFamilySession(storage).token, oldToken);
    assert.equal((await sync.familyChangePassword({currentPassword: PASSWORD, newPassword: PASSWORD})).code, 'password_same');
    assert.deepEqual(await sync.familyChangePassword({currentPassword: PASSWORD, newPassword: 'new-password-88', signOutOthers: false}), {ok: true});
    const call = api.calls.filter(item => item.path === '/auth/password').at(-1);
    assert.equal(call.headers.get('X-Cloud-Account-ID'), account.ownerId);
    assert.equal(call.headers.get('X-Family-Session'), oldToken);
    assert.deepEqual(JSON.parse(call.body), {currentPasswordKey: await fastKey('yuha_home', PASSWORD), newPasswordKey: await fastKey('yuha_home', 'new-password-88'), signOutOthers: false});
    const newToken = readFamilySession(storage).token;
    assert.notEqual(newToken, oldToken);
    assert.equal(api.sessions.has(oldToken), false);
    assert.equal(api.sessions.has(otherDevice), true, 'other devices stay signed in unless asked');
    assert.equal(sync.getStatus().phase, 'ready');
    assert.equal(sync.getStatus().user.id, account.ownerId);
    assert.equal(writes(api).length, 0);
    // A ChatGPT session cannot change a family password.
    clearFamilySession(storage);
    assert.equal((await sync.familyChangePassword({currentPassword: PASSWORD, newPassword: 'x-new-password-1'})).code, 'family_only');
  } finally {sync.stop();}
});

test('a refused family token reads as family-session-expired and never falls back to the ChatGPT account', async () => {
  const api = server({sitesUser: CHATGPT}), storage = memoryStorage({[FAMILY_SESSION_KEY]: JSON.stringify({token: newToken(), ownerId: 'family:gone', username: 'yuha_home', displayName: ''})});
  const {sync} = client(api, {storage});
  try {
    await sync.start();
    assert.equal(sync.getStatus().phase, 'signed-out');
    assert.equal(sync.getStatus().reason, 'family-session-expired');
    assert.equal(sync.getStatus().authenticated, false);
    assert.equal(sync.getFamilySession().username, 'yuha_home', 'the login form can offer the same username');
    assert.equal('token' in sync.getFamilySession(), false);
  } finally {sync.stop();}
});

test('full-auto-control sends X-Family-Session on cloud stop requests and polling', async () => {
  const id = 'auto-family-control-0001', token = newToken(), requests = [];
  const storage = memoryStorage({[FAMILY_SESSION_KEY]: JSON.stringify({token, ownerId: 'family:abc-123', username: 'yuha_home', displayName: ''})});
  let remote = null, tick;
  const fetchImpl = async (url, options) => {requests.push({url, options}); if (options.method === 'POST') remote = {nonce: JSON.parse(options.body).nonce, requestedAt: 'now'}; return Response.json({jobId: id, stop: remote});};
  const watcher = createAutoStopWatcher(id, {accountId: 'family:abc-123', storage, fetchImpl, onStop: () => {}, setIntervalImpl: fn => (tick = fn, 1), clearIntervalImpl: () => {}});
  await watcher.start();
  await requestAutoStop(id, {accountId: 'family:abc-123', storage, fetchImpl});
  await tick();
  watcher.close();
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.options.headers['X-Family-Session'] === token && request.options.headers['X-Cloud-Account-ID'] === 'family:abc-123'));
  const plain = [];
  await requestAutoStop(id, {accountId: 'owner-A', storage: memoryStorage(), fetchImpl: async (url, options) => {plain.push(options); return Response.json({jobId: id, stop: null});}});
  assert.equal('X-Family-Session' in plain[0].headers, false);
});
