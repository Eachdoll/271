// 매출전표·입금·기간별 거래보고·매출 마감(15.81). 영업이 물류가 잡은 출하 중 전표 없는 줄(또는 직접 입력 줄)에
// 단가를 넣어 매출전표를 만든다(원 미만 절사, 부가세 10% · 영세 0). 입금을 넣으면 거래처 원장에 잔액이 나온다.
// won·billTruncC는 bills.js, xlsxDownload·rangePresets는 xlsx.js.
const COMPANY_NAME = '(주)서울세미텍';

async function pageSalesBillEntry(main) {
  main.innerHTML = `<h1>매출전표 입력</h1>
  <p class="muted">거래처를 고르면 그 거래처 수주의 남은 수량(「수주 잔량」)과 물류가 잡은 출하 중 아직 전표가 없는 줄이 나옵니다. 수주 잔량은 이번에 보낼 수량만 넣어 나눠 잡을 수 있고(예: 100개 중 80개), 저장하면 물류에 출하지시가 내려갑니다. 전표에 넣을 줄을 체크하고 단가를 확인하세요(이 거래처에 마지막으로 판 단가가 미리 들어감). 출하 기록이 없는 품목·운반비 같은 줄은 「직접 줄 추가」로 넣습니다. 금액은 원 미만 절사, 부가세는 공급가액 합계의 10%입니다.</p>
  <form class="stack bill-form" data-no-author novalidate>
    <div class="form-grid">
      <label>거래처 *<input name="customer" required maxlength="100" placeholder="매출처에서 고르거나 입력" autocomplete="off"></label><span class="partner-hint small muted" data-partner-hint></span>
      <label>전표 일자 *<input name="bill_date" type="date" required value="${todayStr()}"></label>
      <label>과세 구분<select name="tax_type"><option value="taxable">과세 (부가세 10%)</option><option value="zero">영세·면세 (부가세 0)</option></select></label>
      <label>출하일 범위<span class="bill-range"><input name="from" type="date" aria-label="출하일 시작"> ~ <input name="to" type="date" aria-label="출하일 끝"></span></label>
      <label class="span2">비고<input name="note" maxlength="500"></label>
    </div>
    <section class="pr-section"><h3>수주 잔량</h3><div data-order-lines><p class="muted small">거래처를 넣으면 나옵니다.</p></div></section>
    <section class="pr-section"><h3>전표 없는 출하</h3><p class="small muted">물류가 직접 입력한 출하를 전표로 잡으려면: 거래처 선택 → 아래 출하 줄 체크 → 단가 확인 → 「매출전표 저장」. 출하일 범위가 비어 있으면 전체 기간에서 찾습니다. 이미 전표를 잡은 출하는 제외됩니다.</p><div data-bill-lines><p class="muted small">거래처를 넣으면 나옵니다.</p></div></section>
    <section class="pr-section"><h3>직접 입력 줄</h3><div data-manual-lines></div><div class="actions" style="justify-content:flex-start"><button type="button" class="btn small" data-manual-add>직접 줄 추가</button></div></section>
    <div class="bill-total card" data-bill-total aria-live="polite"></div>
    <div class="actions"><button class="btn primary" data-bill-save>매출전표 저장</button></div>
  </form>`;
  const form = $('form', main), box = $('[data-bill-lines]', form), manualBox = $('[data-manual-lines]', form), orderBox = $('[data-order-lines]', form);
  let orderPreset = null; try { orderPreset = Number(sessionStorage.getItem('wpa:sbill-order')) || null; sessionStorage.removeItem('wpa:sbill-order'); } catch { orderPreset = null; }
  let rows = [], orders = [], manual = [], loadedKey = null, requestId = crypto.randomUUID(), busy = false;
  const input = form.elements.customer;
  const load = async (force = false) => {
    const customer = (input.dataset.partnerPrev ?? input.value).trim(), key = [customer, form.elements.from.value, form.elements.to.value].join('|');
    if (!force && key === loadedKey) return; loadedKey = key;
    if (!customer) { rows = []; orders = []; box.innerHTML = orderBox.innerHTML = '<p class="muted small">거래처를 넣으면 나옵니다.</p>'; totals(); return; }
    box.innerHTML = orderBox.innerHTML = '<p class="muted small">불러오는 중…</p>';
    let data, open; try { [data, open] = await Promise.all([api('GET', '/api/sales-bills/unbilled?' + new URLSearchParams({ customer, from: form.elements.from.value, to: form.elements.to.value })), api('GET', '/api/sales-orders/open-lines?' + new URLSearchParams({ customer }))]); } catch (error) { box.innerHTML = orderBox.innerHTML = `<p class="field-error">${esc(error.message)}</p>`; return; }
    if ((input.dataset.partnerPrev ?? input.value).trim() !== customer || [form.elements.from.value, form.elements.to.value].join('|') !== key.split('|').slice(1).join('|')) return;
    rows = data.rows.map(r => ({ ...r, picked: false, price: r.table_price ?? r.last_price ?? r.order_price ?? '', note: '' }));
    orders = open.rows.map(r => ({ ...r, picked: orderPreset === r.order_id, take: String(r.remaining), price: r.unit_price ?? '', note: '' })); orderPreset = null;
    // 15.102 수주 줄을 고르면 전표의 과세 구분을 그 수주에 맞춘다(서버는 다르면 막음). 수주마다 다르면 고른 뒤에 맞춘다.
    const presetOrder = orders.find(o => o.picked); if (presetOrder && presetOrder.tax_type) { form.elements.tax_type.value = presetOrder.tax_type; }
    drawOrders(); draw();
    if (open.more) toast('수주 잔량 줄이 500개를 넘어 앞의 500줄만 보입니다.', 'err');
    if (data.more) toast('줄이 500개를 넘어 앞의 500줄만 보입니다. 출하일 범위로 좁히세요.', 'err');
  };
  const labelRows = root => { const heads = $$('thead th', root).map(th => th.textContent.trim()); $$('tbody tr', root).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = i === 0 && root !== manualBox ? '' : heads[i] || ''; })); };
  const draw = () => {
    box.innerHTML = rows.length ? `<div class="table-wrap"><table data-keep-cols class="grid bill-grid"><caption class="sr-only">전표 없는 출하</caption><thead><tr><th scope="col"><input type="checkbox" data-bill-all aria-label="전체 선택"></th><th scope="col">출하일</th><th scope="col">품목</th><th scope="col">규격</th><th scope="col">LOT</th><th scope="col" class="r">수량</th><th scope="col">단위</th><th scope="col" class="r">단가</th><th scope="col" class="r">공급가액</th><th scope="col">비고</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-bill-row="${i}" class="${r.picked ? 'bill-picked' : ''}">
        <td><input type="checkbox" data-bill-pick="${i}"${r.picked ? ' checked' : ''} aria-label="${esc(r.item)} ${esc(r.lot || '')} 선택"></td>
        <td class="nowrap">${esc(r.ship_date)}</td>
        <td data-card-primary><b>${esc(r.item)}</b>${r.product_code ? `<div class="small muted">${esc(r.product_code)}</div>` : ''}${r.ship_note ? `<div class="small muted">${esc(r.ship_note)}</div>` : ''}</td>
        <td>${esc(r.spec || '')}</td><td>${esc(r.lot || '')}</td>
        <td class="r">${fmtNum(r.qty)}</td><td>${esc(r.unit || '')}</td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-bill-price="${i}" value="${esc(r.price)}" aria-label="${esc(r.item)} 단가"${r.last_price == null ? ' placeholder="단가 없음"' : ''}></td>
        <td class="r nowrap" data-bill-supply="${i}">${r.price === '' ? '' : won(billTruncC(r.qty * Number(r.price)))}</td>
        <td><input data-bill-note="${i}" maxlength="200" value="${esc(r.note)}" aria-label="${esc(r.item)} 비고"></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">이 거래처의 전표 없는 출하가 없습니다.</p>';
    const all = $('[data-bill-all]', box); if (all) all.onchange = () => { rows.forEach(r => { r.picked = all.checked; }); draw(); };
    labelRows(box); totals();
  };
  // 수주 잔량(15.92): 이번에 보낼 수량(남은 수량까지)과 단가(수주 단가가 미리 들어감)
  const orderSupply = o => o.take === '' || o.price === '' ? null : billTruncC(Number(o.take) * Number(o.price));
  const drawOrders = () => {
    orderBox.innerHTML = orders.length ? `<div class="table-wrap"><table data-keep-cols class="grid bill-grid"><caption class="sr-only">수주 잔량</caption><thead><tr><th scope="col"><input type="checkbox" data-order-all aria-label="전체 선택"></th><th scope="col">수주</th><th scope="col">품목</th><th scope="col">규격</th><th scope="col" class="r">수주</th><th scope="col" class="r">잔량</th><th scope="col" class="r">이번 수량</th><th scope="col">단위</th><th scope="col" class="r">단가</th><th scope="col" class="r">공급가액</th><th scope="col">비고</th></tr></thead>
      <tbody>${orders.map((o, i) => `<tr data-order-row="${i}" class="${o.picked ? 'bill-picked' : ''}">
        <td><input type="checkbox" data-order-pick="${i}"${o.picked ? ' checked' : ''} aria-label="${esc(o.order_no)} ${esc(o.item)} 선택"></td>
        <td class="nowrap">${esc(o.order_no)}${o.tax_type === 'zero' ? ' <span class="chip">영세</span>' : ''}<div class="small muted">${esc(o.order_date)}${o.customer_po ? ' · ' + esc(o.customer_po) : ''}</div></td>
        <td data-card-primary><b>${esc(o.item)}</b>${o.product_code ? `<div class="small muted">${esc(o.product_code)}</div>` : ''}</td><td>${esc(o.spec || '')}</td>
        <td class="r">${fmtNum(o.qty)}</td><td class="r"><b>${fmtNum(o.remaining)}</b></td>
        <td class="r"><input type="number" min="0" max="${esc(o.remaining)}" step="any" inputmode="decimal" data-order-qty="${i}" value="${esc(o.take)}" aria-label="${esc(o.item)} 이번 수량"></td><td>${esc(o.unit || '')}</td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-order-price="${i}" value="${esc(o.price)}" aria-label="${esc(o.item)} 단가"${o.unit_price == null ? ' placeholder="단가 없음"' : ''}></td>
        <td class="r nowrap" data-order-supply="${i}">${orderSupply(o) == null ? '' : won(orderSupply(o))}</td>
        <td><input data-order-note="${i}" maxlength="200" value="${esc(o.note)}" aria-label="${esc(o.item)} 비고"></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">이 거래처의 남은 수주가 없습니다. <a href="#/sales/orders/new">수주 입력</a></p>';
    const all = $('[data-order-all]', orderBox); if (all) all.onchange = () => { orders.forEach(o => { o.picked = all.checked; }); drawOrders(); };
    labelRows(orderBox); totals();
  };
  const setOrderPick = (i, on) => { orders[i].picked = on; const c = $(`[data-order-pick="${i}"]`, orderBox); if (c) { c.checked = on; c.closest('tr').classList.toggle('bill-picked', on); }
    if (on && orders[i].tax_type && form.elements.tax_type.value !== orders[i].tax_type) { form.elements.tax_type.value = orders[i].tax_type; toast(`과세 구분을 수주 ${orders[i].order_no}에 맞춰 ${orders[i].tax_type === 'zero' ? '영세·면세' : '과세'}로 바꿨습니다.`); } };
  orderBox.addEventListener('change', e => { if (e.target.dataset.orderPick !== undefined) setOrderPick(Number(e.target.dataset.orderPick), e.target.checked); totals(); });
  orderBox.addEventListener('input', e => {
    const d = e.target.dataset;
    if (d.orderQty !== undefined || d.orderPrice !== undefined) {
      const i = Number(d.orderQty ?? d.orderPrice); orders[i][d.orderQty !== undefined ? 'take' : 'price'] = e.target.value;
      if (e.target.value !== '' && !orders[i].picked) setOrderPick(i, true);
      const v = orderSupply(orders[i]); $(`[data-order-supply="${i}"]`, orderBox).textContent = v == null ? '' : won(v);
    }
    if (d.orderNote !== undefined) orders[Number(d.orderNote)].note = e.target.value;
    totals();
  });
  orderBox.addEventListener('click', e => { const tr = e.target.closest('tr[data-order-row]'); if (!tr || e.target.closest('input,button,a')) return; const i = Number(tr.dataset.orderRow); setOrderPick(i, !orders[i].picked); totals(); });
  const drawManual = () => {
    manualBox.innerHTML = manual.length ? `<div class="table-wrap"><table data-keep-cols class="grid bill-grid"><caption class="sr-only">직접 입력 줄</caption><thead><tr><th scope="col">품목 *</th><th scope="col">규격</th><th scope="col" class="r">수량 *</th><th scope="col">단위</th><th scope="col" class="r">단가 *</th><th scope="col" class="r">공급가액</th><th scope="col">비고</th><th scope="col"><span class="sr-only">삭제</span></th></tr></thead>
      <tbody>${manual.map((m, i) => `<tr><td><input data-m="item" data-i="${i}" maxlength="200" value="${esc(m.item)}" aria-label="품목"></td><td><input data-m="spec" data-i="${i}" maxlength="100" value="${esc(m.spec)}" aria-label="규격"></td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-m="qty" data-i="${i}" value="${esc(m.qty)}" aria-label="수량"></td><td><input data-m="unit" data-i="${i}" maxlength="20" value="${esc(m.unit)}" aria-label="단위" class="rc-unit"></td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-m="price" data-i="${i}" value="${esc(m.price)}" aria-label="단가"></td><td class="r nowrap" data-m-supply="${i}">${m.qty !== '' && m.price !== '' ? won(billTruncC(Number(m.qty) * Number(m.price))) : ''}</td>
        <td><input data-m="note" data-i="${i}" maxlength="200" value="${esc(m.note)}" aria-label="비고"></td><td><button type="button" class="btn small" data-m-del="${i}">삭제</button></td></tr>`).join('')}</tbody></table></div>` : '';
    labelRows(manualBox); totals();
  };
  enterMovesInTable(box); enterMovesInTable(orderBox); enterMovesInTable(manualBox);
  $('[data-manual-add]', form).onclick = () => { manual.push({ item: '', spec: '', qty: '', unit: '', price: '', note: '' }); drawManual(); $$('[data-m="item"]', manualBox).at(-1)?.focus(); };
  manualBox.addEventListener('input', e => { const k = e.target.dataset.m; if (!k) return; const i = Number(e.target.dataset.i); manual[i][k] = e.target.value; if (k === 'qty' || k === 'price') $(`[data-m-supply="${i}"]`, manualBox).textContent = manual[i].qty !== '' && manual[i].price !== '' ? won(billTruncC(Number(manual[i].qty) * Number(manual[i].price))) : ''; totals(); });
  manualBox.addEventListener('click', e => { const d = e.target.closest('[data-m-del]'); if (d) { manual.splice(Number(d.dataset.mDel), 1); drawManual(); } });
  box.addEventListener('change', e => {
    if (e.target.dataset.billPick !== undefined) { const i = Number(e.target.dataset.billPick); rows[i].picked = e.target.checked; e.target.closest('tr').classList.toggle('bill-picked', rows[i].picked); }
    totals();
  });
  box.addEventListener('input', e => {
    if (e.target.dataset.billPrice !== undefined) { const i = Number(e.target.dataset.billPrice); rows[i].price = e.target.value; if (e.target.value !== '' && !rows[i].picked) { rows[i].picked = true; $(`[data-bill-pick="${i}"]`, box).checked = true; e.target.closest('tr').classList.add('bill-picked'); } $(`[data-bill-supply="${i}"]`, box).textContent = e.target.value === '' ? '' : won(billTruncC(rows[i].qty * Number(e.target.value))); }
    if (e.target.dataset.billNote !== undefined) rows[Number(e.target.dataset.billNote)].note = e.target.value;
    totals();
  });
  box.addEventListener('click', e => { const tr = e.target.closest('tr[data-bill-row]'); if (!tr || e.target.closest('input,button,a')) return; const i = Number(tr.dataset.billRow); rows[i].picked = !rows[i].picked; $(`[data-bill-pick="${i}"]`, box).checked = rows[i].picked; tr.classList.toggle('bill-picked', rows[i].picked); totals(); });
  const filledManual = () => manual.filter(m => m.item.trim() || m.qty !== '' || m.price !== '');
  const totals = () => {
    const picked = rows.filter(r => r.picked), extra = filledManual(), fromOrders = orders.filter(o => o.picked);
    const missing = picked.filter(r => r.price === '').length + extra.filter(m => m.price === '').length + fromOrders.filter(o => o.price === '').length;
    const supply = fromOrders.reduce((t, o) => t + (orderSupply(o) || 0), 0) + picked.reduce((t, r) => t + (r.price === '' ? 0 : billTruncC(r.qty * Number(r.price))), 0) + extra.reduce((t, m) => t + (m.qty === '' || m.price === '' ? 0 : billTruncC(Number(m.qty) * Number(m.price))), 0);
    const vat = form.elements.tax_type.value === 'zero' ? 0 : billTruncC(supply * 0.1);
    $('[data-bill-total]', form).innerHTML = `<div class="bill-sum"><span>${esc(`선택 ${picked.length + extra.length + fromOrders.length}줄`)}</span><span>${esc(`공급가액 ${won(supply)}원`)}</span><span>${esc(`부가세 ${won(vat)}원`)}</span><span class="bill-grand">${esc(`합계 ${won(supply + vat)}원`)}</span>${missing ? `<span class="chip yellow">${esc(`단가 없는 줄 ${missing}`)}</span>` : ''}</div>`;
  };
  form.elements.tax_type.onchange = totals;
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 400); });
  input.addEventListener('change', () => { clearTimeout(timer); load().catch(fail); });
  form.elements.from.onchange = form.elements.to.onchange = () => load().catch(fail);
  bindPartnerPicker(input, $('[data-partner-hint]', form), { type: 'sales' }).catch(() => {});
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const v = formObj(form), picked = rows.filter(r => r.picked), extra = filledManual(), fromOrders = orders.filter(o => o.picked);
    if (!v.customer) { input.focus(); return toast('거래처를 넣으세요.', 'err'); }
    if (!picked.length && !extra.length && !fromOrders.length) return toast('전표에 넣을 수주 잔량·출하 줄을 체크하거나 직접 줄을 넣으세요.', 'err');
    const badTake = fromOrders.find(o => !(Number(o.take) > 0) || Number(o.take) > o.remaining + 0.000001);
    if (badTake) { $(`[data-order-qty="${orders.indexOf(badTake)}"]`, orderBox)?.focus(); return toast(`${badTake.item}: 이번 수량은 0보다 크고 잔량 ${fmtNum(badTake.remaining)} 이하로 넣으세요.`, 'err'); }
    const noOrderPrice = fromOrders.find(o => o.price === ''); if (noOrderPrice) { $(`[data-order-price="${orders.indexOf(noOrderPrice)}"]`, orderBox)?.focus(); return toast(`${noOrderPrice.item}의 단가를 넣으세요.`, 'err'); }
    const missing = picked.find(r => r.price === ''); if (missing) { $(`[data-bill-price="${rows.indexOf(missing)}"]`, box)?.focus(); return toast(`${missing.item}의 단가를 넣으세요.`, 'err'); }
    const badManual = extra.find(m => !m.item.trim() || m.qty === '' || m.price === ''); if (badManual) return toast('직접 입력 줄의 품목·수량·단가를 넣으세요.', 'err');
    busy = true; const button = $('[data-bill-save]', form); button.disabled = true;
    try {
      const bill = await api('POST', '/api/sales-bills', { customer: v.customer, bill_date: v.bill_date, tax_type: v.tax_type, note: v.note, request_id: requestId,
        lines: [...fromOrders.map(o => ({ source_type: 'order', order_line_id: o.id, qty: o.take, unit_price: o.price, note: o.note })), ...picked.map(r => ({ source_type: 'ship', source_id: r.source_id, unit_price: r.price, note: r.note })), ...extra.map(m => ({ source_type: 'manual', item: m.item, spec: m.spec, qty: m.qty, unit: m.unit, unit_price: m.price, note: m.note }))] });
      toast(bill.duplicate ? `${bill.bill_no} 전표는 앞서 이미 저장되었습니다.` : `${bill.bill_no} 매출전표를 저장했습니다. 합계 ${won(bill.total)}원${fromOrders.length ? ` · 출하지시 ${fromOrders.length}건` : ''}`);
      requestId = crypto.randomUUID(); form.elements.note.value = ''; manual = []; drawManual();
      await load(true); salesBillSheet(bill, null, { onClose: () => { if (form.isConnected) input.focus(); } });
    } catch (error) { fail(error); } finally { busy = false; button.disabled = false; }
  };
  let preset = null; try { preset = sessionStorage.getItem('wpa:sbill-customer'); sessionStorage.removeItem('wpa:sbill-customer'); } catch { preset = null; }
  totals();
  if (preset) { input.value = preset; await load(true); }
}

function salesBillSheet(bill, after = null, { onClose = null } = {}) {
  const m = modal(`<h3 class="po-print-title">매출전표 <span class="small muted">${esc(bill.bill_no)}${bill.status === 'cancelled' ? ' · 취소됨' : ''}${bill.closed ? ' · 마감' : ''}</span></h3>
    <section class="cert po-doc bill-doc">
      <div class="po-doc-head"><img src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><h2>매 출 전 표</h2></div>
      <table class="po-info"><tbody>
        <tr><th>전표번호</th><td>${esc(bill.bill_no)}${bill.status === 'cancelled' ? ' (취소)' : ''}</td><th>전표 일자</th><td>${esc(bill.bill_date)}</td></tr>
        <tr><th>거래처</th><td><b>${esc(bill.customer)}</b></td><th>과세 구분</th><td>${bill.tax_type === 'zero' ? '영세·면세' : '과세 10%'}</td></tr>
        <tr><th>공급자</th><td>${COMPANY_NAME}</td><th>작성</th><td>${esc(bill.created_by)} · ${esc(String(bill.created_at).slice(0, 16))}</td></tr>
      </tbody></table>
      <table class="po-items"><thead><tr><th>No</th><th>출하일</th><th>품목</th><th>규격</th><th>LOT</th><th class="r">수량</th><th>단위</th><th class="r">단가</th><th class="r">공급가액</th><th class="r">세액</th><th>비고</th></tr></thead>
      <tbody>${bill.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(l.ship_date || '')}</td><td>${esc(l.item)}${l.product_code ? `<div class="po-code">${esc(l.product_code)}</div>` : ''}</td><td>${esc(l.spec)}</td><td>${esc(l.lot)}</td><td class="r">${fmtNum(l.qty)}</td><td>${esc(l.unit)}</td><td class="r">${fmtNum(l.unit_price)}</td><td class="r">${won(l.supply)}</td><td class="r">${won(l.vat)}</td><td>${esc(l.note)}${l.source_missing ? ' <b>(출하 삭제됨)</b>' : ''}${l.order_no ? `<div class="po-code">${esc(l.order_no)}${l.ship_status === 'pending' ? ' · 출하 대기' : l.ship_status === 'cancelled' ? ' · 지시 취소' : ''}</div>` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="8" class="r">합계</th><td class="r">${won(bill.supply_total)}</td><td class="r">${won(bill.vat_total)}</td><td class="nowrap"><b>${esc(`총액 ${won(bill.total)}원`)}</b></td></tr></tfoot></table>
      ${bill.note ? `<div class="po-memo"><b>비고</b><div class="po-memo-body">${esc(bill.note)}</div></div>` : ''}
      ${bill.status === 'cancelled' ? `<p><b>취소</b> ${esc(bill.cancelled_by || '')} · ${esc(String(bill.cancelled_at || '').slice(0, 16))} · ${esc(bill.cancel_reason)}</p>` : ''}
    </section>
    <div class="actions">${bill.invoice ? `<span class="small">세금계산서 ${taxChip(bill.invoice.status)} ${esc(bill.invoice.invoice_no)}</span>` : ''}<button class="btn" data-close>닫기</button>${bill.status === 'confirmed' ? '<button class="btn" data-bill-stmt>거래명세서</button>' : ''}${bill.status === 'confirmed' && !bill.invoice ? '<button class="btn" data-bill-tax>세금계산서 담기</button>' : ''}${bill.status === 'confirmed' && !bill.closed && !bill.invoice ? '<button class="btn danger" data-bill-cancel>전표 취소</button>' : ''}<button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true, onClose: () => onClose?.() });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`매출전표_${bill.bill_no}`);
  $('[data-bill-stmt]', m.el)?.addEventListener('click', () => statementSheet([bill]).catch(fail));
  // 건별 세금계산서 담기(로스제로 납품전표의 TAX 버튼처럼)
  $('[data-bill-tax]', m.el)?.addEventListener('click', async e => {
    const btn = e.currentTarget; if (btn.disabled) return; btn.disabled = true;
    try {
      const r = await api('POST', '/api/tax-invoices', { kind: 'single', bill_ids: [bill.id], request_id: crypto.randomUUID() });
      toast(`세금계산서 ${r.rows[0].invoice_no}에 담았습니다. 「세금계산서 관리」에서 발행하세요.`);
      m.close(); salesBillSheet(await api('GET', '/api/sales-bills/' + bill.id), after); await after?.();
    } catch (error) { fail(error); btn.disabled = false; }
  });
  const cancel = $('[data-bill-cancel]', m.el);
  if (cancel) cancel.onclick = async () => {
    const v = await promptBox('매출전표 취소', `<p class="small muted">${esc(bill.bill_no)}을(를) 취소하면 그 출하 줄은 다시 「전표 없는 출하」로, 수주에서 잡은 수량은 수주 잔량으로 돌아가고 출하 대기 중인 지시는 취소됩니다.</p><label>취소 사유 *<input name="reason" required maxlength="200"></label>`);
    if (!v) return;
    try { const r = await api('POST', `/api/sales-bills/${bill.id}/cancel`, v); toast('전표를 취소했습니다.'); m.close(); salesBillSheet(r, after); await after?.(); } catch (error) { fail(error); }
  };
}

// ── 15.112 거래명세서(거래처용): 공급자·공급받는자, 품목 줄, 공급가액·세액·합계(한글 금액), 전잔액·금회·입금·잔액, 입금 계좌.
// 매출전표 1장 또는 같은 거래처의 여러 전표를 한 장으로(기간 합산). 인쇄·PDF 저장은 매출전표와 같은 방식(rcPrint).
function koreanWon(n) {
  const v = Math.trunc(Math.abs(Number(n) || 0)); if (!v) return '영';
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], small = ['', '십', '백', '천'], big = ['', '만', '억', '조'];
  let out = '', s = String(v), group = 0;
  while (s.length) {
    const part = s.slice(-4); s = s.slice(0, -4);
    let words = ''; for (let i = 0; i < part.length; i++) { const d = Number(part[part.length - 1 - i]); if (d) words = (d === 1 && i ? '' : digits[d]) + small[i] + words; }
    if (words) out = words + big[group] + out; group++;
  }
  return out;
}
async function statementSheet(bills) {
  if (!bills.length) return toast('담을 매출전표가 없습니다.', 'err');
  const customer = bills[0].customer;
  if (bills.some(b => partnerKey(b.customer) !== partnerKey(customer))) return toast('거래명세서는 한 거래처의 전표만 묶을 수 있습니다.', 'err');
  const dates = bills.map(b => b.bill_date).sort(), from = dates[0], to = dates.at(-1);
  const [company, vendors, ledger] = await Promise.all([
    api('GET', '/api/tax-company').catch(() => ({})),
    api('GET', '/api/vendors?q=' + encodeURIComponent(customer)).catch(() => []),
    api('GET', '/api/sales-ledger?' + new URLSearchParams({ customer, from, to })).catch(() => null),
  ]);
  const buyer = (Array.isArray(vendors) ? vendors : []).find(v => partnerKey(v.name) === partnerKey(customer)) || { name: customer };
  const lines = bills.flatMap(b => b.lines.filter(l => l.active !== 0).map(l => ({ ...l, date: l.ship_date || b.bill_date, bill_no: b.bill_no })));
  const supply = bills.reduce((t, b) => t + b.supply_total, 0), vat = bills.reduce((t, b) => t + b.vat_total, 0), total = supply + vat;
  const md = d => String(d || '').slice(5).replace('-', '/');
  const party = (title, p) => `<table class="po-info stmt-party"><caption>${title}</caption><tbody>
    <tr><th>등록번호</th><td colspan="3"><b>${esc(p.biz_no || '')}</b></td></tr>
    <tr><th>상호</th><td>${esc(p.biz_name || p.name || '')}</td><th>대표</th><td>${esc(p.ceo || '')}</td></tr>
    <tr><th>주소</th><td colspan="3">${esc(p.address || '')}</td></tr>
    <tr><th>업태</th><td>${esc(p.biz_type || '')}</td><th>종목</th><td>${esc(p.biz_item || '')}</td></tr></tbody></table>`;
  const m = modal(`<h3 class="po-print-title">거래명세서 <span class="small muted">${esc(customer)} · ${esc(from === to ? from : `${from} ~ ${to}`)} · 전표 ${bills.length}장</span></h3>
    <section class="cert po-doc bill-doc stmt-doc">
      <div class="po-doc-head"><img src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><h2>거 래 명 세 서</h2></div>
      <p class="small stmt-sub">${esc(from === to ? `거래일 ${from}` : `거래기간 ${from} ~ ${to}`)} · 공급받는자 보관용</p>
      <div class="stmt-parties">${party('공급자', { ...company, name: company.biz_name || COMPANY_NAME })}${party('공급받는자', buyer)}</div>
      <p class="stmt-sum">합계금액 <b>일금 ${esc(koreanWon(total))}원정</b> <span>(₩${won(total)})</span> <span class="small muted">공급가액 ${won(supply)} + 세액 ${won(vat)}</span></p>
      <table class="po-items"><thead><tr><th>월/일</th><th>품목</th><th>규격</th><th class="r">수량</th><th>단위</th><th class="r">단가</th><th class="r">공급가액</th><th class="r">세액</th><th>비고</th></tr></thead>
      <tbody>${lines.map(l => `<tr><td class="c">${esc(md(l.date))}</td><td>${esc(l.item)}${l.product_code ? `<div class="po-code">${esc(l.product_code)}</div>` : ''}</td><td>${esc(l.spec || '')}</td><td class="r">${fmtNum(l.qty)}</td><td>${esc(l.unit || '')}</td><td class="r">${fmtNum(l.unit_price)}</td><td class="r">${won(l.supply)}</td><td class="r">${won(l.vat)}</td><td>${esc(l.lot ? `LOT ${l.lot}` : '')}${l.note ? `${l.lot ? ' · ' : ''}${esc(l.note)}` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="3" class="r">합계</th><td class="r">${esc(unitTotals(lines, l => l.qty, l => l.unit))}</td><td></td><td></td><td class="r">${won(supply)}</td><td class="r">${won(vat)}</td><td class="nowrap"><b>${esc(`${won(total)}원`)}</b></td></tr></tfoot></table>
      ${ledger ? `<table class="po-info stmt-balance"><tbody><tr><th>전잔액</th><td class="r">${won(ledger.totals.balance - total + ledger.totals.paid)}</td><th>금회 거래</th><td class="r">${won(total)}</td><th>입금</th><td class="r">${won(ledger.totals.paid)}</td><th>잔액(미수)</th><td class="r"><b>${won(ledger.totals.balance)}</b></td></tr></tbody></table>` : ''}
      ${company.bank ? `<p class="stmt-bank"><b>입금 계좌</b> ${esc(company.bank)}</p>` : ''}
      <p class="small muted">${esc(company.phone ? `문의 ${company.phone}${company.email ? ' · ' + company.email : ''}` : '')}</p>
      <div class="stmt-sign"><span>인수자</span><span class="stmt-sign-line"></span><span>(인)</span></div>
    </section>
    <div class="actions">${!company.biz_no ? '<span class="small red-text">우리 회사 사업자 정보가 비어 있습니다(세금계산서 관리 › 우리 회사 정보).</span>' : ''}<button class="btn" data-close>닫기</button><button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`거래명세서_${customer}_${from === to ? from : from + '_' + to}`);
}

// 전표 줄 엑셀(매입·매출 공통): 기간·거래처로 거른 확정 전표의 줄을 한 줄 한 행으로
async function billLinesExcel(side, { from, to, party }) {
  if (!from || !to) return toast('엑셀로 받을 기간(시작일·종료일)을 고르세요.', 'err');
  const data = await api('GET', '/api/bill-lines?' + new URLSearchParams({ side, from, to, party: party || '' }));
  if (!data.rows.length) return toast('그 기간에 확정 전표 줄이 없습니다.', 'err');
  const sales = side === 'sales', sum = k => data.rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const columns = [{ label: '전표번호', type: 'text', width: 15 }, { label: '전표 일자', type: 'date' }, { label: '거래처', type: 'text', width: 18 }, { label: '과세', type: 'text', width: 8 }, { label: sales ? '출하일' : '입고일', type: 'date' }, { label: '품목코드', type: 'text', width: 14 }, { label: '품목', type: 'text', width: 24 }, { label: '규격', type: 'text' }, { label: 'LOT', type: 'text', width: 14 }, { label: '단위', type: 'text', width: 7 }, { label: '수량', type: 'number', width: 10 }, { label: '단가', type: 'number', width: 12 }, { label: '공급가액', type: 'money', width: 14 }, ...(sales ? [{ label: '세액', type: 'money', width: 12 }, { label: '합계', type: 'money', width: 14 }] : []), { label: '비고', type: 'text', width: 20 }];
  const rows = data.rows.map(r => [r.bill_no, r.bill_date, r.party, r.tax_type === 'zero' ? '영세' : '과세', r.source_date, r.product_code, r.item, r.spec, r.lot, r.unit, r.qty, r.unit_price, r.supply, ...(sales ? [r.vat, r.supply + r.vat] : []), r.note]);
  const totals = ['합계', '', '', '', '', '', '', '', '', '', sum('qty'), '', sum('supply'), ...(sales ? [sum('vat'), sum('supply') + sum('vat')] : []), ''];
  xlsxDownload(`${sales ? '매출' : '매입'}전표_${from}_${to}${party ? '_' + party : ''}.xlsx`, { sheet: sales ? '매출전표' : '매입전표', titles: [`${sales ? '매출' : '매입'}전표 줄`, `${COMPANY_NAME} · 기간 ${from} ~ ${to}${party ? ' · 거래처 ' + party : ''}`], columns, rows, totals });
}

async function pageSalesBillList(main) {
  main.innerHTML = `<h1>매출전표 목록</h1>
  <form class="list-filters toolbar" data-read-only id="sbillFilters"><label>전표 일자<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label>거래처<input name="customer" maxlength="100"></label><label>상태<select name="status"><option value="">전체</option><option value="confirmed">확정</option><option value="cancelled">취소</option></select></label><label class="grow">검색<input type="search" name="q" placeholder="전표번호·거래처·비고·입력자"></label><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀 (줄별)</button><button type="button" class="btn" data-stmt title="고른 거래처의 조회 기간 확정 전표를 한 장으로">거래명세서 (기간 합산)</button></form>
  <div id="billSummary" class="counts"></div><div id="billList"></div><div class="actions"><button type="button" class="btn" id="billMore" hidden>더 보기</button></div>`;
  const form = $('#sbillFilters', main);
  $('[data-stmt]', form).onclick = async () => {
    const customer = form.elements.customer.value.trim(); if (!customer) { form.elements.customer.focus(); return toast('거래처를 고른 뒤 누르세요.', 'err'); }
    try {
      const list = await api('GET', '/api/sales-bills?' + new URLSearchParams({ customer, from: form.elements.from.value, to: form.elements.to.value, status: 'confirmed' }));
      if (!list.rows.length) return toast('그 기간에 이 거래처의 확정 전표가 없습니다.', 'err');
      if (list.rows.length > 60 || list.more) return toast('전표가 60장을 넘습니다. 기간을 좁히세요.', 'err');
      const bills = await Promise.all(list.rows.slice().reverse().map(r => api('GET', '/api/sales-bills/' + r.id)));
      await statementSheet(bills);
    } catch (error) { fail(error); }
  }; let rows = [], page = 0;
  bindPartnerPicker(form.elements.customer, null, { type: 'sales' }).catch(fail);
  const load = async (next = false) => {
    const data = await api('GET', '/api/sales-bills?' + new URLSearchParams({ ...formObj(form), page: next ? page + 1 : 0 }));
    if (!main.isConnected) return;
    rows = next ? rows.concat(data.rows) : data.rows; page = data.page; $('#billMore', main).hidden = !data.more;
    const live = rows.filter(r => r.status === 'confirmed');
    $('#billSummary', main).innerHTML = `<b>${esc(`${rows.length}건 · 확정 합계 ${won(live.reduce((t, r) => t + r.total, 0))}원 (공급가액 ${won(live.reduce((t, r) => t + r.supply_total, 0))} · 부가세 ${won(live.reduce((t, r) => t + r.vat_total, 0))})`)}</b>${data.more ? ' <span>(더 있음)</span>' : ''}`;
    $('#billList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid bill-list" data-no-sort><thead><tr><th>전표번호</th><th>전표 일자</th><th>거래처</th><th class="r">줄</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th>상태</th><th>세금계산서</th><th>입력</th><th></th></tr></thead>${billMonthBody(rows, 4, 4, r => { const inv = r.invoice ? r.invoice.split('|') : null; return `<tr class="${r.status === 'cancelled' ? 'row-off' : ''}"><td data-card-primary><button type="button" class="link-btn" data-bill-open="${r.id}">${esc(r.bill_no)}</button></td><td>${esc(r.bill_date)}</td><td>${esc(r.customer)}</td><td class="r">${fmtNum(r.line_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td>${r.status === 'confirmed' ? '<span class="chip green">확정</span>' : '<span class="chip">취소</span>'}</td><td>${inv ? `${taxChip(inv[1])}<div class="small muted">${esc(inv[0])}</div>` : r.status === 'confirmed' ? '<span class="small muted">안 담음</span>' : ''}</td><td class="small muted">${esc(r.created_by)}</td><td data-card-primary><button class="btn small" data-bill-open="${r.id}">보기</button></td></tr>`; })}</table></div>` : '<div class="empty">조건에 맞는 매출전표가 없습니다.</div>';
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('[data-xlsx]', form).onclick = () => billLinesExcel('sales', { from: form.elements.from.value, to: form.elements.to.value, party: form.elements.customer.value.trim() }).catch(fail);
  $('#billMore', main).onclick = () => load(true).catch(fail);
  $('#billList', main).addEventListener('click', async e => { const b = e.target.closest('[data-bill-open]'); if (!b) return; try { salesBillSheet(await api('GET', '/api/sales-bills/' + b.dataset.billOpen), () => load()); } catch (error) { fail(error); } });
  let preset = null; try { preset = JSON.parse(sessionStorage.getItem('wpa:sbill-filter') || 'null'); sessionStorage.removeItem('wpa:sbill-filter'); } catch { preset = null; }
  if (preset) for (const [k, v] of Object.entries(preset)) if (form.elements[k]) form.elements[k].value = v;
  await load();
}

const PAY_KIND = { payment: '입금', opening: '기초 미수금' };
// 15.110 입금확인(매출처에서 받은 돈)과 지급확인(매입처에 준 돈)은 같은 화면 구조. side: 'sales' | 'purchase'
const PAY_SIDE = {
  sales: { title: '입금확인', api: '/api/sales-payments', party: 'customer', type: 'sales', kinds: PAY_KIND, verb: '입금', ledger: '기간별 거래보고',
    help: '거래처에서 받은 돈을 넣으면 기간별 거래보고의 잔액에서 빠집니다. 프로그램을 쓰기 전부터 남아 있던 받을 돈은 「기초 미수금」으로 한 번 넣으세요(잔액에 더해짐).' },
  purchase: { title: '지급확인', api: '/api/purchase-payments', party: 'vendor', type: 'purchase', kinds: { payment: '지급', opening: '기초 미지급' }, verb: '지급', ledger: '매입처 원장',
    help: '매입처에 준 돈을 넣으면 매입처 원장의 잔액(줄 돈)에서 빠집니다. 프로그램을 쓰기 전부터 남아 있던 줄 돈은 「기초 미지급」으로 한 번 넣으세요(잔액에 더해짐).' },
};
async function pageSalesPayments(main) { return pagePayments(main, 'sales'); }
async function pagePayments(main, side) {
  const c = PAY_SIDE[side], party = c.party, kinds = c.kinds;
  main.innerHTML = `<h1>${esc(c.title)}</h1>
  <p class="muted">${esc(c.help)}</p>
  <form class="stack card" id="payForm" data-no-author novalidate>
    <div class="form-grid">
      <label>거래처 *<input name="${party}" required maxlength="100" autocomplete="off" placeholder="${side === 'sales' ? '매출처' : '매입처'}에서 고르거나 입력"></label><span class="partner-hint small muted" data-partner-hint></span>
      <label>날짜 *<input name="pay_date" type="date" required value="${todayStr()}"></label>
      <label>구분<select name="kind"><option value="payment">${esc(kinds.payment)}</option><option value="opening">${esc(kinds.opening)}</option></select></label>
      <label>금액 * <span class="hint">(원)</span><input name="amount" type="number" min="1" step="1" inputmode="numeric" required></label>
      <label>${esc(c.verb)} 계좌·방법<input name="method" maxlength="50" list="payMethods" placeholder="예) 기업은행"><datalist id="payMethods"></datalist></label>
      <label class="span2">비고<input name="note" maxlength="200"></label>
    </div>
    <div class="actions"><button class="btn primary">${esc(c.verb)} 저장</button></div>
  </form>
  <h2>${esc(c.verb)} 목록</h2>
  <form class="list-filters toolbar" data-read-only id="payFilters"><label>날짜<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label>거래처<input name="${party}" maxlength="100"></label><label>상태<select name="status"><option value="confirmed">확정</option><option value="">전체</option><option value="cancelled">취소</option></select></label><button class="btn primary">조회</button></form>
  <div id="paySummary" class="counts"></div><div id="payList"></div>`;
  const form = $('#payForm', main), filters = $('#payFilters', main); let requestId = crypto.randomUUID(), busy = false;
  bindPartnerPicker(filters.elements[party], null, { type: c.type }).catch(fail);
  bindPartnerPicker(form.elements[party], $('[data-partner-hint]', form), { type: c.type }).catch(() => {});
  const load = async () => {
    const data = await api('GET', c.api + '?' + new URLSearchParams(formObj(filters))); if (!main.isConnected) return;
    const methods = [...new Set(data.rows.map(r => r.method).filter(Boolean))].slice(0, 20); $('#payMethods', main).innerHTML = methods.map(m => `<option value="${esc(m)}">`).join('');
    const live = data.rows.filter(r => r.status === 'confirmed');
    $('#paySummary', main).innerHTML = `<b>${esc(`${data.rows.length}건 · ${c.verb} ${won(live.filter(r => r.kind === 'payment').reduce((t, r) => t + r.amount, 0))}원`)}</b>${data.more ? ' <span>(더 있음)</span>' : ''}`;
    $('#payList', main).innerHTML = data.rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>날짜</th><th>거래처</th><th>구분</th><th class="r">금액</th><th>${esc(c.verb)} 계좌·방법</th><th>비고</th><th>상태</th><th>입력</th><th></th></tr></thead><tbody>${data.rows.map(r => `<tr class="${r.status === 'cancelled' ? 'row-off' : ''}"><td>${esc(r.pay_date)}</td><td data-card-primary><b>${esc(r[party])}</b></td><td>${esc(kinds[r.kind])}</td><td class="r"><b>${won(r.amount)}</b></td><td>${esc(r.method)}</td><td>${esc(r.note)}${r.status === 'cancelled' ? `<div class="small muted">${esc(`취소: ${r.cancel_reason}`)}</div>` : ''}</td><td>${r.status === 'confirmed' ? '<span class="chip green">확정</span>' : '<span class="chip">취소</span>'}</td><td class="small muted">${esc(r.created_by)}</td><td>${r.status === 'confirmed' ? `<button class="btn small danger" data-pay-cancel="${r.id}">취소</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${esc(`조건에 맞는 ${c.verb}이 없습니다.`)}</div>`;
  };
  rangePresets(filters.elements.from, filters.elements.to, { onPick: () => load().catch(fail) });
  filters.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const v = formObj(form);
    if (!v[party]) { form.elements[party].focus(); return toast('거래처를 넣으세요.', 'err'); }
    if (!(Number(v.amount) > 0)) { form.elements.amount.focus(); return toast('금액을 넣으세요.', 'err'); }
    busy = true;
    try { const r = await api('POST', c.api, { ...v, request_id: requestId }); toast(r.duplicate ? `앞서 이미 저장된 ${c.verb}입니다.` : `${r[party]} ${kinds[r.kind]} ${won(r.amount)}원을 저장했습니다.`); requestId = crypto.randomUUID(); form.elements.amount.value = ''; form.elements.note.value = ''; await load(); }
    catch (error) { fail(error); } finally { busy = false; }
  };
  $('#payList', main).addEventListener('click', async e => {
    const b = e.target.closest('[data-pay-cancel]'); if (!b) return;
    const v = await promptBox(`${c.verb} 취소`, '<label>취소 사유 *<input name="reason" required maxlength="200"></label>'); if (!v) return;
    try { await api('POST', `${c.api}/${b.dataset.payCancel}/cancel`, v); toast(`${c.verb}을 취소했습니다.`); await load(); } catch (error) { fail(error); }
  });
  await load();
}

// 15.110 매입처 원장: 매입처를 고르면 기초 미지급 + 매입전표(전표 단위) − 지급 = 잔액(줄 돈), 비우면 매입처별 요약
async function pagePurchaseLedger(main) {
  const r0 = rpRange('year'), PK = PAY_SIDE.purchase.kinds;
  main.innerHTML = `<h1>매입처 원장</h1>
  <p class="muted">매입처를 고르면 그 기간의 매입전표·지급과 줄마다 잔액(줄 돈)을 봅니다. 비우면 매입처별 합계입니다. 지급은 「지급확인」에서 넣습니다.</p>
  <form class="list-filters toolbar" data-read-only id="pledgerForm"><label>매입처<input name="vendor" maxlength="100" autocomplete="off" placeholder="비우면 전체 요약"></label><label>시작일<input type="date" name="from" value="${r0.from}" required></label><label>종료일<input type="date" name="to" value="${r0.to}" required></label><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀</button><button type="button" class="btn" data-print>인쇄</button></form>
  <div id="pledgerHead" class="counts"></div><div id="pledger"></div>`;
  const form = $('#pledgerForm', main); let data = null;
  bindPartnerPicker(form.elements.vendor, null, { type: 'purchase' }).catch(() => {});
  const load = async () => {
    const v = formObj(form); if (!v.from || !v.to) return toast('기간을 고르세요.', 'err');
    data = await api('GET', '/api/purchase-ledger?' + new URLSearchParams(v)); if (!main.isConnected) return;
    const box = $('#pledger', main);
    if (!data.vendor) {
      const sum = k => data.rows.reduce((t, r) => t + (r[k] || 0), 0);
      $('#pledgerHead', main).innerHTML = `<b>${esc(`${data.from} ~ ${data.to} · 매입처 ${data.rows.length}곳 · 매입 ${won(sum('total'))}원 · 지급 ${won(sum('paid'))}원 · 미지급 ${won(sum('balance'))}원`)}</b>`;
      box.innerHTML = data.rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>매입처</th><th class="r">기초잔액</th><th class="r">전표</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">매입 합계</th><th class="r">지급</th><th class="r">잔액(미지급)</th><th></th></tr></thead><tbody>${data.rows.map(r => `<tr><td data-card-primary><b>${esc(r.vendor)}</b></td><td class="r">${won(r.opening)}</td><td class="r">${fmtNum(r.bills)}</td><td class="r">${won(r.supply)}</td><td class="r">${won(r.vat)}</td><td class="r">${won(r.total)}</td><td class="r">${won(r.paid)}</td><td class="r"><b>${won(r.balance)}</b></td><td><button class="btn small" data-pledger-open="${esc(r.vendor)}">원장</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><th>합계</th><td class="r">${won(sum('opening'))}</td><td class="r">${fmtNum(sum('bills'))}</td><td class="r">${won(sum('supply'))}</td><td class="r">${won(sum('vat'))}</td><td class="r">${won(sum('total'))}</td><td class="r">${won(sum('paid'))}</td><td class="r"><b>${won(sum('balance'))}</b></td><td></td></tr></tfoot></table></div>` : '<div class="empty">그 기간에 매입·지급이 없습니다.</div>';
      return;
    }
    $('#pledgerHead', main).innerHTML = `<b>${esc(`${data.vendor} · ${data.from} ~ ${data.to} · 기초잔액 ${won(data.opening)}원 · 매입 ${won(data.totals.purchase)}원 · 지급 ${won(data.totals.paid)}원 · 잔액 ${won(data.totals.balance)}원`)}</b>`;
    box.innerHTML = `<section class="cert ledger-doc"><h2 class="ledger-title">매입처 원장</h2><p class="small">${esc(COMPANY_NAME)} · 매입처 <b>${esc(data.vendor)}</b> · 보고기간 ${esc(data.from)} ~ ${esc(data.to)}</p>
      <div class="table-wrap"><table class="grid ledger-grid"><thead><tr><th>날짜</th><th>구분</th><th>전표번호</th><th>명세서 번호</th><th>적요/품목</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">매입금액</th><th class="r">지급액</th><th>지급 방법</th><th class="r">잔액</th></tr></thead>
      <tbody><tr class="row-off"><td></td><td>기초잔액</td><td colspan="8"></td><td class="r"><b>${won(data.opening)}</b></td></tr>${data.rows.map(r => `<tr class="${r.kind === 'payment' ? 'ledger-pay' : ''}"><td class="nowrap">${esc(r.date)}</td><td class="nowrap">${r.kind === 'purchase' ? '매입' : esc(PK[r.kind])}</td><td>${r.bill_no ? `<button type="button" class="link-btn" data-pledger-bill="${r.bill_id}">${esc(r.bill_no)}</button>` : ''}</td><td>${esc(r.statement_no || '')}</td><td data-card-primary>${esc(r.item)}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td class="r">${r.kind === 'purchase' ? won(r.supply) : ''}</td><td class="r">${r.kind === 'purchase' ? won(r.vat) : ''}</td><td class="r">${r.purchase ? won(r.purchase) : ''}</td><td class="r">${r.paid ? won(r.paid) : ''}</td><td>${esc(r.method || '')}</td><td class="r"><b>${won(r.balance)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="5">합계</th><td class="r">${won(data.totals.supply)}</td><td class="r">${won(data.totals.vat)}</td><td class="r">${won(data.totals.purchase)}</td><td class="r">${won(data.totals.paid)}</td><td></td><td class="r"><b>${won(data.totals.balance)}</b></td></tr></tfoot></table></div></section>`;
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('[data-print]', form).onclick = () => { if (!data?.vendor) return toast('인쇄할 매입처를 고르세요.', 'err'); const sec = $('.ledger-doc', main); const m = modal(`<div class="ledger-print"></div><div class="actions"><button class="btn" data-close>닫기</button><button class="btn primary" data-go>인쇄 · PDF 저장</button></div>`, { wide: true }); $('.ledger-print', m.el).append(sec.cloneNode(true)); m.el.parentElement.classList.add('lr-cert-wrap'); $('[data-close]', m.el).onclick = m.close; $('[data-go]', m.el).onclick = () => rcPrint(`매입처원장_${data.vendor}_${data.from}_${data.to}`); };
  $('[data-xlsx]', form).onclick = async () => {
    try {
      if (!data || data.from !== form.elements.from.value || data.to !== form.elements.to.value || (data.vendor || '') !== form.elements.vendor.value.trim()) await load();
      if (!data) return;
      if (!data.vendor) {
        const sum = k => data.rows.reduce((t, r) => t + (r[k] || 0), 0);
        return xlsxDownload(`매입처별_${data.from}_${data.to}.xlsx`, { sheet: '매입처별', titles: ['매입처별 매입·지급', `${COMPANY_NAME} · 보고기간 ${data.from} ~ ${data.to}`],
          columns: [{ label: '매입처', type: 'text', width: 22 }, { label: '기초잔액', type: 'money', width: 14 }, { label: '전표', type: 'number', width: 8 }, { label: '공급가액', type: 'money', width: 14 }, { label: '세액', type: 'money', width: 12 }, { label: '매입 합계', type: 'money', width: 14 }, { label: '지급', type: 'money', width: 14 }, { label: '잔액(미지급)', type: 'money', width: 14 }],
          rows: data.rows.map(r => [r.vendor, r.opening, r.bills, r.supply, r.vat, r.total, r.paid, r.balance]), totals: ['합계', sum('opening'), sum('bills'), sum('supply'), sum('vat'), sum('total'), sum('paid'), sum('balance')] });
      }
      xlsxDownload(`매입처원장_${data.vendor}_${data.from}_${data.to}.xlsx`, { sheet: '매입처 원장', titles: ['매입처 원장', `${COMPANY_NAME} · 매입처 ${data.vendor} · 보고기간 ${data.from} ~ ${data.to}`],
        columns: [{ label: '날짜', type: 'date' }, { label: '구분', type: 'text', width: 10 }, { label: '전표번호', type: 'text', width: 15 }, { label: '명세서 번호', type: 'text', width: 14 }, { label: '적요/품목', type: 'text', width: 26 }, { label: '공급가액', type: 'money', width: 13 }, { label: '세액', type: 'money', width: 12 }, { label: '매입금액', type: 'money', width: 13 }, { label: '지급액', type: 'money', width: 13 }, { label: '지급 방법', type: 'text', width: 12 }, { label: '잔액', type: 'money', width: 14 }, { label: '비고', type: 'text', width: 18 }],
        rows: [[data.from, '기초잔액', '', '', '', null, null, null, null, '', data.opening, ''], ...data.rows.map(r => [r.date, r.kind === 'purchase' ? '매입' : PK[r.kind], r.bill_no || '', r.statement_no || '', r.item, r.kind === 'purchase' ? r.supply : null, r.kind === 'purchase' ? r.vat : null, r.purchase || null, r.paid || null, r.method || '', r.balance, r.note || ''])],
        totals: ['합계', '', '', '', '', data.totals.supply, data.totals.vat, data.totals.purchase, data.totals.paid, '', data.totals.balance, ''] });
    } catch (error) { fail(error); }
  };
  $('#pledger', main).addEventListener('click', async e => {
    const open = e.target.closest('[data-pledger-open]'); if (open) { form.elements.vendor.value = open.dataset.pledgerOpen; await load().catch(fail); return; }
    const bill = e.target.closest('[data-pledger-bill]'); if (bill) { try { billSheet(await api('GET', '/api/purchase-bills/' + bill.dataset.pledgerBill), () => load()); } catch (error) { fail(error); } }
  });
  await load();
}

// 기간별 거래보고: 거래처를 고르면 원장(기초잔액·매출 줄·입금·잔액), 비우면 거래처별 요약
async function pageSalesLedger(main) {
  const r0 = rpRange('year');
  main.innerHTML = `<h1>기간별 거래보고</h1>
  <p class="muted">거래처를 고르면 그 기간의 매출(전표 줄)·입금과 줄마다 잔액을 봅니다. 비우면 거래처별 합계입니다. 「엑셀」은 한 값이 한 칸에 들어가고(병합 없음) 금액·수량은 숫자, 날짜는 날짜 칸이라 열을 골라 바로 합계·필터를 쓸 수 있습니다.</p>
  <form class="list-filters toolbar" data-read-only id="ledgerForm"><label>거래처<input name="customer" maxlength="100" autocomplete="off" placeholder="비우면 전체 요약"></label><label>시작일<input type="date" name="from" value="${r0.from}" required></label><label>종료일<input type="date" name="to" value="${r0.to}" required></label><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀</button><button type="button" class="btn" data-print>인쇄</button></form>
  <div id="ledgerHead" class="counts"></div><div id="ledger"></div>`;
  const form = $('#ledgerForm', main); let data = null;
  bindPartnerPicker(form.elements.customer, null /* 조회 줄에는 안내 글 없음(15.91: 글이 생기며 「조회」 버튼이 밀려 클릭이 빗나감) */, { type: 'sales' }).catch(() => {});
  const load = async () => {
    const v = formObj(form); if (!v.from || !v.to) return toast('기간을 고르세요.', 'err');
    data = await api('GET', '/api/sales-ledger?' + new URLSearchParams(v)); if (!main.isConnected) return;
    const box = $('#ledger', main);
    if (!data.customer) {
      const sum = k => data.rows.reduce((t, r) => t + (r[k] || 0), 0);
      $('#ledgerHead', main).innerHTML = `<b>${esc(`${data.from} ~ ${data.to} · 거래처 ${data.rows.length}곳 · 매출 ${won(sum('total'))}원 · 입금 ${won(sum('paid'))}원 · 잔액 ${won(sum('balance'))}원`)}</b>`;
      box.innerHTML = data.rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>거래처</th><th class="r">기초잔액</th><th class="r">전표</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">매출 합계</th><th class="r">입금</th><th class="r">잔액</th><th></th></tr></thead><tbody>${data.rows.map(r => `<tr><td data-card-primary><b>${esc(r.customer)}</b></td><td class="r">${won(r.opening)}</td><td class="r">${fmtNum(r.bills)}</td><td class="r">${won(r.supply)}</td><td class="r">${won(r.vat)}</td><td class="r">${won(r.total)}</td><td class="r">${won(r.paid)}</td><td class="r"><b>${won(r.balance)}</b></td><td><button class="btn small" data-ledger-open="${esc(r.customer)}">원장</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><th>합계</th><td class="r">${won(sum('opening'))}</td><td class="r">${fmtNum(sum('bills'))}</td><td class="r">${won(sum('supply'))}</td><td class="r">${won(sum('vat'))}</td><td class="r">${won(sum('total'))}</td><td class="r">${won(sum('paid'))}</td><td class="r"><b>${won(sum('balance'))}</b></td><td></td></tr></tfoot></table></div>` : '<div class="empty">그 기간에 매출·입금이 없습니다.</div>';
      return;
    }
    $('#ledgerHead', main).innerHTML = `<b>${esc(`${data.customer} · ${data.from} ~ ${data.to} · 기초잔액 ${won(data.opening)}원 · 매출 ${won(data.totals.sale)}원 · 입금 ${won(data.totals.paid)}원 · 잔액 ${won(data.totals.balance)}원`)}</b>`;
    box.innerHTML = `<section class="cert ledger-doc"><h2 class="ledger-title">기간별 거래보고</h2><p class="small">${esc(COMPANY_NAME)} · 거래처 <b>${esc(data.customer)}</b> · 보고기간 ${esc(data.from)} ~ ${esc(data.to)}</p>
      <div class="table-wrap"><table class="grid ledger-grid"><thead><tr><th>날짜</th><th>구분</th><th>적요/품목명</th><th>규격</th><th>단위</th><th class="r">수량</th><th class="r">단가</th><th class="r">금액</th><th class="r">세액</th><th class="r">거래금액</th><th class="r">결제액</th><th>결제 방법</th><th class="r">잔액</th></tr></thead>
      <tbody><tr class="row-off"><td></td><td>기초잔액</td><td colspan="10"></td><td class="r"><b>${won(data.opening)}</b></td></tr>${data.rows.map(r => `<tr class="${r.kind === 'payment' ? 'ledger-pay' : ''}"><td class="nowrap">${esc(r.date)}</td><td class="nowrap">${r.kind === 'sale' ? '매출' : PAY_KIND[r.kind]}</td><td data-card-primary>${esc(r.item)}${r.bill_no ? ` <button type="button" class="link small" data-ledger-bill="${r.bill_id}">${esc(r.bill_no)}</button>` : ''}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td>${esc(r.spec || '')}</td><td>${esc(r.unit || '')}</td><td class="r">${r.kind === 'sale' ? fmtNum(r.qty) : ''}</td><td class="r">${r.kind === 'sale' ? fmtNum(r.unit_price) : ''}</td><td class="r">${r.kind === 'sale' ? won(r.supply) : ''}</td><td class="r">${r.kind === 'sale' ? won(r.vat) : ''}</td><td class="r">${r.sale ? won(r.sale) : ''}</td><td class="r">${r.paid ? won(r.paid) : ''}</td><td>${esc(r.method || '')}</td><td class="r"><b>${won(r.balance)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="5">합계</th><td class="r">${esc(unitTotals(data.rows.filter(r => r.kind === 'sale'), r => r.qty, r => r.unit))}</td><td></td><td class="r">${won(data.totals.supply)}</td><td class="r">${won(data.totals.vat)}</td><td class="r">${won(data.totals.sale)}</td><td class="r">${won(data.totals.paid)}</td><td></td><td class="r"><b>${won(data.totals.balance)}</b></td></tr></tfoot></table></div></section>`;
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('[data-print]', form).onclick = () => { if (!data?.customer) return toast('인쇄할 거래처를 고르세요.', 'err'); const sec = $('.ledger-doc', main); const m = modal(`<div class="ledger-print"></div><div class="actions"><button class="btn" data-close>닫기</button><button class="btn primary" data-go>인쇄 · PDF 저장</button></div>`, { wide: true }); $('.ledger-print', m.el).append(sec.cloneNode(true)); m.el.parentElement.classList.add('lr-cert-wrap'); $('[data-close]', m.el).onclick = m.close; $('[data-go]', m.el).onclick = () => rcPrint(`거래보고_${data.customer}_${data.from}_${data.to}`); };
  $('[data-xlsx]', form).onclick = async () => {
    try {
      if (!data || data.from !== form.elements.from.value || data.to !== form.elements.to.value || (data.customer || '') !== form.elements.customer.value.trim()) await load();
      if (!data) return;
      if (!data.customer) {
        const sum = k => data.rows.reduce((t, r) => t + (r[k] || 0), 0);
        return xlsxDownload(`거래처별_매출_${data.from}_${data.to}.xlsx`, { sheet: '거래처별', titles: ['거래처별 매출·입금', `${COMPANY_NAME} · 보고기간 ${data.from} ~ ${data.to}`],
          columns: [{ label: '거래처', type: 'text', width: 22 }, { label: '기초잔액', type: 'money', width: 14 }, { label: '전표', type: 'number', width: 8 }, { label: '공급가액', type: 'money', width: 14 }, { label: '세액', type: 'money', width: 12 }, { label: '매출 합계', type: 'money', width: 14 }, { label: '입금', type: 'money', width: 14 }, { label: '잔액', type: 'money', width: 14 }],
          rows: data.rows.map(r => [r.customer, r.opening, r.bills, r.supply, r.vat, r.total, r.paid, r.balance]), totals: ['합계', sum('opening'), sum('bills'), sum('supply'), sum('vat'), sum('total'), sum('paid'), sum('balance')] });
      }
      xlsxDownload(`거래보고_${data.customer}_${data.from}_${data.to}.xlsx`, { sheet: '거래보고', titles: ['기간별 거래보고', `${COMPANY_NAME} · 거래처 ${data.customer} · 보고기간 ${data.from} ~ ${data.to}`],
        columns: [{ label: '날짜', type: 'date' }, { label: '구분', type: 'text', width: 10 }, { label: '전표번호', type: 'text', width: 15 }, { label: '품목코드', type: 'text', width: 14 }, { label: '적요/품목명', type: 'text', width: 26 }, { label: '규격', type: 'text' }, { label: '단위', type: 'text', width: 7 }, { label: '수량', type: 'number', width: 9 }, { label: '단가', type: 'number', width: 12 }, { label: '금액', type: 'money', width: 13 }, { label: '세액', type: 'money', width: 12 }, { label: '거래금액', type: 'money', width: 13 }, { label: '결제액', type: 'money', width: 13 }, { label: '결제 방법', type: 'text', width: 12 }, { label: '잔액', type: 'money', width: 14 }, { label: '비고', type: 'text', width: 18 }],
        rows: [[data.from, '기초잔액', '', '', '', '', '', null, null, null, null, null, null, '', data.opening, ''], ...data.rows.map(r => [r.date, r.kind === 'sale' ? '매출' : PAY_KIND[r.kind], r.bill_no || '', r.product_code || '', r.item, r.spec || '', r.unit || '', r.kind === 'sale' ? r.qty : null, r.kind === 'sale' ? r.unit_price : null, r.kind === 'sale' ? r.supply : null, r.kind === 'sale' ? r.vat : null, r.sale || null, r.paid || null, r.method || '', r.balance, r.note || ''])],
        totals: ['합계', '', '', '', '', '', '', data.totals.qty, '', data.totals.supply, data.totals.vat, data.totals.sale, data.totals.paid, '', data.totals.balance, ''] });
    } catch (error) { fail(error); }
  };
  $('#ledger', main).addEventListener('click', async e => {
    const open = e.target.closest('[data-ledger-open]'); if (open) { form.elements.customer.value = open.dataset.ledgerOpen; await load().catch(fail); return; }
    const bill = e.target.closest('[data-ledger-bill]'); if (bill) { try { salesBillSheet(await api('GET', '/api/sales-bills/' + bill.dataset.ledgerBill), () => load()); } catch (error) { fail(error); } }
  });
  let preset = null; try { preset = JSON.parse(sessionStorage.getItem('wpa:ledger') || 'null'); sessionStorage.removeItem('wpa:ledger'); } catch { preset = null; }
  if (preset) for (const [k, v] of Object.entries(preset)) if (form.elements[k]) form.elements[k].value = v;
  await load();
}

async function pageSalesClosing(main) {
  const prev = (() => { const d = new Date(todayStr() + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  main.innerHTML = `<h1>매출 마감</h1>
  <p class="muted">달별로 거래처마다 매출전표 합계와 입금, 아직 전표가 없는 출하를 봅니다. 확인이 끝나면 「마감」하세요. 마감한 달·거래처의 전표·입금은 새로 넣거나 취소할 수 없습니다(마감 취소는 관리자). 이번 달은 다음 달부터 마감할 수 있습니다.</p>
  <form class="toolbar" data-read-only id="closeForm"><label>마감 월<input type="month" name="period" value="${prev}" required></label><button class="btn primary">조회</button></form>
  <div id="closeList"></div><section id="closeOpen"></section>`;
  const form = $('#closeForm', main);
  const monthLast = period => { const [y, mo] = period.split('-').map(Number); return `${period}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
  const load = async () => {
    const data = await api('GET', '/api/sales-closing?period=' + form.elements.period.value); if (!main.isConnected) return;
    const sum = k => data.rows.reduce((t, r) => t + (r[k] || 0), 0);
    $('#closeList', main).innerHTML = data.rows.length ? `<div class="table-wrap"><table class="grid"><caption class="sr-only">${esc(`${data.period} 거래처별 매출`)}</caption><thead><tr><th>거래처</th><th class="r">전표</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th class="r">입금</th><th class="r">전표 없는 출하</th><th>마감</th><th></th></tr></thead><tbody>${data.rows.map(r => `<tr class="${r.closing ? 'row-green' : r.unbilled_lines ? 'row-yellow' : ''}"><td data-card-primary><b>${esc(r.customer)}</b></td><td class="r">${fmtNum(r.bill_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r" data-close-total><b>${won(r.total)}</b></td><td class="r">${won(r.payment_total)}</td><td class="r" data-close-open>${r.unbilled_lines ? `<span class="chip yellow">${esc(`${fmtNum(r.unbilled_lines)}줄`)}</span>` : '0'}</td><td>${r.closing ? `<span class="chip green">마감</span><div class="small muted">${esc(r.closing.closed_by)} · ${esc(String(r.closing.closed_at).slice(0, 16))}${r.closing.total !== r.total ? ` · <span class="red-text">마감 뒤 금액 변동</span>` : ''}</div>` : '<span class="chip">열림</span>'}</td>
      <td class="nowrap" data-card-primary>${r.bill_count ? `<button class="btn small" data-close-bills="${esc(r.customer)}">전표 보기</button> ` : ''}<button class="btn small" data-close-ledger="${esc(r.customer)}">원장</button> ${r.unbilled_lines && !r.closing ? `<button class="btn small" data-close-entry="${esc(r.customer)}">전표 입력</button> ` : ''}${r.closing ? (data.can_reopen ? `<button class="btn small danger" data-close-reopen="${esc(r.customer)}">마감 취소</button>` : '') : `<button class="btn small primary" data-close-do="${esc(r.customer)}">마감</button>`}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th><td class="r">${fmtNum(sum('bill_count'))}</td><td class="r">${won(sum('supply_total'))}</td><td class="r">${won(sum('vat_total'))}</td><td class="r"><b>${won(sum('total'))}</b></td><td class="r">${won(sum('payment_total'))}</td><td class="r">${esc(`${fmtNum(sum('unbilled_lines'))}줄`)}</td><td colspan="2"></td></tr></tfoot></table></div>` : `<div class="empty">${esc(`${data.period}에 매출전표나 출하가 없습니다.`)}</div>`;
    $('#closeOpen', main).innerHTML = data.unbilled.length ? `<h2>전표 없는 출하 <span class="small muted">${esc(`${data.from} ~ ${data.to} · ${fmtNum(data.unbilled.length)}줄`)}</span></h2><div class="table-wrap"><table class="grid"><thead><tr><th>출하일</th><th>거래처</th><th>품목</th><th>LOT</th><th class="r">수량</th><th class="r">지난 단가</th></tr></thead><tbody>${data.unbilled.map(r => `<tr><td>${esc(r.ship_date)}</td><td>${esc(r.customer)}</td><td data-card-primary><b>${esc(r.item)}</b>${r.spec ? ` <span class="small">${esc(r.spec)}</span>` : ''}</td><td>${esc(r.lot || '')}</td><td class="r">${fmtNum(r.qty)} ${esc(r.unit || '')}</td><td class="r">${r.last_price == null ? '<span class="muted">없음</span>' : fmtNum(r.last_price)}</td></tr>`).join('')}</tbody></table></div>` : '';
  };
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('#closeList', main).addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const period = form.elements.period.value;
    if (b.dataset.closeDo) {
      const row = b.closest('tr'), total = $('[data-close-total]', row).textContent, open = $('[data-close-open]', row).textContent.trim();
      if (!await confirmBox(`${b.dataset.closeDo}의 ${period} 매출을 마감할까요? 합계 ${total}원${open !== '0' ? ` · 전표 없는 출하 ${open}가 남아 있습니다` : ''}. 마감하면 그 달 전표·입금을 넣거나 취소할 수 없습니다.`)) return;
      try { await api('POST', '/api/sales-closing', { period, customer: b.dataset.closeDo }); toast('마감했습니다.'); await load(); } catch (error) { fail(error); }
    } else if (b.dataset.closeReopen) {
      if (!await confirmBox(`${b.dataset.closeReopen}의 ${period} 마감을 취소할까요?`)) return;
      try { await api('POST', '/api/sales-closing/reopen', { period, customer: b.dataset.closeReopen }); toast('마감을 취소했습니다.'); await load(); } catch (error) { fail(error); }
    } else if (b.dataset.closeBills) {
      try { sessionStorage.setItem('wpa:sbill-filter', JSON.stringify({ customer: b.dataset.closeBills, from: period + '-01', to: monthLast(period) })); } catch { /* 편의 */ }
      location.hash = '#/sales/bills';
    } else if (b.dataset.closeLedger) {
      try { sessionStorage.setItem('wpa:ledger', JSON.stringify({ customer: b.dataset.closeLedger, from: period + '-01', to: monthLast(period) })); } catch { /* 편의 */ }
      location.hash = '#/sales/ledger';
    } else if (b.dataset.closeEntry) {
      try { sessionStorage.setItem('wpa:sbill-customer', b.dataset.closeEntry); } catch { /* 편의 */ }
      location.hash = '#/sales/bills/new';
    }
  });
  await load();
}
