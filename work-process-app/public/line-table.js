// 15.108 발주·출하·기타입고 입력: 수주 입력과 같은 표(한 줄 = 한 품목). 저장은 예전과 같은 /api/batches/:entity.
// 품목 찾기로 고르면 코드의 품목명·규격·단위가 들어가고(규격은 코드에 있으면 글자로만), 사이즈 묶음이 있는 품목은 사이즈마다 줄을 펼쳐 수량만 넣는다.
// 발주·출하는 코드 없이 품목명을 직접 칠 수도 있다(서버가 임시 제품코드 부여). 공통 사진은 저장한 모든 줄에 붙는다.
const LT_CFG = {
  purchase_order: { title: '발주 등록', partner: 'vendor', type: 'purchase', free: true, price: true },
  shipment: { title: '출하 입력', partner: 'customer', type: 'sales', free: true, price: false },
  other_receipt: { title: '기타입고 등록', partner: 'vendor', type: 'purchase', free: false, price: false },
};
// 저장할 줄(순수 함수, 테스트용). 사이즈 줄은 수량이 비면 빠지고, 일반 줄은 수량·품목명이 있어야 한다.
function lineTableItems(lines, entity) {
  const cfg = LT_CFG[entity], out = [];
  for (const [i, l] of lines.entries()) {
    const no = `${i + 1}번째 줄`, qty = String(l.qty ?? '').trim();
    if (l.sizeLine && !(Number(qty) > 0)) continue;
    if (!l.bom_id && !String(l.item || '').trim()) throw new Error(`${no}: 품목을 고르거나 품목명을 넣으세요.`);
    if (!(Number(qty) > 0)) throw new Error(`${no}(${l.item}): 수량을 넣으세요.`);
    if (!l.bom_id && !String(l.unit || '').trim()) throw new Error(`${no}(${l.item}): 단위를 넣으세요.`);
    if (entity === 'purchase_order' && !l.bom_id && !l.item_category) throw new Error(`${no}(${l.item}): 분류를 고르세요.`);
    const item = { bom_id: l.bom_id || '', item: String(l.item || '').trim(), spec: l.spec || '', qty, unit: l.unit || '', lot: l.lot || '' };
    if (String(l.note || '').trim()) item.note = l.note; // 비우면 공통 비고를 쓴다(줄 값이 공통 값을 덮으므로 빈 값은 보내지 않음)
    if (entity === 'purchase_order') { Object.assign(item, { unit_price: l.price ?? '', item_category: l.bom_id ? '' : l.item_category || '', coa_requested: !!l.coa }); if (l.due_date) item.due_date = l.due_date; }
    if (!cfg.free && !item.bom_id) throw new Error(`${no}: 품목 찾기로 등록 품목을 고르세요.`);
    out.push(item);
  }
  if (!out.length) throw new Error('수량을 넣은 품목이 없습니다.');
  if (out.length > 30) throw new Error(`한 번에 30줄까지 등록할 수 있습니다(지금 ${out.length}줄).`);
  return out;
}
async function installLineTable(legacy, entity) {
  if (legacy.dataset.multiInstalled) return;
  legacy.dataset.multiInstalled = 'true';
  const cfg = LT_CFG[entity];
  let header = '';
  if (entity === 'purchase_order') header = '<label>구매의뢰번호<input name="req_no" readonly placeholder="저장 시 자동 부여 (PR-날짜-순번)"><span class="hint">한 번에 등록한 품목은 같은 번호를 사용합니다.</span></label>' + multiInput('vendor', '거래처') + multiInput('due_date', '납기일', 'date') + multiInput('internal_note', '내부 메모 (구매·물류용, 발주서에 안 나감)', 'text', '', false);
  if (entity === 'shipment') header = multiInput('ship_date', '출고일', 'date', todayStr()) + multiInput('customer', '거래처');
  if (entity === 'other_receipt') header = multiInput('received_date', '입고일', 'date', todayStr()) + multiInput('vendor', '입고처');
  header += multiInput('note', '공통 비고', 'text', '', false) + '<div class="span3 small partner-hint" data-partner-hint></div>';
  const form = document.createElement('form'); form.className = 'card multi-form line-table-form'; form.dataset.lineTable = entity;
  form.innerHTML = `<h3>${esc(cfg.title)}</h3><p class="small muted">「+ 품목 추가」로 품목을 고르면 품목명·규격·단위가 들어갑니다. 줄마다 ${cfg.price ? '수량과 단가를' : '수량을'} 넣고 Enter로 다음 칸으로 넘어갑니다. 저장 후 품목별로 상태와 코멘트를 관리합니다. 최대 30줄입니다.</p>
    <fieldset data-multi-fields><div class="form-grid">${header}</div>
    <div data-lt-lines></div>
    <div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-lt-add>+ 품목 추가</button>${cfg.free ? '<button type="button" class="btn" data-lt-free>+ 직접 입력 줄</button>' : ''}</div>
    <p class="small muted">공통 첨부 사진은 등록하는 모든 품목에 적용됩니다. 품목별 사진은 저장 후 각 항목에서 추가할 수 있습니다.</p>${photoPicker()}</fieldset>
    <p role="status" data-multi-status class="small muted"></p><div class="actions"><button class="btn primary" data-multi-submit>등록</button></div>`;
  legacy.before(form);
  const details = document.createElement('details'); details.className = 'card'; details.innerHTML = '<summary>단일 품목 입력 (기존 상세 양식)</summary>'; legacy.before(details); details.append(legacy);
  if (['purchase_order', 'shipment'].includes(entity)) details.hidden = true;
  const box = $('[data-lt-lines]', form), status = $('[data-multi-status]', form), submit = $('[data-multi-submit]', form);
  const draft = bindPhotoDraft(form);
  let lines = [], boms = [], requestId = crypto.randomUUID(), saved = null, payload = null, remaining = [], busy = false, loading = true, lotPickers = [];
  const fixed = l => !!l.bom_id;
  const amount = l => cfg.price && l.qty !== '' && l.price !== '' && l.price != null ? billTruncC(Number(l.qty) * Number(l.price)) : null;
  const cats = v => categoryOptions(v || '').replace('분류 선택', '분류');
  const draw = () => {
    box.innerHTML = lines.length ? `<div class="table-wrap"><table class="grid bill-grid so-grid lt-grid" data-keep-cols data-no-sort><caption class="sr-only">${esc(cfg.title)} 품목</caption><thead><tr>
      <th scope="col">품목 *</th><th scope="col">규격</th><th scope="col" class="r">수량 *</th><th scope="col">단위</th>${cfg.price ? '<th scope="col" class="r">단가</th><th scope="col" class="r">금액</th><th scope="col">납기</th><th scope="col">분류</th><th scope="col">COA</th>' : ''}<th scope="col">LOT</th><th scope="col">비고</th><th scope="col"><span class="sr-only">삭제</span></th></tr></thead>
      <tbody>${lines.map((l, i) => `<tr data-lt-row="${i}">
        <td data-card-primary>${fixed(l) ? `<button type="button" class="btn small" data-lt-pick="${i}">바꾸기</button> <b>${esc(l.item)}</b>${l.product_code ? ` <span class="small muted">${esc(l.product_code)}</span>` : ''}` : `<input data-l="item" data-i="${i}" maxlength="200" value="${esc(l.item)}" placeholder="품목명 (임시 코드)" aria-label="${i + 1}번째 줄 품목명">`}</td>
        <td>${l.sizeLine || (fixed(l) && l.fixedSpec) ? `<span class="spec-fixed" title="제품등록 규격(고정)">${esc(l.spec)}</span>` : `<input data-l="spec" data-i="${i}" maxlength="100" value="${esc(l.spec)}" aria-label="${i + 1}번째 줄 규격">`}</td>
        <td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-l="qty" data-i="${i}" value="${esc(l.qty)}" aria-label="${esc(l.item || (i + 1) + '번째 줄')} 수량"></td>
        <td>${fixed(l) ? esc(l.unit) : `<input data-l="unit" data-i="${i}" maxlength="20" value="${esc(l.unit)}" class="rc-unit" placeholder="EA" aria-label="${i + 1}번째 줄 단위">`}</td>
        ${cfg.price ? `<td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-l="price" data-i="${i}" value="${esc(l.price ?? '')}" aria-label="${esc(l.item || (i + 1) + '번째 줄')} 단가">${l.tablePrice != null && String(l.tablePrice) !== String(l.price) ? `<div class="small muted">${esc(`단가표 ${fmtNum(l.tablePrice)}`)}</div>` : ''}${entity === 'purchase_order' ? ltHistNote(l, i) : ''}</td><td class="r nowrap" data-lt-amount="${i}">${amount(l) == null ? '' : won(amount(l))}</td>
        <td><input type="date" data-l="due_date" data-i="${i}" value="${esc(l.due_date || '')}" aria-label="${i + 1}번째 줄 납기"></td>
        <td>${fixed(l) ? esc(l.item_category || '') : `<select data-l="item_category" data-i="${i}" aria-label="${i + 1}번째 줄 분류">${cats(l.item_category)}</select>`}</td>
        <td class="c"><input type="checkbox" data-l="coa" data-i="${i}"${l.coa ? ' checked' : ''} aria-label="${i + 1}번째 줄 COA 요청"></td>` : ''}
        <td><input data-l="lot" data-i="${i}" maxlength="100" value="${esc(l.lot || '')}" aria-label="${i + 1}번째 줄 LOT" placeholder="${entity === 'purchase_order' ? '선택' : ''}"></td>
        <td><input data-l="note" data-i="${i}" maxlength="200" value="${esc(l.note || '')}" aria-label="${i + 1}번째 줄 비고"></td>
        <td><button type="button" class="btn small danger lt-del" data-lt-del="${i}" aria-label="${i + 1}번째 줄 삭제" title="줄 삭제">×</button></td></tr>`).join('')}</tbody></table></div>`
      : `<p class="muted small">${loading ? '품목 목록을 불러오는 중…' : '「+ 품목 추가」로 품목을 고르세요.'}</p>`;
    totals();
    // 15.136 출하: LOT 칸에서 그 품목의 재고 LOT을 고르고 남은 수량을 확인
    if (entity === 'shipment') lotPickers = $$('[data-l="lot"]', box).map(inp => { const l = lines[Number(inp.dataset.i)]; return bindLotPicker(inp, () => l.item, () => l.qty); });
  };
  const totals = () => {
    const filled = lines.filter(l => Number(l.qty) > 0);
    $('[data-lt-sum]', form)?.remove();
    if (!lines.length) return;
    box.insertAdjacentHTML('beforeend', `<div data-lt-sum>${sumLine([['품목', esc(`${filled.length}줄`)], ['수량', filled.length ? esc(unitTotals(filled, l => l.qty, l => l.unit)) : ''], cfg.price ? ['발주 금액', esc(`${won(filled.reduce((t, l) => t + (amount(l) || 0), 0))}원`)] : null])}</div>`);
    submit.textContent = `${filled.length || lines.length}품목 등록`;
  };
  const lineFrom = (bom, extra = {}) => ({ bom_id: bom.id, item: bom.product, product_code: bom.product_code || '', unit: bom.unit || '', spec: bom.spec || '', fixedSpec: !!bom.spec && !(bom.sizes || []).length, item_category: bom.item_category || '', qty: '', price: '', due_date: form.elements.due_date?.value || '', lot: '', note: '', coa: false, ...extra });
  const expand = bom => (bom.sizes || []).length ? bom.sizes.map(size => lineFrom(bom, { spec: size, sizeLine: true })) : [lineFrom(bom)];
  // 15.111 발주는 매입 단가표 단가를 미리 채운다(직접 고친 단가는 그대로). 단가표 단가는 칸 아래 작게 보인다.
  const fillPrices = async () => {
    if (!cfg.price) return;
    const prices = await tablePrices('purchase', form.elements[cfg.partner]?.value);
    let changed = false;
    for (const l of lines) { const p = l.bom_id && prices[l.bom_id]; l.tablePrice = p ? p.unit_price : null; if (p && !l.priceTouched && String(l.price ?? '') !== String(p.unit_price)) { l.price = p.unit_price; changed = true; } }
    if (changed || lines.some(l => l.tablePrice != null)) draw();
  };
  const pick = async (index = -1) => {
    if (loading) return toast('품목 목록을 불러오는 중입니다.', 'err');
    // 15.137 새 줄은 체크해 여러 품목을 한 번에(「바꾸기」는 한 품목)
    const title = `${cfg.title.replace(' 등록', '').replace(' 입력', '')} 품목 찾기`;
    const pickedBoms = index >= 0 ? [await openItemPicker(boms, { title })].filter(Boolean) : ((await openItemPicker(boms, { title, multi: true, lots: false }))?.items || []).map(x => x.bom);
    if (!pickedBoms.length) return;
    const made = pickedBoms.flatMap(expand);
    if (lines.length - (index >= 0 ? 1 : 0) + made.length > 30) return toast('한 번에 30줄까지 등록할 수 있습니다.', 'err');
    if (index >= 0) lines.splice(index, 1, ...made); else lines.push(...made);
    draw(); await fillPrices(); await loadHist();
    const at = index >= 0 ? index : lines.length - made.length;
    $$('[data-l="qty"]', box)[at]?.focus();
  };
  $('[data-lt-add]', form).onclick = () => pick().catch(fail);
  $('[data-lt-free]', form)?.addEventListener('click', () => {
    if (lines.length >= 30) return toast('한 번에 30줄까지 등록할 수 있습니다.', 'err');
    lines.push({ bom_id: '', item: '', product_code: '', unit: '', spec: '', item_category: '', qty: '', price: '', due_date: form.elements.due_date?.value || '', lot: '', note: '', coa: false });
    draw(); $$('[data-l="item"]', box).at(-1)?.focus();
  });
  // 15.186 발주: 품목별 최근 발주 내역(일자·거래처·수량·단가). 단가가 비어 있고 단가표도 없으면 같은 거래처 최근 단가(없으면 가장 최근)를 넣는다.
  const loadHist = async (force = false) => {
    if (entity !== 'purchase_order') return;
    const vendor = form.elements[cfg.partner]?.value.trim() || '';
    let changed = false;
    await Promise.all(lines.map(async l => {
      const key = `${l.product_code || ''}|${(l.item || '').trim()}|${vendor}`; if (!l.item?.trim() && !l.product_code) return;
      if (!force && l.histKey === key) return;
      l.histKey = key;
      try { l.hist = await api('GET', '/api/po/history?' + new URLSearchParams({ code: l.product_code || '', item: l.item || '', vendor })); } catch { l.hist = null; return; }
      const p = l.hist.last_vendor || l.hist.last;
      if (p && !l.priceTouched && l.tablePrice == null && (l.price === '' || l.price == null || l.priceFromHist)) { l.price = p.unit_price; l.priceFromHist = true; }
      changed = true;
    }));
    if (changed && form.isConnected) draw();
  };
  box.addEventListener('change', e => { if (e.target.dataset.l === 'item') loadHist().catch(() => {}); });
  box.addEventListener('click', e => {
    const hb = e.target.closest('[data-lt-hist]'); if (hb) { const i = Number(hb.dataset.ltHist); ltHistDialog(lines[i], price => { lines[i].price = price; lines[i].priceTouched = true; lines[i].priceFromHist = false; draw(); $$('[data-l="price"]', box)[i]?.focus(); }); return; }
    const p = e.target.closest('[data-lt-pick]'); if (p) return pick(Number(p.dataset.ltPick)).catch(fail);
    const d = e.target.closest('[data-lt-del]'); if (d) { lines.splice(Number(d.dataset.ltDel), 1); draw(); }
  });
  const sync = e => {
    const k = e.target.dataset.l; if (!k) return; const i = Number(e.target.dataset.i);
    lines[i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'price') lines[i].priceTouched = true;
    if (k === 'qty' || k === 'price') { const a = amount(lines[i]); const cell = $(`[data-lt-amount="${i}"]`, box); if (cell) cell.textContent = a == null ? '' : won(a); }
    if (k === 'price' && entity === 'purchase_order') { lines[i].priceFromHist = false; const td = e.target.closest('td'); td?.querySelectorAll('.lt-hist, .lt-warn').forEach(x => x.remove()); td?.insertAdjacentHTML('beforeend', ltHistNote(lines[i], i)); } // 15.187 단가 바꾸면 경고 다시
    if (['qty', 'price', 'unit'].includes(k)) totals();
  };
  box.addEventListener('input', sync); box.addEventListener('change', sync);
  enterMovesInTable(box);
  // 공통 납기를 바꾸면 아직 납기를 따로 안 고친 줄도 따라간다
  form.elements.due_date?.addEventListener('change', e => { for (const l of lines) if (!l.dueTouched) l.due_date = e.target.value; draw(); });
  box.addEventListener('input', e => { if (e.target.dataset.l === 'due_date') lines[Number(e.target.dataset.i)].dueTouched = true; });
  // 거래처: 발주는 최근 매입 품목을 눌러 줄로 넣는다
  const partner = form.elements[cfg.partner];
  partner.addEventListener('change', () => fillPrices().then(() => loadHist(true)).catch(() => {}));
  bindPartnerPicker(partner, $('[data-partner-hint]', form), { recent: entity === 'purchase_order', type: cfg.type, onPick: item => {
    if (lines.length >= 30) return toast('한 번에 30줄까지 등록할 수 있습니다.', 'err');
    const bom = item.product_code && boms.find(b => b.product_code === item.product_code);
    if (bom) lines.push(...expand(bom)); else lines.push({ bom_id: '', item: item.item, product_code: '', unit: item.unit || '', spec: item.spec || '', item_category: item.item_category || '', qty: '', price: item.unit_price ?? '', due_date: form.elements.due_date?.value || '', lot: '', note: '', coa: false });
    draw(); $$('[data-l="qty"]', box).at(-1)?.focus();
  } }).catch(() => {});
  draw();
  try { boms = await api('GET', '/api/boms?temp=1'); } catch (error) { status.textContent = '품목 목록을 불러오지 못했습니다. 화면을 새로고침하세요. ' + error.message; }
  loading = false; draw();
  if (!form.isConnected || !ME) return;
  const entryDraft = bindEntryDraft(form, `lines:${location.hash || '#/'}:${entity}`, {
    noPhotos: false,
    read: () => ({ fields: uxFormRead(form), lines, requestId }),
    restore: value => { uxFormRestore(form, value.fields); lines = Array.isArray(value.lines) ? value.lines.slice(0, 30) : []; if (typeof value.requestId === 'string') requestId = value.requestId; draw(); },
  });
  box.addEventListener('click', () => queueMicrotask(() => entryDraft.save()));
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || draft.busy || loading) return;
    let items;
    if (!saved) { try { items = lineTableItems(lines, entity); } catch (error) { return toast(error.message, 'err'); } }
    if (!saved && entity === 'purchase_order') { const w = lines.map(l => [l, ltDeviation(l)]).filter(([, d]) => d != null).map(([l, d]) => `${l.item} ${fmtNum(Number(l.price))}원(최근 ${ltBasis(l)} ${fmtNum(ltRef(l).unit_price)}원, ${d > 0 ? '+' : ''}${Math.round(d * 100)}%)`); if (w.length && !await confirmBox(`최근 단가와 10% 넘게 다른 품목이 있습니다: ${w.join(' / ')}. 이 단가로 발주할까요?`)) return; } // 15.187
    if (!saved && entity === 'shipment') { const w = lotPickers.map(p => p?.check()).filter(Boolean); if (w.length && !await confirmBox(`LOT 확인: ${w.join(' / ')}. 그래도 등록할까요?`)) return; LOT_CACHE.clear(); }
    busy = true; submit.disabled = true; form.inert = true; entryDraft.start();
    try {
      if (!saved) {
        const common = formObj(form); if (entity === 'purchase_order') common.req_no = '';
        payload = { common, items, request_id: requestId };
        status.textContent = `${items.length}품목을 저장하고 있습니다…`;
        saved = await api('POST', '/api/batches/' + entity, payload);
        entryDraft.clear('품목 저장 완료 · 사진 업로드 중에는 화면을 유지하세요.');
        remaining = saved.rows.slice(); $('[data-multi-fields]', form).disabled = true;
        $('#main form.list-filters')?.requestSubmit();
      }
      while (remaining.length) {
        const row = remaining[0]; status.textContent = `품목 저장 완료 · 공통 사진 저장 ${saved.rows.length - remaining.length + 1}/${saved.rows.length}`;
        if (draft.photos.length) { try { await api('PUT', `/api/attachments/${entity}/${row.id}`, { photos: draft.photos, revision: 0 }); } catch (error) { if (error.status !== 409) throw error; } }
        remaining.shift();
      }
      toast(`${saved.rows.length}품목을 등록했습니다.${entity === 'purchase_order' && saved.rows[0]?.req_no ? ' 구매의뢰번호 ' + saved.rows[0].req_no : ''}`);
      await render();
      const prefix = { shipment: 'sh', other_receipt: 'other' }[entity], date = payload.common.ship_date || payload.common.received_date;
      if (prefix && date && $('#' + prefix + 'Filters')) { $('#' + prefix + 'From').value = date; $('#' + prefix + 'To').value = date; $('#' + prefix + 'Filters').requestSubmit(); }
    } catch (error) {
      if (!saved) entryDraft.failure(); else entryDraft.clear('품목은 저장되었습니다 · 다시 등록하지 말고 사진만 재시도하세요.');
      status.textContent = saved ? `${saved.rows.length}품목은 이미 저장되었습니다(아래 목록에 표시). 다시 등록하지 말고 「등록」을 눌러 사진만 다시 올리세요.` : error.message;
      fail(error);
    } finally { busy = false; form.inert = false; submit.disabled = false; if (saved && remaining.length) submit.textContent = '사진 저장 재시도'; }
  };
}

// 15.186·15.187 발주 단가 칸 아래 작은 글: 최근 확정 매입 단가(같은 거래처 우선, 매입전표가 없으면 발주서 단가)와 「이력 n건」,
// 넣은 단가가 그 단가와 10% 넘게 다르면 경고(빨강, 저장 때 한 번 더 확인). 첫 매입·첫 발주면 그렇게.
const LT_WARN = 0.1;
const ltRef = l => l.hist ? (l.hist.last_vendor || l.hist.last) : null;
const ltBasis = l => l.hist?.basis === 'po' ? '발주' : '매입';
function ltDeviation(l) { const r = ltRef(l), p = Number(l.price); if (!r || !r.unit_price || l.price === '' || l.price == null || !Number.isFinite(p)) return null; const d = (p - r.unit_price) / r.unit_price; return Math.abs(d) > LT_WARN ? d : null; }
function ltHistNote(l, i) {
  if (!l.hist) return '';
  if (!l.hist.rows.length) return '<div class="small muted">첫 매입</div>';
  const p = ltRef(l), d = ltDeviation(l);
  return `<div class="small lt-hist"><button type="button" class="link-btn" data-lt-hist="${i}" title="최근 ${ltBasis(l)} 내역 보기">${p ? `최근 ${ltBasis(l)} ${fmtNum(p.unit_price)}${l.hist.last_vendor ? '' : ' (타 거래처)'}` : '단가 기록 없음'} · 이력 ${l.hist.rows.length}</button>${l.priceFromHist ? ' <span class="muted">(적용)</span>' : ''}</div>${d != null ? `<div class="small lt-warn" role="alert">⚠ 최근 ${ltBasis(l)} 단가보다 ${d > 0 ? '+' : ''}${Math.round(d * 100)}%</div>` : ''}`;
}
function ltHistDialog(l, onUse) {
  const h = l.hist; if (!h) return;
  const b = ltBasis(l);
  const m = modal(`<h3>최근 ${b} 내역 · ${esc(l.item)}${l.product_code ? ` <span class="small muted">${esc(l.product_code)}</span>` : ''}</h3>
    <p class="small">${h.basis === 'po' ? '<span class="chip yellow">매입전표 없음</span> 확정된 매입전표가 없어 발주서 단가를 보여 줍니다. ' : '<span class="chip green">확정 매입</span> 입고 뒤 매입전표로 확정된 단가입니다. '}${h.last_vendor ? `같은 거래처 최근 <b>${won(h.last_vendor.unit_price)}원</b> (${esc(h.last_vendor.doc_date)} · ${esc(h.last_vendor.vendor)})` : '이 거래처 기록은 없습니다.'}${h.last ? ` · 가장 최근 <b>${won(h.last.unit_price)}원</b> (${esc(h.last.doc_date)} · ${esc(h.last.vendor)})` : ''}</p>
    <div class="table-wrap"><table class="grid keep-table" data-no-reorder data-keep-cols data-no-filter data-no-sort><thead><tr><th>${h.basis === 'po' ? '발주일' : '전표 일자'}</th><th>${h.basis === 'po' ? '구매의뢰번호' : '전표번호'}</th><th>거래처</th><th>규격</th><th class="r">수량</th><th class="r">단가</th></tr></thead>
    <tbody>${h.rows.map(r => `<tr><td>${esc(r.doc_date)}</td><td>${esc(r.doc_no)}</td><td>${esc(r.vendor)}</td><td>${esc(r.spec || '')}</td><td class="r">${fmtNum(r.qty)} ${esc(r.unit || '')}</td><td class="r">${r.unit_price != null ? `<button type="button" class="btn small" data-use-price="${r.unit_price}" title="이 단가로 발주">${won(r.unit_price)}</button>` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">단가를 누르면 이 줄의 단가로 넣습니다. 최근 10건까지 보입니다.</p>`, { wide: true });
  m.el.addEventListener('click', e => { const bt = e.target.closest('[data-use-price]'); if (!bt) return; onUse(Number(bt.dataset.usePrice)); m.close(); toast(`단가 ${won(Number(bt.dataset.usePrice))}원을 넣었습니다.`); });
}
