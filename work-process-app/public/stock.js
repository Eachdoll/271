// 물류 → 재고 현황. 재고는 저장하지 않고 입고·생산실적·생산 투입·출하·재고 조정에서 계산합니다.
const STOCK_SOURCE = { po: '발주입고', other: '기타입고', prod: '생산', use: '생산 투입', ship: '출하', adjust: '재고 조정', return_in: '반입(반품 재입고)', return_out: '반출(반품)' };
const STOCK_KIND = { opening: '기초재고 (시스템 도입 전 보유분)', count: '재고 실사 (실제로 센 수량)', adjust: '조정 (증가 +, 감소 −)' };
function stockCsv(rows, bySpec) {
  const safe = value => { const text = String(value ?? ''); return '"' + (/^[=+\-@]/.test(text) && isNaN(Number(text)) ? "'" + text : text).replace(/"/g, '""') + '"'; };
  const head = ['품목', '제품코드', ...(bySpec ? ['규격'] : []), '단위', '분류', '1차 분류', '2차 분류', '3차 분류', '입고', '생산', '생산 투입', '출하', '조정', '현재고', ...(bySpec ? [] : ['안전재고']), '최근 변동일'];
  const lines = rows.map(r => [r.item, r.product_code, ...(bySpec ? [r.spec] : []), r.unit, r.category, r.cat1, r.cat2, r.cat3, r.received, r.produced, r.used, r.shipped, r.adjusted, r.stock, ...(bySpec ? [] : [r.min_qty ?? '']), r.last_date].map(safe).join(','));
  return '﻿' + [head.map(safe).join(','), ...lines].join('\r\n');
}
async function pageStock(main) {
  main.innerHTML = `
  <h1>재고 현황 <span class="dept">물류</span></h1>
  <p class="muted">「창고·위치별」로 보면 창고 → 위치(Location)마다 어떤 품목·LOT가 얼마나 있는지 나옵니다. 입고(발주·기타) + 생산실적·반제품 커팅/융착 − 생산 투입(BOM 기준) − 출하 ± 재고 조정으로 계산한 수량입니다. 품목명과 단위가 같은 기록끼리 합산하므로, <b>같은 품목은 같은 이름·단위</b>로 입력하세요. 시스템 도입 전부터 있던 재고는 <b>기초재고</b>로 한 번 입력합니다.</p>
  <div class="stock-ex"><details class="stock-tree-box" open><summary>자재별 · 창고별</summary><nav id="stockTree" class="stock-tree" aria-label="재고 분류·창고"></nav></details><section class="stock-ex-main">
  <form id="stockFilters" class="toolbar list-filters lf-oneline" data-read-only="true">
    <label class="lf-date">기준일<input type="date" name="asof" value="${todayStr()}" max="${todayStr()}" required></label>
    <label class="list-search">품목 검색<input type="search" name="q" maxlength="200" placeholder="품목명·규격"></label>
    <label class="lf-sel lf-wide">재고 상태<select name="state"><option value="">전체</option><option value="instock">재고 있음</option><option value="low">안전재고 미달</option><option value="negative">재고 음수(기록 확인)</option></select></label>
    <button type="submit" class="btn primary">조회</button>
  </form>
  <div class="result-bar"><div id="stockSummary" class="counts"></div>
    <div class="seg result-seg" role="group" aria-label="보기"><label><input type="radio" name="group" value="item" form="stockFilters" checked> 품목 합계</label><label><input type="radio" name="group" value="spec" form="stockFilters"> 규격·사이즈별</label><label><input type="radio" name="group" value="place" form="stockFilters"> 창고·위치별</label></div>
    <span class="result-tools"><button type="button" class="btn" id="stockLots" title="LOT가 적힌 입고 − 같은 LOT 출하">LOT별 재고</button><button type="button" class="btn" id="stockCsv">CSV 저장</button><span id="stockAdjustSlot"></span></span></div>
  <div class="stock-path" id="stockPath"></div><div id="stockList"></div></section></div>`;
  const form = $('#stockFilters', main); let version = 0, current = { rows: [], group: 'item' };
  $('#stockLots', main).onclick = () => stockLotWindow(form.elements.asof.value || todayStr(), form.elements.q.value);
  // 15.258 파일 탐색기처럼: 왼쪽 분류(원자재·부자재·제품·상품·반제품 → 1·2·3차) / 창고(→ 구역·Location)를 고르면 오른쪽에 그 재고
  if (window.matchMedia?.('(max-width: 860px)').matches) $('.stock-tree-box', main).open = false; // 휴대폰은 접힌 채로 시작
  let [catNodes, whList] = await Promise.all([api('GET', '/api/item-categories').catch(() => []), api('GET', '/api/warehouses').catch(() => [])]);
  if (!main.isConnected) return;
  let sel = { k: 'all', p: [] }, opened = new Set(), itemAll = null, placeAll = null, nav = 'cat'; // 15.259 자재별 / 창고별 내비게이션
  try { const v = JSON.parse(sessionStorage.getItem('wpa:stock-sel') || 'null'); if (v && ['all', 'cat', 'wh'].includes(v.k) && Array.isArray(v.p)) sel = v; opened = new Set(JSON.parse(sessionStorage.getItem('wpa:stock-open') || '[]')); nav = sessionStorage.getItem('wpa:stock-nav') === 'wh' || sel.k === 'wh' ? 'wh' : 'cat'; } catch { /* 편의 */ }
  const canWh = ME.is_admin || ME.roles.includes('logistics_approver');
  const SEP = '\u0001', keyOf = (k, p) => [k, ...p].join(SEP);
  const matchCat = r => sel.k !== 'cat' || ((r.category || '미분류') === sel.p[0] && (!sel.p[1] || r.cat1 === sel.p[1]) && (!sel.p[2] || r.cat2 === sel.p[2]) && (!sel.p[3] || r.cat3 === sel.p[3]));
  const NOPLACE = '(위치 미지정)', matchWh = r => sel.k !== 'wh' || ((sel.p[0] === NOPLACE ? !r.warehouse : r.warehouse === sel.p[0]) && (!sel.p[1] || (sel.p[1] === NOPLACE ? !r.location : r.location === sel.p[1])));
  const catTree = () => {
    const root = new Map(['원자재', '부자재', '제품', '상품', '반제품'].map(c => [c, new Map()]));
    const add = path => { let m = root; for (const name of path) { if (!name) break; if (!m.has(name)) m.set(name, new Map()); m = m.get(name); } };
    const byId = new Map(catNodes.filter(n => n.active !== false).map(n => [n.id, n]));
    for (const n of byId.values()) { const path = [n.name]; let q = n; while (q.parent_id && byId.get(q.parent_id)) { q = byId.get(q.parent_id); path.unshift(q.name); } add([n.item_class, ...path]); }
    for (const r of itemAll || []) add([r.category || '미분류', r.cat1, r.cat2, r.cat3]);
    return root;
  };
  const whTree = () => {
    const root = new Map(whList.filter(w => w.active !== 0).map(w => [w.name, new Map(String(w.locations || '').split(',').map(x => x.trim()).filter(Boolean).map(l => [l, new Map()]))]));
    for (const r of placeAll || []) { const w = r.warehouse || NOPLACE; if (!root.has(w)) root.set(w, new Map()); if (r.warehouse) { const l = r.location || NOPLACE; if (!root.get(w).has(l)) root.get(w).set(l, new Map()); } }
    return root;
  };
  const count = (k, p) => { if (k === 'cat' && itemAll) { const was = sel; sel = { k, p }; const n = itemAll.filter(matchCat).length; sel = was; return n; } if (k === 'wh' && placeAll) { const was = sel; sel = { k, p }; const n = placeAll.filter(matchWh).length; sel = was; return n; } return null; };
  const branch = (k, map, path, depth) => `<ul class="st-ul" role="group">${[...map].map(([name, kids]) => { const p = [...path, name], key = keyOf(k, p), open = opened.has(key), on = sel.k === k && keyOf(sel.k, sel.p) === key, n = count(k, p);
    return `<li><div class="st-row${on ? ' on' : ''}" style="--d:${depth}">${kids.size ? `<button type="button" class="st-tw" data-st-tw="${esc(key)}" aria-expanded="${open}" aria-label="${esc(name)} 펼치기">${open ? '▾' : '▸'}</button>` : '<span class="st-tw"></span>'}<button type="button" class="st-node" data-st="${esc(key)}"${on ? ' aria-current="true"' : ''}><span class="st-ic">${k === 'wh' ? (depth ? '▫' : '🏬') : (open && kids.size ? '📂' : '📁')}</span>${esc(name)}${n != null ? ` <span class="st-n">${fmtNum(n)}</span>` : ''}</button></div>${kids.size && open ? branch(k, kids, p, depth + 1) : ''}</li>`; }).join('')}</ul>`;
  const drawTree = () => {
    const all = nav === 'cat' ? itemAll?.length : placeAll?.length;
    $('#stockTree', main).innerHTML = `<div class="st-tabs" role="tablist" aria-label="내비게이션"><button type="button" role="tab" data-st-mode="cat" aria-selected="${nav === 'cat'}">📦 자재별</button><button type="button" role="tab" data-st-mode="wh" aria-selected="${nav === 'wh'}">🏬 창고별</button></div>
      <div class="st-row${sel.k === 'all' ? ' on' : ''}" style="--d:0"><span class="st-tw"></span><button type="button" class="st-node" data-st="all"><span class="st-ic">🗂</span>${nav === 'cat' ? '전체 자재' : '전체 창고'}${all != null ? ` <span class="st-n">${fmtNum(all)}</span>` : ''}</button></div>
      ${nav === 'cat' ? branch('cat', catTree(), [], 0) : branch('wh', whTree(), [], 0)}
      <div class="st-set">${nav === 'cat' ? (ME.is_admin ? '<button type="button" class="btn small" data-st-set="cat">⚙ 분류 설정</button>' : '<span class="small muted">분류는 관리자가 설정합니다</span>') : (canWh ? '<button type="button" class="btn small" data-st-set="wh">⚙ 창고·구역 설정</button>' : '<span class="small muted">창고·구역은 물류팀장·관리자가 설정합니다</span>')}</div>`;
    $('#stockPath', main).innerHTML = sel.k === 'all' ? '' : `<span class="muted">${sel.k === 'cat' ? '자재별' : '창고별'}</span> › ${sel.p.map(x => `<b>${esc(x)}</b>`).join(' › ')} <button type="button" class="link-btn small" data-st="all">전체 보기</button>`;
  };
  const saveTree = () => { try { sessionStorage.setItem('wpa:stock-sel', JSON.stringify(sel)); sessionStorage.setItem('wpa:stock-open', JSON.stringify([...opened])); sessionStorage.setItem('wpa:stock-nav', nav); } catch { /* 편의 */ } };
  const reloadTree = async () => { [catNodes, whList] = await Promise.all([api('GET', '/api/item-categories').catch(() => catNodes), api('GET', '/api/warehouses').catch(() => whList)]); if (main.isConnected) { drawTree(); load().catch(fail); } };
  const setGroup = g => $$('[name=group]', main).forEach(r => { r.checked = r.value === g; });
  main.addEventListener('click', e => {
    const md = e.target.closest('[data-st-mode]'); if (md) { if (md.dataset.stMode !== nav) { nav = md.dataset.stMode; sel = { k: 'all', p: [] }; saveTree(); setGroup(nav === 'wh' ? 'place' : 'item'); drawTree(); load().catch(fail); } return; }
    const st = e.target.closest('[data-st-set]'); if (st) { if (st.dataset.stSet === 'cat') manageItemCategories(sel.k === 'cat' && ['원자재', '부자재', '제품', '상품', '반제품'].includes(sel.p[0]) ? sel.p[0] : '원자재', reloadTree).catch(fail); else stockWarehouseEditor(reloadTree).catch(fail); return; }
    const tw = e.target.closest('[data-st-tw]'); if (tw) { const k = tw.dataset.stTw; opened.has(k) ? opened.delete(k) : opened.add(k); saveTree(); drawTree(); return; }
    const nd = e.target.closest('[data-st]'); if (!nd) return;
    const [k, ...p] = nd.dataset.st.split(SEP); const key = nd.dataset.st;
    if (k !== 'all' && keyOf(sel.k, sel.p) === key) { opened.has(key) ? opened.delete(key) : opened.add(key); } else if (k !== 'all') opened.add(key); // 고르면 펼치고, 다시 누르면 접기
    for (let n = 1; n < p.length; n++) opened.add(keyOf(k, p.slice(0, n)));
    sel = { k, p }; if (k !== 'all') nav = k; saveTree();
    const g = $$('[name=group]', main).find(x => x.checked)?.value;
    if (k === 'wh' && g !== 'place') setGroup('place'); else if (k === 'cat' && g === 'place') setGroup('item');
    drawTree(); load().catch(fail);
    if (k !== 'all' && window.matchMedia?.('(max-width: 860px)').matches && !nd.closest('#stockPath') && !nd.parentElement?.querySelector('button.st-tw')) { const box = $('.stock-tree-box', main); if (box) box.open = false; } // 15.258 휴대폰: 맨 아래 칸을 고르면 접어서 결과가 보이게
  });
  rememberList(form);
  const adjust = async (preset = {}) => {
    const v = await promptBox('재고 조정 · 기초재고 · 실사', `
      <label>품목명 *<input name="item" required maxlength="200" value="${esc(preset.item)}"></label>
      <label>규격·사이즈<input name="spec" maxlength="100" value="${esc(preset.spec)}" placeholder="없으면 비워 두세요"></label>
      <label>단위<input name="unit" maxlength="20" value="${esc(preset.unit)}" placeholder="예) EA / BOX / kg"></label>
      <label>종류 *<select name="kind">${Object.entries(STOCK_KIND).map(([k, l]) => `<option value="${k}" ${preset.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>수량 * <span class="hint">(실사는 실제로 센 수량, 조정에서 줄일 때는 −)</span><input name="amount" type="number" step="any" required></label>
      <label>기준일 *<input name="adj_date" type="date" required value="${todayStr()}" max="${todayStr()}"></label>
      <label>사유 *<input name="reason" required maxlength="500" placeholder="예) 11월 말 재고 실사"></label>`);
    if (!v) return;
    const body = { item: v.item, spec: v.spec, unit: v.unit, kind: v.kind, adj_date: v.adj_date, reason: v.reason, request_id: crypto.randomUUID() };
    if (v.kind === 'count') { body.counted_qty = v.amount; if (!v.spec) body.by_item = true; } else body.qty = v.amount;
    try { const saved = await api('POST', '/api/inventory/adjustments', body); toast(`재고 조정을 기록했습니다. (${saved.qty > 0 ? '+' : ''}${fmtNum(saved.qty)})`); load(); } catch (error) { fail(error); }
  };
  // 15.230 창고·위치별: 창고 → 위치 → 품목·LOT 잔량(어디에 얼마나 있는지)
  const loadPlaces = async mine => {
    const v = formObj(form), data = await api('GET', '/api/inventory/places?' + new URLSearchParams({ asof: v.asof || todayStr(), q: v.q || '' }));
    if (mine !== version || !main.isConnected) return;
    $('#stockAdjustSlot').innerHTML = '';
    placeAll = data.rows; drawTree(); const rows = data.rows.filter(matchWh), whs = new Set(rows.map(r => r.warehouse || '(위치 미지정)'));
    $('#stockSummary').innerHTML = `${fmtNum(rows.length)}줄 · 창고 ${whs.size}곳 · 기준일 ${esc(data.asof)}${data.more ? ' · <span class="chip yellow">앞 3000줄</span>' : ''}`;
    let prev = '';
    $('#stockList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid stock-place-grid"><thead><tr><th>창고</th><th>위치(Location)</th><th>품목코드</th><th>품목명</th><th>LOT</th><th class="r">수량</th><th>처음 입고</th><th></th></tr></thead><tbody>${rows.map((r, i) => { const wh = r.warehouse || '(위치 미지정)', head = wh !== prev; prev = wh;
      return `<tr class="${head ? 'wh-first' : ''}${r.qty < 0 ? ' row-red' : ''}"><td>${head ? `<b>${esc(wh)}</b>` : '<span class="muted small">〃</span>'}</td><td>${r.location ? `<span class="chip">${esc(r.location)}</span>` : '<span class="muted">—</span>'}</td><td class="small nowrap">${esc(r.code || '')}</td><td data-card-primary><b>${esc(r.item)}</b></td><td class="nowrap"><span class="lot-tag">${esc(r.lot)}</span></td><td class="r"><b>${fmtNum(r.qty)}</b> ${esc(r.unit || '')}</td><td class="small muted">${esc(r.first_date || '')}</td><td class="nowrap">${r.lot !== '(LOT 미지정)' ? `<button type="button" class="btn small" data-place-move="${i}" title="이 LOT를 다른 창고·위치로">이동</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<div class="empty">조건에 맞는 위치별 재고가 없습니다. 입고 때 창고·위치를 넣으면 여기에 나옵니다(관리 › 창고 관리).</div>';
    $$('[data-place-move]', main).forEach(b => b.onclick = () => { const r = rows[Number(b.dataset.placeMove)]; lotMoveWindow({ item: r.item, unit: r.unit, lot: r.lot }, load).catch(fail); });
  };
  const load = async () => {
    if (!main.isConnected) return; const mine = ++version;
    if (form.querySelector('[name=group]:checked')?.value === 'place' || $$('[name=group]', main).find(x => x.checked)?.value === 'place') return loadPlaces(mine);
    const result = await api('GET', '/api/inventory?' + new URLSearchParams(formObj(form)));
    if (mine !== version || !main.isConnected) return;
    itemAll = result.rows; const rows = result.rows.filter(matchCat); current = { ...result, rows }; drawTree(); const bySpec = result.group === 'spec';
    const lowRows = result.group === 'item' ? rows.filter(r => r.low) : [];
    $('#stockAdjustSlot').innerHTML = (result.can_adjust ? '<button type="button" class="btn" id="stockAdjust">＋ 기초재고·실사·조정</button>' : '')
      + (lowRows.length && (ME.is_admin || ME.roles.includes('purchase')) ? ` <button type="button" class="btn" id="stockReorder" title="안전재고 미달 품목을 매입처별 발주로">부족분 발주 <span class="sub-count">${lowRows.length}</span></button>` : '');
    if ($('#stockReorder')) $('#stockReorder').onclick = () => stockReorder(lowRows).catch(fail);
    if (result.can_adjust) $('#stockAdjust').onclick = () => adjust();
    $('#stockSummary').innerHTML = `${rows.length}개 품목 · 기준일 ${esc(result.asof)}${rows.some(r => r.low) ? ` · <span class="chip yellow">안전재고 미달 ${rows.filter(r => r.low).length}</span>` : ''}${rows.some(r => r.negative) ? ` · <span class="chip red">재고 음수 ${rows.filter(r => r.negative).length}</span> <span class="small muted">입고·기초재고 누락 또는 품목명·단위 불일치를 확인하세요.</span>` : ''}${bySpec ? ' · <span class="small muted">BOM 자재에는 규격이 없어 생산 투입은 규격 없는 줄에 표시됩니다.</span>' : ''}`;
    $('#stockList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>품목코드</th><th>품목명</th>${bySpec ? '<th>규격</th>' : ''}<th>분류</th><th class="r">입고</th><th class="r">생산</th><th class="r">생산 투입</th><th class="r">출하</th><th class="r">조정</th><th class="r">현재고</th>${bySpec ? '' : '<th class="r">안전재고</th>'}<th>최근 변동</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.negative ? 'row-red' : r.low ? 'row-yellow' : ''}">
        <td class="small nowrap">${esc(r.product_code) || '<span class="muted">미등록</span>'}</td><td><b>${esc(r.item)}</b></td>${bySpec ? `<td>${esc(r.spec || '(규격 없음)')}</td>` : ''}<td>${esc(r.category || '미분류')}${r.cat1 ? `<div class="small muted">${esc([r.cat1, r.cat2, r.cat3].filter(Boolean).join(' › '))}</div>` : ''}</td>
        <td class="r">${fmtNum(r.received)}</td><td class="r">${fmtNum(r.produced)}</td><td class="r">${fmtNum(r.used)}</td><td class="r">${fmtNum(r.shipped)}</td><td class="r">${r.adjusted ? (r.adjusted > 0 ? '+' : '') + fmtNum(r.adjusted) : '0'}</td>
        <td class="r"><b class="${r.negative ? 'red-text' : ''}">${fmtNum(r.stock)}</b> ${esc(r.unit || '단위 미지정')}${r.converted ? `<br><span class="small muted">= ${fmtNum(r.converted.qty)} ${esc(r.converted.unit)}</span>` : ''}${r.low ? ' <span class="chip yellow">미달</span>' : ''}</td>
        ${bySpec ? '' : `<td class="r">${r.min_qty == null ? '<span class="muted">—</span>' : fmtNum(r.min_qty)}</td>`}
        <td class="small muted">${esc(r.last_date === '0000-00-00' ? '' : r.last_date)}</td>
        <td class="nowrap"><button class="btn small" data-stock-lots="${i}" aria-expanded="false" title="이 품목의 LOT별 남은 수량">LOT ▾</button> <button class="btn small" data-stock-moves="${i}">내역</button>${result.can_adjust ? `${bySpec ? '' : ` <button class="btn small" data-stock-min="${i}">안전재고</button>`} <button class="btn small" data-stock-count="${i}">실사</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">해당하는 재고가 없습니다. 입고·생산실적·출하를 등록하거나 기초재고를 입력하면 여기에 나타납니다.</div>';
    // 15.150 품목 줄 아래에 LOT별 남은 수량(위치·처음 입고일) 펼치기
    $$('[data-stock-lots]', main).forEach(button => button.onclick = async () => {
      const tr = button.closest('tr'), open = button.getAttribute('aria-expanded') === 'true';
      if (open) { tr.nextElementSibling?.matches('.stock-lot-row') && tr.nextElementSibling.remove(); button.setAttribute('aria-expanded', 'false'); button.textContent = 'LOT ▾'; return; }
      const r = rows[button.dataset.stockLots]; button.disabled = true;
      try {
        const lots = (await api('GET', '/api/lots/available?item=' + encodeURIComponent(r.item))).rows.filter(l => !r.unit || !l.unit || l.unit === r.unit);
        const sum = lots.reduce((t, l) => t + l.balance, 0);
        tr.insertAdjacentHTML('afterend', `<tr class="stock-lot-row"><td colspan="${tr.children.length}"><div class="stock-lots">${lots.length ? `<table class="erp-grid" data-keep-cols data-no-sort><thead><tr><th>LOT</th><th class="r">입고·생산</th><th class="r">사용·출하</th><th class="r">남은 수량</th><th>위치</th><th>처음 입고</th><th>마지막</th></tr></thead><tbody>${lots.map(l => `<tr${l.concession ? ' class="lot-tk-row"' : ''}><td><span class="lot-tag">${esc(l.lot)}</span>${l.concession ? ' ' + LOT_TK : l.qc_fail ? ' <span class="chip red">불합격</span>' : ''}</td><td class="r">${fmtNum(l.received)}</td><td class="r">${fmtNum(l.shipped)}</td><td class="r"><b>${fmtNum(l.balance)}</b> <span class="small muted">${esc(l.unit || '')}</span></td><td class="small">${esc(l.places || '')}</td><td class="small">${esc(l.first_date || '')}</td><td class="small">${esc(l.last_date || '')}</td></tr>`).join('')}</tbody><tfoot><tr><th>LOT 합계</th><td></td><td></td><td class="r"><b>${fmtNum(Math.round(sum * 1000) / 1000)}</b></td><td colspan="3" class="small muted">${Math.abs(sum - r.stock) > 0.001 ? `현재고 ${fmtNum(r.stock)}와 차이 ${fmtNum(Math.round((r.stock - sum) * 1000) / 1000)} — LOT 없이 들어오거나 나간 수량(BOM 투입·LOT 없는 출하 등)` : '현재고와 같음'}</td></tr></tfoot></table>` : '<p class="small muted">이 품목은 LOT 남은 재고가 없습니다(LOT 없이 받았거나 다 썼음).</p>'}</div></td></tr>`);
        button.setAttribute('aria-expanded', 'true'); button.textContent = 'LOT ▴';
      } catch (error) { fail(error); } finally { button.disabled = false; }
    });
    $$('[data-stock-moves]', main).forEach(button => button.onclick = async () => {
      const r = rows[button.dataset.stockMoves];
      try {
        const query = new URLSearchParams({ item: r.item, unit: r.unit, asof: result.asof }); if (bySpec) query.set('spec', r.spec);
        const m = await api('GET', '/api/inventory/movements?' + query);
        modal(`<h3>${esc(r.item)} ${bySpec ? esc(r.spec) : ''} · 재고 내역</h3><p>기준일 ${esc(result.asof)} 현재고 <b>${fmtNum(m.stock)}</b> ${esc(r.unit || '단위 미지정')}</p><div class="table-wrap"><table class="grid"><thead><tr><th>일자</th><th>구분</th><th class="r">수량</th><th>규격</th><th>내용</th></tr></thead><tbody>${m.rows.map(x => `<tr><td>${esc(x.d === '0000-00-00' ? '' : x.d)}</td><td><span class="chip ${x.qty < 0 ? 'red' : 'green'}">${STOCK_SOURCE[x.src] || esc(x.src)}</span></td><td class="r"><b>${x.qty > 0 ? '+' : ''}${fmtNum(x.qty)}</b></td><td>${esc(x.spec)}</td><td class="small">${esc(x.memo)}</td></tr>`).join('') || '<tr><td colspan="5">내역이 없습니다.</td></tr>'}</tbody></table></div>${m.more ? '<p class="small muted">최근 200건만 표시합니다.</p>' : ''}`, { wide: true });
      } catch (error) { fail(error); }
    });
    $$('[data-stock-min]', main).forEach(button => button.onclick = async () => {
      const r = rows[button.dataset.stockMin];
      const v = await promptBox(`${r.item} · 안전재고`, `<p class="small muted">현재고가 이 수량보다 적으면 '미달'로 표시하고 대시보드에 알립니다. 비우면 기준을 없앱니다.</p><label>안전재고 (${esc(r.unit || '단위 미지정')})<input name="min_qty" type="number" min="0" step="any" value="${esc(r.min_qty ?? '')}"></label>`);
      if (!v) return;
      try { await api('PUT', '/api/inventory/levels', { item: r.item, unit: r.unit, min_qty: v.min_qty }); toast('안전재고 기준을 저장했습니다.'); load(); } catch (error) { fail(error); }
    });
    $$('[data-stock-count]', main).forEach(button => button.onclick = () => { const r = rows[button.dataset.stockCount]; adjust({ item: r.item, spec: bySpec ? r.spec : '', unit: r.unit, kind: 'count' }); });
  };
  form.onsubmit = event => { event.preventDefault(); load().catch(fail); };
  // 15.155 보기(품목 합계/규격별)는 결과 위 버튼 — 바꾸면 바로 다시 조회하고, 다음에 열 때도 그 보기로
  try { const g = localStorage.getItem('wpa:stock-group'); if (g) $$('[name=group]', main).forEach(r => { r.checked = r.value === g; }); } catch { /* 편의 */ }
  $$('[name=group]', main).forEach(r => { r.onchange = () => { try { localStorage.setItem('wpa:stock-group', r.value); } catch { /* 편의 */ } const want = r.value === 'place' ? 'wh' : 'cat'; if (want !== nav) { nav = want; sel = { k: 'all', p: [] }; saveTree(); drawTree(); } load().catch(fail); }; });
  if (nav === 'wh') setGroup('place'); else if ($$('[name=group]', main).find(x => x.checked)?.value === 'place') setGroup('item');
  drawTree();
  $('#stockCsv').onclick = () => {
    if (!current.rows.length) return toast('저장할 재고가 없습니다.', 'err');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([stockCsv(current.rows, current.group === 'spec')], { type: 'text/csv;charset=utf-8' }));
    link.download = `재고현황-${current.asof}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  await load();
}

// LOT별 재고(15.72): LOT가 적힌 입고(발주입고·기타입고) − 같은 LOT 출하. 생산 투입은 LOT를 기록하지 않아 빠지지 않는다.
async function stockLotWindow(asof, q = '') {
  const m = modal(`<h3>LOT별 재고 <span class="small muted">기준일 ${esc(asof)}</span></h3>
    <p class="small muted">LOT가 적힌 입고(발주입고·기타입고)에서 같은 LOT로 출하한 수량을 뺀 잔량입니다. 생산 투입(BOM)은 LOT를 기록하지 않아 빠지지 않으니, 품목 전체 재고는 재고 현황 표를 보세요.</p>
    <form class="toolbar" data-read-only data-lot-form><label class="grow">품목·LOT 검색<input type="search" name="q" value="${esc(q)}" maxlength="200"></label><label class="inline"><input type="checkbox" name="instock" checked> 잔량 있는 LOT만</label><button class="btn primary">조회</button></form>
    <div data-lot-list><p class="muted">불러오는 중…</p></div>`, { wide: true });
  const form = $('[data-lot-form]', m.el);
  const load = async () => {
    const v = formObj(form);
    const data = await api('GET', '/api/inventory/lots?' + new URLSearchParams({ asof, q: v.q || '', ...(form.elements.instock.checked ? { state: 'instock' } : {}) }));
    if (!m.el.isConnected) return;
    $('[data-lot-list]', m.el).innerHTML = data.rows.length ? `<p class="small muted">${fmtNum(data.rows.length)}개 LOT${data.more ? ' (더 있음 · 검색으로 좁히세요)' : ''}</p><div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th>LOT</th><th class="r">입고</th><th class="r">출하</th><th class="r">잔량</th><th>단위</th><th>입고일</th><th>창고 · 위치</th><th></th></tr></thead><tbody>${data.rows.map((r, i) => `<tr><td data-card-primary><b>${esc(r.item)}</b></td><td data-card-primary>${esc(r.lot)}</td><td class="r">${fmtNum(r.received)}</td><td class="r">${fmtNum(r.shipped)}</td><td class="r"><b class="${r.balance < 0 ? 'red-text' : ''}">${fmtNum(r.balance)}</b></td><td>${esc(r.unit)}</td><td class="nowrap">${esc(r.first_date)}${r.last_date !== r.first_date ? ' ~ ' + esc(r.last_date) : ''}</td><td>${esc(r.places)}</td><td class="nowrap"><button type="button" class="btn small" data-lot-move="${i}">위치 · 이동</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 LOT가 없습니다.</div>';
    $$('[data-lot-move]', m.el).forEach(b => b.onclick = () => lotMoveWindow(data.rows[b.dataset.lotMove], load).catch(fail));
  };
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  form.elements.instock.onchange = () => load().catch(fail);
  await load().catch(fail);
}

// 15.114 창고 이동: LOT의 위치별 잔량(위치가 적힌 입고 + 이동 들어옴 − 나감, 출하는 먼저 들어온 위치부터) → 다른 창고·위치로 옮기기.
// 품목 전체 재고는 바뀌지 않는다. 이동 기록은 취소(옮긴 위치에 그만큼 남아 있을 때만)할 수 있다.
async function lotMoveWindow(lot, after) {
  const [info, warehouses] = await Promise.all([api('GET', '/api/inventory/lot-places?' + new URLSearchParams({ item: lot.item, unit: lot.unit, lot: lot.lot })), api('GET', '/api/warehouses')]);
  const canMove = ME.is_admin || ME.roles.includes('logistics') || ME.roles.includes('logistics_approver');
  const placeName = p => p || '위치 미지정';
  const avail = info.places.filter(p => p.qty > 0);
  const m = modal(`<h3>${esc(lot.item)} · LOT ${esc(lot.lot)} <span class="small muted">위치별 잔량</span></h3>
    <div class="table-wrap"><table class="grid" data-keep-cols data-no-sort><thead><tr><th>창고 · 위치</th><th class="r">잔량</th><th>처음 들어온 날</th></tr></thead><tbody>${info.places.length ? info.places.map(p => `<tr><td>${esc(placeName(p.place))}</td><td class="r"><b class="${p.qty < 0 ? 'red-text' : ''}">${fmtNum(p.qty)}</b> ${esc(lot.unit)}</td><td>${esc(p.first_date)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">남은 수량이 없습니다.</td></tr>'}</tbody></table></div>
    <p class="small muted">출하는 위치를 적지 않아 먼저 들어온 위치부터 뺀 값입니다.</p>
    ${canMove && avail.length && warehouses.length ? `<form class="card" data-move-form><h4>창고 이동</h4><div class="form-grid">
      <label>보낼 위치 *<select name="from_place">${avail.map(p => `<option value="${esc(p.place)}">${esc(placeName(p.place))} (${fmtNum(p.qty)})</option>`).join('')}</select></label>
      <label>받을 창고 *<select name="to_warehouse">${warehouses.map(w => `<option>${esc(w.name)}</option>`).join('')}</select></label>
      <label>받을 위치<select name="to_location"></select></label>
      <label>수량 * <span class="hint">(${esc(lot.unit)})</span><input name="qty" type="number" step="any" min="0" required></label>
      <label>이동일 *<input name="transfer_date" type="date" required value="${todayStr()}" max="${todayStr()}"></label>
      <label class="span2">비고<input name="note" maxlength="200"></label></div>
      <div class="actions"><button type="button" class="btn small" data-move-all>전량</button><button class="btn primary">옮기기</button></div></form>` : canMove ? `<p class="small muted">${warehouses.length ? '옮길 잔량이 없습니다.' : '먼저 창고를 등록하세요(물류 › 창고).'}</p>` : ''}
    <h4>이동 기록</h4>${info.transfers.length ? `<div class="table-wrap"><table class="grid" data-keep-cols data-no-sort><thead><tr><th>이동일</th><th>보낸 곳</th><th>받은 곳</th><th class="r">수량</th><th>비고</th><th>입력</th><th></th></tr></thead><tbody>${info.transfers.map(t => `<tr class="${t.status === 'cancelled' ? 'muted' : ''}"><td>${esc(t.transfer_date)}</td><td>${esc(placeName(t.from_place))}</td><td>${esc(t.to_place)}</td><td class="r">${fmtNum(t.qty)}</td><td>${esc(t.note)}</td><td class="small">${esc(t.created_by)}${t.status === 'cancelled' ? ` · <span class="red-text">취소 ${esc(t.cancelled_by || '')}</span>` : ''}</td><td>${t.status === 'confirmed' && (ME.is_admin || ME.roles.includes('logistics_approver') || t.created_by_id === ME.id) ? `<button type="button" class="btn small danger" data-move-cancel="${t.id}">취소</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">아직 옮긴 적이 없습니다.</p>'}
    <div class="actions"><button type="button" class="btn" data-close>닫기</button></div>`, { wide: true });
  $('[data-close]', m.el).onclick = m.close;
  const reopen = async () => { m.close(); await after?.(); await lotMoveWindow(lot, after); };
  const form = $('[data-move-form]', m.el);
  if (form) {
    const locs = () => { const w = warehouses.find(x => x.name === form.elements.to_warehouse.value); const list = w?.locations ? w.locations.split(',') : []; form.elements.to_location.innerHTML = '<option value="">(위치 없음)</option>' + list.map(l => `<option>${esc(l)}</option>`).join(''); };
    form.elements.to_warehouse.onchange = locs; locs();
    $('[data-move-all]', form).onclick = () => { const p = avail.find(x => x.place === form.elements.from_place.value); form.elements.qty.value = p ? p.qty : ''; };
    form.onsubmit = async e => {
      e.preventDefault(); const v = formObj(form); const button = form.querySelector('button.primary'); button.disabled = true;
      try { await api('POST', '/api/stock-transfers', { ...v, item: lot.item, unit: lot.unit, lot: lot.lot, request_id: crypto.randomUUID() }); toast(`${placeName(v.from_place)} → ${`${v.to_warehouse} ${v.to_location}`.trim()} ${fmtNum(v.qty)}${lot.unit} 옮겼습니다.`); await reopen(); }
      catch (error) { fail(error); } finally { button.disabled = false; }
    };
  }
  $$('[data-move-cancel]', m.el).forEach(b => b.onclick = async () => {
    if (!await confirmBox('이 이동을 취소할까요? 옮긴 수량이 보낸 곳으로 돌아갑니다.')) return;
    try { await api('POST', `/api/stock-transfers/${b.dataset.moveCancel}/cancel`, {}); toast('이동을 취소했습니다.'); await reopen(); } catch (error) { fail(error); }
  });
}

// 15.114 안전재고 부족분 → 발주. 기본 수량 = 안전재고 − 현재고 − 입고 전 발주(0 이하면 체크 해제), 매입처 = 마지막 발주 매입처,
// 단가 = 그 매입처 단가표 → 마지막 발주 단가. 매입처별로 한 번씩 /api/batches/purchase_order(같은 구매의뢰번호로 묶임).
async function stockReorder(lowRows) {
  const info = (await api('POST', '/api/inventory/reorder-info', { items: lowRows.map(r => ({ item: r.item, unit: r.unit })) })).items;
  const round = n => Math.round(n * 1000) / 1000;
  const lines = lowRows.map((r, i) => { const x = info[i]; const need = round(r.min_qty - r.stock - x.open_qty); return { ...x, stock: r.stock, min_qty: r.min_qty, need, on: need > 0 && !!x.bom_id }; });
  const due = new Date(Date.now() + 7 * 864e5 + 9 * 36e5).toISOString().slice(0, 10);
  const m = modal(`<h3>부족분 발주 <span class="small muted">안전재고 미달 ${lines.length}품목</span></h3>
    <p class="small muted">부족분 = 안전재고 − 현재고 − 입고 전 발주. 매입처별로 발주가 만들어집니다(같은 매입처 품목은 같은 구매의뢰번호). 단가는 그 매입처 단가표, 없으면 마지막 발주 단가.</p>
    <form><div class="form-grid"><label>납기일 *<input type="date" name="due_date" required value="${due}"></label></div>
    <div class="table-wrap"><table class="grid" data-keep-cols data-no-sort><thead><tr><th><input type="checkbox" data-ro-all checked aria-label="모두"></th><th>품목</th><th class="r">현재고</th><th class="r">안전재고</th><th class="r">입고 전 발주</th><th class="r">발주 수량</th><th>단위</th><th>매입처</th><th class="r">단가</th></tr></thead>
    <tbody>${lines.map((l, i) => `<tr data-ro="${i}"><td><input type="checkbox" data-ro-on ${l.on ? 'checked' : ''} ${l.bom_id ? '' : 'disabled title="등록 품목이 아니라 발주할 수 없습니다"'}></td>
      <td><b>${esc(l.item)}</b>${l.bom_id ? `<div class="small muted">${esc(l.product_code)}</div>` : '<div class="small red-text">등록 품목 아님</div>'}</td><td class="r">${fmtNum(l.stock)}</td><td class="r">${fmtNum(l.min_qty)}</td>
      <td class="r">${l.open_qty ? `${fmtNum(l.open_qty)} <span class="small muted">(${l.open_count}건)</span>` : '0'}</td>
      <td class="r"><input type="number" step="any" min="0" data-ro-qty value="${Math.max(0, l.need)}" style="width:7em"></td><td>${esc(l.unit)}</td>
      <td><input data-ro-vendor maxlength="100" value="${esc(l.last_vendor)}" style="width:10em"></td><td class="r"><input type="number" step="any" min="0" data-ro-price value="${l.last_price ?? ''}" style="width:7em"></td></tr>`).join('')}</tbody></table></div>
    <div class="actions"><span class="small muted" data-ro-sum></span><button type="button" class="btn" data-close>닫기</button><button class="btn primary">발주 만들기</button></div></form>`, { wide: true });
  m.el.classList.add('lr-modal', 'ro-modal'); // 15.123 넓게(품목 칸이 한 글자씩 꺾이지 않게)
  const form = $('form', m.el), rowsEl = $$('[data-ro]', m.el);
  const pick = () => rowsEl.map(tr => ({ l: lines[tr.dataset.ro], on: $('[data-ro-on]', tr).checked, qty: Number($('[data-ro-qty]', tr).value), vendor: $('[data-ro-vendor]', tr).value.trim(), price: $('[data-ro-price]', tr).value, tr })).filter(x => x.on);
  const vkey = v => v.replace(/\s+/g, '').toLowerCase();
  const sum = () => { const p = pick(); $('[data-ro-sum]', m.el).textContent = `${p.length}품목 · 매입처 ${new Set(p.map(x => vkey(x.vendor)).filter(Boolean)).size}곳`; };
  rowsEl.forEach(tr => {
    const price = $('[data-ro-price]', tr), vendor = $('[data-ro-vendor]', tr), l = lines[tr.dataset.ro];
    price.addEventListener('input', () => { price.dataset.touched = '1'; });
    const fill = async () => { const v = vendor.value.trim(); if (!v || price.dataset.touched || !l.bom_id) return; const p = (await tablePrices('purchase', v))[l.bom_id]?.unit_price; if (p != null) price.value = p; };
    if (typeof bindPartnerPicker === 'function') bindPartnerPicker(vendor, null, { type: 'purchase' }).catch(() => {});
    vendor.addEventListener('change', () => { fill().catch(() => {}); sum(); }); fill().catch(() => {});
  });
  $$('[data-ro-on], [data-ro-qty]', m.el).forEach(x => x.addEventListener('input', sum)); sum();
  $('[data-ro-all]', m.el).onchange = e => { $$('[data-ro-on]:not(:disabled)', m.el).forEach(c => { c.checked = e.target.checked; }); sum(); };
  $('[data-close]', m.el).onclick = m.close;
  form.onsubmit = async e => {
    e.preventDefault(); const p = pick();
    if (!p.length) return toast('발주할 품목을 고르세요.', 'err');
    const badRow = p.find(x => !(x.qty > 0) || !x.vendor);
    if (badRow) { $(!(badRow.qty > 0) ? '[data-ro-qty]' : '[data-ro-vendor]', badRow.tr).focus(); return toast(`${badRow.l.item}: ${!(badRow.qty > 0) ? '발주 수량' : '매입처'}를 넣으세요.`, 'err'); }
    const groups = new Map(); for (const x of p) { const k = vkey(x.vendor); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    if ([...groups.values()].some(g => g.length > 30)) return toast('한 매입처에 30품목까지 한 번에 발주할 수 있습니다.', 'err');
    const button = form.querySelector('button.primary'); button.disabled = true; const done = [];
    try {
      for (const g of groups.values()) {
        const r = await api('POST', '/api/batches/purchase_order', { request_id: crypto.randomUUID(), common: { vendor: g[0].vendor, due_date: form.elements.due_date.value, note: '안전재고 부족분' }, items: g.map(x => ({ bom_id: x.l.bom_id, item: x.l.item, qty: x.qty, unit: x.l.unit, item_category: x.l.item_category, unit_price: x.price })) });
        done.push(`${g[0].vendor} ${g.length}품목${r.rows?.[0]?.req_no ? ` (${r.rows[0].req_no})` : ''}`);
        g.forEach(x => { x.tr.querySelector('[data-ro-on]').checked = false; x.tr.querySelector('[data-ro-on]').disabled = true; x.tr.classList.add('muted'); });
      }
      toast(`발주를 만들었습니다: ${done.join(', ')}`); m.close(); location.hash = '#/purchase/po';
    } catch (error) { fail(error); if (done.length) toast(`먼저 만든 발주: ${done.join(', ')} — 남은 매입처만 다시 누르세요.`, 'err'); sum(); }
    finally { button.disabled = false; }
  };
}

// ── 15.115 QR 스캔: LOT 라벨 QR(「LOT|코드|수량 단위|입고번호」) 또는 LOT 글자. 휴대폰 카메라(BarcodeDetector) · USB 스캐너(글자 입력 + Enter) ──
// 찾은 LOT의 잔량·위치를 보이고 바로 출하 기록 · 창고 이동을 한다. 같은 LOT가 여러 품목에 있으면 코드로 가린다.
function parseLotScan(text) {
  const raw = String(text || '').trim(); if (!raw) return null;
  const parts = raw.split('|').map(x => x.trim());
  // 15.190 입고 라벨은 LOT-서브(R261113_0049-001). 재고는 LOT(R261113_0049) 단위라 뒤 -NNN을 떼어 찾는다. 생산 LOT(P261113-001)는 _가 없어 그대로.
  const m = /^(.+_\d+)-(\d{3})$/.exec(parts[0]);
  return { lot: m ? m[1] : parts[0], sub: m ? m[2] : (parts[4] || ''), code: parts.length > 1 ? parts[1] : '', receipt: parts[3] || '', raw };
}
async function pageScan(main) {
  main.innerHTML = `<h1>QR 스캔 <span class="dept">물류</span></h1>
  <p class="muted">LOT 라벨의 QR을 찍거나(휴대폰 카메라) USB 스캐너로 읽으면 그 LOT의 잔량·위치가 나오고, 바로 출하 기록이나 창고 이동을 합니다. LOT 번호를 직접 넣어도 됩니다. <b>파렛트 QR(PLT_…)</b>을 찍으면 묶인 LOT가 모두 나오고 「파렛트 출고」 한 번으로 LOT별 출하가 됩니다.</p>
  <form class="toolbar" id="scanForm" data-read-only><label class="grow">LOT · QR 내용<input name="code" autocomplete="off" autofocus placeholder="스캐너로 읽거나 LOT 입력 후 Enter"></label><button class="btn primary">찾기</button><button type="button" class="btn" id="scanCam">카메라로 스캔</button></form>
  <div id="scanCamBox" hidden><video id="scanVideo" playsinline muted style="width:100%;max-width:480px;border:1px solid var(--line)"></video><div class="actions" style="justify-content:flex-start"><button type="button" class="btn" id="scanStop">카메라 끄기</button></div></div>
  <div id="scanResult"></div><h3>이번에 찍은 것</h3><div id="scanLog" class="small muted">아직 없습니다.</div>`;
  const form = $('#scanForm', main), input = form.elements.code, log = [];
  let stream = null, timer = null;
  const stop = () => { clearInterval(timer); timer = null; stream?.getTracks().forEach(t => t.stop()); stream = null; $('#scanCamBox', main).hidden = true; };
  const addLog = text => { log.unshift(`${new Date().toTimeString().slice(0, 8)} · ${text}`); $('#scanLog', main).innerHTML = log.slice(0, 20).map(x => `<div>${esc(x)}</div>`).join(''); };
  const show = async text => {
    // 15.231 파렛트 QR(PLT_…)이면 파렛트 창: 내용 확인 · 한 번에 출고
    const raw = String(text || '').trim();
    if (/^PLT_\d{8}_\d{3,}$/i.test(raw)) { try { const p = await api('GET', '/api/pallets/lookup?code=' + encodeURIComponent(raw)); addLog(`${p.pallet_no} — 파렛트 ${PLT_STATUS[p.status]} · ${palletText(p)} = ${fmtNum(p.total)}`); $('#scanResult', main).innerHTML = `<div class="card"><h3>파렛트 <span class="lot-tag">${esc(p.pallet_no)}</span> <span class="chip">${PLT_STATUS[p.status]}</span></h3><p>${esc(palletText(p))} = <b>${fmtNum(p.total)} ${esc(p.unit || '')}</b></p></div>`; await palletWindow(p.pallet_no, () => {}); } catch (error) { fail(error); addLog(`${raw} — 없음`); } return; }
    const scan = parseLotScan(text); if (!scan) return;
    const box = $('#scanResult', main); box.innerHTML = '<p class="muted">찾는 중…</p>';
    let data = await api('GET', '/api/inventory/lots?' + new URLSearchParams({ asof: todayStr(), q: scan.lot }));
    let rows = data.rows.filter(r => r.lot === scan.lot), piece = '';
    // 15.252 절 코드(L1-3, LOT-1 임시 절): 재고는 LOT 단위라 뒤 -번호를 떼어 다시 찾는다
    if (!rows.length && /-\d+$/.test(scan.lot)) { const base = scan.lot.replace(/-\d+$/, ''); data = await api('GET', '/api/inventory/lots?' + new URLSearchParams({ asof: todayStr(), q: base })); rows = data.rows.filter(r => r.lot === base); if (rows.length) { piece = scan.lot; scan.lot = base; } }
    let boms = [];
    if (scan.code) { boms = (await api('GET', '/api/boms?' + new URLSearchParams({ q: scan.code }))).filter(b => String(b.product_code).toUpperCase() === scan.code.toUpperCase()); if (boms.length) rows = rows.filter(r => boms.some(b => b.product.replace(/\s+/g, '').toLowerCase() === r.item.replace(/\s+/g, '').toLowerCase())); }
    if (!main.isConnected) return;
    if (!rows.length) { box.innerHTML = `<div class="empty">재고 LOT ${esc(scan.lot)}를 찾지 못했습니다.${scan.code ? ` (코드 ${esc(scan.code)})` : ''} 봉투(반제품)·완제품 LOT이면 <button type="button" class="link-btn" data-scan-trace>LOT 연결 조회</button>에서 보세요.</div>`; $('[data-scan-trace]', box).onclick = () => { try { sessionStorage.setItem('wpa:lot-trace', scan.lot); } catch { /* */ } location.hash = '#/prod/lot-trace'; }; addLog(`${scan.lot} — 재고 없음`); return; }
    box.innerHTML = rows.map((r, i) => `<div class="card" data-scan-row="${i}"><h3>${esc(r.item)} <span class="tag">LOT ${esc(r.lot)}</span>${piece ? ` <span class="tag">절 ${esc(piece)}</span>` : ''}</h3>
      <p>잔량 <b class="${r.balance <= 0 ? 'red-text' : ''}">${fmtNum(r.balance)} ${esc(r.unit)}</b> · 입고 ${fmtNum(r.received)} · 출하 ${fmtNum(r.shipped)} · 입고일 ${esc(r.first_date)}${r.places ? ` · 위치 ${esc(r.places)}` : ''}</p>
      <form class="form-grid" data-scan-ship><label>출하 수량 *<input name="qty" type="number" step="any" min="0" required value="${r.balance > 0 ? r.balance : ''}"></label><label>거래처 *<input name="customer" maxlength="100" required></label><label>출하일 *<input name="ship_date" type="date" required value="${todayStr()}" max="${todayStr()}"></label>
        <div class="actions span3" style="justify-content:flex-start"><button class="btn primary">출하 기록</button><button type="button" class="btn" data-scan-move>위치 · 이동</button></div></form></div>`).join('');
    addLog(`${scan.lot} — ${rows.map(r => `${r.item} 잔량 ${fmtNum(r.balance)}${r.unit}`).join(', ')}`);
    $$('[data-scan-row]', box).forEach(card => {
      const r = rows[card.dataset.scanRow], f = $('[data-scan-ship]', card);
      if (typeof bindPartnerPicker === 'function') bindPartnerPicker(f.elements.customer, null, { type: 'sales' }).catch(() => {});
      $('[data-scan-move]', card).onclick = () => lotMoveWindow(r, () => show(text)).catch(fail);
      f.onsubmit = async e => {
        e.preventDefault(); const v = formObj(f); const button = f.querySelector('button.primary'); button.disabled = true;
        try {
          const bom = boms.find(b => b.product.replace(/\s+/g, '').toLowerCase() === r.item.replace(/\s+/g, '').toLowerCase());
          await api('POST', '/api/shipments', { ship_date: v.ship_date, item: r.item, ...(bom ? { bom_id: bom.id } : {}), qty: v.qty, unit: r.unit, customer: v.customer, lot: r.lot, note: 'QR 스캔 출하', request_id: formToken(f) }); delete f.dataset.rid;
          toast(`${r.item} LOT ${r.lot} ${fmtNum(v.qty)}${r.unit} 출하를 기록했습니다.`); addLog(`${r.lot} — 출하 ${fmtNum(v.qty)}${r.unit} → ${v.customer}`); await show(text);
        } catch (error) { fail(error); } finally { button.disabled = false; }
      };
    });
  };
  form.onsubmit = e => { e.preventDefault(); const t = input.value; input.value = ''; show(t).catch(fail).finally(() => input.focus()); };
  $('#scanStop', main).onclick = stop;
  $('#scanCam', main).onclick = async () => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return toast('이 브라우저는 카메라 QR 읽기를 지원하지 않습니다. 안드로이드 크롬을 쓰거나 USB 스캐너·LOT 입력을 쓰세요.', 'err');
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = $('#scanVideo', main); video.srcObject = stream; await video.play(); $('#scanCamBox', main).hidden = false;
      let last = '', busy = false;
      timer = setInterval(async () => {
        if (busy || !main.isConnected) { if (!main.isConnected) stop(); return; } busy = true;
        try { const codes = await detector.detect(video); const v = codes[0]?.rawValue; if (v && v !== last) { last = v; navigator.vibrate?.(80); await show(v); setTimeout(() => { last = ''; }, 3000); } }
        catch { /* 다음 프레임 */ } finally { busy = false; }
      }, 400);
    } catch (error) { stop(); fail(new Error('카메라를 열 수 없습니다: ' + (error.message || error))); }
  };
  window.addEventListener('hashchange', stop, { once: true });
}

// ── 15.231 파렛트 묶음: LOT 여러 개를 한 파렛트(PLT_YYYYMMDD_NNN)로 묶고 QR 하나로 출고 ──
const PLT_STATUS = { open: '묶음', shipped: '출고 완료', cancelled: '풀림' };
const palletText = p => p.lines.filter(l => l.qty > 0).map(l => `${l.lot} ${fmtNum(l.qty)}`).join(' + ');
const palletCard = p => { const items = [...new Set(p.lines.map(l => l.item))]; return { code: p.pallet_no, sub: `${items.join(', ')} · ${palletText(p)} = ${fmtNum(p.total)} ${p.unit || ''}`.trim() }; };
// 파렛트 한 개 창: 내용·수량 고치기(꺼내 쓰기)·출고·풀기·QR. 스캔 화면과 목록에서 같이 쓴다.
async function palletWindow(code, after) {
  const p = await api('GET', '/api/pallets/lookup?code=' + encodeURIComponent(code)), can = ME.is_admin || ME.roles.includes('logistics') || ME.roles.includes('logistics_approver'), open = p.status === 'open';
  const m = modal(`<h3>파렛트 <span class="lot-tag">${esc(p.pallet_no)}</span> <span class="chip ${p.status === 'open' ? 'green' : p.status === 'shipped' ? '' : 'yellow'}">${PLT_STATUS[p.status]}</span></h3>
    <p class="small muted">${esc(p.created_by)} · ${esc(String(p.created_at).slice(0, 16))}${p.note ? ` · ${esc(p.note)}` : ''}${p.status === 'shipped' ? ` · 출고 ${esc(String(p.shipped_at).slice(0, 16))} ${esc(p.shipped_by || '')} → ${esc(p.customer)}` : ''}</p>
    <form data-plt-edit><div class="table-wrap"><table class="grid keep-table"><thead><tr><th>품목</th><th>LOT</th><th class="r">묶을 때</th><th class="r">지금 수량</th></tr></thead><tbody>${p.lines.map(l => `<tr><td>${esc(l.item)}</td><td><span class="lot-tag">${esc(l.lot)}</span></td><td class="r small muted">${fmtNum(l.orig_qty)}</td><td class="r">${open && can ? `<input type="number" min="0" step="any" inputmode="decimal" data-plt-qty="${l.id}" value="${esc(l.qty)}" aria-label="${esc(l.lot)} 수량" style="width:7em">` : `<b>${fmtNum(l.qty)}</b>`} ${esc(l.unit)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="3" class="r">합계</th><td class="r"><b>${fmtNum(p.total)}</b> ${esc(p.unit || '')}</td></tr></tfoot></table></div>
      ${open && can ? '<div class="form-grid"><label class="span2">바꾼 이유 <span class="hint">(예: 2박스 먼저 사용)</span><input name="reason" maxlength="200"></label></div><div class="actions" style="justify-content:flex-start"><button class="btn">수량 저장(QR 그대로)</button></div>' : ''}</form>
    ${open && can ? `<form class="card form-grid" data-plt-ship><h4 class="span3">이 파렛트 출고 <span class="small muted">LOT마다 출하가 생기고 재고에서 빠집니다</span></h4><label>출고일 *<input type="date" name="ship_date" value="${todayStr()}" max="${todayStr()}" required></label><label>거래처 *<input name="customer" maxlength="100" required autocomplete="off"></label><label>메모<input name="note" maxlength="200"></label><div class="actions span3" style="justify-content:flex-start"><button class="btn primary">파렛트 출고 (${fmtNum(p.total)} ${esc(p.unit || '')})</button></div></form>` : ''}
    ${(p.changes || []).length ? `<div class="doc-changes small muted"><b>이력</b> ${p.changes.map(c => `${esc(String(c.changed_at).slice(5, 16))} ${esc(c.changed_by)} · ${esc(c.summary)}`).join(' / ')}</div>` : ''}
    <div class="actions"><button type="button" class="btn" data-x>닫기</button>${open && can ? '<button type="button" class="btn danger" data-plt-cancel>묶음 풀기</button>' : ''}<button type="button" class="btn qr-pdf-btn" data-plt-qr>QR코드 발행</button></div>`, { wide: true });
  const reopen = async () => { m.close(); await after?.(); await palletWindow(p.pallet_no, after); };
  $('[data-x]', m.el).onclick = m.close;
  $('[data-plt-qr]', m.el).onclick = () => qrIssue([palletCard(p)], { title: 'QR코드 발행 · 파렛트', file: '파렛트' });
  const ship = $('[data-plt-ship]', m.el);
  if (ship) {
    if (typeof bindPartnerPicker === 'function') bindPartnerPicker(ship.elements.customer, null, { type: 'sales' }).catch(() => {});
    ship.onsubmit = async e => { e.preventDefault(); const b = $('button.primary', ship); b.disabled = true; try { const v = formObj(ship); await api('POST', `/api/pallets/${p.id}/ship`, v); toast(`${p.pallet_no} 출고 · ${palletText(p)} → ${v.customer}`); await reopen(); } catch (error) { fail(error); } finally { b.disabled = false; } };
  }
  const edit = $('[data-plt-edit]', m.el);
  edit.onsubmit = async e => { e.preventDefault(); const lines = $$('[data-plt-qty]', edit).map(x => ({ id: Number(x.dataset.pltQty), qty: x.value })); try { await api('PUT', `/api/pallets/${p.id}`, { lines, reason: edit.elements.reason?.value || '' }); toast('파렛트 수량을 고쳤습니다(QR은 그대로 씁니다).'); await reopen(); } catch (error) { fail(error); } };
  $('[data-plt-cancel]', m.el)?.addEventListener('click', async () => { if (!await confirmBox(`${p.pallet_no} 묶음을 풀까요? 재고는 그대로이고 이 QR은 더 쓸 수 없습니다.`)) return; try { await api('POST', `/api/pallets/${p.id}/cancel`); toast('묶음을 풀었습니다.'); await reopen(); } catch (error) { fail(error); } });
  return m;
}
async function pagePallets(main) {
  const can = ME.is_admin || ME.roles.includes('logistics') || ME.roles.includes('logistics_approver');
  main.innerHTML = `<h1>파렛트 묶음 <span class="dept">물류</span></h1>
  <p class="muted">한 파렛트에 올린 박스들을 LOT별 수량으로 묶어 <b>파렛트 QR</b> 하나를 붙입니다(예: 니트릴 S 2월 LOT 40 + 3월 LOT 20 = 60박스). 출고 때 그 QR만 찍으면(QR 스캔 화면) LOT별 출하가 한 번에 생기고 재고에서 LOT마다 빠집니다. 몇 박스를 먼저 꺼내 쓰면 파렛트를 열어 수량만 고치면 되고 QR은 다시 뽑지 않아도 됩니다. 묶기만 해서는 재고가 바뀌지 않습니다.</p>
  ${can ? `<section class="card plt-new"><h2>새 파렛트 묶기</h2>
    <form class="toolbar" data-read-only id="pltFind"><label class="grow">품목·LOT 찾기<input type="search" name="q" maxlength="200" placeholder="예) 니트릴, R2602"></label><button class="btn">찾기</button></form>
    <div id="pltLots"><p class="small muted">품목이나 LOT를 찾으면 잔량 있는 LOT가 나옵니다. 담을 수량을 넣으세요.</p></div>
    <div class="form-grid"><label class="span2">메모<input id="pltNote" maxlength="300" placeholder="예) 1번 파렛트 · 1동 A-1"></label></div>
    <div class="actions" style="justify-content:flex-start"><span class="small" id="pltPick">담은 것 없음</span><button type="button" class="btn primary" id="pltMake" disabled>파렛트 만들고 QR 발행</button></div></section>` : ''}
  <h2>파렛트 목록</h2>
  <form class="list-filters toolbar" data-read-only id="pltFilters"><label>상태<select name="status"><option value="open">묶음(출고 전)</option><option value="shipped">출고 완료</option><option value="cancelled">풀림</option><option value="all">전체</option></select></label><label class="list-search">검색<input type="search" name="q" maxlength="100" placeholder="파렛트 번호·품목·LOT·거래처"></label><button class="btn primary">조회</button></form>
  <div class="result-bar"><div class="counts" id="pltSum"></div><span class="result-tools"><button type="button" class="btn qr-pdf-btn" id="pltQrAll" disabled>QR코드 발행</button></span></div>
  <div id="pltList"><p class="muted">불러오는 중…</p></div>`;
  const filters = $('#pltFilters', main); let rows = [], lots = [], requestId = crypto.randomUUID();
  const picked = () => $$('[data-plt-pick]:checked', main).map(x => rows[Number(x.dataset.pltPick)]);
  const syncPick = () => { const n = picked().length; const b = $('#pltQrAll', main); b.disabled = !n; b.textContent = n ? `QR코드 발행 (${n})` : 'QR코드 발행'; };
  const load = async () => {
    const data = await api('GET', '/api/pallets?' + new URLSearchParams(formObj(filters))); if (!main.isConnected) return; rows = data.rows;
    $('#pltSum', main).textContent = `파렛트 ${fmtNum(rows.length)}개 · 합계 ${fmtNum(rows.reduce((t, r) => t + r.total, 0))}`;
    $('#pltList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid plt-grid"><thead><tr><th class="pick-cell"><input type="checkbox" data-plt-all aria-label="모두 고르기"></th><th>파렛트 번호</th><th>품목</th><th>LOT별 수량</th><th class="r">합계</th><th>상태</th><th>만든 날</th><th>메모·거래처</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="pick-cell"><input type="checkbox" data-plt-pick="${i}" aria-label="${esc(r.pallet_no)} 고르기"></td><td class="nowrap"><button type="button" class="link-btn" data-plt-open="${esc(r.pallet_no)}"><b>${esc(r.pallet_no)}</b></button></td><td data-card-primary>${esc([...new Set(r.lines.map(l => l.item))].join(', '))}</td><td class="small">${r.lines.map(l => `<span class="lot-tag">${esc(l.lot)}</span> ${fmtNum(l.qty)}${l.qty !== l.orig_qty ? ` <span class="muted">(처음 ${fmtNum(l.orig_qty)})</span>` : ''}`).join('<br>')}</td><td class="r"><b>${fmtNum(r.total)}</b> ${esc(r.unit || '')}</td><td><span class="chip ${r.status === 'open' ? 'green' : r.status === 'shipped' ? '' : 'yellow'}">${PLT_STATUS[r.status]}</span></td><td class="small muted">${esc(String(r.created_at).slice(0, 10))}</td><td class="small">${esc(r.note || '')}${r.customer ? `<div>→ ${esc(r.customer)}</div>` : ''}</td><td class="nowrap"><button type="button" class="btn small" data-plt-open="${esc(r.pallet_no)}">열기</button> <button type="button" class="btn small" data-plt-one="${i}">QR</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 파렛트가 없습니다.</div>';
    syncPick();
  };
  // 묶기: LOT 찾기 → 수량 넣기
  const drawLots = () => {
    const box = $('#pltLots', main); if (!box) return;
    box.innerHTML = lots.length ? `<div class="table-wrap"><table class="grid keep-table plt-lots"><thead><tr><th>품목</th><th>LOT</th><th class="r">잔량</th><th>위치</th><th>처음 입고</th><th class="r">담을 수량</th></tr></thead><tbody>${lots.map((l, i) => `<tr><td><b>${esc(l.item)}</b></td><td><span class="lot-tag">${esc(l.lot)}</span></td><td class="r">${fmtNum(l.balance)} ${esc(l.unit)}</td><td class="small">${esc(l.places || '')}</td><td class="small muted">${esc(l.first_date || '')}</td><td class="r nowrap"><input type="number" min="0" step="any" inputmode="decimal" data-plt-take="${i}" value="${esc(l.take || '')}" placeholder="0" style="width:7em" aria-label="${esc(l.lot)} 담을 수량"> <button type="button" class="btn small" data-plt-allqty="${i}">전량</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">잔량 있는 LOT가 없습니다. 다른 이름으로 찾아 보세요.</p>';
  };
  const chosen = () => lots.filter(l => Number(l.take) > 0);
  const syncNew = () => { const c = chosen(), units = [...new Set(c.map(l => l.unit))]; $('#pltPick', main).textContent = c.length ? `${c.length}개 LOT · ${c.map(l => `${l.lot} ${fmtNum(l.take)}`).join(' + ')} = ${fmtNum(c.reduce((t, l) => t + Number(l.take), 0))}${units.length === 1 ? ' ' + units[0] : ''}` : '담은 것 없음'; $('#pltMake', main).disabled = !c.length; };
  $('#pltFind', main)?.addEventListener('submit', async e => {
    e.preventDefault(); const q = e.target.elements.q.value.trim(); if (!q) return toast('품목이나 LOT를 넣으세요.', 'err');
    const keep = new Map(chosen().map(l => [l.item + '|' + l.lot, l]));
    const data = await api('GET', '/api/inventory/lots?' + new URLSearchParams({ asof: todayStr(), q, state: 'instock' })).catch(fail); if (!data) return;
    lots = [...keep.values(), ...data.rows.filter(r => r.lot !== '(LOT 미지정)' && r.balance > 0 && !keep.has(r.item + '|' + r.lot))].sort((a, b) => (a.item > b.item) - (a.item < b.item) || String(a.first_date).localeCompare(String(b.first_date)));
    drawLots(); syncNew();
  });
  main.addEventListener('input', e => { const t = e.target.closest('[data-plt-take]'); if (t) { lots[Number(t.dataset.pltTake)].take = t.value; syncNew(); } });
  main.addEventListener('change', e => { if (e.target.matches('[data-plt-all]')) $$('[data-plt-pick]', main).forEach(x => { x.checked = e.target.checked; }); if (e.target.matches('[data-plt-all], [data-plt-pick]')) syncPick(); });
  main.addEventListener('click', e => {
    const all = e.target.closest('[data-plt-allqty]'); if (all) { const l = lots[Number(all.dataset.pltAllqty)]; l.take = l.balance; drawLots(); syncNew(); return; }
    const o = e.target.closest('[data-plt-open]'); if (o) { palletWindow(o.dataset.pltOpen, load).catch(fail); return; }
    const one = e.target.closest('[data-plt-one]'); if (one) qrIssue([palletCard(rows[Number(one.dataset.pltOne)])], { title: 'QR코드 발행 · 파렛트', file: '파렛트' });
  });
  $('#pltQrAll', main).onclick = () => { const list = picked(); if (list.length) qrIssue(list.map(palletCard), { title: 'QR코드 발행 · 파렛트', file: '파렛트' }); };
  $('#pltMake', main)?.addEventListener('click', async e => {
    const c = chosen(); if (!c.length) return; const btn = e.currentTarget; btn.disabled = true;
    try {
      const p = await api('POST', '/api/pallets', { request_id: requestId, note: $('#pltNote', main).value, lines: c.map(l => ({ item: l.item, unit: l.unit, lot: l.lot, qty: Number(l.take) })) });
      requestId = crypto.randomUUID(); lots = []; drawLots(); $('#pltNote', main).value = ''; syncNew();
      toast(`${p.pallet_no} 파렛트를 만들었습니다 · ${palletText(p)}`); await load(); qrIssue([palletCard(p)], { title: 'QR코드 발행 · 파렛트', file: '파렛트' });
    } catch (error) { fail(error); } finally { syncNew(); }
  });
  filters.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  filters.elements.status.onchange = () => load().catch(fail);
  await load();
}

// ── 15.231 LOT·QR 관리 › LOT 관리: 모든 LOT(입고·생산)를 한 표로 — 잔량·위치·파렛트에 묶인 수량, QR 발행·창고 이동·파렛트 바로가기 ──
async function pageLots(main) {
  main.innerHTML = `<h1>LOT 관리 <span class="dept">물류</span></h1>
  <p class="muted">입고(발주·기타)·생산완료로 생긴 LOT마다 들어온 수량, 나간 수량(출하·생산 투입·반출), 잔량, 위치, 파렛트에 묶인 수량을 봅니다. 줄의 「QR」로 라벨을 다시 뽑고, 「이동」으로 창고·위치를 옮깁니다. 여러 LOT를 체크해 한 번에 QR을 발행할 수 있습니다.</p>
  <form class="list-filters toolbar" data-read-only id="lotForm"><label>처음 입고<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label class="list-search">검색<input type="search" name="q" maxlength="200" placeholder="품목·LOT"></label><label class="lf-sel">상태<select name="state"><option value="instock">잔량 있음</option><option value="">전체</option><option value="empty">다 씀</option></select></label><button class="btn primary">조회</button></form>
  <div class="result-bar"><div class="counts" id="lotSum"></div><span class="result-tools"><button type="button" class="btn" id="lotCsv">CSV 저장</button><button type="button" class="btn qr-pdf-btn" id="lotQr" disabled>QR코드 발행</button></span></div>
  <div id="lotList"><p class="muted">불러오는 중…</p></div>`;
  const form = $('#lotForm', main); let rows = [];
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  const picked = () => $$('[data-lot-pick]:checked', main).map(x => rows[Number(x.dataset.lotPick)]);
  const sync = () => { const n = picked().length, b = $('#lotQr', main); b.disabled = !n; b.textContent = n ? `QR코드 발행 (${n})` : 'QR코드 발행'; };
  const load = async () => {
    const v = formObj(form);
    const [data, plts] = await Promise.all([api('GET', '/api/inventory/lots?' + new URLSearchParams({ asof: todayStr(), q: v.q || '', qc: '1', ...(v.state === 'instock' ? { state: 'instock' } : {}) })), api('GET', '/api/pallets?status=open').catch(() => ({ rows: [] }))]);
    if (!main.isConnected) return;
    const inPlt = new Map(); for (const p of plts.rows) for (const l of p.lines) { const k = l.item + '\u0001' + l.lot, x = inPlt.get(k) || { qty: 0, nos: [] }; x.qty += l.qty; x.nos.push(p.pallet_no); inPlt.set(k, x); }
    rows = data.rows.filter(r => (!v.from || r.first_date >= v.from) && (!v.to || r.first_date <= v.to) && (v.state !== 'empty' || r.balance <= 0)).map(r => ({ ...r, plt: inPlt.get(r.item + '\u0001' + r.lot) || null }));
    $('#lotSum', main).innerHTML = `LOT ${fmtNum(rows.length)}개${data.more ? ' · <span class="chip yellow">앞부분만 · 검색으로 좁히세요</span>' : ''}${rows.some(r => r.plt) ? ` · 파렛트에 묶인 LOT ${rows.filter(r => r.plt).length}` : ''}`;
    $('#lotList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid lot-grid"><thead><tr><th class="pick-cell"><input type="checkbox" data-lot-all aria-label="모두 고르기"></th><th>LOT</th><th>품목</th><th class="r">입고·생산</th><th class="r">출고·투입</th><th class="r">잔량</th><th>품질</th><th class="r">파렛트</th><th>위치</th><th>처음 입고</th><th>마지막</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.balance < 0 ? 'row-red' : r.balance === 0 ? 'row-off' : ''}${r.qc === 'concession' ? ' lot-tk-row' : ''}"><td class="pick-cell"><input type="checkbox" data-lot-pick="${i}" aria-label="${esc(r.lot)} 고르기"></td><td class="nowrap"><span class="lot-tag">${esc(r.lot)}</span></td><td data-card-primary><b>${esc(r.item)}</b></td><td class="r">${fmtNum(r.received)}</td><td class="r">${fmtNum(r.shipped)}</td><td class="r"><b>${fmtNum(r.balance)}</b> ${esc(r.unit || '')}</td><td class="nowrap">${lotQcChip(r)}</td><td class="r small">${r.plt ? `<a href="#/logistics/pallets" title="${esc(r.plt.nos.join(', '))}">${fmtNum(r.plt.qty)}</a>` : '<span class="muted">—</span>'}</td><td class="small">${esc(r.places || '')}</td><td class="small muted">${esc(r.first_date || '')}</td><td class="small muted">${esc(r.last_date || '')}</td><td class="nowrap"><button type="button" class="btn small" data-lot-hist="${i}" title="이 LOT의 입고·출고 내역">내역</button> <button type="button" class="btn small" data-lot-qr="${i}">QR</button>${r.balance > 0 && r.lot !== '(LOT 미지정)' ? ` <button type="button" class="btn small" data-lot-mv="${i}">이동</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 LOT가 없습니다.</div>';
    sync();
  };
  const card = r => ({ code: r.lot, sub: [r.item, `잔량 ${fmtNum(r.balance)} ${r.unit || ''}`.trim(), r.places || '', r.first_date].filter(Boolean).join(' · ') });
  main.addEventListener('change', e => { if (e.target.matches('[data-lot-all]')) $$('[data-lot-pick]', main).forEach(x => { x.checked = e.target.checked; }); if (e.target.matches('[data-lot-all], [data-lot-pick]')) sync(); });
  main.addEventListener('click', e => {
    const q = e.target.closest('[data-lot-qr]'); if (q) { qrIssue([card(rows[Number(q.dataset.lotQr)])], { file: 'LOT' }); return; }
    const mv = e.target.closest('[data-lot-mv]'); if (mv) lotMoveWindow(rows[Number(mv.dataset.lotMv)], load).catch(fail);
    const hi = e.target.closest('[data-lot-hist]'); if (hi) lotHistoryWindow(rows[Number(hi.dataset.lotHist)], load).catch(fail); // 15.256
  });
  $('#lotQr', main).onclick = () => { const l = picked(); if (l.length) qrIssue(l.map(card), { file: 'LOT' }); };
  $('#lotCsv', main).onclick = () => { if (typeof xlsxDownload === 'function') xlsxDownload(`LOT관리_${todayStr()}.xlsx`, { sheet: 'LOT', columns: [['lot', 'LOT'], ['item', '품목'], ['received', '입고·생산'], ['shipped', '출고·투입'], ['balance', '잔량'], ['unit', '단위'], ['pallet', '파렛트'], ['places', '위치'], ['first_date', '처음 입고'], ['last_date', '마지막']], rows: rows.map(r => ({ ...r, pallet: r.plt ? r.plt.qty : '' })) }); };
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  form.elements.state.onchange = () => load().catch(fail);
  await load();
}

// 15.256 품질 상태 칩: 수입검사 불합격 / 특채
function lotQcChip(r) {
  if (r.qc === 'fail') return `<span class="chip red" title="수입검사 불합격 ${esc(r.qc_req || '')}">불합격</span>`;
  if (r.qc === 'concession') return LOT_TK.replace('title="', `title="특채: ${esc(r.concession?.reason || '')} · ${esc(r.concession?.by || '')} — `);
  return '';
}
// 15.256 LOT 내역(입고·생산 / 출고·투입 / 반입·반출 / 이동) + 품질책임자 특채 처리·취소
async function lotHistoryWindow(r, onChange) {
  const h = await api('GET', '/api/inventory/lot-history?' + new URLSearchParams({ item: r.item, lot: r.lot }));
  const qa = hasRole('quality_approver'), qc = h.qc, KIND = { in: '입고', out: '출고', move: '이동' };
  const qcBox = !qc ? '' : qc.qc === 'fail'
    ? `<div class="notice red-box"><b>수입검사 불합격</b> ${esc(qc.req_no || '')} — 투입·출고가 막혀 있습니다.${qa ? ' <button type="button" class="btn small primary" data-lc-make>특채 처리</button>' : ' 특채는 품질책임자가 처리합니다.'}</div>`
    : `<div class="notice">${LOT_TK} ${esc(qc.concession.reason)} <span class="small muted">· ${esc(qc.concession.created_by)} ${esc(qc.concession.created_at)} · 검사 ${esc(qc.req_no || '')}</span> — 투입·출고 가능합니다.${qa ? ` <button type="button" class="btn small danger" data-lc-void="${qc.concession.id}">특채 취소</button>` : ''}</div>`;
  const body = `<div class="lh-head"><span class="lot-tag">${esc(r.lot)}</span> <b>${esc(r.item)}</b> <span class="small muted">잔량 ${fmtNum(r.balance)} ${esc(r.unit || '')}</span></div>${qcBox}
    ${h.rows.length ? `<div class="table-wrap"><table class="grid" data-lot-hist-table><thead><tr><th>일자</th><th>구분</th><th>내용</th><th>문서</th><th>거래처·라인</th><th class="r">입고</th><th class="r">출고</th><th class="r">잔량</th><th>위치·비고</th></tr></thead><tbody>${h.rows.map(x => `<tr><td class="nowrap">${esc(x.d || '')}</td><td><span class="chip ${x.kind === 'in' ? 'green' : x.kind === 'out' ? 'red' : ''}">${KIND[x.kind] || ''}</span></td><td>${esc(x.src)}</td><td class="small">${esc(x.doc || '')}</td><td>${esc(x.party || '')}</td><td class="r">${x.kind === 'in' ? fmtNum(x.qty) : ''}</td><td class="r">${x.kind === 'out' ? fmtNum(x.qty) : ''}</td><td class="r"><b>${x.kind === 'move' ? '' : fmtNum(x.balance)}</b></td><td class="small">${esc([x.place, x.note].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">내역이 없습니다.</div>'}`;
  const m = modal(`<h3>LOT 내역 <span class="small muted">입고·출고·투입·반입반출·이동</span></h3>${body}`, { wide: true });
  m.el.addEventListener('click', async e => {
    if (e.target.closest('[data-lc-make]')) {
      const v = await promptBox(`특채 처리 · ${r.lot}`, `<p class="small muted">${esc(r.item)} LOT ${esc(r.lot)}은 수입검사 불합격입니다. 특채하면 생산 투입·상품 출고가 가능해집니다.</p><label>특채 사유 *<input name="reason" required maxlength="500" placeholder="예) 고객 승인, 용도 한정 사용"></label>`); if (!v) return;
      try { await api('POST', '/api/lots/concession', { item: r.item, lot: r.lot, reason: v.reason }); toast(`${r.lot} 특채 처리했습니다. 투입·출고가 가능합니다.`); m.close(); await onChange?.(); } catch (error) { fail(error); }
    }
    const vd = e.target.closest('[data-lc-void]'); if (vd) {
      const v = await promptBox(`특채 취소 · ${r.lot}`, `<p class="small muted">취소하면 다시 투입·출고가 막힙니다(이미 쓴 기록은 그대로).</p><label>취소 사유 *<input name="reason" required maxlength="500"></label>`); if (!v) return;
      try { await api('POST', `/api/lots/concession/${vd.dataset.lcVoid}/void`, { reason: v.reason }); toast('특채를 취소했습니다.'); m.close(); await onChange?.(); } catch (error) { fail(error); }
    }
  });
}
// 15.259 창고·구역 설정(물류팀장·관리자): 창고 이름·구역(쉼표·줄바꿈)·순서, 추가·저장·삭제
async function stockWarehouseEditor(onClose) {
  let list = await api('GET', '/api/warehouses?all=1');
  const m = modal(`<h3>창고·구역 설정</h3><p class="small muted">재고 현황 「창고별」에 나오는 창고와 그 아래 구역(Location)입니다. 구역은 쉼표나 줄바꿈으로 나눠 적습니다. 입고·이동 기록이 있는 창고는 지울 수 없고 「사용」을 끄면 입력 화면에서만 빠집니다.</p><div data-wh-box></div><div class="actions"><button type="button" class="btn" data-wh-add>＋ 창고 추가</button><button type="button" class="btn primary" data-wh-done>닫기</button></div>`, { wide: true, onClose: () => onClose?.() });
  const box = $('[data-wh-box]', m.el);
  const draw = () => { box.innerHTML = `<div class="table-wrap"><table class="grid" data-no-sort data-keep-cols><thead><tr><th>순서</th><th>창고 이름</th><th>구역(Location)</th><th>사용</th><th></th></tr></thead><tbody>${list.map((w, i) => `<tr data-wh="${i}"><td><input type="number" name="sort" value="${esc(w.sort ?? 0)}" step="1" style="width:4.5em" aria-label="순서"></td><td><input name="name" value="${esc(w.name || '')}" maxlength="50" required aria-label="창고 이름" placeholder="예) 1동창고"></td><td><textarea name="locations" rows="2" maxlength="5000" aria-label="구역" placeholder="예) A구역, B구역">${esc(String(w.locations || '').split(',').join(', '))}</textarea></td><td class="c"><input type="checkbox" name="active"${w.active === 0 ? '' : ' checked'} aria-label="사용"></td><td class="nowrap"><button type="button" class="btn small primary" data-wh-save="${i}">저장</button>${w.id ? ` <button type="button" class="btn small danger" data-wh-del="${i}">삭제</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">창고가 없습니다. 「창고 추가」로 넣으세요.</td></tr>'}</tbody></table></div>`; };
  const reload = async () => { list = await api('GET', '/api/warehouses?all=1'); draw(); };
  draw();
  $('[data-wh-done]', m.el).onclick = () => m.close();
  $('[data-wh-add]', m.el).onclick = () => { list.push({ name: '', locations: '', sort: list.length ? Math.max(...list.map(w => Number(w.sort) || 0)) + 1 : 0, active: 1 }); draw(); $(`[data-wh="${list.length - 1}"] [name=name]`, box)?.focus(); };
  box.addEventListener('click', async e => {
    const sv = e.target.closest('[data-wh-save]'); if (sv) { const i = Number(sv.dataset.whSave), tr = sv.closest('tr'), w = list[i];
      const body = { name: tr.querySelector('[name=name]').value.trim(), locations: tr.querySelector('[name=locations]').value.split(/[,\n]/).map(x => x.trim()).filter(Boolean).join(','), sort: Number(tr.querySelector('[name=sort]').value) || 0, active: tr.querySelector('[name=active]').checked };
      if (!body.name) { tr.querySelector('[name=name]').focus(); return toast('창고 이름을 넣으세요.', 'err'); }
      sv.disabled = true; try { await api(w.id ? 'PUT' : 'POST', w.id ? `/api/warehouses/${w.id}` : '/api/warehouses', body); toast(`${body.name} 저장했습니다.`); if (typeof rcLoadWarehouses === 'function') rcLoadWarehouses(true).catch(() => {}); await reload(); } catch (error) { sv.disabled = false; fail(error); } return; }
    const dl = e.target.closest('[data-wh-del]'); if (dl) { const w = list[Number(dl.dataset.whDel)]; if (!await confirmBox(`${w.name} 창고를 지울까요?`)) return;
      try { await api('DELETE', `/api/warehouses/${w.id}`); toast('지웠습니다.'); await reload(); } catch (error) { fail(error); } }
  });
}
