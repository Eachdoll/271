// Cloudflare Worker: request-scoped D1/R2 bindings; no third-party runtime packages.
import { database } from './storage.mjs';
import { buildReport } from './reports.mjs';
const SESSION_DAYS = 30;
const MAX_BODY = 30 * 1024 * 1024;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));

export function createApp(env) {
const db = database(env.DB);
async function getSetting(k) { const r = (await db.prepare('SELECT value FROM settings WHERE key=?').get(k)); return r ? r.value : (k === 'invite_code' ? env.INVITE_CODE || null : null); }
async function setSetting(k, v) { (await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v))); }

// ───────────────────────── 공통 ─────────────────────────
const ROLES = ['purchase', 'quality', 'quality_approver', 'dev', 'dev_approver', 'production', 'logistics'];
const REQUEST_TYPES = { analysis: 'quality', development: 'dev', sample: 'production' };
const REQUEST_PREFIX = { analysis: 'Q', development: 'D', sample: 'S' };
const ANALYSIS_CATEGORIES = ['수입검사', '의뢰검사', '출하검사', '공정검사'];
const WORK_STATUSES = ['waiting', 'progress', 'done'];
const ITEM_CATEGORIES = ['제품', '상품', '원자재', '부자재'];
function itemCategory(value) {
  if (!ITEM_CATEGORIES.includes(value)) throw bad('품목 분류를 선택하세요.');
  return value;
}
function checked(value) {
  if (Array.isArray(value)) return value.some(v => ['1', 'on', true, 1].includes(v)) ? 1 : 0;
  if (['1', 'on', true, 1].includes(value)) return 1;
  if ([undefined, null, '', '0', false, 0].includes(value)) return 0;
  throw bad('COA 요청 여부가 올바르지 않습니다.');
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256)));
}
async function pwMatches(user, pw) {
  const a = await hashPw(pw, user.pw_salt); const b = user.pw_hash;
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function str(v, max = 500) { return v == null ? '' : String(v).trim().slice(0, max); }
function reqStr(v, label, max) { const s = str(v, max); if (!s) throw bad(`${label}을(를) 입력하세요.`); return s; }
function num(v, label, { required = true } = {}) {
  if (v === '' || v == null) { if (required) throw bad(`${label}을(를) 입력하세요.`); return null; }
  const n = Number(v); if (!Number.isFinite(n) || n < 0) throw bad(`${label}은(는) 0 이상의 숫자여야 합니다.`); return n;
}
function dateStr(v, label, { required = true } = {}) {
  const s = str(v, 10);
  if (!s) { if (required) throw bad(`${label}을(를) 입력하세요.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw bad(`${label} 형식이 올바르지 않습니다.`);
  return s;
}
function listFilterDate(value, label) {
  if (!value) return '';
  const date = new Date(String(value) + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw bad(label + '을 확인하세요.');
  return value;
}
function applyListDates(where, args, query, column) {
  const from = listFilterDate(query.from, '시작일'), to = listFilterDate(query.to, '종료일');
  if (from && to && from > to) throw bad('시작일은 종료일 이전이어야 합니다.');
  if (from) { where.push(column + '>=?'); args.push(from); }
  if (to) { where.push(column + '<=?'); args.push(to); }
}
function applyListKeyword(where, args, value, columns) {
  const q = String(value || '').trim(); if (!q) return;
  if (q.length > 200) throw bad('검색어는 200자까지 입력하세요.');
  const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  where.push('(' + columns.map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
  args.push(...columns.map(() => pattern));
}
function applyInspectionFilter(where, args, query, entity, table) {
  if (!query.inspection_status) return;
  if (!['unchecked', 'normal', 'abnormal'].includes(query.inspection_status)) throw bad('검수 상태를 확인하세요.');
  where.push(`COALESCE((SELECT a.inspection_status FROM attachments a WHERE a.entity_type='${entity}' AND a.entity_id=${table}.id),'unchecked')=?`);
  args.push(query.inspection_status);
}
function now() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()); }
function today() { return now().slice(0, 10); }
function publicUser(u) { return { id: u.id, name: u.name, is_admin: !!u.is_admin, roles: u.roles ? u.roles.split(',').filter(Boolean) : [], created_at: u.created_at, approval_status: u.approval_status, approval_note: u.approval_note, reviewed_by: u.reviewed_by, reviewed_at: u.reviewed_at }; }
function hasRole(user, role) { const roles = publicUser(user).roles; return !!user.is_admin || roles.includes(role) || (['quality','dev'].includes(role) && roles.includes(role + '_approver')); }
function requireRequestApprover(user, type) {
  const role = { analysis: 'quality_approver', development: 'dev_approver', sample: 'production' }[type];
  const label = { analysis: '품질책임자', development: '개발책임자', sample: '생산담당자' }[type];
  if (!hasRole(user, role)) throw new HttpError(403, `${label}(승인권자)만 승인·반려할 수 있습니다. 관리자에게 책임자 지정을 요청하세요.`);
}
function requireRole(user, role, label) { if (!hasRole(user, role)) throw new HttpError(403, `${label} 담당자만 할 수 있습니다. (관리자에게 권한 요청)`); }
function requireAdmin(user) { if (!user.is_admin) throw new HttpError(403, '관리자만 할 수 있습니다.'); }
function canModify(user, row) { return user.is_admin || row.created_by === user.name; }

// 사진 저장: 검증된 data URL → 비공개 R2 객체
async function savePhotos(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > 10) throw bad('사진은 최대 10장까지 올릴 수 있습니다.');
  const photos = list.map(d => {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(d));
    if (!m) throw bad('사진 형식이 올바르지 않습니다. (jpg/png/webp)');
    let bytes; try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); } catch { throw bad('사진 형식이 올바르지 않습니다.'); }
    if (bytes.length > 8 * 1024 * 1024) throw bad('사진 한 장은 8MB 이하여야 합니다.');
    return { file: randomHex(12) + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]), bytes, type: 'image/' + m[1] };
  });
  const saved = [];
  try {
    for (const p of photos) { await env.BUCKET.put(p.file, p.bytes, { httpMetadata: { contentType: p.type } }); saved.push(p.file); }
    return saved;
  } catch (error) { await removePhotos(saved); throw error; }
}
async function removePhotos(files) {
  for (const f of files || []) if (/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(f)) await env.BUCKET.delete(f);
}

const attachmentTables = { request: 'requests', purchase_order: 'purchase_orders', other_receipt: 'other_receipts', shipment: 'shipments' };
function attachmentSummary(entity, table) {
  return `COALESCE((SELECT inspection_status FROM attachments a WHERE a.entity_type='${entity}' AND a.entity_id=${table}.id),'unchecked') AS inspection_status,
    COALESCE((SELECT json_array_length(photos) FROM attachments a WHERE a.entity_type='${entity}' AND a.entity_id=${table}.id),0) AS photo_count`;
}
async function attachmentEntity(type, id, user, write = false) {
  const table = attachmentTables[type];
  if (!Object.hasOwn(attachmentTables, type) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw bad('첨부 대상을 확인하세요.');
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(Number(id));
  if (!row) {
    // Incoming inspection evidence remains readable after the original receipt is removed.
    if (!write && ['purchase_order', 'other_receipt'].includes(type) && await db.prepare('SELECT 1 FROM requests WHERE source_type=? AND source_id=?').get(type, Number(id))) return;
    throw new HttpError(404, '첨부할 기록을 찾을 수 없습니다.');
  }
  if (type === 'request' && !['development','sample'].includes(row.type)) throw bad('개발·샘플 의뢰서에 사진을 첨부할 수 있습니다.');
  if (write) {
    if (type === 'request') {
      if (!(hasRole(user, REQUEST_TYPES[row.type]) || (row.requester_id === user.id && ['pending','rejected'].includes(row.status)))) throw new HttpError(403, '의뢰자 또는 담당자만 사진을 변경할 수 있습니다.');
    } else if (type !== 'purchase_order' && !canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 사진·검수 기록을 변경할 수 있습니다.');
  }
  return row;
}
function decodeAttachment(row) {
  return row ? { ...row, photos: JSON.parse(row.photos) } : { photos: [], inspection_status: 'unchecked', note: '', revision: 0, updated_by: null, updated_at: null };
}
async function deleteEntityWithAttachments(type, table, id) {
  const record = await db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=?').get(type, id);
  const preserve = ['purchase_order','other_receipt'].includes(type) && await db.prepare('SELECT 1 FROM requests WHERE source_type=? AND source_id=?').get(type, id);
  const queries = [{ sql: `DELETE FROM ${table} WHERE id=?`, args: [id] }];
  if (!preserve) queries.push({ sql: 'DELETE FROM attachments WHERE entity_type=? AND entity_id=?', args: [type, id] });
  await db.batch(queries);
  if (record && !preserve) await removePhotos(JSON.parse(record.photos));
}

// ───────────────────────── 인증 ─────────────────────────
// Login throttling is persisted in D1 across Worker instances.
function parseCookies(req) {
  const out = {}; for (const part of (req.headers.get('cookie') || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } return out;
}
async function currentUser(req) {
  const token = sessionToken(req); if (!token) return null;
  const row = (await db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.approval_status='approved'").get(token, Date.now()));
  return row || null;
}
async function startSession(req, res, userId) {
  const token = randomHex(32);
  (await db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, Date.now() + SESSION_DAYS * 864e5));
  (await db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()));
  res.set('Set-Cookie', `wpa_sid=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; ${sessionCookiePolicy(req)}`);
}

// Sites may render inside ChatGPT/Codex. CHIPS keeps the HttpOnly session
// available in that embedded context even when third-party cookies are blocked.
function sessionCookiePolicy(req) {
  return new URL(req.url).protocol === 'https:'
    ? 'SameSite=None; Secure; Partitioned'
    : 'SameSite=Lax';
}
function sessionToken(req) {
  const cookies = parseCookies(req);
  return cookies.wpa_sid || cookies.sid;
}

// ───────────────────────── 라우터 ─────────────────────────
const routes = [];
function route(method, pattern, handler, { auth = true } = {}) {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
}

// 인증
// Append-only discussion history, independent from workflow status and result notes.
const COMMENT_TABLES = { purchase_order: 'purchase_orders', request: 'requests', other_receipt: 'other_receipts', shipment: 'shipments', schedule: 'schedules', laundry: 'laundry', bom: 'boms' };
async function commentEntity(user, entity, id) {
  if (!Object.hasOwn(COMMENT_TABLES, entity)) throw bad('코멘트를 남길 목록이 올바르지 않습니다.');
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw bad('항목 번호가 올바르지 않습니다.');
  const row = await mustGet(COMMENT_TABLES[entity], Number(id));
  if (entity === 'bom' && !row.active && !user.is_admin) throw new HttpError(403, '사용 중지된 BOM은 관리자만 조회할 수 있습니다.');
  return row;
}
route('GET', '/api/comments/:entity/:id', async ({ user, params, query }) => {
  await commentEntity(user, params.entity, params.id);
  if (query.before !== undefined && (!/^[1-9]\d*$/.test(query.before) || !Number.isSafeInteger(Number(query.before)))) throw bad('코멘트 조회 위치가 올바르지 않습니다.');
  const args = [params.entity, Number(params.id)];
  if (query.before) args.push(Number(query.before));
  const rows = await db.prepare(`SELECT id,content,author_id,author_name,created_at FROM progress_comments WHERE entity_type=? AND entity_id=? ${query.before ? 'AND id<?' : ''} ORDER BY id DESC LIMIT 51`).all(...args);
  const more = rows.length > 50; const page = rows.slice(0, 50);
  return { rows: page, next: more ? page.at(-1).id : null };
});
route('POST', '/api/comments/:entity/:id', async ({ user, params, body }) => {
  await commentEntity(user, params.entity, params.id);
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.trim().length > 2000) throw bad('코멘트는 1~2,000자로 입력하세요.');
  const result = await db.prepare('INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)').run(params.entity, Number(params.id), body.content.trim(), user.id, user.name);
  return db.prepare('SELECT id,content,author_id,author_name,created_at FROM progress_comments WHERE id=?').get(result.lastInsertRowid);
});

route('GET', '/api/attachments/:entity/:id', async ({ user, params }) => {
  await attachmentEntity(params.entity, params.id, user);
  return decodeAttachment(await db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=?').get(params.entity, Number(params.id)));
});
route('PUT', '/api/attachments/:entity/:id', async ({ user, params, body }) => {
  await attachmentEntity(params.entity, params.id, user, true);
  const current = decodeAttachment(await db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=?').get(params.entity, Number(params.id)));
  if (body.revision !== undefined && Number(body.revision) !== current.revision) throw new HttpError(409, '사진 기록이 변경되었습니다. 다시 열어 확인하세요.');
  const keep = body.keep_photos === undefined ? current.photos : body.keep_photos;
  if (!Array.isArray(keep) || new Set(keep).size !== keep.length || keep.some(file => !current.photos.includes(file))) throw bad('유지할 사진을 다시 확인하세요.');
  if (body.photos !== undefined && !Array.isArray(body.photos)) throw bad('첨부 사진 형식을 확인하세요.');
  if (keep.length + (body.photos || []).length > 10) throw bad('사진은 최대 10장까지 첨부할 수 있습니다.');
  const status = body.inspection_status ?? current.inspection_status;
  if (!['unchecked','normal','abnormal'].includes(status)) throw bad('이상 여부를 확인하세요.');
  const note = body.note === undefined ? current.note : str(body.note, 1000);
  const added = await savePhotos(body.photos);
  try {
    const result = await db.prepare(`INSERT INTO attachments(entity_type,entity_id,photos,inspection_status,note,revision,updated_by)
      VALUES(?,?,?,?,?,1,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET
      photos=excluded.photos,inspection_status=excluded.inspection_status,note=excluded.note,revision=attachments.revision+1,
      updated_by=excluded.updated_by,updated_at=datetime('now','+9 hours') WHERE attachments.revision=?`)
      .run(params.entity, Number(params.id), JSON.stringify(keep.concat(added)), status, note, user.name, current.revision);
    if (!result.changes) throw new HttpError(409, '다른 사용자가 사진 기록을 변경했습니다. 다시 열어 확인하세요.');
  } catch (error) { await removePhotos(added); throw error; }
  await removePhotos(current.photos.filter(file => !keep.includes(file)));
  return decodeAttachment(await db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=?').get(params.entity, Number(params.id)));
});

route('POST', '/api/auth/register', async ({ body, req, res }) => {
  const name = reqStr(body.name, '이름', 30);
  const password = String(body.password || '');
  if (password.length < 4) throw bad('비밀번호는 4자 이상이어야 합니다.');
  if (str(body.invite, 100) !== (await getSetting('invite_code'))) throw bad('초대코드가 올바르지 않습니다.');
  await db.prepare("INSERT INTO settings(key,value) VALUES('invite_code',?) ON CONFLICT(key) DO NOTHING").run(await getSetting('invite_code'));
  if ((await db.prepare('SELECT 1 FROM users WHERE name=?').get(name))) throw bad('이미 가입된 이름입니다. 로그인하세요.');
  const salt = randomHex(16);
  const r = await db.prepare("INSERT INTO users(name,pw_salt,pw_hash,is_admin,approval_status) SELECT ?,?,?,NOT EXISTS(SELECT 1 FROM users),CASE WHEN EXISTS(SELECT 1 FROM users) THEN 'pending' ELSE 'approved' END").run(name, salt, await hashPw(password, salt));
  const account = await db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
  if (account.approval_status !== 'approved') return { user: null, pending: true, account: { id: account.id, name: account.name, approval_status: account.approval_status } };
  await startSession(req, res, account.id);
  return { user: publicUser(account) };
}, { auth: false });

route('POST', '/api/auth/login', async ({ body, req, res }) => {
  const name = reqStr(body.name, '이름', 30);
  const f = await db.prepare('SELECT failures AS n, until_at AS until FROM login_attempts WHERE name=?').get(name);
  if (f && f.until > Date.now()) throw new HttpError(429, '로그인 시도가 많습니다. 1분 후 다시 시도하세요.');
  const u = (await db.prepare('SELECT * FROM users WHERE name=?').get(name));
  if (!u || !(await pwMatches(u, body.password || ''))) {
    const n = (f && f.until > Date.now() - 60000 ? f.n : 0) + 1;
    await db.prepare('INSERT INTO login_attempts(name,failures,until_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET failures=excluded.failures, until_at=excluded.until_at').run(name, n, n >= 5 ? Date.now() + 60000 : Date.now());
    throw new HttpError(401, '이름 또는 비밀번호가 올바르지 않습니다.');
  }
  await db.prepare('DELETE FROM login_attempts WHERE name=?').run(name);
  if (u.approval_status === 'pending') throw new HttpError(403, '관리자 승인 대기 중입니다. 승인 후 로그인해 주세요.');
  if (u.approval_status !== 'approved') throw new HttpError(403, '가입이 반려되었습니다. 관리자에게 문의하세요.' + (u.approval_note ? ' 사유: ' + u.approval_note : ''));
  (await startSession(req, res, u.id));
  return { user: publicUser(u) };
}, { auth: false });

route('POST', '/api/auth/logout', async ({ req, res }) => {
  const t = sessionToken(req); if (t) (await db.prepare('DELETE FROM sessions WHERE token=?').run(t));
  res.append('Set-Cookie', `wpa_sid=; HttpOnly; Path=/; Max-Age=0; ${sessionCookiePolicy(req)}`);
  res.append('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  return { ok: true };
}, { auth: false });

route('GET', '/api/me', async ({ req }) => { const u = (await currentUser(req)); return { user: u ? publicUser(u) : null }; }, { auth: false });

route('PUT', '/api/me/password', async ({ user, body }) => {
  if (!(await pwMatches(user, body.current || ''))) throw bad('현재 비밀번호가 올바르지 않습니다.');
  if (String(body.password || '').length < 4) throw bad('새 비밀번호는 4자 이상이어야 합니다.');
  const salt = randomHex(16);
  (await db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').run(salt, (await hashPw(body.password, salt)), user.id));
  return { ok: true };
});

// 관리자
route('GET', '/api/admin/settings', async ({ user }) => { requireAdmin(user); return { invite_code: (await getSetting('invite_code')) }; });
route('PUT', '/api/admin/invite', async ({ user, body }) => {
  requireAdmin(user);
  const code = reqStr(body.invite_code, '초대코드', 100);
  if (code.length < 4) throw bad('초대코드는 4자 이상으로 정하세요.');
  (await setSetting('invite_code', code)); return { invite_code: code };
});
route('GET', '/api/approval-managers', async () => {
  const users = await db.prepare("SELECT id,name,is_admin,roles FROM users WHERE approval_status='approved' ORDER BY id").all();
  return {
    analysis: users.filter(u => (u.roles || '').split(',').includes('quality_approver')).map(u => ({ id: u.id, name: u.name })),
    development: users.filter(u => (u.roles || '').split(',').includes('dev_approver')).map(u => ({ id: u.id, name: u.name })),
  };
});
route('GET', '/api/admin/users', async ({ user }) => { requireAdmin(user); return (await db.prepare('SELECT * FROM users ORDER BY id').all()).map(publicUser); });
route('POST', '/api/admin/users/:id/approval', async ({ user, params, body }) => {
  requireAdmin(user);
  const target = await db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
  if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  if (!['approved', 'rejected'].includes(body.status)) throw bad('승인 또는 반려를 선택하세요.');
  if (body.status === 'rejected' && (target.id === user.id || target.is_admin)) throw bad('관리자 계정은 반려할 수 없습니다.');
  const commands = [{ sql: 'UPDATE users SET approval_status=?,approval_note=?,reviewed_by=?,reviewed_at=? WHERE id=?', args: [body.status, str(body.note, 500), user.name, now(), target.id] }];
  if (body.status === 'rejected') commands.push({ sql: 'DELETE FROM sessions WHERE user_id=?', args: [target.id] });
  await db.batch(commands);
  return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(target.id));
});
route('PUT', '/api/admin/users/:id', async ({ user, params, body }) => {
  requireAdmin(user);
  const target = (await db.prepare('SELECT * FROM users WHERE id=?').get(params.id)); if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  if (body.is_admin && target.approval_status !== 'approved') throw bad('가입 승인 후 관리자 권한을 부여하세요.');
  if (body.roles !== undefined) {
    const roles = [...new Set((Array.isArray(body.roles) ? body.roles : []).filter((r) => ROLES.includes(r)))];
    if (target.approval_status !== 'approved' && roles.some(r => ['quality_approver','dev_approver'].includes(r))) throw bad('가입 승인 후 책임자로 지정하세요.');
    (await db.prepare('UPDATE users SET roles=? WHERE id=?').run(roles.join(','), target.id));
  }
  if (body.is_admin !== undefined) {
    if (target.id === user.id && !body.is_admin) throw bad('자기 자신의 관리자 권한은 해제할 수 없습니다.');
    (await db.prepare('UPDATE users SET is_admin=? WHERE id=?').run(body.is_admin ? 1 : 0, target.id));
  }
  if (body.password) {
    if (String(body.password).length < 4) throw bad('비밀번호는 4자 이상이어야 합니다.');
    const salt = randomHex(16);
    (await db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').run(salt, (await hashPw(body.password, salt)), target.id));
    (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id));
  }
  return publicUser((await db.prepare('SELECT * FROM users WHERE id=?').get(target.id)));
});
route('DELETE', '/api/admin/users/:id', async ({ user, params }) => {
  requireAdmin(user);
  if (Number(params.id) === user.id) throw bad('자기 자신은 삭제할 수 없습니다.');
  (await db.prepare('DELETE FROM users WHERE id=?').run(params.id)); return { ok: true };
});

// Bounded pages keep backups within Worker memory limits. Sessions are omitted.
const backupTables = ['settings', 'users', 'purchase_orders', 'laundry', 'requests', 'schedules', 'shipments', 'other_receipts', 'boms', 'attachments', 'progress_comments'];
route('GET', '/api/admin/backup', async ({ user, query }) => {
  requireAdmin(user);
  if (!query.table) return { format: 'work-process-v2', tables: backupTables };
  if (!backupTables.includes(query.table)) throw bad('백업할 표가 올바르지 않습니다.');
  const key = query.table === 'settings' ? 'key' : 'id';
  const after = key === 'key' ? String(query.after || '') : Number(query.after || 0);
  if (typeof after === 'number' && (!Number.isSafeInteger(after) || after < 0)) throw bad('백업 위치가 올바르지 않습니다.');
  const rows = await db.prepare(`SELECT * FROM ${query.table} WHERE ${key}>? ORDER BY ${key} LIMIT 200`).all(after);
  return { rows, next: rows.length === 200 ? rows.at(-1)[key] : null };
});

// ── 구매: 발주목록 ──
function receiptAnalysisQuery(sourceType, id, user) {
  const purchase = sourceType === 'purchase_order';
  if (!purchase && sourceType !== 'other_receipt') throw new Error('Unknown receipt source');
  const table = purchase ? 'purchase_orders' : 'other_receipts';
  const label = purchase ? '발주입고' : '기타입고';
  const qty = purchase ? 'COALESCE(src.recv_qty, src.qty)' : 'src.qty';
  const coa = purchase ? 'src.coa_requested' : '0';
  const date = purchase ? 'substr(src.recv_at,1,10)' : 'src.received_date';
  const prefix = `Q-${today().slice(2).replace(/-/g, '')}-`;
  return {
    sql: `INSERT INTO requests(type,status,req_no,title,customer,category,data,requester_id,requester_name,approver_name,approved_at,source_type,source_id)
      SELECT 'analysis','waiting',
        ? || printf('%02d', (SELECT COALESCE(MAX(CAST(substr(req_no,length(?) + 1) AS INTEGER)),0)+1 FROM requests WHERE req_no LIKE ?)),
        src.item,src.vendor,'수입검사',
        json_object('purpose','입고 수입검사','sample_qty',CAST(${qty} AS TEXT),
          'source_label',?,'received_date',${date},'item_category',src.item_category,
          'received_qty',${qty},'coa_requested',${coa},
          'purchase_req_no',${purchase ? 'src.req_no' : "''"},
          'bom_id',${purchase ? 'NULL' : 'src.bom_id'},
          'product_code',${purchase ? "''" : "COALESCE(json_extract(src.bom_snapshot,'$.product_code'),'')"},
          'unit',${purchase ? "''" : "COALESCE(json_extract(src.bom_snapshot,'$.unit'),'')"},
          'result_type',CASE WHEN ${coa}=1 THEN 'COA발행' ELSE '기본(데이터공유)' END,'extra',src.note),
        ?,?,'입고 자동접수',datetime('now','+9 hours'),?,src.id
      FROM ${table} src WHERE src.id=${id == null ? 'last_insert_rowid()' : '?'}
        ${purchase ? "AND src.recv_status='ok'" : ''}
        AND NOT EXISTS(SELECT 1 FROM requests WHERE source_type=? AND source_id=src.id)
      ON CONFLICT(source_type,source_id) DO NOTHING`,
    args: [prefix, prefix, prefix + '%', label, user.id, user.name, sourceType, ...(id == null ? [] : [id]), sourceType],
  };
}

function poFields(b) {
  return [reqStr(b.req_no, '구매의뢰번호', 50), reqStr(b.vendor, '거래처', 100), reqStr(b.item, '품목명', 200), num(b.qty, '수량'), dateStr(b.due_date, '납기일'), str(b.note, 500), itemCategory(b.item_category), checked(b.coa_requested)];
}
route('GET', '/api/po', async ({ query }) => {
  const where = []; const args = [];
  applyListKeyword(where, args, query.q, ['req_no','vendor','item','note','created_by','recv_by','recv_note']);
  applyListDates(where, args, query, 'due_date');
  if (query.recv === 'none') where.push("recv_status=''");
  else if (query.recv === 'open') where.push("recv_status IN ('','checking','mismatch')");
  else if (query.recv) { if (!['ok','checking','mismatch'].includes(query.recv)) throw bad('입고 상태를 확인하세요.'); where.push('recv_status=?'); args.push(query.recv); }
  if (query.item_category) { where.push('item_category=?'); args.push(itemCategory(query.item_category)); }
  if (query.coa_requested) { if (!['0','1'].includes(query.coa_requested)) throw bad('COA 요청 조건을 확인하세요.'); where.push('coa_requested=?'); args.push(Number(query.coa_requested)); }
  applyInspectionFilter(where, args, query, 'purchase_order', 'purchase_orders');
  return (await db.prepare(`SELECT purchase_orders.*, ${attachmentSummary('purchase_order','purchase_orders')} FROM purchase_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (recv_status='ok'), due_date, id DESC`).all(...args));
});
route('POST', '/api/po', async ({ user, body }) => {
  const r = (await db.prepare('INSERT INTO purchase_orders(req_no,vendor,item,qty,due_date,note,item_category,coa_requested,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run(...poFields(body), user.name));
  return (await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(r.lastInsertRowid));
});
route('PUT', '/api/po/:id', async ({ user, params, body }) => {
  const row = (await mustGet('purchase_orders', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 수정할 수 있습니다.');
  (await db.prepare('UPDATE purchase_orders SET req_no=?,vendor=?,item=?,qty=?,due_date=?,note=?,item_category=?,coa_requested=? WHERE id=?').run(...poFields(body), row.id));
  return (await mustGet('purchase_orders', row.id));
});
route('DELETE', '/api/po/:id', async ({ user, params }) => {
  const row = (await mustGet('purchase_orders', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 삭제할 수 있습니다.');
  await deleteEntityWithAttachments('purchase_order', 'purchase_orders', row.id); return { ok: true };
});
// ── 물류: 발주입고 확인 (ok=초록, mismatch=빨강, checking=노랑, ''=미입고) ──
route('POST', '/api/po/receive', async ({ user, body }) => {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('입고 처리할 항목을 체크하세요.');
  const status = String(body.status || '');
  if (!['ok', 'mismatch', 'checking', ''].includes(status)) throw bad('상태 값이 올바르지 않습니다.');
  const recvQty = status === 'mismatch' ? num(body.recv_qty, '실입고 수량') : null;
  if (status === 'mismatch' && ids.length !== 1) throw bad('수량상이는 한 항목씩 실입고 수량을 입력하세요.');
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 100) throw bad('입고 처리는 한 번에 100건까지 가능합니다.');
  // Validate every source before executing any writes, then commit one atomic batch.
  const rows = [];
  for (const id of uniqueIds) rows.push(await mustGet('purchase_orders', id));
  const queries = [];
  for (const row of rows) {
    queries.push({ sql: `UPDATE purchase_orders SET recv_status=?,
      recv_qty=CASE WHEN recv_status='ok' AND ?='ok' THEN COALESCE(recv_qty,qty) ELSE ? END,recv_note=?,
      recv_by=CASE WHEN recv_status='ok' AND ?='ok' THEN recv_by ELSE ? END,
      recv_at=CASE WHEN recv_status='ok' AND ?='ok' THEN recv_at ELSE ? END WHERE id=?`,
      args: [status, status, status === 'ok' ? row.qty : recvQty, str(body.note, 500), status, status ? user.name : null, status, status ? now() : null, row.id] });
    if (status === 'ok') queries.push(receiptAnalysisQuery('purchase_order', row.id, user));
  }
  const results = await db.batch(queries);
  return { ok: true, analysis_created: status === 'ok' ? results.filter((_, i) => i % 2 === 1).reduce((sum, r) => sum + r.meta.changes, 0) : 0 };
});

// ── 구매: 세탁관리 ──
route('GET', '/api/laundry', async ({ query }) => {
  const args = [], where = [];
  applyListDates(where, args, query, 'in_date');
  applyListKeyword(where, args, query.q, ['note','created_by']);
  if (query.has_photos) { if (!['0','1'].includes(query.has_photos)) throw bad('사진 조건을 확인하세요.'); where.push(query.has_photos === '1' ? 'json_array_length(photos)>0' : 'json_array_length(photos)=0'); }
  return (await db.prepare(`SELECT * FROM laundry ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY in_date DESC, id DESC`).all(...args)).map((r) => ({ ...r, photos: JSON.parse(r.photos) }));
});
route('POST', '/api/laundry', async ({ user, body }) => {
  const in_date = dateStr(body.in_date, '입고일'); const discard = num(body.discard_qty, '폐기수량'); const inQty = num(body.in_qty, '입고수량', { required: false });
  const photos = (await savePhotos(body.photos));
  try {
    const r = await db.prepare('INSERT INTO laundry(in_date,in_qty,discard_qty,note,photos,created_by) VALUES(?,?,?,?,?,?)').run(in_date, inQty, discard, str(body.note, 500), JSON.stringify(photos), user.name);
    return { id: Number(r.lastInsertRowid) };
  } catch (error) { await removePhotos(photos); throw error; }
});
route('PUT', '/api/laundry/:id', async ({ user, params, body }) => {
  const row = (await mustGet('laundry', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 수정할 수 있습니다.');
  const keep = JSON.parse(row.photos).filter((f) => (body.keep_photos || []).includes(f));
  const fields = [dateStr(body.in_date, '입고일'), num(body.in_qty, '입고수량', { required: false }), num(body.discard_qty, '폐기수량'), str(body.note, 500)];
  if (keep.length + (Array.isArray(body.photos) ? body.photos.length : 0) > 10) throw bad('사진은 최대 10장까지 올릴 수 있습니다.');
  const added = await savePhotos(body.photos);
  try { await db.prepare('UPDATE laundry SET in_date=?,in_qty=?,discard_qty=?,note=?,photos=? WHERE id=?').run(...fields, JSON.stringify(keep.concat(added)), row.id); }
  catch (error) { await removePhotos(added); throw error; }
  await removePhotos(JSON.parse(row.photos).filter(f => !keep.includes(f)));
  return { ok: true };
});
route('DELETE', '/api/laundry/:id', async ({ user, params }) => {
  const row = (await mustGet('laundry', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 삭제할 수 있습니다.');
  await db.prepare('DELETE FROM laundry WHERE id=?').run(row.id);
  await removePhotos(JSON.parse(row.photos)); return { ok: true };
});

// ── 의뢰 (분석/개발/샘플): 누구나 의뢰 → 접수대기 → 담당자 승인 → 리스트(대기/진행/완료) ──
function requestFields(type, b) {
  const data = typeof b.data === 'object' && b.data ? JSON.parse(JSON.stringify(b.data).slice(0, 20000)) : {};
  const f = { title: reqStr(b.title, type === 'development' ? '타겟제품' : '샘플명', 200), customer: str(b.customer, 100), due_date: dateStr(b.due_date, '완료 희망일', { required: false }), category: '', target_price: '', data };
  if (type === 'analysis') { f.category = str(b.category, 20); if (!ANALYSIS_CATEGORIES.includes(f.category)) throw bad('검사 구분을 선택하세요.'); }
  if (type === 'development') f.target_price = reqStr(b.target_price, '타겟단가', 100);
  return f;
}
function decodeRequest(r) { return { ...r, data: JSON.parse(r.data || '{}') }; }
async function getRequest(id) { const r = (await db.prepare('SELECT * FROM requests WHERE id=?').get(id)); if (!r) throw new HttpError(404, '의뢰를 찾을 수 없습니다.'); return r; }
function roleLabel(type) { return { analysis: '품질', development: '연구소', sample: '생산' }[type]; }

route('GET', '/api/requests', async ({ query }) => {
  const type = String(query.type || ''); if (!Object.hasOwn(REQUEST_TYPES, type)) throw bad('의뢰 종류가 올바르지 않습니다.');
  const where = ['type=?']; const args = [type];
  if (query.scope && !['intake','list'].includes(query.scope)) throw bad('의뢰 목록 구분을 확인하세요.');
  if (query.scope === 'intake') where.push("status IN ('pending','rejected')");
  else if (query.scope === 'list') where.push("status IN ('waiting','progress','done')");
  if (query.status) { if (!['pending','rejected','waiting','progress','done'].includes(query.status)) throw bad('의뢰 상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  if (query.category) { if (type !== 'analysis' || !ANALYSIS_CATEGORIES.includes(query.category)) throw bad('검사 구분을 확인하세요.'); where.push('category=?'); args.push(query.category); }
  applyListDates(where, args, query, 'substr(created_at,1,10)');
  applyListKeyword(where, args, query.q, ['req_no','title','customer','requester_name','result_note',"json_extract(data,'$.extra')", "json_extract(data,'$.purpose')", "json_extract(data,'$.lot_etc')"]);
  return (await db.prepare(`SELECT * FROM requests WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'progress' THEN 1 WHEN 'waiting' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END, id DESC`).all(...args)).map(decodeRequest);
});
route('POST', '/api/requests', async ({ user, body }) => {
  const type = String(body.type || ''); if (!Object.hasOwn(REQUEST_TYPES, type)) throw bad('의뢰 종류가 올바르지 않습니다.');
  const f = requestFields(type, body);
  const r = (await db.prepare('INSERT INTO requests(type,title,customer,due_date,category,target_price,data,requester_id,requester_name) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(type, f.title, f.customer, f.due_date, f.category, f.target_price, JSON.stringify(f.data), user.id, user.name));
  return decodeRequest((await getRequest(r.lastInsertRowid)));
});
route('PUT', '/api/requests/:id', async ({ user, params, body }) => {
  const r = (await getRequest(params.id));
  const isMgr = hasRole(user, REQUEST_TYPES[r.type]);
  if (!(isMgr || (r.requester_id === user.id && ['pending', 'rejected'].includes(r.status)))) throw new HttpError(403, '접수대기 중인 본인 의뢰만 수정할 수 있습니다.');
  const f = requestFields(r.type, body);
  if (r.source_type) {
    const original = JSON.parse(r.data || '{}');
    for (const key of ['source_label', 'received_date', 'item_category', 'received_qty', 'coa_requested', 'purchase_req_no', 'bom_id', 'product_code', 'unit']) f.data[key] = original[key];
  }
  const status = r.status === 'rejected' && !isMgr ? 'pending' : r.status; // 반려건 수정 시 재접수
  (await db.prepare("UPDATE requests SET title=?,customer=?,due_date=?,category=?,target_price=?,data=?,status=?,updated_at=datetime('now','+9 hours') WHERE id=?")
    .run(f.title, f.customer, f.due_date, f.category, f.target_price, JSON.stringify(f.data), status, r.id));
  return decodeRequest((await getRequest(r.id)));
});
route('POST', '/api/requests/:id/approve', async ({ user, params }) => {
  const r = (await getRequest(params.id)); requireRequestApprover(user, r.type);
  if (!['pending', 'rejected'].includes(r.status)) throw bad('이미 승인된 의뢰입니다.');
  const ymd = today().slice(2).replace(/-/g, ''); const prefix = `${REQUEST_PREFIX[r.type]}-${ymd}-`;
  // Allocate and transition in one SQLite statement; D1 serializes the write.
  const updated = await db.prepare(`UPDATE requests SET status='waiting',
    req_no=? || printf('%02d', (SELECT COALESCE(MAX(CAST(substr(req_no, length(?) + 1) AS INTEGER)),0)+1 FROM requests WHERE req_no LIKE ?)),
    approver_name=?, approved_at=?, reject_reason='', updated_at=datetime('now','+9 hours')
    WHERE id=? AND status IN ('pending','rejected')`).run(prefix, prefix, prefix + '%', user.name, now(), r.id);
  if (!updated.changes) throw bad('이미 승인된 의뢰입니다.');
  return decodeRequest((await getRequest(r.id)));
});
route('POST', '/api/requests/:id/reject', async ({ user, params, body }) => {
  const r = (await getRequest(params.id)); requireRequestApprover(user, r.type);
  if (r.status !== 'pending') throw bad('접수대기 중인 의뢰만 반려할 수 있습니다.');
  (await db.prepare("UPDATE requests SET status='rejected', reject_reason=?, approver_name=?, updated_at=datetime('now','+9 hours') WHERE id=?").run(reqStr(body.reason, '반려 사유', 500), user.name, r.id));
  return decodeRequest((await getRequest(r.id)));
});
route('POST', '/api/requests/:id/status', async ({ user, params, body }) => {
  const r = (await getRequest(params.id)); requireRole(user, REQUEST_TYPES[r.type], roleLabel(r.type));
  if (!WORK_STATUSES.includes(r.status)) throw bad('승인된 의뢰만 진행상태를 바꿀 수 있습니다.');
  const status = String(body.status); if (!WORK_STATUSES.includes(status)) throw bad('상태 값이 올바르지 않습니다.');
  (await db.prepare("UPDATE requests SET status=?, result_note=?, updated_at=datetime('now','+9 hours') WHERE id=?").run(status, body.result_note !== undefined ? str(body.result_note, 1000) : r.result_note, r.id));
  return decodeRequest((await getRequest(r.id)));
});
route('DELETE', '/api/requests/:id', async ({ user, params }) => {
  const r = (await getRequest(params.id));
  const own = r.requester_id === user.id && ['pending', 'rejected'].includes(r.status);
  if (!(own || user.is_admin || hasRole(user, REQUEST_TYPES[r.type]))) throw new HttpError(403, '삭제 권한이 없습니다.');
  await deleteEntityWithAttachments('request', 'requests', r.id); return { ok: true };
});

// ── 관리자 BOM ──
function bomFields(body) {
  const category = itemCategory(body.item_category);
  const kind = String(body.kind || 'finished');
  if (!['finished', 'semi'].includes(kind)) throw bad('완제품/반제품 구분을 선택하세요.');
  const baseQty = num(body.base_qty, '기준 생산수량');
  if (baseQty <= 0) throw bad('기준 생산수량은 0보다 커야 합니다.');
  if (!Array.isArray(body.materials) || body.materials.length > 100 || (category === '제품' && !body.materials.length)) throw bad('제품 BOM은 자재를 1~100개 등록하세요.');
  const materials = body.materials.map(m => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw bad('자재 항목을 확인하세요.');
    const qty = num(m.qty, '자재 사용량'); if (qty <= 0) throw bad('자재 사용량은 0보다 커야 합니다.');
    return { item: reqStr(m.item, '자재명', 200), item_category: itemCategory(m.item_category), qty, unit: reqStr(m.unit, '자재 단위', 20) };
  });
  return [reqStr(body.product, '품목명', 200), str(body.product_code, 80), kind, baseQty, reqStr(body.unit, '단위', 20), JSON.stringify(materials), str(body.note, 500), body.active === false || body.active === 0 ? 0 : 1, category];
}
function decodeBom(row) { return { ...row, materials: JSON.parse(row.materials) }; }
route('GET', '/api/boms', async ({ user, query }) => {
  const where = []; const args = [];
  if (query.include_archived === '1') requireAdmin(user); else where.push('active=1');
  if (query.kind) { if (!['finished','semi'].includes(query.kind)) throw bad('생산 구분이 올바르지 않습니다.'); where.push('kind=?'); args.push(query.kind); }
  if (query.item_category) { where.push('item_category=?'); args.push(itemCategory(query.item_category)); }
  applyListKeyword(where, args, query.q, ['product','product_code','created_by','note']);
  if (query.active) { if (!['0','1'].includes(query.active)) throw bad('BOM 사용 상태를 확인하세요.'); where.push('active=?'); args.push(Number(query.active)); }
  return (await db.prepare(`SELECT * FROM boms ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY product,id`).all(...args)).map(decodeBom);
});
route('POST', '/api/boms', async ({ user, body }) => {
  requireAdmin(user);
  const result = await db.prepare('INSERT INTO boms(product,product_code,kind,base_qty,unit,materials,note,active,item_category,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...bomFields(body), user.name);
  return decodeBom(await mustGet('boms', result.lastInsertRowid));
});
route('PUT', '/api/boms/:id', async ({ user, params, body }) => {
  requireAdmin(user); await mustGet('boms', params.id);
  await db.prepare("UPDATE boms SET product=?,product_code=?,kind=?,base_qty=?,unit=?,materials=?,note=?,active=?,item_category=?,updated_at=datetime('now','+9 hours') WHERE id=?").run(...bomFields(body), params.id);
  return decodeBom(await mustGet('boms', params.id));
});
route('DELETE', '/api/boms/:id', async ({ user, params }) => {
  requireAdmin(user); await mustGet('boms', params.id);
  await db.prepare("UPDATE boms SET active=0,updated_at=datetime('now','+9 hours') WHERE id=?").run(params.id);
  return { ok: true };
});

// ── 생산: 완제품/반제품 생산일정 ──
function normStart(period, d) {
  const dt = new Date(d + 'T00:00:00Z');
  if (period === 'week') dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  if (period === 'month') dt.setUTCDate(1);
  return dt.toISOString().slice(0, 10);
}
async function schedFields(b, previous = null) {
  const kind = String(b.kind); if (!['finished', 'semi'].includes(kind)) throw bad('완제품/반제품 구분이 올바르지 않습니다.');
  const period = String(b.period); if (!['day', 'week', 'month'].includes(period)) throw bad('일간/주간/월간을 선택하세요.');
  const qty = num(b.qty, '수량');
  const bomId = b.bom_id === undefined ? previous?.bom_id || null : b.bom_id === '' || b.bom_id === null ? null : Number(b.bom_id);
  let snapshot = {};
  if (bomId !== null) {
    if (!Number.isSafeInteger(bomId) || bomId <= 0) throw bad('BOM을 선택하세요.');
    if (previous?.bom_id === bomId) snapshot = JSON.parse(previous.bom_snapshot);
    else {
      const bom = await mustGet('boms', bomId);
      if (!bom.active) throw bad('사용 중지된 BOM입니다.');
      snapshot = decodeBom(bom);
    }
    if (snapshot.kind !== kind) throw bad('완제품/반제품 구분에 맞는 BOM을 선택하세요.');
    snapshot.production_qty = qty;
    snapshot.requirements = snapshot.materials.map(material => {
      const amount = material.qty * (qty / snapshot.base_qty);
      if (!Number.isFinite(amount)) throw bad('자재 소요량이 너무 큽니다.');
      return { ...material, qty: Number(amount.toPrecision(12)) };
    });
  }
  return { kind, period, start_date: normStart(period, dateStr(b.start_date, '날짜')), product: bomId ? snapshot.product : reqStr(b.product, '제품명', 200), qty, note: str(b.note, 500), bom_id: bomId, bom_snapshot: JSON.stringify(snapshot) };
}
function decodeSchedule(row) { return { ...row, bom_snapshot: JSON.parse(row.bom_snapshot || '{}') }; }
route('GET', '/api/schedules', async ({ query }) => {
  const kind = String(query.kind || 'finished');
  if (!['finished','semi'].includes(kind)) throw bad('생산 구분을 확인하세요.');
  const from = listFilterDate(query.from, '시작일'), to = listFilterDate(query.to, '종료일');
  if (!from || !to || from > to) throw bad('생산 조회 기간을 확인하세요.');
  const where = [], args = [kind, from, to, to, from, to, from];
  applyListKeyword(where, args, query.q, ['product','note','created_by',"json_extract(bom_snapshot,'$.product_code')"]);
  if (query.done) { if (!['0','1'].includes(query.done)) throw bad('완료 상태를 확인하세요.'); where.push('done=?'); args.push(Number(query.done)); }
  if (query.period) { if (!['day','week','month'].includes(query.period)) throw bad('일정 기준을 확인하세요.'); where.push('period=?'); args.push(query.period); }
  // 기간과 겹치는 일정: 일간(그날), 주간(월~일), 월간(그 달)
  return (await db.prepare(`SELECT * FROM schedules WHERE kind=? AND (
      (period='day' AND start_date BETWEEN ? AND ?) OR
      (period='week' AND start_date<=? AND date(start_date,'+6 days')>=?) OR
      (period='month' AND start_date<=? AND date(start_date,'+1 month','-1 day')>=?)
    ) ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY start_date, period, id`).all(...args)).map(decodeSchedule);
});
route('POST', '/api/schedules', async ({ user, body }) => {
  const f = await schedFields(body);
  const r = await db.prepare('INSERT INTO schedules(kind,period,start_date,product,qty,note,created_by,bom_id,bom_snapshot) VALUES(?,?,?,?,?,?,?,?,?)').run(f.kind, f.period, f.start_date, f.product, f.qty, f.note, user.name, f.bom_id, f.bom_snapshot);
  return decodeSchedule(await mustGet('schedules', r.lastInsertRowid));
});
route('PUT', '/api/schedules/:id', async ({ user, params, body }) => {
  const row = (await mustGet('schedules', params.id)); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 수정할 수 있습니다.');
  if (body.toggle_done) { await db.prepare('UPDATE schedules SET done=1-done WHERE id=?').run(row.id); return decodeSchedule(await mustGet('schedules', row.id)); }
  const f = await schedFields({ ...body, kind: row.kind }, row);
  await db.prepare('UPDATE schedules SET period=?,start_date=?,product=?,qty=?,note=?,bom_id=?,bom_snapshot=? WHERE id=?').run(f.period, f.start_date, f.product, f.qty, f.note, f.bom_id, f.bom_snapshot, row.id);
  return decodeSchedule(await mustGet('schedules', row.id));
});
route('DELETE', '/api/schedules/:id', async ({ user, params }) => {
  const row = (await mustGet('schedules', params.id)); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 삭제할 수 있습니다.');
  (await db.prepare('DELETE FROM schedules WHERE id=?').run(row.id)); return { ok: true };
});

// ── 물류: 발주 없는 기타입고 ──
async function otherReceiptFields(b, previous = null) {
  const bomId = b.bom_id === undefined ? previous?.bom_id || null : b.bom_id === null || b.bom_id === '' ? null : Number(b.bom_id);
  let snapshot = {};
  if (bomId !== null) {
    if (!Number.isSafeInteger(bomId) || bomId <= 0) throw bad('BOM 품목을 선택하세요.');
    if (previous?.bom_id === bomId) snapshot = JSON.parse(previous.bom_snapshot);
    else {
      const bom = await mustGet('boms', bomId);
      if (!bom.active) throw bad('사용 중지된 BOM 품목입니다.');
      snapshot = { id: bom.id, product: bom.product, product_code: bom.product_code, item_category: bom.item_category, unit: bom.unit };
    }
    if (!ITEM_CATEGORIES.includes(snapshot.item_category)) throw bad('관리자가 BOM 품목의 분류를 먼저 지정해야 합니다.');
  } else if (!previous || previous.bom_id) throw bad('BOM을 검색하여 입고할 품목을 선택하세요.');
  return [dateStr(b.received_date, '입고일'), bomId ? snapshot.product : reqStr(b.item, '품목명', 200), bomId ? snapshot.item_category : itemCategory(b.item_category), num(b.qty, '입고수량'), reqStr(b.vendor, '입고처', 100), str(b.note, 500), bomId, JSON.stringify(snapshot)];
}
route('GET', '/api/other-receipts', async ({ query }) => {
  const where = []; const args = [];
  applyListDates(where, args, query, 'received_date');
  if (query.item_category) { where.push('item_category=?'); args.push(itemCategory(query.item_category)); }
  applyListKeyword(where, args, query.q, ['item','vendor','note','created_by',"json_extract(bom_snapshot,'$.product_code')"]);
  applyInspectionFilter(where, args, query, 'other_receipt', 'other_receipts');
  return await db.prepare(`SELECT other_receipts.*, ${attachmentSummary('other_receipt','other_receipts')} FROM other_receipts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY received_date DESC, id DESC`).all(...args);
});
route('POST', '/api/other-receipts', async ({ user, body }) => {
  const fields = await otherReceiptFields(body);
  const results = await db.batch([
    { sql: 'INSERT INTO other_receipts(received_date,item,item_category,qty,vendor,note,bom_id,bom_snapshot,created_by) VALUES(?,?,?,?,?,?,?,?,?)', args: [...fields, user.name] },
    receiptAnalysisQuery('other_receipt', null, user),
  ]);
  return await mustGet('other_receipts', results[0].meta.last_row_id);
});
route('PUT', '/api/other-receipts/:id', async ({ user, params, body }) => {
  const row = await mustGet('other_receipts', params.id);
  if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 수정할 수 있습니다.');
  const fields = await otherReceiptFields(body, row);
  await db.prepare('UPDATE other_receipts SET received_date=?,item=?,item_category=?,qty=?,vendor=?,note=?,bom_id=?,bom_snapshot=? WHERE id=?').run(...fields, row.id);
  return await mustGet('other_receipts', row.id);
});
route('DELETE', '/api/other-receipts/:id', async ({ user, params }) => {
  const row = await mustGet('other_receipts', params.id);
  if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 삭제할 수 있습니다.');
  await deleteEntityWithAttachments('other_receipt', 'other_receipts', row.id);
  return { ok: true };
});

// ── 물류: 출하목록 ──
function shipFields(b) { return [dateStr(b.ship_date, '출고일'), reqStr(b.item, '품목명', 200), num(b.qty, '수량'), reqStr(b.customer, '거래처', 100), str(b.note, 500), str(b.lot, 100)]; }
route('GET', '/api/shipments', async ({ query }) => {
  const from = query.from || today(); const to = query.to || from;
  const where = [], args = [];
  applyListDates(where, args, { from, to }, 'ship_date');
  applyListKeyword(where, args, query.q, ['item','customer','lot','note','created_by']);
  applyInspectionFilter(where, args, query, 'shipment', 'shipments');
  return (await db.prepare(`SELECT shipments.*, ${attachmentSummary('shipment','shipments')} FROM shipments WHERE ${where.join(' AND ')} ORDER BY ship_date DESC, id DESC`).all(...args));
});
route('POST', '/api/shipments', async ({ user, body }) => {
  const r = (await db.prepare('INSERT INTO shipments(ship_date,item,qty,customer,note,lot,created_by) VALUES(?,?,?,?,?,?,?)').run(...shipFields(body), user.name));
  return (await mustGet('shipments', r.lastInsertRowid));
});
route('PUT', '/api/shipments/:id', async ({ user, params, body }) => {
  const row = (await mustGet('shipments', params.id)); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 수정할 수 있습니다.');
  (await db.prepare('UPDATE shipments SET ship_date=?,item=?,qty=?,customer=?,note=?,lot=? WHERE id=?').run(...shipFields(body), row.id)); return (await mustGet('shipments', row.id));
});
route('DELETE', '/api/shipments/:id', async ({ user, params }) => {
  const row = (await mustGet('shipments', params.id)); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 삭제할 수 있습니다.');
  await deleteEntityWithAttachments('shipment', 'shipments', row.id); return { ok: true };
});

route('GET', '/api/reports', async ({ query }) => buildReport(db, query, today()));

// ── 대시보드 ──
route('GET', '/api/dashboard', async () => {
  const c = async (sql, ...a) => (await db.prepare(sql).get(...a)).c;
  const reqCounts = {};
  for (const t of Object.keys(REQUEST_TYPES)) {
    reqCounts[t] = { pending: (await c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='pending'", t)), waiting: (await c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='waiting'", t)), progress: (await c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='progress'", t)), done: (await c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='done'", t)) };
  }
  const t = today();
  return {
    today: t,
    po: { total: (await c('SELECT COUNT(*) c FROM purchase_orders')), none: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status=''")), ok: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='ok'")), mismatch: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='mismatch'")), checking: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='checking'")), overdue: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status<>'ok' AND due_date<?", t)) },
    requests: reqCounts,
    shipmentsToday: (await c('SELECT COUNT(*) c FROM shipments WHERE ship_date=?', t)),
    laundryMonth: (await db.prepare("SELECT COALESCE(SUM(discard_qty),0) c FROM laundry WHERE substr(in_date,1,7)=?").get(t.slice(0, 7))).c,
    schedulesToday: (await c("SELECT COUNT(*) c FROM schedules WHERE period='day' AND start_date=?", t)),
  };
});

async function mustGet(table, id) { const r = (await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)); if (!r) throw new HttpError(404, '항목을 찾을 수 없습니다.'); return r; }


return { async fetch(req) {
  const res = new Headers({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  try {
    const url = new URL(req.url); const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) throw new HttpError(403, '같은 사이트에서 요청하세요.');
      }
      const r = routes.find(x => x.method === req.method && x.re.test(p));
      if (!r) throw new HttpError(404, 'API를 찾을 수 없습니다.');
      const m = r.re.exec(p); const params = {}; r.keys.forEach((k, i) => params[k] = m[i + 1]);
      const user = await currentUser(req);
      if (r.auth && !user) throw new HttpError(401, '로그인이 필요합니다.');
      const body = req.method === 'GET' ? {} : await readBody(req);
      return Response.json(await r.handler({ req, res, user, params, body, query: Object.fromEntries(url.searchParams) }), { headers: res });
    }
    if (p.startsWith('/uploads/')) {
      if (!await currentUser(req)) throw new HttpError(401, '로그인이 필요합니다.');
      const file = p.slice('/uploads/'.length);
      if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(file)) throw new HttpError(404, '사진을 찾을 수 없습니다.');
      const photo = await env.BUCKET.get(file);
      if (!photo) throw new HttpError(404, '사진을 찾을 수 없습니다.');
      res.set('Content-Type', photo.httpMetadata?.contentType || 'application/octet-stream');
      res.set('Cache-Control', 'private, no-store');
      return new Response(photo.body, { headers: res });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    return env.ASSETS.fetch(req);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    return Response.json({ error: e.status && e.status < 500 ? e.message : '서버 오류가 발생했습니다.' }, { status: e.status || 500, headers: res });
  }
} };
}

async function readBody(req) {
  if (!req.body) return {};
  const reader = req.body.getReader(); const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  if (!size) return {};
  if (!(req.headers.get('content-type') || '').includes('application/json')) throw Object.assign(new Error('JSON 요청만 허용됩니다.'), { status: 400 });
  try { const body = JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw Object.assign(new Error('잘못된 요청 형식입니다.'), { status: 400 }); }
}

export default { fetch(request, env) { return createApp(env).fetch(request); } };
