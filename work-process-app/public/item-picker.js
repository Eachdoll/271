// 품목 찾기(15.70): 브라우저 기본 목록(datalist) 대신 쓰는 조회 창.
// 분류 탭 · 세부 분류 칩 · 검색(여러 단어, 띄어쓰기 무시) · 표(코드·품목명·단위·분류·사이즈). 줄을 누르거나 ↑↓·Enter로 고른다.
// openItemPicker(catalog, { query, title, filter }) → 고른 품목(boms 한 줄) 또는 null(취소)
const ITEM_PICKER_LIMIT = 200;
let itemPickerClass = '';
function itemPickerKey(text) { return String(text || '').toLocaleLowerCase().replace(/\s+/g, ''); }
function itemPickerPath(b) { return [b.cat1, b.cat2, b.cat3].filter(Boolean).join(' › '); }
// 현재고(15.70): 재고 현황과 같은 계산(기초재고·입고·생산 − 투입·출하 ± 조정)을 오늘 기준으로 한 번 읽어 1분간 쓴다.
// 품목명(띄어쓰기·대소문자 무시)으로 맞추고, 단위가 여럿이면 품목 단위를 앞에 두고 모두 보여 준다.
let itemStockCache = null;
function itemStockLoad() {
  if (itemStockCache && Date.now() - itemStockCache.at < 60000) return itemStockCache.promise;
  const promise = api('GET', `/api/inventory?asof=${todayStr()}`).then(r => {
    const map = new Map();
    for (const row of r.rows || []) { const key = itemPickerKey(row.item), list = map.get(key) || []; list.push({ unit: row.unit, stock: row.stock }); map.set(key, list); }
    return map;
  }).catch(() => false);
  itemStockCache = { at: Date.now(), promise };
  return promise;
}
function itemStockText(bom, map) {
  if (map === undefined) return '…';
  if (!map) return '<span class="muted">—</span>';
  const rows = (map.get(itemPickerKey(bom.product)) || []).slice().sort((a, b) => (b.unit === bom.unit) - (a.unit === bom.unit));
  if (!rows.length) return `<span class="muted">0${bom.unit ? ' ' + esc(bom.unit) : ''}</span>`;
  return rows.map(r => `<span class="${r.stock < 0 ? 'red-text' : r.stock === 0 ? 'muted' : ''}">${fmtNum(r.stock)}${r.unit ? ' ' + esc(r.unit) : ''}</span>`).join('<span class="muted"> · </span>');
}
// multi(15.79): 여러 품목을 체크하고 품목마다 LOT 수(행추가)를 정해 한 번에 고른다 → { items: [{ bom, count }], autoLot } 또는 null
function openItemPicker(catalog, { query = '', title = '품목 찾기', filter = null, multi = false, lots = true, emptyText = '찾는 품목이 없습니다. 창을 닫고 품목명을 직접 입력하세요.' } = {}) {
  const all = (filter ? catalog.filter(filter) : catalog).slice();
  const classes = ITEM_CATEGORIES.filter(c => all.some(b => b.item_category === c));
  if (all.some(b => !ITEM_CATEGORIES.includes(b.item_category))) classes.push('미분류');
  const classOf = b => ITEM_CATEGORIES.includes(b.item_category) ? b.item_category : '미분류';
  let cls = classes.includes(itemPickerClass) ? itemPickerClass : '', cat1 = '', cat2 = '', active = 0, shown = [], stock;
  const picked = new Map(); // multi: 품목 id → LOT 수(고른 순서대로)
  return new Promise(resolve => {
    let done = false;
    const finish = value => { if (done) return; done = true; resolve(value); m.close(); };
    const m = modal(`<h3>${esc(title)}</h3>
      <div class="ip-head"><label class="ip-search">검색 <span class="hint">(품목명·코드·분류, 여러 단어 가능)</span><input type="search" data-ip-q value="${esc(query)}" placeholder="예: 장갑 L, R-001" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="ipTable" aria-autocomplete="list"></label></div>
      <div class="seg class-tabs ip-tabs" role="group" aria-label="분류" data-ip-classes></div>
      <div class="ip-chips" role="group" aria-label="세부 분류" data-ip-cat1></div>
      <div class="ip-chips" role="group" aria-label="2차 세부 분류" data-ip-cat2></div>
      <p class="small muted" data-ip-count aria-live="polite"></p>
      <div class="table-wrap ip-wrap"><table class="grid ip-table" id="ipTable"><caption class="sr-only">품목 목록</caption><thead><tr>${multi ? '<th scope="col"><span class="sr-only">선택</span></th>' : ''}<th scope="col">코드</th><th scope="col">품목명</th><th scope="col">단위</th><th scope="col" class="r">현재고</th><th scope="col">분류</th><th scope="col">사이즈</th>${multi && lots ? '<th scope="col">LOT 수</th>' : ''}</tr></thead><tbody data-ip-rows></tbody></table></div>
      ${multi ? `<p class="small muted">줄을 누르거나 체크해 여러 품목을 고르고${lots ? ', 품목마다 LOT 수(그 품목 줄을 몇 줄 만들지)를 정하세요' : ''}. 검색·분류를 바꿔도 고른 품목은 유지됩니다.</p>` : ''}
      <div class="actions">${multi ? `${lots ? '<label class="inline ip-auto"><input type="checkbox" data-ip-auto checked> LOT 자동 번호</label>' : '<span class="ip-auto"></span>'}<span class="small" data-ip-sum aria-live="polite"></span>` : ''}<button type="button" class="btn" data-ip-cancel>취소</button>${multi ? '<button type="button" class="btn primary" data-ip-ok disabled>확인</button>' : ''}</div>`, { wide: true, onClose: () => { if (!done) { done = true; resolve(null); } } });
    const el = m.el, q = $('[data-ip-q]', el);
    el.classList.add('ip-modal'); // 15.122 창은 고정 높이, 품목 표만 스크롤
    const words = () => q.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).map(itemPickerKey);
    const matchText = b => itemPickerKey([b.product, b.product_code, b.item_category, b.cat1, b.cat2, b.cat3, b.unit].join(' '));
    const chip = (attr, value, label, n, on) => `<button type="button" class="${attr === 'data-ip-class' ? '' : 'sub-chip'}${on ? ' on' : ''}" ${attr}="${esc(value)}" aria-pressed="${on}">${esc(label)} <span class="sub-count">${fmtNum(n)}</span></button>`;
    const draw = () => {
      const ws = words(), byWord = all.filter(b => { const t = matchText(b); return ws.every(w => t.includes(w)); });
      $('[data-ip-classes]', el).innerHTML = chip('data-ip-class', '', '전체', byWord.length, !cls) + classes.map(c => chip('data-ip-class', c, c, byWord.filter(b => classOf(b) === c).length, cls === c)).join('');
      const inClass = byWord.filter(b => !cls || classOf(b) === cls);
      const c1 = cls ? [...new Set(inClass.map(b => b.cat1 || ''))].sort((a, b) => a.localeCompare(b, 'ko')) : [];
      $('[data-ip-cat1]', el).innerHTML = c1.length > 1 || (c1.length === 1 && c1[0]) ? chip('data-ip-c1', '', '전체', inClass.length, !cat1) + c1.map(v => chip('data-ip-c1', v || '__none__', v || '세부 분류 없음', inClass.filter(b => (b.cat1 || '') === v).length, cat1 === (v || '__none__'))).join('') : '';
      const inCat1 = inClass.filter(b => !cat1 || (b.cat1 || '') === (cat1 === '__none__' ? '' : cat1));
      const c2 = cat1 && cat1 !== '__none__' ? [...new Set(inCat1.map(b => b.cat2 || ''))].sort((a, b) => a.localeCompare(b, 'ko')) : [];
      $('[data-ip-cat2]', el).innerHTML = c2.length > 1 || (c2.length === 1 && c2[0]) ? chip('data-ip-c2', '', '전체', inCat1.length, !cat2) + c2.map(v => chip('data-ip-c2', v || '__none__', v || '세부 분류 없음', inCat1.filter(b => (b.cat2 || '') === v).length, cat2 === (v || '__none__'))).join('') : '';
      const list = inCat1.filter(b => !cat2 || (b.cat2 || '') === (cat2 === '__none__' ? '' : cat2));
      // 이름이 검색어로 시작하는 품목·코드가 같은 품목을 앞에
      const first = ws[0] || '', rank = b => itemPickerKey(b.product_code) === first ? 0 : itemPickerKey(b.product).startsWith(first) ? 1 : 2;
      shown = list.slice().sort((a, b) => rank(a) - rank(b) || a.product.localeCompare(b.product, 'ko')).slice(0, ITEM_PICKER_LIMIT);
      active = Math.min(active, Math.max(0, shown.length - 1));
      $('[data-ip-count]', el).textContent = list.length > ITEM_PICKER_LIMIT ? `${fmtNum(list.length)}건 중 ${ITEM_PICKER_LIMIT}건 표시 · 검색어를 더 넣으세요` : `${fmtNum(list.length)}건`;
      $('[data-ip-rows]', el).innerHTML = shown.length ? shown.map((b, i) => `<tr data-ip-row="${i}" id="ipRow${i}" class="${i === active ? 'ip-active' : ''}${picked.has(b.id) ? ' ip-picked' : ''}" aria-selected="${i === active}">
        ${multi ? `<td><input type="checkbox" data-ip-check="${i}"${picked.has(b.id) ? ' checked' : ''} aria-label="${esc(b.product)} 선택"></td>` : ''}<td class="nowrap"><code>${esc(b.product_code || '—')}</code>${b.is_temp ? ' <span class="chip yellow">임시</span>' : ''}</td>
        <td data-card-primary><button type="button" class="ip-pick" data-ip-pick="${i}">${esc(b.product)}</button></td>
        <td>${esc(b.unit || '—')}</td><td class="r nowrap">${itemStockText(b, stock)}</td><td class="small">${esc(classOf(b))}${itemPickerPath(b) ? ` › ${esc(itemPickerPath(b))}` : ''}</td>
        <td class="small">${b.sizes && b.sizes.length ? esc(b.sizes.join(', ')) : '<span class="muted">—</span>'}</td>${multi && lots ? `<td><input type="number" min="1" max="50" step="1" inputmode="numeric" data-ip-n="${i}" value="${picked.get(b.id) || 1}" aria-label="${esc(b.product)} LOT 수"></td>` : ''}</tr>`).join('')
        : `<tr><td colspan="${multi ? (lots ? 8 : 7) : 6}" class="muted">${esc(emptyText)}</td></tr>`;
      if (shown.length) q.setAttribute('aria-activedescendant', 'ipRow' + active); else q.removeAttribute('aria-activedescendant');
      // 공통 표 처리가 처음 그릴 때 빈 열(사이즈 등)의 머리칸을 숨기는데, 줄은 다시 그려지므로 머리칸을 늘 보이게 해 칸이 밀리지 않게 한다(15.79).
      $$('#ipTable .col-empty', el).forEach(c => c.classList.remove('col-empty'));
      sum();
    };
    // multi: 고른 품목·줄 수 표시와 확인 버튼
    const sum = () => {
      if (!multi) return;
      const lines = [...picked.values()].reduce((t, n) => t + n, 0);
      $('[data-ip-sum]', el).textContent = picked.size ? `${picked.size}개 품목 · ${lines}줄` : '';
      const ok = $('[data-ip-ok]', el); ok.disabled = !picked.size; ok.textContent = picked.size ? `확인 (${lines}줄 추가)` : '확인';
    };
    const toggle = (i, on) => {
      const b = shown[i]; if (!b) return;
      const want = on === undefined ? !picked.has(b.id) : on;
      if (want) picked.set(b.id, Math.max(1, Math.min(50, Math.floor(Number($(`[data-ip-n="${i}"]`, el)?.value) || 1)))); else picked.delete(b.id);
      const tr = $(`[data-ip-row="${i}"]`, el); tr?.classList.toggle('ip-picked', want); const box = $(`[data-ip-check="${i}"]`, el); if (box) box.checked = want;
      sum();
    };
    const finishMulti = () => { if (!picked.size) return; finish({ items: [...picked].map(([id, count]) => ({ bom: all.find(b => b.id === id), count })), autoLot: !!$('[data-ip-auto]', el)?.checked }); };
    const move = d => { if (!shown.length) return; active = (active + d + shown.length) % shown.length; $$('[data-ip-row]', el).forEach((tr, i) => { tr.classList.toggle('ip-active', i === active); tr.setAttribute('aria-selected', String(i === active)); }); q.setAttribute('aria-activedescendant', 'ipRow' + active); $('#ipRow' + active, el)?.scrollIntoView({ block: 'nearest' }); };
    q.addEventListener('input', () => { active = 0; draw(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (multi) { if (e.ctrlKey || e.metaKey) finishMulti(); else toggle(active); } else if (shown[active]) finish(shown[active]); }
    });
    if (multi) {
      el.addEventListener('change', e => {
        if (e.target.dataset.ipCheck !== undefined) toggle(Number(e.target.dataset.ipCheck), e.target.checked);
        else if (e.target.dataset.ipN !== undefined) { const i = Number(e.target.dataset.ipN), n = Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))); e.target.value = n; if (shown[i]) { picked.set(shown[i].id, n); toggle(i, true); } }
      });
      $('[data-ip-ok]', el).onclick = finishMulti;
    }
    el.addEventListener('click', e => {
      if (multi && e.target.closest('input')) return; // 체크·LOT 수 칸은 change에서 처리
      const b = e.target.closest('button'); if (!b) { const tr = e.target.closest('[data-ip-row]'); if (tr) { if (multi) toggle(Number(tr.dataset.ipRow)); else finish(shown[Number(tr.dataset.ipRow)]); } return; }
      if (b.dataset.ipPick !== undefined) return multi ? toggle(Number(b.dataset.ipPick)) : finish(shown[Number(b.dataset.ipPick)]);
      if (b.dataset.ipClass !== undefined) { cls = b.dataset.ipClass; itemPickerClass = cls; cat1 = cat2 = ''; active = 0; draw(); q.focus(); }
      else if (b.dataset.ipC1 !== undefined) { cat1 = b.dataset.ipC1; cat2 = ''; active = 0; draw(); q.focus(); }
      else if (b.dataset.ipC2 !== undefined) { cat2 = b.dataset.ipC2; active = 0; draw(); q.focus(); }
      else if (b.matches('[data-ip-cancel]')) m.close();
    });
    draw(); q.focus(); q.select();
    itemStockLoad().then(map => { stock = map; if (!done) draw(); });
  });
}

// 등록 품목 고정(15.70): 목록에서 고른 품목은 품목명·코드·단위를 등록 정보로 고정하고,
// 규격은 등록된 사이즈 중에서만 고른다(등록 사이즈가 없는 품목은 직접 입력). 「직접 입력으로」를 누르면 풀린다.
// row: 줄 요소, k(key): 그 줄의 [data-k=key] 요소, bom: 고른 품목 또는 null
// 고정된 칸 표시(15.70): 칸을 회색·점선으로 바꾸고 라벨에 「🔒 고정」을 붙인다(칸이 읽기 전용이면).
function itemLockMark(input, on = input && input.readOnly) {
  if (!input || input.type === 'hidden') return;
  const label = input.closest('label'); if (!label) return;
  label.classList.toggle('is-locked', !!on);
  let tag = $(':scope > .lock-tag', label);
  if (on && !tag) { tag = document.createElement('span'); tag.className = 'lock-tag'; tag.textContent = '고정'; tag.title = '등록된 품목 정보라 고칠 수 없습니다'; input.before(tag); }
  else if (!on && tag) tag.remove();
}
function itemLockApply(row, k, bom, { keepSpec = true } = {}) {
  const spec = k('spec'), oldSpec = spec ? spec.value : '';
  row.classList.toggle('item-locked', !!bom);
  k('bom_id').value = bom ? bom.id : '';
  const item = k('item'); item.readOnly = !!bom; if (bom) item.value = bom.product;
  const code = k('product_code'); if (code) { code.readOnly = !!bom; if (bom) code.value = bom.product_code || ''; }
  const unit = k('unit'); if (unit) { unit.readOnly = !!(bom && bom.unit); if (bom && bom.unit) unit.value = bom.unit; }
  [item, code, unit].forEach(input => itemLockMark(input));
  if (spec) {
    // 등록 사이즈가 있으면 선택칸, 없으면 입력칸.
    const sizes = bom && Array.isArray(bom.sizes) ? bom.sizes : [];
    const label = spec.closest('label'), base = { k: 'spec', max: spec.maxLength > 0 ? spec.maxLength : 200, ph: spec.dataset.ph ?? spec.getAttribute('placeholder') ?? '' };
    let next;
    if (bom && sizes.length) {
      next = document.createElement('select');
      const legacy = keepSpec && oldSpec && !sizes.includes(oldSpec); // 사이즈 등록 전에 적은 값 등(15.75): 그대로 둘 수 있게
      next.innerHTML = `<option value="">사이즈 선택</option>${legacy ? `<option value="${esc(oldSpec)}" selected>${esc(oldSpec)} (이전 값)</option>` : ''}${sizes.map(s => `<option${keepSpec && s === oldSpec ? ' selected' : ''}>${esc(s)}</option>`).join('')}`;
    } else {
      next = document.createElement('input'); next.maxLength = base.max;
      // 15.121 등록 품목은 제품등록 규격으로 고정(고칠 수 없음). 직접 입력 품목만 자유 입력.
      if (bom && bom.spec) { next.value = keepSpec && oldSpec ? oldSpec : bom.spec; next.readOnly = true; next.title = '제품등록 규격(고정) · 바꾸려면 제품등록에서'; }
      else { next.value = oldSpec; next.placeholder = bom ? '등록 규격 없음 · 필요하면 입력' : base.ph; }
    }
    next.dataset.k = 'spec'; next.dataset.ph = base.ph;
    for (const attr of ['aria-label', 'id']) if (spec.hasAttribute(attr)) next.setAttribute(attr, spec.getAttribute(attr));
    spec.replaceWith(next);
    itemLockMark(next);

  }
  const badge = $('[data-item-lock]', row), lockId = bom ? String(bom.id) : '';
  row.dataset.lockId = lockId;
  if (badge) badge.innerHTML = bom ? `<span class="chip green">등록 품목</span> <code>${esc(bom.product_code || '')}</code> <span class="small">현재고 <b data-item-stock>…</b></span> <span class="small muted">${bom.sizes && bom.sizes.length ? '품목명·코드·단위·규격(등록 사이즈)은 등록 정보로 고정됩니다.' : '품목명·코드·단위는 등록 정보로 고정됩니다.'}</span> <button type="button" class="btn small" data-item-unlock>직접 입력으로</button>` : '';
  if (bom && badge) itemStockLoad().then(map => { const cell = $('[data-item-stock]', badge); if (cell && row.dataset.lockId === lockId) cell.innerHTML = itemStockText(bom, map); });
}

// 품목 줄에 찾기 동작을 붙인다: 「품목 찾기」 버튼, 품목명 칸에서 Enter·↓, 등록 품목명과 똑같이 입력하면 자동 연결, 「직접 입력으로」.
function bindItemPick(row, k, catalog, onPick) {
  const item = k('item');
  const open = async () => {
    const bom = await openItemPicker(catalog, { query: item.readOnly ? '' : item.value.trim() });
    if (bom) await onPick(bom); else item.focus();
  };
  $('[data-item-find]', row).onclick = () => open();
  item.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); if (!item.readOnly) open(); }
    else if (e.key === 'ArrowDown' && !e.altKey && !item.readOnly) { e.preventDefault(); open(); }
  });
  item.addEventListener('change', () => {
    if (item.readOnly) return;
    const key = itemPickerKey(item.value), hits = key ? catalog.filter(b => itemPickerKey(b.product) === key) : [];
    if (hits.length === 1) onPick(hits[0]);
  });
  row.addEventListener('click', e => { if (e.target.closest('[data-item-unlock]')) { onPick(null); item.focus(); } });
}
