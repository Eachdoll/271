// 매입전표·매입 마감(15.80). 구매 담당이 공급사 거래명세서를 받으면 그 거래처의 「전표 없는 입고 줄」을 골라
// 단가를 확정해 매입전표를 만든다(원 미만 절사, 부가세는 공급가액 합계의 10%, 영세·면세 0). 달·거래처별로 마감한다.
const BILL_SOURCE_LABEL = { po_lot: '발주입고', po: '발주입고', other: '기타입고' };
const won = n => n == null || n === '' ? '' : fmtNum(Math.trunc(Number(n)));
const billTruncC = n => Math.trunc(Math.round(n * 1000) / 1000);

async function pageBillEntry(main) {
  main.innerHTML = `<h1>매입전표 입력</h1>
  <p class="muted">공급사 거래명세서를 받으면 거래처를 고르세요. 물류가 잡은 입고 중 아직 전표가 없는 줄이 나옵니다. 명세서에 있는 줄을 체크하고 단가를 확인한 뒤(발주 단가가 미리 들어감) 명세서 합계와 맞는지 보고 저장하세요. 금액은 원 미만 절사, 부가세는 공급가액 합계의 10%입니다.</p>
  <form class="stack bill-form" data-no-author novalidate>
    <div class="form-grid">
      <label>거래처 *<input name="vendor" required maxlength="100" placeholder="매입처에서 고르거나 입력" autocomplete="off"></label><span class="partner-hint small muted" data-partner-hint></span>
      <label>명세서 일자 *<input name="bill_date" type="date" required value="${todayStr()}"></label>
      <label>명세서 번호<input name="statement_no" maxlength="50" placeholder="공급사 거래명세서 번호"></label>
      <label>과세 구분<select name="tax_type"><option value="taxable">과세 (부가세 10%)</option><option value="zero">영세·면세 (부가세 0)</option></select></label>
      <label>운송비 <span class="hint">(원, 공급가액에 더함)</span><input name="freight" type="number" min="0" step="1" inputmode="numeric"></label>
      <label>명세서 합계 <span class="hint">(대조용, 부가세 포함)</span><input name="statement_total" type="number" min="0" step="1" inputmode="numeric"></label>
      <label>입고일 범위<span class="bill-range"><input name="from" type="date" aria-label="입고일 시작"> ~ <input name="to" type="date" aria-label="입고일 끝"></span></label>
      <label class="span2">비고<input name="note" maxlength="500"></label>
    </div>
    <section class="pr-section"><h3>전표 없는 입고 줄</h3><div data-bill-lines><p class="muted small">거래처를 넣으면 나옵니다.</p></div></section>
    <div class="bill-total card" data-bill-total aria-live="polite"></div>
    <div class="actions"><button class="btn primary" data-bill-save>매입전표 저장</button></div>
  </form>`;
  const form = $('form', main), box = $('[data-bill-lines]', form);
  let rows = [], loadedKey = null, requestId = crypto.randomUUID(), busy = false;
  const vendorInput = form.elements.vendor;
  const load = async (force = false) => {
    const vendor = vendorInput.value.trim(), key = [vendor, form.elements.from.value, form.elements.to.value].join('|');
    if (!force && key === loadedKey) return; loadedKey = key;
    if (!vendor) { rows = []; box.innerHTML = '<p class="muted small">거래처를 넣으면 나옵니다.</p>'; totals(); return; }
    box.innerHTML = '<p class="muted small">불러오는 중…</p>';
    let data; try { data = await api('GET', '/api/purchase-bills/unbilled?' + new URLSearchParams({ vendor, from: form.elements.from.value, to: form.elements.to.value })); } catch (error) { box.innerHTML = `<p class="field-error">${esc(error.message)}</p>`; return; }
    if (vendorInput.value.trim() !== vendor) return;
    rows = data.rows.map(r => ({ ...r, key: r.source_type + ':' + r.source_id, picked: false, price: r.unit_price ?? '', note: '' }));
    draw();
    if (data.more) toast('줄이 500개를 넘어 앞의 500줄만 보입니다. 입고일 범위로 좁히세요.', 'err');
  };
  const draw = () => {
    box.innerHTML = rows.length ? `<div class="table-wrap"><table class="grid bill-grid"><caption class="sr-only">전표 없는 입고 줄</caption><thead><tr><th scope="col"><input type="checkbox" data-bill-all aria-label="전체 선택"></th><th scope="col">입고일</th><th scope="col">구분</th><th scope="col">품목</th><th scope="col">규격</th><th scope="col">LOT</th><th scope="col" class="r">수량</th><th scope="col">단위</th><th scope="col" class="r">단가</th><th scope="col" class="r">공급가액</th><th scope="col">비고</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-bill-row="${i}" class="${r.picked ? 'bill-picked' : ''}">
        <td><input type="checkbox" data-bill-pick="${i}"${r.picked ? ' checked' : ''} aria-label="${esc(r.item)} ${esc(r.lot || '')} 선택"></td>
        <td class="nowrap">${esc(r.received_date)}</td>
        <td class="nowrap small">${BILL_SOURCE_LABEL[r.source_type]}${r.req_no ? `<div class="muted">${esc(r.req_no)}</div>` : ''}</td>
        <td data-card-primary><b>${esc(r.item)}</b>${r.product_code ? `<div class="small muted">${esc(r.product_code)}</div>` : ''}${internalNoteChip(r)}</td>
        <td>${esc(r.spec || '')}</td><td>${esc(r.lot || '')}</td>
        <td class="r">${fmtNum(r.qty)}</td><td>${esc(r.unit || '')}</td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-bill-price="${i}" value="${esc(r.price)}" aria-label="${esc(r.item)} 단가"${r.unit_price == null ? ' placeholder="단가 없음"' : ''}></td>
        <td class="r nowrap" data-bill-supply="${i}">${r.price === '' ? '' : won(billTruncC(r.qty * Number(r.price)))}</td>
        <td><input data-bill-note="${i}" maxlength="200" value="${esc(r.note)}" aria-label="${esc(r.item)} 비고"></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">이 거래처의 전표 없는 입고가 없습니다.</p>';
    const all = $('[data-bill-all]', box); if (all) all.onchange = () => { rows.forEach(r => { r.picked = all.checked; }); draw(); };
    const heads = $$('thead th', box).map(th => th.textContent.trim());
    $$('tbody tr', box).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = i === 0 ? '' : heads[i] || ''; }));
    totals();
  };
  box.addEventListener('change', e => {
    const i = Number(e.target.dataset.billPick ?? e.target.dataset.billPrice ?? e.target.dataset.billNote);
    if (e.target.dataset.billPick !== undefined) { rows[i].picked = e.target.checked; e.target.closest('tr').classList.toggle('bill-picked', rows[i].picked); }
    totals();
  });
  box.addEventListener('input', e => {
    if (e.target.dataset.billPrice !== undefined) { const i = Number(e.target.dataset.billPrice); rows[i].price = e.target.value; if (e.target.value !== '' && !rows[i].picked) { rows[i].picked = true; $(`[data-bill-pick="${i}"]`, box).checked = true; e.target.closest('tr').classList.add('bill-picked'); } $(`[data-bill-supply="${i}"]`, box).textContent = e.target.value === '' ? '' : won(billTruncC(rows[i].qty * Number(e.target.value))); }
    if (e.target.dataset.billNote !== undefined) rows[Number(e.target.dataset.billNote)].note = e.target.value;
    totals();
  });
  // 줄 아무 데나 눌러도 체크
  box.addEventListener('click', e => { const tr = e.target.closest('tr[data-bill-row]'); if (!tr || e.target.closest('input,button,a')) return; const i = Number(tr.dataset.billRow); rows[i].picked = !rows[i].picked; $(`[data-bill-pick="${i}"]`, box).checked = rows[i].picked; tr.classList.toggle('bill-picked', rows[i].picked); totals(); });
  const totals = () => {
    const picked = rows.filter(r => r.picked), missing = picked.filter(r => r.price === '');
    const freight = billTruncC(Number(form.elements.freight.value || 0));
    const supply = picked.reduce((t, r) => t + (r.price === '' ? 0 : billTruncC(r.qty * Number(r.price))), 0) + freight;
    const vat = form.elements.tax_type.value === 'zero' ? 0 : billTruncC(supply * 0.1), total = supply + vat;
    const statement = form.elements.statement_total.value === '' ? null : Number(form.elements.statement_total.value);
    const diff = statement === null ? null : statement - total;
    $('[data-bill-total]', form).innerHTML = `<div class="bill-sum"><span>선택 <b>${picked.length}</b>줄</span>
      ${freight ? `<span>운송비 <b>${won(freight)}</b>원</span>` : ''}
      <span>공급가액 <b>${won(supply)}</b>원</span><span>부가세 <b>${won(vat)}</b>원</span><span class="bill-grand">합계 <b>${won(total)}</b>원</span>
      ${diff === null ? '' : diff === 0 ? '<span class="chip green">명세서 합계와 일치</span>' : `<span class="chip red">명세서와 차이 ${diff > 0 ? '+' : ''}${won(diff)}원</span>`}
      ${missing.length ? `<span class="chip yellow">단가 없는 줄 ${missing.length}</span>` : ''}</div>`;
  };
  form.elements.tax_type.onchange = totals; form.elements.statement_total.oninput = totals; form.elements.freight.oninput = totals;
  let timer = 0;
  vendorInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 400); });
  vendorInput.addEventListener('change', () => { clearTimeout(timer); load().catch(fail); });
  form.elements.from.onchange = form.elements.to.onchange = () => load().catch(fail);
  bindPartnerPicker(vendorInput, $('[data-partner-hint]', form), { type: 'purchase' }).catch(() => {});
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const v = formObj(form), picked = rows.filter(r => r.picked);
    if (!v.vendor) { vendorInput.focus(); return toast('거래처를 넣으세요.', 'err'); }
    if (!picked.length) return toast('전표에 넣을 입고 줄을 체크하세요.', 'err');
    const missing = picked.find(r => r.price === ''); if (missing) { $(`[data-bill-price="${rows.indexOf(missing)}"]`, box)?.focus(); return toast(`${missing.item}의 단가를 넣으세요.`, 'err'); }
    busy = true; const button = $('[data-bill-save]', form); button.disabled = true;
    try {
      const bill = await api('POST', '/api/purchase-bills', { vendor: v.vendor, bill_date: v.bill_date, statement_no: v.statement_no, tax_type: v.tax_type, statement_total: v.statement_total, freight: v.freight, note: v.note, request_id: requestId,
        lines: picked.map(r => ({ source_type: r.source_type, source_id: r.source_id, unit_price: r.price, note: r.note })) });
      toast(bill.duplicate ? `${bill.bill_no} 전표는 앞서 이미 저장되었습니다.` : `${bill.bill_no} 매입전표를 저장했습니다. 합계 ${won(bill.total)}원`);
      requestId = crypto.randomUUID(); form.elements.statement_no.value = ''; form.elements.statement_total.value = ''; form.elements.note.value = ''; form.elements.freight.value = '';
      await load(true); billSheet(bill);
    } catch (error) { fail(error); } finally { busy = false; button.disabled = false; }
  };
  let preset = null; try { preset = sessionStorage.getItem('wpa:bill-vendor'); sessionStorage.removeItem('wpa:bill-vendor'); } catch { preset = null; }
  totals();
  if (preset) { vendorInput.value = preset; await load(true); }
}

// 매입전표 보기·인쇄(사내용). 취소·입고 취소된 줄 표시.
function billSheet(bill, after = null) {
  const m = modal(`<h3 class="po-print-title">매입전표 <span class="small muted">${esc(bill.bill_no)}${bill.status === 'cancelled' ? ' · 취소됨' : ''}${bill.closed ? ' · 마감' : ''}</span></h3>
    <section class="cert po-doc bill-doc">
      <div class="po-doc-head"><img src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><h2>매 입 전 표</h2></div>
      <table class="po-info"><tbody>
        <tr><th>전표번호</th><td>${esc(bill.bill_no)}${bill.status === 'cancelled' ? ' (취소)' : ''}</td><th>명세서 일자</th><td>${esc(bill.bill_date)}</td></tr>
        <tr><th>거래처</th><td><b>${esc(bill.vendor)}</b></td><th>명세서 번호</th><td>${esc(bill.statement_no || '—')}</td></tr>
        <tr><th>과세 구분</th><td>${bill.tax_type === 'zero' ? '영세·면세' : '과세 10%'}</td><th>작성</th><td>${esc(bill.created_by)} · ${esc(String(bill.created_at).slice(0, 16))}</td></tr>
      </tbody></table>
      <table class="po-items"><thead><tr><th>No</th><th>입고일</th><th>품목</th><th>규격</th><th>LOT</th><th class="r">수량</th><th>단위</th><th class="r">단가</th><th class="r">공급가액</th><th>비고</th></tr></thead>
      <tbody>${bill.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(l.received_date)}</td><td>${esc(l.item)}${l.product_code ? `<div class="po-code">${esc(l.product_code)}</div>` : ''}${l.req_no ? `<div class="po-code">${esc(l.req_no)}</div>` : ''}</td><td>${esc(l.spec)}</td><td>${esc(l.lot)}</td><td class="r">${fmtNum(l.qty)}</td><td>${esc(l.unit)}</td><td class="r">${fmtNum(l.unit_price)}</td><td class="r">${won(l.supply)}</td><td>${esc(l.note)}${l.source_voided ? ' <b>(입고 취소됨)</b>' : ''}</td></tr>`).join('')}</tbody>
      <tfoot>${bill.freight ? `<tr><th colspan="8" class="r">운송비</th><td class="r">${won(bill.freight)}</td><td></td></tr>` : ''}
        <tr><th colspan="8" class="r">공급가액</th><td class="r">${won(bill.supply_total)}</td><td></td></tr>
        <tr><th colspan="8" class="r">부가세</th><td class="r">${won(bill.vat_total)}</td><td></td></tr>
        <tr><th colspan="8" class="r">합계</th><td class="r"><b>${won(bill.total)}</b></td><td>${bill.statement_total == null ? '' : bill.statement_total === bill.total ? '명세서 일치' : `명세서 ${won(bill.statement_total)} (차이 ${won(bill.statement_total - bill.total)})`}</td></tr></tfoot></table>
      ${bill.note ? `<div class="po-memo"><b>비고</b><div class="po-memo-body">${esc(bill.note)}</div></div>` : ''}
      ${bill.status === 'cancelled' ? `<p><b>취소</b> ${esc(bill.cancelled_by || '')} · ${esc(String(bill.cancelled_at || '').slice(0, 16))} · ${esc(bill.cancel_reason)}</p>` : ''}
    </section>
    <div class="actions"><button class="btn" data-close>닫기</button>${bill.status === 'confirmed' && !bill.closed ? '<button class="btn danger" data-bill-cancel>전표 취소</button>' : ''}<button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`매입전표_${bill.bill_no}`);
  const cancel = $('[data-bill-cancel]', m.el);
  if (cancel) cancel.onclick = async () => {
    const v = await promptBox('매입전표 취소', `<p class="small muted">${esc(bill.bill_no)}을(를) 취소하면 그 입고 줄은 다시 「전표 없는 입고」로 돌아갑니다.</p><label>취소 사유 *<input name="reason" required maxlength="200"></label>`);
    if (!v) return;
    try { const r = await api('POST', `/api/purchase-bills/${bill.id}/cancel`, v); toast('전표를 취소했습니다.'); m.close(); billSheet(r, after); await after?.(); } catch (error) { fail(error); }
  };
}

async function pageBillList(main) {
  main.innerHTML = `<h1>매입전표 목록</h1>
  <form class="list-filters toolbar" data-read-only id="billFilters"><label>명세서 일자<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label>거래처<input name="vendor" maxlength="100"></label><label>상태<select name="status"><option value="">전체</option><option value="confirmed">확정</option><option value="cancelled">취소</option></select></label><label class="grow">검색<input type="search" name="q" placeholder="전표번호·거래처·명세서 번호·비고·입력자"></label><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀 (줄별)</button></form>
  <div id="billSummary" class="counts"></div><div id="billList"></div><div class="actions"><button type="button" class="btn" id="billMore" hidden>더 보기</button></div>`;
  const form = $('#billFilters', main); let rows = [], page = 0;
  const load = async (next = false) => {
    const data = await api('GET', '/api/purchase-bills?' + new URLSearchParams({ ...formObj(form), page: next ? page + 1 : 0 }));
    if (!main.isConnected) return;
    rows = next ? rows.concat(data.rows) : data.rows; page = data.page; $('#billMore', main).hidden = !data.more;
    const live = rows.filter(r => r.status === 'confirmed');
    $('#billSummary', main).innerHTML = `<b>${esc(`${rows.length}건 · 확정 합계 ${won(live.reduce((t, r) => t + r.total, 0))}원 (공급가액 ${won(live.reduce((t, r) => t + r.supply_total, 0))} · 부가세 ${won(live.reduce((t, r) => t + r.vat_total, 0))})`)}</b>${data.more ? ' <span>(더 있음)</span>' : ''}`;
    $('#billList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>전표번호</th><th>명세서 일자</th><th>거래처</th><th>명세서 번호</th><th class="r">줄</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th>상태</th><th>입력</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.status === 'cancelled' ? 'row-off' : ''}"><td data-card-primary><b>${esc(r.bill_no)}</b></td><td>${esc(r.bill_date)}</td><td>${esc(r.vendor)}</td><td>${esc(r.statement_no || '')}</td><td class="r">${fmtNum(r.line_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b>${r.statement_total != null && r.statement_total !== r.total ? '<div class="small red-text">명세서 차이</div>' : ''}</td><td>${r.status === 'confirmed' ? '<span class="chip green">확정</span>' : '<span class="chip">취소</span>'}</td><td class="small muted">${esc(r.created_by)}</td><td data-card-primary><button class="btn small" data-bill-open="${r.id}">보기</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 매입전표가 없습니다.</div>';
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  $('[data-xlsx]', form).onclick = () => billLinesExcel('purchase', { from: form.elements.from.value, to: form.elements.to.value, party: form.elements.vendor.value.trim() }).catch(fail);
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('#billMore', main).onclick = () => load(true).catch(fail);
  $('#billList', main).addEventListener('click', async e => { const b = e.target.closest('[data-bill-open]'); if (!b) return; try { billSheet(await api('GET', '/api/purchase-bills/' + b.dataset.billOpen), () => load()); } catch (error) { fail(error); } });
  let preset = null; try { preset = JSON.parse(sessionStorage.getItem('wpa:bill-filter') || 'null'); sessionStorage.removeItem('wpa:bill-filter'); } catch { preset = null; }
  if (preset) for (const [k, v] of Object.entries(preset)) if (form.elements[k]) form.elements[k].value = v;
  await load();
}

async function pageBillClosing(main) {
  const prev = (() => { const d = new Date(todayStr() + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  main.innerHTML = `<h1>매입 마감</h1>
  <p class="muted">달별로 거래처마다 매입전표 합계(공급가액·부가세·합계)와 아직 전표가 없는 입고 줄을 봅니다. 확인이 끝나면 「마감」하세요. 마감한 달·거래처의 전표는 새로 만들거나 취소할 수 없습니다(마감 취소는 관리자). 이번 달은 다음 달부터 마감할 수 있습니다.</p>
  <form class="toolbar" data-read-only id="closeForm"><label>마감 월<input type="month" name="period" value="${prev}" required></label><button class="btn primary">조회</button></form>
  <div id="closeList"></div><section id="closeOpen"></section>`;
  const form = $('#closeForm', main);
  const load = async () => {
    const data = await api('GET', '/api/purchase-closing?period=' + form.elements.period.value); if (!main.isConnected) return;
    const sum = k => data.rows.reduce((t, r) => t + (r[k] || 0), 0);
    $('#closeList', main).innerHTML = data.rows.length ? `<div class="table-wrap"><table class="grid"><caption class="sr-only">${esc(data.period)} 거래처별 매입</caption><thead><tr><th>거래처</th><th class="r">전표</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th class="r">전표 없는 입고</th><th>마감</th><th></th></tr></thead><tbody>${data.rows.map(r => `<tr class="${r.closing ? 'row-green' : r.unbilled_lines ? 'row-yellow' : ''}"><td data-card-primary><b>${esc(r.vendor)}</b></td><td class="r">${fmtNum(r.bill_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td class="r">${r.unbilled_lines ? `<span class="chip yellow">${fmtNum(r.unbilled_lines)}줄</span>` : '0'}</td><td>${r.closing ? `<span class="chip green">마감</span><div class="small muted">${esc(r.closing.closed_by)} · ${esc(String(r.closing.closed_at).slice(0, 16))}${r.closing.total !== r.total ? ` · <span class="red-text">마감 뒤 금액 변동</span>` : ''}</div>` : '<span class="chip">열림</span>'}</td>
      <td class="nowrap" data-card-primary>${r.bill_count ? `<button class="btn small" data-close-bills="${esc(r.vendor)}">전표 보기</button> ` : ''}${r.unbilled_lines && !r.closing ? `<button class="btn small" data-close-entry="${esc(r.vendor)}">전표 입력</button> ` : ''}${r.closing ? (data.can_reopen ? `<button class="btn small danger" data-close-reopen="${esc(r.vendor)}">마감 취소</button>` : '') : `<button class="btn small primary" data-close-do="${esc(r.vendor)}">마감</button>`}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th><td class="r">${fmtNum(sum('bill_count'))}</td><td class="r">${won(sum('supply_total'))}</td><td class="r">${won(sum('vat_total'))}</td><td class="r"><b>${won(sum('total'))}</b></td><td class="r">${fmtNum(sum('unbilled_lines'))}줄</td><td colspan="2"></td></tr></tfoot></table></div>` : `<div class="empty">${esc(data.period)}에 매입전표나 입고가 없습니다.</div>`;
    $('#closeOpen', main).innerHTML = data.unbilled.length ? `<h2>전표 없는 입고 <span class="small muted">${esc(data.from)} ~ ${esc(data.to)} · ${fmtNum(data.unbilled.length)}줄</span></h2><div class="table-wrap"><table class="grid"><thead><tr><th>입고일</th><th>거래처</th><th>구분</th><th>품목</th><th>LOT</th><th class="r">수량</th><th class="r">발주 단가</th></tr></thead><tbody>${data.unbilled.map(r => `<tr><td>${esc(r.received_date)}</td><td>${esc(r.vendor)}</td><td class="small">${BILL_SOURCE_LABEL[r.source_type]}${r.req_no ? ' · ' + esc(r.req_no) : ''}</td><td data-card-primary><b>${esc(r.item)}</b>${r.spec ? ` <span class="small">${esc(r.spec)}</span>` : ''}</td><td>${esc(r.lot || '')}</td><td class="r">${fmtNum(r.qty)} ${esc(r.unit || '')}</td><td class="r">${r.unit_price == null ? '<span class="muted">없음</span>' : fmtNum(r.unit_price)}</td></tr>`).join('')}</tbody></table></div>` : '';
  };
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('#closeList', main).addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const period = form.elements.period.value;
    if (b.dataset.closeDo) {
      const row = b.closest('tr'), total = row.querySelector('td:nth-child(5)').textContent, open = row.querySelector('td:nth-child(6)').textContent.trim();
      if (!await confirmBox(`${b.dataset.closeDo}의 ${period} 매입을 마감할까요? 합계 ${total}원${open !== '0' ? ` · 전표 없는 입고 ${open}가 남아 있습니다` : ''}. 마감하면 그 달 전표를 만들거나 취소할 수 없습니다.`)) return;
      try { await api('POST', '/api/purchase-closing', { period, vendor: b.dataset.closeDo }); toast('마감했습니다.'); await load(); } catch (error) { fail(error); }
    } else if (b.dataset.closeReopen) {
      if (!await confirmBox(`${b.dataset.closeReopen}의 ${period} 마감을 취소할까요?`)) return;
      try { await api('POST', '/api/purchase-closing/reopen', { period, vendor: b.dataset.closeReopen }); toast('마감을 취소했습니다.'); await load(); } catch (error) { fail(error); }
    } else if (b.dataset.closeBills) {
      try { sessionStorage.setItem('wpa:bill-filter', JSON.stringify({ vendor: b.dataset.closeBills, from: period + '-01', to: (([y, mo]) => `${period}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`)(period.split('-').map(Number)) })); } catch { /* 편의 */ }
      location.hash = '#/purchase/bills';
    } else if (b.dataset.closeEntry) {
      try { sessionStorage.setItem('wpa:bill-vendor', b.dataset.closeEntry); } catch { /* 편의 */ }
      location.hash = '#/purchase/bills/new';
    }
  });
  await load();
}
