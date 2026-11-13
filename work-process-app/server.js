// 업무프로세스 웹앱 서버 (의존성 없음: Node.js 22.13+ 내장 http + node:sqlite)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_INVITE = process.env.INVITE_CODE || 'sst3554766';
const SESSION_DAYS = 30;
const MAX_BODY = 30 * 1024 * 1024; // 사진 포함 요청 최대 30MB

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ───────────────────────── DB ─────────────────────────
const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  roles TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  req_no TEXT NOT NULL, vendor TEXT NOT NULL, item TEXT NOT NULL,
  qty REAL NOT NULL, due_date TEXT, note TEXT DEFAULT '',
  recv_status TEXT NOT NULL DEFAULT '', recv_qty REAL, recv_note TEXT DEFAULT '',
  recv_by TEXT, recv_at TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS laundry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  in_date TEXT NOT NULL, in_qty REAL, discard_qty REAL NOT NULL,
  note TEXT DEFAULT '', photos TEXT NOT NULL DEFAULT '[]',
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,              -- analysis | development | sample
  status TEXT NOT NULL DEFAULT 'pending', -- pending | rejected | waiting | progress | done
  req_no TEXT,
  title TEXT NOT NULL,
  customer TEXT DEFAULT '',
  due_date TEXT,
  category TEXT DEFAULT '',        -- 분석: 수입검사/의뢰검사/출하검사/공정검사
  target_price TEXT DEFAULT '',    -- 개발: 타겟단가
  data TEXT NOT NULL DEFAULT '{}',
  requester_id INTEGER, requester_name TEXT,
  approver_name TEXT, approved_at TEXT, reject_reason TEXT DEFAULT '',
  result_note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- finished(완제품) | semi(반제품)
  period TEXT NOT NULL,            -- day | week | month
  start_date TEXT NOT NULL,        -- day: 그날, week: 그 주 월요일, month: 그 달 1일
  product TEXT NOT NULL, qty REAL NOT NULL, note TEXT DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_date TEXT NOT NULL, item TEXT NOT NULL, qty REAL NOT NULL,
  customer TEXT NOT NULL, note TEXT DEFAULT '',
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);
if (!getSetting('invite_code')) setSetting('invite_code', DEFAULT_INVITE);

function getSetting(k) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : null; }
function setSetting(k, v) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v)); }

// ───────────────────────── 공통 ─────────────────────────
const ROLES = ['purchase', 'quality', 'dev', 'production', 'logistics'];
const REQUEST_TYPES = { analysis: 'quality', development: 'dev', sample: 'production' };
const REQUEST_PREFIX = { analysis: 'Q', development: 'D', sample: 'S' };
const ANALYSIS_CATEGORIES = ['수입검사', '의뢰검사', '출하검사', '공정검사'];
const WORK_STATUSES = ['waiting', 'progress', 'done'];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);

function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function pwMatches(user, pw) {
  const a = Buffer.from(hashPw(pw, user.pw_salt), 'hex');
  const b = Buffer.from(user.pw_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
function now() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function today() { return now().slice(0, 10); }
function publicUser(u) { return { id: u.id, name: u.name, is_admin: !!u.is_admin, roles: u.roles ? u.roles.split(',').filter(Boolean) : [], created_at: u.created_at }; }
function hasRole(user, role) { return user.is_admin || publicUser(user).roles.includes(role); }
function requireRole(user, role, label) { if (!hasRole(user, role)) throw new HttpError(403, `${label} 담당자만 할 수 있습니다. (관리자에게 권한 요청)`); }
function requireAdmin(user) { if (!user.is_admin) throw new HttpError(403, '관리자만 할 수 있습니다.'); }
function canModify(user, row) { return user.is_admin || row.created_by === user.name; }

// 사진 저장: data URL(base64) → data/uploads/<랜덤>.jpg
function savePhotos(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > 10) throw bad('사진은 최대 10장까지 올릴 수 있습니다.');
  return list.map((d) => {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(d));
    if (!m) throw bad('사진 형식이 올바르지 않습니다. (jpg/png/webp)');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw bad('사진 한 장은 8MB 이하여야 합니다.');
    const file = crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    return file;
  });
}
function removePhotos(files) {
  for (const f of files || []) { if (/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(f)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true }); }
}

// ───────────────────────── 인증 ─────────────────────────
const loginFails = new Map(); // 이름 → {n, until}
function parseCookies(req) {
  const out = {}; for (const part of (req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } return out;
}
function currentUser(req) {
  const token = parseCookies(req).sid; if (!token) return null;
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(token, Date.now());
  return row || null;
}
function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

// ───────────────────────── 라우터 ─────────────────────────
const routes = [];
function route(method, pattern, handler, { auth = true } = {}) {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
}

// 인증
route('POST', '/api/auth/register', ({ body, req, res }) => {
  const name = reqStr(body.name, '이름', 30);
  const password = String(body.password || '');
  if (password.length < 4) throw bad('비밀번호는 4자 이상이어야 합니다.');
  if (str(body.invite, 100) !== getSetting('invite_code')) throw bad('초대코드가 올바르지 않습니다.');
  if (db.prepare('SELECT 1 FROM users WHERE name=?').get(name)) throw bad('이미 가입된 이름입니다. 로그인하세요.');
  const first = db.prepare('SELECT COUNT(*) c FROM users').get().c === 0; // 첫 가입자 = 관리자
  const salt = crypto.randomBytes(16).toString('hex');
  const r = db.prepare('INSERT INTO users(name,pw_salt,pw_hash,is_admin) VALUES(?,?,?,?)').run(name, salt, hashPw(password, salt), first ? 1 : 0);
  startSession(req, res, Number(r.lastInsertRowid));
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid)) };
}, { auth: false });

route('POST', '/api/auth/login', ({ body, req, res }) => {
  const name = reqStr(body.name, '이름', 30);
  const f = loginFails.get(name);
  if (f && f.until > Date.now()) throw new HttpError(429, '로그인 시도가 많습니다. 1분 후 다시 시도하세요.');
  const u = db.prepare('SELECT * FROM users WHERE name=?').get(name);
  if (!u || !pwMatches(u, body.password || '')) {
    const n = (f && f.until > Date.now() - 60000 ? f.n : 0) + 1;
    loginFails.set(name, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
    throw new HttpError(401, '이름 또는 비밀번호가 올바르지 않습니다.');
  }
  loginFails.delete(name);
  startSession(req, res, u.id);
  return { user: publicUser(u) };
}, { auth: false });

route('POST', '/api/auth/logout', ({ req, res }) => {
  const t = parseCookies(req).sid; if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  return { ok: true };
}, { auth: false });

route('GET', '/api/me', ({ req }) => { const u = currentUser(req); return { user: u ? publicUser(u) : null }; }, { auth: false });

route('PUT', '/api/me/password', ({ user, body }) => {
  if (!pwMatches(user, body.current || '')) throw bad('현재 비밀번호가 올바르지 않습니다.');
  if (String(body.password || '').length < 4) throw bad('새 비밀번호는 4자 이상이어야 합니다.');
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').run(salt, hashPw(body.password, salt), user.id);
  return { ok: true };
});

// 관리자
route('GET', '/api/admin/settings', ({ user }) => { requireAdmin(user); return { invite_code: getSetting('invite_code') }; });
route('PUT', '/api/admin/invite', ({ user, body }) => {
  requireAdmin(user);
  const code = reqStr(body.invite_code, '초대코드', 100);
  if (code.length < 4) throw bad('초대코드는 4자 이상으로 정하세요.');
  setSetting('invite_code', code); return { invite_code: code };
});
route('GET', '/api/admin/users', ({ user }) => { requireAdmin(user); return db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser); });
route('PUT', '/api/admin/users/:id', ({ user, params, body }) => {
  requireAdmin(user);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(params.id); if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  if (body.roles !== undefined) {
    const roles = (Array.isArray(body.roles) ? body.roles : []).filter((r) => ROLES.includes(r));
    db.prepare('UPDATE users SET roles=? WHERE id=?').run(roles.join(','), target.id);
  }
  if (body.is_admin !== undefined) {
    if (target.id === user.id && !body.is_admin) throw bad('자기 자신의 관리자 권한은 해제할 수 없습니다.');
    db.prepare('UPDATE users SET is_admin=? WHERE id=?').run(body.is_admin ? 1 : 0, target.id);
  }
  if (body.password) {
    if (String(body.password).length < 4) throw bad('비밀번호는 4자 이상이어야 합니다.');
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').run(salt, hashPw(body.password, salt), target.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  }
  return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(target.id));
});
route('DELETE', '/api/admin/users/:id', ({ user, params }) => {
  requireAdmin(user);
  if (Number(params.id) === user.id) throw bad('자기 자신은 삭제할 수 없습니다.');
  db.prepare('DELETE FROM users WHERE id=?').run(params.id); return { ok: true };
});

// ── 구매: 발주목록 ──
function poFields(b) {
  return [reqStr(b.req_no, '구매의뢰번호', 50), reqStr(b.vendor, '거래처', 100), reqStr(b.item, '품목명', 200), num(b.qty, '수량'), dateStr(b.due_date, '납기일'), str(b.note, 500)];
}
route('GET', '/api/po', ({ query }) => {
  const where = []; const args = [];
  if (query.q) { where.push('(req_no LIKE ? OR vendor LIKE ? OR item LIKE ?)'); const q = `%${query.q}%`; args.push(q, q, q); }
  if (query.recv === 'none') where.push("recv_status=''");
  else if (query.recv) { where.push('recv_status=?'); args.push(query.recv); }
  return db.prepare(`SELECT * FROM purchase_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (recv_status='ok'), due_date, id DESC`).all(...args);
});
route('POST', '/api/po', ({ user, body }) => {
  const r = db.prepare('INSERT INTO purchase_orders(req_no,vendor,item,qty,due_date,note,created_by) VALUES(?,?,?,?,?,?,?)').run(...poFields(body), user.name);
  return db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(r.lastInsertRowid);
});
route('PUT', '/api/po/:id', ({ user, params, body }) => {
  const row = mustGet('purchase_orders', params.id); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 수정할 수 있습니다.');
  db.prepare('UPDATE purchase_orders SET req_no=?,vendor=?,item=?,qty=?,due_date=?,note=? WHERE id=?').run(...poFields(body), row.id);
  return mustGet('purchase_orders', row.id);
});
route('DELETE', '/api/po/:id', ({ user, params }) => {
  const row = mustGet('purchase_orders', params.id); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 삭제할 수 있습니다.');
  db.prepare('DELETE FROM purchase_orders WHERE id=?').run(row.id); return { ok: true };
});
// ── 물류: 발주입고 확인 (ok=초록, mismatch=빨강, checking=노랑, ''=미입고) ──
route('POST', '/api/po/receive', ({ user, body }) => {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('입고 처리할 항목을 체크하세요.');
  const status = String(body.status || '');
  if (!['ok', 'mismatch', 'checking', ''].includes(status)) throw bad('상태 값이 올바르지 않습니다.');
  const recvQty = status === 'mismatch' ? num(body.recv_qty, '실입고 수량') : null;
  if (status === 'mismatch' && ids.length !== 1) throw bad('수량상이는 한 항목씩 실입고 수량을 입력하세요.');
  const st = db.prepare('UPDATE purchase_orders SET recv_status=?, recv_qty=?, recv_note=?, recv_by=?, recv_at=? WHERE id=?');
  for (const id of ids) {
    const row = mustGet('purchase_orders', id);
    st.run(status, status === 'ok' ? row.qty : recvQty, str(body.note, 500), status ? user.name : null, status ? now() : null, id);
  }
  return { ok: true };
});

// ── 구매: 세탁관리 ──
route('GET', '/api/laundry', ({ query }) => {
  const args = []; let where = '';
  if (query.from) { where += ' AND in_date>=?'; args.push(query.from); }
  if (query.to) { where += ' AND in_date<=?'; args.push(query.to); }
  return db.prepare(`SELECT * FROM laundry WHERE 1=1 ${where} ORDER BY in_date DESC, id DESC`).all(...args).map((r) => ({ ...r, photos: JSON.parse(r.photos) }));
});
route('POST', '/api/laundry', ({ user, body }) => {
  const in_date = dateStr(body.in_date, '입고일'); const discard = num(body.discard_qty, '폐기수량'); const inQty = num(body.in_qty, '입고수량', { required: false });
  const photos = savePhotos(body.photos);
  const r = db.prepare('INSERT INTO laundry(in_date,in_qty,discard_qty,note,photos,created_by) VALUES(?,?,?,?,?,?)').run(in_date, inQty, discard, str(body.note, 500), JSON.stringify(photos), user.name);
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/laundry/:id', ({ user, params, body }) => {
  const row = mustGet('laundry', params.id); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 수정할 수 있습니다.');
  const keep = JSON.parse(row.photos).filter((f) => (body.keep_photos || []).includes(f));
  removePhotos(JSON.parse(row.photos).filter((f) => !keep.includes(f)));
  const photos = keep.concat(savePhotos(body.photos));
  db.prepare('UPDATE laundry SET in_date=?,in_qty=?,discard_qty=?,note=?,photos=? WHERE id=?').run(dateStr(body.in_date, '입고일'), num(body.in_qty, '입고수량', { required: false }), num(body.discard_qty, '폐기수량'), str(body.note, 500), JSON.stringify(photos), row.id);
  return { ok: true };
});
route('DELETE', '/api/laundry/:id', ({ user, params }) => {
  const row = mustGet('laundry', params.id); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 삭제할 수 있습니다.');
  removePhotos(JSON.parse(row.photos)); db.prepare('DELETE FROM laundry WHERE id=?').run(row.id); return { ok: true };
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
function getRequest(id) { const r = db.prepare('SELECT * FROM requests WHERE id=?').get(id); if (!r) throw new HttpError(404, '의뢰를 찾을 수 없습니다.'); return r; }
function roleLabel(type) { return { analysis: '품질', development: '연구소', sample: '생산' }[type]; }

route('GET', '/api/requests', ({ query }) => {
  const type = String(query.type || ''); if (!REQUEST_TYPES[type]) throw bad('의뢰 종류가 올바르지 않습니다.');
  const where = ['type=?']; const args = [type];
  if (query.scope === 'intake') where.push("status IN ('pending','rejected')");
  else if (query.scope === 'list') where.push("status IN ('waiting','progress','done')");
  if (query.status) { where.push('status=?'); args.push(query.status); }
  if (query.category) { where.push('category=?'); args.push(query.category); }
  return db.prepare(`SELECT * FROM requests WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'progress' THEN 1 WHEN 'waiting' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END, id DESC`).all(...args).map(decodeRequest);
});
route('POST', '/api/requests', ({ user, body }) => {
  const type = String(body.type || ''); if (!REQUEST_TYPES[type]) throw bad('의뢰 종류가 올바르지 않습니다.');
  const f = requestFields(type, body);
  const r = db.prepare('INSERT INTO requests(type,title,customer,due_date,category,target_price,data,requester_id,requester_name) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(type, f.title, f.customer, f.due_date, f.category, f.target_price, JSON.stringify(f.data), user.id, user.name);
  return decodeRequest(getRequest(r.lastInsertRowid));
});
route('PUT', '/api/requests/:id', ({ user, params, body }) => {
  const r = getRequest(params.id);
  const isMgr = hasRole(user, REQUEST_TYPES[r.type]);
  if (!(isMgr || (r.requester_id === user.id && ['pending', 'rejected'].includes(r.status)))) throw new HttpError(403, '접수대기 중인 본인 의뢰만 수정할 수 있습니다.');
  const f = requestFields(r.type, body);
  const status = r.status === 'rejected' && !isMgr ? 'pending' : r.status; // 반려건 수정 시 재접수
  db.prepare("UPDATE requests SET title=?,customer=?,due_date=?,category=?,target_price=?,data=?,status=?,updated_at=datetime('now','localtime') WHERE id=?")
    .run(f.title, f.customer, f.due_date, f.category, f.target_price, JSON.stringify(f.data), status, r.id);
  return decodeRequest(getRequest(r.id));
});
route('POST', '/api/requests/:id/approve', ({ user, params }) => {
  const r = getRequest(params.id); requireRole(user, REQUEST_TYPES[r.type], roleLabel(r.type));
  if (!['pending', 'rejected'].includes(r.status)) throw bad('이미 승인된 의뢰입니다.');
  const ymd = today().slice(2).replace(/-/g, ''); const prefix = `${REQUEST_PREFIX[r.type]}-${ymd}-`;
  const n = db.prepare('SELECT COUNT(*) c FROM requests WHERE req_no LIKE ?').get(prefix + '%').c + 1;
  db.prepare("UPDATE requests SET status='waiting', req_no=?, approver_name=?, approved_at=?, reject_reason='', updated_at=datetime('now','localtime') WHERE id=?")
    .run(prefix + String(n).padStart(2, '0'), user.name, now(), r.id);
  return decodeRequest(getRequest(r.id));
});
route('POST', '/api/requests/:id/reject', ({ user, params, body }) => {
  const r = getRequest(params.id); requireRole(user, REQUEST_TYPES[r.type], roleLabel(r.type));
  if (r.status !== 'pending') throw bad('접수대기 중인 의뢰만 반려할 수 있습니다.');
  db.prepare("UPDATE requests SET status='rejected', reject_reason=?, approver_name=?, updated_at=datetime('now','localtime') WHERE id=?").run(reqStr(body.reason, '반려 사유', 500), user.name, r.id);
  return decodeRequest(getRequest(r.id));
});
route('POST', '/api/requests/:id/status', ({ user, params, body }) => {
  const r = getRequest(params.id); requireRole(user, REQUEST_TYPES[r.type], roleLabel(r.type));
  if (!WORK_STATUSES.includes(r.status)) throw bad('승인된 의뢰만 진행상태를 바꿀 수 있습니다.');
  const status = String(body.status); if (!WORK_STATUSES.includes(status)) throw bad('상태 값이 올바르지 않습니다.');
  db.prepare("UPDATE requests SET status=?, result_note=?, updated_at=datetime('now','localtime') WHERE id=?").run(status, body.result_note !== undefined ? str(body.result_note, 1000) : r.result_note, r.id);
  return decodeRequest(getRequest(r.id));
});
route('DELETE', '/api/requests/:id', ({ user, params }) => {
  const r = getRequest(params.id);
  const own = r.requester_id === user.id && ['pending', 'rejected'].includes(r.status);
  if (!(own || user.is_admin || hasRole(user, REQUEST_TYPES[r.type]))) throw new HttpError(403, '삭제 권한이 없습니다.');
  db.prepare('DELETE FROM requests WHERE id=?').run(r.id); return { ok: true };
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
route('GET', '/api/schedules', ({ query }) => {
  const kind = String(query.kind || 'finished');
  const from = dateStr(query.from, 'from'); const to = dateStr(query.to, 'to');
  // 기간과 겹치는 일정: 일간(그날), 주간(월~일), 월간(그 달)
  return db.prepare(`SELECT * FROM schedules WHERE kind=$kind AND (
      (period='day' AND start_date BETWEEN $from AND $to) OR
      (period='week' AND start_date<=$to AND date(start_date,'+6 days')>=$from) OR
      (period='month' AND start_date<=$to AND date(start_date,'+1 month','-1 day')>=$from)
    ) ORDER BY start_date, period, id`).all({ $kind: kind, $from: from, $to: to });
});
route('POST', '/api/schedules', ({ user, body }) => {
  const f = schedFields(body);
  const r = db.prepare('INSERT INTO schedules(kind,period,start_date,product,qty,note,created_by) VALUES(?,?,?,?,?,?,?)').run(f.kind, f.period, f.start_date, f.product, f.qty, f.note, user.name);
  return mustGet('schedules', r.lastInsertRowid);
});
route('PUT', '/api/schedules/:id', ({ user, params, body }) => {
  const row = mustGet('schedules', params.id); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 수정할 수 있습니다.');
  if (body.toggle_done) { db.prepare('UPDATE schedules SET done=1-done WHERE id=?').run(row.id); return mustGet('schedules', row.id); }
  const f = schedFields({ ...body, kind: row.kind });
  db.prepare('UPDATE schedules SET period=?,start_date=?,product=?,qty=?,note=? WHERE id=?').run(f.period, f.start_date, f.product, f.qty, f.note, row.id);
  return mustGet('schedules', row.id);
});
route('DELETE', '/api/schedules/:id', ({ user, params }) => {
  const row = mustGet('schedules', params.id); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 삭제할 수 있습니다.');
  db.prepare('DELETE FROM schedules WHERE id=?').run(row.id); return { ok: true };
});

// ── 물류: 출하목록 ──
function shipFields(b) { return [dateStr(b.ship_date, '출고일'), reqStr(b.item, '품목명', 200), num(b.qty, '수량'), reqStr(b.customer, '거래처', 100), str(b.note, 500)]; }
route('GET', '/api/shipments', ({ query }) => {
  const from = query.from || today(); const to = query.to || from;
  return db.prepare('SELECT * FROM shipments WHERE ship_date BETWEEN ? AND ? ORDER BY ship_date DESC, id DESC').all(from, to);
});
route('POST', '/api/shipments', ({ user, body }) => {
  const r = db.prepare('INSERT INTO shipments(ship_date,item,qty,customer,note,created_by) VALUES(?,?,?,?,?,?)').run(...shipFields(body), user.name);
  return mustGet('shipments', r.lastInsertRowid);
});
route('PUT', '/api/shipments/:id', ({ user, params, body }) => {
  const row = mustGet('shipments', params.id); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 수정할 수 있습니다.');
  db.prepare('UPDATE shipments SET ship_date=?,item=?,qty=?,customer=?,note=? WHERE id=?').run(...shipFields(body), row.id); return mustGet('shipments', row.id);
});
route('DELETE', '/api/shipments/:id', ({ user, params }) => {
  const row = mustGet('shipments', params.id); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 삭제할 수 있습니다.');
  db.prepare('DELETE FROM shipments WHERE id=?').run(row.id); return { ok: true };
});

// ── 대시보드 ──
route('GET', '/api/dashboard', () => {
  const c = (sql, ...a) => db.prepare(sql).get(...a).c;
  const reqCounts = {};
  for (const t of Object.keys(REQUEST_TYPES)) {
    reqCounts[t] = { pending: c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='pending'", t), waiting: c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='waiting'", t), progress: c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='progress'", t), done: c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='done'", t) };
  }
  const t = today();
  return {
    today: t,
    po: { total: c('SELECT COUNT(*) c FROM purchase_orders'), none: c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status=''"), ok: c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='ok'"), mismatch: c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='mismatch'"), checking: c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='checking'"), overdue: c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status<>'ok' AND due_date<?", t) },
    requests: reqCounts,
    shipmentsToday: c('SELECT COUNT(*) c FROM shipments WHERE ship_date=?', t),
    laundryMonth: db.prepare("SELECT COALESCE(SUM(discard_qty),0) c FROM laundry WHERE substr(in_date,1,7)=?").get(t.slice(0, 7)).c,
    schedulesToday: c("SELECT COUNT(*) c FROM schedules WHERE period='day' AND start_date=?", t),
  };
});

function mustGet(table, id) { const r = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id); if (!r) throw new HttpError(404, '항목을 찾을 수 없습니다.'); return r; }

// ───────────────────────── HTTP 서버 ─────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };

function send(res, status, obj) { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, '요청이 너무 큽니다. (사진 용량 확인)')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('잘못된 요청 형식입니다.')); } });
    req.on('error', reject);
  });
}
function serveFile(res, file, extraHeaders = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, ...extraHeaders });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (p.startsWith('/api/')) {
      // 단순 CSRF 방지: 상태 변경 요청은 JSON + 같은 출처만
      if (req.method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json') && req.headers['content-length'] && req.headers['content-length'] !== '0') throw bad('JSON 요청만 허용됩니다.');
      const r = routes.find((x) => x.method === req.method && x.re.test(p));
      if (!r) throw new HttpError(404, 'API를 찾을 수 없습니다.');
      const m = r.re.exec(p); const params = {}; r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
      const user = currentUser(req);
      if (r.auth && !user) throw new HttpError(401, '로그인이 필요합니다.');
      const body = req.method === 'GET' ? {} : await readBody(req);
      const result = await r.handler({ req, res, user, params, body, query: Object.fromEntries(url.searchParams) });
      return send(res, 200, result);
    }
    if (p.startsWith('/uploads/')) {
      if (!currentUser(req)) { res.writeHead(401); return res.end('로그인이 필요합니다.'); }
      const f = path.basename(p); if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(f)) { res.writeHead(404); return res.end(); }
      return serveFile(res, path.join(UPLOAD_DIR, f), { 'Cache-Control': 'private, max-age=86400' });
    }
    const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file, { 'Cache-Control': 'no-cache' });
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), { 'Cache-Control': 'no-cache' });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : '서버 오류가 발생했습니다.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`업무프로세스 웹앱: http://localhost:${PORT}  (데이터: ${DATA_DIR})`));
}
module.exports = { server, db };
