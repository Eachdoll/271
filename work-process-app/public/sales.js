// 영업 › 구매의뢰 (15.48). 작성자가 결재선(결재 → 합의, 참조)을 지정해 상신하고, 차례인 사람이 승인·반려한다.
// 최종 승인되면 구매 담당자가 「발주 생성」으로 발주목록에 올린다. 서버 규칙은 worker.mjs의 「영업: 구매의뢰」를 따른다.
const PR_STATUS = { pending: '결재 중', approved: '최종 승인', rejected: '반려' };
const PR_STATUS_CHIP = { pending: 'yellow', approved: 'green', rejected: 'red' };
const PR_GROUP = { approve: '결재', agree: '합의', cc: '참조' };
const prMoney = n => n == null || n === '' ? '' : fmtNum(Math.round(Number(n)));
const prProfit = (sale, buy) => sale ? `${prMoney(sale - buy)} (${Math.round((sale - buy) / sale * 1000) / 10}%)` : '—';
let prOpenAfterLoad = null;

async function prDirectory() { return api('GET', '/api/directory'); }
function prPerson(u) { return `${esc(u.name)}${u.position ? ` <span class="muted">${esc(u.position)}</span>` : ''}`; }

// ── 작성·수정 양식 ──
function prItemRow(it = {}) {
  const v = key => esc(it[key] ?? '');
  return `<fieldset class="pr-item"><legend></legend><input type="hidden" data-k="bom_id" value="${v('bom_id')}">
    <div class="form-grid">
      <label class="span2">품목명 *<input data-k="item" required maxlength="200" list="prCatalogList" value="${v('item')}" placeholder="등록된 품목을 검색하거나 직접 입력"></label>
      <label>제품코드<input data-k="product_code" maxlength="50" value="${v('product_code')}"></label>
      <label>규격<input data-k="spec" maxlength="200" value="${v('spec')}" placeholder="예: 34Φ*200"></label>
      <label>단위<input data-k="unit" maxlength="20" value="${v('unit')}" placeholder="예: SET, BOX"></label>
      <label>수량 *<input data-k="qty" type="number" min="0" step="any" required value="${v('qty')}"></label>
      <label>매입단가<input data-k="purchase_price" type="number" min="0" step="any" value="${v('purchase_price')}"></label>
      <label>판매단가<input data-k="sale_price" type="number" min="0" step="any" value="${v('sale_price')}"></label>
      <label>공급선<input data-k="vendor" maxlength="100" list="prVendorList" value="${v('vendor')}" placeholder="매입 거래처"></label>
      <label>납품예정수량<input data-k="delivery_qty" maxlength="50" value="${v('delivery_qty')}" placeholder="예: 전량"></label>
      <label>사용고객사<input data-k="customer" maxlength="200" value="${v('customer')}"></label>
      <label>현재고<input data-k="stock_qty" maxlength="50" value="${v('stock_qty')}" placeholder="품목을 고르면 자동"></label>
      <label>입고요청일<input data-k="due_text" maxlength="50" value="${v('due_text')}" placeholder="예: ASAP 또는 2026-12-01"></label>
      <label>월사용량<input data-k="monthly_usage" maxlength="50" value="${v('monthly_usage')}"></label>
    </div>
    <p class="pr-amount small" data-amount aria-live="polite"></p>
    <div class="actions"><button type="button" class="btn small danger" data-remove-item>품목 삭제</button></div></fieldset>`;
}
async function prForm(host, existing = null, { onDone } = {}) {
  const [people, catalog, vendors] = await Promise.all([prDirectory(), api('GET', '/api/boms?temp=1').catch(() => []), api('GET', '/api/vendors').catch(() => [])]);
  const line = { approve: [], agree: [], cc: [] };
  if (existing) for (const l of existing.lines) line[l.kind].push(l.user_id);
  const others = people.filter(p => p.id !== (existing ? existing.author_id : ME.id));
  host.innerHTML = `<form class="stack pr-form" data-no-author>
    <p class="pr-requester"><span class="muted">의뢰부서</span> <b>${esc((existing ? existing.department : ME.department) || '부서 미지정')}</b> <span class="muted">요청자</span> <b>${esc(existing ? existing.author_name : ME.name)}</b> <span>${esc((existing ? existing.author_position : ME.position) || '')}</span></p>
    ${!(existing ? existing.department : ME.department) ? '<p class="small muted">부서가 지정되지 않았습니다. 관리자에게 요청하세요(관리 › 조직 구성).</p>' : ''}
    <div class="form-grid">
      <label>작성일 *<input name="doc_date" type="date" required value="${esc(existing ? existing.doc_date : todayStr())}"></label>
      <label>제목<input name="title" maxlength="200" value="${esc(existing ? existing.title : '')}" placeholder="예: 핸드롤러 구매의뢰"></label>
    </div>
    <section class="pr-section"><h3>구매 의뢰 품목</h3><div data-items></div>
      <div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-add-item>+ 품목 추가</button></div>
      <p class="pr-totals" data-totals aria-live="polite"></p></section>
    <label>비고<textarea name="note" rows="2" maxlength="2000">${esc(existing ? existing.note : '')}</textarea></label>
    <section class="pr-section"><h3>결재선</h3>
      <p class="small muted"><span>기안은 요청자(작성자)로 자동 표시됩니다.</span><br><span>결재자가 순서대로 승인한 뒤 합의자가 순서대로 확인합니다. 참조자는 열람만 합니다.</span></p>
      <div class="pr-line-groups">${Object.entries(PR_GROUP).map(([kind, label]) => `<div class="pr-line-group" data-group="${kind}"><label>${label}${kind === 'approve' ? ' *' : ''}
        <span class="pr-line-pick"><select data-pick="${kind}" data-no-mark aria-label="${label}에 넣을 사람"><option value="">사람 선택</option>${others.map(p => `<option value="${p.id}">${esc(p.name)}${p.position ? ' · ' + esc(p.position) : ''}${p.department ? ' · ' + esc(p.department) : ''}</option>`).join('')}</select>
        <button type="button" class="btn small" data-add-line="${kind}">추가</button></span></label><ol class="pr-line-list" data-list="${kind}"></ol></div>`).join('')}</div>
      <p class="field-error" data-line-error hidden></p></section>
    ${existing ? '' : photoPicker()}
    <div class="actions"><button class="btn primary">${existing ? '고쳐서 다시 상신' : '상신'}</button></div>
  </form>
  <datalist id="prCatalogList">${catalog.map(b => `<option value="${esc(b.product)}">${esc(b.product_code)}${b.unit ? ' · ' + esc(b.unit) : ''}</option>`).join('')}</datalist>
  <datalist id="prVendorList">${vendors.map(vd => `<option value="${esc(vd.name)}">`).join('')}</datalist>`;
  const form = $('form', host), items = $('[data-items]', form), draft = existing ? null : bindPhotoDraft(form);
  const byId = id => people.find(p => p.id === id) || { name: '(없는 사용자)' };
  const renumber = () => [...items.children].forEach((row, i) => { $('legend', row).textContent = `품목 ${i + 1}`; $('[data-remove-item]', row).setAttribute('aria-label', `품목 ${i + 1} 삭제`); });
  const totals = () => {
    let buy = 0, sale = 0;
    for (const row of items.children) {
      const n = key => Number($(`[data-k="${key}"]`, row).value || 0), qty = n('qty'), b = n('purchase_price') * qty, s = n('sale_price') * qty;
      buy += b; sale += s;
      $('[data-amount]', row).textContent = qty ? `매입금액 ${prMoney(b)} · 판매금액 ${prMoney(s)} · 이익 ${prProfit(s, b)}` : '';
    }
    $('[data-totals]', form).textContent = `합계 · 매입 ${prMoney(buy)}원 · 판매 ${prMoney(sale)}원 · 이익 ${prProfit(sale, buy)}`;
  };
  const addItem = (it, focus) => {
    if (items.children.length >= 30) return toast('품목은 30개까지 입력할 수 있습니다.', 'err');
    items.insertAdjacentHTML('beforeend', prItemRow(it)); const row = items.lastElementChild;
    const k = key => $(`[data-k="${key}"]`, row);
    k('item').addEventListener('change', async () => {
      const bom = catalog.find(b => b.product === k('item').value.trim());
      k('bom_id').value = bom ? bom.id : '';
      if (!bom) return;
      k('product_code').value = bom.product_code || ''; if (!k('unit').value) k('unit').value = bom.unit || '';
      try {
        const stock = await api('GET', `/api/inventory?asof=${todayStr()}&q=${encodeURIComponent(bom.product)}`);
        const hit = (stock.rows || []).find(r => r.item === bom.product && (!k('unit').value || r.unit === k('unit').value));
        if (hit && !k('stock_qty').value) k('stock_qty').value = fmtNum(hit.stock);
      } catch { /* 현재고는 참고값이라 못 읽어도 직접 입력하면 된다 */ }
    });
    $('[data-remove-item]', row).onclick = () => { if (items.children.length === 1) return toast('품목은 1개 이상 필요합니다.', 'err'); row.remove(); renumber(); totals(); $('[data-add-item]', form).focus(); };
    renumber(); totals(); if (focus) k('item').focus();
  };
  (existing ? existing.items : [{}]).forEach(it => addItem(it));
  $('[data-add-item]', form).onclick = () => addItem({}, true);
  form.addEventListener('input', event => { if (event.target.closest('.pr-item')) totals(); });
  const drawLines = () => {
    for (const kind of Object.keys(line)) {
      const list = $(`[data-list="${kind}"]`, form);
      list.innerHTML = line[kind].map((id, i) => `<li><span>${prPerson(byId(id))}</span><span class="pr-line-tools">${kind !== 'cc' ? `<button type="button" class="btn small" data-move="${kind}:${i}:-1" aria-label="${esc(byId(id).name)} 앞으로" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn small" data-move="${kind}:${i}:1" aria-label="${esc(byId(id).name)} 뒤로" ${i < line[kind].length - 1 ? '' : 'disabled'}>↓</button>` : ''}<button type="button" class="btn small danger" data-drop="${kind}:${i}" aria-label="${esc(byId(id).name)} 빼기">×</button></span></li>`).join('') || `<li class="muted small">${kind === 'approve' ? '결재자를 1명 이상 추가하세요.' : '없음'}</li>`;
      $$('[data-move]', list).forEach(b => b.onclick = () => { const [k, i, d] = b.dataset.move.split(':'); const a = line[k], x = Number(i), y = x + Number(d); [a[x], a[y]] = [a[y], a[x]]; drawLines(); });
      $$('[data-drop]', list).forEach(b => b.onclick = () => { const [k, i] = b.dataset.drop.split(':'); line[k].splice(Number(i), 1); drawLines(); $(`[data-pick="${k}"]`, form).focus(); });
    }
    $$('[data-pick] option[value]', form).forEach(o => { if (o.value) o.disabled = Object.values(line).some(list => list.includes(Number(o.value))); });
    if (line.approve.length) $('[data-line-error]', form).hidden = true;
  };
  $$('[data-add-line]', form).forEach(b => b.onclick = () => {
    const kind = b.dataset.addLine, select = $(`[data-pick="${kind}"]`, form), id = Number(select.value);
    if (!id) { select.focus(); return toast('추가할 사람을 고르세요.', 'err'); }
    line[kind].push(id); select.value = ''; drawLines(); select.focus();
  });
  drawLines();
  // 저장 재시도(응답이 끊겨 다시 누름)는 같은 request_id를 보내 서버가 처음 저장한 의뢰서를 돌려준다. 성공하면 화면을 떠난다.
  let busy = false; const saveId = existing ? null : crypto.randomUUID();
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || draft?.busy) return;
    if (!line.approve.length) { const e = $('[data-line-error]', form); e.textContent = '결재자를 1명 이상 추가하세요. 「결재」에서 사람을 고르고 「추가」를 누르세요.'; e.hidden = false; $('[data-pick="approve"]', form).focus(); return; }
    const values = formObj(form);
    const body = { doc_date: values.doc_date, title: values.title, note: values.note, approvers: line.approve, agreers: line.agree, cc: line.cc,
      items: [...items.children].map(row => Object.fromEntries($$('[data-k]', row).map(el => [el.dataset.k, el.value]))) };
    busy = true;
    try {
      let saved;
      if (existing) saved = await api('PUT', `/api/purchase-requests/${existing.id}`, { ...body, revision: existing.revision });
      else {
        saved = await api('POST', '/api/purchase-requests', { ...body, request_id: saveId });
        if (draft.photos.length && !saved.photos.length) {
          try { saved = await api('PUT', `/api/purchase-requests/${saved.id}/photos`, { photos: [...draft.photos], revision: saved.revision }); }
          catch { fail(new Error('의뢰서는 상신했으나 사진 저장에 실패했습니다. 의뢰서를 열어 「사진 변경」으로 다시 올리세요.')); }
        }
      }
      toast(existing ? '고쳐서 다시 상신했습니다.' : saved.duplicate ? `${saved.doc_no} 구매의뢰는 앞서 이미 상신되었습니다. 저장된 내용을 엽니다.` : `${saved.doc_no} 구매의뢰를 상신했습니다.`);
      if (onDone) onDone(saved); else { prOpenAfterLoad = saved.id; location.hash = '#/sales/pr'; }
    } catch (error) { fail(error); } finally { busy = false; }
  };
}
async function pageSalesPrEntry(main) {
  main.innerHTML = `<h1>구매의뢰 작성 <span class="dept">영업</span> <a class="btn view-switch" href="#/sales/pr">구매의뢰 목록 →</a></h1><p class="muted">구매가 필요한 품목과 매입·판매 단가, 공급선, 고객사를 적고 결재선을 지정해 상신합니다. 최종 승인되면 구매 담당자가 발주를 만듭니다.</p><div class="card" id="prEntry"></div>`;
  await prForm($('#prEntry', main));
}

// ── 목록 ──
async function pageSalesPrList(main) {
  const canOrder = hasRole('purchase');
  const boxes = [['', '전체'], ['todo', '내 결재 차례'], ['mine', '내가 올린 의뢰'], ['cc', '참조'], ...(canOrder ? [['order', '발주 대기']] : [])];
  let box = ''; try { box = localStorage.getItem('wpa:pr-box') || ''; } catch { /* private mode */ }
  if (!boxes.some(([k]) => k === box)) box = '';
  main.innerHTML = `<h1>구매의뢰 목록 <span class="dept">영업</span> <a class="btn primary view-switch" href="#/sales/pr/new">+ 구매의뢰 작성</a></h1>
    <div class="kind-filter" role="group" aria-label="목록 구분">${boxes.map(([k, label]) => `<button type="button" class="kind-chip" data-box="${k}" aria-pressed="${k === box}">${label}</button>`).join('')}</div>
    ${listControls('pr', { dateLabel: '작성', dateFold: '작성일로 찾기', placeholder: '의뢰번호·제목·품목·공급선·고객사·작성자', extra: `<label>결재 상태<select name="status"><option value="">전체 상태</option>${Object.entries(PR_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>` })}
    <div id="prList"></div>`;
  const form = $('#prFilters', main); let version = 0;
  // 200건씩 읽고 「더 보기」로 다음 페이지를 붙인다.
  let rows = [], page = 0, more = false;
  const load = async (next = false) => {
    const own = ++version; listLoading(form);
    const data = await api('GET', '/api/purchase-requests?' + new URLSearchParams({ ...formObj(form), ...(box ? { box } : {}), paged: '1', page: String(next === true ? page + 1 : 0) }));
    if (own !== version || !main.isConnected) return;
    rows = next === true ? rows.concat(data.rows) : data.rows; page = data.page; more = data.more;
    listCount(form, rows.length); if (more) $('[data-list-count]', form).textContent += ' · 더 있음';
    $('#prList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>의뢰번호 · 작성일</th><th>제목 · 품목</th><th class="r">매입 / 판매 금액</th><th>공급선 · 고객사</th><th>요청자 · 의뢰부서</th><th>결재</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.my_turn ? 'row-yellow' : ''}">
      <td><b>${esc(r.doc_no)}</b><br><span class="small muted">${esc(r.doc_date)}</span></td>
      <td>${esc(r.title || r.first_item)}${r.title ? `<div class="small muted">${esc(r.first_item)}${r.item_count > 1 ? ` 외 ${r.item_count - 1}건` : ''}</div>` : r.item_count > 1 ? ` <span class="small muted">외 ${r.item_count - 1}건</span>` : ''}</td>
      <td class="r">${prMoney(r.purchase_total)}<br><span class="small muted">${prMoney(r.sale_total)}</span></td>
      <td>${esc(r.vendors || '—')}<div class="small muted">${esc(r.customers)}</div></td>
      <td>${esc(r.author_name)}<div class="small muted">${esc(r.department)}</div></td>
      <td><span class="chip ${PR_STATUS_CHIP[r.status]}">${PR_STATUS[r.status]}</span>${r.status === 'pending' ? `<div class="small">${r.my_turn ? '<b>내 차례</b>' : esc(r.current_user_name) + ' 차례'}</div>` : ''}${r.status === 'approved' && r.ordered ? `<div class="small muted">발주 ${r.ordered}/${r.item_count}</div>` : ''}</td>
      <td data-card-primary><button class="btn small ${r.my_turn ? 'primary' : ''}" data-open-pr="${r.id}">${r.my_turn ? '결재하기' : '열기'}</button></td></tr>`).join('')}</tbody></table></div>${more ? '<div class="actions"><button type="button" class="btn" data-pr-more>더 보기</button></div>' : ''}`
      : `<div class="empty">${box === 'todo' ? '지금 내 결재 차례인 구매의뢰가 없습니다.' : '조건에 맞는 구매의뢰가 없습니다.'}</div>`;
    $$('[data-open-pr]', main).forEach(b => b.onclick = () => prOpen(Number(b.dataset.openPr), () => load()));
    const moreButton = $('[data-pr-more]', main); if (moreButton) moreButton.onclick = () => load(true).catch(fail);
  };
  $$('[data-box]', main).forEach(b => b.onclick = () => { box = b.dataset.box; try { localStorage.setItem('wpa:pr-box', box); } catch { /* ignore */ } $$('[data-box]', main).forEach(x => x.setAttribute('aria-pressed', String(x === b))); load().catch(fail); });
  bindListControls(form, () => load());
  await load();
  if (prOpenAfterLoad) { const id = prOpenAfterLoad; prOpenAfterLoad = null; prOpen(id, () => load()).catch(fail); }
}

// ── 상세(결재 정보 · 본문) ──
function prLineRows(pr) {
  const at = v => v ? esc(String(v).slice(0, 16)) : '';
  const state = l => l.decision === 'approved' ? `<span class="pr-state ok">${l.kind === 'agree' ? '합의' : '승인'}</span>`
    : l.decision === 'rejected' ? '<span class="pr-state no">반려</span>'
      : pr.status === 'pending' && l.step === pr.current_step ? '<span class="pr-state now">진행 중</span>' : '<span class="pr-state wait">대기</span>';
  const person = (name, position, time, badge, now, comment) => `<li class="${now ? 'now' : ''}"><div><b>${esc(name)}</b> <span class="muted">${esc(position || '')}</span><div class="small muted">${time}</div>${comment ? `<div class="small pr-comment">${esc(comment)}</div>` : ''}</div>${badge}</li>`;
  const group = (label, list) => list ? `<tr><th scope="row">${label}</th><td><ol class="pr-people">${list}</ol></td></tr>` : '';
  const approve = person(pr.author_name, pr.author_position, at(pr.submitted_at), '<span class="pr-state ok">기안</span>', false)
    + pr.lines.filter(l => l.kind === 'approve').map(l => person(l.user_name, l.user_position, at(l.decided_at), state(l), pr.status === 'pending' && l.step === pr.current_step, l.comment)).join('');
  const agree = pr.lines.filter(l => l.kind === 'agree').map(l => person(l.user_name, l.user_position, at(l.decided_at), state(l), pr.status === 'pending' && l.step === pr.current_step, l.comment)).join('');
  const cc = pr.lines.filter(l => l.kind === 'cc').map(l => `<li><div><b>${esc(l.user_name)}</b> <span class="muted">${esc(l.user_position)}</span></div>${l.read_at ? `<span class="pr-state ok" title="${esc(l.read_at)}">✓ 열람</span>` : '<span class="pr-state wait">미열람</span>'}</li>`).join('');
  return `<table class="kv pr-lines keep-table"><caption class="sr-only">결재 정보</caption><tbody>${group('결재', approve)}${group('합의', agree)}${group('참조', cc)}</tbody></table>`;
}
async function prOpen(id, after = () => {}) {
  const pr = await api('GET', `/api/purchase-requests/${id}`);
  const isAuthor = pr.author_id === ME.id || ME.is_admin;
  const m = modal(`<h3>${esc(pr.doc_no)} ${pr.title ? '· ' + esc(pr.title) : ''} <span class="chip ${PR_STATUS_CHIP[pr.status]}">${PR_STATUS[pr.status]}</span></h3>
    ${pr.status === 'rejected' ? `<p class="form-error">반려 사유: ${esc(pr.reject_reason)} — 작성자가 고쳐 다시 상신하면 결재가 처음부터 진행됩니다.</p>` : ''}
    ${pr.can_decide ? '<p class="pr-turn">지금 내 결재 차례입니다. 본문을 확인하고 승인 또는 반려하세요.</p>' : ''}
    <section><h4>결재 정보</h4>${prLineRows(pr)}</section>
    <section><h4>본문 · 구매의뢰서</h4>
      <p><span class="muted">작성일</span> <b>${esc(pr.doc_date)}</b> <span class="muted">의뢰부서</span> <b>${esc(pr.department || '—')}</b> <span class="muted">요청자</span> <b>${esc(pr.author_name)}</b> <span>${esc(pr.author_position || '')}</span></p>
      <div class="table-wrap"><table class="grid pr-items"><thead><tr><th>NO</th><th>품목 · 규격</th><th>단위</th><th class="r">수량</th><th class="r">매입단가</th><th class="r">매입금액</th><th class="r">판매단가</th><th class="r">판매금액</th><th>공급선</th><th>납품예정수량</th><th>사용고객사</th><th>현재고</th><th>입고요청일</th>${pr.items.some(it => it.manager) ? '<th>담당자</th>' : ''}<th>월사용량</th><th>발주</th></tr></thead>
      <tbody>${pr.items.map(it => `<tr><td>${it.line_no}</td><td><b>${esc(it.item)}</b>${it.spec ? `<div class="small">${esc(it.spec)}</div>` : ''}${it.product_code ? `<div class="small muted">제품코드 ${esc(it.product_code)}</div>` : ''}</td><td>${esc(it.unit)}</td><td class="r">${fmtNum(it.qty)}</td><td class="r">${prMoney(it.purchase_price)}</td><td class="r">${it.purchase_price == null ? '' : prMoney(it.purchase_price * it.qty)}</td><td class="r">${prMoney(it.sale_price)}</td><td class="r">${it.sale_price == null ? '' : prMoney(it.sale_price * it.qty)}</td><td>${esc(it.vendor)}</td><td>${esc(it.delivery_qty)}</td><td>${esc(it.customer)}</td><td>${esc(it.stock_qty)}</td><td>${esc(it.due_text)}</td>${pr.items.some(x => x.manager) ? `<td>${esc(it.manager)}</td>` : ''}<td>${esc(it.monthly_usage)}</td><td>${it.po_id ? '<span class="chip green">발주됨</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="pr-totals">${`합계 · 매입 ${prMoney(pr.purchase_total)}원 · 판매 ${prMoney(pr.sale_total)}원 · 이익 ${prProfit(pr.sale_total, pr.purchase_total)}`}</p>
      ${pr.note ? `<p class="pr-note">${esc(pr.note)}</p>` : ''}
      <div class="thumbs">${pr.photos.map(f => `<img src="/uploads/${esc(f)}" data-big="/uploads/${esc(f)}" alt="구매의뢰 첨부 사진" loading="lazy">`).join('') || '<span class="muted small">첨부 사진 없음</span>'}</div></section>
    <div class="actions">${pr.can_decide ? '<button class="btn primary" data-pr-approve>승인</button><button class="btn danger" data-pr-reject>반려</button>' : ''}
      ${pr.can_order ? '<button class="btn primary" data-pr-order>발주 생성</button>' : ''}
      ${pr.can_edit ? '<button class="btn" data-pr-edit>고쳐서 다시 상신</button>' : ''}
      ${isAuthor && pr.status !== 'approved' ? '<button class="btn" data-pr-photos>사진 변경</button>' : ''}
      ${pr.can_delete ? '<button class="btn danger" data-pr-delete>삭제</button>' : ''}</div>`, { wide: true });
  $$('img[data-big]', m.el).forEach(img => img.onclick = () => lightbox(img.dataset.big));
  const done = async () => { m.close(); await after(); refreshNavBadges(); };
  const decide = async (decision) => {
    const v = await promptBox(decision === 'approved' ? '승인' : '반려', decision === 'approved' ? '<label>승인 의견 (선택)<input name="comment" maxlength="500"></label>' : '<label>반려 사유 *<input name="comment" required maxlength="500" placeholder="예: 단가 재확인 필요"></label>');
    if (!v) return;
    try { const r = await api('POST', `/api/purchase-requests/${pr.id}/decision`, { decision, comment: v.comment, revision: pr.revision }); toast(decision === 'rejected' ? '반려했습니다. 작성자에게 돌아갑니다.' : r.status === 'approved' ? '최종 승인했습니다.' : `승인했습니다. 다음 차례: ${r.current_user_name}`); await done(); } catch (error) { fail(error); }
  };
  const act = (sel, fn) => { const b = $(sel, m.el); if (b) b.onclick = fn; };
  act('[data-pr-approve]', () => decide('approved'));
  act('[data-pr-reject]', () => decide('rejected'));
  act('[data-pr-delete]', async () => { if (!await confirmBox(`${pr.doc_no} 구매의뢰를 삭제할까요? 첨부 사진도 함께 지워집니다.`)) return; try { await api('DELETE', `/api/purchase-requests/${pr.id}`); toast('삭제했습니다.'); await done(); } catch (error) { fail(error); } });
  act('[data-pr-edit]', async () => {
    m.close();
    const box = modal(`<h3>${esc(pr.doc_no)} 고쳐서 다시 상신</h3><p class="small muted">상신하면 결재가 처음부터 다시 진행됩니다. 첨부 사진은 「사진 변경」으로 바꿉니다.</p><div data-edit-host></div>`, { wide: true });
    await prForm($('[data-edit-host]', box.el), pr, { onDone: async () => { box.close(); await after(); refreshNavBadges(); } });
  });
  act('[data-pr-photos]', () => {
    m.close();
    const box = modal(`<h3>${esc(pr.doc_no)} 첨부 사진</h3><form class="stack"><div class="thumbs">${pr.photos.map(f => `<label class="keep"><img src="/uploads/${esc(f)}" alt=""><input type="checkbox" name="keep_photos" value="${esc(f)}" checked> 유지</label>`).join('')}</div>${photoPicker()}<div class="actions"><button class="btn primary">사진 저장</button></div></form>`, { wide: true });
    const form = $('form', box.el), draft = bindPhotoDraft(form);
    form.onsubmit = async event => {
      event.preventDefault(); if (draft.busy) return;
      try { await api('PUT', `/api/purchase-requests/${pr.id}/photos`, { keep_photos: $$('input[name=keep_photos]:checked', form).map(x => x.value), photos: [...draft.photos], revision: pr.revision }); box.close(); toast('사진을 저장했습니다.'); await after(); prOpen(pr.id, after); } catch (error) { fail(error); }
    };
  });
  act('[data-pr-order]', async () => {
    const open = pr.items.filter(it => !it.po_id), needVendor = open.some(it => !it.vendor), needCategory = open.some(it => !it.bom_id);
    const v = await promptBox('발주 생성', `<p class="small muted">${open.length}개 품목을 발주목록에 올립니다. 구매의뢰번호는 ${esc(pr.doc_no)}, 거래처는 품목의 공급선입니다.</p>
      <label>납기일 *<input name="due_date" type="date" required value="${addDays(todayStr(), 7)}"></label>
      ${needCategory ? `<label>품목 분류 * <span class="hint">(등록되지 않은 품목에 적용)</span><select name="item_category" required>${categoryOptions()}</select></label>` : ''}
      ${needVendor ? '<label>거래처 * <span class="hint">(공급선이 비어 있는 품목에 적용)</span><input name="vendor" required maxlength="100"></label>' : ''}`);
    if (!v) return;
    try { const r = await api('POST', `/api/purchase-requests/${pr.id}/po`, v); toast(`발주 ${r.created.length}건을 발주목록에 올렸습니다.`); await done(); } catch (error) { fail(error); }
  });
}

// ───────────── 영업 → 생산: 생산의뢰 (15.50) ─────────────
// 영업이 업체·주문번호·출고 희망·사양과 품목(사이즈별 수량)을 올리고, 생산 담당이 「생산계획 반영」으로 생산일정을 만든다.
// 진행(생산 수량·완료일)은 연결된 생산일정의 실적으로 자동 계산된다.
const MR_STATUS = { waiting: '접수 대기', partial: '일부 계획', planned: '계획 반영', producing: '생산 중', done: '생산완료', shipped: '출고완료' };
const MR_CHIP = { waiting: 'yellow', partial: 'yellow', planned: '', producing: '', done: 'green', shipped: 'green' };
const MR_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const mrBar = (done, total) => `<span class="plan-progress"><span class="plan-bar"><i style="width:${total ? Math.min(100, Math.round(done / total * 100)) : 0}%"></i></span><span class="small">${fmtNum(done)} / ${fmtNum(total)}</span></span>`;
// 단위가 다른 수량(BOX·매·켤레)은 더하지 않고 단위별로 보여 준다.
const mrUnitText = (qty, unit) => `${fmtNum(qty)}${unit ? ' ' + esc(unit) : ''}`;
const mrUnits = r => (r.units || []).map(u => `<span class="mr-unit">${mrBar(u.produced, u.qty)}${u.unit ? `<span class="small muted">${esc(u.unit)}</span>` : ''}</span>`).join('');
const mrShip = r => r.ship_text || r.ship_date ? [r.ship_text, r.ship_date].filter(Boolean).join(' · ') : '—';
// 같은 품목은 「S 10,000 · M 18,500」처럼 사이즈를 한 줄로 묶는다.
function mrItemsText(lines) {
  const groups = new Map();
  for (const l of lines) { const g = groups.get(l.item) || []; g.push(l); groups.set(l.item, g); }
  return [...groups].map(([item, ls]) => `<b>${esc(item)}</b> <span class="small">${ls.map(l => `${l.spec ? esc(l.spec) + ' ' : ''}${fmtNum(l.qty)}${l.spec ? '' : ' ' + esc(l.unit)}`).join(' · ')}</span>`).join('<br>');
}

function mrLineRow(l = {}) {
  const v = key => esc(l[key] ?? '');
  return `<fieldset class="mr-line"><legend></legend><input type="hidden" data-k="bom_id" value="${v('bom_id')}"><div class="form-grid">
    <label class="span2">품목명 *<input data-k="item" required maxlength="200" list="mrCatalogList" value="${v('item')}" placeholder="등록된 품목을 검색하거나 직접 입력"></label>
    <label>규격·사이즈<input data-k="spec" maxlength="100" value="${v('spec')}" placeholder="예: S, 50매"></label>
    <label>단위<input data-k="unit" maxlength="20" value="${v('unit')}" placeholder="예: 켤레, BOX"></label>
    <label>수량 *<input data-k="qty" type="number" min="0" step="any" required value="${v('qty')}"></label>
    <input type="hidden" data-k="product_code" value="${v('product_code')}">
  </div><div class="actions"><button type="button" class="btn small danger" data-remove-line>줄 삭제</button></div></fieldset>`;
}
async function mrForm(host, existing = null, { onDone } = {}) {
  const [catalog, vendors] = await Promise.all([api('GET', '/api/boms?temp=1').catch(() => []), api('GET', '/api/vendors').catch(() => [])]);
  const e = key => esc(existing ? existing[key] ?? '' : '');
  host.innerHTML = `<form class="stack mr-form" data-no-author>
    <p class="pr-requester"><span class="muted">요청자</span> <b>${esc(existing ? existing.author_name : ME.name)}</b> <span class="muted">부서</span> <b>${esc((existing ? existing.author_department : ME.department) || '부서 미지정')}</b></p>
    <div class="form-grid">
      <label>업체(고객사) *<input name="customer" required maxlength="100" list="mrVendorList" value="${e('customer')}" placeholder="예: 하라다"></label>
      <label>주문번호<input name="order_no" maxlength="100" value="${e('order_no')}" placeholder="예: ZEX-CT-J063"></label>
      <label>발주일 *<input name="order_date" type="date" required value="${existing ? e('order_date') : todayStr()}"></label>
      <label>출고 희망<input name="ship_text" maxlength="50" value="${e('ship_text')}" placeholder="예: 12월 초, 12/1 희망"></label>
      <label>출고 희망일<input name="ship_date" type="date" value="${e('ship_date')}"></label>
    </div>
    <label>사양·요청사항<textarea name="spec" rows="2" maxlength="1000" placeholder="예: 사이즈 도장 제외 사양으로 진행 / 무지백·무지박스">${e('spec')}</textarea></label>
    <section class="pr-section"><h3>생산 품목</h3><div data-lines></div>
      <div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-add-line>+ 품목 줄 추가</button><button type="button" class="btn" data-size-grid>+ 사이즈별 입력</button></div>
      <div class="mr-size-grid card" data-size-box hidden><h4>사이즈별 수량</h4><div class="form-grid"><label class="span2">품목명<input data-size-item list="mrCatalogList" maxlength="200" placeholder="예: 습진장갑"></label><label>단위<input data-size-unit maxlength="20" placeholder="예: 켤레"></label></div>
        <div class="mr-sizes">${MR_SIZES.map(size => `<label>${size}<input type="number" min="0" step="any" data-size="${size}" inputmode="numeric"></label>`).join('')}</div>
        <div class="actions" style="justify-content:flex-start"><button type="button" class="btn primary" data-size-apply>줄로 추가</button><button type="button" class="btn" data-size-close>닫기</button></div></div>
      <p class="pr-totals" data-mr-total aria-live="polite"></p></section>
    <label>비고<textarea name="note" rows="2" maxlength="1000">${e('note')}</textarea></label>
    <div class="actions"><button class="btn primary">${existing ? '고쳐서 저장' : '생산의뢰 등록'}</button></div>
  </form>
  <datalist id="mrCatalogList">${catalog.map(b => `<option value="${esc(b.product)}">${esc(b.product_code)}${b.unit ? ' · ' + esc(b.unit) : ''}</option>`).join('')}</datalist>
  <datalist id="mrVendorList">${vendors.map(vd => `<option value="${esc(vd.name)}">`).join('')}</datalist>`;
  const form = $('form', host), lines = $('[data-lines]', form);
  const total = () => {
    const byUnit = new Map();
    for (const row of lines.children) { const unit = $('[data-k=unit]', row).value.trim(); byUnit.set(unit, (byUnit.get(unit) || 0) + Number($('[data-k=qty]', row).value || 0)); }
    $('[data-mr-total]', form).textContent = `합계 수량 ${[...byUnit].map(([unit, qty]) => `${fmtNum(qty)}${unit ? ' ' + unit : ''}`).join(' · ')} · ${lines.children.length}줄`;
  };
  const renumber = () => { [...lines.children].forEach((row, i) => { $('legend', row).textContent = `품목 ${i + 1}`; $('[data-remove-line]', row).setAttribute('aria-label', `품목 ${i + 1} 삭제`); }); total(); };
  const pick = (input, unit, code, bomInput) => {
    const bom = catalog.find(b => b.product === input.value.trim());
    if (bomInput) bomInput.value = bom ? bom.id : '';
    if (code) code.value = bom ? bom.product_code || '' : '';
    if (bom && unit && !unit.value) unit.value = bom.unit || '';
  };
  const addLine = (l, focus) => {
    if (lines.children.length >= 60) return toast('품목 줄은 60개까지 입력할 수 있습니다.', 'err');
    lines.insertAdjacentHTML('beforeend', mrLineRow(l)); const row = lines.lastElementChild, k = key => $(`[data-k="${key}"]`, row);
    k('item').addEventListener('change', () => pick(k('item'), k('unit'), k('product_code'), k('bom_id')));
    $('[data-remove-line]', row).onclick = () => { if (lines.children.length === 1) return toast('품목은 1줄 이상 필요합니다.', 'err'); row.remove(); renumber(); $('[data-add-line]', form).focus(); };
    renumber(); if (focus) k('item').focus();
  };
  (existing ? existing.lines : [{}]).forEach(l => addLine(l));
  $('[data-add-line]', form).onclick = () => addLine({}, true);
  form.addEventListener('input', event => { if (event.target.closest('.mr-line')) total(); });
  const box = $('[data-size-box]', form);
  $('[data-size-grid]', form).onclick = () => { box.hidden = false; $('[data-size-item]', box).focus(); };
  $('[data-size-close]', form).onclick = () => { box.hidden = true; $('[data-size-grid]', form).focus(); };
  $('[data-size-item]', box).addEventListener('change', () => pick($('[data-size-item]', box), $('[data-size-unit]', box)));
  $('[data-size-apply]', form).onclick = () => {
    const item = $('[data-size-item]', box).value.trim(), unit = $('[data-size-unit]', box).value.trim();
    const sizes = $$('[data-size]', box).filter(input => Number(input.value) > 0);
    if (!item) { $('[data-size-item]', box).focus(); return toast('사이즈별로 넣을 품목명을 입력하세요.', 'err'); }
    if (!sizes.length) { $('[data-size]', box).focus(); return toast('사이즈별 수량을 1개 이상 입력하세요.', 'err'); }
    const bom = catalog.find(b => b.product === item);
    // 비어 있는 첫 줄은 사이즈 줄로 바꾼다.
    if (lines.children.length === 1 && !$('[data-k=item]', lines).value.trim()) lines.replaceChildren();
    for (const input of sizes) addLine({ item, unit: unit || (bom ? bom.unit : ''), spec: input.dataset.size, qty: input.value, bom_id: bom ? bom.id : '', product_code: bom ? bom.product_code : '' });
    $$('[data-size]', box).forEach(input => { input.value = ''; }); $('[data-size-item]', box).value = ''; box.hidden = true;
    toast(`${item} ${sizes.length}개 사이즈를 줄로 추가했습니다.`);
  };
  form.addEventListener('change', event => { if (event.target.matches('[data-k=unit]')) total(); });
  const readLines = () => [...lines.children].map(row => Object.fromEntries($$('[data-k]', row).map(el => [el.dataset.k, el.value])));
  // 새 의뢰는 입력 초안을 이 탭에 보관한다(품목 줄 포함). 저장에 성공하면 지우고, 실패하면 남긴다.
  const draft = existing ? null : bindEntryDraft(form, 'production-request:new', {
    noPhotos: true,
    read: () => ({ head: uxFormRead(form), lines: readLines() }),
    restore: value => { uxFormRestore(form, value.head); lines.replaceChildren(); (value.lines && value.lines.length ? value.lines : [{}]).forEach(l => addLine(l)); },
    afterRestore: total,
  });
  // 저장 재시도(응답이 끊겨 다시 누름)에는 같은 request_id를 보낸다. 서버는 처음 저장된 의뢰를 돌려준다(중복 등록 없음).
  let busy = false; const saveId = existing ? null : crypto.randomUUID();
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const v = formObj(form);
    const body = { ...v, ship_date: v.ship_date || null, lines: readLines() };
    busy = true; draft?.start();
    try {
      const saved = existing ? await api('PUT', `/api/production-requests/${existing.id}`, { ...body, revision: existing.revision }) : await api('POST', '/api/production-requests', { ...body, request_id: saveId });
      draft?.clear();
      toast(existing ? '고쳐서 저장했습니다.' : saved.duplicate ? `${saved.req_no} 생산의뢰는 앞서 이미 등록되었습니다. 저장된 내용을 엽니다. 고칠 내용이 있으면 「수정」을 누르세요.` : `${saved.req_no} 생산의뢰를 등록했습니다. 생산 담당자에게 접수 대기로 표시됩니다.`);
      if (onDone) onDone(saved); else { mrOpenAfterLoad = saved.id; location.hash = '#/sales/mr'; }
    } catch (error) { draft?.failure(); fail(error); } finally { busy = false; }
  };
}
let mrOpenAfterLoad = null;
async function pageSalesMrEntry(main) {
  main.innerHTML = `<h1>생산의뢰 작성 <span class="dept">영업</span> <a class="btn view-switch" href="#/sales/mr">생산의뢰 목록 →</a></h1><p class="muted">수주한 품목의 생산을 생산팀에 요청합니다. 업체·주문번호·출고 희망·사양을 적고, 사이즈가 있는 품목은 「사이즈별 입력」으로 한 번에 넣습니다. 생산팀이 생산계획에 반영하면 진행과 생산 완료가 이 의뢰에 자동으로 표시됩니다.</p><div class="card" id="mrEntry"></div>`;
  await mrForm($('#mrEntry', main));
}
// 영업 목록(#/sales/mr)과 생산 접수(#/prod/orders)가 같은 화면을 쓴다. 생산 쪽은 생산 필요 수량 합계와 반영 버튼이 먼저 보인다.
async function pageMrList(main, mode = 'sales') {
  const prodView = mode === 'production';
  main.innerHTML = `<h1>${prodView ? '생산의뢰 접수' : '생산의뢰 목록'} <span class="dept">${prodView ? '생산' : '영업'}</span>${prodView ? '' : ' <a class="btn primary view-switch" href="#/sales/mr/new">+ 생산의뢰 작성</a>'}</h1>
    ${prodView ? '<section class="card mr-needs" id="mrNeeds"><h2>생산 필요 수량</h2><p class="small muted">출고 전 의뢰의 품목·사이즈별 남은 생산 수량입니다. 「계획 안 됨」은 아직 생산계획에 반영되지 않은 수량입니다.</p><div data-needs>불러오는 중…</div></section>' : ''}
    ${listControls('mr', { dateLabel: '발주', dateFold: '발주일로 찾기', placeholder: '의뢰번호·업체·주문번호·품목·사양·요청자', extra: `<label>진행 상태<select name="status"><option value="open">출고 전 전체</option><option value="waiting">접수 대기</option><option value="planned">계획 반영</option><option value="producing">생산 중</option><option value="done">생산완료</option><option value="shipped">출고완료</option><option value="">전체</option></select></label>${prodView ? '' : '<label class="inline"><input type="checkbox" name="mine" value="1"> 내가 올린 의뢰만</label>'}` })}
    <div id="mrList"></div>`;
  const form = $('#mrFilters', main); let version = 0;
  const loadNeeds = async () => {
    if (!prodView) return;
    const needs = await api('GET', '/api/production-requests/needs'); if (!main.isConnected) return;
    // TOTAL은 같은 품목·같은 단위끼리만 더한다(단위가 다르면 따로 묶는다).
    const groups = new Map(); for (const n of needs) { const key = n.item + '\u0001' + n.unit; const g = groups.get(key) || []; g.push(n); groups.set(key, g); }
    $('[data-needs]', main).innerHTML = needs.length ? `<div class="table-wrap"><table class="grid keep-table mr-needs-table"><thead><tr><th>품목</th><th>규격·사이즈</th><th class="r">의뢰</th><th class="r">생산</th><th class="r">생산 필요</th><th class="r">계획 안 됨</th></tr></thead><tbody>${[...groups].map(([, list]) => list.map((n, i) => `<tr><td>${i ? '' : `<b>${esc(n.item)}</b>`}</td><td>${esc(n.spec || '—')}</td><td class="r">${fmtNum(n.ordered)}</td><td class="r">${fmtNum(n.produced)}</td><td class="r"><b>${fmtNum(n.need)}</b> ${esc(n.unit)}</td><td class="r ${n.unplanned ? 'red-text' : ''}">${fmtNum(n.unplanned)}</td></tr>`).join('') + (list.length > 1 ? `<tr class="mr-total"><td></td><td>TOTAL</td><td class="r">${fmtNum(list.reduce((t, n) => t + n.ordered, 0))}</td><td class="r">${fmtNum(list.reduce((t, n) => t + n.produced, 0))}</td><td class="r"><b>${fmtNum(list.reduce((t, n) => t + n.need, 0))}</b> ${esc(list[0].unit)}</td><td class="r">${fmtNum(list.reduce((t, n) => t + n.unplanned, 0))}</td></tr>` : '')).join('')}</tbody></table></div>` : '<p class="muted">생산이 남은 의뢰가 없습니다.</p>';
  };
  // 300건씩 읽고 「더 보기」로 다음 페이지를 붙인다(상태 필터는 서버에서 먼저 적용된다).
  let rows = [], page = 0, more = false;
  const load = async (next = false) => {
    const own = ++version; listLoading(form);
    const v = formObj(form); const params = { ...v, mine: (v.mine || []).length ? '1' : '', paged: '1', page: String(next ? page + 1 : 0) };
    const data = await api('GET', '/api/production-requests?' + new URLSearchParams(Object.entries(params).filter(([, x]) => x !== '')));
    if (own !== version || !main.isConnected) return;
    rows = next ? rows.concat(data.rows) : data.rows; page = data.page; more = data.more;
    listCount(form, rows.length); if (more) $('[data-list-count]', form).textContent += ' · 더 있음';
    $('#mrList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>발주일 · 의뢰번호</th><th>업체 · 주문번호</th><th>품목 · 수량</th><th>출고 희망</th><th>진행</th><th>생산 완료일</th><th>출고</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.status === 'waiting' || r.status === 'partial' ? 'row-yellow' : ''}">
      <td>${esc(r.order_date)}<div class="small muted">${esc(r.req_no)}</div></td>
      <td><b>${esc(r.customer)}</b>${r.order_no ? `<div class="small muted">${esc(r.order_no)}</div>` : ''}${r.spec ? `<div class="small mr-spec-inline">${esc(r.spec)}</div>` : ''}</td>
      <td>${mrItemsText(r.lines)}</td>
      <td>${esc(mrShip(r))}</td>
      <td><span class="chip ${MR_CHIP[r.status]}">${MR_STATUS[r.status]}</span>${mrUnits(r)}</td>
      <td>${esc(r.done_date || '')}</td>
      <td>${r.shipped ? `<span class="chip green">✓ ${esc(r.shipped_date)}</span>` : '<span class="muted">—</span>'}</td>
      <td data-card-primary><button class="btn small ${prodView && r.unplanned_lines && !r.shipped ? 'primary' : ''}" data-open-mr="${r.id}">${prodView && r.unplanned_lines && !r.shipped ? '접수·계획 반영' : '열기'}</button></td></tr>`).join('')}</tbody></table></div>${more ? '<div class="actions"><button type="button" class="btn" data-mr-more>더 보기</button></div>' : ''}`
      : '<div class="empty">조건에 맞는 생산의뢰가 없습니다.</div>';
    const moreButton = $('[data-mr-more]', main); if (moreButton) moreButton.onclick = () => load(true).catch(fail);
  };
  const reload = async () => { await load(); await loadNeeds(); };
  main.mrReload = reload;
  bindListControls(form, () => load());
  await Promise.all([load(), loadNeeds()]);
  if (mrOpenAfterLoad) { const id = mrOpenAfterLoad; mrOpenAfterLoad = null; mrOpen(id).catch(fail); }
}
async function mrOpen(id) {
  const r = await api('GET', `/api/production-requests/${id}`);
  const after = async () => { const main = $('#main'); if (main?.mrReload) await main.mrReload(); else if (main && /#\/prod\/(finished|semi)/.test(location.hash)) render(); refreshNavBadges(); };
  const m = modal(`<h3>${esc(r.req_no)} · ${esc(r.customer)} <span class="chip ${MR_CHIP[r.status]}">${MR_STATUS[r.status]}</span></h3>
    <p><span class="muted">발주일</span> <b>${esc(r.order_date)}</b> <span class="muted">주문번호</span> <b>${esc(r.order_no || '—')}</b> <span class="muted">출고 희망</span> <b>${esc(mrShip(r))}</b></p>
    <p class="small muted"><span>요청자</span> ${esc(r.author_name)} ${esc(r.author_department)} · <span>등록</span> ${esc(String(r.created_at).slice(0, 16))}</p>
    ${r.spec ? `<p class="mr-spec">${esc(r.spec)}</p>` : ''}
    <section><h4>생산 품목 · 진행 현황</h4><div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th>규격·사이즈</th><th class="r">수량</th><th class="r">계획</th><th>생산</th></tr></thead><tbody>${r.lines.map(l => `<tr><td><b>${esc(l.item)}</b>${l.product_code ? `<div class="small muted">${esc(l.product_code)}</div>` : ''}</td><td>${esc(l.spec || '—')}</td><td class="r">${fmtNum(l.qty)} ${esc(l.unit)}</td><td class="r ${l.planned_qty < l.qty ? 'red-text' : ''}">${fmtNum(l.planned_qty)}</td><td data-card-primary>${mrBar(Math.min(l.produced_qty, l.qty), l.qty)}</td></tr>`).join('')}</tbody></table></div>
      ${(r.units || []).map(u => `<p class="pr-totals">${`합계${u.unit ? ' (' + esc(u.unit) + ')' : ''} · 의뢰 ${fmtNum(u.qty)} · 계획 ${fmtNum(u.planned)} · 생산 ${fmtNum(u.produced)}`}</p>`).join('')}${r.done_date ? `<p><span class="chip green">생산완료</span> ${esc(r.done_date)}</p>` : ''}</section>
    <section><h4>연결된 생산계획</h4>${r.schedules.length ? `<ul class="mr-schedules">${r.schedules.map(s => `<li><a href="#/prod/${s.kind === 'semi' ? 'semi' : 'finished'}"><span>${s.kind === 'semi' ? '반제품' : '완제품'}</span> · <span>${{ day: '일간', week: '주간', month: '월간' }[s.period]}</span> ${esc(s.start_date)}</a> <span>${esc(s.product)} ${esc(s.spec)} ${mrUnitText(s.qty, s.unit)}</span> <span class="small muted"><span>실적</span> ${fmtNum(s.actual_qty)}</span></li>`).join('')}</ul>` : '<p class="muted small">아직 생산계획에 반영되지 않았습니다. 생산 담당자가 「생산계획 반영」을 누르면 생산일정에 들어갑니다.</p>'}</section>
    ${r.note ? `<p class="pr-note">${esc(r.note)}</p>` : ''}
    ${r.shipped ? `<p><span class="chip green">출고완료</span> ${esc(r.shipped_date)} · ${esc(r.shipped_by)}</p>` : ''}
    <div class="actions">${r.can_plan ? '<button class="btn primary" data-mr-plan>생산계획 반영</button>' : ''}
      ${r.can_ship ? (r.shipped ? '<button class="btn" data-mr-unship>출고 취소</button>' : '<button class="btn" data-mr-ship>출고 완료 표시</button>') : ''}
      ${r.can_edit ? '<button class="btn" data-mr-edit>수정</button><button class="btn danger" data-mr-delete>삭제</button>' : ''}</div>`, { wide: true });
  const done = async message => { if (message) toast(message); m.close(); await after(); };
  const act = (sel, fn) => { const b = $(sel, m.el); if (b) b.onclick = fn; };
  act('[data-mr-plan]', async () => {
    const left = r.lines.filter(l => l.planned_qty < l.qty);
    const start = r.ship_date && r.ship_date > todayStr() ? addDays(r.ship_date, -7) > todayStr() ? addDays(r.ship_date, -7) : todayStr() : todayStr();
    const v = await promptBox('생산계획 반영', `<p class="small muted">아직 계획되지 않은 ${left.length}줄(${[...left.reduce((m, l) => m.set(l.unit, (m.get(l.unit) || 0) + l.qty - l.planned_qty), new Map())].map(([unit, qty]) => mrUnitText(qty, unit)).join(' · ')})을 생산일정에 넣습니다. 반제품 품목은 반제품 생산일정, 나머지는 완제품 생산일정으로 들어갑니다.</p>
      <label>일정 기준 *<select name="period" required><option value="week">주간</option><option value="day">일간</option><option value="month">월간</option></select></label>
      <label>시작일 * <span class="hint">(주간은 그 주 월요일, 월간은 1일로 맞춥니다)</span><input name="start_date" type="date" required value="${start}"></label>`);
    if (!v) return;
    try { const x = await api('POST', `/api/production-requests/${r.id}/plan`, { ...v, revision: r.revision }); await done(`생산계획에 ${x.schedules.length}건으로 반영했습니다. 생산일정에서 실적을 입력하면 이 의뢰에 자동 반영됩니다.`); } catch (error) { fail(error); }
  });
  act('[data-mr-ship]', async () => {
    const v = await promptBox('출고 완료 표시', `<label>출고일 *<input name="shipped_date" type="date" required value="${todayStr()}"></label>`);
    if (!v) return;
    try { await api('POST', `/api/production-requests/${r.id}/ship`, { shipped: true, shipped_date: v.shipped_date }); await done('출고 완료로 표시했습니다.'); } catch (error) { fail(error); }
  });
  act('[data-mr-unship]', async () => { if (!await confirmBox('출고 완료 표시를 취소할까요?')) return; try { await api('POST', `/api/production-requests/${r.id}/ship`, { shipped: false }); await done('출고 표시를 취소했습니다.'); } catch (error) { fail(error); } });
  act('[data-mr-delete]', async () => { if (!await confirmBox(`${r.req_no} 생산의뢰를 삭제할까요?`)) return; try { await api('DELETE', `/api/production-requests/${r.id}?revision=${r.revision}`); await done('삭제했습니다.'); } catch (error) { fail(error); } });
  act('[data-mr-edit]', async () => {
    m.close();
    const box = modal(`<h3>${esc(r.req_no)} 수정</h3><div data-edit-host></div>`, { wide: true });
    await mrForm($('[data-edit-host]', box.el), r, { onDone: async () => { box.close(); await after(); } });
  });
}
// 생산일정의 「생산의뢰 …」 링크는 의뢰 상세를 연다.
document.addEventListener('click', event => {
  const link = event.target.closest?.('[data-open-mr]');
  if (!link || link.tagName !== 'A') return;
  event.preventDefault(); mrOpen(Number(link.dataset.openMr)).catch(fail);
});
document.addEventListener('click', event => {
  const button = event.target.closest?.('button[data-open-mr]');
  if (button) mrOpen(Number(button.dataset.openMr)).catch(fail);
});
