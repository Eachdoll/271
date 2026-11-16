// 수주(15.92). 고객 주문을 거래처(코드)·품목으로 받아 두고, 매출전표 입력에서 수주 줄의 남은 수량을 나눠 전표로 잡는다
// (예: 100개 수주 → 1일 80개 전표, 2일 20개 전표). 전표를 잡으면 물류에 출하지시가 내려가고, 물류가 「출하 처리」하면
// 출하(재고 차감)가 만들어지며 전표 줄이 그 출하로 이어진다. won·billTruncC는 bills.js, salesBillSheet는 sales-bills.js.
const SO_STATE = { waiting: ['대기', ''], partial: ['일부 전표', 'yellow'], done: ['전표 완료', 'green'], closed: ['마감', ''], cancelled: ['취소', ''] };
const soChip = s => { const [label, cls] = SO_STATE[s] || [s, '']; return `<span class="chip ${cls}">${esc(label)}</span>`; };
const SHIP_STATE = { pending: ['출하 대기', 'yellow'], held: ['보류', 'red'], shipped: ['출하 완료', 'green'], cancelled: ['지시 취소', ''] };
const shipChip = s => { const [label, cls] = SHIP_STATE[s] || [s || '', '']; return label ? `<span class="chip ${cls}">${esc(label)}</span>` : ''; };

async function pageSalesOrderEntry(main, editId = null) {
  const editing = editId ? await api('GET', '/api/sales-orders/' + editId) : null;
  if (!main.isConnected) return;
  main.innerHTML = `<h1>${editing ? `수주 고치기 <span class="small muted">${esc(editing.order_no)}</span>` : '수주 입력'}</h1>
  <p class="muted">고객 주문(수주의뢰)을 받으면 거래처(이름 또는 거래처코드)를 고르고 품목을 넣어 저장합니다. 매출전표 입력의 「수주 잔량」에서 남은 수량만큼 나눠 전표를 잡을 수 있고, 전표를 잡으면 물류에 출하지시가 내려갑니다.</p>
  <form class="stack bill-form" data-no-author novalidate>
    <div class="form-grid">
      <label>거래처 *<input name="customer" required maxlength="100" placeholder="거래처 이름 또는 코드" autocomplete="off" value="${esc(editing?.customer || '')}"></label><span class="partner-hint small muted" data-partner-hint></span>
      <label>수주일 *<input name="order_date" type="date" required value="${esc(editing?.order_date || todayStr())}"></label>
      <label>납기<input name="due_date" type="date" value="${esc(editing?.due_date || '')}"></label>
      <label>고객 발주번호<input name="customer_po" maxlength="50" value="${esc(editing?.customer_po || '')}" placeholder="고객사 주문서 번호"></label>
      <label>과세 구분<select name="tax_type"><option value="taxable">과세 (부가세 10%)</option><option value="zero"${editing?.tax_type === 'zero' ? ' selected' : ''}>영세·면세 (부가세 0)</option></select></label>
      <label class="span2">비고<input name="note" maxlength="500" value="${esc(editing?.note || '')}"></label>
    </div>
    <section class="pr-section"><h3>수주 품목</h3><div data-so-lines></div><div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-so-add>+ 품목 추가</button></div></section>
    <div class="bill-total card" data-so-total aria-live="polite"></div>
    <div class="actions">${editing ? `<a class="btn" href="#/sales/orders">목록으로</a>` : ''}<button class="btn primary" data-so-save>${editing ? '수주 고치기 저장' : '수주 저장'}</button></div>
  </form>`;
  const form = $('form', main), box = $('[data-so-lines]', form), input = form.elements.customer;
  let lines = (editing?.lines || []).map(l => ({ bom_id: l.bom_id, item: l.item, product_code: l.product_code, unit: l.unit, spec: l.spec || '', qty: l.qty, price: l.unit_price ?? '', due_date: l.due_date || '', note: l.note || '' }));
  let catalog = null, requestId = crypto.randomUUID(), busy = false;
  const amount = l => l.qty !== '' && l.price !== '' ? billTruncC(Number(l.qty) * Number(l.price)) : null;
  const draw = () => {
    box.innerHTML = lines.length ? `<div class="table-wrap"><table data-keep-cols class="grid bill-grid so-grid"><caption class="sr-only">수주 품목</caption><thead><tr><th scope="col">품목 *</th><th scope="col">규격</th><th scope="col" class="r">수량 *</th><th scope="col">단위</th><th scope="col" class="r">단가</th><th scope="col" class="r">금액</th><th scope="col">납기</th><th scope="col">비고</th><th scope="col"><span class="sr-only">삭제</span></th></tr></thead>
      <tbody>${lines.map((l, i) => `<tr>
        <td data-card-primary data-label="품목"><button type="button" class="btn small" data-so-pick="${i}">바꾸기</button> <b>${esc(l.item)}</b>${l.product_code ? `<div class="small muted">${esc(l.product_code)}</div>` : ''}</td>
        <td data-label="규격"><input data-l="spec" data-i="${i}" maxlength="100" value="${esc(l.spec)}" aria-label="${esc(l.item)} 규격"></td>
        <td class="r" data-label="수량"><input type="number" min="0" step="any" inputmode="decimal" data-l="qty" data-i="${i}" value="${esc(l.qty)}" aria-label="${esc(l.item)} 수량" required></td>
        <td data-label="단위">${esc(l.unit || '')}</td>
        <td class="r" data-label="단가"><input type="number" min="0" step="any" inputmode="decimal" data-l="price" data-i="${i}" value="${esc(l.price)}" aria-label="${esc(l.item)} 단가" placeholder="전표 때 입력"></td>
        <td class="r nowrap" data-label="금액" data-so-amount="${i}">${amount(l) == null ? '' : won(amount(l))}</td>
        <td data-label="납기"><input type="date" data-l="due_date" data-i="${i}" value="${esc(l.due_date)}" aria-label="${esc(l.item)} 납기"></td>
        <td data-label="비고"><input data-l="note" data-i="${i}" maxlength="200" value="${esc(l.note)}" aria-label="${esc(l.item)} 비고"></td>
        <td><button type="button" class="btn small" data-so-del="${i}">삭제</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted small">「+ 품목 추가」로 품목을 고르세요.</p>';
    totals();
  };
  const totals = () => {
    const qty = lines.reduce((t, l) => t + (Number(l.qty) || 0), 0), sum = lines.reduce((t, l) => t + (amount(l) || 0), 0), noPrice = lines.filter(l => l.price === '').length;
    $('[data-so-total]', form).innerHTML = `<div class="bill-sum"><span>${esc(`${lines.length}품목`)}</span><span>${esc(`수량 ${fmtNum(qty)}`)}</span><span class="bill-grand">${esc(`금액 ${won(sum)}원`)}</span>${noPrice ? `<span class="chip yellow">${esc(`단가 없는 줄 ${noPrice}`)}</span>` : ''}</div>`;
  };
  const pick = async (index = -1) => {
    if (!catalog) catalog = await api('GET', '/api/boms').catch(error => { fail(error); return null; });
    if (!catalog) return;
    const bom = await openItemPicker(catalog, { title: '수주 품목 찾기', filter: b => b.active !== 0 && !b.is_temp, emptyText: '찾는 품목이 없습니다. 분류 탭을 「전체」로 바꾸거나 검색어를 줄이세요. 새 품목은 제품등록에서 먼저 등록합니다.' });
    if (!bom) return;
    const row = { bom_id: bom.id, item: bom.product, product_code: bom.product_code || '', unit: bom.unit || '' };
    if (index >= 0) Object.assign(lines[index], row); else lines.push({ ...row, spec: '', qty: '', price: '', due_date: form.elements.due_date.value, note: '' });
    draw();
    $$('[data-l="qty"]', box)[index >= 0 ? index : lines.length - 1]?.focus();
  };
  enterMovesInTable(box);
  $('[data-so-add]', form).onclick = () => pick().catch(fail);
  box.addEventListener('click', e => {
    const p = e.target.closest('[data-so-pick]'); if (p) return pick(Number(p.dataset.soPick)).catch(fail);
    const d = e.target.closest('[data-so-del]'); if (d) { lines.splice(Number(d.dataset.soDel), 1); draw(); }
  });
  box.addEventListener('input', e => {
    const k = e.target.dataset.l; if (!k) return; const i = Number(e.target.dataset.i); lines[i][k] = e.target.value;
    if (k === 'qty' || k === 'price') { const a = amount(lines[i]); $(`[data-so-amount="${i}"]`, box).textContent = a == null ? '' : won(a); totals(); }
  });
  bindPartnerPicker(input, $('[data-partner-hint]', form), { type: 'sales' }).catch(() => {});
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const v = formObj(form);
    if (!v.customer) { input.focus(); return toast('거래처를 넣으세요.', 'err'); }
    if (!lines.length) return toast('수주 품목을 넣으세요.', 'err');
    const badQty = lines.findIndex(l => !(Number(l.qty) > 0)); if (badQty >= 0) { $$('[data-l="qty"]', box)[badQty]?.focus(); return toast(`${lines[badQty].item}의 수량을 넣으세요.`, 'err'); }
    busy = true; const button = $('[data-so-save]', form); button.disabled = true;
    try {
      const body = { ...v, request_id: requestId, lines: lines.map(l => ({ bom_id: l.bom_id, spec: l.spec, qty: l.qty, unit_price: l.price, due_date: l.due_date, note: l.note })) };
      const order = editing ? await api('PUT', '/api/sales-orders/' + editing.id, body) : await api('POST', '/api/sales-orders', body);
      toast(order.duplicate ? `${order.order_no} 수주는 앞서 이미 저장되었습니다.` : editing ? `${order.order_no} 수주를 고쳤습니다.` : `${order.order_no} 수주를 저장했습니다.`);
      requestId = crypto.randomUUID();
      if (editing) { location.hash = '#/sales/orders'; return; }
      lines = []; form.elements.note.value = ''; form.elements.customer_po.value = ''; draw();
      salesOrderSheet(order, null, { onClose: () => { if (form.isConnected) $('[data-so-add]', form)?.focus(); } });
    } catch (error) { fail(error); } finally { busy = false; button.disabled = false; }
  };
  draw();
}

// 수주 상세: 줄마다 수주·전표·출하·잔량, 이 수주로 잡은 전표들, 「매출전표 잡기」·마감·다시 열기·취소·고치기
function salesOrderSheet(order, after = null, { onClose = null } = {}) {
  const open = order.status === 'open', hasBills = order.bills.length > 0;
  const left = order.lines.reduce((t, l) => t + l.remaining, 0);
  const m = modal(`<h3>수주 ${esc(order.order_no)} ${soChip(order.state)}</h3>
    <table class="po-info"><tbody>
      <tr><th>거래처</th><td><b>${esc(order.customer)}</b>${order.customer_code ? ` <span class="small muted">${esc(order.customer_code)}</span>` : ''}</td><th>수주일</th><td>${esc(order.order_date)}</td></tr>
      <tr><th>고객 발주번호</th><td>${esc(order.customer_po || '')}</td><th>납기</th><td>${esc(order.due_date || '')}</td></tr>
      <tr><th>과세 구분</th><td>${order.tax_type === 'zero' ? '영세·면세' : '과세 10%'}</td><th>입력</th><td>${esc(order.created_by)} · ${esc(String(order.created_at).slice(0, 16))}</td></tr>
      ${order.note ? `<tr><th>비고</th><td colspan="3">${esc(order.note)}</td></tr>` : ''}
      ${order.status !== 'open' ? `<tr><th>${order.status === 'closed' ? '마감' : '취소'}</th><td colspan="3">${esc(order.closed_by || '')} · ${esc(String(order.closed_at || '').slice(0, 16))}${order.close_reason ? ' · ' + esc(order.close_reason) : ''}</td></tr>` : ''}
    </tbody></table>
    <div class="table-wrap"><table class="grid so-detail"><caption class="sr-only">수주 품목별 진행</caption><thead><tr><th>품목</th><th>규격</th><th class="r">수주</th><th class="r">전표</th><th class="r">출하</th><th class="r">출하 대기</th><th class="r">잔량</th><th>단위</th><th class="r">단가</th><th>납기</th></tr></thead>
      <tbody>${order.lines.map(l => `<tr><td data-card-primary><b>${esc(l.item)}</b>${l.product_code ? `<div class="small muted">${esc(l.product_code)}</div>` : ''}${l.note ? `<div class="small muted">${esc(l.note)}</div>` : ''}</td><td>${esc(l.spec || '')}</td><td class="r">${fmtNum(l.qty)}</td><td class="r">${fmtNum(l.billed_qty)}</td><td class="r">${fmtNum(l.shipped_qty)}</td><td class="r">${l.pending_qty ? fmtNum(l.pending_qty) : ''}</td><td class="r"><b>${fmtNum(l.remaining)}</b></td><td>${esc(l.unit || '')}</td><td class="r">${l.unit_price == null ? '' : fmtNum(l.unit_price)}</td><td>${esc(l.due_date || '')}</td></tr>`).join('')}</tbody></table></div>
    <h4>매출전표 내역</h4>
    ${hasBills ? `<div class="table-wrap"><table class="grid so-bills"><thead><tr><th>전표번호</th><th>전표 일자</th><th>품목</th><th class="r">수량</th><th class="r">공급가액</th><th>출하</th><th></th></tr></thead><tbody>${order.bills.map(b => { const l = order.lines.find(x => x.id === b.order_line_id); return `<tr><td data-card-primary><b>${esc(b.bill_no)}</b></td><td>${esc(b.bill_date)}</td><td>${esc(l?.item || '')}</td><td class="r">${fmtNum(b.qty)}</td><td class="r">${won(b.supply)}</td><td>${shipChip(b.ship_status)}</td><td><button type="button" class="btn small" data-so-bill="${b.bill_id}">전표 보기</button></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted small">아직 잡은 매출전표가 없습니다.</p>'}
    <div class="actions"><button class="btn" data-close>닫기</button>
      ${open && !hasBills ? `<button class="btn" data-so-edit>고치기</button><button class="btn danger" data-so-status="cancelled">수주 취소</button>` : ''}
      ${open && hasBills && left > 0 ? '<button class="btn" data-so-status="closed">잔량 마감</button>' : ''}
      ${!open ? '<button class="btn" data-so-status="open">다시 열기</button>' : ''}
      ${open && left > 0 ? '<button class="btn primary" data-so-bill-new>매출전표 잡기</button>' : ''}</div>`, { wide: true, onClose: () => onClose?.() });
  const unitOf = id => order.lines.find(x => x.id === id)?.unit || '';
  $('.so-detail', m.el)?.closest('.table-wrap')?.insertAdjacentHTML('afterend', sumLine([['수주', esc(unitTotals(order.lines, l => l.qty, l => l.unit))], ['전표', esc(unitTotals(order.lines, l => l.billed_qty, l => l.unit))], ['출하', esc(unitTotals(order.lines, l => l.shipped_qty, l => l.unit))], ['잔량', esc(unitTotals(order.lines, l => l.remaining, l => l.unit))], ['수주 금액', esc(`${won(order.amount)}원`)]]));
  $('.so-bills', m.el)?.closest('.table-wrap')?.insertAdjacentHTML('afterend', sumLine([['합계', esc(`${order.bills.length}건`)], ['수량', esc(unitTotals(order.bills, b => b.qty, b => unitOf(b.order_line_id)))], ['공급가액', esc(`${won(order.bills.reduce((t, b) => t + b.supply, 0))}원`)]]));
  $('[data-close]', m.el).onclick = m.close;
  $('[data-so-edit]', m.el)?.addEventListener('click', () => { try { sessionStorage.setItem('wpa:so-edit', String(order.id)); } catch { /* 편의 기능 */ } m.close(); location.hash = '#/sales/orders/edit'; });
  $('[data-so-bill-new]', m.el)?.addEventListener('click', () => {
    try { sessionStorage.setItem('wpa:sbill-customer', order.customer); sessionStorage.setItem('wpa:sbill-order', String(order.id)); } catch { /* 편의 기능 */ }
    m.close(); location.hash = '#/sales/bills/new';
  });
  $$('[data-so-bill]', m.el).forEach(b => b.onclick = async () => { try { salesBillSheet(await api('GET', '/api/sales-bills/' + b.dataset.soBill), async () => { await after?.(); }); } catch (error) { fail(error); } });
  $$('[data-so-status]', m.el).forEach(b => b.onclick = async () => {
    const to = b.dataset.soStatus; let reason = '';
    if (to === 'open') { if (!(await confirmBox(`${order.order_no} 수주를 다시 열까요? 남은 수량으로 전표를 다시 잡을 수 있습니다.`))) return; }
    else {
      const v = await promptBox(to === 'closed' ? '잔량 마감' : '수주 취소', `<p class="small muted">${to === 'closed' ? `남은 수량 ${fmtNum(left)}을(를) 더 받지 않고 이 수주를 끝냅니다. 이미 잡은 전표는 그대로 둡니다.` : '아직 전표를 잡지 않은 수주를 취소합니다.'}</p><label>사유<input name="reason" maxlength="200"></label>`);
      if (!v) return; reason = v.reason;
    }
    b.disabled = true;
    try { const r = await api('POST', `/api/sales-orders/${order.id}/status`, { status: to, reason }); toast(to === 'open' ? '수주를 다시 열었습니다.' : to === 'closed' ? '잔량을 마감했습니다.' : '수주를 취소했습니다.'); m.close(); salesOrderSheet(r, after); await after?.(); }
    catch (error) { fail(error); b.disabled = false; }
  });
}

async function pageSalesOrderList(main) {
  main.innerHTML = `<h1>수주 목록</h1>
  <div class="seg class-tabs" id="soTabs" role="group" aria-label="진행 상태"></div>
  <form class="list-filters toolbar" data-read-only id="soFilters"><label>수주일<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label>거래처<input name="customer" maxlength="100"></label><label class="grow">검색<input type="search" name="q" placeholder="수주번호·거래처·코드·고객 발주번호·비고"></label><button class="btn primary">조회</button><a class="btn" href="#/sales/orders/new">수주 입력</a></form>
  <div id="soSummary" class="counts"></div><div id="soList"></div><div class="actions"><button type="button" class="btn" id="soMore" hidden>더 보기</button></div>`;
  const form = $('#soFilters', main); let rows = [], page = 0, version = 0;
  let state = 'open'; try { state = localStorage.getItem('wpa:so-state') ?? 'open'; } catch { /* 편의 기능 */ }
  const tabs = [['open', '진행 중'], ['waiting', '대기'], ['partial', '일부 전표'], ['done', '전표 완료'], ['closed', '마감'], ['cancelled', '취소'], ['', '전체']];
  const drawTabs = () => { $('#soTabs', main).innerHTML = tabs.map(([k, label]) => `<button type="button" data-so-tab="${k}" class="${k === state ? 'on' : ''}" aria-pressed="${k === state}">${label}</button>`).join(''); };
  const load = async (next = false) => {
    const mine = ++version;
    const data = await api('GET', '/api/sales-orders?' + new URLSearchParams({ ...formObj(form), state, page: next ? page + 1 : 0 }));
    if (mine !== version || !main.isConnected) return;
    rows = next ? rows.concat(data.rows) : data.rows; page = data.page; $('#soMore', main).hidden = !data.more;
    $('#soSummary', main).innerHTML = `<b>${esc(`${rows.length}건 · 수주 금액 ${won(rows.reduce((t, r) => t + r.amount, 0))}원`)}</b>${data.more ? ' <span>(더 있음)</span>' : ''}`;
    $('#soList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>수주번호</th><th>수주일</th><th>거래처</th><th>품목</th><th class="r">수주</th><th class="r">전표</th><th class="r">잔량</th><th class="r">금액</th><th>납기</th><th>상태</th><th>입력</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${['closed', 'cancelled'].includes(r.state) ? 'row-off' : ''}">
      <td data-card-primary><b>${esc(r.order_no)}</b>${r.customer_po ? `<div class="small muted">${esc(r.customer_po)}</div>` : ''}</td><td>${esc(r.order_date)}</td><td>${esc(r.customer)}${r.customer_code ? `<div class="small muted">${esc(r.customer_code)}</div>` : ''}</td>
      <td>${esc(r.first_item || '')}${r.line_count > 1 ? ` <span class="small muted">${esc(`외 ${r.line_count - 1}`)}</span>` : ''}</td><td class="r">${fmtNum(r.ordered_qty)}</td><td class="r">${fmtNum(r.billed_qty)}</td>
      <td class="r"><b>${r.status === 'open' ? fmtNum(Math.max(0, r.ordered_qty - r.billed_qty)) : ''}</b></td><td class="r">${won(r.amount)}</td><td>${esc(r.due_date || '')}</td><td>${soChip(r.state)}</td><td class="small muted">${esc(r.created_by)}</td>
      <td data-card-primary><button class="btn small" data-so-open="${r.id}">보기</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 수주가 없습니다.</div>';
  };
  drawTabs();
  $('#soTabs', main).addEventListener('click', e => { const b = e.target.closest('[data-so-tab]'); if (!b) return; state = b.dataset.soTab; try { localStorage.setItem('wpa:so-state', state); } catch { /* 편의 기능 */ } drawTabs(); load().catch(fail); });
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  bindPartnerPicker(form.elements.customer, null, { type: 'sales' }).catch(() => {});
  $('#soMore', main).onclick = () => load(true).catch(fail);
  $('#soList', main).addEventListener('click', async e => { const b = e.target.closest('[data-so-open]'); if (!b) return; try { salesOrderSheet(await api('GET', '/api/sales-orders/' + b.dataset.soOpen), () => load()); } catch (error) { fail(error); } });
  await load();
}

// 물류 · 출하지시: 영업이 수주에서 매출전표를 잡으면 줄마다 지시가 내려온다. LOT을 넣고 「출하 처리」하면 출하(재고 차감)가 생긴다.
async function pageShipInstructions(main) {
  main.innerHTML = `<h1>출하지시</h1>
  <p class="muted">영업이 수주로 매출전표를 잡으면 여기에 출하지시가 내려옵니다. 출고할 줄을 체크하고 LOT을 넣어 「출하 처리」하면 출하 목록에 기록되고 재고가 빠집니다. 전표가 취소되면 대기 중인 지시도 함께 취소됩니다.</p>
  <div class="seg class-tabs" id="siTabs" role="group" aria-label="지시 상태"></div>
  <form class="list-filters toolbar" data-read-only id="siFilters"><label>지시일<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label>거래처<input name="customer" maxlength="100"></label><label class="grow">검색<input type="search" name="q" placeholder="품목·제품코드·거래처"></label><button class="btn primary">조회</button></form>
  <div id="siList"></div>
  <div class="actionbar" id="siBar"><span class="small" id="siCount"></span><label class="inline">출고일 <input type="date" id="siDate" value="${todayStr()}" max="${todayStr()}"></label><button type="button" class="btn primary" id="siShip">출하 처리</button></div>`;
  const form = $('#siFilters', main); let rows = [], status = 'pending', version = 0, busy = false;
  const canShip = hasRole('logistics');
  const tabs = [['pending', '출하 대기'], ['held', '보류'], ['shipped', '출하 완료'], ['cancelled', '지시 취소']];
  const canHold = hasRole('logistics') || hasRole('sales');
  const drawTabs = () => { $('#siTabs', main).innerHTML = tabs.map(([k, label]) => `<button type="button" data-si-tab="${k}" class="${k === status ? 'on' : ''}" aria-pressed="${k === status}">${label}</button>`).join(''); };
  const picked = () => $$('[data-si-pick]:checked', main).map(c => Number(c.value));
  const sync = () => { const n = picked().length; $('#siCount', main).textContent = `${n}건 선택`; $('#siShip', main).disabled = !n || busy; };
  const load = async () => {
    const mine = ++version;
    const data = await api('GET', '/api/ship-instructions?' + new URLSearchParams({ ...formObj(form), status }));
    if (mine !== version || !main.isConnected) return;
    rows = data.rows; const pending = status === 'pending', held = status === 'held';
    $('#siBar', main).hidden = !pending || !canShip;
    $('#siList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr>${pending && canShip ? '<th><input type="checkbox" id="siAll" aria-label="전체 선택"></th>' : ''}<th>지시일</th><th>거래처</th><th>품목</th><th>규격</th><th class="r">수량</th><th>단위</th><th>${pending ? 'LOT' : 'LOT · 처리'}</th><th>수주 · 전표</th><th>상태</th>${(pending || held) && canHold ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(r => `<tr>
      ${pending && canShip ? `<td><input type="checkbox" data-si-pick value="${r.id}" aria-label="${esc(r.item)} 선택"></td>` : ''}<td class="nowrap">${esc(r.ship_date)}</td><td>${esc(r.customer)}</td>
      <td data-card-primary><b>${esc(r.item)}</b>${r.product_code ? `<div class="small muted">${esc(r.product_code)}</div>` : ''}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td>${esc(r.spec || '')}</td>
      <td class="r"><b>${fmtNum(r.qty)}</b></td><td>${esc(r.unit || '')}</td>
      <td>${pending ? (canShip ? `<input data-si-lot="${r.id}" maxlength="100" aria-label="${esc(r.item)} LOT" placeholder="LOT">` : '') : `${esc(r.shipped_lot || '')}<div class="small muted">${esc(r.processed_by || '')} ${esc(String(r.processed_at || '').slice(5, 16))}</div>`}</td>
      <td class="small">${esc(r.order_no || '')}${r.customer_po ? ` · ${esc(r.customer_po)}` : ''}<div class="muted">${esc(r.bill_no)}</div></td><td>${shipChip(held ? 'held' : r.status)}${held && r.hold_note ? `<div class="small muted">${esc(r.hold_note)}</div>` : ''}${held ? `<div class="small muted">${esc(r.held_by || '')} ${esc(String(r.held_at || '').slice(5, 16))}</div>` : ''}</td>${(pending || held) && canHold ? `<td class="nowrap"><button type="button" class="btn small" data-si-hold="${r.id}">${held ? '보류 해제' : '보류'}</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${pending ? '내려온 출하지시가 없습니다.' : held ? '보류 중인 출하지시가 없습니다.' : '해당하는 출하지시가 없습니다.'}</div>`;
    if (rows.length) $('#siList', main).insertAdjacentHTML('beforeend', sumLine([['합계', esc(`${rows.length}건`)], ['수량', esc(unitTotals(rows, r => r.qty, r => r.unit))]]));
    const all = $('#siAll', main); if (all) all.onchange = () => { $$('[data-si-pick]', main).forEach(c => { c.checked = all.checked; }); sync(); };
    sync();
  };
  $('#siList', main).addEventListener('change', e => { if (e.target.matches('[data-si-pick]')) sync(); });
  // 15.104 보류: 출하만 미룰 때(전표·수주 잔량은 그대로). 해제하면 다시 출하 대기로.
  $('#siList', main).addEventListener('click', async e => {
    const b = e.target.closest('[data-si-hold]'); if (!b) return;
    const r = rows.find(x => x.id === Number(b.dataset.siHold)); if (!r) return;
    let note = '';
    if (status === 'pending') { const v = await promptBox('출하 보류', `<p class="small muted">${esc(r.item)} ${fmtNum(r.qty)} ${esc(r.unit || '')} · ${esc(r.customer)}<br>보류하면 출하 처리 목록과 배지에서 빠집니다. 전표와 수주 잔량은 그대로입니다.</p><label>사유<input name="note" maxlength="200" placeholder="예) 고객 요청으로 출고 연기"></label>`); if (!v) return; note = v.note; }
    b.disabled = true;
    try { await api('POST', `/api/ship-instructions/${r.id}/hold`, { held: status === 'pending', note }); toast(status === 'pending' ? '보류했습니다.' : '보류를 풀었습니다. 출하 대기로 돌아갑니다.'); await load(); refreshNavBadges?.(); }
    catch (error) { fail(error); b.disabled = false; }
  });
  $('#siList', main).addEventListener('input', e => { const id = e.target.dataset.siLot; if (id && e.target.value) { const c = $(`[data-si-pick][value="${id}"]`, main); if (c && !c.checked) { c.checked = true; sync(); } } });
  $('#siShip', main).onclick = async () => {
    const ids = picked(); if (!ids.length || busy) return;
    const lots = Object.fromEntries(ids.map(id => [id, $(`[data-si-lot="${id}"]`, main)?.value.trim() || '']));
    const noLot = ids.filter(id => !lots[id]).length;
    if (!(await confirmBox(`${ids.length}건을 ${$('#siDate', main).value}에 출하 처리할까요?${noLot ? ` (LOT 없는 줄 ${noLot}건)` : ''} 출하 목록에 기록되고 재고가 빠집니다.`))) return;
    busy = true; sync();
    try { const r = await api('POST', '/api/ship-instructions/ship', { ids, ship_date: $('#siDate', main).value, lots }); toast(`${r.shipped}건을 출하 처리했습니다.`); await load(); }
    catch (error) { fail(error); await load().catch(() => {}); } finally { busy = false; sync(); }
  };
  drawTabs();
  $('#siTabs', main).addEventListener('click', e => { const b = e.target.closest('[data-si-tab]'); if (!b) return; status = b.dataset.siTab; drawTabs(); load().catch(fail); });
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  bindPartnerPicker(form.elements.customer, null, { type: 'sales' }).catch(() => {});
  await load();
}
