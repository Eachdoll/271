// 거래처 목록과 거래처·품목 선택 도우미. 거래처는 누구나 등록·수정합니다.
const partnerKey = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
let partnerListSerial = 0;
// Search the registered partner directory without relying on the browser's datalist UI.
function pickPartner({ type = '' } = {}) {
  return new Promise(resolve => {
    let done = false, serial = 0, shown = [];
    const finish = value => { if (done) return; done = true; resolve(value); m.close(); };
    const scope = type === 'purchase' ? '매입처 · 구분 없음' : type === 'sales' ? '매출처 · 구분 없음' : '전체 거래처';
    const m = modal(`<h3>거래처 찾기</h3><p class="small muted">${scope} · 이름·코드·담당자·연락처로 검색한 뒤 선택하세요.</p>
      <form data-no-author data-partner-search class="toolbar"><label class="grow">검색<input type="search" name="q" maxlength="200" autocomplete="off" placeholder="거래처명·코드·담당자·연락처"></label><button class="btn primary">조회</button></form>
      <p class="small muted" data-partner-count role="status"></p><div data-partner-results></div><div class="actions"><button type="button" class="btn" data-partner-cancel>취소</button></div>`, { wide: true, onClose: () => { if (!done) { done = true; resolve(null); } } });
    const form = $('[data-partner-search]', m.el), input = form.elements.q, results = $('[data-partner-results]', m.el);
    const load = async () => {
      const mine = ++serial;
      $('[data-partner-count]', m.el).textContent = '조회 중…';
      try {
        const rows = await api('GET', '/api/vendors?' + new URLSearchParams({ q: input.value.trim(), ...(type ? { type } : {}) }));
        if (done || mine !== serial) return;
        shown = rows;
        $('[data-partner-count]', m.el).textContent = rows.length >= 1000 ? '앞의 1,000곳 표시 · 검색어로 범위를 좁히세요.' : `${rows.length}곳`;
        results.innerHTML = rows.length ? `<div class="table-wrap"><table class="grid keep-table dense-grid partner-results" data-keep-cols><thead><tr><th>코드</th><th>거래처</th><th>구분</th><th>담당자</th><th>연락처</th><th></th></tr></thead><tbody>${rows.map((v, i) => `<tr><td><code>${esc(v.code || '—')}</code></td><td><button type="button" class="link-btn" data-partner-pick="${i}">${esc(v.name)}</button></td><td>${vendorTypeChips(v)}</td><td>${esc(v.contact_name || '')}</td><td>${esc(v.phone || '')}</td><td><button type="button" class="btn small" data-partner-pick="${i}" aria-label="${esc(v.name)} 선택">선택</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 거래처가 없습니다. 검색어를 바꿔 조회하세요.</div>';
      } catch (error) {
        if (done || mine !== serial) return;
        shown = []; $('[data-partner-count]', m.el).textContent = '조회 실패';
        results.innerHTML = `<p class="field-error" role="alert">${esc(error.message)} · 다시 조회해 주세요.</p>`;
      }
    };
    // 15.103 키보드: ↑↓로 줄을 고르고 Enter로 선택(결과가 하나면 바로). 검색어를 바꾸면 조회부터.
    let active = 0, searched = '';
    const rowsOf = () => [...(results.querySelectorAll?.('tbody tr') || [])];
    const paint = () => rowsOf().forEach((tr, i) => { tr.classList?.toggle('ip-active', i === active); tr.setAttribute?.('aria-selected', String(i === active)); });
    const loadThen = () => { searched = input.value.trim(); return load().then(() => { active = 0; paint(); }); };
    input.addEventListener?.('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!shown.length) return; e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; paint(); rowsOf()[active]?.scrollIntoView?.({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown.length && input.value.trim() === searched) finish(shown[shown.length === 1 ? 0 : active]); else loadThen(); }
    });
    form.onsubmit = e => { e.preventDefault(); loadThen(); };
    results.addEventListener('click', e => { const b = e.target.closest('[data-partner-pick]'); if (b && shown[Number(b.dataset.partnerPick)]) finish(shown[Number(b.dataset.partnerPick)]); });
    $('[data-partner-cancel]', m.el).onclick = () => m.close();
    loadThen();
  });
}
// Attach the vendor pick list to a name input; for purchase orders also suggest what was bought recently.
// type(15.58): 'purchase'면 매입처, 'sales'면 매출처만(구분 없는 거래처는 둘 다) 목록에 보인다.
async function bindPartnerPicker(input, hint, { recent = false, onPick, type = '', directory = null } = {}) {
  if (input.dataset.partnerBound) return;
  input.dataset.partnerBound = 'true';
  const wrap = document.createElement('span'); wrap.className = 'partner-picker';
  input.before(wrap); wrap.append(input);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'btn small'; button.textContent = '거래처 찾기';
  button.setAttribute('aria-label', '거래처 찾기'); button.title = '거래처 찾기'; button.className = 'btn small partner-find'; wrap.append(button);
  button.onclick = async e => {
    e.preventDefault(); if (input.disabled || input.readOnly) return;
    button.disabled = true;
    try {
      const partner = await pickPartner({ type });
      if (!partner || !input.isConnected) return;
      delete input.dataset.partnerPrev; input.value = partner.name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // 15.103 고른 뒤 다음 칸으로(Tab 흐름이 이어지게). 조회 줄이면 거래처 칸에 둔다.
      if (!input.form?.matches('.list-filters, [data-read-only]')) { const all = [...input.form?.elements || []].filter(el => el.matches('input, select, textarea') && !el.disabled && !el.readOnly && el.type !== 'hidden' && el.offsetParent !== null && !el.closest('.partner-picker')); const next = all.find(el => el.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING); Promise.resolve().then(() => (next || input).focus?.()); } else Promise.resolve().then(() => input.focus?.());
    } finally { if (button.isConnected) button.disabled = false; }
  };
  let vendors = [];
  try { vendors = directory || await api('GET', '/api/vendors' + (type ? '?type=' + type : '')); } catch { return; } // typing a name still works without the list
  if (!input.isConnected) return;
  const list = document.createElement('datalist'); list.id = 'partnerList' + (++partnerListSerial);
  list.innerHTML = vendors.map(v => `<option value="${esc(v.name)}">${esc([v.contact_name, v.phone, v.code].filter(Boolean).join(' · '))}</option>`).join('');
  input.after(list); input.setAttribute('list', list.id); input.autocomplete = 'off';
  // 15.92 거래처코드를 그대로 쳐도(예: C0001) 그 거래처 이름으로 바꾼다. 화면의 change 처리보다 먼저(capture) 바꿔 같은 값으로 불러오게 한다.
  input.addEventListener('change', () => {
    const typed = input.value.trim(); if (!typed || vendors.some(v => partnerKey(v.name) === partnerKey(typed))) return;
    const byCode = vendors.find(v => v.code && v.code === typed.toUpperCase()); if (byCode) input.value = byCode.name;
  }, true);
  if (!input.placeholder) input.placeholder = '이름 일부 입력 · 비우고 ↓는 찾기';
  button.title = '거래처 찾기 (코드·담당자·연락처로 검색). 이름은 칸에 바로 쳐도 됩니다.';
  let serial = 0;
  const show = async () => {
    if (!hint) return; const mine = ++serial; const name = input.value.trim();
    if (!name) { hint.innerHTML = ''; return; }
    const known = vendors.find(v => partnerKey(v.name) === partnerKey(name));
    let html = known ? `<span class="muted">${known.code ? `[${esc(known.code)}] ` : ''}${esc(known.name)}${known.contact_name || known.phone ? ' · 담당 ' + esc([known.contact_name, known.phone].filter(Boolean).join(' · ')) : ' · 담당자·연락처 미등록'}</span>`
      : '<span class="muted">새 거래처입니다. 저장하면 거래처 목록에 등록됩니다. 담당자·연락처는 <a href="#/purchase/vendors">거래처 관리</a>에서 입력하세요.</span>';
    if (recent) {
      try {
        const result = await api('GET', '/api/vendors/recent-items?vendor=' + encodeURIComponent(name));
        if (mine !== serial || !hint.isConnected) return;
        html += result.items.length ? `<div class="recent-items"><b>최근 매입 품목</b> <span class="muted">눌러서 품목에 추가</span><div>${result.items.map((item, i) => `<button type="button" class="btn small" data-recent-item="${i}">${esc(item.item)}${item.spec ? ' ' + esc(item.spec) : ''}${item.unit ? ' · ' + esc(item.unit) : ''} <span class="muted">최근 ${fmtNum(item.qty)}</span></button>`).join(' ')}</div></div>`
          : '<div class="recent-items muted">이 거래처에서 매입한 기록이 아직 없습니다.</div>';
        hint.innerHTML = html;
        $$('[data-recent-item]', hint).forEach(button => button.onclick = () => onPick?.(result.items[button.dataset.recentItem]));
        return;
      } catch { /* fall through to the contact line only */ }
    }
    if (mine === serial) hint.innerHTML = html;
  };
  input.addEventListener('change', show); if (input.value) show();
  // 15.86 등록된 거래처가 들어 있어도 칸을 누르거나 ↓를 누르면 전체 목록이 보이게(브라우저 목록은 칸 글자로 걸러지므로)
  // 이름을 잠시 흐린 글씨(placeholder)로 옮겼다가, 다른 거래처를 고르지 않고 나가거나 Esc를 누르면 그대로 되돌린다.
  // 값만 바꾸고 input/change 이벤트는 보내지 않아 화면이 다시 불러오지 않는다.
  const basePlaceholder = input.placeholder;
  const openAll = () => {
    const name = input.value.trim();
    if (!name || input.readOnly || input.disabled || !vendors.some(v => partnerKey(v.name) === partnerKey(name))) return;
    input.dataset.partnerPrev = input.value; input.placeholder = input.value; input.value = '';
  };
  const restore = () => {
    if (input.dataset.partnerPrev === undefined) return;
    if (input.value === '') input.value = input.dataset.partnerPrev;
    delete input.dataset.partnerPrev; input.placeholder = basePlaceholder;
  };
  input.addEventListener('mousedown', () => { if (document.activeElement !== input || input.dataset.partnerPrev === undefined) openAll(); });
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    // 15.103 비어 있는 칸에서 ↓·Enter → 거래처 찾기 창(품목명 칸의 품목 찾기와 같은 방식). 이름이 들어 있으면 예전처럼 목록 열기·제출.
    if ((e.key === 'ArrowDown' || e.key === 'Enter') && !input.value.trim() && input.dataset.partnerPrev === undefined && !input.form?.matches('.list-filters, [data-read-only]')) { e.preventDefault(); button.click(); return; }
    if (e.key === 'Enter') restore(); // 비운 채 Enter면 원래 이름으로 되돌린 뒤 제출(빈 거래처로 조회되지 않게)
    else if ((e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown')) && input.dataset.partnerPrev === undefined) openAll();
    else if (e.key === 'Escape' && input.dataset.partnerPrev !== undefined) { restore(); e.stopPropagation(); }
  });
  input.addEventListener('input', () => { if (input.value !== '') { delete input.dataset.partnerPrev; input.placeholder = basePlaceholder; } });
  input.addEventListener('blur', restore);
  input.form?.addEventListener('submit', restore, true);
}

// 거래처 구분 체크(등록·수정)와 목록 표시
const vendorTypeChecks = (v = {}) => `<fieldset class="vendor-types"><legend>구분</legend><label class="inline"><input type="checkbox" name="is_purchase" value="1"${v.is_purchase ? ' checked' : ''}> 매입처</label><label class="inline"><input type="checkbox" name="is_sales" value="1"${v.is_sales ? ' checked' : ''}> 매출처</label></fieldset>`;
const vendorTypeChips = v => v.is_purchase || v.is_sales ? `${v.is_purchase ? '<span class="chip">매입</span>' : ''}${v.is_sales ? '<span class="chip green">매출</span>' : ''}` : '<span class="muted small">구분 없음</span>';
async function pageVendors(main) {
  main.innerHTML = `
  <h1>거래처 관리 <span class="dept">관리</span></h1>
  <p class="muted">매입처(발주·입고)와 매출처(출하·생산의뢰·고객사)를 체크해 두면 입력 화면에서 해당 거래처만 골라 보여 줍니다. 둘 다 체크하면 양쪽에 모두 나오고, 둘 다 비우면 구분 없이 어디에나 나옵니다. 누구나 거래처를 등록·수정할 수 있습니다. 발주·입고·출하 입력에서 거래처 이름을 고르면 담당자와 연락처가 함께 보이고, 발주에서는 그 거래처의 최근 매입 품목을 바로 불러올 수 있습니다. 입력 화면에서 새 이름을 쓰면 자동으로 이 목록에 추가됩니다.</p>
  <form class="card" id="vendorNew"><h3>거래처 등록</h3><div class="form-grid">
    <label>거래처코드 <span class="hint">(영문·숫자·-·_ 20자, 저장 시 대문자)</span><input name="code" maxlength="20" placeholder="비우면 자동(C0001…)" autocapitalize="characters" pattern="[A-Za-z0-9_-]{0,20}"></label>
    <label>거래처 이름 *<input name="name" required maxlength="100"></label>
    <label>담당자 이름<input name="contact_name" maxlength="50"></label>
    <label>연락처<input name="phone" maxlength="30" inputmode="tel" placeholder="예) 010-1234-5678"></label>
    ${vendorTypeChecks()}</div>
    <div class="actions">${ME.is_admin ? '<button type="button" class="btn" id="vendorFillCodes" title="코드가 비어 있는 거래처에 C0001부터 번호를 붙입니다">빈 코드 자동 채우기</button>' : ''}<button class="btn primary">등록</button></div></form>
  <div class="seg class-tabs" id="vendorTypeTabs" role="group" aria-label="거래처 구분"></div>
  <form id="vendorFilters" class="toolbar list-filters" data-read-only="true"><label class="list-search">검색<input type="search" name="q" maxlength="200" placeholder="거래처·코드·담당자·연락처"></label><button type="submit" class="btn primary">검색</button><span class="small muted" id="vendorCount"></span></form>
  <div id="vendorList"></div>`;
  const filters = $('#vendorFilters', main); let version = 0;
  let vendorTab = ''; try { vendorTab = localStorage.getItem('wpa:vendor-tab') || ''; } catch { /* 편의 기능 */ }
  const fields = v => `<label>거래처코드<input name="code" maxlength="20" value="${esc(v.code || '')}" autocapitalize="characters"></label><label>거래처 이름 *<input name="name" required maxlength="100" value="${esc(v.name)}"></label><label>담당자 이름<input name="contact_name" maxlength="50" value="${esc(v.contact_name)}"></label><label>연락처<input name="phone" maxlength="30" inputmode="tel" value="${esc(v.phone)}"></label>${vendorTypeChecks(v)}`;
  const load = async () => {
    // 15.68 구분 탭(건수 표시): 검색 결과를 전체 / 매입처 / 매출처 / 매입·매출 / 구분 없음으로 나눠 본다.
    const mine = ++version; const all = await api('GET', '/api/vendors?' + new URLSearchParams(formObj(filters)));
    if (mine !== version || !main.isConnected) return;
    const groups = [['', '전체', () => true], ['purchase', '매입처', v => v.is_purchase], ['sales', '매출처', v => v.is_sales], ['both', '매입·매출', v => v.is_purchase && v.is_sales], ['none', '구분 없음', v => !v.is_purchase && !v.is_sales]];
    const test = (groups.find(g => g[0] === vendorTab) || groups[0])[2];
    $('#vendorTypeTabs', main).innerHTML = groups.map(([key, label, f]) => `<button type="button" data-vendor-tab="${key}" class="${key === vendorTab ? 'on' : ''}" aria-pressed="${key === vendorTab}">${label} <span class="sub-count">${fmtNum(all.filter(f).length)}</span></button>`).join('');
    $$('[data-vendor-tab]', main).forEach(b => b.onclick = () => { vendorTab = b.dataset.vendorTab; try { localStorage.setItem('wpa:vendor-tab', vendorTab); } catch { /* 편의 기능 */ } load().catch(fail); });
    const rows = all.filter(test);
    if (mine !== version || !main.isConnected) return;
    $('#vendorCount').textContent = `${rows.length}곳`;
    $('#vendorList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>코드</th><th>거래처</th><th>구분</th><th>운송비 조건</th><th>담당자</th><th>연락처</th><th>등록</th><th></th></tr></thead><tbody>${rows.map((v, i) => `<tr>
      <td class="nowrap">${esc(v.code || '')}</td><td data-card-primary><b>${esc(v.name)}</b>${v.biz_no ? `<div class="small muted">${esc(v.biz_no)}</div>` : ''}</td><td>${vendorTypeChips(v)}</td><td class="small">${v.is_purchase || v.freight_terms?.length ? freightSummary(v.freight_terms) : '<span class="muted">—</span>'}</td><td>${esc(v.contact_name) || '<span class="muted">미등록</span>'}</td><td>${v.phone ? `<a href="tel:${esc(v.phone.replace(/[^0-9+]/g, ''))}">${esc(v.phone)}</a>` : '<span class="muted">미등록</span>'}</td>
      <td class="small muted">${esc(v.created_by || '')}${v.updated_by ? ` · 수정 ${esc(v.updated_by)}` : ''}</td>
      <td class="nowrap"><button class="btn small" data-vendor-recent="${i}">최근 매입</button> <button class="btn small" data-vendor-freight="${i}">운송비 조건</button> <button class="btn small" data-vendor-tax="${i}">사업자 정보</button> <button class="btn small" data-vendor-edit="${i}">수정</button>${ME.is_admin || v.created_by === ME.name ? ` <button class="btn small danger" data-vendor-del="${i}">삭제</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">등록된 거래처가 없습니다.</div>';
    $$('[data-vendor-edit]', main).forEach(button => button.onclick = async () => {
      const v = rows[button.dataset.vendorEdit]; const values = await promptBox('거래처 수정', fields(v)); if (!values) return;
      try { await api('PUT', '/api/vendors/' + v.id, values); toast('거래처를 수정했습니다.'); load(); } catch (error) { fail(error); }
    });
    $$('[data-vendor-tax]', main).forEach(button => button.onclick = () => editVendorTaxInfo(rows[button.dataset.vendorTax].name, load));
    $$('[data-vendor-del]', main).forEach(button => button.onclick = async () => {
      const v = rows[button.dataset.vendorDel]; if (!(await confirmBox(`${v.name} 거래처를 목록에서 삭제할까요? 이미 등록된 발주·입고 기록은 그대로 남습니다.`))) return;
      try { await api('DELETE', '/api/vendors/' + v.id); load(); } catch (error) { fail(error); }
    });
    // 15.69 매입처 기본 운송비 조건: 맞는 줄을 모두 더해 구매의뢰·발주 처리의 기본값이 된다(그때 고칠 수 있음).
    $$('[data-vendor-freight]', main).forEach(button => button.onclick = () => {
      const v = rows[button.dataset.vendorFreight];
      const ruleRow = (r = { when: 'gte', amount: '', fee: '', per: 'order', note: '' }) => `<tr data-rule><td><select data-r="when" aria-label="적용 조건"><option value="always"${r.when === 'always' ? ' selected' : ''}>항상</option><option value="gte"${r.when === 'gte' ? ' selected' : ''}>발주 금액 이상</option><option value="lt"${r.when === 'lt' ? ' selected' : ''}>발주 금액 미만</option></select></td>
        <td><input data-r="amount" type="number" min="0" step="any" inputmode="decimal" value="${esc(r.amount ?? '')}" placeholder="예: 1000000" aria-label="기준 금액"></td>
        <td><input data-r="fee" type="number" min="0" step="any" inputmode="decimal" required value="${esc(r.fee ?? '')}" placeholder="예: 150000" aria-label="운송비"></td>
        <td><select data-r="per" aria-label="부과"><option value="order"${r.per !== 'line' ? ' selected' : ''}>1건당</option><option value="line"${r.per === 'line' ? ' selected' : ''}>품목당</option></select></td>
        <td><input data-r="note" maxlength="30" value="${esc(r.note || '')}" placeholder="예: 착불" aria-label="메모"></td><td><button type="button" class="btn small danger" data-rule-del aria-label="조건 빼기">×</button></td></tr>`;
      const m = modal(`<h3>${esc(v.name)} 운송비 조건</h3><p class="small muted">발주 금액(매입 단가 × 수량의 합)에 따라 붙는 기본 운송비입니다. 맞는 조건은 모두 더합니다. 구매의뢰서 작성·발주 처리 때 기본값으로 들어가며 그때 고칠 수 있습니다.</p>
        <form class="stack" data-no-author data-own-errors><div class="table-wrap"><table class="grid keep-table freight-rules"><thead><tr><th>적용 조건</th><th>기준 금액(원)</th><th>운송비(원)</th><th>부과</th><th>메모</th><th></th></tr></thead><tbody data-rules>${(v.freight_terms || []).map(ruleRow).join('')}</tbody></table></div>
        <div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-rule-add>+ 조건 추가</button></div>
        <p class="small muted">예: 「발주 금액 이상 1,000,000 · 150,000 · 1건당 · 착불」, 「항상 · 7,000 · 1건당 · 화물」</p>
        <div class="actions"><button type="button" class="btn" data-close>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
      const body = $('[data-rules]', m.el), sync = () => $$('[data-rule]', body).forEach(tr => { const always = $('[data-r=when]', tr).value === 'always', amount = $('[data-r=amount]', tr); amount.disabled = always; amount.required = !always; if (always) amount.value = ''; });
      if (!body.children.length) body.insertAdjacentHTML('beforeend', ruleRow());
      sync(); body.addEventListener('change', sync);
      body.addEventListener('click', event => { if (event.target.closest('[data-rule-del]')) { event.target.closest('tr').remove(); } });
      $('[data-rule-add]', m.el).onclick = () => { if (body.children.length >= 10) return toast('운송비 조건은 10줄까지 입력할 수 있습니다.', 'err'); body.insertAdjacentHTML('beforeend', ruleRow()); sync(); };
      $('[data-close]', m.el).onclick = m.close;
      $('form', m.el).onsubmit = async event => {
        event.preventDefault(); if (!event.target.reportValidity()) return;
        const terms = $$('[data-rule]', body).map(tr => Object.fromEntries($$('[data-r]', tr).map(el => [el.dataset.r, el.value])));
        try { await api('PUT', '/api/vendors/' + v.id, { name: v.name, contact_name: v.contact_name, phone: v.phone, freight_terms: terms }); m.close(); toast('운송비 조건을 저장했습니다.'); load(); } catch (error) { fail(error); }
      };
    });
    $$('[data-vendor-recent]', main).forEach(button => button.onclick = async () => {
      const v = rows[button.dataset.vendorRecent];
      try {
        const result = await api('GET', '/api/vendors/recent-items?vendor=' + encodeURIComponent(v.name));
        modal(`<h3>${esc(v.name)} · 최근 매입 품목</h3><div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th>제품코드</th><th>규격</th><th class="r">최근 수량</th><th>최근 납기</th><th class="r">발주 횟수</th></tr></thead><tbody>${result.items.map(item => `<tr><td><b>${esc(item.item)}</b></td><td>${esc(item.product_code)}</td><td>${esc(item.spec)}</td><td class="r">${fmtNum(item.qty)} ${esc(item.unit)}</td><td>${esc(item.due_date)}</td><td class="r">${item.orders}</td></tr>`).join('') || '<tr><td colspan="6">매입 기록이 없습니다.</td></tr>'}</tbody></table></div>`, { wide: true });
      } catch (error) { fail(error); }
    });
  };
  $('#vendorNew').onsubmit = async event => {
    event.preventDefault();
    try { await api('POST', '/api/vendors', formObj(event.target)); event.target.reset(); toast('거래처를 등록했습니다.'); load(); } catch (error) { fail(error); }
  };
  filters.onsubmit = event => { event.preventDefault(); load().catch(fail); };
  const fillCodes = $('#vendorFillCodes', main);
  if (fillCodes) fillCodes.onclick = async () => {
    if (!(await confirmBox('코드가 비어 있는 거래처에 C0001부터 이어지는 번호를 붙일까요? 이미 있는 코드는 그대로 둡니다.'))) return;
    fillCodes.disabled = true;
    try { const r = await api('POST', '/api/vendors/fill-codes'); toast(`거래처 ${r.filled}곳에 코드를 붙였습니다.`); await load(); } catch (error) { fail(error); } finally { fillCodes.disabled = false; }
  };
  await load();
}
