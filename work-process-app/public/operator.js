// Operators have a restricted shell and narrow server endpoints; hiding menus is not authorization.
// 15.330 오퍼레이터 두 종류: 생산(operator) · 물류(operator_logistics). 휴대폰에서 큰 단추로 고르고 바로 입력.
const isOperatorMode = () => !!ME && !ME.is_admin && (ME.roles.includes('operator') || ME.roles.includes('operator_logistics'));
const OP_GROUPS = {
  prod: { role: 'operator', icon: '🏭', label: '생산', desc: '반제품 · 완제품 실적 입력', links: [
    ['#/operator/cut', '반제품 · 커팅/융착', '✂️', '라인과 품목을 고르고 작업 수량 입력'],
    ['#/operator/wash', '반제품 · 세탁', '🫧', '호기와 품목을 고르고 세탁 수량 입력'],
    ['#/operator/finished', '완제품 실적', '📦', '생산계획을 고르고 생산량 입력'],
    ['#/operator/inspections', '검사 결과 조회', '🔍', '수입·출하 검사 결과 보기'],
  ] },
  log: { role: 'operator_logistics', icon: '🚚', label: '물류', desc: '입고 · 출하 입력', links: [
    ['#/operator/receive', '입고 입력', '📥', '받은 발주를 고르고 수량·LOT 입력'],
    ['#/operator/ship', '출하 입력', '📤', '출하지시를 고르고 LOT·수량 확인'],
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
}
function opGroupPop(key) {
  const g = OP_GROUPS[key];
  modal(`<h2 class="op-pop-title"><span aria-hidden="true">${g.icon}</span> ${g.label}</h2><div class="op-grid op-pop">${g.links.map(([href, label, icon, desc], i) => opTile(href, icon, label, desc, i)).join('')}</div>`);
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
// ── 물류: 출하 입력 ── 출하지시 카드를 누르면 팝업에서 LOT(지시 수량만큼 남은 첫 LOT을 미리 고름)·수량 확인 후 출하
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
async function opShipPop(ins, reload) {
  if (!ins) return;
  let busy = false;
  const m = modal(`<h2 class="op-pop-title">📤 ${esc(ins.item)}${ins.spec ? ' <span class="op-spec">' + esc(ins.spec) + '</span>' : ''}</h2>
    <p class="muted">${esc(ins.customer)}${ins.order_no ? ' · ' + esc(ins.order_no) : ''} · 지시 ${fmtNum(ins.qty)} ${esc(ins.unit || '')}</p>
    <form class="stack op-form" id="opShipForm">
      <fieldset class="op-lots"><legend>LOT 고르기</legend><div data-lots><p class="muted">재고 LOT 불러오는 중…</p></div></fieldset>
      <label class="op-qty-field">출하 수량 *<span class="op-qty-input"><input name="qty" type="number" inputmode="decimal" step="any" min="0" max="${ins.qty}" required value="${ins.qty}"><b>${esc(ins.unit || '')}</b></span></label>
      <p class="op-warn" data-warn hidden></p>
      <label>출고일<input name="ship_date" type="date" value="${todayStr()}" max="${todayStr()}" required></label>
      <button class="btn primary op-save">출하 저장</button>
    </form>`);
  const f = $('#opShipForm', m.el), warn = $('[data-warn]', m.el);
  let lots = [];
  try { lots = (await api('GET', '/api/lots/available?item=' + encodeURIComponent(ins.item))).rows || []; } catch { lots = []; }
  if (!m.el.isConnected) return;
  const usable = lots.filter(l => !l.qc_fail || l.concession), pick = usable.find(l => Number(l.balance) >= Number(ins.qty)) || usable[0];
  $('[data-lots]', m.el).innerHTML = (lots.length ? lots.map(l => { const bad = l.qc_fail && !l.concession; return `<label class="op-lot ${bad ? 'op-lot-bad' : ''}"><input type="radio" name="lot" value="${esc(l.lot)}" ${bad ? 'disabled' : ''} ${pick && pick.lot === l.lot ? 'checked' : ''}><span><b>${esc(l.lot)}</b>${l.vendor_lot ? ` <small>(${esc(l.vendor_lot)})</small>` : ''}<small>잔량 ${fmtNum(Math.round(Number(l.balance) * 1e6) / 1e6)} ${esc(l.unit || ins.unit || '')}${bad ? ' · 검사 불합격' : l.concession ? ' · 특채' : ''}</small></span></label>`; }).join('') : '<p class="muted small">이 품목의 재고 LOT이 없습니다.</p>')
    + `<label class="op-lot"><input type="radio" name="lot" value="" ${pick ? '' : 'checked'}><span><b>LOT 없이 출하</b><small>LOT을 모를 때(추적이 끊깁니다)</small></span></label>`;
  const check = () => {
    const q = Number(f.qty.value), lot = f.querySelector('input[name=lot]:checked')?.value || '', l = lots.find(x => x.lot === lot), msgs = [];
    if (q > 0 && q < Number(ins.qty)) msgs.push(`나머지 ${fmtNum(Math.round((ins.qty - q) * 1e6) / 1e6)} ${ins.unit || ''}는 출하 대기로 남습니다.`);
    if (l && q > Number(l.balance) + 1e-6) msgs.push(`LOT ${lot} 잔량(${fmtNum(l.balance)})보다 많습니다. 수량을 줄이거나 다른 LOT을 고르세요.`);
    warn.hidden = !msgs.length; warn.textContent = msgs.join(' ');
  };
  f.addEventListener('input', check); f.addEventListener('change', check); check();
  f.onsubmit = async e => {
    e.preventDefault(); if (busy || !f.reportValidity()) return;
    const q = Number(f.qty.value), lot = f.querySelector('input[name=lot]:checked')?.value || '';
    if (!(q > 0) || q > Number(ins.qty)) { toast(`출하 수량은 0보다 크고 지시 수량(${fmtNum(ins.qty)}) 이하로 넣으세요.`, 'err'); f.qty.focus(); return; }
    if (!lot && lots.length && !await confirmBox('LOT 없이 출하할까요? 이 출하는 LOT 추적이 되지 않습니다.')) return;
    busy = true; const btn = $('.op-save', f); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      await api('POST', '/api/ship-instructions/ship', { ids: [ins.id], ship_date: f.ship_date.value, lots: { [ins.id]: lot }, qtys: q < Number(ins.qty) ? { [ins.id]: q } : {} });
      m.close(); opDone('출하 저장 완료', `${esc(ins.customer)} · ${esc(ins.item)} ${fmtNum(q)} ${esc(ins.unit || '')}${lot ? `<br>LOT ${esc(lot)}` : ''}`);
      await reload();
    } catch (err) { fail(err); btn.disabled = false; btn.textContent = '출하 저장'; busy = false; }
  };
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
