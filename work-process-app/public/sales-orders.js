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
      <label>거래처 *<input name="customer" required maxlength="100" placeholder="거래처 이름 또는 코드" autocomplete="off" value="${esc(editing?.customer || '')}"${editing?.lines.some(l => l.used) ? ' readonly title="전표·출하가 잡힌 수주는 거래처를 바꿀 수 없습니다"' : ''}></label><span class="partner-hint small muted" data-partner-hint></span>
      <label>수주일 *<input name="order_date" type="date" required value="${esc(editing?.order_date || todayStr())}"></label>
      <label>납기<input name="due_date" type="date" value="${esc(editing?.due_date || '')}"></label>
      <label>고객 발주번호<input name="customer_po" maxlength="50" value="${esc(editing?.customer_po || '')}" placeholder="고객사 주문서 번호"></label>
      <label>과세 구분<select name="tax_type"><option value="taxable">과세 (부가세 10%)</option><option value="zero"${editing?.tax_type === 'zero' ? ' selected' : ''}>영세·면세 (부가세 0)</option></select></label>
      <label class="span2">비고 <span class="hint">(고객 비고를 그대로 붙여넣으면 PO를 읽어 고객 발주번호에 넣습니다)</span><input name="note" maxlength="500" value="${esc(editing?.note || '')}" placeholder="예: 0C0827-27 (P1DD) OLED Asan mj1938,seon 2008315425"><span class="small muted" data-note-parse></span></label>
    </div>
    <section class="pr-section"><h3>수주 품목</h3><div data-so-lines></div><div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-so-add>+ 품목 추가</button></div></section>
    <div class="bill-total card" data-so-total aria-live="polite"></div>
    <div class="actions">${editing ? `<a class="btn" href="#/sales/orders">목록으로</a>` : ''}<button class="btn primary" data-so-save>${editing ? '수주 고치기 저장' : '수주 저장'}</button></div>
  </form>`;
  const form = $('form', main), box = $('[data-so-lines]', form), input = form.elements.customer;
  // 15.126 고객 비고(삼성 형식)를 붙여넣으면 PO·라인·사업장·담당자를 읽어 보여 주고, 고객 발주번호가 비어 있으면 PO를 넣는다
  { const noteIn = form.elements.note, poIn = form.elements.customer_po, out = $('[data-note-parse]', form);
    const read = () => { const p = parseCustomerNote(noteIn.value), po = p?.po || poOf('', noteIn.value);
      if (po && !poIn.value.trim()) { poIn.value = po; poIn.classList.add('auto-filled'); }
      out.innerHTML = p ? `읽음 · 요청 <b>${esc(p.req)}</b> · 라인 <b>${esc(p.line)}</b>${p.site ? ` · ${esc(p.site)}` : ''}${p.person ? ` · 담당 ${esc(p.person)}` : ''} · PO <b>${esc(p.po)}</b>` : po ? `PO <b>${esc(po)}</b> 읽음` : ''; };
    noteIn.addEventListener('input', read); if (noteIn.value) read(); }

  let lines = (editing?.lines || []).map(l => ({ id: l.id, used: !!l.used, taken: Math.round((l.billed_qty + l.shipped_unbilled) * 1e6) / 1e6, bom_id: l.bom_id, item: l.item, product_code: l.product_code, unit: l.unit, spec: l.spec || '', qty: l.qty, price: l.unit_price ?? '', due_date: l.due_date || '', note: l.note || '' }));
  let catalog = null, requestId = crypto.randomUUID(), busy = false;
  if (lines.length) { catalog = await api('GET', '/api/boms').catch(() => null); for (const l of lines) { const b = catalog?.find(x => x.id === l.bom_id); if (b) { l.sizes = b.sizes || []; l.fixedSpec = !!b.spec && !l.sizes.length; if (l.fixedSpec) l.spec = b.spec; } } }
  const amount = l => l.qty !== '' && l.price !== '' ? billTruncC(Number(l.qty) * Number(l.price)) : null;
  const draw = () => {
    box.innerHTML = lines.length ? `<div class="table-wrap"><table data-keep-cols class="grid bill-grid so-grid"><caption class="sr-only">수주 품목</caption><thead><tr><th scope="col">품목 *</th><th scope="col">규격</th><th scope="col" class="r">수량 *</th><th scope="col">단위</th><th scope="col" class="r">단가</th><th scope="col" class="r">금액</th><th scope="col">납기</th><th scope="col">비고</th><th scope="col"><span class="sr-only">삭제</span></th></tr></thead>
      <tbody>${lines.map((l, i) => `<tr>
        <td data-card-primary data-label="품목">${l.used ? '<span class="chip blue" title="전표·출하가 잡힌 줄: 품목·규격 고정, 수량은 잡은 수량 이상">진행 중</span>' : `<button type="button" class="btn small" data-so-pick="${i}">바꾸기</button>`} <b>${esc(l.item)}</b>${l.used ? `<div class="small muted" data-so-taken="${i}">잡은 수량 ${fmtNum(l.taken)} · 남은 ${fmtNum(Math.max(0, (Number(l.qty) || 0) - l.taken))}</div>` : ''}${l.product_code ? `<div class="small muted">${esc(l.product_code)}</div>` : ''}</td>
        <td data-label="규격">${l.used ? (l.spec ? `<span class="spec-fixed">${esc(l.spec)}</span>` : '') : l.fixedSpec ? `<span class="spec-fixed" title="제품등록 규격(고정)">${esc(l.spec)}</span>` : (l.sizes || []).length ? `<select data-l="spec" data-i="${i}" aria-label="${esc(l.item)} 사이즈"><option value="">사이즈</option>${l.sizes.map(z => `<option${z === l.spec ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select>` : `<input data-l="spec" data-i="${i}" maxlength="100" value="${esc(l.spec)}" aria-label="${esc(l.item)} 규격">`}</td>
        <td class="r" data-label="수량"><input type="number" min="${l.used ? esc(l.taken) : 0}" step="any" inputmode="decimal" data-l="qty" data-i="${i}" value="${esc(l.qty)}" aria-label="${esc(l.item)} 수량" required></td>
        <td data-label="단위">${esc(l.unit || '')}</td>
        <td class="r" data-label="단가"><input type="number" min="0" step="any" inputmode="decimal" data-l="price" data-i="${i}" value="${esc(l.price)}" aria-label="${esc(l.item)} 단가" placeholder="전표 때 입력"></td>
        <td class="r nowrap" data-label="금액" data-so-amount="${i}">${amount(l) == null ? '' : won(amount(l))}</td>
        <td data-label="납기"><input type="date" data-l="due_date" data-i="${i}" value="${esc(l.due_date)}" aria-label="${esc(l.item)} 납기"></td>
        <td data-label="비고"><input data-l="note" data-i="${i}" maxlength="200" value="${esc(l.note)}" aria-label="${esc(l.item)} 비고"></td>
        <td>${l.used ? '' : `<button type="button" class="btn small" data-so-del="${i}">삭제</button>`}</td></tr>`).join('')}</tbody></table></div>`
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
    const pickOpts = { title: '수주 품목 찾기', filter: b => b.active !== 0 && !b.is_temp, emptyText: '찾는 품목이 없습니다. 분류 탭을 「전체」로 바꾸거나 검색어를 줄이세요. 새 품목은 제품등록에서 먼저 등록합니다.' };
    // 15.137 새 줄은 체크해 여러 품목을 한 번에, 「바꾸기」는 한 품목
    const boms = index >= 0 ? [await openItemPicker(catalog, pickOpts)].filter(Boolean) : ((await openItemPicker(catalog, { ...pickOpts, multi: true, lots: false }))?.items || []).map(x => x.bom);
    if (!boms.length) return;
    for (const bom of boms) {
      const row = { bom_id: bom.id, item: bom.product, product_code: bom.product_code || '', unit: bom.unit || '', spec: bom.spec || '', fixedSpec: !!bom.spec && !(bom.sizes || []).length, sizes: bom.sizes || [] };
      const tp = (await tablePrices('sales', input.value, form.elements.order_date.value || todayStr()))[bom.id];
      if (tp) row.price = tp.unit_price; // 15.111 매출 단가표 단가를 미리 채움
      if (index >= 0) Object.assign(lines[index], row); else lines.push({ qty: '', price: '', due_date: form.elements.due_date.value, note: '', ...row });
    }
    draw();
    $$('[data-l="qty"]', box)[index >= 0 ? index : lines.length - boms.length]?.focus();
  };
  enterMovesInTable(box);
  $('[data-so-add]', form).onclick = () => pick().catch(fail);
  box.addEventListener('click', e => {
    const p = e.target.closest('[data-so-pick]'); if (p) return pick(Number(p.dataset.soPick)).catch(fail);
    const d = e.target.closest('[data-so-del]'); if (d) { lines.splice(Number(d.dataset.soDel), 1); draw(); }
  });
  box.addEventListener('change', e => { if (e.target.matches('select[data-l="spec"]')) lines[Number(e.target.dataset.i)].spec = e.target.value; });
  box.addEventListener('input', e => {
    const k = e.target.dataset.l; if (!k) return; const i = Number(e.target.dataset.i); lines[i][k] = e.target.value;
    if (k === 'qty' && lines[i].used) { const t = $(`[data-so-taken="${i}"]`, box); if (t) { const left = (Number(lines[i].qty) || 0) - lines[i].taken; t.innerHTML = left < -0.000001 ? `<span class="red-text">잡은 수량 ${fmtNum(lines[i].taken)}보다 적게 못 줄입니다</span>` : `잡은 수량 ${fmtNum(lines[i].taken)} · 남은 ${fmtNum(left)}`; } }
    if (k === 'qty' || k === 'price') { const a = amount(lines[i]); $(`[data-so-amount="${i}"]`, box).textContent = a == null ? '' : won(a); totals(); }
  });
  bindPartnerPicker(input, $('[data-partner-hint]', form), { type: 'sales' }).catch(() => {});
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const v = formObj(form);
    if (!v.customer) { input.focus(); return toast('거래처를 넣으세요.', 'err'); }
    if (!lines.length) return toast('수주 품목을 넣으세요.', 'err');
    const badQty = lines.findIndex(l => !(Number(l.qty) > 0)); if (badQty >= 0) { $$('[data-l="qty"]', box)[badQty]?.focus(); return toast(`${lines[badQty].item}의 수량을 넣으세요.`, 'err'); }
    const under = lines.findIndex(l => l.used && Number(l.qty) + 0.000001 < l.taken); if (under >= 0) { $$('[data-l="qty"]', box)[under]?.focus(); return toast(`${lines[under].item}: 이미 ${fmtNum(lines[under].taken)} 잡았습니다. 그 이상으로 넣으세요.`, 'err'); }
    busy = true; const button = $('[data-so-save]', form); button.disabled = true;
    try {
      const body = { ...v, request_id: requestId, lines: lines.map(l => ({ id: l.id ?? null, bom_id: l.bom_id, spec: l.spec, qty: l.qty, unit_price: l.price, due_date: l.due_date, note: l.note })) };
      const order = editing ? await api('PUT', '/api/sales-orders/' + editing.id, body) : await api('POST', '/api/sales-orders', body);
      toast(order.duplicate ? `${order.order_no} 수주는 앞서 이미 저장되었습니다.` : editing ? `${order.order_no} 수주를 고쳤습니다.` : `${order.order_no} 수주를 저장했습니다.`);
      requestId = crypto.randomUUID();
      if (editing) { location.hash = '#/sales/orders'; return; }
      lines = []; form.elements.note.value = ''; form.elements.customer_po.value = ''; form.elements.customer_po.classList.remove('auto-filled'); $('[data-note-parse]', form).innerHTML = ''; draw();
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
      ${open ? `<button class="btn" data-so-edit>고치기${hasBills ? ' <span class="small muted">(품목 추가·수량)</span>' : ''}</button>` : ''}${open && !hasBills ? '<button class="btn danger" data-so-status="cancelled">수주 취소</button>' : ''}
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
    $('#soList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>수주번호</th><th>수주일</th><th>거래처</th><th>비고</th><th>품목</th><th class="r">수주</th><th class="r">전표</th><th class="r">잔량</th><th class="r">금액</th><th>납기</th><th>상태</th><th>입력</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${['closed', 'cancelled'].includes(r.state) ? 'row-off' : ''}">
      <td data-card-primary><b>${esc(r.order_no)}</b>${soPoInfo(r)}</td><td>${esc(r.order_date)}</td><td>${esc(r.customer)}${r.customer_code ? `<div class="small muted">${esc(r.customer_code)}</div>` : ''}</td><td class="so-list-note" title="${esc(r.note || '')}">${r.note ? esc(r.note) : '<span class="muted">—</span>'}</td>
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
  <p class="muted">영업이 수주로 매출전표를 잡으면 여기에 출하지시가 내려옵니다. 출고할 줄을 체크하고 LOT을 넣어 「출하 처리」하면 출하 목록에 기록되고 재고가 빠집니다. 전표가 취소되면 대기 중인 지시도 함께 취소됩니다. 여러 줄을 체크해 「출고지시서 묶기」하면 한 장(DO-…)의 피킹·출고 지시서로 인쇄하고 한 번에 출하 처리할 수 있습니다.</p>
  <div class="seg class-tabs" id="siTabs" role="group" aria-label="지시 상태"></div>
  <form class="list-filters toolbar lf-oneline" data-read-only id="siFilters"><label class="lf-period">지시일<span class="lf-pair"><input type="date" name="from" aria-label="지시일 시작"><span class="muted">~</span><input type="date" name="to" aria-label="지시일 끝"></span></label><label class="lf-partner">거래처<input name="customer" maxlength="100"></label><label class="grow lf-q">검색<input type="search" name="q" placeholder="품목·제품코드·거래처·지시서 번호"></label><label class="lf-check" data-si-nobatch><input type="checkbox" name="nobatch"> 묶음 안 된 것만</label><button class="btn primary">조회</button></form>
  <div id="siList"></div>
  <div class="actionbar" id="siBar"><span class="small" id="siCount"></span><label class="inline">출고일 <input type="date" id="siDate" value="${todayStr()}" max="${todayStr()}"></label><button type="button" class="btn" id="siBatch" title="체크한 지시를 출고지시서 한 장으로 묶어 인쇄">출고지시서 묶기</button><button type="button" class="btn primary" id="siShip">출하 처리</button></div>`;
  const form = $('#siFilters', main); let rows = [], status = 'pending', version = 0, busy = false, lotPickers = new Map();
  const canShip = hasRole('logistics');
  const tabs = [['pending', '출하 대기'], ['batches', '출고지시서(묶음)'], ['held', '보류'], ['shipped', '출하 완료'], ['cancelled', '지시 취소']];
  const canHold = hasRole('logistics') || hasRole('sales');
  const drawTabs = () => { $('#siTabs', main).innerHTML = tabs.map(([k, label]) => `<button type="button" data-si-tab="${k}" class="${k === status ? 'on' : ''}" aria-pressed="${k === status}">${label}</button>`).join(''); };
  const picked = () => $$('[data-si-pick]:checked', main).map(c => Number(c.value));
  const sync = () => { const n = picked().length; $('#siCount', main).textContent = `${n}건 선택`; $('#siShip', main).disabled = !n || busy; $('#siBatch', main).disabled = !n || busy; };
  const load = async () => {
    const mine = ++version;
    $('[data-si-nobatch]', form).hidden = status !== 'pending';
    if (status === 'batches') { $('#siBar', main).hidden = true; const data = await api('GET', '/api/ship-batches?' + new URLSearchParams({ from: form.elements.from.value, to: form.elements.to.value, q: form.elements.q.value, status: 'all' })); if (mine !== version || !main.isConnected) return; rows = []; $('#siList', main).innerHTML = shipBatchList(data.rows); return; }
    const { nobatch, ...flt } = formObj(form);
    const data = await api('GET', '/api/ship-instructions?' + new URLSearchParams({ ...flt, status, batch: status === 'pending' && form.elements.nobatch.checked ? 'none' : '' }));
    if (mine !== version || !main.isConnected) return;
    rows = data.rows; const pending = status === 'pending', held = status === 'held';
    $('#siBar', main).hidden = !pending || !(canShip || canHold); $('#siShip', main).hidden = !canShip; $('#siDate', main).closest('label').hidden = !canShip;
    $('#siList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr>${pending && (canShip || canHold) ? '<th><input type="checkbox" id="siAll" aria-label="전체 선택"></th>' : ''}<th>지시일</th><th>거래처</th><th>품목</th><th>규격</th><th class="r">수량</th><th>단위</th><th>${pending ? 'LOT' : 'LOT · 처리'}</th><th>수주 · 전표</th><th>상태</th>${(pending || held) && canHold ? '<th></th>' : ''}</tr></thead><tbody>${rows.map(r => `<tr class="${r.batch_no && pending ? 'si-batched' : ''}">
      ${pending && (canShip || canHold) ? `<td><input type="checkbox" data-si-pick value="${r.id}" aria-label="${esc(r.item)} 선택"></td>` : ''}<td class="nowrap">${esc(r.ship_date)}</td><td>${esc(r.customer)}</td>
      <td data-card-primary><b>${esc(r.item)}</b>${r.product_code ? `<div class="small muted">${esc(r.product_code)}</div>` : ''}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td>${esc(r.spec || '')}</td>
      <td class="r"><b>${fmtNum(r.qty)}</b></td><td>${esc(r.unit || '')}</td>
      <td>${pending ? (canShip ? `<input data-si-lot="${r.id}" maxlength="100" aria-label="${esc(r.item)} LOT" placeholder="LOT">` : '') : `${esc(r.shipped_lot || '')}<div class="small muted">${esc(r.processed_by || '')} ${esc(String(r.processed_at || '').slice(5, 16))}</div>`}</td>
      <td class="small">${esc(r.order_no || '')}${r.customer_po ? ` · ${esc(r.customer_po)}` : ''}<div class="muted">${esc(r.bill_no)}</div></td><td>${shipChip(held ? 'held' : r.status)}${r.batch_no ? `<div class="si-batch-tag"><span class="chip blue">묶음</span> <button type="button" class="link-btn small" data-si-batch="${r.open_batch_id}" title="출고지시서 보기">${esc(r.batch_no)}</button>${r.batch_plan_date ? `<div class="small muted">${esc(`출고 예정 ${r.batch_plan_date}`)}</div>` : ''}</div>` : ''}${held && r.hold_note ? `<div class="small muted">${esc(r.hold_note)}</div>` : ''}${held ? `<div class="small muted">${esc(r.held_by || '')} ${esc(String(r.held_at || '').slice(5, 16))}</div>` : ''}</td>${(pending || held) && canHold ? `<td class="nowrap"><button type="button" class="btn small" data-si-hold="${r.id}">${held ? '보류 해제' : '보류'}</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${pending ? '내려온 출하지시가 없습니다.' : held ? '보류 중인 출하지시가 없습니다.' : '해당하는 출하지시가 없습니다.'}</div>`;
    const bundled = pending ? rows.filter(r => r.batch_no).length : 0; // 15.154 출고지시서에 묶인 대기 줄 수
    if (rows.length) $('#siList', main).insertAdjacentHTML('beforeend', sumLine([['합계', esc(`${rows.length}건`)], ...(pending ? [['묶임', esc(`${bundled}건`)], ['안 묶임', esc(`${rows.length - bundled}건`)]] : []), ['수량', esc(unitTotals(rows, r => r.qty, r => r.unit))]]));
    const all = $('#siAll', main); if (all) all.onchange = () => { $$('[data-si-pick]', main).forEach(c => { c.checked = all.checked; }); sync(); };
    lotPickers = new Map($$('[data-si-lot]', main).map(inp => { const r = rows.find(x => x.id === Number(inp.dataset.siLot)); return [r.id, bindLotPicker(inp, () => r.item, () => r.qty)]; }));
    sync();
  };
  $('#siList', main).addEventListener('change', e => { if (e.target.matches('[data-si-pick]')) sync(); });
  // 15.132 출고지시서(묶음): 묶기 · 보기
  $('#siList', main).addEventListener('click', async e => { const b = e.target.closest('[data-si-batch]'); if (!b) return; try { shipBatchSheet(await api('GET', '/api/ship-batches/' + b.dataset.siBatch), () => load()); } catch (error) { fail(error); } });
  $('#siBatch', main).onclick = async () => {
    const ids = picked(); if (!ids.length || busy) return;
    const sel = rows.filter(r => ids.includes(r.id)), dup = sel.find(r => r.batch_no);
    if (dup) return toast(`${dup.item}(${dup.customer})은 이미 ${dup.batch_no}에 묶여 있습니다. 체크를 풀거나 그 지시서에서 빼세요.`, 'err');
    const custs = [...new Set(sel.map(r => r.customer))];
    // 15.154 줄마다 묶을 수량: 지시 수량보다 적게 넣으면 그만큼만 묶고, 나머지는 같은 전표의 새 줄로 출하 대기에 남는다(전표 합계 그대로).
    const qtyRows = sel.map(r => `<tr><td>${esc(r.customer)}</td><td><b>${esc(r.item)}</b>${r.spec ? ` <span class="small muted">${esc(r.spec)}</span>` : ''}<div class="small muted">${esc(r.bill_no || '')}</div></td><td class="r nowrap">${fmtNum(r.qty)} ${esc(r.unit || '')}</td>
      <td class="r"><input type="number" name="q_${r.id}" value="${r.qty}" min="0" max="${r.qty}" step="any" inputmode="decimal" class="sb-qty" aria-label="${esc(`${r.item} 묶을 수량`)}" data-max="${r.qty}"></td><td class="r nowrap small" data-sb-rest="${r.id}"></td></tr>`).join('');
    const v = await promptBox(`출고지시서 묶기 · ${ids.length}줄`, `<p class="small muted">${esc(custs.join(', '))} · ${esc(unitTotals(sel, r => r.qty, r => r.unit))}</p>
      <div class="table-wrap"><table class="erp-grid sb-split" data-no-sort data-keep-cols><thead><tr><th>거래처</th><th>품목</th><th class="r">지시 수량</th><th class="r">묶을 수량</th><th class="r">남는 수량</th></tr></thead><tbody>${qtyRows}</tbody></table></div>
      <p class="small muted">수량을 줄이면 그만큼만 이번 지시서에 묶고, 남는 수량은 같은 매출전표의 새 줄로 나뉘어 출하 대기에 남습니다(전표 합계는 그대로, 거래명세서에는 두 줄).</p>
      <label>출고 예정일 *<input type="date" name="plan_date" required value="${esc($('#siDate', main).value || todayStr())}"></label><label>비고 <span class="hint">(차량·기사·배송지 등)</span><input name="note" maxlength="300"></label>`, { wide: true, onOpen: el => {
        const sync = inp => { const max = Number(inp.dataset.max), q = Number(inp.value), rest = $(`[data-sb-rest="${inp.name.slice(2)}"]`, el), bad = !(q > 0) || q > max + 0.000001;
          inp.setCustomValidity(bad ? `0보다 크고 ${fmtNum(max)} 이하로 넣으세요.` : ''); rest.textContent = bad ? '' : q < max ? `${fmtNum(+(max - q).toFixed(6))} 남음` : '-';
          // 고치면 오류 안내를 바로 지운다(안 지우면 「확인」을 누르는 순간 안내가 사라지며 버튼이 움직여 첫 클릭이 빗나감)
          if (!bad && inp.dataset.fxError) inp.dispatchEvent(new Event('change', { bubbles: true })); };
        $$('.sb-qty', el).forEach(inp => { sync(inp); inp.addEventListener('input', () => sync(inp)); });
      } });
    if (!v) return;
    const qtys = {}; for (const r of sel) { const q = Number(v[`q_${r.id}`]); if (q > 0 && q < Number(r.qty)) qtys[r.id] = q; delete v[`q_${r.id}`]; }
    if (Object.keys(qtys).length && !await confirmBox(`${Object.keys(qtys).length}줄을 나눠 묶습니다. 남는 수량은 매출전표의 새 줄 + 출하 대기로 남습니다. 계속할까요?`)) return;
    try { const r = await api('POST', '/api/ship-batches', { ...v, ids, qtys, request_id: crypto.randomUUID() }); toast(`출고지시서 ${r.batch_no}을(를) 만들었습니다.`); await load(); shipBatchSheet(r, () => load()); }
    catch (error) { fail(error); await load().catch(() => {}); }
  };
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
    const noLot = ids.filter(id => !lots[id]).length, lotWarn = ids.map(id => lotPickers.get(id)?.check()).filter(Boolean);
    if (!(await confirmBox(`${ids.length}건을 ${$('#siDate', main).value}에 출하 처리할까요?${noLot ? ` (LOT 없는 줄 ${noLot}건)` : ''}${lotWarn.length ? ` ⚠ ${lotWarn.join(' / ')}` : ''} 출하 목록에 기록되고 재고가 빠집니다.`))) return;
    LOT_CACHE.clear();
    busy = true; sync();
    try { const r = await api('POST', '/api/ship-instructions/ship', { ids, ship_date: $('#siDate', main).value, lots }); toast(`${r.shipped}건을 출하 처리했습니다.`); await load(); }
    catch (error) { fail(error); await load().catch(() => {}); } finally { busy = false; sync(); }
  };
  drawTabs();
  $('#siTabs', main).addEventListener('click', e => { const b = e.target.closest('[data-si-tab]'); if (!b) return; status = b.dataset.siTab; drawTabs(); load().catch(fail); });
  // 15.155 출하지시는 기간 빠른 선택을 쓰지 않는다(대기 지시는 날짜를 비워 두고 전부 보는 경우가 대부분)
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  bindPartnerPicker(form.elements.customer, null, { type: 'sales' }).catch(() => {});
  await load();
}

// ── 15.132 출고지시서(묶음) ──
const BATCH_STATE = { open: ['출고 대기', 'yellow'], partial: ['일부 출고', 'blue'], done: ['출고 완료', 'green'], cancelled: ['묶음 풀림', ''] };
const batchChip = s => { const [label, cls] = BATCH_STATE[s] || [s, '']; return `<span class="chip ${cls}">${esc(label)}</span>`; };
function shipBatchList(rows) {
  if (!rows.length) return '<div class="empty">출고지시서가 없습니다. 「출하 대기」에서 지시를 체크해 「출고지시서 묶기」를 누르세요.</div>';
  return `<div class="table-wrap"><table class="grid"><thead><tr><th>출고지시서</th><th>출고 예정일</th><th>거래처</th><th class="r">줄</th><th class="r">대기</th><th class="r">출고</th><th>상태</th><th>비고</th><th>작성</th><th></th></tr></thead><tbody>${rows.map(b => `<tr class="${b.status === 'cancelled' ? 'row-off' : ''}">
    <td data-card-primary><button type="button" class="link-btn" data-si-batch="${b.id}">${esc(b.batch_no)}</button></td><td>${esc(b.plan_date)}</td><td>${esc(String(b.customers || '').split(',').join(', '))}</td>
    <td class="r">${fmtNum(b.lines)}</td><td class="r">${b.pending ? `<b>${fmtNum(b.pending)}</b>` : ''}</td><td class="r">${fmtNum(b.shipped)}</td><td>${batchChip(b.state)}</td><td class="small">${esc(b.note || '')}</td>
    <td class="small muted">${esc(b.created_by)} ${esc(String(b.created_at).slice(5, 16))}</td><td><button class="btn small" data-si-batch="${b.id}">보기</button></td></tr>`).join('')}</tbody></table></div>`;
}
// 출고지시서 한 장: 거래처별로 모은 피킹표(LOT·확인 칸) + 인쇄 + 남은 줄 한 번에 출하 처리 + 줄 빼기·묶음 풀기
function shipBatchSheet(b, after = null) {
  const canShip = hasRole('logistics'), canEdit = (hasRole('logistics') || hasRole('sales')) && b.status === 'open';
  const pend = b.lines.filter(l => l.status === 'pending');
  const groups = []; for (const l of b.lines) { let g = groups.find(x => x.customer === l.customer); if (!g) groups.push(g = { customer: l.customer, lines: [] }); g.lines.push(l); }
  let no = 0;
  const m = modal(`<h3 class="po-print-title">출고지시서 <span class="small muted">${esc(b.batch_no)}</span> ${batchChip(b.state)}</h3>
    <section class="cert po-doc sb-doc">
      <div class="po-doc-head"><img src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><h2>출 고 지 시 서</h2></div>
      <table class="po-info"><tbody>
        <tr><th>지시서 번호</th><td><b>${esc(b.batch_no)}</b></td><th>출고 예정일</th><td><b>${esc(b.plan_date)}</b></td></tr>
        <tr><th>거래처</th><td>${esc(groups.map(g => g.customer).join(', '))}</td><th>작성</th><td>${esc(b.created_by)} · ${esc(String(b.created_at).slice(0, 16))}</td></tr>
        ${b.note ? `<tr><th>비고</th><td colspan="3">${esc(b.note)}</td></tr>` : ''}
        ${b.status === 'cancelled' ? `<tr><th>묶음 풀림</th><td colspan="3">${esc(b.cancelled_by || '')} · ${esc(String(b.cancelled_at || '').slice(0, 16))}</td></tr>` : ''}
      </tbody></table>
      <table class="po-items"><thead><tr><th>No</th><th>품목</th><th>규격</th><th class="r">수량</th><th>단위</th><th>수주 · PO · 전표</th><th>LOT</th><th>상태</th><th class="sb-check">확인</th></tr></thead>
      <tbody>${groups.map(g => `<tr class="sb-cust"><th colspan="9">${esc(g.customer)} <span class="small muted">${esc(`${g.lines.length}줄 · ${unitTotals(g.lines, l => l.qty, l => l.unit)}`)}</span></th></tr>${g.lines.map(l => `<tr class="${l.status === 'cancelled' ? 'row-off' : ''}">
        <td class="c">${++no}</td><td><b>${esc(l.item)}</b>${l.product_code ? `<div class="po-code">${esc(l.product_code)}</div>` : ''}${l.note ? `<div class="po-code">${esc(l.note)}</div>` : ''}</td><td>${esc(l.spec || '')}</td>
        <td class="r"><b>${fmtNum(l.qty)}</b></td><td>${esc(l.unit || '')}</td><td class="small">${esc(l.order_no || '')}${l.customer_po ? ` · PO ${esc(l.customer_po)}` : ''}<div class="muted">${esc(l.bill_no)}</div></td>
        <td class="sb-lot">${l.status === 'pending' && canShip && b.status === 'open' ? `<input data-sb-lot="${l.id}" maxlength="100" placeholder="LOT" aria-label="${esc(l.item)} LOT">` : esc(l.shipped_lot || '')}</td>
        <td>${shipChip(l.status === 'pending' && l.held ? 'held' : l.status)}${l.status === 'pending' && canEdit ? ` <button type="button" class="btn small" data-sb-remove="${l.id}">빼기</button>` : ''}</td><td class="sb-check"></td></tr>`).join('')}`).join('')}</tbody>
      <tfoot><tr><th colspan="3" class="r">합계</th><td class="r" colspan="2"><b>${esc(unitTotals(b.lines.filter(l => l.status !== 'cancelled'), l => l.qty, l => l.unit))}</b></td><td colspan="4">${esc(`${b.lines.length}줄 · 대기 ${b.pending} · 출고 ${b.shipped}`)}</td></tr></tfoot></table>
      <div class="sb-sign"><div><b>지시</b>${esc(b.created_by)}</div><div><b>피킹·포장</b></div><div><b>출고 확인</b></div></div>
    </section>
    <div class="actions"><button class="btn" data-close>닫기</button>${canEdit ? '<button class="btn danger" data-sb-cancel>묶음 풀기</button>' : ''}<button class="btn" data-print>인쇄 · PDF 저장</button>
      ${canShip && b.status === 'open' && pend.length ? `<label class="inline">출고일 <input type="date" data-sb-date value="${esc(b.plan_date <= todayStr() ? b.plan_date : todayStr())}" max="${todayStr()}"></label><button class="btn primary" data-sb-ship>남은 ${pend.length}줄 출하 처리</button>` : ''}</div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  const sbPick = new Map($$('[data-sb-lot]', m.el).map(inp => { const l = b.lines.find(x => x.id === Number(inp.dataset.sbLot)); return [l.id, bindLotPicker(inp, () => l.item, () => l.qty)]; }));
  const reopen = async next => { m.close(); shipBatchSheet(next, after); await after?.(); };
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`출고지시서_${b.batch_no}`);
  $('[data-sb-cancel]', m.el)?.addEventListener('click', async () => {
    if (!await confirmBox(`${b.batch_no} 묶음을 풀까요? 남은 대기 지시는 「출하 대기」로 돌아갑니다(지시·전표는 그대로).`)) return;
    try { await reopen(await api('POST', `/api/ship-batches/${b.id}/cancel`, {})); toast('묶음을 풀었습니다.'); } catch (error) { fail(error); }
  });
  m.el.addEventListener('click', async e => {
    const r = e.target.closest('[data-sb-remove]'); if (!r) return;
    try { await reopen(await api('POST', `/api/ship-batches/${b.id}/remove`, { ids: [Number(r.dataset.sbRemove)] })); toast('지시서에서 뺐습니다(출하 대기로 돌아감).'); } catch (error) { fail(error); }
  });
  $('[data-sb-ship]', m.el)?.addEventListener('click', async e => {
    const ready = pend.filter(l => !l.held), held = pend.length - ready.length;
    if (!ready.length) return toast('보류 중인 줄만 남았습니다. 보류를 풀고 출하 처리하세요.', 'err');
    const date = $('[data-sb-date]', m.el).value, lots = Object.fromEntries(ready.map(l => [l.id, $(`[data-sb-lot="${l.id}"]`, m.el)?.value.trim() || '']));
    const noLot = ready.filter(l => !lots[l.id]).length, lotWarn = ready.map(l => sbPick.get(l.id)?.check()).filter(Boolean);
    if (!await confirmBox(`${b.batch_no}의 ${ready.length}줄을 ${date}에 출하 처리할까요?${noLot ? ` (LOT 없는 줄 ${noLot}건)` : ''}${lotWarn.length ? ` ⚠ ${lotWarn.join(' / ')}` : ''}${held ? ` 보류 ${held}줄은 제외합니다.` : ''} 출하 목록에 기록되고 재고가 빠집니다.`)) return;
    e.target.disabled = true;
    try { const r = await api('POST', '/api/ship-instructions/ship', { ids: ready.map(l => l.id), ship_date: date, lots }); toast(`${r.shipped}줄을 출하 처리했습니다.`); await reopen(await api('GET', '/api/ship-batches/' + b.id)); refreshNavBadges?.(); }
    catch (error) { fail(error); e.target.disabled = false; }
  });
}

// 15.137 수주목록 PO 칸: 고객 비고(예: 0C0827-27 (P1DD) OLED Asan mj1938,seon 2008315425)에서 주문번호·주문자명도 읽어 함께 보여 준다.
function soPoInfo(r) {
  const p = parseCustomerNote(r.note), po = poOf(r.customer_po, r.note);
  if (!po && !p) return '';
  return `<div class="small so-po">${po ? `<span>PO <b>${esc(po)}</b></span>` : ''}${p?.req ? `<span>주문번호 <b>${esc(p.req)}</b></span>` : ''}${p?.person ? `<span>주문자 <b>${esc(p.person)}</b></span>` : ''}${p?.line ? `<span class="muted">${esc([p.line, p.site].filter(Boolean).join(' · '))}</span>` : ''}</div>`;
}
