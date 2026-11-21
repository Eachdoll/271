// Cloudflare Worker: request-scoped D1/R2 bindings; no third-party runtime packages.
import { database } from './storage.mjs';
import { buildReport } from './reports.mjs';
import { createImageStorage } from './image-storage.mjs';
const SESSION_DAYS = 30;
const MAX_BODY = 30 * 1024 * 1024;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));

export function createApp(env) {
const db = database(env.DB);
const images = createImageStorage(env);
async function getSetting(k) { const r = (await db.prepare('SELECT value FROM settings WHERE key=?').get(k)); return r ? r.value : (k === 'invite_code' ? env.INVITE_CODE || null : null); }
async function setSetting(k, v) { (await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v))); }

// ───────────────────────── 공통 ─────────────────────────
const ROLES = ['operator', 'purchase', 'quality', 'quality_approver', 'dev', 'dev_approver', 'production', 'production_approver', 'logistics', 'logistics_approver', 'sales'];
const REQUEST_TYPES = { voc: 'quality', analysis: 'quality', development: 'dev', sample: 'production', sample_goods: 'purchase', rnd_analysis: 'dev' }; // 15.285 rnd_analysis: 연구팀 분석의뢰
const REQUEST_PREFIX = { voc: 'V', analysis: 'Q', development: 'D', sample: 'S', sample_goods: 'G', rnd_analysis: 'RA' };
const RND_CATEGORIES = ['의뢰분석', '시제품분석', '원료분석', '경쟁사분석', '기타']; // 15.285
const analysisLike = t => t === 'analysis' || t === 'rnd_analysis';
const ANALYSIS_CATEGORIES = ['수입검사', '의뢰검사', '출하검사', '공정검사'];
const WORK_STATUSES = ['waiting', 'progress', 'done'];
const STATUS_LABEL = { waiting: '대기', progress: '진행', done: '완료' }; // 15.286
// 15.87 임가공: 외주 가공(세탁·커팅 등) 품목. 발주로만 받고(기타입고 불가) 세부 분류는 쓰지 않는다(item_category_nodes CHECK).
const ITEM_CATEGORIES = ['원자재', '부자재', '반제품', '제품', '상품', '임가공'];
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
// D1은 쿼리 하나에 바인딩 매개변수를 100개까지만 받는다. IN (?, …) 목록은 다른 조건 매개변수 몫을 남기고 90개씩 나눠 읽는다.
function inChunks(ids, size = 90) {
  const parts = [];
  for (let i = 0; i < ids.length; i += size) parts.push(ids.slice(i, i + size));
  return parts;
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
function publicUser(u) { return { id: u.id, name: u.name, position: u.position || '', department: u.department || '', is_admin: !!u.is_admin, roles: u.roles ? u.roles.split(',').filter(Boolean) : [], created_at: u.created_at, approval_status: u.approval_status, approval_note: u.approval_note, reviewed_by: u.reviewed_by, reviewed_at: u.reviewed_at, menu_mode: u.menu_mode || 'department', menu_custom: menuList(u.menus) }; }
// ── 메뉴 열람 권한(15.59) ── 업무 묶음 단위로 화면 메뉴를 숨기고 막는다(데이터 API는 그대로). 홈·리포트·내 정보는 항상 보인다.
const MENU_GROUPS = ['sales', 'purchase', 'quality', 'dev', 'production', 'logistics', 'master'];
// 저장 형식: '' = 제한 없음, 'home' = 홈만, 'home,sales,…' = 홈 + 고른 묶음.
function menuList(text) { return text ? String(text).split(',').filter(k => MENU_GROUPS.includes(k)) : null; }
function menuText(list, label) {
  if (list === null) return '';
  if (!Array.isArray(list) || list.some(k => !MENU_GROUPS.includes(k))) throw bad(`${label}의 메뉴 목록을 확인하세요.`);
  return ['home', ...MENU_GROUPS.filter(k => list.includes(k))].join(',');
}
// 실제로 보이는 메뉴: null이면 전체. 관리자·전체 보기는 null, 직접 지정은 그 목록,
// 부서 기본은 그 부서(비어 있으면 상위 부서로 올라가며) 설정, 끝까지 없으면 전체.
// 역할(구매·품질·개발·생산·물류와 그 책임자)을 받은 업무는 메뉴 제한과 관계없이 보인다(승인·접수 화면이 그 묶음에 있으므로).
const ROLE_MENU = { purchase: 'purchase', quality: 'quality', quality_approver: 'quality', dev: 'dev', dev_approver: 'dev', production: 'production', production_approver: 'production', logistics: 'logistics', logistics_approver: 'logistics' };
async function effectiveMenus(u, departments = null) {
  const list = await baseMenus(u, departments); if (!list) return null;
  const fromRoles = publicUser(u).roles.map(r => ROLE_MENU[r]).filter(Boolean);
  return MENU_GROUPS.filter(k => list.includes(k) || fromRoles.includes(k));
}
// 15.175 메뉴 설정만으로 정해지는 목록(사용 권한으로 더해지는 묶음 제외). null = 전체.
async function baseMenus(u, departments = null) { // 15.179 departments를 넘기면 부서 표를 다시 읽지 않는다(회원 목록)
  if (!u || u.is_admin || u.menu_mode === 'all') return null;
  let list = null;
  if (u.menu_mode === 'custom') list = menuList(u.menus) || [];
  else if (u.department) {
    departments ||= await db.prepare('SELECT id,name,parent_id,menus FROM org_departments').all();
    let d = departments.find(x => x.name === u.department);
    for (let guard = 0; d && guard < 20 && !list; guard++) {
      if (d.menus) list = menuList(d.menus);
      d = d.parent_id ? departments.find(x => x.id === d.parent_id) : null;
    }
  }
  return list || null;
}
// 사람별 화면 설정(15.62): 자주 쓰는 화면(★)과 목록 조건(상태·구분 같은 선택값). settings 표의 'prefs:<id>' 한 줄에 둔다(마이그레이션 없음).
const SKINS_ALLOWED = ['default', 'christmas', 'ribbon', 'cat', 'penguin', 'kha', 'pjh']; // 15.220 디자인 스킨(15.222 핑크 리본, 15.226 커스텀 캐릭터(cat)·방귀니(penguin))
async function userPrefs(id) {
  const row = await db.prepare('SELECT value FROM settings WHERE key=?').get('prefs:' + id);
  try { const v = row ? JSON.parse(row.value) : {}; return { favorites: Array.isArray(v.favorites) ? v.favorites : [], filters: v.filters && typeof v.filters === 'object' ? v.filters : {}, ...(SKINS_ALLOWED.includes(v.skin) ? { skin: v.skin } : {}), ...(v.grids && typeof v.grids === 'object' && !Array.isArray(v.grids) ? { grids: v.grids } : {}), ...(v.dash && typeof v.dash === 'object' && !Array.isArray(v.dash) ? { dash: v.dash } : {}), ...(v.report && typeof v.report === 'object' && !Array.isArray(v.report) ? { report: v.report } : {}) }; } /* 15.310 dash·report(대시보드·리포트 표시 설정) */ catch { return { favorites: [], filters: {} }; } // 15.220 skin · 15.239 grids(표 열 순서·너비·숨김)
}
function cleanPrefs(body, prior) {
  const out = { ...prior };
  if (body.favorites !== undefined) {
    if (!Array.isArray(body.favorites) || body.favorites.length > 20) throw bad('자주 쓰는 화면은 20개까지 둘 수 있습니다.');
    out.favorites = body.favorites.map(f => {
      const href = String(f?.href || ''), label = str(f?.label, 40);
      if (!/^#\/[a-z0-9/_-]*$/.test(href) || href.length > 60 || !label) throw bad('자주 쓰는 화면 정보를 확인하세요.');
      return { href, label };
    });
  }
  if (body.filters !== undefined) {
    if (!body.filters || typeof body.filters !== 'object' || Array.isArray(body.filters)) throw bad('목록 조건 형식을 확인하세요.');
    const filters = { ...prior.filters };
    for (const [key, value] of Object.entries(body.filters)) {
      if (key.length > 80) throw bad('목록 조건 이름이 너무 깁니다.');
      if (value === null) { delete filters[key]; continue; }
      if (!Array.isArray(value) || value.length > 30 || value.some(pair => !Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || pair[0].length > 40 || !(typeof pair[1] === 'string' || typeof pair[1] === 'boolean') || String(pair[1]).length > 100)) throw bad('목록 조건 형식을 확인하세요.');
      filters[key] = value;
    }
    if (Object.keys(filters).length > 80) throw bad('목록 조건이 너무 많습니다.');
    out.filters = filters;
  }
  if (body.grids !== undefined) { // 15.239 표 열 배치(순서·너비·숨김)를 계정에: 다른 기기·브라우저에서도 같은 순서
    if (!body.grids || typeof body.grids !== 'object' || Array.isArray(body.grids)) throw bad('표 열 설정 형식을 확인하세요.');
    const grids = { ...(prior.grids || {}) };
    for (const [key, value] of Object.entries(body.grids)) {
      if (key.length > 300) throw bad('표 열 설정 이름이 너무 깁니다.');
      if (value === null) { delete grids[key]; continue; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('표 열 설정 형식을 확인하세요.');
      const clean = {};
      if (Array.isArray(value.order)) clean.order = value.order.slice(0, 40).map(x => String(x).slice(0, 40));
      if (Array.isArray(value.hidden)) clean.hidden = value.hidden.slice(0, 40).map(x => String(x).slice(0, 40));
      if (value.widths && typeof value.widths === 'object' && !Array.isArray(value.widths)) clean.widths = Object.fromEntries(Object.entries(value.widths).slice(0, 40).map(([k, w]) => [String(k).slice(0, 40), Math.max(30, Math.min(1200, Number(w) || 0))]));
      if (Object.keys(clean).length) grids[key] = clean; else delete grids[key];
    }
    if (Object.keys(grids).length > 120) throw bad('표 열 설정이 너무 많습니다. 쓰지 않는 표의 「열 배치 초기화」를 해 주세요.');
    out.grids = grids;
  }
  // 15.310 대시보드·리포트 표시 설정: 숨긴 위젯(hidden)·순서(order)·기본 조건. 위젯 이름은 영문·숫자·한글·몇 가지 기호 60자까지, 각 40개까지.
  const widgetList = (v, label) => { if (v === undefined) return undefined; if (!Array.isArray(v) || v.length > 40) throw bad(`${label} 설정을 확인하세요.`); return [...new Set(v.map(x => String(x).slice(0, 60)).filter(x => /^[\w가-힣·:.()%/,+&→\- ]+$/.test(x)))]; };
  for (const key of ['dash', 'report']) {
    if (body[key] === undefined) continue;
    if (body[key] === null) { delete out[key]; continue; }
    if (!body[key] || typeof body[key] !== 'object' || Array.isArray(body[key])) throw bad('표시 설정 형식을 확인하세요.');
    const prev = out[key] || {}, next = { ...prev }, b = body[key];
    const hidden = widgetList(b.hidden, '숨긴 항목'), order = widgetList(b.order, '순서');
    if (hidden !== undefined) { if (hidden.length) next.hidden = hidden; else delete next.hidden; }
    if (order !== undefined) { if (order.length) next.order = order; else delete next.order; }
    if (key === 'report') {
      if (b.grain !== undefined) { if (b.grain && !['day', 'week', 'month'].includes(b.grain)) throw bad('집계 단위를 확인하세요.'); if (b.grain) next.grain = b.grain; else delete next.grain; }
      if (b.period !== undefined) { if (b.period && !['14d', 'week', 'month', 'year', '12m'].includes(b.period)) throw bad('기본 기간을 확인하세요.'); if (b.period) next.period = b.period; else delete next.period; }
      if (b.dept !== undefined) { if (b.dept && !SECTIONS.includes(b.dept)) throw bad('기본 부서를 확인하세요.'); if (b.dept) next.dept = b.dept; else delete next.dept; }
      if (b.unit !== undefined) { const u = str(b.unit, 20); if (u) next.unit = u; else delete next.unit; }
    }
    if (Object.keys(next).length) out[key] = next; else delete out[key];
  }
  if (JSON.stringify(out).length > 60000) throw bad('저장할 화면 설정이 너무 큽니다.');
  if (body.skin !== undefined) { // 15.220 디자인 스킨(사용자별)
    const skin = String(body.skin || 'default');
    if (!SKINS_ALLOWED.includes(skin)) throw bad('디자인 스킨을 확인하세요.');
    out.skin = skin;
  }
  return out;
}
async function meUser(u) { return { ...publicUser(u), menus: await effectiveMenus(u), ui: await userPrefs(u.id) }; }
function hasRole(user, role) { const roles = publicUser(user).roles; return !!user.is_admin || roles.includes(role) || (['quality','dev','production','logistics'].includes(role) && roles.includes(role + '_approver')); }
function isOperator(user) { return !!user && !user.is_admin && publicUser(user).roles.includes('operator'); }
function operatorRequestAllowed(method, path) {
  if (method === 'GET' && (/^\/api\/requests\/[1-9]\d*\/inspection(?:\/history\/[1-9]\d*)?$/.test(path) || ['/api/inspections','/api/wash-summary'].includes(path))) return true;
  if (method === 'GET') return ['/api/me', '/api/operator/catalog', '/api/operator/semi-records', '/api/operator/plans', '/api/operator/actuals', '/api/lots/available', '/api/semi-bags', '/api/actuals/progress'].includes(path); // 15.249 오퍼레이터도 투입 LOT·봉투 LOT 고르기
  return (method === 'PUT' && path === '/api/me/password') || (method === 'POST' && (['/api/auth/logout', '/api/auth/login', '/api/semi-batches'].includes(path) || /^\/api\/schedules\/[1-9]\d*\/actuals$/.test(path) || /^\/api\/(?:operator\/semi-records|actuals)\/[1-9]\d*\/complete$/.test(path)));
}
function isRequestApprover(user, type) {
  return hasRole(user, { voc: 'quality_approver', analysis: 'quality_approver', development: 'dev_approver', sample: 'production', sample_goods: 'purchase', rnd_analysis: 'dev_approver' }[type]);
}
function requireRequestApprover(user, type) {
  const label = { voc: '품질팀장(품질책임자)', analysis: '품질책임자', development: '개발책임자', sample: '생산담당자', sample_goods: '구매담당자', rnd_analysis: '연구책임자(개발책임자)' }[type];
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
    const decodedSize = Math.floor(m[2].length * 3 / 4) - (m[2].endsWith('==') ? 2 : m[2].endsWith('=') ? 1 : 0);
    if (decodedSize > 8 * 1024 * 1024) throw bad('사진 한 장은 8MB 이하여야 합니다.');
    let bytes; try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); } catch { throw bad('사진 형식이 올바르지 않습니다.'); }
    if (bytes.length > 8 * 1024 * 1024) throw bad('사진 한 장은 8MB 이하여야 합니다.');
    return { file: randomHex(12) + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]), bytes, type: 'image/' + m[1] };
  });
  const saved = [];
  try {
    for (const p of photos) { await images.put(p.file, p.bytes, { httpMetadata: { contentType: p.type } }); saved.push(p.file); }
    return saved;
  } catch (error) { await removePhotos(saved); throw error; }
}
async function removePhotos(files) {
  for (const f of files || []) if (/^[a-f0-9]{24}\.(jpg|png|webp|pdf)$/.test(f)) await images.delete(f); // 15.306 문서 PDF도
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
  if (type === 'request' && !['development','sample','sample_goods','voc','rnd_analysis'].includes(row.type)) throw bad('개발·샘플·연구 분석 의뢰서와 VOC에 사진을 첨부할 수 있습니다.'); // 15.287 연구 분석 데이터에도 첨부
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
async function deleteEntityWithAttachments(type, table, id, extra = []) {
  const record = await db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=?').get(type, id);
  const preserve = ['purchase_order','other_receipt'].includes(type) && await db.prepare('SELECT 1 FROM requests WHERE source_type=? AND source_id=?').get(type, id);
  const queries = [...extra, { sql: `DELETE FROM ${table} WHERE id=?`, args: [id] }];
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

// 15.104 댓글 삭제: 작성자는 10분 안에만, 관리자는 언제나. 줄은 남기고 내용을 「(삭제됨)」으로 바꿔 이력 순서가 끊기지 않게 한다.
route('DELETE', '/api/comments/:entity/:id/:commentId', async ({ user, params }) => {
  await commentEntity(user, params.entity, params.id);
  const row = await db.prepare('SELECT * FROM progress_comments WHERE id=? AND entity_type=? AND entity_id=?').get(Number(params.commentId), params.entity, Number(params.id));
  if (!row) throw new HttpError(404, '코멘트를 찾을 수 없습니다.');
  if (row.content === '(삭제됨)') throw bad('이미 지운 코멘트입니다.');
  const mine = row.author_id === user.id;
  if (!user.is_admin && !mine) throw new HttpError(403, '내가 쓴 코멘트만 지울 수 있습니다.');
  if (!user.is_admin && Date.parse(now().replace(' ', 'T') + '+09:00') - Date.parse(String(row.created_at).replace(' ', 'T') + '+09:00') > 10 * 60 * 1000) throw new HttpError(409, '쓴 지 10분이 지난 코멘트는 지울 수 없습니다. 바로잡을 내용은 새 코멘트로 남기세요.');
  await db.prepare("UPDATE progress_comments SET content='(삭제됨)' WHERE id=?").run(row.id);
  return { ok: true };
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
  // 조직 구성에 부서·직급 목록이 있으면 가입 때 골라야 한다(첫 관리자 가입처럼 목록이 비어 있으면 생략).
  const org = await orgChoice(body, { required: true });
  const salt = randomHex(16);
  const r = await db.prepare("INSERT INTO users(name,pw_salt,pw_hash,is_admin,approval_status,department,position) SELECT ?,?,?,NOT EXISTS(SELECT 1 FROM users),CASE WHEN EXISTS(SELECT 1 FROM users) THEN 'pending' ELSE 'approved' END,?,?").run(name, salt, await hashPw(password, salt), org.department, org.position);
  const account = await db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
  if (account.approval_status !== 'approved') return { user: null, pending: true, account: { id: account.id, name: account.name, approval_status: account.approval_status } };
  await startSession(req, res, account.id);
  return { user: await meUser(account) };
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
  return { user: await meUser(u) };
}, { auth: false });

route('POST', '/api/auth/logout', async ({ req, res }) => {
  const t = sessionToken(req); if (t) (await db.prepare('DELETE FROM sessions WHERE token=?').run(t));
  res.append('Set-Cookie', `wpa_sid=; HttpOnly; Path=/; Max-Age=0; ${sessionCookiePolicy(req)}`);
  res.append('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  return { ok: true };
}, { auth: false });

route('GET', '/api/me', async ({ req }) => { const u = (await currentUser(req)); return { user: u ? await meUser(u) : null }; }, { auth: false });

route('PUT', '/api/me/prefs', async ({ user, body }) => {
  const prefs = cleanPrefs(body || {}, await userPrefs(user.id));
  await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('prefs:' + user.id, JSON.stringify(prefs));
  return prefs;
});
route('PUT', '/api/me/password', async ({ user, body }) => {
  if (!(await pwMatches(user, body.current || ''))) throw bad('현재 비밀번호가 올바르지 않습니다.');
  if (String(body.password || '').length < 4) throw bad('새 비밀번호는 4자 이상이어야 합니다.');
  const salt = randomHex(16);
  (await db.prepare('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?').run(salt, (await hashPw(body.password, salt)), user.id));
  return { ok: true };
});

// 관리자
route('GET', '/api/admin/settings', async ({ user }) => { requireAdmin(user); return { invite_code: (await getSetting('invite_code')) }; });
route('GET', '/api/admin/image-storage', async ({ user }) => { requireAdmin(user); return images.status(); });
route('POST', '/api/admin/image-storage/check', async ({ user }) => { requireAdmin(user); return images.check(); });
route('POST', '/api/admin/image-storage/copy', async ({ user, body }) => { requireAdmin(user); return images.copyPage(body.cursor ?? ''); });
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
    rnd_analysis: users.filter(u => (u.roles || '').split(',').includes('dev_approver')).map(u => ({ id: u.id, name: u.name })), // 15.285
  };
});
route('GET', '/api/admin/users', async ({ user }) => { requireAdmin(user); const departments = await db.prepare('SELECT id,name,parent_id,menus FROM org_departments').all(); const out = []; for (const u of await db.prepare('SELECT * FROM users ORDER BY id').all()) out.push({ ...publicUser(u), menus_base: await baseMenus(u, departments), menus_effective: await effectiveMenus(u, departments) }); return out; }); // 15.175 메뉴 보기 표: 설정값·실제 보임
// An administrator can open an account directly; it is approved from the start.
route('POST', '/api/admin/users', async ({ user, body }) => {
  requireAdmin(user);
  const name = reqStr(body.name, '이름', 30), password = String(body.password || '');
  if (password.length < 4) throw bad('비밀번호는 4자 이상이어야 합니다.');
  const roles = Array.isArray(body.roles) ? body.roles : []; if (roles.some(r => !ROLES.includes(r))) throw bad('권한이 올바르지 않습니다.');
  if (await db.prepare('SELECT 1 FROM users WHERE name=?').get(name)) throw bad('이미 있는 이름입니다.');
  const org = await orgChoice(body);
  const salt = randomHex(16);
  const r = await db.prepare("INSERT INTO users(name,pw_salt,pw_hash,is_admin,roles,approval_status,reviewed_by,reviewed_at,department,position) VALUES(?,?,?,0,?,'approved',?,?,?,?)").run(name, salt, await hashPw(password, salt), [...new Set(roles)].join(','), user.name, now(), org.department, org.position);
  return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid));
});
route('POST', '/api/admin/users/:id/approval', async ({ user, params, body }) => {
  requireAdmin(user);
  const target = await db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
  if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  if (!['approved', 'rejected'].includes(body.status)) throw bad('승인 또는 반려를 선택하세요.');
  if (body.status === 'rejected' && (target.id === user.id || target.is_admin)) throw bad('관리자 계정은 반려할 수 없습니다.');
  if (body.status === 'rejected') await assertNoPendingApprovals(target.id, '반려');
  const commands = [{ sql: 'UPDATE users SET approval_status=?,approval_note=?,reviewed_by=?,reviewed_at=? WHERE id=?', args: [body.status, str(body.note, 500), user.name, now(), target.id] }];
  if (body.status === 'rejected') commands.push({ sql: 'DELETE FROM sessions WHERE user_id=?', args: [target.id] });
  await db.batch(commands);
  return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(target.id));
});
route('PUT', '/api/admin/users/:id', async ({ user, params, body }) => {
  requireAdmin(user);
  const target = (await db.prepare('SELECT * FROM users WHERE id=?').get(params.id)); if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  // 먼저 모두 검사하고 마지막에 한 번에 저장한다(일부만 저장된 뒤 400이 나는 일이 없게).
  if (body.is_admin && target.approval_status !== 'approved') throw bad('가입 승인 후 관리자 권한을 부여하세요.');
  if (body.is_admin !== undefined && target.id === user.id && !body.is_admin) throw bad('자기 자신의 관리자 권한은 해제할 수 없습니다.');
  if (body.password && String(body.password).length < 4) throw bad('비밀번호는 4자 이상이어야 합니다.');
  const commands = [];
  if (body.roles !== undefined) {
    const roles = [...new Set((Array.isArray(body.roles) ? body.roles : []).filter((r) => ROLES.includes(r)))];
    if (target.approval_status !== 'approved' && roles.some(r => ['quality_approver','dev_approver','production_approver','logistics_approver'].includes(r))) throw bad('가입 승인 후 책임자로 지정하세요.');
    commands.push({ sql: 'UPDATE users SET roles=? WHERE id=?', args: [roles.join(','), target.id] });
  }
  if (body.position !== undefined || body.department !== undefined) {
    // 바꾸지 않은 값(사용 중지된 부서·직급 포함)은 그대로 둘 수 있다. 새로 고르는 값만 목록에서 검사한다.
    const org = await orgChoice({ department: body.department !== undefined ? body.department : target.department, position: body.position !== undefined ? body.position : target.position }, { keep: target });
    commands.push({ sql: 'UPDATE users SET position=?,department=? WHERE id=?', args: [org.position, org.department, target.id] });
  }
  if (body.is_admin !== undefined) commands.push({ sql: 'UPDATE users SET is_admin=? WHERE id=?', args: [body.is_admin ? 1 : 0, target.id] });
  if (body.menu_mode !== undefined) {
    if (!['department', 'all', 'custom'].includes(body.menu_mode)) throw bad('메뉴 열람 방식을 확인하세요.');
    const menus = body.menu_mode === 'custom' ? menuText(Array.isArray(body.menus) ? body.menus : [], '사용자') : '';
    commands.push({ sql: 'UPDATE users SET menu_mode=?,menus=? WHERE id=?', args: [body.menu_mode, menus, target.id] });
  }
  if (body.password) {
    const salt = randomHex(16);
    commands.push({ sql: 'UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?', args: [salt, await hashPw(body.password, salt), target.id] });
    commands.push({ sql: 'DELETE FROM sessions WHERE user_id=?', args: [target.id] });
  }
  if (commands.length) await db.batch(commands);
  return publicUser((await db.prepare('SELECT * FROM users WHERE id=?').get(target.id)));
});
// 결재 대기 중인 구매의뢰에서 아직 차례가 남은 결재·합의자는 삭제·반려하면 그 의뢰가 영원히 멈춘다.
async function pendingApprovalDocs(userId) {
  return (await db.prepare("SELECT DISTINCT pr.doc_no FROM purchase_requests pr JOIN purchase_request_lines l ON l.request_id=pr.id WHERE pr.status='pending' AND l.user_id=? AND l.kind!='cc' AND l.step>=pr.current_step AND l.decision='' ORDER BY pr.doc_no LIMIT 6").all(userId)).map(r => r.doc_no);
}
async function assertNoPendingApprovals(userId, action) {
  const docs = await pendingApprovalDocs(userId);
  if (docs.length) throw bad(`결재 대기 중인 구매의뢰(${docs.slice(0, 5).join(', ')}${docs.length > 5 ? ' 등' : ''})의 결재선에 있어 ${action}할 수 없습니다. 먼저 이 사람이 결재(승인·반려)하거나 작성자가 의뢰서를 삭제·재상신하게 하세요.`);
}
route('DELETE', '/api/admin/users/:id', async ({ user, params }) => {
  requireAdmin(user);
  if (Number(params.id) === user.id) throw bad('자기 자신은 삭제할 수 없습니다.');
  await assertNoPendingApprovals(Number(params.id), '삭제');
  // 그 사람의 화면 설정(자주 쓰는 화면·목록 조건)도 함께 지운다.
  (await db.prepare('DELETE FROM users WHERE id=?').run(params.id)); await db.prepare('DELETE FROM settings WHERE key=?').run('prefs:' + Number(params.id)); return { ok: true };
});

// Bounded pages keep backups within Worker memory limits. Sessions are omitted.
const backupTables = ['settings', 'users', 'purchase_orders', 'laundry', 'requests', 'schedules', 'shipments', 'other_receipts', 'boms', 'attachments', 'progress_comments', 'item_batches', 'production_actuals', 'production_actual_changes', 'receipt_qty_changes', 'stock_adjustments', 'stock_levels', 'vendors', 'production_units', 'semi_records', 'semi_record_changes', 'laundry_reports', 'laundry_report_lines', 'inspection_specs', 'inspection_spec_keys', 'inspection_measurements', 'inspection_measurement_history', 'item_category_nodes', 'purchase_requests', 'purchase_request_items', 'purchase_request_lines', 'org_departments', 'org_positions', 'production_requests', 'production_request_lines', 'receipts', 'po_receipt_lots', 'warehouses', 'purchase_bills', 'purchase_bill_lines', 'purchase_closings', 'sales_bills', 'sales_bill_lines', 'sales_payments', 'sales_closings', 'tax_invoices', 'tax_invoice_bills', 'sales_orders', 'sales_order_lines', 'ship_instructions', 'purchase_payments', 'item_prices', 'stock_transfers', 'purchase_tax_invoices', 'purchase_tax_invoice_bills', 'ship_batches', 'production_lot_inputs', 'stock_returns', 'stock_return_lines', 'doc_changes', 'quotes', 'quote_lines', 'bill_notes', 'pallets', 'pallet_lines', 'semi_lot_inputs', 'pack_bag_links', 'ip_rights', 'certifications', 'instruments', 'coas', 'nonconformities', 'quality_docs', 'quality_changes', 'trainings', 'training_attendees', 'qualifications', 'supplier_evals', 'supplier_coas', 'equipment', 'equipment_logs', 'process_points', 'process_measures', 'test_methods', 'reliability_tests', 'quality_audits', 'audit_findings', 'validations', 'quality_goals', 'quality_kpi_values', 'quality_risks', 'risk_assessments', 'org_duty_assignments', 'dev_costs', 'cost_rates', 'cost_materials', 'cost_material_prices', 'cost_items', 'cost_item_revs', 'org_charts']; // 15.313 위험성평가 · 15.314 지정 담당자
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
// type(15.58): 'purchase'(발주·기타입고) 또는 'sales'(출하·생산의뢰). 새 거래처는 그 구분으로 등록하고,
// 이미 있는 거래처는 그렇게 쓰였으므로 그 구분을 더한다(15.61: 매출처로 등록된 곳에 발주하면 매입·매출 둘 다). 다른 구분은 지우지 않는다.
// 거래처코드(15.92): 비우면 C0001부터 자동, 직접 넣으면 그 코드(영문·숫자·-·_ 20자).
const VENDOR_AUTO_CODE = "(SELECT 'C' || printf('%04d', COALESCE(MAX(CAST(substr(code,2) AS INTEGER)),0)+1) FROM vendors WHERE code GLOB 'C[0-9]*' AND substr(code,2) NOT GLOB '*[^0-9]*')";
function vendorCode(v) { const c = str(v, 20).toUpperCase(); if (c && !/^[A-Z0-9_-]+$/.test(c)) throw bad('거래처코드는 영문·숫자·-·_로 20자까지 넣으세요.'); return c; }
async function ensureVendor(name, user, type = '') {
  const clean = str(name, 100); if (!clean) return;
  const column = type === 'purchase' ? 'is_purchase' : type === 'sales' ? 'is_sales' : '';
  if (!column) { await db.prepare(`INSERT INTO vendors(name,name_key,created_by,code) VALUES(?,?,?,${VENDOR_AUTO_CODE}) ON CONFLICT(name_key) DO NOTHING`).run(clean, nameKey(clean), user.name); return; }
  await db.prepare(`INSERT INTO vendors(name,name_key,created_by,${column},code) VALUES(?,?,?,1,${VENDOR_AUTO_CODE}) ON CONFLICT(name_key) DO UPDATE SET ${column}=1 WHERE vendors.${column}=0`).run(clean, nameKey(clean), user.name);
}
// 거래처 목록 구분: type=purchase(매입처)·sales(매출처). 구분이 없는 거래처는 어느 목록에나 나온다.
const VENDOR_TYPES = { purchase: 'is_purchase', sales: 'is_sales' };
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
  applyListKeyword(where, args, query.q, ['name', 'code', 'contact_name', 'phone', 'biz_name', "(SELECT group_concat(c.name || ' ' || c.site || ' ' || c.phone || ' ' || c.mobile || ' ' || c.email, ' ') FROM vendor_contacts c WHERE c.vendor_id=vendors.id)"]); // 15.274 담당자 목록도 검색
  if (query.type) {
    if (query.type === 'none') where.push('is_purchase=0 AND is_sales=0');
    else if (VENDOR_TYPES[query.type]) where.push(query.only === '1' ? `${VENDOR_TYPES[query.type]}=1` : `(${VENDOR_TYPES[query.type]}=1 OR (is_purchase=0 AND is_sales=0))`);
    else throw bad('거래처 구분을 확인하세요.');
  }
  const rows = (await db.prepare(`SELECT * FROM vendors ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name LIMIT 1000`).all(...args)).map(decodeVendor);
  const contacts = new Map(); for (const c of await db.prepare('SELECT * FROM vendor_contacts ORDER BY vendor_id, sort, id').all()) { if (!contacts.has(c.vendor_id)) contacts.set(c.vendor_id, []); contacts.get(c.vendor_id).push(c); } // 15.274
  return rows.map(v => ({ ...v, contacts: contacts.get(v.id) || [] }));
});
// 15.274 담당자 목록(최대 30명): 이름 필수, 사업장·부서/직위/전화/휴대폰/이메일/용도/메모. 보내면 통째로 바꿈.
function vendorContacts(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > 30) throw bad('담당자는 30명까지 넣을 수 있습니다.');
  return list.map((c, i) => { const x = c && typeof c === 'object' ? c : {}, name = str(x.name, 50); if (!name) return null;
    const email = str(x.email, 100); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad(`담당자 ${i + 1}번(${name}) 이메일 형식을 확인하세요.`);
    return { name, site: str(x.site, 50), title: str(x.title, 50), phone: str(x.phone, 30), mobile: str(x.mobile, 30), email, role: str(x.role, 50), note: str(x.note, 200), sort: i };
  }).filter(Boolean);
}
const contactCmds = (vendorRef, list) => [{ sql: `DELETE FROM vendor_contacts WHERE vendor_id=${vendorRef.sql}`, args: vendorRef.args },
  ...list.map(c => ({ sql: `INSERT INTO vendor_contacts(vendor_id,name,site,title,phone,mobile,email,role,note,sort) VALUES(${vendorRef.sql},?,?,?,?,?,?,?,?,?)`, args: [...vendorRef.args, c.name, c.site, c.title, c.phone, c.mobile, c.email, c.role, c.note, c.sort] }))];
// 매입처 기본 운송비 조건(15.69): 최대 10줄. when: always(항상)·gte(발주 금액이 amount 이상)·lt(미만), fee: 운송비, per: order(1건당)·line(품목당), note: 착불 등.
function freightTerms(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > 10) throw bad('운송비 조건은 10줄까지 입력할 수 있습니다.');
  return list.map((r, i) => {
    const rule = r && typeof r === 'object' ? r : {}, no = `운송비 조건 ${i + 1}번`;
    const when = ['always', 'gte', 'lt'].includes(rule.when) ? rule.when : bad(`${no}의 조건을 고르세요.`);
    if (when instanceof Error) throw when;
    const amount = when === 'always' ? null : num(rule.amount, `${no} 기준 금액`);
    const fee = num(rule.fee, `${no} 운송비`); if (fee < 0 || (amount !== null && amount < 0)) throw bad(`${no}의 금액은 0 이상이어야 합니다.`);
    return { when, amount, fee, per: rule.per === 'line' ? 'line' : 'order', note: str(rule.note, 30) };
  });
}
function decodeVendor(v) { if (!v) return v; let terms = []; try { terms = JSON.parse(v.freight_terms || '[]'); } catch { terms = []; } return { ...v, freight_terms: Array.isArray(terms) ? terms : [] }; }
// 의뢰서·발주의 거래처별 운송비 {거래처: 금액}
function freightMap(value) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw bad('운송비 형식을 확인하세요.');
  const entries = Object.entries(value); if (entries.length > 30) throw bad('운송비는 거래처 30곳까지 입력할 수 있습니다.');
  const out = {};
  for (const [vendor, fee] of entries) {
    const name = str(vendor, 100); if (!name || fee === '' || fee === null || fee === undefined) continue;
    const n = num(fee, `${name} 운송비`); if (n < 0) throw bad(`${name} 운송비는 0 이상이어야 합니다.`);
    out[name] = n;
  }
  return out;
}
// 15.267 거래처 상세 칸(누구나 고칠 수 있는 일반 정보). 보내지 않은 칸은 그대로.
const VENDOR_EXTRA = { name_en: 100, corp_no: 20, tel: 30, fax: 30, addr: 200, homepage: 200, memo: 1000, tax_contact: 50, tax_dept: 50, tax_phone: 30, contact_title: 50, contact_mobile: 30, contact_email: 100, bank_name: 50, bank_account: 50, bank_holder: 50 };
function vendorExtra(body, row = {}) {
  const out = {};
  for (const [k, n] of Object.entries(VENDOR_EXTRA)) out[k] = body[k] === undefined ? row[k] ?? '' : str(body[k], n);
  if (out.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.contact_email)) throw bad('담당자 이메일 형식을 확인하세요.');
  return out;
}
function vendorFields(body) { return [reqStr(body.name, '거래처 이름', 100), str(body.contact_name, 50), str(body.phone, 30)]; }
const repName = v => str(v, 50); // 15.224 영업담당자(사용자 이름 또는 직접 입력)
// 체크 값: true/false(화면), 1/0, '1'/'on', ['1'](폼 배열). 보내지 않으면 undefined(고치기에서는 기존 값 유지).
function vendorFlag(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.length ? 1 : 0;
  return value === true || value === 1 || value === '1' || value === 'on' ? 1 : 0;
}
route('POST', '/api/vendors', async ({ user, body }) => {
  const [name, contact, phone] = vendorFields(body);
  const extra = vendorExtra(body), contacts = vendorContacts(body.contacts); // 15.267 저장 전에 형식 확인 · 15.274 담당자 목록
  const tax = vendorTaxValues(body); if (tax && TAX_VENDOR_FIELDS.some(k => k !== 'tax_reverse' && tax[k]) && !hasRole(user, 'sales') && !hasRole(user, 'purchase')) throw new HttpError(403, '사업자 정보는 영업·구매 담당자나 관리자가 넣습니다. 사업자 칸을 비우고 등록하세요.'); // 15.266
  if (await db.prepare('SELECT 1 FROM vendors WHERE name_key=?').get(nameKey(name))) throw new HttpError(409, '이미 등록된 거래처입니다. 목록에서 수정하세요.');
  const code = vendorCode(body.code);
  if (code && await db.prepare('SELECT 1 FROM vendors WHERE code=?').get(code)) throw new HttpError(409, `거래처코드 ${code}는 이미 쓰고 있습니다.`);
  let r;
  try { r = await db.prepare(`INSERT INTO vendors(name,name_key,contact_name,phone,created_by,is_purchase,is_sales,freight_terms,sales_rep,code) VALUES(?,?,?,?,?,?,?,?,?,${code ? '?' : VENDOR_AUTO_CODE})`).run(name, nameKey(name), contact, phone, user.name, vendorFlag(body.is_purchase) || 0, vendorFlag(body.is_sales) || 0, JSON.stringify(freightTerms(body.freight_terms) || []), repName(body.sales_rep), ...(code ? [code] : [])); }
  catch (error) { if (/UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '그 사이 같은 이름이나 코드의 거래처가 등록되었습니다. 새로 불러오세요.'); throw error; }
  if (tax) await db.prepare(`UPDATE vendors SET ${TAX_VENDOR_FIELDS.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...TAX_VENDOR_FIELDS.map(k => tax[k]), r.lastInsertRowid); // 15.266
  if (contacts?.length) await db.batch(contactCmds({ sql: '?', args: [r.lastInsertRowid] }, contacts)); // 15.274
  { const x = extra, keys = Object.keys(x).filter(k => x[k]); if (keys.length) await db.prepare(`UPDATE vendors SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => x[k]), r.lastInsertRowid); } // 15.267
  return decodeVendor(await mustGet('vendors', r.lastInsertRowid));
});
route('PUT', '/api/vendors/:id', async ({ user, params, body }) => {
  const row = await mustGet('vendors', params.id); const [name, contact, phone] = vendorFields(body);
  if (name !== row.name && !hasRole(user, 'purchase') && !hasRole(user, 'sales')) throw new HttpError(403, '거래처 이름 변경(문서의 거래처 이름이 함께 바뀜)은 구매·영업 담당자나 관리자가 합니다.');
  const clash = await db.prepare('SELECT id FROM vendors WHERE name_key=?').get(nameKey(name));
  if (clash && clash.id !== row.id) throw new HttpError(409, '같은 이름의 거래처가 이미 있습니다.');
  const purchase = vendorFlag(body.is_purchase) ?? row.is_purchase, sales = vendorFlag(body.is_sales) ?? row.is_sales;
  const terms = freightTerms(body.freight_terms);
  const code = body.code === undefined ? row.code : vendorCode(body.code);
  if (code && code !== row.code && await db.prepare('SELECT 1 FROM vendors WHERE code=? AND id<>?').get(code, row.id)) throw new HttpError(409, `거래처코드 ${code}는 이미 쓰고 있습니다.`);
  // 15.101 이름을 바꾸면 그 이름으로 저장된 문서(수주·전표·출하지시·세금계산서 초안·발주·출하·마감 키)도 따라 바꾼다.
  // 문서는 거래처 이름 글자를 들고 있어 그대로 두면 수주 잔량·전표 없는 출하·마감 확인이 새 이름과 맞지 않는다.
  const rep = body.sales_rep === undefined ? row.sales_rep || '' : repName(body.sales_rep); // 15.224
  const tax = vendorTaxValues(body, row); if (vendorTaxChanged(tax, row) && !hasRole(user, 'sales') && !hasRole(user, 'purchase')) throw new HttpError(403, '사업자 정보는 영업·구매 담당자나 관리자가 고칩니다.'); // 15.266
  const cmds = [{ sql: 'UPDATE vendors SET name=?,name_key=?,contact_name=?,phone=?,is_purchase=?,is_sales=?,freight_terms=?,code=?,sales_rep=?,updated_by=?,updated_at=? WHERE id=?', args: [name, nameKey(name), contact, phone, purchase, sales, terms === undefined ? row.freight_terms : JSON.stringify(terms), code || '', rep, user.name, now(), row.id] }];
  { const list = vendorContacts(body.contacts); if (list) cmds.push(...contactCmds({ sql: '?', args: [row.id] }, list)); } // 15.274 담당자 목록 통째로
  { const x = vendorExtra(body, row), keys = Object.keys(x).filter(k => x[k] !== (row[k] ?? '')); if (keys.length) cmds.push({ sql: `UPDATE vendors SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, args: [...keys.map(k => x[k]), row.id] }); } // 15.267
  if (vendorTaxChanged(tax, row)) cmds.push({ sql: `UPDATE vendors SET ${TAX_VENDOR_FIELDS.map(k => `${k}=?`).join(',')} WHERE id=?`, args: [...TAX_VENDOR_FIELDS.map(k => tax[k]), row.id] }); // 15.266 사업자 정보도 같은 저장에서
  if ((code || '') !== (row.code || '')) cmds.push({ sql: "UPDATE sales_orders SET customer_code=? WHERE status='open' AND REPLACE(LOWER(customer),' ','')=?", args: [code || '', row.name_key] }); // 15.104 열린 수주만 새 코드로(끝난 수주는 당시 코드)
  if (nameKey(name) !== row.name_key || name !== row.name) {
    const k = row.name_key;
    for (const [table, col] of [['sales_orders', 'customer'], ['sales_bills', 'customer'], ['ship_instructions', 'customer'], ['purchase_bills', 'vendor'], ['purchase_orders', 'vendor'], ['shipments', 'customer'], ['other_receipts', 'vendor'], ['receipts', 'vendor'], ['production_requests', 'customer'], ['sales_payments', 'customer'], ['purchase_payments', 'vendor'], ['purchase_tax_invoices', 'vendor']])
      cmds.push({ sql: `UPDATE ${table} SET ${col}=? WHERE ${customerKey(col)}=?`, args: [name, k] });
    cmds.push({ sql: "UPDATE tax_invoices SET customer=? WHERE REPLACE(LOWER(customer),' ','')=? AND status IN ('draft','failed')", args: [name, k] });
    cmds.push({ sql: 'UPDATE sales_closings SET customer=?,customer_key=? WHERE customer_key=?', args: [name, nameKey(name), k] });
    cmds.push({ sql: 'UPDATE item_prices SET vendor=?,vendor_key=? WHERE vendor_key=?', args: [name, nameKey(name), k] });
    cmds.push({ sql: 'UPDATE purchase_closings SET vendor=?,vendor_key=? WHERE vendor_key=?', args: [name, nameKey(name), k] });
  }
  try { await db.batch(cmds); }
  catch (error) { if (/UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '같은 이름이나 코드의 거래처가 이미 있습니다.'); throw error; }
  return decodeVendor(await mustGet('vendors', row.id));
});
route('DELETE', '/api/vendors/:id', async ({ user, params }) => {
  const row = await mustGet('vendors', params.id);
  if (!canModify(user, row)) throw new HttpError(403, '거래처 삭제는 등록자 또는 관리자만 할 수 있습니다.');
  // 15.100 전표·수주·계산서·발주에 쓰인 거래처는 지우지 않는다(코드·사업자 정보·운송비 조건이 함께 사라져 계산서·수주 고치기가 막힘).
  const key = row.name_key, uses = [];
  for (const [label, table, col] of [['수주', 'sales_orders', 'customer'], ['매출전표', 'sales_bills', 'customer'], ['매입전표', 'purchase_bills', 'vendor'], ['세금계산서', 'tax_invoices', 'customer'], ['발주', 'purchase_orders', 'vendor'], ['출하', 'shipments', 'customer']]) {
    const n = (await db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${customerKey(col)}=?`).get(key)).c; if (n) uses.push(`${label} ${n}건`);
  }
  if (uses.length) throw new HttpError(409, `${row.name}은(는) ${uses.join(', ')}에 쓰인 거래처라 삭제할 수 없습니다. 이름·연락처를 고쳐 쓰세요.`);
  await db.batch([{ sql: 'DELETE FROM vendor_contacts WHERE vendor_id=?', args: [row.id] }, { sql: 'DELETE FROM vendors WHERE id=?', args: [row.id] }]); return { ok: true }; // 15.274 그 거래처의 담당자 목록도 // past orders keep the vendor name they were saved with
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
  // 15.207 제품등록에서 「수입검사 제외」한 품목: 리스트에는 올리되 「검사 제외」로 바로 완료
  const code = purchase ? "COALESCE(src.product_code,'')" : "COALESCE(json_extract(src.bom_snapshot,'$.product_code'),'')";
  const exempt = `EXISTS(SELECT 1 FROM boms eb WHERE eb.skip_incoming=1 AND ((${code}<>'' AND UPPER(eb.product_code)=UPPER(${code})) OR REPLACE(LOWER(eb.product),' ','')=REPLACE(LOWER(src.item),' ','')${purchase ? '' : ' OR eb.id=src.bom_id'}))`;
  return {
    sql: `INSERT INTO requests(type,status,req_no,title,customer,category,data,requester_id,requester_name,approver_name,approved_at,source_type,source_id,batch_id,spec,unit,lot,qty,inspection_snapshot)
      SELECT 'analysis',CASE WHEN ${exempt} THEN 'done' ELSE 'waiting' END,
        ? || printf('%02d', (SELECT COALESCE(MAX(CAST(substr(req_no,length(?) + 1) AS INTEGER)),0)+1 FROM requests WHERE req_no LIKE ?)),
        src.item,src.vendor,'수입검사',
        json_object('purpose','입고 수입검사','sample_qty',CAST(${qty} AS TEXT),
          'source_label',?,'received_date',${date},'item_category',src.item_category,
          'received_qty',${qty},'coa_requested',${coa},
          'purchase_req_no',${purchase ? 'src.req_no' : "''"},
          'bom_id',${purchase ? 'NULL' : 'src.bom_id'},
          'product_code',${purchase ? "src.product_code" : "COALESCE(json_extract(src.bom_snapshot,'$.product_code'),'')"},
          'unit',COALESCE(NULLIF(src.unit,''),${purchase ? "''" : "json_extract(src.bom_snapshot,'$.unit')"},''),'spec',src.spec,'lot',src.lot,'lot_etc',src.lot,'qty',${qty},
          'result_type',CASE WHEN ${coa}=1 THEN 'COA발행' ELSE '기본(데이터공유)' END,'extra',src.note,'exempt',CASE WHEN ${exempt} THEN 1 ELSE 0 END),
        ?,?,CASE WHEN ${exempt} THEN '검사 제외(제품등록)' ELSE '입고 자동접수' END,datetime('now','+9 hours'),?,src.id,src.batch_id,src.spec,src.unit,src.lot,${qty},${inspection}
      FROM ${table} src WHERE src.id=${id == null ? 'last_insert_rowid()' : '?'}
        ${purchase ? "AND src.recv_status IN ('ok','mismatch')" : ''}
        AND NOT EXISTS(SELECT 1 FROM requests WHERE source_type=? AND source_id=src.id)
      ON CONFLICT(source_type,source_id) DO NOTHING`,
    args: [prefix, prefix, prefix + '%', label, user.id, user.name, sourceType, ...(id == null ? [] : [id]), sourceType],
  };
}

function poUnitPrice(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const n = num(value, label); if (n < 0) throw bad(`${label}는 0 이상이어야 합니다.`); return n;
}
function poFields(b, autoNumber = false) {
  return [autoNumber && !str(b.req_no, 50) ? '' : reqStr(b.req_no, '구매의뢰번호', 50), reqStr(b.vendor, '거래처', 100), reqStr(b.item, '품목명', 200), num(b.qty, '수량'), dateStr(b.due_date, '납기일'), str(b.note, 500), itemCategory(b.item_category), checked(b.coa_requested)];
}
// Direct orders and approved purchase requests share the PR number space. Allocate inside
// the INSERT so concurrent saves cannot read the same next number. Multi-item rows share one number.
const nextPurchaseNo = `? || printf('%02d', (SELECT COALESCE(MAX(CAST(substr(n, length(?) + 1) AS INTEGER)),0)+1 FROM (SELECT req_no AS n FROM purchase_orders UNION ALL SELECT doc_no AS n FROM purchase_requests) WHERE n LIKE ? || '%'))`;
function insertPurchaseOrder(record, batchId = '') {
  const columns = Object.keys(record), args = [];
  const values = columns.map(key => {
    if (key !== 'req_no' || record.req_no) { args.push(record[key]); return '?'; }
    const prefix = 'PR-' + today().slice(2).replace(/-/g, '') + '-';
    if (batchId) args.push(batchId);
    args.push(prefix, prefix, prefix);
    return batchId ? `COALESCE((SELECT req_no FROM purchase_orders WHERE batch_id=? ORDER BY id LIMIT 1), ${nextPurchaseNo})` : nextPurchaseNo;
  });
  return { sql: `INSERT INTO purchase_orders(${columns.join(',')}) VALUES(${values.join(',')})`, args };
}
// 15.186 품목별 최근 발주 내역: 발주 입력에서 품목을 고르면 그 품목의 최근 발주(일자·거래처·수량·단가)와 최근 단가(같은 거래처 우선)를 보여 준다.
// 제품코드가 있으면 코드로, 없으면 품목명(공백·대소문자 무시)으로 찾는다. 단가가 비어 있던 발주도 내역에는 나온다.
// 15.188 품목별 최근 판매가(확정 매출전표 줄 단가, 반입 감액 줄 제외). 구매의뢰 작성에서 판매단가 참고용. 고객사를 주면 그 고객사 단가를 먼저.
// 판매가는 영업·구매 담당(관리자 포함)만 본다.
route('GET', '/api/sales/price-history', async ({ user, query }) => {
  if (!hasRole(user, 'sales') && !hasRole(user, 'purchase')) throw new HttpError(403, '판매가는 영업·구매 담당자만 볼 수 있습니다.');
  const code = str(query.code, 50), item = str(query.item, 200), customer = str(query.customer, 200);
  if (!code && !item) return { rows: [], last: null, last_customer: null };
  const where = code ? 'l.product_code=?' : "REPLACE(LOWER(l.item),' ','')=?";
  const rows = await db.prepare(`SELECT l.id, b.bill_no AS doc_no, b.customer, l.item, l.spec, l.unit, l.qty, l.unit_price, b.bill_date AS doc_date FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id
    WHERE l.active=1 AND b.status='confirmed' AND l.qty > 0 AND ${where} ORDER BY b.bill_date DESC, l.id DESC LIMIT 10`).all(code || item.toLowerCase().replace(/ /g, ''));
  const ck = customer ? nameKey(customer) : '';
  return { rows, last: rows[0] || null, last_customer: ck ? rows.find(r => nameKey(r.customer) === ck) || null : null };
});
route('GET', '/api/po/history', async ({ query }) => {
  // 15.187 기준 단가는 확정 매입전표(입고 뒤 정산)의 줄 단가. 매입전표가 없는 품목은 발주서 단가로 대신 보여 준다(basis로 구분).
  const code = str(query.code, 50), item = str(query.item, 200), vendor = str(query.vendor, 100);
  if (!code && !item) return { basis: 'bill', rows: [], last: null, last_vendor: null };
  const key = item.toLowerCase().replace(/ /g, ''), vkey = vendor ? nameKey(vendor) : '';
  const lineWhere = code ? 'l.product_code=?' : "REPLACE(LOWER(l.item),' ','')=?";
  const bills = await db.prepare(`SELECT l.id, b.bill_no AS doc_no, b.vendor, l.item, l.spec, l.unit, l.qty, l.unit_price, b.bill_date AS doc_date, l.req_no FROM purchase_bill_lines l JOIN purchase_bills b ON b.id=l.bill_id
    WHERE l.active=1 AND b.status='confirmed' AND ${lineWhere} ORDER BY b.bill_date DESC, l.id DESC LIMIT 10`).all(code || key);
  const pick = rows => ({ last: rows.find(r => r.unit_price != null) || null, last_vendor: vkey ? rows.find(r => r.unit_price != null && nameKey(r.vendor) === vkey) || null : null });
  if (bills.length) return { basis: 'bill', rows: bills, ...pick(bills) };
  const poWhere = code ? 'product_code=?' : "REPLACE(LOWER(item),' ','')=?";
  const pos = await db.prepare(`SELECT id, req_no AS doc_no, vendor, item, spec, unit, qty, unit_price, substr(created_at,1,10) AS doc_date, req_no, recv_status FROM purchase_orders WHERE ${poWhere} ORDER BY created_at DESC, id DESC LIMIT 10`).all(code || key);
  return { basis: 'po', rows: pos, ...pick(pos) };
});
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
    COALESCE((SELECT m.result FROM requests q JOIN inspection_measurements m ON m.request_id=q.id WHERE q.source_type='purchase_order' AND q.source_id=purchase_orders.id LIMIT 1), (SELECT 'exempt' FROM requests q WHERE q.source_type='purchase_order' AND q.source_id=purchase_orders.id AND json_extract(q.data,'$.exempt')=1 LIMIT 1)) AS qc_result,
    (SELECT json_object('id',c.id,'action',c.action,'new_recv_qty',c.new_recv_qty,'reason',c.reason,'requested_by',c.requested_by,'requested_by_id',c.requested_by_id,'requested_at',c.requested_at) FROM receipt_qty_changes c WHERE c.po_id=purchase_orders.id AND c.status='pending') AS pending_change,
    (SELECT i.id FROM purchase_request_items i WHERE i.po_id=purchase_orders.id LIMIT 1) AS pr_item_id,
    (SELECT COALESCE(SUM(x.qty),0) FROM purchase_bill_lines x WHERE x.active=1 AND x.po_id=purchase_orders.id) AS billed_qty
    FROM purchase_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (recv_status='ok'), due_date, id DESC`).all(...args));
});
// 발주 1건 등록(발주 입력 화면과 구매의뢰 「발주 생성」이 함께 쓴다).
async function createPurchaseOrder(user, body) {
  // A chosen code supplies the item name (and class when none was given).
  if (body.bom_id) { const chosen = await catalogItem(user, body); body.item = chosen.product; if (!body.item_category && ITEM_CATEGORIES.includes(chosen.item_category)) body.item_category = chosen.item_category; }
  const f = poFields(body, true); const entry = await catalogItem(user, body); await ensureVendor(f[1], user, 'purchase');
  const record = Object.fromEntries(['req_no','vendor','item','qty','due_date','note','item_category','coa_requested'].map((key, i) => [key, f[i]]));
  const command = insertPurchaseOrder({ ...record, item: entry.product, created_by: user.name, product_code: entry.product_code, unit: str(body.unit, 20) || entry.unit });
  const r = await db.prepare(command.sql).run(...command.args);
  if (body.unit_price !== undefined && body.unit_price !== '') await db.prepare('UPDATE purchase_orders SET unit_price=? WHERE id=?').run(poUnitPrice(body.unit_price, '단가'), r.lastInsertRowid);
  // 15.69 내부 메모(구매·물류용, 발주서에 안 나감)·운송비
  if (body.internal_note || (body.freight !== undefined && body.freight !== '')) await db.prepare('UPDATE purchase_orders SET internal_note=?,freight=? WHERE id=?').run(str(body.internal_note, 200), poUnitPrice(body.freight, '운송비'), r.lastInsertRowid);
  return (await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(r.lastInsertRowid));
}
route('POST', '/api/po', async ({ user, body }) => createPurchaseOrder(user, body));
route('PUT', '/api/po/:id', async ({ user, params, body }) => {
  const row = (await mustGet('purchase_orders', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 수정할 수 있습니다.');
  const f = poFields(body);
  // 15.77 LOT별 입고 줄이 있는 발주: 수량·품목·거래처·단위를 바꾸면 입고 수량·상태·LOT 재고가 어긋나므로 막는다(입고 취소 요청 뒤 고침).
  if (await db.prepare('SELECT 1 FROM po_receipt_lots WHERE po_id=? AND voided_at IS NULL').get(row.id) || await db.prepare('SELECT 1 FROM purchase_bill_lines WHERE po_id=? AND active=1').get(row.id)) {
    const changed = [];
    if (Number(f[3]) !== row.qty) changed.push('수량');
    if (nameKey(f[1]) !== nameKey(row.vendor)) changed.push('거래처');
    if (nameKey(f[2]) !== nameKey(row.item) || (body.bom_id !== undefined && body.bom_id !== null && body.bom_id !== '')) changed.push('품목');
    if (body.unit !== undefined && str(body.unit, 20) !== (row.unit || '')) changed.push('단위');
    if (changed.length) throw new HttpError(409, `${row.item}: 입고 기록(LOT)이 있는 발주는 ${changed.join('·')}을(를) 바꿀 수 없습니다. 입고목록의 「입고 취소 요청」으로 되돌린 뒤 고치세요.`);
  }
  // Keep the linked code unless the item name itself was changed.
  const entry = nameKey(f[2]) === nameKey(row.item) && row.product_code && body.bom_id === undefined ? { product: row.item, product_code: row.product_code } : await catalogItem(user, body);
  await ensureVendor(f[1], user, 'purchase');
  (await db.prepare('UPDATE purchase_orders SET req_no=?,vendor=?,item=?,qty=?,due_date=?,note=?,item_category=?,coa_requested=?,product_code=? WHERE id=?').run(f[0], f[1], entry.product, ...f.slice(3), entry.product_code, row.id));
  // 15.66 단가(발주서용, 선택): 보내면 바꾸고 빈 값이면 지운다.
  if (body.unit_price !== undefined) await db.prepare('UPDATE purchase_orders SET unit_price=? WHERE id=?').run(poUnitPrice(body.unit_price, '단가'), row.id);
  if (body.internal_note !== undefined) await db.prepare('UPDATE purchase_orders SET internal_note=? WHERE id=?').run(str(body.internal_note, 200), row.id);
  if (body.freight !== undefined) await db.prepare('UPDATE purchase_orders SET freight=? WHERE id=?').run(poUnitPrice(body.freight, '운송비'), row.id);
  await recordEdit('purchase_order', 'purchase_orders', row.id, row, EDIT_LABELS.purchase_order, user);
  return (await mustGet('purchase_orders', row.id));
});
route('DELETE', '/api/po/:id', async ({ user, params, query }) => {
  const row = (await mustGet('purchase_orders', params.id)); if (!canModify(user, row) && !hasRole(user, 'purchase')) throw new HttpError(403, '등록자 또는 구매 담당자만 삭제할 수 있습니다.');
  if (await db.prepare('SELECT 1 FROM purchase_bill_lines WHERE po_id=? AND active=1').get(row.id)) throw new HttpError(409, `${row.item}: 매입전표에 들어간 발주입니다. 구매에서 매입전표를 취소한 뒤 삭제하세요.`);
  // 15.75 LOT별 입고 줄이 있는 발주는 지우지 않는다(입고증·재고 기록이 끊김). 입고 취소 요청으로 되돌린 뒤 지운다.
  if (await db.prepare('SELECT 1 FROM po_receipt_lots WHERE po_id=? AND voided_at IS NULL').get(row.id)) throw new HttpError(409, `${row.item}: 입고 기록(LOT)이 있는 발주는 삭제할 수 없습니다. 입고목록에서 「입고 취소 요청」으로 되돌린 뒤 삭제하세요.`);
  // 구매의뢰에서 만든 발주를 지우면(15.69) 그 의뢰 품목은 「발주 안 함」으로 닫아 발주 대기에 다시 나타나지 않게 한다.
  // requeue=1이면 예전처럼 발주 대기로 되돌린다(다시 발주할 때). 발주 삭제와 같은 batch로 저장한다.
  const closed = query.requeue === '1' ? '' : `발주 삭제 · ${user.name} · ${now()}`.slice(0, 200);
  try {
    await deleteEntityWithAttachments('purchase_order', 'purchase_orders', row.id, [
      { sql: "SELECT json('conflict') WHERE EXISTS(SELECT 1 FROM po_receipt_lots WHERE po_id=? AND voided_at IS NULL)", args: [row.id] }, // 확인과 삭제 사이에 입고가 들어온 경우
      { sql: 'UPDATE purchase_request_items SET po_id=NULL,order_closed=? WHERE po_id=?', args: [closed, row.id] }]);
  } catch (error) { if (isGuardError(error)) throw new HttpError(409, `${row.item}: 입고 기록(LOT)이 있는 발주는 삭제할 수 없습니다. 입고목록에서 「입고 취소 요청」으로 되돌린 뒤 삭제하세요.`); throw error; }
  return { ok: true };
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
      recv_at=CASE WHEN recv_status='ok' AND ?='ok' THEN recv_at ELSE ? END WHERE id=? AND ((recv_status=? AND recv_qty IS ?) OR (?='ok' AND recv_status='ok'))`,
      args: [status, status, status === 'ok' ? (row.recv_status === 'mismatch' ? row.recv_qty : row.qty) : recvQty, str(body.note, 500), status, status ? user.name : null, status, status ? now() : null, row.id, row.recv_status, row.recv_qty, status] }); // 이미 입고완료인 것을 다시 입고완료로 누르는 것은 같은 결과라 허용
    queries.push(RC_GUARD); // 15.77 그 사이 입고 입력(LOT 줄)이 먼저 저장됐으면 batch 전체를 되돌린다
    // Anyone may confirm a receipt; the append-only comment keeps who did what even after later status changes.
    const label = { '': '미입고', ok: '입고완료', mismatch: '수량상이', checking: '확인중' };
    const detail = status === 'mismatch' ? ` · 실입고 ${recvQty} (발주 ${row.qty})`
      : status === 'ok' && row.recv_status === 'mismatch' ? ` · 수량상이 종결 · 실입고 ${row.recv_qty} (발주 ${row.qty}), 이후 입고분은 기타입고`
      : status === 'ok' ? ` · 수량 ${row.recv_status === 'ok' ? row.recv_qty ?? row.qty : row.qty}` : '';
    queries.push({ sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)',
      args: ['purchase_order', row.id, `[입고 처리] ${label[row.recv_status] ?? row.recv_status} → ${label[status]}${detail}${str(body.note, 500) ? ' · ' + str(body.note, 500) : ''}`, user.id, user.name] });
    if (['ok', 'mismatch'].includes(status)) queries.push(receiptAnalysisQuery('purchase_order', row.id, user));
  }
  let results;
  try { results = await db.batch(queries); }
  catch (error) { if (isGuardError(error)) throw new HttpError(409, '그 사이 다른 곳에서 입고가 처리되었습니다. 목록을 새로 불러와 다시 확인하세요.'); throw error; }
  const per = ['ok', 'mismatch'].includes(status) ? 4 : 3;
  return { ok: true, analysis_created: per === 4 ? results.filter((_, i) => i % 4 === 3).reduce((sum, r) => sum + r.meta.changes, 0) : 0 };
});

// ── 물류: 기록된 입고 수량 수정·입고 취소 요청 (물류팀장 승인 후 반영) ──
function requireReceiptApprover(user) {
  if (!user.is_admin && !publicUser(user).roles.includes('logistics_approver')) throw new HttpError(403, '물류팀장(입고 수량 수정 승인권자)만 승인·반려할 수 있습니다. 관리자에게 지정을 요청하세요.');
}
route('POST', '/api/po/:id/receipt-changes', async ({ user, params, body }) => {
  const row = await mustGet('purchase_orders', params.id);
  if (!['ok', 'mismatch'].includes(row.recv_status)) throw bad('입고 수량이 기록된 항목만 수정·취소 요청할 수 있습니다.');
  if (await db.prepare('SELECT 1 FROM purchase_bill_lines WHERE po_id=? AND active=1').get(row.id)) throw new HttpError(409, `${row.item}: 매입전표에 들어간 입고입니다. 구매에서 매입전표를 취소한 뒤 수정·취소 요청하세요.`);
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
  const applied = "EXISTS(SELECT 1 FROM receipt_qty_changes WHERE id=? AND status='pending')";
  // 15.75 수량 수정 보정 줄: LOT가 하나뿐이면 그 LOT에 붙이고, 여럿이면 LOT 미지정(LOT별 재고에 「LOT 미지정 수량 수정」으로 보임).
  const lotNames = await db.prepare("SELECT DISTINCT lot FROM po_receipt_lots WHERE po_id=? AND voided_at IS NULL AND lot<>''").all(row.id);
  if (change.action !== 'qty' || Number(change.new_recv_qty) < Number(change.old_recv_qty)) for (const { lot } of lotNames) { const u = await lotUsage(row.item, lot); if (u) throw new HttpError(409, lotUsedMessage(row.item, lot, u)); } // 15.150
  const correctionLot = lotNames.length === 1 ? lotNames[0].lot : '';
  if (await db.prepare('SELECT 1 FROM purchase_bill_lines WHERE po_id=? AND active=1').get(row.id)) throw new HttpError(409, `${row.item}: 그 사이 매입전표에 들어간 입고입니다. 구매에서 매입전표를 취소한 뒤 승인하세요.`);
  let results;
  try { results = await db.batch([
    // 15.84 승인 순간에도 매입전표에 들어간 입고면 오류로 batch 전체를 되돌린다.
    { sql: "SELECT json('conflict') WHERE EXISTS(SELECT 1 FROM purchase_bill_lines WHERE po_id=? AND active=1)", args: [row.id] },
    change.action === 'qty'
      ? { sql: `UPDATE purchase_orders SET recv_qty=? WHERE id=? AND recv_status=? AND recv_qty IS ? AND ${applied}`, args: [change.new_recv_qty, row.id, change.old_status, change.old_recv_qty, change.id] }
      : { sql: `UPDATE purchase_orders SET recv_status='',recv_qty=NULL,recv_note='',recv_by=NULL,recv_at=NULL WHERE id=? AND recv_status=? AND recv_qty IS ? AND ${applied}`, args: [row.id, change.old_status, change.old_recv_qty, change.id] },
    // 15.72 LOT별 입고 줄이 있는 발주: 수량 수정은 차이를 보정 줄로 더하고, 입고 취소는 줄을 모두 취소해 recv_qty = 줄 합을 유지한다.
    change.action === 'qty'
      ? { sql: `INSERT INTO po_receipt_lots(po_id,lot,qty,received_date,note,created_by) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM po_receipt_lots WHERE po_id=? AND voided_at IS NULL) AND ${applied}`, args: [row.id, correctionLot, stockRound(change.new_recv_qty - change.old_recv_qty), today(), `수량 수정 승인 #${change.id}`, user.name, row.id, change.id] }
      : { sql: `UPDATE po_receipt_lots SET voided_at=?,voided_by=? WHERE po_id=? AND voided_at IS NULL AND ${applied}`, args: [stamp, user.name, row.id, change.id] },
    // 입고 취소: LOT 줄로 받은 발주는 발주의 LOT 목록도 비운다(취소된 LOT가 다음 입고에 다시 붙지 않게).
    ...(change.action === 'qty' ? [] : [{ sql: `UPDATE purchase_orders SET lot='' WHERE id=? AND EXISTS(SELECT 1 FROM po_receipt_lots WHERE po_id=?) AND ${applied}`, args: [row.id, row.id, change.id] }]),
    { sql: `INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) SELECT 'purchase_order',?,?,?,? WHERE ${applied}`, args: [row.id, text, user.id, user.name, change.id] },
    // The linked inspection keeps its receipt snapshot; the correction is noted on it instead.
    { sql: `INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) SELECT 'request',id,?,?,? FROM requests WHERE source_type='purchase_order' AND source_id=? AND ${applied}`, args: [text, user.id, user.name, row.id, change.id] },
    { sql: "UPDATE receipt_qty_changes SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'", args: [user.name, stamp, str(body.note, 500), change.id] },
  ]); } catch (error) { if (isGuardError(error)) throw new HttpError(409, `${row.item}: 그 사이 매입전표에 들어간 입고입니다. 구매에서 매입전표를 취소한 뒤 승인하세요.`); throw error; }
  if (!results.at(-1).meta.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
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

// ── 물류: 입고 묶음·LOT·창고 (15.72) ──
// 한 번에 받은 입고를 입고번호(RC-YYMMDD-NN)로 묶는다. 발주 줄은 LOT별로 po_receipt_lots에 쌓이고(부분 입고 가능),
// 발주의 recv_qty = 취소 안 된 줄의 합, 상태는 합이 발주 수량과 같으면 입고완료, 아니면 수량상이(부분 입고 포함)입니다.
// 기타입고 줄은 지금처럼 other_receipts 한 줄씩(LOT마다 한 줄, 수입검사도 줄마다)이며 receipt_id로 묶입니다.
const RC_GUARD = { sql: "SELECT json('conflict') WHERE changes()=0" }; // 바로 앞 문장이 바꾼 줄이 없으면 오류를 내어 batch 전체를 되돌린다
const isGuardError = error => /malformed JSON/i.test(String(error && error.message));
async function warehouseRules() {
  const list = await db.prepare('SELECT * FROM warehouses WHERE active=1 ORDER BY sort, name').all();
  return {
    list,
    check(warehouse, location) {
      const name = str(warehouse, 50), place = str(location, 50);
      if (!name) { if (place) throw bad('위치(Location)를 넣으려면 창고를 먼저 고르세요.'); return { warehouse: '', location: '' }; }
      const w = list.find(x => x.name === name); if (!w) throw bad(`등록되지 않은 창고입니다: ${name}`);
      const places = w.locations ? w.locations.split(',') : [];
      if (place && places.length && !places.includes(place)) throw bad(`${name} 창고에 없는 위치입니다: ${place}`);
      return { warehouse: name, location: place };
    },
  };
}
function receiptLineSql() {
  return `SELECT 'po' AS kind, l.id, l.receipt_id, l.po_id, NULL AS other_id, COALESCE(p.req_no,'') AS req_no, COALESCE(p.item,'(삭제된 발주)') AS item, COALESCE(p.spec,'') AS spec, COALESCE(p.unit,'') AS unit, COALESCE(p.product_code,'') AS product_code, COALESCE(p.item_category,'') AS item_category, l.lot, l.sub_lot, l.qty, l.pieces, l.pieces_temp, l.vendor_lot, CASE WHEN l.pieces IS NULL THEN NULL ELSE 1 + COALESCE((SELECT SUM(x.pieces) FROM po_receipt_lots x JOIN purchase_orders px ON px.id=x.po_id WHERE x.lot=l.lot AND x.lot<>'' AND TRIM(px.item)=TRIM(p.item) AND x.id<l.id),0) END AS piece_from, l.received_date, l.warehouse, l.location, l.note, l.note2, l.voided_at, p.qty AS po_qty, p.recv_qty, p.recv_status
      FROM po_receipt_lots l LEFT JOIN purchase_orders p ON p.id=l.po_id`;
}
async function receiptDetail(r) {
  const po = await db.prepare(`${receiptLineSql()} WHERE l.receipt_id=? ORDER BY l.id`).all(r.id);
  const other = await db.prepare(`SELECT 'other' AS kind, id, receipt_id, NULL AS po_id, id AS other_id, '' AS req_no, item, spec, COALESCE(NULLIF(unit,''), json_extract(bom_snapshot,'$.unit'), '') AS unit, json_extract(bom_snapshot,'$.product_code') AS product_code, item_category, lot, sub_lot, qty, pieces, pieces_temp, vendor_lot, CASE WHEN pieces IS NULL THEN NULL ELSE 1 + COALESCE((SELECT SUM(x.pieces) FROM po_receipt_lots x JOIN purchase_orders px ON px.id=x.po_id WHERE x.lot=other_receipts.lot AND TRIM(px.item)=TRIM(other_receipts.item)),0) + COALESCE((SELECT SUM(o.pieces) FROM other_receipts o WHERE o.lot=other_receipts.lot AND TRIM(o.item)=TRIM(other_receipts.item) AND o.id<other_receipts.id),0) END AS piece_from, received_date, warehouse, location, note, note2, NULL AS voided_at FROM other_receipts WHERE receipt_id=? ORDER BY id`).all(r.id);
  return { ...r, lines: [...po, ...other] };
}
route('GET', '/api/receipts', async ({ query }) => {
  const where = [], args = [];
  applyListDates(where, args, query, 'receipt_date');
  if (query.kind === 'other') where.push("(receipt_no LIKE 'OTS\\_%' ESCAPE '\\' OR (EXISTS(SELECT 1 FROM other_receipts o WHERE o.receipt_id=receipts.id) AND NOT EXISTS(SELECT 1 FROM po_receipt_lots l WHERE l.receipt_id=receipts.id)))"); // 15.234 기타입고 내역
  if (query.vendor) { where.push("REPLACE(LOWER(vendor),' ','') LIKE ? ESCAPE '\\'"); args.push('%' + nameKey(str(query.vendor, 100)).replace(/[\\%_]/g, m => '\\' + m) + '%'); }
  if (query.q) { const q = '%' + String(query.q).slice(0, 200).replace(/[\\%_]/g, m => '\\' + m) + '%'; where.push(`(receipt_no LIKE ? ESCAPE '\\' OR vendor LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' OR created_by LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.receipt_id=receipts.id AND (l.lot LIKE ? ESCAPE '\\' OR p.item LIKE ? ESCAPE '\\')) OR EXISTS(SELECT 1 FROM other_receipts o WHERE o.receipt_id=receipts.id AND (o.lot LIKE ? ESCAPE '\\' OR o.item LIKE ? ESCAPE '\\')))`); args.push(q, q, q, q, q, q, q, q); }
  const page = Math.max(0, Math.min(1000, Number(query.page) || 0));
  const rows = await db.prepare(`SELECT receipts.*,
      (SELECT COUNT(*) FROM po_receipt_lots l WHERE l.receipt_id=receipts.id) + (SELECT COUNT(*) FROM other_receipts o WHERE o.receipt_id=receipts.id) AS line_count,
      (SELECT COUNT(*) FROM po_receipt_lots l WHERE l.receipt_id=receipts.id AND l.voided_at IS NOT NULL) AS voided_count,
      COALESCE((SELECT group_concat(item, ' · ') FROM (SELECT DISTINCT p.item FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.receipt_id=receipts.id UNION SELECT DISTINCT o.item FROM other_receipts o WHERE o.receipt_id=receipts.id LIMIT 4)), '') AS items
    FROM receipts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY receipt_date DESC, id DESC LIMIT 201 OFFSET ?`).all(...args, page * 200);
  return { rows: rows.slice(0, 200), page, more: rows.length > 200 };
});
route('GET', '/api/receipts/open-po', async ({ query }) => {
  const key = nameKey(reqStr(query.vendor, '거래처', 100));
  return db.prepare(`SELECT id, req_no, vendor, item, spec, unit, qty, recv_qty, recv_status, due_date, lot, product_code, item_category, internal_note, coa_requested,
      (SELECT 1 FROM receipt_qty_changes c WHERE c.po_id=purchase_orders.id AND c.status='pending') AS pending_change
    FROM purchase_orders WHERE REPLACE(LOWER(vendor),' ','')=? AND recv_status IN ('','checking','mismatch') ORDER BY due_date, id LIMIT 300`).all(key);
});
// LOT 자동 번호: 접두어 + 입고일(YYMMDD) + _순번(3자리). 이미 쓰인 번호(발주입고·기타입고) 다음부터 count개를 제안한다.
// 15.133 LOT 체계: [식별문자][입고일]_[NNN]. 식별문자는 품목 분류로 정한다(원자재 R · 제품 P · 상품 G · 부자재 S · 소모품 C).
const LOT_PREFIX = { 원자재: 'R', 제품: 'P', 반제품: 'P', 상품: 'G', 부자재: 'S', 소모품: 'C' };
const lotPrefixOf = category => LOT_PREFIX[String(category || '').trim()] || 'M';
route('GET', '/api/lots/next', async ({ query }) => {
  const prefix = str(query.prefix, 10).replace(/[^A-Za-z0-9-]/g, '') || lotPrefixOf(query.category);
  const date = dateStr(query.date || today(), '입고일'), count = Math.max(1, Math.min(100, Number(query.count) || 1));
  const head = `${prefix}${date.slice(2).replace(/-/g, '')}_`;
  // 접두어가 정확히 같고(대소문자 구분) 뒤가 숫자뿐인 LOT만 센다(LIKE는 _와 대소문자를 구분하지 않음).
  const match = "substr(lot,1,length(?))=? AND length(lot)>length(?) AND substr(lot,length(?)+1) NOT GLOB '*[^0-9]*'";
  const used = await db.prepare(`SELECT MAX(n) AS n FROM (SELECT CAST(substr(lot, length(?) + 1) AS INTEGER) AS n FROM po_receipt_lots WHERE ${match} UNION ALL SELECT CAST(substr(lot, length(?) + 1) AS INTEGER) FROM other_receipts WHERE ${match} UNION ALL SELECT CAST(substr(lot, length(?) + 1) AS INTEGER) FROM production_actuals WHERE ${match})`).get(...Array(15).fill(head));
  const start = (used && used.n) || 0;
  // 15.190 입고 LOT 순번 4자리(R261113_0049). 서브 LOT는 화면·라벨에서 -001로 붙는다(R261113_0049-001).
  return { lots: Array.from({ length: count }, (_, i) => head + String(start + i + 1).padStart(4, '0')) };
});
route('GET', '/api/receipts/:id', async ({ params }) => receiptDetail(await mustGet('receipts', params.id)));
// 15.249 입고 LOT = 업체 LOT. 비우면 입고일 기준 임시 SST LOT(SST-YYMMDD-01, 02 …)를 줄마다 붙인다.
async function nextSstLots(date, count) {
  if (!count) return [];
  const head = `SST-${String(date).slice(2).replace(/-/g, '')}-`;
  const match = "substr(lot,1,length(?))=? AND length(lot)>length(?) AND substr(lot,length(?)+1) NOT GLOB '*[^0-9]*'";
  const used = await db.prepare(`SELECT MAX(n) AS n FROM (SELECT CAST(substr(lot, length(?) + 1) AS INTEGER) AS n FROM po_receipt_lots WHERE ${match} UNION ALL SELECT CAST(substr(lot, length(?) + 1) AS INTEGER) FROM other_receipts WHERE ${match})`).get(head, head, head, head, head, head, head, head, head, head);
  const start = (used && used.n) || 0;
  return Array.from({ length: count }, (_, i) => head + String(start + i + 1).padStart(2, '0'));
}
async function fillSstLots(date, lines) { const blank = lines.filter(l => !l.lot); const lots = await nextSstLots(date, blank.length); blank.forEach((l, i) => { l.lot = lots[i]; l.temp_lot = true; }); }
// 15.254 자동 번호 겹침 막기: 이 batch 끝에 넣으면 같은 번호가 둘 이상일 때 오류로 전체를 되돌린다(다시 저장하면 새 번호)
const LOT_DUP_GUARD = "SELECT abs(-9223372036854775807 - 1) WHERE "; // 겹치면 integer overflow 오류(다른 guard와 구별)
const bagGuard = lots => lots.map(lot => ({ sql: LOT_DUP_GUARD + "(SELECT COUNT(*) FROM semi_records WHERE process='cut' AND lot=?) > 1", args: [lot] }));
const sstGuard = lots => lots.map(lot => ({ sql: LOT_DUP_GUARD + '(SELECT COUNT(*) FROM po_receipt_lots WHERE lot=?) + (SELECT COUNT(*) FROM other_receipts WHERE lot=?) > 1', args: [lot, lot] }));
const lotDupError = error => /integer overflow/i.test(String(error?.message || '')) ? new HttpError(409, '같은 순간 다른 저장과 LOT 번호가 겹쳤습니다. 한 번 더 저장하세요(새 번호가 붙습니다).') : error;
route('POST', '/api/receipts', async ({ user, body }) => {
  const token = String(body.request_id || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw bad('등록 요청 번호를 확인하세요.');
  const replay = async saved => { if (saved.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.'); return { ...await receiptDetail(saved), duplicate: true }; };
  const prior = await db.prepare('SELECT * FROM receipts WHERE request_id=?').get(token);
  if (prior) return replay(prior);
  const date = dateStr(body.receipt_date, '입고일'); if (date > today()) throw bad('입고일은 오늘 이전으로 선택하세요.');
  const vendor = reqStr(body.vendor, '거래처(협력사)', 100), note = str(body.note, 500);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length || lines.length > 100) throw bad('입고 줄은 1~100줄 입력하세요.');
  const rules = await warehouseRules();
  const poLines = new Map(), otherLines = [];
  for (const [index, raw] of lines.entries()) {
    const l = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    try {
      const qty = num(l.qty, '수량'); if (!(qty > 0)) throw bad('수량은 0보다 커야 합니다.');
      const line = { lot: str(l.lot, 100), qty, pieces: piecesOf(l.pieces), note: str(l.note, 200), note2: str(l.note2, 200), ...rules.check(l.warehouse, l.location), no: index + 1 }; // 15.199 note2 = 업체 정보(비고2)
      if (l.po_id !== undefined && l.po_id !== null && l.po_id !== '') {
        const id = Number(l.po_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad('발주를 다시 고르세요.');
        const group = poLines.get(id) || []; group.push(line); poLines.set(id, group);
      } else otherLines.push({ ...line, raw: l });
    } catch (error) { if (error.status === 400 || error.status === 404) throw bad(`${index + 1}번째 줄: ${error.message}`); throw error; }
  }
  for (const [poId, group] of poLines) { const pl = (await db.prepare('SELECT lot FROM purchase_orders WHERE id=?').get(poId))?.lot || ''; if (pl && !pl.includes(',')) group.forEach(l => { if (!l.lot) l.lot = pl; }); } // 발주에 미리 적은 업체 LOT
  await fillSstLots(date, [...[...poLines.values()].flat(), ...otherLines].sort((a, b) => a.no - b.no)); // 15.249 업체 LOT 없으면 임시 SST LOT
  // 15.133 서브 LOT: 같은 LOT로 받은 줄(포장)마다 001, 002 … 이 LOT에 이미 쓴 서브 번호 다음부터 잇는다.
  const subNext = new Map();
  for (const l of [...[...poLines.values()].flat(), ...otherLines].sort((a, b) => a.no - b.no)) {
    if (!l.lot) continue;
    if (!subNext.has(l.lot)) subNext.set(l.lot, (await db.prepare("SELECT MAX(n) AS n FROM (SELECT CAST(sub_lot AS INTEGER) AS n FROM po_receipt_lots WHERE lot=? AND voided_at IS NULL UNION ALL SELECT CAST(sub_lot AS INTEGER) FROM other_receipts WHERE lot=?)").get(l.lot, l.lot)).n || 0);
    const n = subNext.get(l.lot) + 1; subNext.set(l.lot, n); l.sub_lot = String(n).padStart(3, '0');
  }
  const prefix = `RC-${today().slice(2).replace(/-/g, '')}-`, RID = '(SELECT id FROM receipts WHERE request_id=?)';
  const at = `${date} ${now().slice(11)}`;
  const cmds = [{ sql: `INSERT INTO receipts(receipt_no,receipt_date,vendor,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('receipts', 'receipt_no')},?,?,?,?,?,?)`, args: [prefix, prefix, prefix, date, vendor, note, user.name, user.id, token] }];
  const label = { '': '미입고', ok: '입고완료', mismatch: '수량상이', checking: '확인중' };
  for (const [poId, group] of poLines) {
    const po = await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(poId);
    const name = po ? `${po.item}${po.spec ? ' ' + po.spec : ''}(${po.req_no})` : '';
    if (!po) throw bad(`${group[0].no}번째 줄: 발주를 찾을 수 없습니다. 목록을 새로 불러오세요.`);
    if (nameKey(po.vendor) !== nameKey(vendor)) throw bad(`${name}: 다른 거래처(${po.vendor})의 발주입니다.`);
    if (po.recv_status === 'ok') throw bad(`${name}: 이미 입고가 끝난 발주입니다. 더 받은 수량은 기타입고로 받으세요.`);
    if (await db.prepare("SELECT 1 FROM receipt_qty_changes WHERE po_id=? AND status='pending'").get(poId)) throw new HttpError(409, `${name}: 승인 대기 중인 입고 수정 요청이 있습니다. 처리 후 다시 시도하세요.`);
    const recorded = ['ok', 'mismatch'].includes(po.recv_status) ? po.recv_qty || 0 : 0;
    const active = await db.prepare('SELECT * FROM po_receipt_lots WHERE po_id=? AND voided_at IS NULL ORDER BY id').all(poId);
    const add = stockRound(group.reduce((t, l) => t + l.qty, 0)), total = stockRound(recorded + add), status = total === po.qty ? 'ok' : 'mismatch';
    // 예전 방식으로 기록된 입고(줄 없음)는 먼저 한 줄로 옮겨 recv_qty = 줄 합을 지킨다.
    if (!active.length && recorded) cmds.push({ sql: 'INSERT INTO po_receipt_lots(po_id,lot,qty,received_date,note,created_by) VALUES(?,?,?,?,?,?)', args: [poId, po.lot || '', recorded, (po.recv_at || '').slice(0, 10) || date, '이전 입고', po.recv_by || ''] });
    for (const l of group) { const tp = tempPieces(l, po.item_category); cmds.push({ sql: `INSERT INTO po_receipt_lots(po_id,receipt_id,lot,sub_lot,qty,received_date,warehouse,location,note,created_by,note2,pieces,pieces_temp) VALUES(?,${RID},?,?,?,?,?,?,?,?,?,${tp.pieces == null ? 'NULL' : Number(tp.pieces)},${tp.temp})`, args: [poId, token, l.lot, l.sub_lot || '', l.qty, date, l.warehouse, l.location, l.note, user.name, l.note2 || ''] }); }
    const keepPoLot = !active.length && (recorded || !group.some(l => l.lot)); // 예전 입고를 옮기거나, 이번 줄에 LOT가 없으면 발주의 LOT 유지(15.77)
    const lots = [...new Set([...active.map(a => a.lot), ...(keepPoLot ? [po.lot] : []), ...group.map(l => l.lot)].filter(Boolean))].join(', ').slice(0, 100);
    cmds.push({ sql: `UPDATE purchase_orders SET recv_status=?,recv_qty=?,recv_by=?,recv_at=CASE WHEN recv_at IS NULL OR recv_status NOT IN ('ok','mismatch') OR recv_at<? THEN ? ELSE recv_at END,lot=? WHERE id=? AND recv_status=? AND recv_qty IS ? AND NOT EXISTS(SELECT 1 FROM receipt_qty_changes c WHERE c.po_id=purchase_orders.id AND c.status='pending')`, args: [status, total, user.name, at, at, lots, poId, po.recv_status, po.recv_qty] });
    cmds.push(RC_GUARD);
    const text = `${label[po.recv_status] ?? po.recv_status} → ${status === 'mismatch' && total < po.qty ? '부분 입고' : label[status]} · 이번 ${add} (누계 ${total} / 발주 ${po.qty}) · ${group.map(l => `${l.lot || 'LOT 없음'} ${l.qty}`).join(', ')}`;
    cmds.push({ sql: `INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) SELECT 'purchase_order',?,'[입고 처리] ' || receipt_no || ' · ' || ?,?,? FROM receipts WHERE request_id=?`, args: [poId, text, user.id, user.name, token] });
    if (['ok', 'mismatch'].includes(po.recv_status)) cmds.push({ sql: `INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) SELECT 'request',q.id,'[추가 입고] ' || r.receipt_no || ' · ' || ?,?,? FROM requests q, receipts r WHERE q.source_type='purchase_order' AND q.source_id=? AND r.request_id=?`, args: [text, user.id, user.name, poId, token] });
    else cmds.push(receiptAnalysisQuery('purchase_order', poId, user));
  }
  if (otherLines.length) await ensureVendor(vendor, user, 'purchase');
  for (const l of otherLines) {
    let fields;
    try { fields = await otherReceiptFields({ ...l.raw, received_date: date, vendor, note: l.note || note, qty: l.qty }); }
    catch (error) { if (error.status === 400 || error.status === 404) throw bad(`${l.no}번째 줄: ${error.message}`); throw error; }
    const snapshot = JSON.parse(fields[7]);
    const tp = tempPieces(l, fields[2]);
    cmds.push({ sql: `INSERT INTO other_receipts(received_date,item,item_category,qty,vendor,note,bom_id,bom_snapshot,created_by,spec,unit,lot,batch_id,receipt_id,warehouse,location,sub_lot,note2,pieces,pieces_temp) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,${RID},?,?,?,?,${tp.pieces == null ? 'NULL' : Number(tp.pieces)},${tp.temp})`,
      args: [...fields, user.name, await catalogSpec(fields[6], l.raw.spec), snapshot.unit || '', l.lot, token, token, l.warehouse, l.location, l.sub_lot || '', l.note2 || ''] });
    cmds.push(receiptAnalysisQuery('other_receipt', null, user));
  }
  cmds.push(...sstGuard([...[...poLines.values()].flat(), ...otherLines].filter(l => l.temp_lot).map(l => l.lot))); // 15.254
  try { await db.batch(cmds); }
  catch (error) {
    const saved = await db.prepare('SELECT * FROM receipts WHERE request_id=?').get(token);
    if (saved) return replay(saved);
    if (/integer overflow/i.test(String(error?.message || ''))) throw lotDupError(error);
    if (isGuardError(error)) throw new HttpError(409, '다른 곳에서 같은 발주의 입고가 먼저 처리되었습니다. 발주 목록을 새로 불러와 다시 확인하세요.');
    throw error;
  }
  return receiptDetail(await db.prepare('SELECT * FROM receipts WHERE request_id=?').get(token));
});
// ── 15.234 기타입고 내역(머리) → 상세(줄): 입고번호 OTS_[입고일 YYMMDD]_[순번 4자리]를 먼저 만들고, 줄은 나중에 담는다 ──
const canReceive = user => !!user.is_admin || hasRole(user, 'logistics') || hasRole(user, 'purchase');
const isOtherHead = r => /^OTS_/.test(r.receipt_no);
route('POST', '/api/receipts/other', async ({ user, body }) => {
  if (!canReceive(user)) throw new HttpError(403, '기타입고는 물류·구매 담당자나 관리자가 합니다.');
  const token = reqToken(body);
  const prior = await db.prepare('SELECT * FROM receipts WHERE request_id=?').get(token); if (prior) { if (prior.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 등록 요청입니다.'); return { ...await receiptDetail(prior), duplicate: true }; }
  const date = dateStr(body.receipt_date || today(), '입고일'); if (date > today()) throw bad('입고일은 오늘 이전으로 선택하세요.');
  const vendor = reqStr(body.vendor, '거래처(협력사)', 100), note = str(body.note, 500);
  await ensureVendor(vendor, user, 'purchase');
  const ymd = date.slice(2).replace(/-/g, '');
  try { await db.prepare("INSERT INTO receipts(receipt_no,receipt_date,vendor,note,created_by,created_by_id,request_id) VALUES((SELECT 'OTS_' || ? || '_' || printf('%04d', COALESCE(MAX(CAST(substr(receipt_no, 12) AS INTEGER)), 0) + 1) FROM receipts WHERE substr(receipt_no, 1, 4)='OTS_' AND substr(receipt_no, 12) NOT GLOB '*[^0-9]*'),?,?,?,?,?,?)").run(ymd, date, vendor, note, user.name, user.id, token); }
  catch (error) { const saved = await db.prepare('SELECT * FROM receipts WHERE request_id=?').get(token); if (saved) return receiptDetail(saved); if (/UNIQUE/i.test(String(error?.message))) throw new HttpError(409, '그 사이 같은 입고번호가 만들어졌습니다. 다시 눌러 주세요.'); throw error; }
  return receiptDetail(await db.prepare('SELECT * FROM receipts WHERE request_id=?').get(token));
});
// 머리 고치기: 비고는 언제나, 입고일·거래처는 줄이 없을 때만(줄이 있으면 재고·매입 날짜가 바뀌므로 줄을 지우고 다시).
route('PUT', '/api/receipts/:id', async ({ user, params, body }) => {
  if (!canReceive(user)) throw new HttpError(403, '기타입고는 물류·구매 담당자나 관리자가 합니다.');
  const r = await mustGet('receipts', params.id);
  const n = (await db.prepare('SELECT (SELECT COUNT(*) FROM po_receipt_lots WHERE receipt_id=?) + (SELECT COUNT(*) FROM other_receipts WHERE receipt_id=?) AS n').get(r.id, r.id)).n;
  const date = body.receipt_date === undefined ? r.receipt_date : dateStr(body.receipt_date, '입고일'), vendor = body.vendor === undefined ? r.vendor : reqStr(body.vendor, '거래처(협력사)', 100), note = body.note === undefined ? r.note : str(body.note, 500);
  if (n && (date !== r.receipt_date || nameKey(vendor) !== nameKey(r.vendor))) throw bad('품목이 담긴 입고는 입고일·거래처를 바꿀 수 없습니다(비고만). 바꾸려면 상세 줄을 지운 뒤 고치세요.');
  if (date > today()) throw bad('입고일은 오늘 이전으로 선택하세요.');
  if (vendor !== r.vendor) await ensureVendor(vendor, user, 'purchase');
  await db.prepare('UPDATE receipts SET receipt_date=?,vendor=?,note=? WHERE id=?').run(date, vendor, note, r.id);
  return receiptDetail(await mustGet('receipts', r.id));
});
route('DELETE', '/api/receipts/:id', async ({ user, params }) => {
  if (!canReceive(user)) throw new HttpError(403, '기타입고는 물류·구매 담당자나 관리자가 합니다.');
  const r = await mustGet('receipts', params.id);
  const res = await db.prepare('DELETE FROM receipts WHERE id=? AND NOT EXISTS(SELECT 1 FROM po_receipt_lots WHERE receipt_id=?) AND NOT EXISTS(SELECT 1 FROM other_receipts WHERE receipt_id=?)').run(r.id, r.id, r.id);
  if (!res.changes) throw bad(`${r.receipt_no}에 상세 줄이 있습니다. 줄을 먼저 지우세요.`);
  return { ok: true };
});
// 상세 줄 담기(기타입고): 같은 LOT끼리 서브 번호 001·002…, 줄마다 창고·위치. 입고일·거래처는 머리 것.
route('POST', '/api/receipts/:id/lines', async ({ user, params, body }) => {
  if (!canReceive(user)) throw new HttpError(403, '기타입고는 물류·구매 담당자나 관리자가 합니다.');
  const r = await mustGet('receipts', params.id); const token = reqToken(body);
  if (await db.prepare('SELECT 1 FROM other_receipts WHERE batch_id=? LIMIT 1').get(token)) return receiptDetail(r);
  const raw = Array.isArray(body.lines) ? body.lines : []; if (!raw.length || raw.length > 100) throw bad('담을 줄은 1~100줄입니다.');
  const rules = await warehouseRules(), lines = [];
  for (const [i, x] of raw.entries()) { const l = x && typeof x === 'object' ? x : {}; try { const qty = num(l.qty, '입하수량'); if (!(qty > 0)) throw bad('입하수량은 0보다 커야 합니다.'); lines.push({ raw: l, qty, pieces: piecesOf(l.pieces), lot: str(l.lot, 100), note: str(l.note, 200), note2: str(l.note2, 200), ...rules.check(l.warehouse, l.location), no: i + 1 }); } catch (error) { if (error.status === 400 || error.status === 404) throw bad(`${i + 1}번째 줄: ${error.message}`); throw error; } }
  await fillSstLots(r.receipt_date, lines); // 15.249 업체 LOT 없으면 임시 SST LOT
  const subNext = new Map();
  for (const l of lines) { if (!l.lot) continue; if (!subNext.has(l.lot)) subNext.set(l.lot, (await db.prepare("SELECT MAX(n) AS n FROM (SELECT CAST(sub_lot AS INTEGER) AS n FROM po_receipt_lots WHERE lot=? AND voided_at IS NULL UNION ALL SELECT CAST(sub_lot AS INTEGER) FROM other_receipts WHERE lot=?)").get(l.lot, l.lot)).n || 0); const n = subNext.get(l.lot) + 1; subNext.set(l.lot, n); l.sub_lot = String(n).padStart(3, '0'); }
  const cmds = [];
  for (const l of lines) {
    let fields; try { fields = await otherReceiptFields({ ...l.raw, received_date: r.receipt_date, vendor: r.vendor, note: l.note, qty: l.qty }); } catch (error) { if (error.status === 400 || error.status === 404) throw bad(`${l.no}번째 줄: ${error.message}`); throw error; }
    const snapshot = JSON.parse(fields[7]);
    const tp = tempPieces(l, fields[2]);
    cmds.push({ sql: 'INSERT INTO other_receipts(received_date,item,item_category,qty,vendor,note,bom_id,bom_snapshot,created_by,spec,unit,lot,batch_id,receipt_id,warehouse,location,sub_lot,note2,pieces,pieces_temp) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      args: [...fields, user.name, await catalogSpec(fields[6], l.raw.spec), snapshot.unit || '', l.lot, token, r.id, l.warehouse, l.location, l.sub_lot || '', l.note2, tp.pieces, tp.temp] });
    cmds.push(receiptAnalysisQuery('other_receipt', null, user));
  }
  cmds.push(...sstGuard(lines.filter(l => l.temp_lot).map(l => l.lot))); // 15.254
  try { await db.batch(cmds); } catch (error) { throw lotDupError(error); }
  return receiptDetail(r);
});
// 상세 줄 LOT·창고·로케이션·비고·업체정보 고치기. LOT은 출하·생산 투입에 쓰이지 않았을 때만(바꾸면 서브 번호를 그 LOT 다음으로).
route('PUT', '/api/other-receipts/:id/place', async ({ user, params, body }) => {
  if (!canReceive(user)) throw new HttpError(403, '기타입고는 물류·구매 담당자나 관리자가 합니다.');
  const row = await mustGet('other_receipts', params.id); const rules = await warehouseRules();
  const lot = body.lot === undefined ? row.lot : str(body.lot, 100), place = rules.check(body.warehouse === undefined ? row.warehouse : body.warehouse, body.location === undefined ? row.location : body.location);
  let sub = row.sub_lot;
  if (lot !== row.lot) {
    const u = await lotUsage(row.item, row.lot); if (u) throw new HttpError(409, lotUsedMessage(row.item, row.lot, u));
    if (await db.prepare('SELECT 1 FROM stock_transfers WHERE status=\'confirmed\' AND item=? AND lot=?').get(row.item, row.lot)) throw new HttpError(409, `${row.item}: LOT ${row.lot}은 창고 이동 기록이 있어 바꿀 수 없습니다.`);
    sub = lot ? String(((await db.prepare("SELECT MAX(n) AS n FROM (SELECT CAST(sub_lot AS INTEGER) AS n FROM po_receipt_lots WHERE lot=? AND voided_at IS NULL UNION ALL SELECT CAST(sub_lot AS INTEGER) FROM other_receipts WHERE lot=? AND id<>?)").get(lot, lot, row.id)).n || 0) + 1).padStart(3, '0') : '';
  }
  await db.prepare('UPDATE other_receipts SET lot=?,sub_lot=?,warehouse=?,location=?,note=?,note2=? WHERE id=?').run(lot, sub, place.warehouse, place.location, body.note === undefined ? row.note : str(body.note, 200), body.note2 === undefined ? row.note2 || '' : str(body.note2, 200), row.id);
  return mustGet('other_receipts', row.id);
});
// 창고·위치(15.72): 조회는 로그인 사용자, 등록·수정은 물류팀장·관리자. 삭제 없이 사용 중지만 한다.
route('GET', '/api/warehouses', async ({ query }) => db.prepare(`SELECT * FROM warehouses ${query.all === '1' ? '' : 'WHERE active=1'} ORDER BY sort, name`).all());
function warehouseFields(body) {
  const name = reqStr(body.name, '창고 이름', 50); if (name.includes(',')) throw bad('창고 이름에는 쉼표(,)를 쓸 수 없습니다.');
  const locations = [...new Set(String(body.locations || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean))];
  if (locations.length > 200) throw bad('위치는 200개까지 넣을 수 있습니다.');
  if (locations.some(x => x.length > 50)) throw bad('위치 이름은 50자 이하로 넣으세요.');
  return { name, locations: locations.join(','), sort: Number.isSafeInteger(Number(body.sort)) ? Number(body.sort) : 0 };
}
route('POST', '/api/warehouses', async ({ user, body }) => {
  if (!canAdjustStock(user)) throw new HttpError(403, '창고는 물류팀장·관리자가 등록합니다.');
  const f = warehouseFields(body);
  if (await db.prepare('SELECT 1 FROM warehouses WHERE name=?').get(f.name)) throw new HttpError(409, '같은 이름의 창고가 있습니다.');
  let r; try { r = await db.prepare('INSERT INTO warehouses(name,locations,sort) VALUES(?,?,?)').run(f.name, f.locations, f.sort); }
  catch (error) { if (/UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '같은 이름의 창고가 있습니다.'); throw error; } // 15.209
  return mustGet('warehouses', r.lastInsertRowid);
});
// 15.104 창고 삭제: 그 창고 이름으로 저장된 입고 LOT·기타입고가 하나도 없을 때만. 있으면 사용 중지로 안내.
route('DELETE', '/api/warehouses/:id', async ({ user, params }) => {
  if (!canAdjustStock(user)) throw new HttpError(403, '창고는 물류팀장·관리자가 지웁니다.');
  const row = await mustGet('warehouses', params.id);
  const lots = (await db.prepare('SELECT COUNT(*) c FROM po_receipt_lots WHERE warehouse=?').get(row.name)).c;
  const others = (await db.prepare('SELECT COUNT(*) c FROM other_receipts WHERE warehouse=?').get(row.name)).c;
  const moves = (await db.prepare('SELECT COUNT(*) c FROM stock_transfers WHERE to_warehouse=?').get(row.name)).c + (await db.prepare('SELECT COUNT(*) c FROM stock_adjustments WHERE warehouse=?').get(row.name)).c; // 15.266 조정 기록도
  if (lots || others || moves) throw new HttpError(409, `${row.name}: 입고·이동 기록 ${lots + others + moves}건이 이 창고에 있어 지울 수 없습니다. 「사용」을 끄면 입력 화면에서만 빠집니다.`);
  const r = await db.prepare('DELETE FROM warehouses WHERE id=? AND NOT EXISTS(SELECT 1 FROM po_receipt_lots WHERE warehouse=?) AND NOT EXISTS(SELECT 1 FROM other_receipts WHERE warehouse=?) AND NOT EXISTS(SELECT 1 FROM stock_transfers WHERE to_warehouse=?)').run(row.id, row.name, row.name, row.name);
  if (!r.changes) throw new HttpError(409, '그 사이 이 창고로 입고가 기록되어 지울 수 없습니다.');
  return { ok: true };
});
route('PUT', '/api/warehouses/:id', async ({ user, params, body }) => {
  if (!canAdjustStock(user)) throw new HttpError(403, '창고는 물류팀장·관리자가 고칩니다.');
  const row = await mustGet('warehouses', params.id);
  // 15.266 위치 이름 바꾸기: [{ from, to }] — 기록이 있는 위치도 바꿀 수 있고, 그 위치의 입고·이동·조정 기록도 함께 바뀐다
  const renames = (Array.isArray(body.rename_locations) ? body.rename_locations : []).map(x => ({ from: str(x?.from, 50), to: str(x?.to, 50) })).filter(x => x.from && x.to && x.from !== x.to);
  if (renames.length > 50) throw bad('위치 이름은 한 번에 50개까지 바꿀 수 있습니다.');
  let locs = body.locations === undefined ? row.locations : body.locations;
  if (renames.length) { const cur = String(locs || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean); for (const r of renames) { if (!cur.includes(r.from)) throw bad(`${row.name}: 「${r.from}」 위치가 없습니다.`); if (cur.includes(r.to)) throw bad(`${row.name}: 「${r.to}」 위치가 이미 있습니다.`); cur[cur.indexOf(r.from)] = r.to; } locs = cur.join(','); }
  const f = warehouseFields({ name: row.name, sort: row.sort, ...body, locations: locs });
  const clash = await db.prepare('SELECT id FROM warehouses WHERE name=?').get(f.name); if (clash && clash.id !== row.id) throw new HttpError(409, '같은 이름의 창고가 있습니다.');
  const active = body.active === undefined ? row.active : body.active ? 1 : 0;
  { // 15.209 입고·이동 기록이 있는 위치는 목록에서 지우지 못함(그 위치 재고가 「없는 위치」가 됨)
    const keep = new Set(f.locations ? f.locations.split(',') : []), moved = new Set(renames.map(r => r.from)), gone = (row.locations ? row.locations.split(',') : []).filter(x => !keep.has(x) && !moved.has(x));
    for (const loc of gone) {
      const used = await db.prepare("SELECT (SELECT COUNT(*) FROM po_receipt_lots WHERE warehouse=? AND location=?) + (SELECT COUNT(*) FROM other_receipts WHERE warehouse=? AND location=?) + (SELECT COUNT(*) FROM stock_transfers WHERE to_warehouse=? AND to_location=? AND status='confirmed') AS n").get(row.name, loc, row.name, loc, row.name, loc);
      if (used.n) throw new HttpError(409, `${row.name} ${loc}: 입고·이동 기록 ${used.n}건이 있는 위치라 지울 수 없습니다. 재고를 다른 위치로 옮긴 뒤 지우세요.`);
    }
  }
  // 이름을 바꾸면 기록에 남은 창고 이름도 함께 바꾼다. 15.266 이동(도착·출발 위치 글자)·재고 조정도 함께, 위치 이름 바꾸기도 함께.
  const W = row.name, N = f.name, cmds = [
    { sql: 'UPDATE warehouses SET name=?,locations=?,sort=?,active=? WHERE id=?', args: [N, f.locations, f.sort, active, row.id] },
    { sql: 'UPDATE po_receipt_lots SET warehouse=? WHERE warehouse=?', args: [N, W] },
    { sql: 'UPDATE other_receipts SET warehouse=? WHERE warehouse=?', args: [N, W] },
    { sql: "UPDATE stock_transfers SET to_warehouse=?, to_place=TRIM(? || ' ' || COALESCE(to_location,'')) WHERE to_warehouse=?", args: [N, N, W] },
    { sql: "UPDATE stock_transfers SET from_place=? || substr(from_place, length(?) + 1) WHERE from_place=? OR substr(from_place, 1, length(?) + 1)=? || ' '", args: [N, W, W, W, W] },
    { sql: 'UPDATE stock_adjustments SET warehouse=? WHERE warehouse=?', args: [N, W] }];
  for (const r of renames) cmds.push(
    { sql: 'UPDATE po_receipt_lots SET location=? WHERE warehouse=? AND location=?', args: [r.to, N, r.from] },
    { sql: 'UPDATE other_receipts SET location=? WHERE warehouse=? AND location=?', args: [r.to, N, r.from] },
    { sql: "UPDATE stock_transfers SET to_location=?, to_place=TRIM(to_warehouse || ' ' || ?) WHERE to_warehouse=? AND to_location=?", args: [r.to, r.to, N, r.from] },
    { sql: "UPDATE stock_transfers SET from_place=TRIM(? || ' ' || ?) WHERE from_place=TRIM(? || ' ' || ?)", args: [N, r.to, N, r.from] },
    { sql: 'UPDATE stock_adjustments SET location=? WHERE warehouse=? AND location=?', args: [r.to, N, r.from] });
  try { await db.batch(cmds); } catch (error) { if (/UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '같은 이름의 창고가 있습니다.'); throw error; }
  return mustGet('warehouses', row.id);
});

// ── 구매: 매입전표·매입 마감 (15.80) ──
// 공급사 거래명세서 한 장을 받으면, 그 거래처의 전표가 아직 없는 입고 줄(발주입고 LOT 줄·예전 발주입고·기타입고)을 골라
// 단가를 확정해 매입전표(PB-…)를 만든다. 금액은 원 미만 절사, 부가세는 공급가액 합계의 10%(영세·면세는 0).
// 같은 입고 줄은 유효한 전표 하나에만 들어간다(부분 UNIQUE 인덱스). 거래처·월 마감 뒤에는 그 달 전표를 만들거나 취소할 수 없다.
// 이 입고 줄에서 유효한 전표가 이미 잡은 수량
// LOT 줄 전환 때 생긴 「이전 입고」 LOT는 그 발주의 예전 'po' 전표 줄과 같은 수량이므로 둘을 합쳐 센다.
const PREV_LOT = "(l.note='이전 입고' AND l.receipt_id IS NULL)"; // 15.90: 입고 번호 없이 시스템이 옮긴 줄만(사용자 비고와 구분)
function lotBilled() { return `(SELECT COALESCE(SUM(b.qty),0) FROM purchase_bill_lines b WHERE b.active=1 AND ((b.source_type='po_lot' AND b.source_id=l.id) OR (${PREV_LOT} AND b.source_type='po' AND b.source_id=p.id)))`; }
// 15.90 발주 전체로 아직 전표에 안 잡은 실입고 수량(수량 수정으로 줄어든 것 포함). LOT 줄은 이 값보다 많이 잡을 수 없다.
const PO_OPEN = "(p.recv_qty - (SELECT COALESCE(SUM(x.qty),0) FROM purchase_bill_lines x WHERE x.active=1 AND x.po_id=p.id))";
function billedOf(type, key) { return `(SELECT COALESCE(SUM(b.qty),0) FROM purchase_bill_lines b WHERE b.source_type='${type}' AND b.source_id=${key} AND b.active=1)`; }
// 이 거래처에서 같은 품목(코드, 없으면 이름)을 마지막으로 산 단가
function lastBought(a) { return `(SELECT x.unit_price FROM purchase_bill_lines x JOIN purchase_bills pb ON pb.id=x.bill_id WHERE x.active=1 AND REPLACE(LOWER(pb.vendor),' ','')=REPLACE(LOWER(${a}.vendor),' ','') AND (CASE WHEN COALESCE(${a === 'o' ? "json_extract(o.bom_snapshot,'$.product_code')" : 'p.product_code'},'')<>'' THEN x.product_code=${a === 'o' ? "json_extract(o.bom_snapshot,'$.product_code')" : 'p.product_code'} ELSE x.item=${a}.item END) ORDER BY pb.bill_date DESC, x.id DESC LIMIT 1)`; }
// 15.117 전표 줄 분류: 저장 때 item_category에 고정. 빈 예전 줄은 제품코드로 품목 분류를 읽는다(LINE_CAT).
const CODE_CAT = c => `(SELECT bm.item_category FROM boms bm WHERE ${c}<>'' AND UPPER(bm.product_code)=UPPER(${c}) ORDER BY bm.is_temp, bm.id DESC LIMIT 1)`;
const LINE_CAT = a => `COALESCE(NULLIF(${a}.item_category,''), ${CODE_CAT(a + '.product_code')}, '')`;
async function lineCategory({ given = '', bom_id = null, product_code = '', item = '' }) {
  if (ITEM_CATEGORIES.includes(given)) return given;
  const byId = bom_id ? await db.prepare('SELECT item_category FROM boms WHERE id=?').get(bom_id) : null; if (byId?.item_category) return byId.item_category;
  const code = String(product_code || '').trim();
  const byCode = code ? await db.prepare("SELECT item_category FROM boms WHERE product_code<>'' AND UPPER(product_code)=UPPER(?) ORDER BY is_temp, id DESC LIMIT 1").get(code) : null; if (byCode?.item_category) return byCode.item_category;
  const byName = item ? await db.prepare("SELECT item_category FROM boms WHERE REPLACE(LOWER(product),' ','')=? ORDER BY is_temp, id DESC LIMIT 1").get(nameKey(item)) : null;
  return byName?.item_category || '';
}
const BILL_CATEGORY_FILTER = (lines, bills) => `EXISTS(SELECT 1 FROM ${lines} l WHERE l.bill_id=${bills}.id AND ${LINE_CAT('l')}=?)`;
async function billCategoryTotals(lines, bills, where, args) {
  const rows = await db.prepare(`SELECT ${LINE_CAT('l')} AS category, COUNT(*) AS lines, SUM(l.supply) AS supply FROM ${lines} l WHERE l.active=1 AND l.bill_id IN (SELECT id FROM ${bills} WHERE status='confirmed'${where.length ? ' AND ' + where.join(' AND ') : ''}) GROUP BY 1`).all(...args);
  const order = [...ITEM_CATEGORIES, ''];
  return rows.map(r => ({ category: r.category || '', lines: r.lines, supply: r.supply || 0 })).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
}
const BILL_SOURCES = {
  po_lot: `SELECT 'po_lot' AS source_type, l.id AS source_id, p.id AS po_id, p.req_no, p.vendor, p.item, p.spec, p.unit, p.product_code, l.lot, l.received_date, l.qty, p.unit_price, COALESCE(NULLIF(p.item_category,''), ${CODE_CAT('p.product_code')}, '') AS item_category, p.internal_note, l.note AS lot_note, CASE WHEN ${PREV_LOT} THEN 1 ELSE 0 END AS is_prev, ${PO_OPEN} AS po_open,
      p.qty AS po_qty, p.recv_qty AS po_recv_qty, substr(p.created_at,1,10) AS po_date, p.note AS po_note, p.batch_id AS po_batch, ${lotBilled()} AS billed_qty, ${lastBought('p')} AS last_price
    FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id
    WHERE l.voided_at IS NULL AND l.qty > 0 AND p.recv_status IN ('ok','mismatch')`,
  po: `SELECT 'po' AS source_type, p.id AS source_id, p.id AS po_id, p.req_no, p.vendor, p.item, p.spec, p.unit, p.product_code, p.lot, COALESCE(substr(p.recv_at,1,10), p.due_date) AS received_date, p.recv_qty AS qty, p.unit_price, COALESCE(NULLIF(p.item_category,''), ${CODE_CAT('p.product_code')}, '') AS item_category, p.internal_note, '' AS lot_note, 0 AS is_prev, ${PO_OPEN} AS po_open,
      p.qty AS po_qty, p.recv_qty AS po_recv_qty, substr(p.created_at,1,10) AS po_date, p.note AS po_note, p.batch_id AS po_batch, ${billedOf('po', 'p.id')} AS billed_qty, ${lastBought('p')} AS last_price
    FROM purchase_orders p WHERE p.recv_status IN ('ok','mismatch') AND p.recv_qty IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM po_receipt_lots l WHERE l.po_id=p.id AND l.voided_at IS NULL)`,
  other: `SELECT 'other' AS source_type, o.id AS source_id, NULL AS po_id, '' AS req_no, o.vendor, o.item, o.spec, COALESCE(NULLIF(o.unit,''), json_extract(o.bom_snapshot,'$.unit'), '') AS unit, COALESCE(json_extract(o.bom_snapshot,'$.product_code'), '') AS product_code, o.lot, o.received_date, o.qty, NULL AS unit_price, '' AS internal_note, '' AS lot_note, 0 AS is_prev, NULL AS po_open,
      COALESCE(NULLIF(o.item_category,''), json_extract(o.bom_snapshot,'$.item_category'), '') AS item_category, NULL AS po_qty, NULL AS po_recv_qty, NULL AS po_date, o.note AS po_note, '' AS po_batch, ${billedOf('other', 'o.id')} AS billed_qty, ${lastBought('o')} AS last_price
    FROM other_receipts o WHERE 1=1`,
};
const BILL_SOURCE_KEY = { po_lot: 'l.id', po: 'p.id', other: 'o.id' };
const BILL_SOURCE_QTY = { po_lot: 'l.qty', po: 'p.recv_qty', other: 'o.qty' };
const billVendorKey = v => `REPLACE(LOWER(${v}),' ','')`;
// 입고 줄은 「전표에 잡은 수량 합 < 입고 수량」이면 아직 열려 있다(15.82: 나눠 잡기).
const unbilled = type => `${type === 'po_lot' ? lotBilled() : billedOf(type, BILL_SOURCE_KEY[type])} < ${BILL_SOURCE_QTY[type]} - 0.000001${type === 'other' ? '' : ` AND ${PO_OPEN} > 0.000001`}`;
const billTrunc = n => Math.trunc(Math.round(n * 1000) / 1000);
const requirePurchase = user => { if (!hasRole(user, 'purchase')) throw new HttpError(403, '매입전표는 구매 담당자가 처리합니다.'); };
async function closedPeriod(vendor, date) {
  return db.prepare("SELECT * FROM purchase_closings WHERE period=? AND vendor_key=? AND status='closed'").get(String(date).slice(0, 7), nameKey(vendor));
}
// 전표가 아직 없는 입고 줄. vendor를 주면 그 거래처만, from/to는 입고일.
async function unbilledLines({ vendor = '', from = '', to = '', limit = 500 } = {}) {
  const out = [];
  for (const type of Object.keys(BILL_SOURCES)) {
    const where = [unbilled(type)], args = [];
    const alias = type === 'other' ? 'o' : 'p', date = type === 'po_lot' ? 'l.received_date' : type === 'po' ? 'COALESCE(substr(p.recv_at,1,10), p.due_date)' : 'o.received_date';
    if (vendor) { where.push(`${billVendorKey(alias + '.vendor')}=?`); args.push(nameKey(vendor)); }
    if (from) { where.push(`${date}>=?`); args.push(from); }
    if (to) { where.push(`${date}<=?`); args.push(to); }
    out.push(...await db.prepare(`${BILL_SOURCES[type]} AND ${where.join(' AND ')} ORDER BY ${date}, ${BILL_SOURCE_KEY[type]} LIMIT ${limit + 1}`).all(...args));
  }
  out.sort((a, b) => stockCompare(a.received_date, b.received_date) || stockCompare(a.item, b.item));
  return out;
}
async function billDetail(bill) {
  const lines = await db.prepare(`SELECT l.*, ${LINE_CAT('l')} AS category FROM purchase_bill_lines l WHERE l.bill_id=? ORDER BY l.id`).all(bill.id);
  // 전표 뒤에 입고가 취소된 줄은 표시만(전표는 그대로 — 전표를 취소하고 다시 만든다)
  for (const l of lines) if (l.source_type === 'po_lot') l.source_voided = !!(await db.prepare('SELECT 1 FROM po_receipt_lots WHERE id=? AND voided_at IS NOT NULL').get(l.source_id));
  const invoice = await db.prepare("SELECT i.id, i.invoice_no FROM purchase_tax_invoice_bills t JOIN purchase_tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1 AND i.status='received'").get(bill.id);
  const ret = await db.prepare("SELECT id, return_no FROM stock_returns WHERE side='out' AND bill_id=? AND status='confirmed'").get(bill.id);
  const changes = await db.prepare("SELECT summary, changed_by, changed_at FROM doc_changes WHERE doc_type='purchase_bill' AND doc_id=? ORDER BY id DESC LIMIT 20").all(bill.id);
  return { ...bill, lines, closed: !!(await closedPeriod(bill.vendor, bill.bill_date)), invoice: invoice || null, return_ref: ret || null, changes };
}
route('GET', '/api/purchase-bills/unbilled', async ({ user, query }) => {
  requirePurchase(user);
  const from = query.from ? dateStr(query.from, '시작일') : '', to = query.to ? dateStr(query.to, '종료일') : '';
  const rows = await unbilledLines({ vendor: str(query.vendor, 100), from, to });
  return { rows: rows.slice(0, 500), more: rows.length > 500 };
});
// 거래처별 「입고됐는데 전표 없음」 요약(마감·할 일용)
route('GET', '/api/purchase-bills/unbilled-summary', async ({ user, query }) => {
  requirePurchase(user);
  const from = query.from ? dateStr(query.from, '시작일') : '', to = query.to ? dateStr(query.to, '종료일') : '';
  const rows = await unbilledLines({ from, to, limit: 5000 });
  const map = new Map();
  for (const r of rows) { const key = nameKey(r.vendor), g = map.get(key) || { vendor: r.vendor, lines: 0, first_date: r.received_date, estimate: 0, unpriced: 0 }; g.lines++; if (r.unit_price == null) g.unpriced++; else g.estimate += billTrunc((r.qty - r.billed_qty) * r.unit_price); if (stockCompare(r.received_date, g.first_date) < 0) g.first_date = r.received_date; map.set(key, g); }
  return [...map.values()].sort((a, b) => stockCompare(a.first_date, b.first_date));
});
route('GET', '/api/purchase-bills', async ({ user, query }) => {
  requirePurchase(user);
  const where = [], args = [];
  applyListDates(where, args, query, 'bill_date');
  if (query.vendor) { if (query.party_like === '1') { where.push(`${billVendorKey('vendor')} LIKE ? ESCAPE '\\'`); args.push('%' + nameKey(str(query.vendor, 100)).replace(/[\\%_]/g, m => '\\' + m) + '%'); } else { where.push(`${billVendorKey('vendor')}=?`); args.push(nameKey(str(query.vendor, 100))); } } // 15.232 일부일치(달력)
  if (query.status) { if (!['confirmed', 'cancelled'].includes(query.status)) throw bad('상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  applyListKeyword(where, args, query.q, ['bill_no', 'vendor', 'statement_no', 'note', 'created_by']);
  if (query.category) { const c = query.category === '미분류' ? '' : itemCategory(query.category); where.push(BILL_CATEGORY_FILTER('purchase_bill_lines', 'purchase_bills')); args.push(c); }
  const page = Math.max(0, Math.min(1000, Number(query.page) || 0));
  const by_category = await billCategoryTotals('purchase_bill_lines', 'purchase_bills', where, args);
  const rows = await db.prepare(`SELECT purchase_bills.*, (SELECT return_no || '|' || id FROM stock_returns WHERE side='out' AND bill_id=purchase_bills.id AND status='confirmed') AS return_ref, (SELECT COUNT(*) FROM purchase_bill_lines l WHERE l.bill_id=purchase_bills.id) AS line_count, (SELECT i.invoice_no || '|' || i.approval_no || '|' || i.id FROM purchase_tax_invoice_bills t JOIN purchase_tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=purchase_bills.id AND t.active=1 AND i.status='received') AS invoice, (SELECT group_concat(DISTINCT c) FROM (SELECT ${LINE_CAT('l')} AS c FROM purchase_bill_lines l WHERE l.bill_id=purchase_bills.id AND l.active=1)) AS categories FROM purchase_bills ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY bill_date DESC, id DESC LIMIT 201 OFFSET ?`).all(...args, page * 200);
  return { rows: rows.slice(0, 200), page, more: rows.length > 200, by_category };
});
route('GET', '/api/purchase-bills/:id', async ({ user, params }) => { requirePurchase(user); return billDetail(await mustGet('purchase_bills', params.id)); });
route('POST', '/api/purchase-bills', async ({ user, body }) => {
  requirePurchase(user);
  const token = String(body.request_id || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw bad('등록 요청 번호를 확인하세요.');
  const prior = await db.prepare('SELECT * FROM purchase_bills WHERE request_id=?').get(token);
  if (prior) { if (prior.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.'); return { ...await billDetail(prior), duplicate: true }; }
  const vendor = reqStr(body.vendor, '거래처', 100), date = dateStr(body.bill_date, '명세서 일자');
  if (date > today()) throw bad('명세서 일자는 오늘 이전으로 선택하세요.');
  if (await closedPeriod(vendor, date)) throw bad(`${vendor}의 ${date.slice(0, 7)} 매입은 마감되었습니다. 마감 취소(관리자) 뒤에 등록하세요.`);
  const taxType = body.tax_type === 'zero' ? 'zero' : 'taxable';
  const freight = body.freight === undefined || body.freight === '' || body.freight === null ? 0 : num(body.freight, '운송비');
  if (freight < 0) throw bad('운송비는 0 이상이어야 합니다.');
  const statementTotal = body.statement_total === undefined || body.statement_total === '' || body.statement_total === null ? null : num(body.statement_total, '명세서 합계');
  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length || input.length > 200) throw bad('전표 줄은 1~200줄 고르세요.');
  // 입고 줄은 서버에서 다시 읽는다(수량·품목은 입고 기록 그대로, 단가만 받음).
  const lines = [], seen = new Set();
  for (const [index, raw] of input.entries()) {
    const l = raw && typeof raw === 'object' ? raw : {}, no = `${index + 1}번째 줄`;
    const type = String(l.source_type || ''); if (!BILL_SOURCES[type]) throw bad(`${no}: 입고 구분을 확인하세요.`);
    const id = Number(l.source_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad(`${no}: 입고 줄을 다시 고르세요.`);
    const key = type + ':' + id; if (seen.has(key)) throw bad(`${no}: 같은 입고 줄이 두 번 들어 있습니다.`); seen.add(key);
    const src = await db.prepare(`${BILL_SOURCES[type]} AND ${BILL_SOURCE_KEY[type]}=? AND ${unbilled(type)}`).get(id);
    if (!src) throw new HttpError(409, `${no}: 이미 다른 전표에 들어갔거나 취소된 입고입니다. 목록을 새로 불러오세요.`);
    if (nameKey(src.vendor) !== nameKey(vendor)) throw bad(`${no}: 다른 거래처(${src.vendor})의 입고입니다.`);
    const price = l.unit_price === undefined || l.unit_price === '' || l.unit_price === null ? src.unit_price : num(l.unit_price, `${no} 단가`);
    if (price == null) throw bad(`${no}(${src.item}): 단가를 넣으세요.`);
    if (price < 0) throw bad(`${no}: 단가는 0 이상이어야 합니다.`);
    // 수량: 비우면 남은 수량(입고 − 이미 잡은 수량). 명세서와 다르면 고쳐 잡는다(덜 잡은 수량은 다음 전표에서).
    const remaining = stockRound(src.po_open == null ? src.qty - src.billed_qty : Math.min(src.qty - src.billed_qty, src.po_open));
    const qty = l.qty === undefined || l.qty === '' || l.qty === null ? remaining : num(l.qty, `${no} 수량`);
    if (!(qty > 0)) throw bad(`${no}(${src.item}): 수량은 0보다 커야 합니다.`);
    if (qty > remaining + 0.000001) throw bad(`${no}(${src.item}): 남은 입고 수량 ${remaining}보다 많이 잡을 수 없습니다. 명세서가 더 많으면 물류에서 입고 수량을 먼저 고치세요.`);
    if (src.po_id && await db.prepare("SELECT 1 FROM receipt_qty_changes WHERE po_id=? AND status='pending'").get(src.po_id)) throw new HttpError(409, `${no}(${src.item}): 입고 수정·취소 요청이 처리 중입니다. 승인·반려된 뒤에 전표를 잡으세요.`);
    lines.push({ ...src, item_category: await lineCategory({ given: src.item_category, product_code: src.product_code, item: src.item }), source_qty: src.qty, billed_before: src.billed_qty, qty, unit_price: price, supply: billTrunc(qty * price), note: str(l.note, 200) });
  }
  const supply = lines.reduce((t, l) => t + l.supply, 0) + billTrunc(freight);
  const vat = taxType === 'zero' ? 0 : billTrunc(supply * 0.1), total = supply + vat;
  const prefix = `PB-${today().slice(2).replace(/-/g, '')}-`, BID = '(SELECT id FROM purchase_bills WHERE request_id=?)';
  const cmds = [{ sql: `INSERT INTO purchase_bills(bill_no,bill_date,vendor,statement_no,statement_total,tax_type,freight,supply_total,vat_total,total,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('purchase_bills', 'bill_no')},?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [prefix, prefix, prefix, date, vendor, str(body.statement_no, 50), statementTotal, taxType, billTrunc(freight), supply, vat, total, str(body.note, 500), user.name, user.id, token] }];
  // 저장 순간 그 입고 줄의 「이미 잡은 수량」이 읽은 값과 같을 때만 넣는다(동시에 다른 전표가 잡으면 batch 전체 되돌림).
  for (const l of lines) cmds.push({ sql: `INSERT INTO purchase_bill_lines(bill_id,item_category,source_type,source_id,po_id,req_no,item,spec,unit,product_code,lot,received_date,qty,unit_price,supply,note,source_qty) SELECT ${BID},?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ROUND((SELECT COALESCE(SUM(qty),0) FROM purchase_bill_lines WHERE active=1 AND ((source_type=? AND source_id=?) OR (source_type='po' AND source_id=? AND ?=1))),6)=ROUND(?,6) AND (? IS NULL OR (SELECT COALESCE(SUM(qty),0) FROM purchase_bill_lines WHERE active=1 AND po_id=?) + ? <= (SELECT recv_qty FROM purchase_orders WHERE id=?) + 0.000001)`,
    args: [token, l.item_category || '', l.source_type, l.source_id, l.po_id, l.req_no || '', l.item, l.spec || '', l.unit || '', l.product_code || '', l.lot || '', l.received_date || '', l.qty, l.unit_price, l.supply, l.note, l.source_qty, l.source_type, l.source_id, l.po_id, l.is_prev ? 1 : 0, l.billed_before, l.po_id, l.po_id, l.qty, l.po_id] }, RC_GUARD);
  try { await db.batch(cmds); }
  catch (error) {
    const saved = await db.prepare('SELECT * FROM purchase_bills WHERE request_id=?').get(token);
    if (saved && saved.created_by_id === user.id) return { ...await billDetail(saved), duplicate: true };
    if (isGuardError(error) || /UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '그 사이 같은 입고 줄이 다른 전표에 들어갔습니다. 목록을 새로 불러와 다시 고르세요.');
    throw error;
  }
  return billDetail(await db.prepare('SELECT * FROM purchase_bills WHERE request_id=?').get(token));
});
route('POST', '/api/purchase-bills/:id/cancel', async ({ user, params, body }) => {
  requirePurchase(user);
  const bill = await mustGet('purchase_bills', params.id);
  if (bill.status !== 'confirmed') throw bad('이미 취소된 전표입니다.');
  const ret = await returnOfBill('out', bill.id); if (ret) throw bad(`반출 ${ret.return_no}로 생긴 전표입니다. 반출 목록에서 그 반출을 취소하세요.`);
  if (await closedPeriod(bill.vendor, bill.bill_date)) throw bad(`${bill.vendor}의 ${bill.bill_date.slice(0, 7)} 매입은 마감되었습니다. 마감 취소(관리자) 뒤에 취소하세요.`);
  const reason = reqStr(body.reason, '취소 사유', 200);
  const results = await db.batch([
    { sql: "UPDATE purchase_bill_lines SET active=0 WHERE bill_id=? AND EXISTS(SELECT 1 FROM purchase_bills WHERE id=? AND status='confirmed')", args: [bill.id, bill.id] },
    { sql: "UPDATE purchase_bills SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed'", args: [now(), user.name, reason, bill.id] },
  ]);
  if (!results.at(-1).meta.changes) throw new HttpError(409, '이미 처리된 전표입니다.');
  return billDetail(await mustGet('purchase_bills', bill.id));
});
// 매입 마감: 달(YYYY-MM)의 거래처별 전표 합계·미전표 입고, 마감 상태
function billPeriod(value) { const v = String(value || today().slice(0, 7)); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw bad('마감 월을 확인하세요(YYYY-MM).'); return v; }
const monthEnd = period => { const [y, m] = period.split('-').map(Number); return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
route('GET', '/api/purchase-closing', async ({ user, query }) => {
  requirePurchase(user);
  const period = billPeriod(query.period), from = period + '-01', to = monthEnd(period);
  const bills = await db.prepare("SELECT vendor, COUNT(*) AS bill_count, SUM(supply_total) AS supply_total, SUM(vat_total) AS vat_total, SUM(total) AS total FROM purchase_bills WHERE status='confirmed' AND bill_date>=? AND bill_date<=? GROUP BY REPLACE(LOWER(vendor),' ','')").all(from, to);
  const open = await unbilledLines({ from, to, limit: 5000 });
  const closings = await db.prepare("SELECT * FROM purchase_closings WHERE period=? AND status='closed'").all(period);
  const pays = await db.prepare(`SELECT MIN(vendor) AS vendor, SUM(amount) AS paid FROM purchase_payments WHERE status='confirmed' AND kind='payment' AND pay_date>=? AND pay_date<=? GROUP BY ${billVendorKey('vendor')}`).all(from, to);
  const map = new Map();
  const get = vendor => { const key = nameKey(vendor); if (!map.has(key)) map.set(key, { vendor, bill_count: 0, supply_total: 0, vat_total: 0, total: 0, payment_total: 0, unbilled_lines: 0, closing: null }); return map.get(key); };
  for (const p of pays) get(p.vendor).payment_total = p.paid;
  for (const b of bills) Object.assign(get(b.vendor), { bill_count: b.bill_count, supply_total: b.supply_total, vat_total: b.vat_total, total: b.total });
  for (const r of open) get(r.vendor).unbilled_lines++;
  for (const c of closings) get(c.vendor).closing = c;
  const rows = [...map.values()].sort((a, b) => stockCompare(a.vendor, b.vendor));
  return { period, from, to, rows, unbilled: open.slice(0, 500), can_reopen: !!user.is_admin };
});
route('POST', '/api/purchase-closing', async ({ user, body }) => {
  requirePurchase(user);
  const period = billPeriod(body.period), vendor = reqStr(body.vendor, '거래처', 100), key = nameKey(vendor);
  if (period >= today().slice(0, 7) && !(body.force_current && user.is_admin)) throw bad('이번 달은 아직 마감할 수 없습니다. 지난달부터 마감하세요.');
  const sum = await db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(supply_total),0) AS s, COALESCE(SUM(vat_total),0) AS v, COALESCE(SUM(total),0) AS t FROM purchase_bills WHERE status='confirmed' AND bill_date>=? AND bill_date<=? AND ${billVendorKey('vendor')}=?`).get(period + '-01', monthEnd(period), key);
  const paid = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS p FROM purchase_payments WHERE status='confirmed' AND kind='payment' AND pay_date>=? AND pay_date<=? AND ${billVendorKey('vendor')}=?`).get(period + '-01', monthEnd(period), key);
  try { await db.prepare('INSERT INTO purchase_closings(period,vendor_key,vendor,bill_count,supply_total,vat_total,total,closed_by,payment_total) VALUES(?,?,?,?,?,?,?,?,?)').run(period, key, vendor, sum.c, sum.s, sum.v, sum.t, user.name, paid.p); }
  catch (error) { if (/UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '이미 마감되었습니다.'); throw error; }
  return db.prepare("SELECT * FROM purchase_closings WHERE period=? AND vendor_key=? AND status='closed'").get(period, key);
});
route('POST', '/api/purchase-closing/reopen', async ({ user, body }) => {
  requireAdmin(user);
  const period = billPeriod(body.period), key = nameKey(reqStr(body.vendor, '거래처', 100));
  const r = await db.prepare("UPDATE purchase_closings SET status='reopened',reopened_by=?,reopened_at=? WHERE period=? AND vendor_key=? AND status='closed'").run(user.name, now(), period, key);
  if (!r.changes) throw bad('마감된 내역이 없습니다.');
  return { ok: true };
});

// ── 15.111 거래처별 단가표 ── 구분·거래처·품목·적용일마다 한 줄, 바꾸면 새 줄(이력). 쓰는 단가 = 날짜 이전 가장 늦은 적용일.
const PRICE_SIDES = ['purchase', 'sales'];
function priceSide(v) { const s = String(v || ''); if (!PRICE_SIDES.includes(s)) throw bad('매입·매출 구분을 확인하세요.'); return s; }
const requirePriceEdit = (user, side) => { if (!user.is_admin && !hasRole(user, side === 'purchase' ? 'purchase' : 'sales')) throw new HttpError(403, side === 'purchase' ? '매입 단가표는 구매 담당자가 고칩니다.' : '매출 단가표는 영업 담당자가 고칩니다.'); };
const CURRENT_PRICE = "NOT EXISTS(SELECT 1 FROM item_prices n WHERE n.side=p.side AND n.vendor_key=p.vendor_key AND n.bom_id=p.bom_id AND n.active=1 AND n.valid_from<=? AND (n.valid_from>p.valid_from OR (n.valid_from=p.valid_from AND n.id>p.id)))";
route('GET', '/api/item-prices', async ({ query }) => {
  const side = priceSide(query.side), date = query.date ? dateStr(query.date, '기준일') : today();
  const where = ['p.side=?', 'p.active=1', 'p.valid_from<=?', CURRENT_PRICE], args = [side, date, date];
  if (query.vendor) { where.push('p.vendor_key=?'); args.push(nameKey(str(query.vendor, 100))); }
  if (query.bom_id) { where.push('p.bom_id=?'); args.push(Number(query.bom_id)); }
  applyListKeyword(where, args, query.q, ['p.vendor', 'b.product', 'b.product_code', 'b.spec', 'p.note']);
  const rows = await db.prepare(`SELECT p.*, b.product AS item, b.product_code, b.spec, b.unit, b.item_category,
      (SELECT o.unit_price FROM item_prices o WHERE o.side=p.side AND o.vendor_key=p.vendor_key AND o.bom_id=p.bom_id AND o.active=1 AND (o.valid_from<p.valid_from OR (o.valid_from=p.valid_from AND o.id<p.id)) ORDER BY o.valid_from DESC, o.id DESC LIMIT 1) AS previous_price,
      (SELECT COUNT(*) FROM item_prices o WHERE o.side=p.side AND o.vendor_key=p.vendor_key AND o.bom_id=p.bom_id AND o.active=1) AS versions
    FROM item_prices p JOIN boms b ON b.id=p.bom_id WHERE ${where.join(' AND ')} ORDER BY p.vendor, b.product LIMIT 2001`).all(...args);
  // 앞으로 적용될(적용일이 기준일 뒤) 단가도 함께
  const future = await db.prepare(`SELECT p.*, b.product AS item, b.product_code FROM item_prices p JOIN boms b ON b.id=p.bom_id WHERE p.side=? AND p.active=1 AND p.valid_from>? ${query.vendor ? 'AND p.vendor_key=?' : ''} ORDER BY p.valid_from LIMIT 500`).all(side, date, ...(query.vendor ? [nameKey(str(query.vendor, 100))] : []));
  return { side, date, rows: rows.slice(0, 2000), more: rows.length > 2000, future };
});
// 한 품목·거래처의 단가 이력(취소된 줄 포함)
route('GET', '/api/item-prices/history', async ({ query }) => {
  const side = priceSide(query.side), vendor = reqStr(query.vendor, '거래처', 100), bomId = Number(query.bom_id);
  if (!Number.isSafeInteger(bomId) || bomId <= 0) throw bad('품목을 확인하세요.');
  return { rows: await db.prepare('SELECT * FROM item_prices WHERE side=? AND vendor_key=? AND bom_id=? ORDER BY valid_from DESC, id DESC LIMIT 200').all(side, nameKey(vendor), bomId) };
});
// 전표 입력용: 거래처의 그 날짜 단가 {bom_id: 단가}
route('GET', '/api/item-prices/lookup', async ({ query }) => {
  const side = priceSide(query.side), vendor = str(query.vendor, 100), date = query.date ? dateStr(query.date, '기준일') : today();
  if (!vendor) return { prices: {} };
  const rows = await db.prepare(`SELECT p.bom_id, p.unit_price, p.valid_from FROM item_prices p WHERE p.side=? AND p.vendor_key=? AND p.active=1 AND p.valid_from<=? AND ${CURRENT_PRICE}`).all(side, nameKey(vendor), date, date);
  return { prices: Object.fromEntries(rows.map(r => [r.bom_id, { unit_price: r.unit_price, valid_from: r.valid_from }])) };
});
// 새 단가(여러 줄 한꺼번에): [{bom_id, unit_price}], 같은 적용일이 이미 있으면 그 줄을 바꾼다(그날 고침)
route('POST', '/api/item-prices', async ({ user, body }) => {
  const side = priceSide(body.side); requirePriceEdit(user, side);
  const vendor = reqStr(body.vendor, '거래처', 100), date = dateStr(body.valid_from || today(), '적용일');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 200) throw bad('단가는 1~200줄 넣으세요.');
  const cmds = [];
  for (const [i, raw] of items.entries()) {
    const id = Number(raw?.bom_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad(`${i + 1}번째 줄: 품목을 고르세요.`);
    const bom = await db.prepare('SELECT id, product, active FROM boms WHERE id=?').get(id); if (!bom) throw bad(`${i + 1}번째 줄: 품목을 찾을 수 없습니다.`);
    const price = num(raw.unit_price, `${bom.product} 단가`); if (price < 0) throw bad(`${bom.product}: 단가는 0 이상이어야 합니다.`);
    const note = str(raw.note, 200);
    cmds.push({ sql: 'UPDATE item_prices SET unit_price=?,note=?,created_by=?,created_at=? WHERE side=? AND vendor_key=? AND bom_id=? AND valid_from=? AND active=1', args: [price, note, user.name, now(), side, nameKey(vendor), id, date] });
    cmds.push({ sql: 'INSERT INTO item_prices(side,vendor,vendor_key,bom_id,unit_price,valid_from,note,created_by) SELECT ?,?,?,?,?,?,?,? WHERE changes()=0', args: [side, vendor, nameKey(vendor), id, price, date, note, user.name] });
  }
  await ensureVendor(vendor, user, side);
  await db.batch(cmds);
  return { saved: items.length };
});
// 잘못 넣은 단가 줄 빼기(이력에는 「취소」로 남음)
route('POST', '/api/item-prices/:id/remove', async ({ user, params }) => {
  const row = await mustGet('item_prices', params.id); requirePriceEdit(user, row.side);
  const r = await db.prepare('UPDATE item_prices SET active=0,removed_by=?,removed_at=? WHERE id=? AND active=1').run(user.name, now(), row.id);
  if (!r.changes) throw bad('이미 뺀 단가입니다.');
  return { ok: true };
});

// ── 15.110 구매: 지급확인(매입처에 준 돈·기초 미지급)과 매입처 원장(기초 미지급 + 매입전표 − 지급 = 잔액) ──
route('GET', '/api/purchase-payments', async ({ user, query }) => {
  requirePurchase(user);
  const where = [], args = [];
  applyListDates(where, args, query, 'pay_date');
  if (query.vendor) { where.push(`${billVendorKey('vendor')}=?`); args.push(nameKey(str(query.vendor, 100))); }
  if (query.status) { if (!['confirmed', 'cancelled'].includes(query.status)) throw bad('상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  applyListKeyword(where, args, query.q, ['vendor', 'method', 'note', 'created_by']);
  const rows = await db.prepare(`SELECT * FROM purchase_payments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pay_date DESC, id DESC LIMIT 501`).all(...args);
  return { rows: rows.slice(0, 500), more: rows.length > 500 };
});
route('POST', '/api/purchase-payments', async ({ user, body }) => {
  requirePurchase(user);
  const token = String(body.request_id || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw bad('등록 요청 번호를 확인하세요.');
  const prior = await db.prepare('SELECT * FROM purchase_payments WHERE request_id=?').get(token);
  if (prior) { if (prior.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.'); return { ...prior, duplicate: true }; }
  const vendor = reqStr(body.vendor, '거래처', 100), date = dateStr(body.pay_date, '지급일');
  if (date > today()) throw bad('지급일은 오늘 이전으로 선택하세요.');
  const kind = body.kind === 'opening' ? 'opening' : 'payment';
  const amount = num(body.amount, '금액'); if (!(amount > 0)) throw bad('금액은 0보다 커야 합니다.');
  if (await closedPeriod(vendor, date)) throw bad(`${vendor}의 ${date.slice(0, 7)} 매입은 마감되었습니다. 마감 취소(관리자) 뒤에 등록하세요.`);
  await ensureVendor(vendor, user, 'purchase');
  const noteInfo = kind === 'payment' ? await paymentNoteInfo(body.note_info, 'purchase', vendor, date, billTrunc(amount)) : null; // 15.268 어음이면 어음 관리에도
  if (noteInfo) { requirePayments(user);
    try { await db.batch([{ sql: 'INSERT INTO purchase_payments(pay_date,vendor,kind,amount,method,note,created_by,created_by_id,request_id) VALUES(?,?,?,?,?,?,?,?,?)', args: [date, vendor, kind, billTrunc(amount), str(body.method, 50) || `어음 ${noteInfo.note_no}`, str(body.note, 200), user.name, user.id, token] }, ...paymentNoteCmds(noteInfo, 'purchase', 'purchase_payments', token, user)]); }
    catch (error) { if (isGuardError(error)) throw new HttpError(409, `${NOTE_KIND[noteInfo.kind]} ${noteInfo.note_no}는 이미 등록되어 있습니다.`); const saved = await db.prepare('SELECT * FROM purchase_payments WHERE request_id=?').get(token); if (saved && saved.created_by_id === user.id) return { ...saved, duplicate: true }; throw error; }
    return { ...await db.prepare('SELECT * FROM purchase_payments WHERE request_id=?').get(token), bill_note: await db.prepare('SELECT * FROM bill_notes WHERE request_id=?').get('pay:' + token) };
  }
  try { await db.prepare('INSERT INTO purchase_payments(pay_date,vendor,kind,amount,method,note,created_by,created_by_id,request_id) VALUES(?,?,?,?,?,?,?,?,?)').run(date, vendor, kind, billTrunc(amount), str(body.method, 50), str(body.note, 200), user.name, user.id, token); }
  catch (error) { const saved = await db.prepare('SELECT * FROM purchase_payments WHERE request_id=?').get(token); if (saved && saved.created_by_id === user.id) return { ...saved, duplicate: true }; throw error; }
  return db.prepare('SELECT * FROM purchase_payments WHERE request_id=?').get(token);
});
route('POST', '/api/purchase-payments/:id/cancel', async ({ user, params, body }) => {
  requirePurchase(user);
  const row = await mustGet('purchase_payments', params.id);
  if (row.status !== 'confirmed') throw bad('이미 취소된 지급입니다.');
  const ret = await db.prepare("SELECT return_no FROM stock_returns WHERE side='out' AND payment_id=? AND status='confirmed'").get(row.id); if (ret) throw bad(`반출 ${ret.return_no}의 현금 환불입니다. 반출 목록에서 그 반출을 취소하세요.`); // 15.141
  if (await closedPeriod(row.vendor, row.pay_date)) throw bad(`${row.vendor}의 ${row.pay_date.slice(0, 7)} 매입은 마감되었습니다. 마감 취소(관리자) 뒤에 취소하세요.`);
  const reason = reqStr(body.reason, '취소 사유', 200);
  const linked = await db.prepare("SELECT * FROM bill_notes WHERE payment_side='purchase' AND payment_id=? AND status<>'cancelled'").get(row.id); // 15.268
  if (linked?.status === 'collected') throw bad(`이 지급의 어음 ${linked.note_no}는 만기회수 처리되었습니다. 어음 관리에서 미처리로 되돌린 뒤 취소하세요.`);
  const r = await db.prepare("UPDATE purchase_payments SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed'").run(now(), user.name, reason, row.id);
  if (!r.changes) throw new HttpError(409, '이미 처리된 지급입니다.');
  if (linked) await db.batch([{ sql: "UPDATE bill_notes SET status='cancelled',updated_by=?,updated_at=? WHERE id=? AND status<>'cancelled'", args: [user.name, now(), linked.id] }, docChange('note', linked.id, `지급 취소로 함께 삭제 · ${reason}`, user)]);
  return mustGet('purchase_payments', row.id);
});
route('GET', '/api/purchase-ledger', async ({ user, query }) => {
  requirePurchase(user);
  const from = dateStr(query.from, '시작일'), to = dateStr(query.to, '종료일');
  if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
  const vendor = str(query.vendor, 100), vk = billVendorKey('vendor');
  const filter = vendor ? ` AND ${vk}=?` : '', fargs = vendor ? [nameKey(vendor)] : [];
  const beforeBills = await db.prepare(`SELECT ${vk} AS k, MIN(vendor) AS vendor, SUM(total) AS t FROM purchase_bills WHERE status='confirmed' AND bill_date<?${filter} GROUP BY k`).all(from, ...fargs);
  const beforePays = await db.prepare(`SELECT ${vk} AS k, MIN(vendor) AS vendor, SUM(CASE WHEN kind='opening' THEN amount ELSE -amount END) AS t FROM purchase_payments WHERE status='confirmed' AND pay_date<?${filter} GROUP BY k`).all(from, ...fargs);
  const before = new Map();
  for (const r of [...beforeBills, ...beforePays]) { const g = before.get(r.k) || { vendor: r.vendor, opening: 0 }; g.opening += r.t || 0; before.set(r.k, g); }
  if (!vendor) {
    const bills = await db.prepare(`SELECT ${vk} AS k, MIN(vendor) AS vendor, COUNT(*) AS bills, SUM(supply_total) AS supply, SUM(vat_total) AS vat, SUM(total) AS total FROM purchase_bills WHERE status='confirmed' AND bill_date>=? AND bill_date<=? GROUP BY k`).all(from, to);
    const pays = await db.prepare(`SELECT ${vk} AS k, MIN(vendor) AS vendor, SUM(CASE WHEN kind='payment' THEN amount ELSE 0 END) AS paid, SUM(CASE WHEN kind='opening' THEN amount ELSE 0 END) AS opening FROM purchase_payments WHERE status='confirmed' AND pay_date>=? AND pay_date<=? GROUP BY k`).all(from, to);
    const map = new Map(), get = (k, name) => { if (!map.has(k)) map.set(k, { vendor: name, opening: 0, bills: 0, supply: 0, vat: 0, total: 0, paid: 0 }); return map.get(k); };
    for (const [k, g] of before) get(k, g.vendor).opening = g.opening;
    for (const b of bills) Object.assign(get(b.k, b.vendor), { bills: b.bills, supply: b.supply, vat: b.vat, total: b.total });
    for (const p of pays) { const g = get(p.k, p.vendor); g.paid = p.paid; g.opening += p.opening; }
    const rows = [...map.values()].map(r => ({ ...r, balance: r.opening + r.total - r.paid })).filter(r => r.opening || r.total || r.paid || r.balance).sort((a, b) => stockCompare(a.vendor, b.vendor));
    return { from, to, vendor: '', rows };
  }
  const key = nameKey(vendor), opening = [...before.values()][0]?.opening || 0;
  const bills = await db.prepare(`SELECT id, bill_no, bill_date AS date, statement_no, freight, supply_total, vat_total, total, note, (SELECT group_concat(DISTINCT c) FROM (SELECT ${LINE_CAT('l')} AS c FROM purchase_bill_lines l WHERE l.bill_id=purchase_bills.id AND l.active=1)) AS categories, (SELECT COUNT(*) FROM purchase_bill_lines l WHERE l.bill_id=purchase_bills.id) AS line_count, (SELECT item FROM purchase_bill_lines l WHERE l.bill_id=purchase_bills.id ORDER BY id LIMIT 1) AS first_item FROM purchase_bills WHERE status='confirmed' AND bill_date>=? AND bill_date<=? AND ${vk}=? ORDER BY bill_date, id LIMIT 5001`).all(from, to, key);
  const pays = await db.prepare(`SELECT id, pay_date AS date, kind, amount, method, note FROM purchase_payments WHERE status='confirmed' AND pay_date>=? AND pay_date<=? AND ${vk}=? ORDER BY pay_date, id LIMIT 5001`).all(from, to, key);
  if (bills.length > 5000 || pays.length > 5000) throw bad('줄이 너무 많습니다. 기간을 좁히세요.');
  const rows = [
    ...pays.map(p => ({ kind: p.kind, date: p.date, order: 0, id: p.id, item: p.kind === 'opening' ? '기초 미지급' : `${vendor}-지급`, method: p.method, note: p.note, purchase: p.kind === 'opening' ? p.amount : 0, paid: p.kind === 'payment' ? p.amount : 0 })),
    ...bills.map(b => ({ kind: 'purchase', date: b.date, order: 1, id: b.id, bill_id: b.id, bill_no: b.bill_no, categories: b.categories, statement_no: b.statement_no, item: b.first_item ? `${b.first_item}${b.line_count > 1 ? ` 외 ${b.line_count - 1}` : ''}` : '', supply: b.supply_total, vat: b.vat_total, freight: b.freight, purchase: b.total, paid: 0, note: b.note })),
  ].sort((a, b) => stockCompare(a.date, b.date) || a.order - b.order || a.id - b.id);
  let balance = opening;
  for (const r of rows) { balance += r.purchase - r.paid; r.balance = balance; delete r.order; }
  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  return { from, to, vendor, opening, rows, totals: { supply: sum('supply'), vat: sum('vat'), purchase: sum('purchase'), paid: sum('paid'), balance } };
});

// ── 구매: 입고현황 (15.87) ── 매입 마감용. 입고일 기준으로 기간 안 입고 줄을 분류(원자재·부자재·제품·상품·임가공…)별로 모아 금액을 낸다.
// 금액 = 매입전표에 잡은 수량은 전표 공급가액(확정) + 아직 안 잡은 수량은 발주 단가 × 남은 수량(미확정, 기타입고처럼 단가가 없으면 「단가 없음」).
const RS_SOURCES = {
  po_lot: { date: 'l.received_date', sql: `SELECT 'po_lot' AS source_type, l.id AS source_id, l.received_date AS received_date, p.vendor, p.req_no, p.item, p.spec, p.unit, p.product_code, l.lot, p.item_category AS category, l.qty, p.unit_price,
      ${lotBilled()} AS billed_qty,
      (SELECT COALESCE(SUM(b.supply),0) FROM purchase_bill_lines b WHERE b.active=1 AND ((b.source_type='po_lot' AND b.source_id=l.id) OR (${PREV_LOT} AND b.source_type='po' AND b.source_id=p.id))) AS billed_supply,
      (SELECT COALESCE(SUM(CASE WHEN pb.tax_type='zero' THEN 0 ELSE b.supply * 0.1 END),0) FROM purchase_bill_lines b JOIN purchase_bills pb ON pb.id=b.bill_id WHERE b.active=1 AND ((b.source_type='po_lot' AND b.source_id=l.id) OR (${PREV_LOT} AND b.source_type='po' AND b.source_id=p.id))) AS billed_vat
    FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.voided_at IS NULL AND p.recv_status IN ('ok','mismatch')` },
  po: { date: "COALESCE(substr(p.recv_at,1,10), p.due_date)", sql: `SELECT 'po' AS source_type, p.id AS source_id, COALESCE(substr(p.recv_at,1,10), p.due_date) AS received_date, p.vendor, p.req_no, p.item, p.spec, p.unit, p.product_code, p.lot, p.item_category AS category, p.recv_qty AS qty, p.unit_price,
      ${billedOf('po', 'p.id')} AS billed_qty,
      (SELECT COALESCE(SUM(b.supply),0) FROM purchase_bill_lines b WHERE b.active=1 AND b.source_type='po' AND b.source_id=p.id) AS billed_supply,
      (SELECT COALESCE(SUM(CASE WHEN pb.tax_type='zero' THEN 0 ELSE b.supply * 0.1 END),0) FROM purchase_bill_lines b JOIN purchase_bills pb ON pb.id=b.bill_id WHERE b.active=1 AND b.source_type='po' AND b.source_id=p.id) AS billed_vat
    FROM purchase_orders p WHERE p.recv_status IN ('ok','mismatch') AND p.recv_qty IS NOT NULL AND NOT EXISTS(SELECT 1 FROM po_receipt_lots l WHERE l.po_id=p.id AND l.voided_at IS NULL)` },
  other: { date: 'o.received_date', sql: `SELECT 'other' AS source_type, o.id AS source_id, o.received_date, o.vendor, '' AS req_no, o.item, o.spec, COALESCE(NULLIF(o.unit,''), json_extract(o.bom_snapshot,'$.unit'), '') AS unit, COALESCE(json_extract(o.bom_snapshot,'$.product_code'), '') AS product_code, o.lot, o.item_category AS category, o.qty, NULL AS unit_price,
      ${billedOf('other', 'o.id')} AS billed_qty,
      (SELECT COALESCE(SUM(b.supply),0) FROM purchase_bill_lines b WHERE b.active=1 AND b.source_type='other' AND b.source_id=o.id) AS billed_supply,
      (SELECT COALESCE(SUM(CASE WHEN pb.tax_type='zero' THEN 0 ELSE b.supply * 0.1 END),0) FROM purchase_bill_lines b JOIN purchase_bills pb ON pb.id=b.bill_id WHERE b.active=1 AND b.source_type='other' AND b.source_id=o.id) AS billed_vat
    FROM other_receipts o WHERE 1=1` },
};
const RS_ORDER = ['원자재', '부자재', '제품', '상품', '임가공', '반제품', '미분류'];
// 15.157 입고현황·납품현황 공통 집계: 분류별·거래처별 줄 수·확정·미확정 금액
function rsSummary(lines) {
  const sumBy = key => {
    const map = new Map();
    for (const l of lines) { const k = key(l), g = map.get(k) || { lines: 0, confirmed: 0, estimate: 0, unpriced: 0, open: 0 }; g.lines++; g.confirmed += l.confirmed; g.estimate += l.estimate; if (l.unpriced) g.unpriced++; if (l.state === 'open' || l.state === 'partial') g.open++; map.set(k, g); }
    return map;
  };
  const byCat = sumBy(l => l.category);
  const categories = RS_ORDER.filter(c => byCat.has(c) || ['원자재', '부자재', '제품', '상품', '임가공'].includes(c)).map(c => ({ category: c, ...(byCat.get(c) || { lines: 0, confirmed: 0, estimate: 0, unpriced: 0, open: 0 }) })).map(g => ({ ...g, total: g.confirmed + g.estimate }));
  // 거래처 집계: 줄을 한 번만 돌며 합계·분류별 금액·분류별 세부를 모은다(15.90, 거래처 × 줄 반복 제거)
  const vmap = new Map();
  for (const l of lines) {
    const k = nameKey(l.vendor), v = vmap.get(k) || { vendor: l.vendor, lines: 0, confirmed: 0, estimate: 0, unpriced: 0, open: 0, categories: {}, by: {} };
    const c = v.by[l.category] || (v.by[l.category] = { lines: 0, confirmed: 0, estimate: 0, open: 0, unpriced: 0 }), isOpen = l.state === 'open' || l.state === 'partial';
    for (const g of [v, c]) { g.lines++; g.confirmed += l.confirmed; g.estimate += l.estimate; if (isOpen) g.open++; if (l.unpriced) g.unpriced++; }
    v.categories[l.category] = (v.categories[l.category] || 0) + l.confirmed + l.estimate;
    vmap.set(k, v);
  }
  const vendors = [...vmap.values()].map(v => ({ ...v, total: v.confirmed + v.estimate })).sort((a, b) => stockCompare(a.vendor, b.vendor));
  return { categories, vendors };
}
route('GET', '/api/purchase-receipt-status', async ({ user, query }) => {
  requirePurchase(user);
  const from = dateStr(query.from, '시작일'), to = dateStr(query.to, '종료일');
  if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
  const vendor = str(query.vendor, 100);
  const rows = [];
  for (const [type, s] of Object.entries(RS_SOURCES)) {
    const where = [`${s.date}>=?`, `${s.date}<=?`], args = [from, to];
    if (vendor) { where.push(`${billVendorKey(type === 'other' ? 'o.vendor' : 'p.vendor')}=?`); args.push(nameKey(vendor)); }
    const part = await db.prepare(`${s.sql} AND ${where.join(' AND ')} LIMIT 10001`).all(...args);
    if (part.length > 10000) throw bad('입고 줄이 너무 많습니다. 기간이나 거래처로 좁히세요.');
    rows.push(...part);
  }
  rows.sort((a, b) => stockCompare(a.received_date, b.received_date) || stockCompare(a.vendor, b.vendor));
  const lines = rows.map(r => {
    const category = RS_ORDER.includes(r.category) ? r.category : '미분류';
    // 수량 수정 승인으로 생긴 음수 줄은 그만큼 미확정 금액에서 뺀다(같은 발주의 다른 줄과 합쳐 순액이 맞음).
    const adjust = r.qty < 0;
    const remaining = adjust ? r.qty : Math.max(0, stockRound(r.qty - (r.billed_qty || 0)));
    const estimate = remaining !== 0 && r.unit_price != null ? (adjust ? -billTrunc(-remaining * r.unit_price) : billTrunc(remaining * r.unit_price)) : 0;
    const state = adjust ? 'adjust' : remaining <= 0 ? 'billed' : (r.billed_qty || 0) > 0 ? 'partial' : 'open';
    // 15.149 세액: 전표 잡은 금액은 그 전표의 과세 여부대로, 미확정(발주 단가) 금액은 10% 예상
    const vat = billTrunc(r.billed_vat || 0) + (estimate ? Math.trunc(estimate * 0.1) : 0);
    return { ...r, category, confirmed: r.billed_supply || 0, estimate, remaining, unpriced: remaining !== 0 && r.unit_price == null, state, vat };
  });
  const { categories, vendors } = rsSummary(lines); // 15.157 납품현황과 같은 집계
  // 운송비는 매입전표 머리에 있어 분류가 없다. 명세서 일자가 기간 안인 확정 전표의 운송비를 따로 보여 준다.
  const fw = ["status='confirmed'", 'bill_date>=?', 'bill_date<=?', 'freight>0'], fa = [from, to];
  if (vendor) { fw.push(`${billVendorKey('vendor')}=?`); fa.push(nameKey(vendor)); }
  const freight = (await db.prepare(`SELECT COALESCE(SUM(freight),0) AS f, COUNT(*) AS c FROM purchase_bills WHERE ${fw.join(' AND ')}`).get(...fa));
  return { from, to, vendor, categories, vendors, freight: { total: freight.f, bills: freight.c }, lines: lines.slice(0, 3000), more: lines.length > 3000, line_count: lines.length };
});
// ── 경리: 어음 관리 (15.165) ── 받을어음·지급어음. 발행일자·어음번호·거래처·발행금액·만기일자·발행은행·처리구분(미처리 open / 만기회수 collected).
// 입금확인·지급확인과 같은 권한(영업·구매). 같은 구분에서 살아 있는 어음번호는 겹치지 못한다. 고치면 이력(doc_changes note), 삭제는 상태만(cancelled).
const NOTE_KIND = { receivable: '받을어음', payable: '지급어음' };
async function noteFields(body, old = {}) {
  const kind = (body.kind ?? old.kind) === 'payable' ? 'payable' : 'receivable';
  const issue = dateStr(body.issue_date ?? old.issue_date, '발행일자'), due = dateStr(body.due_date ?? old.due_date, '만기일자');
  if (due < issue) throw bad('만기일자는 발행일자 이후여야 합니다.');
  const amount = num(body.amount ?? old.amount, '발행금액'); if (!(amount > 0)) throw bad('발행금액을 0보다 크게 넣으세요.');
  const noteNo = reqStr(body.note_no ?? old.note_no, '어음번호', 50);
  const partner = reqStr(body.partner ?? old.partner, '거래처', 100), v = await vendorByName(partner);
  return { kind, issue_date: issue, note_no: noteNo, partner: v?.name || partner, amount: billTrunc(amount), due_date: due, bank: str(body.bank ?? old.bank, 50), memo: str(body.memo ?? old.memo, 300) };
}
// 15.268 입금·지급과 함께 들어온 어음(body.note_info): 받을어음(입금)·지급어음(지급). 금액·거래처·발행일은 입금과 같게.
const NOTE_TYPES = ['자수어음', '타수어음', '전자어음', '약속어음', '당좌수표', '가계수표'];
async function paymentNoteInfo(info, side, party, date, amount) {
  if (!info || typeof info !== 'object') return null;
  const n = await noteFields({ kind: side === 'sales' ? 'receivable' : 'payable', issue_date: info.issue_date || date, due_date: info.due_date, note_no: info.note_no, partner: str(info.partner, 100) || party, amount: Number(info.amount) > 0 ? info.amount : amount, bank: info.bank, memo: info.memo }); // 15.269 발행금액·거래처는 따로 줄 수 있음(기본은 입금과 같게)
  const type = str(info.note_type, 20); if (type && !NOTE_TYPES.includes(type)) throw bad('어음 종류를 다시 고르세요.');
  if (await noteDup(n)) throw new HttpError(409, `${NOTE_KIND[n.kind]} ${n.note_no}는 이미 등록되어 있습니다.`);
  return { ...n, note_type: type, endorser: str(info.endorser, 100), storage: str(info.storage, 100) };
}
const paymentNoteCmds = (n, side, table, token, user) => [
  { sql: `INSERT INTO bill_notes(kind,issue_date,note_no,partner,amount,due_date,bank,memo,created_by,created_by_id,request_id,payment_side,payment_id,note_type,endorser,storage) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM ${table} WHERE request_id=?),?,?,? WHERE NOT EXISTS(SELECT 1 FROM bill_notes WHERE kind=? AND note_no=? AND status<>'cancelled')`,
    args: [n.kind, n.issue_date, n.note_no, n.partner, n.amount, n.due_date, n.bank, n.memo, user.name, user.id, 'pay:' + token, side, token, n.note_type, n.endorser, n.storage, n.kind, n.note_no] }, RC_GUARD];
const noteDup = (n, id = 0) => db.prepare("SELECT 1 FROM bill_notes WHERE kind=? AND note_no=? AND status<>'cancelled' AND id<>?").get(n.kind, n.note_no, id);
route('GET', '/api/notes', async ({ user, query }) => {
  requirePayments(user);
  const kind = query.kind === 'payable' ? 'payable' : 'receivable', where = ['kind=?'], args = [kind];
  // 15.165 날짜 기준: 발행일자(기본)·만기일자·처리일자
  applyListDates(where, args, query, { due: 'due_date', processed: 'processed_date' }[query.basis] || 'issue_date');
  if (query.status === 'open' || query.status === 'collected') { where.push('status=?'); args.push(query.status); } else where.push("status<>'cancelled'");
  if (query.partner) { where.push(`${customerKey('partner')}=?`); args.push(nameKey(str(query.partner, 100))); }
  const kw = str(query.q, 50).trim(); if (kw) { where.push('(note_no LIKE ? OR bank LIKE ? OR memo LIKE ?)'); args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
  const order = { due: 'due_date', processed: 'processed_date' }[query.basis] || 'issue_date';
  const rows = await db.prepare(`SELECT * FROM bill_notes WHERE ${where.join(' AND ')} ORDER BY ${order}, id LIMIT 2001`).all(...args);
  if (rows.length > 2000) throw bad('어음이 너무 많습니다. 기간을 좁히세요.');
  const sum = st => rows.filter(r => !st || r.status === st).reduce((t, r) => t + r.amount, 0);
  return { kind, rows, totals: { all: sum(''), open: sum('open'), collected: sum('collected'), count: rows.length } };
});
route('POST', '/api/notes', async ({ user, body }) => {
  requirePayments(user);
  const key = str(body.request_id, 80);
  if (key) { const old = await db.prepare('SELECT * FROM bill_notes WHERE request_id=?').get(key); if (old) return { ...old, duplicate: true }; }
  const n = await noteFields(body);
  if (await noteDup(n)) throw new HttpError(409, `${NOTE_KIND[n.kind]} ${n.note_no}는 이미 등록되어 있습니다.`);
  const token = key || 'srv:' + crypto.randomUUID();
  // 15.169 동시에 같은 어음번호가 들어와도 한 건만(확인과 넣기를 한 문장으로)
  const ins = await db.prepare("INSERT INTO bill_notes(kind,issue_date,note_no,partner,amount,due_date,bank,memo,created_by,created_by_id,request_id) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM bill_notes WHERE kind=? AND note_no=? AND status<>'cancelled')")
    .run(n.kind, n.issue_date, n.note_no, n.partner, n.amount, n.due_date, n.bank, n.memo, user.name, user.id, token, n.kind, n.note_no);
  if (!ins.changes) throw new HttpError(409, `${NOTE_KIND[n.kind]} ${n.note_no}는 이미 등록되어 있습니다.`);
  return db.prepare('SELECT * FROM bill_notes WHERE request_id=?').get(token);
});
route('PUT', '/api/notes/:id', async ({ user, params, body }) => {
  requirePayments(user);
  const old = await mustGet('bill_notes', params.id); if (old.status === 'cancelled') throw bad('삭제된 어음입니다.');
  const n = await noteFields(body, old);
  if (await noteDup(n, old.id)) throw new HttpError(409, `${NOTE_KIND[n.kind]} ${n.note_no}는 이미 등록되어 있습니다.`);
  const labels = { kind: '구분', issue_date: '발행일자', note_no: '어음번호', partner: '거래처', amount: '발행금액', due_date: '만기일자', bank: '발행은행', memo: '비고' };
  const diff = Object.keys(labels).filter(k => String(n[k]) !== String(old[k])).map(k => k === 'memo' ? labels[k] : `${labels[k]} ${old[k]} → ${n[k]}`);
  if (!diff.length) return old;
  await db.batch([{ sql: "UPDATE bill_notes SET kind=?,issue_date=?,note_no=?,partner=?,amount=?,due_date=?,bank=?,memo=?,updated_by=?,updated_at=? WHERE id=? AND status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM bill_notes x WHERE x.kind=? AND x.note_no=? AND x.status<>'cancelled' AND x.id<>?)", args: [n.kind, n.issue_date, n.note_no, n.partner, n.amount, n.due_date, n.bank, n.memo, user.name, now(), old.id, n.kind, n.note_no, old.id] }, RC_GUARD, docChange('note', old.id, diff.join(' · '), user)])
    .catch(error => { if (isGuardError(error)) throw new HttpError(409, '그 사이 어음이 삭제되었거나 같은 어음번호가 등록되었습니다. 새로 불러오세요.'); throw error; });
  return mustGet('bill_notes', old.id);
});
// 처리구분: collect(만기회수, 처리일자) · reopen(미처리로 되돌림) · cancel(삭제 — 기록은 남김)
route('POST', '/api/notes/:id/:action', async ({ user, params, body }) => {
  requirePayments(user);
  const n = await mustGet('bill_notes', params.id), action = params.action;
  let sql, args, summary;
  if (action === 'collect') { if (n.status !== 'open') throw bad('미처리 어음만 만기회수로 처리할 수 있습니다.'); const d = dateStr(body.date || today(), '처리일자'); sql = "UPDATE bill_notes SET status='collected',processed_date=?,updated_by=?,updated_at=? WHERE id=? AND status='open'"; args = [d, user.name, now(), n.id]; summary = `만기회수 ${d}`; }
  else if (action === 'reopen') { if (n.status !== 'collected') throw bad('만기회수한 어음만 미처리로 되돌릴 수 있습니다.'); sql = "UPDATE bill_notes SET status='open',processed_date=NULL,updated_by=?,updated_at=? WHERE id=? AND status='collected'"; args = [user.name, now(), n.id]; summary = '미처리로 되돌림'; }
  else if (action === 'cancel') { if (n.status === 'cancelled') throw bad('이미 삭제된 어음입니다.'); if (n.payment_id && await db.prepare(`SELECT 1 FROM ${n.payment_side === 'purchase' ? 'purchase_payments' : 'sales_payments'} WHERE id=? AND status='confirmed'`).get(n.payment_id)) throw bad(`거래처 장부의 ${n.payment_side === 'purchase' ? '지급' : '입금'}으로 들어온 어음입니다. 장부(또는 ${n.payment_side === 'purchase' ? '지급확인' : '입금확인'})에서 그 ${n.payment_side === 'purchase' ? '지급' : '입금'}을 취소하면 함께 삭제됩니다.`); sql = "UPDATE bill_notes SET status='cancelled',updated_by=?,updated_at=? WHERE id=? AND status<>'cancelled'"; args = [user.name, now(), n.id]; summary = '삭제'; }
  else throw new HttpError(404, '없는 동작입니다.');
  await db.batch([{ sql, args }, RC_GUARD, docChange('note', n.id, summary, user)]).catch(error => { if (isGuardError(error)) throw new HttpError(409, '그 사이 어음 상태가 바뀌었습니다. 새로 불러오세요.'); throw error; });
  return mustGet('bill_notes', n.id);
});
route('GET', '/api/notes/:id/history', async ({ user, params }) => { requirePayments(user); return db.prepare("SELECT summary, changed_by, changed_at FROM doc_changes WHERE doc_type='note' AND doc_id=? ORDER BY id DESC LIMIT 30").all(Number(params.id) || 0); });
// ── 영업: 견적서 (15.163) ── 수신(거래처, 거래처코드로 찾기)·참조·견적일·유효기간·통화(원/달러)·담당자·기타 + 품목 줄(품목코드로 찾기, 단가 입력).
// 금액은 V.A.T 별도 공급가액: 원화는 원 미만 절사, 달러는 센트(소수 둘째 자리) 반올림. 견적번호 SST-연도-월일-순번. 고치면 이력, 취소는 상태만.
const QUOTE_MAX_LINES = 60;
const quoteMoney = (v, cur) => cur === 'USD' ? Number(Math.round(Number(Number(v).toFixed(8) + 'e2')) + 'e-2') : billTrunc(v); // 15.169 1.005 → 1.01(소수 오차 없이)
async function quoteFields(body, old = {}) {
  const customer = reqStr(body.customer ?? old.customer, '수신(거래처)', 100), v = await vendorByName(customer);
  const currency = (body.currency ?? old.currency) === 'USD' ? 'USD' : 'KRW';
  const date = dateStr(body.quote_date ?? old.quote_date ?? today(), '견적일');
  const raw = Array.isArray(body.lines) ? body.lines.filter(l => l && typeof l === 'object' && String(l.item ?? '').trim()) : [];
  if (!raw.length || raw.length > QUOTE_MAX_LINES) throw bad(`품목을 1~${QUOTE_MAX_LINES}줄 넣으세요.`);
  const lines = [];
  for (const [k, l] of raw.entries()) {
    const no = `${k + 1}번째 품목`, qty = num(l.qty, `${no} 수량`), price = num(l.unit_price, `${no} 단가`);
    if (qty <= 0) throw bad(`${no}: 수량을 0보다 크게 넣으세요.`);
    if (price < 0) throw bad(`${no}: 단가를 확인하세요.`);
    let bom = null; if (l.bom_id) { const id = Number(l.bom_id); if (Number.isSafeInteger(id) && id > 0) bom = await db.prepare('SELECT id, product_code FROM boms WHERE id=?').get(id); }
    const q2 = stockRound(qty); lines.push({ bom_id: bom?.id ?? null, product_code: str(l.product_code ?? bom?.product_code ?? '', 50), item: reqStr(l.item, `${no} 품명`, 200), spec: str(l.spec, 100), unit: str(l.unit, 20), qty: q2, unit_price: Number(price), supply: quoteMoney(q2 * price, currency), note: str(l.note, 200) });
  }
  return { quote_date: date, customer: v?.name || customer, customer_code: v?.code || (nameKey(customer) === nameKey(old.customer || '') ? old.customer_code || '' : ''), attn: str(body.attn ?? old.attn, 100), valid_text: str(body.valid_text ?? old.valid_text ?? '견적일로부터 1개월', 100) || '견적일로부터 1개월', currency,
    manager: str(body.manager ?? old.manager, 50), manager_phone: str(body.manager_phone ?? old.manager_phone, 30), terms: str(body.terms ?? old.terms, 1000), note: str(body.note ?? old.note, 500),
    supply_total: quoteMoney(lines.reduce((t, l) => t + l.supply, 0), currency), lines };
}
async function quoteDetail(q) {
  const lines = await db.prepare('SELECT * FROM quote_lines WHERE quote_id=? ORDER BY line_no').all(q.id);
  const changes = await db.prepare("SELECT summary, changed_by, changed_at FROM doc_changes WHERE doc_type='quote' AND doc_id=? ORDER BY id DESC LIMIT 20").all(q.id);
  const v = await vendorByName(q.customer);
  return { ...q, lines, changes, company: await companyInfo(), customer_info: v ? { code: v.code, biz_no: v.biz_no, address: v.address, ceo: v.ceo } : null };
}
const quoteLineCmds = (QID, args, lines) => lines.map((l, k) => ({ sql: `INSERT INTO quote_lines(quote_id,line_no,bom_id,product_code,item,spec,unit,qty,unit_price,supply,note) VALUES(${QID},?,?,?,?,?,?,?,?,?,?)`, args: [...args, k + 1, l.bom_id, l.product_code, l.item, l.spec, l.unit, l.qty, l.unit_price, l.supply, l.note] }));
route('POST', '/api/quotes', async ({ user, body }) => {
  requireSales(user);
  const key = str(body.request_id, 80);
  if (key) { const old = await db.prepare('SELECT * FROM quotes WHERE request_id=?').get(key); if (old) return { ...await quoteDetail(old), duplicate: true }; }
  const q = await quoteFields(body), token = key || 'srv:' + crypto.randomUUID(), d = q.quote_date, prefix = `SST-${d.slice(0, 4)}-${d.slice(5, 7)}${d.slice(8, 10)}-`;
  const QID = '(SELECT id FROM quotes WHERE request_id=?)';
  await db.batch([
    { sql: `INSERT INTO quotes(quote_no,quote_date,customer,customer_code,attn,valid_text,currency,manager,manager_phone,terms,note,supply_total,created_by,created_by_id,request_id) VALUES(${nextDocNo('quotes', 'quote_no')},?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [prefix, prefix, prefix, q.quote_date, q.customer, q.customer_code, q.attn, q.valid_text, q.currency, q.manager, q.manager_phone, q.terms, q.note, q.supply_total, user.name, user.id, token] },
    ...quoteLineCmds(QID, [token], q.lines),
  ]);
  return quoteDetail(await db.prepare('SELECT * FROM quotes WHERE request_id=?').get(token));
});
route('GET', '/api/quotes', async ({ user, query }) => {
  requireSales(user);
  const where = [], args = [];
  applyListDates(where, args, query, 'q.quote_date');
  if (query.customer) { where.push(`${customerKey('q.customer')}=?`); args.push(nameKey(str(query.customer, 100))); }
  if (query.status === 'cancelled') where.push("q.status='cancelled'"); else if (query.status !== 'all') where.push("q.status='active'");
  const kw = str(query.q, 100).trim(); // 견적번호·수신·참조·담당자·비고·기타 + 품명·품목코드
  if (kw) { const like = `%${kw}%`; where.push("(q.quote_no LIKE ? OR q.customer LIKE ? OR q.attn LIKE ? OR q.manager LIKE ? OR q.note LIKE ? OR q.terms LIKE ? OR EXISTS(SELECT 1 FROM quote_lines l WHERE l.quote_id=q.id AND (l.item LIKE ? OR l.product_code LIKE ?)))"); args.push(like, like, like, like, like, like, like, like); }
  const rows = await db.prepare(`SELECT q.*, (SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id=q.id) AS line_count, (SELECT item FROM quote_lines l WHERE l.quote_id=q.id ORDER BY line_no LIMIT 1) AS first_item
    FROM quotes q ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.quote_date DESC, q.id DESC LIMIT 501`).all(...args);
  return { rows: rows.slice(0, 500), more: rows.length > 500 };
});
route('GET', '/api/quotes/:id', async ({ user, params }) => { requireSales(user); return quoteDetail(await mustGet('quotes', params.id)); });
route('PUT', '/api/quotes/:id', async ({ user, params, body }) => {
  requireSales(user);
  const old = await mustGet('quotes', params.id); if (old.status !== 'active') throw bad('취소된 견적서는 고칠 수 없습니다. 「복사」로 새 견적서를 만드세요.');
  const ver = old.updated_at || old.created_at; if (body.version !== undefined && String(body.version ?? '') !== String(ver ?? '')) throw new HttpError(409, '그 사이 다른 사람이 이 견적서를 고쳤습니다. 다시 불러온 뒤 고치세요.'); // 15.169
  const q = await quoteFields(body, old), oldLines = await db.prepare('SELECT item, qty, unit_price FROM quote_lines WHERE quote_id=? ORDER BY line_no').all(old.id);
  const diff = [];
  for (const [k, label] of [['quote_date', '견적일'], ['customer', '수신'], ['attn', '참조'], ['valid_text', '유효기간'], ['currency', '통화'], ['manager', '담당자'], ['terms', '기타']]) if (String(q[k] ?? '') !== String(old[k] ?? '')) diff.push(label);
  if (JSON.stringify(oldLines.map(l => [l.item, l.qty, l.unit_price])) !== JSON.stringify(q.lines.map(l => [l.item, l.qty, l.unit_price]))) diff.push(`품목 ${q.lines.length}줄`);
  if (q.supply_total !== old.supply_total) diff.push(`금액 ${old.supply_total} → ${q.supply_total}`);
  const r = await db.batch([
    { sql: "UPDATE quotes SET quote_date=?,customer=?,customer_code=?,attn=?,valid_text=?,currency=?,manager=?,manager_phone=?,terms=?,note=?,supply_total=?,updated_by=?,updated_at=? WHERE id=? AND status='active' AND COALESCE(updated_at,created_at)=?",
      args: [q.quote_date, q.customer, q.customer_code, q.attn, q.valid_text, q.currency, q.manager, q.manager_phone, q.terms, q.note, q.supply_total, user.name, now(), old.id, ver] }, RC_GUARD,
    { sql: 'DELETE FROM quote_lines WHERE quote_id=?', args: [old.id] },
    ...quoteLineCmds('?', [old.id], q.lines),
    docChange('quote', old.id, diff.join(' · ') || '저장', user),
  ]).catch(error => { if (isGuardError(error)) throw new HttpError(409, '그 사이 견적서가 취소되었거나 다른 사람이 고쳤습니다. 새로 불러오세요.'); throw error; });
  return quoteDetail(await mustGet('quotes', old.id));
});
route('POST', '/api/quotes/:id/cancel', async ({ user, params }) => {
  requireSales(user);
  const q = await mustGet('quotes', params.id); if (q.status !== 'active') throw bad('이미 취소된 견적서입니다.');
  await db.batch([{ sql: "UPDATE quotes SET status='cancelled',cancelled_by=?,cancelled_at=? WHERE id=? AND status='active'", args: [user.name, now(), q.id] }, RC_GUARD, docChange('quote', q.id, '취소', user)])
    .catch(error => { if (isGuardError(error)) throw bad('이미 취소된 견적서입니다.'); throw error; }); // 15.169 두 번 눌러도 이력 한 줄
  return quoteDetail(await mustGet('quotes', q.id));
});
// ── 영업: 납품현황 (15.157) ── 입고현황의 매출 쪽. 출고일 기준으로 기간 안 출하 줄을 분류·고객사·품목·일자별로 본다.
// 금액 = 매출전표에 잡은 출하는 전표 공급가액·세액(확정), 아직 안 잡은 출하는 단가 × 수량(미확정, 세액 10% 예상).
// 미확정 단가: 그 출하를 낸 출하지시의 수주 단가 → 단가표(출고일 기준) → 그 고객사 최근 매출 단가. 없으면 「단가 없음」.
route('GET', '/api/sales-delivery-status', async ({ user, query }) => {
  requireSales(user);
  const from = dateStr(query.from, '시작일'), to = dateStr(query.to, '종료일');
  if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
  const customer = str(query.vendor ?? query.customer, 100);
  const where = ['s.ship_date>=?', 's.ship_date<=?'], args = [from, to];
  if (customer) { where.push(`${customerKey('s.customer')}=?`); args.push(nameKey(customer)); }
  const rows = await db.prepare(`SELECT s.id AS source_id, s.ship_date AS received_date, s.customer AS vendor, s.item, s.spec, s.unit, s.product_code, s.lot, s.qty,
      COALESCE(NULLIF(x.item_category,''), ${CODE_CAT('s.product_code')}, '') AS category, x.supply AS billed_supply, x.vat AS billed_vat, x.unit_price AS billed_price, b.bill_no, o.order_no AS req_no, ol.unit_price AS order_price,
      (SELECT p.unit_price FROM item_prices p JOIN boms bm ON bm.id=p.bom_id WHERE p.side='sales' AND p.active=1 AND p.vendor_key=${customerKey('s.customer')} AND s.product_code<>'' AND bm.product_code=s.product_code AND p.valid_from<=s.ship_date ORDER BY p.valid_from DESC, p.id DESC LIMIT 1) AS table_price,
      (SELECT y.unit_price FROM sales_bill_lines y JOIN sales_bills yb ON yb.id=y.bill_id WHERE y.active=1 AND yb.status='confirmed' AND ${customerKey('yb.customer')}=${customerKey('s.customer')}
         AND (CASE WHEN s.product_code<>'' THEN y.product_code=s.product_code ELSE y.item=s.item END) ORDER BY yb.bill_date DESC, y.id DESC LIMIT 1) AS last_price
    FROM shipments s LEFT JOIN sales_bill_lines x ON x.source_type='ship' AND x.source_id=s.id AND x.active=1 LEFT JOIN sales_bills b ON b.id=x.bill_id
    LEFT JOIN ship_instructions i ON i.shipment_id=s.id AND i.status='shipped' LEFT JOIN sales_order_lines ol ON ol.id=i.order_line_id LEFT JOIN sales_orders o ON o.id=ol.order_id
    WHERE ${where.join(' AND ')} ORDER BY s.ship_date, s.id LIMIT 10001`).all(...args);
  if (rows.length > 10000) throw bad('출하 줄이 너무 많습니다. 기간이나 고객사로 좁히세요.');
  rows.sort((a, b) => stockCompare(a.received_date, b.received_date) || stockCompare(a.vendor, b.vendor));
  const lines = rows.map(r => {
    const category = RS_ORDER.includes(r.category) ? r.category : '미분류', billed = r.billed_supply != null;
    const price = billed ? r.billed_price : r.order_price ?? r.table_price ?? r.last_price ?? null;
    const estimate = !billed && price != null ? billTrunc(r.qty * price) : 0;
    return { ...r, category, unit_price: price, confirmed: billed ? r.billed_supply : 0, estimate, remaining: billed ? 0 : r.qty, unpriced: !billed && price == null, state: billed ? 'billed' : 'open',
      vat: billed ? (r.billed_vat || 0) : Math.trunc(estimate * 0.1) };
  });
  const { categories, vendors } = rsSummary(lines);
  return { from, to, vendor: customer, categories, vendors, freight: { total: 0, bills: 0 }, lines: lines.slice(0, 3000), more: lines.length > 3000, line_count: lines.length };
});
// ── 영업: 매출전표·입금·기간별 거래보고·매출 마감 (15.81) ──
// 물류가 잡은 출하 줄(전표 없는 것)이나 직접 입력 줄로 매출전표(SB-…)를 만든다. 금액은 원 미만 절사,
// 부가세는 공급가액 합계의 10%(영세·면세 0)이고 줄마다 나눠 적는다(끝 줄이 나머지를 받아 합이 맞음).
// 입금(payment)은 잔액에서 빼고 기초 미수금(opening)은 더한다. 고객사·월 마감 뒤에는 그 달 전표·입금을 만들거나 취소할 수 없다.
const SHIP_SOURCE = `SELECT 'ship' AS source_type, s.id AS source_id, s.ship_date, s.customer, s.item, s.spec, s.unit, s.product_code, s.lot, s.qty, s.note AS ship_note, COALESCE(${CODE_CAT('s.product_code')}, '') AS item_category,
  (SELECT x.unit_price FROM sales_bill_lines x JOIN sales_bills b ON b.id=x.bill_id WHERE x.active=1 AND REPLACE(LOWER(b.customer),' ','')=REPLACE(LOWER(s.customer),' ','')
     AND (CASE WHEN s.product_code<>'' THEN x.product_code=s.product_code ELSE x.item=s.item END) ORDER BY b.bill_date DESC, x.id DESC LIMIT 1) AS last_price,
  (SELECT ol.unit_price FROM sales_order_lines ol JOIN sales_orders o ON o.id=ol.order_id WHERE o.status='open' AND ol.unit_price IS NOT NULL AND REPLACE(LOWER(o.customer),' ','')=REPLACE(LOWER(s.customer),' ','')
     AND (CASE WHEN s.product_code<>'' THEN ol.product_code=s.product_code ELSE ol.item=s.item END) ORDER BY o.order_date DESC, ol.id DESC LIMIT 1) AS order_price
  ,(SELECT p.unit_price FROM item_prices p JOIN boms bm ON bm.id=p.bom_id WHERE p.side='sales' AND p.active=1 AND p.vendor_key=REPLACE(LOWER(s.customer),' ','') AND s.product_code<>'' AND bm.product_code=s.product_code AND p.valid_from<=s.ship_date ORDER BY p.valid_from DESC, p.id DESC LIMIT 1) AS table_price
  FROM shipments s WHERE NOT EXISTS(SELECT 1 FROM sales_bill_lines x WHERE x.source_type='ship' AND x.source_id=s.id AND x.active=1)`;
const customerKey = v => `REPLACE(LOWER(${v}),' ','')`;
const requireSales = user => { if (!hasRole(user, 'sales')) throw new HttpError(403, '매출전표는 영업 담당자가 처리합니다.'); };
// 15.109 입금확인은 구매 메뉴로 옮겨 구매·영업 담당자가 함께 한다(입금 기록은 거래처 원장 잔액에 그대로 반영).
const requirePayments = user => { if (!hasRole(user, 'sales') && !hasRole(user, 'purchase')) throw new HttpError(403, '입금확인은 구매·영업 담당자가 처리합니다.'); };
async function salesClosed(customer, date) {
  return db.prepare("SELECT * FROM sales_closings WHERE period=? AND customer_key=? AND status='closed'").get(String(date).slice(0, 7), nameKey(customer));
}
const closedMessage = (customer, date, what) => `${customer}의 ${String(date).slice(0, 7)} 매출은 마감되었습니다. 마감 취소(관리자) 뒤에 ${what}.`;
async function unbilledShipments({ customer = '', from = '', to = '', limit = 500 } = {}) {
  const where = [], args = [];
  if (customer) { where.push(`${customerKey('s.customer')}=?`); args.push(nameKey(customer)); }
  if (from) { where.push('s.ship_date>=?'); args.push(from); }
  if (to) { where.push('s.ship_date<=?'); args.push(to); }
  return db.prepare(`${SHIP_SOURCE}${where.length ? ' AND ' + where.join(' AND ') : ''} ORDER BY s.ship_date, s.id LIMIT ${limit + 1}`).all(...args);
}
async function salesBillDetail(bill) {
  const lines = await db.prepare(`SELECT l.*, ${LINE_CAT('l')} AS category, i.status AS ship_status, o.order_no, o.customer_po, o.note AS order_note FROM sales_bill_lines l LEFT JOIN ship_instructions i ON i.bill_line_id=l.id
    LEFT JOIN sales_order_lines ol ON ol.id=l.order_line_id LEFT JOIN sales_orders o ON o.id=ol.order_id WHERE l.bill_id=? ORDER BY l.id`).all(bill.id);
  for (const l of lines) if (l.source_type === 'ship') l.source_missing = !(await db.prepare('SELECT 1 FROM shipments WHERE id=?').get(l.source_id));
  const invoice = await db.prepare('SELECT i.id, i.invoice_no, i.status FROM tax_invoice_bills t JOIN tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1').get(bill.id);
  const ret = await db.prepare("SELECT id, return_no FROM stock_returns WHERE side='in' AND bill_id=? AND status='confirmed'").get(bill.id);
  const changes = await db.prepare("SELECT summary, changed_by, changed_at FROM doc_changes WHERE doc_type='sales_bill' AND doc_id=? ORDER BY id DESC LIMIT 20").all(bill.id);
  return { ...bill, lines, invoice: invoice || null, closed: !!(await salesClosed(bill.customer, bill.bill_date)), return_ref: ret || null, changes };
}
const optDate = (v, label) => v ? dateStr(v, label) : '';
route('GET', '/api/sales-bills/unbilled', async ({ user, query }) => {
  requireSales(user);
  const rows = await unbilledShipments({ customer: str(query.customer, 100), from: optDate(query.from, '시작일'), to: optDate(query.to, '종료일') });
  return { rows: rows.slice(0, 500), more: rows.length > 500 };
});
route('GET', '/api/sales-bills', async ({ user, query }) => {
  requireSales(user);
  const where = [], args = [];
  applyListDates(where, args, query, 'bill_date');
  if (query.customer) { if (query.party_like === '1') { where.push(`${customerKey('customer')} LIKE ? ESCAPE '\\'`); args.push('%' + nameKey(str(query.customer, 100)).replace(/[\\%_]/g, m => '\\' + m) + '%'); } else { where.push(`${customerKey('customer')}=?`); args.push(nameKey(str(query.customer, 100))); } } // 15.232 일부일치(달력)
  if (query.status) { if (!['confirmed', 'cancelled'].includes(query.status)) throw bad('상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  if (query.rep !== undefined && query.rep !== '') { where.push(`${BILL_REP('sales_bills')}=?`); args.push(query.rep === '미지정' ? '' : repName(query.rep)); } // 15.224
  applyListKeyword(where, args, query.q, ['bill_no', 'customer', 'note', 'created_by', 'sales_rep', "(SELECT group_concat(o.customer_po || ' ' || o.note || ' ' || o.order_no, ' ') FROM sales_bill_lines l JOIN sales_order_lines ol ON ol.id=l.order_line_id JOIN sales_orders o ON o.id=ol.order_id WHERE l.bill_id=sales_bills.id)"]);
  if (query.category) { const c = query.category === '미분류' ? '' : itemCategory(query.category); where.push(BILL_CATEGORY_FILTER('sales_bill_lines', 'sales_bills')); args.push(c); }
  const page = Math.max(0, Math.min(1000, Number(query.page) || 0));
  const by_category = await billCategoryTotals('sales_bill_lines', 'sales_bills', where, args);
  const rows = await db.prepare(`SELECT sales_bills.*, ${BILL_REP('sales_bills')} AS rep, (SELECT return_no || '|' || id FROM stock_returns WHERE side='in' AND bill_id=sales_bills.id AND status='confirmed') AS return_ref, (SELECT COUNT(*) FROM sales_bill_lines l WHERE l.bill_id=sales_bills.id) AS line_count, (SELECT group_concat(DISTINCT c) FROM (SELECT ${LINE_CAT('l')} AS c FROM sales_bill_lines l WHERE l.bill_id=sales_bills.id AND l.active=1)) AS categories, (SELECT i.invoice_no || '|' || i.status || '|' || i.id FROM tax_invoice_bills t JOIN tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=sales_bills.id AND t.active=1) AS invoice FROM sales_bills ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY bill_date DESC, id DESC LIMIT 201 OFFSET ?`).all(...args, page * 200);
  return { rows: rows.slice(0, 200), page, more: rows.length > 200, by_category };
});
// 15.166 매출 달력: 그 달 확정 매출전표를 일자별로(건수·공급가액·세액·합계). 거래처로 거를 수 있다.
route('GET', '/api/sales-calendar', async ({ user, query }) => {
  requireSales(user);
  const month = String(query.month || today().slice(0, 7)); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('연·월을 확인하세요.');
  const where = ["status='confirmed'", 'bill_date>=?', 'bill_date<=?'], args = [`${month}-01`, monthEnd(month)];
  if (query.customer) { where.push(`${customerKey('customer')} LIKE ? ESCAPE '\\'`); args.push('%' + nameKey(str(query.customer, 100)).replace(/[\\%_]/g, m => '\\' + m) + '%'); } // 15.232 거래처 일부일치(예: 세기·섬유 → 세기섬유)
  if (query.rep !== undefined && query.rep !== '') { where.push(`${BILL_REP('sales_bills')}=?`); args.push(query.rep === '미지정' ? '' : repName(query.rep)); } // 15.224
  const days = await db.prepare(`SELECT bill_date AS date, COUNT(*) AS n, COALESCE(SUM(supply_total),0) AS supply, COALESCE(SUM(vat_total),0) AS vat, COALESCE(SUM(total),0) AS total FROM sales_bills WHERE ${where.join(' AND ')} GROUP BY bill_date ORDER BY bill_date`).all(...args);
  const sum = k => days.reduce((t, d) => t + d[k], 0);
  return { month, days, totals: { n: sum('n'), supply: sum('supply'), vat: sum('vat'), total: sum('total') } };
});
// 15.176 매입 달력: 확정 매입전표를 날짜별로(매출 달력과 같은 모양)
route('GET', '/api/purchase-calendar', async ({ user, query }) => {
  requirePurchase(user);
  const month = String(query.month || today().slice(0, 7)); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('연·월을 확인하세요.');
  const where = ["status='confirmed'", 'bill_date>=?', 'bill_date<=?'], args = [`${month}-01`, monthEnd(month)];
  if (query.vendor) { where.push(`${billVendorKey('vendor')} LIKE ? ESCAPE '\\'`); args.push('%' + nameKey(str(query.vendor, 100)).replace(/[\\%_]/g, m => '\\' + m) + '%'); } // 15.232 거래처 일부일치(예: 세기·섬유 → 세기섬유)
  const days = await db.prepare(`SELECT bill_date AS date, COUNT(*) AS n, COALESCE(SUM(supply_total),0) AS supply, COALESCE(SUM(vat_total),0) AS vat, COALESCE(SUM(total),0) AS total FROM purchase_bills WHERE ${where.join(' AND ')} GROUP BY bill_date ORDER BY bill_date`).all(...args);
  const sum = k => days.reduce((t, d) => t + d[k], 0);
  return { month, days, totals: { n: sum('n'), supply: sum('supply'), vat: sum('vat'), total: sum('total') } };
});
route('GET', '/api/sales-bills/:id', async ({ user, params }) => { requireSales(user); return salesBillDetail(await mustGet('sales_bills', params.id)); });
// ── 15.224 영업담당자 ──
// 전표 담당자가 비어 있으면 거래처 기본 담당자로 본다(기존 전표를 고치지 않고 집계).
function BILL_REP(t) { return `COALESCE(NULLIF(${t}.sales_rep,''), (SELECT v.sales_rep FROM vendors v WHERE v.name_key=${customerKey(t + '.customer')}), '')`; }
// 담당자는 금액과 상관없어 마감·세금계산서와 관계없이 바꿀 수 있다(이력에 남김).
route('PUT', '/api/sales-bills/:id/rep', async ({ user, params, body }) => {
  requireSales(user);
  const bill = await mustGet('sales_bills', params.id), rep = repName(body.sales_rep);
  if (rep === (bill.sales_rep || '')) return salesBillDetail(bill);
  await db.batch([{ sql: 'UPDATE sales_bills SET sales_rep=? WHERE id=?', args: [rep, bill.id] }, docChange('sales_bill', bill.id, `영업담당자 ${bill.sales_rep || '(없음)'}→${rep || '(없음)'}`, user)]);
  return salesBillDetail(await mustGet('sales_bills', bill.id));
});
// 고를 수 있는 담당자: 영업 권한 사용자 + 거래처·전표에 이미 쓰인 이름
// 15.228 영업팀만: 조직에서 이름에 「영업」이 들어간 부서와 그 하위 부서에 속한 승인 사용자. 그런 부서·사람이 없으면 영업 권한(관리자 제외) 사용자.
async function salesTeam() {
  const deps = await db.prepare('SELECT id, name, parent_id FROM org_departments').all();
  const ids = new Set(deps.filter(d => d.name.includes('영업')).map(d => d.id));
  for (let grew = true; grew;) { grew = false; for (const d of deps) if (!ids.has(d.id) && ids.has(d.parent_id)) { ids.add(d.id); grew = true; } }
  const departments = deps.filter(d => ids.has(d.id)).map(d => d.name), inTeam = new Set(departments);
  const users = await db.prepare("SELECT name, department, roles, is_admin FROM users WHERE approval_status='approved'").all();
  let team = users.filter(u => inTeam.has(u.department)).map(u => u.name), basis = 'department';
  if (!team.length) { team = users.filter(u => !u.is_admin && (u.roles || '').split(',').includes('sales')).map(u => u.name); basis = 'role'; }
  return { team: team.sort((a, b) => a.localeCompare(b, 'ko')), basis, departments };
}
// 고를 수 있는 담당자(reps) = 영업팀. used = 거래처·전표에 이미 쓰인 다른 이름(목록 거르기에서만 보임).
route('GET', '/api/sales-reps', async ({ user }) => {
  requireSales(user);
  const { team, basis, departments } = await salesTeam(), set = new Set(team);
  const used = (await db.prepare("SELECT sales_rep AS n FROM vendors WHERE sales_rep<>'' UNION SELECT sales_rep FROM sales_bills WHERE sales_rep<>''").all()).map(r => r.n).filter(n => !set.has(n)).sort((a, b) => a.localeCompare(b, 'ko'));
  return { reps: team, used, basis, departments };
});
// 담당자별 담당업체 현황: 기간 안 확정 매출(건수·공급가액·세액·합계·마지막 일자) + 담당 거래처(매출 없어도) + 미수 잔액
route('GET', '/api/sales-reps/summary', async ({ user, query }) => {
  requireSales(user);
  const where = ["b.status='confirmed'"], args = [];
  applyListDates(where, args, query, 'b.bill_date');
  const repF = query.rep !== undefined && query.rep !== '' ? (query.rep === '미지정' ? '' : repName(query.rep)) : null;
  const sales = await db.prepare(`SELECT ${BILL_REP('b')} AS rep, ${customerKey('b.customer')} AS k, MIN(b.customer) AS customer, COUNT(*) AS n, COALESCE(SUM(b.supply_total),0) AS supply, COALESCE(SUM(b.vat_total),0) AS vat, COALESCE(SUM(b.total),0) AS total, MAX(b.bill_date) AS last_date FROM sales_bills b WHERE ${where.join(' AND ')} GROUP BY rep, k LIMIT 5001`).all(...args);
  const vendors = await db.prepare("SELECT name, name_key AS k, sales_rep AS rep, code FROM vendors WHERE sales_rep<>'' OR is_sales=1").all();
  const balance = new Map((await agingData('sales', today())).rows.map(r => [nameKey(r.name), r.balance]));
  const map = new Map(), key = (rep, k) => rep + '\u0001' + k;
  for (const v of vendors) if (v.rep) map.set(key(v.rep, v.k), { rep: v.rep, customer: v.name, code: v.code || '', assigned: true, n: 0, supply: 0, vat: 0, total: 0, last_date: null });
  const assignedOf = new Map(vendors.map(v => [v.k, v]));
  for (const s of sales) {
    const id = key(s.rep, s.k), v = assignedOf.get(s.k), row = map.get(id) || { rep: s.rep, customer: v ? v.name : s.customer, code: v?.code || '', assigned: !!(v && v.rep === s.rep), n: 0, supply: 0, vat: 0, total: 0, last_date: null };
    Object.assign(row, { n: s.n, supply: s.supply, vat: s.vat, total: s.total, last_date: s.last_date }); map.set(id, row);
  }
  let rows = [...map.values()].map(r => ({ ...r, balance: balance.get(nameKey(r.customer)) || 0 }));
  if (repF !== null) rows = rows.filter(r => r.rep === repF);
  const reps = new Map();
  for (const r of rows) { const g = reps.get(r.rep) || { rep: r.rep, customers: 0, active: 0, n: 0, supply: 0, vat: 0, total: 0, balance: 0 }; g.customers++; if (r.n) g.active++; for (const f of ['n', 'supply', 'vat', 'total', 'balance']) g[f] += r[f]; reps.set(r.rep, g); }
  const order = (a, b) => (a.rep === '') - (b.rep === '') || b.total - a.total || a.rep.localeCompare(b.rep, 'ko');
  rows.sort((a, b) => order(a, b) || b.total - a.total || a.customer.localeCompare(b.customer, 'ko'));
  return { reps: [...reps.values()].sort(order), rows };
});
// 부가세를 줄마다 나눈다: 줄 공급가액의 10% 절사, 합이 전표 부가세와 다르면 금액이 가장 큰 줄이 차이를 받는다.
function splitVat(lines, vat) {
  const out = lines.map(l => (vat ? billTrunc(l.supply * 0.1) : 0));
  const diff = vat - out.reduce((t, v) => t + v, 0);
  if (diff && lines.length) { let big = 0; lines.forEach((l, i) => { if (l.supply > lines[big].supply) big = i; }); out[big] += diff; }
  return out;
}
route('POST', '/api/sales-bills', async ({ user, body }) => {
  requireSales(user);
  const token = String(body.request_id || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw bad('등록 요청 번호를 확인하세요.');
  const prior = await db.prepare('SELECT * FROM sales_bills WHERE request_id=?').get(token);
  if (prior) { if (prior.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.'); return { ...await salesBillDetail(prior), duplicate: true }; }
  const customer = reqStr(body.customer, '거래처', 100), date = dateStr(body.bill_date, '전표 일자');
  if (date > today()) throw bad('전표 일자는 오늘 이전으로 선택하세요.');
  if (await salesClosed(customer, date)) throw bad(closedMessage(customer, date, '등록하세요'));
  const taxType = body.tax_type === 'zero' ? 'zero' : 'taxable';
  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length || input.length > 200) throw bad('전표 줄은 1~200줄 넣으세요.');
  const lines = [], seen = new Set(), seenOrder = new Set();
  for (const [index, raw] of input.entries()) {
    const l = raw && typeof raw === 'object' ? raw : {}, no = `${index + 1}번째 줄`;
    const price = l.unit_price === undefined || l.unit_price === '' || l.unit_price === null ? null : num(l.unit_price, `${no} 단가`);
    if (l.source_type === 'ship') {
      const id = Number(l.source_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad(`${no}: 출하 줄을 다시 고르세요.`);
      if (seen.has(id)) throw bad(`${no}: 같은 출하 줄이 두 번 들어 있습니다.`); seen.add(id);
      const src = await db.prepare(`${SHIP_SOURCE} AND s.id=?`).get(id);
      if (!src) throw new HttpError(409, `${no}: 이미 다른 전표에 들어갔거나 지워진 출하입니다. 목록을 새로 불러오세요.`);
      if (nameKey(src.customer) !== nameKey(customer)) throw bad(`${no}: 다른 거래처(${src.customer})의 출하입니다.`);
      if (price == null) throw bad(`${no}(${src.item}): 단가를 넣으세요.`);
      if (price < 0) throw bad(`${no}: 단가는 0 이상이어야 합니다.`);
      lines.push({ source_type: 'ship', source_id: id, item: src.item, spec: src.spec || '', unit: src.unit || '', product_code: src.product_code || '', lot: src.lot || '', ship_date: src.ship_date, qty: src.qty, unit_price: price, supply: billTrunc(src.qty * price), note: str(l.note, 200) });
    } else if (l.source_type === 'order') {
      // 수주 줄에서 나눠 잡기(15.92): 남은 수량까지만. 저장은 직접 입력 줄(manual)+order_line_id, 물류에 출하지시가 함께 생긴다.
      const id = Number(l.order_line_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad(`${no}: 수주 줄을 다시 고르세요.`);
      if (seenOrder.has(id)) throw bad(`${no}: 같은 수주 줄이 두 번 들어 있습니다. 수량을 한 줄로 합치세요.`); seenOrder.add(id);
      const ol = await db.prepare(`SELECT ol.*, o.status, o.customer, o.order_no, o.tax_type, ${ORDER_TAKEN} AS billed_qty FROM sales_order_lines ol JOIN sales_orders o ON o.id=ol.order_id WHERE ol.id=?`).get(id);
      if (!ol) throw bad(`${no}: 수주 줄을 찾을 수 없습니다. 새로 불러오세요.`);
      if (ol.status !== 'open') throw new HttpError(409, `${no}: 수주 ${ol.order_no}는 마감·취소되었습니다.`);
      if (nameKey(ol.customer) !== nameKey(customer)) throw bad(`${no}: 다른 거래처(${ol.customer})의 수주입니다.`);
      if (ol.tax_type !== taxType) throw new HttpError(409, `${no}: 수주 ${ol.order_no}는 ${ol.tax_type === 'zero' ? '영세·면세' : '과세'}입니다. 전표의 과세 구분을 맞추세요.`);
      const qty = num(l.qty, `${no} 수량`); if (!(qty > 0)) throw bad(`${no}: 수량은 0보다 커야 합니다.`);
      const left = stockRound(ol.qty - ol.billed_qty);
      if (qty > left + 0.000001) throw new HttpError(409, `${no}(${ol.item}): 수주 ${ol.order_no}의 남은 수량은 ${left}입니다.`);
      const unitPrice = price == null ? ol.unit_price : price;
      if (unitPrice == null) throw bad(`${no}(${ol.item}): 단가를 넣으세요.`);
      if (unitPrice < 0) throw bad(`${no}: 단가는 0 이상이어야 합니다.`);
      lines.push({ source_type: 'manual', source_id: null, order_line_id: id, order_qty: ol.qty, bom_id: ol.bom_id, item: ol.item, spec: ol.spec || '', unit: ol.unit || '', product_code: ol.product_code || '', lot: '', ship_date: '', qty, unit_price: unitPrice, supply: billTrunc(qty * unitPrice), note: str(l.note, 200) });
    } else if (l.source_type === 'manual') {
      const item = reqStr(l.item, `${no} 품목`, 200), qty = num(l.qty, `${no} 수량`);
      if (!(qty > 0)) throw bad(`${no}: 수량은 0보다 커야 합니다.`);
      if (price == null) throw bad(`${no}(${item}): 단가를 넣으세요.`);
      if (price < 0) throw bad(`${no}: 단가는 0 이상이어야 합니다.`);
      lines.push({ source_type: 'manual', source_id: null, item, spec: str(l.spec, 100), unit: str(l.unit, 20), product_code: str(l.product_code, 100), lot: str(l.lot, 100), ship_date: '', qty, unit_price: price, supply: billTrunc(qty * price), note: str(l.note, 200) });
    } else throw bad(`${no}: 줄 구분을 확인하세요.`);
  }
  for (const l of lines) l.item_category = await lineCategory({ given: l.item_category, bom_id: l.bom_id, product_code: l.product_code, item: l.item });
  const supply = lines.reduce((t, l) => t + l.supply, 0);
  const vat = taxType === 'zero' ? 0 : billTrunc(supply * 0.1), total = supply + vat, vats = splitVat(lines, vat);
  const prefix = `SB-${today().slice(2).replace(/-/g, '')}-`, BID = '(SELECT id FROM sales_bills WHERE request_id=?)';
  const rep = repName(body.sales_rep) || (await db.prepare('SELECT sales_rep FROM vendors WHERE name_key=?').get(nameKey(customer)))?.sales_rep || ''; // 15.224 영업담당자
  const cmds = [{ sql: `INSERT INTO sales_bills(bill_no,bill_date,customer,tax_type,supply_total,vat_total,total,note,created_by,created_by_id,request_id,sales_rep) VALUES(${nextDocNo('sales_bills', 'bill_no')},?,?,?,?,?,?,?,?,?,?,?)`,
    args: [prefix, prefix, prefix, date, customer, taxType, supply, vat, total, str(body.note, 500), user.name, user.id, token, rep] }];
  lines.forEach((l, i) => {
    if (!l.order_line_id && l.source_type === 'ship') {
      cmds.push({ sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note,order_line_id) SELECT ${BID},?,?,?,?,?,?,?,?,?,?,?,?,?,?,
        (SELECT i.order_line_id FROM ship_instructions i WHERE i.shipment_id=? AND i.status='shipped' LIMIT 1)
        WHERE EXISTS(SELECT 1 FROM shipments WHERE id=?)
          AND NOT EXISTS(SELECT 1 FROM ship_instructions i JOIN sales_order_lines ol ON ol.id=i.order_line_id JOIN sales_orders o ON o.id=ol.order_id WHERE i.shipment_id=? AND i.status='shipped' AND (${customerKey('o.customer')}<>? OR o.status='cancelled'))`,
        args: [token, l.item_category, l.source_type, l.source_id, l.item, l.spec, l.unit, l.product_code, l.lot, l.ship_date, l.qty, l.unit_price, l.supply, vats[i], l.note, l.source_id, l.source_id, l.source_id, nameKey(customer)] }, RC_GUARD); return; }
    if (!l.order_line_id) { cmds.push({ sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note) VALUES(${BID},?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [token, l.item_category, l.source_type, l.source_id, l.item, l.spec, l.unit, l.product_code, l.lot, l.ship_date, l.qty, l.unit_price, l.supply, vats[i], l.note] }); return; }
    // 그 사이 다른 전표가 잔량을 가져갔거나 수주가 마감되면 넣지 않고(RC_GUARD) 전체를 되돌린다.
    cmds.push({ sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note,order_line_id) SELECT ${BID},?,'manual',NULL,?,?,?,?,'','',?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM sales_order_lines ol JOIN sales_orders o ON o.id=ol.order_id WHERE ol.id=? AND o.status='open')
        AND (SELECT COALESCE(SUM(b.qty),0) FROM sales_bill_lines b WHERE b.order_line_id=? AND b.active=1)
          + (SELECT COALESCE(SUM(i.qty),0) FROM ship_instructions i WHERE i.order_line_id=? AND i.status='shipped' AND NOT EXISTS(SELECT 1 FROM sales_bill_lines x WHERE x.source_type='ship' AND x.source_id=i.shipment_id AND x.active=1)) + ? <= ? + 0.000001`,
      args: [token, l.item_category, l.item, l.spec, l.unit, l.product_code, l.qty, l.unit_price, l.supply, vats[i], l.note, l.order_line_id, l.order_line_id, l.order_line_id, l.order_line_id, l.qty, l.order_qty] }, RC_GUARD,
    { sql: `INSERT INTO ship_instructions(bill_id,bill_line_id,order_line_id,customer,bom_id,product_code,item,spec,unit,qty,ship_date,note,created_by)
      SELECT b.id, l.id, ?, b.customer, ?, l.product_code, l.item, l.spec, l.unit, l.qty, b.bill_date, l.note, ? FROM sales_bills b JOIN sales_bill_lines l ON l.bill_id=b.id WHERE b.request_id=? AND l.order_line_id=?`,
      args: [l.order_line_id, l.bom_id, user.name, token, l.order_line_id] });
  });
  try { await db.batch(cmds); }
  catch (error) {
    const saved = await db.prepare('SELECT * FROM sales_bills WHERE request_id=?').get(token);
    if (saved && saved.created_by_id === user.id) return { ...await salesBillDetail(saved), duplicate: true };
    if (isGuardError(error)) throw new HttpError(409, '그 사이 수주 잔량이 바뀌었거나 수주가 마감되었거나 출하가 삭제되었습니다. 새로 불러와 다시 고르세요.');
    if (/UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '그 사이 같은 출하 줄이 다른 전표에 들어갔습니다. 목록을 새로 불러와 다시 고르세요.');
    throw error;
  }
  return salesBillDetail(await db.prepare('SELECT * FROM sales_bills WHERE request_id=?').get(token));
});
route('POST', '/api/sales-bills/:id/cancel', async ({ user, params, body }) => {
  requireSales(user);
  const bill = await mustGet('sales_bills', params.id);
  if (bill.status !== 'confirmed') throw bad('이미 취소된 전표입니다.');
  const ret = await returnOfBill('in', bill.id); if (ret) throw bad(`반입 ${ret.return_no}로 생긴 전표입니다. 반입 목록에서 그 반입을 취소하세요.`);
  if (await salesClosed(bill.customer, bill.bill_date)) throw bad(closedMessage(bill.customer, bill.bill_date, '취소하세요'));
  const invoice = await db.prepare('SELECT i.invoice_no, i.status FROM tax_invoice_bills t JOIN tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1').get(bill.id);
  if (invoice) throw new HttpError(409, `세금계산서 ${invoice.invoice_no}에 담긴 전표입니다. ${invoice.status === 'draft' || invoice.status === 'failed' ? '세금계산서 관리에서 담기 취소한 뒤 취소하세요.' : '발행된 계산서는 수정세금계산서로 처리하세요.'}`);
  const reason = reqStr(body.reason, '취소 사유', 200);
  const results = await db.batch([
    { sql: "UPDATE sales_bill_lines SET active=0 WHERE bill_id=? AND EXISTS(SELECT 1 FROM sales_bills WHERE id=? AND status='confirmed') AND NOT EXISTS(SELECT 1 FROM tax_invoice_bills WHERE bill_id=? AND active=1)", args: [bill.id, bill.id, bill.id] },
    { sql: "UPDATE ship_instructions SET status='cancelled',processed_by=?,processed_at=? WHERE bill_id=? AND status='pending' AND EXISTS(SELECT 1 FROM sales_bills WHERE id=? AND status='confirmed') AND NOT EXISTS(SELECT 1 FROM tax_invoice_bills WHERE bill_id=? AND active=1)", args: [user.name, now(), bill.id, bill.id, bill.id] },
    { sql: "UPDATE sales_bills SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed' AND NOT EXISTS(SELECT 1 FROM tax_invoice_bills WHERE bill_id=? AND active=1)", args: [now(), user.name, reason, bill.id, bill.id] },
  ]);
  if (!results.at(-1).meta.changes) throw new HttpError(409, '이미 처리됐거나 그 사이 세금계산서에 담긴 전표입니다. 새로 불러오세요.');
  return salesBillDetail(await mustGet('sales_bills', bill.id));
});
// 입금·기초 미수금
route('GET', '/api/sales-payments', async ({ user, query }) => {
  requirePayments(user);
  const where = [], args = [];
  applyListDates(where, args, query, 'pay_date');
  if (query.customer) { where.push(`${customerKey('customer')}=?`); args.push(nameKey(str(query.customer, 100))); }
  if (query.status) { if (!['confirmed', 'cancelled'].includes(query.status)) throw bad('상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  applyListKeyword(where, args, query.q, ['customer', 'method', 'note', 'created_by']);
  const rows = await db.prepare(`SELECT * FROM sales_payments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pay_date DESC, id DESC LIMIT 501`).all(...args);
  return { rows: rows.slice(0, 500), more: rows.length > 500 };
});
route('POST', '/api/sales-payments', async ({ user, body }) => {
  requirePayments(user);
  const token = String(body.request_id || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw bad('등록 요청 번호를 확인하세요.');
  const prior = await db.prepare('SELECT * FROM sales_payments WHERE request_id=?').get(token);
  if (prior) { if (prior.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.'); return { ...prior, duplicate: true }; }
  const customer = reqStr(body.customer, '거래처', 100), date = dateStr(body.pay_date, '입금일');
  if (date > today()) throw bad('입금일은 오늘 이전으로 선택하세요.');
  const kind = body.kind === 'opening' ? 'opening' : 'payment';
  const amount = num(body.amount, '금액'); if (!(amount > 0)) throw bad('금액은 0보다 커야 합니다.');
  if (await salesClosed(customer, date)) throw bad(closedMessage(customer, date, '등록하세요'));
  await ensureVendor(customer, user, 'sales');
  const noteInfo = kind === 'payment' ? await paymentNoteInfo(body.note_info, 'sales', customer, date, billTrunc(amount)) : null; // 15.268 어음이면 어음 관리에도
  if (noteInfo) { requirePayments(user);
    try { await db.batch([{ sql: 'INSERT INTO sales_payments(pay_date,customer,kind,amount,method,note,created_by,created_by_id,request_id) VALUES(?,?,?,?,?,?,?,?,?)', args: [date, customer, kind, billTrunc(amount), str(body.method, 50) || `어음 ${noteInfo.note_no}`, str(body.note, 200), user.name, user.id, token] }, ...paymentNoteCmds(noteInfo, 'sales', 'sales_payments', token, user)]); }
    catch (error) { if (isGuardError(error)) throw new HttpError(409, `${NOTE_KIND[noteInfo.kind]} ${noteInfo.note_no}는 이미 등록되어 있습니다.`); const saved = await db.prepare('SELECT * FROM sales_payments WHERE request_id=?').get(token); if (saved && saved.created_by_id === user.id) return { ...saved, duplicate: true }; throw error; }
    return { ...await db.prepare('SELECT * FROM sales_payments WHERE request_id=?').get(token), bill_note: await db.prepare('SELECT * FROM bill_notes WHERE request_id=?').get('pay:' + token) };
  }
  try { await db.prepare('INSERT INTO sales_payments(pay_date,customer,kind,amount,method,note,created_by,created_by_id,request_id) VALUES(?,?,?,?,?,?,?,?,?)').run(date, customer, kind, billTrunc(amount), str(body.method, 50), str(body.note, 200), user.name, user.id, token); }
  catch (error) { const saved = await db.prepare('SELECT * FROM sales_payments WHERE request_id=?').get(token); if (saved && saved.created_by_id === user.id) return { ...saved, duplicate: true }; throw error; }
  return db.prepare('SELECT * FROM sales_payments WHERE request_id=?').get(token);
});
route('POST', '/api/sales-payments/:id/cancel', async ({ user, params, body }) => {
  requirePayments(user);
  const row = await mustGet('sales_payments', params.id);
  if (row.status !== 'confirmed') throw bad('이미 취소된 입금입니다.');
  const ret = await db.prepare("SELECT return_no FROM stock_returns WHERE side='in' AND payment_id=? AND status='confirmed'").get(row.id); if (ret) throw bad(`반입 ${ret.return_no}의 현금 환불입니다. 반입 목록에서 그 반입을 취소하세요.`); // 15.141
  if (await salesClosed(row.customer, row.pay_date)) throw bad(closedMessage(row.customer, row.pay_date, '취소하세요'));
  const reason = reqStr(body.reason, '취소 사유', 200);
  const linked = await db.prepare("SELECT * FROM bill_notes WHERE payment_side='sales' AND payment_id=? AND status<>'cancelled'").get(row.id); // 15.268
  if (linked?.status === 'collected') throw bad(`이 입금의 어음 ${linked.note_no}는 만기회수 처리되었습니다. 어음 관리에서 미처리로 되돌린 뒤 취소하세요.`);
  const r = await db.prepare("UPDATE sales_payments SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed'").run(now(), user.name, reason, row.id);
  if (!r.changes) throw new HttpError(409, '이미 처리된 입금입니다.');
  if (linked) await db.batch([{ sql: "UPDATE bill_notes SET status='cancelled',updated_by=?,updated_at=? WHERE id=? AND status<>'cancelled'", args: [user.name, now(), linked.id] }, docChange('note', linked.id, `입금 취소로 함께 삭제 · ${reason}`, user)]);
  return mustGet('sales_payments', row.id);
});
// 기간별 거래보고(거래처 원장): 기초잔액 + 기간 안의 매출(전표 줄)·입금·기초 미수금, 줄마다 잔액. 거래처가 없으면 거래처별 요약.
async function ledgerBefore(from, customer = '') {
  const filter = customer ? ` AND ${customerKey('customer')}=?` : '', args = customer ? [from, nameKey(customer)] : [from];
  const sales = await db.prepare(`SELECT ${customerKey('customer')} AS k, MIN(customer) AS customer, SUM(total) AS t FROM sales_bills WHERE status='confirmed' AND bill_date<?${filter} GROUP BY k`).all(...args);
  const pays = await db.prepare(`SELECT ${customerKey('customer')} AS k, MIN(customer) AS customer, SUM(CASE WHEN kind='opening' THEN amount ELSE -amount END) AS t FROM sales_payments WHERE status='confirmed' AND pay_date<?${filter} GROUP BY k`).all(...args);
  const map = new Map();
  for (const r of [...sales, ...pays]) { const g = map.get(r.k) || { customer: r.customer, opening: 0 }; g.opening += r.t || 0; map.set(r.k, g); }
  return map;
}
// ── 15.115 채권·채무 연령표: 기준일까지의 미결 잔액을 전표 일자 나이로 나눈다. 입금·지급은 오래된 전표(기초 잔액 먼저)부터 갚은 것으로 본다(선입선출). ──
// 잔액이 음수면 선수금(매출)·선급금(매입)으로 따로 보인다.
const AGING_BUCKETS = [[30, '0~30일'], [60, '31~60일'], [90, '61~90일'], [180, '91~180일'], [Infinity, '180일 초과']];
route('GET', '/api/aging', async ({ user, query }) => {
  const side = query.side === 'purchase' ? 'purchase' : query.side === 'sales' ? 'sales' : null; if (!side) throw bad('매출·매입을 고르세요.');
  if (side === 'sales') requireSales(user); else requirePurchase(user);
  const data = await agingData(side, query.asof ? dateStr(query.asof, '기준일') : today());
  return { ...data, rows: data.rows.map(({ aged, ...r }) => r) };
});
async function agingData(side, asof) {
  const [bills, pays, col] = side === 'sales' ? ['sales_bills', 'sales_payments', 'customer'] : ['purchase_bills', 'purchase_payments', 'vendor'];
  const key = side === 'sales' ? customerKey('customer') : billVendorKey('vendor');
  const debits = await db.prepare(`SELECT k, MIN(name) AS name, d, SUM(amt) AS amt FROM (
      SELECT ${key} AS k, ${col} AS name, bill_date AS d, total AS amt FROM ${bills} WHERE status='confirmed' AND bill_date<=?
      UNION ALL SELECT ${key} AS k, ${col} AS name, pay_date AS d, amount AS amt FROM ${pays} WHERE status='confirmed' AND kind='opening' AND pay_date<=?)
    GROUP BY k, d, amt<0 ORDER BY k, d LIMIT 200001`).all(asof, asof); // 15.141 같은 날 반품(음수)은 따로 묶어 크레딧으로
  if (debits.length > 200000) throw bad('전표가 너무 많습니다.');
  const credits = new Map((await db.prepare(`SELECT ${key} AS k, MIN(${col}) AS name, SUM(amount) AS paid FROM ${pays} WHERE status='confirmed' AND kind='payment' AND pay_date<=? GROUP BY k`).all(asof)).map(r => [r.k, r]));
  const day = d => Date.parse(d + 'T00:00:00Z') / 864e5, now = day(asof);
  const groups = new Map();
  for (const r of debits) { if (!groups.has(r.k)) groups.set(r.k, { name: r.name, lines: [] }); groups.get(r.k).lines.push(r); }
  for (const [k, c] of credits) if (!groups.has(k)) groups.set(k, { name: c.name, lines: [] });
  const rows = [];
  for (const [k, g] of groups) {
    // 15.141 반입·반출(음수 전표)은 입금·지급처럼 오래된 전표부터 갚은 것으로 본다(날짜가 늦어도 새 전표에 붙지 않게).
    let paid = (credits.get(k)?.paid || 0) - g.lines.filter(l => l.amt < 0).reduce((t, l) => t + l.amt, 0); const total = g.lines.reduce((t, l) => t + l.amt, 0);
    const buckets = AGING_BUCKETS.map(() => 0), aged = []; let oldest = null;
    for (const l of g.lines.filter(x => x.amt > 0)) { // 날짜 순: 오래된 것부터 갚음
      const take = Math.min(Math.max(paid, 0), l.amt); paid -= take; const left = l.amt - take;
      if (left > 0.000001) { const age = now - day(l.d); buckets[AGING_BUCKETS.findIndex(([max]) => age <= max)] += left; aged.push({ age, left }); oldest ??= l.d; }
    }
    const balance = total - (credits.get(k)?.paid || 0);
    if (Math.abs(balance) < 0.5 && !buckets.some(Boolean)) continue;
    rows.push({ name: g.name, balance: billTrunc(balance), buckets: buckets.map(billTrunc), advance: billTrunc(Math.max(paid, 0)), oldest, days: oldest ? now - day(oldest) : 0, aged });
  }
  rows.sort((a, b) => b.days - a.days || b.balance - a.balance);
  return { side, asof, labels: AGING_BUCKETS.map(b => b[1]), rows };
}
// ── 15.140 반입(매출 반품)·반출(매입 반품) ──
// 반입 RI-…: 거래처에서 돌아온 제품. 재고를 처리하면 재고에 다시 들어오고(재입고), 금액을 처리하면 음수 매출전표가 생겨 미수금이 줄어든다.
// 반출 RO-…: 매입처로 돌려보낸 자재. 재고를 처리하면 재고에서 빠지고, 금액을 처리하면 음수 매입전표가 생겨 미지급금이 줄어든다.
// 현금 환불이면 같은 금액의 환불 입금(-)·지급(-)을 함께 남겨 잔액은 그대로 두고 매출·매입만 줄인다.
const RET = {
  in: { prefix: 'RI', label: '반입', need: requireSales, closed: (p, d) => salesClosed(p, d), source: 'sales_line', vendorType: 'sales' },
  out: { prefix: 'RO', label: '반출', need: requirePurchase, closed: (p, d) => closedPeriod(p, d), source: 'purchase_line', vendorType: 'purchase' },
};
const RET_PROCESS = { stock_amount: '재고+금액', amount: '금액만', stock: '재고만', none: '처리 안 함' };
const RET_RETURNED = "(SELECT COALESCE(SUM(x.qty),0) FROM stock_return_lines x JOIN stock_returns r ON r.id=x.return_id WHERE r.status='confirmed' AND x.source_type=? AND x.source_id=?)";
// 반품할 줄 고르기: 그 거래처의 최근 매출(납품)·매입 줄과 이미 반품한 수량
route('GET', '/api/returns/sources', async ({ user, query }) => {
  const side = query.side === 'out' ? 'out' : 'in', c = RET[side]; c.need(user);
  const party = reqStr(query.party, '거래처', 100), months = Math.max(1, Math.min(24, Number(query.months) || 6));
  const from = (await db.prepare(`SELECT date(?, '-${months} months') AS d`).get(today())).d;
  const rows = side === 'in'
    ? await db.prepare(`SELECT l.id, b.bill_no, b.bill_date AS date, l.item, l.spec, l.unit, l.product_code, ${LINE_CAT('l')} AS item_category, l.lot, l.qty, l.unit_price, (SELECT id FROM boms WHERE product_code=l.product_code AND l.product_code<>'' LIMIT 1) AS bom_id,
        (SELECT COALESCE(SUM(x.qty),0) FROM stock_return_lines x JOIN stock_returns r ON r.id=x.return_id WHERE r.status='confirmed' AND x.source_type='sales_line' AND x.source_id=l.id) AS returned
        FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id WHERE b.status='confirmed' AND l.active=1 AND l.qty>0 AND b.bill_date>=? AND ${customerKey('b.customer')}=? ORDER BY b.bill_date DESC, l.id DESC LIMIT 501`).all(from, nameKey(party))
    : await db.prepare(`SELECT l.id, b.bill_no, b.bill_date AS date, l.item, l.spec, l.unit, l.product_code, ${LINE_CAT('l')} AS item_category, l.lot, l.qty, l.unit_price, l.req_no, (SELECT id FROM boms WHERE product_code=l.product_code AND l.product_code<>'' LIMIT 1) AS bom_id,
        (SELECT COALESCE(SUM(x.qty),0) FROM stock_return_lines x JOIN stock_returns r ON r.id=x.return_id WHERE r.status='confirmed' AND x.source_type='purchase_line' AND x.source_id=l.id) AS returned
        FROM purchase_bill_lines l JOIN purchase_bills b ON b.id=l.bill_id WHERE b.status='confirmed' AND l.active=1 AND l.qty>0 AND b.bill_date>=? AND ${billVendorKey('b.vendor')}=? ORDER BY b.bill_date DESC, l.id DESC LIMIT 501`).all(from, nameKey(party));
  return { side, party, from, rows: rows.slice(0, 500).map(r => ({ ...r, left: stockRound(r.qty - r.returned) })), more: rows.length > 500 };
});
// 15.147 반입·반출 줄 확인(새로 넣기·고치기 공통). excludeId: 고치는 전표 자신은 「이미 반품한 수량」에서 뺀다.
async function returnLinesFrom(side, party, input, excludeId = 0) {
  const c = RET[side];
  const lines = [], used = new Map();
  for (const [i, raw] of input.entries()) {
    const l = raw && typeof raw === 'object' ? raw : {}, no = `${i + 1}번째 줄`;
    const qty = num(l.qty, `${no} 수량`); if (!(qty > 0)) throw bad(`${no}: 수량은 0보다 커야 합니다.`);
    let line;
    if (l.source_id) {
      const sid = Number(l.source_id); if (!Number.isSafeInteger(sid) || sid <= 0) throw bad(`${no}: 원래 전표 줄을 다시 고르세요.`);
      const src = side === 'in'
        ? await db.prepare(`SELECT l.*, b.customer AS party, ${LINE_CAT('l')} AS cat FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id WHERE l.id=? AND l.active=1 AND b.status='confirmed'`).get(sid)
        : await db.prepare(`SELECT l.*, b.vendor AS party, ${LINE_CAT('l')} AS cat FROM purchase_bill_lines l JOIN purchase_bills b ON b.id=l.bill_id WHERE l.id=? AND l.active=1 AND b.status='confirmed'`).get(sid);
      if (!src) throw new HttpError(409, `${no}: 원래 전표가 취소되었거나 없습니다. 새로 불러오세요.`);
      if (nameKey(src.party) !== nameKey(party)) throw bad(`${no}(${src.item}): 다른 거래처(${src.party})의 전표 줄입니다.`);
      const done = (await db.prepare(`SELECT (SELECT COALESCE(SUM(x.qty),0) FROM stock_return_lines x JOIN stock_returns r ON r.id=x.return_id WHERE r.status='confirmed' AND x.source_type=? AND x.source_id=? AND r.id<>?) AS q`).get(c.source, sid, excludeId)).q + (used.get(sid) || 0);
      if (qty > src.qty - done + 0.000001) throw bad(`${no}(${src.item}): 원래 ${stockRound(src.qty)} 중 이미 ${stockRound(done)} 반품되어 ${stockRound(src.qty - done)}까지 넣을 수 있습니다.`);
      used.set(sid, (used.get(sid) || 0) + qty);
      line = { source_type: c.source, source_id: sid, bom_id: null, product_code: src.product_code || '', item: src.item, spec: src.spec || '', unit: src.unit || '', item_category: src.cat || '', lot: str(l.lot, 100) || src.lot || '' };
      line.unit_price = l.unit_price === undefined || l.unit_price === '' || l.unit_price === null ? src.unit_price : num(l.unit_price, `${no} 단가`);
    } else {
      const bid = Number(l.bom_id); const bom = Number.isSafeInteger(bid) && bid > 0 ? await db.prepare('SELECT * FROM boms WHERE id=?').get(bid) : null;
      if (!bom) throw bad(`${no}: 품목을 고르세요.`);
      line = { source_type: 'manual', source_id: null, bom_id: bom.id, product_code: bom.product_code || '', item: bom.product, spec: await catalogSpec(bom, l.spec), unit: bom.unit || '', item_category: bom.item_category || '', lot: str(l.lot, 100) };
      line.unit_price = l.unit_price === undefined || l.unit_price === '' || l.unit_price === null ? 0 : num(l.unit_price, `${no} 단가`);
    }
    if (line.unit_price < 0) throw bad(`${no}: 단가는 0 이상이어야 합니다.`);
    Object.assign(line, { qty, supply: billTrunc(qty * line.unit_price), reason: str(l.reason, 50), note: str(l.note, 200) });
    lines.push(line);
  }
  return lines;
}
const returnQtyGuards = (side, lines) => [...new Set(lines.filter(l => l.source_id).map(l => l.source_id))].map(sid => ({ // 15.209 동시에 넣어도 원래 수량을 넘지 않게
  sql: `SELECT json('conflict') WHERE (SELECT COALESCE(SUM(x.qty),0) FROM stock_return_lines x JOIN stock_returns r ON r.id=x.return_id WHERE r.status='confirmed' AND x.source_type=? AND x.source_id=?) > (SELECT qty FROM ${side === 'in' ? 'sales_bill_lines' : 'purchase_bill_lines'} WHERE id=?) + 0.000001`, args: [RET[side].source, sid, sid] }));
route('POST', '/api/returns', async ({ user, body }) => {
  const side = body.side === 'out' ? 'out' : body.side === 'in' ? 'in' : null; if (!side) throw bad('반입·반출을 고르세요.');
  const c = RET[side]; c.need(user);
  const key = str(body.request_id, 80);
  if (key) { const old = await db.prepare('SELECT * FROM stock_returns WHERE request_id=?').get(key); if (old) return { ...await returnDetail(old), duplicate: true }; }
  const date = dateStr(body.return_date, `${c.label}일자`); if (date > today()) throw bad(`${c.label}일자는 오늘 이전으로 선택하세요.`);
  const v = await vendorByName(reqStr(body.party, '거래처', 100)); if (!v) throw bad(`거래처 「${body.party}」가 거래처 관리에 없습니다. 먼저 등록하세요.`);
  const party = v.name, process = RET_PROCESS[body.process] ? body.process : 'stock_amount', settle = body.settle === 'refund' ? 'refund' : 'offset', taxType = body.tax_type === 'zero' ? 'zero' : 'taxable';
  const amount = ['stock_amount', 'amount'].includes(process);
  if (amount && await c.closed(party, date)) throw bad(`${party}의 ${date.slice(0, 7)} ${side === 'in' ? '매출' : '매입'}은 마감되었습니다. 마감 취소(관리자) 뒤에 넣으세요.`);
  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length || input.length > 100) throw bad(`${c.label} 품목은 1~100줄 넣으세요.`);
  const lines = await returnLinesFrom(side, party, input, 0);
  const supply = lines.reduce((t, l) => t + l.supply, 0), vat = taxType === 'zero' ? 0 : billTrunc(supply * 0.1), total = supply + vat, vats = splitVat(lines, vat);
  lines.forEach((l, i) => { l.vat = vats[i]; });
  if (amount && !(total > 0)) throw bad('금액을 처리하려면 단가를 넣으세요(금액 0). 재고만 처리하려면 처리구분을 「재고만」으로 고르세요.');
  const token = key || 'srv:' + crypto.randomUUID(), RID = '(SELECT id FROM stock_returns WHERE request_id=?)', ymd = today().slice(2).replace(/-/g, '');
  const rp = `${c.prefix}-${ymd}-`, note = str(body.note, 500);
  const cmds = [{ sql: `INSERT INTO stock_returns(return_no,side,return_date,party,process,settle,tax_type,supply_total,vat_total,total,note,request_id,created_by,created_by_id) VALUES(${nextDocNo('stock_returns', 'return_no')},?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [rp, rp, rp, side, date, party, process, amount ? settle : 'offset', taxType, supply, vat, total, note, token, user.name, user.id] }];
  for (const l of lines) cmds.push({ sql: `INSERT INTO stock_return_lines(return_id,bom_id,product_code,item,spec,unit,item_category,qty,unit_price,supply,vat,reason,lot,source_type,source_id,note) VALUES(${RID},?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [token, l.bom_id, l.product_code, l.item, l.spec, l.unit, l.item_category, l.qty, l.unit_price, l.supply, l.vat, l.reason, l.lot, l.source_type, l.source_id, l.note] });
  cmds.push(...returnQtyGuards(side, lines));
  const NO = `(SELECT return_no FROM stock_returns WHERE request_id=?)`;
  if (amount) {
    const btok = token + ':bill', bp = `${side === 'in' ? 'SB' : 'PB'}-${ymd}-`, BID = `(SELECT id FROM ${side === 'in' ? 'sales_bills' : 'purchase_bills'} WHERE request_id=?)`;
    const billNote = `'${c.label} ' || ${NO} || ?`;
    if (side === 'in') {
      cmds.push({ sql: `INSERT INTO sales_bills(bill_no,bill_date,customer,tax_type,supply_total,vat_total,total,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('sales_bills', 'bill_no')},?,?,?,?,?,?,${billNote},?,?,?)`,
        args: [bp, bp, bp, date, party, taxType, -supply, -vat, -total, token, note ? ' · ' + note : '', user.name, user.id, btok] });
      for (const l of lines) cmds.push({ sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note) VALUES(${BID},?,'manual',NULL,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [btok, l.item_category, l.item, l.spec, l.unit, l.product_code, l.lot, date, -l.qty, l.unit_price, -l.supply, -l.vat, `반입${l.reason ? ' · ' + l.reason : ''}`] });
    } else {
      cmds.push({ sql: `INSERT INTO purchase_bills(bill_no,bill_date,vendor,tax_type,supply_total,vat_total,total,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('purchase_bills', 'bill_no')},?,?,?,?,?,?,${billNote},?,?,?)`,
        args: [bp, bp, bp, date, party, taxType, -supply, -vat, -total, token, note ? ' · ' + note : '', user.name, user.id, btok] });
      // 매입전표 줄은 입고 줄을 가리켜야 하므로 반출 줄은 겹치지 않는 음수 번호로 둔다(입고 줄과 섞이지 않음).
      lines.forEach((l, k) => cmds.push({ sql: `INSERT INTO purchase_bill_lines(bill_id,item_category,source_type,source_id,po_id,req_no,item,spec,unit,product_code,lot,received_date,qty,unit_price,supply,note) VALUES(${BID},?,'other',?,NULL,'',?,?,?,?,?,?,?,?,?,?)`,
        args: [btok, l.item_category, -(Date.now() * 100 + k), l.item, l.spec, l.unit, l.product_code, l.lot, date, -l.qty, l.unit_price, -l.supply, `반출${l.reason ? ' · ' + l.reason : ''}`] }));
    }
    cmds.push({ sql: `UPDATE stock_returns SET bill_id=${BID} WHERE request_id=?`, args: [btok, token] });
    if (settle === 'refund') {
      const ptok = token + ':pay', T = side === 'in' ? 'sales_payments' : 'purchase_payments', col = side === 'in' ? 'customer' : 'vendor';
      cmds.push({ sql: `INSERT INTO ${T}(pay_date,${col},kind,amount,method,note,created_by,created_by_id,request_id) VALUES(?,?,'payment',?,'현금환불','${c.label} ' || ${NO} || ' 환불',?,?,?)`, args: [date, party, -total, token, user.name, user.id, ptok] });
      cmds.push({ sql: `UPDATE stock_returns SET payment_id=(SELECT id FROM ${T} WHERE request_id=?) WHERE request_id=?`, args: [ptok, token] });
    }
  }
  try { await db.batch(cmds); }
  catch (error) { const saved = await db.prepare('SELECT * FROM stock_returns WHERE request_id=?').get(token); if (saved) return { ...await returnDetail(saved), duplicate: true }; if (isGuardError(error)) throw new HttpError(409, `그 사이 같은 전표 줄에 다른 ${c.label}이 들어가 원래 수량을 넘습니다. 새로 불러와 수량을 확인하세요.`); throw error; }
  return returnDetail(await db.prepare('SELECT * FROM stock_returns WHERE request_id=?').get(token));
});
// 15.147 반입·반출 고치기: 같은 전표번호를 그대로 두고 일자·처리구분·금액처리·부가세·비고와 줄을 바꾼다.
// 연결된 금액 전표(음수 매출·매입전표)와 현금 환불도 함께 맞춘다. 세금계산서에 담겼거나 마감된 달이면 막는다. 고친 내용은 doc_changes에 한 줄.
const docChange = (type, id, summary, user) => ({ sql: 'INSERT INTO doc_changes(doc_type,doc_id,summary,changed_by) VALUES(?,?,?,?)', args: [type, id, String(summary).slice(0, 500), user.name] });
route('GET', '/api/doc-changes', async ({ query }) => db.prepare('SELECT summary, changed_by, changed_at FROM doc_changes WHERE doc_type=? AND doc_id=? ORDER BY id DESC LIMIT 50').all(str(query.type, 30), Number(query.id) || 0));
route('PUT', '/api/returns/:id', async ({ user, params, body }) => {
  const r = await mustGet('stock_returns', params.id), side = r.side, c = RET[side]; c.need(user);
  if (r.status !== 'confirmed') throw bad('취소된 전표는 고칠 수 없습니다.');
  const date = dateStr(body.return_date ?? r.return_date, `${c.label}일자`); if (date > today()) throw bad(`${c.label}일자는 오늘 이전으로 선택하세요.`);
  const process = RET_PROCESS[body.process] ? body.process : r.process, settle = body.settle === 'refund' ? 'refund' : body.settle === 'offset' ? 'offset' : r.settle;
  const taxType = body.tax_type === 'zero' ? 'zero' : body.tax_type === 'taxable' ? 'taxable' : r.tax_type, note = body.note === undefined ? r.note : str(body.note, 500);
  const amount = ['stock_amount', 'amount'].includes(process), oldAmount = !!r.bill_id;
  const BT = side === 'in' ? 'sales' : 'purchase', BILLS = `${BT}_bills`, LINES = `${BT}_bill_lines`, PAYS = `${BT}_payments`;
  if (oldAmount) {
    const inv = side === 'in' ? await db.prepare('SELECT i.invoice_no FROM tax_invoice_bills t JOIN tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1').get(r.bill_id)
      : await db.prepare("SELECT i.invoice_no FROM purchase_tax_invoice_bills t JOIN purchase_tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1 AND i.status='received'").get(r.bill_id);
    if (inv) throw new HttpError(409, `세금계산서 ${inv.invoice_no}에 담긴 ${c.label} 금액입니다. 계산서를 먼저 취소한 뒤 고치세요.`);
    if (await c.closed(r.party, r.return_date)) throw bad(`${r.party}의 ${r.return_date.slice(0, 7)}은 마감되었습니다. 마감 취소(관리자) 뒤에 고치세요.`);
  }
  if (amount && await c.closed(r.party, date)) throw bad(`${r.party}의 ${date.slice(0, 7)}은 마감되었습니다. 마감 취소(관리자) 뒤에 고치세요.`);
  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length || input.length > 100) throw bad(`${c.label} 품목은 1~100줄 넣으세요.`);
  const lines = await returnLinesFrom(side, r.party, input, r.id);
  const supply = lines.reduce((t, l) => t + l.supply, 0), vat = taxType === 'zero' ? 0 : billTrunc(supply * 0.1), total = supply + vat, vats = splitVat(lines, vat);
  lines.forEach((l, i) => { l.vat = vats[i]; });
  if (amount && !(total > 0)) throw bad('금액을 처리하려면 단가를 넣으세요(금액 0). 재고만 처리하려면 처리구분을 「교환(재고만)」으로 고르세요.');
  const old = await db.prepare('SELECT * FROM stock_return_lines WHERE return_id=? ORDER BY id').all(r.id);
  const memo = `${c.label} ${r.return_no}${note ? ' · ' + note : ''}`, ymd = today().slice(2).replace(/-/g, '');
  const cmds = [{ sql: "UPDATE stock_returns SET return_date=?,process=?,settle=?,tax_type=?,supply_total=?,vat_total=?,total=?,note=? WHERE id=? AND status='confirmed'", args: [date, process, amount ? settle : 'offset', taxType, supply, vat, total, note, r.id] }, RC_GUARD,
    { sql: 'DELETE FROM stock_return_lines WHERE return_id=?', args: [r.id] },
    ...lines.map(l => ({ sql: 'INSERT INTO stock_return_lines(return_id,bom_id,product_code,item,spec,unit,item_category,qty,unit_price,supply,vat,reason,lot,source_type,source_id,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [r.id, l.bom_id, l.product_code, l.item, l.spec, l.unit, l.item_category, l.qty, l.unit_price, l.supply, l.vat, l.reason, l.lot, l.source_type, l.source_id, l.note] }))];
  const billLine = (billRef, l, k) => side === 'in'
    ? { sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note) VALUES(${billRef.sql},?,'manual',NULL,?,?,?,?,?,?,?,?,?,?,?)`, args: [...billRef.args, l.item_category, l.item, l.spec, l.unit, l.product_code, l.lot, date, -l.qty, l.unit_price, -l.supply, -l.vat, `반입${l.reason ? ' · ' + l.reason : ''}`] }
    : { sql: `INSERT INTO purchase_bill_lines(bill_id,item_category,source_type,source_id,po_id,req_no,item,spec,unit,product_code,lot,received_date,qty,unit_price,supply,note) VALUES(${billRef.sql},?,'other',?,NULL,'',?,?,?,?,?,?,?,?,?,?)`, args: [...billRef.args, l.item_category, -(Date.now() * 100 + k), l.item, l.spec, l.unit, l.product_code, l.lot, date, -l.qty, l.unit_price, -l.supply, `반출${l.reason ? ' · ' + l.reason : ''}`] };
  if (oldAmount && amount) { // 같은 금액 전표를 고쳐 씀
    cmds.push({ sql: `UPDATE ${BILLS} SET bill_date=?,tax_type=?,supply_total=?,vat_total=?,total=?,note=? WHERE id=? AND status='confirmed'`, args: [date, taxType, -supply, -vat, -total, memo, r.bill_id] }, RC_GUARD,
      { sql: `DELETE FROM ${LINES} WHERE bill_id=?`, args: [r.bill_id] }, ...lines.map((l, k) => billLine({ sql: '?', args: [r.bill_id] }, l, k)));
  } else if (oldAmount && !amount) { // 금액 처리를 끔 → 금액 전표 취소(목록에서는 숨김)
    cmds.push({ sql: `UPDATE ${LINES} SET active=0 WHERE bill_id=?`, args: [r.bill_id] }, { sql: `UPDATE ${BILLS} SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed'`, args: [now(), user.name, `${c.label} ${r.return_no} 고침(금액 처리 안 함)`, r.bill_id] },
      { sql: 'UPDATE stock_returns SET bill_id=NULL WHERE id=?', args: [r.id] });
  } else if (!oldAmount && amount) { // 새로 금액 전표
    const btok = `ret:${r.id}:${crypto.randomUUID()}`, bp = `${side === 'in' ? 'SB' : 'PB'}-${ymd}-`, BID = `(SELECT id FROM ${BILLS} WHERE request_id=?)`;
    cmds.push(side === 'in'
      ? { sql: `INSERT INTO sales_bills(bill_no,bill_date,customer,tax_type,supply_total,vat_total,total,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('sales_bills', 'bill_no')},?,?,?,?,?,?,?,?,?,?)`, args: [bp, bp, bp, date, r.party, taxType, -supply, -vat, -total, memo, user.name, user.id, btok] }
      : { sql: `INSERT INTO purchase_bills(bill_no,bill_date,vendor,tax_type,supply_total,vat_total,total,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('purchase_bills', 'bill_no')},?,?,?,?,?,?,?,?,?,?)`, args: [bp, bp, bp, date, r.party, taxType, -supply, -vat, -total, memo, user.name, user.id, btok] },
      ...lines.map((l, k) => billLine({ sql: BID, args: [btok] }, l, k)), { sql: `UPDATE stock_returns SET bill_id=${BID} WHERE id=?`, args: [btok, r.id] });
  }
  const refund = amount && settle === 'refund', col = side === 'in' ? 'customer' : 'vendor';
  if (r.payment_id && refund) cmds.push({ sql: `UPDATE ${PAYS} SET pay_date=?,amount=?,note=? WHERE id=? AND status='confirmed'`, args: [date, -total, `${c.label} ${r.return_no} 환불`, r.payment_id] });
  else if (r.payment_id && !refund) cmds.push({ sql: `UPDATE ${PAYS} SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed'`, args: [now(), user.name, `${c.label} ${r.return_no} 고침(환불 안 함)`, r.payment_id] }, { sql: 'UPDATE stock_returns SET payment_id=NULL WHERE id=?', args: [r.id] });
  else if (!r.payment_id && refund) { const ptok = `ret:${r.id}:pay:${crypto.randomUUID()}`; cmds.push({ sql: `INSERT INTO ${PAYS}(pay_date,${col},kind,amount,method,note,created_by,created_by_id,request_id) VALUES(?,?,'payment',?,'현금환불',?,?,?,?)`, args: [date, r.party, -total, `${c.label} ${r.return_no} 환불`, user.name, user.id, ptok] }, { sql: `UPDATE stock_returns SET payment_id=(SELECT id FROM ${PAYS} WHERE request_id=?) WHERE id=?`, args: [ptok, r.id] }); }
  // 이력: 바뀐 것만 짧게
  const diff = [];
  if (date !== r.return_date) diff.push(`일자 ${r.return_date}→${date}`);
  if (process !== r.process) diff.push(`처리 ${r.process}→${process}`);
  if (amount && settle !== r.settle) diff.push(settle === 'refund' ? '현금 환불로' : '미수·미지급 삭감으로');
  if (taxType !== r.tax_type) diff.push(taxType === 'zero' ? '영세·면세로' : '부가세 별도로');
  if (total !== r.total) diff.push(`합계 ${billTrunc(r.total).toLocaleString('ko-KR')}→${billTrunc(total).toLocaleString('ko-KR')}`);
  const lineSig = l => `${l.item}|${l.qty}|${l.unit_price}|${l.reason}|${l.lot}`;
  if (old.map(lineSig).join() !== lines.map(lineSig).join()) diff.push(`품목 ${old.length}줄→${lines.length}줄(수량·단가·사유)`);
  if (note !== r.note) diff.push('비고');
  if (!diff.length) return returnDetail(r);
  cmds.push(docChange('return', r.id, diff.join(' · '), user));
  cmds.push(...returnQtyGuards(side, lines)); // 15.209
  try { await db.batch(cmds); } catch (error) { if (isGuardError(error)) throw new HttpError(409, '그 사이 전표가 바뀌었습니다. 새로 불러오세요.'); throw error; }
  return returnDetail(await mustGet('stock_returns', r.id));
});
// 15.147 매출·매입전표 고치기: 일자·줄 단가·줄 비고·전표 비고(매입은 명세서 번호·명세서 합계·운송비도). 수량·줄 구성은 출하·입고에 묶여 있어 그대로.
// 세금계산서에 담겼거나 마감된 달(원래·새 일자)이면 막고, 반입·반출로 생긴 전표는 그 반품 전표에서 고친다. 고친 내용은 doc_changes에 한 줄.
const carryLimit = () => { const [y, m] = today().split('-').map(Number); return monthEnd(m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`); };
async function billEditCommon(side, bill, body, user) {
  const c = side === 'sales' ? { need: requireSales, party: bill.customer, closed: (p, d) => salesClosed(p, d), retSide: 'in', link: 'tax_invoice_bills', inv: 'tax_invoices', live: "i.status<>'cancelled'" }
    : { need: requirePurchase, party: bill.vendor, closed: (p, d) => closedPeriod(p, d), retSide: 'out', link: 'purchase_tax_invoice_bills', inv: 'purchase_tax_invoices', live: "i.status='received'" };
  c.need(user);
  if (bill.status !== 'confirmed') throw bad('취소된 전표는 고칠 수 없습니다.');
  const ret = await returnOfBill(c.retSide, bill.id); if (ret) throw bad(`${c.retSide === 'in' ? '반입' : '반출'} ${ret.return_no}로 생긴 전표입니다. 그 ${c.retSide === 'in' ? '반입' : '반출'} 전표에서 고치세요.`);
  const inv = await db.prepare(`SELECT i.invoice_no FROM ${c.link} t JOIN ${c.inv} i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1 AND ${c.live}`).get(bill.id);
  if (inv) throw new HttpError(409, `세금계산서 ${inv.invoice_no}에 담긴 전표입니다. 계산서를 먼저 ${side === 'sales' ? '담기 취소' : '취소'}한 뒤 고치세요.`);
  // 15.148 이월: 고칠 때는 다음 달 말일까지 옮길 수 있다(출고·입고 기록은 그대로, 전표·계산서 달만 바뀜).
  const date = body.bill_date === undefined ? bill.bill_date : dateStr(body.bill_date, '전표 일자'); if (date > carryLimit()) throw bad(`전표 일자는 다음 달 말일(${carryLimit()})까지 옮길 수 있습니다.`);
  for (const d of new Set([bill.bill_date, date])) if (await c.closed(c.party, d)) throw bad(`${c.party}의 ${d.slice(0, 7)}은 마감되었습니다. 마감 취소(관리자) 뒤에 고치세요.`);
  const lines = await db.prepare(`SELECT * FROM ${side}_bill_lines WHERE bill_id=? AND active=1 ORDER BY id`).all(bill.id);
  const edits = new Map((Array.isArray(body.lines) ? body.lines : []).filter(l => l && l.id).map(l => [Number(l.id), l]));
  for (const id of edits.keys()) if (!lines.some(l => l.id === id)) throw new HttpError(409, '이 전표에 없는 줄입니다. 새로 불러오세요.');
  const diff = [];
  for (const l of lines) {
    const e = edits.get(l.id); l.newPrice = l.unit_price; l.newNote = l.note;
    if (e) {
      if (e.unit_price !== undefined && e.unit_price !== '' && e.unit_price !== null) { const p = num(e.unit_price, `${l.item} 단가`); if (p < 0) throw bad(`${l.item}: 단가는 0 이상이어야 합니다.`); l.newPrice = p; }
      if (e.note !== undefined) l.newNote = str(e.note, 200);
    }
    l.newSupply = billTrunc(l.qty * l.newPrice);
    if (l.newPrice !== l.unit_price) diff.push(`${l.item} 단가 ${l.unit_price}→${l.newPrice}`);
    else if (l.newNote !== l.note) diff.push(`${l.item} 비고`);
  }
  if (date !== bill.bill_date) diff.unshift(`일자 ${bill.bill_date}→${date}${date.slice(0, 7) > bill.bill_date.slice(0, 7) ? ' (이월)' : ''}`);
  const note = body.note === undefined ? bill.note : str(body.note, 500); if (note !== bill.note) diff.push('비고');
  return { c, date, lines, note, diff };
}
route('PUT', '/api/sales-bills/:id', async ({ user, params, body }) => {
  const bill = await mustGet('sales_bills', params.id);
  const { date, lines, note, diff } = await billEditCommon('sales', bill, body, user);
  if (!diff.length) return salesBillDetail(bill);
  const supply = lines.reduce((t, l) => t + l.newSupply, 0), vat = bill.tax_type === 'zero' ? 0 : billTrunc(supply * 0.1), vats = splitVat(lines.map(l => ({ supply: l.newSupply })), vat);
  if (supply + vat !== bill.total) diff.push(`합계 ${billTrunc(bill.total).toLocaleString('ko-KR')}→${billTrunc(supply + vat).toLocaleString('ko-KR')}`);
  const cmds = [{ sql: "UPDATE sales_bills SET bill_date=?,supply_total=?,vat_total=?,total=?,note=? WHERE id=? AND status='confirmed' AND NOT EXISTS(SELECT 1 FROM tax_invoice_bills WHERE bill_id=? AND active=1)", args: [date, supply, vat, supply + vat, note, bill.id, bill.id] }, RC_GUARD,
    ...lines.map((l, k) => ({ sql: 'UPDATE sales_bill_lines SET unit_price=?,supply=?,vat=?,note=? WHERE id=?', args: [l.newPrice, l.newSupply, vats[k], l.newNote, l.id] })), docChange('sales_bill', bill.id, diff.join(' · '), user)];
  try { await db.batch(cmds); } catch (error) { if (isGuardError(error)) throw new HttpError(409, '그 사이 세금계산서에 담겼거나 취소되었습니다. 새로 불러오세요.'); throw error; }
  return salesBillDetail(await mustGet('sales_bills', bill.id));
});
route('PUT', '/api/purchase-bills/:id', async ({ user, params, body }) => {
  const bill = await mustGet('purchase_bills', params.id);
  const { date, lines, note, diff } = await billEditCommon('purchase', bill, body, user);
  const freight = body.freight === undefined ? bill.freight : body.freight === '' || body.freight === null ? 0 : num(body.freight, '운송비'); if (freight < 0) throw bad('운송비는 0 이상이어야 합니다.');
  const stNo = body.statement_no === undefined ? bill.statement_no : str(body.statement_no, 50);
  const stTotal = body.statement_total === undefined ? bill.statement_total : body.statement_total === '' || body.statement_total === null ? null : num(body.statement_total, '명세서 합계');
  if (billTrunc(freight) !== bill.freight) diff.push(`운송비 ${bill.freight}→${billTrunc(freight)}`);
  if (stNo !== bill.statement_no) diff.push('명세서 번호'); if (stTotal !== bill.statement_total) diff.push('명세서 합계');
  if (!diff.length) return billDetail(bill);
  const supply = lines.reduce((t, l) => t + l.newSupply, 0) + billTrunc(freight), vat = bill.tax_type === 'zero' ? 0 : billTrunc(supply * 0.1);
  if (supply + vat !== bill.total) diff.push(`합계 ${billTrunc(bill.total).toLocaleString('ko-KR')}→${billTrunc(supply + vat).toLocaleString('ko-KR')}`);
  const cmds = [{ sql: "UPDATE purchase_bills SET bill_date=?,statement_no=?,statement_total=?,freight=?,supply_total=?,vat_total=?,total=?,note=? WHERE id=? AND status='confirmed' AND NOT EXISTS(SELECT 1 FROM purchase_tax_invoice_bills t JOIN purchase_tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1 AND i.status='received')", args: [date, stNo, stTotal, billTrunc(freight), supply, vat, supply + vat, note, bill.id, bill.id] }, RC_GUARD,
    ...lines.map(l => ({ sql: 'UPDATE purchase_bill_lines SET unit_price=?,supply=?,note=? WHERE id=?', args: [l.newPrice, l.newSupply, l.newNote, l.id] })), docChange('purchase_bill', bill.id, diff.join(' · '), user)];
  try { await db.batch(cmds); } catch (error) { if (isGuardError(error)) throw new HttpError(409, '그 사이 세금계산서에 담겼거나 취소되었습니다. 새로 불러오세요.'); throw error; }
  return billDetail(await mustGet('purchase_bills', bill.id));
});
async function returnDetail(r) {
  const lines = await db.prepare('SELECT * FROM stock_return_lines WHERE return_id=? ORDER BY id').all(r.id);
  const bill = r.bill_id ? await db.prepare(`SELECT id, bill_no, status FROM ${r.side === 'in' ? 'sales_bills' : 'purchase_bills'} WHERE id=?`).get(r.bill_id) : null;
  for (const l of lines) if (l.source_id) { const s = await db.prepare(l.source_type === 'sales_line' ? 'SELECT b.bill_no, b.bill_date FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id WHERE l.id=?' : 'SELECT b.bill_no, b.bill_date FROM purchase_bill_lines l JOIN purchase_bills b ON b.id=l.bill_id WHERE l.id=?').get(l.source_id); if (s) Object.assign(l, { source_bill_no: s.bill_no, source_date: s.bill_date }); }
  const changes = await db.prepare("SELECT summary, changed_by, changed_at FROM doc_changes WHERE doc_type='return' AND doc_id=? ORDER BY id DESC LIMIT 20").all(r.id);
  const invoiced = r.bill_id ? !!(await db.prepare(r.side === 'in' ? 'SELECT 1 FROM tax_invoice_bills WHERE bill_id=? AND active=1' : "SELECT 1 FROM purchase_tax_invoice_bills t JOIN purchase_tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1 AND i.status='received'").get(r.bill_id)) : false;
  return { ...r, lines, bill, changes, invoiced };
}
route('GET', '/api/returns', async ({ user, query }) => {
  const side = query.side === 'out' ? 'out' : 'in'; RET[side].need(user);
  const where = ['side=?'], args = [side];
  applyListDates(where, args, query, 'return_date');
  if (query.party) { where.push(`${customerKey('party')}=?`); args.push(nameKey(str(query.party, 100))); }
  if (query.status) { if (!['confirmed', 'cancelled'].includes(query.status)) throw bad('상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  applyListKeyword(where, args, query.q, ['return_no', 'party', 'note']);
  const rows = await db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM stock_return_lines l WHERE l.return_id=r.id) AS line_count, (SELECT item FROM stock_return_lines l WHERE l.return_id=r.id ORDER BY l.id LIMIT 1) AS first_item, (SELECT bill_no FROM ${side === 'in' ? 'sales_bills' : 'purchase_bills'} WHERE id=r.bill_id) AS bill_no FROM stock_returns r WHERE ${where.join(' AND ')} ORDER BY return_date DESC, id DESC LIMIT 501`).all(...args);
  return { rows: rows.slice(0, 500), more: rows.length > 500 };
});
route('GET', '/api/returns/:id', async ({ user, params }) => { const r = await mustGet('stock_returns', params.id); RET[r.side].need(user); return returnDetail(r); });
route('POST', '/api/returns/:id/cancel', async ({ user, params, body }) => {
  const r = await mustGet('stock_returns', params.id), c = RET[r.side]; c.need(user);
  if (r.status !== 'confirmed') throw bad('이미 취소된 전표입니다.');
  const reason = reqStr(body.reason, '취소 사유', 200);
  if (r.bill_id) {
    if (await c.closed(r.party, r.return_date)) throw bad(`${r.party}의 ${r.return_date.slice(0, 7)}은 마감되었습니다. 마감 취소(관리자) 뒤에 취소하세요.`);
    const inv = r.side === 'in' ? await db.prepare('SELECT i.invoice_no FROM tax_invoice_bills t JOIN tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1').get(r.bill_id)
      : await db.prepare("SELECT i.invoice_no FROM purchase_tax_invoice_bills t JOIN purchase_tax_invoices i ON i.id=t.invoice_id WHERE t.bill_id=? AND t.active=1 AND i.status='received'").get(r.bill_id);
    if (inv) throw new HttpError(409, `세금계산서 ${inv.invoice_no}에 담긴 ${c.label} 금액입니다. 계산서를 먼저 취소하세요.`);
  }
  const BT = r.side === 'in' ? 'sales' : 'purchase', cmds = [{ sql: "UPDATE stock_returns SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed'", args: [now(), user.name, reason, r.id] }, RC_GUARD];
  if (r.bill_id) cmds.push({ sql: `UPDATE ${BT}_bill_lines SET active=0 WHERE bill_id=?`, args: [r.bill_id] }, { sql: `UPDATE ${BT}_bills SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed'`, args: [now(), user.name, `${c.label} ${r.return_no} 취소 · ${reason}`, r.bill_id] });
  if (r.payment_id) cmds.push({ sql: `UPDATE ${BT}_payments SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='confirmed'`, args: [now(), user.name, `${c.label} ${r.return_no} 취소`, r.payment_id] });
  try { await db.batch(cmds); } catch (error) { if (isGuardError(error)) throw new HttpError(409, '이미 처리된 전표입니다.'); throw error; }
  return returnDetail(await mustGet('stock_returns', r.id));
});
// 반품으로 생긴 금액 전표는 반입·반출 전표에서만 취소한다.
async function returnOfBill(side, billId) { return db.prepare("SELECT return_no FROM stock_returns WHERE side=? AND bill_id=? AND status='confirmed'").get(side, billId); }
// ── 15.137 거래처별 장부(매출·매입): 기간의 전표마다 공급가액·부가세·합계·세금계산서(번호·상태)와 입금/지급을 날짜순으로 잇고 잔액을 낸다.
// 거래처를 비우면 거래처별 요약(기초·전표·입금/지급·잔액·계산서 발행/미발행 금액).
const BOOK = {
  sales: { bills: 'sales_bills', col: 'customer', key: customerKey, pays: 'sales_payments', link: 'tax_invoice_bills', inv: 'tax_invoices', live: "i.status<>'cancelled'", lines: 'sales_bill_lines', need: requireSales },
  purchase: { bills: 'purchase_bills', col: 'vendor', key: billVendorKey, pays: 'purchase_payments', link: 'purchase_tax_invoice_bills', inv: 'purchase_tax_invoices', live: "i.status='received'", lines: 'purchase_bill_lines', need: requirePurchase },
};
// 15.271 거래처 장부 「추가」: 매출/매입 조정 전표(세금계산서와 1원 차이 맞추기 등 — 금액 음수 가능)·메모
route('POST', '/api/book-entries', async ({ user, body }) => {
  const side = body.side === 'purchase' ? 'purchase' : 'sales', c = BOOK[side]; c.need(user);
  const kind = body.kind === 'memo' ? 'memo' : 'bill';
  const token = String(body.request_id || ''); if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw bad('등록 요청 번호를 확인하세요.');
  const party = reqStr(body.party, '거래처', 100), date = dateStr(body.date, '거래일자'); if (date > today()) throw bad('거래일자는 오늘 이전으로 넣으세요.');
  if (kind === 'memo') {
    const old = await db.prepare('SELECT * FROM book_memos WHERE request_id=?').get(token); if (old) return { ...old, duplicate: true };
    const text = reqStr(body.text, '메모', 500);
    await db.prepare('INSERT INTO book_memos(side,party,party_key,memo_date,text,created_by,created_by_id,request_id) VALUES(?,?,?,?,?,?,?,?)').run(side, party, nameKey(party), date, text, user.name, user.id, token);
    return db.prepare('SELECT * FROM book_memos WHERE request_id=?').get(token);
  }
  const prior = await db.prepare(`SELECT * FROM ${c.bills} WHERE request_id=?`).get(token); if (prior) return { ...prior, duplicate: true };
  const item = str(body.item, 200) || '장부 조정', note = str(body.note, 200);
  const signed = (v, label) => { if (v === '' || v == null) throw bad(`${label}을(를) 입력하세요.`); const n = Number(v); if (!Number.isFinite(n)) throw bad(`${label}을(를) 숫자로 넣으세요.`); return n; }; // 조정은 − 가능
  const supply = signed(body.supply, '공급가액'), vat = body.vat === undefined || body.vat === '' || body.vat === null ? Math.trunc(supply * 0.1) : signed(body.vat, '부가세');
  if (!Number.isInteger(supply) || !Number.isInteger(vat)) throw bad('금액은 원 단위(정수)로 넣으세요.');
  if (!supply && !vat) throw bad('공급가액이나 부가세를 넣으세요(줄일 때는 −).');
  if (Math.abs(supply) > 1e11 || Math.abs(vat) > 1e10) throw bad('금액이 너무 큽니다.');
  const total = supply + vat, taxType = body.tax_type === 'zero' ? 'zero' : 'taxable';
  if (taxType === 'zero' && vat) throw bad('영세 전표는 부가세가 0이어야 합니다.');
  const ymd = date.slice(2).replace(/-/g, ''), prefix = `${side === 'sales' ? 'SB' : 'PB'}-${ymd}-`, BID = `(SELECT id FROM ${c.bills} WHERE request_id=?)`, memo = `장부 조정${note ? ' · ' + note : ''}`;
  if (side === 'sales') {
    if (await salesClosed(party, date)) throw bad(closedMessage(party, date, '등록하세요'));
    await ensureVendor(party, user, 'sales');
    await db.batch([
      { sql: `INSERT INTO sales_bills(bill_no,bill_date,customer,tax_type,supply_total,vat_total,total,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('sales_bills', 'bill_no')},?,?,?,?,?,?,?,?,?,?)`, args: [prefix, prefix, prefix, date, party, taxType, supply, vat, total, memo, user.name, user.id, token] },
      { sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note) VALUES(${BID},'','manual',NULL,?,'','','','',?,1,?,?,?,?)`, args: [token, item, date, supply, supply, vat, '장부 조정'] }]);
  } else {
    if (await closedPeriod(party, date)) throw bad(`${party}의 ${date.slice(0, 7)} 매입은 마감되었습니다. 마감 취소(관리자) 뒤에 등록하세요.`);
    await ensureVendor(party, user, 'purchase');
    // 매입전표 줄은 입고 줄을 가리키므로 조정 줄은 겹치지 않는 음수 번호(반출 줄과 같은 방식)
    await db.batch([
      { sql: `INSERT INTO purchase_bills(bill_no,bill_date,vendor,tax_type,supply_total,vat_total,total,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('purchase_bills', 'bill_no')},?,?,?,?,?,?,?,?,?,?)`, args: [prefix, prefix, prefix, date, party, taxType, supply, vat, total, memo, user.name, user.id, token] },
      { sql: `INSERT INTO purchase_bill_lines(bill_id,item_category,source_type,source_id,po_id,req_no,item,spec,unit,product_code,lot,received_date,qty,unit_price,supply,note) VALUES(${BID},'','other',?,NULL,'',?,'','','','',?,1,?,?,?)`, args: [token, -(Date.now() * 100 + 99), item, date, supply, supply, '장부 조정'] }]);
  }
  return db.prepare(`SELECT * FROM ${c.bills} WHERE request_id=?`).get(token);
});
route('POST', '/api/book-memos/:id/delete', async ({ user, params }) => {
  const m = await mustGet('book_memos', params.id); BOOK[m.side].need(user);
  if (m.status !== 'active') throw new HttpError(409, '이미 지운 메모입니다.');
  await db.prepare("UPDATE book_memos SET status='deleted',deleted_at=?,deleted_by=? WHERE id=? AND status='active'").run(now(), user.name, m.id);
  return { ok: true };
});
route('GET', '/api/partner-book', async ({ user, query }) => {
  const side = query.side === 'purchase' ? 'purchase' : 'sales', c = BOOK[side]; c.need(user);
  const from = dateStr(query.from, '시작일'), to = dateStr(query.to, '종료일'); if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
  const party = str(query.party, 100), K = c.key(c.col), filter = party ? ` AND ${K}=?` : '', fargs = party ? [nameKey(party)] : [];
  const INV = `(SELECT i.invoice_no || '|' || i.status || '|' || i.id || '|' || COALESCE(i.approval_no,'') FROM ${c.link} t JOIN ${c.inv} i ON i.id=t.invoice_id WHERE t.bill_id=b.id AND t.active=1 AND ${c.live})`;
  const before = new Map();
  for (const r of await db.prepare(`SELECT ${K} AS k, MIN(${c.col}) AS name, SUM(total) AS t FROM ${c.bills} WHERE status='confirmed' AND bill_date<?${filter} GROUP BY k`).all(from, ...fargs)) before.set(r.k, { name: r.name, opening: r.t || 0 });
  for (const r of await db.prepare(`SELECT ${K} AS k, MIN(${c.col}) AS name, SUM(CASE WHEN kind='opening' THEN amount ELSE -amount END) AS t FROM ${c.pays} WHERE status='confirmed' AND pay_date<?${filter} GROUP BY k`).all(from, ...fargs)) { const g = before.get(r.k) || { name: r.name, opening: 0 }; g.opening += r.t || 0; before.set(r.k, g); }
  if (!party) {
    const map = new Map(), get = (k, name) => { if (!map.has(k)) map.set(k, { name, opening: 0, bills: 0, supply: 0, vat: 0, total: 0, paid: 0, invoiced: 0, uninvoiced: 0 }); return map.get(k); };
    for (const [k, g] of before) get(k, g.name).opening = g.opening;
    for (const b of await db.prepare(`SELECT ${c.key('b.' + c.col)} AS k, MIN(b.${c.col}) AS name, COUNT(*) AS bills, SUM(b.supply_total) AS supply, SUM(b.vat_total) AS vat, SUM(b.total) AS total, SUM(CASE WHEN ${INV} IS NOT NULL THEN b.total ELSE 0 END) AS invoiced FROM ${c.bills} b WHERE b.status='confirmed' AND b.bill_date BETWEEN ? AND ? GROUP BY k`).all(from, to))
      Object.assign(get(b.k, b.name), { bills: b.bills, supply: b.supply, vat: b.vat, total: b.total, invoiced: b.invoiced, uninvoiced: b.total - b.invoiced });
    for (const p of await db.prepare(`SELECT ${K} AS k, MIN(${c.col}) AS name, SUM(CASE WHEN kind='payment' THEN amount ELSE 0 END) AS paid, SUM(CASE WHEN kind='opening' THEN amount ELSE 0 END) AS opening FROM ${c.pays} WHERE status='confirmed' AND pay_date BETWEEN ? AND ? GROUP BY k`).all(from, to)) { const g = get(p.k, p.name); g.paid = p.paid; g.opening += p.opening; }
    const rows = [...map.values()].map(r => ({ ...r, balance: r.opening + r.total - r.paid })).filter(r => r.opening || r.total || r.paid || r.balance).sort((a, b) => stockCompare(a.name, b.name));
    const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
    return { side, from, to, party: '', rows, totals: Object.fromEntries(['opening', 'bills', 'supply', 'vat', 'total', 'paid', 'invoiced', 'uninvoiced', 'balance'].map(k => [k, sum(k)])) };
  }
  const opening = [...before.values()][0]?.opening || 0;
  const bills = await db.prepare(`SELECT b.id, b.bill_no, b.bill_date AS date, b.supply_total AS supply, b.vat_total AS vat, b.total, b.note, ${INV} AS invoice,
      (SELECT item FROM ${c.lines} l WHERE l.bill_id=b.id ORDER BY l.id LIMIT 1) AS first_item, (SELECT COUNT(*) FROM ${c.lines} l WHERE l.bill_id=b.id) AS line_count
    FROM ${c.bills} b WHERE b.status='confirmed' AND b.bill_date BETWEEN ? AND ? AND ${c.key('b.' + c.col)}=? ORDER BY b.bill_date, b.id LIMIT 5001`).all(from, to, nameKey(party));
  const pays = await db.prepare(`SELECT id, pay_date AS date, kind, amount, method, note FROM ${c.pays} WHERE status='confirmed' AND pay_date BETWEEN ? AND ? AND ${K}=? ORDER BY pay_date, id LIMIT 5001`).all(from, to, nameKey(party));
  if (bills.length > 5000 || pays.length > 5000) throw bad('줄이 너무 많습니다. 기간을 좁히세요.');
  const memos = await db.prepare("SELECT id, memo_date AS date, text, created_by FROM book_memos WHERE side=? AND party_key=? AND status='active' AND memo_date BETWEEN ? AND ? ORDER BY memo_date, id LIMIT 2000").all(side, nameKey(party), from, to); // 15.271
  const rows = [
    ...memos.map(m => ({ kind: 'memo', date: m.date, order: 3, id: m.id, label: m.text, note: m.created_by, supply: 0, vat: 0, total: 0, paid: 0 })),
    ...pays.map(p => ({ kind: p.kind, date: p.date, order: p.kind === 'opening' ? -1 : 2, id: p.id, label: p.kind === 'opening' ? (side === 'sales' ? '기초 미수금' : '기초 미지급') : (side === 'sales' ? '입금' : '지급') + (p.method ? ` · ${p.method}` : ''), note: p.note, total: p.kind === 'opening' ? p.amount : 0, paid: p.kind === 'payment' ? p.amount : 0 })),
    ...bills.map(b => { const [invoice_no, invoice_status, invoice_id, approval_no] = b.invoice ? b.invoice.split('|') : []; return { kind: 'bill', date: b.date, order: 1, id: b.id, bill_no: b.bill_no, label: b.first_item ? `${b.first_item}${b.line_count > 1 ? ` 외 ${b.line_count - 1}건` : ''}` : '', note: b.note, supply: b.supply, vat: b.vat, total: b.total, paid: 0, invoice_no: invoice_no || '', invoice_status: invoice_status || '', invoice_id: invoice_id ? Number(invoice_id) : null, approval_no: approval_no || '' }; }),
  ].sort((a, b) => stockCompare(a.date, b.date) || a.order - b.order || a.id - b.id);
  let balance = opening; for (const r of rows) { balance += r.total - r.paid; r.balance = balance; delete r.order; }
  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0), billRows = rows.filter(r => r.kind === 'bill');
  return { side, from, to, party, opening, rows, totals: { supply: sum('supply'), vat: sum('vat'), total: sum('total'), paid: sum('paid'), balance, invoiced: billRows.filter(r => r.invoice_no).reduce((t, r) => t + r.total, 0), uninvoiced: billRows.filter(r => !r.invoice_no).reduce((t, r) => t + r.total, 0) } };
});
route('GET', '/api/sales-ledger', async ({ user, query }) => {
  requireSales(user);
  const from = dateStr(query.from, '시작일'), to = dateStr(query.to, '종료일');
  if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
  const customer = str(query.customer, 100);
  const before = await ledgerBefore(from, customer);
  if (!customer) {
    const sales = await db.prepare(`SELECT ${customerKey('customer')} AS k, MIN(customer) AS customer, COUNT(*) AS bills, SUM(supply_total) AS supply, SUM(vat_total) AS vat, SUM(total) AS total FROM sales_bills WHERE status='confirmed' AND bill_date>=? AND bill_date<=? GROUP BY k`).all(from, to);
    const pays = await db.prepare(`SELECT ${customerKey('customer')} AS k, MIN(customer) AS customer, SUM(CASE WHEN kind='payment' THEN amount ELSE 0 END) AS paid, SUM(CASE WHEN kind='opening' THEN amount ELSE 0 END) AS opening FROM sales_payments WHERE status='confirmed' AND pay_date>=? AND pay_date<=? GROUP BY k`).all(from, to);
    const map = new Map();
    const get = (k, name) => { if (!map.has(k)) map.set(k, { customer: name, opening: 0, bills: 0, supply: 0, vat: 0, total: 0, paid: 0 }); return map.get(k); };
    for (const [k, g] of before) get(k, g.customer).opening = g.opening;
    for (const s of sales) Object.assign(get(s.k, s.customer), { bills: s.bills, supply: s.supply, vat: s.vat, total: s.total });
    for (const p of pays) { const g = get(p.k, p.customer); g.paid = p.paid; g.opening += p.opening; }
    const rows = [...map.values()].map(r => ({ ...r, balance: r.opening + r.total - r.paid })).filter(r => r.opening || r.total || r.paid || r.balance).sort((a, b) => stockCompare(a.customer, b.customer));
    return { from, to, customer: '', rows };
  }
  const key = nameKey(customer), opening = [...before.values()][0]?.opening || 0;
  const lines = await db.prepare(`SELECT b.id AS bill_id, b.bill_no, b.bill_date AS date, l.id, l.item, ${LINE_CAT('l')} AS category, l.spec, l.unit, l.product_code, l.lot, l.qty, l.unit_price, l.supply, l.vat, l.note FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id WHERE b.status='confirmed' AND b.bill_date>=? AND b.bill_date<=? AND ${customerKey('b.customer')}=? ORDER BY b.bill_date, b.id, l.id LIMIT 5001`).all(from, to, key);
  const pays = await db.prepare(`SELECT id, pay_date AS date, kind, amount, method, note FROM sales_payments WHERE status='confirmed' AND pay_date>=? AND pay_date<=? AND ${customerKey('customer')}=? ORDER BY pay_date, id LIMIT 5001`).all(from, to, key);
  if (lines.length > 5000 || pays.length > 5000) throw bad('줄이 너무 많습니다. 기간을 좁히세요.');
  const rows = [
    ...pays.map(p => ({ kind: p.kind, date: p.date, order: 0, id: p.id, item: p.kind === 'opening' ? '기초 미수금' : `${customer}-입금`, method: p.method, note: p.note, sale: p.kind === 'opening' ? p.amount : 0, paid: p.kind === 'payment' ? p.amount : 0 })),
    ...lines.map(l => ({ kind: 'sale', date: l.date, order: 1, id: l.id, bill_id: l.bill_id, bill_no: l.bill_no, item: l.item, category: l.category, spec: l.spec, unit: l.unit, product_code: l.product_code, lot: l.lot, qty: l.qty, unit_price: l.unit_price, supply: l.supply, vat: l.vat, sale: l.supply + l.vat, paid: 0, note: l.note })),
  ].sort((a, b) => stockCompare(a.date, b.date) || a.order - b.order || a.id - b.id);
  let balance = opening;
  for (const r of rows) { balance += r.sale - r.paid; r.balance = balance; delete r.order; }
  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  return { from, to, customer, opening, rows, totals: { qty: sum('qty'), supply: sum('supply'), vat: sum('vat'), sale: sum('sale'), paid: sum('paid'), balance } };
});
// 매출 마감: 달(YYYY-MM)의 고객사별 전표·입금 합계, 전표 없는 출하, 마감 상태
route('GET', '/api/sales-closing', async ({ user, query }) => {
  requireSales(user);
  const period = billPeriod(query.period), from = period + '-01', to = monthEnd(period);
  const bills = await db.prepare(`SELECT MIN(customer) AS customer, COUNT(*) AS bill_count, SUM(supply_total) AS supply_total, SUM(vat_total) AS vat_total, SUM(total) AS total FROM sales_bills WHERE status='confirmed' AND bill_date>=? AND bill_date<=? GROUP BY ${customerKey('customer')}`).all(from, to);
  const pays = await db.prepare(`SELECT MIN(customer) AS customer, SUM(amount) AS paid FROM sales_payments WHERE status='confirmed' AND kind='payment' AND pay_date>=? AND pay_date<=? GROUP BY ${customerKey('customer')}`).all(from, to);
  const open = await unbilledShipments({ from, to, limit: 5000 });
  const closings = await db.prepare("SELECT * FROM sales_closings WHERE period=? AND status='closed'").all(period);
  const map = new Map();
  const get = customer => { const key = nameKey(customer); if (!map.has(key)) map.set(key, { customer, bill_count: 0, supply_total: 0, vat_total: 0, total: 0, payment_total: 0, unbilled_lines: 0, closing: null }); return map.get(key); };
  for (const b of bills) Object.assign(get(b.customer), { bill_count: b.bill_count, supply_total: b.supply_total, vat_total: b.vat_total, total: b.total });
  for (const p of pays) get(p.customer).payment_total = p.paid;
  for (const r of open) get(r.customer).unbilled_lines++;
  for (const c of closings) get(c.customer).closing = c;
  const rows = [...map.values()].sort((a, b) => stockCompare(a.customer, b.customer));
  return { period, from, to, rows, unbilled: open.slice(0, 500), can_reopen: !!user.is_admin };
});
route('POST', '/api/sales-closing', async ({ user, body }) => {
  requireSales(user);
  const period = billPeriod(body.period), customer = reqStr(body.customer, '거래처', 100), key = nameKey(customer);
  if (period >= today().slice(0, 7)) throw bad('이번 달은 아직 마감할 수 없습니다. 지난달부터 마감하세요.');
  const from = period + '-01', to = monthEnd(period);
  const sum = await db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(supply_total),0) AS s, COALESCE(SUM(vat_total),0) AS v, COALESCE(SUM(total),0) AS t FROM sales_bills WHERE status='confirmed' AND bill_date>=? AND bill_date<=? AND ${customerKey('customer')}=?`).get(from, to, key);
  const paid = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS p FROM sales_payments WHERE status='confirmed' AND kind='payment' AND pay_date>=? AND pay_date<=? AND ${customerKey('customer')}=?`).get(from, to, key);
  try { await db.prepare('INSERT INTO sales_closings(period,customer_key,customer,bill_count,supply_total,vat_total,total,payment_total,closed_by) VALUES(?,?,?,?,?,?,?,?,?)').run(period, key, customer, sum.c, sum.s, sum.v, sum.t, paid.p, user.name); }
  catch (error) { if (/UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '이미 마감되었습니다.'); throw error; }
  return db.prepare("SELECT * FROM sales_closings WHERE period=? AND customer_key=? AND status='closed'").get(period, key);
});
route('POST', '/api/sales-closing/reopen', async ({ user, body }) => {
  requireAdmin(user);
  const period = billPeriod(body.period), key = nameKey(reqStr(body.customer, '거래처', 100));
  const r = await db.prepare("UPDATE sales_closings SET status='reopened',reopened_by=?,reopened_at=? WHERE period=? AND customer_key=? AND status='closed'").run(user.name, now(), period, key);
  if (!r.changes) throw bad('마감된 내역이 없습니다.');
  return { ok: true };
});
// 엑셀 내려받기용: 기간의 전표 줄(매입/매출)
route('GET', '/api/bill-lines', async ({ user, query }) => {
  const side = query.side === 'sales' ? 'sales' : 'purchase';
  if (side === 'sales') requireSales(user); else requirePurchase(user);
  const from = dateStr(query.from, '시작일'), to = dateStr(query.to, '종료일'), party = str(query.party, 100);
  const T = side === 'sales' ? { b: 'sales_bills', l: 'sales_bill_lines', p: 'customer', d: 'l.ship_date', extra: 'l.vat' } : { b: 'purchase_bills', l: 'purchase_bill_lines', p: 'vendor', d: 'l.received_date', extra: 'NULL' };
  const where = ["b.status='confirmed'", 'b.bill_date>=?', 'b.bill_date<=?'], args = [from, to];
  if (party) { where.push(`${customerKey('b.' + T.p)}=?`); args.push(nameKey(party)); }
  const rows = await db.prepare(`SELECT b.bill_no, b.bill_date, b.${T.p} AS party, b.tax_type, ${T.d} AS source_date, ${LINE_CAT('l')} AS category, l.item, l.spec, l.unit, l.product_code, l.lot, l.qty, l.unit_price, l.supply, ${T.extra} AS vat, l.note FROM ${T.l} l JOIN ${T.b} b ON b.id=l.bill_id WHERE ${where.join(' AND ')} ORDER BY b.bill_date, b.id, l.id LIMIT 10001`).all(...args);
  if (rows.length > 10000) throw bad('줄이 너무 많습니다. 기간을 좁히세요.');
  if (side === 'purchase') {
    // 매입 운송비는 전표 머리에 있으므로 그 전표 끝에 「운송비」 줄로 붙인다.
    const freight = await db.prepare(`SELECT b.bill_no, b.bill_date, b.vendor AS party, b.tax_type, b.freight FROM purchase_bills b WHERE ${where.join(' AND ')} AND b.freight>0`).all(...args);
    for (const f of freight) { const at = rows.findLastIndex(r => r.bill_no === f.bill_no); rows.splice(at + 1, 0, { bill_no: f.bill_no, bill_date: f.bill_date, party: f.party, tax_type: f.tax_type, source_date: '', item: '운송비', spec: '', unit: '', product_code: '', lot: '', qty: null, unit_price: null, supply: f.freight, vat: null, note: '' }); }
  }
  return { rows };
});
// ── 영업: 세금계산서 (15.83) ──
// 매출전표를 건별(전표 1건 = 1장) 또는 월별(거래처·기간 합계 1장)로 담고, 세금계산서 관리에서 체크해 「발행」한다.
// 실제 발행(전자서명·국세청 전송)은 트러스빌 ERP 연동(Agent)으로 붙인다. 연동 설정(settings 'tax_link')이 없으면
// 발행 요청은 409로 분명히 막는다(조용히 쌓아 두지 않음). 받는 쪽 사업자 정보는 담을 때 거래처에서 복사한다.
const TAX_STATUS = ['draft', 'queued', 'issued', 'sent', 'failed', 'cancelled'];
const TAX_VENDOR_FIELDS = ['biz_no', 'biz_name', 'ceo', 'address', 'biz_type', 'biz_item', 'tax_email', 'tax_email2', 'tax_reverse'];
const COMPANY_FIELDS = ['biz_no', 'biz_name', 'ceo', 'address', 'biz_type', 'biz_item', 'email', 'phone', 'bank', 'fax'];
const bizNo = v => String(v || '').replace(/[^0-9]/g, '');
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''));
function taxEmail(value, label) { const v = str(value, 100); if (v && !emailOk(v)) throw bad(`${label} 형식을 확인하세요.`); return v; }
function bizNoField(value) { const n = bizNo(value); if (n && n.length !== 10) throw bad('사업자등록번호는 숫자 10자리입니다.'); return n ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : ''; }
async function companyInfo() { let v = {}; try { v = JSON.parse(await getSetting('company_tax_info') || '{}'); } catch { v = {}; } return Object.fromEntries(COMPANY_FIELDS.map(k => [k, String(v[k] || '')])); }
route('GET', '/api/tax-company', async ({ user }) => { requireSales(user); return companyInfo(); });
route('PUT', '/api/tax-company', async ({ user, body }) => {
  requireAdmin(user);
  const v = { biz_no: bizNoField(body.biz_no), biz_name: str(body.biz_name, 100), ceo: str(body.ceo, 50), address: str(body.address, 200), biz_type: str(body.biz_type, 100), biz_item: str(body.biz_item, 100), email: taxEmail(body.email, '이메일'), phone: str(body.phone, 30), bank: str(body.bank, 100), fax: str(body.fax, 30) };
  await setSetting('company_tax_info', JSON.stringify(v));
  return v;
});
// 거래처 사업자 정보(세금계산서용)
// 15.266 사업자 정보 값(거래처 등록·수정 한 번에 쓰려고 함수로). 본문에 사업자 칸이 하나도 없으면 null.
function vendorTaxValues(body, row = {}) {
  if (!TAX_VENDOR_FIELDS.some(k => body[k] !== undefined)) return null;
  const pick = (k, f) => body[k] === undefined ? row[k] ?? '' : f(body[k]);
  return { biz_no: pick('biz_no', bizNoField), biz_name: pick('biz_name', x => str(x, 100)), ceo: pick('ceo', x => str(x, 50)), address: pick('address', x => str(x, 200)), biz_type: pick('biz_type', x => str(x, 100)), biz_item: pick('biz_item', x => str(x, 100)),
    tax_email: pick('tax_email', x => taxEmail(x, '세금계산서 이메일 1')), tax_email2: pick('tax_email2', x => taxEmail(x, '세금계산서 이메일 2')),
    tax_reverse: body.tax_reverse === undefined ? row.tax_reverse || 0 : (body.tax_reverse === true || body.tax_reverse === 1 || body.tax_reverse === '1' || (Array.isArray(body.tax_reverse) && body.tax_reverse.length)) ? 1 : 0 };
}
const vendorTaxChanged = (v, row) => v && TAX_VENDOR_FIELDS.some(k => String(v[k] ?? '') !== String(row[k] ?? ''));
route('PUT', '/api/vendors/:id/tax-info', async ({ user, params, body }) => {
  if (!hasRole(user, 'sales') && !hasRole(user, 'purchase')) throw new HttpError(403, '사업자 정보는 영업·구매 담당자나 관리자가 고칩니다.');
  const row = await mustGet('vendors', params.id);
  const v = { biz_no: bizNoField(body.biz_no), biz_name: str(body.biz_name, 100), ceo: str(body.ceo, 50), address: str(body.address, 200), biz_type: str(body.biz_type, 100), biz_item: str(body.biz_item, 100), tax_email: taxEmail(body.tax_email, '세금계산서 이메일 1'), tax_email2: taxEmail(body.tax_email2, '세금계산서 이메일 2'), tax_reverse: body.tax_reverse === undefined ? row.tax_reverse || 0 : (body.tax_reverse === true || body.tax_reverse === 1 || body.tax_reverse === '1' || (Array.isArray(body.tax_reverse) && body.tax_reverse.length)) ? 1 : 0 };
  await db.prepare(`UPDATE vendors SET ${TAX_VENDOR_FIELDS.map(k => `${k}=?`).join(',')},updated_by=?,updated_at=? WHERE id=?`).run(...TAX_VENDOR_FIELDS.map(k => v[k]), user.name, now(), row.id);
  return decodeVendor(await mustGet('vendors', row.id));
});
const vendorByName = name => db.prepare('SELECT * FROM vendors WHERE name_key=?').get(nameKey(name));
const UNINVOICED = "NOT EXISTS(SELECT 1 FROM tax_invoice_bills t WHERE t.bill_id=b.id AND t.active=1)";
// 아직 계산서에 담지 않은 확정 매출전표(기간·거래처)
async function invoiceCandidates({ from, to, customer = '' }) {
  const where = ["b.status='confirmed'", UNINVOICED, 'b.bill_date>=?', 'b.bill_date<=?'], args = [from, to];
  if (customer) { where.push(`${customerKey('b.customer')}=?`); args.push(nameKey(customer)); }
  const rows = await db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM sales_bill_lines l WHERE l.bill_id=b.id) AS line_count, (SELECT item FROM sales_bill_lines l WHERE l.bill_id=b.id ORDER BY l.id LIMIT 1) AS first_item FROM sales_bills b WHERE ${where.join(' AND ')} ORDER BY b.bill_date, b.id LIMIT 2001`).all(...args);
  if (rows.length > 2000) throw bad('전표가 너무 많습니다. 기간을 좁히세요.');
  return rows;
}
const isFreightName = name => /^\s*(운송비|운반비|택배비|배송비)\s*$/.test(String(name || '')); // 15.204 「외 n종」에서 뺄 운송비 줄
const itemLabel = (first, count) => `${first || ''}${count > 1 ? ` 외 ${count - 1}건` : ''}`;
route('GET', '/api/tax-invoices/candidates', async ({ user, query }) => {
  requireSales(user);
  const from = dateStr(query.from, '시작일'), to = dateStr(query.to, '종료일'); if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
  const bills = await invoiceCandidates({ from, to, customer: str(query.customer, 100) });
  const map = new Map();
  for (const b of bills) { const k = nameKey(b.customer), g = map.get(k) || { customer: b.customer, bills: 0, supply_total: 0, vat_total: 0, total: 0, first_item: b.first_item, lines: 0 }; g.bills++; g.lines += b.line_count; g.supply_total += b.supply_total; g.vat_total += b.vat_total; g.total += b.total; map.set(k, g); }
  const vendors = new Map(); for (const g of map.values()) { const v = await vendorByName(g.customer); vendors.set(nameKey(g.customer), v); g.biz_no = v?.biz_no || ''; g.tax_email = v?.tax_email || ''; g.tax_email2 = v?.tax_email2 || ''; }
  return { from, to, bills: bills.map(b => ({ ...b, biz_no: vendors.get(nameKey(b.customer))?.biz_no || '', tax_email: vendors.get(nameKey(b.customer))?.tax_email || '' })), customers: [...map.values()].sort((a, b) => stockCompare(a.customer, b.customer)) };
});
function invoiceRow(v, { kind, customer, writeDate, from = '', to = '', charge, email1, email2, note, items, bills, uid, token, user, issueType = '', docType = '' }) {
  const issue = issueType === 'reverse' || issueType === 'normal' ? issueType : v?.tax_reverse ? 'reverse' : 'normal'; // 15.138
  const supply = bills.reduce((t, b) => t + b.supply_total, 0), vat = bills.reduce((t, b) => t + b.vat_total, 0);
  const summary = kind === 'single' ? itemLabel(items[0]?.item, items.length) : itemLabel(items[0]?.item?.replace(/ 외 \d+건$/, ''), bills.reduce((t, b) => t + b.line_count, 0));
  const prefix = `TI-${today().slice(2).replace(/-/g, '')}-`;
  return { sql: `INSERT INTO tax_invoices(uid,invoice_no,kind,write_date,period_from,period_to,charge,customer,biz_no,biz_name,ceo,address,biz_type,biz_item,email1,email2,items,item_summary,supply_total,vat_total,total,note,request_id,created_by,created_by_id,issue_type,doc_type) VALUES(?,${nextDocNo('tax_invoices', 'invoice_no')},?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [uid, prefix, prefix, prefix, kind, writeDate, from, to, charge, customer, v?.biz_no || '', v?.biz_name || v?.name || customer, v?.ceo || '', v?.address || '', v?.biz_type || '', v?.biz_item || '', email1, email2, JSON.stringify(items), summary, supply, vat, supply + vat, note, token, user.name, user.id, issue, docType === 'tax' || docType === 'free' ? docType : vat === 0 ? 'free' : 'tax'] }; // 15.143 세액 0이면 계산서(면세)
}
// 담는 순간에도 확정 전표일 때만 넣는다(그 사이 취소되면 RC_GUARD로 batch 전체 되돌림).
const linkBill = (uid, billId) => [{ sql: "INSERT INTO tax_invoice_bills(invoice_id,bill_id) SELECT (SELECT id FROM tax_invoices WHERE uid=?),? WHERE EXISTS(SELECT 1 FROM sales_bills WHERE id=? AND status='confirmed')", args: [uid, billId, billId] }, RC_GUARD];
// 월별: 전표마다 문장을 만들지 않고 한 문장으로 잇고, 읽은 건수·합계와 다르면(그 사이 바뀜) 되돌린다(D1 요청당 문장 수 제한).
const linkPeriod = (uid, customer, from, to, count, total) => [
  { sql: `INSERT INTO tax_invoice_bills(invoice_id,bill_id) SELECT (SELECT id FROM tax_invoices WHERE uid=?), b.id FROM sales_bills b WHERE b.status='confirmed' AND ${UNINVOICED} AND b.bill_date>=? AND b.bill_date<=? AND ${customerKey('b.customer')}=?`, args: [uid, from, to, nameKey(customer)] },
  { sql: "SELECT json('conflict') FROM (SELECT COUNT(*) AS c, COALESCE(SUM(b.total),0) AS t FROM tax_invoice_bills x JOIN sales_bills b ON b.id=x.bill_id WHERE x.invoice_id=(SELECT id FROM tax_invoices WHERE uid=?) AND x.active=1) WHERE c<>? OR ABS(t-?)>0.005", args: [uid, count, total] },
];
async function invoiceDetail(inv) {
  const bills = await db.prepare('SELECT b.id, b.bill_no, b.bill_date, b.total, t.active FROM tax_invoice_bills t JOIN sales_bills b ON b.id=t.bill_id WHERE t.invoice_id=? ORDER BY b.bill_date, b.id').all(inv.id);
  let items = []; try { items = JSON.parse(inv.items || '[]'); } catch { items = []; }
  return { ...inv, items, bills };
}
// 담기: kind single → bill_ids 마다 한 장, monthly → customer·from·to 의 담지 않은 전표 전부를 한 장
route('POST', '/api/tax-invoices', async ({ user, body }) => {
  requireSales(user);
  const token = String(body.request_id || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw bad('등록 요청 번호를 확인하세요.');
  const prior = await db.prepare('SELECT * FROM tax_invoices WHERE request_id=? ORDER BY id').all(token);
  if (prior.length) { if (prior[0].created_by_id !== user.id) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.'); return { rows: prior, duplicate: true }; }
  const charge = body.charge === 'claim' ? 'claim' : 'receipt', note = str(body.note, 200); // 기본 영수(사용자 화면 기준)
  const cmds = [], made = [];
  if (body.kind === 'monthly') {
    const customer = reqStr(body.customer, '거래처', 100), from = dateStr(body.from, '시작일'), to = dateStr(body.to, '종료일');
    if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
    const writeDate = body.write_date ? dateStr(body.write_date, '작성일자') : to;
    if (writeDate < from) throw bad('작성일자는 기간 시작일 이후여야 합니다.');
    const bills = await invoiceCandidates({ from, to, customer });
    if (!bills.length) throw bad(`${customer}의 ${from} ~ ${to} 사이에 담을 매출전표가 없습니다.`);
    const v = await vendorByName(customer), uid = crypto.randomUUID();
    const items = bills.map(b => ({ date: b.bill_date, item: itemLabel(b.first_item, b.line_count), spec: '', qty: null, unit_price: null, supply: b.supply_total, vat: b.vat_total, note: b.bill_no }));
    cmds.push(invoiceRow(v, { kind: 'monthly', customer, writeDate, from, to, charge, email1: taxEmail(body.email1 ?? v?.tax_email, '이메일 1'), email2: taxEmail(body.email2 ?? v?.tax_email2, '이메일 2'), note, items, bills, uid, token, user }), ...linkPeriod(uid, customer, from, to, bills.length, bills.reduce((t, b) => t + b.total, 0)));
    made.push(uid);
  } else if (body.kind === 'single') {
    const ids = Array.isArray(body.bill_ids) ? [...new Set(body.bill_ids.map(Number))] : [];
    if (!ids.length || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('담을 전표를 1~100건 고르세요.');
    for (const id of ids) {
      const b = await db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM sales_bill_lines l WHERE l.bill_id=b.id) AS line_count FROM sales_bills b WHERE b.id=? AND b.status='confirmed' AND ${UNINVOICED}`).get(id);
      if (!b) throw new HttpError(409, '이미 계산서에 담겼거나 취소된 전표가 있습니다. 목록을 새로 불러오세요.');
      const lines = await db.prepare('SELECT * FROM sales_bill_lines WHERE bill_id=? ORDER BY id').all(b.id);
      const v = await vendorByName(b.customer), uid = crypto.randomUUID();
      const writeDate = body.write_date ? dateStr(body.write_date, '작성일자') : b.bill_date;
      // 15.198 품목이 여러 줄이면 「첫 품목 외 n종」 한 줄로 합산(전표 합계). 양식 창에서 고칠 수 있다.
      const goods = lines.filter(l => !isFreightName(l.item)), head = goods[0] || lines[0]; // 15.204 운송비 줄은 종 수에서 뺀다
      const items = lines.length > 1 ? [{ date: b.bill_date, item: `${head.item}${goods.length > 1 ? ` 외 ${goods.length - 1}종` : ''}`, spec: '', qty: null, unit_price: null, supply: lines.reduce((t, l) => t + l.supply, 0), vat: lines.reduce((t, l) => t + l.vat, 0), note: '' }]
        : lines.map(l => ({ date: b.bill_date, item: l.item, spec: l.spec, qty: l.qty, unit_price: l.unit_price, supply: l.supply, vat: l.vat, note: l.note }));
      cmds.push(invoiceRow(v, { kind: 'single', customer: b.customer, writeDate, charge, email1: taxEmail(v?.tax_email, '이메일 1'), email2: taxEmail(v?.tax_email2, '이메일 2'), note, items, bills: [b], uid, token, user }), ...linkBill(uid, b.id));
      made.push(uid);
    }
  } else if (body.kind === 'merge') {
    // 15.131 매출전표 목록에서 체크한 전표를 거래처마다 한 장으로 합산
    const ids = Array.isArray(body.bill_ids) ? [...new Set(body.bill_ids.map(Number))] : [];
    if (!ids.length || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('담을 전표를 1~100건 고르세요.');
    const groups = new Map();
    for (const id of ids) {
      const b = await db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM sales_bill_lines l WHERE l.bill_id=b.id) AS line_count, (SELECT item FROM sales_bill_lines l WHERE l.bill_id=b.id ORDER BY l.id LIMIT 1) AS first_item FROM sales_bills b WHERE b.id=? AND b.status='confirmed' AND ${UNINVOICED}`).get(id);
      if (!b) throw new HttpError(409, '이미 계산서에 담겼거나 취소된 전표가 있습니다. 목록을 새로 불러오세요.');
      const k = nameKey(b.customer); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b);
    }
    for (const bills of groups.values()) {
      bills.sort((x, y) => x.bill_date.localeCompare(y.bill_date) || x.id - y.id);
      const customer = bills[0].customer, from = bills[0].bill_date, to = bills[bills.length - 1].bill_date;
      const writeDate = body.write_date ? dateStr(body.write_date, '작성일자') : to;
      const v = await vendorByName(customer), uid = crypto.randomUUID();
      const items = bills.map(b => ({ date: b.bill_date, item: itemLabel(b.first_item, b.line_count), spec: '', qty: null, unit_price: null, supply: b.supply_total, vat: b.vat_total, note: b.bill_no }));
      cmds.push(invoiceRow(v, { kind: 'monthly', customer, writeDate, from, to, charge, email1: taxEmail(v?.tax_email, '이메일 1'), email2: taxEmail(v?.tax_email2, '이메일 2'), note, items, bills, uid, token, user }), ...bills.flatMap(b => linkBill(uid, b.id)));
      made.push(uid);
    }
  } else throw bad('담는 방식(건별·월별)을 고르세요.');
  try { await db.batch(cmds); }
  catch (error) {
    const saved = await db.prepare('SELECT * FROM tax_invoices WHERE request_id=? ORDER BY id').all(token);
    if (saved.length && saved[0].created_by_id === user.id) return { rows: saved, duplicate: true };
    if (isGuardError(error) || /UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, '그 사이 전표가 바뀌었거나 다른 계산서에 담겼습니다. 목록을 새로 불러오세요.');
    throw error;
  }
  return { rows: await db.prepare('SELECT * FROM tax_invoices WHERE request_id=? ORDER BY id').all(token) };
});
// ── 15.127 세금계산서 분류(원자재·부자재·반제품·제품·상품·임가공·운송비·미분류) · 매입 세금계산서 ──
const TAX_CATS = [...ITEM_CATEGORIES, '운송비', '미분류'];
function taxCategory(value) { const c = String(value || ''); if (!TAX_CATS.includes(c)) throw bad('분류를 확인하세요.'); return c; }
// 매출 계산서: 담긴 매출전표 줄 분류. 매입 계산서: 담긴 매입전표 줄 분류 + 운송비(전표 운송비).
// cond = 계산서를 고르는 조건(예: t.invoice_id=i.id), active = 담긴 줄(취소된 계산서는 0)
const SALES_INV_LINES = (cond, active = 1) => `SELECT ${LINE_CAT('l')} AS c, l.supply AS amt FROM tax_invoice_bills t JOIN sales_bill_lines l ON l.bill_id=t.bill_id WHERE ${cond} AND t.active=${active} AND l.active=1`;
const PURCHASE_INV_LINES = (cond, active = 1) => `SELECT ${LINE_CAT('l')} AS c, l.supply AS amt FROM purchase_tax_invoice_bills t JOIN purchase_bill_lines l ON l.bill_id=t.bill_id WHERE ${cond} AND t.active=${active} AND l.active=1 UNION ALL SELECT '운송비', b.freight FROM purchase_tax_invoice_bills t JOIN purchase_bills b ON b.id=t.bill_id WHERE ${cond} AND t.active=${active} AND b.freight>0`;
const invCats = sub => `(SELECT group_concat(c, '|') FROM (SELECT CASE WHEN c='' THEN '미분류' ELSE c END || ':' || CAST(SUM(amt) AS INTEGER) AS c FROM (${sub}) GROUP BY CASE WHEN c='' THEN '미분류' ELSE c END))`;
const invHasCat = (sub, c) => ({ sql: `EXISTS(SELECT 1 FROM (${sub}) WHERE (CASE WHEN c='' THEN '미분류' ELSE c END)=?)`, arg: c });
async function invCatTotals(lines, idsSql, args, twice = false) {
  const rows = await db.prepare(`SELECT CASE WHEN c='' THEN '미분류' ELSE c END AS category, SUM(amt) AS supply FROM (${lines(`t.invoice_id IN (${idsSql})`)}) GROUP BY 1`).all(...args, ...(twice ? args : []));
  return rows.sort((a, b) => TAX_CATS.indexOf(a.category) - TAX_CATS.indexOf(b.category));
}
// 매입 세금계산서 후보: 확정 매입전표 중 아직 계산서에 담지 않은 것(분류·운송비 함께)
route('GET', '/api/purchase-tax-invoices/candidates', async ({ user, query }) => {
  requirePurchase(user);
  const vendor = reqStr(query.vendor, '매입처', 100), from = query.from ? dateStr(query.from, '시작일') : '0000-01-01', to = query.to ? dateStr(query.to, '종료일') : '9999-12-31';
  const rows = await db.prepare(`SELECT b.id, b.bill_no, b.bill_date, b.statement_no, b.supply_total, b.vat_total, b.total, b.freight, b.tax_type,
      (SELECT group_concat(DISTINCT CASE WHEN ${LINE_CAT('l')}='' THEN '미분류' ELSE ${LINE_CAT('l')} END) FROM purchase_bill_lines l WHERE l.bill_id=b.id AND l.active=1) AS categories
    FROM purchase_bills b WHERE b.status='confirmed' AND ${billVendorKey('b.vendor')}=? AND b.bill_date BETWEEN ? AND ?
      AND NOT EXISTS(SELECT 1 FROM purchase_tax_invoice_bills t WHERE t.bill_id=b.id AND t.active=1) ORDER BY b.bill_date, b.id LIMIT 301`).all(nameKey(vendor), from, to);
  return { rows: rows.slice(0, 300), more: rows.length > 300, vendor: (await vendorByName(vendor)) || null };
});
const approvalNo = v => { const s = str(v, 40).replace(/\s+/g, ''); if (s && !/^[0-9-]{8,40}$/.test(s)) throw bad('승인번호는 숫자와 -로 넣으세요(예: 20261117-41000012-1a2b3c4d는 숫자만).'); return s; };
route('POST', '/api/purchase-tax-invoices', async ({ user, body }) => {
  requirePurchase(user);
  const key = str(body.request_id, 80);
  if (key) { const old = await db.prepare('SELECT * FROM purchase_tax_invoices WHERE request_id=?').get(key); if (old) return purchaseInvDetail(old); }
  const vendor = reqStr(body.vendor, '매입처', 100), date = dateStr(body.write_date, '작성일자'), appr = approvalNo(body.approval_no);
  const ids = Array.isArray(body.bill_ids) ? [...new Set(body.bill_ids.map(Number))] : [];
  if (!ids.length || ids.length > 200 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('담을 매입전표를 1~200장 고르세요.');
  if (appr && await db.prepare("SELECT 1 FROM purchase_tax_invoices WHERE approval_no=? AND status='received'").get(appr)) throw new HttpError(409, `승인번호 ${appr}는 이미 등록되어 있습니다.`);
  const bills = [];
  for (const id of ids) {
    const b = await db.prepare("SELECT * FROM purchase_bills WHERE id=? AND status='confirmed'").get(id);
    if (!b) throw new HttpError(409, '취소되었거나 없는 매입전표가 있습니다. 새로 불러오세요.');
    if (nameKey(b.vendor) !== nameKey(vendor)) throw bad(`${b.bill_no}: 다른 매입처(${b.vendor})의 전표입니다.`);
    bills.push(b);
  }
  const supply = bills.reduce((t, b) => t + b.supply_total, 0), vat = bills.reduce((t, b) => t + b.vat_total, 0);
  const v = await vendorByName(vendor), token = key || 'srv:' + crypto.randomUUID(), prefix = `PT-${today().slice(2).replace(/-/g, '')}-`;
  const IID = '(SELECT id FROM purchase_tax_invoices WHERE request_id=?)';
  const cmds = [{ sql: `INSERT INTO purchase_tax_invoices(invoice_no,approval_no,write_date,vendor,biz_no,supply_total,vat_total,total,note,created_by,created_by_id,request_id,issue_type,doc_type) VALUES(${nextDocNo('purchase_tax_invoices', 'invoice_no')},?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [prefix, prefix, prefix, appr, date, vendor, v?.biz_no || '', supply, vat, supply + vat, str(body.note, 500), user.name, user.id, token, body.issue_type === 'reverse' ? 'reverse' : 'normal', body.doc_type === 'tax' || body.doc_type === 'free' ? body.doc_type : vat === 0 ? 'free' : 'tax'] }];
  for (const b of bills) cmds.push({ sql: `INSERT INTO purchase_tax_invoice_bills(invoice_id,bill_id) SELECT ${IID},? WHERE NOT EXISTS(SELECT 1 FROM purchase_tax_invoice_bills WHERE bill_id=? AND active=1)`, args: [token, b.id, b.id] }, RC_GUARD);
  try { await db.batch(cmds); }
  catch (error) { if (isGuardError(error) || /UNIQUE/i.test(String(error?.message))) throw new HttpError(409, '그 사이 다른 계산서에 담긴 전표가 있습니다. 새로 불러오세요.'); throw error; }
  return purchaseInvDetail(await db.prepare('SELECT * FROM purchase_tax_invoices WHERE request_id=?').get(token));
});
// 15.161 매입 계산서 품목 줄: 고쳐 저장한 줄(items)이 있으면 그것, 없으면 담긴 매입전표의 품목 줄(품목·규격·수량·단가·공급가액·세액, 운송비는 따로 한 줄).
// 세액은 전표 세액을 줄마다 나눈다(splitVat, 합이 전표 세액과 같음). 줄이 16개(전자세금계산서 한도)를 넘으면 전표마다 「첫 품목 외 n」 한 줄로 묶는다.
const PTAX_MAX_ITEMS = 16;
async function purchaseInvItems(inv, bills) {
  if (inv.items) { try { const saved = JSON.parse(inv.items); if (Array.isArray(saved) && saved.length) return saved; } catch { /* 아래에서 다시 만듦 */ } }
  const per = [];
  for (const b of bills) {
    const lines = (await db.prepare('SELECT item, spec, unit, qty, unit_price, supply, note FROM purchase_bill_lines WHERE bill_id=? AND active=1 ORDER BY id').all(b.id)).map(l => ({ ...l }));
    if (b.freight) lines.push({ item: '운송비', spec: '', unit: '', qty: null, unit_price: null, supply: b.freight, note: '' });
    const vats = splitVat(lines, b.vat_total);
    per.push({ b, lines: lines.map((l, k) => ({ date: b.bill_date, item: l.item, spec: [l.spec, l.unit].filter(Boolean).join(' '), qty: l.qty, unit_price: l.unit_price, supply: l.supply, vat: vats[k], note: l.note || '' })) });
  }
  const all = per.flatMap(p => p.lines);
  // 15.201 품목이 여러 줄이면(여러 전표 묶음 포함) 「첫 품목 외 n종」 한 줄로 합산(공급가액·세액 = 담긴 전표 합계). 양식에서 고칠 수 있다.
  const goods = all.filter(l => !isFreightName(l.item)), head = goods[0] || all[0]; // 15.204 운송비 줄은 종 수에서 뺀다
  if (all.length > 1) return [{ date: inv.write_date || bills.map(b => b.bill_date).sort().pop(), item: `${head.item}${goods.length > 1 ? ` 외 ${goods.length - 1}종` : ''}`, spec: '', qty: null, unit_price: null,
    supply: all.reduce((t, l) => t + Number(l.supply || 0), 0), vat: all.reduce((t, l) => t + Number(l.vat || 0), 0), note: bills.length > 1 ? `${bills[0].bill_no} 외 ${bills.length - 1}건` : '' }];
  if (all.length <= PTAX_MAX_ITEMS) return all;
  return per.map(({ b, lines }) => ({ date: b.bill_date, item: itemLabel(lines[0]?.item, lines.length), spec: '', qty: null, unit_price: null, supply: b.supply_total, vat: b.vat_total, note: b.bill_no }));
}
async function purchaseInvDetail(inv) {
  const bills = await db.prepare(`SELECT b.id, b.bill_no, b.bill_date, b.statement_no, b.supply_total, b.vat_total, b.total, b.freight FROM purchase_tax_invoice_bills t JOIN purchase_bills b ON b.id=t.bill_id WHERE t.invoice_id=? AND t.active=${inv.status === 'cancelled' ? 0 : 1} ORDER BY b.bill_date, b.id`).all(inv.id);
  const cats = await db.prepare(`SELECT CASE WHEN c='' THEN '미분류' ELSE c END AS category, SUM(amt) AS supply FROM (${PURCHASE_INV_LINES('t.invoice_id=' + Number(inv.id), inv.status === 'cancelled' ? 0 : 1)}) GROUP BY 1`).all();
  const changes = await db.prepare("SELECT summary, changed_by, changed_at FROM doc_changes WHERE doc_type='purchase_tax' AND doc_id=? ORDER BY id DESC LIMIT 20").all(inv.id);
  return { ...inv, bills, items: await purchaseInvItems(inv, bills), items_edited: !!inv.items, changes, categories: cats.sort((a, b) => TAX_CATS.indexOf(a.category) - TAX_CATS.indexOf(b.category)) };
}
// 15.161 받은 매입 계산서 고치기: 작성일자·승인번호·비고·품목 줄(월일·품목·규격·수량·단가·공급가액·세액·비고, 1~16줄).
// 품목 줄의 공급가액·세액 합은 담긴 매입전표 합계와 같아야 한다(장부 금액은 전표가 기준). 마감된 달로/에서 옮길 수 없다. 고친 내용은 이력으로 남긴다.
route('PUT', '/api/purchase-tax-invoices/:id', async ({ user, params, body }) => {
  requirePurchase(user);
  const inv = await mustGet('purchase_tax_invoices', params.id);
  if (inv.status !== 'received') throw bad('취소된 계산서는 고칠 수 없습니다.');
  const date = body.write_date === undefined ? inv.write_date : dateStr(body.write_date, '작성일자');
  for (const d of new Set([inv.write_date, date])) if (await closedPeriod(inv.vendor, d)) throw bad(`${inv.vendor}의 ${d.slice(0, 7)} 매입은 마감되었습니다. 마감 취소(관리자) 뒤에 고치세요.`);
  const appr = body.approval_no === undefined ? inv.approval_no : approvalNo(body.approval_no);
  if (appr && appr !== inv.approval_no && await db.prepare("SELECT 1 FROM purchase_tax_invoices WHERE approval_no=? AND status='received' AND id<>?").get(appr, inv.id)) throw new HttpError(409, `승인번호 ${appr}는 이미 등록되어 있습니다.`);
  const note = body.note === undefined ? inv.note : str(body.note, 500);
  let items = null;
  if (body.items !== undefined) {
    if (!Array.isArray(body.items)) throw bad('품목 줄을 확인하세요.');
    const raw = body.items.filter(e => e && typeof e === 'object' && String(e.item ?? '').trim());
    if (!raw.length || raw.length > PTAX_MAX_ITEMS) throw bad(`품목 줄은 1~${PTAX_MAX_ITEMS}줄로 넣으세요(품목명이 빈 줄은 빠집니다).`);
    const month = date.slice(0, 7), optNum = (v, label) => v === null || v === undefined || v === '' ? null : num(v, label);
    items = raw.map((e, k) => {
      const d = e.date ? dateStr(e.date, `${k + 1}번째 품목 월일`) : date;
      if (d.slice(0, 7) !== month) throw bad(`${k + 1}번째 품목 월일(${d})은 작성일자와 같은 달이어야 합니다.`);
      const supply = Number(e.supply), vat = Number(e.vat ?? 0);
      if (!Number.isInteger(supply) || !Number.isInteger(vat)) throw bad(`${k + 1}번째 품목: 공급가액·세액은 원 단위 정수로 넣으세요.`);
      return { date: d, item: reqStr(e.item, `${k + 1}번째 품목`, 200), spec: str(e.spec, 100), qty: optNum(e.qty, `${k + 1}번째 수량`), unit_price: optNum(e.unit_price, `${k + 1}번째 단가`), supply, vat, note: str(e.note, 200) };
    });
    const s = items.reduce((t, i) => t + i.supply, 0), v = items.reduce((t, i) => t + i.vat, 0);
    if (s !== Number(inv.supply_total) || v !== Number(inv.vat_total)) throw bad(`품목 줄 합계(공급가액 ${won0(s)} · 세액 ${won0(v)})가 담긴 매입전표 합계(공급가액 ${won0(inv.supply_total)} · 세액 ${won0(inv.vat_total)})와 다릅니다. 금액을 맞추거나, 전표 금액이 다르면 매입전표를 먼저 고치세요.`);
  }
  const diff = [];
  if (date !== inv.write_date) diff.push(`작성일자 ${inv.write_date} → ${date}`);
  if ((appr || '') !== (inv.approval_no || '')) diff.push(`승인번호 ${inv.approval_no || '없음'} → ${appr || '없음'}`);
  if (note !== inv.note) diff.push('비고');
  const itemsJson = items ? JSON.stringify(items) : inv.items && date !== inv.write_date ? JSON.stringify(JSON.parse(inv.items).map(i => ({ ...i, date: String(i.date).slice(0, 7) === date.slice(0, 7) ? i.date : date }))) : inv.items;
  if (items && itemsJson !== inv.items) diff.push(`품목 줄 ${items.length}줄`);
  if (!diff.length) return purchaseInvDetail(inv);
  const r = await db.batch([
    { sql: "UPDATE purchase_tax_invoices SET write_date=?, approval_no=?, note=?, items=? WHERE id=? AND status='received'", args: [date, appr, note, itemsJson || '', inv.id] }, RC_GUARD,
    docChange('purchase_tax', inv.id, diff.join(' · '), user),
  ]).catch(error => { if (isGuardError(error)) throw new HttpError(409, '그 사이 계산서가 취소되었습니다. 새로 불러오세요.'); throw error; });
  return { ...await purchaseInvDetail(await mustGet('purchase_tax_invoices', inv.id)), company: await companyInfo(), supplier: await vendorByName(inv.vendor) || null };
});
route('GET', '/api/purchase-tax-invoices', async ({ user, query }) => {
  requirePurchase(user);
  const where = [], args = [];
  applyListDates(where, args, query, 'i.write_date');
  if (query.vendor) { where.push(`${billVendorKey('i.vendor')}=?`); args.push(nameKey(str(query.vendor, 100))); }
  if (query.status) { if (!['received', 'cancelled'].includes(query.status)) throw bad('상태를 확인하세요.'); where.push('i.status=?'); args.push(query.status); } else where.push("i.status='received'");
  applyListKeyword(where, args, query.q, ['i.invoice_no', 'i.approval_no', 'i.vendor', 'i.biz_no', 'i.note', 'i.created_by']);
  if (query.category) { const f = invHasCat(PURCHASE_INV_LINES('t.invoice_id=i.id'), taxCategory(query.category)); where.push(f.sql); args.push(f.arg); }
  const rows = await db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM purchase_tax_invoice_bills t WHERE t.invoice_id=i.id AND t.active=1) AS bill_count, ${invCats(PURCHASE_INV_LINES('t.invoice_id=i.id'))} AS cats FROM purchase_tax_invoices i ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.write_date DESC, i.id DESC LIMIT 1001`).all(...args);
  // 분류별 합계는 받은(유효) 계산서만 — 취소만 볼 때는 비움
  const by_category = query.status === 'cancelled' ? [] : await invCatTotals(PURCHASE_INV_LINES, `SELECT i.id FROM purchase_tax_invoices i WHERE ${where.join(' AND ')}`, args, true);
  return { rows: rows.slice(0, 1000), more: rows.length > 1000, by_category };
});
route('GET', '/api/purchase-tax-invoices/:id', async ({ user, params }) => { requirePurchase(user); const inv = await purchaseInvDetail(await mustGet('purchase_tax_invoices', params.id)); return { ...inv, company: await companyInfo(), supplier: await vendorByName(inv.vendor) || null }; });
route('POST', '/api/purchase-tax-invoices/:id/cancel', async ({ user, params, body }) => {
  requirePurchase(user);
  const inv = await mustGet('purchase_tax_invoices', params.id);
  if (inv.status !== 'received') throw bad('이미 취소된 계산서입니다.');
  const r = await db.batch([
    { sql: "UPDATE purchase_tax_invoices SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status='received'", args: [now(), user.name, str(body.reason, 200), inv.id] }, RC_GUARD,
    { sql: 'UPDATE purchase_tax_invoice_bills SET active=0 WHERE invoice_id=? AND active=1', args: [inv.id] },
  ]).catch(error => { if (isGuardError(error)) throw new HttpError(409, '그 사이 이 계산서가 취소되었습니다.'); throw error; });
  void r; return purchaseInvDetail(await mustGet('purchase_tax_invoices', inv.id));
});

// ── 15.129 세금계산서 발행 체크 ──
// (1) 직접 발행 기록: 트러스빌 연동 전·홈택스에서 직접 발행한 계산서를 승인번호와 함께 「발행 완료」로 표시(되돌리기 가능).
const MANUAL_ISSUED = '직접 발행 기록';
route('POST', '/api/tax-invoices/:id/mark-issued', async ({ user, params, body }) => {
  requireSales(user);
  const inv = await mustGet('tax_invoices', params.id);
  if (!['draft', 'failed'].includes(inv.status)) throw bad(`${inv.invoice_no}: 발행 전 계산서만 직접 발행으로 기록할 수 있습니다.`);
  const appr = approvalNo(body.approval_no); if (!appr) throw bad('국세청 승인번호를 넣으세요.');
  const date = dateStr(body.issued_date || today(), '발행일'); if (date > today()) throw bad('발행일은 오늘 이전으로 넣으세요.');
  if (await db.prepare("SELECT 1 FROM tax_invoices WHERE approval_no=? AND status IN ('issued','sent') AND id<>?").get(appr, inv.id)) throw new HttpError(409, `승인번호 ${appr}는 다른 계산서에 이미 있습니다.`);
  const r = await db.prepare("UPDATE tax_invoices SET status='issued',approval_no=?,issued_at=?,status_message=?,updated_by=?,updated_at=? WHERE id=? AND status IN ('draft','failed')").run(appr, date, `${MANUAL_ISSUED} · ${inv.issue_type === 'reverse' ? '역발행 승인 · ' : ''}${user.name}`, user.name, now(), inv.id);
  if (!r.changes) throw new HttpError(409, '그 사이 이 계산서의 상태가 바뀌었습니다. 새로 불러오세요.');
  return mustGet('tax_invoices', inv.id);
});
route('POST', '/api/tax-invoices/:id/unmark-issued', async ({ user, params }) => {
  requireSales(user);
  const inv = await mustGet('tax_invoices', params.id);
  if (inv.status !== 'issued' || !String(inv.status_message || '').startsWith(MANUAL_ISSUED)) throw bad('직접 발행으로 기록한 계산서만 되돌릴 수 있습니다(트러스빌 발행은 수정 계산서로).');
  await db.prepare("UPDATE tax_invoices SET status='draft',approval_no='',issued_at=NULL,status_message='',updated_by=?,updated_at=? WHERE id=? AND status='issued'").run(user.name, now(), inv.id);
  return mustGet('tax_invoices', inv.id);
});
// (2) 발행 현황 체크: 달(전표 일자 기준)마다 거래처별로 전표 합계 · 발행 완료 · 담았지만 발행 전 · 안 담음.
// 매입은 매입전표 합계 · 받은 계산서 · 안 받음.
route('GET', '/api/tax-check', async ({ user, query }) => {
  const side = query.side === 'purchase' ? 'purchase' : 'sales';
  if (side === 'sales') requireSales(user); else requirePurchase(user);
  const period = billPeriod(query.period), from = period + '-01', to = monthEnd(period);
  let rows;
  if (side === 'sales') {
    rows = await db.prepare(`SELECT MIN(b.customer) AS name, COUNT(*) AS bills, SUM(b.total) AS total,
        SUM(CASE WHEN i.status IN ('issued','sent') THEN b.total ELSE 0 END) AS done, SUM(CASE WHEN i.status IN ('issued','sent') THEN 1 ELSE 0 END) AS done_n,
        SUM(CASE WHEN i.status IN ('draft','queued','failed') THEN b.total ELSE 0 END) AS pending, SUM(CASE WHEN i.status IN ('draft','queued','failed') THEN 1 ELSE 0 END) AS pending_n,
        SUM(CASE WHEN i.id IS NULL THEN b.total ELSE 0 END) AS missing, SUM(CASE WHEN i.id IS NULL THEN 1 ELSE 0 END) AS missing_n,
        MAX(v.biz_no) AS biz_no
      FROM sales_bills b LEFT JOIN tax_invoice_bills t ON t.bill_id=b.id AND t.active=1 LEFT JOIN tax_invoices i ON i.id=t.invoice_id AND i.status<>'cancelled'
        LEFT JOIN vendors v ON v.name_key=${customerKey('b.customer')}
      WHERE b.status='confirmed' AND b.bill_date BETWEEN ? AND ? GROUP BY ${customerKey('b.customer')} ORDER BY missing DESC, pending DESC, name`).all(from, to);
  } else {
    rows = await db.prepare(`SELECT MIN(b.vendor) AS name, COUNT(*) AS bills, SUM(b.total) AS total,
        SUM(CASE WHEN i.id IS NOT NULL THEN b.total ELSE 0 END) AS done, SUM(CASE WHEN i.id IS NOT NULL THEN 1 ELSE 0 END) AS done_n,
        0 AS pending, 0 AS pending_n,
        SUM(CASE WHEN i.id IS NULL THEN b.total ELSE 0 END) AS missing, SUM(CASE WHEN i.id IS NULL THEN 1 ELSE 0 END) AS missing_n, MAX(v.biz_no) AS biz_no
      FROM purchase_bills b LEFT JOIN purchase_tax_invoice_bills t ON t.bill_id=b.id AND t.active=1 LEFT JOIN purchase_tax_invoices i ON i.id=t.invoice_id AND i.status='received'
        LEFT JOIN vendors v ON v.name_key=${billVendorKey('b.vendor')}
      WHERE b.status='confirmed' AND b.bill_date BETWEEN ? AND ? GROUP BY ${billVendorKey('b.vendor')} ORDER BY missing DESC, name`).all(from, to);
  }
  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  return { side, period, from, to, rows, totals: { bills: sum('bills'), total: sum('total'), done: sum('done'), pending: sum('pending'), missing: sum('missing') } };
});
route('GET', '/api/tax-invoices', async ({ user, query }) => {
  requireSales(user);
  const where = [], args = [];
  applyListDates(where, args, query, 'write_date');
  if (query.customer) { where.push(`${customerKey('customer')}=?`); args.push(nameKey(str(query.customer, 100))); }
  if (query.status) { if (!TAX_STATUS.includes(query.status)) throw bad('상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  else where.push("status<>'cancelled'");
  applyListKeyword(where, args, query.q, ['invoice_no', 'customer', 'biz_no', 'item_summary', 'email1', 'email2', 'note', 'approval_no']);
  // 15.138 발행구분·문서(세금계산서/계산서)·수신·국세청 상태
  if (query.issue_type) { if (!['normal', 'reverse'].includes(query.issue_type)) throw bad('발행구분을 확인하세요.'); where.push('issue_type=?'); args.push(query.issue_type); }
  if (query.doc === 'tax' || query.doc === 'free') { where.push('doc_type=?'); args.push(query.doc); }
  const STATE_WHERE = { draft: "status IN ('draft','failed')", unconfirmed: "status IN ('issued','sent') AND recv_status=''", confirmed: "recv_status='confirmed'", rejected: "recv_status='rejected'", nts_pending: "status IN ('draft','queued','issued','failed')", nts_sent: "status='sent'" };
  if (query.state) { if (!STATE_WHERE[query.state]) throw bad('상태를 확인하세요.'); where.push(STATE_WHERE[query.state]); }
  if (query.category) { const f = invHasCat(SALES_INV_LINES('t.invoice_id=tax_invoices.id'), taxCategory(query.category)); where.push(f.sql); args.push(f.arg); } // 15.127
  const by_category = query.status === 'cancelled' ? [] : await invCatTotals(SALES_INV_LINES, `SELECT id FROM tax_invoices WHERE ${where.join(' AND ')}`, args);
  const rows = await db.prepare(`SELECT id,invoice_no,kind,write_date,period_from,period_to,charge,customer,biz_no,email1,email2,item_summary,supply_total,vat_total,total,note,status,approval_no,status_message,issued_at,created_by,created_at,issue_type,recv_status,recv_at,recv_by,doc_type,(SELECT COUNT(*) FROM tax_invoice_bills t WHERE t.invoice_id=tax_invoices.id) AS bill_count,${invCats(SALES_INV_LINES('t.invoice_id=tax_invoices.id'))} AS cats FROM tax_invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY write_date DESC, id DESC LIMIT 1001`).all(...args);
  // 15.138 아래 요약(기존 ERP처럼): 수신자 미확인·확인·거부, 국세청 전송·미전송, 역발행
  const live = rows.filter(r => r.status !== 'cancelled'), grp = f => { const l = live.filter(f); return { n: l.length, supply: l.reduce((t, r) => t + r.supply_total, 0), vat: l.reduce((t, r) => t + r.vat_total, 0) }; };
  const summary = { all: grp(() => true), unconfirmed: grp(r => ['issued', 'sent'].includes(r.status) && !r.recv_status), confirmed: grp(r => r.recv_status === 'confirmed'), rejected: grp(r => r.recv_status === 'rejected'), nts_sent: grp(r => r.status === 'sent'), nts_pending: grp(r => r.status !== 'sent'), reverse: grp(r => r.issue_type === 'reverse'), normal: grp(r => r.issue_type !== 'reverse'), draft: grp(r => ['draft', 'failed', 'queued'].includes(r.status)) };
  return { rows: rows.slice(0, 1000), more: rows.length > 1000, linked: !!(await getSetting('tax_link')), by_category, summary };
});
route('GET', '/api/tax-invoices/:id', async ({ user, params }) => { requireSales(user); return { ...await invoiceDetail(await mustGet('tax_invoices', params.id)), company: await companyInfo() }; });
// 담은 계산서(발행 전·실패) 고치기: 작성일자·청구/영수·이메일 2개·비고, 거래처 사업자 정보 다시 불러오기
route('PUT', '/api/tax-invoices/:id', async ({ user, params, body }) => {
  requireSales(user);
  const inv = await mustGet('tax_invoices', params.id);
  // 15.164 역발행(거래처가 홈택스에서 발행, 우리는 기록만)은 발행 기록 뒤에도 고칠 수 있다. 우리가 발행한 정발행은 발행 요청 뒤 못 고침.
  const pending = ['draft', 'failed'].includes(inv.status), reverseEdit = inv.issue_type === 'reverse' && inv.status !== 'cancelled';
  if (!pending && !reverseEdit) throw bad('발행을 요청한 계산서는 고칠 수 없습니다(역발행 계산서는 발행 기록 뒤에도 고칠 수 있음).');
  // 15.169 동시 수정 막기: 화면이 읽은 버전(updated_at)과 다르면 409(그 사이 다른 사람이 발행 기록·수정)
  if (body.version !== undefined && String(body.version ?? '') !== String(inv.updated_at ?? '')) throw new HttpError(409, '그 사이 다른 사람이 이 계산서를 고쳤거나 발행을 기록했습니다. 창을 닫고 다시 열어 주세요.');
  const writeDate = body.write_date === undefined ? inv.write_date : dateStr(body.write_date, '작성일자');
  if (inv.kind === 'monthly' && inv.period_from && writeDate < inv.period_from) throw bad('작성일자는 기간 시작일 이후여야 합니다.');
  if (!pending) for (const d of new Set([inv.write_date, writeDate])) if (await salesClosed(inv.customer, d)) throw bad(closedMessage(inv.customer, d, '발행된 역발행 계산서를 고치세요')); // 15.169
  const set = { write_date: writeDate, charge: body.charge === undefined ? inv.charge : body.charge === 'receipt' ? 'receipt' : 'claim', email1: body.email1 === undefined ? inv.email1 : taxEmail(body.email1, '이메일 1'), email2: body.email2 === undefined ? inv.email2 : taxEmail(body.email2, '이메일 2'), note: body.note === undefined ? inv.note : str(body.note, 200) };
  if (body.refresh_customer) { const v = await vendorByName(inv.customer); if (v) Object.assign(set, { biz_no: v.biz_no, biz_name: v.biz_name || v.name, ceo: v.ceo, address: v.address, biz_type: v.biz_type, biz_item: v.biz_item }); }
  // 15.142 양식 창에서 바로 고치기: 공급받는자 정보 · 품목 줄(월일·품목·규격·비고, 금액은 전표 그대로)
  if (body.buyer && typeof body.buyer === 'object' && !body.refresh_customer) {
    const b = body.buyer; Object.assign(set, { biz_no: b.biz_no === undefined ? inv.biz_no : bizNoField(b.biz_no), biz_name: str(b.biz_name ?? inv.biz_name, 100), ceo: str(b.ceo ?? inv.ceo, 50), address: str(b.address ?? inv.address, 200), biz_type: str(b.biz_type ?? inv.biz_type, 100), biz_item: str(b.biz_item ?? inv.biz_item, 100) });
  }
  if (body.issue_type !== undefined && pending) { if (!['normal', 'reverse'].includes(body.issue_type)) throw bad('발행구분을 확인하세요.'); if (body.issue_type !== inv.issue_type) set.issue_type = body.issue_type; }
  if (body.approval_no !== undefined && reverseEdit) {
    const appr = approvalNo(body.approval_no);
    if (appr && appr !== inv.approval_no && await db.prepare("SELECT 1 FROM tax_invoices WHERE approval_no=? AND status<>'cancelled' AND id<>?").get(appr, inv.id)) throw new HttpError(409, `승인번호 ${appr}는 이미 다른 계산서에 있습니다.`);
    set.approval_no = appr;
  }
  if (body.doc_type !== undefined) { if (!['tax', 'free'].includes(body.doc_type)) throw bad('문서 구분을 확인하세요.'); if (body.doc_type === 'free' && Number(inv.vat_total) !== 0) throw bad('계산서(면세)는 세액이 0이어야 합니다. 영세·면세 전표로 담으세요.'); set.doc_type = body.doc_type; }
  let items; try { items = JSON.parse(inv.items || '[]'); } catch { items = []; }
  const month = writeDate.slice(0, 7);
  if (Array.isArray(body.items)) {
    // 15.162 수량·단가·공급가액·세액도 고치고 줄을 보태거나(품목명 넣기) 뺄(품목명 비우기) 수 있다. 줄 금액 합은 계산서(담긴 전표) 합계와 같아야 한다.
    const raw = body.items.filter(e => e && typeof e === 'object' && String(e.item ?? '').trim()), max = Math.max(16, items.length);
    const aligned = body.items.length === items.length && raw.length === items.length; // 15.169 줄을 보태거나 뺐으면 옛 줄 값을 물려받지 않는다
    if (!raw.length || raw.length > max) throw bad(`품목 줄은 1~${max}줄로 넣으세요(품목명이 빈 줄은 빠집니다).`);
    const optNum = (v, old, label) => v === undefined ? old ?? null : v === null || v === '' ? null : num(v, label);
    items = raw.map((e, k) => { const it = aligned ? items[k] || {} : {}; const date = e.date ? dateStr(e.date, `${k + 1}번째 품목 월일`) : it.date || writeDate;
      if (String(date).slice(0, 7) !== month) throw bad(`${k + 1}번째 품목 월일(${date})은 작성일자와 같은 달이어야 합니다.`);
      const supply = e.supply === undefined ? Number(it.supply ?? 0) : Number(e.supply), vat = e.vat === undefined ? Number(it.vat ?? 0) : Number(e.vat ?? 0);
      if (!Number.isInteger(supply) || !Number.isInteger(vat)) throw bad(`${k + 1}번째 품목: 공급가액·세액은 원 단위 정수로 넣으세요.`);
      return { ...it, date, item: reqStr(e.item, `${k + 1}번째 품목`, 200), spec: e.spec === undefined ? it.spec ?? '' : str(e.spec, 100), note: e.note === undefined ? it.note ?? '' : str(e.note, 200),
        qty: optNum(e.qty, it.qty, `${k + 1}번째 수량`), unit_price: optNum(e.unit_price, it.unit_price, `${k + 1}번째 단가`), supply, vat }; });
    const ss = items.reduce((t, i) => t + i.supply, 0), vs = items.reduce((t, i) => t + i.vat, 0);
    if (ss !== Number(inv.supply_total) || vs !== Number(inv.vat_total)) throw bad(`품목 줄 합계(공급가액 ${won0(ss)} · 세액 ${won0(vs)})가 계산서 합계(공급가액 ${won0(inv.supply_total)} · 세액 ${won0(inv.vat_total)})와 다릅니다. 금액을 맞추거나, 전표 금액이 다르면 매출전표를 먼저 고치세요.`);
    set.items = JSON.stringify(items); set.item_summary = itemLabel(items[0]?.item, items.length);
  } else if (writeDate !== inv.write_date) {
    // 작성일자를 바꾸면 품목 월일도 함께(다른 달 날짜는 작성일자로)
    items = items.map(it => ({ ...it, date: inv.kind === 'single' || String(it.date || '').slice(0, 7) !== month ? writeDate : it.date })); set.items = JSON.stringify(items);
  }
  const keys = Object.keys(set);
  // 15.169 읽은 상태·버전 그대로일 때만(그 사이 발행 기록·다른 수정이면 덮지 않음) · 발행 뒤 역발행 고치기는 이력
  const changedKeys = keys.filter(k => String(set[k] ?? '') !== String(inv[k] ?? ''));
  const r = await db.prepare(`UPDATE tax_invoices SET ${keys.map(k => `${k}=?`).join(',')},updated_by=?,updated_at=? WHERE id=? AND status=? AND COALESCE(updated_at,'')=? AND (status IN ('draft','failed') OR (issue_type='reverse' AND status<>'cancelled'))`).run(...keys.map(k => set[k]), user.name, now(), inv.id, inv.status, inv.updated_at || '');
  if (r.changes && !pending && changedKeys.length) await db.prepare('INSERT INTO doc_changes(doc_type,doc_id,summary,changed_by) VALUES(?,?,?,?)').run('tax_invoice', inv.id, `발행 뒤 역발행 고침: ${changedKeys.map(k => ({ write_date: '작성일자', approval_no: '승인번호', items: '품목 줄', item_summary: '', note: '비고', biz_no: '사업자번호', biz_name: '상호', email1: '이메일', email2: '이메일', charge: '영수/청구', doc_type: '문서 구분' })[k] ?? k).filter(Boolean).join('·')}`.slice(0, 500), user.name);
  if (!r.changes) throw new HttpError(409, '그 사이 발행이 요청되었습니다. 새로 불러오세요.');
  return invoiceDetail(await mustGet('tax_invoices', inv.id));
});
// 담기 취소(발행 전·실패만): 전표는 다시 담을 수 있게 풀린다.
route('POST', '/api/tax-invoices/:id/cancel', async ({ user, params, body }) => {
  requireSales(user);
  const inv = await mustGet('tax_invoices', params.id);
  if (!['draft', 'failed'].includes(inv.status)) throw bad('발행을 요청한 계산서는 담기 취소할 수 없습니다(발행 취소·수정세금계산서로 처리).');
  const results = await db.batch([
    { sql: "UPDATE tax_invoice_bills SET active=0 WHERE invoice_id=? AND EXISTS(SELECT 1 FROM tax_invoices WHERE id=? AND status IN ('draft','failed'))", args: [inv.id, inv.id] },
    { sql: "UPDATE tax_invoices SET status='cancelled',cancelled_at=?,cancelled_by=?,cancel_reason=? WHERE id=? AND status IN ('draft','failed')", args: [now(), user.name, str(body.reason, 200) || '담기 취소', inv.id] },
  ]);
  if (!results.at(-1).meta.changes) throw new HttpError(409, '그 사이 발행이 요청되었습니다. 새로 불러오세요.');
  return { ok: true };
});
// 발행 전 점검: 우리 회사·받는 쪽 사업자 정보와 이메일
function invoiceProblems(inv, company) {
  const p = [];
  if (bizNo(company.biz_no).length !== 10 || !company.biz_name || !company.ceo) p.push('우리 회사 사업자 정보(사업자번호·상호·대표자)');
  if (bizNo(inv.biz_no).length !== 10) p.push('거래처 사업자번호');
  if (!inv.biz_name || !inv.ceo) p.push('거래처 상호·대표자');
  if (!emailOk(inv.email1)) p.push('받는 이메일 1');
  if (inv.email2 && !emailOk(inv.email2)) p.push('받는 이메일 2');
  if (!(inv.total > 0) && inv.kind) p.push('금액(0 이하 — 반입 금액은 월별 계산서에 합치거나 수정 계산서로 직접 발행 기록)');
  return p;
}
// 15.138 상태 바꾸기(기존 ERP의 「상태조회」 대신, 트러스빌 연동 전에는 손으로): 상대방 수신 확인·거부·미확인, 국세청 전송·미전송, 정발행·역발행.
const TAX_STATE_ACTIONS = {
  recv_confirm: { label: '수신 확인', sql: "recv_status='confirmed',recv_at=?,recv_by=?", args: u => [now(), u.name], when: "status IN ('issued','sent')", need: '발행된 계산서만 수신 확인할 수 있습니다' },
  recv_reject: { label: '수신 거부', sql: "recv_status='rejected',recv_at=?,recv_by=?", args: u => [now(), u.name], when: "status IN ('issued','sent')", need: '발행된 계산서만 수신 거부로 표시할 수 있습니다' },
  recv_reset: { label: '수신자 미확인', sql: "recv_status='',recv_at=NULL,recv_by=NULL", args: () => [], when: "status IN ('issued','sent')", need: '발행된 계산서만 바꿀 수 있습니다' },
  nts_sent: { label: '국세청 전송', sql: "status='sent'", args: () => [], when: "status='issued'", need: '발행 완료(국세청 미전송) 계산서만 전송으로 표시할 수 있습니다' },
  nts_unsent: { label: '국세청 미전송', sql: "status='issued'", args: () => [], when: "status='sent'", need: '국세청 전송 계산서만 미전송으로 되돌릴 수 있습니다' },
  reverse: { label: '역발행', sql: "issue_type='reverse'", args: () => [], when: "status<>'cancelled'", need: '담기 취소한 계산서는 바꿀 수 없습니다' },
  normal: { label: '정발행', sql: "issue_type='normal'", args: () => [], when: "status<>'cancelled'", need: '담기 취소한 계산서는 바꿀 수 없습니다' },
};
route('POST', '/api/tax-invoices/state', async ({ user, body }) => {
  requireSales(user);
  const a = TAX_STATE_ACTIONS[body.action]; if (!a) throw bad('바꿀 상태를 고르세요.');
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number))] : [];
  if (!ids.length || ids.length > 200 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('계산서를 1~200장 고르세요.');
  const bad1 = [];
  for (const id of ids) { const inv = await mustGet('tax_invoices', id); if (!(await db.prepare(`SELECT 1 FROM tax_invoices WHERE id=? AND ${a.when}`).get(id))) bad1.push(`${inv.invoice_no} ${inv.customer}`); }
  if (bad1.length) throw bad(`${a.need}: ${bad1.slice(0, 5).join(', ')}${bad1.length > 5 ? ` 외 ${bad1.length - 5}장` : ''}`);
  await db.batch(ids.map(id => ({ sql: `UPDATE tax_invoices SET ${a.sql},updated_by=?,updated_at=? WHERE id=? AND ${a.when}`, args: [...a.args(user), user.name, now(), id] })));
  return { changed: ids.length, label: a.label };
});
route('POST', '/api/tax-invoices/issue', async ({ user, body }) => {
  requireSales(user);
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number))] : [];
  if (!ids.length || ids.length > 100) throw bad('발행할 계산서를 1~100장 고르세요.');
  const company = await companyInfo(), problems = [];
  for (const id of ids) {
    const inv = await mustGet('tax_invoices', id);
    if (!['draft', 'failed'].includes(inv.status)) { problems.push(`${inv.invoice_no} ${inv.customer}: 이미 발행을 요청한 계산서`); continue; }
    if (inv.issue_type === 'reverse') { problems.push(`${inv.invoice_no} ${inv.customer}: 역발행 계산서(거래처가 발행 요청 → 승인하면 「역발행 승인 기록」으로 기록)`); continue; }
    const p = invoiceProblems(inv, company); if (p.length) problems.push(`${inv.invoice_no} ${inv.customer}: ${p.join(', ')} 확인`);
  }
  if (problems.length) throw bad(`발행 전에 고칠 것이 있습니다.\n${problems.slice(0, 10).join('\n')}${problems.length > 10 ? `\n외 ${problems.length - 10}건` : ''}`);
  // 트러스빌 ERP 연동(Agent)이 연결되면 여기서 queued로 넘기고 Agent가 발행·결과를 돌려준다.
  if (!(await getSetting('tax_link'))) throw new HttpError(409, '트러스빌 연동이 아직 연결되지 않아 발행할 수 없습니다. 금융결제원에서 ERP 연동 매뉴얼을 받아 연결한 뒤 발행됩니다. 계산서는 담긴 그대로 남아 있습니다.');
  const results = await db.batch(ids.map(id => ({ sql: "UPDATE tax_invoices SET status='queued',status_message='',updated_by=?,updated_at=? WHERE id=? AND status IN ('draft','failed')", args: [user.name, now(), id] })));
  return { queued: results.reduce((t, r) => t + r.meta.changes, 0) };
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
  const m = await inspectionSpecMatch(f.category, f.data.item_category || '', f.title, f.data.product_code);
  return m.exact.length === 1 ? m.exact[0].snapshot : '';
}
// 15.174 의뢰 ↔ 검사규격 찾기. exact: 품명·제품코드가 규격 품명·별칭과 같음(공백·대소문자 무시),
// partial: 서로 포함(3자 이상) — 추천으로만 보여 주고 자동 연결하지 않는다. 의뢰에 품목 카테고리가 있으면 같은 카테고리만.
async function inspectionSpecMatch(kind, category, title, code) {
  if (!['수입검사','출하검사'].includes(kind)) return { exact: [], partial: [] };
  const specs = await db.prepare('SELECT s.*, (SELECT GROUP_CONCAT(name_key, char(31)) FROM inspection_spec_keys k WHERE k.spec_id=s.id) keys FROM inspection_specs s WHERE s.active=1 AND s.kind=?').all(kind);
  const loose = k => String(k || '').toLowerCase().replace(/[\s\-_.,·()[\]{}\/]/g, ''); // 하이픈·괄호·점·공백 무시(NX-707 = nx 707)
  const want = [...new Set([loose(title), loose(code)].filter(Boolean))], exact = [], partial = [];
  for (const sp of specs) {
    if (category && sp.item_category !== category) continue;
    const keys = [...new Set(String(sp.keys || '').split('\u001f').map(loose).filter(Boolean))];
    const def = JSON.parse(sp.definition), row = { id: sp.id, product: def.product, item_category: sp.item_category, revision: sp.revision, items: def.items.map(i => i.name), snapshot: JSON.stringify({ ...def, id: sp.id, revision: sp.revision }) };
    if (keys.some(k => want.includes(k))) exact.push(row);
    else if (keys.some(k => want.some(w => (k.length >= 3 && w.includes(k)) || (w.length >= 3 && k.includes(w))))) partial.push(row);
  }
  return { exact, partial };
}
const specBrief = ({ snapshot, ...r }) => r;
route('GET','/api/inspection-specs/match',async ({query}) => { const m = await inspectionSpecMatch(query.kind, query.item_category || '', query.title, query.code); return { exact: m.exact.map(specBrief), partial: m.partial.map(specBrief) }; });
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
  let r=await inspectionRequest(params.id), suggest=null;
  if(!r.inspection_snapshot){
    const d=JSON.parse(r.data||'{}'), m=await inspectionSpecMatch(r.category,d.item_category||'',r.title,d.product_code);
    if(m.exact.length===1&&r.status!=='done'){
      await db.prepare("UPDATE requests SET inspection_snapshot=? WHERE id=? AND inspection_snapshot=''").run(m.exact[0].snapshot,r.id);
      r=await inspectionRequest(params.id);
    } else suggest={exact:m.exact.map(specBrief),partial:m.partial.map(specBrief)};
  }
  return { suggest, request:decodeRequest(r), spec:r.inspection_snapshot?JSON.parse(r.inspection_snapshot):null, measurement:decodeInspection(await db.prepare('SELECT * FROM inspection_measurements WHERE request_id=?').get(r.id)), can_manage:!isOperator(user)&&hasRole(user,'quality_approver'),can_write:!isOperator(user)&&hasRole(user,'quality')&&WORK_STATUSES.includes(r.status),history:await db.prepare('SELECT id,revision,result,reason,saved_by,saved_at FROM inspection_measurement_history WHERE request_id=? ORDER BY id DESC LIMIT 50').all(r.id) };
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
  if(query.result){if(!['pending','pass','fail','unconfigured','exempt'].includes(query.result)) throw bad('판정을 확인하세요.');where.push("CASE WHEN json_extract(r.data,'$.exempt')=1 THEN 'exempt' WHEN r.inspection_snapshot='' THEN 'unconfigured' ELSE COALESCE(m.result,'pending') END=?");args.push(query.result);}
  applyListDates(where,args,query,'substr(r.created_at,1,10)');
  applyListKeyword(where,args,query.q,['r.title','r.req_no','r.lot','r.customer',"json_extract(r.data,'$.product_code')","json_extract(NULLIF(r.inspection_snapshot,''),'$.aliases')"]);
  if(query.before){if(!/^[1-9]\d*$/.test(query.before)) throw bad('조회 위치를 확인하세요.');where.push('r.id<?');args.push(Number(query.before));}
  const rows=await db.prepare(`SELECT r.id,r.req_no,r.title,r.category,r.status,r.customer,r.lot,r.created_at,${category} AS item_category,CASE WHEN json_extract(r.data,'$.exempt')=1 THEN 'exempt' WHEN r.inspection_snapshot='' THEN 'unconfigured' ELSE COALESCE(m.result,'pending') END AS result,m.updated_by,m.updated_at FROM requests r LEFT JOIN inspection_measurements m ON m.request_id=r.id WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT 101`).all(...args);
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
  if (type === 'rnd_analysis') { f.category = str(b.category, 20); if (!RND_CATEGORIES.includes(f.category)) throw bad('분석 구분을 선택하세요.'); if (data.item_category) f.data.item_category = itemCategory(data.item_category); } // 15.285
  return f;
}
// 15.286 연구 분석(rnd_analysis) ↔ 진행 중 개발건(development) · 로드맵 단계(공정 이름) 연결. data.dev_request_id·dev_step·dev_title에 둔다.
async function rndDevLink(data) {
  const raw = data.dev_request_id;
  if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === '0') { delete data.dev_request_id; delete data.dev_step; delete data.dev_title; return null; }
  if (!/^[1-9]\d*$/.test(String(raw))) throw bad('연결할 개발건을 다시 고르세요.');
  const dev = await db.prepare("SELECT id, req_no, title, status FROM requests WHERE id=? AND type='development' AND status NOT IN ('rejected')").get(Number(raw));
  if (!dev) throw bad('연결할 개발건을 찾을 수 없습니다(개발 의뢰만 연결할 수 있습니다).');
  data.dev_request_id = dev.id; data.dev_step = str(data.dev_step, 100); data.dev_title = dev.title;
  return dev;
}
const rndDevNote = (user, devId, text) => ({ sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: ['request', devId, ('[분석] ' + text).slice(0, 2000), user.id, user.name] });
function decodeRequest(r) { return { ...r, data: JSON.parse(r.data || '{}') }; }
async function getRequest(id) { const r = (await db.prepare('SELECT * FROM requests WHERE id=?').get(id)); if (!r) throw new HttpError(404, '의뢰를 찾을 수 없습니다.'); return r; }
function roleLabel(type) { return { voc: '품질', analysis: '품질', development: '연구소', sample: '생산', sample_goods: '구매', rnd_analysis: '연구소' }[type]; }

// 15.276 개발 스케줄 관리(로드맵): 개발 의뢰 + 계획(구분·기간·진행률·현재·다음) + 공정표
const DEV_TERMS = ['', 'short', 'mid', 'long'], DEV_STEP = ['todo', 'doing', 'done'];
route('GET', '/api/dev-roadmap', async ({ query }) => {
  const where = ["r.type='development'"], args = [];
  // 15.277 id 하나만(개발리스트 더블클릭 팝업): 상태와 상관없이
  if (query.id) { if (!/^[1-9]\d*$/.test(String(query.id))) throw bad('항목 번호가 올바르지 않습니다.'); where.push('r.id=?'); args.push(Number(query.id)); }
  else { where.push("r.status NOT IN ('rejected','pending')"); if (query.done !== '1') where.push("r.status<>'done'"); } // 15.285 접수대기는 스케줄에 안 나옴
  const rows = await db.prepare(`SELECT r.id, r.req_no, r.title, r.customer, r.status, r.due_date, r.target_price, r.requester_name, r.created_at, p.term, p.start_date, p.target_date, p.progress, p.current_stage, p.next_step, p.next_date, p.note, p.updated_by, p.updated_at,
      p.dev_owner_id, COALESCE(p.dev_owner_name,'') AS dev_owner_name, p.sales_owner_id, COALESCE(p.sales_owner_name,'') AS sales_owner_name,
      (SELECT COUNT(*) FROM progress_comments c WHERE c.entity_type='request' AND c.entity_id=r.id AND c.content<>'(삭제됨)') AS comment_count,
      (SELECT c.author_name || ' · ' || substr(c.created_at,6,11) || ' · ' || substr(c.content,1,80) FROM progress_comments c WHERE c.entity_type='request' AND c.entity_id=r.id AND c.content<>'(삭제됨)' ORDER BY c.id DESC LIMIT 1) AS last_comment
    FROM requests r LEFT JOIN dev_plans p ON p.request_id=r.id WHERE ${where.join(' AND ')} ORDER BY COALESCE(NULLIF(p.target_date,''), r.due_date, '9999') , r.id LIMIT 500`).all(...args);
  const steps = new Map(); for (const st of await db.prepare(`SELECT * FROM dev_plan_steps ${query.id ? 'WHERE request_id=? ' : ''}ORDER BY request_id, sort, id`).all(...(query.id ? [Number(query.id)] : []))) { if (!steps.has(st.request_id)) steps.set(st.request_id, []); steps.get(st.request_id).push(st); }
  const ana = new Map(); // 15.286 연결된 연구 분석(단계·결과)
  for (const a of await db.prepare(`SELECT id, req_no, title, category, status, result_note, requester_name, created_at, updated_at, CAST(json_extract(data,'$.dev_request_id') AS INTEGER) AS dev_id, COALESCE(json_extract(data,'$.dev_step'),'') AS dev_step, COALESCE(json_extract(data,'$.analysis_date'),'') AS analysis_date, (SELECT m.result FROM inspection_measurements m WHERE m.request_id=requests.id) AS judge, inspection_snapshot AS snap, (SELECT m.values_json FROM inspection_measurements m WHERE m.request_id=requests.id) AS mvals, COALESCE(json_extract(data,'$.memo'),'') AS memo FROM requests WHERE type='rnd_analysis' AND status<>'rejected' AND json_extract(data,'$.dev_request_id') IS NOT NULL ${query.id ? "AND json_extract(data,'$.dev_request_id')=?" : ''} ORDER BY id`).all(...(query.id ? [Number(query.id)] : []))) { const short = rndShort(a.snap, a.mvals, a.memo); if (short) a.result_note = short; delete a.snap; delete a.mvals; delete a.memo; if (!ana.has(a.dev_id)) ana.set(a.dev_id, []); ana.get(a.dev_id).push(a); } // 15.299 짧은 요약
  return { rows: rows.map(r => ({ ...r, term: r.term || '', progress: r.progress || 0, steps: steps.get(r.id) || [], analyses: ana.get(r.id) || [] })) };
});
// 15.277 담당자(개발·영업): 개발 담당·개발 승인권자·영업·관리자가 지정. 바뀌면 소통 내역에 [담당자] 한 줄을 같이 남김.
route('PUT', '/api/dev-roadmap/:id/owners', async ({ user, params, body }) => {
  if (!hasRole(user, 'dev') && !hasRole(user, 'dev_approver') && !hasRole(user, 'sales')) throw new HttpError(403, '담당자는 개발·영업 담당자가 지정합니다.');
  const r = await mustGet('requests', params.id); if (r.type !== 'development') throw bad('개발 의뢰가 아닙니다.');
  const pick = async (v, label) => { if (v === '' || v == null || v === 0 || v === '0') return null; if (!/^[1-9]\d*$/.test(String(v))) throw bad(`${label}을(를) 다시 고르세요.`); const u = await db.prepare("SELECT id,name FROM users WHERE id=? AND approval_status='approved'").get(Number(v)); if (!u) throw bad(`${label}을(를) 찾을 수 없습니다.`); return u; };
  const dev = await pick(body.dev_owner_id, '개발 담당자'), sales = await pick(body.sales_owner_id, '영업 담당자');
  const prev = await db.prepare('SELECT dev_owner_name, sales_owner_name FROM dev_plans WHERE request_id=?').get(r.id) || { dev_owner_name: '', sales_owner_name: '' };
  const changes = [];
  if ((prev.dev_owner_name || '') !== (dev?.name || '')) changes.push(`개발 ${prev.dev_owner_name || '없음'} → ${dev?.name || '없음'}`);
  if ((prev.sales_owner_name || '') !== (sales?.name || '')) changes.push(`영업 ${prev.sales_owner_name || '없음'} → ${sales?.name || '없음'}`);
  if (!changes.length) return { ok: true, changed: false };
  await db.batch([
    { sql: `INSERT INTO dev_plans(request_id,dev_owner_id,dev_owner_name,sales_owner_id,sales_owner_name,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(request_id) DO UPDATE SET dev_owner_id=excluded.dev_owner_id,dev_owner_name=excluded.dev_owner_name,sales_owner_id=excluded.sales_owner_id,sales_owner_name=excluded.sales_owner_name`,
      args: [r.id, dev?.id ?? null, dev?.name || '', sales?.id ?? null, sales?.name || '', user.name, now()] },
    { sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: ['request', r.id, `[담당자] ${changes.join(' · ')}`, user.id, user.name] }]);
  return { ok: true, changed: true };
});
route('PUT', '/api/dev-roadmap/:id', async ({ user, params, body }) => {
  if (!hasRole(user, 'dev') && !hasRole(user, 'dev_approver')) throw new HttpError(403, '개발 스케줄은 개발 담당자가 고칩니다.');
  const r = await mustGet('requests', params.id); if (r.type !== 'development') throw bad('개발 의뢰가 아닙니다.');
  const d = (v, label) => v === '' || v == null ? '' : dateStr(v, label);
  const term = DEV_TERMS.includes(body.term) ? body.term : bad('구분을 다시 고르세요.'); if (term instanceof Error) throw term;
  const start = d(body.start_date, '시작일'), target = d(body.target_date, '완료예정일'), next = d(body.next_date, '다음 예정일');
  if (start && target && target < start) throw bad('완료예정일은 시작일 이후여야 합니다.');
  const progress = Math.round(Number(body.progress) || 0); if (progress < 0 || progress > 100) throw bad('진행률은 0~100입니다.');
  const steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 40).map((x, i) => { const name = str(x?.name, 100); if (!name) return null; const s1 = d(x.start_date, `공정 ${i + 1} 시작일`), s2 = d(x.end_date, `공정 ${i + 1} 종료일`); if (s1 && s2 && s2 < s1) throw bad(`공정 「${name}」 종료일이 시작일보다 빠릅니다.`); return { name, start_date: s1, end_date: s2, status: DEV_STEP.includes(x.status) ? x.status : 'todo', note: str(x.note, 200), sort: i }; }).filter(Boolean);
  await db.batch([
    { sql: `INSERT INTO dev_plans(request_id,term,start_date,target_date,progress,current_stage,next_step,next_date,note,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(request_id) DO UPDATE SET term=excluded.term,start_date=excluded.start_date,target_date=excluded.target_date,progress=excluded.progress,current_stage=excluded.current_stage,next_step=excluded.next_step,next_date=excluded.next_date,note=excluded.note,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      args: [r.id, term, start, target, progress, str(body.current_stage, 300), str(body.next_step, 300), next, str(body.note, 500), user.name, now()] },
    { sql: 'DELETE FROM dev_plan_steps WHERE request_id=?', args: [r.id] },
    ...steps.map(x => ({ sql: 'INSERT INTO dev_plan_steps(request_id,name,start_date,end_date,status,note,sort) VALUES(?,?,?,?,?,?,?)', args: [r.id, x.name, x.start_date, x.end_date, x.status, x.note, x.sort] }))]);
  return { ok: true };
});
route('GET', '/api/requests', async ({ query }) => {
  const type = String(query.type || ''); if (!Object.hasOwn(REQUEST_TYPES, type)) throw bad('의뢰 종류가 올바르지 않습니다.');
  const where = ['type=?']; const args = [type];
  if (query.scope && !['intake','list'].includes(query.scope)) throw bad('의뢰 목록 구분을 확인하세요.');
  if (query.scope === 'intake') where.push("status IN ('pending','rejected')");
  else if (query.scope === 'list') where.push("status IN ('waiting','progress','done')");
  if (query.status) { if (!['pending','rejected','waiting','progress','done'].includes(query.status)) throw bad('의뢰 상태를 확인하세요.'); where.push('status=?'); args.push(query.status); }
  if (query.category) { if (!(type === 'analysis' ? ANALYSIS_CATEGORIES : type === 'rnd_analysis' ? RND_CATEGORIES : []).includes(query.category)) throw bad('검사 구분을 확인하세요.'); where.push('category=?'); args.push(query.category); }
  applyListDates(where, args, query, 'substr(created_at,1,10)');
  applyListKeyword(where, args, query.q, ['req_no','title','spec','lot','customer','requester_name','result_note',"json_extract(data,'$.extra')", "json_extract(data,'$.purpose')", "json_extract(data,'$.lot_etc')", "json_extract(data,'$.lot')"]);
  // 15.78 수입·출하 검사 판정(측정값이 저장된 경우 pass/fail/pending)을 목록에 함께 준다.
  return (await db.prepare(`SELECT requests.*, (SELECT m.result FROM inspection_measurements m WHERE m.request_id=requests.id) AS inspection_result${type === 'development' ? `, (SELECT dev_owner_name FROM dev_plans WHERE request_id=requests.id) AS dev_owner_name, (SELECT sales_owner_name FROM dev_plans WHERE request_id=requests.id) AS sales_owner_name, (SELECT COUNT(*) FROM progress_comments c WHERE c.entity_type='request' AND c.entity_id=requests.id AND c.content<>'(삭제됨)') AS comment_count` : ''} FROM requests WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'progress' THEN 1 WHEN 'waiting' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END, id DESC`).all(...args)).map(decodeRequest);
});
route('POST', '/api/requests', async ({ user, body }) => {
  const type = String(body.type || ''); if (!Object.hasOwn(REQUEST_TYPES, type)) throw bad('의뢰 종류가 올바르지 않습니다.');
  if (type === 'rnd_analysis' && !isResearcher(user)) throw new HttpError(403, '연구 분석데이터는 연구원(개발·개발책임자)만 입력합니다.'); // 15.288
  const f = requestFields(type, body);
  const dev = type === 'rnd_analysis' ? await rndDevLink(f.data) : null; // 15.286
  const r = (await db.prepare('INSERT INTO requests(type,title,customer,due_date,category,target_price,data,requester_id,requester_name,inspection_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(type, f.title, f.customer, f.due_date, f.category, f.target_price, JSON.stringify(f.data), user.id, user.name, type==='analysis'?await inspectionSnapshot(f):''));
  if (dev) { const c = rndDevNote(user, dev.id, `분석의뢰 등록 · ${f.title} (${f.category})${f.data.dev_step ? ` · 단계 「${f.data.dev_step}」` : ''}`); await db.prepare(c.sql).run(...c.args); }
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
    lot: (r.source_type ? undefined : body.lot ?? (analysisLike(r.type) ? body.data?.lot_etc : body.data?.lot)) ?? (r.lot || priorData.lot_etc || (r.type === 'voc' ? priorData.lot : '') || '') }, r);
  let lineQty = r.qty;
  if (!r.source_type && (r.qty !== null || r.type === 'voc')) {
    const supplied = analysisLike(r.type) ? f.data.sample_qty : ['sample', 'sample_goods'].includes(r.type) ? f.data.req_qty : f.data.qty;
    if (supplied !== undefined && supplied !== '') { lineQty = num(supplied,'품목 수량'); if (lineQty <= 0) throw bad('품목 수량은 0보다 커야 합니다.'); }
    if (lineQty !== null) f.data.qty = lineQty;
  }
  f.data.spec = meta.spec; f.data.unit = meta.unit;
  if (r.type === 'rnd_analysis') { if (f.data.dev_request_id === undefined) for (const k of ['dev_request_id', 'dev_step', 'dev_title']) { if (priorData[k] !== undefined) f.data[k] = priorData[k]; } else await rndDevLink(f.data); } // 15.286
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
  if (r.type === 'analysis' && await inspectExempt(r)) await db.prepare("UPDATE requests SET status='done',data=json_set(data,'$.exempt',1),updated_at=datetime('now','+9 hours') WHERE id=? AND status='waiting'").run(r.id); // 15.207
  return decodeRequest((await getRequest(r.id)));
});
// 15.207 수입·출하검사 의뢰의 품목이 제품등록에서 그 검사 「제외」로 체크돼 있는가(bom_id·제품코드·품목명으로 찾음)
async function inspectExempt(r) {
  const col = r.category === '수입검사' ? 'skip_incoming' : r.category === '출하검사' ? 'skip_outgoing' : ''; if (!col) return false;
  let d = {}; try { d = typeof r.data === 'string' ? JSON.parse(r.data || '{}') : r.data || {}; } catch { d = {}; }
  const code = String(d.product_code || '').trim(), id = Number(d.bom_id) || 0;
  return !!(await db.prepare(`SELECT 1 FROM boms WHERE ${col}=1 AND (id=? OR (?<>'' AND UPPER(product_code)=UPPER(?)) OR REPLACE(LOWER(product),' ','')=?) LIMIT 1`).get(id, code, code, nameKey(r.title)));
}
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
  const note = body.result_note !== undefined ? str(body.result_note, 1000) : r.result_note;
  const cmds = [{ sql: "UPDATE requests SET status=?, result_note=?, updated_at=datetime('now','+9 hours') WHERE id=?", args: [status, note, r.id] }];
  // 15.286 연구 분석 결과 이력: 결과·상태가 바뀌면 분석 자체와 연결된 개발건 소통에 한 줄씩(덮어써도 이력이 남음)
  if (r.type === 'rnd_analysis' && (note !== (r.result_note || '') || status !== r.status)) {
    const d = JSON.parse(r.data || '{}'), line = `${r.req_no || r.title} ${r.title} · ${STATUS_LABEL[status] || status}${note ? ` · 결과: ${note}` : ''}`;
    cmds.push({ sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: ['request', r.id, `[분석결과] ${STATUS_LABEL[status] || status}${note ? ' · ' + note : ''}`.slice(0, 2000), user.id, user.name] });
    if (d.dev_request_id) cmds.push(rndDevNote(user, d.dev_request_id, `${line}${d.dev_step ? ` · 단계 「${d.dev_step}」` : ''}`));
  }
  await db.batch(cmds);
  return decodeRequest((await getRequest(r.id)));
});
// 15.287·15.288 분석데이터 직접 입력(연구원만): 승인 없이 완료된 연구 분석(RA-분석일 번호)으로 저장. 개발건·단계는 골랐을 때만 연결하고 이력을 남긴다.
// 15.292 연구 분석 측정값: 검사규격 형식(항목·단위·하한·상한·측정 횟수) + 측정값 → 항목별 평균·판정, 전체 판정. 하한·상한이 없으면 판정 없이 기록만.
function rndMeasure(itemsIn, valuesIn, samplesIn) { // 15.293 samplesIn: [{lot, values}] 시료 여러 개
  if (!Array.isArray(itemsIn) || !itemsIn.length) return null;
  if (itemsIn.length > 30) throw bad('측정 항목은 30개까지입니다.');
  const num = (v, label) => { if (v === '' || v == null) return null; if (!['string', 'number'].includes(typeof v) || !Number.isFinite(Number(v))) throw bad(`${label}은(는) 숫자로 입력하세요.`); return Number(v); };
  const items = itemsIn.map((it, i) => { const o = it && typeof it === 'object' ? it : {}; const min = num(o.min, '하한'), max = num(o.max, '상한'), count = Number(o.count) || 1;
    if (min !== null && max !== null && min > max) throw bad(`${o.name || i + 1}: 하한이 상한보다 큽니다.`); if (!Number.isInteger(count) || count < 1 || count > 10) throw bad('측정 횟수는 1~10회입니다.');
    return { key: 'i' + i, name: reqStr(o.name, `${i + 1}번째 측정 항목`, 100), unit: str(o.unit, 30), min, max, count }; });
  const srcs = Array.isArray(samplesIn) && samplesIn.length ? samplesIn : [{ lot: '', values: valuesIn }];
  if (srcs.length > 20) throw bad('시료는 20개까지입니다.');
  let filled = 0, missing = false, failed = false; const summary = [], fails = []; let judgedN = 0, passN = 0;
  const rows = srcs.map((src, n) => { const vals = src && typeof src.values === 'object' && src.values ? src.values : {}, values = {};
    for (const it of items) { const list = (Array.isArray(vals[it.key]) ? vals[it.key] : []).slice(0, it.count); while (list.length < it.count) list.push(null); values[it.key] = list.map(v => num(v, `${it.name} 측정값`)); }
    return { lot: str(src?.lot, 100) || (srcs.length > 1 ? `시료 ${n + 1}` : ''), values }; });
  for (const it of items) {
    const got = rows.flatMap(r => r.values[it.key].filter(v => v !== null)); filled += got.length; if (rows.some(r => r.values[it.key].some(v => v === null))) missing = true;
    const bad1 = got.some(v => (it.min !== null && v < it.min) || (it.max !== null && v > it.max)); if (bad1) failed = true;
    const avg = got.length ? Math.round(got.reduce((t, v) => t + v, 0) / got.length * 1000) / 1000 : null;
    const spec = it.min !== null && it.max !== null ? `${it.min}~${it.max}` : it.min !== null ? `≥${it.min}` : it.max !== null ? `≤${it.max}` : '';
    if (avg !== null) summary.push(`${it.name} ${got.length > 1 ? '평균 ' : ''}${avg}${it.unit ? ' ' + it.unit : ''}${spec ? ` (${spec}) ${bad1 ? '불합격' : '합격'}` : ''}`);
    // 15.299 요약은 불합격 항목만(어느 시료인지 함께), 불합격이 없으면 「전 항목 합격」
    if (spec && got.length) { judgedN++; if (!bad1) passN++; }
    if (bad1) { const out = v => v !== null && ((it.min !== null && v < it.min) || (it.max !== null && v > it.max)); const who = rows.length > 1 ? rows.filter(r => r.values[it.key].some(out)).map(r => r.lot) : [];
      fails.push(`${it.name} ${got.length > 1 ? '평균 ' : ''}${avg}${it.unit ? ' ' + it.unit : ''} (${spec})${who.length ? ` [${who.join(', ')}]` : ''}`); }
  }
  if (!filled) throw bad('측정값을 하나 이상 넣으세요.');
  const judged = items.some(it => it.min !== null || it.max !== null);
  const result = failed ? 'fail' : missing ? 'pending' : 'pass';
  const head = rows.length > 1 ? `시료 ${rows.length}개 · ` : '';
  const short = !judged ? `규격 없이 기록 · ${summary.join(' · ')}` : failed ? `불합격 ${fails.length}항목: ${fails.join(' · ')}` : missing ? `측정 중 · 합격 ${passN}/${items.filter(it => it.min !== null || it.max !== null).length}항목 (빈 칸 있음)` : `전 항목 합격 (${judgedN}항목)`;
  return { snapshot: { kind: '연구분석', items }, rows, result, judged, summary: head + short, detail: head + summary.join(' · ') };
}
const isResearcher = user => hasRole(user, 'dev') || hasRole(user, 'dev_approver');
async function createRndData(user, body, devId) {
  if (!isResearcher(user)) throw new HttpError(403, '분석데이터는 연구원(개발·개발책임자)만 입력합니다.');
  const meas = rndMeasure(body.spec_items, body.values, body.samples); // 15.292 측정값(검사규격 형식)
  const memo = str(body.result_note, 1000);
  if (!meas && !memo) throw bad('측정값을 넣거나 분석 결과를 적으세요.');
  const result = (meas ? meas.summary + (memo ? ` / 의견: ${memo}` : '') : memo).slice(0, 1000);
  const date = body.analysis_date ? dateStr(body.analysis_date, '분석일') : today();
  const items = (Array.isArray(body.items) ? body.items : []).map(x => str(x, 50)).filter(Boolean).slice(0, 30);
  const data = { items, sample_qty: str(body.sample_qty, 50), extra: str(body.note, 2000), analysis_date: date, entered_directly: 1, dev_request_id: devId ?? body.dev_request_id, dev_step: body.dev_step };
  const dev = await rndDevLink(data);
  const f = requestFields('rnd_analysis', { title: body.title, customer: dev ? (await getRequest(dev.id)).customer || '' : str(body.customer, 100), due_date: '', category: body.category, data });
  const token = 'ad:' + crypto.randomUUID(), ymd = date.slice(2).replace(/-/g, ''), prefix = `${REQUEST_PREFIX.rnd_analysis}-${ymd}-`;
  await db.batch([
    { sql: 'INSERT INTO requests(type,title,customer,due_date,category,target_price,data,requester_id,requester_name,status,result_note,approver_name,approved_at,req_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      args: ['rnd_analysis', f.title, f.customer, '', f.category, '', JSON.stringify({ ...f.data, memo, token }), user.id, user.name, 'done', result, user.name, now(), token] },
    { sql: "UPDATE requests SET req_no=? || printf('%02d', (SELECT COALESCE(MAX(CAST(substr(req_no, length(?) + 1) AS INTEGER)),0)+1 FROM requests WHERE req_no LIKE ?)) WHERE req_no=?", args: [prefix, prefix, prefix + '%', token] },
  ]);
  const row = await db.prepare("SELECT * FROM requests WHERE type='rnd_analysis' AND json_extract(data,'$.token')=?").get(token);
  row.data = JSON.stringify({ ...JSON.parse(row.data), token: undefined });
  const cmds = [{ sql: "UPDATE requests SET data=json_remove(data,'$.token') WHERE id=?", args: [row.id] },
    ...(meas ? [{ sql: 'UPDATE requests SET inspection_snapshot=? WHERE id=?', args: [JSON.stringify(meas.snapshot), row.id] },
      { sql: 'INSERT INTO inspection_measurements(request_id,values_json,result,save_token,updated_by) VALUES(?,?,?,?,?)', args: [row.id, JSON.stringify(meas.rows), meas.result, randomHex(16), user.name] },
      { sql: "INSERT INTO inspection_measurement_history(request_id,revision,values_json,result,reason,saved_by) VALUES(?,1,?,?,'분석데이터 입력',?)", args: [row.id, JSON.stringify(meas.rows), meas.result, user.name] }] : []),
    { sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: ['request', row.id, `[분석결과] 분석데이터 입력 · 분석일 ${date} · ${result}`.slice(0, 2000), user.id, user.name] }];
  if (dev) cmds.push(rndDevNote(user, dev.id, `분석데이터 · ${row.req_no} ${f.title} (${f.category})${data.dev_step ? ` · 단계 「${data.dev_step}」` : ''} · 분석일 ${date} · 결과: ${result}`));
  await db.batch(cmds);
  return decodeRequest(row);
}
// 15.295 연구소 검사규격(항목 세트): 연구원이 분석 종류별 측정 항목(이름·단위·하한·상한·횟수)을 미리 만들어 두고 분석데이터 입력에서 불러온다.
// settings 'rnd_spec_library' = {revision, specs:[{id,name,group,note,active,items,updated_by,updated_at}]} — 새 테이블·마이그레이션 없이, 동시 수정은 revision으로 막는다.
async function rndSpecLibrary() { const raw = await getSetting('rnd_spec_library'); return { raw, ...(raw ? JSON.parse(raw) : { revision: 0, specs: [] }) }; }
function rndSpecValidate(o) {
  const spec = o && typeof o === 'object' ? o : {};
  if (!Array.isArray(spec.items) || !spec.items.length) throw bad('측정 항목을 하나 이상 넣으세요.');
  if (spec.items.length > 30) throw bad('측정 항목은 30개까지입니다.');
  const num = (v, label) => { if (v === '' || v == null) return null; if (!['string', 'number'].includes(typeof v) || !Number.isFinite(Number(v))) throw bad(`${label}은(는) 숫자로 입력하세요.`); return Number(v); };
  const items = spec.items.map((it, i) => { const x = it && typeof it === 'object' ? it : {}; const name = reqStr(x.name, `${i + 1}번째 측정 항목`, 100), min = num(x.min, `${name} 하한`), max = num(x.max, `${name} 상한`), count = Number(x.count) || 1;
    if (min !== null && max !== null && min > max) throw bad(`${name}: 하한이 상한보다 큽니다.`); if (!Number.isInteger(count) || count < 1 || count > 10) throw bad(`${name}: 측정 횟수는 1~10회입니다.`);
    return { name, unit: str(x.unit, 30), min, max, count }; });
  const names = items.map(i => i.name.toLowerCase()); if (new Set(names).size !== names.length) throw bad('같은 이름의 측정 항목이 있습니다.');
  return { name: reqStr(spec.name, '규격 이름', 100), group: str(spec.group, 50), note: str(spec.note, 300), active: spec.active !== false, items };
}
async function rndSpecWrite(prior, specs) {
  const value = JSON.stringify({ revision: prior.revision + 1, specs });
  const changed = await db.prepare(`INSERT INTO settings(key,value) SELECT 'rnd_spec_library',? WHERE ?=0 OR EXISTS(SELECT 1 FROM settings WHERE key='rnd_spec_library' AND value=?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value=?`).run(value, prior.revision, prior.raw, prior.raw);
  if (!changed.changes) throw new HttpError(409, '다른 사람이 검사규격을 바꿨습니다. 다시 열어 주세요.');
  return JSON.parse(value);
}
// 15.302 연구소 지식재산권 관리: 보유 권리와 갱신(연차료·존속기간 갱신) 기한. 보기는 연구소 메뉴를 볼 수 있는 사람, 등록·수정·갱신·삭제는 연구원·관리자.
const IP_KINDS = ['특허', '실용신안', '디자인', '상표', '저작권', '반도체 배치설계', '영업비밀', '기타'];
const IP_STATUS = { prep: '출원 준비', filed: '출원중', exam: '심사중', registered: '등록완료', rejected: '거절(불허)', abandoned: '포기·취하', expired: '소멸(만료)' };
function ipBody(body) {
  const o = body && typeof body === 'object' ? body : {};
  if (!IP_KINDS.includes(o.kind)) throw bad('구분을 고르세요.');
  if (!Object.keys(IP_STATUS).includes(o.status)) throw bad('상태를 고르세요.');
  const d = (v, label) => v === '' || v == null ? null : dateStr(v, label);
  const f = { kind: o.kind, country: str(o.country, 30) || 'KR', title: reqStr(o.title, '지식재산권명', 200), reg_no: str(o.reg_no, 60), app_no: str(o.app_no, 60),
    app_date: d(o.app_date, '출원일'), reg_date: d(o.reg_date, '등록일'), expire_date: d(o.expire_date, '유효기간(만료일)'), next_due: d(o.next_due, '다음 기한'), due_kind: str(o.due_kind, 30),
    status: o.status, holder: str(o.holder, 100), owner_name: str(o.owner_name, 50), product: str(o.product, 200), agent: str(o.agent, 100), note: str(o.note, 1000) };
  if (f.app_date && f.reg_date && f.reg_date < f.app_date) throw bad('등록일이 출원일보다 빠릅니다.');
  if (f.reg_date && f.expire_date && f.expire_date < f.reg_date) throw bad('유효기간(만료일)이 등록일보다 빠릅니다.');
  if (f.status === 'registered' && !f.reg_no) throw bad('등록완료는 등록번호를 넣으세요.');
  return f;
}
const ipRow = r => ({ ...r, history: JSON.parse(r.history || '[]'), status_label: IP_STATUS[r.status] || r.status });
const requireIpManager = user => { if (!isResearcher(user)) throw new HttpError(403, '지식재산권은 연구원(개발·개발책임자)·관리자만 등록·수정합니다.'); };
const IP_COLS = ['kind', 'country', 'title', 'reg_no', 'app_no', 'app_date', 'reg_date', 'expire_date', 'next_due', 'due_kind', 'status', 'holder', 'owner_name', 'product', 'agent', 'note'];
route('GET', '/api/ip-rights', async ({ user }) => ({ rows: (await db.prepare('SELECT * FROM ip_rights ORDER BY CASE WHEN next_due IS NULL THEN 1 ELSE 0 END, next_due, id DESC LIMIT 2000').all()).map(ipRow), kinds: IP_KINDS, status: IP_STATUS, can_manage: isResearcher(user), today: today() }));
route('POST', '/api/ip-rights', async ({ user, body }) => {
  requireIpManager(user); const f = ipBody(body), key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM ip_rights WHERE request_id=?').get(key); if (old) return ipRow(old); }
  if (f.reg_no && await db.prepare('SELECT 1 FROM ip_rights WHERE kind=? AND country=? AND reg_no=?').get(f.kind, f.country, f.reg_no)) throw bad(`이미 등록된 ${f.kind} 등록번호입니다: ${f.reg_no}`);
  const r = await db.prepare(`INSERT INTO ip_rights(${IP_COLS.join(',')},history,request_id,created_by) VALUES(${IP_COLS.map(() => '?').join(',')},?,?,?)`).run(...IP_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '등록' }]), key, user.name);
  return ipRow(await mustGet('ip_rights', r.lastInsertRowid));
});
route('PUT', '/api/ip-rights/:id', async ({ user, params, body }) => {
  requireIpManager(user); const prior = await mustGet('ip_rights', params.id), f = ipBody(body);
  if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (f.reg_no && await db.prepare('SELECT 1 FROM ip_rights WHERE kind=? AND country=? AND reg_no=? AND id<>?').get(f.kind, f.country, f.reg_no, prior.id)) throw bad(`이미 등록된 ${f.kind} 등록번호입니다: ${f.reg_no}`);
  const changed = IP_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (!changed.length) return ipRow(prior);
  const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: '수정', fields: changed, ...(prior.status !== f.status ? { status: [prior.status, f.status] } : {}) }].slice(-100);
  const r = await db.prepare(`UPDATE ip_rights SET ${IP_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`).run(...IP_COLS.map(k => f[k]), JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!r.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return ipRow(await mustGet('ip_rights', prior.id));
});
// 갱신 처리: 연차료 납부·존속기간 갱신을 마쳤을 때 다음 기한(·만료일)을 넘기고 이력에 남긴다.
route('POST', '/api/ip-rights/:id/renew', async ({ user, params, body }) => {
  requireIpManager(user); const prior = await mustGet('ip_rights', params.id);
  if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (prior.status !== 'registered') throw bad('등록완료된 권리만 갱신 처리합니다.');
  const done = dateStr(body.done_date || today(), '처리일'), next = body.next_due ? dateStr(body.next_due, '다음 기한') : null, exp = body.expire_date ? dateStr(body.expire_date, '유효기간(만료일)') : prior.expire_date;
  if (next && prior.next_due && next <= prior.next_due) throw bad('다음 기한은 지금 기한보다 뒤여야 합니다.');
  if (next && exp && next > exp) throw bad('다음 기한이 유효기간(만료일)보다 뒤입니다.');
  const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: '갱신', done, due: prior.next_due, next, kind: str(body.due_kind, 30) || prior.due_kind, ...(exp !== prior.expire_date ? { expire: [prior.expire_date, exp] } : {}), note: str(body.note, 300) }].slice(-100);
  const r = await db.prepare("UPDATE ip_rights SET next_due=?,expire_date=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?").run(next, exp, JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!r.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return ipRow(await mustGet('ip_rights', prior.id));
});
route('DELETE', '/api/ip-rights/:id', async ({ user, params, query }) => {
  requireIpManager(user); const prior = await mustGet('ip_rights', params.id);
  if (Number(query.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  await db.prepare('DELETE FROM ip_rights WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});
// 15.303 품질 › 인증서 관리: ISO·GRS 등 인증의 유효기간과 다음 심사(사후·갱신) 일정. 보기는 품질 메뉴를 볼 수 있는 사람, 등록·수정·심사 처리·삭제는 품질(담당·책임자)·관리자.
const CERT_KINDS = ['ISO 9001', 'ISO 14001', 'ISO 45001', 'IATF 16949', 'GRS', 'RCS', 'OEKO-TEX STANDARD 100', 'FSC', 'KC', 'ISO 14644(클린룸)', '기타'];
const CERT_STATUS = { prep: '준비·신청', valid: '유효', suspended: '정지', expired: '만료', withdrawn: '취소·반납' };
const CERT_COLS = ['kind', 'cert_no', 'title', 'scope', 'body', 'site', 'first_date', 'issue_date', 'expire_date', 'next_audit', 'audit_kind', 'status', 'owner_name', 'note'];
function certBody(o0) {
  const o = o0 && typeof o0 === 'object' ? o0 : {};
  if (!CERT_KINDS.includes(o.kind)) throw bad('인증 종류를 고르세요.');
  if (!Object.keys(CERT_STATUS).includes(o.status)) throw bad('상태를 고르세요.');
  const d = (v, label) => v === '' || v == null ? null : dateStr(v, label);
  const f = { kind: o.kind, cert_no: str(o.cert_no, 80), title: str(o.title, 200), scope: str(o.scope, 500), body: str(o.body, 100), site: str(o.site, 100),
    first_date: d(o.first_date, '최초 인증일'), issue_date: d(o.issue_date, '발행일'), expire_date: d(o.expire_date, '유효기간(만료일)'), next_audit: d(o.next_audit, '다음 심사일'), audit_kind: str(o.audit_kind, 30),
    status: o.status, owner_name: str(o.owner_name, 50), note: str(o.note, 1000) };
  if (f.kind === '기타' && !f.title) throw bad('기타 인증은 인증명을 넣으세요.');
  if (f.first_date && f.issue_date && f.issue_date < f.first_date) throw bad('발행일이 최초 인증일보다 빠릅니다.');
  if (f.issue_date && f.expire_date && f.expire_date <= f.issue_date) throw bad('유효기간(만료일)은 발행일 뒤여야 합니다.');
  if (f.status === 'valid' && !f.cert_no) throw bad('유효한 인증은 인증번호를 넣으세요.');
  return f;
}
const certRow = r => ({ ...r, history: JSON.parse(r.history || '[]'), status_label: CERT_STATUS[r.status] || r.status });
const requireCertManager = user => { if (!hasRole(user, 'quality')) throw new HttpError(403, '인증서는 품질 담당·품질책임자·관리자만 등록·수정합니다.'); };
route('GET', '/api/certs', async ({ user }) => ({ rows: (await db.prepare('SELECT * FROM certifications ORDER BY CASE WHEN next_audit IS NULL THEN 1 ELSE 0 END, next_audit, id DESC LIMIT 1000').all()).map(certRow), can_manage: hasRole(user, 'quality'), today: today() }));
route('POST', '/api/certs', async ({ user, body }) => {
  requireCertManager(user); const f = certBody(body), key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM certifications WHERE request_id=?').get(key); if (old) return certRow(old); }
  if (f.cert_no && await db.prepare('SELECT 1 FROM certifications WHERE kind=? AND cert_no=?').get(f.kind, f.cert_no)) throw bad(`이미 등록된 ${f.kind} 인증번호입니다: ${f.cert_no}`);
  const r = await db.prepare(`INSERT INTO certifications(${CERT_COLS.join(',')},history,request_id,created_by) VALUES(${CERT_COLS.map(() => '?').join(',')},?,?,?)`).run(...CERT_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '등록' }]), key, user.name);
  return certRow(await mustGet('certifications', r.lastInsertRowid));
});
route('PUT', '/api/certs/:id', async ({ user, params, body }) => {
  requireCertManager(user); const prior = await mustGet('certifications', params.id), f = certBody(body);
  if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (f.cert_no && await db.prepare('SELECT 1 FROM certifications WHERE kind=? AND cert_no=? AND id<>?').get(f.kind, f.cert_no, prior.id)) throw bad(`이미 등록된 ${f.kind} 인증번호입니다: ${f.cert_no}`);
  const changed = CERT_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (!changed.length) return certRow(prior);
  const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: '수정', fields: changed, ...(prior.status !== f.status ? { status: [prior.status, f.status] } : {}) }].slice(-100);
  const r = await db.prepare(`UPDATE certifications SET ${CERT_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`).run(...CERT_COLS.map(k => f[k]), JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!r.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return certRow(await mustGet('certifications', prior.id));
});
// 심사 완료 처리: 사후심사는 다음 심사일을 넘기고, 갱신심사는 새 발행일·만료일까지 바꾸며 이력에 남긴다(결과: 적합·조건부·부적합).
route('POST', '/api/certs/:id/audit', async ({ user, params, body }) => {
  requireCertManager(user); const prior = await mustGet('certifications', params.id);
  if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (!['valid', 'suspended'].includes(prior.status)) throw bad('유효·정지 상태의 인증만 심사 처리합니다.');
  const done = dateStr(body.done_date || today(), '심사일'), result = ['적합', '조건부 적합', '부적합'].includes(body.result) ? body.result : '적합';
  const next = body.next_audit ? dateStr(body.next_audit, '다음 심사일') : null, issue = body.issue_date ? dateStr(body.issue_date, '새 발행일') : prior.issue_date, exp = body.expire_date ? dateStr(body.expire_date, '새 유효기간') : prior.expire_date;
  if (next && next <= done) throw bad('다음 심사일은 심사일 뒤여야 합니다.');
  if (issue && exp && exp <= issue) throw bad('유효기간(만료일)은 발행일 뒤여야 합니다.');
  const status = result === '부적합' ? 'suspended' : prior.status === 'suspended' ? 'valid' : prior.status;
  const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: '심사', done, kind: str(body.audit_kind, 30) || prior.audit_kind, result, due: prior.next_audit, next, ...(issue !== prior.issue_date ? { issue: [prior.issue_date, issue] } : {}), ...(exp !== prior.expire_date ? { expire: [prior.expire_date, exp] } : {}), ...(status !== prior.status ? { status: [prior.status, status] } : {}), note: str(body.note, 300) }].slice(-100);
  const r = await db.prepare("UPDATE certifications SET next_audit=?,audit_kind=?,issue_date=?,expire_date=?,status=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?")
    .run(next, str(body.next_kind, 30), issue, exp, status, JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!r.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return certRow(await mustGet('certifications', prior.id));
});
route('DELETE', '/api/certs/:id', async ({ user, params, query }) => {
  requireCertManager(user); const prior = await mustGet('certifications', params.id);
  if (Number(query.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  await db.prepare('DELETE FROM certifications WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});
// 15.304 품질 › 검교정 관리(계측기 대장). 다음 교정일 = 교정일 + 주기(개월) − 1일(예: 2026-12-01, 12개월 → 2027-11-30).
// 보기는 품질 메뉴를 볼 수 있는 사람, 등록·수정·교정 처리·삭제는 품질 담당·품질책임자·관리자.
const INST_STATUS = { in_use: '사용 중', at_cal: '교정 중', out: '사용중지', spare: '예비', disposed: '폐기' };
const INST_CAL = { external: '외부 교정(KOLAS 등)', internal: '자체 교정', check: '일상 점검' };
const INST_RESULT = ['적합', '조정 후 적합', '부적합'];
const INST_COLS = ['mgmt_no', 'name', 'model', 'maker', 'serial_no', 'spec', 'location', 'location_detail', 'dept', 'owner_name', 'purchase_date', 'cycle_months', 'cal_type', 'cal_agency', 'last_cal', 'next_due', 'cert_no', 'last_result', 'status', 'note'];
function calNextDue(done, months) { if (!done || !months) return null; const [y, m, d] = done.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + months, d)); if (t.getUTCDate() !== d) t.setUTCDate(0); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }
function instBody(o0) {
  const o = o0 && typeof o0 === 'object' ? o0 : {};
  if (!Object.keys(INST_STATUS).includes(o.status)) throw bad('상태를 고르세요.');
  if (!Object.keys(INST_CAL).includes(o.cal_type)) throw bad('교정 방식을 고르세요.');
  const months = Number(o.cycle_months); if (!Number.isInteger(months) || months < 1 || months > 120) throw bad('교정 주기는 1~120개월입니다.');
  if (o.last_result && !INST_RESULT.includes(o.last_result)) throw bad('결과를 다시 고르세요.');
  const d = (v, label) => v === '' || v == null ? null : dateStr(v, label);
  const f = { mgmt_no: reqStr(o.mgmt_no, '관리번호', 50).toUpperCase(), name: reqStr(o.name, '장비명', 100), model: str(o.model, 100), maker: str(o.maker, 100), serial_no: str(o.serial_no, 100), spec: str(o.spec, 200),
    location: str(o.location, 100), location_detail: str(o.location_detail, 100), dept: str(o.dept, 50), owner_name: str(o.owner_name, 50), purchase_date: d(o.purchase_date, '구입일'), cycle_months: months,
    cal_type: o.cal_type, cal_agency: str(o.cal_agency, 100), last_cal: d(o.last_cal, '직전 교정일'), next_due: d(o.next_due, '다음 교정일'), cert_no: str(o.cert_no, 80), last_result: o.last_result || '', status: o.status, note: str(o.note, 1000) };
  if (!f.next_due && f.last_cal) f.next_due = calNextDue(f.last_cal, months);
  if (f.last_cal && f.next_due && f.next_due <= f.last_cal) throw bad('다음 교정일은 직전 교정일 뒤여야 합니다.');
  return f;
}
const instRow = r => ({ ...r, history: JSON.parse(r.history || '[]'), status_label: INST_STATUS[r.status] || r.status, cal_label: INST_CAL[r.cal_type] || r.cal_type });
const requireInstManager = user => { if (!hasRole(user, 'quality')) throw new HttpError(403, '계측기·검교정은 품질 담당·품질책임자·관리자만 등록·수정합니다.'); };
route('GET', '/api/instruments', async ({ user }) => ({ rows: (await db.prepare("SELECT * FROM instruments ORDER BY CASE WHEN status='disposed' THEN 1 ELSE 0 END, CASE WHEN next_due IS NULL THEN 1 ELSE 0 END, next_due, mgmt_no LIMIT 3000").all()).map(instRow), can_manage: hasRole(user, 'quality'), today: today() }));
route('POST', '/api/instruments', async ({ user, body }) => {
  requireInstManager(user); const f = instBody(body), key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM instruments WHERE request_id=?').get(key); if (old) return instRow(old); }
  if (await db.prepare('SELECT 1 FROM instruments WHERE mgmt_no=?').get(f.mgmt_no)) throw bad(`이미 있는 관리번호입니다: ${f.mgmt_no}`);
  const hist = [{ at: now(), by: user.name, what: '등록' }, ...(f.last_cal ? [{ at: now(), by: user.name, what: '교정', done: f.last_cal, result: f.last_result || '', agency: f.cal_agency, cert: f.cert_no, next: f.next_due, note: '등록 때 입력한 직전 교정' }] : [])];
  const r = await db.prepare(`INSERT INTO instruments(${INST_COLS.join(',')},history,request_id,created_by) VALUES(${INST_COLS.map(() => '?').join(',')},?,?,?)`).run(...INST_COLS.map(k => f[k]), JSON.stringify(hist), key, user.name);
  return instRow(await mustGet('instruments', r.lastInsertRowid));
});
route('PUT', '/api/instruments/:id', async ({ user, params, body }) => {
  requireInstManager(user); const prior = await mustGet('instruments', params.id), f = instBody(body);
  if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (await db.prepare('SELECT 1 FROM instruments WHERE mgmt_no=? AND id<>?').get(f.mgmt_no, prior.id)) throw bad(`이미 있는 관리번호입니다: ${f.mgmt_no}`);
  const changed = INST_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (!changed.length) return instRow(prior);
  const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: '수정', fields: changed, ...(prior.status !== f.status ? { status: [prior.status, f.status] } : {}), ...(prior.location !== f.location ? { moved: [prior.location, f.location] } : {}) }].slice(-200);
  const r = await db.prepare(`UPDATE instruments SET ${INST_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`).run(...INST_COLS.map(k => f[k]), JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!r.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return instRow(await mustGet('instruments', prior.id));
});
// 교정 처리(한 대 또는 여러 대 한꺼번에): 교정일·결과·교정기관·성적서 번호 → 직전 교정일·다음 교정일(교정일 + 주기 − 1일, 한 대일 때는 직접 지정 가능)·상태 갱신, 이력에 남김.
// 부적합이면 사용중지(영향 검토 메모), 적합·조정 후 적합이면 교정 중·사용중지였던 장비를 사용 중으로.
route('POST', '/api/instruments/calibrate', async ({ user, body }) => {
  requireInstManager(user);
  const items = Array.isArray(body.items) ? body.items : []; if (!items.length || items.length > 200) throw bad('교정 처리할 계측기를 1~200대 고르세요.');
  const done = dateStr(body.done_date || today(), '교정일'); if (done > today()) throw bad('아직 지나지 않은 날짜로는 교정 처리할 수 없습니다.');
  if (!INST_RESULT.includes(body.result)) throw bad('결과를 고르세요.'); const result = body.result;
  const agency = str(body.agency, 100), cert = str(body.cert_no, 80), note = str(body.note, 300), cost = body.cost === '' || body.cost == null ? null : Number(body.cost);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw bad('비용은 0 이상 숫자로 넣으세요.');
  if (result === '부적합' && !note) throw bad('부적합이면 조치·영향 검토 내용을 메모에 적으세요.');
  const cmds = [];
  for (const it of items) {
    const prior = await mustGet('instruments', Number(it?.id) || 0); if (Number(it.revision) !== prior.revision) throw new HttpError(409, `${prior.mgmt_no}: 다른 사람이 먼저 고쳤습니다. 다시 불러오세요.`);
    if (prior.status === 'disposed') throw bad(`${prior.mgmt_no}: 폐기된 계측기입니다.`);
    if (prior.last_cal && done < prior.last_cal) throw bad(`${prior.mgmt_no}: 교정일이 직전 교정일(${prior.last_cal})보다 빠릅니다.`);
    const next = items.length === 1 && body.next_due ? dateStr(body.next_due, '다음 교정일') : calNextDue(done, prior.cycle_months);
    if (next <= done) throw bad('다음 교정일은 교정일 뒤여야 합니다.');
    const status = result === '부적합' ? 'out' : ['at_cal', 'out'].includes(prior.status) ? 'in_use' : prior.status;
    const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: '교정', done, result, agency: agency || prior.cal_agency, cert: items.length === 1 ? cert : '', cost: items.length === 1 ? cost : null, prev: prior.last_cal, due: prior.next_due, next, ...(status !== prior.status ? { status: [prior.status, status] } : {}), note }].slice(-200);
    cmds.push({ sql: "UPDATE instruments SET last_cal=?,next_due=?,last_result=?,cal_agency=?,cert_no=?,status=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?",
      args: [done, next, result, agency || prior.cal_agency, items.length === 1 ? cert : '', status, JSON.stringify(hist), user.name, prior.id, prior.revision] });
  }
  const res = await db.batch(cmds); if (res.some(x => !(x.meta?.changes ?? x.changes))) throw new HttpError(409, '그 사이 다른 사람이 고친 계측기가 있습니다. 다시 불러와 확인하세요.');
  return { done: cmds.length, rows: (await db.prepare(`SELECT * FROM instruments WHERE id IN (${items.map(() => '?').join(',')})`).all(...items.map(i => Number(i.id)))).map(instRow) };
});
route('DELETE', '/api/instruments/:id', async ({ user, params, query }) => {
  requireInstManager(user); const prior = await mustGet('instruments', params.id);
  if (Number(query.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  await db.prepare('DELETE FROM instruments WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});
// ── 15.305 품질 1단계: LOT별 COA 발행 · 부적합·CAPA ──
// COA 데이터: 그 LOT의 측정값(출하검사 우선, 합격 우선, 없으면 의뢰·공정검사·연구 분석)과 생산실적(제조일·수량)·출하(고객사·출하일)
const coaSpecText = it => it.min != null && it.max != null ? `${it.min} ~ ${it.max}` : it.min != null ? `≥ ${it.min}` : it.max != null ? `≤ ${it.max}` : '';
function coaItems(snapshot, rows) {
  const spec = typeof snapshot === 'string' ? JSON.parse(snapshot || '{}') : snapshot || {};
  return (spec.items || []).map((it, i) => { const key = it.key || 'i' + i, vals = (rows || []).flatMap(r => (r.values?.[key] || []).filter(v => v !== null && v !== '' && Number.isFinite(Number(v))).map(Number));
    const avg = vals.length ? Math.round(vals.reduce((t, v) => t + v, 0) / vals.length * 1000) / 1000 : null, judged = it.min != null || it.max != null;
    const out = vals.some(v => (it.min != null && v < it.min) || (it.max != null && v > it.max));
    return { name: it.name, unit: it.unit || '', spec: coaSpecText(it), method: it.method || '', n: vals.length, avg, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, judge: !vals.length ? '' : !judged ? '기록' : out ? '부적합' : '적합' }; });
}
async function coaSource(lot, sourceId = null) {
  const cands = await db.prepare(`SELECT r.id, r.req_no, r.type, r.category, r.title, r.inspection_snapshot, r.data, m.values_json, m.result, m.updated_at FROM requests r JOIN inspection_measurements m ON m.request_id=r.id
    WHERE r.type IN ('analysis','rnd_analysis') AND r.inspection_snapshot<>'' AND r.status<>'rejected' AND (r.lot=? OR json_extract(r.data,'$.lot')=? OR json_extract(r.data,'$.lot_etc')=?)
    ORDER BY CASE r.category WHEN '출하검사' THEN 0 WHEN '공정검사' THEN 1 ELSE 2 END, CASE m.result WHEN 'pass' THEN 0 ELSE 1 END, r.id DESC LIMIT 10`).all(lot, lot, lot);
  const pick = sourceId ? cands.find(c => c.id === Number(sourceId)) : cands[0];
  if (sourceId && !pick) throw bad('그 LOT의 측정 기록이 아닙니다.');
  const prod = await db.prepare(`SELECT a.production_date, a.qty, s.product, s.spec, COALESCE(NULLIF(s.unit,''),json_extract(s.bom_snapshot,'$.unit'),'') AS unit, COALESCE(json_extract(s.bom_snapshot,'$.product_code'),'') AS code
    FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE a.lot=? AND a.voided_at IS NULL ORDER BY a.id LIMIT 1`).get(lot);
  const ships = await db.prepare('SELECT customer, MAX(ship_date) AS ship_date, SUM(qty) AS qty FROM shipments WHERE lot=? GROUP BY customer ORDER BY MAX(ship_date) DESC LIMIT 10').all(lot);
  const pd = pick ? JSON.parse(pick.data || '{}') : {};
  return { lot, candidates: cands.map(c => ({ id: c.id, req_no: c.req_no, category: c.type === 'rnd_analysis' ? '연구 분석' : c.category, title: c.title, result: c.result, updated_at: c.updated_at })),
    source: pick ? { id: pick.id, req_no: pick.req_no, result: pick.result, items: coaItems(pick.inspection_snapshot, JSON.parse(pick.values_json || '[]')) } : null,
    header: { item: prod?.product || pick?.title || '', product_code: prod?.code || pd.product_code || '', spec: prod?.spec || '', mfg_date: prod?.production_date || null, qty: prod?.qty ?? null, unit: prod?.unit || pd.unit || '', customers: ships },
    coas: (await db.prepare("SELECT id, coa_no, rev, status, customer, created_at FROM coas WHERE lot=? ORDER BY id DESC").all(lot)) };
}
const COA_STATUS = { draft: '작성', approved: '승인(발행)', void: '무효' };
const coaRow = r => ({ ...r, items: JSON.parse(r.items_json || '[]'), history: JSON.parse(r.history || '[]'), status_label: COA_STATUS[r.status] || r.status });
const coaHead = (b, h = {}) => ({ customer: str(b.customer ?? h.customer, 100), item: str(b.item ?? h.item, 200), product_code: str(b.product_code ?? h.product_code, 80), spec: str(b.spec ?? h.spec, 100),
  qty: b.qty === '' || b.qty == null ? (h.qty ?? null) : num(b.qty, '수량'), unit: str(b.unit ?? h.unit, 20), mfg_date: b.mfg_date === '' ? null : b.mfg_date ? dateStr(b.mfg_date, '제조일') : h.mfg_date || null,
  exp_date: b.exp_date === '' ? null : b.exp_date ? dateStr(b.exp_date, '유효기간') : h.exp_date || null, ship_date: b.ship_date === '' ? null : b.ship_date ? dateStr(b.ship_date, '출하일') : h.ship_date || null,
  lang: b.lang === 'en' ? 'en' : b.lang === 'ko' ? 'ko' : h.lang || 'ko', note: str(b.note ?? h.note, 500) });
route('GET', '/api/coa/source', async ({ query }) => coaSource(reqStr(query.lot, 'LOT', 100), query.source || null));
route('GET', '/api/coas', async ({ user, query }) => {
  const where = [], args = []; if (query.status && COA_STATUS[query.status]) { where.push('status=?'); args.push(query.status); }
  if (query.lot) { where.push('lot=?'); args.push(str(query.lot, 100)); }
  applyListKeyword(where, args, query.q, ['coa_no', 'lot', 'item', 'product_code', 'customer', 'source_no']);
  return { rows: (await db.prepare(`SELECT * FROM coas ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...args)).map(coaRow), can_manage: hasRole(user, 'quality'), can_approve: hasRole(user, 'quality_approver'), company: await companyInfo() };
});
route('GET', '/api/coas/:id', async ({ params }) => ({ ...coaRow(await mustGet('coas', params.id)), company: await companyInfo() }));
route('POST', '/api/coas', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const lot = reqStr(body.lot, 'LOT', 100), key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM coas WHERE request_id=?').get(key); if (old) return coaRow(old); }
  const src = await coaSource(lot, body.source_request_id || null);
  if (!src.source) throw bad(`LOT ${lot}의 측정 기록(출하검사·분석)이 없습니다. 측정값을 먼저 넣으세요.`);
  if (src.source.result !== 'pass') throw bad(`${src.source.req_no}의 판정이 합격이 아닙니다(${src.source.result === 'fail' ? '불합격' : '측정 중'}). 합격 판정 측정값이 있어야 COA를 발행합니다.`);
  const first = src.header.customers[0] || {}, f = coaHead(body, { ...src.header, customer: first.customer || '', ship_date: first.ship_date || null, exp_date: src.header.mfg_date ? (() => { const [y, m, d] = src.header.mfg_date.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + 24, d)); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); })() : null });
  const prefix = 'COA-' + today().slice(2).replace(/-/g, '') + '-';
  const r = await db.prepare(`INSERT INTO coas(coa_no,lot,item,product_code,spec,customer,qty,unit,mfg_date,exp_date,ship_date,source_request_id,source_no,items_json,judge,lang,note,history,request_id,created_by) VALUES(${nextDocNo('coas', 'coa_no')},?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(prefix, prefix, prefix, lot, f.item, f.product_code, f.spec, f.customer, f.qty, f.unit, f.mfg_date, f.exp_date, f.ship_date, src.source.id, src.source.req_no, JSON.stringify(src.source.items), '적합', f.lang, f.note, JSON.stringify([{ at: now(), by: user.name, what: '작성', source: src.source.req_no }]), key, user.name);
  return coaRow(await mustGet('coas', r.lastInsertRowid));
});
// 고치기: 작성 상태는 그대로 고침. 승인된 COA를 고치면 재발행(Rev+1) 작성 상태로 돌아가고 이전 판은 이력에 남김. refresh=1이면 측정값을 다시 가져옴.
route('PUT', '/api/coas/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('coas', params.id);
  if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (prior.status === 'void') throw bad('무효 처리된 COA입니다.');
  const f = coaHead(body, prior); let items = prior.items_json, srcId = prior.source_request_id, srcNo = prior.source_no;
  if (body.refresh || body.source_request_id) { const src = await coaSource(prior.lot, body.source_request_id || null); if (!src.source || src.source.result !== 'pass') throw bad('합격 판정 측정값이 있어야 합니다.'); items = JSON.stringify(src.source.items); srcId = src.source.id; srcNo = src.source.req_no; }
  const reissue = prior.status === 'approved';
  const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: reissue ? '재발행 작성' : '수정', ...(reissue ? { prev: { rev: prior.rev, approved_by: prior.approved_by, approved_at: prior.approved_at, items: JSON.parse(prior.items_json || '[]'), customer: prior.customer, exp_date: prior.exp_date } } : {}) }].slice(-50);
  const r = await db.prepare(`UPDATE coas SET item=?,product_code=?,spec=?,customer=?,qty=?,unit=?,mfg_date=?,exp_date=?,ship_date=?,lang=?,note=?,items_json=?,source_request_id=?,source_no=?,status='draft',rev=rev+?,approved_by=CASE WHEN ?=1 THEN '' ELSE approved_by END,approved_at=CASE WHEN ?=1 THEN NULL ELSE approved_at END,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(f.item, f.product_code, f.spec, f.customer, f.qty, f.unit, f.mfg_date, f.exp_date, f.ship_date, f.lang, f.note, items, srcId, srcNo, reissue ? 1 : 0, reissue ? 1 : 0, reissue ? 1 : 0, JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!r.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return coaRow(await mustGet('coas', prior.id));
});
route('POST', '/api/coas/:id/approve', async ({ user, params, body }) => {
  if (!hasRole(user, 'quality_approver')) throw new HttpError(403, 'COA 승인은 품질책임자·관리자가 합니다.');
  const prior = await mustGet('coas', params.id); if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (prior.status !== 'draft') throw bad('작성 상태의 COA만 승인합니다.');
  const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: '승인', rev: prior.rev }].slice(-50);
  const ra = await db.prepare("UPDATE coas SET status='approved',approved_by=?,approved_at=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=? AND status='draft'").run(user.name, now(), JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!ra.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return coaRow(await mustGet('coas', prior.id));
});
route('POST', '/api/coas/:id/void', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('coas', params.id); if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (prior.status === 'approved' && !hasRole(user, 'quality_approver')) throw new HttpError(403, '승인된 COA의 무효 처리는 품질책임자가 합니다.');
  const reason = reqStr(body.reason, '무효 사유', 300), hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: '무효', reason }].slice(-50);
  const rv = await db.prepare("UPDATE coas SET status='void',void_reason=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?").run(reason, JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!rv.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return coaRow(await mustGet('coas', prior.id));
});

// 부적합·CAPA: 등록 → 원인분석 → 조치 → 유효성검증 → 종결(품질책임자). 출처(수입·출하검사·분석·VOC·공정 이상·심사 지적)에서 바로 등록하면 출처 번호·품목·LOT를 채운다.
const NC_STATUS = { open: '등록', analysis: '원인분석', action: '조치', verify: '유효성검증', closed: '종결', void: '취소' };
const NC_SOURCE = { iqc: '수입검사', oqc: '출하검사', analysis: '분석', process: '공정 이상', voc: '고객 불만(VOC)', audit: '심사 지적', risk: '위험성평가', other: '기타' };
const NC_KIND = ['OOS', 'OOT', '공정 이상', '고객 불만', '심사 지적', '기타'];
const NC_GRADE = { critical: '치명', major: '중대', minor: '경미' };
const NC_COLS = ['kind', 'grade', 'title', 'detail', 'item', 'lot', 'qty', 'found_date', 'owner_name', 'due_date', 'containment', 'cause_json', 'correction', 'corrective', 'preventive', 'action_date', 'verify_date', 'verify_result', 'verify_note'];
function ncBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const kind = pick('kind') || 'OOS'; if (!NC_KIND.includes(kind)) throw bad('유형을 고르세요.');
  const grade = pick('grade') || 'minor'; if (!NC_GRADE[grade]) throw bad('등급을 고르세요.');
  const d = (v, label) => v === '' || v == null ? null : dateStr(v, label);
  let cause = pick('cause_json'); if (typeof cause === 'string') { try { cause = JSON.parse(cause || '{}'); } catch { cause = {}; } }
  cause = cause && typeof cause === 'object' && !Array.isArray(cause) ? Object.fromEntries(['why1', 'why2', 'why3', 'why4', 'why5', 'man', 'machine', 'material', 'method', 'env', 'root'].map(k => [k, str(cause[k], 300)]).filter(([, v]) => v)) : {};
  const qty = pick('qty'); const f = { kind, grade, title: reqStr(pick('title'), '부적합 내용(제목)', 200), detail: str(pick('detail'), 2000), item: str(pick('item'), 200), lot: str(pick('lot'), 100),
    qty: qty === '' || qty == null ? null : num(qty, '수량'), found_date: d(pick('found_date') || today(), '발생일'), owner_name: str(pick('owner_name'), 50), due_date: d(pick('due_date'), '조치 기한'),
    containment: str(pick('containment'), 1000), cause_json: JSON.stringify(cause), correction: str(pick('correction'), 1000), corrective: str(pick('corrective'), 1000), preventive: str(pick('preventive'), 1000),
    action_date: d(pick('action_date'), '조치일'), verify_date: d(pick('verify_date'), '검증일'), verify_result: pick('verify_result') || '', verify_note: str(pick('verify_note'), 1000) };
  if (!['', '유효', '효과 없음'].includes(f.verify_result)) throw bad('검증 결과를 고르세요.');
  if (f.due_date && f.due_date < f.found_date) throw bad('조치 기한이 발생일보다 빠릅니다.');
  return f;
}
const ncRow = r => ({ ...r, cause: JSON.parse(r.cause_json || '{}'), history: JSON.parse(r.history || '[]'), status_label: NC_STATUS[r.status] || r.status, source_label: NC_SOURCE[r.source_type] || r.source_type, grade_label: NC_GRADE[r.grade] || r.grade });
// 단계마다 필요한 내용: 원인분석 → 조치로 갈 때 원인, 조치 → 검증으로 갈 때 시정조치, 종결은 유효성검증 「유효」 + 품질책임자
function ncCheckStep(f, to, user) {
  const cause = JSON.parse(f.cause_json || '{}');
  if (['action', 'verify', 'closed'].includes(to) && !Object.keys(cause).length) throw bad('원인분석(5Why 또는 4M·근본 원인)을 적어야 다음 단계로 갑니다.');
  if (['verify', 'closed'].includes(to) && !f.corrective) throw bad('시정조치 내용을 적어야 유효성검증으로 갑니다.');
  if (to === 'closed') { if (f.verify_result !== '유효' || !f.verify_date) throw bad('유효성검증 결과가 「유효」이고 검증일이 있어야 종결합니다.'); if (!hasRole(user, 'quality_approver')) throw new HttpError(403, '종결은 품질책임자·관리자가 합니다.'); }
}
route('GET', '/api/ncs', async ({ user, query }) => {
  const where = [], args = [];
  if (query.source_type && NC_SOURCE[query.source_type]) { where.push('source_type=?'); args.push(query.source_type); }
  if (query.source_id) { where.push('source_id=?'); args.push(Number(query.source_id) || 0); }
  applyListKeyword(where, args, query.q, ['nc_no', 'title', 'item', 'lot', 'source_no', 'owner_name']);
  return { rows: (await db.prepare(`SELECT * FROM nonconformities ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE WHEN status IN ('closed','void') THEN 1 ELSE 0 END, COALESCE(due_date,'9999'), id DESC LIMIT 1000`).all(...args)).map(ncRow), can_manage: hasRole(user, 'quality'), can_close: hasRole(user, 'quality_approver'), today: today() };
});
route('POST', '/api/ncs', async ({ user, body }) => {
  if (!(body.source_type === 'process' && hasRole(user, 'production'))) requireRole(user, 'quality', '품질'); // 15.307 공정 이상발생은 생산도 등록
  const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM nonconformities WHERE request_id=?').get(key); if (old) return ncRow(old); }
  const st = NC_SOURCE[body.source_type] ? body.source_type : 'other'; let sid = null, sno = '', fill = {};
  if (['iqc', 'oqc', 'analysis', 'voc'].includes(st) && body.source_id) { const q = await getRequest(Number(body.source_id) || 0); sid = q.id; sno = q.req_no; const qd = JSON.parse(q.data || '{}'); fill = { item: q.title, lot: q.lot || qd.lot_etc || (['있음', '없음'].includes(qd.lot) ? '' : qd.lot || '') }; }
  else if (body.source_no) sno = str(body.source_no, 80);
  const f = ncBody({ ...fill, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '' && v != null)), title: body.title });
  const prefix = 'NC-' + today().slice(2).replace(/-/g, '') + '-';
  const r = await db.prepare(`INSERT INTO nonconformities(nc_no,source_type,source_id,source_no,${NC_COLS.join(',')},history,request_id,created_by) VALUES(${nextDocNo('nonconformities', 'nc_no')},?,?,?,${NC_COLS.map(() => '?').join(',')},?,?,?)`)
    .run(prefix, prefix, prefix, st, sid, sno, ...NC_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '등록', source: sno }]), key, user.name);
  return ncRow(await mustGet('nonconformities', r.lastInsertRowid));
});
route('PUT', '/api/ncs/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('nonconformities', params.id);
  if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  if (['closed', 'void'].includes(prior.status) && !(body.status && body.status !== prior.status && hasRole(user, 'quality_approver'))) throw bad(`${NC_STATUS[prior.status]}된 건입니다. 다시 열려면 품질책임자가 상태를 바꾸세요.`);
  const f = ncBody(body, prior), to = body.status && NC_STATUS[body.status] ? body.status : prior.status;
  if (to !== prior.status) { if (to === 'void' && !str(body.reason, 300)) throw bad('취소 사유를 적으세요.'); if (to === 'void' && prior.source_type === 'audit' && !hasRole(user, 'quality_approver')) throw new HttpError(403, '심사 지적 CAPA의 취소는 품질책임자가 합니다.'); if (to !== 'void' && to !== 'open') ncCheckStep(f, to, user); }
  const changed = NC_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null));
  if (!changed.length && to === prior.status) return ncRow(prior);
  const hist = [...JSON.parse(prior.history || '[]'), { at: now(), by: user.name, what: to !== prior.status ? '단계' : '수정', ...(to !== prior.status ? { status: [prior.status, to] } : {}), fields: changed, ...(body.reason ? { reason: str(body.reason, 300) } : {}) }].slice(-100);
  const closing = to === 'closed' && prior.status !== 'closed';
  const r = await db.prepare(`UPDATE nonconformities SET ${NC_COLS.map(k => k + '=?').join(',')},status=?,closed_by=CASE WHEN ?=1 THEN ? WHEN ?='closed' THEN closed_by ELSE '' END,closed_at=CASE WHEN ?=1 THEN ? WHEN ?='closed' THEN closed_at ELSE NULL END,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...NC_COLS.map(k => f[k]), to, closing ? 1 : 0, user.name, to, closing ? 1 : 0, now(), to, JSON.stringify(hist), user.name, prior.id, prior.revision);
  if (!r.changes) throw new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');
  return ncRow(await mustGet('nonconformities', prior.id));
});
// ── 15.306 품질 2단계(QA 체계): 문서관리 · 변경관리 · 교육·자격 · 협력업체 품질 ──
// 문서·공급사 COA 파일(PDF·사진)은 사진과 같은 회사 저장소에 무작위 이름(24자리)으로 둔다. 목록 API가 열람 권한이 없는 사람에게는 파일 이름을 주지 않는다.
async function saveDocFiles(list, max = 5) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > max) throw bad(`파일은 한 번에 ${max}개까지 올릴 수 있습니다.`);
  const parsed = list.map(x => {
    const o = typeof x === 'string' ? { data: x } : x || {};
    const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(o.data || ''));
    if (!m) throw bad('파일은 PDF 또는 사진(jpg·png·webp)만 올릴 수 있습니다.');
    if (m[2].length > Math.ceil(8 * 1024 * 1024 / 3) * 4 + 4) throw bad('파일 하나는 8MB 이하여야 합니다.');
    let bytes; try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); } catch { throw bad('파일 형식이 올바르지 않습니다.'); }
    if (bytes.length > 8 * 1024 * 1024) throw bad('파일 하나는 8MB 이하여야 합니다.');
    if (m[1] === 'application/pdf' && !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw bad('PDF 파일이 올바르지 않습니다.');
    const ext = m[1] === 'application/pdf' ? 'pdf' : m[1] === 'image/jpeg' ? 'jpg' : m[1].slice(6);
    return { file: randomHex(12) + '.' + ext, bytes, type: m[1], name: str(o.name, 120).replace(/[\\/:*?"<>|]/g, '_') || '파일.' + ext, size: bytes.length };
  });
  const saved = [];
  try { for (const p of parsed) { await images.put(p.file, p.bytes, { httpMetadata: { contentType: p.type } }); saved.push(p.file); } }
  catch (error) { await removePhotos(saved); throw error; }
  return parsed.map(({ bytes, ...p }) => ({ ...p, at: now() }));
}
const addYears = (d, n) => { if (!d || !n) return null; const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y + n, m - 1, dd)); if (t.getUTCDate() !== dd) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
const intIn = (v, label, lo, hi, def) => { if (v === '' || v == null) return def; const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${label}은(는) ${lo}~${hi} 사이 정수로 넣으세요.`); return n; };
// 15.309 음수도 되는 숫자(온도·편차·치수 변화 등). num()은 0 이상만 받는다.
const numS = (v, label) => { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n)) throw bad(`${label}을(를) 숫자로 넣으세요.`); return n; };
const qDate = (v, label) => v === '' || v == null ? null : dateStr(v, label);
const optId = v => v === '' || v == null ? null : Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const tokGuard = (table, id, rev, tok) => ({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE id=? AND revision=? AND instr(history, ?)>0)`, args: [id, rev, `"tok":"${tok}"`] });
const pushHist = (prior, entry) => JSON.stringify([...JSON.parse(prior.history || '[]'), { at: now(), ...entry }].slice(-100));
const conflict = () => new HttpError(409, '다른 사람이 먼저 고쳤습니다. 다시 열어 주세요.');

// A1 문서관리. 내부문서: 초안 → 검토 → 승인·배포(품질책임자) → 폐지, 개정하면 판(Rev)이 하나 오르고 승인된 판은 파일과 함께 versions에 쌓인다.
// 외부문서(규격·법규·고객 요구서)는 등록이 곧 유효(대장). 열람 부서를 지정하면 품질 담당·책임자 말고는 그 부서만 보이고, 그 사람들에게는 최신 승인판만 내려받게 한다.
const QDOC_KIND = { manual: '품질 매뉴얼', procedure: '절차서', instruction: '지침서', form: '양식·서식', std: '규격(KS·ISO 등)', law: '법규', customer: '고객 요구서', ext_other: '기타 외부문서' };
const QDOC_INTERNAL = ['manual', 'procedure', 'instruction', 'form'];
const QDOC_PREFIX = { manual: 'QM-', procedure: 'QP-', instruction: 'QI-', form: 'QF-', std: 'EX-', law: 'EX-', customer: 'EX-', ext_other: 'EX-' };
const QDOC_STATUS = { draft: '초안', review: '검토', approved: '승인·배포', obsolete: '폐지' };
const QDOC_COLS = ['title', 'kind', 'edition', 'issuer', 'dept', 'owner_name', 'summary', 'effective_date', 'review_months', 'next_review', 'retention_years', 'dispose_date', 'access_depts', 'training_needed', 'change_id', 'note'];
function qdocBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const kind = pick('kind'); if (!QDOC_KIND[kind]) throw bad('문서 종류를 고르세요.');
  if (prior.kind && QDOC_INTERNAL.includes(prior.kind) !== QDOC_INTERNAL.includes(kind)) throw bad('내부문서와 외부문서는 서로 바꿀 수 없습니다. 새로 등록하세요.');
  let depts = pick('access_depts'); if (typeof depts === 'string') { try { depts = JSON.parse(depts || '[]'); } catch { depts = []; } }
  depts = Array.isArray(depts) ? [...new Set(depts.map(x => str(x, 50)).filter(Boolean))].slice(0, 30) : [];
  const f = { title: reqStr(pick('title'), '문서 제목', 200), kind, edition: str(pick('edition'), 60), issuer: str(pick('issuer'), 100), dept: str(pick('dept'), 50), owner_name: str(pick('owner_name'), 50), summary: str(pick('summary'), 1000),
    effective_date: qDate(pick('effective_date'), '시행일'), review_months: intIn(pick('review_months'), '검토 주기(개월)', 0, 60, 12), next_review: qDate(pick('next_review'), '다음 검토일'),
    retention_years: intIn(pick('retention_years'), '보존기간(년)', 0, 99, 3), dispose_date: qDate(pick('dispose_date'), '폐기 예정일'), access_depts: JSON.stringify(depts),
    training_needed: pick('training_needed') === true || pick('training_needed') === 1 || pick('training_needed') === '1' || pick('training_needed') === 'on' ? 1 : 0, change_id: optId(pick('change_id')), note: str(pick('note'), 1000) };
  return f;
}
const isQuality = user => hasRole(user, 'quality');
function qdocRow(r, user) {
  const versions = JSON.parse(r.versions || '[]'), file = JSON.parse(r.file_json || '{}'), depts = JSON.parse(r.access_depts || '[]');
  const out = { ...r, versions, file: file.file ? file : null, access_depts: depts, internal: QDOC_INTERNAL.includes(r.kind), kind_label: QDOC_KIND[r.kind] || r.kind, status_label: QDOC_STATUS[r.status] || r.status, history: JSON.parse(r.history || '[]'), current: versions.at(-1) || null };
  delete out.file_json;
  if (!isQuality(user)) { out.file = null; out.versions = versions.map(({ file: _f, ...v }) => v); out.history = []; }
  return out;
}
const qdocVisible = (r, user) => { if (isQuality(user)) return true; if (r.status === 'obsolete' || !JSON.parse(r.versions || '[]').length) return false; /* 15.309 개정 중(초안·검토)에도 현행 승인판은 보임 */ const d = JSON.parse(r.access_depts || '[]'); return !d.length || d.includes(user.department || ''); };
async function qdocDropFile(file, versions) { if (file?.file && !versions.some(v => v.file?.file === file.file)) await removePhotos([file.file]); }
route('GET', '/api/qdocs', async ({ user }) => {
  const rows = (await db.prepare('SELECT * FROM quality_docs ORDER BY doc_no LIMIT 2000').all()).filter(r => qdocVisible(r, user)).map(r => qdocRow(r, user));
  const lists = await orgLists(true);
  return { rows, can_manage: isQuality(user), can_approve: hasRole(user, 'quality_approver'), today: today(), depts: lists.departments.map(d => d.name), me: { name: user.name, department: user.department || '' } };
});
route('POST', '/api/qdocs', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM quality_docs WHERE request_id=?').get(key); if (old) return qdocRow(old, user); }
  const f = qdocBody(body), internal = QDOC_INTERNAL.includes(f.kind), docNo = str(body.doc_no, 40).toUpperCase();
  if (docNo && await db.prepare('SELECT 1 FROM quality_docs WHERE doc_no=?').get(docNo)) throw bad(`이미 있는 문서번호입니다: ${docNo}`);
  if (!internal && !f.issuer) throw bad('외부문서는 발행처(예: 국가기술표준원·고객사)를 넣으세요.');
  const files = await saveDocFiles(body.files, 1), file = files[0] || {};
  try {
    const rev = 0, eff = f.effective_date || (internal ? null : today());
    const status = internal ? 'draft' : 'approved';
    const versions = internal ? [] : [{ rev, edition: f.edition, file: file.file ? file : null, summary: '등록', approved_by: user.name, approved_at: now(), effective_date: eff }];
    const prefix = QDOC_PREFIX[f.kind];
    const r = await db.prepare(`INSERT INTO quality_docs(doc_no,scope,rev,${QDOC_COLS.join(',')},file_json,versions,status,approved_by,approved_at,history,request_id,created_by) VALUES(${docNo ? '?' : nextDocNo('quality_docs', 'doc_no')},?,?,${QDOC_COLS.map(() => '?').join(',')},?,?,?,?,?,?,?,?)`)
      .run(...(docNo ? [docNo] : [prefix, prefix, prefix]), internal ? 'internal' : 'external', rev, ...QDOC_COLS.map(k => k === 'effective_date' ? eff : k === 'next_review' && !internal && !f.next_review ? (f.review_months ? calNextDue(eff, f.review_months) : null) : f[k]),
        JSON.stringify(file), JSON.stringify(versions), status, internal ? '' : user.name, internal ? null : now(), JSON.stringify([{ at: now(), by: user.name, what: internal ? '초안 등록' : '외부문서 등록' }]), key, user.name);
    return qdocRow(await mustGet('quality_docs', r.lastInsertRowid), user);
  } catch (error) { await removePhotos(files.map(x => x.file)); throw error; }
});
route('PUT', '/api/qdocs/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('quality_docs', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (prior.status === 'obsolete') throw bad('폐지된 문서는 고칠 수 없습니다.');
  const internal = QDOC_INTERNAL.includes(prior.kind), locked = internal && prior.status !== 'draft'; // 15.309 검토 요청 뒤에는 내용·파일 잠금(반려하면 초안으로)
  // 승인·배포된 내부문서는 관리 정보(주관 부서·담당·열람 부서·보존·검토 주기·메모)만 고친다. 내용·파일은 「개정」으로.
  const src = locked ? Object.fromEntries(Object.entries(body).filter(([k]) => ['dept', 'owner_name', 'access_depts', 'retention_years', 'review_months', 'next_review', 'note', 'training_needed'].includes(k))) : body;
  const f = qdocBody(src, prior);
  const versions = JSON.parse(prior.versions || '[]'), oldFile = JSON.parse(prior.file_json || '{}');
  const files = !locked ? await saveDocFiles(body.files, 1) : [];
  try {
    const file = files[0] || (body.remove_file && !locked ? {} : oldFile);
    const changed = QDOC_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (file.file !== oldFile.file) changed.push('file');
    if (!changed.length) return qdocRow(prior, user);
    // 외부문서는 판(edition)이나 파일이 바뀌면 그때 판을 대장 이력에 하나 더 쌓는다.
    let vers = versions;
    if (!internal && (f.edition !== prior.edition || file.file !== oldFile.file)) vers = [...versions, { rev: versions.length, edition: f.edition, file: file.file ? file : null, summary: str(body.change_note, 300) || '판 변경', approved_by: user.name, approved_at: now(), effective_date: f.effective_date || today() }];
    const r = await db.prepare(`UPDATE quality_docs SET ${QDOC_COLS.map(k => k + '=?').join(',')},file_json=?,versions=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
      .run(...QDOC_COLS.map(k => f[k]), JSON.stringify(file), JSON.stringify(vers), pushHist(prior, { by: user.name, what: '수정', fields: changed }), user.name, prior.id, prior.revision);
    if (!r.changes) throw conflict();
    if (file.file !== oldFile.file) await qdocDropFile(oldFile, vers);
    return qdocRow(await mustGet('quality_docs', prior.id), user);
  } catch (error) { await removePhotos(files.map(x => x.file)); throw error; }
});
// 단계: draft → review(검토 요청) → approved(승인·배포, 품질책임자) / review → draft(반려) / approved → draft(개정 시작: Rev+1) / 어느 단계든 → obsolete(폐지, 품질책임자)
route('POST', '/api/qdocs/:id/step', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('quality_docs', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const to = body.to, from = prior.status, internal = QDOC_INTERNAL.includes(prior.kind), file = JSON.parse(prior.file_json || '{}'), versions = JSON.parse(prior.versions || '[]');
  const reason = str(body.reason, 300), approver = hasRole(user, 'quality_approver');
  const set = { status: to }; let what = '';
  if (to === 'obsolete') {
    if (from === 'obsolete') throw bad('이미 폐지된 문서입니다.'); if (!approver) throw new HttpError(403, '폐지는 품질책임자·관리자가 합니다.'); if (!reason) throw bad('폐지 사유를 적으세요.');
    set.obsolete_date = today(); set.dispose_date = prior.dispose_date || (prior.retention_years ? addYears(today(), prior.retention_years) : null); what = '폐지';
  } else if (!internal) throw bad('외부문서는 수정과 폐지만 합니다.');
  else if (from === 'draft' && to === 'review') {
    if (!file.file) throw bad('문서 파일(PDF 등)을 올려야 검토를 요청합니다.');
    if (prior.rev > 0 && !prior.summary) throw bad('개정 내용(무엇을 바꿨는지)을 적어야 검토를 요청합니다.');
    what = '검토 요청';
  } else if (from === 'review' && to === 'draft') { if (!approver) throw new HttpError(403, '반려는 품질책임자·관리자가 합니다.'); if (!reason) throw bad('반려 사유를 적으세요.'); what = '반려'; }
  else if (from === 'review' && to === 'approved') {
    if (!approver) throw new HttpError(403, '승인·배포는 품질책임자·관리자가 합니다.');
    if (!file.file) throw bad('문서 파일이 없습니다. 반려해 초안에서 파일을 올리세요.');
    const eff = prior.effective_date && prior.effective_date >= today() ? prior.effective_date : today();
    set.effective_date = eff; set.approved_by = user.name; set.approved_at = now(); set.next_review = prior.review_months ? calNextDue(eff, prior.review_months) : null;
    set.versions = JSON.stringify([...versions, { rev: prior.rev, file, summary: prior.summary || (prior.rev ? '' : '제정'), approved_by: user.name, approved_at: now(), effective_date: eff }]);
    what = prior.rev ? `Rev.${prior.rev} 개정 승인·배포` : '제정 승인·배포';
  } else if (from === 'approved' && to === 'draft') { set.rev = prior.rev + 1; set.summary = str(body.summary, 1000); set.change_id = optId(body.change_id) ?? prior.change_id; what = `Rev.${prior.rev + 1} 개정 시작`; }
  else throw bad(`「${QDOC_STATUS[from]}」에서 「${QDOC_STATUS[to] || to}」(으)로 갈 수 없습니다.`);
  const keys = Object.keys(set);
  const r = await db.prepare(`UPDATE quality_docs SET ${keys.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...keys.map(k => set[k]), pushHist(prior, { by: user.name, what, status: [from, to], ...(reason ? { reason } : {}) }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  const row = qdocRow(await mustGet('quality_docs', prior.id), user);
  return { ...row, training_suggest: to === 'approved' && !!prior.training_needed };
});
route('DELETE', '/api/qdocs/:id', async ({ user, params, query }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('quality_docs', params.id);
  if (Number(query.revision) !== prior.revision) throw conflict();
  if (JSON.parse(prior.versions || '[]').length) throw bad('승인·등록된 판이 있는 문서는 지울 수 없습니다. 폐지하세요.');
  const del = await db.prepare('DELETE FROM quality_docs WHERE id=? AND revision=?').run(prior.id, prior.revision); if (!del.changes) throw conflict();
  await qdocDropFile(JSON.parse(prior.file_json || '{}'), []); return { ok: true };
});

// A2 변경관리(4M + 설계·규격): 요청 → 영향평가 → 승인(품질책임자) → 적용(적용일·초물 LOT) → 검증완료. 누구나 요청, 진행은 품질.
const CHG_KIND = { man: '사람(Man)', machine: '설비(Machine)', material: '원자재(Material)', method: '방법(Method)', design: '설계', spec: '규격' };
const CHG_STATUS = { requested: '요청', evaluating: '영향평가', approved: '승인', applied: '적용', verified: '검증완료', rejected: '반려', void: '취소' };
const CHG_SOURCE = { internal: '직접 요청', capa: 'CAPA 조치', supplier: '협력업체 변경점' };
const CHG_IMPACT = { quality: '제품 품질·특성', customer: '고객 통보·승인(PCN)', docs: '문서 개정', validation: '재밸리데이션', training: '교육', inspection: '검사 기준·규격', stock: '재고·재공품 처리' };
const CHG_COLS = ['kind', 'title', 'item', 'reason', 'before_text', 'after_text', 'vendor', 'impact_json', 'plan_date', 'apply_date', 'first_lot', 'verify_date', 'verify_result', 'verify_note', 'owner_name'];
function chgBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const kind = pick('kind'); if (!CHG_KIND[kind]) throw bad('변경 유형(4M·설계·규격)을 고르세요.');
  let imp = pick('impact_json'); if (typeof imp === 'string') { try { imp = JSON.parse(imp || '{}'); } catch { imp = {}; } }
  imp = imp && typeof imp === 'object' && !Array.isArray(imp) ? Object.fromEntries(Object.keys(CHG_IMPACT).map(k => { const x = imp[k] || {}; const v = ['yes', 'no'].includes(x.v) ? x.v : ''; return [k, { v, note: str(x.note, 300) }]; }).filter(([, x]) => x.v || x.note)) : {};
  const f = { kind, title: reqStr(pick('title'), '변경 내용(제목)', 200), item: str(pick('item'), 200), reason: str(pick('reason'), 1000), before_text: str(pick('before_text'), 1000), after_text: str(pick('after_text'), 1000), vendor: str(pick('vendor'), 100),
    impact_json: JSON.stringify(imp), plan_date: qDate(pick('plan_date'), '적용 예정일'), apply_date: qDate(pick('apply_date'), '적용일'), first_lot: str(pick('first_lot'), 100),
    verify_date: qDate(pick('verify_date'), '검증일'), verify_result: pick('verify_result') || '', verify_note: str(pick('verify_note'), 1000), owner_name: str(pick('owner_name'), 50) };
  if (!['', '유효', '효과 없음'].includes(f.verify_result)) throw bad('검증 결과를 고르세요.');
  if (f.verify_date && f.apply_date && f.verify_date < f.apply_date) throw bad('검증일이 적용일보다 빠릅니다.');
  return f;
}
const chgRow = (r, links = {}) => ({ ...r, impact: JSON.parse(r.impact_json || '{}'), history: JSON.parse(r.history || '[]'), status_label: CHG_STATUS[r.status] || r.status, kind_label: CHG_KIND[r.kind] || r.kind, source_label: CHG_SOURCE[r.source_type] || r.source_type, docs: links.docs?.[r.id] || [], trainings: links.trainings?.[r.id] || [] });
function chgCheckStep(f, to, user) {
  const imp = JSON.parse(f.impact_json || '{}');
  if (['approved', 'applied', 'verified'].includes(to)) { const miss = Object.entries(CHG_IMPACT).filter(([k]) => !imp[k]?.v).map(([, l]) => l); if (miss.length) throw bad(`영향평가를 모두 「있음/없음」으로 골라야 승인합니다: ${miss.join(', ')}`); }
  if (to === 'approved' && !hasRole(user, 'quality_approver')) throw new HttpError(403, '변경 승인은 품질책임자·관리자가 합니다.');
  if (['applied', 'verified'].includes(to) && (!f.apply_date || !f.first_lot)) throw bad('적용일과 초물 LOT(변경 뒤 첫 LOT)를 넣어야 적용으로 갑니다.');
  if (to === 'verified' && (f.verify_result !== '유효' || !f.verify_date)) throw bad('적용 후 검증 결과가 「유효」이고 검증일이 있어야 검증완료합니다.');
}
const CHG_NEXT = { requested: ['evaluating'], evaluating: ['approved', 'requested'], approved: ['applied'], applied: ['verified'], verified: [], rejected: [], void: [] };
route('GET', '/api/changes', async ({ user }) => {
  const rows = await db.prepare("SELECT * FROM quality_changes ORDER BY CASE WHEN status IN ('verified','rejected','void') THEN 1 ELSE 0 END, id DESC LIMIT 1000").all();
  const docs = {}, trainings = {};
  for (const d of await db.prepare('SELECT id,doc_no,title,rev,status,change_id FROM quality_docs WHERE change_id IS NOT NULL').all()) (docs[d.change_id] ||= []).push({ id: d.id, doc_no: d.doc_no, title: d.title, rev: d.rev, status_label: QDOC_STATUS[d.status] });
  for (const t of await db.prepare("SELECT id,title,plan_date,status,change_id FROM trainings WHERE change_id IS NOT NULL AND status<>'void'").all()) (trainings[t.change_id] ||= []).push(t);
  return { rows: rows.map(r => chgRow(r, { docs, trainings })), can_manage: isQuality(user), can_approve: hasRole(user, 'quality_approver'), me: user.name, today: today() };
});
route('POST', '/api/changes', async ({ user, body }) => {
  const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM quality_changes WHERE request_id=?').get(key); if (old) return chgRow(old); }
  const st = CHG_SOURCE[body.source_type] ? body.source_type : 'internal'; let sid = null, sno = '', fill = {};
  if (st === 'capa') { const n = await mustGet('nonconformities', Number(body.source_id) || 0); sid = n.id; sno = n.nc_no; fill = { item: n.item, reason: `${n.nc_no} ${n.title} — 시정조치: ${n.corrective || ''}`.slice(0, 1000) }; }
  if (st === 'supplier' && !str(body.vendor, 100)) throw bad('협력업체 변경점은 업체(매입처)를 고르세요.');
  if (st !== 'internal' && !isQuality(user)) throw new HttpError(403, 'CAPA·협력업체 변경점의 변경 요청은 품질이 만듭니다.');
  const f = chgBody({ ...fill, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '' && v != null)) });
  const prefix = 'CHG-' + today().slice(2).replace(/-/g, '') + '-';
  const r = await db.prepare(`INSERT INTO quality_changes(change_no,source_type,source_id,source_no,${CHG_COLS.join(',')},requester_name,requester_id,history,request_id,created_by) VALUES(${nextDocNo('quality_changes', 'change_no')},?,?,?,${CHG_COLS.map(() => '?').join(',')},?,?,?,?,?)`)
    .run(prefix, prefix, prefix, st, sid, sno, ...CHG_COLS.map(k => f[k]), user.name, user.id, JSON.stringify([{ at: now(), by: user.name, what: '변경 요청', source: sno || CHG_SOURCE[st] }]), key, user.name);
  return chgRow(await mustGet('quality_changes', r.lastInsertRowid));
});
route('PUT', '/api/changes/:id', async ({ user, params, body }) => {
  const prior = await mustGet('quality_changes', params.id), q = isQuality(user), mine = prior.requester_id === user.id;
  if (!q && !(mine && prior.status === 'requested')) throw new HttpError(403, '요청한 사람은 「요청」 단계에서만 고칩니다. 그다음은 품질이 진행합니다.');
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (['verified', 'rejected', 'void'].includes(prior.status)) throw bad(`${CHG_STATUS[prior.status]}된 변경입니다.`);
  const lockedChg = ['approved', 'applied'].includes(prior.status); // 15.309 승인 뒤에는 내용·영향평가를 고칠 수 없음(다시 하려면 새 변경 요청)
  const f = chgBody(lockedChg ? Object.fromEntries(Object.entries(body).filter(([k]) => ['plan_date', 'apply_date', 'first_lot', 'verify_date', 'verify_result', 'verify_note', 'owner_name'].includes(k))) : body, prior), to = body.status && CHG_STATUS[body.status] ? body.status : prior.status, reason = str(body.reason, 300);
  if (to !== prior.status) {
    if (to === 'rejected') { if (!hasRole(user, 'quality_approver')) throw new HttpError(403, '반려는 품질책임자·관리자가 합니다.'); if (!reason) throw bad('반려 사유를 적으세요.'); }
    else if (to === 'void') { if (!reason) throw bad('취소 사유를 적으세요.'); if (!q && !mine) throw new HttpError(403, '요청한 사람이나 품질만 취소합니다.'); }
    else { if (!q) throw new HttpError(403, '변경 진행은 품질이 합니다.'); if (!CHG_NEXT[prior.status].includes(to)) throw bad(`「${CHG_STATUS[prior.status]}」에서 「${CHG_STATUS[to]}」(으)로 갈 수 없습니다.`); chgCheckStep(f, to, user); }
  }
  const changed = CHG_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null));
  if (!changed.length && to === prior.status) return chgRow(prior);
  const approving = to === 'approved' && prior.status !== 'approved';
  const r = await db.prepare(`UPDATE quality_changes SET ${CHG_COLS.map(k => k + '=?').join(',')},status=?,approved_by=CASE WHEN ?=1 THEN ? ELSE approved_by END,approved_at=CASE WHEN ?=1 THEN ? ELSE approved_at END,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...CHG_COLS.map(k => f[k]), to, approving ? 1 : 0, user.name, approving ? 1 : 0, now(), pushHist(prior, { by: user.name, what: to !== prior.status ? '단계' : '수정', ...(to !== prior.status ? { status: [prior.status, to] } : {}), fields: changed, ...(reason ? { reason } : {}) }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return chgRow(await mustGet('quality_changes', prior.id));
});

// A3 교육·자격. 교육: 계획 → 실시(실시일·시간·참석) → 평가완료(참석자 결과). 대상자는 본인이 「참석 확인」을 누를 수 있다.
const TR_KIND = ['OJT', '정기 교육', '직무 교육', '외부 교육', '문서 개정 교육', '법정 교육'];
const TR_STATUS = { planned: '계획', done: '실시', evaluated: '평가완료', void: '취소' };
const TR_COLS = ['title', 'kind', 'plan_date', 'done_date', 'hours', 'instructor', 'place', 'content', 'eval_method', 'doc_id', 'doc_label', 'change_id', 'note'];
async function trBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const kind = pick('kind'); if (!TR_KIND.includes(kind)) throw bad('교육 유형을 고르세요.');
  const hours = pick('hours'); const f = { title: reqStr(pick('title'), '교육명', 200), kind, plan_date: dateStr(pick('plan_date'), '교육 예정일'), done_date: qDate(pick('done_date'), '실시일'),
    hours: hours === '' || hours == null ? null : num(hours, '교육 시간'), instructor: str(pick('instructor'), 50), place: str(pick('place'), 100), content: str(pick('content'), 2000), eval_method: str(pick('eval_method'), 50),
    doc_id: optId(pick('doc_id')), doc_label: str(prior.doc_label, 200), change_id: optId(pick('change_id')), note: str(pick('note'), 1000) };
  if (f.hours != null && (f.hours <= 0 || f.hours > 200)) throw bad('교육 시간은 0~200시간으로 넣으세요.');
  if (f.doc_id !== (prior.doc_id ?? null)) { if (f.doc_id) { const d = await mustGet('quality_docs', f.doc_id); f.doc_label = `${d.doc_no} Rev.${d.rev} ${d.title}`.slice(0, 200); } else f.doc_label = ''; }
  return f;
}
async function trAttendees(list) {
  if (list == null) return null; if (!Array.isArray(list) || list.length > 300) throw bad('교육 대상자는 300명까지입니다.');
  const users = await db.prepare("SELECT id,name,department FROM users WHERE approval_status='approved'").all(), out = new Map();
  for (const a of list) {
    const o = typeof a === 'object' && a ? a : { user_name: a }; const u = users.find(x => x.id === Number(o.user_id)) || users.find(x => x.name === str(o.user_name, 50));
    const name = u ? u.name : reqStr(o.user_name, '대상자 이름', 50); if (out.has(name)) continue;
    const score = o.score === '' || o.score == null ? null : num(o.score, '점수'); if (score != null && (score < 0 || score > 100)) throw bad('점수는 0~100으로 넣으세요.');
    const result = ['', '이수', '미이수', '재교육'].includes(o.result || '') ? o.result || '' : (() => { throw bad('교육 결과를 고르세요.'); })();
    out.set(name, { user_id: u?.id ?? null, user_name: name, dept: u?.department || str(o.dept, 50), attended: o.attended === true || o.attended === 1 || o.attended === '1' ? 1 : 0, score, result, note: str(o.note, 300) });
  }
  return [...out.values()];
}
const trRow = (r, att = []) => ({ ...r, history: JSON.parse(r.history || '[]'), status_label: TR_STATUS[r.status] || r.status, attendees: att });
async function trList(where = '', args = []) {
  const rows = await db.prepare(`SELECT * FROM trainings ${where} ORDER BY plan_date DESC, id DESC LIMIT 2000`).all(...args);
  const att = await db.prepare('SELECT * FROM training_attendees ORDER BY id').all(), by = {};
  for (const a of att) (by[a.training_id] ||= []).push(a);
  return rows.map(r => trRow(r, by[r.id] || []));
}
// guard: 같은 batch 앞의 UPDATE가 revision을 올렸을 때만 대상자 표를 바꾼다(동시 수정이면 아무것도 바뀌지 않음).
async function trSaveAttendees(id, list, prior = [], guardRev = null, tok = '') {
  if (!list) return [];
  const gd = guardRev == null ? null : tokGuard('trainings', id, guardRev, tok), keep = new Set(list.map(a => a.user_name)), g = gd ? gd.sql : '1=1', ga = gd ? gd.args : [];
  return [
    ...prior.filter(a => !keep.has(a.user_name)).map(a => ({ sql: `DELETE FROM training_attendees WHERE id=? AND ${g}`, args: [a.id, ...ga] })),
    ...list.map(a => ({ sql: `INSERT INTO training_attendees(training_id,user_id,user_name,dept,attended,confirmed_at,score,result,note) SELECT ?,?,?,?,?,?,?,?,? WHERE ${g}
      ON CONFLICT(training_id,user_name) DO UPDATE SET user_id=excluded.user_id,dept=excluded.dept,attended=excluded.attended,confirmed_at=CASE WHEN excluded.attended=1 THEN COALESCE(training_attendees.confirmed_at,excluded.confirmed_at) ELSE NULL END,score=excluded.score,result=excluded.result,note=excluded.note`,
      args: [id, a.user_id, a.user_name, a.dept, a.attended, a.attended ? now() : null, a.score, a.result, a.note, ...ga] })),
  ];
}
route('GET', '/api/trainings', async ({ user }) => ({ rows: await trList(), can_manage: isQuality(user), me: user.name, today: today(), kinds: TR_KIND }));
route('POST', '/api/trainings', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM trainings WHERE request_id=?').get(key); if (old) return (await trList('WHERE id=?', [old.id]))[0]; }
  const f = await trBody(body), att = await trAttendees(body.attendees || []);
  const r = await db.prepare(`INSERT INTO trainings(${TR_COLS.join(',')},history,request_id,created_by) VALUES(${TR_COLS.map(() => '?').join(',')},?,?,?)`).run(...TR_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '계획 등록' }]), key, user.name);
  const id = Number(r.lastInsertRowid); const cmds = await trSaveAttendees(id, att); if (cmds.length) await db.batch(cmds);
  return (await trList('WHERE id=?', [id]))[0];
});
route('PUT', '/api/trainings/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('trainings', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (prior.status === 'void') throw bad('취소된 교육입니다.');
  const f = await trBody(body, prior), att = await trAttendees(body.attendees), oldAtt = await db.prepare('SELECT * FROM training_attendees WHERE training_id=?').all(prior.id);
  const to = body.status && TR_STATUS[body.status] ? body.status : prior.status, reason = str(body.reason, 300);
  if (to !== prior.status) {
    const list = att || oldAtt;
    if (to === 'void') { if (!reason) throw bad('취소 사유를 적으세요.'); }
    else if (to === 'done') { if (prior.status !== 'planned') throw bad('계획 단계에서만 실시로 넘깁니다.'); if (!f.done_date || !f.hours) throw bad('실시일과 교육 시간을 넣어야 실시로 넘깁니다.'); if (!list.some(a => a.attended)) throw bad('참석자를 한 명 이상 체크하세요.'); }
    else if (to === 'evaluated') { if (prior.status !== 'done') throw bad('실시한 교육만 평가완료합니다.'); const miss = list.filter(a => a.attended && !a.result).map(a => a.user_name); if (miss.length) throw bad(`참석자 결과(이수·미이수·재교육)를 모두 고르세요: ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? ' 외' : ''}`); }
    else throw bad('단계를 확인하세요.');
  }
  if (f.done_date && f.done_date > today()) throw bad('실시일이 오늘보다 늦습니다.');
  const changed = TR_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)), tok = randomHex(8);
  const r = await db.batch([{ sql: `UPDATE trainings SET ${TR_COLS.map(k => k + '=?').join(',')},status=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`,
    args: [...TR_COLS.map(k => f[k]), to, pushHist(prior, { by: user.name, what: to !== prior.status ? '단계' : '수정', ...(to !== prior.status ? { status: [prior.status, to] } : {}), fields: changed, ...(att ? { attendees: att.length } : {}), ...(reason ? { reason } : {}), tok }), user.name, prior.id, prior.revision] },
    ...(await trSaveAttendees(prior.id, att, oldAtt, prior.revision + 1, tok))]);
  if (!r[0].meta.changes) throw conflict();
  return (await trList('WHERE id=?', [prior.id]))[0];
});
route('POST', '/api/trainings/:id/attend', async ({ user, params }) => {
  const t = await mustGet('trainings', params.id); if (!['planned', 'done'].includes(t.status)) throw bad('계획·실시 중인 교육만 참석 확인합니다.');
  const a = await db.prepare('SELECT * FROM training_attendees WHERE training_id=? AND (user_id=? OR user_name=?)').get(t.id, user.id, user.name);
  if (!a) throw new HttpError(403, '이 교육의 대상자가 아닙니다. 품질 담당에게 대상자 추가를 요청하세요.');
  if (!a.attended) await db.batch([{ sql: 'UPDATE training_attendees SET attended=1,confirmed_at=? WHERE id=?', args: [now(), a.id] }, { sql: 'UPDATE trainings SET revision=revision+1 WHERE id=?', args: [t.id] }]); // 15.309 열려 있던 수정 창이 덮어쓰지 않게
  return (await trList('WHERE id=?', [t.id]))[0];
});
const QUAL_STATUS = { valid: '유효', expired: '만료', withdrawn: '반납·취소' };
const QUAL_COLS = ['user_id', 'user_name', 'kind', 'cert_no', 'issuer', 'acquired_date', 'expire_date', 'status', 'note'];
async function qualBody(o0) {
  const o = o0 && typeof o0 === 'object' ? o0 : {};
  const u = o.user_id ? await db.prepare('SELECT id,name FROM users WHERE id=?').get(Number(o.user_id)) : await db.prepare("SELECT id,name FROM users WHERE name=? AND approval_status='approved'").get(str(o.user_name, 50));
  const f = { user_id: u?.id ?? null, user_name: u?.name || reqStr(o.user_name, '대상자', 50), kind: reqStr(o.kind, '자격명', 100), cert_no: str(o.cert_no, 80), issuer: str(o.issuer, 100),
    acquired_date: qDate(o.acquired_date, '취득일'), expire_date: qDate(o.expire_date, '만료일'), status: QUAL_STATUS[o.status] ? o.status : 'valid', note: str(o.note, 500) };
  if (f.acquired_date && f.expire_date && f.expire_date <= f.acquired_date) throw bad('만료일은 취득일 뒤여야 합니다.');
  return f;
}
const qualRow = r => ({ ...r, history: JSON.parse(r.history || '[]'), status_label: QUAL_STATUS[r.status] || r.status });
route('GET', '/api/qualifications', async ({ user }) => ({ rows: (await db.prepare('SELECT * FROM qualifications ORDER BY CASE WHEN expire_date IS NULL THEN 1 ELSE 0 END, expire_date, id DESC LIMIT 2000').all()).map(qualRow), can_manage: isQuality(user), today: today() }));
route('POST', '/api/qualifications', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM qualifications WHERE request_id=?').get(key); if (old) return qualRow(old); }
  const f = await qualBody(body);
  const r = await db.prepare(`INSERT INTO qualifications(${QUAL_COLS.join(',')},history,request_id,created_by) VALUES(${QUAL_COLS.map(() => '?').join(',')},?,?,?)`).run(...QUAL_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '등록' }]), key, user.name);
  return qualRow(await mustGet('qualifications', r.lastInsertRowid));
});
route('PUT', '/api/qualifications/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('qualifications', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = await qualBody(body), changed = QUAL_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (!changed.length) return qualRow(prior);
  const r = await db.prepare(`UPDATE qualifications SET ${QUAL_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`).run(...QUAL_COLS.map(k => f[k]), pushHist(prior, { by: user.name, what: '수정', fields: changed }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return qualRow(await mustGet('qualifications', prior.id));
});
route('DELETE', '/api/qualifications/:id', async ({ user, params, query }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('qualifications', params.id);
  if (Number(query.revision) !== prior.revision) throw conflict();
  await db.prepare('DELETE FROM qualifications WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});

// A5 협력업체 품질: 매입처별 품질 카드. 수입검사 건수·불합격률(자동), 공급사 COA 수령(COA 요청 입고 중 미수령), 연 1회 유효성평가(품질 50%·납기 30%·대응 20% → A 90↑·B 80↑·C 70↑·D), 업체 변경점(→ 변경관리).
const vkey = s => String(s || '').toLowerCase().replace(/ /g, ''); // SQL LOWER(REPLACE(x,' ',''))와 같은 규칙
const SUP_GRADE = t => t >= 90 ? 'A' : t >= 80 ? 'B' : t >= 70 ? 'C' : 'D';
const IQC_BASE = "r.type='analysis' AND r.category='수입검사' AND COALESCE(json_extract(r.data,'$.exempt'),0)<>1";
async function supplierIqc(year, vendorKey = null) {
  const args = [String(year)]; if (vendorKey) args.push(vendorKey);
  return db.prepare(`SELECT LOWER(REPLACE(r.customer,' ','')) AS k, MAX(r.customer) AS vendor, COUNT(*) AS total, SUM(CASE WHEN m.result='fail' THEN 1 ELSE 0 END) AS fail, SUM(CASE WHEN m.result='pass' THEN 1 ELSE 0 END) AS pass,
    SUM(CASE WHEN json_extract(r.data,'$.coa_requested')=1 THEN 1 ELSE 0 END) AS coa_req, SUM(CASE WHEN json_extract(r.data,'$.coa_requested')=1 AND c.files IS NOT NULL AND c.files<>'[]' THEN 1 ELSE 0 END) AS coa_recv,
    SUM(CASE WHEN c.files IS NOT NULL AND c.files<>'[]' THEN 1 ELSE 0 END) AS coa_any
    FROM requests r LEFT JOIN inspection_measurements m ON m.request_id=r.id LEFT JOIN supplier_coas c ON c.inspection_id=r.id
    WHERE ${IQC_BASE} AND r.customer<>'' AND substr(r.created_at,1,4)=? ${vendorKey ? "AND LOWER(REPLACE(r.customer,' ',''))=?" : ''} GROUP BY k`).all(...args);
}
route('GET', '/api/supplier-quality', async ({ user, query }) => {
  const year = intIn(query.year, '연도', 2000, 2100, Number(today().slice(0, 4)));
  const vendors = await db.prepare('SELECT name FROM vendors WHERE is_purchase=1 ORDER BY name').all();
  const iqc = await supplierIqc(year), evals = await db.prepare('SELECT * FROM supplier_evals ORDER BY year DESC, id DESC').all();
  const changes = await db.prepare("SELECT vendor, status FROM quality_changes WHERE source_type='supplier'").all();
  const map = new Map();
  for (const v of vendors) map.set(vkey(v.name), { vendor: v.name });
  for (const x of iqc) if (!map.has(x.k)) map.set(x.k, { vendor: x.vendor });
  const rows = [...map.entries()].map(([k, v]) => {
    const s = iqc.find(x => x.k === k) || {}, ev = evals.filter(e => e.vendor_key === k), ch = changes.filter(c => vkey(c.vendor) === k);
    const total = s.total || 0, fail = s.fail || 0, judged = (s.fail || 0) + (s.pass || 0);
    return { key: k, vendor: v.vendor, iqc_total: total, iqc_fail: fail, iqc_judged: judged, fail_rate: judged ? Math.round(fail / judged * 1000) / 10 : null, coa_req: s.coa_req || 0, coa_recv: s.coa_recv || 0, coa_missing: (s.coa_req || 0) - (s.coa_recv || 0),
      eval: ev.find(e => e.year === year) || null, last_eval: ev[0] || null, changes_open: ch.filter(c => !['verified', 'rejected', 'void'].includes(c.status)).length, changes_total: ch.length };
  }).sort((a, b) => b.iqc_total - a.iqc_total || a.vendor.localeCompare(b.vendor, 'ko'));
  return { year, rows, can_manage: isQuality(user), today: today() };
});
route('GET', '/api/supplier-quality/detail', async ({ query }) => {
  const vendor = reqStr(query.vendor, '업체', 100), k = vkey(vendor);
  const insp = await db.prepare(`SELECT r.id,r.req_no,r.title,r.lot,r.status,r.created_at,r.customer,json_extract(r.data,'$.coa_requested') AS coa_requested,COALESCE(m.result,'pending') AS result,c.files AS coa_files,c.received_date AS coa_date
    FROM requests r LEFT JOIN inspection_measurements m ON m.request_id=r.id LEFT JOIN supplier_coas c ON c.inspection_id=r.id WHERE ${IQC_BASE} AND LOWER(REPLACE(r.customer,' ',''))=? ORDER BY r.id DESC LIMIT 200`).all(k);
  const evals = await db.prepare('SELECT * FROM supplier_evals WHERE vendor_key=? ORDER BY year DESC').all(k);
  const changes = (await db.prepare("SELECT * FROM quality_changes WHERE source_type='supplier' ORDER BY id DESC").all()).filter(c => vkey(c.vendor) === k).map(r => chgRow(r));
  return { vendor, inspections: insp.map(r => ({ ...r, coa_files: JSON.parse(r.coa_files || '[]') })), evals: evals.map(e => ({ ...e, history: JSON.parse(e.history || '[]') })), changes };
});
route('POST', '/api/supplier-evals', async ({ user, body }) => {
  requireRole(user, 'quality', '품질');
  const vendor = reqStr(body.vendor, '업체', 100), k = vkey(vendor), year = intIn(body.year, '평가 연도', 2000, 2100, Number(today().slice(0, 4)));
  const sc = (v, label) => { const n = num(v, label); if (n < 0 || n > 100) throw bad(`${label}는 0~100점으로 넣으세요.`); return Math.round(n * 10) / 10; };
  const q = sc(body.quality_score, '품질 점수'), d = sc(body.delivery_score, '납기 점수'), rs = sc(body.response_score, '대응 점수');
  const total = Math.round((q * 0.5 + d * 0.3 + rs * 0.2) * 10) / 10, grade = SUP_GRADE(total), s = (await supplierIqc(year, k))[0] || {};
  const prior = await db.prepare('SELECT * FROM supplier_evals WHERE vendor_key=? AND year=?').get(k, year);
  if (prior) {
    if (Number(body.revision) !== prior.revision) throw conflict();
    const r = await db.prepare("UPDATE supplier_evals SET vendor=?,quality_score=?,delivery_score=?,response_score=?,total=?,grade=?,iqc_total=?,iqc_fail=?,note=?,evaluated_by=?,evaluated_at=?,history=?,revision=revision+1 WHERE id=? AND revision=?")
      .run(vendor, q, d, rs, total, grade, s.total || 0, s.fail || 0, str(body.note, 1000), user.name, now(), pushHist(prior, { by: user.name, what: '재평가', from: [prior.total, prior.grade], to: [total, grade] }), prior.id, prior.revision);
    if (!r.changes) throw conflict();
    return db.prepare('SELECT * FROM supplier_evals WHERE id=?').get(prior.id);
  }
  const r = await db.prepare('INSERT INTO supplier_evals(vendor,vendor_key,year,quality_score,delivery_score,response_score,total,grade,iqc_total,iqc_fail,note,evaluated_by,evaluated_at,history) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(vendor_key,year) DO NOTHING')
    .run(vendor, k, year, q, d, rs, total, grade, s.total || 0, s.fail || 0, str(body.note, 1000), user.name, now(), JSON.stringify([{ at: now(), by: user.name, what: '평가', to: [total, grade] }]));
  if (!r.changes) throw conflict();
  return db.prepare('SELECT * FROM supplier_evals WHERE id=?').get(r.lastInsertRowid);
});
// 공급사 COA 수령: 수입검사 의뢰(입고 LOT) 하나에 파일 여러 개(최대 5).
async function iqcRequest(id) { const r = await getRequest(Number(id) || 0); if (r.type !== 'analysis' || r.category !== '수입검사') throw bad('수입검사 의뢰에만 공급사 COA를 붙입니다.'); return r; }
const scoaRow = (r, q) => ({ inspection_id: q.id, req_no: q.req_no, vendor: q.customer, item: q.title, lot: q.lot, coa_requested: !!JSON.parse(q.data || '{}').coa_requested, files: JSON.parse(r?.files || '[]'), received_date: r?.received_date || null, note: r?.note || '', revision: r?.revision || 0, updated_by: r?.updated_by || '', updated_at: r?.updated_at || null });
route('GET', '/api/supplier-coas/:id', async ({ params }) => { const q = await iqcRequest(params.id); return scoaRow(await db.prepare('SELECT * FROM supplier_coas WHERE inspection_id=?').get(q.id), q); });
route('PUT', '/api/supplier-coas/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const q = await iqcRequest(params.id), prior = await db.prepare('SELECT * FROM supplier_coas WHERE inspection_id=?').get(q.id);
  if (Number(body.revision || 0) !== (prior?.revision || 0)) throw conflict();
  const cur = JSON.parse(prior?.files || '[]'), keepNames = body.keep === undefined ? cur.map(x => x.file) : body.keep;
  if (!Array.isArray(keepNames) || keepNames.some(f => !cur.some(x => x.file === f))) throw bad('남길 파일을 다시 확인하세요.');
  const keep = cur.filter(x => keepNames.includes(x.file)); if (keep.length + (body.files || []).length > 5) throw bad('공급사 COA 파일은 5개까지입니다.');
  const added = await saveDocFiles(body.files, 5), files = [...keep, ...added], rd = qDate(body.received_date, '수령일') || (added.length ? today() : prior?.received_date || null);
  try {
    const r = prior
      ? await db.prepare("UPDATE supplier_coas SET files=?,received_date=?,note=?,vendor=?,item=?,lot=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?").run(JSON.stringify(files), rd, str(body.note, 500), q.customer, q.title, q.lot, user.name, prior.id, prior.revision)
      : await db.prepare('INSERT INTO supplier_coas(inspection_id,vendor,item,lot,files,received_date,note,updated_by) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(inspection_id) DO NOTHING').run(q.id, q.customer, q.title, q.lot, JSON.stringify(files), rd, str(body.note, 500), user.name);
    if (!r.changes) throw conflict();
  } catch (error) { await removePhotos(added.map(x => x.file)); throw error; }
  await removePhotos(cur.filter(x => !keepNames.includes(x.file)).map(x => x.file));
  return scoaRow(await db.prepare('SELECT * FROM supplier_coas WHERE inspection_id=?').get(q.id), q);
});
// ── 15.307 품질 3단계: 생산 › 공무(설비·예방보전) · 품질 › 공정품질(PQC·SPC) · 시험법·신뢰성 ──
// 설비·예방보전은 생산(담당·책임자)과 품질이 등록·수행 기록, 보기는 메뉴를 볼 수 있는 사람.
const addDaysISO = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const canPlant = user => hasRole(user, 'production') || hasRole(user, 'quality');
const requirePlant = user => { if (!canPlant(user)) throw new HttpError(403, '설비·예방보전은 생산·품질 담당이 기록합니다. (관리자에게 권한 요청)'); };
const EQ_STATUS = { running: '가동', maintenance: '정비 중', idle: '휴지', disposed: '폐기' };
const EQ_LOG_KIND = { pm: '예방보전(PM)', failure: '고장', repair: '수리', modify: '개조·이설', other: '기타' };
const PM_UNIT = { day: '일', week: '주', month: '개월', year: '년' };
const EQ_COLS = ['name', 'kind', 'unit_name', 'location', 'maker', 'model', 'serial_no', 'install_date', 'owner_name', 'status', 'pm_items', 'note'];
function pmNext(done, cycle, unit) {
  if (!done || !cycle) return null; const [y, m, d] = done.split('-').map(Number);
  if (unit === 'day' || unit === 'week') return new Date(Date.UTC(y, m - 1, d + cycle * (unit === 'week' ? 7 : 1))).toISOString().slice(0, 10);
  const months = unit === 'year' ? cycle * 12 : cycle, t = new Date(Date.UTC(y, m - 1 + months, d)); if (t.getUTCDate() !== d) t.setUTCDate(0); return t.toISOString().slice(0, 10);
}
function pmItems(list, prior = []) {
  if (list == null) return prior; if (!Array.isArray(list) || list.length > 30) throw bad('예방보전 항목은 30개까지입니다.');
  const keys = new Set();
  return list.map(x => {
    const o = x && typeof x === 'object' ? x : {}, old = prior.find(p => p.key === o.key) || {};
    const key = /^[a-f0-9]{8}$/.test(o.key || '') ? o.key : randomHex(4); if (keys.has(key)) throw bad('예방보전 항목이 겹칩니다.'); keys.add(key);
    const unit = PM_UNIT[o.unit] ? o.unit : 'month', cycle = intIn(o.cycle, 'PM 주기', 1, 999, 1);
    const checks = (Array.isArray(o.checks) ? o.checks : String(o.checks || '').split(/\n|,/)).map(c => str(c, 100)).filter(Boolean).slice(0, 30);
    const last = qDate(o.last_done === undefined ? old.last_done : o.last_done, 'PM 직전 수행일');
    let next = qDate(o.next_due === undefined ? old.next_due : o.next_due, 'PM 다음 예정일');
    if (!next || (last && (old.cycle !== cycle || old.unit !== unit || old.last_done !== last) && o.next_due === undefined)) next = pmNext(last, cycle, unit) || next || today();
    return { key, name: reqStr(o.name, 'PM 항목명', 100), cycle, unit, checks, last_done: last, next_due: next, owner: str(o.owner ?? old.owner, 50) };
  });
}
function eqBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const status = pick('status') || 'running'; if (!EQ_STATUS[status]) throw bad('설비 상태를 고르세요.');
  return { name: reqStr(pick('name'), '설비명', 100), kind: str(pick('kind'), 50), unit_name: str(pick('unit_name'), 50), location: str(pick('location'), 100), maker: str(pick('maker'), 100), model: str(pick('model'), 100), serial_no: str(pick('serial_no'), 100),
    install_date: qDate(pick('install_date'), '설치일'), owner_name: str(pick('owner_name'), 50), status, pm_items: JSON.stringify(pmItems(o.pm_items, JSON.parse(prior.pm_items || '[]'))), note: str(pick('note'), 1000) };
}
const eqRow = (r, stat = {}) => { const pm = JSON.parse(r.pm_items || '[]'); return { ...r, pm_items: pm, history: JSON.parse(r.history || '[]'), status_label: EQ_STATUS[r.status] || r.status, next_pm: pm.map(p => p.next_due).filter(Boolean).sort()[0] || null, ...stat }; };
async function eqStats() {
  const y = today().slice(0, 4), out = {};
  for (const s of await db.prepare("SELECT equipment_id, SUM(CASE WHEN kind='failure' AND substr(log_date,1,4)=? THEN 1 ELSE 0 END) AS fails, SUM(CASE WHEN kind IN ('failure','repair') AND substr(log_date,1,4)=? THEN COALESCE(downtime_hours,0) ELSE 0 END) AS downtime, SUM(CASE WHEN kind='pm' AND substr(log_date,1,4)=? THEN 1 ELSE 0 END) AS pms, MAX(log_date) AS last_log, COUNT(*) AS logs FROM equipment_logs GROUP BY equipment_id").all(y, y, y)) out[s.equipment_id] = { fails_year: s.fails, downtime_year: s.downtime, pm_year: s.pms, last_log: s.last_log, log_count: s.logs };
  return out;
}
route('GET', '/api/equipment', async ({ user }) => { const st = await eqStats(); return { rows: (await db.prepare("SELECT * FROM equipment ORDER BY CASE WHEN status='disposed' THEN 1 ELSE 0 END, equip_no LIMIT 3000").all()).map(r => eqRow(r, st[r.id] || { fails_year: 0, downtime_year: 0, pm_year: 0, last_log: null, log_count: 0 })), can_manage: canPlant(user), today: today() }; });
route('POST', '/api/equipment', async ({ user, body }) => {
  requirePlant(user); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM equipment WHERE request_id=?').get(key); if (old) return eqRow(old); }
  const f = eqBody(body), no = str(body.equip_no, 40).toUpperCase();
  if (no && await db.prepare('SELECT 1 FROM equipment WHERE equip_no=?').get(no)) throw bad(`이미 있는 설비번호입니다: ${no}`);
  const r = await db.prepare(`INSERT INTO equipment(equip_no,${EQ_COLS.join(',')},history,request_id,created_by) VALUES(${no ? '?' : nextDocNo('equipment', 'equip_no')},${EQ_COLS.map(() => '?').join(',')},?,?,?)`)
    .run(...(no ? [no] : ['EQ-', 'EQ-', 'EQ-']), ...EQ_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '등록' }]), key, user.name);
  return eqRow(await mustGet('equipment', r.lastInsertRowid));
});
route('PUT', '/api/equipment/:id', async ({ user, params, body }) => {
  requirePlant(user); const prior = await mustGet('equipment', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = eqBody(body, prior), no = body.equip_no === undefined ? prior.equip_no : reqStr(body.equip_no, '설비번호', 40).toUpperCase();
  if (no !== prior.equip_no && await db.prepare('SELECT 1 FROM equipment WHERE equip_no=? AND id<>?').get(no, prior.id)) throw bad(`이미 있는 설비번호입니다: ${no}`);
  const changed = EQ_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (no !== prior.equip_no) changed.push('equip_no'); if (!changed.length) return eqRow(prior);
  const r = await db.prepare(`UPDATE equipment SET equip_no=?,${EQ_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(no, ...EQ_COLS.map(k => f[k]), pushHist(prior, { by: user.name, what: '수정', fields: changed, ...(prior.status !== f.status ? { status: [prior.status, f.status] } : {}) }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return eqRow(await mustGet('equipment', prior.id));
});
route('DELETE', '/api/equipment/:id', async ({ user, params, query }) => {
  requirePlant(user); const prior = await mustGet('equipment', params.id);
  if (Number(query.revision) !== prior.revision) throw conflict();
  if (await db.prepare('SELECT 1 FROM equipment_logs WHERE equipment_id=?').get(prior.id)) throw bad('이력이 있는 설비는 지울 수 없습니다. 상태를 「폐기」로 바꾸세요.');
  await db.prepare('DELETE FROM equipment WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});
const eqLogRow = r => ({ ...r, checks: JSON.parse(r.checks || '[]'), kind_label: EQ_LOG_KIND[r.kind] || r.kind });
route('GET', '/api/equipment/:id/logs', async ({ params }) => { const e = await mustGet('equipment', params.id); return { equipment: eqRow(e), rows: (await db.prepare('SELECT * FROM equipment_logs WHERE equipment_id=? ORDER BY log_date DESC, id DESC LIMIT 500').all(e.id)).map(eqLogRow) }; });
// 이력 기록: PM 수행이면 점검표 결과로 정상/이상을 정하고 그 항목의 직전 수행일·다음 예정일을 넘긴다. 고장·수리는 비가동 시간·조치, 설비 상태도 함께 바꿀 수 있다.
route('POST', '/api/equipment/:id/logs', async ({ user, params, body }) => {
  requirePlant(user); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM equipment_logs WHERE request_id=?').get(key); if (old) return eqLogRow(old); }
  const e = await mustGet('equipment', params.id); if (Number(body.revision) !== e.revision) throw conflict();
  if (e.status === 'disposed') throw bad('폐기된 설비입니다.');
  const kind = EQ_LOG_KIND[body.kind] ? body.kind : null; if (!kind) throw bad('기록 종류를 고르세요.');
  const date = dateStr(body.log_date || today(), '일자'); if (date > today()) throw bad('일자가 오늘보다 늦습니다.');
  const num0 = (v, label) => v === '' || v == null ? null : (() => { const n = num(v, label); if (n < 0) throw bad(`${label}은(는) 0 이상으로 넣으세요.`); return n; })();
  const pm = JSON.parse(e.pm_items || '[]'); let item = null, checks = [], result = str(body.result, 20);
  if (kind === 'pm') {
    item = pm.find(p => p.key === body.pm_key); if (!item) throw bad('수행한 예방보전 항목을 고르세요.');
    checks = (Array.isArray(body.checks) ? body.checks : []).slice(0, 30).map(c => ({ item: str(c?.item, 100), ok: c?.ok === true || c?.ok === 1 || c?.ok === '1', note: str(c?.note, 200) })).filter(c => c.item);
    if (item.checks.length && item.checks.some(n => !checks.some(c => c.item === n))) throw bad('점검표 항목을 모두 확인하세요.');
    result = checks.some(c => !c.ok) ? '이상' : '정상';
  } else if (!str(body.description, 1000)) throw bad('내용(증상·작업)을 적으세요.');
  const status = body.status_after && EQ_STATUS[body.status_after] ? body.status_after : e.status;
  const tok = randomHex(8), gd = tokGuard('equipment', e.id, e.revision + 1, tok);
  const newPm = item ? pm.map(p => p.key === item.key && (!p.last_done || date >= p.last_done) ? { ...p, last_done: date, next_due: pmNext(date, p.cycle, p.unit) } : p) : pm;
  const results = await db.batch([
    { sql: "UPDATE equipment SET pm_items=?,status=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?",
      args: [JSON.stringify(newPm), status, pushHist(e, { by: user.name, what: `${EQ_LOG_KIND[kind]} 기록${item ? ' · ' + item.name : ''}`, ...(status !== e.status ? { status: [e.status, status] } : {}), tok }), user.name, e.id, e.revision] },
    { sql: `INSERT INTO equipment_logs(equipment_id,kind,log_date,pm_key,pm_name,checks,result,downtime_hours,description,action,parts,cost,worker_name,request_id,created_by) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gd.sql}`,
      args: [e.id, kind, date, item?.key || '', item?.name || '', JSON.stringify(checks), result, num0(body.downtime_hours, '비가동 시간'), str(body.description, 1000), str(body.action, 1000), str(body.parts, 300), num0(body.cost, '비용'), str(body.worker_name, 50) || user.name, key, user.name, ...gd.args] },
  ]);
  if (!results[0].meta.changes) throw conflict();
  return { ...eqRow(await mustGet('equipment', e.id)), log_result: result };
});

// C1 공정품질(PQC): 관리항목(공정 조건·환경측정 지점)과 측정값, SPC(X̄-R 또는 I-MR 관리도, Cp·Cpk). 기준은 품질이, 측정값은 생산·품질이 넣는다.
const PQC_KIND = { process: '공정 조건·측정', env: '환경측정' };
function ppBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const kind = pick('kind') || 'process'; if (!PQC_KIND[kind]) throw bad('구분을 고르세요.');
  const n = (v, l) => v === '' || v == null ? null : numS(v, l);
  const f = { kind, place: reqStr(pick('place'), kind === 'env' ? '측정 위치' : '공정', 100), item: reqStr(pick('item'), '관리항목', 100), unit: str(pick('unit'), 20), lsl: n(pick('lsl'), '하한'), usl: n(pick('usl'), '상한'), target: n(pick('target'), '목표'), cycle: str(pick('cycle'), 50), active: pick('active') === 0 || pick('active') === false || pick('active') === '0' ? 0 : 1, note: str(pick('note'), 500) };
  if (f.lsl == null && f.usl == null) throw bad('기준(하한 또는 상한)을 하나 이상 넣으세요.');
  if (f.lsl != null && f.usl != null && f.lsl >= f.usl) throw bad('하한은 상한보다 작아야 합니다.');
  return f;
}
const PP_COLS = ['kind', 'place', 'item', 'unit', 'lsl', 'usl', 'target', 'cycle', 'active', 'note'];
const outOf = (v, lsl, usl) => (lsl != null && v < lsl) || (usl != null && v > usl) ? 1 : 0;
route('GET', '/api/pqc/points', async ({ user }) => {
  const from = addDaysISO(today(), -30);
  const stats = await db.prepare('SELECT point_id, COUNT(*) AS n30, SUM(out_of_spec) AS out30, MAX(measured_on) AS last_on FROM process_measures WHERE measured_on>=? GROUP BY point_id').all(from);
  const lastV = await db.prepare('SELECT m.point_id, m.value, m.measured_on, m.out_of_spec FROM process_measures m WHERE m.id IN (SELECT MAX(id) FROM process_measures GROUP BY point_id)').all();
  return { rows: (await db.prepare('SELECT * FROM process_points ORDER BY active DESC, kind, place, item').all()).map(p => ({ ...p, kind_label: PQC_KIND[p.kind], ...(stats.find(s => s.point_id === p.id) || { n30: 0, out30: 0, last_on: null }), last: lastV.find(l => l.point_id === p.id) || null })),
    can_manage: isQuality(user), can_record: canPlant(user), today: today() };
});
route('POST', '/api/pqc/points', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const f = ppBody(body);
  if (await db.prepare('SELECT 1 FROM process_points WHERE kind=? AND place=? AND item=?').get(f.kind, f.place, f.item)) throw bad(`이미 있는 관리항목입니다: ${f.place} · ${f.item}`);
  const r = await db.prepare(`INSERT INTO process_points(${PP_COLS.join(',')},created_by) VALUES(${PP_COLS.map(() => '?').join(',')},?)`).run(...PP_COLS.map(k => f[k]), user.name);
  return mustGet('process_points', r.lastInsertRowid);
});
route('PUT', '/api/pqc/points/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('process_points', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = ppBody(body, prior);
  if (await db.prepare('SELECT 1 FROM process_points WHERE kind=? AND place=? AND item=? AND id<>?').get(f.kind, f.place, f.item, prior.id)) throw bad(`이미 있는 관리항목입니다: ${f.place} · ${f.item}`);
  const r = await db.prepare(`UPDATE process_points SET ${PP_COLS.map(k => k + '=?').join(',')},revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`).run(...PP_COLS.map(k => f[k]), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return mustGet('process_points', prior.id);
});
route('DELETE', '/api/pqc/points/:id', async ({ user, params, query }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('process_points', params.id);
  if (Number(query.revision) !== prior.revision) throw conflict();
  if (await db.prepare('SELECT 1 FROM process_measures WHERE point_id=?').get(prior.id)) throw bad('측정값이 있는 관리항목은 지울 수 없습니다. 「사용 안 함」으로 바꾸세요.');
  await db.prepare('DELETE FROM process_points WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});
route('GET', '/api/pqc/measures', async ({ query }) => {
  const where = [], args = [];
  if (query.point_id) { where.push('m.point_id=?'); args.push(Number(query.point_id) || 0); }
  if (query.kind && PQC_KIND[query.kind]) { where.push('p.kind=?'); args.push(query.kind); }
  if (query.from) { where.push('m.measured_on>=?'); args.push(dateStr(query.from, '시작일')); }
  if (query.to) { where.push('m.measured_on<=?'); args.push(dateStr(query.to, '종료일')); }
  if (query.out === '1') where.push('m.out_of_spec=1');
  applyListKeyword(where, args, query.q, ['p.place', 'p.item', 'm.lot', 'm.machine', 'm.measurer']);
  return { rows: await db.prepare(`SELECT m.*, p.kind, p.place, p.item, p.unit FROM process_measures m JOIN process_points p ON p.id=m.point_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.measured_on DESC, m.measured_time DESC, m.id DESC LIMIT 3000`).all(...args) };
});
route('POST', '/api/pqc/measures', async ({ user, body }) => {
  if (!canPlant(user)) throw new HttpError(403, '공정 측정값은 생산·품질 담당이 넣습니다.');
  const key = str(body.request_id, 80) || null;
  if (key && await db.prepare('SELECT 1 FROM process_measures WHERE request_id=?').get(key + ':0')) return { ok: true, saved: 0, repeated: true };
  const list = Array.isArray(body.rows) ? body.rows : []; if (!list.length || list.length > 300) throw bad('측정값을 1~300개 넣으세요.');
  const points = await db.prepare('SELECT * FROM process_points').all(), cmds = []; let out = 0;
  list.forEach((x, i) => {
    const p = points.find(q => q.id === Number(x?.point_id)); if (!p) throw bad(`${i + 1}번째 줄: 관리항목을 고르세요.`); if (!p.active) throw bad(`${p.place} · ${p.item}은(는) 사용 안 함입니다.`);
    const v = numS(x.value, `${p.item} 측정값`), d = dateStr(x.measured_on || today(), '측정일'); if (d > today()) throw bad('측정일이 오늘보다 늦습니다.');
    const o = outOf(v, p.lsl, p.usl); out += o;
    cmds.push({ sql: 'INSERT INTO process_measures(point_id,measured_on,measured_time,value,lsl,usl,out_of_spec,lot,machine,measurer,note,request_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      args: [p.id, d, /^\d{2}:\d{2}$/.test(x.measured_time || '') ? x.measured_time : '', v, p.lsl, p.usl, o, str(x.lot, 100), str(x.machine, 50), str(x.measurer, 50) || user.name, str(x.note, 300), key ? `${key}:${i}` : null, user.name] });
  });
  await db.batch(cmds);
  return { ok: true, saved: cmds.length, out_of_spec: out };
});
route('DELETE', '/api/pqc/measures/:id', async ({ user, params }) => {
  const m = await mustGet('process_measures', params.id);
  if (!isQuality(user) && !(m.created_by === user.name && String(m.created_at).slice(0, 10) === today())) throw new HttpError(403, '측정값은 품질이나, 넣은 사람이 그날 안에만 지웁니다.');
  await db.prepare('DELETE FROM process_measures WHERE id=?').run(m.id); return { ok: true };
});
// SPC: 같은 날(또는 같은 LOT) 값을 한 부분군으로. 부분군 크기가 2~10이면 X̄-R, 아니면(1개씩) I-MR 관리도. 표본 25개 미만이면 참고값.
const SPC_C = { 2: [1.880, 0, 3.267, 1.128], 3: [1.023, 0, 2.574, 1.693], 4: [0.729, 0, 2.282, 2.059], 5: [0.577, 0, 2.114, 2.326], 6: [0.483, 0, 2.004, 2.534], 7: [0.419, 0.076, 1.924, 2.704], 8: [0.373, 0.136, 1.864, 2.847], 9: [0.337, 0.184, 1.816, 2.970], 10: [0.308, 0.223, 1.777, 3.078] };
const r4 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000;
function spcCalc(values, groups, lsl, usl) {
  const n = values.length; if (n < 2) return { n, enough: false };
  const mean = values.reduce((s, v) => s + v, 0) / n, sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const sizes = groups.map(g => g.values.length), counts = {}; sizes.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  const mode = Math.min(10, Number(Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]));
  let chart, sigma;
  if (mode >= 2 && groups.filter(g => g.values.length >= mode).length >= 2) {
    const [A2, D3, D4, d2] = SPC_C[mode], sub = groups.filter(g => g.values.length >= mode).map(g => { const v = g.values.slice(0, mode); return { label: g.label, x: v.reduce((s, a) => s + a, 0) / mode, r: Math.max(...v) - Math.min(...v) }; });
    const xbb = sub.reduce((s, g) => s + g.x, 0) / sub.length, rb = sub.reduce((s, g) => s + g.r, 0) / sub.length; sigma = rb / d2;
    chart = { type: 'xbar-r', size: mode, points: sub, cl: xbb, ucl: xbb + A2 * rb, lcl: xbb - A2 * rb, r_cl: rb, r_ucl: D4 * rb, r_lcl: D3 * rb };
  } else {
    const pts = groups.flatMap(g => g.values.map(v => ({ label: g.label, x: v }))); pts.forEach((p, i) => { p.r = i ? Math.abs(p.x - pts[i - 1].x) : null; });
    const mrs = pts.slice(1).map(p => p.r), mrb = mrs.reduce((s, v) => s + v, 0) / (mrs.length || 1); sigma = mrb / 1.128;
    chart = { type: 'i-mr', size: 1, points: pts, cl: mean, ucl: mean + 2.66 * mrb, lcl: mean - 2.66 * mrb, r_cl: mrb, r_ucl: 3.267 * mrb, r_lcl: 0 };
  }
  const cap = s => !(s > 0) ? {} : { cp: lsl != null && usl != null ? (usl - lsl) / (6 * s) : null, cpu: usl != null ? (usl - mean) / (3 * s) : null, cpl: lsl != null ? (mean - lsl) / (3 * s) : null };
  const w = cap(sigma), o = cap(sd);
  const cpk = [w.cpu, w.cpl].filter(v => v != null), ppk = [o.cpu, o.cpl].filter(v => v != null);
  chart.out = chart.points.map((p, i) => (p.x > chart.ucl || p.x < chart.lcl || (p.r != null && p.r > chart.r_ucl)) ? i : -1).filter(i => i >= 0);
  for (const k of ['cl', 'ucl', 'lcl', 'r_cl', 'r_ucl', 'r_lcl']) chart[k] = r4(chart[k]); chart.points.forEach(p => { p.x = r4(p.x); p.r = r4(p.r); });
  return { n, enough: n >= 25, mean: r4(mean), sd: r4(sd), sigma: r4(sigma), cp: r4(w.cp), cpk: cpk.length ? r4(Math.min(...cpk)) : null, pp: r4(o.cp), ppk: ppk.length ? r4(Math.min(...ppk)) : null, out_of_spec: values.filter(v => outOf(v, lsl, usl)).length, chart };
}
route('GET', '/api/pqc/spc', async ({ query }) => {
  const p = await mustGet('process_points', Number(query.point_id) || 0), args = [p.id], where = ['point_id=?'];
  if (query.from) { where.push('measured_on>=?'); args.push(dateStr(query.from, '시작일')); }
  if (query.to) { where.push('measured_on<=?'); args.push(dateStr(query.to, '종료일')); }
  const rows = await db.prepare(`SELECT * FROM process_measures WHERE ${where.join(' AND ')} ORDER BY measured_on, measured_time, id LIMIT 5000`).all(...args);
  const by = query.group === 'lot' ? 'lot' : query.group === 'none' ? 'none' : 'day', groups = [];
  for (const m of rows) { const label = by === 'none' ? `${m.measured_on} ${m.measured_time}`.trim() : by === 'lot' ? m.lot || '(LOT 없음)' : m.measured_on; const g = by === 'none' ? null : groups.find(x => x.label === label); if (g) g.values.push(m.value); else groups.push({ label, values: [m.value] }); }
  return { point: p, group: by, ...spcCalc(rows.map(m => m.value), by === 'none' ? groups.map(g => ({ ...g })) : groups, p.lsl, p.usl) };
});

// C3 시험법·신뢰성(품질)
const TM_COLS = ['name', 'standard', 'items', 'conditions', 'instrument_ids', 'status', 'note'];
async function tmBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  let ids = pick('instrument_ids'); if (typeof ids === 'string') { try { ids = JSON.parse(ids || '[]'); } catch { ids = []; } }
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 20);
  for (const id of ids) if (!await db.prepare('SELECT 1 FROM instruments WHERE id=?').get(id)) throw bad('사용 계측기를 다시 고르세요.');
  const status = pick('status') || 'active'; if (!['active', 'obsolete'].includes(status)) throw bad('상태를 고르세요.');
  return { name: reqStr(pick('name'), '시험법 이름', 200), standard: str(pick('standard'), 200), items: str(pick('items'), 500), conditions: str(pick('conditions'), 2000), instrument_ids: JSON.stringify(ids), status, note: str(pick('note'), 1000) };
}
async function tmRows(where = '', args = []) {
  const inst = await db.prepare('SELECT id,mgmt_no,name,next_due,status FROM instruments').all();
  return (await db.prepare(`SELECT * FROM test_methods ${where} ORDER BY status, method_no LIMIT 2000`).all(...args)).map(r => { const ids = JSON.parse(r.instrument_ids || '[]'), f = JSON.parse(r.file_json || '{}'); const o = { ...r, instrument_ids: ids, instruments: ids.map(id => inst.find(i => i.id === id)).filter(Boolean), file: f.file ? f : null, history: JSON.parse(r.history || '[]') }; delete o.file_json; return o; });
}
route('GET', '/api/test-methods', async ({ user }) => ({ rows: await tmRows(), can_manage: isQuality(user), today: today() }));
route('POST', '/api/test-methods', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT id FROM test_methods WHERE request_id=?').get(key); if (old) return (await tmRows('WHERE id=?', [old.id]))[0]; }
  const f = await tmBody(body), no = str(body.method_no, 40).toUpperCase();
  if (no && await db.prepare('SELECT 1 FROM test_methods WHERE method_no=?').get(no)) throw bad(`이미 있는 시험법 번호입니다: ${no}`);
  const files = await saveDocFiles(body.files, 1);
  try {
    const r = await db.prepare(`INSERT INTO test_methods(method_no,${TM_COLS.join(',')},file_json,history,request_id,created_by) VALUES(${no ? '?' : nextDocNo('test_methods', 'method_no')},${TM_COLS.map(() => '?').join(',')},?,?,?,?)`)
      .run(...(no ? [no] : ['TM-', 'TM-', 'TM-']), ...TM_COLS.map(k => f[k]), JSON.stringify(files[0] || {}), JSON.stringify([{ at: now(), by: user.name, what: '제정 Rev.0' }]), key, user.name);
    return (await tmRows('WHERE id=?', [Number(r.lastInsertRowid)]))[0];
  } catch (error) { await removePhotos(files.map(x => x.file)); throw error; }
});
// 고치기. 「개정」(revise)으로 저장하면 판(Rev)이 하나 오르고 개정 내용이 이력에 남는다. SOP 파일을 바꾸면 이전 파일도 이력(보관)으로.
route('PUT', '/api/test-methods/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('test_methods', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = await tmBody(body, prior), oldFile = JSON.parse(prior.file_json || '{}'), files = await saveDocFiles(body.files, 1), file = files[0] || oldFile;
  try {
    const revise = !!body.revise, summary = str(body.summary, 300); if (revise && !summary) throw bad('개정 내용을 적으세요.');
    const changed = TM_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (file.file !== oldFile.file) changed.push('file');
    if (!changed.length && !revise) return (await tmRows('WHERE id=?', [prior.id]))[0];
    const r = await db.prepare(`UPDATE test_methods SET ${TM_COLS.map(k => k + '=?').join(',')},file_json=?,rev=rev+?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
      .run(...TM_COLS.map(k => f[k]), JSON.stringify(file), revise ? 1 : 0, pushHist(prior, { by: user.name, what: revise ? `개정 Rev.${prior.rev + 1}` : '수정', fields: changed, ...(summary ? { reason: summary } : {}), ...(file.file !== oldFile.file && oldFile.file ? { old_file: oldFile } : {}) }), user.name, prior.id, prior.revision);
    if (!r.changes) throw conflict();
    return (await tmRows('WHERE id=?', [prior.id]))[0];
  } catch (error) { await removePhotos(files.map(x => x.file)); throw error; }
});
const REL_STATUS = { planned: '계획', testing: '시험 중', done: '완료', void: '취소' };
const REL_COLS = ['title', 'item', 'lot', 'method_id', 'conditions', 'start_date', 'end_date', 'spec_json', 'points_json', 'owner_name', 'note'];
function relBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const parse = (v, d) => typeof v === 'string' ? (() => { try { return JSON.parse(v || d); } catch { return JSON.parse(d); } })() : v;
  const arr = v => Array.isArray(v) ? v : [];
  const spec = arr(parse(pick('spec_json'), '[]')).slice(0, 20).map(s => { const n = (v, l) => v === '' || v == null ? null : numS(v, l); const x = { name: reqStr(s?.name, '평가 항목', 100), unit: str(s?.unit, 20), min: n(s?.min, '하한'), max: n(s?.max, '상한') }; if (x.min != null && x.max != null && x.min > x.max) throw bad(`${x.name}: 하한이 상한보다 큽니다.`); return x; });
  const points = arr(parse(pick('points_json'), '[]')).slice(0, 30).map(p => ({ label: reqStr(p?.label, '측정 시점(예: 초기·500h)', 50), date: qDate(p?.date, '측정일'), values: spec.map((_, i) => { const v = Array.isArray(p?.values) ? p.values[i] : null; return v === '' || v == null ? null : numS(v, '측정값'); }) }));
  const f = { title: reqStr(pick('title'), '시험명', 200), item: str(pick('item'), 200), lot: str(pick('lot'), 100), method_id: optId(pick('method_id')), conditions: str(pick('conditions'), 1000), start_date: qDate(pick('start_date'), '시작일'), end_date: qDate(pick('end_date'), '종료일'), spec_json: JSON.stringify(spec), points_json: JSON.stringify(points), owner_name: str(pick('owner_name'), 50), note: str(pick('note'), 1000) };
  if (f.start_date && f.end_date && f.end_date < f.start_date) throw bad('종료일이 시작일보다 빠릅니다.');
  return f;
}
function relJudge(f) {
  const spec = JSON.parse(f.spec_json), points = JSON.parse(f.points_json), vals = points.flatMap(p => p.values.map((v, i) => [v, spec[i]])).filter(([v]) => v != null);
  if (!vals.length) return '';
  return vals.some(([v, s]) => (s.min != null && v < s.min) || (s.max != null && v > s.max)) ? '부적합' : '적합';
}
const relRow = r => ({ ...r, spec: JSON.parse(r.spec_json || '[]'), points: JSON.parse(r.points_json || '[]'), history: JSON.parse(r.history || '[]'), status_label: REL_STATUS[r.status] || r.status, judge_now: relJudge(r) });
route('GET', '/api/reliability', async ({ user }) => ({ rows: (await db.prepare("SELECT * FROM reliability_tests ORDER BY CASE WHEN status IN ('done','void') THEN 1 ELSE 0 END, id DESC LIMIT 1000").all()).map(relRow), can_manage: isQuality(user), today: today() }));
route('POST', '/api/reliability', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM reliability_tests WHERE request_id=?').get(key); if (old) return relRow(old); }
  const f = relBody(body); if (f.method_id) await mustGet('test_methods', f.method_id);
  const prefix = 'REL-' + today().slice(2).replace(/-/g, '') + '-';
  const r = await db.prepare(`INSERT INTO reliability_tests(test_no,${REL_COLS.join(',')},history,request_id,created_by) VALUES(${nextDocNo('reliability_tests', 'test_no')},${REL_COLS.map(() => '?').join(',')},?,?,?)`)
    .run(prefix, prefix, prefix, ...REL_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '계획 등록' }]), key, user.name);
  return relRow(await mustGet('reliability_tests', r.lastInsertRowid));
});
route('PUT', '/api/reliability/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('reliability_tests', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (['done', 'void'].includes(prior.status) && !(body.status && body.status !== prior.status && hasRole(user, 'quality_approver'))) throw bad(`${REL_STATUS[prior.status]}된 시험입니다. 다시 열려면 품질책임자가 상태를 바꾸세요.`);
  const f = relBody(body, prior), to = body.status && REL_STATUS[body.status] ? body.status : prior.status, reason = str(body.reason, 300);
  if (f.method_id && f.method_id !== prior.method_id) await mustGet('test_methods', f.method_id);
  let judge = prior.judge;
  if (to !== prior.status) {
    if (to === 'void') { if (!reason) throw bad('취소 사유를 적으세요.'); }
    else if (to === 'testing') { if (!f.start_date) f.start_date = today(); if (!JSON.parse(f.spec_json).length) throw bad('평가 항목·기준을 하나 이상 넣어야 시험을 시작합니다.'); }
    else if (to === 'done') { judge = relJudge(f); if (!judge) throw bad('측정값을 넣어야 완료합니다.'); if (!f.end_date) f.end_date = today(); }
    else if (to === 'planned' || to === 'testing') judge = '';
  }
  if (to === 'testing' && prior.status === 'done') judge = '';
  const changed = REL_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null));
  if (!changed.length && to === prior.status) return relRow(prior);
  const r = await db.prepare(`UPDATE reliability_tests SET ${REL_COLS.map(k => k + '=?').join(',')},status=?,judge=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...REL_COLS.map(k => f[k]), to, judge, pushHist(prior, { by: user.name, what: to !== prior.status ? '단계' : '수정', ...(to !== prior.status ? { status: [prior.status, to] } : {}), fields: changed, ...(judge !== prior.judge && judge ? { reason: `판정 ${judge}` } : {}), ...(reason ? { reason } : {}) }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return relRow(await mustGet('reliability_tests', prior.id));
});
// ── 15.308 품질 4단계: 심사(Audit) 관리 · 밸리데이션 · 품질목표·KPI · 리스크 관리 ──
// 부적합·CAPA를 다른 화면에서 만들 때(심사 지적 등) 같은 번호 규칙·검사로 넣는다.
async function ncCreate(user, src, fields, key = null) {
  const f = ncBody(fields), prefix = 'NC-' + today().slice(2).replace(/-/g, '') + '-';
  const r = await db.prepare(`INSERT INTO nonconformities(nc_no,source_type,source_id,source_no,${NC_COLS.join(',')},history,request_id,created_by) VALUES(${nextDocNo('nonconformities', 'nc_no')},?,?,?,${NC_COLS.map(() => '?').join(',')},?,?,?)`)
    .run(prefix, prefix, prefix, src.type, src.id ?? null, src.no || '', ...NC_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '등록', source: src.no || '' }]), key, user.name);
  return mustGet('nonconformities', r.lastInsertRowid);
}
// A4 심사: 계획 → 실시(실시일·체크리스트) → 시정 중(열린 지적이 있으면) → 종결(지적의 CAPA가 모두 종결·권고는 확인). 중·경 지적은 CAPA 자동 생성.
const AUD_KIND = { customer: '고객사 수검', internal: '내부심사', supplier: '협력사 심사', cert: '인증심사' };
const AUD_STATUS = { planned: '계획', done: '실시', correcting: '시정 중', closed: '종결', void: '취소' };
const FND_GRADE = { major: '중대(Major)', minor: '경미(Minor)', obs: '권고(관찰)' };
const AUD_COLS = ['title', 'kind', 'target', 'cert_id', 'plan_date', 'done_date', 'auditors', 'scope', 'checklist', 'summary'];
function audBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const kind = pick('kind'); if (!AUD_KIND[kind]) throw bad('심사 유형을 고르세요.');
  let cl = pick('checklist'); if (typeof cl === 'string') { try { cl = JSON.parse(cl || '[]'); } catch { cl = []; } }
  cl = (Array.isArray(cl) ? cl : []).slice(0, 100).map(x => ({ q: str(x?.q, 300), result: ['', '적합', '부적합', '관찰', '해당 없음'].includes(x?.result) ? x.result : '', note: str(x?.note, 300) })).filter(x => x.q);
  const f = { title: reqStr(pick('title'), '심사명', 200), kind, target: str(pick('target'), 100), cert_id: kind === 'cert' ? optId(pick('cert_id')) : null, plan_date: dateStr(pick('plan_date'), '심사 예정일'), done_date: qDate(pick('done_date'), '실시일'),
    auditors: str(pick('auditors'), 200), scope: str(pick('scope'), 1000), checklist: JSON.stringify(cl), summary: str(pick('summary'), 2000) };
  if (f.done_date && f.done_date > today()) throw bad('실시일이 오늘보다 늦습니다.');
  return f;
}
async function audRows(where = '', args = []) {
  const audits = await db.prepare(`SELECT * FROM quality_audits ${where} ORDER BY CASE WHEN status IN ('closed','void') THEN 1 ELSE 0 END, plan_date DESC, id DESC LIMIT 1000`).all(...args);
  const fs0 = await db.prepare('SELECT f.*, n.nc_no, n.status AS nc_status, n.due_date AS nc_due FROM audit_findings f LEFT JOIN nonconformities n ON n.id=f.nc_id ORDER BY f.id').all();
  const certs = await db.prepare('SELECT id, kind, cert_no FROM certifications').all();
  return audits.map(a => { const fnd = fs0.filter(f => f.audit_id === a.id).map(f => ({ ...f, grade_label: FND_GRADE[f.grade], closed: f.grade === 'obs' ? !!f.obs_done : f.nc_status === 'closed' || f.nc_status === 'void', nc_status_label: NC_STATUS[f.nc_status] || '' }));
    const c = certs.find(x => x.id === a.cert_id);
    return { ...a, checklist: JSON.parse(a.checklist || '[]'), files: JSON.parse(a.files || '[]'), history: JSON.parse(a.history || '[]'), kind_label: AUD_KIND[a.kind], status_label: AUD_STATUS[a.status], findings: fnd, open_findings: fnd.filter(f => !f.closed).length, cert_label: c ? `${c.kind} ${c.cert_no}`.trim() : '' }; });
}
const audOne = async id => (await audRows('WHERE id=?', [Number(id)]))[0] || (() => { throw new HttpError(404, '심사를 찾을 수 없습니다.'); })();
route('GET', '/api/audits', async ({ user }) => ({ rows: await audRows(), certs: (await db.prepare("SELECT id, kind, cert_no, next_audit FROM certifications WHERE status IN ('valid','suspended','prep') ORDER BY kind").all()), can_manage: isQuality(user), today: today() }));
route('POST', '/api/audits', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT id FROM quality_audits WHERE request_id=?').get(key); if (old) return audOne(old.id); }
  const f = audBody(body), prefix = 'AUD-' + today().slice(2).replace(/-/g, '') + '-';
  const r = await db.prepare(`INSERT INTO quality_audits(audit_no,${AUD_COLS.join(',')},history,request_id,created_by) VALUES(${nextDocNo('quality_audits', 'audit_no')},${AUD_COLS.map(() => '?').join(',')},?,?,?)`)
    .run(prefix, prefix, prefix, ...AUD_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '계획 등록' }]), key, user.name);
  return audOne(r.lastInsertRowid);
});
route('PUT', '/api/audits/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('quality_audits', params.id), cur = await audOne(prior.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (['closed', 'void'].includes(prior.status) && !(body.status && body.status !== prior.status && hasRole(user, 'quality_approver'))) throw bad(`${AUD_STATUS[prior.status]}된 심사입니다. 다시 열려면 품질책임자가 상태를 바꾸세요.`);
  const f = audBody(body, prior), reason = str(body.reason, 300);
  let to = body.status && AUD_STATUS[body.status] ? body.status : prior.status;
  if (to !== prior.status) {
    if (to === 'void') { if (!reason) throw bad('취소 사유를 적으세요.'); if (cur.findings.length) throw bad('지적사항이 있는 심사는 취소할 수 없습니다.'); }
    else if (to === 'done') { if (!f.done_date) f.done_date = today(); to = cur.open_findings ? 'correcting' : 'done'; }
    else if (to === 'closed') { if (!f.done_date) throw bad('실시한 심사만 종결합니다.'); if (cur.open_findings) throw bad(`열린 지적사항 ${cur.open_findings}건의 CAPA를 종결(권고는 「확인」)해야 심사를 종결합니다.`); }
    else if (to === 'planned' && !hasRole(user, 'quality_approver')) throw new HttpError(403, '다시 열기는 품질책임자가 합니다.');
  }
  const cur0 = JSON.parse(prior.files || '[]'), keepNames = body.keep_files === undefined ? cur0.map(x => x.file) : body.keep_files;
  if (!Array.isArray(keepNames) || keepNames.some(n => !cur0.some(x => x.file === n))) throw bad('남길 파일을 다시 확인하세요.');
  const keep = cur0.filter(x => keepNames.includes(x.file)); if (keep.length + (body.files || []).length > 10) throw bad('파일은 10개까지입니다.');
  const added = await saveDocFiles(body.files, 5), files = [...keep, ...added];
  try {
    const changed = AUD_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (added.length || keep.length !== cur0.length) changed.push('files');
    if (!changed.length && to === prior.status) return cur;
    const closing = to === 'closed' && prior.status !== 'closed';
    const r = await db.prepare(`UPDATE quality_audits SET ${AUD_COLS.map(k => k + '=?').join(',')},files=?,status=?,closed_by=CASE WHEN ?=1 THEN ? ELSE closed_by END,closed_at=CASE WHEN ?=1 THEN ? ELSE closed_at END,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
      .run(...AUD_COLS.map(k => f[k]), JSON.stringify(files), to, closing ? 1 : 0, user.name, closing ? 1 : 0, now(), pushHist(prior, { by: user.name, what: to !== prior.status ? '단계' : '수정', ...(to !== prior.status ? { status: [prior.status, to] } : {}), fields: changed, ...(reason ? { reason } : {}) }), user.name, prior.id, prior.revision);
    if (!r.changes) throw conflict();
  } catch (error) { await removePhotos(added.map(x => x.file)); throw error; }
  await removePhotos(cur0.filter(x => !keepNames.includes(x.file)).map(x => x.file));
  return audOne(prior.id);
});
route('POST', '/api/audits/:id/findings', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const a = await mustGet('quality_audits', params.id), key = str(body.request_id, 80) || null;
  if (key && await db.prepare('SELECT 1 FROM audit_findings WHERE request_id=?').get(key)) return audOne(a.id);
  if (['closed', 'void'].includes(a.status)) throw bad('종결·취소된 심사에는 지적을 더할 수 없습니다.');
  if (!FND_GRADE[body.grade]) throw bad('지적 등급(중대·경미·권고)을 고르세요.');
  const content = reqStr(body.content, '지적 내용', 1000), due = qDate(body.due_date, '시정 기한') || (body.grade === 'obs' ? null : addDaysISO(today(), body.grade === 'major' ? 30 : 60));
  let nc = null;
  if (body.grade !== 'obs') nc = await ncCreate(user, { type: 'audit', id: a.id, no: a.audit_no }, { kind: '심사 지적', grade: body.grade, title: `[${AUD_KIND[a.kind]}] ${content}`.slice(0, 200), detail: [str(body.clause, 100) && `조항 ${str(body.clause, 100)}`, a.target && `대상 ${a.target}`].filter(Boolean).join(' · '), owner_name: str(body.owner_name, 50), due_date: due, found_date: a.done_date || today() });
  await db.prepare('INSERT INTO audit_findings(audit_id,grade,clause,content,dept,due_date,nc_id,request_id,created_by) VALUES(?,?,?,?,?,?,?,?,?)').run(a.id, body.grade, str(body.clause, 100), content, str(body.dept, 50), due, nc?.id ?? null, key, user.name);
  for (let i = 0; i < 5; i++) { // 다른 사람이 심사를 고치는 중이면 다시 읽어서 이력을 덮어쓰지 않게
    const cur = await mustGet('quality_audits', a.id);
    const r = await db.prepare("UPDATE quality_audits SET status=CASE WHEN status='done' THEN 'correcting' ELSE status END,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?").run(pushHist(cur, { by: user.name, what: `지적 ${FND_GRADE[body.grade]}${nc ? ' → ' + nc.nc_no : ''}` }), user.name, a.id, cur.revision);
    if (r.changes) break;
  }
  return audOne(a.id);
});
route('PUT', '/api/audits/:id/findings/:fid', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const f = await db.prepare('SELECT * FROM audit_findings WHERE id=? AND audit_id=?').get(Number(params.fid), Number(params.id)); if (!f) throw new HttpError(404, '지적사항을 찾을 수 없습니다.');
  if (f.grade !== 'obs') throw bad('중대·경미 지적은 연결된 CAPA를 종결하면 닫힙니다.');
  await db.prepare('UPDATE audit_findings SET obs_done=? WHERE id=?').run(body.obs_done ? 1 : 0, f.id);
  return audOne(f.audit_id);
});

// A6 밸리데이션: 대상(설비·공정·시험법·기타)과 단계(IQ→OQ→PQ 등)별 수행·결과, 프로토콜·보고서 파일. 판정(적합·부적합)은 품질책임자, 적합이면 재밸리데이션 기한 = 판정일 + 주기.
const VAL_KIND = { equipment: '설비 적격성(IQ·OQ·PQ)', process: '공정 밸리데이션', method: '시험법 밸리데이션', cleaning: '세척 밸리데이션', system: '컴퓨터 시스템' };
const VAL_STATUS = { planned: '계획', running: '수행', pass: '적합', fail: '부적합', void: '취소' };
const VAL_COLS = ['title', 'kind', 'target_type', 'target_id', 'target_label', 'stages', 'criteria', 'cycle_months', 'change_id', 'owner_name'];
async function valBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const kind = pick('kind'); if (!VAL_KIND[kind]) throw bad('밸리데이션 종류를 고르세요.');
  const tt = ['equipment', 'method', 'process', 'other'].includes(pick('target_type')) ? pick('target_type') : 'process'; let tid = optId(pick('target_id')), label = str(pick('target_label'), 200);
  if (tt === 'equipment' && tid) { const e = await mustGet('equipment', tid); label = `${e.equip_no} ${e.name}`; }
  else if (tt === 'method' && tid) { const t = await mustGet('test_methods', tid); label = `${t.method_no} ${t.name}`; }
  else tid = null;
  if (!label) throw bad('대상(설비·시험법을 고르거나 공정·시스템 이름)을 넣으세요.');
  let st = pick('stages'); if (typeof st === 'string') { try { st = JSON.parse(st || '[]'); } catch { st = []; } }
  st = (Array.isArray(st) ? st : []).slice(0, 12).map(x => ({ key: reqStr(x?.key, '단계 이름', 50), plan_date: qDate(x?.plan_date, '단계 예정일'), done_date: qDate(x?.done_date, '단계 수행일'), result: ['', '적합', '부적합'].includes(x?.result) ? x.result : '', note: str(x?.note, 500) }));
  if (!st.length) throw bad('단계(IQ·OQ·PQ 등)를 하나 이상 넣으세요.');
  if (st.some(x => x.result && !x.done_date)) throw bad('결과를 넣은 단계는 수행일도 넣으세요.');
  return { title: reqStr(pick('title'), '밸리데이션 이름', 200), kind, target_type: tt, target_id: tid, target_label: label, stages: JSON.stringify(st), criteria: str(pick('criteria'), 2000), cycle_months: intIn(pick('cycle_months'), '재밸리데이션 주기(개월)', 0, 120, 0), change_id: optId(pick('change_id')), owner_name: str(pick('owner_name'), 50) };
}
async function valRows(where = '', args = []) {
  return (await db.prepare(`SELECT * FROM validations ${where} ORDER BY CASE WHEN status IN ('void') THEN 2 WHEN status IN ('pass','fail') THEN 1 ELSE 0 END, id DESC LIMIT 1000`).all(...args)).map(v => ({ ...v, stages: JSON.parse(v.stages || '[]'), files: JSON.parse(v.files || '[]'), history: JSON.parse(v.history || '[]'), kind_label: VAL_KIND[v.kind], status_label: VAL_STATUS[v.status] }));
}
const valOne = async id => (await valRows('WHERE id=?', [Number(id)]))[0] || (() => { throw new HttpError(404, '밸리데이션을 찾을 수 없습니다.'); })();
route('GET', '/api/validations', async ({ user }) => ({ rows: await valRows(), equipment: await db.prepare("SELECT id, equip_no, name FROM equipment WHERE status<>'disposed' ORDER BY equip_no").all(), methods: await db.prepare("SELECT id, method_no, name FROM test_methods WHERE status='active' ORDER BY method_no").all(), can_manage: isQuality(user), can_judge: hasRole(user, 'quality_approver'), today: today() }));
route('POST', '/api/validations', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT id FROM validations WHERE request_id=?').get(key); if (old) return valOne(old.id); }
  const f = await valBody(body); if (f.change_id) await mustGet('quality_changes', f.change_id);
  const prefix = 'VAL-' + today().slice(2).replace(/-/g, '') + '-', files = await saveDocFiles(body.files, 5);
  try {
    const r = await db.prepare(`INSERT INTO validations(val_no,${VAL_COLS.join(',')},files,history,request_id,created_by) VALUES(${nextDocNo('validations', 'val_no')},${VAL_COLS.map(() => '?').join(',')},?,?,?,?)`)
      .run(prefix, prefix, prefix, ...VAL_COLS.map(k => f[k]), JSON.stringify(files.map(x => ({ ...x, doc: str(body.file_doc, 20) || '프로토콜' }))), JSON.stringify([{ at: now(), by: user.name, what: '계획 등록' }]), key, user.name);
    return valOne(r.lastInsertRowid);
  } catch (error) { await removePhotos(files.map(x => x.file)); throw error; }
});
route('PUT', '/api/validations/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('validations', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (['pass', 'fail', 'void'].includes(prior.status)) throw bad(`${VAL_STATUS[prior.status]} 판정·취소된 밸리데이션입니다. 다시 하려면 「재밸리데이션」으로 새로 만드세요.`);
  const f = await valBody(body, prior), reason = str(body.reason, 300);
  let to = body.status === 'void' ? 'void' : prior.status; if (to === 'void' && !reason) throw bad('취소 사유를 적으세요.');
  if (to !== 'void' && JSON.parse(f.stages).some(x => x.done_date)) to = 'running';
  const cur0 = JSON.parse(prior.files || '[]'), keepNames = body.keep_files === undefined ? cur0.map(x => x.file) : body.keep_files;
  if (!Array.isArray(keepNames) || keepNames.some(n => !cur0.some(x => x.file === n))) throw bad('남길 파일을 다시 확인하세요.');
  const keep = cur0.filter(x => keepNames.includes(x.file)); if (keep.length + (body.files || []).length > 10) throw bad('파일은 10개까지입니다.');
  const added = (await saveDocFiles(body.files, 5)).map(x => ({ ...x, doc: ['프로토콜', '보고서', '데이터', '기타'].includes(body.file_doc) ? body.file_doc : '보고서' })), files = [...keep, ...added];
  try {
    const changed = VAL_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (added.length || keep.length !== cur0.length) changed.push('files');
    if (!changed.length && to === prior.status) return valOne(prior.id);
    const r = await db.prepare(`UPDATE validations SET ${VAL_COLS.map(k => k + '=?').join(',')},files=?,status=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
      .run(...VAL_COLS.map(k => f[k]), JSON.stringify(files), to, pushHist(prior, { by: user.name, what: to !== prior.status ? '단계' : '수정', ...(to !== prior.status ? { status: [prior.status, to] } : {}), fields: changed, ...(reason ? { reason } : {}) }), user.name, prior.id, prior.revision);
    if (!r.changes) throw conflict();
  } catch (error) { await removePhotos(added.map(x => x.file)); throw error; }
  await removePhotos(cur0.filter(x => !keepNames.includes(x.file)).map(x => x.file));
  return valOne(prior.id);
});
route('POST', '/api/validations/:id/judge', async ({ user, params, body }) => {
  if (!hasRole(user, 'quality_approver')) throw new HttpError(403, '밸리데이션 판정은 품질책임자·관리자가 합니다.');
  const prior = await mustGet('validations', params.id); if (Number(body.revision) !== prior.revision) throw conflict();
  if (!['planned', 'running'].includes(prior.status)) throw bad('이미 판정·취소된 밸리데이션입니다.');
  const st = JSON.parse(prior.stages || '[]'); if (st.some(x => !x.result)) throw bad('모든 단계의 결과(적합·부적합)를 넣어야 판정합니다.');
  const result = body.result === 'fail' ? 'fail' : 'pass'; if (result === 'pass' && st.some(x => x.result === '부적합')) throw bad('부적합 단계가 있어 「적합」으로 판정할 수 없습니다.');
  const until = result === 'pass' && prior.cycle_months ? calNextDue(today(), prior.cycle_months) : null;
  const r = await db.prepare("UPDATE validations SET status=?,judge_note=?,judged_by=?,judged_at=?,valid_until=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?")
    .run(result, str(body.note, 1000), user.name, now(), until, pushHist(prior, { by: user.name, what: '판정', status: [prior.status, result], ...(body.note ? { reason: str(body.note, 300) } : {}) }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return valOne(prior.id);
});

// M1 품질목표·KPI: 연도별 목표(지표·단위·방향·목표값)·전략·예산·개선계획, 월별 목표·실적. 자동 지표 4개는 실적을 매번 집계한다.
const KPI_METRIC = { iqc_fail_rate: { label: '수입검사 불합격률', unit: '%', direction: 'down' }, oqc_fail_rate: { label: '출하검사 불합격률', unit: '%', direction: 'down' }, voc_count: { label: 'VOC 건수', unit: '건', direction: 'down' }, capa_ontime: { label: 'CAPA 기한 준수율', unit: '%', direction: 'up' } };
const GOAL_STATUS = { plan: '계획', progress: '진행', achieved: '달성', missed: '미달' };
const GOAL_COLS = ['year', 'title', 'metric', 'unit', 'direction', 'target', 'strategy', 'plan', 'budget', 'owner_name', 'status', 'note'];
function goalBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const metric = pick('metric') || ''; if (metric && !KPI_METRIC[metric]) throw bad('자동 지표를 다시 고르세요.');
  const n = (v, l) => v === '' || v == null ? null : num(v, l);
  const f = { year: intIn(pick('year'), '연도', 2000, 2100, Number(today().slice(0, 4))), title: reqStr(pick('title'), '목표명', 200), metric, unit: metric ? KPI_METRIC[metric].unit : str(pick('unit'), 20), direction: metric ? KPI_METRIC[metric].direction : pick('direction') === 'up' ? 'up' : 'down',
    target: pick('target') === '' || pick('target') == null ? null : numS(pick('target'), '목표값'), strategy: str(pick('strategy'), 1000), plan: str(pick('plan'), 2000), budget: n(pick('budget'), '예산'), owner_name: str(pick('owner_name'), 50), status: GOAL_STATUS[pick('status')] ? pick('status') : 'plan', note: str(pick('note'), 1000) };
  if (f.budget != null && f.budget < 0) throw bad('예산은 0 이상으로 넣으세요.');
  return f;
}
// 자동 지표 월별 값: {m: {n, d}} → 비율은 n/d×100, 건수는 n
async function kpiAuto(metric, year) {
  const y = String(year), out = {};
  const put = rows => rows.forEach(r => { out[Number(r.m)] = { n: r.n || 0, d: r.d || 0 }; });
  if (metric === 'iqc_fail_rate' || metric === 'oqc_fail_rate') put(await db.prepare(`SELECT substr(r.created_at,6,2) AS m, SUM(CASE WHEN m.result='fail' THEN 1 ELSE 0 END) AS n, SUM(CASE WHEN m.result IN ('pass','fail') THEN 1 ELSE 0 END) AS d FROM requests r JOIN inspection_measurements m ON m.request_id=r.id WHERE r.type='analysis' AND r.category=? AND COALESCE(json_extract(r.data,'$.exempt'),0)<>1 AND substr(r.created_at,1,4)=? GROUP BY m`).all(metric === 'iqc_fail_rate' ? '수입검사' : '출하검사', y));
  else if (metric === 'voc_count') put(await db.prepare("SELECT substr(created_at,6,2) AS m, COUNT(*) AS n, 0 AS d FROM requests WHERE type='voc' AND substr(created_at,1,4)=? GROUP BY m").all(y));
  else if (metric === 'capa_ontime') put(await db.prepare("SELECT substr(closed_at,6,2) AS m, SUM(CASE WHEN due_date IS NULL OR substr(closed_at,1,10)<=due_date THEN 1 ELSE 0 END) AS n, COUNT(*) AS d FROM nonconformities WHERE status='closed' AND substr(closed_at,1,4)=? GROUP BY m").all(y));
  return out;
}
const kpiVal = (metric, x) => !x ? null : metric === 'voc_count' ? x.n : x.d ? Math.round(x.n / x.d * 1000) / 10 : null;
async function goalRows(year) {
  const goals = await db.prepare('SELECT * FROM quality_goals WHERE year=? ORDER BY id').all(year), vals = await db.prepare('SELECT v.* FROM quality_kpi_values v JOIN quality_goals g ON g.id=v.goal_id WHERE g.year=?').all(year), cache = {};
  const out = [];
  for (const g of goals) {
    const auto = g.metric ? (cache[g.metric] ||= await kpiAuto(g.metric, year)) : null;
    const months = Array.from({ length: 12 }, (_, i) => { const m = i + 1, v = vals.find(x => x.goal_id === g.id && x.month === m); return { m, target: v?.target ?? null, actual: auto ? kpiVal(g.metric, auto[m]) : v?.actual ?? null, base: auto?.[m] || null }; });
    let ytd = null;
    if (auto) { const t = Object.values(auto).reduce((s, x) => ({ n: s.n + x.n, d: s.d + x.d }), { n: 0, d: 0 }); ytd = kpiVal(g.metric, Object.keys(auto).length ? t : null); }
    else { const a = months.map(x => x.actual).filter(v => v != null); ytd = a.length ? (['건', '개', '회', '원', '件'].includes(g.unit) ? a.reduce((s, v) => s + v, 0) : Math.round(a.reduce((s, v) => s + v, 0) / a.length * 100) / 100) : null; }
    const met = ytd == null || g.target == null ? null : g.direction === 'up' ? ytd >= g.target : ytd <= g.target;
    out.push({ ...g, history: JSON.parse(g.history || '[]'), status_label: GOAL_STATUS[g.status], metric_label: KPI_METRIC[g.metric]?.label || '', months, ytd, met });
  }
  return out;
}
route('GET', '/api/kpi', async ({ user, query }) => { const year = intIn(query.year, '연도', 2000, 2100, Number(today().slice(0, 4))); return { year, rows: await goalRows(year), metrics: KPI_METRIC, can_manage: isQuality(user), today: today() }; });
route('POST', '/api/kpi/goals', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM quality_goals WHERE request_id=?').get(key); if (old) return old; }
  const f = goalBody(body);
  const r = await db.prepare(`INSERT INTO quality_goals(${GOAL_COLS.join(',')},history,request_id,created_by) VALUES(${GOAL_COLS.map(() => '?').join(',')},?,?,?)`).run(...GOAL_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '등록' }]), key, user.name);
  return mustGet('quality_goals', r.lastInsertRowid);
});
route('PUT', '/api/kpi/goals/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('quality_goals', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = goalBody(body, prior), changed = GOAL_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null));
  let values = null;
  if (body.values !== undefined) { if (!Array.isArray(body.values) || body.values.length > 12) throw bad('월별 값을 확인하세요.'); values = body.values.map(v => { const m = intIn(v?.month, '월', 1, 12, null); if (m == null) throw bad('월(1~12)을 넣으세요.'); const n = (x, l) => x === '' || x == null ? null : numS(x, l); return { m, target: n(v.target, `${m}월 목표`), actual: f.metric ? null : n(v.actual, `${m}월 실적`) }; }); }
  if (!changed.length && !values) return prior;
  const tok = randomHex(8), gd = tokGuard('quality_goals', prior.id, prior.revision + 1, tok);
  const results = await db.batch([
    { sql: `UPDATE quality_goals SET ${GOAL_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`, args: [...GOAL_COLS.map(k => f[k]), pushHist(prior, { by: user.name, what: values ? '월별 값·수정' : '수정', fields: changed, tok }), user.name, prior.id, prior.revision] },
    ...(values || []).map(v => ({ sql: `INSERT INTO quality_kpi_values(goal_id,month,target,actual,updated_by) SELECT ?,?,?,?,? WHERE ${gd.sql} ON CONFLICT(goal_id,month) DO UPDATE SET target=excluded.target,actual=excluded.actual,updated_by=excluded.updated_by,updated_at=datetime('now','+9 hours')`, args: [prior.id, v.m, v.target, v.actual, user.name, ...gd.args] })),
  ]);
  if (!results[0].meta.changes) throw conflict();
  return mustGet('quality_goals', prior.id);
});
route('DELETE', '/api/kpi/goals/:id', async ({ user, params, query }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('quality_goals', params.id);
  if (Number(query.revision) !== prior.revision) throw conflict();
  await db.batch([{ sql: 'DELETE FROM quality_kpi_values WHERE goal_id=? AND EXISTS(SELECT 1 FROM quality_goals WHERE id=? AND revision=?)', args: [prior.id, prior.id, prior.revision] }, { sql: 'DELETE FROM quality_goals WHERE id=? AND revision=?', args: [prior.id, prior.revision] }]);
  return { ok: true };
});

// M2 리스크 관리: 위험·기회, 발생가능성×영향도(1~5) = 점수(15↑ 상 · 8↑ 중 · 하), 대응계획·담당·기한, 재평가. 식별 → 대응 중(계획·담당 필요) → 종결(재평가 필요).
const RISK_STATUS = { identified: '식별', acting: '대응 중', closed: '종결' };
const RISK_COLS = ['kind', 'area', 'content', 'cause', 'likelihood', 'impact', 'plan', 'owner_name', 'due_date', 're_likelihood', 're_impact', 'review_date', 'next_review', 'note'];
const riskGrade = s => s >= 15 ? '상' : s >= 8 ? '중' : '하';
function riskBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const sc = (v, l, req = true) => v === '' || v == null ? (req ? (() => { throw bad(`${l}(1~5)을 고르세요.`); })() : null) : intIn(v, l, 1, 5, null);
  return { kind: pick('kind') === 'opportunity' ? 'opportunity' : 'risk', area: str(pick('area'), 50), content: reqStr(pick('content'), '리스크 내용', 500), cause: str(pick('cause'), 1000), likelihood: sc(pick('likelihood'), '발생가능성'), impact: sc(pick('impact'), '영향도'),
    plan: str(pick('plan'), 1000), owner_name: str(pick('owner_name'), 50), due_date: qDate(pick('due_date'), '대응 기한'), re_likelihood: sc(pick('re_likelihood'), '재평가 발생가능성', false), re_impact: sc(pick('re_impact'), '재평가 영향도', false), review_date: qDate(pick('review_date'), '재평가일'), next_review: qDate(pick('next_review'), '다음 재평가일'), note: str(pick('note'), 1000) };
}
const riskRow = r => { const s = r.likelihood * r.impact, rs = r.re_likelihood && r.re_impact ? r.re_likelihood * r.re_impact : null; return { ...r, history: JSON.parse(r.history || '[]'), score: s, grade: riskGrade(s), re_score: rs, re_grade: rs ? riskGrade(rs) : '', status_label: RISK_STATUS[r.status], kind_label: r.kind === 'opportunity' ? '기회' : '위험' }; };
route('GET', '/api/risks', async ({ user }) => ({ rows: (await db.prepare("SELECT * FROM quality_risks ORDER BY CASE WHEN status='closed' THEN 1 ELSE 0 END, likelihood*impact DESC, id DESC LIMIT 2000").all()).map(riskRow), can_manage: isQuality(user), today: today() }));
route('POST', '/api/risks', async ({ user, body }) => {
  requireRole(user, 'quality', '품질'); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM quality_risks WHERE request_id=?').get(key); if (old) return riskRow(old); }
  const f = riskBody(body);
  const r = await db.prepare(`INSERT INTO quality_risks(risk_no,${RISK_COLS.join(',')},history,request_id,created_by) VALUES(${nextDocNo('quality_risks', 'risk_no')},${RISK_COLS.map(() => '?').join(',')},?,?,?)`).run('RSK-', 'RSK-', 'RSK-', ...RISK_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '식별' }]), key, user.name);
  return riskRow(await mustGet('quality_risks', r.lastInsertRowid));
});
route('PUT', '/api/risks/:id', async ({ user, params, body }) => {
  requireRole(user, 'quality', '품질'); const prior = await mustGet('quality_risks', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = riskBody(body, prior), to = body.status && RISK_STATUS[body.status] ? body.status : prior.status;
  if (prior.status === 'closed' && to === 'closed') throw bad('종결된 리스크입니다. 다시 열려면 상태를 「대응 중」으로 바꾸세요.');
  if (to === 'acting' && prior.status !== 'acting' && (!f.plan || !f.owner_name)) throw bad('대응계획과 담당을 넣어야 「대응 중」으로 갑니다.');
  if (to === 'closed' && prior.status !== 'closed' && (!f.re_likelihood || !f.re_impact || !f.review_date)) throw bad('재평가(대응 후 발생가능성·영향도·재평가일)를 넣어야 종결합니다.');
  const changed = RISK_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (!changed.length && to === prior.status) return riskRow(prior);
  const r = await db.prepare(`UPDATE quality_risks SET ${RISK_COLS.map(k => k + '=?').join(',')},status=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...RISK_COLS.map(k => f[k]), to, pushHist(prior, { by: user.name, what: to !== prior.status ? '단계' : '수정', ...(to !== prior.status ? { status: [prior.status, to] } : {}), fields: changed }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return riskRow(await mustGet('quality_risks', prior.id));
});
// ── 15.313 생산 › 위험성평가 ──
// 작업 위험성평가(KOSHA 「사업장 위험성평가에 관한 지침」 2023: 유해·위험요인 파악 → 위험성 결정 → 감소대책 → 공유) · 공정 FMEA(AIAG-VDA 2019, AP=조치 우선순위) · HAZOP(IEC 61882: 노드 · 변수 × 가이드워드 = 이탈).
// 평가서 한 건(risk_assessments)에 워크시트 줄(rows JSON). 작성 → 검토 요청 → 승인(생산·품질 책임자) → 개정(Rev+1)·폐지. 작성 중에만 워크시트를 고치고,
// 승인 뒤에도 줄마다 개선 조치 결과(완료일·조치 후 재평가)는 기록한다. 허용할 수 없는 위험(높음·보통, FMEA는 AP 높음)은 감소대책·담당·기한이 있어야 검토 요청·승인된다.
const RA_METHOD = { kosha: '작업 위험성평가', fmea: '공정 FMEA', hazop: 'HAZOP' };
const RA_STATUS = { draft: '작성', review: '검토 요청', approved: '승인', obsolete: '폐지' };
const RA_KIND = { initial: '최초평가', regular: '정기평가', adhoc: '수시평가', continuous: '상시평가' };
const RA_HAZARD = { machine: '기계적 요인', electric: '전기적 요인', chemical: '화학(물질)적 요인', bio: '생물학적 요인', work: '작업특성 요인', env: '작업환경 요인', other: '기타' };
const RA_GRADE = { H: '높음', M: '보통', L: '낮음' };
const RA_PREFIX = { kosha: 'RA-', fmea: 'FMEA-', hazop: 'HZ-' };
const RA_COLS = ['title', 'kind', 'scale', 'process', 'item', 'equipment_id', 'scope', 'team', 'assess_date', 'next_review', 'rows', 'summary'];
const canRaApprove = user => !!user.is_admin || publicUser(user).roles.some(r => r === 'production_approver' || r === 'quality_approver');
// AIAG-VDA FMEA 핸드북(2019) 공정 FMEA AP 표: 심각도 → 발생도 → 검출도 순으로 무게. H는 조치(또는 현 관리로 충분한 근거) 필수, M은 조치 권장, L은 선택.
function fmeaAP(s, o, d) {
  if (!s || !o || !d) return null;
  if (s >= 9) { if (o >= 6) return 'H'; if (o >= 4) return d >= 2 ? 'H' : 'M'; if (o >= 2) return d >= 7 ? 'H' : d >= 5 ? 'M' : 'L'; return 'L'; }
  if (s >= 7) { if (o >= 8) return 'H'; if (o >= 6) return d >= 2 ? 'H' : 'M'; if (o >= 4) return d >= 7 ? 'H' : 'M'; if (o >= 2) return d >= 5 ? 'M' : 'L'; return 'L'; }
  if (s >= 4) { if (o >= 8) return d >= 5 ? 'H' : 'M'; if (o >= 6) return d >= 2 ? 'M' : 'L'; if (o >= 4) return d >= 7 ? 'M' : 'L'; return 'L'; }
  if (s >= 2) return o >= 8 && d >= 5 ? 'M' : 'L';
  return 'L';
}
// 위험성 = 가능성(빈도) × 중대성(강도). 3×3: 6~9 높음 · 3~4 보통 · 1~2 낮음(허용). 5×5(HAZOP 포함): 15~25 높음 · 8~12 보통 · 1~6 낮음. scale 1 = 3단계 판단법(상·중·하 직접 고름).
function raScore(method, scale, r, after = false) {
  const k = after ? '2' : '';
  if (method === 'fmea') { const s = r['s' + k], o = r['o' + k], d = r['d' + k]; return s && o && d ? { score: s * o * d, grade: fmeaAP(s, o, d) } : { score: null, grade: null }; }
  if (method === 'kosha' && scale === 1) return { score: null, grade: r['lvl' + k] || null };
  const a = method === 'hazop' ? r['l' + k] : r['f' + k], b = r['s' + k]; if (!a || !b) return { score: null, grade: null };
  const s = a * b; return { score: s, grade: (method === 'kosha' && scale === 3) ? (s >= 6 ? 'H' : s >= 3 ? 'M' : 'L') : (s >= 15 ? 'H' : s >= 8 ? 'M' : 'L') };
}
const raNeedsAction = (method, g) => method === 'fmea' ? g === 'H' : g === 'H' || g === 'M';
function raRowsClean(method, scale, list, prior = [], { base = 0, lockDone = false } = {}) {
  if (!Array.isArray(list)) throw bad('워크시트 줄이 올바르지 않습니다.'); if (list.length > 300) throw bad('워크시트 줄은 300개까지입니다.');
  const max = method === 'fmea' ? 10 : method === 'hazop' ? 5 : scale === 5 ? 5 : 3, keys = new Set();
  const rate = (v, label, hi = max) => intIn(v, label, 1, hi, null), lvl = v => v === '' || v == null ? null : ['H', 'M', 'L'].includes(v) ? v : (() => { throw bad('위험성 수준(상·중·하)을 고르세요.'); })();
  return list.map((x, i) => {
    const o = x && typeof x === 'object' ? x : {}, key = /^[a-f0-9]{8}$/.test(o.key || '') ? o.key : randomHex(4), old = prior.find(p => p.key === key) || {};
    if (keys.has(key)) throw bad('워크시트 줄이 겹칩니다.'); keys.add(key);
    const n = `${base + i + 1}번 줄 `, row = { key };
    if (method === 'kosha') {
      Object.assign(row, { task: str(o.task, 200), cat: RA_HAZARD[o.cat] ? o.cat : 'other', hazard: reqStr(o.hazard, n + '유해·위험요인', 500), basis: str(o.basis, 200), current: str(o.current, 500) });
      if (scale === 1) Object.assign(row, { lvl: lvl(o.lvl), lvl2: lvl(o.lvl2) }); else Object.assign(row, { f: rate(o.f, n + '가능성(빈도)'), s: rate(o.s, n + '중대성(강도)'), f2: rate(o.f2, n + '개선 후 가능성'), s2: rate(o.s2, n + '개선 후 중대성') });
    } else if (method === 'fmea') {
      Object.assign(row, { step: str(o.step, 200), func: str(o.func, 300), mode: reqStr(o.mode, n + '고장 모드', 300), effect: str(o.effect, 300), cls: ['CC', 'SC'].includes(o.cls) ? o.cls : '', cause: str(o.cause, 300), prevent: str(o.prevent, 300), detect: str(o.detect, 300),
        s: rate(o.s, n + '심각도(S)'), o: rate(o.o, n + '발생도(O)'), d: rate(o.d, n + '검출도(D)'), s2: rate(o.s2, n + '조치 후 S'), o2: rate(o.o2, n + '조치 후 O'), d2: rate(o.d2, n + '조치 후 D') });
    } else {
      const param = str(o.param, 30), guide = str(o.guide, 40);
      Object.assign(row, { node: str(o.node, 100), param, guide, dev: str(o.dev, 200) || [param, guide].filter(Boolean).join(' '), cause: str(o.cause, 500), cons: str(o.cons, 500), safeguard: str(o.safeguard, 500),
        s: rate(o.s, n + '심각도'), l: rate(o.l, n + '가능성'), s2: rate(o.s2, n + '조치 후 심각도'), l2: rate(o.l2, n + '조치 후 가능성') });
      if (!row.dev) throw bad(n + '이탈(변수 + 가이드워드)을 넣으세요.');
    }
    Object.assign(row, { action: str(o.action, 1000), owner: str(o.owner, 50), due: qDate(o.due, n + '조치 기한'), done: qDate(o.done, n + '완료일'), nc_id: old.nc_id ?? null, nc_no: old.nc_no || '', result: str(o.result ?? old.result, 500) });
    row.done_by = row.done && old.done === row.done ? old.done_by || '' : '';
    // 15.315 워크시트 저장(PUT)으로는 조치 완료·조치 후 재평가를 바꾸지 않음(「조치 결과」에서만, 잔여 위험 확인을 거치게)
    if (lockDone) for (const k of ['done', 'done_by', 'result', 'f2', 's2', 'o2', 'd2', 'l2', 'lvl2']) if (k in row || k in old) row[k] = old[k] ?? (k === 'done_by' || k === 'result' ? '' : null);
    if (row.done && row.done > today()) throw bad(n + '완료일이 오늘보다 늦습니다.');
    return row;
  });
}
function raCheck(ra, rows) {
  if (!rows.length) throw bad('워크시트에 줄을 하나 이상 넣으세요.');
  rows.forEach((r, i) => {
    const b = raScore(ra.method, ra.scale, r); if (!b.grade) throw bad(`${i + 1}번 줄 위험성(평가 점수)을 넣으세요.`);
    if (raNeedsAction(ra.method, b.grade) && (!r.action || !r.owner || !r.due)) throw bad(`${i + 1}번 줄은 ${ra.method === 'fmea' ? 'AP 높음' : `위험성 「${RA_GRADE[b.grade]}」`}이라 감소대책·담당·기한을 넣어야 합니다.`);
  });
  if (!ra.assess_date) throw bad('평가일을 넣으세요.');
}
function raBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const method = prior.method || (RA_METHOD[o.method] ? o.method : null); if (!method) throw bad('평가 방법(작업 위험성평가·FMEA·HAZOP)을 고르세요.');
  const scale = method === 'kosha' ? [1, 3, 5].includes(Number(pick('scale'))) ? Number(pick('scale')) : 3 : method === 'fmea' ? 10 : 5;
  const kind = RA_KIND[pick('kind')] ? pick('kind') : 'regular';
  const rows = raRowsClean(method, scale, o.rows === undefined ? JSON.parse(prior.rows || '[]') : o.rows, JSON.parse(prior.rows || '[]'), { lockDone: true });
  const f = { method, title: reqStr(pick('title'), '평가명', 200), kind, scale, process: str(pick('process'), 200), item: str(pick('item'), 200), equipment_id: optId(pick('equipment_id')), scope: str(pick('scope'), 1000), team: str(pick('team'), 300),
    assess_date: qDate(pick('assess_date'), '평가일'), next_review: qDate(pick('next_review'), '재평가 예정일'), rows: JSON.stringify(rows), summary: str(pick('summary'), 2000) };
  if (f.next_review && f.assess_date && f.next_review < f.assess_date) throw bad('재평가 예정일이 평가일보다 빠릅니다.');
  return f;
}
function raRow(r, eqs = {}) {
  const t = today(), rows = JSON.parse(r.rows || '[]').map(x => { const b = raScore(r.method, r.scale, x), a = raScore(r.method, r.scale, x, true); return { ...x, score: b.score, grade: b.grade, score2: a.score, grade2: a.grade, need: raNeedsAction(r.method, b.grade), open: !!x.action && !x.done, over: !!x.action && !x.done && !!x.due && x.due < t }; });
  const cnt = g => rows.filter(x => x.grade === g).length;
  return { ...r, rows, history: JSON.parse(r.history || '[]'), method_label: RA_METHOD[r.method], status_label: RA_STATUS[r.status], kind_label: RA_KIND[r.kind] || r.kind, equipment: eqs[r.equipment_id] || null,
    counts: { H: cnt('H'), M: cnt('M'), L: cnt('L'), open: rows.filter(x => x.open).length, over: rows.filter(x => x.over).length, done: rows.filter(x => x.action && x.done).length, residual: rows.filter(x => x.done ? raNeedsAction(r.method, x.grade2) : x.need).length },
    review_over: r.status === 'approved' && !!r.next_review && r.next_review < t };
}
const raEqMap = async () => Object.fromEntries((await db.prepare('SELECT id, equip_no, name FROM equipment').all()).map(e => [e.id, e]));
route('GET', '/api/risk-assess', async ({ user, query }) => {
  const eqs = await raEqMap(), m = RA_METHOD[query.method] ? query.method : '';
  const rows = (await db.prepare(`SELECT * FROM risk_assessments ${m ? 'WHERE method=?' : ''} ORDER BY CASE status WHEN 'obsolete' THEN 1 ELSE 0 END, id DESC LIMIT 2000`).all(...(m ? [m] : []))).map(r => raRow(r, eqs));
  return { rows, equipment: Object.values(eqs).sort((a, b) => a.equip_no.localeCompare(b.equip_no)), can_manage: canPlant(user), can_approve: canRaApprove(user), today: today() };
});
route('POST', '/api/risk-assess', async ({ user, body }) => {
  requirePlant(user); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM risk_assessments WHERE request_id=?').get(key); if (old) return raRow(old, await raEqMap()); }
  const f = raBody(body), prefix = RA_PREFIX[f.method] + today().slice(2, 7).replace('-', '') + '-';
  if (f.equipment_id && !await db.prepare('SELECT 1 FROM equipment WHERE id=?').get(f.equipment_id)) throw bad('설비를 찾을 수 없습니다.');
  const r = await db.prepare(`INSERT INTO risk_assessments(ra_no,method,${RA_COLS.join(',')},history,request_id,created_by) VALUES(${nextDocNo('risk_assessments', 'ra_no')},?,${RA_COLS.map(() => '?').join(',')},?,?,?)`)
    .run(prefix, prefix, prefix, f.method, ...RA_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '작성' }]), key, user.name);
  return raRow(await mustGet('risk_assessments', r.lastInsertRowid), await raEqMap());
});
route('PUT', '/api/risk-assess/:id', async ({ user, params, body }) => {
  requirePlant(user); const prior = await mustGet('risk_assessments', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (prior.status !== 'draft') throw bad(prior.status === 'review' ? '검토 요청 중에는 고칠 수 없습니다. 반려된 뒤 고치세요.' : '승인된 평가서는 「개정」을 눌러 새 Rev로 고치세요. 개선 조치 결과는 줄마다 「조치 결과」로 넣습니다.');
  const f = raBody(body, prior); if (f.equipment_id && !await db.prepare('SELECT 1 FROM equipment WHERE id=?').get(f.equipment_id)) throw bad('설비를 찾을 수 없습니다.');
  const changed = RA_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (!changed.length) return raRow(prior, await raEqMap());
  const r = await db.prepare(`UPDATE risk_assessments SET ${RA_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...RA_COLS.map(k => f[k]), pushHist(prior, { by: user.name, what: '수정', fields: changed }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return raRow(await mustGet('risk_assessments', prior.id), await raEqMap());
});
route('DELETE', '/api/risk-assess/:id', async ({ user, params, query }) => {
  requirePlant(user); const prior = await mustGet('risk_assessments', params.id);
  if (Number(query.revision) !== prior.revision) throw conflict();
  if (prior.status !== 'draft' || prior.rev > 0 || prior.approved_at) throw bad('한 번도 승인되지 않은 작성 중 평가서만 지울 수 있습니다. 승인된 평가서는 「폐지」하세요.');
  if (JSON.parse(prior.rows || '[]').some(x => x.nc_id)) throw bad('CAPA로 넘긴 줄이 있어 지울 수 없습니다.');
  await db.prepare('DELETE FROM risk_assessments WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});
// 단계: 작성 → 검토 요청(작성자) → 승인·반려(책임자) · 승인 → 개정(Rev+1, 작성) · 승인 → 폐지(책임자)
route('POST', '/api/risk-assess/:id/step', async ({ user, params, body }) => {
  requirePlant(user); const prior = await mustGet('risk_assessments', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const from = prior.status, to = body.to, reason = str(body.reason, 300), rows = JSON.parse(prior.rows || '[]'), set = { status: to }; let what = '';
  const approver = canRaApprove(user), need = () => { if (!approver) throw new HttpError(403, '승인·반려·폐지는 생산·품질 책임자나 관리자가 합니다.'); };
  if (from === 'draft' && to === 'review') { raCheck(prior, rows); what = '검토 요청'; }
  else if (from === 'review' && to === 'approved') {
    need(); raCheck(prior, rows);
    Object.assign(set, { approved_by: user.name, approved_at: now(), next_review: prior.next_review || addYears(prior.assess_date || today(), 1) }); what = prior.rev ? `Rev.${prior.rev} 개정 승인` : '승인';
  } else if (from === 'review' && to === 'draft') { if (!approver && prior.created_by !== user.name) throw new HttpError(403, '반려는 책임자가, 검토 요청 취소는 작성자가 합니다.'); if (approver && !reason) throw bad('반려 사유를 적으세요.'); what = approver ? '반려' : '검토 요청 취소'; }
  else if (from === 'approved' && to === 'draft') { const note = reqStr(body.rev_note, '개정 사유(무엇이 바뀌었는지)', 300); Object.assign(set, { rev: prior.rev + 1, rev_note: note, approved_by: '', approved_at: null, next_review: null }); what = `Rev.${prior.rev + 1} 개정 시작`; /* 15.315 재승인 때 새 평가일 + 1년 */ }
  else if (from !== 'obsolete' && to === 'obsolete') { need(); if (!reason) throw bad('폐지 사유를 적으세요.'); what = '폐지'; }
  else throw bad(`「${RA_STATUS[from]}」에서 「${RA_STATUS[to] || to}」(으)로 갈 수 없습니다.`);
  const keys = Object.keys(set);
  const r = await db.prepare(`UPDATE risk_assessments SET ${keys.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...keys.map(k => set[k]), pushHist(prior, { by: user.name, what, status: [from, to], ...(reason ? { reason } : {}), ...(set.rev_note ? { reason: set.rev_note } : {}) }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return raRow(await mustGet('risk_assessments', prior.id), await raEqMap());
});
// 개선 조치 결과: 승인 뒤에도 줄마다 완료일 + 조치 후 재평가(잔여 위험)를 넣는다. 완료를 풀 수도 있다(done 빈 값).
route('PUT', '/api/risk-assess/:id/rows/:key', async ({ user, params, body }) => {
  requirePlant(user); const prior = await mustGet('risk_assessments', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (prior.status === 'obsolete') throw bad('폐지된 평가서입니다.');
  if (prior.status === 'review') throw bad('검토 요청 중에는 조치 결과를 바꿀 수 없습니다. 승인·반려 뒤에 넣으세요.'); // 15.315
  const rows = JSON.parse(prior.rows || '[]'), i = rows.findIndex(x => x.key === params.key); if (i < 0) throw bad('워크시트 줄을 찾을 수 없습니다.');
  const cur = rows[i]; if (!cur.action) throw bad('감소대책(조치)이 없는 줄입니다.');
  const after = prior.method === 'fmea' ? ['s2', 'o2', 'd2'] : prior.method === 'hazop' ? ['s2', 'l2'] : prior.scale === 1 ? ['lvl2'] : ['f2', 's2'];
  const next = { ...cur, ...Object.fromEntries(after.map(k => [k, body[k] === undefined ? cur[k] : body[k]])), done: body.done === undefined ? cur.done : body.done, result: body.result === undefined ? cur.result || '' : body.result };
  const [clean] = raRowsClean(prior.method, prior.scale, [next], rows, { base: i });
  if (clean.done) { if (!raScore(prior.method, prior.scale, clean, true).grade) throw bad('조치 후 재평가(잔여 위험)를 넣어야 완료로 기록합니다.'); clean.done_by = cur.done === clean.done ? cur.done_by || user.name : user.name; } else clean.done_by = '';
  rows[i] = clean;
  const r = await db.prepare("UPDATE risk_assessments SET rows=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?")
    .run(JSON.stringify(rows), pushHist(prior, { by: user.name, what: clean.done ? `${i + 1}번 줄 조치 완료` : `${i + 1}번 줄 조치 결과 수정` }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return raRow(await mustGet('risk_assessments', prior.id), await raEqMap());
});
// FMEA·HAZOP 줄 → 부적합·CAPA(출처: 위험성평가). 근본 대책을 품질 CAPA로 관리할 때.
route('POST', '/api/risk-assess/:id/rows/:key/nc', async ({ user, params, body }) => {
  requirePlant(user); const prior = await mustGet('risk_assessments', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (prior.method === 'kosha' || prior.status === 'obsolete') throw bad('공정 FMEA·HAZOP 평가서의 줄만 CAPA로 넘깁니다.');
  const rows = JSON.parse(prior.rows || '[]'), i = rows.findIndex(x => x.key === params.key); if (i < 0) throw bad('워크시트 줄을 찾을 수 없습니다.');
  const x = rows[i]; if (x.nc_id) throw bad(`이미 CAPA(${x.nc_no})로 넘긴 줄입니다.`);
  const g = raScore(prior.method, prior.scale, x).grade, fm = prior.method === 'fmea';
  const nc = await ncCreate(user, { type: 'risk', id: prior.id, no: prior.ra_no }, { kind: '공정 이상', grade: g === 'H' ? 'major' : 'minor', title: `[${RA_METHOD[prior.method]}] ${fm ? x.mode : x.dev}`.slice(0, 200),
    detail: (fm ? [x.step && `공정 ${x.step}`, x.effect && `영향 ${x.effect}`, x.cause && `원인 ${x.cause}`, `S${x.s}·O${x.o}·D${x.d} AP ${g || '-'}`] : [x.node && `노드 ${x.node}`, x.cause && `원인 ${x.cause}`, x.cons && `결과 ${x.cons}`, x.safeguard && `안전장치 ${x.safeguard}`]).filter(Boolean).join('\n'),
    item: prior.item, owner_name: x.owner, due_date: x.due && x.due >= today() ? x.due : null, corrective: x.action });
  rows[i] = { ...x, nc_id: nc.id, nc_no: nc.nc_no };
  const r = await db.prepare(`UPDATE risk_assessments SET rows=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(JSON.stringify(rows), pushHist(prior, { by: user.name, what: `${i + 1}번 줄 → CAPA ${nc.nc_no}` }), user.name, prior.id, prior.revision);
  if (!r.changes) { await db.prepare('DELETE FROM nonconformities WHERE id=?').run(nc.id); throw conflict(); }
  return { ...raRow(await mustGet('risk_assessments', prior.id), await raEqMap()), nc_id: nc.id, nc_no: nc.nc_no };
});
// 설비 신뢰도: 기간의 계획 가동시간(일수 × 하루 가동시간, 설치일·오늘로 자름)과 고장 이력(고장 건수, 고장·수리 비가동 시간)으로
// MTBF = (가동시간 − 비가동) ÷ 고장 수, MTTR = 비가동 ÷ 고장 수, 가용도 = MTBF ÷ (MTBF + MTTR), 고장률 λ = 1 ÷ MTBF, 신뢰도 R(t) = e^(−t ÷ MTBF)(임무 시간 t).
route('GET', '/api/equipment-reliability', async ({ query }) => {
  const t = today(), to = query.to ? dateStr(query.to, '끝 날짜') : t, from = query.from ? dateStr(query.from, '시작 날짜') : addDaysISO(to, -364);
  if (from > to) throw bad('시작 날짜가 끝 날짜보다 늦습니다.');
  const hours = query.hours === undefined || query.hours === '' ? 24 : Number(query.hours), mission = query.mission === undefined || query.mission === '' ? 8 : Number(query.mission);
  if (!(hours > 0 && hours <= 24)) throw bad('하루 가동시간은 0보다 크고 24 이하로 넣으세요.'); if (!(mission > 0 && mission <= 100000)) throw bad('임무 시간은 0보다 큰 시간으로 넣으세요.');
  const end = to > t ? t : to, days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1, r2 = v => v == null ? null : Math.round(v * 100) / 100;
  const logs = await db.prepare("SELECT equipment_id, SUM(CASE WHEN kind='failure' THEN 1 ELSE 0 END) fails, SUM(CASE WHEN kind IN ('failure','repair') THEN COALESCE(downtime_hours,0) ELSE 0 END) down, MAX(CASE WHEN kind='failure' THEN log_date END) last_fail FROM equipment_logs WHERE log_date BETWEEN ? AND ? GROUP BY equipment_id").all(from, end);
  const lm = Object.fromEntries(logs.map(l => [l.equipment_id, l])), out = [];
  for (const e of await db.prepare("SELECT id, equip_no, name, kind, location, install_date, status FROM equipment WHERE status<>'disposed' ORDER BY equip_no").all()) {
    const s = e.install_date && e.install_date > from ? e.install_date : from; if (s > end) { out.push({ ...e, days: 0, planned: 0, fails: 0, down: 0, mtbf: null, mttr: null, availability: null, lambda: null, reliability: null, last_fail: null }); continue; }
    const l = lm[e.id] || { fails: 0, down: 0, last_fail: null }, planned = days(s, end) * hours, down = Math.min(l.down || 0, planned), up = planned - down;
    const mtbf = l.fails ? up / l.fails : null, mttr = l.fails ? down / l.fails : null;
    // 15.315 고장이 있는데 기간 내내 멈춰 MTBF가 0이면 고장률은 계산 불가(null), 신뢰도 0%. 고장이 없을 때만 100%.
    out.push({ ...e, days: days(s, end), planned: r2(planned), fails: l.fails || 0, down: r2(down), up: r2(up), mtbf: r2(mtbf), mttr: r2(mttr), availability: planned ? r2(up / planned * 100) : null,
      lambda: !l.fails ? 0 : mtbf > 0 ? Math.round(1000 / mtbf * 10000) / 10000 : null,
      reliability: !l.fails ? (planned ? 100 : null) : mtbf > 0 ? r2(Math.exp(-mission / mtbf) * 100) : 0, last_fail: l.last_fail || null });
  }
  const tot = out.reduce((a, x) => ({ planned: a.planned + (x.planned || 0), down: a.down + (x.down || 0), fails: a.fails + x.fails }), { planned: 0, down: 0, fails: 0 });
  const mt = tot.fails ? (tot.planned - tot.down) / tot.fails : null;
  return { from, to: end, hours, mission, rows: out, total: { ...tot, planned: r2(tot.planned), down: r2(tot.down), mtbf: r2(mt), mttr: tot.fails ? r2(tot.down / tot.fails) : null, availability: tot.planned ? r2((tot.planned - tot.down) / tot.planned * 100) : null } };
});
// ── 15.316 연구소 › 개발원가 관리 ──
// 개발 건(개발리스트 requests.type='development')별 원가표. 원가 줄은 엑셀처럼 쌓고(발생일·구분·품목·규격·거래처·수량·단위·단가·통화·환율), 서버가 금액을 계산한다.
// 금액 = 수량 × 단가 × 환율(원 단위 반올림). 직접비 = 판관비 줄을 뺀 합, 판관비 = 판관비 줄 + 직접비 × 판관비율, 총원가 = 직접비 + 판관비,
// 단위원가 = 총원가 ÷ 기준 수량, 목표 판매단가가 있으면 이익·이익률, 목표 이익률이 있으면 권장 판매단가 = 단위원가 ÷ (1 − 이익률).
// 보기·작성은 연구소(개발·개발책임자), 확정·확정 취소는 개발책임자. 확정된 원가표는 잠김.
const DC_CAT = { material: '매입가(재료)', incidental: '부대비용(운송·관세·포장)', outsource: '외주가공', test: '시험·인증', tooling: '금형·지그', labor: '인건비', sga: '판관비', etc: '기타' };
const DC_STATUS = { draft: '작성', confirmed: '확정' };
const DC_CUR = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];
const DC_COLS = ['dev_request_id', 'title', 'customer', 'product', 'base_qty', 'unit', 'sga_rate', 'profit_rate', 'target_price', 'lines', 'note'];
const requireResearcher = user => { if (!isResearcher(user)) throw new HttpError(403, '개발원가는 연구소(개발 담당·개발책임자)만 봅니다.'); };
function dcLines(list, prior = []) {
  if (!Array.isArray(list)) throw bad('원가 줄이 올바르지 않습니다.'); if (list.length > 500) throw bad('원가 줄은 500줄까지입니다.');
  const keys = new Set();
  return list.map((x, i) => {
    const o = x && typeof x === 'object' ? x : {}, n = `${i + 1}번 줄 `, key = /^[a-f0-9]{8}$/.test(o.key || '') ? o.key : randomHex(4);
    if (keys.has(key)) throw bad('원가 줄이 겹칩니다.'); keys.add(key);
    const blank = v => v === '' || v == null;
    const qty = blank(o.qty) ? 1 : numS(o.qty, n + '수량'), price = blank(o.unit_price) ? 0 : numS(o.unit_price, n + '단가'), fx = blank(o.fx) ? 1 : num(o.fx, n + '환율');
    if (fx <= 0) throw bad(n + '환율은 0보다 커야 합니다.');
    const cur = DC_CUR.includes(o.currency) ? o.currency : 'KRW';
    return { key, date: qDate(o.date, n + '발생일'), cat: DC_CAT[o.cat] ? o.cat : 'material', item: reqStr(o.item, n + '품목·내용', 200), spec: str(o.spec, 200), vendor: str(o.vendor, 100), qty, unit: str(o.unit, 20), unit_price: price, currency: cur, fx: cur === 'KRW' ? 1 : fx, amount: Math.round(qty * price * (cur === 'KRW' ? 1 : fx)), note: str(o.note, 300) };
  });
}
function dcCalc(r) {
  const lines = Array.isArray(r.lines) ? r.lines : JSON.parse(r.lines || '[]'), by = Object.fromEntries(Object.keys(DC_CAT).map(k => [k, 0]));
  for (const l of lines) by[l.cat] = (by[l.cat] || 0) + (l.amount || 0);
  const direct = lines.filter(l => l.cat !== 'sga').reduce((s, l) => s + (l.amount || 0), 0), sgaAuto = Math.round(direct * (r.sga_rate || 0) / 100), sga = by.sga + sgaAuto, total = direct + sga;
  const base = r.base_qty > 0 ? r.base_qty : 1, unit_cost = Math.round(total / base * 100) / 100;
  const margin = r.target_price != null ? Math.round((r.target_price - unit_cost) * 100) / 100 : null, margin_rate = r.target_price ? Math.round((r.target_price - unit_cost) / r.target_price * 1000) / 10 : null;
  const suggest = r.profit_rate > 0 && r.profit_rate < 100 ? Math.round(unit_cost / (1 - r.profit_rate / 100)) : null;
  const dates = lines.map(l => l.date).filter(Boolean).sort();
  return { by, direct, sga_auto: sgaAuto, sga, total, unit_cost, margin, margin_rate, suggest, first_date: dates[0] || null, last_date: dates.at(-1) || null, line_count: lines.length };
}
async function dcBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const dev = optId(pick('dev_request_id')); let devRow = null;
  if (dev) { devRow = await db.prepare("SELECT id, req_no, title, customer FROM requests WHERE id=? AND type='development'").get(dev); if (!devRow) throw bad('개발리스트의 개발 건을 다시 고르세요.'); }
  const rate = (v, l) => { if (v === '' || v == null) return 0; const n = num(v, l); if (n >= 100) throw bad(`${l}은(는) 100% 미만으로 넣으세요.`); return n; };
  const base = pick('base_qty') === '' || pick('base_qty') == null ? 1 : num(pick('base_qty'), '원가 기준 수량'); if (base <= 0) throw bad('원가 기준 수량은 0보다 커야 합니다.');
  const tp = pick('target_price'); const lines = dcLines(o.lines === undefined ? JSON.parse(prior.lines || '[]') : o.lines);
  return { dev_request_id: dev, title: str(pick('title'), 200) || devRow?.title || reqStr('', '원가표 이름(제품·개발명)', 200), customer: str(pick('customer'), 100) || (!prior.id ? devRow?.customer || '' : ''), product: str(pick('product'), 200),
    base_qty: base, unit: str(pick('unit'), 20), sga_rate: rate(pick('sga_rate'), '판관비율'), profit_rate: rate(pick('profit_rate'), '목표 이익률'), target_price: tp === '' || tp == null ? null : num(tp, '목표 판매단가'), lines: JSON.stringify(lines), note: str(pick('note'), 1000) };
}
async function dcDevMap() { return Object.fromEntries((await db.prepare("SELECT id, req_no, title, customer, status FROM requests WHERE type='development'").all()).map(r => [r.id, r])); }
const dcRow = (r, devs = {}) => ({ ...r, lines: JSON.parse(r.lines || '[]'), history: JSON.parse(r.history || '[]'), status_label: DC_STATUS[r.status] || r.status, dev: r.dev_request_id ? devs[r.dev_request_id] || null : null, calc: dcCalc(r) });
route('GET', '/api/dev-costs', async ({ user }) => {
  requireResearcher(user); const devs = await dcDevMap();
  const rows = (await db.prepare('SELECT * FROM dev_costs ORDER BY id DESC LIMIT 3000').all()).map(r => dcRow(r, devs));
  const dev_requests = Object.values(devs).sort((a, b) => b.id - a.id).map(d => ({ ...d, cost_count: rows.filter(r => r.dev_request_id === d.id).length, cost_total: rows.filter(r => r.dev_request_id === d.id).reduce((s, r) => s + r.calc.total, 0) }));
  return { rows, dev_requests, categories: DC_CAT, currencies: DC_CUR, can_manage: isResearcher(user), can_confirm: hasRole(user, 'dev_approver'), today: today() };
});
route('POST', '/api/dev-costs', async ({ user, body }) => {
  requireResearcher(user); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM dev_costs WHERE request_id=?').get(key); if (old) return dcRow(old, await dcDevMap()); }
  const f = await dcBody(body), prefix = 'DC-' + today().slice(2, 7).replace('-', '') + '-';
  const r = await db.prepare(`INSERT INTO dev_costs(cost_no,${DC_COLS.join(',')},history,request_id,created_by) VALUES(${nextDocNo('dev_costs', 'cost_no')},${DC_COLS.map(() => '?').join(',')},?,?,?)`)
    .run(prefix, prefix, prefix, ...DC_COLS.map(k => f[k]), JSON.stringify([{ at: now(), by: user.name, what: '작성' }]), key, user.name);
  return dcRow(await mustGet('dev_costs', r.lastInsertRowid), await dcDevMap());
});
route('PUT', '/api/dev-costs/:id', async ({ user, params, body }) => {
  requireResearcher(user); const prior = await mustGet('dev_costs', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (prior.status === 'confirmed') throw bad('확정된 원가표입니다. 개발책임자가 「확정 취소」한 뒤 고치세요.');
  const f = await dcBody(body, prior), changed = DC_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (!changed.length) return dcRow(prior, await dcDevMap());
  const t = dcCalc(f), t0 = dcCalc(prior);
  const r = await db.prepare(`UPDATE dev_costs SET ${DC_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...DC_COLS.map(k => f[k]), pushHist(prior, { by: user.name, what: t.total !== t0.total ? `수정 · 총원가 ${t0.total.toLocaleString('ko-KR')} → ${t.total.toLocaleString('ko-KR')}` : '수정', fields: changed }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return dcRow(await mustGet('dev_costs', prior.id), await dcDevMap());
});
route('POST', '/api/dev-costs/:id/step', async ({ user, params, body }) => {
  requireResearcher(user); const prior = await mustGet('dev_costs', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  if (!hasRole(user, 'dev_approver')) throw new HttpError(403, '확정·확정 취소는 개발책임자가 합니다.');
  const to = body.to, reason = str(body.reason, 300); let set;
  if (prior.status === 'draft' && to === 'confirmed') { if (!JSON.parse(prior.lines || '[]').length) throw bad('원가 줄을 하나 이상 넣어야 확정합니다.'); set = { status: 'confirmed', confirmed_by: user.name, confirmed_at: now() }; }
  else if (prior.status === 'confirmed' && to === 'draft') { if (!reason) throw bad('확정 취소 사유를 적으세요.'); set = { status: 'draft', confirmed_by: '', confirmed_at: null }; }
  else throw bad(`「${DC_STATUS[prior.status]}」에서 「${DC_STATUS[to] || to}」(으)로 갈 수 없습니다.`);
  const keys = Object.keys(set);
  const r = await db.prepare(`UPDATE dev_costs SET ${keys.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...keys.map(k => set[k]), pushHist(prior, { by: user.name, what: to === 'confirmed' ? `확정 · 총원가 ${dcCalc(prior).total.toLocaleString('ko-KR')}` : '확정 취소', status: [prior.status, to], ...(reason ? { reason } : {}) }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return dcRow(await mustGet('dev_costs', prior.id), await dcDevMap());
});
route('DELETE', '/api/dev-costs/:id', async ({ user, params, query }) => {
  requireResearcher(user); const prior = await mustGet('dev_costs', params.id);
  if (Number(query.revision) !== prior.revision) throw conflict();
  if (prior.status !== 'draft' || JSON.parse(prior.history || '[]').some(h => /확정/.test(h.what || ''))) throw bad('한 번이라도 확정된 원가표는 지울 수 없습니다.');
  await db.prepare('DELETE FROM dev_costs WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});
// ── 15.318 구매 › 원가 산출 관리 ──
// 엑셀 「원가 산출」 양식을 그대로 옮김: 품목별 원가 = 원부자재(소요량 × 원화 단가 × (1 + 로스%)) + 인건비(공정마다 시간당 인건비 × 인원 × 작업량 ÷ 시간당 처리량)
// + 기타 직접비 → 직접비. 불량(직접비 × 불량률, 가산) · 제조경비(직접비 × 제조경비율) · 판관비(직접비 또는 직접비+제조경비 × 판관비율)를 더해 원가.
// 원가 백데이터(원부자재·상품 단가)와 공통 기준(인건비·비율·환율)은 시점별로 쌓고, 품목 원가는 「그 시점」 단가·기준으로 계산한다.
// 원가가 바뀔 때마다(직접 수정·단가 변경·기준 변경) 변동 시점·사유와 함께 리비전 스냅샷(cost_item_revs)을 남긴다. 구매 담당(관리자)만.
const COST_KIND = { product: '제조', goods: '상품' };
const COST_LINE = { mat: '원부자재', labor: '인건비', exp: '기타 직접비' };
const COST_CUR = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];
const COST_CAUSE = { manual: '직접 수정', material: '단가 변경', rates: '공통 기준 변경', create: '최초 산출' };
const requireCost = user => { if (!hasRole(user, 'purchase')) throw new HttpError(403, '원가 산출 관리는 구매 담당자(관리자)만 봅니다.'); };
// 15.321 연구소 예상 원가(stage=dev)는 연구소(개발·개발책임자)와 구매가, 양산 원가(stage=mass)는 구매만 다룬다.
const costCanStage = (user, stage) => stage === 'dev' ? (isResearcher(user) || hasRole(user, 'purchase')) : hasRole(user, 'purchase');
const requireCostStage = (user, stage) => { if (!costCanStage(user, stage)) throw new HttpError(403, stage === 'dev' ? '개발원가(양산 원가 예측)는 연구소·구매 담당자만 봅니다.' : '원가 산출 관리는 구매 담당자(관리자)만 봅니다.'); };
const cr2 = v => Math.round(v * 100) / 100, cr4 = v => Math.round(v * 10000) / 10000;
// 칸 수식: 숫자·+ − × ÷·괄호만(예: 245000/1500*0.32, =9000*4). 쉼표·₩·앞의 = 는 무시.
function costExpr(src, label) {
  let s = String(src ?? '').trim(); if (s.startsWith('=')) s = s.slice(1); s = s.replace(/[,₩\s]/g, '').replace(/×/g, '*').replace(/÷/g, '/'); if (!s) return null;
  if (s.length > 120) throw bad(`${label} 식이 너무 깁니다.`);
  let i = 0; const fail = () => { throw bad(`${label}: 「${String(src).slice(0, 40)}」은(는) 숫자나 사칙연산 식(+ - * / 괄호)으로 넣으세요.`); };
  const num = () => { const m = /^(\d+(\.\d*)?|\.\d+)/.exec(s.slice(i)); if (!m) fail(); i += m[0].length; return Number(m[0]); };
  const factor = () => { if (s[i] === '(') { i++; const v = expr(); if (s[i] !== ')') fail(); i++; return v; } if (s[i] === '-') { i++; return -factor(); } if (s[i] === '+') { i++; return factor(); } return num(); };
  const term = () => { let v = factor(); for (;;) { if (s[i] === '*') { i++; v *= factor(); } else if (s[i] === '/') { i++; const d = factor(); if (d === 0) throw bad(`${label}: 0으로 나눌 수 없습니다.`); v /= d; } else return v; } };
  const expr = () => { let v = term(); for (;;) { if (s[i] === '+') { i++; v += term(); } else if (s[i] === '-') { i++; v -= term(); } else return v; } };
  const v = expr(); if (i !== s.length || !Number.isFinite(v)) fail(); return v;
}
async function costRatesAt(date) {
  const r = await db.prepare('SELECT * FROM cost_rates WHERE effective_date<=? ORDER BY effective_date DESC, id DESC LIMIT 1').get(date);
  return r ? { ...r, fx: JSON.parse(r.fx || '{}') } : { id: null, effective_date: null, labor_rate: 0, mfg_rate: 0, sga_rate: 0, defect_rate: 0, fx: {} };
}
async function costPricesAt(date) {
  const rows = await db.prepare('SELECT * FROM cost_material_prices WHERE effective_date<=? ORDER BY material_id, effective_date, id').all(date);
  const out = {}; for (const r of rows) out[r.material_id] = r; return out; // 시점까지 마지막 단가
}
function costParse(item) { return { ...item, lines: Array.isArray(item.lines) ? item.lines : JSON.parse(item.lines || '[]'), overrides: typeof item.overrides === 'object' && item.overrides ? item.overrides : JSON.parse(item.overrides || '{}') }; }
// 원가 계산(서버가 기준. 화면도 같은 식으로 미리 보여 준다)
function costCompute(item0, rates, prices) {
  const item = costParse(item0), o = item.overrides, pick = k => o[k] == null ? rates[k] || 0 : o[k];
  const used = { labor_rate: pick('labor_rate'), mfg_rate: pick('mfg_rate'), sga_rate: pick('sga_rate'), defect_rate: pick('defect_rate'), rates_id: rates.id, rates_date: rates.effective_date, overridden: Object.keys(o).filter(k => o[k] != null) };
  const lines = item.lines.map((l, i) => {
    const n = `${i + 1}번 줄 `, qty = costExpr(l.qty, n + '소요량·작업량') ?? 1, loss = Number(l.loss) || 0;
    let unit_price = 0, price_src = 'manual', price_date = null;
    if (l.type === 'mat' && l.material_id && !l.manual_price) { const p = prices[l.material_id]; unit_price = p ? p.krw_price : 0; price_src = p ? 'master' : 'missing'; price_date = p?.effective_date || null; }
    else unit_price = costExpr(l.price, n + '단가') ?? 0;
    let amount = 0, capa = null, workers = null;
    if (l.type === 'labor') { capa = costExpr(l.capa, n + '시간당 처리량'); workers = costExpr(l.workers, n + '인원') ?? 1; amount = capa > 0 ? used.labor_rate * workers * qty / capa : qty * unit_price; if (capa > 0) price_src = 'rate'; }
    else if (l.type === 'mat') amount = qty * unit_price * (1 + loss / 100);
    else amount = qty * unit_price;
    return { ...l, qty_v: cr4(qty), unit_price: cr4(unit_price), capa_v: capa == null ? null : cr4(capa), workers_v: workers, amount: cr4(amount), price_src, price_date };
  });
  // 15.322 비율 줄(보험료·관세 등): 기준 줄(auto 이름)들의 금액 합 × 비율%. 앞 줄부터 차례로(보험료 → 관세 과세가격에 보험료 포함).
  lines.forEach((l, i) => { if (l.type !== 'exp' || l.pct == null || l.pct === '') return; const pct = costExpr(l.pct, `${i + 1}번 줄 비율(%)`) ?? 0, base = lines.filter(x => x !== l && (l.base || []).includes(x.auto)).reduce((s2, x) => s2 + x.amount, 0);
    lines[i] = { ...l, qty_v: cr4(pct / 100), unit_price: cr4(base), amount: cr4(base * pct / 100), price_src: 'pct' }; });
  const sum = t => lines.filter(l => l.type === t).reduce((s, l) => s + l.amount, 0);
  const material = sum('mat'), labor = sum('labor'), other = sum('exp'), direct = material + labor + other;
  const defect = direct * used.defect_rate / 100, mfg = direct * used.mfg_rate / 100, sga = (item.sga_base === 'mfg' ? direct + mfg : direct) * used.sga_rate / 100, total = direct + defect + mfg + sga;
  const sale = item.sale_price == null || item.sale_price === '' ? null : Number(item.sale_price), pcs = Number(item.pieces) > 0 ? Number(item.pieces) : null;
  const totals = { material: cr2(material), labor: cr2(labor), other: cr2(other), direct: cr2(direct), defect: cr2(defect), mfg: cr2(mfg), sga: cr2(sga), total: cr2(total), piece_cost: pcs ? cr4(total / pcs) : null,
    sale_price: sale, margin: sale == null ? null : cr2(sale - total), margin_rate: sale ? cr2((sale - total) / sale * 100) : null, missing_price: lines.some(l => l.price_src === 'missing') };
  return { lines, totals, rates: used };
}
// 15.320 제품 사양(포장 구조·포장당/외포장당/박스당 sh·시트·원단 폭·자재 매입가) — 화면이 이 값으로 원가 줄(auto)을 만든다. 정해진 칸만 받는다.
const COST_AUTO = ['fabric', 'pack', 'outer', 'box', 'cut', 'packing', 'goods', 'origin', 'freight', 'insurance', 'duty', 'dest', 'imp_etc']; // 15.322 상품 수입 물류비
const COST_BUILD_ENUM = { i_inc: ['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'], pack: ['double', 'triple'], unit: ['pack', 'sheet', 'box'], dim: ['in', 'mm'], fdim: ['in', 'mm'], fbasis: ['', 'yd', 'sqm', 'm'], pk_cu: ['pack', 'sh'] };
const COST_BUILD_VAL = ['sw', 'sl', 'fw', 'floss', 'spy', 'spp', 'spo', 'spb', 'puse', 'ouse', 'buse', 'fprice', 'pprice', 'oprice', 'bprice', 'cut_capa', 'cut_workers', 'pk_capa', 'pk_workers', 'i_price', 'i_gq', 'i_qty', 'i_freight', 'i_origin', 'i_dest', 'i_ins', 'i_duty', 'i_etc'];
function costBuildClean(v0) {
  let v = v0; if (typeof v === 'string') { try { v = JSON.parse(v || '{}'); } catch { v = {}; } } if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const o = { on: !!v.on, i_on: !!v.i_on };
  for (const k of ['i_cont', 'i_route']) if (String(v[k] ?? '').trim()) o[k] = str(String(v[k]), 40);
  for (const [k, list] of Object.entries(COST_BUILD_ENUM)) if (list.includes(v[k])) o[k] = v[k];
  for (const k of COST_BUILD_VAL) if (v[k] !== undefined && v[k] !== null && String(v[k]).trim() !== '') { const x = str(String(v[k]), 40); costExpr(x, `제품 사양(${k}) `); o[k] = x; }
  for (const k of ['fmat', 'pmat', 'omat', 'bmat', 'i_mat']) { const id = optId(v[k]); if (id) o[k] = id; }
  return o;
}
function costLinesClean(list, matIds) {
  if (!Array.isArray(list)) throw bad('원가 줄이 올바르지 않습니다.'); if (list.length > 200) throw bad('원가 줄은 200줄까지입니다.');
  const keys = new Set();
  return list.map((x, i) => {
    const o = x && typeof x === 'object' ? x : {}, n = `${i + 1}번 줄 `, key = /^[a-f0-9]{8}$/.test(o.key || '') ? o.key : randomHex(4);
    if (keys.has(key)) throw bad('원가 줄이 겹칩니다.'); keys.add(key);
    const type = COST_LINE[o.type] ? o.type : 'mat', mid = type === 'mat' ? optId(o.material_id) : null;
    if (mid && !matIds.has(mid)) throw bad(n + '원가 백데이터의 원부자재를 다시 고르세요.');
    const ex = (k, l) => { const v = str(o[k], 120); costExpr(v, n + l); return v; };
    const loss = o.loss === '' || o.loss == null ? 0 : Number(o.loss); if (!(loss >= 0 && loss <= 100)) throw bad(n + '로스(%)는 0~100으로 넣으세요.');
    const line = { key, type, material_id: mid, manual_price: !!(mid && o.manual_price), name: str(o.name, 100), spec: str(o.spec, 100), unit: str(o.unit, 20), qty: ex('qty', '소요량·작업량'), price: ex('price', '단가'), loss: type === 'mat' ? loss : 0,
      capa: type === 'labor' ? ex('capa', '시간당 처리량') : '', workers: type === 'labor' ? ex('workers', '인원') : '', note: str(o.note, 200) };
    if (COST_AUTO.includes(o.auto)) line.auto = o.auto; /* 15.320 제품 사양에서 만든 줄 */
    if (type === 'exp' && String(o.pct ?? '').trim() !== '') { line.pct = ex('pct', '비율(%)'); line.base = Array.isArray(o.base) ? [...new Set(o.base.filter(k => COST_AUTO.includes(k)))].slice(0, 10) : []; } /* 15.322 보험료·관세 같은 비율 줄 */
    if (!line.name && !mid) throw bad(n + '항목 이름을 넣으세요.');
    return line;
  });
}
async function costItemBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const bom = optId(pick('bom_id')); if (bom && !await db.prepare('SELECT 1 FROM boms WHERE id=?').get(bom)) throw bad('제품등록 품목을 다시 고르세요.');
  const devReq = optId(pick('dev_request_id')); if (devReq && !await db.prepare("SELECT 1 FROM requests WHERE id=? AND type='development'").get(devReq)) throw bad('개발리스트의 개발 건을 다시 고르세요.');
  const nOrNull = (v, l, lo = 0, hi = 1e12) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '')); if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${l}을(를) ${lo} 이상 숫자로 넣으세요.`); return n; };
  const ov0 = o.overrides === undefined ? JSON.parse(prior.overrides || '{}') : (o.overrides && typeof o.overrides === 'object' ? o.overrides : {}), ov = {};
  for (const [k, l, hi] of [['labor_rate', '시간당 인건비', 1e7], ['mfg_rate', '제조경비율', 100], ['sga_rate', '판관비율', 100], ['defect_rate', '불량률', 100]]) { const v = nOrNull(ov0[k], l, 0, hi); if (v != null) ov[k] = v; }
  const matIds = new Set((await db.prepare('SELECT id FROM cost_materials').all()).map(r => r.id));
  return { name: reqStr(pick('name'), '품목명', 150), spec: str(pick('spec'), 150), kind: COST_KIND[pick('kind')] ? pick('kind') : 'product', category: str(pick('category'), 50), bom_id: bom, unit: str(pick('unit'), 20),
    pieces: nOrNull(pick('pieces'), '낱개 수', 0.0001), pack_spec: str(pick('pack_spec'), 100), customer: str(pick('customer'), 100), sale_price: nOrNull(pick('sale_price'), '판매가'), sga_base: pick('sga_base') === 'mfg' ? 'mfg' : 'direct',
    dev_request_id: devReq, overrides: JSON.stringify(ov), lines: JSON.stringify(costLinesClean(o.lines === undefined ? JSON.parse(prior.lines || '[]') : o.lines, matIds)), note: str(pick('note'), 1000), build: JSON.stringify(costBuildClean(o.build === undefined ? prior.build : o.build)) };
}
const COST_ITEM_COLS = ['name', 'spec', 'kind', 'category', 'bom_id', 'unit', 'pieces', 'pack_spec', 'customer', 'sale_price', 'sga_base', 'overrides', 'lines', 'note', 'build', 'dev_request_id'];
const costHeader = f => ({ name: f.name, spec: f.spec, kind: f.kind, unit: f.unit, pieces: f.pieces, pack_spec: f.pack_spec, customer: f.customer, sale_price: f.sale_price, sga_base: f.sga_base, overrides: JSON.parse(f.overrides || '{}'), build: JSON.parse(f.build || '{}') });
const costRevSql = (itemId, rev, date, reason, cause, f, calc, by) => ({ sql: 'INSERT INTO cost_item_revs(item_id,rev,effective_date,reason,cause,header,lines,rates,totals,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [itemId, rev, date, reason, cause, JSON.stringify(costHeader(f)), JSON.stringify(calc.lines), JSON.stringify(calc.rates), JSON.stringify(calc.totals), by] });
const costCostKey = f => JSON.stringify([JSON.parse(f.lines || '[]').map(({ auto, ...l }) => (void auto, l)), f.overrides, f.sga_base, f.pieces ?? null, f.kind]);
async function costItemsAll() { return (await db.prepare('SELECT * FROM cost_items ORDER BY active DESC, item_code').all()); }
async function costLive(rows, date) { const [rates, prices] = [await costRatesAt(date), await costPricesAt(date)]; return rows.map(r => { try { return costCompute(r, rates, prices); } catch { return null; } }); }
function costRowOut(r, live, revs) {
  const totals = JSON.parse(r.totals || '{}'), mine = revs.filter(x => x.item_id === r.id), prev = mine.filter(x => x.rev < r.rev).at(-1), pt = prev ? JSON.parse(prev.totals || '{}') : null;
  return { ...r, lines: JSON.parse(r.lines || '[]'), overrides: JSON.parse(r.overrides || '{}'), build: JSON.parse(r.build || '{}'), history: JSON.parse(r.history || '[]'), active: !!r.active, kind_label: COST_KIND[r.kind], totals,
    live: live?.totals || null, stale: !!live && Math.abs((live.totals.total || 0) - (totals.total || 0)) > 0.005, prev_total: pt?.total ?? null, prev_date: prev?.effective_date || null,
    change_pct: pt?.total ? cr2(((totals.total || 0) - pt.total) / pt.total * 100) : null, rev_count: mine.length };
}
async function costMaterialsOut(date) {
  const mats = await db.prepare('SELECT * FROM cost_materials ORDER BY active DESC, code').all(), prices = await db.prepare('SELECT * FROM cost_material_prices ORDER BY material_id, effective_date, id').all();
  const items = await db.prepare('SELECT id, item_code, name, lines FROM cost_items WHERE active=1').all();
  return mats.map(m => {
    const ps = prices.filter(p => p.material_id === m.id), cur = ps.filter(p => p.effective_date <= date).at(-1) || null, next = ps.find(p => p.effective_date > date) || null, prev = cur ? ps.filter(p => p.effective_date <= date && p.id !== cur.id).at(-1) || null : null;
    const used = items.filter(it => JSON.parse(it.lines || '[]').some(l => l.material_id === m.id)).map(it => ({ id: it.id, item_code: it.item_code, name: it.name }));
    return { ...m, active: !!m.active, history: JSON.parse(m.history || '[]'), current: cur, next, prev_krw: prev?.krw_price ?? null, change_pct: prev?.krw_price ? cr2((cur.krw_price - prev.krw_price) / prev.krw_price * 100) : null, price_count: ps.length, used_by: used };
  });
}
function costPriceBody(o, rates) {
  const cur0 = String(o.currency ?? '').trim().toUpperCase(), date = dateStr(o.effective_date || today(), '적용 시점'), currency = cur0 || 'KRW';
  if (!COST_CUR.includes(currency)) throw bad(`통화는 ${COST_CUR.join('·')} 중 하나로 넣으세요(${cur0}).`); /* 15.319 모르는 통화를 원화로 바꿔 넣지 않음 */
  if (o.price === '' || o.price == null) throw bad('단가를 넣으세요.');
  const n = (v, l, allowNeg = false, def = 0) => { if (v === '' || v == null) return def; const x = Number(String(v).replace(/,/g, '')); if (!Number.isFinite(x) || (!allowNeg && x < 0)) throw bad(`${l}을(를) 숫자로 넣으세요.`); return x; };
  const price = n(o.price, '단가'), surcharge = n(o.surcharge, '할증(서차지)', true), extra = n(o.extra_krw, '부대비(원/단위)', true);
  let fx = currency === 'KRW' ? 1 : n(o.fx, '환율', false, null); if (currency !== 'KRW' && !fx) fx = Number(rates.fx?.[currency]) || 0; if (currency !== 'KRW' && !(fx > 0)) throw bad(`${currency} 환율을 넣거나 공통 기준에 ${currency} 환율을 먼저 넣으세요.`);
  return { effective_date: date, currency, price, surcharge, fx, extra_krw: extra, krw_price: cr4((price + surcharge) * fx + extra), incoterms: str(o.incoterms, 30), reason: str(o.reason, 200) };
}
const costPriceSql = (mid, p, key, by) => ({ sql: 'INSERT INTO cost_material_prices(material_id,effective_date,currency,price,surcharge,fx,extra_krw,krw_price,incoterms,reason,request_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', args: [mid, p.effective_date, p.currency, p.price, p.surcharge, p.fx, p.extra_krw, p.krw_price, p.incoterms, p.reason, key, by] });
// 재산출: 고른 품목(또는 그 원부자재를 쓰는 품목·공통 기준을 쓰는 품목)을 시점 단가·기준으로 다시 계산해, 원가가 바뀐 품목만 리비전을 남긴다(dry면 미리 보기만).
async function costRecalc(user, { ids = null, material_id = null, rates = false, date, reason, cause, dry = false }) {
  const [rt, pr] = [await costRatesAt(date), await costPricesAt(date)], out = { changed: [], unchanged: 0, skipped: [] };
  let rows = (await db.prepare('SELECT * FROM cost_items WHERE active=1 ORDER BY item_code').all());
  if (ids) rows = rows.filter(r => ids.includes(r.id));
  if (material_id) rows = rows.filter(r => JSON.parse(r.lines || '[]').some(l => l.material_id === material_id && !l.manual_price));
  if (rates) rows = rows.filter(r => { const o = JSON.parse(r.overrides || '{}'); return ['labor_rate', 'mfg_rate', 'sga_rate', 'defect_rate'].some(k => o[k] == null); });
  for (const r of rows) {
    let calc; try { calc = costCompute(r, rt, pr); } catch (e) { out.skipped.push({ id: r.id, item_code: r.item_code, name: r.name, why: e.message }); continue; }
    const old = JSON.parse(r.totals || '{}');
    if (Math.abs((calc.totals.total || 0) - (old.total || 0)) <= 0.005) { out.unchanged++; continue; }
    const row = { id: r.id, item_code: r.item_code, name: r.name, old_total: old.total ?? null, new_total: calc.totals.total, pct: old.total ? cr2((calc.totals.total - old.total) / old.total * 100) : null, sale_price: r.sale_price, new_margin_rate: calc.totals.margin_rate };
    if (r.rev_date && date < r.rev_date) { out.skipped.push({ ...row, why: `마지막 리비전 시점(${r.rev_date})보다 앞선 시점입니다.` }); continue; }
    if (dry) { out.changed.push(row); continue; }
    const rev = r.rev + 1, tok = randomHex(8), gd = tokGuard('cost_items', r.id, r.revision + 1, tok);
    const res = await db.batch([
      { sql: "UPDATE cost_items SET rev=?,rev_date=?,totals=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?", args: [rev, date, JSON.stringify(calc.totals), pushHist(r, { by: user.name, what: `Rev.${rev} ${COST_CAUSE[cause]} · ${reason}`, tok }), user.name, r.id, r.revision] },
      { ...costRevSql(r.id, rev, date, reason, cause, { ...r }, calc, user.name), sql: costRevSql(r.id, rev, date, reason, cause, r, calc, user.name).sql.replace(') VALUES(?,?,?,?,?,?,?,?,?,?)', ') SELECT ?,?,?,?,?,?,?,?,?,? WHERE ' + gd.sql), args: [...costRevSql(r.id, rev, date, reason, cause, r, calc, user.name).args, ...gd.args] },
    ]);
    if (!res[0].meta?.changes && !res[0].changes) { out.skipped.push({ ...row, why: '다른 사람이 먼저 고쳤습니다.' }); continue; }
    out.changed.push({ ...row, rev });
  }
  return out;
}
// 공통 기준
route('GET', '/api/cost/rates', async ({ user }) => {
  requireCost(user); const t = today(), rows = (await db.prepare('SELECT * FROM cost_rates ORDER BY effective_date DESC, id DESC').all()).map(r => ({ ...r, fx: JSON.parse(r.fx || '{}') }));
  return { rows, current: rows.find(r => r.effective_date <= t) || null, next: [...rows].reverse().find(r => r.effective_date > t) || null, today: t };
});
route('POST', '/api/cost/rates', async ({ user, body }) => {
  requireCost(user); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM cost_rates WHERE request_id=?').get(key); if (old) return old; }
  const n = (v, l, hi) => { const x = Number(String(v ?? '').replace(/,/g, '')); if (v === '' || v == null || !Number.isFinite(x) || x < 0 || x > hi) throw bad(`${l}을(를) 0~${hi.toLocaleString('ko-KR')} 숫자로 넣으세요.`); return x; };
  const fx0 = body.fx && typeof body.fx === 'object' ? body.fx : {}, fx = {};
  for (const c of COST_CUR.slice(1)) { const v = fx0[c]; if (v !== '' && v != null) { const x = Number(String(v).replace(/,/g, '')); if (!(x > 0)) throw bad(`${c} 환율을 숫자로 넣으세요.`); fx[c] = x; } }
  const date = dateStr(body.effective_date || today(), '적용 시점'), first = !(await db.prepare('SELECT 1 FROM cost_rates').get());
  const reason = str(body.reason, 200); if (!first && !reason) throw bad('바꾸는 사유를 적으세요(예: 2026 최저임금 인상, 3개년 재무제표 갱신).');
  const r = await db.prepare('INSERT INTO cost_rates(effective_date,labor_rate,mfg_rate,sga_rate,defect_rate,fx,reason,note,request_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(date, n(body.labor_rate, '시간당 인건비', 1e7), n(body.mfg_rate, '제조경비율', 100), n(body.sga_rate, '판관비율', 100), n(body.defect_rate ?? 0, '불량률', 100), JSON.stringify(fx), reason || '최초 등록', str(body.note, 500), key, user.name);
  return { ...(await mustGet('cost_rates', r.lastInsertRowid)), fx };
});
route('DELETE', '/api/cost/rates/:id', async ({ user, params }) => {
  requireCost(user); const r = await mustGet('cost_rates', params.id);
  if ((await db.prepare('SELECT COUNT(*) c FROM cost_rates').get()).c < 2) throw bad('공통 기준이 하나뿐이라 지울 수 없습니다.');
  await db.prepare('DELETE FROM cost_rates WHERE id=?').run(r.id); return { ok: true };
});
// 원가 백데이터(원부자재·상품 단가)
route('GET', '/api/cost/materials', async ({ user }) => { requireCost(user); const t = today(); return { rows: await costMaterialsOut(t), rates: await costRatesAt(t), today: t }; });
route('GET', '/api/cost/materials/:id/prices', async ({ user, params }) => { requireCost(user); const m = await mustGet('cost_materials', params.id); return { material: m, rows: await db.prepare('SELECT * FROM cost_material_prices WHERE material_id=? ORDER BY effective_date, id').all(m.id) }; });
async function costMatBody(o, prior = {}) {
  const pick = k => o[k] === undefined ? prior[k] : o[k];
  return { name: reqStr(pick('name'), '원부자재명', 150), spec: str(pick('spec'), 150), category: str(pick('category'), 30), supplier: str(pick('supplier'), 100), unit: str(pick('unit'), 20), note: str(pick('note'), 500) };
}
route('POST', '/api/cost/materials', async ({ user, body }) => {
  requireCost(user); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM cost_materials WHERE request_id=?').get(key); if (old) return old; }
  const f = await costMatBody(body), p = costPriceBody(body, await costRatesAt(body.effective_date || today())); p.reason = p.reason || '최초 등록';
  const code = str(body.code, 40) || `M-${String(((await db.prepare('SELECT COUNT(*) c FROM cost_materials').get()).c + 1)).padStart(4, '0')}`;
  if (await db.prepare('SELECT 1 FROM cost_materials WHERE code=?').get(code)) throw bad(`이미 있는 코드입니다: ${code}`);
  await db.batch([
    { sql: 'INSERT INTO cost_materials(code,name,spec,category,supplier,unit,note,history,request_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [code, f.name, f.spec, f.category, f.supplier, f.unit, f.note, JSON.stringify([{ at: now(), by: user.name, what: `등록 · ${p.effective_date} 원화 ${p.krw_price}` }]), key, user.name] },
    { ...costPriceSql(null, p, null, user.name), sql: costPriceSql(0, p, null, user.name).sql.replace('VALUES(?,', 'VALUES((SELECT id FROM cost_materials WHERE code=?),'), args: [code, ...costPriceSql(0, p, null, user.name).args.slice(1)] },
  ]);
  return (await costMaterialsOut(today())).find(m => m.code === code);
});
route('PUT', '/api/cost/materials/:id', async ({ user, params, body }) => {
  requireCost(user); const prior = await mustGet('cost_materials', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = await costMatBody(body, prior), active = body.active === undefined ? prior.active : (body.active ? 1 : 0), code = body.code === undefined ? prior.code : reqStr(body.code, '코드', 40);
  if (code !== prior.code && await db.prepare('SELECT 1 FROM cost_materials WHERE code=? AND id<>?').get(code, prior.id)) throw bad(`이미 있는 코드입니다: ${code}`);
  const changed = ['name', 'spec', 'category', 'supplier', 'unit', 'note'].filter(k => prior[k] !== f[k]); if (code !== prior.code) changed.push('code'); if (active !== prior.active) changed.push('active');
  if (!changed.length) return (await costMaterialsOut(today())).find(m => m.id === prior.id);
  const r = await db.prepare("UPDATE cost_materials SET code=?,name=?,spec=?,category=?,supplier=?,unit=?,note=?,active=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?")
    .run(code, f.name, f.spec, f.category, f.supplier, f.unit, f.note, active, pushHist(prior, { by: user.name, what: active !== prior.active ? (active ? '다시 사용' : '사용 중지') : '수정', fields: changed }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return (await costMaterialsOut(today())).find(m => m.id === prior.id);
});
// 단가 변경: 새 시점 단가를 쌓고, 그 원부자재를 쓰는 품목의 원가 영향을 돌려준다(dry면 저장하지 않고 영향만). recalc면 영향 품목을 바로 재산출(리비전).
route('POST', '/api/cost/materials/:id/prices', async ({ user, params, body }) => {
  requireCost(user); const m = await mustGet('cost_materials', params.id), key = str(body.request_id, 80) || null;
  if (key && !body.dry) { const old = await db.prepare('SELECT * FROM cost_material_prices WHERE request_id=?').get(key); if (old) return { price: old, impact: { changed: [], unchanged: 0, skipped: [] } }; }
  const p = costPriceBody(body, await costRatesAt(body.effective_date || today())); if (!p.reason && !body.dry) throw bad('단가가 바뀐 사유를 적으세요(예: 26년 5월 공급가 인상 +4%).'); /* 15.319 영향 미리 보기는 사유 없이 */
  if (await db.prepare('SELECT 1 FROM cost_material_prices WHERE material_id=? AND effective_date=? AND krw_price=? AND price=?').get(m.id, p.effective_date, p.krw_price, p.price)) throw bad('같은 시점에 같은 단가가 이미 있습니다.');
  if (body.dry) {
    // 미리 보기: 이 단가를 그 시점에 넣었다고 치고 영향 계산
    const [rt, pr] = [await costRatesAt(p.effective_date), await costPricesAt(p.effective_date)]; pr[m.id] = { ...p, material_id: m.id };
    const rows = (await db.prepare('SELECT * FROM cost_items WHERE active=1').all()).filter(r => JSON.parse(r.lines || '[]').some(l => l.material_id === m.id && !l.manual_price));
    return { price: p, impact: { changed: rows.map(r => { const c = costCompute(r, rt, pr), o = JSON.parse(r.totals || '{}'); return { id: r.id, item_code: r.item_code, name: r.name, old_total: o.total ?? null, new_total: c.totals.total, pct: o.total ? cr2((c.totals.total - o.total) / o.total * 100) : null, sale_price: r.sale_price, new_margin_rate: c.totals.margin_rate }; }).filter(x => Math.abs((x.new_total || 0) - (x.old_total || 0)) > 0.005), unchanged: 0, skipped: [] } };
  }
  await db.batch([costPriceSql(m.id, p, key, user.name), { sql: "UPDATE cost_materials SET history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=?", args: [pushHist(m, { by: user.name, what: `단가 ${p.effective_date} · ${p.currency} ${p.price}${p.surcharge ? ' + ' + p.surcharge : ''} → 원화 ${p.krw_price} · ${p.reason}` }), user.name, m.id] }]);
  const impact = body.recalc ? await costRecalc(user, { material_id: m.id, date: p.effective_date, reason: `${m.name} 단가 변경 · ${p.reason}`, cause: 'material' }) : await costRecalc(user, { material_id: m.id, date: p.effective_date, reason: '', cause: 'material', dry: true });
  return { price: p, impact, recalculated: !!body.recalc };
});
route('DELETE', '/api/cost/materials/:id/prices/:pid', async ({ user, params }) => {
  requireCost(user); const m = await mustGet('cost_materials', params.id), p = await db.prepare('SELECT * FROM cost_material_prices WHERE id=? AND material_id=?').get(params.pid, m.id); if (!p) throw bad('단가 이력을 찾을 수 없습니다.');
  if ((await db.prepare('SELECT COUNT(*) c FROM cost_material_prices WHERE material_id=?').get(m.id)).c < 2) throw bad('단가가 하나뿐이라 지울 수 없습니다.');
  await db.batch([{ sql: 'DELETE FROM cost_material_prices WHERE id=?', args: [p.id] }, { sql: "UPDATE cost_materials SET history=?,revision=revision+1 WHERE id=?", args: [pushHist(m, { by: user.name, what: `단가 이력 삭제 · ${p.effective_date} 원화 ${p.krw_price}` }), m.id] }]);
  return { ok: true };
});
// 엑셀에서 붙여넣은 백데이터 여러 줄: 코드가 있으면 단가가 다를 때만 새 시점 단가, 없으면 새로 등록
route('POST', '/api/cost/materials/bulk', async ({ user, body }) => {
  requireCost(user); const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : []; if (!rows.length) throw bad('붙여넣은 줄이 없습니다.');
  const out = { created: 0, priced: 0, same: 0, errors: [] }; let seq = (await db.prepare('SELECT COUNT(*) c FROM cost_materials').get()).c;
  for (const [i, o] of rows.entries()) {
    try {
      const date = o.effective_date || today(), p = costPriceBody({ ...o, effective_date: date }, await costRatesAt(date)), code = str(o.code, 40);
      const ex = code ? await db.prepare('SELECT * FROM cost_materials WHERE code=?').get(code) : null;
      if (ex) {
        const cur = (await db.prepare('SELECT * FROM cost_material_prices WHERE material_id=? AND effective_date<=? ORDER BY effective_date DESC, id DESC LIMIT 1').get(ex.id, p.effective_date));
        if (cur && Math.abs(cur.krw_price - p.krw_price) < 0.00005 && cur.price === p.price) { out.same++; continue; }
        p.reason = p.reason || '엑셀 붙여넣기'; await db.batch([costPriceSql(ex.id, p, null, user.name)]); out.priced++;
      } else {
        const f = await costMatBody(o), c = code || `M-${String(++seq).padStart(4, '0')}`; p.reason = p.reason || '엑셀 붙여넣기 등록';
        await db.batch([{ sql: 'INSERT INTO cost_materials(code,name,spec,category,supplier,unit,note,history,created_by) VALUES(?,?,?,?,?,?,?,?,?)', args: [c, f.name, f.spec, f.category, f.supplier, f.unit, f.note, JSON.stringify([{ at: now(), by: user.name, what: '엑셀 붙여넣기 등록' }]), user.name] },
          { sql: costPriceSql(0, p, null, user.name).sql.replace('VALUES(?,', 'VALUES((SELECT id FROM cost_materials WHERE code=?),'), args: [c, ...costPriceSql(0, p, null, user.name).args.slice(1)] }]);
        out.created++;
      }
    } catch (e) { out.errors.push(`${i + 1}번 줄: ${e.message}`); }
  }
  return out;
});
// 품목별 원가
route('GET', '/api/cost/items', async ({ user, query }) => {
  const stage = ['dev', 'all'].includes(query.stage) ? query.stage : 'mass'; if (stage === 'all') { if (!costCanStage(user, 'dev')) requireCost(user); } else requireCostStage(user, stage);
  const t = today(), rows = (await costItemsAll()).filter(r => (stage === 'all' || r.stage === stage) && costCanStage(user, r.stage)), live = await costLive(rows, t), revs = await db.prepare('SELECT item_id, rev, effective_date, totals FROM cost_item_revs ORDER BY item_id, rev').all();
  return { rows: rows.map((r, i) => costRowOut(r, live[i], revs)), materials: (await costMaterialsOut(t)).filter(m => m.active).map(m => ({ id: m.id, code: m.code, name: m.name, spec: m.spec, unit: m.unit, supplier: m.supplier, category: m.category, krw_price: m.current?.krw_price ?? null, price_date: m.current?.effective_date || null })),
    rates: await costRatesAt(t), boms: await db.prepare("SELECT id, product, product_code, item_category FROM boms ORDER BY product LIMIT 3000").all().catch(() => []), today: t, stage,
    dev_requests: costCanStage(user, 'dev') ? await db.prepare("SELECT id, req_no, title, customer, status FROM requests WHERE type='development' ORDER BY id DESC LIMIT 2000").all() : [], can_purchase: hasRole(user, 'purchase') };
});
route('GET', '/api/cost/items/:id/revs', async ({ user, params }) => {
  const it = await mustGet('cost_items', params.id); requireCostStage(user, it.stage);
  return { item: it, rows: (await db.prepare('SELECT * FROM cost_item_revs WHERE item_id=? ORDER BY rev').all(it.id)).map(r => ({ ...r, header: JSON.parse(r.header), lines: JSON.parse(r.lines), rates: JSON.parse(r.rates), totals: JSON.parse(r.totals), cause_label: COST_CAUSE[r.cause] || r.cause })) };
});
route('POST', '/api/cost/items', async ({ user, body }) => {
  const stage = body.stage === 'dev' ? 'dev' : 'mass'; requireCostStage(user, stage); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM cost_items WHERE request_id=?').get(key); if (old) return old; }
  const f = await costItemBody(body), date = dateStr(body.effective_date || today(), '원가 산출 시점'), calc = costCompute(f, await costRatesAt(date), await costPricesAt(date));
  const code = str(body.item_code, 40) || `${stage === 'dev' ? 'DEV' : 'CI'}-${String(((await db.prepare('SELECT COUNT(*) c FROM cost_items WHERE stage=?').get(stage)).c + 1)).padStart(4, '0')}`;
  if (await db.prepare('SELECT 1 FROM cost_items WHERE item_code=?').get(code)) throw bad(`이미 있는 품목코드입니다: ${code}`);
  const reason = str(body.reason, 200) || '최초 산출';
  await db.batch([
    { sql: `INSERT INTO cost_items(item_code,stage,${COST_ITEM_COLS.join(',')},rev,rev_date,totals,history,request_id,created_by) VALUES(?,?,${COST_ITEM_COLS.map(() => '?').join(',')},0,?,?,?,?,?)`, args: [code, stage, ...COST_ITEM_COLS.map(k => f[k]), date, JSON.stringify(calc.totals), JSON.stringify([{ at: now(), by: user.name, what: `Rev.0 최초 산출 · 원가 ${calc.totals.total}` }]), key, user.name] },
    { ...costRevSql(0, 0, date, reason, 'create', f, calc, user.name), sql: costRevSql(0, 0, date, reason, 'create', f, calc, user.name).sql.replace('VALUES(?,', 'VALUES((SELECT id FROM cost_items WHERE item_code=?),'), args: [code, ...costRevSql(0, 0, date, reason, 'create', f, calc, user.name).args.slice(1)] },
  ]);
  const t = today(), rows = await costItemsAll(), r = rows.find(x => x.item_code === code); return costRowOut(r, (await costLive([r], t))[0], await db.prepare('SELECT item_id, rev, effective_date, totals FROM cost_item_revs WHERE item_id=? ORDER BY rev').all(r.id));
});
// 수정: 원가에 영향을 주는 내용(원가 줄·기준 덮어쓰기·판관비 기준·낱개 수·구분)이 바뀌거나 계산 원가가 달라지면 새 리비전(변동 시점·사유 필수).
// 판매가·고객·포장사양 같은 머리 정보만 바뀌면 리비전 없이 고친다(이력에 남음).
route('PUT', '/api/cost/items/:id', async ({ user, params, body }) => {
  const prior = await mustGet('cost_items', params.id); requireCostStage(user, prior.stage);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = await costItemBody(body, prior), code = body.item_code === undefined ? prior.item_code : reqStr(body.item_code, '품목코드', 40), active = body.active === undefined ? prior.active : (body.active ? 1 : 0);
  if (code !== prior.item_code && await db.prepare('SELECT 1 FROM cost_items WHERE item_code=? AND id<>?').get(code, prior.id)) throw bad(`이미 있는 품목코드입니다: ${code}`);
  const date = dateStr(body.effective_date || today(), '원가 변동 시점'), calc = costCompute(f, await costRatesAt(date), await costPricesAt(date)), old = JSON.parse(prior.totals || '{}');
  const costChanged = costCostKey(f) !== costCostKey(prior) || Math.abs((calc.totals.total || 0) - (old.total || 0)) > 0.005;
  const changed = COST_ITEM_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (code !== prior.item_code) changed.push('item_code'); if (active !== prior.active) changed.push('active');
  if (!changed.length && !costChanged) return { ...costRowOut(prior, null, []), unchanged: true };
  let stmts;
  if (costChanged) {
    const reason = str(body.reason, 200); if (!reason) throw bad('원가가 바뀌었습니다. 변경 사유를 적으세요(예: 원단 단가 인상, 포장 사양 변경).');
    if (prior.rev_date && date < prior.rev_date) throw bad(`변동 시점은 마지막 리비전 시점(${prior.rev_date}) 이후로 넣으세요.`);
    const rev = prior.rev + 1, tok = randomHex(8), gd = tokGuard('cost_items', prior.id, prior.revision + 1, tok), rs = costRevSql(prior.id, rev, date, reason, 'manual', f, calc, user.name);
    stmts = [{ sql: `UPDATE cost_items SET item_code=?,${COST_ITEM_COLS.map(k => k + '=?').join(',')},active=?,rev=?,rev_date=?,totals=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`,
      args: [code, ...COST_ITEM_COLS.map(k => f[k]), active, rev, date, JSON.stringify(calc.totals), pushHist(prior, { by: user.name, what: `Rev.${rev} ${reason} · 원가 ${old.total ?? '-'} → ${calc.totals.total}`, fields: changed, tok }), user.name, prior.id, prior.revision] },
      { sql: rs.sql.replace(') VALUES(?,?,?,?,?,?,?,?,?,?)', ') SELECT ?,?,?,?,?,?,?,?,?,? WHERE ' + gd.sql), args: [...rs.args, ...gd.args] }];
  } else {
    const t2 = { ...old, sale_price: calc.totals.sale_price, margin: calc.totals.margin, margin_rate: calc.totals.margin_rate, piece_cost: calc.totals.piece_cost };
    stmts = [{ sql: `UPDATE cost_items SET item_code=?,${COST_ITEM_COLS.map(k => k + '=?').join(',')},active=?,totals=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`,
      args: [code, ...COST_ITEM_COLS.map(k => f[k]), active, JSON.stringify(t2), pushHist(prior, { by: user.name, what: active !== prior.active ? (active ? '다시 사용' : '사용 중지') : '수정(원가 변동 없음)', fields: changed }), user.name, prior.id, prior.revision] }];
  }
  const res = await db.batch(stmts); if (!(res[0].meta?.changes ?? res[0].changes)) throw conflict();
  const r = await mustGet('cost_items', prior.id); return costRowOut(r, (await costLive([r], today()))[0], await db.prepare('SELECT item_id, rev, effective_date, totals FROM cost_item_revs WHERE item_id=? ORDER BY rev').all(r.id));
});
// 15.321 양산 전환: 연구소 예상 원가(stage=dev)를 구매 양산 원가로 넘긴다. 원가표·리비전·사양은 그대로, 이후 수정은 구매가 한다.
route('POST', '/api/cost/items/:id/promote', async ({ user, params, body }) => {
  const prior = await mustGet('cost_items', params.id); requireCostStage(user, 'dev'); if (prior.stage !== 'dev') throw bad('이미 양산 원가입니다.');
  if (Number(body.revision) !== prior.revision) throw conflict();
  const res = await db.prepare("UPDATE cost_items SET stage='mass',history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?").run(pushHist(prior, { by: user.name, what: `양산 전환(연구소 예상 원가 → 구매 양산 원가) · Rev.${prior.rev} 원가 ${JSON.parse(prior.totals || '{}').total ?? '-'}${str(body.note, 200) ? ' · ' + str(body.note, 200) : ''}` }), user.name, prior.id, prior.revision);
  if (!(res.meta?.changes ?? res.changes)) throw conflict();
  const r = await mustGet('cost_items', prior.id); return costRowOut(r, (await costLive([r], today()))[0], await db.prepare('SELECT item_id, rev, effective_date, totals FROM cost_item_revs WHERE item_id=? ORDER BY rev').all(r.id));
});
route('POST', '/api/cost/items/recalc', async ({ user, body }) => {
  const date = dateStr(body.effective_date || today(), '변동 시점'), reason = str(body.reason, 200);
  if (!body.dry && !reason) throw bad('재산출 사유를 적으세요(예: 2026 공통 기준 적용).');
  const ids = Array.isArray(body.ids) ? body.ids.map(optId).filter(Boolean) : null;
  if (!hasRole(user, 'purchase')) { /* 15.321 연구소는 자기 예상 원가(stage=dev)만 골라 재산출 */
    if (!ids?.length || !isResearcher(user)) requireCost(user);
    const st = await db.prepare(`SELECT stage FROM cost_items WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids); if (st.some(x => x.stage !== 'dev')) requireCost(user);
  }
  return costRecalc(user, { ids, material_id: optId(body.material_id), rates: !!body.rates, date, reason, cause: body.rates ? 'rates' : body.material_id ? 'material' : 'manual', dry: !!body.dry });
});
// 15.312 통합 번호 검색(메뉴 찾기 칸): NC-·COA-·CHG-·AUD-·VAL-·REL-·RSK-·문서번호·설비번호·시험법·의뢰 번호와 제목으로 기록을 찾는다.
// 열람 제한이 있는 품질 문서는 qdocVisible로 거르고, 나머지는 화면(메뉴 권한)에서 다시 거른다. 종류마다 5건, 모두 25건까지.
route('GET', '/api/find', async ({ user, query }) => {
  const q = str(query.q, 60).trim(); if (q.replace(/[%_\\\s]/g, '').length < 2) return { rows: [] }; // 15.315 %·_만으로 전부 나오지 않게
  const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%', rows = []; // 15.315 _ 지우지 않고 이스케이프(LOT 261121_NX808 찾기)
  const add = async (type, sub, href, sql, map) => { for (const r of await db.prepare(sql).all(like, like)) rows.push({ type, sub, href, ...map(r) }); };
  await add('nc', '부적합·CAPA', '#/quality/capa', "SELECT id, nc_no, title, status FROM nonconformities WHERE nc_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.nc_no, label: r.title, state: NC_STATUS[r.status] }));
  await add('coa', 'COA 발행', '#/quality/coa', "SELECT id, coa_no, lot, item, status FROM coas WHERE coa_no LIKE ? ESCAPE '\\' OR lot LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.coa_no, label: `${r.item} · LOT ${r.lot}`, state: { draft: '작성', approved: '발행', void: '무효' }[r.status] }));
  await add('change', '변경관리', '#/quality/changes', "SELECT id, change_no, title, status FROM quality_changes WHERE change_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.change_no, label: r.title, state: CHG_STATUS[r.status] }));
  for (const r of await db.prepare("SELECT * FROM quality_docs WHERE doc_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY doc_no LIMIT 20").all(like, like)) if (qdocVisible(r, user) && rows.filter(x => x.type === 'doc').length < 5) rows.push({ type: 'doc', sub: '문서관리', href: '#/quality/docs', id: r.id, no: r.doc_no, label: r.title, state: QDOC_STATUS[r.status] });
  await add('audit', '심사 관리', '#/quality/audits', "SELECT id, audit_no, title, status FROM quality_audits WHERE audit_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.audit_no, label: r.title, state: AUD_STATUS[r.status] }));
  await add('validation', '밸리데이션', '#/quality/validation', "SELECT id, val_no, title, status FROM validations WHERE val_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.val_no, label: r.title, state: VAL_STATUS[r.status] }));
  await add('reliability', '신뢰성평가', '#/quality/methods', "SELECT id, test_no, title, status FROM reliability_tests WHERE test_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.test_no, label: r.title, state: REL_STATUS[r.status] }));
  await add('risk', '리스크 관리', '#/quality/risks', "SELECT id, risk_no, content, status FROM quality_risks WHERE risk_no LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.risk_no, label: r.content, state: RISK_STATUS[r.status] }));
  await add('equipment', '설비 대장', '#/prod/equipment', "SELECT id, equip_no, name, status FROM equipment WHERE equip_no LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' ORDER BY equip_no LIMIT 5", r => ({ id: r.id, no: r.equip_no, label: r.name, state: EQ_STATUS[r.status] }));
  await add('method', '시험법', '#/quality/methods', "SELECT id, method_no, name, status FROM test_methods WHERE method_no LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' ORDER BY method_no LIMIT 5", r => ({ id: r.id, no: r.method_no, label: r.name, state: r.status === 'active' ? '사용' : '폐지' }));
  await add('ra', '위험성평가', '#/prod/risk', "SELECT id, ra_no, method, title, status FROM risk_assessments WHERE ra_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.ra_no, label: `${RA_METHOD[r.method]} · ${r.title}`, state: RA_STATUS[r.status] }));
  if (isResearcher(user)) await add('devcost', '개발비 기록', '#/dev/cost/expenses', "SELECT id, cost_no, title, status FROM dev_costs WHERE cost_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.cost_no, label: r.title, state: DC_STATUS[r.status] })); // 15.316 연구소만
  if (hasRole(user, 'purchase')) await add('costitem', '원가 산출', '#/purchase/cost', "SELECT id, item_code, name, active FROM cost_items WHERE stage='mass' AND (item_code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY item_code LIMIT 5", r => ({ id: r.id, no: r.item_code, label: r.name, state: r.active ? '사용' : '중지' })); // 15.318 구매만
  if (costCanStage(user, 'dev')) await add('costdev', '양산 원가 예측', '#/dev/cost', "SELECT id, item_code, name, active FROM cost_items WHERE stage='dev' AND (item_code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY item_code LIMIT 5", r => ({ id: r.id, no: r.item_code, label: r.name, state: r.active ? '사용' : '중지' })); // 15.321 연구소 예상 원가
  await add('request', '의뢰', '', "SELECT id, req_no, type, title, status FROM requests WHERE req_no LIKE ? ESCAPE '\\' OR (req_no IS NOT NULL AND title LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 5", r => ({ id: r.id, no: r.req_no, label: r.title, rtype: r.type, state: r.status }));
  return { rows: rows.slice(0, 25) };
});
route('GET', '/api/rnd-specs', async ({ user }) => { const { raw, ...lib } = await rndSpecLibrary(); return { ...lib, can_manage: isResearcher(user) }; });
route('PUT', '/api/rnd-specs', async ({ user, body }) => {
  if (!isResearcher(user)) throw new HttpError(403, '연구소 검사규격은 연구원(개발·개발책임자)만 설정합니다.');
  const prior = await rndSpecLibrary(); if (Number(body.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 검사규격을 바꿨습니다. 다시 열어 주세요.');
  const spec = rndSpecValidate(body.spec), id = Number(body.spec?.id) || 0, specs = [...prior.specs];
  if (specs.some(x => x.id !== id && x.name.toLowerCase() === spec.name.toLowerCase() && (x.group || '') === spec.group)) throw bad(`「${spec.group ? spec.group + ' · ' : ''}${spec.name}」 규격이 이미 있습니다.`);
  const stamp = { updated_by: user.name, updated_at: now() };
  if (id) { const i = specs.findIndex(x => x.id === id); if (i < 0) throw new HttpError(404, '검사규격을 찾을 수 없습니다.'); specs[i] = { ...specs[i], ...spec, ...stamp }; }
  else { if (specs.length >= 200) throw bad('연구소 검사규격은 200개까지입니다.'); specs.push({ id: specs.reduce((m, x) => Math.max(m, x.id), 0) + 1, ...spec, ...stamp }); }
  return { ...(await rndSpecWrite(prior, specs)), can_manage: true };
});
route('DELETE', '/api/rnd-specs/:id', async ({ user, params, query }) => {
  if (!isResearcher(user)) throw new HttpError(403, '연구소 검사규격은 연구원(개발·개발책임자)만 설정합니다.');
  const prior = await rndSpecLibrary(); if (Number(query.revision) !== prior.revision) throw new HttpError(409, '다른 사람이 검사규격을 바꿨습니다. 다시 열어 주세요.');
  const id = Number(params.id); if (!prior.specs.some(x => x.id === id)) throw new HttpError(404, '검사규격을 찾을 수 없습니다.');
  return { ...(await rndSpecWrite(prior, prior.specs.filter(x => x.id !== id))), can_manage: true };
});
// 15.299 저장된 측정값(규격 스냅숏 + 값)으로 짧은 요약: 불합격 항목만, 없으면 「전 항목 합격」. 예전 긴 결과 글도 화면에서는 이것으로.
function rndShort(snapshot, valuesJson, memo = '') {
  try { const spec = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot, rows = typeof valuesJson === 'string' ? JSON.parse(valuesJson) : valuesJson;
    if (!spec?.items?.length || !rows?.length) return '';
    const sum = rndMeasure(spec.items, null, rows.map(x => ({ lot: x.lot, values: Object.fromEntries(spec.items.map((it, i) => ['i' + i, x.values?.[it.key || 'i' + i] || []])) }))).summary;
    return sum + (memo ? ` / 의견: ${memo}` : ''); } catch { return ''; }
}
// 15.305 품질 분석의뢰(의뢰검사·공정검사)도 같은 측정 그리드: 항목·기준(하한~상한)·데이터를 의뢰서에 미리 적지 않아도 바로 넣는다. 수입·출하검사는 기존 검사 화면.
const measureTarget = r => r.type === 'rnd_analysis' ? 'rnd' : r.type === 'analysis' && !['수입검사', '출하검사'].includes(r.category) ? 'quality' : '';
route('GET', '/api/requests/:id/rnd-measure', async ({ params }) => {
  const r = await getRequest(params.id); if (!measureTarget(r)) throw bad('연구 분석·품질 분석의뢰만 볼 수 있습니다.');
  const m = await db.prepare('SELECT * FROM inspection_measurements WHERE request_id=?').get(r.id);
  const spec = r.inspection_snapshot ? JSON.parse(r.inspection_snapshot) : null, rows = m ? JSON.parse(m.values_json) : null;
  const summary = rndShort(spec, rows); // 15.299
  return { spec, measurement: m ? { ...m, rows } : null, memo: JSON.parse(r.data || '{}').memo || '', summary };
});
route('PUT', '/api/requests/:id/rnd-measure', async ({ user, params, body }) => {
  const r = await getRequest(params.id), target = measureTarget(r); if (!target) throw bad('연구 분석·품질 분석의뢰만 고칠 수 있습니다.');
  if (target === 'rnd' && !isResearcher(user)) throw new HttpError(403, '측정값은 연구원(개발·개발책임자)만 고칩니다.');
  if (target === 'quality') { requireRole(user, 'quality', '품질'); if (!WORK_STATUSES.includes(r.status)) throw bad('분석의뢰를 접수(승인)한 뒤 측정값을 넣으세요.'); }
  const meas = rndMeasure(body.spec_items, body.values, body.samples); if (!meas) throw bad('측정 항목을 넣으세요.');
  const prior = await db.prepare('SELECT * FROM inspection_measurements WHERE request_id=?').get(r.id);
  const reason = prior ? reqStr(body.reason, '수정 사유', 300) : str(body.reason, 300) || '측정값 입력';
  const d = JSON.parse(r.data || '{}'), memo = body.result_note !== undefined ? str(body.result_note, 1000) : d.memo || '';
  const result = (meas.summary + (memo ? ` / 의견: ${memo}` : '')).slice(0, 1000), token = randomHex(16);
  const cmds = [{ sql: "UPDATE requests SET inspection_snapshot=?, result_note=?, data=json_set(data,'$.memo',?), updated_at=datetime('now','+9 hours') WHERE id=?", args: [JSON.stringify(meas.snapshot), result, memo, r.id] },
    { sql: `INSERT INTO inspection_measurements(request_id,values_json,result,save_token,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET values_json=excluded.values_json,result=excluded.result,save_token=excluded.save_token,updated_by=excluded.updated_by,revision=inspection_measurements.revision+1,updated_at=datetime('now','+9 hours')`, args: [r.id, JSON.stringify(meas.rows), meas.result, token, user.name] },
    { sql: 'INSERT INTO inspection_measurement_history(request_id,revision,values_json,result,reason,saved_by) SELECT request_id,revision,values_json,result,?,updated_by FROM inspection_measurements WHERE request_id=? AND save_token=?', args: [reason, r.id, token] },
    { sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: ['request', r.id, `[분석결과] 측정값 ${prior ? '수정' : '입력'}${prior ? ` · 사유: ${reason}` : ''} · ${result}`.slice(0, 2000), user.id, user.name] }];
  if (d.dev_request_id) cmds.push(rndDevNote(user, d.dev_request_id, `${r.req_no} ${r.title} 측정값 ${prior ? '수정' : '입력'}${d.dev_step ? ` · 단계 「${d.dev_step}」` : ''} · ${result}`));
  await db.batch(cmds);
  return decodeRequest(await getRequest(r.id));
});
route('POST', '/api/dev-roadmap/:id/analysis-data', async ({ user, params, body }) => createRndData(user, body, params.id));
route('POST', '/api/rnd-analysis-data', async ({ user, body }) => createRndData(user, body, body.dev_request_id ?? '')); // 15.288 연구 분석 관리 › 분석데이터 입력
// 15.286 이미 있는 연구 분석을 개발건·단계에 연결(바꾸기·끊기). 연구 담당·승인권자·의뢰자.
route('POST', '/api/requests/:id/dev-link', async ({ user, params, body }) => {
  const r = await getRequest(params.id); if (r.type !== 'rnd_analysis') throw bad('연구 분석의뢰만 개발건에 연결합니다.');
  if (!(hasRole(user, 'dev') || hasRole(user, 'dev_approver') || r.requester_id === user.id)) throw new HttpError(403, '연구 담당자 또는 의뢰자만 연결할 수 있습니다.');
  const d = JSON.parse(r.data || '{}'), before = d.dev_request_id || null, beforeStep = d.dev_step || '';
  d.dev_request_id = body.dev_request_id; d.dev_step = body.dev_step;
  const dev = await rndDevLink(d);
  const cmds = [{ sql: "UPDATE requests SET data=?, updated_at=datetime('now','+9 hours') WHERE id=?", args: [JSON.stringify(d), r.id] }];
  const label = `${r.req_no || ''} ${r.title}`.trim();
  if (before && before !== dev?.id) cmds.push(rndDevNote(user, before, `연결 해제 · ${label}`));
  if (dev && (before !== dev.id || beforeStep !== (d.dev_step || ''))) cmds.push(rndDevNote(user, dev.id, `분석 연결 · ${label} (${r.category})${d.dev_step ? ` · 단계 「${d.dev_step}」` : ''}${r.result_note ? ` · 결과: ${r.result_note}` : ''}`));
  await db.batch(cmds);
  return decodeRequest(await getRequest(r.id));
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
// 1차·2차·3차 세부 분류는 미리 만든 분류(item_category_nodes)에서만 고른다. 바꾸지 않은 기존 경로는 그대로 둔다.
// 반제품은 경로에서 가장 깊은 생산 종류(semi_type)를 물려받아 커팅/융착·세탁 입력에 나온다.
async function bomCategoryPath(body, category, previous = {}) {
  const cats = ['cat1', 'cat2', 'cat3'].map(key => body[key] === undefined ? previous[key] || '' : str(body[key], 50));
  if ((cats[1] && !cats[0]) || (cats[2] && !cats[1])) throw bad('2차 분류는 1차, 3차 분류는 2차를 먼저 선택하세요.');
  const unchanged = previous.item_category === category && cats.every((value, i) => value === (previous['cat' + (i + 1)] || ''));
  let parent = 0, semiType = '';
  for (const [i, name] of cats.entries()) {
    if (!name) break;
    const node = await db.prepare('SELECT * FROM item_category_nodes WHERE item_class=? AND level=? AND COALESCE(parent_id,0)=? AND name=?').get(category, i + 1, parent, name);
    if (!node || (!node.active && !unchanged)) throw bad(`${i + 1}차 분류 「${name}」는 ${category}의 세부 분류에 없습니다. 분류 관리에서 먼저 만들어 주세요.`);
    if (node.semi_type) semiType = node.semi_type;
    parent = node.id;
  }
  return { cats, semiType };
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
  const sizesOf = await sizeSets();
  return (await db.prepare(`SELECT * FROM boms ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY product,id`).all(...args)).map(row => ({ ...decodeBom(row), sizes: sizesOf(row.item_category, [row.cat1, row.cat2, row.cat3]) }));
});
// Category values already in use, for suggestions and filters.
route('GET', '/api/boms/categories', async () => db.prepare("SELECT DISTINCT cat1,cat2,cat3 FROM boms WHERE active=1 AND cat1<>'' ORDER BY cat1,cat2,cat3 LIMIT 2000").all());
// The production kind of a 반제품 comes from its category; an item without a category keeps the older explicit value.
const isChecked = v => Array.isArray(v) ? v.length > 0 : v === true || v === 1 || v === "1" || v === "on";
// 반제품 품목은 분류에서 생산 종류를 정한다. 다른 품목은 '반제품으로도 사용'을 켜고 종류·생산 단위·환산을 직접 정한다.
async function bomPlacement(body, category, previous = {}, unit = '') {
  const { cats, semiType } = await bomCategoryPath(body, category, previous);
  if (category === '반제품') {
    const explicit = body.semi_type === undefined && !cats[0] ? previous.semi_type || '' : str(body.semi_type, 20);
    if (explicit && !SEMI_TYPE_NAMES.includes(explicit)) throw bad('반제품 종류를 다시 선택하세요.');
    return { cats, semiType: cats[0] ? semiType || (cats.every((v, i) => v === (previous['cat' + (i + 1)] || '')) ? previous.semi_type || '' : '') : explicit, semiUnit: '', packQty: null };
  }
  const enabled = body.semi_enabled === undefined ? !!previous.semi_type : isChecked(body.semi_enabled);
  if (!enabled) { if (str(body.semi_type, 20)) throw bad('반제품이 아닌 품목은 「반제품으로도 사용」을 켜야 생산 종류를 지정할 수 있습니다.'); return { cats, semiType: '', semiUnit: '', packQty: null }; }
  const type = str(body.semi_type === undefined ? previous.semi_type : body.semi_type, 20);
  if (!SEMI_TYPE_NAMES.includes(type)) throw bad('반제품으로도 사용할 때는 생산 종류를 선택하세요.');
  const semiUnit = str(body.semi_unit === undefined ? previous.semi_unit : body.semi_unit, 20) || (['스무드', '타키'].includes(type) ? '켤레' : '매');
  let packQty = null;
  if (semiUnit !== unit) {
    const raw = body.pack_qty === undefined ? previous.pack_qty : body.pack_qty;
    packQty = Number(raw); if (!Number.isFinite(packQty) || packQty <= 0) throw bad(`단위 환산을 입력하세요. (1 ${unit} = 몇 ${semiUnit}인지)`);
  }
  return { cats, semiType: type, semiUnit, packQty };
}
// 15.106 제품코드는 대소문자를 가리지 않고 하나만(빈 코드 제외). 순환 구성자재 막기. 이름·코드를 바꾸면 그 이름·코드로 저장된 기록도 따라간다.
const CODE_TABLES = ['purchase_orders', 'shipments', 'semi_records', 'purchase_request_items', 'production_request_lines', 'purchase_bill_lines', 'sales_bill_lines', 'sales_order_lines', 'ship_instructions'];
async function bomCodeClash(code, id = 0) {
  if (!code) return;
  const other = await db.prepare("SELECT product, product_code, active, is_temp FROM boms WHERE product_code<>'' AND UPPER(product_code)=UPPER(?) AND id<>?").get(code, id);
  // 15.192 사용 중지(목록의 「사용」에서 안 보임)·임시 품목이 코드를 쥐고 있으면 그렇다고 알려 준다(어디서 찾을지).
  if (other && !other.active) throw new HttpError(409, `제품코드 ${code}는 사용 중지된 품목 「${other.product}」에서 쓰고 있습니다. 제품등록 목록의 「미사용」에서 그 품목을 찾아 다시 사용하거나, 그 품목의 코드를 바꾸거나 「완전 삭제」한 뒤 등록하세요.`);
  if (other) throw new HttpError(409, `제품코드 ${code}는 ${other.is_temp ? '임시 품목 ' : ''}「${other.product}」(${other.product_code})에서 이미 쓰고 있습니다.`);
}
async function bomCycleCheck(product, materialsJson, id = 0) {
  const self = nameKey(product), mats = JSON.parse(materialsJson);
  if (mats.some(m => nameKey(m.item) === self)) throw bad(`「${product}」는 자기 자신을 구성자재로 넣을 수 없습니다.`);
  const all = await db.prepare('SELECT id, product, materials FROM boms WHERE active=1 AND id<>?').all(id);
  const graph = new Map(); for (const b of all) graph.set(nameKey(b.product), JSON.parse(b.materials || '[]').map(m => nameKey(m.item)));
  graph.set(self, mats.map(m => nameKey(m.item)));
  const seen = new Set(), stack = [...graph.get(self)];
  while (stack.length) {
    const k = stack.pop(); if (k === self) throw bad(`「${product}」의 구성자재를 따라가면 다시 「${product}」가 나옵니다(순환 BOM). 구성자재를 확인하세요.`);
    if (seen.has(k)) continue; seen.add(k); for (const n of graph.get(k) || []) stack.push(n);
  }
}
async function bomFollowRename(before, product, code) {
  const cmds = [], oldKey = nameKey(before.product), renamed = product !== before.product, recoded = (code || '') !== (before.product_code || '');
  if (recoded && before.product_code) {
    for (const t of CODE_TABLES) cmds.push({ sql: `UPDATE ${t} SET product_code=? WHERE product_code=?`, args: [code, before.product_code] });
  }
  if (renamed) {
    // 다른 제품의 구성자재 이름
    const users = await db.prepare("SELECT id, materials FROM boms WHERE id<>? AND EXISTS(SELECT 1 FROM json_each(boms.materials) m WHERE REPLACE(LOWER(json_extract(m.value,'$.item')),' ','')=?)").all(before.id, oldKey);
    for (const b of users) { const mats = JSON.parse(b.materials).map(m => nameKey(m.item) === oldKey ? { ...m, item: product } : m); cmds.push({ sql: "UPDATE boms SET materials=?,updated_at=datetime('now','+9 hours') WHERE id=?", args: [JSON.stringify(mats), b.id] }); }
    // 이 품목으로 연결된 기록의 품목명(코드·bom_id로 확실히 이어진 것만). 재고는 품목명으로 묶이므로 같이 바꿔야 끊기지 않는다.
    if (before.product_code) for (const t of ['purchase_orders', 'shipments']) cmds.push({ sql: `UPDATE ${t} SET item=? WHERE product_code=? AND item=?`, args: [product, code || before.product_code, before.product] });
    cmds.push({ sql: 'UPDATE other_receipts SET item=? WHERE bom_id=? AND item=?', args: [product, before.id, before.product] });
    const sameName = await db.prepare('SELECT COUNT(*) c FROM boms WHERE id<>? AND product=?').get(before.id, before.product);
    if (!sameName.c) cmds.push({ sql: 'UPDATE stock_adjustments SET item=? WHERE TRIM(item)=?', args: [product, before.product] });
  }
  return cmds;
}
route('POST', '/api/boms', async ({ user, body }) => {
  requireAdmin(user);
  const fields = bomFields(body), { cats, semiType, semiUnit, packQty } = await bomPlacement(body, fields[8], {}, fields[4]);
  if (semiType && !fields[1]) throw bad('커팅/융착·세탁에서 고를 품목은 제품코드가 필요합니다.');
  await bomCodeClash(fields[1]); await bomCycleCheck(fields[0], fields[5]);
  const spec = str(body.spec, 100);
  const result = await db.prepare('INSERT INTO boms(product,product_code,kind,base_qty,unit,materials,note,active,item_category,created_by,cat1,cat2,cat3,semi_type,semi_unit,pack_qty) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ?=\'\' OR NOT EXISTS(SELECT 1 FROM boms WHERE product_code<>\'\' AND UPPER(product_code)=UPPER(?))').run(...fields, user.name, ...cats, semiType, semiUnit, packQty, fields[1], fields[1]);
  if (!result.changes) { await bomCodeClash(fields[1]); throw new HttpError(409, `제품코드 ${fields[1]}가 그 사이 다른 품목에 등록되었습니다.`); } // 15.209 동시 등록
  if (spec) await db.prepare('UPDATE boms SET spec=? WHERE id=?').run(spec, result.lastInsertRowid);
  const vendorInfo = str(body.vendor_info, 500); if (vendorInfo) await db.prepare('UPDATE boms SET vendor_info=? WHERE id=?').run(vendorInfo, result.lastInsertRowid); // 15.190
  if (body.sst_name !== undefined || body.pack_info !== undefined) await db.prepare('UPDATE boms SET sst_name=?,pack_info=? WHERE id=?').run(str(body.sst_name, 200), str(body.pack_info, 500), result.lastInsertRowid); // 15.230 SST제품명·포장정보
  if (body.skip_incoming !== undefined || body.skip_outgoing !== undefined) await db.prepare('UPDATE boms SET skip_incoming=?,skip_outgoing=? WHERE id=?').run(isChecked(body.skip_incoming) ? 1 : 0, isChecked(body.skip_outgoing) ? 1 : 0, result.lastInsertRowid); // 15.207
  return withSizes(decodeBom(await mustGet('boms', result.lastInsertRowid)));
});
route('PUT', '/api/boms/:id', async ({ user, params, body }) => {
  requireAdmin(user); const before = await mustGet('boms', params.id); const fields = bomFields(body);
  const { cats, semiType, semiUnit, packQty } = await bomPlacement(body, fields[8], before, fields[4]);
  if (semiType && !fields[1]) throw bad('커팅/융착·세탁에서 고를 품목은 제품코드가 필요합니다.');
  if (before.is_temp && !fields[1]) throw bad('임시 품목을 정식으로 바꿀 때는 제품코드를 넣으세요(비우면 이 코드로 이어진 발주·출하가 끊깁니다).');
  await bomCodeClash(fields[1], before.id); await bomCycleCheck(fields[0], fields[5], before.id);
  const commands = [{ sql: "UPDATE boms SET product=?,product_code=?,kind=?,base_qty=?,unit=?,materials=?,note=?,active=?,item_category=?,cat1=?,cat2=?,cat3=?,semi_type=?,semi_unit=?,pack_qty=?,is_temp=0,updated_at=datetime('now','+9 hours') WHERE id=?", args: [...fields, ...cats, semiType, semiUnit, packQty, before.id] }];
  if (before.is_temp) {
    if (/^TMP-/i.test(fields[1])) throw bad('임시 코드(TMP-)를 정식 제품코드로 바꿔 저장하세요.');
    commands.push(...relinkCatalog(before, { id: before.id, product: fields[0], product_code: fields[1] }));
  } else commands.push(...await bomFollowRename(before, fields[0], fields[1]));
  if (body.spec !== undefined) commands.push({ sql: 'UPDATE boms SET spec=? WHERE id=?', args: [str(body.spec, 100), before.id] });
  if (body.vendor_info !== undefined) commands.push({ sql: 'UPDATE boms SET vendor_info=? WHERE id=?', args: [str(body.vendor_info, 500), before.id] }); // 15.190 업체 정보
  if (body.sst_name !== undefined) commands.push({ sql: 'UPDATE boms SET sst_name=? WHERE id=?', args: [str(body.sst_name, 200), before.id] }); // 15.230 SST제품명
  if (body.pack_info !== undefined) commands.push({ sql: 'UPDATE boms SET pack_info=? WHERE id=?', args: [str(body.pack_info, 500), before.id] }); // 15.230 포장정보
  if (body.skip_incoming !== undefined || body.skip_outgoing !== undefined) commands.push({ sql: 'UPDATE boms SET skip_incoming=?,skip_outgoing=? WHERE id=?', args: [isChecked(body.skip_incoming) ? 1 : 0, isChecked(body.skip_outgoing) ? 1 : 0, before.id] }); // 15.207 검사 제외
  await db.batch(commands);
  return withSizes(decodeBom(await mustGet('boms', params.id)));
});
// 15.73 BOM 트리에서 바로 고치기(관리자): 기준 수량·자재 소요량·사용 여부만. 자재 이름·순서는 그대로여야 하고,
// 읽은 뒤 다른 곳에서 바뀌었으면 409. 바뀐 내용은 진행 코멘트에 「[수정] …」으로 남긴다.
route('POST', '/api/boms/:id/quick', async ({ user, params, body }) => {
  requireAdmin(user);
  const row = await mustGet('boms', params.id);
  const mats = JSON.parse(row.materials), changes = [];
  // 읽은 값(before: 기준 수량·사용 여부·소요량)과 지금 값이 다르면 그 사이 다른 곳에서 고친 것이다(updated_at은 초 단위라 함께 본다).
  const before = body.before && typeof body.before === 'object' ? body.before : null;
  const stale = String(body.updated_at || '') !== row.updated_at || !before || Number(before.base_qty) !== row.base_qty || (before.active ? 1 : 0) !== row.active
    || !Array.isArray(before.qty) || before.qty.length !== mats.length || before.qty.some((q, i) => Number(q) !== mats[i].qty);
  if (stale) throw new HttpError(409, `${row.product}: 다른 곳에서 이 품목이 바뀌었습니다. 새로 불러와 다시 고치세요.`);
  let base = row.base_qty, active = row.active;
  if (body.base_qty !== undefined) {
    const n = num(body.base_qty, `${row.product} 기준 수량`); if (!(n > 0)) throw bad(`${row.product} 기준 수량은 0보다 커야 합니다.`);
    if (n !== base) { changes.push(`기준 수량 ${base} → ${n}`); base = n; }
  }
  if (body.materials !== undefined) {
    if (!Array.isArray(body.materials) || body.materials.length !== mats.length) throw new HttpError(409, `${row.product}: 구성자재 목록이 바뀌었습니다. 새로 불러오세요.`);
    body.materials.forEach((m, i) => {
      if (!m || nameKey(m.item) !== nameKey(mats[i].item)) throw new HttpError(409, `${row.product}: 구성자재 목록이 바뀌었습니다. 새로 불러오세요.`);
      const q = num(m.qty, `${mats[i].item} 소요량`); if (!(q > 0)) throw bad(`${row.product}의 ${mats[i].item} 소요량은 0보다 커야 합니다.`);
      if (q !== mats[i].qty) { changes.push(`${mats[i].item} 소요량 ${mats[i].qty} → ${q}`); mats[i] = { ...mats[i], qty: q }; }
    });
  }
  if (body.active !== undefined) { const a = body.active === true || body.active === 1 ? 1 : 0; if (a !== active) { changes.push(a ? '사용으로 바꿈' : '사용 중지'); active = a; } }
  if (!changes.length) return withSizes(decodeBom(row));
  try {
    await db.batch([
      { sql: "UPDATE boms SET base_qty=?,materials=?,active=?,updated_at=datetime('now','+9 hours') WHERE id=? AND updated_at=? AND materials=? AND base_qty=? AND active=?", args: [base, JSON.stringify(mats), active, row.id, row.updated_at, row.materials, row.base_qty, row.active] },
      RC_GUARD,
      { sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: ['bom', row.id, `[수정] ${changes.join(' · ')}`, user.id, user.name] },
    ]);
  } catch (error) { if (isGuardError(error)) throw new HttpError(409, `${row.product}: 다른 곳에서 이 품목이 바뀌었습니다. 새로 불러와 다시 고치세요.`); throw error; }
  return withSizes(decodeBom(await mustGet('boms', row.id)));
});
// 15.196 BOM 소요량 페이지: 기준 수량·구성자재(추가·삭제·분류·소요량·단위)를 한 번에 저장. 읽은 뒤 다른 곳에서 바뀌었으면 409.
// 바뀐 내용은 진행 코멘트 「[BOM] …」으로 남긴다. 같은 자재 두 번·자기 자신·순환 구성은 막는다.
route('POST', '/api/boms/:id/bom', async ({ user, params, body }) => {
  requireAdmin(user);
  const row = await mustGet('boms', params.id);
  const stale = () => new HttpError(409, `${row.product}: 다른 곳에서 이 품목이 바뀌었습니다. 새로 불러와 다시 고치세요.`);
  if (String(body.updated_at || '') !== row.updated_at) throw stale();
  const base = num(body.base_qty, '기준 수량'); if (!(base > 0)) throw bad('기준 수량은 0보다 커야 합니다.');
  if (!Array.isArray(body.materials) || body.materials.length > 100) throw bad('구성자재는 100개까지 넣을 수 있습니다.');
  if (row.item_category === '제품' && !body.materials.length) throw bad('제품 BOM은 구성자재를 1개 이상 넣으세요.');
  const mats = body.materials.map((m, i) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw bad(`${i + 1}번째 자재를 확인하세요.`);
    const name = reqStr(m.item, `${i + 1}번째 자재명`, 200), qty = num(m.qty, `${name} 소요량`);
    if (!(qty > 0)) throw bad(`${name} 소요량은 0보다 커야 합니다.`);
    return { item: name, item_category: itemCategory(m.item_category), qty, unit: reqStr(m.unit, `${name} 단위`, 20) };
  });
  const keys = mats.map(m => nameKey(m.item)), dup = keys.findIndex((k, i) => keys.indexOf(k) !== i);
  if (dup >= 0) throw bad(`같은 자재가 두 번 들어 있습니다: ${mats[dup].item}`);
  const json = JSON.stringify(mats);
  await bomCycleCheck(row.product, json, row.id);
  const old = JSON.parse(row.materials), oldBy = new Map(old.map(m => [nameKey(m.item), m])), changes = [];
  if (base !== row.base_qty) changes.push(`기준 수량 ${row.base_qty} → ${base}`);
  for (const m of mats) { const o = oldBy.get(nameKey(m.item)); if (!o) changes.push(`+ ${m.item} ${m.qty}${m.unit}`); else if (o.qty !== m.qty || o.unit !== m.unit || o.item_category !== m.item_category) changes.push(`${m.item} ${o.qty}${o.unit} → ${m.qty}${m.unit}${o.item_category !== m.item_category ? ` (${o.item_category} → ${m.item_category})` : ''}`); }
  const now = new Set(keys); for (const o of old) if (!now.has(nameKey(o.item))) changes.push(`− ${o.item}`);
  if (!changes.length && json === row.materials) return withSizes(decodeBom(row));
  try {
    await db.batch([
      { sql: "UPDATE boms SET base_qty=?,materials=?,updated_at=datetime('now','+9 hours') WHERE id=? AND updated_at=? AND materials=? AND base_qty=?", args: [base, json, row.id, row.updated_at, row.materials, row.base_qty] },
      RC_GUARD,
      { sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: ['bom', row.id, `[BOM] ${(changes.length ? changes : ['자재 순서 변경']).join(' · ')}`, user.id, user.name] },
    ]);
  } catch (error) { if (isGuardError(error)) throw stale(); throw error; }
  return withSizes(decodeBom(await mustGet('boms', row.id)));
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
// ── 제품등록: 세부 분류 관리 ──
route('GET', '/api/item-categories', async () => (await db.prepare('SELECT id,item_class,parent_id,level,name,semi_type,sizes,sort_order,active FROM item_category_nodes ORDER BY item_class,level,sort_order,name,id').all()).map(n => ({ ...n, active: !!n.active })));
// 사이즈 묶음: 쉼표로 구분, 최대 20개. 하위 분류는 가장 가까운 상위 분류의 묶음을 따른다.
function categorySizes(value) {
  const list = [...new Set(String(value ?? '').split(/[,\s]+/).map(v => v.trim().toUpperCase()).filter(Boolean))];
  if (list.length > 20 || list.some(v => v.length > 10)) throw bad('사이즈는 20개 이내, 각 10자 이내로 입력하세요.');
  return list.join(',');
}
async function sizeSets() {
  const nodes = await db.prepare('SELECT id,item_class,parent_id,level,name,sizes FROM item_category_nodes').all();
  return (category, cats) => {
    let parent = 0, sizes = '';
    for (const [i, name] of cats.entries()) { if (!name) break; const node = nodes.find(n => n.item_class === category && n.level === i + 1 && (n.parent_id || 0) === parent && n.name === name); if (!node) break; if (node.sizes) sizes = node.sizes; parent = node.id; }
    return sizes ? sizes.split(',') : [];
  };
}
// 15.107 줄의 규격: 품목코드에 규격이 있으면 그것(입력값 무시). 분류에 사이즈 묶음이 있으면 줄마다 고른 사이즈. 둘 다 없으면 입력한 규격.
// 15.121 제품등록에 규격이 있으면 그 값으로 고정(입력값 무시). 사이즈가 등록된 품목은 그 사이즈 중 하나만. 둘 다 없으면 입력값.
// keep = 고치는 기록의 지금 값(예전에 적은 값은 그대로 둘 수 있게).
async function catalogSpec(bomOrId, typed, keep = null) {
  const bom = bomOrId && typeof bomOrId === 'object' ? bomOrId : bomOrId ? await db.prepare('SELECT * FROM boms WHERE id=?').get(Number(bomOrId)) : null;
  const value = str(typed, 100);
  if (!bom) return value;
  if (keep !== null && value === keep) return value;
  const sizes = (await sizeSets())(bom.item_category, [bom.cat1, bom.cat2, bom.cat3]);
  if (sizes.length) { if (value && !sizes.includes(value)) throw bad(`${bom.product}의 규격은 등록된 사이즈(${sizes.join(', ')}) 중에서 고르세요.`); return value; }
  return bom.spec || value;
}
async function withSizes(bom) { return { ...bom, sizes: (await sizeSets())(bom.item_category, [bom.cat1, bom.cat2, bom.cat3]) }; }
function categorySemiType(value, itemClass) {
  const type = str(value, 20); if (!type) return '';
  if (itemClass !== '반제품') throw bad('생산 종류는 반제품 분류에만 지정합니다.');
  if (!SEMI_TYPE_NAMES.includes(type)) throw bad('생산 종류를 다시 선택하세요.');
  return type;
}
async function categoryPathOf(node) {
  const names = []; let cursor = node;
  while (cursor) { names.unshift(cursor.name); cursor = cursor.parent_id ? await db.prepare('SELECT * FROM item_category_nodes WHERE id=?').get(cursor.parent_id) : null; }
  return names;
}
// Items under a node take the deepest production kind found along their category path.
async function semiTypeUpdates(itemClass) {
  if (itemClass !== '반제품') return [];
  const nodes = await db.prepare("SELECT * FROM item_category_nodes WHERE item_class='반제품'").all();
  const find = (level, parent, name) => nodes.find(n => n.level === level && (n.parent_id || 0) === parent && n.name === name);
  const items = await db.prepare("SELECT id,cat1,cat2,cat3,semi_type FROM boms WHERE item_category='반제품' AND cat1<>''").all();
  const commands = [];
  for (const item of items) {
    let parent = 0, kind = '';
    for (const [i, name] of [item.cat1, item.cat2, item.cat3].entries()) { if (!name) break; const node = find(i + 1, parent, name); if (!node) break; if (node.semi_type) kind = node.semi_type; parent = node.id; }
    if (kind !== item.semi_type) commands.push({ sql: "UPDATE boms SET semi_type=?,updated_at=datetime('now','+9 hours') WHERE id=?", args: [kind, item.id] });
  }
  return commands;
}
const categoryConflict = error => { if (String(error.message).includes('UNIQUE')) throw new HttpError(409, '같은 위치에 같은 이름의 분류가 이미 있습니다.'); throw error; };
route('POST', '/api/item-categories', async ({ user, body }) => {
  requireAdmin(user);
  const itemClass = itemCategory(body.item_class), name = reqStr(body.name, '분류 이름', 50);
  if (itemClass === '임가공') throw bad('임가공은 세부 분류를 쓰지 않습니다.');
  let level = 1, parentId = null;
  if (body.parent_id !== undefined && body.parent_id !== null && body.parent_id !== '') {
    const parent = await mustGet('item_category_nodes', Number(body.parent_id) || 0);
    if (parent.item_class !== itemClass) throw bad('상위 분류의 품목 분류가 다릅니다.');
    if (parent.level >= 3) throw bad('세부 분류는 3차까지 만들 수 있습니다.');
    level = parent.level + 1; parentId = parent.id;
  }
  let id; try { id = Number((await db.prepare('INSERT INTO item_category_nodes(item_class,parent_id,level,name,semi_type,sizes,created_by) VALUES(?,?,?,?,?,?,?)').run(itemClass, parentId, level, name, categorySemiType(body.semi_type, itemClass), categorySizes(body.sizes), user.name)).lastInsertRowid); } catch (error) { categoryConflict(error); }
  const updates = await semiTypeUpdates(itemClass); if (updates.length) await db.batch(updates);
  return { id };
});
route('PUT', '/api/item-categories/:id', async ({ user, params, body }) => {
  requireAdmin(user);
  const node = await mustGet('item_category_nodes', params.id);
  const name = body.name === undefined ? node.name : reqStr(body.name, '분류 이름', 50);
  const semiType = body.semi_type === undefined ? node.semi_type : categorySemiType(body.semi_type, node.item_class);
  const active = body.active === undefined ? node.active : body.active === false || body.active === 0 ? 0 : 1;
  const sizes = body.sizes === undefined ? node.sizes : categorySizes(body.sizes);
  const commands = [{ sql: 'UPDATE item_category_nodes SET name=?,semi_type=?,sizes=?,active=? WHERE id=?', args: [name, semiType, sizes, active, node.id] }];
  // A rename follows through to the items filed under this node (their category text holds the name).
  if (name !== node.name) {
    const path = await categoryPathOf(node), column = 'cat' + node.level;
    const where = path.map((_, i) => `cat${i + 1}=?`).join(' AND ');
    commands.push({ sql: `UPDATE boms SET ${column}=?,updated_at=datetime('now','+9 hours') WHERE item_category=? AND ${where}`, args: [name, node.item_class, ...path] });
  }
  try { await db.batch(commands); } catch (error) { categoryConflict(error); }
  const updates = await semiTypeUpdates(node.item_class); if (updates.length) await db.batch(updates);
  return { ok: true };
});
// 분류 삭제(15.80): 하위 분류도, 이 분류로 등록된 사용 중 품목도 없을 때만. 있으면 사용 중지를 안내한다.
route('DELETE', '/api/item-categories/:id', async ({ user, params }) => {
  requireAdmin(user);
  const node = await mustGet('item_category_nodes', params.id);
  const children = (await db.prepare('SELECT COUNT(*) c FROM item_category_nodes WHERE parent_id=?').get(node.id)).c;
  if (children) throw new HttpError(409, `하위 분류 ${children}개가 있어 삭제할 수 없습니다. 하위 분류를 먼저 삭제하거나 「사용 중지」하세요.`);
  const path = await categoryPathOf(node);
  const items = (await db.prepare(`SELECT COUNT(*) c FROM boms WHERE active=1 AND item_category=? AND ${path.map((_, i) => `cat${i + 1}=?`).join(' AND ')}`).get(node.item_class, ...path)).c;
  if (items) throw new HttpError(409, `이 분류로 등록된 품목 ${items}개가 있어 삭제할 수 없습니다. 품목의 분류를 바꾸거나 「사용 중지」하세요.`);
  await db.prepare('DELETE FROM item_category_nodes WHERE id=? AND NOT EXISTS(SELECT 1 FROM item_category_nodes WHERE parent_id=?)').run(node.id, node.id);
  const updates = await semiTypeUpdates(node.item_class); if (updates.length) await db.batch(updates);
  return { ok: true };
});
// 품목(제품코드) 사용처(15.64): 이 중 하나라도 있으면 완전 삭제하지 않고 사용 중지·합치기를 안내한다.
// 코드로 연결된 기록은 product_code(빈 코드는 비교하지 않음), 품목으로 연결된 기록은 bom_id로 센다. 구성자재는 이름으로 센다.
const BOM_USES = [
  ['발주', 'purchase_orders', "product_code<>'' AND product_code=?", 'code'],
  ['출하', 'shipments', "product_code<>'' AND product_code=?", 'code'],
  ['기타입고', 'other_receipts', 'bom_id=?', 'id'],
  ['생산일정', 'schedules', 'bom_id=?', 'id'],
  ['반제품 기록', 'semi_records', 'bom_id=?', 'id'],
  ['구매의뢰', 'purchase_request_items', 'bom_id=?', 'id'],
  ['생산의뢰', 'production_request_lines', 'bom_id=?', 'id'],
  ['수주', 'sales_order_lines', 'bom_id=?', 'id'],
  ['출하지시', 'ship_instructions', 'bom_id=?', 'id'],
  ['단가표', 'item_prices', 'bom_id=? AND active=1', 'id'],
  ['의뢰·수입검사', 'requests', "json_extract(data,'$.bom_id')=?", 'id'],
  ['다른 제품의 구성자재', 'boms', "id<>? AND EXISTS(SELECT 1 FROM json_each(boms.materials) m WHERE REPLACE(LOWER(json_extract(m.value,'$.item')),' ','')=?)", 'material'],
];
const bomUseArgs = (bom, key) => key === 'code' ? [bom.product_code] : key === 'material' ? [bom.id, nameKey(bom.product)] : [bom.id];
async function bomUsage(bom) {
  const uses = [];
  for (const [label, table, where, key] of BOM_USES) {
    if (key === 'code' && !bom.product_code) continue;
    const count = (await db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`).get(...bomUseArgs(bom, key))).c;
    if (count) uses.push({ label, count });
  }
  return { uses, total: uses.reduce((t, u) => t + u.count, 0) };
}
route('GET', '/api/boms/:id/usage', async ({ user, params }) => { requireAdmin(user); return bomUsage(await mustGet('boms', params.id)); });
// 기본은 사용 중지(예전 동작). purge=1이면 어디에도 쓰이지 않은 품목만 완전히 지운다.
route('DELETE', '/api/boms/:id', async ({ user, params, query }) => {
  requireAdmin(user); const bom = await mustGet('boms', params.id);
  if (query.purge === '1') {
    const usage = await bomUsage(bom);
    if (usage.total) throw new HttpError(409, `${usage.uses.map(u => `${u.label} ${u.count}건`).join(', ')}에서 쓰고 있어 삭제할 수 없습니다. 「사용 중지」하거나${bom.is_temp ? ' 「기존 품목으로 합치기」로 옮긴 뒤 삭제하거나' : ''} 그대로 두세요.`);
    // 확인과 삭제 사이에 새로 쓰이면 지우지 않는다(같은 조건을 DELETE 문장에 둔다).
    const guards = BOM_USES.filter(([, , , key]) => key !== 'code' || bom.product_code);
    const result = await db.prepare(`DELETE FROM boms WHERE id=? AND ${guards.map(([, table, where]) => `NOT EXISTS(SELECT 1 FROM ${table} WHERE ${where})`).join(' AND ')}`)
      .run(bom.id, ...guards.flatMap(([, , , key]) => bomUseArgs(bom, key)));
    if (!result.changes) throw new HttpError(409, '방금 다른 곳에서 이 품목을 사용해 삭제하지 않았습니다. 다시 확인하세요.');
    return { ok: true, deleted: true };
  }
  await db.prepare("UPDATE boms SET active=0,updated_at=datetime('now','+9 hours') WHERE id=?").run(bom.id);
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
  models: (await db.prepare("SELECT id,product,product_code,semi_type,CASE WHEN semi_unit<>'' THEN semi_unit ELSE unit END AS unit,materials FROM boms WHERE active=1 AND is_temp=0 AND semi_type<>'' ORDER BY product").all()).map(m => ({ ...m, materials: (() => { try { return JSON.parse(m.materials || '[]'); } catch { return []; } })() })), // 15.249 BOM 자재(투입 LOT 고르기)
}));
function operatorDate(value) {
  const date = listFilterDate(value, '생산일');
  if (!date || date > today()) throw bad('생산일은 오늘 또는 과거 날짜를 선택하세요.');
  return date;
}
route('GET', '/api/operator/plans', async ({ query }) => {
  const date = operatorDate(query.date);
  return db.prepare(`SELECT s.id,s.period,s.start_date,s.product,s.spec,s.qty,s.done,
    COALESCE(NULLIF(s.unit,''),json_extract(s.bom_snapshot,'$.unit'),'') AS unit, COALESCE(json_extract(s.bom_snapshot,'$.materials'),'[]') AS materials_json,
    COALESCE((SELECT SUM(a.qty) FROM production_actuals a WHERE a.schedule_id=s.id AND a.voided_at IS NULL),0) AS actual_qty
    FROM schedules s WHERE s.kind='finished' AND s.confirmed_at<>'' AND s.start_date<=? AND -- 15.204 확정 계획만(실적 입력 화면과 같게)
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
      (SELECT group_concat(work_order, ',') FROM (SELECT a.work_order FROM production_actuals a WHERE a.schedule_id=schedules.id AND a.voided_at IS NULL AND a.work_order<>'' ORDER BY a.id)) AS work_orders,
      (SELECT json_group_array(json_object('lot', a.lot, 'qty', a.qty, 'wo', a.work_order, 'date', a.production_date, 'id', a.id, 'st', a.work_status)) FROM production_actuals a WHERE a.schedule_id=schedules.id AND a.voided_at IS NULL AND a.lot<>'') AS actual_lots, -- 15.298 id·상태: 실적 입력 화면에서 이날 기록을 「수정」
      COALESCE((SELECT SUM(c.qty) FROM semi_records c WHERE ${semiCutMatch('schedules')}),0) AS cut_qty,
      (SELECT r.req_no || ' · ' || r.customer || CASE WHEN r.order_no!='' THEN ' · ' || r.order_no ELSE '' END FROM production_request_lines l JOIN production_requests r ON r.id=l.request_id WHERE l.id=schedules.production_line_id) AS order_ref,
      (SELECT l.request_id FROM production_request_lines l WHERE l.id=schedules.production_line_id) AS order_id FROM schedules WHERE kind=? AND (
      (period='day' AND start_date BETWEEN ? AND ?) OR
      (period='week' AND start_date<=? AND date(start_date,'+6 days')>=?) OR
      (period='month' AND start_date<=? AND date(start_date,'+1 month','-1 day')>=?)
    ) ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY start_date, period, id`).all(...args)).map(decodeSchedule);
});
route('POST', '/api/schedules', async ({ user, body }) => {
  const token = reqToken(body); { const old = await replayed('schedules', token, user); if (old) return { ...decodeSchedule(old), duplicate: true }; } // 15.209
  const f = await schedFields(body);
  const r = await onceInsert('schedules', token, user, async () => (await db.prepare('INSERT INTO schedules(kind,period,start_date,product,qty,note,created_by,bom_id,bom_snapshot,request_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.kind, f.period, f.start_date, f.product, f.qty, f.note, user.name, f.bom_id, f.bom_snapshot, token)).lastInsertRowid);
  if (r.duplicate) return { ...decodeSchedule(r.row), duplicate: true };
  return decodeSchedule(await mustGet('schedules', r.id));
});
route('PUT', '/api/schedules/:id', async ({ user, params, body }) => {
  const row = (await mustGet('schedules', params.id)); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 수정할 수 있습니다.');
  const hasActuals = await db.prepare('SELECT 1 FROM production_actuals WHERE schedule_id=?').get(row.id);
  if (hasActuals && (['product','kind','bom_id','spec','unit'].some(key => body[key] !== undefined && String(body[key] ?? '') !== String(row[key] ?? '')))) throw bad('생산실적이 있는 일정의 품목·규격·단위·BOM은 변경할 수 없습니다.');
  if (body.toggle_done) { await db.prepare('UPDATE schedules SET done=1-done WHERE id=?').run(row.id); return decodeSchedule(await mustGet('schedules', row.id)); }
  // 15.279 완료 처리: 계획보다 덜 만들어도 이 계획을 닫는다(set_done 1) · 다시 열기(set_done 0). 진행 코멘트에 기록.
  if (body.set_done !== undefined) {
    const v = Number(body.set_done) ? 1 : 0; if (v === row.done) return decodeSchedule(row);
    if (v && await db.prepare("SELECT 1 FROM production_actuals WHERE schedule_id=? AND work_status='progress' AND voided_at IS NULL").get(row.id)) throw bad('작업중인 포장이 있습니다. 수량을 넣어 작업완료하거나 취소한 뒤 완료 처리하세요.');
    const made = (await db.prepare('SELECT COALESCE(SUM(qty),0) AS q FROM production_actuals WHERE schedule_id=? AND voided_at IS NULL').get(row.id)).q;
    const why = str(body.reason, 300);
    await db.batch([{ sql: 'UPDATE schedules SET done=? WHERE id=?', args: [v, row.id] },
      { sql: 'INSERT INTO progress_comments(entity_type,entity_id,content,author_id,author_name) VALUES(?,?,?,?,?)', args: ['schedule', row.id, v ? `[완료 처리] 계획 ${stockRound(row.qty)} 중 ${stockRound(made)} 생산${made < row.qty ? ` (부족 ${stockRound(row.qty - made)})` : ''}${why ? ' · ' + why : ''}` : `[완료 취소] 다시 실적 입력 가능${why ? ' · ' + why : ''}`, user.id, user.name] }]);
    return decodeSchedule(await mustGet('schedules', row.id));
  }
  const f = await schedFields({ ...body, kind: row.kind }, row);
  if (hasActuals && ['product','period','start_date','bom_id'].some(key => f[key] !== row[key])) throw bad('생산실적이 있는 일정의 품목·기간·BOM은 변경할 수 없습니다.');
  if (row.confirmed_at && row.confirmed_by !== '(기존 계획)' && ['product','period','start_date','bom_id','qty'].some(key => f[key] !== row[key])) throw bad('확정된 계획입니다. 「확정취소」 후 고치세요.'); // 15.199
  await db.prepare('UPDATE schedules SET period=?,start_date=?,product=?,qty=?,note=?,bom_id=?,bom_snapshot=? WHERE id=?').run(f.period, f.start_date, f.product, f.qty, f.note, f.bom_id, f.bom_snapshot, row.id);
  await recordEdit('schedule', 'schedules', row.id, row, EDIT_LABELS.schedule, user);
  return decodeSchedule(await mustGet('schedules', row.id));
});
// 15.199 계획 확정·확정 취소(생산 담당·관리자). 확정한 계획만 실적 입력에 나온다. 실적이 있는 계획은 확정 취소하지 않는다.
route('POST', '/api/schedules/confirm', async ({ user, body }) => {
  if (!hasRole(user, 'production')) throw new HttpError(403, '계획 확정은 생산 담당자 또는 관리자가 합니다.');
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number))] : [];
  if (!ids.length || ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('확정할 계획을 고르세요.');
  const on = body.confirm !== false;
  const rows = []; for (const id of ids) { const r = await db.prepare('SELECT * FROM schedules WHERE id=?').get(id); if (!r) throw new HttpError(404, '없는 계획이 있습니다. 새로 불러오세요.'); rows.push(r); }
  if (!on) { const used = rows.filter(r => r.confirmed_at); for (const r of used) if (await db.prepare('SELECT 1 FROM production_actuals WHERE schedule_id=? AND voided_at IS NULL').get(r.id)) throw bad(`${r.product} ${r.start_date}: 실적이 있는 계획은 확정 취소할 수 없습니다.`); }
  const target = rows.filter(r => on ? !r.confirmed_at : !!r.confirmed_at);
  if (target.length) await db.batch(target.map(r => on
    ? { sql: "UPDATE schedules SET confirmed_at=datetime('now','+9 hours'),confirmed_by=? WHERE id=? AND confirmed_at=''", args: [user.name, r.id] }
    : { sql: "UPDATE schedules SET confirmed_at='',confirmed_by='' WHERE id=? AND NOT EXISTS(SELECT 1 FROM production_actuals WHERE schedule_id=? AND voided_at IS NULL)", args: [r.id, r.id] }));
  return { changed: target.length, skipped: rows.length - target.length };
});
route('DELETE', '/api/schedules/:id', async ({ user, params }) => {
  const row = (await mustGet('schedules', params.id)); if (!canModify(user, row) && !hasRole(user, 'production')) throw new HttpError(403, '등록자 또는 생산 담당자만 삭제할 수 있습니다.');
  if (row.confirmed_at && row.confirmed_by !== '(기존 계획)') throw bad('확정된 계획입니다. 「확정취소」 후 지우세요.'); // 15.199
  if (await db.prepare('SELECT 1 FROM production_actuals WHERE schedule_id=?').get(row.id)) throw bad('생산실적이 있는 일정은 삭제할 수 없습니다. 실적 이력을 확인하세요.');
  const r = await db.prepare('DELETE FROM schedules WHERE id=? AND NOT EXISTS(SELECT 1 FROM production_actuals WHERE schedule_id=?)').run(row.id, row.id);
  if (!r.changes) throw bad('그 사이 생산실적이 기록되어 삭제할 수 없습니다. 새로 불러오세요.');
  return { ok: true };
});

// ── 물류: 발주 없는 기타입고 ──
function receiptCategory(value) { const c = itemCategory(value); if (c === '반제품') throw bad('반제품은 기타입고로 받을 수 없습니다. 생산 기록으로 등록하세요.'); if (c === '임가공') throw bad('임가공은 발주로 받습니다. 기타입고로는 받을 수 없습니다.'); return c; }
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
    if (snapshot.item_category === '임가공') throw bad('임가공은 발주로 받습니다. 기타입고로는 받을 수 없습니다.');
  } else if (!previous || previous.bom_id) throw bad('BOM을 검색하여 입고할 품목을 선택하세요.');
  return [dateStr(b.received_date, '입고일'), bomId ? snapshot.product : reqStr(b.item, '품목명', 200), bomId ? snapshot.item_category : receiptCategory(b.item_category), num(b.qty, '입고수량'), reqStr(b.vendor, '입고처', 100), str(b.note, 500), bomId, JSON.stringify(snapshot)];
}
route('GET', '/api/other-receipts', async ({ query }) => {
  const where = []; const args = [];
  applyListDates(where, args, query, 'received_date');
  if (query.item_category) { where.push('item_category=?'); args.push(itemCategory(query.item_category)); }
  applyListKeyword(where, args, query.q, ['item','spec','lot','vendor','note','created_by',"json_extract(bom_snapshot,'$.product_code')"]);
  applyInspectionFilter(where, args, query, 'other_receipt', 'other_receipts');
  return await db.prepare(`SELECT other_receipts.*, (SELECT receipt_no FROM receipts WHERE id=other_receipts.receipt_id) AS receipt_no, ${attachmentSummary('other_receipt','other_receipts')}, COALESCE((SELECT m.result FROM requests q JOIN inspection_measurements m ON m.request_id=q.id WHERE q.source_type='other_receipt' AND q.source_id=other_receipts.id LIMIT 1), (SELECT 'exempt' FROM requests q WHERE q.source_type='other_receipt' AND q.source_id=other_receipts.id AND json_extract(q.data,'$.exempt')=1 LIMIT 1)) AS qc_result FROM other_receipts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY received_date DESC, id DESC`).all(...args);
});
// 15.209 요청 번호: 같은 등록 요청(응답을 못 받아 다시 누름 등)을 두 번 보내도 한 건. 없으면 예전처럼 그냥 저장.
const reqToken = body => { const t = body.request_id === undefined || body.request_id === null || body.request_id === '' ? null : String(body.request_id); if (t !== null && !/^[a-zA-Z0-9-]{16,80}$/.test(t)) throw bad('등록 요청 번호를 확인하세요.'); return t; };
async function replayed(table, token, user) {
  if (!token) return null; const old = await db.prepare(`SELECT * FROM ${table} WHERE request_id=?`).get(token); if (!old) return null;
  if (old.created_by !== user.name) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.'); return old;
}
async function onceInsert(table, token, user, run) {
  const old = await replayed(table, token, user); if (old) return { row: old, duplicate: true };
  try { return { id: await run() }; }
  catch (error) { if (token && /UNIQUE/i.test(String(error && error.message))) { const again = await replayed(table, token, user); if (again) return { row: again, duplicate: true }; } throw error; }
}
route('POST', '/api/other-receipts', async ({ user, body }) => {
  const token = reqToken(body);
  { const old = await replayed('other_receipts', token, user); if (old) return { ...old, duplicate: true }; }
  const fields = await otherReceiptFields(body); await ensureVendor(fields[4], user, 'purchase');
  // 15.252 예전 단건 입력도 LOT 체계를 따른다: 업체 LOT(비우면 임시 SST), 원자재는 실물(절) 없으면 임시 1절
  const one = { lot: str(body.lot, 100), pieces: piecesOf(body.pieces) }; await fillSstLots(fields[0], [one]); const tp = tempPieces(one, fields[2]);
  const r = await onceInsert('other_receipts', token, user, async () => (await db.batch([
    { sql: 'INSERT INTO other_receipts(received_date,item,item_category,qty,vendor,note,bom_id,bom_snapshot,created_by,request_id,lot,pieces,pieces_temp) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [...fields, user.name, token, one.lot, tp.pieces, tp.temp] },
    receiptAnalysisQuery('other_receipt', null, user),
  ]))[0].meta.last_row_id);
  if (r.duplicate) return { ...r.row, duplicate: true };
  return await mustGet('other_receipts', r.id);
});
route('PUT', '/api/other-receipts/:id', async ({ user, params, body }) => {
  const row = await mustGet('other_receipts', params.id);
  if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 수정할 수 있습니다.');
  if (await db.prepare("SELECT 1 FROM purchase_bill_lines WHERE source_type='other' AND source_id=? AND active=1").get(row.id)) throw new HttpError(409, `${row.item}: 매입전표에 들어간 기타입고입니다. 구매에서 매입전표를 취소한 뒤 고치세요.`);
  const fields = await otherReceiptFields(body, row);
  { const u = await lotUsage(row.item, row.lot); if (u && (fields[1] !== row.item || Number(fields[3]) !== Number(row.qty) || fields[6] !== row.bom_id)) throw new HttpError(409, lotUsedMessage(row.item, row.lot, u)); } // 15.150
  await db.prepare('UPDATE other_receipts SET received_date=?,item=?,item_category=?,qty=?,vendor=?,note=?,bom_id=?,bom_snapshot=? WHERE id=?').run(...fields, row.id);
  await recordEdit('other_receipt', 'other_receipts', row.id, row, EDIT_LABELS.other_receipt, user);
  return await mustGet('other_receipts', row.id);
});
route('DELETE', '/api/other-receipts/:id', async ({ user, params }) => {
  const row = await mustGet('other_receipts', params.id);
  if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 삭제할 수 있습니다.');
  if (await db.prepare("SELECT 1 FROM purchase_bill_lines WHERE source_type='other' AND source_id=? AND active=1").get(row.id)) throw new HttpError(409, `${row.item}: 매입전표에 들어간 기타입고입니다. 구매에서 매입전표를 취소한 뒤 삭제하세요.`);
  { const u = await lotUsage(row.item, row.lot); if (u) throw new HttpError(409, lotUsedMessage(row.item, row.lot, u)); } // 15.150
  try { await deleteEntityWithAttachments('other_receipt', 'other_receipts', row.id, [{ sql: "SELECT json('conflict') WHERE EXISTS(SELECT 1 FROM purchase_bill_lines WHERE source_type='other' AND source_id=? AND active=1)", args: [row.id] }]); }
  catch (error) { if (isGuardError(error)) throw new HttpError(409, `${row.item}: 그 사이 매입전표에 들어갔습니다. 새로 불러오세요.`); throw error; }
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
  const token = reqToken(body); { const old = await replayed('shipments', token, user); if (old) return { ...old, duplicate: true }; } // 15.209
  if (body.bom_id) body.item = (await catalogItem(user, body)).product;
  const f = shipFields(body); const entry = await catalogItem(user, body); await checkShipLot(entry.product, f[5], f[2]); await ensureVendor(f[3], user, 'sales');
  const r = await onceInsert('shipments', token, user, async () => (await db.prepare('INSERT INTO shipments(ship_date,item,qty,customer,note,lot,created_by,product_code,unit,request_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(f[0], entry.product, ...f.slice(2), user.name, entry.product_code, str(body.unit, 20) || entry.unit, token)).lastInsertRowid);
  if (r.duplicate) return { ...r.row, duplicate: true };
  return (await mustGet('shipments', r.id));
});
route('PUT', '/api/shipments/:id', async ({ user, params, body }) => {
  const row = (await mustGet('shipments', params.id)); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 수정할 수 있습니다.');
  if (await db.prepare("SELECT 1 FROM sales_bill_lines WHERE source_type='ship' AND source_id=? AND active=1").get(row.id)) throw new HttpError(409, `${row.item}: 매출전표에 들어간 출하입니다. 영업에서 매출전표를 취소한 뒤 고치세요.`);
  // 15.102 출하지시로 나간 출하는 수주 줄에 묶여 있으므로 거래처·품목·수량·날짜를 바꾸지 못한다(LOT·메모만). 바꾸려면 출하를 지워 지시를 되돌린 뒤 다시 출하 처리.
  const fromOrder = await db.prepare("SELECT 1 FROM ship_instructions WHERE shipment_id=? AND status='shipped'").get(row.id);
  if (fromOrder) {
    const lot = body.lot === undefined ? row.lot : str(body.lot, 100), note = body.note === undefined ? row.note : str(body.note, 500);
    if (lot !== (row.lot || '')) await checkShipLot(row.item, lot, row.qty); // 15.258
    const changed = ['ship_date', 'item', 'qty', 'customer', 'unit', 'spec', 'product_code'].filter(k => body[k] !== undefined && String(body[k]) !== String(row[k] ?? ''));
    if (changed.length || body.bom_id !== undefined) throw new HttpError(409, `${row.item}: 출하지시로 나간 출하는 LOT·메모만 고칠 수 있습니다. 거래처·품목·수량을 바꾸려면 출하를 삭제해 지시를 되돌린 뒤 다시 출하 처리하세요.`);
    await db.prepare('UPDATE shipments SET lot=?,note=? WHERE id=?').run(lot, note, row.id);
    await db.batch([{ sql: "UPDATE sales_bill_lines SET lot=? WHERE source_type='ship' AND source_id=? AND active=1", args: [lot, row.id] }]);
    await recordEdit('shipment', 'shipments', row.id, row, EDIT_LABELS.shipment, user); return (await mustGet('shipments', row.id));
  }
  const f = shipFields(body);
  const entry = nameKey(f[1]) === nameKey(row.item) && row.product_code && body.bom_id === undefined ? { product: row.item, product_code: row.product_code } : await catalogItem(user, body);
  if (f[5]) { const same = f[5] === (row.lot || '') && nameKey(entry.product) === nameKey(row.item); await checkShipLot(entry.product, f[5], f[2], same ? new Map([[String(entry.product).trim() + '\u0000' + f[5], -Number(row.qty || 0)]]) : null); } // 15.258 이 출하 몫은 빼고 잔량 확인
  await ensureVendor(f[3], user, 'sales');
  (await db.prepare('UPDATE shipments SET ship_date=?,item=?,qty=?,customer=?,note=?,lot=?,product_code=? WHERE id=?').run(f[0], entry.product, ...f.slice(2), entry.product_code, row.id)); await recordEdit('shipment', 'shipments', row.id, row, EDIT_LABELS.shipment, user); return (await mustGet('shipments', row.id));
});
route('DELETE', '/api/shipments/:id', async ({ user, params }) => {
  const row = (await mustGet('shipments', params.id)); if (!canModify(user, row) && !hasRole(user, 'logistics')) throw new HttpError(403, '등록자 또는 물류 담당자만 삭제할 수 있습니다.');
  const billed = `${row.item}: 매출전표에 들어간 출하입니다. 영업에서 매출전표를 취소한 뒤 삭제하세요.`;
  if (await db.prepare("SELECT 1 FROM sales_bill_lines WHERE source_type='ship' AND source_id=? AND active=1").get(row.id)) throw new HttpError(409, billed);
  // 15.100 출하지시로 나간 출하를 지우면 그 지시를 「지시 취소」로 되돌려 수주 잔량에 다시 잡히게 한다(출하 수량이 사라졌으므로).
  try {
    await deleteEntityWithAttachments('shipment', 'shipments', row.id, [
      { sql: "SELECT json('conflict') WHERE EXISTS(SELECT 1 FROM sales_bill_lines WHERE source_type='ship' AND source_id=? AND active=1)", args: [row.id] },
      { sql: "UPDATE ship_instructions SET status='cancelled',shipment_id=NULL,processed_by=?,processed_at=? WHERE shipment_id=?", args: [user.name, now(), row.id] },
    ]);
  } catch (error) { if (isGuardError(error)) throw new HttpError(409, billed); throw error; }
  return { ok: true };
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
  const shipPending = new Map(); // 15.254 같은 등록 안 LOT 잔량
  for (const [index, item] of body.items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad(`${index + 1}번째 품목을 확인하세요.`);
    const b = { ...(body.common || {}), ...item }; const meta = lineMeta(b); let record;
    try {
      if (entity === 'purchase_order') {
        // Validate the whole line first so a bad row never leaves a temporary code behind.
        if (b.bom_id) { const chosen = await catalogItem(user, b); b.item = chosen.product; if (!b.item_category && ITEM_CATEGORIES.includes(chosen.item_category)) b.item_category = chosen.item_category; }
        const f = poFields(b, true); const entry = await catalogItem(user, b);
        record = Object.fromEntries(['req_no','vendor','item','qty','due_date','note','item_category','coa_requested'].map((key,i) => [key, f[i]]));
        record.item = entry.product; record.product_code = entry.product_code; if (!meta.unit) meta.unit = entry.unit || '';
        meta.spec = await catalogSpec(entry, meta.spec);
        // 15.107 발주 단가(줄마다). 발주서 금액·매입전표 기본 단가로 쓰인다.
        if (b.unit_price !== undefined && b.unit_price !== '') record.unit_price = poUnitPrice(b.unit_price, '단가');
        record.internal_note = str(b.internal_note, 200); // 15.69 내부 메모(공통)
        if (index === 0) await ensureVendor(record.vendor, user, 'purchase');
      } else if (entity === 'shipment') {
        if (b.bom_id) b.item = (await catalogItem(user, b)).product;
        const f = shipFields(b); const entry = await catalogItem(user, b);
        record = Object.fromEntries(['ship_date','item','qty','customer','note','lot'].map((key,i) => [key, f[i]]));
        record.item = entry.product; record.product_code = entry.product_code; if (!meta.unit) meta.unit = entry.unit || '';
        meta.spec = await catalogSpec(entry, meta.spec);
        if (index === 0) await ensureVendor(record.customer, user, 'sales');
        try { await checkShipLot(record.item, record.lot, record.qty, shipPending); } catch (error) { throw bad(`${index + 1}번째 줄: ${error.message}`); } // 15.150 · 15.254 잔량
      } else if (entity === 'other_receipt') {
        const fields = await otherReceiptFields(b); if (index === 0) await ensureVendor(fields[4], user, 'purchase');
        record = Object.fromEntries(['received_date','item','item_category','qty','vendor','note','bom_id','bom_snapshot'].map((key,i) => [key, fields[i]]));
        meta.unit = JSON.parse(record.bom_snapshot).unit || '';
        meta.spec = await catalogSpec(record.bom_id, meta.spec);
      } else if (entity === 'schedule') {
        record = await schedFields({ ...b, product: b.product || b.item });
        if (record.bom_id) meta.unit = JSON.parse(record.bom_snapshot).unit || '';
        if (record.bom_id && record.kind !== 'semi') meta.spec = await catalogSpec(record.bom_id, meta.spec); // 15.121 완제품 계획: 등록 규격 고정
        // Write the size the way cutting/fusing records store it, so the plan finds its actuals.
        if (record.kind === 'semi' && meta.spec) { const kind = record.bom_id ? JSON.parse(record.bom_snapshot).semi_type : ''; const group = semiGroupOfLabel(record.product) || (kind ? Object.keys(SEMI_PRODUCTS).find(g => SEMI_PRODUCTS[g].types.includes(kind)) : null); if (group) meta.spec = semiSpec(group, meta.spec, false); }
      } else if (entity === 'laundry') {
        record = { in_date: dateStr(b.in_date, '입고일'), item: reqStr(b.item, '옷 종류', 200), in_qty: num(b.in_qty ?? b.qty, '입고수량'), discard_qty: num(b.discard_qty ?? 0, '폐기수량'), note: str(b.note, 500), photos: '[]' };
        if (record.discard_qty > record.in_qty) throw bad('폐기수량이 입고수량을 넘을 수 없습니다.');
      } else {
        const type = String(b.type || ''); if (!Object.hasOwn(REQUEST_TYPES, type)) throw bad('의뢰 종류를 확인하세요.');
        const qty = num(b.qty, '수량'); if (qty <= 0) throw bad('수량은 0보다 커야 합니다.');
        const data = { ...(b.data || {}), qty, spec: meta.spec, unit: meta.unit };
        if (analysisLike(type)) { data.sample_qty = String(qty); data.lot = meta.lot ? '있음' : '없음'; data.lot_etc = meta.lot; }
        else { data.lot = meta.lot; if (['sample', 'sample_goods'].includes(type)) data.req_qty = String(qty); }
        const f = requestFields(type, { ...b, title: b.title || b.item, data });
        record = { type, inspection_snapshot: type==='analysis'?await inspectionSnapshot(f):'', title: f.title, customer: f.customer, due_date: f.due_date, category: f.category, target_price: f.target_price, data: JSON.stringify(f.data), qty, requester_id: user.id, requester_name: user.name };
      }
      if (entity !== 'request') record.created_by = user.name;
      const savedRecord = { ...record, ...meta, batch_id: batchId };
      commands.push(entity === 'purchase_order' ? insertPurchaseOrder(savedRecord, batchId) : insertItem(BATCH_TABLES[entity], savedRecord));
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

// ── 15.150 LOT 보호 ──
// 생산 투입·출하에 쓰인 LOT: 그 입고의 품목·수량·LOT을 바꾸거나 지우지 못한다(쓴 생산실적·출하를 먼저 취소).
async function lotUsage(item, lot) {
  if (!lot) return null;
  const r = await db.prepare(`SELECT (SELECT COALESCE(SUM(i.qty),0) FROM production_lot_inputs i JOIN production_actuals a ON a.id=i.actual_id WHERE a.voided_at IS NULL AND TRIM(i.item)=TRIM(?) AND i.lot=?)
      + (SELECT COALESCE(SUM(qty),0) FROM semi_lot_inputs WHERE TRIM(item)=TRIM(?) AND lot=?) AS used,
    (SELECT COALESCE(SUM(qty),0) FROM shipments WHERE TRIM(item)=TRIM(?) AND lot=?) AS shipped`).get(item, lot, item, lot, item, lot); // 15.253 커팅·융착 투입 포함
  return r.used || r.shipped ? r : null;
}
const lotUsedMessage = (item, lot, u) => `${item}: LOT ${lot}은 ${[u.used ? `생산 투입 ${stockRound(u.used)}` : '', u.shipped ? `출하 ${stockRound(u.shipped)}` : ''].filter(Boolean).join(' · ')}에 쓰였습니다. 바꾸려면 그 생산실적·출하를 먼저 취소하세요.`;
// 출하 LOT: 다른 품목의 LOT이면 막는다. 이 품목에 LOT 기록이 있는데 모르는 LOT이어도 막는다(LOT 기록이 아예 없는 품목은 예전처럼 자유 입력).
// 15.254 수입검사 불합격 LOT: 커팅·생산 투입·출하에 쓸 수 없다(품질에서 판정을 바꾸면 다시 쓸 수 있음).
// 15.256 특채: 품질책임자가 특채 처리한 불합격 LOT은 투입·출고 허용
async function lotConcession(item, lot) { return db.prepare('SELECT * FROM lot_concessions WHERE item=TRIM(?) AND lot=? AND voided_at IS NULL').get(item, lot); }
async function lotQcFail(item, lot) {
  if (!lot) return null;
  if (await lotConcession(item, lot)) return null;
  return lotQcFailRaw(item, lot);
}
async function lotQcFailRaw(item, lot) {
  if (!lot) return null;
  return db.prepare(`SELECT r.req_no FROM requests r JOIN inspection_measurements m ON m.request_id=r.id WHERE r.type='analysis' AND m.result='fail' AND TRIM(r.title)=TRIM(?) AND (r.lot=? OR (', ' || r.lot || ',') LIKE ?) LIMIT 1`).get(item, lot, `%, ${lot},%`);
}
async function lotQcFailSet(item) {
  const rows = await db.prepare(`SELECT r.lot FROM requests r JOIN inspection_measurements m ON m.request_id=r.id WHERE r.type='analysis' AND m.result='fail' AND TRIM(r.title)=TRIM(?)`).all(item);
  const ok = new Set((await db.prepare('SELECT lot FROM lot_concessions WHERE item=TRIM(?) AND voided_at IS NULL').all(item)).map(r => r.lot));
  return new Set(rows.flatMap(r => String(r.lot || '').split(',').map(x => x.trim()).filter(Boolean)).filter(l => !ok.has(l)));
}
// 15.256 LOT 관리 표: 품목·LOT별 품질 상태(fail | concession)
async function lotQcStates() {
  const fails = await db.prepare(`SELECT TRIM(r.title) AS item, r.lot, r.req_no FROM requests r JOIN inspection_measurements m ON m.request_id=r.id WHERE r.type='analysis' AND m.result='fail'`).all();
  const ok = new Map((await db.prepare('SELECT item, lot, id, reason, created_by, created_at FROM lot_concessions WHERE voided_at IS NULL').all()).map(c => [c.item + '\u0000' + c.lot, c]));
  const out = new Map();
  for (const f of fails) for (const lot of String(f.lot || '').split(',').map(x => x.trim()).filter(Boolean)) { const k = f.item + '\u0000' + lot, c = ok.get(k); out.set(k, c ? { qc: 'concession', req_no: f.req_no, concession: c } : { qc: 'fail', req_no: f.req_no }); }
  return out;
}
route('POST', '/api/lots/concession', async ({ user, body }) => {
  if (!hasRole(user, 'quality_approver')) throw new HttpError(403, '특채는 품질책임자만 처리할 수 있습니다.');
  const item = reqStr(body.item, '품목', 200), lot = reqStr(body.lot, 'LOT', 100), reason = reqStr(body.reason, '특채 사유', 500);
  const q = await lotQcFailRaw(item, lot); if (!q) throw bad(`${item}: LOT ${lot}은 수입검사 불합격 LOT이 아닙니다.`);
  if (await lotConcession(item, lot)) throw new HttpError(409, '이미 특채 처리한 LOT입니다.');
  try { await db.prepare('INSERT INTO lot_concessions(item,lot,req_no,reason,created_by,created_by_id) VALUES(?,?,?,?,?,?)').run(item, lot, q.req_no, reason, user.name, user.id); }
  catch (error) { if (/UNIQUE/i.test(String(error?.message))) throw new HttpError(409, '이미 특채 처리한 LOT입니다.'); throw error; }
  return lotConcession(item, lot);
});
route('POST', '/api/lots/concession/:id/void', async ({ user, params, body }) => {
  if (!hasRole(user, 'quality_approver')) throw new HttpError(403, '특채 취소는 품질책임자만 할 수 있습니다.');
  const c = await mustGet('lot_concessions', params.id); if (c.voided_at) throw new HttpError(409, '이미 취소한 특채입니다.');
  await db.prepare('UPDATE lot_concessions SET voided_at=?, voided_by=?, void_reason=? WHERE id=? AND voided_at IS NULL').run(now(), user.name, reqStr(body.reason, '취소 사유', 500), c.id);
  return { ok: true };
});
route('GET', '/api/lots/concessions', async ({ query }) => ({ rows: await db.prepare(`SELECT * FROM lot_concessions ${query.all ? '' : 'WHERE voided_at IS NULL'} ORDER BY id DESC LIMIT 500`).all() }));
// 15.256 LOT 내역: 한 품목·LOT의 입고·생산 / 출고·투입 / 반입·반출 / 이동을 날짜순으로
route('GET', '/api/inventory/lot-history', async ({ query }) => {
  const item = reqStr(query.item, '품목', 200), lot = reqStr(query.lot, 'LOT', 100);
  const q = (sql, ...args) => db.prepare(sql).all(...args);
  const parts = await Promise.all([
    q(`SELECT l.received_date AS d, 'in' AS kind, '발주입고' AS src, COALESCE(r.receipt_no, p.req_no) AS doc, p.vendor AS party, l.qty, TRIM(l.warehouse || ' ' || l.location) AS place, l.note FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id LEFT JOIN receipts r ON r.id=l.receipt_id WHERE l.voided_at IS NULL AND p.recv_status IN ('ok','mismatch') AND TRIM(p.item)=TRIM(?) AND l.lot=?`, item, lot),
    q(`SELECT COALESCE(substr(recv_at,1,10), due_date) AS d, 'in' AS kind, '발주입고' AS src, req_no AS doc, vendor AS party, recv_qty AS qty, '' AS place, recv_note AS note FROM purchase_orders WHERE TRIM(item)=TRIM(?) AND lot=? AND recv_status IN ('ok','mismatch') AND recv_qty IS NOT NULL AND NOT EXISTS(SELECT 1 FROM po_receipt_lots l WHERE l.po_id=purchase_orders.id AND l.voided_at IS NULL)`, item, lot),
    q(`SELECT o.received_date AS d, 'in' AS kind, '기타입고' AS src, COALESCE(r.receipt_no, '') AS doc, o.vendor AS party, o.qty, TRIM(o.warehouse || ' ' || o.location) AS place, o.note FROM other_receipts o LEFT JOIN receipts r ON r.id=o.receipt_id WHERE TRIM(o.item)=TRIM(?) AND o.lot=?`, item, lot),
    q(`SELECT ship_date AS d, 'out' AS kind, '출고' AS src, '' AS doc, customer AS party, qty, '' AS place, note FROM shipments WHERE TRIM(item)=TRIM(?) AND lot=?`, item, lot),
    q(`SELECT r.return_date AS d, CASE r.side WHEN 'in' THEN 'in' ELSE 'out' END AS kind, CASE r.side WHEN 'in' THEN '반입' ELSE '반출' END AS src, r.return_no AS doc, r.party, l.qty, '' AS place, l.reason AS note FROM stock_return_lines l JOIN stock_returns r ON r.id=l.return_id WHERE TRIM(l.item)=TRIM(?) AND l.lot=? AND r.status='confirmed' AND r.process IN ('stock_amount','stock')`, item, lot),
    q(`SELECT a.production_date AS d, 'in' AS kind, '생산' AS src, a.work_order AS doc, '' AS party, a.qty, '' AS place, a.note FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE TRIM(s.product)=TRIM(?) AND a.lot=? AND a.voided_at IS NULL`, item, lot),
    q(`SELECT a.production_date AS d, 'out' AS kind, '생산 투입' AS src, a.work_order AS doc, s.product AS party, i.qty, '' AS place, a.lot AS note FROM production_lot_inputs i JOIN production_actuals a ON a.id=i.actual_id JOIN schedules s ON s.id=a.schedule_id WHERE TRIM(i.item)=TRIM(?) AND i.lot=? AND a.voided_at IS NULL`, item, lot),
    q(`SELECT r.work_date AS d, 'out' AS kind, CASE WHEN r.work_status='progress' THEN '커팅 투입(작업중)' ELSE '커팅 투입' END AS src, r.lot AS doc, r.unit_name AS party, CASE WHEN r.work_status='progress' THEN 0 ELSE i.qty END AS qty, '' AS place, CASE WHEN i.piece_nos<>'' THEN '절 ' || i.piece_nos WHEN i.pieces IS NOT NULL THEN i.pieces || '절' ELSE '' END AS note FROM semi_lot_inputs i JOIN semi_records r ON r.id=i.record_id WHERE TRIM(i.item)=TRIM(?) AND i.lot=?`, item, lot),
    q(`SELECT adj_date AS d, CASE WHEN qty>0 THEN 'in' ELSE 'out' END AS kind, CASE kind WHEN 'count' THEN '재고 실사' WHEN 'opening' THEN '기초재고' ELSE '재고 조정' END AS src, '' AS doc, created_by AS party, ABS(qty) AS qty, TRIM(warehouse || ' ' || location) AS place, reason || CASE WHEN counted_qty IS NOT NULL THEN ' (센 수량 ' || printf('%g', counted_qty) || ')' ELSE '' END AS note FROM stock_adjustments WHERE TRIM(item)=TRIM(?) AND lot=?`, item, lot), // 15.265
    q(`SELECT transfer_date AS d, 'move' AS kind, '이동' AS src, '' AS doc, from_place AS party, qty, to_place AS place, note FROM stock_transfers WHERE TRIM(item)=TRIM(?) AND lot=? AND status='confirmed'`, item, lot),
  ]);
  const KO = { in: 0, out: 1, move: 2 }, rows = parts.flat().sort((a, b) => stockCompare(a.d, b.d) || KO[a.kind] - KO[b.kind] || stockCompare(a.src, b.src) || stockCompare(String(a.doc || ''), String(b.doc || '')));
  let bal = 0; for (const r of rows) { r.qty = stockRound(Number(r.qty) || 0); if (r.kind === 'in') bal = stockRound(bal + r.qty); else if (r.kind === 'out') bal = stockRound(bal - r.qty); r.balance = bal; }
  const st = (await lotQcStates()).get(String(item).trim() + '\u0000' + lot) || null;
  return { item, lot, rows, qc: st };
});
const qcFailMessage = (item, lot, q) => `${item}: LOT ${lot}은 수입검사 불합격(${q.req_no})입니다. 품질에서 판정을 바꾼 뒤 쓰세요.`;
// 15.254 출하 LOT 잔량: 재고 LOT이 있으면 잔량(같은 등록 안의 앞 줄 포함)을 넘게 출하할 수 없다
async function checkShipLot(item, lot, qty = null, pending = null) {
  if (!lot) return;
  { const q = await lotQcFail(item, lot); if (q) throw bad(qcFailMessage(String(item).trim(), lot, q)); }
  if (qty !== null && Number(qty) > 0) { const row = (await lotStockReport({ q: lot })).rows.find(x => x.item === String(item).trim() && x.lot === lot);
    if (row) { const key = row.item + '\u0000' + lot, total = stockRound((pending?.get(key) || 0) + Number(qty)); if (total > row.balance + 0.000001) throw bad(`${row.item}: LOT ${lot} 잔량 ${stockRound(row.balance)} ${row.unit || ''}보다 많이 출하할 수 없습니다.`); pending?.set(key, total); } }
  const owners = (await db.prepare(`SELECT DISTINCT TRIM(p.item) AS item FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.lot=? AND l.voided_at IS NULL
    UNION SELECT DISTINCT TRIM(item) FROM other_receipts WHERE lot=? UNION SELECT DISTINCT TRIM(s.product) FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE a.lot=? AND a.voided_at IS NULL
    UNION SELECT DISTINCT TRIM(item) FROM purchase_orders WHERE lot=? AND recv_status IN ('ok','mismatch')`).all(lot, lot, lot, lot)).map(r => r.item);
  const me = String(item || '').trim();
  if (owners.includes(me)) return;
  if (owners.length) throw bad(`LOT ${lot}은 다른 품목(${owners.slice(0, 2).join(', ')})의 LOT입니다. ${me}의 재고 LOT을 고르세요.`);
  const tracked = await db.prepare(`SELECT 1 WHERE EXISTS(SELECT 1 FROM other_receipts WHERE TRIM(item)=? AND lot<>'') OR EXISTS(SELECT 1 FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE TRIM(p.item)=? AND l.lot<>'' AND l.voided_at IS NULL)
    OR EXISTS(SELECT 1 FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE TRIM(s.product)=? AND a.lot<>'')`).get(me, me, me);
  if (tracked) throw bad(`LOT ${lot}은 ${me}의 입고·생산 LOT이 아닙니다. LOT 칸에서 재고 LOT을 고르세요.`);
}
route('PUT', '/api/items/:entity/:id', async ({ user, params, body }) => {
  if (!Object.hasOwn(BATCH_TABLES,params.entity)) throw bad('품목 목록을 확인하세요.');
  const row = await mustGet(BATCH_TABLES[params.entity],params.id);
  const role = { purchase_order:'purchase',shipment:'logistics',other_receipt:'logistics',laundry:'purchase',schedule:'production',request:REQUEST_TYPES[row.type] }[params.entity];
  const own = params.entity === 'request' ? row.requester_id === user.id && ['pending','rejected'].includes(row.status) : canModify(user,row);
  if (!own && !hasRole(user,role)) throw new HttpError(403,'등록자 또는 담당자만 규격·단위를 수정할 수 있습니다.');
  const meta = lineMeta(body,row);
  if (params.entity === 'shipment' && meta.unit !== (row.unit || '') && await db.prepare("SELECT 1 FROM sales_bill_lines WHERE source_type='ship' AND source_id=? AND active=1").get(row.id)) throw new HttpError(409, `${row.item}: 매출전표에 들어간 출하의 단위는 바꿀 수 없습니다.`);
  if (params.entity === 'schedule' && await db.prepare('SELECT 1 FROM production_actuals WHERE schedule_id=?').get(row.id)) {
    if (['spec','unit'].some(key => meta[key] !== (key === 'unit' ? row.unit || JSON.parse(row.bom_snapshot || '{}').unit || '' : row[key]))) throw bad('실적이 있는 생산일정의 규격·단위는 변경할 수 없습니다.');
  }
  if (['schedule','other_receipt'].includes(params.entity) && row.bom_id && meta.unit !== (JSON.parse(row.bom_snapshot).unit || '')) throw bad('BOM 품목의 단위는 BOM에 저장된 단위를 사용하세요.');
  if (row.source_type) { const snapshot = JSON.parse(row.data || '{}'); if (meta.spec !== (row.spec || snapshot.spec || '') || meta.unit !== (row.unit || snapshot.unit || '') || meta.lot !== (row.lot || snapshot.lot_etc || snapshot.lot || '')) throw bad('입고 자동분석의 품목 정보는 입고 당시 스냅샷을 유지합니다. 정정사항은 코멘트에 남기세요.'); }
  { const bom = row.bom_id ? await db.prepare('SELECT * FROM boms WHERE id=?').get(row.bom_id) : row.product_code ? await db.prepare("SELECT * FROM boms WHERE product_code<>'' AND UPPER(product_code)=UPPER(?) ORDER BY is_temp, id DESC LIMIT 1").get(row.product_code) : null;
    if (bom && !row.source_type) meta.spec = await catalogSpec(bom, meta.spec, row.spec || ''); } // 15.121
  if (['other_receipt', 'purchase_order'].includes(params.entity) && meta.lot !== (row.lot || '')) { // 15.150
    const u = await lotUsage(row.item, row.lot); if (u) throw new HttpError(409, lotUsedMessage(row.item, row.lot, u));
    if (row.lot && !user.is_admin) throw new HttpError(403, `LOT 번호는 관리자만 바꿀 수 있습니다(라벨·투입·출하 기록과 어긋나지 않게). 잘못 넣은 경우 관리자에게 요청하세요.`);
  }
  if (params.entity === 'shipment' && meta.lot !== (row.lot || '')) await checkShipLot(row.item, meta.lot, row.qty); // 15.258 잔량까지
  const set = ['spec=?','unit=?','lot=?']; const args = [meta.spec,meta.unit,meta.lot];
  if (params.entity === 'laundry') { set.push('item=?'); args.push(reqStr(body.item ?? row.item,'옷 종류',200)); }
  if (params.entity === 'request') {
    const data = JSON.parse(row.data || '{}'); data.spec = meta.spec; data.unit = meta.unit;
    if (analysisLike(row.type)) { data.lot = meta.lot ? '있음' : '없음'; data.lot_etc = meta.lot; } else data.lot = meta.lot;
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
  const ins = page.length ? await db.prepare(`SELECT actual_id, item, unit, lot, qty FROM production_lot_inputs WHERE actual_id IN (${page.map(() => '?').join(',')}) ORDER BY id`).all(...page.map(r => r.id)) : [];
  for (const r of page) r.inputs = ins.filter(x => x.actual_id === r.id);
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
  const date = dateStr(body.production_date, '생산일'); const progress = body.work_status === 'progress' && (body.qty === '' || body.qty == null); const qty = progress ? 0 : num(body.qty, '실제 생산량'); // 15.255 작업중
  const end = await actualPeriodEnd(schedule);
  if (date < schedule.start_date || date > end) throw bad('생산일은 해당 계획의 기간 안에서 선택하세요.');
  if (date > today()) throw bad('아직 지나지 않은 날짜의 생산실적은 입력할 수 없습니다.');
  const key = reqStr(body.request_id, '실적 요청 번호', 80);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('실적 요청 번호를 확인하세요.');
  const note = str(body.note, 1000);
  const old = await db.prepare('SELECT * FROM production_actuals WHERE request_id=?').get(key);
  const matches = row => row.schedule_id === schedule.id && row.author_id === user.id && row.production_date === date && row.qty === qty && row.note === note;
  if (old) { if (!matches(old)) throw new HttpError(409, '이미 사용된 실적 요청 번호입니다.'); return old; }
  // 15.135 투입 자재 LOT: 그 LOT의 남은 수량 안에서만(같은 LOT 여러 줄은 합쳐서 확인).
  const inputs = await actualLotInputs(body.inputs);
  const bags = await packBags(body.bags); // 15.249 이날 포장에 쓴 세탁 완료 봉투 LOT
  // 15.249 완제품 LOT: 직접 적지 않으면 포장일_품목코드_P순번(261121_NX808_P1).
  const snap = JSON.parse(schedule.bom_snapshot || '{}');
  if (progress && !bags.length && (snap.materials || []).some(m => m.item_category === '반제품')) throw bad('작업중으로 저장하려면 포장에 쓸 반제품 LOT을 고르세요.'); // 15.283 반제품 없는 품목(부직포와이퍼 등)은 봉투 없이
  const lot = qty > 0 || progress ? (str(body.lot, 100) || await nextFinishedLot(date, lotCode(snap.product_code, schedule.product))) : '';
  const wo = `WOR_${date.replace(/-/g, '')}_`; // 15.230 작업지시번호 WOR_YYYYMMDD_001(실적 날짜 기준)
  const cmds = [{ sql: "INSERT INTO production_actuals(schedule_id,production_date,qty,note,author_id,author_name,request_id,lot,work_order,work_status) VALUES(?,?,?,?,?,?,?,?,(SELECT ? || printf('%03d', COALESCE(MAX(CAST(substr(work_order, 14) AS INTEGER)), 0) + 1) FROM production_actuals WHERE substr(work_order, 1, 13)=?),?)", args: [schedule.id, date, qty, note, user.id, user.name, key, lot, wo, wo, progress ? 'progress' : 'done'] },
    ...inputs.map(i => ({ sql: 'INSERT INTO production_lot_inputs(actual_id,item,unit,lot,qty,created_by) VALUES((SELECT id FROM production_actuals WHERE request_id=?),?,?,?,?,?)', args: [key, i.item, i.unit, i.lot, i.qty, user.name] })),
    ...bags.map(b => ({ sql: 'INSERT INTO pack_bag_links(actual_id,bag_lot,item,created_by) VALUES((SELECT id FROM production_actuals WHERE request_id=?),?,?,?)', args: [key, b.lot, b.item, user.name] }))];
  if ((qty > 0 || progress) && !str(body.lot, 100)) cmds.push({ sql: LOT_DUP_GUARD + '(SELECT COUNT(*) FROM production_actuals WHERE lot=? AND voided_at IS NULL) > 1', args: [lot] }); // 15.254
  try { await db.batch(cmds); return actualWithInputs(await db.prepare('SELECT * FROM production_actuals WHERE request_id=?').get(key)); }
  catch (error) { const saved = await db.prepare('SELECT * FROM production_actuals WHERE request_id=?').get(key); if (saved && matches(saved)) return actualWithInputs(saved); throw lotDupError(error); }
});
// 15.255 포장 작업중 목록·작업완료(수량을 넣으면 완료, 봉투 더하기 가능, 투입 자재 LOT 함께)
route('GET', '/api/actuals/progress', async () => {
  const rows = await db.prepare(`SELECT a.id, a.schedule_id, a.production_date, a.lot, a.work_order, a.note, a.author_name, s.product, s.spec, COALESCE(NULLIF(s.unit,''),json_extract(s.bom_snapshot,'$.unit'),'') AS unit, s.bom_snapshot
    FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE a.work_status='progress' AND a.voided_at IS NULL ORDER BY a.production_date, a.id LIMIT 200`).all();
  for (const r of rows) { r.bags = await db.prepare('SELECT p.bag_lot AS lot, c.qty FROM pack_bag_links p LEFT JOIN semi_records c ON c.process=\'cut\' AND c.lot=p.bag_lot WHERE p.actual_id=? ORDER BY p.id').all(r.id); try { r.bom_snapshot = JSON.parse(r.bom_snapshot || '{}'); } catch { r.bom_snapshot = {}; } }
  return { rows };
});
route('POST', '/api/actuals/:id/complete', async ({ user, params, body }) => {
  const a = await mustGet('production_actuals', params.id);
  if (a.work_status === 'done' && !a.voided_at && Number(body.qty) === Number(a.qty)) return actualWithInputs(a); // 15.258 재요청
  if (a.work_status !== 'progress' || a.voided_at) throw new HttpError(409, '작업중인 포장 기록이 아닙니다.');
  await actualSchedule(user, a.schedule_id, true);
  const qty = num(body.qty, '실제 생산량'); if (!(qty > 0)) throw bad('생산 수량을 넣으세요.');
  const inputs = await actualLotInputs(body.inputs), more = await packBags(body.bags), have = new Set((await db.prepare('SELECT bag_lot FROM pack_bag_links WHERE actual_id=?').all(a.id)).map(x => x.bag_lot));
  const cmds = [{ sql: "UPDATE production_actuals SET qty=?,note=CASE WHEN ?<>'' THEN ? ELSE note END,work_status='done' WHERE id=? AND work_status='progress'", args: [qty, str(body.note, 1000), str(body.note, 1000), a.id] }, RC_GUARD,
    ...inputs.map(i => ({ sql: 'INSERT INTO production_lot_inputs(actual_id,item,unit,lot,qty,created_by) VALUES(?,?,?,?,?,?)', args: [a.id, i.item, i.unit, i.lot, i.qty, user.name] })),
    ...more.filter(b => !have.has(b.lot)).map(b => ({ sql: 'INSERT INTO pack_bag_links(actual_id,bag_lot,item,created_by) VALUES(?,?,?,?)', args: [a.id, b.lot, b.item, user.name] }))];
  try { await db.batch(cmds); } catch (error) { if (isGuardError(error)) throw new HttpError(409, '이미 작업완료한 기록입니다.'); throw error; }
  return actualWithInputs(await mustGet('production_actuals', a.id));
});
// 15.249 완제품 LOT: 포장일_품목코드_P순번(261121_NX808_P1). 같은 날·같은 품목마다 P1부터.
async function nextFinishedLot(date, code) {
  const head = `${String(date).slice(2).replace(/-/g, '')}_${code}_P`;
  const used = await db.prepare("SELECT MAX(CAST(substr(lot, length(?) + 1) AS INTEGER)) AS n FROM production_actuals WHERE substr(lot,1,length(?))=? AND length(lot)>length(?) AND substr(lot,length(?)+1) NOT GLOB '*[^0-9]*'").get(head, head, head, head, head);
  return head + (((used && used.n) || 0) + 1);
}
// 15.279 세탁 없는 봉투: 부직포(생산 종류 부직포와이퍼, 또는 품목명에 「부직포」)는 커팅·융착 작업완료면 바로 포장에 쓴다.
const WASH_FREE_SQL = (c = 'c') => `(${c}.product_type='부직포와이퍼' OR ${c}.item_name LIKE '%부직포%' OR EXISTS(SELECT 1 FROM boms wf WHERE wf.id=${c}.bom_id AND wf.semi_type='부직포와이퍼'))`;
const bagReadySql = (c = 'c') => `((${WASH_FREE_SQL(c)} AND ${c}.work_status='done') OR EXISTS(SELECT 1 FROM semi_records w WHERE w.process='wash' AND w.lot=${c}.lot AND w.work_status='done'))`;
// 포장에 쓴 봉투: 세탁을 마친 봉투 LOT만(남은 봉투는 다음 포장에 다시 고를 수 있음). 세탁 없는 봉투(부직포)는 커팅 작업완료면 됨.
async function packBags(raw) {
  const list = Array.isArray(raw) ? [...new Set(raw.map(x => str(typeof x === 'object' && x ? x.lot : x, 100)).filter(Boolean))] : [];
  if (list.length > 60) throw bad('반제품 LOT은 한 번에 60개까지 고를 수 있습니다.');
  const out = [];
  for (const lot of list) {
    const bag = await semiBagRecord(lot); if (!bag) throw bad(`반제품 LOT ${lot}을 찾을 수 없습니다.`);
    if (!await db.prepare(`SELECT 1 FROM semi_records c WHERE c.id=? AND ${bagReadySql('c')}`).get(bag.id)) throw bad(bag.work_status === 'progress' ? `반제품 LOT ${lot}은 아직 커팅·융착 작업중입니다. 작업완료한 뒤 고르세요.` : `반제품 LOT ${lot}은 아직 세탁·건조를 마치지 않았습니다(기록 없음 또는 작업중). 세탁을 작업완료한 뒤 고르세요.`); // 15.255 · 15.279 부직포는 세탁 없음
    out.push({ lot, item: bag.item_name || '' });
  }
  return out;
}
// 15.190 생산 완제품 포장 LOT: [P][생산일]-[순번 3자리] (P261113-001).
async function nextProductionLot(prefix, date) {
  const head = `${prefix}${date.slice(2).replace(/-/g, '')}-`;
  const match = "substr(lot,1,length(?))=? AND length(lot)>length(?) AND substr(lot,length(?)+1) NOT GLOB '*[^0-9]*'";
  const used = await db.prepare(`SELECT MAX(n) AS n FROM (SELECT CAST(substr(lot, length(?) + 1) AS INTEGER) AS n FROM production_actuals WHERE ${match} UNION ALL SELECT CAST(substr(lot, length(?) + 1) AS INTEGER) FROM po_receipt_lots WHERE ${match} UNION ALL SELECT CAST(substr(lot, length(?) + 1) AS INTEGER) FROM other_receipts WHERE ${match})`).get(...Array(15).fill(head));
  return head + String(((used && used.n) || 0) + 1).padStart(3, '0');
}
async function actualLotInputs(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > 60) throw bad('투입 LOT은 60줄까지 넣을 수 있습니다.');
  const out = [];
  for (const [n, r] of list.entries()) {
    const l = r && typeof r === 'object' ? r : {}, lot = str(l.lot, 100), item = str(l.item, 200);
    if (!lot && (l.qty === '' || l.qty == null)) continue;
    if (item && lot) { const q = await lotQcFail(item, lot); if (q) throw bad(qcFailMessage(item, lot, q)); } // 15.254
    if (!item) throw bad(`투입 ${n + 1}번째 줄: 자재를 고르세요.`);
    if (!lot) throw bad(`투입 ${n + 1}번째 줄(${item}): LOT을 고르세요.`);
    const qty = num(l.qty, `투입 ${n + 1}번째 줄 수량`); if (!(qty > 0)) throw bad(`투입 ${n + 1}번째 줄(${item} ${lot}): 수량은 0보다 커야 합니다.`);
    out.push({ item, unit: str(l.unit, 20), lot, qty });
  }
  const sums = new Map(); for (const i of out) { const k = JSON.stringify([i.item, i.lot]); sums.set(k, (sums.get(k) || 0) + i.qty); }
  for (const [k, need] of sums) {
    const [item, lot] = JSON.parse(k), have = (await lotBalances(item)).find(r => r.lot === lot);
    if (!have) throw bad(`${item}: LOT ${lot}의 재고가 없습니다. LOT별 재고를 확인하세요.`);
    if (need > have.balance + 0.000001) throw bad(`${item}: LOT ${lot}의 남은 수량은 ${have.balance}입니다(투입 ${stockRound(need)}).`);
    for (const i of out) if (i.item === item && i.lot === lot && have.unit) i.unit = have.unit; // 15.150 LOT 단위로 저장
  }
  return out;
}
// 품목 하나의 LOT별 남은 수량(먼저 들어온 순). 생산 투입·출하 LOT 고르기에 쓴다.
// 15.252 원자재 입고에 실물(절)을 안 적으면 임시 1절(코드 LOT-1, 여러 번 투입 가능)으로 LOT 추적이 끊기지 않게
function tempPieces(line, category) { if (!line.pieces) return String(category || '') === '원자재' ? { pieces: 1, temp: 1 } : { pieces: null, temp: 0 }; return { pieces: line.pieces, temp: 0 }; } // 15.253 0절도 안 적은 것으로
// 15.250 실물 수량(절): 비우면 없음(NULL), 0 이상 숫자
function piecesOf(v) { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 0) throw bad('실물(절) 수량은 0 이상 정수로 넣으세요.'); return n; }
// LOT별 실물(절): 입고에 적은 절 − 커팅·융착에 투입한 절. 입고에 절을 안 적은 LOT은 null.
async function lotPieces(item) {
  // 줄마다 절 번호(발주입고 줄 먼저, 그다음 기타입고, 각각 id 순 — 입고 상세의 piece_from과 같은 순서). 취소한 입고 줄은 번호만 차지하고 쓸 수 없음.
  const rows = await db.prepare(`SELECT l.lot AS lot, l.pieces AS pieces, l.pieces_temp AS pieces_temp, 0 AS src, l.id AS id, CASE WHEN l.voided_at IS NULL THEN 0 ELSE 1 END AS voided FROM po_receipt_lots l JOIN purchase_orders o ON o.id=l.po_id WHERE TRIM(o.item)=? AND l.pieces IS NOT NULL
    UNION ALL SELECT lot, pieces, pieces_temp, 1, id, 0 FROM other_receipts WHERE TRIM(item)=? AND pieces IS NOT NULL ORDER BY 1, 4, 5`).all(item, item);
  const map = new Map();
  for (const r of rows) { const m = map.get(r.lot) || { received: 0, total: 0, used: 0, nos: new Set(), temp: new Set() }; const from = m.total + 1; m.total += Math.floor(r.pieces);
    if (r.voided) { for (let n = from; n <= m.total; n++) m.nos.add(n); } else { m.received = stockRound(m.received + r.pieces); if (r.pieces_temp) for (let n = from; n <= m.total; n++) m.temp.add(n); } map.set(r.lot, m); }
  const used = await db.prepare("SELECT lot, pieces, piece_nos FROM semi_lot_inputs WHERE TRIM(item)=? ORDER BY id").all(item);
  const counted = new Map();
  for (const u of used) { const m = map.get(u.lot); if (!m) continue; const nos = String(u.piece_nos || '').split(',').filter(n => /^\d+$/.test(n)).map(Number);
    if (nos.length) { for (const n of nos) if (!m.temp.has(n)) { m.nos.add(n); m.used = stockRound(m.used + 1); } } else counted.set(u.lot, (counted.get(u.lot) || 0) + (Math.floor(Number(u.pieces)) || 0)); }
  // 절 수만 적은 투입(번호 없음)은 남은 번호 중 앞에서부터 쓴 것으로 친다(번호로 다시 고를 수 없게)
  for (const [lot, c] of counted) { const m = map.get(lot); let left = c; for (let n = 1; n <= m.total && left > 0; n++) if (!m.nos.has(n) && !m.temp.has(n)) { m.nos.add(n); left--; m.used = stockRound(m.used + 1); } }
  return map;
}
async function lotBalances(item) {
  const r = await lotStockReport({ q: item, state: 'instock' });
  const pcs = await lotPieces(String(item).trim()); // 15.250 실물(절)
  const qcFail = await lotQcFailSet(String(item).trim()), alias = await vendorLots(String(item).trim()); // 15.254
  const conceded = new Set((await db.prepare('SELECT lot FROM lot_concessions WHERE item=TRIM(?) AND voided_at IS NULL').all(item)).map(r => r.lot)); // 15.256 특채
  // 15.251 절 코드 LOT-1 … LOT-N: 아직 안 쓴 번호(pieces_free)
  return r.rows.filter(x => x.item === String(item).trim() && x.lot !== '(LOT 미지정)').map(x => ({ ...x, ...(qcFail.has(x.lot) ? { qc_fail: true } : {}), ...(conceded.has(x.lot) ? { concession: true } : {}), ...(alias.get(x.lot) ? { vendor_lot: alias.get(x.lot) } : {}) })).map(x => { const p = pcs.get(x.lot); if (!p) return x; const free = Array.from({ length: Math.min(p.total, 2000) }, (_, i) => i + 1).filter(n => !p.nos.has(n)); return { ...x, pieces_in: p.received, pieces_left: free.filter(n => !p.temp.has(n)).length + (p.temp.size ? p.temp.size : 0), pieces_free: free, pieces_temp: [...p.temp] }; }).sort((a, b) => stockCompare(a.first_date, b.first_date) || stockCompare(a.lot, b.lot));
}
async function actualWithInputs(a) {
  if (!a) return a;
  return { ...a, inputs: await db.prepare('SELECT item, unit, lot, qty FROM production_lot_inputs WHERE actual_id=? ORDER BY id').all(a.id) };
}
route('GET', '/api/lots/available', async ({ query }) => ({ rows: await lotBalances(reqStr(query.item, '품목', 200)) }));
// 15.135 실적 입력 창: BOM 자재마다 생산량 1당 필요량과 재고 LOT 목록
route('GET', '/api/schedules/:id/lot-materials', async ({ user, params }) => {
  const schedule = await actualSchedule(user, params.id);
  const snap = JSON.parse(schedule.bom_snapshot || '{}'), base = Number(snap.base_qty) || 0;
  const mats = Array.isArray(snap.materials) && base > 0 ? snap.materials : [];
  const out = [];
  for (const m of mats.slice(0, 30)) { const item = String(m.item || '').trim(); if (!item) continue; out.push({ item, unit: m.unit || '', item_category: m.item_category || '', per: Number(m.qty) / base, lots: await lotBalances(item) }); }
  return { product_lot_prefix: lotPrefixOf(snap.item_category || '제품'), materials: out };
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
  if (row.work_status === 'progress' && action !== 'void') throw new HttpError(409, '작업중인 포장 기록입니다. 완제품 실적 입력에서 수량을 넣고 「저장」하면 작업완료됩니다(수정은 작업완료 뒤).'); // 15.258
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
  // Every statement requires the request to still be pending, and the status UPDATE runs last:
  // a second approval of the same request (another tab, the same second) changes nothing and gets 409.
  const results = await db.batch([
    change.action === 'edit'
      ? { sql: "UPDATE production_actuals SET production_date=?,qty=?,note=?,corrected_at=?,corrected_by=? WHERE id=? AND voided_at IS NULL AND EXISTS(SELECT 1 FROM production_actual_changes WHERE id=? AND status='pending')", args: [change.new_date, change.new_qty, change.new_note, stamp, user.name, change.actual_id, change.id] }
      : { sql: "UPDATE production_actuals SET voided_at=?,voided_by=?,void_reason=? WHERE id=? AND voided_at IS NULL AND EXISTS(SELECT 1 FROM production_actual_changes WHERE id=? AND status='pending')", args: [stamp, `${change.requested_by} (승인: ${user.name})`, change.reason, change.actual_id, change.id] },
    { sql: "UPDATE production_actual_changes SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'", args: [user.name, stamp, str(body.note, 500), change.id] },
  ]);
  if (!results.at(-1).meta.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
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
// 15.249 기록의 LOT: 비우거나 안 보내면 그대로. 커팅 봉투 LOT은 세탁·포장에 쓰이기 전까지만 바꿀 수 있다.
async function semiLotValue(process, body, previous) {
  const next = body.lot === undefined ? previous?.lot ?? '' : str(body.lot, 100);
  if (process !== 'cut' || !previous?.lot || next === previous.lot) return next;
  if (!next) return previous.lot;
  if (await db.prepare("SELECT 1 FROM semi_records WHERE process='cut' AND lot=? AND id<>?").get(next, previous.id)) throw bad(`봉투 LOT ${next}은 이미 다른 커팅 기록에 있습니다.`);
  if (await db.prepare("SELECT 1 WHERE EXISTS(SELECT 1 FROM semi_records WHERE process='wash' AND lot=?) OR EXISTS(SELECT 1 FROM pack_bag_links WHERE bag_lot=?)").get(previous.lot, previous.lot)) throw bad(`봉투 LOT ${previous.lot}은 이미 세탁·포장에 쓰여 바꿀 수 없습니다.`);
  return next;
}
// 15.255 작업중: 새 기록에 수량을 비우고 work_status='progress'로 보내면 수량 0으로 저장(나중에 「작업완료」로 수량을 넣음)
const semiWip = body => body?.work_status === 'progress' && !(Number(body.qty) > 0) && !(Number(body.defect_qty) > 0); // 15.258 한 가지 기준
const semiProgress = semiWip;
async function semiFields(body, process, previous = null) {
  if (!previous && semiProgress(body)) body = { ...body, qty: 0 };
  const date = dateStr(body.work_date, '작업일'); if (date > today()) throw bad('작업일은 오늘 이전으로 선택하세요.');
  const unitId = Number(body.unit_id); if (!Number.isSafeInteger(unitId) || unitId <= 0) throw bad(process === 'cut' ? '라인을 선택하세요.' : '세탁 호기를 선택하세요.');
  const unit = await mustGet('production_units', unitId);
  if (unit.kind !== SEMI_UNIT_KIND[process]) throw bad(process === 'cut' ? '라인을 선택하세요.' : '세탁 호기를 선택하세요.');
  if (!unit.active && previous?.unit_id !== unit.id) throw bad('사용 중지된 라인·호기입니다.');
  if(process==='wash' && body.entry_mode==='wash_quantity'){const total=num(body.qty,'세탁수량'),defect=previous?.defect_qty||0;if(total<defect)throw bad('과거 불량 이력을 보존하려면 세탁수량이 '+defect+' 이상이어야 합니다.');body={...body,qty:total-defect,defect_qty:defect,defect_reason:previous?.defect_reason||''};
    // The wash screen asks only for the product code: kind and unit come from that item (an unchanged item keeps its old unit/spec).
    if(body.bom_id!==undefined&&body.bom_id!==''&&body.bom_id!==null){if(!Number.isSafeInteger(Number(body.bom_id))||Number(body.bom_id)<=0)throw bad('제품코드를 선택하세요.');const model=await mustGet('boms',body.bom_id);if(!model.semi_type)throw bad('반제품으로 쓰는 제품코드를 선택하세요.');const group=Object.keys(SEMI_PRODUCTS).find(g=>SEMI_PRODUCTS[g].types.includes(model.semi_type));const same=previous?.bom_id===model.id;body={...body,product_group:group,product_type:model.semi_type,unit:same?previous.unit:(model.semi_unit||(model.item_category==='반제품'?model.unit:'')||(group==='seamless'?'켤레':'매')),spec:same?previous.spec:''};}
    // A run time is required for counting washer runs; left blank on a new record it means "now" (KST).
    if(!previous&&!str(body.start_time,5))body={...body,start_time:now().slice(11,16)};}
  const codeEntry = process === 'cut' && body.entry_mode === 'code';
  if(codeEntry){if(!Number.isSafeInteger(Number(body.bom_id))||Number(body.bom_id)<=0)throw bad('제품코드를 선택하세요.');const model=await mustGet('boms',body.bom_id);if(!model.semi_type)throw bad('반제품으로 쓰는 제품코드를 선택하세요.');const group=Object.keys(SEMI_PRODUCTS).find(g=>SEMI_PRODUCTS[g].types.includes(model.semi_type));body={...body,product_group:group,product_type:model.semi_type,unit:previous?.bom_id===model.id?previous.unit:model.semi_unit||(group==='seamless'?'켤레':'매'),spec:previous?.bom_id===model.id?previous.spec:''};if(!previous)body={...body,break_minutes:0,workers:null};if(!body.start_time||(!body.end_time&&!semiWip(body)))throw bad(semiWip(body)?'시작 시각을 입력하세요.':'시작 시각과 종료 시각을 입력하세요.');}
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
      if (!bom.semi_type) throw bad('반제품 종류가 지정된 품목을 선택하세요.');
      link = { bom_id: bom.id, item_name: bom.product, product_code: bom.product_code, bom_snapshot: JSON.stringify({ id: bom.id, product: bom.product, product_code: bom.product_code, unit: bom.unit, base_qty: bom.base_qty, materials: JSON.parse(bom.materials) }) };
      modelUnit = bom.semi_unit || bom.unit;
    }
    const kind = (await db.prepare('SELECT semi_type FROM boms WHERE id=?').get(bomId))?.semi_type;
    if (kind !== type) throw bad(`선택한 품목(모델)은 ${type ? '이 종류의 품목이 아닙니다' : '종류를 함께 선택해야 합니다'}.`);
  } else if (process === 'cut' && await db.prepare('SELECT 1 FROM boms WHERE active=1 AND semi_type=?').get(type)) throw bad('품목(모델)을 선택하세요.');
  const unitText = str(body.unit, 20) || modelUnit;
  return { ...link, work_date: date, unit_id: unit.id, unit_name: previous?.unit_id === unit.id ? previous.unit_name : unit.name, product_group: group, product_type: type, spec: semiSpec(group, body.spec, process === 'cut' && !codeEntry && (group === 'seamless' || !link.bom_id)), ...semiWorkDetails(body, previous, process), qty: num(body.qty, '수량'), unit: unitText, lot: await semiLotValue(process, body, previous), note: str(body.note, 500) };
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
  if (process !== 'wash' && !start !== !end && !(semiWip(body) && start && !end)) throw bad('시작 시각과 종료 시각을 함께 입력하세요.'); // 15.255 작업중은 시작만
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
  if (query.work_status === 'progress') where.push("work_status='progress'"); else applyListDates(where, args, query, 'work_date'); // 15.255 작업중은 기간 없이
  if (query.unit_id) { if (!/^[1-9]\d*$/.test(query.unit_id)) throw bad('라인·호기를 확인하세요.'); where.push('unit_id=?'); args.push(Number(query.unit_id)); }
  if (query.product_group) { if (!Object.hasOwn(SEMI_PRODUCTS, query.product_group)) throw bad('품목 구분을 확인하세요.'); where.push('product_group=?'); args.push(query.product_group); }
  applyListKeyword(where, args, query.q, ['unit_name', 'product_type', 'item_name', 'product_code', 'spec', 'lot', 'note', 'created_by']);
  const rows = await db.prepare(`SELECT semi_records.*, (SELECT c.id FROM semi_record_changes c WHERE c.record_id=semi_records.id AND c.status='pending') AS pending_change_id
    FROM semi_records WHERE ${where.join(' AND ')} ORDER BY work_date DESC, id DESC LIMIT 2001`).all(...args);
  if (rows.length > 2000) throw bad('기록이 너무 많습니다. 기간을 좁히세요.');
  return operator ? rows.map(({ bom_snapshot, request_id, ...row }) => row) : rows;
}
function summarizeWasherRuns(rows) {
 const days=new Map();
 for(const r of rows){const key=r.work_date+'|'+r.unit_id;let group=days.get(key);if(!group){group={work_date:r.work_date,unit_name:r.unit_name,unit_id:r.unit_id,quantities:new Map(),cycles:new Set()};days.set(key,group);}
 const unit=r.unit||'';group.quantities.set(unit,(group.quantities.get(unit)||0)+r.qty+(r.defect_qty||0));
 group.cycles.add(r.start_time?'time:'+r.start_time:r.request_id?'batch:'+r.request_id.replace(/:\d+$/,''):'row:'+r.id);
 }
 return [...days.values()].map(g=>({work_date:g.work_date,unit_id:g.unit_id,unit_name:g.unit_name,runs:g.cycles.size,quantities:[...g.quantities].map(([unit,qty])=>({unit,qty:Math.round(qty*1e6)/1e6}))})).sort((a,b)=>b.work_date.localeCompare(a.work_date)||a.unit_id-b.unit_id);
}
route('GET','/api/wash-summary',async context=>summarizeWasherRuns(await listSemiRecords({...context,query:{...context.query,process:'wash'}})));

// ── 15.249 봉투(반제품) LOT 목록과 LOT 연결 조회 ──
// 봉투 = 커팅·융착 기록 1줄(LOT 있는 것). 세탁 기록(같은 LOT)과 포장 연결(pack_bag_links)을 붙여 상태를 만든다.
route('GET', '/api/semi-bags', async ({ query }) => {
  const state = String(query.state || 'all'); if (!['all', 'unwashed', 'washed'].includes(state)) throw bad('상태를 확인하세요.');
  const where = ["c.process='cut'", "c.lot<>''"], args = [];
  applyListDates(where, args, query, 'c.work_date');
  const q = str(query.q, 100); if (q) { const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%'; where.push("(c.lot LIKE ? ESCAPE '\\' OR c.item_name LIKE ? ESCAPE '\\' OR c.product_code LIKE ? ESCAPE '\\')"); args.push(like, like, like); }
  if (query.items) { const names = String(query.items).split('|').map(x => x.trim()).filter(Boolean).slice(0, 30); if (names.length) { where.push(`TRIM(c.item_name) IN (${names.map(() => '?').join(',')})`); args.push(...names); } }
  if (state === 'unwashed') where.push(`c.work_status='done' AND NOT ${WASH_FREE_SQL('c')} AND NOT EXISTS(SELECT 1 FROM semi_records w WHERE w.process='wash' AND w.lot=c.lot)`); // 15.255 · 15.279 부직포는 세탁 대상 아님
  if (state === 'washed') where.push(bagReadySql('c')); // 15.279 부직포는 커팅 작업완료면 포장 가능
  const rows = await db.prepare(`SELECT c.id, c.lot, c.work_date, c.unit_name, c.bom_id, c.item_name, c.product_code, c.product_group, c.product_type, c.qty, c.unit,
      (SELECT COALESCE(SUM(w.qty + COALESCE(w.defect_qty,0)),0) FROM semi_records w WHERE w.process='wash' AND w.lot=c.lot AND w.work_status='done') AS washed_qty, CASE WHEN ${WASH_FREE_SQL('c')} THEN 1 ELSE 0 END AS wash_free,
      (SELECT MAX(w.work_date) FROM semi_records w WHERE w.process='wash' AND w.lot=c.lot) AS washed_date,
      (SELECT group_concat(DISTINCT a.lot) FROM pack_bag_links p JOIN production_actuals a ON a.id=p.actual_id AND a.voided_at IS NULL WHERE p.bag_lot=c.lot) AS packed_lots
    FROM semi_records c WHERE ${where.join(' AND ')} ORDER BY c.work_date DESC, c.id DESC LIMIT 501`).all(...args);
  return { rows: rows.slice(0, 500), more: rows.length > 500 };
});
// LOT 하나를 넣으면 원자재 LOT ↔ 봉투 LOT ↔ 완제품 LOT ↔ 출하를 앞뒤로 모두 찾는다(봉투 묶음 단위).
async function lotTrace(lot) {
  const mats = new Map(), bags = new Map(), fins = new Map();
  const addBag = async b => { if (!b || bags.has(b)) return false; const c = await semiBagRecord(b); if (!c) return false;
    const inputs = await db.prepare('SELECT item, unit, lot, qty, pieces, piece_nos FROM semi_lot_inputs WHERE record_id=? ORDER BY id').all(c.id);
    const washes = await db.prepare("SELECT work_date, unit_name, qty + COALESCE(defect_qty,0) AS qty, unit, CASE WHEN work_status='progress' THEN 1 ELSE 0 END AS wip FROM semi_records WHERE process='wash' AND lot=? ORDER BY work_date, id").all(b);
    bags.set(b, { lot: b, item: c.item_name, product_code: c.product_code, work_date: c.work_date, unit_name: c.unit_name, qty: c.qty, unit: c.unit, inputs, washes, finished: [], ...(c.work_status === 'progress' ? { wip: true } : {}) }); return true; };
  const addFin = async a => { if (!a || fins.has(a.lot)) return false;
    const s = await db.prepare('SELECT product, unit, bom_snapshot FROM schedules WHERE id=?').get(a.schedule_id) || {};
    const ships = await db.prepare("SELECT ship_date, customer, qty, unit FROM shipments WHERE lot=? ORDER BY ship_date, id").all(a.lot);
    const direct = await db.prepare('SELECT item, unit, lot, qty FROM production_lot_inputs WHERE actual_id=? ORDER BY id').all(a.id);
    const vocs = await db.prepare("SELECT req_no, customer, status, created_at FROM requests WHERE type='voc' AND (lot=? OR json_extract(data,'$.lot')=?) ORDER BY id DESC LIMIT 20").all(a.lot, a.lot); // 15.254
    const per = (() => { try { const sn = JSON.parse(s.bom_snapshot || '{}'), b = Number(sn.base_qty) || 1; return (sn.materials || []).filter(m => m.item_category === '반제품').reduce((t, m) => t + Number(m.qty) / b, 0) || null; } catch { return null; } })(); // 15.254 완제품 1개당 반제품 수량(예상 생산량 계산)
    fins.set(a.lot, { vocs, per, lot: a.lot, item: s.product || '', product_code: (() => { try { return JSON.parse(s.bom_snapshot || '{}').product_code || ''; } catch { return ''; } })(), date: a.production_date, qty: a.qty, unit: s.unit || '', ...(a.work_status === 'progress' ? { wip: true } : {}), work_order: a.work_order || '', bags: [], direct, shipments: ships }); return true; };
  const actualsOfBag = b => db.prepare('SELECT a.* FROM pack_bag_links p JOIN production_actuals a ON a.id=p.actual_id WHERE p.bag_lot=? AND a.voided_at IS NULL ORDER BY a.production_date, a.id').all(b);
  const bagsOfActual = id => db.prepare('SELECT bag_lot FROM pack_bag_links WHERE actual_id=? ORDER BY id').all(id);
  let kind = '';
  const fin = await db.prepare('SELECT * FROM production_actuals WHERE lot=? AND voided_at IS NULL ORDER BY id').all(lot);
  if (fin.length) { kind = 'finished'; for (const a of fin) { await addFin(a); for (const b of await bagsOfActual(a.id)) await addBag(b.bag_lot); } }
  else if (await semiBagRecord(lot)) { kind = 'bag'; await addBag(lot); for (const a of await actualsOfBag(lot)) await addFin(a); }
  else if (/-\d+$/.test(lot) && await db.prepare('SELECT 1 FROM semi_lot_inputs WHERE lot=? LIMIT 1').get(lot.replace(/-\d+$/, ''))) {
    // 15.251 절 코드(LOT-3): 그 절을 넣은 봉투만
    const base = lot.replace(/-\d+$/, ''), no = String(Number(lot.match(/-(\d+)$/)[1]));
    const uses = await db.prepare("SELECT DISTINCT r.lot FROM semi_lot_inputs i JOIN semi_records r ON r.id=i.record_id WHERE i.lot=? AND (',' || i.piece_nos || ',') LIKE ? AND r.lot<>''").all(base, `%,${no},%`);
    kind = 'piece'; for (const u of uses) { await addBag(u.lot); for (const a of await actualsOfBag(u.lot)) await addFin(a); }
  }
  else {
    const uses = await db.prepare('SELECT DISTINCT r.lot FROM semi_lot_inputs i JOIN semi_records r ON r.id=i.record_id WHERE i.lot=? AND r.lot<>\'\'').all(lot);
    const direct = await db.prepare('SELECT a.* FROM production_lot_inputs i JOIN production_actuals a ON a.id=i.actual_id WHERE i.lot=? AND a.voided_at IS NULL').all(lot);
    const rec = await lotReceiptInfo(lot);
    if (uses.length || direct.length || rec.length) { kind = 'material'; for (const u of uses) { await addBag(u.lot); for (const a of await actualsOfBag(u.lot)) await addFin(a); } for (const a of direct) await addFin(a); }
  }
  if (!kind) return { lot, kind: '', materials: [], bags: [], finished: [] };
  // 완제품 ↔ 봉투 연결(같은 묶음에서 이어진 다른 완제품까지는 넓히지 않음: 고른 LOT 기준 앞뒤만)
  for (const f of fins.values()) f.bags = [...new Set((await db.prepare('SELECT p.bag_lot FROM pack_bag_links p JOIN production_actuals a ON a.id=p.actual_id WHERE a.lot=? AND a.voided_at IS NULL ORDER BY p.id').all(f.lot)).map(x => x.bag_lot))];
  for (const b of bags.values()) b.finished = (await actualsOfBag(b.lot)).map(a => a.lot);
  for (const b of bags.values()) for (const i of b.inputs) { const k = i.item + '\u0000' + i.lot; if (!mats.has(k)) mats.set(k, { item: i.item, lot: i.lot, unit: i.unit, receipts: await lotReceiptInfo(i.lot), bags: [], qc_fail: !!(await lotQcFail(i.item, i.lot)), ...(await lotConcession(i.item, i.lot) ? { concession: true } : {}) }); /* 15.256 특채 */ mats.get(k).bags.push(b.lot); }
  for (const f of fins.values()) for (const i of f.direct) { const k = i.item + '\u0000' + i.lot; if (!mats.has(k)) mats.set(k, { item: i.item, lot: i.lot, unit: i.unit, receipts: await lotReceiptInfo(i.lot), bags: [], finished: [] }); (mats.get(k).finished ||= []).push(f.lot); }
  if (kind === 'material' && ![...mats.values()].some(m => m.lot === lot)) { const r = await lotReceiptInfo(lot); mats.set('root', { item: r[0]?.item || '', lot, unit: r[0]?.unit || '', receipts: r, bags: [] }); }
  return { lot, kind, materials: [...mats.values()], bags: [...bags.values()], finished: [...fins.values()] };
}
async function lotReceiptInfo(lot) {
  return db.prepare(`SELECT 'po' AS src, TRIM(p.item) AS item, TRIM(p.unit) AS unit, l.qty, l.pieces, l.received_date AS date, p.vendor, l.vendor_lot FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.lot=? AND l.voided_at IS NULL
    UNION ALL SELECT 'other', TRIM(item), TRIM(unit), qty, pieces, received_date, vendor, vendor_lot FROM other_receipts WHERE lot=? ORDER BY 6 LIMIT 20`).all(lot, lot);
}
// 15.254 임시 SST LOT에 나중에 알게 된 업체 LOT(별칭). LOT 이름은 그대로라 투입·출하 기록이 흔들리지 않는다.
async function vendorLots(item) {
  const rows = await db.prepare(`SELECT l.lot, MAX(l.vendor_lot) AS v FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE TRIM(p.item)=? AND l.vendor_lot<>'' GROUP BY l.lot
    UNION ALL SELECT lot, MAX(vendor_lot) FROM other_receipts WHERE TRIM(item)=? AND vendor_lot<>'' GROUP BY lot`).all(item, item);
  return new Map(rows.map(r => [r.lot, r.v]));
}
route('POST', '/api/lots/vendor-lot', async ({ user, body }) => {
  if (!canReceive(user) && !hasRole(user, 'quality')) throw new HttpError(403, '업체 LOT 연결은 물류·구매·품질 담당자가 합니다.');
  const item = reqStr(body.item, '품목', 200), lot = reqStr(body.lot, 'LOT', 100), vendor = str(body.vendor_lot, 100);
  if (!/^SST-/.test(lot)) throw bad('임시 SST LOT에만 업체 LOT을 연결합니다. 업체 LOT은 입고 때 적으세요.');
  if (vendor && /^SST-/i.test(vendor)) throw bad('업체가 준 LOT 번호를 적으세요.');
  const a = await db.prepare("UPDATE po_receipt_lots SET vendor_lot=? WHERE lot=? AND po_id IN (SELECT id FROM purchase_orders WHERE TRIM(item)=TRIM(?))").run(vendor, lot, item);
  const b = await db.prepare('UPDATE other_receipts SET vendor_lot=? WHERE lot=? AND TRIM(item)=TRIM(?)').run(vendor, lot, item);
  if (!a.changes && !b.changes) throw new HttpError(404, `${item}의 LOT ${lot} 입고 기록을 찾지 못했습니다.`);
  return { item, lot, vendor_lot: vendor };
});
route('GET', '/api/lot-trace', async ({ query }) => {
  const lot = reqStr(query.lot, 'LOT', 100); let r = await lotTrace(lot);
  // 15.254 업체 LOT(별칭)으로 찾으면 그 임시 SST LOT으로
  if (!r.kind) { const hit = await db.prepare("SELECT lot FROM other_receipts WHERE vendor_lot=? UNION SELECT lot FROM po_receipt_lots WHERE vendor_lot=? LIMIT 1").get(lot, lot); if (hit) r = { ...await lotTrace(hit.lot), alias_of: lot }; }
  return r;
});
// 최근 LOT(완제품·봉투) — 조회 화면 첫 목록
route('GET', '/api/lot-trace/recent', async ({ query }) => {
  const q = str(query.q, 100), like = q ? '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%' : null;
  const fin = await db.prepare(`SELECT a.lot, a.production_date AS date, a.qty, s.product AS item, s.unit, (SELECT COUNT(*) FROM pack_bag_links p WHERE p.actual_id=a.id) AS bags FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE a.lot<>'' AND a.voided_at IS NULL${like ? " AND (a.lot LIKE ? ESCAPE '\\' OR s.product LIKE ? ESCAPE '\\')" : ''} ORDER BY a.production_date DESC, a.id DESC LIMIT 60`).all(...(like ? [like, like] : []));
  const bag = await db.prepare(`SELECT c.lot, c.work_date AS date, c.qty, c.item_name AS item, c.unit, (SELECT COUNT(*) FROM semi_lot_inputs i WHERE i.record_id=c.id) AS inputs, EXISTS(SELECT 1 FROM semi_records w WHERE w.process='wash' AND w.lot=c.lot) AS washed FROM semi_records c WHERE c.process='cut' AND c.lot<>''${like ? " AND (c.lot LIKE ? ESCAPE '\\' OR c.item_name LIKE ? ESCAPE '\\')" : ''} ORDER BY c.work_date DESC, c.id DESC LIMIT 60`).all(...(like ? [like, like] : []));
  return { finished: fin, bags: bag };
});
route('GET', '/api/semi-records', listSemiRecords);
route('GET', '/api/operator/semi-records', context => listSemiRecords({ ...context, operator: true }));
route('POST', '/api/semi-records', async ({ user, body }) => {
  const process = semiProcess(body.process);
  const key = body.request_id === undefined ? randomHex(16) : String(body.request_id);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('요청 번호를 확인하세요.');
  const old = await db.prepare('SELECT * FROM semi_records WHERE request_id=?').get(key);
  if (old) { if (old.created_by_id !== user.id || old.process !== process) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return old; } // 15.253 재요청은 투입 확인 전에 돌려줌
  const linked = await semiLotLink(process, await semiFields(body, process), body); const f = linked.f;
  await db.batch([{ sql: 'INSERT INTO semi_records(work_status,process,work_date,unit_id,unit_name,product_group,product_type,bom_id,item_name,product_code,bom_snapshot,spec,start_time,end_time,break_minutes,work_hours,workers,defect_qty,defect_reason,qty,unit,lot,note,request_id,created_by_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [semiProgress(body) ? 'progress' : 'done', process, f.work_date, f.unit_id, f.unit_name, f.product_group, f.product_type, f.bom_id, f.item_name, f.product_code, f.bom_snapshot, f.spec, f.start_time, f.end_time, f.break_minutes, f.work_hours, f.workers, f.defect_qty, f.defect_reason, f.qty, f.unit, f.lot, f.note, key, user.id, user.name] },
    ...linked.inputs.map(i => ({ sql: 'INSERT INTO semi_lot_inputs(record_id,item,unit,lot,qty,created_by,pieces,piece_nos) VALUES((SELECT id FROM semi_records WHERE request_id=?),?,?,?,?,?,?,?)', args: [key, i.item, i.unit, i.lot, i.qty, user.name, i.pieces ?? null, i.piece_nos || ''] })),
    ...(process === 'cut' && f.lot ? bagGuard([f.lot]) : [])]).catch(error => { throw lotDupError(error); }); // 15.253 기록·투입을 함께 · 15.254 번호 겹침
  const r = { lastInsertRowid: (await db.prepare('SELECT id FROM semi_records WHERE request_id=?').get(key)).id };
  return mustGet('semi_records', r.lastInsertRowid);
});
// 15.249 LOT 연결: 품목 코드(LOT에 들어감)는 영문·숫자·-만, 대문자.
const lotCode = (code, name) => (String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '') || String(name || '').toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'ITEM').slice(0, 20);
// 봉투(반제품) LOT: 생산일_품목코드_봉투번호(261119_NX808_1). 같은 날·같은 품목마다 1부터.
async function nextBagLots(date, code, count) {
  const head = `${String(date).slice(2).replace(/-/g, '')}_${code}_`;
  const used = await db.prepare("SELECT MAX(CAST(substr(lot, length(?) + 1) AS INTEGER)) AS n FROM semi_records WHERE process='cut' AND substr(lot,1,length(?))=? AND length(lot)>length(?) AND substr(lot,length(?)+1) NOT GLOB '*[^0-9]*'").get(head, head, head, head, head);
  const start = (used && used.n) || 0;
  return Array.from({ length: count }, (_, i) => head + (start + i + 1));
}
// 커팅·융착 투입 원자재 LOT: 그 반제품 BOM에 등록된 자재만, 그 자재의 재고 LOT 남은 수량 안에서(같은 LOT 여러 줄은 합쳐서).
async function semiLotInputs(raw, snapshotText, used = new Map(), made = null) {
  let list = raw; if (typeof list === 'string') { try { list = list.trim() ? JSON.parse(list) : []; } catch { throw bad('투입 원자재 LOT 형식을 확인하세요.'); } }
  if (list == null) list = []; if (!Array.isArray(list)) throw bad('투입 원자재 LOT 형식을 확인하세요.');
  if (list.length > 30) throw bad('투입 원자재 LOT은 30줄까지 넣을 수 있습니다.');
  let mats = [], base = 1; try { const snap = JSON.parse(snapshotText || '{}'); mats = snap.materials || []; base = Number(snap.base_qty) || 1; } catch { mats = []; }
  // 15.250 절(pieces)로 넣은 줄은 사용량(qty)을 BOM으로 계산: 그 자재 필요량을 절 비율로 LOT마다 나눈다
  list = list.map(l => { if (!l || typeof l !== 'object' || l.piece_nos === undefined || l.piece_nos === '' || l.piece_nos === null) return l; const nos = (Array.isArray(l.piece_nos) ? l.piece_nos : String(l.piece_nos).split(',')).map(x => Number(String(x).trim())).filter(x => x !== 0 || true);
    if (nos.some(n => !Number.isInteger(n) || n < 1)) throw bad(`${str(l.item, 200)} ${str(l.lot, 100)}: 절 번호를 확인하세요.`); const uniq = [...new Set(nos)].sort((a, b) => a - b); return { ...l, piece_nos: uniq, pieces: uniq.length }; });
  if (made !== null && list.some(l => l && typeof l === 'object' && l.pieces !== undefined && l.pieces !== '' && l.pieces !== null && (l.qty === undefined || l.qty === '' || l.qty === null))) {
    const byItem = new Map();
    for (const l of list) { if (!l || typeof l !== 'object') continue; const k = nameKey(str(l.item, 200)); if (!byItem.has(k)) byItem.set(k, []); byItem.get(k).push(l); }
    list = list.map(l => ({ ...(l || {}) }));
    for (const [k, ls] of byItem) {
      const mat = mats.find(m => nameKey(m.item) === k); if (!mat) continue;
      const need = stockRound(made * Number(mat.qty) / base), cells = list.filter(l => nameKey(str(l.item, 200)) === k);
      const pcs = cells.map(l => Math.max(0, Number(l.pieces) || 0)), total = pcs.reduce((a, b) => a + b, 0);
      let left = need;
      cells.forEach((l, i) => { const share = i === cells.length - 1 ? left : stockRound(total ? need * pcs[i] / total : need / cells.length); left = stockRound(left - share); l.qty = share; l.pieces = piecesOf(l.pieces); });
      void ls;
    }
    if (!(made > 0)) throw bad('양품·불량 수량을 넣어야 BOM으로 원자재 사용량을 계산할 수 있습니다.');
  }
  const out = [];
  for (const [n, r] of list.entries()) {
    const l = r && typeof r === 'object' ? r : {}, item = str(l.item, 200), lot = str(l.lot, 100);
    if (!item || !lot) throw bad(`투입 ${n + 1}번째 줄: 원자재와 LOT을 고르세요.`);
    const qty = num(l.qty, `투입 ${n + 1}번째 줄 수량`); if (!(qty > 0)) throw bad(`투입 ${n + 1}번째 줄(${item} ${lot}): 수량은 0보다 커야 합니다.`);
    const mat = mats.find(m => nameKey(m.item) === nameKey(item));
    if (!mat) throw bad(`${item}은(는) 이 반제품 BOM에 없는 자재입니다. 제품등록에서 BOM에 먼저 넣으세요.`);
    const key = nameKey(item) + '\u0000' + lot, total = stockRound((used.get(key) || 0) + qty);
    const bal = (await lotBalances(mat.item)).find(x => x.lot === lot);
    if (!bal) throw bad(`${item}: LOT ${lot}은 이 자재의 재고 LOT이 아닙니다.`);
    { const q = await lotQcFail(mat.item, lot); if (q) throw bad(qcFailMessage(mat.item, lot, q)); } // 15.254
    if (total > bal.balance + 0.000001) throw bad(`${item}: LOT ${lot} 남은 수량 ${stockRound(bal.balance)}보다 많이 투입할 수 없습니다.`);
    used.set(key, total);
    const pieces = piecesOf(l.pieces), nos = Array.isArray(l.piece_nos) ? l.piece_nos : [];
    if (nos.length) {
      if (bal.pieces_free === undefined) throw bad(`${item}: LOT ${lot}은 입고 때 실물(절)을 적지 않아 절 번호로 고를 수 없습니다.`);
      const free = new Set(bal.pieces_free), nk = key + '\u0002', taken = used.get(nk) || new Set();
      const tmp = new Set(bal.pieces_temp || []), bad1 = nos.find(n => !free.has(n) || (taken.has(n) && !tmp.has(n))); if (bad1) throw bad(`${item}: ${lot}-${bad1}은 없는 절이거나 이미 투입한 절입니다.`);
      nos.forEach(n => taken.add(n)); used.set(nk, taken);
    }
    if (pieces !== null && bal.pieces_left !== undefined && !nos.length) { const pk = key + '\u0001', pt = stockRound((used.get(pk) || 0) + pieces); if (pt > bal.pieces_left + 0.000001) throw bad(`${item}: LOT ${lot} 남은 실물 ${stockRound(bal.pieces_left)}절보다 많이 투입할 수 없습니다.`); used.set(pk, pt); }
    out.push({ item: bal.item, unit: bal.unit || mat.unit || '', lot, qty, pieces, piece_nos: nos.join(',') });
  }
  return out;
}
// 세탁: 봉투 LOT(커팅·융착 기록의 LOT)을 고른다.
async function semiBagRecord(lot) { return db.prepare("SELECT * FROM semi_records WHERE process='cut' AND lot=? ORDER BY id LIMIT 1").get(lot); }
// 15.249 커팅·융착: 봉투 LOT 자동(직접 적으면 그것) + 투입 원자재 LOT. 세탁: 봉투 LOT이면 그 봉투가 있어야 한다.
async function semiLotLink(process, f, row, usedInputs = new Map(), bagNext = new Map()) {
  if (process === 'cut') {
    if (f.lot && await semiBagRecord(f.lot)) throw bad(`봉투 LOT ${f.lot}은 이미 있습니다. 비워 두면 자동으로 붙습니다.`); // 15.253
    const progress = semiWip(row);
    let raw = row.inputs; if (progress) { try { raw = (typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : []) : raw || []).map(l => ({ ...l, qty: l.qty === undefined || l.qty === '' || l.qty === null ? 0.000001 : l.qty })); } catch { throw bad('투입 원자재 LOT 형식을 확인하세요.'); } } // 15.255 작업중: 사용량은 완료 때
    const inputs = await semiLotInputs(raw, f.bom_snapshot, usedInputs, progress ? null : stockRound((Number(f.qty) || 0) + (Number(f.defect_qty) || 0)));
    if (!f.lot) {
      const code = lotCode(f.product_code, f.item_name), key = f.work_date + '|' + code;
      if (!bagNext.has(key)) bagNext.set(key, (await nextBagLots(f.work_date, code, 1))[0].replace(/\d+$/, n => String(Number(n) - 1)));
      const prev = bagNext.get(key), next = prev.replace(/\d+$/, n => String(Number(n) + 1)); bagNext.set(key, next); f = { ...f, lot: next };
    }
    return { f, inputs };
  }
  if (f.lot && !(await semiBagRecord(f.lot)) && row.bag_required) throw bad(`봉투 LOT ${f.lot}을 찾을 수 없습니다. 「봉투 LOT 고르기」로 고르세요.`);
  if (f.lot && row.bag_required && (await semiBagRecord(f.lot))?.work_status === 'progress') throw bad(`봉투 LOT ${f.lot}은 아직 커팅 작업중입니다. 커팅을 작업완료한 뒤 세탁하세요.`); // 15.255
  return { f, inputs: [] };
}
// 15.253 세탁·포장에 쓰인 봉투(커팅 기록)는 지우거나 품목·LOT을 바꿀 수 없다(연결이 끊김)
async function semiBagGuard(row, what = '지울') {
  if (row.process !== 'cut' || !row.lot) return;
  if (await db.prepare("SELECT 1 WHERE EXISTS(SELECT 1 FROM semi_records WHERE process='wash' AND lot=?) OR EXISTS(SELECT 1 FROM pack_bag_links WHERE bag_lot=?)").get(row.lot, row.lot)) throw new HttpError(409, `봉투 LOT ${row.lot}은 이미 세탁·포장에 쓰여 ${what} 수 없습니다. 세탁·포장 기록을 먼저 정리하세요.`);
}
// 커팅 기록의 양품·불량이 바뀌면 투입 원자재 사용량(BOM × (양품+불량), 같은 자재 여러 LOT은 절 비율)을 다시 계산
// 15.258 투입 사용량 계획(쓰지 않고 계산만): [{ id, qty }]. 절이 없는 줄·BOM에 없는 자재는 건너뜀.
function semiInputsShares(r, inputs) {
  let mats = [], base = 1; try { const snap = JSON.parse(r.bom_snapshot || '{}'); mats = snap.materials || []; base = Number(snap.base_qty) || 1; } catch { return []; }
  const made = stockRound((Number(r.qty) || 0) + (Number(r.defect_qty) || 0)), out = [];
  const byItem = new Map(); for (const i of inputs) { const k = nameKey(i.item); if (!byItem.has(k)) byItem.set(k, []); byItem.get(k).push(i); }
  for (const [k, list] of byItem) {
    const mat = mats.find(m => nameKey(m.item) === k); if (!mat || list.some(i => i.pieces == null)) continue;
    const need = stockRound(made * Number(mat.qty) / base), total = list.reduce((t, i) => t + (Number(i.pieces) || 0), 0); let left = need;
    list.forEach((i, n) => { const share = n === list.length - 1 ? left : stockRound(total ? need * i.pieces / total : need / list.length); left = stockRound(left - share); out.push({ id: i.id, qty: share > 0 ? share : 0.000001 }); });
  }
  return out;
}
async function semiInputsRecalc(recordId) {
  const r = await db.prepare('SELECT * FROM semi_records WHERE id=?').get(recordId); if (!r) return;
  const inputs = await db.prepare('SELECT * FROM semi_lot_inputs WHERE record_id=? ORDER BY id').all(recordId); if (!inputs.length) return;
  let mats = [], base = 1; try { const snap = JSON.parse(r.bom_snapshot || '{}'); mats = snap.materials || []; base = Number(snap.base_qty) || 1; } catch { return; }
  const made = stockRound((Number(r.qty) || 0) + (Number(r.defect_qty) || 0)), cmds = [];
  const byItem = new Map(); for (const i of inputs) { const k = nameKey(i.item); if (!byItem.has(k)) byItem.set(k, []); byItem.get(k).push(i); }
  for (const [k, list] of byItem) {
    const mat = mats.find(m => nameKey(m.item) === k); if (!mat || list.some(i => i.pieces == null)) continue;
    const need = stockRound(made * Number(mat.qty) / base), total = list.reduce((t, i) => t + (Number(i.pieces) || 0), 0); let left = need;
    list.forEach((i, n) => { const share = n === list.length - 1 ? left : stockRound(total ? need * i.pieces / total : need / list.length); left = stockRound(left - share); cmds.push({ sql: 'UPDATE semi_lot_inputs SET qty=? WHERE id=?', args: [share > 0 ? share : 0.000001, i.id] }); });
  }
  if (cmds.length) await db.batch(cmds);
}
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
  const commands = [], washNow = now().slice(11, 16), usedInputs = new Map(), bagNext = new Map(), autoBags = new Set();
  for (const [index, item] of body.items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad(`${index + 1}번째 줄을 확인하세요.`);
    const row = { ...(body.common || {}), ...item };
    if (process === 'wash' && row.entry_mode === 'wash_quantity' && !str(row.start_time, 5)) row.start_time = washNow;
    let f, inputs = []; try { f = await semiFields(row, process); ({ f, inputs } = await semiLotLink(process, f, row, usedInputs, bagNext)); if (process === 'cut' && f.lot) autoBags.add(f.lot); }
    catch (error) { if (error.status === 400 || error.status === 404) throw bad(`${index + 1}번째 줄: ${error.message}`); throw error; }
    commands.push({ sql: 'INSERT INTO semi_records(work_status,process,work_date,unit_id,unit_name,product_group,product_type,bom_id,item_name,product_code,bom_snapshot,spec,start_time,end_time,break_minutes,work_hours,workers,defect_qty,defect_reason,qty,unit,lot,note,request_id,created_by_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      args: [semiProgress(row) ? 'progress' : 'done', process, f.work_date, f.unit_id, f.unit_name, f.product_group, f.product_type, f.bom_id, f.item_name, f.product_code, f.bom_snapshot, f.spec, f.start_time, f.end_time, f.break_minutes, f.work_hours, f.workers, f.defect_qty, f.defect_reason, f.qty, f.unit, f.lot, f.note, `${key}:${index}`, user.id, user.name] });
    commands.push(...inputs.map(i => ({ sql: 'INSERT INTO semi_lot_inputs(record_id,item,unit,lot,qty,created_by,pieces,piece_nos) VALUES((SELECT id FROM semi_records WHERE request_id=?),?,?,?,?,?,?,?)', args: [`${key}:${index}`, i.item, i.unit, i.lot, i.qty, user.name, i.pieces ?? null, i.piece_nos || ''] })));
  }
  if (process === 'cut') commands.push(...bagGuard([...autoBags])); // 15.254
  try { await db.batch(commands); }
  catch (error) { const rows = await saved(); if (rows.length) return replay(rows); throw lotDupError(error); }
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
  if (row.work_status === 'progress') throw new HttpError(409, '작업중 기록입니다. 위 「작업중」 표에서 수량을 넣고 「완료」하세요(수정은 작업완료 뒤, 지우려면 「삭제 요청」).'); // 15.258
  const f = await semiFields(body, row.process, row);
  if (SEMI_APPROVAL_FIELDS.every(key => f[key] === row[key])) {
    if (SEMI_DIRECT_FIELDS.every(key => f[key] === row[key])) throw bad('바뀐 내용이 없습니다.');
    if (await semiPending(row.id)) throw new HttpError(409, '승인 대기 중인 요청이 처리된 뒤에 수정하세요.');
    if (row.process === 'cut' && f.lot !== row.lot) await semiBagGuard(row, '봉투 LOT을 바꿀');
    await db.prepare('UPDATE semi_records SET defect_qty=?,defect_reason=?,start_time=?,end_time=?,break_minutes=?,work_hours=?,workers=?,lot=?,note=?,updated_by=?,updated_at=? WHERE id=?').run(f.defect_qty, f.defect_reason, f.start_time, f.end_time, f.break_minutes, f.work_hours, f.workers, f.lot, f.note, user.name, now(), row.id);
    if (row.process === 'cut' && f.defect_qty !== row.defect_qty) await semiInputsRecalc(row.id); // 15.253
    return { pending: false, record: await mustGet('semi_records', row.id) };
  }
  return requestSemiChange(user, row, 'edit', f, body);
});
// 15.255 작업완료: 작업중 기록에 수량(커팅: 양품·불량·종료시각 / 세탁: 세탁수량)을 넣는다. 커팅은 원자재 사용량을 BOM으로 다시 계산.
route('POST', '/api/operator/semi-records/:id/complete', context => semiComplete(context));
route('POST', '/api/semi-records/:id/complete', context => semiComplete(context));
const fmtQty = n => String(n);
async function semiComplete({ user, params, body }) {
  const row = await mustGet('semi_records', params.id);
  if (!canModify(user, row) && !canManageProduction(user)) throw new HttpError(403, '등록자 또는 생산 담당자만 작업완료할 수 있습니다.');
  const strip = x => isOperator(user) ? (({ bom_snapshot, request_id, ...y }) => y)(x) : x;
  if (row.work_status !== 'progress') { if (body.qty !== undefined && Number(body.qty) === Number(row.qty) && (row.process !== 'cut' || Number(body.defect_qty || 0) === Number(row.defect_qty || 0))) return strip(row); throw new HttpError(409, '이미 작업완료한 기록입니다. 고치려면 「수정」을 쓰세요.'); } // 15.258 재요청은 저장된 기록
  let qty = num(body.qty, row.process === 'wash' ? '세탁수량' : '양품수량'), defect = row.process === 'cut' ? num(body.defect_qty, '불량수량', { required: false }) ?? 0 : 0;
  if (!(qty + defect > 0)) throw bad('수량을 넣으세요.');
  const reason = defect ? str(body.defect_reason, 40) : ''; if (reason && !SEMI_DEFECT_REASONS[row.process].includes(reason)) throw bad('불량 사유를 다시 선택하세요.');
  const d = semiWorkDetails({ start_time: body.start_time === undefined ? row.start_time : body.start_time, end_time: body.end_time === undefined ? row.end_time : body.end_time, break_minutes: body.break_minutes, workers: body.workers, defect_qty: defect, defect_reason: reason }, row, row.process);
  const inputCmds = [];
  if (row.process === 'cut') { // 사용량을 먼저 계산하고 LOT 잔량을 확인한 뒤 한 번에 저장
    const inputs = await db.prepare('SELECT * FROM semi_lot_inputs WHERE record_id=? ORDER BY id').all(row.id);
    const shares = new Map(semiInputsShares({ ...row, qty, defect_qty: defect }, inputs).map(x => [x.id, x.qty]));
    const stuck = inputs.find(i => !shares.has(i.id) && Number(i.qty) < 0.00001);
    if (stuck) throw bad(`${stuck.item} ${stuck.lot}: 투입 사용량을 BOM으로 계산할 수 없습니다(절 없이 넣었거나 BOM에 없는 자재). 이 기록은 「삭제 요청」 후 다시 입력하세요.`);
    const groups = new Map(); for (const i of inputs) { const k = i.item + '\u0000' + i.lot, g = groups.get(k) || { item: i.item, lot: i.lot, was: 0, now: 0 }; g.was += Number(i.qty) || 0; g.now += shares.has(i.id) ? shares.get(i.id) : Number(i.qty) || 0; groups.set(k, g); }
    for (const g of groups.values()) {
      const bal = (await lotStockReport({ q: g.lot })).rows.find(x => x.item === String(g.item).trim() && x.lot === g.lot);
      if (bal && stockRound(bal.balance + g.was - g.now) < -0.000001) throw bad(`${g.item}: LOT ${g.lot} 남은 수량 ${fmtQty(stockRound(bal.balance + g.was))}보다 BOM 사용량 ${fmtQty(stockRound(g.now))}이 많습니다. 수량이나 투입 절을 확인하세요.`);
    }
    for (const [id, q] of shares) inputCmds.push({ sql: 'UPDATE semi_lot_inputs SET qty=? WHERE id=?', args: [q, id] });
  }
  try {
    await db.batch([{ sql: "UPDATE semi_records SET qty=?,defect_qty=?,defect_reason=?,start_time=?,end_time=?,break_minutes=?,work_hours=?,workers=?,work_status='done',updated_by=?,updated_at=? WHERE id=? AND work_status='progress'",
      args: [qty, defect, reason, d.start_time, d.end_time, d.break_minutes, d.work_hours, d.workers, user.name, now(), row.id] }, RC_GUARD, ...inputCmds]);
  } catch (error) { if (isGuardError(error)) throw new HttpError(409, '이미 작업완료한 기록입니다.'); throw error; }
  return strip(await mustGet('semi_records', row.id));
}
route('DELETE', '/api/semi-records/:id', async ({ user, params, body }) => {
  const row = await mustGet('semi_records', params.id);
  if (!canModify(user, row) && !canManageProduction(user)) throw new HttpError(403, '등록자 또는 생산 담당자만 삭제를 요청할 수 있습니다.');
  await semiBagGuard(row);
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
  const applied = "EXISTS(SELECT 1 FROM semi_record_changes WHERE id=? AND status='pending')";
  const next = change.new_data ? JSON.parse(change.new_data) : null;
  if (next && next.work_date > today()) throw bad('아직 지나지 않은 날짜로는 승인할 수 없습니다.');
  if (change.action !== 'edit' || (next && (next.bom_id !== row.bom_id))) await semiBagGuard(row); // 15.253
  const results = await db.batch([
    change.action === 'edit'
      ? { sql: `UPDATE semi_records SET ${SEMI_FIELDS.filter(k => k in next).map(k => k + '=?').join(',')},updated_by=?,updated_at=? WHERE id=? AND ${applied}`, args: [...SEMI_FIELDS.filter(k => k in next).map(k => next[k]), `${change.requested_by} (승인: ${user.name})`, stamp, row.id, change.id] }
      : { sql: `DELETE FROM semi_records WHERE id=? AND ${applied}`, args: [row.id, change.id] },
    { sql: "UPDATE semi_record_changes SET status='approved',reviewed_by=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'", args: [user.name, stamp, str(body.note, 500), change.id] },
  ]);
  if (!results.at(-1).meta.changes) throw new HttpError(409, '이미 처리된 요청입니다.');
  if (change.action === 'edit' && row.process === 'cut') await semiInputsRecalc(row.id); // 15.253 수량 바뀌면 원자재 사용량 다시 계산
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
    FROM semi_records r LEFT JOIN production_units u ON u.id=r.unit_id WHERE r.process='cut' AND r.work_date>=date('now','+9 hours','-6 days') AND r.work_date<=date('now','+9 hours') GROUP BY r.process, r.unit_id`).all();
  return rows.map(r => { const total = r.qty + r.defect_qty; return { process: r.process, unit_name: r.unit_name, target: r.yield_target ?? fallback, yield_rate: total ? Math.round(r.qty / total * 1000) / 10 : null, qty: r.qty, defect_qty: r.defect_qty }; })
    .filter(r => r.yield_rate !== null && r.yield_rate < r.target).sort((a, b) => (a.yield_rate - a.target) - (b.yield_rate - b.target));
}
// 세탁 대기: 커팅/융착 양품 누계 − 세탁 처리(양품 + 불량) 누계, 품목·규격·단위별.
route('GET', '/api/semi-wip', async () => {
  const label = "COALESCE(NULLIF(item_name,''), CASE WHEN product_type='' THEN CASE product_group WHEN 'seamless' THEN '심리스글러브 (종류 미지정)' ELSE '와이퍼 (종류 미지정)' END WHEN product_group='seamless' THEN '심리스 ' || product_type ELSE product_type END)";
  const rows = await db.prepare(`SELECT ${label} AS item, spec, unit, SUM(CASE WHEN process='cut' THEN qty ELSE 0 END) AS cut_qty,
      SUM(CASE WHEN process='wash' THEN qty + defect_qty ELSE 0 END) AS washed_qty, MAX(work_date) AS last_date
    FROM semi_records c WHERE NOT ${WASH_FREE_SQL('c')} GROUP BY 1,2,3 ORDER BY 1,2,3 LIMIT 2000`).all(); // 15.279 부직포는 세탁 없음
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
  // 15.309 품질·공무 기한 알림(지남 또는 30일 안). 품질은 품질 기한 전부, 생산은 예방보전(PM).
  const qAlerts = [], in30 = addDaysISO(t, 30);
  const qa = async (label, href, sql, ...args) => { const r = await db.prepare(sql).get(...args); if (r?.c) qAlerts.push({ label, href, count: r.c, first: r.d || null }); };
  if (hasRole(user, 'quality')) {
    await qa('CAPA 조치 기한 지남', '#/quality/capa', "SELECT COUNT(*) c, MIN(due_date) d FROM nonconformities WHERE status NOT IN ('closed','void') AND due_date IS NOT NULL AND due_date<?", t);
    await qa('심사 예정일 지남(아직 실시 안 함)', '#/quality/audits', "SELECT COUNT(*) c, MIN(plan_date) d FROM quality_audits WHERE status='planned' AND plan_date<?", t);
    await qa('문서 주기 검토일 지남', '#/quality/docs', "SELECT COUNT(*) c, MIN(next_review) d FROM quality_docs WHERE status='approved' AND next_review IS NOT NULL AND next_review<?", t);
    await qa('자격 만료 30일 안·지남', '#/quality/training', "SELECT COUNT(*) c, MIN(expire_date) d FROM qualifications WHERE status='valid' AND expire_date IS NOT NULL AND expire_date<=?", in30);
    await qa('재밸리데이션 기한 30일 안·지남', '#/quality/validation', "SELECT COUNT(*) c, MIN(valid_until) d FROM validations WHERE status='pass' AND valid_until IS NOT NULL AND valid_until<=?", in30);
    await qa('계측기 교정 기한 30일 안·지남', '#/quality/calibration', "SELECT COUNT(*) c, MIN(next_due) d FROM instruments WHERE status='in_use' AND next_due IS NOT NULL AND next_due<=?", in30);
    await qa('인증 심사·만료 30일 안·지남', '#/quality/certs', "SELECT COUNT(*) c, MIN(MIN(COALESCE(next_audit,'9999'),COALESCE(expire_date,'9999'))) d FROM certifications WHERE status IN ('valid','suspended') AND (next_audit<=? OR expire_date<=?)", in30, in30);
    await qa('리스크 대응 기한 지남', '#/quality/risks', "SELECT COUNT(*) c, MIN(due_date) d FROM quality_risks WHERE status<>'closed' AND due_date IS NOT NULL AND due_date<?", t);
  }
  if (hasRole(user, 'production') || hasRole(user, 'quality')) await qa('예방보전(PM) 예정일 지남', '#/prod/pm', "SELECT COUNT(*) c, MIN(json_extract(j.value,'$.next_due')) d FROM equipment e, json_each(e.pm_items) j WHERE e.status<>'disposed' AND json_extract(j.value,'$.next_due')<?", t);
  if (hasRole(user, 'production') || hasRole(user, 'quality')) { // 15.313 위험성평가 개선 조치 기한·재평가 예정일
    await qa('위험성평가 개선 조치 기한 지남', '#/prod/risk/actions', "SELECT COUNT(*) c, MIN(json_extract(j.value,'$.due')) d FROM risk_assessments a, json_each(a.rows) j WHERE a.status<>'obsolete' AND COALESCE(json_extract(j.value,'$.action'),'')<>'' AND COALESCE(json_extract(j.value,'$.done'),'')='' AND json_extract(j.value,'$.due')<?", t);
    await qa('위험성평가 재평가 예정일 30일 안·지남', '#/prod/risk', "SELECT COUNT(*) c, MIN(next_review) d FROM risk_assessments WHERE status='approved' AND next_review IS NOT NULL AND next_review<=?", in30);
  }
  // 15.314 지정 담당자 법정교육 기한: 관리자는 전체, 그 밖에는 본인이 정·부로 지정된 업무
  if (user.is_admin) await qa('지정 담당자 법정교육 30일 안·지남', '#/admin/org/duties', "SELECT COUNT(*) c, MIN(next_training) d FROM org_duty_assignments WHERE active=1 AND next_training IS NOT NULL AND next_training<=?", in30);
  else await qa('내 지정 업무 법정교육 30일 안·지남', '#/admin/org/duties', "SELECT COUNT(*) c, MIN(next_training) d FROM org_duty_assignments WHERE active=1 AND next_training IS NOT NULL AND next_training<=? AND (user_id=? OR deputy_user_id=?)", in30, user.id, user.id);

  const result = { today: t, quality_alerts: qAlerts, overdue_pos: overduePos, overdue_po_count: overduePoCount, overdue_requests: overdueRequests, overdue_request_count: overdueRequestCount, stale_approvals: stale, low_yield: await lowYieldUnits() };
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
  purchase_order: { req_no: '구매의뢰번호', vendor: '거래처', item: '품목', qty: '수량', due_date: '납기일', item_category: '분류', coa_requested: 'COA 요청', note: '비고', spec: '규격', unit: '단위', lot: 'LOT', unit_price: '단가', internal_note: '내부 메모', freight: '운송비' },
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
      AND NOT EXISTS(SELECT 1 FROM po_receipt_lots l WHERE l.po_id=purchase_orders.id AND l.voided_at IS NULL)
  UNION ALL
  SELECT TRIM(p.item), p.spec, TRIM(p.unit), p.item_category, l.qty, 'po', l.received_date, p.id,
    p.req_no || ' · ' || p.vendor || CASE WHEN l.lot<>'' THEN ' · LOT ' || l.lot ELSE '' END
    FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.voided_at IS NULL AND p.recv_status IN ('ok','mismatch')
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
  SELECT TRIM(item), spec, TRIM(unit), '', qty, 'adjust', adj_date, id, reason || ' · ' || created_by FROM stock_adjustments
  UNION ALL
  SELECT TRIM(l.item), l.spec, TRIM(l.unit), l.item_category, CASE r.side WHEN 'in' THEN l.qty ELSE -l.qty END, CASE r.side WHEN 'in' THEN 'return_in' ELSE 'return_out' END, r.return_date, l.id, r.return_no || ' · ' || r.party
    FROM stock_return_lines l JOIN stock_returns r ON r.id=l.return_id WHERE r.status='confirmed' AND r.process IN ('stock_amount','stock')`;
const stockRound = n => Math.round((Number(n) || 0) * 1e6) / 1e6;
const canAdjustStock = user => !!user.is_admin || publicUser(user).roles.includes('logistics_approver');
function stockAsOf(value) { const d = listFilterDate(value, '기준일') || today(); if (d > today()) throw bad('기준일은 오늘 이전으로 선택하세요.'); return d; }
// Each bounded SELECT runs independently of the compound UNION planner. One D1 batch
// keeps the source reads in the same transaction for inventory and stock counts.
async function readStockSources(select, args) {
  return (await db.batch(STOCK_MOVEMENTS.split('UNION ALL').map(source => ({
    sql: `WITH movements(item,spec,unit,category,qty,src,d,ref,memo) AS (${source}) ${select}`, args,
  })))).map(result => result.results);
}
const stockCompare = (a,b) => a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1;
async function stockQuantity(item, unit, spec, asof) {
  const sources = await readStockSources(`SELECT COALESCE(SUM(qty),0) AS qty FROM movements WHERE item=? AND unit=? ${spec === null ? '' : 'AND spec=?'} AND d<=?`, spec === null ? [item,unit,asof] : [item,unit,spec,asof]);
  return stockRound(sources.reduce((total, rows) => total + rows[0].qty, 0));
}
route('GET', '/api/inventory', async ({ user, query }) => {
  const asof = stockAsOf(query.asof); const bySpec = query.group === 'spec';
  if (query.group && !['item', 'spec'].includes(query.group)) throw bad('보기 기준을 확인하세요.');
  const where = ['d<=?'], args = [asof];
  applyListKeyword(where, args, query.q, ['item', 'spec']);
  const sources = await readStockSources(`SELECT item, ${bySpec ? 'spec' : "''"} AS spec, unit, MAX(category) AS category,
      SUM(CASE WHEN src IN ('po','other') THEN qty ELSE 0 END) AS received, SUM(CASE WHEN src='prod' THEN qty ELSE 0 END) AS produced,
      SUM(CASE WHEN src='use' THEN -qty ELSE 0 END) AS used, SUM(CASE WHEN src='ship' THEN -qty ELSE 0 END) AS shipped,
      SUM(CASE WHEN src='adjust' THEN qty ELSE 0 END) AS adjusted, SUM(qty) AS stock, MAX(d) AS last_date
    FROM movements WHERE ${where.join(' AND ')} GROUP BY 1,2,3 ORDER BY item,spec,unit LIMIT 5001`,args);
  const combined = new Map();
  for (const source of sources) for (const row of source) {
    const key = JSON.stringify([row.item,row.spec,row.unit]), prior = combined.get(key);
    if (!prior) combined.set(key,{...row});
    else {
      for (const field of ['received','produced','used','shipped','adjusted','stock']) prior[field] += row[field];
      if (stockCompare(row.category,prior.category)>0) prior.category=row.category;
      if (stockCompare(row.last_date,prior.last_date)>0) prior.last_date=row.last_date;
    }
    if (combined.size>5000) throw bad('품목이 너무 많습니다. 검색어로 범위를 좁히세요.');
  }
  const rows = [...combined.values()].sort((a,b)=>stockCompare(a.item,b.item)||stockCompare(a.spec,b.spec)||stockCompare(a.unit,b.unit));
  const levels = new Map((await db.prepare('SELECT * FROM stock_levels').all()).map(l => [l.item + '\u0000' + l.unit, l.min_qty]));
  // By size, BOM material use sits on the unsized row; only flag a shortage when the item as a whole is short.
  const totals = new Map(); for (const r of rows) totals.set(r.item + '\u0000' + r.unit, (totals.get(r.item + '\u0000' + r.unit) || 0) + r.stock);
  let list = rows.map(r => {
    const min = bySpec ? null : levels.get(r.item + '\u0000' + r.unit) ?? null; const stock = stockRound(r.stock);
    return { ...r, received: stockRound(r.received), produced: stockRound(r.produced), used: stockRound(r.used), shipped: stockRound(r.shipped), adjusted: stockRound(r.adjusted), stock, min_qty: min, low: min !== null && stock < min, negative: stock < 0 && stockRound(totals.get(r.item + '\u0000' + r.unit)) < 0 };
  });
  // The catalog is the authority for an item's class, code and sub-classes; unregistered items keep what their records say.
  const catalog = new Map(); for (const b of await db.prepare('SELECT product,product_code,item_category,cat1,cat2,cat3,unit,semi_unit,pack_qty FROM boms WHERE active=1 ORDER BY is_temp DESC, id DESC').all()) catalog.set(nameKey(b.product), b);
  // An item counted both in boxes (orders, shipments) and in sheets (cutting) shows each line converted to the other unit.
  const convert = (c, r) => !c?.pack_qty || !c.semi_unit ? null : r.unit === c.semi_unit ? { qty: stockRound(r.stock / c.pack_qty), unit: c.unit } : r.unit === c.unit ? { qty: stockRound(r.stock * c.pack_qty), unit: c.semi_unit } : null;
  list = list.map(r => { const c = catalog.get(nameKey(r.item)); return { ...r, category: c?.item_category || r.category, product_code: c?.product_code || '', cat1: c?.cat1 || '', cat2: c?.cat2 || '', cat3: c?.cat3 || '', converted: convert(c, r) }; });
  if (query.item_category) { const c = itemCategory(query.item_category); list = list.filter(r => r.category === c); }
  for (const key of ['cat1', 'cat2', 'cat3']) if (query[key]) list = list.filter(r => r[key] === query[key]);
  if (query.state === 'low') list = list.filter(r => r.low); else if (query.state === 'negative') list = list.filter(r => r.negative);
  else if (query.state === 'instock') list = list.filter(r => r.stock > 0); else if (query.state) throw bad('재고 상태를 확인하세요.');
  return { asof, group: bySpec ? 'spec' : 'item', rows: list, can_adjust: canAdjustStock(user) };
});
// 15.114 안전재고 부족분 → 발주: 품목마다 등록 품목(bom_id·코드·분류), 입고 전 발주 수량(아직 안 받은·검수 중), 마지막 발주 매입처·단가.
// 화면은 부족분 = 안전재고 − 현재고 − 입고 전 발주 를 기본 수량으로 쓰고, 매입처별로 묶어 발주(/api/batches/purchase_order)를 만든다.
route('POST', '/api/inventory/reorder-info', async ({ body }) => {
  if (!Array.isArray(body.items) || body.items.length > 300) throw bad('품목은 300개까지 볼 수 있습니다.');
  const out = [];
  for (const raw of body.items) {
    const item = reqStr(raw?.item, '품목명', 200), unit = str(raw?.unit, 20), key = nameKey(item);
    const bom = await db.prepare("SELECT id, product, product_code, item_category, unit, spec FROM boms WHERE active=1 AND REPLACE(LOWER(product),' ','')=? ORDER BY is_temp, id DESC LIMIT 1").get(key);
    const open = await db.prepare("SELECT COALESCE(SUM(qty),0) AS q, COUNT(*) AS n FROM purchase_orders WHERE REPLACE(LOWER(item),' ','')=? AND (unit=? OR unit='') AND recv_status IN ('','checking')").get(key, unit);
    const last = await db.prepare("SELECT vendor, unit_price FROM purchase_orders WHERE REPLACE(LOWER(item),' ','')=? AND vendor<>'' ORDER BY id DESC LIMIT 1").get(key);
    out.push({ item, unit, bom_id: bom?.id || null, product_code: bom?.product_code || '', item_category: bom?.item_category || '', open_qty: stockRound(open.q), open_count: open.n, last_vendor: last?.vendor || '', last_price: last?.unit_price ?? null });
  }
  return { items: out };
});
// ── 15.114 창고 이동(LOT 위치 이동). 품목 전체 재고는 그대로, LOT의 위치별 잔량만 바뀐다. ──
// 위치별 잔량 = 위치가 적힌 입고 + 이동 들어옴 − 이동 나감. 출하는 위치를 적지 않으므로 먼저 들어온 위치부터 뺀다.
async function lotPlaceStock(item, unit, lot, asof = today(), skipId = 0) {
  const lotExpr = "CASE WHEN l.lot='' THEN '(LOT 미지정)' ELSE l.lot END";
  const [a, b, c, d, t] = await db.batch([
    { sql: `SELECT TRIM(l.warehouse || ' ' || l.location) AS place, l.qty, l.received_date AS d FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.voided_at IS NULL AND p.recv_status IN ('ok','mismatch') AND TRIM(p.item)=? AND TRIM(p.unit)=? AND ${lotExpr}=? AND l.received_date<=?`, args: [item, unit, lot, asof] },
    { sql: `SELECT '' AS place, recv_qty AS qty, COALESCE(substr(recv_at,1,10), due_date) AS d FROM purchase_orders WHERE lot<>'' AND recv_status IN ('ok','mismatch') AND recv_qty IS NOT NULL AND NOT EXISTS(SELECT 1 FROM po_receipt_lots l WHERE l.po_id=purchase_orders.id AND l.voided_at IS NULL) AND TRIM(item)=? AND TRIM(unit)=? AND lot=? AND COALESCE(substr(recv_at,1,10), due_date)<=?`, args: [item, unit, lot, asof] },
    { sql: `SELECT TRIM(warehouse || ' ' || location) AS place, qty, received_date AS d FROM other_receipts WHERE lot<>'' AND TRIM(item)=? AND TRIM(COALESCE(NULLIF(unit,''), json_extract(bom_snapshot,'$.unit'), ''))=? AND lot=? AND received_date<=?`, args: [item, unit, lot, asof] },
    { sql: `SELECT COALESCE(SUM(qty),0) AS q FROM shipments WHERE lot<>'' AND TRIM(item)=? AND TRIM(unit)=? AND lot=? AND ship_date<=?`, args: [item, unit, lot, asof] },
    { sql: `SELECT id, from_place, to_place, qty, transfer_date AS d FROM stock_transfers WHERE status='confirmed' AND item=? AND unit=? AND lot=? AND transfer_date<=? AND id<>? ORDER BY transfer_date, id`, args: [item, unit, lot, asof, skipId] },
  ]);
  const map = new Map(); const at = (place, d) => { if (!map.has(place)) map.set(place, { place, qty: 0, first: d }); const p = map.get(place); if (d < p.first) p.first = d; return p; };
  for (const r of [...a.results, ...b.results, ...c.results]) at(r.place || '', r.d).qty += Number(r.qty) || 0;
  for (const r of t.results) { at(r.from_place, r.d).qty -= r.qty; at(r.to_place, r.d).qty += r.qty; }
  let ship = Number(d.results[0]?.q) || 0;
  const places = [...map.values()].sort((x, y) => stockCompare(x.first, y.first) || stockCompare(x.place, y.place));
  for (const p of places) { if (ship <= 0) break; const take = Math.min(Math.max(p.qty, 0), ship); p.qty -= take; ship -= take; }
  if (ship > 0 && places.length) places[0].qty -= ship; // 받은 것보다 많이 출하(기록 확인 필요)
  return places.map(p => ({ place: p.place, qty: stockRound(p.qty), first_date: p.first })).filter(p => p.qty !== 0);
}
route('GET', '/api/inventory/lot-places', async ({ query }) => {
  const item = reqStr(query.item, '품목명', 200), unit = str(query.unit, 20), lot = reqStr(query.lot, 'LOT', 100);
  const transfers = await db.prepare('SELECT * FROM stock_transfers WHERE item=? AND unit=? AND lot=? ORDER BY transfer_date DESC, id DESC LIMIT 50').all(item, unit, lot);
  return { item, unit, lot, places: await lotPlaceStock(item, unit, lot, stockAsOf(query.asof)), transfers };
});
const canMoveStock = user => canAdjustStock(user) || hasRole(user, 'logistics');
route('POST', '/api/stock-transfers', async ({ user, body }) => {
  if (!canMoveStock(user)) throw new HttpError(403, '창고 이동은 물류 담당자나 관리자가 합니다.');
  const key = str(body.request_id, 80);
  if (key) { const old = await db.prepare('SELECT * FROM stock_transfers WHERE request_id=?').get(key); if (old) { if (old.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return old; } }
  const item = reqStr(body.item, '품목명', 200), unit = str(body.unit, 20), lot = reqStr(body.lot, 'LOT', 100);
  const date = dateStr(body.transfer_date || today(), '이동일'); if (date > today()) throw bad('이동일은 오늘 이전으로 넣으세요.');
  const qty = num(body.qty, '이동 수량'); if (!(qty > 0)) throw bad('이동 수량은 0보다 커야 합니다.');
  const from = str(body.from_place, 120), toWh = reqStr(body.to_warehouse, '옮길 창고', 50), toLoc = str(body.to_location, 50);
  const wh = await db.prepare('SELECT * FROM warehouses WHERE name=? AND active=1').get(toWh); if (!wh) throw bad(`사용 중인 창고가 아닙니다: ${toWh}`);
  const locs = wh.locations ? wh.locations.split(',') : []; if (toLoc && locs.length && !locs.includes(toLoc)) throw bad(`${toWh} 창고에 없는 위치입니다: ${toLoc}`);
  const to = `${toWh} ${toLoc}`.trim(); if (to === from) throw bad('같은 위치로는 옮길 수 없습니다.');
  const seen = (await db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM stock_transfers').get()).m; // 15.209 동시 이동 가드
  const here = (await lotPlaceStock(item, unit, lot, date)).find(p => p.place === from);
  if (!here || here.qty < qty - 1e-9) throw bad(`${from || '위치 미지정'}에 이 LOT가 ${stockRound(here?.qty || 0)}${unit}만 있습니다(${date} 기준).`);
  // 그 날짜 이후 이 위치에서 나간 이동이 있으면 지금 잔량으로도 확인(나중 날짜 이동과 겹쳐 모자라지 않게)
  const cur = (await lotPlaceStock(item, unit, lot)).find(p => p.place === from);
  if (!cur || cur.qty < qty - 1e-9) throw bad(`${from || '위치 미지정'}의 이 LOT 현재 잔량(${stockRound(cur?.qty || 0)}${unit})보다 많이 옮길 수 없습니다.`);
  let r;
  try { [r] = await db.batch([
    { sql: 'INSERT INTO stock_transfers(transfer_date,item,unit,lot,qty,from_place,to_warehouse,to_location,to_place,note,created_by,created_by_id,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [date, item, unit, lot, qty, from, toWh, toLoc, to, str(body.note, 200), user.name, user.id, key || null] },
    { sql: "SELECT json('conflict') WHERE (SELECT COUNT(*) FROM stock_transfers WHERE id>? AND status='confirmed' AND item=? AND unit=? AND lot=? AND from_place=?) > 1", args: [seen, item, unit, lot, from] },
  ]); }
  catch (error) {
    if (key) { const old = await db.prepare('SELECT * FROM stock_transfers WHERE request_id=?').get(key); if (old && old.created_by_id === user.id) return old; }
    if (isGuardError(error)) throw new HttpError(409, `그 사이 같은 LOT(${lot})가 ${from || '위치 미지정'}에서 옮겨졌습니다. 새로 불러와 남은 수량을 확인하세요.`); throw error;
  }
  return mustGet('stock_transfers', r.meta.last_row_id);
});
route('GET', '/api/stock-transfers', async ({ query }) => {
  const where = [], args = []; applyListDates(where, args, query, 'transfer_date');
  applyListKeyword(where, args, query.q, ['item', 'lot', 'from_place', 'to_place', 'note', 'created_by']);
  return db.prepare(`SELECT * FROM stock_transfers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY transfer_date DESC, id DESC LIMIT 300`).all(...args);
});
// 취소: 옮긴 위치에 그만큼 남아 있을 때만(그 뒤 다시 옮기거나 출하했으면 막음).
route('POST', '/api/stock-transfers/:id/cancel', async ({ user, params }) => {
  const row = await mustGet('stock_transfers', params.id);
  if (!canAdjustStock(user) && row.created_by_id !== user.id) throw new HttpError(403, '이동 취소는 입력한 사람이나 물류팀장·관리자가 합니다.');
  if (row.status !== 'confirmed') throw bad('이미 취소된 이동입니다.');
  const left = (await lotPlaceStock(row.item, row.unit, row.lot)).find(p => p.place === row.to_place);
  if (!left || left.qty < row.qty - 1e-9) throw bad(`${row.to_place}에 남은 수량(${stockRound(left?.qty || 0)}${row.unit})이 옮긴 수량보다 적어 취소할 수 없습니다. 그 뒤 이동·출하를 먼저 확인하세요.`);
  const r = await db.prepare("UPDATE stock_transfers SET status='cancelled',cancelled_at=?,cancelled_by=? WHERE id=? AND status='confirmed'").run(now(), user.name, row.id);
  if (!r.changes) throw new HttpError(409, '그 사이 이 이동이 취소되었습니다.');
  return mustGet('stock_transfers', row.id);
});

// LOT별 재고(15.72): LOT가 적힌 입고(발주입고 LOT 줄·예전 발주입고·기타입고) − 같은 LOT의 출하. 생산 투입은 LOT를 기록하지 않아 빼지 않는다.
// D1이 큰 UNION 조회를 거부한 적이 있어(15.40) 원천별로 나눠 읽고 서버에서 합친다.
route('GET', '/api/inventory/lots', async ({ query }) => lotStockReport(query));
// ── 15.231 파렛트 묶음 ──
// 묶어도 재고는 그대로(출고할 때 LOT별 출하가 생겨 빠진다). 묶을 때는 「LOT 잔량 − 다른 열린 파렛트에 묶인 수량」 안에서만.
const canPallet = user => canMoveStock(user);
async function lotBalance(item, lot) { const r = (await lotStockReport({ q: lot })).rows.find(x => x.item === item && x.lot === lot); return r ? r.balance : 0; }
async function palletReserved(item, lot, exceptId = 0) { return (await db.prepare("SELECT COALESCE(SUM(l.qty),0) AS q FROM pallet_lines l JOIN pallets p ON p.id=l.pallet_id WHERE p.status='open' AND l.item=? AND l.lot=? AND p.id<>?").get(item, lot, exceptId)).q; }
async function palletDetail(p) {
  const lines = await db.prepare('SELECT * FROM pallet_lines WHERE pallet_id=? ORDER BY id').all(p.id);
  const changes = await db.prepare("SELECT summary, changed_by, changed_at FROM doc_changes WHERE doc_type='pallet' AND doc_id=? ORDER BY id DESC LIMIT 30").all(p.id);
  const units = [...new Set(lines.map(l => l.unit))];
  return { ...p, lines, changes, total: stockRound(lines.reduce((t, l) => t + l.qty, 0)), unit: units.length === 1 ? units[0] : '' };
}
async function palletByCode(code) {
  const c = String(code || '').trim(); const row = /^\d+$/.test(c) ? await db.prepare('SELECT * FROM pallets WHERE id=?').get(Number(c)) : await db.prepare('SELECT * FROM pallets WHERE pallet_no=?').get(c.toUpperCase());
  if (!row) throw new HttpError(404, `파렛트 ${c}를 찾지 못했습니다.`); return row;
}
route('GET', '/api/pallets', async ({ query }) => {
  const where = [], args = [], st = String(query.status || 'open');
  if (st !== 'all') { if (!['open', 'shipped', 'cancelled'].includes(st)) throw bad('상태를 확인하세요.'); where.push('p.status=?'); args.push(st); }
  applyListDates(where, args, query, 'substr(p.created_at,1,10)');
  const q = str(query.q, 100); if (q) { where.push("(p.pallet_no LIKE ? ESCAPE '\\' OR p.note LIKE ? ESCAPE '\\' OR p.customer LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM pallet_lines l WHERE l.pallet_id=p.id AND (l.item LIKE ? ESCAPE '\\' OR l.lot LIKE ? ESCAPE '\\')))"); const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%'; args.push(like, like, like, like, like); }
  const rows = await db.prepare(`SELECT p.* FROM pallets p ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 300`).all(...args);
  const lines = rows.length ? (await Promise.all(inChunks(rows.map(r => r.id)).map(ids => db.prepare(`SELECT * FROM pallet_lines WHERE pallet_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids)))).flat() : [];
  return { rows: rows.map(p => { const ls = lines.filter(l => l.pallet_id === p.id), units = [...new Set(ls.map(l => l.unit))]; return { ...p, lines: ls, total: stockRound(ls.reduce((t, l) => t + l.qty, 0)), unit: units.length === 1 ? units[0] : '' }; }) };
});
route('GET', '/api/pallets/lookup', async ({ query }) => palletDetail(await palletByCode(query.code)));
route('GET', '/api/pallets/:id', async ({ params }) => palletDetail(await mustGet('pallets', params.id)));
route('POST', '/api/pallets', async ({ user, body }) => {
  if (!canPallet(user)) throw new HttpError(403, '파렛트 묶기는 물류 담당자나 관리자가 합니다.');
  const token = reqToken(body); { const old = await db.prepare('SELECT * FROM pallets WHERE request_id=?').get(token); if (old) { if (old.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return { ...await palletDetail(old), duplicate: true }; } }
  const raw = Array.isArray(body.lines) ? body.lines : []; if (!raw.length || raw.length > 60) throw bad('파렛트에 담을 LOT를 1~60줄 넣으세요.');
  const merged = new Map();
  for (const [i, l] of raw.entries()) {
    const item = reqStr(l?.item, `${i + 1}번째 줄 품목`, 200).trim(), lot = reqStr(l?.lot, `${i + 1}번째 줄 LOT`, 100).trim(), qty = num(l?.qty, `${i + 1}번째 줄 수량`);
    if (!(qty > 0)) throw bad(`${i + 1}번째 줄: 수량은 0보다 커야 합니다.`);
    const k = item + '\u0001' + lot, m = merged.get(k) || { item, lot, unit: str(l.unit, 20), qty: 0 }; m.qty = stockRound(m.qty + qty); merged.set(k, m);
  }
  for (const m of merged.values()) { const can = stockRound(await lotBalance(m.item, m.lot) - await palletReserved(m.item, m.lot)); if (m.qty > can + 1e-9) throw bad(`${m.item} LOT ${m.lot}: 묶을 수 있는 수량은 ${can}${m.unit}입니다(잔량에서 다른 파렛트에 묶인 수량을 뺌).`); }
  const head = `PLT_${today().replace(/-/g, '')}_`;
  try {
    await db.batch([
      { sql: "INSERT INTO pallets(pallet_no,note,created_by,created_by_id,request_id) VALUES((SELECT ? || printf('%03d', COALESCE(MAX(CAST(substr(pallet_no, 14) AS INTEGER)), 0) + 1) FROM pallets WHERE substr(pallet_no, 1, 13)=?),?,?,?,?)", args: [head, head, str(body.note, 300), user.name, user.id, token] },
      ...[...merged.values()].map(m => ({ sql: 'INSERT INTO pallet_lines(pallet_id,item,unit,lot,qty,orig_qty) VALUES((SELECT id FROM pallets WHERE request_id=?),?,?,?,?,?)', args: [token, m.item, m.unit, m.lot, m.qty, m.qty] })),
    ]);
  } catch (error) { const old = await db.prepare('SELECT * FROM pallets WHERE request_id=?').get(token); if (old) return palletDetail(old); throw error; }
  const row = await db.prepare('SELECT * FROM pallets WHERE request_id=?').get(token);
  await db.batch([docChange('pallet', row.id, `묶음 ${[...merged.values()].map(m => `${m.lot} ${m.qty}${m.unit}`).join(' + ')}`, user)]);
  return palletDetail(row);
});
// 수량 바꾸기(일부 꺼내 쓰기 등): QR은 그대로, 파렛트 안 LOT별 수량만 고친다. 늘릴 때는 묶을 수 있는 수량 안에서.
route('PUT', '/api/pallets/:id', async ({ user, params, body }) => {
  if (!canPallet(user)) throw new HttpError(403, '파렛트 수정은 물류 담당자나 관리자가 합니다.');
  const p = await mustGet('pallets', params.id); if (p.status !== 'open') throw bad('출고했거나 푼 파렛트는 고칠 수 없습니다.');
  const lines = await db.prepare('SELECT * FROM pallet_lines WHERE pallet_id=?').all(p.id);
  const edits = Array.isArray(body.lines) ? body.lines : []; const cmds = [], diff = [];
  for (const e of edits) {
    const l = lines.find(x => x.id === Number(e?.id)); if (!l) throw new HttpError(409, '이 파렛트에 없는 줄입니다. 새로 불러오세요.');
    const qty = num(e.qty, `${l.lot} 수량`); if (qty < 0) throw bad(`${l.lot}: 수량은 0 이상이어야 합니다.`);
    if (stockRound(qty) === l.qty) continue;
    if (qty > l.qty) { const can = stockRound(await lotBalance(l.item, l.lot) - await palletReserved(l.item, l.lot, p.id)); if (qty > can + 1e-9) throw bad(`${l.item} LOT ${l.lot}: 이 파렛트에 둘 수 있는 수량은 ${can}${l.unit}입니다.`); }
    cmds.push({ sql: "UPDATE pallet_lines SET qty=? WHERE id=? AND pallet_id IN (SELECT id FROM pallets WHERE id=? AND status='open')", args: [stockRound(qty), l.id, p.id] });
    diff.push(`${l.lot} ${l.qty}→${stockRound(qty)}${l.unit}`);
  }
  if (!diff.length) return palletDetail(p);
  const reason = str(body.reason, 200);
  await db.batch([...cmds, { sql: "SELECT json('conflict') WHERE (SELECT status FROM pallets WHERE id=?)<>'open'", args: [p.id] }, docChange('pallet', p.id, `수량 변경 ${diff.join(', ')}${reason ? ` (${reason})` : ''}`, user)]).catch(error => { if (isGuardError(error)) throw new HttpError(409, '그 사이 이 파렛트가 출고되었거나 풀렸습니다.'); throw error; });
  return palletDetail(await mustGet('pallets', p.id));
});
route('POST', '/api/pallets/:id/cancel', async ({ user, params }) => {
  if (!canPallet(user)) throw new HttpError(403, '파렛트 풀기는 물류 담당자나 관리자가 합니다.');
  const p = await mustGet('pallets', params.id); if (p.status !== 'open') throw bad('열린 파렛트만 풀 수 있습니다.');
  const r = await db.prepare("UPDATE pallets SET status='cancelled',cancelled_at=?,cancelled_by=? WHERE id=? AND status='open'").run(now(), user.name, p.id);
  if (!r.changes) throw new HttpError(409, '그 사이 이 파렛트가 출고되었거나 풀렸습니다.');
  await db.batch([docChange('pallet', p.id, '묶음 풀기(재고는 그대로)', user)]);
  return palletDetail(await mustGet('pallets', p.id));
});
// 출고: 파렛트 QR 하나로 LOT별 출하를 한 번에(재고에서 LOT마다 빠짐). 같은 파렛트를 두 번 출고하지 않게 한 묶음 안에서 상태를 확인한다.
route('POST', '/api/pallets/:id/ship', async ({ user, params, body }) => {
  if (!canPallet(user)) throw new HttpError(403, '파렛트 출고는 물류 담당자나 관리자가 합니다.');
  const p = await palletByCode(params.id);
  if (p.status === 'shipped') throw new HttpError(409, `${p.pallet_no}는 이미 출고했습니다(${String(p.shipped_at || '').slice(0, 16)} · ${p.shipped_by || ''}).`);
  if (p.status !== 'open') throw bad('풀린 파렛트는 출고할 수 없습니다.');
  const date = dateStr(body.ship_date || today(), '출고일'); if (date > today()) throw bad('출고일은 오늘 이전으로 넣으세요.');
  const customer = reqStr(body.customer, '거래처', 100); await ensureVendor(customer, user, 'sales');
  const lines = (await db.prepare('SELECT * FROM pallet_lines WHERE pallet_id=? AND qty>0 ORDER BY id').all(p.id)); if (!lines.length) throw bad('파렛트에 남은 수량이 없습니다. 풀기를 하세요.');
  for (const l of lines) { await checkShipLot(l.item, l.lot); const bal = await lotBalance(l.item, l.lot); if (l.qty > bal + 1e-9) throw bad(`${l.item} LOT ${l.lot}: 재고 잔량(${bal}${l.unit})보다 파렛트 수량(${l.qty})이 많습니다. 파렛트 수량을 고친 뒤 출고하세요.`); }
  const token = crypto.randomUUID(), note = `${p.pallet_no} 파렛트 출고${body.note ? ' · ' + str(body.note, 200) : ''}`;
  const codes = new Map(); for (const l of lines) if (!codes.has(l.item)) codes.set(l.item, (await db.prepare(`SELECT product_code FROM boms WHERE ${customerKey('product')}=? AND product_code<>'' ORDER BY active DESC, id LIMIT 1`).get(nameKey(l.item)))?.product_code || '');
  try {
    await db.batch([
      { sql: "UPDATE pallets SET status='shipped',shipped_at=?,shipped_by=?,ship_token=?,customer=? WHERE id=? AND status='open'", args: [now(), user.name, token, customer, p.id] },
      { sql: "SELECT json('conflict') WHERE (SELECT ship_token FROM pallets WHERE id=?) IS NOT ?", args: [p.id, token] },
      ...lines.map(l => ({ sql: 'INSERT INTO shipments(ship_date,item,qty,customer,note,lot,created_by,product_code,unit,pallet_id) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [date, l.item, l.qty, customer, note, l.lot, user.name, codes.get(l.item), l.unit, p.id] })),
      docChange('pallet', p.id, `출고 → ${customer} (${lines.map(l => `${l.lot} ${l.qty}${l.unit}`).join(' + ')})`, user),
    ]);
  } catch (error) { if (isGuardError(error)) throw new HttpError(409, `${p.pallet_no}는 그 사이 출고되었거나 풀렸습니다.`); throw error; }
  return palletDetail(await mustGet('pallets', p.id));
});
// 15.230 창고·위치별 재고: LOT마다 위치별 잔량(위치가 적힌 입고 + 이동 들어옴 − 나감, 출고·생산 투입·반출은 먼저 들어온 위치부터 뺌).
// LOT별 재고와 같은 원천을 쓰고 위치 없이 들어온 것(생산·반입·예전 발주)은 「위치 미지정」. ?warehouse=창고, ?q=품목·LOT·위치
route('GET', '/api/inventory/places', async ({ query }) => inventoryPlaces(query));
async function inventoryPlaces(query) {
  const asof = stockAsOf(query.asof), q = str(query.q, 200).toLowerCase(), whF = str(query.warehouse, 50);
  const LOT = "CASE WHEN l.lot='' THEN '(LOT 미지정)' ELSE l.lot END";
  const [a, b, c, d, e, f, g, h, t, w, adj, cutIn] = await db.batch([
    { sql: `SELECT TRIM(p.item) AS item, TRIM(p.unit) AS unit, ${LOT} AS lot, l.warehouse AS wh, l.location AS loc, l.qty, l.received_date AS d, p.product_code AS code FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.voided_at IS NULL AND p.recv_status IN ('ok','mismatch') AND l.received_date<=?`, args: [asof] },
    { sql: `SELECT TRIM(item) AS item, TRIM(unit) AS unit, lot, '' AS wh, '' AS loc, recv_qty AS qty, COALESCE(substr(recv_at,1,10), due_date) AS d, product_code AS code FROM purchase_orders WHERE lot<>'' AND recv_status IN ('ok','mismatch') AND recv_qty IS NOT NULL AND NOT EXISTS(SELECT 1 FROM po_receipt_lots l WHERE l.po_id=purchase_orders.id AND l.voided_at IS NULL) AND COALESCE(substr(recv_at,1,10), due_date)<=?`, args: [asof] },
    { sql: `SELECT TRIM(item) AS item, TRIM(COALESCE(NULLIF(unit,''), json_extract(bom_snapshot,'$.unit'), '')) AS unit, lot, warehouse AS wh, location AS loc, qty, received_date AS d, COALESCE(json_extract(bom_snapshot,'$.product_code'),'') AS code FROM other_receipts WHERE lot<>'' AND received_date<=?`, args: [asof] },
    { sql: `SELECT TRIM(s.product) AS item, TRIM(COALESCE(NULLIF(s.unit,''), json_extract(s.bom_snapshot,'$.unit'), '')) AS unit, a.lot AS lot, '' AS wh, '' AS loc, a.qty AS qty, a.production_date AS d, COALESCE(json_extract(s.bom_snapshot,'$.product_code'),'') AS code FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE a.voided_at IS NULL AND a.lot<>'' AND a.production_date<=?`, args: [asof] },
    { sql: `SELECT TRIM(l.item) AS item, TRIM(l.unit) AS unit, l.lot AS lot, '' AS wh, '' AS loc, l.qty AS qty, r.return_date AS d, '' AS code FROM stock_return_lines l JOIN stock_returns r ON r.id=l.return_id WHERE l.lot<>'' AND r.status='confirmed' AND r.process IN ('stock_amount','stock') AND r.side='in' AND r.return_date<=?`, args: [asof] },
    { sql: `SELECT TRIM(item) AS item, lot, SUM(qty) AS q FROM shipments WHERE lot<>'' AND ship_date<=? GROUP BY TRIM(item), lot`, args: [asof] },
    { sql: `SELECT TRIM(i.item) AS item, i.lot AS lot, SUM(i.qty) AS q FROM production_lot_inputs i JOIN production_actuals a ON a.id=i.actual_id WHERE a.voided_at IS NULL AND a.production_date<=? GROUP BY TRIM(i.item), i.lot`, args: [asof] },
    { sql: `SELECT TRIM(l.item) AS item, l.lot AS lot, SUM(l.qty) AS q FROM stock_return_lines l JOIN stock_returns r ON r.id=l.return_id WHERE l.lot<>'' AND r.status='confirmed' AND r.process IN ('stock_amount','stock') AND r.side<>'in' AND r.return_date<=? GROUP BY TRIM(l.item), l.lot`, args: [asof] },
    { sql: `SELECT item, lot, from_place, to_place, to_warehouse, to_location, qty, transfer_date AS d FROM stock_transfers WHERE status='confirmed' AND transfer_date<=? ORDER BY transfer_date, id`, args: [asof] },
    { sql: 'SELECT name, locations, sort FROM warehouses ORDER BY sort, name', args: [] },
    { sql: "SELECT TRIM(item) AS item, TRIM(unit) AS unit, lot, warehouse AS wh, location AS loc, qty, adj_date AS d, '' AS code FROM stock_adjustments WHERE lot<>'' AND (warehouse<>'' OR qty>0) AND adj_date<=?", args: [asof] }, // 15.265 LOT·위치 조정(+/−), 위치 없는 감소는 아래 outs로
    { sql: "SELECT TRIM(i.item) AS item, i.lot AS lot, SUM(i.qty) AS q FROM semi_lot_inputs i JOIN semi_records r ON r.id=i.record_id WHERE r.work_date<=? GROUP BY TRIM(i.item), i.lot UNION ALL SELECT TRIM(item), lot, SUM(-qty) FROM stock_adjustments WHERE lot<>'' AND warehouse='' AND qty<0 AND adj_date<=? GROUP BY TRIM(item), lot", args: [asof, asof] }, // 15.265 커팅 투입·위치 없는 LOT 감소도 빠지게(먼저 들어온 위치부터)
  ]);
  const ins = [...a.results, ...b.results, ...c.results, ...d.results, ...e.results, ...adj.results];
  if (ins.length > 50000) throw bad('기록이 너무 많습니다. 기준일이나 검색으로 범위를 좁히세요.');
  const lots = new Map(), placeOf = new Map(); // 위치 글자 → [창고, 위치]
  const key = (item, lot) => item + '\u0001' + lot;
  const at = (k, item, unit, lot, place, wh, loc, d, code) => {
    if (!lots.has(k)) lots.set(k, { item, unit, lot, code: code || '', places: new Map() });
    const L = lots.get(k); if (!L.unit && unit) L.unit = unit; if (!L.code && code) L.code = code;
    if (!L.places.has(place)) L.places.set(place, { place, wh, loc, qty: 0, first: d }); const p = L.places.get(place); if (d && (!p.first || d < p.first)) p.first = d; return p;
  };
  for (const r of ins) { const wh = String(r.wh || '').trim(), loc = String(r.loc || '').trim(), place = `${wh} ${loc}`.trim(); if (place) placeOf.set(place, [wh, loc]); at(key(r.item, r.lot), r.item, r.unit, r.lot, place, wh, loc, r.d, r.code).qty += Number(r.qty) || 0; }
  for (const r of t.results) { placeOf.set(r.to_place, [r.to_warehouse, r.to_location]); const k = key(String(r.item).trim(), r.lot); if (!lots.has(k)) continue; const L = lots.get(k); const fr = placeOf.get(r.from_place) || [r.from_place.split(' ')[0] || '', r.from_place.split(' ').slice(1).join(' ')]; at(k, L.item, L.unit, L.lot, r.from_place, fr[0], fr[1], r.d).qty -= r.qty; at(k, L.item, L.unit, L.lot, r.to_place, r.to_warehouse, r.to_location, r.d).qty += r.qty; }
  const outs = new Map(); for (const r of [...f.results, ...g.results, ...h.results, ...cutIn.results]) { const k = key(r.item, r.lot); outs.set(k, (outs.get(k) || 0) + (Number(r.q) || 0)); }
  const rows = [];
  for (const [k, L] of lots) {
    let out = outs.get(k) || 0; const ps = [...L.places.values()].sort((x, y) => stockCompare(x.first, y.first) || stockCompare(x.place, y.place));
    for (const p of ps) { if (out <= 0) break; const take = Math.min(Math.max(p.qty, 0), out); p.qty -= take; out -= take; }
    if (out > 0 && ps.length) ps[0].qty -= out;
    for (const p of ps) { const qty = stockRound(p.qty); if (Math.abs(qty) < 1e-9) continue; rows.push({ warehouse: p.wh || '', location: p.loc || '', item: L.item, code: L.code, unit: L.unit, lot: L.lot, qty, first_date: p.first }); }
  }
  const order = new Map(w.results.map((x, i) => [x.name, i]));
  let out = rows.filter(r => (!whF || (whF === '(위치 미지정)' ? !r.warehouse : r.warehouse === whF)) && (!q || `${r.item} ${r.code} ${r.lot} ${r.warehouse} ${r.location}`.toLowerCase().includes(q)));
  out.sort((x, y) => (!x.warehouse) - (!y.warehouse) || (order.get(x.warehouse) ?? 999) - (order.get(y.warehouse) ?? 999) || stockCompare(x.warehouse, y.warehouse) || stockCompare(x.location, y.location) || stockCompare(x.item, y.item) || stockCompare(x.first_date, y.first_date));
  const warehouses = w.results.map(x => ({ name: x.name, locations: x.locations ? x.locations.split(',') : [] }));
  return { asof, rows: out.slice(0, 3000), more: out.length > 3000, warehouses };
}
async function lotStockReport(query) {
  const asof = stockAsOf(query.asof), q = str(query.q, 200);
  const like = q ? '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%' : null;
  const filter = like ? " AND (item LIKE ? ESCAPE '\\' OR lot LIKE ? ESCAPE '\\')" : '';
  // 원천마다 SQL에서 품목·단위·LOT별로 묶어 읽는다(15.75). 한 원천이 5000묶음을 넘으면 more로 알린다.
  const wrap = source => ({ sql: `SELECT item, unit, lot, SUM(CASE WHEN kind='in' THEN qty ELSE 0 END) AS received, SUM(CASE WHEN kind='out' THEN qty ELSE 0 END) AS shipped, MIN(d) AS first_date, MAX(d) AS last_date, group_concat(DISTINCT NULLIF(place,'')) AS places FROM (${source}) WHERE d<=?${filter} GROUP BY item, unit, lot LIMIT 5001`, args: like ? [asof, like, like] : [asof] });
  const results = await db.batch([
    // LOT 줄로 받은 발주는 LOT 없는 줄(수량 수정 보정·LOT 없이 받은 줄)도 「LOT 미지정」으로 넣어 그 발주의 LOT별 합 = 실입고(15.77).
    wrap(`SELECT TRIM(p.item) AS item, TRIM(p.unit) AS unit, CASE WHEN l.lot='' THEN '(LOT 미지정)' ELSE l.lot END AS lot, 'in' AS kind, l.qty AS qty, l.received_date AS d, TRIM(l.warehouse || ' ' || l.location) AS place FROM po_receipt_lots l JOIN purchase_orders p ON p.id=l.po_id WHERE l.voided_at IS NULL AND p.recv_status IN ('ok','mismatch')`),
    wrap(`SELECT TRIM(item) AS item, TRIM(unit) AS unit, lot, 'in' AS kind, recv_qty AS qty, COALESCE(substr(recv_at,1,10), due_date) AS d, '' AS place FROM purchase_orders WHERE lot<>'' AND recv_status IN ('ok','mismatch') AND recv_qty IS NOT NULL AND NOT EXISTS(SELECT 1 FROM po_receipt_lots l WHERE l.po_id=purchase_orders.id AND l.voided_at IS NULL)`),
    wrap(`SELECT TRIM(item) AS item, TRIM(COALESCE(NULLIF(unit,''), json_extract(bom_snapshot,'$.unit'), '')) AS unit, lot, 'in' AS kind, qty, received_date AS d, TRIM(warehouse || ' ' || location) AS place FROM other_receipts WHERE lot<>''`),
    wrap(`SELECT TRIM(item) AS item, TRIM(unit) AS unit, lot, 'out' AS kind, qty, ship_date AS d, '' AS place FROM shipments WHERE lot<>''`),
    // 15.140 반입(재입고)은 LOT 입고, 반출은 LOT 출고
    wrap(`SELECT TRIM(l.item) AS item, TRIM(l.unit) AS unit, l.lot AS lot, CASE r.side WHEN 'in' THEN 'in' ELSE 'out' END AS kind, l.qty AS qty, r.return_date AS d, '' AS place FROM stock_return_lines l JOIN stock_returns r ON r.id=l.return_id WHERE l.lot<>'' AND r.status='confirmed' AND r.process IN ('stock_amount','stock')`),
    // 15.135 완제품 생산 LOT(입고)과 생산에 투입한 자재 LOT(출고)
    wrap(`SELECT TRIM(s.product) AS item, TRIM(COALESCE(NULLIF(s.unit,''), json_extract(s.bom_snapshot,'$.unit'), '')) AS unit, a.lot AS lot, 'in' AS kind, a.qty AS qty, a.production_date AS d, '' AS place FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE a.lot<>'' AND a.voided_at IS NULL`),
    wrap(`SELECT TRIM(i.item) AS item, TRIM(i.unit) AS unit, i.lot AS lot, 'out' AS kind, i.qty AS qty, a.production_date AS d, '' AS place FROM production_lot_inputs i JOIN production_actuals a ON a.id=i.actual_id WHERE a.voided_at IS NULL`),
    wrap(`SELECT TRIM(i.item) AS item, TRIM(i.unit) AS unit, i.lot AS lot, 'out' AS kind, i.qty AS qty, r.work_date AS d, '' AS place FROM semi_lot_inputs i JOIN semi_records r ON r.id=i.record_id`), // 15.249 커팅·융착에 투입한 원자재 LOT
    wrap(`SELECT item, unit, lot, 'move' AS kind, 0 AS qty, transfer_date AS d, to_place AS place FROM stock_transfers WHERE status='confirmed'`), // 15.114 이동한 위치
    wrap(`SELECT TRIM(item) AS item, TRIM(unit) AS unit, lot, CASE WHEN qty>0 THEN 'in' ELSE 'out' END AS kind, ABS(qty) AS qty, adj_date AS d, TRIM(warehouse || ' ' || location) AS place FROM stock_adjustments WHERE lot<>''`), // 15.265 LOT 재고 조정
  ]);
  const map = new Map(); let truncated = false;
  for (const result of results) {
    // 한 원천이 5000묶음을 넘으면 입고·출하가 서로 다르게 잘려 잔량이 틀릴 수 있으므로 결과를 주지 않는다(15.77).
    if (result.results.length > 5000) throw bad('LOT가 너무 많습니다. 품목명·LOT 검색어로 범위를 좁히세요.');
    for (const m of result.results.slice(0, 5000)) {
      // 15.150 단위가 달라도(예: 투입을 BOM 단위 M로, 입고를 m로) 같은 품목·LOT이면 한 줄 — 입고 쪽 단위를 쓴다
      const key = JSON.stringify([m.item, m.lot]), row = map.get(key) || { item: m.item, unit: m.unit, lot: m.lot, received: 0, shipped: 0, first_date: m.first_date, last_date: m.last_date, places: new Set() };
      if (m.received > 0 && m.unit && (!row.unit || !row.inUnit)) { row.unit = m.unit; row.inUnit = true; }
      row.received += m.received; row.shipped += m.shipped;
      if (stockCompare(m.first_date, row.first_date) < 0) row.first_date = m.first_date; if (stockCompare(m.last_date, row.last_date) > 0) row.last_date = m.last_date;
      for (const place of String(m.places || '').split(',')) if (place) row.places.add(place);
      map.set(key, row);
    }
  }
  let rows = [...map.values()].map(({ inUnit, ...r }) => ({ ...r, received: stockRound(r.received), shipped: stockRound(r.shipped), balance: stockRound(r.received - r.shipped), places: [...r.places].join(', ') }));
  if (query.state === 'instock') rows = rows.filter(r => r.balance > 0);
  if (query.cat) { const catalog = new Map(); for (const b of await db.prepare('SELECT product,product_code,item_category,cat1,cat2,cat3 FROM boms WHERE active=1 ORDER BY is_temp DESC, id DESC').all()) catalog.set(nameKey(b.product), b); rows = rows.map(r => { const c = catalog.get(nameKey(r.item)); return { ...r, product_code: c?.product_code || '', category: c?.item_category || '', cat1: c?.cat1 || '', cat2: c?.cat2 || '', cat3: c?.cat3 || '' }; }); } // 15.260
  if (query.qc) { const st = await lotQcStates(); rows = rows.map(r => { const x = st.get(r.item + '\u0000' + r.lot); return x ? { ...r, qc: x.qc, qc_req: x.req_no, ...(x.concession ? { concession: { id: x.concession.id, reason: x.concession.reason, by: x.concession.created_by, at: x.concession.created_at } } : {}) } : r; }); } // 15.256
  rows.sort((a, b) => stockCompare(a.item, b.item) || stockCompare(a.first_date, b.first_date) || stockCompare(a.lot, b.lot));
  return { asof, rows: rows.slice(0, 2000), more: truncated || rows.length > 2000 };
}
route('GET', '/api/inventory/movements', async ({ query }) => {
  const item = reqStr(query.item, '품목명', 200), unit = str(query.unit, 20); const asof = stockAsOf(query.asof);
  const bySpec = query.spec !== undefined;
  const sources = await readStockSources(`SELECT * FROM movements WHERE item=? AND unit=? ${bySpec ? 'AND spec=?' : ''} AND d<=? ORDER BY d DESC,src,ref DESC LIMIT 201`,bySpec ? [item,unit,str(query.spec,100),asof] : [item,unit,asof]);
  const rows = sources.flat().sort((a,b)=>stockCompare(b.d,a.d)||stockCompare(a.src,b.src)||b.ref-a.ref).slice(0,201);
  return { rows: rows.slice(0, 200).map(r => ({ ...r, qty: stockRound(r.qty) })), more: rows.length > 200, stock: await stockQuantity(item, unit, bySpec ? str(query.spec, 100) : null, asof) };
});
// Opening stock, stock counts and corrections: logistics lead or admin only, append-only.
route('POST', '/api/inventory/adjustments', async ({ user, body }) => {
  if (!canAdjustStock(user)) throw new HttpError(403, '재고 조정은 물류팀장 또는 관리자만 할 수 있습니다.');
  const item = reqStr(body.item, '품목명', 200), spec = str(body.spec, 100), unit = str(body.unit, 20);
  const kind = String(body.kind || ''); if (!['opening', 'count', 'adjust'].includes(kind)) throw bad('조정 종류를 선택하세요.');
  const date = dateStr(body.adj_date || today(), '기준일'); if (date > today()) throw bad('기준일은 오늘 이전으로 선택하세요.');
  const reason = reqStr(body.reason, '사유', 500);
  const lot = str(body.lot, 100); let warehouse = lot ? str(body.warehouse, 50) : '', location = warehouse ? str(body.location, 50) : ''; // 15.265
  if (lot && !warehouse) { const at = new Set((await inventoryPlaces({ asof: date, q: lot })).rows.filter(r => r.item === item.trim() && r.lot === lot && r.qty > 0).map(r => (r.warehouse || '') + '\u0001' + (r.location || ''))); if (at.size === 1 && ![...at][0].startsWith('\u0001')) [warehouse, location] = [...at][0].split('\u0001'); } // 한 곳에만 있으면 그 위치로
  const key = body.request_id === undefined ? randomHex(16) : String(body.request_id);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw bad('요청 번호를 확인하세요.');
  const old = await db.prepare('SELECT * FROM stock_adjustments WHERE request_id=?').get(key);
  if (old) { if (old.created_by_id !== user.id || old.item !== item || old.unit !== unit || old.spec !== spec || old.kind !== kind) throw new HttpError(409, '이미 사용된 요청 번호입니다.'); return old; }
  let qty, counted = null;
  if (kind === 'count') {
    // A stock count records the difference between what was counted and what the records say on that date.
    counted = num(body.counted_qty, '실사 수량');
    if (lot) { // 15.265 LOT(위치) 실사: 그 LOT·위치 잔량과의 차이
      const now = warehouse ? stockRound((await inventoryPlaces({ asof: date, q: lot })).rows.filter(r => r.item === item.trim() && r.lot === lot && r.warehouse === warehouse && (r.location || '') === location).reduce((t, r) => t + r.qty, 0))
        : ((await lotStockReport({ q: lot, asof: date })).rows.find(r => r.item === item.trim() && r.lot === lot)?.balance ?? 0);
      qty = stockRound(counted - now);
    } else qty = stockRound(counted - await stockQuantity(item, unit, body.spec === undefined || body.by_item ? null : spec, date));
    if (qty === 0) throw bad('센 수량이 장부와 같습니다. 조정할 것이 없습니다.');
  } else {
    qty = Number(body.qty); if (body.qty === '' || body.qty == null || !Number.isFinite(qty) || qty === 0) throw bad('조정 수량을 입력하세요. (감소는 음수)');
    if (kind === 'opening' && qty < 0) throw bad('기초재고는 0보다 커야 합니다.');
  }
  let r; try { r = await db.prepare('INSERT INTO stock_adjustments(adj_date,item,spec,unit,qty,kind,counted_qty,reason,request_id,created_by_id,created_by,lot,warehouse,location) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(date, item, spec, unit, qty, kind, counted, reason, key, user.id, user.name, lot, warehouse, location); }
  catch (error) { if (/UNIQUE/i.test(String(error && error.message))) { const again = await db.prepare('SELECT * FROM stock_adjustments WHERE request_id=?').get(key); if (again && again.created_by_id === user.id) return again; throw new HttpError(409, '이미 사용된 요청 번호입니다.'); } throw error; } // 15.209
  return db.prepare('SELECT * FROM stock_adjustments WHERE id=?').get(r.lastInsertRowid);
});
// 15.262 구매 재고현황: 품목별 최근 매입 단가(발주·매입전표 중 최근)와 입고 예정(아직 안 받은 발주 잔량). 구매 담당·관리자만.
route('GET', '/api/purchase/stock-extra', async ({ user }) => {
  if (!hasRole(user, 'purchase')) throw new HttpError(403, '구매 재고현황은 구매 담당만 볼 수 있습니다.');
  const prices = await db.prepare(`SELECT item, unit, unit_price AS price, vendor, d FROM (
      SELECT TRIM(item) AS item, TRIM(unit) AS unit, unit_price, vendor, COALESCE(NULLIF(substr(recv_at,1,10),''), due_date, substr(created_at,1,10)) AS d, id FROM purchase_orders WHERE unit_price IS NOT NULL AND unit_price>0 AND recv_status<>'rejected'
    ) ORDER BY d DESC, id DESC LIMIT 20000`).all();
  const latest = new Map(); for (const r of prices) { const k = nameKey(r.item) + '\u0000' + (r.unit || ''); if (!latest.has(k)) latest.set(k, r); const k2 = nameKey(r.item) + '\u0000*'; if (!latest.has(k2)) latest.set(k2, r); }
  // 15.263 재고금액 단가는 매입전표 단가(확정 전표의 살아 있는 줄 중 가장 최근)
  const bills = await db.prepare(`SELECT TRIM(l.item) AS item, TRIM(l.unit) AS unit, l.unit_price AS price, b.vendor, b.bill_date AS d, b.bill_no FROM purchase_bill_lines l JOIN purchase_bills b ON b.id=l.bill_id
      WHERE b.status='confirmed' AND l.active=1 AND l.unit_price IS NOT NULL AND l.unit_price>0 AND l.qty>0 ORDER BY b.bill_date DESC, b.id DESC, l.id DESC LIMIT 20000`).all();
  const billLatest = new Map(); for (const r of bills) { const k = nameKey(r.item) + '\u0000' + (r.unit || ''); if (!billLatest.has(k)) billLatest.set(k, r); const k2 = nameKey(r.item) + '\u0000*'; if (!billLatest.has(k2)) billLatest.set(k2, r); }
  const open = await db.prepare(`SELECT id, req_no, TRIM(item) AS item, TRIM(unit) AS unit, spec, vendor, item_category, product_code, qty, COALESCE(recv_qty,0) AS received, due_date, recv_status, unit_price, substr(created_at,1,10) AS ordered
      FROM purchase_orders WHERE (recv_status IN ('','checking') OR (recv_status='mismatch' AND COALESCE(recv_qty,0) < qty)) ORDER BY due_date IS NULL, due_date, id LIMIT 5000`).all();
  return { bill_prices: [...billLatest.entries()].map(([k, r]) => ({ key: k, item: r.item, unit: r.unit, price: r.price, vendor: r.vendor, date: r.d, bill_no: r.bill_no })),
    prices: [...latest.entries()].map(([k, r]) => ({ key: k, item: r.item, unit: r.unit, price: r.price, vendor: r.vendor, date: r.d })),
    incoming: open.map(r => ({ ...r, left: stockRound(Math.max(0, r.qty - r.received)), partial: r.received > 0 })).filter(r => r.left > 0) };
});
route('PUT', '/api/inventory/levels', async ({ user, body }) => {
  if (!canAdjustStock(user) && !hasRole(user, 'purchase')) throw new HttpError(403, '안전재고 기준은 구매 담당·물류팀장·관리자만 정할 수 있습니다.'); // 15.262 구매 재고현황
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

// ── 15.113 엑셀 올리기: 거래처·품목을 여러 줄 한 번에. dry_run이면 줄마다 검사만 하고, 아니면 오류가 하나도 없을 때만 한 묶음으로 넣는다. ──
// 이미 있는 이름·코드, 파일 안에서 겹치는 이름·코드는 그 줄 오류. 넣기는 db.batch(하나라도 실패하면 아무것도 안 들어감).
const IMPORT_MAX = 500;
function importRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw bad('올릴 줄이 없습니다.');
  if (rows.length > IMPORT_MAX) throw bad(`한 번에 ${IMPORT_MAX}줄까지 올릴 수 있습니다. 나눠서 올리세요.`);
  return rows.map(r => (r && typeof r === 'object' && !Array.isArray(r) ? r : {}));
}
const importFlag = v => (v === true || v === 1 || /^(1|y|yes|o|true|예|사용|매입|매출|○|v)$/i.test(String(v ?? '').trim()) ? 1 : 0);
async function importFinish(body, results, cmds, label) {
  const errors = results.filter(r => r.error);
  if (body.dry_run || errors.length) return { dry_run: !!body.dry_run, total: results.length, ok: results.length - errors.length, errors: errors.slice(0, 500), rows: results };
  try { await db.batch(cmds); }
  catch (error) { if (/UNIQUE/i.test(String(error && error.message))) throw new HttpError(409, `그 사이 같은 이름이나 코드의 ${label}이(가) 등록되었습니다. 다시 검사하세요.`); throw error; }
  return { dry_run: false, total: results.length, ok: results.length, errors: [], inserted: results.length };
}
route('POST', '/api/import/vendors', async ({ user, body }) => {
  if (!hasRole(user, 'purchase') && !hasRole(user, 'sales')) throw new HttpError(403, '거래처 엑셀 올리기는 구매·영업 담당자나 관리자가 합니다.');
  const rows = importRows(body.rows);
  const have = await db.prepare('SELECT name_key, code FROM vendors').all();
  const names = new Set(have.map(v => v.name_key)), codes = new Set(have.map(v => v.code).filter(Boolean));
  const seenName = new Map(), seenCode = new Map(), results = [], cmds = [];
  rows.forEach((r, i) => {
    try {
      const name = reqStr(r.name, '거래처 이름', 100), key = nameKey(name), code = vendorCode(r.code);
      if (names.has(key)) throw bad('이미 등록된 거래처입니다.');
      if (seenName.has(key)) throw bad(`${seenName.get(key)}번째 줄과 이름이 겹칩니다.`);
      if (code && codes.has(code)) throw bad(`거래처코드 ${code}는 이미 쓰고 있습니다.`);
      if (code && seenCode.has(code)) throw bad(`${seenCode.get(code)}번째 줄과 코드가 겹칩니다.`);
      seenName.set(key, i + 1); if (code) seenCode.set(code, i + 1);
      const v = { biz_no: bizNoField(r.biz_no), biz_name: str(r.biz_name, 100), ceo: str(r.ceo, 50), address: str(r.address, 200), biz_type: str(r.biz_type, 100), biz_item: str(r.biz_item, 100), tax_email: taxEmail(r.tax_email, '세금계산서 이메일'), tax_email2: taxEmail(r.tax_email2, '세금계산서 이메일 2') };
      const purchase = importFlag(r.is_purchase), sales = importFlag(r.is_sales);
      cmds.push({ sql: `INSERT INTO vendors(name,name_key,contact_name,phone,created_by,is_purchase,is_sales,freight_terms,code,${TAX_VENDOR_FIELDS.join(',')}) VALUES(?,?,?,?,?,?,?,'[]',${code ? '?' : VENDOR_AUTO_CODE},${TAX_VENDOR_FIELDS.map(() => '?').join(',')})`,
        args: [name, key, str(r.contact_name, 50), str(r.phone, 30), user.name, purchase, sales, ...(code ? [code] : []), ...TAX_VENDOR_FIELDS.map(k => v[k] ?? (k === 'tax_reverse' ? 0 : ''))] });
      results.push({ row: i + 1, name, code: code || '(자동)', is_purchase: purchase, is_sales: sales, biz_no: v.biz_no });
    } catch (error) { if (!(error instanceof HttpError)) throw error; results.push({ row: i + 1, name: String(r.name ?? ''), error: error.message }); }
  });
  return importFinish(body, results, cmds, '거래처');
});
route('POST', '/api/import/items', async ({ user, body }) => {
  requireAdmin(user);
  const rows = importRows(body.rows);
  const have = await db.prepare('SELECT * FROM boms').all();
  const names = new Set(have.map(b => nameKey(b.product))), codes = new Set(have.map(b => String(b.product_code || '').toUpperCase()).filter(Boolean));
  // 15.195 일괄 수정: 「이미 있는 품목코드는 고치기」를 켜면 같은 코드(대소문자 무시) 품목의 품목명·분류(그리고 값이 있는 단위·규격·세부 분류·비고)를 바꾼다.
  const updateMode = body.update_existing === true || body.update_existing === 1 || body.update_existing === '1';
  const byCode = new Map(have.filter(b => b.product_code).map(b => [String(b.product_code).toUpperCase(), b])), nameOwner = new Map(have.map(b => [nameKey(b.product), b.id]));
  let added = 0, updated = 0;
  const seenName = new Map(), seenCode = new Map(), results = [], cmds = [];
  for (const [i, r] of rows.entries()) {
    try {
      // 15.194 CSV·엑셀 일괄 등록: 품목코드·품목명·분류만 있어도 된다(단위를 비우면 EA). 제품도 구성자재 없이 먼저 등록하고 BOM은 나중에 수정에서 넣는다.
      const category = String(r.item_category ?? '').trim();
      if (!category) throw bad(`분류를 넣으세요(${ITEM_CATEGORIES.join('·')}).`);
      if (!ITEM_CATEGORIES.includes(category)) throw bad(`분류 「${category}」는 없습니다. ${ITEM_CATEGORIES.join('·')} 중 하나로 넣으세요.`);
      const before = updateMode ? byCode.get(String(r.product_code ?? '').trim().toUpperCase()) : null;
      if (before) {
        const product = reqStr(r.product, '품목명', 200), key = nameKey(product), code = before.product_code;
        if (nameOwner.has(key) && nameOwner.get(key) !== before.id) throw bad(`품목명 「${product}」는 다른 품목에서 쓰고 있습니다.`);
        if (seenName.has(key)) throw bad(`${seenName.get(key)}번째 줄과 품목명이 겹칩니다.`);
        if (seenCode.has(code.toUpperCase())) throw bad(`${seenCode.get(code.toUpperCase())}번째 줄과 제품코드가 겹칩니다.`);
        const given = k => String(r[k] ?? '').trim();
        const unit = given('unit') ? str(r.unit, 20) : before.unit, spec = given('spec') ? str(r.spec, 100) : before.spec || '', note = given('note') ? str(r.note, 500) : before.note || '';
        const catsGiven = ['cat1', 'cat2', 'cat3'].some(given), sameClass = category === before.item_category;
        const place = { ...(catsGiven ? { cat1: str(r.cat1, 50), cat2: str(r.cat2, 50), cat3: str(r.cat3, 50) } : sameClass ? {} : { cat1: '', cat2: '', cat3: '' }) };
        const { cats, semiType } = await bomPlacement(place, category, before, unit);
        const next = { product, item_category: category, unit, spec, note, cat1: cats[0], cat2: cats[1], cat3: cats[2] };
        const changed = Object.keys(next).filter(k => String(next[k] ?? '') !== String(before[k] ?? ''));
        seenName.set(key, i + 1); seenCode.set(code.toUpperCase(), i + 1);
        if (changed.length) {
          const LABEL = { product: '품목명', item_category: '분류', unit: '단위', spec: '규격', note: '비고', cat1: '1차 분류', cat2: '2차 분류', cat3: '3차 분류' };
          cmds.push({ sql: "UPDATE boms SET product=?,item_category=?,kind=?,unit=?,spec=?,note=?,cat1=?,cat2=?,cat3=?,semi_type=?,is_temp=0,updated_at=datetime('now','+9 hours') WHERE id=?", args: [product, category, category === '반제품' ? 'semi' : before.kind === 'semi' && category !== '반제품' ? 'finished' : before.kind, unit, spec, note, ...cats, category === '반제품' || before.semi_type ? semiType || before.semi_type || '' : '', before.id] });
          if (product !== before.product) cmds.push(...await bomFollowRename(before, product, code));
          updated++;
          results.push({ row: i + 1, action: 'update', product, product_code: code, item_category: category, note: changed.map(k => `${LABEL[k]} ${before[k] || '(빈칸)'} → ${next[k] || '(빈칸)'}`).join(' · ') });
        } else results.push({ row: i + 1, action: 'same', product, product_code: code, item_category: category });
        continue;
      }
      const body1 = { product: r.product, product_code: r.product_code, item_category: category === '제품' ? '상품' : category, kind: category === '반제품' ? 'semi' : 'finished', base_qty: 1, unit: String(r.unit ?? '').trim() || 'EA', materials: [], note: r.note, cat1: str(r.cat1, 50), cat2: str(r.cat2, 50), cat3: str(r.cat3, 50) };
      const fields = bomFields(body1); fields[8] = category; body1.item_category = category; // 제품은 구성자재 검사만 건너뛴다
      const { cats } = await bomPlacement(body1, fields[8], {}, fields[4]);
      const key = nameKey(fields[0]), code = fields[1].toUpperCase();
      if (/^TMP-/i.test(code)) throw bad('임시 코드(TMP-)는 쓸 수 없습니다.');
      if (names.has(key)) throw bad('같은 이름의 품목이 이미 있습니다.');
      if (seenName.has(key)) throw bad(`${seenName.get(key)}번째 줄과 품목명이 겹칩니다.`);
      if (code && codes.has(code)) throw bad(`제품코드 ${fields[1]}는 이미 쓰고 있습니다.${updateMode ? '' : ' 고치려면 「이미 있는 품목코드는 고치기」를 켜세요.'}`);
      if (code && seenCode.has(code)) throw bad(`${seenCode.get(code)}번째 줄과 제품코드가 겹칩니다.`);
      seenName.set(key, i + 1); if (code) seenCode.set(code, i + 1);
      const spec = str(r.spec, 100);
      cmds.push({ sql: 'INSERT INTO boms(product,product_code,kind,base_qty,unit,materials,note,active,item_category,created_by,cat1,cat2,cat3,semi_type,semi_unit,pack_qty,spec) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', args: [...fields, user.name, ...cats, '', '', null, spec] });
      added++; results.push({ row: i + 1, action: 'add', product: fields[0], product_code: fields[1], item_category: category, unit: fields[4], spec });
    } catch (error) { if (!(error instanceof HttpError)) throw error; results.push({ row: i + 1, product: String(r.product ?? ''), error: error.message }); }
  }
  if (!body.dry_run && !cmds.length && !results.some(r => r.error)) return { dry_run: false, total: results.length, ok: results.length, errors: [], inserted: 0, added: 0, updated: 0, rows: results };
  return { ...await importFinish(body, results, cmds, '품목'), added, updated };
});

// ── 15.120 부서별 리포트: 위 = 공통, 아래 = 부서(영업·구매·생산·품질·개발·물류). 모든 직원이 본다. ──
// 응답 모양(화면 공통 렌더러): { kpis:[{label,value,detail,href,tone}], charts:[{title,series:[{key,label}],rows:[{bucket,..}],kind}], tables:[{title,columns:[{label,type}],rows:[[..]],href,empty}] }
// 기준값(설정 report_thresholds, 관리자가 리포트 화면에서 바꿈)
const REPORT_THRESHOLDS = { ar_overdue_days: 90, old_lot_days: 90, due_grace_days: 0, plan_late_days: 0, dev_long_days: 30 };
const REPORT_THRESHOLD_LABEL = { ar_overdue_days: '미수·미지급 경과 기준(일)', old_lot_days: '오래된 LOT 기준(입고 후 일)', due_grace_days: '납기 준수 허용(납기일 + 일)', plan_late_days: '생산 지연 판단(계획일 + 일)', dev_long_days: '오래 걸린 의뢰 기준(일)' };
async function reportThresholds() { let v = {}; try { v = JSON.parse(await getSetting('report_thresholds') || '{}'); } catch { v = {}; } return Object.fromEntries(Object.entries(REPORT_THRESHOLDS).map(([k, d]) => [k, Number.isFinite(Number(v[k])) && v[k] !== '' && v[k] !== null ? Number(v[k]) : d])); }
route('GET', '/api/report-settings', async () => ({ values: await reportThresholds(), labels: REPORT_THRESHOLD_LABEL, defaults: REPORT_THRESHOLDS }));
route('PUT', '/api/report-settings', async ({ user, body }) => {
  requireAdmin(user);
  const v = {};
  for (const k of Object.keys(REPORT_THRESHOLDS)) { const n = Number(body[k]); if (!Number.isInteger(n) || n < 0 || n > 3650) throw bad(`${REPORT_THRESHOLD_LABEL[k]}은(는) 0~3650 사이 정수로 넣으세요.`); v[k] = n; }
  await db.prepare("INSERT INTO settings(key,value) VALUES('report_thresholds',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(v));
  return { values: v };
});
const rb = (col, grain) => grain === 'month' ? `strftime('%Y-%m-01',${col})` : grain === 'week' ? `date(${col},'-' || ((CAST(strftime('%w',${col}) AS INTEGER)+6)%7) || ' days')` : `date(${col})`;
function rbDates(from, to, grain) {
  const d = new Date(from + 'T00:00:00Z'), last = new Date(to + 'T00:00:00Z'), out = [];
  if (grain === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); if (grain === 'month') d.setUTCDate(1);
  while (d <= last && out.length < 800) { out.push(d.toISOString().slice(0, 10)); if (grain === 'month') d.setUTCMonth(d.getUTCMonth() + 1); else d.setUTCDate(d.getUTCDate() + (grain === 'week' ? 7 : 1)); }
  return out;
}
const rpct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;
const rdays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// 줄 [{bucket, key, value}] → 차트 행
function rSeries(buckets, rows, keys) { const m = new Map(buckets.map(b => [b, Object.fromEntries(keys.map(k => [k, 0]))])); for (const r of rows) { const g = m.get(r.bucket); if (g && r.key in g) g[r.key] += Number(r.value) || 0; } return buckets.map(b => ({ bucket: b, ...m.get(b) })); }
const SECTIONS = ['common', 'sales', 'purchase', 'production', 'quality', 'dev', 'logistics'];
route('GET', '/api/reports/dept', async ({ query }) => {
  const section = SECTIONS.includes(query.section) ? query.section : null; if (!section) throw bad('리포트 구분을 확인하세요.');
  const to = query.to ? dateStr(query.to, '종료일') : today(), from = query.from ? dateStr(query.from, '시작일') : to.slice(0, 8) + '01';
  if (from > to) throw bad('시작일이 종료일보다 늦습니다.');
  if (Date.parse(to) - Date.parse(from) > 3 * 366 * 864e5) throw bad('기간은 3년까지 볼 수 있습니다.');
  const grain = ['day', 'week', 'month'].includes(query.grain) ? query.grain : 'month';
  const t = await reportThresholds(), now = today(), buckets = rbDates(from, to, grain);
  const out = await DEPT[section]({ from, to, grain, t, now, buckets });
  return { section, from, to, grain, thresholds: t, ...out };
});
const DEPT = {
  async common({ from, to, grain, t, now, buckets }) {
    const sales = await db.prepare(`SELECT ${rb('bill_date', grain)} AS bucket, 'sale' AS key, SUM(supply_total) AS value FROM sales_bills WHERE status='confirmed' AND bill_date BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const buys = await db.prepare(`SELECT ${rb('bill_date', grain)} AS bucket, 'buy' AS key, SUM(supply_total) AS value FROM purchase_bills WHERE status='confirmed' AND bill_date BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const sale = sales.reduce((s, r) => s + r.value, 0), buy = buys.reduce((s, r) => s + r.value, 0);
    const plan = await db.prepare(`SELECT COALESCE(SUM(s.qty),0) AS plan, COALESCE(SUM((SELECT COALESCE(SUM(a.qty),0) FROM production_actuals a WHERE a.schedule_id=s.id AND a.voided_at IS NULL)),0) AS act FROM schedules s WHERE s.kind='finished' AND s.period='day' AND s.start_date BETWEEN ? AND ?`).get(from, to > now ? now : to);
    const alerts = await stockAlerts();
    const counts = async sql => (await db.prepare(sql).get()).c;
    const ins = await db.prepare(`SELECT ${rb('d', grain)} AS bucket, 'in' AS key, COUNT(*) AS value FROM (SELECT received_date AS d FROM po_receipt_lots WHERE voided_at IS NULL UNION ALL SELECT received_date FROM other_receipts) WHERE d BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const outs = await db.prepare(`SELECT ${rb('ship_date', grain)} AS bucket, 'out' AS key, COUNT(*) AS value FROM shipments WHERE ship_date BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const prods = await db.prepare(`SELECT ${rb('production_date', grain)} AS bucket, 'prod' AS key, COUNT(*) AS value FROM production_actuals WHERE voided_at IS NULL AND production_date BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const waits = [
      ['영업', '출하 대기 출하지시', await counts("SELECT COUNT(*) c FROM ship_instructions WHERE status='pending'"), '#/logistics/ship-orders'],
      ['구매', '결재 대기 구매의뢰', await counts("SELECT COUNT(*) c FROM purchase_requests WHERE status='pending'"), '#/sales/pr'],
      ['구매', '미입고 발주', await counts("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status IN ('','checking')"), '#/purchase/po'],
      ['물류', '입고 수량 수정 요청', await counts("SELECT COUNT(*) c FROM receipt_qty_changes WHERE status='pending'"), '#/logistics/receive'],
      ['생산', '미출고 생산의뢰', await counts('SELECT COUNT(*) c FROM production_requests WHERE shipped=0'), '#/prod/orders'],
      ['품질', '판정 대기 검사', await counts("SELECT COUNT(*) c FROM requests r WHERE r.type='analysis' AND r.status NOT IN ('done','rejected') AND NOT EXISTS(SELECT 1 FROM inspection_measurements m WHERE m.request_id=r.id AND m.result IN ('pass','fail'))"), '#/quality/inspections'],
      ['품질', '처리 중 VOC', await counts("SELECT COUNT(*) c FROM requests WHERE type='voc' AND status NOT IN ('done','rejected')"), '#/quality/voc/list'],
      ['개발', '진행 중 개발의뢰', await counts("SELECT COUNT(*) c FROM requests WHERE type='development' AND status NOT IN ('done','rejected')"), '#/dev/list'],
    ];
    return {
      kpis: [
        { label: '매출액(공급가액)', value: sale, type: 'won', detail: `확정 매출전표 ${from} ~ ${to}`, href: '#/sales/bills' },
        { label: '매입액(공급가액)', value: buy, type: 'won', detail: '확정 매입전표', href: '#/purchase/bills' },
        { label: '완제품 생산 달성률', value: rpct(plan.act, plan.plan), type: 'pct', detail: `실적 ${Math.round(plan.act)} / 계획 ${Math.round(plan.plan)} (일간 계획, 오늘까지)`, href: '#/prod/finished', tone: plan.plan && plan.act / plan.plan < 0.9 ? 'warn' : '' },
        { label: '안전재고 미달', value: alerts.low, type: 'count', unit: '품목', detail: alerts.negative ? `재고 음수 ${alerts.negative}품목` : '재고 현황 기준(오늘)', href: '#/logistics/stock', tone: alerts.low ? 'warn' : '' },
      ],
      charts: [
        { title: '매출 · 매입 금액(공급가액)', type: 'won', series: [{ key: 'sale', label: '매출' }, { key: 'buy', label: '매입' }], rows: rSeries(buckets, [...sales, ...buys], ['sale', 'buy']) },
        { title: '입고 · 생산실적 · 출하 건수', type: 'count', series: [{ key: 'in', label: '입고 줄' }, { key: 'prod', label: '생산실적' }, { key: 'out', label: '출하' }], rows: rSeries(buckets, [...ins, ...prods, ...outs], ['in', 'prod', 'out']) },
      ],
      tables: [{ title: '부서별 처리 대기(지금)', columns: [{ label: '부서' }, { label: '일' }, { label: '건수', type: 'count' }], rows: waits.map(w => [w[0], w[1], w[2]]), links: waits.map(w => w[3]) }],
    };
  },
  async sales({ from, to, grain, t, now, buckets }) {
    const cat = `CASE ${LINE_CAT('l')} WHEN '제품' THEN 'prod' WHEN '상품' THEN 'goods' ELSE 'etc' END`;
    const lines = await db.prepare(`SELECT ${rb('b.bill_date', grain)} AS bucket, ${cat} AS key, SUM(l.supply) AS value FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id WHERE b.status='confirmed' AND l.active=1 AND b.bill_date BETWEEN ? AND ? GROUP BY 1, 2`).all(from, to);
    const by = k => lines.filter(r => r.key === k).reduce((s, r) => s + r.value, 0);
    const total = by('prod') + by('goods') + by('etc');
    const open = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM((ol.qty - ${ORDER_TAKEN}) * COALESCE(ol.unit_price,0)),0) AS amt FROM sales_order_lines ol JOIN sales_orders o ON o.id=ol.order_id WHERE o.status='open' AND ol.qty - ${ORDER_TAKEN} > 0.000001`).get();
    const ag = await agingData('sales', now), ar = ag.rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
    const over = ag.rows.reduce((s, r) => s + agedOver(r, t.ar_overdue_days, now), 0);
    const orders = await db.prepare(`SELECT ${rb('o.order_date', grain)} AS bucket, 'order' AS key, SUM(ol.qty * COALESCE(ol.unit_price,0)) AS value FROM sales_order_lines ol JOIN sales_orders o ON o.id=ol.order_id WHERE o.status<>'cancelled' AND o.order_date BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const billed = lines.map(r => ({ ...r, key: 'bill' }));
    const top = await db.prepare(`SELECT MIN(b.customer) AS name, SUM(l.supply) AS amt, COUNT(DISTINCT b.id) AS bills FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id WHERE b.status='confirmed' AND l.active=1 AND b.bill_date BETWEEN ? AND ? GROUP BY ${customerKey('b.customer')} ORDER BY amt DESC LIMIT 10`).all(from, to);
    const items = await db.prepare(`SELECT MIN(l.item) AS item, ${LINE_CAT('l')} AS cat, SUM(l.qty) AS qty, MIN(l.unit) AS unit, SUM(l.supply) AS amt FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id WHERE b.status='confirmed' AND l.active=1 AND b.bill_date BETWEEN ? AND ? GROUP BY CASE WHEN l.product_code<>'' THEN UPPER(l.product_code) ELSE l.item END ORDER BY amt DESC LIMIT 10`).all(from, to);
    return {
      kpis: [
        { label: '매출액(공급가액)', value: total, type: 'won', detail: `제품 ${won0(by('prod'))} · 상품 ${won0(by('goods'))}${by('etc') ? ` · 기타 ${won0(by('etc'))}` : ''}`, href: '#/sales/bills' },
        { label: '수주 잔량(미출하)', value: open.amt, type: 'won', detail: `열린 수주 ${open.n}줄 · 단가 기준`, href: '#/sales/orders' },
        { label: '미수 잔액(오늘)', value: ar, type: 'won', detail: `거래처 ${ag.rows.filter(r => r.balance > 0).length}곳`, href: '#/sales/aging' },
        { label: `${t.ar_overdue_days}일 넘은 미수`, value: over, type: 'won', detail: '전표 일자 기준 · 입금은 오래된 것부터', href: '#/sales/aging', tone: over ? 'bad' : '' },
      ],
      charts: [
        { title: '매출 추이(분류별 공급가액)', type: 'won', stacked: true, series: [{ key: 'prod', label: '제품' }, { key: 'goods', label: '상품' }, { key: 'etc', label: '기타·미분류' }], rows: rSeries(buckets, lines, ['prod', 'goods', 'etc']) },
        { title: '수주 금액 · 매출 금액', type: 'won', series: [{ key: 'order', label: '수주' }, { key: 'bill', label: '매출' }], rows: rSeries(buckets, [...orders, ...billed], ['order', 'bill']) },
      ],
      tables: [
        { title: '거래처별 매출 TOP 10', columns: [{ label: '거래처' }, { label: '전표', type: 'count' }, { label: '공급가액', type: 'won' }, { label: '비중', type: 'pct' }], rows: top.map(r => [r.name, r.bills, r.amt, rpct(r.amt, total)]) },
        { title: '품목별 매출 TOP 10', columns: [{ label: '품목' }, { label: '분류' }, { label: '수량', type: 'num' }, { label: '단위' }, { label: '공급가액', type: 'won' }], rows: items.map(r => [r.item, r.cat || '미분류', r.qty, r.unit, r.amt]) },
      ],
    };
  },
  async purchase({ from, to, grain, t, now, buckets }) {
    const cat = `CASE ${LINE_CAT('l')} WHEN '원자재' THEN 'raw' WHEN '부자재' THEN 'sub' WHEN '임가공' THEN 'proc' ELSE 'etc' END`;
    const lines = await db.prepare(`SELECT ${rb('b.bill_date', grain)} AS bucket, ${cat} AS key, SUM(l.supply) AS value FROM purchase_bill_lines l JOIN purchase_bills b ON b.id=l.bill_id WHERE b.status='confirmed' AND l.active=1 AND b.bill_date BETWEEN ? AND ? GROUP BY 1, 2`).all(from, to);
    const by = k => lines.filter(r => r.key === k).reduce((s, r) => s + r.value, 0), total = ['raw', 'sub', 'proc', 'etc'].reduce((s, k) => s + by(k), 0);
    const open = await db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS late FROM purchase_orders WHERE recv_status IN ('','checking')").get(now);
    const ag = await agingData('purchase', now), ap = ag.rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
    // 납기 준수: 납기가 기간 안인 발주 중 받은 것 — 첫 입고일 ≤ 납기 + 허용일
    const firstIn = "COALESCE((SELECT MIN(l.received_date) FROM po_receipt_lots l WHERE l.po_id=p.id AND l.voided_at IS NULL), substr(p.recv_at,1,10))";
    const due = await db.prepare(`SELECT ${rb('p.due_date', grain)} AS bucket, COUNT(*) AS n, SUM(CASE WHEN ${firstIn} <= date(p.due_date, '+' || ? || ' days') THEN 1 ELSE 0 END) AS ok FROM purchase_orders p WHERE p.due_date BETWEEN ? AND ? AND p.recv_status IN ('ok','mismatch') GROUP BY 1`).all(t.due_grace_days, from, to);
    const dn = due.reduce((s, r) => s + r.n, 0), dok = due.reduce((s, r) => s + r.ok, 0);
    const top = await db.prepare(`SELECT MIN(b.vendor) AS name, SUM(l.supply) AS amt, COUNT(DISTINCT b.id) AS bills FROM purchase_bill_lines l JOIN purchase_bills b ON b.id=l.bill_id WHERE b.status='confirmed' AND l.active=1 AND b.bill_date BETWEEN ? AND ? GROUP BY ${billVendorKey('b.vendor')} ORDER BY amt DESC LIMIT 10`).all(from, to);
    const ups = await db.prepare(`SELECT p.vendor, bm.product, bm.product_code, p.unit_price AS now_price, p.valid_from, (SELECT q.unit_price FROM item_prices q WHERE q.side='purchase' AND q.active=1 AND q.vendor_key=p.vendor_key AND q.bom_id=p.bom_id AND q.valid_from<p.valid_from ORDER BY q.valid_from DESC LIMIT 1) AS before_price FROM item_prices p JOIN boms bm ON bm.id=p.bom_id WHERE p.side='purchase' AND p.active=1 AND p.valid_from BETWEEN ? AND ? ORDER BY p.valid_from DESC LIMIT 200`).all(from, to);
    const rises = ups.filter(r => r.before_price != null && r.now_price > r.before_price).sort((a, b) => (b.now_price / b.before_price) - (a.now_price / a.before_price)).slice(0, 10);
    return {
      kpis: [
        { label: '매입액(공급가액)', value: total, type: 'won', detail: `원자재 ${won0(by('raw'))} · 부자재 ${won0(by('sub'))} · 임가공 ${won0(by('proc'))}`, href: '#/purchase/bills' },
        { label: '미입고 발주', value: open.n, type: 'count', unit: '건', detail: open.late ? `납기 지난 것 ${open.late}건` : '납기 지난 것 없음', href: '#/purchase/po', tone: open.late ? 'warn' : '' },
        { label: '미지급 잔액(오늘)', value: ap, type: 'won', detail: `매입처 ${ag.rows.filter(r => r.balance > 0).length}곳`, href: '#/purchase/aging' },
        { label: '납기 준수율', value: rpct(dok, dn), type: 'pct', detail: `납기 ${from} ~ ${to} 받은 발주 ${dn}건 · 허용 ${t.due_grace_days}일`, href: '#/purchase/po', tone: dn && dok / dn < 0.9 ? 'warn' : '' },
      ],
      charts: [
        { title: '매입 추이(분류별 공급가액)', type: 'won', stacked: true, series: [{ key: 'raw', label: '원자재' }, { key: 'sub', label: '부자재' }, { key: 'proc', label: '임가공' }, { key: 'etc', label: '기타' }], rows: rSeries(buckets, lines, ['raw', 'sub', 'proc', 'etc']) },
        { title: '납기 준수율(%)', type: 'pct', series: [{ key: 'rate', label: '준수율' }], rows: buckets.map(b => { const r = due.find(x => x.bucket === b); return { bucket: b, rate: r ? rpct(r.ok, r.n) : 0 }; }) },
      ],
      tables: [
        { title: '매입처별 매입 TOP 10', columns: [{ label: '매입처' }, { label: '전표', type: 'count' }, { label: '공급가액', type: 'won' }, { label: '비중', type: 'pct' }], rows: top.map(r => [r.name, r.bills, r.amt, rpct(r.amt, total)]) },
        { title: '단가 오른 품목(기간 안 단가표 변경)', columns: [{ label: '매입처' }, { label: '품목' }, { label: '이전', type: 'won' }, { label: '지금', type: 'won' }, { label: '변동', type: 'pct' }, { label: '적용일' }], rows: rises.map(r => [r.vendor, `${r.product}${r.product_code ? ' · ' + r.product_code : ''}`, r.before_price, r.now_price, rpct(r.now_price - r.before_price, r.before_price), r.valid_from]), href: '#/purchase/prices', empty: '기간 안에 오른 단가가 없습니다.' },
      ],
    };
  },
  async production({ from, to, grain, t, now, buckets }) {
    const act = "(SELECT COALESCE(SUM(a.qty),0) FROM production_actuals a WHERE a.schedule_id=s.id AND a.voided_at IS NULL)";
    const end = to > now ? now : to;
    const plans = await db.prepare(`SELECT ${rb('s.start_date', grain)} AS bucket, SUM(s.qty) AS plan, SUM(${act}) AS act FROM schedules s WHERE s.kind='finished' AND s.period='day' AND s.start_date BETWEEN ? AND ? GROUP BY 1`).all(from, end);
    const P = plans.reduce((s, r) => s + r.plan, 0), A = plans.reduce((s, r) => s + r.act, 0);
    const late = (await db.prepare(`SELECT COUNT(*) AS c FROM schedules s WHERE s.period='day' AND s.kind='finished' AND s.done=0 AND s.start_date BETWEEN ? AND ? AND s.start_date < date(?, '-' || ? || ' days') AND ${act} < s.qty`).get(from, to, now, t.plan_late_days)).c;
    const semi = await db.prepare(`SELECT ${rb('work_date', grain)} AS bucket, SUM(qty) AS good, SUM(defect_qty) AS bad FROM semi_records WHERE work_date BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const G = semi.reduce((s, r) => s + r.good, 0), D = semi.reduce((s, r) => s + r.bad, 0);
    const lines = await db.prepare("SELECT unit_name AS name, CASE process WHEN 'cut' THEN '커팅/융착' ELSE '세탁' END AS proc, SUM(qty) AS good, SUM(defect_qty) AS bad, COUNT(*) AS n FROM semi_records WHERE work_date BETWEEN ? AND ? GROUP BY unit_name, process ORDER BY good DESC LIMIT 15").all(from, to);
    const prods = await db.prepare(`SELECT s.product, MIN(s.unit) AS unit, SUM(s.qty) AS plan, SUM(${act}) AS act FROM schedules s WHERE s.kind='finished' AND s.period='day' AND s.start_date BETWEEN ? AND ? GROUP BY s.product ORDER BY (SUM(${act}) * 1.0 / SUM(s.qty)) ASC LIMIT 15`).all(from, end);
    const reasons = await db.prepare("SELECT CASE WHEN defect_reason='' THEN '사유 미입력' ELSE defect_reason END AS reason, SUM(defect_qty) AS bad, COUNT(*) AS n FROM semi_records WHERE work_date BETWEEN ? AND ? AND defect_qty>0 GROUP BY 1 ORDER BY bad DESC LIMIT 10").all(from, to);
    return {
      kpis: [
        { label: '완제품 달성률', value: rpct(A, P), type: 'pct', detail: `실적 ${Math.round(A)} / 계획 ${Math.round(P)} (일간 계획, 오늘까지)`, href: '#/prod/finished', tone: P && A / P < 0.9 ? 'warn' : '' },
        { label: '지연 계획', value: late, type: 'count', unit: '건', detail: `계획일 + ${t.plan_late_days}일 지나도 미완료·실적 부족`, href: '#/prod/finished', tone: late ? 'bad' : '' },
        { label: '반제품 양품', value: G, type: 'num', detail: `커팅/융착·세탁 ${from} ~ ${to}`, href: '#/prod/semi/cut' },
        { label: '반제품 불량률', value: rpct(D, G + D), type: 'pct', detail: `불량 ${Math.round(D)} / 전체 ${Math.round(G + D)}`, href: '#/prod/semi/cut', tone: (G + D) && D / (G + D) > 0.03 ? 'warn' : '' },
      ],
      charts: [
        { title: '완제품 계획 · 실적(수량)', type: 'num', series: [{ key: 'plan', label: '계획' }, { key: 'act', label: '실적' }], rows: buckets.map(b => { const r = plans.find(x => x.bucket === b); return { bucket: b, plan: r?.plan || 0, act: r?.act || 0 }; }) },
        { title: '반제품 양품 · 불량', type: 'num', series: [{ key: 'good', label: '양품' }, { key: 'bad', label: '불량' }], rows: buckets.map(b => { const r = semi.find(x => x.bucket === b); return { bucket: b, good: r?.good || 0, bad: r?.bad || 0 }; }) },
      ],
      tables: [
        { title: '제품별 달성률(낮은 순)', columns: [{ label: '제품' }, { label: '계획', type: 'num' }, { label: '실적', type: 'num' }, { label: '단위' }, { label: '달성률', type: 'pct' }], rows: prods.map(r => [r.product, r.plan, r.act, r.unit || '', rpct(r.act, r.plan)]), href: '#/prod/finished' },
        { title: '라인별 반제품 생산', columns: [{ label: '라인' }, { label: '공정' }, { label: '기록', type: 'count' }, { label: '양품', type: 'num' }, { label: '불량', type: 'num' }, { label: '불량률', type: 'pct' }], rows: lines.map(r => [r.name, r.proc, r.n, r.good, r.bad, rpct(r.bad, r.good + r.bad)]) },
        { title: '불량 사유 순위', columns: [{ label: '사유' }, { label: '기록', type: 'count' }, { label: '불량 수량', type: 'num' }, { label: '비중', type: 'pct' }], rows: reasons.map(r => [r.reason, r.n, r.bad, rpct(r.bad, D)]) },
      ],
    };
  },
  async quality({ from, to, grain, t, now, buckets }) {
    const insp = await db.prepare(`SELECT ${rb('substr(r.created_at,1,10)', grain)} AS bucket, m.result, r.category, r.customer, r.title FROM requests r JOIN inspection_measurements m ON m.request_id=r.id WHERE r.type='analysis' AND m.result IN ('pass','fail') AND substr(r.created_at,1,10) BETWEEN ? AND ?`).all(from, to);
    const incoming = insp.filter(r => r.category === '수입검사'), pass = incoming.filter(r => r.result === 'pass').length;
    const fails = insp.filter(r => r.result === 'fail');
    const voc = await db.prepare(`SELECT ${rb('substr(created_at,1,10)', grain)} AS bucket, status, substr(created_at,1,10) AS d, substr(updated_at,1,10) AS u FROM requests WHERE type='voc' AND substr(created_at,1,10) BETWEEN ? AND ?`).all(from, to);
    const vocOpen = (await db.prepare("SELECT COUNT(*) c FROM requests WHERE type='voc' AND status NOT IN ('done','rejected')").get()).c;
    const ana = await db.prepare("SELECT AVG(julianday(substr(updated_at,1,10)) - julianday(substr(created_at,1,10))) AS days, COUNT(*) AS n FROM requests WHERE type='analysis' AND status='done' AND substr(updated_at,1,10) BETWEEN ? AND ?").get(from, to);
    const vend = new Map(); for (const r of insp) { const k = r.customer || '(거래처 없음)', g = vend.get(k) || { n: 0, f: 0 }; g.n++; if (r.result === 'fail') g.f++; vend.set(k, g); }
    const items = new Map(); for (const r of fails) items.set(r.title, (items.get(r.title) || 0) + 1);
    // 15.310 CAPA·공정 측정·변경·심사(품질 1~4단계)
    const ncs = await db.prepare(`SELECT ${rb('found_date', grain)} AS bucket, CASE WHEN closed_at IS NULL THEN NULL ELSE ${rb('substr(closed_at,1,10)', grain)} END AS cbucket, status, source_type, due_date, closed_at FROM nonconformities WHERE found_date BETWEEN ? AND ? AND status<>'void'`).all(from, to);
    const ncOpen = (await db.prepare("SELECT COUNT(*) c FROM nonconformities WHERE status NOT IN ('closed','void')").get()).c, ncOverdue = (await db.prepare("SELECT COUNT(*) c FROM nonconformities WHERE status NOT IN ('closed','void') AND due_date IS NOT NULL AND due_date<?").get(now)).c;
    const ncClosed = await db.prepare("SELECT due_date, closed_at FROM nonconformities WHERE status='closed' AND substr(closed_at,1,10) BETWEEN ? AND ?").all(from, to);
    const pqcRows = await db.prepare('SELECT p.place, p.item, COUNT(*) AS n, SUM(m.out_of_spec) AS out FROM process_measures m JOIN process_points p ON p.id=m.point_id WHERE m.measured_on BETWEEN ? AND ? GROUP BY p.id HAVING SUM(m.out_of_spec)>0 ORDER BY out DESC, n DESC LIMIT 10').all(from, to);
    const pqcAgg = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(out_of_spec),0) AS o FROM process_measures WHERE measured_on BETWEEN ? AND ?').get(from, to), pqcAll = pqcAgg.n, pqcOut = pqcAgg.o;
    const chg = await db.prepare("SELECT status FROM quality_changes WHERE substr(created_at,1,10) BETWEEN ? AND ? AND status<>'void'").all(from, to);
    const aud = await db.prepare("SELECT COUNT(DISTINCT a.id) AS n, COUNT(f.id) AS f, SUM(CASE WHEN f.grade='major' THEN 1 ELSE 0 END) AS major FROM quality_audits a LEFT JOIN audit_findings f ON f.audit_id=a.id WHERE COALESCE(a.done_date,a.plan_date) BETWEEN ? AND ? AND a.status<>'void'").get(from, to);
    return {
      kpis: [
        { label: '수입검사 합격률', value: rpct(pass, incoming.length), type: 'pct', detail: `판정 ${incoming.length}건 중 합격 ${pass}건`, href: '#/quality/inspections', tone: incoming.length && pass / incoming.length < 0.95 ? 'warn' : '' },
        { label: '불합격 검사', value: fails.length, type: 'count', unit: '건', detail: '수입·출하·공정 검사 전체', href: '#/quality/inspections', tone: fails.length ? 'bad' : '' },
        { label: 'VOC', value: voc.length, type: 'count', unit: '건 접수', detail: `지금 처리 중 ${vocOpen}건`, href: '#/quality/voc/list', tone: vocOpen ? 'warn' : '' },
        { label: '분석 평균 처리', value: ana.n ? Math.round(ana.days * 10) / 10 : null, type: 'num', unit: '일', detail: `완료 ${ana.n}건 · 등록 → 마지막 변경일`, href: '#/quality/list' },
        // 15.310 품질 1~4단계 자료
        { label: 'CAPA 등록', value: ncs.length, type: 'count', unit: '건', detail: `종결 ${ncs.filter(n => n.status === 'closed').length}건 · 지금 진행 중 ${ncOpen}건${ncOverdue ? ` · 기한 지남 ${ncOverdue}건` : ''}`, href: '#/quality/capa', tone: ncOverdue ? 'bad' : ncOpen ? 'warn' : '' },
        { label: 'CAPA 기한 준수율', value: rpct(ncClosed.filter(n => !n.due_date || n.closed_at.slice(0, 10) <= n.due_date).length, ncClosed.length), type: 'pct', detail: `기간 안 종결 ${ncClosed.length}건 기준`, href: '#/quality/capa', tone: ncClosed.length && ncClosed.filter(n => !n.due_date || n.closed_at.slice(0, 10) <= n.due_date).length / ncClosed.length < 0.9 ? 'warn' : '' },
        { label: '공정 기준 이탈', value: pqcOut, type: 'count', unit: '건', detail: `공정·환경 측정 ${pqcAll}건 중`, href: '#/quality/pqc', tone: pqcOut ? 'warn' : '' },
        { label: '변경 · 심사 지적', value: chg.length, type: 'count', unit: '건 변경', detail: `심사 ${aud.n}건 · 지적 ${aud.f}건(중대 ${aud.major})`, href: '#/quality/changes' },
      ],
      charts: [
        { title: '검사 판정(합격 · 불합격)', type: 'count', series: [{ key: 'pass', label: '합격' }, { key: 'fail', label: '불합격' }], rows: rSeries(buckets, insp.map(r => ({ bucket: r.bucket, key: r.result, value: 1 })), ['pass', 'fail']) },
        { title: 'VOC 접수 · 완료', type: 'count', series: [{ key: 'in', label: '접수' }, { key: 'done', label: '완료' }], rows: rSeries(buckets, voc.flatMap(r => [{ bucket: r.bucket, key: 'in', value: 1 }, ...(r.status === 'done' ? [{ bucket: r.bucket, key: 'done', value: 1 }] : [])]), ['in', 'done']) },
        { title: '부적합(CAPA) 등록 · 종결', type: 'count', series: [{ key: 'open', label: '등록' }, { key: 'closed', label: '종결' }], rows: rSeries(buckets, ncs.flatMap(n => [{ bucket: n.bucket, key: 'open', value: 1 }, ...(n.status === 'closed' && n.cbucket ? [{ bucket: n.cbucket, key: 'closed', value: 1 }] : [])]), ['open', 'closed']) },
      ],
      tables: [
        { title: '거래처별 불합격률', columns: [{ label: '거래처' }, { label: '판정', type: 'count' }, { label: '불합격', type: 'count' }, { label: '불합격률', type: 'pct' }], rows: [...vend].sort((a, b) => b[1].f - a[1].f || b[1].n - a[1].n).slice(0, 10).map(([k, g]) => [k, g.n, g.f, rpct(g.f, g.n)]) },
        { title: '불합격 품목 순위', columns: [{ label: '품목·검사' }, { label: '불합격', type: 'count' }], rows: [...items].sort((a, b) => b[1] - a[1]).slice(0, 10), href: '#/quality/inspections', empty: '기간 안에 불합격이 없습니다.' },
        { title: '부적합 출처별(CAPA)', columns: [{ label: '출처' }, { label: '등록', type: 'count' }, { label: '종결', type: 'count' }, { label: '기한 지남', type: 'count' }], rows: Object.entries(NC_SOURCE).map(([k, l]) => { const g = ncs.filter(n => n.source_type === k); return g.length ? [l, g.length, g.filter(n => n.status === 'closed').length, g.filter(n => !['closed', 'void'].includes(n.status) && n.due_date && n.due_date < now).length] : null; }).filter(Boolean), href: '#/quality/capa', empty: '기간 안에 등록된 부적합이 없습니다.' },
        { title: '공정 기준 이탈 항목', columns: [{ label: '공정 · 항목' }, { label: '측정', type: 'count' }, { label: '이탈', type: 'count' }, { label: '이탈률', type: 'pct' }], rows: pqcRows.map(r => [`${r.place} · ${r.item}`, r.n, r.out, rpct(r.out, r.n)]), href: '#/quality/pqc', empty: '기간 안에 공정 측정이 없습니다.' },
      ],
    };
  },
  async dev({ from, to, grain, t, now, buckets }) {
    const rows = await db.prepare(`SELECT id, req_no, title, customer, status, due_date, requester_name, substr(created_at,1,10) AS d, substr(updated_at,1,10) AS u FROM requests WHERE type='development'`).all();
    const inP = rows.filter(r => r.d >= from && r.d <= to), done = rows.filter(r => r.status === 'done' && r.u >= from && r.u <= to);
    const openRows = rows.filter(r => !['done', 'rejected'].includes(r.status));
    const late = openRows.filter(r => r.due_date && r.due_date < now);
    const avg = done.length ? Math.round(done.reduce((s, r) => s + (Date.parse(r.u) - Date.parse(r.d)) / 864e5, 0) / done.length * 10) / 10 : null;
    const age = r => Math.round((Date.parse(now) - Date.parse(r.d)) / 864e5);
    const ST = { pending: '대기', waiting: '승인 대기', progress: '진행', done: '완료', rejected: '반려' };
    return {
      kpis: [
        { label: '개발의뢰 접수', value: inP.length, type: 'count', unit: '건', detail: `${from} ~ ${to}`, href: '#/dev/list' },
        { label: '완료', value: done.length, type: 'count', unit: '건', detail: avg != null ? `평균 ${avg}일(등록 → 마지막 변경)` : '기간 안 완료 없음', href: '#/dev/list' },
        { label: '진행 중', value: openRows.length, type: 'count', unit: '건', detail: `${t.dev_long_days}일 넘은 것 ${openRows.filter(r => age(r) > t.dev_long_days).length}건`, href: '#/dev/list', tone: openRows.some(r => age(r) > t.dev_long_days) ? 'warn' : '' },
        { label: '기한 지난 의뢰', value: late.length, type: 'count', unit: '건', detail: '희망 기한이 오늘 전인데 미완료', href: '#/dev/list', tone: late.length ? 'bad' : '' },
      ],
      charts: [{ title: '개발의뢰 접수 · 완료', type: 'count', series: [{ key: 'in', label: '접수' }, { key: 'done', label: '완료' }], rows: rSeries(buckets, [...inP.map(r => ({ bucket: bucketOf(r.d, grain), key: 'in', value: 1 })), ...done.map(r => ({ bucket: bucketOf(r.u, grain), key: 'done', value: 1 }))], ['in', 'done']) }],
      tables: [
        { title: '진행 중 의뢰(오래된 순)', columns: [{ label: '번호' }, { label: '제목' }, { label: '업체' }, { label: '상태' }, { label: '희망 기한' }, { label: '경과(일)', type: 'count' }], rows: openRows.sort((a, b) => a.d.localeCompare(b.d)).slice(0, 15).map(r => [r.req_no || '', r.title, r.customer || '', ST[r.status] || r.status, r.due_date || '', age(r)]), href: '#/dev/list', empty: '진행 중인 의뢰가 없습니다.' },
        { title: '상태별 건수(전체)', columns: [{ label: '상태' }, { label: '건수', type: 'count' }], rows: Object.entries(ST).map(([k, v]) => [v, rows.filter(r => r.status === k).length]) },
      ],
    };
  },
  async logistics({ from, to, grain, t, now, buckets }) {
    const ins = await db.prepare(`SELECT ${rb('d', grain)} AS bucket, 'in' AS key, COUNT(*) AS value FROM (SELECT received_date AS d FROM po_receipt_lots WHERE voided_at IS NULL UNION ALL SELECT received_date FROM other_receipts) WHERE d BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const outs = await db.prepare(`SELECT ${rb('ship_date', grain)} AS bucket, 'out' AS key, COUNT(*) AS value FROM shipments WHERE ship_date BETWEEN ? AND ? GROUP BY 1`).all(from, to);
    const si = await db.prepare("SELECT COUNT(*) AS n, SUM(held) AS held FROM ship_instructions WHERE status='pending'").get();
    const lead = await db.prepare("SELECT AVG(julianday(substr(processed_at,1,10)) - julianday(substr(created_at,1,10))) AS days, COUNT(*) AS n FROM ship_instructions WHERE status='shipped' AND substr(processed_at,1,10) BETWEEN ? AND ?").get(from, to);
    const alerts = await stockAlerts();
    const lots = (await lotStockReport({ state: 'instock' })).rows.filter(r => r.first_date && r.first_date <= rdays(now, -t.old_lot_days)).sort((a, b) => a.first_date.localeCompare(b.first_date));
    const waiting = await db.prepare("SELECT customer, item, qty, unit, ship_date, held, hold_note, substr(created_at,1,10) AS d FROM ship_instructions WHERE status='pending' ORDER BY ship_date, id LIMIT 15").all();
    const changes = (await db.prepare("SELECT COUNT(*) c FROM receipt_qty_changes WHERE status='pending'").get()).c;
    const n = rows => rows.reduce((s, r) => s + r.value, 0);
    return {
      kpis: [
        { label: '입고 · 출하', value: `${n(ins)} / ${n(outs)}`, type: 'text', detail: `입고 줄 / 출하 건 · ${from} ~ ${to}`, href: '#/logistics/receive' },
        { label: '출하지시 대기', value: si.n || 0, type: 'count', unit: '건', detail: `보류 ${si.held || 0}건 · 처리 평균 ${lead.n ? Math.round(lead.days * 10) / 10 + '일' : '—'}`, href: '#/logistics/ship-orders', tone: si.held ? 'warn' : '' },
        { label: '안전재고 미달', value: alerts.low, type: 'count', unit: '품목', detail: changes ? `입고 수량 수정 요청 ${changes}건` : '재고 현황 기준(오늘)', href: '#/logistics/stock', tone: alerts.low ? 'warn' : '' },
        { label: `${t.old_lot_days}일 넘은 LOT`, value: lots.length, type: 'count', unit: '개', detail: '잔량 있는 LOT · 입고일 기준', href: '#/logistics/stock', tone: lots.length ? 'warn' : '' },
      ],
      charts: [{ title: '입고 줄 · 출하 건수', type: 'count', series: [{ key: 'in', label: '입고' }, { key: 'out', label: '출하' }], rows: rSeries(buckets, [...ins, ...outs], ['in', 'out']) }],
      tables: [
        { title: '출하 대기 출하지시(출하일 순)', columns: [{ label: '출하일' }, { label: '거래처' }, { label: '품목' }, { label: '수량', type: 'num' }, { label: '단위' }, { label: '보류' }], rows: waiting.map(r => [r.ship_date, r.customer, r.item, r.qty, r.unit, r.held ? `보류${r.hold_note ? ' · ' + r.hold_note : ''}` : '']), href: '#/logistics/ship-orders', empty: '대기 중인 출하지시가 없습니다.' },
        { title: `${t.old_lot_days}일 넘은 LOT(오래된 순)`, columns: [{ label: '품목' }, { label: 'LOT' }, { label: '잔량', type: 'num' }, { label: '단위' }, { label: '입고일' }, { label: '위치' }], rows: lots.slice(0, 15).map(r => [r.item, r.lot, r.balance, r.unit, r.first_date, r.places]), href: '#/logistics/stock', empty: '기준을 넘은 LOT가 없습니다.' },
      ],
    };
  },
};
function bucketOf(d, grain) { return grain === 'month' ? d.slice(0, 7) + '-01' : grain === 'week' ? (() => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); })() : d; }
const won0 = n => Math.trunc(Number(n) || 0).toLocaleString('ko-KR');
// 기준일 기준 N일 넘은 미결 금액(연령표 구간에서 계산: 91~180·180일 초과는 그대로, 경계는 기준이 구간 끝과 같을 때 정확)
function agedOver(r, days, now) { return (r.aged || []).filter(x => x.age > days).reduce((s, x) => s + x.left, 0); }

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
    // 건수는 COUNT로 센다(목록 5건만 읽고, 50건 넘어도 배지가 50에서 멈추지 않게).
    const items = await db.prepare(`${actualChangeSelect} WHERE c.status='pending' ORDER BY c.id LIMIT 5`).all();
    const n = await db.prepare("SELECT COUNT(*) c, COALESCE(SUM(s.kind='finished'),0) f, COALESCE(SUM(s.kind='semi'),0) m FROM production_actual_changes c JOIN schedules s ON s.id=c.schedule_id WHERE c.status='pending'").get();
    approvals.actual_changes = { count: n.c, finished: n.f, semi: n.m, items };
  }
  if (user.is_admin || roles.includes('production_approver')) {
    const items = (await db.prepare("SELECT * FROM semi_record_changes WHERE status='pending' ORDER BY id LIMIT 5").all()).map(decodeSemiChange);
    const n = await db.prepare("SELECT COUNT(*) c, COALESCE(SUM(process='cut'),0) cut, COALESCE(SUM(process='wash'),0) wash FROM semi_record_changes WHERE status='pending'").get();
    approvals.semi_changes = { count: n.c, cut: n.cut, wash: n.wash, items };
  }
  if (user.is_admin || roles.includes('logistics_approver')) {
    const items = await db.prepare(`${receiptChangeSelect} WHERE c.status='pending' ORDER BY c.id LIMIT 5`).all();
    approvals.receipt_changes = { count: (await db.prepare("SELECT COUNT(*) c FROM receipt_qty_changes WHERE status='pending'").get()).c, items };
  }
  // 15.92 출하지시: 영업이 수주로 매출전표를 잡아 내려온, 아직 출하 처리하지 않은 지시(물류)
  if (hasRole(user, 'logistics')) { const count = (await db.prepare("SELECT COUNT(*) c FROM ship_instructions WHERE status='pending' AND held=0").get()).c; if (count) approvals.ship_instructions = { count }; }
  // 15.204 완제품 계획 확정 대기(대기 상태·미완료): 생산 담당이 「계획생산 접수·관리」에서 확정해야 실적 입력에 나온다.
  if (hasRole(user, 'production')) { const r = await db.prepare("SELECT COUNT(*) c, MIN(start_date) first FROM schedules WHERE kind='finished' AND confirmed_at='' AND done=0").get(); if (r.c) approvals.plans_waiting = { count: r.c, first: r.first }; }
  if (user.is_admin) approvals.temp_items = { count: (await db.prepare('SELECT COUNT(*) c FROM boms WHERE is_temp=1 AND active=1').get()).c };
  // 생산의뢰: 생산계획에 아직 반영되지 않은 수량이 있는 의뢰(생산 담당·생산팀장·관리자).
  if (hasRole(user, 'production')) {
    const openWhere = `WHERE r.shipped=0 AND EXISTS(SELECT 1 FROM production_request_lines l WHERE l.request_id=r.id AND l.qty > COALESCE((SELECT SUM(s.qty) FROM schedules s WHERE s.production_line_id=l.id),0))`;
    const count = (await db.prepare(`SELECT COUNT(*) c FROM production_requests r ${openWhere}`).get()).c;
    if (count) approvals.production_requests = { count, items: await db.prepare(`SELECT r.id,r.req_no,r.customer,r.order_no,r.ship_text,r.ship_date,r.created_at FROM production_requests r ${openWhere} ORDER BY COALESCE(r.ship_date,'9999'), r.id LIMIT 5`).all() };
  }
  // 구매의뢰: 지금 내 결재 차례인 의뢰서(관리자도 자기 차례만).
  {
    const items = await db.prepare(`SELECT pr.id,pr.doc_no,pr.title,pr.author_name,pr.submitted_at,(SELECT item FROM purchase_request_items i WHERE i.request_id=pr.id ORDER BY line_no LIMIT 1) first_item,(SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id=pr.id) item_count
      FROM purchase_requests pr JOIN purchase_request_lines l ON l.request_id=pr.id AND l.step=pr.current_step AND l.kind!='cc' WHERE pr.status='pending' AND l.user_id=? ORDER BY pr.id LIMIT 5`).all(user.id);
    const count = (await db.prepare("SELECT COUNT(*) c FROM purchase_requests pr JOIN purchase_request_lines l ON l.request_id=pr.id AND l.step=pr.current_step AND l.kind!='cc' WHERE pr.status='pending' AND l.user_id=?").get(user.id)).c;
    if (count) approvals.purchase_requests = { count, items };
  }
  // 발주 대기: 최종 승인됐지만 아직 발주하지 않은 품목이 있는 구매의뢰(구매 담당). 구매 › 발주 입력에서 불러와 발주한다.
  if (hasRole(user, 'purchase')) {
    const count = (await db.prepare("SELECT COUNT(*) c FROM purchase_requests pr WHERE pr.status='approved' AND EXISTS(SELECT 1 FROM purchase_request_items i WHERE i.request_id=pr.id AND i.po_id IS NULL AND i.order_closed='')").get()).c;
    if (count) approvals.purchase_orders_waiting = { count, items: await db.prepare("SELECT pr.id,pr.doc_no,pr.title,pr.author_name,pr.approved_at,(SELECT item FROM purchase_request_items i WHERE i.request_id=pr.id AND i.po_id IS NULL AND i.order_closed='' ORDER BY line_no LIMIT 1) first_item FROM purchase_requests pr WHERE pr.status='approved' AND EXISTS(SELECT 1 FROM purchase_request_items i WHERE i.request_id=pr.id AND i.po_id IS NULL AND i.order_closed='') ORDER BY pr.approved_at, pr.id LIMIT 5").all() };
  }
  // 15.309 품질 승인·처리 대기(품질책임자): COA 승인 · 문서 승인·배포 · 변경 승인 · CAPA 종결 · 밸리데이션 판정
  if (hasRole(user, 'quality_approver')) {
    const q = [];
    for (const [key, label, href, sql] of [
      ['coa', 'COA 승인 대기', '#/quality/coa', "SELECT COUNT(*) c FROM coas WHERE status='draft'"],
      ['docs', '문서 승인·배포 대기(검토 요청)', '#/quality/docs', "SELECT COUNT(*) c FROM quality_docs WHERE status='review'"],
      ['changes', '변경 승인 대기(영향평가)', '#/quality/changes', "SELECT COUNT(*) c FROM quality_changes WHERE status='evaluating'"],
      ['capa', 'CAPA 종결 대기(유효성검증)', '#/quality/capa', "SELECT COUNT(*) c FROM nonconformities WHERE status='verify'"],
      ['validation', '밸리데이션 판정 대기(단계 결과 모두 입력)', '#/quality/validation', "SELECT COUNT(*) c FROM validations v WHERE v.status='running' AND NOT EXISTS(SELECT 1 FROM json_each(v.stages) j WHERE COALESCE(json_extract(j.value,'$.result'),'')='')"],
    ]) { const c = (await db.prepare(sql).get()).c; if (c) q.push({ key, label, href, count: c }); }
    if (q.length) approvals.quality = q;
  }
  // 15.313 위험성평가 승인 대기(생산·품질 책임자)
  if (canRaApprove(user)) { const c = (await db.prepare("SELECT COUNT(*) c FROM risk_assessments WHERE status='review'").get()).c; if (c) (approvals.quality ||= []).push({ key: 'risk_assess', label: '위험성평가 승인 대기(검토 요청)', href: '#/prod/risk', count: c }); }
  // 15.309 교육 대상자 본인 「참석 확인」 대기
  { const items = await db.prepare("SELECT t.id,t.title,t.plan_date FROM training_attendees a JOIN trainings t ON t.id=a.training_id WHERE (a.user_id=? OR a.user_name=?) AND a.attended=0 AND t.status IN ('planned','done') ORDER BY t.plan_date LIMIT 20").all(user.id, user.name);
    if (items.length) approvals.training_attend = { count: items.length, items: items.slice(0, 5) }; }
  // My own requests still waiting, plus rejections from the last 7 days so the requester notices them.
  const recent = "(c.status='pending' OR (c.status='rejected' AND c.reviewed_at>=date('now','+9 hours','-7 days')))";
  const mine = {
    requests: await db.prepare("SELECT id,type,status,title,reject_reason,approver_name,created_at FROM requests WHERE requester_id=? AND status IN ('pending','rejected') ORDER BY id DESC LIMIT 20").all(user.id),
    actual_changes: await db.prepare(`${actualChangeSelect} WHERE c.requested_by_id=? AND ${recent} ORDER BY c.id DESC LIMIT 20`).all(user.id),
    semi_changes: (await db.prepare("SELECT * FROM semi_record_changes c WHERE c.requested_by_id=? AND " + recent + " ORDER BY c.id DESC LIMIT 20").all(user.id)).map(decodeSemiChange),
    receipt_changes: await db.prepare(`${receiptChangeSelect} WHERE c.requested_by_id=? AND ${recent} ORDER BY c.id DESC LIMIT 20`).all(user.id),
    purchase_requests: await db.prepare("SELECT pr.id,pr.doc_no,pr.title,pr.status,pr.reject_reason,pr.updated_at,(SELECT item FROM purchase_request_items i WHERE i.request_id=pr.id ORDER BY line_no LIMIT 1) first_item,(SELECT user_name FROM purchase_request_lines l WHERE l.request_id=pr.id AND l.step=pr.current_step AND l.kind!='cc') current_user_name,(SELECT user_name FROM purchase_request_lines l WHERE l.request_id=pr.id AND l.decision='rejected' ORDER BY l.decided_at DESC LIMIT 1) rejected_by FROM purchase_requests pr WHERE pr.author_id=? AND (pr.status='pending' OR (pr.status='rejected' AND pr.updated_at>=date('now','+9 hours','-7 days'))) ORDER BY pr.id DESC LIMIT 20").all(user.id),
  };
  return { approvals, mine };
});

// ── 조직 구성 (부서·직급) ──
// 관리자가 부서(상·하위)와 직급(서열) 목록을 관리한다. 사용자에는 이름 문자열을 저장하므로
// 이름을 바꾸면 그 이름을 쓰던 사용자도 함께 바꾼다. 쓰는 사람이 있거나 하위 부서가 있으면 삭제 대신 사용 중지한다.
const ORG = { departments: { table: 'org_departments', column: 'department', label: '부서' }, positions: { table: 'org_positions', column: 'position', label: '직급' } };
async function orgLists(activeOnly) {
  const where = activeOnly ? 'WHERE active=1' : '';
  return {
    departments: (await db.prepare(`SELECT id,name,parent_id,sort,active,positions_json,menus FROM org_departments ${where} ORDER BY sort, id`).all()).map(({ positions_json, menus, ...d }) => ({ ...d, position_names: positions_json === null ? null : JSON.parse(positions_json), menus: menuList(menus) })),
    positions: await db.prepare(`SELECT id,name,sort,active FROM org_positions ${where} ORDER BY sort, id`).all(),
  };
}
// 가입·사용자 저장 때 부서·직급 검사: 목록이 있으면 사용 중인 항목에서 골라야 한다. required면 빈 값도 거부.
async function orgChoice(body, { required = false, keep = null } = {}) {
  const lists = await orgLists(true), out = {};
  const department = str(body.department, 50), custom = lists.departments.find(d => d.name === department)?.position_names;
  if (custom) lists.positions = custom.map(name => ({ name }));
  for (const [key, kind, label] of [['department', 'departments', '부서'], ['position', 'positions', '직급']]) {
    const value = str(body[key], key === 'department' ? 50 : 30);
    if (!lists[kind].length || (keep && value && value === keep[key] && (key !== 'position' || department === keep.department))) { out[key] = value; continue; }
    if (!value) { if (required) throw bad(`${label}을(를) 고르세요.`); out[key] = ''; continue; }
    if (!lists[kind].some(item => item.name === value)) throw bad(`${label} 「${value}」은(는) 조직 구성에 없거나 사용 중지되었습니다. 목록에서 다시 고르세요.`);
    out[key] = value;
  }
  return out;
}
// 가입 화면용(로그인 전): 부서·직급 이름만 준다. 부서 메뉴 제한(menus) 같은 관리 설정은 빼고 보낸다.
route('GET', '/api/org', async () => { const lists = await orgLists(true); return { ...lists, departments: lists.departments.map(({ menus, ...d }) => d) }; }, { auth: false });
route('GET', '/api/admin/org', async ({ user }) => {
  requireAdmin(user);
  const lists = await orgLists(false);
  const users = await db.prepare("SELECT id,name,department,position,approval_status,is_admin FROM users ORDER BY name").all();
  return { ...lists, users: users.map(u => ({ ...u, is_admin: !!u.is_admin })) };
});
function orgKind(kind) { if (!Object.hasOwn(ORG, kind)) throw bad('조직 구성 종류를 확인하세요.'); return ORG[kind]; }
async function orgParent(kind, parentId, selfId = null) {
  if (kind !== 'departments' || parentId === undefined || parentId === null || parentId === '') return null;
  const id = Number(parentId); if (!Number.isSafeInteger(id) || id <= 0) throw bad('상위 부서를 다시 고르세요.');
  await mustGet('org_departments', id);
  // 자기 자신이나 하위 부서를 상위로 두면 순환이 생긴다.
  for (let cursor = id, guard = 0; cursor; guard++) {
    if (cursor === selfId) throw bad('자기 자신이나 하위 부서를 상위 부서로 둘 수 없습니다.');
    if (guard > 50) throw bad('부서 단계가 너무 깊습니다.');
    cursor = (await db.prepare('SELECT parent_id FROM org_departments WHERE id=?').get(cursor))?.parent_id || null;
  }
  return id;
}
route('POST', '/api/admin/org/:kind', async ({ user, params, body }) => {
  requireAdmin(user); const k = orgKind(params.kind);
  const name = reqStr(body.name, k.label + ' 이름', params.kind === 'departments' ? 50 : 30);
  if (await db.prepare(`SELECT 1 FROM ${k.table} WHERE name=?`).get(name)) throw new HttpError(409, `이미 있는 ${k.label}입니다.`);
  const parent = await orgParent(params.kind, body.parent_id);
  const sort = ((await db.prepare(`SELECT MAX(sort) s FROM ${k.table}`).get()).s ?? 0) + 1;
  const r = params.kind === 'departments'
    ? await db.prepare('INSERT INTO org_departments(name,parent_id,sort) VALUES(?,?,?)').run(name, parent, sort)
    : await db.prepare('INSERT INTO org_positions(name,sort) VALUES(?,?)').run(name, sort);
  return mustGet(k.table, r.lastInsertRowid);
});
route('PUT', '/api/admin/org/:kind/:id', async ({ user, params, body }) => {
  requireAdmin(user); const k = orgKind(params.kind); const row = await mustGet(k.table, params.id);
  const name = body.name === undefined ? row.name : reqStr(body.name, k.label + ' 이름', params.kind === 'departments' ? 50 : 30);
  if (name !== row.name && await db.prepare(`SELECT 1 FROM ${k.table} WHERE name=?`).get(name)) throw new HttpError(409, `이미 있는 ${k.label}입니다.`);
  const active = body.active === undefined ? row.active : (body.active ? 1 : 0);
  const queries = [];
  if (params.kind === 'departments') {
    const parent = body.parent_id === undefined ? row.parent_id : await orgParent('departments', body.parent_id, row.id);
    // 15.59: 부서 기본 메뉴. null이면 제한 없음(상위 부서를 따름), 배열이면 홈 + 고른 업무 묶음.
    if (body.menus !== undefined) queries.push({ sql: 'UPDATE org_departments SET menus=? WHERE id=?', args: [menuText(body.menus, '부서'), row.id] });
    if (body.position_names !== undefined) {
      const names = body.position_names;
      if (names !== null && (!Array.isArray(names) || !names.length || names.length > 30 || names.some(n => typeof n !== 'string' || !n.trim() || n.trim().length > 30) || new Set(names.map(n => n.trim())).size !== names.length)) throw bad('직급은 중복 없이 1~30개, 이름은 1~30자로 입력하세요.');
      queries.push({ sql: 'UPDATE org_departments SET positions_json=? WHERE id=?', args: [names === null ? null : JSON.stringify(names.map(n => n.trim())), row.id] });
    }
    queries.push({ sql: 'UPDATE org_departments SET name=?,parent_id=?,active=? WHERE id=?', args: [name, parent, active, row.id] });
  } else queries.push({ sql: 'UPDATE org_positions SET name=?,active=? WHERE id=?', args: [name, active, row.id] });
  // 이름이 바뀌면 그 이름을 쓰던 사용자도 함께 바꾼다(지난 구매의뢰서의 당시 표시는 그대로 둔다).
  if (name !== row.name) queries.push({ sql: `UPDATE users SET ${k.column}=? WHERE ${k.column}=?${params.kind === 'positions' ? ' AND NOT EXISTS(SELECT 1 FROM org_departments d WHERE d.name=users.department AND d.positions_json IS NOT NULL)' : ''}`, args: [name, row.name] });
  await db.batch(queries);
  return mustGet(k.table, row.id);
});
route('POST', '/api/admin/org/:kind/:id/move', async ({ user, params, body }) => {
  requireAdmin(user); const k = orgKind(params.kind); const row = await mustGet(k.table, params.id);
  const dir = Number(body.dir); if (![-1, 1].includes(dir)) throw bad('이동 방향을 확인하세요.');
  // 부서는 같은 상위 부서 안에서만 순서를 바꾼다.
  const scope = params.kind === 'departments' ? (row.parent_id ? 'parent_id=?' : 'parent_id IS NULL') : '1=1';
  const args = params.kind === 'departments' && row.parent_id ? [row.parent_id] : [];
  const siblings = await db.prepare(`SELECT id,sort FROM ${k.table} WHERE ${scope} ORDER BY sort, id`).all(...args);
  const i = siblings.findIndex(s => s.id === row.id), j = i + dir;
  if (j < 0 || j >= siblings.length) return orgLists(false);
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  await db.batch(siblings.map((s, index) => ({ sql: `UPDATE ${k.table} SET sort=? WHERE id=?`, args: [index + 1, s.id] })));
  return orgLists(false);
});
route('DELETE', '/api/admin/org/:kind/:id', async ({ user, params }) => {
  requireAdmin(user); const k = orgKind(params.kind); const row = await mustGet(k.table, params.id);
  const used = (await db.prepare(`SELECT COUNT(*) c FROM users WHERE ${k.column}=?`).get(row.name)).c;
  if (used) throw bad(`${row.name}에 속한 사용자가 ${used}명 있습니다. 사용자를 옮기거나 「사용 중지」로 바꾸세요.`);
  if (params.kind === 'departments' && await db.prepare('SELECT 1 FROM org_departments WHERE parent_id=?').get(row.id)) throw bad('하위 부서가 있습니다. 하위 부서를 먼저 옮기거나 지우세요.');
  await db.prepare(`DELETE FROM ${k.table} WHERE id=?`).run(row.id);
  return { ok: true };
});
// 지금 사용자들이 쓰는 부서·직급 이름으로 빈 목록을 채운다(처음 한 번, 이미 있는 이름은 건너뜀).
route('POST', '/api/admin/org-import', async ({ user }) => {
  requireAdmin(user);
  for (const [kind, column] of [['departments', 'department'], ['positions', 'position']]) {
    const table = ORG[kind].table;
    const names = (await db.prepare(`SELECT DISTINCT ${column} v FROM users WHERE ${column}!='' ORDER BY ${column}`).all()).map(r => r.v);
    let sort = ((await db.prepare(`SELECT MAX(sort) s FROM ${table}`).get()).s ?? 0);
    for (const name of names) await db.prepare(`INSERT INTO ${table}(name,sort) VALUES(?,?) ON CONFLICT(name) DO NOTHING`).run(name, ++sort);
  }
  return orgLists(false);
});

// ── 15.314 조직도 · 지정 담당자 ──
// 조직도: 회사(대표) → 부서 트리(부서장·업무 분장·구성원). 지정 담당자: 정보보호·개인정보·소방·산업안전보건·환경·전기·품질 등
// 법정·사내 담당을 정·부로 지정하고 별도 담당 업무·법적 근거·선임일·법정교육 주기를 관리한다. 보기는 로그인한 누구나, 고치기는 관리자.
const DUTY_CAT = { security: '정보보호', privacy: '개인정보', fire: '소방', safety: '산업안전보건', env: '환경·화학', elec: '전기·에너지', quality: '품질', emergency: '비상·응급', etc: '기타' };
const DUTY_COLS = ['duty_key', 'title', 'category', 'user_id', 'person_name', 'deputy_user_id', 'deputy_name', 'scope', 'appointed_date', 'report_date', 'end_date', 'legal_basis', 'qualification', 'contact', 'training_cycle', 'last_training', 'next_training', 'tasks', 'note', 'active'];
const addMonths = (d, n) => { if (!d || !n) return null; const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, dd)); if (t.getUTCDate() !== dd) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
async function orgUsers() { return db.prepare("SELECT id, name, department, position FROM users WHERE approval_status='approved' ORDER BY name").all(); }
async function dutyBody(o0, prior = {}) {
  const o = o0 && typeof o0 === 'object' ? o0 : {}, pick = k => o[k] === undefined ? prior[k] : o[k];
  const person = async (idKey, nameKey, label, req) => {
    const id = optId(pick(idKey)); let name = str(pick(nameKey), 50);
    if (id) { const u = await db.prepare('SELECT name FROM users WHERE id=?').get(id); if (!u) throw bad(`${label}을(를) 다시 고르세요.`); name = u.name; }
    if (req && !name) throw bad(`${label}을(를) 고르거나 이름을 적으세요(외부 대행이면 이름만).`);
    return [id, name];
  };
  const [user_id, person_name] = await person('user_id', 'person_name', '담당자(정)', true), [deputy_user_id, deputy_name] = await person('deputy_user_id', 'deputy_name', '대리자(부)', false);
  if (user_id && user_id === deputy_user_id) throw bad('정 담당자와 대리자가 같습니다.');
  const cycle = intIn(pick('training_cycle'), '교육 주기(개월)', 0, 120, 0), last = qDate(pick('last_training'), '최근 교육일');
  // 다음 교육 기한: 적으면 그대로, 비우면 (최근 교육일 또는 선임일) + 주기. 교육 관련 칸을 하나도 안 보냈으면 그대로 둔다.
  const touchedTraining = ['next_training', 'last_training', 'training_cycle', 'appointed_date'].some(k => o[k] !== undefined);
  const next = o.next_training ? qDate(o.next_training, '다음 교육 기한') : !touchedTraining ? prior.next_training ?? null : cycle ? addMonths(last || qDate(pick('appointed_date'), '선임일'), cycle) : null;
  const f = { duty_key: str(pick('duty_key'), 30) || 'custom', title: reqStr(pick('title'), '담당 업무명', 60), category: DUTY_CAT[pick('category')] ? pick('category') : 'etc', user_id, person_name, deputy_user_id, deputy_name,
    scope: str(pick('scope'), 50), appointed_date: qDate(pick('appointed_date'), '선임(지정)일'), report_date: qDate(pick('report_date'), '선임 신고일'), end_date: qDate(pick('end_date'), '종료일'),
    legal_basis: str(pick('legal_basis'), 200), qualification: str(pick('qualification'), 200), contact: str(pick('contact'), 60), training_cycle: cycle, last_training: last, next_training: next,
    tasks: str(pick('tasks'), 3000), note: str(pick('note'), 1000), active: pick('active') === undefined ? 1 : (pick('active') === false || pick('active') === 0 || pick('active') === '0' ? 0 : 1) };
  if (f.end_date && f.appointed_date && f.end_date < f.appointed_date) throw bad('종료일이 선임일보다 빠릅니다.');
  return f;
}
function dutyRow(r, users = {}) {
  const t = today(), in30 = addDaysISO(t, 30), u = r.user_id ? users[r.user_id] : null, dp = r.deputy_user_id ? users[r.deputy_user_id] : null;
  const train = !r.active ? '' : r.next_training ? (r.next_training < t ? 'over' : r.next_training <= in30 ? 'soon' : 'ok') : '';
  const warn = r.active && ((r.user_id && !u) ? '담당자가 퇴사·삭제되었거나 승인되지 않은 사용자입니다' : r.end_date && r.end_date < t ? '종료일이 지났습니다(해임 처리하거나 연장)' : '');
  return { ...r, active: !!r.active, history: JSON.parse(r.history || '[]'), category_label: DUTY_CAT[r.category] || r.category, user: u, deputy: dp, train, warn };
}
const usersById = async () => Object.fromEntries((await orgUsers()).map(u => [u.id, u]));
async function orgChartSetting() { try { return JSON.parse(await getSetting('org_chart') || '{}'); } catch { return {}; } }
route('GET', '/api/org/chart', async ({ user }) => {
  const users = await orgUsers(), byId = Object.fromEntries(users.map(u => [u.id, u])), cfg = await orgChartSetting(), co = await companyInfo();
  const departments = (await db.prepare('SELECT id, name, parent_id, sort, head_user_id, duties, positions_json FROM org_departments WHERE active=1 ORDER BY sort, id').all()).map(({ positions_json, ...d }) => ({ ...d, position_names: positions_json === null ? null : JSON.parse(positions_json), head: d.head_user_id ? byId[d.head_user_id] || null : null }));
  const positions = await db.prepare('SELECT name, sort FROM org_positions WHERE active=1 ORDER BY sort, id').all();
  const duties = (await db.prepare('SELECT * FROM org_duty_assignments WHERE active=1 ORDER BY sort, category, id').all()).map(r => dutyRow(r, byId));
  return { company: cfg.company || co.biz_name || '', ceo: cfg.ceo_user_id ? byId[cfg.ceo_user_id] || null : null, ceo_title: cfg.ceo_title || '대표이사', ceo_name: cfg.ceo_user_id ? byId[cfg.ceo_user_id]?.name || '' : (cfg.ceo_name || co.ceo || ''),
    departments, positions, users, duties, can_manage: !!user.is_admin, me: user.id,
    charts: (await db.prepare('SELECT id, name, note, sort, updated_at, created_at FROM org_charts WHERE active=1 ORDER BY sort, id').all()) };
});
// 15.323 저장해 쓰는 조직도(SBL 조직도 등). data = { title, ceo_title, ceo_user_id, ceo_name, nodes: [{ key, name, parent, head:{user_id,name}, members:[{user_id,name,role}], duties }] }
function orgChartClean(v0, userIds) {
  const v = v0 && typeof v0 === 'object' && !Array.isArray(v0) ? v0 : {}, nodes0 = Array.isArray(v.nodes) ? v.nodes : [];
  if (nodes0.length > 300) throw bad('조직도 상자는 300개까지입니다.');
  const person = (p, l) => { const o = p && typeof p === 'object' ? p : {}, uid = optId(o.user_id); if (uid && !userIds.has(uid)) throw bad(`${l}: 회원을 다시 고르세요.`); const name = str(o.name, 50); return uid || name ? { user_id: uid || null, name, role: str(o.role, 40) } : null; };
  const keys = new Set(), nodes = nodes0.map((n, i) => {
    const o = n && typeof n === 'object' ? n : {}, key = /^[a-z0-9]{4,16}$/.test(o.key || '') ? o.key : randomHex(4); if (keys.has(key)) throw bad('조직도 상자가 겹칩니다.'); keys.add(key);
    const name = reqStr(o.name, `${i + 1}번 상자 이름`, 60), members = (Array.isArray(o.members) ? o.members : []).slice(0, 200).map(m => person(m, `${name} 구성원`)).filter(Boolean);
    return { key, name, parent: o.parent ? String(o.parent) : null, head: person(o.head, `${name} 장`), members, duties: str(o.duties, 2000) };
  });
  for (const n of nodes) { if (n.parent && !keys.has(n.parent)) n.parent = null; let p = n.parent, hop = 0; while (p) { if (p === n.key || ++hop > 300) throw bad(`「${n.name}」의 상위 상자가 돌고 돕니다.`); p = nodes.find(x => x.key === p)?.parent || null; } }
  const ceo = optId(v.ceo_user_id); if (ceo && !userIds.has(ceo)) throw bad('대표를 다시 고르세요.');
  return { title: str(v.title, 100), ceo_title: str(v.ceo_title, 30), ceo_user_id: ceo || null, ceo_name: str(v.ceo_name, 50), nodes };
}
async function orgChartFromOfficial() {
  const depts = await db.prepare('SELECT id, name, parent_id, head_user_id, duties FROM org_departments WHERE active=1 ORDER BY sort, id').all(), users = await orgUsers(), cfg = await orgChartSetting(), co = await companyInfo();
  const key = id => `d${id}`;
  return { title: cfg.company || co.biz_name || '', ceo_title: cfg.ceo_title || '대표이사', ceo_user_id: cfg.ceo_user_id || null, ceo_name: cfg.ceo_user_id ? '' : cfg.ceo_name || co.ceo || '',
    nodes: depts.map(d => ({ key: key(d.id), name: d.name, parent: d.parent_id && depts.some(p => p.id === d.parent_id) ? key(d.parent_id) : null, head: d.head_user_id ? { user_id: d.head_user_id, name: '' } : null, members: users.filter(u => u.department === d.name && u.id !== d.head_user_id).map(u => ({ user_id: u.id, name: '', role: '' })), duties: d.duties || '' })) };
}
const orgChartUserIds = async () => new Set((await orgUsers()).map(u => u.id));
const orgChartOut = r => ({ ...r, data: JSON.parse(r.data || '{}'), history: JSON.parse(r.history || '[]'), active: !!r.active });
route('GET', '/api/org/charts/:id', async ({ params }) => { const r = await mustGet('org_charts', params.id); if (!r.active) throw new HttpError(404, '보관한 조직도입니다.'); return orgChartOut(r); });
route('POST', '/api/admin/org-charts', async ({ user, body }) => {
  requireAdmin(user); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM org_charts WHERE request_id=?').get(key); if (old) return orgChartOut(old); }
  const name = reqStr(body.name, '조직도 이름', 60);
  if (name === '공식 조직도' || await db.prepare('SELECT 1 FROM org_charts WHERE name=? AND active=1').get(name)) throw bad(`이미 있는 조직도 이름입니다: ${name}`);
  let data = { title: '', nodes: [] };
  if (body.copy === 'official') data = await orgChartFromOfficial();
  else if (optId(body.copy)) { const src = await mustGet('org_charts', optId(body.copy)); data = JSON.parse(src.data || '{}'); }
  data = orgChartClean(data, await orgChartUserIds());
  const sort = ((await db.prepare('SELECT MAX(sort) m FROM org_charts').get()).m || 0) + 1;
  const r = await db.prepare('INSERT INTO org_charts(name,note,data,sort,history,request_id,created_by) VALUES(?,?,?,?,?,?,?)').run(name, str(body.note, 300), JSON.stringify(data), sort, JSON.stringify([{ at: now(), by: user.name, what: `만듦${body.copy === 'official' ? ' · 공식 조직도 복사' : optId(body.copy) ? ' · 다른 조직도 복사' : ''}` }]), key, user.name);
  return orgChartOut(await mustGet('org_charts', r.lastInsertRowid));
});
route('PUT', '/api/admin/org-charts/:id', async ({ user, params, body }) => {
  requireAdmin(user); const prior = await mustGet('org_charts', params.id); if (Number(body.revision) !== prior.revision) throw conflict();
  const name = body.name === undefined ? prior.name : reqStr(body.name, '조직도 이름', 60);
  if (name !== prior.name && (name === '공식 조직도' || await db.prepare('SELECT 1 FROM org_charts WHERE name=? AND active=1 AND id<>?').get(name, prior.id))) throw bad(`이미 있는 조직도 이름입니다: ${name}`);
  const data = body.data === undefined ? prior.data : JSON.stringify(orgChartClean(body.data, await orgChartUserIds())), note = body.note === undefined ? prior.note : str(body.note, 300);
  const active = body.active === undefined ? prior.active : (body.active ? 1 : 0), sort = body.sort === undefined ? prior.sort : Number(body.sort) || 0;
  const what = active !== prior.active ? (active ? '다시 사용' : '보관(목록에서 숨김)') : name !== prior.name ? `이름 ${prior.name} → ${name}` : str(body.what, 100) || '수정';
  const res = await db.prepare("UPDATE org_charts SET name=?,note=?,data=?,active=?,sort=?,history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?").run(name, note, data, active, sort, pushHist(prior, { by: user.name, what }), user.name, prior.id, prior.revision);
  if (!(res.meta?.changes ?? res.changes)) throw conflict();
  return orgChartOut(await mustGet('org_charts', prior.id));
});
route('PUT', '/api/admin/org-chart', async ({ user, body }) => {
  requireAdmin(user); const cfg = await orgChartSetting();
  const ceo = optId(body.ceo_user_id); if (ceo && !await db.prepare("SELECT 1 FROM users WHERE id=? AND approval_status='approved'").get(ceo)) throw bad('대표를 다시 고르세요.');
  const next = { company: body.company === undefined ? cfg.company || '' : str(body.company, 100), ceo_user_id: body.ceo_user_id === undefined ? cfg.ceo_user_id || null : ceo, ceo_name: body.ceo_name === undefined ? cfg.ceo_name || '' : str(body.ceo_name, 50), ceo_title: body.ceo_title === undefined ? cfg.ceo_title || '대표이사' : str(body.ceo_title, 30) || '대표이사' };
  await setSetting('org_chart', JSON.stringify(next)); return next;
});
// 부서장·업무 분장(조직도 상자). 부서 이름·상위·사용 여부는 기존 「부서·직급」 탭(PUT /api/admin/org/departments/:id).
route('PUT', '/api/admin/org-chart/departments/:id', async ({ user, params, body }) => {
  requireAdmin(user); const d = await mustGet('org_departments', params.id);
  const head = body.head_user_id === undefined ? d.head_user_id : optId(body.head_user_id);
  if (head && !await db.prepare("SELECT 1 FROM users WHERE id=? AND approval_status='approved'").get(head)) throw bad('부서장을 다시 고르세요.');
  const duties = body.duties === undefined ? d.duties : str(body.duties, 2000);
  await db.prepare('UPDATE org_departments SET head_user_id=?, duties=? WHERE id=?').run(head, duties, d.id);
  return mustGet('org_departments', d.id);
});
route('GET', '/api/org/duties', async ({ user }) => {
  const byId = await usersById(), all = user.is_admin;
  const rows = (await db.prepare(`SELECT * FROM org_duty_assignments ${all ? '' : 'WHERE active=1'} ORDER BY active DESC, sort, category, id`).all()).map(r => dutyRow(r, byId));
  return { rows, users: Object.values(byId), departments: (await db.prepare('SELECT id, name, parent_id FROM org_departments WHERE active=1 ORDER BY sort, id').all()), categories: DUTY_CAT, can_manage: !!user.is_admin, today: today() };
});
route('POST', '/api/admin/org-duties', async ({ user, body }) => {
  requireAdmin(user); const key = str(body.request_id, 80) || null;
  if (key) { const old = await db.prepare('SELECT * FROM org_duty_assignments WHERE request_id=?').get(key); if (old) return dutyRow(old, await usersById()); }
  const f = await dutyBody(body), sort = ((await db.prepare('SELECT MAX(sort) s FROM org_duty_assignments').get()).s ?? 0) + 1;
  const r = await db.prepare(`INSERT INTO org_duty_assignments(${DUTY_COLS.join(',')},sort,history,request_id,created_by) VALUES(${DUTY_COLS.map(() => '?').join(',')},?,?,?,?)`)
    .run(...DUTY_COLS.map(k => f[k]), sort, JSON.stringify([{ at: now(), by: user.name, what: `지정 · ${f.person_name}` }]), key, user.name);
  return dutyRow(await mustGet('org_duty_assignments', r.lastInsertRowid), await usersById());
});
route('PUT', '/api/admin/org-duties/:id', async ({ user, params, body }) => {
  requireAdmin(user); const prior = await mustGet('org_duty_assignments', params.id);
  if (Number(body.revision) !== prior.revision) throw conflict();
  const f = await dutyBody(body, prior); if (body.active === false && !f.end_date) f.end_date = today();
  const changed = DUTY_COLS.filter(k => (prior[k] ?? null) !== (f[k] ?? null)); if (!changed.length) return dutyRow(prior, await usersById());
  const what = prior.active && !f.active ? `해임·종료 · ${prior.person_name}` : !prior.active && f.active ? '다시 지정' : prior.person_name !== f.person_name ? `담당자 변경 ${prior.person_name} → ${f.person_name}` : changed.includes('last_training') ? `교육 이수 ${f.last_training || ''}` : '수정';
  const r = await db.prepare(`UPDATE org_duty_assignments SET ${DUTY_COLS.map(k => k + '=?').join(',')},history=?,revision=revision+1,updated_by=?,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?`)
    .run(...DUTY_COLS.map(k => f[k]), pushHist(prior, { by: user.name, what, fields: changed }), user.name, prior.id, prior.revision);
  if (!r.changes) throw conflict();
  return dutyRow(await mustGet('org_duty_assignments', prior.id), await usersById());
});
route('DELETE', '/api/admin/org-duties/:id', async ({ user, params, query }) => {
  requireAdmin(user); const prior = await mustGet('org_duty_assignments', params.id);
  if (Number(query.revision) !== prior.revision) throw conflict();
  if (prior.active && prior.appointed_date && prior.appointed_date < today()) throw bad('이미 선임된 담당자 기록은 지우지 않고 「해임·종료」합니다(선임 이력 보존). 잘못 넣은 것이면 먼저 해임·종료한 뒤 지우세요.');
  await db.prepare('DELETE FROM org_duty_assignments WHERE id=? AND revision=?').run(prior.id, prior.revision); return { ok: true };
});
// ── 영업 → 생산: 생산의뢰(수주) ──
// 영업이 업체·주문번호·출고 희망·사양과 품목(사이즈별 줄)을 올리면, 생산 담당이 「생산계획 반영」으로 생산일정을 만든다.
// 일정은 schedules.production_line_id로 의뢰 줄에 연결되고, 진행(생산 수량·완료일)은 그 일정의 실적으로 계산한다.
// 동시 처리(15.51): 수정·삭제·계획 반영은 한 batch(D1 트랜잭션) 안에서 모든 문장이 「읽은 revision이 그대로인지」를 조건으로 갖고,
// revision을 올리는 헤더 UPDATE는 맨 마지막에 둔다. 그래서 다른 요청이 먼저 revision을 올렸으면 이 요청의 문장은 하나도 적용되지 않는다.
const MR_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const MR_PAGE = 300;
// 15.70 등록 품목(코드)을 고른 줄: 단위는 등록 단위, 규격은 등록된 사이즈 중 하나(등록 사이즈가 없으면 입력값).
function lockedSpec(bom, sizes, spec, no, prior = []) {
  const value = str(spec, 200);
  // 15.121 등록 사이즈가 없는 품목은 제품등록 규격으로 고정(고치는 의뢰의 기존 줄 값은 그대로)
  if (!sizes.length) return bom.spec && !(value && prior.some(p => p.bom_id === bom.id && p.spec === value)) ? bom.spec : value;
  // 15.75 고치는 의뢰의 기존 줄이 같은 품목·같은 규격이면(사이즈 등록 전에 적은 값 등) 그대로 받는다.
  if (value && prior.some(p => p.bom_id === bom.id && p.spec === value)) return value;
  if (value && !sizes.includes(value)) throw bad(`${no}(${bom.product})의 규격은 등록된 사이즈(${sizes.join(', ')}) 중에서 고르세요.`);
  return value;
}
async function mrLines(list, prior = []) {
  if (!Array.isArray(list) || !list.length) throw bad('품목을 1개 이상 입력하세요.');
  if (list.length > 60) throw bad('품목 줄은 60개까지 입력할 수 있습니다.');
  const lines = [], sizesOf = await sizeSets();
  for (const [index, raw] of list.entries()) {
    const it = raw && typeof raw === 'object' ? raw : {}, no = `${index + 1}번 품목`;
    let bom = null;
    if (it.bom_id !== undefined && it.bom_id !== null && it.bom_id !== '') {
      const id = Number(it.bom_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad(`${no}의 품목을 다시 선택하세요.`);
      bom = await mustGet('boms', id); if (!bom.active) throw bad(`${no}은(는) 사용 중지된 품목입니다.`);
    }
    const qty = num(it.qty, `${no} 수량`); if (!(qty > 0)) throw bad(`${no} 수량은 0보다 커야 합니다.`);
    const spec = bom ? lockedSpec(bom, sizesOf(bom.item_category, [bom.cat1, bom.cat2, bom.cat3]), it.spec, no, prior).slice(0, 100) : str(it.spec, 100);
    lines.push({ line_no: index + 1, bom_id: bom ? bom.id : null, product_code: bom ? bom.product_code : str(it.product_code, 50), item: bom ? bom.product : reqStr(it.item, `${no} 품목명`, 200), spec, unit: bom && bom.unit ? bom.unit : str(it.unit, 20) || (bom ? bom.unit : ''), qty });
  }
  return lines;
}
// 15.55·15.57: 화면에서 「출고 희망」 글과 「비고」 입력칸은 뺐다(출고 희망일·사양·요청사항과 겹침). 칸은 남겨 두고, 보내지 않으면 기존 의뢰의 값은 그대로 둔다.
function mrHead(body, prior = null) {
  const shipDate = dateStr(body.ship_date, '출고 희망일', { required: false });
  const shipText = body.ship_text !== undefined ? str(body.ship_text, 50) : prior ? prior.ship_text : '';
  return { order_date: dateStr(body.order_date, '발주일'), customer: reqStr(body.customer, '업체(고객사)', 100), order_no: str(body.order_no, 100), ship_text: shipText, ship_date: shipDate, spec: str(body.spec, 1000), note: body.note !== undefined ? str(body.note, 1000) : prior ? prior.note : '' };
}
// 줄마다 계획 수량(연결된 일정 합)·생산 수량(일정 실적 합)·마지막 생산일을 붙인다.
const MR_ACTUAL = s => `COALESCE((SELECT SUM(a.qty) FROM production_actuals a WHERE a.schedule_id=${s}.id AND a.voided_at IS NULL),0) + COALESCE((SELECT SUM(c.qty) FROM semi_records c WHERE ${semiCutMatch(s)}),0)`;
const MR_PLANNED = l => `COALESCE((SELECT SUM(s.qty) FROM schedules s WHERE s.production_line_id=${l}.id),0)`;
const MR_PRODUCED = l => `COALESCE((SELECT SUM(${MR_ACTUAL('s')}) FROM schedules s WHERE s.production_line_id=${l}.id),0)`;
const mrProgressSql = filter => `SELECT l.*, ${MR_PLANNED('l')} AS planned_qty, ${MR_PRODUCED('l')} AS produced_qty,
      MAX(COALESCE((SELECT MAX(a.production_date) FROM production_actuals a JOIN schedules s ON s.id=a.schedule_id WHERE s.production_line_id=l.id AND a.voided_at IS NULL), ''),
          COALESCE((SELECT MAX(c.work_date) FROM schedules s, semi_records c WHERE s.production_line_id=l.id AND ${semiCutMatch('s')}), '')) AS last_produced,
      (SELECT COUNT(*) FROM schedules s WHERE s.production_line_id=l.id) AS schedule_count
    FROM production_request_lines l WHERE ${filter} ORDER BY l.request_id, l.line_no`;
// D1은 쿼리 하나에 바인딩 매개변수를 100개까지만 받는다. 여러 의뢰의 줄은 나눠 읽는다(빠지는 줄 없이 모두 합친다).
async function mrLineProgress(ids) {
  const out = [];
  for (const part of inChunks(ids)) out.push(...await db.prepare(mrProgressSql(`l.request_id IN (${part.map(() => '?').join(',')})`)).all(...part));
  return out;
}
// 상태 규칙은 mrState와 같다(목록 필터를 LIMIT 전에 SQL에서 적용하기 위해 같은 식을 SQL로도 둔다).
const MR_STATUS_SQL = `CASE WHEN r.shipped THEN 'shipped' WHEN st.all_done=1 THEN 'done' WHEN st.produced>0 THEN 'producing' WHEN st.planned>=st.qty THEN 'planned' WHEN st.planned>0 THEN 'partial' ELSE 'waiting' END`;
function mrState(row, lines) {
  const qty = lines.reduce((t, l) => t + l.qty, 0), planned = lines.reduce((t, l) => t + Math.min(l.planned_qty, l.qty), 0), produced = lines.reduce((t, l) => t + Math.min(l.produced_qty, l.qty), 0);
  const done = lines.length && lines.every(l => l.produced_qty >= l.qty);
  const status = row.shipped ? 'shipped' : done ? 'done' : produced > 0 ? 'producing' : planned >= qty ? 'planned' : planned > 0 ? 'partial' : 'waiting';
  const doneDate = done ? lines.map(l => l.last_produced).filter(Boolean).sort().at(-1) || null : null;
  // 단위가 다른 수량(BOX·매·켤레)은 한 숫자로 더하지 않는다. 화면은 units(단위별 합계·진행)를 쓴다.
  const byUnit = new Map();
  for (const l of lines) {
    const u = byUnit.get(l.unit) || { unit: l.unit, qty: 0, planned: 0, produced: 0 };
    u.qty += l.qty; u.planned += Math.min(l.planned_qty, l.qty); u.produced += Math.min(l.produced_qty, l.qty); byUnit.set(l.unit, u);
  }
  return { status, total_qty: qty, planned_total: planned, produced_total: produced, units: [...byUnit.values()], mixed_units: byUnit.size > 1, done_date: doneDate, unplanned_lines: lines.filter(l => l.planned_qty < l.qty).length };
}
async function mrDetail(row, user) {
  const lines = await mrLineProgress([row.id]);
  const state = mrState(row, lines);
  const schedules = await db.prepare(`SELECT s.id,s.kind,s.period,s.start_date,s.product,s.spec,s.unit,s.qty,s.done,s.production_line_id,${MR_ACTUAL('s')} AS actual_qty FROM schedules s JOIN production_request_lines l ON l.id=s.production_line_id WHERE l.request_id=? ORDER BY s.start_date, s.id`).all(row.id);
  const mine = user && (user.is_admin || row.author_id === user.id);
  return { ...row, shipped: !!row.shipped, lines, schedules, ...state,
    can_edit: !!(mine && !lines.some(l => l.schedule_count) && !row.shipped),
    can_plan: !!(user && hasRole(user, 'production') && !row.shipped && state.unplanned_lines > 0),
    can_ship: !!(user && (mine || hasRole(user, 'logistics') || hasRole(user, 'production'))) };
}
const MR_FILTERS = { open: "mr_status!='shipped'", waiting: "mr_status IN ('waiting','partial')" };
route('GET', '/api/production-requests', async ({ user, query }) => {
  const where = [], args = [];
  applyListDates(where, args, query, 'r.order_date');
  const q = String(query.q || '').trim();
  if (q) {
    if (q.length > 200) throw bad('검색어는 200자까지 입력하세요.');
    const p = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    where.push("(r.req_no LIKE ? ESCAPE '\\' OR r.customer LIKE ? ESCAPE '\\' OR r.order_no LIKE ? ESCAPE '\\' OR r.spec LIKE ? ESCAPE '\\' OR r.author_name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM production_request_lines l WHERE l.request_id=r.id AND (l.item LIKE ? ESCAPE '\\' OR l.product_code LIKE ? ESCAPE '\\' OR l.spec LIKE ? ESCAPE '\\')))");
    args.push(...Array(8).fill(p));
  }
  if (query.mine === '1') { where.push('r.author_id=?'); args.push(user.id); }
  // 진행 상태는 실적으로 계산되므로 SQL에서 같은 식으로 계산해 LIMIT 전에 거른다(300건 뒤의 조건 맞는 의뢰가 빠지지 않게).
  const outer = [], outerArgs = [];
  if (query.status) {
    if (MR_FILTERS[query.status]) outer.push(MR_FILTERS[query.status]);
    else if (['waiting', 'partial', 'planned', 'producing', 'done', 'shipped'].includes(query.status)) { outer.push('mr_status=?'); outerArgs.push(query.status); }
    else throw bad('진행 상태를 확인하세요.');
  }
  const page = query.page === undefined || query.page === '' ? 0 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000) throw bad('페이지 번호를 확인하세요.');
  const rows = await db.prepare(`WITH sel AS (SELECT r.* FROM production_requests r ${where.length ? 'WHERE ' + where.join(' AND ') : ''}),
      lp AS (SELECT l.request_id, l.qty, ${MR_PLANNED('l')} AS planned, ${MR_PRODUCED('l')} AS produced FROM production_request_lines l WHERE l.request_id IN (SELECT id FROM sel)),
      st AS (SELECT request_id, SUM(qty) AS qty, SUM(MIN(planned, qty)) AS planned, SUM(MIN(produced, qty)) AS produced, MIN(produced >= qty) AS all_done FROM lp GROUP BY request_id)
    SELECT * FROM (SELECT r.*, ${MR_STATUS_SQL} AS mr_status FROM sel r LEFT JOIN st ON st.request_id=r.id) ${outer.length ? 'WHERE ' + outer.join(' AND ') : ''}
    ORDER BY shipped, COALESCE(ship_date, '9999'), order_date, id LIMIT ? OFFSET ?`).all(...args, ...outerArgs, MR_PAGE + 1, page * MR_PAGE);
  const more = rows.length > MR_PAGE, pageRows = rows.slice(0, MR_PAGE);
  const lines = await mrLineProgress(pageRows.map(r => r.id));
  const byRequest = new Map(); for (const l of lines) { const list = byRequest.get(l.request_id) || []; list.push(l); byRequest.set(l.request_id, list); }
  const out = pageRows.map(({ mr_status, ...row }) => { const ls = byRequest.get(row.id) || []; return { ...row, shipped: !!row.shipped, lines: ls, ...mrState(row, ls) }; });
  // 화면은 paged=1로 「더 보기」 여부를 함께 받는다. 그 밖의 호출은 첫 페이지 배열을 그대로 받는다.
  return query.paged === '1' ? { rows: out, page, more } : out;
});
// 생산 필요 수량: 아직 출고되지 않은 의뢰의 품목·규격·단위별 남은 생산 수량 합계(영업의 「TOTAL 생산 필요 수량」).
// 출고 전 의뢰 전체를 바인딩 매개변수 없이 서브쿼리로 읽어 합계가 잘리지 않는다.
route('GET', '/api/production-requests/needs', async () => {
  const lines = await db.prepare(mrProgressSql('l.request_id IN (SELECT id FROM production_requests WHERE shipped=0)')).all();
  const map = new Map();
  for (const l of lines) {
    const left = Math.max(0, l.qty - l.produced_qty); if (!left) continue;
    const key = [l.item, l.spec, l.unit].join('\u0001');
    const e = map.get(key) || { item: l.item, product_code: l.product_code, spec: l.spec, unit: l.unit, ordered: 0, produced: 0, need: 0, unplanned: 0, requests: 0 };
    e.ordered += l.qty; e.produced += Math.min(l.produced_qty, l.qty); e.need += left; e.unplanned += Math.max(0, l.qty - l.planned_qty); e.requests++;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => a.item.localeCompare(b.item, 'ko') || a.unit.localeCompare(b.unit, 'ko') || MR_SIZES.indexOf(a.spec) - MR_SIZES.indexOf(b.spec) || a.spec.localeCompare(b.spec));
});
route('GET', '/api/production-requests/:id', async ({ user, params }) => mrDetail(await mustGet('production_requests', params.id), user));
// 저장 재시도: 같은 request_id는 같은 작성자의 같은 저장으로 보고 처음 저장된 의뢰를 돌려준다(duplicate=true).
async function savedByRequestId(table, requestId, user, label) {
  if (!requestId) return null;
  const done = await db.prepare(`SELECT * FROM ${table} WHERE request_id=?`).get(requestId);
  if (done && done.author_id !== user.id) throw new HttpError(409, `같은 저장 번호로 다른 사람이 저장한 ${label}가 있습니다. 화면을 새로 고친 뒤 다시 저장하세요.`);
  return done;
}
// 하루 번호(…-01, …-99, …-100)는 숫자 부분의 최댓값 + 1. 계산과 INSERT를 한 문장에 두어 동시 등록에도 겹치지 않는다.
const nextDocNo = (table, column) => `? || printf('%02d', (SELECT COALESCE(MAX(CAST(substr(${column}, length(?) + 1) AS INTEGER)), 0) + 1 FROM ${table} WHERE ${column} LIKE ? || '%'))`;
// ── 영업: 수주 · 출하지시 (15.92) ──
// 수주(SO-…) = 고객 주문. 매출전표 입력에서 수주 줄의 남은 수량을 나눠 잡으면(예: 100 중 80) 그 줄마다 물류에 출하지시가 내려가고,
// 물류가 출하 처리하면 출하(shipments, 재고 차감)가 생기며 전표 줄이 그 출하로 연결된다(source_type ship).
// 잔량 = 수주 수량 − 유효한 매출전표 줄 수량. 수주는 줄에 전표가 있으면 고칠 수 없고 「마감」(남은 수량 더 안 받음)만 한다.
const ORDER_BILLED = "(SELECT COALESCE(SUM(b.qty),0) FROM sales_bill_lines b WHERE b.order_line_id=ol.id AND b.active=1)";
const ORDER_SHIPPED = "(SELECT COALESCE(SUM(i.qty),0) FROM ship_instructions i WHERE i.order_line_id=ol.id AND i.status='shipped')";
const ORDER_PENDING = "(SELECT COALESCE(SUM(i.qty),0) FROM ship_instructions i WHERE i.order_line_id=ol.id AND i.status='pending')";
// 15.100 출하는 됐는데 그 출하를 담은 유효한 전표가 없는 수량(전표를 취소한 뒤 아직 다시 잡지 않음). 잔량 계산에 넣는다.
const ORDER_SHIPPED_OPEN = "(SELECT COALESCE(SUM(i.qty),0) FROM ship_instructions i WHERE i.order_line_id=ol.id AND i.status='shipped' AND NOT EXISTS(SELECT 1 FROM sales_bill_lines x WHERE x.source_type='ship' AND x.source_id=i.shipment_id AND x.active=1))";
const ORDER_TAKEN = `(${ORDER_BILLED} + ${ORDER_SHIPPED_OPEN})`;
async function orderVendor(name) {
  const v = await db.prepare('SELECT * FROM vendors WHERE name_key=?').get(nameKey(name));
  if (!v) throw bad(`거래처 「${name}」가 거래처 관리에 없습니다. 먼저 등록하세요.`);
  return v;
}
async function orderLines(body) {
  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length || input.length > 100) throw bad('수주 품목은 1~100줄 넣으세요.');
  const out = [];
  for (const [i, raw] of input.entries()) {
    const l = raw && typeof raw === 'object' ? raw : {}, no = `${i + 1}번째 줄`;
    const id = Number(l.bom_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad(`${no}: 품목을 고르세요.`);
    const bom = await db.prepare('SELECT * FROM boms WHERE id=?').get(id);
    if (!bom || !bom.active) throw bad(`${no}: 사용 중인 품목을 고르세요.`);
    const qty = num(l.qty, `${no} 수량`); if (!(qty > 0)) throw bad(`${no}(${bom.product}): 수량은 0보다 커야 합니다.`);
    const price = l.unit_price === undefined || l.unit_price === '' || l.unit_price === null ? null : num(l.unit_price, `${no} 단가`);
    if (price != null && price < 0) throw bad(`${no}: 단가는 0 이상이어야 합니다.`);
    const lineId = l.id == null || l.id === '' ? null : Number(l.id); if (lineId != null && !(Number.isSafeInteger(lineId) && lineId > 0)) throw bad(`${no}: 줄 번호가 올바르지 않습니다.`);
    out.push({ id: lineId, bom_id: bom.id, product_code: bom.product_code || '', item: bom.product, spec: await catalogSpec(bom, l.spec), unit: bom.unit || str(l.unit, 20), qty, unit_price: price, due_date: l.due_date ? dateStr(l.due_date, `${no} 납기`) : '', note: str(l.note, 200) });
  }
  return out;
}
async function orderDetail(order) {
  const lines = await db.prepare(`SELECT ol.*, ${ORDER_LINE_USED} AS used, ${ORDER_BILLED} AS billed_qty, ${ORDER_SHIPPED} AS shipped_qty, ${ORDER_PENDING} AS pending_qty, ${ORDER_SHIPPED_OPEN} AS shipped_unbilled FROM sales_order_lines ol WHERE ol.order_id=? ORDER BY ol.id`).all(order.id);
  for (const l of lines) l.remaining = order.status === 'open' ? Math.max(0, stockRound(l.qty - l.billed_qty - l.shipped_unbilled)) : 0;
  const bills = await db.prepare(`SELECT b.id AS bill_id, b.bill_no, b.bill_date, l.order_line_id, l.qty, l.unit_price, l.supply, l.source_type, CASE WHEN i.status='pending' AND i.held=1 THEN 'held' ELSE i.status END AS ship_status, i.id AS instruction_id
    FROM sales_bill_lines l JOIN sales_bills b ON b.id=l.bill_id LEFT JOIN ship_instructions i ON i.bill_line_id=l.id
    WHERE l.active=1 AND l.order_line_id IN (SELECT id FROM sales_order_lines WHERE order_id=?) ORDER BY b.bill_date, b.id`).all(order.id);
  const ordered = lines.reduce((t, l) => t + l.qty, 0), billed = lines.reduce((t, l) => t + Math.min(l.qty, l.billed_qty + l.shipped_unbilled), 0);
  const state = order.status !== 'open' ? order.status : billed <= 0 ? 'waiting' : billed + 0.000001 >= ordered ? 'done' : 'partial';
  const purchase_requests = await db.prepare(`SELECT pr.id, pr.doc_no, pr.doc_date, pr.status, pr.author_name, (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id=pr.id) AS items, (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id=pr.id AND i.po_id IS NOT NULL) AS ordered FROM purchase_requests pr WHERE pr.sales_order_id=? ORDER BY pr.id`).all(order.id); // 15.284
  const mrRows = await db.prepare('SELECT * FROM production_requests WHERE sales_order_id=? ORDER BY id').all(order.id); // 15.299 이 수주에서 만든 생산의뢰(진행 상태는 목록과 같은 계산)
  const mrLinesAll = mrRows.length ? await mrLineProgress(mrRows.map(r => r.id)) : [];
  const production_requests = mrRows.map(r => { const ls = mrLinesAll.filter(l => l.request_id === r.id); return { id: r.id, req_no: r.req_no, order_date: r.order_date, author_name: r.author_name, shipped: !!r.shipped, items: ls.length, status: mrState(r, ls).status }; });
  return { ...order, lines, bills, state, purchase_requests, production_requests, amount: lines.reduce((t, l) => t + (l.unit_price == null ? 0 : billTrunc(l.qty * l.unit_price)), 0) };
}
route('GET', '/api/sales-orders', async ({ user, query }) => {
  requireSales(user);
  const where = [], args = [];
  applyListDates(where, args, query, 'o.order_date');
  if (query.customer) { where.push(`${customerKey('o.customer')}=?`); args.push(nameKey(str(query.customer, 100))); }
  applyListKeyword(where, args, query.q, ['o.order_no', 'o.customer', 'o.customer_code', 'o.customer_po', 'o.note', 'o.created_by']);
  const page = Math.max(0, Math.min(1000, Number(query.page) || 0));
  const base = `SELECT o.*, (SELECT COUNT(*) FROM sales_order_lines ol WHERE ol.order_id=o.id) AS line_count,
      (SELECT COALESCE(SUM(ol.qty),0) FROM sales_order_lines ol WHERE ol.order_id=o.id) AS ordered_qty,
      (SELECT COALESCE(SUM(MIN(ol.qty, ${ORDER_TAKEN})),0) FROM sales_order_lines ol WHERE ol.order_id=o.id) AS billed_qty,
      (SELECT COALESCE(SUM(CASE WHEN ol.unit_price IS NULL THEN 0 ELSE CAST(ROUND(ol.qty*ol.unit_price*1000)/1000 AS INTEGER) END),0) FROM sales_order_lines ol WHERE ol.order_id=o.id) AS amount,
      (SELECT ol.item FROM sales_order_lines ol WHERE ol.order_id=o.id ORDER BY ol.id LIMIT 1) AS first_item
    FROM sales_orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  // 상태 거름은 SQL에서(15.102: 예전에는 200줄을 읽은 뒤 걸러 오래된 진행 수주가 빠졌다)
  const STATE = "CASE WHEN q.status<>'open' THEN q.status WHEN q.billed_qty<=0 THEN 'waiting' WHEN q.billed_qty+0.000001>=q.ordered_qty THEN 'done' ELSE 'partial' END";
  const state = query.state ? String(query.state) : '', stateWhere = state === 'open' ? `WHERE ${STATE} IN ('waiting','partial')` : state ? `WHERE ${STATE}=?` : '';
  const rows = await db.prepare(`SELECT q.*, ${STATE} AS state FROM (${base}) q ${stateWhere} ORDER BY q.order_date DESC, q.id DESC LIMIT 201 OFFSET ?`).all(...args, ...(state && state !== 'open' ? [state] : []), page * 200);
  return { rows: rows.slice(0, 200), page, more: rows.length > 200 };
});
// 매출전표 입력용: 거래처의 남은 수량이 있는 수주 줄
route('GET', '/api/sales-orders/open-lines', async ({ user, query }) => {
  requireSales(user);
  const customer = reqStr(query.customer, '거래처', 100);
  const rows = await db.prepare(`SELECT ol.*, o.order_no, o.order_date, o.customer_po, o.note AS order_note, o.due_date AS order_due, o.tax_type, ${ORDER_TAKEN} AS billed_qty FROM sales_order_lines ol JOIN sales_orders o ON o.id=ol.order_id
    WHERE o.status='open' AND ${customerKey('o.customer')}=? AND ${ORDER_TAKEN} < ol.qty - 0.000001 ORDER BY o.order_date, o.id, ol.id LIMIT 501`).all(nameKey(customer));
  return { rows: rows.slice(0, 500).map(r => ({ ...r, remaining: stockRound(r.qty - r.billed_qty) })), more: rows.length > 500 };
});
route('GET', '/api/sales-orders/:id', async ({ user, params }) => { requireSales(user); return orderDetail(await mustGet('sales_orders', params.id)); });
route('POST', '/api/sales-orders', async ({ user, body }) => {
  requireSales(user);
  const token = String(body.request_id || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw bad('등록 요청 번호를 확인하세요.');
  const prior = await db.prepare('SELECT * FROM sales_orders WHERE request_id=?').get(token);
  if (prior) { if (prior.created_by_id !== user.id) throw new HttpError(409, '이미 사용된 등록 요청입니다. 새로 열어 등록하세요.'); return { ...await orderDetail(prior), duplicate: true }; }
  const vendor = await orderVendor(reqStr(body.customer, '거래처', 100));
  const date = dateStr(body.order_date, '수주일'), lines = await orderLines(body);
  const prefix = `SO-${today().slice(2).replace(/-/g, '')}-`, OID = '(SELECT id FROM sales_orders WHERE request_id=?)';
  const cmds = [{ sql: `INSERT INTO sales_orders(order_no,order_date,customer,customer_code,customer_po,due_date,tax_type,note,created_by,created_by_id,request_id) VALUES(${nextDocNo('sales_orders', 'order_no')},?,?,?,?,?,?,?,?,?,?)`,
    args: [prefix, prefix, prefix, date, vendor.name, vendor.code || '', str(body.customer_po, 50), body.due_date ? dateStr(body.due_date, '납기') : '', body.tax_type === 'zero' ? 'zero' : 'taxable', str(body.note, 500), user.name, user.id, token] }];
  for (const l of lines) cmds.push({ sql: `INSERT INTO sales_order_lines(order_id,bom_id,product_code,item,spec,unit,qty,unit_price,due_date,note) VALUES(${OID},?,?,?,?,?,?,?,?,?)`, args: [token, l.bom_id, l.product_code, l.item, l.spec, l.unit, l.qty, l.unit_price, l.due_date, l.note] });
  try { await db.batch(cmds); }
  catch (error) { const saved = await db.prepare('SELECT * FROM sales_orders WHERE request_id=?').get(token); if (saved && saved.created_by_id === user.id) return { ...await orderDetail(saved), duplicate: true }; throw error; }
  return orderDetail(await db.prepare('SELECT * FROM sales_orders WHERE request_id=?').get(token));
});
// 고치기: 아직 매출전표가 하나도 없을 때만(줄을 통째로 바꿈)
// 15.131 일부 출고된 수주도 고칠 수 있다: 기존 줄은 id로 유지하고 수량은 이미 잡은 수량(전표+출하) 이상으로만 바꾼다.
// 품목 추가는 자유, 줄 삭제는 전표·출하지시가 한 번도 없었던 줄만. 전표가 잡힌 줄은 품목·규격을 못 바꾸고(수량·단가·납기·비고만),
// 거래처는 전표·출하가 하나라도 있으면 못 바꾼다. 각 줄 UPDATE에 조건을 걸어 그 사이 잡힌 전표와 경합하면 전체를 되돌린다.
const qtyK = n => stockRound(n).toLocaleString('ko-KR');
const ORDER_LINE_USED = "(EXISTS(SELECT 1 FROM sales_bill_lines b WHERE b.order_line_id=ol.id) OR EXISTS(SELECT 1 FROM ship_instructions i WHERE i.order_line_id=ol.id))";
route('PUT', '/api/sales-orders/:id', async ({ user, params, body }) => {
  requireSales(user);
  const order = await mustGet('sales_orders', params.id);
  if (order.status !== 'open') throw bad('마감·취소된 수주는 고칠 수 없습니다. 「다시 열기」 후 고치세요.');
  const vendor = await orderVendor(reqStr(body.customer, '거래처', 100));
  const date = dateStr(body.order_date, '수주일'), lines = await orderLines(body);
  const old = await db.prepare(`SELECT ol.*, ${ORDER_TAKEN} AS taken, ${ORDER_LINE_USED} AS used FROM sales_order_lines ol WHERE ol.order_id=?`).all(order.id);
  const byId = new Map(old.map(l => [l.id, l])), kept = new Set();
  for (const [i, l] of lines.entries()) {
    if (l.id == null) continue;
    const o = byId.get(l.id), no = `${i + 1}번째 줄(${l.item})`;
    if (!o) throw new HttpError(409, `${no}: 이 수주에 없는 줄입니다. 새로 불러오세요.`);
    if (kept.has(l.id)) throw bad(`${no}: 같은 줄이 두 번 들어 있습니다.`);
    kept.add(l.id);
    if (o.used && (o.bom_id !== l.bom_id || (o.spec || '') !== (l.spec || ''))) throw bad(`${no}: 전표·출하가 잡힌 줄은 품목·규격을 바꿀 수 없습니다. 새 줄로 추가하고 이 줄은 잡은 수량(${qtyK(o.taken)})으로 줄이세요.`);
    if (l.qty + 0.000001 < o.taken) throw bad(`${no}: 이미 전표·출하로 ${qtyK(o.taken)} 잡았습니다. 수량은 ${qtyK(o.taken)} 이상으로 넣으세요.`);
  }
  const removed = old.filter(o => !kept.has(o.id));
  const blocked = removed.find(o => o.used); if (blocked) throw bad(`${blocked.item}: 전표·출하지시가 있었던 줄은 지울 수 없습니다. 수량을 잡은 수량(${qtyK(blocked.taken)})까지 줄이거나 「잔량 마감」하세요.`);
  const anyUsed = old.some(o => o.used);
  if (anyUsed && nameKey(vendor.name) !== nameKey(order.customer)) throw bad('전표·출하가 잡힌 수주는 거래처를 바꿀 수 없습니다.');
  const cmds = [
    { sql: "UPDATE sales_orders SET order_date=?,customer=?,customer_code=?,customer_po=?,due_date=?,tax_type=?,note=?,updated_by=?,updated_at=? WHERE id=? AND status='open'",
      args: [date, vendor.name, vendor.code || '', str(body.customer_po, 50), body.due_date ? dateStr(body.due_date, '납기') : '', body.tax_type === 'zero' ? 'zero' : 'taxable', str(body.note, 500), user.name, now(), order.id] }, RC_GUARD,
    ...removed.flatMap(o => [{ sql: 'DELETE FROM sales_order_lines AS ol WHERE ol.id=? AND ol.order_id=? AND NOT ' + ORDER_LINE_USED, args: [o.id, order.id] }, RC_GUARD]),
    ...lines.filter(l => l.id != null).flatMap(l => [{ sql: `UPDATE sales_order_lines AS ol SET bom_id=?,product_code=?,item=?,spec=?,unit=?,qty=?,unit_price=?,due_date=?,note=? WHERE ol.id=? AND ol.order_id=? AND ?+0.000001>=${ORDER_TAKEN} AND (NOT ${ORDER_LINE_USED} OR (ol.bom_id=? AND COALESCE(ol.spec,'')=?))`,
      args: [l.bom_id, l.product_code, l.item, l.spec, l.unit, l.qty, l.unit_price, l.due_date, l.note, l.id, order.id, l.qty, l.bom_id, l.spec || ''] }, RC_GUARD]),
    ...lines.filter(l => l.id == null).map(l => ({ sql: 'INSERT INTO sales_order_lines(order_id,bom_id,product_code,item,spec,unit,qty,unit_price,due_date,note) VALUES(?,?,?,?,?,?,?,?,?,?)', args: [order.id, l.bom_id, l.product_code, l.item, l.spec, l.unit, l.qty, l.unit_price, l.due_date, l.note] })),
  ];
  try { await db.batch(cmds); }
  catch (error) { if (isGuardError(error)) throw new HttpError(409, '그 사이 매출전표·출하가 잡혔거나 수주가 마감되었습니다. 새로 불러오세요.'); throw error; }
  return orderDetail(await mustGet('sales_orders', order.id));
});
// 마감(남은 수량을 더 받지 않음)·다시 열기·취소(전표가 없을 때)
route('POST', '/api/sales-orders/:id/status', async ({ user, params, body }) => {
  requireSales(user);
  const order = await mustGet('sales_orders', params.id), to = String(body.status || '');
  if (!['open', 'closed', 'cancelled'].includes(to)) throw bad('바꿀 상태를 확인하세요.');
  if (to === 'cancelled' && await db.prepare("SELECT 1 FROM sales_order_lines x WHERE x.order_id=? AND (EXISTS(SELECT 1 FROM sales_bill_lines b WHERE b.order_line_id=x.id AND b.active=1) OR EXISTS(SELECT 1 FROM ship_instructions i WHERE i.order_line_id=x.id AND i.status IN ('pending','shipped')))").get(order.id)) throw bad('매출전표를 잡았거나 출하된 수주는 취소할 수 없습니다. 남은 수량은 「마감」하세요.');
  if (to !== 'open' && order.status !== 'open') throw bad('이미 마감·취소된 수주입니다.');
  if (to === 'open' && order.status === 'open') throw bad('이미 진행 중인 수주입니다.');
  if (to === 'open' && order.status === 'cancelled') throw bad('취소한 수주는 다시 열 수 없습니다. 새 수주로 넣으세요.');
  const reason = to === 'open' ? '' : str(body.reason, 200);
  const r = await db.prepare(`UPDATE sales_orders SET status=?,closed_at=?,closed_by=?,close_reason=?,updated_by=?,updated_at=? WHERE id=? AND status=?`).run(to, to === 'open' ? null : now(), to === 'open' ? null : user.name, reason, user.name, now(), order.id, order.status);
  if (!r.changes) throw new HttpError(409, '그 사이 상태가 바뀌었습니다. 새로 불러오세요.');
  return orderDetail(await mustGet('sales_orders', order.id));
});
// 물류: 출하지시
route('GET', '/api/ship-instructions', async ({ query }) => {
  const where = [], args = [];
  const status = query.status === undefined ? 'pending' : String(query.status);
  if (status === 'held') { where.push('i.status=? AND i.held=1'); args.push('pending'); }
  else if (status) { if (!['pending', 'shipped', 'cancelled'].includes(status)) throw bad('상태를 확인하세요.'); where.push('i.status=?'); args.push(status); if (status === 'pending') where.push('i.held=0'); }
  applyListDates(where, args, query, 'i.ship_date');
  if (query.customer) { where.push(`${customerKey('i.customer')}=?`); args.push(nameKey(str(query.customer, 100))); }
  if (query.batch === 'none') where.push('sbt.id IS NULL'); // 15.132 아직 묶음 출하지시에 안 묶인 것만
  applyListKeyword(where, args, query.q, ['i.item', 'i.product_code', 'i.customer', 'i.note', 'o.customer_po', 'o.note', 'o.order_no', 'sbt.batch_no']);
  const rows = await db.prepare(`SELECT i.*, b.bill_no, o.order_no, o.customer_po, s.lot AS shipped_lot, sbt.batch_no, sbt.id AS open_batch_id, sbt.plan_date AS batch_plan_date FROM ship_instructions i JOIN sales_bills b ON b.id=i.bill_id LEFT JOIN ship_batches sbt ON sbt.id=i.batch_id AND sbt.status='open'
    LEFT JOIN sales_order_lines ol ON ol.id=i.order_line_id LEFT JOIN sales_orders o ON o.id=ol.order_id LEFT JOIN shipments s ON s.id=i.shipment_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.ship_date, i.id LIMIT 1001`).all(...args);
  return { rows: rows.slice(0, 1000), more: rows.length > 1000 };
});
// 출하 처리: 지시마다 출하 한 줄(재고 차감)을 만들고 매출전표 줄을 그 출하로 연결. lots: { 지시 id: LOT }
route('POST', '/api/ship-instructions/ship', async ({ user, body }) => {
  if (!hasRole(user, 'logistics')) throw new HttpError(403, '출하 처리는 물류 담당자가 합니다.');
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number))] : [];
  if (!ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('출하할 지시를 1~50건 고르세요.');
  const date = dateStr(body.ship_date || today(), '출고일'); if (date > today()) throw bad('출고일은 오늘 이전으로 선택하세요.');
  const lots = body.lots && typeof body.lots === 'object' ? body.lots : {};
  const qtys = body.qtys && typeof body.qtys === 'object' ? body.qtys : {}; // 15.208 재고가 모자라 적게 내보낼 때: 지시 수량보다 적게 → 나머지는 출하 대기로 남음
  const closedCustomers = new Set();
  const cmds = []; let partial = 0;
  const shipPending = new Map();
  for (const id of ids) {
    const ins = await db.prepare('SELECT * FROM ship_instructions WHERE id=?').get(id);
    if (!ins || ins.status !== 'pending') throw new HttpError(409, '이미 처리됐거나 취소된 출하지시가 있습니다. 새로 불러오세요.');
    if (ins.held) throw new HttpError(409, `${ins.item}: 보류 중인 지시입니다. 보류를 풀고 출하 처리하세요.`);
    const bill = await db.prepare('SELECT bill_date, customer FROM sales_bills WHERE id=?').get(ins.bill_id);
    const billFloor = bill ? (([y, m]) => m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`)(String(bill.bill_date).split('-').map(Number)) : ''; // 15.148 이월 전표는 앞 달 출고 허용
    if (bill && date < billFloor) throw bad(`${ins.item}: 출고일은 전표 달(${String(bill.bill_date).slice(0, 7)})의 앞 달 이후여야 합니다.`);
    if (!closedCustomers.has(ins.customer) && await salesClosed(ins.customer, date)) throw bad(closedMessage(ins.customer, date, '출하 처리하세요'));
    closedCustomers.add(ins.customer);
    const lot = str(lots[id], 100), tag = `si:${id}`;
    await checkShipLot(ins.item, lot, qtys[id] !== undefined && qtys[id] !== null && qtys[id] !== '' ? Number(qtys[id]) : ins.qty, shipPending); // 15.150 · 15.254 잔량
    let shipQty = ins.qty;
    if (qtys[id] !== undefined && qtys[id] !== null && qtys[id] !== '') { const sp = await splitInstructionCmds(ins, qtys[id], user, '출하 수량 줄임(재고 부족 등)'); shipQty = sp.q; if (sp.cmds.length) { cmds.push(...sp.cmds); partial++; } }
    cmds.push(
      { sql: "UPDATE ship_instructions SET status='shipped',processed_by=?,processed_at=? WHERE id=? AND status='pending' AND held=0", args: [user.name, now(), id] }, RC_GUARD,
      { sql: 'INSERT INTO shipments(ship_date,item,qty,customer,note,lot,created_by,product_code,unit,spec,batch_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)', args: [date, ins.item, shipQty, ins.customer, ins.note || '', lot, user.name, ins.product_code, ins.unit, ins.spec, tag] },
      { sql: 'UPDATE ship_instructions SET shipment_id=(SELECT id FROM shipments WHERE batch_id=?) WHERE id=?', args: [tag, id] },
      { sql: "UPDATE sales_bill_lines SET source_type='ship',source_id=(SELECT id FROM shipments WHERE batch_id=?),ship_date=?,lot=? WHERE id=? AND active=1", args: [tag, date, lot, ins.bill_line_id] }, RC_GUARD,
    );
  }
  try { await db.batch(cmds); }
  catch (error) { if (isGuardError(error)) throw new HttpError(409, '그 사이 출하지시나 매출전표가 바뀌었습니다. 새로 불러오세요.'); throw error; }
  await mrAutoShip(user, date).catch(() => {}); // 15.299
  return { shipped: ids.length, partial };
});
// 15.299 수주에서 만든 생산의뢰(sales_order_id): 그 수주의 모든 줄이 출하되면 생산의뢰를 자동으로 「출고」 표시(출고일 = 마지막 출하일).
// 손으로 표시·취소하는 기존 기능은 그대로. 이미 출고 표시된 의뢰는 건드리지 않는다.
async function mrAutoShip(user, date) {
  const rows = await db.prepare(`SELECT r.id FROM production_requests r WHERE r.shipped=0 AND r.sales_order_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM sales_order_lines ol WHERE ol.order_id=r.sales_order_id)
    AND NOT EXISTS(SELECT 1 FROM sales_order_lines ol WHERE ol.order_id=r.sales_order_id AND ${ORDER_SHIPPED} + 0.000001 < ol.qty)`).all();
  for (const r of rows) await db.prepare("UPDATE production_requests SET shipped=1,shipped_date=?,shipped_by=?,revision=revision+1,updated_at=datetime('now','+9 hours') WHERE id=? AND shipped=0").run(date, `${user.name} (수주 출하 완료 자동)`, r.id);
  return rows.length;
}
// 15.245 출하지시 한 줄을 여러 LOT로 출하: 상세 내역(LOT · 납품일자 · 담당자 · 납품수량 · 비고)마다 출하 1건.
// 지시·전표 줄을 LOT별로 나누고(첫 LOT은 원래 줄, 나머지는 같은 전표의 새 줄 + 새 지시), 남는 수량은 새 줄로 출하 대기에 남는다.
// 공급가액·세액은 수량 비율로 나누고 끝 줄에 나머지를 몰아 전표 합계는 그대로. 한 batch로 처리(중간 실패 시 모두 되돌림).
route('POST', '/api/ship-instructions/:id/ship-lots', async ({ user, params, body }) => {
  if (!hasRole(user, 'logistics')) throw new HttpError(403, '출하 처리는 물류 담당자가 합니다.');
  const ins = await mustGet('ship_instructions', params.id);
  if (ins.status !== 'pending') throw new HttpError(409, '이미 처리됐거나 취소된 출하지시입니다. 새로 불러오세요.');
  if (ins.held) throw new HttpError(409, `${ins.item}: 보류 중인 지시입니다. 보류를 풀고 출하 처리하세요.`);
  const raw = Array.isArray(body.lines) ? body.lines : [];
  if (!raw.length || raw.length > 30) throw bad('출하할 LOT을 1~30줄 넣으세요.');
  const bill = await db.prepare('SELECT * FROM sales_bills WHERE id=?').get(ins.bill_id), line = await db.prepare('SELECT * FROM sales_bill_lines WHERE id=?').get(ins.bill_line_id);
  if (!bill || bill.status !== 'confirmed' || !line || !line.active) throw new HttpError(409, `${ins.item}: 매출전표가 취소됐거나 바뀌었습니다. 새로 불러오세요.`);
  const billFloor = (([y, m]) => m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`)(String(bill.bill_date).split('-').map(Number));
  const shipPending = new Map();
  const parts = [];
  for (const [n, r] of raw.entries()) {
    const lot = str(r?.lot, 100), qty = stockRound(Number(r?.qty)), date = dateStr(r?.ship_date || today(), '납품일자'), note = str(r?.note, 200);
    if (!(qty > 0)) throw bad(`${n + 1}번째 줄: 납품수량을 0보다 크게 넣으세요.`);
    if (date > today()) throw bad(`${n + 1}번째 줄: 납품일자는 오늘 이전으로 넣으세요.`);
    if (date < billFloor) throw bad(`${n + 1}번째 줄: 납품일자는 전표 달(${String(bill.bill_date).slice(0, 7)})의 앞 달 이후여야 합니다.`);
    if (await salesClosed(ins.customer, date)) throw bad(closedMessage(ins.customer, date, '출하 처리하세요'));
    await checkShipLot(ins.item, lot, qty, shipPending); // 15.254 잔량
    parts.push({ lot, qty, date, note });
  }
  const total = stockRound(parts.reduce((t, p) => t + p.qty, 0)), Q = Number(ins.qty);
  if (total > Q + 0.000001) throw bad(`납품수량 합계 ${total}이 지시 수량 ${stockRound(Q)}보다 많습니다.`);
  if (Math.abs(Number(line.qty) - Q) > 0.000001) throw new HttpError(409, `${ins.item}: 전표 수량(${stockRound(line.qty)})과 지시 수량(${stockRound(Q)})이 달라 나눌 수 없습니다. 전표를 확인하세요.`);
  const rest = stockRound(Q - total), segs = [...parts.map(p => p.qty), ...(rest > 0.000001 ? [rest] : [])];
  // 줄마다 공급가액·세액(끝 줄이 나머지)
  let sLeft = Number(line.supply), vLeft = Number(line.vat);
  const money = segs.map((q, k) => { if (k === segs.length - 1) return { supply: sLeft, vat: vLeft }; const supply = Math.round(Number(line.supply) * q / Q), vat = Math.round(Number(line.vat) * q / Q); sLeft -= supply; vLeft -= vat; return { supply, vat }; });
  const cmds = [], stamp = now(), base = `sl:${ins.id}:${Date.now().toString(36)}`;
  const ship = (p, k, insRef, lineRef) => {
    const tag = `${base}:${k}`;
    cmds.push(
      { sql: 'INSERT INTO shipments(ship_date,item,qty,customer,note,lot,created_by,product_code,unit,spec,batch_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)', args: [p.date, ins.item, p.qty, ins.customer, p.note || ins.note || '', p.lot, user.name, ins.product_code, ins.unit, ins.spec, tag] },
      { sql: `UPDATE ship_instructions SET status='shipped',processed_by=?,processed_at=?,shipment_id=(SELECT id FROM shipments WHERE batch_id=?) WHERE id=${insRef} AND status='pending' AND held=0`, args: [user.name, stamp, tag] }, RC_GUARD,
      { sql: `UPDATE sales_bill_lines SET source_type='ship',source_id=(SELECT id FROM shipments WHERE batch_id=?),ship_date=?,lot=? WHERE id=${lineRef} AND active=1`, args: [tag, p.date, p.lot] }, RC_GUARD);
  };
  // 첫 LOT: 원래 지시·전표 줄
  if (segs.length > 1) cmds.push(
    { sql: 'UPDATE sales_bill_lines SET qty=?,supply=?,vat=? WHERE id=? AND active=1 AND qty=? AND supply=? AND vat=?', args: [segs[0], money[0].supply, money[0].vat, line.id, line.qty, line.supply, line.vat] }, RC_GUARD,
    { sql: "UPDATE ship_instructions SET qty=? WHERE id=? AND status='pending' AND qty=?", args: [segs[0], ins.id, ins.qty] }, RC_GUARD);
  ship(parts[0], 0, String(Number(ins.id)), String(Number(line.id)));
  // 나머지 LOT·남는 수량: 같은 전표의 새 줄 + 새 지시
  for (let k = 1; k < segs.length; k++) {
    cmds.push(
      { sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note,order_line_id)
        SELECT bill_id,item_category,?,?,item,spec,unit,product_code,?,?,?,unit_price,?,?,note,order_line_id FROM sales_bill_lines WHERE id=?`, args: [line.source_type, line.source_id, line.lot || '', line.ship_date, segs[k], money[k].supply, money[k].vat, line.id] }, // 원래 줄의 출하 전 값(첫 LOT 출하로 바뀌기 전)
      { sql: `INSERT INTO ship_instructions(bill_id,bill_line_id,order_line_id,customer,bom_id,product_code,item,spec,unit,qty,ship_date,note,created_by,held)
        SELECT bill_id,(SELECT MAX(id) FROM sales_bill_lines WHERE bill_id=?),order_line_id,customer,bom_id,product_code,item,spec,unit,?,ship_date,note,created_by,0 FROM ship_instructions WHERE id=?`, args: [bill.id, segs[k], ins.id] });
    if (k < parts.length) ship(parts[k], k, '(SELECT MAX(id) FROM ship_instructions)', `(SELECT MAX(id) FROM sales_bill_lines WHERE bill_id=${Number(bill.id)})`);
  }
  if (segs.length > 1) cmds.push(docChange('sales_bill', bill.id, `출하 LOT별 나눔: ${ins.item} ${stockRound(Q)} → ${parts.map(p => `${p.lot || 'LOT 없음'} ${p.qty}`).join(' + ')}${rest > 0.000001 ? ` + ${rest}(출하 대기)` : ''}`, user));
  try { await db.batch(cmds); }
  catch (error) { if (isGuardError(error)) throw new HttpError(409, '그 사이 출하지시나 매출전표가 바뀌었습니다. 새로 불러오세요.'); throw error; }
  await mrAutoShip(user, parts.reduce((m, x) => (x.date || x.ship_date || '') > m ? (x.date || x.ship_date) : m, '') || today()).catch(() => {}); // 15.299
  return { shipped: parts.length, rest };
});
// 15.208 출하지시 수량 나누기(묶음 15.154와 같은 방식): 지시·전표 줄을 q와 나머지로 나눈다. 나머지는 같은 전표의 새 줄 + 새 출하지시(대기, 묶음 없음).
// 공급가액·세액은 비율로 나누고 남는 줄에 나머지를 몰아 전표 합계는 그대로. 검증하고 명령들을 돌려준다.
async function splitInstructionCmds(i, rawQty, user, why) {
  const q = stockRound(Number(rawQty));
  if (!Number.isFinite(q) || q <= 0) throw bad(`${i.item}(${i.customer}): 수량을 0보다 크게 넣으세요.`);
  if (q > Number(i.qty) + 0.000001) throw bad(`${i.item}(${i.customer}): 수량 ${q}이 지시 수량 ${stockRound(i.qty)}보다 많습니다.`);
  if (q >= Number(i.qty) - 0.000001) return { q: Number(i.qty), cmds: [] };
  const line = await db.prepare('SELECT * FROM sales_bill_lines WHERE id=?').get(i.bill_line_id), bill = await db.prepare('SELECT * FROM sales_bills WHERE id=?').get(i.bill_id);
  if (!line || !line.active || !bill || bill.status !== 'confirmed') throw new HttpError(409, `${i.item}: 매출전표가 취소됐거나 바뀌었습니다. 새로 불러오세요.`);
  if (Math.abs(Number(line.qty) - Number(i.qty)) > 0.000001) throw new HttpError(409, `${i.item}: 전표 수량(${stockRound(line.qty)})과 지시 수량(${stockRound(i.qty)})이 달라 나눌 수 없습니다. 전표를 확인하세요.`);
  if (await salesClosed(bill.customer, bill.bill_date)) throw bad(closedMessage(bill.customer, bill.bill_date, '수량을 나누세요'));
  const rest = stockRound(Number(i.qty) - q), supply = Math.round(Number(line.supply) * q / Number(line.qty)), vat = Math.round(Number(line.vat) * q / Number(line.qty));
  return { q, cmds: [
    { sql: 'UPDATE sales_bill_lines SET qty=?,supply=?,vat=? WHERE id=? AND active=1 AND qty=? AND supply=? AND vat=?', args: [q, supply, vat, line.id, line.qty, line.supply, line.vat] }, RC_GUARD,
    { sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note,order_line_id)
      SELECT bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,?,unit_price,?,?,note,order_line_id FROM sales_bill_lines WHERE id=?`, args: [rest, Number(line.supply) - supply, Number(line.vat) - vat, line.id] },
    { sql: "UPDATE ship_instructions SET qty=? WHERE id=? AND status='pending' AND qty=?", args: [q, i.id, i.qty] }, RC_GUARD,
    { sql: `INSERT INTO ship_instructions(bill_id,bill_line_id,order_line_id,customer,bom_id,product_code,item,spec,unit,qty,ship_date,note,created_by,held,hold_note,held_by,held_at)
      SELECT bill_id,(SELECT MAX(id) FROM sales_bill_lines WHERE bill_id=?),order_line_id,customer,bom_id,product_code,item,spec,unit,?,ship_date,note,created_by,held,hold_note,held_by,held_at FROM ship_instructions WHERE id=?`, args: [bill.id, rest, i.id] },
    docChange('sales_bill', bill.id, `${why}: ${i.item} ${stockRound(i.qty)} → ${q} + ${rest}(출하 대기)`, user)] };
}
// 15.104 출하지시 보류·해제(물류·영업): 대기 중인 지시만. 보류하면 출하 처리 목록과 배지에서 빠지고 전표·수주 잔량은 그대로.
route('POST', '/api/ship-instructions/:id/hold', async ({ user, params, body }) => {
  if (!hasRole(user, 'logistics') && !hasRole(user, 'sales')) throw new HttpError(403, '출하지시 보류는 물류·영업 담당자가 합니다.');
  const ins = await mustGet('ship_instructions', params.id);
  if (ins.status !== 'pending') throw bad('대기 중인 지시만 보류할 수 있습니다.');
  const on = body.held === undefined ? !ins.held : !!body.held, note = on ? str(body.note, 200) : '';
  const r = await db.prepare("UPDATE ship_instructions SET held=?,hold_note=?,held_by=?,held_at=? WHERE id=? AND status='pending'").run(on ? 1 : 0, note, on ? user.name : null, on ? now() : null, ins.id);
  if (!r.changes) throw new HttpError(409, '그 사이 지시가 처리되었습니다. 새로 불러오세요.');
  return mustGet('ship_instructions', ins.id);
});
// ── 15.132 출하지시(묶음): 대기 중인 출하지시 여러 줄을 한 장(DO-YYMMDD-NN)으로 묶어 피킹표로 출력하고 한 번에 출하 처리한다.
// 한 지시는 진행 중인 묶음 하나에만(batch_id). 묶음 풀기(cancelled)는 남은 대기 지시만 놓아 준다. 완료 여부는 지시 상태로 계산.
const canBatch = user => hasRole(user, 'logistics') || hasRole(user, 'sales');
const BATCH_STATS = `(SELECT COUNT(*) FROM ship_instructions i WHERE i.batch_id=sb.id) AS lines,
  (SELECT COUNT(*) FROM ship_instructions i WHERE i.batch_id=sb.id AND i.status='pending') AS pending,
  (SELECT COUNT(*) FROM ship_instructions i WHERE i.batch_id=sb.id AND i.status='shipped') AS shipped,
  (SELECT group_concat(DISTINCT i.customer) FROM ship_instructions i WHERE i.batch_id=sb.id) AS customers`;
const batchState = b => b.status === 'cancelled' ? 'cancelled' : b.pending > 0 ? (b.shipped > 0 ? 'partial' : 'open') : 'done';
async function batchDetail(id) {
  const b = await db.prepare(`SELECT sb.*, ${BATCH_STATS} FROM ship_batches sb WHERE sb.id=?`).get(id);
  if (!b) throw new HttpError(404, '묶음 출하지시를 찾을 수 없습니다.');
  const lines = await db.prepare(`SELECT i.*, bl.bill_no, o.order_no, o.customer_po, s.lot AS shipped_lot, s.ship_date AS shipped_date
    FROM ship_instructions i JOIN sales_bills bl ON bl.id=i.bill_id LEFT JOIN sales_order_lines ol ON ol.id=i.order_line_id LEFT JOIN sales_orders o ON o.id=ol.order_id LEFT JOIN shipments s ON s.id=i.shipment_id
    WHERE i.batch_id=? ORDER BY i.customer, i.item, i.id`).all(b.id);
  return { ...b, state: batchState(b), lines };
}
route('POST', '/api/ship-batches', async ({ user, body }) => {
  if (!canBatch(user)) throw new HttpError(403, '묶음 출하지시는 물류·영업 담당자가 만듭니다.');
  const key = str(body.request_id, 80);
  if (key) { const old = await db.prepare('SELECT id FROM ship_batches WHERE request_id=?').get(key); if (old) return { ...await batchDetail(old.id), duplicate: true }; }
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number))] : [];
  if (!ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('묶을 출하지시를 1~50건 고르세요(한 번에 출하 처리할 수 있는 수).');
  const plan = dateStr(body.plan_date || today(), '출고 예정일');
  // 15.154 수량 나눠 묶기: qtys[id]가 지시 수량보다 적으면 그 수량만 이 지시서에 묶고, 나머지는 같은 전표의 새 줄 + 새 출하지시(대기)로 남긴다.
  // 전표 줄도 둘로 나눈다(출하 1건 = 전표 줄 1줄 = 출고일·LOT 1개). 공급가액·세액은 비율로 나누고 나머지를 남는 줄에 몰아 전표 합계는 1원도 안 바뀐다.
  const qtys = body.qtys && typeof body.qtys === 'object' ? body.qtys : {}, splits = [];
  for (const id of ids) {
    const i = await db.prepare('SELECT i.*, b.batch_no FROM ship_instructions i LEFT JOIN ship_batches b ON b.id=i.batch_id AND b.status=\'open\' WHERE i.id=?').get(id);
    if (!i || i.status !== 'pending') throw new HttpError(409, '이미 출하됐거나 취소된 지시가 있습니다. 새로 불러오세요.');
    if (i.batch_no) throw new HttpError(409, `${i.item}(${i.customer}): 이미 묶음 출하지시 ${i.batch_no}에 묶여 있습니다.`);
    const raw = qtys[id]; if (raw === undefined || raw === null || raw === '') continue;
    const q = stockRound(Number(raw));
    if (!Number.isFinite(q) || q <= 0) throw bad(`${i.item}(${i.customer}): 묶을 수량을 0보다 크게 넣으세요.`);
    if (q > Number(i.qty) + 0.000001) throw bad(`${i.item}(${i.customer}): 묶을 수량 ${q}이 지시 수량 ${stockRound(i.qty)}보다 많습니다.`);
    if (q >= Number(i.qty) - 0.000001) continue;
    const line = await db.prepare('SELECT * FROM sales_bill_lines WHERE id=?').get(i.bill_line_id), bill = await db.prepare('SELECT * FROM sales_bills WHERE id=?').get(i.bill_id);
    if (!line || !line.active || !bill || bill.status !== 'confirmed') throw new HttpError(409, `${i.item}: 매출전표가 취소됐거나 바뀌었습니다. 새로 불러오세요.`);
    if (Math.abs(Number(line.qty) - Number(i.qty)) > 0.000001) throw new HttpError(409, `${i.item}: 전표 수량(${stockRound(line.qty)})과 지시 수량(${stockRound(i.qty)})이 달라 나눌 수 없습니다. 전부 묶거나 전표를 확인하세요.`);
    if (await salesClosed(bill.customer, bill.bill_date)) throw bad(closedMessage(bill.customer, bill.bill_date, '수량을 나눠 묶으세요'));
    const rest = stockRound(Number(i.qty) - q), supply = Math.round(Number(line.supply) * q / Number(line.qty)), vat = Math.round(Number(line.vat) * q / Number(line.qty));
    splits.push({ i, line, bill, q, rest, supply, vat, restSupply: Number(line.supply) - supply, restVat: Number(line.vat) - vat });
  }
  const token = key || 'srv:' + crypto.randomUUID(), prefix = `DO-${plan.slice(2).replace(/-/g, '')}-`, BID = '(SELECT id FROM ship_batches WHERE request_id=?)';
  const cmds = [{ sql: `INSERT INTO ship_batches(batch_no,plan_date,note,request_id,created_by) VALUES(${nextDocNo('ship_batches', 'batch_no')},?,?,?,?)`, args: [prefix, prefix, prefix, plan, str(body.note, 300), token, user.name] }];
  for (const { i, line, bill, q, rest, supply, vat, restSupply, restVat } of splits) cmds.push(
    { sql: 'UPDATE sales_bill_lines SET qty=?,supply=?,vat=? WHERE id=? AND active=1 AND qty=? AND supply=? AND vat=?', args: [q, supply, vat, line.id, line.qty, line.supply, line.vat] }, RC_GUARD,
    { sql: `INSERT INTO sales_bill_lines(bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,qty,unit_price,supply,vat,note,order_line_id)
      SELECT bill_id,item_category,source_type,source_id,item,spec,unit,product_code,lot,ship_date,?,unit_price,?,?,note,order_line_id FROM sales_bill_lines WHERE id=?`, args: [rest, restSupply, restVat, line.id] },
    { sql: "UPDATE ship_instructions SET qty=? WHERE id=? AND status='pending' AND qty=?", args: [q, i.id, i.qty] }, RC_GUARD,
    { sql: `INSERT INTO ship_instructions(bill_id,bill_line_id,order_line_id,customer,bom_id,product_code,item,spec,unit,qty,ship_date,note,created_by,held,hold_note,held_by,held_at)
      SELECT bill_id,(SELECT MAX(id) FROM sales_bill_lines WHERE bill_id=?),order_line_id,customer,bom_id,product_code,item,spec,unit,?,ship_date,note,created_by,held,hold_note,held_by,held_at FROM ship_instructions WHERE id=?`, args: [bill.id, rest, i.id] },
    docChange('sales_bill', bill.id, `출하지시 묶음으로 줄 나눔: ${i.item} ${stockRound(i.qty)} → ${q}(묶음) + ${rest}(출하 대기)`, user));
  for (const id of ids) cmds.push({ sql: `UPDATE ship_instructions SET batch_id=${BID} WHERE id=? AND status='pending' AND (batch_id IS NULL OR batch_id IN (SELECT id FROM ship_batches WHERE status='cancelled'))`, args: [token, id] }, RC_GUARD);
  try { await db.batch(cmds); }
  catch (error) { if (isGuardError(error) || /UNIQUE/i.test(String(error?.message))) throw new HttpError(409, '그 사이 다른 묶음 출하지시에 묶였거나 출하된 지시가 있습니다. 새로 불러오세요.'); throw error; }
  return batchDetail((await db.prepare('SELECT id FROM ship_batches WHERE request_id=?').get(token)).id);
});
route('GET', '/api/ship-batches', async ({ query }) => {
  const where = [], args = [];
  if (query.status === 'cancelled') where.push("sb.status='cancelled'"); else if (query.status !== 'all') where.push("sb.status='open'");
  applyListDates(where, args, query, 'sb.plan_date');
  applyListKeyword(where, args, query.q, ['sb.batch_no', 'sb.note']);
  let rows = await db.prepare(`SELECT sb.*, ${BATCH_STATS} FROM ship_batches sb ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sb.plan_date DESC, sb.id DESC LIMIT 301`).all(...args);
  rows = rows.map(b => ({ ...b, state: batchState(b) }));
  if (query.state) rows = rows.filter(b => query.state === 'todo' ? ['open', 'partial'].includes(b.state) : b.state === query.state);
  // 15.205 묶음 목록에 품목 줄도(items=1): 「출하지시(묶음) DO-… 」 아래 품목을 바로 보이게
  if (query.items === '1' && rows.length) {
    const ids = rows.slice(0, 300).map(b => b.id), lines = await db.prepare(`SELECT i.id, i.batch_id, i.item, i.spec, i.qty, i.unit, i.customer, i.status, i.held, i.product_code, s.lot AS shipped_lot FROM ship_instructions i LEFT JOIN shipments s ON s.id=i.shipment_id WHERE i.batch_id IN (${ids.map(() => '?').join(',')}) ORDER BY i.customer, i.item, i.id`).all(...ids);
    for (const b of rows) b.items = lines.filter(l => l.batch_id === b.id);
  }
  return { rows: rows.slice(0, 300), more: rows.length > 300 };
});
route('GET', '/api/ship-batches/:id', async ({ params }) => batchDetail(Number(params.id)));
// 묶음에서 빼기(대기 중인 줄만) · 묶음 풀기(남은 대기 줄을 모두 놓아 주고 cancelled)
route('POST', '/api/ship-batches/:id/remove', async ({ user, params, body }) => {
  if (!canBatch(user)) throw new HttpError(403, '묶음 출하지시는 물류·영업 담당자가 고칩니다.');
  const b = await mustGet('ship_batches', params.id); if (b.status !== 'open') throw bad('풀린 묶음 출하지시입니다.');
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number))] : [];
  if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('뺄 줄을 고르세요.');
  try { await db.batch(ids.flatMap(id => [{ sql: "UPDATE ship_instructions SET batch_id=NULL WHERE id=? AND batch_id=? AND status='pending'", args: [id, b.id] }, RC_GUARD])); }
  catch (error) { if (isGuardError(error)) throw new HttpError(409, '출하된 줄은 뺄 수 없습니다. 새로 불러오세요.'); throw error; }
  return batchDetail(b.id);
});
route('POST', '/api/ship-batches/:id/cancel', async ({ user, params }) => {
  if (!canBatch(user)) throw new HttpError(403, '묶음 출하지시는 물류·영업 담당자가 고칩니다.');
  const b = await mustGet('ship_batches', params.id); if (b.status !== 'open') throw bad('이미 풀린 묶음 출하지시입니다.');
  await db.batch([
    { sql: "UPDATE ship_batches SET status='cancelled',cancelled_by=?,cancelled_at=? WHERE id=? AND status='open'", args: [user.name, now(), b.id] }, RC_GUARD,
    { sql: "UPDATE ship_instructions SET batch_id=NULL WHERE batch_id=? AND status='pending'", args: [b.id] },
  ]).catch(error => { if (isGuardError(error)) throw new HttpError(409, '그 사이 풀렸습니다. 새로 불러오세요.'); throw error; });
  return batchDetail(b.id);
});
// 거래처코드: 비어 있는 거래처에 자동 번호(C0001…)를 채운다(관리자, 직접 누를 때만)
route('POST', '/api/vendors/fill-codes', async ({ user }) => {
  requireAdmin(user);
  const blank = await db.prepare("SELECT id FROM vendors WHERE code='' ORDER BY name LIMIT 2000").all();
  for (const part of inChunks(blank.map(v => v.id))) await db.batch(part.map(id => ({ sql: `UPDATE vendors SET code=${VENDOR_AUTO_CODE} WHERE id=? AND code=''`, args: [id] })));
  return { filled: blank.length };
});
route('POST', '/api/production-requests', async ({ user, body }) => {
  const requestId = str(body.request_id, 80);
  const prior = await savedByRequestId('production_requests', requestId, user, '생산의뢰');
  if (prior) return { ...await mrDetail(prior, user), duplicate: true };
  const head = mrHead(body), lines = await mrLines(body.lines);
  let so = null; if (body.sales_order_id !== undefined && body.sales_order_id !== null && body.sales_order_id !== '') { if (!/^[1-9]\d*$/.test(String(body.sales_order_id))) throw bad('연결할 수주를 다시 고르세요.'); so = await db.prepare('SELECT id, order_no FROM sales_orders WHERE id=?').get(Number(body.sales_order_id)); if (!so) throw bad('연결할 수주를 찾을 수 없습니다.'); } // 15.299 수주 → 생산의뢰
  const prefix = 'MR-' + head.order_date.slice(2).replace(/-/g, '') + '-';
  // 줄은 의뢰를 request_id로 찾아 붙인다. 화면이 보내지 않은 경우에도 서버 토큰으로 채운다.
  const token = requestId || 'srv:' + crypto.randomUUID();
  try {
    await db.batch([
      { sql: `INSERT INTO production_requests(req_no,order_date,customer,order_no,ship_text,ship_date,spec,note,author_id,author_name,author_department,request_id,sales_order_id,sales_order_no) VALUES(${nextDocNo('production_requests', 'req_no')},?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [prefix, prefix, prefix, head.order_date, head.customer, head.order_no, head.ship_text, head.ship_date, head.spec, head.note, user.id, user.name, user.department || '', token, so ? so.id : null, so ? so.order_no : ''] },
      ...lines.map(l => ({ sql: 'INSERT INTO production_request_lines(request_id,line_no,bom_id,product_code,item,spec,unit,qty) SELECT id,?,?,?,?,?,?,? FROM production_requests WHERE request_id=?', args: [l.line_no, l.bom_id, l.product_code, l.item, l.spec, l.unit, l.qty, token] })),
    ]);
  } catch (error) {
    // 같은 request_id가 동시에 두 번 들어오면 하나만 저장되고 나머지는 저장된 의뢰를 받는다.
    const done = String(error.message).includes('UNIQUE') && await savedByRequestId('production_requests', requestId, user, '생산의뢰');
    if (done) return { ...await mrDetail(done, user), duplicate: true };
    throw error;
  }
  await ensureVendor(head.customer, user, 'sales');
  return mrDetail(await db.prepare('SELECT * FROM production_requests WHERE request_id=?').get(token), user);
});
const MR_LINKED = 'EXISTS(SELECT 1 FROM schedules s JOIN production_request_lines l ON l.id=s.production_line_id WHERE l.request_id=?)';
async function mrEditable(user, id) {
  const row = await mustGet('production_requests', id);
  if (!(user.is_admin || row.author_id === user.id)) throw new HttpError(403, '작성자만 고칠 수 있습니다.');
  if (row.shipped) throw bad('출고 완료된 의뢰는 고치거나 지울 수 없습니다. 고쳐야 하면 먼저 「출고 취소」를 하세요.');
  if (await db.prepare(`SELECT ${MR_LINKED} AS x`).get(row.id).then(r => r.x)) throw bad('이미 생산계획에 반영된 의뢰는 고치거나 지울 수 없습니다. 생산 담당자와 일정을 먼저 정리하세요.');
  return row;
}
// batch 실패 뒤 이유를 다시 확인한다(출고·계획 반영이면 그 안내, 아니면 동시 수정 충돌).
async function mrConflict(user, id) {
  await mrEditable(user, id);
  return new HttpError(409, '다른 곳에서 의뢰가 바뀌었습니다. 다시 열어 확인하세요.');
}
route('PUT', '/api/production-requests/:id', async ({ user, params, body }) => {
  const row = await mrEditable(user, params.id);
  const revision = body.revision !== undefined ? Number(body.revision) : row.revision;
  if (revision !== row.revision) throw new HttpError(409, '다른 곳에서 의뢰가 바뀌었습니다. 다시 열어 확인하세요.');
  const head = mrHead(body, row), lines = await mrLines(body.lines, await db.prepare('SELECT bom_id, spec FROM production_request_lines WHERE request_id=?').all(row.id));
  const guard = `EXISTS(SELECT 1 FROM production_requests WHERE id=? AND revision=? AND shipped=0) AND NOT ${MR_LINKED}`, guardArgs = [row.id, revision, row.id];
  const result = await db.batch([
    { sql: `DELETE FROM production_request_lines WHERE request_id=? AND ${guard}`, args: [row.id, ...guardArgs] },
    ...lines.map(l => ({ sql: `INSERT INTO production_request_lines(request_id,line_no,bom_id,product_code,item,spec,unit,qty) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`, args: [row.id, l.line_no, l.bom_id, l.product_code, l.item, l.spec, l.unit, l.qty, ...guardArgs] })),
    { sql: `UPDATE production_requests SET order_date=?,customer=?,order_no=?,ship_text=?,ship_date=?,spec=?,note=?,revision=revision+1,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=? AND shipped=0 AND NOT ${MR_LINKED}`, args: [head.order_date, head.customer, head.order_no, head.ship_text, head.ship_date, head.spec, head.note, row.id, revision, row.id] },
  ]);
  if (!result.at(-1).meta.changes) throw await mrConflict(user, row.id);
  await ensureVendor(head.customer, user, 'sales');
  return mrDetail(await mustGet('production_requests', row.id), user);
});
route('DELETE', '/api/production-requests/:id', async ({ user, params, query }) => {
  const row = await mrEditable(user, params.id);
  const revision = query.revision !== undefined && query.revision !== '' ? Number(query.revision) : row.revision;
  if (revision !== row.revision) throw new HttpError(409, '다른 곳에서 의뢰가 바뀌었습니다. 다시 열어 확인하세요.');
  const guard = `EXISTS(SELECT 1 FROM production_requests WHERE id=? AND revision=? AND shipped=0) AND NOT ${MR_LINKED}`;
  const result = await db.batch([
    { sql: `DELETE FROM production_request_lines WHERE request_id=? AND ${guard}`, args: [row.id, row.id, revision, row.id] },
    { sql: `DELETE FROM production_requests WHERE id=? AND revision=? AND shipped=0 AND NOT ${MR_LINKED}`, args: [row.id, revision, row.id] },
  ]);
  if (!result.at(-1).meta.changes) throw await mrConflict(user, row.id);
  return { ok: true };
});
// 생산계획 반영: 아직 계획되지 않은 수량만큼 생산일정을 만든다(생산 담당). 일정은 의뢰 줄에 연결된다.
// 같은 의뢰를 두 탭·두 사람이 동시에 반영해도 한 번만 들어간다: 일정 INSERT는 「읽은 revision·그 줄의 계획 합계가 그대로」일 때만,
// 마지막 문장이 revision을 올린다. 먼저 끝난 반영이 revision을 올리면 나중 요청의 INSERT는 하나도 적용되지 않는다.
route('POST', '/api/production-requests/:id/plan', async ({ user, params, body }) => {
  if (!hasRole(user, 'production')) throw new HttpError(403, '생산 담당자만 생산계획에 반영할 수 있습니다.');
  const row = await mustGet('production_requests', params.id);
  if (row.shipped) throw bad('출고 완료된 의뢰입니다.');
  if (body.revision !== undefined && Number(body.revision) !== row.revision) throw new HttpError(409, '다른 곳에서 의뢰가 바뀌었거나 이미 반영되었습니다. 다시 열어 확인하세요.');
  const wanted = Array.isArray(body.line_ids) ? body.line_ids.map(Number) : null;
  const lines = (await mrLineProgress([row.id])).filter(l => l.planned_qty < l.qty && (!wanted || wanted.includes(l.id)));
  if (!lines.length) throw bad('생산계획에 반영할 남은 수량이 없습니다.');
  const period = String(body.period || 'week'); if (!['day', 'week', 'month'].includes(period)) throw bad('일간/주간/월간을 선택하세요.');
  const startDate = dateStr(body.start_date, '시작일');
  const guard = 'EXISTS(SELECT 1 FROM production_requests WHERE id=? AND revision=? AND shipped=0)';
  const commands = [];
  for (const l of lines) {
    const bom = l.bom_id ? await db.prepare('SELECT * FROM boms WHERE id=?').get(l.bom_id) : null;
    const kind = ['finished', 'semi'].includes(body.kind) ? body.kind : bom && bom.kind === 'semi' && bom.item_category === '반제품' ? 'semi' : 'finished';
    const note = [`생산의뢰 ${row.req_no}`, row.customer, row.order_no, row.spec].filter(Boolean).join(' · ').slice(0, 500);
    const f = await schedFields({ kind, period, start_date: startDate, product: l.item, qty: l.qty - l.planned_qty, note, bom_id: bom && bom.active && bom.kind === kind ? bom.id : null });
    const record = { kind: f.kind, period: f.period, start_date: f.start_date, product: f.product, qty: f.qty, note: f.note, bom_id: f.bom_id, bom_snapshot: f.bom_snapshot, spec: l.spec, unit: l.unit || (f.bom_id ? JSON.parse(f.bom_snapshot).unit || '' : ''), lot: '', batch_id: '', created_by: user.name, production_line_id: l.id };
    const columns = Object.keys(record);
    commands.push({ sql: `INSERT INTO schedules(${columns.join(',')}) SELECT ${columns.map(() => '?').join(',')} WHERE ${guard}
        AND EXISTS(SELECT 1 FROM production_request_lines WHERE id=? AND request_id=? AND qty=?) AND COALESCE((SELECT SUM(qty) FROM schedules WHERE production_line_id=?),0)=?`,
      args: [...Object.values(record), row.id, row.revision, l.id, row.id, l.qty, l.id, l.planned_qty] });
  }
  commands.push({ sql: "UPDATE production_requests SET revision=revision+1,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=? AND shipped=0", args: [row.id, row.revision] });
  const result = await db.batch(commands);
  if (!result.at(-1).meta.changes) {
    const now = await mustGet('production_requests', row.id);
    if (now.shipped) throw bad('출고 완료된 의뢰입니다.');
    throw new HttpError(409, '다른 곳에서 의뢰가 바뀌었거나 이미 생산계획에 반영되었습니다. 다시 열어 확인하세요.');
  }
  return mrDetail(await mustGet('production_requests', row.id), user);
});
// 출고 완료 체크(출고여부·출고일). 작성자·물류·생산 담당.
route('POST', '/api/production-requests/:id/ship', async ({ user, params, body }) => {
  const row = await mustGet('production_requests', params.id);
  if (!(user.is_admin || row.author_id === user.id || hasRole(user, 'logistics') || hasRole(user, 'production'))) throw new HttpError(403, '작성자·물류·생산 담당자만 출고를 표시할 수 있습니다.');
  if (body.shipped) {
    const date = dateStr(body.shipped_date, '출고일');
    await db.prepare("UPDATE production_requests SET shipped=1,shipped_date=?,shipped_by=?,revision=revision+1,updated_at=datetime('now','+9 hours') WHERE id=?").run(date, user.name, row.id);
  } else await db.prepare("UPDATE production_requests SET shipped=0,shipped_date=NULL,shipped_by='',revision=revision+1,updated_at=datetime('now','+9 hours') WHERE id=?").run(row.id);
  return mrDetail(await mustGet('production_requests', row.id), user);
});

// ── 영업: 구매의뢰 (전자결재) ──
// 작성자가 결재(순서대로) → 합의(순서대로) 결재선을 지정해 상신한다. 지금 차례인 사람만 승인·반려할 수 있다.
// 반려되면 작성자가 고쳐 다시 올리고 결재는 처음부터 다시 진행한다. 참조자는 열람만 하며 열면 read_at이 남는다.
// 최종 승인된 의뢰는 구매 담당자가 「발주 생성」으로 발주목록에 올린다(구매의뢰번호 = 의뢰서 번호).
const PR_PAGE = 200;
const PR_TEXT = { delivery_qty: 50, customer: 200, stock_qty: 50, due_text: 50, manager: 50, monthly_usage: 50 };
async function prItems(list, prior = []) {
  if (!Array.isArray(list) || !list.length) throw bad('품목을 1개 이상 입력하세요.');
  if (list.length > 30) throw bad('품목은 30개까지 입력할 수 있습니다.');
  const items = [], sizesOf = await sizeSets();
  for (const [index, raw] of list.entries()) {
    const it = raw && typeof raw === 'object' ? raw : {}, no = `${index + 1}번 품목`;
    let bom = null;
    if (it.bom_id !== undefined && it.bom_id !== null && it.bom_id !== '') {
      const id = Number(it.bom_id); if (!Number.isSafeInteger(id) || id <= 0) throw bad(`${no}의 품목을 다시 선택하세요.`);
      bom = await mustGet('boms', id); if (!bom.active) throw bad(`${no}은(는) 사용 중지된 품목입니다.`);
    }
    const qty = num(it.qty, `${no} 수량`); if (!(qty > 0)) throw bad(`${no} 수량은 0보다 커야 합니다.`);
    const row = {
      line_no: index + 1, bom_id: bom ? bom.id : null,
      product_code: bom ? bom.product_code : str(it.product_code, 50),
      item: bom ? bom.product : reqStr(it.item, `${no} 품목명`, 200),
      spec: bom ? lockedSpec(bom, sizesOf(bom.item_category, [bom.cat1, bom.cat2, bom.cat3]), it.spec, no, prior) : str(it.spec, 200),
      unit: bom && bom.unit ? bom.unit : str(it.unit, 20) || (bom ? bom.unit : ''), qty,
      purchase_price: num(it.purchase_price, `${no} 매입단가`, { required: false }),
      sale_price: num(it.sale_price, `${no} 판매단가`, { required: false }),
      vendor: str(it.vendor, 100),
    };
    for (const [key, max] of Object.entries(PR_TEXT)) row[key] = str(it[key], max);
    items.push(row);
  }
  return items;
}
async function prLines(body, authorId) {
  const ids = key => (Array.isArray(body[key]) ? body[key] : []).map(Number);
  const approve = ids('approvers'), agree = ids('agreers'), cc = ids('cc'), all = [...approve, ...agree, ...cc];
  if (!approve.length) throw bad('결재자를 1명 이상 지정하세요.');
  if (approve.length + agree.length > 10) throw bad('결재·합의는 모두 10명까지 지정할 수 있습니다.');
  if (cc.length > 20) throw bad('참조는 20명까지 지정할 수 있습니다.');
  if (all.some(id => !Number.isSafeInteger(id) || id <= 0)) throw bad('결재선의 사용자를 다시 선택하세요.');
  if (new Set(all).size !== all.length) throw bad('같은 사람을 결재·합의·참조에 중복 지정할 수 없습니다.');
  if (all.includes(authorId)) throw bad('작성자 본인은 결재선에 넣을 수 없습니다. 기안자로 자동 표시됩니다.');
  const found = await db.prepare(`SELECT id,name,position FROM users WHERE approval_status='approved' AND id IN (${all.map(() => '?').join(',')})`).all(...all);
  if (found.length !== all.length) throw bad('결재선에 가입 승인되지 않았거나 없는 사용자가 있습니다. 다시 선택하세요.');
  const byId = new Map(found.map(u => [u.id, u])); let step = 0;
  return [...approve.map(id => ['approve', ++step, id]), ...agree.map(id => ['agree', ++step, id]), ...cc.map(id => ['cc', 0, id])]
    .map(([kind, s, id]) => ({ kind, step: s, user_id: id, user_name: byId.get(id).name, user_position: byId.get(id).position || '' }));
}
// 의뢰부서·요청자는 입력받지 않고 작성자의 조직 정보(가입·조직 구성)를 상신 당시 값으로 남긴다.
function prHead(body, author) {
  return { doc_date: dateStr(body.doc_date, '작성일'), department: author.department || '', title: str(body.title, 200), note: str(body.note, 2000), freight: JSON.stringify(freightMap(body.freight)) };
}
async function prAccess(user, id, { write = false } = {}) {
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw bad('구매의뢰 번호가 올바르지 않습니다.');
  const row = await mustGet('purchase_requests', Number(id));
  if (write) { if (!(user.is_admin || row.author_id === user.id)) throw new HttpError(403, '작성자만 고칠 수 있습니다.'); return row; }
  if (user.is_admin || row.author_id === user.id || (row.status === 'approved' && hasRole(user, 'purchase'))) return row;
  if (await db.prepare('SELECT 1 FROM purchase_request_lines WHERE request_id=? AND user_id=?').get(row.id, user.id)) return row;
  throw new HttpError(403, '작성자·결재선에 지정된 사람·구매 담당자만 볼 수 있습니다.');
}
// 품목·결재선 INSERT. where는 붙일 의뢰서를 고르는 조건(새 의뢰서는 request_id, 고치기는 id·revision 조건)이다.
function prInsertDetails(where, whereArgs, items, lines) {
  const qs = [];
  for (const it of items) qs.push({ sql: `INSERT INTO purchase_request_items(request_id,line_no,bom_id,product_code,item,spec,unit,qty,purchase_price,sale_price,vendor,delivery_qty,customer,stock_qty,due_text,manager,monthly_usage)
    SELECT id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM purchase_requests WHERE ${where}`, args: [it.line_no, it.bom_id, it.product_code, it.item, it.spec, it.unit, it.qty, it.purchase_price, it.sale_price, it.vendor, it.delivery_qty, it.customer, it.stock_qty, it.due_text, it.manager, it.monthly_usage, ...whereArgs] });
  for (const l of lines) qs.push({ sql: `INSERT INTO purchase_request_lines(request_id,kind,step,user_id,user_name,user_position) SELECT id,?,?,?,?,? FROM purchase_requests WHERE ${where}`, args: [l.kind, l.step, l.user_id, l.user_name, l.user_position, ...whereArgs] });
  return qs;
}
function prFreight(row) { try { const f = JSON.parse(row.freight || '{}'); return f && typeof f === 'object' && !Array.isArray(f) ? f : {}; } catch { return {}; } }
async function prDetail(row, user) {
  const items = await db.prepare('SELECT * FROM purchase_request_items WHERE request_id=? ORDER BY line_no').all(row.id);
  const lines = await db.prepare('SELECT * FROM purchase_request_lines WHERE request_id=? ORDER BY kind=\'cc\', step, id').all(row.id);
  const sum = key => items.reduce((total, it) => total + (it[key] == null ? 0 : it[key] * it.qty), 0);
  const current = row.status === 'pending' ? lines.find(l => l.step === row.current_step && l.kind !== 'cc') : null;
  const freight = prFreight(row);
  return {
    ...row, photos: JSON.parse(row.photos || '[]'), items, lines, purchase_total: sum('purchase_price'), sale_total: sum('sale_price'), freight, freight_total: Object.values(freight).reduce((t, n) => t + n, 0),
    current_user_id: current ? current.user_id : null, current_user_name: current ? current.user_name : '',
    can_decide: !!(current && user && current.user_id === user.id),
    can_edit: !!(user && (user.is_admin || row.author_id === user.id) && (row.status === 'rejected' || (row.status === 'pending' && !lines.some(l => l.decision)))),
    can_delete: !!(user && (user.is_admin || row.author_id === user.id) && row.status !== 'approved'),
    can_order: !!(user && row.status === 'approved' && hasRole(user, 'purchase') && items.some(it => !it.po_id && !it.order_closed)),
  };
}
// 15.185 결재선 기본값: 문서 종류별로 「작성자 직급 → 결재·합의·참조 단계」를 미리 정해 둔다. 단계는 직급(작성자 부서→상위 부서에서 찾음) 또는 특정 사람.
// 화면은 새 문서를 쓸 때 이 규칙으로 결재선을 채워 줄 뿐이고, 상신할 때는 지금처럼 고른 사람으로 검사한다.
const APPROVAL_DOCS = ['purchase_request'];
function validApprovalRules(body) {
  const out = {};
  for (const doc of APPROVAL_DOCS) {
    const list = body?.[doc] ?? []; if (!Array.isArray(list) || list.length > 30) throw bad('결재선 규칙은 문서마다 30개까지입니다.');
    out[doc] = list.map(rule => {
      if (!rule || typeof rule !== 'object') throw bad('결재선 규칙을 확인하세요.');
      const steps = kind => { const s = rule[kind] ?? []; if (!Array.isArray(s) || s.length > 8) throw bad('단계는 8개까지입니다.');
        return s.map(st => { if (st?.type === 'position') return { type: 'position', position: reqStr(st.position, '직급', 30) }; if (st?.type === 'user' && Number.isSafeInteger(Number(st.user_id)) && Number(st.user_id) > 0) return { type: 'user', user_id: Number(st.user_id) }; throw bad('단계는 직급 또는 사람으로 고르세요.'); }); };
      const r = { when_position: str(rule.when_position, 30), approve: steps('approve'), agree: steps('agree'), cc: steps('cc') };
      if (!r.approve.length) throw bad('결재 단계를 1개 이상 넣으세요.');
      return r;
    });
  }
  return out;
}
route('GET', '/api/approval-rules', async () => { const raw = await getSetting('approval_rules'); try { return { purchase_request: [], ...(raw ? JSON.parse(raw) : {}) }; } catch { return { purchase_request: [] }; } });
route('PUT', '/api/approval-rules', async ({ user, body }) => { requireAdmin(user); const v = validApprovalRules(body); await setSetting('approval_rules', JSON.stringify(v)); return v; });
route('GET', '/api/directory', async () => (await db.prepare("SELECT id,name,position,department FROM users WHERE approval_status='approved' ORDER BY name").all()));
route('GET', '/api/purchase-requests', async ({ user, query }) => {
  const where = [], args = [];
  const box = String(query.box || '');
  if (box === 'todo') { where.push("pr.status='pending' AND EXISTS(SELECT 1 FROM purchase_request_lines l WHERE l.request_id=pr.id AND l.step=pr.current_step AND l.kind!='cc' AND l.user_id=?)"); args.push(user.id); }
  else if (box === 'mine') { where.push('pr.author_id=?'); args.push(user.id); }
  else if (box === 'cc') { where.push("EXISTS(SELECT 1 FROM purchase_request_lines l WHERE l.request_id=pr.id AND l.kind='cc' AND l.user_id=?)"); args.push(user.id); }
  else if (box === 'order') { if (!hasRole(user, 'purchase')) throw new HttpError(403, '구매 담당자만 발주 대기 목록을 볼 수 있습니다.'); where.push("pr.status='approved' AND EXISTS(SELECT 1 FROM purchase_request_items i WHERE i.request_id=pr.id AND i.po_id IS NULL AND i.order_closed='')"); }
  else if (box) throw bad('목록 구분을 확인하세요.');
  if (!user.is_admin) {
    where.push(`(pr.author_id=? OR EXISTS(SELECT 1 FROM purchase_request_lines l WHERE l.request_id=pr.id AND l.user_id=?)${hasRole(user, 'purchase') ? " OR pr.status='approved'" : ''})`);
    args.push(user.id, user.id);
  }
  if (query.status) { if (!['pending', 'approved', 'rejected'].includes(query.status)) throw bad('결재 상태를 확인하세요.'); where.push('pr.status=?'); args.push(query.status); }
  applyListDates(where, args, query, 'pr.doc_date');
  const q = String(query.q || '').trim();
  if (q) {
    if (q.length > 200) throw bad('검색어는 200자까지 입력하세요.');
    const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    where.push("(pr.doc_no LIKE ? ESCAPE '\\' OR pr.sales_order_no LIKE ? ESCAPE '\\' OR pr.title LIKE ? ESCAPE '\\' OR pr.department LIKE ? ESCAPE '\\' OR pr.author_name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM purchase_request_items i WHERE i.request_id=pr.id AND (i.item LIKE ? ESCAPE '\\' OR i.product_code LIKE ? ESCAPE '\\' OR i.vendor LIKE ? ESCAPE '\\' OR i.customer LIKE ? ESCAPE '\\')))");
    args.push(...Array(9).fill(pattern));
  }
  // 200건씩 page로 나눈다. 화면은 paged=1로 {rows, page, more}를 받아 「더 보기」를 붙인다(paged 없이 부르면 첫 페이지 배열).
  const page = query.page === undefined || query.page === '' ? 0 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000) throw bad('페이지 번호를 확인하세요.');
  const found = await db.prepare(`SELECT pr.* FROM purchase_requests pr ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pr.id DESC LIMIT ? OFFSET ?`).all(...args, PR_PAGE + 1, page * PR_PAGE);
  const more = found.length > PR_PAGE, rows = found.slice(0, PR_PAGE);
  const wrap = out => query.paged === '1' ? { rows: out, page, more } : out;
  if (!rows.length) return wrap([]);
  // D1 매개변수 한도(100개) 안에서 나눠 읽는다.
  const items = [], lines = [];
  for (const ids of inChunks(rows.map(r => r.id))) {
    const marks = ids.map(() => '?').join(',');
    items.push(...await db.prepare(`SELECT id,request_id,line_no,bom_id,item,product_code,spec,qty,unit,purchase_price,sale_price,vendor,customer,due_text,po_id,order_closed FROM purchase_request_items WHERE request_id IN (${marks}) ORDER BY line_no`).all(...ids));
    lines.push(...await db.prepare(`SELECT request_id,kind,step,user_id,user_name,user_position,decision,read_at FROM purchase_request_lines WHERE request_id IN (${marks}) ORDER BY step, id`).all(...ids));
  }
  return wrap(rows.map(row => {
    const its = items.filter(i => i.request_id === row.id), ls = lines.filter(l => l.request_id === row.id);
    const current = row.status === 'pending' ? ls.find(l => l.step === row.current_step && l.kind !== 'cc') : null;
    return {
      ...row, photos: undefined, photo_count: JSON.parse(row.photos || '[]').length, item_count: its.length, first_item: its[0]?.item || '', vendors: [...new Set(its.map(i => i.vendor).filter(Boolean))].join(', '),
      customers: [...new Set(its.map(i => i.customer).filter(Boolean))].join(', '),
      purchase_total: its.reduce((t, i) => t + (i.purchase_price == null ? 0 : i.purchase_price * i.qty), 0),
      sale_total: its.reduce((t, i) => t + (i.sale_price == null ? 0 : i.sale_price * i.qty), 0),
      freight: prFreight(row), freight_total: Object.values(prFreight(row)).reduce((t, n) => t + n, 0),
      ordered: its.filter(i => i.po_id).length, closed: its.filter(i => !i.po_id && i.order_closed).length,
      current_user_id: current ? current.user_id : null, current_user_name: current ? current.user_name : '',
      my_turn: !!(current && current.user_id === user.id),
      // 발주 대기(box=order): 구매 발주 입력 화면이 품목을 골라 바로 발주로 만들 수 있게 아직 발주하지 않은 품목을 함께 준다.
      ...(box === 'order' ? { open_items: its.filter(i => !i.po_id && !i.order_closed).map(({ request_id, po_id, order_closed, ...it }) => it) } : {}),
    };
  }));
});
route('GET', '/api/purchase-requests/:id', async ({ user, params }) => {
  const row = await prAccess(user, params.id);
  // 참조자·결재자가 처음 열면 열람 시각을 남긴다(참조 ✓ 표시).
  await db.prepare("UPDATE purchase_request_lines SET read_at=datetime('now','+9 hours') WHERE request_id=? AND user_id=? AND read_at IS NULL").run(row.id, user.id);
  return prDetail(row, user);
});
route('POST', '/api/purchase-requests', async ({ user, body }) => {
  const requestId = str(body.request_id, 80);
  const prior = await savedByRequestId('purchase_requests', requestId, user, '구매의뢰서');
  if (prior) return { ...await prDetail(prior, user), duplicate: true };
  const head = prHead(body, user), items = await prItems(body.items), lines = await prLines(body, user.id);
  // 15.284 수주에서 만든 구매의뢰: 수주 번호를 함께 남긴다(없는 수주면 거절)
  let so = null; if (body.sales_order_id !== undefined && body.sales_order_id !== null && body.sales_order_id !== '') { if (!/^[1-9]\d*$/.test(String(body.sales_order_id))) throw bad('연결할 수주를 다시 고르세요.'); so = await db.prepare('SELECT id, order_no FROM sales_orders WHERE id=?').get(Number(body.sales_order_id)); if (!so) throw bad('연결할 수주를 찾을 수 없습니다.'); }
  const prefix = 'PR-' + head.doc_date.slice(2).replace(/-/g, '') + '-';
  const token = requestId || 'srv:' + crypto.randomUUID();
  try {
    await db.batch([{ sql: `INSERT INTO purchase_requests(doc_no,doc_date,department,title,note,author_id,author_name,author_position,request_id,freight,sales_order_id,sales_order_no) VALUES(${nextPurchaseNo},?,?,?,?,?,?,?,?,?,?,?)`, args: [prefix, prefix, prefix, head.doc_date, head.department, head.title, head.note, user.id, user.name, user.position || '', token, head.freight, so ? so.id : null, so ? so.order_no : ''] }, ...prInsertDetails('request_id=?', [token], items, lines)]);
  } catch (error) {
    const done = String(error.message).includes('UNIQUE') && await savedByRequestId('purchase_requests', requestId, user, '구매의뢰서');
    if (done) return { ...await prDetail(done, user), duplicate: true };
    throw error;
  }
  return prDetail(await db.prepare('SELECT * FROM purchase_requests WHERE request_id=?').get(token), user);
});
// 반려된 의뢰서(또는 아직 아무도 결재하지 않은 의뢰서)를 고쳐 다시 올린다. 결재는 처음부터 다시 진행한다.
route('PUT', '/api/purchase-requests/:id', async ({ user, params, body }) => {
  const row = await prAccess(user, params.id, { write: true });
  const decided = await db.prepare("SELECT 1 FROM purchase_request_lines WHERE request_id=? AND decision!=''").get(row.id);
  if (!(row.status === 'rejected' || (row.status === 'pending' && !decided))) throw bad('결재가 진행 중이거나 승인된 의뢰서는 고칠 수 없습니다.');
  if (body.revision !== undefined && Number(body.revision) !== row.revision) throw new HttpError(409, '다른 곳에서 의뢰서가 바뀌었습니다. 다시 열어 확인하세요.');
  const author = await db.prepare('SELECT * FROM users WHERE id=?').get(row.author_id) || { department: row.department, position: row.author_position };
  const head = prHead(body, author), items = await prItems(body.items, await db.prepare('SELECT bom_id, spec FROM purchase_request_items WHERE request_id=?').all(row.id)), lines = await prLines(body, row.author_id);
  // 모든 문장이 「읽은 revision·고칠 수 있는 상태가 그대로」를 조건으로 갖고, revision을 올리는 헤더 UPDATE를 맨 끝에 둔다.
  // 다른 수정·결재가 먼저 revision을 올렸으면 이 요청은 헤더·품목·결재선 어느 것도 바꾸지 않는다.
  const editable = "id=? AND revision=? AND (status='rejected' OR (status='pending' AND NOT EXISTS(SELECT 1 FROM purchase_request_lines d WHERE d.request_id=? AND d.decision!='')))";
  const editArgs = [row.id, row.revision, row.id];
  const guard = `EXISTS(SELECT 1 FROM purchase_requests WHERE ${editable})`;
  const result = await db.batch([
    { sql: `DELETE FROM purchase_request_items WHERE request_id=? AND ${guard}`, args: [row.id, ...editArgs] },
    { sql: `DELETE FROM purchase_request_lines WHERE request_id=? AND ${guard}`, args: [row.id, ...editArgs] },
    ...prInsertDetails(editable, editArgs, items, lines),
    { sql: `UPDATE purchase_requests SET doc_date=?,department=?,author_position=?,title=?,note=?,freight=?,status='pending',current_step=1,reject_reason='',approved_at=NULL,revision=revision+1,submitted_at=datetime('now','+9 hours'),updated_at=datetime('now','+9 hours') WHERE ${editable}`, args: [head.doc_date, head.department, author.position || '', head.title, head.note, head.freight, ...editArgs] },
  ]);
  if (!result.at(-1).meta.changes) throw new HttpError(409, '다른 곳에서 의뢰서가 바뀌었거나 결재가 진행되었습니다. 다시 열어 확인하세요.');
  return prDetail(await mustGet('purchase_requests', row.id), user);
});
route('POST', '/api/purchase-requests/:id/decision', async ({ user, params, body }) => {
  const row = await prAccess(user, params.id);
  if (row.status !== 'pending') throw bad(row.status === 'approved' ? '이미 최종 승인된 의뢰서입니다.' : '반려된 의뢰서입니다. 작성자가 고쳐 다시 올려야 합니다.');
  const line = await db.prepare("SELECT * FROM purchase_request_lines WHERE request_id=? AND step=? AND kind!='cc'").get(row.id, row.current_step);
  if (!line || line.user_id !== user.id) throw new HttpError(403, line ? `지금은 ${line.user_name}님의 결재 차례입니다.` : '결재선을 확인할 수 없습니다.');
  if (body.revision !== undefined && Number(body.revision) !== row.revision) throw new HttpError(409, '다른 곳에서 의뢰서가 바뀌었습니다. 다시 열어 확인하세요.');
  const decision = String(body.decision || ''), comment = str(body.comment, 500);
  if (!['approved', 'rejected'].includes(decision)) throw bad('승인 또는 반려를 선택하세요.');
  if (decision === 'rejected' && !comment) throw bad('반려 사유를 입력하세요.');
  const next = decision === 'approved' ? (await db.prepare("SELECT MIN(step) s FROM purchase_request_lines WHERE request_id=? AND kind!='cc' AND step>?").get(row.id, row.current_step)).s : null;
  const guard = 'WHERE id=? AND revision=? AND current_step=? AND status=\'pending\'';
  const headSql = decision === 'rejected' ? `UPDATE purchase_requests SET status='rejected',reject_reason=?,revision=revision+1,updated_at=datetime('now','+9 hours') ${guard}`
    : next ? `UPDATE purchase_requests SET current_step=?,revision=revision+1,updated_at=datetime('now','+9 hours') ${guard}`
      : `UPDATE purchase_requests SET status='approved',approved_at=datetime('now','+9 hours'),revision=revision+1,updated_at=datetime('now','+9 hours') ${guard}`;
  const headArgs = [...(decision === 'rejected' ? [comment] : next ? [next] : []), row.id, row.revision, row.current_step];
  // 결재선 기록을 먼저(읽은 revision·차례가 그대로일 때만), revision을 올리는 헤더 UPDATE를 마지막에 둔다.
  // 같은 시각의 고치기·다른 결재가 먼저 끝났으면 이 결재는 아무것도 바꾸지 않는다.
  const result = await db.batch([
    { sql: "UPDATE purchase_request_lines SET decision=?,comment=?,decided_at=datetime('now','+9 hours'),read_at=COALESCE(read_at,datetime('now','+9 hours')) WHERE id=? AND request_id=? AND user_id=? AND decision='' AND EXISTS(SELECT 1 FROM purchase_requests WHERE id=? AND revision=? AND current_step=? AND status='pending')", args: [decision, comment, line.id, row.id, user.id, row.id, row.revision, row.current_step] },
    { sql: headSql + " AND EXISTS(SELECT 1 FROM purchase_request_lines WHERE id=? AND decision=?)", args: [...headArgs, line.id, decision] },
  ]);
  if (!result.at(-1).meta.changes) throw new HttpError(409, '다른 곳에서 의뢰서가 바뀌었습니다. 다시 열어 확인하세요.');
  return prDetail(await mustGet('purchase_requests', row.id), user);
});
route('DELETE', '/api/purchase-requests/:id', async ({ user, params }) => {
  const row = await prAccess(user, params.id, { write: true });
  if (row.status === 'approved') throw bad('최종 승인된 의뢰서는 삭제할 수 없습니다.');
  // 읽은 뒤 최종 승인되거나 고쳐졌으면 지우지 않는다(헤더 삭제를 마지막에 두고 모두 같은 조건).
  const guard = "EXISTS(SELECT 1 FROM purchase_requests WHERE id=? AND revision=? AND status!='approved')";
  const result = await db.batch([
    { sql: `DELETE FROM purchase_request_items WHERE request_id=? AND ${guard}`, args: [row.id, row.id, row.revision] },
    { sql: `DELETE FROM purchase_request_lines WHERE request_id=? AND ${guard}`, args: [row.id, row.id, row.revision] },
    { sql: "DELETE FROM purchase_requests WHERE id=? AND revision=? AND status!='approved'", args: [row.id, row.revision] },
  ]);
  if (!result.at(-1).meta.changes) throw new HttpError(409, '다른 곳에서 의뢰서가 바뀌었거나 승인되었습니다. 다시 열어 확인하세요.');
  await removePhotos(JSON.parse(row.photos || '[]'));
  return { ok: true };
});
// 첨부(고객 발주서·제품 사진): 의뢰서 행의 photos에 둔다. 공통 첨부 표(attachments)는 대상 종류가 고정돼 있어 쓰지 않는다.
// 사진 저장은 다른 첨부와 같은 savePhotos(회사 R2·8MB·10장 규칙)를 쓴다. 바꾸기는 작성자가 최종 승인 전에만.
route('PUT', '/api/purchase-requests/:id/photos', async ({ user, params, body }) => {
  const row = await prAccess(user, params.id, { write: true });
  if (row.status === 'approved') throw bad('최종 승인된 의뢰서의 사진은 바꿀 수 없습니다.');
  const current = JSON.parse(row.photos || '[]');
  const keep = body.keep_photos === undefined ? current : body.keep_photos;
  if (!Array.isArray(keep) || new Set(keep).size !== keep.length || keep.some(file => !current.includes(file))) throw bad('유지할 사진을 다시 확인하세요.');
  if (body.photos !== undefined && !Array.isArray(body.photos)) throw bad('첨부 사진 형식을 확인하세요.');
  if (keep.length + (body.photos || []).length > 10) throw bad('사진은 최대 10장까지 첨부할 수 있습니다.');
  const added = await savePhotos(body.photos);
  try {
    const result = await db.prepare("UPDATE purchase_requests SET photos=?,revision=revision+1,updated_at=datetime('now','+9 hours') WHERE id=? AND revision=?").run(JSON.stringify(keep.concat(added)), row.id, body.revision !== undefined ? Number(body.revision) : row.revision);
    if (!result.changes) throw new HttpError(409, '다른 곳에서 의뢰서가 바뀌었습니다. 다시 열어 확인하세요.');
  } catch (error) { await removePhotos(added); throw error; }
  await removePhotos(current.filter(file => !keep.includes(file)));
  return prDetail(await mustGet('purchase_requests', row.id), user);
});
// 최종 승인된 의뢰 품목을 발주목록에 올린다. 발주 등록과 같은 규칙(createPurchaseOrder)을 쓴다.
route('POST', '/api/purchase-requests/:id/po', async ({ user, params, body }) => {
  if (!hasRole(user, 'purchase')) throw new HttpError(403, '구매 담당자만 발주를 만들 수 있습니다.');
  const row = await prAccess(user, params.id);
  if (row.status !== 'approved') throw bad('최종 승인된 의뢰서만 발주로 만들 수 있습니다.');
  const wanted = Array.isArray(body.item_ids) ? body.item_ids.map(Number) : null;
  const items = (await db.prepare('SELECT * FROM purchase_request_items WHERE request_id=? AND po_id IS NULL AND order_closed=\'\' ORDER BY line_no').all(row.id)).filter(it => !wanted || wanted.includes(it.id));
  if (!items.length) throw bad('발주로 만들 품목이 없습니다. 이미 모두 발주했습니다.');
  const due = dateStr(body.due_date, '납기일'), fallbackCategory = body.item_category ? itemCategory(body.item_category) : '';
  // 15.66: 품목별 발주 수량·단가를 바꿔 발주할 수 있다(lines: [{ id, qty, unit_price }]). 없으면 의뢰 수량·매입단가.
  const changes = new Map((Array.isArray(body.lines) ? body.lines : []).map(l => [Number(l && l.id), l]));
  // 먼저 모든 품목을 검사하고 나서 만든다(일부만 만들어지는 일을 줄인다).
  const plans = [], userNote = str(body.note, 300); // 15.70 발주서 비고(거래처에 보임)
  for (const it of items) {
    const change = changes.get(it.id) || {};
    const qty = change.qty === undefined || change.qty === '' ? it.qty : num(change.qty, `${it.line_no}번 품목 발주 수량`);
    if (!(qty > 0)) throw bad(`${it.line_no}번 품목(${it.item})의 발주 수량은 0보다 커야 합니다.`);
    const unitPrice = change.unit_price === undefined ? it.purchase_price : poUnitPrice(change.unit_price, `${it.line_no}번 품목 단가`);
    const internalNote = change.internal_note === undefined ? '' : str(change.internal_note, 200);
    const bom = it.bom_id ? await db.prepare('SELECT * FROM boms WHERE id=?').get(it.bom_id) : null;
    const category = (bom && ITEM_CATEGORIES.includes(bom.item_category) ? bom.item_category : '') || fallbackCategory;
    if (!category) throw bad(`${it.line_no}번 품목(${it.item})의 분류를 고르세요.`);
    const vendor = it.vendor || str(body.vendor, 100);
    if (!vendor) throw bad(`${it.line_no}번 품목(${it.item})의 공급선(거래처)을 입력하세요.`);
    const changed = qty !== it.qty ? ` · 의뢰 ${it.qty} → 발주 ${qty}` : '';
    plans.push({ it, unitPrice, internalNote, body: { req_no: row.doc_no, vendor, item: it.item, bom_id: bom && bom.active ? bom.id : undefined, unit: it.unit, qty, due_date: due, item_category: category, note: `구매의뢰 ${row.doc_no}${it.spec ? ' · ' + it.spec : ''}${changed}${userNote ? ' · ' + userNote : ''}`.slice(0, 500) } });
  }
  // 거래처별 운송비(15.69): 보낸 값 > 의뢰서에 적힌 값. 그 거래처로 만든 첫 발주에 붙인다(발주서는 묶음의 합을 쓴다).
  // 나눠서 발주할 때 같은 거래처 운송비가 두 번 붙지 않게, 이 의뢰서의 앞선 발주에 이미 운송비가 있는 거래처는 기본값을 쓰지 않는다.
  const charged = new Set((await db.prepare('SELECT DISTINCT p.vendor FROM purchase_request_items i JOIN purchase_orders p ON p.id=i.po_id WHERE i.request_id=? AND p.freight IS NOT NULL').all(row.id)).map(r => r.vendor));
  const freightIn = body.freight === undefined ? Object.fromEntries(Object.entries(prFreight(row)).filter(([vendor]) => !charged.has(vendor))) : freightMap(body.freight), freightDone = new Set();
  const created = [];
  for (const { it, unitPrice, internalNote, body: poBody } of plans) {
    const po = await createPurchaseOrder(user, poBody);
    const linked = await db.prepare("UPDATE purchase_request_items SET po_id=? WHERE id=? AND po_id IS NULL AND order_closed=''").run(po.id, it.id);
    if (!linked.changes) { await db.prepare('DELETE FROM purchase_orders WHERE id=?').run(po.id); continue; }
    // 발주서용 규격·단가를 함께 남긴다(규격은 비고에도 그대로).
    const vendorFreight = !freightDone.has(poBody.vendor) && freightIn[poBody.vendor] !== undefined ? freightIn[poBody.vendor] : null; freightDone.add(poBody.vendor);
    await db.prepare('UPDATE purchase_orders SET spec=?,unit_price=?,internal_note=?,freight=? WHERE id=?').run(str(it.spec, 100), unitPrice ?? null, internalNote, vendorFreight, po.id);
    created.push(await mustGet('purchase_orders', po.id));
  }
  return { created, request: await prDetail(await mustGet('purchase_requests', row.id), user) };
});
// 발주하지 않을 의뢰 품목을 닫거나(발주 안 함) 다시 발주 대기로 되돌린다(15.69).
route('POST', '/api/purchase-requests/:id/items/:itemId/order-closed', async ({ user, params, body }) => {
  if (!hasRole(user, 'purchase')) throw new HttpError(403, '구매 담당자만 바꿀 수 있습니다.');
  const row = await prAccess(user, params.id);
  if (row.status !== 'approved') throw bad('최종 승인된 의뢰서만 바꿀 수 있습니다.');
  const item = await db.prepare('SELECT * FROM purchase_request_items WHERE id=? AND request_id=?').get(Number(params.itemId), row.id);
  if (!item) throw new HttpError(404, '의뢰 품목을 찾을 수 없습니다.');
  if (item.po_id) throw bad('이미 발주한 품목입니다. 발주를 지우면 닫힙니다.');
  const close = body.closed !== false;
  const value = close ? `발주 안 함${str(body.reason, 100) ? ' (' + str(body.reason, 100) + ')' : ''} · ${user.name} · ${now()}`.slice(0, 200) : '';
  await db.prepare('UPDATE purchase_request_items SET order_closed=? WHERE id=? AND po_id IS NULL').run(value, item.id);
  return prDetail(await mustGet('purchase_requests', row.id), user);
});

// ── 대시보드 ──
route('GET', '/api/dashboard', async ({ user }) => {
  const c = async (sql, ...a) => (await db.prepare(sql).get(...a)).c;
  const reqCounts = {};
  for (const t of Object.keys(REQUEST_TYPES)) {
    reqCounts[t] = { pending: (await c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='pending'", t)), waiting: (await c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='waiting'", t)), progress: (await c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='progress'", t)), done: (await c("SELECT COUNT(*) c FROM requests WHERE type=? AND status='done'", t)) };
  }
  const t = today();
  return {
    today: t,
    po: { total: (await c('SELECT COUNT(*) c FROM purchase_orders')), none: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status=''")), ok: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='ok'")), mismatch: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='mismatch' AND (recv_qty IS NULL OR recv_qty>=qty)")), partial: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='mismatch' AND recv_qty<qty")), checking: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status='checking'")), overdue: (await c("SELECT COUNT(*) c FROM purchase_orders WHERE recv_status<>'ok' AND due_date<?", t)) },
    requests: reqCounts,
    shipmentsToday: (await c('SELECT COUNT(*) c FROM shipments WHERE ship_date=?', t)),
    laundryMonth: (await db.prepare("SELECT COALESCE(SUM(discard_qty),0) c FROM laundry WHERE substr(in_date,1,7)=?").get(t.slice(0, 7))).c,
    schedulesToday: (await c("SELECT COUNT(*) c FROM schedules WHERE period='day' AND start_date=?", t)),
    actualChangesPending: (await c("SELECT COUNT(*) c FROM production_actual_changes WHERE status='pending'")),
    receiptChangesPending: (await c("SELECT COUNT(*) c FROM receipt_qty_changes WHERE status='pending'")),
    stock: await stockAlerts().catch(error => { console.error('Dashboard stock alerts: ' + error.message); return null; }),
    // 15.215 영업: 건수는 누구나, 금액은 영업 담당·관리자만
    sales: await (async () => {
      const month = t.slice(0, 7), canMoney = hasRole(user, 'sales');
      const out = {
        ordersOpen: await c("SELECT COUNT(*) c FROM sales_orders WHERE status='open'"),
        ordersToday: await c("SELECT COUNT(*) c FROM sales_orders WHERE status!='cancelled' AND order_date=?", t),
        shipPending: await c("SELECT COUNT(*) c FROM ship_instructions WHERE status='pending'"),
        shipHeld: await c("SELECT COUNT(*) c FROM ship_instructions WHERE status='pending' AND held=1"),
        billsMonth: await c("SELECT COUNT(*) c FROM sales_bills WHERE status='confirmed' AND substr(bill_date,1,7)=?", month),
        untaxed: await c("SELECT COUNT(*) c FROM sales_bills b WHERE b.status='confirmed' AND b.total>0 AND NOT EXISTS(SELECT 1 FROM tax_invoice_bills x WHERE x.bill_id=b.id AND x.active=1)"),
        canMoney,
      };
      if (canMoney) {
        out.salesMonth = (await db.prepare("SELECT COALESCE(SUM(total),0) c FROM sales_bills WHERE status='confirmed' AND substr(bill_date,1,7)=?").get(month)).c;
        out.paidMonth = (await db.prepare("SELECT COALESCE(SUM(amount),0) c FROM sales_payments WHERE status='confirmed' AND kind='payment' AND substr(pay_date,1,7)=?").get(month)).c;
      }
      return out;
    })().catch(error => { console.error('Dashboard sales: ' + error.message); return null; }),
    // 15.310 품질(QA·QC)과 공무(설비·예방보전): 지금 처리할 것과 이번 달 숫자
    quality: await (async () => {
      const month = t.slice(0, 7), in7 = addDaysISO(t, 7);
      const insp = await db.prepare("SELECT SUM(CASE WHEN r.category='수입검사' AND m.result='fail' THEN 1 ELSE 0 END) AS iqc_fail, SUM(CASE WHEN r.category='수입검사' AND m.result IN ('pass','fail') THEN 1 ELSE 0 END) AS iqc, SUM(CASE WHEN r.category='출하검사' AND m.result='fail' THEN 1 ELSE 0 END) AS oqc_fail, SUM(CASE WHEN r.category='출하검사' AND m.result IN ('pass','fail') THEN 1 ELSE 0 END) AS oqc FROM requests r JOIN inspection_measurements m ON m.request_id=r.id WHERE r.type='analysis' AND substr(r.created_at,1,7)=?").get(month);
      return {
        capaOpen: await c("SELECT COUNT(*) c FROM nonconformities WHERE status NOT IN ('closed','void')"),
        capaOverdue: await c("SELECT COUNT(*) c FROM nonconformities WHERE status NOT IN ('closed','void') AND due_date IS NOT NULL AND due_date<?", t),
        capaVerify: await c("SELECT COUNT(*) c FROM nonconformities WHERE status='verify'"),
        coaDraft: await c("SELECT COUNT(*) c FROM coas WHERE status='draft'"),
        coaMonth: await c("SELECT COUNT(*) c FROM coas WHERE status='approved' AND substr(COALESCE(approved_at,created_at),1,7)=?", month),
        changesOpen: await c("SELECT COUNT(*) c FROM quality_changes WHERE status IN ('requested','evaluating','approved','applied')"),
        docsReview: await c("SELECT COUNT(*) c FROM quality_docs WHERE status='review'"),
        auditsCorrecting: await c("SELECT COUNT(*) c FROM quality_audits WHERE status='correcting'"),
        iqcFail: insp.iqc_fail || 0, iqc: insp.iqc || 0, oqcFail: insp.oqc_fail || 0, oqc: insp.oqc || 0,
        calDue: await c("SELECT COUNT(*) c FROM instruments WHERE status='in_use' AND next_due IS NOT NULL AND next_due<=?", addDaysISO(t, 30)),
        kpiMissed: await (async () => { try { return (await goalRows(Number(t.slice(0, 4)))).filter(g => g.met === false).length; } catch { return 0; } })(),
        pmOverdue: await c("SELECT COUNT(*) c FROM equipment e, json_each(e.pm_items) j WHERE e.status<>'disposed' AND json_extract(j.value,'$.next_due')<?", t),
        pmSoon: await c("SELECT COUNT(*) c FROM equipment e, json_each(e.pm_items) j WHERE e.status<>'disposed' AND json_extract(j.value,'$.next_due')>=? AND json_extract(j.value,'$.next_due')<=?", t, in7),
        eqMaintenance: await c("SELECT COUNT(*) c FROM equipment WHERE status='maintenance'"),
        eqFailMonth: await c("SELECT COUNT(*) c FROM equipment_logs WHERE kind='failure' AND substr(log_date,1,7)=?", month),
        pqcOutMonth: await c("SELECT COUNT(*) c FROM process_measures WHERE out_of_spec=1 AND substr(measured_on,1,7)=?", month),
      };
    })().catch(error => { console.error('Dashboard quality: ' + error.message); return null; }),
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
      if (!/^[a-f0-9]{24}\.(jpg|png|webp|pdf)$/.test(file)) throw new HttpError(404, '사진을 찾을 수 없습니다.'); // 15.306 품질 문서·공급사 COA PDF
      const photo = await images.get(file);
      if (!photo) throw new HttpError(404, '사진을 찾을 수 없습니다.');
      res.set('Content-Type', file.endsWith('.pdf') ? 'application/pdf' : photo.httpMetadata?.contentType || 'application/octet-stream');
      res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff');
      return new Response(photo.body, { headers: res });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    if (p === '/r2-key-handoff.html') {
      return new Response(req.method === 'HEAD' ? null : 'R2 키 등록이 완료되어 임시 전달 페이지를 종료했습니다.', { status: 410, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    return env.ASSETS.fetch(req);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e.message, e);
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
