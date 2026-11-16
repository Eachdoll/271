// 세금계산서(15.83). 매출전표를 건별 또는 월별(거래처·기간 합계)로 담고, 세금계산서 관리에서 체크해 「발행」한다.
// 실제 발행은 트러스빌 ERP 연동이 연결된 뒤에 나간다(연결 전에는 서버가 분명히 막음). 받는 이메일은 2개까지.
const TAX_STATUS_LABEL = { draft: ['발행 전', ''], queued: ['발행 요청', 'yellow'], issued: ['발행 완료', 'green'], sent: ['국세청 전송', 'green'], failed: ['발행 실패', 'red'], cancelled: ['담기 취소', ''] };
const taxChip = s => { const [label, tone] = TAX_STATUS_LABEL[s] || [s, '']; return `<span class="chip ${tone}">${label}</span>`; };
const CHARGE_LABEL = { claim: '청구', receipt: '영수' };
const monthRange = ym => { const [y, m] = ym.split('-').map(Number); return { from: `${ym}-01`, to: `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }; };
const prevMonth = () => { const d = new Date(todayStr() + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

// 거래처 사업자 정보(세금계산서용) 창 — 거래처 관리·세금계산서 화면에서 연다.
async function editVendorTaxInfo(name, after) {
  let v; try { v = (await api('GET', '/api/vendors?q=' + encodeURIComponent(name))).find(x => x.name === name); } catch (error) { return fail(error); }
  if (!v) return toast(`거래처 관리에 「${name}」이 없습니다. 먼저 등록하세요.`, 'err');
  const values = await promptBox(`사업자 정보 · ${v.name}`, `<p class="small muted">세금계산서 받는 쪽 정보입니다. 이메일은 2곳까지 받을 수 있습니다.</p>
    <div class="form-grid"><label>사업자등록번호<input name="biz_no" maxlength="12" inputmode="numeric" placeholder="000-00-00000" value="${esc(v.biz_no || '')}"></label><label>상호(법인명)<input name="biz_name" maxlength="100" value="${esc(v.biz_name || v.name)}"></label>
    <label>대표자<input name="ceo" maxlength="50" value="${esc(v.ceo || '')}"></label><label class="span2">주소<input name="address" maxlength="200" value="${esc(v.address || '')}"></label>
    <label>업태<input name="biz_type" maxlength="100" value="${esc(v.biz_type || '')}"></label><label>종목<input name="biz_item" maxlength="100" value="${esc(v.biz_item || '')}"></label>
    <label>세금계산서 이메일 1<input name="tax_email" type="email" maxlength="100" value="${esc(v.tax_email || '')}"></label><label>세금계산서 이메일 2<input name="tax_email2" type="email" maxlength="100" value="${esc(v.tax_email2 || '')}"></label></div>`, { wide: true, submit: body => api('PUT', `/api/vendors/${v.id}/tax-info`, body) });
  if (values) { toast('사업자 정보를 저장했습니다.'); await after?.(); }
}
async function editCompanyTaxInfo() {
  let c; try { c = await api('GET', '/api/tax-company'); } catch (error) { return fail(error); }
  const values = await promptBox('우리 회사 사업자 정보', `<p class="small muted">세금계산서 공급자 정보입니다(관리자만 고칠 수 있음).</p>
    <div class="form-grid"><label>사업자등록번호 *<input name="biz_no" maxlength="12" inputmode="numeric" required value="${esc(c.biz_no)}"></label><label>상호 *<input name="biz_name" maxlength="100" required value="${esc(c.biz_name || COMPANY_NAME)}"></label>
    <label>대표자 *<input name="ceo" maxlength="50" required value="${esc(c.ceo)}"></label><label class="span2">주소<input name="address" maxlength="200" value="${esc(c.address)}"></label>
    <label>업태<input name="biz_type" maxlength="100" value="${esc(c.biz_type)}"></label><label>종목<input name="biz_item" maxlength="100" value="${esc(c.biz_item)}"></label>
    <label>담당 이메일<input name="email" type="email" maxlength="100" value="${esc(c.email)}"></label><label>담당 전화<input name="phone" maxlength="30" value="${esc(c.phone)}"></label></div>`, { wide: true, submit: body => api('PUT', '/api/tax-company', body) });
  if (values) toast('우리 회사 정보를 저장했습니다.');
}

async function pageTaxMake(main) {
  const ym = prevMonth(), r0 = monthRange(ym);
  main.innerHTML = `<h1>세금계산서 만들기</h1>
  <p class="muted">매출전표를 세금계산서로 담습니다. <b>건별</b>은 전표 1건이 계산서 1장, <b>월별</b>은 거래처의 기간(보통 한 달) 전표를 합쳐 1장입니다. 담은 계산서는 「세금계산서 관리」에서 체크해 발행합니다. 한 전표는 계산서 하나에만 담깁니다.</p>
  <div class="seg class-tabs" role="group" aria-label="담는 방식"><button type="button" data-tax-mode="single" class="on">건별</button><button type="button" data-tax-mode="monthly">월별</button></div>
  <form class="list-filters toolbar" data-read-only id="taxMakeForm"><label>전표 일자<input type="date" name="from" value="${r0.from}" required></label><label>~<input type="date" name="to" value="${r0.to}" required></label><label>거래처<input name="customer" maxlength="100" placeholder="비우면 전체"></label><button class="btn primary">조회</button></form>
  <div class="card bill-form tax-opts"><div class="form-grid"><label>작성일자 <span class="hint" data-wd-hint>(비우면 전표 일자)</span><input type="date" name="write_date"></label><label>청구/영수<select name="charge"><option value="receipt">영수</option><option value="claim">청구</option></select></label><label class="span2">비고<input name="note" maxlength="200"></label></div></div>
  <div id="taxCand"></div>
  <div class="bill-total card" id="taxPicked" aria-live="polite"></div>
  <div class="actions"><button type="button" class="btn primary" id="taxMakeBtn">세금계산서 담기</button></div>`;
  const form = $('#taxMakeForm', main), opts = $('.tax-opts', main), box = $('#taxCand', main);
  let mode = 'single', data = null, requestId = crypto.randomUUID(), busy = false;
  const picked = () => $$('[data-tax-pick]:checked', box).map(x => x.dataset.taxPick);
  const sum = () => {
    const keys = new Set(picked()); let n = 0, total = 0;
    if (data) for (const r of mode === 'single' ? data.bills : data.customers) if (keys.has(String(mode === 'single' ? r.id : r.customer))) { n++; total += r.total; }
    $('#taxPicked', main).innerHTML = `<div class="bill-sum"><span>${esc(mode === 'single' ? `선택 ${n}건 → 계산서 ${n}장` : `선택 ${n}곳 → 계산서 ${n}장`)}</span><span class="bill-grand">${esc(`합계 ${won(total)}원`)}</span></div>`;
  };
  const warn = r => `${r.biz_no ? '' : ' <span class="chip red">사업자번호 없음</span>'}${r.tax_email ? '' : ' <span class="chip yellow">이메일 없음</span>'}`;
  const draw = () => {
    if (!data) return;
    $('[data-wd-hint]', opts).textContent = mode === 'single' ? '(비우면 전표 일자)' : '(비우면 기간 마지막 날)';
    if (mode === 'single') {
      box.innerHTML = data.bills.length ? `<div class="table-wrap"><table class="grid bill-grid"><caption class="sr-only">담을 매출전표</caption><thead><tr><th scope="col"><input type="checkbox" data-tax-all aria-label="전체 선택"></th><th>전표 일자</th><th>전표번호</th><th>거래처</th><th>품목</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계</th><th></th></tr></thead><tbody>${data.bills.map(b => `<tr><td><input type="checkbox" data-tax-pick="${b.id}" aria-label="${esc(b.bill_no)} 선택"></td><td>${esc(b.bill_date)}</td><td>${esc(b.bill_no)}</td><td data-card-primary><b>${esc(b.customer)}</b>${warn(b)}</td><td>${esc(`${b.first_item || ''}${b.line_count > 1 ? ` 외 ${b.line_count - 1}건` : ''}`)}</td><td class="r">${won(b.supply_total)}</td><td class="r">${won(b.vat_total)}</td><td class="r"><b>${won(b.total)}</b></td><td><button type="button" class="btn small" data-tax-info="${esc(b.customer)}">사업자 정보</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">그 기간에 아직 계산서에 담지 않은 매출전표가 없습니다.</div>';
    } else {
      box.innerHTML = data.customers.length ? `<div class="table-wrap"><table class="grid bill-grid"><caption class="sr-only">월별로 담을 거래처</caption><thead><tr><th scope="col"><input type="checkbox" data-tax-all aria-label="전체 선택"></th><th>거래처</th><th>사업자번호</th><th>이메일</th><th class="r">전표</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계</th><th></th></tr></thead><tbody>${data.customers.map(c => `<tr><td><input type="checkbox" data-tax-pick="${esc(c.customer)}" aria-label="${esc(c.customer)} 선택"></td><td data-card-primary><b>${esc(c.customer)}</b></td><td>${c.biz_no ? esc(c.biz_no) : '<span class="chip red">없음</span>'}</td><td class="small">${esc(c.tax_email || '')}${c.tax_email2 ? `<div>${esc(c.tax_email2)}</div>` : ''}${c.tax_email ? '' : '<span class="chip yellow">없음</span>'}</td><td class="r">${fmtNum(c.bills)}</td><td class="r">${won(c.supply_total)}</td><td class="r">${won(c.vat_total)}</td><td class="r"><b>${won(c.total)}</b></td><td><button type="button" class="btn small" data-tax-info="${esc(c.customer)}">사업자 정보</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">그 기간에 아직 계산서에 담지 않은 매출전표가 없습니다.</div>';
    }
    const all = $('[data-tax-all]', box); if (all) all.onchange = () => { $$('[data-tax-pick]', box).forEach(x => { x.checked = all.checked; }); sum(); };
    const heads = $$('thead th', box).map(th => th.textContent.trim()); $$('tbody tr', box).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = i === 0 ? '' : heads[i] || ''; }));
    sum();
  };
  const load = async () => { data = await api('GET', '/api/tax-invoices/candidates?' + new URLSearchParams(formObj(form))); if (main.isConnected) draw(); };
  $$('[data-tax-mode]', main).forEach(b => b.onclick = () => { mode = b.dataset.taxMode; $$('[data-tax-mode]', main).forEach(x => x.classList.toggle('on', x === b)); draw(); });
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  box.addEventListener('change', e => { if (e.target.dataset.taxPick !== undefined) sum(); });
  box.addEventListener('click', e => { const b = e.target.closest('[data-tax-info]'); if (b) editVendorTaxInfo(b.dataset.taxInfo, load); });
  $('#taxMakeBtn', main).onclick = async () => {
    if (busy) return; const keys = picked(); if (!keys.length) return toast(mode === 'single' ? '담을 전표를 체크하세요.' : '담을 거래처를 체크하세요.', 'err');
    const o = Object.fromEntries(['write_date', 'charge', 'note'].map(k => [k, $(`[name=${k}]`, opts).value]));
    busy = true; const btn = $('#taxMakeBtn', main); btn.disabled = true;
    try {
      let made = 0;
      if (mode === 'single') made = (await api('POST', '/api/tax-invoices', { kind: 'single', bill_ids: keys.map(Number), ...o, request_id: requestId })).rows.length;
      else for (const customer of keys) made += (await api('POST', '/api/tax-invoices', { kind: 'monthly', customer, from: data.from, to: data.to, ...o, request_id: crypto.randomUUID() })).rows.length;
      toast(`세금계산서 ${made}장을 담았습니다. 「세금계산서 관리」에서 발행하세요.`); requestId = crypto.randomUUID(); await load();
    } catch (error) { fail(error); requestId = crypto.randomUUID(); await load().catch(() => {}); } finally { busy = false; btn.disabled = false; }
  };
  await load();
}

function taxInvoiceView(inv, after) {
  const c = inv.company || {}, editable = ['draft', 'failed'].includes(inv.status);
  const m = modal(`<h3>세금계산서 <span class="small muted">${esc(inv.invoice_no)} · ${inv.kind === 'single' ? '건별' : '월별'}</span> ${taxChip(inv.status)}</h3>
    <section class="cert tax-doc">
      <h2 class="tax-title">전자세금계산서 <span class="small">(${CHARGE_LABEL[inv.charge]})</span></h2>
      <table class="tax-parties"><tbody><tr><th rowspan="4" class="tax-side">공<br>급<br>자</th><th>등록번호</th><td>${esc(c.biz_no)}</td><th rowspan="4" class="tax-side to">공<br>급<br>받<br>는<br>자</th><th>등록번호</th><td>${esc(inv.biz_no)}</td></tr>
        <tr><th>상호 · 대표</th><td>${esc(c.biz_name)} · ${esc(c.ceo)}</td><th>상호 · 대표</th><td>${esc(inv.biz_name)} · ${esc(inv.ceo)}</td></tr>
        <tr><th>주소</th><td>${esc(c.address)}</td><th>주소</th><td>${esc(inv.address)}</td></tr>
        <tr><th>업태 · 종목</th><td>${esc(c.biz_type)} · ${esc(c.biz_item)}</td><th>업태 · 종목</th><td>${esc(inv.biz_type)} · ${esc(inv.biz_item)}</td></tr></tbody></table>
      <table class="po-items"><thead><tr><th>작성일자</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계</th><th>받는 이메일</th></tr></thead><tbody><tr><td>${esc(inv.write_date)}</td><td class="r">${won(inv.supply_total)}</td><td class="r">${won(inv.vat_total)}</td><td class="r"><b>${won(inv.total)}</b></td><td>${esc(inv.email1)}${inv.email2 ? `<br>${esc(inv.email2)}` : ''}</td></tr></tbody></table>
      <table class="po-items"><thead><tr><th>월일</th><th>품목</th><th>규격</th><th class="r">수량</th><th class="r">단가</th><th class="r">공급가액</th><th class="r">세액</th><th>비고</th></tr></thead>
      <tbody>${inv.items.map(i => `<tr><td>${esc(String(i.date || '').slice(5))}</td><td>${esc(i.item)}</td><td>${esc(i.spec || '')}</td><td class="r">${i.qty == null ? '' : fmtNum(i.qty)}</td><td class="r">${i.unit_price == null ? '' : fmtNum(i.unit_price)}</td><td class="r">${won(i.supply)}</td><td class="r">${won(i.vat)}</td><td>${esc(i.note || '')}</td></tr>`).join('')}</tbody></table>
      ${inv.kind === 'monthly' ? `<p class="small">기간 ${esc(inv.period_from)} ~ ${esc(inv.period_to)} · 전표 ${inv.bills.filter(b => b.active).map(b => esc(b.bill_no)).join(', ')}</p>` : `<p class="small">전표 ${inv.bills.filter(b => b.active).map(b => esc(b.bill_no)).join(', ')}</p>`}
      ${inv.approval_no ? `<p><b>승인번호</b> ${esc(inv.approval_no)}</p>` : ''}${inv.status_message ? `<p class="red-text">${esc(inv.status_message)}</p>` : ''}${inv.note ? `<p>비고: ${esc(inv.note)}</p>` : ''}
    </section>
    <div class="actions">${editable ? '<button class="btn" data-tax-edit>작성일자·이메일 고치기</button><button class="btn" data-tax-refresh>거래처 정보 다시 불러오기</button>' : ''}<button class="btn" data-close>닫기</button><button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`세금계산서_${inv.invoice_no}`);
  const reopen = async r => { m.close(); taxInvoiceView({ ...r, company: c }, after); await after?.(); };
  $('[data-tax-refresh]', m.el)?.addEventListener('click', async () => { try { reopen(await api('PUT', `/api/tax-invoices/${inv.id}`, { refresh_customer: true })); toast('거래처 사업자 정보를 다시 불러왔습니다.'); } catch (error) { fail(error); } });
  $('[data-tax-edit]', m.el)?.addEventListener('click', async () => {
    let saved = null;
    const v = await promptBox('작성일자·이메일 고치기', `<div class="form-grid"><label>작성일자<input type="date" name="write_date" required value="${esc(inv.write_date)}"></label><label>청구/영수<select name="charge"><option value="claim"${inv.charge === 'claim' ? ' selected' : ''}>청구</option><option value="receipt"${inv.charge === 'receipt' ? ' selected' : ''}>영수</option></select></label>
      <label>받는 이메일 1 *<input type="email" name="email1" maxlength="100" value="${esc(inv.email1)}"></label><label>받는 이메일 2<input type="email" name="email2" maxlength="100" value="${esc(inv.email2)}"></label><label class="span2">비고<input name="note" maxlength="200" value="${esc(inv.note)}"></label></div>`, { wide: true, submit: async body => { saved = await api('PUT', `/api/tax-invoices/${inv.id}`, body); } });
    if (v && saved) { toast('계산서를 고쳤습니다.'); reopen(saved); }
  });
}

async function pageTaxList(main) {
  const r0 = monthRange(todayStr().slice(0, 7));
  main.innerHTML = `<h1>세금계산서 관리</h1>
  <p class="muted">담은 세금계산서를 체크하고 「발행」을 누르면 트러스빌로 발행합니다. 발행 전에는 작성일자·받는 이메일(2곳까지)을 고치거나 「담기 취소」할 수 있습니다.</p>
  <div class="tax-link" id="taxLink"></div>
  <form class="list-filters toolbar" data-read-only id="taxFilters"><label>작성일자<input type="date" name="from" value="${r0.from}"></label><label>~<input type="date" name="to" value="${r0.to}"></label><label>거래처<input name="customer" maxlength="100"></label><label>상태<select name="status"><option value="">전체(담기 취소 제외)</option>${Object.entries(TAX_STATUS_LABEL).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="grow">검색<input type="search" name="q" placeholder="거래처·사업자번호·품목·이메일·승인번호"></label><button class="btn primary">조회</button></form>
  <div class="actions tax-actions" style="justify-content:flex-start"><button type="button" class="btn primary" id="taxIssue">발행</button><button type="button" class="btn" id="taxCancel">담기 취소</button>${ME.is_admin ? '<button type="button" class="btn" id="taxCompany">우리 회사 정보</button>' : ''}<button type="button" class="btn" id="taxXlsx">엑셀</button></div>
  <div id="taxList"></div><div id="taxCounts" class="counts"></div>`;
  const form = $('#taxFilters', main); let rows = [];
  const load = async () => {
    const data = await api('GET', '/api/tax-invoices?' + new URLSearchParams(formObj(form))); if (!main.isConnected) return;
    rows = data.rows;
    $('#taxLink', main).innerHTML = data.linked ? '' : '<p class="card small"><span class="chip yellow">연동 준비 중</span> 트러스빌 연동이 아직 연결되지 않았습니다. 계산서를 담고 고칠 수는 있지만 「발행」은 연결 뒤에 됩니다.</p>';
    $('#taxList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid bill-grid tax-grid"><caption class="sr-only">세금계산서</caption><thead><tr><th scope="col"><input type="checkbox" data-tax-all aria-label="전체 선택"></th><th>상태</th><th>작성일자</th><th>구분</th><th>거래처</th><th>사업자번호</th><th>받는 이메일</th><th>품목</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계</th><th>청구/영수</th><th>승인번호</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.status === 'cancelled' ? 'row-off' : r.status === 'failed' ? 'row-red' : ''}"><td>${['draft', 'failed'].includes(r.status) ? `<input type="checkbox" data-tax-pick="${r.id}" aria-label="${esc(r.invoice_no)} 선택">` : ''}</td><td>${taxChip(r.status)}${r.status_message ? `<div class="small red-text">${esc(r.status_message)}</div>` : ''}</td><td class="nowrap">${esc(r.write_date)}</td><td>${r.kind === 'single' ? '건별' : '월별'}</td><td data-card-primary><b>${esc(r.customer)}</b></td><td class="nowrap">${r.biz_no ? esc(r.biz_no) : '<span class="chip red">없음</span>'}</td><td class="small">${r.email1 ? esc(r.email1) : '<span class="chip yellow">없음</span>'}${r.email2 ? `<div>${esc(r.email2)}</div>` : ''}</td><td>${esc(r.item_summary)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td>${CHARGE_LABEL[r.charge]}</td><td class="small">${esc(r.approval_no)}</td><td><button type="button" class="btn small" data-tax-open="${r.id}">보기</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 세금계산서가 없습니다.</div>';
    const live = rows.filter(r => r.status !== 'cancelled'), count = s => rows.filter(r => r.status === s).length;
    $('#taxCounts', main).innerHTML = `<b>${esc(`${live.length}장 · 공급가액 ${won(live.reduce((t, r) => t + r.supply_total, 0))}원 · 세액 ${won(live.reduce((t, r) => t + r.vat_total, 0))}원`)}</b> <span>${esc(`발행 전 ${count('draft')} · 발행 요청 ${count('queued')} · 발행 완료 ${count('issued')} · 국세청 전송 ${count('sent')} · 실패 ${count('failed')}`)}</span>${data.more ? ' <span>(더 있음)</span>' : ''}`;
    const all = $('[data-tax-all]', main); if (all) all.onchange = () => $$('[data-tax-pick]', main).forEach(x => { x.checked = all.checked; });
    const heads = $$('#taxList thead th', main).map(th => th.textContent.trim()); $$('#taxList tbody tr', main).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = i === 0 ? '' : heads[i] || ''; }));
  };
  const picked = () => $$('[data-tax-pick]:checked', main).map(x => Number(x.dataset.taxPick));
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('#taxIssue', main).onclick = async () => {
    const ids = picked(); if (!ids.length) return toast('발행할 계산서를 체크하세요.', 'err');
    if (!await confirmBox(`세금계산서 ${ids.length}장을 발행할까요? 발행하면 받는 쪽 이메일과 국세청으로 전송됩니다.`)) return;
    try { const r = await api('POST', '/api/tax-invoices/issue', { ids }); toast(`${r.queued}장 발행을 요청했습니다.`); await load(); } catch (error) { fail(error); }
  };
  $('#taxCancel', main).onclick = async () => {
    const ids = picked(); if (!ids.length) return toast('담기 취소할 계산서를 체크하세요.', 'err');
    if (!await confirmBox(`세금계산서 ${ids.length}장을 담기 취소할까요? 담겼던 전표는 다시 담을 수 있습니다.`)) return;
    try { for (const id of ids) await api('POST', `/api/tax-invoices/${id}/cancel`, {}); toast('담기 취소했습니다.'); } catch (error) { fail(error); }
    await load().catch(fail);
  };
  $('#taxCompany', main)?.addEventListener('click', () => editCompanyTaxInfo());
  $('#taxXlsx', main).onclick = () => {
    if (!rows.length) return toast('내려받을 계산서가 없습니다.', 'err');
    const v = formObj(form);
    xlsxDownload(`세금계산서_${v.from || ''}_${v.to || ''}.xlsx`, { sheet: '세금계산서', titles: ['세금계산서', `${COMPANY_NAME} · 작성일자 ${v.from || ''} ~ ${v.to || ''}`],
      columns: [{ label: '계산서번호', type: 'text', width: 15 }, { label: '상태', type: 'text', width: 11 }, { label: '작성일자', type: 'date' }, { label: '구분', type: 'text', width: 7 }, { label: '거래처', type: 'text', width: 20 }, { label: '사업자번호', type: 'text', width: 14 }, { label: '이메일 1', type: 'text', width: 22 }, { label: '이메일 2', type: 'text', width: 22 }, { label: '품목', type: 'text', width: 22 }, { label: '공급가액', type: 'money', width: 14 }, { label: '세액', type: 'money', width: 12 }, { label: '합계', type: 'money', width: 14 }, { label: '청구/영수', type: 'text', width: 9 }, { label: '승인번호', type: 'text', width: 26 }],
      rows: rows.map(r => [r.invoice_no, TAX_STATUS_LABEL[r.status][0], r.write_date, r.kind === 'single' ? '건별' : '월별', r.customer, r.biz_no, r.email1, r.email2, r.item_summary, r.supply_total, r.vat_total, r.total, CHARGE_LABEL[r.charge], r.approval_no]),
      totals: ['합계', '', '', '', '', '', '', '', '', rows.filter(r => r.status !== 'cancelled').reduce((t, r) => t + r.supply_total, 0), rows.filter(r => r.status !== 'cancelled').reduce((t, r) => t + r.vat_total, 0), rows.filter(r => r.status !== 'cancelled').reduce((t, r) => t + r.total, 0), '', ''] });
  };
  $('#taxList', main).addEventListener('click', async e => { const b = e.target.closest('[data-tax-open]'); if (!b) return; try { taxInvoiceView(await api('GET', '/api/tax-invoices/' + b.dataset.taxOpen), load); } catch (error) { fail(error); } });
  await load();
}
