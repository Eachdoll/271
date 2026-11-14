// Operators have a restricted shell and narrow server endpoints; hiding menus is not authorization.
const isOperatorMode = () => !!ME && !ME.is_admin && ME.roles.includes('operator');
const OPERATOR_LINKS = [
  ['#/operator/cut', '반제품 · 커팅/융착', '라인과 품목을 선택하고 작업 수량을 입력합니다.'],
  ['#/operator/wash', '반제품 · 세탁', '호기와 품목을 선택하고 세탁 수량을 입력합니다.'],
  ['#/operator/inspections', '수입·출하 검사 조회', '카테고리와 품명으로 검색하고 검사 결과를 확인합니다.'],
  ['#/operator/finished', '완제품 실적', '등록된 생산계획을 선택하고 실제 생산량을 입력합니다.'],
];
function operatorShell() {
  document.body.classList.add('operator-mode'); document.body.classList.remove('nav-open');
  $('#app').innerHTML = `<header class="top"><a class="brand" href="#/"><img class="brand-logo" src="/assets/seoulsemi-logo-blue.png" alt="SEOUL SEMITECH"><span class="brand-text">오퍼레이터 모드</span><span class="app-version">버전 ${APP_VERSION}</span></a><div class="who"><a href="#/me">${esc(ME.name)}</a><button class="btn small" id="logout">로그아웃</button></div></header><div class="operator-layout"><nav class="operator-tabs" aria-label="생산 입력">${OPERATOR_LINKS.map(([href,label]) => `<a class="btn ${location.hash === href ? 'primary' : ''}" href="${href}" ${location.hash === href ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav><main id="main"></main></div>`;
  $('#logout').onclick = async () => { try { await api('POST', '/api/auth/logout'); uxClearUser(); ME = null; render(); } catch (error) { fail(error); } };
}
async function operatorPage(route, main) {
  if (route === '#/operator/inspections') return pageInspections(main);
  if (route === '#/me') return pageMe(main);
  if (route === '#/operator/cut') return pageSemi(main, 'cut', { operator: true });
  if (route === '#/operator/wash') return pageSemi(main, 'wash', { operator: true });
  if (route === '#/operator/finished') return operatorFinished(main);
  main.innerHTML = `<h1>오늘의 작업을 입력하세요</h1><p class="muted">작업 종류를 선택하세요. 저장한 기록은 생산 담당자 화면에 함께 반영됩니다.</p><div class="operator-choices">${OPERATOR_LINKS.map(([href,label,description],i) => `<a class="card operator-choice" href="${href}"><span class="operator-number">0${i+1}</span><h2>${label}</h2><p>${description}</p><b>${href.includes('inspections')?'조회하기':'입력하기'} →</b></a>`).join('')}</div><p class="small muted">입력 내용을 정정해야 하면 생산 담당자에게 요청하세요.</p>`;
}
function operatorSimplifySemi(row) {
  const more = document.createElement('details'); more.className = 'operator-more';
  more.innerHTML = '<summary>추가 정보 · 작업시간, 인원, LOT, 비고</summary><div class="form-grid"></div>';
  for (const key of ['start_time','end_time','break_minutes','workers','lot','note']) $('[data-k="' + key + '"]',row).closest('label') && $('.form-grid',more).append($('[data-k="' + key + '"]',row).closest('label'));
  $('.form-grid',row).after(more);
}
function operatorSemiHistory(rows) {
  return `<section class="card"><h3>내가 입력한 최근 기록</h3><p class="small muted">조회 기간 내 최근 20건 · 정정이 필요하면 생산 담당자에게 요청하세요.</p>${rows.length ? `<div class="operator-history">${rows.slice(0,20).map(r => `<article><div><b>${esc(r.item_name || semiTypeLabel(r))} ${esc(r.spec)}</b><p class="small muted">${esc(r.work_date)} · ${esc(r.unit_name)}${r.process==='wash'?' · '+esc(r.start_time||'시각 미기록'):''}${r.product_code?' · '+esc(r.product_code):''}</p></div>${r.process==='wash'?`<div>세탁수량 <b>${fmtNum(r.qty+(r.defect_qty||0))} ${esc(r.unit)}</b></div>`:`<div>양품 <b>${fmtNum(r.qty)} ${esc(r.unit)}</b><br><span class="small muted">불량 ${fmtNum(r.defect_qty || 0)} ${esc(r.unit)}</span></div>`}</article>`).join('')}</div>` : '<p class="muted">아직 입력한 기록이 없습니다.</p>'}</section>`;
}
async function operatorFinished(main) {
  main.innerHTML = `<h1>완제품 실적 입력</h1><p class="muted">생산일과 계획을 선택한 뒤 이번에 생산한 수량을 입력하세요.</p><form id="operatorActual" class="card stack"><label>생산일 *<input name="production_date" type="date" value="${todayStr()}" max="${todayStr()}" required></label><label>생산계획 *<select name="schedule_id" required disabled><option value="">계획을 불러오는 중…</option></select></label><p id="operatorPlan" class="muted" role="status"></p><label>이번 생산수량 *<input name="qty" type="number" min="0" step="any" required inputmode="decimal" placeholder="누계가 아닌 이번 생산량"></label><label>메모 (선택)<input name="note" maxlength="1000"></label><p id="operatorSaveStatus" role="status" class="small muted"></p><button type="submit" class="btn primary" disabled>실적 저장</button></form><section class="card"><div class="actions"><h3>선택한 날짜의 내 입력 기록</h3><button type="button" class="btn small" id="operatorRefresh">다시 조회</button></div><div id="operatorHistory"></div><p class="small muted">최근 100건 · 수정·취소가 필요하면 생산 담당자에게 요청하세요.</p></section>`;
  const form = $('#operatorActual',main), select = form.elements.schedule_id, date = form.elements.production_date, button = $('[type=submit]',form), status = $('#operatorSaveStatus',main);
  let plans = [], ready = false, busy = false, sequence = 0, desiredPlan = '', requestId = crypto.randomUUID();
  const planInfo = () => {
    if (!ready) { button.disabled = true; return; }
    const plan = plans.find(p => String(p.id) === select.value);
    $('#operatorPlan',main).textContent = plan ? `계획 ${fmtNum(plan.qty)} ${plan.unit} · 누적 실적 ${fmtNum(plan.actual_qty)} ${plan.unit}${plan.done ? ' · 완료 표시된 계획' : ''}` : '생산계획을 선택하세요.';
    button.disabled = busy || !ready || !plan;
  };
  const loadPlans = async (preferred = select.value) => {
    const own = ++sequence, day = date.value; desiredPlan = String(preferred || ''); ready = false; button.disabled = true; select.disabled = true;
    try {
      const [found, rows] = await Promise.all([api('GET','/api/operator/plans?date='+encodeURIComponent(day)),api('GET','/api/operator/actuals?date='+encodeURIComponent(day))]);
      if (own !== sequence || !form.isConnected) return;
      plans = found; ready = true;
      select.innerHTML = '<option value="">생산계획 선택</option>' + plans.map(p => `<option value="${p.id}">${esc(p.product)}${p.spec ? ' · '+esc(p.spec) : ''} · ${esc(p.period === 'day' ? '일간' : p.period === 'week' ? '주간' : '월간')} 계획 #${p.id}${p.done ? ' (완료)' : ''}</option>`).join('');
      select.value = plans.some(p => String(p.id) === String(preferred)) ? String(preferred) : '';
      desiredPlan = select.value; select.disabled = !plans.length;
      planInfo();
      if (!plans.length) $('#operatorPlan',main).textContent = '선택한 날짜의 완제품 계획이 없습니다. 날짜를 확인하거나 생산 담당자에게 계획 등록을 요청하세요.';
      $('#operatorHistory',main).innerHTML = rows.length ? `<div class="operator-history">${rows.map(r => `<article><div><b>${esc(r.product)} ${esc(r.spec)}</b><p class="small muted">${esc(r.note)}</p></div><div>${fmtNum(r.qty)} ${esc(r.unit)}${r.voided_at ? '<span class="chip">취소됨</span>' : ''}</div></article>`).join('')}</div>` : '<p class="muted">이 날짜에 입력한 실적이 없습니다.</p>';
    } catch (error) { if (own === sequence && form.isConnected) { $('#operatorPlan',main).textContent = '조회하지 못했습니다. 다시 조회를 눌러주세요. '+error.message; $('#operatorHistory',main).textContent = '조회 실패'; } }
  };
  const draft = bindEntryDraft(form,'operator:finished',{
    read: () => ({ fields: uxFormRead(form).map(([key,value]) => [key, key === 'schedule_id' && !ready ? desiredPlan : value]), requestId }),
    restore: value => { uxFormRestore(form,value.fields); if (typeof value.requestId === 'string') requestId = value.requestId; const chosen = new Map(value.fields || []).get('schedule_id'); loadPlans(chosen); },
  });
  date.onchange = () => loadPlans(''); select.onchange = () => { desiredPlan = select.value; planInfo(); };
  $('#operatorRefresh',main).onclick = () => { if (!busy) loadPlans(); };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !ready || !form.reportValidity()) return;
    const chosen = plans.find(p => String(p.id) === select.value); if (!chosen) return;
    busy = true; form.inert = true; button.disabled = true; draft.start(); status.textContent = '저장 중…';
    let saved = false;
    try {
      await api('POST',`/api/schedules/${chosen.id}/actuals`,{ production_date: date.value, qty: form.elements.qty.value, note: form.elements.note.value, request_id: requestId });
      saved = true; draft.clear(); requestId = crypto.randomUUID(); form.elements.qty.value = ''; form.elements.note.value = '';
      status.textContent = '실적이 저장되었습니다.'; toast('완제품 실적을 저장했습니다.');
      await loadPlans(String(chosen.id));
    } catch (error) { if (!saved) { draft.failure(); status.textContent = '저장하지 못했습니다. 입력 내용을 확인하고 다시 저장하세요.'; } fail(error); }
    finally { busy = false; form.inert = false; draft.resume(); planInfo(); }
  };
  await loadPlans();
}
