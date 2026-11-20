// 거래처 목록과 거래처·품목 선택 도우미. 거래처는 누구나 등록·수정합니다.
const partnerKey = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
let partnerListSerial = 0;
// Search the registered partner directory without relying on the browser's datalist UI.
function pickPartner({ type = '', query = '' } = {}) {
  return new Promise(resolve => {
    let done = false, serial = 0, shown = [];
    const finish = value => { if (done) return; done = true; resolve(value); m.close(); };
    const scope = type === 'purchase' ? '매입처 · 구분 없음' : type === 'sales' ? '매출처 · 구분 없음' : '전체 거래처';
    const m = modal(`<h3>거래처 찾기</h3><p class="small muted">${scope} · 이름·코드·담당자·연락처로 검색한 뒤 선택하세요.</p>
      <form data-no-author data-partner-search class="toolbar"><label class="grow">검색<input type="search" name="q" maxlength="200" autocomplete="off" placeholder="거래처명·코드·담당자·연락처"></label><button class="btn primary">조회</button></form>
      <p class="small muted" data-partner-count role="status"></p><div data-partner-results></div><div class="actions"><button type="button" class="btn" data-partner-cancel>취소</button></div>`, { wide: true, onClose: () => { if (!done) { done = true; resolve(null); } } });
    const form = $('[data-partner-search]', m.el), input = form.elements.q, results = $('[data-partner-results]', m.el);
    if (query) input.value = query; // 15.146 칸에 친 글자로 바로 찾기
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
  // 15.146 자동완성 목록 대신 「거래처 찾기」 창으로 고른다(칸에 친 글자가 있으면 그 글자로 찾기).
  const openFind = async (query = '') => {
    if (input.disabled || input.readOnly || button.disabled) return;
    button.disabled = true;
    try {
      const partner = await pickPartner({ type, query });
      if (!partner || !input.isConnected) return;
      delete input.dataset.partnerPrev; input.value = partner.name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // 15.103 고른 뒤 다음 칸으로(Tab 흐름이 이어지게). 조회 줄이면 거래처 칸에 둔다.
      if (!input.form?.matches('.list-filters, [data-read-only]')) { const all = [...input.form?.elements || []].filter(el => el.matches('input, select, textarea') && !el.disabled && !el.readOnly && el.type !== 'hidden' && el.offsetParent !== null && !el.closest('.partner-picker')); const next = all.find(el => el.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING); Promise.resolve().then(() => (next || input).focus?.()); } else Promise.resolve().then(() => input.focus?.());
    } finally { if (button.isConnected) button.disabled = false; }
  };
  button.onclick = e => { e.preventDefault(); return openFind(isKnown(input.value) ? '' : input.value.trim()); };
  let vendors = [];
  const isKnown = v => { const t = String(v || '').trim(); return !!t && vendors.some(x => partnerKey(x.name) === partnerKey(t) || (x.code && x.code === t.toUpperCase())); };
  try { vendors = directory || await api('GET', '/api/vendors' + (type ? '?type=' + type : '')); } catch { return; } // typing a name still works without the list
  if (!input.isConnected) return;
  input.removeAttribute?.('list'); input.autocomplete = 'off'; // 15.146 브라우저 자동완성 목록은 쓰지 않음
  if (typeof attachSuggest === 'function') { let raw = ''; // 15.270 일부만 쳐도 그 글자가 들어간 거래처(이름·사업자상호·영문명·코드·담당자)를 칸 아래에
    attachSuggest(input, { source: () => vendors, max: 12,
      match: (v, key, r) => { raw = r; return [v.name, v.biz_name, v.name_en, v.code, v.contact_name].some(x => x && partnerKey(x).includes(key)); },
      label: v => `<b>${suggestMark(v.name, raw)}</b>${v.code ? ` <span class="suggest-sub">${suggestMark(v.code, raw)}</span>` : ''}${v.biz_name && v.biz_name !== v.name ? ` <span class="suggest-sub">${suggestMark(v.biz_name, raw)}</span>` : ''}${v.is_purchase || v.is_sales ? ` <span class="suggest-sub">${[v.is_purchase && '매입', v.is_sales && '매출'].filter(Boolean).join('·')}</span>` : ''}`,
      value: v => v.name }); }
  // 15.92 거래처코드를 그대로 쳐도(예: C0001) 그 거래처 이름으로 바꾼다. 화면의 change 처리보다 먼저(capture) 바꿔 같은 값으로 불러오게 한다.
  input.addEventListener('change', () => {
    const typed = input.value.trim(); if (!typed || vendors.some(v => partnerKey(v.name) === partnerKey(typed))) return;
    const byCode = vendors.find(v => v.code && v.code === typed.toUpperCase()); if (byCode) input.value = byCode.name;
  }, true);
  if (!input.placeholder || /↓/.test(input.placeholder)) input.placeholder = input.closest('form.list-filters') ? '이름·코드 입력' : '거래처 찾기 (이름·코드 입력 후 Enter)'; // 15.155 목록 조회 칸은 짧게
  button.title = '거래처 찾기 (이름·코드·담당자·연락처로 검색)';
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
  // 15.146 엔터·↓·더블클릭 → 거래처 찾기 창. 등록된 이름이 이미 있으면 Enter는 다음으로(조회 줄은 조회).
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    const typed = input.value.trim(), filter = input.form?.matches('.list-filters, [data-read-only]');
    if (e.key === 'ArrowDown' || (e.key === 'F2')) { e.preventDefault(); openFind(isKnown(typed) ? '' : typed); return; }
    if (e.key === 'Enter' && !filter && !isKnown(typed)) { e.preventDefault(); openFind(typed); }
  });
  input.addEventListener('dblclick', () => openFind(isKnown(input.value) ? '' : input.value.trim()));
}

// ── 15.111 거래처별 단가표 ── 매입(구매)·매출(영업) 탭. 단가를 바꾸면 새 적용일로 한 줄이 더해져 이력이 남는다.
async function pagePrices(main) {
  let side = 'purchase'; try { side = localStorage.getItem('wpa:price-side') || 'purchase'; } catch { /* 편의 */ }
  main.innerHTML = `<h1>단가표</h1>
  <p class="muted">거래처마다 품목 단가를 정해 둡니다. 발주 입력(매입)·수주 입력과 매출전표(매출)에서 품목을 고르면 이 단가가 먼저 들어가고, 없으면 직전 거래 단가가 들어갑니다. 단가를 바꾸면 새 적용일로 한 줄이 더해져 이력이 남습니다.</p>
  <div class="seg class-tabs" id="priceTabs" role="group" aria-label="구분"><button type="button" data-side="purchase">매입 단가</button><button type="button" data-side="sales">매출 단가</button></div>
  <form class="list-filters toolbar" data-read-only id="priceFilters"><label>거래처<input name="vendor" maxlength="100"></label><label>기준일<input type="date" name="date" value="${todayStr()}"></label><label class="grow">검색<input type="search" name="q" placeholder="거래처·품목·코드·규격"></label><button class="btn primary">조회</button><button type="button" class="btn" data-price-new>+ 단가 넣기</button></form>
  <div id="priceList"></div><div id="priceFuture"></div>`;
  const form = $('#priceFilters', main); let rows = [];
  const canEdit = () => ME.is_admin || hasRole(side === 'purchase' ? 'purchase' : 'sales');
  const tabs = () => $$('#priceTabs [data-side]', main).forEach(b => { b.classList.toggle('on', b.dataset.side === side); b.setAttribute('aria-pressed', String(b.dataset.side === side)); });
  let picker = null;
  const bindVendor = () => { picker = bindPartnerPicker(form.elements.vendor, null, { type: side }).catch(() => {}); };
  const load = async () => {
    const data = await api('GET', '/api/item-prices?' + new URLSearchParams({ ...formObj(form), side })); if (!main.isConnected) return;
    rows = data.rows; $('[data-price-new]', form).hidden = !canEdit();
    $('#priceList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>거래처</th><th>품목코드</th><th>품목</th><th>규격</th><th>단위</th><th class="r">단가</th><th class="r">이전 단가</th><th class="r">변동</th><th>적용일</th><th>비고</th><th></th></tr></thead><tbody>${rows.map((r, i) => { const diff = r.previous_price ? (r.unit_price - r.previous_price) / r.previous_price * 100 : null; return `<tr>
      <td><b>${esc(r.vendor)}</b></td><td class="nowrap">${esc(r.product_code || '')}</td><td data-card-primary><b>${esc(r.item)}</b></td><td>${esc(r.spec || '')}</td><td>${esc(r.unit || '')}</td>
      <td class="r"><b>${fmtNum(r.unit_price)}</b></td><td class="r">${r.previous_price == null ? '' : fmtNum(r.previous_price)}</td><td class="r">${diff == null ? '' : `<span class="chip ${diff > 0 ? 'red' : diff < 0 ? 'green' : ''}">${diff > 0 ? '+' : ''}${diff.toFixed(1)}%</span>`}</td>
      <td class="nowrap">${esc(r.valid_from)}</td><td class="small">${esc(r.note || '')}</td><td class="nowrap"><button class="btn small" data-price-hist="${i}">이력 ${fmtNum(r.versions)}</button>${canEdit() ? ` <button class="btn small" data-price-edit="${i}">단가 바꾸기</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>${data.more ? '<p class="small muted">2,000줄까지 보입니다. 거래처나 검색어로 좁히세요.</p>' : ''}`
      : `<div class="empty">${side === 'purchase' ? '매입' : '매출'} 단가표가 비어 있습니다. 「+ 단가 넣기」로 거래처와 품목 단가를 넣으세요.</div>`;
    $('#priceFuture', main).innerHTML = data.future.length ? `<h3>적용 예정 단가 <span class="small muted">기준일 뒤</span></h3><div class="table-wrap"><table class="grid"><thead><tr><th>거래처</th><th>품목</th><th class="r">단가</th><th>적용일</th></tr></thead><tbody>${data.future.map(f => `<tr><td>${esc(f.vendor)}</td><td data-card-primary>${esc(f.item)} <span class="small muted">${esc(f.product_code || '')}</span></td><td class="r">${fmtNum(f.unit_price)}</td><td>${esc(f.valid_from)}</td></tr>`).join('')}</tbody></table></div>` : '';
  };
  // 단가 넣기: 거래처 · 적용일 · 품목 줄(품목 찾기로 여러 개) · 단가
  const editor = async (preset = null) => {
    const catalog = await api('GET', '/api/boms');
    let lines = preset ? [{ bom_id: preset.bom_id, item: preset.item, product_code: preset.product_code, unit: preset.unit, price: preset.unit_price, note: '' }] : [];
    const m = modal(`<h3>${side === 'purchase' ? '매입' : '매출'} 단가 넣기</h3><p class="small muted">같은 거래처·품목에 이미 단가가 있으면 적용일부터 새 단가가 쓰이고 예전 단가는 이력으로 남습니다. 같은 날 다시 넣으면 그날 단가를 고칩니다.</p>
      <form class="stack" data-no-author data-own-errors><div class="form-grid"><label>거래처 *<input name="vendor" required maxlength="100" value="${esc(preset?.vendor || form.elements.vendor.value)}"></label><label>적용일 *<input type="date" name="valid_from" required value="${todayStr()}"></label></div>
      <div data-pe-lines></div><div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-pe-add>+ 품목 추가</button></div>
      <div class="actions"><button type="button" class="btn" data-close>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
    const f = $('form', m.el), box = $('[data-pe-lines]', m.el);
    bindPartnerPicker(f.elements.vendor, null, { type: side }).catch(() => {});
    const draw = () => { box.innerHTML = lines.length ? `<div class="table-wrap"><table class="grid bill-grid" data-keep-cols data-no-sort><thead><tr><th>품목</th><th>단위</th><th class="r">단가 *</th><th>비고</th><th></th></tr></thead><tbody>${lines.map((l, i) => `<tr><td data-card-primary><b>${esc(l.item)}</b> <span class="small muted">${esc(l.product_code || '')}</span></td><td>${esc(l.unit || '')}</td><td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-pe="price" data-i="${i}" value="${esc(l.price ?? '')}" aria-label="${esc(l.item)} 단가"></td><td><input data-pe="note" data-i="${i}" maxlength="200" value="${esc(l.note || '')}" aria-label="${esc(l.item)} 비고"></td><td><button type="button" class="btn small" data-pe-del="${i}">빼기</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">「+ 품목 추가」로 품목을 고르세요.</p>'; };
    draw(); enterMovesInTable(box);
    box.addEventListener('input', e => { const k = e.target.dataset.pe; if (k) lines[Number(e.target.dataset.i)][k] = e.target.value; });
    box.addEventListener('click', e => { const d = e.target.closest('[data-pe-del]'); if (d) { lines.splice(Number(d.dataset.peDel), 1); draw(); } });
    $('[data-pe-add]', m.el).onclick = async () => {
      const picked = await openItemPicker(catalog, { title: '단가 넣을 품목', filter: b => b.active !== 0 && !b.is_temp, multi: true, lots: false });
      const list = picked?.items ? picked.items.map(x => x.bom) : picked ? [picked] : [];
      for (const b of list) if (!lines.some(l => l.bom_id === b.id)) lines.push({ bom_id: b.id, item: b.product, product_code: b.product_code, unit: b.unit, price: '', note: '' });
      draw(); $$('[data-pe="price"]', box).find(i => !i.value)?.focus();
    };
    $('[data-close]', m.el).onclick = m.close;
    f.onsubmit = async e => {
      e.preventDefault(); const v = formObj(f);
      if (!v.vendor) return toast('거래처를 넣으세요.', 'err');
      if (!lines.length) return toast('품목을 넣으세요.', 'err');
      const missing = lines.find(l => l.price === '' || l.price == null); if (missing) return toast(`${missing.item}의 단가를 넣으세요.`, 'err');
      try { const r = await api('POST', '/api/item-prices', { side, vendor: v.vendor, valid_from: v.valid_from, items: lines.map(l => ({ bom_id: l.bom_id, unit_price: l.price, note: l.note })) }); PRICE_CACHE.clear(); toast(`단가 ${r.saved}줄을 저장했습니다.`); m.close(); await load(); }
      catch (error) { fail(error); }
    };
  };
  const history = async r => {
    const data = await api('GET', '/api/item-prices/history?' + new URLSearchParams({ side, vendor: r.vendor, bom_id: r.bom_id }));
    const m = modal(`<h3>${esc(r.vendor)} · ${esc(r.item)} <span class="small muted">단가 이력</span></h3><div class="table-wrap"><table class="grid"><thead><tr><th>적용일</th><th class="r">단가</th><th>비고</th><th>넣은 사람</th><th>상태</th><th></th></tr></thead><tbody>${data.rows.map(h => `<tr class="${h.active ? '' : 'row-off'}"><td>${esc(h.valid_from)}</td><td class="r"><b>${fmtNum(h.unit_price)}</b></td><td>${esc(h.note || '')}</td><td class="small muted">${esc(h.created_by)} · ${esc(String(h.created_at).slice(0, 16))}</td><td>${h.active ? '<span class="chip green">사용</span>' : `<span class="chip">뺌</span><div class="small muted">${esc(h.removed_by || '')}</div>`}</td><td>${h.active && canEdit() ? `<button class="btn small danger" data-ph-remove="${h.id}">빼기</button>` : ''}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="btn" data-close>닫기</button></div>`, { wide: true });
    $('[data-close]', m.el).onclick = m.close;
    $$('[data-ph-remove]', m.el).forEach(b => b.onclick = async () => {
      if (!(await confirmBox('이 단가 줄을 뺄까요? 그 적용일부터는 앞의 단가가 쓰입니다.'))) return;
      try { await api('POST', `/api/item-prices/${b.dataset.phRemove}/remove`); PRICE_CACHE.clear(); toast('단가 줄을 뺐습니다.'); m.close(); await load(); } catch (error) { fail(error); }
    });
  };
  $('#priceTabs', main).addEventListener('click', e => { const b = e.target.closest('[data-side]'); if (!b) return; side = b.dataset.side; try { localStorage.setItem('wpa:price-side', side); } catch { /* 편의 */ } tabs(); load().catch(fail); });
  $('#priceList', main).addEventListener('click', e => {
    const h = e.target.closest('[data-price-hist]'); if (h) return history(rows[Number(h.dataset.priceHist)]).catch(fail);
    const ed = e.target.closest('[data-price-edit]'); if (ed) return editor(rows[Number(ed.dataset.priceEdit)]).catch(fail);
  });
  $('[data-price-new]', form).onclick = () => editor().catch(fail);
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  tabs(); bindVendor(); await load();
}

// 거래처 구분 체크(등록·수정)와 목록 표시
const vendorTypeChecks = (v = {}) => `<fieldset class="vendor-types"><legend>구분</legend><label class="inline"><input type="checkbox" name="is_purchase" value="1"${v.is_purchase ? ' checked' : ''}> 매입처</label><label class="inline"><input type="checkbox" name="is_sales" value="1"${v.is_sales ? ' checked' : ''}> 매출처</label></fieldset>`;
const vendorTypeChips = v => v.is_purchase || v.is_sales ? `${v.is_purchase ? '<span class="chip">매입</span>' : ''}${v.is_sales ? '<span class="chip green">매출</span>' : ''}` : '<span class="muted small">구분 없음</span>';
// 15.267 거래처 등록·수정 양식: 기본 정보(시스템에서 부르는 거래처명) / 세금계산서(사업자) 정보(계산서에 찍히는 사업자상호) / 거래 담당자 / 결제 계좌 / 메모
function vendorFormHtml(v = {}) {
  const f = (name, label, { max = 100, type = 'text', span = '', ph = '', mode = '', req = false, list = '' } = {}) => `<label${span ? ` class="${span}"` : ''}>${label}${req ? ' *' : ''}<input name="${name}"${type !== 'text' ? ` type="${type}"` : ''} maxlength="${max}"${mode ? ` inputmode="${mode}"` : ''}${ph ? ` placeholder="${esc(ph)}"` : ''}${req ? ' required' : ''}${list ? ` list="${list}" autocomplete="off"` : ''} value="${esc(v[name] ?? '')}"></label>`;
  const sec = (title, hint, body) => `<fieldset class="vendor-sec"><legend>${title}${hint ? ` <span class="hint">${hint}</span>` : ''}</legend><div class="form-grid">${body}</div></fieldset>`;
  return sec('기본 정보', '(이 시스템에서 부르는 이름 · 목록·전표·검색에 쓰임)',
      `<label>거래처코드 <span class="hint">(영문·숫자 20자)</span><input name="code" maxlength="20" placeholder="비우면 자동(C0001…)" autocapitalize="characters" pattern="[A-Za-z0-9_-]{0,20}" value="${esc(v.code || '')}"></label>`
      + f('name', '거래처명 <span class="hint">(시스템 표시명)</span>', { req: true, ph: '예) O&M Halyard(할야드)' }) + f('name_en', '영문명', { ph: 'English name' })
      + vendorTypeChecks(v) + f('tel', '대표 전화', { max: 30, mode: 'tel' }) + f('fax', '팩스', { max: 30, mode: 'tel' })
      + f('addr', '주소 <span class="hint">(사무실·배송지)</span>', { max: 200, span: 'span2' }) + f('homepage', '홈페이지', { max: 200, ph: 'https://' })
      + f('sales_rep', '영업담당자 <span class="hint">(우리 회사 담당)</span>', { max: 50, list: 'vendorRepList' }))
    + sec('세금계산서(사업자) 정보', '(계산서·거래명세서에 찍히는 정보 — 사업자등록증대로 · 모르면 비워 두고 나중에)',
      f('biz_name', '사업자상호 <span class="hint">(계산서에 찍히는 이름)</span>', { ph: '비우면 거래처명', span: 'span2' }) + f('ceo', '대표자', { max: 50 })
      + f('biz_no', '사업자등록번호', { max: 12, mode: 'numeric', ph: '000-00-00000' }) + f('corp_no', '법인등록번호', { max: 20, mode: 'numeric', ph: '000000-0000000' })
      + f('biz_type', '업태') + f('biz_item', '종목') + f('address', '사업장 주소', { max: 200, span: 'span2' })
      + f('tax_contact', '계산서 담당자', { max: 50 }) + f('tax_dept', '담당 부서', { max: 50 }) + f('tax_phone', '담당자 전화', { max: 30, mode: 'tel' })
      + f('tax_email', '세금계산서 이메일 1', { type: 'email' }) + f('tax_email2', '세금계산서 이메일 2', { type: 'email' })
      + `<label class="inline"><input type="checkbox" name="tax_reverse" value="1"${v.tax_reverse ? ' checked' : ''}> 역발행 거래처 <span class="hint">(거래처가 발행 요청 — 예: 삼성전자)</span></label>`)
    + sec('거래 담당자', '(발주·납품 연락)',
      f('contact_name', '담당자 이름', { max: 50 }) + f('contact_title', '직위', { max: 50 }) + f('phone', '직통 전화', { max: 30, mode: 'tel', ph: '예) 02-123-4567' })
      + f('contact_mobile', '휴대전화', { max: 30, mode: 'tel', ph: '010-0000-0000' }) + f('contact_email', '이메일', { type: 'email' }))
    + sec('결제 계좌', '(대금 지급·입금 확인)', f('bank_name', '은행', { max: 50 }) + f('bank_account', '계좌번호', { max: 50 }) + f('bank_holder', '예금주', { max: 50 }))
    + `<label class="vendor-memo">메모<textarea name="memo" rows="2" maxlength="1000">${esc(v.memo || '')}</textarea></label>`;
}
// 15.274 거래처 등록·수정 팝업(한 창): 구역별 양식 + 담당자 목록(사업장·부서/용도별 여러 명)
function vendorContactRow(c = {}) {
  const f = (k, ph, w = '') => `<td><input data-c="${k}" value="${esc(c[k] || '')}" placeholder="${esc(ph)}" maxlength="${k === 'note' ? 200 : k === 'email' ? 100 : 50}"${w ? ` style="width:${w}"` : ''} aria-label="${esc(ph)}"></td>`;
  return `<tr data-contact>${f('name', '이름')}${f('site', '본사·안성·발안')}${f('title', '직위')}${f('phone', '전화')}${f('mobile', '휴대폰')}${f('email', '이메일')}${f('role', '세금계산서·발주…')}${f('note', '메모')}<td><button type="button" class="btn small danger" data-contact-del aria-label="담당자 빼기">×</button></td></tr>`;
}
function vendorContactsHtml(list = []) {
  return `<fieldset class="vendor-sec"><legend>담당자 목록 <span class="hint">(사업장·부서·용도별로 여러 명 — 예: 본사 발주, 안성 납품, 세금계산서 담당)</span></legend>
    <div class="table-wrap"><table class="grid keep-table vendor-contacts" data-no-sort data-no-filter data-keep-cols><thead><tr><th>이름</th><th>사업장·부서</th><th>직위</th><th>전화</th><th>휴대폰</th><th>이메일</th><th>용도</th><th>메모</th><th></th></tr></thead><tbody data-contacts>${(list.length ? list : [{}]).map(vendorContactRow).join('')}</tbody></table></div>
    <div class="actions" style="justify-content:flex-start"><button type="button" class="btn small" data-contact-add>＋ 담당자 추가</button></div></fieldset>`;
}
const readContacts = el => [...el.querySelectorAll('[data-contact]')].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-c]')].map(i => [i.dataset.c, i.value.trim()]))).filter(c => c.name);
async function openVendorForm(v, done) {
  let root = null;
  const saved = await promptBox(v ? `거래처 수정 · ${v.name}` : '거래처 등록', vendorFormHtml(v || {}) + vendorContactsHtml(v?.contacts || []), { wide: true,
    onOpen: el => { root = el; el.classList.add('vendor-modal'); el.addEventListener('click', e => {
      if (e.target.closest('[data-contact-add]')) { const body = el.querySelector('[data-contacts]'); if (body.children.length >= 30) return toast('담당자는 30명까지입니다.', 'err'); body.insertAdjacentHTML('beforeend', vendorContactRow()); body.lastElementChild.querySelector('input').focus(); }
      const del = e.target.closest('[data-contact-del]'); if (del) { const tr = del.closest('tr'), body = tr.parentElement; if (body.children.length > 1) tr.remove(); else tr.querySelectorAll('input').forEach(i => { i.value = ''; }); }
    }); setTimeout(() => { const ae = document.activeElement; if (!ae?.matches?.('input, select, textarea') || !el.contains(ae)) el.querySelector('[name=name]')?.focus(); }, 30); }, // 15.299 이미 다른 칸에 입력 중이면 커서를 빼앗지 않음
    submit: async vals => { const body = { ...vendorBody(vals), contacts: readContacts(root) }; return v ? api('PUT', '/api/vendors/' + v.id, body) : api('POST', '/api/vendors', body); } });
  if (!saved) return;
  toast(v ? '거래처를 수정했습니다.' : '거래처를 등록했습니다.'); await done?.();
}
const vendorBody = v => ({ ...v, tax_reverse: Array.isArray(v.tax_reverse) ? (v.tax_reverse.length ? 1 : 0) : v.tax_reverse ? 1 : 0 });
async function pageVendors(main) {
  main.innerHTML = `
  <h1>거래처 관리 <span class="dept">관리</span></h1>
  <p class="muted">매입처(발주·입고)와 매출처(출하·생산의뢰·고객사)를 체크해 두면 입력 화면에서 해당 거래처만 골라 보여 줍니다. 둘 다 체크하면 양쪽에 모두 나오고, 둘 다 비우면 구분 없이 어디에나 나옵니다. 누구나 거래처를 등록·수정할 수 있습니다. 발주·입고·출하 입력에서 거래처 이름을 고르면 담당자와 연락처가 함께 보이고, 발주에서는 그 거래처의 최근 매입 품목을 바로 불러올 수 있습니다. 입력 화면에서 새 이름을 쓰면 자동으로 이 목록에 추가됩니다.</p>
  <div class="actions vendor-bar"><button type="button" class="btn primary" id="vendorAdd">＋ 거래처 등록</button><button type="button" class="btn" id="vendorImport" title="거래처를 엑셀로 여러 곳 한 번에 등록">엑셀 올리기</button>${ME.is_admin ? '<button type="button" class="btn" id="vendorFillCodes" title="코드가 비어 있는 거래처에 C0001부터 번호를 붙입니다">빈 코드 자동 채우기</button>' : ''}</div><datalist id="vendorRepList"></datalist>
  <div class="seg class-tabs" id="vendorTypeTabs" role="group" aria-label="거래처 구분"></div>
  <form id="vendorFilters" class="toolbar list-filters" data-read-only="true"><label class="list-search">검색<input type="search" name="q" maxlength="200" placeholder="거래처·코드·담당자·연락처"></label><button type="submit" class="btn primary">조회</button><span class="small muted" id="vendorCount"></span></form>
  <div id="vendorList"></div>`;
  const filters = $('#vendorFilters', main); let version = 0;
  $('#vendorImport', main).onclick = () => importDialog({ title: '거래처 엑셀 올리기', endpoint: '/api/import/vendors', after: () => load(),
    help: '매입·매출 칸은 O·Y·1·예 중 하나면 체크. 코드를 비우면 C0001…로 자동.',
    columns: [['code', '거래처코드', '코드', '거래처 코드'], ['name', '거래처명', '거래처 이름', '거래처', '상호', '회사명'], ['is_purchase', '매입', '매입처'], ['is_sales', '매출', '매출처'], ['contact_name', '담당자', '담당자명', '담당자 이름'], ['phone', '연락처', '전화', '전화번호', '휴대폰'], ['biz_no', '사업자번호', '사업자등록번호'], ['biz_name', '상호(사업자)', '사업자 상호', '법인명'], ['ceo', '대표자', '대표', '대표자명'], ['address', '주소', '사업장주소', '사업장 주소'], ['biz_type', '업태'], ['biz_item', '종목'], ['tax_email', '세금계산서 이메일', '이메일', 'Email', '계산서이메일'], ['tax_email2', '세금계산서 이메일2', '이메일2']],
    sample: [{ code: '', name: '(예) 대한상사', is_purchase: 'O', is_sales: '', contact_name: '홍길동', phone: '010-1234-5678', biz_no: '123-45-67890', biz_name: '(주)대한상사', ceo: '김대표', address: '경기도 …', biz_type: '도소매', biz_item: '장갑', tax_email: 'tax@example.com' }] });
  let vendorTab = ''; try { vendorTab = localStorage.getItem('wpa:vendor-tab') || ''; } catch { /* 편의 기능 */ }
  const fields = v => `<label>거래처코드<input name="code" maxlength="20" value="${esc(v.code || '')}" autocapitalize="characters"></label><label>거래처 이름 *<input name="name" required maxlength="100" value="${esc(v.name)}"></label><label>담당자 이름<input name="contact_name" maxlength="50" value="${esc(v.contact_name)}"></label><label>연락처<input name="phone" maxlength="30" inputmode="tel" value="${esc(v.phone)}"></label><label>영업담당자 <span class="hint">(우리 회사 담당)</span><input name="sales_rep" maxlength="50" list="vendorRepList" autocomplete="off" value="${esc(v.sales_rep || '')}"></label>${vendorTypeChecks(v)}`;
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
    $('#vendorList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>코드</th><th>거래처</th><th>구분</th><th>운송비 조건</th><th>담당자</th><th>전화</th><th>팩스</th><th>영업담당자</th><th></th></tr></thead><tbody>${rows.map((v, i) => `<tr data-vendor-row="${i}" title="더블클릭: 수정">
      <td class="nowrap">${esc(v.code || '')}</td><td data-card-primary><b>${esc(v.name)}</b>${v.biz_name && v.biz_name !== v.name ? `<div class="small" title="세금계산서 사업자상호">계산서: ${esc(v.biz_name)}</div>` : ''}${v.biz_no ? `<div class="small muted">${esc(v.biz_no)}</div>` : ''}</td><td>${vendorTypeChips(v)}</td><td class="small">${v.is_purchase || v.freight_terms?.length ? freightSummary(v.freight_terms) : '<span class="muted">—</span>'}</td><td>${(() => { const cs = v.contacts || []; if (!cs.length) return esc(v.contact_name) || '<span class="muted">미등록</span>'; const c = cs[0]; return `<span title="${esc(cs.map(x => [x.name, x.site, x.role, x.phone || x.mobile, x.email].filter(Boolean).join(' · ')).join('\n'))}">${esc(c.name)}${c.site ? ` <span class="small muted">${esc(c.site)}</span>` : ''}${cs.length > 1 ? ` <span class="chip">외 ${cs.length - 1}명</span>` : ''}</span>`; })()}</td><td class="nowrap">${[v.phone, v.tel && v.tel !== v.phone ? v.tel : ''].filter(Boolean).map(t => `<div><a href="tel:${esc(t.replace(/[^0-9+]/g, ''))}">${esc(t)}</a></div>`).join('') || '<span class="muted">미등록</span>'}</td><td class="nowrap">${v.fax ? esc(v.fax) : '<span class="muted">—</span>'}</td><td class="nowrap">${v.sales_rep ? esc(v.sales_rep) : '<span class="muted">—</span>'}</td>
      <td class="nowrap row-acts"><button class="btn small" data-vendor-edit="${i}">수정</button>${rowMenu(v.name, [`<button class="btn small" data-vendor-recent="${i}">최근 매입</button>`, `<button class="btn small" data-vendor-freight="${i}">운송비 조건</button>`, ME.is_admin || v.created_by === ME.name ? `<button class="btn small danger" data-vendor-del="${i}">삭제</button>` : ''])}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">등록된 거래처가 없습니다.</div>';
    $$('[data-vendor-edit]', main).forEach(button => button.onclick = async () => {
      openVendorForm(rows[button.dataset.vendorEdit], load).catch(fail);
    });
    $$('[data-vendor-row]', main).forEach(tr => tr.ondblclick = e => { if (e.target.closest('button, a, input, select, .row-menu')) return; tr.querySelector('[data-vendor-edit]')?.click(); }); // 15.272 더블클릭 → 수정 창
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
  fillRepList($('#vendorRepList', main)); // 15.224 영업담당자 이름 고르기
  $('#vendorAdd', main).onclick = () => openVendorForm(null, load).catch(fail); // 15.274 등록은 팝업
  filters.onsubmit = event => { event.preventDefault(); load().catch(fail); };
  const fillCodes = $('#vendorFillCodes', main);
  if (fillCodes) fillCodes.onclick = async () => {
    if (!(await confirmBox('코드가 비어 있는 거래처에 C0001부터 이어지는 번호를 붙일까요? 이미 있는 코드는 그대로 둡니다.'))) return;
    fillCodes.disabled = true;
    try { const r = await api('POST', '/api/vendors/fill-codes'); toast(`거래처 ${r.filled}곳에 코드를 붙였습니다.`); await load(); } catch (error) { fail(error); } finally { fillCodes.disabled = false; }
  };
  await load();
}
