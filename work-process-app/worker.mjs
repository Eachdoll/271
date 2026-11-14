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
const ROLES = ['purchase', 'quality', 'quality_approver', 'dev', 'dev_approver', 'production', 'production_approver', 'logistics', 'logistics_approver'];
const REQUEST_TYPES = { voc: 'quality', analysis: 'quality', development: 'dev', sample: 'production' };
const REQUEST_PREFIX = { voc: 'V', analysis: 'Q', development: 'D', sample: 'S' };
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
function hasRole(user, role) { const roles = publicUser(user).roles; return !!user.is_admin || roles.includes(role) || (['quality','dev','production','logistics'].includes(role) && roles.includes(role + '_approver')); }
function isRequestApprover(user, type) {
  return hasRole(user, { voc: 'quality_approver', analysis: 'quality_approver', development: 'dev_approver', sample: 'production' }[type]);
}
function requireRequestApprover(user, type) {
  const label = { voc: '품질팀장(품질책임자)', analysis: '품질책임자', development: '개발책임자', sample: '생산담당자' }[type];
  if (!isRequestApprover(user, type)) throw new HttpError(403, `${label}(승인권자)만 승인·반려할 수 있습니다. 관리자에게 책임자 지정을 요청하세요.`);
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
  if (type === 'request' && !['development','sample','voc'].includes(row.type)) throw bad('개발·샘플 의뢰서와 VOC에 사진을 첨부할 수 있습니다.');
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
    if (target.approval_status !== 'approved' && roles.some(r => ['quality_approver','dev_approver','production_approver','logistics_approver'].includes(r))) throw bad('가입 승인 후 책임자로 지정하세요.');
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
const backupTables = ['settings', 'users', 'purchase_orders', 'laundry', 'requests', 'schedules', 'shipments', 'other_receipts', 'boms', 'attachments', 'progress_comments', 'item_batches', 'production_actuals', 'production_actual_changes', 'receipt_qty_changes'];
route('GET', '/api/admin/backup', async ({ user, query }) => {
  requireAdmin(user);
  if (!query.table) return { format: 'work-process-v2', tables: backupTables };
  if (!backupTables.includes(query.table)) throw bad('백업할 표가 올바르지 않습니다.');
  const key = query.table === 'settings' ? 'key' : query.table === 'item_batches' ? 'batch_id' : 'id';
  const after = key !== 'id' ? String(query.after || '') : Number(query.after || 0);
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
    sql: `INSERT INTO requests(type,status,req_no,title,customer,category,data,requester_id,requester_name,approver_name,approved_at,source_type,source_id,batch_id,spec,unit,lot,qty)
      SELECT 'analysis','waiting',
        ? || printf('%02d', (SELECT COALESCE(MAX(CAST(substr(req_no,length(?) + 1) AS INTEGER)),0)+1 FROM requests WHERE req_no LIKE ?)),
        src.item,src.vendor,'수입검사',
        json_object('purpose','입고 수입검사','sample_qty',CAST(${qty} AS TEXT),
          'source_label',?,'received_date',${date},'item_category',src.item_category,
          'received_qty',${qty},'coa_requested',${coa},
          'purchase_req_no',${purchase ? 'src.req_no' : "''"},
          'bom_id',${purchase ? 'NULL' : 'src.bom_id'},
          'product_code',${purchase ? "''" : "COALESCE(json_extract(src.bom_snapshot,'$.product_code'),'')"},
          'unit',COALESCE(NULLIF(src.unit,''),${purchase ? "''" : "json_extract(src.bom_snapshot,'$.unit')"},''),'spec',src.spec,'lot',src.lot,'lot_etc',src.lot,'qty',${qty},
          'result_type',CASE WHEN ${coa}=1 THEN 'COA발행' ELSE '기본(데이터공유)' END,'extra',src.note),
        ?,?,'입고 자동접수',datetime('now','+9 hours'),?,src.id,src.batch_id,src.spec,src.unit,src.lot,${qty}
      FROM ${table} src WHERE src.id=${id == null ? 'last_insert_rowid()' : '?'}
        ${purchase ? "AND src.recv_status IN ('ok','mismatch')" : ''}
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
  return (await db.prepare(`SELECT purchase_orders.*, ${attachmentSummary('purchase_order','purchase_orders')},
    (SELECT json_object('id',c.id,'action',c.action,'new_recv_qty',c.new_recv_qty,'reason',c.reason,'requested_by',c.requested_by,'requested_by_id',c.requested_by_id,'requested_at',c.requested_at) FROM receipt_qty_changes c WHERE c.po_id=purchase_orders.id AND c.status='pending') AS pending_change
    FROM purchase_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (recv_status='ok'), due_date, id DESC`).all(...args));
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
  // A recorded receipt quantity changes only through an approved request. Allowed directly:
  // confirming again (ok→ok), closing a short receipt (mismatch→ok keeps the received qty),
  // and re-saving the same mismatch quantity.
  const locked = rows.filter(row => ['ok', 'mismatch'].includes(row.recv_status)
    && !(status === 'ok' || (status === 'mismatch' && row.recv_status === 'mismatch' && recvQty === row.recv_qty)));
  if (locked.length) throw new HttpError(409, `입고 수량이 기록된 항목(${locked.map(r => r.item).join(', ')})은 바로 바꿀 수 없습니다. 항목의 '수량 수정 요청' 또는 '입고 취소 요청'으로 팀장 승인을 받으세요.`);
  const pending = [];
  for (const row of rows) if (await db.prepare("SELECT 1 FROM receipt_qty_changes WHERE po_id=? AND status='pending'").get(row.id)) pending.push(row.item);
  if (pending.length) throw new HttpError(409, `승인 대기 중인 수정 요청이 있는 항목(${pending.join(', ')})은 처리 후 다시 시도하세요.`);
  const queries = [];
  for (const row of rows) {
    queries.push({ sql: `UPDATE purchase_orders SET recv_status=?,
      recv_qty=CASE WHEN recv_status='ok' AND ?='ok' THEN COALESCE(recv_qty,qty) ELSE ? END,recv_note=?,
      recv_by=CASE WHEN recv_status='ok' AND ?='ok' THEN recv_by ELSE ? END,
      recv_at=CASE WHEN recv_status='ok' AND ?='ok' THEN recv_at ELSE ? END WHERE id=?`,
      args: [status, status, status === 'ok' ? (row.recv_status === 'mismatch' ? row.recv_qty : row.qty) : recvQty, str(body.note, 500), status, status ? user.name : null, status, status ? now() : null, row.id] });
    // Anyone may confirm a receipt; the append-only comment keeps who did what even after later status changes.
    const label = { '': '미입고', ok: '입고완료', mismatch: '수량상이', checking: '확인중' };
    const detail = status === 'mismatch' ? ` · 실입고 ${recvQty} (발주 ${row.qty})`
      : status === 'ok' && row.recv_status === 'mismatch' ? ` · 수량상이 종결 · 실입고 ${row.recv_qty} (발주 ${row.qty}), 이후 입고분은 기타입고`
      : status === 'ok' ? ` · 수량 ${row.recv_status === 'ok' ? row.recv_qty ?? row.qty : row.qty}` : '';
    queries.push({ sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)',
      args: ['purchase_order', row.id, `[입고 처리] ${label[row.recv_status] ?? row.recv_status} → ${label[status]}${detail}${str(body.note, 500) ? ' · ' + str(body.note, 500) : ''}`, user.id, user.name] });
    if (['ok', 'mismatch'].includes(status)) queries.push(receiptAnalysisQuery('purchase_order', row.id, user));
  }
  const results = await db.batch(queries);
  const per = ['ok', 'mismatch'].includes(status) ? 3 : 2;
  return { ok: true, analysis_created: per === 3 ? results.filter((_, i) => i % 3 === 2).reduce((sum, r) => sum + r.meta.changes, 0) : 0 };
});

// ── 물류: 기록된 입고 수량 수정·입고 취소 요청 (물류팀장 승인 후 반영) ──
function requireReceiptApprover(user) {
  if (!user.is_admin && !publicUser(user).roles.includes('logistics_approver')) throw new HttpError(403, '물류팀장(입고 수량 수정 승인권자)만 승인·반려할 수 있습니다. 관리자에게 지정을 요청하세요.');
}
route('POST', '/api/po/:id/receipt-changes', async ({ user, params, body }) => {
  const row = await mustGet('purchase_orders', params.id);
  if (!['ok', 'mismatch'].includes(row.recv_status)) throw bad('입고 수량이 기록된 항목만 수정·취소 요청할 수 있습니다.');
  const action = String(body.action || '');
  if (!['qty', 'revert'].includes(action)) throw bad('요청 종류를 확인하세요.');
  const reason = reqStr(body.reason, action === 'qty' ? '수정 사유' : '취소 사유', 500);
  const newQty = action === 'qty' ? num(body.recv_qty, '실입고 수량') : null;
  if (action === 'qty' && newQty === row.recv_qty) throw bad('바뀐 수량이 없습니다.');
  const key = body.request_id === undefined ? randomHex(16) : String(body.request_id);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('요청 번호를 확인하세요.');
  const same = c => c.po_id === row.id && c.action === action && c.requested_by_id === user.id && c.new_recv_qty === newQty && c.reason === reason;
  const old = await db.prepare('SELECT * FROM receipt_qty_changes WHERE request_id=?').get(key);
  if (old) { if (!same(old)) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return { pending: old.status === 'pending', change: old }; }
  if (await db.prepare("SELECT 1 FROM receipt_qty_changes WHERE po_id=? AND status='pending'").get(row.id)) throw new HttpError(409, '이 항목에는 이미 승인 대기 중인 요청이 있습니다.');
  try {
    const r = await db.prepare('INSERT INTO receipt_qty_changes(po_id,action,request_id,old_status,old_recv_qty,new_recv_qty,reason,requested_by_id,requested_by) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(row.id, action, key, row.recv_status, row.recv_qty, newQty, reason, user.id, user.name);
    return { pending: true, change: await db.prepare('SELECT * FROM receipt_qty_changes WHERE id=?').get(r.lastInsertRowid) };
  } catch (error) {
    const saved = await db.prepare('SELECT * FROM receipt_qty_changes WHERE request_id=?').get(key);
    if (saved && same(saved)) return { pending: true, change: saved };
    if (await db.prepare("SELECT 1 FROM receipt_qty_changes WHERE po_id=? AND status='pending'").get(row.id)) throw new HttpError(409, '이 항목에는 이미 승인 대기 중인 요청이 있습니다.');
    throw error;
  }
});
const receiptChangeSelect = `SELECT c.*, p.req_no, p.vendor, p.item, p.spec, p.unit, p.qty AS order_qty, p.recv_status AS current_status, p.recv_qty AS current_recv_qty
  FROM receipt_qty_changes c LEFT JOIN purchase_orders p ON p.id=c.po_id`;
route('GET', '/api/receipt-changes', async ({ query }) => {
  const where = [], args = [];
  if (query.status) { if (!['pending','approved','rejected','cancelled'].includes(query.status)) throw bad('요청 상태를 확인하세요.'); where.push('c.status=?'); args.push(query.status); }
  if (query.po_id) { if (!/^[1-9]\d*$/.test(query.po_id)) throw bad('발주 번호를 확인하세요.'); where.push('c.po_id=?'); args.push(Number(query.po_id)); }
  return db.prepare(`${receiptChangeSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id DESC LIMIT 200`).all(...args);
});
async function pendingReceiptChange(id) {
  if (!/^[1-9]\d*$/.test(String(id))) throw bad('요청 번호를 확인하세요.');
  const change = await db.prepare('SELECT * FROM receipt_qty_changes WHERE id=?').get(Number(id));
  if (!change) throw new HttpError(404, '수정 요청을 찾을 수 없습니다.');
  if (change.status !== 'pending') throw new HttpError(409, '이미 처리된 요청입니다.');
  return change;
}
route('POST', '/api/receipt-changes/:id/approve', async ({ user, params, body }) => {
  requireReceiptApprover(user);
  const change = await pendingReceiptChange(params.id); const stamp = now();
  const row = await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(change.po_id);
  if (!row || row.recv_status !== change.old_status || row.recv_qty !== change.old_recv_qty) throw new HttpError(409, '요청 이후 입고 내용이 바뀌었습니다. 반려하고 새로 요청하세요.');
  const text = change.action === 'qty'
    ? `[입고 수량 수정 승인] 실입고 ${change.old_recv_qty} → ${change.new_recv_qty} (발주 ${row.qty}) · 사유: ${change.reason} · 요청 ${change.requested_by}`
    : `[입고 취소 승인] ${change.old_status === 'ok' ? '입고완료' : '수량상이'} ${change.old_recv_qty} → 미입고 · 사유: ${change.reason} · 요청 ${change.requested_by}`;
  const applied = "EXISTS(SELECT 1 FROM receipt_qty_changes WHERE id=? AND status='approved' AND reviewed_at=?)";
  const results = await db.batch([
    { sql: "UPDATE receipt_qty_changes SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'", args: [user.name, stamp, str(body.note, 500), change.id] },
    change.action === 'qty'
      ? { sql: `UPDATE purchase_orders SET recv_qty=? WHERE id=? AND recv_status=? AND recv_qty IS ? AND ${applied}`, args: [change.new_recv_qty, row.id, change.old_status, change.old_recv_qty, change.id, stamp] }
      : { sql: `UPDATE purchase_orders SET recv_status='',recv_qty=NULL,recv_note='',recv_by=NULL,recv_at=NULL WHERE id=? AND recv_status=? AND recv_qty IS ? AND ${applied}`, args: [row.id, change.old_status, change.old_recv_qty, change.id, stamp] },
    { sql: `INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) SELECT 'purchase_order',?,?,?,? WHERE ${applied}`, args: [row.id, text, user.id, user.name, change.id, stamp] },
    // The linked inspection keeps its receipt snapshot; the correction is noted on it instead.
    { sql: `INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) SELECT 'request',id,?,?,? FROM requests WHERE source_type='purchase_order' AND source_id=? AND ${applied}`, args: [text, user.id, user.name, row.id, change.id, stamp] },
  ]);
  if (!results[0].meta.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return db.prepare(`${receiptChangeSelect} WHERE c.id=?`).get(change.id);
});
route('POST', '/api/receipt-changes/:id/reject', async ({ user, params, body }) => {
  requireReceiptApprover(user);
  const change = await pendingReceiptChange(params.id);
  const r = await db.prepare("UPDATE receipt_qty_changes SET status='rejected',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'").run(user.name, now(), reqStr(body.note, '반려 사유', 500), change.id);
  if (!r.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return db.prepare(`${receiptChangeSelect} WHERE c.id=?`).get(change.id);
});
route('POST', '/api/receipt-changes/:id/cancel', async ({ user, params }) => {
  const change = await pendingReceiptChange(params.id);
  if (change.requested_by_id !== user.id && !user.is_admin) throw new HttpError(403, '요청한 사람만 철회할 수 있습니다.');
  const r = await db.prepare("UPDATE receipt_qty_changes SET status='cancelled',reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'").run(user.name, now(), change.id);
  if (!r.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return { ok: true };
});

// ── 구매: 세탁관리 ──
route('GET', '/api/laundry', async ({ query }) => {
  const args = [], where = [];
  applyListDates(where, args, query, 'in_date');
  applyListKeyword(where, args, query.q, ['item','spec','lot','note','created_by']);
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
  if (type === 'voc' && (!b.data || typeof b.data !== 'object' || Array.isArray(b.data) || JSON.stringify(b.data).length > 20000)) throw bad('VOC 입력 내용을 확인하세요.');
  const data = typeof b.data === 'object' && b.data ? JSON.parse(JSON.stringify(b.data).slice(0, 20000)) : {};
  const f = { title: reqStr(b.title, type === 'voc' ? '제품명' : type === 'development' ? '타겟제품' : '샘플명', 200), customer: str(b.customer, 100), due_date: dateStr(b.due_date, '완료 희망일', { required: false }), category: '', target_price: '', data };
  if (type === 'analysis') { f.category = str(b.category, 20); if (!ANALYSIS_CATEGORIES.includes(f.category)) throw bad('검사 구분을 선택하세요.'); }
  if (type === 'voc') {
    f.customer = reqStr(b.customer, '고객사', 100);
    if (!['number','string'].includes(typeof data.qty)) throw bad('수량을 입력하세요.');
    const qty = num(data.qty, '수량');
    if (qty <= 0) throw bad('수량은 0보다 커야 합니다.');
    f.data = { ...data, qty, lot: str(data.lot, 100), unit: str(data.unit, 20), extra: reqStr(data.extra, 'VOC 내용', 2000) };
  }
  if (type === 'development') f.target_price = reqStr(b.target_price, '타겟단가', 100);
  return f;
}
function decodeRequest(r) { return { ...r, data: JSON.parse(r.data || '{}') }; }
async function getRequest(id) { const r = (await db.prepare('SELECT * FROM requests WHERE id=?').get(id)); if (!r) throw new HttpError(404, '의뢰를 찾을 수 없습니다.'); return r; }
function roleLabel(type) { return { voc: '품질', analysis: '품질', development: '연구소', sample: '생산' }[type]; }

route('GET', '/api/requests', async ({ query }) => {
  const type = String(query.type || ''); if (!Object.hasOwn(REQUEST_TYPES, type)) throw bad('의뢰 종류가 올바르지 않습니다.');
  const where = ['type=?']; const args = [type];
  if (query.scope && !['intake','list'].includes(query.scope)) throw bad('의뢰 목록 구분을 확인하세요.');
  if (query.scope === 'intake') where.push("status IN ('pending','rejected')");
  else if (query.scope === 'list') where.push("status IN ('waiting','progress','done')");
  if (query.status) { if (!['pending','rejected','waiting','progress','done'].includes(query.status)) throw bad('의뢰 상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  if (query.category) { if (type !== 'analysis' || !ANALYSIS_CATEGORIES.includes(query.category)) throw bad('검사 구분을 확인하세요.'); where.push('category=?'); args.push(query.category); }
  applyListDates(where, args, query, 'substr(created_at,1,10)');
  applyListKeyword(where, args, query.q, ['req_no','title','spec','lot','customer','requester_name','result_note',"json_extract(data,'$.extra')", "json_extract(data,'$.purpose')", "json_extract(data,'$.lot_etc')", "json_extract(data,'$.lot')"]);
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
    // Receipt-created analyses keep the receipt snapshot; corrections belong in comments.
    const original = JSON.parse(r.data || '{}');
    for (const key of ['source_label', 'received_date', 'item_category', 'received_qty', 'coa_requested', 'purchase_req_no', 'bom_id', 'product_code', 'unit', 'spec', 'lot', 'lot_etc', 'qty', 'sample_qty']) f.data[key] = original[key];
    f.title = r.title; f.customer = r.customer;
  }
  const priorData = JSON.parse(r.data || '{}');
  const meta = lineMeta({ spec: r.source_type ? r.spec || priorData.spec || '' : body.spec ?? body.data?.spec ?? r.spec,
    unit: r.source_type ? r.unit || priorData.unit || '' : body.unit ?? body.data?.unit ?? (r.unit || priorData.unit || ''),
    lot: (r.source_type ? undefined : body.lot ?? (r.type === 'analysis' ? body.data?.lot_etc : body.data?.lot)) ?? (r.lot || priorData.lot_etc || (r.type === 'voc' ? priorData.lot : '') || '') }, r);
  let lineQty = r.qty;
  if (!r.source_type && (r.qty !== null || r.type === 'voc')) {
    const supplied = r.type === 'analysis' ? f.data.sample_qty : r.type === 'sample' ? f.data.req_qty : f.data.qty;
    if (supplied !== undefined && supplied !== '') { lineQty = num(supplied,'품목 수량'); if (lineQty <= 0) throw bad('품목 수량은 0보다 커야 합니다.'); }
    if (lineQty !== null) f.data.qty = lineQty;
  }
  f.data.spec = meta.spec; f.data.unit = meta.unit;
  if (r.type === 'voc') f.data.lot = meta.lot;
  const status = r.status === 'rejected' && !isMgr ? 'pending' : r.status; // 반려건 수정 시 재접수
  (await db.prepare("UPDATE requests SET title=?,customer=?,due_date=?,category=?,target_price=?,data=?,status=?,spec=?,unit=?,lot=?,qty=?,updated_at=datetime('now','+9 hours') WHERE id=?")
    .run(f.title, f.customer, f.due_date, f.category, f.target_price, JSON.stringify(f.data), status, meta.spec, meta.unit, meta.lot, lineQty, r.id));
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
  const intake = ['pending', 'rejected'].includes(r.status);
  const own = r.requester_id === user.id && intake;
  // Before approval, only the requester or an approver may remove it; team staff cannot bypass approval by deleting.
  if (!(own || user.is_admin || (intake ? isRequestApprover(user, r.type) : hasRole(user, REQUEST_TYPES[r.type])))) throw new HttpError(403, intake ? '접수대기 의뢰는 의뢰자 본인 또는 승인권자만 삭제할 수 있습니다.' : '삭제 권한이 없습니다.');
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
  applyListKeyword(where, args, query.q, ['product','spec','lot','note','created_by',"json_extract(bom_snapshot,'$.product_code')"]);
  if (query.done) { if (!['0','1'].includes(query.done)) throw bad('완료 상태를 확인하세요.'); where.push('done=?'); args.push(Number(query.done)); }
  if (query.period) { if (!['day','week','month'].includes(query.period)) throw bad('일정 기준을 확인하세요.'); where.push('period=?'); args.push(query.period); }
  // 기간과 겹치는 일정: 일간(그날), 주간(월~일), 월간(그 달)
  return (await db.prepare(`SELECT *,COALESCE((SELECT SUM(a.qty) FROM production_actuals a WHERE a.schedule_id=schedules.id AND a.voided_at IS NULL),0) AS actual_qty,(SELECT COUNT(*) FROM production_actuals a WHERE a.schedule_id=schedules.id AND a.voided_at IS NULL) AS actual_count FROM schedules WHERE kind=? AND (
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
  const hasActuals = await db.prepare('SELECT 1 FROM production_actuals WHERE schedule_id=?').get(row.id);
  if (hasActuals && (['product','kind','bom_id','spec','unit'].some(key => body[key] !== undefined && String(body[key] ?? '') !== String(row[key] ?? '')))) throw bad('생산실적이 있는 일정의 품목·규격·단위·BOM은 변경할 수 없습니다.');
  if (body.toggle_done) { await db.prepare('UPDATE schedules SET done=1-done WHERE id=?').run(row.id); return decodeSchedule(await mustGet('schedules', row.id)); }
  const f = await schedFields({ ...body, kind: row.kind }, row);
  if (hasActuals && ['product','period','start_date','bom_id'].some(key => f[key] !== row[key])) throw bad('생산실적이 있는 일정의 품목·기간·BOM은 변경할 수 없습니다.');
  await db.prepare('UPDATE schedules SET period=?,start_date=?,product=?,qty=?,note=?,bom_id=?,bom_snapshot=? WHERE id=?').run(f.period, f.start_date, f.product, f.qty, f.note, f.bom_id, f.bom_snapshot, row.id);
  return decodeSchedule(await mustGet('schedules', row.id));
});
route('DELETE', '/api/schedules/:id', async ({ user, params }) => {
  const row = (await mustGet('schedules', params.id)); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 삭제할 수 있습니다.');
  if (await db.prepare('SELECT 1 FROM production_actuals WHERE schedule_id=?').get(row.id)) throw bad('생산실적이 있는 일정은 삭제할 수 없습니다. 실적 이력을 확인하세요.');
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
  applyListKeyword(where, args, query.q, ['item','spec','lot','vendor','note','created_by',"json_extract(bom_snapshot,'$.product_code')"]);
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
  applyListKeyword(where, args, query.q, ['item','spec','customer','lot','note','created_by']);
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

// One submission creates independently tracked item rows in a single D1 transaction.
const BATCH_TABLES = { purchase_order: 'purchase_orders', request: 'requests', other_receipt: 'other_receipts', shipment: 'shipments', schedule: 'schedules', laundry: 'laundry' };
function lineMeta(body, previous = {}) {
  return Object.fromEntries(['spec','unit','lot'].map(key => [key, body[key] === undefined ? previous[key] || '' : str(body[key], key === 'unit' ? 20 : 100)]));
}
function insertItem(table, record) {
  const columns = Object.keys(record);
  return { sql: `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, args: Object.values(record) };
}
async function batchRows(entity, batchId) {
  const rows = await db.prepare(`SELECT * FROM ${BATCH_TABLES[entity]} WHERE batch_id=? ORDER BY id`).all(batchId);
  return rows.map(row => entity === 'request' ? decodeRequest(row) : entity === 'schedule' ? decodeSchedule(row) : entity === 'laundry' ? { ...row, photos: JSON.parse(row.photos) } : row);
}
route('POST', '/api/batches/:entity', async ({ user, params, body }) => {
  const entity = params.entity;
  if (!Object.hasOwn(BATCH_TABLES, entity)) throw bad('여러 품목을 등록할 목록을 확인하세요.');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) throw bad('품목은 한 번에 1~30개 등록하세요.');
  if (body.common !== undefined && (!body.common || typeof body.common !== 'object' || Array.isArray(body.common))) throw bad('공통 입력 내용을 확인하세요.');
  const batchId = body.request_id || randomHex(16);
  if (typeof batchId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(batchId)) throw bad('등록 요청 번호를 확인하세요.');
  const fingerprint = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([body.common || {}, body.items])))));
  const existing = await db.prepare('SELECT * FROM item_batches WHERE batch_id=?').get(batchId);
  const replay = async saved => {
    if (saved.entity_type !== entity || saved.author_id !== user.id || saved.payload_hash !== fingerprint) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.');
    return { batch_id: batchId, rows: await batchRows(entity, batchId), replayed: true };
  };
  if (existing) return replay(existing);
  const commands = [insertItem('item_batches', { batch_id: batchId, entity_type: entity, payload_hash: fingerprint, author_id: user.id, author_name: user.name })];
  for (const [index, item] of body.items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad(`${index + 1}번째 품목을 확인하세요.`);
    const b = { ...(body.common || {}), ...item }; const meta = lineMeta(b); let record;
    try {
      if (entity === 'purchase_order') {
        record = Object.fromEntries(['req_no','vendor','item','qty','due_date','note','item_category','coa_requested'].map((key,i) => [key, poFields(b)[i]]));
      } else if (entity === 'shipment') {
        record = Object.fromEntries(['ship_date','item','qty','customer','note','lot'].map((key,i) => [key, shipFields(b)[i]]));
      } else if (entity === 'other_receipt') {
        const fields = await otherReceiptFields(b);
        record = Object.fromEntries(['received_date','item','item_category','qty','vendor','note','bom_id','bom_snapshot'].map((key,i) => [key, fields[i]]));
        meta.unit = JSON.parse(record.bom_snapshot).unit || '';
      } else if (entity === 'schedule') {
        record = await schedFields({ ...b, product: b.product || b.item });
        if (record.bom_id) meta.unit = JSON.parse(record.bom_snapshot).unit || '';
      } else if (entity === 'laundry') {
        record = { in_date: dateStr(b.in_date, '입고일'), item: reqStr(b.item, '옷 종류', 200), in_qty: num(b.in_qty ?? b.qty, '입고수량'), discard_qty: num(b.discard_qty ?? 0, '폐기수량'), note: str(b.note, 500), photos: '[]' };
        if (record.discard_qty > record.in_qty) throw bad('폐기수량이 입고수량을 넘을 수 없습니다.');
      } else {
        const type = String(b.type || ''); if (!Object.hasOwn(REQUEST_TYPES, type)) throw bad('의뢰 종류를 확인하세요.');
        const qty = num(b.qty, '수량'); if (qty <= 0) throw bad('수량은 0보다 커야 합니다.');
        const data = { ...(b.data || {}), qty, spec: meta.spec, unit: meta.unit };
        if (type === 'analysis') { data.sample_qty = String(qty); data.lot = meta.lot ? '있음' : '없음'; data.lot_etc = meta.lot; }
        else { data.lot = meta.lot; if (type === 'sample') data.req_qty = String(qty); }
        const f = requestFields(type, { ...b, title: b.title || b.item, data });
        record = { type, title: f.title, customer: f.customer, due_date: f.due_date, category: f.category, target_price: f.target_price, data: JSON.stringify(f.data), qty, requester_id: user.id, requester_name: user.name };
      }
      if (entity !== 'request') record.created_by = user.name;
      commands.push(insertItem(BATCH_TABLES[entity], { ...record, ...meta, batch_id: batchId }));
      if (entity === 'other_receipt') commands.push(receiptAnalysisQuery('other_receipt', null, user));
    } catch (error) { if (error.status === 400 || error.status === 404) throw bad(`${index + 1}번째 품목: ${error.message}`); throw error; }
  }
  try { await db.batch(commands); }
  catch (error) {
    const saved = await db.prepare('SELECT * FROM item_batches WHERE batch_id=?').get(batchId);
    if (saved) return replay(saved);
    throw error;
  }
  return { batch_id: batchId, rows: await batchRows(entity, batchId), replayed: false };
});

route('PUT', '/api/items/:entity/:id', async ({ user, params, body }) => {
  if (!Object.hasOwn(BATCH_TABLES,params.entity)) throw bad('품목 목록을 확인하세요.');
  const row = await mustGet(BATCH_TABLES[params.entity],params.id);
  const role = { purchase_order:'purchase',shipment:'logistics',other_receipt:'logistics',laundry:'purchase',schedule:'production',request:REQUEST_TYPES[row.type] }[params.entity];
  const own = params.entity === 'request' ? row.requester_id === user.id && ['pending','rejected'].includes(row.status) : canModify(user,row);
  if (!own && !hasRole(user,role)) throw new HttpError(403,'등록자 또는 담당자만 규격·단위를 수정할 수 있습니다.');
  const meta = lineMeta(body,row);
  if (params.entity === 'schedule' && await db.prepare('SELECT 1 FROM production_actuals WHERE schedule_id=?').get(row.id)) {
    if (['spec','unit'].some(key => meta[key] !== (key === 'unit' ? row.unit || JSON.parse(row.bom_snapshot || '{}').unit || '' : row[key]))) throw bad('실적이 있는 생산일정의 규격·단위는 변경할 수 없습니다.');
  }
  if (['schedule','other_receipt'].includes(params.entity) && row.bom_id && meta.unit !== (JSON.parse(row.bom_snapshot).unit || '')) throw bad('BOM 품목의 단위는 BOM에 저장된 단위를 사용하세요.');
  if (row.source_type) { const snapshot = JSON.parse(row.data || '{}'); if (meta.spec !== (row.spec || snapshot.spec || '') || meta.unit !== (row.unit || snapshot.unit || '') || meta.lot !== (row.lot || snapshot.lot_etc || snapshot.lot || '')) throw bad('입고 자동분석의 품목 정보는 입고 당시 스냅샷을 유지합니다. 정정사항은 코멘트에 남기세요.'); }
  const set = ['spec=?','unit=?','lot=?']; const args = [meta.spec,meta.unit,meta.lot];
  if (params.entity === 'laundry') { set.push('item=?'); args.push(reqStr(body.item ?? row.item,'옷 종류',200)); }
  if (params.entity === 'request') {
    const data = JSON.parse(row.data || '{}'); data.spec = meta.spec; data.unit = meta.unit;
    if (row.type === 'analysis') { data.lot = meta.lot ? '있음' : '없음'; data.lot_etc = meta.lot; } else data.lot = meta.lot;
    set.push('data=?'); args.push(JSON.stringify(data));
  }
  await db.prepare(`UPDATE ${BATCH_TABLES[params.entity]} SET ${set.join(',')} WHERE id=?`).run(...args,row.id);
  return mustGet(BATCH_TABLES[params.entity],row.id);
});

// Actual production is an append-only dated log, distinct from completion checkboxes.
async function actualSchedule(user, id, write = false) {
  const row = await mustGet('schedules', id);
  if (write && !canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 생산실적을 입력할 수 있습니다.');
  return row;
}
route('GET', '/api/schedules/:id/actuals', async ({ user, params, query }) => {
  const schedule = await actualSchedule(user, params.id);
  if (query.before !== undefined && (!/^[1-9]\d*$/.test(query.before) || !Number.isSafeInteger(Number(query.before)))) throw bad('생산실적 조회 위치를 확인하세요.');
  const rows = await db.prepare(`SELECT * FROM production_actuals WHERE schedule_id=? ${query.before ? 'AND id<?' : ''} ORDER BY id DESC LIMIT 51`).all(schedule.id, ...(query.before ? [Number(query.before)] : []));
  const page = rows.slice(0,50);
  const actual = (await db.prepare('SELECT COALESCE(SUM(qty),0) AS qty FROM production_actuals WHERE schedule_id=? AND voided_at IS NULL').get(schedule.id)).qty;
  const pending = await db.prepare("SELECT * FROM production_actual_changes WHERE schedule_id=? AND status='pending'").all(schedule.id);
  const changes = await db.prepare('SELECT * FROM production_actual_changes WHERE schedule_id=? ORDER BY id DESC LIMIT 50').all(schedule.id);
  return { schedule: decodeSchedule(schedule), rows: page.map(row => ({ ...row, pending_change: pending.find(c => c.actual_id === row.id) || null })), changes, can_approve: !!user.is_admin || publicUser(user).roles.includes('production_approver'), next: rows.length > 50 ? page.at(-1).id : null, actual_qty: actual, variance_qty: actual - schedule.qty, achievement_rate: schedule.qty ? Math.round(actual / schedule.qty * 1000) / 10 : null, can_write: canModify(user, schedule) || hasRole(user, 'production') };
});
route('POST', '/api/schedules/:id/actuals', async ({ user, params, body }) => {
  const schedule = await actualSchedule(user, params.id, true);
  const date = dateStr(body.production_date, '생산일'); const qty = num(body.qty, '실제 생산량');
  const end = await actualPeriodEnd(schedule);
  if (date < schedule.start_date || date > end) throw bad('생산일은 해당 계획의 기간 안에서 선택하세요.');
  if (date > today()) throw bad('아직 지나지 않은 날짜의 생산실적은 입력할 수 없습니다.');
  const key = reqStr(body.request_id, '실적 요청 번호', 80);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('실적 요청 번호를 확인하세요.');
  const note = str(body.note, 1000);
  const old = await db.prepare('SELECT * FROM production_actuals WHERE request_id=?').get(key);
  const matches = row => row.schedule_id === schedule.id && row.author_id === user.id && row.production_date === date && row.qty === qty && row.note === note;
  if (old) { if (!matches(old)) throw new HttpError(409, '이미 사용된 실적 요청 번호입니다.'); return old; }
  try { const result = await db.prepare('INSERT INTO production_actuals(schedule_id,production_date,qty,note,author_id,author_name,request_id) VALUES(?,?,?,?,?,?,?)').run(schedule.id,date,qty,note,user.id,user.name,key); return db.prepare('SELECT * FROM production_actuals WHERE id=?').get(result.lastInsertRowid); }
  catch (error) { const saved = await db.prepare('SELECT * FROM production_actuals WHERE request_id=?').get(key); if (saved && matches(saved)) return saved; throw error; }
});
// Recorded actuals change only through a request approved by a production team lead (production_approver) or admin.
async function actualPeriodEnd(schedule) {
  return schedule.period === 'day' ? schedule.start_date : (await db.prepare(`SELECT date(?,${schedule.period === 'week' ? "'+6 days'" : "'+1 month','-1 day'"}) AS end`).get(schedule.start_date)).end;
}
async function requestActualChange(user, params, body, action) {
  const schedule = await actualSchedule(user, params.id, true);
  const row = await db.prepare('SELECT * FROM production_actuals WHERE id=? AND schedule_id=?').get(params.actualId, schedule.id);
  if (!row) throw new HttpError(404, '생산실적을 찾을 수 없습니다.');
  if (row.voided_at) throw bad('이미 취소된 생산실적입니다.');
  const reason = reqStr(body.reason, action === 'void' ? '취소 사유' : '수정 사유', 500);
  const key = body.request_id === undefined ? randomHex(16) : String(body.request_id);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('요청 번호를 확인하세요.');
  let next = { date: null, qty: null, note: null };
  if (action === 'edit') {
    next = { date: dateStr(body.production_date ?? row.production_date, '생산일'), qty: num(body.qty ?? row.qty, '실제 생산량'), note: body.note === undefined ? row.note : str(body.note, 1000) };
    if (next.date < schedule.start_date || next.date > await actualPeriodEnd(schedule)) throw bad('생산일은 해당 계획의 기간 안에서 선택하세요.');
    if (next.date > today()) throw bad('아직 지나지 않은 날짜의 생산실적은 입력할 수 없습니다.');
    if (next.date === row.production_date && next.qty === row.qty && next.note === row.note) throw bad('바뀐 내용이 없습니다.');
  }
  const same = c => c.actual_id === row.id && c.action === action && c.requested_by_id === user.id && c.new_date === next.date && c.new_qty === next.qty && c.new_note === next.note && c.reason === reason;
  const old = await db.prepare('SELECT * FROM production_actual_changes WHERE request_id=?').get(key);
  if (old) { if (!same(old)) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return { pending: old.status === 'pending', change: old }; }
  if (await db.prepare("SELECT 1 FROM production_actual_changes WHERE actual_id=? AND status='pending'").get(row.id)) throw new HttpError(409, '이 실적에는 이미 승인 대기 중인 수정·취소 요청이 있습니다.');
  try {
    const r = await db.prepare('INSERT INTO production_actual_changes(actual_id,schedule_id,action,request_id,old_date,old_qty,old_note,new_date,new_qty,new_note,reason,requested_by_id,requested_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(row.id, schedule.id, action, key, row.production_date, row.qty, row.note, next.date, next.qty, next.note, reason, user.id, user.name);
    return { pending: true, change: await db.prepare('SELECT * FROM production_actual_changes WHERE id=?').get(r.lastInsertRowid) };
  } catch (error) {
    const saved = await db.prepare('SELECT * FROM production_actual_changes WHERE request_id=?').get(key);
    if (saved && same(saved)) return { pending: true, change: saved };
    if (await db.prepare("SELECT 1 FROM production_actual_changes WHERE actual_id=? AND status='pending'").get(row.id)) throw new HttpError(409, '이 실적에는 이미 승인 대기 중인 수정·취소 요청이 있습니다.');
    throw error;
  }
}
route('POST', '/api/schedules/:id/actuals/:actualId/void', async ({ user, params, body }) => requestActualChange(user, params, body, 'void'));
route('POST', '/api/schedules/:id/actuals/:actualId/changes', async ({ user, params, body }) => requestActualChange(user, params, body, 'edit'));
const actualChangeSelect = `SELECT c.*, s.product, s.spec, s.kind, s.period, s.start_date, COALESCE(NULLIF(s.unit,''),json_extract(s.bom_snapshot,'$.unit'),'') AS unit
  FROM production_actual_changes c JOIN schedules s ON s.id=c.schedule_id`;
route('GET', '/api/actual-changes', async ({ query }) => {
  const where = [], args = [];
  if (query.status) { if (!['pending','approved','rejected','cancelled'].includes(query.status)) throw bad('요청 상태를 확인하세요.'); where.push('c.status=?'); args.push(query.status); }
  if (query.kind) { if (!['finished','semi'].includes(query.kind)) throw bad('생산 구분을 확인하세요.'); where.push('s.kind=?'); args.push(query.kind); }
  if (query.schedule_id) { if (!/^[1-9]\d*$/.test(query.schedule_id)) throw bad('일정 번호를 확인하세요.'); where.push('c.schedule_id=?'); args.push(Number(query.schedule_id)); }
  return db.prepare(`${actualChangeSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id DESC LIMIT 200`).all(...args);
});
async function pendingChange(id) {
  if (!/^[1-9]\d*$/.test(String(id))) throw bad('요청 번호를 확인하세요.');
  const change = await db.prepare('SELECT * FROM production_actual_changes WHERE id=?').get(Number(id));
  if (!change) throw new HttpError(404, '수정 요청을 찾을 수 없습니다.');
  if (change.status !== 'pending') throw new HttpError(409, '이미 처리된 요청입니다.');
  return change;
}
function requireActualApprover(user) {
  if (!user.is_admin && !publicUser(user).roles.includes('production_approver')) throw new HttpError(403, '생산팀장(실적 수정 승인권자)만 승인·반려할 수 있습니다. 관리자에게 지정을 요청하세요.');
}
route('POST', '/api/actual-changes/:id/approve', async ({ user, params, body }) => {
  requireActualApprover(user);
  const change = await pendingChange(params.id); const stamp = now();
  const actual = await db.prepare('SELECT * FROM production_actuals WHERE id=?').get(change.actual_id);
  if (!actual || actual.voided_at || actual.production_date !== change.old_date || actual.qty !== change.old_qty || actual.note !== change.old_note) throw new HttpError(409, '요청 이후 실적이 바뀌었습니다. 반려하고 새로 요청하세요.');
  if (change.action === 'edit' && change.new_date > today()) throw bad('아직 지나지 않은 날짜로는 승인할 수 없습니다.');
  // The status guard runs first; the actual update only applies once that request is approved.
  const results = await db.batch([
    { sql: "UPDATE production_actual_changes SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'", args: [user.name, stamp, str(body.note, 500), change.id] },
    change.action === 'edit'
      ? { sql: "UPDATE production_actuals SET production_date=?,qty=?,note=?,corrected_at=?,corrected_by=? WHERE id=? AND voided_at IS NULL AND EXISTS(SELECT 1 FROM production_actual_changes WHERE id=? AND status='approved' AND reviewed_at=?)", args: [change.new_date, change.new_qty, change.new_note, stamp, user.name, change.actual_id, change.id, stamp] }
      : { sql: "UPDATE production_actuals SET voided_at=?,voided_by=?,void_reason=? WHERE id=? AND voided_at IS NULL AND EXISTS(SELECT 1 FROM production_actual_changes WHERE id=? AND status='approved' AND reviewed_at=?)", args: [stamp, `${change.requested_by} (승인: ${user.name})`, change.reason, change.actual_id, change.id, stamp] },
  ]);
  if (!results[0].meta.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return db.prepare(`${actualChangeSelect} WHERE c.id=?`).get(change.id);
});
route('POST', '/api/actual-changes/:id/reject', async ({ user, params, body }) => {
  requireActualApprover(user);
  const change = await pendingChange(params.id);
  const r = await db.prepare("UPDATE production_actual_changes SET status='rejected',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'").run(user.name, now(), reqStr(body.note, '반려 사유', 500), change.id);
  if (!r.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return db.prepare(`${actualChangeSelect} WHERE c.id=?`).get(change.id);
});
route('POST', '/api/actual-changes/:id/cancel', async ({ user, params }) => {
  const change = await pendingChange(params.id);
  if (change.requested_by_id !== user.id && !user.is_admin) throw new HttpError(403, '요청한 사람만 철회할 수 있습니다.');
  const r = await db.prepare("UPDATE production_actual_changes SET status='cancelled',reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'").run(user.name, now(), change.id);
  if (!r.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return { ok: true };
});

route('GET', '/api/reports', async ({ query }) => buildReport(db, query, today()));

// ── 내가 처리할 일: 내가 승인할 수 있는 대기 건과 내가 올린 요청의 상태 ──
route('GET', '/api/my-tasks', async ({ user }) => {
  const roles = publicUser(user).roles;
  const approvals = { requests: {} };
  for (const type of Object.keys(REQUEST_TYPES)) {
    if (!isRequestApprover(user, type)) continue;
    const count = (await db.prepare("SELECT COUNT(*) c FROM requests WHERE type=? AND status='pending'").get(type)).c;
    const items = count ? await db.prepare("SELECT id,title,customer,requester_name,created_at FROM requests WHERE type=? AND status='pending' ORDER BY id LIMIT 5").all(type) : [];
    approvals.requests[type] = { count, items };
  }
  if (user.is_admin || roles.includes('production_approver')) {
    const items = await db.prepare(`${actualChangeSelect} WHERE c.status='pending' ORDER BY c.id LIMIT 50`).all();
    approvals.actual_changes = { count: items.length, finished: items.filter(c => c.kind === 'finished').length, semi: items.filter(c => c.kind === 'semi').length, items: items.slice(0, 5) };
  }
  if (user.is_admin || roles.includes('logistics_approver')) {
    const items = await db.prepare(`${receiptChangeSelect} WHERE c.status='pending' ORDER BY c.id LIMIT 50`).all();
    approvals.receipt_changes = { count: items.length, items: items.slice(0, 5) };
  }
  // My own requests still waiting, plus rejections from the last 7 days so the requester notices them.
  const recent = "(c.status='pending' OR (c.status='rejected' AND c.reviewed_at>=date('now','+9 hours','-7 days')))";
  const mine = {
    requests: await db.prepare("SELECT id,type,status,title,reject_reason,approver_name,created_at FROM requests WHERE requester_id=? AND status IN ('pending','rejected') ORDER BY id DESC LIMIT 20").all(user.id),
    actual_changes: await db.prepare(`${actualChangeSelect} WHERE c.requested_by_id=? AND ${recent} ORDER BY c.id DESC LIMIT 20`).all(user.id),
    receipt_changes: await db.prepare(`${receiptChangeSelect} WHERE c.requested_by_id=? AND ${recent} ORDER BY c.id DESC LIMIT 20`).all(user.id),
  };
  return { approvals, mine };
});

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
    actualChangesPending: (await c("SELECT COUNT(*) c FROM production_actual_changes WHERE status='pending'")),
    receiptChangesPending: (await c("SELECT COUNT(*) c FROM receipt_qty_changes WHERE status='pending'")),
  };
});

async function mustGet(table, id) { const r = (await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)); if (!r) throw new HttpError(404, '항목을 찾을 수 없습니다.'); return r; }


return { async fetch(req) {
  const res = new Headers({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  try {
    const url = new URL(req.url); let p;
    try { p = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, '잘못된 주소입니다.'); }
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
