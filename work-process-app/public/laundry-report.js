// 세탁 검수·성적서: 세탁 업체가 보낸 리스트를 세탁일별로 검수 기록하고, 누적 현황과 확인표(성적서)를 만든다.
let LR_META = null;
const lrKey = (section, garment, part, size) => [section, garment, part, size].join('|');
const lrWon = (n) => fmtNum(Math.round(n || 0));

// One paper-form table (세탁 or 폐기) for a department. values: Map(key → qty). editable → number inputs.
function lrGrid(form, section, values, editable) {
  const cols = form.garments.flatMap((g) => (section === 'wash' ? [''] : g.parts).map((part) => ({ g, part })));
  const groups = []; for (const g of form.garments) { const span = section === 'wash' ? 1 : g.parts.length; const last = groups.at(-1); if (last && last.name === g.group) { last.span += span; last.items.push(g); } else groups.push({ name: g.group, span, items: [g] }); }
  const deep = section === 'wash' ? 2 : 3;
  const single = (group) => group.items.length === 1 && !group.items[0].label && (section === 'wash' || group.items[0].parts.length === 1);
  const head1 = groups.map((group) => `<th colspan="${group.span}" ${single(group) ? `rowspan="${deep}"` : ''}>${esc(group.name)}</th>`).join('');
  const head2 = groups.filter((group) => !single(group)).flatMap((group) => group.items).map((g) => `<th colspan="${section === 'wash' ? 1 : g.parts.length}" class="lr-c-${g.key}">${esc(g.label)}</th>`).join('');
  const head3 = section === 'wash' ? '' : `<tr>${groups.filter((group) => !single(group)).flatMap((group) => group.items).flatMap((g) => g.parts.map((part) => `<th>${g.parts.length > 1 ? esc(part) : ''}</th>`)).join('')}</tr>`;
  const cell = (col, size) => { const key = lrKey(section, col.g.key, col.part, size); const v = values.get(key) || ''; return editable ? `<td><input type="number" min="0" step="1" inputmode="numeric" data-lr="${esc(key)}" value="${v}" aria-label="${esc(`${form.label} ${section === 'wash' ? '세탁' : '폐기'} ${col.g.group} ${col.g.label} ${col.part} ${size}`)}"></td>` : `<td>${v ? fmtNum(v) : ''}</td>`; };
  const total = (col) => LR_META.sizes.reduce((sum, size) => sum + (values.get(lrKey(section, col.g.key, col.part, size)) || 0), 0);
  return `<table class="lr-grid"><thead><tr><th rowspan="${deep}">구분</th>${head1}</tr><tr>${head2}</tr>${head3}</thead>
    <tbody>${LR_META.sizes.map((size) => `<tr><th>${esc(form.size_labels[size] || size)}</th>${cols.map((col) => cell(col, size)).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><th>계</th>${cols.map((col) => `<td data-lr-total="${esc(lrKey(section, col.g.key, col.part, ''))}">${fmtNum(total(col))}</td>`).join('')}</tr></tfoot></table>`;
}
const lrValues = (lines) => new Map((lines || []).map((l) => [lrKey(l.section, l.garment, l.part, l.size), l.qty]));
const lrFormTotal = (form, values) => [...values].reduce((sum, [key, qty]) => sum + (form.garments.some((g) => g.key === key.split('|')[1]) ? qty : 0), 0);

// 확인표(성적서) — same layout as the paper form; printed through the shared modal print rule.
function lrCertificate(report, form) {
  const values = lrValues(report.lines); const issued = report.status === 'issued';
  const m = modal(`<div class="cert">
    ${issued ? '' : '<p class="cert-draft">발행 전 미리보기 — 발행하면 이 문구가 사라집니다.</p>'}
    <h2>${esc(LR_META.customer)} 세탁물 확인표_${esc(form.label)}</h2>
    <div class="cert-date"><span>세탁일</span><b>${esc(report.wash_date)}</b></div>
    <h4>세탁</h4>${lrGrid(form, 'wash', values, false)}
    <h4>폐기</h4>${lrGrid(form, 'discard', values, false)}
    <p class="cert-sign">확인자 : ${esc(report.inspector || '')} <span class="cert-sign-box">(서명)</span></p>
  </div><div class="actions"><button class="btn" data-close>닫기</button><button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true });
  m.el.classList.add('lr-modal'); m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => { const title = document.title; document.title = `${report.wash_date} ${LR_META.customer} 세탁물 확인표_${form.label}`; document.body.classList.add('printing-cert'); try { window.print(); } finally { document.body.classList.remove('printing-cert'); document.title = title; } };
}

async function lrSettings(done) {
  const p = LR_META.prices; const labels = { onepiece: '원피스', twopiece: '투피스', gown: '가운', shoes: '안전화' };
  const priceRow = (kind, title) => `<fieldset><legend>${esc(title)}</legend><div class="form-grid">${LR_META.price_keys.map((k) => `<label>${labels[k]}<input type="number" min="0" step="any" data-price="${kind}.${k}" value="${p[kind][k] || ''}" placeholder="0"></label>`).join('')}</div></fieldset>`;
  const m = modal(`<h3>세탁 검수 설정</h3><form class="stack">
    <div class="form-grid"><label>고객사 *<input name="customer" required maxlength="60" value="${esc(LR_META.customer)}"></label><label>세탁 업체 *<input name="vendor" required maxlength="60" value="${esc(LR_META.vendor)}"></label>
      <label class="span2">확인자 (성적서 하단 기본값)<input name="inspector" maxlength="120" value="${esc(LR_META.inspector)}" placeholder="회사 · 부서 · 이름 · 직급"></label></div>
    ${priceRow('vendor', `세탁 업체 단가 (원/벌) — 우리가 내는 비용`)}${priceRow('customer', `고객사 단가 (원/벌) — 우리가 청구하는 금액`)}
    <fieldset><legend>폐기 단가 (원/개)</legend><div class="form-grid">${LR_META.parts.map((k) => `<label>${esc(k)}<input type="number" min="0" step="any" data-price="discard.${esc(k)}" value="${p.discard[k] || ''}" placeholder="0"></label>`).join('')}</div></fieldset>
    <p class="muted small">단가를 바꿔도 이미 발행한 성적서의 금액은 발행 당시 단가로 유지됩니다.</p>
    <div class="actions"><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
  $('[data-no]', m.el).onclick = m.close;
  $('form', m.el).onsubmit = async (e) => {
    e.preventDefault(); const prices = { vendor: {}, customer: {}, discard: {} };
    $$('[data-price]', m.el).forEach((input) => { const [kind, key] = input.dataset.price.split('.'); prices[kind][key] = input.value === '' ? 0 : Number(input.value); });
    try { await api('PUT', '/api/laundry-report-settings', { ...formObj(e.target), prices }); m.close(); toast('설정을 저장했습니다.'); done(); } catch (err) { fail(err); }
  };
}

async function lrEditor(id, done) {
  let report = { status: 'draft', wash_date: todayStr(), pickup_label: '', inspector: LR_META.inspector, note: '', lines: [], can_edit: true };
  if (id) { try { report = await api('GET', '/api/laundry-reports/' + id); } catch (err) { fail(err); return; } }
  const values = lrValues(report.lines); const issued = report.status === 'issued'; const editable = report.can_edit && !issued;
  const section = (form) => `<details class="lr-form" ${form.key === 'prod' || lrFormTotal(form, values) ? 'open' : ''}><summary>${esc(form.label)} <span class="muted small" data-lr-form-total="${form.key}"></span></summary>
    <h4>세탁</h4><div class="table-wrap">${lrGrid(form, 'wash', values, editable)}</div><h4>폐기</h4><div class="table-wrap">${lrGrid(form, 'discard', values, editable)}</div></details>`;
  const m = modal(`<h3>${id ? '세탁 검수 기록' : '새 세탁 검수 등록'} ${issued ? '<span class="tag">발행됨</span>' : id ? '<span class="tag soft">작성 중</span>' : ''}</h3>
    ${issued ? `<p class="muted small">${esc(report.issued_at)} ${esc(report.issued_by)} 발행 · 수정하려면 발행을 취소하세요.</p>` : `<p class="muted small">${esc(LR_META.vendor)}에서 받은 리스트를 검수한 수량으로 입력하세요. 빈 칸은 0입니다.</p>`}
    <form class="stack"><div class="form-grid">
      <label>세탁일 *<input name="wash_date" type="date" required value="${esc(report.wash_date)}" ${editable ? '' : 'disabled'}></label>
      <label>회수일<input name="pickup_label" maxlength="40" value="${esc(report.pickup_label)}" placeholder="예: 261105" ${editable ? '' : 'disabled'}></label>
      <label class="span2">확인자<input name="inspector" maxlength="120" value="${esc(report.inspector)}" placeholder="회사 · 부서 · 이름 · 직급" ${editable ? '' : 'disabled'}></label>
      <label class="span3">메모<input name="note" maxlength="500" value="${esc(report.note)}" ${editable ? '' : 'disabled'}></label></div>
    ${LR_META.forms.map(section).join('')}
    <div class="actions">
      ${id && editable ? '<button type="button" class="btn danger" data-act="delete">삭제</button>' : ''}
      ${issued && hasRole('purchase') ? '<button type="button" class="btn" data-act="unissue">발행 취소</button>' : ''}
      ${id ? LR_META.forms.map((form) => `<button type="button" class="btn" data-cert="${form.key}">성적서 · ${esc(form.label)}</button>`).join('') : ''}
      <button type="button" class="btn" data-act="close">닫기</button>
      ${editable ? '<button class="btn" data-act="save">저장</button><button type="button" class="btn primary" data-act="issue">저장 후 발행</button>' : ''}
    </div></form>`, { wide: true });
  m.el.classList.add('lr-modal');
  const collect = () => $$('[data-lr]', m.el).filter((input) => input.value !== '').map((input) => { const [sec, garment, part, size] = input.dataset.lr.split('|'); return { section: sec, garment, part, size, qty: Number(input.value) }; });
  const totals = () => {
    const now = editable ? lrValues(collect()) : values;
    $$('[data-lr-total]', m.el).forEach((td) => { const prefix = td.dataset.lrTotal; td.textContent = fmtNum(LR_META.sizes.reduce((sum, size) => sum + (now.get(prefix + size) || 0), 0)); });
    LR_META.forms.forEach((form) => { const wash = [...now].reduce((sum, [key, qty]) => sum + (key.startsWith('wash|') && form.garments.some((g) => g.key === key.split('|')[1]) ? qty : 0), 0); $(`[data-lr-form-total="${form.key}"]`, m.el).textContent = `세탁 ${fmtNum(wash)} · 폐기 ${fmtNum(lrFormTotal(form, now) - wash)}`; });
  };
  m.el.addEventListener('input', (e) => { if (e.target.dataset.lr) totals(); }); totals();
  const save = async () => {
    const body = { ...formObj($('form', m.el)), lines: collect() };
    if (id) { await api('PUT', '/api/laundry-reports/' + id, body); return id; }
    return (await api('POST', '/api/laundry-reports', body)).id;
  };
  const act = async (name) => {
    try {
      if (name === 'close') return m.close();
      if (name === 'delete') { if (!(await confirmBox('이 검수 기록을 삭제할까요?'))) return; await api('DELETE', '/api/laundry-reports/' + id); toast('삭제했습니다.'); }
      if (name === 'unissue') { if (!(await confirmBox('발행을 취소하고 다시 수정할 수 있게 할까요?'))) return; await api('POST', `/api/laundry-reports/${id}/unissue`); toast('발행을 취소했습니다.'); m.close(); done(); return lrEditor(id, done); }
      if (name === 'save') { id = await save(); toast('저장했습니다.'); }
      if (name === 'issue') {
        if (!$('form', m.el).reportValidity()) return;
        if (!$('[name=inspector]', m.el).value.trim() && !(await confirmBox('확인자가 비어 있습니다. 그대로 발행할까요?'))) return;
        id = await save(); await api('POST', `/api/laundry-reports/${id}/issue`); toast('성적서를 발행했습니다.'); m.close(); done(); return lrEditor(id, done);
      }
      m.close(); done();
    } catch (err) { fail(err); if (id) done(); }
  };
  $('form', m.el).onsubmit = (e) => { e.preventDefault(); act('save'); };
  $$('[data-act]', m.el).forEach((b) => { if (b.dataset.act !== 'save') b.onclick = () => act(b.dataset.act); });
  $$('[data-cert]', m.el).forEach((b) => (b.onclick = () => lrCertificate(editable ? { ...report, ...formObj($('form', m.el)), lines: collect() } : report, LR_META.forms.find((form) => form.key === b.dataset.cert))));
}

async function pageLaundryReports(main) {
  main.innerHTML = '<p class="muted">불러오는 중…</p>';
  try { LR_META = await api('GET', '/api/laundry-report-meta'); } catch (err) { fail(err); return; }
  const year = todayStr().slice(0, 4); const money = LR_META.can_money;
  const garments = LR_META.forms.flatMap((form) => form.garments);
  main.innerHTML = `
  <div class="report-heading"><div><h1>세탁 검수·성적서 <span class="dept">구매</span></h1>
    <p class="muted">${esc(LR_META.vendor)}에서 보낸 세탁 리스트를 검수해 세탁일별로 기록하고, ${esc(LR_META.customer)} 세탁물 확인표(성적서)를 발행합니다.</p></div>
    <div class="actions">${money ? '<button class="btn" id="lrSettings">단가·설정</button>' : ''}<button class="btn" id="lrCsv">CSV</button><button class="btn primary" id="lrNew">새 검수 등록</button></div></div>
  <form class="card filters" id="lrFilters"><div class="form-grid"><label>세탁일 시작<input type="date" name="from" value="${year}-01-01"></label><label>세탁일 종료<input type="date" name="to" value="${year}-12-31"></label></div>
    <div class="actions"><button class="btn">조회</button></div></form>
  <p id="lrHint" class="muted small"></p>
  <div id="lrList" class="table-wrap"></div>
  <details class="card" id="lrMatrix"><summary>사이즈별 누적 (조회 기간)</summary><div id="lrMatrixBody"></div></details>`;
  let rows = [];
  const load = async () => {
    if (!main.isConnected) return;
    let data; try { data = await api('GET', '/api/laundry-reports?' + new URLSearchParams(formObj($('#lrFilters', main)))); } catch (err) { fail(err); return; }
    rows = data.rows; const sum = (pick) => rows.reduce((total, r) => total + (pick(r) || 0), 0);
    $('#lrHint', main).textContent = money && LR_META.price_keys.every((k) => !LR_META.prices.vendor[k] && !LR_META.prices.customer[k]) ? '단가가 아직 설정되지 않아 금액이 0으로 나옵니다. 「단가·설정」에서 입력하세요.' : '';
    const moneyHead = money ? `<th>${esc(LR_META.vendor)} 비용</th><th>${esc(LR_META.customer)} 청구</th><th>차익</th><th>폐기 금액</th>` : '';
    const moneyCells = (s) => money ? `<td>${lrWon(s.vendor_cost)}</td><td>${lrWon(s.customer_amount)}</td><td>${lrWon(s.profit)}</td><td>${lrWon(s.discard_amount)}</td>` : '';
    $('#lrList', main).innerHTML = rows.length ? `<table class="lr-list"><thead><tr><th>세탁일</th><th>회수일</th>${garments.map((g) => `<th>${esc(g.group)}${g.label ? `<br><span class="small">${esc(g.label.split(',')[0])}</span>` : ''}</th>`).join('')}<th>세탁 계</th><th>폐기</th>${moneyHead}<th>상태</th><th>성적서</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><a href="#" data-open="${r.id}">${esc(r.wash_date)}</a></td><td>${esc(r.pickup_label)}</td>${garments.map((g) => `<td>${r.summary.wash[g.key] ? fmtNum(r.summary.wash[g.key]) : ''}</td>`).join('')}<td><b>${fmtNum(r.summary.wash_total)}</b></td><td>${r.summary.discard_total ? fmtNum(r.summary.discard_total) : ''}</td>${moneyCells(r.summary)}
        <td>${r.status === 'issued' ? `<span class="tag" title="${esc(r.issued_at + ' ' + r.issued_by)}">발행</span>` : '<span class="tag soft">작성 중</span>'}</td>
        <td>${LR_META.forms.filter((form) => r.summary[form.key + '_total']).map((form) => `<button class="btn small" data-cert="${r.id}|${form.key}">${esc(form.label)}</button>`).join(' ')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="2">합계 (${rows.length}회)</th>${garments.map((g) => `<td>${fmtNum(sum((r) => r.summary.wash[g.key]))}</td>`).join('')}<td><b>${fmtNum(sum((r) => r.summary.wash_total))}</b></td><td>${fmtNum(sum((r) => r.summary.discard_total))}</td>${money ? moneyCells({ vendor_cost: sum((r) => r.summary.vendor_cost), customer_amount: sum((r) => r.summary.customer_amount), profit: sum((r) => r.summary.profit), discard_amount: sum((r) => r.summary.discard_amount) }) : ''}<td colspan="2"></td></tr></tfoot></table>` : '<p class="muted">이 기간에 등록된 검수 기록이 없습니다.</p>';
    const matrix = new Map(Object.entries(data.matrix));
    $('#lrMatrixBody', main).innerHTML = LR_META.forms.map((form) => `<h4>${esc(form.label)} · 세탁</h4><div class="table-wrap">${lrGrid(form, 'wash', matrix, false)}</div><h4>${esc(form.label)} · 폐기</h4><div class="table-wrap">${lrGrid(form, 'discard', matrix, false)}</div>`).join('');
    $$('[data-open]', main).forEach((a) => (a.onclick = (e) => { e.preventDefault(); lrEditor(Number(a.dataset.open), load); }));
    $$('#lrList [data-cert]', main).forEach((b) => (b.onclick = async () => { const [id, key] = b.dataset.cert.split('|'); try { lrCertificate(await api('GET', '/api/laundry-reports/' + id), LR_META.forms.find((form) => form.key === key)); } catch (err) { fail(err); } }));
  };
  $('#lrFilters', main).onsubmit = (e) => { e.preventDefault(); load(); };
  $('#lrNew', main).onclick = () => lrEditor(null, load);
  if (money) $('#lrSettings', main).onclick = () => lrSettings(() => pageLaundryReports(main));
  $('#lrCsv', main).onclick = () => {
    if (!rows.length) return toast('내보낼 기록이 없습니다.', 'err');
    const head = ['세탁일', '회수일', ...garments.map((g) => `${g.group} ${g.label}`.trim()), '세탁 계', '폐기', ...(money ? [`${LR_META.vendor} 비용`, `${LR_META.customer} 청구`, '차익', '폐기 금액'] : []), '상태', '발행자', '발행일시'];
    const body = rows.map((r) => [r.wash_date, r.pickup_label, ...garments.map((g) => r.summary.wash[g.key]), r.summary.wash_total, r.summary.discard_total, ...(money ? [r.summary.vendor_cost, r.summary.customer_amount, r.summary.profit, r.summary.discard_amount] : []), r.status === 'issued' ? '발행' : '작성 중', r.issued_by, r.issued_at]);
    const text = '﻿' + [head, ...body].map((line) => line.map((v) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`; }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `세탁검수-누적-${todayStr()}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  load();
}
