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
    <label>담당 이메일<input name="email" type="email" maxlength="100" value="${esc(c.email)}"></label><label>담당 전화<input name="phone" maxlength="30" value="${esc(c.phone)}"></label><label class="span2">입금 계좌 <span class="hint">(거래명세서에 나감)</span><input name="bank" maxlength="100" value="${esc(c.bank || '')}" placeholder="예) 기업은행 123-456789-01-011 (주)서울세미텍"></label></div>`, { wide: true, submit: body => api('PUT', '/api/tax-company', body) });
  if (values) toast('우리 회사 정보를 저장했습니다.');
}

async function pageTaxMake(main) {
  // 15.137 지난 달 1일 ~ 오늘(이번 달 전표도 바로 보이게. 예전에는 지난 달만 보여 「조회가 안 된다」로 보였음)
  const r0 = { from: monthRange(prevMonth()).from, to: todayStr() };
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
  const r0 = { from: monthRange(prevMonth()).from, to: monthRange(todayStr().slice(0, 7)).to }; // 15.137 지난 달 월별 계산서(작성일 말일)도 보이게
  main.innerHTML = `<h1>세금계산서 관리</h1>${taxSideTabs('sales')}
  <p class="muted">담은 세금계산서를 체크하고 「발행」을 누르면 트러스빌로 발행합니다. 발행 전에는 작성일자·받는 이메일(2곳까지)을 고치거나 「담기 취소」할 수 있습니다.</p>
  <div class="tax-link" id="taxLink"></div>
  <form class="list-filters toolbar" data-read-only id="taxFilters"><label>작성일자<input type="date" name="from" value="${r0.from}"></label><label>~<input type="date" name="to" value="${r0.to}"></label><label>거래처<input name="customer" maxlength="100"></label>${taxCatSelect(['원자재', '부자재', '반제품', '제품', '상품', '임가공', '미분류'])}<label>상태<select name="status"><option value="">전체(담기 취소 제외)</option>${Object.entries(TAX_STATUS_LABEL).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="grow">검색<input type="search" name="q" placeholder="거래처·사업자번호·품목·이메일·승인번호"></label><button class="btn primary">조회</button></form>
  <div class="actions tax-actions" style="justify-content:flex-start"><button type="button" class="btn primary" id="taxIssue">발행</button><button type="button" class="btn" id="taxMark" title="홈택스 등에서 직접 발행한 계산서를 승인번호와 함께 기록">직접 발행 기록</button><button type="button" class="btn" id="taxUnmark">직접 발행 되돌리기</button><button type="button" class="btn" id="taxCancel">담기 취소</button>${ME.is_admin ? '<button type="button" class="btn" id="taxCompany">우리 회사 정보</button>' : ''}<button type="button" class="btn" id="taxXlsx">엑셀</button></div>
  <div id="taxList"></div><div id="taxCounts" class="counts"></div>`;
  const form = $('#taxFilters', main); let rows = [];
  const load = async () => {
    const data = await api('GET', '/api/tax-invoices?' + new URLSearchParams(formObj(form))); if (!main.isConnected) return;
    rows = data.rows;
    $('#taxLink', main).innerHTML = data.linked ? '' : '<p class="card small"><span class="chip yellow">연동 준비 중</span> 트러스빌 연동이 아직 연결되지 않았습니다. 계산서를 담고 고칠 수는 있지만 「발행」은 연결 뒤에 됩니다.</p>';
    $('#taxList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid bill-grid tax-grid"><caption class="sr-only">세금계산서</caption><thead><tr><th scope="col"><input type="checkbox" data-tax-all aria-label="전체 선택"></th><th>상태</th><th>작성일자</th><th>구분</th><th>거래처</th><th>사업자번호</th><th>받는 이메일</th><th>품목</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계</th><th>청구/영수</th><th>승인번호</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.status === 'cancelled' ? 'row-off' : r.status === 'failed' ? 'row-red' : ''}"><td>${['draft', 'failed'].includes(r.status) || (r.status === 'issued' && String(r.status_message || '').startsWith('직접 발행 기록')) ? `<input type="checkbox" data-tax-pick="${r.id}" aria-label="${esc(r.invoice_no)} 선택">` : ''}</td><td>${taxChip(r.status)}${r.status_message ? `<div class="small red-text">${esc(r.status_message)}</div>` : ''}</td><td class="nowrap">${esc(r.write_date)}</td><td>${r.kind === 'single' ? '건별' : '월별'}</td><td data-card-primary><b>${esc(r.customer)}</b><div>${taxCatChips(r.cats)}</div></td><td class="nowrap">${r.biz_no ? esc(r.biz_no) : '<span class="chip red">없음</span>'}</td><td class="small">${r.email1 ? esc(r.email1) : '<span class="chip yellow">없음</span>'}${r.email2 ? `<div>${esc(r.email2)}</div>` : ''}</td><td>${esc(r.item_summary)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td>${CHARGE_LABEL[r.charge]}</td><td class="small">${esc(r.approval_no)}</td><td><button type="button" class="btn small" data-tax-open="${r.id}">보기</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 세금계산서가 없습니다.</div>';
    const live = rows.filter(r => r.status !== 'cancelled'), count = s => rows.filter(r => r.status === s).length;
    $('#taxCounts', main).innerHTML = `<b>${esc(`${live.length}장 · 공급가액 ${won(live.reduce((t, r) => t + r.supply_total, 0))}원 · 세액 ${won(live.reduce((t, r) => t + r.vat_total, 0))}원 · 합계 ${won(live.reduce((t, r) => t + r.supply_total + r.vat_total, 0))}원`)}</b> <span>${esc(`발행 전 ${count('draft')} · 발행 요청 ${count('queued')} · 발행 완료 ${count('issued')} · 국세청 전송 ${count('sent')} · 실패 ${count('failed')}`)}</span>${data.more ? ' <span>(더 있음)</span>' : ''}` + taxCatSummary(data.by_category);
    const all = $('[data-tax-all]', main); if (all) all.onchange = () => $$('[data-tax-pick]', main).forEach(x => { x.checked = all.checked; });
    const heads = $$('#taxList thead th', main).map(th => th.textContent.trim()); $$('#taxList tbody tr', main).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = i === 0 ? '' : heads[i] || ''; }));
  };
  const picked = () => $$('[data-tax-pick]:checked', main).map(x => Number(x.dataset.taxPick));
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('#taxIssue', main).onclick = async () => {
    const ids = picked().filter(id => ['draft', 'failed'].includes(rows.find(r => r.id === id)?.status)); if (!ids.length) return toast('발행할 계산서를 체크하세요.', 'err');
    if (!await confirmBox(`세금계산서 ${ids.length}장을 발행할까요? 발행하면 받는 쪽 이메일과 국세청으로 전송됩니다.`)) return;
    try { const r = await api('POST', '/api/tax-invoices/issue', { ids }); toast(`${r.queued}장 발행을 요청했습니다.`); await load(); } catch (error) { fail(error); }
  };
  $('#taxCancel', main).onclick = async () => {
    const ids = picked().filter(id => ['draft', 'failed'].includes(rows.find(r => r.id === id)?.status)); if (!ids.length) return toast('담기 취소할 계산서를 체크하세요.', 'err');
    if (!await confirmBox(`세금계산서 ${ids.length}장을 담기 취소할까요? 담겼던 전표는 다시 담을 수 있습니다.`)) return;
    try { for (const id of ids) await api('POST', `/api/tax-invoices/${id}/cancel`, {}); toast('담기 취소했습니다.'); } catch (error) { fail(error); }
    await load().catch(fail);
  };
  $('#taxCompany', main)?.addEventListener('click', () => editCompanyTaxInfo());
  // 15.129 직접 발행 기록(한 장씩) · 되돌리기
  $('#taxMark', main).onclick = async () => { const ids = picked(); if (ids.length !== 1) return toast('직접 발행으로 기록할 계산서를 한 장만 체크하세요.', 'err'); const inv = rows.find(r => r.id === ids[0]); if (!['draft', 'failed'].includes(inv.status)) return toast('발행 전 계산서만 기록할 수 있습니다.', 'err'); await markIssuedWindow(inv, load); };
  $('#taxUnmark', main).onclick = async () => { const ids = picked(); if (ids.length !== 1) return toast('되돌릴 계산서를 한 장만 체크하세요.', 'err'); if (!await confirmBox('직접 발행 기록을 지우고 「발행 전」으로 되돌릴까요? (승인번호도 지워집니다)')) return; try { await api('POST', `/api/tax-invoices/${ids[0]}/unmark-issued`, {}); toast('발행 전으로 되돌렸습니다.'); await load(); } catch (error) { fail(error); } };
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

// ── 15.127 세금계산서 매출·매입 구분 탭 · 분류(원자재·부자재·반제품·제품·상품·임가공·운송비·미분류) ──
const TAX_CAT_ORDER = ['원자재', '부자재', '반제품', '제품', '상품', '임가공', '운송비', '미분류'];
const taxSideTabs = (side, check = false) => `<div class="seg class-tabs tax-side" role="tablist" aria-label="매출·매입">${(ME.is_admin || ME.roles.includes('sales')) ? `<a role="tab" href="#/sales/tax" class="${side === 'sales' && !check ? 'on' : ''}" aria-selected="${side === 'sales' && !check}">매출 세금계산서 <span class="small muted">(발행)</span></a>` : ''}${(ME.is_admin || ME.roles.includes('purchase')) ? `<a role="tab" href="#/purchase/tax" class="${side === 'purchase' && !check ? 'on' : ''}" aria-selected="${side === 'purchase' && !check}">매입 세금계산서 <span class="small muted">(받음)</span></a>` : ''}<a role="tab" href="${side === 'purchase' ? '#/purchase/tax-check' : '#/sales/tax-check'}" class="${check ? 'on' : ''}" aria-selected="${check}">발행 · 수취 체크</a></div>${check ? `<div class="seg tax-check-side">${(ME.is_admin || ME.roles.includes('sales')) ? `<a href="#/sales/tax-check" class="${side === 'sales' ? 'on' : ''}">매출 발행</a>` : ''}${(ME.is_admin || ME.roles.includes('purchase')) ? `<a href="#/purchase/tax-check" class="${side === 'purchase' ? 'on' : ''}">매입 수취</a>` : ''}</div>` : ''}`;
const taxCatSelect = order => `<label>분류<select name="category"><option value="">전체</option>${order.map(c => `<option>${c}</option>`).join('')}</select></label>`;
// 「원자재:10000|운송비:3000」 → 칩(금액 큰 순이 아니라 분류 순서)
function taxCatChips(cats, withAmount = false) {
  const list = String(cats || '').split('|').filter(Boolean).map(x => { const k = x.lastIndexOf(':'); return [x.slice(0, k), Number(x.slice(k + 1))]; }).sort((a, b) => TAX_CAT_ORDER.indexOf(a[0]) - TAX_CAT_ORDER.indexOf(b[0]));
  return list.map(([c, v]) => `${c === '운송비' ? '<span class="cat-chip cat-none">운송비</span>' : catChip(c === '미분류' ? '' : c)}${withAmount ? ` <span class="small">${won(v)}</span>` : ''}`).join(' ');
}
const taxCatSummary = by => by?.length ? `<div class="small cat-sum">분류별 공급가액: ${by.map(c => `${c.category === '운송비' ? '<span class="cat-chip cat-none">운송비</span>' : catChip(c.category === '미분류' ? '' : c.category)} ${won(c.supply)}원`).join(' · ')}</div>` : '';

async function pagePurchaseTax(main) {
  const r0 = monthRange(todayStr().slice(0, 7));
  main.innerHTML = `<h1>매입 세금계산서</h1>${taxSideTabs('purchase')}
  <p class="muted">매입처에게 받은 세금계산서를 그 매입전표와 묶어 기록합니다(국세청 승인번호·작성일자). 한 매입전표는 계산서 하나에만 담깁니다. 운송비가 있는 전표는 「운송비」로도 찾을 수 있습니다.</p>
  <form class="list-filters toolbar" data-read-only id="ptaxFilters"><label>작성일자<input type="date" name="from" value="${r0.from}"></label><label>~<input type="date" name="to" value="${r0.to}"></label><label>매입처<input name="vendor" maxlength="100"></label>${taxCatSelect(TAX_CAT_ORDER)}<label>상태<select name="status"><option value="">받음</option><option value="cancelled">취소</option></select></label><label class="grow">검색<input type="search" name="q" placeholder="승인번호·매입처·사업자번호·비고"></label><button class="btn primary">조회</button><button type="button" class="btn" data-xlsx>엑셀</button></form>
  <div class="actions" style="justify-content:flex-start"><button type="button" class="btn primary" id="ptaxNew">+ 매입 세금계산서 등록</button></div>
  <div id="ptaxSum" class="counts"></div><div id="ptaxList"></div>`;
  const form = $('#ptaxFilters', main); let rows = [];
  bindPartnerPicker(form.elements.vendor, null, { type: 'purchase' }).catch(() => {});
  const load = async () => {
    const data = await api('GET', '/api/purchase-tax-invoices?' + new URLSearchParams(formObj(form))); if (!main.isConnected) return; rows = data.rows;
    $('#ptaxSum', main).innerHTML = sumLine([['계산서', `${fmtNum(rows.length)}장`], ['공급가액', `${won(rows.reduce((t, r) => t + r.supply_total, 0))}원`], ['세액', `${won(rows.reduce((t, r) => t + r.vat_total, 0))}원`], ['합계', `${won(rows.reduce((t, r) => t + r.total, 0))}원`]]) + taxCatSummary(data.by_category);
    $('#ptaxList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid" data-keep-cols><thead><tr><th>작성일자</th><th>매입처</th><th>분류</th><th>승인번호</th><th class="r">전표</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계</th><th>상태</th><th>입력</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.status === 'cancelled' ? 'row-off' : ''}"><td class="nowrap">${esc(r.write_date)}</td><td data-card-primary><b>${esc(r.vendor)}</b>${r.biz_no ? `<div class="small muted">${esc(r.biz_no)}</div>` : ''}</td><td>${taxCatChips(r.cats, true)}</td><td class="small">${esc(r.approval_no || '')}${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}</td><td class="r">${fmtNum(r.bill_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td>${r.status === 'cancelled' ? `<span class="chip">취소</span><div class="small muted">${esc(r.cancel_reason || '')}</div>` : '<span class="chip green">받음</span>'}</td><td class="small muted">${esc(r.created_by)}</td><td class="nowrap"><button type="button" class="btn small" data-ptax-open="${r.id}">보기</button>${r.status === 'received' ? ` <button type="button" class="btn small danger" data-ptax-cancel="${r.id}">취소</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 매입 세금계산서가 없습니다.</div>';
    $$('[data-ptax-open]', main).forEach(b => b.onclick = () => purchaseTaxView(Number(b.dataset.ptaxOpen)).catch(fail));
    $$('[data-ptax-cancel]', main).forEach(b => b.onclick = async () => { const v = await promptBox('매입 세금계산서 취소', '<label>사유<input name="reason" maxlength="200" placeholder="예) 잘못 등록 · 수정 계산서로 다시 받음"></label>'); if (!v) return; try { await api('POST', `/api/purchase-tax-invoices/${b.dataset.ptaxCancel}/cancel`, v); toast('취소했습니다. 담겼던 전표는 다시 담을 수 있습니다.'); load().catch(fail); } catch (error) { fail(error); } });
  };
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('[data-xlsx]', form).onclick = () => { if (!rows.length) return toast('내려받을 계산서가 없습니다.', 'err'); const v = formObj(form);
    xlsxDownload(`매입세금계산서_${v.from}_${v.to}.xlsx`, { sheet: '매입 세금계산서', titles: ['매입 세금계산서', `${COMPANY_NAME} · 작성일자 ${v.from} ~ ${v.to}${v.category ? ' · 분류 ' + v.category : ''}`],
      columns: [{ label: '작성일자', type: 'date' }, { label: '매입처', type: 'text', width: 20 }, { label: '사업자번호', type: 'text', width: 14 }, { label: '승인번호', type: 'text', width: 28 }, { label: '분류', type: 'text', width: 30 }, { label: '전표 수', type: 'number' }, { label: '공급가액', type: 'money' }, { label: '세액', type: 'money' }, { label: '합계', type: 'money' }, { label: '상태', type: 'text' }, { label: '비고', type: 'text', width: 24 }],
      rows: rows.map(r => [r.write_date, r.vendor, r.biz_no, r.approval_no, String(r.cats || '').split('|').map(x => x.replace(':', ' ')).join(', '), r.bill_count, r.supply_total, r.vat_total, r.total, r.status === 'cancelled' ? '취소' : '받음', r.note]),
      totals: ['합계', '', '', '', '', '', rows.reduce((t, r) => t + r.supply_total, 0), rows.reduce((t, r) => t + r.vat_total, 0), rows.reduce((t, r) => t + r.total, 0), '', ''] }); };
  $('#ptaxNew', main).onclick = () => purchaseTaxNew(() => load()).catch(fail);
  await load().catch(fail);
}
async function purchaseTaxView(id) {
  const inv = await api('GET', '/api/purchase-tax-invoices/' + id);
  const m = modal(`<h3>매입 세금계산서 <span class="small muted">${esc(inv.invoice_no)}${inv.status === 'cancelled' ? ' · 취소' : ''}</span></h3>
    <table class="grid" data-keep-cols><tbody><tr><th>매입처</th><td>${esc(inv.vendor)} ${inv.biz_no ? `<span class="small muted">${esc(inv.biz_no)}</span>` : ''}</td><th>작성일자</th><td>${esc(inv.write_date)}</td></tr>
      <tr><th>승인번호</th><td colspan="3">${esc(inv.approval_no || '—')}</td></tr><tr><th>공급가액</th><td class="r">${won(inv.supply_total)}</td><th>세액 · 합계</th><td class="r">${won(inv.vat_total)} · <b>${won(inv.total)}</b></td></tr>
      ${inv.note ? `<tr><th>비고</th><td colspan="3">${esc(inv.note)}</td></tr>` : ''}</tbody></table>
    <h4>분류별</h4><p>${inv.categories.map(c => `${c.category === '운송비' ? '<span class="cat-chip cat-none">운송비</span>' : catChip(c.category === '미분류' ? '' : c.category)} ${won(c.supply)}원`).join(' · ') || '—'}</p>
    <h4>담긴 매입전표</h4><div class="table-wrap"><table class="grid" data-keep-cols><thead><tr><th>전표번호</th><th>명세서 일자</th><th>명세서 번호</th><th class="r">공급가액(운송비 포함)</th><th class="r">세액</th><th class="r">합계</th></tr></thead><tbody>${inv.bills.map(b => `<tr><td>${esc(b.bill_no)}</td><td>${esc(b.bill_date)}</td><td>${esc(b.statement_no || '')}</td><td class="r">${won(b.supply_total)}${b.freight ? `<div class="small muted">운송비 ${won(b.freight)}</div>` : ''}</td><td class="r">${won(b.vat_total)}</td><td class="r">${won(b.total)}</td></tr>`).join('')}</tbody></table></div>
    <div class="actions"><button class="btn" data-close>닫기</button></div>`, { wide: true });
  $('[data-close]', m.el).onclick = m.close;
}
// 등록: 매입처 → 기간 → 아직 계산서에 안 담긴 확정 매입전표 체크 → 작성일자·승인번호 → 저장. 받은 계산서 합계를 넣으면 맞는지 바로 비교.
async function purchaseTaxNew(after) {
  const r0 = monthRange(todayStr().slice(0, 7)), requestId = crypto.randomUUID();
  const m = modal(`<h3>매입 세금계산서 등록</h3>
    <form><div class="form-grid"><label>매입처 *<input name="vendor" required maxlength="100" autocomplete="off"></label><label>전표 기간<input type="date" name="from" value="${r0.from}"></label><label>~<input type="date" name="to" value="${r0.to}"></label></div>
    <div data-ptax-cands><p class="muted small">매입처를 고르면 아직 계산서에 담지 않은 확정 매입전표가 나옵니다.</p></div>
    <div class="form-grid"><label>작성일자 *<input type="date" name="write_date" required value="${todayStr()}"></label><label>국세청 승인번호<input name="approval_no" maxlength="40" placeholder="예) 20261117-41000012-00000001" inputmode="numeric"></label><label>받은 계산서 합계 <span class="hint">(맞는지 비교)</span><input name="check_total" type="number" min="0" step="1"></label><label class="span3">비고<input name="note" maxlength="500"></label></div>
    <p class="small" data-ptax-sum></p>
    <div class="actions"><button type="button" class="btn" data-close>닫기</button><button class="btn primary">등록</button></div></form>`, { wide: true });
  m.el.classList.add('lr-modal');
  const form = $('form', m.el), box = $('[data-ptax-cands]', form); let cands = [];
  bindPartnerPicker(form.elements.vendor, null, { type: 'purchase' }).catch(() => {});
  const sum = () => { const p = cands.filter((_, i) => $(`[data-pc="${i}"]`, box)?.checked), s = p.reduce((t, b) => t + b.supply_total, 0), v = p.reduce((t, b) => t + b.vat_total, 0), chk = form.elements.check_total.value;
    const diff = chk === '' ? null : Number(chk) - (s + v);
    $('[data-ptax-sum]', form).innerHTML = `${p.length}장 · 공급가액 <b>${won(s)}</b> · 세액 <b>${won(v)}</b> · 합계 <b>${won(s + v)}</b>원${diff == null ? '' : diff === 0 ? ' <span class="chip green">받은 계산서와 같음</span>' : ` <span class="chip red">받은 계산서와 ${won(Math.abs(diff))}원 ${diff > 0 ? '많음' : '적음'}</span>`}`;
    if (p.length) { const last = p.map(b => b.bill_date).sort().at(-1); if (!form.elements.write_date.dataset.touched) form.elements.write_date.value = last; } };
  const load = async () => {
    const vendor = form.elements.vendor.value.trim(); if (!vendor) return;
    const data = await api('GET', '/api/purchase-tax-invoices/candidates?' + new URLSearchParams({ vendor, from: form.elements.from.value, to: form.elements.to.value })); cands = data.rows;
    box.innerHTML = cands.length ? `<div class="table-wrap"><table class="grid" data-keep-cols data-no-sort><thead><tr><th><input type="checkbox" data-pc-all checked aria-label="모두"></th><th>전표번호</th><th>명세서 일자</th><th>명세서 번호</th><th>분류</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계</th></tr></thead><tbody>${cands.map((b, i) => `<tr><td><input type="checkbox" data-pc="${i}" checked></td><td>${esc(b.bill_no)}</td><td>${esc(b.bill_date)}</td><td>${esc(b.statement_no || '')}</td><td>${String(b.categories || '').split(',').filter(Boolean).map(c => catChip(c === '미분류' ? '' : c)).join(' ')}${b.freight ? ` <span class="cat-chip cat-none">운송비 ${won(b.freight)}</span>` : ''}</td><td class="r">${won(b.supply_total)}</td><td class="r">${won(b.vat_total)}</td><td class="r">${won(b.total)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${esc(vendor)}: 이 기간에 계산서에 담지 않은 확정 매입전표가 없습니다.</p>`;
    $('[data-pc-all]', box)?.addEventListener('change', e => { $$('[data-pc]', box).forEach(c => { c.checked = e.target.checked; }); sum(); });
    sum();
  };
  form.elements.vendor.addEventListener('change', () => load().catch(fail));
  form.elements.from.onchange = form.elements.to.onchange = () => load().catch(fail);
  box.addEventListener('change', sum); form.elements.check_total.oninput = sum;
  form.elements.write_date.oninput = () => { form.elements.write_date.dataset.touched = '1'; };
  $('[data-close]', m.el).onclick = m.close;
  form.onsubmit = async e => {
    e.preventDefault(); const ids = cands.filter((_, i) => $(`[data-pc="${i}"]`, box)?.checked).map(b => b.id);
    if (!ids.length) return toast('담을 매입전표를 고르세요.', 'err');
    const v = formObj(form), total = cands.filter(b => ids.includes(b.id)).reduce((t, b) => t + b.total, 0);
    if (v.check_total !== '' && Number(v.check_total) !== total && !await confirmBox(`받은 계산서 합계(${won(Number(v.check_total))}원)와 전표 합계(${won(total)}원)가 다릅니다. 그래도 등록할까요?`)) return;
    try { await api('POST', '/api/purchase-tax-invoices', { request_id: requestId, vendor: v.vendor, write_date: v.write_date, approval_no: v.approval_no, note: v.note, bill_ids: ids }); toast('매입 세금계산서를 등록했습니다.'); m.close(); await after?.(); } catch (error) { fail(error); }
  };
}

// ── 15.129 발행 현황 체크: 달마다 거래처별 전표 합계 대비 발행(받음)·발행 전·안 담음 ──
async function pageTaxCheck(main, side = 'sales') {
  const S = side === 'sales' ? { title: '매출 세금계산서 발행 체크', done: '발행 완료', pending: '담음·발행 전', missing: '안 담음(미발행)', who: '거래처', make: '#/sales/tax/new', list: '#/sales/tax', other: '#/purchase/tax-check', otherLabel: '매입 받음 체크' }
    : { title: '매입 세금계산서 수취 체크', done: '받음(등록)', pending: '', missing: '안 받음', who: '매입처', make: '#/purchase/tax', list: '#/purchase/tax', other: '#/sales/tax-check', otherLabel: '매출 발행 체크' };
  let period = todayStr().slice(0, 7); try { period = sessionStorage.getItem('wpa:tax-check') || period; } catch { /* 편의 기능 */ }
  main.innerHTML = `<h1>${S.title}</h1>${taxSideTabs(side, true)}
  <p class="muted">고른 달(전표 일자 기준)의 확정 ${side === 'sales' ? '매출' : '매입'}전표를 ${S.who}별로 모아, 세금계산서가 ${side === 'sales' ? '발행됐는지·담기만 했는지·아예 안 담겼는지' : '등록(받음)됐는지'} 봅니다. 빨간 줄이 남은 일입니다.</p>
  <form class="toolbar" id="tcForm" data-read-only><label>달<input type="month" name="period" value="${esc(period)}"></label><button type="button" class="btn small" data-tc-step="-1">◀ 전달</button><button type="button" class="btn small" data-tc-step="1">다음 달 ▶</button><button class="btn primary">조회</button><label class="inline"><input type="checkbox" name="only" checked> 남은 일만</label><button type="button" class="btn" data-xlsx>엑셀</button></form>
  <div id="tcSum" class="counts"></div><div id="tcList"></div>`;
  const form = $('#tcForm', main); let data = null;
  const draw = () => {
    const only = form.elements.only.checked, rows = data.rows.filter(r => !only || r.missing > 0 || r.pending > 0), t = data.totals;
    $('#tcSum', main).innerHTML = sumLine([[`${S.who}`, `${fmtNum(data.rows.length)}곳`], ['전표 합계', `${won(t.total)}원`], [S.done, `${won(t.done)}원`], ...(side === 'sales' ? [[S.pending, `<span class="${t.pending ? 'yellow-text' : ''}">${won(t.pending)}원</span>`]] : []), [S.missing, `<span class="${t.missing ? 'red-text' : ''}">${won(t.missing)}원</span>`]]);
    const state = r => r.missing > 0 ? `<span class="chip red">${side === 'sales' ? '미발행' : '미수취'} ${r.missing_n}장</span>` : r.pending > 0 ? `<span class="chip yellow">발행 전 ${r.pending_n}장</span>` : '<span class="chip green">완료</span>';
    $('#tcList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid" data-keep-cols><thead><tr><th>${S.who}</th><th>사업자번호</th><th class="r">전표</th><th class="r">전표 합계</th><th class="r">${S.done}</th>${side === 'sales' ? `<th class="r">${S.pending}</th>` : ''}<th class="r">${S.missing}</th><th>상태</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.missing > 0 ? 'tc-missing' : r.pending > 0 ? 'tc-pending' : ''}"><td data-card-primary><b>${esc(r.name)}</b></td><td>${r.biz_no ? esc(r.biz_no) : '<span class="chip red">없음</span>'}</td><td class="r">${fmtNum(r.bills)}</td><td class="r">${won(r.total)}</td><td class="r">${won(r.done)}${r.done_n ? ` <span class="small muted">(${r.done_n})</span>` : ''}</td>${side === 'sales' ? `<td class="r">${r.pending ? won(r.pending) : ''}</td>` : ''}<td class="r">${r.missing ? `<b class="red-text">${won(r.missing)}</b>` : ''}</td><td>${state(r)}</td>
        <td class="nowrap">${r.missing > 0 ? `<a class="btn small" href="${S.make}" data-tc-go="${esc(r.name)}">${side === 'sales' ? '계산서 만들기' : '받은 계산서 등록'}</a>` : r.pending > 0 ? `<a class="btn small" href="${S.list}">발행하러 가기</a>` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th><td></td><td class="r">${fmtNum(t.bills)}</td><td class="r">${won(t.total)}</td><td class="r">${won(t.done)}</td>${side === 'sales' ? `<td class="r">${won(t.pending)}</td>` : ''}<td class="r">${won(t.missing)}</td><td></td><td></td></tr></tfoot></table></div>`
      : `<div class="empty">${only && data.rows.length ? `${data.period}: 남은 일이 없습니다. 모두 ${side === 'sales' ? '발행' : '수취'} 완료.` : `${data.period}에 확정 전표가 없습니다.`}</div>`;
  };
  const load = async () => { try { sessionStorage.setItem('wpa:tax-check', form.elements.period.value); } catch { /* 편의 기능 */ } data = await api('GET', '/api/tax-check?' + new URLSearchParams({ side, period: form.elements.period.value })); if (main.isConnected) draw(); };
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  form.elements.only.onchange = () => data && draw();
  form.elements.period.onchange = () => load().catch(fail);
  $$('[data-tc-step]', form).forEach(b => b.onclick = () => { const [y, m] = form.elements.period.value.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.tcStep), 1)); form.elements.period.value = d.toISOString().slice(0, 7); load().catch(fail); });
  $('[data-xlsx]', form).onclick = () => { if (!data) return; xlsxDownload(`${S.title}_${data.period}.xlsx`, { sheet: S.title.slice(0, 31), titles: [S.title, `${COMPANY_NAME} · ${data.period}(전표 일자 기준)`],
    columns: [{ label: S.who, type: 'text', width: 22 }, { label: '사업자번호', type: 'text', width: 14 }, { label: '전표', type: 'number' }, { label: '전표 합계', type: 'money' }, { label: S.done, type: 'money' }, ...(side === 'sales' ? [{ label: S.pending, type: 'money' }] : []), { label: S.missing, type: 'money' }],
    rows: data.rows.map(r => [r.name, r.biz_no || '', r.bills, r.total, r.done, ...(side === 'sales' ? [r.pending] : []), r.missing]), totals: ['합계', '', data.totals.bills, data.totals.total, data.totals.done, ...(side === 'sales' ? [data.totals.pending] : []), data.totals.missing] }); };
  $('#tcList', main).addEventListener('click', e => { const a = e.target.closest('[data-tc-go]'); if (!a) return; try { sessionStorage.setItem('wpa:tax-go', JSON.stringify({ name: a.dataset.tcGo, period: form.elements.period.value })); } catch { /* 편의 기능 */ } });
  await load().catch(fail);
}
// 직접 발행 기록(홈택스 등): 체크한 「발행 전」 계산서 한 장 → 승인번호·발행일 → 「발행 완료」
async function markIssuedWindow(inv, after) {
  const v = await promptBox(`직접 발행 기록 · ${inv.customer} ${won(inv.total)}원`, `<p class="small muted">트러스빌 연동 전에 홈택스 등에서 직접 발행한 계산서를 「발행 완료」로 기록합니다. 잘못 기록하면 「직접 발행 되돌리기」로 되돌릴 수 있습니다.</p>
    <label>국세청 승인번호 *<input name="approval_no" required maxlength="40" placeholder="예) 20261117-41000012-00000001"></label><label>발행일 *<input type="date" name="issued_date" required value="${esc(inv.write_date || todayStr())}" max="${todayStr()}"></label>`);
  if (!v) return;
  try { await api('POST', `/api/tax-invoices/${inv.id}/mark-issued`, v); toast('발행 완료로 기록했습니다.'); await after?.(); } catch (error) { fail(error); }
}
