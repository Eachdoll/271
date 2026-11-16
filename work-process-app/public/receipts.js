// 입고 입력·입고증·창고(15.72): 위에 입고 정보(입고일·거래처·비고), 아래 줄 단위 표(품목·LOT·수량·창고·위치·비고).
// 발주입고는 거래처의 미입고 발주를 불러와 줄로 담고, 기타입고는 품목 찾기로 담는다. 한 품목의 LOT 여러 개는
// 「LOT 나누기」, 엑셀 붙여넣기(LOT·수량 두 열), 「LOT 자동 번호」로 입력한다. 저장하면 입고번호(RC-…)로 묶이고 입고증을 연다.
const RC_KIND_LABEL = { po: '발주', other: '기타' };
let rcWarehouses = null;
async function rcLoadWarehouses(force = false) {
  if (!rcWarehouses || force) rcWarehouses = await api('GET', '/api/warehouses').catch(() => []);
  return rcWarehouses;
}
const rcCanManageWarehouse = () => ME && (ME.is_admin || ME.roles.includes('logistics_approver'));
function rcLocations(name) { const w = (rcWarehouses || []).find(x => x.name === name); return w && w.locations ? w.locations.split(',') : []; }
function rcWarehouseOptions(value = '') {
  return `<option value="">${(rcWarehouses || []).length ? '선택' : '창고 없음'}</option>${(rcWarehouses || []).map(w => `<option${w.name === value ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}`;
}
function rcLocationOptions(warehouse, value = '') {
  const list = rcLocations(warehouse);
  return `<option value="">${list.length ? '선택' : '—'}</option>${list.map(l => `<option${l === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}`;
}

async function pageReceiptEntry(main) {
  main.innerHTML = `<h1>입고 입력</h1>
  <p class="muted">입고일·거래처를 한 번 넣고, 아래 표에 받은 품목을 LOT별로 입력합니다. 발주입고는 그 거래처의 미입고 발주를 불러오고, 기타입고는 품목 찾기로 담습니다. 한 품목에 LOT가 여러 개면 「LOT 나누기」를 누르세요. 엑셀에서 복사한 열을 붙여넣으면 그 칸부터 아래 줄을 차례로 채우고(LOT 칸에는 LOT·수량 두 열도 됨), 표 끝을 넘을 때만 줄이 늘어납니다. 저장하면 입고번호로 묶여 입고증이 열립니다.</p>
  <form class="stack rc-form" data-no-author novalidate>
    <div class="form-grid">
      <label>입고일 *<input name="receipt_date" type="date" required value="${todayStr()}"></label>
      <label>거래처(협력사) *<input name="vendor" required maxlength="100" placeholder="매입처에서 고르거나 입력" autocomplete="off"></label><span class="partner-hint small muted" data-partner-hint></span>
      <label class="span2">비고 <span class="hint">(입고증에 인쇄)</span><input name="note" maxlength="500"></label>
    </div>
    <div class="seg class-tabs rc-tabs" role="group" aria-label="입고 구분"><button type="button" data-rc-tab="po" aria-pressed="true" class="on">발주입고</button><button type="button" data-rc-tab="other" aria-pressed="false">기타입고</button></div>
    <section class="rc-source" data-rc-source="po"><div data-rc-po><p class="muted small">거래처를 넣으면 미입고 발주가 여기에 나옵니다.</p></div></section>
    <section class="rc-source" data-rc-source="other" hidden><div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-rc-add-item>품목 추가 (여러 개·LOT 수)</button><span class="small muted">반제품은 기타입고로 받지 않습니다(생산 기록).</span></div></section>
    <section class="pr-section rc-lines-box"><h3>입고 상세</h3>
      <div class="rc-toolbar">
        <span class="small muted" data-rc-picked>선택 0줄</span>
        <label class="inline small">LOT 접두어 <input data-rc-prefix value="M" maxlength="10" size="4" aria-label="LOT 접두어"></label>
        <button type="button" class="btn small" data-rc-autolot title="LOT가 비어 있는 줄(선택한 줄이 있으면 그 줄)에 접두어+입고일_순번을 채웁니다">LOT 자동 번호</button>
        <button type="button" class="btn small" data-rc-bulk title="선택한 줄(없으면 전체)에 창고·위치·비고를 한 번에">일괄적용</button>
        <button type="button" class="btn small danger" data-rc-remove>선택 줄 삭제</button>
        ${rcCanManageWarehouse() ? '<button type="button" class="btn small" data-rc-warehouses>창고·위치 관리</button>' : ''}
      </div>
      <div class="table-wrap"><table class="grid rc-grid"><caption class="sr-only">입고 상세 줄</caption><thead><tr><th scope="col"><input type="checkbox" data-rc-all aria-label="전체 줄 선택"></th><th scope="col">No</th><th scope="col">품목</th><th scope="col">규격</th><th scope="col">단위</th><th scope="col">LOT</th><th scope="col">수량</th><th scope="col">창고</th><th scope="col">위치</th><th scope="col">비고</th><th scope="col"><span class="sr-only">줄 작업</span></th></tr></thead><tbody data-rc-lines></tbody></table></div>
      <p class="pr-totals" data-rc-total aria-live="polite"></p>
    </section>
    <div class="actions"><button class="btn primary" data-rc-save>입고 등록</button></div>
  </form>`;
  const form = $('form', main), body = $('[data-rc-lines]', form);
  await rcLoadWarehouses();
  let lines = [], seq = 0, openPos = [], catalog = null, tab = 'po', requestId = crypto.randomUUID(), busy = false;
  const vendorInput = form.elements.vendor;
  const lineKey = l => l.po_id ? 'po' + l.po_id : 'bom' + l.bom_id;
  const po = id => openPos.find(p => p.id === id) || lines.find(l => l.po_id === id)?.po;
  const readRow = tr => {
    const l = lines.find(x => x.key === tr.dataset.rcLine); if (!l) return;
    for (const el of $$('[data-f]', tr)) l[el.dataset.f] = el.value;
  };
  const readAll = () => $$('tr[data-rc-line]', body).forEach(readRow);
  const poSummary = l => {
    const p = l.po; if (!p) return '';
    const now = lines.filter(x => x.po_id === l.po_id).reduce((t, x) => t + Number(x.qty || 0), 0), before = ['ok', 'mismatch'].includes(p.recv_status) ? p.recv_qty || 0 : 0, left = p.qty - before - now;
    return `<div class="small muted rc-po-sum" data-rc-sum="${p.id}">${esc(p.req_no)} · 발주 ${fmtNum(p.qty)} · 기입고 ${fmtNum(before)} · 이번 ${fmtNum(now)} · <span class="${left < 0 ? 'red-text' : ''}">${left < 0 ? '초과 ' + fmtNum(-left) : '남음 ' + fmtNum(left)}</span></div>`;
  };
  const draw = (focus = null) => {
    body.innerHTML = lines.map((l, i) => `<tr data-rc-line="${l.key}">
      <td><input type="checkbox" data-rc-pick aria-label="${i + 1}번째 줄 선택"${l.picked ? ' checked' : ''}></td>
      <td class="c">${i + 1}<div class="small muted">${RC_KIND_LABEL[l.po_id ? 'po' : 'other']}</div></td>
      <td data-card-primary><b>${esc(l.item)}</b>${l.product_code ? `<div class="small muted">${esc(l.product_code)}</div>` : ''}${poSummary(l)}</td>
      <td>${l.po_id || l.fixedSpec ? esc(l.spec || '') : (l.sizes || []).length ? `<select data-f="spec" aria-label="${i + 1}번째 줄 규격"><option value="">사이즈</option>${l.sizes.map(z => `<option${z === l.spec ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select>` : `<input data-f="spec" value="${esc(l.spec || '')}" maxlength="100" aria-label="${i + 1}번째 줄 규격">`}</td>
      <td>${esc(l.unit || '')}</td>
      <td><input data-f="lot" value="${esc(l.lot || '')}" maxlength="100" aria-label="${i + 1}번째 줄 LOT" placeholder="LOT · 붙여넣기 가능"></td>
      <td><input data-f="qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(l.qty ?? '')}" aria-label="${i + 1}번째 줄 수량" required></td>
      <td><select data-f="warehouse" aria-label="${i + 1}번째 줄 창고"${(rcWarehouses || []).length ? '' : ' disabled'}>${rcWarehouseOptions(l.warehouse)}</select></td>
      <td><select data-f="location" aria-label="${i + 1}번째 줄 위치"${rcLocations(l.warehouse).length ? '' : ' disabled'}>${rcLocationOptions(l.warehouse, l.location)}</select></td>
      <td><input data-f="note" value="${esc(l.note || '')}" maxlength="200" aria-label="${i + 1}번째 줄 비고"></td>
      <td class="nowrap"><button type="button" class="btn small" data-rc-split>LOT 나누기</button> <button type="button" class="btn small danger" data-rc-del aria-label="${i + 1}번째 줄 삭제">×</button></td></tr>`).join('')
      || '<tr><td colspan="11" class="muted">아직 줄이 없습니다. 발주를 담거나 품목을 추가하세요.</td></tr>';
    // 휴대폰 카드의 칸 이름(표는 처음 한 번만 이름표를 붙이므로 다시 그릴 때마다 붙인다)
    const heads = $$('thead th', body.closest('table')).map(th => th.textContent.trim());
    $$('tr', body).forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = td.colSpan > 1 || i === 0 || i === heads.length - 1 ? '' : heads[i] || ''; }));
    totals();
    if (focus) { const [key, f] = focus; $(`tr[data-rc-line="${key}"] [data-f="${f}"]`, body)?.focus(); }
  };
  const totals = () => {
    const byUnit = new Map(); for (const l of lines) byUnit.set(l.unit || '', (byUnit.get(l.unit || '') || 0) + Number(l.qty || 0));
    $('[data-rc-total]', form).textContent = lines.length ? `${lines.length}줄 · 합계 ${[...byUnit].map(([u, q]) => `${fmtNum(q)}${u ? ' ' + u : ''}`).join(' · ')}` : '';
    $('[data-rc-picked]', form).textContent = `선택 ${lines.filter(l => l.picked).length}줄`;
    for (const el of $$('[data-rc-sum]', body)) { const l = lines.find(x => x.po_id === Number(el.dataset.rcSum)); if (l) el.outerHTML = poSummary(l); }
  };
  const newLine = (base, extra = {}) => ({ key: 'l' + (++seq), item: base.item, spec: base.spec || '', sizes: base.sizes || [], unit: base.unit || '', product_code: base.product_code || '', po_id: base.po_id || null, po: base.po || null, bom_id: base.bom_id || null, lot: '', qty: '', warehouse: base.warehouse || '', location: base.location || '', note: '', picked: false, ...extra });
  // 발주 불러오기
  const poBox = $('[data-rc-po]', form);
  let loadedVendor = null;
  const loadPos = async (force = false) => {
    const vendor = vendorInput.value.trim();
    // 거래처가 그대로면 다시 그리지 않는다(체크한 발주가 풀리지 않게). 저장 뒤에는 force로 새로 읽는다.
    if (!force && vendor === loadedVendor) return;
    loadedVendor = vendor;
    if (!vendor) { openPos = []; poBox.innerHTML = '<p class="muted small">거래처를 넣으면 미입고 발주가 여기에 나옵니다.</p>'; return; }
    poBox.innerHTML = '<p class="muted small">불러오는 중…</p>';
    try { openPos = await api('GET', '/api/receipts/open-po?vendor=' + encodeURIComponent(vendor)); } catch (error) { poBox.innerHTML = `<p class="field-error">${esc(error.message)}</p>`; return; }
    if ((vendorInput.dataset.partnerPrev ?? vendorInput.value).trim() !== vendor) return;
    const t = todayStr();
    poBox.innerHTML = openPos.length ? `<div class="table-wrap"><table class="grid keep-table rc-po-table"><caption class="sr-only">${esc(vendor)} 미입고 발주</caption><thead><tr><th scope="col"><input type="checkbox" data-rc-po-all aria-label="발주 전체 선택"></th><th scope="col">구매의뢰번호</th><th scope="col">품목</th><th scope="col" class="r">발주</th><th scope="col" class="r">기입고</th><th scope="col" class="r">남음</th><th scope="col">납기일</th></tr></thead><tbody>${openPos.map(p => { const before = ['ok', 'mismatch'].includes(p.recv_status) ? p.recv_qty || 0 : 0; return `<tr><td><input type="checkbox" data-rc-po-pick="${p.id}" aria-label="${esc(p.item)} 담기"${p.pending_change ? ' disabled title="입고 수정 승인 대기"' : ''}></td><td>${esc(p.req_no)}</td><td><b>${esc(p.item)}</b>${p.spec ? ` <span class="small">${esc(p.spec)}</span>` : ''}${internalNoteChip(p)}${p.pending_change ? ' <span class="chip yellow">수정 승인 대기</span>' : ''}</td><td class="r">${fmtNum(p.qty)} ${esc(p.unit || '')}</td><td class="r">${fmtNum(before)}</td><td class="r"><b>${fmtNum(Math.max(0, p.qty - before))}</b></td><td class="${p.due_date < t ? 'overdue' : ''}">${esc(p.due_date)}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="actions" style="justify-content:flex-start"><button type="button" class="btn primary" data-rc-po-add>선택 발주 담기</button></div>`
      : `<p class="muted small">${esc(vendor)}의 미입고 발주가 없습니다. 발주 없이 받은 것은 「기타입고」 탭에서 담으세요.</p>`;
    const all = $('[data-rc-po-all]', poBox); if (all) all.onchange = () => $$('[data-rc-po-pick]:not(:disabled)', poBox).forEach(c => { c.checked = all.checked; });
    const add = $('[data-rc-po-add]', poBox); if (add) add.onclick = () => addPos($$('[data-rc-po-pick]:checked', poBox).map(c => Number(c.dataset.rcPoPick)));
  };
  const addPos = ids => {
    readAll();
    if (!ids.length) return toast('담을 발주를 고르세요.', 'err');
    let added = 0;
    for (const id of ids) {
      const p = openPos.find(x => x.id === id); if (!p || lines.some(l => l.po_id === id)) continue;
      const before = ['ok', 'mismatch'].includes(p.recv_status) ? p.recv_qty || 0 : 0;
      lines.push(newLine({ item: p.item, spec: p.spec, unit: p.unit, product_code: p.product_code, po_id: p.id, po: p }, { qty: Math.max(0, p.qty - before) || '', lot: before ? '' : p.lot || '' })); // 발주에 적어 둔 LOT로 미리 채움(15.77) added++;
    }
    if (lines.length > 100) { lines = lines.slice(0, 100); toast('입고 줄은 100줄까지입니다.', 'err'); }
    draw(); if (added) toast(`발주 ${added}건을 담았습니다. LOT가 여러 개면 「LOT 나누기」를 누르세요.`);
  };
  let vendorTimer = 0;
  vendorInput.addEventListener('input', () => { clearTimeout(vendorTimer); vendorTimer = setTimeout(() => loadPos().catch(fail), 400); });
  vendorInput.addEventListener('change', () => { clearTimeout(vendorTimer); loadPos().catch(fail); });
  bindPartnerPicker(vendorInput, $('[data-partner-hint]', form), { type: 'purchase' }).catch(() => {});
  // 구분 탭
  $$('[data-rc-tab]', form).forEach(b => b.onclick = () => {
    tab = b.dataset.rcTab;
    $$('[data-rc-tab]', form).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    $$('[data-rc-source]', form).forEach(s => { s.hidden = s.dataset.rcSource !== tab; });
  });
  $('[data-rc-add-item]', form).onclick = async () => {
    readAll();
    if (!catalog) catalog = await api('GET', '/api/boms?temp=1').catch(() => []);
    // 15.79 ERP처럼 여러 품목을 체크하고 품목마다 LOT 수만큼 줄을 한 번에 만든다(LOT 자동 번호 선택).
    const pick = await openItemPicker(catalog, { title: '기타입고 품목 찾기', filter: b => !['반제품', '임가공'].includes(b.item_category), multi: true });
    if (!pick) return;
    const made = pick.items.flatMap(({ bom, count }) => Array.from({ length: count }, () => newLine({ item: bom.product, unit: bom.unit, product_code: bom.product_code, bom_id: bom.id, sizes: bom.sizes || [], spec: (bom.sizes || []).length ? '' : bom.spec || '' }, { fixedSpec: !!bom.spec && !(bom.sizes || []).length })));
    if (lines.length + made.length > 100) return toast(`입고 줄은 100줄까지입니다. 지금 ${lines.length}줄에 ${made.length}줄을 더할 수 없습니다.`, 'err');
    if (pick.autoLot) { const lots = await nextLots(made.length).catch(() => null); if (lots) made.forEach((l, k) => { l.lot = lots[k]; }); }
    lines.push(...made); draw([made[0].key, 'qty']);
    toast(`${pick.items.length}개 품목 ${made.length}줄을 추가했습니다.`);
  };

  // 표 안 동작
  body.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-rc-line]'); if (!tr) return;
    const l = lines.find(x => x.key === tr.dataset.rcLine);
    if (e.target.matches('[data-rc-pick]')) { l.picked = e.target.checked; totals(); return; }
    readRow(tr);
    if (e.target.dataset.f === 'warehouse') { l.location = ''; const loc = $('[data-f=location]', tr); loc.innerHTML = rcLocationOptions(l.warehouse); loc.disabled = !rcLocations(l.warehouse).length; }
    totals();
  });
  body.addEventListener('input', e => { const tr = e.target.closest('tr[data-rc-line]'); if (tr && e.target.dataset.f) { readRow(tr); totals(); } });
  // Enter: 아래 줄 같은 칸으로(엑셀처럼). 마지막 줄이면 그대로.
  body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.dataset.f) return;
    e.preventDefault();
    const tr = e.target.closest('tr'), next = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
    $(`[data-f="${e.target.dataset.f}"]`, next || tr)?.focus();
  });
  // 붙여넣기(15.85, 엑셀과 같게): 붙여넣은 칸부터 아래 줄을 차례로 채우고, 표 끝을 넘을 때만 마지막 줄과 같은 품목 줄을 더한다.
  // LOT 칸은 「LOT [탭] 수량」 두 칸도 받는다. 엑셀이 끝에 붙이는 줄바꿈은 버리고, 가운데 빈 칸은 빈 값으로 채운다(값이 밀리지 않게).
  body.addEventListener('paste', e => {
    const field = e.target.dataset?.f; if (!['lot', 'qty', 'note'].includes(field)) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const rows = text.replace(/\r/g, '').split('\n').map(r => r.split('\t').map(c => c.trim()));
    while (rows.length && !rows.at(-1).some(Boolean)) rows.pop();
    if (!rows.length) return;
    if (rows.length === 1 && rows[0].length === 1) { // 한 칸: 기본 붙여넣기(커서 자리에 넣음). 수량 칸의 「1,200」만 숫자로 바꿔 넣는다.
      if (field !== 'qty' || !/,/.test(rows[0][0])) return;
      const n = Number(rows[0][0].replace(/,/g, '')); if (Number.isNaN(n)) return;
      e.preventDefault(); e.target.value = String(n); e.target.dispatchEvent(new Event('input', { bubbles: true })); return;
    }
    e.preventDefault(); readAll();
    const tr = e.target.closest('tr'), line = lines.find(x => x.key === tr.dataset.rcLine);
    const value = r => { const n = Number(String(r ?? '').replace(/,/g, '')); return String(r ?? '').trim() === '' || Number.isNaN(n) ? '' : n; };
    const fill = (l, r) => { if (field === 'lot') { l.lot = r[0] || ''; if (r.length > 1) l.qty = value(r[1]); } else if (field === 'qty') l.qty = value(r[0]); else l.note = r[0] || ''; };
    const start = lines.indexOf(line), below = lines.slice(start, start + rows.length);
    const extra = field === 'note' ? 0 : rows.length - below.length; // 비고는 표 끝을 넘으면 버림
    if (lines.length + Math.max(0, extra) > 100) return toast('입고 줄은 100줄까지입니다.', 'err');
    below.forEach((l, k) => fill(l, rows[k]));
    if (extra > 0) {
      const last = lines.at(-1);
      lines.push(...rows.slice(below.length).map(r => { const l = newLine(last, { warehouse: last.warehouse, location: last.location }); fill(l, r); return l; }));
    }
    draw([line.key, field]);
    if (rows.length > 1) toast(extra > 0 ? `${below.length}줄을 채우고 표 끝에 ${extra}줄을 더했습니다.` : `${rows.length}줄을 채웠습니다.`);
  });
  body.addEventListener('click', async e => {
    const tr = e.target.closest('tr[data-rc-line]'); if (!tr) return;
    readAll(); const line = lines.find(x => x.key === tr.dataset.rcLine);
    if (e.target.closest('[data-rc-del]')) { lines = lines.filter(x => x !== line); draw(); return; }
    if (!e.target.closest('[data-rc-split]')) return;
    const total = Number(line.qty || 0);
    const v = await promptBox(`LOT 나누기 · ${line.item}`, `<p class="small muted">같은 품목 줄을 LOT 개수만큼 만듭니다. 나눈 뒤 LOT·수량을 줄마다 고칠 수 있습니다.</p>
      <div class="form-grid"><label>LOT 개수 *<input name="count" type="number" min="2" max="50" step="1" required value="2"></label>
      <label>줄마다 수량 <span class="hint">(비우면 지금 수량 ${fmtNum(total)}을 똑같이 나눔)</span><input name="each" type="number" min="0" step="any" inputmode="decimal"></label></div>
      <label class="inline"><input type="checkbox" name="auto" value="1" checked> LOT 자동 번호 붙이기 <span class="hint">(접두어 ${esc($('[data-rc-prefix]', form).value || 'M')} · 입고일)</span></label>`);
    if (!v) return;
    const count = Math.max(2, Math.min(50, Math.floor(Number(v.count) || 2)));
    if (lines.length + count - 1 > 100) return toast('입고 줄은 100줄까지입니다.', 'err');
    const each = v.each !== '' && v.each !== undefined ? Number(v.each) : total ? Math.floor(total / count * 1000) / 1000 : '';
    const made = Array.from({ length: count }, (_, i) => newLine(line, { warehouse: line.warehouse, location: line.location, note: line.note, lot: i === 0 ? line.lot : '', qty: each === '' ? '' : i === count - 1 && v.each === '' && total ? Math.round((total - each * (count - 1)) * 1000) / 1000 : each }));
    if (v.auto) { const empty = made.filter(l => !l.lot); const lots = empty.length ? await nextLots(empty.length).catch(() => null) : []; if (lots) empty.forEach((l, i) => { l.lot = lots[i]; }); }
    lines.splice(lines.indexOf(line), 1, ...made); draw([made[0].key, 'lot']);
  });
  $('[data-rc-all]', form).onchange = e => { lines.forEach(l => { l.picked = e.target.checked; }); draw(); };
  const target = () => { readAll(); const picked = lines.filter(l => l.picked); return picked.length ? picked : lines; };
  // LOT 자동 번호: 서버가 준 다음 번호와 이 표에 이미 있는 번호 중 큰 것 다음부터(저장 전 줄끼리 겹치지 않게, 15.75).
  const nextLots = async count => {
    const first = (await api('GET', `/api/lots/next?${new URLSearchParams({ prefix: $('[data-rc-prefix]', form).value || 'M', date: form.elements.receipt_date.value || todayStr(), count: 1 })}`)).lots[0];
    const head = first.replace(/\d+$/, ''), width = first.length - head.length;
    const inGrid = lines.map(l => String(l.lot || '')).filter(x => x.startsWith(head) && /^\d+$/.test(x.slice(head.length))).map(x => Number(x.slice(head.length)));
    let n = Math.max(Number(first.slice(head.length)) - 1, ...inGrid);
    return Array.from({ length: count }, () => head + String(++n).padStart(width, '0'));
  };
  $('[data-rc-autolot]', form).onclick = async () => {
    const list = target().filter(l => !String(l.lot || '').trim());
    if (!list.length) return toast('LOT가 비어 있는 줄이 없습니다.', 'err');
    try { const lots = await nextLots(list.length); list.forEach((l, i) => { l.lot = lots[i]; }); draw(); toast(`${list.length}줄에 LOT 번호를 붙였습니다.`); } catch (error) { fail(error); }
  };
  $('[data-rc-remove]', form).onclick = () => { readAll(); const n = lines.filter(l => l.picked).length; if (!n) return toast('삭제할 줄을 체크하세요.', 'err'); lines = lines.filter(l => !l.picked); draw(); };
  $('[data-rc-bulk]', form).onclick = async () => {
    const list = target(); if (!list.length) return toast('줄을 먼저 담으세요.', 'err');
    const v = await promptBox(`일괄적용 · ${list.length}줄`, `<p class="small muted">${lines.some(l => l.picked) ? '선택한 줄' : '모든 줄'}에 적용합니다. 비워 둔 칸은 바꾸지 않습니다.</p>
      <div class="form-grid"><label>창고<select name="warehouse" data-bulk-wh${(rcWarehouses || []).length ? '' : ' disabled'}>${rcWarehouseOptions()}</select></label>
      <label>위치<select name="location" data-bulk-loc disabled>${rcLocationOptions('')}</select></label>
      <label>수량<input name="qty" type="number" min="0" step="any" inputmode="decimal"></label>
      <label class="span2">비고<input name="note" maxlength="200"></label></div>`, { onOpen: el => { const wh = $('[data-bulk-wh]', el), loc = $('[data-bulk-loc]', el); wh.onchange = () => { loc.innerHTML = rcLocationOptions(wh.value); loc.disabled = !rcLocations(wh.value).length; }; } });
    if (!v) return;
    for (const l of list) { if (v.warehouse) { l.warehouse = v.warehouse; l.location = v.location || ''; } if (v.qty !== '' && v.qty !== undefined) l.qty = Number(v.qty); if (v.note) l.note = v.note; }
    draw(); toast(`${list.length}줄에 적용했습니다.`);
  };
  const manage = $('[data-rc-warehouses]', form);
  if (manage) manage.onclick = () => rcWarehouseManager(() => { readAll(); draw(); });
  // 초안(이 탭): 머리·줄
  const entryDraft = bindEntryDraft(form, 'receipt:new', {
    noPhotos: true,
    read: () => { readAll(); return { head: uxFormRead(form), lines, requestId }; },
    restore: value => { uxFormRestore(form, value.head); lines = Array.isArray(value.lines) ? value.lines.slice(0, 100) : []; seq = lines.length + 1000; if (typeof value.requestId === 'string') requestId = value.requestId; draw(); loadPos(true).catch(() => {}); },
  });
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return; readAll();
    if (!form.elements.vendor.value.trim()) { form.elements.vendor.focus(); return toast('거래처(협력사)를 입력하세요.', 'err'); }
    if (!lines.length) return toast('입고할 줄을 담으세요.', 'err');
    const empty = lines.findIndex(l => !(Number(l.qty) > 0));
    if (empty >= 0) { $(`tr[data-rc-line="${lines[empty].key}"] [data-f=qty]`, body)?.focus(); return toast(`${empty + 1}번째 줄의 수량을 넣으세요.`, 'err'); }
    const v = formObj(form);
    const payload = { receipt_date: v.receipt_date, vendor: v.vendor, note: v.note, request_id: requestId, lines: lines.map(l => ({ po_id: l.po_id || undefined, bom_id: l.po_id ? undefined : l.bom_id, spec: l.spec, lot: l.lot, qty: l.qty, warehouse: l.warehouse, location: l.location, note: l.note })) };
    busy = true; entryDraft.start(); const button = $('[data-rc-save]', form); button.disabled = true;
    try {
      const saved = await api('POST', '/api/receipts', payload);
      entryDraft.clear();
      toast(saved.duplicate ? `${saved.receipt_no} 입고는 앞서 이미 등록되었습니다. 입고증을 엽니다.` : `${saved.receipt_no} 입고를 등록했습니다. ${saved.lines.length}줄`);
      lines = []; requestId = crypto.randomUUID(); form.elements.note.value = ''; draw(); await loadPos(true).catch(() => {});
      refreshNavBadges?.();
      receiptSlip(saved);
    } catch (error) { entryDraft.failure(); fail(error); }
    finally { busy = false; button.disabled = false; }
  };
  // 입고목록에서 「LOT·부분 입고 처리」로 넘어온 발주
  let preload = null; try { preload = JSON.parse(sessionStorage.getItem('wpa:rc-preload') || 'null'); sessionStorage.removeItem('wpa:rc-preload'); } catch { preload = null; }
  draw();
  if (preload && preload.vendor) { vendorInput.value = preload.vendor; await loadPos(true).catch(fail); addPos(preload.ids || []); }
}

// 입고증(15.72): 입고번호 한 장. 인쇄·PDF 저장은 발주서와 같은 방식(body.printing-cert). LOT 라벨(QR)도 여기서 연다.
function receiptSlip(r) {
  const live = r.lines.filter(l => !l.voided_at);
  const byUnit = new Map(); for (const l of live) byUnit.set(l.unit || '', (byUnit.get(l.unit || '') || 0) + l.qty);
  const m = modal(`<h3 class="po-print-title">입고증 미리보기 <span class="small muted">${esc(r.receipt_no)} · ${r.lines.length}줄</span></h3>
    <section class="cert po-doc rc-slip">
      <div class="po-doc-head"><img src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><h2>입 고 증</h2></div>
      <table class="po-info"><tbody>
        <tr><th>입고번호</th><td>${esc(r.receipt_no)}</td><th>입고일</th><td>${esc(r.receipt_date)}</td></tr>
        <tr><th>거래처</th><td><b>${esc(r.vendor)}</b></td><th>입고 담당</th><td>${esc(r.created_by)}</td></tr>
      </tbody></table>
      <table class="po-items"><thead><tr><th>No</th><th>구분</th><th>품목</th><th>규격</th><th>LOT</th><th class="r">수량</th><th>단위</th><th>창고 · 위치</th><th>비고</th></tr></thead>
      <tbody>${r.lines.map((l, i) => `<tr${l.voided_at ? ' class="rc-void"' : ''}><td class="c">${i + 1}</td><td class="c">${l.kind === 'po' ? '발주' : '기타'}</td><td>${esc(l.item)}${l.product_code ? `<div class="po-code">${esc(l.product_code)}</div>` : ''}${l.req_no ? `<div class="po-code">${esc(l.req_no)}</div>` : ''}</td><td>${esc(l.spec || '')}</td><td>${esc(l.lot || '')}</td><td class="r">${fmtNum(l.qty)}${l.voided_at ? ' (취소)' : ''}</td><td>${esc(l.unit || '')}</td><td>${esc([l.warehouse, l.location].filter(Boolean).join(' · '))}</td><td>${esc(l.note && l.note !== r.note ? l.note : '')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="5" class="r">합계</th><td class="r" colspan="2"><b>${[...byUnit].map(([u, q]) => `${fmtNum(q)} ${esc(u)}`).join(' · ')}</b></td><td colspan="2"></td></tr></tfoot></table>
      <div class="po-memo"><b>비고</b><div class="po-memo-body">${esc(r.note || '')}</div></div>
      <table class="rc-sign"><tbody><tr><th>입고 담당</th><th>확인</th><th>승인</th></tr><tr><td></td><td></td><td></td></tr></tbody></table>
    </section>
    <div class="actions"><button class="btn" data-close>닫기</button><button class="btn" data-rc-labels>LOT 라벨(QR) 출력</button><button class="btn primary" data-print>인쇄 · PDF 저장</button></div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-rc-labels]', m.el).onclick = () => { m.close(); lotLabels(r); };
  $('[data-print]', m.el).onclick = () => rcPrint(`입고증_${r.receipt_no}`);
}
function rcPrint(name) { const title = document.title; document.title = name; document.body.classList.add('printing-cert'); try { window.print(); } finally { document.body.classList.remove('printing-cert'); document.title = title; } }

// LOT 라벨(15.72): 줄마다 한 장(품목·코드·LOT·수량·입고일·거래처·입고번호 + QR). QR 내용은 「LOT|코드|수량 단위|입고번호」.
function lotLabels(r) {
  const live = r.lines.filter(l => !l.voided_at);
  const m = modal(`<h3 class="po-print-title">LOT 라벨 <span class="small muted">${esc(r.receipt_no)} · 라벨 ${live.length}개</span></h3>
    <div class="cert rc-labels">${live.map(l => { const text = [l.lot || '-', l.product_code || l.item, `${l.qty} ${l.unit || ''}`.trim(), r.receipt_no].join('|'); return `<div class="rc-label">
      <div class="rc-label-qr">${qrSvg(text)}</div>
      <div class="rc-label-body"><b>${esc(l.item)}</b>${l.spec ? ` ${esc(l.spec)}` : ''}<div>${esc(l.product_code || '')}</div><div class="rc-label-lot">LOT ${esc(l.lot || '—')}</div><div>${fmtNum(l.qty)} ${esc(l.unit || '')} · ${esc(r.receipt_date)}</div><div class="small">${esc(r.vendor)} · ${esc(r.receipt_no)}${l.warehouse ? ' · ' + esc([l.warehouse, l.location].filter(Boolean).join(' ')) : ''}</div></div></div>`; }).join('')}</div>
    <div class="actions"><button class="btn" data-close>닫기</button><button class="btn primary" data-print>라벨 인쇄</button></div>`, { wide: true });
  m.el.parentElement.classList.add('lr-cert-wrap');
  $('[data-close]', m.el).onclick = m.close;
  $('[data-print]', m.el).onclick = () => rcPrint(`LOT라벨_${r.receipt_no}`);
}

// 입고증 목록(15.72): 입고번호별로 찾아 입고증·LOT 라벨을 다시 연다.
async function pageReceiptList(main) {
  main.innerHTML = `<h1>입고증 목록</h1>
  <form class="list-filters toolbar" data-read-only id="rcsFilters"><label>입고일<input type="date" name="from"></label><label>~<input type="date" name="to"></label><label class="grow">검색<input type="search" name="q" placeholder="입고번호·거래처·품목·LOT·입력자"></label><button class="btn">조회</button></form>
  <div id="rcsList"></div><div class="actions"><button type="button" class="btn" id="rcsMore" hidden>더 보기</button></div>`;
  const form = $('#rcsFilters', main); let rows = [], page = 0;
  const load = async (next = false) => {
    const data = await api('GET', '/api/receipts?' + new URLSearchParams({ ...formObj(form), page: next ? page + 1 : 0 }));
    if (!main.isConnected) return;
    rows = next ? rows.concat(data.rows) : data.rows; page = data.page;
    $('#rcsMore', main).hidden = !data.more;
    $('#rcsList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>입고번호</th><th>입고일</th><th>거래처</th><th>품목</th><th class="r">줄</th><th>입력자</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td data-card-primary><b>${esc(r.receipt_no)}</b></td><td>${esc(r.receipt_date)}</td><td>${esc(r.vendor)}</td><td>${esc(r.items)}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td class="r">${fmtNum(r.line_count)}${r.voided_count ? ` <span class="chip">취소 ${r.voided_count}</span>` : ''}</td><td class="small muted">${esc(r.created_by)}<br>${esc(r.created_at.slice(5, 16))}</td><td class="nowrap" data-card-primary><button class="btn small" data-rc-open="${r.id}">입고증</button> <button class="btn small" data-rc-label="${r.id}">LOT 라벨</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">조건에 맞는 입고가 없습니다.</div>';
  };
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); };
  $('#rcsMore', main).onclick = () => load(true).catch(fail);
  $('#rcsList', main).addEventListener('click', async e => {
    const b = e.target.closest('[data-rc-open],[data-rc-label]'); if (!b) return;
    try { const r = await api('GET', '/api/receipts/' + (b.dataset.rcOpen || b.dataset.rcLabel)); if (b.dataset.rcOpen) receiptSlip(r); else lotLabels(r); } catch (error) { fail(error); }
  });
  await load();
}

// 창고·위치 관리(물류팀장·관리자). 입고 기록이 없는 창고는 삭제, 있으면 사용 중지(15.104). 위치는 쉼표·줄바꿈으로 나눠 적는다.
async function rcWarehouseManager(after) {
  const list = await api('GET', '/api/warehouses?all=1');
  const m = modal(`<h3>창고·위치 관리</h3><p class="small muted">입고 줄의 창고·위치 선택지입니다. 위치를 비워 두면 그 창고는 위치 없이 씁니다. 이름을 바꾸면 지난 입고 기록의 창고 이름도 바뀝니다.</p>
    <div class="table-wrap"><table class="grid keep-table"><thead><tr><th>창고</th><th>위치(Location)</th><th>순서</th><th>사용</th><th></th></tr></thead><tbody>${list.map(w => `<tr data-wh="${w.id}"><td><input data-k="name" value="${esc(w.name)}" maxlength="50" aria-label="창고 이름"></td><td><textarea data-k="locations" rows="2" aria-label="${esc(w.name)} 위치">${esc(w.locations.split(',').join(', '))}</textarea></td><td><input data-k="sort" type="number" step="1" value="${w.sort}" aria-label="${esc(w.name)} 순서" style="width:5em"></td><td><input type="checkbox" data-k="active"${w.active ? ' checked' : ''} aria-label="${esc(w.name)} 사용"></td><td class="nowrap"><button type="button" class="btn small" data-wh-save>저장</button> <button type="button" class="btn small danger" data-wh-del title="입고 기록이 없는 창고만 지울 수 있습니다">삭제</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">등록된 창고가 없습니다.</td></tr>'}</tbody></table></div>
    <form class="form-grid" data-wh-new data-own-errors><label>새 창고 *<input name="name" required maxlength="50" placeholder="예: 5동"></label><label class="span2">위치 <span class="hint">(쉼표로 구분)</span><input name="locations" placeholder="예: 5동 1층, 5동 2층"></label><div class="actions"><button class="btn primary">창고 추가</button></div></form>
    <div class="actions"><button type="button" class="btn" data-close>닫기</button></div>`, { wide: true });
  const done = async () => { m.close(); await rcLoadWarehouses(true); after?.(); rcWarehouseManager(after); };
  $('[data-close]', m.el).onclick = async () => { m.close(); await rcLoadWarehouses(true); after?.(); };
  $$('[data-wh-save]', m.el).forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), val = k => $(`[data-k="${k}"]`, tr);
    try { await api('PUT', '/api/warehouses/' + tr.dataset.wh, { name: val('name').value, locations: val('locations').value, sort: Number(val('sort').value) || 0, active: val('active').checked }); toast('저장했습니다.'); await done(); } catch (error) { fail(error); }
  });
  $$('[data-wh-del]', m.el).forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), name = $('[data-k="name"]', tr).value;
    if (!(await confirmBox(`${name} 창고를 지울까요? 이 창고로 기록된 입고가 있으면 지워지지 않습니다.`))) return;
    try { await api('DELETE', '/api/warehouses/' + tr.dataset.wh); toast('창고를 지웠습니다.'); await done(); } catch (error) { fail(error); }
  });
  $('[data-wh-new]', m.el).onsubmit = async e => { e.preventDefault(); try { await api('POST', '/api/warehouses', formObj(e.target)); toast('창고를 추가했습니다.'); await done(); } catch (error) { fail(error); } };
}

// ── QR 코드(15.72, 외부 라이브러리 없이): 바이트 모드 · 오류 정정 M · 버전 1~10 · 마스크는 벌점이 가장 낮은 것 ──
const QR_BLOCKS = [null, [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]], [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]];
const QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const QR_EXP = new Array(512), QR_LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { QR_EXP[i] = x; QR_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) QR_EXP[i] = QR_EXP[i - 255]; })();
const qrMul = (a, b) => a && b ? QR_EXP[QR_LOG[a] + QR_LOG[b]] : 0;
function qrEcc(data, n) {
  let gen = [1];
  for (let i = 0; i < n; i++) { const next = new Array(gen.length + 1).fill(0); gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= qrMul(g, QR_EXP[i]); }); gen = next; }
  const res = new Array(n).fill(0);
  for (const d of data) { const f = d ^ res.shift(); res.push(0); for (let j = 0; j < n; j++) res[j] ^= qrMul(gen[j + 1], f); }
  return res;
}
function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1, cap = 0;
  for (; ver <= 10; ver++) { cap = QR_BLOCKS[ver][1].reduce((t, [c, d]) => t + c * d, 0); if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break; }
  if (ver > 10) throw new Error('QR 내용이 너무 깁니다.');
  const bits = []; const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);
  const [eccLen, groups] = QR_BLOCKS[ver], blocks = []; let at = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) { const d = data.slice(at, at + size); at += size; blocks.push({ d, e: qrEcc(d, eccLen) }); }
  const words = [];
  for (let i = 0; i < Math.max(...blocks.map(b => b.d.length)); i++) for (const b of blocks) if (i < b.d.length) words.push(b.d[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) words.push(b.e[i]);
  const size = 17 + ver * 4, grid = Array.from({ length: size }, () => new Array(size).fill(null)), fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, v) => { grid[r][c] = v; fixed[r][c] = true; };
  const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const y = r + i, x = c + j; if (y < 0 || x < 0 || y >= size || x >= size) continue; set(y, x, i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4))); } };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = QR_ALIGN[ver];
  for (const [ai, r] of al.entries()) for (const [aj, c] of al.entries()) { if ((ai === 0 && aj === 0) || (ai === 0 && aj === al.length - 1) || (ai === al.length - 1 && aj === 0)) continue; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }
  // 형식·버전 정보 자리 예약
  for (let i = 0; i < 9; i++) { if (!fixed[8][i]) set(8, i, false); if (!fixed[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
  set(size - 8, 8, true); // 어두운 모듈
  if (ver >= 7) { let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25); const v = (ver << 12) | rem; for (let i = 0; i < 18; i++) { const bit = ((v >> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, bit); set(b, a, bit); } }
  // 데이터 배치(지그재그)
  const stream = []; words.forEach(w => { for (let i = 7; i >= 0; i--) stream.push((w >> i) & 1); });
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (fixed[y][x]) continue;
      grid[y][x] = k < stream.length ? stream[k] === 1 : false; k++;
    }
  }
  const masks = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0, (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
  const format = mask => { const d = (0 << 3) | mask; let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537); return ((d << 10) | rem) ^ 0x5412; };
  const build = mask => {
    const g = grid.map((row, r) => row.map((v, c) => fixed[r][c] ? v : v !== masks[mask](r, c)));
    const f = format(mask), bit = i => ((f >> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) g[i][8] = bit(i);
    g[7][8] = bit(6); g[8][8] = bit(7); g[8][7] = bit(8);
    for (let i = 9; i < 15; i++) g[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) g[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) g[size - 15 + i][8] = bit(i);
    g[size - 8][8] = true;
    return g;
  };
  const penalty = g => {
    let p = 0;
    for (let pass = 0; pass < 2; pass++) for (let a = 0; a < size; a++) { let run = 1; for (let b = 1; b < size; b++) { const cur = pass ? g[b][a] : g[a][b], prev = pass ? g[b - 1][a] : g[a][b - 1]; if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) p += 3;
    const dark = g.flat().filter(Boolean).length; p += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return p;
  };
  let best = null;
  for (let mask = 0; mask < 8; mask++) { const g = build(mask), score = penalty(g); if (!best || score < best.score) best = { g, score }; }
  return best.g;
}
function qrSvg(text) {
  try {
    const g = qrMatrix(text), n = g.length, q = 4;
    let path = ''; g.forEach((row, r) => row.forEach((on, c) => { if (on) path += `M${c + q} ${r + q}h1v1h-1z`; }));
    return `<svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" role="img" aria-label="QR ${esc(text)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  } catch { return '<span class="small muted">QR 생성 불가</span>'; }
}
