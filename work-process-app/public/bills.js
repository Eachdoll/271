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
        <td data-card-primary><b>${esc(r.item)}</b>${r.product_code ? `<div class="small muted">${esc(r.product_code)}</div>` : ''}${internalNoteChip(r)}</td>
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
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const v = formObj(form), picked = rows.filter(r => r.picked);
    if (!v.vendor) { vendorInput.focus(); return toast('거래처를 넣으세요.', 'err'); }
    if (!picked.length) return toast('전표에 넣을 입고 줄을 체크하세요.', 'err');
    const focusOn = (r, attr) => { if (!matches(r)) { find.value = ''; draw(); } $(`[${attr}="${rows.indexOf(r)}"]`, box)?.focus(); };
    const noQty = picked.find(r => !(Number(r.bqty) > 0)); if (noQty) { focusOn(noQty, 'data-bill-qty'); return toast(`${noQty.item}의 수량을 넣으세요.`, 'err'); }
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
      <tbody>${bill.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(l.received_date)}</td><td>${esc(l.item)}${l.product_code ? `<div class="po-code">${esc(l.product_code)}</div>` : ''}${l.req_no ? `<div class="po-code">${esc(l.req_no)}</div>` : ''}</td><td>${esc(l.spec)}</td><td>${esc(l.lot)}</td><td class="r">${fmtNum(l.qty)}${l.source_qty != null && l.source_qty !== l.qty ? `<div class="po-code">${esc(`입고 ${fmtNum(l.source_qty)}`)}</div>` : ''}</td><td>${esc(l.unit)}</td><td class="r">${fmtNum(l.unit_price)}</td><td class="r">${won(l.supply)}</td><td>${esc(l.note)}${l.source_voided ? ' <b>(입고 취소됨)</b>' : ''}</td></tr>`).join('')}</tbody>
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
  <form class="list-filters toolbar" data-read-only id="billFilters"><label>명세서 일자<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label>거래처<input name="vendor" maxlength="100"></label><label>상태<select name="status"><option value="">전체</option><option value="confirmed">확정</option><option value="cancelled">취소</option></select></label><label class="grow">검색<input type="search" name="q" placeholder="전표번호·거래처·명세서 번호·비고·입력자"></label><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀 (줄별)</button></form>
  <div id="billSummary" class="counts"></div><div id="billList"></div><div class="actions"><button type="button" class="btn" id="billMore" hidden>더 보기</button></div>`;
  const form = $('#billFilters', main); let rows = [], page = 0;
  const load = async (next = false) => {
    const data = await api('GET', '/api/purchase-bills?' + new URLSearchParams({ ...formObj(form), page: next ? page + 1 : 0 }));
    if (!main.isConnected) return;
    rows = next ? rows.concat(data.rows) : data.rows; page = data.page; $('#billMore', main).hidden = !data.more;
    const live = rows.filter(r => r.status === 'confirmed');
    $('#billSummary', main).innerHTML = `<b>${esc(`${rows.length}건 · 확정 합계 ${won(live.reduce((t, r) => t + r.total, 0))}원 (공급가액 ${won(live.reduce((t, r) => t + r.supply_total, 0))} · 부가세 ${won(live.reduce((t, r) => t + r.vat_total, 0))})`)}</b>${data.more ? ' <span>(더 있음)</span>' : ''}`;
    $('#billList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid bill-list" data-no-sort><thead><tr><th>전표번호</th><th>명세서 일자</th><th>거래처</th><th>명세서 번호</th><th class="r">줄</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th>상태</th><th>입력</th><th></th></tr></thead>${billMonthBody(rows, 5, 3, r => `<tr class="${r.status === 'cancelled' ? 'row-off' : ''}"><td data-card-primary><button type="button" class="link-btn" data-bill-open="${r.id}">${esc(r.bill_no)}</button></td><td>${esc(r.bill_date)}</td><td>${esc(r.vendor)}</td><td>${esc(r.statement_no || '')}</td><td class="r">${fmtNum(r.line_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b>${r.statement_total != null && r.statement_total !== r.total ? '<div class="small red-text">명세서 차이</div>' : ''}</td><td>${r.status === 'confirmed' ? '<span class="chip green">확정</span>' : '<span class="chip">취소</span>'}</td><td class="small muted">${esc(r.created_by)}</td><td data-card-primary><button class="btn small" data-bill-open="${r.id}">보기</button></td></tr>`)}</table></div>` : '<div class="empty">조건에 맞는 매입전표가 없습니다.</div>';
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

// 구매 › 입고현황(15.87): 매입 마감용. 입고일 기준 기간의 입고를 분류별·거래처별 금액으로 본다.
// 확정 = 매입전표 공급가액, 미확정 = 아직 전표 안 잡은 수량 × 발주 단가. 단가가 없는 줄(기타입고 등)은 「단가 없음」.
const RS_STATE = { billed: ['전표 완료', 'green'], partial: ['일부 전표', 'yellow'], open: ['전표 없음', ''], adjust: ['수량 수정', ''] };
async function pageReceiptStatus(main) {
  const r0 = rpRange('month');
  main.innerHTML = `<h1>입고현황</h1>
  <p class="muted">기간 안에 입고된 것을 분류(원자재·부자재·제품·상품·임가공)별·거래처별 금액으로 봅니다. 위의 분류 탭을 누르면 그 분류만 보이고, 「전체」는 분류별 합계를 함께 보여 줍니다. 매입전표를 잡은 수량은 전표 금액(확정), 아직 안 잡은 수량은 발주 단가로 계산한 금액(미확정)입니다. 매입 마감 전에 미확정·단가 없는 줄을 확인하세요.</p>
  <form class="list-filters toolbar" data-read-only id="rsForm"><label>입고일<input type="date" name="from" value="${r0.from}" required></label><label>~<input type="date" name="to" value="${r0.to}" required></label><label>거래처<input name="vendor" maxlength="100" autocomplete="off" placeholder="비우면 전체"></label><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀</button></form>
  <div class="seg class-tabs rs-tabs" id="rsTabs" role="tablist" aria-label="분류"></div>
  <div id="rsSummary"></div><h2 class="rs-h">거래처별</h2><div id="rsVendors"></div><h2 class="rs-h">입고 줄 <span class="small muted" id="rsCount"></span></h2><div id="rsVendorChip"></div><div id="rsLines"></div>`;
  const form = $('#rsForm', main);
  let data = null, vendorFilter = '', cat = '';
  try { cat = localStorage.getItem('wpa:rs-cat') || ''; } catch { cat = ''; }
  bindPartnerPicker(form.elements.vendor, null, { type: 'purchase' }).catch(() => {});
  const amount = n => n ? won(n) : '<span class="muted">0</span>';
  const label = c => c || '전체';
  // 15.96 거래가 있는 분류만(그 기간에 입고 줄이 있는 분류). 없는 분류는 탭·합계·거래처 칸에서 뺀다.
  const shownCats = () => data.categories.filter(c => c.lines);
  const labelRows = sel => { const heads = $$(`${sel} thead th`, main).map(th => th.textContent.trim()); $$(`${sel} tbody tr`, main).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = heads[i] || ''; })); };
  const drawTabs = () => {
    const total = shownCats().reduce((t, c) => t + c.total, 0) + data.freight.total;
    $('#rsTabs', main).innerHTML = [['', total], ...shownCats().map(c => [c.category, c.total])].map(([c, t]) => `<button type="button" role="tab" data-rs-tab="${esc(c)}" class="${c === cat ? 'on' : ''}" aria-selected="${c === cat}">${esc(label(c))} <span class="sub-count">${won(t)}</span></button>`).join('');
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
  const drawVendors = () => {
    const tools = v => `<td class="nowrap"><button type="button" class="btn small" data-rs-vendor="${esc(v.vendor)}">줄 보기</button>${(cat ? v.by[cat]?.open : v.open) ? ` <button type="button" class="btn small" data-rs-bill="${esc(v.vendor)}">전표 입력</button>` : ''}</td>`;
    if (cat) {
      const list = data.vendors.filter(v => v.by?.[cat]);
      const s = k => list.reduce((t, v) => t + v.by[cat][k], 0);
      $('#rsVendors', main).innerHTML = list.length ? `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="입고현황 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid rs-vendors"><thead><tr><th>거래처</th><th class="r">입고 줄</th><th class="r">확정(매입전표)</th><th class="r">미확정(발주 단가)</th><th class="r">합계</th><th class="r">전표 안 잡은 줄</th><th></th></tr></thead><tbody>${list.map(v => { const b = v.by[cat]; return `<tr><td data-card-primary><b>${esc(v.vendor)}</b></td><td class="r">${fmtNum(b.lines)}</td><td class="r">${amount(b.confirmed)}</td><td class="r">${b.unpriced ? `${amount(b.estimate)} <span class="chip yellow">${esc(`단가 없음 ${b.unpriced}`)}</span>` : amount(b.estimate)}</td><td class="r"><b>${won(b.confirmed + b.estimate)}</b></td><td class="r">${b.open ? `<span class="chip yellow">${fmtNum(b.open)}</span>` : '0'}</td>${tools(v)}</tr>`; }).join('')}</tbody>
        <tfoot><tr><th>합계</th><td class="r">${fmtNum(s('lines'))}</td><td class="r">${won(s('confirmed'))}</td><td class="r">${won(s('estimate'))}</td><td class="r"><b>${won(s('confirmed') + s('estimate'))}</b></td><td class="r">${fmtNum(s('open'))}</td><td></td></tr></tfoot></table></div>` : `<div class="empty">${esc(`그 기간에 ${cat} 입고가 없습니다.`)}</div>`;
      return labelRows('#rsVendors');
    }
    const vcats = shownCats().map(c => c.category);
    $('#rsVendors', main).innerHTML = data.vendors.length ? `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="입고현황 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid rs-vendors"><thead><tr><th>거래처</th>${vcats.map(c => `<th class="r">${esc(c)}</th>`).join('')}<th class="r">합계</th><th class="r">미확정</th><th></th></tr></thead><tbody>${data.vendors.map(v => `<tr><td data-card-primary><b>${esc(v.vendor)}</b></td>${vcats.map(c => `<td class="r">${v.by?.[c] ? amount(v.categories[c] || 0) : ''}</td>`).join('')}<td class="r"><b>${won(v.total)}</b></td><td class="r">${v.estimate ? won(v.estimate) : '0'}${v.unpriced ? ` <span class="chip yellow">${esc(`단가 없음 ${v.unpriced}`)}</span>` : ''}</td>${tools(v)}</tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th>${vcats.map(c => `<td class="r">${won(data.vendors.reduce((t, v) => t + (v.categories[c] || 0), 0))}</td>`).join('')}<td class="r"><b>${won(data.vendors.reduce((t, v) => t + v.total, 0))}</b></td><td class="r">${won(data.vendors.reduce((t, v) => t + v.estimate, 0))}</td><td></td></tr></tfoot></table></div>` : '<div class="empty">그 기간에 입고가 없습니다.</div>';
    labelRows('#rsVendors');
  };
  const visibleLines = () => data.lines.filter(l => (!cat || l.category === cat) && (!vendorFilter || l.vendor === vendorFilter));
  const drawLines = () => {
    const rows = visibleLines();
    $('#rsCount', main).textContent = `${rows.length}줄${data.more ? ' (앞 3000줄만)' : ''}`;
    $('#rsVendorChip', main).innerHTML = vendorFilter ? `<p class="small"><span class="chip">${esc(vendorFilter)}</span> <button type="button" class="btn small" data-rs-clear>거래처 거름 해제</button></p>` : '';
    $('#rsLines', main).innerHTML = rows.length ? `<div class="table-wrap dense-wrap" tabindex="0" role="region" aria-label="입고현황 표 · 좌우로 스크롤"><table class="grid keep-table dense-grid"><thead><tr><th>입고일</th><th>거래처</th>${cat ? '' : '<th>분류</th>'}<th>품목</th><th>규격</th><th>LOT</th><th class="r">수량</th><th>단위</th><th class="r">발주 단가</th><th class="r">확정(전표)</th><th class="r">미확정</th><th>전표</th></tr></thead><tbody>${rows.map(l => `<tr class="${l.unpriced ? 'row-yellow' : ''}"><td class="nowrap">${esc(l.received_date)}</td><td>${esc(l.vendor)}</td>${cat ? '' : `<td>${esc(l.category)}</td>`}<td data-card-primary><b>${esc(l.item)}</b>${l.product_code ? `<div class="small muted">${esc(l.product_code)}</div>` : ''}</td><td>${esc(l.spec || '')}</td><td>${esc(l.lot || '')}</td><td class="r">${fmtNum(l.qty)}</td><td>${esc(l.unit || '')}</td><td class="r">${l.unit_price == null ? '<span class="muted">없음</span>' : fmtNum(l.unit_price)}</td><td class="r">${amount(l.confirmed)}</td><td class="r">${l.unpriced ? '<span class="chip yellow">단가 없음</span>' : amount(l.estimate)}</td><td>${(([t, c]) => `<span class="chip ${c}">${t}</span>`)(RS_STATE[l.state])}${l.state === 'partial' ? `<div class="small muted">${esc(`남음 ${fmtNum(l.remaining)}`)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 입고가 없습니다.</div>';
    labelRows('#rsLines');
  };
  const drawAll = () => { drawTabs(); drawSummary(); drawVendors(); drawLines(); };
  const load = async () => {
    const v = formObj(form); if (!v.from || !v.to) return toast('기간을 고르세요.', 'err');
    data = await api('GET', '/api/purchase-receipt-status?' + new URLSearchParams(v)); if (!main.isConnected) return;
    vendorFilter = '';
    if (cat && !shownCats().some(c => c.category === cat)) cat = '';
    drawAll();
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-rs-tab]'); if (t && data) { cat = t.dataset.rsTab; try { localStorage.setItem('wpa:rs-cat', cat); } catch { /* 편의 */ } drawAll(); return; }
    const v = e.target.closest('[data-rs-vendor]'); if (v && data) { vendorFilter = v.dataset.rsVendor; drawLines(); $('#rsLines', main).scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (e.target.closest('[data-rs-clear]')) { vendorFilter = ''; drawLines(); return; }
    const b = e.target.closest('[data-rs-bill]'); if (b) { try { sessionStorage.setItem('wpa:bill-vendor', b.dataset.rsBill); } catch { /* 편의 */ } location.hash = '#/purchase/bills/new'; }
  });
  // 엑셀: 지금 보고 있는 분류(전체면 모든 분류)의 줄
  $('[data-xlsx]', form).onclick = async () => {
    try {
      if (!data || data.from !== form.elements.from.value || data.to !== form.elements.to.value || (data.vendor || '') !== form.elements.vendor.value.trim()) await load();
      if (!data) return;
      const cats = shownCats().filter(c => !cat || c.category === cat);
      const lines = data.lines.filter(l => !cat || l.category === cat).map(l => [l.received_date, l.vendor, l.category, l.req_no || '', l.product_code || '', l.item, l.spec || '', l.lot || '', l.unit || '', l.qty, l.unit_price, l.confirmed, l.estimate, l.confirmed + l.estimate, RS_STATE[l.state][0] + (l.unpriced ? ' · 단가 없음' : '')]);
      const sum = i => lines.reduce((t, r) => t + (Number(r[i]) || 0), 0);
      xlsxDownload(`입고현황_${cat || '전체'}_${data.from}_${data.to}${data.vendor ? '_' + data.vendor : ''}.xlsx`, { sheet: `입고현황 ${cat || '전체'}`, titles: [`입고현황 · ${cat || '전체'}`, `${COMPANY_NAME} · 입고일 ${data.from} ~ ${data.to}${data.vendor ? ' · 거래처 ' + data.vendor : ''}`, `분류별 합계: ${cats.map(c => `${c.category} ${won(c.total)}`).join(' / ')}${!cat && data.freight.total ? ` / 운송비 ${won(data.freight.total)}` : ''}`],
        columns: [{ label: '입고일', type: 'date' }, { label: '거래처', type: 'text', width: 18 }, { label: '분류', type: 'text', width: 9 }, { label: '구매의뢰번호', type: 'text', width: 15 }, { label: '품목코드', type: 'text', width: 13 }, { label: '품목', type: 'text', width: 24 }, { label: '규격', type: 'text' }, { label: 'LOT', type: 'text', width: 14 }, { label: '단위', type: 'text', width: 7 }, { label: '수량', type: 'number', width: 10 }, { label: '발주 단가', type: 'number', width: 12 }, { label: '확정(전표)', type: 'money', width: 14 }, { label: '미확정(발주 단가)', type: 'money', width: 16 }, { label: '금액 합계', type: 'money', width: 14 }, { label: '전표', type: 'text', width: 16 }],
        rows: lines, totals: ['합계', '', '', '', '', '', '', '', '', sum(9), '', sum(11), sum(12), sum(13), ''] });
    } catch (error) { fail(error); }
  };
  await load();
}
