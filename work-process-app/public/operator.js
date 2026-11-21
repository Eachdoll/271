// Operators have a restricted shell and narrow server endpoints; hiding menus is not authorization.
// 15.330 오퍼레이터 두 종류: 생산(operator) · 물류(operator_logistics). 휴대폰에서 큰 단추로 고르고 바로 입력.
const isOperatorMode = () => !!ME && !ME.is_admin && (ME.roles.includes('operator') || ME.roles.includes('operator_logistics') || ME.roles.includes('operator_maint'));
const OP_GROUPS = {
  prod: { role: 'operator', icon: '🏭', label: '생산', desc: '반제품 · 완제품 실적 입력', links: [
    ['#/operator/cut', '반제품 · 커팅/융착', '✂️', '라인과 품목을 고르고 작업 수량 입력'],
    ['#/operator/wash', '반제품 · 세탁', '🫧', '호기와 품목을 고르고 세탁 수량 입력'],
    ['#/operator/finished', '완제품 실적', '📦', '생산계획을 고르고 생산량 입력'],
    ['#/operator/inspections', '검사 결과 조회', '🔍', '수입·출하 검사 결과 보기'],
    ['#/operator/env-line', '라인 환경점검', '🌡', '온습도(오전·오후)와 청소 체크시트'], // 15.343
  ] },
  log: { role: 'operator_logistics', icon: '🚚', label: '물류', desc: '입고 · 출하 입력', links: [
    ['#/operator/receive', '입고 입력', '📥', '받은 발주를 고르고 수량·LOT 입력'],
    ['#/operator/ship', '출하 입력', '📤', '출하지시를 고르고 LOT·수량 확인(여러 LOT 섞기 가능)'],
    ['#/operator/stock', '재고 현황', '📊', '품목·LOT·창고 위치별 재고 보기'],
    ['#/operator/env-wh', '창고 온습도 점검', '🌡', '창고 구역별 오전·오후 온도·습도'], // 15.343
  ] },
  maint: { role: 'operator_maint', icon: '🔧', label: '공무', desc: '설비 점검 · 고장 신고', links: [
    ['#/operator/pm', '설비 점검(PM)', '🔧', '예정 점검을 눌러 점검표 체크'],
    ['#/operator/breakdown', '고장 신고', '🚨', '고장 난 설비와 증상 알리기'],
  ] },
};
const OPERATOR_LINKS = Object.values(OP_GROUPS).flatMap(g => g.links); // 예전 이름(다른 화면에서 참조)
const opGroups = () => Object.entries(OP_GROUPS).filter(([, g]) => ME.roles.includes(g.role));
const opGroupOf = route => opGroups().find(([, g]) => g.links.some(l => l[0] === route));
function operatorShell() {
  document.body.classList.add('operator-mode'); document.body.classList.remove('nav-open');
  const route = location.hash || '#/', grp = opGroupOf(route);
  const nav = grp ? `<nav class="operator-tabs" aria-label="${grp[1].label} 입력"><a class="btn op-home" href="#/" aria-label="처음 화면">⌂ 처음</a>${grp[1].links.map(([href, label, icon]) => `<a class="btn ${route === href ? 'primary' : ''}" href="${href}" ${route === href ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span> ${label}</a>`).join('')}</nav>` : (route === '#/me' ? '<nav class="operator-tabs" aria-label="이동"><a class="btn op-home" href="#/">⌂ 처음</a></nav>' : '');
  $('#app').innerHTML = `<header class="top"><a class="brand" href="#/"><img class="brand-logo" src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><span class="brand-text">오퍼레이터 모드</span><span class="app-version">버전 ${APP_VERSION}</span></a><div class="who"><a href="#/me">${esc(ME.name)}</a><button class="btn small" id="logout">로그아웃</button></div></header><div class="operator-layout">${nav}<main id="main"></main></div>`;
  $('#logout').onclick = async () => { try { await api('POST', '/api/auth/logout'); uxClearUser(); ME = null; render(); } catch (error) { fail(error); } };
}
function opTile(href, icon, label, desc, i, attrs = '') {
  const inner = `<span class="op-icon" aria-hidden="true">${icon}</span><span class="op-label">${label}</span><span class="op-desc">${desc}</span>`;
  return href ? `<a class="op-big" href="${href}" style="--i:${i}">${inner}</a>` : `<button type="button" class="op-big" style="--i:${i}" ${attrs}>${inner}</button>`;
}
// 처음 화면: 맡은 일이 둘(생산·물류)이면 큰 단추 두 개 → 누르면 그 일의 큰 단추가 팝업으로. 하나면 그 일의 큰 단추를 바로.
function operatorHome(main) {
  const groups = opGroups();
  if (groups.length > 1) {
    main.innerHTML = `<h1 class="op-hello">${esc(ME.name)}님, 무엇을 입력할까요?</h1><div class="op-grid op-grid-2">${groups.map(([k, g], i) => opTile('', g.icon, g.label, g.desc, i, `data-op-group="${k}"`)).join('')}</div><p class="small muted">입력 내용을 정정해야 하면 담당자에게 요청하세요.</p>`;
    main.querySelectorAll('[data-op-group]').forEach(b => { b.onclick = () => opGroupPop(b.dataset.opGroup); });
    return;
  }
  const [, g] = groups[0];
  main.innerHTML = `<h1 class="op-hello">${esc(ME.name)}님, 무엇을 입력할까요?</h1><p class="muted">${g.icon} ${g.label} · ${g.desc}</p><div class="op-grid">${g.links.map(([href, label, icon, desc], i) => opTile(href, icon, label, desc, i)).join('')}</div><p class="small muted">입력 내용을 정정해야 하면 담당자에게 요청하세요.</p>`;
  if (typeof envOpBadges === 'function') envOpBadges(main).catch(() => {}); // 15.348 환경점검 미입력 표시
}
function opGroupPop(key) {
  const g = OP_GROUPS[key];
  const m = modal(`<h2 class="op-pop-title"><span aria-hidden="true">${g.icon}</span> ${g.label}</h2><div class="op-grid op-pop">${g.links.map(([href, label, icon, desc], i) => opTile(href, icon, label, desc, i)).join('')}</div>`);
  if (typeof envOpBadges === 'function') envOpBadges(m.el).catch(() => {}); // 15.348
}
async function operatorPage(route, main) {
  const grp = opGroupOf(route), known = OPERATOR_LINKS.some(l => l[0] === route);
  if (known && !grp) { location.hash = '#/'; return; } // 맡지 않은 일
  if (route === '#/operator/inspections') return pageInspections(main);
  if (route === '#/me') return pageMe(main);
  if (route === '#/operator/cut') return pageSemi(main, 'cut', { operator: true });
  if (route === '#/operator/wash') return pageSemi(main, 'wash', { operator: true });
  if (route === '#/operator/finished') return operatorFinished(main);
  if (route === '#/operator/receive') return operatorReceive(main);
  if (route === '#/operator/ship') return operatorShip(main);
  if (route === '#/operator/stock') return operatorStock(main);
  if (route === '#/operator/pm') return operatorPm(main); // 15.339
  if (route === '#/operator/breakdown') return operatorBreakdown(main);
  if (route === '#/env-jump') return envJumpGo(); // 15.349 구역 QR
  if (route === '#/operator/env-line') return pageEnv(main, { operator: true, area: 'line' }); // 15.343
  if (route === '#/operator/env-wh') return pageEnv(main, { operator: true, area: 'warehouse' });
  return operatorHome(main);
}
const opRemain = po => Math.max(0, Math.round((Number(po.qty) - (['ok', 'mismatch'].includes(po.recv_status) ? Number(po.recv_qty) || 0 : 0)) * 1e6) / 1e6);
const opMatch = (q, ...xs) => !q || xs.some(x => String(x || '').toLowerCase().replace(/\s/g, '').includes(q));
function opKey(v) { return String(v || '').toLowerCase().replace(/\s/g, ''); }
async function opLogHistory(host, kind) {
  try {
    const h = await api('GET', '/api/operator/log-history');
    const rows = kind === 'receive' ? h.receipts : h.shipments;
    host.innerHTML = rows.length ? `<div class="operator-history">${rows.map(r => kind === 'receive'
      ? `<article><div><b>${esc(r.item || '')} ${esc(r.spec || '')}</b><p class="small muted">${esc(r.vendor)} · ${esc(r.receipt_no)} · LOT ${esc(r.lot || '-')}${r.sub_lot ? '-' + esc(r.sub_lot) : ''}${r.warehouse ? ' · ' + esc(r.warehouse) + (r.location ? ' ' + esc(r.location) : '') : ''}</p></div><div class="op-qty">${fmtNum(r.qty)} ${esc(r.unit || '')}${r.voided_at ? ' <span class="chip">취소됨</span>' : ''}</div></article>`
      : `<article><div><b>${esc(r.item)} ${esc(r.spec || '')}</b><p class="small muted">${esc(r.customer)} · LOT ${esc(r.lot || '-')}</p></div><div class="op-qty">${fmtNum(r.qty)} ${esc(r.unit || '')}</div></article>`).join('')}</div>` : '<p class="muted">오늘 입력한 기록이 없습니다.</p>';
  } catch (e) { host.textContent = '기록을 불러오지 못했습니다. ' + e.message; }
}
// ── 물류: 입고 입력 ── 받은 발주 카드를 누르면 팝업에서 수량·LOT·창고만 넣고 저장
async function operatorReceive(main) {
  main.innerHTML = `<h1>📥 입고 입력</h1><p class="muted">받은 물건의 발주를 눌러 수량을 입력하세요.</p>
    <label class="op-search"><span class="sr-only">찾기</span><input type="search" id="opQ" placeholder="🔎 거래처 · 품목 · 발주번호" autocomplete="off"></label>
    <div id="opList" class="op-cards" aria-live="polite"><p class="muted">불러오는 중…</p></div>
    <section class="card"><h3>오늘 내가 입력한 입고</h3><div id="opHist"><p class="muted">불러오는 중…</p></div></section>`;
  let pos = [], whs = [];
  const draw = () => {
    const q = opKey($('#opQ', main).value), list = pos.filter(p => opMatch(q, p.vendor, p.item, p.spec, p.req_no));
    const td = todayStr();
    $('#opList', main).innerHTML = list.length ? list.map(p => { const rem = opRemain(p), late = p.due_date && p.due_date < td;
      return `<button type="button" class="op-card" data-po="${p.id}" ${p.pending_change ? 'disabled' : ''}><span class="op-card-main"><b>${esc(p.item)}${p.spec ? ' <span class="op-spec">' + esc(p.spec) + '</span>' : ''}</b><span class="op-sub">${esc(p.vendor)} · ${esc(p.req_no)}</span></span>
        <span class="op-card-side"><span class="op-qty">${fmtNum(rem)} <small>${esc(p.unit || '')}</small></span><span class="op-sub">${p.recv_status === 'mismatch' ? '<span class="chip yellow">부분 입고</span>' : p.recv_status === 'checking' ? '<span class="chip yellow">확인 중</span>' : '남은 수량'}</span>${p.due_date ? `<span class="op-sub ${late ? 'op-late' : ''}">납기 ${esc(p.due_date.slice(5))}</span>` : ''}${p.pending_change ? '<span class="op-sub">수정 요청 대기</span>' : ''}</span></button>`; }).join('')
      : `<div class="empty">${pos.length ? '찾는 발주가 없습니다.' : '입고할 발주가 없습니다.'}</div>`;
  };
  const load = async () => { [pos, whs] = await Promise.all([api('GET', '/api/operator/open-po'), api('GET', '/api/warehouses')]); draw(); opLogHistory($('#opHist', main), 'receive'); };
  $('#opQ', main).addEventListener('input', draw);
  $('#opList', main).addEventListener('click', e => { const b = e.target.closest('[data-po]'); if (b) opReceivePop(pos.find(p => String(p.id) === b.dataset.po), whs, load); });
  await load();
}
function opWarehouseFields(whs, wh = '', loc = '') {
  if (!whs.length) return '';
  const w = whs.find(x => x.name === wh), locs = w?.locations ? w.locations.split(',').filter(Boolean) : [];
  return `<label>창고<select name="warehouse"><option value="">고르지 않음</option>${whs.map(x => `<option${x.name === wh ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    ${locs.length ? `<label>위치<select name="location"><option value="">고르지 않음</option>${locs.map(l => `<option${l === loc ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : '<input type="hidden" name="location" value="">'}`;
}
function opRemember(k, v) { try { localStorage.setItem('wpa:op-' + k, v); } catch { /* 이 화면에만 */ } }
function opRecall(k) { try { return localStorage.getItem('wpa:op-' + k) || ''; } catch { return ''; } }
function opReceivePop(po, whs, reload) {
  if (!po) return;
  const rem = opRemain(po), rid = crypto.randomUUID(); let busy = false;
  const lastWh = whs.some(w => w.name === opRecall('wh')) ? opRecall('wh') : '';
  const m = modal(`<h2 class="op-pop-title">📥 ${esc(po.item)}${po.spec ? ' <span class="op-spec">' + esc(po.spec) + '</span>' : ''}</h2>
    <p class="muted">${esc(po.vendor)} · ${esc(po.req_no)} · 발주 ${fmtNum(po.qty)} ${esc(po.unit || '')}${rem !== Number(po.qty) ? ` · 남음 ${fmtNum(rem)}` : ''}</p>
    <form class="stack op-form" id="opRecvForm">
      <label class="op-qty-field">받은 수량 *<span class="op-qty-input"><input name="qty" type="number" inputmode="decimal" step="any" min="0" required value="${rem || ''}" autofocus><b>${esc(po.unit || '')}</b></span></label>
      <div class="op-quick">${rem ? `<button type="button" class="btn" data-q="${rem}">남은 수량 전부 ${fmtNum(rem)}</button>` : ''}</div>
      <label>업체 LOT<input name="lot" value="${esc(po.lot && !po.lot.includes(',') ? po.lot : '')}" placeholder="비우면 임시 LOT가 자동으로 붙습니다" autocomplete="off"></label>
      <div class="form-grid" data-wh>${opWarehouseFields(whs, lastWh)}</div>
      <label>입고일<input name="receipt_date" type="date" value="${todayStr()}" max="${todayStr()}" required></label>
      <label>비고<input name="note" maxlength="200" autocomplete="off"></label>
      <p class="op-warn" data-warn hidden></p>
      <button class="btn primary op-save">입고 저장</button>
    </form>`);
  const f = $('#opRecvForm', m.el), warn = $('[data-warn]', m.el);
  const check = () => { const q = Number(f.qty.value); warn.hidden = !(q > rem && rem > 0); warn.textContent = q > rem ? `발주보다 ${fmtNum(Math.round((q - rem) * 1e6) / 1e6)} ${po.unit || ''} 많습니다(수량 상이로 기록).` : ''; };
  f.qty.addEventListener('input', check);
  m.el.querySelector('.op-quick')?.addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) { f.qty.value = b.dataset.q; check(); } });
  f.addEventListener('change', e => { if (e.target.name === 'warehouse') { $('[data-wh]', m.el).innerHTML = opWarehouseFields(whs, e.target.value); $('[data-wh] select[name=warehouse]', m.el).focus(); } });
  f.onsubmit = async e => {
    e.preventDefault(); if (busy || !f.reportValidity()) return;
    if (!(Number(f.qty.value) > 0)) { toast('받은 수량을 넣으세요.', 'err'); f.qty.focus(); return; }
    busy = true; const btn = $('.op-save', f); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const v = formObj(f);
      const r = await api('POST', '/api/receipts', { request_id: rid, receipt_date: v.receipt_date, vendor: po.vendor, note: '', lines: [{ po_id: po.id, qty: v.qty, lot: v.lot, warehouse: v.warehouse || '', location: v.location || '', note: v.note }] });
      opRemember('wh', v.warehouse || ''); m.close();
      const line = (r.lines || [])[0];
      opDone(`입고 저장 완료`, `${esc(po.item)} ${fmtNum(v.qty)} ${esc(po.unit || '')}<br>${esc(r.receipt_no || '')}${line?.lot ? ` · LOT ${esc(line.lot)}${line.sub_lot ? '-' + esc(line.sub_lot) : ''}` : ''}`);
      await reload();
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = '입고 저장'; busy = false; }
  };
}
// 저장 뒤 크게 보이는 확인(잠시 뒤 저절로 닫힘)
function opDone(title, html) {
  const m = modal(`<div class="op-done"><div class="op-done-mark" aria-hidden="true">✓</div><h2>${title}</h2><p>${html}</p><button type="button" class="btn primary op-save" data-ok>확인</button></div>`);
  $('[data-ok]', m.el).onclick = () => m.close(); $('[data-ok]', m.el).focus();
  setTimeout(() => m.close(), 4000);
}
// ── 물류: 출하 입력 ── 출하지시 카드를 누르면 팝업에서 LOT별 수량(여러 LOT 섞기)을 확인 후 출하
async function operatorShip(main) {
  main.innerHTML = `<h1>📤 출하 입력</h1><p class="muted">내보낼 출하지시를 눌러 LOT와 수량을 확인하세요.</p>
    <label class="op-search"><span class="sr-only">찾기</span><input type="search" id="opQ" placeholder="🔎 고객 · 품목 · 수주번호" autocomplete="off"></label>
    <div id="opList" class="op-cards" aria-live="polite"><p class="muted">불러오는 중…</p></div>
    <section class="card"><h3>오늘 내가 입력한 출하</h3><div id="opHist"><p class="muted">불러오는 중…</p></div></section>`;
  let rows = [];
  const draw = () => {
    const q = opKey($('#opQ', main).value), list = rows.filter(r => opMatch(q, r.customer, r.item, r.spec, r.order_no, r.customer_po, r.product_code)), td = todayStr();
    $('#opList', main).innerHTML = list.length ? list.map(r => `<button type="button" class="op-card" data-si="${r.id}"><span class="op-card-main"><b>${esc(r.item)}${r.spec ? ' <span class="op-spec">' + esc(r.spec) + '</span>' : ''}</b><span class="op-sub">${esc(r.customer)}${r.order_no ? ' · ' + esc(r.order_no) : ''}${r.customer_po ? ' · PO ' + esc(r.customer_po) : ''}</span>${r.note ? `<span class="op-sub">${esc(r.note)}</span>` : ''}</span>
      <span class="op-card-side"><span class="op-qty">${fmtNum(r.qty)} <small>${esc(r.unit || '')}</small></span><span class="op-sub ${r.ship_date && r.ship_date < td ? 'op-late' : ''}">출고 ${esc((r.ship_date || '').slice(5) || '-')}</span></span></button>`).join('')
      : `<div class="empty">${rows.length ? '찾는 출하지시가 없습니다.' : '출하할 지시가 없습니다.'}</div>`;
  };
  const load = async () => { rows = await api('GET', '/api/operator/ship-pending'); draw(); opLogHistory($('#opHist', main), 'ship'); };
  $('#opQ', main).addEventListener('input', draw);
  $('#opList', main).addEventListener('click', e => { const b = e.target.closest('[data-si]'); if (b) opShipPop(rows.find(r => String(r.id) === b.dataset.si), load); });
  await load();
}
// 15.331 한 품목을 LOT 여러 개 섞어 출고: LOT마다 수량을 넣는다. 처음엔 먼저 들어온 LOT부터 지시 수량만큼 자동으로 채움(한 LOT이 모자라면 다음 LOT에서).
// LOT 하나면 /ship(수량 줄이면 나머지 대기), 둘 이상이면 /ship-lots(LOT마다 출하 1건, 남은 수량은 출하 대기).
async function opShipPop(ins, reload) {
  if (!ins) return;
  let busy = false;
  const Q = Number(ins.qty), U = esc(ins.unit || ''), r6 = n => Math.round(Number(n) * 1e6) / 1e6;
  const m = modal(`<h2 class="op-pop-title">📤 ${esc(ins.item)}${ins.spec ? ' <span class="op-spec">' + esc(ins.spec) + '</span>' : ''}</h2>
    <p class="muted">${esc(ins.customer)}${ins.order_no ? ' · ' + esc(ins.order_no) : ''} · 지시 <b>${fmtNum(Q)} ${U}</b></p>
    <form class="stack op-form" id="opShipForm">
      <fieldset class="op-lots"><legend>LOT별 출하 수량 <small class="muted">(여러 LOT을 섞어 낼 수 있습니다)</small></legend><div data-lots><p class="muted">재고 LOT 불러오는 중…</p></div></fieldset>
      <div class="op-lot-tools"><button type="button" class="btn" data-auto>먼저 들어온 LOT부터 자동 채우기</button><button type="button" class="btn" data-clear>모두 0</button></div>
      <div class="op-total" data-total aria-live="polite"></div>
      <p class="op-warn" data-warn hidden></p>
      <label>출고일<input name="ship_date" type="date" value="${todayStr()}" max="${todayStr()}" required></label>
      <button class="btn primary op-save">출하 저장</button>
    </form>`, { wide: false });
  const f = $('#opShipForm', m.el), warn = $('[data-warn]', m.el);
  let lots = [];
  try { lots = (await api('GET', '/api/lots/available?item=' + encodeURIComponent(ins.item))).rows || []; } catch { lots = []; }
  if (!m.el.isConnected) return;
  const usable = l => !l.qc_fail || l.concession;
  $('[data-lots]', m.el).innerHTML = lots.map((l, i) => { const ok = usable(l); return `<div class="op-lotq ${ok ? '' : 'op-lot-bad'}"><span class="op-lotq-name"><b>${esc(l.lot)}</b>${l.vendor_lot ? ` <small>(${esc(l.vendor_lot)})</small>` : ''}<small>잔량 ${fmtNum(r6(l.balance))} ${esc(l.unit || ins.unit || '')}${l.first_date ? ' · 입고 ' + esc(String(l.first_date).slice(5)) : ''}${ok ? (l.concession ? ' · 특채' : '') : ' · 검사 불합격'}</small></span>
      <span class="op-lotq-in"><input type="number" inputmode="decimal" step="any" min="0" data-lq="${i}" aria-label="${esc(l.lot)} 출하 수량" placeholder="0" ${ok ? '' : 'disabled'}><button type="button" class="btn small" data-lall="${i}" ${ok ? '' : 'disabled'} aria-label="${esc(l.lot)} 잔량 전부">전부</button></span></div>`; }).join('')
    + `<div class="op-lotq"><span class="op-lotq-name"><b>LOT 없이</b><small>LOT을 모를 때(추적이 끊깁니다)</small></span><span class="op-lotq-in"><input type="number" inputmode="decimal" step="any" min="0" data-lq="none" aria-label="LOT 없이 출하 수량" placeholder="0"></span></div>`;
  const inputs = () => [...m.el.querySelectorAll('[data-lq]')];
  const autoFill = () => { let need = Q; for (const el of inputs()) { if (el.dataset.lq === 'none') { el.value = ''; continue; } const l = lots[Number(el.dataset.lq)]; if (!usable(l) || need <= 0) { el.value = ''; continue; } const take = r6(Math.min(Number(l.balance), need)); el.value = take > 0 ? take : ''; need = r6(need - take); } };
  const parts = () => inputs().map(el => ({ el, lot: el.dataset.lq === 'none' ? '' : lots[Number(el.dataset.lq)].lot, l: el.dataset.lq === 'none' ? null : lots[Number(el.dataset.lq)], qty: r6(Number(el.value) || 0) })).filter(p => p.qty > 0);
  const check = () => {
    const ps = parts(), total = r6(ps.reduce((t, p) => t + p.qty, 0)), msgs = []; let bad = false;
    for (const p of ps) if (p.l && p.qty > Number(p.l.balance) + 1e-6) { msgs.push(`LOT ${p.lot} 잔량(${fmtNum(r6(p.l.balance))})보다 많습니다.`); bad = true; }
    if (total > Q + 1e-6) { msgs.push(`합계가 지시 수량(${fmtNum(Q)})보다 많습니다.`); bad = true; }
    else if (total > 0 && total < Q) msgs.push(`나머지 ${fmtNum(r6(Q - total))} ${ins.unit || ''}는 출하 대기로 남습니다.`);
    $('[data-total]', m.el).innerHTML = `합계 <b>${fmtNum(total)}</b> / 지시 ${fmtNum(Q)} ${U}${ps.length > 1 ? ` · <span class="chip">LOT ${ps.length}개 섞어 출고</span>` : ''}`;
    $('[data-total]', m.el).classList.toggle('op-total-ok', Math.abs(total - Q) < 1e-6);
    warn.hidden = !msgs.length; warn.textContent = msgs.join(' '); warn.classList.toggle('op-warn-bad', bad);
    return { ps, total, bad };
  };
  autoFill(); check();
  f.addEventListener('input', check);
  m.el.addEventListener('click', e => {
    const all = e.target.closest('[data-lall]'); if (all) { const i = Number(all.dataset.lall), l = lots[i]; const others = r6(parts().filter(p => p.el.dataset.lq !== String(i)).reduce((t, p) => t + p.qty, 0)); m.el.querySelector(`[data-lq="${i}"]`).value = r6(Math.max(0, Math.min(Number(l.balance), Q - others))) || ''; check(); }
    if (e.target.closest('[data-auto]')) { autoFill(); check(); }
    if (e.target.closest('[data-clear]')) { inputs().forEach(el => { el.value = ''; }); check(); }
  });
  f.onsubmit = async e => {
    e.preventDefault(); if (busy || !f.reportValidity()) return;
    const { ps, total, bad } = check();
    if (!ps.length) { toast('출하할 수량을 LOT에 넣으세요.', 'err'); return; }
    if (bad) { toast(warn.textContent, 'err'); return; }
    if (ps.some(p => !p.lot) && lots.some(usable) && !await confirmBox('LOT 없이 출하하는 수량이 있습니다. 그 수량은 LOT 추적이 되지 않습니다. 저장할까요?')) return;
    busy = true; const btn = $('.op-save', f); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const date = f.ship_date.value;
      if (ps.length === 1) await api('POST', '/api/ship-instructions/ship', { ids: [ins.id], ship_date: date, lots: { [ins.id]: ps[0].lot }, qtys: total < Q ? { [ins.id]: total } : {} });
      else await api('POST', `/api/ship-instructions/${ins.id}/ship-lots`, { lines: ps.map(p => ({ lot: p.lot, qty: p.qty, ship_date: date })) });
      m.close(); opDone('출하 저장 완료', `${esc(ins.customer)} · ${esc(ins.item)} ${fmtNum(total)} ${U}<br>${ps.map(p => `${p.lot ? 'LOT ' + esc(p.lot) : 'LOT 없음'} ${fmtNum(p.qty)}`).join('<br>')}`);
      await reload();
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = '출하 저장'; busy = false; }
  };
}
// ── 15.331 물류: 재고 현황 ── 품목별 합계 → 누르면 LOT·창고 위치별 수량(먼저 들어온 순). 금액 없음.
async function operatorStock(main) {
  main.innerHTML = `<h1>📊 재고 현황</h1><p class="muted">품목을 누르면 LOT·창고 위치별 수량이 보입니다. 위에 있는 LOT이 먼저 들어온 것입니다.</p>
    <div class="op-stock-filters"><label class="op-search"><span class="sr-only">찾기</span><input type="search" id="opQ" placeholder="🔎 품목 · 코드 · LOT · 위치" autocomplete="off"></label>
    <label class="op-wh-filter"><span class="sr-only">창고</span><select id="opWh" aria-label="창고"><option value="">모든 창고</option></select></label></div>
    <p class="small muted" data-count></p><div id="opStock" class="op-cards" aria-live="polite"><p class="muted">불러오는 중…</p></div>`;
  let data = { rows: [], warehouses: [] };
  const draw = () => {
    const q = opKey($('#opQ', main).value), wh = $('#opWh', main).value;
    const rows = data.rows.filter(r => (!wh || (wh === '(위치 미지정)' ? !r.warehouse : r.warehouse === wh)) && opMatch(q, r.item, r.code, r.lot, r.warehouse, r.location));
    const items = new Map();
    for (const r of rows) { const k = r.item + '\u0000' + (r.unit || ''); if (!items.has(k)) items.set(k, { item: r.item, code: r.code, unit: r.unit, qty: 0, lots: [] }); const it = items.get(k); it.qty += Number(r.qty); it.lots.push(r); }
    const list = [...items.values()].sort((a, b) => a.item.localeCompare(b.item, 'ko'));
    $('[data-count]', main).textContent = `${list.length}품목 · ${rows.length}줄${data.more ? ' (일부만)' : ''}`;
    $('#opStock', main).innerHTML = list.length ? list.map(it => { it.lots.sort((x, y) => String(x.first_date || '').localeCompare(String(y.first_date || '')) || String(x.lot).localeCompare(String(y.lot))); const lotN = new Set(it.lots.map(x => x.lot)).size;
      return `<details class="op-stock"${list.length <= 3 ? ' open' : ''}><summary><span class="op-card-main"><b>${esc(it.item)}</b><span class="op-sub">${it.code ? esc(it.code) + ' · ' : ''}LOT ${lotN}개</span></span><span class="op-qty">${fmtNum(Math.round(it.qty * 1e6) / 1e6)} <small>${esc(it.unit || '')}</small></span></summary>
        <div class="op-stock-lots">${it.lots.map(x => `<div class="op-stock-lot"><span><b>${esc(x.lot || '(LOT 없음)')}</b><small>${x.warehouse ? esc(x.warehouse) + (x.location ? ' · ' + esc(x.location) : '') : '위치 미지정'}${x.first_date ? ' · 입고 ' + esc(String(x.first_date).slice(0, 10)) : ''}</small></span><span class="op-stock-q ${Number(x.qty) < 0 ? 'op-late' : ''}">${fmtNum(x.qty)}</span></div>`).join('')}</div></details>`; }).join('')
      : `<div class="empty">${data.rows.length ? '찾는 재고가 없습니다.' : '재고가 없습니다.'}</div>`;
  };
  data = await api('GET', '/api/inventory/places');
  $('#opWh', main).innerHTML = '<option value="">모든 창고</option>' + data.warehouses.map(w => `<option>${esc(w.name)}</option>`).join('') + '<option>(위치 미지정)</option>';
  $('#opQ', main).addEventListener('input', draw); $('#opWh', main).addEventListener('change', draw);
  draw();
}
function operatorSimplifySemi(row) {
  const more = document.createElement('details'); more.className = 'operator-more';
  more.innerHTML = '<summary>추가 정보 · 작업시간, 인원, LOT, 비고</summary><div class="form-grid"></div>';
  for (const key of ['start_time','end_time','break_minutes','workers','lot','note']) $('[data-k="' + key + '"]',row).closest('label') && $('.form-grid',more).append($('[data-k="' + key + '"]',row).closest('label'));
  $('.form-grid',row).after(more);
}
function operatorSemiHistory(rows) {
  return `<section class="card"><h3>내가 입력한 최근 기록</h3><p class="small muted">조회 기간 내 최근 20건 · 정정이 필요하면 생산 담당자에게 요청하세요.</p>${rows.length ? `<div class="operator-history">${rows.slice(0,20).map(r => `<article><div><b>${esc(r.item_name || semiTypeLabel(r))} ${esc(r.spec)}</b><p class="small muted">${esc(r.work_date)} · ${esc(r.unit_name)}${r.process==='wash'?' · '+esc(r.start_time||'시각 미기록'):''}${r.product_code?' · '+esc(r.product_code):''}</p></div>${r.process==='wash'?`<div>세탁수량 <b>${fmtNum(r.qty+(r.defect_qty||0))} ${esc(r.unit)}</b></div>`:`<div>양품 <b>${fmtNum(r.qty)} ${esc(r.unit)}</b><br><span class="small muted">불량 ${fmtNum(r.defect_qty || 0)} ${esc(r.unit)}</span></div>`}</article>`).join('')}</div>` : '<p class="muted">아직 입력한 기록이 없습니다.</p>'}</section>`;
}
async function operatorFinished(main) {
  main.innerHTML = `<h1>완제품 실적 입력</h1><p class="muted">생산일과 계획을 선택한 뒤 이번에 생산한 수량을 입력하세요.</p><form id="operatorActual" class="card stack"><label>생산일 *<input name="production_date" type="date" value="${todayStr()}" max="${todayStr()}" required></label><label>생산계획 *<select name="schedule_id" required disabled><option value="">계획을 불러오는 중…</option></select></label><p id="operatorPlan" class="muted" role="status"></p><label>이번 생산수량 *<input name="qty" type="number" min="0" step="any" required inputmode="decimal" placeholder="누계가 아닌 이번 생산량"></label><button type="button" class="btn" id="opBags" title="이번 포장에 쓴 세탁 완료 봉투 LOT">봉투 LOT 고르기 <b id="opBagN">0</b></button><label>메모 (선택)<input name="note" maxlength="1000"></label><p id="operatorSaveStatus" role="status" class="small muted"></p><button type="submit" class="btn primary" disabled>실적 저장</button></form><section class="card"><div class="actions"><h3>선택한 날짜의 내 입력 기록</h3><button type="button" class="btn small" id="operatorRefresh">다시 조회</button></div><div id="operatorHistory"></div><p class="small muted">최근 100건 · 수정·취소가 필요하면 생산 담당자에게 요청하세요.</p></section>`;
  const form = $('#operatorActual',main), select = form.elements.schedule_id, date = form.elements.production_date, button = $('[type=submit]',form), status = $('#operatorSaveStatus',main);
  let plans = [], ready = false, busy = false, sequence = 0, desiredPlan = '', requestId = crypto.randomUUID();
  const planInfo = () => {
    if (!ready) { button.disabled = true; return; }
    const plan = plans.find(p => String(p.id) === select.value);
    $('#operatorPlan',main).textContent = plan ? `계획 ${fmtNum(plan.qty)} ${plan.unit} · 누적 실적 ${fmtNum(plan.actual_qty)} ${plan.unit}${plan.done ? ' · 완료 표시된 계획' : ''}` : '생산계획을 선택하세요.';
    button.disabled = busy || !ready || !plan;
  };
  const loadPlans = async (preferred = select.value) => {
    const own = ++sequence, day = date.value; desiredPlan = String(preferred || ''); ready = false; button.disabled = true; select.disabled = true;
    try {
      const [found, rows] = await Promise.all([api('GET','/api/operator/plans?date='+encodeURIComponent(day)),api('GET','/api/operator/actuals?date='+encodeURIComponent(day))]);
      if (own !== sequence || !form.isConnected) return;
      plans = found; ready = true;
      select.innerHTML = '<option value="">생산계획 선택</option>' + plans.map(p => `<option value="${p.id}">${esc(p.product)}${p.spec ? ' · '+esc(p.spec) : ''} · ${esc(p.period === 'day' ? '일간' : p.period === 'week' ? '주간' : '월간')} 계획 #${p.id}${p.done ? ' (완료)' : ''}</option>`).join('');
      select.value = plans.some(p => String(p.id) === String(preferred)) ? String(preferred) : '';
      desiredPlan = select.value; select.disabled = !plans.length;
      planInfo();
      if (!plans.length) $('#operatorPlan',main).textContent = '선택한 날짜의 완제품 계획이 없습니다. 날짜를 확인하거나 생산 담당자에게 계획 등록을 요청하세요.';
      $('#operatorHistory',main).innerHTML = rows.length ? `<div class="operator-history">${rows.map(r => `<article><div><b>${esc(r.product)} ${esc(r.spec)}</b><p class="small muted">${esc(r.note)}</p></div><div>${fmtNum(r.qty)} ${esc(r.unit)}${r.voided_at ? '<span class="chip">취소됨</span>' : ''}</div></article>`).join('')}</div>` : '<p class="muted">이 날짜에 입력한 실적이 없습니다.</p>';
    } catch (error) { if (own === sequence && form.isConnected) { $('#operatorPlan',main).textContent = '조회하지 못했습니다. 다시 조회를 눌러주세요. '+error.message; $('#operatorHistory',main).textContent = '조회 실패'; } }
  };
  const draft = bindEntryDraft(form,'operator:finished',{
    read: () => ({ fields: uxFormRead(form).map(([key,value]) => [key, key === 'schedule_id' && !ready ? desiredPlan : value]), requestId }),
    restore: value => { uxFormRestore(form,value.fields); if (typeof value.requestId === 'string') requestId = value.requestId; const chosen = new Map(value.fields || []).get('schedule_id'); loadPlans(chosen); },
  });
  date.onchange = () => loadPlans(''); select.onchange = () => { desiredPlan = select.value; planInfo(); };
  $('#operatorRefresh',main).onclick = () => { if (!busy) loadPlans(); };
  let opBags = [];
  const opBagBtn = $('#opBags', main), opMats = p => { try { return JSON.parse(p?.materials_json || '[]'); } catch { return []; } };
  if (opBagBtn) opBagBtn.onclick = async () => { const chosen = plans.find(p => String(p.id) === select.value); if (!chosen) return toast('계획을 먼저 고르세요.', 'err'); const picked = await packPickBags({ product: chosen.product, bom_snapshot: chosen.bom_snapshot || { materials: (() => { try { return JSON.parse(chosen.materials_json || '[]'); } catch { return []; } })() } }, opBags).catch(e => { fail(e); return null; }); if (!picked) return; opBags = picked; const n = $('#opBagN', main); if (n) n.textContent = picked.length; };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !ready || !form.reportValidity()) return;
    const chosen = plans.find(p => String(p.id) === select.value); if (!chosen) return;
    if (!opBags.length && opMats(chosen).some(m => m.item_category === '반제품') && !await confirmBox('포장에 쓴 봉투 LOT을 고르지 않았습니다. 그래도 저장할까요? (LOT 추적이 봉투까지 이어지지 않습니다)')) return;
    busy = true; form.inert = true; button.disabled = true; draft.start(); status.textContent = '저장 중…';
    let saved = false;
    try {
      await api('POST',`/api/schedules/${chosen.id}/actuals`,{ production_date: date.value, qty: form.elements.qty.value, note: form.elements.note.value, bags: opBags, request_id: requestId });
      saved = true; draft.clear(); requestId = crypto.randomUUID(); form.elements.qty.value = ''; form.elements.note.value = ''; opBags = []; { const n = $('#opBagN', main); if (n) n.textContent = '0'; } // 15.252 봉투 LOT 연결
      status.textContent = '실적이 저장되었습니다.'; toast('완제품 실적을 저장했습니다.');
      await loadPlans(String(chosen.id));
    } catch (error) { if (!saved) { draft.failure(); status.textContent = '저장하지 못했습니다. 입력 내용을 확인하고 다시 저장하세요.'; } fail(error); }
    finally { busy = false; form.inert = false; draft.resume(); planInfo(); }
  };
  await loadPlans();
}

// ── 15.339 공무: 설비 점검(PM) · 고장 신고 ── 휴대폰에서 지난·오늘·7일 안 점검을 카드로, 누르면 점검표를 큰 「정상 / 이상」 단추로.
const opDueLabel = (d, today) => { const n = ipDday(d, today); return n === null ? '' : n < 0 ? `${-n}일 지남` : n === 0 ? '오늘' : `${n}일 남음`; };
async function operatorPm(main) {
  main.innerHTML = `<h1>🔧 설비 점검(PM)</h1><p class="muted">점검할 설비를 눌러 점검표를 체크하세요. 지난 점검이 맨 위에 있습니다.</p>
    <label class="op-search"><span class="sr-only">찾기</span><input type="search" id="opQ" placeholder="🔎 설비번호 · 설비명 · 위치" autocomplete="off"></label>
    <div class="seg op-seg" id="opRange"><button type="button" data-r="7" class="on">7일 안·지남</button><button type="button" data-r="all">전체</button></div>
    <div id="opList" class="op-cards" aria-live="polite"><p class="muted">불러오는 중…</p></div>
    <section class="card"><h3>오늘 내가 입력한 기록</h3><div id="opHist"></div></section>`;
  let d = { equipment: [], mine: [], today: todayStr() }, range = '7';
  const draw = () => {
    const q = opKey($('#opQ', main).value);
    const rows = d.equipment.filter(e => e.status !== 'disposed').flatMap(e => e.pm_items.map(p => ({ e, p, n: ipDday(p.next_due, d.today) })))
      .filter(x => (range === 'all' || (x.n !== null && x.n <= 7)) && opMatch(q, x.e.equip_no, x.e.name, x.e.location, x.e.unit_name, x.p.name)).sort((a, b) => (a.p.next_due || '9').localeCompare(b.p.next_due || '9'));
    $('#opList', main).innerHTML = rows.length ? rows.map(({ e, p, n }) => `<button type="button" class="op-card" data-pm-eq="${e.id}" data-key="${p.key}"><span class="op-card-main"><b>${esc(p.name)}</b><span class="op-sub">${esc(e.equip_no)} ${esc(e.name)}${e.location ? ' · ' + esc(e.location) : ''}</span><span class="op-sub">점검표 ${p.checks.length}개 · ${p.cycle}${PM_UNIT_LABEL[p.unit] || ''}마다</span></span>
      <span class="op-card-side"><span class="op-qty ${n !== null && n < 0 ? 'op-late' : ''}">${esc(opDueLabel(p.next_due, d.today))}</span><span class="op-sub">예정 ${esc((p.next_due || '').slice(5))}</span></span></button>`).join('')
      : `<div class="empty">${range === '7' ? '7일 안에 할 점검이 없습니다. 「전체」를 눌러 보세요.' : '점검할 설비가 없습니다.'}</div>`;
    $('#opHist', main).innerHTML = d.mine.length ? `<div class="operator-history">${d.mine.map(r => `<article><div><b>${esc(r.equip_no)} ${esc(r.name)}</b><p class="small muted">${r.kind === 'pm' ? esc(r.pm_name) : '고장 신고'}</p></div><div>${r.kind === 'pm' ? `<span class="chip ${r.result === '이상' ? 'red' : 'green'}">${esc(r.result)}</span>` : '<span class="chip red">고장</span>'}</div></article>`).join('')}</div>` : '<p class="muted">오늘 입력한 기록이 없습니다.</p>';
  };
  const load = async () => { d = await api('GET', '/api/operator/pm-due'); draw(); };
  $('#opQ', main).addEventListener('input', draw);
  main.addEventListener('click', e => {
    const r = e.target.closest('#opRange [data-r]'); if (r) { range = r.dataset.r; main.querySelectorAll('#opRange button').forEach(b => b.classList.toggle('on', b === r)); draw(); return; }
    const c = e.target.closest('[data-pm-eq]'); if (c) { const eq = d.equipment.find(x => x.id === Number(c.dataset.pmEq)); opPmPop(eq, eq.pm_items.find(p => p.key === c.dataset.key), load); }
  });
  await load();
}
function opPmPop(e, p, reload) {
  const rid = crypto.randomUUID(); let busy = false; const state = p.checks.map(() => null);
  const m = modal(`<h2 class="op-pop-title">🔧 ${esc(p.name)}</h2><p class="muted">${esc(e.equip_no)} ${esc(e.name)}${e.location ? ' · ' + esc(e.location) : ''} · 예정 ${esc(p.next_due || '')}</p>
    <form class="stack op-form" id="opPmForm">
      ${p.checks.length ? p.checks.map((c, i) => `<fieldset class="op-check" data-ci="${i}"><legend>${i + 1}. ${esc(c)}</legend><div class="op-ok-ng"><button type="button" class="op-ok" data-ok="${i}">✔ 정상</button><button type="button" class="op-ng" data-ng="${i}">✕ 이상</button></div><input data-note="${i}" maxlength="200" placeholder="이상 내용(이상일 때)" hidden></fieldset>`).join('') : '<p class="muted">점검표 항목이 없는 PM입니다. 수행만 기록합니다.</p>'}
      ${p.checks.length ? '<button type="button" class="btn op-allok" data-allok>모두 정상</button>' : ''}
      <label>점검일<input type="date" name="log_date" value="${todayStr()}" max="${todayStr()}" required></label>
      <label>메모<input name="description" maxlength="500" autocomplete="off"></label>
      <p class="op-warn" data-warn hidden></p>
      <button class="btn primary op-save">점검 저장</button></form>`);
  const f = $('#opPmForm', m.el), warn = $('[data-warn]', m.el);
  const paint = () => { p.checks.forEach((_, i) => { const box = f.querySelector(`[data-ci="${i}"]`); box.classList.toggle('is-ok', state[i] === true); box.classList.toggle('is-ng', state[i] === false); f.querySelector(`[data-note="${i}"]`).hidden = state[i] !== false; });
    const left = state.filter(x => x === null).length, ng = state.filter(x => x === false).length; warn.hidden = !(left || ng); warn.textContent = left ? `확인 안 한 항목 ${left}개` : `이상 ${ng}개 — 저장하면 공무 담당 할 일에 올라갑니다.`; };
  f.addEventListener('click', e => { const o = e.target.closest('[data-ok]'), n = e.target.closest('[data-ng]'); if (o) state[Number(o.dataset.ok)] = true; if (n) { state[Number(n.dataset.ng)] = false; setTimeout(() => f.querySelector(`[data-note="${n.dataset.ng}"]`)?.focus(), 0); } if (e.target.closest('[data-allok]')) state.fill(true); if (o || n || e.target.closest('[data-allok]')) paint(); });
  paint();
  f.onsubmit = async ev => {
    ev.preventDefault(); if (busy) return; if (state.some(x => x === null)) { toast('모든 점검 항목을 「정상」 또는 「이상」으로 고르세요.', 'err'); return; }
    busy = true; const btn = $('.op-save', f); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const r = await api('POST', `/api/equipment/${e.id}/logs`, { kind: 'pm', pm_key: p.key, log_date: f.log_date.value, description: f.description.value, checks: p.checks.map((c, i) => ({ item: c, ok: state[i], note: f.querySelector(`[data-note="${i}"]`).value })), revision: e.revision, request_id: rid });
      m.close(); opDone(r.log_result === '이상' ? '점검 저장 · 이상 있음' : '점검 저장 완료', `${esc(e.equip_no)} ${esc(e.name)}<br>${esc(p.name)} · <b>${esc(r.log_result)}</b>${r.log_result === '이상' ? '<br>공무 담당에게 알렸습니다.' : ''}`); await reload();
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = '점검 저장'; busy = false; }
  };
}
async function operatorBreakdown(main) {
  main.innerHTML = `<h1>🚨 고장 신고</h1><p class="muted">고장 난 설비를 고르고 증상을 적으면 설비가 「정비 중」으로 바뀌고 공무 담당 할 일에 올라갑니다.</p>
    <label class="op-search"><span class="sr-only">찾기</span><input type="search" id="opQ" placeholder="🔎 설비번호 · 설비명 · 위치" autocomplete="off"></label>
    <div id="opList" class="op-cards" aria-live="polite"><p class="muted">불러오는 중…</p></div>`;
  let d = { equipment: [] };
  const draw = () => { const q = opKey($('#opQ', main).value); const rows = d.equipment.filter(e => e.status !== 'disposed' && opMatch(q, e.equip_no, e.name, e.location, e.unit_name));
    $('#opList', main).innerHTML = rows.length ? rows.map(e => `<button type="button" class="op-card" data-bd="${e.id}"><span class="op-card-main"><b>${esc(e.equip_no)} ${esc(e.name)}</b><span class="op-sub">${esc([e.unit_name, e.location].filter(Boolean).join(' · '))}</span></span><span class="op-card-side"><span class="chip ${e.status === 'running' ? 'green' : 'yellow'}">${esc(e.status_label)}</span></span></button>`).join('') : '<div class="empty">설비가 없습니다.</div>'; };
  const load = async () => { d = await api('GET', '/api/operator/pm-due'); draw(); };
  $('#opQ', main).addEventListener('input', draw);
  main.addEventListener('click', e => { const b = e.target.closest('[data-bd]'); if (!b) return; const eq = d.equipment.find(x => x.id === Number(b.dataset.bd)); const rid = crypto.randomUUID();
    const m = modal(`<h2 class="op-pop-title">🚨 ${esc(eq.equip_no)} ${esc(eq.name)}</h2><form class="stack op-form" id="opBdForm"><label>증상 *<textarea name="description" rows="3" maxlength="1000" required placeholder="예) 탈수 때 소음·진동, 에러 E3"></textarea></label><label>멈춘 시간(시간)<input type="number" name="downtime_hours" inputmode="decimal" step="0.5" min="0"></label><label>일자<input type="date" name="log_date" value="${todayStr()}" max="${todayStr()}"></label><button class="btn primary op-save">고장 신고</button></form>`);
    const f = $('#opBdForm', m.el); f.onsubmit = async ev => { ev.preventDefault(); if (!f.reportValidity()) return; const btn = $('.op-save', f); btn.disabled = true;
      try { await api('POST', `/api/equipment/${eq.id}/logs`, { kind: 'failure', description: f.description.value, downtime_hours: f.downtime_hours.value, log_date: f.log_date.value, status_after: 'maintenance', revision: eq.revision, request_id: rid }); m.close(); opDone('고장 신고 완료', `${esc(eq.equip_no)} ${esc(eq.name)}<br>「정비 중」으로 바꾸고 공무 담당에게 알렸습니다.`); await load(); } catch (err) { fail(err); btn.disabled = false; } }; });
  await load();
}
