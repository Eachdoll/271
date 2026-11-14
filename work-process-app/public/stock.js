// 물류 → 재고 현황. 재고는 저장하지 않고 입고·생산실적·생산 투입·출하·재고 조정에서 계산합니다.
const STOCK_SOURCE = { po: '발주입고', other: '기타입고', prod: '생산', use: '생산 투입', ship: '출하', adjust: '재고 조정' };
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
  <p class="muted">입고(발주·기타) + 생산실적 − 생산 투입(BOM 기준) − 출하 ± 재고 조정으로 계산한 수량입니다. 품목명과 단위가 같은 기록끼리 합산하므로, <b>같은 품목은 같은 이름·단위</b>로 입력하세요. 시스템 도입 전부터 있던 재고는 <b>기초재고</b>로 한 번 입력합니다.</p>
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
    <span id="stockAdjustSlot"></span>
  </form>
  <div id="stockSummary" class="counts"></div>
  <div id="stockList"></div>`;
  const form = $('#stockFilters', main); let version = 0, current = { rows: [], group: 'item' };
  api('GET', '/api/boms/categories').then(cats => {
    const options = list => '<option value="">전체</option>' + [...new Set(list.filter(Boolean))].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    const second = () => { const keep = form.cat2.value; $('#stockCat2').innerHTML = options(cats.filter(c => !form.cat1.value || c.cat1 === form.cat1.value).map(c => c.cat2)); form.cat2.value = [...form.cat2.options].some(o => o.value === keep) ? keep : ''; };
    $('#stockCat1').innerHTML = options(cats.map(c => c.cat1)); second(); form.cat1.onchange = second;
  }).catch(() => {});
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
    $('#stockAdjustSlot').innerHTML = result.can_adjust ? '<button type="button" class="btn" id="stockAdjust">＋ 기초재고·실사·조정</button>' : '';
    if (result.can_adjust) $('#stockAdjust').onclick = () => adjust();
    $('#stockSummary').innerHTML = `${rows.length}개 품목 · 기준일 ${esc(result.asof)}${rows.some(r => r.low) ? ` · <span class="chip yellow">안전재고 미달 ${rows.filter(r => r.low).length}</span>` : ''}${rows.some(r => r.negative) ? ` · <span class="chip red">재고 음수 ${rows.filter(r => r.negative).length}</span> <span class="small muted">입고·기초재고 누락 또는 품목명·단위 불일치를 확인하세요.</span>` : ''}${bySpec ? ' · <span class="small muted">BOM 자재에는 규격이 없어 생산 투입은 규격 없는 줄에 표시됩니다.</span>' : ''}`;
    $('#stockList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th>코드</th>${bySpec ? '<th>규격</th>' : ''}<th>분류</th><th class="r">입고</th><th class="r">생산</th><th class="r">생산 투입</th><th class="r">출하</th><th class="r">조정</th><th class="r">현재고</th>${bySpec ? '' : '<th class="r">안전재고</th>'}<th>최근 변동</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.negative ? 'row-red' : r.low ? 'row-yellow' : ''}">
        <td><b>${esc(r.item)}</b></td><td class="small">${esc(r.product_code) || '<span class="muted">미등록</span>'}</td>${bySpec ? `<td>${esc(r.spec || '(규격 없음)')}</td>` : ''}<td>${esc(r.category || '미분류')}${r.cat1 ? `<div class="small muted">${esc([r.cat1, r.cat2, r.cat3].filter(Boolean).join(' › '))}</div>` : ''}</td>
        <td class="r">${fmtNum(r.received)}</td><td class="r">${fmtNum(r.produced)}</td><td class="r">${fmtNum(r.used)}</td><td class="r">${fmtNum(r.shipped)}</td><td class="r">${r.adjusted ? (r.adjusted > 0 ? '+' : '') + fmtNum(r.adjusted) : '0'}</td>
        <td class="r"><b class="${r.negative ? 'red-text' : ''}">${fmtNum(r.stock)}</b> ${esc(r.unit || '단위 미지정')}${r.low ? ' <span class="chip yellow">미달</span>' : ''}</td>
        ${bySpec ? '' : `<td class="r">${r.min_qty == null ? '<span class="muted">—</span>' : fmtNum(r.min_qty)}</td>`}
        <td class="small muted">${esc(r.last_date === '0000-00-00' ? '' : r.last_date)}</td>
        <td class="nowrap"><button class="btn small" data-stock-moves="${i}">내역</button>${result.can_adjust ? `${bySpec ? '' : ` <button class="btn small" data-stock-min="${i}">안전재고</button>`} <button class="btn small" data-stock-count="${i}">실사</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">해당하는 재고가 없습니다. 입고·생산실적·출하를 등록하거나 기초재고를 입력하면 여기에 나타납니다.</div>';
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
