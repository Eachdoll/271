// 앱 변경 커밋마다 AGENTS.md의 버전 규칙에 따라 올립니다.
const APP_VERSION = '15.230';
// 서울세미텍 시스템 프런트엔드 (빌드 도구 없음, 해시 라우팅)
'use strict';

// ───────────── 공통 도구 ─────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 「오늘」은 기기 시간대가 아니라 한국 시간 기준입니다(서버의 날짜 검사와 같게). 베트남·캄보디아 시간으로 맞춘 휴대폰에서도 같은 날짜가 나옵니다.
const todayStr = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return fmtDate(d); };
const mondayOf = (s) => { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtDate(d); };
const monthStart = (s) => s.slice(0, 8) + '01';
const monthEnd = (s) => { const d = parseD(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return fmtDate(d); };
const addMonths = (s, n) => { const d = parseD(monthStart(s)); d.setMonth(d.getMonth() + n); return fmtDate(d); };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (s) => WEEK[parseD(s).getDay()];
const fmtNum = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR'));
// 15.100 합계: 수량은 단위마다 따로 더한다(kg와 EA를 섞어 더하지 않게). 예: "1,200 EA · 30 BOX"
function unitTotals(rows, qty, unit) {
  const m = new Map(); for (const r of rows) { const u = String(unit(r) || '').trim(), q = Number(qty(r)); if (!Number.isFinite(q)) continue; m.set(u, (m.get(u) || 0) + q); }
  return [...m].map(([u, n]) => `${fmtNum(Math.round(n * 1000) / 1000)}${u ? ' ' + u : ''}`).join(' · ') || '0';
}
// 15.111 거래처별 단가표 조회: {bom_id: {unit_price, valid_from}}. 같은 구분·거래처·날짜는 한 번만 묻는다.
const PRICE_CACHE = new Map();
async function tablePrices(side, vendor, date = todayStr()) {
  const name = String(vendor || '').trim(); if (!name) return {};
  const key = [side, name.replace(/\s+/g, '').toLowerCase(), date].join('|');
  if (!PRICE_CACHE.has(key)) PRICE_CACHE.set(key, api('GET', '/api/item-prices/lookup?' + new URLSearchParams({ side, vendor: name, date })).then(r => r.prices || {}).catch(() => ({})));
  return PRICE_CACHE.get(key);
}
// 15.103 입력 표 안에서 Enter는 저장이 아니라 다음 칸으로(수량 → 단가 → 비고 → 다음 줄). 한글 조합 중·select·textarea는 그대로.
function enterMovesInTable(root) {
  root.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target; if (!el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file])')) return;
    const tr = el.closest('tr'); if (!tr) return;
    e.preventDefault();
    const cells = row => [...row.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]):not([readonly])')].filter(i => i.offsetParent !== null);
    const mine = cells(tr), at = mine.indexOf(el);
    let next = at >= 0 && at < mine.length - 1 ? mine[at + 1] : null;
    if (!next) { let r = tr.nextElementSibling; while (r && !cells(r).length) r = r.nextElementSibling; next = r ? cells(r)[0] : null; }
    if (next) { next.focus(); next.select?.(); }
  });
}
// 표 바로 아래 ERP식 합계 줄. parts: [[이름, 값(HTML)], …] (값이 빈 것은 뺀다)
// 15.117 품목 분류 칩(전표 줄). 빈 값 = 미분류(코드 없는 직접 입력 줄)
const CAT_TONE = { 제품: 'blue', 상품: 'green', 원자재: 'gray', 부자재: 'gray', 반제품: 'gray', 임가공: 'orange' };
const catChip = c => `<span class="cat-chip cat-${CAT_TONE[c] || 'none'}">${esc(c || '미분류')}</span>`;
const resultCount = (n, more, extra = '') => `<span class="rc-n">결과 <b>${fmtNum(n)}</b>건${more ? ' (더 있음)' : ''}</span>${extra ? ` <span class="rc-x">· ${esc(extra)}</span>` : ''}`; // 15.180
const catChips = list => list == null ? '' : String(list).split(',').map(c => catChip(c)).join(' ');
const catSummary = (by, label = '분류별 공급가액') => by?.length ? `<div class="small cat-sum">${esc(label)}: ${by.map(c => `${catChip(c.category)} ${won(c.supply)}원`).join(' · ')}</div>` : '';
const catOptions = order => '<option value="">전체</option>' + order.map(c => `<option>${c}</option>`).join('');
// 15.126 고객 PO: 「고객 발주번호」 칸, 비어 있으면 비고에서 10자리 숫자(삼성 PO 예: 2008315425)
const poOf = (po, note) => String(po || '').trim() || (String(note || '').match(/(?:^|\D)(\d{10})(?!\d)/) || [])[1] || '';
// 삼성 등 고객 비고 「0C0827-27 (P1DD) OLED Asan mj1938,seon 2008315425」 → 요청번호·라인·사업장·담당자·PO(형식이 다르면 null)
function parseCustomerNote(text) {
  const m = String(text || '').trim().match(/^([0-9A-Z]{2}\d{4}-\d{2,3})\s*\(([A-Z0-9]{2,6})\)\s*(.*?)\s*(\d{10})$/i); if (!m) return null;
  const mid = m[3].trim().split(/\s+/).filter(Boolean), last = mid.at(-1) || '';
  const person = /,|^[가-힣]{2,4}$/.test(last) ? mid.pop() : '';
  return { req: m[1], line: m[2], site: mid.join(' '), person, po: m[4] };
}
const searchKey = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
const sumLine = parts => `<div class="list-sum" role="status">${parts.filter(p => p && p[1] !== '' && p[1] != null).map(([k, v]) => `<span><span>${esc(k)}</span> <b>${v}</b></span>`).join('')}</div>`;

// 표 머리글용 짧은 이름(15.63): 긴 이름은 머리글 title·체크박스 aria-label로 그대로 보여 준다.
const ROLE_SHORT = { operator: '오퍼레이터', purchase: '구매', quality: '품질', quality_approver: '품질책임자', dev: '개발', dev_approver: '개발책임자', production: '생산', production_approver: '생산팀장', logistics: '물류', logistics_approver: '물류팀장', sales: '영업' };
const ROLE_LABEL = { operator: '오퍼레이터(입력 전용)', purchase: '구매', quality: '품질', quality_approver: '품질책임자(승인권자)', dev: '개발(연구소)', dev_approver: '개발책임자(승인권자)', production: '생산', production_approver: '생산팀장(실적 수정 승인)', logistics: '물류', logistics_approver: '물류팀장(입고 수량 수정 승인)', sales: '영업(수주·매출전표·입금)' };
const STATUS = { pending: '접수대기', rejected: '반려', waiting: '대기', progress: '진행', done: '완료' };
const RECV = { '': '미입고', ok: '입고완료', mismatch: '수량상이', checking: '확인중' };

let ME = null;

// Every current and dynamically opened form shows the signed-in operator.
// This is display-only; the server records authors from its authenticated session.
function showInputAuthors() {
  if (!ME) return;
  for (const form of document.querySelectorAll('form')) {
    // data-no-author: 작성자 표시가 필요 없는 관리 양식(조직 구성)이나 요청자를 따로 보여 주는 양식(구매의뢰).
    // 조회용 양식: data-read-only(값 없이 써도)·목록 조건(.list-filters)에는 입력자를 붙이지 않는다(15.89).
    if ((form.dataset.readOnly !== undefined && form.dataset.readOnly !== 'false') || form.classList.contains('list-filters') || form.hasAttribute('data-no-author')) { form.querySelector(':scope > [data-input-author]')?.remove(); continue; }
    let label = form.querySelector(':scope > [data-input-author]');
    if (!label) { label = document.createElement('p'); label.dataset.inputAuthor = ''; label.className = 'small muted input-author'; form.prepend(label); }
    const original = form.dataset.entryAuthor;
    const text = original !== undefined ? '입력자: ' + (original || '기존 기록: 미기록') + ' · 현재 작업자: ' + ME.name : '입력자(자동 기록): ' + ME.name;
    // Compare with what we last wrote, not the visible text (the language layer may have translated it).
    if (label.dataset.inputAuthor !== text) { label.dataset.inputAuthor = text; label.textContent = text; }
  }
}
new MutationObserver(showInputAuthors).observe(document.body, { childList: true, subtree: true });

// 15.209 폼이 열려 있는 동안 같은 등록 요청 번호(응답을 못 받아 다시 눌러도 한 건). 저장되면 dataset.rid를 지워 새 번호.
function formToken(form) { if (!form.dataset.rid) form.dataset.rid = crypto.randomUUID(); return form.dataset.rid; }
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && ME) { ME = null; render(); }
  if (!res.ok) throw Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: res.status });
  return data;
}
function toast(msg, kind = 'ok') {
  const t = $('#toast'); clearTimeout(toast._t);
  if (kind === 'err') {
    // Errors often say what to do next, so they stay until dismissed (or the next message / page change).
    t.innerHTML = `<span>${esc(msg)}</span><button type="button" aria-label="닫기">×</button>`;
    t.className = 'show err'; t.onclick = hideToast;
  } else {
    t.textContent = msg; t.className = 'show ' + kind; t.onclick = null;
    toast._t = setTimeout(hideToast, 2600);
  }
}
function hideToast() { const t = $('#toast'); if (t) t.className = ''; }
window.addEventListener('hashchange', hideToast);
const fail = (e) => toast(e.message || String(e), 'err');
const userHasRole = (user, r) => user.roles.includes(r) || (['quality','dev'].includes(r) && user.roles.includes(r + '_approver'));
const hasRole = (r) => ME && (ME.is_admin || userHasRole(ME, r));
const canApproveRequest = (type) => hasRole({ voc: 'quality_approver', analysis: 'quality_approver', development: 'dev_approver', sample: 'production', sample_goods: 'purchase' }[type]);
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
function listControls(prefix, { placeholder = '검색어 입력', dateLabel = '', dateFold = '', from = '', to = '', requiredDates = false, extra = '' } = {}) {
  const dates = dateLabel ? `<label>${dateLabel}일<input type="date" name="from" id="${prefix}From" value="${from}" ${requiredDates ? 'required' : ''} aria-label="${dateLabel}일 시작"></label><label>~<input type="date" name="to" id="${prefix}To" value="${to}" ${requiredDates ? 'required' : ''} aria-label="${dateLabel}일 끝"></label>` : ''; // 15.214 다른 조회 줄처럼 「○○일 시작 ~ 끝」 한 칸
  // dateFold: an optional period, folded away after the keyword and other filters (opens when a date is set).
  return `<form id="${prefix}Filters" class="toolbar list-filters" data-read-only="true">
    ${dates}<label class="list-search">키워드 검색<input type="search" name="q" id="${prefix}Q" maxlength="200" placeholder="${esc(placeholder)}"></label>${extra}
    <button type="button" class="btn icon-reset" data-clear-filters title="조건 초기화" aria-label="조건 초기화">↻</button><button type="submit" class="btn primary">조회</button><span class="small muted" id="${prefix}Count" data-list-count role="status"></span></form>`; // 15.214 조회 줄 통일(dateFold는 예전 호출 호환용)
}
function listInspectionSelect() { return `<label>검수 상태<select name="inspection_status"><option value="">전체 검수</option>${Object.entries(INSPECTION).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>`; }
function bindListControls(form, load, reset = () => {}) {
  rememberList(form);
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
  // 15.214 기간이 있는 조회 줄은 모두 「◀ 기간 선택 ▶」(매출전표 등과 같은 모양)
  if (form.elements.from?.type === 'date' && form.elements.to?.type === 'date' && !form.querySelector('.range-presets') && typeof rangePresets === 'function') rangePresets(form.elements.from, form.elements.to, { onPick: run });
}
function listLoading(form) { $('[data-list-count]', form).textContent = '조회 중…'; }
function listCount(form, count) { $('[data-list-count]', form).textContent = `${count}건 조회`; }

// 15.167 팝업이 떠 있으면 키보드·마우스는 맨 위 팝업에만: 뒤 화면(#app)과 아래 팝업은 inert(포커스·클릭·Enter가 안 감).
// 팝업이 어떤 경로로 사라지든(닫기·화면 이동·코드에서 remove) 지켜보다가 맞춘다 — 뒤 화면이 잠긴 채 남지 않게.
function syncModalInert() {
  const wraps = [...document.querySelectorAll('.modal-wrap')], app = document.getElementById('app');
  if (app) app.inert = wraps.length > 0;
  wraps.forEach((w, i) => { w.inert = i < wraps.length - 1; });
}
if (typeof MutationObserver !== 'undefined' && document.body) new MutationObserver(() => syncModalInert()).observe(document.body, { childList: true });
// 15.211 세금계산서 양식(.taxf)은 휴대폰에서도 PC 모양(1000px) 그대로 두고 화면 폭에 맞춰 줄인다(zoom). 글자가 작으면 손가락으로 확대.
const FIXED_FORM_W = 1000;
function fitFixedForms(root) {
  for (const f of root.querySelectorAll('.taxf')) {
    const host = f.parentElement; if (!host) continue;
    if (innerWidth > 760) { f.classList.remove('taxf-zoomed'); f.style.zoom = ''; f.style.width = ''; continue; }
    f.classList.add('taxf-zoomed'); const cs = getComputedStyle(host), w = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); if (!(w > 0)) continue;
    f.style.zoom = '1'; f.style.width = FIXED_FORM_W + 'px'; const natural = Math.max(FIXED_FORM_W, f.scrollWidth); // 칸 최소 폭 때문에 1000px보다 넓으면 그 폭 그대로
    f.style.width = natural + 'px'; f.style.zoom = String(Math.min(1, (w - 2) / f.offsetWidth)); // 테두리·안쪽 여백까지 넣은 바깥 폭 기준
  }
}
addEventListener('resize', () => $$('.modal').forEach(fitFixedForms));
function modal(html, { wide = false, onClose = () => {} } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="modal-x" aria-label="닫기">×</button>${html}</div>`;
  const opener = document.activeElement;
  const close = () => { if (!wrap.isConnected) return; wrap.remove(); syncModalInert(); document.removeEventListener('keydown', onKey); onClose(); const top = $$('.modal-wrap').at(-1); if (top) { if (!top.contains(document.activeElement)) ($('.modal', top)?.focus?.()); } else if (opener?.isConnected) opener.focus?.(); };
  const onKey = (e) => {
    if (wrap !== $$('.modal-wrap').at(-1)) return; // only the top dialog reacts
    if (e.key === 'Escape') close();
    // Keyboard users stay inside the dialog: Tab from the last control goes back to the first (15.35).
    if (e.key === 'Tab') {
      const items = $$('button:not([disabled]),[href],input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])', wrap).filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && (document.activeElement === first || !wrap.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !wrap.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $('.modal-x', wrap).onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap); syncModalInert();
  { // 15.211 휴대폰: 화면보다 긴 팝업은 보이는 화면에 꽉 차게(닫기 × 위에 고정, 단추 줄 아래 고정). 세금계산서 양식은 PC 배율 그대로 줄여 보이고 손가락으로 확대.
    const box = $('.modal', wrap), fit = () => { if (!wrap.isConnected) { ro.disconnect(); return; } fitFixedForms(box); box.classList.toggle('modal-tall', innerWidth <= 700 && box.scrollHeight > box.clientHeight + 4); };
    const ro = new ResizeObserver(() => requestAnimationFrame(fit)); ro.observe(box); requestAnimationFrame(fit);
  }
  // 포커스를 팝업 안으로: [autofocus] → 첫 입력칸 → 확인 단추(확인 창) → 팝업 자체. 뒤 화면 단추에 포커스가 남아 Enter가 뒤로 가지 않게.
  const dialog = $('.modal', wrap); dialog.tabIndex = -1;
  const first = $('[autofocus]', wrap) || $$('input:not([type=hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled])', wrap).find(el => el.offsetParent !== null) || $('[data-yes]', wrap);
  (first || dialog).focus({ preventScroll: !first });
  return { el: dialog, close };
}
function confirmBox(msg) {
  return new Promise((resolve) => {
    const m = modal(`<p class="confirm-msg">${esc(msg)}</p><div class="actions"><button class="btn" data-no>취소</button><button class="btn danger" data-yes>확인</button></div>`, { onClose: () => resolve(false) });
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(false); };
    $('[data-yes]', m.el).onclick = () => { resolve(true); m.close(); };
  });
}
// 구매의뢰에서 만든 발주 삭제(15.69): 'close'(의뢰 품목도 닫기, 기본) · 'requeue'(발주 대기로 되돌리기) · null(취소)
function poDeleteChoice(p) {
  return new Promise((resolve) => {
    const m = modal(`<h3>발주 삭제</h3><p class="confirm-msg">${esc(p.item)} · ${esc(p.req_no)}</p><p class="small muted">구매의뢰에서 만든 발주입니다. 지운 뒤 이 의뢰 품목을 어떻게 할까요?</p>
      <div class="actions"><button class="btn" data-no>취소</button><button class="btn" data-requeue>삭제 후 다시 발주 대기로</button><button class="btn danger" data-yes>삭제 (발주 안 함)</button></div>`, { onClose: () => resolve(null) });
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(null); };
    $('[data-requeue]', m.el).onclick = () => { resolve('requeue'); m.close(); };
    $('[data-yes]', m.el).onclick = () => { resolve('close'); m.close(); };
  });
}
// With { submit }, the dialog stays open while the values are saved; a rejected save keeps everything typed.
// wide: 넓은 창, onOpen(창 요소): 입력 중 계산 같은 동작을 붙일 때(15.69)
function promptBox(title, fieldsHtml, { submit = null, wide = false, onOpen = null } = {}) {
  return new Promise((resolve) => {
    let busy = false;
    const m = modal(`<h3>${esc(title)}</h3><form class="stack">${fieldsHtml}<div class="actions"><button type="button" class="btn" data-no>취소</button><button class="btn primary">확인</button></div></form>`, { wide, onClose: () => resolve(null) });
    if (onOpen) onOpen(m.el);
    $('[data-no]', m.el).onclick = () => { if (busy) return; m.close(); resolve(null); };
    $('form', m.el).onsubmit = async (e) => {
      e.preventDefault(); if (busy) return;
      const v = formObj(e.target);
      if (!submit) { resolve(v); m.close(); return; }
      busy = true; e.target.inert = true;
      try { const result = await submit(v); resolve(result ?? v); m.close(); }
      catch (error) { fail(error); }
      finally { busy = false; e.target.inert = false; }
    };
  });
}

// 사진 → 최대 1600px JPEG data URL
const PHOTO_FILE_LIMIT = 8 * 1024 * 1024;
const PHOTO_REQUEST_LIMIT = 28 * 1024 * 1024; // JSON 요청 한도(30MB)의 여유를 남깁니다.
function validatePhotoFiles(files, existingCount = 0) {
  if (existingCount + files.length > 10) throw new Error('사진은 최대 10장까지 첨부할 수 있습니다.');
  for (const file of files) if (file.size > PHOTO_FILE_LIMIT) throw new Error(`사진 한 장은 최대 8MB까지 업로드할 수 있습니다. 「${file.name || '선택한 사진'}」(${(file.size / 1024 / 1024).toFixed(1)}MB)을 줄인 뒤 다시 선택하세요.`);
}
function validatePhotoPayload(photos, keptCount = 0) {
  if (photos.length + keptCount > 10) throw new Error('사진은 최대 10장까지 첨부할 수 있습니다.');
  let encodedSize = 0;
  for (const photo of photos) {
    const base64 = photo.slice(photo.indexOf(',') + 1);
    const size = Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (size > PHOTO_FILE_LIMIT) throw new Error('사진 한 장은 최대 8MB까지 업로드할 수 있습니다. 사진 크기를 줄여주세요.');
    encodedSize += photo.length;
  }
  if (encodedSize > PHOTO_REQUEST_LIMIT) throw new Error('첨부 사진의 전체 용량이 큽니다. 사진 개수를 줄여 나누어 첨부해 주세요.');
}
async function preparePhotos(files, initial = [], keptCount = 0) {
  const selected = [...files]; validatePhotoFiles(selected, initial.length + keptCount);
  const photos = [...initial];
  // 큰 원본 여러 장을 동시에 디코딩하지 않습니다.
  for (const file of selected) { photos.push(await resizeImage(file)); validatePhotoPayload(photos, keptCount); }
  return photos;
}
function resizeImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    try { validatePhotoFiles([file]); } catch (error) { reject(error); return; }
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const result = c.toDataURL('image/jpeg', 0.85); validatePhotoPayload([result]); resolve(result);
      } catch (error) { reject(error); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다: ' + file.name)); };
    img.src = url;
  });
}
function lightbox(src) { modal(`<img class="lightbox" src="${esc(src)}" alt="사진">`, { wide: true }); }

const INSPECTION = { unchecked: '미판정', normal: '이상 없음', abnormal: '이상 있음' };
// 15.78 입고에 연결된 수입검사 판정(측정값 저장 후). 판정 전에는 표시하지 않는다.
function qcChip(row) { return row.qc_result === 'exempt' ? ' <span class="chip">수입검사 제외</span>' : row.qc_result === 'pass' ? ' <span class="chip green">수입검사 합격</span>' : row.qc_result === 'fail' ? ' <span class="chip red">수입검사 불합격</span>' : row.qc_result === 'pending' ? ' <span class="chip yellow">수입검사 측정 중</span>' : ''; }
function inspectionBadge(row) { return `<span class="chip ${row.inspection_status === 'abnormal' ? 'red' : row.inspection_status === 'normal' ? 'green' : ''}">${INSPECTION[row.inspection_status] || '미판정'}</span>${row.photo_count ? ` <span class="small muted">사진 ${row.photo_count}장</span>` : ''}`; }
function photoPicker() { return '<label class="span3 photo-picker">사진 첨부 (한 장당 최대 8MB · 최대 10장)<input data-photo-input type="file" accept="image/jpeg,image/png,image/webp" multiple><input data-photo-camera type="file" accept="image/*" capture="environment" hidden><span class="photo-tools"><button type="button" class="btn small" data-photo-shoot>📷 바로 촬영</button> <span class="muted small">한 장당 8MB 이하의 사진을 선택하세요. 촬영한 사진은 이어서 추가됩니다. 사진을 눌러 크게 보고, ×로 뺄 수 있습니다.</span></span><div class="thumbs" data-photo-preview></div></label>'; }
function bindPhotoDraft(form, initial = []) {
  const state = { photos: [...initial], busy: false };
  const input = $('[data-photo-input]', form); const preview = $('[data-photo-preview]', form);
  const camera = $('[data-photo-camera]', form); const shoot = $('[data-photo-shoot]', form);
  const show = () => {
    if (!preview) return;
    preview.innerHTML = state.photos.map((src, i) => `<span class="thumb"><img src="${esc(src)}" alt="첨부 미리보기"><button type="button" data-photo-remove="${i}" aria-label="이 사진 빼기">×</button></span>`).join('');
    $$('img', preview).forEach(image => image.onclick = event => { event.preventDefault(); event.stopPropagation(); lightbox(image.src); });
    $$('[data-photo-remove]', preview).forEach(button => button.onclick = event => { event.preventDefault(); event.stopPropagation(); if (state.busy) return; state.photos.splice(Number(button.dataset.photoRemove), 1); if (input) input.value = ''; show(); });
  };
  // Picking from the gallery replaces the selection; camera shots are appended one by one.
  const take = async (source, append) => {
    const submit = $('button[type=submit], button.primary', form);
    state.busy = true; if (submit) submit.disabled = true;
    try {
      const keptCount = $$('input[name=keep_photos]:checked', form).length;
      state.photos = await preparePhotos(source.files, append ? state.photos : [], keptCount); show();
    } catch (error) { source.value = ''; fail(error); }
    finally { if (append || !state.photos.length) source.value = ''; state.busy = false; if (submit) submit.disabled = false; }
  };
  if (input) input.onchange = () => take(input, false);
  if (camera && shoot) { shoot.onclick = event => { event.preventDefault(); if (!state.busy) camera.click(); }; camera.onchange = () => { if (camera.files.length) take(camera, true); }; }
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
        validatePhotoPayload(draft.photos, (values.keep_photos || []).length);
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
// 메뉴: 업무 → 하위 메뉴 → 화면. 입력과 목록(조회·검색)은 서로 다른 화면입니다(VIEW_SPLIT).
const NAV = [
  { group: '홈', items: [['#/', '대시보드 · 업무흐름'], ['#/reports', '리포트 · 통계']] },
  { group: '영업', items: [{ sub: '견적', items: [['#/sales/quotes', '견적서 관리']] }, { sub: '수주', items: [['#/sales/orders', '수주 관리']] }, { sub: '매출전표', items: [['#/sales/bills', '매출전표 관리'], ['#/sales/calendar', '매출 달력'], ['#/sales/reps', '영업담당자별 현황'], ['#/sales/returns', '반입(반품) 관리'], ['#/sales/delivery-status', '납품현황'], ['#/sales/closing', '매출 마감']] }, { sub: '생산의뢰', items: [['#/sales/mr', '생산의뢰 관리']] }, { sub: '구매의뢰', items: [['#/sales/pr', '구매의뢰 관리']] }, { sub: '샘플의뢰', items: [['#/sales/sample/product', '제품 샘플의뢰'], ['#/sales/sample/goods', '상품 샘플의뢰']] }] },
  { group: '구매', items: [
    { sub: '발주', items: [['#/purchase/po', '발주 관리']] },
    { sub: '매입전표', items: [['#/purchase/bills', '매입전표 관리'], ['#/purchase/calendar', '매입 달력'], ['#/purchase/returns', '반출(반품) 관리'], ['#/purchase/receipt-status', '입고현황'], ['#/purchase/closing', '매입 마감']] },
    { sub: '샘플(상품)', items: [['#/purchase/sample/list', '상품 샘플리스트']] },
    { sub: '세탁', items: [['#/purchase/laundry', '불량·폐기 관리'], ['#/purchase/laundry-reports', '세탁 검수·성적서']] },
  ] },
  // 15.164 경리: 매입·매출 세금계산서, 매입·매출 거래처별 장부, 대금(입금·지급·원장·연령표)을 한곳에. 화면 주소는 그대로라 볼 수 있는 사람(영업·구매 메뉴 권한)도 그대로이고, 권한 없는 화면은 메뉴에서 빠진다.
  { group: '경리', items: [
    { sub: '세금계산서', items: [['#/sales/tax', '매출 세금계산서 관리'], ['#/sales/tax-check', '매출 발행 체크'], ['#/purchase/tax', '매입 세금계산서'], ['#/purchase/tax-check', '매입 발행 체크']] },
    { sub: '거래처별 장부', items: [['#/sales/book', '매출 거래처별 장부'], ['#/purchase/book', '매입 거래처별 장부']] },
    { sub: '대금', items: [['#/purchase/payments', '입금확인'], ['#/purchase/disbursements', '지급확인'], ['#/purchase/notes', '어음 관리'], ['#/sales/aging', '채권 연령표'], ['#/purchase/aging', '채무 연령표']] },
  ] },
  { group: '품질', items: [
    ['#/quality/inspections', '수입·출하 검사 이력'],
    ['#/quality/list', '분석 관리'],
    ['#/quality/voc/list', 'VOC 관리'],
  ] },
  { group: '개발', items: [['#/dev/list', '개발 관리']] },
  { group: '생산', items: [
    { sub: '샘플(제품)', items: [['#/prod/list', '제품 샘플리스트']] },
    ['#/prod/orders', '생산의뢰 접수'],
    { sub: '완제품 생산', items: [['#/prod/finished/plan', '완제품 계획생산 접수·관리'], ['#/prod/finished', '완제품 실적 입력']] },
    { sub: '반제품 생산', items: [['#/prod/semi', '반제품 생산 관리'], ['#/prod/semi/cut', '커팅/융착 작업 관리'], ['#/prod/semi/wash', '세탁(호기별) 작업 관리']] },
  ] },
  { group: '물류', items: [
    ['#/logistics/receive', '입고 관리'],
    { sub: '출하', items: [['#/logistics/ship-orders', '출하지시'], ['#/logistics/ship', '출하 관리']] },
    ['#/logistics/stock', '재고 현황'],
    ['#/logistics/scan', 'QR 스캔'],
  ] },
];
// 15.213 하위 묶음에 화면이 하나뿐이면(견적 > 견적서 관리 등) 묶음 없이 바로 화면 링크로
for (const g of NAV) g.items = g.items.map(i => !Array.isArray(i) && i.items.length === 1 ? i.items[0] : i);
// ── 메뉴 열람 권한(15.59) ── ME.menus가 null이면 전체, 배열이면 그 업무 묶음만 메뉴에 보이고 주소로 들어와도 막는다.
// 홈·리포트·내 정보·관리자 화면은 묶음에 속하지 않아 항상 열린다(관리자 화면은 관리자만).
const MENU_GROUP_LABELS = [['sales', '영업'], ['purchase', '구매'], ['quality', '품질'], ['dev', '개발'], ['production', '생산'], ['logistics', '물류'], ['master', '기준 정보 (거래처·검사규격)']];
const NAV_GROUP_KEY = { 영업: 'sales', 구매: 'purchase', 경리: 'accounting', 품질: 'quality', 개발: 'dev', 생산: 'production', 물류: 'logistics' };
function routeMenu(route) {
  const path = String(route || '#/').split('?')[0];
  // 구매의뢰 목록은 결재선에 지정된 누구나 들어와 결재해야 하므로 막지 않는다(서버가 본인 관련 의뢰만 보여 준다).
  if (path === '#/sales/pr') return null;
  if (path.startsWith('#/purchase/vendors') || path.startsWith('#/purchase/prices') || path.startsWith('#/quality/specs')) return 'master';
  for (const [prefix, key] of [['#/sales', 'sales'], ['#/purchase', 'purchase'], ['#/quality', 'quality'], ['#/dev', 'dev'], ['#/prod', 'production'], ['#/logistics', 'logistics']]) if (path === prefix || path.startsWith(prefix + '/')) return key;
  return null;
}
const canSeeMenu = key => !key || !ME || !Array.isArray(ME.menus) || ME.menus.includes(key);
// 15.179 사용 권한이 있어야 쓸 수 있는 화면(서버가 영업·구매 담당만 허용): 메뉴를 「전체 보임」으로 해도 권한이 없으면 숨기고 막는다.
// 메뉴 보기만 켜고 권한이 없어 들어가면 빈 화면·「권한 없음」 오류만 보이던 문제.
const ROUTE_ROLE = [
  [['#/sales/quotes', '#/sales/orders', '#/sales/bills', '#/sales/calendar', '#/sales/reps', '#/sales/returns', '#/sales/delivery-status', '#/sales/closing', '#/sales/tax', '#/sales/tax-check', '#/sales/book', '#/sales/ledger', '#/sales/aging'], ['sales']],
  [['#/purchase/bills', '#/purchase/calendar', '#/purchase/returns', '#/purchase/receipt-status', '#/purchase/closing', '#/purchase/tax', '#/purchase/tax-check', '#/purchase/book', '#/purchase/ledger', '#/purchase/aging'], ['purchase']],
  [['#/purchase/payments', '#/purchase/disbursements', '#/purchase/notes'], ['sales', 'purchase']],
];
function routeRoles(route) {
  const path = String(route || '#/').split('?')[0];
  for (const [prefixes, roles] of ROUTE_ROLE) if (prefixes.some(p => path === p || path.startsWith(p + '/'))) return roles;
  return null;
}
const canUseRoute = route => { const roles = routeRoles(route); return !roles || !ME || ME.is_admin || roles.some(r => hasRole(r)); };
const canSeeRoute = route => canSeeMenu(routeMenu(route)) && canUseRoute(route);
// 대시보드처럼 여러 업무가 섞인 화면에서 볼 수 없는 업무의 카드·할 일·표 줄을 뺀다.
function applyMenuAccess(main) {
  if (!ME || !Array.isArray(ME.menus)) return;
  for (const a of main.querySelectorAll('a[href^="#/"]')) {
    if (canSeeRoute(a.getAttribute('href'))) continue;
    // 카드·표 줄은 통째로, 할 일 줄은 그 줄의 대표 링크(첫 링크)가 막힌 업무일 때만 뺀다(다른 업무의 보조 링크는 글자로 남김).
    const box = a.closest('.kpi, .dm-row, .dm-hero, .progress-table tr'), item = a.closest('.tasks li');
    if (box) { box.remove(); continue; }
    if (item && item.querySelector('a') === a) { item.remove(); continue; }
    const span = document.createElement('span'); span.textContent = a.textContent; a.replaceWith(span);
  }
  main.querySelectorAll('.kpi-group').forEach(g => { if (!g.querySelector('.kpi')) g.remove(); });
  main.querySelectorAll('.dm-card').forEach(g => { if (!g.querySelector('.dm-row, .dm-hero')) g.remove(); }); // 15.215
  // 할 일 카드: 칸(승인할 일·내가 올린 요청)마다 남은 줄 수로 건수를 고치고, 비면 안내 문구로 바꾼다(카드는 그대로).
  // 확인이 필요한 일(알림) 카드는 줄이 하나도 안 남으면 뺀다.
  main.querySelectorAll('.tasks').forEach(card => {
    const boxes = [card, ...card.querySelectorAll(':scope > .tasks-grid > section')];
    for (const box of boxes) {
      const list = box.querySelector(':scope > ul'); if (!list) continue;
      const chip = box.querySelector(':scope > h2 .chip, :scope > h3 .chip'), n = list.children.length;
      if (n) { if (chip) chip.textContent = n; continue; }
      if (box === card) { card.remove(); break; }
      chip?.remove(); const note = document.createElement('p'); note.className = 'small muted'; note.textContent = '표시할 건이 없습니다.'; list.replaceWith(note);
    }
  });
}
// 관리 메뉴(15.38): 거래처·검사규격 같은 기준 정보는 업무 메뉴가 아닌 관리 묶음에 둔다. 주소는 그대로다.
const NAV_MANAGE = [['#/purchase/vendors', '거래처 관리'], ['#/purchase/prices', '단가표'], ['#/quality/specs', '검사규격 설정']];
const NAV_ADMIN = [['#/admin/users', '회원 관리'], ['#/admin', '관리자 설정'], ['#/admin/org', '조직 구성'], ['#/admin/approval', '결재선 설정'], ['#/admin/bom', '제품등록'], ['#/admin/bom-sheet', 'BOM 소요량']]; // 15.175 회원 관리 분리
// Entry and list screens built from one page: the page renders both parts and the view hides one.
// key: route → [page route, view, title, other route, link label]
const VIEW_SPLIT = {
  '#/purchase/po/new': ['#/purchase/po', 'entry', '발주 입력', '#/purchase/po', '발주 목록 보기'],
  '#/purchase/po': ['#/purchase/po', 'list', '발주 목록', '#/purchase/po/new', '발주 입력'],
  '#/purchase/laundry/new': ['#/purchase/laundry', 'entry', '세탁 불량·폐기 입력', '#/purchase/laundry', '불량·폐기 목록 보기'],
  '#/purchase/laundry': ['#/purchase/laundry', 'list', '세탁 불량·폐기 목록', '#/purchase/laundry/new', '불량·폐기 입력'],
  '#/prod/semi/new': ['#/prod/semi', 'entry', '반제품 생산계획 입력', '#/prod/semi', '생산일정 보기'],
  '#/prod/semi': ['#/prod/semi', 'list', '반제품 생산일정', '#/prod/semi/new', '생산계획 입력'],
  '#/prod/semi/cut/new': ['#/prod/semi/cut', 'entry', '커팅/융착 작업 입력', '#/prod/semi/cut', '작업 기록 보기'],
  '#/prod/semi/cut': ['#/prod/semi/cut', 'list', '커팅/융착 작업 기록', '#/prod/semi/cut/new', '작업 입력'],
  '#/prod/semi/wash/new': ['#/prod/semi/wash', 'entry', '세탁 작업 입력', '#/prod/semi/wash', '작업 기록 보기'],
  '#/prod/semi/wash': ['#/prod/semi/wash', 'list', '세탁 작업 기록', '#/prod/semi/wash/new', '작업 입력'],
  '#/logistics/other/new': ['#/logistics/other', 'entry', '기타입고 입력', '#/logistics/receive', '입고목록 보기'],
  '#/logistics/ship/new': ['#/logistics/ship', 'entry', '출하 입력', '#/logistics/ship', '출하 목록 보기'],
  '#/logistics/ship': ['#/logistics/ship', 'list', '출하 목록', '#/logistics/ship/new', '출하 입력'],
};
// Parts before the list filters are the entry part; the filters and everything after them are the list part.
// Approval boxes at the top belong to the list. The multi-item form is added later and is hidden by CSS in the list view.
// 15.39: 제목 단계가 건너뛰는 화면(h1 다음 바로 카드 h3 등)은 화면 읽기 프로그램용 단계(aria-level)만 한 단계씩 맞춘다. 모양은 그대로다.
function fixHeadingLevels() {
  const main = document.getElementById('main'); if (!main) return;
  let last = 0;
  for (const h of main.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (!h.offsetParent) continue;
    const native = Number(h.tagName[1]), level = last && native > last + 1 ? last + 1 : native;
    if (level !== native) { if (h.getAttribute('aria-level') !== String(level)) h.setAttribute('aria-level', String(level)); }
    else if (h.dataset.levelFixed !== undefined || h.hasAttribute('aria-level')) h.removeAttribute('aria-level');
    last = level;
  }
  // 가로로 넘치는 표·차트 영역은 키보드(Tab)로도 들어가 스크롤할 수 있게 한다.
  for (const box of main.querySelectorAll('.table-wrap, .report-chart-scroll')) {
    if (box.scrollWidth > box.clientWidth + 1) { if (!box.hasAttribute('tabindex')) { box.tabIndex = 0; box.dataset.scrollFocus = ''; } }
    else if (box.dataset.scrollFocus !== undefined) { box.removeAttribute('tabindex'); delete box.dataset.scrollFocus; }
  }
}
{ let queued = false; new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fixHeadingLevels(); }); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-view', 'open'] }); }
// 15.191 도움말 단추가 제목 줄 오른쪽 단추(예: 「작업 기록 보기 →」)와 겹치면 그 단추 왼쪽으로 비킨다.
function helpDodge(main, details) {
  const sum = $('summary', details); if (!sum || getComputedStyle(details).position !== 'absolute') return;
  const r = sum.getBoundingClientRect();
  const hits = [...main.querySelectorAll('a.btn, button.btn, .btn')].filter(e => !details.contains(e) && e.offsetParent).map(e => e.getBoundingClientRect()).filter(b => b.width && b.top < r.bottom + 4 && b.bottom > r.top - 4 && b.left < r.right + 4 && b.right > r.left - 4);
  if (!hits.length) return;
  const left = Math.min(...hits.map(b => b.left));
  details.style.right = `${parseFloat(getComputedStyle(details).right) + (r.right - left) + 8}px`;
}
function foldHelp(main) {
  for (const p of main.querySelectorAll(':scope > p.muted, :scope > section > p.muted, #receiptContent > p.muted')) {
    if (p.textContent.trim().length < 80 || p.closest('details')) continue;
    const details = document.createElement('details'); details.className = 'help';
    details.innerHTML = '<summary title="이 화면 설명">도움말</summary>'; p.replaceWith(details); details.append(p); // 15.180 오른쪽 위 단추
    if (details.parentElement === main) requestAnimationFrame(() => { const h1 = $('h1', main); if (h1 && details.isConnected) { details.style.top = `${h1.offsetTop}px`; helpDodge(main, details); } }); // 제목 줄 높이에(위치 표시와 겹치지 않게)
  }
}
function applyView(main, route) {
  const split = VIEW_SPLIT[route]; if (!split) return;
  const [, view, title, other, otherLabel] = split;
  main.dataset.view = view;
  const filters = $('form.list-filters', main);
  if (filters) {
    let sibling = filters; while (sibling) { sibling.dataset.listPart = ''; sibling = sibling.nextElementSibling; }
    for (let el = filters.previousElementSibling; el; el = el.previousElementSibling) {
      if (el.matches('#semiPending, #actualChanges, #receiptChanges')) el.dataset.listPart = '';
      else if (el.matches('form, details, .card, .multi-form')) el.dataset.entryPart = '';
    }
  }
  const h1 = $('h1', main);
  if (MANAGE[navRoute(route)]) { if (view === 'entry') showRecentEntries(main, route); return; } // 15.178 관리 화면: 제목·전환은 managedTabs
  if (h1) { const text = [...h1.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim()); if (text) text.nodeValue = title + ' '; }
  const link = document.createElement('a'); link.className = `btn view-switch ${view === 'list' ? 'primary' : ''}`; link.href = other;
  link.textContent = (view === 'entry' ? '' : '＋ ') + otherLabel + (view === 'entry' ? ' →' : '');
  if (h1) h1.append(link); else main.prepend(link);
  if (view === 'entry') showRecentEntries(main, route);
}
// 11) Entry screens: what I entered today, so nothing is entered twice. Refreshes after each success message.
const RECENT_SOURCES = {
  '#/purchase/po/new': () => '/api/po',
  '#/logistics/ship/new': t => `/api/shipments?from=${t}&to=${t}`,
  '#/logistics/other/new': t => `/api/other-receipts?from=${addDays(t, -31)}&to=${t}`,
  '#/purchase/laundry/new': t => `/api/laundry?from=${addDays(t, -31)}&to=${t}`,
  '#/prod/semi/new': t => `/api/schedules?kind=semi&from=${addDays(t, -62)}&to=${addDays(t, 62)}`,
  '#/prod/semi/cut/new': t => `/api/semi-records?process=cut&from=${addDays(t, -7)}&to=${t}`,
  '#/prod/semi/wash/new': t => `/api/semi-records?process=wash&from=${addDays(t, -7)}&to=${t}`,
};
function showRecentEntries(main, route) {
  const source = RECENT_SOURCES[route]; if (!source) return;
  const box = document.createElement('section'); box.className = 'card recent-mine'; box.dataset.recent = ''; main.append(box);
  const load = async () => {
    if (!box.isConnected) return;
    const t = todayStr();
    try {
      const rows = (await api('GET', source(t))).filter(r => r.created_by === ME.name && String(r.created_at || '').startsWith(t)).sort((a, b) => b.id - a.id);
      if (!box.isConnected) return;
      box.innerHTML = `<h2>오늘 내가 입력한 것 <span class="chip">${rows.length}</span></h2>${rows.length ? `<ul>${rows.slice(0, 5).map(r => `<li><b>${esc(r.item || r.product || r.item_name || r.title || '')}</b>${r.spec ? ` <span class="muted">${esc(r.spec)}</span>` : ''} <span>${r.discard_qty != null && r.qty == null ? fmtNum(r.discard_qty) : fmtNum(r.qty)} ${esc(r.unit || '')}</span> <span class="small muted">${esc([r.req_no, r.vendor || r.customer, r.unit_name, r.start_time, String(r.created_at).slice(11, 16)].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>${rows.length > 5 ? `<p class="small muted">외 ${rows.length - 5}건</p>` : ''}` : '<p class="small muted">아직 없습니다.</p>'}`;
    } catch { box.remove(); }
  };
  load();
  const toastBox = $('#toast');
  const watch = new MutationObserver(() => { if (!box.isConnected) return watch.disconnect(); if (toastBox.classList.contains('show') && !toastBox.classList.contains('err')) setTimeout(load, 400); });
  watch.observe(toastBox, { attributes: true, attributeFilter: ['class'] });
}
const PAGES = {
  '#/': pageHome,
  '#/reports': pageReports,
  '#/purchase/po': main => managedPage(main, '#/purchase/po', pagePO), // 15.178 발주 관리
  '#/purchase/po/new': main => managedPage(main, '#/purchase/po/new', pagePO),
  '#/purchase/laundry': pageLaundry,
  '#/purchase/laundry/new': pageLaundry,
  '#/purchase/laundry-reports': pageLaundryReports,
  '#/quality/inspections': pageInspections,
  '#/quality/incoming': () => { location.replace('#/quality/inspections'); }, // 15.151 수입검사 현황 메뉴 없앰(검사 이력의 필터로 봄) — 예전 즐겨찾기는 이력으로
  '#/quality/specs': pageInspectionSpecs,
  '#/quality/request': () => pageIntake('analysis'),
  '#/quality/list': () => pageWorkList('analysis'),
  '#/quality/voc/request': () => pageIntake('voc'),
  '#/quality/voc/list': () => pageWorkList('voc'),
  '#/dev/request': () => pageIntake('development'),
  '#/dev/list': () => pageWorkList('development'),
  '#/prod/request': () => { location.replace('#/sales/sample/product'); }, // 15.183 영업으로 옮김(예전 즐겨찾기)
  '#/sales/sample/product': () => pageIntake('sample'), // 15.183 제품 샘플의뢰(영업)
  '#/sales/sample/goods': () => pageIntake('sample_goods'), // 15.183 상품 샘플의뢰(영업)
  '#/prod/list': () => pageWorkList('sample'),
  // 15.199 완제품: 1) 계획생산 접수·관리(월 계획표, 대기 → 확정) 2) 실적 입력(확정 계획 · 양품수량). 예전 일정·카드 화면은 /schedule
  '#/prod/finished/plan': main => pageFinishedPlan(main),
  '#/prod/finished': main => pageFinishedActual(main),
  '#/prod/finished/new': main => pageFinishedPlan(main),
  '#/prod/finished/schedule': () => pageSchedule('finished'),
  '#/prod/semi': () => pageSchedule('semi'),
  '#/prod/semi/new': () => pageSchedule('semi'),
  '#/logistics/receive': main => pageReceipts(main, 'purchase'),
  '#/logistics/ship': pageShip,
  '#/logistics/ship/new': pageShip,
  '#/logistics/other': main => pageReceipts(main, 'other'),
  '#/logistics/other/new': main => pageReceipts(main, 'other-entry'),
  '#/logistics/receipt/new': main => pageReceiptEntry(main),
  '#/logistics/receipts': main => pageReceiptList(main),
  '#/purchase/bills/new': main => managedPage(main, '#/purchase/bills/new', pageBillEntry), // 15.177 매입전표 관리(입력)
  '#/purchase/bills': main => managedPage(main, '#/purchase/bills', pageBillList), // 15.177 매입전표 관리(목록)
  '#/purchase/closing': main => pageBillClosing(main),
  '#/purchase/receipt-status': main => pageReceiptStatus(main),
  '#/sales/delivery-status': main => pageReceiptStatus(main, 'sales'),
  '#/sales/quotes/new': main => managedPage(main, '#/sales/quotes/new', pageQuoteEntry), // 15.163 견적서 · 15.178 견적서 관리
  '#/sales/quotes': main => managedPage(main, '#/sales/quotes', pageQuoteList),
  '#/purchase/notes': main => pageNotes(main), // 15.165 어음 관리
  '#/purchase/calendar': main => pagePurchaseCalendar(main), // 15.176 매입 달력
  '#/sales/calendar': main => managedPage(main, '#/sales/calendar', pageSalesCalendar), // 15.166 매출 달력(15.224 매출전표 관리 탭)
  '#/sales/reps': main => managedPage(main, '#/sales/reps', pageSalesReps), // 15.224 영업담당자별 현황 // 15.157 납품현황(입고현황의 매출 쪽)
  '#/sales/orders/new': main => managedPage(main, '#/sales/orders/new', pageSalesOrderEntry), // 15.178 수주 관리
  '#/sales/orders/edit': main => { let id = null; try { id = sessionStorage.getItem('wpa:so-edit'); } catch { id = null; } if (!id) { location.hash = '#/sales/orders'; return; } return managedPage(main, '#/sales/orders/edit', m => pageSalesOrderEntry(m, id)); }, // 15.179 수주 관리 · 수주 고치기
  '#/sales/orders': main => managedPage(main, '#/sales/orders', pageSalesOrderList),
  '#/logistics/ship-orders': main => pageShipInstructions(main),
  '#/sales/bills/new': main => managedPage(main, '#/sales/bills/new', pageSalesBillEntry), // 15.170 매출전표 관리(입력)
  '#/sales/bills': main => managedPage(main, '#/sales/bills', pageSalesBillList), // 15.170 매출전표 관리(목록)
  '#/purchase/payments': main => pagePayments(main, 'sales'),
  '#/purchase/disbursements': main => pagePayments(main, 'purchase'),
  '#/purchase/ledger': main => managedPage(main, '#/purchase/ledger', pagePurchaseLedger), // 15.177 매입 거래처별 장부 › 품목 줄별 원장
  '#/sales/payments': () => { location.replace('#/purchase/payments'); }, // 15.109 구매로 옮김
  '#/sales/ledger': main => managedPage(main, '#/sales/ledger', pageSalesLedger), // 15.177 매출 거래처별 장부 › 품목 줄별 원장
  '#/sales/book': main => managedPage(main, '#/sales/book', m => pagePartnerBook(m, 'sales')),
  '#/sales/returns/new': main => pageReturnEntry(main, 'in'),
  '#/sales/returns': main => pageReturnList(main, 'in'),
  '#/sales/returns/edit': main => { let id = null; try { id = sessionStorage.getItem('wpa:ret-edit'); } catch { id = null; } if (!id) { location.hash = '#/sales/returns'; return; } return pageReturnEntry(main, 'in', id); },
  '#/purchase/returns/edit': main => { let id = null; try { id = sessionStorage.getItem('wpa:ret-edit'); } catch { id = null; } if (!id) { location.hash = '#/purchase/returns'; return; } return pageReturnEntry(main, 'out', id); },
  '#/purchase/returns/new': main => pageReturnEntry(main, 'out'),
  '#/purchase/returns': main => pageReturnList(main, 'out'),
  '#/purchase/book': main => managedPage(main, '#/purchase/book', m => pagePartnerBook(m, 'purchase')),
  '#/sales/aging': main => pageAging(main, 'sales'),
  '#/purchase/aging': main => pageAging(main, 'purchase'),
  '#/sales/closing': main => pageSalesClosing(main),
  '#/sales/tax/new': main => managedPage(main, '#/sales/tax/new', pageTaxMake), // 15.170 세금계산서 관리(만들기)
  '#/sales/tax': main => pageTaxList(main).then(() => managedTabs(main, '#/sales/tax')), // 15.170 세금계산서 관리(목록)
  '#/purchase/tax': main => pagePurchaseTax(main),
  '#/sales/tax-check': main => pageTaxCheck(main, 'sales'),
  '#/purchase/tax-check': main => pageTaxCheck(main, 'purchase'),
  '#/logistics/stock': main => pageStock(main),
  '#/logistics/scan': main => pageScan(main),
  '#/purchase/vendors': main => pageVendors(main),
  '#/purchase/prices': main => pagePrices(main),
  '#/purchase/sample/request': () => { location.replace('#/sales/sample/goods'); }, // 15.183 영업으로 옮김
  '#/purchase/sample/list': () => pageWorkList('sample_goods'),
  '#/prod/semi/cut': main => pageSemi(main, 'cut'),
  '#/prod/semi/cut/new': main => pageSemi(main, 'cut'),
  '#/prod/semi/wash': main => pageSemi(main, 'wash'),
  '#/prod/semi/wash/new': main => pageSemi(main, 'wash'),
  '#/sales/pr': main => managedPage(main, '#/sales/pr', pageSalesPrList), // 15.178 구매의뢰 관리
  '#/sales/mr': main => managedPage(main, '#/sales/mr', m => pageMrList(m, 'sales')), // 15.178 생산의뢰 관리
  '#/sales/mr/new': main => managedPage(main, '#/sales/mr/new', pageSalesMrEntry),
  '#/prod/orders': main => pageMrList(main, 'production'),
  '#/sales/pr/new': main => managedPage(main, '#/sales/pr/new', pageSalesPrEntry),
  '#/admin': pageAdmin,
  '#/admin/users': main => managedPage(main, '#/admin/users', m => pageMembers(m, 'info')), // 15.175 회원 관리 · 회원 정보
  '#/admin/users/roles': main => managedPage(main, '#/admin/users/roles', m => pageMembers(m, 'roles')), // 사용 권한
  '#/admin/users/menus': main => managedPage(main, '#/admin/users/menus', m => pageMembers(m, 'menus')), // 메뉴 보기
  '#/admin/org': pageOrg,
  '#/admin/approval': main => pageApprovalRules(main), // 15.185 결재선 기본값
  '#/admin/bom': pageBoms,
  '#/admin/bom-sheet': main => pageBomSheet(main), // 15.196
  '#/me': pageMe,
  '#/tasks': pageTasks,
  '#/favorites': pageFavorites,
};

// 15.161 메뉴 맨 위 「★ 마이메뉴」(삼성 N-SRM My Menu 참고): 화면 제목 옆 ☆나 메뉴 줄의 ☆로 고른 화면(내 설정, 다른 기기에서도 같음).
// 좌측 메뉴에서는 맨 위 그룹(접기 가능), 상단 메뉴에서는 맨 앞 파란 버튼 → 안내 카드 + 메뉴 칸. 줄의 ★를 누르면 바로 빠진다.
const favList = () => ((ME && ME.ui && ME.ui.favorites) || []).filter(f => canSeeRoute(f.href));
const isFav = href => favList().some(f => f.href === href);
const navStar = (href, label) => FAVORITE_SKIP.includes(href) ? '' : `<span class="nav-star${isFav(href) ? ' on' : ''}" data-fav-star="${esc(href)}" data-fav-label="${esc(label)}" title="${isFav(href) ? '마이메뉴에서 빼기' : '마이메뉴에 추가'}" aria-hidden="true">${isFav(href) ? '★' : '☆'}</span>`;
function favNavHtml(cur) {
  const favs = favList();
  let shut = false; try { shut = JSON.parse(localStorage.getItem('wpa:nav-shut') || '[]').includes('fav') && !favs.some(f => f.href === cur); } catch { /* 편의 */ }
  return `<div class="nav-group nav-fav${shut ? ' shut' : ''}" data-dept="fav"><button type="button" class="nav-title" data-nav-toggle="fav" aria-expanded="${!shut}">★ 마이메뉴</button><div class="nav-body"><div class="mymenu-head"><b>마이메뉴</b><span>즐겨찾기(☆)로 추가한 메뉴입니다.</span></div>${favs.length ? favs.map(f => `<a href="${esc(f.href)}" class="${cur === f.href ? 'active' : ''}">${esc(f.label)}${navStar(f.href, f.label)}</a>`).join('') : '<p class="mymenu-empty">메뉴 이름 옆 ☆를 누르면 여기에 모입니다.</p>'}</div></div>`;
}
function refreshFavNav() {
  const side = $('.side'); if (!side) return;
  side.querySelector(':scope > .nav-fav')?.remove();
  const html = favNavHtml(location.hash || '#/'); if (!html) return;
  $$('[data-fav-star]', side).forEach(x => { const on = isFav(x.dataset.favStar); x.classList.toggle('on', on); x.textContent = on ? '★' : '☆'; x.title = on ? '마이메뉴에서 빼기' : '마이메뉴에 추가'; });
  const after = side.querySelector(':scope > .side-prefs'); after ? after.insertAdjacentHTML('afterend', html) : side.insertAdjacentHTML('afterbegin', html);
  $$('.nav-fav a', side).forEach(a => { a.onclick = () => document.body.classList.remove('nav-open'); });
}
// ── 15.170 「관리」 화면: 목록과 입력(만들기)을 한 메뉴로. 같은 화면 제목 아래 전환 단추, 입력 주소(/new)는 그대로 쓰되
// 메뉴 강조·화면 탭·위치 표시는 관리 화면 하나로 묶는다(navRoute).
const MANAGE = {
  '#/sales/bills': { title: '매출전표 관리', tabs: [['#/sales/bills', '전표 목록'], ['#/sales/bills/new', '전표 입력'], ['#/sales/calendar', '매출 달력'], ['#/sales/reps', '담당자별 현황']] },
  '#/sales/tax': { title: '세금계산서 관리', tabs: [['#/sales/tax', '계산서 목록'], ['#/sales/tax/new', '계산서 만들기']] },
  '#/sales/quotes': { title: '견적서 관리', tabs: [['#/sales/quotes', '견적서 목록'], ['#/sales/quotes/new', '견적서 작성']] },
  '#/sales/orders': { title: '수주 관리', tabs: [['#/sales/orders', '수주 목록'], ['#/sales/orders/new', '수주 입력']] },
  '#/sales/mr': { title: '생산의뢰 관리', tabs: [['#/sales/mr', '생산의뢰 목록'], ['#/sales/mr/new', '생산의뢰 작성']] },
  '#/sales/pr': { title: '구매의뢰 관리', tabs: [['#/sales/pr', '구매의뢰 목록'], ['#/sales/pr/new', '구매의뢰 작성']] },
  '#/purchase/po': { title: '발주 관리', tabs: [['#/purchase/po', '발주 목록'], ['#/purchase/po/new', '발주 입력']] },
  '#/purchase/bills': { title: '매입전표 관리', tabs: [['#/purchase/bills', '전표 목록'], ['#/purchase/bills/new', '전표 입력']] },
  '#/sales/book': { title: '매출 거래처별 장부', tabs: [['#/sales/book', '전표별 장부'], ['#/sales/ledger', '품목 줄별 원장']] },
  '#/purchase/book': { title: '매입 거래처별 장부', tabs: [['#/purchase/book', '전표별 장부'], ['#/purchase/ledger', '품목 줄별 원장']] },
  '#/admin/users': { title: '회원 관리', tabs: [['#/admin/users', '회원 정보'], ['#/admin/users/roles', '사용 권한'], ['#/admin/users/menus', '메뉴 보기']] },
  // 15.213 입력·목록 메뉴 통일
  '#/logistics/receive': { title: '입고 관리', tabs: [['#/logistics/receive', '입고목록'], ['#/logistics/receipt/new', '입고 입력'], ['#/logistics/receipts', '입고증 목록']] },
  '#/logistics/ship': { title: '출하 관리', tabs: [['#/logistics/ship', '출하 목록'], ['#/logistics/ship/new', '출하 입력']] },
  '#/purchase/laundry': { title: '불량·폐기 관리', tabs: [['#/purchase/laundry', '불량·폐기 목록'], ['#/purchase/laundry/new', '불량·폐기 입력']] },
  '#/prod/semi': { title: '반제품 생산 관리', tabs: [['#/prod/semi', '생산일정'], ['#/prod/semi/new', '생산계획 입력']] },
  '#/prod/semi/cut': { title: '커팅/융착 작업 관리', tabs: [['#/prod/semi/cut', '작업 기록'], ['#/prod/semi/cut/new', '작업 입력']] },
  '#/prod/semi/wash': { title: '세탁(호기별) 작업 관리', tabs: [['#/prod/semi/wash', '작업 기록'], ['#/prod/semi/wash/new', '작업 입력']] },
  '#/quality/list': { title: '분석 관리', tabs: [['#/quality/list', '분석리스트'], ['#/quality/request', '분석의뢰']] },
  '#/quality/voc/list': { title: 'VOC 관리', tabs: [['#/quality/voc/list', 'VOC 처리목록'], ['#/quality/voc/request', 'VOC 접수']] },
  '#/dev/list': { title: '개발 관리', tabs: [['#/dev/list', '개발리스트'], ['#/dev/request', '개발의뢰']] },
};
const ROUTE_ALIAS = { '#/sales/quotes/new': '#/sales/quotes', '#/sales/orders/new': '#/sales/orders', '#/sales/orders/edit': '#/sales/orders', '#/sales/mr/new': '#/sales/mr', '#/sales/pr/new': '#/sales/pr', '#/purchase/po/new': '#/purchase/po', '#/sales/bills/new': '#/sales/bills', '#/sales/calendar': '#/sales/bills', '#/sales/reps': '#/sales/bills', '#/sales/tax/new': '#/sales/tax', '#/purchase/bills/new': '#/purchase/bills', '#/sales/ledger': '#/sales/book', '#/purchase/ledger': '#/purchase/book', '#/sales/returns/new': '#/sales/returns', '#/purchase/returns/new': '#/purchase/returns', '#/admin/users/roles': '#/admin/users', '#/admin/users/menus': '#/admin/users', '#/logistics/receipt/new': '#/logistics/receive', '#/logistics/receipts': '#/logistics/receive', '#/logistics/ship/new': '#/logistics/ship', '#/purchase/laundry/new': '#/purchase/laundry', '#/prod/semi/new': '#/prod/semi', '#/prod/semi/cut/new': '#/prod/semi/cut', '#/prod/semi/wash/new': '#/prod/semi/wash', '#/quality/request': '#/quality/list', '#/quality/voc/request': '#/quality/voc/list', '#/dev/request': '#/dev/list' };
const navRoute = r => ROUTE_ALIAS[String(r || '#/').split('?')[0]] || String(r || '#/').split('?')[0];
function managedTabs(main, route) {
  const m = MANAGE[navRoute(route)], h1 = $('h1', main); if (!m || !h1 || $('.manage-tabs', main)) return;
  const t = [...h1.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
  if (t) t.nodeValue = /수정|고치기/.test(t.nodeValue) ? `${m.title} · ${t.nodeValue.trim()} ` : m.title + ' '; else h1.prepend(m.title + ' '); // 15.178 고치는 중 표시 유지
  const anchor = h1.nextElementSibling?.matches('.tax-side, .class-tabs.tax-side') ? h1.nextElementSibling : h1; // 15.180 매출/매입 탭 아래 둘째 줄
  anchor.insertAdjacentHTML('afterend', `<nav class="manage-tabs${anchor !== h1 ? ' sub' : ''}" aria-label="${esc(m.title)}">${m.tabs.filter(([h]) => canSeeRoute(h)).map(([h, l]) => `<a href="${h}" class="${h === route ? 'on' : ''}"${h === route ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>`);
}
// 15.213 메뉴 찾기: 화면 이름 일부를 치면 「부서 › 묶음 › 화면」 목록이 뜨고, Enter·누르면 그 화면으로.
function bindNavFind() {
  const box = $('.nav-search'), input = $('#navFind'), list = $('.nav-find-list'); if (!input) return;
  const all = () => $$('.side a[href^="#/"]').filter(a => !a.closest('.nav-search, .nav-fav')).map(a => {
    const path = [a.closest('.nav-group')?.querySelector('.nav-title')?.textContent.trim(), a.closest('.nav-sub')?.querySelector('summary')?.textContent.trim()].filter(Boolean);
    return { href: a.getAttribute('href'), label: [...a.childNodes].filter(n => !(n.classList && n.classList.contains('nav-star'))).map(n => n.textContent).join('').trim(), path };
  }).filter((x, i, arr) => arr.findIndex(y => y.href === x.href) === i);
  let hits = [], at = 0;
  const go = h => { input.value = ''; list.hidden = true; document.body.classList.remove('nav-open'); location.hash = h; };
  const show = () => {
    const q = input.value.replace(/\s+/g, '').toLowerCase(); if (!q) { list.hidden = true; return; }
    hits = all().filter(x => (x.path.join('') + x.label).replace(/\s+/g, '').toLowerCase().includes(q)).slice(0, 12); at = 0;
    list.innerHTML = hits.length ? hits.map((x, i) => `<a href="${esc(x.href)}" class="${i === at ? 'on' : ''}" data-i="${i}"><b>${esc(x.label)}</b><span>${esc(x.path.join(' › '))}</span></a>`).join('') : '<div class="small muted">찾는 메뉴가 없습니다.</div>';
    list.hidden = false;
  };
  input.addEventListener('input', show);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; list.hidden = true; return; }
    if (!hits.length || list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); at = (at + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; $$('a', list).forEach((a, i) => a.classList.toggle('on', i === at)); }
    if (e.key === 'Enter') { e.preventDefault(); go(hits[at].href); }
  });
  list.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (a) { e.preventDefault(); go(a.getAttribute('href')); } });
  if (!bindNavFind.once) { bindNavFind.once = true; // 문서 이벤트는 한 번만(화면마다 메뉴를 다시 그려도 쌓이지 않게). 누른 단추 글자가 바뀌어 떨어져도 경로로 판단.
    document.addEventListener('click', e => { const path = e.composedPath(); if (!path.some(n => n.classList?.contains('nav-search'))) $$('.nav-find-list').forEach(l => { l.hidden = true; }); if (!path.some(n => n.classList?.contains('prefs-menu'))) $$('.prefs-menu[open]').forEach(d => { d.open = false; }); }); }
  // 화면 설정: 언어·화면 모드·메뉴 위치·밀도 단추를 「⚙ 화면 설정」 안으로 모은다(theme.js·i18n.js가 머리줄에 넣는 단추를 옮김)
  const gather = () => { const pop = $('.who .prefs-pop'); if (!pop) return; $$('.who > .lang-select, .who > .theme-toggle, .who > .skin-select, .who > .skin-face').forEach(x => pop.append(x)); };
  if (typeof applySkin === 'function' && ME?.ui) applySkin(ME.ui.skin || 'default'); // 15.220 계정에 저장된 스킨
  gather(); new MutationObserver(gather).observe($('.who'), { childList: true });
}
async function managedPage(main, route, fn) { await fn(main); managedTabs(main, route); }
// 15.228 한 칸짜리 메뉴(묶음 없이 바로 링크)는 한 칸에 모아 맨 앞에 둔다. 상단 메뉴 펼침에서 띄엄띄엄 흩어지지 않게.
function navBody(items, entry) {
  const flat = items.filter(Array.isArray), subs = items.filter(i => !Array.isArray(i));
  if (!flat.length || !subs.length) return items.map(entry).join('');
  return `<div class="nav-flat">${flat.map(entry).join('')}</div>${subs.map(entry).join('')}`;
}
function shell() {
  const cur = navRoute(location.hash || '#/'); // 15.170 입력 주소도 관리 메뉴로 강조
  const link = ([h, l]) => `<a href="${h}" class="${cur === h ? 'active' : ''}">${l}${navStar(h, l)}</a>`;
  const entry = item => Array.isArray(item) ? link(item)
    : `<details class="nav-sub" data-sub="${esc(item.sub)}" ${item.items.some(([h]) => h === cur) ? 'open' : ''}><summary>${item.sub}</summary>${item.items.map(link).join('')}</details>`;
  // 15.156 부서별 메뉴 접기: 머리글을 누르면 접고 펼침(기억). 지금 화면이 들어 있는 부서는 늘 펼친다.
  let navShut = new Set(); try { navShut = new Set(JSON.parse(localStorage.getItem('wpa:nav-shut') || '[]')); } catch { /* 편의 */ }
  const hasCur = items => items.some(i => Array.isArray(i) ? i[0] === cur : i.items.some(([h]) => h === cur));
  const group = (dept, title, items, body) => { const shut = navShut.has(dept) && !hasCur(items); return `<div class="nav-group${shut ? ' shut' : ''}" data-dept="${dept}"><button type="button" class="nav-title" data-nav-toggle="${dept}" aria-expanded="${!shut}">${title}</button><div class="nav-body">${body}</div></div>`; };
  const seeItems = items => items.map(i => Array.isArray(i) ? (canSeeRoute(i[0]) ? i : null) : (s => s.items.length ? s : null)({ ...i, items: i.items.filter(([h]) => canSeeRoute(h)) })).filter(Boolean); // 15.164 경리처럼 여러 부서 화면이 섞인 묶음
  const nav = favNavHtml(cur) + NAV.filter(g => g.group === '경리' || canSeeMenu(NAV_GROUP_KEY[g.group])).map(g => ({ ...g, items: seeItems(g.items) })).filter(g => g.items.length) /* 15.179 모든 묶음에서 쓸 수 없는 화면 빼기 */.map((g) => group(NAV_GROUP_KEY[g.group] || 'home', g.group, g.items, navBody(g.items, entry))).join('')
    // 관리: 기준 정보 화면(메뉴 권한 「기준 정보」, 권한은 각 화면과 서버가 그대로 판단) + 관리자 전용 화면
    + ((manage => manage.length ? group('manage', '관리', manage, manage.map(link).join('')) : '')([...(canSeeMenu('master') ? NAV_MANAGE : []), ...(ME.is_admin ? NAV_ADMIN : [])]));
  const roles = ME.roles.map((r) => ROLE_LABEL[r]).join(', ');
  // 15.87 메뉴를 다시 그려도 왼쪽 메뉴의 스크롤 위치와 펼쳐 둔 하위 메뉴를 그대로 둔다(누른 메뉴 자리에 머묾).
  const oldSide = $('.side'), sideScroll = oldSide ? oldSide.scrollTop : null;
  const openSubs = oldSide ? new Set($$('.nav-sub[open]', oldSide).map(d => d.dataset.sub)) : null;
  $('#app').innerHTML = `
  <header class="top">
    <button class="menu-btn" aria-label="메뉴">☰</button>
    <a href="#/" class="brand"><img class="brand-logo" src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"> <span class="brand-text">서울세미텍 시스템</span><span class="app-version">버전 ${APP_VERSION}</span></a>
    <div class="who"><details class="prefs-menu"><summary class="btn small" title="언어·화면 모드·메뉴 위치·화면 밀도">⚙ 화면 설정</summary><div class="prefs-pop"></div></details><a href="#/me" title="내 정보">${esc(ME.name)}${ME.is_admin ? ' <span class="tag">관리자</span>' : ''}${roles ? ` <span class="tag soft">${esc(roles)}</span>` : ''}</a>
      <button class="btn small" id="logout">로그아웃</button></div>
  </header>
  <div class="layout"><nav class="side"><div class="nav-search" role="search"><input type="search" id="navFind" placeholder="메뉴 찾기" aria-label="메뉴 찾기" autocomplete="off"><div class="nav-find-list" hidden></div></div>${nav}<div class="side-account"><a href="#/me">내 정보</a><button type="button" class="btn small" id="logoutSide">로그아웃</button></div></nav><main id="main"></main></div>
  <nav class="tabbar" aria-label="빠른 이동">
    <a href="#/" class="${cur === '#/' ? 'active' : ''}"><svg class="tab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg><span>홈</span></a>
    <a href="#/tasks" class="${cur === '#/tasks' ? 'active' : ''}"><svg class="tab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/></svg><span>할 일</span><b class="tab-badge" data-task-badge hidden></b></a>
    <a href="#/favorites" class="${cur === '#/favorites' ? 'active' : ''}"><svg class="tab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z"/></svg><span>자주 쓰는 화면</span></a>
    <button type="button" class="tab-menu" aria-label="전체 메뉴 열기"><svg class="tab-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>메뉴</span></button>
  </nav>`;
  const logout = async () => { await api('POST', '/api/auth/logout'); uxClearUser(); ME = null; render(); };
  bindNavFind();
  $('#logout').onclick = logout; $('#logoutSide').onclick = logout;
  $('.menu-btn').onclick = () => document.body.classList.toggle('nav-open');
  $('.tab-menu').onclick = () => document.body.classList.toggle('nav-open');
  $$('.side a').forEach((a) => (a.onclick = () => document.body.classList.remove('nav-open')));
  const side = $('.side');
  // 15.159 상단 메뉴: 머리글을 누르면(또는 올리면) 그 부서의 하위 메뉴가 아래로 펼쳐진다. 바깥·Esc·메뉴를 누르면 닫힘.
  const topNav = () => document.documentElement.dataset.nav === 'top' && matchMedia('(min-width: 821px)').matches;
  const drop = (g, on) => { $$('.nav-group.drop', side).forEach(x => { if (x !== g) { x.classList.remove('drop'); x.querySelector('.nav-title')?.setAttribute('aria-expanded', 'false'); } }); if (!g) return; g.classList.toggle('drop', on); g.querySelector('.nav-title').setAttribute('aria-expanded', String(on)); if (on) $$('.nav-sub', g).forEach(d => { d.open = true; }); };
  side.addEventListener('mouseover', e => { if (!topNav() || !$('.nav-group.drop', side)) return; const g = e.target.closest('.nav-group'); if (g && !g.classList.contains('drop')) drop(g, true); }); // 하나가 열려 있으면 옆 부서로 옮겨 가며 봄
  side.addEventListener('keydown', e => { if (e.key === 'Escape' && topNav()) { const g = $('.nav-group.drop', side); drop(null); g?.querySelector('.nav-title')?.focus(); } });
  if (!window.navTopOutside) { window.navTopOutside = true; document.addEventListener('mousedown', e => { if (!e.target.closest('.side')) $$('.side .nav-group.drop').forEach(g => { g.classList.remove('drop'); g.querySelector('.nav-title')?.setAttribute('aria-expanded', 'false'); }); }); } // 한 번만 건다(메뉴는 화면마다 다시 그림)
  side.addEventListener('click', e => { if (topNav() && e.target.closest('a')) drop(null); });
  side.addEventListener('click', e => {
    const t = e.target.closest('[data-nav-toggle]'); if (!t) return;
    if (topNav()) { const g = t.closest('.nav-group'); drop(g, !g.classList.contains('drop')); return; }
    const g = t.closest('.nav-group'), shut = !g.classList.contains('shut'), dept = t.dataset.navToggle;
    g.classList.toggle('shut', shut); t.setAttribute('aria-expanded', String(!shut));
    try { const s = new Set(JSON.parse(localStorage.getItem('wpa:nav-shut') || '[]')); shut ? s.add(dept) : s.delete(dept); localStorage.setItem('wpa:nav-shut', JSON.stringify([...s])); } catch { /* 편의 */ }
  });
  if (openSubs) $$('.nav-sub', side).forEach(d => { if (openSubs.has(d.dataset.sub)) d.open = true; });
  if (sideScroll !== null) side.scrollTop = sideScroll;
  const active = $('.side a.active');
  // 처음 열 때는 지금 화면 메뉴가 보이게(문서 스크롤은 건드리지 않도록 메뉴 안에서만 움직임)
  if (active && sideScroll === null && side.scrollHeight > side.clientHeight) { const top = active.getBoundingClientRect().top - side.getBoundingClientRect().top; if (top > side.clientHeight - 40) side.scrollTop = top - side.clientHeight / 3; }
}

// ── 15.162 N-SRM식 화면 탭·위치 표시 ── 연 화면을 탭으로 모아 두고(이 기기, 최대 10개) × 로 닫는다. 위치는 메뉴 구조에서 찾는다.
const TABS_MAX = 10, tabsKey = () => `wpa:tabs:${ME?.id || 0}`;
function readTabs() { try { const v = JSON.parse(localStorage.getItem(tabsKey()) || '[]'); return Array.isArray(v) ? v.filter(t => t && t.href && canSeeRoute(t.href)) : []; } catch { return []; } }
function writeTabs(list) { try { localStorage.setItem(tabsKey(), JSON.stringify(list.slice(-TABS_MAX))); } catch { /* 편의 */ } }
function crumbPath(route) {
  const out = []; const walk = (items, trail) => { for (const i of items) { if (Array.isArray(i)) { if (i[0] === route) { out.push(...trail, i[1]); return true; } } else if (walk(i.items, [...trail, i.sub])) return true; } return false; };
  for (const g of NAV) if (walk(g.items, [g.group])) return out;
  for (const [h, l] of [...NAV_MANAGE, ...NAV_ADMIN]) if (h === route) return ['관리', l];
  return [];
}
function pageTabs(main, route) {
  if (!main || main.querySelector(':scope > .page-tabs')) return;
  const path = navRoute(route), trail = crumbPath(path), h1 = $('h1', main); // 15.170 입력·목록은 한 탭
  const label = trail.at(-1) || (h1 ? screenTitle(main) : '');
  let tabs = readTabs();
  if (path !== '#/' && label && PAGES[path]) { if (!tabs.some(t => t.href === path)) tabs.push({ href: path, label }); writeTabs(tabs); tabs = readTabs(); }
  const PIN = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M10 1l5 5-2 1-3 3 .5 3.5L9 15l-3-3-4 4-1-1 4-4-3-3 1.5-1.5L7 7l3-3z" fill="currentColor"/></svg>';
  const bar = document.createElement('nav'); bar.className = 'page-tabs'; bar.setAttribute('aria-label', '연 화면');
  bar.innerHTML = `<a href="#/" class="pt-tab pt-home${path === '#/' ? ' on' : ''}">HOME</a>${tabs.map(t => `<span class="pt-tab${t.href === path ? ' on' : ''}"><a href="${esc(t.href)}">${PIN}<span>${esc(t.label)}</span></a><button type="button" class="pt-x" data-tab-close="${esc(t.href)}" aria-label="${esc(t.label)} 탭 닫기" title="닫기">×</button></span>`).join('')}${tabs.length > 1 ? '<button type="button" class="pt-clear" data-tab-clear title="다른 탭 모두 닫기" aria-label="다른 탭 모두 닫기">다른 탭 닫기</button>' : ''}`;
  main.prepend(bar);
  // 15.212 탭이 많아 가로로 넘치면 지금 화면 탭이 가운데 보이게
  requestAnimationFrame(() => { const on = bar.querySelector('.pt-tab.on'); if (on && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, on.offsetLeft - bar.clientWidth / 2 + on.offsetWidth / 2); });
  const code = path.replace(/^#\/?/, '').split('/').filter(Boolean).join('-').toUpperCase() || 'HOME'; // 15.180 화면 코드(문의할 때)
  if (trail.length && h1) h1.insertAdjacentHTML('beforebegin', `<div class="crumbs" aria-label="위치"><a href="#/" aria-label="홈">⌂</a>${trail.map(t => ` <span>›</span> ${esc(t)}`).join('')}${ME?.is_admin ? ` <span class="screen-code" title="화면 코드 — 문의할 때 알려 주세요">[${esc(code)}]</span>` : ''}</div>`); // 15.213 화면 코드는 관리자만
  bar.addEventListener('click', e => {
    const x = e.target.closest('[data-tab-close]'), all = e.target.closest('[data-tab-clear]'); if (!x && !all) return;
    e.preventDefault();
    if (all) { writeTabs(readTabs().filter(t => t.href === path)); bar.querySelectorAll('.pt-tab:not(.on):not(.pt-home)').forEach(t => t.remove()); all.remove(); return; } // 15.169 화면은 그대로(입력 보존)
    const list = readTabs(), k = list.findIndex(t => t.href === x.dataset.tabClose); list.splice(k, 1); writeTabs(list);
    if (x.dataset.tabClose === path) location.hash = (list[k] || list[k - 1])?.href || '#/'; else x.closest('.pt-tab').remove();
  });
}
async function render() {
  uxBeforeRender();
  const route = location.hash || '#/';
  if (!ME) return pageAuth();
  if (isOperatorMode()) {
    operatorShell();
    try { await operatorPage(route, $('#main')); } catch (e) { $('#main').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    uxAfterRender(route); return;
  }
  document.body.classList.remove('operator-mode');
  shell();
  refreshNavBadges();
  const page = canSeeRoute(route) ? PAGES[location.hash || '#/'] || pageHome : pageNoMenu;
  try { await page($('#main')); if (page === pageHome || page === pageTasks) applyMenuAccess($('#main')); if (page !== pageNoMenu) favoriteTools($('#main'), route); applyView($('#main'), route); foldHelp($('#main')); erpEntryBar($('#main'), route); requestAnimationFrame(fixHeadingLevels); } catch (e) { $('#main').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  try { managedTabs($('#main'), route.split('?')[0]); } catch { /* 15.213 */ }
  try { pageTabs($('#main'), route); } catch { /* 탭은 편의 기능 */ }
  uxAfterRender(route);
}
// 15.169 저장 안 한 입력 지키기: 입력 화면(#main의 저장 폼, 조회 조건·읽기 전용·팝업 제외)에 값을 넣고 저장하지 않은 채
// 다른 메뉴·탭·주소로 가면 물어본다(「취소」면 주소를 되돌려 화면·입력 그대로). 자동 보관(초안)이 붙은 폼은 이미 보관되므로 묻지 않는다.
// 저장(submit)하면 표시를 지우고, 새로 고침·창 닫기에는 브라우저 경고.
const dirtyForms = () => $$('#main form[data-dirty]').filter(f => f.isConnected && !f.querySelector('.draft-state'));
const markDirty = e => { const f = e.target?.closest?.('#main form'); if (!f || f.matches('.list-filters, [data-read-only]') || f.closest('.modal-wrap') || e.target.closest('.draft-state')) return; f.dataset.dirty = '1'; };
document.addEventListener('input', markDirty, true); document.addEventListener('change', markDirty, true);
document.addEventListener('click', e => { if (e.target?.closest?.('#main form button[type=button]:not(.partner-find):not([data-help])')) markDirty(e); }, true); // 품목 찾기·줄 추가/빼기처럼 단추로 바뀌는 입력
document.addEventListener('submit', e => { if (e.target?.dataset) delete e.target.dataset.dirty; }, true);
window.addEventListener('beforeunload', e => { if (dirtyForms().length) { e.preventDefault(); e.returnValue = ''; } });
let shownHash = location.hash || '#/', leaveSkip = false;
window.addEventListener('hashchange', () => {
  const to = location.hash || '#/';
  if (leaveSkip) { leaveSkip = false; return; } // 되돌린 주소 바뀜은 그냥 넘김
  if (to !== shownHash && dirtyForms().length) {
    leaveSkip = true; location.hash = shownHash; // 화면은 그대로 두고 먼저 묻는다
    confirmBox('저장하지 않은 입력이 있습니다. 이 화면을 나가면 입력한 내용이 사라집니다. 나갈까요?').then(go => {
      if (!go) return;
      dirtyForms().forEach(f => { delete f.dataset.dirty; }); location.hash = to;
    });
    return;
  }
  shownHash = to; render();
});

// ── 15.97 ERP식 표·입력 화면 ──
// 1) 표 머리글을 누르면 그 칸으로 정렬: 오름차순 → 내림차순 → 원래 순서(15.137부터 모든 목록 표).
// 체크칸이 있는 표·월 소계/합계 줄이 있는 표·창 안의 표도 정렬한다. 정렬하는 동안 소계 줄은 숨기고 맨 끝 「합계」 줄은 아래에 남긴다.
// 값을 입력하는 표(글·숫자 칸·선택 상자), 칸을 세로로 합친 표, 묶음(펼침) 표, data-no-sort 표는 정렬하지 않는다.
const TOTAL_ROW = /^(합계|총계|소계|계|total)(\s|$)/i;
const auxRow = tr => [...tr.cells].some(c => c.colSpan > 1) || TOTAL_ROW.test((tr.cells[0]?.textContent || '').trim()) || /(^|\s)(sum|total|month-sum|rc-group)(\s|$)/.test(tr.className);
function sortableTable(table) {
  const body = table?.tBodies?.[0];
  if (!body || table.hasAttribute('data-no-sort') || !table.tHead?.rows[0]) return false;
  if (body.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea, [rowspan], tr[data-rc-of]')) return false;
  return [...body.rows].filter(tr => !auxRow(tr)).length > 1;
}
function sortKey(td) {
  const t = (td?.textContent || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(-?[\d,]+(?:\.\d+)?)\s*(?:원|%|[A-Za-z]{1,6}|[가-힣]{1,3})?$/);
  return m ? { n: Number(m[1].replace(/,/g, '')) } : { s: t };
}
document.addEventListener('click', event => {
  const th = event.target.closest('table.grid > thead > tr > th');
  if (!th || grNoClick || event.target.closest('input, button, a, select, .gr-rz') || !th.textContent.trim()) return;
  const table = th.closest('table'); if (!sortableTable(table)) return;
  const body = table.tBodies[0], all = [...body.rows];
  all.forEach((tr, k) => { if (tr.dataset.orig === undefined) tr.dataset.orig = String(k); });
  const index = [...th.parentElement.cells].indexOf(th), now = th.getAttribute('aria-sort');
  const next = now === 'ascending' ? 'descending' : now === 'descending' ? '' : 'ascending';
  [...th.parentElement.cells].forEach(c => c.removeAttribute('aria-sort'));
  if (!next) { // 세 번째 누름: 원래 순서·소계 줄 되돌림
    all.sort((a, b) => Number(a.dataset.orig) - Number(b.dataset.orig)).forEach(tr => { tr.classList.remove('sort-aux-hidden'); body.append(tr); });
    return;
  }
  th.setAttribute('aria-sort', next);
  const data = all.filter(tr => !auxRow(tr)), aux = all.filter(auxRow), grand = aux.filter(tr => TOTAL_ROW.test((tr.cells[0]?.textContent || '').trim())).at(-1);
  const asc = next === 'ascending';
  data.sort((a, b) => {
    const x = sortKey(a.cells[index]), y = sortKey(b.cells[index]);
    const empty = v => v.s === '' ? 1 : 0; if (empty(x) !== empty(y)) return empty(x) - empty(y); // 빈 칸은 늘 아래
    const c = x.n !== undefined && y.n !== undefined ? x.n - y.n : String(x.s ?? x.n).localeCompare(String(y.s ?? y.n), 'ko', { numeric: true });
    return (asc ? c : -c) || Number(a.dataset.orig) - Number(b.dataset.orig);
  });
  data.forEach(tr => body.append(tr));
  aux.forEach(tr => { tr.classList.toggle('sort-aux-hidden', tr !== grand); body.append(tr); });
  if (grand) body.append(grand);
});
// 15.158 엑셀식 필터: 정렬되는 목록 표(table.grid) 머리글마다 깔때기 버튼 → 값 목록(검색·모두 선택·건수)에서 고르면 그 값의 줄만 보인다.
// 여러 칸은 AND로 겹치고, 값 목록은 다른 칸 필터를 통과한 줄에서 만든다(엑셀과 같음). 필터 중에는 소계·합계 줄을 숨긴다(필터 전 금액이라).
// 표를 다시 그리면(조회) 필터는 풀린다. 값은 칸에 보이는 글자 그대로 비교한다.
const XF = new WeakMap();
const xfText = td => (td?.textContent || '').replace(/\s+/g, ' ').trim();
const XF_EMPTY = '(빈 칸)';
const XF_ICON = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M2 3h12l-4.6 5.4V13l-2.8-1.4V8.4z" fill="currentColor"/></svg>';
function xfAttach(table) {
  if (table.dataset.xf || table.hasAttribute('data-no-filter')) return;
  const ths = [...(table.tHead?.rows[0]?.cells || [])];
  if (!ths.length || table.tHead.rows.length > 1 || ths.some(th => th.colSpan > 1)) return; // 머리글이 두 줄이거나 칸을 합친 표는 칸 번호가 어긋나 뺀다
  table.dataset.xf = '1';
  ths.forEach((th, i) => {
    const name = th.textContent.trim();
    if (!name || th.querySelector('input, select')) return;
    th.classList.add('xf-th');
    th.insertAdjacentHTML('beforeend', `<button type="button" class="xf-btn" data-xf-col="${i}" aria-label="${esc(name)} 필터" title="필터 · 정렬" aria-haspopup="dialog">${XF_ICON}</button>`);
  });
}
const xfRows = table => [...(table.tBodies[0]?.rows || [])].filter(tr => !auxRow(tr));
function xfApply(table) {
  const st = XF.get(table) || new Map();
  const rows = xfRows(table), aux = [...(table.tBodies[0]?.rows || [])].filter(auxRow);
  let shown = 0;
  for (const tr of rows) {
    const ok = [...st].every(([i, set]) => set.has(xfText(tr.cells[i]) || XF_EMPTY));
    tr.classList.toggle('xf-hide', !ok); if (ok) shown++;
  }
  aux.forEach(tr => tr.classList.toggle('xf-hide', st.size > 0));
  $$('.xf-btn', table.tHead).forEach(b => { const on = st.has(Number(b.dataset.xfCol)); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  // 표 위 상태 줄: 필터 n개 · 표시 x/y행 · 모두 지우기
  const host = table.closest('.table-wrap') || table; let bar = host.previousElementSibling?.classList.contains('xf-bar') ? host.previousElementSibling : null;
  if (!st.size) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.className = 'xf-bar'; bar.setAttribute('role', 'status'); host.insertAdjacentElement('beforebegin', bar); }
  const names = [...st.keys()].map(i => table.tHead.rows[0].cells[i]?.textContent.trim()).filter(Boolean);
  bar.innerHTML = `<span class="xf-chip">${XF_ICON} 필터 ${st.size}개</span><span>${esc(names.join(' · '))}</span><span class="muted">${fmtNum(shown)} / ${fmtNum(rows.length)}행 표시${aux.length ? ' · 소계·합계 줄은 필터 중 숨김' : ''}</span><button type="button" class="link-btn small" data-xf-clear>필터 모두 지우기</button>`;
  bar.querySelector('[data-xf-clear]').onclick = () => { XF.delete(table); xfApply(table); };
}
function xfClose() { $('.xf-pop')?.remove(); document.removeEventListener('keydown', xfKey, true); document.removeEventListener('mousedown', xfOutside, true); }
function xfKey(e) { if (e.key === 'Escape') { e.stopPropagation(); const b = $('.xf-pop')?.xfButton; xfClose(); b?.focus(); } }
function xfOutside(e) { const p = $('.xf-pop'); if (p && !p.contains(e.target) && !e.target.closest('.xf-btn')) xfClose(); }
function xfOpen(btn) {
  const same = $('.xf-pop')?.xfButton === btn; xfClose(); if (same) return;
  const table = btn.closest('table'), col = Number(btn.dataset.xfCol), st = XF.get(table) || new Map(), cur = st.get(col);
  // 값 목록: 이 칸을 뺀 나머지 필터를 통과한 줄에서
  const counts = new Map();
  for (const tr of xfRows(table)) {
    if (![...st].every(([i, set]) => i === col || set.has(xfText(tr.cells[i]) || XF_EMPTY))) continue;
    const v = xfText(tr.cells[col]) || XF_EMPTY; counts.set(v, (counts.get(v) || 0) + 1);
  }
  const vals = [...counts.keys()].sort((a, b) => { if (a === XF_EMPTY) return 1; if (b === XF_EMPTY) return -1; const x = sortKey({ textContent: a }), y = sortKey({ textContent: b }); return x.n !== undefined && y.n !== undefined ? x.n - y.n : a.localeCompare(b, 'ko', { numeric: true }); });
  const LIMIT = 1000, name = table.tHead.rows[0].cells[col].textContent.trim();
  const pop = document.createElement('div'); pop.className = 'xf-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', `${name} 필터`); pop.xfButton = btn;
  pop.innerHTML = `<div class="xf-head"><b>${esc(name)}</b></div>
    <div class="xf-sorts"><button type="button" class="btn small" data-xf-sort="ascending">↑ 오름차순</button><button type="button" class="btn small" data-xf-sort="descending">↓ 내림차순</button></div>
    <input type="search" class="xf-search" placeholder="값 검색" aria-label="${esc(name)} 값 검색">
    <label class="xf-item xf-all"><input type="checkbox" data-xf-all> <span>(모두 선택)</span></label>
    <div class="xf-list">${vals.slice(0, LIMIT).map(v => `<label class="xf-item"><input type="checkbox" value="${esc(v)}" ${!cur || cur.has(v) ? 'checked' : ''}> <span class="xf-v">${esc(v)}</span><span class="xf-n">${fmtNum(counts.get(v))}</span></label>`).join('')}${vals.length > LIMIT ? `<p class="small muted">${esc(`값이 많아 앞 ${LIMIT}개만 보입니다. 검색으로 좁히세요.`)}</p>` : ''}</div>
    <div class="xf-actions"><button type="button" class="btn small" data-xf-reset ${cur ? '' : 'disabled'}>이 칸 필터 지우기</button><span class="grow"></span><button type="button" class="btn small" data-xf-cancel>취소</button><button type="button" class="btn small primary" data-xf-ok>확인</button></div>`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
  pop.style.top = `${r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  const boxes = () => $$('.xf-list input', pop).filter(b => !b.closest('.xf-item').hidden), all = $('[data-xf-all]', pop), ok = $('[data-xf-ok]', pop);
  const syncAll = () => { const b = boxes(), n = b.filter(x => x.checked).length; all.checked = n === b.length && n > 0; all.indeterminate = n > 0 && n < b.length; ok.disabled = !$$('.xf-list input:checked', pop).length; };
  $('.xf-search', pop).addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('.xf-list .xf-item', pop).forEach(l => { l.hidden = !!q && !l.querySelector('.xf-v').textContent.toLowerCase().includes(q); });
    if (q) $$('.xf-list input', pop).forEach(b => { b.checked = !b.closest('.xf-item').hidden; }); // 검색하면 맞는 값만 고른 상태로(엑셀과 같음)
    syncAll();
  });
  all.onchange = () => { boxes().forEach(b => { b.checked = all.checked; }); syncAll(); };
  $('.xf-list', pop).addEventListener('change', syncAll);
  const apply = () => {
    const picked = new Set($$('.xf-list input:checked', pop).map(b => b.value));
    const s = XF.get(table) || new Map();
    if (picked.size === vals.length && !$('.xf-search', pop).value.trim()) s.delete(col); else s.set(col, picked);
    s.size ? XF.set(table, s) : XF.delete(table); xfClose(); xfApply(table); btn.focus();
  };
  ok.onclick = apply;
  $('[data-xf-cancel]', pop).onclick = () => { xfClose(); btn.focus(); };
  $('[data-xf-reset]', pop).onclick = () => { const s = XF.get(table); s?.delete(col); if (s && !s.size) XF.delete(table); xfClose(); xfApply(table); btn.focus(); };
  $$('[data-xf-sort]', pop).forEach(b => b.onclick = () => {
    const th = table.tHead.rows[0].cells[col]; xfClose();
    // 기존 머리글 정렬(오름 → 내림 → 원래)을 원하는 방향이 될 때까지 누른다
    for (let k = 0; k < 3 && th.getAttribute('aria-sort') !== b.dataset.xfSort; k++) th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  pop.addEventListener('keydown', e => { if (e.key === 'Enter' && !ok.disabled && !e.target.matches('button')) { e.preventDefault(); apply(); } });
  syncAll(); $('.xf-search', pop).focus();
  document.addEventListener('keydown', xfKey, true); document.addEventListener('mousedown', xfOutside, true);
}
document.addEventListener('click', e => { const b = e.target.closest('.xf-btn'); if (b) { e.preventDefault(); xfOpen(b); } });
window.addEventListener('hashchange', xfClose);
// 2) 입력 화면 아래 저장 줄 왼쪽에 「리스트」(같은 하위 메뉴의 목록 화면)와 「다시 작성」(입력과 보관 초안을 지우고 새로)
function listRouteFor(route) {
  const subs = []; const walk = items => items.forEach(i => { if (!Array.isArray(i) && i.items) { subs.push(i.items); walk(i.items); } });
  NAV.forEach(g => walk(g.items));
  for (const items of subs) {
    const links = items.filter(Array.isArray).map(i => i[0]); if (!links.includes(route)) continue;
    const others = items.filter(i => Array.isArray(i) && i[0] !== route && !i[0].endsWith('/new'));
    return (others.find(i => /목록|리스트/.test(i[1])) || others[0])?.[0] || null;
  }
  return route.endsWith('/new') && PAGES[route.slice(0, -4)] ? route.slice(0, -4) : null;
}
function erpEntryBar(main, route) {
  const bar = [...main.querySelectorAll('form:not(.list-filters):not([data-read-only]) > .actions:last-child')].find(a => a.querySelector(':scope > .btn.primary:not([type=button])') && a.offsetParent !== null);
  if (!bar || bar.querySelector('.erp-bar-left')) return;
  const list = listRouteFor(route.split('?')[0]);
  const left = document.createElement('span'); left.className = 'erp-bar-left';
  left.innerHTML = `<button type="button" class="btn" data-erp-reset>다시 작성</button>${list ? `<a class="btn" href="${list}" data-erp-list>리스트</a>` : ''}`;
  bar.prepend(left);
  left.querySelector('[data-erp-reset]').onclick = async () => {
    if (!(await confirmBox('입력한 내용을 모두 지우고 처음부터 다시 작성할까요?'))) return;
    for (const draft of uxDrafts) if (draft.form.isConnected) draft.clear('');
    render();
  };
}

// ── 휴대폰 하단 탭(15.62): 할 일 · 자주 쓰는 화면 ──
async function pageTasks(main) {
  const [tasks, alerts] = await Promise.all([api('GET', '/api/my-tasks'), api('GET', '/api/alerts').catch(() => null)]);
  main.innerHTML = `<h1>할 일</h1><div class="dash-top">${tasksCard(tasks)}${alertsCard(alerts)}</div>`;
}
const RECENT_LIMIT = 8;
const recentKey = () => 'wpa:recent:' + (ME ? ME.id : '');
function readRecent() { try { const v = JSON.parse(localStorage.getItem(recentKey()) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
const screenTitle = main => { const h = $('h1', main); if (!h) return ''; const c = h.cloneNode(true); c.querySelectorAll('.dept, .view-switch, .fav-toggle, button, a').forEach(x => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim().slice(0, 40); };
const FAVORITE_SKIP = ['#/', '#/tasks', '#/favorites', '#/me'];
// 화면 제목 옆 ☆(자주 쓰는 화면에 추가)과 최근 연 화면 기록. 자주 쓰는 화면은 서버(내 설정)에 저장해 다른 기기에서도 보인다.
function favoriteTools(main, route) {
  const path = String(route || '#/').split('?')[0], title = screenTitle(main);
  if (!title || FAVORITE_SKIP.includes(path) || !PAGES[path]) return;
  try { const list = readRecent().filter(r => r.href !== path); list.unshift({ href: path, label: title }); localStorage.setItem(recentKey(), JSON.stringify(list.slice(0, RECENT_LIMIT))); } catch { /* 최근 화면은 편의 기능 */ }
  const h1 = $('h1', main); if (!h1 || $('.fav-toggle', h1)) return;
  const favs = () => (ME.ui && ME.ui.favorites) || [];
  const button = document.createElement('button'); button.type = 'button'; button.className = 'fav-toggle';
  const paint = () => { const on = favs().some(f => f.href === path); button.textContent = on ? '★' : '☆'; button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', on ? '자주 쓰는 화면에서 빼기' : '자주 쓰는 화면에 추가'); button.title = button.getAttribute('aria-label'); };
  paint(); h1.insertBefore(button, h1.querySelector('.dept, .view-switch') || null); // 제목 글자 바로 뒤(부서 표시·전환 버튼 앞)
  button.onclick = async () => {
    const on = favs().some(f => f.href === path);
    const next = on ? favs().filter(f => f.href !== path) : [...favs(), { href: path, label: title }].slice(-20);
    try { ME.ui = await api('PUT', '/api/me/prefs', { favorites: next }); paint(); refreshFavNav(); toast(on ? '마이메뉴에서 뺐습니다.' : '마이메뉴에 추가했습니다(메뉴 맨 위 ★ 마이메뉴).'); } catch (error) { fail(error); }
  };
}
document.addEventListener('click', async e => {
  const st = e.target.closest('[data-fav-star]'); if (!st) return;
  e.preventDefault(); e.stopPropagation();
  const href = st.dataset.favStar, label = st.dataset.favLabel, cur = (ME.ui && ME.ui.favorites) || [], on = cur.some(f => f.href === href);
  const next = on ? cur.filter(f => f.href !== href) : [...cur, { href, label }].slice(-20);
  try {
    ME.ui = await api('PUT', '/api/me/prefs', { favorites: next }); refreshFavNav();
    const tg = $('h1 .fav-toggle'); if (tg && (location.hash || '#/').split('?')[0] === href) { tg.textContent = on ? '☆' : '★'; tg.setAttribute('aria-pressed', String(!on)); }
    toast(on ? `${label}: 마이메뉴에서 뺐습니다.` : `${label}: 마이메뉴에 추가했습니다.`);
  } catch (error) { fail(error); }
}, true);
async function pageFavorites(main) {
  const favs = ((ME.ui && ME.ui.favorites) || []).filter(f => canSeeRoute(f.href));
  const recent = readRecent().filter(r => canSeeRoute(r.href) && !favs.some(f => f.href === r.href));
  const list = (items, empty, removable) => items.length ? `<ul class="fav-list">${items.map((f, i) => `<li><a href="${esc(f.href)}">${esc(f.label)}</a>${removable ? `<button type="button" class="btn small" data-fav-del="${i}" aria-label="${esc(f.label)} 빼기">빼기</button>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`;
  main.innerHTML = `<h1>자주 쓰는 화면</h1>
    <section class="card"><h2>★ 고정한 화면</h2>${list(favs, '아직 없습니다. 화면 제목 옆 ☆를 누르면 여기에 고정됩니다.', true)}</section>
    <section class="card"><h2>최근 연 화면</h2>${list(recent, '최근 연 화면이 없습니다.', false)}</section>`;
  $$('[data-fav-del]', main).forEach(b => b.onclick = async () => {
    const target = favs[Number(b.dataset.favDel)];
    try { ME.ui = await api('PUT', '/api/me/prefs', { favorites: (ME.ui.favorites || []).filter(f => f.href !== target.href) }); refreshFavNav(); pageFavorites(main); } catch (error) { fail(error); }
  });
}
function pageNoMenu(main) {
  const label = (MENU_GROUP_LABELS.find(([key]) => key === routeMenu(location.hash)) || [, ''])[1];
  if (!canUseRoute(location.hash)) { const need = { sales: '영업', purchase: '구매' }; main.innerHTML = `<h1>사용 권한이 없습니다</h1><div class="card"><p>이 화면은 <b>${esc(routeRoles(location.hash).map(r => need[r] || r).join(' 또는 '))}</b> 사용 권한이 있어야 쓸 수 있습니다. 필요하면 관리자에게 「회원 관리 › 사용 권한」에서 권한을 요청하세요.</p><div class="actions" style="justify-content:flex-start"><a class="btn primary" href="#/">홈으로</a></div></div>`; return; } // 15.179
  main.innerHTML = `<h1>열람 권한이 없습니다</h1><div class="card"><p>${esc(label)} 메뉴는 열람 권한이 없습니다. 필요하면 관리자에게 메뉴 권한을 요청하세요.</p><div class="actions" style="justify-content:flex-start"><a class="btn primary" href="#/">대시보드로</a></div></div>`;
}
// 메뉴 열람 설정 입력(부서 기본·사용자 직접 지정에서 같이 쓴다).
function menuChecks(selected) {
  return `<fieldset class="menu-checks"><legend>보이는 메뉴</legend><p class="small muted">홈·리포트는 항상 보입니다.</p>${MENU_GROUP_LABELS.map(([key, label]) => `<label class="inline"><input type="checkbox" name="menus" value="${key}"${!selected || selected.includes(key) ? ' checked' : ''}> ${label}</label>`).join('')}</fieldset>`;
}
const menuSummary = list => !list ? '전체' : list.length ? list.map(key => (MENU_GROUP_LABELS.find(([k]) => k === key) || [, key])[1].replace(/ \(.*\)$/, '')).join(' · ') : '홈만';

// ───────────── 로그인 / 가입 ─────────────
function pageAuth(mode = 'login', notice = '') {
  document.body.classList.remove('operator-mode');
  $('#app').innerHTML = `
  <div class="auth">
    <div class="auth-card">
      <div class="brand big"><img class="brand-logo" src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"></div>
      <p class="muted" lang="en">Spotless and Safe, through Technology</p>
      <p class="app-version">버전 ${APP_VERSION}</p>
      <div class="tabs"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">로그인</button><button data-m="register" class="${mode === 'register' ? 'on' : ''}">가입</button></div>
      <p id="authNotice" role="status" class="muted">${esc(notice)}</p>
      <form class="stack" id="authForm">
        <label>이름<input name="name" autocomplete="username" required maxlength="30" placeholder="예) 홍길동"></label>
        <label>비밀번호<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="4"></label>
        ${mode === 'register' ? '<div class="stack" data-org-fields></div><label>초대코드<input name="invite" required placeholder="관리자에게 받은 초대코드"></label>' : ''}
        <button class="btn primary block">${mode === 'login' ? '로그인' : '가입하기'}</button>
      </form>
      ${mode === 'register' ? '<p class="muted small">가입 신청 후 관리자 승인이 필요합니다. 첫 계정만 자동으로 관리자가 됩니다.</p>' : ''}
    </div>
  </div>`;
  $$('.tabs button').forEach((b) => (b.onclick = () => pageAuth(b.dataset.m)));
  // 가입: 조직 구성의 부서·직급 목록에서 고른다(목록이 비어 있으면 칸을 두지 않는다).
  if (mode === 'register') api('GET', '/api/org').then(lists => { const host = $('[data-org-fields]'); if (host && (lists.departments.length || lists.positions.length)) host.innerHTML = orgFields(lists, {}, { required: true }); }).catch(() => {});
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('POST', mode === 'login' ? '/api/auth/login' : '/api/auth/register', formObj(e.target)); if (r.pending) { pageAuth('login', '가입 신청이 완료되었습니다. 관리자 승인 후 로그인해 주세요.'); return; } ME = r.user; if (!location.hash) location.hash = '#/'; render(); }
    catch (err) { $('#authNotice').textContent = err.message; fail(err); }
  };
}

// ───────────── 홈: 대시보드 + 업무흐름 ─────────────
// ── 확인이 필요한 일: 기한 경과, 오래된 승인 대기, 수율 미달, 백업 ──
function alertsCard(a) {
  if (!a) return '';
  const items = []; const more = (count, shown) => count > shown ? ` <span class="small muted">외 ${count - shown}건</span>` : '';
  if (a.overdue_po_count) items.push(`<li><a href="#/logistics/receive"><b>납기가 지난 미입고 발주 ${a.overdue_po_count}건</b></a><ul class="alert-lines small muted">${a.overdue_pos.slice(0, 5).map(p => `<li>${esc(p.due_date)} · ${esc(p.vendor)} · ${esc(p.item)}${p.spec ? ' ' + esc(p.spec) : ''}</li>`).join('')}</ul><div class="small muted">${more(a.overdue_po_count, a.overdue_pos.length)}</div></li>`);
  if (a.overdue_request_count) items.push(`<li><b>완료 희망일이 지난 의뢰 ${a.overdue_request_count}건</b><div class="small muted">${a.overdue_requests.map(r => `<a href="${REQ[r.type] ? (r.status === 'pending' ? REQ[r.type].intake : REQ[r.type].list) : '#/'}">${esc(r.due_date)} ${esc(REQ[r.type]?.label || r.type)} · ${esc(r.title)} (${esc(STATUS[r.status] || r.status)})</a>`).join(' / ')}${more(a.overdue_request_count, a.overdue_requests.length)}</div></li>`);
  const staleLabel = s => s.kind === 'request' ? [`${REQ[s.type]?.label || s.type} 승인`, REQ[s.type]?.approve || REQ[s.type]?.intake || '#/'] : { actual_changes: ['생산실적 수정 승인', '#/prod/finished'], receipt_changes: ['입고 수량 수정 승인', '#/logistics/receive'], semi_changes: ['반제품 기록 수정 승인', '#/prod/semi/cut'] }[s.kind];
  for (const s of a.stale_approvals) { const [label, href] = staleLabel(s); items.push(`<li><a href="${href}"><b>${esc(label)} 대기 3일 초과 ${s.count}건</b></a><div class="small muted">가장 오래된 요청 ${esc(String(s.oldest).slice(0, 10))}</div></li>`); }
  if (a.low_yield.length) items.push(`<li><a href="#/reports"><b>최근 7일 수율 목표 미달 ${a.low_yield.length}곳</b></a><div class="small muted">${a.low_yield.slice(0, 5).map(r => `${esc(r.unit_name)}(${r.process === 'cut' ? '커팅/융착' : '세탁'}) <span class="red-text">${r.yield_rate}%</span> / 목표 ${r.target}%`).join(' · ')}</div></li>`);
  if (a.backup && (a.backup.days === null || a.backup.days >= 7)) items.push(`<li><a href="#/admin"><b>${a.backup.days === null ? '전체 백업을 아직 받지 않았습니다' : `마지막 전체 백업이 ${a.backup.days}일 전입니다`}</b></a><div class="small muted">관리자 설정 → 전체 백업 다운로드 (주 1회 이상 권장)</div></li>`);
  if (!items.length) return '';
  return `<section class="card tasks alerts" aria-labelledby="dashAlerts"><h2 id="dashAlerts">확인이 필요한 일 <span class="chip red">${items.length}</span></h2><ul>${items.join('')}</ul></section>`;
}
// 단위 입력칸 자동완성: 원단은 yd, 와이퍼는 매, 글러브는 켤레가 많습니다. 직접 입력도 됩니다.
const UNIT_SUGGESTIONS = ['yd', '매', '켤레', 'EA', 'BOX', 'kg', '롤', 'm', '벌'];
function suggestUnits() {
  if (!document.getElementById('unitSuggestions')) document.body.insertAdjacentHTML('beforeend', `<datalist id="unitSuggestions">${UNIT_SUGGESTIONS.map(unit => `<option value="${unit}">`).join('')}</datalist>`);
  $$('input[name=unit]:not([list]), input[data-line-key=unit]:not([list]), input[data-k=unit]:not([list]), input[data-material-unit]:not([list])').forEach(input => { input.setAttribute('list', 'unitSuggestions'); if (/EA \/ BOX|매 \/ 켤레/.test(input.placeholder)) input.placeholder = '예) yd / 매 / 켤레 / EA'; });
}
new MutationObserver(suggestUnits).observe(document.body, { childList: true, subtree: true });

// ── 내가 처리할 일: 승인 대기 배지와 대시보드 카드 ──
// 하단 탭 「할 일」 배지: 내가 처리할 승인·접수 대기 건수 합(메뉴 권한으로 숨긴 업무는 뺀다).
function taskTotal(tasks) {
  const a = tasks.approvals; let n = 0;
  const add = (count, route) => { if (count && canSeeRoute(route)) n += count; };
  for (const [type, group] of Object.entries(a.requests)) add(group.count, REQ[type].approve || REQ[type].intake);
  add(a.actual_changes?.count, '#/prod/finished'); add(a.receipt_changes?.count, '#/logistics/receive'); add(a.semi_changes?.count, '#/prod/semi');
  add(a.plans_waiting?.count, '#/prod/finished/plan'); add(a.production_requests?.count, '#/prod/orders'); add(a.purchase_requests?.count, '#/sales/pr'); add(a.purchase_orders_waiting?.count, '#/purchase/po/new');
  return n;
}
function taskBadgeCounts(tasks) {
  const counts = {}; const a = tasks.approvals;
  for (const [type, group] of Object.entries(a.requests)) if (group.count) counts[REQ[type].approve || REQ[type].intake] = group.count;
  if (a.actual_changes?.finished) counts['#/prod/finished'] = a.actual_changes.finished;
  if (a.actual_changes?.semi) counts['#/prod/semi'] = a.actual_changes.semi;
  if (a.receipt_changes?.count) counts['#/logistics/receive'] = a.receipt_changes.count;
  if (a.semi_changes?.cut) counts['#/prod/semi/cut'] = a.semi_changes.cut;
  if (a.semi_changes?.wash) counts['#/prod/semi/wash'] = a.semi_changes.wash;
  if (a.temp_items?.count) counts['#/admin/bom'] = a.temp_items.count;
  if (a.purchase_requests?.count) counts['#/sales/pr'] = a.purchase_requests.count;
  if (a.purchase_orders_waiting?.count) counts['#/purchase/po/new'] = a.purchase_orders_waiting.count;
  if (a.production_requests?.count) counts['#/prod/orders'] = a.production_requests.count;
  if (a.plans_waiting?.count) counts['#/prod/finished/plan'] = a.plans_waiting.count; // 15.204 확정 대기
  if (a.ship_instructions?.count) counts['#/logistics/ship-orders'] = a.ship_instructions.count;
  return counts;
}
async function refreshNavBadges() {
  try {
    const tasks = await api('GET', '/api/my-tasks'), counts = taskBadgeCounts(tasks);
    const total = taskTotal(tasks), badge = $('[data-task-badge]');
    if (badge) { badge.hidden = !total; badge.textContent = total > 99 ? '99+' : String(total); }
    $$('.side a').forEach(link => {
      $('.nav-badge', link)?.remove();
      const n = counts[link.getAttribute('href')];
      if (n) link.insertAdjacentHTML('beforeend', ` <span class="nav-badge" title="내가 승인할 대기 ${n}건">${n}</span>`);
    });
    $$('.side .nav-sub').forEach(sub => {
      const summary = $('summary', sub); $('.nav-badge', summary)?.remove();
      const n = $$('a', sub).reduce((sum, a) => sum + (counts[a.getAttribute('href')] || 0), 0);
      if (n) summary.insertAdjacentHTML('beforeend', ` <span class="nav-badge">${n}</span>`);
    });
  } catch { /* badges are a convenience; the pages still work without them */ }
}
function tasksCard(tasks) {
  const a = tasks.approvals, m = tasks.mine; const todo = [], mine = [];
  const more = (count, shown) => count > shown ? ` <span class="small muted">외 ${count - shown}건</span>` : '';
  for (const [type, group] of Object.entries(a.requests)) if (group.count) todo.push(`<li><a href="${REQ[type].approve || REQ[type].intake}"><b>${esc(REQ[type].label)} 승인 대기 ${group.count}건</b></a><div class="small muted">${group.items.map(r => `${esc(r.title)} · ${esc(r.requester_name)}`).join(' / ')}${more(group.count, group.items.length)}</div></li>`);
  if (a.actual_changes?.count) todo.push(`<li><a href="${a.actual_changes.finished ? '#/prod/finished' : '#/prod/semi'}"><b>생산실적 수정·취소 승인 대기 ${a.actual_changes.count}건</b></a><div class="small muted">${a.actual_changes.items.map(c => `${esc(c.product)} ${changeSummary(c)} · ${esc(c.requested_by)}`).join(' / ')}${more(a.actual_changes.count, a.actual_changes.items.length)}</div></li>`);
  if (a.receipt_changes?.count) todo.push(`<li><a href="#/logistics/receive"><b>입고 수량 수정·취소 승인 대기 ${a.receipt_changes.count}건</b></a><div class="small muted">${a.receipt_changes.items.map(c => `${esc(c.item)} ${receiptChangeText(c)} · ${esc(c.requested_by)}`).join(' / ')}${more(a.receipt_changes.count, a.receipt_changes.items.length)}</div></li>`);
  if (a.semi_changes?.count) todo.push(`<li><a href="${a.semi_changes.cut ? '#/prod/semi/cut' : '#/prod/semi/wash'}"><b>반제품 기록 수정·삭제 승인 대기 ${a.semi_changes.count}건</b></a><div class="small muted">${a.semi_changes.items.map(c => `${semiChangeText(c)} · ${esc(c.requested_by)}`).join(' / ')}${more(a.semi_changes.count, a.semi_changes.items.length)}</div></li>`);
  if (a.plans_waiting?.count) todo.push(`<li><a href="#/prod/finished/plan"><b>완제품 계획 확정 대기 ${a.plans_waiting.count}건</b></a><div class="small muted">계획생산 접수·관리에서 확정해야 실적 입력에 나옵니다.${a.plans_waiting.first ? ` 가장 이른 계획 ${esc(a.plans_waiting.first)}` : ''}</div></li>`);
  if (a.production_requests?.count) todo.push(`<li><a href="#/prod/orders"><b>생산의뢰 접수 대기 ${a.production_requests.count}건</b></a><div class="small muted">${a.production_requests.items.map(r => `<button type="button" class="link-btn" data-open-mr="${r.id}">${esc(r.req_no)}</button> ${esc(r.customer)}${r.ship_text || r.ship_date ? ' · 출고 ' + esc(r.ship_text || r.ship_date) : ''}`).join(' / ')}${more(a.production_requests.count, a.production_requests.items.length)}</div></li>`);
  if (a.purchase_requests?.count) todo.push(`<li><a href="#/sales/pr"><b>구매의뢰 결재 차례 ${a.purchase_requests.count}건</b></a><div class="small muted">${a.purchase_requests.items.map(r => `<button type="button" class="link-btn" data-task-pr="${r.id}">${esc(r.doc_no)}</button> ${esc(r.title || r.first_item || '')}${r.item_count > 1 ? ` 외 ${r.item_count - 1}건` : ''} · ${esc(r.author_name)}`).join(' / ')}${more(a.purchase_requests.count, a.purchase_requests.items.length)}</div></li>`);
  if (a.purchase_orders_waiting?.count) todo.push(`<li><a href="#/purchase/po/new"><b>발주 대기 구매의뢰 ${a.purchase_orders_waiting.count}건</b></a><div class="small muted">${a.purchase_orders_waiting.items.map(r => `<button type="button" class="link-btn" data-task-pr="${r.id}">${esc(r.doc_no)}</button> ${esc(r.title || r.first_item || '')} · ${esc(r.author_name)}`).join(' / ')}${more(a.purchase_orders_waiting.count, a.purchase_orders_waiting.items.length)}</div></li>`);
  if (a.temp_items?.count) todo.push(`<li><a href="#/admin/bom"><b>임시 제품코드 정리 ${a.temp_items.count}건</b></a><div class="small muted">직접 입력된 품목에 정식 코드를 주거나 기존 품목으로 합치세요.</div></li>`);
  const state = c => `<span class="chip ${c.status === 'rejected' ? 'red' : 'yellow'}">${c.status === 'rejected' ? '반려' : '승인 대기'}</span>`;
  for (const r of m.requests) mine.push(`<li>${state(r)} <a href="${REQ[r.type].intake}">${esc(REQ[r.type].label)} · ${esc(r.title)}</a>${r.status === 'rejected' ? `<div class="small red-text">반려 사유: ${esc(r.reject_reason)} (${esc(r.approver_name || '')}) · 수정하면 다시 접수됩니다.</div>` : ''}</li>`);
  for (const c of m.actual_changes) mine.push(`<li>${state(c)} <a href="${c.kind === 'semi' ? '#/prod/semi' : '#/prod/finished'}">생산실적 · ${esc(c.product)}</a> <span class="small">${changeSummary(c)}</span>${c.status === 'rejected' ? `<div class="small red-text">반려 사유: ${esc(c.review_note)} (${esc(c.reviewed_by || '')})</div>` : ''}</li>`);
  for (const c of m.semi_changes || []) mine.push(`<li>${state(c)} <a href="${c.process === 'wash' ? '#/prod/semi/wash' : '#/prod/semi/cut'}">반제품 기록</a> <span class="small">${semiChangeText(c)}</span>${c.status === 'rejected' ? `<div class="small red-text">반려 사유: ${esc(c.review_note)} (${esc(c.reviewed_by || '')})</div>` : ''}</li>`);
  for (const r of m.purchase_requests || []) mine.push(`<li>${state(r)} <a href="#/sales/pr">구매의뢰 · ${esc(r.doc_no)} ${esc(r.title || r.first_item || '')}</a>${r.status === 'pending' && r.current_user_name ? ` <span class="small muted">${esc(r.current_user_name)} 결재 차례</span>` : ''}${r.status === 'rejected' ? `<div class="small red-text">반려 사유: ${esc(r.reject_reason)} (${esc(r.rejected_by || '')}) · 고쳐서 다시 상신하세요.</div>` : ''}</li>`);
  for (const c of m.receipt_changes) mine.push(`<li>${state(c)} <a href="#/logistics/receive">입고 · ${esc(c.item)}</a> <span class="small">${receiptChangeText(c)}</span>${c.status === 'rejected' ? `<div class="small red-text">반려 사유: ${esc(c.review_note)} (${esc(c.reviewed_by || '')})</div>` : ''}</li>`);
  const canApprove = Object.keys(a.requests).length || a.actual_changes || a.receipt_changes || a.semi_changes || a.temp_items || a.purchase_requests || a.production_requests || a.purchase_orders_waiting || a.plans_waiting;
  return `<section class="card tasks" aria-labelledby="dashTasks"><h2 id="dashTasks">내가 처리할 일</h2><div class="tasks-grid">
    ${canApprove ? `<section><h3>승인할 일 ${todo.length ? `<span class="chip yellow">${todo.length}</span>` : ''}</h3>${todo.length ? `<ul>${todo.join('')}</ul>` : '<p class="small muted">승인 대기 중인 건이 없습니다.</p>'}</section>` : ''}
    <section><h3>내가 올린 요청 ${mine.length ? `<span class="chip">${mine.length}</span>` : ''}</h3>${mine.length ? `<ul>${mine.join('')}</ul>` : '<p class="small muted">대기 중이거나 최근 반려된 요청이 없습니다.</p>'}</section>
  </div></section>`;
}

// 3) 좁은 화면에서는 표를 카드로 보여 주기 위해 각 칸에 머리글을 붙입니다 (CSS가 data-label을 사용).
// Phone cards show the main fields; the rest (memo, entered by, row buttons…) opens with 「자세히」. Long lists show 30 at a time.
const CARD_SECONDARY = new Set(['COA 요청', '비고', '메모', '입력자', '입고 처리자', '처리자', '사진·검수', 'LOT', '분류', '1차 분류', '2차 분류', '3차 분류', '입고', '생산', '사용', '출하', '조정', '안전재고', '최근 일자', '입력자 · 검사일', '입력자 / 입력시각', '수정', '사유', '거래처 · 담당', '시작', '종료', '작업시간', '인원', '불량 사유', '단가', '비용']);
const CENTER_HEADS = /^(.*일자|.*일|날짜|납기|만기|상태|처리구분|입고상태|구분|분류)$/; // 15.180 일자·상태 칸 가운데
const ITEM_HEADS = new Set(['품목', '품목명', '품명', '제품명', '제품', '자재명', '샘플명', '품명 · LOT']); // 15.177 최소 너비
const NOWRAP_HEADS = new Set(['코드', '품목코드', '제품코드', '전표번호', '구매의뢰번호', '수주번호', '발주번호', '입고번호', '출하번호', '접수번호', '어음번호', '계산서번호', '승인번호', '전표 일자', '명세서 일자', '수주일', '발주일', '만기일자', '발행일자', '분류', '거래처', '납기일', '입고일', '출고일', '작업일', '세탁일', '의뢰일', '상태', '입고상태', '수량', '발주수량', '실입고', '입력자', 'COA 요청', '단위', '현재고']);
// ── 15.173 표 열 너비·순서(엑셀처럼): 머리글 오른쪽 경계를 끌어 너비 조절(두 번 누르면 원래 너비),
// 머리글을 끌어 다른 머리글 위에 놓으면 열 순서 바꿈. 사용자·화면·표(머리글 이름)마다 이 브라우저에 저장, 「열 배치 초기화」로 되돌림.
// 순서 바꾸기는 입력칸·합친 칸·두 줄 머리글·합계 줄이 없는 표만(칸 번호로 읽는 코드 보호). 휴대폰 카드 모양에서는 쓰지 않음.
const grKey = table => { const names = [...table.tHead.rows[0].cells].map(c => c.textContent.trim()).filter(Boolean); return names.length ? `wpa:grid:${ME?.id || 0}:${navRoute(location.hash)}:${[...names].sort().join('|')}` : ''; };
const grRead = k => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const grWrite = (k, v) => { try { if (!v.order && !v.widths && !v.hidden) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 화면은 그대로 */ } };
const grName = th => [...th.childNodes].filter(n => n.nodeType === 3 || !n.matches?.('.xf-btn, .gr-rz')).map(n => n.textContent).join('').trim();
function grCanMove(table) {
  if (table.hasAttribute('data-no-reorder') || table.tHead.rows.length > 1) return false;
  if (table.querySelector('[colspan], [rowspan], tbody input:not([type=checkbox]), tbody select, tbody textarea')) return false;
  return ![...(table.tBodies[0]?.rows || [])].some(auxRow);
}
function grMove(table, order) { // order: 머리글 이름 순서. 이름 없는 칸(체크·단추)은 원래 자리 순서대로 남은 자리에
  const head = [...table.tHead.rows[0].cells], names = head.map(grName), n = head.length;
  const want = order.filter(x => names.includes(x)); if (want.length < 2) return;
  const named = names.map((x, i) => x && want.includes(x) ? i : -1).filter(i => i >= 0);
  const target = names.map((_, i) => i); const slots = [...named]; // 이름 있는 칸이 있던 자리에 원하는 순서로
  want.forEach((x, k) => { target[slots[k]] = names.indexOf(x); });
  if (target.every((v, i) => v === i)) return;
  for (const tr of table.rows) { if (tr.cells.length !== n) continue; const cells = [...tr.cells]; target.forEach(i => tr.appendChild(cells[i])); }
  $$('.xf-btn', table.tHead).forEach(b => { b.dataset.xfCol = String(b.closest('th').cellIndex); });
  if (typeof XF !== 'undefined' && XF.has(table)) { XF.delete(table); xfApply(table); }
}
function grWidths(table, widths, dragging = '') {
  const head = [...table.tHead.rows[0].cells];
  if (!widths || !Object.keys(widths).length) { table.classList.remove('gr-fixed'); table.style.width = ''; head.forEach(th => { th.style.width = ''; th.classList.remove('gr-flex'); }); return; }
  const shown = th => getComputedStyle(th).display !== 'none' && !th.classList.contains('gr-hidden'); // 숨긴 열은 너비 합에서 뺀다
  const cur = head.map(th => th.getBoundingClientRect().width);
  head.forEach((th, i) => { if (!shown(th)) { th.style.width = ''; return; } const w = widths[grName(th) || `#${i}`]; th.style.width = `${Math.max(40, Math.round(w || cur[i] || 80))}px`; });
  // 15.181 열을 줄여 표가 화면보다 좁아지면 오른쪽이 하얗게 비던 것: 늘어나는 열 하나(비고·메모 → 품목 → 마지막 이름 칸, 끌고 있는 열은 빼고)가 남는 폭을 채운다
  const named = head.filter(th => shown(th) && grName(th) && grName(th) !== dragging);
  const flex = named.find(th => /^(비고|메모|줄 비고)$/.test(grName(th))) || named.find(th => th.classList.contains('item-col')) || named.at(-1);
  head.forEach(th => th.classList.toggle('gr-flex', th === flex));
  table.classList.add('gr-fixed'); table.style.width = `${head.filter(shown).reduce((t, th) => t + parseFloat(th.style.width), 0)}px`;
}
// 15.180 ⚙ 열 설정: 표 오른쪽 위 작은 단추 → 보일 열 체크·열 배치 초기화(너비·순서·숨김). 저장은 열 너비·순서와 같은 곳.
function grReset(table) {
  const host = table.closest('.table-wrap'); if (!host || host.querySelector(':scope > .gr-gear')) return;
  host.classList.add('has-gear');
  host.insertAdjacentHTML('afterbegin', `<button type="button" class="gr-gear" title="열 설정(보일 열·초기화)" aria-label="열 설정">⚙</button>`);
  host.querySelector(':scope > .gr-gear').onclick = e => { e.stopPropagation(); grSettings(table, e.currentTarget); };
}
function grHide(table) {
  const k = table.dataset.grKey, hidden = new Set(grRead(k).hidden || []), head = [...table.tHead.rows[0].cells], n = head.length;
  const idx = head.map((th, i) => hidden.has(grName(th)) ? i : -1).filter(i => i >= 0);
  for (const tr of table.rows) { if (tr.cells.length !== n) continue; [...tr.cells].forEach((c, i) => c.classList.toggle('gr-hidden', idx.includes(i))); }
}
function grSettings(table, btn) {
  $('.gr-pop')?.remove(); const k = table.dataset.grKey, st = grRead(k), hidden = new Set(st.hidden || []);
  const names = [...table.tHead.rows[0].cells].map(grName).filter(Boolean);
  const pop = document.createElement('div'); pop.className = 'gr-pop xf-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '열 설정');
  pop.innerHTML = `<b>보일 열</b><div class="gr-cols">${names.map(n => `<label class="check"><input type="checkbox" value="${esc(n)}" ${hidden.has(n) ? '' : 'checked'}> ${esc(n)}</label>`).join('')}</div><div class="actions"><button type="button" class="btn small" data-gr-all>모두 보이기</button><button type="button" class="btn small" data-gr-reset>열 배치 초기화</button></div><p class="small muted">열 너비는 머리글 경계를 끌어서, 순서는 머리글을 끌어 놓아서 바꿉니다.</p>`;
  document.body.append(pop); const r = btn.getBoundingClientRect(); pop.style.top = `${r.bottom + scrollY + 4}px`; pop.style.left = `${Math.max(8, r.right + scrollX - pop.offsetWidth)}px`;
  const save = () => { const s = grRead(k), off = [...pop.querySelectorAll('input:not(:checked)')].map(x => x.value); if (off.length) s.hidden = off; else delete s.hidden; grWrite(k, s); grHide(table); };
  pop.addEventListener('change', save);
  pop.querySelector('[data-gr-all]').onclick = () => { pop.querySelectorAll('input').forEach(x => { x.checked = true; }); save(); };
  pop.querySelector('[data-gr-reset]').onclick = () => { grWrite(k, {}); pop.remove(); render(); };
  const close = e => { if (!pop.contains(e.target) && e.target !== btn) { pop.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { pop.remove(); btn.focus(); } });
  pop.querySelector('input')?.focus();
}
function gridLayout(table) {
  if (table.dataset.gr || table.hasAttribute('data-no-layout') || !table.tHead?.rows[0] || table.closest('.modal-wrap, .xf-pop')) return;
  const head = [...table.tHead.rows[0].cells]; if (head.length < 2 || head.some(c => c.colSpan > 1)) return;
  const k = grKey(table); if (!k) return; table.dataset.gr = '1'; table.dataset.grKey = k;
  const st = grRead(k), move = grCanMove(table);
  if (move && Array.isArray(st.order)) grMove(table, st.order);
  if (st.widths) grWidths(table, st.widths);
  if (st.hidden?.length) grHide(table); // 15.180 숨긴 열
  [...table.tHead.rows[0].cells].forEach((th, i) => {
    th.insertAdjacentHTML('beforeend', '<span class="gr-rz" aria-hidden="true" title="끌어서 너비 조절 · 두 번 누르면 원래대로"></span>');
    const name = grName(th);
    if (move && name) { th.draggable = true; th.classList.add('gr-drag'); }
  });
  grReset(table);
}
// 너비 조절(포인터 끌기)
let grNoClick = false;
document.addEventListener('pointerdown', e => {
  const rz = e.target.closest('.gr-rz'); if (!rz || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const th = rz.closest('th'), table = th.closest('table'), k = table.dataset.grKey; if (!k) return;
  const head = [...table.tHead.rows[0].cells], x0 = e.clientX;
  const widths = Object.fromEntries(head.map((c, i) => [grName(c) || `#${i}`, Math.round(c.getBoundingClientRect().width)]).filter(([, w]) => w > 0));
  const key = grName(th) || `#${th.cellIndex}`, w0 = widths[key];
  let moved = false; document.body.classList.add('gr-resizing');
  const mv = ev => { if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true; widths[key] = Math.max(40, Math.round(w0 + ev.clientX - x0)); grWidths(table, widths, key); };
  const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.body.classList.remove('gr-resizing');
    if (!moved) return; grNoClick = true; setTimeout(() => { grNoClick = false; }, 0); // 손을 뗄 때 생기는 click이 정렬로 가지 않게
    const st = grRead(k); st.widths = widths; grWrite(k, st); grReset(table); };
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
}, true);
document.addEventListener('dblclick', e => {
  const rz = e.target.closest('.gr-rz'); if (!rz) return; e.preventDefault();
  const th = rz.closest('th'), table = th.closest('table'), k = table.dataset.grKey; if (!k) return;
  const st = grRead(k); if (!st.widths) return; delete st.widths[grName(th) || `#${th.cellIndex}`];
  if (!Object.keys(st.widths).length) delete st.widths; grWrite(k, st); render();
});
// 순서 바꾸기(머리글 끌어 놓기)
let grDragTh = null;
document.addEventListener('dragstart', e => { const th = e.target.closest?.('th.gr-drag'); if (!th) return; grDragTh = th; th.classList.add('gr-dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', grName(th)); } catch { /* */ } });
document.addEventListener('dragover', e => { const th = e.target.closest?.('th.gr-drag'); if (!grDragTh || !th || th === grDragTh || th.closest('table') !== grDragTh.closest('table')) return; e.preventDefault(); $$('.gr-over', th.parentElement).forEach(c => c.classList.remove('gr-over')); th.classList.add('gr-over'); });
document.addEventListener('dragend', () => { if (!grDragTh) return; grDragTh.classList.remove('gr-dragging'); $$('.gr-over').forEach(c => c.classList.remove('gr-over')); grDragTh = null; });
document.addEventListener('drop', e => {
  const th = e.target.closest?.('th.gr-drag'); if (!grDragTh || !th || th === grDragTh) return; e.preventDefault();
  const table = th.closest('table'); if (table !== grDragTh.closest('table')) return;
  const names = [...table.tHead.rows[0].cells].map(grName).filter(Boolean), from = grName(grDragTh), to = grName(th);
  const order = names.filter(x => x !== from); const at = order.indexOf(to);
  order.splice(names.indexOf(from) < names.indexOf(to) ? at + 1 : at, 0, from); // 오른쪽으로 끌면 놓은 칸 뒤, 왼쪽이면 앞
  grMove(table, order); const st = grRead(table.dataset.grKey); st.order = order; grWrite(table.dataset.grKey, st); grReset(table);
});
// ── 15.182 IMK mall식 표: (1) 가로로 넘치는 표는 체크 칸 + 첫 번째 이름 칸을 왼쪽에 고정(오른쪽 굵은 선),
// (2) 칸을 누르면 그 칸에 파란 테두리(엑셀 칸 커서), 방향키로 칸 이동·Esc로 해제. 입력칸·단추·링크는 원래대로 동작.
function gridFreeze(table) {
  const wrap = table.closest('.table-wrap'); if (!wrap || !table.isConnected || table.tHead?.rows.length !== 1) return;
  const over = wrap.scrollWidth > wrap.clientWidth + 2; table.classList.toggle('gr-freeze', over); if (!over) return;
  const head = [...table.tHead.rows[0].cells], pick = head[0]?.querySelector('input[type=checkbox]') || !head[0]?.textContent.trim();
  const n = pick ? 2 : 1, w0 = head[0].getBoundingClientRect().width;
  table.style.setProperty('--fz1', `${Math.round(w0)}px`); table.dataset.freeze = String(n);
  for (const tr of table.querySelectorAll(':scope > tbody > tr, :scope > tfoot > tr')) tr.classList.toggle('fz-skip', [...tr.cells].some(c => c.colSpan > 1)); // 합계·묶음 줄(칸 합침)은 고정하지 않음
}
let cellOn = null;
const setCell = td => { cellOn?.classList.remove('cell-on'); cellOn = td || null; if (td) { td.classList.add('cell-on'); td.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } };
document.addEventListener('click', e => {
  const td = e.target.closest?.('#main table.grid > tbody > tr > td');
  if (!td || td.closest('.bom-tree, .sc-cal')) { if (!e.target.closest?.('#main table.grid')) setCell(null); return; }
  setCell(td);
}, true);
document.addEventListener('keydown', e => {
  if (!cellOn || !cellOn.isConnected || e.target.closest?.('input, select, textarea, [contenteditable], .modal-wrap')) return;
  const tr = cellOn.parentElement, i = cellOn.cellIndex; let next = null;
  if (e.key === 'ArrowRight') next = cellOn.nextElementSibling; else if (e.key === 'ArrowLeft') next = cellOn.previousElementSibling;
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { let r = tr; do { r = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling; } while (r && (r.hidden || r.cells.length <= i)); next = r?.cells[i] || null; }
  else if (e.key === 'Escape') { setCell(null); return; } else return;
  if (next) { e.preventDefault(); setCell(next); }
});
// 15.204 휴대폰 3줄 그리드(출하지시 15.202와 같은 모양을 여러 목록에): 칸 이름표 상자(as-cards) 대신
// 1줄 = 제목(a) + 오른쪽 값(b), 2줄 = 짧은 정보(c, 이름표는 [머리글, 줄임말]일 때만), 3줄 = 입력·단추(d). 나머지 칸(x)은 휴대폰에서 숨김. PC 표는 그대로.
const PHONE_GRID = [
  ['#stockList', { a: ['품목명'], b: ['현재고'], c: ['품목코드', '분류', ['안전재고', '안전'], ['최근 변동', '변동']], d: [''] }],
  ['#shList', { a: ['품목명'], b: ['수량'], c: ['거래처', '출고일', ['LOT', 'LOT']], d: [''] }],
  ['#rcsList', { a: ['품목'], b: ['입고일'], c: ['입고번호', '거래처', ['줄', '줄']], d: [''] }],
  ['#workList', { a: ['샘플명', '제품명', '상품명', '타겟제품'], b: ['판정', '상태'], c: ['접수번호', '검사구분', '고객사', ['완료희망일', '희망']], d: ['상태'] }], // 15.219 분석·VOC·개발·샘플 리스트
  ['#taxList', { k: [''], a: ['거래처'], b: ['합계'], c: ['문서상태', ['작성일자', '작성'], '품목', '구분'] }], // 15.219 세금계산서 목록
  ['#mrList', { a: ['품목 · 수량'], b: ['진행'], c: ['업체 · 주문번호', ['출고 희망', '출고']], d: [''] }], // 15.219 생산의뢰
  ['#scBills', { a: ['거래처'], b: ['합계금액'], c: ['전표번호', ['영업담당자', '담당'], ['매출', '매출'], ['매입', '매입'], ['세액', '세액']] }], // 15.218 매출·매입 달력 납품전표 목록
  ['#scItems', { a: ['제품명'], b: ['금액'], c: ['제품코드', '규격', ['수량', '수량'], ['단가', '단가']] }], // 15.218 세부품목내역
  ['#billList', { k: [''], a: ['거래처'], b: ['합계'], c: ['전표번호', ['전표 일자', '일자'], ['명세서 일자', '일자'], ['영업담당자', '담당'], '상태', '세금계산서'], d: [] }], // 15.215 매출·매입전표 목록
  ['#poList', { a: ['품목명'], b: ['수량'], c: ['거래처', '입고상태', ['납기일', '납기']], d: [''] }], // 15.212 (15.219 2줄로: 입고·잔량·의뢰번호는 상세에)
  ['#rcList', { k: [''], a: ['품목명'], b: ['발주수량'], c: ['거래처', '상태', ['납기일', '납기']], d: ['사진·검수'] }], // 15.212 (15.219 2줄로)
  ['.mr-needs', { a: ['품목'], b: ['생산 필요'], c: ['규격·사이즈', ['의뢰', '의뢰'], ['생산', '생산'], ['계획 안 됨', '미계획']] }], // 15.210
  ['#faList', { a: ['품목명'], b: ['잔량'], c: ['계획일', ['계획수량', '계획'], ['실적 누계', '실적']], d: ['양품수량', '비고', ''] }],
];
function phoneGrid(table, spec) {
  table.classList.remove('as-cards'); table.classList.add('keep-table', 'm-grid');
  // 화면에 안 보이는 머리글(.sr-only 「작업」 등)은 빈 머리글('')로 본다(단추 칸).
  const heads = $$('thead th', table).map(th => [...th.childNodes].filter(x => !(x.classList && x.classList.contains('sr-only'))).map(x => x.textContent).join('').replace(/[☆▾▴▼▲]/g, '').trim());
  const find = h => { for (const [role, list] of Object.entries(spec)) for (const e of list) { const name = Array.isArray(e) ? e[0] : e; if (name === '' ? h === '' : h === name || h.startsWith(name + ' ')) return [role, Array.isArray(e) ? e[1] : '']; } return ['x', '']; };
  const roles = spec.roles || heads.map(find); // 15.210 자동 설정은 칸별 역할
  $$('tfoot tr, tbody tr', table).filter(tr => tr.parentElement.tagName === 'TFOOT' || ([...tr.children].some(td => td.colSpan > 1) && tr.children.length > 1)).forEach(tr => { tr.classList.add('m-sum'); let col = 0; /* 15.215 칸을 합친 소계 줄도 실제 칸 위치로 */ [...tr.children].forEach(td => { const i = col; col += td.colSpan || 1; // 15.210 합계 줄도 같은 칸 역할(합친 칸·첫 칸 = 제목)
    if (/^[\s—-]*$/.test(td.textContent) && !td.querySelector('input, button')) { td.classList.add('m-x'); return; } // 빈 칸(줄 끝 합친 칸 등)은 숨김
    if (td.colSpan > 1 || i === 0) { td.classList.add('m-a'); return; }
    const [role, label] = roles[i] || ['x', '']; td.classList.add('m-' + (role === 'a' ? 'c' : role === 'k' || role === 'd' ? 'x' : role)); if (label) td.dataset.m = label;
    if (/^[\s—-]*$/.test(td.textContent)) td.classList.add('m-empty'); }); });
  $$('tbody tr:not(.m-sum)', table).forEach(tr => [...tr.children].forEach((td, i) => {
    if (td.colSpan > 1) { td.classList.add('m-full'); return; }
    const [role, label] = roles[i] || ['x', '']; td.classList.add('m-' + role); if (label) td.dataset.m = label;
    if (role === 'c' && /^[\s—-]*$/.test(td.textContent)) td.classList.add('m-empty'); // 빈 칸·「—」는 휴대폰에서 숨김
    if (role === 'd' && heads[i]) td.querySelectorAll('input:not([type=checkbox]):not([type=radio])').forEach(inp => { if (!inp.dataset.mPh) { inp.dataset.mPh = '1'; inp.placeholder = heads[i] + (inp.placeholder ? ' ' + inp.placeholder : ''); } }); // 휴대폰에선 머리줄이 없으니 칸 이름을 입력칸 안에
  }));
}
// 15.210 휴대폰 카드(as-cards) 대신 모든 목록을 3줄 그리드로: 머리글·칸 내용을 보고 역할을 자동으로 정한다.
// a = 품목·제목(없으면 첫 글자 칸), b = 수량·금액·상태 중 첫 칸, d = 입력·단추 칸, k = 체크칸(맨 앞), 나머지는 c(짧은 이름표). PHONE_GRID에 있는 표는 그 설정을 쓴다.
const AUTO_A = ['품목명', '품목', '제품명', '제품', '품명 · LOT', '품명', '제목', '이름', '내용', '거래처', '업체', '업체명'];
const AUTO_B = /^(수량|출하 수량|입고 수량|의뢰 수량|계획 수량|금액|합계|합계금액|총액|공급가액|잔량|잔액|현재고|재고|상태|진행|결과|판정|미수금|미지급)/;
function autoGridSpec(table) {
  const heads = $$('thead th', table).map(th => [...th.childNodes].filter(x => !(x.classList && x.classList.contains('sr-only'))).map(x => x.textContent).join('').replace(/[☆▾▴▼▲]/g, '').trim());
  const rows = $$('tbody tr', table).filter(tr => ![...tr.children].some(td => td.colSpan > 1)).slice(0, 40);
  const cells = i => rows.map(tr => tr.children[i]).filter(Boolean);
  const kind = heads.map((h, i) => {
    const cs = cells(i);
    if (cs.length && cs.every(td => { const ctl = td.querySelectorAll('input, select, textarea, button, a.btn, summary.btn'); return ctl.length && [...ctl].every(x => x.type === 'checkbox') && !td.textContent.trim(); })) return 'k';
    if (cs.some(td => td.querySelector('input:not([type=checkbox]), select, textarea, button:not(.link-btn), a.btn, details.row-menu'))) return 'd';
    return '';
  });
  let a = AUTO_A.map(n => heads.findIndex((h, i) => !kind[i] && (h === n || h.startsWith(n + ' ')))).find(i => i >= 0);
  if (a === undefined) a = heads.findIndex((h, i) => !kind[i] && h && !/일$|일자|날짜|번호|No|NO|코드/.test(h) && cells(i).some(td => /[가-힣A-Za-z]/.test(td.textContent)));
  if (a < 0) a = heads.findIndex((h, i) => !kind[i] && h);
  const pickB = re => heads.findIndex((h, i) => i !== a && !kind[i] && re.test(h));
  let b = -1; // 수량·금액 먼저(이름이 딱 맞는 칸 우선: 잔액 > 기초 잔액), 없으면 상태
  for (const n of ['잔액', '현재고', '잔량', '미수금', '미지급', '합계금액', '합계', '총액', '금액', '공급가액', '수량']) { b = heads.findIndex((h, i) => i !== a && !kind[i] && h === n); if (b >= 0) break; }
  if (b < 0) b = pickB(/(수량|금액|합계|총액|공급가액|잔량|잔액|현재고|재고|미수금|미지급)$/); if (b < 0) b = pickB(AUTO_B);
  const short = h => { const x = h.split(/ · |\s*\(|\s+/)[0]; return x.length > 6 ? x.slice(0, 6) : x; };
  const roles = heads.map((h, i) => i === a ? ['a', ''] : i === b ? ['b', ''] : kind[i] ? [kind[i], ''] : ['c', h && !/^no$/i.test(h) ? short(h) : '']);
  return { roles };
}
function labelGridTables() {
  $$('table.grid:not([data-labeled])').forEach(table => {
    table.dataset.labeled = 'true';
    const pg = PHONE_GRID.find(([sel]) => table.closest(sel)); if (pg) phoneGrid(table, pg[1]); // 15.204 (15.215 PC 정렬·필터·열 설정은 그대로 이어서)
    if (!table.classList.contains('keep-table') && !table.classList.contains('m-grid')) phoneGrid(table, autoGridSpec(table)); // 15.210 카드 대신 3줄 그리드(keep-table 표는 휴대폰에서도 표 그대로)
    const heads = $$('thead th', table).map(th => th.textContent.trim());
    const rows = $$('tbody tr', table);
    rows.forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = td.colSpan > 1 ? '' : heads[i] || ''; }));
    // Desktop: columns that are empty on every row are left out (입력 표처럼 칸이 나중에 채워지면 data-keep-cols로 끈다); short values stay on one line.
    const ths = $$('thead th', table);
    if (sortableTable(table)) { ths.forEach(th => { if (th.textContent.trim() && !th.querySelector('input')) th.classList.add('sortable'); }); xfAttach(table); } // 15.97 머리글 눌러 정렬 · 15.158 엑셀식 필터
    heads.forEach((head, i) => {
      const cells = rows.map(tr => tr.children[i]).filter(Boolean);
      if (head && rows.length && !table.hasAttribute('data-keep-cols') && !table.querySelector('[colspan]') && cells.every(td => (!td.textContent.trim() || td.textContent.trim() === '—') && !td.querySelector('input, select, button, textarea'))) [ths[i], ...cells].forEach(c => c?.classList.add('col-empty'));
      if (NOWRAP_HEADS.has(head)) [ths[i], ...cells].forEach(c => c?.classList.add('nowrap-cell'));
      if (ITEM_HEADS.has(head)) ths[i]?.classList.add('item-col'); // 15.177
      if (head.replace(/\s/g, '').length >= 5 && table.closest('.modal')) ths[i]?.classList.add('th-long'); // 15.183 팝업: 긴 머리글만 두 줄 허용
      if (CENTER_HEADS.test(head) && !cells.some(td => td.querySelector('input, select, button:not(.link-btn)'))) [ths[i], ...cells].forEach(c => c && !c.classList.contains('r') && c.classList.add('c')); // 15.180
    });
    gridLayout(table); // 15.173 열 너비·순서(빈 열 숨긴 뒤)
    if (rows.length > 15 && !table.closest('.modal-wrap')) table.closest('.table-wrap')?.classList.add('tw-fill'); // 15.180 긴 목록: 머리글 고정
    requestAnimationFrame(() => gridFreeze(table)); // 15.182 가로로 길면 앞 열 고정
    if (!table.classList.contains('as-cards')) return;
    let secondary = 0;
    rows.forEach(tr => [...tr.children].forEach(td => {
      const label = td.dataset.label;
      if (!td.querySelector('input, select, button') && (!td.textContent.trim() || td.textContent.trim() === '—')) td.classList.add('cell-empty');
      // data-card-primary: 접힌 카드에도 보여야 하는 칸(예: 구매의뢰의 「결재하기」 버튼).
      const isSecondary = !td.hasAttribute('data-card-primary') && (CARD_SECONDARY.has(label) || (!label && !td.querySelector('input[type=checkbox]') && td.querySelector('button, a.btn')));
      if (isSecondary && td.textContent.trim() !== '') { td.classList.add('card-secondary'); secondary++; }
    }));
    if (secondary) rows.forEach(tr => {
      if (!tr.querySelector('.card-secondary')) return;
      const primary = [...tr.children].filter(td => !td.classList.contains('card-secondary') && !td.classList.contains('cell-empty') && !td.querySelector('input[type=checkbox]'));
      const first = primary.find(td => ['품목명', '품목', '제품', '품명 · LOT'].includes(td.dataset.label)) || primary[0] || tr.children[0];
      const more = document.createElement('button'); more.type = 'button'; more.className = 'card-more'; more.textContent = '자세히';
      more.onclick = event => { event.stopPropagation(); tr.classList.toggle('card-open'); more.textContent = tr.classList.contains('card-open') ? '접기' : '자세히'; };
      first.append(more);
    });
    if (rows.length > 30) {
      rows.forEach((tr, i) => { if (i >= 30) tr.classList.add('card-later'); });
      const wrap = table.closest('.table-wrap') || table;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn block cards-more';
      const label = () => { const left = $$('tr.card-later', table).length; button.textContent = `더 보기 (${left}건 남음)`; if (!left) button.remove(); };
      button.onclick = () => { $$('tr.card-later', table).slice(0, 30).forEach(tr => tr.classList.remove('card-later')); label(); };
      label(); wrap.after(button);
    }
  });
}
// 4) Phone: list filters fold behind 「조건」 next to the keyword; the button shows how many conditions are changed.
function foldListFilters() {
  $$('form.list-filters:not([data-folded])').forEach(form => {
    form.dataset.folded = 'true';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn filter-toggle';
    const changed = () => [...form.querySelectorAll(':scope > .seg')].filter(s => form.classList.contains('lf-pc-fold') && s.querySelector('button.on') && s.querySelector('button.on') !== s.querySelector('button')).length + [...form.querySelectorAll(form.classList.contains('lf-pc-fold') && !matchMedia('(max-width: 700px)').matches ? 'select' : 'input, select')].filter(el => el.name && el.name !== 'q' && el.type !== 'search' && !el.disabled && (
      el.tagName === 'SELECT' ? el.value !== ([...el.options].find(o => o.defaultSelected) || el.options[0] || {}).value
      : el.type === 'checkbox' ? el.checked !== el.defaultChecked : el.value !== el.defaultValue)).length;
    const update = () => { const n = changed(); button.textContent = (form.classList.contains('show-all') ? '조건 닫기' : n ? `조건 ${n}개 적용 중` : '조건') + (form.classList.contains('show-all') ? ' ▴' : ' ▾'); button.classList.toggle('primary', !!n && !form.classList.contains('show-all')); };
    button.onclick = () => { form.classList.toggle('show-all'); update(); };
    form.addEventListener('change', update); form.addEventListener('input', update); form.addEventListener('click', () => setTimeout(update));
    const search = form.querySelector('.list-search'); if (search) search.after(button); else form.prepend(button);
    update();
  });
}
new MutationObserver(foldListFilters).observe(document.body, { childList: true, subtree: true });
// 15.217 PC에서도 조회 줄이 두 줄로 넘치면 고르는 칸(상태·분류·발행구분 등 select)은 「조건 ▾」 안으로 접어 한 줄로.
// 기간·거래처·검색어·조회 단추는 밖에 그대로. 바꾼 조건 수는 단추에 「조건 n개 적용 중」.
function foldWideFilters() {
  if (matchMedia('(max-width: 700px)').matches) return;
  $$('#main form.list-filters:not([data-pc-fold])').forEach(form => {
    const kids = [...form.children].filter(e => e.getBoundingClientRect().height > 0 && !e.matches('.filter-toggle, .lf-fold'));
    if (!kids.length) return;
    form.dataset.pcFold = '1';
    const top = form.getBoundingClientRect().top, first = Math.min(...kids.map(e => e.getBoundingClientRect().top));
    if (!kids.some(e => e.getBoundingClientRect().top - first > 24)) return; // 실제로 둘째 줄이 있을 때만(높이가 다른 칸끼리 조금 어긋난 것은 한 줄)
    const selects = [...form.children].filter(e => (e.matches('label') && e.querySelector(':scope > select') && !e.querySelector('input:not([type=hidden])')) || e.matches('.seg'));
    if (!selects.length || top < 0) return;
    form.classList.add('lf-pc-fold');
    const toggle = form.querySelector(':scope > .filter-toggle'), go = form.querySelector(':scope > .lf-actions') || form.querySelector(':scope > button.primary');
    if (toggle && go) go.before(toggle);
    toggle?.click(); toggle?.click(); // 글자(조건 n개 적용 중) 다시 계산
  });
}
new MutationObserver(() => requestAnimationFrame(foldWideFilters)).observe(document.body, { childList: true, subtree: true });
// 13) Phone: report sections fold to their titles (tap a title to open).
function foldReportSections() {
  $$('.report-chart-grid > section.card:not([data-fold]), #semiReportRoot section.card:not([data-fold])').forEach((section, i) => {
    section.dataset.fold = ''; const title = section.querySelector('h3'); if (!title) return;
    if (i > 0) section.classList.add('fold-closed');
    title.classList.add('fold-title'); title.onclick = () => section.classList.toggle('fold-closed');
  });
}
new MutationObserver(foldReportSections).observe(document.body, { childList: true, subtree: true });
// 15.177 조회 줄의 「~」 라벨(끝 날짜)을 시작 날짜 칸 옆으로 붙인다: [전표 일자: 시작 ~ 끝]. 입력 이름·이벤트는 그대로.
// 15.180 조회 조건: 아래 가운데 「–」 손잡이로 접기(화면마다 기억), 초기화(↺)·조회는 오른쪽 끝에.
function filterTools() {
  $$('#main form.list-filters:not([data-ft])').forEach(f => {
    f.dataset.ft = '1';
    const submit = f.querySelector(':scope > button.primary:not(.filter-toggle), :scope > .actions > button.primary, :scope button.btn.primary[type=submit], :scope > button.btn.primary');
    const own = [...f.querySelectorAll('button')].find(b => b.matches('[data-clear-filters]') || /초기화/.test(b.textContent)), hasReset = !!own;
    if (submit && own && own.parentElement === f && submit.parentElement === f) { own.className = 'btn lf-reset'; own.textContent = '↺'; const grp = document.createElement('span'); grp.className = 'lf-actions'; submit.before(grp); grp.append(own, submit); } // 15.214 조회 줄 통일: 초기화는 ↺, 조회와 한 덩어리
    if (submit && !hasReset && submit.parentElement === f) {
      const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'btn lf-reset'; rb.title = '조건 초기화'; rb.setAttribute('aria-label', '조건 초기화'); rb.textContent = '↺';
      rb.onclick = () => { f.reset(); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); };
      const grp = document.createElement('span'); grp.className = 'lf-actions'; submit.before(grp); grp.append(rb, submit); // 초기화·조회 한 덩어리로 오른쪽 끝
    }
    if (submit) submit.classList.add('lf-go');
    const key = 'wpa:lf-fold:' + navRoute(location.hash), fold = document.createElement('button');
    fold.type = 'button'; fold.className = 'lf-fold'; fold.title = '조회 조건 접기·펴기';
    const set = shut => { f.classList.toggle('lf-folded', shut); fold.textContent = shut ? '▾ 조회 조건 펴기' : '▴ 조건 접기'; fold.setAttribute('aria-expanded', String(!shut)); };
    let shut = false; try { shut = localStorage.getItem(key) === '1'; } catch { /* */ }
    set(shut); fold.onclick = () => { shut = !f.classList.contains('lf-folded'); set(shut); try { if (shut) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* */ } };
    f.after(fold);
  });
}
// 15.214 휴대폰 긴 입력 화면: 「(선택)」 칸이 둘 이상인 입력 묶음은 그 칸들을 「선택 입력 n개 ▾」로 접어 필수 칸이 먼저 보이게(값이 있으면 펼침).
function foldOptionalFields() {
  if (!matchMedia('(max-width: 600px)').matches) return;
  $$('#main form:not(.list-filters):not([data-read-only]) .form-grid:not([data-opt-folded])').forEach(grid => {
    if (!grid.querySelector('[data-fx-mark]')) return; // form-ux.js가 필수·(선택) 표시를 붙인 뒤에 판단
    grid.dataset.optFolded = '1';
    if (grid.closest('.modal, .line-table, table')) return;
    const opt = [...grid.children].filter(el => el.matches('label, .field, fieldset, .radio-group') && /\(선택\)/.test(el.querySelector(':scope > .hint, :scope > .opt, :scope > span, :scope > legend')?.textContent || [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('')) && !el.querySelector('[required]'));
    if (opt.length < 2) return;
    const box = document.createElement('details'); box.className = 'opt-fold span3';
    box.innerHTML = `<summary>선택 입력 ${opt.length}개 <span class="small muted">(${opt.map(el => (el.childNodes[0]?.nodeValue || el.querySelector('legend')?.textContent || '').trim()).filter(Boolean).slice(0, 3).join('·')}${opt.length > 3 ? ' …' : ''})</span></summary><div class="opt-fold-body"></div>`;
    opt.at(-1).after(box); $('.opt-fold-body', box).append(...opt);
    if (opt.some(el => [...el.querySelectorAll('input, select, textarea')].some(i => i.type === 'checkbox' || i.type === 'radio' ? i.checked && !i.defaultChecked : i.value && i.value !== i.defaultValue))) box.open = true;
  });
}
new MutationObserver(foldOptionalFields).observe(document.body, { childList: true, subtree: true });
// 15.219 휴대폰 입력 표(품목 줄): 입력칸이 많은 줄은 필수·값 있는 칸만 보이고 나머지는 「추가 입력 n ▾」로 접음(줄마다)
function foldLineInputs() {
  if (!matchMedia('(max-width: 600px)').matches) return;
  $$('#main form table.m-grid tbody tr:not([data-lf])').forEach(tr => {
    const cells = [...tr.children].filter(td => td.classList.contains('m-d') && td.querySelector('input:not([type=checkbox]):not([type=hidden]), select, textarea'));
    if (cells.length < 5) return;
    tr.dataset.lf = '1';
    const opt = cells.filter(td => ![...td.querySelectorAll('input, select, textarea')].some(i => i.required || (i.value && i.value !== i.defaultValue) || (i.tagName === 'SELECT' && i.selectedIndex > 0)));
    if (opt.length < 2) return;
    opt.forEach(td => td.classList.add('m-opt'));
    const host = tr.querySelector('td.m-a') || cells[0], btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'm-opt-btn'; btn.textContent = `추가 입력 ${opt.length} ▾`;
    btn.onclick = () => { const on = tr.classList.toggle('m-opt-open'); btn.textContent = on ? '추가 입력 접기 ▴' : `추가 입력 ${opt.length} ▾`; };
    host.append(btn);
  });
}
new MutationObserver(() => foldLineInputs()).observe(document.body, { childList: true, subtree: true });
// 15.216 모든 조회 양식의 기간(시작·끝 날짜 칸)을 「이름 [◀ | 기간 ▾ | ▶]」 한 덩어리로. 화면이 직접 rangePresets를 부르지 않아도 여기서 붙인다.
// 조회 전용 양식만(저장 양식에서 고르면 submit이 저장이 되므로 제외). 고르면 조회 단추가 있으면 그 양식을 제출, 없으면 change 이벤트.
function autoCompactRanges() {
  if (typeof rangePresets !== 'function') return;
  $$('#main form, .modal form').forEach(form => {
    if (form.dataset.rpAuto || !form.matches('.list-filters, .toolbar, [data-read-only], .filters, .rs-filter, .report-filters') || form.querySelector('.rp-compact')) return;
    const from = form.querySelector('input[type=date][name=from]'), to = form.querySelector('input[type=date][name=to]');
    if (!from || !to || from.closest('.rp-custom') || !from.closest('label, .rs-f')) return;
    form.dataset.rpAuto = '1'; // 한 번만(다시 그려도 반복하지 않게)
    form.querySelectorAll('.range-presets:not(.rp-compact)').forEach(old => { old.hidden = true; old.classList.add('rp-replaced'); });
    rangePresets(from, to, { compact: true, onPick: () => { const go = form.querySelector('button[type=submit], button.primary:not([type=button]), button.lf-go'); if (go && !go.disabled && form.requestSubmit) form.requestSubmit(go.type === 'submit' ? go : undefined); else to.dispatchEvent(new Event('change', { bubbles: true })); } });
  });
}
new MutationObserver(() => autoCompactRanges()).observe(document.body, { childList: true, subtree: true });
function pairDateRanges() {
  $$('form.list-filters > label:not([data-paired])').forEach(l => {
    l.dataset.paired = '1';
    const own = [...l.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue.trim()).join('');
    const end = l.querySelector(':scope > input[type=date]'), prev = l.previousElementSibling;
    if (own !== '~' || !end || !prev?.matches('label') || !prev.querySelector(':scope > input[type=date]')) return;
    const start = prev.querySelector(':scope > input[type=date]'), pair = document.createElement('span'); pair.className = 'lf-pair';
    start.replaceWith(pair); pair.append(start, Object.assign(document.createElement('span'), { className: 'muted', textContent: '~' }), end);
    end.setAttribute('aria-label', (prev.childNodes[0]?.nodeValue || '').trim() + ' 끝'); prev.classList.add('lf-period'); l.remove();
  });
}
// 15.212 같은 줄에 버튼 묶음(.seg)이 둘 이상이면 묶음마다 이름표(aria-label)를 앞에 보여 준다(「전체」가 여러 번 나와 헷갈리지 않게).
function labelSegGroups() {
  $$('.seg[aria-label]:not([data-seg-labeled])').forEach(seg => {
    seg.dataset.segLabeled = '1';
    const sibs = [...seg.parentElement.children].filter(x => x.classList.contains('seg'));
    if (sibs.length < 2 && !seg.parentElement.closest('.seg-row')) return;
    const tag = document.createElement('span'); tag.className = 'seg-label'; tag.textContent = seg.getAttribute('aria-label'); seg.before(tag);
  });
}
// 15.219 휴대폰 한 줄 탭: 고른 탭이 보이게 가로 위치 맞춤
function scrollTabsIntoView() { if (!matchMedia('(max-width: 700px)').matches) return; $$('#main .seg.class-tabs, #main .tax-side, #main .receipt-tabs').forEach(bar => { const on = bar.querySelector('.on, [aria-current], [aria-pressed="true"]'); if (!on || bar.scrollWidth <= bar.clientWidth || bar.dataset.tabX === on.textContent) return; bar.dataset.tabX = on.textContent; bar.scrollLeft = Math.max(0, on.offsetLeft - bar.clientWidth / 2 + on.offsetWidth / 2); }); }
new MutationObserver(() => { labelGridTables(); labelSegGroups(); pairDateRanges(); filterTools(); scrollTabsIntoView(); }).observe(document.body, { childList: true, subtree: true });

async function pageHome(main) {
  const [d, tasks, alerts] = await Promise.all([api('GET', '/api/dashboard'), api('GET', '/api/my-tasks'), api('GET', '/api/alerts').catch(() => null)]);
  const r = d.requests;
  const flow = (title, steps) => `<div class="flow"><h3>${title}</h3><ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>`;
  // 15.36 대시보드 화면 구성: 같은 숫자·링크를 업무 묶음별로 나눠 보여 준다(값과 조건은 그대로).
  // tone: '' 보통, 'red' 문제, 'yellow' 확인 필요. 0건은 흐리게 보여 눈이 문제 숫자에 먼저 가게 한다.
  const kpi = (href, value, label, tone = '', note = '') => `<a class="kpi ${tone} ${Number(value) === 0 ? 'is-zero' : ''}" href="${href}"><b>${value}</b><span>${label}</span>${note}</a>`;
  const group = (title, tiles) => { const body = tiles.filter(Boolean).join(''); return body ? `<section class="kpi-group" aria-label="${title}"><h3>${title}</h3><div class="kpis">${body}</div></section>` : ''; };
  const num = v => Number(v) === 0 ? '<span class="zero">0</span>' : v;
  // 15.215 Overview: 부서 카드(위 색 띠) 안에 「이름 ··· 숫자」 줄. 0건은 흐리게, 처리할 것이 있는 줄만 색. 영업은 금액(담당자만) + 수주·출하 대기·계산서.
  const sa = d.sales;
  const row = (href, value, label, tone = '', note = '') => `<a class="dm-row ${tone} ${Number(String(value).replace(/,/g, '')) === 0 ? 'is-zero' : ''}" href="${href}"><span class="dm-l">${label}${note ? ` <em>${note}</em>` : ''}</span><b class="dm-v">${value}</b></a>`;
  const card = (dept, en, ko, href, rows) => { const body = rows.filter(Boolean).join(''); return body ? `<section class="dm-card" data-dept="${dept}" aria-label="${ko}"><h3><a href="${href}"><span class="dm-en">${en}</span><span class="dm-ko">${ko}</span></a></h3>${body}</section>` : ''; };
  main.innerHTML = `
  <div class="dash-head"><h1>대시보드</h1><p class="dash-date"><time datetime="${d.today}">${d.today} (${dow(d.today)})</time></p></div>
  <div class="dash-top">${tasksCard(tasks)}${alertsCard(alerts)}</div>
  ${d.stock === null ? '<p class="small red-text" role="status">재고 경고를 조회하지 못했습니다. 재고 현황을 확인하거나 잠시 후 새로고침해주세요.</p>' : ''}
  <section class="dash-section" aria-labelledby="dashNow"><h2 id="dashNow">Overview <span class="dash-sub">부서별 지금 처리할 것</span></h2>
  <div class="dash-overview">
    ${card('sales', 'Sales', '영업', '#/sales/orders', [
      sa && sa.canMoney ? `<a class="dm-hero" href="#/sales/bills"><span>이번 달 매출 <small>(확정 전표 ${fmtNum(sa.billsMonth)}장)</small></span><b>₩ ${won(sa.salesMonth)}</b><small>이번 달 입금 ₩ ${won(sa.paidMonth)}</small></a>` : '',
      sa ? row('#/sales/orders', sa.ordersOpen, '진행 중 수주', '', sa.ordersToday ? `오늘 ${sa.ordersToday}건` : '') : '',
      sa ? row('#/logistics/ship-orders', sa.shipPending, '출하 대기 지시', 'yellow', sa.shipHeld ? `보류 ${sa.shipHeld}` : '') : '',
      sa ? row('#/sales/bills', sa.untaxed, '세금계산서 안 담은 전표', 'yellow') : '',
      sa && !sa.canMoney ? row('#/sales/bills', sa.billsMonth, '이번 달 확정 전표') : '',
    ])}
    ${card('logistics', 'Purchasing · Logistics', '구매·물류', '#/logistics/receive', [
      row('#/logistics/receive', d.po.none, '미입고 발주', '', d.po.overdue ? `<span class="red-text">납기경과 ${d.po.overdue}</span>` : ''),
      row('#/logistics/receive', d.po.checking, '입고 확인중', 'yellow'),
      row('#/logistics/receive', d.po.mismatch, '수량상이', 'red'),
      d.po.partial ? row('#/logistics/receive', d.po.partial, '부분 입고 (남음)', 'yellow') : '',
      d.receiptChangesPending ? row('#/logistics/receive', d.receiptChangesPending, '입고 수량 수정 승인대기', 'yellow') : '',
      row('#/logistics/ship', d.shipmentsToday, '오늘 출하'),
    ])}
    ${card('production', 'Inventory · Production', '재고·생산', '#/logistics/stock', [
      row('#/prod/finished/plan', d.schedulesToday, '오늘 생산 계획'),
      d.stock ? row('#/logistics/stock', d.stock.low, '안전재고 미달 품목', 'yellow') : '',
      d.stock ? row('#/logistics/stock', d.stock.negative, '재고 음수 품목 (기록 확인)', 'red') : '',
      d.actualChangesPending ? row('#/prod/finished', d.actualChangesPending, '생산실적 수정 승인대기', 'yellow') : '',
      row('#/purchase/laundry', fmtNum(d.laundryMonth), '이번 달 세탁 폐기'),
    ])}
    ${card('quality', 'Requests', '의뢰 접수 대기', '#/quality/list', [
      row('#/quality/request', r.analysis.pending, '분석 접수대기', 'yellow'),
      row('#/quality/voc/request', r.voc.pending, 'VOC 승인대기', 'yellow'),
      row('#/dev/request', r.development.pending, '개발 접수대기', 'yellow'),
      row('#/prod/list', r.sample.pending, '샘플 접수대기', 'yellow'),
    ])}
  </div></section>
  <section class="dash-section" aria-labelledby="dashProgress"><h2 id="dashProgress">Request Pipeline <span class="dash-sub">의뢰 종류별 진행</span></h2>
  <div class="table-wrap"><table class="grid keep-table progress-table">
    <caption class="sr-only">의뢰 종류별 진행 현황 (건수)</caption>
    <thead><tr><th scope="col">구분</th><th scope="col">접수대기</th><th scope="col">대기</th><th scope="col">진행</th><th scope="col">완료</th></tr></thead>
    <tbody>${['analysis', 'development', 'sample', 'sample_goods', 'voc'].map((t) => `<tr><th scope="row"><a href="${REQ[t].list}">${REQ[t].label}의뢰</a></th><td>${num(r[t].pending)}</td><td>${num(r[t].waiting)}</td><td>${num(r[t].progress)}</td><td>${num(r[t].done)}</td></tr>`).join('')}</tbody>
  </table></div></section>
  <section class="dash-section" aria-labelledby="dashFlows">
  <details class="dash-flows" data-flows><summary><h2 id="dashFlows">업무 흐름</h2><span class="small muted">부서별 처리 순서 안내</span></summary>
  <div class="flows">
    ${flow('구매 → 물류 (발주·입고)', ['<b>구매</b> 발주서 발송 후 <a href="#/purchase/po">발주목록</a> 입력', '<b>물류</b> 입고 시 <a href="#/logistics/receive">입고목록 → 발주입고</a>에서 체크', '정상 입고 → <span class="chip green">초록</span>', '수량 다름 → <span class="chip red">빨강</span> (실입고 수량 기록)', '확인 중 → <span class="chip yellow">노랑</span>'])}
    ${flow('품질 (분석)', ['<b>누구나</b> <a href="#/quality/request">분석의뢰</a> 양식 작성', '접수대기 목록에 등록', '<b>품질담당자</b> 승인 → 접수번호 발급', '<a href="#/quality/list">분석리스트</a>에서 대기 → 진행 → 완료', '수입·의뢰·출하·공정검사 구분'])}
    ${flow('품질 (VOC)', ['<b>누구나</b> <a href="#/quality/voc/request">VOC 접수</a> (고객사·제품·수량·LOT·사진)', '<b>품질팀장(품질책임자)</b> 승인', '<a href="#/quality/voc/list">VOC 처리목록</a>에서 대기 → 진행 → 완료', '진행 코멘트에 처리사항 기록'])}
    ${flow('개발', ['<b>누구나</b> <a href="#/dev/request">개발의뢰</a> 작성 (타겟제품·타겟단가)', '접수대기 목록에 등록', '<b>연구소담당자</b> 승인', '<a href="#/dev/list">개발리스트</a>에서 대기 → 진행 → 완료'])}
    ${flow('생산', ['<b>누구나</b> <a href="#/prod/request">샘플의뢰</a> 작성', '<b>생산담당자</b> 승인 → <a href="#/prod/list">샘플리스트</a>', '<a href="#/prod/finished">완제품</a> / <a href="#/prod/semi">반제품</a> 생산일정 일·주·월 입력'])}
    ${flow('구매 (세탁) · 물류 (출하)', ['세탁 입고분 불량 폐기 → <a href="#/purchase/laundry">세탁관리</a>에 사진·수량', '매일 출고 품목 → <a href="#/logistics/ship">출하목록</a> 입력'])}
  </div></details></section>
  <p class="muted small dash-note">※ 샘플 및 개발제품의 출고(or 제출)는 제조/품질본부장 승인 후 출고 가능</p>`;
  // 업무 흐름 안내는 넓은 화면에서는 펼치고, 휴대폰에서는 접어 둔다(내용은 그대로, 눌러서 열기).
  const flows = $('[data-flows]', main); if (flows && !matchMedia('(max-width: 700px)').matches) flows.open = true;
  // 15.62: 휴대폰에서는 할 일·알림을 먼저 보도록 「현황 한눈에」「진행 현황」을 접어 둔다(눌러서 열기).
  if (matchMedia('(max-width: 700px)').matches) for (const id of ['dashProgress']) { // 15.215 Overview는 휴대폰에서도 펼쳐 둠
    const section = $(`[aria-labelledby="${id}"]`, main), heading = section && $('#' + id, section); if (!section || !heading) continue;
    const fold = document.createElement('details'); fold.className = 'dash-fold';
    const summary = document.createElement('summary'); summary.append(heading); fold.append(summary, ...[...section.childNodes]); section.append(fold);
  }
}

// ───────────── 구매: 발주목록 ─────────────
const ITEM_CATEGORIES = ['원자재', '부자재', '반제품', '제품', '상품', '임가공'];
function categoryOptions(value = '', all = false) {
  return `<option value="">${all ? '전체 분류' : '분류 선택'}</option>` + ITEM_CATEGORIES.map(category => `<option value="${category}" ${value === category ? 'selected' : ''}>${category}</option>`).join('');
}
function categoryField(value = '') {
  return `<label>분류 *<select name="item_category" required>${categoryOptions(value)}</select></label>`;
}
function coaChip(value) { return value ? '<span class="chip">COA 요청</span>' : '<span class="muted">—</span>'; }
function poForm(po = {}) {
  return `<div class="form-grid">
    <label>구매의뢰번호<input name="req_no" readonly value="${esc(po.req_no || '')}" placeholder="저장 시 자동 부여 (PR-날짜-순번)"><span class="hint">승인된 의뢰에서 불러오면 기존 의뢰번호를 사용합니다.</span></label>
    <label>거래처 *<input name="vendor" required value="${esc(po.vendor)}"></label>
    ${categoryField(po.item_category)}
    <label class="inline coa-field"><input name="coa_requested" type="checkbox" value="1" ${po.coa_requested ? 'checked' : ''}> COA 요청</label>
    <label class="span2">품목명 *<input name="item" required value="${esc(po.item)}"></label>
    <label>수량 *<input name="qty" type="number" min="0" step="any" required value="${esc(po.qty)}"></label>
    <label>납기일 *<input name="due_date" type="date" required value="${esc(po.due_date)}"></label>
    <label>단가<input name="unit_price" type="number" min="0" step="any" inputmode="decimal" value="${esc(po.unit_price ?? '')}" placeholder="발주서 금액용"></label>
    <label>운송비<input name="freight" type="number" min="0" step="any" inputmode="decimal" value="${esc(po.freight ?? '')}" placeholder="발주서에 붙는 운송비"></label>
    <label class="span2">내부 메모 <span class="hint">(구매·물류용, 발주서에 안 나감)</span><input name="internal_note" maxlength="200" value="${esc(po.internal_note || '')}" placeholder="예: 풍림무약향"></label>
    <label class="span2">비고<input name="note" value="${esc(po.note)}"></label>
  </div>`;
}
// 내부 메모(15.69): 구매·물류만 보는 구분(예: 풍림무약향). 발주서에는 나가지 않는다.
const internalNoteChip = p => p.internal_note ? `<div class="small internal-note"><span class="chip yellow">내부</span> ${esc(p.internal_note)}</div>` : '';
function recvChip(po) {
  const cls = { ok: 'green', mismatch: 'red', checking: 'yellow' }[po.recv_status] || '';
  // 15.72 부분 입고(수량상이 중 발주보다 적게 받은 것)는 남은 수량을 함께 보여 준다(더 받거나 「입고확인·완료」로 종결).
  const left = po.recv_status === 'mismatch' && po.recv_qty != null && po.recv_qty < po.qty ? po.qty - po.recv_qty : 0;
  if (left) return `<span class="chip ${cls}">${RECV[po.recv_status]} (${fmtNum(po.recv_qty)})</span> <span class="small muted">남음 ${fmtNum(left)}</span>${receiptChangeInfo(po)}`;
  const shortClosed = po.recv_status === 'ok' && po.recv_qty != null && po.recv_qty !== po.qty;
  return `<span class="chip ${cls}">${RECV[po.recv_status]}${po.recv_status === 'mismatch' ? ` (${fmtNum(po.recv_qty)})` : ''}${shortClosed ? ` · ${fmtNum(po.recv_qty)}/${fmtNum(po.qty)} 종결` : ''}</span>${receiptChangeInfo(po)}`;
}
// ── 발주서(15.66): 거래처별로 한 장씩. 인쇄·PDF 저장은 세탁 성적서와 같은 방식(body.printing-cert)으로 이 창만 찍는다. ──
// 발주서 본문(.cert)은 번역하지 않는다(거래처에 보내는 한국어 문서).
// 발주서 비고(15.70): 사람이 쓴 비고만 모은다. 구매의뢰 발주의 자동 문구(「구매의뢰 PR-…」, 규격, 「의뢰 10 → 발주 12」)는 뺀다.
// 모든 품목의 비고가 같으면 한 번, 다르면 「품목: 비고」 줄로. 내부 메모(internal_note)는 넣지 않는다.
function poUserNote(p) {
  return String(p.note || '').split(' · ').map(s => s.trim()).filter((part, i) => part && !(i === 0 && /^구매의뢰 /.test(part)) && !(p.spec && part === p.spec && /^구매의뢰 /.test(p.note)) && !/^의뢰 \S+ → 발주 \S+$/.test(part)).join(' · ');
}
function poSheetMemo(list) {
  const notes = list.map(p => [p, poUserNote(p)]).filter(([, n]) => n);
  if (!notes.length) return '';
  const same = notes.length === list.length && notes.every(([, n]) => n === notes[0][1]);
  return same ? notes[0][1] : [...new Set(notes.map(([p, n]) => `${p.item}${p.spec ? ' ' + p.spec : ''}: ${n}`))].join('\n');
}
async function poPrintSheet(pos) {
  if (!pos.length) return;
  const vendors = await api('GET', '/api/vendors?type=purchase').catch(() => []);
  const groups = new Map(); for (const p of pos) { const g = groups.get(p.vendor) || []; g.push(p); groups.set(p.vendor, g); }
  const money = n => n == null ? '' : fmtNum(Math.round(n * 100) / 100);
  const today = todayStr();
  const sheet = (vendor, list) => {
    const v = vendors.find(x => partnerKey(x.name) === partnerKey(vendor));
    const reqNos = [...new Set(list.map(p => p.req_no).filter(Boolean))].join(', ');
    const priced = list.filter(p => p.unit_price != null), total = priced.reduce((t, p) => t + p.unit_price * p.qty, 0);
    const freight = list.reduce((t, p) => t + (p.freight || 0), 0), hasFreight = list.some(p => p.freight != null);
    const dues = [...new Set(list.map(p => p.due_date))].sort();
    return `<section class="cert po-doc">
      <div class="po-doc-head"><img src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><h2>발 주 서</h2></div>
      <table class="po-info"><tbody>
        <tr><th>발주일</th><td>${esc(today)}</td><th>발주번호</th><td>${esc(reqNos || '—')}</td></tr>
        <tr><th>수신</th><td><b>${esc(vendor)}</b> 귀하</td><th>담당 · 연락처</th><td>${esc([v?.contact_name, v?.phone].filter(Boolean).join(' · ') || '—')}</td></tr>
        <tr><th>발주처</th><td>서울세미텍</td><th>발주 담당</th><td>${esc([ME.name, ME.department, ME.position].filter(Boolean).join(' · '))}</td></tr>
        <tr><th>납기일</th><td colspan="3">${esc(dues.join(', '))}</td></tr>
      </tbody></table>
      <p>아래와 같이 발주합니다.</p>
      <table class="po-items"><thead><tr><th>No</th><th>품목</th><th>규격</th><th>단위</th><th class="r">수량</th><th class="r">단가</th><th class="r">금액</th><th>납기일</th></tr></thead>
      <tbody>${list.map((p, i) => `<tr><td class="c">${i + 1}</td><td>${esc(p.item)}${p.product_code ? `<div class="po-code">${esc(p.product_code)}</div>` : ''}</td><td>${esc(p.spec || '')}</td><td>${esc(p.unit || '')}</td><td class="r">${fmtNum(p.qty)}</td><td class="r">${money(p.unit_price)}</td><td class="r">${p.unit_price == null ? '' : money(p.unit_price * p.qty)}</td><td class="c">${esc(p.due_date)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="6" class="r">합계${priced.length < list.length ? ' (단가 없는 품목 제외)' : ''}</th><td class="r"><b>${priced.length ? money(total) : ''}</b></td><td></td></tr>${hasFreight ? `<tr><th colspan="6" class="r">운송비</th><td class="r">${money(freight)}</td><td></td></tr><tr><th colspan="6" class="r">총액</th><td class="r"><b>${money(total + freight)}</b></td><td></td></tr>` : ''}</tfoot></table>
      <div class="po-memo"><b>비고</b><div class="po-memo-body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="발주서 비고 (인쇄 전에 고칠 수 있음)">${esc(poSheetMemo(list))}</div></div>
      <p class="po-sign">발주처 : 서울세미텍 <span class="cert-sign-box">(인)</span></p>
    </section>`;
  };
  const m = modal(`<h3 class="po-print-title">발주서 미리보기 <span class="small muted">${groups.size}개 거래처 · ${pos.length}개 품목</span></h3>${[...groups].map(([vendor, list]) => sheet(vendor, list)).join('')}
    <div class="actions"><button class="btn" data-close>닫기</button><button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => { const title = document.title; document.title = `발주서_${[...groups.keys()].join('_')}_${today}`; document.body.classList.add('printing-cert'); try { window.print(); } finally { document.body.classList.remove('printing-cert'); document.title = title; } };
}
// ── 운송비 조건(15.69) ── 매입처의 조건(맞는 줄을 모두 더함)으로 기본 운송비를 계산한다. 조건이 없으면 null.
function freightCalc(terms, subtotal, lines = 1) {
  if (!Array.isArray(terms) || !terms.length) return null;
  return terms.reduce((sum, r) => {
    const hit = r.when === 'always' || (r.when === 'gte' && subtotal >= r.amount) || (r.when === 'lt' && subtotal < r.amount);
    return hit ? sum + r.fee * (r.per === 'line' ? Math.max(1, lines) : 1) : sum;
  }, 0);
}
// 만원 표기는 한국어 화면에서만(번역 화면은 전체 금액).
const freightWon = n => n >= 10000 && n % 10000 === 0 && document.documentElement.lang === 'ko' ? `${fmtNum(n / 10000)}만원` : `${fmtNum(n)}원`;
// 조건 요약(번역되도록 조각마다 span): 「100만원 이상 1건당 150,000원 (착불)」
function freightSummary(terms) {
  if (!Array.isArray(terms) || !terms.length) return '<span class="muted">조건 없음</span>';
  return terms.map(r => `<span class="freight-rule">${r.when === 'always' ? '' : `<span>${freightWon(r.amount)} ${r.when === 'gte' ? '이상' : '미만'}</span> `}<span>${r.per === 'line' ? '품목당' : '1건당'} ${fmtNum(r.fee)}원</span>${r.note ? ` (${esc(r.note)})` : ''}</span>`).join('<span aria-hidden="true"> · </span>');
}
// ── 기록된 입고 수량 수정·입고 취소 요청 (물류팀장 승인 후 반영) ──
const canApproveReceipt = () => ME && (ME.is_admin || ME.roles.includes('logistics_approver'));
function pendingReceipt(po) { try { return typeof po.pending_change === 'string' ? JSON.parse(po.pending_change) : po.pending_change || null; } catch { return null; } }
// 15.92 발주 대비 잔량: 입고(물류 입고확인) · 전표(매입전표에 잡힌 수량) · 잔량(아직 안 들어온 수량, 입고 종결이면 0)
function poProgressCells(p) {
  const received = ['ok', 'mismatch'].includes(p.recv_status) ? Number(p.recv_qty ?? p.qty) : 0, billed = Number(p.billed_qty || 0);
  const left = p.recv_status === 'ok' ? 0 : Math.max(0, Number(p.qty) - received), unbilled = Math.max(0, received - billed);
  return `<td class="r">${received ? fmtNum(received) : ''}</td><td class="r">${billed ? fmtNum(billed) : ''}${billed && unbilled ? `<div class="small muted">미전표 ${fmtNum(unbilled)}</div>` : ''}</td><td class="r">${left ? `<b>${fmtNum(left)}</b>` : ''}</td>`;
}
function receiptChangeText(c, po = {}) { return c.action === 'qty' ? `실입고 ${fmtNum(c.old_recv_qty ?? po.recv_qty)} → ${fmtNum(c.new_recv_qty)} 수정` : '입고 취소(미입고로)'; }
function receiptChangeInfo(po) {
  const c = pendingReceipt(po);
  if (c) return `<div class="small"><span class="chip yellow">승인 대기</span> ${receiptChangeText(c, po)} · ${esc(c.reason)} · ${esc(c.requested_by)}</div>${receiptChangeButtons(c)}`;
  return po.__menu ? '' : ['ok', 'mismatch'].includes(po.recv_status) ? `<div class="small"><button class="btn small" data-receipt-qty="${po.id}">수량 수정 요청</button> <button class="btn small danger" data-receipt-revert="${po.id}">입고 취소 요청</button></div>` : '';
}
// 15.212 줄 「더보기」에 넣을 입고 수정·취소 요청(승인 대기 중이면 없음)
function receiptActions(po) { return !pendingReceipt(po) && ['ok', 'mismatch'].includes(po.recv_status) ? [`<button class="btn small" data-receipt-qty="${po.id}">수량 수정 요청</button>`, `<button class="btn small danger" data-receipt-revert="${po.id}">입고 취소 요청</button>`] : []; }
function receiptChangeButtons(c) {
  return `${canApproveReceipt() ? `<button class="btn small primary" data-rchange-approve="${c.id}">승인</button> <button class="btn small danger" data-rchange-reject="${c.id}">반려</button>` : ''}${c.requested_by_id === ME.id ? ` <button class="btn small" data-rchange-cancel="${c.id}">요청 철회</button>` : ''}`;
}
function bindReceiptChanges(root, rows, after) {
  // The page may have been left while the list was loading; a cancelled dialog changes nothing and needs no reload.
  if (!root) return;
  const run = async (button, task) => { if (button.disabled) return; button.disabled = true; try { if (await task() === false) return; await after(); } catch (error) { fail(error); } finally { button.disabled = false; } };
  $$('[data-receipt-qty]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => {
    const po = rows.find(row => row.id === Number(button.dataset.receiptQty));
    const v = await promptBox('입고 수량 수정 요청', `<p class="small muted">${esc(po.item)} · 발주 ${fmtNum(po.qty)} / 현재 실입고 <b>${fmtNum(po.recv_qty)}</b>. 물류팀장이 승인하면 반영됩니다.</p><label>바른 실입고 수량 *<input name="recv_qty" type="number" min="0" step="any" required value="${esc(po.recv_qty)}"></label><label>수정 사유 *<input name="reason" required maxlength="500"></label>`);
    if (!v) return false; await api('POST', `/api/po/${po.id}/receipt-changes`, { action: 'qty', ...v, request_id: crypto.randomUUID() }); toast('수정 요청을 올렸습니다. 물류팀장 승인 후 반영됩니다.');
  }); });
  $$('[data-receipt-revert]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => {
    const po = rows.find(row => row.id === Number(button.dataset.receiptRevert));
    const v = await promptBox('입고 취소 요청', `<p class="small muted">${esc(po.item)} · 승인되면 미입고로 돌아갑니다. 이미 등록된 수입검사 이력은 남습니다.</p><label>취소 사유 *<input name="reason" required maxlength="500"></label>`);
    if (!v) return false; await api('POST', `/api/po/${po.id}/receipt-changes`, { action: 'revert', ...v, request_id: crypto.randomUUID() }); toast('입고 취소 요청을 올렸습니다. 물류팀장 승인 후 반영됩니다.');
  }); });
  $$('[data-rchange-approve]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => { if (!await reviewApproval('receipt', button.dataset.rchangeApprove)) return false; await api('POST', `/api/receipt-changes/${button.dataset.rchangeApprove}/approve`, {}); toast('승인했습니다. 입고 내용에 반영되었습니다.'); }); });
  $$('[data-rchange-reject]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => {
    const v = await promptBox('입고 수정 요청 반려', '<label>반려 사유 *<input name="note" required maxlength="500"></label>'); if (!v) return false;
    await api('POST', `/api/receipt-changes/${button.dataset.rchangeReject}/reject`, v); toast('반려했습니다.');
  }); });
  $$('[data-rchange-cancel]', root).forEach(button => button.onclick = event => { event.stopPropagation(); run(button, async () => {
    if (!(await confirmBox('이 요청을 철회할까요?'))) return false; await api('POST', `/api/receipt-changes/${button.dataset.rchangeCancel}/cancel`); toast('요청을 철회했습니다.');
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
  ${hasRole('purchase') ? '<section class="card po-from-pr" id="poFromPr"></section>' : ''}
  <form class="card" id="poNew"><h3>${hasRole('purchase') ? '직접 발주 등록' : '발주 등록'}</h3>${poForm()}<div class="actions"><button class="btn primary">등록</button></div></form>
  ${listControls('po', { dateLabel: '납기', dateFold: '납기일로 찾기', placeholder: '의뢰번호·거래처·품목·입력자·메모', extra: `<label>분류<select name="item_category" id="poCategory">${categoryOptions('', true)}</select></label><label>입고 상태<select name="recv" id="poF"><option value="">전체 입고</option><option value="none">미입고</option><option value="checking">확인중</option><option value="mismatch">수량상이</option><option value="ok">입고완료</option></select></label><label>COA 요청<select name="coa_requested"><option value="">전체</option><option value="1">요청</option><option value="0">미요청</option></select></label>` })}
  <div class="legend"><span class="chip green">입고완료</span><span class="chip red">수량상이</span><span class="chip yellow">확인중</span></div><div id="poList"></div>`;
  const filterForm = $('#poFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const rows = await api('GET', '/api/po?' + new URLSearchParams(formObj(filterForm)));
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, rows.length);
    const t = todayStr();
    $('#poList').innerHTML = rows.length ? `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="발주목록 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid po-grid">
      <thead><tr><th>구매의뢰번호</th><th>거래처</th><th>품목명</th><th class="r">수량</th><th class="r">입고</th><th class="r">전표</th><th class="r">잔량</th><th>입고상태</th><th>납기일</th><th>분류</th><th>COA 요청</th><th>비고</th><th>입력자</th><th></th></tr></thead>
      <tbody>${rows.map((p) => `<tr class="${rowClass(p)}">
        <td>${esc(p.req_no)}</td><td>${esc(p.vendor)}</td><td>${esc(p.item)}${lineInfo(p)}${internalNoteChip(p)}</td><td class="r">${fmtNum(p.qty)}</td>${poProgressCells(p)}
        <td>${recvChip({ ...p, __menu: 1 })}${p.recv_note ? `<div class="small muted">${esc(p.recv_note)}</div>` : ''}</td>
        <td class="${p.recv_status !== 'ok' && p.due_date < t ? 'overdue' : ''}">${esc(p.due_date)}</td><td>${esc(p.item_category || '미분류')}</td><td>${coaChip(p.coa_requested)}</td>
        <td>${esc(p.note)}</td><td class="small muted">${esc(p.created_by)}</td>
        <td class="nowrap row-acts"><button class="btn small" data-edit="${p.id}">수정</button>${rowMenu(p.item, [`<button class="btn small" data-po-print="${p.id}" title="같은 구매의뢰번호·거래처의 발주를 한 장으로">발주서</button>`, commentButton("purchase_order", p.id, p.item), ...receiptActions(p), `<button class="btn small danger" data-del="${p.id}">삭제</button>`])}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">등록된 발주가 없습니다.</div>';
    if (rows.length) { const priced = rows.filter(r => r.unit_price != null && r.unit_price !== ''); $('#poList').insertAdjacentHTML('beforeend', sumLine([['합계', esc(`${rows.length}건`)], ['수량', esc(unitTotals(rows, r => r.qty, r => r.unit))], ['발주 금액', esc(`${won(priced.reduce((t, r) => t + billTruncC(r.qty * r.unit_price), 0))}원`)], ['단가 없음', rows.length - priced.length ? esc(`${rows.length - priced.length}건`) : '']])); }
    bindReceiptChanges($('#poList'), rows, load);
    $$('[data-po-print]', main).forEach(b => b.onclick = () => { const t = rows.find(r => r.id === Number(b.dataset.poPrint)); poPrintSheet(rows.filter(r => r.req_no === t.req_no && r.vendor === t.vendor)); });
    $$('[data-edit]').forEach((b) => (b.onclick = () => {
      const p = rows.find((x) => x.id == b.dataset.edit);
      const m = modal(`<h3>발주 수정</h3><form data-entry-author="${esc(p.created_by)}">${poForm(p)}<div class="actions"><button class="btn primary">저장</button></div></form>`, { wide: true });
      bindPartnerPicker($('[name=vendor]', m.el), null, { type: 'purchase' }).catch(fail);
      $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api('PUT', '/api/po/' + p.id, formObj(e.target)); m.close(); toast('수정했습니다.'); load(); } catch (err) { fail(err); } };
    }));
    $$('#poList [data-del]').forEach((b) => (b.onclick = async () => {
      const p = rows.find(x => x.id === Number(b.dataset.del));
      // 15.69 구매의뢰에서 만든 발주: 지우면 기본으로 그 의뢰 품목도 닫아 「발주 대기」에 다시 나타나지 않게 한다.
      const how = p && p.pr_item_id ? await poDeleteChoice(p) : (await confirmBox('이 발주를 삭제할까요?') ? 'close' : null);
      if (!how) return;
      try { await api('DELETE', '/api/po/' + b.dataset.del + (how === 'requeue' ? '?requeue=1' : '')); toast(how === 'requeue' ? '삭제했습니다. 의뢰 품목은 발주 대기로 돌아갔습니다.' : '삭제했습니다.'); load(); refreshNavBadges(); } catch (e) { fail(e); }
    }));
  };
  $('#poNew').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/api/po', formObj(e.target)); e.target.reset(); toast('발주를 등록했습니다.'); load(); } catch (err) { fail(err); } };
  bindPartnerPicker($('#poNew').elements.vendor, null, { type: 'purchase' }).catch(fail);
  bindListControls(filterForm, load);
  await load();
  if ($('#poFromPr', main)) await poFromRequests($('#poFromPr', main), load);
}

// ───────────── 물류: 입고목록 (발주입고 + 기타입고) ─────────────
// 15.39: 기타입고 목록을 입고목록에 합쳤다. 두 구역(발주입고·기타입고)을 한 화면에 두고 「구분」으로 골라 본다.
// 두 구역은 처리 방식(체크 후 입고확인 / 수정·삭제)과 날짜 기준(납기일 / 입고일)이 달라 각자의 검색·처리를 그대로 쓴다.
const RECEIPT_KINDS = [['all', '전체'], ['purchase', '발주입고'], ['other', '기타입고']];
async function pageReceipts(main, tab) {
  if (tab === 'other-entry') {
    // 기타입고 입력 화면: 입력 양식만 보이고 목록 부분은 applyView가 숨긴다.
    main.innerHTML = `<h1>입고목록 <span class="dept">물류</span></h1><section id="receiptContent"></section>`;
    await pageOtherReceipts($('#receiptContent', main));
    return;
  }
  let kind = tab === 'other' ? 'other' : 'all';
  if (tab !== 'other') { try { kind = localStorage.getItem('wpa:receipt-kind') || 'all'; } catch { /* private mode */ } }
  if (!RECEIPT_KINDS.some(([k]) => k === kind)) kind = 'all';
  main.innerHTML = `<h1>입고목록 <span class="dept">물류</span></h1>
    <div class="kind-filter" role="group" aria-label="입고 구분">${RECEIPT_KINDS.map(([k, label]) => `<button type="button" class="kind-chip" data-receipt-kind="${k}" aria-pressed="${k === kind}">${label}<span class="kind-count" data-kind-count="${k}"></span></button>`).join('')}</div>
    <section class="receipt-part" data-part="purchase" id="receiptPurchase"></section>
    <section class="receipt-part" data-part="other" id="receiptOther"></section>`;
  const apply = () => {
    $$('[data-receipt-kind]', main).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.receiptKind === kind)));
    $$('.receipt-part', main).forEach(part => { part.hidden = kind !== 'all' && part.dataset.part !== kind; });
  };
  $$('[data-receipt-kind]', main).forEach(b => b.onclick = () => { kind = b.dataset.receiptKind; try { localStorage.setItem('wpa:receipt-kind', kind); } catch { /* ignore */ } apply(); });
  apply();
  await Promise.all([pageReceive($('#receiptPurchase', main)), pageOtherReceipts($('#receiptOther', main), { entry: false })]);
  // 구분 버튼에 각 구역의 조회 건수를 붙인다(각 구역의 검색 조건 기준).
  const counts = () => {
    if (!main.isConnected) return;
    const n = id => { const m = /(\d+)건/.exec($(`#${id}`, main)?.textContent || ''); return m ? Number(m[1]) : null; };
    const pc = n('rcCount'), oc = n('otherCount');
    const set = (k, v) => { const el = $(`[data-kind-count="${k}"]`, main), text = v === null ? '' : ` ${v}`; if (el && el.textContent !== text) el.textContent = text; }; // 같은 값이면 쓰지 않는다(관찰자 무한 반복 방지)
    set('purchase', pc); set('other', oc); set('all', pc === null || oc === null ? null : pc + oc);
  };
  counts();
  // 각 구역의 「N건 조회」 글자가 바뀔 때만 다시 센다.
  const watch = new MutationObserver(counts); for (const id of ['rcCount', 'otherCount']) { const el = $(`#${id}`, main); if (el) watch.observe(el, { subtree: true, characterData: true, childList: true }); }
}
async function pageReceive(main) {
  main.innerHTML = `
  <h2>발주입고</h2>
  <div id="receiptChanges"></div>
  <p class="muted">구매의 발주목록을 불러옵니다. 입고된 항목을 체크하고 버튼을 누르세요. <b>입고확인</b> 또는 <b>수량상이</b> 처리 시 분석리스트에 수입검사(대기)가 자동 등록됩니다(수량상이는 실입고 수량 기준). 누구나 처리할 수 있으며, 처리한 사람과 내용은 각 항목의 <b>진행 코멘트</b>에 자동으로 남습니다.<br>수량상이 항목에 <b>입고확인·완료</b>를 누르면 실입고 수량 그대로 <b>입고 종결</b>됩니다(예: 100개 중 90개). 나중에 들어오는 나머지는 <b>기타입고</b>로 등록하세요. 이미 기록된 입고 수량의 수정·입고 취소는 <b>물류팀장 승인</b> 후 반영됩니다.</p>
  ${listControls('rc', { dateLabel: '납기', dateFold: '납기일로 찾기', placeholder: '의뢰번호·거래처·품목·입력자·메모', extra: `<label>입고 상태<select name="recv" id="rcF"><option value="open">미완료</option><option value="">전체 입고</option><option value="none">미입고</option><option value="checking">확인중</option><option value="mismatch">수량상이</option><option value="ok">입고완료</option></select></label><label>분류<select name="item_category">${categoryOptions('', true)}</select></label>${listInspectionSelect()}` })}
  <div class="actionbar">
    <span id="rcSelectedCount" class="muted">0개 선택</span>
    <button class="btn green" data-st="ok" title="수량상이 항목은 실입고 수량 그대로 입고 종결">✔ 입고확인·완료</button>
    <button class="btn red" data-st="mismatch">수량상이</button>
    <button class="btn yellow" data-st="checking" title="고른 줄을 「확인중」 상태로 바꿉니다">확인중으로 표시</button>
    <button class="btn" data-st="">미입고로 되돌리기</button>
    <button class="btn primary" data-rc-lot title="체크한 발주(같은 거래처)를 입고 입력 화면으로 불러와 LOT별·부분 입고로 받습니다">LOT·부분 입고 처리</button>
  </div>
  <div id="rcList"></div>`;
  let rows = []; const filterForm = $('#rcFilters', main); let queryVersion = 0;
  const selected = () => $$('.rc-check:checked').map((c) => Number(c.value));
  // 15.62: 휴대폰에서 하나라도 체크하면 처리 버튼 줄을 화면 아래에 띄운다. 원래 자리에 같은 높이의 빈칸을 남겨 목록이 튀지 않게 한다.
  const barSpacer = document.createElement('div'); barSpacer.className = 'actionbar-spacer';
  const updateCount = () => {
    $('#rcSelectedCount').textContent = `${selected().length}개 선택`;
    const bar = $('.actionbar', main), on = selected().length > 0 && matchMedia('(max-width: 820px)').matches; if (!bar || on === bar.classList.contains('has-selection')) return;
    if (on) { barSpacer.style.height = bar.offsetHeight + 'px'; bar.before(barSpacer); } else barSpacer.remove();
    bar.classList.toggle('has-selection', on);
  };
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const found = await api('GET', '/api/po?' + new URLSearchParams(formObj(filterForm)));
    if (version !== queryVersion || !main.isConnected) return;
    rows = found;
    listCount(filterForm, rows.length);
    const t = todayStr();
    $('#rcList').innerHTML = rows.length ? `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="입고목록 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid po-grid">
      <thead><tr><th><input type="checkbox" id="rcAll" aria-label="전체 선택"></th><th>구매의뢰번호</th><th>거래처</th><th>품목명</th><th>분류</th><th>COA 요청</th><th class="r">발주수량</th><th class="r">실입고</th><th>납기일</th><th>상태</th><th>입력자</th><th>입고 처리자</th><th>사진·검수</th></tr></thead>
      <tbody>${rows.map((p) => `<tr class="${rowClass(p)}">
        <td><input type="checkbox" class="rc-check" value="${p.id}" aria-label="선택"></td>
        <td>${esc(p.req_no)}</td><td>${esc(p.vendor)}</td><td>${esc(p.item)}${lineInfo(p)}${internalNoteChip(p)}</td><td>${esc(p.item_category || '미분류')}</td><td>${coaChip(p.coa_requested)}</td><td class="r">${fmtNum(p.qty)}</td>
        <td class="r">${p.recv_status ? fmtNum(p.recv_qty) : ''}</td>
        <td class="${p.recv_status !== 'ok' && p.due_date < t ? 'overdue' : ''}">${esc(p.due_date)}</td>
        <td>${recvChip({ ...p, __menu: 1 })}${qcChip(p)}${p.recv_note ? `<div class="small muted">${esc(p.recv_note)}</div>` : ''}</td>
        <td class="small muted">${esc(p.created_by || '기존 기록: 미기록')}</td><td class="small muted">${esc(p.recv_by || '')}${p.recv_at ? '<br>' + esc(p.recv_at.slice(5, 16)) : ''}</td><td class="row-acts"><button class="btn small" data-receipt-photo="${p.id}">사진·이상 여부</button>${inspectionBadge(p)}${rowMenu(p.item, [commentButton("purchase_order", p.id, p.item), ...receiptActions(p)])}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">해당하는 발주가 없습니다.</div>';
    if (rows.length) $('#rcList').insertAdjacentHTML('beforeend', sumLine([['합계', esc(`${rows.length}건`)], ['발주수량', esc(unitTotals(rows, r => r.qty, r => r.unit))], ['실입고', (got => got.length ? esc(unitTotals(got, r => r.recv_qty ?? r.qty, r => r.unit)) : '')(rows.filter(r => ['ok', 'mismatch'].includes(r.recv_status)))]]));
    const all = $('#rcAll'); if (all) all.onchange = () => { $$('.rc-check').forEach((c) => (c.checked = all.checked)); updateCount(); };
    $$('.rc-check').forEach((c) => (c.onchange = updateCount));
    // 행 클릭으로도 체크
    $$('#rcList tbody tr').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('input,button,summary,details')) { const c = $('.rc-check', tr); c.checked = !c.checked; updateCount(); } }));
    bindReceiptChanges($('#rcList'), rows, load);
    renderReceiptChanges($('#receiptChanges')).then(() => bindReceiptChanges($('#receiptChanges'), rows, load)).catch(fail);
    $$('#rcList [data-receipt-photo]').forEach(button => button.onclick = () => openAttachments('purchase_order', Number(button.dataset.receiptPhoto), rows.find(row => row.id === Number(button.dataset.receiptPhoto)).item));
    updateCount();
  };
  // 15.72 체크한 발주(같은 거래처)를 입고 입력 화면으로 넘겨 LOT별·부분 입고로 받는다.
  $('.actionbar [data-rc-lot]', main).onclick = () => {
    const picked = rows.filter(r => selected().includes(r.id));
    if (!picked.length) return toast('먼저 발주를 체크하세요.', 'err');
    const vendors = [...new Set(picked.map(r => partnerKey(r.vendor)))];
    if (vendors.length > 1) return toast('같은 거래처의 발주만 함께 입고할 수 있습니다.', 'err');
    const done = picked.filter(r => r.recv_status === 'ok');
    if (done.length) return toast(`이미 입고가 끝난 발주(${done.map(r => r.item).join(', ')})는 뺀 뒤 다시 누르세요.`, 'err');
    try { sessionStorage.setItem('wpa:rc-preload', JSON.stringify({ vendor: picked[0].vendor, ids: picked.map(r => r.id) })); } catch { /* 넘기지 못하면 입고 입력에서 다시 고른다 */ }
    location.hash = '#/logistics/receipt/new';
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
    <label class="span2">품목 검색<input data-receipt-bom-search type="search" placeholder="품목명 또는 품목코드 검색"></label>
    <label class="span2">품목명 *<select name="bom_id" data-receipt-bom ${row.id && !row.bom_id ? '' : 'required'}><option value="">${row.id && !row.bom_id ? '기존 수기 등록 품목' : '품목을 선택하세요'}</option></select></label>
    <label class="receipt-item-name">품목명 (직접 입력)<input name="item" required maxlength="200" value="${esc(row.item)}" ${row.id && !row.bom_id ? '' : 'readonly'}></label>
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
    const results = await api('GET', '/api/boms?temp=1&q=' + encodeURIComponent(search.value));
    if (request !== serial || !form.isConnected) return;
    choices = new Map(results.map(bom => [bom.id, bom]));
    if (previous && !choices.has(previous.id)) choices.set(previous.id, previous);
    if (original) choices.set(Number(row.bom_id), { ...original, id: Number(row.bom_id) });
    select.innerHTML = `<option value="">${row.id && !row.bom_id ? '기존 수기 등록 품목' : '품목을 선택하세요'}</option>` + [...choices.values()].map(bom => `<option value="${bom.id}" ${ITEM_CATEGORIES.includes(bom.item_category) ? '' : 'disabled'}>${esc(bom.product)}${bom.product_code ? ' · ' + esc(bom.product_code) : ''} / ${esc(bom.item_category || '미분류: 관리자 지정 필요')}</option>`).join('');
    select.value = choices.has(Number(selected)) ? selected : ''; apply();
  };
  select.onchange = apply;
  let timer; search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 250); };
  form.addEventListener('reset', () => queueMicrotask(() => { select.value = ''; apply(); }));
  load().catch(fail);
}
async function pageOtherReceipts(main, { entry = true } = {}) {
  main.innerHTML = `<h2>기타입고</h2>
    <p class="muted">등록된 품목을 검색·선택하여 발주 없는 입고를 입력합니다. 등록 즉시 분석리스트에 수입검사(대기)가 자동 등록됩니다.</p>
    ${entry ? `<form class="card" id="otherNew"><h3>기타입고 등록</h3>${otherReceiptForm()}<div class="form-grid">${photoPicker()}${inspectionFields()}</div><div class="actions"><button class="btn primary">등록</button></div></form>` : ''}
    ${listControls('other', { dateLabel: '입고', from: monthStart(todayStr()), to: todayStr(), placeholder: '품목·코드·입고처·입력자·메모', extra: `<label>분류<select name="item_category" id="otherCategory">${categoryOptions('', true)}</select></label>${listInspectionSelect()}` })}<div id="otherList"></div>`;
  const filterForm = $('#otherFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const params = new URLSearchParams(formObj(filterForm));
    const rows = await api('GET', '/api/other-receipts?' + params);
    if (version !== queryVersion || !main.isConnected) return;
    listCount(filterForm, rows.length);
    const otherRow = (row, of = null) => `<tr${of ? ` class="rc-child" data-rc-of="${of}" hidden` : ''}><td>${esc(row.received_date)}</td><td>${esc(row.item_category)}</td><td>${esc(row.item)}${lineInfo(row)}${qcChip(row)}${receiptBomSnapshot(row).product_code ? `<div class="small muted">${esc(receiptBomSnapshot(row).product_code)}</div>` : ''}</td><td class="r">${fmtNum(row.qty)} ${esc(receiptBomSnapshot(row).unit || '')}</td><td>${esc(row.vendor)}</td><td>${esc(row.note)}</td><td>${esc(row.created_by)}</td><td class="nowrap">${commentButton("other_receipt", row.id, row.item)} <button class="btn small" data-other-photo="${row.id}">사진·이상 여부</button>${inspectionBadge(row)} <button class="btn small" data-other-edit="${row.id}">수정</button> <button class="btn small danger" data-other-del="${row.id}">삭제</button></td></tr>`;
    $('#otherList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>입고일</th><th>분류</th><th>품목명</th><th class="r">입고수량</th><th>입고처</th><th>비고</th><th>입력자</th><th></th></tr></thead>
      <tbody>${otherGroups(rows).map(g => g.rows.length > 1 ? otherGroupHead(g) + g.rows.map(row => otherRow(row, g.id)).join('') : otherRow(g.rows[0])).join('')}</tbody></table></div>` : '<div class="empty">해당하는 기타입고가 없습니다.</div>';
    $$('[data-rc-toggle]', main).forEach(b => b.onclick = () => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); b.querySelector('[data-rc-arrow]').textContent = open ? '▾' : '▸'; $$(`[data-rc-of="${b.dataset.rcToggle}"]`, main).forEach(tr => { tr.hidden = !open; }); });
    $$('[data-rc-sheet]', main).forEach(b => b.onclick = async () => { try { receiptSlip(await api('GET', '/api/receipts/' + b.dataset.rcSheet)); } catch (error) { fail(error); } });
    if (rows.length) $('#otherList').insertAdjacentHTML('beforeend', sumLine([['합계', esc(`${rows.length}건`)], ['입고수량', esc(unitTotals(rows, r => r.qty, r => r.unit || receiptBomSnapshot(r).unit))]]));
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
  if (entry) {
  const otherDraft = bindPhotoDraft($('#otherNew'));
  bindReceiptBom($('#otherNew'));
  $('#otherNew').onsubmit = async event => {
    event.preventDefault(); if (otherDraft.busy) return; const button = $('button.primary', event.target); button.disabled = true;
    try {
      const value = formObj(event.target); const saved = await api('POST', '/api/other-receipts', { ...value, request_id: formToken(event.target) }); delete event.target.dataset.rid; const photoSaved = await saveNewAttachments('other_receipt', saved, otherDraft, event.target);
      event.target.reset(); otherDraft.reset(); filterForm.reset(); $('#otherFrom').value = monthStart(value.received_date); $('#otherTo').value = value.received_date;
      $('#otherQ').value = ''; $('#otherCategory').value = ''; if (photoSaved) toast('기타입고와 분석리스트에 등록했습니다.'); await load();
    } catch (error) { fail(error); } finally { button.disabled = false; }
  };
  }
  bindListControls(filterForm, load);
  await load();
}

// ───────────── 구매: 세탁관리 ─────────────
async function pageLaundry(main) {
  const month = todayStr().slice(0, 7);
  main.innerHTML = `
  <h1>세탁관리 <span class="dept">구매</span></h1>
  <p class="muted">세탁 입고분의 불량 폐기 사진과 수량을 기록합니다. 세탁일별 검수 수량과 성적서는 <a href="#/purchase/laundry-reports">세탁 검수·성적서</a>에서 관리합니다.</p>
  <form class="card" id="lnNew"><h3>세탁 폐기 등록</h3>
    <div class="form-grid">
      <label>입고일 *<input name="in_date" type="date" required value="${todayStr()}"></label>
      <label>입고수량<input name="in_qty" type="number" min="0" step="any" placeholder="선택"></label>
      <label>폐기수량 *<input name="discard_qty" type="number" min="0" step="any" required></label>
      <label class="span2">메모<input name="note" placeholder="불량 유형 등"></label>
      ${photoPicker()}
    </div>
    <div class="actions"><button class="btn primary">등록</button></div>
  </form>
  ${listControls('ln', { dateLabel: '입고', from: month + '-01', to: monthEnd(month + '-01'), placeholder: '메모·입력자 검색', extra: `<label>조회월<input type="month" id="lnM" value="${month}"></label><label>사진<select name="has_photos"><option value="">전체 사진</option><option value="1">사진 있음</option><option value="0">사진 없음</option></select></label><button type="button" class="btn" id="lnAllDates">전체 기간</button>` })}<p id="lnSum" class="muted small"></p>
  <div id="lnList" class="cards"></div>`;
  const laundryDraft = bindPhotoDraft($('#lnNew')); const filterForm = $('#lnFilters', main); let queryVersion = 0;
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
      const r = rows.find((x) => x.id == b.dataset.edit);
      const m = modal(`<h3>세탁 기록 수정</h3><form data-entry-author="${esc(r.created_by)}"><div class="form-grid">
        <label>입고일 *<input name="in_date" type="date" required value="${esc(r.in_date)}"></label>
        <label>입고수량<input name="in_qty" type="number" min="0" step="any" value="${esc(r.in_qty)}"></label>
        <label>폐기수량 *<input name="discard_qty" type="number" min="0" step="any" required value="${esc(r.discard_qty)}"></label>
        <label class="span3">메모<input name="note" value="${esc(r.note)}"></label></div>
        <p class="small muted">체크 해제한 사진은 삭제됩니다.</p>
        <div class="thumbs">${r.photos.map((f) => `<label class="keep"><img src="/uploads/${esc(f)}" alt=""><input type="checkbox" name="keep_photos" value="${esc(f)}" checked> 유지</label>`).join('')}</div>
        ${photoPicker()}
        <div class="actions"><button class="btn primary">저장</button></div></form>`, { wide: true });
      const draft = bindPhotoDraft($('form', m.el));
      $('form', m.el).onsubmit = async (e) => { e.preventDefault(); if (draft.busy) return; const button = $('button.primary', e.target); button.disabled = true; try { const values = formObj(e.target); validatePhotoPayload(draft.photos, (values.keep_photos || []).length); await api('PUT', '/api/laundry/' + r.id, { ...values, photos: draft.photos }); m.close(); toast('수정했습니다.'); load(); } catch (err) { fail(err); } finally { button.disabled = false; } };
    }));
  };
  $('#lnNew').onsubmit = async (e) => {
    e.preventDefault(); if (laundryDraft.busy) return; const btn = $('button.primary', e.target); btn.disabled = true;
    try { validatePhotoPayload(laundryDraft.photos); await api('POST', '/api/laundry', { ...formObj(e.target), photos: laundryDraft.photos }); e.target.reset(); e.target.in_date.value = todayStr(); laundryDraft.reset(); toast('등록했습니다.'); load(); }
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
    const plainLabel = String(label).replace(/<[^>]*>/g, '').replace(/\*/g, '').trim();
    const etcInput = f.other ? `<span class="opt">기타 <input name="${f.k}_etc" value="${esc(etc)}" class="etc" aria-label="${esc(plainLabel)} 기타 입력"></span>`
      : f.otherOn ? `<input name="${f.k}_etc" value="${esc(etc)}" class="etc" placeholder="${esc(f.otherPh || '')}" aria-label="${esc(f.otherPh || plainLabel + ' 기타 입력')}">` : '';
    // 15.190 하나만 고르는 칸은 붙은 버튼(세그먼트), 여러 개 고르는 칸은 칸을 맞춘 격자. 기타 입력은 버튼 줄 옆에.
    const opts = f.opts.map((o) => `<label class="opt"><input type="${type}" name="${f.k}" value="${esc(o)}" ${sel.includes(o) ? 'checked' : ''} ${f.req && type === 'radio' ? 'required' : ''}> ${esc(o)}</label>`).join('');
    if (type === 'radio') return `<fieldset class="${cls} pick-field"><legend>${label}</legend><div class="seg-line"><div class="opts seg-pick" role="radiogroup" aria-label="${esc(plainLabel)}">${opts}</div>${etcInput}</div></fieldset>`;
    return `<fieldset class="${cls} pick-field"><legend>${label}</legend><div class="opts check-grid">${opts}${etcInput}</div></fieldset>`;
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
  return `<form class="req-form" ${r ? `data-entry-author="${esc(r.requester_name)}"` : ''}><div class="form-grid">${REQ[type].fields.map((f) => fieldInput(f, r)).join('')}${['development','sample','sample_goods','voc'].includes(type) ? photoPicker() : ''}</div>
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
    ${['development','sample','sample_goods','voc'].includes(type) || r.source_type ? '<h4>첨부 사진 · 기록</h4><div data-request-photos></div>' : ''}
    </div>
    <div class="actions wrap">
      <button class="btn" data-a="print">인쇄</button>${commentButton("request", r.id, r.title)}
      ${type==='analysis' && ['수입검사','출하검사'].includes(r.category) ? '<button class="btn primary" data-a="inspection">검사규격·측정값</button>' : ''}
      ${['development','sample','sample_goods','voc'].includes(type) ? '<button class="btn" data-a="photos">사진 보기·첨부</button>' : ''}
      ${(mine && ['pending', 'rejected'].includes(r.status)) || mgr ? '<button class="btn" data-a="edit">수정</button>' : ''}
      ${(mine && ['pending', 'rejected'].includes(r.status)) || mgr ? '<button class="btn danger" data-a="del">삭제</button>' : ''}
      ${approver && r.status === 'pending' ? '<button class="btn red" data-a="reject">반려</button><button class="btn primary" data-a="approve">승인</button>' : ''}
      ${approver && r.status === 'rejected' ? '<button class="btn primary" data-a="approve">승인</button>' : ''}
      ${mgr && ['waiting', 'progress', 'done'].includes(r.status) ? '<button class="btn" data-a="status">상태/결과 변경</button>' : ''}
    </div>`, { wide: true });
  if (['development','sample','sample_goods','voc'].includes(type)) renderAttachmentPreview($('[data-request-photos]', m.el), 'request', r.id);
  else if (r.source_type) renderAttachmentPreview($('[data-request-photos]', m.el), r.source_type, r.source_id);
  const act = async (a) => {
    try {
      if (a === 'inspection') { m.close(); await openInspection(r.id, reload); return; }
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
// 15.174 분석의뢰 작성: 검사 구분이 수입·출하검사이면 샘플명 아래에 연결될 검사규격을 바로 보여 준다(이름 목록 제안 포함).
function bindSpecHint(form) {
  const title = form.elements.title; if (!title) return;
  const box = document.createElement('p'); box.className = 'small spec-hint'; box.setAttribute('role', 'status'); box.hidden = true;
  title.insertAdjacentElement('afterend', box); // 샘플명 칸 바로 아래
  let names = null, seq = 0, timer = 0;
  const val = n => form.querySelector(`[name=${n}]:checked`)?.value || '';
  const run = async () => {
    const kind = val('category'), cat = val('item_category'), q = title.value.trim(), my = ++seq;
    if (!['수입검사', '출하검사'].includes(kind)) { box.hidden = true; return; }
    if (!names) { try { const d = await api('GET', '/api/inspection-specs'); names = d.specs.filter(s => s.active); const dl = document.createElement('datalist'); dl.id = 'specNames'; dl.innerHTML = [...new Set(names.flatMap(s => [s.product, ...(s.aliases || [])]))].map(n => `<option value="${esc(n)}">`).join(''); form.append(dl); title.setAttribute('list', 'specNames'); } catch { names = []; } }
    if (!q) { box.hidden = false; box.innerHTML = `<span class="muted">샘플명을 검사규격의 품명·제품코드와 같게 쓰면 규격이 자동으로 연결됩니다.</span>`; return; }
    try {
      const m = await api('GET', '/api/inspection-specs/match?' + new URLSearchParams({ kind, item_category: cat, title: q })); if (my !== seq) return;
      box.hidden = false;
      box.innerHTML = m.exact.length === 1 ? `<span class="chip green">검사규격 연결</span> ${esc(m.exact[0].product)} · ${esc(m.exact[0].item_category)} · 규격 ${m.exact[0].revision} (${esc(m.exact[0].items.join(', '))})`
        : m.exact.length > 1 ? `<span class="chip yellow">규격 ${m.exact.length}개 일치</span> 품목 카테고리를 고르면 하나로 정해집니다.`
        : m.partial.length ? `<span class="chip yellow">이름이 같은 규격 없음</span> 비슷한 규격: ${m.partial.map(s => `<button type="button" class="linklike" data-spec-use="${esc(s.product)}">${esc(s.product)}</button>`).join(', ')} — 누르면 샘플명이 바뀝니다.`
        : `<span class="chip">맞는 규격 없음</span> 접수 뒤 품질팀장이 규격을 고르거나 새로 등록합니다.`;
      $$('[data-spec-use]', box).forEach(b => b.onclick = () => { title.value = b.dataset.specUse; title.dispatchEvent(new Event('input', { bubbles: true })); });
    } catch { box.hidden = true; }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(() => run().catch(() => {}), 250); };
  form.addEventListener('input', e => { if (e.target === title) later(); });
  form.addEventListener('change', e => { if (['category', 'item_category'].includes(e.target.name)) later(); });
  form.addEventListener('reset', () => setTimeout(later, 0));
}
async function pageIntake(type) {
  const cfg = REQ[type]; const main = $('#main'); const mgr = canApproveRequest(type);
  const managers = ['analysis','development','voc'].includes(type) ? (await api('GET', '/api/approval-managers'))[type === 'voc' ? 'analysis' : type] : null;
  main.innerHTML = `
  <h1>${cfg.intakeTitle || cfg.label + '의뢰'} <span class="dept">${cfg.approve ? '영업' : cfg.dept}</span></h1>
  <p class="muted">누구나 의뢰할 수 있습니다. 접수대기 목록에 올라가고, <b>${cfg.mgr}</b>가 승인하면 <a href="${cfg.list}">${cfg.listTitle || cfg.label + '리스트'}</a>에 올라갑니다.
  ${managers ? `<br>지정 승인권자: ${managers.length ? managers.map(u => esc(u.name)).join(', ') : '미지정 · 관리자에게 책임자 지정을 요청하세요.'} (관리자도 승인 가능)` : ''}
  ${mgr ? `<br><span class="tag">${cfg.mgr} 권한</span> 아래 목록에서 바로 승인/반려할 수 있습니다.` : ''}</p>
  <button type="button" class="btn primary intake-new-btn" data-intake-new>+ 새 ${cfg.intakeTitle || cfg.label + '의뢰'} 작성</button>
  <details class="card" id="reqNewBox" open><summary><h3>새 ${cfg.intakeTitle || cfg.label + '의뢰'} 작성</h3></summary>${requestForm(type)}</details>
  <h2>접수대기 목록</h2>${listControls('intake', { dateLabel: '등록', placeholder: '품목·고객사·입력자·메모', extra: `<label>상태<select name="status"><option value="">전체 접수대기·반려</option><option value="pending">접수대기</option><option value="rejected">반려</option></select></label>${type === 'analysis' ? '<label>검사 구분<select name="category"><option value="">전체 검사</option>' + ['수입검사','의뢰검사','출하검사','공정검사'].map(category => `<option>${category}</option>`).join('') + '</select></label>' : ''}` })}<div id="intakeList"></div>`;
  const filterForm = $('#intakeFilters', main); let queryVersion = 0;
  main.classList.add('intake-page'); // 15.219 휴대폰: 입력 양식은 접어 두고 목록 먼저(「+ 새 … 작성」으로 열기)
  { const nb = $('[data-intake-new]', main), label = nb.textContent; nb.onclick = () => { const on = main.classList.toggle('intake-open'); nb.textContent = on ? '입력 양식 닫기 ▴' : label; }; }
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
  // 15.58: 고객사 칸은 매출처 목록에서 고른다(상품 샘플의 「공급처 · 고객사」는 양쪽이라 전체 목록).
  const customerInput = $('[name=customer]', newForm); if (customerInput) bindPartnerPicker(customerInput, null, { type: type === 'sample_goods' ? '' : 'sales' });
  // 15.62: 의뢰서 입력 초안(이 탭). 라디오·체크 묶음도 칸 순서로 보관한다. 사진은 보관하지 않는다.
  if (type === 'analysis') bindSpecHint(newForm); // 15.174 수입·출하검사면 연결될 검사규격 미리 보기
  const intakeDraft = bindEntryDraft(newForm, 'intake:' + type, { read: () => uxIndexRead(newForm), restore: value => uxIndexRestore(newForm, value) });
  bindListControls(filterForm, load);
  newForm.onsubmit = async (e) => {
    e.preventDefault(); if (draft.busy) return;
    const button = $('button.primary', newForm); button.disabled = true;
    try { intakeDraft.start(); const saved = await api('POST', '/api/requests', collectRequest(type, e.target)); intakeDraft.clear(); const photoSaved = await saveNewAttachments('request', saved, draft, newForm); e.target.reset(); draft.reset(); intakeDraft.resume(); if (photoSaved) toast('의뢰를 접수했습니다. 접수대기 목록을 확인하세요.'); load(); } catch (err) { intakeDraft.failure(); fail(err); } finally { button.disabled = false; }
  };
  await load();
}

// 승인된 의뢰 리스트 (대기/진행/완료)
// 15.183 샘플의뢰는 영업에서 쓰고, 승인은 각 부서 리스트 화면 위 「접수대기」에서 한다.
async function loadWorkPending(type) {
  const box = $('#workPending'); if (!box) return;
  const rows = (await api('GET', '/api/requests?' + new URLSearchParams({ type, scope: 'intake' }))).filter(r => r.status === 'pending');
  if (!box.isConnected) return;
  box.hidden = !rows.length; if (!rows.length) { box.innerHTML = ''; return; }
  const cfg = REQ[type];
  box.innerHTML = `<h3>접수대기 · 승인 필요 <span class="chip yellow">${rows.length}건</span> <span class="small muted">영업에서 올린 ${esc(cfg.intakeTitle || cfg.label + '의뢰')}입니다. 줄을 누르면 내용을 보고 승인·반려합니다.</span></h3>
    <div class="table-wrap"><table class="grid click" data-no-reorder><thead><tr><th>${esc(cfg.titleLabel)}</th><th>고객사</th><th>완료희망일</th><th>의뢰자</th><th>의뢰일</th><th></th></tr></thead>
    <tbody>${rows.map(r => `<tr data-id="${r.id}"><td><b>${esc(r.title)}</b>${lineInfo(r)}</td><td>${esc(r.customer)}</td><td>${esc(r.due_date || '')}</td><td>${esc(r.requester_name)}</td><td class="small muted">${esc(String(r.created_at).slice(0, 10))}</td><td><button class="btn small primary" data-ok="${r.id}">승인</button></td></tr>`).join('')}</tbody></table></div>`;
  const again = () => { loadWorkPending(type).catch(fail); $('#workList') && render(); };
  $$('tr[data-id]', box).forEach(tr => { tr.onclick = e => { if (e.target.closest('button')) return; requestDetail(type, rows.find(x => x.id == tr.dataset.id), again); }; });
  $$('[data-ok]', box).forEach(b => { b.onclick = async () => { try { const r = await api('POST', `/api/requests/${b.dataset.ok}/approve`); toast(`승인 완료 · 접수번호 ${r.req_no}`); again(); } catch (e) { fail(e); } }; });
}
async function pageWorkList(type) {
  const cfg = REQ[type]; const main = $('#main'); const mgr = hasRole(cfg.role);
  let status = ''; let category = ''; let qc = ''; // qc: 15.78 판정 칩
  main.innerHTML = `
  <h1>${cfg.listTitle || cfg.label + '리스트'} <span class="dept">${cfg.dept}</span></h1>
  <p class="muted">${type === 'analysis' ? '승인된 분석의뢰와 입고에서 자동 등록된 수입검사 목록입니다.' : `승인된 ${cfg.label}의뢰 목록입니다.`} ${mgr ? '상태 칸에서 바로 대기/진행/완료를 바꿀 수 있습니다.' : `상태 변경은 ${cfg.mgr}가 합니다.`} 행을 누르면 의뢰서를 봅니다.</p>
  <div class="toolbar">
    <div class="seg" id="stSeg" role="group" aria-label="상태">${['', 'waiting', 'progress', 'done'].map((s) => `<button data-s="${s}" class="${s === status ? 'on' : ''}">${s ? STATUS[s] : '전체'}</button>`).join('')}</div>
    ${type === 'analysis' ? `<div class="seg" id="catSeg" role="group" aria-label="검사구분">${['', '수입검사', '의뢰검사', '출하검사', '공정검사'].map((c) => `<button data-c="${c}" class="${c === category ? 'on' : ''}">${c || '전체 검사'}</button>`).join('')}</div>
    <div class="seg" id="qcSeg" role="group" aria-label="판정">${[['', '전체 판정'], ['pass', '합격'], ['fail', '불합격'], ['pending', '검사 대기']].map(([v, l]) => `<button type="button" data-qc="${v}" class="${v === '' ? 'on' : ''}" aria-pressed="${v === ''}">${l}</button>`).join('')}</div>` : ''}
  </div>
  <div id="workCounts" class="counts"></div>
  ${cfg.approve && canApproveRequest(type) ? '<section class="card" id="workPending" hidden></section>' : ''}
  ${listControls('work', { dateLabel: '등록', placeholder: '접수번호·품목·고객사·입력자·메모' })}<div id="workList"></div>`;
  if (cfg.approve && canApproveRequest(type)) loadWorkPending(type).catch(fail); // 15.183 영업이 올린 샘플의뢰를 여기서 승인
  const filterForm = $('#workFilters', main); let queryVersion = 0;
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const all = await api('GET', '/api/requests?' + new URLSearchParams({ ...formObj(filterForm), type, scope: 'list', category }));
    if (version !== queryVersion || !main.isConnected) return;
    // 15.78 판정: 측정값이 저장되면 pass/fail, 규격은 있는데 판정 전이면 검사 대기(pending), 규격 미지정은 판정 없음
    const qcOf = r => r.data?.exempt ? 'exempt' : r.inspection_result === 'pass' || r.inspection_result === 'fail' ? r.inspection_result : r.inspection_snapshot ? 'pending' : ''; // 15.207 검사 제외
    const rows = all.filter((r) => (!status || r.status === status) && (!qc || qcOf(r) === qc));
    listCount(filterForm, rows.length);
    $('#workCounts').innerHTML = ['waiting', 'progress', 'done'].map((s) => `${statusChip(s)} ${all.filter((r) => r.status === s).length}`).join(' &nbsp; ');
    const t = todayStr();
    $('#workList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid click">
      <thead><tr><th>접수번호</th>${type === 'analysis' ? '<th>검사구분</th>' : ''}<th>${cfg.titleLabel}</th>${type === 'development' ? '<th>타겟단가</th>' : ''}<th>고객사</th>${type === 'voc' ? '<th>수량</th><th>LOT</th>' : ''}<th>입력자(의뢰자)</th><th>완료희망일</th>${type === 'analysis' ? '<th>판정</th>' : ''}<th>상태</th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-id="${r.id}" class="${type === 'analysis' && qcOf(r) === 'exempt' ? 'row-exempt' : type === 'analysis' && qcOf(r) === 'fail' ? 'row-red' : r.status === 'done' ? 'row-done' : ''}">
        <td class="nowrap">${esc(r.req_no)}</td>${type === 'analysis' ? `<td><span class="chip">${esc(r.category)}</span></td>` : ''}
        <td><b>${esc(r.title)}</b>${lineInfo(r)}${r.source_type ? `<div class="small muted">${r.source_type === 'purchase_order' ? '발주입고' : '기타입고'} · ${esc(r.data.item_category || '미분류')} · 입고 ${fmtNum(r.data.received_qty)}${r.data.coa_requested ? ' · COA 요청' : ''}</div>` : ''}${r.result_note ? `<div class="small muted">${esc(r.result_note)}</div>` : ''}</td>${type === 'development' ? `<td>${esc(r.target_price)}</td>` : ''}
        <td>${esc(r.customer)}</td>${type === 'voc' ? `<td>${fmtNum(r.data.qty)} ${esc(r.data.unit)}</td><td>${esc(r.data.lot || '미확인')}</td>` : ''}<td>${esc(r.requester_name)}</td>
        <td class="${r.status !== 'done' && r.due_date && r.due_date < t ? 'overdue' : ''}">${esc(r.due_date || '')}</td>
        ${type === 'analysis' ? `<td class="nowrap">${qcOf(r) ? qualityInspectionBadge(qcOf(r)) : '<span class="small muted">규격 미지정</span>'}</td>` : ''}
        <td>${mgr ? `<select class="st-select st-${r.status}" data-st="${r.id}" aria-label="상태">${['waiting', 'progress', 'done'].map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select>` : statusChip(r.status)} ${commentButton("request", r.id, r.title)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">해당하는 항목이 없습니다.</div>';
    $$('#workList tr[data-id]').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('select')) return; requestDetail(type, rows.find((x) => x.id == tr.dataset.id), load); }));
    $$('#workList [data-st]').forEach((s) => (s.onchange = async () => { try { await api('POST', `/api/requests/${s.dataset.st}/status`, { status: s.value }); toast(`${STATUS[s.value]}(으)로 변경`); load(); } catch (e) { fail(e); load(); } }));
  };
  $$('#stSeg button').forEach((b) => (b.onclick = () => { status = b.dataset.s; $$('#stSeg button').forEach((x) => x.classList.toggle('on', x === b)); filterForm.requestSubmit(); }));
  $$('#qcSeg button').forEach((b) => (b.onclick = () => { qc = b.dataset.qc; $$('#qcSeg button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); filterForm.requestSubmit(); }));
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
  return `<tr data-material-row><td><div class="mat-pick"><input data-material-item required maxlength="200" value="${esc(material.item)}" aria-label="자재명" list="bomMatList" autocomplete="off" placeholder="자재명 입력 또는 찾기"><button type="button" class="btn small" data-material-find title="등록된 원자재·부자재·반제품에서 고르기">찾기</button></div></td><td><select data-material-category required aria-label="자재 분류">${categoryOptions(material.item_category || '원자재')}</select></td><td><input data-material-qty type="number" required min="0.00000001" step="any" value="${esc(material.qty)}" aria-label="기준수량당 사용량"></td><td><input data-material-unit required maxlength="20" value="${esc(material.unit || 'yd')}" placeholder="yd" aria-label="자재 단위"></td><td><button type="button" class="btn small danger" data-material-remove>삭제</button></td></tr>`;
}
function bomForm(bom = {}) {
  return `<form class="stack" ${bom.id ? `data-entry-author="${esc(bom.created_by)}"` : ''}><div class="form-grid"><label>품목코드<input name="product_code" maxlength="80" value="${esc(bom.product_code)}"></label><label>품목명 *<input name="product" required maxlength="200" value="${esc(bom.product)}"></label>${categoryField(bom.item_category)}<label>규격 <span class="hint">(발주·수주·출하에 그대로 들어감)</span><input name="spec" maxlength="100" value="${esc(bom.spec || '')}" placeholder="예) 9×9인치, 140mm, 0.5T"></label><label>1차 분류<select name="cat1" data-cat-level="1"></select></label><label>2차 분류 <span class="hint">(선택)</span><select name="cat2" data-cat-level="2"></select></label><label>3차 분류 <span class="hint">(선택)</span><select name="cat3" data-cat-level="3"></select></label><p class="span3 small" data-cat-kind role="status"></p><div class="span3 semi-use" data-semi-use><label class="inline"><input type="checkbox" name="semi_enabled" ${bom.semi_type && bom.item_category !== '반제품' ? 'checked' : ''}> 반제품으로도 사용 <span class="hint">(커팅/융착·세탁에서 이 제품코드를 고릅니다)</span></label><div class="form-grid" data-semi-fields><label>생산 종류 *<select name="semi_type"><option value="">선택</option>${Object.entries(SEMI_KIND_LABEL).map(([v, l]) => `<option value="${v}" ${bom.semi_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>생산 기록 단위 *<input name="semi_unit" maxlength="20" list="unitSuggestions" value="${esc(bom.semi_unit || '')}" placeholder="예) 매 / 켤레"></label><label data-pack-row>단위 환산 * <span class="hint" data-pack-text></span><input name="pack_qty" type="number" min="0.000001" step="any" value="${esc(bom.pack_qty ?? '')}" placeholder="예) 1000"></label></div><p class="small muted" data-semi-note></p></div><label>생산 구분<select name="kind"><option value="finished" ${bom.kind !== 'semi' ? 'selected' : ''}>완제품</option><option value="semi" ${bom.kind === 'semi' ? 'selected' : ''}>반제품</option></select></label><label>기준 생산수량 *<input name="base_qty" type="number" min="0.00000001" step="any" required value="${esc(bom.base_qty || 1)}"></label><label>생산 단위 *<input name="unit" maxlength="20" required value="${esc(bom.unit || 'EA')}"></label><fieldset class="span3 inspect-skip"><legend>검사 제외 <span class="hint">(체크하면 이 품목의 검사 의뢰는 리스트에만 올라가고 「검사 제외」로 바로 완료)</span></legend><label class="inline"><input type="checkbox" name="skip_incoming"${bom.skip_incoming ? ' checked' : ''}> 수입검사 제외</label> <label class="inline"><input type="checkbox" name="skip_outgoing"${bom.skip_outgoing ? ' checked' : ''}> 출하검사 제외</label></fieldset><label class="span3">업체 정보 <span class="hint">(공급·고객 업체, 담당자·연락처 등)</span><textarea name="vendor_info" rows="2" maxlength="500" placeholder="예) 세기섬유 · 김대리 010-0000-0000 / 납품처 삼성디스플레이">${esc(bom.vendor_info || '')}</textarea></label><label class="span3">비고<textarea name="note" rows="2" maxlength="500">${esc(bom.note)}</textarea></label></div><p class="muted small">제품 BOM은 구성자재를 등록하세요. 원자재·부자재·반제품·상품은 구성자재 없이 품목으로 등록할 수 있습니다. 1차·2차·3차 세부 분류는 「분류 관리」에서 미리 만든 것 중에서 고릅니다. 반제품은 생산 종류가 지정된 분류(예: 와이퍼 › 천와이퍼)를 고르고 제품코드를 넣으면 커팅/융착·세탁 입력에서 바로 고를 수 있습니다. 반제품에 구성자재를 넣으면 생산량만큼 자재 재고가 차감됩니다.</p><div class="table-wrap"><table class="grid bom-materials"><thead><tr><th>자재명</th><th>분류</th><th>사용량</th><th>단위</th><th></th></tr></thead><tbody data-material-rows>${(bom.materials || []).map(bomMaterialRow).join('')}</tbody></table></div><button type="button" class="btn" data-material-add>+ 자재 추가</button><label class="inline"><input type="checkbox" name="active" ${bom.active !== 0 ? 'checked' : ''}> 사용 중 (생산·입고에서 선택 가능)</label><div class="actions"><button type="submit" class="btn primary">저장</button></div></form>`;
}
// 15.77 제품등록 「더보기」 메뉴: 문서 수준 이벤트는 여기서 한 번만 등록한다(화면을 다시 열어도 쌓이지 않게).
// 버튼 아래에 화면 기준으로 띄우고, 스크롤·창 크기 변경에는 위치만 다시 맞추며(버튼이 화면 밖이면 닫음), 바깥 클릭·Esc로 닫는다.
function bomMenuPlace(menu) { const list = $('.row-menu-list', menu), r = $('summary', menu).getBoundingClientRect(); list.style.top = Math.min(r.bottom + 4, innerHeight - list.offsetHeight - 8) + 'px'; list.style.right = Math.max(8, innerWidth - r.right) + 'px'; }
function bomMenuFollow() { $$('.row-menu[open]').forEach(m => { const r = $('summary', m).getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) m.open = false; else bomMenuPlace(m); }); }
addEventListener('scroll', bomMenuFollow, true); addEventListener('resize', bomMenuFollow);
// 15.212 모든 목록의 「더보기」: 한 번에 하나만 열고 버튼 아래에 띄움. 메뉴 안 단추를 누르면 닫힘.
document.addEventListener('toggle', e => { const menu = e.target; if (!(menu instanceof HTMLDetailsElement) || !menu.classList.contains('row-menu') || !menu.open) return; $$('.row-menu[open]').forEach(other => { if (other !== menu) other.open = false; }); bomMenuPlace(menu); }, true);
document.addEventListener('click', e => { const inMenu = e.target.closest('.row-menu'); if (inMenu && e.target.closest('.row-menu-list button, .row-menu-list a')) { setTimeout(() => { inMenu.open = false; }); return; } if (!inMenu) $$('.row-menu[open]').forEach(m => { m.open = false; }); });
document.addEventListener('keydown', e => { if (e.key !== 'Escape' || $('.modal-wrap')) return; const open = $$('.row-menu[open]'); open.forEach(m => { m.open = false; }); if (open.length) $('summary', open[0]).focus(); });
// 줄 단추 묶음: 자주 쓰는 것만 밖에, 나머지(삭제·취소 같은 위험한 것 포함)는 「더보기」 안에.
function rowMenu(label, items) { const list = items.filter(Boolean).join(''); return list ? `<details class="row-menu"><summary class="btn small" aria-label="${esc(label)} 더보기">더보기 ▾</summary><div class="row-menu-list">${list}</div></details>` : ''; }
async function pageBoms(main) {
  if (!ME.is_admin) { main.innerHTML = '<div class="empty">관리자만 BOM을 관리할 수 있습니다.</div>'; return; }
  main.innerHTML = '<h1>제품등록</h1><p class="muted">품목을 원자재·부자재·반제품·제품·상품으로 나누고, 미리 만든 1차·2차·3차 세부 분류에서 골라 등록합니다. 발주·출하·생산·기타입고에서 이 품목코드를 불러옵니다.</p><div class="actions wrap" style="justify-content:flex-start"><button class="btn primary" id="newBom">새 제품 등록</button><button class="btn" id="bomImport" title="품목코드·품목명·분류를 CSV·엑셀로 한 번에 등록하거나 고치기">CSV·엑셀 일괄 등록·수정</button><button class="btn" id="catManage">분류 관리</button><a class="btn" href="#/admin/bom-sheet" title="제품별 구성자재·소요량을 한 표로 보고 고치기">BOM 소요량</a></div><div class="seg class-tabs" id="bomClassTabs" role="group" aria-label="품목 분류">' + ['', ...ITEM_CATEGORIES].map(c => `<button type="button" data-class-tab="${c}">${c || '전체'}</button>`).join('') + '</div><div class="bom-view-bar"><div class="seg" id="bomViewTabs" role="group" aria-label="보기"><button type="button" data-bom-view="list">목록</button><button type="button" data-bom-view="tree">BOM 트리</button></div><div class="seg" id="bomActiveTabs" role="group" aria-label="사용 여부"><button type="button" data-bom-active="1">사용</button><button type="button" data-bom-active="0">미사용</button><button type="button" data-bom-active="">전체</button></div></div><div class="sub-tabs" id="bomSubTabs" role="group" aria-label="세부 분류" hidden></div>' + listControls('bom', { placeholder: '품목명·코드·입력자·메모', extra: `<label class="dup-filter">분류<select name="item_category" id="bomCategory">${categoryOptions('', true)}</select></label><label class="dup-filter">사용 상태<select name="active"><option value="">전체 사용 상태</option><option value="1">사용 중</option><option value="0">사용 중지</option></select></label><label>코드 상태<select name="temp"><option value="">전체</option><option value="only">임시 코드만 (정리 필요)</option></select></label>` }) + '<div id="bomList"></div>';
  const filterForm = $('#bomFilters', main); let queryVersion = 0;
  // 15.68 세부 분류 칩: 분류 탭(원자재 등)을 고르면 그 안의 1차 → 2차 세부 분류로 좁혀 본다(건수 표시, 화면에서 거름).
  let sub = { cat1: null, cat2: null }, subClass = null;
  const subTabs = $('#bomSubTabs', main);
  // 15.73 보기: 목록(한 줄에 한 품목) / BOM 트리(제품 아래 구성자재 줄). 고른 보기는 이 기기에 기억한다.
  let view = 'list'; try { view = localStorage.getItem('wpa:bom-view') === 'tree' ? 'tree' : 'list'; } catch { /* 편의 기능 */ }
  const markView = () => $$('[data-bom-view]', main).forEach(b => { b.classList.toggle('on', b.dataset.bomView === view); b.setAttribute('aria-pressed', String(b.dataset.bomView === view)); });
  $$('[data-bom-view]', main).forEach(b => b.onclick = () => { view = b.dataset.bomView; try { localStorage.setItem('wpa:bom-view', view); } catch { /* 편의 기능 */ } markView(); load().catch(fail); });
  markView();
  const load = async () => {
    if (!main.isConnected) return;
    const version = ++queryVersion; listLoading(filterForm);
    const all = await api('GET', '/api/boms?' + new URLSearchParams({ ...formObj(filterForm), include_archived: '1' }));
    if (version !== queryVersion || !main.isConnected) return;
    const cls = filterForm.elements.item_category.value;
    if (cls !== subClass) { sub = { cat1: null, cat2: null }; subClass = cls; }
    const none = '__none__'; // 세부 분류가 비어 있는 품목
    const key1 = b => b.cat1 || none, key2 = b => b.cat2 || none;
    const chip = (level, value, label, count, on) => `<button type="button" class="sub-chip${on ? ' on' : ''}" data-sub="${level}" data-sub-value="${esc(value)}" aria-pressed="${on}">${esc(label)} <span class="sub-count">${fmtNum(count)}</span></button>`;
    const groups = (list, key) => { const m = new Map(); for (const b of list) m.set(key(b), (m.get(key(b)) || 0) + 1); return [...m].sort((a, b) => (a[0] === none) - (b[0] === none) || a[0].localeCompare(b[0], 'ko')); };
    const g1 = cls ? groups(all, key1) : [];
    if (cls && g1.length > 1 || (g1.length === 1 && g1[0][0] !== none)) {
      if (sub.cat1 !== null && !g1.some(([k]) => k === sub.cat1)) sub = { cat1: null, cat2: null };
      const in1 = sub.cat1 === null ? [] : all.filter(b => key1(b) === sub.cat1), g2 = sub.cat1 !== null && sub.cat1 !== none ? groups(in1, key2) : [];
      if (sub.cat2 !== null && !g2.some(([k]) => k === sub.cat2)) sub.cat2 = null;
      subTabs.innerHTML = `<div class="sub-row">${chip(1, '', '전체', all.length, sub.cat1 === null)}${g1.map(([k, n]) => chip(1, k, k === none ? '세부 분류 없음' : k, n, sub.cat1 === k)).join('')}</div>`
        + (g2.length > 1 || (g2.length === 1 && g2[0][0] !== none) ? `<div class="sub-row sub-row-2"><span class="sub-path">${esc(sub.cat1)} ›</span>${chip(2, '', '전체', in1.length, sub.cat2 === null)}${g2.map(([k, n]) => chip(2, k, k === none ? '2차 없음' : k, n, sub.cat2 === k)).join('')}</div>` : '');
      subTabs.hidden = false;
      $$('[data-sub]', subTabs).forEach(b => b.onclick = () => {
        const v = b.dataset.subValue || null;
        if (b.dataset.sub === '1') sub = { cat1: v, cat2: null }; else sub.cat2 = v;
        load().catch(fail);
      });
    } else { subTabs.hidden = true; subTabs.innerHTML = ''; sub = { cat1: null, cat2: null }; }
    const boms = all.filter(b => (sub.cat1 === null || key1(b) === sub.cat1) && (sub.cat2 === null || key2(b) === sub.cat2));
    listCount(filterForm, boms.length);
    // 15.67: 카드 대신 한 줄에 한 품목(표). 구성자재는 「자재 N개」를 눌러 펼친다. 휴대폰에서는 표가 카드로 바뀐다.
    const bomMaterials = bom => bom.materials && bom.materials.length ? `<details class="bom-mats"><summary>${bom.materials.length === 1 ? esc(bom.materials[0].item) : `자재 ${bom.materials.length}개`}</summary><ul>${bom.materials.map(m => `<li>${esc(m.item)} <span class="muted">${esc(m.item_category || '')}</span> <b>${fmtNum(m.qty)}</b> ${esc(m.unit || '')}</li>`).join('')}</ul><div class="small muted">기준 ${fmtNum(bom.base_qty)} ${esc(bom.unit)}당</div></details>` : '<span class="muted">—</span>';
    // 15.74 가독성: 코드 칸을 맨 앞에, 한 줄 높이·줄무늬, 버튼은 「수정」 + 「⋯」(진행 코멘트·사용 중지/다시 사용·합치기·삭제), 사용 중 품목을 위로.
    const sorted = boms.slice().sort((a, b) => (b.active - a.active));
    const classPath = bom => [bom.item_category || '미분류', bom.cat1, bom.cat2, bom.cat3].filter(Boolean).join(' › ');
    $('#bomList').innerHTML = sorted.length ? `<div class="table-wrap"><table class="grid bom-table"><caption class="sr-only">제품 목록</caption><thead><tr><th scope="col">코드</th><th scope="col" class="c">NO</th><th scope="col">품목명</th><th scope="col">분류</th><th scope="col">단위 · 기준</th><th scope="col">구성자재</th><th scope="col">업체 정보</th><th scope="col">비고</th><th scope="col">상태</th><th scope="col"><span class="sr-only">작업</span></th></tr></thead><tbody>${sorted.map((bom, bi) => `<tr class="bom-row${bom.active ? '' : ' row-off'}" title="입력: ${esc(bom.created_by || '미기록')} · ${esc(String(bom.created_at || '').slice(0, 16))}">
      <td class="bom-code nowrap">${bom.product_code ? `<b>${esc(bom.product_code)}</b>` : '<span class="muted">코드 없음</span>'}${bom.is_temp ? ' <span class="chip yellow">임시</span>' : ''}</td>
      <td class="c small muted bom-no">${bi + 1}</td>
      <td data-card-primary class="bom-name"><b>${esc(bom.product)}</b>${bom.spec ? ` <span class="small muted">${esc(bom.spec)}</span>` : ''}${bom.skip_incoming ? ' <span class="chip">수입검사 제외</span>' : ''}${bom.skip_outgoing ? ' <span class="chip">출하검사 제외</span>' : ''}</td>
      <td class="bom-class">${esc(classPath(bom))}${bom.semi_type ? ` <span class="chip green">생산: ${esc(bom.semi_type)}</span>` : ''}${bom.sizes?.length ? ` <span class="small muted">사이즈 ${esc(bom.sizes.join('·'))}</span>` : ''}</td>
      <td class="nowrap">${esc(bom.unit || '—')}${['제품', '반제품'].includes(bom.item_category) ? ` <span class="small muted">· ${bom.kind === 'finished' ? '완제품' : '반제품'} 기준 ${fmtNum(bom.base_qty)}</span>` : ''}${bom.pack_qty ? `<div class="small muted">1${esc(bom.unit)} = ${fmtNum(bom.pack_qty)}${esc(bom.semi_unit)}</div>` : ''}</td>
      <td>${bomMaterials(bom)}</td>
      <td class="bom-memo">${bom.vendor_info ? esc(bom.vendor_info) : '<span class="muted">—</span>'}</td>
      <td class="bom-memo">${bom.note ? esc(bom.note) : '<span class="muted">—</span>'}</td>
      <td class="nowrap"><span class="st-dot${bom.active ? ' on' : ''}">${bom.active ? '사용' : '중지'}</span></td>
      <td data-card-primary class="bom-actions"><button class="btn small" data-bom-edit="${bom.id}">${bom.is_temp ? '정식 코드로 확정' : '수정'}</button><details class="row-menu"><summary class="btn small" aria-label="${esc(bom.product)} 더보기">더보기 ▾</summary><div class="row-menu-list">${commentButton("bom", bom.id, bom.product)}${bom.is_temp && bom.active ? `<button class="btn small" data-bom-merge="${bom.id}">기존 품목으로 합치기</button>` : ''}${bom.active ? `<button class="btn small" data-bom-disable="${bom.id}">사용 중지</button>` : `<button class="btn small" data-bom-enable="${bom.id}">다시 사용</button>`}<button class="btn small danger" data-bom-delete="${bom.id}">삭제</button></div></details></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${filterForm.elements.q?.value.trim() ? '조건에 맞는 제품이 없습니다.' : '등록된 제품이 없습니다.'}<div data-bom-hidden-hit></div></div>`;
    // 15.192 「사용」만 보는데 검색어로 찾은 게 없으면, 사용 중지된 품목에 있는지 알려 주고 바로 보게 한다(코드가 이미 쓰인다는 안내와 맞춤).
    if (!sorted.length && filterForm.elements.q?.value.trim() && filterForm.elements.active.value === '1') api('GET', '/api/boms?' + new URLSearchParams({ ...formObj(filterForm), active: '0', include_archived: '1' })).then(off => { const box = $('[data-bom-hidden-hit]', main); if (!box || version !== queryVersion || !off.length) return; box.innerHTML = `<p class="small">사용 중지된 품목에 ${off.length}건 있습니다: ${off.slice(0, 3).map(b => `<b>${esc(b.product_code || '코드 없음')}</b> ${esc(b.product)}`).join(', ')}${off.length > 3 ? ' …' : ''}</p><button type="button" class="btn small" data-bom-show-off>미사용에서 보기</button>`; $('[data-bom-show-off]', box).onclick = () => $('[data-bom-active="0"]', main)?.click(); }).catch(() => {});
    // 「더보기」 메뉴: 한 번에 하나만, 버튼 아래에 떠서 열린다(표 칸 안에서 펼치면 줄이 커지고 잘리므로 화면 기준 위치).
    // 「더보기」 메뉴 열기·위치는 공용 처리(15.212)
    if (view === 'tree') {
      // 코드·역조회는 조건과 상관없이 전체 품목에서 찾는다.
      const everything = await api('GET', '/api/boms?include_archived=1').catch(() => all);
      if (version !== queryVersion || !main.isConnected) return;
      renderBomTree($('#bomList'), boms, everything, load, id => edit(boms.find(b => b.id === id)));
    }
    const edit = async bom => {
      let nodes; try { nodes = await api('GET', '/api/item-categories'); } catch (error) { fail(error); return; }
      const box = modal(`<h3>${bom ? (bom.is_temp ? '정식 코드로 확정' : '제품 수정') : '새 제품 등록'}</h3>${bomForm(bom)}`, { wide: true });
      const form = $('form', box.el); const rows = $('[data-material-rows]', form);
      const picker = bindCategoryPicker(form, nodes, bom || {});

      // 15.190 구성자재: 제품등록에 올린 원자재·부자재·반제품(사용 중)을 목록으로 제안하고 「찾기」로 고른다. 고르면 분류·단위도 맞춘다.
      const catalog = await api('GET', '/api/boms').catch(() => []);
      const mats = catalog.filter(b => b.item_category !== '제품' && (!bom || b.id !== bom.id));
      form.insertAdjacentHTML('beforeend', `<datalist id="bomMatList">${mats.map(b => `<option value="${esc(b.product)}">${esc([b.product_code, b.item_category, b.spec].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>`);
      const fillMat = (row, b) => { $('[data-material-item]', row).value = b.product; const c = $('[data-material-category]', row); if ([...c.options].some(o => o.value === b.item_category)) c.value = b.item_category; if (b.unit) $('[data-material-unit]', row).value = b.unit; $('[data-material-qty]', row).focus(); };
      const findMat = async row => { if (!mats.length) { toast('제품등록에 원자재·부자재가 아직 없습니다. 자재명을 직접 입력하세요.', 'err'); return; } const b = await openItemPicker(mats, { title: '구성자재 찾기', query: $('[data-material-item]', row).value.trim(), lots: false, emptyText: '찾는 자재가 없습니다. 창을 닫고 자재명을 직접 입력하세요.' }); if (b && !b.items) fillMat(row, b); };
      $('[data-material-add]', form).onclick = () => { rows.insertAdjacentHTML('beforeend', bomMaterialRow()); const row = rows.lastElementChild; if (mats.length) findMat(row).catch(fail); else $('[data-material-item]', row).focus(); };
      rows.onclick = event => { const find = event.target.closest('[data-material-find]'); if (find) { findMat(find.closest('tr')).catch(fail); return; } const button = event.target.closest('[data-material-remove]'); if (button) button.closest('tr').remove(); };
      rows.addEventListener('change', event => { const input = event.target.closest('[data-material-item]'); if (!input) return; const key = input.value.replace(/\s+/g, '').toLowerCase(); const b = mats.find(x => x.product.replace(/\s+/g, '').toLowerCase() === key); if (b) fillMat(input.closest('tr'), b); });
      form.onsubmit = async event => {
        event.preventDefault();
        const problem = picker.problem(); if (problem) { toast(problem, 'err'); return; }
        const button = $('button.primary', form); button.disabled = true;
        const values = { ...formObj(form), cat1: form.elements.cat1.value, cat2: form.elements.cat2.value, cat3: form.elements.cat3.value }; // empty levels are disabled selects but must still be sent
        const materials = $$('[data-material-row]', form).map(row => ({ item: $('[data-material-item]', row).value, item_category: $('[data-material-category]', row).value, qty: $('[data-material-qty]', row).value, unit: $('[data-material-unit]', row).value }));
        try { await api(bom ? 'PUT' : 'POST', '/api/boms' + (bom ? '/' + bom.id : ''), { ...values, active: form.elements.active.checked, skip_incoming: form.elements.skip_incoming.checked, skip_outgoing: form.elements.skip_outgoing.checked, materials }); box.close(); toast('저장했습니다.'); await load(); refreshNavBadges(); }
        catch (error) { fail(error); } finally { button.disabled = false; }
      };
    };
    $('#newBom').onclick = () => edit();
    if ($('#bomImport')) $('#bomImport').onclick = () => importDialog({ title: '품목 일괄 등록·수정 (CSV·엑셀)', endpoint: '/api/import/items', after: () => load(),
      help: '꼭 필요한 칸은 <b>품목코드 · 품목명 · 분류</b>입니다(머리글 없이 이 순서로 써도 됩니다). 분류는 원자재·부자재·반제품·제품·상품·임가공. 단위를 비우면 EA. 제품은 구성자재 없이 등록되니 나중에 「수정」에서 BOM을 넣으세요. 1·2·3차 분류는 분류 관리에 있는 이름만.',
      columns: [['product_code', '품목코드', '제품코드', '코드'], ['product', '품목명', '품목', '제품명'], ['item_category', '분류', '품목구분', '구분'], ['unit', '단위'], ['spec', '규격'], ['cat1', '1차 분류', '1차분류'], ['cat2', '2차 분류', '2차분류'], ['cat3', '3차 분류', '3차분류'], ['note', '비고', '메모']],
      sample: [{ product_code: 'R-001', product: '(예) 나일론 원사', item_category: '원자재' }, { product_code: '10-007', product: '(예) CF-707 (인쇄)(50P)(5.5X6.5)', item_category: '제품' }, { product_code: 'G-001', product: '(예) 클린룸 와이퍼 9인치', item_category: '상품' }], csvCols: 3, updateLabel: '이미 있는 품목코드는 고치기 (품목명·분류 수정 — 단위·규격·비고는 값이 있을 때만)' });
    $('#catManage').onclick = () => manageItemCategories(filterForm.elements.item_category.value || '원자재');
    $$('[data-bom-merge]', main).forEach(button => button.onclick = async () => {
      const temp = boms.find(bom => bom.id === Number(button.dataset.bomMerge));
      const targets = (await api('GET', '/api/boms')).filter(bom => bom.id !== temp.id);
      if (!targets.length) return toast('합칠 정식 품목이 없습니다. 먼저 정식 코드로 확정하세요.', 'err');
      const value = await promptBox(`${temp.product} (${temp.product_code}) 합치기`, `<p class="small muted">이 임시 품목으로 등록된 발주·출하·기타입고가 선택한 품목의 이름과 코드로 바뀌고, 임시 품목은 사용 중지됩니다. 수입검사 기록은 입고 당시 이름을 유지합니다.</p><label>합칠 품목 *<select name="target_id" required><option value="">선택</option>${targets.map(bom => `<option value="${bom.id}">[${esc(bom.item_category || '미분류')}] ${esc(bom.product)} ${esc(bom.product_code)}</option>`).join('')}</select></label>`);
      if (!value) return;
      try { await api('POST', `/api/boms/${temp.id}/merge`, value); toast('기존 품목으로 합쳤습니다.'); await load(); refreshNavBadges(); } catch (error) { fail(error); }
    });
    $$('[data-bom-edit]', main).forEach(button => button.onclick = () => edit(boms.find(bom => bom.id === Number(button.dataset.bomEdit))));
    // 15.64 완전 삭제: 어디에도 쓰이지 않은 품목만. 쓰이는 품목은 사용처와 함께 사용 중지·합치기를 안내한다.
    $$('[data-bom-delete]', main).forEach(button => button.onclick = async () => {
      const bom = boms.find(b => b.id === Number(button.dataset.bomDelete));
      let usage; try { usage = await api('GET', `/api/boms/${bom.id}/usage`); } catch (error) { fail(error); return; }
      const name = `${bom.product}${bom.product_code ? ` (${bom.product_code})` : ''}`;
      if (usage.total) {
        const box = modal(`<h3>${esc(name)} 삭제할 수 없음</h3><p>이 품목은 아래 기록에서 쓰고 있어 지우면 기록의 연결이 끊깁니다.</p><ul class="bom-uses">${usage.uses.map(u => `<li>${esc(u.label)} <b>${fmtNum(u.count)}건</b></li>`).join('')}</ul>
          <p class="small muted"><span>목록에서 안 보이게 하려면 「사용 중지」하세요(기록은 그대로).</span>${bom.is_temp ? ' <span>임시 코드라면 「기존 품목으로 합치기」로 기록을 정식 품목으로 옮긴 뒤 삭제할 수 있습니다.</span>' : ''}</p>
          <div class="actions">${bom.is_temp && bom.active ? '<button class="btn" data-use-merge>기존 품목으로 합치기</button>' : ''}${bom.active ? '<button class="btn danger" data-use-disable>사용 중지</button>' : ''}<button class="btn primary" data-use-close>닫기</button></div>`);
        $('[data-use-close]', box.el).onclick = () => box.close();
        const merge = $('[data-use-merge]', box.el); if (merge) merge.onclick = () => { box.close(); $(`[data-bom-merge="${bom.id}"]`, main)?.click(); };
        const off = $('[data-use-disable]', box.el); if (off) off.onclick = async () => { try { await api('DELETE', '/api/boms/' + bom.id); box.close(); toast('사용 중지했습니다.'); await load(); refreshNavBadges(); } catch (error) { fail(error); } };
        return;
      }
      if (!await confirmBox(`${name}을(를) 완전히 삭제할까요? 어디에도 쓰이지 않은 품목이라 기록에는 영향이 없습니다. 되돌릴 수 없습니다.`)) return;
      try { await api('DELETE', `/api/boms/${bom.id}?purge=1`); toast('삭제했습니다.'); await load(); refreshNavBadges(); } catch (error) { fail(error); }
    });
    $$('[data-bom-enable]', main).forEach(button => button.onclick = async () => {
      const bom = boms.find(b => b.id === Number(button.dataset.bomEnable));
      try { await api('POST', `/api/boms/${bom.id}/quick`, { updated_at: bom.updated_at, before: { base_qty: bom.base_qty, active: !!bom.active, qty: (bom.materials || []).map(m => m.qty) }, active: true }); toast('다시 사용합니다.'); await load(); } catch (error) { fail(error); }
    });
    $$('[data-bom-disable]', main).forEach(button => button.onclick = async () => {
      if (!await confirmBox('이 BOM을 생산 선택 목록에서 사용 중지할까요? 기존 생산일정은 유지됩니다.')) return;
      try { await api('DELETE', '/api/boms/' + button.dataset.bomDisable); await load(); } catch (error) { fail(error); }
    });
  };
  bindListControls(filterForm, load);
  const tabs = $('#bomClassTabs', main), classSelect = filterForm.elements.item_category;
  const markTab = () => $$('[data-class-tab]', tabs).forEach(b => b.classList.toggle('on', b.dataset.classTab === classSelect.value));
  $$('[data-class-tab]', tabs).forEach(b => b.onclick = () => { classSelect.value = b.dataset.classTab; markTab(); classSelect.dispatchEvent(new Event('change', { bubbles: true })); });
  classSelect.addEventListener('change', markTab); markTab();
  // 15.73 사용 여부 빠른 선택(목록 조건의 「사용 상태」와 같은 값)
  const activeSelect = filterForm.elements.active;
  const markActive = () => $$('[data-bom-active]', main).forEach(b => { b.classList.toggle('on', b.dataset.bomActive === activeSelect.value); b.setAttribute('aria-pressed', String(b.dataset.bomActive === activeSelect.value)); });
  $$('[data-bom-active]', main).forEach(b => b.onclick = () => { activeSelect.value = b.dataset.bomActive; markActive(); activeSelect.dispatchEvent(new Event('change', { bubbles: true })); });
  activeSelect.addEventListener('change', markActive); markActive();
  await load();
}

// ── 제품등록: 미리 만든 세부 분류에서 고르기 ──
const SEMI_KIND_LABEL = { '부직포와이퍼': '와이퍼 · 부직포와이퍼', '천와이퍼': '와이퍼 · 천와이퍼', '스무드': '심리스글러브 · 스무드', '타키': '심리스글러브 · 타키' };
function bindCategoryPicker(form, nodes, bom) {
  const classSelect = form.elements.item_category, selects = [1, 2, 3].map(level => form.elements['cat' + level]), hint = $('[data-cat-kind]', form);
  // An older 반제품 that only had a kind starts on the matching prepared path.
  let start = [bom.cat1 || '', bom.cat2 || '', bom.cat3 || ''];
  if (!start[0] && bom.semi_type) { const node = nodes.find(n => n.item_class === '반제품' && n.active && n.semi_type === bom.semi_type); if (node) { const parent = nodes.find(n => n.id === node.parent_id); start = node.level === 2 && parent ? [parent.name, node.name, ''] : [node.name, '', '']; } }
  const childrenOf = (level, parentId) => nodes.filter(n => n.item_class === classSelect.value && n.level === level && (n.parent_id || 0) === parentId);
  const chosen = () => { const path = []; let parent = 0; for (const [i, select] of selects.entries()) { const node = childrenOf(i + 1, parent).find(n => n.name === select.value); if (!node) break; path.push(node); parent = node.id; } return path; };
  const fill = (level, wanted) => {
    const parent = level === 1 ? 0 : chosen()[level - 2]?.id; const select = selects[level - 1];
    const options = parent === undefined ? [] : childrenOf(level, parent).filter(n => n.active || n.name === wanted);
    select.innerHTML = `<option value="">${!classSelect.value ? '품목 분류를 먼저 선택' : parent === undefined ? '상위 분류를 먼저 선택' : options.length ? '선택 안 함' : '하위 분류 없음'}</option>` + options.map(n => `<option value="${esc(n.name)}">${esc(n.name)}${n.active ? '' : ' (사용 중지)'}</option>`).join('');
    select.value = options.some(n => n.name === wanted) ? wanted : ''; select.disabled = !options.length;
  };
  const kind = () => chosen().reduce((found, n) => n.semi_type || found, '');
  const update = () => {
    const semi = classSelect.value === '반제품', type = kind();
    form.elements.product_code.required = semi; form.elements.product_code.closest('label').firstChild.textContent = semi ? '품목코드 * ' : '품목코드';
    hint.className = 'span3 small ' + (semi && !type ? 'red-text' : 'muted');
    hint.textContent = !classSelect.value ? '품목 분류를 먼저 고르면 세부 분류가 나옵니다.' : semi ? (type ? `커팅/융착·세탁 입력에서 「${SEMI_KIND_LABEL[type] || type}」 품목으로 고를 수 있습니다. 제품코드는 필수입니다.` : '반제품은 생산 종류가 지정된 분류를 골라야 커팅/융착·세탁에서 고를 수 있습니다. (분류 관리에서 지정)') : '';
  };
  const refresh = (from, values) => { for (let level = from; level <= 3; level++) fill(level, values[level - 1]); update(); };
  classSelect.addEventListener('change', () => { refresh(1, ['', '', '']); if (form.elements.kind) form.elements.kind.value = classSelect.value === '반제품' ? 'semi' : 'finished'; });
  selects.forEach((select, i) => select.onchange = () => refresh(i + 2, selects.map(s => s.value)));
  refresh(1, start);
  // '반제품으로도 사용': kind, production unit and box conversion for items that are not 반제품.
  const use = $('[data-semi-use]', form), on = form.elements.semi_enabled, fields = $('[data-semi-fields]', form);
  const unitInput = form.elements.unit, semiUnit = form.elements.semi_unit, pack = form.elements.pack_qty, packRow = $('[data-pack-row]', form);
  const syncUse = () => {
    const show = classSelect.value && classSelect.value !== '반제품'; use.hidden = !show; on.disabled = !show;
    const active = show && on.checked; fields.hidden = !active;
    for (const el of [form.elements.semi_type, semiUnit, pack]) el.disabled = !active;
    form.elements.semi_type.required = semiUnit.required = active;
    if (active && !semiUnit.value) semiUnit.value = ['스무드', '타키'].includes(form.elements.semi_type.value) ? '켤레' : '매';
    const differs = active && semiUnit.value.trim() && semiUnit.value.trim() !== unitInput.value.trim();
    packRow.hidden = !differs; pack.disabled = !differs; pack.required = !!differs;
    $('[data-pack-text]', form).textContent = differs ? `(1 ${unitInput.value || '단위'} = 몇 ${semiUnit.value}?)` : '';
    $('[data-semi-note]', form).textContent = active ? `발주·출하는 ${unitInput.value || '생산 단위'}, 커팅/융착·세탁 기록은 ${semiUnit.value || '생산 기록 단위'}로 남습니다.${differs ? ' 재고 화면에서 두 단위를 서로 환산해 보여 줍니다.' : ''}` : '';
    if (active) { form.elements.product_code.required = true; form.elements.product_code.closest('label').firstChild.textContent = '품목코드 * '; }
  };
  on.addEventListener('change', syncUse); form.elements.semi_type.addEventListener('change', () => { if (['스무드', '타키'].includes(form.elements.semi_type.value) && semiUnit.value === '매') semiUnit.value = '켤레'; else if (!['스무드', '타키'].includes(form.elements.semi_type.value) && semiUnit.value === '켤레') semiUnit.value = '매'; syncUse(); });
  semiUnit.addEventListener('input', syncUse); unitInput.addEventListener('input', syncUse); classSelect.addEventListener('change', syncUse); syncUse();
  return { problem: () => classSelect.value === '반제품' && !kind() ? '반제품은 생산 종류가 지정된 분류(예: 와이퍼 › 천와이퍼)를 선택하세요.' : '' };
}

// ── 제품등록: 세부 분류 관리 (관리자) ──
async function manageItemCategories(startClass = '원자재') {
  let nodes = [], current = ITEM_CATEGORIES.includes(startClass) && startClass !== '임가공' ? startClass : '원자재'; // 임가공은 세부 분류를 쓰지 않는다
  const box = modal(`<h3>분류 관리</h3><p class="small muted">품목 분류마다 1차·2차·3차 세부 분류를 미리 만들어 두면 제품등록에서 고를 수 있습니다(2·3차는 없어도 됩니다). 방진복처럼 사이즈가 정해진 분류에는 사이즈 묶음을 넣으면, 그 아래 품목은 발주·기타입고·출하에서 사이즈별 수량으로 한 번에 입력합니다. 이름을 바꾸면 그 분류로 등록된 품목에도 반영됩니다. 쓰지 않는 분류는 사용 중지하면 새 등록에서만 빠집니다. 하위 분류도 등록된 품목도 없는 분류는 삭제할 수 있습니다. 반제품 분류에는 커팅/융착·세탁에서 쓸 생산 종류를 지정합니다(하위 분류는 물려받음).</p><div class="seg class-tabs" data-cat-tabs>${ITEM_CATEGORIES.filter(c => c !== '임가공').map(c => `<button type="button" data-cat-tab="${c}">${c}</button>`).join('')}</div><div data-cat-tree></div><div class="actions"><button type="button" class="btn" data-cat-close>닫기</button><button type="button" class="btn primary" data-cat-add-root>1차 분류 추가</button></div>`, { wide: true });
  const tree = $('[data-cat-tree]', box.el);
  const sizeField = value => `<label>사이즈 묶음 <span class="hint">(쉼표로 구분 · 비우면 상위 분류를 따름)</span><input name="sizes" maxlength="200" value="${esc(value)}" placeholder="예) XS,S,M,L,XL"></label><div class="actions wrap" style="justify-content:flex-start;margin-top:0">${['XS,S,M,L,XL', 'S,M,L,XL,2XL', 'XS,S,M,L,XL,2XL,3XL'].map(v => `<button type="button" class="btn small" data-size-preset="${v}">${v.split(',')[0]}~${v.split(',').at(-1)}</button>`).join('')}</div>`;
  box.el.ownerDocument.addEventListener('click', event => { const b = event.target.closest('[data-size-preset]'); if (b) b.closest('form').elements.sizes.value = b.dataset.sizePreset; });
  const kindSelect = value => `<label>생산 종류 <span class="hint">(커팅/세탁에서 고를 종류, 비우면 상위 분류를 따름)</span><select name="semi_type"><option value="">지정 안 함</option>${Object.entries(SEMI_KIND_LABEL).map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const draw = () => {
    $$('[data-cat-tab]', box.el).forEach(b => b.classList.toggle('on', b.dataset.catTab === current));
    const branch = (parentId, level) => {
      const list = nodes.filter(n => n.item_class === current && (n.parent_id || 0) === parentId && n.level === level);
      if (!list.length) return level === 1 ? '<p class="muted">아직 세부 분류가 없습니다. 「1차 분류 추가」로 시작하세요.</p>' : '';
      return `<ul class="cat-tree">${list.map(n => `<li><div class="cat-node ${n.active ? '' : 'off'}"><b>${esc(n.name)}</b> <span class="small muted">${level}차</span>${n.semi_type ? ` <span class="chip green">${esc(SEMI_KIND_LABEL[n.semi_type] || n.semi_type)}</span>` : ''}${n.sizes ? ` <span class="chip">사이즈 ${esc(n.sizes.replaceAll(',', '·'))}</span>` : ''}${n.active ? '' : ' <span class="chip">사용 중지</span>'}
        <span class="cat-actions">${level < 3 && n.active ? `<button type="button" class="btn small" data-cat-add="${n.id}">하위 추가</button>` : ''}<button type="button" class="btn small" data-cat-edit="${n.id}">수정</button><button type="button" class="btn small ${n.active ? 'danger' : ''}" data-cat-toggle="${n.id}">${n.active ? '사용 중지' : '다시 사용'}</button><button type="button" class="btn small danger" data-cat-del="${n.id}">삭제</button></span></div>${branch(n.id, level + 1)}</li>`).join('')}</ul>`;
    };
    tree.innerHTML = branch(0, 1);
  };
  const load = async () => { nodes = await api('GET', '/api/item-categories'); if (box.el.isConnected) draw(); };
  const add = async parent => {
    const title = parent ? `${parent.name} 아래 ${parent.level + 1}차 분류 추가` : `${current} 1차 분류 추가`;
    await promptBox(title, `<label>분류 이름 *<input name="name" required maxlength="50" placeholder="예) ${parent ? '천와이퍼' : '와이퍼'}"></label>${current === '반제품' ? kindSelect('') : ''}${sizeField('')}`, { submit: v => api('POST', '/api/item-categories', { item_class: current, parent_id: parent ? parent.id : null, ...v }) }) && toast('분류를 추가했습니다.');
    await load();
  };
  box.el.addEventListener('click', async event => {
    const b = event.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.catTab) { current = b.dataset.catTab; draw(); }
      else if (b.hasAttribute('data-cat-close')) box.close();
      else if (b.hasAttribute('data-cat-add-root')) await add(null);
      else if (b.dataset.catAdd) await add(nodes.find(n => n.id === Number(b.dataset.catAdd)));
      else if (b.dataset.catEdit) {
        const n = nodes.find(x => x.id === Number(b.dataset.catEdit));
        if (await promptBox(`분류 수정 · ${n.name}`, `<label>분류 이름 *<input name="name" required maxlength="50" value="${esc(n.name)}"></label>${n.item_class === '반제품' ? kindSelect(n.semi_type) : ''}${sizeField(n.sizes || '')}<p class="small muted">이름을 바꾸면 이 분류로 등록된 품목의 분류 이름도 함께 바뀝니다.</p>`, { submit: v => api('PUT', `/api/item-categories/${n.id}`, v) })) toast('분류를 수정했습니다.');
        await load();
      } else if (b.dataset.catDel) {
        const n = nodes.find(x => x.id === Number(b.dataset.catDel));
        if (!(await confirmBox(`「${n.name}」 분류를 삭제할까요? 하위 분류나 이 분류로 등록된 품목이 있으면 삭제되지 않습니다.`))) return;
        await api('DELETE', `/api/item-categories/${n.id}`); toast('분류를 삭제했습니다.'); await load();
      } else if (b.dataset.catToggle) {
        const n = nodes.find(x => x.id === Number(b.dataset.catToggle));
        if (n.active && !(await confirmBox(`「${n.name}」을(를) 사용 중지할까요? 이미 등록된 품목은 그대로이고, 새 등록에서만 고를 수 없게 됩니다.`))) return;
        await api('PUT', `/api/item-categories/${n.id}`, { active: !n.active }); await load();
      }
    } catch (error) { fail(error); }
  });
  await load();
}

const PERIOD = { day: '일간', week: '주간', month: '월간' };
function planProgress(s) {
  const rate = s.qty ? Math.round((s.actual_qty || 0) / s.qty * 1000) / 10 : 0;
  return `<span class="plan-progress" title="달성률 ${rate}%"><span class="plan-bar"><i style="width:${Math.min(100, rate)}%"></i></span><span class="small">실적 ${s.actual_count ? fmtNum(s.actual_qty || 0) : '미입력'} / 계획 ${fmtNum(s.qty)} · ${rate}%</span></span>`;
}
// ── 15.118 생산계획표: 행 = 제품(·규격), 열 = 날짜(주간·월간 일별) 또는 주차(월간 기본). 칸 = 계획 합 / 실적 합, 색으로 달성 상태.
// 주간·월간 계획은 위쪽 띠(그 기간 전체). 행 끝 = 제품 합계·달성률, 아래 줄 = 열 합계. 일요일 열은 늘 보인다.
function scheduleGrid({ rows, from, to, view, monthCols, today }) {
  const cols = [];
  if (view === 'week' || monthCols === 'day') for (let d = from; d <= to; d = addDays(d, 1)) cols.push({ from: d, to: d, label: view === 'week' ? `${d.slice(5)} ${dow(d)}` : `${Number(d.slice(8))}`, sub: view === 'week' ? '' : dow(d), day: true });
  else { let n = 1; for (let m = mondayOf(from); m <= to; m = addDays(m, 7), n++) { const a = m < from ? from : m, b = addDays(m, 6) > to ? to : addDays(m, 6); cols.push({ from: a, to: b, label: `${n}주`, sub: a === b ? a.slice(5) : `${a.slice(5)}~${b.slice(5)}` }); } }
  const days = rows.filter(r => r.period === 'day'), periods = rows.filter(r => r.period !== 'day');
  const key = r => `${r.product}\u0000${r.spec || ''}`;
  const groups = new Map();
  for (const r of days) { if (!groups.has(key(r))) groups.set(key(r), { product: r.product, spec: r.spec || '', bom_id: r.bom_id || null, list: [] }); groups.get(key(r)).list.push(r); }
  const products = [...groups.values()].sort((a, b) => a.product.localeCompare(b.product, 'ko') || a.spec.localeCompare(b.spec, 'ko'));
  const sum = (list, k) => list.reduce((t, r) => t + (Number(k === 'qty' ? r.qty : r.actual_qty) || 0), 0);
  const tone = (list, end) => { if (!list.length) return ''; const plan = sum(list, 'qty'), act = sum(list, 'act'); if (plan && act >= plan) return 'g-done'; if (end < today && act < plan) return 'g-late'; if (act > 0) return 'g-part'; return 'g-none'; };
  const pct = (a, p) => p ? `${Math.round(a / p * 1000) / 10}%` : '';
  const num = n => fmtNum(Math.round(n * 1000) / 1000);
  const inCol = (list, c) => list.filter(r => r.start_date >= c.from && r.start_date <= c.to);
  const cells = [];
  const cell = (row, c) => {
    const list = inCol(row.list, c), plan = sum(list, 'qty'), act = sum(list, 'act'), isToday = c.from <= today && today <= c.to;
    const id = cells.push({ row, list, from: c.from, to: c.to, addable: !!c.day, title: `${row.product}${row.spec ? ' · ' + row.spec : ''} · ${c.from === c.to ? `${c.from} (${dow(c.from)})` : `${c.from} ~ ${c.to}`}` }) - 1;
    return `<td class="g-cell ${tone(list, c.to)}${isToday ? ' g-today' : ''}" data-grid-cell="${id}" tabindex="0" title="${list.length ? `계획 ${num(plan)} · 실적 ${num(act)}${list.length > 1 ? ` · ${list.length}건` : ''}` : c.day ? '눌러서 일정 추가' : ''}">${list.length ? `<b>${num(plan)}</b><span>${list.some(r => r.actual_count) ? num(act) : '—'}</span>` : c.day ? '<i>+</i>' : ''}</td>`;
  };
  const head = `<tr><th class="g-prod">제품</th>${cols.map(c => `<th class="g-col${c.from <= today && today <= c.to ? ' g-today' : ''}${c.day && parseD(c.from).getDay() === 0 ? ' g-sun' : ''}">${esc(c.label)}${c.sub ? `<div class="small">${esc(c.sub)}</div>` : ''}</th>`).join('')}<th class="g-tot">합계 · 달성</th></tr>`;
  const bands = periods.map(p => { const a = Number(p.actual_qty) || 0, end = p.period === 'week' ? addDays(p.start_date, 6) : monthEnd(p.start_date);
    return `<tr class="g-band"><th class="g-prod"><span class="tag">${PERIOD[p.period]}</span> ${esc(p.product)}${p.spec ? ` <span class="small muted">${esc(p.spec)}</span>` : ''}</th><td colspan="${cols.length}"><button type="button" class="g-bar ${tone([p], end)}" data-grid-plan="${p.id}"><span class="g-fill" style="width:${Math.min(100, p.qty ? a / p.qty * 100 : 0)}%"></span><b>${p.period === 'week' ? `${p.start_date.slice(5)}~${end.slice(5)}` : p.start_date.slice(0, 7)} · 계획 ${num(p.qty)} · 실적 ${num(a)} (${pct(a, p.qty) || '0%'})</b></button></td><td class="g-tot">${num(p.qty)}<div class="small">${pct(a, p.qty) || '0%'}</div></td></tr>`; }).join('');
  const body = products.map(row => { const plan = sum(row.list, 'qty'), act = sum(row.list, 'act');
    return `<tr><th class="g-prod">${esc(row.product)}${row.spec ? `<div class="small muted">${esc(row.spec)}</div>` : ''}</th>${cols.map(c => cell(row, c)).join('')}<td class="g-tot"><b>${num(plan)}</b><div class="small">${num(act)} · ${pct(act, plan) || '0%'}</div></td></tr>`; }).join('');
  const colTot = cols.map(c => { const list = inCol(days, c); return { plan: sum(list, 'qty'), act: sum(list, 'act') }; });
  const allPlan = sum(days, 'qty'), allAct = sum(days, 'act');
  const foot = `<tr class="g-foot"><th class="g-prod">${cols[0]?.day ? '일 합계' : '주 합계'}</th>${colTot.map(t => `<td>${t.plan ? `<b>${num(t.plan)}</b><span>${num(t.act)}</span>` : ''}</td>`).join('')}<td class="g-tot"><b>${num(allPlan)}</b><div class="small">${num(allAct)} · ${pct(allAct, allPlan) || '0%'}</div></td></tr>`;
  const legend = `<p class="small muted g-legend">칸 = <b>계획</b> / 실적 · <span class="g-key g-done"></span>달성 <span class="g-key g-part"></span>일부 <span class="g-key g-late"></span>지난 날 미달 <span class="g-key g-none"></span>실적 미입력 · ${cols[0]?.day ? '빈 칸을 누르면 그 날짜에 일정 추가' : '칸을 누르면 그 주 일정'} · 합계는 일간 일정 기준</p>`;
  const html = (products.length || periods.length) ? `${legend}<div class="table-wrap g-wrap"><table class="g-table${cols.length > 10 ? ' g-wide' : ''}" data-no-sort data-keep-cols><thead>${head}</thead><tbody>${bands}${body}</tbody><tfoot>${foot}</tfoot></table></div>` : '<div class="empty">이 기간에 일정이 없습니다.</div>';
  const xlsx = { columns: [{ label: '제품', type: 'text', width: 24 }, { label: '규격', type: 'text' }, { label: '구분', type: 'text', width: 6 }, ...cols.map(c => ({ label: c.day ? c.from.slice(5) : `${c.label} (${c.sub})`, type: 'number' })), { label: '합계', type: 'number' }],
    rows: products.flatMap(row => [[row.product, row.spec, '계획', ...cols.map(c => sum(inCol(row.list, c), 'qty') || ''), sum(row.list, 'qty')], [row.product, row.spec, '실적', ...cols.map(c => sum(inCol(row.list, c), 'act') || ''), sum(row.list, 'act')]]),
    totals: ['합계(계획)', '', '', ...colTot.map(t => t.plan), allPlan] };
  return { html, cell: i => cells[Number(i)], from, to, xlsx };
}
async function pageSchedule(kind) {
  const main = $('#main'); const label = kind === 'finished' ? '완제품' : '반제품';
  const boms = await api('GET', '/api/boms?kind=' + kind);
  const calendarKey = uxKey('calendar', location.hash || '#/'), calendar = uxRead(calendarKey);
  let view = ['day', 'week', 'month'].includes(calendar?.view) ? calendar.view : 'week';
  let base = /^\d{4}-\d{2}-\d{2}$/.test(calendar?.base || '') ? calendar.base : scheduleFocusDate();
  // 15.118 주간·월간 보기: 계획표(제품 × 날짜/주차, 기본) | 달력(요약). 월간 계획표 열: 주차 합계(기본) | 일별
  let lastGridValue = null; const lastGrid = () => lastGridValue;
  let mode = calendar?.mode === 'cal' ? 'cal' : 'grid', monthCols = calendar?.monthCols === 'day' ? 'day' : 'week';
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
    <div class="seg" id="mSeg" role="group" aria-label="보기 방식"><button data-m="grid">계획표</button><button data-m="cal">달력</button></div>
    <div class="seg" id="cSeg" role="group" aria-label="월간 열"><button data-c="week">주차 합계</button><button data-c="day">일별</button></div>
    <button type="button" class="btn small" id="scXlsx">엑셀</button>
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
  // 생산의뢰에서 만든 일정은 메모 앞의 「생산의뢰 번호 · 업체 · 주문번호」를 링크로 보여 주고 메모에서는 뺀다.
  const scheduleNote = s => s.order_ref && (s.note || '').startsWith('생산의뢰 ' + s.order_ref) ? s.note.slice(('생산의뢰 ' + s.order_ref).length).replace(/^ · /, '') : s.note;
  const item = (s) => `<div class="sc-item ${s.done ? 'done' : ''}" data-id="${s.id}"><input type="checkbox" ${s.done ? 'checked' : ''} data-done="${s.id}" title="완료 체크" aria-label="완료"> <span class="p">${esc(s.product)}${lineInfo(s)}</span> <b>${fmtNum(s.qty)}</b>${s.order_ref ? ` <a class="sc-order" href="#/prod/orders" data-open-mr="${s.order_id}">생산의뢰 ${esc(s.order_ref)}</a>` : ''}${scheduleNote(s) ? ` <span class="small muted">${esc(scheduleNote(s))}</span>` : ''}<span class="small muted">입력자: ${esc(s.created_by || '기존 기록: 미기록')}</span>${s.bom_id ? `<button class="btn small" data-bom-view="${s.id}">BOM·소요량</button>` : ''}${planProgress(s)}<button class="btn small" data-actual-open="${s.id}">${s.kind === 'semi' ? '실적 조회 (커팅/융착 자동 집계)' : '생산실적 입력·조회'}</button>${commentButton("schedule", s.id, s.product)}<button class="x" data-del="${s.id}" title="삭제" aria-label="삭제">×</button></div>`;
  const totals = (list) => { const m = {}; list.forEach((s) => (m[s.product] = (m[s.product] || 0) + s.qty)); return Object.entries(m).map(([p, q]) => `<span class="chip">${esc(p)} <b>${fmtNum(q)}</b></span>`).join(' ') || '<span class="muted small">없음</span>'; };
  const load = async () => {
    uxWrite(calendarKey, { view, base, mode, monthCols });
    const show = (sel, on) => { $(sel, main).style.display = on ? '' : 'none'; };
    show('#mSeg', view !== 'day'); show('#cSeg', view === 'month' && mode === 'grid'); show('#scXlsx', view !== 'day' && mode === 'grid');
    $$('#mSeg button', main).forEach(b => b.classList.toggle('on', b.dataset.m === mode)); $$('#cSeg button', main).forEach(b => b.classList.toggle('on', b.dataset.c === monthCols));
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
    let grid = null;
    if (view !== 'day' && mode === 'grid') {
      grid = scheduleGrid({ rows, from, to, view, monthCols, today: todayStr() }); lastGridValue = grid;
      body = grid.html;
    } else {
      grid = null;
      body += plans('월간 계획', months, (s) => s.start_date.slice(0, 7));
      body += plans('주간 계획', weeks, (s) => `${s.start_date.slice(5)}~${addDays(s.start_date, 6).slice(5)}`);
      // 달력: 칸에는 「N건 · 수량」 요약, 누르면 그날 일정 카드가 창으로 열린다(15.118)
      const dayCell = d => { const list = days.filter((s) => s.start_date === d); return list.length ? `<button type="button" class="sc-day-sum" data-sc-day="${d}"><b>${fmtNum(list.length)}건</b> · ${fmtNum(list.reduce((t, s) => t + s.qty, 0))}<span class="small muted">${list.filter(s => s.done).length ? ` · 완료 ${list.filter(s => s.done).length}` : ''}</span></button>` : ''; };
      if (view === 'day') {
        body += `<div class="card"><h4>일간 계획</h4>${days.map(item).join('') || '<div class="muted small">일정이 없습니다.</div>'}</div>`;
      } else if (view === 'week') {
        body += `<div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(from, i); return `<div class="day ${d === todayStr() ? 'today' : ''}"><div class="dh">${d.slice(5)} (${dow(d)})</div>${dayCell(d)}</div>`; }).join('')}</div>`;
      } else {
        const start = mondayOf(from); const cells = [];
        for (let d = start; d <= to || parseD(d).getDay() !== 1; d = addDays(d, 1)) cells.push(d);
        body += `<div class="month"><div class="mh">${['월', '화', '수', '목', '금', '토', '일'].map((w) => `<div>${w}</div>`).join('')}</div><div class="mg">${cells.map((d) => `<div class="day ${d.slice(0, 7) !== from.slice(0, 7) ? 'out' : ''} ${d === todayStr() ? 'today' : ''}"><div class="dh">${Number(d.slice(8))}</div>${dayCell(d)}</div>`).join('')}</div></div>`;
      }
      body += `<div class="card"><h4>조회 조건 기준 일간 합계 (제품별)</h4>${totals(days)}</div>`;
    }
    $('#scBody').innerHTML = body;
    bindItems($('#scBody'));
    // 계획표 칸 → 그 칸의 일정 카드(실적·코멘트·완료·삭제는 카드 그대로). 빈 날짜 칸 → 그 제품으로 일정 추가
    const cellWindow = (title, list) => { const m = modal(`<h3>${esc(title)}</h3><div class="sc-pop">${list.map(item).join('') || '<p class="muted">일정이 없습니다.</p>'}</div><div class="actions"><button class="btn" data-close>닫기</button></div>`, { wide: true }); $('[data-close]', m.el).onclick = m.close; bindItems(m.el, m.close); };
    $$('#scBody [data-sc-day]').forEach(b => b.onclick = () => cellWindow(`${b.dataset.scDay} (${dow(b.dataset.scDay)}) 일정`, days.filter(s => s.start_date === b.dataset.scDay)));
    if (grid) {
      $$('#scBody [data-grid-cell]').forEach(td => td.onclick = async () => {
        const c = grid.cell(td.dataset.gridCell);
        if (c.list.length) return cellWindow(c.title, c.list);
        if (!c.addable) return;
        const v = await promptBox(`${c.row.product} · ${c.from} (${dow(c.from)}) 일정 추가`, `<label>수량 *<input name="qty" type="number" min="0" step="any" required autofocus></label><label>비고<input name="note" maxlength="200"></label>`);
        if (!v) return;
        try { await api('POST', '/api/schedules', { kind, period: 'day', start_date: c.from, product: c.row.product, ...(c.row.bom_id ? { bom_id: c.row.bom_id } : {}), qty: v.qty, note: v.note }); toast('일정을 추가했습니다.'); load(); } catch (error) { fail(error); }
      });
      $$('#scBody [data-grid-plan]').forEach(b => b.onclick = () => { const p = rows.find(r => r.id === Number(b.dataset.gridPlan)); cellWindow(`${PERIOD[p.period]} 계획 · ${p.product}`, [p]); });
    }
    // 일정 카드 버튼(완료·삭제·BOM): 목록·계획표 칸 창 공통
    function bindItems(root, close = null) {
    $$('[data-bom-view]', root).forEach(button => button.onclick = () => {
      const row = rows.find(row => row.id === Number(button.dataset.bomView)); const snapshot = row.bom_snapshot;
      modal(`<h3>${esc(row.product)} · 생산 ${fmtNum(row.qty)} ${esc(snapshot.unit)}</h3><p class="muted small">입력자: ${esc(row.created_by || '기존 기록: 미기록')} · 일정 등록 당시 BOM 기준입니다. 기준 생산수량: ${fmtNum(snapshot.base_qty)} ${esc(snapshot.unit)}</p>${materialTable(snapshot.requirements || [])}`, { wide: true });
    });
    $$('[data-done]', root).forEach((c) => (c.onchange = async () => { try { await api('PUT', '/api/schedules/' + c.dataset.done, { toggle_done: true }); close?.(); load(); } catch (e) { fail(e); } }));
    $$('[data-del]', root).forEach((b) => (b.onclick = async () => { if (await confirmBox('이 일정을 삭제할까요?')) { try { await api('DELETE', '/api/schedules/' + b.dataset.del); close?.(); load(); } catch (e) { fail(e); } } }));
    }
  };
  bindListControls(filterForm, load);
  renderActualChanges($('#actualChanges', main), kind).catch(fail);
  $$('#vSeg button').forEach((b) => (b.onclick = () => { view = b.dataset.v; $$('#vSeg button').forEach((x) => x.classList.toggle('on', x === b)); filterForm.requestSubmit(); }));
  $$('#mSeg button', main).forEach(b => b.onclick = () => { mode = b.dataset.m; load().catch(fail); });
  $$('#cSeg button', main).forEach(b => b.onclick = () => { monthCols = b.dataset.c; load().catch(fail); });
  $('#scXlsx', main).onclick = () => { const g = lastGrid(); if (g) xlsxDownload(`${label}_생산계획표_${g.from}_${g.to}.xlsx`, { sheet: '생산계획표', titles: [`${label} 생산계획표`, `${g.from} ~ ${g.to} · 계획 / 실적`], columns: g.xlsx.columns, rows: g.xlsx.rows, totals: g.xlsx.totals }); };
  const step = (n) => { base = view === 'day' ? addDays(base, n) : view === 'week' ? addDays(base, 7 * n) : addMonths(base, n); load(); };
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1); $('#today').onclick = () => { base = todayStr(); load(); };
  $('#scNew').onsubmit = async (e) => {
    e.preventDefault(); const v = formObj(e.target); const button = $('button.primary', e.target); if (button?.disabled) return; if (button) button.disabled = true; // 15.209 두 번 눌러도 한 건
    try { await api('POST', '/api/schedules', { ...v, kind, request_id: formToken(e.target) }); delete e.target.dataset.rid; toast(`${PERIOD[v.period]} 일정을 등록했습니다.`); e.target.qty.value = ''; e.target.note.value = ''; if (!v.bom_id) e.target.product.value = ''; previewBom(); base = v.start_date; load(); } catch (err) { fail(err); } finally { if (button) button.disabled = false; }
  };
  await load();
}

// ───────────── 물류: 출하목록 ─────────────
async function pageShip(main) {
  main.innerHTML = `
  <h1>출하목록 <span class="dept">물류</span></h1>
  <p class="muted">물류가 직접 입력한 출하는 영업 담당자가 「매출전표 입력」에서 거래처를 고른 뒤 「전표 없는 출하」를 체크하고 단가를 넣어 전표로 잡습니다.${hasRole('sales') ? ' <a class="btn small" href="#/sales/bills/new">매출전표 입력으로</a>' : ''}</p>
  <form class="card" id="shNew"><h3>출하 입력</h3><div class="form-grid">
    <label>출고일 *<input name="ship_date" type="date" required value="${todayStr()}"></label>
    <label>품목명 *<input name="item" required></label>
    <label>수량 *<input name="qty" type="number" min="0" step="any" required></label>
    <label>거래처 *<input name="customer" required></label>
    <label>LOT<input name="lot" maxlength="100" placeholder="재고 LOT 고르기 (선택)"></label>
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
    $('#shSum').innerHTML = `${esc(`${rows.length}건`)} · <span>수량 합계</span> <b>${esc(unitTotals(rows, r => r.qty, r => r.unit))}</b>`;
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
  const shLot = bindLotPicker($('#shNew').elements.lot, () => $('#shNew').elements.item.value, () => $('#shNew').elements.qty.value);
  $('#shNew').onsubmit = async (e) => {
    e.preventDefault(); if (shipDraft.busy) return; const lotWarn = shLot?.check(); if (lotWarn && !await confirmBox(`${lotWarn}. 그래도 등록할까요?`)) return; LOT_CACHE.clear(); const v = formObj(e.target); const button = $('button.primary', e.target); button.disabled = true;
    try { const saved = await api('POST', '/api/shipments', { ...v, request_id: formToken(e.target) }); delete e.target.dataset.rid; const photoSaved = await saveNewAttachments('shipment', saved, shipDraft, e.target); shipDraft.reset(); e.target.inspection_status.value = 'unchecked'; e.target.inspection_note.value = ''; ['item', 'qty', 'customer', 'note', 'lot'].forEach((k) => (e.target[k].value = '')); if (photoSaved) toast('출하를 등록했습니다.'); if (v.ship_date < $('#shFrom').value || v.ship_date > $('#shTo').value) { $('#shFrom').value = $('#shTo').value = v.ship_date; } load(); } catch (err) { fail(err); } finally { button.disabled = false; }
  };
  bindListControls(filterForm, load);
  $('#shToday').onclick = () => { $('#shFrom').value = $('#shTo').value = todayStr(); load().catch(fail); };
  await load();
}

// ───────────── 관리자 ─────────────
async function pageAdmin(main) {
  if (!ME.is_admin) { main.innerHTML = '<div class="empty">관리자만 볼 수 있습니다.</div>'; return; }
  const [s, users, org] = await Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/users'), api('GET', '/api/org')]);
  main.innerHTML = `
  <h1>관리자 설정</h1>
  <div class="card"><h3>데이터 백업</h3><p class="muted small">업무 기록·계정·사진을 파일로 저장합니다. 백업 중에는 다른 사용자의 입력을 잠시 멈춰 주세요. 파일에는 개인정보와 비밀번호 검증값이 포함되므로 안전하게 보관하세요.</p><button class="btn" id="backupBtn">전체 백업 다운로드</button><p id="backupStatus" role="status" class="muted small"></p></div>
  <div class="card"><h3>회사 사진 저장소</h3><p id="imageStorageStatus" role="status">연결 상태를 확인하고 있습니다…</p><p class="muted small">기존 사진을 회사 저장소로 복사하고 원본과 비교합니다. 복사 중에는 사진 등록·수정·삭제를 잠시 멈춰 주세요. 원본은 보존하며 복사만으로 저장 위치가 바뀌지 않습니다.</p><div class="actions"><button class="btn" id="imageCheckBtn" disabled>연결 확인</button><button class="btn" id="imageCopyBtn" disabled>기존 사진 복사·검증</button></div><p id="imageCopyStatus" role="status" class="muted small"></p></div>
  <form class="card" id="invForm"><h3>초대코드</h3><p class="muted small">가입할 때 이 코드를 입력해야 합니다. 바꾸면 이후 가입부터 새 코드가 필요합니다.</p>
    <div class="row"><input name="invite_code" value="${esc(s.invite_code)}" required minlength="4" aria-label="초대코드"><button class="btn primary">변경</button></div></form>
  <div class="card"><h3>회원 관리</h3><p class="muted small">가입 승인·회원 정보, 사용 권한(승인·처리), 메뉴 보기는 「회원 관리」에서 나눠 관리합니다.</p><p>${(() => { const n = users.filter(u => u.approval_status === 'pending').length; return n ? `<span class="chip yellow">가입 승인 대기 ${n}명</span> ` : ''; })()}<a class="btn" href="#/admin/users">회원 관리 열기</a></p></div>`;
  $('#invForm').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('PUT', '/api/admin/invite', formObj(e.target)); toast(`초대코드: ${r.invite_code}`); } catch (err) { fail(err); } }; // 15.179 15.175에서 빠졌던 저장 되살림
  const imageCheck = $('#imageCheckBtn'), imageCopy = $('#imageCopyBtn'), imageStatus = $('#imageStorageStatus');
  try {
    const storage = await api('GET', '/api/admin/image-storage');
    imageStatus.textContent = `${storage.mode === 'external' ? '회사 저장소 사용 중' : '기존 저장소 사용 중'} · ${storage.ready ? '회사 저장소 연결 설정 완료' : '회사 저장소 연결 설정이 필요합니다.'}`;
    imageCheck.disabled = imageCopy.disabled = !storage.ready;
  } catch (error) { imageStatus.textContent = '사진 저장소 상태를 확인하지 못했습니다.'; }
  imageCheck.onclick = async () => {
    imageCheck.disabled = true;
    try { await api('POST', '/api/admin/image-storage/check', {}); toast('회사 사진 저장소 연결을 확인했습니다.'); }
    catch (error) { fail(error); }
    finally { imageCheck.disabled = false; }
  };
  imageCopy.onclick = async () => {
    if (!confirm('사진 등록·수정·삭제를 잠시 멈췄나요? 기존 사진을 보존하면서 회사 저장소로 복사하고 검증합니다.')) return;
    imageCopy.disabled = imageCheck.disabled = true;
    const status = $('#imageCopyStatus'); let cursor = '', copied = 0, verified = 0;
    try {
      do {
        status.textContent = `사진을 복사·검증하고 있습니다… (새로 복사 ${copied}장 · 검증 ${verified}장)`;
        const page = await api('POST', '/api/admin/image-storage/copy', { cursor });
        copied += page.copied; verified += page.verified; cursor = page.next;
      } while (cursor);
      status.textContent = `복사·검증 완료: ${verified}장 확인, ${copied}장 새로 복사. 원본은 보존했습니다. 저장 위치 전환은 별도 설정이 필요합니다.`;
    } catch (error) { status.textContent = '복사·검증을 중단했습니다. 원본은 보존됩니다. 오류를 해결하고 다시 실행하면 복사된 사진부터 비교합니다.'; fail(error); }
    finally { imageCopy.disabled = imageCheck.disabled = false; }
  };
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
      const signatures = (backup.tables.laundry_reports || []).map(row => row.signature).concat(backup.tables.settings.filter(row => row.key === 'laundry_report_settings').map(row => { try { return JSON.parse(row.value).signature; } catch { return ''; } })).filter(Boolean);
      const photos = [...new Set(backup.tables.laundry.concat(backup.tables.attachments || [], backup.tables.purchase_requests || []).flatMap(row => JSON.parse(row.photos || '[]')).concat(signatures))];
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
      await api('POST', '/api/admin/backup-done').catch(() => {}); // remembers when the last full backup was taken
      status.textContent = '백업 파일을 다운로드했습니다. 다운로드 폴더에서 확인하세요.';
    } catch (error) { status.textContent = '백업에 실패했습니다. 다시 시도해 주세요.'; fail(error); }
    finally { button.disabled = false; }
  };
}

async function pageMe(main) {
  main.innerHTML = `<h1>내 정보</h1>
  <div class="card"><p><b>${esc(ME.name)}</b> ${ME.is_admin ? '<span class="tag">관리자</span>' : ''}</p><p class="muted small">담당: ${ME.roles.map((r) => ROLE_LABEL[r]).join(', ') || '없음 (승인 권한이 필요하면 관리자에게 요청)'}</p></div>
  <div class="card"><h3>부서 · 직급</h3><p><b>${esc(ME.department || '부서 미지정')}</b> · ${esc(ME.position || '직급 미지정')}</p><p class="small muted">구매의뢰서의 의뢰부서·요청자 직급으로 자동 표시됩니다. 바꾸려면 관리자에게 요청하세요(관리 › 조직 구성).</p></div>
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

// 15.62: 휴대폰 카드에서 체크박스 칸 어디를 눌러도 체크된다(작은 칸을 정확히 누르지 않아도 됨).
document.addEventListener('click', event => {
  if (event.target.closest('input, button, a, label, select, textarea')) return;
  const cell = event.target.closest('table.grid.as-cards td, table.grid.m-grid td.m-k'); if (!cell) return;
  const box = cell.querySelector(':scope > input[type=checkbox]:only-child'); if (!box || box.disabled) return;
  box.click();
});

// 15.134 기타입고 목록: 같은 입고번호로 받은 여러 줄을 한 묶음(머리줄)으로 접고, 누르면 하위 자재(LOT·서브 LOT) 줄이 펼쳐진다.
function otherGroups(rows) {
  const out = [];
  for (const row of rows) { const last = out.at(-1); if (row.receipt_id && last && last.id === row.receipt_id) last.rows.push(row); else out.push({ id: row.receipt_id || null, no: row.receipt_no || '', rows: [row] }); }
  return out;
}
function otherGroupHead(g) {
  const r0 = g.rows[0], unitOf = r => r.unit || receiptBomSnapshot(r).unit || '', items = [...new Set(g.rows.map(r => r.item))], cats = [...new Set(g.rows.map(r => r.item_category))], lots = [...new Set(g.rows.map(r => r.lot).filter(Boolean))];
  return `<tr class="rc-group"><td>${esc(r0.received_date)}</td><td>${esc(cats.join(', '))}</td>
    <td><button type="button" class="link-btn" data-rc-toggle="${g.id}" aria-expanded="false"><span data-rc-arrow>▸</span> <b>${esc(g.no || '입고')}</b> · ${esc(items[0])}${items.length > 1 ? ` 외 ${items.length - 1}품목` : ''}</button>
      <div class="small muted">하위 ${g.rows.length}줄${lots.length ? ` · LOT ${esc(lots.length > 2 ? `${lots[0]} 외 ${lots.length - 1}` : lots.join(', '))}` : ''}</div></td>
    <td class="r"><b>${esc(unitTotals(g.rows, r => r.qty, unitOf))}</b></td><td>${esc(r0.vendor)}</td><td></td><td>${esc(r0.created_by || '')}</td><td><button class="btn small" data-rc-sheet="${g.id}">입고증</button></td></tr>`;
}

// ── 15.136 출하 LOT 연결: LOT 칸을 누르면 그 품목의 재고 LOT(먼저 들어온 순 · 남은 수량)을 고를 수 있고, 재고에 없는 LOT·남은 수량 초과를 바로 알려 준다.
const LOT_CACHE = new Map();
async function lotsForItem(item, fresh = false) {
  const key = String(item || '').trim(); if (!key) return [];
  if (!fresh && LOT_CACHE.has(key) && Date.now() - LOT_CACHE.get(key).at < 30000) return LOT_CACHE.get(key).rows;
  const rows = (await api('GET', '/api/lots/available?item=' + encodeURIComponent(key)).catch(() => ({ rows: [] }))).rows;
  LOT_CACHE.set(key, { at: Date.now(), rows }); return rows;
}
let lotListSeq = 0;
function bindLotPicker(input, itemOf, qtyOf = () => 0) {
  if (!input || input.dataset.lotBound) return null; input.dataset.lotBound = '1';
  const list = document.createElement('datalist'); list.id = 'lotList' + (++lotListSeq); input.after(list); input.setAttribute('list', list.id); input.autocomplete = 'off';
  const hint = document.createElement('div'); hint.className = 'small lot-hint'; list.after(hint);
  let rows = [];
  const fill = async () => { rows = await lotsForItem(itemOf()); list.innerHTML = rows.map(l => `<option value="${esc(l.lot)}">남은 ${fmtNum(l.balance)} ${esc(l.unit || '')}${l.places ? ' · ' + esc(l.places) : ''} · ${esc(l.first_date || '')}</option>`).join(''); };
  const warn = () => {
    const lot = input.value.trim(), qty = Number(qtyOf()) || 0; if (!lot) return rows.length ? `재고 LOT ${rows.length}개 · 비어 있으면 LOT 미연결` : '';
    const hit = rows.find(l => l.lot === lot);
    if (!hit) return rows.length ? `「${lot}」은 이 품목의 재고 LOT이 아닙니다` : '';
    return qty > hit.balance + 0.000001 ? `LOT ${lot} 남은 수량 ${fmtNum(hit.balance)}보다 많습니다` : '';
  };
  const show = () => { const lot = input.value.trim(), hit = rows.find(l => l.lot === lot), w = warn(); hint.innerHTML = w && (lot || !rows.length) ? `<span class="red-text">${esc(w)}</span>` : hit ? `<span class="muted">남은 ${fmtNum(hit.balance)} ${esc(hit.unit || '')}</span>` : rows.length ? `<span class="muted">${esc(w)}</span>` : ''; };
  input.addEventListener('focus', () => fill().then(show).catch(() => {}));
  input.addEventListener('input', show); input.addEventListener('change', show);
  return { check: () => (input.value.trim() ? warn() : ''), refresh: () => fill().then(show) };
}
