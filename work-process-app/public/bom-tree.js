// 제품등록 BOM 트리(15.73): 제품 줄 바로 아래에 구성자재 줄을 들여 써서 펼쳐 보인다(ERP 품목리스트와 같은 모양).
// 제품 줄 = 기준 수량·단위·비고(포장 환산 1PK = 100SH 등)·사용 여부, 자재 줄 = 코드(같은 이름의 등록 품목)·분류·세부 분류·단위·소요량.
// 관리자는 기준 수량·소요량·사용 여부를 표에서 바로 고치고 「변경 저장」으로 한꺼번에 저장한다(POST /api/boms/:id/quick).
// 품목명을 누르면 그 품목을 자재로 쓰는 제품(역조회)을 보여 준다.
const BOM_TREE_COLLAPSED = new Set();
function bomTreeCatalog(all) {
  const map = new Map();
  // 같은 이름이 여럿이면 사용 중·정식 코드를 앞세운다.
  for (const b of all.slice().sort((x, y) => (y.active - x.active) || (x.is_temp - y.is_temp))) { const key = partnerKey(b.product); if (!map.has(key)) map.set(key, b); }
  return map;
}
function bomPackNote(b) { return b.pack_qty && b.semi_unit ? `1${b.unit} = ${fmtNum(b.pack_qty)}${b.semi_unit}` : ''; }
function bomWhereUsed(name, all) {
  const key = partnerKey(name);
  const users = all.filter(b => (b.materials || []).some(m => partnerKey(m.item) === key));
  const m = modal(`<h3>${esc(name)} <span class="small muted">을(를) 자재로 쓰는 제품</span></h3>
    ${users.length ? `<div class="table-wrap"><table class="grid keep-table"><thead><tr><th>제품코드</th><th>제품명</th><th class="r">소요량</th><th>기준 수량</th><th>상태</th></tr></thead><tbody>${users.map(b => { const m = b.materials.find(x => partnerKey(x.item) === key); return `<tr${b.active ? '' : ' class="row-off"'}><td>${esc(b.product_code || '—')}</td><td><b>${esc(b.product)}</b></td><td class="r">${fmtNum(m.qty)} ${esc(m.unit || '')}</td><td class="nowrap">${fmtNum(b.base_qty)} ${esc(b.unit)}</td><td>${b.active ? '<span class="chip green">사용 중</span>' : '<span class="chip">사용 중지</span>'}</td></tr>`; }).join('')}</tbody></table></div><p class="small muted">${users.length}개 제품</p>` : '<p class="muted">이 품목을 자재로 쓰는 제품이 없습니다.</p>'}
    <div class="actions"><button type="button" class="btn" data-close>닫기</button></div>`, { wide: true });
  $('[data-close]', m.el).onclick = m.close;
}
// host: 표를 넣을 곳, boms: 지금 조건의 품목, all: 전체 품목(코드·역조회용), reload: 저장 뒤 다시 읽기
function renderBomTree(host, boms, all, reload, onEdit = null) {
  const catalog = bomTreeCatalog(all);
  const tree = boms.filter(b => (b.materials || []).length);
  const skipped = boms.length - tree.length;
  const dirty = new Map(); // bom id → { base_qty, qty: [], active }
  const draw = () => {
    host.innerHTML = `<div class="bom-tree-bar"><span class="small muted">구성자재가 있는 ${fmtNum(tree.length)}개 제품${skipped ? ` · 자재 없는 품목 ${fmtNum(skipped)}개는 「목록」에서 보세요` : ''}</span>
      <button type="button" class="btn small" data-bt-open>전체 펼치기</button><button type="button" class="btn small" data-bt-close>전체 접기</button>
      <button type="button" class="btn small primary" data-bt-save disabled>변경 저장</button><button type="button" class="btn small" data-bt-reset disabled>변경 취소</button></div>
      ${tree.length ? `<div class="table-wrap"><table class="grid keep-table bom-tree"><caption class="sr-only">BOM 트리: 제품과 구성자재</caption><thead><tr><th scope="col"><span class="sr-only">펼치기</span></th><th scope="col">품목코드</th><th scope="col">품목명</th><th scope="col">품목분류</th><th scope="col">제품분류</th><th scope="col">제품구분</th><th scope="col">단위</th><th scope="col" class="r" title="제품 줄은 기준 수량, 자재 줄은 기준 수량당 소요량">소요량</th><th scope="col">비고</th><th scope="col">사용</th><th scope="col"><span class="sr-only">작업</span></th></tr></thead>
      <tbody>${tree.map(b => { const open = !BOM_TREE_COLLAPSED.has(b.id); return `<tr class="bt-product${b.active ? '' : ' row-off'}" data-bt="${b.id}">
        <td><button type="button" class="bt-toggle" data-bt-toggle="${b.id}" aria-expanded="${open}" aria-label="${esc(b.product)} 구성자재 ${open ? '접기' : '펼치기'}">${open ? '▾' : '▸'}</button></td>
        <td class="nowrap"><b>${esc(b.product_code || '—')}</b>${b.is_temp ? ' <span class="chip yellow">임시</span>' : ''}</td>
        <td><button type="button" class="bt-name" data-bt-used="${esc(b.product)}" title="이 품목을 자재로 쓰는 제품 보기"><b>${esc(b.product)}</b></button></td>
        <td>${esc(b.item_category || '미분류')}</td><td>${esc([b.cat1, b.cat2].filter(Boolean).join(' › '))}</td>
        <td>${esc(b.semi_type || (b.kind === 'semi' ? '반제품' : '완제품'))}</td><td>${esc(b.unit)}</td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-bt-base value="${esc(b.base_qty)}" aria-label="${esc(b.product)} 기준 수량"></td>
        <td class="small">${esc([b.note, bomPackNote(b)].filter(Boolean).join(' · '))}</td>
        <td><input type="checkbox" data-bt-active${b.active ? ' checked' : ''} aria-label="${esc(b.product)} 사용"></td>
        <td class="nowrap"><button type="button" class="btn small" data-bom-edit="${b.id}">수정</button></td></tr>
        ${b.materials.map((m, i) => { const c = catalog.get(partnerKey(m.item)); return `<tr class="bt-mat" data-bt-parent="${b.id}"${open ? '' : ' hidden'}>
        <td></td><td class="nowrap bt-indent">${c ? esc(c.product_code || '—') : '<span class="muted">미등록</span>'}</td>
        <td class="bt-indent"><button type="button" class="bt-name" data-bt-used="${esc(m.item)}" title="이 자재를 쓰는 제품 보기">${esc(m.item)}</button></td>
        <td>${esc(m.item_category || '')}</td><td>${esc(c ? [c.cat1, c.cat2].filter(Boolean).join(' › ') : '')}</td><td></td><td>${esc(m.unit || '')}</td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-bt-qty="${i}" value="${esc(m.qty)}" aria-label="${esc(b.product)}의 ${esc(m.item)} 소요량"></td>
        <td class="small muted">${c && !c.active ? '자재 품목 사용 중지' : ''}</td><td></td><td></td></tr>`; }).join('')}`; }).join('')}</tbody></table></div>` : '<div class="empty">구성자재가 있는 제품이 없습니다. 분류 탭을 「제품」 등으로 바꾸거나 「목록」 보기를 쓰세요.</div>'}`;
    bind();
  };
  const mark = () => {
    for (const tr of $$('tr[data-bt]', host)) {
      const b = tree.find(x => x.id === Number(tr.dataset.bt)), base = $('[data-bt-base]', tr), active = $('[data-bt-active]', tr);
      const qty = $$(`tr[data-bt-parent="${b.id}"] [data-bt-qty]`, host);
      const changed = Number(base.value) !== b.base_qty || active.checked !== !!b.active || qty.some(q => Number(q.value) !== b.materials[Number(q.dataset.btQty)].qty);
      base.classList.toggle('bt-dirty', Number(base.value) !== b.base_qty);
      qty.forEach(q => q.classList.toggle('bt-dirty', Number(q.value) !== b.materials[Number(q.dataset.btQty)].qty));
      tr.classList.toggle('bt-changed', changed);
      if (changed) dirty.set(b.id, { base_qty: base.value, active: active.checked, materials: b.materials.map((m, i) => ({ item: m.item, qty: qty[i].value })) }); else dirty.delete(b.id);
    }
    $('[data-bt-save]', host).disabled = $('[data-bt-reset]', host).disabled = !dirty.size;
    $('[data-bt-save]', host).textContent = dirty.size ? `변경 저장 (${dirty.size})` : '변경 저장';
  };
  const bind = () => {
    $$('[data-bt-toggle]', host).forEach(button => button.onclick = () => {
      const id = Number(button.dataset.btToggle), open = BOM_TREE_COLLAPSED.has(id);
      if (open) BOM_TREE_COLLAPSED.delete(id); else BOM_TREE_COLLAPSED.add(id);
      $$(`tr[data-bt-parent="${id}"]`, host).forEach(tr => { tr.hidden = !open; });
      button.textContent = open ? '▾' : '▸'; button.setAttribute('aria-expanded', String(open));
      const name = tree.find(b => b.id === id).product; button.setAttribute('aria-label', `${name} 구성자재 ${open ? '접기' : '펼치기'}`);
    });
    const expandAll = open => { tree.forEach(b => { if (open) BOM_TREE_COLLAPSED.delete(b.id); else BOM_TREE_COLLAPSED.add(b.id); }); $$('tr[data-bt-parent]', host).forEach(tr => { tr.hidden = !open; }); $$('[data-bt-toggle]', host).forEach(button => { button.textContent = open ? '▾' : '▸'; button.setAttribute('aria-expanded', String(open)); }); };
    $('[data-bt-open]', host).onclick = () => expandAll(true);
    $('[data-bt-close]', host).onclick = () => expandAll(false);
    host.oninput = host.onchange = e => { if (e.target.matches('[data-bt-base],[data-bt-qty],[data-bt-active]')) mark(); };
    $$('[data-bt-used]', host).forEach(button => button.onclick = () => bomWhereUsed(button.dataset.btUsed, all));
    $('[data-bt-reset]', host).onclick = () => { dirty.clear(); draw(); };
    // 다시 그린 뒤에도 「수정」이 동작하도록 여기서 붙인다(15.75).
    if (onEdit) $$('[data-bom-edit]', host).forEach(button => button.onclick = () => onEdit(Number(button.dataset.bomEdit)));
    $('[data-bt-save]', host).onclick = async () => {
      const button = $('[data-bt-save]', host); button.disabled = true;
      const errors = []; let saved = 0;
      for (const [id, change] of dirty) {
        const b = tree.find(x => x.id === id);
        try { await api('POST', `/api/boms/${id}/quick`, { updated_at: b.updated_at, before: { base_qty: b.base_qty, active: !!b.active, qty: b.materials.map(m => m.qty) }, ...change }); saved++; } catch (error) { errors.push(error.message); }
      }
      if (saved) toast(`${saved}개 제품을 저장했습니다.`);
      if (errors.length) toast(errors.join(' / '), 'err');
      await reload();
    };
  };
  draw();
}


// ── 15.196 BOM 소요량: 제품·반제품마다 구성자재·기준 수량당 소요량을 한 표로(품목코드 · 품목명 · 분류 순서).
// 「수정」을 누르면 그 제품 자리에서 자재를 더하고 빼고 소요량·단위를 고쳐 한 번에 저장(POST /api/boms/:id/bom).
// 생산 수량을 넣으면 필요량(소요량 ÷ 기준 수량 × 생산 수량)을, 「자재별」은 자재마다 쓰는 제품(역전개)을 보여 준다.
function bomMatPicker(scope, rows, mats) {
  const fill = (row, b) => { $('[data-material-item]', row).value = b.product; const c = $('[data-material-category]', row); if ([...c.options].some(o => o.value === b.item_category)) c.value = b.item_category; if (b.unit) $('[data-material-unit]', row).value = b.unit; $('[data-material-qty]', row).focus(); };
  const find = async row => { if (!mats.length) { toast('제품등록에 원자재·부자재가 아직 없습니다. 자재명을 직접 입력하세요.', 'err'); return; } const b = await openItemPicker(mats, { title: '구성자재 찾기', query: $('[data-material-item]', row).value.trim(), lots: false, emptyText: '찾는 자재가 없습니다. 창을 닫고 자재명을 직접 입력하세요.' }); if (b && !b.items) fill(row, b); };
  $('[data-material-add]', scope).onclick = () => { rows.insertAdjacentHTML('beforeend', bomMaterialRow()); const row = rows.lastElementChild; if (mats.length) find(row).catch(fail); else $('[data-material-item]', row).focus(); };
  rows.onclick = e => { const f = e.target.closest('[data-material-find]'); if (f) { find(f.closest('tr')).catch(fail); return; } const d = e.target.closest('[data-material-remove]'); if (d) d.closest('tr').remove(); };
  rows.addEventListener('change', e => { const input = e.target.closest('[data-material-item]'); if (!input) return; const b = mats.find(x => partnerKey(x.product) === partnerKey(input.value)); if (b) fill(input.closest('tr'), b); });
}
async function pageBomSheet(main) {
  if (!ME.is_admin) { main.innerHTML = '<div class="empty">관리자만 BOM을 관리할 수 있습니다.</div>'; return; }
  let view = 'product'; try { view = localStorage.getItem('wpa:bom-sheet-view') === 'material' ? 'material' : 'product'; } catch { /* 편의 기능 */ }
  main.innerHTML = `<h1>BOM 소요량</h1><p class="muted">제품·반제품마다 구성자재와 기준 수량당 소요량을 한 표로 봅니다. 「수정」을 누르면 그 자리에서 자재를 더하거나 빼고 소요량·단위를 고칩니다. 생산 수량을 넣으면 자재별 필요량을 계산하고, 「자재별」은 자재마다 어느 제품에 얼마나 들어가는지 보여 줍니다.</p>
  <form class="toolbar bs-tools" id="bsTools" data-read-only>
    <label>검색<input name="q" type="search" placeholder="제품·자재 코드나 이름" autocomplete="off"></label>
    <label>분류<select name="cls"><option value="">제품·반제품 전체</option><option value="제품">제품</option><option value="반제품">반제품</option></select></label>
    <label>생산 수량<input name="calc" type="number" min="0" step="any" placeholder="필요량 계산"></label>
    <label class="inline"><input type="checkbox" name="empty"> 구성자재 없는 것만</label>
    <div class="seg" role="group" aria-label="보기"><button type="button" data-bs-view="product">제품별</button><button type="button" data-bs-view="material">자재별</button></div>
    <button type="button" class="btn" data-bs-all="open">전체 펼치기</button><button type="button" class="btn" data-bs-all="close">전체 접기</button>
    <button type="button" class="btn" id="bsXlsx">엑셀</button><a class="btn" href="#/admin/bom">제품등록</a>
  </form>
  <p class="small muted" id="bsSummary" role="status"></p><div id="bsList"><p class="muted">불러오는 중…</p></div><datalist id="bomMatList"></datalist>`;
  const form = $('#bsTools', main); let all = [], cat = new Map(), editing = null; const collapsed = new Set();
  form.onsubmit = e => e.preventDefault();
  const codeOf = name => cat.get(partnerKey(name))?.product_code || '';
  const N = () => Math.max(0, Number(form.elements.calc.value) || 0);
  const round = n => Math.round(n * 10000) / 10000;
  const qOf = () => form.elements.q.value.trim().toLowerCase();
  const hit = (...xs) => { const q = qOf(); return !q || xs.some(x => String(x || '').toLowerCase().includes(q)); };
  const products = () => all.filter(b => (['제품', '반제품'].includes(b.item_category) || b.materials.length)
      && (!form.elements.cls.value || b.item_category === form.elements.cls.value) && (!form.elements.empty.checked || !b.materials.length)
      && hit(b.product_code, b.product, ...b.materials.flatMap(m => [m.item, codeOf(m.item)])))
    .sort((a, b) => String(a.product_code || '~').localeCompare(String(b.product_code || '~')) || a.product.localeCompare(b.product, 'ko'));
  const editorHtml = b => `<div class="bs-editor" data-bs-editor="${b.id}">
      <div class="bs-ed-head"><b>${esc(b.product_code || '')}</b> <b>${esc(b.product)}</b> <span class="chip">${esc(b.item_category)}</span>
        <label class="inline">기준 수량 <input name="base_qty" type="number" min="0.00000001" step="any" value="${esc(b.base_qty)}"> ${esc(b.unit)}</label><span class="small muted">소요량은 기준 수량당 들어가는 양</span></div>
      <div class="table-wrap"><table class="grid bom-materials" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>자재명</th><th>분류</th><th>소요량</th><th>단위</th><th></th></tr></thead><tbody data-material-rows>${b.materials.map(bomMaterialRow).join('')}</tbody></table></div>
      <div class="actions"><button type="button" class="btn" data-material-add>+ 자재 추가</button><span class="grow"></span><button type="button" class="btn" data-bs-cancel>취소</button><button type="button" class="btn primary" data-bs-save>저장</button></div></div>`;
  // 15.197 하이라키(트리) 모양: 부모 줄(▾ 펼치기·접기) 아래 자식 줄을 └ 선으로 들여 쓴다. 열은 품목코드·품목명·품목분류·제품분류·제품구분·단위·소요량·비고·사용여부.
  const fq = n => Number(n).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const kindOf = b => b.semi_type || (b.item_category === '반제품' || b.kind === 'semi' ? '반제품' : ['제품', '상품', '임가공'].includes(b.item_category) ? '완제품' : '');
  const catsOf = b => b ? [b.cat1, b.cat2].filter(Boolean).join(' › ') : '';
  const useBox = (on, label) => `<span class="bs-use${on ? ' on' : ''}" role="img" aria-label="${esc(label)} ${on ? '사용' : '사용 안 함'}">${on ? '✓' : ''}</span>`;
  const head = (n, first) => `<thead><tr><th scope="col"><span class="sr-only">펼치기</span></th><th scope="col">${first}코드</th><th scope="col" class="c">NO</th><th scope="col">${first}명</th><th scope="col">품목분류</th><th scope="col">제품분류</th><th scope="col">제품구분</th><th scope="col">단위</th><th scope="col" class="r">소요량</th>${n ? `<th scope="col" class="r">필요량 (${fmtNum(n)})</th>` : ''}<th scope="col">비고</th><th scope="col">사용여부</th><th scope="col"><span class="sr-only">작업</span></th></tr></thead>`;
  const toggle = (key, open, label) => `<button type="button" class="bt-toggle" data-bs-toggle="${esc(key)}" aria-expanded="${open}" aria-label="${esc(label)} ${open ? '접기' : '펼치기'}">${open ? '▾' : '▸'}</button>`;
  const productTable = list => {
    const n = N(), cols = n ? 13 : 12;
    const body = list.map((b, bi) => {
      const key = 'p' + b.id, open = !collapsed.has(key) || editing === b.id;
      const parent = `<tr class="bt-product${b.active ? '' : ' row-off'}" data-bs-product="${b.id}"><td>${toggle(key, open, b.product + ' 구성자재')}</td>
        <td class="nowrap"><b>${esc(b.product_code || '—')}</b></td><td class="c bs-no">${bi + 1}</td><td><b>${esc(b.product)}</b>${b.spec ? ` <span class="small muted">${esc(b.spec)}</span>` : ''}</td>
        <td>${esc(b.item_category)}</td><td>${esc(catsOf(b))}</td><td>${esc(kindOf(b))}</td><td>${esc(b.unit)}</td><td class="r">${fq(b.base_qty)}</td>${n ? `<td class="r bs-need">${fmtNum(n)}</td>` : ''}
        <td class="small">${esc([b.note, bomPackNote(b)].filter(Boolean).join(' · '))}${b.materials.length ? '' : ' <span class="chip red">구성자재 없음</span>'}</td><td>${useBox(b.active, b.product)}</td>
        <td class="nowrap">${editing === b.id ? '' : `<button type="button" class="btn small" data-bs-edit="${b.id}">수정</button>`}</td></tr>`;
      if (editing === b.id) return parent + `<tr class="bs-edit-row"><td></td><td colspan="${cols - 1}">${editorHtml(b)}</td></tr>`;
      const kids = b.materials.length ? b.materials.map((m, mi) => { const c = cat.get(partnerKey(m.item)); return `<tr class="bt-mat" data-bs-of="${key}"${open ? '' : ' hidden'}><td></td>
        <td class="nowrap bt-indent">${c ? esc(c.product_code || '—') : '<span class="muted small">미등록</span>'}</td><td class="c small muted">${bi + 1}-${mi + 1}</td><td class="bt-indent">${esc(m.item)}</td>
        <td>${esc(m.item_category)}</td><td>${esc(catsOf(c))}</td><td></td><td>${esc(m.unit)}</td><td class="r"><b>${fq(m.qty)}</b></td>${n ? `<td class="r bs-need">${fmtNum(round(m.qty / b.base_qty * n))}</td>` : ''}
        <td class="small muted">${c ? (c.active ? '' : '자재 품목 사용 중지') : '제품등록에 없는 자재'}</td><td>${c ? useBox(c.active, m.item) : ''}</td><td></td></tr>`; }).join('')
        : `<tr class="bt-mat" data-bs-of="${key}"${open ? '' : ' hidden'}><td></td><td colspan="${cols - 1}" class="bt-indent bs-none">구성자재 없음 — 「수정」에서 넣으세요</td></tr>`;
      return parent + kids;
    }).join('');
    return `<div class="table-wrap"><table class="grid keep-table bom-tree bs-table" data-no-sort data-no-filter data-keep-cols data-no-reorder><caption class="sr-only">제품별 BOM 소요량(트리)</caption>${head(n, '품목')}<tbody>${body}</tbody></table></div>`;
  };
  const materialGroups = list => {
    const by = new Map();
    for (const b of list) for (const m of b.materials) {
      if (qOf() && !hit(b.product_code, b.product, m.item, codeOf(m.item))) continue;
      const k = partnerKey(m.item); if (!by.has(k)) by.set(k, { item: m.item, cat: m.item_category, uses: [] }); by.get(k).uses.push({ b, m });
    }
    return [...by.values()].sort((x, y) => String(codeOf(x.item) || '~').localeCompare(String(codeOf(y.item) || '~')) || x.item.localeCompare(y.item, 'ko'));
  };
  const materialTable = list => {
    const groups = materialGroups(list), n = N();
    if (!groups.length) return '<div class="empty">조건에 맞는 자재가 없습니다.</div>';
    const body = groups.map((g, gi) => {
      const key = 'm' + partnerKey(g.item), open = !collapsed.has(key), c = cat.get(partnerKey(g.item)), units = new Set(g.uses.map(u => u.m.unit));
      const total = n && units.size === 1 ? g.uses.reduce((t, u) => t + u.m.qty / u.b.base_qty * n, 0) : null;
      return `<tr class="bt-product"><td>${toggle(key, open, g.item + ' 쓰는 제품')}</td><td class="nowrap"><b>${esc(codeOf(g.item) || '—')}</b></td><td class="c bs-no">${gi + 1}</td><td><b>${esc(g.item)}</b></td>
        <td>${esc(g.cat)}</td><td>${esc(catsOf(c))}</td><td></td><td>${esc([...units].join(', '))}</td><td class="r"></td>${n ? `<td class="r bs-need">${total !== null ? fmtNum(round(total)) : ''}</td>` : ''}
        <td class="small">쓰는 제품 ${g.uses.length}개</td><td>${c ? useBox(c.active, g.item) : ''}</td><td></td></tr>`
        + g.uses.map((u, ui) => `<tr class="bt-mat" data-bs-of="${esc(key)}"${open ? '' : ' hidden'}><td></td><td class="nowrap bt-indent">${esc(u.b.product_code || '—')}</td><td class="c small muted">${gi + 1}-${ui + 1}</td><td class="bt-indent">${esc(u.b.product)}</td>
        <td>${esc(u.b.item_category)}</td><td>${esc(catsOf(u.b))}</td><td>${esc(kindOf(u.b))}</td><td>${esc(u.m.unit)}</td><td class="r"><b>${fq(u.m.qty)}</b></td>${n ? `<td class="r bs-need">${fmtNum(round(u.m.qty / u.b.base_qty * n))}</td>` : ''}
        <td class="small muted">기준 ${fmtNum(u.b.base_qty)} ${esc(u.b.unit)}당</td><td>${useBox(u.b.active, u.b.product)}</td><td class="nowrap"><button type="button" class="btn small" data-bs-goto="${u.b.id}" title="제품별 보기에서 이 제품 수정">수정</button></td></tr>`).join('');
    }).join('');
    return `<div class="table-wrap"><table class="grid keep-table bom-tree bs-table" data-no-sort data-no-filter data-keep-cols data-no-reorder><caption class="sr-only">자재별 사용 제품(트리)</caption>${head(n, '자재')}<tbody>${body}</tbody></table></div>`;
  };
  const bindEditor = () => {
    const ed = $('[data-bs-editor]', main); if (!ed) return;
    const b = all.find(x => x.id === editing), rows = $('[data-material-rows]', ed);
    bomMatPicker(ed, rows, all.filter(x => x.item_category !== '제품' && x.id !== b.id));
    $('[data-bs-cancel]', ed).onclick = () => { editing = null; draw(); };
    $('[data-bs-save]', ed).onclick = async e => {
      const btn = e.currentTarget, materials = $$('[data-material-row]', ed).map(row => ({ item: $('[data-material-item]', row).value.trim(), item_category: $('[data-material-category]', row).value, qty: $('[data-material-qty]', row).value, unit: $('[data-material-unit]', row).value.trim() }));
      btn.disabled = true;
      try { const saved = await api('POST', `/api/boms/${b.id}/bom`, { updated_at: b.updated_at, base_qty: $('[name=base_qty]', ed).value, materials }); all = all.map(x => x.id === saved.id ? saved : x); cat = bomTreeCatalog(all); editing = null; toast(`${saved.product} BOM을 저장했습니다.`); draw(); }
      catch (error) { fail(error); if (error.status === 409) { await load(); } } finally { btn.disabled = false; }
    };
  };
  const draw = () => {
    if (!main.isConnected) return;
    const list = products(), n = N(), mats = list.reduce((t, b) => t + b.materials.length, 0), empty = list.filter(b => !b.materials.length).length;
    $$('[data-bs-view]', main).forEach(x => { x.classList.toggle('on', x.dataset.bsView === view); x.setAttribute('aria-pressed', String(x.dataset.bsView === view)); });
    $('#bsSummary', main).textContent = `제품 ${list.length}개 · 자재 줄 ${mats}개${empty ? ` · 구성자재 없는 제품 ${empty}개` : ''}${n ? ` · 생산 ${fmtNum(n)} 기준 필요량 표시` : ''}`;
    $('#bsList', main).innerHTML = view === 'material' ? materialTable(list) : list.length ? productTable(list) : '<div class="empty">조건에 맞는 제품이 없습니다.</div>';
    $$('[data-bs-edit]', main).forEach(x => x.onclick = () => { editing = Number(x.dataset.bsEdit); draw(); $('[data-bs-editor]', main)?.scrollIntoView({ block: 'nearest' }); });
    $$('[data-bs-goto]', main).forEach(x => x.onclick = () => { editing = Number(x.dataset.bsGoto); view = 'product'; collapsed.delete('p' + editing); draw(); $('[data-bs-editor]', main)?.scrollIntoView({ block: 'center' }); });
    $$('[data-bs-toggle]', main).forEach(x => x.onclick = () => { const k = x.dataset.bsToggle, open = x.getAttribute('aria-expanded') !== 'true'; if (open) collapsed.delete(k); else collapsed.add(k); x.setAttribute('aria-expanded', String(open)); x.textContent = open ? '▾' : '▸'; $$(`[data-bs-of="${CSS.escape(k)}"]`, main).forEach(tr => { tr.hidden = !open; }); });
    bindEditor();
  };
  const load = async () => {
    all = await api('GET', '/api/boms'); if (!main.isConnected) return; cat = bomTreeCatalog(all);
    $('#bomMatList', main).innerHTML = all.filter(x => x.item_category !== '제품').map(b => `<option value="${esc(b.product)}">${esc([b.product_code, b.item_category, b.spec].filter(Boolean).join(' · '))}</option>`).join('');
    draw();
  };
  let t = null; form.addEventListener('input', e => { if (e.target.closest('[data-bs-editor]')) return; clearTimeout(t); t = setTimeout(draw, 150); });
  form.addEventListener('change', draw);
  $$('[data-bs-all]', main).forEach(x => x.onclick = () => { const close = x.dataset.bsAll === 'close'; collapsed.clear(); if (close) { products().forEach(b => collapsed.add('p' + b.id)); materialGroups(products()).forEach(g => collapsed.add('m' + partnerKey(g.item))); } draw(); });
  $$('[data-bs-view]', main).forEach(x => x.onclick = () => { view = x.dataset.bsView; try { localStorage.setItem('wpa:bom-sheet-view', view); } catch { /* 편의 기능 */ } draw(); });
  $('#bsXlsx', main).onclick = () => {
    const list = products(), n = N(), need = (b, m) => n ? round(m.qty / b.base_qty * n) : '';
    if (view === 'material') {
      const rows = materialGroups(list).flatMap(g => g.uses.map(u => [codeOf(g.item), g.item, g.cat, u.b.product_code || '', u.b.product, u.m.qty, u.b.base_qty, u.b.unit, u.m.unit, ...(n ? [need(u.b, u.m)] : [])]));
      xlsxDownload(`BOM_자재별_${todayStr()}.xlsx`, { sheet: '자재별', titles: ['BOM 자재별 사용 제품'], columns: [{ label: '자재코드', type: 'text' }, { label: '자재명', type: 'text' }, { label: '자재 분류', type: 'text' }, { label: '품목코드', type: 'text' }, { label: '품목명', type: 'text' }, { label: '소요량', type: 'number' }, { label: '기준 수량', type: 'number' }, { label: '기준 단위', type: 'text' }, { label: '자재 단위', type: 'text' }, ...(n ? [{ label: `필요량(${n})`, type: 'number' }] : [])], rows });
    } else {
      const rows = list.flatMap(b => (b.materials.length ? b.materials : [null]).map(m => [b.product_code || '', b.product, b.item_category, b.base_qty, b.unit, m ? codeOf(m.item) : '', m ? m.item : '(구성자재 없음)', m ? m.item_category : '', m ? m.qty : '', m ? m.unit : '', ...(n ? [m ? need(b, m) : ''] : [])])); // 엑셀은 한 줄에 제품·자재를 함께(필터·피벗용)
      xlsxDownload(`BOM_소요량_${todayStr()}.xlsx`, { sheet: 'BOM', titles: ['BOM 소요량'], columns: [{ label: '품목코드', type: 'text' }, { label: '품목명', type: 'text' }, { label: '분류', type: 'text' }, { label: '기준 수량', type: 'number' }, { label: '단위', type: 'text' }, { label: '자재코드', type: 'text' }, { label: '자재명', type: 'text' }, { label: '자재 분류', type: 'text' }, { label: '소요량', type: 'number' }, { label: '자재 단위', type: 'text' }, ...(n ? [{ label: `필요량(${n})`, type: 'number' }] : [])], rows });
    }
  };
  await load().catch(error => { $('#bsList', main).innerHTML = `<div class="empty red-text">${esc(error.message)}</div>`; });
}
