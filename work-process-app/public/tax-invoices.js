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
    <label>세금계산서 이메일 1<input name="tax_email" type="email" maxlength="100" value="${esc(v.tax_email || '')}"></label><label>세금계산서 이메일 2<input name="tax_email2" type="email" maxlength="100" value="${esc(v.tax_email2 || '')}"></label><label class="inline span2"><input type="checkbox" name="tax_reverse" value="1"${v.tax_reverse ? ' checked' : ''}> 역발행 거래처 <span class="hint">(거래처가 계산서를 발행 요청 — 예: 삼성전자·삼성디스플레이. 담으면 「역발행」으로 표시되고 트러스빌 발행에서 빠짐)</span></label></div>`, { wide: true, submit: body => api('PUT', `/api/vendors/${v.id}/tax-info`, body) });
  if (values) { toast('사업자 정보를 저장했습니다.'); await after?.(); }
}
async function editCompanyTaxInfo() {
  let c; try { c = await api('GET', '/api/tax-company'); } catch (error) { return fail(error); }
  const values = await promptBox('우리 회사 사업자 정보', `<p class="small muted">세금계산서 공급자 정보입니다(관리자만 고칠 수 있음).</p>
    <div class="form-grid"><label>사업자등록번호 *<input name="biz_no" maxlength="12" inputmode="numeric" required value="${esc(c.biz_no)}"></label><label>상호 *<input name="biz_name" maxlength="100" required value="${esc(c.biz_name || COMPANY_NAME)}"></label>
    <label>대표자 *<input name="ceo" maxlength="50" required value="${esc(c.ceo)}"></label><label class="span2">주소<input name="address" maxlength="200" value="${esc(c.address)}"></label>
    <label>업태<input name="biz_type" maxlength="100" value="${esc(c.biz_type)}"></label><label>종목<input name="biz_item" maxlength="100" value="${esc(c.biz_item)}"></label>
    <label>담당 이메일<input name="email" type="email" maxlength="100" value="${esc(c.email)}"></label><label>담당 전화<input name="phone" maxlength="30" value="${esc(c.phone)}"></label><label>팩스 <span class="hint">(견적서)</span><input name="fax" maxlength="30" value="${esc(c.fax)}"></label><label class="span2">입금 계좌 <span class="hint">(거래명세서에 나감)</span><input name="bank" maxlength="100" value="${esc(c.bank || '')}" placeholder="예) 기업은행 123-456789-01-011 (주)서울세미텍"></label></div>`, { wide: true, submit: body => api('PUT', '/api/tax-company', body) });
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
  rememberList(form); // 15.264 기간·검색어 등 보던 조건 유지(다른 탭 갔다 와도)
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
  const pending = ['draft', 'failed'].includes(inv.status), reverseEdit = inv.issue_type === 'reverse' && inv.status !== 'cancelled';
  const c = inv.company || {}, editable = pending || reverseEdit; // 15.164 역발행은 발행 기록 뒤에도 고침
  const recv = ['issued', 'sent'].includes(inv.status) ? (RECV_LABEL[inv.recv_status || '']?.[0] || '') : '';
  const statusBar = `<table class="taxf-status"><tbody>
    <tr><th>문서 구분</th><td colspan="5">${editable ? `<label class="inline"><input type="radio" name="taxf-doc" value="tax"${inv.doc_type !== 'free' ? ' checked' : ''}> 세금계산서</label> <label class="inline"><input type="radio" name="taxf-doc" value="free"${inv.doc_type === 'free' ? ' checked' : ''}${Number(inv.vat_total) !== 0 ? ' disabled title="세액이 있는 전표는 세금계산서만"' : ''}> 계산서(면세)</label> <span class="small muted">세액 0인 영세율 거래는 「세금계산서」, 면세 거래는 「계산서」</span>` : inv.doc_type === 'free' ? '계산서(면세)' : '세금계산서'}</td></tr>
    ${pending ? `<tr><th>발행구분</th><td colspan="5"><label class="inline"><input type="radio" name="taxf-issue" value="normal"${inv.issue_type !== 'reverse' ? ' checked' : ''}> 정발행(우리가 발행)</label> <label class="inline"><input type="radio" name="taxf-issue" value="reverse"${inv.issue_type === 'reverse' ? ' checked' : ''}> 역발행(거래처가 발행 요청)</label></td></tr>` : ''}
    <tr><th>문서상태</th><td>${inv.issue_type === 'reverse' ? '<span class="chip red">역발행</span> ' : ''}${taxChip(inv.status)}${recv ? ` · ${esc(recv)}` : ''}</td><th>국세청 전송</th><td>${inv.status === 'sent' ? '전송' : '미전송'}</td><th>구분</th><td>${inv.kind === 'single' ? '건별' : `월별 ${esc(inv.period_from)} ~ ${esc(inv.period_to)}`}</td></tr>
    <tr><th>받는 이메일</th><td colspan="3">${editable ? `<input type="email" class="taxf-in" data-tf="email1" maxlength="100" value="${esc(inv.email1)}" aria-label="받는 이메일 1" placeholder="이메일 1 (필수)"> <input type="email" class="taxf-in" data-tf="email2" maxlength="100" value="${esc(inv.email2)}" aria-label="받는 이메일 2" placeholder="이메일 2">` : `${esc(inv.email1)}${inv.email2 ? ' · ' + esc(inv.email2) : ''}`}</td><th>승인번호</th><td>${reverseEdit ? `<input class="taxf-in" data-tf="approval_no" maxlength="40" inputmode="numeric" value="${esc(inv.approval_no || '')}" aria-label="승인번호" placeholder="역발행 승인번호">` : esc(inv.approval_no || '')}</td></tr>
    <tr><th>비고</th><td colspan="3">${editable ? `<input class="taxf-in" data-tf="note" maxlength="200" value="${esc(inv.note)}" aria-label="비고">` : esc(inv.note || '')}</td><th>담긴 전표</th><td class="small">${inv.bills.filter(b => b.active).map(b => esc(b.bill_no)).join(', ')}</td></tr>
    ${inv.status_message ? `<tr><th>메시지</th><td colspan="5" class="small">${esc(inv.status_message)}</td></tr>` : ''}</tbody></table>`;
  const m = modal(`<h3>${inv.doc_type === 'free' ? '계산서' : '세금계산서'} <span class="small muted">${esc(inv.invoice_no)} · ${inv.kind === 'single' ? '건별' : '월별'}</span> ${taxChip(inv.status)}${editable ? ' <span class="small muted">· 칸을 눌러 바로 고친 뒤 「저장」</span>' : ''}</h3>
    ${taxFormHtml({ side: 'sales', inv, supplier: c, buyer: inv, items: inv.items, editable, editAmounts: editable, charge: inv.charge, statusBar })}${editable ? '<p class="small" data-tax-check></p><p class="small muted">수량·단가를 바꾸면 공급가액·세액을 다시 계산합니다(직접 고쳐도 됨). 품목명을 넣으면 줄이 보태지고 비우면 빠집니다. 줄 금액 합은 계산서 합계와 같아야 저장됩니다.</p>' : ''}
    <div class="actions">${editable ? '<button class="btn" data-tax-refresh>거래처 정보 다시 불러오기</button>' : ''}<button class="btn" data-close>닫기</button><button class="btn" data-print>인쇄 · PDF 저장</button>${editable ? '<button class="btn primary" data-tax-save>저장</button>' : ''}</div>`, { wide: true });
  m.el.classList.add('taxf-modal');
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`세금계산서_${inv.invoice_no}`);
  const reopen = async r => { m.close(); taxInvoiceView({ ...r, company: c }, after); await after?.(); };
  $('[data-tax-refresh]', m.el)?.addEventListener('click', async () => { try { reopen(await api('PUT', `/api/tax-invoices/${inv.id}`, { refresh_customer: true })); toast('거래처 사업자 정보를 다시 불러왔습니다.'); } catch (error) { fail(error); } });
  if (!editable) return;
  const ed = taxItemEditor(m.el, inv);
  // 작성일자를 바꾸면 아래 품목 월일도 같이 바뀐다.
  const wd = $('[data-tf="write_date"]', m.el);
  wd.addEventListener('change', () => { if (!wd.value) return; $$('[data-ti="date"]', m.el).forEach(x => { if (x.value) { x.value = wd.value; x.classList.add('auto-filled'); } }); });
  $('[data-tax-save]', m.el).onclick = async e => {
    const tf = k => $(`[data-tf="${k}"]`, m.el)?.value ?? '';
    if (!wd.value) { wd.focus(); return toast('작성일자를 넣으세요.', 'err'); }
    const issue = $('[name="taxf-issue"]:checked', m.el)?.value || inv.issue_type || 'normal';
    if (issue !== 'reverse' && !tf('email1').trim()) { $('[data-tf="email1"]', m.el).focus(); return toast('받는 이메일 1을 넣으세요.', 'err'); }
    const items = ed.collect();
    if (!items.length) return toast('품목을 한 줄 이상 넣으세요.', 'err');
    if (!ed.check()) return toast('품목 줄 합계가 계산서 합계와 다릅니다. 금액을 맞춰 주세요.', 'err');
    const body = { doc_type: $('[name="taxf-doc"]:checked', m.el)?.value || inv.doc_type || 'tax', write_date: wd.value, charge: $('[name="taxf-charge"]:checked', m.el)?.value || inv.charge, email1: tf('email1'), email2: tf('email2'), note: tf('note'),
      buyer: Object.fromEntries(['biz_no', 'biz_name', 'ceo', 'address', 'biz_type', 'biz_item'].map(k => [k, tf(k)])), items, issue_type: issue, version: inv.updated_at ?? null, ...(reverseEdit ? { approval_no: tf('approval_no') } : {}) };
    e.target.disabled = true;
    try { const r = await api('PUT', `/api/tax-invoices/${inv.id}`, body); toast('계산서를 고쳤습니다.'); reopen(r); } catch (error) { fail(error); e.target.disabled = false; }
  };
}

async function pageTaxList(main) {
  const r0 = { from: monthRange(prevMonth()).from, to: monthRange(todayStr().slice(0, 7)).to }; // 15.137 지난 달 월별 계산서(작성일 말일)도 보이게
  main.innerHTML = `<h1>세금계산서 관리</h1>${taxSideTabs('sales')}
  <p class="muted">담은 세금계산서를 체크하고 「발행」을 누르면 트러스빌로 발행합니다. 발행 전에는 작성일자·받는 이메일(2곳까지)을 고치거나 「담기 취소」할 수 있습니다.</p>
  <div class="tax-link" id="taxLink"></div>
  <form class="list-filters toolbar" data-read-only id="taxFilters"><label>작성일자<input type="date" name="from" value="${r0.from}"></label><label>~<input type="date" name="to" value="${r0.to}"></label><label>거래처<input name="customer" maxlength="100"></label>${taxCatSelect(['원자재', '부자재', '반제품', '제품', '상품', '임가공', '미분류'])}<label>상태<select name="status"><option value="">전체(담기 취소 제외)</option>${Object.entries(TAX_STATUS_LABEL).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label>발행구분<select name="issue_type"><option value="">전체</option><option value="normal">정발행</option><option value="reverse">역발행</option></select></label><label>문서<select name="doc"><option value="">전체</option><option value="tax">세금계산서</option><option value="free">계산서(면세)</option></select></label><label>수신·국세청<select name="state"><option value="">전체</option><option value="draft">발행 전</option><option value="unconfirmed">수신자 미확인</option><option value="confirmed">수신 확인</option><option value="rejected">수신 거부</option><option value="nts_pending">국세청 미전송</option><option value="nts_sent">국세청 전송</option></select></label><label class="grow">검색<input type="search" name="q" placeholder="거래처·사업자번호·품목·이메일·승인번호"></label><button class="btn primary">조회</button></form>
  <div class="actions tax-actions" style="justify-content:flex-start"><button type="button" class="btn primary" id="taxIssue">발행</button><button type="button" class="btn tax-more-toggle" aria-expanded="false">더보기 ▾</button><button type="button" class="btn" id="taxMark" title="홈택스 등에서 직접 발행한 계산서를 승인번호와 함께 기록">직접 발행 기록</button><button type="button" class="btn" id="taxUnmark">직접 발행 되돌리기</button><button type="button" class="btn" id="taxState" title="상대방 수신 확인·국세청 전송·정발행/역발행을 표시(트러스빌 연동 전에는 홈택스에서 확인한 대로 손으로)">상태 변경</button><button type="button" class="btn" id="taxCancel">담기 취소</button>${ME.is_admin ? '<button type="button" class="btn" id="taxCompany">우리 회사 정보</button>' : ''}<button type="button" class="btn" id="taxXlsx">엑셀</button></div>
  <div id="taxList"></div><div id="taxSummary"></div><div id="taxCounts" class="counts"></div>`;
  const form = $('#taxFilters', main); let rows = [];
  const load = async () => {
    const data = await api('GET', '/api/tax-invoices?' + new URLSearchParams(formObj(form))); if (!main.isConnected) return;
    rows = data.rows;
    $('#taxLink', main).innerHTML = data.linked ? '' : '<p class="card small"><span class="chip yellow">연동 준비 중</span> 트러스빌 연동이 아직 연결되지 않았습니다. 계산서를 담고 고칠 수는 있지만 「발행」은 연결 뒤에 됩니다.</p>';
    $('#taxList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid bill-grid tax-grid"><caption class="sr-only">세금계산서</caption><thead><tr><th scope="col"><input type="checkbox" data-tax-all aria-label="전체 선택"></th><th>문서상태</th><th>작성일자</th><th>구분</th><th>거래처</th><th>사업자번호</th><th>받는 이메일</th><th>품목</th><th class="r">공급가액</th><th class="r">세액</th><th class="r">합계</th><th>청구/영수</th><th>승인번호</th></tr></thead><tbody>${rows.map(r => `<tr class="tax-row ${r.status === 'cancelled' ? 'row-off' : r.status === 'failed' ? 'row-red' : ''}" data-tax-open="${r.id}" tabindex="0" title="눌러서 보기·고치기"><td>${r.status !== 'cancelled' ? `<input type="checkbox" data-tax-pick="${r.id}" aria-label="${esc(r.invoice_no)} 선택">` : ''}</td><td>${taxDocState(r)}</td><td class="nowrap">${esc(r.write_date)}</td><td>${r.kind === 'single' ? '건별' : '월별'}</td><td data-card-primary><b>${esc(r.customer)}</b><div>${taxCatChips(r.cats)}</div></td><td class="nowrap">${r.biz_no ? esc(r.biz_no) : '<span class="chip red">없음</span>'}</td><td class="small">${r.email1 ? esc(r.email1) : '<span class="chip yellow">없음</span>'}${r.email2 ? `<div>${esc(r.email2)}</div>` : ''}</td><td>${esc(r.item_summary)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td>${CHARGE_LABEL[r.charge]}</td><td class="small">${esc(r.approval_no)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 세금계산서가 없습니다.</div>';
    const live = rows.filter(r => r.status !== 'cancelled'), count = s => rows.filter(r => r.status === s).length;
    $('#taxSummary', main).innerHTML = taxSummaryBox(data.summary);
    $('#taxCounts', main).innerHTML = `<b>${esc(`${live.length}장 · 공급가액 ${won(live.reduce((t, r) => t + r.supply_total, 0))}원 · 세액 ${won(live.reduce((t, r) => t + r.vat_total, 0))}원 · 합계 ${won(live.reduce((t, r) => t + r.supply_total + r.vat_total, 0))}원`)}</b> <span>${esc(`발행 전 ${count('draft')} · 발행 요청 ${count('queued')} · 발행 완료 ${count('issued')} · 국세청 전송 ${count('sent')} · 실패 ${count('failed')}`)}</span>${data.more ? ' <span>(더 있음)</span>' : ''}` + taxCatSummary(data.by_category);
    const all = $('[data-tax-all]', main); if (all) all.onchange = () => $$('[data-tax-pick]', main).forEach(x => { x.checked = all.checked; });
    const heads = $$('#taxList thead th', main).map(th => th.textContent.trim()); $$('#taxList tbody tr', main).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = i === 0 ? '' : heads[i] || ''; }));
  };
  const picked = () => $$('[data-tax-pick]:checked', main).map(x => Number(x.dataset.taxPick));
  rememberList(form); // 15.264 기간·검색어 등 보던 조건 유지(다른 탭 갔다 와도)
  rangePresets(form.elements.from, form.elements.to, { onPick: () => load().catch(fail) });
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('.tax-more-toggle', main).onclick = e => { const a = e.currentTarget.parentElement, on = a.classList.toggle('show-more'); e.currentTarget.setAttribute('aria-expanded', String(on)); e.currentTarget.textContent = on ? '접기 ▴' : '더보기 ▾'; }; // 15.219
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
  // 15.138 상태 변경: 상대방 수신 확인·거부·미확인, 국세청 전송·미전송, 정발행·역발행
  $('#taxState', main).onclick = async () => {
    const ids = picked(); if (!ids.length) return toast('상태를 바꿀 계산서를 체크하세요.', 'err');
    const v = await promptBox(`상태 변경 · ${ids.length}장`, `<p class="small muted">트러스빌 연동 전에는 홈택스·이메일에서 확인한 대로 손으로 표시합니다(연동 뒤에는 자동). 수신·국세청 상태는 발행된 계산서만 바뀝니다.</p>
      <fieldset class="stack tax-state-pick"><legend>상대방 수신</legend><label class="inline"><input type="radio" name="action" value="recv_confirm" required> 수신 확인</label><label class="inline"><input type="radio" name="action" value="recv_reject"> 수신 거부</label><label class="inline"><input type="radio" name="action" value="recv_reset"> 수신자 미확인으로</label></fieldset>
      <fieldset class="stack tax-state-pick"><legend>국세청</legend><label class="inline"><input type="radio" name="action" value="nts_sent"> 국세청 전송 완료</label><label class="inline"><input type="radio" name="action" value="nts_unsent"> 국세청 미전송으로</label></fieldset>
      <fieldset class="stack tax-state-pick"><legend>발행구분</legend><label class="inline"><input type="radio" name="action" value="reverse"> 역발행</label><label class="inline"><input type="radio" name="action" value="normal"> 정발행</label></fieldset>`);
    if (!v?.action) return;
    try { const r = await api('POST', '/api/tax-invoices/state', { ids, action: v.action }); toast(`${r.changed}장을 「${r.label}」(으)로 표시했습니다.`); await load(); } catch (error) { fail(error); }
  };
  // 15.129 직접 발행 기록(한 장씩) · 되돌리기
  $('#taxMark', main).onclick = async () => { const ids = picked(); if (ids.length !== 1) return toast('직접 발행으로 기록할 계산서를 한 장만 체크하세요.', 'err'); const inv = rows.find(r => r.id === ids[0]); if (!['draft', 'failed'].includes(inv.status)) return toast('발행 전 계산서만 기록할 수 있습니다.', 'err'); await markIssuedWindow(inv, load); };
  $('#taxUnmark', main).onclick = async () => { const ids = picked(); if (ids.length !== 1) return toast('되돌릴 계산서를 한 장만 체크하세요.', 'err'); if (!await confirmBox('직접 발행 기록을 지우고 「발행 전」으로 되돌릴까요? (승인번호도 지워집니다)')) return; try { await api('POST', `/api/tax-invoices/${ids[0]}/unmark-issued`, {}); toast('발행 전으로 되돌렸습니다.'); await load(); } catch (error) { fail(error); } };
  $('#taxXlsx', main).onclick = () => {
    if (!rows.length) return toast('내려받을 계산서가 없습니다.', 'err');
    const v = formObj(form);
    xlsxDownload(`세금계산서_${v.from || ''}_${v.to || ''}.xlsx`, { sheet: '세금계산서', titles: ['세금계산서', `${COMPANY_NAME} · 작성일자 ${v.from || ''} ~ ${v.to || ''}`],
      columns: [{ label: '계산서번호', type: 'text', width: 15 }, { label: '문서상태', type: 'text', width: 24 }, { label: '작성일자', type: 'date' }, { label: '구분', type: 'text', width: 7 }, { label: '거래처', type: 'text', width: 20 }, { label: '사업자번호', type: 'text', width: 14 }, { label: '이메일 1', type: 'text', width: 22 }, { label: '이메일 2', type: 'text', width: 22 }, { label: '품목', type: 'text', width: 22 }, { label: '공급가액', type: 'money', width: 14 }, { label: '세액', type: 'money', width: 12 }, { label: '합계', type: 'money', width: 14 }, { label: '청구/영수', type: 'text', width: 9 }, { label: '승인번호', type: 'text', width: 26 }],
      rows: rows.map(r => [r.invoice_no, `${r.issue_type === 'reverse' ? '역발행 · ' : ''}${TAX_STATUS_LABEL[r.status][0]}${['issued', 'sent'].includes(r.status) ? ' · ' + RECV_LABEL[r.recv_status || ''][0] : ''}`, r.write_date, r.kind === 'single' ? '건별' : '월별', r.customer, r.biz_no, r.email1, r.email2, r.item_summary, r.supply_total, r.vat_total, r.total, CHARGE_LABEL[r.charge], r.approval_no]),
      totals: ['합계', '', '', '', '', '', '', '', '', rows.filter(r => r.status !== 'cancelled').reduce((t, r) => t + r.supply_total, 0), rows.filter(r => r.status !== 'cancelled').reduce((t, r) => t + r.vat_total, 0), rows.filter(r => r.status !== 'cancelled').reduce((t, r) => t + r.total, 0), '', ''] });
  };
  // 15.164 줄을 누르면(또는 Enter) 계산서 창. 체크칸·버튼·링크를 누른 것은 빼고.
  $('#taxList', main).addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr[data-tax-open]')) e.target.click(); });
  $('#taxList', main).addEventListener('click', async e => { if (e.target.closest('input, button, a, label, select')) return; const b = e.target.closest('[data-tax-open]'); if (!b) return; try { taxInvoiceView(await api('GET', '/api/tax-invoices/' + b.dataset.taxOpen), load); } catch (error) { fail(error); } });
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
      <tbody>${rows.map(r => `<tr class="tax-row ${r.status === 'cancelled' ? 'row-off' : ''}" data-ptax-open="${r.id}" tabindex="0" title="눌러서 보기·고치기"><td class="nowrap">${esc(r.write_date)}</td><td data-card-primary><b>${esc(r.vendor)}</b>${r.issue_type === 'reverse' ? ' <span class="chip red tax-rev">역발행</span>' : ''}${r.doc_type === 'free' ? ' <span class="chip blue">계산서</span>' : ''}${r.biz_no ? `<div class="small muted">${esc(r.biz_no)}</div>` : ''}</td><td>${taxCatChips(r.cats, true)}</td><td class="small">${esc(r.approval_no || '')}${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}</td><td class="r">${fmtNum(r.bill_count)}</td><td class="r">${won(r.supply_total)}</td><td class="r">${won(r.vat_total)}</td><td class="r"><b>${won(r.total)}</b></td><td>${r.status === 'cancelled' ? `<span class="chip">취소</span><div class="small muted">${esc(r.cancel_reason || '')}</div>` : '<span class="chip green">받음</span>'}</td><td class="small muted">${esc(r.created_by)}</td><td class="nowrap">${r.status === 'received' ? ` <button type="button" class="btn small danger" data-ptax-cancel="${r.id}">취소</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 매입 세금계산서가 없습니다.</div>';
    $$('tr[data-ptax-open]', main).forEach(tr => { tr.onclick = e => { if (e.target.closest('input, button, a, label, select')) return; purchaseTaxView(Number(tr.dataset.ptaxOpen), () => load()).catch(fail); }; tr.onkeydown = e => { if (e.key === 'Enter' && e.target === tr) tr.click(); }; }); // 15.164 줄을 누르면 창
    $$('[data-ptax-cancel]', main).forEach(b => b.onclick = async () => { const v = await promptBox('매입 세금계산서 취소', '<label>사유<input name="reason" maxlength="200" placeholder="예) 잘못 등록 · 수정 계산서로 다시 받음"></label>'); if (!v) return; try { await api('POST', `/api/purchase-tax-invoices/${b.dataset.ptaxCancel}/cancel`, v); toast('취소했습니다. 담겼던 전표는 다시 담을 수 있습니다.'); load().catch(fail); } catch (error) { fail(error); } });
  };
  rememberList(form); // 15.264 기간·검색어 등 보던 조건 유지(다른 탭 갔다 와도)
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
// 15.162 세금계산서 품목 줄 편집(매출·매입 같은 방식): 수량·단가를 바꾸면 공급가액·세액을 다시 계산(직접 고쳐도 됨), 품목명을 넣으면 줄 추가·비우면 빠짐,
// 줄 금액 합이 계산서 합계와 같은지 [data-tax-check]에 바로 보여 준다. collect()는 저장할 줄 목록.
function taxItemEditor(el, inv) {
  const free = inv.doc_type === 'free', zero = Number(inv.vat_total) === 0;
  const cell = (f, k) => $(`[data-ti="${f}"][data-k="${k}"]`, el), keys = $$('[data-ti="item"]', el).map(x => x.dataset.k);
  const n = v => { const t = String(v ?? '').replace(/,/g, '').trim(); return t === '' ? null : Number(t); };
  const check = () => {
    let s = 0, v = 0; for (const k of keys) { if (!cell('item', k).value.trim()) continue; s += n(cell('supply', k)?.value) || 0; v += n(cell('vat', k)?.value) || 0; }
    const ok = s === Number(inv.supply_total) && v === Number(inv.vat_total), box = $('[data-tax-check]', el);
    if (box) box.innerHTML = `품목 합계 공급가액 <b>${won(s)}</b> · 세액 <b>${won(v)}</b> ${ok ? '<span class="chip green">계산서 합계와 같음</span>' : `<span class="chip red">계산서 합계(공급가액 ${won(inv.supply_total)} · 세액 ${won(inv.vat_total)})와 다름</span>`}`;
    return ok;
  };
  const wd = $('[data-tf="write_date"]', el);
  el.addEventListener('input', e => {
    const k = e.target.dataset.k, f = e.target.dataset.ti; if (k === undefined || !f) return;
    if (f === 'qty' || f === 'unit_price') { const q = n(cell('qty', k).value), p = n(cell('unit_price', k).value); if (q != null && p != null && Number.isFinite(q * p)) { const sup = Math.trunc(q * p); cell('supply', k).value = sup; if (cell('vat', k)) cell('vat', k).value = free || zero ? 0 : Math.trunc(sup * 0.1); } }
    if (f === 'supply' && cell('vat', k) && !free && !zero) { const sup = n(e.target.value); if (sup != null) cell('vat', k).value = Math.trunc(sup * 0.1); }
    if (f === 'item' && e.target.value.trim() && !cell('date', k).value && wd) cell('date', k).value = wd.value;
    check();
  });
  check();
  const collect = () => keys.filter(k => cell('item', k).value.trim()).map(k => ({ date: cell('date', k).value || wd?.value, item: cell('item', k).value, spec: cell('spec', k).value, qty: n(cell('qty', k).value), unit_price: n(cell('unit_price', k).value), supply: n(cell('supply', k).value) ?? 0, vat: free ? 0 : n(cell('vat', k)?.value) ?? 0, note: cell('note', k).value }));
  return { check, collect };
}
async function purchaseTaxView(id, after = null, edit = false) {
  const inv = await api('GET', '/api/purchase-tax-invoices/' + id);
  const sup = inv.supplier || {}, supplier = { biz_no: inv.biz_no || sup.biz_no, biz_name: sup.biz_name || inv.vendor, ceo: sup.ceo, address: sup.address, biz_type: sup.biz_type, biz_item: sup.biz_item };
  const canEdit = inv.status !== 'cancelled', editing = edit && canEdit;
  const items = inv.items || [];
  const statusBar = `<table class="taxf-status"><tbody><tr><th>상태</th><td>${inv.status === 'cancelled' ? '취소' : '받음(등록)'}${inv.issue_type === 'reverse' ? ' · <span class="chip red">역발행</span>' : ''}${inv.items_edited ? ' · <span class="chip">품목 고침</span>' : ''}</td><th>승인번호</th><td>${editing ? `<input class="taxf-in" data-tf="approval_no" maxlength="40" inputmode="numeric" value="${esc(inv.approval_no || '')}" aria-label="승인번호">` : esc(inv.approval_no || '—')}</td><th>분류별</th><td class="small">${inv.categories.map(c => `${esc(c.category)} ${won(c.supply)}`).join(' · ')}</td></tr>
    <tr><th>비고</th><td colspan="3">${editing ? `<input class="taxf-in" data-tf="note" maxlength="500" value="${esc(inv.note || '')}" aria-label="비고">` : esc(inv.note || '')}</td><th>담긴 전표</th><td class="small">${inv.bills.map(b => esc(b.bill_no)).join(', ')}</td></tr></tbody></table>
    ${(inv.changes || []).length ? `<details class="small taxf-hist"><summary>고친 이력 ${inv.changes.length}건</summary>${inv.changes.map(c => `<div>${esc(String(c.changed_at).slice(0, 16))} · ${esc(c.changed_by)} · ${esc(c.summary)}</div>`).join('')}</details>` : ''}`;
  const m = modal(`<h3>매입 ${inv.doc_type === 'free' ? '계산서' : '세금계산서'} <span class="small muted">${esc(inv.invoice_no)}${inv.status === 'cancelled' ? ' · 취소' : ''}</span>${editing ? ' <span class="chip yellow">고치는 중</span>' : ''}</h3>
    ${taxFormHtml({ side: 'purchase', inv, supplier, buyer: inv.company || {}, items, editable: editing, editParty: false, editAmounts: editing, charge: 'claim', statusBar })}
    ${editing ? '<p class="small" data-tax-check></p><p class="small muted">품목 줄의 공급가액·세액 합은 담긴 매입전표 합계와 같아야 저장됩니다. 품목명을 비운 줄은 빠집니다. 수량·단가를 고치면 공급가액·세액을 다시 계산합니다(직접 고쳐도 됨).</p>' : ''}
    <div class="actions"><button class="btn" data-close>${editing ? '취소' : '닫기'}</button>${editing ? '<button class="btn primary" data-ptax-save>저장</button>' : `${canEdit ? '<button class="btn" data-ptax-edit>수정</button>' : ''}<button class="btn primary" data-print>인쇄 · PDF 저장</button>`}</div>`, { wide: true });
  m.el.classList.add('taxf-modal'); m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = () => { m.close(); if (editing) purchaseTaxView(id, after); };
  $('[data-print]', m.el)?.addEventListener('click', () => rcPrint(`매입세금계산서_${inv.invoice_no}`));
  $('[data-ptax-edit]', m.el)?.addEventListener('click', () => { m.close(); purchaseTaxView(id, after, true); });
  if (!editing) return;
  const ed = taxItemEditor(m.el, inv), check = ed.check, wd = $('[data-tf="write_date"]', m.el);
  wd.addEventListener('change', () => { if (wd.value) $$('[data-ti="date"]', m.el).forEach(d => { if (d.value) { d.value = wd.value; d.classList.add('auto-filled'); } }); });
  $('[data-ptax-save]', m.el).onclick = async e => {
    if (!wd.value) { wd.focus(); return toast('작성일자를 넣으세요.', 'err'); }
    const rows = ed.collect();
    if (!rows.length) return toast('품목을 한 줄 이상 넣으세요.', 'err');
    if (!check()) return toast('품목 합계가 담긴 매입전표 합계와 다릅니다. 금액을 맞춰 주세요.', 'err');
    e.target.disabled = true;
    try { await api('PUT', `/api/purchase-tax-invoices/${inv.id}`, { write_date: wd.value, approval_no: $('[data-tf="approval_no"]', m.el).value, note: $('[data-tf="note"]', m.el).value, items: rows }); toast('매입 계산서를 고쳤습니다.'); m.close(); purchaseTaxView(id, after); await after?.(); }
    catch (error) { fail(error); e.target.disabled = false; }
  };
}
// 등록: 매입처 → 기간 → 아직 계산서에 안 담긴 확정 매입전표 체크 → 작성일자·승인번호 → 저장. 받은 계산서 합계를 넣으면 맞는지 바로 비교.
async function purchaseTaxNew(after) {
  const r0 = monthRange(todayStr().slice(0, 7)), requestId = crypto.randomUUID();
  const m = modal(`<h3>매입 세금계산서 등록</h3>
    <form><div class="form-grid"><label>매입처 *<input name="vendor" required maxlength="100" autocomplete="off"></label><label>전표 기간<input type="date" name="from" value="${r0.from}"></label><label>~<input type="date" name="to" value="${r0.to}"></label></div>
    <div data-ptax-cands><p class="muted small">매입처를 고르면 아직 계산서에 담지 않은 확정 매입전표가 나옵니다.</p></div>
    <div class="form-grid"><label>작성일자 *<input type="date" name="write_date" required value="${todayStr()}"></label><label>국세청 승인번호<input name="approval_no" maxlength="40" placeholder="예) 20261117-41000012-00000001" inputmode="numeric"></label><label>발행구분<select name="issue_type"><option value="normal">정발행 받음(매입처가 발행)</option><option value="reverse">역발행(우리가 요청·발행)</option></select></label><label>문서<select name="doc_type"><option value="">자동(세액 0이면 계산서)</option><option value="tax">세금계산서</option><option value="free">계산서(면세)</option></select></label><label>받은 계산서 합계 <span class="hint">(맞는지 비교)</span><input name="check_total" type="number" min="0" step="1"></label><label class="span3">비고<input name="note" maxlength="500"></label></div>
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
    try { await api('POST', '/api/purchase-tax-invoices', { request_id: requestId, vendor: v.vendor, write_date: v.write_date, approval_no: v.approval_no, note: v.note, issue_type: v.issue_type, doc_type: v.doc_type || undefined, bill_ids: ids }); toast('매입 세금계산서를 등록했습니다.'); m.close(); await after?.(); } catch (error) { fail(error); }
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
  const v = await promptBox(`${inv.issue_type === 'reverse' ? '역발행 승인 기록' : '직접 발행 기록'} · ${inv.customer} ${won(inv.total)}원`, `<p class="small muted">${inv.issue_type === 'reverse' ? '거래처(예: 삼성)가 홈택스·전자세금계산서 시스템으로 역발행을 요청해 우리가 승인한 계산서를 승인번호와 함께 「발행 완료」로 기록합니다.' : '트러스빌 연동 전에 홈택스 등에서 직접 발행한 계산서를 「발행 완료」로 기록합니다.'} 잘못 기록하면 「직접 발행 되돌리기」로 되돌릴 수 있습니다.</p>
    <label>국세청 승인번호 *<input name="approval_no" required maxlength="40" placeholder="예) 20261117-41000012-00000001"></label><label>발행일 *<input type="date" name="issued_date" required value="${esc(inv.write_date || todayStr())}" max="${todayStr()}"></label>`);
  if (!v) return;
  try { await api('POST', `/api/tax-invoices/${inv.id}/mark-issued`, v); toast('발행 완료로 기록했습니다.'); await after?.(); } catch (error) { fail(error); }
}

// ── 15.138 문서상태(기존 ERP처럼): 발행구분(역발행) · 발행 상태 · 상대방 수신(미확인/확인/거부) ──
const RECV_LABEL = { '': ['수신자 미확인', 'red'], confirmed: ['수신 확인', 'green'], rejected: ['수신 거부', 'red'] };
function taxDocState(r) {
  const rev = (r.doc_type === 'free' ? '<span class="chip blue">계산서</span> ' : '') + (r.issue_type === 'reverse' ? '<span class="chip red tax-rev">역발행</span> ' : '');
  const st = r.issue_type === 'reverse' && ['draft', 'failed'].includes(r.status) ? '<span class="chip">승인 대기</span>' : taxChip(r.status);
  const recv = ['issued', 'sent'].includes(r.status) ? `<div class="small ${RECV_LABEL[r.recv_status || ''][1]}-text">${RECV_LABEL[r.recv_status || ''][0]}${r.recv_at ? ` · ${esc(String(r.recv_at).slice(5, 10))}` : ''}</div>` : '';
  const msg = r.status_message ? `<div class="small muted">${esc(r.status_message)}</div>` : '';
  return `${rev}${st}${recv}${msg}`;
}
function taxSummaryBox(s) {
  if (!s) return '';
  const cell = (label, g, cls = '') => `<div class="tax-sum-cell ${cls}"><span>${label}</span><b>${fmtNum(g.n)}건</b><span class="r">${won(g.supply)}</span><span class="r">${won(g.vat)}</span></div>`;
  return `<div class="tax-sum card"><div class="tax-sum-head"><span></span><span></span><span class="r">공급가액</span><span class="r">세액</span></div>
    ${cell('매출 합계', s.all, 'strong')}${cell('수신자 미확인', s.unconfirmed, s.unconfirmed.n ? 'red' : '')}${cell('수신 확인', s.confirmed, 'green')}${s.rejected.n ? cell('수신 거부', s.rejected, 'red') : ''}
    ${cell('국세청 전송', s.nts_sent, 'green')}${cell('국세청 미전송', s.nts_pending, s.nts_pending.n ? 'blue' : '')}${cell('역발행', s.reverse)}${cell('발행 전', s.draft)}</div>`;
}

// ── 15.142 세금계산서 양식(국세청 표준 양식 모양): 매출 = 빨강(공급자 보관용), 매입 = 파랑. 발행 전이면 창에서 바로 고친다. ──
const TAXF_SUPPLY_UNITS = ['백', '십', '억', '천', '백', '십', '만', '천', '백', '십', '일'], TAXF_VAT_UNITS = ['십', '억', '천', '백', '십', '만', '천', '백', '십', '일'];
const taxfDigits = (n, len) => { const s = String(Math.abs(Math.trunc(Number(n) || 0))), neg = Number(n) < 0; const cells = Array(len).fill(''); const t = (neg ? '-' : '') + s; for (let k = 0; k < t.length && k < len; k++) cells[len - 1 - k] = t[t.length - 1 - k]; return cells; };
function taxFormHtml({ side = 'sales', inv, supplier, buyer, items, editable = false, charge = 'claim', statusBar = '', editParty = editable, editAmounts = false }) {
  const free = inv.doc_type === 'free'; // 15.143 계산서(면세): 세액 칸 없이 공급가액·비고
  const f = (name, value, opts = '') => editable ? `<input class="taxf-in" data-tf="${name}" value="${esc(value || '')}" ${opts}>` : esc(value || '');
  const party = (who, p, edit) => `<tr><th rowspan="4" class="taxf-side">${who}</th><th>등록번호</th><td colspan="3" class="taxf-bizno">${edit ? f('biz_no', p.biz_no, 'maxlength="12" inputmode="numeric" aria-label="공급받는자 등록번호"') : esc(p.biz_no || '')}</td></tr>
    <tr><th>상호<br><span class="small">(법인명)</span></th><td>${edit ? f('biz_name', p.biz_name, 'maxlength="100" aria-label="공급받는자 상호"') : esc(p.biz_name || '')}</td><th class="taxf-narrow">성<br>명</th><td>${edit ? f('ceo', p.ceo, 'maxlength="50" aria-label="공급받는자 성명"') : esc(p.ceo || '')} <span class="taxf-seal">(인)</span></td></tr>
    <tr><th>사업장<br>주 소</th><td colspan="3">${edit ? f('address', p.address, 'maxlength="200" aria-label="공급받는자 주소"') : esc(p.address || '')}</td></tr>
    <tr><th>업 태</th><td>${edit ? f('biz_type', p.biz_type, 'maxlength="100" aria-label="공급받는자 업태"') : esc(p.biz_type || '')}</td><th class="taxf-narrow">종<br>목</th><td>${edit ? f('biz_item', p.biz_item, 'maxlength="100" aria-label="공급받는자 종목"') : esc(p.biz_item || '')}</td></tr>`;
  const sd = taxfDigits(inv.supply_total, 11), vd = taxfDigits(inv.vat_total, 10), blanks = sd.filter(x => x === '').length;
  const rows = editAmounts ? Math.max(4, items.length + 2) : Math.max(4, items.length); // 15.161 고칠 때는 빈 줄 2개를 더 둬 줄을 보탤 수 있게
  return `<section class="cert taxf taxf-${side}">
    <div class="taxf-top"><h2>${free ? '계 산 서' : '세금계산서'}</h2><span class="taxf-kind">( <b class="${side === 'sales' ? 'on' : ''}">${side === 'sales' ? '●' : '○'} 매출</b> <b class="${side === 'purchase' ? 'on' : ''}">${side === 'purchase' ? '●' : '○'} 매입</b> )</span><span class="taxf-flags">${free ? '' : Number(inv.vat_total) === 0 ? '☑ 영세율' : '☐ 영세율'}</span>
      <table class="taxf-book"><tbody><tr><th>책 번 호</th><td>권</td><td>호</td></tr><tr><th>일련번호</th><td colspan="2">${esc(inv.invoice_no || '')}</td></tr></tbody></table></div>
    <table class="taxf-parties"><tbody><tr><td class="taxf-half">${`<table><tbody>${party('공<br>급<br>자', supplier, false)}</tbody></table>`}</td><td class="taxf-half">${`<table><tbody>${party('공<br>급<br>받<br>는<br>자', buyer, editParty)}</tbody></table>`}</td></tr></tbody></table>
    <table class="taxf-amt"><thead><tr><th colspan="2">작 성</th><th colspan="11">공 급 가 액</th>${free ? '<th rowspan="2" class="taxf-memo">비 고</th>' : '<th colspan="10">세 액</th>'}</tr>
      <tr><th>날짜</th><th>공란수</th>${TAXF_SUPPLY_UNITS.map(u => `<th>${u}</th>`).join('')}${free ? '' : TAXF_VAT_UNITS.map(u => `<th>${u}</th>`).join('')}</tr></thead>
      <tbody><tr><td class="taxf-date">${editable ? `<input type="date" class="taxf-in" data-tf="write_date" value="${esc(inv.write_date)}" aria-label="작성일자" required>` : esc(inv.write_date)}</td><td class="c">${blanks}</td>${sd.map(d => `<td class="c taxf-dg">${d}</td>`).join('')}${free ? `<td class="small">${esc(inv.note || '')}</td>` : vd.map(d => `<td class="c taxf-dg">${d}</td>`).join('')}</tr></tbody></table>
    <table class="taxf-items"><thead><tr><th>월 일</th><th>품 목</th><th>규 격</th><th>수 량</th><th>단 가</th><th>공급가액</th>${free ? '' : '<th>세 액</th>'}<th>비 고</th></tr></thead>
      <tbody>${Array.from({ length: rows }, (_, k) => { const i = items[k] || (editAmounts ? { date: '', item: '', spec: '', qty: null, unit_price: null, supply: '', vat: '', note: '' } : null); if (!i) return `<tr class="taxf-blank"><td>-</td><td></td><td></td><td></td><td></td><td></td>${free ? '' : '<td></td>'}<td></td></tr>`;
        return `<tr><td class="c">${editable ? `<input type="date" class="taxf-in" data-ti="date" data-k="${k}" value="${esc(i.date || '')}" aria-label="${k + 1}번째 품목 월일">` : esc(String(i.date || '').slice(5))}</td><td>${editable ? `<input class="taxf-in" data-ti="item" data-k="${k}" value="${esc(i.item || '')}" maxlength="200" aria-label="${k + 1}번째 품목">` : esc(i.item || '')}</td><td>${editable ? `<input class="taxf-in" data-ti="spec" data-k="${k}" value="${esc(i.spec || '')}" maxlength="100" aria-label="${k + 1}번째 규격">` : esc(i.spec || '')}</td><td class="r">${editAmounts ? `<input class="taxf-in r" data-ti="qty" data-k="${k}" inputmode="decimal" value="${i.qty ?? ''}" aria-label="${k + 1}번째 수량">` : i.qty == null ? '' : fmtNum(i.qty)}</td><td class="r">${editAmounts ? `<input class="taxf-in r" data-ti="unit_price" data-k="${k}" inputmode="decimal" value="${i.unit_price ?? ''}" aria-label="${k + 1}번째 단가">` : i.unit_price == null ? '' : fmtNum(i.unit_price)}</td><td class="r">${editAmounts ? `<input class="taxf-in r" data-ti="supply" data-k="${k}" inputmode="numeric" value="${i.supply ?? ''}" aria-label="${k + 1}번째 공급가액">` : won(i.supply)}</td>${free ? '' : `<td class="r">${editAmounts ? `<input class="taxf-in r" data-ti="vat" data-k="${k}" inputmode="numeric" value="${i.vat ?? ''}" aria-label="${k + 1}번째 세액">` : won(i.vat)}</td>`}<td>${editable ? `<input class="taxf-in" data-ti="note" data-k="${k}" value="${esc(i.note || '')}" maxlength="200" aria-label="${k + 1}번째 비고">` : esc(i.note || '')}</td></tr>`; }).join('')}</tbody></table>
    <table class="taxf-sum"><thead><tr><th>합 계 금 액</th><th>현 금</th><th>수 표</th><th>어 음</th><th>외상미수금</th><th rowspan="2" class="taxf-charge">이 금액을 ${editParty ? `<label><input type="radio" name="taxf-charge" value="receipt"${charge === 'receipt' ? ' checked' : ''}> 영수</label> <label><input type="radio" name="taxf-charge" value="claim"${charge !== 'receipt' ? ' checked' : ''}> 청구</label>` : `<b>${charge === 'receipt' ? '영수' : '청구'}</b>`} 함</th></tr></thead>
      <tbody><tr><td class="r"><b>₩${won(inv.total)}</b></td><td></td><td></td><td></td><td class="r">${charge === 'receipt' ? '' : won(inv.total)}</td></tr></tbody></table>
    ${statusBar}
  </section>`;
}
