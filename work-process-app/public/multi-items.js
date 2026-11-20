// Shared multi-item input; each line remains independently trackable after saving.
function lineEntity(row) {
  return row.type ? 'request' : row.req_no !== undefined ? 'purchase_order' : row.ship_date ? 'shipment' : row.received_date ? 'other_receipt' : row.in_date ? 'laundry' : row.product !== undefined && row.period ? 'schedule' : '';
}
function lineInfo(row) {
  const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : row.data || {};
  const snapshot = typeof row.bom_snapshot === 'string' ? JSON.parse(row.bom_snapshot || '{}') : row.bom_snapshot || {};
  const unit = row.unit || data.unit || snapshot.unit || '';
  const code = row.product_code ? (/^TMP-/.test(row.product_code) ? '임시코드 ' : '') + row.product_code : '';
  const parts = [code, row.spec || data.spec, unit, (row.lot ? row.lot + (row.sub_lot && /^[A-Z]\d{6}_\d+$/.test(row.lot) ? '-' + row.sub_lot : '') : '') || data.lot_etc || (row.type === 'voc' ? data.lot : '')].filter(Boolean);
  if (row.type && row.type !== 'voc' && (row.qty ?? data.qty) != null) parts.push('수량 ' + fmtNum(row.qty ?? data.qty));
  // 15.42: 내부 묶음 번호는 화면 글자에서 빼고 마우스를 올렸을 때(title)만 보인다.
  const batchTitle = row.batch_id ? ` title="묶음 ${esc(row.batch_id.slice(-8))}"` : '';
  const fromCatalog = (row.product_code && !/^TMP-/.test(row.product_code)) || row.bom_id || (data.product_code && !/^TMP-/.test(data.product_code));
  const entity = fromCatalog ? '' : lineEntity(row);
  return `<span class="small muted line-info"${batchTitle}>${parts.map(esc).join(' · ')} ${entity ? `<button type="button" class="btn small" data-line-meta="${esc(entity)}" data-line-id="${row.id}" data-line-spec="${esc(row.spec)}" data-line-unit="${esc(unit)}" data-line-lot="${esc(row.lot || data.lot_etc || (row.type === 'voc' ? data.lot : ''))}" data-line-name="${esc(row.item)}">규격·단위</button>` : ''}</span>`;
}
function scheduleFocusDate() { try { const date = sessionStorage.getItem('newScheduleDate'); sessionStorage.removeItem('newScheduleDate'); return date || todayStr(); } catch { return todayStr(); } }
function rememberScheduleDate(date) { try { sessionStorage.setItem('newScheduleDate',date); const key = uxKey('calendar', location.hash || '#/'); uxWrite(key, { ...(uxRead(key) || { view: 'week' }), base: date }); } catch {} }
function multiInput(name, label, type = 'text', value = '', required = true) {
  return `<label>${label}${required ? ' *' : ''}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}></label>`;
}
// Items whose category has a size set (e.g. 방진복 XS~XL) take one quantity per size instead of spec + quantity.
function sizeGrid(row, sizes) {
  $('[data-size-grid]', row)?.remove();
  const qty = $('[data-line-key=qty]', row), spec = $('[data-line-key=spec]', row);
  const on = sizes.length > 0;
  for (const input of [qty, spec].filter(Boolean)) { input.closest('label').hidden = on; input.disabled = on; }
  if (qty) qty.required = !on;
  if (!on) return;
  const grid = document.createElement('div'); grid.className = 'span3 size-grid'; grid.dataset.sizeGrid = '';
  grid.innerHTML = `<b>사이즈별 수량</b> <span class="hint">(입력한 사이즈만 줄로 등록)</span><div class="size-cells">${sizes.map(size => `<label>${esc(size)}<input type="number" min="0" step="any" inputmode="decimal" data-line-key="size:${esc(size)}"></label>`).join('')}</div><span class="small muted" data-size-total></span>`;
  qty.closest('label').after(grid);
  const total = () => { const sum = $$('[data-line-key^="size:"]', grid).reduce((n, input) => n + (Number(input.value) || 0), 0); $('[data-size-total]', grid).textContent = sum ? `합계 ${fmtNum(sum)}` : ''; };
  grid.addEventListener('input', total);
}
// Orders, shipments and other receipts: a picked product code already fixes spec, unit and category,
// so those inputs are hidden and the code's values are shown instead. Direct entry keeps the inputs.
function fromCatalog(row, entity, bom) {
  if (!['purchase_order', 'shipment', 'other_receipt', 'schedule'].includes(entity)) return;
  $('[data-catalog-summary]', row)?.remove();
  const fields = ['spec', 'unit', 'item_category'].map(key => $(`[data-line-key=${key}]`, row)).filter(Boolean);
  for (const input of fields) input.closest('label').hidden = !!bom && !(input.dataset.lineKey === 'spec' && !bom.spec); // 15.121 등록 규격이 있으면 숨김(고정)
  if (!bom) return;
  const spec = $('[data-line-key=spec]', row); if (spec && bom.spec && !(bom.sizes || []).length) spec.value = bom.spec; // 15.121 등록 규격 고정(없으면 직접 입력)
  const box = document.createElement('p'); box.className = 'span3 catalog-summary'; box.dataset.catalogSummary = '';
  box.innerHTML = [['규격(고정)', bom.spec], ['단위', bom.unit], ['분류', bom.item_category || '미분류'], ['제품코드', bom.product_code]].filter(([, v]) => v).map(([label, value]) => `<span class="muted">${esc(label)}</span> <b>${esc(value)}</b>`).join('<span class="muted"> · </span>');
  $('[data-line-key=bom_id]', row).closest('label').after(box);
  // 15.70 현재고(재고 현황과 같은 계산)
  box.insertAdjacentHTML('beforeend', '<span class="muted"> · </span><span class="muted">현재고</span> <b data-item-stock>…</b>');
  itemStockLoad().then(map => { const cell = $('[data-item-stock]', box); if (cell) cell.innerHTML = itemStockText(bom, map); });
}
function multiPayload(form, entity, type, kind, requestId) {
  const common = entity === 'request' ? collectRequest(type,form) : formObj(form);
  if (entity === 'purchase_order') common.req_no = ''; // Ignore a number restored from an older draft; the server allocates it on save.
  if (entity === 'schedule') common.kind = kind;
  const items = $$('[data-multi-row]',form).flatMap(row => {
    const item = Object.fromEntries($$('[data-line-key]',row).filter(input => !input.dataset.lineKey.startsWith('size:')).map(input => [input.dataset.lineKey,input.type === 'checkbox' ? input.checked : input.value]));
    const sizes = $$('[data-line-key^="size:"]',row);
    if (!sizes.length) return [item];
    // One line per size with a quantity; the size becomes the line's spec.
    const lines = sizes.filter(input => Number(input.value) > 0).map(input => ({ ...item, spec: input.dataset.lineKey.slice(5), qty: input.value }));
    if (!lines.length) throw new Error(`${item.item || '사이즈 품목'}: 사이즈별 수량을 하나 이상 입력하세요.`);
    return lines;
  });
  if (items.length > 30) throw new Error(`사이즈별로 나누면 ${items.length}줄입니다. 한 번에 30줄까지 등록할 수 있습니다.`);
  return { common, items, request_id: requestId };
}
async function installMultiItems(legacy, entity, type = '') {
  if (legacy.dataset.multiInstalled) return;
  legacy.dataset.multiInstalled = 'true';
  const kind = location.hash.includes('/semi') ? 'semi' : 'finished';
  const titles = { purchase_order: '발주', shipment: '출하', laundry: '세탁', other_receipt: '기타입고', schedule: '생산계획', request: (REQ[type]?.label || '') + ' 접수' };
  let header = '';
  if (entity === 'purchase_order') header = '<label>구매의뢰번호<input name="req_no" readonly placeholder="저장 시 자동 부여 (PR-날짜-순번)"><span class="hint">한 번에 등록한 품목은 같은 번호를 사용합니다.</span></label>' + multiInput('vendor','거래처') + multiInput('due_date','납기일','date') + multiInput('internal_note','내부 메모 (구매·물류용, 발주서에 안 나감)','text','',false);
  if (entity === 'shipment') header = multiInput('ship_date','출고일','date',todayStr()) + multiInput('customer','거래처');
  if (entity === 'other_receipt') header = multiInput('received_date','입고일','date',todayStr()) + multiInput('vendor','입고처');
  if (entity === 'laundry') header = multiInput('in_date','세탁 입고일','date',todayStr());
  if (entity === 'schedule' && kind === 'semi') header = '<p class="span3 small muted">반제품 계획의 실적은 <b>커팅/융착 기록에서 자동 집계</b>됩니다. 품목명을 커팅/융착에서 기록하는 <b>품목(모델) 이름</b>(예: CF-707(9))과 같게 쓰거나 BOM에서 고르세요. 모델이 없는 종류는 <b>부직포와이퍼 · 천와이퍼 · 심리스 스무드 · 심리스 타키</b>로 쓰고, 사이즈·규격은 기록과 같게(예: M, 9인치) 씁니다. 사이즈를 비우면 그 품목 전체가 합산됩니다.</p>';
  if (entity === 'schedule') header += `<label>일정 기준<select name="period"><option value="day">일간</option><option value="week">주간 (월요일 시작)</option><option value="month">월간 (1일 시작)</option></select></label>${multiInput('start_date','계획일','date',todayStr())}`;
  if (entity === 'schedule' && kind === 'semi') header += '<datalist id="semiPlanItems"><option value="부직포와이퍼"><option value="천와이퍼"><option value="심리스 스무드"><option value="심리스 타키"></datalist>';
  if (entity === 'request') header = REQ[type].fields.filter(f => !['title','qty','lot','unit','req_qty','sample_qty','target_price'].includes(f.k)).map(f => fieldInput(f)).join('');
  else header += multiInput('note','공통 비고','text','',false);
  if (['purchase_order','shipment','other_receipt'].includes(entity)) header += '<div class="span3 small partner-hint" data-partner-hint></div>';
  const withPhotos = ['purchase_order','shipment','other_receipt','laundry'].includes(entity) || (entity === 'request' && ['voc','sample','sample_goods','development'].includes(type));
  const form = document.createElement('form'); form.className = 'card multi-form';
  form.innerHTML = `<h3>${titles[entity]} · 여러 품목 한 번에 등록</h3><p class="small muted">공통 정보는 한 번 입력하고 품목 추가로 규격·사이즈별 수량을 입력하세요. 저장 후 품목별로 상태와 코멘트를 관리합니다. 최대 30품목입니다.</p><fieldset data-multi-fields><div class="form-grid">${header}</div><div data-multi-rows></div><button type="button" class="btn" data-add-item>＋ 품목 추가</button>${withPhotos ? `<p class="small muted">공통 첨부 사진은 등록하는 모든 품목에 적용됩니다. 품목별 사진은 저장 후 각 항목에서 추가할 수 있습니다.</p>${photoPicker()}` : ''}</fieldset><p role="status" data-multi-status class="small muted"></p><div class="actions"><button class="btn primary" data-multi-submit>1품목 함께 등록</button></div>`;
  const host = legacy.id ? legacy : legacy.closest('#reqNewBox');
  if (!host) return;
  host.before(form);
  if (host.tagName === 'DETAILS') { host.open = false; $('summary',host).textContent = '단일 품목 입력 (기존 상세 양식)'; }
  else { const details = document.createElement('details'); details.className = 'card'; details.innerHTML = '<summary>단일 품목 입력 (기존 상세 양식)</summary>'; host.before(details); details.append(host);
    // Orders and shipments use this form only: the old single form has no unit or product-code field, which split stock lines.
    if (['purchase_order', 'shipment'].includes(entity)) details.hidden = true; }
  const rowsRoot = $('[data-multi-rows]',form), status = $('[data-multi-status]',form), submit = $('[data-multi-submit]',form);
  // Items come from the product catalog by default; purchase orders and shipments may also be typed in,
  // in which case the server issues a temporary code for an administrator to tidy up.
  const picker = ['other_receipt','schedule','purchase_order','shipment'].includes(entity), freeEntry = ['purchase_order','shipment'].includes(entity);
  let boms = [], loadingBoms = picker;
  const draft = withPhotos ? bindPhotoDraft(form) : { photos: [], busy: false, reset() {} };
  const key = () => crypto.randomUUID(); let requestId = key(), saved = null, payload = null, remaining = [], busy = false;
  const updateCount = () => { const count = $$('[data-multi-row]',form).length; submit.textContent = saved ? '사진 저장 재시도' : `${count}품목 함께 등록`; $('[data-add-item]',form).disabled = count >= 30; };
  const optionHtml = () => `<option value="">${entity === 'schedule' ? '직접 입력 (BOM 선택 가능)' : freeEntry ? '직접 입력 (임시 제품코드 부여)' : entity === 'other_receipt' ? '품목을 선택하세요' : 'BOM 품목을 선택하세요'}</option>${boms.filter(b => entity !== 'schedule' || (b.kind === kind && !b.is_temp)).map(b => `<option value="${b.id}">[${esc(b.item_category || '미분류')}] ${esc(b.product)} ${esc(b.product_code)}${b.is_temp ? ' (임시)' : ''}</option>`).join('')}`;
  const add = () => {
    if ($$('[data-multi-row]',form).length >= 30) return;
    const row = document.createElement('fieldset'); row.dataset.multiRow = ''; row.className = 'multi-row';
    row.innerHTML = `<legend>품목</legend><div class="form-grid">${picker ? `<div class="multi-find"><button type="button" class="btn" data-bom-find>품목 찾기</button></div><label class="span2">${freeEntry ? '제품코드로 불러오기' : entity === 'other_receipt' ? '품목명 *' : 'BOM 품목'}<select data-line-key="bom_id" ${entity === 'other_receipt' ? 'required' : ''}>${optionHtml()}</select></label>` : ''}<label${entity === 'other_receipt' ? ' class="receipt-item-name"' : ''}>${entity === 'laundry' ? '옷 종류 (원피스·투피스 등)' : '품목명 / 제품명'} *<input data-line-key="item" required ${entity === 'other_receipt' ? 'readonly' : ''} ${entity === 'schedule' && kind === 'semi' ? 'list="semiPlanItems"' : ''} maxlength="200"></label><label>규격·사이즈<input data-line-key="spec" maxlength="100" placeholder="예) S / M / L"></label><label>${entity === 'laundry' ? '입고' : entity === 'schedule' ? '계획' : ''}수량 *<input data-line-key="qty" type="number" min="0" step="any" required></label><label>단위<input data-line-key="unit" maxlength="20" placeholder="예) EA / BOX / 벌" ${entity === 'other_receipt' ? 'readonly' : ''}></label><label>LOT <span class="hint">(선택${entity === 'purchase_order' ? ' · 모르면 비워 두고 입고 후 입력' : ''})</span><input data-line-key="lot" maxlength="100"></label>${entity === 'purchase_order' ? `<label>분류 *<select data-line-key="item_category" required>${categoryOptions('',true).replace('전체 분류','분류 선택')}</select></label><label class="inline"><input data-line-key="coa_requested" type="checkbox">COA 요청</label>` : ''}${entity === 'laundry' ? '<label>폐기수량 *<input data-line-key="discard_qty" type="number" min="0" step="any" value="0" required></label>' : ''}${type === 'development' ? '<label>타겟단가 *<input data-line-key="target_price" required></label>' : ''}</div><div class="actions"><button type="button" class="btn small danger" data-remove-item>품목 삭제</button></div>`;
    rowsRoot.append(row);
    // 15.107 발주는 줄마다 단가(발주서 금액·매입전표 기본 단가)
    if (entity === 'purchase_order' && !$('[data-line-key=unit_price]', row)) $('[data-line-key=qty]', row)?.closest('label').insertAdjacentHTML('afterend', '<label>단가 <span class="hint">(발주서 금액)</span><input data-line-key="unit_price" type="number" min="0" step="any" inputmode="decimal" placeholder="원"></label>');
    $('[data-remove-item]',row).onclick = () => { if ($$('[data-multi-row]',form).length === 1) return toast('품목은 1개 이상 필요합니다.','err'); row.remove(); updateCount(); };
    const select = $('[data-line-key=bom_id]',row);
    if (select) {
      select.onchange = () => {
        const bom = boms.find(b => b.id === Number(select.value));
        $('[data-line-key=item]',row).readOnly = !!bom || entity === 'other_receipt'; $('[data-line-key=unit]',row).readOnly = !!bom || entity === 'other_receipt';
        itemLockMark($('[data-line-key=item]',row)); itemLockMark($('[data-line-key=unit]',row));
        if (bom) { $('[data-line-key=item]',row).value = bom.product; $('[data-line-key=unit]',row).value = bom.unit; }
        const category = $('[data-line-key=item_category]',row);
        if (bom && category && [...category.options].some(option => option.value === bom.item_category)) category.value = bom.item_category;
        sizeGrid(row, bom?.sizes || []);
        fromCatalog(row, entity, bom); // after the size grid, which shows spec/qty again for items without sizes
      };
      if (typeof itemSuggest === 'function') itemSuggest($('[data-line-key=item]',row), () => boms.filter(b => entity !== 'schedule' || (b.kind === kind && !b.is_temp)), bom => { select.value = String(bom.id); select.onchange(); ($('[data-line-key=qty]',row) || select).focus(); }); // 15.270 품목명·코드 일부로 제안
      // 15.70 품목 찾기 창(분류 탭·세부 분류·검색·표)으로 고른다. 선택칸은 그대로 두어 고른 값을 담는다.
      $('[data-bom-find]',row).onclick = async () => {
        // 15.137 체크해 여러 품목: 첫 품목은 이 줄, 나머지는 새 줄로
        const got = ((await openItemPicker(boms, { filter: b => entity !== 'schedule' || (b.kind === kind && !b.is_temp), multi: true, lots: false }))?.items || []).map(x => x.bom);
        if (!got.length) return select.focus();
        select.value = String(got[0].id); select.onchange();
        for (const bom of got.slice(1)) { const r = add(); if (!r) { toast('품목은 30개까지 등록할 수 있습니다.', 'err'); break; } const sel = $('[data-line-key=bom_id]', r); if (sel) { sel.value = String(bom.id); sel.onchange(); } }
        ($('[data-line-key=qty]',row) || select).focus();
      };
    }
    updateCount(); return row;
  };
  add(); $('[data-add-item]',form).onclick = add;
  const partner = $('[name=vendor],[name=customer]',form);
  if (partner) bindPartnerPicker(partner, $('[data-partner-hint]',form), { recent: entity === 'purchase_order', type: entity === 'shipment' ? 'sales' : 'purchase', onPick: item => {
    // Fill the first blank line (or a new one) from a recent purchase; quantity is left for the user.
    const row = $$('[data-multi-row]',form).find(r => !$('[data-line-key=item]',r).value.trim()) || add(); if (!row) return toast('품목은 30개까지 등록할 수 있습니다.','err');
    const select = $('[data-line-key=bom_id]',row); const bom = item.product_code && boms.find(b => b.product_code === item.product_code);
    if (select && bom) { select.value = String(bom.id); select.onchange(); } else $('[data-line-key=item]',row).value = item.item;
    $('[data-line-key=spec]',row).value = item.spec || '';
    const unit = $('[data-line-key=unit]',row); if (!unit.readOnly) unit.value = item.unit || '';
    const category = $('[data-line-key=item_category]',row); if (category && item.item_category) category.value = item.item_category;
    $('[data-line-key=qty]',row).focus();
  } }).catch(() => {});
  if (loadingBoms) {
    submit.disabled = true;
    try { boms = await api('GET','/api/boms?temp=1'); $$('[data-line-key=bom_id]',form).forEach(select => { select.innerHTML = optionHtml(); }); status.textContent = ''; loadingBoms = false; }
    catch(error) { status.textContent = 'BOM을 불러오지 못했습니다. 화면을 새로고침하세요. ' + error.message; }
    finally { submit.disabled = loadingBoms; }
  }
  if (!form.isConnected || !ME) return;
  const entryDraft = bindEntryDraft(form, `multi:${location.hash || '#/'}:${entity}:${type}`, {
    read: () => ({ fields: uxFormRead(form), lines: $$('[data-multi-row]', form).map(row => $$('[data-line-key]', row).map(input => [input.dataset.lineKey, input.type === 'checkbox' ? input.checked : input.value])), requestId }),
    restore: value => {
      uxFormRestore(form, value.fields);
      rowsRoot.replaceChildren();
      for (const values of (value.lines || []).slice(0, 30)) {
        const row = add();
        for (const [key, val] of values) { const input = $$('[data-line-key]', row).find(el => el.dataset.lineKey === key); if (!input) continue; if (input.type === 'checkbox') input.checked = val === true; else input.value = String(val ?? ''); }
        $('[data-line-key=bom_id]', row)?.onchange?.();
        for (const [key, val] of values) { const input = $$('[data-line-key]', row).find(el => el.dataset.lineKey === key); if (input && key.startsWith('size:')) input.value = String(val ?? ''); }
      }
      if (!rowsRoot.children.length) add();
      if (typeof value.requestId === 'string') requestId = value.requestId;
      updateCount();
    },
  });
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || draft.busy || loadingBoms) return;
    busy = true; submit.disabled = true; form.inert = true; entryDraft.start();
    try {
      if (!saved) {
        payload = multiPayload(form,entity,type,kind,requestId);
        status.textContent = `${payload.items.length}품목을 저장하고 있습니다…`;
        saved = await api('POST','/api/batches/' + entity,payload);
        entryDraft.clear('품목 저장 완료 · 사진 업로드 중에는 화면을 유지하세요.');
        remaining = saved.rows.slice(); $('[data-multi-fields]',form).disabled = true;
        // Show the saved rows right away so nobody re-enters them while photos upload or retry.
        $('#main form.list-filters')?.requestSubmit();
      }
      while (remaining.length) {
        const row = remaining[0]; status.textContent = `품목 저장 완료 · 공통 사진 저장 ${saved.rows.length - remaining.length + 1}/${saved.rows.length}`;
        if (draft.photos.length) {
          if (entity === 'laundry') await api('PUT','/api/laundry/' + row.id,{ ...row, keep_photos: row.photos || [], photos: draft.photos });
          else {
            // New rows start at revision 0. A 409 means an earlier attempt already stored these photos
            // (e.g. the response was lost), so skip instead of uploading a duplicate set.
            try { await api('PUT',`/api/attachments/${entity}/${row.id}`,{ photos: draft.photos, revision: 0 }); }
            catch (error) { if (error.status !== 409) throw error; }
          }
        }
        remaining.shift();
      }
      toast(`${saved.rows.length}품목을 등록했습니다.`);
      if (entity === 'schedule') rememberScheduleDate(payload.common.start_date);
      await render();
      const prefix = {shipment:'sh',other_receipt:'other',laundry:'ln'}[entity]; const date = payload.common.ship_date || payload.common.received_date || payload.common.in_date;
      if (prefix && date && $('#' + prefix + 'Filters')) { $('#' + prefix + 'From').value = date; $('#' + prefix + 'To').value = date; $('#' + prefix + 'Filters').requestSubmit(); }
    } catch(error) { if (!saved) entryDraft.failure(); else entryDraft.clear('품목은 저장되었습니다 · 다시 등록하지 말고 사진만 재시도하세요.'); status.textContent = saved ? `${saved.rows.length}품목은 이미 저장되었습니다(아래 목록에 표시). 다시 등록하지 말고 사진만 재시도하세요. 사진 저장 실패: ${error.message}` : error.message; fail(error); }
    finally { busy = false; form.inert = false; submit.disabled = false; updateCount(); }
  };
}
// 15.108 발주·출하·기타입고는 수주 입력과 같은 표 입력(line-table.js). 세탁·생산계획·의뢰는 이 카드 폼 그대로.
const LT_ENTITIES = ['purchase_order', 'shipment', 'other_receipt'];
function enhanceMultiForms() {
  if (!ME) return;
  const configs = [['#poNew','purchase_order'],['#shNew','shipment'],['#otherNew','other_receipt'],['#lnNew','laundry'],['#scNew','schedule']];
  for (const [selector,entity] of configs) { const form = $(selector); if (form && !form.dataset.multiInstalled) (LT_ENTITIES.includes(entity) ? installLineTable(form,entity) : installMultiItems(form,entity)).catch(fail); }
  const form = $('#reqNewBox .req-form');
  if (form && !form.dataset.multiInstalled) {
    const type = location.hash.includes('/purchase/sample') ? 'sample_goods' : location.hash.includes('/voc/') ? 'voc' : location.hash.includes('/quality/') ? 'analysis' : location.hash.includes('/dev/analysis') ? 'rnd_analysis' : location.hash.includes('/dev/') ? 'development' : 'sample';
    installMultiItems(form,'request',type).catch(fail);
  }
}
document.addEventListener('DOMContentLoaded',() => { enhanceMultiForms(); new MutationObserver(enhanceMultiForms).observe(document.body,{childList:true,subtree:true}); });

// ── 생산실적 수정·취소 요청 (생산팀장 승인 후 반영) ──
const CHANGE_STATUS = { pending: '승인 대기', approved: '승인', rejected: '반려', cancelled: '철회' };
function changeSummary(c) {
  if (c.action === 'void') return `취소 요청 (${esc(c.old_date)} · ${fmtNum(c.old_qty)})`;
  const parts = [];
  if (c.new_date !== c.old_date) parts.push(`생산일 ${esc(c.old_date)} → ${esc(c.new_date)}`);
  if (c.new_qty !== c.old_qty) parts.push(`수량 ${fmtNum(c.old_qty)} → ${fmtNum(c.new_qty)}`);
  if (c.new_note !== c.old_note) parts.push(`메모 "${esc(c.old_note)}" → "${esc(c.new_note)}"`);
  return '수정 요청: ' + parts.join(', ');
}
function changeActions(c, canApprove) {
  if (c.status !== 'pending') return '';
  return `${canApprove ? `<button class="btn small primary" data-change-approve="${c.id}">승인</button> <button class="btn small danger" data-change-reject="${c.id}">반려</button>` : ''}${c.requested_by_id === ME.id ? ` <button class="btn small" data-change-cancel="${c.id}">요청 철회</button>` : ''}`;
}
function changeHistory(changes = []) {
  const done = changes.filter(c => c.status !== 'pending');
  if (!done.length) return '';
  return `<details class="change-history"><summary>수정·취소 요청 이력 (${done.length})</summary><div class="table-wrap"><table class="grid"><thead><tr><th>결과</th><th>내용</th><th>사유</th><th>요청</th><th>처리</th></tr></thead><tbody>${done.map(c => `<tr><td><span class="chip ${c.status === 'approved' ? 'green' : c.status === 'rejected' ? 'red' : ''}">${CHANGE_STATUS[c.status]}</span></td><td>${changeSummary(c)}</td><td>${esc(c.reason)}</td><td>${esc(c.requested_by)}<br><span class="small muted">${esc(c.requested_at)}</span></td><td>${esc(c.reviewed_by || '')}${c.review_note ? ' · ' + esc(c.review_note) : ''}<br><span class="small muted">${esc(c.reviewed_at || '')}</span></td></tr>`).join('')}</tbody></table></div></details>`;
}
async function handleChangeAction(button, after) {
  const id = button.dataset.changeApprove || button.dataset.changeReject || button.dataset.changeCancel;
  if (button.dataset.changeApprove) { if (!await reviewApproval('actual', id)) return; await api('POST', `/api/actual-changes/${id}/approve`, {}); toast('승인했습니다. 실적에 반영되었습니다.'); }
  else if (button.dataset.changeReject) { const v = await promptBox('수정·취소 요청 반려', '<label>반려 사유 *<input name="note" required maxlength="500"></label>'); if (!v) return; await api('POST', `/api/actual-changes/${id}/reject`, v); toast('반려했습니다.'); }
  else { if (!(await confirmBox('이 요청을 철회할까요?'))) return; await api('POST', `/api/actual-changes/${id}/cancel`); toast('요청을 철회했습니다.'); }
  await after();
}
function bindChangeButtons(root, after) {
  $$('[data-change-approve],[data-change-reject],[data-change-cancel]', root).forEach(button => button.onclick = event => {
    event.preventDefault(); event.stopPropagation(); if (button.disabled) return; button.disabled = true;
    handleChangeAction(button, after).catch(fail).finally(() => { button.disabled = false; });
  });
}
async function renderActualChanges(root, kind) {
  if (!root) return;
  const rows = await api('GET', `/api/actual-changes?status=pending&kind=${kind}`);
  if (!root.isConnected) return;
  const canApprove = ME.is_admin || ME.roles.includes('production_approver');
  root.innerHTML = rows.length ? `<div class="card"><h3>생산실적 수정·취소 승인 대기 <span class="chip yellow">${rows.length}건</span></h3><p class="small muted">${canApprove ? '승인하면 실적과 달성률에 바로 반영됩니다.' : '생산팀장 승인 후 실적에 반영됩니다.'}</p><div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th>요청 내용</th><th>사유</th><th>요청자</th><th></th></tr></thead><tbody>${rows.map(c => `<tr><td>${esc(c.product)} ${esc(c.spec)}<div class="small muted">계획 ${esc(c.start_date)} · ${esc(PERIOD[c.period] || c.period)}</div></td><td>${changeSummary(c)}</td><td>${esc(c.reason)}</td><td>${esc(c.requested_by)}<br><span class="small muted">${esc(c.requested_at)}</span></td><td class="nowrap">${changeActions(c, canApprove)} <button class="btn small" data-actual-open="${c.schedule_id}">실적 보기</button></td></tr>`).join('')}</tbody></table></div></div>` : '';
  bindChangeButtons(root, () => render());
}

async function openProductionActuals(id, { onChange = null } = {}) {
  const box = modal('<h3>생산실적 · 실제 생산량</h3><div data-actual-content>불러오는 중…</div>',{wide:true});
  let requestId = crypto.randomUUID(), history = [], next = null, busy = false, lotInfo = null;
  lotInfo = await api('GET', `/api/schedules/${id}/lot-materials`).catch(() => null);
  const load = async (previous = false) => {
    const result = await api('GET',`/api/schedules/${id}/actuals` + (previous ? '?before=' + next : ''));
    if (!box.el.isConnected) return;
    history = previous ? history.concat(result.rows) : result.rows; next = result.next;
    const s = result.schedule; const unit = s.unit || s.bom_snapshot?.unit || '단위 미지정';
    const last = s.period === 'day' ? s.start_date : s.period === 'week' ? addDays(s.start_date,6) : monthEnd(s.start_date);
    const date = todayStr() < s.start_date || todayStr() > last ? s.start_date : todayStr();
    $('[data-actual-content]',box.el).innerHTML = `<h4>${esc(s.product)} ${esc(s.spec)} · ${esc(unit)}</h4><p>계획 ${fmtNum(s.qty)} / 실제 누적 <b>${fmtNum(result.actual_qty)}</b> / 차이 ${fmtNum(result.variance_qty)} / 달성률 ${result.achievement_rate ?? '—'}%</p><p class="small muted">${esc(s.start_date)} ~ ${esc(last)} · ${result.auto ? '반제품 실적은 <a href="#/prod/semi/cut">반제품 · 커팅/융착</a> 기록에서 자동으로 집계됩니다(같은 품목명, 계획에 사이즈가 있으면 같은 사이즈, 계획 기간 안의 작업일). 여기에는 입력하지 않습니다.' : '완료 체크와 별도로 실제 생산한 수량만 입력하세요. 같은 생산실적을 여러 일정에 중복 입력하지 마세요.'}</p>${result.auto ? `<div class="table-wrap"><table class="grid"><thead><tr><th>작업일</th><th>라인</th><th>사이즈·규격</th><th class="r">양품</th><th class="r">불량</th><th>입력자</th></tr></thead><tbody>${result.cut_rows.map(c => `<tr><td>${esc(c.work_date)}</td><td>${esc(c.unit_name)}</td><td>${esc(c.spec)}</td><td class="r"><b>${fmtNum(c.qty)}</b> ${esc(c.unit)}</td><td class="r">${fmtNum(c.defect_qty)}</td><td class="small muted">${esc(c.created_by)}</td></tr>`).join('') || '<tr><td colspan="6">이 계획에 해당하는 커팅/융착 기록이 아직 없습니다.</td></tr>'}</tbody></table></div>${history.length ? '<h4>이전에 직접 입력한 실적</h4>' : ''}` : ''}${result.auto && !history.length ? '' : result.can_write ? `<form class="stack" data-actual-form><div class="form-grid">${multiInput('production_date','생산일','date',date)}<label>실제 생산량 *<input name="qty" type="number" min="0" step="any" required></label>${multiInput('note','작업·변동 메모','text','',false)}<label>완제품 LOT <span class="hint">(비우면 자동 ${esc(lotInfo?.product_lot_prefix || 'P')}+생산일_순번)</span><input name="lot" maxlength="100" placeholder="자동"></label></div><div class="actions" style="justify-content:flex-start"><button type="button" class="btn small" data-actual-bags title="이번 포장에 쓴 세탁 완료 봉투 LOT">봉투 LOT <b data-actual-bagn>0</b></button></div><div data-actual-lots></div><p role="status" data-actual-status class="small muted"></p><div class="actions"><button class="btn primary">생산실적 추가</button></div></form>` : result.auto ? '' : '<p class="muted">생산 담당자 또는 일정 등록자가 실적을 입력할 수 있습니다.</p>'}${result.auto && !history.length ? '' : `<div class="table-wrap"><table class="erp-grid actual-hist" data-keep-cols data-no-sort><thead><tr><th>생산일</th><th>작업지시번호</th><th class="r">양품 수량</th><th>완제품 LOT</th><th>투입 자재 (자재 · LOT · 수량)</th><th>입력자 / 입력시각</th><th>메모</th><th></th></tr></thead><tbody>${history.map(a => `<tr class="${a.voided_at ? 'row-off' : ''}"><td class="nowrap"><b>${esc(a.production_date)}</b></td><td class="nowrap">${a.work_order ? `<button type="button" class="link-btn" data-wo-qr="${esc(a.work_order)}" data-wo-sub="${esc(`${s.product} · ${fmtNum(a.qty)} ${unit}${a.lot ? ' · LOT ' + a.lot : ''}`)}" title="QR코드 발행">${esc(a.work_order)}</button>` : '—'}</td><td class="r actual-qty"><b>${fmtNum(a.qty)}</b> <span class="small muted">${esc(unit)}</span>${a.voided_at ? '<div><span class="chip">취소</span></div>' : ''}${a.corrected_at ? `<div class="small muted">수정됨 · 승인 ${esc(a.corrected_by)}</div>` : ''}</td><td class="nowrap">${a.lot ? `<span class="lot-tag">${esc(a.lot)}</span>` : '<span class="muted">—</span>'}</td><td>${(a.inputs || []).length ? `<table class="actual-inputs"><tbody>${a.inputs.map(x => `<tr><td>${esc(x.item)}</td><td><span class="lot-tag">${esc(x.lot)}</span></td><td class="r">${fmtNum(x.qty)} <span class="small muted">${esc(x.unit || '')}</span></td></tr>`).join('')}</tbody></table>` : '<span class="muted small">투입 LOT 없음</span>'}</td><td class="small">${esc(a.author_name)}<br><span class="muted">${esc(String(a.created_at).slice(5, 16))}</span></td><td>${esc(a.note)}${a.voided_at ? `<br>취소: ${esc(a.voided_by)} · ${esc(a.void_reason)}` : ''}</td><td>${a.voided_at ? '' : a.pending_change ? `<span class="chip yellow">승인 대기</span><div class="small">${changeSummary(a.pending_change)}<br>사유: ${esc(a.pending_change.reason)} · ${esc(a.pending_change.requested_by)}</div>${changeActions(a.pending_change, result.can_approve)}` : result.can_write ? `<button class="btn small" data-actual-edit="${a.id}">수정 요청</button> <button class="btn small danger" data-actual-void="${a.id}">취소 요청</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8">아직 입력한 생산실적이 없습니다.</td></tr>'}</tbody></table></div>`}${next ? '<button class="btn small" data-actual-more>이전 실적 더 보기</button>' : ''}<p class="small muted">입력된 실적의 수정·취소는 요청 후 <b>생산팀장 승인</b> 시 반영됩니다. 지난 기간의 실적도 요청할 수 있습니다.</p>${changeHistory(result.changes)}`;
    const form = $('[data-actual-form]',box.el);
    const rawMats = (lotInfo?.materials || []).filter(m => m.item_category !== '반제품'); // 15.252 반제품은 봉투 LOT으로 연결
    const lotBox = form && rawMats.length ? actualLotInputs($('[data-actual-lots]', form), rawMats, () => Number(form.elements.qty.value) || 0) : null;
    let bags = []; const bagBtn = form && $('[data-actual-bags]', form);
    if (bagBtn) { bagBtn.hidden = !(s.bom_snapshot?.materials || []).some(m => m.item_category === '반제품'); bagBtn.onclick = async () => { const picked = await packPickBags(s, bags).catch(e => { fail(e); return null; }); if (!picked) return; bags = picked; $('[data-actual-bagn]', form).textContent = bags.length; bagBtn.classList.toggle('on', bags.length > 0); const t = packExpectedText(s, bags); let h = $('[data-actual-exp]', form); if (!h) { h = document.createElement('span'); h.className = 'small pack-exp'; h.dataset.actualExp = ''; bagBtn.after(h); } h.textContent = t; }; } // 15.254 예상 생산량
    if (lotBox) form.elements.qty.addEventListener('input', () => lotBox.autofill());
    if (form) { form.elements.production_date.min = s.start_date; form.elements.production_date.max = last < todayStr() ? last : todayStr(); }
    if (form) form.onsubmit = async event => {
      event.preventDefault(); if (busy) return; busy = true; const button = $('button',form); button.disabled = true;
      let stored = false;
      try { const short = lotBox?.short(); if (short && !await confirmBox(`투입 LOT 수량이 필요량보다 적습니다: ${short}. 이대로 저장할까요?`)) return; const { lotq, ...fv } = formObj(form); if (bagBtn && !bagBtn.hidden && !bags.length && !await confirmBox(`${s.product}: 포장에 쓴 봉투 LOT을 고르지 않았습니다. 고르지 않으면 이 완제품 LOT에서 봉투·원자재 LOT으로 거슬러 볼 수 없습니다. 그래도 저장할까요?`)) return; await api('POST',`/api/schedules/${id}/actuals`,{ ...fv, inputs: lotBox ? lotBox.value() : [], bags, request_id:requestId }); stored = true; form.reset(); lotInfo = await api('GET', `/api/schedules/${id}/lot-materials`).catch(() => lotInfo); requestId = crypto.randomUUID(); await load(); render(); toast('생산실적을 기록했습니다.'); }
      catch(error) { $('[data-actual-status]',form).textContent = stored ? '실적은 저장되었습니다. 조회에 실패했으니 다시 열어 확인하세요.' : error.message; fail(error); }
      finally { busy = false; button.disabled = false; }
    };
    const refresh = async () => { await load(); render(); };
    $$('[data-actual-void]',box.el).forEach(button => button.onclick = async () => {
      if (busy) return;
      const value = await promptBox('생산실적 취소 요청','<p class="small muted">생산팀장이 승인하면 이 실적이 합계에서 빠집니다.</p><label>취소 사유 *<input name="reason" required maxlength="500"></label>');
      if (!value) return;
      busy = true;
      try { await api('POST',`/api/schedules/${id}/actuals/${button.dataset.actualVoid}/void`,{ ...value, request_id: crypto.randomUUID() }); toast('취소 요청을 올렸습니다. 생산팀장 승인 후 반영됩니다.'); await refresh(); }
      catch(error) { fail(error); } finally { busy = false; }
    });
    $$('[data-actual-edit]',box.el).forEach(button => button.onclick = async () => {
      if (busy) return;
      const a = history.find(row => row.id === Number(button.dataset.actualEdit)); const max = last < todayStr() ? last : todayStr();
      const value = await promptBox('생산실적 수정 요청',`<p class="small muted">현재: ${esc(a.production_date)} · ${fmtNum(a.qty)} ${esc(unit)}. 생산팀장이 승인하면 반영됩니다.</p><label>생산일 *<input name="production_date" type="date" required value="${esc(a.production_date)}" min="${esc(s.start_date)}" max="${esc(max)}"></label><label>실제 생산량 *<input name="qty" type="number" min="0" step="any" required value="${esc(a.qty)}"></label><label>작업·변동 메모<input name="note" maxlength="1000" value="${esc(a.note)}"></label><label>수정 사유 *<input name="reason" required maxlength="500"></label>`);
      if (!value) return;
      busy = true;
      try { await api('POST',`/api/schedules/${id}/actuals/${a.id}/changes`,{ ...value, request_id: crypto.randomUUID() }); toast('수정 요청을 올렸습니다. 생산팀장 승인 후 반영됩니다.'); await refresh(); }
      catch(error) { fail(error); } finally { busy = false; }
    });
    bindChangeButtons(box.el, refresh);
    // 15.230 계획 접수 취소: 확정된 완제품 계획에 실적(취소되지 않은 것)이 없으면 대기로 되돌린다.
    const live = history.filter(a => !a.voided_at).length;
    if (s.kind === 'finished' && s.confirmed_at && hasRole('production')) {
      const bar = document.createElement('div'); bar.className = 'actions plan-undo';
      bar.innerHTML = live ? '<span class="small muted">실적이 있어 계획 접수를 취소할 수 없습니다(실적을 먼저 취소하세요).</span>' : '<button type="button" class="btn danger" data-plan-undo>계획 접수 취소(대기로)</button>';
      $('[data-actual-content]', box.el).prepend(bar);
      $('[data-plan-undo]', bar)?.addEventListener('click', async () => {
        if (!await confirmBox(`${s.product} ${s.start_date} 계획 접수를 취소할까요? 「계획생산 접수·관리」에서 대기로 돌아가고 실적 입력 목록에서 빠집니다.`)) return;
        try { await api('POST', '/api/schedules/confirm', { ids: [s.id], confirm: false }); toast('계획 접수를 취소했습니다(대기).'); box.close(); await onChange?.(); } catch (error) { fail(error); }
      });
    }
    const more = $('[data-actual-more]',box.el); if (more) more.onclick = () => load(true).catch(fail);
  };
  await load();
}
// 15.230 작업지시번호를 누르면 QR코드 발행(번호 그대로 QR)
document.addEventListener('click', event => { const b = event.target.closest('[data-wo-qr]'); if (!b) return; event.preventDefault(); qrIssue([{ code: b.dataset.woQr, sub: b.dataset.woSub || '' }], { file: '작업지시' }); });
document.addEventListener('click',event => {
  const button = event.target.closest('[data-actual-open]'); if (!button) return;
  event.preventDefault(); event.stopPropagation(); openProductionActuals(button.dataset.actualOpen).catch(fail);
},true);

document.addEventListener('click',async event => {
  const button = event.target.closest('[data-line-meta]'); if (!button) return;
  event.preventDefault(); event.stopPropagation();
  const value = await promptBox('품목 규격·사이즈·단위', `${button.dataset.lineMeta === 'laundry' ? multiInput('item','옷 종류','text',button.dataset.lineName) : ''}${multiInput('spec','규격·사이즈','text',button.dataset.lineSpec,false)}${multiInput('unit','단위','text',button.dataset.lineUnit,false)}${multiInput('lot','LOT','text',button.dataset.lineLot,false)}`);
  if (!value) return;
  try { await api('PUT',`/api/items/${button.dataset.lineMeta}/${button.dataset.lineId}`,value); render(); toast('품목 규격을 저장했습니다.'); } catch(error) { fail(error); }
},true);

// 15.135 생산실적 투입 자재 LOT: BOM 자재마다 필요량(생산량 × BOM 비율)을 먼저 들어온 LOT부터 채워 제안하고, 줄마다 LOT·수량을 고칠 수 있다.
function actualLotInputs(box, materials, getQty) {
  let rows = [], edited = false;
  const lotsOf = item => materials.find(m => m.item === item)?.lots || [];
  const autofill = (force = false) => {
    if (edited && !force) return draw();
    const q = getQty(); rows = [];
    for (const m of materials) {
      let need = Math.round(q * m.per * 1000) / 1000; const lots = m.lots.filter(l => l.balance > 0 && !l.qc_fail); // 15.257 불합격 LOT은 자동으로 넣지 않음
      if (!lots.length || !(need > 0)) { rows.push({ item: m.item, unit: m.unit, lot: '', qty: '' }); continue; }
      for (const l of lots) { if (need <= 0) break; const take = Math.min(need, l.balance); rows.push({ item: m.item, unit: m.unit, lot: l.lot, qty: Math.round(take * 1000) / 1000 }); need = Math.round((need - take) * 1000) / 1000; }
    }
    draw();
  };
  const used = (item, lot, except) => rows.filter((r, k) => k !== except && r.item === item && r.lot === lot).reduce((t, r) => t + (Number(r.qty) || 0), 0);
  const draw = () => {
    const q = getQty();
    box.innerHTML = `<h4>투입 자재 LOT <span class="small muted">생산량을 넣으면 먼저 들어온 LOT부터 필요량만큼 채웁니다. LOT·수량은 고칠 수 있습니다.</span></h4>
      <div class="table-wrap"><table class="grid lot-in-grid"><thead><tr><th>자재</th><th class="r">필요량</th><th>LOT (남은 수량)</th><th class="r">투입 수량</th><th></th></tr></thead><tbody>${rows.map((r, k) => { const m = materials.find(x => x.item === r.item), first = rows.findIndex(x => x.item === r.item) === k, got = rows.filter(x => x.item === r.item).reduce((t, x) => t + (Number(x.qty) || 0), 0), need = Math.round(q * (m?.per || 0) * 1000) / 1000;
        return `<tr><td>${first ? `<b>${esc(r.item)}</b>` : '<span class="small muted">〃</span>'}</td><td class="r">${first ? `${fmtNum(need)} ${esc(r.unit)}${got + 0.0005 < need ? ` <div class="small red-text">부족 ${fmtNum(Math.round((need - got) * 1000) / 1000)}</div>` : ''}` : ''}</td>
        <td>${lotsOf(r.item).length ? `<select data-li="lot" data-k="${k}" aria-label="${esc(r.item)} LOT"${lotsOf(r.item).find(l => l.lot === r.lot)?.concession ? ' class="lot-tk-input"' : ''}><option value="">LOT 고르기</option>${lotsOf(r.item).map(l => `<option value="${esc(l.lot)}"${l.lot === r.lot ? ' selected' : ''}${l.qc_fail ? ' disabled' : ''}>${l.concession ? '★특채 ' : l.qc_fail ? '불합격 ' : ''}${esc(l.lot)} · 남은 ${fmtNum(l.balance)}${l.places ? ' · ' + esc(l.places) : ''}</option>`).join('')}</select>` : '<span class="small muted">재고 LOT 없음</span>'}</td>
        <td class="r"><input type="number" name="lotq" min="0" step="any" inputmode="decimal" data-li="qty" data-k="${k}" value="${esc(r.qty)}" aria-label="${esc(r.item)} 투입 수량"${lotsOf(r.item).length ? '' : ' disabled'}></td>
        <td class="nowrap">${lotsOf(r.item).length > 1 ? `<button type="button" class="btn small" data-li-add="${k}">+ LOT</button>` : ''}${!first ? ` <button type="button" class="btn small" data-li-del="${k}">빼기</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  };
  box.addEventListener('change', e => { const k = Number(e.target.dataset.k); if (e.target.dataset.li === 'lot') { rows[k].lot = e.target.value; edited = true; draw(); } });
  box.addEventListener('input', e => { const k = Number(e.target.dataset.k); if (e.target.dataset.li === 'qty') { rows[k].qty = e.target.value; edited = true; } });
  box.addEventListener('focusout', e => { if (e.target.dataset.li === 'qty') draw(); });
  box.addEventListener('click', e => {
    const a = e.target.closest('[data-li-add]'), d = e.target.closest('[data-li-del]');
    if (a) { const r = rows[Number(a.dataset.liAdd)]; rows.splice(rows.map(x => x.item).lastIndexOf(r.item) + 1, 0, { item: r.item, unit: r.unit, lot: '', qty: '' }); edited = true; draw(); }
    if (d) { rows.splice(Number(d.dataset.liDel), 1); edited = true; draw(); }
  });
  autofill(true);
  return {
    autofill: () => autofill(false),
    value: () => rows.filter(r => r.lot && Number(r.qty) > 0).map(r => ({ item: r.item, unit: r.unit, lot: r.lot, qty: Number(r.qty) })),
    short: () => { const q = getQty(); const out = materials.filter(m => { const need = Math.round(q * m.per * 1000) / 1000, got = rows.filter(r => r.item === m.item && r.lot).reduce((t, r) => t + (Number(r.qty) || 0), 0); return m.lots.length && got + 0.0005 < need; }); return out.map(m => m.item).join(', '); },
  };
}


// ── 15.199 완제품 계획생산 접수·관리: 월 계획표(제품 × 1~31일). 칸 = 그날 계획 수량, 대기(분홍)·확정(초록).
// 칸을 눌러 그날 수량 넣기·고치기(0·빈칸이면 지움), 「추가」로 품목·날짜·수량, 줄 체크 → 「확정」·「확정취소」(체크 없으면 보이는 줄 전체).
// 확정한 계획만 「완제품 실적 입력」에 나온다. 확정한 칸은 확정취소 후 고친다(실적이 있으면 확정취소 불가).
async function pageFinishedPlan(main) {
  const canEdit = hasRole('production');
  let month = todayStr().slice(0, 7); try { month = sessionStorage.getItem('wpa:fp-month') || month; } catch { /* 편의 기능 */ }
  main.innerHTML = `<h1>완제품 계획생산 접수·관리 <span class="dept">생산</span></h1>
  <p class="muted">달마다 완제품의 날짜별 생산 계획을 받습니다. 칸을 눌러 수량을 넣으면 <b>대기</b>로 들어가고, 대기 칸을 눌러 「확정」하면 그 한 건만 <b>확정</b>되어 「완제품 실적 입력」에 나옵니다. 확정 칸을 누르면 「확정취소」할 수 있습니다(실적이 없을 때).</p>
  <form class="toolbar fp-tools" id="fpTools" data-read-only>
    <label>계획월<input type="month" name="month" value="${month}" required></label>
    <div class="nav-date"><button type="button" class="btn small" data-fp-move="-1" aria-label="이전 달">◀</button><button type="button" class="btn small" data-fp-move="0">이번 달</button><button type="button" class="btn small" data-fp-move="1" aria-label="다음 달">▶</button></div>
    <label>품목코드/명<input type="search" name="q" placeholder="품목코드/명 검색" autocomplete="off"></label>
    <div class="fp-reg" role="radiogroup" aria-label="계획여부"><b>계획여부</b><label class="inline"><input type="radio" name="reg" value="1" checked> 등록</label><label class="inline"><input type="radio" name="reg" value="0"> 미등록</label><label class="inline"><input type="radio" name="reg" value=""> 전체</label></div>
  </form>
  <div class="fp-bar"><span class="fp-legend"><i class="fp-sw wait"></i>대기 <i class="fp-sw ok"></i>확정</span><span class="small muted" id="fpSum" role="status"></span><span class="grow"></span>
    ${canEdit ? '<button type="button" class="btn" id="fpAdd">추가</button>' : ''}<a class="btn" href="#/prod/finished">실적 입력 →</a></div>
  <div id="fpGrid"><p class="muted">불러오는 중…</p></div>`;
  const form = $('#fpTools', main); let boms = [], plans = [], rows = [];
  form.onsubmit = e => e.preventDefault();
  const days = () => { const [y, m] = form.elements.month.value.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const dateOf = d => `${form.elements.month.value}-${String(d).padStart(2, '0')}`;
  const keyOf = x => x.bom_id ? 'b' + x.bom_id : 'n' + partnerKey(x.product);
  const load = async () => {
    const mon = form.elements.month.value; if (!/^\d{4}-\d{2}$/.test(mon)) return;
    try { sessionStorage.setItem('wpa:fp-month', mon); } catch { /* 편의 기능 */ }
    const [b, p] = await Promise.all([boms.length ? boms : api('GET', '/api/boms?kind=finished'), api('GET', '/api/schedules?' + new URLSearchParams({ kind: 'finished', from: mon + '-01', to: dateOf(days()) }))]);
    if (!main.isConnected) return; boms = b; plans = p; draw();
  };
  const build = () => {
    const by = new Map();
    for (const b of boms.filter(b => b.item_category === '제품' && b.active !== 0)) by.set('b' + b.id, { key: 'b' + b.id, bom: b, product: b.product, code: b.product_code || '', cat1: b.cat1 || '', cat2: b.cat2 || '', cls: b.item_category, plans: [] });
    for (const s of plans) { const k = keyOf(s); if (!by.has(k)) by.set(k, { key: k, bom: boms.find(b => b.id === s.bom_id) || null, product: s.product, code: s.bom_snapshot?.product_code || '', cat1: s.bom_snapshot?.cat1 || '', cat2: s.bom_snapshot?.cat2 || '', cls: s.bom_snapshot?.item_category || '제품', plans: [] }); by.get(k).plans.push(s); }
    const q = form.elements.q.value.trim().toLowerCase(), reg = form.elements.reg.value;
    return [...by.values()].filter(r => (!q || `${r.code} ${r.product}`.toLowerCase().includes(q)) && (reg === '' || (reg === '1' ? r.plans.length > 0 : !r.plans.length)))
      .sort((x, y) => (x.cat1 || '~').localeCompare(y.cat1 || '~', 'ko') || (x.cat2 || '~').localeCompare(y.cat2 || '~', 'ko') || (x.code || '~').localeCompare(y.code || '~') || x.product.localeCompare(y.product, 'ko'));
  };
  const draw = () => {
    rows = build(); const n = days(), today = todayStr();
    const dow = d => new Date(dateOf(d) + 'T00:00:00').getDay();
    const all = rows.flatMap(r => r.plans), wait = all.filter(s => !s.confirmed_at);
    $('#fpSum', main).textContent = `품목 ${rows.length}개 · 계획 ${all.length}건(대기 ${wait.length} · 확정 ${all.length - wait.length}) · 계획수량 ${fmtNum(all.reduce((t, s) => t + s.qty, 0))}`;
    if (!rows.length) { $('#fpGrid', main).innerHTML = `<div class="empty">${form.elements.reg.value === '1' ? '이 달에 등록된 계획이 없습니다. 「미등록」·「전체」를 보거나 「추가」하세요.' : '조건에 맞는 완제품이 없습니다. 제품등록에서 분류 「제품」으로 등록하세요.'}</div>`; return; }
    const span = new Map(); rows.forEach(r => span.set(r.cat1, (span.get(r.cat1) || 0) + 1)); const seen = new Set();
    const head = `<tr><th class="fp-no">No.</th><th class="fp-m-hide">제품분류</th><th class="fp-m-hide">제품구분</th><th class="fp-m-hide">품목코드</th><th class="fp-name-h">품목명</th><th class="fp-m-hide">품목분류</th><th class="r fp-sum-h">계획수량</th>${Array.from({ length: n }, (_, i) => `<th class="fp-d${[0, 6].includes(dow(i + 1)) ? ' fp-we' : ''}${dateOf(i + 1) === today ? ' fp-today' : ''}">${i + 1}</th>`).join('')}</tr>`;
    const body = rows.map((r, i) => {
      const dayPlans = d => r.plans.filter(s => s.period === 'day' && s.start_date === dateOf(d)), other = r.plans.filter(s => s.period !== 'day');
      const first = !seen.has(r.cat1); seen.add(r.cat1);
      return `<tr data-fp-row="${i}"><td class="c fp-no">${i + 1}</td>${first ? `<td class="fp-cat fp-m-hide" rowspan="${span.get(r.cat1)}">${esc(r.cat1 || '(분류 없음)')}</td>` : ''}<td class="fp-m-hide">${esc(r.cat2)}</td><td class="nowrap fp-m-hide">${esc(r.code || '—')}</td><td class="fp-name">${esc(r.product)}<span class="fp-m-code">${esc(r.code || '')}</span></td><td class="fp-m-hide">${esc(r.cls)}</td>
        <td class="r fp-sum">${r.plans.length ? fmtNum(r.plans.reduce((t, s) => t + s.qty, 0)) : ''}${other.length ? `<div class="small muted">주·월 ${other.length}건</div>` : ''}</td>
        ${Array.from({ length: n }, (_, k) => { const ps = dayPlans(k + 1), q = ps.reduce((t, s) => t + s.qty, 0), st = !ps.length ? '' : ps.every(s => s.confirmed_at) ? ' ok' : ' wait';
          return `<td class="fp-cell${st}${[0, 6].includes(dow(k + 1)) ? ' fp-we' : ''}" data-fp-cell="${i}|${k + 1}" title="${esc(r.product)} ${dateOf(k + 1)}${ps.length ? ` · ${ps.every(s => s.confirmed_at) ? '확정' : '대기'}` : ''}">${ps.length ? fmtNum(q) : ''}</td>`; }).join('')}</tr>`;
    }).join('');
    $('#fpGrid', main).innerHTML = `<div class="table-wrap fp-wrap"><table class="grid keep-table fp-grid" data-no-sort data-no-filter data-keep-cols data-no-reorder><caption class="sr-only">${esc(form.elements.month.value)} 완제품 생산 계획</caption><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    $$('[data-fp-cell]', main).forEach(td => td.onclick = () => cellEdit(td.dataset.fpCell).catch(fail));
  };
  const cellEdit = async key => {
    if (!canEdit) return toast('계획 입력은 생산 담당자가 합니다.', 'err');
    const [ri, d] = key.split('|').map(Number), r = rows[ri], date = dateOf(d), ps = r.plans.filter(s => s.period === 'day' && s.start_date === date);
    const title = `${r.product} · ${date} (${'일월화수목금토'[new Date(date + 'T00:00:00').getDay()]})`;
    const setConfirm = async (on, list) => { try { const x = await api('POST', '/api/schedules/confirm', { ids: list.map(s => s.id), confirm: on }); toast(`${r.product} ${date} 계획을 ${on ? '확정' : '확정취소(대기)'}했습니다.${x.changed < list.length ? ` (${list.length - x.changed}건은 그대로)` : ''}`); } catch (error) { fail(error); } await load(); };
    // 15.230 확정된 칸: 한 건씩 확정취소(실적이 없을 때)
    if (ps.some(s => s.confirmed_at)) {
      const done = ps.filter(s => s.confirmed_at), used = done.filter(s => s.actual_qty > 0);
      const m = modal(`<h3>${esc(title)}</h3><p><span class="chip green">확정</span> 계획 ${fmtNum(done.reduce((t, s) => t + s.qty, 0))}${used.length ? ` · 실적 ${fmtNum(used.reduce((t, s) => t + s.actual_qty, 0))}` : ''}${done[0].confirmed_by ? ` <span class="small muted">확정 ${esc(done[0].confirmed_by)}</span>` : ''}</p>${used.length ? '<p class="small muted">실적이 있는 계획은 확정취소할 수 없습니다. 실적을 먼저 취소하세요.</p>' : '<p class="small muted">확정취소하면 대기로 돌아가고 수량을 고칠 수 있습니다.</p>'}<div class="actions"><button type="button" class="btn" data-x>닫기</button>${used.length ? '' : '<button type="button" class="btn danger" data-un>확정취소</button>'}</div>`);
      $('[data-x]', m.el).onclick = m.close;
      $('[data-un]', m.el)?.addEventListener('click', async () => { m.close(); await setConfirm(false, done); });
      return;
    }
    // 대기·빈 칸: 수량 넣기·고치기, 대기 칸은 「확정」 단추로 그 한 건 확정
    const v = await new Promise(resolve => {
      const m = modal(`<h3>${esc(title)}</h3><form class="stack" data-fp-form>${ps.length ? `<p><span class="chip yellow">대기</span>${ps.length > 1 ? ` <span class="small muted">이 날 대기 계획 ${ps.length}건 — 합쳐서 한 건으로 고칩니다.</span>` : ''}</p>` : ''}<label>계획 수량 <span class="hint">(비우거나 0이면 이 날 계획을 지웁니다)</span><input name="qty" type="number" min="0" step="any" inputmode="decimal" value="${ps.length ? ps.reduce((t, s) => t + s.qty, 0) : ''}" autofocus></label><label>비고<input name="note" maxlength="200" value="${esc(ps[0]?.note || '')}"></label>
        <div class="actions"><button type="button" class="btn" data-x>취소</button><button class="btn">${ps.length ? '저장(대기)' : '넣기(대기)'}</button>${ps.length ? '<button type="button" class="btn primary" data-ok>확정</button>' : ''}</div></form>`, { onClose: () => resolve(null) });
      const f = $('[data-fp-form]', m.el), val = confirm => { const o = formObj(f); resolve({ ...o, confirm }); m.close(); };
      $('[data-x]', m.el).onclick = m.close; f.onsubmit = e => { e.preventDefault(); val(false); };
      $('[data-ok]', m.el)?.addEventListener('click', () => val(true));
      setTimeout(() => f.elements.qty.focus(), 30);
    });
    if (!v) return;
    if (v.confirm && ps.length && Number(v.qty) === ps.reduce((t, s) => t + s.qty, 0) && (v.note || '') === (ps[0]?.note || '') && ps.length === 1) return setConfirm(true, ps);
    const qty = Number(v.qty) || 0;
    try {
      if (!qty) { for (const s of ps) await api('DELETE', '/api/schedules/' + s.id); if (ps.length) toast('계획을 지웠습니다.'); }
      else if (ps.length) { await api('PUT', '/api/schedules/' + ps[0].id, { period: 'day', start_date: date, qty, note: v.note, ...(ps[0].bom_id ? { bom_id: ps[0].bom_id } : { product: ps[0].product }) }); for (const s of ps.slice(1)) await api('DELETE', '/api/schedules/' + s.id); if (v.confirm) { await api('POST', '/api/schedules/confirm', { ids: [ps[0].id], confirm: true }); toast(`계획을 고치고 확정했습니다.`); } else toast('계획을 고쳤습니다(대기).'); }
      else { await api('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: date, qty, note: v.note, ...(r.bom ? { bom_id: r.bom.id } : { product: r.product }) }); toast('계획을 넣었습니다(대기).'); }
    } catch (error) { fail(error); }
    await load();
  };
  $('#fpAdd', main)?.addEventListener('click', async () => {
    const list = boms.filter(b => b.item_category === '제품' && b.active !== 0).sort((x, y) => (x.product_code || '~').localeCompare(y.product_code || '~'));
    const v = await promptBox('계획 추가', `<label>품목 *<select name="bom_id" required><option value="">품목 고르기</option>${list.map(b => `<option value="${b.id}">${esc(b.product_code || '—')} · ${esc(b.product)}</option>`).join('')}</select></label>
      <div class="form-grid"><label>날짜 *<input name="start_date" type="date" required value="${todayStr().startsWith(form.elements.month.value) ? todayStr() : form.elements.month.value + '-01'}"></label><label>계획 수량 *<input name="qty" type="number" min="0.0001" step="any" required></label></div><label>비고<input name="note" maxlength="200"></label>`);
    if (!v) return;
    try { await api('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: v.start_date, bom_id: Number(v.bom_id), qty: v.qty, note: v.note }); toast('계획을 넣었습니다(대기).'); if (!v.start_date.startsWith(form.elements.month.value)) form.elements.month.value = v.start_date.slice(0, 7); await load(); } catch (error) { fail(error); }
  });
  $$('[data-fp-move]', main).forEach(b => b.onclick = () => { const step = Number(b.dataset.fpMove); if (!step) form.elements.month.value = todayStr().slice(0, 7); else { const [y, m] = form.elements.month.value.split('-').map(Number); const d = new Date(y, m - 1 + step, 1); form.elements.month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; } load().catch(fail); });
  form.elements.month.addEventListener('change', () => load().catch(fail));
  let t = null; form.elements.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 150); });
  $$('[name=reg]', form).forEach(x => x.onchange = draw);
  await load();
}

// 15.283 반제품 공정이 없는 품목(부직포와이퍼 등: 자재 투입 → 바로 완제품 포장)은 반제품 LOT 대신 자재 LOT을 고른다. 15.289 화면 이름 봉투 LOT → 반제품 LOT
const faSemi = s => (s.bom_snapshot?.materials || []).some(m => m.item_category === '반제품');
async function faPickMats(s, qty, current) {
  const info = await api('GET', `/api/schedules/${s.id}/lot-materials`), mats = (info.materials || []).filter(m => m.item_category !== '반제품');
  if (!mats.length) { toast('BOM에 투입 자재가 없습니다. 제품등록(BOM)에서 자재를 넣으세요.', 'err'); return null; }
  const auto = new Map(); if (!current) for (const m of mats) { let need = Math.round(qty * m.per * 1000) / 1000; for (const l of m.lots.filter(l => l.balance > 0 && !l.qc_fail)) { if (need <= 0) break; const take = Math.min(need, l.balance); auto.set(m.item + '|' + l.lot, Math.round(take * 1000) / 1000); need = Math.round((need - take) * 1000) / 1000; } }
  const cur = new Map((current || []).map(x => [x.item + '|' + x.lot, x.qty])), val = k => cur.get(k) ?? auto.get(k) ?? '';
  let root = null;
  const body = mats.map((m, mi) => `<tbody class="fm-mat"><tr class="fm-h"><th colspan="4">${esc(m.item)} <span class="small muted">${qty ? `필요 ${fmtNum(Math.round(qty * m.per * 1000) / 1000)} ${esc(m.unit || '')} (양품 ${fmtNum(qty)} × BOM)` : `BOM ${fmtNum(m.per)} ${esc(m.unit || '')} / 1`}</span> <span class="small" data-fm-sum="${mi}"></span></th></tr>
    ${m.lots.length ? m.lots.map(l => `<tr class="${l.concession ? 'lot-tk-row' : ''}${l.qc_fail ? ' fm-fail' : ''}"><td class="nowrap"><b>${esc(l.lot)}</b>${l.concession ? ` ${LOT_TK}` : ''}${l.qc_fail ? ' <span class="chip red">불합격</span>' : ''}</td><td class="small muted">${esc(l.places || '')}</td><td class="r nowrap">${fmtNum(l.balance)} ${esc(l.unit || m.unit || '')}</td><td class="r"><input type="number" min="0" step="any" inputmode="decimal" data-fm="${mi}" data-item="${esc(m.item)}" data-lot="${esc(l.lot)}" data-unit="${esc(l.unit || m.unit || '')}" data-max="${l.balance}" value="${val(m.item + '|' + l.lot)}" ${l.qc_fail ? 'disabled' : ''} aria-label="${esc(m.item)} ${esc(l.lot)} 투입량"></td></tr>`).join('') : '<tr><td colspan="4" class="small muted">재고 LOT 없음</td></tr>'}</tbody>`).join('');
  const v = await promptBox(`투입 자재 LOT · ${s.product}`, `<p class="small muted">이 품목은 반제품 공정 없이 자재를 바로 포장합니다. 이번 포장에 넣은 자재 LOT과 양을 적으세요(양품수량을 먼저 넣으면 먼저 들어온 LOT부터 채워 둡니다). 고르지 않고 저장하면 자동으로 채웁니다.</p>
    <div class="table-wrap"><table class="grid keep-table fm-grid" data-no-sort data-no-filter data-keep-cols><thead><tr><th>LOT</th><th>위치</th><th class="r">남은 수량</th><th class="r">투입</th></tr></thead>${body}</table></div>`, { wide: true,
    onOpen: el => { root = el; const sum = () => mats.forEach((m, mi) => { const t = $$(`[data-fm="${mi}"]`, el).reduce((a, i) => a + (Number(i.value) || 0), 0), need = Math.round(qty * m.per * 1000) / 1000; const box = $(`[data-fm-sum="${mi}"]`, el); box.textContent = `· 투입 ${fmtNum(Math.round(t * 1000) / 1000)}`; box.className = 'small ' + (qty && Math.abs(t - need) > 0.0005 ? 'red-text' : 'green-text'); }); el.addEventListener('input', e => { const i = e.target.closest('[data-fm]'); if (i) i.setCustomValidity(Number(i.value) > Number(i.dataset.max) + 1e-6 ? `남은 수량 ${fmtNum(Number(i.dataset.max))}보다 많습니다.` : ''); sum(); }); sum(); },
    submit: async () => $$('[data-fm]', root).filter(i => Number(i.value) > 0).map(i => ({ item: i.dataset.item, unit: i.dataset.unit, lot: i.dataset.lot, qty: Number(i.value) })) });
  return v || null;
}
// ── 15.199 완제품 실적 입력: 생산일을 고르면 그날 확정 계획(계획수량·실적 누계·잔량)이 나오고, 양품수량을 넣어 저장한다.
// 완제품 LOT는 서버가 P+생산일-순번으로 붙이고, 투입 자재 LOT는 먼저 들어온 것부터 필요량만큼 채운다(「상세」에서 직접 고르기·이력·수정 요청).
async function pageFinishedActual(main) {
  const canEnter = hasRole('production');
  main.innerHTML = `<h1>완제품 실적 입력 <span class="dept">생산</span></h1>
  <div id="actualChanges"></div>
  <p class="muted">「완제품 계획생산 접수·관리」에서 <b>확정</b>한 계획이 나옵니다. 양품수량을 넣고 「저장」(여러 줄은 「입력한 줄 모두 저장」)하면 완제품 LOT(포장일_품목코드_P순번)가 붙습니다. 반제품을 쓰는 품목은 「반제품 LOT」으로 이날 포장한 세탁 완료 반제품을 고르면 반제품·원자재 LOT까지 이어집니다(생산 › LOT 연결 조회). 그 밖의 투입 자재 LOT는 먼저 들어온 것부터 자동으로 채웁니다. 자재 LOT를 직접 고르거나 지난 실적을 고치려면 「상세」.</p>
  <form class="toolbar fa-tools" id="faTools" data-read-only>
    <label>생산일<input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required></label>
    <div class="nav-date"><button type="button" class="btn small" data-fa-move="-1" aria-label="전날">◀</button><button type="button" class="btn small" data-fa-move="0">오늘</button><button type="button" class="btn small" data-fa-move="1" aria-label="다음 날">▶</button></div>
    <label>품목<input type="search" name="q" placeholder="품목코드/명" autocomplete="off"></label>
    <label class="inline"><input type="checkbox" name="late" checked> 지난 2주 미완료 계획 포함</label>
  </form>
  <div class="fp-bar"><span class="small muted" id="faSum" role="status"></span><span class="grow"></span><button type="button" class="btn qr-pdf-btn" id="faQr" title="이 생산일에 저장한 실적 LOT를 한 번에 QR코드로">이날 실적 QR 일괄 발행</button>${canEnter ? '<button type="button" class="btn primary" id="faSaveAll">입력한 줄 모두 저장</button>' : ''}<a class="btn" href="#/prod/finished/plan">계획생산 접수·관리 →</a></div>
  <div id="faList"><p class="muted">불러오는 중…</p></div>`;
  renderActualChanges($('#actualChanges', main), 'finished').catch(fail);
  const form = $('#faTools', main); let rows = [], wip = new Map(); // 15.255 작업중 포장(계획 id → 기록들)
  form.onsubmit = e => e.preventDefault();
  const end = s => s.period === 'day' ? s.start_date : s.period === 'week' ? addDays(s.start_date, 6) : monthEnd(s.start_date);
  const pdOf = s => { const date = form.elements.date.value, last = end(s); return date < s.start_date ? s.start_date : date > last ? last : date; };
  // 15.298 이날(생산일) 이미 저장한(작업완료) 실적: 있으면 줄 입력은 새로 더하지 않고 그 기록을 「수정」
  const dayRec = s => { let a = []; try { a = JSON.parse(s.actual_lots || '[]'); } catch { a = []; } return a.filter(x => x.date === pdOf(s) && x.st !== 'progress' && x.id).at(-1) || null; };
  const load = async () => {
    const date = form.elements.date.value; if (!date) return;
    const from = form.elements.late.checked ? addDays(date, -14) : date;
    const [list, prog] = await Promise.all([api('GET', '/api/schedules?' + new URLSearchParams({ kind: 'finished', from, to: date })), api('GET', '/api/actuals/progress').catch(() => ({ rows: [] }))]);
    if (!main.isConnected) return;
    wip = new Map(); for (const a of prog.rows || []) { if (!wip.has(a.schedule_id)) wip.set(a.schedule_id, []); wip.get(a.schedule_id).push(a); }
    const q = form.elements.q.value.trim().toLowerCase();
    rows = list.filter(s => s.confirmed_at && (!q || `${s.bom_snapshot?.product_code || ''} ${s.product}`.toLowerCase().includes(q)) && (s.start_date <= date && end(s) >= date || (!s.done && s.actual_qty < s.qty)))
      .sort((a, b) => (a.start_date === date) - (b.start_date === date) || a.start_date.localeCompare(b.start_date) || a.product.localeCompare(b.product, 'ko'));
    draw();
  };
  const draw = () => {
    const date = form.elements.date.value;
    $('#faSum', main).textContent = `확정 계획 ${rows.length}건 · 계획 ${fmtNum(rows.reduce((t, s) => t + s.qty, 0))} · 양품 ${fmtNum(rows.reduce((t, s) => t + s.actual_qty, 0))}`;
    if (!rows.length) { $('#faList', main).innerHTML = `<div class="empty">${esc(date)}에 확정된 완제품 계획이 없습니다. 「계획생산 접수·관리」에서 계획을 확정하세요.</div>`; return; }
    $('#faList', main).innerHTML = `<h2 class="fa-title">완제품 실적 리스트 <span class="small muted">${esc(date)}</span></h2><div class="table-wrap"><table class="grid keep-table fa-grid" data-no-sort data-no-filter data-keep-cols data-no-reorder><caption class="sr-only">${esc(date)} 완제품 실적 리스트</caption><thead><tr><th>No.</th><th>계획일</th><th>작업지시번호</th><th>품목코드</th><th>품목명</th><th>단위</th><th class="r">계획수량</th><th class="r">양품수량</th><th class="r">잔량</th><th class="r">양품수량 입력</th><th>비고</th><th><span class="sr-only">작업</span></th></tr></thead><tbody>${rows.map((s, i) => { const left = Math.round((s.qty - s.actual_qty) * 1000) / 1000, unit = s.unit || s.bom_snapshot?.unit || '', wos = (s.work_orders || '').split(',').filter(Boolean);
      return `<tr data-fa-row="${i}" class="${s.done || left <= 0 ? 'fa-done' : s.start_date < date ? 'fa-late' : ''}"><td class="c">${i + 1}</td><td class="nowrap">${s.period === 'day' ? esc(s.start_date.slice(5)) : `${PERIOD[s.period]} ${esc(s.start_date.slice(5))}~`}${s.start_date < date && s.period === 'day' ? ' <span class="chip yellow">지난 계획</span>' : ''}</td><td class="nowrap wo-cell">${wos.length ? wos.map(w => `<div><button type="button" class="link-btn" data-wo-qr="${esc(w)}" data-wo-sub="${esc(`${s.product} · 계획 ${s.start_date}`)}" title="QR코드 발행">${esc(w)}</button></div>`).join('') : '<span class="small muted" title="양품수량을 저장하면 실적 날짜로 번호가 붙습니다">저장 시 부여</span>'}</td>
        <td class="nowrap">${esc(s.bom_snapshot?.product_code || '—')}</td><td><b>${esc(s.product)}</b>${s.spec ? ` <span class="small muted">${esc(s.spec)}</span>` : ''}</td><td>${esc(unit)}</td>
        <td class="r">${fmtNum(s.qty)}</td><td class="r">${fmtNum(s.actual_qty)}</td><td class="r ${left <= 0 || s.done ? 'green-text' : ''}"><b>${left <= 0 ? '완료' : s.done ? '완료' : fmtNum(left)}</b>${s.done && left > 0 ? `<div class="small muted">부족 ${fmtNum(left)}</div>` : ''}</td>
        <td class="r">${(rec => `<input type="number" min="0" step="any" inputmode="decimal" data-fa-qty${rec && !(wip.get(s.id) || []).length ? ` value="${rec.qty}" data-fa-cur="${rec.qty}"` : ''} placeholder="${left > 0 ? fmtNum(left) : ''}" aria-label="${esc(s.product)} 양품수량"${canEnter ? '' : ' disabled'}>${rec && !(wip.get(s.id) || []).length ? `<div class="small muted fa-rec">이날 저장 <b>${esc(rec.wo || rec.lot)}</b> ${fmtNum(rec.qty)} · 고치면 「수정」</div>` : ''}`)(dayRec(s))}${(wip.get(s.id) || []).map(a => `<div class="small"><span class="chip yellow">작업중</span> <b>${esc(a.lot)}</b> <span class="muted">반제품 ${a.bags.length}개 · 수량을 넣고 저장하면 작업완료</span></div>`).join('')}</td>
        <td><input data-fa-note maxlength="200" aria-label="${esc(s.product)} 비고"${canEnter ? '' : ' disabled'}></td>
        <td class="nowrap">${canEnter ? `${faSemi(s) ? '<button type="button" class="btn small" data-fa-bags title="이날 포장에 쓴 반제품 LOT">반제품 LOT <b data-fa-bagn>0</b></button>' : '<button type="button" class="btn small" data-fa-mats title="이 포장에 투입한 자재 LOT(반제품 공정 없음). 안 고르면 먼저 들어온 LOT부터 자동">자재 LOT <b data-fa-matn>자동</b></button>'}` + ' <button type="button" class="btn small" data-fa-wip title="완제품 LOT을 먼저 받습니다. 수량은 나중에 넣고 저장하면 작업완료">작업중</button> ' + (dayRec(s) && !(wip.get(s.id) || []).length ? '<button type="button" class="btn small primary" data-fa-save data-fa-edit title="이날 저장한 실적의 양품수량을 고칩니다(생산팀장 승인 · 팀장은 바로 반영)">수정</button> <button type="button" class="btn small" data-fa-add title="같은 날 작업을 한 번 더 했을 때만: 새 실적(새 LOT)으로 더합니다">＋ 추가</button> ' : '<button type="button" class="btn small primary" data-fa-save>저장</button> ') : ''}${canEnter ? (s.done ? '<button type="button" class="btn small" data-fa-close title="완료 처리를 취소하고 다시 실적을 넣습니다">완료 취소</button> ' : left > 0 ? '<button type="button" class="btn small" data-fa-close title="계획보다 덜 만들어도 이 계획을 완료로 닫습니다(넣은 양품수량이 있으면 먼저 저장)">완료 처리</button> ' : '') : ''}<button type="button" class="btn small" data-fa-detail>상세</button></td></tr>`; }).join('')}</tbody></table></div>`;
    $$('[data-fa-row]', main).forEach(tr => { const s = rows[Number(tr.dataset.faRow)];
      $('[data-fa-detail]', tr).onclick = () => openProductionActuals(s.id, { onChange: () => load() }).catch(fail);
      $('[data-fa-close]', tr)?.addEventListener('click', async e => { const btn = e.currentTarget; btn.disabled = true; try { if (await closePlan(s, tr)) await load(); } finally { btn.disabled = false; } });
      tr._mats = null; $('[data-fa-mats]', tr)?.addEventListener('click', async () => { const picked = await faPickMats(s, Number($('[data-fa-qty]', tr).value) || 0, tr._mats).catch(e => { fail(e); return null; }); if (!picked) return; tr._mats = picked.length ? picked : null; $('[data-fa-matn]', tr).textContent = picked.length ? `${picked.length}` : '자동'; $('[data-fa-mats]', tr).classList.toggle('on', picked.length > 0); }); // 15.283
      tr._bags = []; $('[data-fa-bags]', tr)?.addEventListener('click', async () => { const picked = await packPickBags(s, tr._bags).catch(e => { fail(e); return null; }); if (!picked) return; tr._bags = picked; $('[data-fa-bagn]', tr).textContent = picked.length; $('[data-fa-bags]', tr).classList.toggle('on', picked.length > 0); const ex = packExpected(s, picked.sheets || 0); $('[data-fa-qty]', tr).placeholder = ex.expected != null ? `예상 ${fmtNum(ex.expected)}` : $('[data-fa-qty]', tr).placeholder; $('[data-fa-bags]', tr).title = packExpectedText(s, picked); toast(packExpectedText(s, picked) || '반제품을 골랐습니다.'); $('[data-fa-qty]', tr).focus(); }); // 15.249 · 15.254 예상 생산량
      const q = $('[data-fa-qty]', tr); q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-fa-save]', tr)?.click(); } });
      $('[data-fa-save]', tr)?.addEventListener('click', async e => { const btn = e.currentTarget; btn.disabled = true; try { if (await save(s, tr)) await load(); } finally { btn.disabled = false; } });
      $('[data-fa-add]', tr)?.addEventListener('click', e => { tr._add = true; const q2 = $('[data-fa-qty]', tr); q2.value = ''; delete q2.dataset.faCur; $('.fa-rec', tr)?.remove(); const sb = $('[data-fa-save]', tr); sb.textContent = '저장'; delete sb.dataset.faEdit; e.currentTarget.remove(); q2.focus(); toast('새 실적으로 더합니다. 양품수량을 넣고 「저장」하세요.'); });
      $('[data-fa-wip]', tr)?.addEventListener('click', async e => { const btn = e.currentTarget; btn.disabled = true; try { if (await saveWip(s, tr)) await load(); } finally { btn.disabled = false; } }); });
  };
  // 투입 자재 LOT: 먼저 들어온 LOT부터 필요량만큼(상세 창의 자동 채우기와 같은 방식). 모자라면 물어 본다.
  const lotInputs = async (s, qty) => {
    const info = await api('GET', `/api/schedules/${s.id}/lot-materials`).catch(() => null), out = [], short = [];
    for (const m of (info?.materials || []).filter(m => m.item_category !== '반제품')) { let need = Math.round(qty * m.per * 1000) / 1000; for (const l of m.lots.filter(l => l.balance > 0 && !l.qc_fail)) { if (need <= 0) break; const take = Math.min(need, l.balance); out.push({ item: m.item, unit: m.unit, lot: l.lot, qty: Math.round(take * 1000) / 1000 }); need = Math.round((need - take) * 1000) / 1000; } if (need > 0) short.push(`${m.item} ${fmtNum(need)}${m.unit}`); }
    return { out, short };
  };
  const save = async (s, tr, quiet = false) => {
    const qty = Number($('[data-fa-qty]', tr).value); if (!(qty > 0)) { if (!quiet) { $('[data-fa-qty]', tr).focus(); toast('양품수량을 넣으세요.', 'err'); } return false; }
    const date = form.elements.date.value, last = end(s), pd = date < s.start_date ? s.start_date : date > last ? last : date;
    const hasSemi = (s.bom_snapshot?.materials || []).some(m => m.item_category === '반제품'), open = (wip.get(s.id) || [])[0];
    if (open) { // 15.255 작업중 포장을 작업완료
      const { out, short } = tr._mats ? { out: tr._mats, short: [] } : await lotInputs(s, qty); // 15.283 고른 자재 LOT
      if (short.length && !await confirmBox(`${s.product}: 투입 자재 LOT 재고가 모자랍니다(${short.join(', ')}). 있는 만큼만 넣고 저장할까요?`)) return false;
      try { const r = await api('POST', `/api/actuals/${open.id}/complete`, { qty, note: $('[data-fa-note]', tr).value, inputs: out, bags: tr._bags || [] }); toast(`${s.product} 작업완료 · 양품 ${fmtNum(qty)} · LOT ${r.lot}`); return true; } catch (error) { fail(error); return false; }
    }
    const rec = !tr._add && dayRec(s);
    if (rec) { // 15.298 이날 저장한 실적이 있으면 새로 더하지 않고 수정
      if (qty === Number(rec.qty)) { if (!quiet) toast('양품수량이 그대로입니다. 고친 뒤 「수정」하세요. 같은 날 한 번 더 만들었으면 「＋ 추가」.', 'err'); return false; }
      const approver = ME.is_admin || ME.roles.includes('production_approver');
      const v = await promptBox(`실적 수정 · ${s.product}`, `<p>${esc(rec.wo || rec.lot)} 양품 <b>${fmtNum(rec.qty)}</b> → <b>${fmtNum(qty)}</b></p><p class="small muted">${approver ? '생산팀장·관리자라 바로 반영됩니다.' : '생산팀장이 승인하면 반영됩니다(그 전까지는 그대로).'} 같은 날 작업을 한 번 더 한 것이면 취소하고 「＋ 추가」를 누르세요.</p><label>수정 사유 *<input name="reason" required maxlength="500" placeholder="예) 수량 오입력"></label>`);
      if (!v) return false;
      try {
        const r = await api('POST', `/api/schedules/${s.id}/actuals/${rec.id}/changes`, { qty, reason: v.reason, request_id: crypto.randomUUID() });
        if (approver && r.change?.id) { await api('POST', `/api/actual-changes/${r.change.id}/approve`, { note: '완제품 실적 입력에서 바로 수정' }); toast(`${s.product} 양품 ${fmtNum(rec.qty)} → ${fmtNum(qty)} 수정했습니다.`); }
        else toast(`${s.product} 수정 요청을 올렸습니다(${fmtNum(rec.qty)} → ${fmtNum(qty)}). 생산팀장 승인 뒤 반영됩니다.`);
        return true;
      } catch (error) { fail(error); return false; }
    }
    if (hasSemi && !(tr._bags || []).length && !await confirmBox(`${s.product}: 포장에 쓴 반제품 LOT을 고르지 않았습니다. 고르지 않으면 이 완제품 LOT에서 반제품·원자재 LOT으로 거슬러 볼 수 없습니다. 그래도 저장할까요?`)) { $('[data-fa-bags]', tr)?.focus(); return false; }
    const { out, short } = tr._mats ? { out: tr._mats, short: [] } : await lotInputs(s, qty); // 15.283 고른 자재 LOT
    if (short.length && !await confirmBox(`${s.product}: 투입 자재 LOT 재고가 모자랍니다(${short.join(', ')}). 있는 만큼만 넣고 저장할까요?`)) return false;
    try {
      const r = await api('POST', `/api/schedules/${s.id}/actuals`, { production_date: pd, qty, note: $('[data-fa-note]', tr).value, inputs: out, bags: tr._bags || [], request_id: crypto.randomUUID() });
      toast(`${s.product} 양품 ${fmtNum(qty)} 저장 · ${r.work_order || ''} · LOT ${r.lot || '—'}${pd !== date ? ` (생산일 ${pd})` : ''}`); return true;
    } catch (error) { fail(error); return false; }
  };
  // 15.279 완료 처리: 계획보다 덜 만들어도 닫는다(넣은 양품수량이 있으면 먼저 저장). 닫힌 계획은 「완료 취소」로 다시 연다.
  const closePlan = async (s, tr) => {
    if (s.done) { if (!await confirmBox(`${s.product}: 완료 처리를 취소하고 다시 실적을 넣을 수 있게 할까요?`)) return false; try { await api('PUT', `/api/schedules/${s.id}`, { set_done: 0 }); toast('완료를 취소했습니다.'); return true; } catch (error) { fail(error); return false; } }
    const typed = Number($('[data-fa-qty]', tr).value) || 0, made = s.actual_qty + typed, short = Math.round((s.qty - made) * 1000) / 1000;
    if (!(made > 0) && !await confirmBox(`${s.product}: 실적이 하나도 없습니다. 그래도 이 계획을 완료로 닫을까요?`)) return false;
    const reason = short > 0 ? await promptBox(`완료 처리 · ${s.product}`, `<p>계획 <b>${fmtNum(s.qty)}</b> 중 <b>${fmtNum(made)}</b>${typed ? ` (지금 넣은 ${fmtNum(typed)} 포함)` : ''}만 생산했습니다. 부족 <b class="red-text">${fmtNum(short)}</b>을 남기고 이 계획을 <b>완료</b>로 닫습니다.</p><label>사유 (선택)<input name="reason" maxlength="300" placeholder="예) 원단 부족, 고객 요청 수량 변경"></label>`) : { reason: '' };
    if (!reason) return false;
    if (typed > 0 && !await save(s, tr)) return false;
    try { await api('PUT', `/api/schedules/${s.id}`, { set_done: 1, reason: reason.reason || '' }); toast(`${s.product} 완료 처리${short > 0 ? ` (부족 ${fmtNum(short)})` : ''}`); return true; } catch (error) { fail(error); return false; }
  };
  // 15.255 작업중으로 저장: 반제품 LOT만 고르고 완제품 LOT을 먼저 받는다(수량은 나중에)
  const saveWip = async (s, tr) => {
    if ((wip.get(s.id) || []).length) { $('[data-fa-qty]', tr).focus(); toast('이미 작업중인 포장이 있습니다. 수량을 넣고 「저장」하면 작업완료됩니다.', 'err'); return false; }
    if (faSemi(s) && !(tr._bags || []).length) { $('[data-fa-bags]', tr)?.focus(); toast('작업중으로 저장하려면 「반제품 LOT」으로 포장할 반제품을 먼저 고르세요.', 'err'); return false; } // 15.283 반제품 없는 품목은 반제품 없이
    const date = form.elements.date.value, last = end(s), pd = date < s.start_date ? s.start_date : date > last ? last : date;
    try { const r = await api('POST', `/api/schedules/${s.id}/actuals`, { production_date: pd, qty: '', work_status: 'progress', note: $('[data-fa-note]', tr).value, bags: tr._bags, request_id: crypto.randomUUID() }); toast(`${s.product} 작업중 저장 · LOT ${r.lot}. 수량을 넣고 「저장」하면 작업완료됩니다.`); return true; } catch (error) { fail(error); return false; }
  };
  // 15.230 이날 저장한 실적 LOT(제품 LOT)를 한 번에 QR코드 발행
  $('#faQr', main).onclick = () => {
    const date = form.elements.date.value, list = [];
    for (const s of rows) { let a = []; try { a = JSON.parse(s.actual_lots || '[]'); } catch { a = []; } for (const x of a) if (x.date === date && x.lot) list.push({ code: x.lot, sub: [s.product, `${fmtNum(x.qty)} ${s.unit || s.bom_snapshot?.unit || ''}`.trim(), x.wo, x.date].filter(Boolean).join(' · ') }); }
    if (!list.length) return toast(`${date}에 저장한 실적 LOT가 없습니다.`, 'err');
    qrIssue(list, { title: `QR코드 발행 · ${date} 생산완료`, file: '생산LOT' });
  };
  $('#faSaveAll', main)?.addEventListener('click', async e => {
    const todo = $$('[data-fa-row]', main).filter(tr => { const q = $('[data-fa-qty]', tr); return Number(q.value) > 0 && (q.dataset.faCur === undefined || Number(q.value) !== Number(q.dataset.faCur)); }); // 15.298 이날 기록 값 그대로인 줄은 빼기 if (!todo.length) return toast('양품수량을 넣은 줄이 없습니다.', 'err');
    e.currentTarget.disabled = true; let ok = 0;
    for (const tr of todo) if (await save(rows[Number(tr.dataset.faRow)], tr, true)) ok++;
    e.currentTarget.disabled = false; toast(`${ok}/${todo.length}줄을 저장했습니다.`); await load();
  });
  $$('[data-fa-move]', main).forEach(b => b.onclick = () => { const step = Number(b.dataset.faMove), d = step ? addDays(form.elements.date.value, step) : todayStr(); form.elements.date.value = d > todayStr() ? todayStr() : d; load().catch(fail); });
  form.elements.date.addEventListener('change', () => load().catch(fail)); form.elements.late.addEventListener('change', () => load().catch(fail));
  let t = null; form.elements.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 200); });
  await load();
}
