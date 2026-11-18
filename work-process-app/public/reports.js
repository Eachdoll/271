// Report views use the same filtered aggregates for charts, tables and export.
const REPORT_CHART_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#a855f7', '#64748b'];
const reportNumber = value => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 8 });
const reportTotal = (rows, field) => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
function reportPeriodLabel(bucket, grain) { return grain === 'month' ? bucket.slice(0, 7) : bucket.slice(5) + (grain === 'week' ? ' 주' : ''); }
function reportRange(grain) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (grain === 'week') return [addDays(mondayOf(today), -77), today];
  if (grain === 'month') { const date = parseD(monthStart(today)); date.setMonth(date.getMonth() - 11); return [fmtDate(date), today]; }
  return [addDays(today, -13), today];
}
function reportChart(title, rows, series, grain) {
  if (!rows.some(row => series.some(s => Number(row[s.key]) > 0))) return '<div class="report-empty">선택한 조건에 해당하는 수량·건수가 없습니다.</div>';
  const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches; // 15.219 휴대폰은 좁게 그려 화면 폭에 맞춤
  const width = phone ? Math.max(340, Math.min(1200, rows.length * 18 + 84)) : Math.max(640, Math.min(2400, rows.length * 44)), height = phone ? 240 : 270, left = phone ? 52 : 64, right = phone ? 12 : 20, top = 20, bottom = 45;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const max = Math.max(1, ...rows.flatMap(row => series.map(s => Number(row[s.key] || 0))));
  const step = plotWidth / rows.length, bar = Math.min(24, step * 0.72 / series.length);
  let svg = '';
  for (let i = 0; i <= 4; i++) {
    const value = max * i / 4, y = top + plotHeight * (1 - i / 4);
    svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="report-gridline"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${esc(reportNumber(value))}</text>`;
  }
  rows.forEach((row, i) => {
    series.forEach((s, j) => {
      const value = Number(row[s.key] || 0), h = value / max * plotHeight;
      const x = left + step * (i + 0.5) + (j - series.length / 2) * bar;
      svg += `<rect x="${x}" y="${top + plotHeight - h}" width="${Math.max(0.4, bar - 1)}" height="${h}" rx="1" fill="${REPORT_CHART_COLORS[j]}"><title>${esc(row.bucket)} · ${esc(s.label)}: ${esc(reportNumber(value))}</title></rect>`;
    });
    if (i % Math.max(1, Math.ceil(rows.length / 10)) === 0 || i === rows.length - 1) svg += `<text x="${left + step * (i + 0.5)}" y="${height - 18}" text-anchor="middle">${esc(reportPeriodLabel(row.bucket, grain))}</text>`;
  });
  return `<div class="report-legend">${series.map((s, i) => `<span><i style="background:${REPORT_CHART_COLORS[i]}"></i>${esc(s.label)}</span>`).join('')}</div><div class="report-chart-scroll" tabindex="0" role="region" aria-label="차트 (좌우로 스크롤)"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}" style="min-width:${phone ? (width > 420 ? width : 0) : Math.min(width, 960)}px"><title>${esc(title)}</title>${svg}</svg></div>`;
}
function reportSeries(buckets, rows, unit, fields) {
  const map = new Map(buckets.map(bucket => [bucket, { bucket, ...Object.fromEntries(fields.map(field => [field, 0])) }]));
  for (const row of rows) {
    if (row.unit !== unit || !map.has(row.bucket)) continue;
    const target = map.get(row.bucket);
    for (const field of fields) target[field] += Number(row[field] || 0);
  }
  return [...map.values()];
}
function reportCsv(rows) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
function exportReport(report) {
  const rows = [['업무', '기간', '품목', '분류', '단위', '지표', '값']];
  for (const row of report.analysis.series) { rows.push(['분석', row.bucket, '', '', '건', '등록', row.total], ['분석', row.bucket, '', '', '건', '현재 완료(등록기간 기준)', row.done]); }
  for (const row of report.receipts.series) rows.push([row.source === 'purchase' ? '발주입고' : '기타입고', row.bucket, row.item, row.item_category, row.unit, '입고수량', row.qty], ['입고', row.bucket, row.item, row.item_category, '건', '이상 있음', row.abnormal]);
  for (const row of report.production.series) rows.push(['생산', row.bucket, row.item, row.item_category, row.unit, '계획수량', row.planned_qty], ['생산', row.bucket, row.item, row.item_category, row.unit, '완료 체크 수량', row.completed_qty], ['생산', row.bucket, row.item, row.item_category, row.unit, '실제 생산량', row.actual_qty], ['생산', row.bucket, row.item, row.item_category, row.unit, '계획 대비 차이', row.variance_qty]);
  for (const row of report.shipments.series) rows.push(['출하', row.bucket, row.item, row.item_category, row.unit, '출하수량', row.qty]);
  for (const row of report.semi?.rows || []) { const name = (row.process === 'cut' ? '반제품 커팅/융착' : '반제품 세탁') + ' · ' + row.unit_name, item = row.product + (row.spec ? ' [' + row.spec + ']' : '');
    rows.push([name, '', item, '반제품', row.unit, '양품수량', row.qty], [name, '', item, '반제품', row.unit, '불량수량', row.defect_qty], [name, '', item, '반제품', row.unit, '총 수량(양품+불량)', row.total_qty], [name, '', item, '반제품', '%', '수율', row.yield_rate ?? ''], [name, '', item, '반제품', '%', '불량률', row.defect_rate ?? ''], [name, '', item, '반제품', '시간', '작업시간', row.work_hours], [name, '', item, '반제품', '인시', '투입 인시', row.man_hours]); }
  for (const row of report.semi?.series || []) rows.push([(row.process === 'cut' ? '반제품 커팅/융착' : '반제품 세탁') + ' 수율 추이', row.bucket, row.group, '반제품', '%', '수율', row.yield_rate ?? ''], [(row.process === 'cut' ? '반제품 커팅/융착' : '반제품 세탁') + ' 수율 추이', row.bucket, row.group, '반제품', '%', '불량률', row.defect_rate ?? '']);
  for (const row of report.semi?.reasons || []) rows.push([(row.process === 'cut' ? '반제품 커팅/융착' : '반제품 세탁') + ' 불량 사유', '', row.reason, '반제품', row.unit, '불량수량', row.defect_qty], [(row.process === 'cut' ? '반제품 커팅/융착' : '반제품 세탁') + ' 불량 사유', '', row.reason, '반제품', '%', '비중', row.share ?? '']);
  const grains = { day: '일간', week: '주간', month: '월간' };
  const exported = rows.map((row, i) => i === 0 ? ['집계일시', '집계 단위', '생산 일정 기준', ...row] : [report.generated_at, grains[report.range.grain], grains[report.range.plan_period], ...row]);
  const url = URL.createObjectURL(new Blob([reportCsv(exported)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `서울세미텍-리포트-${report.range.from}-${report.range.to}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function pageReports(main) {
  const [from, to] = reportRange('day'); let current = null, requestId = 0, selectedUnit = '';
  main.innerHTML = `<div class="report-heading"><div><h1>리포트 · 통계</h1><p class="muted">분석 처리 현황과 입고·생산·출하 데이터를 기간별로 확인합니다.</p></div><div class="actions"><button class="btn" id="reportCsv" disabled>전체 단위 CSV</button><button class="btn" id="reportPrint" disabled>인쇄 · PDF</button></div></div>
    <form class="card report-filters" id="reportForm" data-read-only="true"><div class="form-grid">
    <label>집계 단위<select name="grain" id="reportGrain"><option value="day">일간</option><option value="week">주간 (월요일 시작)</option><option value="month">월간</option></select></label>
    <label>시작일<input name="from" type="date" required value="${from}"></label><label>종료일<input name="to" type="date" required value="${to}"></label>
    <label>품목 분류<select name="item_category">${categoryOptions('', true)}<option value="미분류">미분류</option></select></label>
    <label>품목·거래처 검색<input name="q" type="search" maxlength="200" placeholder="품목명 또는 거래처"></label>
    <label>생산일정 기준<select name="plan_period"><option value="day">일간 생산일정</option><option value="week">주간 생산일정</option><option value="month">월간 생산일정</option></select></label></div>
    <div class="actions wrap"><button type="submit" class="btn primary">리포트 조회</button><button type="button" class="btn" data-report-range="week">이번 주</button><button type="button" class="btn" data-report-range="month">이번 달</button><button type="button" class="btn" data-report-range="year">올해</button><span class="muted small">최대 3년 · 한국 시간 기준</span></div></form>
    <div class="report-meta"><p id="reportStamp" class="small muted" role="status"></p><label class="inline">수량 차트 단위 <select id="reportUnit" aria-label="수량 차트 단위" disabled></select></label></div>
    <div id="reportContent" aria-live="polite"></div>`;
  const form = $('#reportForm', main), content = $('#reportContent', main), unitSelect = $('#reportUnit', main);
  const loadDept = mountDeptReports(main, form); // 15.120 공통 + 부서별
  const draw = () => {
    const report = current; if (!report) return;
    const unit = selectedUnit, grain = report.range.grain;
    const incoming = report.buckets.map(bucket => {
      const rows = report.receipts.series.filter(row => row.bucket === bucket && row.unit === unit);
      return { bucket, purchase: reportTotal(rows.filter(row => row.source === 'purchase'), 'qty'), other: reportTotal(rows.filter(row => row.source === 'other'), 'qty') };
    });
    const production = reportSeries(report.buckets, report.production.series, unit, ['planned_qty', 'completed_qty', 'actual_qty']);
    const shipping = reportSeries(report.buckets, report.shipments.series, unit, ['qty']);
    const incomingTotal = report.receipts.by_unit.find(row => row.unit === unit)?.qty || 0;
    const productionTotal = report.production.by_unit.find(row => row.unit === unit) || {};
    const shippingTotal = report.shipments.by_unit.find(row => row.unit === unit)?.qty || 0;
    const card = (label, value, detail) => `<div class="card report-kpi"><span class="muted">${label}</span><strong>${value}</strong><span class="small muted">${detail}</span></div>`;
    const ranking = (rows, key) => {
      const top = rows.filter(row => row.unit === unit).sort((a, b) => b[key] - a[key]).slice(0, 10);
      return top.length ? `<table class="grid"><thead><tr><th>품목</th><th>분류</th><th class="r">수량</th></tr></thead><tbody>${top.map(row => `<tr><td>${esc(row.item)}</td><td>${esc(row.item_category)}</td><td class="r">${reportNumber(row[key])}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">해당 단위의 데이터가 없습니다.</p>';
    };
    content.innerHTML = `<div class="report-kpis">
      ${card('분석 등록', reportNumber(report.analysis.total) + '건', `현재 완료 ${reportNumber(report.analysis.statuses.done)}건 · 완료율 ${reportNumber(report.analysis.completion_rate)}%`)}
      ${card('입고수량 · 선택 단위', reportNumber(incomingTotal), `${esc(unit || '데이터 없음')} · 전체 입고 ${report.receipts.count}건 / 이상 ${report.receipts.abnormal_count}건`)}
      ${card('실제 생산량 · 선택 단위', reportNumber(productionTotal.actual_qty), `${esc(unit || '데이터 없음')} · 계획수량 ${reportNumber(productionTotal.planned_qty)} / 전체 일정 ${report.production.plans}건`)}
      ${card('출하수량 · 선택 단위', reportNumber(shippingTotal), `${esc(unit || '데이터 없음')} · 전체 출하 ${report.shipments.count}건`)}</div>
      <div class="report-chart-grid"><section class="card"><h3>분석 등록 · 현재 완료</h3>${reportChart('분석 등록 및 현재 완료 건수', report.analysis.series, [{ key: 'total', label: '등록' }, { key: 'done', label: '현재 완료' }], grain)}<p class="small muted">${esc(report.definitions.analysis)}</p></section>
      <section class="card"><h3>입고수량 추이 <span class="tag">${esc(unit || '단위 선택')}</span></h3>${reportChart('발주입고와 기타입고 수량', incoming, [{ key: 'purchase', label: '발주입고' }, { key: 'other', label: '기타입고' }], grain)}</section>
      <section class="card"><h3>생산계획 · 실제 생산량 <span class="tag">${esc(unit || '단위 선택')}</span></h3>${reportChart('생산계획 및 실제 생산량', production, [{ key: 'planned_qty', label: '계획' }, { key: 'actual_qty', label: '실제 생산' }, { key: 'completed_qty', label: '완료 체크' }], grain)}</section>
      <section class="card"><h3>출하수량 추이 <span class="tag">${esc(unit || '단위 선택')}</span></h3>${reportChart('출하수량', shipping, [{ key: 'qty', label: '출하' }], grain)}</section></div>
      <div class="report-chart-grid"><section class="card"><h3>분석 현재 상태</h3><div class="report-statuses">${Object.entries(report.analysis.statuses).map(([status, count]) => `<div><span>${esc(STATUS[status])}</span><div class="report-status-track"><i style="width:${report.analysis.total ? count / report.analysis.total * 100 : 0}%"></i></div><b>${reportNumber(count)}건</b></div>`).join('')}</div></section>
      <section class="card"><h3>단위·품목별 합계</h3><div class="table-wrap"><table class="grid"><thead><tr><th>단위 / 미지정 품목</th><th class="r">입고</th><th class="r">생산계획</th><th class="r">완료 체크</th><th class="r">실제 생산</th><th class="r">계획 차이</th><th class="r">달성률</th><th class="r">출하</th></tr></thead><tbody>${report.units.map(value => { const r = report.receipts.by_unit.find(row => row.unit === value) || {}; const p = report.production.by_unit.find(row => row.unit === value) || {}; const s = report.shipments.by_unit.find(row => row.unit === value) || {}; return `<tr><td>${esc(value)}</td><td class="r">${reportNumber(r.qty)}</td><td class="r">${reportNumber(p.planned_qty)}</td><td class="r">${reportNumber(p.completed_qty)}</td><td class="r">${reportNumber(p.actual_qty)}</td><td class="r">${reportNumber(p.variance_qty)}</td><td class="r">${p.achievement_rate ?? '—'}%</td><td class="r">${reportNumber(s.qty)}</td></tr>`; }).join('') || '<tr><td colspan="8">수량 데이터가 없습니다.</td></tr>'}</tbody></table></div></section>
      <section class="card"><h3>입고수량 상위 10개 품목</h3><p class="small muted">${esc(unit || '단위 선택')}</p><div class="table-wrap">${ranking(report.receipts.items, 'qty')}</div></section><section class="card"><h3>생산계획 상위 10개 품목</h3><p class="small muted">${esc(unit || '단위 선택')}</p><div class="table-wrap">${ranking(report.production.items, 'planned_qty')}</div></section></div>
      <details class="card"><summary>기간별 상세 수치</summary><div class="table-wrap"><table class="grid"><thead><tr><th>기간 시작</th><th class="r">분석등록</th><th class="r">현재완료</th><th class="r">발주입고</th><th class="r">기타입고</th><th class="r">생산계획</th><th class="r">완료 체크</th><th class="r">실제 생산</th><th class="r">출하</th></tr></thead><tbody>${report.buckets.map((bucket, i) => `<tr><td>${esc(bucket)}</td><td class="r">${reportNumber(report.analysis.series[i].total)}</td><td class="r">${reportNumber(report.analysis.series[i].done)}</td><td class="r">${reportNumber(incoming[i].purchase)}</td><td class="r">${reportNumber(incoming[i].other)}</td><td class="r">${reportNumber(production[i].planned_qty)}</td><td class="r">${reportNumber(production[i].completed_qty)}</td><td class="r">${reportNumber(production[i].actual_qty)}</td><td class="r">${reportNumber(shipping[i].qty)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">수량 열: ${esc(unit || '데이터 없음')}</p></details>
      ${semiReportSection(report)}
      <details class="card report-definitions"><summary>집계 기준</summary>${Object.values(report.definitions).map(text => `<p class="small muted">${esc(text)}</p>`).join('')}</details>`;
  };
  const load = async () => {
    loadDept().catch(fail);
    const id = ++requestId; const values = formObj(form);
    const button = $('button[type=submit]', form); button.disabled = true;
    $('#reportStamp', main).textContent = '리포트를 집계하고 있습니다…';
    $('#reportCsv', main).disabled = $('#reportPrint', main).disabled = true;
    try {
      const report = await api('GET', '/api/reports?' + new URLSearchParams(values));
      if (id !== requestId || !main.isConnected) return;
      current = report;
      if (!report.units.includes(selectedUnit)) selectedUnit = report.units.includes('EA') ? 'EA' : report.units[0] || '';
      unitSelect.innerHTML = report.units.length ? report.units.map(unit => `<option value="${esc(unit)}">${esc(unit)}</option>`).join('') : '<option value="">수량 데이터 없음</option>';
      unitSelect.value = selectedUnit; unitSelect.disabled = !report.units.length;
      $('#reportStamp', main).textContent = `${report.range.from} ~ ${report.range.to} · ${report.range.timezone} · 조회자 ${ME.name} · 집계 ${report.generated_at}`;
      draw(); $('#reportCsv', main).disabled = $('#reportPrint', main).disabled = false;
    } catch (error) { if (id === requestId) { current = null; content.innerHTML = `<div class="card empty">${esc(error.message)}</div>`; $('#reportStamp', main).textContent = '조회 조건을 확인해 주세요.'; } }
    finally { if (id === requestId) button.disabled = false; }
  };
  rememberList(form);
  form.onsubmit = event => { event.preventDefault(); load(); };
  $('#reportGrain', main).onchange = () => { const [start, end] = reportRange(form.elements.grain.value); form.elements.from.value = start; form.elements.to.value = end; load(); };
  unitSelect.onchange = () => { selectedUnit = unitSelect.value; draw(); };
  $$('[data-report-range]', main).forEach(button => button.onclick = () => {
    const today = reportRange('day')[1]; form.elements.from.value = button.dataset.reportRange === 'week' ? mondayOf(today) : button.dataset.reportRange === 'year' ? today.slice(0, 4) + '-01-01' : monthStart(today); form.elements.to.value = today; load();
  });
  $('#reportCsv', main).onclick = () => { if (current) exportReport(current); };
  $('#reportPrint', main).onclick = () => { document.body.classList.add('printing-report'); try { window.print(); } finally { document.body.classList.remove('printing-report'); } };
  await load();
}

// ── 15.120 부서별 리포트(위 공통 · 아래 자기 부서, 탭으로 다른 부서도) ──
const DEPT_TABS = [['sales', '영업'], ['purchase', '구매'], ['production', '생산'], ['quality', '품질'], ['dev', '개발'], ['logistics', '물류']];
const ROLE_DEPT = { sales: 'sales', purchase: 'purchase', production: 'production', production_approver: 'production', operator: 'production', quality: 'quality', quality_approver: 'quality', dev: 'dev', dev_approver: 'dev', logistics: 'logistics', logistics_approver: 'logistics' };
const myDept = () => { for (const r of ME?.roles || []) if (ROLE_DEPT[r]) return ROLE_DEPT[r]; return 'sales'; };
function deptValue(v, type, unit = '') {
  if (v == null || v === '') return '—';
  if (type === 'text') return esc(v);
  if (type === 'pct') return `${reportNumber(v)}%`;
  if (type === 'won') return `${reportNumber(Math.trunc(v))}원`;
  return `${reportNumber(Math.round(Number(v) * 1000) / 1000)}${unit ? ' ' + esc(unit) : ''}`;
}
function deptCell(v, type) { if (v == null || v === '') return '<td class="muted">—</td>'; if (!type || type === 'text') return `<td>${esc(v)}</td>`; if (type === 'won') return `<td class="r">${reportNumber(Math.trunc(v))}</td>`; if (type === 'pct') return `<td class="r">${reportNumber(v)}%</td>`; return `<td class="r">${reportNumber(Math.round(Number(v) * 1000) / 1000)}</td>`; }
function deptHtml(d) {
  const kpis = `<div class="report-kpis">${d.kpis.map(k => `<a class="card report-kpi dept-kpi ${k.tone ? 'tone-' + k.tone : ''}" href="${k.href || '#/reports'}"><span class="muted">${esc(k.label)}</span><strong>${deptValue(k.value, k.type, k.unit)}</strong><span class="small muted">${esc(k.detail || '')}</span></a>`).join('')}</div>`;
  const charts = d.charts.length ? `<div class="report-chart-grid">${d.charts.map(c => `<section class="card"><h3>${esc(c.title)}${c.type === 'won' ? ' <span class="tag">원</span>' : c.type === 'pct' ? ' <span class="tag">%</span>' : ''}</h3>${reportChart(c.title, c.rows, c.series, d.grain)}</section>`).join('')}</div>` : '';
  const tables = d.tables.map(tb => `<section class="card"><h3>${esc(tb.title)}${tb.href ? ` <a class="small" href="${tb.href}">자세히 →</a>` : ''}</h3>${tb.rows.length ? `<div class="table-wrap"><table class="grid" data-keep-cols><thead><tr>${tb.columns.map(c => `<th${c.type && c.type !== 'text' ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${tb.rows.map((r, i) => `<tr${tb.links?.[i] ? ` data-dept-link="${esc(tb.links[i])}" class="dept-link"` : ''}>${r.map((v, j) => deptCell(v, tb.columns[j]?.type)).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="muted small">${esc(tb.empty || '기간 안에 자료가 없습니다.')}</p>`}</section>`).join('');
  return kpis + charts + `<div class="report-chart-grid dept-tables">${tables}</div>`;
}
function deptXlsx(d, label) {
  const rows = [['구분', '항목', '값', '설명'], ...d.kpis.map(k => ['요약', k.label, k.type === 'text' ? k.value : k.value ?? '', k.detail || ''])];
  for (const c of d.charts) for (const r of c.rows) for (const s of c.series) rows.push([c.title, `${r.bucket} · ${s.label}`, r[s.key] ?? '', '']);
  for (const tb of d.tables) for (const r of tb.rows) rows.push([tb.title, String(r[0] ?? ''), r.slice(1).map(v => v ?? '').join(' / '), tb.columns.slice(1).map(c => c.label).join(' / ')]);
  xlsxDownload(`리포트_${label}_${d.from}_${d.to}.xlsx`, { sheet: label, titles: [`리포트 · ${label}`, `${d.from} ~ ${d.to}`], columns: rows[0].map(l => ({ label: l, type: 'text' })), rows: rows.slice(1) });
}
async function reportSettingsWindow(after) {
  const s = await api('GET', '/api/report-settings');
  const m = modal(`<h3>리포트 기준값</h3><p class="small muted">부서별 리포트의 판단 기준입니다. ${ME.is_admin ? '바꾸면 모든 직원의 리포트에 바로 적용됩니다.' : '관리자만 바꿀 수 있습니다.'}</p>
    <form class="form-grid">${Object.entries(s.values).map(([k, v]) => `<label>${esc(s.labels[k])}<input type="number" name="${k}" min="0" max="3650" step="1" value="${v}" ${ME.is_admin ? '' : 'readonly'}><span class="hint">기본 ${s.defaults[k]}</span></label>`).join('')}
    <div class="actions span3"><button type="button" class="btn" data-close>닫기</button>${ME.is_admin ? '<button class="btn primary">저장</button>' : ''}</div></form>`);
  $('[data-close]', m.el).onclick = m.close;
  $('form', m.el).onsubmit = async e => { e.preventDefault(); try { await api('PUT', '/api/report-settings', formObj(e.target)); toast('기준값을 저장했습니다.'); m.close(); await after?.(); } catch (error) { fail(error); } };
}
function mountDeptReports(main, form) {
  let dept = myDept(); try { dept = localStorage.getItem('wpa:report-dept') || dept; } catch { /* 편의 기능 */ }
  if (!DEPT_TABS.some(([k]) => k === dept)) dept = myDept();
  const box = document.createElement('div'); box.id = 'deptReports';
  box.innerHTML = `<section class="dept-sec" id="deptCommon"><div class="dept-head"><h2>공통</h2><span class="small muted" data-dept-range></span><button type="button" class="btn small" data-dept-xlsx="common">엑셀</button><button type="button" class="btn small" id="deptSettings">기준값${ME.is_admin ? ' 설정' : ''}</button></div><div data-dept-body><p class="muted">불러오는 중…</p></div></section>
    <section class="dept-sec" id="deptMine"><div class="dept-head"><h2>부서별</h2><div class="seg" id="deptTabs" role="tablist">${DEPT_TABS.map(([k, l]) => `<button type="button" role="tab" data-dept="${k}">${l}${k === myDept() ? ' <span class="sub-count">내 부서</span>' : ''}</button>`).join('')}</div><button type="button" class="btn small" data-dept-xlsx="mine">엑셀</button></div><div data-dept-body><p class="muted">불러오는 중…</p></div></section>
    <h2 class="dept-detail-title">수량 상세 <span class="small muted">입고·생산·출하·분석(기존 리포트)</span></h2>`;
  form.after(box);
  const data = {}; let version = 0;
  const params = section => new URLSearchParams({ section, from: form.elements.from.value, to: form.elements.to.value, grain: form.elements.grain.value });
  const draw = (sel, d) => { const body = $(`${sel} [data-dept-body]`, box); body.innerHTML = deptHtml(d); $$('[data-dept-link]', body).forEach(tr => tr.onclick = () => { location.hash = tr.dataset.deptLink; }); };
  const markTabs = () => $$('#deptTabs [data-dept]', box).forEach(b => { const on = b.dataset.dept === dept; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  const loadMine = async mine => { const d = await api('GET', '/api/reports/dept?' + params(dept)); if (mine !== version || !box.isConnected) return; data.mine = d; draw('#deptMine', d); };
  const load = async () => {
    const mine = ++version; markTabs();
    const [c] = await Promise.all([api('GET', '/api/reports/dept?' + params('common')), loadMine(mine)]);
    if (mine !== version || !box.isConnected) return; data.common = c; draw('#deptCommon', c);
    $('[data-dept-range]', box).textContent = `${c.from} ~ ${c.to}`;
  };
  $$('#deptTabs [data-dept]', box).forEach(b => b.onclick = () => { dept = b.dataset.dept; try { localStorage.setItem('wpa:report-dept', dept); } catch { /* 편의 기능 */ } markTabs(); $('#deptMine [data-dept-body]', box).innerHTML = '<p class="muted">불러오는 중…</p>'; loadMine(version).catch(fail); });
  $$('[data-dept-xlsx]', box).forEach(b => b.onclick = () => { const d = data[b.dataset.deptXlsx]; if (d) deptXlsx(d, b.dataset.deptXlsx === 'common' ? '공통' : DEPT_TABS.find(([k]) => k === dept)[1]); });
  $('#deptSettings', box).onclick = () => reportSettingsWindow(load).catch(fail);
  return load;
}
