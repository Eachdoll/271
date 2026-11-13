// 앱 변경 커밋마다 AGENTS.md의 버전 규칙에 따라 올립니다.
const APP_VERSION = '15.2';
// 서울세미텍 시스템 프런트엔드 (빌드 도구 없음, 해시 라우팅)
'use strict';

// ───────────── 공통 도구 ─────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => fmtDate(new Date());
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return fmtDate(d); };
const mondayOf = (s) => { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtDate(d); };
const monthStart = (s) => s.slice(0, 8) + '01';
const monthEnd = (s) => { const d = parseD(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return fmtDate(d); };
const addMonths = (s, n) => { const d = parseD(monthStart(s)); d.setMonth(d.getMonth() + n); return fmtDate(d); };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (s) => WEEK[parseD(s).getDay()];
const fmtNum = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR'));

const ROLE_LABEL = { purchase: '구매', quality: '품질', quality_approver: '품질책임자(승인권자)', dev: '개발(연구소)', dev_approver: '개발책임자(승인권자)', production: '생산', production_approver: '생산팀장(실적 수정 승인)', logistics: '물류', logistics_approver: '물류팀장(입고 수량 수정 승인)' };
const STATUS = { pending: '접수대기', rejected: '반려', waiting: '대기', progress: '진행', done: '완료' };
const RECV = { '': '미입고', ok: '입고완료', mismatch: '수량상이', checking: '확인중' };

let ME = null;

// Every current and dynamically opened form shows the signed-in operator.
// This is display-only; the server records authors from its authenticated session.
function showInputAuthors() {
  if (!ME) return;
  for (const form of document.querySelectorAll('form')) {
    if (form.dataset.readOnly === 'true') continue;
    let label = form.querySelector(':scope > [data-input-author]');
    if (!label) { label = document.createElement('p'); label.dataset.inputAuthor = ''; label.className = 'small muted input-author'; form.prepend(label); }
    const original = form.dataset.entryAuthor;
    const text = original !== undefined ? '입력자: ' + (original || '기존 기록: 미기록') + ' · 현재 작업자: ' + ME.name : '입력자(자동 기록): ' + ME.name;
    if (label.textContent !== text) label.textContent = text;
  }
}
new MutationObserver(showInputAuthors).observe(document.body, { childList: true, subtree: true });

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && ME) { ME = null; render(); }
  if (!res.ok) throw Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: res.status });
  return data;
}
function toast(msg, kind = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = 'show ' + kind;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = ''), 2600);
}
const fail = (e) => toast(e.message || String(e), 'err');
const userHasRole = (user, r) => user.roles.includes(r) || (['quality','dev'].includes(r) && user.roles.includes(r + '_approver'));
const hasRole = (r) => ME && (ME.is_admin || userHasRole(ME, r));
const canApproveRequest = (type) => hasRole({ voc: 'quality_approver', analysis: 'quality_approver', development: 'dev_approver', sample: 'production' }[type]);
function formObj(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') { (o[el.name] ||= []); if (el.checked) o[el.name].push(el.value); }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; else if (!(el.name in o)) o[el.name] = ''; }
    else if (el.type !== 'file') o[el.name] = el.value;
  }
  return o;
}
function listControls(prefix, { placeholder = '검색어 입력', dateLabel = '', from = '', to = '', requiredDates = false, extra = '' } = {}) {
  return `<form id="${prefix}Filters" class="toolbar list-filters" data-read-only="true">
    ${dateLabel ? `<label>${dateLabel} 시작일<input type="date" name="from" id="${prefix}From" value="${from}" ${requiredDates ? 'required' : ''}></label><label>${dateLabel} 종료일<input type="date" name="to" id="${prefix}To" value="${to}" ${requiredDates ? 'required' : ''}></label>` : ''}
    <label class="list-search">키워드 검색<input type="search" name="q" id="${prefix}Q" maxlength="200" placeholder="${esc(placeholder)}"></label>${extra}
    <button type="submit" class="btn primary">검색</button><button type="button" class="btn" data-clear-filters>초기화</button><span class="small muted" id="${prefix}Count" data-list-count role="status"></span></form>`;
}
function listInspectionSelect() { return `<label>검수 상태<select name="inspection_status"><option value="">전체 검수</option>${Object.entries(INSPECTION).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>`; }
function bindListControls(form, load, reset = () => {}) {
  let timer;
  const run = () => {
    clearTimeout(timer);
    if (!form.checkValidity()) { $('[data-list-count]', form).textContent = '조회 조건을 확인하세요.'; return; }
    Promise.resolve().then(load).catch(error => { if (form.isConnected) { $('[data-list-count]', form).textContent = '조회 실패 · 이전 결과'; fail(error); } });
  };
  form.onsubmit = event => { event.preventDefault(); run(); };
  $$('input,select', form).forEach(input => {
    if (input.type === 'search') { input.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 250); }; input.onsearch = run; }
    else input.onchange = run;
  });
  $('[data-clear-filters]', form).onclick = () => { form.reset(); reset(); run(); };
}
function listLoading(form) { $('[data-list-count]', form).textContent = '조회 중…'; }
function listCount(form, count) { $('[data-list-count]', form).textContent = `${count}건 조회`; }

function modal(html, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="modal-x" aria-label="닫기">×</button>${html}</div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $('.modal-x', wrap).onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  const first = $('input:not([type=hidden]),textarea,select', wrap); if (first) first.focus();
  return { el: $('.modal', wrap), close };
}
function confirmBox(msg) {
  return new Promise((resolve) => {
    const m = modal(`<p class="confirm-msg">${esc(msg)}</p><div class="actions"><button class="btn" data-no>취소</button><button class="btn danger" data-yes>확인</button></div>`);
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(false); };
    $('[data-yes]', m.el).onclick = () => { m.close(); resolve(true); };
  });
}
function promptBox(title, fieldsHtml) {
  return new Promise((resolve) => {
    const m = modal(`<h3>${esc(title)}</h3><form class="stack">${fieldsHtml}<div class="actions"><button type="button" class="btn" data-no>취소</button><button class="btn primary">확인</button></div></form>`);
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(null); };
    $('form', m.el).onsubmit = (e) => { e.preventDefault(); const v = formObj(e.target); m.close(); resolve(v); };
  });
}

// 사진 → 최대 1600px JPEG data URL
function resizeImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다: ' + file.name)); };
    img.src = url;
  });
}
function lightbox(src) { modal(`<img class="lightbox" src="${esc(src)}" alt="사진">`, { wide: true }); }

const INSPECTION = { unchecked: '미판정', normal: '이상 없음', abnormal: '이상 있음' };
function inspectionBadge(row) { return `<span class="chip ${row.inspection_status === 'abnormal' ? 'red' : row.inspection_status === 'normal' ? 'green' : ''}">${INSPECTION[row.inspection_status] || '미판정'}</span>${row.photo_count ? ` <span class="small muted">사진 ${row.photo_count}장</span>` : ''}`; }
function photoPicker() { return '<label class="span3 photo-picker">사진 첨부 (최대 10장)<input data-photo-input type="file" accept="image/jpeg,image/png,image/webp" multiple><span class="muted small">사진을 눌러 크게 확인할 수 있습니다.</span><div class="thumbs" data-photo-preview></div></label>'; }
function bindPhotoDraft(form, initial = []) {
  const state = { photos: [...initial], busy: false };
  const input = $('[data-photo-input]', form); const preview = $('[data-photo-preview]', form);
  const show = () => { if (!preview) return; preview.innerHTML = state.photos.map(src => `<img src="${esc(src)}" alt="첨부 미리보기">`).join(''); $$('img', preview).forEach(image => image.onclick = event => { event.preventDefault(); event.stopPropagation(); lightbox(image.src); }); };
  if (input) input.onchange = async () => {
    const submit = $('button[type=submit], button.primary', form);
    state.busy = true; if (submit) submit.disabled = true;
    try {
      if (input.files.length > 10) throw new Error('사진은 최대 10장까지 선택하세요.');
      const photos = await Promise.all([...input.files].map(file => resizeImage(file)));
      state.photos = photos; show();
    } catch (error) { fail(error); input.value = ''; }
    finally { state.busy = false; if (submit) submit.disabled = false; }
  };
  state.reset = () => { state.photos = []; if (input) input.value = ''; show(); };
  show(); return state;
}
function inspectionFields() {
  return `<label>이상 여부<select name="inspection_status">${Object.entries(INSPECTION).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label><label class="span2">판정 메모<input name="inspection_note" maxlength="1000" placeholder="박스 파손, 찌그러짐, 젖음 등"></label>`;
}
function photosHTML(record) {
  return `<p><span class="chip ${record.inspection_status === 'abnormal' ? 'red' : record.inspection_status === 'normal' ? 'green' : ''}">${INSPECTION[record.inspection_status] || '미판정'}</span> ${esc(record.note || '')}</p><div class="thumbs">${record.photos.map(file => `<img src="/uploads/${esc(file)}" data-photo-view="/uploads/${esc(file)}" alt="첨부 사진" loading="lazy">`).join('') || '<span class="muted small">첨부된 사진이 없습니다.</span>'}</div>${record.updated_by ? `<p class="small muted">기록 입력자: ${esc(record.updated_by)} · ${esc(record.updated_at)}</p>` : ''}`;
}
function bindPhotoViews(root) { $$('[data-photo-view]', root).forEach(image => image.onclick = () => lightbox(image.dataset.photoView)); }
async function renderAttachmentPreview(root, entity, id) {
  try { const record = await api('GET', `/api/attachments/${entity}/${id}`); root.innerHTML = photosHTML(record); bindPhotoViews(root); }
  catch (error) { root.textContent = error.message; }
}
async function openAttachments(entity, id, title, { editable = true, initialPhotos = [], initialStatus, initialNote } = {}) {
  try {
    const record = await api('GET', `/api/attachments/${entity}/${id}`);
    if (initialStatus !== undefined) record.inspection_status = initialStatus;
    if (initialNote !== undefined) record.note = initialNote;
    const box = modal(`<h3>${esc(title)} · ${entity === 'request' ? '첨부 사진' : '사진·검수'}</h3><div>${photosHTML(record)}</div>${editable ? `<form class="stack"><div class="thumbs">${record.photos.map(file => `<label class="keep"><input type="checkbox" name="keep_photos" value="${esc(file)}" checked>사진 유지<img src="/uploads/${esc(file)}" alt="기존 사진"></label>`).join('')}</div>${photoPicker()}${entity === 'request' ? '' : `<label>이상 여부<select name="inspection_status">${Object.entries(INSPECTION).map(([key,label]) => `<option value="${key}" ${record.inspection_status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`}<label>${entity === 'request' ? '사진 설명' : '판정 메모'}<textarea name="inspection_note" maxlength="1000" rows="3">${esc(record.note)}</textarea></label><div class="actions"><button type="submit" class="btn primary">저장</button></div></form>` : ''}`, { wide: true });
    bindPhotoViews(box.el);
    if (!editable) return;
    const form = $('form', box.el); const draft = bindPhotoDraft(form, initialPhotos);
    form.onsubmit = async event => {
      event.preventDefault(); if (draft.busy) return;
      const values = formObj(form); const button = $('button.primary', form); button.disabled = true;
      try {
        await api('PUT', `/api/attachments/${entity}/${id}`, { photos: draft.photos, keep_photos: values.keep_photos || [], revision: record.revision, inspection_status: values.inspection_status || record.inspection_status, note: values.inspection_note });
        box.close(); toast('사진과 기록을 저장했습니다.'); render();
      } catch (error) { fail(error); } finally { button.disabled = false; }
    };
  } catch (error) { fail(error); }
}
async function saveNewAttachments(entity, row, draft, form) {
  const values = formObj(form); const photos = [...draft.photos];
  if (!photos.length && (!values.inspection_status || values.inspection_status === 'unchecked') && !values.inspection_note) return true;
  try { await api('PUT', `/api/attachments/${entity}/${row.id}`, { photos, inspection_status: values.inspection_status || 'unchecked', note: values.inspection_note || '' }); return true; }
  catch (error) {
    fail(new Error('기록은 저장했으나 사진·판정 저장에 실패했습니다. 열린 사진 창에서 다시 저장하세요.'));
    await openAttachments(entity, row.id, row.title || row.item, { initialPhotos: photos, initialStatus: values.inspection_status || 'unchecked', initialNote: values.inspection_note || '' });
    return false;
  }
}

// ───────────── 레이아웃 / 라우팅 ─────────────
const NAV = [
  { group: '홈', items: [['#/', '대시보드 · 업무흐름'], ['#/reports', '리포트 · 통계']] },
  { group: '구매', items: [['#/purchase/po', '발주목록'], ['#/purchase/laundry', '세탁관리']] },
  { group: '품질', items: [['#/quality/request', '분석의뢰'], ['#/quality/list', '분석리스트'], ['#/quality/voc/request', 'VOC 접수'], ['#/quality/voc/list', 'VOC 처리목록']] },
  { group: '개발', items: [['#/dev/request', '개발의뢰'], ['#/dev/list', '개발리스트']] },
  { group: '생산', items: [['#/prod/request', '샘플의뢰'], ['#/prod/list', '샘플리스트'], ['#/prod/finished', '완제품 생산일정'], ['#/prod/semi', '반제품 생산일정']] },
  { group: '물류', items: [['#/logistics/receive', '입고목록'], ['#/logistics/ship', '출하목록']] },
];
const PAGES = {
  '#/': pageHome,
  '#/reports': pageReports,
  '#/purchase/po': pagePO,
  '#/purchase/laundry': pageLaundry,
  '#/quality/request': () => pageIntake('analysis'),
  '#/quality/list': () => pageWorkList('analysis'),
  '#/quality/voc/request': () => pageIntake('voc'),
  '#/quality/voc/list': () => pageWorkList('voc'),
  '#/dev/request': () => pageIntake('development'),
  '#/dev/list': () => pageWorkList('development'),
  '#/prod/request': () => pageIntake('sample'),
  '#/prod/list': () => pageWorkList('sample'),
  '#/prod/finished': () => pageSchedule('finished'),
  '#/prod/semi': () => pageSchedule('semi'),
  '#/logistics/receive': main => pageReceipts(main, 'purchase'),
  '#/logistics/ship': pageShip,
  '#/logistics/other': main => pageReceipts(main, 'other'),
  '#/admin': pageAdmin,
  '#/admin/bom': pageBoms,
  '#/me': pageMe,
};

function shell() {
  const cur = location.hash === '#/logistics/other' ? '#/logistics/receive' : location.hash || '#/';
  const nav = NAV.map((g) => `<div class="nav-group"><div class="nav-title">${g.group}</div>${g.items.map(([h, l]) => `<a href="${h}" class="${cur === h ? 'active' : ''}">${l}</a>`).join('')}</div>`).join('')
    + (ME.is_admin ? `<div class="nav-group"><div class="nav-title">관리</div><a href="#/admin" class="${cur === '#/admin' ? 'active' : ''}">관리자 설정</a><a href="#/admin/bom" class="${cur === '#/admin/bom' ? 'active' : ''}">BOM 관리</a></div>` : '');
  const roles = ME.roles.map((r) => ROLE_LABEL[r]).join(', ');
  $('#app').innerHTML = `
  <header class="top">
    <button class="menu-btn" aria-label="메뉴">☰</button>
    <a href="#/" class="brand"><img class="brand-logo" src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"> <span class="brand-text">서울세미텍 시스템</span><span class="app-version">버전 ${APP_VERSION}</span></a>
    <div class="who"><a href="#/me" title="내 정보">${esc(ME.name)}${ME.is_admin ? ' <span class="tag">관리자</span>' : ''}${roles ? ` <span class="tag soft">${esc(roles)}</span>` : ''}</a>
      <button class="btn small" id="logout">로그아웃</button></div>
  </header>
  <div class="layout"><nav class="side">${nav}</nav><main id="main"></main></div>`;
  $('#logout').onclick = async () => { await api('POST', '/api/auth/logout'); ME = null; render(); };
  $('.menu-btn').onclick = () => document.body.classList.toggle('nav-open');
  $$('.side a').forEach((a) => (a.onclick = () => document.body.classList.remove('nav-open')));
}

async function render() {
  if (!ME) return pageAuth();
  shell();
  const page = PAGES[location.hash || '#/'] || pageHome;
  try { await page($('#main')); } catch (e) { $('#main').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

// ───────────── 로그인 / 가입 ─────────────
function pageAuth(mode = 'login', notice = '') {
  $('#app').innerHTML = `
  <div class="auth">
    <div class="auth-card">
      <div class="brand big"><img class="brand-logo" src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"> 서울세미텍 시스템</div>
      <p class="muted" lang="en">Spotless and Safe, through Technology</p>
      <p class="app-version">버전 ${APP_VERSION}</p>
      <div class="tabs"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">로그인</button><button data-m="register" class="${mode === 'register' ? 'on' : ''}">가입</button></div>
      <p id="authNotice" role="status" class="muted">${esc(notice)}</p>
      <form class="stack" id="authForm">
        <label>이름<input name="name" autocomplete="username" required maxlength="30" placeholder="예) 홍길동"></label>
        <label>비밀번호<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="4"></label>
        ${mode === 'register' ? '<label>초대코드<input name="invite" required placeholder="관리자에게 받은 초대코드"></label>' : ''}
        <button class="btn primary block">${mode === 'login' ? '로그인' : '가입하기'}</button>
      </form>
      ${mode === 'register' ? '<p class="muted small">가입 신청 후 관리자 승인이 필요합니다. 첫 계정만 자동으로 관리자가 됩니다.</p>' : ''}
    </div>
  </div>`;
  $$('.tabs button').forEach((b) => (b.onclick = () => pageAuth(b.dataset.m)));
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('POST', mode === 'login' ? '/api/auth/login' : '/api/auth/register', formObj(e.target)); if (r.pending) { pageAuth('login', '가입 신청이 완료되었습니다. 관리자 승인 후 로그인해 주세요.'); return; } ME = r.user; if (!location.hash) location.hash = '#/'; render(); }
    catch (err) { $('#authNotice').textContent = err.message; fail(err); }
  };
}

// ───────────── 홈: 대시보드 + 업무흐름 ─────────────
async function pageHome(main) {
  const d = await api('GET', '/api/dashboard');
  const r = d.requests;
  const flow = (title, steps) => `<div class="flow"><h4>${title}</h4><ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>`;
  main.innerHTML = `
  <h1>대시보드 <span class="muted small">${d.today} (${dow(d.today)})</span></h1>
  <div class="kpis">
    <a class="kpi" href="#/logistics/receive"><b>${d.po.none}</b><span>미입고 발주</span>${d.po.overdue ? `<em class="red">납기경과 ${d.po.overdue}</em>` : ''}</a>
    <a class="kpi yellow" href="#/logistics/receive"><b>${d.po.checking}</b><span>입고 확인중</span></a>
    <a class="kpi red" href="#/logistics/receive"><b>${d.po.mismatch}</b><span>수량상이</span></a>
    ${d.receiptChangesPending ? `<a class="kpi yellow" href="#/logistics/receive"><b>${d.receiptChangesPending}</b><span>입고 수량 수정 승인대기</span></a>` : ''}
    ${d.actualChangesPending ? `<a class="kpi yellow" href="#/prod/finished"><b>${d.actualChangesPending}</b><span>생산실적 수정 승인대기</span></a>` : ''}
    <a class="kpi" href="#/quality/request"><b>${r.analysis.pending}</b><span>분석 접수대기</span></a>
    <a class="kpi" href="#/quality/voc/request"><b>${r.voc.pending}</b><span>VOC 승인대기</span></a>
    <a class="kpi" href="#/dev/request"><b>${r.development.pending}</b><span>개발 접수대기</span></a>
    <a class="kpi" href="#/prod/request"><b>${r.sample.pending}</b><span>샘플 접수대기</span></a>
    <a class="kpi" href="#/logistics/ship"><b>${d.shipmentsToday}</b><span>오늘 출하</span></a>
    <a class="kpi" href="#/purchase/laundry"><b>${fmtNum(d.laundryMonth)}</b><span>이번달 세탁 폐기</span></a>
  </div>
  <h2>진행 현황</h2>
  <div class="table-wrap"><table class="grid">
    <thead><tr><th>구분</th><th>접수대기</th><th>대기</th><th>진행</th><th>완료</th></tr></thead>
    <tbody>${['analysis', 'development', 'sample', 'voc'].map((t) => `<tr><td><a href="${REQ[t].list}">${REQ[t].label}의뢰</a></td><td>${r[t].pending}</td><td>${r[t].waiting}</td><td>${r[t].progress}</td><td>${r[t].done}</td></tr>`).join('')}</tbody>
  </table></div>
  <h2>업무 흐름</h2>
  <div class="flows">
    ${flow('구매 → 물류 (발주·입고)', ['<b>구매</b> 발주서 발송 후 <a href="#/purchase/po">발주목록</a> 입력', '<b>물류</b> 입고 시 <a href="#/logistics/receive">입고목록 → 발주입고</a>에서 체크', '정상 입고 → <span class="chip green">초록</span>', '수량 다름 → <span class="chip red">빨강</span> (실입고 수량 기록)', '확인 중 → <span class="chip yellow">노랑</span>'])}
    ${flow('품질 (분석)', ['<b>누구나</b> <a href="#/quality/request">분석의뢰</a> 양식 작성', '접수대기 목록에 등록', '<b>품질담당자</b> 승인 → 접수번호 발급', '<a href="#/quality/list">분석리스트</a>에서 대기 → 진행 → 완료', '수입·의뢰·출하·공정검사 구분'])}
    ${flow('품질 (VOC)', ['<b>누구나</b> <a href="#/quality/voc/request">VOC 접수</a> (고객사·제품·수량·LOT·사진)', '<b>품질팀장(품질책임자)</b> 승인', '<a href="#/quality/voc/list">VOC 처리목록</a>에서 대기 → 진행 → 완료', '진행 코멘트에 처리사항 기록'])}
    ${flow('개발', ['<b>누구나</b> <a href="#/dev/request">개발의뢰</a> 작성 (타겟제품·타겟단가)', '접수대기 목록에 등록', '<b>연구소담당자</b> 승인', '<a href="#/dev/list">개발리스트</a>에서 대기 → 진행 → 완료'])}
    ${flow('생산', ['<b>누구나</b> <a href="#/prod/request">샘플의뢰</a> 작성', '<b>생산담당자</b> 승인 → <a href="#/prod/list">샘플리스트</a>', '<a href="#/prod/finished">완제품</a> / <a href="#/prod/semi">반제품</a> 생산일정 일·주·월 입력'])}
    ${flow('구매 (세탁) · 물류 (출하)', ['세탁 입고분 불량 폐기 → <a href="#/purchase/laundry">세탁관리</a>에 사진·수량', '매일 출고 품목 → <a href="#/logistics/ship">출하목록</a> 입력'])}
  </div>
  <p class="muted small">※ 샘플 및 개발제품의 출고(or 제출)는 제조/품질본부장 승인 후 출고 가능</p>`;
}

// ───────────── 구매: 발주목록 ─────────────
const ITEM_CATEGORIES = ['제품', '상품', '원자재', '부자재'];
function categoryOptions(value = '', all = false) {
  return `<option value="">${all ? '전체 분류' : '분류 선택'}</option>` + ITEM_CATEGORIES.map(category => `<option value="${category}" ${value === category ? 'selected' : ''}>${category}</option>`).join('');
}
function categoryField(value = '') {
  return `<label>분류 *<select name="item_category" required>${categoryOptions(value)}</select></label>`;
}
function coaChip(value) { return value ? '<span class="chip">COA 요청</span>' : '<span class="muted">—</span>'; }
function poForm(po = {}) {
  return `<div class="form-grid">
    <label>구매의뢰번호 *<input name="req_no" required value="${esc(po.req_no)}"></label>
    <label>거래처 *<input name="vendor" required value="${esc(po.vendor)}"></label>
    ${categoryField(po.item_category)}
    <label class="inline coa-field"><input name="coa_requested" type="checkbox" value="1" ${po.coa_requested ? 'checked' : ''}> COA 요청</label>
    <label class="span2">품목명 *<input name="item" required value="${esc(po.item)}"></label>
    <label>수량 *<input name="qty" type="number" min="0" step="any" required value="${esc(po.qty)}"></label>
    <label>납기일 *<input name="due_date" type="date" required value="${esc(po.due_date)}"></label>
    <label class="span2">비고<input name="note" value="${esc(po.note)}"></label>
  </div>`;
}
function recvChip(po) {
  const cls = { ok: 'green', mismatch: 'red', checking: 'yellow' }[po.recv_status] || '';
  const shortClosed = po.recv_status === 'ok' && po.recv_qty != null && po.recv_qty !== po.qty;
  return `<span class="chip ${cls}">${RECV[po.recv_status]}${po.recv_status === 'mismatch' ? ` (${fmtNum(po.recv_qty)})` : ''}${shortClosed ? ` · ${fmtNum(po.recv_qty)}/${fmtNum(po.qty)} 종결` : ''}</span>${receiptChangeInfo(po)}`;
}
// ── 기록된 입고 수량 수정·입고 취소 요청 (물류팀장 승인 후 반영) ──
const canApproveReceipt = () => ME && (ME.is_admin || ME.roles.includes('logistics_approver'));
function pendingReceipt(po) { try { return typeof po.pending_change === 'string' ? JSON.parse(po.pending_change) : po.pending_change || null; } catch { return null; } }
function receiptChangeText(c, po = {}) { return c.action === 'qty' ? `실입고 ${fmtNum(c.old_recv_qty ?? po.recv_qty)} → ${fmtNum(c.new_recv_qty)} 수정` : '입고 취소(미입고로)'; }
function receiptChangeInfo(po) {
  const c = pendingReceipt(po);
  if (c) return `<div class="small"><span class="chip yellow">승인 대기</span> ${receiptChangeText(c, po)} · ${esc(c.reason)} · ${esc(c.requested_by)}</div>${receiptChangeButtons(c)}`;
  return ['ok', 'mismatch'].includes(po.recv_status) ? `<div class="small"><button class="btn small" data-receipt-qty="${po.id}">수량 수정 요청</button> <button class="btn small danger" data-receipt-revert="${po.id}">입고 취소 요청</button></div>` : '';
}
function receiptChangeButtons(c) {
  return `${canApproveReceipt() ? `<button class="btn small primary" data-rchange-approve="${c.id}">승인</button> <button class="btn small danger" data-rchange-reject="${c.id}">반려</button>` : ''}${c.requested_by_id === ME.id ? ` <button class="btn small" data-rchange-cancel="${c.id}">요청 철회</button>` : ''}`;
}
function bindReceiptChanges(root, rows, after) {
  const run = async (button, task) => { if (button.disabled) return; button.disabled = true; try { await task(); await after(); } catch (error) { fail(error); } finally { button.disabled = false; } };
  $$('[data-receipt-qty]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => {
    const po = rows.find(row => row.id === Number(button.dataset.receiptQty));
    const v = await promptBox('입고 수량 수정 요청', `<p class="small muted">${esc(po.item)} · 발주 ${fmtNum(po.qty)} / 현재 실입고 <b>${fmtNum(po.recv_qty)}</b>. 물류팀장이 승인하면 반영됩니다.</p><label>바른 실입고 수량 *<input name="recv_qty" type="number" min="0" step="any" required value="${esc(po.recv_qty)}"></label><label>수정 사유 *<input name="reason" required maxlength="500"></label>`);
    if (!v) return; await api('POST', `/api/po/${po.id}/receipt-changes`, { action: 'qty', ...v, request_id: crypto.randomUUID() }); toast('수정 요청을 올렸습니다. 물류팀장 승인 후 반영됩니다.');
  }); });
  $$('[data-receipt-revert]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => {
    const po = rows.find(row => row.id === Number(button.dataset.receiptRevert));
    const v = await promptBox('입고 취소 요청', `<p class="small muted">${esc(po.item)} · 승인되면 미입고로 돌아갑니다. 이미 등록된 수입검사 이력은 남습니다.</p><label>취소 사유 *<input name="reason" required maxlength="500"></label>`);
    if (!v) return; await api('POST', `/api/po/${po.id}/receipt-changes`, { action: 'revert', ...v, request_id: crypto.randomUUID() }); toast('입고 취소 요청을 올렸습니다. 물류팀장 승인 후 반영됩니다.');
  }); });
  $$('[data-rchange-approve]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => { await api('POST', `/api/receipt-changes/${button.dataset.rchangeApprove}/approve`, {}); toast('승인했습니다. 입고 내용에 반영되었습니다.'); }); });
  $$('[data-rchange-reject]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => {
    const v = await promptBox('입고 수정 요청 반려', '<label>반려 사유 *<input name="note" required maxlength="500"></label>'); if (!v) return;
    await api('POST', `/api/receipt-changes/${button.dataset.rchangeReject}/reject`, v); toast('반려했습니다.');
  }); });
  $$('[data-rchange-cancel]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => {
    if (!(await confirmBox('이 요청을 철회할까요?'))) return; await api('POST', `/api/receipt-changes/${button.dataset.rchangeCancel}/cancel`); toast('요청을 철회했습니다.');
  }); });
}
async function renderReceiptChanges(root) {
  if (!root) return;
  const rows = await api('GET', '/api/receipt-changes?status=pending');
  if (!root.isConnected) return;
  root.innerHTML = rows.length ? `<div class="card"><h3>입고 수량 수정·취소 승인 대기 <span class="chip yellow">${rows.length}건</span></h3><p class="small muted">${canApproveReceipt() ? '승인하면 입고 수량에 바로 반영되고 진행 코멘트에 기록됩니다.' : '물류팀장 승인 후 반영됩니다.'}</p><div class="table-wrap"><table class="grid"><thead><tr><th>발주</th><th>요청 내용</th><th>사유</th><th>요청자</th><th></th></tr></thead><tbody>${rows.map(c => `<tr><td>${esc(c.req_no)} · ${esc(c.vendor)}<div><b>${esc(c.item)}</b> <span class="small muted">발주 ${fmtNum(c.order_qty)}</span></div></td><td>${receiptChangeText(c)}</td><td>${esc(c.reason)}</td><td>${esc(c.requested_by)}<br><span class="small muted">${esc(c.requested_at)}</span></td><td class="nowrap">${receiptChangeButtons(c)}</td></tr>`).join('')}</tbody></table></div></div>` : '';
}
const rowClass = (po) => ({ ok: 'row-green', mismatch: 'row-red', checking: 'row-yellow' }[po.recv_status] || '');

async function pagePO(main) {
  main.innerHTML = `
  <h1>발주목록 <span class="dept">구매</span></h1>
  <p class="muted">발주서를 보낸 항목을 입력합니다. 물류에서 입고 확인하면 색이 바뀝니다.</p>
  <form class="card" id="poNew"><h3>발주 등록</h3>${poForm()}<div class="actions"><button class="btn primary">등록</button></div></form>
  ${listControls('po', { dateLabel: '납기', placeholder: '의뢰번호·거래처·품목·입력자·메모', extra: `<label>분류<select name="item_category" id="poCategory">${categoryOptions('', true)}</select></label><label>입고 상태<select name="recv" id="poF"><option value="">전체 입고</option><option value="none">미입고</option><option value="checking">확인중</option><option value="mismatch">수량상이</option><option value="ok">입고완료</option></select></label><label>COA 요청<select name="coa_requested"><option value="">전체</option><option value="1">요청</option><option value="0">미요청</option></select></label>` })}
  <div class="legend"><span class="chip green">입고완료</span><span class="chip red">수량상이</span><span class="chip yellow">확인중</span></div><div id="poList"></div>`;
  const filterForm = $('#poFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const rows = await api('GET', '/api/po?' + new URLSearchParams(formObj(filterForm)));
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, rows.length);
    const t = todayStr();
    $('#poList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid">
      <thead><tr><th>구매의뢰번호</th><th>거래처</th><th>품목명</th><th>분류</th><th>COA 요청</th><th class="r">수량</th><th>납기일</th><th>입고상태</th><th>비고</th><th>입력자</th><th></th></tr></thead>
      <tbody>${rows.map((p) => `<tr class="${rowClass(p)}">
        <td>${esc(p.req_no)}</td><td>${esc(p.vendor)}</td><td>${esc(p.item)}${lineInfo(p)}</td><td>${esc(p.item_category || '미분류')}</td><td>${coaChip(p.coa_requested)}</td><td class="r">${fmtNum(p.qty)}</td>
        <td class="${p.recv_status !== 'ok' && p.due_date < t ? 'overdue' : ''}">${esc(p.due_date)}</td>
        <td>${recvChip(p)}${p.recv_note ? `<div class="small muted">${esc(p.recv_note)}</div>` : ''}</td>
        <td>${esc(p.note)}</td><td class="small muted">${esc(p.created_by)}</td>
        <td class="nowrap">${commentButton("purchase_order", p.id, p.item)} <button class="btn small" data-edit="${p.id}">수정</button> <button class="btn small danger" data-del="${p.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">등록된 발주가 없습니다.</div>';
    bindReceiptChanges($('#poList'), rows, load);
    $$('[data-edit]').forEach((b) => (b.onclick = () => {
      const p = rows.find((x) => x.id == b.dataset.edit);
      const m = modal(`<h3>발주 수정</h3><form data-entry-author="${esc(p.created_by)}">${poForm(p)}<div class="actions"><button class="btn primary">저장</button></div></form>`, { wide: true });
      $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api('PUT', '/api/po/' + p.id, formObj(e.target)); m.close(); toast('수정했습니다.'); load(); } catch (err) { fail(err); } };
    }));
    $$('[data-del]').forEach((b) => (b.onclick = async () => { if (await confirmBox('이 발주를 삭제할까요?')) { try { await api('DELETE', '/api/po/' + b.dataset.del); load(); } catch (e) { fail(e); } } }));
  };
  $('#poNew').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/api/po', formObj(e.target)); e.target.reset(); toast('발주를 등록했습니다.'); load(); } catch (err) { fail(err); } };
  bindListControls(filterForm, load);
  await load();
}

// ───────────── 물류: 발주입고목록 ─────────────
async function pageReceipts(main, tab) {
  main.innerHTML = `<h1>입고목록 <span class="dept">물류</span></h1><div class="tabs receipt-tabs"><a href="#/logistics/receive" class="${tab === 'purchase' ? 'on' : ''}">발주입고</a><a href="#/logistics/other" class="${tab === 'other' ? 'on' : ''}">기타입고</a></div><section id="receiptContent"></section>`;
  if (tab === 'other') await pageOtherReceipts($('#receiptContent', main));
  else await pageReceive($('#receiptContent', main));
}
async function pageReceive(main) {
  main.innerHTML = `
  <h2>발주입고</h2>
  <div id="receiptChanges"></div>
  <p class="muted">구매의 발주목록을 불러옵니다. 입고된 항목을 체크하고 버튼을 누르세요. <b>입고확인</b> 또는 <b>수량상이</b> 처리 시 분석리스트에 수입검사(대기)가 자동 등록됩니다(수량상이는 실입고 수량 기준). 누구나 처리할 수 있으며, 처리한 사람과 내용은 각 항목의 <b>진행 코멘트</b>에 자동으로 남습니다.<br>수량상이 항목에 <b>입고확인·완료</b>를 누르면 실입고 수량 그대로 <b>입고 종결</b>됩니다(예: 100개 중 90개). 나중에 들어오는 나머지는 <b>기타입고</b>로 등록하세요. 이미 기록된 입고 수량의 수정·입고 취소는 <b>물류팀장 승인</b> 후 반영됩니다.</p>
  ${listControls('rc', { dateLabel: '납기', placeholder: '의뢰번호·거래처·품목·입력자·메모', extra: `<label>입고 상태<select name="recv" id="rcF"><option value="open">미완료</option><option value="">전체 입고</option><option value="none">미입고</option><option value="checking">확인중</option><option value="mismatch">수량상이</option><option value="ok">입고완료</option></select></label><label>분류<select name="item_category">${categoryOptions('', true)}</select></label>${listInspectionSelect()}` })}
  <div class="actionbar">
    <span id="rcSelectedCount" class="muted">0개 선택</span>
    <button class="btn green" data-st="ok" title="수량상이 항목은 실입고 수량 그대로 입고 종결">✔ 입고확인·완료</button>
    <button class="btn red" data-st="mismatch">수량상이</button>
    <button class="btn yellow" data-st="checking">확인중</button>
    <button class="btn" data-st="">미입고로 되돌리기</button>
  </div>
  <div id="rcList"></div>`;
  let rows = []; const filterForm = $('#rcFilters', main); let queryVersion = 0;
  const selected = () => $$('.rc-check:checked').map((c) => Number(c.value));
  const updateCount = () => { $('#rcSelectedCount').textContent = `${selected().length}개 선택`; };
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const found = await api('GET', '/api/po?' + new URLSearchParams(formObj(filterForm)));
    if (version !== queryVersion || !main.isConnected) return;
    rows = found;
    listCount(filterForm, rows.length);
    const t = todayStr();
    $('#rcList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid">
      <thead><tr><th><input type="checkbox" id="rcAll" aria-label="전체 선택"></th><th>구매의뢰번호</th><th>거래처</th><th>품목명</th><th>분류</th><th>COA 요청</th><th class="r">발주수량</th><th class="r">실입고</th><th>납기일</th><th>상태</th><th>입력자</th><th>입고 처리자</th><th>사진·검수</th></tr></thead>
      <tbody>${rows.map((p) => `<tr class="${rowClass(p)}">
        <td><input type="checkbox" class="rc-check" value="${p.id}" aria-label="선택"></td>
        <td>${esc(p.req_no)}</td><td>${esc(p.vendor)}</td><td>${esc(p.item)}${lineInfo(p)}</td><td>${esc(p.item_category || '미분류')}</td><td>${coaChip(p.coa_requested)}</td><td class="r">${fmtNum(p.qty)}</td>
        <td class="r">${p.recv_status ? fmtNum(p.recv_qty) : ''}</td>
        <td class="${p.recv_status !== 'ok' && p.due_date < t ? 'overdue' : ''}">${esc(p.due_date)}</td>
        <td>${recvChip(p)}${p.recv_note ? `<div class="small muted">${esc(p.recv_note)}</div>` : ''}</td>
        <td class="small muted">${esc(p.created_by || '기존 기록: 미기록')}</td><td class="small muted">${esc(p.recv_by || '')}${p.recv_at ? '<br>' + esc(p.recv_at.slice(5, 16)) : ''}</td><td>${commentButton("purchase_order", p.id, p.item)} <button class="btn small" data-receipt-photo="${p.id}">사진·이상 여부</button>${inspectionBadge(p)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">해당하는 발주가 없습니다.</div>';
    const all = $('#rcAll'); if (all) all.onchange = () => { $$('.rc-check').forEach((c) => (c.checked = all.checked)); updateCount(); };
    $$('.rc-check').forEach((c) => (c.onchange = updateCount));
    // 행 클릭으로도 체크
    $$('#rcList tbody tr').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('input,button')) { const c = $('.rc-check', tr); c.checked = !c.checked; updateCount(); } }));
    bindReceiptChanges($('#rcList'), rows, load);
    renderReceiptChanges($('#receiptChanges')).then(() => bindReceiptChanges($('#receiptChanges'), rows, load)).catch(fail);
    $$('#rcList [data-receipt-photo]').forEach(button => button.onclick = () => openAttachments('purchase_order', Number(button.dataset.receiptPhoto), rows.find(row => row.id === Number(button.dataset.receiptPhoto)).item));
    updateCount();
  };
  $$('.actionbar [data-st]').forEach((b) => (b.onclick = async () => {
    const ids = selected(); const status = b.dataset.st;
    if (!ids.length) return toast('먼저 항목을 체크하세요.', 'err');
    let extra = {};
    if (status === 'mismatch') {
      if (ids.length !== 1) return toast('수량상이는 한 항목씩 처리하세요. (실입고 수량 입력)', 'err');
      const p = rows.find((x) => x.id === ids[0]);
      const v = await promptBox('수량상이 입력', `<p class="muted">${esc(p.item)} · 발주수량 <b>${fmtNum(p.qty)}</b></p><label>실입고 수량 *<input name="recv_qty" type="number" min="0" step="any" required></label><label>메모<input name="note" placeholder="예) 2박스 부족, 추가 입고 예정"></label>`);
      if (!v) return; extra = v;
    } else if (status === 'checking') {
      const v = await promptBox('확인중 표시', '<label>메모 (선택)<input name="note" placeholder="예) 검수 대기"></label>');
      if (!v) return; extra = v;
    }
    try { const result = await api('POST', '/api/po/receive', { ids, status, ...extra }); toast(`${ids.length}건 → ${RECV[status]}${result.analysis_created ? ` · 분석 ${result.analysis_created}건 자동 등록` : ''}`); load(); } catch (e) { fail(e); }
  }));
  bindListControls(filterForm, load);
  await load();
}

// ───────────── 물류: 기타입고 ─────────────
function otherReceiptForm(row = {}) {
  return `<div class="form-grid">
    <label>입고일 *<input name="received_date" type="date" required value="${esc(row.received_date || todayStr())}"></label>
    <label class="span2">BOM 검색<input data-receipt-bom-search type="search" placeholder="품목명 또는 품목코드 검색"></label>
    <label class="span2">BOM 품목 *<select name="bom_id" data-receipt-bom ${row.id && !row.bom_id ? '' : 'required'}><option value="">${row.id && !row.bom_id ? '기존 수기 등록 품목' : 'BOM 품목을 선택하세요'}</option></select></label>
    <label>품목명<input name="item" required maxlength="200" value="${esc(row.item)}" ${row.id && !row.bom_id ? '' : 'readonly'}></label>
    <label>분류<input name="item_category" readonly value="${esc(row.item_category)}"></label>
    <label>입고수량 *<input name="qty" type="number" min="0" step="any" required value="${esc(row.qty)}"></label>
    <label>단위<input data-receipt-unit readonly></label>
    <label>입고처 *<input name="vendor" required maxlength="100" value="${esc(row.vendor)}"></label>
    <label>비고<input name="note" maxlength="500" value="${esc(row.note)}" placeholder="발주 없이 입고된 사유 등"></label>
  </div>`;
}
function receiptBomSnapshot(row) { return typeof row.bom_snapshot === 'string' ? JSON.parse(row.bom_snapshot) : row.bom_snapshot || {}; }
function bindReceiptBom(form, row = {}) {
  const select = $('[data-receipt-bom]', form); const search = $('[data-receipt-bom-search]', form);
    const original = row.bom_id ? receiptBomSnapshot(row) : null;
  let choices = new Map(); let serial = 0;
  const apply = () => {
    const chosen = choices.get(Number(select.value));
    form.elements.item.readOnly = !!chosen || !row.id || !!row.bom_id;
    if (chosen) {
      form.elements.item.value = chosen.product; form.elements.item_category.value = chosen.item_category;
      $('[data-receipt-unit]', form).value = chosen.unit || '';
    } else {
      form.elements.item.value = row.id && !row.bom_id ? row.item : '';
      form.elements.item_category.value = row.id && !row.bom_id ? row.item_category : '';
      $('[data-receipt-unit]', form).value = '';
    }
  };
  const load = async () => {
    const request = ++serial; const selected = select.value || (original ? String(row.bom_id) : '');
    const previous = choices.get(Number(selected));
    const results = await api('GET', '/api/boms?q=' + encodeURIComponent(search.value));
    if (request !== serial || !form.isConnected) return;
    choices = new Map(results.map(bom => [bom.id, bom]));
    if (previous && !choices.has(previous.id)) choices.set(previous.id, previous);
    if (original) choices.set(Number(row.bom_id), { ...original, id: Number(row.bom_id) });
    select.innerHTML = `<option value="">${row.id && !row.bom_id ? '기존 수기 등록 품목' : 'BOM 품목을 선택하세요'}</option>` + [...choices.values()].map(bom => `<option value="${bom.id}" ${ITEM_CATEGORIES.includes(bom.item_category) ? '' : 'disabled'}>${esc(bom.product)}${bom.product_code ? ' · ' + esc(bom.product_code) : ''} / ${esc(bom.item_category || '미분류: 관리자 지정 필요')}</option>`).join('');
    select.value = choices.has(Number(selected)) ? selected : ''; apply();
  };
  select.onchange = apply;
  let timer; search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 250); };
  form.addEventListener('reset', () => queueMicrotask(() => { select.value = ''; apply(); }));
  load().catch(fail);
}
async function pageOtherReceipts(main) {
  main.innerHTML = `<h2>기타입고</h2>
    <p class="muted">BOM에서 품목을 검색·선택하여 발주 없는 입고를 입력합니다. 등록 즉시 분석리스트에 수입검사(대기)가 자동 등록됩니다.</p>
    <form class="card" id="otherNew"><h3>기타입고 등록</h3>${otherReceiptForm()}<div class="form-grid">${photoPicker()}${inspectionFields()}</div><div class="actions"><button class="btn primary">등록</button></div></form>
    ${listControls('other', { dateLabel: '입고', from: monthStart(todayStr()), to: todayStr(), placeholder: '품목·코드·입고처·입력자·메모', extra: `<label>분류<select name="item_category" id="otherCategory">${categoryOptions('', true)}</select></label>${listInspectionSelect()}` })}<div id="otherList"></div>`;
  const filterForm = $('#otherFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const params = new URLSearchParams(formObj(filterForm));
    const rows = await api('GET', '/api/other-receipts?' + params);
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, rows.length);
    $('#otherList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>입고일</th><th>분류</th><th>품목명</th><th class="r">입고수량</th><th>입고처</th><th>비고</th><th>입력자</th><th></th></tr></thead>
      <tbody>${rows.map(row => `<tr><td>${esc(row.received_date)}</td><td>${esc(row.item_category)}</td><td>${esc(row.item)}${lineInfo(row)}${receiptBomSnapshot(row).product_code ? `<div class="small muted">${esc(receiptBomSnapshot(row).product_code)}</div>` : ''}</td><td class="r">${fmtNum(row.qty)} ${esc(receiptBomSnapshot(row).unit || '')}</td><td>${esc(row.vendor)}</td><td>${esc(row.note)}</td><td>${esc(row.created_by)}</td><td class="nowrap">${commentButton("other_receipt", row.id, row.item)} <button class="btn small" data-other-photo="${row.id}">사진·이상 여부</button>${inspectionBadge(row)} <button class="btn small" data-other-edit="${row.id}">수정</button> <button class="btn small danger" data-other-del="${row.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">해당하는 기타입고가 없습니다.</div>';
    $$('[data-other-photo]', main).forEach(button => button.onclick = () => { const row = rows.find(row => row.id === Number(button.dataset.otherPhoto)); openAttachments('other_receipt', row.id, row.item, { editable: ME.is_admin || hasRole('logistics') || row.created_by === ME.name }); });
    $$('[data-other-edit]', main).forEach(button => button.onclick = () => {
      const row = rows.find(row => row.id === Number(button.dataset.otherEdit));
      const box = modal(`<h3>기타입고 수정</h3><form data-entry-author="${esc(row.created_by)}">${otherReceiptForm(row)}<div class="actions"><button class="btn primary">저장</button></div></form>`, { wide: true });
      bindReceiptBom($('form', box.el), row);
      $('form', box.el).onsubmit = async event => {
        event.preventDefault();
        try { await api('PUT', '/api/other-receipts/' + row.id, formObj(event.target)); box.close(); toast('수정했습니다.'); await load(); } catch (error) { fail(error); }
      };
    });
    $$('[data-other-del]', main).forEach(button => button.onclick = async () => {
      if (!await confirmBox('이 기타입고 기록을 삭제할까요?')) return;
      try { await api('DELETE', '/api/other-receipts/' + button.dataset.otherDel); await load(); } catch (error) { fail(error); }
    });
  };
  const otherDraft = bindPhotoDraft($('#otherNew'));
  bindReceiptBom($('#otherNew'));
  $('#otherNew').onsubmit = async event => {
    event.preventDefault(); if (otherDraft.busy) return; const button = $('button.primary', event.target); button.disabled = true;
    try {
      const value = formObj(event.target); const saved = await api('POST', '/api/other-receipts', value); const photoSaved = await saveNewAttachments('other_receipt', saved, otherDraft, event.target);
      event.target.reset(); otherDraft.reset(); filterForm.reset(); $('#otherFrom').value = monthStart(value.received_date); $('#otherTo').value = value.received_date;
      $('#otherQ').value = ''; $('#otherCategory').value = ''; if (photoSaved) toast('기타입고와 분석리스트에 등록했습니다.'); await load();
    } catch (error) { fail(error); } finally { button.disabled = false; }
  };
  bindListControls(filterForm, load);
  await load();
}

// ───────────── 구매: 세탁관리 ─────────────
async function pageLaundry(main) {
  const month = todayStr().slice(0, 7);
  main.innerHTML = `
  <h1>세탁관리 <span class="dept">구매</span></h1>
  <p class="muted">세탁 입고분의 불량 폐기 사진과 수량을 기록합니다.</p>
  <form class="card" id="lnNew"><h3>세탁 폐기 등록</h3>
    <div class="form-grid">
      <label>입고일 *<input name="in_date" type="date" required value="${todayStr()}"></label>
      <label>입고수량<input name="in_qty" type="number" min="0" step="any" placeholder="선택"></label>
      <label>폐기수량 *<input name="discard_qty" type="number" min="0" step="any" required></label>
      <label class="span2">메모<input name="note" placeholder="불량 유형 등"></label>
      <label class="span3">불량폐기 사진 (여러 장 가능)<input name="photos" type="file" accept="image/*" multiple></label>
    </div>
    <div class="thumbs" id="lnPrev"></div>
    <div class="actions"><button class="btn primary">등록</button></div>
  </form>
  ${listControls('ln', { dateLabel: '입고', from: month + '-01', to: monthEnd(month + '-01'), placeholder: '메모·입력자 검색', extra: `<label>조회월<input type="month" id="lnM" value="${month}"></label><label>사진<select name="has_photos"><option value="">전체 사진</option><option value="1">사진 있음</option><option value="0">사진 없음</option></select></label><button type="button" class="btn" id="lnAllDates">전체 기간</button>` })}<p id="lnSum" class="muted small"></p>
  <div id="lnList" class="cards"></div>`;
  let pending = []; const filterForm = $('#lnFilters', main); let queryVersion = 0;
  $('[name=photos]').onchange = async (e) => {
    try { pending = await Promise.all([...e.target.files].map((f) => resizeImage(f))); } catch (err) { fail(err); pending = []; }
    $('#lnPrev').innerHTML = pending.map((s) => `<img src="${s}" alt="미리보기">`).join('');
  };
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const rows = await api('GET', '/api/laundry?' + new URLSearchParams(formObj(filterForm)));
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, rows.length);
    const sumD = rows.reduce((a, r) => a + (r.discard_qty || 0), 0); const sumI = rows.reduce((a, r) => a + (r.in_qty || 0), 0);
    $('#lnSum').innerHTML = `${rows.length}건 · 폐기 합계 <b>${fmtNum(sumD)}</b>${sumI ? ` / 입고 ${fmtNum(sumI)} (폐기율 ${(sumD / sumI * 100).toFixed(1)}%)` : ''}`;
    $('#lnList').innerHTML = rows.length ? rows.map((r) => `<div class="card ln">
        <h4>${esc(r.item || '기존 세탁기록')}${lineInfo(r)}</h4><div class="ln-head"><b>${esc(r.in_date)} (${dow(r.in_date)})</b><span class="chip red">폐기 ${fmtNum(r.discard_qty)}</span>${r.in_qty != null ? `<span class="chip">입고 ${fmtNum(r.in_qty)}</span>` : ''}</div>
        ${r.note ? `<p>${esc(r.note)}</p>` : ''}
        <div class="thumbs">${r.photos.map((f) => `<img src="/uploads/${esc(f)}" data-big="/uploads/${esc(f)}" alt="불량폐기 사진" loading="lazy">`).join('') || '<span class="muted small">사진 없음</span>'}</div>
        <div class="ln-foot"><span class="small muted">입력자: ${esc(r.created_by)}</span><span>${commentButton("laundry", r.id, r.in_date + " 세탁 기록")} <button class="btn small" data-edit="${r.id}">수정</button> <button class="btn small danger" data-del="${r.id}">삭제</button></span></div>
      </div>`).join('') : '<div class="empty">이 달의 기록이 없습니다.</div>';
    $$('#lnList [data-big]').forEach((i) => (i.onclick = () => lightbox(i.dataset.big)));
    $$('#lnList [data-del]').forEach((b) => (b.onclick = async () => { if (await confirmBox('이 기록과 사진을 삭제할까요?')) { try { await api('DELETE', '/api/laundry/' + b.dataset.del); load(); } catch (e) { fail(e); } } }));
    $$('#lnList [data-edit]').forEach((b) => (b.onclick = () => {
      const r = rows.find((x) => x.id == b.dataset.edit); let add = [];
      const m = modal(`<h3>세탁 기록 수정</h3><form data-entry-author="${esc(r.created_by)}"><div class="form-grid">
        <label>입고일 *<input name="in_date" type="date" required value="${esc(r.in_date)}"></label>
        <label>입고수량<input name="in_qty" type="number" min="0" step="any" value="${esc(r.in_qty)}"></label>
        <label>폐기수량 *<input name="discard_qty" type="number" min="0" step="any" required value="${esc(r.discard_qty)}"></label>
        <label class="span3">메모<input name="note" value="${esc(r.note)}"></label></div>
        <p class="small muted">체크 해제한 사진은 삭제됩니다.</p>
        <div class="thumbs">${r.photos.map((f) => `<label class="keep"><img src="/uploads/${esc(f)}" alt=""><input type="checkbox" name="keep_photos" value="${esc(f)}" checked> 유지</label>`).join('')}</div>
        <label>사진 추가<input type="file" accept="image/*" multiple id="lnAdd"></label><div class="thumbs" id="lnAddPrev"></div>
        <div class="actions"><button class="btn primary">저장</button></div></form>`, { wide: true });
      $('#lnAdd', m.el).onchange = async (e) => { add = await Promise.all([...e.target.files].map((f) => resizeImage(f))).catch((err) => { fail(err); return []; }); $('#lnAddPrev', m.el).innerHTML = add.map((s) => `<img src="${s}" alt="">`).join(''); };
      $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api('PUT', '/api/laundry/' + r.id, { ...formObj(e.target), photos: add }); m.close(); toast('수정했습니다.'); load(); } catch (err) { fail(err); } };
    }));
  };
  $('#lnNew').onsubmit = async (e) => {
    e.preventDefault(); const btn = $('button.primary', e.target); btn.disabled = true;
    try { await api('POST', '/api/laundry', { ...formObj(e.target), photos: pending }); e.target.reset(); e.target.in_date.value = todayStr(); pending = []; $('#lnPrev').innerHTML = ''; toast('등록했습니다.'); load(); }
    catch (err) { fail(err); } finally { btn.disabled = false; }
  };
  bindListControls(filterForm, load);
  $('#lnM').onchange = () => { const value = $('#lnM').value; $('#lnFrom').value = value ? value + '-01' : ''; $('#lnTo').value = value ? monthEnd(value + '-01') : ''; load().catch(fail); };
  for (const id of ['lnFrom','lnTo']) $('#' + id).addEventListener('change', () => { $('#lnM').value = ''; });
  $('#lnAllDates').onclick = () => { $('#lnM').value = ''; $('#lnFrom').value = ''; $('#lnTo').value = ''; load().catch(fail); };
  await load();
}

// ───────────── 의뢰 양식 (분석/개발/샘플) ─────────────
function fieldInput(f, r = {}) {
  const v = f.core ? r[f.k] : (r.data || {})[f.k];
  const etc = (r.data || {})[f.k + '_etc'] || '';
  const label = `${esc(f.label)}${f.req ? ' *' : ''}${f.hint ? ` <span class="hint">(${esc(f.hint)})</span>` : ''}`;
  const cls = f.full || f.t === 'textarea' || f.t === 'checks' || (f.t === 'radio' && f.opts.length > 3) ? 'span3' : f.t === 'radio' ? 'span2' : '';
  if (f.t === 'textarea') return `<label class="${cls}">${label}<textarea name="${f.k}" rows="3" ${f.req ? 'required' : ''}>${esc(v)}</textarea></label>`;
  if (f.t === 'radio' || f.t === 'checks') {
    const type = f.t === 'radio' ? 'radio' : 'checkbox';
    const sel = f.t === 'checks' ? (Array.isArray(v) ? v : []) : [v];
    const etcInput = f.other ? `<span class="opt">기타 <input name="${f.k}_etc" value="${esc(etc)}" class="etc"></span>`
      : f.otherOn ? `<input name="${f.k}_etc" value="${esc(etc)}" class="etc" placeholder="${esc(f.otherPh || '')}">` : '';
    return `<fieldset class="${cls}"><legend>${label}</legend><div class="opts">${f.opts.map((o) => `<label class="opt"><input type="${type}" name="${f.k}" value="${esc(o)}" ${sel.includes(o) ? 'checked' : ''} ${f.req && type === 'radio' ? 'required' : ''}> ${esc(o)}</label>`).join('')}${etcInput}</div></fieldset>`;
  }
  return `<label class="${cls}">${label}<input name="${f.k}" type="${f.t === 'date' ? 'date' : f.t === 'number' ? 'number' : 'text'}" value="${esc(v)}" ${f.req ? 'required' : ''} ${f.t === 'number' ? `min="${f.min ?? 0}" step="${f.step || 'any'}"` : ''} placeholder="${esc(f.ph || '')}"></label>`;
}
function collectRequest(type, form) {
  const o = formObj(form); const out = { type, data: {} };
  for (const f of REQ[type].fields) {
    if (f.core) out[f.k] = o[f.k] || ''; else out.data[f.k] = f.t === 'checks' ? (o[f.k] || []) : (o[f.k] || '');
    if (f.other || f.otherOn) out.data[f.k + '_etc'] = o[f.k + '_etc'] || '';
  }
  return out;
}
function fieldValue(f, r) {
  const v = f.core ? r[f.k] : (r.data || {})[f.k]; const etc = (r.data || {})[f.k + '_etc'];
  let s = Array.isArray(v) ? v.join(', ') : (v || '');
  if (etc && (f.other || (f.otherOn && v === f.otherOn))) s += (s ? ', ' : '') + (f.other ? '기타: ' : '') + etc;
  return s;
}
function requestForm(type, r) {
  return `<form class="req-form" ${r ? `data-entry-author="${esc(r.requester_name)}"` : ''}><div class="form-grid">${REQ[type].fields.map((f) => fieldInput(f, r)).join('')}${['development','sample','voc'].includes(type) ? photoPicker() : ''}</div>
    <div class="actions"><button class="btn primary">${r ? '저장' : (REQ[type].submitLabel || '의뢰 접수')}</button></div></form>`;
}
function statusChip(s) { return `<span class="chip st-${s}">${STATUS[s]}</span>`; }

function requestDetail(type, r, reload) {
  const cfg = REQ[type]; const mgr = hasRole(cfg.role); const approver = canApproveRequest(type);
  const mine = r.requester_id === ME.id;
  const rows = cfg.fields.map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(fieldValue(f, r)) || '<span class="muted">-</span>'}</td></tr>`).join('');
  const m = modal(`
    <div class="print-area">
    <h3>${cfg.documentTitle || cfg.label + '의뢰서'} ${statusChip(r.status)}</h3>${lineInfo(r)}
    <table class="kv">
      <tr><th>접수번호</th><td>${esc(r.req_no || '(승인 시 발급)')}</td></tr>
      ${r.source_type ? `<tr><th>입고 출처</th><td><a href="${r.source_type === 'purchase_order' ? '#/logistics/receive' : '#/logistics/other'}">${r.source_type === 'purchase_order' ? '발주입고' : '기타입고'} #${esc(r.source_id)}</a>${r.data.purchase_req_no ? ' · 구매의뢰번호 ' + esc(r.data.purchase_req_no) : ''}</td></tr>
      <tr><th>입고일 / 분류</th><td>${esc(r.data.received_date || '')} / ${esc(r.data.item_category || '미분류')}</td></tr>
      <tr><th>입고수량 / COA</th><td>${fmtNum(r.data.received_qty)} ${esc(r.data.unit || '')} / ${r.data.coa_requested ? 'COA 요청' : '요청 없음'}</td></tr>` : ''}
      <tr><th>입력자(의뢰자)</th><td>${esc(r.requester_name)} · ${esc(r.created_at.slice(0, 16))}</td></tr>
      ${r.approver_name ? `<tr><th>${r.status === 'rejected' ? '반려자' : '접수자'}</th><td>${esc(r.approver_name)}${r.approved_at ? ' · ' + esc(r.approved_at.slice(0, 16)) : ''}</td></tr>` : ''}
      ${r.reject_reason ? `<tr><th>반려 사유</th><td class="red-text">${esc(r.reject_reason)}</td></tr>` : ''}
      ${rows}
      ${r.result_note ? `<tr><th>결과/메모</th><td>${esc(r.result_note)}</td></tr>` : ''}
    </table>
    ${['development','sample','voc'].includes(type) || r.source_type ? '<h4>첨부 사진 · 기록</h4><div data-request-photos></div>' : ''}
    </div>
    <div class="actions wrap">
      <button class="btn" data-a="print">인쇄</button>${commentButton("request", r.id, r.title)}
      ${['development','sample','voc'].includes(type) ? '<button class="btn" data-a="photos">사진 보기·첨부</button>' : ''}
      ${(mine && ['pending', 'rejected'].includes(r.status)) || mgr ? '<button class="btn" data-a="edit">수정</button>' : ''}
      ${(mine && ['pending', 'rejected'].includes(r.status)) || mgr ? '<button class="btn danger" data-a="del">삭제</button>' : ''}
      ${approver && r.status === 'pending' ? '<button class="btn red" data-a="reject">반려</button><button class="btn primary" data-a="approve">승인</button>' : ''}
      ${approver && r.status === 'rejected' ? '<button class="btn primary" data-a="approve">승인</button>' : ''}
      ${mgr && ['waiting', 'progress', 'done'].includes(r.status) ? '<button class="btn" data-a="status">상태/결과 변경</button>' : ''}
    </div>`, { wide: true });
  if (['development','sample','voc'].includes(type)) renderAttachmentPreview($('[data-request-photos]', m.el), 'request', r.id);
  else if (r.source_type) renderAttachmentPreview($('[data-request-photos]', m.el), r.source_type, r.source_id);
  const act = async (a) => {
    try {
      if (a === 'photos') { await openAttachments('request', r.id, r.title, { editable: (mine && ['pending','rejected'].includes(r.status)) || mgr }); return; }
      if (a === 'print') { document.body.classList.add('printing'); window.print(); document.body.classList.remove('printing'); return; }
      if (a === 'approve') { await api('POST', `/api/requests/${r.id}/approve`); toast(`승인했습니다. ${cfg.listTitle || cfg.label + '리스트'}에 등록됨`); }
      if (a === 'reject') { const v = await promptBox('반려 사유', '<label>사유 *<textarea name="reason" required rows="3"></textarea></label>'); if (!v) return; await api('POST', `/api/requests/${r.id}/reject`, v); toast('반려했습니다.'); }
      if (a === 'del') { if (!(await confirmBox('이 의뢰를 삭제할까요?'))) return; await api('DELETE', `/api/requests/${r.id}`); toast('삭제했습니다.'); }
      if (a === 'status') { const v = await promptBox('상태/결과 변경', `<label>상태<select name="status">${['waiting', 'progress', 'done'].map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select></label><label>결과/메모<textarea name="result_note" rows="3">${esc(r.result_note)}</textarea></label>`); if (!v) return; await api('POST', `/api/requests/${r.id}/status`, v); toast('변경했습니다.'); }
      if (a === 'edit') {
        m.close(); const e2 = modal(`<h3>${cfg.label}의뢰 수정</h3>${requestForm(type, r)}`, { wide: true });
        const editForm = $('form', e2.el); const draft = bindPhotoDraft(editForm);
        editForm.onsubmit = async (ev) => { ev.preventDefault(); if (draft.busy) return; try { const saved = await api('PUT', `/api/requests/${r.id}`, collectRequest(type, ev.target)); const photoSaved = await saveNewAttachments('request', saved, draft, editForm); e2.close(); if (photoSaved) toast('저장했습니다.'); reload(); } catch (err) { fail(err); } };
        return;
      }
      m.close(); reload();
    } catch (e) { fail(e); }
  };
  $$('[data-a]', m.el).forEach((b) => (b.onclick = () => act(b.dataset.a)));
}

// 의뢰 접수 페이지: 양식 + 접수대기 목록
async function pageIntake(type) {
  const cfg = REQ[type]; const main = $('#main'); const mgr = canApproveRequest(type);
  const managers = ['analysis','development','voc'].includes(type) ? (await api('GET', '/api/approval-managers'))[type === 'voc' ? 'analysis' : type] : null;
  main.innerHTML = `
  <h1>${cfg.intakeTitle || cfg.label + '의뢰'} <span class="dept">${cfg.dept}</span></h1>
  <p class="muted">누구나 의뢰할 수 있습니다. 접수대기 목록에 올라가고, <b>${cfg.mgr}</b>가 승인하면 <a href="${cfg.list}">${cfg.listTitle || cfg.label + '리스트'}</a>에 올라갑니다.
  ${managers ? `<br>지정 승인권자: ${managers.length ? managers.map(u => esc(u.name)).join(', ') : '미지정 · 관리자에게 책임자 지정을 요청하세요.'} (관리자도 승인 가능)` : ''}
  ${mgr ? `<br><span class="tag">${cfg.mgr} 권한</span> 아래 목록에서 바로 승인/반려할 수 있습니다.` : ''}</p>
  <details class="card" id="reqNewBox" open><summary><h3>새 ${cfg.intakeTitle || cfg.label + '의뢰'} 작성</h3></summary>${requestForm(type)}</details>
  <h2>접수대기 목록</h2>${listControls('intake', { dateLabel: '등록', placeholder: '품목·고객사·입력자·메모', extra: `<label>상태<select name="status"><option value="">전체 접수대기·반려</option><option value="pending">접수대기</option><option value="rejected">반려</option></select></label>${type === 'analysis' ? '<label>검사 구분<select name="category"><option value="">전체 검사</option>' + ['수입검사','의뢰검사','출하검사','공정검사'].map(category => `<option>${category}</option>`).join('') + '</select></label>' : ''}` })}<div id="intakeList"></div>`;
  const filterForm = $('#intakeFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const params = new URLSearchParams({ ...formObj(filterForm), type, scope: 'intake' });
    const rows = await api('GET', '/api/requests?' + params);
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, rows.length);
    $('#intakeList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid click">
      <thead><tr><th>상태</th><th>${cfg.titleLabel}</th>${type === 'analysis' ? '<th>검사구분</th>' : ''}${type === 'development' ? '<th>타겟단가</th>' : ''}<th>고객사</th>${type === 'voc' ? '<th>수량</th><th>LOT</th>' : ''}<th>완료희망일</th><th>입력자(의뢰자)</th><th>의뢰일</th>${mgr ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows.map((r) => `<tr data-id="${r.id}">
        <td>${statusChip(r.status)} ${commentButton("request", r.id, r.title)}</td><td><b>${esc(r.title)}</b>${lineInfo(r)}</td>${type === 'analysis' ? `<td>${esc(r.category)}</td>` : ''}${type === 'development' ? `<td>${esc(r.target_price)}</td>` : ''}
        <td>${esc(r.customer)}</td>${type === 'voc' ? `<td>${fmtNum(r.data.qty)} ${esc(r.data.unit)}</td><td>${esc(r.data.lot || '미확인')}</td>` : ''}<td>${esc(r.due_date || '')}</td><td>${esc(r.requester_name)}</td><td class="small muted">${esc(r.created_at.slice(0, 10))}</td>
        ${mgr ? `<td class="nowrap">${r.status === 'pending' ? `<button class="btn small primary" data-ok="${r.id}">승인</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">접수대기 중인 의뢰가 없습니다.</div>';
    $$('#intakeList tr[data-id]').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('button')) return; requestDetail(type, rows.find((x) => x.id == tr.dataset.id), load); }));
    $$('#intakeList [data-ok]').forEach((b) => (b.onclick = async () => { try { const r = await api('POST', `/api/requests/${b.dataset.ok}/approve`); toast(`승인 완료 · 접수번호 ${r.req_no}`); load(); } catch (e) { fail(e); } }));
  };
  const newForm = $('.req-form', main); const draft = bindPhotoDraft(newForm);
  bindListControls(filterForm, load);
  newForm.onsubmit = async (e) => {
    e.preventDefault(); if (draft.busy) return;
    const button = $('button.primary', newForm); button.disabled = true;
    try { const saved = await api('POST', '/api/requests', collectRequest(type, e.target)); const photoSaved = await saveNewAttachments('request', saved, draft, newForm); e.target.reset(); draft.reset(); if (photoSaved) toast('의뢰를 접수했습니다. 접수대기 목록을 확인하세요.'); load(); } catch (err) { fail(err); } finally { button.disabled = false; }
  };
  await load();
}

// 승인된 의뢰 리스트 (대기/진행/완료)
async function pageWorkList(type) {
  const cfg = REQ[type]; const main = $('#main'); const mgr = hasRole(cfg.role);
  let status = ''; let category = '';
  main.innerHTML = `
  <h1>${cfg.listTitle || cfg.label + '리스트'} <span class="dept">${cfg.dept}</span></h1>
  <p class="muted">${type === 'analysis' ? '승인된 분석의뢰와 입고에서 자동 등록된 수입검사 목록입니다.' : `승인된 ${cfg.label}의뢰 목록입니다.`} ${mgr ? '상태 칸에서 바로 대기/진행/완료를 바꿀 수 있습니다.' : `상태 변경은 ${cfg.mgr}가 합니다.`} 행을 누르면 의뢰서를 봅니다.</p>
  <div class="toolbar">
    <div class="seg" id="stSeg">${['', 'waiting', 'progress', 'done'].map((s) => `<button data-s="${s}" class="${s === status ? 'on' : ''}">${s ? STATUS[s] : '전체'}</button>`).join('')}</div>
    ${type === 'analysis' ? `<div class="seg" id="catSeg">${['', '수입검사', '의뢰검사', '출하검사', '공정검사'].map((c) => `<button data-c="${c}" class="${c === category ? 'on' : ''}">${c || '전체 검사'}</button>`).join('')}</div>` : ''}
  </div>
  <div id="workCounts" class="counts"></div>
  ${listControls('work', { dateLabel: '등록', placeholder: '접수번호·품목·고객사·입력자·메모' })}<div id="workList"></div>`;
  const filterForm = $('#workFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const all = await api('GET', '/api/requests?' + new URLSearchParams({ ...formObj(filterForm), type, scope: 'list', category }));
    if (version !== queryVersion || !main.isConnected) return;
    const rows = status ? all.filter((r) => r.status === status) : all;
    listCount(filterForm, rows.length);
    $('#workCounts').innerHTML = ['waiting', 'progress', 'done'].map((s) => `${statusChip(s)} ${all.filter((r) => r.status === s).length}`).join(' &nbsp; ');
    const t = todayStr();
    $('#workList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid click">
      <thead><tr><th>접수번호</th>${type === 'analysis' ? '<th>검사구분</th>' : ''}<th>${cfg.titleLabel}</th>${type === 'development' ? '<th>타겟단가</th>' : ''}<th>고객사</th>${type === 'voc' ? '<th>수량</th><th>LOT</th>' : ''}<th>입력자(의뢰자)</th><th>완료희망일</th><th>상태</th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-id="${r.id}" class="${r.status === 'done' ? 'row-done' : ''}">
        <td class="nowrap">${esc(r.req_no)}</td>${type === 'analysis' ? `<td><span class="chip">${esc(r.category)}</span></td>` : ''}
        <td><b>${esc(r.title)}</b>${lineInfo(r)}${r.source_type ? `<div class="small muted">${r.source_type === 'purchase_order' ? '발주입고' : '기타입고'} · ${esc(r.data.item_category || '미분류')} · 입고 ${fmtNum(r.data.received_qty)}${r.data.coa_requested ? ' · COA 요청' : ''}</div>` : ''}${r.result_note ? `<div class="small muted">${esc(r.result_note)}</div>` : ''}</td>${type === 'development' ? `<td>${esc(r.target_price)}</td>` : ''}
        <td>${esc(r.customer)}</td>${type === 'voc' ? `<td>${fmtNum(r.data.qty)} ${esc(r.data.unit)}</td><td>${esc(r.data.lot || '미확인')}</td>` : ''}<td>${esc(r.requester_name)}</td>
        <td class="${r.status !== 'done' && r.due_date && r.due_date < t ? 'overdue' : ''}">${esc(r.due_date || '')}</td>
        <td>${mgr ? `<select class="st-select st-${r.status}" data-st="${r.id}" aria-label="상태">${['waiting', 'progress', 'done'].map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select>` : statusChip(r.status)} ${commentButton("request", r.id, r.title)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">해당하는 항목이 없습니다.</div>';
    $$('#workList tr[data-id]').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('select')) return; requestDetail(type, rows.find((x) => x.id == tr.dataset.id), load); }));
    $$('#workList [data-st]').forEach((s) => (s.onchange = async () => { try { await api('POST', `/api/requests/${s.dataset.st}/status`, { status: s.value }); toast(`${STATUS[s.value]}(으)로 변경`); load(); } catch (e) { fail(e); load(); } }));
  };
  $$('#stSeg button').forEach((b) => (b.onclick = () => { status = b.dataset.s; $$('#stSeg button').forEach((x) => x.classList.toggle('on', x === b)); filterForm.requestSubmit(); }));
  $$('#catSeg button').forEach((b) => (b.onclick = () => { category = b.dataset.c; $$('#catSeg button').forEach((x) => x.classList.toggle('on', x === b)); filterForm.requestSubmit(); }));
  bindListControls(filterForm, load, () => {
    status = ''; category = '';
    $$('#stSeg button', main).forEach(button => button.classList.toggle('on', !button.dataset.s));
    $$('#catSeg button', main).forEach(button => button.classList.toggle('on', !button.dataset.c));
  });
  await load();
}

// ───────────── 생산일정 (완제품/반제품) ─────────────
function materialTable(materials, caption = '자재 소요량') {
  return `<div class="table-wrap"><table class="grid"><caption>${esc(caption)}</caption><thead><tr><th>자재명</th><th>분류</th><th class="r">수량</th><th>단위</th></tr></thead><tbody>${materials.map(m => `<tr><td>${esc(m.item)}</td><td>${esc(m.item_category)}</td><td class="r">${fmtNum(m.qty)}</td><td>${esc(m.unit)}</td></tr>`).join('')}</tbody></table></div>`;
}
function bomMaterialRow(material = {}) {
  return `<tr data-material-row><td><input data-material-item required maxlength="200" value="${esc(material.item)}" aria-label="자재명"></td><td><select data-material-category required aria-label="자재 분류">${categoryOptions(material.item_category || '원자재')}</select></td><td><input data-material-qty type="number" required min="0.00000001" step="any" value="${esc(material.qty)}" aria-label="기준수량당 사용량"></td><td><input data-material-unit required maxlength="20" value="${esc(material.unit || 'EA')}" aria-label="자재 단위"></td><td><button type="button" class="btn small danger" data-material-remove>삭제</button></td></tr>`;
}
function bomForm(bom = {}) {
  return `<form class="stack" ${bom.id ? `data-entry-author="${esc(bom.created_by)}"` : ''}><div class="form-grid"><label>품목명 *<input name="product" required maxlength="200" value="${esc(bom.product)}"></label>${categoryField(bom.item_category)}<label>품목코드<input name="product_code" maxlength="80" value="${esc(bom.product_code)}"></label><label>생산 구분<select name="kind"><option value="finished" ${bom.kind !== 'semi' ? 'selected' : ''}>완제품</option><option value="semi" ${bom.kind === 'semi' ? 'selected' : ''}>반제품</option></select></label><label>기준 생산수량 *<input name="base_qty" type="number" min="0.00000001" step="any" required value="${esc(bom.base_qty || 1)}"></label><label>생산 단위 *<input name="unit" maxlength="20" required value="${esc(bom.unit || 'EA')}"></label><label>비고<input name="note" maxlength="500" value="${esc(bom.note)}"></label></div><p class="muted small">제품 BOM은 구성자재를 등록하세요. 원자재·부자재·상품은 구성자재 없이 입고 품목으로 등록할 수 있습니다.</p><div class="table-wrap"><table class="grid bom-materials"><thead><tr><th>자재명</th><th>분류</th><th>사용량</th><th>단위</th><th></th></tr></thead><tbody data-material-rows>${(bom.materials || []).map(bomMaterialRow).join('')}</tbody></table></div><button type="button" class="btn" data-material-add>+ 자재 추가</button><label class="inline"><input type="checkbox" name="active" ${bom.active !== 0 ? 'checked' : ''}> 사용 중 (생산·입고에서 선택 가능)</label><div class="actions"><button type="submit" class="btn primary">BOM 저장</button></div></form>`;
}
async function pageBoms(main) {
  if (!ME.is_admin) { main.innerHTML = '<div class="empty">관리자만 BOM을 관리할 수 있습니다.</div>'; return; }
  main.innerHTML = '<h1>BOM 관리</h1><p class="muted">품목을 원자재·부자재·제품·상품으로 분류하여 등록합니다. 생산과 기타입고에서 BOM을 검색·선택합니다.</p><button class="btn primary" id="newBom">새 BOM 등록</button>' + listControls('bom', { placeholder: '품목명·코드·입력자·메모', extra: `<label>분류<select name="item_category" id="bomCategory">${categoryOptions('', true)}</select></label><label>사용 상태<select name="active"><option value="">전체 사용 상태</option><option value="1">사용 중</option><option value="0">사용 중지</option></select></label>` }) + '<div id="bomList"></div>';
  const filterForm = $('#bomFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const boms = await api('GET', '/api/boms?' + new URLSearchParams({ ...formObj(filterForm), include_archived: '1' }));
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, boms.length);
    $('#bomList').innerHTML = boms.length ? boms.map(bom => `<div class="card"><h3>${esc(bom.product)} ${bom.product_code ? `<span class="tag">${esc(bom.product_code)}</span>` : ''}</h3><p><span class="chip">${esc(bom.item_category || '미분류')}</span> ${bom.kind === 'finished' ? '완제품' : '반제품'} · 기준 ${fmtNum(bom.base_qty)} ${esc(bom.unit)} · ${bom.active ? '사용 중' : '사용 중지'}</p>${materialTable(bom.materials, '기준수량당 자재')}<p class="muted">${esc(bom.note)}</p><p class="small muted">입력자: ${esc(bom.created_by || '기존 기록: 미기록')} · ${esc(bom.created_at)}</p><div class="actions">${commentButton("bom", bom.id, bom.product)}<button class="btn" data-bom-edit="${bom.id}">수정</button>${bom.active ? `<button class="btn danger" data-bom-disable="${bom.id}">사용 중지</button>` : ''}</div></div>`).join('') : '<div class="empty">등록된 BOM이 없습니다.</div>';
    const edit = bom => {
      const box = modal(`<h3>${bom ? 'BOM 수정' : '새 BOM 등록'}</h3>${bomForm(bom)}`, { wide: true });
      const form = $('form', box.el); const rows = $('[data-material-rows]', form);
      $('[data-material-add]', form).onclick = () => rows.insertAdjacentHTML('beforeend', bomMaterialRow());
      rows.onclick = event => { const button = event.target.closest('[data-material-remove]'); if (button) button.closest('tr').remove(); };
      form.onsubmit = async event => {
        event.preventDefault(); const button = $('button.primary', form); button.disabled = true;
        const values = formObj(form);
        const materials = $$('[data-material-row]', form).map(row => ({ item: $('[data-material-item]', row).value, item_category: $('[data-material-category]', row).value, qty: $('[data-material-qty]', row).value, unit: $('[data-material-unit]', row).value }));
        try { await api(bom ? 'PUT' : 'POST', '/api/boms' + (bom ? '/' + bom.id : ''), { ...values, active: form.elements.active.checked, materials }); box.close(); toast('BOM을 저장했습니다.'); await load(); }
        catch (error) { fail(error); } finally { button.disabled = false; }
      };
    };
    $('#newBom').onclick = () => edit();
    $$('[data-bom-edit]', main).forEach(button => button.onclick = () => edit(boms.find(bom => bom.id === Number(button.dataset.bomEdit))));
    $$('[data-bom-disable]', main).forEach(button => button.onclick = async () => {
      if (!await confirmBox('이 BOM을 생산 선택 목록에서 사용 중지할까요? 기존 생산일정은 유지됩니다.')) return;
      try { await api('DELETE', '/api/boms/' + button.dataset.bomDisable); await load(); } catch (error) { fail(error); }
    });
  };
  bindListControls(filterForm, load);
  await load();
}

const PERIOD = { day: '일간', week: '주간', month: '월간' };
async function pageSchedule(kind) {
  const main = $('#main'); const label = kind === 'finished' ? '완제품' : '반제품';
  const boms = await api('GET', '/api/boms?kind=' + kind);
  let view = 'week'; let base = scheduleFocusDate();
  main.innerHTML = `
  <h1>${label} 생산일정 <span class="dept">생산</span></h1>
  <div id="actualChanges"></div>
  <form class="card" id="scNew"><h3>일정 입력</h3><div class="form-grid">
    <fieldset class="span3"><legend>구분 *</legend><div class="opts">${Object.entries(PERIOD).map(([k, v]) => `<label class="opt"><input type="radio" name="period" value="${k}" ${k === 'day' ? 'checked' : ''}> ${v}</label>`).join('')}</div></fieldset>
    <label>날짜 * <span class="hint" id="scHint">(그날)</span><input name="start_date" type="date" required value="${todayStr()}"></label>
    <label class="span2">BOM에서 가져오기<select name="bom_id" id="scBom"><option value="">직접 입력</option>${boms.map(bom => `<option value="${bom.id}">[${esc(bom.item_category || '미분류')}] ${esc(bom.product)}${bom.product_code ? ' · ' + esc(bom.product_code) : ''} (기준 ${fmtNum(bom.base_qty)} ${esc(bom.unit)})</option>`).join('')}</select></label>
    <label>품목명 *<input name="product" required></label>
    <label>수량 *<input name="qty" type="number" min="0" step="any" required></label>
    <label class="span3">비고<input name="note"></label><div class="span3" id="scRequirements"></div></div>
    <div class="actions"><button class="btn primary">등록</button></div></form>
  ${listControls('sc', { placeholder: '제품명·BOM 코드·메모·입력자', extra: '<label>완료 상태<select name="done"><option value="">전체 완료 상태</option><option value="0">미완료</option><option value="1">완료</option></select></label><label>일정 기준<select name="period"><option value="">전체 일정</option><option value="day">일간 일정</option><option value="week">주간 일정</option><option value="month">월간 일정</option></select></label>' })}
  <div class="toolbar">
    <div class="seg" id="vSeg">${Object.entries(PERIOD).map(([k, v]) => `<button data-v="${k}" class="${k === view ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="nav-date"><button class="btn small" id="prev">◀</button><b id="rangeLabel"></b><button class="btn small" id="next">▶</button><button class="btn small" id="today">오늘</button></div>
  </div>
  <div id="scBody"></div>`;
  const filterForm = $('#scFilters', main); let queryVersion = 0;
  const hints = { day: '(그날)', week: '(그 주의 아무 날 → 월요일 시작 주로 저장)', month: '(그 달의 아무 날 → 그 달로 저장)' };
  const previewBom = () => {
    const form = $('#scNew'); const bom = boms.find(bom => bom.id === Number($('#scBom').value));
    form.elements.product.readOnly = !!bom;
    if (bom) form.elements.product.value = bom.product;
    const qty = Number(form.elements.qty.value || 0);
    $('#scRequirements').innerHTML = bom ? materialTable(bom.materials.map(m => ({ ...m, qty: Number((m.qty * qty / bom.base_qty).toPrecision(12)) })), `생산 ${fmtNum(qty)} ${bom.unit} 기준 소요량`) : '';
  };
  $('#scBom').onchange = previewBom; $('#scNew [name=qty]').oninput = previewBom;
  $$('#scNew [name=period]').forEach((r) => (r.onchange = () => { $('#scHint').textContent = hints[r.value]; }));
  const range = () => view === 'day' ? [base, base] : view === 'week' ? [mondayOf(base), addDays(mondayOf(base), 6)] : [monthStart(base), monthEnd(base)];
  const item = (s) => `<div class="sc-item ${s.done ? 'done' : ''}" data-id="${s.id}"><input type="checkbox" ${s.done ? 'checked' : ''} data-done="${s.id}" title="완료 체크" aria-label="완료"> <span class="p">${esc(s.product)}${lineInfo(s)}</span> <b>${fmtNum(s.qty)}</b>${s.note ? ` <span class="small muted">${esc(s.note)}</span>` : ''}<span class="small muted">입력자: ${esc(s.created_by || '기존 기록: 미기록')}</span>${s.bom_id ? `<button class="btn small" data-bom-view="${s.id}">BOM·소요량</button>` : ''}<span class="small">계획 ${fmtNum(s.qty)} / 실제 ${s.actual_count ? fmtNum(s.actual_qty || 0) : '미입력'} / 달성률 ${s.qty ? Math.round((s.actual_qty || 0) / s.qty * 1000) / 10 : '—'}%</span><button class="btn small" data-actual-open="${s.id}">생산실적 입력·조회</button>${commentButton("schedule", s.id, s.product)}<button class="x" data-del="${s.id}" title="삭제" aria-label="삭제">×</button></div>`;
  const totals = (list) => { const m = {}; list.forEach((s) => (m[s.product] = (m[s.product] || 0) + s.qty)); return Object.entries(m).map(([p, q]) => `<span class="chip">${esc(p)} <b>${fmtNum(q)}</b></span>`).join(' ') || '<span class="muted small">없음</span>'; };
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const [from, to] = range();
    $('#rangeLabel').textContent = view === 'day' ? `${from} (${dow(from)})` : view === 'week' ? `${from} ~ ${to.slice(5)}` : `${from.slice(0, 7)}`;
    const rows = await api('GET', '/api/schedules?' + new URLSearchParams({ ...formObj(filterForm), kind, from, to }));
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, rows.length);
    const days = rows.filter((s) => s.period === 'day'); const weeks = rows.filter((s) => s.period === 'week'); const months = rows.filter((s) => s.period === 'month');
    const plans = (title, list, fmt) => list.length ? `<div class="card"><h4>${title}</h4>${list.map((s) => `<div class="plan-row"><span class="small muted">${fmt(s)}</span>${item(s)}</div>`).join('')}</div>` : '';
    let body = '';
    body += plans('월간 계획', months, (s) => s.start_date.slice(0, 7));
    body += plans('주간 계획', weeks, (s) => `${s.start_date.slice(5)}~${addDays(s.start_date, 6).slice(5)}`);
    if (view === 'day') {
      body += `<div class="card"><h4>일간 계획</h4>${days.map(item).join('') || '<div class="muted small">일정이 없습니다.</div>'}</div>`;
    } else if (view === 'week') {
      body += `<div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(from, i); return `<div class="day ${d === todayStr() ? 'today' : ''}"><div class="dh">${d.slice(5)} (${dow(d)})</div>${days.filter((s) => s.start_date === d).map(item).join('')}</div>`; }).join('')}</div>`;
    } else {
      const start = mondayOf(from); const cells = [];
      for (let d = start; d <= to || parseD(d).getDay() !== 1; d = addDays(d, 1)) cells.push(d);
      body += `<div class="month"><div class="mh">${['월', '화', '수', '목', '금', '토', '일'].map((w) => `<div>${w}</div>`).join('')}</div><div class="mg">${cells.map((d) => `<div class="day ${d.slice(0, 7) !== from.slice(0, 7) ? 'out' : ''} ${d === todayStr() ? 'today' : ''}"><div class="dh">${Number(d.slice(8))}</div>${days.filter((s) => s.start_date === d).map(item).join('')}</div>`).join('')}</div></div>`;
    }
    body += `<div class="card"><h4>조회 조건 기준 일간 합계 (제품별)</h4>${totals(days)}</div>`;
    $('#scBody').innerHTML = body;
    $$('[data-bom-view]', main).forEach(button => button.onclick = () => {
      const row = rows.find(row => row.id === Number(button.dataset.bomView)); const snapshot = row.bom_snapshot;
      modal(`<h3>${esc(row.product)} · 생산 ${fmtNum(row.qty)} ${esc(snapshot.unit)}</h3><p class="muted small">입력자: ${esc(row.created_by || '기존 기록: 미기록')} · 일정 등록 당시 BOM 기준입니다. 기준 생산수량: ${fmtNum(snapshot.base_qty)} ${esc(snapshot.unit)}</p>${materialTable(snapshot.requirements || [])}`, { wide: true });
    });
    $$('#scBody [data-done]').forEach((c) => (c.onchange = async () => { try { await api('PUT', '/api/schedules/' + c.dataset.done, { toggle_done: true }); load(); } catch (e) { fail(e); } }));
    $$('#scBody [data-del]').forEach((b) => (b.onclick = async () => { if (await confirmBox('이 일정을 삭제할까요?')) { try { await api('DELETE', '/api/schedules/' + b.dataset.del); load(); } catch (e) { fail(e); } } }));
  };
  bindListControls(filterForm, load);
  renderActualChanges($('#actualChanges', main), kind).catch(fail);
  $$('#vSeg button').forEach((b) => (b.onclick = () => { view = b.dataset.v; $$('#vSeg button').forEach((x) => x.classList.toggle('on', x === b)); filterForm.requestSubmit(); }));
  const step = (n) => { base = view === 'day' ? addDays(base, n) : view === 'week' ? addDays(base, 7 * n) : addMonths(base, n); load(); };
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1); $('#today').onclick = () => { base = todayStr(); load(); };
  $('#scNew').onsubmit = async (e) => {
    e.preventDefault(); const v = formObj(e.target);
    try { await api('POST', '/api/schedules', { ...v, kind }); toast(`${PERIOD[v.period]} 일정을 등록했습니다.`); e.target.qty.value = ''; e.target.note.value = ''; if (!v.bom_id) e.target.product.value = ''; previewBom(); base = v.start_date; load(); } catch (err) { fail(err); }
  };
  await load();
}

// ───────────── 물류: 출하목록 ─────────────
async function pageShip(main) {
  main.innerHTML = `
  <h1>출하목록 <span class="dept">물류</span></h1>
  <form class="card" id="shNew"><h3>출하 입력</h3><div class="form-grid">
    <label>출고일 *<input name="ship_date" type="date" required value="${todayStr()}"></label>
    <label>품목명 *<input name="item" required></label>
    <label>수량 *<input name="qty" type="number" min="0" step="any" required></label>
    <label>거래처 *<input name="customer" required></label>
    <label>LOT<input name="lot" maxlength="100" placeholder="LOT 번호 (선택)"></label>
    <label class="span2">비고<input name="note"></label>${photoPicker()}${inspectionFields()}</div>
    <div class="actions"><button class="btn primary">등록</button></div></form>
  ${listControls('sh', { dateLabel: '출고', from: todayStr(), to: todayStr(), requiredDates: true, placeholder: '품목·거래처·LOT·메모·입력자', extra: listInspectionSelect() + '<button type="button" class="btn" id="shToday">오늘</button>' })}<p id="shSum" class="muted small"></p>
  <div id="shList"></div>`;
  const filterForm = $('#shFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const rows = await api('GET', '/api/shipments?' + new URLSearchParams(formObj(filterForm)));
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, rows.length);
    $('#shSum').innerHTML = `${rows.length}건 · 수량 합계 <b>${fmtNum(rows.reduce((a, r) => a + r.qty, 0))}</b>`;
    $('#shList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid">
      <thead><tr><th>출고일</th><th>품목명</th><th>LOT</th><th class="r">수량</th><th>거래처</th><th>비고</th><th>입력자</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="nowrap">${esc(r.ship_date)} (${dow(r.ship_date)})</td><td>${esc(r.item)}${lineInfo(r)}</td><td>${esc(r.lot)}</td><td class="r">${fmtNum(r.qty)}</td><td>${esc(r.customer)}</td><td>${esc(r.note)}</td><td class="small muted">${esc(r.created_by)}</td>
        <td class="nowrap">${commentButton("shipment", r.id, r.item)} <button class="btn small" data-ship-photo="${r.id}">사진·이상 여부</button>${inspectionBadge(r)} <button class="btn small" data-edit="${r.id}">수정</button> <button class="btn small danger" data-del="${r.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">해당 기간 출하가 없습니다.</div>';
    $$('#shList [data-ship-photo]').forEach(button => button.onclick = () => { const row = rows.find(row => row.id === Number(button.dataset.shipPhoto)); openAttachments('shipment', row.id, row.item, { editable: ME.is_admin || hasRole('logistics') || row.created_by === ME.name }); });
    $$('#shList [data-del]').forEach((b) => (b.onclick = async () => { if (await confirmBox('이 출하 기록을 삭제할까요?')) { try { await api('DELETE', '/api/shipments/' + b.dataset.del); load(); } catch (e) { fail(e); } } }));
    $$('#shList [data-edit]').forEach((b) => (b.onclick = () => {
      const r = rows.find((x) => x.id == b.dataset.edit);
      const m = modal(`<h3>출하 수정</h3><form data-entry-author="${esc(r.created_by)}"><div class="form-grid">
        <label>출고일<input name="ship_date" type="date" required value="${esc(r.ship_date)}"></label><label>품목명<input name="item" required value="${esc(r.item)}"></label>
        <label>수량<input name="qty" type="number" min="0" step="any" required value="${esc(r.qty)}"></label><label>거래처<input name="customer" required value="${esc(r.customer)}"></label>
        <label>LOT<input name="lot" maxlength="100" value="${esc(r.lot)}"></label>
        <label class="span2">비고<input name="note" value="${esc(r.note)}"></label></div><div class="actions"><button class="btn primary">저장</button></div></form>`, { wide: true });
      $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api('PUT', '/api/shipments/' + r.id, formObj(e.target)); m.close(); load(); } catch (err) { fail(err); } };
    }));
  };
  const shipDraft = bindPhotoDraft($('#shNew'));
  $('#shNew').onsubmit = async (e) => {
    e.preventDefault(); if (shipDraft.busy) return; const v = formObj(e.target); const button = $('button.primary', e.target); button.disabled = true;
    try { const saved = await api('POST', '/api/shipments', v); const photoSaved = await saveNewAttachments('shipment', saved, shipDraft, e.target); shipDraft.reset(); e.target.inspection_status.value = 'unchecked'; e.target.inspection_note.value = ''; ['item', 'qty', 'customer', 'note', 'lot'].forEach((k) => (e.target[k].value = '')); if (photoSaved) toast('출하를 등록했습니다.'); if (v.ship_date < $('#shFrom').value || v.ship_date > $('#shTo').value) { $('#shFrom').value = $('#shTo').value = v.ship_date; } load(); } catch (err) { fail(err); } finally { button.disabled = false; }
  };
  bindListControls(filterForm, load);
  $('#shToday').onclick = () => { $('#shFrom').value = $('#shTo').value = todayStr(); load().catch(fail); };
  await load();
}

// ───────────── 관리자 ─────────────
async function pageAdmin(main) {
  if (!ME.is_admin) { main.innerHTML = '<div class="empty">관리자만 볼 수 있습니다.</div>'; return; }
  const [s, users] = await Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/users')]);
  main.innerHTML = `
  <h1>관리자 설정</h1>
  <div class="card"><h3>데이터 백업</h3><p class="muted small">업무 기록·계정·사진을 파일로 저장합니다. 백업 중에는 다른 사용자의 입력을 잠시 멈춰 주세요. 파일에는 개인정보와 비밀번호 검증값이 포함되므로 안전하게 보관하세요.</p><button class="btn" id="backupBtn">전체 백업 다운로드</button><p id="backupStatus" role="status" class="muted small"></p></div>
  <form class="card" id="invForm"><h3>초대코드</h3><p class="muted small">가입할 때 이 코드를 입력해야 합니다. 바꾸면 이후 가입부터 새 코드가 필요합니다.</p>
    <div class="row"><input name="invite_code" value="${esc(s.invite_code)}" required minlength="4"><button class="btn primary">변경</button></div></form>
  <div class="card"><h3>가입 승인 · 사용자 권한</h3><p class="muted">승인 대기 ${users.filter(u => u.approval_status === 'pending').length}명 · 신규 가입자는 승인 후 로그인할 수 있습니다.</p>
    <p class="muted small">품질·개발은 업무 담당 권한입니다. 분석의뢰·VOC 승인·반려는 품질책임자, 개발의뢰 승인·반려는 개발책임자를 체크해 지정하세요. 책임자는 해당 팀의 업무 처리 권한도 갖습니다. 가입 승인된 사용자만 책임자로 지정할 수 있습니다. 관리자는 모든 의뢰를 승인할 수 있으며 생산의 샘플 승인 권한은 유지됩니다.</p>
    ${listControls('users', { placeholder: '사용자 이름 검색', extra: `<label>가입 상태<select name="approval"><option value="">전체 상태</option><option value="pending">승인 대기</option><option value="approved">승인 완료</option><option value="rejected">반려</option></select></label><label>권한<select name="role"><option value="">전체 권한</option><option value="admin">관리자</option>${Object.entries(ROLE_LABEL).map(([role, label]) => `<option value="${role}">${label}</option>`).join('')}</select></label>` })}
    <div class="table-wrap"><table class="grid"><thead><tr><th>이름</th><th>가입 상태</th>${Object.values(ROLE_LABEL).map((l) => `<th>${l}</th>`).join('')}<th>관리자</th><th>가입일</th><th></th></tr></thead>
    <tbody>${users.map((u) => `<tr data-u="${u.id}"><td><b>${esc(u.name)}</b></td><td>${esc(({pending:"승인 대기",approved:"승인 완료",rejected:"반려"})[u.approval_status])}${u.approval_note ? `<br><small>${esc(u.approval_note)}</small>` : ""}${u.reviewed_by ? `<br><small>${esc(u.reviewed_by)} · ${esc(u.reviewed_at)}</small>` : ""}</td>
      ${Object.keys(ROLE_LABEL).map((r) => `<td class="c"><input type="checkbox" data-role="${r}" ${u.roles.includes(r) ? 'checked' : ''} ${["quality_approver","dev_approver","production_approver","logistics_approver"].includes(r) && u.approval_status !== "approved" ? 'disabled' : ''} aria-label="${ROLE_LABEL[r]}"></td>`).join('')}
      <td class="c"><input type="checkbox" data-admin ${u.is_admin ? 'checked' : ''} ${u.id === ME.id || u.approval_status !== 'approved' ? 'disabled' : ''} aria-label="관리자"></td>
      <td class="small muted">${esc(u.created_at.slice(0, 10))}</td>
      <td class="nowrap">${u.approval_status !== "approved" ? '<button class="btn small primary" data-approve>가입 승인</button> ' : ""}${!u.is_admin && u.approval_status !== "rejected" ? '<button class="btn small danger" data-reject>반려</button> ' : ""}<button class="btn small" data-pw>비밀번호 초기화</button> ${u.id !== ME.id ? '<button class="btn small danger" data-del>삭제</button>' : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#invForm').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('PUT', '/api/admin/invite', formObj(e.target)); toast(`초대코드: ${r.invite_code}`); } catch (err) { fail(err); } };
  const userFilter = $('#usersFilters', main);
  const filterUsers = () => {
    const values = formObj(userFilter); const q = values.q.trim().toLocaleLowerCase(); let count = 0;
    $$('tr[data-u]', main).forEach(tr => {
      const user = users.find(user => user.id === Number(tr.dataset.u));
      const visible = user.name.toLocaleLowerCase().includes(q) && (!values.approval || user.approval_status === values.approval) && (!values.role || (values.role === 'admin' ? user.is_admin : userHasRole(user, values.role)));
      tr.hidden = !visible; if (visible) count++;
    });
    listCount(userFilter, count);
  };
  bindListControls(userFilter, filterUsers); filterUsers();
  $('#backupBtn').onclick = async (e) => {
    const button = e.currentTarget; const status = $('#backupStatus'); button.disabled = true;
    try {
      const info = await api('GET', '/api/admin/backup');
      const backup = { format: info.format, created_at: new Date().toISOString(), tables: {}, photos: {} };
      for (const table of info.tables) {
        status.textContent = '업무 기록을 저장하고 있습니다…';
        backup.tables[table] = []; let after = '';
        do {
          const page = await api('GET', `/api/admin/backup?table=${encodeURIComponent(table)}&after=${encodeURIComponent(after)}`);
          backup.tables[table].push(...page.rows); after = page.next;
        } while (after !== null);
      }
      const photos = [...new Set(backup.tables.laundry.concat(backup.tables.attachments || []).flatMap(row => JSON.parse(row.photos)))];
      for (const [i, file] of photos.entries()) {
        status.textContent = `사진을 저장하고 있습니다… (${i + 1}/${photos.length})`;
        const response = await fetch('/uploads/' + encodeURIComponent(file));
        if (!response.ok) throw new Error('사진을 백업하지 못했습니다. 다시 시도하세요.');
        const data = await response.blob();
        backup.photos[file] = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(data); });
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `work-process-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = '백업 파일을 다운로드했습니다. 다운로드 폴더에서 확인하세요.';
    } catch (error) { status.textContent = '백업에 실패했습니다. 다시 시도해 주세요.'; fail(error); }
    finally { button.disabled = false; }
  };
  $$('tr[data-u]').forEach((tr) => {
    const id = tr.dataset.u; const name = $('b', tr).textContent;
    const save = async (body) => { try { const changed = await api('PUT', '/api/admin/users/' + id, body); Object.assign(users.find(user => user.id === Number(id)), changed); filterUsers(); toast('저장했습니다.'); if (Number(id) === ME.id) { ME = (await api('GET', '/api/me')).user; } } catch (e) { fail(e); render(); } };
    $$('[data-role]', tr).forEach((c) => (c.onchange = () => save({ roles: $$('[data-role]:checked', tr).map((x) => x.dataset.role) })));
    $('[data-admin]', tr).onchange = (e) => save({ is_admin: e.target.checked });
    const review = async (status, note = '') => { try { await api('POST', '/api/admin/users/' + id + '/approval', { status, note }); toast(status === 'approved' ? '가입을 승인했습니다.' : '가입을 반려했습니다.'); render(); } catch (e) { fail(e); } };
    const approve = $('[data-approve]', tr); if (approve) approve.onclick = async () => { if (await confirmBox(`${name} 님의 가입을 승인할까요?`)) review('approved'); };
    const reject = $('[data-reject]', tr); if (reject) reject.onclick = async () => { const value = await promptBox(`${name} 님의 가입 반려`, '<label>반려 사유<input name="note" maxlength="500"></label>'); if (value) review('rejected', value.note); };
    $('[data-pw]', tr).onclick = async () => { const v = await promptBox(`${name} 비밀번호 초기화`, '<label>새 비밀번호 *<input name="password" required minlength="4"></label>'); if (v) save(v); };
    const del = $('[data-del]', tr); if (del) del.onclick = async () => { if (await confirmBox(`${name} 사용자를 삭제할까요?`)) { try { await api('DELETE', '/api/admin/users/' + id); render(); } catch (e) { fail(e); } } };
  });
}

async function pageMe(main) {
  main.innerHTML = `<h1>내 정보</h1>
  <div class="card"><p><b>${esc(ME.name)}</b> ${ME.is_admin ? '<span class="tag">관리자</span>' : ''}</p><p class="muted small">담당: ${ME.roles.map((r) => ROLE_LABEL[r]).join(', ') || '없음 (승인 권한이 필요하면 관리자에게 요청)'}</p></div>
  <form class="card stack" id="pwForm"><h3>비밀번호 변경</h3>
    <label>현재 비밀번호<input type="password" name="current" required autocomplete="current-password"></label>
    <label>새 비밀번호<input type="password" name="password" required minlength="4" autocomplete="new-password"></label>
    <div class="actions"><button class="btn primary">변경</button></div></form>`;
  $('#pwForm').onsubmit = async (e) => { e.preventDefault(); try { await api('PUT', '/api/me/password', formObj(e.target)); e.target.reset(); toast('비밀번호를 변경했습니다.'); } catch (err) { fail(err); } };
}

// ───────────── 시작 ─────────────
(async () => {
  try { ME = (await api('GET', '/api/me')).user; } catch { ME = null; }
  render();
})();
