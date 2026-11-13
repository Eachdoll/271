// Cloudflare Worker: request-scoped D1/R2 bindings; no third-party runtime packages.
import { database } from './storage.mjs';
const SESSION_DAYS = 30;
const MAX_BODY = 30 * 1024 * 1024;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));

export function createApp(env) {
const db = database(env.DB);
async function getSetting(k) { const r = (await db.prepare('SELECT value FROM settings WHERE key=?').get(k)); return r ? r.value : (k === 'invite_code' ? env.INVITE_CODE || null : null); }
async function setSetting(k, v) { (await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v))); }

// ───────────────────────── 공통 ─────────────────────────
const ROLES = ['purchase', 'quality', 'dev', 'production', 'logistics'];
const REQUEST_TYPES = { analysis: 'quality', development: 'dev', sample: 'production' };
const REQUEST_PREFIX = { analysis: 'Q', development: 'D', sample: 'S' };
const ANALYSIS_CATEGORIES = ['수입검사', '의뢰검사', '출하검사', '공정검사'];
const WORK_STATUSES = ['waiting', 'progress', 'done'];

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
function now() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()); }
function today() { return now().slice(0, 10); }
function publicUser(u) { return { id: u.id, name: u.name, is_admin: !!u.is_admin, roles: u.roles ? u.roles.split(',').filter(Boolean) : [], created_at: u.created_at }; }
function hasRole(user, role) { return user.is_admin || publicUser(user).roles.includes(role); }
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

// ───────────────────────── 인증 ─────────────────────────
// Login throttling is persisted in D1 across Worker instances.
function parseCookies(req) {
  const out = {}; for (const part of (req.headers.get('cookie') || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } return out;
}
async function currentUser(req) {
  const token = parseCookies(req).sid; if (!token) return null;
  const row = (await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(token, Date.now()));
  return row || null;
}
async function startSession(req, res, userId) {
  const token = randomHex(32);
  (await db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, Date.now() + SESSION_DAYS * 864e5));
  (await db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()));
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  res.set('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

// ───────────────────────── 라우터 ─────────────────────────
const routes = [];
function route(method, pattern, handler, { auth = true } = {}) {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
}

// 인증
route('POST', '/api/auth/register', async ({ body, req, res }) => {
  const name = reqStr(body.name, '이름', 30);
  const password = String(body.password || '');
  if (password.length < 4) throw bad('비밀번호는 4자 이상이어야 합니다.');
  if (str(body.invite, 100) !== (await getSetting('invite_code'))) throw bad('초대코드가 올바르지 않습니다.');
  await db.prepare("INSERT INTO settings(key,value) VALUES('invite_code',?) ON CONFLICT(key) DO NOTHING").run(await getSetting('invite_code'));
  if ((await db.prepare('SELECT 1 FROM users WHERE name=?').get(name))) throw bad('이미 가입된 이름입니다. 로그인하세요.');
  const salt = randomHex(16);
  const r = (await db.prepare('INSERT INTO users(name,pw_salt,pw_hash,is_admin) SELECT ?,?,?,NOT EXISTS(SELECT 1 FROM users)').run(name, salt, (await hashPw(password, salt))));
  (await startSession(req, res, Number(r.lastInsertRowid)));
  return { user: publicUser((await db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid))) };
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
  (await startSession(req, res, u.id));
  return { user: publicUser(u) };
}, { auth: false });

route('POST', '/api/auth/logout', async ({ req, res }) => {
  const t = parseCookies(req).sid; if (t) (await db.prepare('DELETE FROM sessions WHERE token=?').run(t));
  res.set('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
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
route('GET', '/api/admin/users', async ({ user }) => { requireAdmin(user); return (await db.prepare('SELECT * FROM users ORDER BY id').all()).map(publicUser); });
route('PUT', '/api/admin/users/:id', async ({ user, params, body }) => {
  requireAdmin(user);
  const target = (await db.prepare('SELECT * FROM users WHERE id=?').get(params.id)); if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  if (body.roles !== undefined) {
    const roles = (Array.isArray(body.roles) ? body.roles : []).filter((r) => ROLES.includes(r));
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
const backupTables = ['settings', 'users', 'purchase_orders', 'laundry', 'requests', 'schedules', 'shipments'];
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
function poFields(b) {
  return [reqStr(b.req_no, '구매의뢰번호', 50), reqStr(b.vendor, '거래처', 100), reqStr(b.item, '품목명', 200), num(b.qty, '수량'), dateStr(b.due_date, '납기일'), str(b.note, 500)];
}
route('GET', '/api/po', async ({ query }) => {
  const where = []; const args = [];
  if (query.q) { where.push('(req_no LIKE ? OR vendor LIKE ? OR item LIKE ?)'); const q = `%${query.q}%`; args.push(q, q, q); }
  if (query.recv === 'none') where.push("recv_status=''");
  else if (query.recv) { where.push('recv_status=?'); args.push(query.recv); }
  return (await db.prepare(`SELECT * FROM purchase_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (recv_status='ok'), due_date, id DESC`).all(...args));
});
route('POST', '/api/po', async ({ user, body }) => {
  const r = (await db.prepare('INSERT INTO purchase_orders(req_no,vendor,item,qty,due_date,note,created_by) VALUES(?,?,?,?,?,?,?)').run(...poFields(body), user.name));
  return (await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(r.lastInsertRowid));
});
route('PUT', '/api/po/:id', async ({ user, params, body }) => {
  const row = (await mustGet('purchase_orders', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 수정할 수 있습니다.');
  (await db.prepare('UPDATE purchase_orders SET req_no=?,vendor=?,item=?,qty=?,due_date=?,note=? WHERE id=?').run(...poFields(body), row.id));
  return (await mustGet('purchase_orders', row.id));
});
route('DELETE', '/api/po/:id', async ({ user, params }) => {
  const row = (await mustGet('purchase_orders', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 삭제할 수 있습니다.');
  (await db.prepare('DELETE FROM purchase_orders WHERE id=?').run(row.id)); return { ok: true };
});
// ── 물류: 발주입고 확인 (ok=초록, mismatch=빨강, checking=노랑, ''=미입고) ──
route('POST', '/api/po/receive', async ({ user, body }) => {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('입고 처리할 항목을 체크하세요.');
  const status = String(body.status || '');
  if (!['ok', 'mismatch', 'checking', ''].includes(status)) throw bad('상태 값이 올바르지 않습니다.');
  const recvQty = status === 'mismatch' ? num(body.recv_qty, '실입고 수량') : null;
  if (status === 'mismatch' && ids.length !== 1) throw bad('수량상이는 한 항목씩 실입고 수량을 입력하세요.');
  const st = db.prepare('UPDATE purchase_orders SET recv_status=?, recv_qty=?, recv_note=?, recv_by=?, recv_at=? WHERE id=?');
  for (const id of ids) {
    const row = (await mustGet('purchase_orders', id));
    (await st.run(status, status === 'ok' ? row.qty : recvQty, str(body.note, 500), status ? user.name : null, status ? now() : null, id));
  }
  return { ok: true };
});

// ── 구매: 세탁관리 ──
route('GET', '/api/laundry', async ({ query }) => {
  const args = []; let where = '';
  if (query.from) { where += ' AND in_date>=?'; args.push(query.from); }
  if (query.to) { where += ' AND in_date<=?'; args.push(query.to); }
  return (await db.prepare(`SELECT * FROM laundry WHERE 1=1 ${where} ORDER BY in_date DESC, id DESC`).all(...args)).map((r) => ({ ...r, photos: JSON.parse(r.photos) }));
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
  const type = String(query.type || ''); if (!REQUEST_TYPES[type]) throw bad('의뢰 종류가 올바르지 않습니다.');
  const where = ['type=?']; const args = [type];
  if (query.scope === 'intake') where.push("status IN ('pending','rejected')");
  else if (query.scope === 'list') where.push("status IN ('waiting','progress','done')");
  if (query.status) { where.push('status=?'); args.push(query.status); }
  if (query.category) { where.push('category=?'); args.push(query.category); }
  return (await db.prepare(`SELECT * FROM requests WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'progress' THEN 1 WHEN 'waiting' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END, id DESC`).all(...args)).map(decodeRequest);
});
route('POST', '/api/requests', async ({ user, body }) => {
  const type = String(body.type || ''); if (!REQUEST_TYPES[type]) throw bad('의뢰 종류가 올바르지 않습니다.');
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
  const status = r.status === 'rejected' && !isMgr ? 'pending' : r.status; // 반려건 수정 시 재접수
  (await db.prepare("UPDATE requests SET title=?,customer=?,due_date=?,category=?,target_price=?,data=?,status=?,updated_at=datetime('now','+9 hours') WHERE id=?")
    .run(f.title, f.customer, f.due_date, f.category, f.target_price, JSON.stringify(f.data), status, r.id));
  return decodeRequest((await getRequest(r.id)));
});
route('POST', '/api/requests/:id/approve', async ({ user, params }) => {
  const r = (await getRequest(params.id)); requireRole(user, REQUEST_TYPES[r.type], roleLabel(r.type));
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
  const r = (await getRequest(params.id)); requireRole(user, REQUEST_TYPES[r.type], roleLabel(r.type));
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
  (await db.prepare('DELETE FROM requests WHERE id=?').run(r.id)); return { ok: true };
});

// ── 생산: 완제품/반제품 생산일정 ──
function normStart(period, d) {
  const dt = new Date(d + 'T00:00:00Z');
  if (period === 'week') dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  if (period === 'month') dt.setUTCDate(1);
  return dt.toISOString().slice(0, 10);
}
function schedFields(b) {
  const kind = String(b.kind); if (!['finished', 'semi'].includes(kind)) throw bad('완제품/반제품 구분이 올바르지 않습니다.');
  const period = String(b.period); if (!['day', 'week', 'month'].includes(period)) throw bad('일간/주간/월간을 선택하세요.');
  return { kind, period, start_date: normStart(period, dateStr(b.start_date, '날짜')), product: reqStr(b.product, '제품명', 200), qty: num(b.qty, '수량'), note: str(b.note, 500) };
}
route('GET', '/api/schedules', async ({ query }) => {
  const kind = String(query.kind || 'finished');
  const from = dateStr(query.from, 'from'); const to = dateStr(query.to, 'to');
  // 기간과 겹치는 일정: 일간(그날), 주간(월~일), 월간(그 달)
  return (await db.prepare(`SELECT * FROM schedules WHERE kind=? AND (
      (period='day' AND start_date BETWEEN ? AND ?) OR
      (period='week' AND start_date<=? AND date(start_date,'+6 days')>=?) OR
      (period='month' AND start_date<=? AND date(start_date,'+1 month','-1 day')>=?)
    ) ORDER BY start_date, period, id`).all(kind, from, to, to, from, to, from));
});
route('POST', '/api/schedules', async ({ user, body }) => {
  const f = schedFields(body);
  const r = (await db.prepare('INSERT INTO schedules(kind,period,start_date,product,qty,note,created_by) VALUES(?,?,?,?,?,?,?)').run(f.kind, f.period, f.start_date, f.product, f.qty, f.note, user.name));
  return (await mustGet('schedules', r.lastInsertRowid));
});
route('PUT', '/api/schedules/:id', async ({ user, params, body }) => {
  const row = (await mustGet('schedules', params.id)); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 수정할 수 있습니다.');
  if (body.toggle_done) { (await db.prepare('UPDATE schedules SET done=1-done WHERE id=?').run(row.id)); return (await mustGet('schedules', row.id)); }
  const f = schedFields({ ...body, kind: row.kind });
  (await db.prepare('UPDATE schedules SET period=?,start_date=?,product=?,qty=?,note=? WHERE id=?').run(f.period, f.start_date, f.product, f.qty, f.note, row.id));
  return (await mustGet('schedules', row.id));
});
route('DELETE', '/api/schedules/:id', async ({ user, params }) => {
  const row = (await mustGet('schedules', params.id)); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 삭제할 수 있습니다.');
  (await db.prepare('DELETE FROM schedules WHERE id=?').run(row.id)); return { ok: true };
});

// ── 물류: 출하목록 ──
function shipFields(b) { return [dateStr(b.ship_date, '출고일'), reqStr(b.item, '품목명', 200), num(b.qty, '수량'), reqStr(b.customer, '거래처', 100), str(b.note, 500)]; }
route('GET', '/api/shipments', async ({ query }) => {
  const from = query.from || today(); const to = query.to || from;
  return (await db.prepare('SELECT * FROM shipments WHERE ship_date BETWEEN ? AND ? ORDER BY ship_date DESC, id DESC').all(from, to));
});
route('POST', '/api/shipments', async ({ user, body }) => {
  const r = (await db.prepare('INSERT INTO shipments(ship_date,item,qty,customer,note,created_by) VALUES(?,?,?,?,?,?)').run(...shipFields(body), user.name));
  return (await mustGet('shipments', r.lastInsertRowid));
});
route('PUT', '/api/shipments/:id', async ({ user, params, body }) => {
  const row = (await mustGet('shipments', params.id)); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 수정할 수 있습니다.');
  (await db.prepare('UPDATE shipments SET ship_date=?,item=?,qty=?,customer=?,note=? WHERE id=?').run(...shipFields(body), row.id)); return (await mustGet('shipments', row.id));
});
route('DELETE', '/api/shipments/:id', async ({ user, params }) => {
  const row = (await mustGet('shipments', params.id)); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 삭제할 수 있습니다.');
  (await db.prepare('DELETE FROM shipments WHERE id=?').run(row.id)); return { ok: true };
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
    if (!(e instanceof HttpError)) console.error(e);
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
