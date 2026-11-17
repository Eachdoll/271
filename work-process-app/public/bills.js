// 매입전표·매입 마감(15.80). 구매 담당이 공급사 거래명세서를 받으면 그 거래처의 「전표 없는 입고 줄」을 골라
// 단가를 확정해 매입전표를 만든다(원 미만 절사, 부가세는 공급가액 합계의 10%, 영세·면세 0). 달·거래처별로 마감한다.
const BILL_SOURCE_LABEL = { po_lot: '발주입고', po: '발주입고', other: '기타입고' };
const won = n => n == null || n === '' ? '' : fmtNum(Math.trunc(Number(n)));
const billTruncC = n => Math.trunc(Math.round(n * 1000) / 1000);
const billCmp = (a, b) => String(a).localeCompare(String(b), 'ko');

async function pageBillEntry(main) {
  main.innerHTML = `<h1>매입전표 입력</h1>
  <p class="muted">공급사 거래명세서를 받으면 거래처를 고르세요. 물류가 입고를 잡은 줄이 발주별로 묶여 나옵니다(발주량·입고량·이미 전표에 잡은 양·남은 양). 명세서에 있는 줄을 체크하고 수량·단가를 표에서 바로 고친 뒤(발주 단가가 미리 들어감) 명세서 합계와 맞는지 보고 저장하세요. 명세서 수량이 입고와 다르면 고쳐 잡고, 덜 잡은 수량은 다음 전표에서 잡습니다. 금액은 원 미만 절사, 부가세는 공급가액 합계의 10%입니다.</p>
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
    <section class="pr-section"><div class="bill-lines-head"><h3>발주·입고 목록 <span class="small muted" data-bill-count></span></h3><label class="bill-find">결과 내 찾기<input type="search" data-bill-find placeholder="발주번호·품목·코드·규격·LOT·비고" autocomplete="off"></label></div><div data-bill-lines><p class="muted small">거래처를 넣으면 나옵니다.</p></div></section>
    <div class="bill-total card" data-bill-total aria-live="polite"></div>
    <div class="actions"><button class="btn primary" data-bill-save>매입전표 저장</button></div>
  </form>`;
  const form = $('form', main), box = $('[data-bill-lines]', form), find = $('[data-bill-find]', form);
  let rows = [], loadedKey = null, requestId = crypto.randomUUID(), busy = false;
  const vendorInput = form.elements.vendor;
  const left = r => Math.round((r.qty - (r.billed_qty || 0)) * 1e6) / 1e6;
  const supplyOf = r => r.price === '' || r.bqty === '' ? null : billTruncC(Number(r.bqty) * Number(r.price));
  const groupKey = r => r.source_type === 'other' ? 'other' : 'po:' + (r.po_batch || r.po_id);
  const load = async (force = false) => {
    const vendor = (vendorInput.dataset.partnerPrev ?? vendorInput.value).trim(), key = [vendor, form.elements.from.value, form.elements.to.value].join('|');
    if (!force && key === loadedKey) return; loadedKey = key;
    if (!vendor) { rows = []; box.innerHTML = '<p class="muted small">거래처를 넣으면 나옵니다.</p>'; totals(); return; }
    box.innerHTML = '<p class="muted small">불러오는 중…</p>';
    let data; try { data = await api('GET', '/api/purchase-bills/unbilled?' + new URLSearchParams({ vendor, from: form.elements.from.value, to: form.elements.to.value })); } catch (error) { box.innerHTML = `<p class="field-error">${esc(error.message)}</p>`; return; }
    if ((vendorInput.dataset.partnerPrev ?? vendorInput.value).trim() !== vendor || [form.elements.from.value, form.elements.to.value].join('|') !== key.split('|').slice(1).join('|')) return;
    rows = data.rows.map(r => ({ ...r, picked: false, price: r.unit_price ?? r.last_price ?? '', bqty: String(left(r)), note: '' }));
    // 발주별로 묶기(같이 넣은 발주 묶음 → 발주일·발주번호 순), 기타입고는 맨 끝
    const order = new Map();
    for (const r of rows) { const k = groupKey(r); if (!order.has(k)) order.set(k, order.size); }
    rows.sort((a, b) => (groupKey(a) === 'other') - (groupKey(b) === 'other') || billCmp(a.po_date || '', b.po_date || '') || order.get(groupKey(a)) - order.get(groupKey(b)) || billCmp(a.received_date, b.received_date));
    draw();
    if (data.more) toast('줄이 500개를 넘어 앞의 500줄만 보입니다. 입고일 범위로 좁히세요.', 'err');
  };
  const matches = r => { const q = find.value.trim().toLowerCase(); return !q || [r.req_no, r.item, r.product_code, r.spec, r.lot, r.po_note, r.note].some(v => String(v || '').toLowerCase().includes(q)); };
  const draw = () => {
    const shown = rows.map((r, i) => [r, i]).filter(([r]) => matches(r));
    $('[data-bill-count]', form).textContent = rows.length ? (shown.length === rows.length ? `${rows.length}줄` : `${shown.length} / ${rows.length}줄`) : '';
    if (!rows.length) { box.innerHTML = '<p class="muted">이 거래처의 전표 없는 입고가 없습니다.</p>'; totals(); return; }
    const groups = []; for (const [r, i] of shown) { const k = groupKey(r); if (!groups.length || groups.at(-1).key !== k) groups.push({ key: k, items: [] }); groups.at(-1).items.push([r, i]); }
    const head = g => { const r = g.items[0][0]; if (g.key === 'other') return '<b>기타입고</b>'; const pos = new Map(g.items.map(([x]) => [x.po_id, x])); const amount = [...pos.values()].reduce((t, x) => t + (x.unit_price == null ? 0 : billTruncC(x.po_qty * x.unit_price)), 0); const reqs = [...new Set(g.items.map(([x]) => x.req_no).filter(Boolean))].join(', '); return `<b>발주 ${esc(reqs || '—')}</b> <span class="muted">· 발주일 ${esc(r.po_date || '')}${amount ? ` · 발주금액 ${won(amount)}원` : ''}</span>${r.po_note ? ` <span class="small">· ${esc(r.po_note)}</span>` : ''}`; };
    box.innerHTML = shown.length ? `<div class="table-wrap"><table class="grid bill-grid"><caption class="sr-only">발주·입고 목록</caption><thead><tr><th scope="col"><input type="checkbox" data-bill-all aria-label="전체 선택"></th><th scope="col">입고일</th><th scope="col">품목</th><th scope="col">규격</th><th scope="col">LOT</th><th scope="col">단위</th><th scope="col" class="r">발주량</th><th scope="col" class="r">입고량</th><th scope="col" class="r">전표 잡은</th><th scope="col" class="r">이번 수량</th><th scope="col" class="r">단가</th><th scope="col" class="r">공급가액</th><th scope="col">비고</th></tr></thead>
      <tbody>${groups.map(g => `<tr class="bill-group"><td><input type="checkbox" data-bill-group="${esc(g.key)}" aria-label="이 발주 전체 선택"${g.items.every(([r]) => r.picked) ? ' checked' : ''}></td><td colspan="12">${head(g)}</td></tr>${g.items.map(([r, i]) => { const diff = r.bqty === '' ? 0 : Math.round((Number(r.bqty) - left(r)) * 1e6) / 1e6; return `<tr data-bill-row="${i}" class="${r.picked ? 'bill-picked' : ''}">
        <td><input type="checkbox" data-bill-pick="${i}"${r.picked ? ' checked' : ''} aria-label="${esc(r.item)} ${esc(r.lot || '')} 선택"></td>
        <td class="nowrap">${esc(r.received_date)}</td>
        <td data-card-primary><b>${esc(r.item)}</b> ${catChip(r.item_category)}${r.product_code ? `<div class="small muted">${esc(r.product_code)}</div>` : ''}${internalNoteChip(r)}</td>
        <td>${esc(r.spec || '')}</td><td>${esc(r.lot || '')}</td><td>${esc(r.unit || '')}</td>
        <td class="r">${r.po_qty == null ? '' : fmtNum(r.po_qty)}</td><td class="r">${fmtNum(r.qty)}</td><td class="r">${r.billed_qty ? fmtNum(r.billed_qty) : ''}</td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-bill-qty="${i}" value="${esc(r.bqty)}" aria-label="${esc(r.item)} 이번 수량"><div class="small ${diff ? 'red-text' : 'muted'}" data-bill-diff="${i}">${diff ? `입고와 차이 ${diff > 0 ? '+' : ''}${fmtNum(diff)}` : ''}</div></td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-bill-price="${i}" value="${esc(r.price)}" aria-label="${esc(r.item)} 단가"${r.unit_price == null && r.last_price == null ? ' placeholder="단가 없음"' : ''}>${r.last_price != null && r.unit_price != null && r.last_price !== r.unit_price ? `<div class="small muted">${esc(`지난 매입 ${fmtNum(r.last_price)}`)}</div>` : r.unit_price == null && r.last_price != null ? `<div class="small muted">${esc('지난 매입 단가')}</div>` : ''}</td>
        <td class="r nowrap" data-bill-supply="${i}">${supplyOf(r) == null ? '' : won(supplyOf(r))}</td>
        <td><input data-bill-note="${i}" maxlength="200" value="${esc(r.note)}" aria-label="${esc(r.item)} 비고"></td></tr>`; }).join('')}`).join('')}</tbody></table></div>`
      : '<p class="muted">찾는 줄이 없습니다.</p>';
    const all = $('[data-bill-all]', box); if (all) { all.checked = shown.length > 0 && shown.every(([r]) => r.picked); all.onchange = () => { shown.forEach(([r]) => { r.picked = all.checked; }); draw(); }; }
    const heads = $$('thead th', box).map(th => th.textContent.trim());
    $$('tbody tr[data-bill-row]', box).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = i === 0 ? '' : heads[i] || ''; }));
    totals();
  };
  const setPicked = (i, on) => { rows[i].picked = on; const cb = $(`[data-bill-pick="${i}"]`, box); if (cb) { cb.checked = on; cb.closest('tr').classList.toggle('bill-picked', on); } syncChecks(); };
  // 묶음·전체 체크를 줄 체크 상태에 맞춤(보이는 줄 기준)
  const syncChecks = () => {
    const shown = rows.filter(matches); const all = $('[data-bill-all]', box); if (all) all.checked = shown.length > 0 && shown.every(r => r.picked);
    $$('[data-bill-group]', box).forEach(g => { const list = rows.filter(r => groupKey(r) === g.dataset.billGroup && matches(r)); g.checked = list.length > 0 && list.every(r => r.picked); });
  };
  const refreshLine = i => {
    const r = rows[i], s = supplyOf(r), diff = r.bqty === '' ? 0 : Math.round((Number(r.bqty) - left(r)) * 1e6) / 1e6;
    $(`[data-bill-supply="${i}"]`, box).textContent = s == null ? '' : won(s);
    const d = $(`[data-bill-diff="${i}"]`, box); d.textContent = diff ? `입고와 차이 ${diff > 0 ? '+' : ''}${fmtNum(diff)}` : ''; d.className = 'small ' + (diff ? 'red-text' : 'muted');
  };
  box.addEventListener('change', e => {
    if (e.target.dataset.billPick !== undefined) setPicked(Number(e.target.dataset.billPick), e.target.checked);
    if (e.target.dataset.billGroup !== undefined) { rows.forEach((r, i) => { if (groupKey(r) === e.target.dataset.billGroup && matches(r)) r.picked = e.target.checked; }); draw(); return; }
    totals();
  });
  box.addEventListener('input', e => {
    const t = e.target, i = Number(t.dataset.billPrice ?? t.dataset.billQty ?? t.dataset.billNote);
    if (t.dataset.billPrice !== undefined) rows[i].price = t.value;
    if (t.dataset.billQty !== undefined) rows[i].bqty = t.value;
    if (t.dataset.billNote !== undefined) rows[i].note = t.value;
    if ((t.dataset.billPrice !== undefined || t.dataset.billQty !== undefined) && t.value !== '' && !rows[i].picked) setPicked(i, true);
    if (t.dataset.billPrice !== undefined || t.dataset.billQty !== undefined) refreshLine(i);
    totals();
  });
  // 줄 아무 데나 눌러도 체크
  box.addEventListener('click', e => { const tr = e.target.closest('tr[data-bill-row]'); if (!tr || e.target.closest('input,button,a')) return; const i = Number(tr.dataset.billRow); setPicked(i, !rows[i].picked); totals(); });
  find.addEventListener('input', () => draw());
  const totals = () => {
    const picked = rows.filter(r => r.picked), missing = picked.filter(r => r.price === '' || !(Number(r.bqty) > 0));
    const freight = billTruncC(Number(form.elements.freight.value || 0));
    const supply = picked.reduce((t, r) => t + (supplyOf(r) || 0), 0) + freight;
    const vat = form.elements.tax_type.value === 'zero' ? 0 : billTruncC(supply * 0.1), total = supply + vat;
    const statement = form.elements.statement_total.value === '' ? null : Number(form.elements.statement_total.value);
    const diff = statement === null ? null : statement - total, changed = picked.filter(r => Number(r.bqty) !== left(r)).length;
    $('[data-bill-total]', form).innerHTML = `<div class="bill-sum"><span>선택 <b>${picked.length}</b>줄</span>
      ${freight ? `<span>운송비 <b>${won(freight)}</b>원</span>` : ''}
      <span>공급가액 <b>${won(supply)}</b>원</span><span>부가세 <b>${won(vat)}</b>원</span><span class="bill-grand">합계 <b>${won(total)}</b>원</span>
      ${diff === null ? '' : diff === 0 ? '<span class="chip green">명세서 합계와 일치</span>' : `<span class="chip red">명세서와 차이 ${diff > 0 ? '+' : ''}${won(diff)}원</span>`}
      ${missing.length ? `<span class="chip yellow">단가 없는 줄 ${missing.length}</span>` : ''}${changed ? `<span class="chip yellow">${esc(`수량 고친 줄 ${changed}`)}</span>` : ''}</div>`;
  };
  form.elements.tax_type.onchange = totals; form.elements.statement_total.oninput = totals; form.elements.freight.oninput = totals;
  let timer = 0;
  vendorInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 400); });
  vendorInput.addEventListener('change', () => { clearTimeout(timer); load().catch(fail); });
  form.elements.from.onchange = form.elements.to.onchange = () => load().catch(fail);
  bindPartnerPicker(vendorInput, $('[data-partner-hint]', form), { type: 'purchase' }).catch(() => {});
  enterMovesInTable(box);
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const v = formObj(form), picked = rows.filter(r => r.picked);
    if (!v.vendor) { vendorInput.focus(); return toast('거래처를 넣으세요.', 'err'); }
    if (!picked.length) return toast('전표에 넣을 입고 줄을 체크하세요.', 'err');
    const focusOn = (r, attr) => { if (!matches(r)) { find.value = ''; draw(); } $(`[${attr}="${rows.indexOf(r)}"]`, box)?.focus(); };
    const noQty = picked.find(r => !(Number(r.bqty) > 0)); if (noQty) { focusOn(noQty, 'data-bill-qty'); return toast(`${noQty.item}의 수량을 넣으세요.`, 'err'); }
    const over = picked.find(r => Number(r.bqty) > left(r) + 0.000001); if (over) { focusOn(over, 'data-bill-qty'); return toast(`${over.item}: 이번 수량은 입고 남은 수량 ${fmtNum(left(over))} 이하로 넣으세요.`, 'err'); }
    const missing = picked.find(r => r.price === ''); if (missing) { focusOn(missing, 'data-bill-price'); return toast(`${missing.item}의 단가를 넣으세요.`, 'err'); }
    busy = true; const button = $('[data-bill-save]', form); button.disabled = true;
    try {
      const bill = await api('POST', '/api/purchase-bills', { vendor: v.vendor, bill_date: v.bill_date, statement_no: v.statement_no, tax_type: v.tax_type, statement_total: v.statement_total, freight: v.freight, note: v.note, request_id: requestId,
        lines: picked.map(r => ({ source_type: r.source_type, source_id: r.source_id, qty: r.bqty, unit_price: r.price, note: r.note })) });
      toast(bill.duplicate ? `${bill.bill_no} 전표는 앞서 이미 저장되었습니다.` : `${bill.bill_no} 매입전표를 저장했습니다. 합계 ${won(bill.total)}원`);
      requestId = crypto.randomUUID(); form.elements.statement_no.value = ''; form.elements.statement_total.value = ''; form.elements.note.value = ''; form.elements.freight.value = ''; find.value = '';
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
      <tbody>${bill.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(l.received_date)}</td><td>${esc(l.item)} ${catChip(l.category)}${l.product_code ? `<div class="po-code">${esc(l.product_code)}</div>` : ''}${l.req_no ? `<div class="po-code">${esc(l.req_no)}</div>` : ''}</td><td>${esc(l.spec)}</td><td>${esc(l.lot)}</td><td class="r">${fmtNum(l.qty)}${l.source_qty != null && l.source_qty !== l.qty ? `<div class="po-code">${esc(`입고 ${fmtNum(l.source_qty)}`)}</div>` : ''}</td><td>${esc(l.unit)}</td><td class="r">${fmtNum(l.unit_price)}</td><td class="r">${won(l.supply)}</td><td>${esc(l.note)}${l.source_voided ? ' <b>(입고 취소됨)</b>' : ''}</td></tr>`).join('')}</tbody>
      <tfoot>${bill.freight ? `<tr><th colspan="8" class="r">운송비</th><td class="r">${won(bill.freight)}</td><td></td></tr>` : ''}
        <tr><th colspan="8" class="r">공급가액</th><td class="r">${won(bill.supply_total)}</td><td></td></tr>
        <tr><th colspan="8" class="r">부가세</th><td class="r">${won(bill.vat_total)}</td><td></td></tr>
        <tr><th colspan="8" class="r">합계</th><td class="r"><b>${won(bill.total)}</b></td><td>${bill.statement_total == null ? '' : bill.statement_total === bill.total ? '명세서 일치' : `명세서 ${won(bill.statement_total)} (차이 ${won(bill.statement_total - bill.total)})`}</td></tr></tfoot></table>
      ${catSummary(billCatTotals(bill.lines))}
      ${bill.note ? `<div class="po-memo"><b>비고</b><div class="po-memo-body">${esc(bill.note)}</div></div>` : ''}
      ${bill.status === 'cancelled' ? `<p><b>취소</b> ${esc(bill.cancelled_by || '')} · ${esc(String(bill.cancelled_at || '').slice(0, 16))} · ${esc(bill.cancel_reason)}</p>` : ''}
      ${bill.return_ref ? `<p class="small"><span class="chip red">반출</span> 반출 <button type="button" class="link-btn" data-bill-ret="${bill.return_ref.id}">${esc(bill.return_ref.return_no)}</button>에서 자동으로 만든 전표입니다. 고치거나 취소는 그 반출에서 합니다.</p>` : ''}${bill.invoice ? `<p class="small">매입 세금계산서 ${esc(bill.invoice.invoice_no)}에 담김 — 고치려면 계산서를 먼저 취소하세요.</p>` : ''}${(bill.changes || []).length ? `<div class="doc-changes small muted"><b>고친 이력</b> ${bill.changes.map(c => `${esc(String(c.changed_at).slice(5, 16))} ${esc(c.changed_by)} · ${esc(c.summary)}`).join(' / ')}</div>` : ''}
    </section>
    <div class="actions"><button class="btn" data-close>닫기</button>${bill.status === 'confirmed' && !bill.closed && !bill.invoice && !bill.return_ref ? '<button class="btn" data-bill-edit>수정</button>' : ''}${bill.status === 'confirmed' && !bill.closed && !bill.return_ref ? '<button class="btn danger" data-bill-cancel>전표 취소</button>' : ''}<button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`매입전표_${bill.bill_no}`);
  $('[data-bill-ret]', m.el)?.addEventListener('click', async e => { try { returnSheet(await api('GET', '/api/returns/' + e.currentTarget.dataset.billRet)); } catch (error) { fail(error); } });
  $('[data-bill-edit]', m.el)?.addEventListener('click', () => billEditWindow('purchase', bill, async next => { m.close(); billSheet(next, after); await after?.(); }));
  const cancel = $('[data-bill-cancel]', m.el);
  if (cancel) cancel.onclick = async () => {
    const v = await promptBox('매입전표 취소', `<p class="small muted">${esc(bill.bill_no)}을(를) 취소하면 그 입고 줄은 다시 「전표 없는 입고」로 돌아갑니다.</p><label>취소 사유 *<input name="reason" required maxlength="200"></label>`);
    if (!v) return;
    try { const r = await api('POST', `/api/purchase-bills/${bill.id}/cancel`, v); toast('전표를 취소했습니다.'); m.close(); billSheet(r, after); await after?.(); } catch (error) { fail(error); }
  };
}

// 15.97 ERP식 전표 목록: 날짜 내림차순 목록에 월마다 「YYYY/MM 계」 줄, 맨 아래 합계(확정 전표만 더함).
// lead = 금액 앞 칸 수, tail = 금액 뒤 칸 수, rowHtml = 전표 한 줄
function billMonthBody(rows, lead, tail, rowHtml) {
  const live = r => r.status === 'confirmed', sum = (list, k) => list.filter(live).reduce((t, r) => t + r[k], 0);
  const line = (label, list, cls) => `<tr class="${cls}"><td colspan="${lead}">${label} <span class="small muted">${esc(`${list.filter(live).length}건`)}</span></td><td class="r">${won(sum(list, 'supply_total'))}</td><td class="r">${won(sum(list, 'vat_total'))}</td><td class="r"><b>${won(sum(list, 'total'))}</b></td><td colspan="${tail}"></td></tr>`;
  let out = '';
  for (let i = 0; i < rows.length;) {
    const m = String(rows[i].bill_date).slice(0, 7), group = [];
    while (i < rows.length && String(rows[i].bill_date).slice(0, 7) === m) group.push(rows[i++]);
    out += group.map(rowHtml).join('') + line(`<span>${esc(m.replace('-', '/'))}</span> <span>계</span>`, group, 'month-sum');
  }
  return `<tbody>${out}</tbody><tfoot>${line('합계', rows, 'grand-sum').replace(/<td colspan/, '<th colspan').replace('</td><td class="r">', '</th><td class="r">')}</tfoot>`;
}
async function pageBillList(main) {
  main.innerHTML = `<h1>매입전표 목록</h1>
  <form class="list-filters toolbar" data-read-only id="billFilters"><label>명세서 일자<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label>거래처<input name="vendor" maxlength="100"></label><label>상태<select name="status"><option value="confirmed" selected>확정</option><option value="">전체(취소 포함)</option><option value="cancelled">취소만</option></select></label><label>분류<select name="category">${catOptions(['원자재', '부자재', '임가공', '상품', '제품', '반제품', '미분류'])}</select></label><label class="grow">검색<input type="search" name="q" placeholder="전표번호·거래처·명세서 번호·비고·입력자"></label><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀 (줄별)</button></form>
  <div id="billSummary" class="counts"></div><div class="bulk-bar" id="billBulk"><span data-bulk-info>체크한 전표 없음</span><button type="button" class="btn primary" data-bulk-tax disabled>체크한 전표로 받은 세금계산서 등록</button><span class="small muted">한 매입처씩 · 이미 등록된 전표는 체크할 수 없습니다(중복 방지).</span></div><div id="billList"></div><div class="actions"><button type="button" class="btn" id="billMore" hidden>더 보기</button></div>`;
  const form = $('#billFilters', main); let rows = [], page = 0;
  const load = async (next = false) => {
    const data = await api('GET', '/api/purchase-bills?' + new URLSearchParams({ ...formObj(form), page: next ? page + 1 : 0 }));
    if (!main.isConnected) return;
    rows = next ? rows.concat(data.rows) : data.rows; page = data.page; $('#billMore', main).hidden = !data.more;
    const live = rows.filter(r => r.status === 'confirmed');
    $('#billSummary', main).innerHTML = `<b>${esc(`${rows.length}건 · 확정 합계 ${won(live.reduce((t, r) => t + r.total, 0))}원 (공급가액 ${won(live.reduce((t, r) => t + r.supply_total, 0))} · 부가세 ${won(live.reduce((t, r) => t + r.vat_total, 0))})`)}</b>${data.more ? ' <span>(더 있음)</span>' : ''}${catSummary(data.by_category, '확정 전표 분류별 공급가액')}`;
    $('#billList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid bill-list"><thead><tr><th class="pick-cell"><input type="checkbox" data-bulk-all aria-label="등록할 수 있는 전표 모두 고르기"></th><th>전표번호</th><th>명세서 일자</th><th>거래처</th><th>명세서 번호</th><th class="r">줄</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th>상태</th><th>세금계산서</th><th>입력</th><th></th></tr></thead>${billMonthBody(rows, 6, 4, r => `<tr class="${r.status === 'cancelled' ? 'row-off' : ''}"><td class="pick-cell">${r.status === 'confirmed' && !r.invoice ? `<input type="checkbox" data-bulk-pick="${r.id}" aria-label="${esc(r.bill_no)} 고르기">` : `<input type="checkbox" disabled title="${r.invoice ? '이미 세금계산서에 담김' : '취소된 전표'}" aria-label="${esc(r.bill_no)} 고를 수 없음">`}</td><td data-card-primary><button type="button" class="link-btn" data-bill-open="${r.id}">${esc(r.bill_no)}</button></td><td>${esc(r.bill_date)}</td><td>${esc(r.vendor)}<div>${r.return_ref ? `<button type="button" class="chip red ret-chip" data-list-ret="${esc(r.return_ref.split('|')[1])}" title="반출 전표 보기">반출 ${esc(r.return_ref.split('|')[0])}</button> ` : ''}${catChips(r.categories)}</div></td><td>${esc(r.statement_no || '')}</td><td class="r">${fmtNum(r.line_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b>${r.statement_total != null && r.statement_total !== r.total ? '<div class="small red-text">명세서 차이</div>' : ''}</td><td>${r.status === 'confirmed' ? '<span class="chip green">확정</span>' : '<span class="chip">취소</span>'}</td><td>${r.invoice ? `<span class="chip green">받음</span><div class="small muted">${esc(r.invoice.split('|')[1] || r.invoice.split('|')[0])}</div>` : r.status === 'confirmed' ? '<span class="small muted">안 받음</span>' : ''}</td><td class="small muted">${esc(r.created_by)}</td><td data-card-primary><button class="btn small" data-bill-open="${r.id}">보기</button></td></tr>`)}</table></div>` : '<div class="empty">조건에 맞는 매입전표가 없습니다.</div>';
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  $('[data-xlsx]', form).onclick = () => billLinesExcel('purchase', { from: form.elements.from.value, to: form.elements.to.value, party: form.elements.vendor.value.trim() }).catch(fail);
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('#billMore', main).onclick = () => load(true).catch(fail);
  bulkPicks(main, () => rows, 'purchase', () => load());
  $('#billList', main).addEventListener('click', async e => { const rr = e.target.closest('[data-list-ret]'); if (rr) { try { returnSheet(await api('GET', '/api/returns/' + rr.dataset.listRet), () => load()); } catch (error) { fail(error); } } });
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
    $('#closeList', main).innerHTML = data.rows.length ? `<div class="table-wrap"><table class="grid"><caption class="sr-only">${esc(data.period)} 거래처별 매입</caption><thead><tr><th>거래처</th><th class="r">전표</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th class="r">지급</th><th class="r">전표 없는 입고</th><th>마감</th><th></th></tr></thead><tbody>${data.rows.map(r => `<tr class="${r.closing ? 'row-green' : r.unbilled_lines ? 'row-yellow' : ''}"><td data-card-primary><b>${esc(r.vendor)}</b></td><td class="r">${fmtNum(r.bill_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td class="r">${won(r.payment_total || 0)}</td><td class="r">${r.unbilled_lines ? `<span class="chip yellow">${fmtNum(r.unbilled_lines)}줄</span>` : '0'}</td><td>${r.closing ? `<span class="chip green">마감</span><div class="small muted">${esc(r.closing.closed_by)} · ${esc(String(r.closing.closed_at).slice(0, 16))}${r.closing.total !== r.total ? ` · <span class="red-text">마감 뒤 금액 변동</span>` : ''}</div>` : '<span class="chip">열림</span>'}</td>
      <td class="nowrap" data-card-primary>${r.bill_count ? `<button class="btn small" data-close-bills="${esc(r.vendor)}">전표 보기</button> ` : ''}${r.unbilled_lines && !r.closing ? `<button class="btn small" data-close-entry="${esc(r.vendor)}">전표 입력</button> ` : ''}${r.closing ? (data.can_reopen ? `<button class="btn small danger" data-close-reopen="${esc(r.vendor)}">마감 취소</button>` : '') : `<button class="btn small primary" data-close-do="${esc(r.vendor)}">마감</button>`}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th><td class="r">${fmtNum(sum('bill_count'))}</td><td class="r">${won(sum('supply_total'))}</td><td class="r">${won(sum('vat_total'))}</td><td class="r"><b>${won(sum('total'))}</b></td><td class="r">${won(sum('payment_total'))}</td><td class="r">${fmtNum(sum('unbilled_lines'))}줄</td><td colspan="2"></td></tr></tfoot></table></div>` : `<div class="empty">${esc(data.period)}에 매입전표나 입고가 없습니다.</div>`;
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

// 구매 › 입고현황(15.87): 매입 마감용. 입고일 기준 기간의 입고를 분류별·거래처별 금액으로 본다.
// 확정 = 매입전표 공급가액, 미확정 = 아직 전표 안 잡은 수량 × 발주 단가. 단가가 없는 줄(기타입고 등)은 「단가 없음」.
const RS_STATE = { billed: ['전표 완료', 'green'], partial: ['일부 전표', 'yellow'], open: ['전표 없음', ''], adjust: ['수량 수정', ''] };
async function pageReceiptStatus(main, side = 'purchase') {
  // 15.157 납품현황: 같은 화면을 매출 쪽(출하 기준)으로. 화면 글자만 바꿔 쓴다(입고→출하, 매입전표→매출전표, 발주번호→수주번호).
  const SALES = side === 'sales';
  const WORDS = [['입고현황', '납품현황'], ['구매의뢰번호', '수주번호'], ['발주번호', '수주번호'], ['발주 단가', '수주·단가표 단가'], ['매입전표', '매출전표'], ['입고일자', '출고일자'], ['입고일', '출고일'], ['입고', '출하']];
  const TR = s => SALES ? WORDS.reduce((t, [a, b]) => t.split(a).join(b), String(s)) : s;
  const relabel = root => {
    if (!SALES || !root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (/입고|매입전표|발주|구매의뢰/.test(n.nodeValue)) n.nodeValue = TR(n.nodeValue);
    for (const el of root.querySelectorAll('[placeholder],[aria-label],[title]')) for (const a of ['placeholder', 'aria-label', 'title']) { const v = el.getAttribute(a); if (v && /입고|매입전표|발주/.test(v)) el.setAttribute(a, TR(v)); }
  };
  const VIEW_KEY = SALES ? 'wpa:ds-view' : 'wpa:rs-view', CAT_KEY = SALES ? 'wpa:ds-cat' : 'wpa:rs-cat';
  const r0 = rpRange('month');
  main.innerHTML = `<div class="rs-page"><h1>입고현황</h1>
  <p class="muted small">기간 안에 입고된 것을 거래처·품목·입고일 중 하나로 묶어 펼쳐 봅니다(거래처·품목 → 입고일자별, 입고일 → 거래처별 → 입고 내역). 매입전표를 잡은 수량은 전표 금액(확정), 아직 안 잡은 수량은 발주 단가로 계산한 금액(미확정, 세액 10% 예상)입니다.</p>
  <form class="rs-filter" data-read-only id="rsForm"><div class="rs-f rs-f-date"><span class="rs-f-l">입고일</span><input type="date" name="from" value="${r0.from}" required aria-label="입고일 시작"><span class="muted">~</span><input type="date" name="to" value="${r0.to}" required aria-label="입고일 끝"></div>
    <label class="rs-f"><span class="rs-f-l">구분</span><select id="rsCat" aria-label="구분"></select></label>
    <label class="rs-f rs-f-vendor"><span class="rs-f-l">거래처</span><input name="vendor" maxlength="100" autocomplete="off" placeholder="비우면 전체"></label>
    <label class="rs-f rs-f-q"><span class="rs-f-l">통합 검색</span><input type="search" id="rsQ" autocomplete="off" placeholder="거래처명·품목명·품목코드·발주번호·LOT"></label>
    <div class="rs-f rs-f-btn"><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀</button></div></form>
  <div class="rs-kpis" id="rsTabs" role="tablist" aria-label="구분별 합계"></div>
  <div class="rs-modes" role="group" aria-label="보기"><span class="small muted">보기</span>${[['vendor', '거래처별'], ['date', '일자별'], ['item', '품목별'], ['sum', '분류·거래처 요약']].map(([k, l]) => `<label class="inline"><input type="radio" name="rs-mode" value="${k}"> ${l}</label>`).join('')}</div>
  <div id="rsDrill" hidden></div>
  <div id="rsSummary"></div><h2 class="rs-h">거래처별</h2><div id="rsVendors"></div><details class="rs-lines-fold" open><summary><h2 class="rs-h" style="display:inline">입고 줄 <span class="small muted" id="rsCount"></span></h2></summary><div id="rsVendorChip"></div><div id="rsLines"></div></details></div>`;
  const form = $('#rsForm', main);
  let data = null, vendorFilter = '', cat = '', mode = 'vendor', q = '', loading = false;
  if (SALES) { relabel($('.rs-page', main)); new MutationObserver(() => relabel($('.rs-page', main))).observe($('.rs-page', main), { childList: true, subtree: true }); }
  try { mode = localStorage.getItem(VIEW_KEY) || 'vendor'; } catch { mode = 'vendor'; }
  if (!['vendor', 'date', 'item', 'sum'].includes(mode)) mode = 'vendor';
  if (matchMedia('(max-width: 820px)').matches) $('.rs-lines-fold', main).open = false; // 휴대폰은 분류·거래처별 표를 먼저, 입고 줄은 접어 둔다
  try { cat = localStorage.getItem(CAT_KEY) || ''; } catch { cat = ''; }
  bindPartnerPicker(form.elements.vendor, null, { type: SALES ? 'sales' : 'purchase' }).catch(() => {});
  const amount = n => n ? won(n) : '<span class="muted">0</span>';
  const label = c => c || '전체';
  // 15.96 거래가 있는 분류만(그 기간에 입고 줄이 있는 분류). 없는 분류는 탭·합계·거래처 칸에서 뺀다.
  const shownCats = () => data.categories.filter(c => c.lines);
  const amt = l => (l.confirmed || 0) + (l.estimate || 0);
  const labelRows = sel => { const heads = $$(`${sel} thead th`, main).map(th => th.textContent.trim()); $$(`${sel} tbody tr`, main).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = heads[i] || ''; })); };
  const FIXED_CATS = ['원자재', '부자재', '상품'];
  const qm = l => !q || [l.vendor, l.item, l.product_code, l.req_no, l.lot].some(x => String(x ?? '').toLowerCase().includes(q));
  const cardCats = () => [...FIXED_CATS, ...shownCats().map(c => c.category).filter(c => !FIXED_CATS.includes(c))];
  const drawTabs = () => {
    // 검색어가 없으면 서버 집계(전체 줄·운송비 포함), 검색어가 있으면 맞는 입고 줄만 더한다.
    const stat = c => {
      if (!q) { if (!c) return { total: shownCats().reduce((t, x) => t + x.total, 0) + data.freight.total, lines: shownCats().reduce((t, x) => t + x.lines, 0) }; const x = data.categories.find(y => y.category === c); return { total: x?.total || 0, lines: x?.lines || 0 }; }
      const ls = data.lines.filter(l => (!c || l.category === c) && qm(l)); return { total: ls.reduce((t, l) => t + amt(l), 0), lines: ls.length };
    };
    $('#rsTabs', main).innerHTML = ['', ...cardCats()].map(c => { const t = stat(c); return `<button type="button" role="tab" data-rs-tab="${esc(c)}" class="rs-kpi${c === cat ? ' on' : ''}${t.lines ? '' : ' is-zero'}" aria-selected="${c === cat}"><span class="rs-kpi-l">${esc(label(c))}</span><b class="rs-kpi-v">${won(t.total)}<small>원</small></b><span class="rs-kpi-n">${fmtNum(t.lines)}건${!c && !q && data.freight.total ? ` · 운송비 ${won(data.freight.total)} 포함` : ''}</span></button>`; }).join('');
    const sel = $('#rsCat', main); sel.innerHTML = ['', ...cardCats()].map(c => `<option value="${esc(c)}"${c === cat ? ' selected' : ''}>${esc(label(c))}</option>`).join('');
  };
  const drawSummary = () => {
    const head = '<thead><tr><th>분류</th><th class="r">입고 줄</th><th class="r">확정(매입전표)</th><th class="r">미확정(발주 단가)</th><th class="r">합계</th><th class="r">전표 안 잡은 줄</th><th class="r">단가 없는 줄</th></tr></thead>';
    const row = c => `<tr><td><b>${esc(c.category)}</b></td><td class="r">${fmtNum(c.lines)}</td><td class="r">${amount(c.confirmed)}</td><td class="r">${amount(c.estimate)}</td><td class="r"><b>${amount(c.total)}</b></td><td class="r">${c.open ? `<span class="chip yellow">${fmtNum(c.open)}</span>` : '0'}</td><td class="r">${c.unpriced ? `<span class="chip yellow">${fmtNum(c.unpriced)}</span>` : '0'}</td></tr>`;
    const caption = `<caption class="sr-only">${esc(`${data.from} ~ ${data.to} 분류별 입고 금액`)}</caption>`;
    if (cat) {
      const c = data.categories.find(x => x.category === cat) || { category: cat, lines: 0, confirmed: 0, estimate: 0, total: 0, open: 0, unpriced: 0 };
      $('#rsSummary', main).innerHTML = `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="입고현황 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid rs-cat">${caption}${head}<tbody>${row(c)}</tbody></table></div>`;
      return;
    }
    const cats = shownCats(), sum = k => cats.reduce((t, c) => t + c[k], 0);
    if (!cats.length && !data.freight.total) { $('#rsSummary', main).innerHTML = '<div class="empty">그 기간에 입고가 없습니다.</div>'; return; }
    $('#rsSummary', main).innerHTML = `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="입고현황 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid rs-cat">${caption}${head}<tbody>${cats.map(row).join('')}
      ${data.freight.total ? `<tr><td>운송비 <span class="small muted">${esc(`(전표 일자 기준 ${data.freight.bills}건)`)}</span></td><td class="r"></td><td class="r">${won(data.freight.total)}</td><td class="r"></td><td class="r"><b>${won(data.freight.total)}</b></td><td></td><td></td></tr>` : ''}</tbody>
      <tfoot><tr><th>합계</th><td class="r">${fmtNum(sum('lines'))}</td><td class="r">${won(sum('confirmed') + data.freight.total)}</td><td class="r">${won(sum('estimate'))}</td><td class="r"><b>${won(sum('total') + data.freight.total)}</b></td><td class="r">${fmtNum(sum('open'))}</td><td class="r">${fmtNum(sum('unpriced'))}</td></tr></tfoot></table></div>`;
  };
  // 15.98 거래처별: 분류 칸 대신 거래처 → 품목(품목명·규격·수량·단위·단가·금액). 분류는 품목 등록 때 정해지므로 위 분류 탭으로 거른다
  // (탭을 누르면 그 분류를 거래한 거래처만). 같은 품목이라도 단가가 다르면 줄을 나눈다. 거래처마다 「계」 줄에 줄 보기·전표 입력.
  const drawVendors = () => {
    // 거래처 목록·계·합계는 서버 집계(data.vendors, 이름 키로 묶임·전체 줄)에서, 품목 줄은 받아 온 입고 줄(최대 3000)에서 만든다.
    const vkey = v => String(v ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
    const vendors = data.vendors.filter(v => !cat || v.by?.[cat]);
    if (!vendors.length) { $('#rsVendors', main).innerHTML = `<div class="empty">${esc(cat ? `그 기간에 ${cat} 입고가 없습니다.` : '그 기간에 입고가 없습니다.')}</div>`; return; }
    const items = new Map(vendors.map(v => [vkey(v.vendor), new Map()]));
    for (const l of data.lines) {
      if (cat && l.category !== cat) continue;
      const bucket = items.get(vkey(l.vendor)); if (!bucket) continue;
      const key = [l.item, l.spec || '', l.unit || '', l.unit_price ?? ''].join('\u0001');
      if (!bucket.has(key)) bucket.set(key, { item: l.item, code: l.product_code || '', spec: l.spec || '', unit: l.unit || '', price: l.unit_price, qty: 0, amount: 0, unpriced: 0 });
      const it = bucket.get(key); it.qty += l.qty; it.amount += (l.confirmed || 0) + (l.estimate || 0); it.unpriced += l.unpriced ? 1 : 0;
    }
    const totals = v => cat ? { amount: v.by[cat].confirmed + v.by[cat].estimate, estimate: v.by[cat].estimate, open: v.by[cat].open } : { amount: v.total, estimate: v.estimate, open: v.open };
    const list = vendors.map(v => ({ v, t: totals(v), rows: [...items.get(vkey(v.vendor)).values()] })).sort((a, b) => b.t.amount - a.t.amount || a.v.vendor.localeCompare(b.v.vendor, 'ko'));
    const priceCell = it => it.price != null ? fmtNum(it.price) : it.unpriced ? '<span class="chip yellow">단가 없음</span>' : '';
    const body = list.map(({ v, t, rows }) => {
      const units = new Set(rows.map(it => it.unit)), qty = units.size === 1 ? fmtNum(rows.reduce((s, it) => s + it.qty, 0)) : '';
      return rows.map((it, k) => `<tr>
        <td>${k ? '' : `<b>${esc(v.vendor)}</b>`}</td><td data-card-primary><b>${esc(it.item)}</b>${it.code ? ` <span class="small muted">${esc(it.code)}</span>` : ''}</td><td>${esc(it.spec)}</td>
        <td class="r">${fmtNum(it.qty)}</td><td>${esc(it.unit)}</td><td class="r">${priceCell(it)}</td><td class="r">${amount(it.amount)}</td><td></td></tr>`).join('')
      + `<tr class="month-sum rs-vendor-sum"><td colspan="3">${esc(v.vendor)} <span>계</span></td><td class="r">${qty}</td><td>${units.size === 1 ? esc([...units][0]) : ''}</td><td></td><td class="r"><b>${won(t.amount)}</b>${t.estimate ? `<div class="small muted">${esc(`미확정 ${won(t.estimate)}`)}</div>` : ''}</td>
        <td class="nowrap"><button type="button" class="btn small" data-rs-vendor="${esc(v.vendor)}">줄 보기</button>${t.open ? ` <button type="button" class="btn small" data-rs-bill="${esc(v.vendor)}">전표 입력</button>` : ''}</td></tr>`;
    }).join('');
    const total = list.reduce((s, x) => s + x.t.amount, 0);
    $('#rsVendors', main).innerHTML = `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="입고현황 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid rs-vendors" data-no-sort data-keep-cols><thead><tr><th>거래처</th><th>품목명</th><th>규격</th><th class="r">수량</th><th>단위</th><th class="r">단가</th><th class="r">금액</th><th></th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr class="grand-sum"><th colspan="6">${esc(`합계 · 거래처 ${list.length}곳`)}</th><td class="r"><b>${won(total)}</b></td><td></td></tr></tfoot></table></div>${data.more ? '<p class="small muted">입고 줄이 많아 품목 줄은 앞 3000줄만 보입니다(거래처 계·합계는 전체 기준). 기간을 좁히세요.</p>' : ''}`;
    labelRows('#rsVendors');
  };
  const visibleLines = () => data.lines.filter(l => (!cat || l.category === cat) && (!vendorFilter || l.vendor === vendorFilter) && qm(l));
  const drawLines = () => {
    const rows = visibleLines();
    $('#rsCount', main).textContent = `${rows.length}줄${data.more ? ' (앞 3000줄만)' : ''}`;
    $('#rsVendorChip', main).innerHTML = vendorFilter ? `<p class="small"><span class="chip">${esc(vendorFilter)}</span> <button type="button" class="btn small" data-rs-clear>거래처 거름 해제</button></p>` : '';
    $('#rsLines', main).innerHTML = rows.length ? `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="입고현황 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid"><thead><tr><th>입고일</th><th>거래처</th>${cat ? '' : '<th>분류</th>'}<th>품목</th><th>규격</th><th>LOT</th><th class="r">수량</th><th>단위</th><th class="r">발주 단가</th><th class="r">확정(전표)</th><th class="r">미확정</th><th>전표</th></tr></thead><tbody>${rows.map(l => `<tr class="${l.unpriced ? 'row-yellow' : ''}"><td class="nowrap">${esc(l.received_date)}</td><td>${esc(l.vendor)}</td>${cat ? '' : `<td>${esc(l.category)}</td>`}<td data-card-primary><b>${esc(l.item)}</b>${l.product_code ? `<div class="small muted">${esc(l.product_code)}</div>` : ''}</td><td>${esc(l.spec || '')}</td><td>${esc(l.lot || '')}</td><td class="r">${fmtNum(l.qty)}</td><td>${esc(l.unit || '')}</td><td class="r">${l.unit_price == null ? '<span class="muted">없음</span>' : fmtNum(l.unit_price)}</td><td class="r">${amount(l.confirmed)}</td><td class="r">${l.unpriced ? '<span class="chip yellow">단가 없음</span>' : amount(l.estimate)}</td><td>${(([t, c]) => `<span class="chip ${c}">${t}</span>`)(RS_STATE[l.state])}${l.state === 'partial' ? `<div class="small muted">${esc(`남음 ${fmtNum(l.remaining)}`)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 입고가 없습니다.</div>';
    if (rows.length) $('#rsLines', main).insertAdjacentHTML('beforeend', sumLine([['합계', esc(`${rows.length}줄`)], ['수량', esc(unitTotals(rows, l => l.qty, l => l.unit))], ['확정(전표)', esc(`${won(rows.reduce((t, l) => t + (l.confirmed || 0), 0))}원`)], ['미확정', esc(`${won(rows.reduce((t, l) => t + (l.estimate || 0), 0))}원`)]]));
    labelRows('#rsLines');
  };
  // 15.151~15.153 거래처별·품목별·일자별은 모두 아코디언(아래 drawAcc). 「분류·거래처 요약」만 예전 표.
  const stockCompare = (x, y) => String(x ?? '').localeCompare(String(y ?? ''), 'ko', { numeric: true });
  const drawDrill = () => {
    const on = mode !== 'sum';
    $('#rsDrill', main).hidden = !on;
    for (const el of [$('#rsSummary', main), $('#rsVendors', main), $('.rs-lines-fold', main), ...$$('h2.rs-h', main).filter(h => !h.closest('.rs-lines-fold'))]) if (el) el.hidden = on;
    $$('[name=rs-mode]', main).forEach(x => { x.checked = x.value === mode; });
    $('#rsDrill', main).classList.toggle('rs-acc-mode', !!ACC[mode]);
    if (!on) return;
    if (!data) { $('#rsDrill', main).innerHTML = `<div class="rs-state">${loading ? '<span class="rs-spin" aria-hidden="true"></span>불러오는 중…' : '조회 조건을 고르고 「조회」를 누르세요.'}</div>`; return; }
    drawAcc();
  };
  // ── 15.151 아코디언: 거래처별 = 거래처 → 입고일자별 → 입고 내역, 15.152 품목별 = 품목 → 입고일자별 → 입고 내역.
  // 금액은 위 드릴과 같은 식(공급가액 = 확정+미확정, 세액 = 줄의 vat). 펼침 기록은 보기마다 따로(거래처·품목 여러 개 동시에).
  const vkey = v => String(v ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
  const dash = v => v === null || v === undefined || String(v).trim() === '' ? '<span class="rs-dash">-</span>' : esc(v);
  const CAL = '<svg class="rs-cal" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  const CHEV = '<span class="rs-chev" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  const BADGE = { billed: ['확정', 'ok'], partial: ['일부 확정', 'part'], adjust: ['수량 수정', 'part'], open: ['미확정', 'no'] };
  const badge = l => { const [t, c] = BADGE[l.state] || BADGE.open; return `<span class="rs-badge rs-badge-${c}">${t}</span>${l.unpriced ? ' <span class="rs-badge rs-badge-warn">단가 없음</span>' : ''}`; };
  const SUB_DATE = { title: '입고일자별', key: l => l.received_date, label: l => l.received_date, icon: true, sort: (a, b) => stockCompare(b.key, a.key) };
  const SUB_VENDOR = { title: '거래처별', key: l => vkey(l.vendor), label: l => l.vendor, icon: false, sort: (a, b) => (b.supply + b.vat) - (a.supply + a.vat) || stockCompare(a.label, b.label) };
  const ACC = {
    date: { head: '입고일', key: l => l.received_date, sort: (a, b) => stockCompare(b.key, a.key), sub: SUB_VENDOR,
      cell: g => `${CAL} <b>${esc(g.first.received_date)}</b>`, title: g => g.first.received_date, qty: false, word: '일',
      cols: ['입고일', '발주번호', '품목', '규격', 'LOT', '단위'], row: l => `<td>${esc(l.received_date)}</td><td>${dash(l.req_no)}</td><td class="rs-item"><b>${esc(l.item)}</b>${l.product_code ? `<span class="rs-code">${esc(l.product_code)}</span>` : ''}</td><td>${dash(l.spec)}</td><td>${dash(l.lot)}</td><td>${dash(l.unit)}</td>` },
    vendor: { sub: SUB_DATE, head: '거래처', key: l => vkey(l.vendor), sort: (a, b) => (b.supply + b.vat) - (a.supply + a.vat) || stockCompare(a.first.vendor, b.first.vendor),
      cell: g => `<b>${esc(g.first.vendor)}</b>`, title: g => g.first.vendor, qty: false, word: '곳',
      cols: ['입고일', '발주번호', '품목', '규격', 'LOT', '단위'], row: l => `<td>${esc(l.received_date)}</td><td>${dash(l.req_no)}</td><td class="rs-item"><b>${esc(l.item)}</b>${l.product_code ? `<span class="rs-code">${esc(l.product_code)}</span>` : ''}</td><td>${dash(l.spec)}</td><td>${dash(l.lot)}</td><td>${dash(l.unit)}</td>` },
    item: { sub: SUB_DATE, head: '품목', key: l => [l.product_code || '', l.item, l.spec || '', l.unit || ''].join('|'), sort: (a, b) => stockCompare(a.first.item, b.first.item) || stockCompare(a.first.product_code, b.first.product_code) || stockCompare(a.first.spec, b.first.spec),
      cell: g => `<b>${esc(g.first.item)}</b>${g.first.product_code || g.first.spec ? `<span class="rs-sub">${esc([g.first.product_code, g.first.spec].filter(Boolean).join(' · '))}</span>` : ''}`, title: g => g.first.item + (g.first.spec ? ` (${g.first.spec})` : ''), qty: true, word: '개',
      cols: ['입고일', '거래처', '발주번호', 'LOT', '단위'], row: l => `<td>${esc(l.received_date)}</td><td class="rs-item"><b>${esc(l.vendor)}</b></td><td>${dash(l.req_no)}</td><td>${dash(l.lot)}</td><td>${dash(l.unit)}</td>` },
  };
  const accState = { vendor: { open: new Set(), closed: new Set() }, item: { open: new Set(), closed: new Set() }, date: { open: new Set(), closed: new Set() } };
  // 2단계 묶음 키 = 1단계 키 + ␟ + 2단계 키. 거래처명·품목 키에 |가 있어도 섞이지 않게 잘 안 쓰는 글자(␟)로 나눈다.
  const SEP = '\u241F', dayKey = (k, d) => `${k}${SEP}${d}`, splitDay = k => { const i = k.lastIndexOf(SEP); return [k.slice(0, i), k.slice(i + 1)]; };
  const accRows = cfg => {
    const m = new Map();
    for (const l of data.lines) {
      if ((cat && l.category !== cat) || !qm(l)) continue;
      const k = cfg.key(l); const g = m.get(k) || { key: k, first: l, lines: 0, qty: 0, supply: 0, vat: 0, days: new Map() };
      g.lines++; g.qty += Number(l.qty) || 0; g.supply += amt(l); g.vat += l.vat || 0;
      const sk = cfg.sub.key(l), d = g.days.get(sk) || { key: sk, label: cfg.sub.label(l), rows: [], supply: 0, vat: 0 }; d.rows.push(l); d.supply += amt(l); d.vat += l.vat || 0; g.days.set(sk, d);
      m.set(k, g);
    }
    return [...m.values()].sort(cfg.sort);
  };
  const dayTable = (cfg, d) => { const n = cfg.cols.length; return `<div class="rs-scroll" tabindex="0" role="region" aria-label="${esc(d.label)} 입고 내역 · 좌우로 스크롤"><table class="rs-detail" data-no-sort data-keep-cols><thead><tr>${cfg.cols.map(c => `<th>${c}</th>`).join('')}<th class="r">수량</th><th class="r">단가</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계금액</th><th class="c">전표상태</th></tr></thead>
    <tbody>${d.rows.map(l => `<tr>${cfg.row(l)}<td class="r">${fmtNum(l.qty)}</td><td class="r">${l.qty && amt(l) ? won(Math.round(amt(l) / l.qty)) : '<span class="rs-dash">-</span>'}</td><td class="r">${won(amt(l))}</td><td class="r">${won(l.vat || 0)}</td><td class="r"><b>${won(amt(l) + (l.vat || 0))}</b></td><td class="c">${badge(l)}</td></tr>`).join('')}</tbody>
    ${d.rows.length > 1 ? `<tfoot><tr><th colspan="${n}">${esc(d.label)} 소계</th><td class="r">${new Set(d.rows.map(l => l.unit)).size === 1 ? fmtNum(d.rows.reduce((t, l) => t + (Number(l.qty) || 0), 0)) : ''}</td><td></td><td class="r">${won(d.supply)}</td><td class="r">${won(d.vat)}</td><td class="r"><b>${won(d.supply + d.vat)}</b></td><td></td></tr></tfoot>` : ''}</table></div>`; };
  const accBody = (cfg, st, g) => {
    const days = [...g.days.values()].sort(cfg.sub.sort);
    return `<div class="rs-acc-body"><div class="rs-acc-head"><b>${esc(cfg.title(g))} 입고 상세</b><span class="muted"> · ${cfg.sub.title}</span><span class="rs-acc-sum">공급가액 <b>${won(g.supply)}</b><i></i>세액 <b>${won(g.vat)}</b><i></i>합계 <b class="rs-blue">${won(g.supply + g.vat)}</b></span></div>
      ${days.map(d => { const dk = dayKey(g.key, d.key), open = !st.closed.has(dk); return `<div class="rs-day${open ? ' open' : ''}"><button type="button" class="rs-day-h" data-rs-day="${esc(dk)}" aria-expanded="${open}">${CHEV}${cfg.sub.icon ? CAL : ''}<b>${esc(d.label)}</b><span class="muted">(${fmtNum(d.rows.length)}건)</span><span class="rs-day-sum">공급가액 ${won(d.supply)}<i></i>합계 <b>${won(d.supply + d.vat)}</b></span></button>${open ? dayTable(cfg, d) : ''}</div>`; }).join('')}</div>`;
  };
  const drawAcc = () => {
    const cfg = ACC[mode], st = accState[mode], box = $('#rsDrill', main), list = accRows(cfg);
    for (const k of [...st.open]) if (!list.some(g => g.key === k)) st.open.delete(k); // 조회·필터로 없어진 줄은 펼침 기록도 지운다
    for (const k of [...st.closed]) { const [v, d] = splitDay(k); const g = list.find(x => x.key === v); if (!g || !g.days.has(d)) st.closed.delete(k); }
    if (!list.length) { box.innerHTML = `<div class="rs-state">${esc(q ? `「${q}」에 맞는 입고가 없습니다.` : cat ? `그 기간에 ${cat} 입고가 없습니다.` : '그 기간에 입고가 없습니다.')}</div>`; return; }
    const tot = k => list.reduce((t, g) => t + g[k], 0), span = cfg.qty ? 6 : 5;
    box.innerHTML = `<div class="rs-acc-wrap"><table class="rs-acc rs-acc-${mode}" data-no-sort data-keep-cols><caption class="sr-only">${esc(`${data.from} ~ ${data.to} ${cfg.head}별 입고 · 줄을 누르거나 Enter로 펼침`)}</caption>
      <colgroup><col class="rs-c-v"><col class="rs-c-n">${cfg.qty ? '<col class="rs-c-q">' : ''}<col class="rs-c-m"><col class="rs-c-m"><col class="rs-c-m"></colgroup>
      <thead><tr><th>${cfg.head}</th><th class="r">입고건수</th>${cfg.qty ? '<th class="r">수량</th>' : ''}<th class="r">공급가액</th><th class="r">세액</th><th class="r">합계금액</th></tr></thead>
      <tbody>${list.map(g => { const open = st.open.has(g.key); return `<tr class="rs-v${open ? ' open' : ''}" data-rs-acc="${esc(g.key)}" tabindex="0" role="button" aria-expanded="${open}"><td>${CHEV}${cfg.cell(g)}</td><td class="r">${fmtNum(g.lines)}</td>${cfg.qty ? `<td class="r">${fmtNum(g.qty)} <span class="rs-unit">${esc(g.first.unit || '')}</span></td>` : ''}<td class="r">${won(g.supply)}</td><td class="r">${won(g.vat)}</td><td class="r"><b>${won(g.supply + g.vat)}</b></td></tr>${open ? `<tr class="rs-v-detail"><td colspan="${span}">${accBody(cfg, st, g)}</td></tr>` : ''}`; }).join('')}</tbody>
      <tfoot><tr><th>합계 · ${cfg.head} ${fmtNum(list.length)}${cfg.word}</th><td class="r">${fmtNum(tot('lines'))}</td>${cfg.qty ? '<td></td>' : ''}<td class="r">${won(tot('supply'))}</td><td class="r">${won(tot('vat'))}</td><td class="r"><b>${won(tot('supply') + tot('vat'))}</b></td></tr></tfoot></table></div>
      ${data.more ? '<p class="small muted">입고 줄이 많아 앞 3000줄만 보입니다. 기간을 좁히세요.</p>' : ''}${!cat && !q && data.freight.total ? `<p class="small muted">${esc(`운송비 ${won(data.freight.total)}원(전표 ${data.freight.bills}건)은 입고 줄이 아니라 위 「전체」 카드에만 더했습니다.`)}</p>` : ''}`;
  };
  const toggleAcc = el => {
    const v = el.closest('[data-rs-acc]'), d = el.closest('[data-rs-day]');
    if ((!v && !d) || !ACC[mode]) return false;
    const st = accState[mode]; let sel;
    if (v) { const k = v.dataset.rsAcc; st.open.has(k) ? st.open.delete(k) : st.open.add(k); sel = `[data-rs-acc="${CSS.escape(k)}"]`; }
    else { const k = d.dataset.rsDay; st.closed.has(k) ? st.closed.delete(k) : st.closed.add(k); sel = `[data-rs-day="${CSS.escape(k)}"]`; }
    drawAcc(); $(sel, main)?.focus({ preventScroll: true });
    return true;
  };
  const drawAll = () => { drawTabs(); drawSummary(); drawVendors(); drawLines(); drawDrill(); };
  const load = async () => {
    const v = formObj(form); if (!v.from || !v.to) return toast('기간을 고르세요.', 'err');
    loading = true; if (!data) drawDrill(); else $('#rsDrill', main).classList.add('is-loading');
    try { data = await api('GET', (SALES ? '/api/sales-delivery-status?' : '/api/purchase-receipt-status?') + new URLSearchParams({ from: v.from, to: v.to, vendor: v.vendor || '' })); } finally { loading = false; $('#rsDrill', main)?.classList.remove('is-loading'); }
    if (!main.isConnected) return;
    vendorFilter = '';
    if (cat && !cardCats().includes(cat)) cat = '';
    drawAll();
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  const setCat = c => { cat = c; try { localStorage.setItem(CAT_KEY, cat); } catch { /* 편의 */ } if (data) drawAll(); };
  main.addEventListener('change', e => {
    if (e.target.name === 'rs-mode') { mode = e.target.value; try { localStorage.setItem(VIEW_KEY, mode); } catch { /* 편의 */ } drawDrill(); }
    if (e.target.id === 'rsCat') setCat(e.target.value);
  });
  let qTimer = 0; // 통합 검색: 받아 온 입고 줄을 화면에서 거른다(서버 다시 조회 안 함)
  $('#rsQ', main).addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { q = e.target.value.trim().toLowerCase(); if (data) { drawTabs(); drawLines(); drawDrill(); } }, 200); });
  $('#rsQ', main).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(qTimer); q = e.target.value.trim().toLowerCase(); if (data) { drawTabs(); drawLines(); drawDrill(); } } });
  main.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-rs-acc]')) { e.preventDefault(); toggleAcc(e.target); }
  });
  main.addEventListener('click', e => {
    if (toggleAcc(e.target)) return;
    const t = e.target.closest('[data-rs-tab]'); if (t && data) { setCat(t.dataset.rsTab); return; }
    const v = e.target.closest('[data-rs-vendor]'); if (v && data) { vendorFilter = v.dataset.rsVendor; drawLines(); $('#rsLines', main).scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (e.target.closest('[data-rs-clear]')) { vendorFilter = ''; drawLines(); return; }
    const b = e.target.closest('[data-rs-bill]'); if (b) { try { sessionStorage.setItem(SALES ? 'wpa:sbill-customer' : 'wpa:bill-vendor', b.dataset.rsBill); } catch { /* 편의 */ } location.hash = SALES ? '#/sales/bills/new' : '#/purchase/bills/new'; }
  });
  // 엑셀: 지금 보고 있는 분류(전체면 모든 분류)의 줄
  $('[data-xlsx]', form).onclick = async () => {
    try {
      if (!data || data.from !== form.elements.from.value || data.to !== form.elements.to.value || (data.vendor || '') !== form.elements.vendor.value.trim()) await load();
      if (!data) return;
      const cats = shownCats().filter(c => !cat || c.category === cat);
      const lines = data.lines.filter(l => (!cat || l.category === cat) && qm(l)).map(l => [l.received_date, l.vendor, l.category, l.req_no || '', l.product_code || '', l.item, l.spec || '', l.lot || '', l.unit || '', l.qty, l.unit_price, l.confirmed, l.estimate, l.confirmed + l.estimate, RS_STATE[l.state][0] + (l.unpriced ? ' · 단가 없음' : '')]);
      const sum = i => lines.reduce((t, r) => t + (Number(r[i]) || 0), 0);
      xlsxDownload(TR(`입고현황_${cat || '전체'}_${data.from}_${data.to}${data.vendor ? '_' + data.vendor : ''}.xlsx`), { sheet: TR(`입고현황 ${cat || '전체'}`), titles: [TR(`입고현황 · ${cat || '전체'}`), `${COMPANY_NAME} · 입고일 ${data.from} ~ ${data.to}${data.vendor ? ' · 거래처 ' + data.vendor : ''}${q ? ' · 검색 ' + q : ''}`, `분류별 합계: ${cats.map(c => `${c.category} ${won(c.total)}`).join(' / ')}${!cat && data.freight.total ? ` / 운송비 ${won(data.freight.total)}` : ''}`],
        columns: [{ label: TR('입고일'), type: 'date' }, { label: '거래처', type: 'text', width: 18 }, { label: '분류', type: 'text', width: 9 }, { label: TR('구매의뢰번호'), type: 'text', width: 15 }, { label: '품목코드', type: 'text', width: 13 }, { label: '품목', type: 'text', width: 24 }, { label: '규격', type: 'text' }, { label: 'LOT', type: 'text', width: 14 }, { label: '단위', type: 'text', width: 7 }, { label: '수량', type: 'number', width: 10 }, { label: TR('발주 단가'), type: 'number', width: 12 }, { label: '확정(전표)', type: 'money', width: 14 }, { label: TR('미확정(발주 단가)'), type: 'money', width: 16 }, { label: '금액 합계', type: 'money', width: 14 }, { label: '전표', type: 'text', width: 16 }],
        rows: lines, totals: ['합계', '', '', '', '', '', '', '', '', sum(9), '', sum(11), sum(12), sum(13), ''] });
    } catch (error) { fail(error); }
  };
  await load();
}

// ── 15.131 전표 목록에서 체크 → 세금계산서 일괄 담기(매출) / 받은 계산서 등록(매입). 이미 담긴 전표는 체크칸이 잠겨 중복으로 못 담고, 서버도 다시 막는다.
function bulkPicks(main, getRows, side, reload) {
  const list = $('#billList', main), bar = $('#billBulk', main), btn = $('[data-bulk-tax]', bar);
  const picked = () => { const ids = new Set($$('[data-bulk-pick]:checked', list).map(x => Number(x.dataset.bulkPick))); return getRows().filter(r => ids.has(r.id)); };
  const party = r => side === 'sales' ? r.customer : r.vendor;
  const update = () => {
    const p = picked(), parties = new Set(p.map(r => nameKeyC(party(r))));
    $('[data-bulk-info]', bar).textContent = p.length ? `체크 ${p.length}장 · ${parties.size}곳 · 합계 ${won(p.reduce((t, r) => t + r.total, 0))}원` : '체크한 전표 없음';
    btn.disabled = !p.length;
    const all = $('[data-bulk-all]', list), boxes = $$('[data-bulk-pick]', list); if (all) { all.checked = boxes.length > 0 && boxes.every(x => x.checked); all.disabled = !boxes.length; }
  };
  list.addEventListener('change', e => {
    if (e.target.matches('[data-bulk-all]')) $$('[data-bulk-pick]', list).forEach(x => { x.checked = e.target.checked; });
    if (e.target.matches('[data-bulk-all], [data-bulk-pick]')) update();
  });
  new MutationObserver(update).observe(list, { childList: true });
  btn.onclick = () => (side === 'sales' ? bulkSalesTax : bulkPurchaseTax)(picked(), reload).catch(fail);
  update();
}
const nameKeyC = v => String(v ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
async function bulkSalesTax(bills, reload) {
  if (!bills.length) return;
  const parties = new Set(bills.map(b => nameKeyC(b.customer))).size;
  const v = await promptBox(`세금계산서 담기 · 전표 ${bills.length}장`, `<p>${esc(`${parties}곳 · 공급가액 ${won(bills.reduce((t, b) => t + b.supply_total, 0))}원 · 부가세 ${won(bills.reduce((t, b) => t + b.vat_total, 0))}원 · 합계 ${won(bills.reduce((t, b) => t + b.total, 0))}원`)}</p>
    <fieldset class="stack"><legend>담는 방식</legend>
      <label class="inline"><input type="radio" name="kind" value="single" checked> 건별 — 전표 1장마다 계산서 1장 (${bills.length}장)</label>
      <label class="inline"><input type="radio" name="kind" value="merge"> 거래처별 합산 — 거래처마다 1장 (${parties}장)</label></fieldset>
    <label>작성일자 <span class="hint">(비우면 건별은 전표 일자, 합산은 마지막 전표 일자)</span><input type="date" name="write_date"></label>
    <label>영수/청구<select name="charge"><option value="receipt">영수</option><option value="claim">청구</option></select></label>`);
  if (!v) return;
  try {
    const r = await api('POST', '/api/tax-invoices', { kind: v.kind === 'merge' ? 'merge' : 'single', bill_ids: bills.map(b => b.id), write_date: v.write_date || undefined, charge: v.charge, request_id: crypto.randomUUID() });
    toast(`세금계산서 ${r.rows.length}장을 담았습니다(발행 전). 「세금계산서 관리」에서 발행하세요.`);
  } catch (error) { fail(error); }
  await reload();
}
async function bulkPurchaseTax(bills, reload) {
  if (!bills.length) return;
  if (new Set(bills.map(b => nameKeyC(b.vendor))).size > 1) return toast('받은 세금계산서는 한 매입처씩 등록합니다. 한 매입처의 전표만 체크하세요.', 'err');
  const supply = bills.reduce((t, b) => t + b.supply_total, 0), vat = bills.reduce((t, b) => t + b.vat_total, 0), last = bills.map(b => b.bill_date).sort().pop();
  const v = await promptBox(`받은 세금계산서 등록 · ${bills[0].vendor}`, `<p>${esc(`전표 ${bills.length}장 · 공급가액 ${won(supply)}원 · 부가세 ${won(vat)}원 · 합계 ${won(supply + vat)}원`)}</p>
    <p class="small muted">${bills.map(b => esc(b.bill_no)).join(', ')}</p>
    <label>국세청 승인번호<input name="approval_no" maxlength="40" placeholder="예) 20261117-41000012-00000001"></label>
    <label>작성일자 *<input type="date" name="write_date" required value="${esc(last)}"></label>
    <label>비고<input name="note" maxlength="500"></label>`);
  if (!v) return;
  try {
    const r = await api('POST', '/api/purchase-tax-invoices', { vendor: bills[0].vendor, bill_ids: bills.map(b => b.id), approval_no: v.approval_no, write_date: v.write_date, note: v.note, request_id: crypto.randomUUID() });
    toast(`${r.invoice_no} 받은 세금계산서를 등록했습니다.`);
  } catch (error) { fail(error); }
  await reload();
}

// ── 15.140 반입(매출 반품)·반출(매입 반품) ──
const RET_SIDE = {
  in: { label: '반입', title: '반입전표', party: '거래처', type: 'sales', src: '납품목록', offset: '미수금 삭감', route: '#/sales/returns', role: 'sales', billOpen: id => api('GET', '/api/sales-bills/' + id).then(b => salesBillSheet(b)) },
  out: { label: '반출', title: '반출전표', party: '매입처', type: 'purchase', src: '매입목록', offset: '미지급 삭감', route: '#/purchase/returns', role: 'purchase', billOpen: id => api('GET', '/api/purchase-bills/' + id).then(b => billSheet(b)) },
};
const RET_PROCESS_LABEL = { stock_amount: '재고+금액', amount: '금액만', stock: '재고만', none: '처리 안 함' };
// 15.144 처리구분은 기존 ERP 이름 그대로(재고만은 예전 전표 보기용)
// 15.146 교환(다른 사이즈 등): 재고만 돌려받고 금액은 그대로 — 새로 내보내는 것은 출하·납품전표 0원으로
const RET_PROCESS = { in: { stock_amount: '재납품+금액삭감', amount: '금액삭감만', stock: '교환(재고만·금액 그대로)', none: '처리안함' }, out: { stock_amount: '재입고+금액삭감', amount: '금액삭감만', stock: '교환(재고만·금액 그대로)', none: '미처리' } };
const retProcessLabel = (side, p) => RET_PROCESS[side]?.[p] || RET_PROCESS_LABEL[p] || p;
const RET_REASONS = ['불량', '오배송·오발주', '수량 초과', '변심·취소', '기타'];
const retTabs = (side, list) => `<div class="seg class-tabs tax-side" role="tablist" aria-label="반입·반출">${(ME.is_admin || ME.roles.includes('sales')) ? `<a role="tab" href="#/sales/returns${list ? '' : '/new'}" class="${side === 'in' ? 'on' : ''}">반입 <span class="small muted">(거래처 → 우리)</span></a>` : ''}${(ME.is_admin || ME.roles.includes('purchase')) ? `<a role="tab" href="#/purchase/returns${list ? '' : '/new'}" class="${side === 'out' ? 'on' : ''}">반출 <span class="small muted">(우리 → 매입처)</span></a>` : ''}</div>`;
async function pageReturnEntry(main, side = 'in', editId = null) {
  const S = RET_SIDE[side];
  const editing = editId ? await api('GET', '/api/returns/' + editId) : null; // 15.147 고치기
  if (editing && editing.side !== side) { location.hash = `${RET_SIDE[editing.side].route}/edit`; return; }
  main.innerHTML = `<h1>${editing ? `${S.title} 수정 <span class="small muted">${esc(editing.return_no)}</span>` : `${S.title} 입력`}</h1>${editing ? '' : retTabs(side, false)}
  <p class="muted">${side === 'in' ? '거래처에서 돌아온 제품을 넣습니다. 「재고」를 처리하면 재고로 다시 들어오고, 「금액」을 처리하면 음수 매출전표가 생겨 미수금이 줄어듭니다(세금계산서 관리에서 수정 계산서로 담을 수 있음).' : '매입처로 돌려보내는 자재를 넣습니다. 「재고」를 처리하면 재고에서 빠지고, 「금액」을 처리하면 음수 매입전표가 생겨 미지급금이 줄어듭니다.'} 「${S.src}(F5)」에서 원래 전표 줄을 고르면 남은 수량까지만 넣을 수 있습니다.</p>
  <form class="stack bill-form ret-form" id="retForm" data-no-author novalidate>
    <div class="ret-head">
      <table class="erp-grid ret-head-main"><tbody>
        <tr><th>${S.label}일자 <b class="req">*</b></th><td><input name="return_date" type="date" required value="${todayStr()}" max="${todayStr()}" aria-label="${S.label}일자"></td>
          <th>처리구분</th><td><select name="process" aria-label="처리구분">${Object.entries(RET_PROCESS[side]).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></td>
          <th>입력자</th><td class="ret-who">${esc(ME.name)}</td></tr>
        <tr><th>${S.party} <b class="req">*</b></th><td colspan="3"><input name="party" required maxlength="100" autocomplete="off" placeholder="${S.party} 이름 또는 코드" aria-label="${S.party}"><span class="partner-hint small muted" data-partner-hint></span></td>
          <th>${side === 'in' ? '납품시' : '매입시'} 부가세</th><td><select name="tax_type" aria-label="부가세"><option value="taxable">별도 (10%)</option><option value="zero">영세·면세</option></select></td></tr>
        <tr><th>비 고</th><td colspan="5"><input name="note" maxlength="500" aria-label="비고"></td></tr>
      </tbody></table>
      <table class="erp-grid ret-settle-box"><tbody>
        <tr><th rowspan="2" class="ret-settle-title">금액<br>처리<br>방법</th><th>${S.label}총액</th><th><label class="inline"><input type="radio" name="settle" value="refund"> 현금환불</label></th><th><label class="inline"><input type="radio" name="settle" value="offset" checked> ${S.offset.replace(' ', '')}</label></th></tr>
        <tr><td class="r" data-ret-sum="total">0</td><td class="r" data-ret-sum="refund"></td><td class="r" data-ret-sum="offset">0</td></tr>
      </tbody></table>
    </div>
    <div class="ret-bar"><b class="ret-bar-title">${S.title} 입력</b><span class="small muted">${S.label}할 ${side === 'in' ? '제품' : '상품'} 고르기 ☞</span><button type="button" class="btn" data-ret-src>${S.src} (F5)</button><button type="button" class="btn" data-ret-all>전체 품목 (F6)</button><span class="ret-bar-count small muted" data-ret-count></span></div>
    <div data-ret-lines></div><div data-ret-total hidden></div>
    <div class="actions">${editing ? `<a class="btn" href="${S.route}">목록으로</a>` : ''}<button class="btn primary" data-ret-save>${editing ? `${S.label} 수정 저장` : `${S.label} 저장`}</button></div>
  </form>`;
  const form = $('#retForm', main), box = $('[data-ret-lines]', form), partyIn = form.elements.party;
  let lines = [], requestId = crypto.randomUUID(), busy = false, catalog = null;
  if (editing) { // 고치기: 머리·줄 채우기(원래 전표 줄은 남은 수량 + 이 전표 수량까지)
    form.elements.return_date.value = editing.return_date; form.elements.process.value = editing.process in RET_PROCESS[side] ? editing.process : 'stock_amount'; form.elements.tax_type.value = editing.tax_type; form.elements.note.value = editing.note || '';
    partyIn.value = editing.party; partyIn.readOnly = true; partyIn.title = '거래처는 바꿀 수 없습니다(취소 후 새로)';
    $$('[name=settle]', form).forEach(x => { x.checked = x.value === editing.settle; });
    const src = await api('GET', '/api/returns/sources?' + new URLSearchParams({ side, party: editing.party, months: 24 })).catch(() => ({ rows: [] }));
    lines = editing.lines.map(l => { const s0 = l.source_id ? src.rows.find(x => x.id === l.source_id) : null; return { source_id: l.source_id || undefined, bom_id: l.bom_id || undefined, item: l.item, product_code: l.product_code, spec: l.spec, unit: l.unit, qty: l.qty, unit_price: l.unit_price, reason: l.reason, lot: l.lot, left: l.source_id ? (s0 ? s0.left + l.qty : l.qty) : null, source_bill_no: s0?.bill_no || l.source_bill_no || '', source_date: s0?.date || l.source_date || '' }; });
  }
  bindPartnerPicker(partyIn, $('[data-partner-hint]', form), { type: S.type }).catch(() => {});
  const amountOn = () => ['stock_amount', 'amount'].includes(form.elements.process.value);
  const syncSettle = () => { $$('[name=settle]', form).forEach(x => { x.disabled = !amountOn(); }); $('.ret-settle-box', form).classList.toggle('off', !amountOn()); totals(); };
  const amt = l => Number(l.qty) > 0 && l.unit_price !== '' ? billTruncC(Number(l.qty) * Number(l.unit_price)) : 0;
  const draw = () => {
    const supply = lines.reduce((t, l) => t + amt(l), 0), vat = form.elements.tax_type.value === 'zero' ? 0 : billTruncC(supply * 0.1), qtySum = lines.reduce((t, l) => t + (Number(l.qty) || 0), 0);
    box.innerHTML = `<div class="table-wrap ret-lines-wrap"><table class="erp-grid ret-grid" data-keep-cols data-no-sort><thead><tr><th class="c">No</th><th>품목코드</th><th>품명</th><th>규격</th><th>단위</th><th class="r">수량</th><th class="r">단가</th><th class="r">금액</th><th>${S.label}유형</th><th>LOT</th><th>원래 전표</th><th></th></tr></thead><tbody>${lines.map((l, i) => `<tr><td class="c muted">${i + 1}</td>
      <td class="small">${esc(l.product_code || '')}</td><td data-card-primary><b>${esc(l.item)}</b></td><td>${esc(l.spec || '')}</td><td>${esc(l.unit || '')}</td>
      <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-r="qty" data-i="${i}" value="${esc(l.qty)}" aria-label="${esc(l.item)} 수량"${l.left != null ? ` max="${l.left}"` : ''}>${l.left != null ? `<div class="small muted">남은 ${fmtNum(l.left)}</div>` : ''}</td>
      <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-r="unit_price" data-i="${i}" value="${esc(l.unit_price)}" aria-label="${esc(l.item)} 단가"></td>
      <td class="r" data-r-amt="${i}">${won(amt(l))}</td>
      <td><select data-r="reason" data-i="${i}" aria-label="${esc(l.item)} ${S.label}유형"><option value="">선택</option>${RET_REASONS.map(x => `<option${x === l.reason ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><input data-r="lot" data-i="${i}" maxlength="100" value="${esc(l.lot || '')}" aria-label="${esc(l.item)} LOT"></td>
      <td class="small">${l.source_bill_no ? `${esc(l.source_bill_no)}<div class="muted">${esc(l.source_date || '')}</div>` : '<span class="muted">직접</span>'}</td>
      <td><button type="button" class="btn small danger" data-ret-del="${i}" aria-label="줄 삭제">×</button></td></tr>`).join('')}${Array.from({ length: Math.max(0, 6 - lines.length) }, (_, k) => `<tr class="ret-empty"><td class="c muted">${lines.length + k + 1}</td>${'<td></td>'.repeat(11)}</tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="5" class="ret-foot">공급가액</th><td class="r" data-ret-foot="qty">${fmtNum(qtySum)}</td><td></td><td class="r" data-ret-foot="supply">${won(supply)}</td><td colspan="4" rowspan="3" class="small muted ret-foot-hint">${lines.length ? '' : `「${S.src}(F5)」 또는 「전체 품목(F6)」으로 ${S.label}할 품목을 고르세요.`}</td></tr>
        <tr><th colspan="5" class="ret-foot">부 가 세</th><td></td><td></td><td class="r" data-ret-foot="vat">${won(vat)}</td></tr>
        <tr><th colspan="5" class="ret-foot">합계금액</th><td></td><td></td><td class="r" data-ret-foot="total"><b>${won(supply + vat)}</b></td></tr></tfoot></table></div>`;
    totals();
  };
  const totals = () => {
    const supply = lines.reduce((t, l) => t + amt(l), 0), vat = form.elements.tax_type.value === 'zero' ? 0 : billTruncC(supply * 0.1), total = supply + vat, refund = $('[name=settle]:checked', form)?.value === 'refund';
    const put = (sel, v) => { const el = $(sel, form); if (el) el.innerHTML = v; };
    put('[data-ret-foot="qty"]', fmtNum(lines.reduce((t, l) => t + (Number(l.qty) || 0), 0))); put('[data-ret-foot="supply"]', won(supply)); put('[data-ret-foot="vat"]', won(vat)); put('[data-ret-foot="total"]', `<b>${won(total)}</b>`);
    put('[data-ret-sum="total"]', `<b>${won(total)}</b>`); put('[data-ret-sum="refund"]', amountOn() && refund ? won(total) : ''); put('[data-ret-sum="offset"]', amountOn() && !refund ? won(total) : '');
    put('[data-ret-count]', lines.length ? `${lines.length}줄` : '');
    $('[data-ret-total]', form).innerHTML = lines.length ? `<div class="bill-sum"><span>${esc(`${lines.length}줄`)}</span><span>${esc(`공급가액 ${won(supply)}원`)}</span><span>${esc(`부가세 ${won(vat)}원`)}</span><span class="bill-grand">${esc(`${S.label} 합계 ${won(supply + vat)}원`)}</span></div>` : '';
  };
  form.elements.tax_type.onchange = totals;
  form.elements.process.onchange = syncSettle; $$('[name=settle]', form).forEach(x => { x.onchange = totals; });
  box.addEventListener('input', e => { const k = e.target.dataset.r; if (!k) return; const i = Number(e.target.dataset.i); lines[i][k] = e.target.value; if (k === 'qty' || k === 'unit_price') { $(`[data-r-amt="${i}"]`, box).textContent = won(amt(lines[i])); totals(); } });
  box.addEventListener('change', e => { const k = e.target.dataset.r; if (k) lines[Number(e.target.dataset.i)][k] = e.target.value; });
  box.addEventListener('click', e => { const d = e.target.closest('[data-ret-del]'); if (d) { lines.splice(Number(d.dataset.retDel), 1); draw(); } });
  const pickSources = async () => {
    const party = partyIn.value.trim(); if (!party) { partyIn.focus(); return toast(`${S.party}를 먼저 고르세요.`, 'err'); }
    let months = 6, data = null;
    const m = modal(`<h3>${esc(S.src)} · ${esc(party)}</h3><div class="toolbar"><label>기간<select data-rs-months>${[1, 3, 6, 12, 24].map(n => `<option value="${n}"${n === 6 ? ' selected' : ''}>${n}개월</option>`).join('')}</select></label><label class="grow">결과 내 찾기<input type="search" data-rs-q placeholder="품명·코드·전표번호·LOT"></label></div><div data-rs-list>불러오는 중…</div>
      <div class="actions"><button type="button" class="btn" data-close>닫기</button><button type="button" class="btn primary" data-rs-ok>체크한 줄 추가</button></div>`, { wide: true });
    const draw2 = () => {
      const q = searchKey($('[data-rs-q]', m.el).value), rows = data.rows.filter(r => !q || searchKey([r.item, r.product_code, r.bill_no, r.lot, r.spec].join(' ')).includes(q));
      $('[data-rs-list]', m.el).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th><input type="checkbox" data-rs-all aria-label="모두 고르기"></th><th>${side === 'in' ? '납품일자' : '매입일자'}</th><th>전표번호</th><th>품목코드</th><th>품명</th><th>규격</th><th class="r">수량</th><th class="r">반품됨</th><th class="r">남은</th><th class="r">단가</th><th>LOT</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.left <= 0 ? 'row-off' : ''}"><td>${r.left > 0 ? `<input type="checkbox" data-rs-pick="${r.id}" aria-label="${esc(r.item)} 고르기"${lines.some(l => l.source_id === r.id) ? ' disabled title="이미 담음"' : ''}>` : ''}</td><td class="nowrap">${esc(r.date)}</td><td class="small">${esc(r.bill_no)}</td><td class="small">${esc(r.product_code || '')}</td><td data-card-primary><b>${esc(r.item)}</b></td><td>${esc(r.spec || '')}</td><td class="r">${fmtNum(r.qty)} ${esc(r.unit || '')}</td><td class="r">${r.returned ? fmtNum(r.returned) : ''}</td><td class="r"><b>${fmtNum(r.left)}</b></td><td class="r">${won(r.unit_price)}</td><td class="small">${esc(r.lot || '')}</td></tr>`).join('')}</tbody></table></div>${data.more ? '<p class="small muted">500줄까지만 보입니다. 기간을 줄이세요.</p>' : ''}` : `<div class="empty">${months}개월 안에 ${esc(party)}와의 ${side === 'in' ? '매출(납품)' : '매입'} 전표 줄이 없습니다.</div>`;
      const all = $('[data-rs-all]', m.el); if (all) all.onchange = () => $$('[data-rs-pick]:not(:disabled)', m.el).forEach(x => { x.checked = all.checked; });
    };
    const load = async () => { data = await api('GET', '/api/returns/sources?' + new URLSearchParams({ side, party, months })); if (m.el.isConnected) draw2(); };
    $('[data-rs-months]', m.el).onchange = e => { months = Number(e.target.value); load().catch(fail); };
    $('[data-rs-q]', m.el).oninput = () => data && draw2();
    $('[data-close]', m.el).onclick = m.close;
    $('[data-rs-ok]', m.el).onclick = () => {
      const ids = $$('[data-rs-pick]:checked', m.el).map(x => Number(x.dataset.rsPick)); if (!ids.length) return toast('추가할 줄을 체크하세요.', 'err');
      for (const r of data.rows.filter(r => ids.includes(r.id))) lines.push({ source_id: r.id, item: r.item, product_code: r.product_code, spec: r.spec, unit: r.unit, qty: r.left, left: r.left, unit_price: r.unit_price, reason: '', lot: r.lot || '', source_bill_no: r.bill_no, source_date: r.date });
      m.close(); draw(); $$('[data-r="qty"]', box)[lines.length - ids.length]?.focus();
    };
    await load().catch(fail);
  };
  const pickAll = async () => {
    if (!catalog) catalog = await api('GET', '/api/boms').catch(error => { fail(error); return null; }); if (!catalog) return;
    const got = ((await openItemPicker(catalog, { title: `${S.label}할 품목`, filter: b => b.active !== 0 && !b.is_temp, multi: true, lots: false }))?.items || []).map(x => x.bom);
    if (!got.length) return;
    const tp = partyIn.value.trim() ? await tablePrices(S.type, partyIn.value.trim(), form.elements.return_date.value || todayStr()).catch(() => ({})) : {};
    for (const b of got) lines.push({ bom_id: b.id, item: b.product, product_code: b.product_code || '', spec: b.spec || '', unit: b.unit || '', qty: '', unit_price: tp[b.id]?.unit_price ?? '', reason: '', lot: '', left: null });
    draw(); $$('[data-r="qty"]', box)[lines.length - got.length]?.focus();
  };
  $('[data-ret-src]', form).onclick = () => pickSources().catch(fail);
  $('[data-ret-all]', form).onclick = () => pickAll().catch(fail);
  const keys = e => { if (!form.isConnected) return document.removeEventListener('keydown', keys); if ($('.modal-wrap')) return; if (e.key === 'F5') { e.preventDefault(); pickSources().catch(fail); } else if (e.key === 'F6') { e.preventDefault(); pickAll().catch(fail); } };
  document.addEventListener('keydown', keys);
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const v = formObj(form);
    if (!v.party) { partyIn.focus(); return toast(`${S.party}를 넣으세요.`, 'err'); }
    if (!lines.length) return toast(`${S.label}할 품목을 넣으세요.`, 'err');
    const bad1 = lines.findIndex(l => !(Number(l.qty) > 0) || (l.left != null && Number(l.qty) > l.left + 0.000001)); if (bad1 >= 0) { $$('[data-r="qty"]', box)[bad1]?.focus(); return toast(`${lines[bad1].item}: 수량을 확인하세요${lines[bad1].left != null ? `(남은 ${fmtNum(lines[bad1].left)}까지)` : ''}.`, 'err'); }
    if (amountOn() && !lines.some(l => amt(l) > 0)) return toast('금액을 처리하려면 단가를 넣으세요. 재고만 처리하려면 처리구분을 「재고만」으로 고르세요.', 'err');
    busy = true; const btn = $('[data-ret-save]', form); btn.disabled = true;
    try {
      const payload = { side, return_date: v.return_date, party: v.party, process: v.process, settle: v.settle || 'offset', tax_type: v.tax_type, note: v.note, request_id: requestId, lines: lines.map(l => ({ source_id: l.source_id || undefined, bom_id: l.bom_id || undefined, spec: l.spec, qty: l.qty, unit_price: l.unit_price, reason: l.reason, lot: l.lot })) };
      const r = editing ? await api('PUT', '/api/returns/' + editing.id, payload) : await api('POST', '/api/returns', payload);
      if (editing) { toast(`${r.return_no}을 고쳤습니다.`); location.hash = S.route; returnSheet(r); return; }
      toast(`${r.return_no} ${S.label}을 저장했습니다.${r.bill ? ` 금액 전표 ${r.bill.bill_no}` : ''}`);
      requestId = crypto.randomUUID(); lines = []; form.elements.note.value = ''; draw();
      returnSheet(r);
    } catch (error) { fail(error); } finally { busy = false; btn.disabled = false; }
  };
  draw(); syncSettle();
}
function returnSheet(r, after = null) {
  const S = RET_SIDE[r.side];
  const m = modal(`<h3 class="po-print-title">${S.title} <span class="small muted">${esc(r.return_no)}${r.status === 'cancelled' ? ' · 취소됨' : ''}</span></h3>
    <section class="cert po-doc">
      <div class="po-doc-head"><img src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><h2>${r.side === 'in' ? '반 입 전 표' : '반 출 전 표'}</h2></div>
      <table class="po-info"><tbody>
        <tr><th>전표번호</th><td><b>${esc(r.return_no)}</b>${r.status === 'cancelled' ? ' (취소)' : ''}</td><th>${S.label}일자</th><td>${esc(r.return_date)}</td></tr>
        <tr><th>${S.party}</th><td><b>${esc(r.party)}</b></td><th>처리구분</th><td>${retProcessLabel(r.side, r.process)}${['stock_amount', 'amount'].includes(r.process) ? ` · ${r.settle === 'refund' ? '현금 환불' : S.offset}` : ''}</td></tr>
        <tr><th>금액 전표</th><td>${r.bill ? `<button type="button" class="link-btn" data-ret-bill="${r.bill.id}">${esc(r.bill.bill_no)}</button>` : '—'}</td><th>작성</th><td>${esc(r.created_by)} · ${esc(String(r.created_at).slice(0, 16))}</td></tr>
        ${r.note ? `<tr><th>비고</th><td colspan="3">${esc(r.note)}</td></tr>` : ''}
        ${r.status === 'cancelled' ? `<tr><th>취소</th><td colspan="3">${esc(r.cancelled_by || '')} · ${esc(String(r.cancelled_at || '').slice(0, 16))} · ${esc(r.cancel_reason)}</td></tr>` : ''}
      </tbody></table>
      <table class="po-items"><thead><tr><th>No</th><th>품목</th><th>규격</th><th class="r">수량</th><th>단위</th><th class="r">단가</th><th class="r">공급가액</th><th>${S.label}유형</th><th>LOT</th><th>원래 전표</th></tr></thead>
      <tbody>${r.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.item)}${l.product_code ? `<div class="po-code">${esc(l.product_code)}</div>` : ''}</td><td>${esc(l.spec || '')}</td><td class="r">${fmtNum(l.qty)}</td><td>${esc(l.unit || '')}</td><td class="r">${won(l.unit_price)}</td><td class="r">${won(l.supply)}</td><td>${esc(l.reason || '')}</td><td>${esc(l.lot || '')}</td><td class="small">${esc(l.source_bill_no || '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="6" class="r">공급가액</th><td class="r">${won(r.supply_total)}</td><td colspan="3"></td></tr><tr><th colspan="6" class="r">부가세</th><td class="r">${won(r.vat_total)}</td><td colspan="3"></td></tr><tr><th colspan="6" class="r">합계</th><td class="r"><b>${won(r.total)}</b></td><td colspan="3"></td></tr></tfoot></table>
    </section>
    ${(r.changes || []).length ? `<div class="doc-changes small muted"><b>고친 이력</b> ${r.changes.map(c => `${esc(String(c.changed_at).slice(5, 16))} ${esc(c.changed_by)} · ${esc(c.summary)}`).join(' / ')}</div>` : ''}${r.invoiced ? `<p class="small muted">금액이 세금계산서에 담겨 있어 고칠 수 없습니다(계산서를 먼저 취소).</p>` : ''}
    <div class="actions"><button class="btn" data-close>닫기</button>${r.status === 'confirmed' && !r.invoiced ? `<button class="btn" data-ret-edit>수정</button>` : ''}${r.status === 'confirmed' ? `<button class="btn danger" data-ret-cancel>${S.label} 취소</button>` : ''}<button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`${S.title}_${r.return_no}`);
  $('[data-ret-bill]', m.el)?.addEventListener('click', e => S.billOpen(e.currentTarget.dataset.retBill).catch(fail));
  $('[data-ret-edit]', m.el)?.addEventListener('click', () => { try { sessionStorage.setItem('wpa:ret-edit', String(r.id)); } catch { /* 편의 */ } m.close(); location.hash = `${S.route}/edit`; });
  $('[data-ret-cancel]', m.el)?.addEventListener('click', async () => {
    const v = await promptBox(`${S.label} 취소 · ${r.return_no}`, `<p class="small muted">재고·금액 처리(금액 전표·환불)가 모두 되돌려집니다.</p><label>취소 사유 *<input name="reason" required maxlength="200"></label>`);
    if (!v) return;
    try { const x = await api('POST', `/api/returns/${r.id}/cancel`, v); toast('취소했습니다.'); m.close(); returnSheet(x, after); await after?.(); } catch (error) { fail(error); }
  });
}
async function pageReturnList(main, side = 'in') {
  const S = RET_SIDE[side];
  main.innerHTML = `<h1>${S.title} 목록</h1>${retTabs(side, true)}
  <form class="list-filters toolbar" data-read-only id="retFilters"><label>${S.label}일자<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label>${S.party}<input name="party" maxlength="100"></label><label>상태<select name="status"><option value="confirmed" selected>확정</option><option value="">전체(취소 포함)</option><option value="cancelled">취소만</option></select></label><label class="grow">검색<input type="search" name="q" placeholder="전표번호·거래처·비고"></label><button class="btn primary">조회</button><a class="btn" href="${S.route}/new">＋ ${S.label} 입력</a></form>
  <div id="retSum" class="counts"></div><div id="retList"></div>`;
  const form = $('#retFilters', main); let rows = [];
  bindPartnerPicker(form.elements.party, null, { type: S.type }).catch(() => {});
  const load = async () => {
    rows = (await api('GET', '/api/returns?' + new URLSearchParams({ side, ...formObj(form) }))).rows; if (!main.isConnected) return;
    const live = rows.filter(r => r.status === 'confirmed');
    $('#retSum', main).innerHTML = sumLine([['합계', `${fmtNum(live.length)}건`], ['공급가액', `${won(live.reduce((t, r) => t + r.supply_total, 0))}원`], ['부가세', `${won(live.reduce((t, r) => t + r.vat_total, 0))}원`], [`${S.label} 합계`, `<b>${won(live.reduce((t, r) => t + r.total, 0))}원</b>`]]);
    $('#retList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>전표번호</th><th>${S.label}일자</th><th>${S.party}</th><th>품목</th><th>처리구분</th><th>금액 처리</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th>금액 전표</th><th>상태</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.status === 'cancelled' ? 'row-off' : ''}"><td data-card-primary><button type="button" class="link-btn" data-ret-open="${r.id}">${esc(r.return_no)}</button></td><td>${esc(r.return_date)}</td><td>${esc(r.party)}</td><td>${esc(r.first_item || '')}${r.line_count > 1 ? ` 외 ${r.line_count - 1}` : ''}</td><td>${retProcessLabel(side, r.process)}</td><td>${['stock_amount', 'amount'].includes(r.process) ? (r.settle === 'refund' ? '현금 환불' : S.offset) : ''}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td class="small">${esc(r.bill_no || '')}</td><td>${r.status === 'confirmed' ? '<span class="chip green">확정</span>' : '<span class="chip">취소</span>'}</td><td><button class="btn small" data-ret-open="${r.id}">보기</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">조건에 맞는 ${S.label}이 없습니다.</div>`;
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('#retList', main).addEventListener('click', async e => { const b = e.target.closest('[data-ret-open]'); if (!b) return; try { returnSheet(await api('GET', '/api/returns/' + b.dataset.retOpen), () => load()); } catch (error) { fail(error); } });
  await load().catch(fail);
}

// ── 15.147 매출·매입전표 고치기 창: 일자·줄 단가·줄 비고·전표 비고(매입은 명세서 번호·합계·운송비). 수량·줄은 출하·입고와 묶여 그대로. ──
async function billEditWindow(side, bill, done) {
  const P = side === 'purchase';
  const v = await promptBox(`${P ? '매입' : '매출'}전표 수정 · ${bill.bill_no}`, `<p class="small muted">일자·단가·비고${P ? '·명세서·운송비' : ''}를 고칩니다. 수량은 ${P ? '입고' : '출하'}와 묶여 있어 바꿀 수 없습니다(바꾸려면 전표 취소 후 다시). <b>이월</b>은 일자만 다음 달로 바꾸면 됩니다 — ${P ? '입고' : '출고'} 기록·재고는 그대로이고 전표·세금계산서·마감 달만 옮겨집니다. 고친 내용은 이력으로 남습니다.</p>
    <div class="form-grid"><label>전표 일자 * <span class="hint">(다음 달로 이월하려면 일자만 다음 달로)</span><input type="date" name="bill_date" required value="${esc(bill.bill_date)}" max="${monthEnd(addDays(monthEnd(todayStr()), 1))}"></label>${P ? `<label>명세서 번호<input name="statement_no" maxlength="50" value="${esc(bill.statement_no || '')}"></label><label>명세서 합계<input type="number" name="statement_total" step="any" value="${bill.statement_total ?? ''}"></label><label>운송비<input type="number" name="freight" min="0" step="1" value="${bill.freight || 0}"></label>` : ''}<label class="span2">비고<input name="note" maxlength="500" value="${esc(bill.note || '')}"></label></div>
    <div class="table-wrap"><table class="erp-grid bill-edit-grid" data-keep-cols data-no-sort><thead><tr><th>품목</th><th>규격</th><th class="r">수량</th><th class="r">단가</th><th>줄 비고</th></tr></thead><tbody>${bill.lines.filter(l => l.active !== 0).map(l => `<tr><td><b>${esc(l.item)}</b></td><td>${esc(l.spec || '')}</td><td class="r">${fmtNum(l.qty)} ${esc(l.unit || '')}</td><td class="r"><input type="number" min="0" step="any" name="price_${l.id}" value="${l.unit_price}" aria-label="${esc(l.item)} 단가"></td><td><input name="note_${l.id}" maxlength="200" value="${esc(l.note || '')}" aria-label="${esc(l.item)} 줄 비고"></td></tr>`).join('')}</tbody></table></div>`,
    { wide: true, submit: async body => {
      const lines = bill.lines.filter(l => l.active !== 0).map(l => ({ id: l.id, unit_price: body['price_' + l.id], note: body['note_' + l.id] }));
      const out = { bill_date: body.bill_date, note: body.note, lines };
      if (P) Object.assign(out, { statement_no: body.statement_no, statement_total: body.statement_total, freight: body.freight });
      return api('PUT', `/api/${P ? 'purchase' : 'sales'}-bills/${bill.id}`, out);
    } });
  if (!v) return;
  toast('전표를 고쳤습니다.');
  await done?.(await api('GET', `/api/${P ? 'purchase' : 'sales'}-bills/${bill.id}`));
}
