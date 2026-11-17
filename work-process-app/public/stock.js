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
  <p class="muted">입고(발주·기타) + 생산실적·반제품 커팅/융착 − 생산 투입(BOM 기준) − 출하 ± 재고 조정으로 계산한 수량입니다. 품목명과 단위가 같은 기록끼리 합산하므로, <b>같은 품목은 같은 이름·단위</b>로 입력하세요. 시스템 도입 전부터 있던 재고는 <b>기초재고</b>로 한 번 입력합니다.</p>
  <form id="stockFilters" class="toolbar list-filters" data-read-only="true">
    <label>기준일<input type="date" name="asof" value="${todayStr()}" max="${todayStr()}" required></label>
    <label class="list-search">품목 검색<input type="search" name="q" maxlength="200" placeholder="품목명·규격"></label>
    <label>분류<select name="item_category">${categoryOptions('', true)}</select></label>
    <label>1차 분류<select name="cat1" id="stockCat1"><option value="">전체</option></select></label>
    <label>2차 분류<select name="cat2" id="stockCat2"><option value="">전체</option></select></label>
    <label>재고 상태<select name="state"><option value="">전체</option><option value="instock">재고 있음</option><option value="low">안전재고 미달</option><option value="negative">재고 음수 (기록 확인 필요)</option></select></label>
    <label>보기<select name="group"><option value="item">품목 합계</option><option value="spec">규격·사이즈별</option></select></label>
    <button type="submit" class="btn primary">조회</button>
    <button type="button" class="btn" id="stockCsv">CSV 저장</button>
    <button type="button" class="btn" id="stockLots" title="LOT가 적힌 입고 − 같은 LOT 출하">LOT별 재고</button>
    <span id="stockAdjustSlot"></span>
  </form>
  <div id="stockSummary" class="counts"></div>
  <div id="stockList"></div>`;
  const form = $('#stockFilters', main); let version = 0, current = { rows: [], group: 'item' };
  $('#stockLots', main).onclick = () => stockLotWindow(form.elements.asof.value || todayStr(), form.elements.q.value);
  await api('GET', '/api/boms/categories').then(cats => {
    const options = list => '<option value="">전체</option>' + [...new Set(list.filter(Boolean))].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    const second = () => { const keep = form.cat2.value; $('#stockCat2').innerHTML = options(cats.filter(c => !form.cat1.value || c.cat1 === form.cat1.value).map(c => c.cat2)); form.cat2.value = [...form.cat2.options].some(o => o.value === keep) ? keep : ''; };
    $('#stockCat1').innerHTML = options(cats.map(c => c.cat1)); second(); rememberList(form); second(); const state = uxRead(uxKey('filters', (location.hash || '#/') + ':' + form.id)); if (state) uxFormRestore(form, state); form.cat1.onchange = second;
  }).catch(() => {});
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
  const load = async () => {
    if (!main.isConnected) return; const mine = ++version;
    const result = await api('GET', '/api/inventory?' + new URLSearchParams(formObj(form)));
    if (mine !== version || !main.isConnected) return;
    current = result; const rows = result.rows; const bySpec = result.group === 'spec';
    const lowRows = result.group === 'item' ? rows.filter(r => r.low) : [];
    $('#stockAdjustSlot').innerHTML = (result.can_adjust ? '<button type="button" class="btn" id="stockAdjust">＋ 기초재고·실사·조정</button>' : '')
      + (lowRows.length && (ME.is_admin || ME.roles.includes('purchase')) ? ` <button type="button" class="btn" id="stockReorder" title="안전재고 미달 품목을 매입처별 발주로">부족분 발주 <span class="sub-count">${lowRows.length}</span></button>` : '');
    if ($('#stockReorder')) $('#stockReorder').onclick = () => stockReorder(lowRows).catch(fail);
    if (result.can_adjust) $('#stockAdjust').onclick = () => adjust();
    $('#stockSummary').innerHTML = `${rows.length}개 품목 · 기준일 ${esc(result.asof)}${rows.some(r => r.low) ? ` · <span class="chip yellow">안전재고 미달 ${rows.filter(r => r.low).length}</span>` : ''}${rows.some(r => r.negative) ? ` · <span class="chip red">재고 음수 ${rows.filter(r => r.negative).length}</span> <span class="small muted">입고·기초재고 누락 또는 품목명·단위 불일치를 확인하세요.</span>` : ''}${bySpec ? ' · <span class="small muted">BOM 자재에는 규격이 없어 생산 투입은 규격 없는 줄에 표시됩니다.</span>' : ''}`;
    $('#stockList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th>코드</th>${bySpec ? '<th>규격</th>' : ''}<th>분류</th><th class="r">입고</th><th class="r">생산</th><th class="r">생산 투입</th><th class="r">출하</th><th class="r">조정</th><th class="r">현재고</th>${bySpec ? '' : '<th class="r">안전재고</th>'}<th>최근 변동</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.negative ? 'row-red' : r.low ? 'row-yellow' : ''}">
        <td><b>${esc(r.item)}</b></td><td class="small">${esc(r.product_code) || '<span class="muted">미등록</span>'}</td>${bySpec ? `<td>${esc(r.spec || '(규격 없음)')}</td>` : ''}<td>${esc(r.category || '미분류')}${r.cat1 ? `<div class="small muted">${esc([r.cat1, r.cat2, r.cat3].filter(Boolean).join(' › '))}</div>` : ''}</td>
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
        tr.insertAdjacentHTML('afterend', `<tr class="stock-lot-row"><td colspan="${tr.children.length}"><div class="stock-lots">${lots.length ? `<table class="erp-grid" data-keep-cols data-no-sort><thead><tr><th>LOT</th><th class="r">입고·생산</th><th class="r">사용·출하</th><th class="r">남은 수량</th><th>위치</th><th>처음 입고</th><th>마지막</th></tr></thead><tbody>${lots.map(l => `<tr><td><span class="lot-tag">${esc(l.lot)}</span></td><td class="r">${fmtNum(l.received)}</td><td class="r">${fmtNum(l.shipped)}</td><td class="r"><b>${fmtNum(l.balance)}</b> <span class="small muted">${esc(l.unit || '')}</span></td><td class="small">${esc(l.places || '')}</td><td class="small">${esc(l.first_date || '')}</td><td class="small">${esc(l.last_date || '')}</td></tr>`).join('')}</tbody><tfoot><tr><th>LOT 합계</th><td></td><td></td><td class="r"><b>${fmtNum(Math.round(sum * 1000) / 1000)}</b></td><td colspan="3" class="small muted">${Math.abs(sum - r.stock) > 0.001 ? `현재고 ${fmtNum(r.stock)}와 차이 ${fmtNum(Math.round((r.stock - sum) * 1000) / 1000)} — LOT 없이 들어오거나 나간 수량(BOM 투입·LOT 없는 출하 등)` : '현재고와 같음'}</td></tr></tfoot></table>` : '<p class="small muted">이 품목은 LOT 남은 재고가 없습니다(LOT 없이 받았거나 다 썼음).</p>'}</div></td></tr>`);
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
  return { lot: parts[0], code: parts.length > 1 ? parts[1] : '', receipt: parts[3] || '', raw };
}
async function pageScan(main) {
  main.innerHTML = `<h1>QR 스캔 <span class="dept">물류</span></h1>
  <p class="muted">LOT 라벨의 QR을 찍거나(휴대폰 카메라) USB 스캐너로 읽으면 그 LOT의 잔량·위치가 나오고, 바로 출하 기록이나 창고 이동을 합니다. LOT 번호를 직접 넣어도 됩니다.</p>
  <form class="toolbar" id="scanForm" data-read-only><label class="grow">LOT · QR 내용<input name="code" autocomplete="off" autofocus placeholder="스캐너로 읽거나 LOT 입력 후 Enter"></label><button class="btn primary">찾기</button><button type="button" class="btn" id="scanCam">카메라로 스캔</button></form>
  <div id="scanCamBox" hidden><video id="scanVideo" playsinline muted style="width:100%;max-width:480px;border:1px solid var(--line)"></video><div class="actions" style="justify-content:flex-start"><button type="button" class="btn" id="scanStop">카메라 끄기</button></div></div>
  <div id="scanResult"></div><h3>이번에 찍은 것</h3><div id="scanLog" class="small muted">아직 없습니다.</div>`;
  const form = $('#scanForm', main), input = form.elements.code, log = [];
  let stream = null, timer = null;
  const stop = () => { clearInterval(timer); timer = null; stream?.getTracks().forEach(t => t.stop()); stream = null; $('#scanCamBox', main).hidden = true; };
  const addLog = text => { log.unshift(`${new Date().toTimeString().slice(0, 8)} · ${text}`); $('#scanLog', main).innerHTML = log.slice(0, 20).map(x => `<div>${esc(x)}</div>`).join(''); };
  const show = async text => {
    const scan = parseLotScan(text); if (!scan) return;
    const box = $('#scanResult', main); box.innerHTML = '<p class="muted">찾는 중…</p>';
    const data = await api('GET', '/api/inventory/lots?' + new URLSearchParams({ asof: todayStr(), q: scan.lot }));
    let rows = data.rows.filter(r => r.lot === scan.lot);
    let boms = [];
    if (scan.code) { boms = (await api('GET', '/api/boms?' + new URLSearchParams({ q: scan.code }))).filter(b => String(b.product_code).toUpperCase() === scan.code.toUpperCase()); if (boms.length) rows = rows.filter(r => boms.some(b => b.product.replace(/\s+/g, '').toLowerCase() === r.item.replace(/\s+/g, '').toLowerCase())); }
    if (!main.isConnected) return;
    if (!rows.length) { box.innerHTML = `<div class="empty">LOT ${esc(scan.lot)}를 찾지 못했습니다.${scan.code ? ` (코드 ${esc(scan.code)})` : ''}</div>`; addLog(`${scan.lot} — 없음`); return; }
    box.innerHTML = rows.map((r, i) => `<div class="card" data-scan-row="${i}"><h3>${esc(r.item)} <span class="tag">LOT ${esc(r.lot)}</span></h3>
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
          await api('POST', '/api/shipments', { ship_date: v.ship_date, item: r.item, ...(bom ? { bom_id: bom.id } : {}), qty: v.qty, unit: r.unit, customer: v.customer, lot: r.lot, note: 'QR 스캔 출하' });
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
