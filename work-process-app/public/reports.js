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

// ── 15.276 개발 스케줄 관리: 개발리스트 제품을 단기·중장기·장기로 나눠 공정표(단계)·현재 진행·다음 예정·완료예정일을 로드맵으로 ──
const DEV_TERM = [['short', '단기', '#2f9e44'], ['mid', '중장기', '#1c7ed6'], ['long', '장기', '#7048e8'], ['', '구분 미지정', '#868e96']];
const DEV_STEP_STATE = { todo: ['예정', '#adb5bd'], doing: ['진행 중', '#1c7ed6'], done: ['완료', '#2f9e44'] };
const devDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
async function devPlanEditor(r, done) {
  const canEdit = hasRole('dev') || hasRole('dev_approver');
  const stepRow = (x = {}) => `<tr data-step><td><input data-s="name" maxlength="100" value="${esc(x.name || '')}" placeholder="예) 샘플 제작" aria-label="공정명"></td><td><input type="date" data-s="start_date" value="${esc(x.start_date || '')}" aria-label="시작"></td><td><input type="date" data-s="end_date" value="${esc(x.end_date || '')}" aria-label="종료"></td><td><select data-s="status" aria-label="상태">${Object.entries(DEV_STEP_STATE).map(([k, [l]]) => `<option value="${k}"${(x.status || 'todo') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td><input data-s="note" maxlength="200" value="${esc(x.note || '')}" aria-label="메모"></td><td><button type="button" class="btn small danger" data-step-del aria-label="빼기">×</button></td></tr>`;
  let root = null;
  const saved = await promptBox(`개발 스케줄 · ${r.title}`, `<p class="small muted">${esc([r.req_no, r.customer, r.requester_name && '의뢰 ' + r.requester_name].filter(Boolean).join(' · '))}${r.due_date ? ` · 의뢰 납기 ${esc(r.due_date)}` : ''}</p>
    <div class="form-grid">
      <label>구분<select name="term">${DEV_TERM.map(([k, l]) => `<option value="${k}"${(r.term || '') === k ? ' selected' : ''}>${k ? l : '선택'}</option>`).join('')}</select></label>
      <label>시작일<input type="date" name="start_date" value="${esc(r.start_date || '')}"></label>
      <label>완료예정일<input type="date" name="target_date" value="${esc(r.target_date || r.due_date || '')}"></label>
      <label>진행률 (%)<span class="dev-prog"><input type="range" data-prog-range min="0" max="100" step="5" value="${r.progress || 0}" aria-label="진행률 막대"><input type="number" name="progress" min="0" max="100" step="5" value="${r.progress || 0}"></span></label>
      <label class="span2">현재 진행현황<input name="current_stage" maxlength="300" value="${esc(r.current_stage || '')}" placeholder="예) 1차 샘플 고객 평가 중"></label>
      <label>다음 진행예정<input name="next_step" maxlength="300" value="${esc(r.next_step || '')}" placeholder="예) 2차 샘플 제작"></label>
      <label>다음 예정일<input type="date" name="next_date" value="${esc(r.next_date || '')}"></label>
      <label class="span2">메모<input name="note" maxlength="500" value="${esc(r.note || '')}"></label>
    </div>
    <fieldset class="vendor-sec"><legend>공정표 <span class="hint">(단계별 기간·상태 — 로드맵 막대 안에 표시)</span></legend>
      <div class="table-wrap"><table class="grid keep-table dev-steps" data-no-sort data-no-filter data-keep-cols><thead><tr><th>공정</th><th>시작</th><th>종료</th><th>상태</th><th>메모</th><th></th></tr></thead><tbody data-steps>${(r.steps?.length ? r.steps : [{}]).map(stepRow).join('')}</tbody></table></div>
      <div class="actions" style="justify-content:flex-start"><button type="button" class="btn small" data-step-add>＋ 공정 추가</button><button type="button" class="btn small" data-step-tpl title="시작일~완료예정일 사이에 고르게 나눠 넣습니다">기본 공정 넣기</button><span class="grow"></span><button type="button" class="btn small" data-step-prog title="완료 공정 = 100%, 진행 중 = 절반으로 계산">공정으로 진행률 계산</button><button type="button" class="btn small" data-step-now title="진행 중 공정 → 현재, 다음 예정 공정 → 다음·다음 예정일">공정에서 현재·다음 채우기</button></div></fieldset>`, { wide: true,
    onOpen: el => { root = el; el.classList.add('vendor-modal'); if (!canEdit) el.querySelectorAll('input, select').forEach(i => { i.disabled = true; });
      // 15.281 진행률 막대 ↔ 숫자, 기본 공정·진행률 계산·현재/다음 채우기
      const prog = el.querySelector('[name=progress]'), range = el.querySelector('[data-prog-range]');
      range.oninput = () => { prog.value = range.value; }; prog.oninput = () => { range.value = prog.value; };
      const plusDay = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
      const stepsNow = () => [...el.querySelectorAll('[data-step]')].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-s]')].map(i => [i.dataset.s, i.value.trim()]))).filter(x => x.name);
      el.addEventListener('click', e => {
        if (e.target.closest('[data-step-tpl]')) {
          const f = el.querySelector('[name=start_date]'), t = el.querySelector('[name=target_date]'); if (!f.value) f.value = todayStr(); if (!t.value || t.value <= f.value) t.value = plusDay(f.value, 90);
          const names = ['자료 조사 · 사양 확정', '1차 샘플 제작', '고객 평가', '2차 샘플 · 보완', '양산 준비 · 이관'], total = devDays(f.value, t.value) + 1, b = el.querySelector('[data-steps]');
          const fill = () => { b.innerHTML = names.map((name, i) => stepRow({ name, start_date: plusDay(f.value, Math.floor(total * i / names.length)), end_date: plusDay(f.value, Math.floor(total * (i + 1) / names.length) - 1), status: 'todo' })).join(''); };
          if (stepsNow().length) confirmBox('지금 공정표를 기본 공정 5단계로 바꿀까요?').then(ok => { if (ok) fill(); }); else fill(); return;
        }
        if (e.target.closest('[data-step-prog]')) { const st = stepsNow(); if (!st.length) return toast('공정을 먼저 넣으세요.', 'err'); prog.value = range.value = Math.round((st.filter(x => x.status === 'done').length + st.filter(x => x.status === 'doing').length * 0.5) / st.length * 100); return; }
        if (e.target.closest('[data-step-now]')) { const st = stepsNow(), cur = st.find(x => x.status === 'doing'), nx = st.find(x => x.status === 'todo'); if (!st.length) return toast('공정을 먼저 넣으세요.', 'err');
          if (cur) el.querySelector('[name=current_stage]').value = cur.name; if (nx) { el.querySelector('[name=next_step]').value = nx.name; if (nx.start_date) el.querySelector('[name=next_date]').value = nx.start_date; } return; }
        if (e.target.closest('[data-step-add]')) { const b = el.querySelector('[data-steps]'), last = b.lastElementChild, le = last?.querySelector('[data-s=end_date]')?.value; b.insertAdjacentHTML('beforeend', stepRow(le ? { start_date: plusDay(le, 1) } : {})); b.lastElementChild.querySelector('input').focus(); }
        const del = e.target.closest('[data-step-del]'); if (del) { const tr = del.closest('tr'); if (tr.parentElement.children.length > 1) tr.remove(); else tr.querySelectorAll('input').forEach(i => { i.value = ''; }); } }); },
    submit: async v => { if (!canEdit) throw new Error('개발 담당자만 고칠 수 있습니다.'); const steps = [...root.querySelectorAll('[data-step]')].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-s]')].map(i => [i.dataset.s, i.value.trim()]))).filter(x => x.name); return api('PUT', `/api/dev-roadmap/${r.id}`, { ...v, steps }); } });
  if (saved) { toast('개발 스케줄을 저장했습니다.'); await done?.(); }
}
// 15.277 개발 진행건 팝업: 담당자(개발·영업) 지정 + 스케줄 요약 + 소통(진행내용·영업 코멘트·요청/질문). 소통은 진행 코멘트(request)와 같은 기록.
const DEV_TALK = [['진행', '진행내용', '#1c7ed6'], ['영업', '영업 코멘트', '#e8590c'], ['요청', '요청·질문', '#c2255c'], ['', '일반', '#868e96']];
const devTalkKind = text => { const m = /^\[(진행|영업|요청|담당자)\]\s?/.exec(text || ''); return m ? [m[1], text.slice(m[0].length)] : ['', text || '']; };
let DEV_DIRECTORY = null;
async function devCaseWindow(id, done) {
  const load1 = async () => (await api('GET', '/api/dev-roadmap?id=' + id)).rows[0];
  let r = await load1(); if (!r) throw new Error('개발 의뢰를 찾을 수 없습니다.');
  DEV_DIRECTORY ||= await api('GET', '/api/directory').catch(() => []);
  const canOwn = hasRole('dev') || hasRole('dev_approver') || hasRole('sales'), canPlan = hasRole('dev') || hasRole('dev_approver');
  const defKind = hasRole('sales') && !hasRole('dev') && !ME?.is_admin ? '영업' : '진행';
  const opt = (sel) => `<option value="">미지정</option>${DEV_DIRECTORY.map(u => `<option value="${u.id}"${Number(sel) === u.id ? ' selected' : ''}>${esc(u.name)}${u.department ? ` · ${esc(u.department)}` : ''}${u.position ? ` ${esc(u.position)}` : ''}</option>`).join('')}`;
  let changed = false;
  const m = modal(`<div class="dev-case"><h3>${esc(r.title)} <span class="small muted">${esc(r.req_no || '')}</span></h3><div data-dc-summary></div>
    <fieldset class="vendor-sec dc-owners"><legend>담당자</legend><div class="form-grid">
      <label>개발 담당자<select name="dev_owner_id" ${canOwn ? '' : 'disabled'}>${opt(r.dev_owner_id)}</select></label>
      <label>영업 담당자<select name="sales_owner_id" ${canOwn ? '' : 'disabled'}>${opt(r.sales_owner_id)}</select></label>
      <div class="dc-owner-act">${canOwn ? '<button type="button" class="btn small primary" data-dc-owner-save>담당자 저장</button>' : '<span class="small muted">개발·영업 담당자가 지정합니다.</span>'}</div></div></fieldset>
    <fieldset class="vendor-sec"><legend>소통 <span class="hint">(진행내용·영업 코멘트·요청을 남기면 모두가 봅니다 · Ctrl+Enter 등록)</span></legend>
      <div class="dc-filter seg" role="group" aria-label="소통 구분">${[['all', '전체'], ...DEV_TALK.slice(0, 3).map(([k, l]) => [k, l])].map(([k, l]) => `<button type="button" data-dc-f="${k}" class="${k === 'all' ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="dc-thread" data-dc-thread aria-live="polite"><p class="muted">불러오는 중…</p></div>
      <button type="button" class="btn small" data-dc-older hidden>이전 기록 더 보기</button>
      <form class="dc-send" data-dc-form><div class="seg dc-kind" role="radiogroup" aria-label="글 구분">${DEV_TALK.slice(0, 3).map(([k, l, c]) => `<label style="--c:${c}"><input type="radio" name="kind" value="${k}"${k === defKind ? ' checked' : ''}> ${l}</label>`).join('')}</div>
        <textarea name="content" rows="3" maxlength="1990" required placeholder="예) 고객사 2차 샘플 평가 결과 다음 주 회신 예정"></textarea>
        <button type="submit" class="btn primary">등록</button></form></fieldset>
    <div class="actions"><button type="button" class="btn" data-dc-req>의뢰서 보기</button><button type="button" class="btn" data-dc-plan>${canPlan ? '스케줄·공정표 입력' : '스케줄·공정표 보기'}</button><button type="button" class="btn" data-dc-close>닫기</button></div></div>`,
    { wide: true, onClose: () => { if (changed) done?.(); } });
  const el = m.el; el.classList.add('vendor-modal');
  const summary = () => { const end = r.target_date || r.due_date || '', dd = end ? devDays(todayStr(), end) : null, t = DEV_TERM.find(x => x[0] === (r.term || '')) || DEV_TERM[3];
    $('[data-dc-summary]', el).innerHTML = `<div class="dc-sum"><span class="chip" style="border-color:${t[2]};color:${t[2]}">${t[1]}</span> ${statusChip(r.status)} <span>${esc(r.customer || '')}</span>${r.target_price ? `<span class="small muted">타겟단가 ${esc(r.target_price)}</span>` : ''}<span class="small muted">의뢰 ${esc(r.requester_name || '')}</span></div>
      <div class="dc-prog"><div class="dc-bar" style="--c:${t[2]}"><b style="width:${r.progress || 0}%"></b></div><b>${r.progress || 0}%</b>${end ? `<span>완료예정 <b>${esc(end)}</b>${dd != null && r.status !== 'done' ? ` <span class="${dd < 0 ? 'red-text' : ''}">(${dd >= 0 ? 'D-' + dd : 'D+' + -dd})</span>` : ''}</span>` : ''}</div>
      <div class="small dr-now">${r.current_stage ? `<span>현재 <b>${esc(r.current_stage)}</b></span>` : '<span class="muted">현재 진행현황 미입력</span>'}${r.next_step ? `<span>다음 <b>${esc(r.next_step)}</b>${r.next_date ? ` ${esc(r.next_date)}` : ''}</span>` : ''}${r.steps.length ? `<span>공정 ${r.steps.filter(x => x.status === 'done').length}/${r.steps.length}</span>` : ''}</div>`; };
  summary();
  const endpoint = `/api/comments/request/${id}`; let rows = [], next = null, filter = 'all';
  const thread = $('[data-dc-thread]', el);
  const draw = () => {
    const list = rows.slice().sort((a, b) => a.id - b.id).filter(c => filter === 'all' || devTalkKind(c.content)[0] === filter);
    thread.innerHTML = list.length ? list.map(c => { const [k, body] = devTalkKind(c.content), info = k === '담당자' ? ['담당자', '담당자 변경', '#5f3dc4'] : DEV_TALK.find(x => x[0] === k) || DEV_TALK[3], mine = c.author_id === ME?.id;
      return `<div class="dc-msg${mine ? ' mine' : ''}${k === '담당자' ? ' sys' : ''}" style="--c:${info[2]}"><div class="dc-meta"><span class="dc-kind-chip">${info[1]}</span><b>${esc(c.author_name)}</b><time>${esc(c.created_at.slice(0, 16))}</time>${mine && c.content !== '(삭제됨)' && k !== '담당자' ? `<button type="button" class="linklike small" data-dc-del="${c.id}">지우기</button>` : ''}</div><div class="dc-body">${esc(body)}</div></div>`; }).join('')
      : `<p class="muted">${rows.length ? '이 구분의 글이 없습니다.' : '아직 소통 내역이 없습니다. 첫 진행내용이나 코멘트를 남겨 주세요.'}</p>`;
    $('[data-dc-older]', el).hidden = next === null; thread.scrollTop = thread.scrollHeight;
  };
  const loadTalk = async (older = false) => { const res = await api('GET', endpoint + (older ? '?before=' + next : '')); rows = older ? rows.concat(res.rows) : res.rows; next = res.next; if (el.isConnected) draw(); };
  el.addEventListener('click', async e => {
    const f = e.target.closest('[data-dc-f]'); if (f) { filter = f.dataset.dcF; $$('[data-dc-f]', el).forEach(b => b.classList.toggle('on', b === f)); draw(); return; }
    if (e.target.closest('[data-dc-older]')) { loadTalk(true).catch(fail); return; }
    if (e.target.closest('[data-dc-close]')) { m.close(); return; }
    const del = e.target.closest('[data-dc-del]'); if (del) { if (!(await confirmBox('이 글을 지울까요? 쓴 지 10분 안에만 지울 수 있고 자리에 「(삭제됨)」이 남습니다.'))) return; try { await api('DELETE', `${endpoint}/${del.dataset.dcDel}`); changed = true; await loadTalk(); } catch (err) { fail(err); } return; }
    if (e.target.closest('[data-dc-owner-save]')) { try { const res = await api('PUT', `/api/dev-roadmap/${id}/owners`, { dev_owner_id: $('[name=dev_owner_id]', el).value, sales_owner_id: $('[name=sales_owner_id]', el).value }); toast(res.changed ? '담당자를 저장했습니다.' : '바뀐 담당자가 없습니다.'); if (res.changed) { changed = true; r = await load1(); await loadTalk(); } } catch (err) { fail(err); } return; }
    if (e.target.closest('[data-dc-plan]')) { await devPlanEditor(r, async () => { changed = true; r = await load1(); summary(); }); return; }
    if (e.target.closest('[data-dc-req]')) { try { const full = (await api('GET', '/api/requests?' + new URLSearchParams({ type: 'development', q: r.req_no || r.title }))).find(x => x.id === r.id); if (full) requestDetail('development', full, async () => { changed = true; }); else toast('의뢰서를 찾지 못했습니다.'); } catch (err) { fail(err); } }
  });
  const form = $('[data-dc-form]', el);
  form.elements.content.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = async e => { e.preventDefault(); const text = form.elements.content.value.trim(); if (!text) return; const kind = form.elements.kind.value;
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try { await api('POST', endpoint, { content: kind ? `[${kind}] ${text}` : text }); form.elements.content.value = ''; changed = true; filter = 'all'; $$('[data-dc-f]', el).forEach(b => b.classList.toggle('on', b.dataset.dcF === 'all')); await loadTalk(); toast('등록했습니다.'); }
    catch (err) { fail(err); } finally { btn.disabled = false; form.elements.content.focus(); } };
  await loadTalk();
  return m;
}
// 15.281 스케줄 관리(로드맵) 다시 그림: 요약 카드(눌러서 거르기) · 보기 범위(3개월/6개월/1년/전체, 가로 스크롤 · 왼쪽 제품 칸 고정 · 오늘로)
// · 공정 이름이 보이는 큰 막대 · 현재/다음 설명 줄 · D-day 칩 · 담당자 · 정렬 · 구분 줄 접기 · ✎ 바로 일정 입력 · 현황표 접기.
const DR_PREF = 'wpa:dr';
const drPref = (patch) => { let p = {}; try { p = JSON.parse(localStorage.getItem(DR_PREF) || '{}') || {}; } catch { p = {}; } if (patch) { p = { ...p, ...patch }; try { localStorage.setItem(DR_PREF, JSON.stringify(p)); } catch { /* 편의 */ } } return p; };
async function pageDevRoadmap(main) {
  let termSel = 'all'; try { termSel = localStorage.getItem('wpa:dev-term') ?? 'all'; } catch { /* 편의 */ }
  if (!['all', 'short', 'mid', 'long', ''].includes(termSel)) termSel = 'all';
  const pref = drPref(); let zoom = ['3m', '6m', '1y', 'all'].includes(pref.zoom) ? pref.zoom : '6m', sort = pref.sort || 'end', kpi = '', folded = new Set(pref.folded || []);
  const canPlan = hasRole('dev') || hasRole('dev_approver');
  main.innerHTML = `<h1>스케줄 관리 <span class="dept">개발</span></h1>
  <p class="muted">개발리스트의 제품마다 구분(단기·중장기·장기), 공정표, 현재 진행현황·다음 진행예정·완료예정일을 넣으면 로드맵에 표시됩니다. 줄을 누르면 진행건 창(담당자·소통), ✎는 일정 입력입니다.</p>
  <div class="dr-kpis" id="drKpis"></div>
  <form class="toolbar list-filters dr-tools" id="drForm" data-read-only="true">
    <div class="seg" role="group" aria-label="구분" data-dr-terms>${[['all', '전체'], ...DEV_TERM.map(([k, l]) => [k, l])].map(([k, l]) => `<button type="button" data-dr-term="${k}">${l}</button>`).join('')}</div>
    <label class="list-search">검색<input type="search" name="q" maxlength="100" placeholder="제품·거래처·의뢰번호·담당자"></label>
    <label>정렬<select name="sort"><option value="end">완료예정 빠른 순</option><option value="next">다음 일정 빠른 순</option><option value="progress">진행률 낮은 순</option><option value="title">제품명 순</option></select></label>
    <label class="inline"><input type="checkbox" name="mine" value="1"> 내 담당만</label><label class="inline"><input type="checkbox" name="done" value="1"> 완료 포함</label>
    <button type="submit" class="btn primary">조회</button></form>
  <div class="dr-bar-top"><div class="seg dr-zoom" role="group" aria-label="보기 범위">${[['3m', '3개월'], ['6m', '6개월'], ['1y', '1년'], ['all', '전체']].map(([k, l]) => `<button type="button" data-dr-zoom="${k}">${l}</button>`).join('')}</div><button type="button" class="btn small" data-dr-today>오늘로</button>
    <div class="dr-legend small"><span><i style="background:#2f9e44"></i>단기</span><span><i style="background:#1c7ed6"></i>중장기</span><span><i style="background:#7048e8"></i>장기</span><span class="dr-sep"></span>${Object.values(DEV_STEP_STATE).map(([l, c]) => `<span><i class="dr-step-i" style="background:${c}"></i>공정 ${l}</span>`).join('')}<span><b class="dr-next-i">◆</b> 다음 예정</span><span><i class="dr-today-i"></i> 오늘</span></div></div>
  <div id="drMap"><p class="muted">불러오는 중…</p></div>
  <details class="dr-table-box" id="drTableBox"${pref.table === false ? '' : ' open'}><summary><h3 class="dr-h3">진행 현황표 <span class="small muted" id="drTableN"></span></h3></summary><div id="drTable"></div></details>`;
  const form = $('#drForm', main); form.elements.sort.value = sort; let rows = [];
  const today = todayStr();
  const endOf = r => r.target_date || r.due_date || '';
  const startOf = r => r.start_date || r.steps.map(s => s.start_date).filter(Boolean).sort()[0] || '';
  const isLate = r => { const e = endOf(r); return !!e && e < today && (r.progress || 0) < 100 && r.status !== 'done'; };
  const dday = (d) => { if (!d) return ''; const n = devDays(today, d); return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`; };
  const ddClass = (r) => { const e = endOf(r); if (!e || r.status === 'done') return ''; const n = devDays(today, e); return n < 0 ? 'late' : n <= 14 ? 'soon' : ''; };
  const KPIS = [['all', '진행 중', () => true], ['late', '지연', isLate], ['due30', '30일 내 완료예정', r => { const e = endOf(r); return !!e && r.status !== 'done' && devDays(today, e) >= 0 && devDays(today, e) <= 30; }], ['next7', '7일 내 다음 일정', r => !!r.next_date && devDays(today, r.next_date) >= 0 && devDays(today, r.next_date) <= 7], ['noplan', '일정 미입력', r => !startOf(r) || !endOf(r)]];
  const base = () => { const q = (form.elements.q.value || '').trim().toLowerCase(), mine = form.elements.mine.checked;
    return rows.filter(r => (termSel === 'all' || (r.term || '') === termSel) && (!mine || r.dev_owner_id === ME?.id || r.sales_owner_id === ME?.id) && (!q || `${r.title} ${r.customer} ${r.req_no} ${r.dev_owner_name} ${r.sales_owner_name}`.toLowerCase().includes(q))); };
  const sorter = { end: (a, b) => (endOf(a) || '9999').localeCompare(endOf(b) || '9999'), next: (a, b) => (a.next_date || '9999').localeCompare(b.next_date || '9999'), progress: (a, b) => (a.progress || 0) - (b.progress || 0), title: (a, b) => a.title.localeCompare(b.title, 'ko') };
  const addM = (d, m) => { const x = new Date(d.slice(0, 7) + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
  const draw = () => {
    const pool = base(), kf = KPIS.find(k => k[0] === kpi) || KPIS[0];
    $('#drKpis', main).innerHTML = KPIS.map(([k, l, f]) => { const n = pool.filter(f).length; return `<button type="button" class="dr-kpi${k === kpi || (!kpi && k === 'all') ? ' on' : ''}${k === 'late' && n ? ' warn' : ''}" data-dr-kpi="${k}" aria-pressed="${k === kpi || (!kpi && k === 'all')}"><b>${n}</b><span>${l}</span></button>`; }).join('');
    const list = pool.filter(kf[2]).sort(sorter[sort] || sorter.end);
    $$('[data-dr-term]', main).forEach(b => b.classList.toggle('on', b.dataset.drTerm === termSel));
    $$('[data-dr-zoom]', main).forEach(b => b.classList.toggle('on', b.dataset.drZoom === zoom));
    // 기간: 계획 날짜 + 오늘. 보기 범위가 정해지면 한 달 폭을 고정하고 가로로 스크롤.
    const dates = list.flatMap(r => [startOf(r), endOf(r), r.next_date, ...r.steps.flatMap(s => [s.start_date, s.end_date])]).filter(Boolean);
    const span = { '3m': 3, '6m': 6, '1y': 12 }[zoom];
    let from = [addM(today, -1), ...dates].sort()[0].slice(0, 7) + '-01', to = addM([addM(today, span || 3), ...dates].sort().at(-1), 1);
    if (devDays(from, to) > 365 * 4) to = addM(from, 48);
    const months = []; for (let m = from; m < to; m = addM(m, 1)) months.push(m);
    const box = $('#drMap', main), avail = Math.max(480, (box.clientWidth || 1000) - (innerWidth <= 700 ? 150 : 320) - 4);
    const monthPx = span ? Math.max(70, Math.floor(avail / span)) : Math.max(36, Math.floor(avail / months.length)), W = months.length * monthPx;
    const days = devDays(from, to), px = d => Math.max(0, Math.min(W, devDays(from, d) / days * W)), pct = d => px(d) / W * 100;
    const head = `<div class="dr-months">${months.map(m => `<span style="left:${pct(m)}%;width:${pct(addM(m, 1)) - pct(m)}%"${m.slice(5, 7) === '01' ? ' class="dr-year"' : ''}>${m.slice(5, 7) === '01' || m === months[0] ? `<em>${m.slice(0, 4)}</em>` : ''}${Number(m.slice(5, 7))}월</span>`).join('')}</div>`;
    const weeks = monthPx >= 200 ? (() => { const out = []; let d = new Date(from + 'T00:00:00Z'); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); for (; d.toISOString().slice(0, 10) < to; d.setUTCDate(d.getUTCDate() + 7)) out.push(`<i class="dr-wk" style="left:${pct(d.toISOString().slice(0, 10))}%"></i>`); return out.join(''); })() : '';
    const grid = `${months.map(m => `<i class="dr-mline" style="left:${pct(m)}%"></i>`).join('')}${weeks}`;
    const todayLine = `<i class="dr-today" style="left:${pct(today)}%"></i>`;
    const rowHtml = r => {
      const [, , color] = DEV_TERM.find(t => t[0] === (r.term || '')) || DEV_TERM[3], end = endOf(r), start = startOf(r), late = isLate(r);
      const bar = start && end ? `<div class="dr-bar${late ? ' late' : ''}" style="left:${pct(start)}%;width:${Math.max(0.8, pct(end) - pct(start))}%;--c:${color}" title="${esc(`${start} ~ ${end} · 진행 ${r.progress || 0}%`)}"><b style="width:${r.progress || 0}%"></b><span>${r.progress || 0}%</span></div>`
        : end ? `<div class="dr-pin" style="left:${pct(end)}%;--c:${color}" title="완료예정 ${esc(end)}">▼</div>` : `<button type="button" class="dr-empty" data-dr-edit="${r.id}" style="left:${pct(today)}%">＋ 일정 넣기</button>`;
      const steps = r.steps.filter(s => s.start_date && s.end_date).map(s => { const w = Math.max(0.6, pct(s.end_date) - pct(s.start_date)), wpx = w / 100 * W; return `<i class="dr-step st-${s.status}" style="left:${pct(s.start_date)}%;width:${w}%;background:${DEV_STEP_STATE[s.status]?.[1] || '#adb5bd'}" title="${esc(`${s.name} · ${s.start_date}~${s.end_date} · ${DEV_STEP_STATE[s.status]?.[0] || ''}`)}">${wpx >= 46 ? `<span>${esc(s.name)}</span>` : ''}</i>`; }).join('');
      const next = r.next_date ? `<em class="dr-next" style="left:${pct(r.next_date)}%" title="${esc(`다음: ${r.next_step || ''} (${r.next_date})`)}">◆</em>` : '';
      const capLeft = Math.max(start && end ? pct(start) : 0, pct(today)), cap = r.current_stage || r.next_step ? `<div class="dr-cap" style="left:min(${capLeft}%, calc(100% - 320px))">${r.current_stage ? `<span>현재 <b>${esc(r.current_stage)}</b></span>` : ''}${r.next_step ? `<span>다음 <b>${esc(r.next_step)}</b>${r.next_date ? ` ${esc(r.next_date.slice(5).replace('-', '/'))}` : ''}</span>` : ''}</div>` : '';
      const dd = ddClass(r);
      return `<div class="dr-row${late ? ' is-late' : ''}" data-dr="${r.id}" tabindex="0" title="눌러서 진행건 열기(담당자·스케줄·소통)">
        <div class="dr-label"><div class="dr-l1"><b class="dr-title">${esc(r.title)}</b>${r.status === 'done' ? '<span class="chip green">완료</span>' : late ? '<span class="chip red">지연</span>' : ''}${end && r.status !== 'done' ? `<span class="dr-dd ${dd}">${dday(end)}</span>` : ''}${r.comment_count ? `<span class="dr-talk" title="${esc(r.last_comment || '')}">💬 ${r.comment_count}</span>` : ''}${canPlan ? `<button type="button" class="dr-edit" data-dr-edit="${r.id}" title="일정·공정표 입력" aria-label="${esc(r.title)} 일정 입력">✎</button>` : ''}</div>
          <div class="small muted dr-l2">${esc([r.customer, r.req_no].filter(Boolean).join(' · '))}${end ? ` · 완료예정 ${esc(end)}` : ''}</div>
          <div class="small dr-owners">${r.dev_owner_name ? `<span><i class="dr-av">개</i>${esc(r.dev_owner_name)}</span>` : ''}${r.sales_owner_name ? `<span><i class="dr-av s">영</i>${esc(r.sales_owner_name)}</span>` : ''}${!r.dev_owner_name && !r.sales_owner_name ? '<span class="muted">담당자 미지정</span>' : ''}</div>
          ${r.current_stage || r.next_step ? `<div class="small dr-now">${r.current_stage ? `<span>현재 <b>${esc(r.current_stage)}</b></span>` : ''}${r.next_step ? `<span>다음 <b>${esc(r.next_step)}</b>${r.next_date ? ` ${esc(r.next_date.slice(5))}` : ''}</span>` : ''}</div>` : ''}</div>
        <div class="dr-track" style="width:${W}px">${grid}${todayLine}<div class="dr-steps">${steps}</div>${bar}${next}${cap}</div></div>`;
    };
    const lanes = DEV_TERM.map(([k, l, c]) => [k, l, c, list.filter(r => (r.term || '') === k)]).filter(([, , , rs]) => rs.length);
    box.innerHTML = list.length ? `<div class="dr-scroll"><div class="dr-map" style="--trackw:${W}px"><div class="dr-head"><div class="dr-label"><span class="small muted">제품 ${list.length}건</span></div><div class="dr-track" style="width:${W}px">${head}${grid}${todayLine}<b class="dr-today-tag" style="left:${pct(today)}%">오늘</b></div></div>${lanes.map(([k, l, c, rs]) => `<div class="dr-lane${folded.has(k || 'none') ? ' folded' : ''}" style="--c:${c}"><button type="button" class="dr-lane-h" data-dr-fold="${k || 'none'}" aria-expanded="${!folded.has(k || 'none')}">${l} <span class="small muted">${rs.length}건${rs.filter(isLate).length ? ` · 지연 ${rs.filter(isLate).length}` : ''}</span><span class="dr-fold-i">${folded.has(k || 'none') ? '▸' : '▾'}</span></button>${folded.has(k || 'none') ? '' : rs.map(rowHtml).join('')}</div>`).join('')}</div></div>`
      : `<div class="empty">조건에 맞는 개발 제품이 없습니다.${kpi ? ' 위 요약 카드의 거르기를 「진행 중」으로 바꿔 보세요.' : ' 개발리스트에 진행 중인 의뢰가 있어야 합니다.'}</div>`;
    const sc = $('.dr-scroll', box); if (sc) sc.scrollLeft = Math.max(0, px(today) - sc.clientWidth * 0.25 + 0);
    $('#drTableN', main).textContent = `${list.length}건`;
    $('#drTable', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>구분</th><th>제품</th><th>거래처</th><th>현재 진행현황</th><th>다음 진행예정</th><th>다음 예정일</th><th>완료예정일</th><th class="r">D-day</th><th class="r">진행률</th><th>공정</th><th>개발 담당</th><th>영업 담당</th><th>최근 소통</th></tr></thead><tbody>${list.map(r => { const end = endOf(r), t = DEV_TERM.find(x => x[0] === (r.term || '')) || DEV_TERM[3]; return `<tr data-dr="${r.id}" style="cursor:pointer"><td><span class="chip" style="border-color:${t[2]};color:${t[2]}">${t[1]}</span></td><td><b>${esc(r.title)}</b><div class="small muted">${esc(r.req_no || '')}</div></td><td>${esc(r.customer || '')}</td><td>${esc(r.current_stage || '')}</td><td>${esc(r.next_step || '')}</td><td class="nowrap">${esc(r.next_date || '')}</td><td class="nowrap">${esc(end)}</td><td class="r nowrap"><span class="dr-dd ${ddClass(r)}">${r.status === 'done' ? '' : dday(end)}</span></td><td class="r"><div class="dr-mini"><b style="width:${r.progress || 0}%"></b></div>${r.progress || 0}%</td><td class="small">${r.steps.length ? `${r.steps.filter(s => s.status === 'done').length}/${r.steps.length}` : ''}</td><td>${esc(r.dev_owner_name || '')}</td><td>${esc(r.sales_owner_name || '')}</td><td class="small muted dr-last">${r.comment_count ? `💬 ${r.comment_count} · ${esc(r.last_comment || '')}` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '';
  };
  const load = async () => { rows = (await api('GET', '/api/dev-roadmap?' + new URLSearchParams({ done: form.elements.done.checked ? '1' : '' }))).rows; if (main.isConnected) draw(); };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-dr-term]'); if (t) { termSel = t.dataset.drTerm; try { localStorage.setItem('wpa:dev-term', termSel); } catch { /* 편의 */ } draw(); return; }
    const z = e.target.closest('[data-dr-zoom]'); if (z) { zoom = z.dataset.drZoom; drPref({ zoom }); draw(); return; }
    const k = e.target.closest('[data-dr-kpi]'); if (k) { kpi = k.dataset.drKpi === 'all' || kpi === k.dataset.drKpi ? '' : k.dataset.drKpi; draw(); return; }
    const f = e.target.closest('[data-dr-fold]'); if (f) { const key = f.dataset.drFold; folded.has(key) ? folded.delete(key) : folded.add(key); drPref({ folded: [...folded] }); draw(); return; }
    if (e.target.closest('[data-dr-today]')) { const sc = $('.dr-scroll', main), ti = $('.dr-head .dr-today', main); if (sc && ti) sc.scrollTo({ left: Math.max(0, ti.offsetLeft - sc.clientWidth * 0.25), behavior: 'smooth' }); return; }
    const ed = e.target.closest('[data-dr-edit]'); if (ed) { const r = rows.find(x => x.id === Number(ed.dataset.drEdit)); if (r) devPlanEditor(r, load).catch(fail); return; }
    const row = e.target.closest('[data-dr]'); if (row && !$('.modal-wrap')) devCaseWindow(Number(row.dataset.dr), load).catch(fail);
  });
  main.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('.dr-row')) e.target.click(); });
  $('#drTableBox', main).addEventListener('toggle', e => drPref({ table: e.currentTarget.open }));
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); }; form.elements.done.onchange = () => load().catch(fail);
  form.elements.mine.onchange = () => draw(); form.elements.q.oninput = () => draw(); form.elements.sort.onchange = () => { sort = form.elements.sort.value; drPref({ sort }); draw(); };
  let rz = 0; const onResize = () => { if (!main.isConnected) { removeEventListener('resize', onResize); return; } clearTimeout(rz); rz = setTimeout(() => { if (rows.length) draw(); }, 200); }; addEventListener('resize', onResize);
  await load();
}
