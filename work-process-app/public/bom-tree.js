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
function renderBomTree(host, boms, all, reload) {
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
