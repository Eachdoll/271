// 생산 → 반제품 작업 기록. 커팅/융착은 라인별, 세탁은 호기별로 기록합니다.
// 품목을 늘리려면 여기와 worker.mjs의 SEMI_PRODUCTS를 함께 고치세요.
const SEMI_PRODUCTS = { wiper: { label: '와이퍼', types: ['부직포와이퍼', '천와이퍼'] }, seamless: { label: '심리스글러브', types: ['스무드', '타키'] } };
const SEMI_SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const SEMI_PAGE = {
  cut: { title: '커팅/융착관리', unitKind: 'line', unitLabel: '라인', manage: '라인 관리', intro: '라인별로 와이퍼(부직포와이퍼·천와이퍼)와 심리스글러브(스무드·타키)를 얼마나 생산했는지 기록합니다.' },
  wash: { title: '세탁관리 (호기별)', unitKind: 'washer', unitLabel: '세탁 호기', manage: '호기 관리', intro: '세탁 호기마다 와이퍼와 심리스글러브를 얼마나 세탁했는지 기록합니다. 세탁 입고분의 불량 폐기는 구매 → 세탁관리에서 기록합니다.' },
};
const semiTypeLabel = record => record.product_type ? (record.product_group === 'seamless' ? '심리스 ' : '') + record.product_type : SEMI_PRODUCTS[record.product_group].label;
function semiProductSelect(process, group = '', type = '') {
  // One list: for cutting each type is a choice; for washing the group alone is enough, with the type optional.
  const options = Object.entries(SEMI_PRODUCTS).map(([key, product]) => `<optgroup label="${product.label}">${process === 'wash' ? `<option value="${key}|" ${group === key && !type ? 'selected' : ''}>${product.label} (종류 구분 없음)</option>` : ''}${product.types.map(t => `<option value="${key}|${t}" ${group === key && type === t ? 'selected' : ''}>${key === 'seamless' ? '심리스 ' : ''}${t}</option>`).join('')}</optgroup>`).join('');
  return `<label>품목 *<select name="product" required><option value="">선택</option>${options}</select></label>`;
}
function semiSummary(process, rows) {
  const columns = process === 'cut' ? Object.entries(SEMI_PRODUCTS).flatMap(([group, product]) => product.types.map(type => ({ key: group + '|' + type, label: (group === 'seamless' ? '심리스 ' : '') + type })))
    : Object.entries(SEMI_PRODUCTS).map(([group, product]) => ({ key: group, label: product.label }));
  const units = [...new Set(rows.map(r => r.unit_name))].sort((a, b) => a.localeCompare(b, 'ko'));
  if (!units.length) return '';
  // Quantities in different units are never added together.
  const cell = list => { const sums = {}; for (const r of list) sums[r.unit || ''] = (sums[r.unit || ''] || 0) + r.qty; return Object.entries(sums).map(([unit, qty]) => `<b>${fmtNum(Math.round(qty * 1e6) / 1e6)}</b> ${esc(unit)}`).join('<br>') || '<span class="muted">—</span>'; };
  const match = (r, column) => process === 'cut' ? r.product_group + '|' + r.product_type === column.key : r.product_group === column.key;
  return `<div class="card"><h4>기간 합계</h4><div class="table-wrap"><table class="grid keep-table"><thead><tr><th>${SEMI_PAGE[process].unitLabel}</th>${columns.map(c => `<th class="r">${c.label}</th>`).join('')}</tr></thead><tbody>${units.map(unit => `<tr><td><b>${esc(unit)}</b></td>${columns.map(c => `<td class="r">${cell(rows.filter(r => r.unit_name === unit && match(r, c)))}</td>`).join('')}</tr>`).join('')}<tr><td>합계</td>${columns.map(c => `<td class="r">${cell(rows.filter(r => match(r, c)))}</td>`).join('')}</tr></tbody></table></div></div>`;
}
// Breakdown by size / inch under each line (or washer) and product; units are kept apart.
function semiDetail(process, rows) {
  if (!rows.length) return '';
  const order = spec => { const i = SEMI_SIZES.indexOf(spec); return i >= 0 ? i : spec ? 100 + parseFloat(spec) : 999; };
  const groups = new Map();
  for (const r of rows) { const key = [r.unit_name, r.product_group, r.product_type, r.spec, r.unit].join('\u0000'); const g = groups.get(key) || { ...r, qty: 0, count: 0 }; g.qty += r.qty; g.count++; groups.set(key, g); }
  const list = [...groups.values()].sort((a, b) => a.unit_name.localeCompare(b.unit_name, 'ko') || a.product_group.localeCompare(b.product_group) || a.product_type.localeCompare(b.product_type, 'ko') || order(a.spec) - order(b.spec));
  return `<div class="card"><h4>사이즈·규격별 합계</h4><div class="table-wrap"><table class="grid keep-table"><thead><tr><th>${SEMI_PAGE[process].unitLabel}</th><th>품목</th><th>사이즈·규격</th><th class="r">수량</th><th class="r">기록</th></tr></thead><tbody>${list.map(g => `<tr><td>${esc(g.unit_name)}</td><td>${esc(semiTypeLabel(g))}</td><td>${esc(g.spec) || '<span class="muted">미지정</span>'}</td><td class="r"><b>${fmtNum(Math.round(g.qty * 1e6) / 1e6)}</b> ${esc(g.unit)}</td><td class="r small muted">${g.count}건</td></tr>`).join('')}</tbody></table></div></div>`;
}
async function manageProductionUnits(kind, after) {
  const label = kind === 'line' ? '라인' : '세탁 호기';
  const box = modal(`<h3>${label} 관리</h3><p class="small muted">이름을 바꿔도 이전 기록에는 입력 당시 이름이 남습니다. 더 쓰지 않는 ${label}은 사용 중지하세요.</p><form class="row" data-unit-new><input name="name" required maxlength="60" placeholder="${kind === 'line' ? '예) 1동 부직포라인' : '예) 1호기'}"><button class="btn primary">추가</button></form><div data-unit-list></div>`, { wide: true });
  const load = async () => {
    const units = await api('GET', `/api/production-units?kind=${kind}&all=1`); if (!box.el.isConnected) return;
    $('[data-unit-list]', box.el).innerHTML = units.length ? `<div class="table-wrap"><table class="grid keep-table"><thead><tr><th>이름</th><th>상태</th><th></th></tr></thead><tbody>${units.map((u, i) => `<tr><td><b>${esc(u.name)}</b></td><td>${u.active ? '<span class="chip green">사용 중</span>' : '<span class="chip">사용 중지</span>'}</td><td class="nowrap"><button class="btn small" data-unit-rename="${i}">이름 변경</button> <button class="btn small ${u.active ? 'danger' : ''}" data-unit-toggle="${i}">${u.active ? '사용 중지' : '다시 사용'}</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">등록된 ${label}이 없습니다.</p>`;
    $$('[data-unit-rename]', box.el).forEach(button => button.onclick = async () => {
      const u = units[button.dataset.unitRename]; const v = await promptBox(`${label} 이름 변경`, `<label>이름 *<input name="name" required maxlength="60" value="${esc(u.name)}"></label>`); if (!v) return;
      try { await api('PUT', '/api/production-units/' + u.id, v); await load(); after(); } catch (error) { fail(error); }
    });
    $$('[data-unit-toggle]', box.el).forEach(button => button.onclick = async () => {
      const u = units[button.dataset.unitToggle];
      try { await api('PUT', '/api/production-units/' + u.id, { active: !u.active }); await load(); after(); } catch (error) { fail(error); }
    });
  };
  $('[data-unit-new]', box.el).onsubmit = async event => {
    event.preventDefault();
    try { await api('POST', '/api/production-units', { kind, name: event.target.name.value }); event.target.reset(); await load(); after(); } catch (error) { fail(error); }
  };
  await load();
}
async function pageSemi(main, process) {
  const page = SEMI_PAGE[process]; const canManage = hasRole('production');
  const monthFirst = todayStr().slice(0, 8) + '01';
  main.innerHTML = `
  <h1>${page.title} <span class="dept">생산 · 반제품</span></h1>
  <p class="muted">${page.intro}</p>
  <form class="card" id="semiNew"><h3>작업 기록 입력</h3><div class="form-grid">
    <label>작업일 *<input name="work_date" type="date" required value="${todayStr()}" max="${todayStr()}"></label>
    <label>${page.unitLabel} *<select name="unit_id" required data-semi-units></select></label>
    ${semiProductSelect(process)}
    <label data-semi-size hidden>사이즈${process === 'cut' ? ' *' : ' (선택)'}<select name="size"><option value="">선택</option>${SEMI_SIZES.map(size => `<option>${size}</option>`).join('')}</select></label>
    <label data-semi-inch hidden>규격 (인치)${process === 'cut' ? ' *' : ' (선택)'}<input name="inch" type="number" min="0.1" max="200" step="any" list="semiInches" placeholder="예) 9"><datalist id="semiInches"></datalist></label>
    <label>수량 *<input name="qty" type="number" min="0" step="any" required></label>
    <label>단위<input name="unit" maxlength="20" placeholder="예) 매 / 켤레 / kg"></label>
    <label>LOT (선택)<input name="lot" maxlength="100"></label>
    <label class="span3">비고<input name="note" maxlength="500"></label></div>
    <div class="actions">${canManage ? `<button type="button" class="btn" id="semiManage">${page.manage}</button>` : ''}<button class="btn primary">기록 추가</button></div></form>
  <form id="semiFilters" class="toolbar list-filters" data-read-only="true">
    <label>시작일<input type="date" name="from" value="${monthFirst}" required></label><label>종료일<input type="date" name="to" value="${todayStr()}" required></label>
    <label>${page.unitLabel}<select name="unit_id" data-semi-units-filter></select></label>
    <label>품목<select name="product_group"><option value="">전체</option>${Object.entries(SEMI_PRODUCTS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select></label>
    <label class="list-search">검색<input type="search" name="q" maxlength="200" placeholder="LOT·비고·입력자"></label>
    <label class="inline"><input type="checkbox" id="semiDetail"> 사이즈·규격별로 보기</label>
    <button type="submit" class="btn primary">조회</button><span class="small muted" id="semiCount"></span></form>
  <div id="semiSummary"></div><div id="semiList"></div>`;
  const form = $('#semiNew', main), filters = $('#semiFilters', main); let version = 0, requestId = crypto.randomUUID();
  const loadUnits = async () => {
    const units = await api('GET', `/api/production-units?kind=${page.unitKind}&all=1`); if (!main.isConnected) return;
    const active = units.filter(u => u.active); const chosen = form.unit_id.value, filterChosen = filters.unit_id.value;
    form.unit_id.innerHTML = active.length ? '<option value="">선택</option>' + active.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('') : `<option value="">${page.unitLabel}을(를) 먼저 등록하세요</option>`;
    form.unit_id.value = active.some(u => String(u.id) === chosen) ? chosen : '';
    filters.unit_id.innerHTML = `<option value="">전체 ${page.unitLabel}</option>` + units.map(u => `<option value="${u.id}">${esc(u.name)}${u.active ? '' : ' (중지)'}</option>`).join('');
    filters.unit_id.value = units.some(u => String(u.id) === filterChosen) ? filterChosen : '';
    if (!active.length && !$('#semiNoUnits')) form.insertAdjacentHTML('afterbegin', `<p id="semiNoUnits" class="small red-text">등록된 ${page.unitLabel}이(가) 없습니다. ${canManage ? `아래 '${page.manage}'에서 추가하세요.` : '생산 담당자나 관리자에게 등록을 요청하세요.'}</p>`);
    else if (active.length) $('#semiNoUnits')?.remove();
    return units;
  };
  // Seamless gloves show the size list, wipers the inch box; cutting/fusing requires it.
  const syncSpec = () => {
    const group = String(form.product.value).split('|')[0]; const size = $('[data-semi-size]', form), inch = $('[data-semi-inch]', form);
    size.hidden = group !== 'seamless'; inch.hidden = group !== 'wiper';
    form.size.required = process === 'cut' && group === 'seamless'; form.inch.required = process === 'cut' && group === 'wiper';
    if (size.hidden) form.size.value = ''; if (inch.hidden) form.inch.value = '';
  };
  form.product.onchange = syncSpec; syncSpec();
  let lastRows = [];
  const productOf = value => { const [product_group, product_type] = String(value).split('|'); return { product_group, product_type: product_type || '' }; };
  const load = async () => {
    const mine = ++version;
    const rows = await api('GET', '/api/semi-records?' + new URLSearchParams({ process, ...formObj(filters) }));
    if (mine !== version || !main.isConnected) return;
    $('#semiCount').textContent = `${rows.length}건`;
    lastRows = rows; $('#semiSummary').innerHTML = semiSummary(process, rows) + ($('#semiDetail').checked ? semiDetail(process, rows) : '');
    $('#semiInches').innerHTML = [...new Set(rows.filter(r => r.product_group === 'wiper' && r.spec).map(r => parseFloat(r.spec)))].sort((a, b) => a - b).map(v => `<option value="${v}">`).join('');
    $('#semiList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>작업일</th><th>${page.unitLabel}</th><th>품목</th><th>사이즈·규격</th><th class="r">수량</th><th>LOT</th><th>비고</th><th>입력자</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr>
      <td class="nowrap">${esc(r.work_date)} (${dow(r.work_date)})</td><td>${esc(r.unit_name)}</td><td><span class="chip">${esc(SEMI_PRODUCTS[r.product_group].label)}</span> ${esc(r.product_type ? semiTypeLabel(r) : '')}</td><td>${esc(r.spec) || '<span class="muted">—</span>'}</td>
      <td class="r"><b>${fmtNum(r.qty)}</b> ${esc(r.unit)}</td><td>${esc(r.lot)}</td><td>${esc(r.note)}</td><td class="small muted">${esc(r.created_by)}${r.updated_by ? `<br>수정 ${esc(r.updated_by)}` : ''}</td>
      <td class="nowrap">${canManage || ME.is_admin || r.created_by === ME.name ? `<button class="btn small" data-semi-edit="${i}">수정</button> <button class="btn small danger" data-semi-del="${i}">삭제</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">이 기간에 기록이 없습니다.</div>';
    $$('[data-semi-edit]', main).forEach(button => button.onclick = async () => {
      const r = rows[button.dataset.semiEdit]; const units = await api('GET', `/api/production-units?kind=${page.unitKind}&all=1`);
      const v = await promptBox('작업 기록 수정', `<label>작업일 *<input name="work_date" type="date" required value="${esc(r.work_date)}" max="${todayStr()}"></label><label>${page.unitLabel} *<select name="unit_id" required>${units.filter(u => u.active || u.id === r.unit_id).map(u => `<option value="${u.id}" ${u.id === r.unit_id ? 'selected' : ''}>${esc(u.id === r.unit_id ? r.unit_name : u.name)}</option>`).join('')}</select></label>${semiProductSelect(process, r.product_group, r.product_type)}<label>사이즈·규격${process === 'cut' ? ' *' : ''} <span class="hint">(심리스: XS·S·M·L·XL / 와이퍼: 인치 숫자)</span><input name="spec" maxlength="20" value="${esc(r.spec)}" ${process === 'cut' ? 'required' : ''}></label><label>수량 *<input name="qty" type="number" min="0" step="any" required value="${esc(r.qty)}"></label><label>단위<input name="unit" maxlength="20" value="${esc(r.unit)}"></label><label>LOT (선택)<input name="lot" maxlength="100" value="${esc(r.lot)}"></label><label>비고<input name="note" maxlength="500" value="${esc(r.note)}"></label>`);
      if (!v) return;
      try { await api('PUT', '/api/semi-records/' + r.id, { ...v, ...productOf(v.product) }); toast('수정했습니다.'); load(); } catch (error) { fail(error); }
    });
    $$('[data-semi-del]', main).forEach(button => button.onclick = async () => {
      const r = rows[button.dataset.semiDel]; if (!(await confirmBox(`${r.work_date} ${r.unit_name} ${semiTypeLabel(r)} ${fmtNum(r.qty)} 기록을 삭제할까요?`))) return;
      try { await api('DELETE', '/api/semi-records/' + r.id); load(); } catch (error) { fail(error); }
    });
  };
  form.onsubmit = async event => {
    event.preventDefault(); const button = $('button.primary', form); if (button.disabled) return; button.disabled = true;
    const v = formObj(form);
    try {
      await api('POST', '/api/semi-records', { process, ...v, ...productOf(v.product), spec: v.size || v.inch || '', request_id: requestId });
      requestId = crypto.randomUUID(); toast('작업 기록을 추가했습니다.');
      // Keep date, line and unit for the next entry; clear what changes each time.
      form.qty.value = ''; form.lot.value = ''; form.note.value = ''; form.size.value = ''; (form.size.required ? form.size : form.qty).focus();
      if (v.work_date < filters.from.value) filters.from.value = v.work_date; if (v.work_date > filters.to.value) filters.to.value = v.work_date;
      await load();
    } catch (error) { fail(error); } finally { button.disabled = false; }
  };
  filters.onsubmit = event => { event.preventDefault(); load().catch(fail); };
  $('#semiDetail').onchange = () => { $('#semiSummary').innerHTML = semiSummary(process, lastRows) + ($('#semiDetail').checked ? semiDetail(process, lastRows) : ''); };
  if (canManage) $('#semiManage').onclick = () => manageProductionUnits(page.unitKind, () => loadUnits().catch(fail)).catch(fail);
  await loadUnits(); await load();
}
