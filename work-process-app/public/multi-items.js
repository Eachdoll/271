// Shared multi-item input; each line remains independently trackable after saving.
function lineEntity(row) {
  return row.type ? 'request' : row.req_no !== undefined ? 'purchase_order' : row.ship_date ? 'shipment' : row.received_date ? 'other_receipt' : row.in_date ? 'laundry' : row.product !== undefined && row.period ? 'schedule' : '';
}
function lineInfo(row) {
  const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : row.data || {};
  const snapshot = typeof row.bom_snapshot === 'string' ? JSON.parse(row.bom_snapshot || '{}') : row.bom_snapshot || {};
  const unit = row.unit || data.unit || snapshot.unit || '';
  const code = row.product_code ? (/^TMP-/.test(row.product_code) ? '임시코드 ' : '') + row.product_code : '';
  const parts = [code, row.spec || data.spec, unit, row.lot || data.lot_etc || (row.type === 'voc' ? data.lot : '')].filter(Boolean);
  if (row.type && row.type !== 'voc' && (row.qty ?? data.qty) != null) parts.push('수량 ' + fmtNum(row.qty ?? data.qty));
  if (row.batch_id) parts.push('묶음 ' + row.batch_id.slice(-8));
  const entity = lineEntity(row);
  return `<span class="small muted line-info">${parts.map(esc).join(' · ')} ${entity ? `<button type="button" class="btn small" data-line-meta="${esc(entity)}" data-line-id="${row.id}" data-line-spec="${esc(row.spec)}" data-line-unit="${esc(unit)}" data-line-lot="${esc(row.lot || data.lot_etc || (row.type === 'voc' ? data.lot : ''))}" data-line-name="${esc(row.item)}">규격·단위</button>` : ''}</span>`;
}
function scheduleFocusDate() { try { const date = sessionStorage.getItem('newScheduleDate'); sessionStorage.removeItem('newScheduleDate'); return date || todayStr(); } catch { return todayStr(); } }
function rememberScheduleDate(date) { try { sessionStorage.setItem('newScheduleDate',date); const key = uxKey('calendar', location.hash || '#/'); uxWrite(key, { ...(uxRead(key) || { view: 'week' }), base: date }); } catch {} }
function multiInput(name, label, type = 'text', value = '', required = true) {
  return `<label>${label}${required ? ' *' : ''}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}></label>`;
}
function multiPayload(form, entity, type, kind, requestId) {
  const common = entity === 'request' ? collectRequest(type,form) : formObj(form);
  if (entity === 'schedule') common.kind = kind;
  const items = $$('[data-multi-row]',form).map(row => Object.fromEntries($$('[data-line-key]',row).map(input => [input.dataset.lineKey,input.type === 'checkbox' ? input.checked : input.value])));
  return { common, items, request_id: requestId };
}
async function installMultiItems(legacy, entity, type = '') {
  if (legacy.dataset.multiInstalled) return;
  legacy.dataset.multiInstalled = 'true';
  const kind = location.hash.includes('/semi') ? 'semi' : 'finished';
  const titles = { purchase_order: '발주', shipment: '출하', laundry: '세탁', other_receipt: '기타입고', schedule: '생산계획', request: (REQ[type]?.label || '') + ' 접수' };
  let header = '';
  if (entity === 'purchase_order') header = multiInput('req_no','구매의뢰번호') + multiInput('vendor','거래처') + multiInput('due_date','납기일','date');
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
  const optionHtml = () => `<option value="">${entity === 'schedule' ? '직접 입력 (BOM 선택 가능)' : freeEntry ? '직접 입력 (임시 제품코드 부여)' : 'BOM 품목을 선택하세요'}</option>${boms.filter(b => entity !== 'schedule' || (b.kind === kind && !b.is_temp)).map(b => `<option value="${b.id}">[${esc(b.item_category || '미분류')}] ${esc(b.product)} ${esc(b.product_code)}${b.is_temp ? ' (임시)' : ''}</option>`).join('')}`;
  const add = () => {
    if ($$('[data-multi-row]',form).length >= 30) return;
    const row = document.createElement('fieldset'); row.dataset.multiRow = ''; row.className = 'multi-row';
    row.innerHTML = `<legend>품목</legend><div class="form-grid">${picker ? `<label>${freeEntry ? '품목 검색' : 'BOM 검색'}<input type="search" data-bom-search placeholder="품목·코드 검색"></label><label class="span2">${freeEntry ? '제품코드로 불러오기' : 'BOM 품목'}<select data-line-key="bom_id" ${entity === 'other_receipt' ? 'required' : ''}>${optionHtml()}</select></label>` : ''}<label>${entity === 'laundry' ? '옷 종류 (원피스·투피스 등)' : '품목명 / 제품명'} *<input data-line-key="item" required ${entity === 'other_receipt' ? 'readonly' : ''} ${entity === 'schedule' && kind === 'semi' ? 'list="semiPlanItems"' : ''} maxlength="200"></label><label>규격·사이즈<input data-line-key="spec" maxlength="100" placeholder="예) S / M / L"></label><label>${entity === 'laundry' ? '입고' : entity === 'schedule' ? '계획' : ''}수량 *<input data-line-key="qty" type="number" min="0" step="any" required></label><label>단위<input data-line-key="unit" maxlength="20" placeholder="예) EA / BOX / 벌" ${entity === 'other_receipt' ? 'readonly' : ''}></label><label>LOT <span class="hint">(선택${entity === 'purchase_order' ? ' · 모르면 비워 두고 입고 후 입력' : ''})</span><input data-line-key="lot" maxlength="100"></label>${entity === 'purchase_order' ? `<label>분류 *<select data-line-key="item_category" required>${categoryOptions('',true).replace('전체 분류','분류 선택')}</select></label><label class="inline"><input data-line-key="coa_requested" type="checkbox">COA 요청</label>` : ''}${entity === 'laundry' ? '<label>폐기수량 *<input data-line-key="discard_qty" type="number" min="0" step="any" value="0" required></label>' : ''}${type === 'development' ? '<label>타겟단가 *<input data-line-key="target_price" required></label>' : ''}</div><div class="actions"><button type="button" class="btn small danger" data-remove-item>품목 삭제</button></div>`;
    rowsRoot.append(row);
    $('[data-remove-item]',row).onclick = () => { if ($$('[data-multi-row]',form).length === 1) return toast('품목은 1개 이상 필요합니다.','err'); row.remove(); updateCount(); };
    const select = $('[data-line-key=bom_id]',row);
    if (select) {
      select.onchange = () => {
        const bom = boms.find(b => b.id === Number(select.value));
        $('[data-line-key=item]',row).readOnly = !!bom || entity === 'other_receipt'; $('[data-line-key=unit]',row).readOnly = !!bom || entity === 'other_receipt';
        if (bom) { $('[data-line-key=item]',row).value = bom.product; $('[data-line-key=unit]',row).value = bom.unit; }
        const category = $('[data-line-key=item_category]',row);
        if (bom && category && [...category.options].some(option => option.value === bom.item_category)) category.value = bom.item_category;
      };
      $('[data-bom-search]',row).oninput = event => { const q = event.target.value.toLocaleLowerCase(); [...select.options].forEach(option => { option.hidden = !!option.value && !option.textContent.toLocaleLowerCase().includes(q); }); };
    }
    updateCount(); return row;
  };
  add(); $('[data-add-item]',form).onclick = add;
  const partner = $('[name=vendor],[name=customer]',form);
  if (partner) bindPartnerPicker(partner, $('[data-partner-hint]',form), { recent: entity === 'purchase_order', onPick: item => {
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
      toast(`${saved.rows.length}품목을 등록했습니다. 묶음 ${saved.batch_id.slice(-8)}`);
      if (entity === 'schedule') rememberScheduleDate(payload.common.start_date);
      await render();
      const prefix = {shipment:'sh',other_receipt:'other',laundry:'ln'}[entity]; const date = payload.common.ship_date || payload.common.received_date || payload.common.in_date;
      if (prefix && date && $('#' + prefix + 'Filters')) { $('#' + prefix + 'From').value = date; $('#' + prefix + 'To').value = date; $('#' + prefix + 'Filters').requestSubmit(); }
    } catch(error) { if (!saved) entryDraft.failure(); else entryDraft.clear('품목은 저장되었습니다 · 다시 등록하지 말고 사진만 재시도하세요.'); status.textContent = saved ? `${saved.rows.length}품목은 이미 저장되었습니다(아래 목록에 표시). 다시 등록하지 말고 사진만 재시도하세요. 사진 저장 실패: ${error.message}` : error.message; fail(error); }
    finally { busy = false; form.inert = false; submit.disabled = false; updateCount(); }
  };
}
function enhanceMultiForms() {
  if (!ME) return;
  const configs = [['#poNew','purchase_order'],['#shNew','shipment'],['#otherNew','other_receipt'],['#lnNew','laundry'],['#scNew','schedule']];
  for (const [selector,entity] of configs) { const form = $(selector); if (form && !form.dataset.multiInstalled) installMultiItems(form,entity).catch(fail); }
  const form = $('#reqNewBox .req-form');
  if (form && !form.dataset.multiInstalled) {
    const type = location.hash.includes('/purchase/sample') ? 'sample_goods' : location.hash.includes('/voc/') ? 'voc' : location.hash.includes('/quality/') ? 'analysis' : location.hash.includes('/dev/') ? 'development' : 'sample';
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

async function openProductionActuals(id) {
  const box = modal('<h3>생산실적 · 실제 생산량</h3><div data-actual-content>불러오는 중…</div>',{wide:true});
  let requestId = crypto.randomUUID(), history = [], next = null, busy = false;
  const load = async (previous = false) => {
    const result = await api('GET',`/api/schedules/${id}/actuals` + (previous ? '?before=' + next : ''));
    if (!box.el.isConnected) return;
    history = previous ? history.concat(result.rows) : result.rows; next = result.next;
    const s = result.schedule; const unit = s.unit || s.bom_snapshot?.unit || '단위 미지정';
    const last = s.period === 'day' ? s.start_date : s.period === 'week' ? addDays(s.start_date,6) : monthEnd(s.start_date);
    const date = todayStr() < s.start_date || todayStr() > last ? s.start_date : todayStr();
    $('[data-actual-content]',box.el).innerHTML = `<h4>${esc(s.product)} ${esc(s.spec)} · ${esc(unit)}</h4><p>계획 ${fmtNum(s.qty)} / 실제 누적 <b>${fmtNum(result.actual_qty)}</b> / 차이 ${fmtNum(result.variance_qty)} / 달성률 ${result.achievement_rate ?? '—'}%</p><p class="small muted">${esc(s.start_date)} ~ ${esc(last)} · ${result.auto ? '반제품 실적은 <a href="#/prod/semi/cut">반제품 · 커팅/융착</a> 기록에서 자동으로 집계됩니다(같은 품목명, 계획에 사이즈가 있으면 같은 사이즈, 계획 기간 안의 작업일). 여기에는 입력하지 않습니다.' : '완료 체크와 별도로 실제 생산한 수량만 입력하세요. 같은 생산실적을 여러 일정에 중복 입력하지 마세요.'}</p>${result.auto ? `<div class="table-wrap"><table class="grid"><thead><tr><th>작업일</th><th>라인</th><th>사이즈·규격</th><th class="r">양품</th><th class="r">불량</th><th>입력자</th></tr></thead><tbody>${result.cut_rows.map(c => `<tr><td>${esc(c.work_date)}</td><td>${esc(c.unit_name)}</td><td>${esc(c.spec)}</td><td class="r"><b>${fmtNum(c.qty)}</b> ${esc(c.unit)}</td><td class="r">${fmtNum(c.defect_qty)}</td><td class="small muted">${esc(c.created_by)}</td></tr>`).join('') || '<tr><td colspan="6">이 계획에 해당하는 커팅/융착 기록이 아직 없습니다.</td></tr>'}</tbody></table></div>${history.length ? '<h4>이전에 직접 입력한 실적</h4>' : ''}` : ''}${result.auto && !history.length ? '' : result.can_write ? `<form class="stack" data-actual-form><div class="form-grid">${multiInput('production_date','생산일','date',date)}<label>실제 생산량 *<input name="qty" type="number" min="0" step="any" required></label>${multiInput('note','작업·변동 메모','text','',false)}</div><p role="status" data-actual-status class="small muted"></p><div class="actions"><button class="btn primary">생산실적 추가</button></div></form>` : result.auto ? '' : '<p class="muted">생산 담당자 또는 일정 등록자가 실적을 입력할 수 있습니다.</p>'}${result.auto && !history.length ? '' : `<div class="table-wrap"><table class="grid"><thead><tr><th>생산일</th><th>실제 수량</th><th>입력자 / 입력시각</th><th>메모</th><th></th></tr></thead><tbody>${history.map(a => `<tr><td>${esc(a.production_date)}</td><td>${fmtNum(a.qty)}${a.voided_at ? ' (취소)' : ''}${a.corrected_at ? `<div class="small muted">수정됨 · 승인 ${esc(a.corrected_by)}</div>` : ''}</td><td>${esc(a.author_name)}<br>${esc(a.created_at)}</td><td>${esc(a.note)}${a.voided_at ? `<br>취소: ${esc(a.voided_by)} · ${esc(a.void_reason)}` : ''}</td><td>${a.voided_at ? '' : a.pending_change ? `<span class="chip yellow">승인 대기</span><div class="small">${changeSummary(a.pending_change)}<br>사유: ${esc(a.pending_change.reason)} · ${esc(a.pending_change.requested_by)}</div>${changeActions(a.pending_change, result.can_approve)}` : result.can_write ? `<button class="btn small" data-actual-edit="${a.id}">수정 요청</button> <button class="btn small danger" data-actual-void="${a.id}">취소 요청</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">아직 입력한 생산실적이 없습니다.</td></tr>'}</tbody></table></div>`}${next ? '<button class="btn small" data-actual-more>이전 실적 더 보기</button>' : ''}<p class="small muted">입력된 실적의 수정·취소는 요청 후 <b>생산팀장 승인</b> 시 반영됩니다. 지난 기간의 실적도 요청할 수 있습니다.</p>${changeHistory(result.changes)}`;
    const form = $('[data-actual-form]',box.el);
    if (form) { form.elements.production_date.min = s.start_date; form.elements.production_date.max = last < todayStr() ? last : todayStr(); }
    if (form) form.onsubmit = async event => {
      event.preventDefault(); if (busy) return; busy = true; const button = $('button',form); button.disabled = true;
      let stored = false;
      try { await api('POST',`/api/schedules/${id}/actuals`,{ ...formObj(form),request_id:requestId }); stored = true; form.reset(); requestId = crypto.randomUUID(); await load(); render(); toast('생산실적을 기록했습니다.'); }
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
    const more = $('[data-actual-more]',box.el); if (more) more.onclick = () => load(true).catch(fail);
  };
  await load();
}
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
