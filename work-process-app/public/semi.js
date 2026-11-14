// 생산 → 반제품 작업 기록. 커팅/융착은 라인별, 세탁은 호기별로 기록합니다.
// 품목을 늘리려면 여기와 worker.mjs의 SEMI_PRODUCTS를 함께 고치세요.
const SEMI_PRODUCTS = { wiper: { label: '와이퍼', types: ['부직포와이퍼', '천와이퍼'] }, seamless: { label: '심리스글러브', types: ['스무드', '타키'] } };
const SEMI_SIZES = ['XS', 'S', 'M', 'L', 'XL'];
// 불량 사유를 바꾸려면 worker.mjs의 SEMI_DEFECT_REASONS와 함께 고치세요.
const SEMI_DEFECT_REASONS = { cut: ['오염', '치수 불량', '융착 불량', '커팅 불량', '찢어짐·구멍', '이물', '기타'], wash: ['오염 잔류', '손상·찢어짐', '변색', '이물', '기타'] };
const SEMI_PAGE = {
  cut: { title: '커팅/융착관리', unitKind: 'line', unitLabel: '라인', manage: '라인 관리', intro: '라인별로 와이퍼(부직포와이퍼·천와이퍼)와 심리스글러브(스무드·타키)를 얼마나 생산했는지 기록합니다. 종류를 고르면 BOM · 품목코드 관리에 등록된 그 종류의 품목(모델)이 나옵니다. 양품수량이 그 품목의 반제품 재고로 잡히고, 품목에 구성자재가 있으면 원자재가 함께 차감됩니다.' },
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
  for (const r of rows) { const key = [r.unit_name, r.product_group, r.product_type, r.item_name || '', r.spec, r.unit].join('\u0000'); const g = groups.get(key) || { ...r, qty: 0, defect: 0, count: 0 }; g.qty += r.qty; g.defect += r.defect_qty || 0; g.count++; groups.set(key, g); }
  const list = [...groups.values()].sort((a, b) => a.unit_name.localeCompare(b.unit_name, 'ko') || a.product_group.localeCompare(b.product_group) || a.product_type.localeCompare(b.product_type, 'ko') || order(a.spec) - order(b.spec));
  return `<div class="card"><h4>사이즈·규격별 합계</h4><div class="table-wrap"><table class="grid keep-table"><thead><tr><th>${SEMI_PAGE[process].unitLabel}</th><th>품목</th><th>사이즈·규격</th><th class="r">양품</th><th class="r">불량</th><th class="r">수율</th><th class="r">기록</th></tr></thead><tbody>${list.map(g => `<tr><td>${esc(g.unit_name)}</td><td>${esc(semiTypeLabel(g))}${g.item_name ? ` · <b>${esc(g.item_name)}</b>` : ''}</td><td>${esc(g.spec) || '<span class="muted">미지정</span>'}</td><td class="r"><b>${fmtNum(Math.round(g.qty * 1e6) / 1e6)}</b> ${esc(g.unit)}</td><td class="r">${fmtNum(Math.round(g.defect * 1e6) / 1e6)}</td><td class="r">${semiRate(g.qty, g.qty + g.defect)}</td><td class="r small muted">${g.count}건</td></tr>`).join('')}</tbody></table></div></div>`;
}
// ── 기록 수정·삭제 요청 (생산팀장 승인 후 반영). LOT·비고만 바꾸는 것은 바로 반영됩니다. ──
const SEMI_FIELD_LABEL = { work_date: '작업일', unit_name: '라인·호기', product_type: '종류', item_name: '품목(모델)', spec: '사이즈·규격', qty: '양품수량', defect_qty: '불량수량', defect_reason: '불량 사유', unit: '단위', start_time: '시작', end_time: '종료', break_minutes: '휴게(분)', workers: '생산인원', lot: 'LOT', note: '비고' };
function semiChangeText(c) {
  const what = `${esc(c.old_data.work_date)} ${esc(c.old_data.unit_name)} ${esc(semiTypeLabel(c.old_data))}${c.old_data.item_name ? ' ' + esc(c.old_data.item_name) : ''}${c.old_data.spec ? ' ' + esc(c.old_data.spec) : ''}`;
  if (c.action === 'delete') return `${what} · <b>삭제 요청</b> (${fmtNum(c.old_data.qty)} ${esc(c.old_data.unit)})`;
  const show = (key, data) => key === 'product_type' ? semiTypeLabel(data) : ['qty', 'defect_qty', 'work_hours', 'workers'].includes(key) ? (data[key] == null ? '' : fmtNum(data[key])) : data[key];
  const changed = Object.keys(SEMI_FIELD_LABEL).filter(key => (key === 'product_type' ? semiTypeLabel(c.old_data) !== semiTypeLabel(c.new_data) : (c.old_data[key] ?? null) !== (c.new_data[key] ?? null)))
    .map(key => `${SEMI_FIELD_LABEL[key]} ${esc(show(key, c.old_data)) || '없음'} → <b>${esc(show(key, c.new_data)) || '없음'}</b>`);
  return `${what} · ${changed.join(', ')}`;
}
const canApproveSemi = () => ME.is_admin || ME.roles.includes('production_approver');
function semiChangeButtons(c) {
  return `${canApproveSemi() ? `<button class="btn small primary" data-schange-approve="${c.id}">승인</button> <button class="btn small danger" data-schange-reject="${c.id}">반려</button>` : ''}${c.requested_by_id === ME.id ? ` <button class="btn small" data-schange-cancel="${c.id}">요청 철회</button>` : ''}`;
}
function bindSemiChanges(root, after) {
  const run = (button, task) => { button.onclick = async event => { event.stopPropagation(); if (button.disabled) return; button.disabled = true; try { if (await task() !== false) await after(); } catch (error) { fail(error); } finally { button.disabled = false; } }; };
  $$('[data-schange-approve]', root).forEach(button => run(button, async () => { if (!await reviewApproval('semi', button.dataset.schangeApprove)) return false; await api('POST', `/api/semi-changes/${button.dataset.schangeApprove}/approve`, {}); toast('승인했습니다. 기록에 반영되었습니다.'); }));
  $$('[data-schange-reject]', root).forEach(button => run(button, async () => { const v = await promptBox('수정·삭제 요청 반려', '<label>반려 사유 *<input name="note" required maxlength="500"></label>'); if (!v) return false; await api('POST', `/api/semi-changes/${button.dataset.schangeReject}/reject`, v); toast('반려했습니다.'); }));
  $$('[data-schange-cancel]', root).forEach(button => run(button, async () => { if (!(await confirmBox('이 요청을 철회할까요?'))) return false; await api('POST', `/api/semi-changes/${button.dataset.schangeCancel}/cancel`); toast('요청을 철회했습니다.'); }));
}
const semiRate = (part, whole) => whole ? (Math.round(part / whole * 1000) / 10) + '%' : '<span class="muted">—</span>';
// 리포트 · 통계 화면의 반제품 구역: 수율 추이, 생산량(수율)·불량수량(불량률), 불량 사유
const SEMI_GROUP_COLORS = { '와이퍼': '#2563eb', '심리스글러브': '#16a34a' };
let semiTargetState = { yield_target: 95, can_edit: false, units: new Map(), loaded: false };
const semiYieldTarget = () => semiTargetState.yield_target;
function semiYieldChart(title, series, buckets, grain, target) {
  const points = series.filter(r => r.yield_rate != null);
  if (!points.length) return '<div class="report-empty">이 기간에 수율을 계산할 기록이 없습니다.</div>';
  const width = Math.max(640, Math.min(2400, buckets.length * 44)), height = 270, left = 52, right = 20, top = 20, bottom = 45;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  // The axis starts a little below the lowest value (and the target) so small differences near 100% stay visible.
  const floor = Math.max(0, Math.floor((Math.min(target, ...points.map(r => r.yield_rate)) - 2) / 5) * 5), span = 100 - floor || 1;
  const x = bucket => left + plotWidth * (buckets.length === 1 ? 0.5 : buckets.indexOf(bucket) / (buckets.length - 1)), y = value => top + plotHeight * (1 - (value - floor) / span);
  let svg = '';
  for (let i = 0; i <= 4; i++) { const value = floor + span * i / 4; svg += `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="report-gridline"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${Math.round(value * 10) / 10}%</text>`; }
  svg += `<line x1="${left}" y1="${y(target)}" x2="${width - right}" y2="${y(target)}" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${width - right}" y="${y(target) - 5}" text-anchor="end" style="fill:#dc2626">목표 ${target}%</text>`;
  buckets.forEach((bucket, i) => { if (i % Math.max(1, Math.ceil(buckets.length / 10)) === 0 || i === buckets.length - 1) svg += `<text x="${x(bucket)}" y="${height - 18}" text-anchor="middle">${esc(reportPeriodLabel(bucket, grain))}</text>`; });
  const groups = [...new Set(points.map(r => r.group))];
  for (const group of groups) {
    const line = points.filter(r => r.group === group && buckets.includes(r.bucket)).sort((a, b) => a.bucket.localeCompare(b.bucket)); const color = SEMI_GROUP_COLORS[group] || '#f59e0b';
    svg += `<polyline fill="none" stroke="${color}" stroke-width="2" points="${line.map(r => `${x(r.bucket)},${y(r.yield_rate)}`).join(' ')}"/>`;
    for (const r of line) svg += `<circle cx="${x(r.bucket)}" cy="${y(r.yield_rate)}" r="${r.yield_rate < target ? 5 : 3.5}" fill="${r.yield_rate < target ? '#dc2626' : color}" stroke="#fff" stroke-width="1.5"><title>${esc(r.bucket)} · ${esc(group)}: 수율 ${r.yield_rate}% (양품 ${fmtNum(r.qty)} / 불량 ${fmtNum(r.defect_qty)})${r.yield_rate < target ? ' · 목표 미달' : ''}</title></circle>`;
  }
  const below = points.filter(r => r.yield_rate < target).length;
  return `<div class="report-legend">${groups.map(group => `<span><i style="background:${SEMI_GROUP_COLORS[group] || '#f59e0b'}"></i>${esc(group)}</span>`).join('')}<span><i style="background:#dc2626"></i>목표 미달${below ? ` ${below}회` : ' 없음'}</span></div><div class="report-chart-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}" style="min-width:${Math.min(width, 960)}px"><title>${esc(title)}</title>${svg}</svg></div>`;
}
let semiReportLast = null;
function semiReportBody(report) {
  const semi = report.semi, target = semiYieldTarget(), grain = report.range.grain;
  const pct = value => value == null ? '<span class="muted">—</span>' : value + '%';
  const table = (rows, first, name) => `<div class="table-wrap"><table class="grid"><thead><tr><th>${first}</th><th class="r">양품</th><th class="r">불량수량</th><th class="r">합계</th><th class="r">수율</th><th class="r">불량률</th><th class="r">작업시간</th><th class="r">인시당 양품</th><th class="r">기록</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.yield_rate != null && r.yield_rate < (semiTargetState.units.get(r.unit_name) ?? target) ? 'row-red' : ''}"><td><b>${esc(name(r))}</b></td><td class="r"><b>${fmtNum(r.qty)}</b> ${esc(r.unit)}</td><td class="r">${r.defect_qty ? `<span class="red-text">${fmtNum(r.defect_qty)}</span>` : '0'}</td><td class="r">${fmtNum(r.total_qty)}</td><td class="r"><b>${pct(r.yield_rate)}</b></td><td class="r">${pct(r.defect_rate)}</td><td class="r">${r.work_hours ? fmtNum(r.work_hours) + '시간' : '<span class="muted">—</span>'}</td><td class="r">${r.per_man_hour == null ? '<span class="muted">—</span>' : fmtNum(r.per_man_hour)}</td><td class="r small muted">${r.records}건</td></tr>`).join('')}</tbody></table></div>`;
  const reasonTable = rows => rows.length ? `<div class="table-wrap"><table class="grid keep-table"><thead><tr><th>불량 사유</th><th class="r">불량수량</th><th class="r">비중</th><th>　</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.reason)}</b></td><td class="r">${fmtNum(r.defect_qty)} ${esc(r.unit)}</td><td class="r">${pct(r.share)}</td><td style="width:40%"><div class="share-bar"><i style="width:${r.share || 0}%"></i></div></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">이 기간에 기록된 불량이 없습니다.</p>';
  const block = (process, title, unitLabel) => {
    const products = semi.by_product.filter(r => r.process === process), lines = semi.by_line.filter(r => r.process === process), detail = semi.rows.filter(r => r.process === process);
    if (!products.length) return `<section class="card"><h3>${title}</h3><p class="muted">이 기간에 기록이 없습니다.</p></section>`;
    return `<section class="card"><h3>${title} <span class="tag soft">수율 추이 · 생산량 · 불량</span></h3><h4>수율 추이</h4>${semiYieldChart(`${title} 수율 추이`, semi.series.filter(r => r.process === process), report.buckets, grain, target)}<h4>품목별</h4>${table(products, '품목', r => r.product)}<h4>${unitLabel}별</h4>${table(lines, unitLabel, r => r.unit_name)}<h4>불량 사유별</h4>${reasonTable(semi.reasons.filter(r => r.process === process))}<details><summary>${unitLabel}·품목·사이즈별 상세</summary>${table(detail, `${unitLabel} · 품목 · 사이즈`, r => [r.unit_name, r.product, r.spec].filter(Boolean).join(' · '))}</details></section>`;
  };
  return `<div class="semi-report-head"><h2>반제품 생산 (작업일 기준)</h2><label class="inline">기본 목표 수율 <input type="number" min="1" max="100" step="0.1" value="${target}" data-semi-target aria-label="기본 목표 수율" ${semiTargetState.can_edit ? '' : 'disabled'}> %</label></div><p class="small muted">목표 수율보다 낮은 구간은 그래프에 빨간 점으로, 표에서는 빨간 줄로 표시합니다. 라인·호기에 따로 정한 목표가 있으면 그 줄은 그 목표로 판정합니다. 기본 목표는 생산팀장·관리자가 바꾸며 모든 사람에게 적용됩니다.</p>${block('cut', '커팅/융착', '라인')}${block('wash', '세탁', '호기')}`;
}
function semiReportSection(report) {
  if (!report?.semi) return '';
  semiReportLast = report;
  // Targets come from the server; draw with what we have, then redraw once they arrive.
  Promise.all([api('GET', '/api/semi-settings'), api('GET', '/api/production-units?all=1')]).then(([settings, units]) => {
    semiTargetState = { ...settings, units: new Map(units.filter(u => u.yield_target != null).map(u => [u.name, u.yield_target])), loaded: true };
    const root = document.getElementById('semiReportRoot'); if (root && semiReportLast === report) root.innerHTML = semiReportBody(report);
  }).catch(() => {});
  return `<div id="semiReportRoot">${semiReportBody(report)}</div>`;
}
// The production lead (or an admin) changes the default target for everyone.
document.addEventListener('change', async event => {
  const input = event.target.closest?.('[data-semi-target]'); if (!input || !semiReportLast) return;
  const value = Number(input.value); if (!(value > 0 && value <= 100)) return;
  try { const saved = await api('PUT', '/api/semi-settings', { yield_target: value }); semiTargetState.yield_target = saved.yield_target; toast(`기본 목표 수율을 ${saved.yield_target}%로 저장했습니다.`); }
  catch (error) { fail(error); }
  const root = document.getElementById('semiReportRoot'); if (root) root.innerHTML = semiReportBody(semiReportLast);
});
async function manageProductionUnits(kind, after) {
  const label = kind === 'line' ? '라인' : '세탁 호기';
  const box = modal(`<h3>${label} 관리</h3><p class="small muted">이름을 바꿔도 이전 기록에는 입력 당시 이름이 남습니다. 더 쓰지 않는 ${label}은 사용 중지하세요.</p><form class="row" data-unit-new><input name="name" required maxlength="60" placeholder="${kind === 'line' ? '예) 1동 부직포라인' : '예) 1호기'}"><button class="btn primary">추가</button></form><div data-unit-list></div>`, { wide: true });
  const load = async () => {
    const units = await api('GET', `/api/production-units?kind=${kind}&all=1`); if (!box.el.isConnected) return;
    $('[data-unit-list]', box.el).innerHTML = units.length ? `<div class="table-wrap"><table class="grid keep-table"><thead><tr><th>이름</th><th class="r">목표 수율</th><th>상태</th><th></th></tr></thead><tbody>${units.map((u, i) => `<tr><td><b>${esc(u.name)}</b></td><td class="r">${u.yield_target == null ? '<span class="muted">기본값</span>' : u.yield_target + '%'}</td><td>${u.active ? '<span class="chip green">사용 중</span>' : '<span class="chip">사용 중지</span>'}</td><td class="nowrap"><button class="btn small" data-unit-rename="${i}">이름·목표</button> <button class="btn small ${u.active ? 'danger' : ''}" data-unit-toggle="${i}">${u.active ? '사용 중지' : '다시 사용'}</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">등록된 ${label}이 없습니다.</p>`;
    $$('[data-unit-rename]', box.el).forEach(button => button.onclick = async () => {
      const u = units[button.dataset.unitRename]; const v = await promptBox(`${label} 이름 · 목표 수율`, `<label>이름 *<input name="name" required maxlength="60" value="${esc(u.name)}"></label><label>목표 수율 (%) <span class="hint">비우면 기본 목표 사용</span><input name="yield_target" type="number" min="0.1" max="100" step="0.1" value="${esc(u.yield_target ?? '')}"></label>`); if (!v) return;
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
  <div id="semiPending"></div>${process === 'wash' ? '<div id="semiWip"></div>' : ''}
  <form class="card" id="semiNew"><h3>작업 기록 입력 <span class="small muted">같은 날짜·${page.unitLabel}의 여러 줄을 한 번에 등록</span></h3><div class="form-grid">
    <label>작업일 *<input name="work_date" type="date" required value="${todayStr()}" max="${todayStr()}"></label>
    <label>${page.unitLabel} *<select name="unit_id" required data-semi-units></select></label></div>
    <div data-semi-rows></div><datalist id="semiInches"></datalist>
    <p class="small muted">시작·종료 시각과 인원은 그 줄의 품목을 작업한 분만 적으세요. 한 번에 최대 30줄입니다.</p>
    <div class="actions">${canManage ? `<button type="button" class="btn" id="semiManage">${page.manage}</button>` : ''}<button type="button" class="btn" id="semiRecent" title="이 ${page.unitLabel}에 가장 최근에 입력한 날의 품목·사이즈·시각·인원을 불러옵니다. 수량은 비워 둡니다.">최근 입력 불러오기</button><button type="button" class="btn" id="semiAddRow">＋ 줄 추가</button><button class="btn primary" id="semiSubmit">1줄 등록</button></div></form>
  <form id="semiFilters" class="toolbar list-filters" data-read-only="true">
    <label>시작일<input type="date" name="from" value="${monthFirst}" required></label><label>종료일<input type="date" name="to" value="${todayStr()}" required></label>
    <label>${page.unitLabel}<select name="unit_id" data-semi-units-filter></select></label>
    <label>품목<select name="product_group"><option value="">전체</option>${Object.entries(SEMI_PRODUCTS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select></label>
    <label class="list-search">검색<input type="search" name="q" maxlength="200" placeholder="LOT·비고·입력자"></label>
    <label class="inline"><input type="checkbox" id="semiDetail"> 사이즈·규격별로 보기</label>
    <button type="submit" class="btn primary">조회</button><span class="small muted" id="semiCount"></span></form>
  <div id="semiSummary"></div><div id="semiList"></div>`;
  const form = $('#semiNew', main), filters = $('#semiFilters', main); let version = 0, requestId = crypto.randomUUID();
  // 반제품 catalog items that say which kind they are; the entry lines offer them as models.
  let models = [];
  try { models = (await api('GET', '/api/boms?item_category=' + encodeURIComponent('반제품'))).filter(b => b.semi_type); } catch { /* entry still works by kind only */ }
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
  // One fieldset per line. Seamless gloves show the size list, wipers the inch box; cutting/fusing requires it.
  const rowsRoot = $('[data-semi-rows]', form), submit = $('#semiSubmit', form);
  const countRows = () => { const n = $$('[data-semi-row]', form).length; submit.textContent = `${n}줄 등록`; $('#semiAddRow').disabled = n >= 30; };
  const addRow = (copy = null) => {
    if ($$('[data-semi-row]', form).length >= 30) return null;
    const row = document.createElement('fieldset'); row.dataset.semiRow = ''; row.className = 'multi-row';
    row.innerHTML = `<legend>기록</legend><div class="form-grid">
      ${semiProductSelect(process).replace('name="product"', 'data-k="product"').replace('품목 *', '종류 *')}
      <label data-semi-model hidden>품목 (모델) <span data-semi-model-mark></span><select data-k="bom_id"></select></label>
      <label data-semi-size hidden>사이즈${process === 'cut' ? ' *' : ' (선택)'}<select data-k="size"><option value="">선택</option>${SEMI_SIZES.map(size => `<option>${size}</option>`).join('')}</select></label>
      <label data-semi-inch hidden>규격 (인치)${process === 'cut' ? ' *' : ' (선택)'}<input data-k="inch" type="number" min="0.1" max="200" step="any" list="semiInches" placeholder="예) 9"></label>
      <label>양품수량 * <span class="hint">(불량 제외)</span><input data-k="qty" type="number" min="0" step="any" required></label>
      <label>불량수량 <span class="hint">(양품과 별도)</span><input data-k="defect_qty" type="number" min="0" step="any" placeholder="없으면 비움"></label>
      <label>불량 사유<select data-k="defect_reason" disabled><option value="">불량이 있으면 선택</option>${SEMI_DEFECT_REASONS[process].map(reason => `<option>${reason}</option>`).join('')}</select></label>
      <label>단위<input data-k="unit" maxlength="20" placeholder="예) 매 / 켤레 / kg"></label>
      <label>시작 시각<input data-k="start_time" type="time"></label>
      <label>종료 시각 <span class="hint" data-semi-hours></span><input data-k="end_time" type="time"></label>
      <label>휴게시간 <span class="hint">(분, 작업시간에서 뺌)</span><input data-k="break_minutes" type="number" min="0" step="1" placeholder="예) 60"></label>
      <label>생산인원 <span class="hint">(명)</span><input data-k="workers" type="number" min="0" step="1" placeholder="예) 4"></label>
      <label>LOT (선택)<input data-k="lot" maxlength="100"></label>
      <label>비고<input data-k="note" maxlength="500"></label></div>
      <div class="actions"><button type="button" class="btn small danger" data-semi-remove>줄 삭제</button></div>`;
    const field = key => $(`[data-k="${key}"]`, row);
    const syncSpec = () => {
      const group = String(field('product').value).split('|')[0]; const size = $('[data-semi-size]', row), inch = $('[data-semi-inch]', row);
      size.hidden = group !== 'seamless'; inch.hidden = group !== 'wiper';
      // Models registered for this kind (반제품 catalog items). Once any exist, cutting/fusing must name one.
      const type = String(field('product').value).split('|')[1] || ''; const choices = type ? models.filter(m => m.semi_type === type) : [];
      const keep = field('bom_id').value; const box = $('[data-semi-model]', row);
      box.hidden = !choices.length; field('bom_id').required = process === 'cut' && choices.length > 0;
      $('[data-semi-model-mark]', row).textContent = field('bom_id').required ? '*' : choices.length ? '(선택)' : '';
      field('bom_id').innerHTML = '<option value="">선택</option>' + choices.map(m => `<option value="${m.id}">${esc(m.product)}${m.product_code && m.product_code !== m.product ? ' · ' + esc(m.product_code) : ''}</option>`).join('');
      field('bom_id').value = choices.some(m => String(m.id) === keep) ? keep : '';
      const chosen = choices.find(m => String(m.id) === field('bom_id').value);
      if (chosen && !field('unit').value) field('unit').value = chosen.unit || '';
      field('size').required = process === 'cut' && group === 'seamless'; field('inch').required = process === 'cut' && group === 'wiper' && !chosen; // the model already identifies a wiper
      $('[data-semi-inch]', row).firstChild.textContent = `규격 (인치)${field('inch').required ? ' *' : ' (선택)'}`;
      if (size.hidden) field('size').value = ''; if (inch.hidden) field('inch').value = '';
    };
    field('bom_id').onchange = syncSpec;
    // Show the worked hours as soon as both clock times are in (an earlier end time means past midnight).
    const showHours = () => { const [a, b] = [field('start_time').value, field('end_time').value]; let text = '';
      if (a && b) { const m = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); let span = m(b) - m(a); if (span <= 0) span += 1440; const rest = Math.max(0, Number(field('break_minutes').value) || 0); text = `(${Math.round(Math.max(0, span - rest) / 60 * 100) / 100}시간${rest ? ' · 휴게 제외' : ''}${m(b) <= m(a) ? ' · 다음날 종료' : ''})`; }
      $('[data-semi-hours]', row).textContent = text; };
    field('break_minutes').oninput = showHours;
    const syncReason = () => { const has = Number(field('defect_qty').value) > 0; field('defect_reason').disabled = !has; if (!has) field('defect_reason').value = ''; };
    field('product').onchange = syncSpec; field('start_time').oninput = field('end_time').oninput = showHours; field('defect_qty').oninput = syncReason;
    // A new line starts from the previous line's product and unit; sizes and quantities are what change.
    if (copy) { field('product').value = $('[data-k="product"]', copy).value; field('unit').value = $('[data-k="unit"]', copy).value; syncSpec(); field('bom_id').value = $('[data-k="bom_id"]', copy).value; }
    syncSpec();
    $('[data-semi-remove]', row).onclick = () => { if ($$('[data-semi-row]', form).length === 1) return toast('기록은 1줄 이상 필요합니다.', 'err'); row.remove(); countRows(); };
    rowsRoot.append(row); countRows(); return row;
  };
  addRow(); $('#semiAddRow').onclick = () => { const rows = $$('[data-semi-row]', form); const row = addRow(rows.at(-1)); if (row) $($('[data-semi-size]', row).hidden ? '[data-k="qty"]' : '[data-k="size"]', row).focus(); };
  // Yesterday's lines for this line/washer, without quantities: most days repeat the same products, sizes, times and crew.
  $('#semiRecent').onclick = async () => {
    if (!form.unit_id.value) return toast(`${page.unitLabel}을(를) 먼저 선택하세요.`, 'err');
    try {
      const found = await api('GET', '/api/semi-records?' + new URLSearchParams({ process, unit_id: form.unit_id.value }));
      if (!found.length) return toast('불러올 이전 기록이 없습니다.', 'err');
      const latest = found[0].work_date; const source = found.filter(r => r.work_date === latest).reverse().slice(0, 30);
      $$('[data-semi-row]', form).forEach(row => row.remove());
      for (const r of source) {
        const row = addRow(); if (!row) break; const set = (key, value) => { const input = $(`[data-k="${key}"]`, row); if (input) input.value = value ?? ''; };
        set('product', `${r.product_group}|${r.product_type}`); $('[data-k="product"]', row).onchange();
        if (r.bom_id) { set('bom_id', String(r.bom_id)); $('[data-k="bom_id"]', row).onchange(); }
        if (r.product_group === 'seamless') set('size', r.spec); else set('inch', r.spec ? parseFloat(r.spec) : '');
        set('unit', r.unit); set('start_time', r.start_time); set('end_time', r.end_time); set('break_minutes', r.break_minutes || ''); set('workers', r.workers);
        $('[data-k="start_time"]', row).oninput();
      }
      countRows(); toast(`${latest} 입력 ${source.length}줄을 불러왔습니다. 수량을 입력하세요.`); $('[data-k="qty"]', form)?.focus();
    } catch (error) { fail(error); }
  };
  let lastRows = [];
  const productOf = value => { const [product_group, product_type] = String(value).split('|'); return { product_group, product_type: product_type || '' }; };
  const load = async () => {
    const mine = ++version;
    const [rows, pending] = await Promise.all([api('GET', '/api/semi-records?' + new URLSearchParams({ process, ...formObj(filters) })), api('GET', `/api/semi-changes?status=pending&process=${process}`)]);
    if (mine !== version || !main.isConnected) return;
    $('#semiPending').innerHTML = pending.length ? `<div class="card"><h3>수정·삭제 승인 대기 <span class="chip yellow">${pending.length}건</span></h3><p class="small muted">${canApproveSemi() ? '승인하면 기록과 합계에 바로 반영됩니다.' : '생산팀장 승인 후 반영됩니다.'}</p><div class="table-wrap"><table class="grid"><thead><tr><th>요청 내용</th><th>사유</th><th>요청자</th><th></th></tr></thead><tbody>${pending.map(c => `<tr><td>${semiChangeText(c)}</td><td>${esc(c.reason)}</td><td>${esc(c.requested_by)}<br><span class="small muted">${esc(c.requested_at)}</span></td><td class="nowrap">${semiChangeButtons(c)}</td></tr>`).join('')}</tbody></table></div></div>` : '';
    bindSemiChanges($('#semiPending'), async () => { await load(); refreshNavBadges(); });
    $('#semiCount').textContent = `${rows.length}건`;
    if (process === 'wash') api('GET', '/api/semi-wip').then(wip => {
      if (!main.isConnected) return; const waiting = wip.filter(r => r.waiting_qty !== 0);
      $('#semiWip').innerHTML = `<details class="card" ${waiting.some(r => r.waiting_qty > 0) ? 'open' : ''}><summary><h3>세탁 대기 <span class="small muted">커팅/융착 양품 누계 − 세탁 처리(양품+불량) 누계</span></h3></summary>${waiting.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th>사이즈·규격</th><th class="r">커팅/융착 양품</th><th class="r">세탁 처리</th><th class="r">세탁 대기</th><th>최근 기록</th></tr></thead><tbody>${waiting.map(r => `<tr class="${r.waiting_qty < 0 ? 'row-yellow' : ''}"><td><b>${esc(r.item)}</b></td><td>${esc(r.spec) || '<span class="muted">—</span>'}</td><td class="r">${fmtNum(r.cut_qty)}</td><td class="r">${fmtNum(r.washed_qty)}</td><td class="r"><b class="${r.waiting_qty < 0 ? 'red-text' : ''}">${fmtNum(r.waiting_qty)}</b> ${esc(r.unit)}</td><td class="small muted">${esc(r.last_date)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">세탁 기록에 품목·사이즈를 커팅/융착 기록과 같게 적어야 서로 맞춰집니다. 음수(노란 줄)는 커팅/융착 기록 없이 세탁만 입력된 경우입니다.</p>` : '<p class="muted small">세탁을 기다리는 반제품이 없습니다.</p>'}</details>`;
    }).catch(() => {});
    lastRows = rows; $('#semiSummary').innerHTML = semiSummary(process, rows) + ($('#semiDetail').checked ? semiDetail(process, rows) : '');
    $('#semiInches', main).innerHTML = [...new Set(rows.filter(r => r.product_group === 'wiper' && r.spec).map(r => parseFloat(r.spec)))].sort((a, b) => a - b).map(v => `<option value="${v}">`).join('');
    $('#semiList').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>작업일</th><th>${page.unitLabel}</th><th>품목</th><th>사이즈·규격</th><th class="r">양품</th><th class="r">불량</th><th class="r">수율</th><th>시간 · 인원</th><th>LOT</th><th>비고</th><th>입력자</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr>
      <td class="nowrap">${esc(r.work_date)} (${dow(r.work_date)})</td><td>${esc(r.unit_name)}</td><td><span class="chip">${esc(SEMI_PRODUCTS[r.product_group].label)}</span> ${esc(r.product_type ? semiTypeLabel(r) : '')}${r.item_name ? `<div><b>${esc(r.item_name)}</b>${r.product_code && r.product_code !== r.item_name ? ` <span class="small muted">${esc(r.product_code)}</span>` : ''}</div>` : ''}</td><td>${esc(r.spec) || '<span class="muted">—</span>'}</td>
      <td class="r"><b>${fmtNum(r.qty)}</b> ${esc(r.unit)}</td><td class="r">${r.defect_qty ? `<span class="red-text">${fmtNum(r.defect_qty)}</span><div class="small muted">${esc(r.defect_reason || '사유 미지정')}</div>` : '0'}</td><td class="r">${semiRate(r.qty, r.qty + (r.defect_qty || 0))}</td><td class="small">${[r.start_time && r.end_time ? `${esc(r.start_time)}~${esc(r.end_time)}` : '', r.work_hours != null ? fmtNum(r.work_hours) + '시간' + (r.break_minutes ? ` (휴게 ${r.break_minutes}분 제외)` : '') : '', r.workers != null ? fmtNum(r.workers) + '명' : ''].filter(Boolean).join(' · ')}</td><td>${esc(r.lot)}</td><td>${esc(r.note)}</td><td class="small muted">${esc(r.created_by)}${r.updated_by ? `<br>수정 ${esc(r.updated_by)}` : ''}</td>
      <td class="nowrap">${r.pending_change_id ? '<span class="chip yellow">승인 대기</span>' : canManage || ME.is_admin || r.created_by === ME.name ? `<button class="btn small" data-semi-edit="${i}">수정</button> <button class="btn small danger" data-semi-del="${i}">삭제 요청</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">이 기간에 기록이 없습니다.</div>';
    $$('[data-semi-edit]', main).forEach(button => button.onclick = async () => {
      const r = rows[button.dataset.semiEdit]; const units = await api('GET', `/api/production-units?kind=${page.unitKind}&all=1`);
      const v = await promptBox('작업 기록 수정', `<p class="small muted">불량수량·불량 사유·시작/종료 시각·휴게시간·생산인원·LOT·비고는 바로 반영됩니다. 양품수량·품목·사이즈·날짜·${page.unitLabel}을 바꾸면 <b>생산팀장 승인</b> 후 반영됩니다.</p><label>작업일 *<input name="work_date" type="date" required value="${esc(r.work_date)}" max="${todayStr()}"></label><label>${page.unitLabel} *<select name="unit_id" required>${units.filter(u => u.active || u.id === r.unit_id).map(u => `<option value="${u.id}" ${u.id === r.unit_id ? 'selected' : ''}>${esc(u.id === r.unit_id ? r.unit_name : u.name)}</option>`).join('')}</select></label>${semiProductSelect(process, r.product_group, r.product_type).replace('품목 *', '종류 *')}${models.length ? `<label>품목 (모델) <span class="hint">(종류에 맞는 것, 바꾸면 승인 필요)</span><select name="bom_id"><option value="">선택 안 함</option>${models.map(m => `<option value="${m.id}" ${m.id === r.bom_id ? 'selected' : ''}>[${esc(m.semi_type)}] ${esc(m.product)}</option>`).join('')}</select></label>` : ''}<label>사이즈·규격${process === 'cut' ? ' *' : ''} <span class="hint">(심리스: XS·S·M·L·XL / 와이퍼: 인치 숫자, 모델을 고르면 생략 가능)</span><input name="spec" maxlength="20" value="${esc(r.spec)}"></label><label>양품수량 * <span class="hint">(바꾸면 승인 필요)</span><input name="qty" type="number" min="0" step="any" required value="${esc(r.qty)}"></label><label>불량수량<input name="defect_qty" type="number" min="0" step="any" value="${esc(r.defect_qty)}"></label><label>불량 사유<select name="defect_reason"><option value="">미지정</option>${SEMI_DEFECT_REASONS[process].map(reason => `<option ${r.defect_reason === reason ? 'selected' : ''}>${reason}</option>`).join('')}</select></label><label>시작 시각<input name="start_time" type="time" value="${esc(r.start_time)}"></label><label>종료 시각<input name="end_time" type="time" value="${esc(r.end_time)}"></label><label>휴게시간 (분)<input name="break_minutes" type="number" min="0" step="1" value="${esc(r.break_minutes || '')}"></label><label>생산인원 (명)<input name="workers" type="number" min="0" step="1" value="${esc(r.workers)}"></label><label>단위<input name="unit" maxlength="20" value="${esc(r.unit)}"></label><label>LOT (선택)<input name="lot" maxlength="100" value="${esc(r.lot)}"></label><label>비고<input name="note" maxlength="500" value="${esc(r.note)}"></label><label>수정 사유 <span class="hint">(양품수량 등을 바꿀 때 필수)</span><input name="reason" maxlength="500"></label>`);
      if (!v) return;
      try {
        const result = await api('PUT', '/api/semi-records/' + r.id, { ...v, ...productOf(v.product), request_id: crypto.randomUUID() });
        toast(result.pending ? '수정 요청을 올렸습니다. 생산팀장 승인 후 반영됩니다.' : '수정했습니다.'); load();
      } catch (error) { fail(error); }
    });
    $$('[data-semi-del]', main).forEach(button => button.onclick = async () => {
      const r = rows[button.dataset.semiDel];
      const v = await promptBox('작업 기록 삭제 요청', `<p class="small muted">${esc(r.work_date)} ${esc(r.unit_name)} ${esc(semiTypeLabel(r))} ${esc(r.spec)} ${fmtNum(r.qty)} ${esc(r.unit)} · 생산팀장이 승인하면 삭제됩니다.</p><label>삭제 사유 *<input name="reason" required maxlength="500"></label>`);
      if (!v) return;
      try { await api('DELETE', '/api/semi-records/' + r.id, { ...v, request_id: crypto.randomUUID() }); toast('삭제 요청을 올렸습니다. 생산팀장 승인 후 반영됩니다.'); load(); } catch (error) { fail(error); }
    });
  };
  let entryDraft;
  form.onsubmit = async event => {
    event.preventDefault(); if (submit.disabled) return; submit.disabled = true; form.inert = true; entryDraft.start();
    const items = $$('[data-semi-row]', form).map(row => { const v = Object.fromEntries($$('[data-k]', row).map(input => [input.dataset.k, input.value])); const { product, size, inch, ...rest } = v; return { ...rest, ...productOf(product), spec: size || inch || '' }; });
    const date = form.work_date.value;
    try {
      const result = await api('POST', '/api/semi-batches', { process, common: { work_date: date, unit_id: form.unit_id.value }, items, request_id: requestId });
      entryDraft.clear();
      requestId = crypto.randomUUID(); toast(`작업 기록 ${result.rows.length}줄을 등록했습니다.`);
      // Keep the date and line; start again with one line that remembers the last product and unit.
      const last = $$('[data-semi-row]', form).at(-1); const fresh = addRow(last); $$('[data-semi-row]', form).forEach(row => { if (row !== fresh) row.remove(); }); countRows();
      if (date < filters.from.value) filters.from.value = date; if (date > filters.to.value) filters.to.value = date;
      await load();
    } catch (error) { entryDraft.failure(); fail(error); } finally { form.inert = false; submit.disabled = false; countRows(); entryDraft.resume(); }
  };
  filters.onsubmit = event => { event.preventDefault(); load().catch(fail); };
  $('#semiDetail').onchange = () => { $('#semiSummary').innerHTML = semiSummary(process, lastRows) + ($('#semiDetail').checked ? semiDetail(process, lastRows) : ''); };
  if (canManage) $('#semiManage').onclick = () => manageProductionUnits(page.unitKind, () => loadUnits().catch(fail)).catch(fail);
  await loadUnits(); rememberList(filters);
  entryDraft = bindEntryDraft(form, `semi:${process}`, {
    read: () => ({ fields: uxFormRead(form), lines: $$('[data-semi-row]', form).map(row => $$('[data-k]', row).map(input => [input.dataset.k, input.value])), requestId }),
    restore: value => {
      uxFormRestore(form, value.fields); rowsRoot.replaceChildren();
      for (const values of (value.lines || []).slice(0, 30)) {
        const row = addRow(), map = new Map(values);
        const set = key => { const input = $$('[data-k]', row).find(el => el.dataset.k === key); if (input && map.has(key)) input.value = String(map.get(key) ?? ''); return input; };
        set('product')?.onchange?.(); set('bom_id')?.onchange?.();
        for (const [key] of values) if (!['product', 'bom_id'].includes(key)) set(key);
        $('[data-k=defect_qty]', row).oninput(); $('[data-k=start_time]', row).oninput();
      }
      if (!rowsRoot.children.length) addRow();
      if (typeof value.requestId === 'string') requestId = value.requestId;
      countRows();
    },
  });
  await load();
}
