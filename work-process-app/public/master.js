// 거래처 목록과 거래처·품목 선택 도우미. 거래처는 누구나 등록·수정합니다.
const partnerKey = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
let partnerListSerial = 0;
// Attach the vendor pick list to a name input; for purchase orders also suggest what was bought recently.
async function bindPartnerPicker(input, hint, { recent = false, onPick } = {}) {
  let vendors = [];
  try { vendors = await api('GET', '/api/vendors'); } catch { return; } // typing a name still works without the list
  if (!input.isConnected) return;
  const list = document.createElement('datalist'); list.id = 'partnerList' + (++partnerListSerial);
  list.innerHTML = vendors.map(v => `<option value="${esc(v.name)}">${esc([v.contact_name, v.phone].filter(Boolean).join(' · '))}</option>`).join('');
  input.after(list); input.setAttribute('list', list.id); input.autocomplete = 'off';
  if (!input.placeholder) input.placeholder = '이름 일부를 입력해 고르세요';
  let serial = 0;
  const show = async () => {
    if (!hint) return; const mine = ++serial; const name = input.value.trim();
    if (!name) { hint.innerHTML = ''; return; }
    const known = vendors.find(v => partnerKey(v.name) === partnerKey(name));
    let html = known ? `<span class="muted">${esc(known.name)}${known.contact_name || known.phone ? ' · 담당 ' + esc([known.contact_name, known.phone].filter(Boolean).join(' · ')) : ' · 담당자·연락처 미등록'}</span>`
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
}

async function pageVendors(main) {
  main.innerHTML = `
  <h1>거래처 관리 <span class="dept">구매</span></h1>
  <p class="muted">누구나 거래처를 등록·수정할 수 있습니다. 발주·입고·출하 입력에서 거래처 이름을 고르면 담당자와 연락처가 함께 보이고, 발주에서는 그 거래처의 최근 매입 품목을 바로 불러올 수 있습니다. 입력 화면에서 새 이름을 쓰면 자동으로 이 목록에 추가됩니다.</p>
  <form class="card" id="vendorNew"><h3>거래처 등록</h3><div class="form-grid">
    <label>거래처 이름 *<input name="name" required maxlength="100"></label>
    <label>담당자 이름<input name="contact_name" maxlength="50"></label>
    <label>연락처<input name="phone" maxlength="30" inputmode="tel" placeholder="예) 010-1234-5678"></label></div>
    <div class="actions"><button class="btn primary">등록</button></div></form>
  <form id="vendorFilters" class="toolbar list-filters" data-read-only="true"><label class="list-search">검색<input type="search" name="q" maxlength="200" placeholder="거래처·담당자·연락처"></label><button type="submit" class="btn primary">검색</button><span class="small muted" id="vendorCount"></span></form>
  <div id="vendorList"></div>`;
  const filters = $('#vendorFilters', main); let version = 0;
  const fields = v => `<label>거래처 이름 *<input name="name" required maxlength="100" value="${esc(v.name)}"></label><label>담당자 이름<input name="contact_name" maxlength="50" value="${esc(v.contact_name)}"></label><label>연락처<input name="phone" maxlength="30" inputmode="tel" value="${esc(v.phone)}"></label>`;
  const load = async () => {
    const mine = ++version; const rows = await api('GET', '/api/vendors?' + new URLSearchParams(formObj(filters)));
    if (mine !== version || !main.isConnected) return;
    $('#vendorCount').textContent = `${rows.length}곳`;
    $('#vendorList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>거래처</th><th>담당자</th><th>연락처</th><th>등록</th><th></th></tr></thead><tbody>${rows.map((v, i) => `<tr>
      <td><b>${esc(v.name)}</b></td><td>${esc(v.contact_name) || '<span class="muted">미등록</span>'}</td><td>${v.phone ? `<a href="tel:${esc(v.phone.replace(/[^0-9+]/g, ''))}">${esc(v.phone)}</a>` : '<span class="muted">미등록</span>'}</td>
      <td class="small muted">${esc(v.created_by || '')}${v.updated_by ? ` · 수정 ${esc(v.updated_by)}` : ''}</td>
      <td class="nowrap"><button class="btn small" data-vendor-recent="${i}">최근 매입</button> <button class="btn small" data-vendor-edit="${i}">수정</button>${ME.is_admin || v.created_by === ME.name ? ` <button class="btn small danger" data-vendor-del="${i}">삭제</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">등록된 거래처가 없습니다.</div>';
    $$('[data-vendor-edit]', main).forEach(button => button.onclick = async () => {
      const v = rows[button.dataset.vendorEdit]; const values = await promptBox('거래처 수정', fields(v)); if (!values) return;
      try { await api('PUT', '/api/vendors/' + v.id, values); toast('거래처를 수정했습니다.'); load(); } catch (error) { fail(error); }
    });
    $$('[data-vendor-del]', main).forEach(button => button.onclick = async () => {
      const v = rows[button.dataset.vendorDel]; if (!(await confirmBox(`${v.name} 거래처를 목록에서 삭제할까요? 이미 등록된 발주·입고 기록은 그대로 남습니다.`))) return;
      try { await api('DELETE', '/api/vendors/' + v.id); load(); } catch (error) { fail(error); }
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
  await load();
}
