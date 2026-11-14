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
const ROLES = ['operator', 'purchase', 'quality', 'quality_approver', 'dev', 'dev_approver', 'production', 'production_approver', 'logistics', 'logistics_approver'];
const REQUEST_TYPES = { voc: 'quality', analysis: 'quality', development: 'dev', sample: 'production', sample_goods: 'purchase' };
const REQUEST_PREFIX = { voc: 'V', analysis: 'Q', development: 'D', sample: 'S', sample_goods: 'G' };
const ANALYSIS_CATEGORIES = ['수입검사', '의뢰검사', '출하검사', '공정검사'];
const WORK_STATUSES = ['waiting', 'progress', 'done'];
const ITEM_CATEGORIES = ['원자재', '부자재', '반제품', '제품', '상품'];
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
function isOperator(user) { return !!user && !user.is_admin && publicUser(user).roles.includes('operator'); }
function operatorRequestAllowed(method, path) {
  if (method === 'GET' && (/^\/api\/requests\/[1-9]\d*\/inspection(?:\/history\/[1-9]\d*)?$/.test(path) || path === '/api/inspections')) return true;
  if (method === 'GET') return ['/api/me', '/api/operator/catalog', '/api/operator/semi-records', '/api/operator/plans', '/api/operator/actuals'].includes(path);
  return (method === 'PUT' && path === '/api/me/password') || (method === 'POST' && (['/api/auth/logout', '/api/auth/login', '/api/semi-batches'].includes(path) || /^\/api\/schedules\/[1-9]\d*\/actuals$/.test(path)));
}
function isRequestApprover(user, type) {
  return hasRole(user, { voc: 'quality_approver', analysis: 'quality_approver', development: 'dev_approver', sample: 'production', sample_goods: 'purchase' }[type]);
}
function requireRequestApprover(user, type) {
  const label = { voc: '품질팀장(품질책임자)', analysis: '품질책임자', development: '개발책임자', sample: '생산담당자', sample_goods: '구매담당자' }[type];
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
  if (type === 'request' && !['development','sample','sample_goods','voc'].includes(row.type)) throw bad('개발·샘플 의뢰서와 VOC에 사진을 첨부할 수 있습니다.');
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
// An administrator can open an account directly; it is approved from the start.
route('POST', '/api/admin/users', async ({ user, body }) => {
  requireAdmin(user);
  const name = reqStr(body.name, '이름', 30), password = String(body.password || '');
  if (password.length < 4) throw bad('비밀번호는 4자 이상이어야 합니다.');
  const roles = Array.isArray(body.roles) ? body.roles : []; if (roles.some(r => !ROLES.includes(r))) throw bad('권한이 올바르지 않습니다.');
  if (await db.prepare('SELECT 1 FROM users WHERE name=?').get(name)) throw bad('이미 있는 이름입니다.');
  const salt = randomHex(16);
  const r = await db.prepare("INSERT INTO users(name,pw_salt,pw_hash,is_admin,roles,approval_status,reviewed_by,reviewed_at) VALUES(?,?,?,0,?,'approved',?,?)").run(name, salt, await hashPw(password, salt), [...new Set(roles)].join(','), user.name, now());
  return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid));
});
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
const backupTables = ['settings', 'users', 'purchase_orders', 'laundry', 'requests', 'schedules', 'shipments', 'other_receipts', 'boms', 'attachments', 'progress_comments', 'item_batches', 'production_actuals', 'production_actual_changes', 'receipt_qty_changes', 'stock_adjustments', 'stock_levels', 'vendors', 'production_units', 'semi_records', 'semi_record_changes', 'laundry_reports', 'laundry_report_lines', 'inspection_specs', 'inspection_spec_keys', 'inspection_measurements', 'inspection_measurement_history'];
route('GET', '/api/admin/backup', async ({ user, query }) => {
  requireAdmin(user);
  if (!query.table) return { format: 'work-process-v2', tables: backupTables };
  if (!backupTables.includes(query.table)) throw bad('백업할 표가 올바르지 않습니다.');
  const key = query.table === 'settings' ? 'key' : query.table === 'item_batches' ? 'batch_id' : query.table === 'stock_levels' ? 'rowid' : 'id';
  const after = ['id', 'rowid'].includes(key) ? Number(query.after || 0) : String(query.after || '');
  if (typeof after === 'number' && (!Number.isSafeInteger(after) || after < 0)) throw bad('백업 위치가 올바르지 않습니다.');
  const rows = await db.prepare(`SELECT ${key === 'rowid' ? 'rowid,' : ''}* FROM ${query.table} WHERE ${key}>? ORDER BY ${key} LIMIT 200`).all(after);
  return { rows, next: rows.length === 200 ? rows.at(-1)[key] : null };
});

// ── 거래처 목록 · 제품코드 ──
// Names are compared without spaces/case so '니트릴글러브' and '니트릴 글러브' resolve to one entry.
const nameKey = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
// Using a vendor name anywhere registers it, so the pick list fills itself; contact details can be added later.
async function ensureVendor(name, user) {
  const clean = str(name, 100); if (!clean) return;
  await db.prepare('INSERT INTO vendors(name,name_key,created_by) VALUES(?,?,?) ON CONFLICT(name_key) DO NOTHING').run(clean, nameKey(clean), user.name);
}
// Resolve an item row to the catalog (boms). A chosen code wins; a typed name matches an existing entry
// ignoring spaces/case; otherwise a temporary code is issued for an administrator to tidy up later.
async function catalogItem(user, { bom_id, item, unit, item_category }) {
  if (bom_id !== undefined && bom_id !== null && bom_id !== '') {
    const id = Number(bom_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad('품목 코드를 다시 선택하세요.');
    const bom = await mustGet('boms', id); if (!bom.active) throw bad('사용 중지된 품목입니다.');
    return bom;
  }
  const name = reqStr(item, '품목명', 200);
  const found = await db.prepare("SELECT * FROM boms WHERE REPLACE(LOWER(product),' ','')=? AND active=1 ORDER BY is_temp, id LIMIT 1").get(nameKey(name));
  if (found) return found;
  const r = await db.prepare("INSERT INTO boms(product,product_code,kind,base_qty,unit,materials,note,active,item_category,created_by,is_temp) VALUES(?,'','finished',1,?,'[]','직접 입력으로 자동 생성된 임시 품목',1,?,?,1)")
    .run(name, str(unit, 20), ITEM_CATEGORIES.includes(item_category) ? item_category : '', user.name);
  await db.prepare("UPDATE boms SET product_code='TMP-' || printf('%04d', id) WHERE id=?").run(r.lastInsertRowid);
  return mustGet('boms', r.lastInsertRowid);
}
route('GET', '/api/vendors', async ({ query }) => {
  const where = [], args = [];
  applyListKeyword(where, args, query.q, ['name', 'contact_name', 'phone']);
  return db.prepare(`SELECT * FROM vendors ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name LIMIT 1000`).all(...args);
});
function vendorFields(body) { return [reqStr(body.name, '거래처 이름', 100), str(body.contact_name, 50), str(body.phone, 30)]; }
route('POST', '/api/vendors', async ({ user, body }) => {
  const [name, contact, phone] = vendorFields(body);
  if (await db.prepare('SELECT 1 FROM vendors WHERE name_key=?').get(nameKey(name))) throw new HttpError(409, '이미 등록된 거래처입니다. 목록에서 수정하세요.');
  const r = await db.prepare('INSERT INTO vendors(name,name_key,contact_name,phone,created_by) VALUES(?,?,?,?,?)').run(name, nameKey(name), contact, phone, user.name);
  return mustGet('vendors', r.lastInsertRowid);
});
route('PUT', '/api/vendors/:id', async ({ user, params, body }) => {
  const row = await mustGet('vendors', params.id); const [name, contact, phone] = vendorFields(body);
  const clash = await db.prepare('SELECT id FROM vendors WHERE name_key=?').get(nameKey(name));
  if (clash && clash.id !== row.id) throw new HttpError(409, '같은 이름의 거래처가 이미 있습니다.');
  await db.prepare('UPDATE vendors SET name=?,name_key=?,contact_name=?,phone=?,updated_by=?,updated_at=? WHERE id=?').run(name, nameKey(name), contact, phone, user.name, now(), row.id);
  return mustGet('vendors', row.id);
});
route('DELETE', '/api/vendors/:id', async ({ user, params }) => {
  const row = await mustGet('vendors', params.id);
  if (!canModify(user, row)) throw new HttpError(403, '거래처 삭제는 등록자 또는 관리자만 할 수 있습니다.');
  await db.prepare('DELETE FROM vendors WHERE id=?').run(row.id); return { ok: true }; // past orders keep the vendor name they were saved with
});
// What we most recently bought from this vendor, newest first, one line per item/size/unit.
route('GET', '/api/vendors/recent-items', async ({ query }) => {
  const key = nameKey(reqStr(query.vendor, '거래처', 100));
  const vendor = await db.prepare('SELECT * FROM vendors WHERE name_key=?').get(key);
  const items = await db.prepare(`SELECT item, spec, unit, item_category, product_code, qty, due_date, MAX(id) AS last_id, COUNT(*) AS orders
    FROM purchase_orders WHERE REPLACE(LOWER(vendor),' ','')=? GROUP BY item, spec, unit ORDER BY last_id DESC LIMIT 12`).all(key);
  return { vendor: vendor || null, items };
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
  const inspection = inspectionSnapshotSQL('src.item', "'수입검사'", 'src.item_category', purchase ? 'src.product_code' : "json_extract(src.bom_snapshot,'$.product_code')");
  return {
    sql: `INSERT INTO requests(type,status,req_no,title,customer,category,data,requester_id,requester_name,approver_name,approved_at,source_type,source_id,batch_id,spec,unit,lot,qty,inspection_snapshot)
      SELECT 'analysis','waiting',
        ? || printf('%02d', (SELECT COALESCE(MAX(CAST(substr(req_no,length(?) + 1) AS INTEGER)),0)+1 FROM requests WHERE req_no LIKE ?)),
        src.item,src.vendor,'수입검사',
        json_object('purpose','입고 수입검사','sample_qty',CAST(${qty} AS TEXT),
          'source_label',?,'received_date',${date},'item_category',src.item_category,
          'received_qty',${qty},'coa_requested',${coa},
          'purchase_req_no',${purchase ? 'src.req_no' : "''"},
          'bom_id',${purchase ? 'NULL' : 'src.bom_id'},
          'product_code',${purchase ? "src.product_code" : "COALESCE(json_extract(src.bom_snapshot,'$.product_code'),'')"},
          'unit',COALESCE(NULLIF(src.unit,''),${purchase ? "''" : "json_extract(src.bom_snapshot,'$.unit')"},''),'spec',src.spec,'lot',src.lot,'lot_etc',src.lot,'qty',${qty},
          'result_type',CASE WHEN ${coa}=1 THEN 'COA발행' ELSE '기본(데이터공유)' END,'extra',src.note),
        ?,?,'입고 자동접수',datetime('now','+9 hours'),?,src.id,src.batch_id,src.spec,src.unit,src.lot,${qty},${inspection}
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
  // A chosen code supplies the item name (and class when none was given).
  if (body.bom_id) { const chosen = await catalogItem(user, body); body.item = chosen.product; if (!body.item_category && ITEM_CATEGORIES.includes(chosen.item_category)) body.item_category = chosen.item_category; }
  const f = poFields(body); const entry = await catalogItem(user, body); await ensureVendor(f[1], user);
  const r = (await db.prepare('INSERT INTO purchase_orders(req_no,vendor,item,qty,due_date,note,item_category,coa_requested,created_by,product_code,unit) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(f[0], f[1], entry.product, ...f.slice(3), user.name, entry.product_code, str(body.unit, 20) || entry.unit));
  return (await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(r.lastInsertRowid));
});
route('PUT', '/api/po/:id', async ({ user, params, body }) => {
  const row = (await mustGet('purchase_orders', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 수정할 수 있습니다.');
  const f = poFields(body);
  // Keep the linked code unless the item name itself was changed.
  const entry = nameKey(f[2]) === nameKey(row.item) && row.product_code && body.bom_id === undefined ? { product: row.item, product_code: row.product_code } : await catalogItem(user, body);
  await ensureVendor(f[1], user);
  (await db.prepare('UPDATE purchase_orders SET req_no=?,vendor=?,item=?,qty=?,due_date=?,note=?,item_category=?,coa_requested=?,product_code=? WHERE id=?').run(f[0], f[1], entry.product, ...f.slice(3), entry.product_code, row.id));
  await recordEdit('purchase_order', 'purchase_orders', row.id, row, EDIT_LABELS.purchase_order, user);
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
  if (query.id !== undefined) { if (!/^[1-9]\d*$/.test(query.id)) throw bad('요청 번호를 확인하세요.'); where.push('c.id=?'); args.push(Number(query.id)); }
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

// ── 구매: 세탁 검수·성적서 ──
// The laundry vendor sends a list per wash date; we inspect it, keep the cumulative record and issue the
// confirmation sheet (성적서) per department. Layout follows the paper form: garments × sizes.
const LAUNDRY_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL'];
const LAUNDRY_FORMS = [
  { key: 'prod', label: '생산', size_labels: { L: 'L / 310' }, garments: [
    { key: 'op_white', group: '원피스', label: '흰색', price: 'onepiece', parts: ['방진복', '후드', '덧신'] },
    { key: 'op_sky', group: '원피스', label: '하늘색', price: 'onepiece', parts: ['방진복', '후드', '덧신'] },
    { key: 'tp_navy', group: '투피스', label: '남색', price: 'twopiece', parts: ['상', '하'] },
    { key: 'shoes', group: '안전화', label: '', price: 'shoes', parts: ['안전화'] },
  ] },
  { key: 'qc', label: 'QC', size_labels: { S: 'S / 95', M: 'M / 100', L: 'L / 105', XL: 'XL / 110' }, garments: [
    { key: 'gown_zip', group: '가운', label: 'Y카라, 앞지퍼형 S/B', price: 'gown', parts: ['가운'] },
    { key: 'gown_lab', group: '가운', label: '실험실, 앞단추형 WT', price: 'gown', parts: ['가운'] },
    { key: 'tp_white', group: '투피스', label: '흰색', price: 'twopiece', parts: ['상', '하'] },
  ] },
];
const LAUNDRY_GARMENTS = new Map(LAUNDRY_FORMS.flatMap(form => form.garments.map(g => [g.key, { ...g, form: form.key }])));
const LAUNDRY_PRICE_KEYS = ['onepiece', 'twopiece', 'gown', 'shoes'];
const LAUNDRY_PARTS = ['방진복', '후드', '덧신', '상', '하', '가운', '안전화'];
const canLaundryMoney = user => hasRole(user, 'purchase');
// Unit prices are entered in the app (never shipped in code): vendor = what we pay, customer = what we bill.
async function laundrySettings() {
  let saved = {}; try { saved = JSON.parse(await getSetting('laundry_report_settings') || '{}'); } catch { saved = {}; }
  const table = (source, keys) => Object.fromEntries(keys.map(k => [k, Number(source?.[k]) >= 0 ? Number(source[k]) : 0]));
  return {
    customer: str(saved.customer, 60) || 'Merck', vendor: str(saved.vendor, 60) || 'CNC+', inspector: str(saved.inspector, 120),
    signature: /^[a-f0-9]{24}\.(jpg|png|webp)$/.test(saved.signature || '') ? saved.signature : '',
    prices: { vendor: table(saved.prices?.vendor, LAUNDRY_PRICE_KEYS), customer: table(saved.prices?.customer, LAUNDRY_PRICE_KEYS), discard: table(saved.prices?.discard, LAUNDRY_PARTS) },
  };
}
function laundryLines(input) {
  if (!Array.isArray(input)) throw bad('수량 목록이 올바르지 않습니다.');
  const seen = new Map();
  for (const line of input) {
    const section = line?.section, garment = LAUNDRY_GARMENTS.get(line?.garment), size = String(line?.size ?? '');
    if (!['wash', 'discard'].includes(section) || !garment || !LAUNDRY_SIZES.includes(size)) throw bad('수량 목록에 알 수 없는 항목이 있습니다.');
    const part = section === 'wash' ? '' : String(line.part ?? ''); if (section === 'discard' && !garment.parts.includes(part)) throw bad('폐기 구분이 올바르지 않습니다.');
    if (line.qty === '' || line.qty == null) continue;
    const qty = Number(line.qty); if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) throw bad('수량은 0 이상의 정수로 입력하세요.');
    const key = [section, garment.key, part, size].join('|'); if (seen.has(key)) throw bad('같은 칸이 두 번 들어 있습니다.');
    if (qty > 0) seen.set(key, { section, garment: garment.key, part, size, qty });
  }
  return [...seen.values()];
}
function laundrySummary(lines, prices) {
  const wash = Object.fromEntries([...LAUNDRY_GARMENTS.keys()].map(k => [k, 0])); const sum = { wash, wash_total: 0, discard_total: 0, prod_total: 0, qc_total: 0, vendor_cost: 0, customer_amount: 0, discard_amount: 0 };
  for (const line of lines) {
    const garment = LAUNDRY_GARMENTS.get(line.garment); if (!garment) continue;
    if (line.section === 'wash') {
      wash[line.garment] += line.qty; sum.wash_total += line.qty; sum[garment.form + '_total'] += line.qty;
      sum.vendor_cost += line.qty * (prices.vendor[garment.price] || 0); sum.customer_amount += line.qty * (prices.customer[garment.price] || 0);
    } else { sum.discard_total += line.qty; sum[garment.form + '_total'] += line.qty; sum.discard_amount += line.qty * (prices.discard[line.part] || 0); }
  }
  sum.profit = sum.customer_amount - sum.vendor_cost; return sum;
}
function laundryReportPrices(report, current) { if (report.status === 'issued' && report.prices) { try { return JSON.parse(report.prices); } catch { /* fall through */ } } return current; }
function laundryReportView(report, lines, settings, user) {
  const summary = laundrySummary(lines, laundryReportPrices(report, settings.prices)); const { prices, ...rest } = report;
  if (!canLaundryMoney(user)) for (const k of ['vendor_cost', 'customer_amount', 'discard_amount', 'profit']) delete summary[k];
  return { ...rest, summary, can_edit: canModify(user, report) || hasRole(user, 'purchase') };
}
async function laundryReport(id) { const r = await db.prepare('SELECT * FROM laundry_reports WHERE id=?').get(id); if (!r) throw new HttpError(404, '검수 기록을 찾을 수 없습니다.'); return r; }
function requireLaundryEditor(user, report) { if (!canModify(user, report) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 할 수 있습니다.'); }
function laundryHeader(body) { return { wash_date: dateStr(body.wash_date, '세탁일'), pickup_label: str(body.pickup_label, 40), inspector: str(body.inspector, 120), note: str(body.note, 500) }; }

route('GET', '/api/laundry-report-meta', async ({ user }) => {
  const settings = await laundrySettings(); const money = canLaundryMoney(user);
  return { sizes: LAUNDRY_SIZES, forms: LAUNDRY_FORMS, price_keys: LAUNDRY_PRICE_KEYS, parts: LAUNDRY_PARTS, customer: settings.customer, vendor: settings.vendor, inspector: settings.inspector, can_money: money, prices: money ? settings.prices : null, signature: money ? settings.signature : '', can_import: !!user.is_admin };
});
route('PUT', '/api/laundry-report-settings', async ({ user, body }) => {
  if (!canLaundryMoney(user)) throw new HttpError(403, '구매 담당자만 설정을 바꿀 수 있습니다.');
  const price = (source, keys, label) => Object.fromEntries(keys.map(k => [k, num(source?.[k] === '' || source?.[k] == null ? 0 : source[k], label)]));
  const next = { customer: reqStr(body.customer, '고객사', 60), vendor: reqStr(body.vendor, '세탁 업체', 60), inspector: str(body.inspector, 120),
    prices: { vendor: price(body.prices?.vendor, LAUNDRY_PRICE_KEYS, '세탁 업체 단가'), customer: price(body.prices?.customer, LAUNDRY_PRICE_KEYS, '고객사 단가'), discard: price(body.prices?.discard, LAUNDRY_PARTS, '폐기 단가') } };
  // The confirmer's signature image: kept when untouched, replaced by a new upload, or removed on request.
  const current = await laundrySettings(); next.signature = body.remove_signature ? '' : current.signature;
  const uploaded = body.signature ? await savePhotos([body.signature]) : [];
  if (uploaded.length) next.signature = uploaded[0];
  try { await setSetting('laundry_report_settings', JSON.stringify(next)); } catch (error) { await removePhotos(uploaded); throw error; }
  // An old image stays in storage while an issued sheet still shows it.
  if (current.signature && current.signature !== next.signature && !(await db.prepare('SELECT 1 FROM laundry_reports WHERE signature=?').get(current.signature))) await removePhotos([current.signature]);
  return { ok: true, signature: next.signature };
});
route('GET', '/api/laundry-reports', async ({ user, query }) => {
  const args = [], where = []; applyListDates(where, args, query, 'wash_date');
  const reports = await db.prepare(`SELECT * FROM laundry_reports ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY wash_date DESC, id DESC`).all(...args);
  const lines = await db.prepare(`SELECT l.* FROM laundry_report_lines l JOIN laundry_reports r ON r.id=l.report_id ${where.length ? 'WHERE ' + where.map(w => 'r.' + w).join(' AND ') : ''}`).all(...args);
  const byReport = new Map(); for (const line of lines) { if (!byReport.has(line.report_id)) byReport.set(line.report_id, []); byReport.get(line.report_id).push(line); }
  const settings = await laundrySettings(); const matrix = {};
  for (const line of lines) { const key = [line.section, line.garment, line.part, line.size].join('|'); matrix[key] = (matrix[key] || 0) + line.qty; }
  return { rows: reports.map(r => laundryReportView(r, byReport.get(r.id) || [], settings, user)), matrix };
});
route('GET', '/api/laundry-reports/:id', async ({ user, params }) => {
  const report = await laundryReport(params.id); const lines = await db.prepare('SELECT section,garment,part,size,qty FROM laundry_report_lines WHERE report_id=?').all(report.id);
  return { ...laundryReportView(report, lines, await laundrySettings(), user), lines };
});
route('POST', '/api/laundry-reports', async ({ user, body }) => {
  const head = laundryHeader(body), lines = laundryLines(body.lines);
  if (await db.prepare('SELECT 1 FROM laundry_reports WHERE wash_date=?').get(head.wash_date)) throw new HttpError(409, '이 세탁일의 검수 기록이 이미 있습니다. 기존 기록을 열어 수정하세요.');
  const r = await db.prepare('INSERT INTO laundry_reports(wash_date,pickup_label,inspector,note,created_by) VALUES(?,?,?,?,?)').run(head.wash_date, head.pickup_label, head.inspector, head.note, user.name);
  const id = Number(r.lastInsertRowid);
  if (lines.length) await db.batch(lines.map(l => ({ sql: 'INSERT INTO laundry_report_lines(report_id,section,garment,part,size,qty) VALUES(?,?,?,?,?,?)', args: [id, l.section, l.garment, l.part, l.size, l.qty] })));
  return { id };
});
route('PUT', '/api/laundry-reports/:id', async ({ user, params, body }) => {
  const report = await laundryReport(params.id); requireLaundryEditor(user, report);
  if (report.status !== 'draft') throw new HttpError(409, '발행된 성적서는 발행을 취소한 뒤 수정할 수 있습니다.');
  const head = laundryHeader(body), lines = laundryLines(body.lines);
  if (await db.prepare('SELECT 1 FROM laundry_reports WHERE wash_date=? AND id<>?').get(head.wash_date, report.id)) throw new HttpError(409, '이 세탁일의 검수 기록이 이미 있습니다.');
  const draft = "EXISTS(SELECT 1 FROM laundry_reports WHERE id=? AND status='draft')";
  const results = await db.batch([
    { sql: "UPDATE laundry_reports SET wash_date=?,pickup_label=?,inspector=?,note=?,updated_by=?,updated_at=? WHERE id=? AND status='draft'", args: [head.wash_date, head.pickup_label, head.inspector, head.note, user.name, now(), report.id] },
    { sql: `DELETE FROM laundry_report_lines WHERE report_id=? AND ${draft}`, args: [report.id, report.id] },
    ...lines.map(l => ({ sql: `INSERT INTO laundry_report_lines(report_id,section,garment,part,size,qty) SELECT ?,?,?,?,?,? WHERE ${draft}`, args: [report.id, l.section, l.garment, l.part, l.size, l.qty, report.id] })),
  ]);
  if (!(results[0].meta.changes)) throw new HttpError(409, '다른 사람이 먼저 발행했습니다. 새로고침 후 확인하세요.');
  return { ok: true };
});
route('POST', '/api/laundry-reports/:id/issue', async ({ user, params }) => {
  const report = await laundryReport(params.id); requireLaundryEditor(user, report);
  if (!(await db.prepare('SELECT 1 FROM laundry_report_lines WHERE report_id=?').get(report.id))) throw bad('수량이 하나도 없는 성적서는 발행할 수 없습니다.');
  const settings = await laundrySettings();
  // The registered signature belongs to the confirmer named in the settings; it is never stamped under another name.
  const signature = settings.signature && settings.inspector && report.inspector === settings.inspector ? settings.signature : '';
  const r = await db.prepare("UPDATE laundry_reports SET status='issued',issued_by=?,issued_at=?,prices=?,signature=? WHERE id=? AND status='draft'").run(user.name, now(), JSON.stringify(settings.prices), signature, report.id);
  if (!r.changes) throw new HttpError(409, '이미 발행된 성적서입니다.');
  return { ok: true, signed: !!signature };
});
route('POST', '/api/laundry-reports/:id/unissue', async ({ user, params }) => {
  const report = await laundryReport(params.id); if (!hasRole(user, 'purchase')) throw new HttpError(403, '발행 취소는 구매 담당자만 할 수 있습니다.');
  const r = await db.prepare("UPDATE laundry_reports SET status='draft',issued_by='',issued_at='',prices='',signature='',updated_by=?,updated_at=? WHERE id=? AND status='issued'").run(user.name, now(), report.id);
  if (!r.changes) throw new HttpError(409, '발행 상태가 아닙니다.');
  return { ok: true };
});
// Past records converted from the old workbook. Each one arrives already issued, with the unit prices of that file.
route('POST', '/api/laundry-report-import', async ({ user, body }) => {
  requireAdmin(user);
  if (body.format !== 'laundry-reports-v1' || !Array.isArray(body.reports) || !body.reports.length || body.reports.length > 20) throw bad('가져올 파일 형식이 올바르지 않습니다.');
  const author = reqStr(body.author, '작성자', 30), inspector = str(body.inspector, 120);
  const table = (source, keys) => Object.fromEntries(keys.map(k => [k, num(source?.[k] ?? 0, '단가')]));
  const prices = { vendor: table(body.prices?.vendor, LAUNDRY_PRICE_KEYS), customer: table(body.prices?.customer, LAUNDRY_PRICE_KEYS), discard: table(body.prices?.discard, LAUNDRY_PARTS) };
  const reports = body.reports.map(r => ({ ...laundryHeader({ ...r, inspector }), lines: laundryLines(r.lines) }));
  if (new Set(reports.map(r => r.wash_date)).size !== reports.length) throw bad('같은 세탁일이 두 번 들어 있습니다.');
  const existing = new Set((await db.prepare(`SELECT wash_date FROM laundry_reports WHERE wash_date IN (${reports.map(() => '?').join(',')})`).all(...reports.map(r => r.wash_date))).map(r => r.wash_date));
  const fresh = reports.filter(r => !existing.has(r.wash_date)); const at = now(), snapshot = JSON.stringify(prices);
  if (fresh.length) await db.batch(fresh.flatMap(r => [
    { sql: "INSERT INTO laundry_reports(wash_date,pickup_label,status,inspector,note,prices,issued_by,issued_at,created_by) VALUES(?,?,'issued',?,?,?,?,?,?)", args: [r.wash_date, r.pickup_label, r.inspector, r.note, snapshot, author, at, author] },
    ...r.lines.map(l => ({ sql: 'INSERT INTO laundry_report_lines(report_id,section,garment,part,size,qty) SELECT id,?,?,?,?,? FROM laundry_reports WHERE wash_date=?', args: [l.section, l.garment, l.part, l.size, l.qty, r.wash_date] })),
  ]));
  // First import on an unconfigured system also fills in the unit prices and the confirmer.
  const settings = await laundrySettings(); let settings_filled = false;
  if (LAUNDRY_PRICE_KEYS.every(k => !settings.prices.vendor[k] && !settings.prices.customer[k])) { await setSetting('laundry_report_settings', JSON.stringify({ ...settings, prices, inspector: settings.inspector || inspector })); settings_filled = true; }
  return { imported: fresh.length, skipped: reports.length - fresh.length, settings_filled };
});
route('DELETE', '/api/laundry-reports/:id', async ({ user, params }) => {
  const report = await laundryReport(params.id); requireLaundryEditor(user, report);
  if (report.status !== 'draft') throw new HttpError(409, '발행된 성적서는 발행을 취소한 뒤 삭제할 수 있습니다.');
  await db.batch([{ sql: "DELETE FROM laundry_report_lines WHERE report_id=? AND EXISTS(SELECT 1 FROM laundry_reports WHERE id=? AND status='draft')", args: [report.id, report.id] }, { sql: "DELETE FROM laundry_reports WHERE id=? AND status='draft'", args: [report.id] }]);
  return { ok: true };
});

// Quality specifications are copied when a request is created; later edits never change that copy.
function inspectionKey(value) { return String(value || '').trim().toLowerCase().replace(/ /g, ''); }
function inspectionSnapshotSQL(title, kind, category, code = "''") {
  return `COALESCE((SELECT MAX(json_set(s.definition,'$.id',s.id,'$.revision',s.revision)) FROM inspection_specs s
    WHERE s.active=1 AND s.kind=${kind} AND s.item_category=${category}
    AND EXISTS(SELECT 1 FROM inspection_spec_keys k WHERE k.spec_id=s.id AND k.name_key IN (REPLACE(LOWER(${title}),' ',''),REPLACE(LOWER(COALESCE(${code},'')),' ',''))) HAVING COUNT(*)=1),'')`;
}
async function inspectionSnapshot(f) {
  if (!['수입검사','출하검사'].includes(f.category)) return '';
  const keys = [...new Set([inspectionKey(f.title), inspectionKey(f.data.product_code)].filter(Boolean))];
  const rows = await db.prepare(`SELECT DISTINCT s.* FROM inspection_specs s JOIN inspection_spec_keys k ON k.spec_id=s.id WHERE s.active=1 AND s.kind=? AND s.item_category=? AND k.name_key IN (${keys.map(() => '?').join(',')})`).all(f.category, f.data.item_category || '', ...keys);
  return rows.length === 1 ? JSON.stringify({ ...JSON.parse(rows[0].definition), id: rows[0].id, revision: rows[0].revision }) : '';
}
function requireInspectionManager(user) { requireRole(user,'quality_approver','품질팀장'); }
function validateInspectionSpec(body) {
  if (!['수입검사','출하검사'].includes(body.kind)) throw bad('수입검사 또는 출하검사를 선택하세요.');
  const category = itemCategory(body.item_category), product = reqStr(body.product,'품명',200);
  if (!Array.isArray(body.aliases) || body.aliases.length > 20 || body.aliases.some(v => typeof v !== 'string' || v.length > 200)) throw bad('별칭은 20개 이내로 입력하세요.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) throw bad('검사 항목은 1~20개로 설정하세요.');
  const items = body.items.map((item,i) => {
    if (!item || typeof item !== 'object') throw bad('검사 항목을 확인하세요.');
    const bound = v => { if (v === '' || v == null) return null; if (!['string','number'].includes(typeof v) || !Number.isFinite(Number(v))) throw bad('규격은 숫자로 입력하세요.'); return Number(v); };
    const min = bound(item.min), max = bound(item.max), count = Number(item.count);
    if ((min === null && max === null) || (min !== null && max !== null && min > max)) throw bad('하한 또는 상한을 입력하고 범위를 확인하세요.');
    if (!Number.isInteger(count) || count < 1 || count > 20) throw bad('항목별 측정 횟수는 1~20회입니다.');
    return { key: 'i'+i, name: reqStr(item.name,'검사 항목',100), unit: reqStr(item.unit,'단위',30), min, max, count };
  });
  if (items.reduce((n,i) => n+i.count,0)>100) throw bad('시료별 측정 칸은 최대 100개입니다.');
  return { kind: body.kind, item_category: category, product, aliases: [...new Set(body.aliases.map(v=>v.trim()).filter(Boolean))], items };
}
const INSPECTION_ITEM_DEFAULTS = [
  {group:'천와이퍼',name:'흡수속도 MD',unit:'초',min:0,max:60,count:5},
  {group:'천와이퍼',name:'흡수속도 CD',unit:'초',min:0,max:60,count:5},
  ...['흡수량','파티클','린트','외관'].map(name=>({group:'천와이퍼',name,unit:'',min:null,max:null,count:1})),
  {group:'심리스글러브',name:'박리강도',unit:'kgf',min:3,max:null,count:5},
];
async function inspectionItemLibrary() {
  const raw=await getSetting('inspection_item_library');
  return {raw,...(raw?JSON.parse(raw):{revision:0,items:INSPECTION_ITEM_DEFAULTS})};
}
route('GET','/api/inspection-items',async()=>{const {raw,...library}=await inspectionItemLibrary();return library;});
route('POST','/api/inspection-items',async({user,body})=>{
  requireInspectionManager(user);
  const item=validateInspectionSpec({kind:'수입검사',item_category:'원자재',product:'항목',aliases:[],items:[body.item]}).items[0];
  delete item.key;item.group=reqStr(body.item?.group,'품목군',100);
  const prior=await inspectionItemLibrary();if(Number(body.revision)!==prior.revision)throw new HttpError(409,'항목 보관함이 변경되었습니다. 다시 열어주세요.');
  const items=prior.items.filter(i=>!(i.group===item.group&&i.name===item.name));items.push(item);if(items.length>200)throw bad('보관함은 최대 200항목입니다.');
  const value=JSON.stringify({revision:prior.revision+1,items});
  const changed=await db.prepare(`INSERT INTO settings(key,value) SELECT 'inspection_item_library',? WHERE ?=0 OR EXISTS(SELECT 1 FROM settings WHERE key='inspection_item_library' AND value=?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value=?`).run(value,prior.revision,prior.raw,prior.raw);
  if(!changed.changes)throw new HttpError(409,'항목 보관함이 변경되었습니다. 다시 열어주세요.');
  return JSON.parse(value);
});

route('GET','/api/inspection-specs',async ({user}) => ({ can_manage: hasRole(user,'quality_approver'), specs: (await db.prepare('SELECT * FROM inspection_specs ORDER BY active DESC,id DESC').all()).map(s=>({...JSON.parse(s.definition),id:s.id,revision:s.revision,active:!!s.active,updated_by:s.updated_by,updated_at:s.updated_at})) }));
async function saveInspectionSpec(user, body, id) {
  requireInspectionManager(user); const spec=validateInspectionSpec(body);
  const prior=id ? await mustGet('inspection_specs',id) : null;
  if (prior && Number(body.revision)!==prior.revision) throw new HttpError(409,'다른 사람이 규격을 변경했습니다. 다시 열어주세요.');
  const active=body.active!==false, keys=[...new Set([spec.product,...spec.aliases].map(inspectionKey))];
  const commands=[];
  if (prior) {
    commands.push({sql:"UPDATE inspection_specs SET kind=?,item_category=?,definition=?,active=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?",args:[spec.kind,spec.item_category,JSON.stringify(spec),active?1:0,user.name,prior.id,prior.revision]});
    // The change token in the definition makes a stale concurrent write roll back rather than replace keys.
    commands.push({sql:'DELETE FROM inspection_spec_keys WHERE spec_id=? AND EXISTS(SELECT 1 FROM inspection_specs WHERE id=? AND revision=? AND definition=?)',args:[prior.id,prior.id,prior.revision+1,JSON.stringify(spec)]});
  } else commands.push({sql:'INSERT INTO inspection_specs(kind,item_category,definition,active,updated_by) VALUES(?,?,?,?,?)',args:[spec.kind,spec.item_category,JSON.stringify(spec),active?1:0,user.name]});
  // For new records, identify the inserted specification before key inserts change last_insert_rowid().
  const token=randomHex(16); spec.token=token; commands[0].args[2]=JSON.stringify(spec);
  if (prior) commands[1].args[3]=JSON.stringify(spec);
  if(active) for(const key of keys) commands.push({sql:'INSERT INTO inspection_spec_keys(spec_id,kind,item_category,name_key) SELECT id,kind,item_category,? FROM inspection_specs WHERE json_extract(definition,\'$.token\')=?',args:[key,token]});
  let results; try { results=await db.batch(commands); } catch(error) { if(String(error.message).includes('UNIQUE')) throw new HttpError(409,'같은 검사 구분·카테고리에 이미 등록된 품명 또는 별칭입니다.'); throw error; }
  if(!results[0].meta.changes) throw new HttpError(409,'다른 사람이 규격을 변경했습니다. 다시 열어주세요.');
  return {ok:true};
}
route('POST','/api/inspection-specs',({user,body})=>saveInspectionSpec(user,body));
route('PUT','/api/inspection-specs/:id',({user,body,params})=>saveInspectionSpec(user,body,params.id));
function decodeInspection(row) { return row ? {...row,values:JSON.parse(row.values_json)} : null; }
async function inspectionRequest(id) { const r=await getRequest(id); if(r.type!=='analysis'||!['수입검사','출하검사'].includes(r.category)) throw bad('수입검사·출하검사 의뢰를 선택하세요.'); return r; }
route('GET','/api/requests/:id/inspection',async ({user,params})=>{
  const r=await inspectionRequest(params.id);
  return { request:decodeRequest(r), spec:r.inspection_snapshot?JSON.parse(r.inspection_snapshot):null, measurement:decodeInspection(await db.prepare('SELECT * FROM inspection_measurements WHERE request_id=?').get(r.id)), can_manage:!isOperator(user)&&hasRole(user,'quality_approver'),can_write:!isOperator(user)&&hasRole(user,'quality')&&WORK_STATUSES.includes(r.status),history:await db.prepare('SELECT id,revision,result,reason,saved_by,saved_at FROM inspection_measurement_history WHERE request_id=? ORDER BY id DESC LIMIT 50').all(r.id) };
});
route('POST','/api/requests/:id/inspection/spec',async ({user,params,body})=>{
  requireInspectionManager(user); const r=await inspectionRequest(params.id), s=await mustGet('inspection_specs',body.spec_id);
  if(r.inspection_snapshot) throw new HttpError(409,'이미 적용된 검사규격은 변경할 수 없습니다.');
  if(!s.active||s.kind!==r.category) throw bad('검사 구분에 맞는 사용 중인 규격을 선택하세요.');
  const category=JSON.parse(r.data||'{}').item_category;
  if(category&&category!==s.item_category) throw bad('의뢰 품목의 카테고리와 규격이 다릅니다.');
  const snapshot=JSON.stringify({...JSON.parse(s.definition),id:s.id,revision:s.revision});
  const updated=await db.prepare("UPDATE requests SET inspection_snapshot=? WHERE id=? AND inspection_snapshot='' AND category=? AND data=?").run(snapshot,r.id,r.category,r.data);
  if(!updated.changes) throw new HttpError(409,'의뢰가 변경되었습니다. 다시 열어주세요.');return {ok:true};
});
function inspectValues(spec, input) {
  if(!Array.isArray(input)||!input.length||input.length>30) throw bad('LOT·시료 행은 1~30개입니다.');
  let missing=false,failed=false;
  const rows=input.map(row=>{
    if(!row||typeof row!=='object'||!row.values||typeof row.values!=='object') throw bad('측정값을 확인하세요.');
    const values={};
    for(const item of spec.items){
      const list=row.values[item.key]; if(!Array.isArray(list)||list.length!==item.count) throw bad(item.name+'의 측정 칸 수가 규격과 다릅니다.');
      values[item.key]=list.map(v=>{
        if(v===null||v===''||(typeof v==='string'&&!v.trim())) {missing=true;return null;}
        if(!['number','string'].includes(typeof v)||!Number.isFinite(Number(v))) throw bad('측정값은 숫자로 입력하세요.');
        const n=Number(v); if((item.min!==null&&n<item.min)||(item.max!==null&&n>item.max)) failed=true;return n;
      });
    }
    return {lot:reqStr(row.lot,'LOT / 시료명',100),values};
  });
  return {rows,result:failed?'fail':missing?'pending':'pass'};
}
route('PUT','/api/requests/:id/inspection',async ({user,params,body})=>{
  requireRole(user,'quality','품질');const r=await inspectionRequest(params.id);
  if(!WORK_STATUSES.includes(r.status)) throw bad('의뢰 승인 후 측정값을 입력하세요.');
  if(!r.inspection_snapshot) throw bad('품질팀장이 검사규격을 먼저 지정해야 합니다.');
  const revision=Number(body.revision);if(!Number.isSafeInteger(revision)||revision<0) throw bad('기록 버전을 확인하세요.');
  const prior=await db.prepare('SELECT * FROM inspection_measurements WHERE request_id=?').get(r.id);
  if((prior?.revision||0)!==revision) throw new HttpError(409,'다른 사람이 결과를 저장했습니다. 다시 열어주세요.');
  const reason=str(body.reason,500);if(prior&&prior.result!=='pending'&&!reason) throw bad('판정된 결과를 수정할 때는 사유를 입력하세요.');
  const {rows,result}=inspectValues(JSON.parse(r.inspection_snapshot),body.rows), token=randomHex(16), values=JSON.stringify(rows);
  const results=await db.batch([
    {sql:`INSERT INTO inspection_measurements(request_id,values_json,result,save_token,updated_by) SELECT ?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM inspection_measurements WHERE request_id=? AND revision=?)
      ON CONFLICT(request_id) DO UPDATE SET values_json=excluded.values_json,result=excluded.result,save_token=excluded.save_token,updated_by=excluded.updated_by,revision=inspection_measurements.revision+1,updated_at=datetime('now','+9 hours') WHERE inspection_measurements.revision=?`,args:[r.id,values,result,token,user.name,revision,r.id,revision,revision]},
    {sql:'INSERT INTO inspection_measurement_history(request_id,revision,values_json,result,reason,saved_by) SELECT request_id,revision,values_json,result,?,updated_by FROM inspection_measurements WHERE request_id=? AND save_token=?',args:[reason,r.id,token]},
    {sql:"UPDATE requests SET status=?,updated_at=datetime('now','+9 hours') WHERE id=? AND EXISTS(SELECT 1 FROM inspection_measurements WHERE request_id=? AND save_token=?)",args:[result==='pending'?'progress':'done',r.id,r.id,token]},
  ]);
  if(!results[0].meta.changes) throw new HttpError(409,'다른 사람이 결과를 저장했습니다. 다시 열어주세요.');
  return decodeInspection(await db.prepare('SELECT * FROM inspection_measurements WHERE request_id=?').get(r.id));
});
route('GET','/api/requests/:id/inspection/history/:historyId',async ({params})=>{
  await inspectionRequest(params.id); const row=await db.prepare('SELECT * FROM inspection_measurement_history WHERE id=? AND request_id=?').get(params.historyId,params.id);if(!row) throw new HttpError(404,'검사 이력을 찾을 수 없습니다.');return decodeInspection(row);
});
route('GET','/api/inspections',async ({query})=>{
  const where=["r.type='analysis'","r.category IN ('수입검사','출하검사')"], args=[];
  if(query.kind){if(!['수입검사','출하검사'].includes(query.kind)) throw bad('검사 구분을 확인하세요.');where.push('r.category=?');args.push(query.kind);}
  const category="COALESCE(json_extract(NULLIF(r.inspection_snapshot,''),'$.item_category'),json_extract(r.data,'$.item_category'),'')";
  if(query.item_category){where.push(category+'=?');args.push(query.item_category==='미분류'?'':itemCategory(query.item_category));}
  if(query.result){if(!['pending','pass','fail','unconfigured'].includes(query.result)) throw bad('판정을 확인하세요.');where.push("CASE WHEN r.inspection_snapshot='' THEN 'unconfigured' ELSE COALESCE(m.result,'pending') END=?");args.push(query.result);}
  applyListDates(where,args,query,'substr(r.created_at,1,10)');
  applyListKeyword(where,args,query.q,['r.title','r.req_no','r.lot','r.customer',"json_extract(r.data,'$.product_code')","json_extract(NULLIF(r.inspection_snapshot,''),'$.aliases')"]);
  if(query.before){if(!/^[1-9]\d*$/.test(query.before)) throw bad('조회 위치를 확인하세요.');where.push('r.id<?');args.push(Number(query.before));}
  const rows=await db.prepare(`SELECT r.id,r.req_no,r.title,r.category,r.status,r.customer,r.lot,r.created_at,${category} AS item_category,CASE WHEN r.inspection_snapshot='' THEN 'unconfigured' ELSE COALESCE(m.result,'pending') END AS result,m.updated_by,m.updated_at FROM requests r LEFT JOIN inspection_measurements m ON m.request_id=r.id WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT 101`).all(...args);
  return {rows:rows.slice(0,100),next:rows.length>100?rows[99].id:null};
});

// ── 의뢰 (분석/개발/샘플): 누구나 의뢰 → 접수대기 → 담당자 승인 → 리스트(대기/진행/완료) ──
function requestFields(type, b) {
  if (type === 'voc' && (!b.data || typeof b.data !== 'object' || Array.isArray(b.data) || JSON.stringify(b.data).length > 20000)) throw bad('VOC 입력 내용을 확인하세요.');
  const data = typeof b.data === 'object' && b.data ? JSON.parse(JSON.stringify(b.data).slice(0, 20000)) : {};
  const f = { title: reqStr(b.title, type === 'voc' ? '제품명' : type === 'development' ? '타겟제품' : '샘플명', 200), customer: str(b.customer, 100), due_date: dateStr(b.due_date, '완료 희망일', { required: false }), category: '', target_price: '', data };
  if (type === 'analysis') { f.category = str(b.category, 20); if (!ANALYSIS_CATEGORIES.includes(f.category)) throw bad('검사 구분을 선택하세요.'); if(data.item_category) f.data.item_category=itemCategory(data.item_category); }
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
function roleLabel(type) { return { voc: '품질', analysis: '품질', development: '연구소', sample: '생산', sample_goods: '구매' }[type]; }

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
  const r = (await db.prepare('INSERT INTO requests(type,title,customer,due_date,category,target_price,data,requester_id,requester_name,inspection_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(type, f.title, f.customer, f.due_date, f.category, f.target_price, JSON.stringify(f.data), user.id, user.name, type==='analysis'?await inspectionSnapshot(f):''));
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
  if(r.inspection_snapshot && (f.title!==r.title || f.category!==r.category || (f.data.item_category||'')!==(priorData.item_category||''))) throw bad('검사규격이 적용된 의뢰의 품명·검사 구분·카테고리는 변경할 수 없습니다.');
  const meta = lineMeta({ spec: r.source_type ? r.spec || priorData.spec || '' : body.spec ?? body.data?.spec ?? r.spec,
    unit: r.source_type ? r.unit || priorData.unit || '' : body.unit ?? body.data?.unit ?? (r.unit || priorData.unit || ''),
    lot: (r.source_type ? undefined : body.lot ?? (r.type === 'analysis' ? body.data?.lot_etc : body.data?.lot)) ?? (r.lot || priorData.lot_etc || (r.type === 'voc' ? priorData.lot : '') || '') }, r);
  let lineQty = r.qty;
  if (!r.source_type && (r.qty !== null || r.type === 'voc')) {
    const supplied = r.type === 'analysis' ? f.data.sample_qty : ['sample', 'sample_goods'].includes(r.type) ? f.data.req_qty : f.data.qty;
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
  if(status==='done' && r.inspection_snapshot && !(await db.prepare("SELECT 1 FROM inspection_measurements WHERE request_id=? AND result IN ('pass','fail')").get(r.id))) throw bad('검사 측정값을 입력하고 판정을 완료하세요.');
  (await db.prepare("UPDATE requests SET status=?, result_note=?, updated_at=datetime('now','+9 hours') WHERE id=?").run(status, body.result_note !== undefined ? str(body.result_note, 1000) : r.result_note, r.id));
  return decodeRequest((await getRequest(r.id)));
});
route('DELETE', '/api/requests/:id', async ({ user, params }) => {
  const r = (await getRequest(params.id));
  const intake = ['pending', 'rejected'].includes(r.status);
  const own = r.requester_id === user.id && intake;
  // Before approval, only the requester or an approver may remove it; team staff cannot bypass approval by deleting.
  if (!(own || user.is_admin || (intake ? isRequestApprover(user, r.type) : hasRole(user, REQUEST_TYPES[r.type])))) throw new HttpError(403, intake ? '접수대기 의뢰는 의뢰자 본인 또는 승인권자만 삭제할 수 있습니다.' : '삭제 권한이 없습니다.');
  if(await db.prepare('SELECT 1 FROM inspection_measurements WHERE request_id=?').get(r.id)) throw bad('측정 이력이 있는 검사 의뢰는 삭제할 수 없습니다.');
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
// Optional sub-classification under the item class. A lower level needs the level above it.
function bomCategories(body, previous = {}) {
  const cats = ['cat1', 'cat2', 'cat3'].map(key => body[key] === undefined ? previous[key] || '' : str(body[key], 50));
  if ((cats[1] && !cats[0]) || (cats[2] && !cats[1])) throw bad('2차 분류는 1차, 3차 분류는 2차를 먼저 입력하세요.');
  return cats;
}
// Which semi-finished kind a catalog item is, so work records can offer the right models.
const SEMI_TYPE_NAMES = ['부직포와이퍼', '천와이퍼', '스무드', '타키'];
function bomSemiType(body, category, previous = {}) {
  const value = body.semi_type === undefined ? previous.semi_type || '' : str(body.semi_type, 20);
  if (value && !SEMI_TYPE_NAMES.includes(value)) throw bad('반제품 종류를 다시 선택하세요.');
  if (value && category !== '반제품') throw bad('반제품 종류는 분류가 반제품인 품목에만 지정합니다.');
  return value;
}
function decodeBom(row) { return { ...row, materials: JSON.parse(row.materials) }; }
route('GET', '/api/boms', async ({ user, query }) => {
  const where = []; const args = [];
  if (query.include_archived === '1') requireAdmin(user); else where.push('active=1');
  // Temporary (direct-entry) items appear in item pickers and the admin list, not in production BOM choices.
  if (query.temp === 'only') where.push('is_temp=1'); else if (query.temp !== '1' && query.include_archived !== '1') where.push('is_temp=0');
  if (query.kind) { if (!['finished','semi'].includes(query.kind)) throw bad('생산 구분이 올바르지 않습니다.'); where.push('kind=?'); args.push(query.kind); }
  if (query.item_category) { where.push('item_category=?'); args.push(itemCategory(query.item_category)); }
  applyListKeyword(where, args, query.q, ['product','product_code','created_by','note','cat1','cat2','cat3']);
  for (const key of ['cat1', 'cat2', 'cat3', 'semi_type']) if (query[key]) { where.push(key + '=?'); args.push(str(query[key], 50)); }
  if (query.active) { if (!['0','1'].includes(query.active)) throw bad('BOM 사용 상태를 확인하세요.'); where.push('active=?'); args.push(Number(query.active)); }
  return (await db.prepare(`SELECT * FROM boms ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY product,id`).all(...args)).map(decodeBom);
});
// Category values already in use, for suggestions and filters.
route('GET', '/api/boms/categories', async () => db.prepare("SELECT DISTINCT cat1,cat2,cat3 FROM boms WHERE active=1 AND cat1<>'' ORDER BY cat1,cat2,cat3 LIMIT 2000").all());
route('POST', '/api/boms', async ({ user, body }) => {
  requireAdmin(user);
  const fields = bomFields(body), cats = bomCategories(body);
  const result = await db.prepare('INSERT INTO boms(product,product_code,kind,base_qty,unit,materials,note,active,item_category,created_by,cat1,cat2,cat3,semi_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...fields, user.name, ...cats, bomSemiType(body, fields[8]));
  return decodeBom(await mustGet('boms', result.lastInsertRowid));
});
route('PUT', '/api/boms/:id', async ({ user, params, body }) => {
  requireAdmin(user); const before = await mustGet('boms', params.id); const fields = bomFields(body);
  const commands = [{ sql: "UPDATE boms SET product=?,product_code=?,kind=?,base_qty=?,unit=?,materials=?,note=?,active=?,item_category=?,cat1=?,cat2=?,cat3=?,semi_type=?,is_temp=0,updated_at=datetime('now','+9 hours') WHERE id=?", args: [...fields, ...bomCategories(body, before), bomSemiType(body, fields[8], before), before.id] }];
  if (before.is_temp) {
    if (/^TMP-/i.test(fields[1])) throw bad('임시 코드(TMP-)를 정식 제품코드로 바꿔 저장하세요.');
    commands.push(...relinkCatalog(before, { id: before.id, product: fields[0], product_code: fields[1] }));
  }
  await db.batch(commands);
  return decodeBom(await mustGet('boms', params.id));
});
// Rows that used a temporary item follow it to its confirmed name/code. Inspection snapshots are left as recorded.
function relinkCatalog(temp, target) {
  const commands = [];
  for (const table of ['purchase_orders', 'shipments']) commands.push({ sql: `UPDATE ${table} SET item=?,product_code=? WHERE product_code=?`, args: [target.product, target.product_code, temp.product_code] });
  commands.push({ sql: "UPDATE other_receipts SET item=?,bom_id=?,bom_snapshot=json_set(bom_snapshot,'$.id',?,'$.product',?,'$.product_code',?) WHERE bom_id=?", args: [target.product, target.id, target.id, target.product, target.product_code, temp.id] });
  return commands;
}
route('POST', '/api/boms/:id/merge', async ({ user, params, body }) => {
  requireAdmin(user);
  const temp = await mustGet('boms', params.id); if (!temp.is_temp) throw bad('임시 품목만 다른 품목으로 합칠 수 있습니다.');
  const target = await mustGet('boms', Number(body.target_id) || 0);
  if (target.id === temp.id || target.is_temp || !target.active) throw bad('합칠 대상은 사용 중인 정식 품목이어야 합니다.');
  await db.batch([...relinkCatalog(temp, target), { sql: "UPDATE boms SET active=0,note=?,updated_at=datetime('now','+9 hours') WHERE id=?", args: [`${target.product}(${target.product_code || '코드 없음'})로 합침 · ${user.name}`, temp.id] }]);
  return { ok: true, target: decodeBom(target) };
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
// Narrow read models for the operator UI. No prices, BOM recipes, or other users' logs.
route('GET', '/api/operator/catalog', async () => ({
  units: await db.prepare('SELECT id,kind,name,active FROM production_units WHERE active=1 ORDER BY sort_order,name').all(),
  models: await db.prepare("SELECT id,product,product_code,semi_type,unit FROM boms WHERE active=1 AND is_temp=0 AND item_category='반제품' AND semi_type<>'' ORDER BY product").all(),
}));
function operatorDate(value) {
  const date = listFilterDate(value, '생산일');
  if (!date || date > today()) throw bad('생산일은 오늘 또는 과거 날짜를 선택하세요.');
  return date;
}
route('GET', '/api/operator/plans', async ({ query }) => {
  const date = operatorDate(query.date);
  return db.prepare(`SELECT s.id,s.period,s.start_date,s.product,s.spec,s.qty,s.done,
    COALESCE(NULLIF(s.unit,''),json_extract(s.bom_snapshot,'$.unit'),'') AS unit,
    COALESCE((SELECT SUM(a.qty) FROM production_actuals a WHERE a.schedule_id=s.id AND a.voided_at IS NULL),0) AS actual_qty
    FROM schedules s WHERE s.kind='finished' AND s.start_date<=? AND
    CASE s.period WHEN 'day' THEN s.start_date WHEN 'week' THEN date(s.start_date,'+6 days') ELSE date(s.start_date,'+1 month','-1 day') END>=?
    ORDER BY s.done,s.product,s.id`).all(date,date);
});
route('GET', '/api/operator/actuals', async ({ user, query }) => {
  const date = operatorDate(query.date);
  return db.prepare(`SELECT a.id,a.production_date,a.qty,a.note,a.voided_at,s.product,s.spec,
    COALESCE(NULLIF(s.unit,''),json_extract(s.bom_snapshot,'$.unit'),'') AS unit
    FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id
    WHERE a.author_id=? AND a.production_date=? AND s.kind='finished' ORDER BY a.id DESC LIMIT 100`).all(user.id,date);
});
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
  return (await db.prepare(`SELECT *,COALESCE((SELECT SUM(a.qty) FROM production_actuals a WHERE a.schedule_id=schedules.id AND a.voided_at IS NULL),0) + COALESCE((SELECT SUM(c.qty) FROM semi_records c WHERE ${semiCutMatch('schedules')}),0) AS actual_qty,
      (SELECT COUNT(*) FROM production_actuals a WHERE a.schedule_id=schedules.id AND a.voided_at IS NULL) + (SELECT COUNT(*) FROM semi_records c WHERE ${semiCutMatch('schedules')}) AS actual_count,
      COALESCE((SELECT SUM(c.qty) FROM semi_records c WHERE ${semiCutMatch('schedules')}),0) AS cut_qty FROM schedules WHERE kind=? AND (
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
  await recordEdit('schedule', 'schedules', row.id, row, EDIT_LABELS.schedule, user);
  return decodeSchedule(await mustGet('schedules', row.id));
});
route('DELETE', '/api/schedules/:id', async ({ user, params }) => {
  const row = (await mustGet('schedules', params.id)); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 삭제할 수 있습니다.');
  if (await db.prepare('SELECT 1 FROM production_actuals WHERE schedule_id=?').get(row.id)) throw bad('생산실적이 있는 일정은 삭제할 수 없습니다. 실적 이력을 확인하세요.');
  (await db.prepare('DELETE FROM schedules WHERE id=?').run(row.id)); return { ok: true };
});

// ── 물류: 발주 없는 기타입고 ──
function receiptCategory(value) { const c = itemCategory(value); if (c === '반제품') throw bad('반제품은 기타입고로 받을 수 없습니다. 생산 기록으로 등록하세요.'); return c; }
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
    // other_receipts keeps its original four-class constraint; semi-finished goods come from production, not receipts.
    if (snapshot.item_category === '반제품') throw bad('반제품은 기타입고로 받을 수 없습니다. 생산 기록으로 등록하세요.');
  } else if (!previous || previous.bom_id) throw bad('BOM을 검색하여 입고할 품목을 선택하세요.');
  return [dateStr(b.received_date, '입고일'), bomId ? snapshot.product : reqStr(b.item, '품목명', 200), bomId ? snapshot.item_category : receiptCategory(b.item_category), num(b.qty, '입고수량'), reqStr(b.vendor, '입고처', 100), str(b.note, 500), bomId, JSON.stringify(snapshot)];
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
  const fields = await otherReceiptFields(body); await ensureVendor(fields[4], user);
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
  await recordEdit('other_receipt', 'other_receipts', row.id, row, EDIT_LABELS.other_receipt, user);
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
  if (body.bom_id) body.item = (await catalogItem(user, body)).product;
  const f = shipFields(body); const entry = await catalogItem(user, body); await ensureVendor(f[3], user);
  const r = (await db.prepare('INSERT INTO shipments(ship_date,item,qty,customer,note,lot,created_by,product_code,unit) VALUES(?,?,?,?,?,?,?,?,?)').run(f[0], entry.product, ...f.slice(2), user.name, entry.product_code, str(body.unit, 20) || entry.unit));
  return (await mustGet('shipments', r.lastInsertRowid));
});
route('PUT', '/api/shipments/:id', async ({ user, params, body }) => {
  const row = (await mustGet('shipments', params.id)); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 수정할 수 있습니다.');
  const f = shipFields(body);
  const entry = nameKey(f[1]) === nameKey(row.item) && row.product_code && body.bom_id === undefined ? { product: row.item, product_code: row.product_code } : await catalogItem(user, body);
  await ensureVendor(f[3], user);
  (await db.prepare('UPDATE shipments SET ship_date=?,item=?,qty=?,customer=?,note=?,lot=?,product_code=? WHERE id=?').run(f[0], entry.product, ...f.slice(2), entry.product_code, row.id)); await recordEdit('shipment', 'shipments', row.id, row, EDIT_LABELS.shipment, user); return (await mustGet('shipments', row.id));
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
        // Validate the whole line first so a bad row never leaves a temporary code behind.
        if (b.bom_id) { const chosen = await catalogItem(user, b); b.item = chosen.product; if (!b.item_category && ITEM_CATEGORIES.includes(chosen.item_category)) b.item_category = chosen.item_category; }
        const f = poFields(b); const entry = await catalogItem(user, b);
        record = Object.fromEntries(['req_no','vendor','item','qty','due_date','note','item_category','coa_requested'].map((key,i) => [key, f[i]]));
        record.item = entry.product; record.product_code = entry.product_code; if (!meta.unit) meta.unit = entry.unit || '';
        if (index === 0) await ensureVendor(record.vendor, user);
      } else if (entity === 'shipment') {
        if (b.bom_id) b.item = (await catalogItem(user, b)).product;
        const f = shipFields(b); const entry = await catalogItem(user, b);
        record = Object.fromEntries(['ship_date','item','qty','customer','note','lot'].map((key,i) => [key, f[i]]));
        record.item = entry.product; record.product_code = entry.product_code; if (!meta.unit) meta.unit = entry.unit || '';
        if (index === 0) await ensureVendor(record.customer, user);
      } else if (entity === 'other_receipt') {
        const fields = await otherReceiptFields(b); if (index === 0) await ensureVendor(fields[4], user);
        record = Object.fromEntries(['received_date','item','item_category','qty','vendor','note','bom_id','bom_snapshot'].map((key,i) => [key, fields[i]]));
        meta.unit = JSON.parse(record.bom_snapshot).unit || '';
      } else if (entity === 'schedule') {
        record = await schedFields({ ...b, product: b.product || b.item });
        if (record.bom_id) meta.unit = JSON.parse(record.bom_snapshot).unit || '';
        // Write the size the way cutting/fusing records store it, so the plan finds its actuals.
        if (record.kind === 'semi' && meta.spec) { const kind = record.bom_id ? JSON.parse(record.bom_snapshot).semi_type : ''; const group = semiGroupOfLabel(record.product) || (kind ? Object.keys(SEMI_PRODUCTS).find(g => SEMI_PRODUCTS[g].types.includes(kind)) : null); if (group) meta.spec = semiSpec(group, meta.spec, false); }
      } else if (entity === 'laundry') {
        record = { in_date: dateStr(b.in_date, '입고일'), item: reqStr(b.item, '옷 종류', 200), in_qty: num(b.in_qty ?? b.qty, '입고수량'), discard_qty: num(b.discard_qty ?? 0, '폐기수량'), note: str(b.note, 500), photos: '[]' };
        if (record.discard_qty > record.in_qty) throw bad('폐기수량이 입고수량을 넘을 수 없습니다.');
      } else {
        const type = String(b.type || ''); if (!Object.hasOwn(REQUEST_TYPES, type)) throw bad('의뢰 종류를 확인하세요.');
        const qty = num(b.qty, '수량'); if (qty <= 0) throw bad('수량은 0보다 커야 합니다.');
        const data = { ...(b.data || {}), qty, spec: meta.spec, unit: meta.unit };
        if (type === 'analysis') { data.sample_qty = String(qty); data.lot = meta.lot ? '있음' : '없음'; data.lot_etc = meta.lot; }
        else { data.lot = meta.lot; if (['sample', 'sample_goods'].includes(type)) data.req_qty = String(qty); }
        const f = requestFields(type, { ...b, title: b.title || b.item, data });
        record = { type, inspection_snapshot: type==='analysis'?await inspectionSnapshot(f):'', title: f.title, customer: f.customer, due_date: f.due_date, category: f.category, target_price: f.target_price, data: JSON.stringify(f.data), qty, requester_id: user.id, requester_name: user.name };
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
  if (EDIT_LABELS[params.entity]) await recordEdit(params.entity, BATCH_TABLES[params.entity], row.id, row, EDIT_LABELS[params.entity], user);
  return mustGet(BATCH_TABLES[params.entity],row.id);
});

// Actual production is an append-only dated log, distinct from completion checkboxes.
async function actualSchedule(user, id, write = false) {
  const row = await mustGet('schedules', id);
  if (isOperator(user) && row.kind !== 'finished') throw new HttpError(403, '오퍼레이터는 완제품 계획에만 실적을 입력할 수 있습니다.');
  if (write && !isOperator(user) && !canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 생산실적을 입력할 수 있습니다.');
  return row;
}
route('GET', '/api/schedules/:id/actuals', async ({ user, params, query }) => {
  const schedule = await actualSchedule(user, params.id);
  if (query.before !== undefined && (!/^[1-9]\d*$/.test(query.before) || !Number.isSafeInteger(Number(query.before)))) throw bad('생산실적 조회 위치를 확인하세요.');
  const rows = await db.prepare(`SELECT * FROM production_actuals WHERE schedule_id=? ${query.before ? 'AND id<?' : ''} ORDER BY id DESC LIMIT 51`).all(schedule.id, ...(query.before ? [Number(query.before)] : []));
  const page = rows.slice(0,50);
  const manual = (await db.prepare('SELECT COALESCE(SUM(qty),0) AS qty FROM production_actuals WHERE schedule_id=? AND voided_at IS NULL').get(schedule.id)).qty;
  const cutRows = schedule.kind === 'semi' ? await db.prepare(`SELECT c.* FROM semi_records c, schedules s WHERE s.id=? AND ${semiCutMatch('s')} ORDER BY c.work_date DESC, c.id DESC LIMIT 200`).all(schedule.id) : [];
  const cutQty = schedule.kind === 'semi' ? (await db.prepare(`SELECT COALESCE(SUM(c.qty),0) AS qty FROM semi_records c, schedules s WHERE s.id=? AND ${semiCutMatch('s')}`).get(schedule.id)).qty : 0;
  const actual = manual + cutQty;
  const pending = await db.prepare("SELECT * FROM production_actual_changes WHERE schedule_id=? AND status='pending'").all(schedule.id);
  const changes = await db.prepare('SELECT * FROM production_actual_changes WHERE schedule_id=? ORDER BY id DESC LIMIT 50').all(schedule.id);
  return { schedule: decodeSchedule(schedule), rows: page.map(row => ({ ...row, pending_change: pending.find(c => c.actual_id === row.id) || null })), changes, can_approve: !!user.is_admin || publicUser(user).roles.includes('production_approver'), next: rows.length > 50 ? page.at(-1).id : null, actual_qty: actual, variance_qty: actual - schedule.qty, achievement_rate: schedule.qty ? Math.round(actual / schedule.qty * 1000) / 10 : null, can_write: schedule.kind !== 'semi' && (canModify(user, schedule) || hasRole(user, 'production')), auto: schedule.kind === 'semi', cut_rows: cutRows, cut_qty: cutQty, manual_qty: manual };
});
route('POST', '/api/schedules/:id/actuals', async ({ user, params, body }) => {
  const schedule = await actualSchedule(user, params.id, true);
  if (schedule.kind === 'semi') throw bad('반제품 실적은 생산 → 반제품 · 커팅/융착 기록에서 자동으로 집계됩니다. 그 화면에서 입력하세요.');
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
  if (query.id !== undefined) { if (!/^[1-9]\d*$/.test(query.id)) throw bad('요청 번호를 확인하세요.'); where.push('c.id=?'); args.push(Number(query.id)); }
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

// ── 생산: 라인·세탁 호기 관리와 반제품 작업 기록 (커팅/융착 = 라인별, 세탁 = 호기별) ──
// To add a product, extend SEMI_PRODUCTS here and in public/semi.js; stored rows keep their own text.
const SEMI_PRODUCTS = { wiper: { label: '와이퍼', types: ['부직포와이퍼', '천와이퍼'] }, seamless: { label: '심리스글러브', types: ['스무드', '타키'] } };
const SEMI_SIZES = ['XS', 'S', 'M', 'L', 'XL'];
// Seamless gloves take a size; wipers take an inch spec, stored as '9인치' however it was typed.
function semiSpec(group, value, required) {
  const raw = str(value, 20);
  if (!raw) { if (required) throw bad(group === 'seamless' ? '사이즈(XS~XL)를 선택하세요.' : '와이퍼 규격(인치)을 입력하세요.'); return ''; }
  if (group === 'seamless') { const size = raw.toUpperCase(); if (!SEMI_SIZES.includes(size)) throw bad('사이즈는 XS, S, M, L, XL 중에서 선택하세요.'); return size; }
  const inch = Number(raw.replace(/\s*(인치|inch|in|")\s*$/i, ''));
  if (!Number.isFinite(inch) || inch <= 0 || inch > 200) throw bad('와이퍼 규격은 인치 숫자로 입력하세요. (예: 9)');
  return `${inch}인치`;
}
const SEMI_UNIT_KIND = { cut: 'line', wash: 'washer' };
const SEMI_DEFECT_REASONS = { cut: ['오염', '치수 불량', '융착 불량', '커팅 불량', '찢어짐·구멍', '이물', '기타'], wash: ['오염 잔류', '손상·찢어짐', '변색', '이물', '기타'] };
// A semi-finished plan is matched to cutting/fusing records by product name (spaces/case ignored), size when the plan
// names one, and work dates inside the plan period. Its actuals are never typed in twice.
const SEMI_CUT_LABEL = "COALESCE(NULLIF(c.item_name,''), CASE c.product_group WHEN 'seamless' THEN '심리스 ' || c.product_type ELSE c.product_type END)";
const semiCutMatch = s => `${s}.kind='semi' AND c.process='cut' AND REPLACE(LOWER(${SEMI_CUT_LABEL}),' ','')=REPLACE(LOWER(${s}.product),' ','') AND (${s}.spec='' OR c.spec=${s}.spec)
  AND c.work_date BETWEEN ${s}.start_date AND CASE ${s}.period WHEN 'day' THEN ${s}.start_date WHEN 'week' THEN date(${s}.start_date,'+6 days') ELSE date(${s}.start_date,'+1 month','-1 day') END`;
function semiGroupOfLabel(name) {
  const key = nameKey(name);
  for (const [group, product] of Object.entries(SEMI_PRODUCTS)) if (product.types.some(type => nameKey((group === 'seamless' ? '심리스 ' : '') + type) === key)) return group;
  return null;
}
const canManageProduction = user => hasRole(user, 'production');
route('GET', '/api/production-units', async ({ query }) => {
  const where = [], args = [];
  if (query.kind) { if (!['line', 'washer'].includes(query.kind)) throw bad('라인/호기 구분을 확인하세요.'); where.push('kind=?'); args.push(query.kind); }
  if (query.all !== '1') where.push('active=1');
  return db.prepare(`SELECT * FROM production_units ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY kind, sort_order, name`).all(...args);
});
route('POST', '/api/production-units', async ({ user, body }) => {
  if (!canManageProduction(user)) throw new HttpError(403, '라인·호기는 생산 담당자 또는 관리자가 관리합니다.');
  const kind = String(body.kind || ''); if (!['line', 'washer'].includes(kind)) throw bad('라인/호기 구분을 확인하세요.');
  const name = reqStr(body.name, kind === 'line' ? '라인 이름' : '호기 이름', 60);
  if (await db.prepare('SELECT 1 FROM production_units WHERE kind=? AND name_key=?').get(kind, nameKey(name))) throw new HttpError(409, '같은 이름이 이미 있습니다.');
  const order = num(body.sort_order ?? 0, '표시 순서');
  const r = await db.prepare('INSERT INTO production_units(kind,name,name_key,sort_order,created_by,yield_target) VALUES(?,?,?,?,?,?)').run(kind, name, nameKey(name), order, user.name, yieldTarget(body.yield_target));
  return mustGet('production_units', r.lastInsertRowid);
});
route('PUT', '/api/production-units/:id', async ({ user, params, body }) => {
  if (!canManageProduction(user)) throw new HttpError(403, '라인·호기는 생산 담당자 또는 관리자가 관리합니다.');
  const row = await mustGet('production_units', params.id);
  const name = body.name === undefined ? row.name : reqStr(body.name, '이름', 60);
  const clash = await db.prepare('SELECT id FROM production_units WHERE kind=? AND name_key=?').get(row.kind, nameKey(name));
  if (clash && clash.id !== row.id) throw new HttpError(409, '같은 이름이 이미 있습니다.');
  const active = body.active === undefined ? row.active : body.active === false || body.active === 0 || body.active === '0' ? 0 : 1;
  const order = body.sort_order === undefined ? row.sort_order : num(body.sort_order, '표시 순서');
  // Renaming keeps earlier records readable: each record stores the name it was entered under.
  const target = body.yield_target === undefined ? row.yield_target : yieldTarget(body.yield_target);
  await db.prepare('UPDATE production_units SET name=?,name_key=?,active=?,sort_order=?,yield_target=?,updated_by=?,updated_at=? WHERE id=?').run(name, nameKey(name), active, order, target, user.name, now(), row.id);
  return mustGet('production_units', row.id);
});
async function semiFields(body, process, previous = null) {
  const date = dateStr(body.work_date, '작업일'); if (date > today()) throw bad('작업일은 오늘 이전으로 선택하세요.');
  const unitId = Number(body.unit_id); if (!Number.isSafeInteger(unitId) || unitId <= 0) throw bad(process === 'cut' ? '라인을 선택하세요.' : '세탁 호기를 선택하세요.');
  const unit = await mustGet('production_units', unitId);
  if (unit.kind !== SEMI_UNIT_KIND[process]) throw bad(process === 'cut' ? '라인을 선택하세요.' : '세탁 호기를 선택하세요.');
  if (!unit.active && previous?.unit_id !== unit.id) throw bad('사용 중지된 라인·호기입니다.');
  const group = String(body.product_group || ''); if (!Object.hasOwn(SEMI_PRODUCTS, group)) throw bad('와이퍼/심리스글러브를 선택하세요.');
  const type = str(body.product_type, 40);
  if (process === 'cut' && !type) throw bad('품목(종류)을 선택하세요.');
  if (type && !SEMI_PRODUCTS[group].types.includes(type)) throw bad('품목(종류)을 다시 선택하세요.');
  // The model made (a 반제품 catalog item of this kind). Once models are registered for a kind, cutting/fusing must name one.
  let link = { bom_id: null, item_name: '', product_code: '', bom_snapshot: '{}' }, modelUnit = '';
  const bomId = body.bom_id === undefined ? previous?.bom_id ?? null : body.bom_id === '' || body.bom_id === null ? null : Number(body.bom_id);
  if (bomId !== null) {
    if (!Number.isSafeInteger(bomId) || bomId <= 0) throw bad('품목(모델)을 다시 선택하세요.');
    if (previous?.bom_id === bomId) link = { bom_id: bomId, item_name: previous.item_name, product_code: previous.product_code, bom_snapshot: previous.bom_snapshot };
    else {
      const bom = await mustGet('boms', bomId);
      if (!bom.active) throw bad('사용 중지된 품목입니다.');
      if (bom.item_category !== '반제품' || !bom.semi_type) throw bad('반제품 종류가 지정된 반제품 품목을 선택하세요.');
      link = { bom_id: bom.id, item_name: bom.product, product_code: bom.product_code, bom_snapshot: JSON.stringify({ id: bom.id, product: bom.product, product_code: bom.product_code, unit: bom.unit, base_qty: bom.base_qty, materials: JSON.parse(bom.materials) }) };
      modelUnit = bom.unit;
    }
    const kind = (await db.prepare('SELECT semi_type FROM boms WHERE id=?').get(bomId))?.semi_type;
    if (kind !== type) throw bad(`선택한 품목(모델)은 ${type ? '이 종류의 품목이 아닙니다' : '종류를 함께 선택해야 합니다'}.`);
  } else if (process === 'cut' && await db.prepare('SELECT 1 FROM boms WHERE active=1 AND semi_type=?').get(type)) throw bad('품목(모델)을 선택하세요.');
  const unitText = str(body.unit, 20) || modelUnit;
  return { ...link, work_date: date, unit_id: unit.id, unit_name: previous?.unit_id === unit.id ? previous.unit_name : unit.name, product_group: group, product_type: type, spec: semiSpec(group, body.spec, process === 'cut' && (group === 'seamless' || !link.bom_id)), ...semiWorkDetails(body, previous, process), qty: num(body.qty, '수량'), unit: unitText, lot: str(body.lot, 100), note: str(body.note, 500) };
}
// 수량(qty)은 양품 수량이고 불량수량은 따로 셉니다. 총 수량 = 양품 + 불량.
// 작업시간은 시작·종료 시각에서 계산합니다(종료가 시작보다 이르면 자정을 넘긴 작업).
function semiWorkDetails(body, previous, process) {
  const clock = (key, label) => {
    if (body[key] === undefined) return previous ? previous[key] : null;
    const value = str(body[key], 5); if (!value) return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw bad(`${label}을 확인하세요. (예: 08:30)`);
    return value;
  };
  const start = clock('start_time', '시작 시각'), end = clock('end_time', '종료 시각');
  if (process !== 'wash' && !start !== !end) throw bad('시작 시각과 종료 시각을 함께 입력하세요.');
  let hours = previous && body.end_time === undefined && (process === 'wash' || body.start_time === undefined) ? previous.work_hours : null;
  let breakMinutes = body.break_minutes === undefined ? (previous ? previous.break_minutes : 0) : num(body.break_minutes, '휴게시간', { required: false }) ?? 0;
  if (!Number.isInteger(breakMinutes)) throw bad('휴게시간은 분 단위 정수로 입력하세요.');
  if (start && end && !(process === 'wash' && previous && body.end_time === undefined)) {
    const minutes = h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3)); let span = minutes(end) - minutes(start); if (span <= 0) span += 24 * 60;
    if (breakMinutes >= span) throw bad('휴게시간이 작업시간보다 길 수 없습니다.');
    hours = Math.round((span - breakMinutes) / 60 * 100) / 100; // worked time excludes breaks
  } else if (breakMinutes && !(process === 'wash' && previous && body.end_time === undefined) && (body.start_time !== undefined || body.end_time !== undefined || !previous)) breakMinutes = 0; // a break means nothing without clock times
  let workers = previous ? previous.workers : null;
  if (body.workers !== undefined) { workers = num(body.workers, '생산인원', { required: false }); if (workers !== null && (!Number.isInteger(workers) || workers > 10000)) throw bad('생산인원은 정수로 입력하세요.'); }
  const defect = body.defect_qty === undefined ? (previous ? previous.defect_qty : 0) : num(body.defect_qty, '불량수량', { required: false }) ?? 0;
  let reason = body.defect_reason === undefined ? (previous ? previous.defect_reason : '') : str(body.defect_reason, 40);
  if (reason && !SEMI_DEFECT_REASONS[process].includes(reason)) throw bad('불량 사유를 다시 선택하세요.');
  if (!defect) reason = '';
  return { start_time: start, end_time: end, break_minutes: breakMinutes, work_hours: hours, workers, defect_qty: defect, defect_reason: reason };
}
function semiProcess(value) { const process = String(value || ''); if (!Object.hasOwn(SEMI_UNIT_KIND, process)) throw bad('작업 구분을 확인하세요.'); return process; }
async function listSemiRecords({ user, query, operator = false }) {
  const where = ['process=?'], args = [semiProcess(query.process)];
  if (operator) { where.push('created_by_id=?'); args.push(user.id); }
  applyListDates(where, args, query, 'work_date');
  if (query.unit_id) { if (!/^[1-9]\d*$/.test(query.unit_id)) throw bad('라인·호기를 확인하세요.'); where.push('unit_id=?'); args.push(Number(query.unit_id)); }
  if (query.product_group) { if (!Object.hasOwn(SEMI_PRODUCTS, query.product_group)) throw bad('품목 구분을 확인하세요.'); where.push('product_group=?'); args.push(query.product_group); }
  applyListKeyword(where, args, query.q, ['unit_name', 'product_type', 'item_name', 'product_code', 'spec', 'lot', 'note', 'created_by']);
  const rows = await db.prepare(`SELECT semi_records.*, (SELECT c.id FROM semi_record_changes c WHERE c.record_id=semi_records.id AND c.status='pending') AS pending_change_id
    FROM semi_records WHERE ${where.join(' AND ')} ORDER BY work_date DESC, id DESC LIMIT 2001`).all(...args);
  if (rows.length > 2000) throw bad('기록이 너무 많습니다. 기간을 좁히세요.');
  return operator ? rows.map(({ bom_snapshot, request_id, ...row }) => row) : rows;
}
route('GET', '/api/semi-records', listSemiRecords);
route('GET', '/api/operator/semi-records', context => listSemiRecords({ ...context, operator: true }));
route('POST', '/api/semi-records', async ({ user, body }) => {
  const process = semiProcess(body.process); const f = await semiFields(body, process);
  const key = body.request_id === undefined ? randomHex(16) : String(body.request_id);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('요청 번호를 확인하세요.');
  const old = await db.prepare('SELECT * FROM semi_records WHERE request_id=?').get(key);
  if (old) { if (old.created_by_id !== user.id || old.process !== process || old.unit_id !== f.unit_id || old.qty !== f.qty || old.work_date !== f.work_date) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return old; }
  const r = await db.prepare('INSERT INTO semi_records(process,work_date,unit_id,unit_name,product_group,product_type,bom_id,item_name,product_code,bom_snapshot,spec,start_time,end_time,break_minutes,work_hours,workers,defect_qty,defect_reason,qty,unit,lot,note,request_id,created_by_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(process, f.work_date, f.unit_id, f.unit_name, f.product_group, f.product_type, f.bom_id, f.item_name, f.product_code, f.bom_snapshot, f.spec, f.start_time, f.end_time, f.break_minutes, f.work_hours, f.workers, f.defect_qty, f.defect_reason, f.qty, f.unit, f.lot, f.note, key, user.id, user.name);
  return mustGet('semi_records', r.lastInsertRowid);
});
// ── 1) several lines for one date and line/washer in a single, all-or-nothing submission ──
route('POST', '/api/semi-batches', async ({ user, body }) => {
  const process = semiProcess(body.process);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) throw bad('기록은 한 번에 1~30줄 등록하세요.');
  if (body.common !== undefined && (!body.common || typeof body.common !== 'object' || Array.isArray(body.common))) throw bad('공통 입력 내용을 확인하세요.');
  const key = body.request_id === undefined ? randomHex(16) : String(body.request_id);
  if (!/^[a-zA-Z0-9-]{16,60}$/.test(key)) throw bad('요청 번호를 확인하세요.');
  const resultRows = rows => isOperator(user) ? rows.map(({ bom_snapshot, request_id, ...row }) => row) : rows;
  const saved = () => db.prepare("SELECT * FROM semi_records WHERE request_id LIKE ? ESCAPE '\\' ORDER BY id").all(key.replace(/[\\%_]/g, '\\$&') + ':%');
  const replay = rows => { if (rows.some(r => r.created_by_id !== user.id || r.process !== process) || rows.length !== body.items.length) throw new HttpError(409, '이미 사용된 요청 번호입니다. 새로 열어 등록하세요.'); return { rows: resultRows(rows), replayed: true }; };
  const existing = await saved(); if (existing.length) return replay(existing);
  const commands = [];
  for (const [index, item] of body.items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad(`${index + 1}번째 줄을 확인하세요.`);
    let f; try { f = await semiFields({ ...(body.common || {}), ...item }, process); }
    catch (error) { if (error.status === 400 || error.status === 404) throw bad(`${index + 1}번째 줄: ${error.message}`); throw error; }
    commands.push({ sql: 'INSERT INTO semi_records(process,work_date,unit_id,unit_name,product_group,product_type,bom_id,item_name,product_code,bom_snapshot,spec,start_time,end_time,break_minutes,work_hours,workers,defect_qty,defect_reason,qty,unit,lot,note,request_id,created_by_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      args: [process, f.work_date, f.unit_id, f.unit_name, f.product_group, f.product_type, f.bom_id, f.item_name, f.product_code, f.bom_snapshot, f.spec, f.start_time, f.end_time, f.break_minutes, f.work_hours, f.workers, f.defect_qty, f.defect_reason, f.qty, f.unit, f.lot, f.note, `${key}:${index}`, user.id, user.name] });
  }
  try { await db.batch(commands); }
  catch (error) { const rows = await saved(); if (rows.length) return replay(rows); throw error; }
  return { rows: resultRows(await saved()), replayed: false };
});
// Recorded quantities change only with a production team lead's approval; LOT and notes can be fixed directly.
const SEMI_FIELDS = ['work_date', 'unit_id', 'unit_name', 'product_group', 'product_type', 'bom_id', 'item_name', 'product_code', 'bom_snapshot', 'spec', 'qty', 'defect_qty', 'unit', 'start_time', 'end_time', 'break_minutes', 'work_hours', 'workers', 'defect_reason', 'lot', 'note'];
const SEMI_DIRECT_FIELDS = ['defect_qty', 'defect_reason', 'start_time', 'end_time', 'break_minutes', 'work_hours', 'workers', 'lot', 'note']; // good quantity and identity need approval; these do not move stock
const SEMI_APPROVAL_FIELDS = ['work_date', 'unit_id', 'product_group', 'product_type', 'bom_id', 'spec', 'qty', 'unit'];
// A request stays approvable as long as the fields it recorded are unchanged (older requests know fewer fields).
const semiUnchanged = (row, oldData) => { const old = JSON.parse(oldData); return Object.keys(old).every(key => old[key] === row[key]); };
const semiSnapshot = row => JSON.stringify(Object.fromEntries(SEMI_FIELDS.map(key => [key, row[key]])));
async function semiPending(recordId) { return db.prepare("SELECT 1 FROM semi_record_changes WHERE record_id=? AND status='pending'").get(recordId); }
async function requestSemiChange(user, row, action, next, body) {
  const reason = reqStr(body.reason, action === 'delete' ? '삭제 사유' : '수정 사유', 500);
  const key = body.request_id === undefined ? randomHex(16) : String(body.request_id);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('요청 번호를 확인하세요.');
  const newData = next ? JSON.stringify(Object.fromEntries(SEMI_FIELDS.map(k => [k, next[k]]))) : null;
  const same = c => c.record_id === row.id && c.action === action && c.requested_by_id === user.id && c.new_data === newData && c.reason === reason;
  const old = await db.prepare('SELECT * FROM semi_record_changes WHERE request_id=?').get(key);
  if (old) { if (!same(old)) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return { pending: old.status === 'pending', change: old }; }
  if (await semiPending(row.id)) throw new HttpError(409, '이 기록에는 이미 승인 대기 중인 수정·삭제 요청이 있습니다.');
  try {
    const r = await db.prepare('INSERT INTO semi_record_changes(record_id,process,action,request_id,old_data,new_data,reason,requested_by_id,requested_by) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(row.id, row.process, action, key, semiSnapshot(row), newData, reason, user.id, user.name);
    return { pending: true, change: await db.prepare('SELECT * FROM semi_record_changes WHERE id=?').get(r.lastInsertRowid) };
  } catch (error) {
    const saved = await db.prepare('SELECT * FROM semi_record_changes WHERE request_id=?').get(key);
    if (saved && same(saved)) return { pending: true, change: saved };
    if (await semiPending(row.id)) throw new HttpError(409, '이 기록에는 이미 승인 대기 중인 수정·삭제 요청이 있습니다.');
    throw error;
  }
}
route('PUT', '/api/semi-records/:id', async ({ user, params, body }) => {
  const row = await mustGet('semi_records', params.id);
  if (!canModify(user, row) && !canManageProduction(user)) throw new HttpError(403, '등록자 또는 생산 담당자만 수정할 수 있습니다.');
  const f = await semiFields(body, row.process, row);
  if (SEMI_APPROVAL_FIELDS.every(key => f[key] === row[key])) {
    if (SEMI_DIRECT_FIELDS.every(key => f[key] === row[key])) throw bad('바뀐 내용이 없습니다.');
    if (await semiPending(row.id)) throw new HttpError(409, '승인 대기 중인 요청이 처리된 뒤에 수정하세요.');
    await db.prepare('UPDATE semi_records SET defect_qty=?,defect_reason=?,start_time=?,end_time=?,break_minutes=?,work_hours=?,workers=?,lot=?,note=?,updated_by=?,updated_at=? WHERE id=?').run(f.defect_qty, f.defect_reason, f.start_time, f.end_time, f.break_minutes, f.work_hours, f.workers, f.lot, f.note, user.name, now(), row.id);
    return { pending: false, record: await mustGet('semi_records', row.id) };
  }
  return requestSemiChange(user, row, 'edit', f, body);
});
route('DELETE', '/api/semi-records/:id', async ({ user, params, body }) => {
  const row = await mustGet('semi_records', params.id);
  if (!canModify(user, row) && !canManageProduction(user)) throw new HttpError(403, '등록자 또는 생산 담당자만 삭제를 요청할 수 있습니다.');
  return requestSemiChange(user, row, 'delete', null, body);
});
const decodeSemiChange = c => c && ({ ...c, old_data: JSON.parse(c.old_data), new_data: c.new_data ? JSON.parse(c.new_data) : null });
route('GET', '/api/semi-changes', async ({ query }) => {
  const where = [], args = [];
  if (query.id !== undefined) { if (!/^[1-9]\d*$/.test(query.id)) throw bad('요청 번호를 확인하세요.'); where.push('id=?'); args.push(Number(query.id)); }
  if (query.status) { if (!['pending', 'approved', 'rejected', 'cancelled'].includes(query.status)) throw bad('요청 상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  if (query.process) { where.push('process=?'); args.push(semiProcess(query.process)); }
  return (await db.prepare(`SELECT * FROM semi_record_changes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`).all(...args)).map(decodeSemiChange);
});
async function pendingSemiChange(id) {
  if (!/^[1-9]\d*$/.test(String(id))) throw bad('요청 번호를 확인하세요.');
  const change = await db.prepare('SELECT * FROM semi_record_changes WHERE id=?').get(Number(id));
  if (!change) throw new HttpError(404, '수정 요청을 찾을 수 없습니다.');
  if (change.status !== 'pending') throw new HttpError(409, '이미 처리된 요청입니다.');
  return change;
}
route('POST', '/api/semi-changes/:id/approve', async ({ user, params, body }) => {
  requireActualApprover(user);
  const change = await pendingSemiChange(params.id); const stamp = now();
  const row = await db.prepare('SELECT * FROM semi_records WHERE id=?').get(change.record_id);
  if (!row || !semiUnchanged(row, change.old_data)) throw new HttpError(409, '요청 이후 기록이 바뀌었습니다. 반려하고 새로 요청하세요.');
  const applied = "EXISTS(SELECT 1 FROM semi_record_changes WHERE id=? AND status='approved' AND reviewed_at=?)";
  const next = change.new_data ? JSON.parse(change.new_data) : null;
  if (next && next.work_date > today()) throw bad('아직 지나지 않은 날짜로는 승인할 수 없습니다.');
  const results = await db.batch([
    { sql: "UPDATE semi_record_changes SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'", args: [user.name, stamp, str(body.note, 500), change.id] },
    change.action === 'edit'
      ? { sql: `UPDATE semi_records SET ${SEMI_FIELDS.filter(k => k in next).map(k => k + '=?').join(',')},updated_by=?,updated_at=? WHERE id=? AND ${applied}`, args: [...SEMI_FIELDS.filter(k => k in next).map(k => next[k]), `${change.requested_by} (승인: ${user.name})`, stamp, row.id, change.id, stamp] }
      : { sql: `DELETE FROM semi_records WHERE id=? AND ${applied}`, args: [row.id, change.id, stamp] },
  ]);
  if (!results[0].meta.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return decodeSemiChange(await db.prepare('SELECT * FROM semi_record_changes WHERE id=?').get(change.id));
});
route('POST', '/api/semi-changes/:id/reject', async ({ user, params, body }) => {
  requireActualApprover(user);
  const change = await pendingSemiChange(params.id);
  const r = await db.prepare("UPDATE semi_record_changes SET status='rejected',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'").run(user.name, now(), reqStr(body.note, '반려 사유', 500), change.id);
  if (!r.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return decodeSemiChange(await db.prepare('SELECT * FROM semi_record_changes WHERE id=?').get(change.id));
});
route('POST', '/api/semi-changes/:id/cancel', async ({ user, params }) => {
  const change = await pendingSemiChange(params.id);
  if (change.requested_by_id !== user.id && !user.is_admin) throw new HttpError(403, '요청한 사람만 철회할 수 있습니다.');
  const r = await db.prepare("UPDATE semi_record_changes SET status='cancelled',reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'").run(user.name, now(), change.id);
  if (!r.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  return { ok: true };
});

// ── 수율 목표 · 세탁 대기 · 확인이 필요한 일 ──
function yieldTarget(value) {
  if (value === '' || value == null) return null;
  const n = Number(value); if (!Number.isFinite(n) || n <= 0 || n > 100) throw bad('목표 수율은 0보다 크고 100 이하인 숫자로 입력하세요.');
  return Math.round(n * 10) / 10;
}
async function defaultYieldTarget() { const v = Number(await getSetting('semi_yield_target')); return v > 0 && v <= 100 ? v : 95; }
route('GET', '/api/semi-settings', async ({ user }) => ({ yield_target: await defaultYieldTarget(), can_edit: !!user.is_admin || publicUser(user).roles.includes('production_approver') }));
route('PUT', '/api/semi-settings', async ({ user, body }) => {
  requireActualApprover(user);
  const target = yieldTarget(body.yield_target); if (target === null) throw bad('목표 수율을 입력하세요.');
  await setSetting('semi_yield_target', target); return { yield_target: target };
});
// Yield over the last 7 days for each line / washer against its own target (or the default).
async function lowYieldUnits() {
  const fallback = await defaultYieldTarget();
  const rows = await db.prepare(`SELECT r.process, r.unit_id, MAX(r.unit_name) AS unit_name, u.yield_target, SUM(r.qty) AS qty, SUM(r.defect_qty) AS defect_qty
    FROM semi_records r LEFT JOIN production_units u ON u.id=r.unit_id WHERE r.work_date>=date('now','+9 hours','-6 days') AND r.work_date<=date('now','+9 hours') GROUP BY r.process, r.unit_id`).all();
  return rows.map(r => { const total = r.qty + r.defect_qty; return { process: r.process, unit_name: r.unit_name, target: r.yield_target ?? fallback, yield_rate: total ? Math.round(r.qty / total * 1000) / 10 : null, qty: r.qty, defect_qty: r.defect_qty }; })
    .filter(r => r.yield_rate !== null && r.yield_rate < r.target).sort((a, b) => (a.yield_rate - a.target) - (b.yield_rate - b.target));
}
// 세탁 대기: 커팅/융착 양품 누계 − 세탁 처리(양품 + 불량) 누계, 품목·규격·단위별.
route('GET', '/api/semi-wip', async () => {
  const label = "COALESCE(NULLIF(item_name,''), CASE WHEN product_type='' THEN CASE product_group WHEN 'seamless' THEN '심리스글러브 (종류 미지정)' ELSE '와이퍼 (종류 미지정)' END WHEN product_group='seamless' THEN '심리스 ' || product_type ELSE product_type END)";
  const rows = await db.prepare(`SELECT ${label} AS item, spec, unit, SUM(CASE WHEN process='cut' THEN qty ELSE 0 END) AS cut_qty,
      SUM(CASE WHEN process='wash' THEN qty + defect_qty ELSE 0 END) AS washed_qty, MAX(work_date) AS last_date
    FROM semi_records GROUP BY 1,2,3 ORDER BY 1,2,3 LIMIT 2000`).all();
  return rows.map(r => ({ ...r, waiting_qty: Math.round((r.cut_qty - r.washed_qty) * 1e6) / 1e6 }));
});
route('GET', '/api/alerts', async ({ user }) => {
  const t = today(); const roles = publicUser(user).roles;
  const overduePos = await db.prepare("SELECT id, req_no, vendor, item, spec, qty, unit, due_date, recv_status FROM purchase_orders WHERE recv_status IN ('','checking') AND due_date<? ORDER BY due_date LIMIT 5").all(t);
  const overduePoCount = (await db.prepare("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status IN ('','checking') AND due_date<?").get(t)).c;
  const overdueRequests = await db.prepare("SELECT id, type, title, due_date, status, requester_name FROM requests WHERE status IN ('pending','waiting','progress') AND due_date IS NOT NULL AND due_date<>'' AND due_date<? ORDER BY due_date LIMIT 5").all(t);
  const overdueRequestCount = (await db.prepare("SELECT COUNT(*) c FROM requests WHERE status IN ('pending','waiting','progress') AND due_date IS NOT NULL AND due_date<>'' AND due_date<?").get(t)).c;
  // Approvals waiting more than 3 days, whoever has to give them.
  const cutoff = "datetime('now','+9 hours','-3 days')";
  const stale = [];
  for (const type of Object.keys(REQUEST_TYPES)) { const r = await db.prepare(`SELECT COUNT(*) c, MIN(created_at) oldest FROM requests WHERE type=? AND status='pending' AND created_at<${cutoff}`).get(type); if (r.c) stale.push({ kind: 'request', type, count: r.c, oldest: r.oldest }); }
  for (const [kind, table] of [['actual_changes', 'production_actual_changes'], ['receipt_changes', 'receipt_qty_changes'], ['semi_changes', 'semi_record_changes']]) {
    const r = await db.prepare(`SELECT COUNT(*) c, MIN(requested_at) oldest FROM ${table} WHERE status='pending' AND requested_at<${cutoff}`).get(); if (r.c) stale.push({ kind, count: r.c, oldest: r.oldest });
  }
  const result = { today: t, overdue_pos: overduePos, overdue_po_count: overduePoCount, overdue_requests: overdueRequests, overdue_request_count: overdueRequestCount, stale_approvals: stale, low_yield: await lowYieldUnits() };
  if (user.is_admin) { const last = await getSetting('last_backup_at'); result.backup = { last_at: last, days: last ? Math.floor((Date.parse(t) - Date.parse(String(last).slice(0, 10))) / 864e5) : null, by: await getSetting('last_backup_by') }; }
  return result;
});
route('POST', '/api/admin/backup-done', async ({ user }) => { requireAdmin(user); await setSetting('last_backup_at', now()); await setSetting('last_backup_by', user.name); return { last_at: await getSetting('last_backup_at') }; });

// ── 수정 이력: 무엇이 어떻게 바뀌었는지 진행 코멘트에 자동으로 남깁니다 ──
function editTrail(entity, id, before, after, labels, user) {
  const show = v => v === null || v === undefined || v === '' ? '없음' : String(v);
  const changes = Object.entries(labels).filter(([key]) => show(before[key]) !== show(after[key])).map(([key, label]) => `${label} ${show(before[key])} → ${show(after[key])}`);
  if (!changes.length) return null;
  return { sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: [entity, id, ('[수정] ' + changes.join(', ')).slice(0, 2000), user.id, user.name] };
}
async function recordEdit(entity, table, id, before, labels, user) {
  const trail = editTrail(entity, id, before, await mustGet(table, id), labels, user);
  if (trail) await db.prepare(trail.sql).run(...trail.args);
}
const EDIT_LABELS = {
  purchase_order: { req_no: '구매의뢰번호', vendor: '거래처', item: '품목', qty: '수량', due_date: '납기일', item_category: '분류', coa_requested: 'COA 요청', note: '비고', spec: '규격', unit: '단위', lot: 'LOT' },
  shipment: { ship_date: '출고일', item: '품목', qty: '수량', customer: '거래처', lot: 'LOT', note: '비고', spec: '규격', unit: '단위' },
  other_receipt: { received_date: '입고일', item: '품목', qty: '수량', vendor: '입고처', note: '비고', spec: '규격', unit: '단위', lot: 'LOT' },
  schedule: { period: '일정 기준', start_date: '시작일', product: '품목', qty: '계획수량', note: '비고', spec: '규격', unit: '단위', lot: 'LOT' },
  laundry: { in_date: '입고일', item: '옷 종류', in_qty: '입고수량', discard_qty: '폐기수량', note: '메모', spec: '규격', unit: '단위', lot: 'LOT' },
};

// ── 물류: 재고 현황 (입고 + 생산실적 − 생산 투입 − 출하 ± 재고 조정으로 계산) ──
// Stock is derived, never stored: each source row is one movement. BOM materials have no size,
// so material use is booked without a spec; the default view therefore totals by item + unit.
const STOCK_MOVEMENTS = `
  SELECT TRIM(item) AS item, spec, TRIM(unit) AS unit, item_category AS category, recv_qty AS qty, 'po' AS src,
    COALESCE(substr(recv_at,1,10), due_date, '0000-00-00') AS d, id AS ref, req_no || ' · ' || vendor AS memo
    FROM purchase_orders WHERE recv_status IN ('ok','mismatch') AND recv_qty IS NOT NULL
  UNION ALL
  SELECT TRIM(item), spec, TRIM(COALESCE(NULLIF(unit,''), json_extract(bom_snapshot,'$.unit'), '')), item_category, qty, 'other', received_date, id, vendor
    FROM other_receipts
  UNION ALL
  SELECT TRIM(s.product), s.spec, TRIM(COALESCE(NULLIF(s.unit,''), json_extract(s.bom_snapshot,'$.unit'), '')),
    COALESCE(NULLIF(json_extract(s.bom_snapshot,'$.item_category'),''), CASE s.kind WHEN 'finished' THEN '제품' ELSE '반제품' END), a.qty, 'prod', a.production_date, a.id, a.author_name
    FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE a.voided_at IS NULL
  UNION ALL
  SELECT TRIM(json_extract(m.value,'$.item')), '', TRIM(COALESCE(json_extract(m.value,'$.unit'),'')), COALESCE(json_extract(m.value,'$.item_category'),''),
    -a.qty * json_extract(m.value,'$.qty') / json_extract(s.bom_snapshot,'$.base_qty'), 'use', a.production_date, a.id, s.product || ' 생산 투입'
    FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id, json_each(s.bom_snapshot,'$.materials') m
    WHERE a.voided_at IS NULL AND s.bom_id IS NOT NULL AND json_extract(s.bom_snapshot,'$.base_qty')>0
  UNION ALL
  SELECT TRIM(item), spec, TRIM(unit), '', -qty, 'ship', ship_date, id, customer FROM shipments
  UNION ALL
  SELECT COALESCE(NULLIF(item_name,''), CASE product_group WHEN 'seamless' THEN '심리스 ' || product_type ELSE product_type END), spec, TRIM(unit), '반제품', qty, 'prod', work_date, id, unit_name || ' 커팅/융착'
    FROM semi_records WHERE process='cut'
  UNION ALL
  SELECT TRIM(json_extract(m.value,'$.item')), '', TRIM(COALESCE(json_extract(m.value,'$.unit'),'')), COALESCE(json_extract(m.value,'$.item_category'),''),
    -(r.qty + r.defect_qty) * json_extract(m.value,'$.qty') / json_extract(r.bom_snapshot,'$.base_qty'), 'use', r.work_date, r.id, r.item_name || ' 커팅/융착 투입'
    FROM semi_records r, json_each(r.bom_snapshot,'$.materials') m
    WHERE r.process='cut' AND r.bom_id IS NOT NULL AND json_extract(r.bom_snapshot,'$.base_qty')>0
  UNION ALL
  SELECT TRIM(item), spec, TRIM(unit), '', qty, 'adjust', adj_date, id, reason || ' · ' || created_by FROM stock_adjustments`;
const stockRound = n => Math.round((Number(n) || 0) * 1e6) / 1e6;
const canAdjustStock = user => !!user.is_admin || publicUser(user).roles.includes('logistics_approver');
function stockAsOf(value) { const d = listFilterDate(value, '기준일') || today(); if (d > today()) throw bad('기준일은 오늘 이전으로 선택하세요.'); return d; }
async function stockQuantity(item, unit, spec, asof) {
  const row = await db.prepare(`SELECT COALESCE(SUM(qty),0) AS qty FROM (${STOCK_MOVEMENTS}) WHERE item=? AND unit=? ${spec === null ? '' : 'AND spec=?'} AND d<=?`).get(...(spec === null ? [item, unit, asof] : [item, unit, spec, asof]));
  return stockRound(row.qty);
}
route('GET', '/api/inventory', async ({ user, query }) => {
  const asof = stockAsOf(query.asof); const bySpec = query.group === 'spec';
  if (query.group && !['item', 'spec'].includes(query.group)) throw bad('보기 기준을 확인하세요.');
  const where = ['d<=?'], args = [asof];
  applyListKeyword(where, args, query.q, ['item', 'spec']);
  const rows = await db.prepare(`SELECT item, ${bySpec ? 'spec' : "''"} AS spec, unit, MAX(category) AS category,
      SUM(CASE WHEN src IN ('po','other') THEN qty ELSE 0 END) AS received, SUM(CASE WHEN src='prod' THEN qty ELSE 0 END) AS produced,
      SUM(CASE WHEN src='use' THEN -qty ELSE 0 END) AS used, SUM(CASE WHEN src='ship' THEN -qty ELSE 0 END) AS shipped,
      SUM(CASE WHEN src='adjust' THEN qty ELSE 0 END) AS adjusted, SUM(qty) AS stock, MAX(d) AS last_date
    FROM (${STOCK_MOVEMENTS}) WHERE ${where.join(' AND ')} GROUP BY 1,2,3 ORDER BY item, spec, unit LIMIT 5001`).all(...args);
  if (rows.length > 5000) throw bad('품목이 너무 많습니다. 검색어로 범위를 좁히세요.');
  const levels = new Map((await db.prepare('SELECT * FROM stock_levels').all()).map(l => [l.item + '\u0000' + l.unit, l.min_qty]));
  // By size, BOM material use sits on the unsized row; only flag a shortage when the item as a whole is short.
  const totals = new Map(); for (const r of rows) totals.set(r.item + '\u0000' + r.unit, (totals.get(r.item + '\u0000' + r.unit) || 0) + r.stock);
  let list = rows.map(r => {
    const min = bySpec ? null : levels.get(r.item + '\u0000' + r.unit) ?? null; const stock = stockRound(r.stock);
    return { ...r, received: stockRound(r.received), produced: stockRound(r.produced), used: stockRound(r.used), shipped: stockRound(r.shipped), adjusted: stockRound(r.adjusted), stock, min_qty: min, low: min !== null && stock < min, negative: stock < 0 && stockRound(totals.get(r.item + '\u0000' + r.unit)) < 0 };
  });
  // The catalog is the authority for an item's class, code and sub-classes; unregistered items keep what their records say.
  const catalog = new Map(); for (const b of await db.prepare('SELECT product,product_code,item_category,cat1,cat2,cat3 FROM boms WHERE active=1 ORDER BY is_temp DESC, id DESC').all()) catalog.set(nameKey(b.product), b);
  list = list.map(r => { const c = catalog.get(nameKey(r.item)); return { ...r, category: c?.item_category || r.category, product_code: c?.product_code || '', cat1: c?.cat1 || '', cat2: c?.cat2 || '', cat3: c?.cat3 || '' }; });
  if (query.item_category) { const c = itemCategory(query.item_category); list = list.filter(r => r.category === c); }
  for (const key of ['cat1', 'cat2', 'cat3']) if (query[key]) list = list.filter(r => r[key] === query[key]);
  if (query.state === 'low') list = list.filter(r => r.low); else if (query.state === 'negative') list = list.filter(r => r.negative);
  else if (query.state === 'instock') list = list.filter(r => r.stock > 0); else if (query.state) throw bad('재고 상태를 확인하세요.');
  return { asof, group: bySpec ? 'spec' : 'item', rows: list, can_adjust: canAdjustStock(user) };
});
route('GET', '/api/inventory/movements', async ({ query }) => {
  const item = reqStr(query.item, '품목명', 200), unit = str(query.unit, 20); const asof = stockAsOf(query.asof);
  const bySpec = query.spec !== undefined;
  const rows = await db.prepare(`SELECT * FROM (${STOCK_MOVEMENTS}) WHERE item=? AND unit=? ${bySpec ? 'AND spec=?' : ''} AND d<=? ORDER BY d DESC, src, ref DESC LIMIT 201`).all(...(bySpec ? [item, unit, str(query.spec, 100), asof] : [item, unit, asof]));
  return { rows: rows.slice(0, 200).map(r => ({ ...r, qty: stockRound(r.qty) })), more: rows.length > 200, stock: await stockQuantity(item, unit, bySpec ? str(query.spec, 100) : null, asof) };
});
// Opening stock, stock counts and corrections: logistics lead or admin only, append-only.
route('POST', '/api/inventory/adjustments', async ({ user, body }) => {
  if (!canAdjustStock(user)) throw new HttpError(403, '재고 조정은 물류팀장 또는 관리자만 할 수 있습니다.');
  const item = reqStr(body.item, '품목명', 200), spec = str(body.spec, 100), unit = str(body.unit, 20);
  const kind = String(body.kind || ''); if (!['opening', 'count', 'adjust'].includes(kind)) throw bad('조정 종류를 선택하세요.');
  const date = dateStr(body.adj_date || today(), '기준일'); if (date > today()) throw bad('기준일은 오늘 이전으로 선택하세요.');
  const reason = reqStr(body.reason, '사유', 500);
  const key = body.request_id === undefined ? randomHex(16) : String(body.request_id);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('요청 번호를 확인하세요.');
  const old = await db.prepare('SELECT * FROM stock_adjustments WHERE request_id=?').get(key);
  if (old) { if (old.created_by_id !== user.id || old.item !== item || old.unit !== unit || old.spec !== spec || old.kind !== kind) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return old; }
  let qty, counted = null;
  if (kind === 'count') {
    // A stock count records the difference between what was counted and what the records say on that date.
    counted = num(body.counted_qty, '실사 수량');
    qty = stockRound(counted - await stockQuantity(item, unit, body.spec === undefined || body.by_item ? null : spec, date));
  } else {
    qty = Number(body.qty); if (body.qty === '' || body.qty == null || !Number.isFinite(qty) || qty === 0) throw bad('조정 수량을 입력하세요. (감소는 음수)');
    if (kind === 'opening' && qty < 0) throw bad('기초재고는 0보다 커야 합니다.');
  }
  const r = await db.prepare('INSERT INTO stock_adjustments(adj_date,item,spec,unit,qty,kind,counted_qty,reason,request_id,created_by_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(date, item, spec, unit, qty, kind, counted, reason, key, user.id, user.name);
  return db.prepare('SELECT * FROM stock_adjustments WHERE id=?').get(r.lastInsertRowid);
});
route('PUT', '/api/inventory/levels', async ({ user, body }) => {
  if (!canAdjustStock(user)) throw new HttpError(403, '안전재고 기준은 물류팀장 또는 관리자만 정할 수 있습니다.');
  const item = reqStr(body.item, '품목명', 200), unit = str(body.unit, 20);
  if (body.min_qty === '' || body.min_qty == null) { await db.prepare('DELETE FROM stock_levels WHERE item=? AND unit=?').run(item, unit); return { item, unit, min_qty: null }; }
  const min = num(body.min_qty, '안전재고');
  await db.prepare("INSERT INTO stock_levels(item,unit,min_qty,updated_by) VALUES(?,?,?,?) ON CONFLICT(item,unit) DO UPDATE SET min_qty=excluded.min_qty,updated_by=excluded.updated_by,updated_at=datetime('now','+9 hours')").run(item, unit, min, user.name);
  return { item, unit, min_qty: min };
});
async function stockAlerts() {
  // Bound each source separately: D1 need not plan a large compound query with JSON virtual tables.
  const totals = new Map();
  for (const source of STOCK_MOVEMENTS.split('UNION ALL')) {
    const rows = await db.prepare(`WITH movements(item,spec,unit,category,qty,src,d,ref,memo) AS (${source}) SELECT item,unit,SUM(qty) AS stock FROM movements WHERE d<=? GROUP BY 1,2`).all(today());
    for (const row of rows) { const key = row.item + '\u0000' + row.unit; const old = totals.get(key); totals.set(key, { ...row, stock: (old?.stock || 0) + (row.stock || 0) }); }
  }
  const rows = [...totals.values()];
  const levels = new Map((await db.prepare('SELECT * FROM stock_levels').all()).map(l => [l.item + '\u0000' + l.unit, l.min_qty]));
  return { low: rows.filter(r => levels.has(r.item + '\u0000' + r.unit) && stockRound(r.stock) < levels.get(r.item + '\u0000' + r.unit)).length, negative: rows.filter(r => stockRound(r.stock) < 0).length };
}

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
  if (user.is_admin || roles.includes('production_approver')) {
    const items = (await db.prepare("SELECT * FROM semi_record_changes WHERE status='pending' ORDER BY id LIMIT 50").all()).map(decodeSemiChange);
    approvals.semi_changes = { count: items.length, cut: items.filter(c => c.process === 'cut').length, wash: items.filter(c => c.process === 'wash').length, items: items.slice(0, 5) };
  }
  if (user.is_admin || roles.includes('logistics_approver')) {
    const items = await db.prepare(`${receiptChangeSelect} WHERE c.status='pending' ORDER BY c.id LIMIT 50`).all();
    approvals.receipt_changes = { count: items.length, items: items.slice(0, 5) };
  }
  if (user.is_admin) approvals.temp_items = { count: (await db.prepare('SELECT COUNT(*) c FROM boms WHERE is_temp=1 AND active=1').get()).c };
  // My own requests still waiting, plus rejections from the last 7 days so the requester notices them.
  const recent = "(c.status='pending' OR (c.status='rejected' AND c.reviewed_at>=date('now','+9 hours','-7 days')))";
  const mine = {
    requests: await db.prepare("SELECT id,type,status,title,reject_reason,approver_name,created_at FROM requests WHERE requester_id=? AND status IN ('pending','rejected') ORDER BY id DESC LIMIT 20").all(user.id),
    actual_changes: await db.prepare(`${actualChangeSelect} WHERE c.requested_by_id=? AND ${recent} ORDER BY c.id DESC LIMIT 20`).all(user.id),
    semi_changes: (await db.prepare("SELECT * FROM semi_record_changes c WHERE c.requested_by_id=? AND " + recent + " ORDER BY c.id DESC LIMIT 20").all(user.id)).map(decodeSemiChange),
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
    stock: await stockAlerts().catch(error => { console.error('Dashboard stock alerts: ' + error.message); return null; }),
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
      if (isOperator(user) && !operatorRequestAllowed(req.method, p)) throw new HttpError(403, '오퍼레이터는 반제품·완제품 실적 입력과 본인 기록 조회만 사용할 수 있습니다.');
      const body = req.method === 'GET' ? {} : await readBody(req);
      return Response.json(await r.handler({ req, res, user, params, body, query: Object.fromEntries(url.searchParams) }), { headers: res });
    }
    if (p.startsWith('/uploads/')) {
      const user = await currentUser(req);
      if (!user) throw new HttpError(401, '로그인이 필요합니다.');
      if (isOperator(user)) throw new HttpError(403, '오퍼레이터는 첨부 파일을 조회할 수 없습니다.');
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
