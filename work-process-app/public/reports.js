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

// 15.310 리포트 기본 기간(사람별 설정): 14d=최근(집계 단위에 맞춰 14일·12주·12개월), week=이번 주, month=이번 달, year=올해, 12m=최근 12개월
const REPORT_PERIOD_LABEL = { '14d': '최근(집계 단위에 맞춰 14일 · 12주 · 12개월)', week: '이번 주', month: '이번 달', year: '올해', '12m': '최근 12개월' };
function reportPresetRange(period, grain) {
  const today = reportRange('day')[1];
  if (period === 'week') return [mondayOf(today), today];
  if (period === 'month') return [monthStart(today), today];
  if (period === 'year') return [today.slice(0, 4) + '-01-01', today];
  if (period === '12m') return reportRange('month');
  return reportRange(grain || 'day');
}
const REPORT_BLOCKS = [['common', '공통 요약'], ['dept', '부서별 리포트'], ['detail', '수량 상세(입고·생산·출하·분석)']];
const REPORT_DETAIL = [['detail:kpis', '요약 카드(분석·입고·생산·출하)'], ['detail:chart:analysis', '차트 · 분석 등록·현재 완료'], ['detail:chart:incoming', '차트 · 입고수량 추이'], ['detail:chart:production', '차트 · 생산계획·실제 생산량'], ['detail:chart:shipping', '차트 · 출하수량 추이'],
  ['detail:status', '분석 현재 상태'], ['detail:units', '단위·품목별 합계'], ['detail:top:incoming', '입고수량 상위 10개 품목'], ['detail:top:production', '생산계획 상위 10개 품목'], ['detail:periods', '기간별 상세 수치'], ['detail:semi', '반제품 수율(커팅/융착 · 세탁)'], ['detail:definitions', '집계 기준']];
const deptSetupItems = (pre, d, parent, hint = '') => [
  ...d.kpis.map(k => ({ key: `${pre}kpi:${k.label}`, label: `요약 · ${k.label}`, hint, parent })),
  ...d.charts.map(c => ({ key: `${pre}chart:${c.title}`, label: `차트 · ${c.title}`, hint, parent })),
  ...d.tables.map(t => ({ key: `${pre}table:${t.title}`, label: `표 · ${t.title}`, hint, parent })),
];

async function pageReports(main) {
  const rp = uiPref('report'); const [from, to] = reportRange('day'); let current = null, requestId = 0, selectedUnit = '';
  main.innerHTML = `<div class="report-heading"><div><h1>리포트 · 통계</h1><p class="muted">공통·부서별 통계와 입고·생산·출하·분석 수량을 기간별로 봅니다. 「표시 설정」에서 보일 구역·항목과 기본 기간을 정할 수 있습니다(내 계정에 저장).</p></div><div class="actions"><button type="button" class="btn" id="reportSetup" title="보일 구역·항목·기본 조건(사람별)">⚙ 표시 설정</button><button class="btn" id="reportCsv" disabled>전체 단위 CSV</button><button class="btn" id="reportPrint" disabled>인쇄 · PDF</button></div></div>
    <form class="card report-filters" id="reportForm" data-read-only="true"><div class="form-grid">
    <label>집계 단위<select name="grain" id="reportGrain"><option value="day">일간</option><option value="week">주간 (월요일 시작)</option><option value="month">월간</option></select></label>
    <label>시작일<input name="from" type="date" required value="${from}"></label><label>종료일<input name="to" type="date" required value="${to}"></label>
    <label>품목 분류<select name="item_category">${categoryOptions('', true)}<option value="미분류">미분류</option></select></label>
    <label>품목·거래처 검색<input name="q" type="search" maxlength="200" placeholder="품목명 또는 거래처"></label>
    <label>생산일정 기준<select name="plan_period"><option value="day">일간 생산일정</option><option value="week">주간 생산일정</option><option value="month">월간 생산일정</option></select></label></div>
    <div class="actions wrap"><button type="submit" class="btn primary">리포트 조회</button><button type="button" class="btn" data-report-range="week">이번 주</button><button type="button" class="btn" data-report-range="month">이번 달</button><button type="button" class="btn" data-report-range="year">올해</button><span class="muted small">최대 3년 · 한국 시간 기준</span></div></form>
    <div id="reportBlocks">
      <section class="dept-sec" id="deptCommon" data-block="common"><div class="dept-head"><h2>공통</h2><span class="small muted" data-dept-range></span><button type="button" class="btn small" data-dept-xlsx="common">엑셀</button><button type="button" class="btn small" id="deptSettings">기준값${ME.is_admin ? ' 설정' : ''}</button></div><div data-dept-body><p class="muted">불러오는 중…</p></div></section>
      <section class="dept-sec" id="deptMine" data-block="dept"><div class="dept-head"><h2>부서별</h2><div class="seg" id="deptTabs" role="tablist">${DEPT_TABS.map(([k, l]) => `<button type="button" role="tab" data-dept="${k}">${l}${k === myDept() ? ' <span class="sub-count">내 부서</span>' : ''}</button>`).join('')}</div><button type="button" class="btn small" data-dept-xlsx="mine">엑셀</button></div><div data-dept-body><p class="muted">불러오는 중…</p></div></section>
      <section class="dept-sec" id="reportDetail" data-block="detail"><div class="dept-head"><h2>수량 상세</h2><span class="small muted">입고·생산·출하·분석</span></div><div class="report-meta"><p id="reportStamp" class="small muted" role="status"></p><label class="inline">수량 차트 단위 <select id="reportUnit" aria-label="수량 차트 단위" disabled></select></label></div><div id="reportContent" aria-live="polite"></div></section>
    </div>`;
  // 15.310 구역(공통·부서별·수량 상세)은 표시 설정의 순서대로, 숨긴 구역은 빼고(불러오지도 않음)
  const blocksEl = $('#reportBlocks', main), shownBlocks = applyWidgetPref(REPORT_BLOCKS.map(([key, label]) => ({ key, label })), rp).map(b => b.key), hide = new Set(rp.hidden || []);
  for (const key of shownBlocks) blocksEl.append($(`[data-block="${key}"]`, blocksEl));
  $$('[data-block]', blocksEl).forEach(sec => { sec.hidden = !shownBlocks.includes(sec.dataset.block); });
  const form = $('#reportForm', main), content = $('#reportContent', main), unitSelect = $('#reportUnit', main);
  const dept = mountDeptReports(main, form, { shown: shownBlocks, hide }); // 15.120 공통 + 부서별
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
    // 15.310 수량 상세의 블록도 표시 설정대로(숨김·순서). 차트·표 블록은 이어지는 것끼리 2열 격자로.
    const parts = {
      'detail:kpis': `<div class="report-kpis">
      ${card('분석 등록', reportNumber(report.analysis.total) + '건', `현재 완료 ${reportNumber(report.analysis.statuses.done)}건 · 완료율 ${reportNumber(report.analysis.completion_rate)}%`)}
      ${card('입고수량 · 선택 단위', reportNumber(incomingTotal), `${esc(unit || '데이터 없음')} · 전체 입고 ${report.receipts.count}건 / 이상 ${report.receipts.abnormal_count}건`)}
      ${card('실제 생산량 · 선택 단위', reportNumber(productionTotal.actual_qty), `${esc(unit || '데이터 없음')} · 계획수량 ${reportNumber(productionTotal.planned_qty)} / 전체 일정 ${report.production.plans}건`)}
      ${card('출하수량 · 선택 단위', reportNumber(shippingTotal), `${esc(unit || '데이터 없음')} · 전체 출하 ${report.shipments.count}건`)}</div>`,
      'detail:chart:analysis': { grid: `<section class="card"><h3>분석 등록 · 현재 완료</h3>${reportChart('분석 등록 및 현재 완료 건수', report.analysis.series, [{ key: 'total', label: '등록' }, { key: 'done', label: '현재 완료' }], grain)}<p class="small muted">${esc(report.definitions.analysis)}</p></section>` },
      'detail:chart:incoming': { grid: `<section class="card"><h3>입고수량 추이 <span class="tag">${esc(unit || '단위 선택')}</span></h3>${reportChart('발주입고와 기타입고 수량', incoming, [{ key: 'purchase', label: '발주입고' }, { key: 'other', label: '기타입고' }], grain)}</section>` },
      'detail:chart:production': { grid: `<section class="card"><h3>생산계획 · 실제 생산량 <span class="tag">${esc(unit || '단위 선택')}</span></h3>${reportChart('생산계획 및 실제 생산량', production, [{ key: 'planned_qty', label: '계획' }, { key: 'actual_qty', label: '실제 생산' }, { key: 'completed_qty', label: '완료 체크' }], grain)}</section>` },
      'detail:chart:shipping': { grid: `<section class="card"><h3>출하수량 추이 <span class="tag">${esc(unit || '단위 선택')}</span></h3>${reportChart('출하수량', shipping, [{ key: 'qty', label: '출하' }], grain)}</section>` },
      'detail:status': { grid: `<section class="card"><h3>분석 현재 상태</h3><div class="report-statuses">${Object.entries(report.analysis.statuses).map(([status, count]) => `<div><span>${esc(STATUS[status])}</span><div class="report-status-track"><i style="width:${report.analysis.total ? count / report.analysis.total * 100 : 0}%"></i></div><b>${reportNumber(count)}건</b></div>`).join('')}</div></section>` },
      'detail:units': { grid: `<section class="card"><h3>단위·품목별 합계</h3><div class="table-wrap"><table class="grid"><thead><tr><th>단위 / 미지정 품목</th><th class="r">입고</th><th class="r">생산계획</th><th class="r">완료 체크</th><th class="r">실제 생산</th><th class="r">계획 차이</th><th class="r">달성률</th><th class="r">출하</th></tr></thead><tbody>${report.units.map(value => { const r = report.receipts.by_unit.find(row => row.unit === value) || {}; const p = report.production.by_unit.find(row => row.unit === value) || {}; const s = report.shipments.by_unit.find(row => row.unit === value) || {}; return `<tr><td>${esc(value)}</td><td class="r">${reportNumber(r.qty)}</td><td class="r">${reportNumber(p.planned_qty)}</td><td class="r">${reportNumber(p.completed_qty)}</td><td class="r">${reportNumber(p.actual_qty)}</td><td class="r">${reportNumber(p.variance_qty)}</td><td class="r">${p.achievement_rate ?? '—'}%</td><td class="r">${reportNumber(s.qty)}</td></tr>`; }).join('') || '<tr><td colspan="8">수량 데이터가 없습니다.</td></tr>'}</tbody></table></div></section>` },
      'detail:top:incoming': { grid: `<section class="card"><h3>입고수량 상위 10개 품목</h3><p class="small muted">${esc(unit || '단위 선택')}</p><div class="table-wrap">${ranking(report.receipts.items, 'qty')}</div></section>` },
      'detail:top:production': { grid: `<section class="card"><h3>생산계획 상위 10개 품목</h3><p class="small muted">${esc(unit || '단위 선택')}</p><div class="table-wrap">${ranking(report.production.items, 'planned_qty')}</div></section>` },
      'detail:periods': `<details class="card"><summary>기간별 상세 수치</summary><div class="table-wrap"><table class="grid"><thead><tr><th>기간 시작</th><th class="r">분석등록</th><th class="r">현재완료</th><th class="r">발주입고</th><th class="r">기타입고</th><th class="r">생산계획</th><th class="r">완료 체크</th><th class="r">실제 생산</th><th class="r">출하</th></tr></thead><tbody>${report.buckets.map((bucket, i) => `<tr><td>${esc(bucket)}</td><td class="r">${reportNumber(report.analysis.series[i].total)}</td><td class="r">${reportNumber(report.analysis.series[i].done)}</td><td class="r">${reportNumber(incoming[i].purchase)}</td><td class="r">${reportNumber(incoming[i].other)}</td><td class="r">${reportNumber(production[i].planned_qty)}</td><td class="r">${reportNumber(production[i].completed_qty)}</td><td class="r">${reportNumber(production[i].actual_qty)}</td><td class="r">${reportNumber(shipping[i].qty)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">수량 열: ${esc(unit || '데이터 없음')}</p></details>`,
      'detail:semi': semiReportSection(report),
      'detail:definitions': `<details class="card report-definitions"><summary>집계 기준</summary>${Object.values(report.definitions).map(text => `<p class="small muted">${esc(text)}</p>`).join('')}</details>`,
    };
    let html = '', grid = []; const flush = () => { if (grid.length) { html += `<div class="report-chart-grid">${grid.join('')}</div>`; grid = []; } };
    for (const { key } of applyWidgetPref(REPORT_DETAIL.map(([key, label]) => ({ key, label })), rp)) { const part = parts[key]; if (!part) continue; if (typeof part === 'object') grid.push(part.grid); else { flush(); html += part; } }
    flush();
    content.innerHTML = html || '<p class="muted small">표시 설정에서 수량 상세 항목을 모두 숨겼습니다.</p>';
  };
  const load = async () => {
    dept.load().catch(fail);
    if (!shownBlocks.includes('detail')) return;
    const id = ++requestId; const values = formObj(form);
    const button = $('button[type=submit]', form); button.disabled = true;
    $('#reportStamp', main).textContent = '리포트를 집계하고 있습니다…';
    $('#reportCsv', main).disabled = $('#reportPrint', main).disabled = true;
    try {
      const report = await api('GET', '/api/reports?' + new URLSearchParams(values));
      if (id !== requestId || !main.isConnected) return;
      current = report;
      if (!report.units.includes(selectedUnit)) selectedUnit = rp.unit && report.units.includes(rp.unit) ? rp.unit : report.units.includes('EA') ? 'EA' : report.units[0] || ''; // 15.310 기본 단위(설정)
      unitSelect.innerHTML = report.units.length ? report.units.map(unit => `<option value="${esc(unit)}">${esc(unit)}</option>`).join('') : '<option value="">수량 데이터 없음</option>';
      unitSelect.value = selectedUnit; unitSelect.disabled = !report.units.length;
      $('#reportStamp', main).textContent = `${report.range.from} ~ ${report.range.to} · ${report.range.timezone} · 조회자 ${ME.name} · 집계 ${report.generated_at}`;
      draw(); $('#reportCsv', main).disabled = $('#reportPrint', main).disabled = false;
    } catch (error) { if (id === requestId) { current = null; content.innerHTML = `<div class="card empty">${esc(error.message)}</div>`; $('#reportStamp', main).textContent = '조회 조건을 확인해 주세요.'; } }
    finally { if (id === requestId) button.disabled = false; }
  };
  rememberList(form);
  // 15.310 이 탭에서 고른 기간이 없으면 기본 기간(설정) + 집계 단위에 맞춰 시작·종료일을 잡는다
  if (!uxRead(uxKey('filters', (location.hash || '#/') + ':' + form.id))) { const [a, b] = reportPresetRange(rp.period || '14d', form.elements.grain.value); form.elements.from.value = a; form.elements.to.value = b; }
  form.onsubmit = event => { event.preventDefault(); load(); };
  $('#reportGrain', main).onchange = () => { const [start, end] = reportPresetRange(rp.period || '14d', form.elements.grain.value); form.elements.from.value = start; form.elements.to.value = end; load(); };
  unitSelect.onchange = () => { selectedUnit = unitSelect.value; draw(); };
  $$('[data-report-range]', main).forEach(button => button.onclick = () => {
    const today = reportRange('day')[1]; form.elements.from.value = button.dataset.reportRange === 'week' ? mondayOf(today) : button.dataset.reportRange === 'year' ? today.slice(0, 4) + '-01-01' : monthStart(today); form.elements.to.value = today; load();
  });
  $('#reportCsv', main).onclick = () => { if (current) exportReport(current); };
  $('#reportPrint', main).onclick = () => { document.body.classList.add('printing-report'); try { window.print(); } finally { document.body.classList.remove('printing-report'); } };
  $('#reportSetup', main).onclick = () => {
    const items = [];
    for (const [key, label] of REPORT_BLOCKS) {
      items.push({ key, label });
      if (key === 'common' && dept.data.common) items.push(...deptSetupItems('common:', dept.data.common, 'common'));
      if (key === 'dept' && dept.data.mine) items.push(...deptSetupItems(`dept:${dept.current()}:`, dept.data.mine, 'dept', `(${DEPT_TABS.find(([k]) => k === dept.current())?.[1] || ''} 탭)`));
      if (key === 'detail') items.push(...REPORT_DETAIL.map(([k, l]) => ({ key: k, label: l, parent: 'detail' })));
    }
    widgetSetup({ title: '리포트 표시 설정', intro: '보일 구역·항목을 체크하고 ▲▼로 순서를 바꾸세요. 부서별 항목은 지금 고른 부서 탭 기준이며 부서마다 따로 저장됩니다. 내 계정에 저장되어 다른 기기에서도 같게 보입니다.', items, pref: rp,
      extra: `<fieldset class="vendor-sec"><legend>기본 조건</legend><div class="ws-defaults">
        <label>기본 기간<select name="period">${Object.entries(REPORT_PERIOD_LABEL).map(([k, l]) => `<option value="${k}"${(rp.period || '14d') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>부서별 기본 탭<select name="dept"><option value="">내 부서(마지막에 본 탭)</option>${DEPT_TABS.map(([k, l]) => `<option value="${k}"${rp.dept === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>수량 차트 기본 단위<input name="unit" maxlength="20" value="${esc(rp.unit || '')}" placeholder="예) EA · BOX (비우면 EA)"></label></div></fieldset>`,
      onSave: async (next, vals) => { await saveUiPref('report', next ? { ...next, period: vals.period === '14d' ? '' : vals.period, dept: vals.dept || '', unit: (vals.unit || '').trim() } : null); await pageReports(main); } });
  };
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
function deptHtml(d, hide = new Set(), pre = '') {
  // 15.310 표시 설정에서 숨긴 항목(요약 카드·차트·표)은 뺀다. 이름은 `${구역}:kpi|chart|table:${제목}`.
  const kp = d.kpis.filter(k => !hide.has(`${pre}kpi:${k.label}`)), ch = d.charts.filter(c => !hide.has(`${pre}chart:${c.title}`)), tbs = d.tables.filter(t => !hide.has(`${pre}table:${t.title}`));
  const kpis = kp.length ? `<div class="report-kpis">${kp.map(k => `<a class="card report-kpi dept-kpi ${k.tone ? 'tone-' + k.tone : ''}" href="${k.href || '#/reports'}"><span class="muted">${esc(k.label)}</span><strong>${deptValue(k.value, k.type, k.unit)}</strong><span class="small muted">${esc(k.detail || '')}</span></a>`).join('')}</div>` : '';
  const charts = ch.length ? `<div class="report-chart-grid">${ch.map(c => `<section class="card"><h3>${esc(c.title)}${c.type === 'won' ? ' <span class="tag">원</span>' : c.type === 'pct' ? ' <span class="tag">%</span>' : ''}</h3>${reportChart(c.title, c.rows, c.series, d.grain)}</section>`).join('')}</div>` : '';
  const tables = tbs.map(tb => `<section class="card"><h3>${esc(tb.title)}${tb.href ? ` <a class="small" href="${tb.href}">자세히 →</a>` : ''}</h3>${tb.rows.length ? `<div class="table-wrap"><table class="grid" data-keep-cols><thead><tr>${tb.columns.map(c => `<th${c.type && c.type !== 'text' ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${tb.rows.map((r, i) => `<tr${tb.links?.[i] ? ` data-dept-link="${esc(tb.links[i])}" class="dept-link"` : ''}>${r.map((v, j) => deptCell(v, tb.columns[j]?.type)).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="muted small">${esc(tb.empty || '기간 안에 자료가 없습니다.')}</p>`}</section>`).join('');
  return (kpis + charts + (tables ? `<div class="report-chart-grid dept-tables">${tables}</div>` : '')) || '<p class="muted small">표시 설정에서 이 구역의 항목을 모두 숨겼습니다.</p>';
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
function mountDeptReports(main, form, { shown = ['common', 'dept', 'detail'], hide = new Set() } = {}) {
  // 15.310 부서 탭: 표시 설정의 기본 탭 > 이 브라우저에서 마지막에 본 탭 > 내 부서
  const rp = uiPref('report'); let dept = myDept(); try { dept = localStorage.getItem('wpa:report-dept') || dept; } catch { /* 편의 기능 */ }
  if (rp.dept) dept = rp.dept;
  if (!DEPT_TABS.some(([k]) => k === dept)) dept = myDept();
  const box = $('#reportBlocks', main);
  const data = {}; let version = 0;
  const params = section => new URLSearchParams({ section, from: form.elements.from.value, to: form.elements.to.value, grain: form.elements.grain.value });
  const draw = (sel, d, pre) => { const body = $(`${sel} [data-dept-body]`, box); if (!body) return; body.innerHTML = deptHtml(d, hide, pre); $$('[data-dept-link]', body).forEach(tr => tr.onclick = () => { location.hash = tr.dataset.deptLink; }); };
  const markTabs = () => $$('#deptTabs [data-dept]', box).forEach(b => { const on = b.dataset.dept === dept; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  const loadMine = async mine => { if (!shown.includes('dept')) return; const d = await api('GET', '/api/reports/dept?' + params(dept)); if (mine !== version || !box.isConnected) return; data.mine = d; draw('#deptMine', d, `dept:${dept}:`); };
  const load = async () => {
    const mine = ++version; markTabs();
    const [c] = await Promise.all([shown.includes('common') ? api('GET', '/api/reports/dept?' + params('common')) : null, loadMine(mine)]);
    if (mine !== version || !box.isConnected) return;
    if (c) { data.common = c; draw('#deptCommon', c, 'common:'); $('[data-dept-range]', box).textContent = `${c.from} ~ ${c.to}`; }
  };
  $$('#deptTabs [data-dept]', box).forEach(b => b.onclick = () => { dept = b.dataset.dept; try { localStorage.setItem('wpa:report-dept', dept); } catch { /* 편의 기능 */ } markTabs(); $('#deptMine [data-dept-body]', box).innerHTML = '<p class="muted">불러오는 중…</p>'; loadMine(version).catch(fail); });
  $$('[data-dept-xlsx]', box).forEach(b => b.onclick = () => { const d = data[b.dataset.deptXlsx]; if (d) deptXlsx(d, b.dataset.deptXlsx === 'common' ? '공통' : DEPT_TABS.find(([k]) => k === dept)[1]); });
  $('#deptSettings', box).onclick = () => reportSettingsWindow(load).catch(fail);
  return { load, data, current: () => dept };
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
const DEV_ANA = ['분석', '분석 결과', '#0c8599']; // 15.286 연구 분석 이력
const devTalkKind = text => { const m = /^\[(진행|영업|요청|담당자|분석)\]\s?/.exec(text || ''); return m ? [m[1], text.slice(m[0].length)] : ['', text || '']; };
let DEV_DIRECTORY = null;
// 15.292·15.293 검사규격 · 측정값(품질 분석결과와 같은 그리드): 위 검사규격 표(항목·단위·하한·상한·횟수) + 아래 시료별 측정 그리드.
// 시료 추가·빼기, 「⇄ 종횡 바꾸기」(항목별 ↔ 시료별 묶음), 칸마다 평균·판정, 전체 판정.
const rndMeasureHtml = () => `<fieldset class="vendor-sec rnd-meas" data-rm><legend>검사규격 · 측정값 <span class="hint">(하한·상한을 넣으면 합격·불합격을 바로 판정)</span></legend>
  <div class="rm-tools"><label>연구소 검사규격<select data-rm-rspec><option value="">— 고르기 —</option></select></label><a class="btn small" href="#/dev/specs" title="연구소 검사규격 만들기·고치기">⚙ 항목설정</a><label>품질 검사규격<select data-rm-spec><option value="">— 고르기 —</option></select></label><label>항목 보관함<select data-rm-lib><option value="">— 항목 넣기 —</option></select></label></div>
  <div class="insp-samples rm-samples" data-rm-samples></div>
  <div class="rm-bar"><button type="button" class="btn small" data-rm-add>＋ 측정 항목</button><button type="button" class="btn small" data-rm-mode>⇄ 종횡 바꾸기</button><span class="small muted" data-rm-hint></span></div>
  <div class="table-wrap insp-wrap"><table class="grid keep-table insp-grid rm-grid" data-no-sort data-no-filter data-keep-cols data-no-reorder data-rm-grid></table></div>
  <p class="rm-total" data-rm-total></p></fieldset>`;
const rmRange = it => { const a = it.min === '' || it.min == null ? null : Number(it.min), b = it.max === '' || it.max == null ? null : Number(it.max); return { a, b, txt: a !== null && b !== null ? `${fmtNum(a)} ~ ${fmtNum(b)}` : a !== null ? `≥ ${fmtNum(a)}` : b !== null ? `≤ ${fmtNum(b)}` : '규격 없음' }; };
const rmJudgeVals = (it, vals) => { const { a, b } = rmRange(it), got = vals.filter(v => v !== '' && v != null).map(Number); if (!got.length) return ['', null]; const fail = got.some(v => (a !== null && v < a) || (b !== null && v > b)); const avg = Math.round(got.reduce((t, v) => t + v, 0) / got.length * 1000) / 1000; return [a === null && b === null ? 'info' : fail ? 'fail' : got.length < (Number(it.count) || 1) ? 'wait' : 'pass', avg]; };
const RM_CHIP = { pass: '<span class="chip green">합격</span>', fail: '<span class="chip red">불합격</span>', wait: '<span class="chip yellow">측정 중</span>', info: '<span class="chip">기록</span>', '': '' };
// 15.296 엑셀에서 복사한 칸(탭·줄바꿈)을 2차원 배열로. 한 칸만 복사했으면 null(브라우저 기본 붙여넣기).
const xlGrid = e => { const t = (e.clipboardData || window.clipboardData)?.getData('text') || ''; if (!/[\t\n]/.test(t.replace(/\r?\n$/, ''))) return null; return t.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t').map(v => v.trim())); };
const xlNum = v => { const x = String(v ?? '').replace(/,/g, '').replace(/\s/g, ''); return x === '' ? '' : Number.isFinite(Number(x)) ? x : null; };
let RM_MODE = (() => { try { return localStorage.getItem('wpa:rm-mode') || 'item'; } catch { return 'item'; } })();
async function bindRndMeasure(root, init = null) {
  const box = $('[data-rm]', root), grid = $('[data-rm-grid]', box), strip = $('[data-rm-samples]', box);
  const st = { items: [], samples: [] };
  const fit = s => { s.vals = st.items.map((it, ii) => { const n = Math.max(1, Math.min(10, Number(it.count) || 1)), old = s.vals?.[ii] || []; return Array.from({ length: n }, (_, k) => old[k] ?? ''); }); };
  if (init?.items?.length) { st.items = init.items.map(it => ({ name: it.name || '', unit: it.unit || '', min: it.min ?? '', max: it.max ?? '', count: it.count || 1 }));
    st.samples = (init.rows?.length ? init.rows : [{ lot: '시료 1', values: {} }]).map((r, s) => ({ lot: r.lot || `시료 ${s + 1}`, vals: init.items.map(it => (r.values?.[it.key] || []).map(v => v ?? '')) })); }
  else { st.items = [{ name: '', unit: '', min: '', max: '', count: 1 }]; st.samples = [{ lot: '시료 1', vals: [] }]; }
  st.samples.forEach(fit);
  // 15.297 위 규격 표를 없애고 측정 그리드의 항목 칸에서 바로 이름·단위·하한~상한·횟수를 넣고 고친다(항목별 보기).
  const named = () => st.items.map((it, ii) => [it, ii]).filter(([it]) => it.name.trim());
  const cellJudge = (ii, s) => rmJudgeVals(st.items[ii], st.samples[s].vals[ii]);
  const total = () => { const all = []; for (const [, ii] of named()) for (let s = 0; s < st.samples.length; s++) { const [j] = cellJudge(ii, s); if (j) all.push(j); }
    $('[data-rm-total]', box).innerHTML = !named().length ? '<span class="muted small">표 왼쪽 칸에 측정 항목 이름을 넣거나 「연구소 검사규격」으로 불러오세요. 항목은 「＋ 측정 항목」으로 하나씩 더합니다.</span>' : !all.length ? '<span class="muted small">측정값을 넣으면 평균·판정이 나옵니다.</span>' : `전체 판정 ${all.includes('fail') ? RM_CHIP.fail : all.includes('wait') ? RM_CHIP.wait : all.includes('pass') ? RM_CHIP.pass : '<span class="small muted">규격 없이 기록</span>'} <span class="small muted">· 시료 ${st.samples.length} · 항목 ${named().length}</span>`; };
  const drawGrid = () => {
    const MODE = st.mode = RM_MODE === 'sample' && named().length ? 'sample' : 'item'; // 15.297 항목이 아직 없으면 항목별 보기로 시작(바로 입력)
    const list = MODE === 'item' ? st.items.map((it, ii) => [it, ii]) : named(), W = Math.max(1, ...list.map(([it]) => Math.max(1, Math.min(10, Number(it.count) || 1))));
    strip.innerHTML = `<span class="insp-samples-h">시료</span>${st.samples.map((x, s) => `<span class="insp-s"><b>${s + 1}</b><input data-rm-lot="${s}" maxlength="100" value="${esc(x.lot)}" aria-label="시료 ${s + 1} 이름"><span data-rm-sj="${s}"></span>${st.samples.length > 1 ? `<button type="button" class="btn small danger" data-rm-sdel="${s}" aria-label="시료 ${s + 1} 빼기">×</button>` : ''}</span>`).join('')}<button type="button" class="btn small" data-rm-sadd>＋ 시료 추가</button>`;
    if (!list.length) { grid.innerHTML = '<tbody><tr><td class="rm-empty">측정 항목이 없습니다. 「⇄ 종횡 바꾸기」로 항목별 보기로 돌아가 항목을 넣으세요.</td></tr></tbody>'; sampleJudges(); total(); return; }
    const nums = `${Array.from({ length: W }, (_, k) => `<th class="c insp-n">#${k + 1}</th>`).join('')}<th class="c insp-avg-h">평균</th><th class="c">판정</th>`;
    const cells = (ii, s) => { const it = st.items[ii], n = st.samples[s].vals[ii].length, [j, avg] = cellJudge(ii, s), { a, b } = rmRange(it);
      return Array.from({ length: W }, (_, k) => k >= n ? '<td class="insp-blank"></td>' : `<td class="insp-cell"><input type="number" step="any" inputmode="decimal" data-rm-v data-ii="${ii}" data-s="${s}" data-k="${k}" value="${esc(String(st.samples[s].vals[ii][k] ?? ''))}" placeholder="#${k + 1}" class="${st.samples[s].vals[ii][k] !== '' && ((a !== null && Number(st.samples[s].vals[ii][k]) < a) || (b !== null && Number(st.samples[s].vals[ii][k]) > b)) ? 'rm-out' : ''}" aria-label="${esc(it.name)} 시료 ${s + 1} #${k + 1}"></td>`).join('') + `<td class="r insp-avg" data-rm-avg="${ii}-${s}">${avg === null ? '' : fmtNum(avg)}</td><td data-rm-j="${ii}-${s}">${RM_CHIP[j]}</td>`; };
    const itemTh = (it, rs, ii) => `<th scope="rowgroup" rowspan="${rs}" class="insp-item-c rm-item-ed" data-rm-item="${ii}">
      <div class="rm-ed-top"><input data-rs="name" data-ii="${ii}" maxlength="100" value="${esc(it.name)}" placeholder="측정 항목 (예: 파티클)" aria-label="측정 항목"><button type="button" class="btn small danger" data-rm-del="${ii}" title="이 측정 항목 빼기" aria-label="${esc(it.name || '측정 항목')} 빼기">×</button></div>
      <div class="rm-ed-row"><input data-rs="unit" data-ii="${ii}" maxlength="30" value="${esc(it.unit)}" placeholder="단위" aria-label="단위" class="rm-ed-unit"><input data-rs="min" data-ii="${ii}" type="number" step="any" value="${esc(String(it.min ?? ''))}" placeholder="하한" aria-label="하한" class="rm-ed-num"><span class="muted">~</span><input data-rs="max" data-ii="${ii}" type="number" step="any" value="${esc(String(it.max ?? ''))}" placeholder="상한" aria-label="상한" class="rm-ed-num"></div>
      <div class="rm-ed-cnt"><span>측정 횟수</span><input data-rs="count" data-ii="${ii}" type="number" min="1" max="10" step="1" value="${it.count}" aria-label="측정 횟수"><span>회</span></div></th>`;
    const sampTh = (s, rs) => `<th scope="rowgroup" rowspan="${rs}" class="insp-samp-c"><span class="insp-sno">시료 ${s + 1}</span><div class="insp-lot-t" data-rm-lt="${s}">${esc(st.samples[s].lot)}</div></th>`;
    if (MODE === 'item') grid.innerHTML = `<thead><tr><th class="c insp-item-c">측정 항목 · 규격</th><th class="c insp-samp-c">시료</th>${nums}</tr></thead>${list.map(([it, ii]) => `<tbody class="insp-grp">${st.samples.map((_, s) => `<tr>${!s ? itemTh(it, st.samples.length, ii) : ''}<th class="insp-samp-c" data-rm-lt="${s}">${esc(st.samples[s].lot)}</th>${cells(ii, s)}</tr>`).join('')}</tbody>`).join('')}<tfoot><tr><td colspan="${W + 4}" class="rm-add-row"><button type="button" class="btn small" data-rm-add>＋ 측정 항목 추가</button> <span class="small muted">엑셀에서 「항목·단위·하한·상한·횟수」 여러 줄을 복사해 항목 이름 칸에 붙여 넣어도 됩니다.</span></td></tr></tfoot>`;
    else grid.innerHTML = `<thead><tr><th class="c insp-samp-c">시료</th><th class="c insp-item-c">측정 항목 · 규격</th>${nums}</tr></thead>${st.samples.map((_, s) => `<tbody class="insp-grp">${list.map(([it, ii], n) => `<tr>${!n ? sampTh(s, list.length) : ''}<th class="insp-item-c">${esc(it.name)}${it.unit ? ` <span class="small muted">${esc(it.unit)}</span>` : ''} <span class="small muted">${rmRange(it).txt}</span></th>${cells(ii, s)}</tr>`).join('')}</tbody>`).join('')}`;
    $('[data-rm-mode]', box).textContent = MODE === 'item' ? '⇄ 종횡 바꾸기 (시료별로 보기)' : '⇄ 종횡 바꾸기 (항목별로 보기)';
    $('[data-rm-hint]', box).textContent = (MODE === 'item' ? '항목별로 묶어 시료를 줄로 보여 줍니다.' : '시료별로 묶어 측정 항목을 줄로 보여 줍니다.') + ' 엑셀에서 여러 칸을 복사해 첫 칸에 붙여 넣으면 그 모양대로 들어갑니다. Enter로 다음 칸.';
    sampleJudges(); total(); st.items.forEach((_, ii) => shade(ii));
  };
  const shade = ii => { // 15.299 불합격이면 그 줄과 측정 항목 칸을 옅은 빨강으로
    let any = false; st.samples.forEach((_, s) => { const f = cellJudge(ii, s)[0] === 'fail'; if (f) any = true; $(`[data-rm-j="${ii}-${s}"]`, grid)?.closest('tr')?.classList.toggle('rm-fail-row', f); });
    $(`[data-rm-item="${ii}"]`, grid)?.classList.toggle('rm-fail-c', any); };
  const sampleJudges = () => st.samples.forEach((_, s) => { const js = named().map(([, ii]) => cellJudge(ii, s)[0]).filter(Boolean); const el = $(`[data-rm-sj="${s}"]`, strip); if (el) el.innerHTML = js.includes('fail') ? RM_CHIP.fail : js.includes('wait') ? RM_CHIP.wait : js.includes('pass') ? RM_CHIP.pass : ''; });
  const refresh = (ii, s) => { const [j, avg] = cellJudge(ii, s), { a, b } = rmRange(st.items[ii]); const av = $(`[data-rm-avg="${ii}-${s}"]`, grid), jj = $(`[data-rm-j="${ii}-${s}"]`, grid); if (av) av.textContent = avg === null ? '' : fmtNum(avg); if (jj) jj.innerHTML = RM_CHIP[j];
    $$(`[data-rm-v][data-ii="${ii}"][data-s="${s}"]`, grid).forEach(i => i.classList.toggle('rm-out', i.value !== '' && ((a !== null && Number(i.value) < a) || (b !== null && Number(i.value) > b)))); sampleJudges(); total(); shade(ii); };
  drawGrid();
  box.addEventListener('input', e => {
    const rs = e.target.dataset.rs; if (rs && e.target.dataset.ii !== undefined) { const ii = Number(e.target.dataset.ii), it = st.items[ii]; it[rs] = e.target.value;
      if (rs === 'count') { const n = Number(e.target.value); if (!Number.isInteger(n) || n < 1 || n > 10) return; st.samples.forEach(fit); drawGrid(); const el = $(`[data-rs="count"][data-ii="${ii}"]`, grid); el?.focus(); return; }
      if (rs === 'min' || rs === 'max') st.samples.forEach((_, s2) => refresh(ii, s2)); else { sampleJudges(); total(); }
      return; }
    const v = e.target.closest('[data-rm-v]'); if (v) { st.samples[Number(v.dataset.s)].vals[Number(v.dataset.ii)][Number(v.dataset.k)] = v.value; refresh(Number(v.dataset.ii), Number(v.dataset.s)); return; }
    const l = e.target.closest('[data-rm-lot]'); if (l) { const s = Number(l.dataset.rmLot); st.samples[s].lot = l.value; $$(`[data-rm-lt="${s}"]`, grid).forEach(x => { x.textContent = l.value; }); }
  });
  // 15.296 엑셀 붙여넣기: 측정값 칸에 여러 칸을 붙이면 복사한 모양대로(가로 = #1·#2…, 세로 = 다음 시료/다음 항목, 시료가 모자라면 20개까지 자동 추가),
  // 규격 표에 붙이면 측정 항목·단위·하한·상한·횟수 순서로(줄이 모자라면 항목 추가).
  box.addEventListener('paste', e => {
    const v = e.target.closest('[data-rm-v]'), sp = e.target.dataset.rs && e.target.dataset.ii !== undefined ? e.target : null;
    if (!v && !sp) return;
    const rows = xlGrid(e); if (!rows) return; e.preventDefault();
    let put = 0, skip = 0;
    if (v) {
      const list = named().map(([, ii]) => ii), ii0 = Number(v.dataset.ii), s0 = Number(v.dataset.s), k0 = Number(v.dataset.k), p0 = list.indexOf(ii0);
      rows.forEach((vals, i) => {
        let ii = ii0, s = s0; if (st.mode === 'item') s = s0 + i; else ii = list[p0 + i];
        if (ii === undefined) { skip += vals.length; return; }
        while (s >= st.samples.length) { if (st.samples.length >= 20) { skip += vals.length; return; } const x = { lot: `시료 ${st.samples.length + 1}`, vals: [] }; fit(x); st.samples.push(x); }
        vals.forEach((raw, j) => { const k = k0 + j, cell = st.samples[s].vals[ii]; const n = xlNum(raw); if (k >= cell.length || n === null) { if (raw !== '') skip++; return; } cell[k] = n; put++; });
      });
      drawGrid();
      const last = rows.length - 1, lastLen = rows[last].length; const lr = st.mode === 'item' ? { ii: ii0, s: Math.min(s0 + last, st.samples.length - 1) } : { ii: list[Math.min(p0 + last, list.length - 1)], s: s0 };
      $(`[data-rm-v][data-ii="${lr.ii}"][data-s="${lr.s}"][data-k="${Math.min(k0 + lastLen - 1, st.samples[lr.s].vals[lr.ii].length - 1)}"]`, grid)?.focus();
    } else {
      const KEYS = ['name', 'unit', 'min', 'max', 'count'], c0 = KEYS.indexOf(e.target.dataset.rs), i0 = Number(sp.dataset.ii);
      rows.forEach((vals, i) => {
        const ii = i0 + i; if (ii >= 30) { skip += vals.length; return; }
        while (ii >= st.items.length) st.items.push({ name: '', unit: '', min: '', max: '', count: 1 });
        vals.forEach((raw, j) => { const key = KEYS[c0 + j]; if (!key) { if (raw !== '') skip++; return; }
          if (key === 'name' || key === 'unit') { st.items[ii][key] = raw.slice(0, key === 'name' ? 100 : 30); put++; return; }
          const n = xlNum(raw); if (n === null) { skip++; return; }
          if (key === 'count') { const c = Math.round(Number(n) || 1); st.items[ii].count = Math.max(1, Math.min(10, c)); } else st.items[ii][key] = n; put++; });
      });
      st.samples.forEach(fit); drawGrid();
    }
    toast(`엑셀에서 ${put}칸을 붙여 넣었습니다.${skip ? ` (${skip}칸은 칸이 없거나 숫자가 아니라 뺐습니다)` : ''}`, skip ? 'err' : undefined);
  });
  box.addEventListener('keydown', e => { // 15.297 항목 칸에서 Enter: 다음 칸(이름 → 단위 → 하한 → 상한 → 횟수 → 그 항목 첫 측정 칸), 폼 저장 안 됨
    if (e.key !== 'Enter' || !e.target.dataset.rs || e.target.dataset.ii === undefined) return; e.preventDefault();
    const ii = e.target.dataset.ii, order = ['name', 'unit', 'min', 'max', 'count'], nx = order[order.indexOf(e.target.dataset.rs) + 1];
    const el = nx ? $(`[data-rs="${nx}"][data-ii="${ii}"]`, grid) : $(`[data-rm-v][data-ii="${ii}"][data-s="0"][data-k="0"]`, grid); el?.focus(); el?.select?.();
  });
  box.addEventListener('keydown', e => { const v = e.target.closest('[data-rm-v]'); if (v && e.key === 'Enter') { e.preventDefault(); const all = $$('[data-rm-v]', grid), i = all.indexOf(v); all[i + 1]?.focus(); all[i + 1]?.select?.(); } });
  box.addEventListener('click', e => {
    if (e.target.closest('[data-rm-add]')) { if (st.items.length >= 30) return toast('측정 항목은 30개까지입니다.', 'err');
      if (RM_MODE !== 'item') { RM_MODE = 'item'; try { localStorage.setItem('wpa:rm-mode', RM_MODE); } catch { /* 편의 */ } }
      st.items.push({ name: '', unit: '', min: '', max: '', count: 1 }); st.samples.forEach(fit); drawGrid(); const el = $(`[data-rs="name"][data-ii="${st.items.length - 1}"]`, grid); el?.scrollIntoView({ block: 'nearest' }); el?.focus(); return; }
    const d = e.target.closest('[data-rm-del]'); if (d) { const ii = Number(d.dataset.rmDel); if (st.items.length === 1) { st.items[0] = { name: '', unit: '', min: '', max: '', count: 1 }; } else { st.items.splice(ii, 1); st.samples.forEach(s => s.vals.splice(ii, 1)); } st.samples.forEach(fit); drawGrid(); return; }
    if (e.target.closest('[data-rm-sadd]')) { if (st.samples.length >= 20) return toast('시료는 20개까지입니다.', 'err'); const s = { lot: `시료 ${st.samples.length + 1}`, vals: [] }; fit(s); st.samples.push(s); drawGrid(); $(`[data-rm-lot="${st.samples.length - 1}"]`, strip)?.select(); return; }
    const sd = e.target.closest('[data-rm-sdel]'); if (sd) { st.samples.splice(Number(sd.dataset.rmSdel), 1); drawGrid(); return; }
    if (e.target.closest('[data-rm-mode]')) { if (!named().length) return toast('먼저 측정 항목 이름을 넣으세요.', 'err'); RM_MODE = st.mode === 'item' ? 'sample' : 'item'; try { localStorage.setItem('wpa:rm-mode', RM_MODE); } catch { /* 편의 */ } drawGrid(); }
  });
  const put = list => { const empty = st.items.every(it => !it.name.trim()); if (empty) st.items = []; for (const it of list) st.items.push({ name: it.name, unit: it.unit || '', min: it.min ?? '', max: it.max ?? '', count: it.count || 1 }); st.samples.forEach(fit); drawGrid(); };
  box._rm = st;
  const [specs, lib, rspecs] = await Promise.all([api('GET', '/api/inspection-specs').then(x => (x.specs || []).filter(s => s.active)).catch(() => []), api('GET', '/api/inspection-items').then(x => x.items || []).catch(() => []),
    api('GET', '/api/rnd-specs').then(x => (x.specs || []).filter(s => s.active !== false).sort((a, b) => (a.group || '').localeCompare(b.group || '', 'ko') || a.name.localeCompare(b.name, 'ko'))).catch(() => [])]); // 15.295 연구소 검사규격
  $('[data-rm-rspec]', box).insertAdjacentHTML('beforeend', rspecs.length ? rspecs.map((s, i) => `<option value="${i}">${s.group ? esc(s.group) + ' · ' : ''}${esc(s.name)} (${s.items.length}항목)</option>`).join('') : '<option value="" disabled>아직 없음 — ⚙ 항목설정에서 만드세요</option>');
  $('[data-rm-rspec]', box).onchange = e => { const s = rspecs[Number(e.target.value)]; e.target.value = ''; if (s) put(s.items); };
  $('[data-rm-spec]', box).insertAdjacentHTML('beforeend', specs.map((s, i) => `<option value="${i}">${esc(s.kind)} · ${esc(s.item_category)} · ${esc(s.product)} (${s.items.length}항목)</option>`).join(''));
  $('[data-rm-lib]', box).insertAdjacentHTML('beforeend', lib.map((it, i) => `<option value="${i}">${esc(it.group)} · ${esc(it.name)}${it.unit ? ` (${esc(it.unit)})` : ''}</option>`).join(''));
  $('[data-rm-spec]', box).onchange = e => { const s = specs[Number(e.target.value)]; e.target.value = ''; if (s) put(s.items); };
  $('[data-rm-lib]', box).onchange = e => { const it = lib[Number(e.target.value)]; e.target.value = ''; if (it) put([it]); };
}
function readRndMeasure(root) {
  const st = $('[data-rm]', root)?._rm; if (!st) return { spec_items: [], samples: [] };
  const keep = st.items.map((it, ii) => [it, ii]).filter(([it]) => it.name.trim());
  return { spec_items: keep.map(([it]) => ({ name: it.name.trim(), unit: it.unit, min: it.min, max: it.max, count: it.count || 1 })),
    samples: st.samples.map((s, n) => ({ lot: s.lot.trim() || `시료 ${n + 1}`, values: Object.fromEntries(keep.map(([, ii], k) => ['i' + k, s.vals[ii].map(v => v === '' ? null : v)])) })) };
}
// 측정값 표(읽기 전용): 항목별 묶음 · 시료 줄
function rndMeasureTable(spec, m) {
  if (!spec?.items?.length) return '';
  const rows = m?.rows?.length ? m.rows : [{ lot: '', values: {} }], W = Math.max(1, ...spec.items.map(it => it.count || 1));
  return `<div class="table-wrap"><table class="grid keep-table insp-grid rm-view" data-no-sort data-no-filter data-keep-cols><thead><tr><th class="c insp-item-c">측정 항목 · 규격</th><th class="c insp-samp-c">시료</th>${Array.from({ length: W }, (_, k) => `<th class="c insp-n">#${k + 1}</th>`).join('')}<th class="c">평균</th><th class="c">판정</th></tr></thead>${spec.items.map(it => { const anyFail = rows.some(r => rmJudgeVals(it, r.values?.[it.key] || [])[0] === 'fail'); return `<tbody class="insp-grp${anyFail ? ' rm-fail' : ''}">${rows.map((r, s) => { const vals = (r.values?.[it.key] || []), [j, avg] = rmJudgeVals(it, vals), { a, b } = rmRange(it);
    return `<tr${j === 'fail' ? ' class="rm-fail-row"' : ''}>${!s ? `<th rowspan="${rows.length}" class="insp-item-c"><b>${esc(it.name)}</b>${it.unit ? ` <span class="small muted">${esc(it.unit)}</span>` : ''}<div class="small muted">${rmRange(it).txt}</div></th>` : ''}<th class="insp-samp-c">${esc(r.lot || `시료 ${s + 1}`)}</th>${Array.from({ length: W }, (_, k) => k >= (it.count || 1) ? '<td class="insp-blank"></td>' : `<td class="r${vals[k] != null && ((a !== null && vals[k] < a) || (b !== null && vals[k] > b)) ? ' red-text' : ''}">${vals[k] == null ? '<span class="muted">·</span>' : fmtNum(vals[k])}</td>`).join('')}<td class="r">${avg === null ? '' : fmtNum(avg)}</td><td>${RM_CHIP[j]}</td></tr>`; }).join('')}</tbody>`; }).join('')}</table></div>
    <p class="small">전체 판정 ${{ pass: RM_CHIP.pass, fail: RM_CHIP.fail, pending: RM_CHIP.wait }[m?.result] || ''} <span class="muted">· 시료 ${rows.length} · ${esc(m?.updated_by || '')} ${esc(String(m?.updated_at || '').slice(0, 16))}${m?.revision > 1 ? ` · 수정 ${m.revision - 1}회` : ''}</span></p>`;
}
async function rndMeasureEdit(r, after) {
  const cur = await api('GET', `/api/requests/${r.id}/rnd-measure`); let root = null;
  const v = await promptBox(`측정값 ${cur.measurement ? '수정' : '입력'} · ${r.req_no || ''} ${r.title}`, `${rndMeasureHtml()}<label>종합 의견 <span class="hint">(선택)</span><textarea name="result_note" rows="2" maxlength="1000">${esc(cur.memo || '')}</textarea></label>${cur.measurement ? '<label>수정 사유 *<input name="reason" required maxlength="300" placeholder="예) 재측정 값으로 정정"></label>' : ''}`, { wide: true,
    onOpen: el => { root = el; el.classList.add('insp-modal'); bindRndMeasure(el, cur.spec ? { items: cur.spec.items, rows: cur.measurement?.rows || [] } : (r.data?.items || []).length ? { items: [...r.data.items.filter(x => x && x !== '기타'), ...(r.data.items_etc ? [r.data.items_etc] : [])].slice(0, 30).map(name => ({ name, unit: '', min: '', max: '', count: 1 })), rows: [] } : null).catch(fail); /* 15.305 품질 분석의뢰: 의뢰 항목을 미리 채움 */ },
    submit: async val => api('PUT', `/api/requests/${r.id}/rnd-measure`, { ...val, ...readRndMeasure(root) }) });
  if (v) { toast('측정값을 저장했습니다.'); await after?.(); }
}
// 15.288 분석데이터 입력 칸(연구원): 개발건 단계 창과 연구 분석 관리 › 분석데이터 입력이 같이 쓴다.
function rndDataFields({ step = '', steps = [], title = '', devs = null, devId = '' } = {}) {
  const cfg = REQ.rnd_analysis, cats = cfg.fields.find(f => f.k === 'category').opts, items = cfg.fields.find(f => f.k === 'items').opts;
  return `<div class="form-grid"><label>분석일 *<input type="date" name="analysis_date" data-ad-req required value="${todayStr()}"></label>
      ${devs ? `<label>개발건 <span class="hint">(선택)</span><select name="dev_request_id"><option value="">연결 안 함</option>${devs.map(d => `<option value="${d.id}"${d.id === Number(devId) ? ' selected' : ''}>${esc(d.req_no || '')} ${esc(d.title)}${d.customer ? ` · ${esc(d.customer)}` : ''}</option>`).join('')}</select></label>` : ''}
      <label>단계<select name="dev_step"><option value="">단계 미지정</option>${steps.map(s => `<option${s.name === step ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label>분석 구분 *<select name="category" data-ad-req required>${cats.map(c => `<option${c === '시제품분석' ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="span2">샘플·시료명 *<input name="title" data-ad-req required maxlength="200" value="${esc(title)}"></label>
      <label>샘플수량<input name="sample_qty" maxlength="50"></label>${devs ? '<label>고객사<input name="customer" maxlength="100" placeholder="개발건을 고르면 그 고객사"></label>' : ''}</div>
    ${rndMeasureHtml()}
    <label>종합 의견 <span class="hint">(선택 · 측정값이 없으면 여기에 결과를 적으세요)</span><textarea name="result_note" rows="2" maxlength="1000" placeholder="예) 2차 샘플 대비 파티클 개선, 양산 적용 검토"></textarea></label>
    <label>비고<input name="note" maxlength="300"></label>`;
}
// 15.287·15.288 개발건 단계 「＋ 분석데이터」: ① 완료된 분석 불러와 이 단계에 맞추기 ② 새로 입력(연구원)
async function rndAnalysisData(dev, step = '') {
  const done = (await api('GET', '/api/requests?' + new URLSearchParams({ type: 'rnd_analysis', status: 'done' }))).filter(a => !(a.data?.dev_request_id === dev.id && (a.data?.dev_step || '') === step));
  let root = null, mode = done.length ? 'import' : 'new';
  const rows = done.map(a => `<tr data-imp-row data-q="${esc(`${a.req_no} ${a.title} ${a.category} ${a.result_note} ${a.data?.dev_title || ''}`.toLowerCase())}"><td class="c"><input type="checkbox" data-imp="${a.id}" aria-label="${esc(a.req_no)}"></td><td class="nowrap"><b>${esc(a.req_no || '')}</b><div class="small muted">${esc(a.data?.analysis_date || String(a.updated_at || '').slice(0, 10))}</div></td><td><b>${esc(a.title)}</b> <span class="chip">${esc(a.category)}</span><div class="small">${esc(a.result_note || '')}</div></td><td class="small">${a.data?.dev_request_id ? `<span class="chip yellow">연결됨</span> ${esc(a.data.dev_title || '')}${a.data.dev_step ? ` · ${esc(a.data.dev_step)}` : ''}` : '<span class="muted">연결 안 됨</span>'}</td></tr>`).join('');
  const v = await promptBox(`분석데이터 · ${dev.title}${step ? ` · ${step}` : ''}`, `<div class="seg ad-mode" role="group" aria-label="방식"><button type="button" data-ad-mode="import">완료된 분석 불러오기 <span class="small muted">${done.length}</span></button><button type="button" data-ad-mode="new">새로 입력</button></div>
    <section data-ad-sec="import"><p class="small muted">연구 분석 관리에서 입력해 둔 <b>완료된 분석</b>을 골라 이 단계${step ? `(「${esc(step)}」)` : ''}에 맞춥니다. 다른 개발건·단계에 연결된 것을 고르면 이 단계로 옮겨집니다.</p>
      ${done.length ? `<label class="list-search">찾기<input type="search" data-imp-q placeholder="번호·시료명·구분·결과"></label><div class="table-wrap ad-imp"><table class="grid keep-table" data-no-sort data-no-filter data-keep-cols><thead><tr><th></th><th>번호 · 분석일</th><th>시료 · 결과</th><th>지금 연결</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">불러올 완료된 분석이 없습니다. 「새로 입력」으로 넣으세요.</p>'}</section>
    <section data-ad-sec="new">${rndDataFields({ step, steps: dev.steps, title: `${dev.title}${step ? ' ' + step : ''}` })}</section>`, { wide: true,
    onOpen: el => { root = el;
      const setMode = m => { mode = m; $$('[data-ad-mode]', el).forEach(b => b.classList.toggle('on', b.dataset.adMode === m)); $$('[data-ad-sec]', el).forEach(x => { x.hidden = x.dataset.adSec !== m; }); $$('[data-ad-req]', el).forEach(i => { i.required = m === 'new'; }); };
      el.addEventListener('click', e => { const b = e.target.closest('[data-ad-mode]'); if (b) setMode(b.dataset.adMode); const tr = e.target.closest('[data-imp-row]'); if (tr && !e.target.closest('input')) { const c = $('[data-imp]', tr); c.checked = !c.checked; } });
      $('[data-imp-q]', el)?.addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $$('[data-imp-row]', el).forEach(tr => { tr.hidden = q && !tr.dataset.q.includes(q); }); });
      setMode(mode); el.classList.add('insp-modal'); bindRndMeasure(el).catch(fail); },
    submit: async val => {
      if (mode === 'import') { const ids = $$('[data-imp]:checked', root).map(c => Number(c.dataset.imp)); if (!ids.length) throw new Error('불러올 분석을 고르세요.'); for (const id of ids) await api('POST', `/api/requests/${id}/dev-link`, { dev_request_id: dev.id, dev_step: step }); return { imported: ids.length }; }
      return api('POST', `/api/dev-roadmap/${dev.id}/analysis-data`, { ...val, items: $$('[data-ad-item]:checked', root).map(i => i.value), ...readRndMeasure(root) }); } });
  if (v) toast(v.imported ? `완료된 분석 ${v.imported}건을 이 단계에 맞췄습니다.` : `분석데이터를 저장했습니다 · ${v.req_no}`);
  return !!v;
}
// 15.288 개발 › 연구 분석 관리 › 분석데이터 입력(연구원만): 의뢰·승인 없이 완료된 분석으로 저장, 개발건·단계는 골라서 연결
async function pageRndData(main) {
  const can = hasRole('dev') || hasRole('dev_approver');
  main.innerHTML = `<h1>연구 분석 관리 <span class="dept">연구소</span></h1>
    <p class="muted">연구원이 분석한 데이터를 바로 넣습니다. 저장하면 완료된 연구 분석(RA-분석일 번호)이 되어 분석리스트에 올라가고, 개발건·단계를 고르면 개발 › 스케줄 관리의 단계별 분석 결과와 소통 이력에도 남습니다. 그래프·성적서는 저장 뒤 분석을 열어 「사진 보기·첨부」로 붙입니다.</p>
    ${can ? '<form class="card stack rnd-data-form" id="rndDataForm"><p class="muted">불러오는 중…</p></form>' : '<div class="empty">분석데이터는 연구원(개발·개발책임자)만 입력합니다. 결과는 「분석리스트」에서 볼 수 있습니다.</div>'}
    <section class="card"><h3>최근 입력한 분석데이터</h3><div id="rndRecent"><p class="muted">불러오는 중…</p></div></section>`;
  const recent = async () => { const list = (await api('GET', '/api/requests?' + new URLSearchParams({ type: 'rnd_analysis', status: 'done' }))).slice(0, 10);
    $('#rndRecent', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid keep-table"><thead><tr><th>번호</th><th>분석일</th><th>시료명</th><th>구분</th><th>결과</th><th>개발건 · 단계</th></tr></thead><tbody>${list.map(a => `<tr data-rnd="${a.id}" style="cursor:pointer"><td class="nowrap"><b>${esc(a.req_no || '')}</b></td><td class="nowrap">${esc(a.data?.analysis_date || '')}</td><td>${esc(a.title)}</td><td>${esc(a.category)}</td><td class="small">${esc(a.result_note || '')}</td><td class="small">${a.data?.dev_request_id ? `${esc(a.data.dev_title || '')}${a.data.dev_step ? ` · ${esc(a.data.dev_step)}` : ''}` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">아직 없습니다.</p>';
    $$('[data-rnd]', main).forEach(tr => tr.onclick = () => rndOpen(Number(tr.dataset.rnd), recent).catch(fail)); };
  if (can) {
    const devs = (await api('GET', '/api/dev-roadmap')).rows, form = $('#rndDataForm', main);
    form.innerHTML = rndDataFields({ devs }) + '<div class="actions"><button class="btn primary">분석데이터 저장</button></div>';
    await bindRndMeasure(form);
    const stepSel = form.elements.dev_step;
    form.elements.dev_request_id.onchange = e => { const d = devs.find(x => x.id === Number(e.target.value)); stepSel.innerHTML = '<option value="">단계 미지정</option>' + (d?.steps || []).map(s => `<option>${esc(s.name)}</option>`).join(''); if (d && !form.elements.title.value) form.elements.title.value = d.title; };
    form.onsubmit = async e => { e.preventDefault(); const btn = $('button.primary', form); btn.disabled = true;
      try { const r = await api('POST', '/api/rnd-analysis-data', { ...formObj(form), items: $$('[data-ad-item]:checked', form).map(i => i.value), ...readRndMeasure(form) }); toast(`분석데이터를 저장했습니다 · ${r.req_no}`); form.reset(); form.elements.analysis_date.value = todayStr(); stepSel.innerHTML = '<option value="">단계 미지정</option>'; $('[data-rm]', form).outerHTML = rndMeasureHtml(); await bindRndMeasure(form); await recent(); }
      catch (error) { fail(error); } finally { btn.disabled = false; } };
  }
  await recent();
}
async function rndOpen(id, after) {
  const all = await api('GET', '/api/requests?type=rnd_analysis'); const r = all.find(x => x.id === id);
  if (!r) throw new Error('분석의뢰를 찾을 수 없습니다.');
  requestDetail('rnd_analysis', r, after);
}
async function rndDevLinkBox(r, after) {
  const devs = (await api('GET', '/api/dev-roadmap?done=1')).rows, cur = r.data?.dev_request_id || '';
  let root = null;
  const steps = id => (devs.find(d => d.id === Number(id))?.steps || []).map(s => `<option${s.name === (r.data?.dev_step || '') ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  const v = await promptBox('개발건 연결', `<p class="small muted">이 분석을 진행 중인 개발건과 로드맵 단계에 연결하면, 개발 › 스케줄 관리의 진행건 창 「단계별 분석 결과」와 소통 이력에 결과가 남습니다.</p>
    <label>개발건<select name="dev_request_id"><option value="">연결 안 함</option>${devs.map(d => `<option value="${d.id}"${d.id === Number(cur) ? ' selected' : ''}>${esc(d.req_no || '')} ${esc(d.title)}${d.customer ? ` · ${esc(d.customer)}` : ''}</option>`).join('')}</select></label>
    <label>단계<select name="dev_step"><option value="">단계 미지정</option>${cur ? steps(cur) : ''}</select></label>`, {
    onOpen: el => { root = el; el.querySelector('[name=dev_request_id]').onchange = e => { el.querySelector('[name=dev_step]').innerHTML = '<option value="">단계 미지정</option>' + steps(e.target.value); }; },
    submit: async val => api('POST', `/api/requests/${r.id}/dev-link`, val) });
  if (v) { toast(v.data?.dev_request_id ? '개발건에 연결했습니다.' : '연결을 끊었습니다.'); await after?.(); }
}
async function devCaseWindow(id, done) {
  const load1 = async () => (await api('GET', '/api/dev-roadmap?id=' + id)).rows[0];
  let r = await load1(); if (!r) throw new Error('개발 의뢰를 찾을 수 없습니다.');
  DEV_DIRECTORY ||= await api('GET', '/api/directory').catch(() => []);
  const canOwn = hasRole('dev') || hasRole('dev_approver') || hasRole('sales'), canPlan = hasRole('dev') || hasRole('dev_approver');
  const defKind = hasRole('sales') && !hasRole('dev') && !ME?.is_admin ? '영업' : '진행';
  const opt = (sel) => `<option value="">미지정</option>${DEV_DIRECTORY.map(u => `<option value="${u.id}"${Number(sel) === u.id ? ' selected' : ''}>${esc(u.name)}${u.department ? ` · ${esc(u.department)}` : ''}${u.position ? ` ${esc(u.position)}` : ''}</option>`).join('')}`;
  let changed = false;
  const m = modal(`<div class="dev-case"><h3>${esc(r.title)} <span class="small muted">${esc(r.req_no || '')}</span></h3><div data-dc-summary></div>
    <fieldset class="vendor-sec dc-ana"><legend>단계별 분석 결과 <span class="hint">(연구팀 분석 · 로드맵 공정 단계별)</span></legend><div data-dc-ana></div></fieldset>
    <fieldset class="vendor-sec dc-owners"><legend>담당자</legend><div class="form-grid">
      <label>개발 담당자<select name="dev_owner_id" ${canOwn ? '' : 'disabled'}>${opt(r.dev_owner_id)}</select></label>
      <label>영업 담당자<select name="sales_owner_id" ${canOwn ? '' : 'disabled'}>${opt(r.sales_owner_id)}</select></label>
      <div class="dc-owner-act">${canOwn ? '<button type="button" class="btn small primary" data-dc-owner-save>담당자 저장</button>' : '<span class="small muted">개발·영업 담당자가 지정합니다.</span>'}</div></div></fieldset>
    <fieldset class="vendor-sec"><legend>소통 <span class="hint">(진행내용·영업 코멘트·요청을 남기면 모두가 봅니다 · Ctrl+Enter 등록)</span></legend>
      <div class="dc-filter seg" role="group" aria-label="소통 구분">${[['all', '전체'], ...DEV_TALK.slice(0, 3).map(([k, l]) => [k, l]), [DEV_ANA[0], DEV_ANA[1]]].map(([k, l]) => `<button type="button" data-dc-f="${k}" class="${k === 'all' ? 'on' : ''}">${l}</button>`).join('')}</div>
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
  // 15.286 단계별 분석 결과: 로드맵 공정 순서대로, 각 단계에 연결된 연구 분석(상태·결과). 단계마다 「＋ 분석의뢰」
  const canAna = hasRole('dev') || hasRole('dev_approver');
  const anaBox = () => {
    const list = r.analyses || [], names = [...r.steps.map(s => s.name), ...list.map(a => a.dev_step).filter(Boolean)].filter((n, i, all) => all.indexOf(n) === i);
    const groups = [...names.map(n => [n, r.steps.find(s => s.name === n)]), ['', null]];
    const item = a => `<button type="button" class="dc-ana-item st-${a.status}${a.judge === 'fail' ? ' j-fail' : ''}" data-dc-ana-open="${a.id}">${a.req_no ? `<span class="dc-ana-no">${esc(a.req_no)}</span> ` : ''}<b>${esc(a.title)}</b> <span class="chip">${esc(a.category)}</span> ${a.judge === 'pass' ? '<span class="chip green">합격</span>' : a.judge === 'fail' ? '<span class="chip red">불합격</span>' : a.judge === 'pending' ? '<span class="chip yellow">측정 중</span>' : statusChip(a.status)}<div class="dc-ana-res">${a.result_note ? `결과 <b>${esc(a.result_note)}</b>` : '<span class="muted">결과 대기</span>'} <span class="small muted">· ${esc(a.analysis_date || String(a.updated_at || a.created_at).slice(0, 10))}</span></div></button>`;
    $('[data-dc-ana]', el).innerHTML = groups.map(([n, st]) => { const as = list.filter(a => (a.dev_step || '') === n); if (!n && !as.length) return ''; return `<div class="dc-ana-step"><div class="dc-ana-h"><b>${n ? esc(n) : '단계 미지정'}</b>${st ? ` <span class="small muted">${esc((st.start_date || '').slice(5))}~${esc((st.end_date || '').slice(5))}</span> <span class="chip" style="color:${DEV_STEP_STATE[st.status]?.[1]};border-color:${DEV_STEP_STATE[st.status]?.[1]}">${DEV_STEP_STATE[st.status]?.[0] || ''}</span>` : ''}<span class="small muted">분석 ${as.length}건${as.length ? ` · 완료 ${as.filter(a => a.status === 'done').length}` : ''}</span>${canAna ? `<button type="button" class="btn small" data-dc-ana-new="${esc(n)}">＋ 분석데이터</button>` : ''}</div>${as.map(item).join('') || '<p class="small muted dc-ana-none">아직 연결된 분석이 없습니다.</p>'}</div>`; }).join('') || '<p class="small muted">공정표에 단계를 넣으면 단계별로 분석데이터를 넣고 볼 수 있습니다.</p>';
    if (!r.steps.length && !list.length && canAna) $('[data-dc-ana]', el).insertAdjacentHTML('beforeend', '<div class="actions" style="justify-content:flex-start"><button type="button" class="btn small" data-dc-ana-new="">＋ 분석데이터</button></div>');
  };
  anaBox();
  const endpoint = `/api/comments/request/${id}`; let rows = [], next = null, filter = 'all';
  const thread = $('[data-dc-thread]', el);
  const draw = () => {
    const list = rows.slice().sort((a, b) => a.id - b.id).filter(c => filter === 'all' || devTalkKind(c.content)[0] === filter);
    thread.innerHTML = list.length ? list.map(c => { const [k, body] = devTalkKind(c.content), info = k === '담당자' ? ['담당자', '담당자 변경', '#5f3dc4'] : k === '분석' ? DEV_ANA : DEV_TALK.find(x => x[0] === k) || DEV_TALK[3], mine = c.author_id === ME?.id;
      return `<div class="dc-msg${mine ? ' mine' : ''}${k === '담당자' ? ' sys' : ''}" style="--c:${info[2]}"><div class="dc-meta"><span class="dc-kind-chip">${info[1]}</span><b>${esc(c.author_name)}</b><time>${esc(c.created_at.slice(0, 16))}</time>${mine && c.content !== '(삭제됨)' && k !== '담당자' && k !== '분석' ? `<button type="button" class="linklike small" data-dc-del="${c.id}">지우기</button>` : ''}</div><div class="dc-body">${esc(body)}</div></div>`; }).join('')
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
    if (e.target.closest('[data-dc-plan]')) { await devPlanEditor(r, async () => { changed = true; r = await load1(); summary(); anaBox(); }); return; }
    const an = e.target.closest('[data-dc-ana-new]'); if (an) { if (await rndAnalysisData(r, an.dataset.dcAnaNew)) { changed = true; r = await load1(); anaBox(); await loadTalk(); } return; }
    const ao = e.target.closest('[data-dc-ana-open]'); if (ao) { await rndOpen(Number(ao.dataset.dcAnaOpen), async () => { changed = true; r = await load1(); anaBox(); await loadTalk(); }); return; }
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
  main.innerHTML = `<h1>스케줄 관리 <span class="dept">연구소</span></h1>
  <p class="muted">개발리스트의 제품마다 구분(단기·중장기·장기), 공정표, 현재 진행현황·다음 진행예정·완료예정일을 넣으면 로드맵에 표시됩니다. 줄을 누르면 진행건 창(담당자·소통), ✎는 일정 입력입니다.</p>
  <div class="dr-kpis" id="drKpis"></div>
  <form class="toolbar list-filters dr-tools" id="drForm" data-read-only="true">
    <div class="seg" role="group" aria-label="구분" data-dr-terms>${[['all', '전체'], ...DEV_TERM.map(([k, l]) => [k, l])].map(([k, l]) => `<button type="button" data-dr-term="${k}">${l}</button>`).join('')}</div>
    <label class="list-search">검색<input type="search" name="q" maxlength="100" placeholder="제품·거래처·의뢰번호·담당자"></label>
    <label>정렬<select name="sort"><option value="end">완료예정 빠른 순</option><option value="next">다음 일정 빠른 순</option><option value="progress">진행률 낮은 순</option><option value="title">제품명 순</option></select></label>
    <label class="inline"><input type="checkbox" name="mine" value="1"> 내 담당만</label><label class="inline"><input type="checkbox" name="done" value="1"> 완료 포함</label>
    <button type="submit" class="btn primary">조회</button></form>
  <div class="dr-bar-top"><div class="seg dr-zoom" role="group" aria-label="보기 범위">${[['3m', '3개월'], ['6m', '6개월'], ['1y', '1년'], ['all', '전체']].map(([k, l]) => `<button type="button" data-dr-zoom="${k}">${l}</button>`).join('')}</div><span class="dr-pan"><button type="button" class="btn small" data-dr-pan="-1" aria-label="앞으로(왼쪽)">◀</button><button type="button" class="btn small" data-dr-today>오늘로</button><button type="button" class="btn small" data-dr-pan="1" aria-label="뒤로(오른쪽)">▶</button></span><span class="small muted dr-drag-hint">로드맵을 누른 채 좌우로 끌면 이동</span>
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
      const steps = r.steps.filter(s => s.start_date && s.end_date).map(s => { const w = Math.max(0.6, pct(s.end_date) - pct(s.start_date)), wpx = w / 100 * W; return `<i class="dr-step st-${s.status}" style="left:${pct(s.start_date)}%;width:${w}%;background:${DEV_STEP_STATE[s.status]?.[1] || '#adb5bd'}" title="${esc(`${s.name} · ${s.start_date}~${s.end_date} · ${DEV_STEP_STATE[s.status]?.[0] || ''}${(r.analyses || []).filter(a => a.dev_step === s.name).map(a => `\n🔬 ${a.req_no || ''} ${a.title} · ${a.result_note || '결과 대기'}`).join('')}`)}">${wpx >= 46 ? `<span>${esc(s.name)}${(r.analyses || []).some(a => a.dev_step === s.name) ? ` 🔬${(r.analyses || []).filter(a => a.dev_step === s.name).length}` : ''}</span>` : ''}</i>`; }).join('');
      const next = r.next_date ? `<em class="dr-next" style="left:${pct(r.next_date)}%" title="${esc(`다음: ${r.next_step || ''} (${r.next_date})`)}">◆</em>` : '';
      const capLeft = Math.max(start && end ? pct(start) : 0, pct(today)), cap = r.current_stage || r.next_step ? `<div class="dr-cap" style="left:min(${capLeft}%, calc(100% - 320px))">${r.current_stage ? `<span>현재 <b>${esc(r.current_stage)}</b></span>` : ''}${r.next_step ? `<span>다음 <b>${esc(r.next_step)}</b>${r.next_date ? ` ${esc(r.next_date.slice(5).replace('-', '/'))}` : ''}</span>` : ''}</div>` : '';
      const dd = ddClass(r);
      return `<div class="dr-row${late ? ' is-late' : ''}" data-dr="${r.id}" tabindex="0" title="눌러서 진행건 열기(담당자·스케줄·소통)">
        <div class="dr-label"><div class="dr-l1"><b class="dr-title">${esc(r.title)}</b>${r.status === 'done' ? '<span class="chip green">완료</span>' : late ? '<span class="chip red">지연</span>' : ''}${end && r.status !== 'done' ? `<span class="dr-dd ${dd}">${dday(end)}</span>` : ''}${r.comment_count ? `<span class="dr-talk" title="${esc(r.last_comment || '')}">💬 ${r.comment_count}</span>` : ''}${(r.analyses || []).length ? `<span class="dr-ana" title="연구 분석 ${r.analyses.length}건 · 완료 ${r.analyses.filter(a => a.status === 'done').length}">🔬 ${r.analyses.filter(a => a.status === 'done').length}/${r.analyses.length}</span>` : ''}${canPlan ? `<button type="button" class="dr-edit" data-dr-edit="${r.id}" title="일정·공정표 입력" aria-label="${esc(r.title)} 일정 입력">✎</button>` : ''}</div>
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
    $('#drTable', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>구분</th><th>제품</th><th>거래처</th><th>현재 진행현황</th><th>다음 진행예정</th><th>다음 예정일</th><th>완료예정일</th><th class="r">D-day</th><th class="r">진행률</th><th>공정</th><th>분석</th><th>개발 담당</th><th>영업 담당</th><th>최근 소통</th></tr></thead><tbody>${list.map(r => { const end = endOf(r), t = DEV_TERM.find(x => x[0] === (r.term || '')) || DEV_TERM[3]; return `<tr data-dr="${r.id}" style="cursor:pointer"><td><span class="chip" style="border-color:${t[2]};color:${t[2]}">${t[1]}</span></td><td><b>${esc(r.title)}</b><div class="small muted">${esc(r.req_no || '')}</div></td><td>${esc(r.customer || '')}</td><td>${esc(r.current_stage || '')}</td><td>${esc(r.next_step || '')}</td><td class="nowrap">${esc(r.next_date || '')}</td><td class="nowrap">${esc(end)}</td><td class="r nowrap"><span class="dr-dd ${ddClass(r)}">${r.status === 'done' ? '' : dday(end)}</span></td><td class="r"><div class="dr-mini"><b style="width:${r.progress || 0}%"></b></div>${r.progress || 0}%</td><td class="small">${r.steps.length ? `${r.steps.filter(s => s.status === 'done').length}/${r.steps.length}` : ''}</td><td class="small">${(r.analyses || []).length ? `🔬 ${r.analyses.filter(a => a.status === 'done').length}/${r.analyses.length}` : ''}</td><td>${esc(r.dev_owner_name || '')}</td><td>${esc(r.sales_owner_name || '')}</td><td class="small muted dr-last">${r.comment_count ? `💬 ${r.comment_count} · ${esc(r.last_comment || '')}` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '';
  };
  const load = async () => { rows = (await api('GET', '/api/dev-roadmap?' + new URLSearchParams({ done: form.elements.done.checked ? '1' : '' }))).rows; if (main.isConnected) draw(); };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-dr-term]'); if (t) { termSel = t.dataset.drTerm; try { localStorage.setItem('wpa:dev-term', termSel); } catch { /* 편의 */ } draw(); return; }
    const z = e.target.closest('[data-dr-zoom]'); if (z) { zoom = z.dataset.drZoom; drPref({ zoom }); draw(); return; }
    const k = e.target.closest('[data-dr-kpi]'); if (k) { kpi = k.dataset.drKpi === 'all' || kpi === k.dataset.drKpi ? '' : k.dataset.drKpi; draw(); return; }
    const f = e.target.closest('[data-dr-fold]'); if (f) { const key = f.dataset.drFold; folded.has(key) ? folded.delete(key) : folded.add(key); drPref({ folded: [...folded] }); draw(); return; }
    const pn = e.target.closest('[data-dr-pan]'); if (pn) { const sc = $('.dr-scroll', main); if (sc) sc.scrollBy({ left: Number(pn.dataset.drPan) * Math.max(200, sc.clientWidth * 0.6), behavior: 'smooth' }); return; }
    if (e.target.closest('[data-dr-today]')) { const sc = $('.dr-scroll', main), ti = $('.dr-head .dr-today', main); if (sc && ti) sc.scrollTo({ left: Math.max(0, ti.offsetLeft - sc.clientWidth * 0.25), behavior: 'smooth' }); return; }
    const ed = e.target.closest('[data-dr-edit]'); if (ed) { const r = rows.find(x => x.id === Number(ed.dataset.drEdit)); if (r) devPlanEditor(r, load).catch(fail); return; }
    const row = e.target.closest('[data-dr]'); if (row && !$('.modal-wrap')) devCaseWindow(Number(row.dataset.dr), load).catch(fail);
  });
  main.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('.dr-row')) e.target.click(); });
  // 15.292 로드맵 끌어서 좌우 이동(마우스·펜): 4px 넘게 끌면 이동만 하고 그 클릭은 줄 열기로 쓰지 않음. 손가락은 원래 밀기 그대로.
  main.addEventListener('pointerdown', e => {
    const sc = e.target.closest('.dr-scroll'); if (!sc || e.button !== 0 || e.pointerType === 'touch' || e.target.closest('button, input, select, a, textarea')) return;
    const x0 = e.clientX, left0 = sc.scrollLeft; let moved = false;
    const mv = ev => { const dx = ev.clientX - x0; if (!moved && Math.abs(dx) < 4) return; if (!moved) { moved = true; sc.classList.add('dragging'); } sc.scrollLeft = left0 - dx; ev.preventDefault(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); sc.classList.remove('dragging');
      if (moved) { const stop = ev => { ev.stopPropagation(); ev.preventDefault(); }; main.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => main.removeEventListener('click', stop, { capture: true }), 0); } };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  $('#drTableBox', main).addEventListener('toggle', e => drPref({ table: e.currentTarget.open }));
  form.onsubmit = e => { e.preventDefault(); load().catch(fail); }; form.elements.done.onchange = () => load().catch(fail);
  form.elements.mine.onchange = () => draw(); form.elements.q.oninput = () => draw(); form.elements.sort.onchange = () => { sort = form.elements.sort.value; drPref({ sort }); draw(); };
  let rz = 0; const onResize = () => { if (!main.isConnected) { removeEventListener('resize', onResize); return; } clearTimeout(rz); rz = setTimeout(() => { if (rows.length) draw(); }, 200); }; addEventListener('resize', onResize);
  await load();
}

// 15.295 연구소 검사규격 항목설정: 분석 종류별 측정 항목 세트(이름·단위·하한·상한·측정 횟수)를 만들어 두면
// 분석데이터 입력의 「연구소 검사규격」에서 골라 한 번에 불러온다. 연구원(개발·개발책임자)만 만들고 고친다.
const rsRange = it => it.min != null && it.min !== '' && it.max != null && it.max !== '' ? `${it.min} ~ ${it.max}` : it.min != null && it.min !== '' ? `≥ ${it.min}` : it.max != null && it.max !== '' ? `≤ ${it.max}` : '—';
async function pageRndSpecs(main) {
  main.innerHTML = `<h1>검사규격 항목설정 <span class="dept">연구소</span></h1>
  <p class="muted">분석 종류(예: 와이퍼 흡수 시험, 글러브 물성)마다 측정 항목·단위·하한·상한·측정 횟수를 미리 정해 두면, <a href="#/dev/analysis/request">분석데이터 입력</a>에서 「연구소 검사규격」으로 골라 한 번에 불러옵니다. 불러온 뒤에도 그 분석에서만 항목을 더하거나 고칠 수 있습니다.</p>
  <form class="toolbar" data-read-only id="rsFilters"><label class="list-search">찾기<input type="search" name="q" placeholder="규격 이름·분류·측정 항목"></label><label class="inline"><input type="checkbox" name="off"> 사용 중지 포함</label><span class="grow"></span><span id="rsNew"></span></form>
  <div id="rsSummary" class="counts"></div><div id="rsList"></div>`;
  let lib = { revision: 0, specs: [], can_manage: false };
  const form = $('#rsFilters', main);
  const load = async () => { lib = await api('GET', '/api/rnd-specs'); if (main.isConnected) draw(); };
  const draw = () => {
    $('#rsNew', main).innerHTML = lib.can_manage ? '<button type="button" class="btn primary" data-rs-new>＋ 새 검사규격</button>' : '<span class="small muted">연구원(개발·개발책임자)만 만들고 고칩니다.</span>';
    const q = form.elements.q.value.trim().toLowerCase(), off = form.elements.off.checked;
    const rows = lib.specs.filter(s => (off || s.active !== false) && (!q || [s.name, s.group, s.note, ...s.items.map(i => i.name)].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.active !== false) - (a.active !== false) || (a.group || '').localeCompare(b.group || '', 'ko') || a.name.localeCompare(b.name, 'ko'));
    $('#rsSummary', main).textContent = `검사규격 ${rows.length}개${lib.specs.length !== rows.length ? ` (전체 ${lib.specs.length})` : ''}`;
    $('#rsList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid rs-table"><thead><tr><th>분류</th><th>규격 이름</th><th>측정 항목 (단위 · 규격 · 횟수)</th><th>비고</th><th>사용</th><th>수정</th><th></th></tr></thead><tbody>${rows.map(s => `<tr data-rs-row="${s.id}"${s.active === false ? ' class="row-off"' : ''}>
      <td>${esc(s.group || '—')}</td><td data-card-primary><b>${esc(s.name)}</b> <span class="small muted">${s.items.length}항목</span></td>
      <td class="rs-items">${s.items.map(i => `<div><b>${esc(i.name)}</b>${i.unit ? ` <span class="muted">(${esc(i.unit)})</span>` : ''} <span class="rs-rng">${esc(rsRange(i))}</span>${i.count > 1 ? ` <span class="small muted">· ${i.count}회</span>` : ''}</div>`).join('')}</td>
      <td class="small">${esc(s.note || '')}</td><td>${s.active === false ? '<span class="chip">사용 중지</span>' : '<span class="chip green">사용</span>'}</td>
      <td class="small muted nowrap">${esc(s.updated_by || '')}<br>${esc(String(s.updated_at || '').slice(0, 16))}</td>
      <td class="nowrap">${lib.can_manage ? `<button type="button" class="btn small" data-rs-edit="${s.id}">수정</button> <button type="button" class="btn small" data-rs-copy="${s.id}">복사</button> <button type="button" class="btn small" data-rs-del="${s.id}">삭제</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${lib.specs.length ? '조건에 맞는 검사규격이 없습니다.' : '아직 연구소 검사규격이 없습니다. 「＋ 새 검사규격」으로 만들어 두면 분석데이터 입력에서 불러올 수 있습니다.'}</div>`;
  };
  const editor = async (spec, copy = false) => {
    const lib2 = await api('GET', '/api/inspection-items').then(x => x.items || []).catch(() => []);
    const st = { items: (spec?.items || [{ name: '', unit: '', min: null, max: null, count: 1 }]).map(i => ({ ...i })) };
    const groups = [...new Set(lib.specs.map(s => s.group).filter(Boolean))];
    const m = modal(`<h3>${spec && !copy ? '검사규격 수정' : '새 검사규격'}</h3><form class="stack" data-rs-form>
      <div class="form-grid"><label>분류 <span class="opt">(선택)</span><input name="group" maxlength="50" list="rsGroups" value="${esc(spec?.group || '')}" placeholder="예) 천와이퍼"><datalist id="rsGroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></label>
        <label>규격 이름 *<input name="name" required maxlength="100" value="${esc(copy ? `${spec.name} (복사)` : spec?.name || '')}" placeholder="예) 흡수 시험"></label>
        <label class="span2">비고 <span class="opt">(선택)</span><input name="note" maxlength="300" value="${esc(spec?.note || '')}"></label>
        <label class="inline"><input type="checkbox" name="active" ${spec?.active === false ? '' : 'checked'}> 사용 (분석데이터 입력에서 고를 수 있음)</label></div>
      <div class="rm-tools"><label>항목 보관함에서 넣기<select data-rs-lib><option value="">— 항목 넣기 —</option>${lib2.map((it, i) => `<option value="${i}">${esc(it.group)} · ${esc(it.name)}${it.unit ? ` (${esc(it.unit)})` : ''}</option>`).join('')}</select></label><button type="button" class="btn small" data-rs-add>＋ 항목</button></div>
      <div class="table-wrap"><table class="grid keep-table rm-spec" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>측정 항목 *</th><th>단위</th><th class="r">하한</th><th class="r">상한</th><th class="r">측정 횟수</th><th></th></tr></thead><tbody data-rs-items></tbody></table></div>
      <div class="actions"><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
    const f = $('[data-rs-form]', m.el), body = $('[data-rs-items]', f);
    const drawItems = () => { body.innerHTML = st.items.map((it, i) => `<tr data-rs-i="${i}"><td><input data-k="name" maxlength="100" value="${esc(it.name || '')}" aria-label="측정 항목"></td><td><input data-k="unit" maxlength="30" class="rm-unit" value="${esc(it.unit || '')}" aria-label="단위"></td>
      <td><input data-k="min" type="number" step="any" class="rm-num" value="${it.min ?? ''}" aria-label="하한"></td><td><input data-k="max" type="number" step="any" class="rm-num" value="${it.max ?? ''}" aria-label="상한"></td>
      <td><input data-k="count" type="number" min="1" max="10" step="1" class="rm-num" value="${it.count || 1}" aria-label="측정 횟수"></td>
      <td class="nowrap"><button type="button" class="btn small" data-rs-up="${i}" title="위로" ${i ? '' : 'disabled'}>↑</button> <button type="button" class="btn small" data-rs-x="${i}" title="빼기">×</button></td></tr>`).join(''); };
    drawItems();
    body.addEventListener('input', e => { const tr = e.target.closest('[data-rs-i]'); if (tr && e.target.dataset.k) st.items[Number(tr.dataset.rsI)][e.target.dataset.k] = e.target.value; });
    body.addEventListener('paste', e => { // 15.296 엑셀에서 항목 표(이름·단위·하한·상한·횟수)를 복사해 붙이기
      const tr = e.target.closest('[data-rs-i]'); if (!tr || !e.target.dataset.k) return; const rows = xlGrid(e); if (!rows) return; e.preventDefault();
      const KEYS = ['name', 'unit', 'min', 'max', 'count'], c0 = KEYS.indexOf(e.target.dataset.k), i0 = Number(tr.dataset.rsI); let put = 0, skip = 0;
      rows.forEach((vals, i) => { const ii = i0 + i; if (ii >= 30) { skip += vals.length; return; } while (ii >= st.items.length) st.items.push({ name: '', unit: '', min: null, max: null, count: 1 });
        vals.forEach((raw, j) => { const key = KEYS[c0 + j]; if (!key) { if (raw !== '') skip++; return; } if (key === 'name' || key === 'unit') { st.items[ii][key] = raw; put++; return; }
          const n = xlNum(raw); if (n === null) { skip++; return; } st.items[ii][key] = key === 'count' ? Math.max(1, Math.min(10, Math.round(Number(n) || 1))) : n === '' ? null : n; put++; }); });
      drawItems(); toast(`엑셀에서 ${put}칸을 붙여 넣었습니다.${skip ? ` (${skip}칸은 뺐습니다)` : ''}`, skip ? 'err' : undefined);
    });
    f.addEventListener('click', e => {
      if (e.target.closest('[data-rs-add]')) { st.items.push({ name: '', unit: '', min: null, max: null, count: 1 }); drawItems(); body.lastElementChild.querySelector('input').focus(); return; }
      const x = e.target.closest('[data-rs-x]'); if (x) { st.items.splice(Number(x.dataset.rsX), 1); if (!st.items.length) st.items.push({ name: '', unit: '', min: null, max: null, count: 1 }); drawItems(); return; }
      const u = e.target.closest('[data-rs-up]'); if (u) { const i = Number(u.dataset.rsUp); [st.items[i - 1], st.items[i]] = [st.items[i], st.items[i - 1]]; drawItems(); }
    });
    $('[data-rs-lib]', f).onchange = e => { const it = lib2[Number(e.target.value)]; e.target.value = ''; if (!it) return; st.items = st.items.filter(i => String(i.name || '').trim()); st.items.push({ name: it.name, unit: it.unit || '', min: it.min ?? null, max: it.max ?? null, count: it.count || 1 }); drawItems(); };
    $('[data-no]', f).onclick = () => m.close();
    f.onsubmit = async e => {
      e.preventDefault(); const v = formObj(f), btn = $('button.primary', f);
      const items = st.items.filter(i => String(i.name || '').trim()).map(i => ({ name: String(i.name).trim(), unit: String(i.unit || '').trim(), min: i.min, max: i.max, count: Number(i.count) || 1 }));
      btn.disabled = true;
      try { lib = await api('PUT', '/api/rnd-specs', { revision: lib.revision, spec: { id: spec && !copy ? spec.id : undefined, name: v.name, group: v.group, note: v.note, active: f.elements.active.checked, items } }); toast('검사규격을 저장했습니다.'); m.close(); draw(); }
      catch (error) { fail(error); if (error.status === 409) load().catch(() => {}); } finally { btn.disabled = false; }
    };
  };
  main.addEventListener('click', async e => {
    if (e.target.closest('[data-rs-new]')) return editor(null).catch(fail);
    const ed = e.target.closest('[data-rs-edit]'), cp = e.target.closest('[data-rs-copy]'), dl = e.target.closest('[data-rs-del]');
    const s = lib.specs.find(x => x.id === Number((ed || cp || dl)?.dataset.rsEdit || (ed || cp || dl)?.dataset.rsCopy || (ed || cp || dl)?.dataset.rsDel)); if (!s) return;
    if (ed) return editor(s).catch(fail);
    if (cp) return editor(s, true).catch(fail);
    if (dl && await confirmBox(`「${s.name}」 검사규격을 삭제할까요? 이미 입력한 분석데이터의 측정값은 그대로 남습니다. 잠시 쓰지 않을 거면 「수정」에서 사용을 끄세요.`)) {
      try { lib = await api('DELETE', `/api/rnd-specs/${s.id}?revision=${lib.revision}`); toast('삭제했습니다.'); draw(); } catch (error) { fail(error); if (error.status === 409) load().catch(() => {}); }
    }
  });
  main.addEventListener('dblclick', e => { const tr = e.target.closest('[data-rs-row]'); if (tr && lib.can_manage && !e.target.closest('button')) { const s = lib.specs.find(x => x.id === Number(tr.dataset.rsRow)); if (s) editor(s).catch(fail); } });
  form.addEventListener('input', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// 15.302 연구소 › 지식재산권 관리: 보유 권리(특허·실용신안·디자인·상표·저작권 등)와 갱신 기한(연차료 납부·존속기간 갱신) 관리
const IP_KIND_INFO = { // 국내 기준 참고값(정확한 기한은 특허청·대리인 확인). term: 존속기간, from: 기산일, due: 갱신 방식
  '특허': { term: 20, from: 'app', due: 'annual', hint: '출원일부터 20년 · 등록 뒤 매년 연차료' },
  '실용신안': { term: 10, from: 'app', due: 'annual', hint: '출원일부터 10년 · 등록 뒤 매년 연차료' },
  '디자인': { term: 20, from: 'app', due: 'annual', hint: '출원일부터 20년 · 등록 뒤 매년 연차료' },
  '상표': { term: 10, from: 'reg', due: 'renew', hint: '등록일부터 10년 · 10년마다 존속기간 갱신(만료 1년 전부터 신청)' },
  '저작권': { term: 0, hint: '등록 없이 생기며 보통 저작자 사후 70년(업무상 저작물은 공표 후 70년) · 갱신 없음' },
  '반도체 배치설계': { term: 10, from: 'reg', due: 'none', hint: '설정등록일부터 10년' },
  '영업비밀': { term: 0, hint: '등록 제도 없음 · 비밀 관리 현황 점검용' },
  '기타': { term: 0, hint: '' },
};
const IP_STATUS_CHIP = { prep: '', filed: 'yellow', exam: 'yellow', registered: 'green', rejected: 'red', abandoned: '', expired: '' };
const ipAddYears = (d, n) => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y + n, m - 1, dd)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
const ipDday = (d, today) => d ? Math.round((Date.parse(d) - Date.parse(today)) / 86400000) : null;
// 다음 기한 제안: 연차료는 등록일 기준 해마다 같은 날(오늘 이후 첫 날), 상표·배치설계는 만료일
function ipSuggest(kind, appDate, regDate, today) {
  const k = IP_KIND_INFO[kind] || {}; const base = k.from === 'app' ? appDate : regDate;
  const expire = k.term && base ? ipAddYears(base, k.term) : '';
  let next = '', dueKind = '';
  if (k.due === 'annual' && regDate) { let n = 1; let d = ipAddYears(regDate, n); while (d && d < today && n < 30) d = ipAddYears(regDate, ++n); next = expire && d > expire ? '' : d; dueKind = '연차료 납부'; }
  else if (k.due === 'renew' && expire) { next = expire; dueKind = '존속기간 갱신'; }
  else if (k.due === 'none' && expire) { next = ''; dueKind = ''; }
  return { expire, next, dueKind };
}
async function pageIpRights(main) {
  main.innerHTML = `<h1>지식재산권 관리 <span class="dept">연구소</span></h1>
  <p class="muted">회사가 가진 특허·실용신안·디자인·상표 등을 한곳에 모아 <b>언제까지 유효한지, 다음에 무엇을 언제 해야 하는지</b>(연차료 납부·존속기간 갱신) 관리합니다. 기한이 지나면 빨강, 90일 안이면 노랑으로 보입니다. 기간 자동 계산은 국내 기준 참고값이니 정확한 날짜는 특허청·대리인 안내로 확인해 고치세요.</p>
  <div class="ip-tiles" id="ipTiles"></div>
  <form class="toolbar list-filters" data-read-only id="ipFilters">
    <label class="lf-sel">구분<select name="kind"><option value="">전체</option>${Object.keys(IP_KIND_INFO).map(k => `<option>${k}</option>`).join('')}</select></label>
    <label class="lf-sel">상태<select name="status"><option value="">전체</option><option value="live">살아 있는 권리(소멸·거절·포기 빼고)</option>${Object.entries({ prep: '출원 준비', filed: '출원중', exam: '심사중', registered: '등록완료', rejected: '거절(불허)', abandoned: '포기·취하', expired: '소멸(만료)' }).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="lf-sel">기한<select name="due"><option value="">전체</option><option value="soon">90일 안 · 지남</option><option value="over">기한 지남</option></select></label>
    <label class="list-search">찾기<input type="search" name="q" placeholder="등록·출원번호·명칭·권리자·제품·담당자"></label>
    <span class="grow"></span><span id="ipTools"></span>
  </form>
  <div id="ipList"></div>`;
  const form = $('#ipFilters', main); let data = { rows: [], can_manage: false, today: todayStr() };
  const load = async () => { data = await api('GET', '/api/ip-rights'); if (main.isConnected) draw(); };
  const dueCls = r => { const d = ipDday(r.next_due, data.today); return d === null || !['registered', 'filed', 'exam'].includes(r.status) ? '' : d < 0 ? 'over' : d <= 90 ? 'soon' : ''; };
  const live = r => !['rejected', 'abandoned', 'expired'].includes(r.status);
  const filtered = () => { const v = formObj(form), q = (v.q || '').trim().toLowerCase();
    return data.rows.filter(r => (!v.kind || r.kind === v.kind) && (!v.status || (v.status === 'live' ? live(r) : r.status === v.status)) && (!v.due || (v.due === 'over' ? dueCls(r) === 'over' : !!dueCls(r)))
      && (!q || [r.reg_no, r.app_no, r.title, r.holder, r.product, r.owner_name, r.agent, r.note].join(' ').toLowerCase().includes(q))); };
  const draw = () => {
    const rows = data.rows, over = rows.filter(r => dueCls(r) === 'over').length, soon = rows.filter(r => dueCls(r) === 'soon').length;
    $('#ipTiles', main).innerHTML = [['전체', rows.length, ''], ['등록완료', rows.filter(r => r.status === 'registered').length, 'green'], ['출원·심사중', rows.filter(r => ['prep', 'filed', 'exam'].includes(r.status)).length, ''], ['90일 안 기한', soon, soon ? 'yellow' : ''], ['기한 지남', over, over ? 'red' : '']]
      .map(([l, n, c], i) => `<button type="button" class="ip-tile ${c}" data-ip-tile="${i}"><span>${l}</span><b>${n}</b></button>`).join('');
    $('#ipTools', main).innerHTML = `<button type="button" class="btn" id="ipXlsx">엑셀</button>${data.can_manage ? ' <button type="button" class="btn primary" id="ipNew">＋ 지식재산권 등록</button>' : ''}`;
    const list = filtered();
    $('#ipList', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>구분</th><th>등록번호 · 출원번호</th><th>지식재산권명</th><th>권리자</th><th>출원일</th><th>등록일</th><th>유효기간</th><th>다음 기한</th><th>상태</th><th>담당자</th><th></th></tr></thead><tbody>${list.map(r => { const d = ipDday(r.next_due, data.today), cls = dueCls(r);
      return `<tr data-ip-row="${r.id}" class="${cls ? 'ip-' + cls : ''}${live(r) ? '' : ' row-off'}"><td class="nowrap"><b>${esc(r.kind)}</b>${r.country && r.country !== 'KR' ? ` <span class="chip">${esc(r.country)}</span>` : ''}</td>
        <td class="nowrap">${r.reg_no ? `<b>${esc(r.reg_no)}</b>` : '<span class="muted">미등록</span>'}${r.app_no ? `<div class="small muted">출원 ${esc(r.app_no)}</div>` : ''}</td>
        <td data-card-primary><b>${esc(r.title)}</b>${r.product ? `<div class="small muted">${esc(r.product)}</div>` : ''}</td><td>${esc(r.holder)}</td>
        <td class="nowrap">${esc(r.app_date || '')}</td><td class="nowrap">${esc(r.reg_date || '')}</td><td class="nowrap">${r.expire_date ? `~ ${esc(r.expire_date)}` : '<span class="muted">—</span>'}</td>
        <td class="nowrap">${r.next_due ? `${esc(r.next_due)} <span class="ip-dd ${cls}">${d < 0 ? `D+${-d}` : d === 0 ? 'D-DAY' : `D-${d}`}</span>${r.due_kind ? `<div class="small muted">${esc(r.due_kind)}</div>` : ''}` : '<span class="muted">—</span>'}</td>
        <td><span class="chip ${IP_STATUS_CHIP[r.status] || ''}">${esc(r.status_label)}</span></td><td>${esc(r.owner_name)}</td>
        <td class="nowrap">${data.can_manage ? `<button type="button" class="btn small" data-ip-edit="${r.id}">수정</button>${r.status === 'registered' && r.next_due ? ` <button type="button" class="btn small primary" data-ip-renew="${r.id}">갱신 처리</button>` : ''}` : ''} <button type="button" class="btn small" data-ip-hist="${r.id}">이력</button></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${data.rows.length ? '조건에 맞는 지식재산권이 없습니다.' : '아직 등록한 지식재산권이 없습니다. 「＋ 지식재산권 등록」으로 특허·디자인·상표 등을 넣어 두면 갱신 기한을 함께 관리합니다.'}</div>`;
  };
  const editor = async (r = null) => {
    const v = r || { kind: '특허', country: 'KR', status: 'filed' }, statusOpts = Object.entries({ prep: '출원 준비', filed: '출원중', exam: '심사중', registered: '등록완료', rejected: '거절(불허)', abandoned: '포기·취하', expired: '소멸(만료)' });
    const m = modal(`<h3>${r ? '지식재산권 수정' : '지식재산권 등록'}</h3><form class="stack" data-ip-form>
      <fieldset class="vendor-sec"><legend>기본</legend><div class="form-grid">
        <label>구분 *<select name="kind" required>${Object.keys(IP_KIND_INFO).map(k => `<option${v.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
        <label>상태 *<select name="status" required>${statusOpts.map(([k, l]) => `<option value="${k}"${v.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>국가 <span class="hint">(KR·US·CN·JP·EP·PCT 등)</span><input name="country" maxlength="30" value="${esc(v.country || 'KR')}" list="ipCountry"><datalist id="ipCountry">${['KR', 'US', 'CN', 'JP', 'EP', 'PCT', 'VN'].map(c => `<option value="${c}">`).join('')}</datalist></label>
        <label class="span3">지식재산권명 *<input name="title" required maxlength="200" value="${esc(v.title || '')}" placeholder="예) 흡수성이 향상된 부직포 와이퍼 및 그 제조방법"></label>
        <label>등록번호<input name="reg_no" maxlength="60" value="${esc(v.reg_no || '')}" placeholder="예) 10-2345678"></label>
        <label>출원번호<input name="app_no" maxlength="60" value="${esc(v.app_no || '')}" placeholder="예) 10-2024-0012345"></label>
        <label>권리자<input name="holder" maxlength="100" value="${esc(v.holder || '')}" placeholder="예) 서울세미텍(주)"></label>
        <label>관련 제품<input name="product" maxlength="200" value="${esc(v.product || '')}"></label>
        <label>담당자<input name="owner_name" maxlength="50" value="${esc(v.owner_name || '')}"></label>
        <label>대리인(특허사무소)<input name="agent" maxlength="100" value="${esc(v.agent || '')}"></label>
      </div></fieldset>
      <fieldset class="vendor-sec"><legend>기간 · 갱신 <span class="hint" data-ip-hint></span></legend><div class="form-grid">
        <label>출원일<input type="date" name="app_date" value="${esc(v.app_date || '')}"></label>
        <label>등록일<input type="date" name="reg_date" value="${esc(v.reg_date || '')}"></label>
        <label>유효기간(만료일)<input type="date" name="expire_date" value="${esc(v.expire_date || '')}"></label>
        <label>다음 기한<input type="date" name="next_due" value="${esc(v.next_due || '')}"></label>
        <label>기한 내용<input name="due_kind" maxlength="30" value="${esc(v.due_kind || '')}" list="ipDueKind" placeholder="연차료 납부 · 존속기간 갱신"><datalist id="ipDueKind"><option value="연차료 납부"><option value="존속기간 갱신"><option value="심사청구"><option value="의견서 제출"><option value="해외 출원(우선권)"></datalist></label>
        <div class="ip-calc"><button type="button" class="btn small" data-ip-calc>기간 자동 계산</button></div>
      </div></fieldset>
      <label>메모<textarea name="note" rows="2" maxlength="1000">${esc(v.note || '')}</textarea></label>
      <div class="actions">${r ? '<button type="button" class="btn danger" data-ip-del>삭제</button>' : ''}<span class="grow"></span><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
    const f = $('[data-ip-form]', m.el), el = n => f.elements[n];
    const hint = () => { $('[data-ip-hint]', f).textContent = IP_KIND_INFO[el('kind').value]?.hint ? `(${IP_KIND_INFO[el('kind').value].hint} · 참고값)` : ''; };
    const calc = (force) => { const s = ipSuggest(el('kind').value, el('app_date').value, el('reg_date').value, data.today);
      if (s.expire && (force || !el('expire_date').value)) el('expire_date').value = s.expire; if (force || !el('next_due').value) el('next_due').value = s.next || el('next_due').value; if (s.dueKind && (force || !el('due_kind').value)) el('due_kind').value = s.dueKind; };
    hint(); el('kind').onchange = () => { hint(); calc(false); }; el('app_date').onchange = () => calc(false); el('reg_date').onchange = () => calc(false);
    $('[data-ip-calc]', f).onclick = () => { calc(true); toast('구분·출원일·등록일로 유효기간과 다음 기한을 채웠습니다(참고값).'); };
    $('[data-no]', f).onclick = () => m.close();
    $('[data-ip-del]', f)?.addEventListener('click', async () => { if (!await confirmBox(`「${r.title}」을(를) 목록에서 지울까요? 권리를 잃은 경우에는 지우지 말고 상태를 「소멸(만료)」·「포기·취하」로 바꾸면 이력이 남습니다.`)) return; try { await api('DELETE', `/api/ip-rights/${r.id}?revision=${r.revision}`); toast('지웠습니다.'); m.close(); await load(); } catch (e) { fail(e); } });
    f.onsubmit = async e => { e.preventDefault(); const body = formObj(f), btn = $('button.primary', f); btn.disabled = true;
      try { if (r) await api('PUT', `/api/ip-rights/${r.id}`, { ...body, revision: r.revision }); else await api('POST', '/api/ip-rights', { ...body, request_id: crypto.randomUUID() }); toast('저장했습니다.'); m.close(); await load(); }
      catch (error) { fail(error); if (error.status === 409) load().catch(() => {}); } finally { btn.disabled = false; } };
  };
  const renew = async r => {
    const k = IP_KIND_INFO[r.kind] || {}, nextSug = k.due === 'renew' ? ipAddYears(r.next_due, 10) : ipAddYears(r.next_due, 1), expSug = k.due === 'renew' ? ipAddYears(r.expire_date || r.next_due, 10) : r.expire_date || '';
    const next = expSug && nextSug > expSug ? '' : nextSug;
    const v = await promptBox(`갱신 처리 · ${r.title}`, `<p>${esc(r.kind)} ${esc(r.reg_no || '')} · 지금 기한 <b>${esc(r.next_due)}</b> ${esc(r.due_kind || '')}</p><p class="small muted">${k.due === 'renew' ? '상표 존속기간 갱신: 만료일과 다음 기한을 10년 뒤로 넘깁니다.' : '연차료 납부: 다음 기한을 1년 뒤로 넘깁니다(만료일을 넘으면 비움).'} 날짜는 고칠 수 있습니다.</p>
      <div class="form-grid"><label>처리일 *<input type="date" name="done_date" required value="${todayStr()}"></label><label>다음 기한<input type="date" name="next_due" value="${esc(next)}"></label><label>유효기간(만료일)<input type="date" name="expire_date" value="${esc(expSug)}"></label>
      <label class="span3">메모<input name="note" maxlength="300" placeholder="예) 4년차 연차료 납부 · 영수증 번호"></label></div>`, { wide: true });
    if (!v) return; try { await api('POST', `/api/ip-rights/${r.id}/renew`, { ...v, revision: r.revision, due_kind: r.due_kind }); toast('갱신 처리했습니다.'); await load(); } catch (e) { fail(e); }
  };
  const history = r => modal(`<h3>이력 · ${esc(r.title)}</h3>${(r.history || []).length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>일시</th><th>담당</th><th>내용</th></tr></thead><tbody>${[...r.history].reverse().map(h => `<tr><td class="nowrap">${esc(String(h.at || '').slice(0, 16))}</td><td>${esc(h.by || '')}</td><td>${h.what === '갱신' ? `<b>갱신</b> ${esc(h.kind || '')} · 처리 ${esc(h.done || '')} · 기한 ${esc(h.due || '—')} → ${esc(h.next || '없음')}${h.expire ? ` · 만료 ${esc(h.expire[0] || '—')} → ${esc(h.expire[1] || '—')}` : ''}${h.note ? ` · ${esc(h.note)}` : ''}` : h.what === '수정' ? `수정 (${(h.fields || []).length}칸)${h.status ? ` · 상태 ${esc(IP_STATUS_LABEL[h.status[0]] || h.status[0])} → ${esc(IP_STATUS_LABEL[h.status[1]] || h.status[1])}` : ''}` : esc(h.what || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">이력이 없습니다.</p>'}`, { wide: true });
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-ip-tile]'); if (t) { const i = Number(t.dataset.ipTile); form.elements.status.value = i === 1 ? 'registered' : ''; form.elements.due.value = i === 3 ? 'soon' : i === 4 ? 'over' : ''; if (i === 2) form.elements.status.value = 'filed'; draw(); return; }
    if (e.target.closest('#ipNew')) return editor().catch?.(fail);
    if (e.target.closest('#ipXlsx')) { const list = filtered(); if (!list.length) return toast('내보낼 줄이 없습니다.', 'err');
      return xlsxDownload(`지식재산권_${data.today}.xlsx`, { sheet: '지식재산권', titles: ['지식재산권 관리', data.today], columns: ['구분', '국가', '등록번호', '출원번호', '지식재산권명', '권리자', '관련 제품', '출원일', '등록일', '유효기간', '다음 기한', '기한 내용', '상태', '담당자', '대리인', '메모'].map(label => ({ label, type: 'text' })),
        rows: list.map(r => [r.kind, r.country, r.reg_no, r.app_no, r.title, r.holder, r.product, r.app_date || '', r.reg_date || '', r.expire_date || '', r.next_due || '', r.due_kind, r.status_label, r.owner_name, r.agent, r.note]) }); }
    const find = a => data.rows.find(x => x.id === Number(e.target.closest(`[${a}]`)?.getAttribute(a)));
    if (e.target.closest('[data-ip-edit]')) return editor(find('data-ip-edit'));
    if (e.target.closest('[data-ip-renew]')) return renew(find('data-ip-renew')).catch(fail);
    if (e.target.closest('[data-ip-hist]')) return history(find('data-ip-hist'));
  });
  main.addEventListener('dblclick', e => { const tr = e.target.closest('[data-ip-row]'); if (tr && data.can_manage && !e.target.closest('button')) editor(data.rows.find(x => x.id === Number(tr.dataset.ipRow))); });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}
const IP_STATUS_LABEL = { prep: '출원 준비', filed: '출원중', exam: '심사중', registered: '등록완료', rejected: '거절(불허)', abandoned: '포기·취하', expired: '소멸(만료)' };

// 15.303 품질 › 인증서 관리: ISO 9001·14001·45001·IATF 16949·GRS·RCS·OEKO-TEX·FSC·KC 등의 유효기간과 다음 심사(사후·갱신) 일정 관리
const CERT_INFO = { // 일반적인 주기(참고값 — 인증기관 계약·심사 일정에 따라 고쳐 쓰세요). cycle: 인증서 유효 연수, annual: 그 사이 매년 사후심사
  'ISO 9001': { cycle: 3, annual: true, area: '품질경영', hint: '인증서 3년 · 1·2년차 사후심사 · 만료 전 갱신심사' },
  'ISO 14001': { cycle: 3, annual: true, area: '환경경영', hint: '인증서 3년 · 1·2년차 사후심사 · 만료 전 갱신심사' },
  'ISO 45001': { cycle: 3, annual: true, area: '안전보건경영', hint: '인증서 3년 · 1·2년차 사후심사 · 만료 전 갱신심사' },
  'IATF 16949': { cycle: 3, annual: true, area: '자동차 품질경영', hint: '인증서 3년 · 매년 사후심사 · 만료 전 갱신심사' },
  'GRS': { cycle: 1, annual: false, area: '재활용 원료(Global Recycled Standard)', hint: '인증서 1년 · 해마다 갱신심사(만료 전)' },
  'RCS': { cycle: 1, annual: false, area: '재활용 원료 함량(Recycled Claim Standard)', hint: '인증서 1년 · 해마다 갱신심사' },
  'OEKO-TEX STANDARD 100': { cycle: 1, annual: false, area: '섬유 유해물질', hint: '인증서 1년 · 해마다 갱신' },
  'FSC': { cycle: 5, annual: true, area: '산림 인증(CoC)', hint: '인증서 5년 · 매년 사후심사' },
  'KC': { cycle: 0, annual: false, area: '국내 안전인증', hint: '품목·제도마다 유효기간이 다름 — 직접 넣으세요' },
  'ISO 14644(클린룸)': { cycle: 1, annual: false, area: '클린룸 청정도 등급', hint: '보통 1년마다 재측정·성적서 갱신' },
  '기타': { cycle: 0, annual: false, area: '', hint: '' },
};
const CERT_STATUS_LABEL = { prep: '준비·신청', valid: '유효', suspended: '정지', expired: '만료', withdrawn: '취소·반납' };
const CERT_STATUS_CHIP = { prep: 'yellow', valid: 'green', suspended: 'red', expired: '', withdrawn: '' };
// 다음 심사 제안: 매년 사후심사가 있으면 발행일 기준 오늘 뒤 첫 해(만료 해에는 만료 3개월 전 갱신심사), 없으면 만료 2개월 전 갱신심사
function certSuggest(kind, issue, today) {
  const k = CERT_INFO[kind] || {}; if (!k.cycle || !issue) return { expire: '', next: '', nextKind: '' };
  const expire = new Date(Date.parse(ipAddYears(issue, k.cycle)) - 86400000).toISOString().slice(0, 10), minus = (d, mo) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 - mo, dd)); return t.toISOString().slice(0, 10); };
  const renew = minus(expire, k.annual ? 3 : 2);
  if (k.annual) { for (let n = 1; n < k.cycle; n++) { const d = ipAddYears(issue, n); if (d >= today && d < renew) return { expire, next: d, nextKind: `${n}차 사후심사` }; } }
  return { expire, next: renew, nextKind: '갱신심사' };
}
async function pageCerts(main) {
  main.innerHTML = `<h1>인증서 관리 <span class="dept">품질</span></h1>
  <p class="muted">회사가 받은 인증(ISO 9001·14001·45001, GRS 등)의 <b>유효기간</b>과 <b>다음 심사</b>(사후심사·갱신심사) 일정을 관리합니다. 다음 심사일이나 만료일이 지나면 빨강, 90일 안이면 노랑. 기간 자동 계산은 일반적인 주기(참고값)이니 인증기관 일정에 맞춰 고치세요.</p>
  <div class="ip-tiles" id="ctTiles"></div>
  <form class="toolbar list-filters" data-read-only id="ctFilters">
    <label class="lf-sel">인증 종류<select name="kind"><option value="">전체</option>${Object.keys(CERT_INFO).map(k => `<option>${esc(k)}</option>`).join('')}</select></label>
    <label class="lf-sel">상태<select name="status"><option value="">전체</option><option value="live">유효·정지·준비(만료·반납 빼고)</option>${Object.entries(CERT_STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label class="lf-sel">기한<select name="due"><option value="">전체</option><option value="soon">90일 안 · 지남</option><option value="over">기한 지남</option></select></label>
    <label class="list-search">찾기<input type="search" name="q" placeholder="인증번호·범위·인증기관·사업장·담당자"></label>
    <span class="grow"></span><span id="ctTools" class="ip-tools"></span>
  </form>
  <div id="ctList"></div>`;
  const form = $('#ctFilters', main); let data = { rows: [], can_manage: false, today: todayStr() };
  const load = async () => { data = await api('GET', '/api/certs'); if (main.isConnected) draw(); };
  const live = r => ['valid', 'suspended', 'prep'].includes(r.status);
  const firstDue = r => [r.next_audit, r.expire_date].filter(Boolean).sort()[0] || null; // 심사·만료 중 먼저 오는 것
  const dueCls = r => { const d = ipDday(firstDue(r), data.today); return d === null || !live(r) ? '' : d < 0 ? 'over' : d <= 90 ? 'soon' : ''; };
  const filtered = () => { const v = formObj(form), q = (v.q || '').trim().toLowerCase();
    return data.rows.filter(r => (!v.kind || r.kind === v.kind) && (!v.status || (v.status === 'live' ? live(r) : r.status === v.status)) && (!v.due || (v.due === 'over' ? dueCls(r) === 'over' : !!dueCls(r)))
      && (!q || [r.cert_no, r.title, r.scope, r.body, r.site, r.owner_name, r.note].join(' ').toLowerCase().includes(q))); };
  const dd = (d, cls, on = true) => { const n = ipDday(d, data.today); return n === null || !on ? '' : ` <span class="ip-dd ${cls}">${n < 0 ? `D+${-n}` : n === 0 ? 'D-DAY' : `D-${n}`}</span>`; };
  const draw = () => {
    const rows = data.rows, over = rows.filter(r => dueCls(r) === 'over').length, soon = rows.filter(r => dueCls(r) === 'soon').length;
    $('#ctTiles', main).innerHTML = [['전체', rows.length, ''], ['유효', rows.filter(r => r.status === 'valid').length, 'green'], ['준비·신청', rows.filter(r => r.status === 'prep').length, ''], ['90일 안 심사·만료', soon, soon ? 'yellow' : ''], ['기한 지남', over, over ? 'red' : '']]
      .map(([l, n, c], i) => `<button type="button" class="ip-tile ${c}" data-ct-tile="${i}"><span>${l}</span><b>${n}</b></button>`).join('');
    $('#ctTools', main).innerHTML = `<button type="button" class="btn" id="ctXlsx">엑셀</button>${data.can_manage ? '<button type="button" class="btn primary" id="ctNew">＋ 인증서 등록</button>' : ''}`;
    const list = filtered();
    $('#ctList', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid ip-table ct-table"><thead><tr><th>인증 종류</th><th>인증번호</th><th>인증 범위 · 인증명</th><th>인증기관</th><th>사업장</th><th>발행일</th><th>유효기간</th><th>다음 심사</th><th>상태</th><th>담당자</th><th></th></tr></thead><tbody>${list.map(r => { const cls = dueCls(r), eDays = ipDday(r.expire_date, data.today), nDays = ipDday(r.next_audit, data.today), ec = live(r) && eDays !== null ? (eDays < 0 ? 'over' : eDays <= 90 ? 'soon' : '') : '', nc = live(r) && nDays !== null ? (nDays < 0 ? 'over' : nDays <= 90 ? 'soon' : '') : '';
      return `<tr data-ct-row="${r.id}" class="${cls ? 'ip-' + cls : ''}${live(r) ? '' : ' row-off'}"><td class="nowrap"><b>${esc(r.kind)}</b><div class="small muted">${esc(CERT_INFO[r.kind]?.area || '')}</div></td>
        <td class="nowrap">${r.cert_no ? `<b>${esc(r.cert_no)}</b>` : '<span class="muted">—</span>'}</td>
        <td data-card-primary>${r.title ? `<b>${esc(r.title)}</b>` : ''}${r.scope ? `<div class="small ct-scope">${esc(r.scope)}</div>` : ''}</td><td>${esc(r.body)}</td><td>${esc(r.site)}</td>
        <td class="nowrap">${esc(r.issue_date || '')}${r.first_date && r.first_date !== r.issue_date ? `<div class="small muted">최초 ${esc(r.first_date)}</div>` : ''}</td>
        <td class="nowrap">${r.expire_date ? `~ ${esc(r.expire_date)}${dd(r.expire_date, ec, live(r))}` : '<span class="muted">—</span>'}</td>
        <td class="nowrap">${r.next_audit ? `${esc(r.next_audit)}${dd(r.next_audit, nc, live(r))}${r.audit_kind ? `<div class="small muted">${esc(r.audit_kind)}</div>` : ''}` : '<span class="muted">—</span>'}</td>
        <td><span class="chip ${CERT_STATUS_CHIP[r.status] || ''}">${esc(r.status_label)}</span></td><td>${esc(r.owner_name)}</td>
        <td class="nowrap">${data.can_manage ? `<button type="button" class="btn small" data-ct-edit="${r.id}">수정</button>${['valid', 'suspended'].includes(r.status) ? ` <button type="button" class="btn small primary" data-ct-audit="${r.id}">심사 완료</button>` : ''}` : ''} <button type="button" class="btn small" data-ct-hist="${r.id}">이력</button></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${data.rows.length ? '조건에 맞는 인증서가 없습니다.' : '아직 등록한 인증서가 없습니다. 「＋ 인증서 등록」으로 ISO 9001·14001, GRS 등을 넣어 두면 심사·갱신 일정을 함께 관리합니다.'}</div>`;
  };
  const editor = async (r = null) => {
    const v = r || { kind: 'ISO 9001', status: 'valid' };
    const m = modal(`<h3>${r ? '인증서 수정' : '인증서 등록'}</h3><form class="stack" data-ct-form>
      <fieldset class="vendor-sec"><legend>기본</legend><div class="form-grid">
        <label>인증 종류 *<select name="kind" required>${Object.keys(CERT_INFO).map(k => `<option${v.kind === k ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
        <label>상태 *<select name="status" required>${Object.entries(CERT_STATUS_LABEL).map(([k, l]) => `<option value="${k}"${v.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>인증번호<input name="cert_no" maxlength="80" value="${esc(v.cert_no || '')}" placeholder="예) FS 123456 · CU1234567GRS-2026"></label>
        <label class="span2">인증명 <span class="hint">(기타는 꼭)</span><input name="title" maxlength="200" value="${esc(v.title || '')}" placeholder="비우면 인증 종류로 표시"></label>
        <label>인증기관<input name="body" maxlength="100" list="ctBodies" value="${esc(v.body || '')}" placeholder="예) BSI · DNV · SGS · KFQ · Control Union"><datalist id="ctBodies">${['BSI', 'DNV', 'SGS', 'KFQ(한국품질재단)', 'KSA(한국표준협회)', 'KTR', 'Intertek', 'TÜV', 'Control Union', 'OEKO-TEX(Hohenstein)'].map(x => `<option value="${x}">`).join('')}</datalist></label>
        <label class="span2">인증 범위<input name="scope" maxlength="500" value="${esc(v.scope || '')}" placeholder="예) 클린룸용 와이퍼·장갑의 제조 및 판매"></label>
        <label>대상 사업장<input name="site" maxlength="100" value="${esc(v.site || '')}" placeholder="예) 본사·안성 공장"></label>
        <label>담당자<input name="owner_name" maxlength="50" value="${esc(v.owner_name || '')}"></label>
      </div></fieldset>
      <fieldset class="vendor-sec"><legend>유효기간 · 심사 <span class="hint" data-ct-hint></span></legend><div class="form-grid">
        <label>최초 인증일<input type="date" name="first_date" value="${esc(v.first_date || '')}"></label>
        <label>발행일(현 인증서)<input type="date" name="issue_date" value="${esc(v.issue_date || '')}"></label>
        <label>유효기간(만료일)<input type="date" name="expire_date" value="${esc(v.expire_date || '')}"></label>
        <label>다음 심사일<input type="date" name="next_audit" value="${esc(v.next_audit || '')}"></label>
        <label>심사 종류<input name="audit_kind" maxlength="30" list="ctAudit" value="${esc(v.audit_kind || '')}" placeholder="1차 사후심사 · 갱신심사"><datalist id="ctAudit"><option value="1차 사후심사"><option value="2차 사후심사"><option value="갱신심사"><option value="최초심사"><option value="특별심사"></datalist></label>
        <div class="ip-calc"><button type="button" class="btn small" data-ct-calc>기간 자동 계산</button></div>
      </div></fieldset>
      <label>메모<textarea name="note" rows="2" maxlength="1000">${esc(v.note || '')}</textarea></label>
      <div class="actions">${r ? '<button type="button" class="btn danger" data-ct-del>삭제</button>' : ''}<span class="grow"></span><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
    const f = $('[data-ct-form]', m.el), el = n => f.elements[n];
    const hint = () => { const h = CERT_INFO[el('kind').value]?.hint; $('[data-ct-hint]', f).textContent = h ? `(${h} · 참고값)` : ''; };
    const calc = force => { const s = certSuggest(el('kind').value, el('issue_date').value, data.today); if (s.expire && (force || !el('expire_date').value)) el('expire_date').value = s.expire; if (s.next && (force || !el('next_audit').value)) el('next_audit').value = s.next; if (s.nextKind && (force || !el('audit_kind').value)) el('audit_kind').value = s.nextKind; };
    hint(); el('kind').onchange = () => { hint(); calc(false); }; el('issue_date').onchange = () => { if (!el('first_date').value) el('first_date').value = el('issue_date').value; calc(false); };
    $('[data-ct-calc]', f).onclick = () => { calc(true); toast('인증 종류·발행일로 유효기간과 다음 심사를 채웠습니다(참고값).'); };
    $('[data-no]', f).onclick = () => m.close();
    $('[data-ct-del]', f)?.addEventListener('click', async () => { if (!await confirmBox(`${r.kind} ${r.cert_no || ''}을(를) 목록에서 지울까요? 인증이 끝난 경우에는 지우지 말고 상태를 「만료」·「취소·반납」으로 바꾸면 이력이 남습니다.`)) return; try { await api('DELETE', `/api/certs/${r.id}?revision=${r.revision}`); toast('지웠습니다.'); m.close(); await load(); } catch (e) { fail(e); } });
    f.onsubmit = async e => { e.preventDefault(); const body = formObj(f), btn = $('button.primary', f); btn.disabled = true;
      try { if (r) await api('PUT', `/api/certs/${r.id}`, { ...body, revision: r.revision }); else await api('POST', '/api/certs', { ...body, request_id: crypto.randomUUID() }); toast('저장했습니다.'); m.close(); await load(); }
      catch (error) { fail(error); if (error.status === 409) load().catch(() => {}); } finally { btn.disabled = false; } };
  };
  const audit = async r => {
    const k = CERT_INFO[r.kind] || {}, renewal = /갱신/.test(r.audit_kind || '') || !k.annual;
    const dayAfter = d => new Date(Date.parse(d || todayStr()) + 86400000).toISOString().slice(0, 10);
    const newIssue = renewal ? (r.expire_date || todayStr()) : r.issue_date || '';
    // 갱신: 새 발행일 기준 유효기간·첫 사후심사 / 사후: 지금 예정일 다음의 사후심사(없으면 갱신심사)
    const sug = renewal ? certSuggest(r.kind, newIssue, newIssue) : { ...certSuggest(r.kind, r.issue_date, dayAfter(r.next_audit)), expire: r.expire_date };
    const v = await promptBox(`심사 완료 · ${r.kind} ${r.cert_no || ''}`, `<p>예정 <b>${esc(r.next_audit || '—')}</b> ${esc(r.audit_kind || '')}${r.expire_date ? ` · 지금 유효기간 ~ ${esc(r.expire_date)}` : ''}</p>
      <p class="small muted">${renewal ? '갱신심사: 새 인증서의 발행일·유효기간과 다음 심사를 넣습니다.' : '사후심사: 다음 심사일을 넘깁니다(유효기간은 그대로).'} 제안 날짜는 고칠 수 있습니다. 「부적합」이면 상태가 「정지」가 됩니다.</p>
      <div class="form-grid"><label>심사일 *<input type="date" name="done_date" required value="${todayStr()}"></label>
      <label>결과 *<select name="result"><option>적합</option><option>조건부 적합</option><option>부적합</option></select></label><label>심사 종류<input name="audit_kind" maxlength="30" value="${esc(r.audit_kind || '')}"></label>
      ${renewal ? `<label>새 발행일<input type="date" name="issue_date" value="${esc(newIssue)}"></label><label>새 유효기간(만료일)<input type="date" name="expire_date" value="${esc(sug.expire || '')}"></label>` : ''}
      <label>다음 심사일<input type="date" name="next_audit" value="${esc(sug.next || '')}"></label><label>다음 심사 종류<input name="next_kind" maxlength="30" value="${esc(sug.nextKind || '')}" list="ctAudit2"><datalist id="ctAudit2"><option value="1차 사후심사"><option value="2차 사후심사"><option value="갱신심사"></datalist></label>
      <label class="span3">메모<input name="note" maxlength="300" placeholder="예) 부적합 경미 2건 · 시정조치 12월 제출"></label></div>`, { wide: true });
    if (!v) return; try { await api('POST', `/api/certs/${r.id}/audit`, { ...v, revision: r.revision }); toast('심사 결과를 저장했습니다.'); await load(); } catch (e) { fail(e); }
  };
  const history = r => modal(`<h3>이력 · ${esc(r.kind)} ${esc(r.cert_no || '')}</h3>${(r.history || []).length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>일시</th><th>담당</th><th>내용</th></tr></thead><tbody>${[...r.history].reverse().map(h => `<tr><td class="nowrap">${esc(String(h.at || '').slice(0, 16))}</td><td>${esc(h.by || '')}</td><td>${h.what === '심사' ? `<b>심사</b> ${esc(h.kind || '')} · ${esc(h.done || '')} · <span class="chip ${h.result === '부적합' ? 'red' : h.result === '적합' ? 'green' : 'yellow'}">${esc(h.result || '')}</span> · 다음 ${esc(h.next || '없음')}${h.expire ? ` · 유효기간 ${esc(h.expire[0] || '—')} → ${esc(h.expire[1] || '—')}` : ''}${h.status ? ` · 상태 ${esc(CERT_STATUS_LABEL[h.status[0]] || '')} → ${esc(CERT_STATUS_LABEL[h.status[1]] || '')}` : ''}${h.note ? ` · ${esc(h.note)}` : ''}` : h.what === '수정' ? `수정 (${(h.fields || []).length}칸)${h.status ? ` · 상태 ${esc(CERT_STATUS_LABEL[h.status[0]] || '')} → ${esc(CERT_STATUS_LABEL[h.status[1]] || '')}` : ''}` : esc(h.what || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">이력이 없습니다.</p>'}`, { wide: true });
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-ct-tile]'); if (t) { const i = Number(t.dataset.ctTile); form.elements.status.value = i === 1 ? 'valid' : i === 2 ? 'prep' : ''; form.elements.due.value = i === 3 ? 'soon' : i === 4 ? 'over' : ''; draw(); return; }
    if (e.target.closest('#ctNew')) return editor().catch?.(fail);
    if (e.target.closest('#ctXlsx')) { const list = filtered(); if (!list.length) return toast('내보낼 줄이 없습니다.', 'err');
      return xlsxDownload(`인증서_${data.today}.xlsx`, { sheet: '인증서', titles: ['인증서 관리', data.today], columns: ['인증 종류', '인증번호', '인증명', '인증 범위', '인증기관', '사업장', '최초 인증일', '발행일', '유효기간', '다음 심사일', '심사 종류', '상태', '담당자', '메모'].map(label => ({ label, type: 'text' })),
        rows: list.map(r => [r.kind, r.cert_no, r.title, r.scope, r.body, r.site, r.first_date || '', r.issue_date || '', r.expire_date || '', r.next_audit || '', r.audit_kind, r.status_label, r.owner_name, r.note]) }); }
    const find = a => data.rows.find(x => x.id === Number(e.target.closest(`[${a}]`)?.getAttribute(a)));
    if (e.target.closest('[data-ct-edit]')) return editor(find('data-ct-edit'));
    if (e.target.closest('[data-ct-audit]')) return audit(find('data-ct-audit')).catch(fail);
    if (e.target.closest('[data-ct-hist]')) return history(find('data-ct-hist'));
  });
  main.addEventListener('dblclick', e => { const tr = e.target.closest('[data-ct-row]'); if (tr && data.can_manage && !e.target.closest('button')) editor(data.rows.find(x => x.id === Number(tr.dataset.ctRow))); });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// 15.304 품질 › 검교정 관리(계측기 대장): 어디에 어떤 계측기가 있고, 언제 교정했고, 언제까지 다시 교정해야 하는지
const INST_STATUS_LABEL = { in_use: '사용 중', at_cal: '교정 중', out: '사용중지', spare: '예비', disposed: '폐기' };
const INST_STATUS_CHIP = { in_use: 'green', at_cal: 'yellow', out: 'red', spare: '', disposed: '' };
const INST_CAL_LABEL = { external: '외부 교정(KOLAS 등)', internal: '자체 교정', check: '일상 점검' };
const INST_RESULT_CHIP = { '적합': 'green', '조정 후 적합': 'yellow', '부적합': 'red' };
const INST_NAMES = ['온습도계', '온도계', '습도계', '파티클 카운터', '저울(전자저울)', '버니어 캘리퍼스', '마이크로미터', '두께 측정기', '인장시험기', '차압계', '풍속계', '표면저항 측정기', '정전기 측정기', 'pH 미터', '수분 측정기', '타이머·스톱워치', '압력계', '조도계'];
// 다음 교정일 = 교정일 + 주기(개월) − 1일 (서버와 같은 계산)
function calNext(done, months) { if (!done || !months) return ''; const [y, m, d] = done.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + Number(months), d)); if (t.getUTCDate() !== d) t.setUTCDate(0); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }
async function pageCalibration(main) {
  main.innerHTML = `<h1>검교정 관리 <span class="dept">품질</span></h1>
  <p class="muted">측정·시험에 쓰는 계측기(온습도계·저울·파티클 카운터 등)를 <b>관리번호·위치·모델·제조사</b>로 등록하고, <b>교정 주기</b>에 맞춰 다음 교정일을 관리합니다(ISO 9001 7.1.5). 다음 교정일 = 교정일 + 주기 − 1일 (예: 2026-12-01 교정, 1년 → 2027-11-30까지). 지나면 빨강, 30일 안이면 노랑. 여러 대를 체크해 한꺼번에 교정 처리·QR 라벨 발행할 수 있습니다.</p>
  <div class="ip-tiles" id="calTiles"></div>
  <form class="toolbar list-filters" data-read-only id="calFilters">
    <label class="lf-sel">위치<select name="loc"><option value="">전체</option></select></label>
    <label class="lf-sel">상태<select name="status"><option value="">전체(폐기 빼고)</option>${Object.entries(INST_STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="all">폐기 포함 전체</option></select></label>
    <label class="lf-sel">기한<select name="due"><option value="">전체</option><option value="soon">30일 안 · 지남</option><option value="over">기한 지남</option><option value="60">60일 안 · 지남</option></select></label>
    <label class="list-search">찾기<input type="search" name="q" placeholder="관리번호·장비명·모델·제조사·S/N·담당"></label>
    <span class="grow"></span><span id="calTools" class="ip-tools"></span>
  </form>
  <div class="cal-bar" id="calBar" hidden></div>
  <div id="calList"></div>`;
  const form = $('#calFilters', main); let data = { rows: [], can_manage: false, today: todayStr() }; const picked = new Set();
  const load = async () => { data = await api('GET', '/api/instruments'); if (!main.isConnected) return; const locs = [...new Set(data.rows.map(r => r.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')); const sel = form.elements.loc, cur = sel.value; sel.innerHTML = '<option value="">전체</option>' + locs.map(l => `<option>${esc(l)}</option>`).join(''); sel.value = cur; for (const id of [...picked]) if (!data.rows.some(r => r.id === id)) picked.delete(id); draw(); };
  const active = r => !['disposed', 'spare'].includes(r.status);
  const dueCls = (r, soonDays = 30) => { const d = ipDday(r.next_due, data.today); return d === null || !active(r) ? '' : d < 0 ? 'over' : d <= soonDays ? 'soon' : ''; };
  const filtered = () => { const v = formObj(form), q = (v.q || '').trim().toLowerCase();
    return data.rows.filter(r => (!v.loc || r.location === v.loc) && (v.status === 'all' ? true : v.status ? r.status === v.status : r.status !== 'disposed') && (!v.due || (v.due === 'over' ? dueCls(r) === 'over' : v.due === '60' ? !!dueCls(r, 60) : !!dueCls(r)))
      && (!q || [r.mgmt_no, r.name, r.model, r.maker, r.serial_no, r.owner_name, r.dept, r.cal_agency, r.location_detail, r.note].join(' ').toLowerCase().includes(q))); };
  const bar = () => { const b = $('#calBar', main); b.hidden = !picked.size || !data.can_manage; b.innerHTML = picked.size ? `<b>${picked.size}대 선택</b><button type="button" class="btn primary" data-cal-batch>선택 교정 처리</button><button type="button" class="btn" data-cal-qr-sel>선택 QR 라벨</button><button type="button" class="btn" data-cal-clear>선택 풀기</button>` : ''; };
  const draw = () => {
    const live = data.rows.filter(r => r.status !== 'disposed'), over = live.filter(r => dueCls(r) === 'over').length, soon = live.filter(r => dueCls(r) === 'soon').length;
    $('#calTiles', main).innerHTML = [['보유 계측기', live.length, ''], ['사용 중', live.filter(r => r.status === 'in_use').length, 'green'], ['30일 안 교정', soon, soon ? 'yellow' : ''], ['교정 기한 지남', over, over ? 'red' : ''], ['교정 중', live.filter(r => r.status === 'at_cal').length, ''], ['사용중지', live.filter(r => r.status === 'out').length, live.some(r => r.status === 'out') ? 'red' : '']]
      .map(([l, n, c], i) => `<button type="button" class="ip-tile ${c}" data-cal-tile="${i}"><span>${l}</span><b>${n}</b></button>`).join('');
    $('#calTools', main).innerHTML = `<button type="button" class="btn" id="calXlsx">엑셀</button>${data.can_manage ? '<button type="button" class="btn primary" id="calNew">＋ 계측기 등록</button>' : ''}`;
    const list = filtered();
    $('#calList', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid ip-table cal-table"><thead><tr>${data.can_manage ? '<th><input type="checkbox" data-cal-all aria-label="모두 선택"></th>' : ''}<th>관리번호</th><th>장비명</th><th>모델명 · 제조사</th><th>S/N</th><th>위치</th><th>교정 주기</th><th>직전 교정일</th><th>다음 교정일</th><th>교정 방식 · 기관</th><th>결과</th><th>상태</th><th>담당</th><th></th></tr></thead><tbody>${list.map(r => { const cls = dueCls(r), d = ipDday(r.next_due, data.today);
      return `<tr data-cal-row="${r.id}" class="${cls ? 'ip-' + cls : ''}${r.status === 'disposed' || r.status === 'spare' ? ' row-off' : ''}">${data.can_manage ? `<td class="c"><input type="checkbox" data-cal-pick="${r.id}"${picked.has(r.id) ? ' checked' : ''}${r.status === 'disposed' ? ' disabled' : ''} aria-label="${esc(r.mgmt_no)} 선택"></td>` : ''}
        <td class="nowrap" data-card-primary><b>${esc(r.mgmt_no)}</b></td><td><b>${esc(r.name)}</b>${r.spec ? `<div class="small muted">${esc(r.spec)}</div>` : ''}</td>
        <td>${esc(r.model)}${r.maker ? `<div class="small muted">${esc(r.maker)}</div>` : ''}</td><td class="small">${esc(r.serial_no)}</td>
        <td>${esc(r.location)}${r.location_detail ? `<div class="small muted">${esc(r.location_detail)}</div>` : ''}</td>
        <td class="c nowrap">${r.cycle_months % 12 === 0 ? `${r.cycle_months / 12}년` : `${r.cycle_months}개월`}</td>
        <td class="nowrap">${esc(r.last_cal || '')}</td>
        <td class="nowrap">${r.next_due ? `<b>${esc(r.next_due)}</b>${active(r) ? ` <span class="ip-dd ${cls}">${d < 0 ? `D+${-d}` : d === 0 ? 'D-DAY' : `D-${d}`}</span>` : ''}` : '<span class="muted">—</span>'}</td>
        <td>${esc(INST_CAL_LABEL[r.cal_type] || '')}${r.cal_agency ? `<div class="small muted">${esc(r.cal_agency)}</div>` : ''}</td>
        <td>${r.last_result ? `<span class="chip ${INST_RESULT_CHIP[r.last_result] || ''}">${esc(r.last_result)}</span>` : ''}${r.cert_no ? `<div class="small muted">${esc(r.cert_no)}</div>` : ''}</td>
        <td><span class="chip ${INST_STATUS_CHIP[r.status] || ''}">${esc(r.status_label)}</span></td><td>${esc(r.owner_name)}${r.dept ? `<div class="small muted">${esc(r.dept)}</div>` : ''}</td>
        <td class="nowrap">${data.can_manage ? `<button type="button" class="btn small" data-cal-edit="${r.id}">수정</button>${r.status !== 'disposed' ? ` <button type="button" class="btn small primary" data-cal-do="${r.id}">교정 처리</button>` : ''}` : ''} <button type="button" class="btn small" data-cal-hist="${r.id}">이력</button></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${data.rows.length ? '조건에 맞는 계측기가 없습니다.' : '아직 등록한 계측기가 없습니다. 「＋ 계측기 등록」으로 관리번호·위치·모델·교정 주기·직전 교정일을 넣으면 다음 교정일을 자동으로 관리합니다.'}</div>`;
    bar();
  };
  const editor = async (r = null) => {
    const v = r || { status: 'in_use', cal_type: 'external', cycle_months: 12 };
    const [whs] = await Promise.all([api('GET', '/api/warehouses').catch(() => [])]);
    const locs = [...new Set([...(whs || []).map(w => w.name), ...data.rows.map(x => x.location)].filter(Boolean))];
    const m = modal(`<h3>${r ? '계측기 수정' : '계측기 등록'}</h3><form class="stack" data-cal-form>
      <fieldset class="vendor-sec"><legend>계측기</legend><div class="form-grid">
        <label>관리번호 *<input name="mgmt_no" required maxlength="50" value="${esc(v.mgmt_no || '')}" placeholder="예) T-01" autocapitalize="characters"></label>
        <label>장비명 *<input name="name" required maxlength="100" list="calNames" value="${esc(v.name || '')}" placeholder="예) 온습도계"><datalist id="calNames">${INST_NAMES.map(n => `<option value="${n}">`).join('')}</datalist></label>
        <label>상태 *<select name="status">${Object.entries(INST_STATUS_LABEL).map(([k, l]) => `<option value="${k}"${v.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>모델명<input name="model" maxlength="100" value="${esc(v.model || '')}" placeholder="예) TR-72wb"></label>
        <label>제조사<input name="maker" maxlength="100" value="${esc(v.maker || '')}" placeholder="예) T&D"></label>
        <label>S/N(제조번호)<input name="serial_no" maxlength="100" value="${esc(v.serial_no || '')}"></label>
        <label class="span2">측정 범위 · 분해능<input name="spec" maxlength="200" value="${esc(v.spec || '')}" placeholder="예) -20~60℃ ±0.3℃ / 10~95%RH"></label>
        <label>구입일<input type="date" name="purchase_date" value="${esc(v.purchase_date || '')}"></label>
      </div></fieldset>
      <fieldset class="vendor-sec"><legend>위치 · 담당</legend><div class="form-grid">
        <label>위치 <span class="hint">(동·라인·실)</span><input name="location" maxlength="100" list="calLocs" value="${esc(v.location || '')}" placeholder="예) 1동"><datalist id="calLocs">${locs.map(l => `<option value="${esc(l)}">`).join('')}</datalist></label>
        <label>세부 위치<input name="location_detail" maxlength="100" value="${esc(v.location_detail || '')}" placeholder="예) 클린룸 A 입구"></label>
        <label>사용 부서<input name="dept" maxlength="50" value="${esc(v.dept || '')}"></label>
        <label>담당자<input name="owner_name" maxlength="50" value="${esc(v.owner_name || '')}"></label>
      </div></fieldset>
      <fieldset class="vendor-sec"><legend>검교정 <span class="hint">(다음 교정일 = 직전 교정일 + 주기 − 1일, 비우면 자동)</span></legend><div class="form-grid">
        <label>교정 주기 *<select name="cycle_months">${[3, 6, 12, 24, 36].map(n => `<option value="${n}"${Number(v.cycle_months) === n ? ' selected' : ''}>${n % 12 ? n + '개월' : n / 12 + '년'}</option>`).join('')}${[3, 6, 12, 24, 36].includes(Number(v.cycle_months)) ? '' : `<option value="${v.cycle_months}" selected>${v.cycle_months}개월</option>`}</select></label>
        <label>교정 방식 *<select name="cal_type">${Object.entries(INST_CAL_LABEL).map(([k, l]) => `<option value="${k}"${v.cal_type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>교정기관<input name="cal_agency" maxlength="100" value="${esc(v.cal_agency || '')}" placeholder="예) KTL · KTC · KTR · 자체"></label>
        <label>직전 교정일<input type="date" name="last_cal" value="${esc(v.last_cal || '')}"></label>
        <label>다음 교정일<input type="date" name="next_due" value="${esc(v.next_due || '')}"></label>
        <label>직전 결과<select name="last_result"><option value="">—</option>${['적합', '조정 후 적합', '부적합'].map(x => `<option${v.last_result === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>성적서 번호<input name="cert_no" maxlength="80" value="${esc(v.cert_no || '')}"></label>
      </div></fieldset>
      <label>메모<textarea name="note" rows="2" maxlength="1000">${esc(v.note || '')}</textarea></label>
      <div class="actions">${r ? '<button type="button" class="btn danger" data-cal-del>삭제</button>' : ''}<span class="grow"></span><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
    const f = $('[data-cal-form]', m.el), el = n => f.elements[n]; let autoNext = !v.next_due || v.next_due === calNext(v.last_cal, v.cycle_months);
    const sync = () => { if (autoNext && el('last_cal').value) el('next_due').value = calNext(el('last_cal').value, el('cycle_months').value); };
    el('last_cal').onchange = sync; el('cycle_months').onchange = sync; el('next_due').oninput = () => { autoNext = false; };
    $('[data-no]', f).onclick = () => m.close();
    $('[data-cal-del]', f)?.addEventListener('click', async () => { if (!await confirmBox(`${r.mgmt_no} ${r.name}을(를) 지울까요? 쓰지 않게 된 계측기는 지우지 말고 상태를 「폐기」로 바꾸면 교정 이력이 남습니다.`)) return; try { await api('DELETE', `/api/instruments/${r.id}?revision=${r.revision}`); toast('지웠습니다.'); m.close(); await load(); } catch (e) { fail(e); } });
    f.onsubmit = async e => { e.preventDefault(); const body = formObj(f), btn = $('button.primary', f); btn.disabled = true;
      try { if (r) await api('PUT', `/api/instruments/${r.id}`, { ...body, revision: r.revision }); else await api('POST', '/api/instruments', { ...body, request_id: crypto.randomUUID() }); toast('저장했습니다.'); m.close(); await load(); }
      catch (error) { fail(error); if (error.status === 409) load().catch(() => {}); } finally { btn.disabled = false; } };
  };
  const calibrate = async list => {
    const one = list.length === 1 ? list[0] : null;
    const v = await promptBox(one ? `교정 처리 · ${one.mgmt_no} ${one.name}` : `교정 처리 · ${list.length}대`, `${one ? `<p>주기 ${one.cycle_months % 12 ? one.cycle_months + '개월' : one.cycle_months / 12 + '년'} · 직전 ${esc(one.last_cal || '—')} · 예정 <b>${esc(one.next_due || '—')}</b></p>` : `<p class="small">${list.map(x => `<b>${esc(x.mgmt_no)}</b> ${esc(x.name)}`).join(' · ')}</p><p class="small muted">다음 교정일은 계측기마다 교정일 + 각자 주기 − 1일로 넣습니다.</p>`}
      <div class="form-grid"><label>교정일 *<input type="date" name="done_date" required value="${todayStr()}" max="${todayStr()}" data-cal-done></label>
      <label>결과 *<select name="result" data-cal-res><option>적합</option><option>조정 후 적합</option><option>부적합</option></select></label>
      <label>교정기관<input name="agency" maxlength="100" value="${esc(one?.cal_agency || '')}"></label>
      ${one ? `<label>성적서 번호<input name="cert_no" maxlength="80"></label><label>다음 교정일<input type="date" name="next_due" value="${esc(calNext(todayStr(), one.cycle_months))}" data-cal-next></label><label>비용(원)<input type="number" name="cost" min="0" step="1"></label>` : ''}
      <label class="span3">메모 <span class="hint" data-cal-memo-hint>(부적합이면 꼭: 조치·이전 측정 결과 영향 검토)</span><input name="note" maxlength="300" placeholder="예) 2℃ 편차 → 조정 후 적합 / 부적합: 지난 3개월 측정 기록 재검토"></label></div>`, { wide: true,
      onOpen: el => { const d = $('[data-cal-done]', el), n = $('[data-cal-next]', el); if (n) d.onchange = () => { n.value = calNext(d.value, one.cycle_months); }; } });
    if (!v) return;
    try { const r = await api('POST', '/api/instruments/calibrate', { ...v, items: list.map(x => ({ id: x.id, revision: x.revision })) }); toast(`${r.done}대 교정 처리했습니다.${v.result === '부적합' ? ' 부적합 장비는 사용중지로 바꿨습니다.' : ''}`); picked.clear(); await load(); } catch (e) { fail(e); if (e.status === 409) load().catch(() => {}); }
  };
  const qr = list => qrIssue(list.map(r => ({ code: r.mgmt_no, sub: [r.name, r.model, r.location, r.next_due ? `다음 교정 ${r.next_due}` : ''].filter(Boolean).join(' · ') })), { title: `계측기 라벨 · ${list.length}대`, file: '계측기라벨' });
  const history = r => modal(`<h3>이력 · ${esc(r.mgmt_no)} ${esc(r.name)}</h3>${(r.history || []).length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>일시</th><th>담당</th><th>내용</th></tr></thead><tbody>${[...r.history].reverse().map(h => `<tr><td class="nowrap">${esc(String(h.at || '').slice(0, 16))}</td><td>${esc(h.by || '')}</td><td>${h.what === '교정' ? `<b>교정</b> ${esc(h.done || '')} · <span class="chip ${INST_RESULT_CHIP[h.result] || ''}">${esc(h.result || '')}</span>${h.agency ? ` · ${esc(h.agency)}` : ''}${h.cert ? ` · 성적서 ${esc(h.cert)}` : ''}${h.cost != null ? ` · ${fmtNum(h.cost)}원` : ''} · 다음 ${esc(h.next || '—')}${h.status ? ` · 상태 ${esc(INST_STATUS_LABEL[h.status[0]] || '')} → ${esc(INST_STATUS_LABEL[h.status[1]] || '')}` : ''}${h.note ? ` · ${esc(h.note)}` : ''}` : h.what === '수정' ? `수정 (${(h.fields || []).length}칸)${h.moved ? ` · 위치 ${esc(h.moved[0] || '—')} → ${esc(h.moved[1] || '—')}` : ''}${h.status ? ` · 상태 ${esc(INST_STATUS_LABEL[h.status[0]] || '')} → ${esc(INST_STATUS_LABEL[h.status[1]] || '')}` : ''}` : esc(h.what || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">이력이 없습니다.</p>'}`, { wide: true });
  main.addEventListener('change', e => {
    const p = e.target.closest('[data-cal-pick]'); if (p) { const id = Number(p.dataset.calPick); p.checked ? picked.add(id) : picked.delete(id); bar(); return; }
    if (e.target.closest('[data-cal-all]')) { const on = e.target.checked; filtered().filter(r => r.status !== 'disposed').forEach(r => on ? picked.add(r.id) : picked.delete(r.id)); draw(); }
  });
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-cal-tile]'); if (t) { const i = Number(t.dataset.calTile); form.elements.status.value = i === 1 ? 'in_use' : i === 4 ? 'at_cal' : i === 5 ? 'out' : ''; form.elements.due.value = i === 2 ? 'soon' : i === 3 ? 'over' : ''; draw(); return; }
    if (e.target.closest('#calNew')) return editor().catch(fail);
    if (e.target.closest('#calXlsx')) { const list = filtered(); if (!list.length) return toast('내보낼 줄이 없습니다.', 'err');
      return xlsxDownload(`계측기_검교정_${data.today}.xlsx`, { sheet: '검교정', titles: ['검교정 관리(계측기 대장)', data.today], columns: ['관리번호', '장비명', '모델명', '제조사', 'S/N', '측정 범위', '위치', '세부 위치', '사용 부서', '담당자', '교정 주기(개월)', '교정 방식', '교정기관', '직전 교정일', '다음 교정일', '결과', '성적서 번호', '상태', '메모'].map(label => ({ label, type: label === '교정 주기(개월)' ? 'number' : 'text' })),
        rows: list.map(r => [r.mgmt_no, r.name, r.model, r.maker, r.serial_no, r.spec, r.location, r.location_detail, r.dept, r.owner_name, r.cycle_months, r.cal_label, r.cal_agency, r.last_cal || '', r.next_due || '', r.last_result, r.cert_no, r.status_label, r.note]) }); }
    const sel = () => data.rows.filter(r => picked.has(r.id));
    if (e.target.closest('[data-cal-batch]')) return calibrate(sel()).catch(fail);
    if (e.target.closest('[data-cal-qr-sel]')) return qr(sel());
    if (e.target.closest('[data-cal-clear]')) { picked.clear(); draw(); return; }
    const find = a => data.rows.find(x => x.id === Number(e.target.closest(`[${a}]`)?.getAttribute(a)));
    if (e.target.closest('[data-cal-edit]')) return editor(find('data-cal-edit')).catch(fail);
    if (e.target.closest('[data-cal-do]')) return calibrate([find('data-cal-do')]).catch(fail);
    if (e.target.closest('[data-cal-hist]')) return history(find('data-cal-hist'));
  });
  main.addEventListener('dblclick', e => { const tr = e.target.closest('[data-cal-row]'); if (tr && data.can_manage && !e.target.closest('button, input')) editor(data.rows.find(x => x.id === Number(tr.dataset.calRow))).catch(fail); });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// ── 15.305 품질 1단계: COA 발행(LOT별 성적서) · 부적합·CAPA ──
const COA_STATUS_LABEL = { draft: '작성(승인 대기)', approved: '승인(발행)', void: '무효' };
const COA_STATUS_CHIP = { draft: 'yellow', approved: 'green', void: '' };
const COA_T = {
  ko: { title: '시험성적서 (COA)', no: '발행번호', item: '품목명', code: '품목코드', lot: 'LOT No.', customer: '고객사', mfg: '제조일', exp: '유효기간', qty: '수량', ship: '출하일', test: '시험 항목', unit: '단위', spec: '규격', method: '시험방법', result: '결과', judge: '판정', overall: '종합 판정', pass: '적합', note: '비고', approved: '승인', issued: '발행일', source: '근거 기록' },
  en: { title: 'Certificate of Analysis', no: 'COA No.', item: 'Product', code: 'Product Code', lot: 'Lot No.', customer: 'Customer', mfg: 'Mfg. Date', exp: 'Expiry Date', qty: 'Quantity', ship: 'Ship Date', test: 'Test Item', unit: 'Unit', spec: 'Specification', method: 'Method', result: 'Result', judge: 'Judgement', overall: 'Overall', pass: 'Pass', note: 'Remarks', approved: 'Approved by', issued: 'Issue Date', source: 'Source record' },
};
const coaJudgeEn = j => ({ '적합': 'Pass', '부적합': 'Fail', '기록': 'Report' }[j] || j);
// 성적서 본문(인쇄·미리보기 공용)
function coaSheet(c, company = {}) {
  const t = COA_T[c.lang === 'en' ? 'en' : 'ko'], en = c.lang === 'en', jd = j => en ? coaJudgeEn(j) : j;
  const head = [[t.item, c.item], [t.code, c.product_code], [t.lot, c.lot], [t.customer, c.customer], [t.mfg, c.mfg_date], [t.exp, c.exp_date], [t.qty, c.qty == null ? '' : `${fmtNum(c.qty)} ${c.unit || ''}`], [t.ship, c.ship_date]].filter(([, v]) => v);
  return `<div class="coa-sheet${c.status === 'void' ? ' coa-void' : ''}">
    <div class="coa-top"><div><b class="coa-company">${esc(company.biz_name || '')}</b><div class="small">${esc(company.address || '')}${company.phone ? ` · ${esc(company.phone)}` : ''}</div></div><div class="coa-no">${t.no} <b>${esc(c.coa_no)}</b>${c.rev ? ` Rev.${c.rev}` : ''}</div></div>
    <h2 class="coa-title">${t.title}</h2>
    <table class="coa-head">${head.map(([k, v], i) => `${i % 2 ? '' : '<tr>'}<th>${k}</th><td>${esc(String(v))}</td>${i % 2 ? '</tr>' : ''}`).join('')}${head.length % 2 ? '<th></th><td></td></tr>' : ''}</table>
    <table class="coa-items"><thead><tr><th>No.</th><th>${t.test}</th><th>${t.unit}</th><th>${t.spec}</th>${c.items.some(i => i.method) ? `<th>${t.method}</th>` : ''}<th>${t.result}</th><th>${t.judge}</th></tr></thead>
      <tbody>${c.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(i.name)}</td><td class="c">${esc(i.unit)}</td><td class="c">${esc(i.spec)}</td>${c.items.some(x => x.method) ? `<td>${esc(i.method || '')}</td>` : ''}<td class="r">${i.avg == null ? '—' : fmtNum(i.avg)}</td><td class="c">${esc(jd(i.judge))}</td></tr>`).join('')}</tbody></table>
    <p class="coa-overall">${t.overall}: <b>${en ? 'PASS' : '적합'}</b></p>
    ${c.note ? `<p class="small">${t.note}: ${esc(c.note)}</p>` : ''}
    <div class="coa-sign"><div>${t.issued}: ${esc(String(c.approved_at || c.created_at || '').slice(0, 10))}</div><div>${t.approved}: <b>${c.status === 'approved' ? esc(c.approved_by) : '—'}</b>${c.status === 'approved' ? '' : ` <span class="small">(${en ? 'not approved' : '승인 전'})</span>`}</div></div>
    <p class="small muted coa-src">${t.source}: ${esc(c.source_no || '')}</p>
    ${c.status === 'void' ? `<div class="coa-void-mark">VOID · ${esc(c.void_reason || '')}</div>` : ''}
  </div>`;
}
async function coaOpen(id, after) {
  const c = await api('GET', `/api/coas/${id}`), me = ME || {}, canApprove = me.is_admin || (me.roles || []).includes('quality_approver'), canManage = hasRole('quality');
  const m = modal(`${coaSheet(c, c.company)}<div class="actions"><button class="btn" data-coa-print>인쇄 · PDF</button><button class="btn" data-coa-hist>이력</button>${canManage && c.status !== 'void' ? `<button class="btn" data-coa-edit>${c.status === 'approved' ? '고쳐서 재발행' : '고치기'}</button>` : ''}${canManage && c.status !== 'void' ? '<button class="btn danger" data-coa-void>무효</button>' : ''}${canApprove && c.status === 'draft' ? '<button class="btn primary" data-coa-ok>승인</button>' : ''}</div>`, { wide: true });
  m.el.classList.add('coa-modal');
  $('[data-coa-print]', m.el).onclick = () => { document.body.classList.add('printing'); window.print(); document.body.classList.remove('printing'); };
  $('[data-coa-hist]', m.el).onclick = () => modal(`<h3>이력 · ${esc(c.coa_no)}</h3><div class="table-wrap"><table class="grid"><thead><tr><th>일시</th><th>담당</th><th>내용</th></tr></thead><tbody>${[...c.history].reverse().map(h => `<tr><td class="nowrap">${esc(String(h.at || '').slice(0, 16))}</td><td>${esc(h.by || '')}</td><td>${esc(h.what || '')}${h.rev != null ? ` Rev.${h.rev}` : ''}${h.source ? ` · ${esc(h.source)}` : ''}${h.reason ? ` · ${esc(h.reason)}` : ''}${h.prev ? ` · 이전 Rev.${h.prev.rev} 승인 ${esc(h.prev.approved_by || '')}` : ''}</td></tr>`).join('')}</tbody></table></div>`, { wide: true });
  $('[data-coa-ok]', m.el)?.addEventListener('click', async () => { try { await api('POST', `/api/coas/${c.id}/approve`, { revision: c.revision }); toast('승인했습니다. 이제 인쇄해 보낼 수 있습니다.'); m.close(); await after?.(); await coaOpen(c.id, after); } catch (e) { fail(e); } });
  $('[data-coa-void]', m.el)?.addEventListener('click', async () => { const v = await promptBox(`COA 무효 · ${c.coa_no}`, '<label>무효 사유 *<input name="reason" required maxlength="300" placeholder="예) LOT 오기재 · 새 COA로 다시 발행"></label>'); if (!v) return; try { await api('POST', `/api/coas/${c.id}/void`, { ...v, revision: c.revision }); toast('무효 처리했습니다.'); m.close(); await after?.(); } catch (e) { fail(e); } });
  $('[data-coa-edit]', m.el)?.addEventListener('click', async () => { m.close(); await coaEdit(c, after); });
}
const coaHeadFields = (v, src) => `<div class="form-grid">
  <label>고객사<input name="customer" maxlength="100" list="coaCust" value="${esc(v.customer || '')}"><datalist id="coaCust">${(src?.header?.customers || []).map(x => `<option value="${esc(x.customer)}">`).join('')}</datalist></label>
  <label>품목명<input name="item" maxlength="200" value="${esc(v.item || '')}"></label><label>품목코드<input name="product_code" maxlength="80" value="${esc(v.product_code || '')}"></label>
  <label>제조일<input type="date" name="mfg_date" value="${esc(v.mfg_date || '')}"></label><label>유효기간 <span class="hint">(기본 제조일 + 24개월)</span><input type="date" name="exp_date" value="${esc(v.exp_date || '')}"></label><label>출하일<input type="date" name="ship_date" value="${esc(v.ship_date || '')}"></label>
  <label>수량<input type="number" step="any" name="qty" value="${v.qty ?? ''}"></label><label>단위<input name="unit" maxlength="20" value="${esc(v.unit || '')}"></label>
  <label>언어<select name="lang"><option value="ko"${v.lang !== 'en' ? ' selected' : ''}>국문</option><option value="en"${v.lang === 'en' ? ' selected' : ''}>영문</option></select></label>
  <label class="span3">비고<input name="note" maxlength="500" value="${esc(v.note || '')}"></label></div>`;
async function coaNew(lot0 = '') {
  const lot = lot0 || (await promptBox('COA 작성 · LOT', '<label>LOT *<input name="lot" required maxlength="100" placeholder="예) 261120_CF_P1" autocomplete="off"></label><p class="small muted">출하검사(없으면 공정·의뢰검사·연구 분석) 측정값이 합격인 LOT만 발행됩니다.</p>'))?.lot?.trim();
  if (!lot) return;
  const src = await api('GET', '/api/coa/source?' + new URLSearchParams({ lot }));
  if (!src.candidates.length) return toast(`LOT ${lot}의 측정 기록이 없습니다. 출하검사나 분석의뢰에 측정값을 먼저 넣으세요.`, 'err');
  const first = src.header.customers[0] || {}, mfg = src.header.mfg_date, exp = mfg ? calNext(mfg, 24) : '';
  const v0 = { ...src.header, customer: first.customer || '', ship_date: first.ship_date || '', exp_date: exp, lang: 'ko' };
  const prev = s0 => `<div class="table-wrap"><table class="grid"><thead><tr><th>시험 항목</th><th>단위</th><th>규격</th><th class="r">결과(평균)</th><th>판정</th></tr></thead><tbody>${(s0?.items || []).map(i => `<tr${i.judge === '부적합' ? ' class="rm-fail-row"' : ''}><td>${esc(i.name)}</td><td>${esc(i.unit)}</td><td>${esc(i.spec)}</td><td class="r">${i.avg == null ? '—' : fmtNum(i.avg)}</td><td>${esc(i.judge)}</td></tr>`).join('')}</tbody></table></div>`;
  const v = await promptBox(`COA 작성 · LOT ${lot}`, `${src.coas.length ? `<p class="small">이 LOT의 COA: ${src.coas.map(x => `<b>${esc(x.coa_no)}</b> ${COA_STATUS_LABEL[x.status] || x.status}`).join(' · ')}</p>` : ''}
    <label>근거 측정 기록 *<select name="source_request_id" data-coa-src>${src.candidates.map(c => `<option value="${c.id}"${c.id === src.source?.id ? ' selected' : ''}>${esc(c.req_no)} · ${esc(c.category)} · ${c.result === 'pass' ? '합격' : c.result === 'fail' ? '불합격' : '측정 중'}</option>`).join('')}</select></label>
    <div data-coa-prev>${prev(src.source)}</div>${coaHeadFields(v0, src)}`, { wide: true,
    onOpen: el => { $('[data-coa-src]', el).onchange = async e => { try { const s2 = await api('GET', '/api/coa/source?' + new URLSearchParams({ lot, source: e.target.value })); $('[data-coa-prev]', el).innerHTML = prev(s2.source); } catch (er) { fail(er); } }; },
    submit: async vals => api('POST', '/api/coas', { ...vals, lot, request_id: crypto.randomUUID() }) });
  if (!v) return; toast(`${v.coa_no}을(를) 만들었습니다. 품질책임자가 승인하면 발행됩니다.`);
  document.querySelector('#main')?.coaReload?.(); await coaOpen(v.id, () => document.querySelector('#main')?.coaReload?.());
}
async function coaEdit(c, after) {
  const v = await promptBox(`${c.status === 'approved' ? 'COA 재발행' : 'COA 고치기'} · ${c.coa_no}`, `${c.status === 'approved' ? `<p class="small">승인된 COA를 고치면 <b>Rev.${c.rev + 1}</b> 작성 상태로 돌아가고, 다시 승인해야 발행됩니다. 이전 판은 이력에 남습니다.</p>` : ''}${coaHeadFields(c)}<label class="inline"><input type="checkbox" name="refresh" value="1"> 측정값 다시 가져오기(근거 기록이 고쳐졌을 때)</label>`, { wide: true,
    submit: async vals => api('PUT', `/api/coas/${c.id}`, { ...vals, refresh: !!vals.refresh, revision: c.revision }) });
  if (!v) return; toast('저장했습니다.'); await after?.(); await coaOpen(c.id, after);
}
async function pageCoa(main) {
  main.innerHTML = `<h1>COA 발행 <span class="dept">품질</span></h1>
  <p class="muted">완제품·상품 <b>LOT마다 시험성적서(COA)</b>를 만듭니다. 그 LOT의 출하검사(없으면 공정·의뢰검사) 측정값을 그대로 옮기고, 품질책임자가 승인하면 발행(인쇄·PDF)됩니다. 승인 뒤 고치면 Rev가 올라 다시 승인합니다. 출하검사 창의 「COA 발행」으로도 바로 만들 수 있습니다.</p>
  <div class="ip-tiles" id="coaTiles"></div>
  <form class="toolbar list-filters" data-read-only id="coaFilters"><label class="lf-sel">상태<select name="status"><option value="">전체</option>${Object.entries(COA_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="list-search">찾기<input type="search" name="q" placeholder="발행번호·LOT·품목·고객사"></label><span class="grow"></span><span id="coaTools" class="ip-tools"></span></form>
  <div id="coaList"></div>`;
  const form = $('#coaFilters', main); let data = { rows: [] };
  const load = async () => { const v = formObj(form); data = await api('GET', '/api/coas?' + new URLSearchParams(Object.entries(v).filter(([, x]) => x))); if (main.isConnected) draw(); };
  main.coaReload = () => load().catch(fail);
  const draw = () => {
    const rows = data.rows;
    $('#coaTiles', main).innerHTML = [['전체', rows.length, ''], ['승인 대기', rows.filter(r => r.status === 'draft').length, rows.some(r => r.status === 'draft') ? 'yellow' : ''], ['발행', rows.filter(r => r.status === 'approved').length, 'green'], ['무효', rows.filter(r => r.status === 'void').length, '']].map(([l, n, c], i) => `<button type="button" class="ip-tile ${c}" data-coa-tile="${i}"><span>${l}</span><b>${n}</b></button>`).join('');
    $('#coaTools', main).innerHTML = data.can_manage ? '<button type="button" class="btn primary" id="coaNewBtn">＋ LOT로 COA 작성</button>' : '';
    $('#coaList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>발행번호</th><th>LOT</th><th>품목</th><th>고객사</th><th>제조일</th><th>유효기간</th><th>근거</th><th>상태</th><th>승인</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-coa-row="${r.id}"${r.status === 'void' ? ' class="row-off"' : ''}><td class="nowrap" data-card-primary><b>${esc(r.coa_no)}</b>${r.rev ? ` <span class="chip">Rev.${r.rev}</span>` : ''}</td><td class="nowrap">${esc(r.lot)}</td><td>${esc(r.item)}${r.product_code ? `<div class="small muted">${esc(r.product_code)}</div>` : ''}</td><td>${esc(r.customer)}</td><td class="nowrap">${esc(r.mfg_date || '')}</td><td class="nowrap">${esc(r.exp_date || '')}</td><td class="small">${esc(r.source_no)}</td><td><span class="chip ${COA_STATUS_CHIP[r.status] || ''}">${esc(COA_STATUS_LABEL[r.status] || r.status)}</span></td><td class="small">${esc(r.approved_by || '')}${r.approved_at ? `<div class="muted">${esc(String(r.approved_at).slice(0, 10))}</div>` : ''}</td><td><button type="button" class="btn small" data-coa-open="${r.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">COA가 없습니다. 「＋ LOT로 COA 작성」에 출하검사 합격 LOT를 넣으면 측정값으로 성적서를 만듭니다.</div>';
  };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-coa-tile]'); if (t) { form.elements.status.value = ['', 'draft', 'approved', 'void'].at(Number(t.dataset.coaTile)); load().catch(fail); return; }
    if (e.target.closest('#coaNewBtn')) return coaNew().catch(fail);
    const o = e.target.closest('[data-coa-open]') || (e.type === 'click' && null); if (o) coaOpen(Number(o.dataset.coaOpen), load).catch(fail);
  });
  form.addEventListener('change', () => load().catch(fail)); let tm = null; form.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => load().catch(fail), 250); }); form.onsubmit = e => e.preventDefault();
  await load();
}

// 부적합·CAPA
const NC_STATUS_LABEL = { open: '등록', analysis: '원인분석', action: '조치', verify: '유효성검증', closed: '종결', void: '취소' };
const NC_STATUS_CHIP = { open: 'yellow', analysis: 'yellow', action: 'yellow', verify: 'yellow', closed: 'green', void: '' };
const NC_FLOW = ['open', 'analysis', 'action', 'verify', 'closed'];
const NC_SOURCE_LABEL = { iqc: '수입검사', oqc: '출하검사', analysis: '분석', process: '공정 이상', voc: '고객 불만(VOC)', audit: '심사 지적', risk: '위험성평가', other: '기타' };
const NC_GRADE_LABEL = { critical: '치명', major: '중대', minor: '경미' };
async function ncNew(pre = {}) {
  const due = (() => { const d = new Date(Date.parse(todayStr()) + 30 * 86400000); return d.toISOString().slice(0, 10); })();
  const v = await promptBox('부적합·CAPA 등록', `${pre.source_no ? `<p class="small">출처 <b>${esc(NC_SOURCE_LABEL[pre.source_type] || '')} ${esc(pre.source_no)}</b>에서 등록합니다.</p>` : ''}<div class="form-grid">
    ${pre.source_no ? '' : `<label>출처<select name="source_type">${Object.entries(NC_SOURCE_LABEL).map(([k, l]) => `<option value="${k}"${pre.source_type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`}
    <label>유형<select name="kind">${['OOS', 'OOT', '공정 이상', '고객 불만', '심사 지적', '기타'].map(k => `<option${(pre.kind || 'OOS') === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
    <label>등급<select name="grade">${Object.entries(NC_GRADE_LABEL).map(([k, l]) => `<option value="${k}"${k === 'minor' ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="span3">부적합 내용(제목) *<input name="title" required maxlength="200" value="${esc(pre.title || '')}"></label>
    <label class="span3">상세<textarea name="detail" rows="2" maxlength="2000" placeholder="무엇이 규격·기준을 벗어났는지(측정값·수량·발견 경위)"></textarea></label>
    <label>품목<input name="item" maxlength="200" value="${esc(pre.item || '')}"></label><label>LOT<input name="lot" maxlength="100" value="${esc(pre.lot || '')}"></label><label>수량<input type="number" step="any" name="qty"></label>
    <label>발생일 *<input type="date" name="found_date" required value="${todayStr()}"></label><label>담당자<input name="owner_name" maxlength="50" value="${esc(ME?.name || '')}"></label><label>조치 기한 <span class="hint">(기본 30일)</span><input type="date" name="due_date" value="${due}"></label>
    <label class="span3">즉시 조치(격리·선별 등)<input name="containment" maxlength="1000" placeholder="예) 해당 LOT 출하 보류·격리, 재고 전수 선별"></label></div>`, { wide: true,
    submit: async vals => api('POST', '/api/ncs', { ...pre, ...vals, request_id: crypto.randomUUID() }) });
  if (!v) return null; toast(`${v.nc_no}을(를) 등록했습니다. 원인분석부터 진행하세요.`); document.querySelector('#main')?.ncReload?.(); await ncOpen(v.id); return v;
}
async function ncOpen(id) {
  const list = await api('GET', '/api/ncs'), n = list.rows.find(x => x.id === id); if (!n) return toast('찾을 수 없습니다.', 'err');
  const can = list.can_manage, closed = ['closed', 'void'].includes(n.status), ro = !can || closed, dis = ro ? ' disabled' : '', c = n.cause || {};
  const next = NC_FLOW.at(NC_FLOW.indexOf(n.status) + 1), stepper = NC_FLOW.map((s, i) => `<span class="nc-step${s === n.status ? ' on' : NC_FLOW.indexOf(n.status) > i || n.status === 'closed' ? ' done' : ''}">${i + 1}. ${NC_STATUS_LABEL[s]}</span>`).join('<span class="nc-arrow">→</span>');
  const f = (name, label, val, attrs = '') => `<label>${label}<input name="${name}" value="${esc(val ?? '')}"${attrs}${dis}></label>`;
  const ta = (name, label, val, span = 'span3') => `<label class="${span}">${label}<textarea name="${name}" rows="2" maxlength="1000"${dis}>${esc(val || '')}</textarea></label>`;
  const m = modal(`<h3>${esc(n.nc_no)} · ${esc(n.title)} <span class="chip ${NC_STATUS_CHIP[n.status] || ''}">${esc(n.status_label)}</span></h3>
    <div class="nc-stepper">${stepper}</div>
    <p class="small muted">출처 ${esc(n.source_label)}${n.source_no ? ` · <b>${esc(n.source_no)}</b>` : ''} · 등록 ${esc(n.created_by)} ${esc(String(n.created_at).slice(0, 10))}${n.closed_by ? ` · 종결 ${esc(n.closed_by)} ${esc(String(n.closed_at || '').slice(0, 10))}` : ''}</p>
    <form class="stack" data-nc-form>
      <fieldset class="vendor-sec"><legend>부적합 내용</legend><div class="form-grid">
        <label>유형<select name="kind"${dis}>${['OOS', 'OOT', '공정 이상', '고객 불만', '심사 지적', '기타'].map(k => `<option${n.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
        <label>등급<select name="grade"${dis}>${Object.entries(NC_GRADE_LABEL).map(([k, l]) => `<option value="${k}"${n.grade === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${f('found_date', '발생일', n.found_date, " type='date'")}
        <label class="span3">제목<input name="title" required maxlength="200" value="${esc(n.title)}"${dis}></label>${ta('detail', '상세', n.detail)}
        ${f('item', '품목', n.item)}${f('lot', 'LOT', n.lot)}${f('qty', '수량', n.qty, " type='number' step='any'")}
        ${f('owner_name', '담당자', n.owner_name)}${f('due_date', '조치 기한', n.due_date, " type='date'")}${ta('containment', '즉시 조치(격리·선별)', n.containment, 'span2')}
      </div></fieldset>
      <fieldset class="vendor-sec"><legend>원인분석 <span class="hint">(5Why 또는 4M — 하나 이상)</span></legend><div class="form-grid">
        ${['why1', 'why2', 'why3', 'why4', 'why5'].map((k, i) => `<label class="span3">Why ${i + 1}<input data-cause="${k}" maxlength="300" value="${esc(c[k] || '')}"${dis}></label>`).join('')}
        ${[['man', '사람'], ['machine', '설비'], ['material', '자재'], ['method', '방법'], ['env', '환경']].map(([k, l]) => `<label>${l}<input data-cause="${k}" maxlength="300" value="${esc(c[k] || '')}"${dis}></label>`).join('')}
        <label class="span3">근본 원인<input data-cause="root" maxlength="300" value="${esc(c.root || '')}"${dis}></label></div></fieldset>
      <fieldset class="vendor-sec"><legend>조치</legend><div class="form-grid">${ta('correction', '시정(이번 건 처리: 재작업·폐기·특채 등)', n.correction)}${ta('corrective', '시정조치(재발 방지)', n.corrective)}${ta('preventive', '예방조치(다른 품목·공정에도)', n.preventive)}${f('action_date', '조치 완료일', n.action_date, " type='date'")}</div></fieldset>
      <fieldset class="vendor-sec"><legend>유효성검증</legend><div class="form-grid">${f('verify_date', '검증일', n.verify_date, " type='date'")}<label>결과<select name="verify_result"${dis}><option value="">—</option><option${n.verify_result === '유효' ? ' selected' : ''}>유효</option><option${n.verify_result === '효과 없음' ? ' selected' : ''}>효과 없음</option></select></label>${ta('verify_note', '검증 내용(재발 여부·확인 데이터)', n.verify_note, 'span3')}</div></fieldset>
      <div class="actions"><button type="button" class="btn" data-nc-hist>이력</button><button type="button" class="btn" data-nc-8d>8D 보고서</button>${can && !closed ? '<button type="button" class="btn danger" data-nc-void>취소</button><span class="grow"></span><button class="btn">저장</button>' : ''}${can && !closed && next && next !== 'closed' ? `<button type="button" class="btn primary" data-nc-next="${next}">저장하고 「${NC_STATUS_LABEL[next]}」로 →</button>` : ''}${list.can_close && n.status === 'verify' ? '<button type="button" class="btn primary" data-nc-next="closed">종결</button>' : ''}${list.can_close && closed ? '<button type="button" class="btn" data-nc-reopen>다시 열기</button>' : ''}${can && ['action', 'verify', 'closed'].includes(n.status) ? '<button type="button" class="btn" data-nc-chg title="조치가 4M(사람·설비·자재·방법) 변경이면 변경관리로">변경 요청 만들기</button>' : ''}</div>
    </form>`, { wide: true });
  const form = $('[data-nc-form]', m.el);
  const body = () => { const v = formObj(form); v.cause_json = Object.fromEntries($$('[data-cause]', form).map(i => [i.dataset.cause, i.value.trim()]).filter(([, x]) => x)); return { ...v, revision: n.revision }; };
  const save = async (status, extra = {}) => { try { await api('PUT', `/api/ncs/${n.id}`, { ...body(), ...(status ? { status } : {}), ...extra }); toast(status ? `「${NC_STATUS_LABEL[status]}」 단계로 넘겼습니다.` : '저장했습니다.'); m.close(); document.querySelector('#main')?.ncReload?.(); await ncOpen(n.id); } catch (e) { fail(e); } };
  form.onsubmit = e => { e.preventDefault(); save(null); };
  $('[data-nc-next]', m.el)?.addEventListener('click', e => save(e.currentTarget.dataset.ncNext));
  $('[data-nc-void]', m.el)?.addEventListener('click', async () => { const v = await promptBox('부적합 취소', '<label>취소 사유 *<input name="reason" required maxlength="300" placeholder="예) 측정 오류로 확인 — 실제 부적합 아님"></label>'); if (v) save('void', v); });
  $('[data-nc-reopen]', m.el)?.addEventListener('click', async () => { const v = await promptBox('다시 열기', '<label>사유 *<input name="reason" required maxlength="300"></label>'); if (v) save('verify', v); });
  $('[data-nc-chg]', m.el)?.addEventListener('click', () => { m.close(); chgNew({ source_type: 'capa', source_id: n.id, source_no: n.nc_no, title: n.corrective || n.title, item: n.item, kind: 'method' }).catch(fail); }); // 15.306 CAPA → 변경관리
  $('[data-nc-8d]', m.el).onclick = () => nc8D(n).catch(fail); // 15.312
  $('[data-nc-hist]', m.el).onclick = () => modal(`<h3>이력 · ${esc(n.nc_no)}</h3><div class="table-wrap"><table class="grid"><thead><tr><th>일시</th><th>담당</th><th>내용</th></tr></thead><tbody>${[...n.history].reverse().map(h => `<tr><td class="nowrap">${esc(String(h.at || '').slice(0, 16))}</td><td>${esc(h.by || '')}</td><td>${esc(h.what || '')}${h.status ? ` · ${esc(NC_STATUS_LABEL[h.status[0]] || '')} → ${esc(NC_STATUS_LABEL[h.status[1]] || '')}` : ''}${(h.fields || []).length ? ` · ${h.fields.length}칸` : ''}${h.reason ? ` · ${esc(h.reason)}` : ''}${h.source ? ` · 출처 ${esc(h.source)}` : ''}</td></tr>`).join('')}</tbody></table></div>`, { wide: true });
}
async function pageNcs(main) {
  main.innerHTML = `<h1>부적합·CAPA <span class="dept">품질</span></h1>
  <p class="muted">수입·출하검사 불합격, 분석 불합격, 공정 이상, 고객 불만(VOC), 심사 지적을 한곳에 모아 <b>등록 → 원인분석 → 조치 → 유효성검증 → 종결</b>로 관리합니다. 검사·분석·VOC 창의 「CAPA 등록」으로도 바로 등록됩니다. 종결은 유효성검증이 「유효」일 때 품질책임자가 합니다.</p>
  <div class="ip-tiles" id="ncTiles"></div>
  <form class="toolbar list-filters" data-read-only id="ncFilters"><label class="lf-sel">단계<select name="st"><option value="live">진행 중(종결·취소 빼고)</option><option value="">전체</option>${Object.entries(NC_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">출처<select name="src"><option value="">전체</option>${Object.entries(NC_SOURCE_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="list-search">찾기<input type="search" name="q" placeholder="번호·내용·품목·LOT·출처 번호·담당"></label><span class="grow"></span><span id="ncTools" class="ip-tools"></span></form>
  <div id="ncList"></div>`;
  const form = $('#ncFilters', main); let data = { rows: [], today: todayStr() };
  const load = async () => { data = await api('GET', '/api/ncs'); if (main.isConnected) draw(); };
  main.ncReload = () => load().catch(fail);
  const live = r => !['closed', 'void'].includes(r.status), over = r => live(r) && r.due_date && r.due_date < data.today;
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows;
    $('#ncTiles', main).innerHTML = [['진행 중', all.filter(live).length, ''], ['기한 지남', all.filter(over).length, all.some(over) ? 'red' : ''], ['원인분석', all.filter(r => r.status === 'analysis').length, ''], ['조치', all.filter(r => r.status === 'action').length, ''], ['유효성검증', all.filter(r => r.status === 'verify').length, ''], ['종결', all.filter(r => r.status === 'closed').length, 'green']].map(([l, n, c], i) => `<button type="button" class="ip-tile ${c}" data-nc-tile="${i}"><span>${l}</span><b>${n}</b></button>`).join('');
    $('#ncTools', main).innerHTML = data.can_manage ? '<button type="button" class="btn primary" id="ncNewBtn">＋ 부적합 등록</button>' : '';
    const rows = all.filter(r => (v.st === 'live' ? live(r) : !v.st || r.status === v.st) && (!v.src || r.source_type === v.src) && (!q || [r.nc_no, r.title, r.item, r.lot, r.source_no, r.owner_name].join(' ').toLowerCase().includes(q)));
    $('#ncList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>출처</th><th>유형 · 등급</th><th>부적합 내용</th><th>품목 · LOT</th><th>발생일</th><th>담당</th><th>조치 기한</th><th>단계</th><th></th></tr></thead><tbody>${rows.map(r => { const d = r.due_date && live(r) ? ipDday(r.due_date, data.today) : null, cls = d === null ? '' : d < 0 ? 'over' : d <= 7 ? 'soon' : '';
      return `<tr data-nc-row="${r.id}" class="${cls ? 'ip-' + cls : ''}${r.status === 'void' ? ' row-off' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.nc_no)}</b></td><td>${esc(r.source_label)}${r.source_no ? `<div class="small muted">${esc(r.source_no)}</div>` : ''}</td><td class="nowrap">${esc(r.kind)} <span class="chip ${r.grade === 'critical' ? 'red' : r.grade === 'major' ? 'yellow' : ''}">${esc(r.grade_label)}</span></td><td><b>${esc(r.title)}</b></td><td>${esc(r.item)}${r.lot ? `<div class="small muted">${esc(r.lot)}</div>` : ''}</td><td class="nowrap">${esc(r.found_date)}</td><td>${esc(r.owner_name)}</td><td class="nowrap">${esc(r.due_date || '')}${d !== null ? ` <span class="ip-dd ${cls}">${d < 0 ? `D+${-d}` : d === 0 ? 'D-DAY' : `D-${d}`}</span>` : ''}</td><td><span class="chip ${NC_STATUS_CHIP[r.status] || ''}">${esc(r.status_label)}</span></td><td><button type="button" class="btn small" data-nc-open="${r.id}">열기</button></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 부적합이 없습니다.' : '등록된 부적합이 없습니다. 검사·분석·VOC 창의 「CAPA 등록」이나 「＋ 부적합 등록」으로 시작합니다.'}</div>`;
  };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-nc-tile]'); if (t) { form.elements.st.value = ['live', 'live', 'analysis', 'action', 'verify', 'closed'].at(Number(t.dataset.ncTile)); draw(); if (t.dataset.ncTile === '1') { const rows = data.rows.filter(over); $('#ncList', main).querySelectorAll('[data-nc-row]').forEach(tr => { tr.hidden = !rows.some(r => r.id === Number(tr.dataset.ncRow)); }); } return; }
    if (e.target.closest('#ncNewBtn')) return ncNew().catch(fail);
    const o = e.target.closest('[data-nc-open]'); if (o) ncOpen(Number(o.dataset.ncOpen)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// ── 15.306 품질 2단계(QA 체계): 문서관리 · 변경관리 · 교육·자격관리 · 협력업체 품질 ──
const Q_FILE_TYPES = /^(application\/pdf|image\/(jpeg|png|webp))$/;
const qFileData = f => new Promise((resolve, reject) => {
  if (!Q_FILE_TYPES.test(f.type)) return reject(new Error(`「${f.name}」: PDF 또는 사진(jpg·png·webp)만 올릴 수 있습니다.`));
  if (f.size > 8 * 1024 * 1024) return reject(new Error(`「${f.name}」(${(f.size / 1024 / 1024).toFixed(1)}MB)은 8MB를 넘습니다. 줄여서 올리세요.`));
  const r = new FileReader(); r.onload = () => resolve({ data: r.result, name: f.name }); r.onerror = () => reject(new Error('파일을 읽지 못했습니다.')); r.readAsDataURL(f);
});
const qFiles = input => Promise.all([...(input?.files || [])].map(qFileData));
const qFileLink = (f, label = '') => f?.file ? `<a class="q-file" href="/uploads/${esc(f.file)}" target="_blank" rel="noopener" title="${esc(f.name || '')}"><span class="q-file-t">${f.file.endsWith('.pdf') ? 'PDF' : 'IMG'}</span>${esc(label || f.name || '파일')}</a>` : '';
const qDd = (d, today, on = true, warn = 30) => { const n = on ? ipDday(d, today) : null; if (n === null) return ''; const cls = n < 0 ? 'over' : n <= warn ? 'soon' : ''; return ` <span class="ip-dd ${cls}">${n < 0 ? `D+${-n}` : n === 0 ? 'D-DAY' : `D-${n}`}</span>`; };
const qStepper = (flow, labels, status) => `<div class="nc-stepper">${flow.map((s, i) => `<span class="nc-step${s === status ? ' on' : flow.indexOf(status) > i ? ' done' : ''}">${i + 1}. ${labels[s]}</span>`).join('<span class="nc-arrow">→</span>')}</div>`;
const qTiles = (id, list) => { const el = document.getElementById(id); if (el) el.innerHTML = list.map(([l, n, c], i) => `<button type="button" class="ip-tile ${c || ''}" data-q-tile="${i}"><span>${l}</span><b>${n}</b></button>`).join(''); };
function qHistory(title, hist, labels = {}) {
  modal(`<h3>이력 · ${esc(title)}</h3><div class="table-wrap"><table class="grid"><thead><tr><th>일시</th><th>담당</th><th>내용</th></tr></thead><tbody>${[...(hist || [])].reverse().map(h => `<tr><td class="nowrap">${esc(String(h.at || '').slice(0, 16))}</td><td>${esc(h.by || '')}</td><td>${esc(h.what || '')}${h.status ? ` · ${esc(labels[h.status[0]] || h.status[0])} → ${esc(labels[h.status[1]] || h.status[1])}` : ''}${(h.fields || []).length ? ` · ${h.fields.length}칸` : ''}${h.reason ? ` · ${esc(h.reason)}` : ''}${h.source ? ` · ${esc(h.source)}` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">이력이 없습니다.</td></tr>'}</tbody></table></div>`, { wide: true });
}
const qReload = () => document.querySelector('#main')?.qReload?.();

// A1 문서관리
const QDOC_KIND_LABEL = { manual: '품질 매뉴얼', procedure: '절차서', instruction: '지침서', form: '양식·서식', std: '규격(KS·ISO 등)', law: '법규', customer: '고객 요구서', ext_other: '기타 외부문서' };
const QDOC_INT = ['manual', 'procedure', 'instruction', 'form'];
const QDOC_STATUS_LABEL = { draft: '초안', review: '검토', approved: '승인·배포', obsolete: '폐지' };
const QDOC_CHIP = { draft: '', review: 'yellow', approved: 'green', obsolete: '' };
const qdocRev = d => d.internal ? `Rev.${d.rev}` : esc(d.edition || '—');
function qdocDeptBoxes(depts, chosen = []) {
  return `<fieldset class="vendor-sec q-depts"><legend>열람 부서 <span class="hint">(아무것도 고르지 않으면 전 부서. 품질은 항상 봄)</span></legend><div class="q-chk">${depts.map(d => `<label class="chk"><input type="checkbox" name="access_depts" value="${esc(d)}"${chosen.includes(d) ? ' checked' : ''}> ${esc(d)}</label>`).join('') || '<span class="muted small">조직(부서)이 아직 없습니다.</span>'}</div></fieldset>`;
}
const qdocVals = (form, extra = {}) => { const v = formObj(form); v.training_needed = (v.training_needed || []).length ? 1 : 0; v.access_depts = v.access_depts || []; return { ...v, ...extra }; };
async function qdocNew(pre = {}) {
  const list = await api('GET', '/api/qdocs');
  const ext = pre.scope === 'external';
  const kinds = Object.entries(QDOC_KIND_LABEL).filter(([k]) => QDOC_INT.includes(k) !== ext);
  let fileEl = null;
  const v = await promptBox(ext ? '외부문서 등록' : '문서 제정(초안)', `${pre.change_no ? `<p class="small">변경 <b>${esc(pre.change_no)}</b>에 연결합니다.</p>` : ''}<div class="form-grid">
    <label>종류 *<select name="kind">${kinds.map(([k, l]) => `<option value="${k}"${(pre.kind || (ext ? 'std' : 'procedure')) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>문서번호 <span class="hint">(비우면 자동: QP-01·EX-01…)</span><input name="doc_no" maxlength="40" placeholder="${ext ? '예) KS K 0901' : '예) QP-07'}"></label>
    <label class="span3">제목 *<input name="title" required maxlength="200" value="${esc(pre.title || '')}"></label>
    ${ext ? `<label>발행처 *<input name="issuer" required maxlength="100" placeholder="국가기술표준원 · ISO · 고객사"></label><label>판·연도<input name="edition" maxlength="60" placeholder="예) 2024 · 3판"></label><label>시행·발행일<input type="date" name="effective_date" value="${todayStr()}"></label>` : ''}
    <label>주관 부서<input name="dept" maxlength="50" list="qdDepts" value="${esc(pre.dept || '품질')}"><datalist id="qdDepts">${list.depts.map(d => `<option value="${esc(d)}">`).join('')}</datalist></label>
    <label>담당자<input name="owner_name" maxlength="50" value="${esc(ME?.name || '')}"></label>
    <label>보존기간(년) <span class="hint">(0 = 영구)</span><input type="number" name="retention_years" min="0" max="99" value="3"></label>
    <label>검토 주기(개월) <span class="hint">(0 = 없음)</span><input type="number" name="review_months" min="0" max="60" value="${ext ? 12 : 12}"></label>
    <label class="span2">파일 (PDF·사진, 8MB)<input type="file" data-q-file accept="application/pdf,image/jpeg,image/png,image/webp"></label>
    ${ext ? '' : '<label class="chk span3"><input type="checkbox" name="training_needed" value="1"> 승인·배포 뒤 교육 필요(개정 교육)</label>'}
    <label class="span3">메모<input name="note" maxlength="1000"></label></div>${qdocDeptBoxes(list.depts)}`, { wide: true,
    onOpen: el => { fileEl = $('[data-q-file]', el); },
    submit: async vals => { const files = await qFiles(fileEl); const v2 = { ...vals, training_needed: (vals.training_needed || []).length ? 1 : 0, access_depts: vals.access_depts || [] }; return api('POST', '/api/qdocs', { ...v2, files, change_id: pre.change_id || null, request_id: crypto.randomUUID() }); } });
  if (!v) return null; toast(`${v.doc_no} ${ext ? '외부문서를 등록했습니다.' : '초안을 만들었습니다. 파일을 올리고 검토를 요청하세요.'}`); qReload(); await qdocOpen(v.id); return v;
}
async function qdocOpen(id) {
  const list = await api('GET', '/api/qdocs'), d = list.rows.find(x => x.id === id); if (!d) return toast('문서를 찾을 수 없습니다.', 'err');
  const can = list.can_manage, appr = list.can_approve, locked = d.internal && d.status !== 'draft' || d.status === 'obsolete', dis = !can || locked ? ' disabled' : '', mdis = !can || d.status === 'obsolete' ? ' disabled' : '';
  const flow = ['draft', 'review', 'approved'];
  const m = modal(`<h3>${esc(d.doc_no)} · ${esc(d.title)} <span class="chip ${QDOC_CHIP[d.status]}">${esc(d.status_label)}</span></h3>
    ${d.internal ? qStepper(flow, QDOC_STATUS_LABEL, d.status) : ''}
    <p class="small muted">${esc(d.kind_label)} · ${qdocRev(d)}${d.current ? ` · 현행 ${d.internal ? `Rev.${d.current.rev}` : esc(d.current.edition || '')} (${esc(d.current.effective_date || '')} 시행, 승인 ${esc(d.current.approved_by || '')})` : ' · 아직 승인된 판 없음'}${d.change_id ? ` · 변경 연결 #${d.change_id}` : ''}</p>
    ${d.current?.file ? `<p>현행판 내려받기: ${qFileLink(d.current.file)}</p>` : ''}
    <form class="stack" data-qd-form>
      <fieldset class="vendor-sec"><legend>문서 ${locked && can && d.status === 'review' ? '<span class="hint">(검토 중에는 내용·파일이 잠깁니다. 고치려면 품질책임자가 반려 → 초안)</span>' : locked && can && d.status !== 'obsolete' ? '<span class="hint">(승인된 판의 내용·파일은 「개정」으로 바꿉니다. 관리 정보는 고칠 수 있음)</span>' : ''}</legend><div class="form-grid">
        <label class="span3">제목<input name="title" required maxlength="200" value="${esc(d.title)}"${dis}></label>
        <input type="hidden" name="kind" value="${esc(d.kind)}">
        ${d.internal ? '' : `<label>발행처<input name="issuer" maxlength="100" value="${esc(d.issuer)}"${dis}></label><label>판·연도<input name="edition" maxlength="60" value="${esc(d.edition)}"${dis}></label><label>시행·발행일<input type="date" name="effective_date" value="${esc(d.effective_date || '')}"${dis}></label>`}
        <label>주관 부서<input name="dept" maxlength="50" value="${esc(d.dept)}"${mdis}></label><label>담당자<input name="owner_name" maxlength="50" value="${esc(d.owner_name)}"${mdis}></label>
        <label>보존기간(년)<input type="number" name="retention_years" min="0" max="99" value="${d.retention_years}"${mdis}></label>
        <label>검토 주기(개월)<input type="number" name="review_months" min="0" max="60" value="${d.review_months}"${mdis}></label>
        <label>다음 검토일${qDd(d.next_review, list.today, d.status === 'approved')}<input type="date" name="next_review" value="${esc(d.next_review || '')}"${mdis}></label>
        <label>폐기 예정일<input type="date" name="dispose_date" value="${esc(d.dispose_date || '')}"${mdis}></label>
        ${d.internal ? `<label class="span3">${d.rev ? `Rev.${d.rev} 개정 내용 *` : '제정 내용·목적'}<textarea name="summary" rows="2" maxlength="1000"${dis}>${esc(d.summary)}</textarea></label>` : ''}
        ${can && !locked ? `<label class="span2">${d.file ? '파일 바꾸기' : '파일 올리기'} (PDF·사진, 8MB)<input type="file" data-q-file accept="application/pdf,image/jpeg,image/png,image/webp"></label>` : ''}
        ${can && d.file ? `<div class="span3 small">작업 파일: ${qFileLink(d.file)}</div>` : ''}
        ${d.internal ? `<label class="chk span3"><input type="checkbox" name="training_needed" value="1"${d.training_needed ? ' checked' : ''}${mdis}> 승인·배포 뒤 교육 필요(개정 교육)</label>` : ''}
        <label class="span3">메모<input name="note" maxlength="1000" value="${esc(d.note)}"${mdis}></label>
      </div></fieldset>
      ${can ? qdocDeptBoxes(list.depts, d.access_depts).replace(/<input type="checkbox"/g, `<input type="checkbox"${mdis}`) : `<p class="small muted">열람 부서: ${d.access_depts.length ? d.access_depts.map(esc).join(', ') : '전 부서'}</p>`}
      ${d.versions.length ? `<fieldset class="vendor-sec"><legend>${d.internal ? '제·개정 이력' : '판 이력'}</legend><div class="table-wrap"><table class="grid"><thead><tr><th>판</th><th>시행일</th><th>승인·등록</th><th>내용</th>${can ? '<th>파일</th>' : ''}</tr></thead><tbody>${[...d.versions].reverse().map((v, i) => `<tr${i ? ' class="row-off"' : ''}><td class="nowrap">${d.internal ? `Rev.${v.rev}` : esc(v.edition || '—')}${i ? '' : ' <span class="chip green">현행</span>'}</td><td class="nowrap">${esc(v.effective_date || '')}</td><td class="nowrap">${esc(v.approved_by || '')} ${esc(String(v.approved_at || '').slice(0, 10))}</td><td>${esc(v.summary || '')}</td>${can ? `<td>${qFileLink(v.file)}</td>` : ''}</tr>`).join('')}</tbody></table></div></fieldset>` : ''}
      <div class="actions"><button type="button" class="btn" data-qd-hist>이력</button>
        ${can && d.status === 'draft' && !d.versions.length ? '<button type="button" class="btn danger" data-qd-del>삭제</button>' : ''}
        ${appr && d.status !== 'obsolete' ? '<button type="button" class="btn danger" data-qd-step="obsolete">폐지</button>' : ''}
        <span class="grow"></span>
        ${can && d.status !== 'obsolete' ? '<button class="btn">저장</button>' : ''}
        ${can && d.internal && d.status === 'draft' ? '<button type="button" class="btn primary" data-qd-step="review">저장하고 검토 요청 →</button>' : ''}
        ${appr && d.status === 'review' ? '<button type="button" class="btn" data-qd-step="draft">반려</button><button type="button" class="btn primary" data-qd-step="approved">승인·배포</button>' : ''}
        ${can && d.internal && d.status === 'approved' ? '<button type="button" class="btn" data-qd-train>개정 교육 계획</button><button type="button" class="btn primary" data-qd-step="revise">개정 시작</button>' : ''}
      </div></form>`, { wide: true });
  const form = $('[data-qd-form]', m.el);
  const save = async () => { const files = await qFiles($('[data-q-file]', form)); const r = await api('PUT', `/api/qdocs/${d.id}`, { ...qdocVals(form), files, revision: d.revision }); return r; };
  const reopen = async () => { m.close(); qReload(); await qdocOpen(d.id); };
  form.onsubmit = async e => { e.preventDefault(); try { await save(); toast('저장했습니다.'); await reopen(); } catch (err) { fail(err); } };
  $('[data-qd-hist]', m.el).onclick = () => qHistory(d.doc_no, d.history, QDOC_STATUS_LABEL);
  $('[data-qd-del]', m.el)?.addEventListener('click', async () => { if (!await confirmBox(`${d.doc_no} 초안을 지울까요?`)) return; try { await api('DELETE', `/api/qdocs/${d.id}?revision=${d.revision}`); toast('지웠습니다.'); m.close(); qReload(); } catch (err) { fail(err); } });
  $('[data-qd-train]', m.el)?.addEventListener('click', () => { m.close(); trNew({ doc_id: d.id, doc_label: `${d.doc_no} Rev.${d.current?.rev ?? d.rev} ${d.title}`, kind: '문서 개정 교육', title: `${d.doc_no} ${d.title} Rev.${d.current?.rev ?? d.rev} 개정 교육`, change_id: d.change_id }).catch(fail); });
  $$('[data-qd-step]', m.el).forEach(b => b.addEventListener('click', async () => {
    const to = b.dataset.qdStep;
    try {
      let rev = d.revision, extra = {};
      if (to === 'review') { const saved = await save(); rev = saved.revision; }
      if (to === 'draft' || to === 'obsolete') { const v = await promptBox(to === 'draft' ? '반려' : '문서 폐지', `<label>${to === 'draft' ? '반려' : '폐지'} 사유 *<input name="reason" required maxlength="300"></label>${to === 'obsolete' && d.retention_years ? `<p class="small muted">폐기 예정일은 오늘부터 보존기간 ${d.retention_years}년 뒤로 잡힙니다.</p>` : ''}`); if (!v) return; extra = v; }
      if (to === 'revise') { const v = await promptBox(`${d.doc_no} 개정 시작 (Rev.${d.rev + 1})`, '<p class="small muted">현행판은 승인 전까지 그대로 배포됩니다. 개정본 파일을 올리고 검토를 요청하세요.</p><label>개정 내용 *<textarea name="summary" required rows="2" maxlength="1000" placeholder="무엇을 왜 바꾸는지"></textarea></label>'); if (!v) return; extra = { summary: v.summary }; }
      const r = await api('POST', `/api/qdocs/${d.id}/step`, { to: to === 'revise' ? 'draft' : to, revision: rev, ...extra });
      toast({ review: '검토를 요청했습니다.', approved: '승인·배포했습니다.', draft: '반려했습니다.', revise: `Rev.${r.rev} 개정을 시작했습니다.`, obsolete: '폐지했습니다.' }[to]);
      if (r.training_suggest && await confirmBox(`${r.doc_no} Rev.${r.rev} 개정 교육 계획을 지금 만들까요?`)) { m.close(); qReload(); return trNew({ doc_id: r.id, kind: '문서 개정 교육', title: `${r.doc_no} ${r.title} Rev.${r.rev} 개정 교육`, change_id: r.change_id }); }
      await reopen();
    } catch (err) { fail(err); }
  }));
}
async function pageQDocs(main) {
  main.innerHTML = `<h1>문서관리 <span class="dept">품질</span></h1>
  <p class="muted">내부문서(매뉴얼·절차서·지침서·양식)는 <b>초안 → 검토 → 승인·배포 → 폐지</b>로 관리하고, 개정하면 판(Rev)이 오르며 이전 판은 이력에 남습니다. 승인 전까지는 현행판이 그대로 배포됩니다. 외부문서(규격·법규·고객 요구서)는 대장으로 관리합니다. 열람 부서를 정하면 그 부서와 품질만 봅니다.</p>
  <div class="ip-tiles" id="qdTiles"></div>
  <form class="toolbar list-filters" data-read-only id="qdFilters">
    <label class="lf-sel">구분<select name="scope"><option value="">전체</option><option value="internal">내부문서</option><option value="external">외부문서</option></select></label>
    <label class="lf-sel">종류<select name="kind"><option value="">전체</option>${Object.entries(QDOC_KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <label class="lf-sel">상태<select name="st"><option value="live">폐지 빼고</option><option value="">전체</option>${Object.entries(QDOC_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="due">검토일 30일 안·지남</option></select></label>
    <label class="list-search">찾기<input type="search" name="q" placeholder="문서번호·제목·부서·담당·발행처"></label><span class="grow"></span><span id="qdTools" class="ip-tools"></span></form>
  <div id="qdList"></div>`;
  const form = $('#qdFilters', main); let data = { rows: [], today: todayStr() };
  const load = async () => { data = await api('GET', '/api/qdocs'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const due = r => r.status === 'approved' && r.next_review && ipDday(r.next_review, data.today) <= 30;
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows;
    qTiles('qdTiles', [['전체(폐지 빼고)', all.filter(r => r.status !== 'obsolete').length], ['승인·배포', all.filter(r => r.status === 'approved').length, 'green'], ['검토 대기', all.filter(r => r.status === 'review').length, all.some(r => r.status === 'review') ? 'yellow' : ''], ['초안·개정 중', all.filter(r => r.status === 'draft').length], ['검토일 30일 안·지남', all.filter(due).length, all.some(due) ? 'red' : '']]);
    $('#qdTools', main).innerHTML = data.can_manage ? '<button type="button" class="btn" id="qdExt">＋ 외부문서</button><button type="button" class="btn primary" id="qdNew">＋ 문서 제정</button>' : '';
    const rows = all.filter(r => (!v.scope || r.scope === v.scope) && (!v.kind || r.kind === v.kind) && (v.st === 'live' ? r.status !== 'obsolete' : v.st === 'due' ? due(r) : !v.st || r.status === v.st) && (!q || [r.doc_no, r.title, r.dept, r.owner_name, r.issuer].join(' ').toLowerCase().includes(q)));
    $('#qdList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>문서번호</th><th>제목</th><th>종류</th><th>판</th><th>주관 부서 · 담당</th><th>시행일</th><th>다음 검토</th><th>열람</th><th>상태</th><th>현행판</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-qd-row="${r.id}" class="${due(r) ? (ipDday(r.next_review, data.today) < 0 ? 'ip-over' : 'ip-soon') : ''}${r.status === 'obsolete' ? ' row-off' : ''}">
      <td class="nowrap" data-card-primary><b>${esc(r.doc_no)}</b></td><td><b>${esc(r.title)}</b>${r.internal ? '' : `<div class="small muted">${esc(r.issuer)}</div>`}</td><td class="nowrap">${esc(r.kind_label)}</td>
      <td class="nowrap">${qdocRev(r)}${r.internal && r.current && r.current.rev !== r.rev ? `<div class="small muted">현행 Rev.${r.current.rev}</div>` : ''}</td><td>${esc(r.dept)}${r.owner_name ? `<div class="small muted">${esc(r.owner_name)}</div>` : ''}</td>
      <td class="nowrap">${esc(r.current?.effective_date || r.effective_date || '')}</td><td class="nowrap">${esc(r.next_review || '')}${qDd(r.next_review, data.today, r.status === 'approved')}</td>
      <td class="small">${r.access_depts.length ? r.access_depts.map(esc).join(', ') : '<span class="muted">전 부서</span>'}</td><td><span class="chip ${QDOC_CHIP[r.status]}">${esc(r.status_label)}</span></td>
      <td>${r.current?.file ? qFileLink(r.current.file, '열기') : '<span class="muted small">—</span>'}</td><td><button type="button" class="btn small" data-qd-open="${r.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 문서가 없습니다.' : data.can_manage ? '등록된 문서가 없습니다. 「＋ 문서 제정」으로 품질 매뉴얼·절차서를, 「＋ 외부문서」로 KS·ISO 규격이나 고객 요구서를 넣으세요.' : '볼 수 있는 문서가 없습니다.'}</div>`;
  };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-q-tile]'); if (t) { form.elements.st.value = ['live', 'approved', 'review', 'draft', 'due'][Number(t.dataset.qTile)]; draw(); return; }
    if (e.target.closest('#qdNew')) return qdocNew().catch(fail);
    if (e.target.closest('#qdExt')) return qdocNew({ scope: 'external', kind: 'std' }).catch(fail);
    const o = e.target.closest('[data-qd-open]'); if (o) qdocOpen(Number(o.dataset.qdOpen)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// A2 변경관리
const CHG_KIND_LABEL = { man: '사람(Man)', machine: '설비(Machine)', material: '원자재(Material)', method: '방법(Method)', design: '설계', spec: '규격' };
const CHG_STATUS_LABEL = { requested: '요청', evaluating: '영향평가', approved: '승인', applied: '적용', verified: '검증완료', rejected: '반려', void: '취소' };
const CHG_CHIP = { requested: 'yellow', evaluating: 'yellow', approved: 'yellow', applied: 'yellow', verified: 'green', rejected: 'red', void: '' };
const CHG_FLOW = ['requested', 'evaluating', 'approved', 'applied', 'verified'];
const CHG_SOURCE_LABEL = { internal: '직접 요청', capa: 'CAPA 조치', supplier: '협력업체 변경점' };
const CHG_IMPACT_LABEL = { quality: '제품 품질·특성', customer: '고객 통보·승인(PCN)', docs: '문서 개정', validation: '재밸리데이션', training: '교육', inspection: '검사 기준·규격', stock: '재고·재공품 처리' };
async function chgNew(pre = {}) {
  const v = await promptBox(pre.source_type === 'supplier' ? '협력업체 변경점 접수' : '변경 요청', `${pre.source_no ? `<p class="small">출처 <b>${esc(CHG_SOURCE_LABEL[pre.source_type] || '')} ${esc(pre.source_no)}</b>에서 요청합니다.</p>` : ''}${pre.vendor ? `<p class="small">업체 <b>${esc(pre.vendor)}</b>의 변경 통보를 접수합니다.</p>` : ''}<div class="form-grid">
    <label>변경 유형 *<select name="kind">${Object.entries(CHG_KIND_LABEL).map(([k, l]) => `<option value="${k}"${(pre.kind || 'method') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>대상 품목·공정<input name="item" maxlength="200" value="${esc(pre.item || '')}"></label><label>적용 예정일<input type="date" name="plan_date"></label>
    <label class="span3">변경 내용(제목) *<input name="title" required maxlength="200" value="${esc(pre.title || '')}"></label>
    <label class="span3">사유<textarea name="reason" rows="2" maxlength="1000">${esc(pre.reason || '')}</textarea></label>
    <label class="span3">변경 전<input name="before_text" maxlength="1000" placeholder="예) 원단 A사 PET 80g"></label><label class="span3">변경 후<input name="after_text" maxlength="1000" placeholder="예) 원단 B사 PET 80g"></label></div>`, { wide: true,
    submit: async vals => api('POST', '/api/changes', { ...vals, source_type: pre.source_type || 'internal', source_id: pre.source_id || null, vendor: pre.vendor || '', request_id: crypto.randomUUID() }) });
  if (!v) return null; toast(`${v.change_no} 변경을 요청했습니다.${hasRole('quality') ? ' 영향평가를 진행하세요.' : ' 품질에서 영향평가 후 승인합니다.'}`); qReload(); if (hasRole('quality')) await chgOpen(v.id); return v;
}
async function chgOpen(id) {
  const list = await api('GET', '/api/changes'), c = list.rows.find(x => x.id === id); if (!c) return toast('변경을 찾을 수 없습니다.', 'err');
  const can = list.can_manage, mine = c.requester_name === list.me, end = ['verified', 'rejected', 'void'].includes(c.status), edit = !end && (can || (mine && c.status === 'requested')), dis = edit ? '' : ' disabled';
  const imp = c.impact || {}, f = (n, l, v, a = '') => `<label>${l}<input name="${n}" value="${esc(v ?? '')}"${a}${dis}></label>`;
  const cdis = ['approved', 'applied'].includes(c.status) ? ' disabled' : dis; /* 15.309 승인 뒤 내용·영향평가 잠금(적용·검증 칸만) */
  const next = { requested: 'evaluating', evaluating: 'approved', approved: 'applied', applied: 'verified' }[c.status];
  const m = modal(`<h3>${esc(c.change_no)} · ${esc(c.title)} <span class="chip ${CHG_CHIP[c.status]}">${esc(c.status_label)}</span></h3>
    ${qStepper(CHG_FLOW, CHG_STATUS_LABEL, c.status)}
    <p class="small muted">${esc(c.source_label)}${c.source_no ? ` · <b>${esc(c.source_no)}</b>` : ''}${c.vendor ? ` · 업체 <b>${esc(c.vendor)}</b>` : ''} · 요청 ${esc(c.requester_name)} ${esc(String(c.created_at).slice(0, 10))}${c.approved_by ? ` · 승인 ${esc(c.approved_by)} ${esc(String(c.approved_at || '').slice(0, 10))}` : ''}</p>
    <form class="stack" data-chg-form>
      <fieldset class="vendor-sec"><legend>변경 내용</legend><div class="form-grid">
        <label>변경 유형<select name="kind"${cdis}>${Object.entries(CHG_KIND_LABEL).map(([k, l]) => `<option value="${k}"${c.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>대상 품목·공정<input name="item" value="${esc(c.item || '')}"${cdis}></label>${f('owner_name', '담당', c.owner_name)}
        <label class="span3">제목<input name="title" required maxlength="200" value="${esc(c.title)}"${cdis}></label>
        <label class="span3">사유<textarea name="reason" rows="2" maxlength="1000"${cdis}>${esc(c.reason)}</textarea></label>
        <label class="span3">변경 전<input name="before_text" maxlength="1000" value="${esc(c.before_text)}"${cdis}></label><label class="span3">변경 후<input name="after_text" maxlength="1000" value="${esc(c.after_text)}"${cdis}></label>
      </div></fieldset>
      <fieldset class="vendor-sec"><legend>영향평가 <span class="hint">(모두 「있음/없음」을 골라야 승인)</span></legend><div class="table-wrap"><table class="grid chg-imp" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>항목</th><th>영향</th><th>조치·메모</th></tr></thead><tbody>${Object.entries(CHG_IMPACT_LABEL).map(([k, l]) => { const x = imp[k] || {}, idis = can && !end && !['approved', 'applied'].includes(c.status) ? '' : ' disabled'; return `<tr class="${x.v === 'yes' ? 'chg-yes' : ''}"><td class="nowrap">${l}</td><td class="nowrap"><label class="chk"><input type="radio" name="imp_${k}" value="yes"${x.v === 'yes' ? ' checked' : ''}${idis}> 있음</label> <label class="chk"><input type="radio" name="imp_${k}" value="no"${x.v === 'no' ? ' checked' : ''}${idis}> 없음</label></td><td><input name="impn_${k}" maxlength="300" value="${esc(x.note || '')}"${idis}></td></tr>`; }).join('')}</tbody></table></div>
        ${can && !end ? `<div class="actions wrap small">${imp.docs?.v === 'yes' ? '<button type="button" class="btn small" data-chg-doc>문서 개정 연결</button><button type="button" class="btn small" data-chg-newdoc>새 문서 제정</button>' : ''}${imp.training?.v === 'yes' ? '<button type="button" class="btn small" data-chg-train>교육 계획 만들기</button>' : ''}${imp.validation?.v === 'yes' ? '<button type="button" class="btn small" data-chg-val>밸리데이션 만들기</button>' : ''}</div>` : ''}
        ${c.docs.length || c.trainings.length ? `<p class="small">연결: ${c.docs.map(x => `<a href="#/quality/docs" data-chg-go-doc="${x.id}">${esc(x.doc_no)} Rev.${x.rev} (${esc(x.status_label)})</a>`).join(' · ')}${c.docs.length && c.trainings.length ? ' · ' : ''}${c.trainings.map(t => `<a href="#/quality/training" data-chg-go-tr="${t.id}">교육 ${esc(t.plan_date)} ${esc(t.title)}</a>`).join(' · ')}</p>` : ''}
      </fieldset>
      <fieldset class="vendor-sec"><legend>적용 · 검증</legend><div class="form-grid">
        ${f('plan_date', '적용 예정일', c.plan_date, " type='date'")}${f('apply_date', '적용일', c.apply_date, " type='date'")}${f('first_lot', '초물 LOT(변경 뒤 첫 LOT)', c.first_lot, " maxlength='100'")}
        ${f('verify_date', '검증일', c.verify_date, " type='date'")}<label>검증 결과<select name="verify_result"${dis}><option value="">—</option><option${c.verify_result === '유효' ? ' selected' : ''}>유효</option><option${c.verify_result === '효과 없음' ? ' selected' : ''}>효과 없음</option></select></label>
        <label class="span3">검증 내용(초물 검사·변경 전후 비교)<textarea name="verify_note" rows="2" maxlength="1000"${dis}>${esc(c.verify_note)}</textarea></label></div></fieldset>
      <div class="actions"><button type="button" class="btn" data-chg-hist>이력</button>${!end && (can || mine) ? '<button type="button" class="btn danger" data-chg-to="void">취소</button>' : ''}${list.can_approve && c.status === 'evaluating' ? '<button type="button" class="btn danger" data-chg-to="rejected">반려</button>' : ''}<span class="grow"></span>
        ${edit ? '<button class="btn">저장</button>' : ''}${can && next && (next !== 'approved' || list.can_approve) ? `<button type="button" class="btn primary" data-chg-to="${next}">${next === 'approved' ? '승인' : `저장하고 「${CHG_STATUS_LABEL[next]}」로 →`}</button>` : ''}</div>
    </form>`, { wide: true });
  const form = $('[data-chg-form]', m.el);
  const body = () => { const v = formObj(form), impact = {}; for (const k of Object.keys(CHG_IMPACT_LABEL)) { impact[k] = { v: v['imp_' + k] || '', note: v['impn_' + k] || '' }; delete v['imp_' + k]; delete v['impn_' + k]; } return { ...v, ...(can && !['approved', 'applied'].includes(c.status) ? { impact_json: impact } : {}), revision: c.revision }; };
  const save = async (status, extra = {}) => { try { const r = await api('PUT', `/api/changes/${c.id}`, { ...body(), ...(status ? { status } : {}), ...extra }); toast(status ? `「${CHG_STATUS_LABEL[status]}」(으)로 넘겼습니다.` : '저장했습니다.'); m.close(); qReload(); await chgOpen(c.id); return r; } catch (e) { fail(e); } };
  form.onsubmit = e => { e.preventDefault(); save(null); };
  $$('[data-chg-to]', m.el).forEach(b => b.addEventListener('click', async () => { const to = b.dataset.chgTo; if (['void', 'rejected'].includes(to)) { const v = await promptBox(to === 'void' ? '변경 취소' : '변경 반려', `<label>사유 *<input name="reason" required maxlength="300"></label>`); if (v) save(to, v); return; } save(to); }));
  $('[data-chg-hist]', m.el).onclick = () => qHistory(c.change_no, c.history, CHG_STATUS_LABEL);
  $('[data-chg-train]', m.el)?.addEventListener('click', () => { m.close(); trNew({ change_id: c.id, kind: '직무 교육', title: `${c.change_no} ${c.title} 변경 교육` }).catch(fail); });
  $('[data-chg-val]', m.el)?.addEventListener('click', () => { m.close(); valOpen(null, { change_id: c.id, change_no: c.change_no, title: `${c.change_no} ${c.title} 재밸리데이션`, kind: c.kind === 'machine' ? 'equipment' : c.kind === 'method' ? 'process' : 'process', target_type: c.kind === 'machine' ? 'equipment' : 'process', target_label: c.item }).catch(fail); }); // 15.308 A2 → A6
  $('[data-chg-newdoc]', m.el)?.addEventListener('click', () => { m.close(); qdocNew({ change_id: c.id, change_no: c.change_no, title: '' }).catch(fail); });
  $('[data-chg-doc]', m.el)?.addEventListener('click', async () => {
    const docs = (await api('GET', '/api/qdocs')).rows.filter(d => d.internal && d.status === 'approved');
    if (!docs.length) return toast('개정할 승인 문서가 없습니다. 「새 문서 제정」을 쓰세요.', 'err');
    const v = await promptBox('개정할 문서 고르기', `<label>문서 *<select name="doc">${docs.map(d => `<option value="${d.id}">${esc(d.doc_no)} Rev.${d.rev} ${esc(d.title)}</option>`).join('')}</select></label><label>개정 내용 *<textarea name="summary" required rows="2" maxlength="1000">${esc(`${c.change_no} ${c.title}`)}</textarea></label>`);
    if (!v) return; const d = docs.find(x => x.id === Number(v.doc));
    try { const r = await api('POST', `/api/qdocs/${d.id}/step`, { to: 'draft', summary: v.summary, change_id: c.id, revision: d.revision }); toast(`${r.doc_no} Rev.${r.rev} 개정을 시작했습니다(변경 ${c.change_no} 연결).`); m.close(); await qdocOpen(r.id); } catch (e) { fail(e); }
  });
  m.el.addEventListener('click', e => { const a = e.target.closest('[data-chg-go-doc]'); if (a) { e.preventDefault(); m.close(); qdocOpen(Number(a.dataset.chgGoDoc)).catch(fail); } const t = e.target.closest('[data-chg-go-tr]'); if (t) { e.preventDefault(); m.close(); trOpen(Number(t.dataset.chgGoTr)).catch(fail); } });
}
async function pageChanges(main) {
  main.innerHTML = `<h1>변경관리 <span class="dept">품질</span></h1>
  <p class="muted">사람·설비·원자재·방법(4M)과 설계·규격 변경을 <b>요청 → 영향평가 → 승인 → 적용(초물 LOT) → 검증완료</b>로 관리합니다. 누구나 요청할 수 있고, 영향평가·진행은 품질, 승인은 품질책임자가 합니다. CAPA 조치와 협력업체 변경점에서도 바로 요청됩니다.</p>
  <div class="ip-tiles" id="chgTiles"></div>
  <form class="toolbar list-filters" data-read-only id="chgFilters"><label class="lf-sel">단계<select name="st"><option value="live">진행 중</option><option value="">전체</option>${Object.entries(CHG_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">유형<select name="kind"><option value="">전체</option>${Object.entries(CHG_KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">출처<select name="src"><option value="">전체</option>${Object.entries(CHG_SOURCE_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="list-search">찾기<input type="search" name="q" placeholder="번호·내용·품목·업체·초물 LOT·요청자"></label><span class="grow"></span><span id="chgTools" class="ip-tools"></span></form>
  <div id="chgList"></div>`;
  const form = $('#chgFilters', main); let data = { rows: [] };
  const load = async () => { data = await api('GET', '/api/changes'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const live = r => !['verified', 'rejected', 'void'].includes(r.status);
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows;
    qTiles('chgTiles', [['진행 중', all.filter(live).length], ['요청', all.filter(r => r.status === 'requested').length, all.some(r => r.status === 'requested') ? 'yellow' : ''], ['영향평가', all.filter(r => r.status === 'evaluating').length], ['승인(적용 대기)', all.filter(r => r.status === 'approved').length], ['적용(검증 대기)', all.filter(r => r.status === 'applied').length], ['검증완료', all.filter(r => r.status === 'verified').length, 'green']]);
    $('#chgTools', main).innerHTML = '<button type="button" class="btn primary" id="chgNewBtn">＋ 변경 요청</button>';
    const rows = all.filter(r => (v.st === 'live' ? live(r) : !v.st || r.status === v.st) && (!v.kind || r.kind === v.kind) && (!v.src || r.source_type === v.src) && (!q || [r.change_no, r.title, r.item, r.vendor, r.first_lot, r.requester_name, r.source_no].join(' ').toLowerCase().includes(q)));
    $('#chgList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>출처</th><th>유형</th><th>변경 내용</th><th>대상 품목</th><th>요청</th><th>적용(예정)일</th><th>초물 LOT</th><th>영향</th><th>단계</th><th></th></tr></thead><tbody>${rows.map(r => { const yes = Object.entries(r.impact).filter(([, x]) => x.v === 'yes').map(([k]) => CHG_IMPACT_LABEL[k]);
      return `<tr data-chg-row="${r.id}" class="${['rejected', 'void'].includes(r.status) ? 'row-off' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.change_no)}</b></td><td>${esc(r.source_label)}${r.source_no || r.vendor ? `<div class="small muted">${esc(r.source_no || r.vendor)}</div>` : ''}</td><td class="nowrap">${esc(r.kind_label)}</td><td><b>${esc(r.title)}</b>${r.after_text ? `<div class="small muted">→ ${esc(r.after_text)}</div>` : ''}</td><td>${esc(r.item)}</td><td class="nowrap">${esc(r.requester_name)}<div class="small muted">${esc(String(r.created_at).slice(0, 10))}</div></td><td class="nowrap">${esc(r.apply_date || r.plan_date || '')}${!r.apply_date && r.plan_date ? ' <span class="small muted">예정</span>' : ''}</td><td>${esc(r.first_lot)}</td><td class="small">${yes.length ? yes.map(esc).join(', ') : '<span class="muted">—</span>'}</td><td><span class="chip ${CHG_CHIP[r.status]}">${esc(r.status_label)}</span></td><td><button type="button" class="btn small" data-chg-open="${r.id}">열기</button></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 변경이 없습니다.' : '등록된 변경이 없습니다. 원자재·설비·작업 방법을 바꿀 때 「＋ 변경 요청」으로 시작합니다.'}</div>`;
  };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-q-tile]'); if (t) { form.elements.st.value = ['live', 'requested', 'evaluating', 'approved', 'applied', 'verified'][Number(t.dataset.qTile)]; draw(); return; }
    if (e.target.closest('#chgNewBtn')) return chgNew().catch(fail);
    const o = e.target.closest('[data-chg-open]'); if (o) chgOpen(Number(o.dataset.chgOpen)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// A3 교육·자격관리
const TR_KINDS = ['OJT', '정기 교육', '직무 교육', '외부 교육', '문서 개정 교육', '법정 교육'];
const TR_STATUS_LABEL = { planned: '계획', done: '실시', evaluated: '평가완료', void: '취소' };
const TR_CHIP = { planned: 'yellow', done: 'yellow', evaluated: 'green', void: '' };
const QUAL_STATUS_LABEL = { valid: '유효', expired: '만료', withdrawn: '반납·취소' };
let qDirectory = null;
const qPeople = async () => (qDirectory ||= await api('GET', '/api/directory'));
function trPicker(people, chosen) {
  const by = {}; for (const p of people) (by[p.department || '부서 없음'] ||= []).push(p);
  return `<fieldset class="vendor-sec"><legend>교육 대상자 <span class="hint" data-tr-count></span></legend><div class="tr-pick">${Object.entries(by).map(([d, list]) => `<div class="tr-dept"><label class="chk tr-dept-h"><input type="checkbox" data-tr-dept="${esc(d)}"> <b>${esc(d)}</b></label>${list.map(p => `<label class="chk"><input type="checkbox" name="att" value="${esc(p.name)}" data-dept="${esc(d)}"${chosen.includes(p.name) ? ' checked' : ''}> ${esc(p.name)}${p.position ? ` <span class="muted small">${esc(p.position)}</span>` : ''}</label>`).join('')}</div>`).join('')}</div></fieldset>`;
}
function trBindPicker(el) {
  const count = () => { const n = $$('[name=att]:checked', el).length; const c = $('[data-tr-count]', el); if (c) c.textContent = `(${n}명)`; };
  el.addEventListener('change', e => { const d = e.target.closest('[data-tr-dept]'); if (d) $$(`[name=att][data-dept="${CSS.escape(d.dataset.trDept)}"]`, el).forEach(i => { i.checked = d.checked; }); count(); });
  count();
}
async function trNew(pre = {}) {
  const people = await qPeople();
  const v = await promptBox('교육 계획 등록', `${pre.doc_label ? `<p class="small">관련 문서 <b>${esc(pre.doc_label)}</b></p>` : ''}<div class="form-grid">
    <label class="span3">교육명 *<input name="title" required maxlength="200" value="${esc(pre.title || '')}"></label>
    <label>유형 *<select name="kind">${TR_KINDS.map(k => `<option${(pre.kind || '정기 교육') === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
    <label>예정일 *<input type="date" name="plan_date" required value="${todayStr()}"></label><label>시간(h)<input type="number" step="0.5" min="0.5" max="200" name="hours"></label>
    <label>강사<input name="instructor" maxlength="50" value="${esc(ME?.name || '')}"></label><label>장소<input name="place" maxlength="100"></label><label>평가 방법<input name="eval_method" maxlength="50" list="trEval"><datalist id="trEval"><option value="필기 시험"><option value="실기 확인"><option value="구두 확인"><option value="설문"></datalist></label>
    <label class="span3">교육 내용<textarea name="content" rows="2" maxlength="2000"></textarea></label></div>${trPicker(people, [])}`, { wide: true,
    onOpen: trBindPicker,
    submit: async vals => { const { att = [], ...rest } = vals; return api('POST', '/api/trainings', { ...rest, doc_id: pre.doc_id || null, change_id: pre.change_id || null, attendees: att.map(n => ({ user_name: n })), request_id: crypto.randomUUID() }); } });
  if (!v) return null; toast('교육 계획을 등록했습니다. 대상자는 「참석 확인」을 누를 수 있습니다.'); if (location.hash !== '#/quality/training') location.hash = '#/quality/training'; else qReload(); return v;
}
async function trOpen(id) {
  const list = await api('GET', '/api/trainings'), t = list.rows.find(x => x.id === id); if (!t) return toast('교육을 찾을 수 없습니다.', 'err');
  const can = list.can_manage && t.status !== 'void', dis = can ? '' : ' disabled', people = can ? await qPeople() : [];
  const me = t.attendees.find(a => a.user_name === list.me), next = { planned: 'done', done: 'evaluated' }[t.status];
  const f = (n, l, v, a = '') => `<label>${l}<input name="${n}" value="${esc(v ?? '')}"${a}${dis}></label>`;
  const m = modal(`<h3>${esc(t.title)} <span class="chip ${TR_CHIP[t.status]}">${esc(t.status_label)}</span></h3>
    ${qStepper(['planned', 'done', 'evaluated'], TR_STATUS_LABEL, t.status)}
    <p class="small muted">${esc(t.kind)}${t.doc_label ? ` · 관련 문서 ${esc(t.doc_label)}` : ''}${t.change_id ? ` · 변경 #${t.change_id}` : ''} · 등록 ${esc(t.created_by)}</p>
    ${me && !me.attended && ['planned', 'done'].includes(t.status) ? '<p><button type="button" class="btn primary" data-tr-attend>참석 확인(본인)</button></p>' : ''}
    <form class="stack" data-tr-form>
      <fieldset class="vendor-sec"><legend>교육</legend><div class="form-grid">
        <label class="span3">교육명<input name="title" required maxlength="200" value="${esc(t.title)}"${dis}></label>
        <label>유형<select name="kind"${dis}>${TR_KINDS.map(k => `<option${t.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
        ${f('plan_date', '예정일', t.plan_date, " type='date' required")}${f('done_date', '실시일', t.done_date, " type='date'")}${f('hours', '시간(h)', t.hours, " type='number' step='0.5' min='0.5'")}
        ${f('instructor', '강사', t.instructor)}${f('place', '장소', t.place)}${f('eval_method', '평가 방법', t.eval_method)}
        <label class="span3">교육 내용<textarea name="content" rows="2" maxlength="2000"${dis}>${esc(t.content)}</textarea></label></div></fieldset>
      <fieldset class="vendor-sec"><legend>대상자 · 참석 · 평가 <span class="hint">(${t.attendees.filter(a => a.attended).length}/${t.attendees.length}명 참석)</span></legend>
        <div class="table-wrap"><table class="grid tr-att" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>이름</th><th>부서</th><th>참석</th><th>본인 확인</th><th>점수</th><th>결과</th><th>메모</th>${can ? '<th></th>' : ''}</tr></thead><tbody>${t.attendees.map(a => `<tr data-att="${esc(a.user_name)}"><td class="nowrap"><b>${esc(a.user_name)}</b></td><td>${esc(a.dept)}</td><td><input type="checkbox" data-a-att${a.attended ? ' checked' : ''}${dis}></td><td class="small nowrap">${esc(String(a.confirmed_at || '').slice(0, 16))}</td><td><input type="number" min="0" max="100" step="any" data-a-score value="${a.score ?? ''}" class="tr-score"${dis}></td><td><select data-a-result${dis}>${['', '이수', '미이수', '재교육'].map(x => `<option value="${x}"${a.result === x ? ' selected' : ''}>${x || '—'}</option>`).join('')}</select></td><td><input data-a-note maxlength="300" value="${esc(a.note)}"${dis}></td>${can ? '<td><button type="button" class="btn small danger" data-a-del>×</button></td>' : ''}</tr>`).join('') || `<tr><td colspan="8" class="muted">대상자가 없습니다.</td></tr>`}</tbody></table></div>
        ${can ? '<div class="actions"><button type="button" class="btn small" data-tr-add>＋ 대상자 추가</button><button type="button" class="btn small" data-tr-allok>참석자 모두 「이수」</button></div>' : ''}</fieldset>
      <div class="actions"><button type="button" class="btn" data-tr-hist>이력</button><button type="button" class="btn" data-tr-rpt>결과 보고서</button>${can && t.status !== 'evaluated' ? '<button type="button" class="btn danger" data-tr-void>취소</button>' : ''}<span class="grow"></span>${can ? '<button class="btn">저장</button>' : ''}${can && next ? `<button type="button" class="btn primary" data-tr-next="${next}">저장하고 「${TR_STATUS_LABEL[next]}」로 →</button>` : ''}</div>
    </form>`, { wide: true });
  const form = $('[data-tr-form]', m.el);
  const atts = () => $$('[data-att]', form).map(tr => ({ user_name: tr.dataset.att, attended: $('[data-a-att]', tr).checked ? 1 : 0, score: $('[data-a-score]', tr).value, result: $('[data-a-result]', tr).value, note: $('[data-a-note]', tr).value }));
  const save = async (status, extra = {}) => { try { await api('PUT', `/api/trainings/${t.id}`, { ...formObj(form), attendees: atts(), ...(status ? { status } : {}), revision: t.revision, ...extra }); toast(status ? `「${TR_STATUS_LABEL[status]}」(으)로 넘겼습니다.` : '저장했습니다.'); m.close(); qReload(); await trOpen(t.id); } catch (e) { fail(e); } };
  form.onsubmit = e => { e.preventDefault(); save(null); };
  $('[data-tr-next]', m.el)?.addEventListener('click', e => { if (e.currentTarget.dataset.trNext === 'done' && !form.elements.done_date.value) form.elements.done_date.value = todayStr(); save(e.currentTarget.dataset.trNext); });
  $('[data-tr-void]', m.el)?.addEventListener('click', async () => { const v = await promptBox('교육 취소', '<label>사유 *<input name="reason" required maxlength="300"></label>'); if (v) save('void', v); });
  $('[data-tr-hist]', m.el).onclick = () => qHistory(t.title, t.history, TR_STATUS_LABEL);
  $('[data-tr-rpt]', m.el).onclick = () => trReport(t).catch(fail); // 15.312
  $('[data-tr-allok]', m.el)?.addEventListener('click', () => $$('[data-att]', form).forEach(tr => { if ($('[data-a-att]', tr).checked && !$('[data-a-result]', tr).value) $('[data-a-result]', tr).value = '이수'; }));
  form.addEventListener('click', e => { const d = e.target.closest('[data-a-del]'); if (d) d.closest('tr').remove(); });
  $('[data-tr-attend]', m.el)?.addEventListener('click', async () => { try { await api('POST', `/api/trainings/${t.id}/attend`); toast('참석을 확인했습니다.'); m.close(); qReload(); } catch (e) { fail(e); } });
  $('[data-tr-add]', m.el)?.addEventListener('click', async () => {
    const have = atts().map(a => a.user_name), v = await promptBox('대상자 추가', trPicker(people.filter(p => !have.includes(p.name)), []), { wide: true, onOpen: trBindPicker }); if (!v?.att?.length) return;
    const tb = $('.tr-att tbody', form); if (!have.length) tb.innerHTML = '';
    tb.insertAdjacentHTML('beforeend', v.att.map(n => `<tr data-att="${esc(n)}"><td class="nowrap"><b>${esc(n)}</b></td><td>${esc(people.find(p => p.name === n)?.department || '')}</td><td><input type="checkbox" data-a-att></td><td></td><td><input type="number" min="0" max="100" step="any" data-a-score class="tr-score"></td><td><select data-a-result>${['', '이수', '미이수', '재교육'].map(x => `<option value="${x}">${x || '—'}</option>`).join('')}</select></td><td><input data-a-note maxlength="300"></td><td><button type="button" class="btn small danger" data-a-del>×</button></td></tr>`).join(''));
    toast(`${v.att.length}명을 넣었습니다. 「저장」을 눌러야 반영됩니다.`);
  });
}
async function qualEdit(r = null, can = true) {
  const people = await qPeople(), v0 = r || { status: 'valid' };
  const v = await promptBox(r ? '자격 수정' : '자격 등록', `<div class="form-grid">
    <label>대상자 *<input name="user_name" required list="qlPeople" value="${esc(v0.user_name || '')}"><datalist id="qlPeople">${people.map(p => `<option value="${esc(p.name)}">${esc(p.department || '')}</option>`).join('')}</datalist></label>
    <label>자격명 *<input name="kind" required maxlength="100" list="qlKinds" value="${esc(v0.kind || '')}"><datalist id="qlKinds">${['수입검사원', '출하검사원', '공정검사원', '내부심사원(ISO 9001)', '내부심사원(ISO 14001)', '클린룸 작업자', '시험원(파티클)', '지게차 운전기능사', '품질경영기사', '품질경영산업기사'].map(x => `<option value="${x}">`).join('')}</datalist></label>
    <label>자격번호<input name="cert_no" maxlength="80" value="${esc(v0.cert_no || '')}"></label><label>발급처<input name="issuer" maxlength="100" value="${esc(v0.issuer || '')}" placeholder="사내 · 한국산업인력공단 · 인증기관"></label>
    <label>취득일<input type="date" name="acquired_date" value="${esc(v0.acquired_date || '')}"></label><label>만료일 <span class="hint">(없으면 비움)</span><input type="date" name="expire_date" value="${esc(v0.expire_date || '')}"></label>
    <label>상태<select name="status">${Object.entries(QUAL_STATUS_LABEL).map(([k, l]) => `<option value="${k}"${v0.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="span2">메모<input name="note" maxlength="500" value="${esc(v0.note || '')}"></label></div>`, { wide: true,
    submit: async vals => r ? api('PUT', `/api/qualifications/${r.id}`, { ...vals, revision: r.revision }) : api('POST', '/api/qualifications', { ...vals, request_id: crypto.randomUUID() }) });
  if (v) { toast('저장했습니다.'); qReload(); }
}
async function pageTraining(main) {
  const tab0 = sessionStorage.getItem('qTrTab') || 'plan';
  main.innerHTML = `<h1>교육·자격관리 <span class="dept">품질</span></h1>
  <p class="muted">연간 교육 계획(OJT·정기·직무·외부·문서 개정 교육)과 실적(참석·시간·평가), 개인별 교육 이력, 검사원·심사원 등 자격의 만료일을 관리합니다. 교육 대상자는 본인이 「참석 확인」을 누릅니다.</p>
  <div class="seg q-tabs" id="trTabs"><button type="button" data-tab="plan">교육 계획·실적</button><button type="button" data-tab="people">개인별 이력</button><button type="button" data-tab="qual">자격 관리</button></div>
  <div class="ip-tiles" id="trTiles"></div>
  <form class="toolbar list-filters" data-read-only id="trFilters"><label class="lf-sel">연도<select name="year"></select></label><label class="lf-sel" data-only="plan">상태<select name="st"><option value="">전체</option>${Object.entries(TR_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="mine">내 참석 확인 대기</option></select></label><label class="list-search">찾기<input type="search" name="q" placeholder="교육명·강사·대상자·자격명"></label><span class="grow"></span><span id="trTools" class="ip-tools"></span></form>
  <div id="trList"></div>`;
  const form = $('#trFilters', main); let tab = tab0, tr = { rows: [] }, ql = { rows: [] };
  const load = async () => { [tr, ql] = await Promise.all([api('GET', '/api/trainings'), api('GET', '/api/qualifications')]); if (!main.isConnected) return;
    const ys = [...new Set([todayStr().slice(0, 4), ...tr.rows.map(r => r.plan_date.slice(0, 4))])].sort().reverse(), cur = form.elements.year.value || todayStr().slice(0, 4);
    form.elements.year.innerHTML = ys.map(y => `<option${y === cur ? ' selected' : ''}>${y}</option>`).join('') + '<option value="">전체</option>'; draw(); };
  main.qReload = () => load().catch(fail);
  const waitMine = r => ['planned', 'done'].includes(r.status) && r.attendees.some(a => a.user_name === tr.me && !a.attended);
  const draw = () => {
    $$('#trTabs button', main).forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); $$('[data-only]', form).forEach(x => { x.hidden = x.dataset.only !== tab; });
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), yr = r => !v.year || String(r).startsWith(v.year);
    const rows = tr.rows.filter(r => yr(r.plan_date));
    if (tab === 'plan') {
      qTiles('trTiles', [['계획', rows.filter(r => r.status === 'planned').length, ''], ['실시', rows.filter(r => r.status === 'done').length, ''], ['평가완료', rows.filter(r => r.status === 'evaluated').length, 'green'], ['교육 시간 합(h)', rows.filter(r => r.status !== 'void').reduce((s, r) => s + (r.hours || 0) * r.attendees.filter(a => a.attended).length, 0)], ['내 참석 확인 대기', tr.rows.filter(waitMine).length, tr.rows.some(waitMine) ? 'yellow' : '']]);
      $('#trTools', main).innerHTML = tr.can_manage ? '<button type="button" class="btn primary" id="trNewBtn">＋ 교육 계획</button>' : '';
      const list = rows.filter(r => (v.st === 'mine' ? waitMine(r) : !v.st || r.status === v.st) && (!q || [r.title, r.instructor, r.kind, r.doc_label, ...r.attendees.map(a => a.user_name)].join(' ').toLowerCase().includes(q)));
      $('#trList', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>예정일</th><th>교육명</th><th>유형</th><th>강사</th><th>참석 / 대상</th><th>시간</th><th>실시일</th><th>관련 문서</th><th>상태</th><th></th></tr></thead><tbody>${list.map(r => `<tr data-tr-row="${r.id}" class="${r.status === 'void' ? 'row-off' : r.status === 'planned' && r.plan_date < tr.today ? 'ip-over' : ''}"><td class="nowrap">${esc(r.plan_date)}</td><td data-card-primary><b>${esc(r.title)}</b></td><td class="nowrap">${esc(r.kind)}</td><td>${esc(r.instructor)}</td><td class="nowrap">${r.attendees.filter(a => a.attended).length} / ${r.attendees.length}</td><td>${r.hours ?? ''}</td><td class="nowrap">${esc(r.done_date || '')}</td><td class="small">${esc(r.doc_label)}</td><td><span class="chip ${TR_CHIP[r.status]}">${esc(r.status_label)}</span></td><td class="nowrap">${waitMine(r) ? `<button type="button" class="btn small primary" data-tr-att="${r.id}">참석 확인</button> ` : ''}<button type="button" class="btn small" data-tr-open="${r.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">${tr.rows.length ? '조건에 맞는 교육이 없습니다.' : '등록된 교육이 없습니다. 「＋ 교육 계획」으로 연간 교육을 넣으세요.'}</div>`;
    } else if (tab === 'people') {
      const by = new Map();
      for (const r of rows.filter(r => r.status !== 'void')) for (const a of r.attendees) { const p = by.get(a.user_name) || { name: a.user_name, dept: a.dept, n: 0, att: 0, hours: 0, fail: 0, list: [] }; p.n++; if (a.attended) { p.att++; p.hours += r.hours || 0; } if (['미이수', '재교육'].includes(a.result)) p.fail++; p.list.push({ r, a }); by.set(a.user_name, p); }
      const people = [...by.values()].filter(p => !q || [p.name, p.dept].join(' ').toLowerCase().includes(q)).sort((a, b) => a.dept.localeCompare(b.dept, 'ko') || a.name.localeCompare(b.name, 'ko'));
      qTiles('trTiles', [['교육 대상 인원', by.size], ['참석 합계(회)', [...by.values()].reduce((s, p) => s + p.att, 0)], ['교육 시간 합(h)', [...by.values()].reduce((s, p) => s + p.hours, 0)], ['미이수·재교육', [...by.values()].reduce((s, p) => s + p.fail, 0), [...by.values()].some(p => p.fail) ? 'red' : '']]);
      $('#trTools', main).innerHTML = '';
      $('#trList', main).innerHTML = people.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>이름</th><th>부서</th><th>대상</th><th>참석</th><th>시간(h)</th><th>미이수·재교육</th><th>자격</th><th>교육 이력</th></tr></thead><tbody>${people.map(p => { const qs = ql.rows.filter(x => x.user_name === p.name && x.status === 'valid'); return `<tr><td class="nowrap" data-card-primary><b>${esc(p.name)}</b></td><td>${esc(p.dept)}</td><td>${p.n}</td><td>${p.att}</td><td>${p.hours}</td><td>${p.fail ? `<span class="chip red">${p.fail}</span>` : '0'}</td><td class="small">${qs.map(x => esc(x.kind)).join(', ')}</td><td class="small">${p.list.sort((x, y) => y.r.plan_date.localeCompare(x.r.plan_date)).slice(0, 6).map(({ r, a }) => `<a href="#/quality/training" data-tr-open="${r.id}">${esc(r.done_date || r.plan_date)} ${esc(r.title)}</a>${a.result ? ` (${esc(a.result)})` : a.attended ? '' : ' <span class="muted">미참석</span>'}`).join('<br>')}${p.list.length > 6 ? `<br><span class="muted">외 ${p.list.length - 6}건</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">이 기간의 교육 이력이 없습니다.</div>';
    } else {
      const live = r => r.status === 'valid', dd = r => live(r) && r.expire_date ? ipDday(r.expire_date, ql.today) : null;
      qTiles('trTiles', [['유효 자격', ql.rows.filter(live).length, 'green'], ['90일 안 만료', ql.rows.filter(r => { const d = dd(r); return d !== null && d >= 0 && d <= 90; }).length, ql.rows.some(r => { const d = dd(r); return d !== null && d >= 0 && d <= 90; }) ? 'yellow' : ''], ['만료 지남', ql.rows.filter(r => { const d = dd(r); return d !== null && d < 0; }).length, ql.rows.some(r => { const d = dd(r); return d !== null && d < 0; }) ? 'red' : '']]);
      $('#trTools', main).innerHTML = ql.can_manage ? '<button type="button" class="btn primary" id="qlNewBtn">＋ 자격 등록</button>' : '';
      const list = ql.rows.filter(r => !q || [r.user_name, r.kind, r.cert_no, r.issuer].join(' ').toLowerCase().includes(q));
      $('#trList', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>이름</th><th>자격명</th><th>자격번호</th><th>발급처</th><th>취득일</th><th>만료일</th><th>상태</th><th></th></tr></thead><tbody>${list.map(r => { const d = dd(r); return `<tr class="${d === null ? (live(r) ? '' : 'row-off') : d < 0 ? 'ip-over' : d <= 90 ? 'ip-soon' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.user_name)}</b></td><td>${esc(r.kind)}</td><td>${esc(r.cert_no)}</td><td>${esc(r.issuer)}</td><td class="nowrap">${esc(r.acquired_date || '')}</td><td class="nowrap">${r.expire_date ? esc(r.expire_date) + qDd(r.expire_date, ql.today, live(r), 90) : '<span class="muted">없음</span>'}</td><td><span class="chip ${live(r) ? 'green' : ''}">${esc(r.status_label)}</span></td><td class="nowrap">${ql.can_manage ? `<button type="button" class="btn small" data-ql-edit="${r.id}">수정</button> <button type="button" class="btn small danger" data-ql-del="${r.id}">삭제</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">${ql.rows.length ? '조건에 맞는 자격이 없습니다.' : '등록된 자격이 없습니다. 검사원·내부심사원 등 자격을 넣으면 만료일을 D-day로 보여 줍니다.'}</div>`;
    }
  };
  main.addEventListener('click', async e => {
    const tb = e.target.closest('#trTabs [data-tab]'); if (tb) { tab = tb.dataset.tab; try { sessionStorage.setItem('qTrTab', tab); } catch {} draw(); return; }
    const t = e.target.closest('[data-q-tile]'); if (t && tab === 'plan') { form.elements.st.value = ['planned', 'done', 'evaluated', '', 'mine'][Number(t.dataset.qTile)]; draw(); return; }
    if (e.target.closest('#trNewBtn')) return trNew().catch(fail);
    if (e.target.closest('#qlNewBtn')) return qualEdit().catch(fail);
    const o = e.target.closest('[data-tr-open]'); if (o) { e.preventDefault(); return trOpen(Number(o.dataset.trOpen)).catch(fail); }
    const a = e.target.closest('[data-tr-att]'); if (a) { try { await api('POST', `/api/trainings/${a.dataset.trAtt}/attend`); toast('참석을 확인했습니다.'); load(); } catch (err) { fail(err); } return; }
    const qe = e.target.closest('[data-ql-edit]'); if (qe) return qualEdit(ql.rows.find(r => r.id === Number(qe.dataset.qlEdit))).catch(fail);
    const qd = e.target.closest('[data-ql-del]'); if (qd) { const r = ql.rows.find(x => x.id === Number(qd.dataset.qlDel)); if (!await confirmBox(`${r.user_name} · ${r.kind} 자격을 지울까요?`)) return; try { await api('DELETE', `/api/qualifications/${r.id}?revision=${r.revision}`); toast('지웠습니다.'); load(); } catch (err) { fail(err); } }
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// A5 협력업체 품질
const SUP_GRADE_CHIP = { A: 'green', B: 'green', C: 'yellow', D: 'red' };
const supGradeOf = t => t >= 90 ? 'A' : t >= 80 ? 'B' : t >= 70 ? 'C' : 'D';
async function supEval(row, year) {
  const suggest = row.fail_rate == null ? 100 : Math.max(0, Math.round(100 - row.fail_rate * 2)), e0 = row.eval || {};
  const v = await promptBox(`${row.vendor} ${year}년 유효성평가`, `<p class="small muted">수입검사 ${row.iqc_total}건 · 판정 ${row.iqc_judged}건 중 불합격 ${row.iqc_fail}건${row.fail_rate != null ? ` (${row.fail_rate}%)` : ''} → 품질 점수 제안 <b>${suggest}점</b>(100 − 불합격률×2). 총점 = 품질 50% + 납기 30% + 대응 20%, 등급 A 90↑ · B 80↑ · C 70↑ · D.</p><div class="form-grid">
    <label>품질 점수 *<input type="number" name="quality_score" min="0" max="100" step="0.1" required value="${e0.quality_score ?? suggest}"></label>
    <label>납기 점수 *<input type="number" name="delivery_score" min="0" max="100" step="0.1" required value="${e0.delivery_score ?? ''}"></label>
    <label>대응 점수 *<input type="number" name="response_score" min="0" max="100" step="0.1" required value="${e0.response_score ?? ''}" placeholder="클레임·변경 통보 대응"></label>
    <div class="span3 sup-total" data-sup-total></div><label class="span3">평가 의견<textarea name="note" rows="2" maxlength="1000">${esc(e0.note || '')}</textarea></label></div>`, { wide: true,
    onOpen: el => { const calc = () => { const g = n => Number(el.querySelector(`[name=${n}]`).value) || 0, t = Math.round((g('quality_score') * 0.5 + g('delivery_score') * 0.3 + g('response_score') * 0.2) * 10) / 10, gr = supGradeOf(t); $('[data-sup-total]', el).innerHTML = `총점 <b>${t}</b> · 등급 <span class="chip ${SUP_GRADE_CHIP[gr]}">${gr}</span>`; }; el.addEventListener('input', calc); calc(); },
    submit: async vals => api('POST', '/api/supplier-evals', { ...vals, vendor: row.vendor, year, revision: e0.revision }) });
  if (v) { toast(`${row.vendor}: ${v.total}점 · ${v.grade}등급으로 평가했습니다.`); qReload(); }
}
async function scoaOpen(inspectionId, after = null) {
  const s = await api('GET', `/api/supplier-coas/${inspectionId}`), can = hasRole('quality');
  const m = modal(`<h3>공급사 COA · ${esc(s.item)} <span class="small muted">${esc(s.lot || '')}</span></h3>
    <p class="small muted">${esc(s.vendor)} · 수입검사 ${esc(s.req_no || '')}${s.coa_requested ? ' · <b>발주 때 COA 요청함</b>' : ''}${s.updated_by ? ` · 마지막 ${esc(s.updated_by)} ${esc(String(s.updated_at || '').slice(0, 16))}` : ''}</p>
    <form class="stack" data-scoa-form>
      ${s.files.length ? `<div class="scoa-files">${s.files.map(f => `<label class="chk">${can ? `<input type="checkbox" name="keep" value="${esc(f.file)}" checked> ` : ''}${qFileLink(f)}</label>`).join('')}${can ? '<p class="small muted">체크를 풀고 저장하면 그 파일을 지웁니다.</p>' : ''}</div>` : '<p class="muted">아직 받은 COA가 없습니다.</p>'}
      ${can ? `<div class="form-grid"><label class="span2">COA 파일 추가 (PDF·사진, 여러 개)<input type="file" multiple data-q-file accept="application/pdf,image/jpeg,image/png,image/webp"></label><label>수령일<input type="date" name="received_date" value="${esc(s.received_date || '')}"></label><label class="span3">메모<input name="note" maxlength="500" value="${esc(s.note)}"></label></div>
      <div class="actions"><span class="grow"></span><button type="button" class="btn" data-no>닫기</button><button class="btn primary">저장</button></div>` : ''}
    </form>`, { wide: true });
  $('[data-no]', m.el)?.addEventListener('click', () => m.close());
  const form = $('[data-scoa-form]', m.el);
  form.onsubmit = async e => { e.preventDefault(); try { const files = await qFiles($('[data-q-file]', form)); const v = formObj(form); await api('PUT', `/api/supplier-coas/${inspectionId}`, { files, keep: v.keep || [], received_date: v.received_date, note: v.note, revision: s.revision }); toast('공급사 COA를 저장했습니다.'); m.close(); after?.(); qReload(); } catch (err) { fail(err); } };
}
async function supOpen(vendor, year) {
  const d = await api('GET', '/api/supplier-quality/detail?vendor=' + encodeURIComponent(vendor)), can = hasRole('quality');
  const RES = { pass: ['합격', 'green'], fail: ['불합격', 'red'], pending: ['검사 대기', 'yellow'] };
  const m = modal(`<h3>${esc(vendor)} · 협력업체 품질 카드</h3>
    <div class="actions wrap">${can ? '<button type="button" class="btn" data-sup-chg>변경점 접수</button>' : ''}</div>
    <fieldset class="vendor-sec"><legend>유효성평가</legend>${d.evals.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>연도</th><th>품질</th><th>납기</th><th>대응</th><th>총점</th><th>등급</th><th>수입검사(불합격)</th><th>평가</th><th>의견</th></tr></thead><tbody>${d.evals.map(e => `<tr><td>${e.year}</td><td>${e.quality_score}</td><td>${e.delivery_score}</td><td>${e.response_score}</td><td><b>${e.total}</b></td><td><span class="chip ${SUP_GRADE_CHIP[e.grade]}">${e.grade}</span></td><td>${e.iqc_total} (${e.iqc_fail})</td><td class="nowrap small">${esc(e.evaluated_by)} ${esc(String(e.evaluated_at || '').slice(0, 10))}</td><td class="small">${esc(e.note)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">평가 기록이 없습니다.</p>'}</fieldset>
    <fieldset class="vendor-sec"><legend>업체 변경점</legend>${d.changes.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>번호</th><th>유형</th><th>내용</th><th>접수</th><th>단계</th></tr></thead><tbody>${d.changes.map(c => `<tr><td class="nowrap"><a href="#/quality/changes" data-sup-go-chg="${c.id}">${esc(c.change_no)}</a></td><td>${esc(c.kind_label)}</td><td>${esc(c.title)}</td><td class="nowrap">${esc(String(c.created_at).slice(0, 10))}</td><td><span class="chip ${CHG_CHIP[c.status]}">${esc(c.status_label)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">접수된 변경점이 없습니다.</p>'}</fieldset>
    <fieldset class="vendor-sec"><legend>수입검사 · 공급사 COA <span class="hint">(최근 200건)</span></legend>${d.inspections.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>의뢰일</th><th>번호</th><th>품목</th><th>LOT</th><th>판정</th><th>공급사 COA</th></tr></thead><tbody>${d.inspections.map(r => { const res = RES[r.result] || [r.result, '']; return `<tr><td class="nowrap">${esc(r.created_at.slice(0, 10))}</td><td class="nowrap">${esc(r.req_no || '')}</td><td>${esc(r.title)}</td><td>${esc(r.lot)}</td><td><span class="chip ${res[1]}">${esc(res[0])}</span></td><td class="nowrap">${r.coa_files.length ? r.coa_files.map(f => qFileLink(f, '받음')).join(' ') : r.coa_requested ? '<span class="chip red">미수령</span>' : '<span class="muted small">—</span>'} ${can ? `<button type="button" class="btn small" data-sup-coa="${r.id}">${r.coa_files.length ? '수정' : '첨부'}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">이 업체의 수입검사가 없습니다.</p>'}</fieldset>`, { wide: true });
  m.el.addEventListener('click', e => {
    const c = e.target.closest('[data-sup-coa]'); if (c) return scoaOpen(Number(c.dataset.supCoa), () => { m.close(); supOpen(vendor, year); }).catch(fail);
    const g = e.target.closest('[data-sup-go-chg]'); if (g) { e.preventDefault(); m.close(); chgOpen(Number(g.dataset.supGoChg)).catch(fail); }
    if (e.target.closest('[data-sup-chg]')) { m.close(); chgNew({ source_type: 'supplier', vendor, kind: 'material' }).catch(fail); }
  });
}
async function pageSuppliers(main) {
  main.innerHTML = `<h1>협력업체 품질 <span class="dept">품질</span></h1>
  <p class="muted">매입처별 품질 카드입니다. 수입검사 건수·불합격률과 <b>공급사 COA 미수령</b>(발주 때 COA를 요청한 입고)은 자동으로 모이고, 연 1회 유효성평가(품질 50%·납기 30%·대응 20% → A~D 등급)를 남깁니다. 업체의 4M 변경 통보는 「변경점 접수」로 변경관리에 올립니다.</p>
  <div class="ip-tiles" id="supTiles"></div>
  <form class="toolbar list-filters" data-read-only id="supFilters"><label class="lf-sel">연도<select name="year">${[0, 1, 2, 3].map(i => { const y = Number(todayStr().slice(0, 4)) - i; return `<option>${y}</option>`; }).join('')}</select></label><label class="lf-sel">보기<select name="show"><option value="active">이 해 수입검사 있는 업체</option><option value="">매입처 전체</option><option value="coa">COA 미수령 있음</option><option value="noeval">미평가</option><option value="low">C·D 등급</option></select></label><label class="list-search">찾기<input type="search" name="q" placeholder="업체명"></label></form>
  <div id="supList"></div>`;
  const form = $('#supFilters', main); let data = { rows: [], year: Number(todayStr().slice(0, 4)) };
  const load = async () => { data = await api('GET', '/api/supplier-quality?year=' + form.elements.year.value); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows, act = all.filter(r => r.iqc_total);
    const judged = act.reduce((s, r) => s + r.iqc_judged, 0), failN = act.reduce((s, r) => s + r.iqc_fail, 0), miss = all.reduce((s, r) => s + r.coa_missing, 0);
    qTiles('supTiles', [['수입검사 업체', act.length], ['수입검사', act.reduce((s, r) => s + r.iqc_total, 0)], ['불합격률', judged ? `${Math.round(failN / judged * 1000) / 10}%` : '—', failN ? 'yellow' : ''], ['COA 미수령', miss, miss ? 'red' : ''], ['미평가(검사 있는 업체)', act.filter(r => !r.eval).length], ['C·D 등급', all.filter(r => r.eval && ['C', 'D'].includes(r.eval.grade)).length, all.some(r => r.eval && ['C', 'D'].includes(r.eval.grade)) ? 'red' : '']]);
    const rows = all.filter(r => (v.show === 'active' ? r.iqc_total > 0 : v.show === 'coa' ? r.coa_missing > 0 : v.show === 'noeval' ? r.iqc_total > 0 && !r.eval : v.show === 'low' ? r.eval && ['C', 'D'].includes(r.eval.grade) : true) && (!q || r.vendor.toLowerCase().includes(q)));
    $('#supList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>업체</th><th>수입검사</th><th>불합격</th><th>불합격률</th><th>COA 미수령</th><th>${data.year} 평가</th><th>최근 평가</th><th>변경점(진행/전체)</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-sup-row="${esc(r.vendor)}" class="${r.eval && r.eval.grade === 'D' ? 'ip-over' : r.coa_missing ? 'ip-soon' : ''}"><td data-card-primary><b>${esc(r.vendor)}</b></td><td>${r.iqc_total}</td><td>${r.iqc_fail ? `<span class="chip red">${r.iqc_fail}</span>` : 0}</td><td>${r.fail_rate == null ? '<span class="muted">—</span>' : r.fail_rate + '%'}</td><td>${r.coa_req ? (r.coa_missing ? `<span class="chip red">${r.coa_missing}</span> / ${r.coa_req}` : `0 / ${r.coa_req}`) : '<span class="muted">—</span>'}</td><td>${r.eval ? `${r.eval.total} <span class="chip ${SUP_GRADE_CHIP[r.eval.grade]}">${r.eval.grade}</span>` : '<span class="muted">미평가</span>'}</td><td class="small">${r.last_eval && (!r.eval || r.last_eval.year !== r.eval.year) ? `${r.last_eval.year} · ${r.last_eval.grade}` : ''}</td><td>${r.changes_open} / ${r.changes_total}</td><td class="nowrap"><button type="button" class="btn small" data-sup-open="${esc(r.vendor)}">카드</button>${data.can_manage ? ` <button type="button" class="btn small primary" data-sup-eval="${esc(r.vendor)}">${r.eval ? '재평가' : '평가'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 업체가 없습니다. 「보기」를 「매입처 전체」로 바꿔 보세요.' : '매입처가 없습니다. 관리 › 거래처에서 매입처를 등록하세요.'}</div>`;
  };
  main.addEventListener('click', e => {
    const o = e.target.closest('[data-sup-open]'); if (o) return supOpen(o.dataset.supOpen, data.year).catch(fail);
    const ev = e.target.closest('[data-sup-eval]'); if (ev) return supEval(data.rows.find(r => r.vendor === ev.dataset.supEval), data.year).catch(fail);
    const t = e.target.closest('[data-q-tile]'); if (t) { form.elements.show.value = ['active', 'active', 'active', 'coa', 'noeval', 'low'][Number(t.dataset.qTile)]; draw(); }
  });
  form.elements.year.addEventListener('change', () => load().catch(fail)); form.addEventListener('input', e => { if (e.target.name !== 'year') draw(); }); form.elements.show.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// ── 15.307 품질 3단계: 생산 › 공무(설비 대장·예방보전) · 품질 › 공정품질(PQC·SPC) · 시험법·신뢰성 ──
const EQ_STATUS_LABEL = { running: '가동', maintenance: '정비 중', idle: '휴지', disposed: '폐기' };
const EQ_STATUS_CHIP = { running: 'green', maintenance: 'yellow', idle: '', disposed: '' };
const EQ_LOG_LABEL = { pm: '예방보전(PM)', failure: '고장', repair: '수리', modify: '개조·이설', other: '기타' };
const PM_UNIT_LABEL = { day: '일', week: '주', month: '개월', year: '년' };
const pmRowHtml = (p = {}) => `<tr data-pm-row data-key="${esc(p.key || '')}"><td><input data-pm="name" maxlength="100" value="${esc(p.name || '')}" placeholder="예) 필터 교체"></td><td class="nowrap"><input type="number" data-pm="cycle" min="1" max="999" value="${p.cycle || 1}" class="pm-cycle"><select data-pm="unit">${Object.entries(PM_UNIT_LABEL).map(([k, l]) => `<option value="${k}"${(p.unit || 'month') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td><input data-pm="checks" maxlength="1000" value="${esc((p.checks || []).join(', '))}" placeholder="점검 항목을 쉼표로: 필터 상태, 차압"></td><td><input type="date" data-pm="last_done" value="${esc(p.last_done || '')}"></td><td><input type="date" data-pm="next_due" value="${esc(p.next_due || '')}"></td><td><button type="button" class="btn small danger" data-pm-del>×</button></td></tr>`;
const pmRead = root => $$('[data-pm-row]', root).map(tr => { const g = k => $(`[data-pm="${k}"]`, tr).value; return { key: tr.dataset.key || undefined, name: g('name').trim(), cycle: g('cycle'), unit: g('unit'), checks: g('checks').split(',').map(x => x.trim()).filter(Boolean), last_done: g('last_done'), next_due: g('next_due') }; }).filter(p => p.name);
async function eqEdit(e = null, after = null) {
  const units = await api('GET', '/api/production-units').catch(() => []);
  const v0 = e || { status: 'running', pm_items: [] };
  const m = modal(`<h3>${e ? `${esc(e.equip_no)} 설비 수정` : '설비 등록'}</h3><form class="stack" data-eq-form><div class="form-grid">
    <label>설비번호 <span class="hint">(비우면 EQ-01…)</span><input name="equip_no" maxlength="40" value="${esc(v0.equip_no || '')}"></label>
    <label class="span2">설비명 *<input name="name" required maxlength="100" value="${esc(v0.name || '')}" placeholder="예) 세탁기 · 커팅기 · 융착기 · 클린룸 공조기"></label>
    <label>종류<input name="kind" maxlength="50" list="eqKinds" value="${esc(v0.kind || '')}"><datalist id="eqKinds">${['세탁기', '건조기', '커팅기', '융착기', '포장기', '공조기(클린룸)', '순수 제조장치', '컴프레서', '보일러'].map(x => `<option value="${x}">`).join('')}</datalist></label>
    <label>호기<input name="unit_name" maxlength="50" list="eqUnits" value="${esc(v0.unit_name || '')}"><datalist id="eqUnits">${(Array.isArray(units) ? units : units.rows || []).map(u => `<option value="${esc(u.name)}">`).join('')}</datalist></label>
    <label>위치<input name="location" maxlength="100" value="${esc(v0.location || '')}" placeholder="예) 2동 세탁실"></label>
    <label>제조사<input name="maker" maxlength="100" value="${esc(v0.maker || '')}"></label><label>모델명<input name="model" maxlength="100" value="${esc(v0.model || '')}"></label><label>S/N<input name="serial_no" maxlength="100" value="${esc(v0.serial_no || '')}"></label>
    <label>설치일<input type="date" name="install_date" value="${esc(v0.install_date || '')}"></label><label>담당자<input name="owner_name" maxlength="50" value="${esc(v0.owner_name || ME?.name || '')}"></label>
    <label>상태<select name="status">${Object.entries(EQ_STATUS_LABEL).map(([k, l]) => `<option value="${k}"${v0.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="span3">메모<input name="note" maxlength="1000" value="${esc(v0.note || '')}"></label></div>
    <fieldset class="vendor-sec"><legend>예방보전(PM) 항목 <span class="hint">(다음 예정일은 비우면 직전 수행일 + 주기)</span></legend><div class="table-wrap"><table class="grid pm-edit" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>항목</th><th>주기</th><th>점검표</th><th>직전 수행일</th><th>다음 예정일</th><th></th></tr></thead><tbody>${(v0.pm_items || []).map(pmRowHtml).join('')}</tbody></table></div><button type="button" class="btn small" data-pm-add>＋ PM 항목</button></fieldset>
    <div class="actions">${e && !e.log_count ? '<button type="button" class="btn danger" data-eq-del>삭제</button>' : ''}<span class="grow"></span><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
  const form = $('[data-eq-form]', m.el), tb = $('.pm-edit tbody', form);
  if (!e) tb.insertAdjacentHTML('beforeend', pmRowHtml());
  $('[data-pm-add]', form).onclick = () => tb.insertAdjacentHTML('beforeend', pmRowHtml());
  form.addEventListener('click', ev => { const d = ev.target.closest('[data-pm-del]'); if (d) d.closest('tr').remove(); });
  form.addEventListener('change', ev => { if (ev.target.matches('[data-pm="last_done"],[data-pm="cycle"],[data-pm="unit"]')) { const n = $('[data-pm="next_due"]', ev.target.closest('tr')); n.value = ''; } });
  $('[data-no]', form).onclick = () => m.close();
  $('[data-eq-del]', form)?.addEventListener('click', async () => { if (!await confirmBox(`${e.equip_no} ${e.name}을(를) 지울까요?`)) return; try { await api('DELETE', `/api/equipment/${e.id}?revision=${e.revision}`); toast('지웠습니다.'); m.close(); qReload(); } catch (err) { fail(err); } });
  form.onsubmit = async ev => { ev.preventDefault(); try { const body = { ...formObj(form), pm_items: pmRead(form) }; const r = e ? await api('PUT', `/api/equipment/${e.id}`, { ...body, revision: e.revision }) : await api('POST', '/api/equipment', { ...body, request_id: crypto.randomUUID() }); toast(`${r.equip_no} 저장했습니다.`); m.close(); qReload(); after?.(r); } catch (err) { fail(err); } };
}
async function eqLog(e, kind = 'pm', pmKey = '') {
  const pm = e.pm_items, item = () => pm.find(p => p.key === $('[name=pm_key]', box)?.value);
  let box;
  const v = await promptBox(`${e.equip_no} ${e.name} · ${kind === 'pm' ? '예방보전 수행' : '고장·수리 기록'}`, `<div class="form-grid">
    <label>종류<select name="kind">${Object.entries(EQ_LOG_LABEL).filter(([k]) => kind === 'pm' ? k === 'pm' : k !== 'pm').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <label>일자 *<input type="date" name="log_date" required value="${todayStr()}" max="${todayStr()}"></label><label>작업자<input name="worker_name" maxlength="50" value="${esc(ME?.name || '')}"></label>
    ${kind === 'pm' ? `<label class="span3">PM 항목 *<select name="pm_key" required>${pm.map(p => `<option value="${esc(p.key)}"${p.key === pmKey ? ' selected' : ''}>${esc(p.name)} (${p.cycle}${PM_UNIT_LABEL[p.unit]}마다 · 예정 ${esc(p.next_due || '')})</option>`).join('')}</select></label><div class="span3" data-pm-checks></div>`
    : `<label class="span3">증상·작업 내용 *<textarea name="description" rows="2" maxlength="1000" required></textarea></label><label class="span3">조치<textarea name="action" rows="2" maxlength="1000"></textarea></label><label>비가동 시간(h)<input type="number" step="0.5" min="0" name="downtime_hours"></label><label>교체 부품<input name="parts" maxlength="300"></label><label>비용(원)<input type="number" min="0" name="cost"></label>`}
    <label>기록 뒤 설비 상태<select name="status_after">${Object.entries(EQ_STATUS_LABEL).filter(([k]) => k !== 'disposed').map(([k, l]) => `<option value="${k}"${(kind === 'pm' ? e.status : 'maintenance') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    ${kind === 'pm' ? '<label class="span2">메모<input name="description" maxlength="1000"></label>' : ''}</div>`, { wide: true,
    onOpen: el => { box = el; const draw = () => { const it = item(), c = $('[data-pm-checks]', el); if (!c || !it) return; c.innerHTML = it.checks.length ? `<table class="grid pm-checks" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>점검 항목</th><th>결과</th><th>메모</th></tr></thead><tbody>${it.checks.map((n, i) => `<tr><td>${esc(n)}</td><td class="nowrap"><label class="chk"><input type="radio" name="ck${i}" value="1" checked> 양호</label> <label class="chk"><input type="radio" name="ck${i}" value="0"> 이상</label></td><td><input name="ckn${i}" maxlength="200"></td></tr>`).join('')}</tbody></table>` : '<p class="small muted">점검표가 없는 항목입니다. 수행만 기록합니다.</p>'; }; $('[name=pm_key]', el)?.addEventListener('change', draw); draw(); },
    submit: async vals => { const it = kind === 'pm' ? item() : null; const checks = it ? it.checks.map((n, i) => ({ item: n, ok: vals['ck' + i] === '1', note: vals['ckn' + i] || '' })) : []; return api('POST', `/api/equipment/${e.id}/logs`, { ...vals, checks, revision: e.revision, request_id: crypto.randomUUID() }); } });
  if (v) { toast(kind === 'pm' ? `수행을 기록했습니다${v.log_result === '이상' ? ' — 점검 이상이 있습니다' : ''}.` : '기록했습니다.', v.log_result === '이상' ? 'err' : 'ok'); qReload(); }
  return v;
}
async function eqOpen(id) {
  const d = await api('GET', `/api/equipment/${id}/logs`), e = d.equipment, can = hasRole('production') || hasRole('quality');
  const list = (await api('GET', '/api/equipment')).rows.find(x => x.id === id) || e, today = todayStr();
  const m = modal(`<h3>${esc(e.equip_no)} · ${esc(e.name)} <span class="chip ${EQ_STATUS_CHIP[e.status]}">${esc(e.status_label)}</span></h3>
    <p class="small muted">${[e.kind, e.unit_name, e.location, [e.maker, e.model].filter(Boolean).join(' '), e.serial_no && 'S/N ' + e.serial_no, e.install_date && '설치 ' + e.install_date, e.owner_name && '담당 ' + e.owner_name].filter(Boolean).map(esc).join(' · ')}</p>
    <div class="actions wrap">${can ? '<button type="button" class="btn" data-eq-edit>설비 수정</button><button type="button" class="btn" data-eq-fail>고장·수리 기록</button>' : ''}</div>
    <fieldset class="vendor-sec"><legend>예방보전(PM)</legend>${e.pm_items.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>항목</th><th>주기</th><th>점검표</th><th>직전 수행</th><th>다음 예정</th><th></th></tr></thead><tbody>${e.pm_items.map(p => `<tr><td><b>${esc(p.name)}</b></td><td class="nowrap">${p.cycle}${PM_UNIT_LABEL[p.unit]}</td><td class="small">${p.checks.map(esc).join(', ')}</td><td class="nowrap">${esc(p.last_done || '—')}</td><td class="nowrap">${esc(p.next_due || '')}${qDd(p.next_due, today, e.status !== 'disposed', 7)}</td><td>${can && e.status !== 'disposed' ? `<button type="button" class="btn small primary" data-eq-pm="${esc(p.key)}">수행</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">PM 항목이 없습니다. 「설비 수정」에서 넣으세요.</p>'}</fieldset>
    <fieldset class="vendor-sec"><legend>설비 이력 <span class="hint">(올해 고장 ${list.fails_year || 0}건 · 비가동 ${list.downtime_year || 0}h · PM ${list.pm_year || 0}회)</span></legend>${d.rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>일자</th><th>종류</th><th>내용</th><th>결과·조치</th><th>비가동</th><th>작업자</th></tr></thead><tbody>${d.rows.map(l => `<tr class="${l.result === '이상' || l.kind === 'failure' ? 'ip-soon' : ''}"><td class="nowrap">${esc(l.log_date)}</td><td class="nowrap">${esc(l.kind_label)}${l.pm_name ? `<div class="small muted">${esc(l.pm_name)}</div>` : ''}</td><td>${esc(l.description)}${l.checks.length ? `<div class="small">${l.checks.map(c => `${esc(c.item)} ${c.ok ? '양호' : '<b class="txt-red">이상</b>'}${c.note ? ` (${esc(c.note)})` : ''}`).join(' · ')}</div>` : ''}</td><td>${l.result ? `<span class="chip ${l.result === '이상' ? 'red' : 'green'}">${esc(l.result)}</span> ` : ''}${esc(l.action)}${l.parts ? `<div class="small muted">부품 ${esc(l.parts)}</div>` : ''}</td><td>${l.downtime_hours ?? ''}</td><td>${esc(l.worker_name)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">이력이 없습니다.</p>'}</fieldset>`, { wide: true });
  const reopen = () => { m.close(); eqOpen(id).catch(fail); };
  $('[data-eq-edit]', m.el)?.addEventListener('click', () => { m.close(); eqEdit(list, () => eqOpen(id)).catch(fail); });
  $('[data-eq-fail]', m.el)?.addEventListener('click', async () => { if (await eqLog(e, 'failure')) reopen(); });
  m.el.addEventListener('click', async ev => { const b = ev.target.closest('[data-eq-pm]'); if (b && await eqLog(e, 'pm', b.dataset.eqPm)) reopen(); });
}
async function pageEquipment(main) {
  main.innerHTML = `<h1>설비 대장·이력 <span class="dept">생산 · 공무</span></h1>
  <p class="muted">생산설비(호기·위치·제조사)와 예방보전(PM) 항목·주기, 고장·수리 이력을 관리합니다. PM 일정은 「예방보전(PM) 일정」에서 한눈에 봅니다. 등록·기록은 생산·품질 담당이 합니다.</p>
  <div class="ip-tiles" id="eqTiles"></div>
  <form class="toolbar list-filters" data-read-only id="eqFilters"><label class="lf-sel">상태<select name="st"><option value="live">폐기 빼고</option><option value="">전체</option>${Object.entries(EQ_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="due">PM 7일 안·지남</option></select></label><label class="list-search">찾기<input type="search" name="q" placeholder="설비번호·설비명·호기·위치·제조사"></label><span class="grow"></span><span id="eqTools" class="ip-tools"></span></form>
  <div id="eqList"></div>`;
  const form = $('#eqFilters', main); let data = { rows: [], today: todayStr() };
  const load = async () => { data = await api('GET', '/api/equipment'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const due = r => r.status !== 'disposed' && r.next_pm && ipDday(r.next_pm, data.today) <= 7;
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows;
    qTiles('eqTiles', [['설비(폐기 빼고)', all.filter(r => r.status !== 'disposed').length], ['가동', all.filter(r => r.status === 'running').length, 'green'], ['정비 중', all.filter(r => r.status === 'maintenance').length, all.some(r => r.status === 'maintenance') ? 'yellow' : ''], ['PM 7일 안·지남', all.filter(due).length, all.some(due) ? 'red' : ''], ['올해 고장', all.reduce((s, r) => s + r.fails_year, 0)], ['올해 비가동(h)', all.reduce((s, r) => s + r.downtime_year, 0)]]);
    $('#eqTools', main).innerHTML = data.can_manage ? '<button type="button" class="btn primary" id="eqNewBtn">＋ 설비 등록</button>' : '';
    const rows = all.filter(r => (v.st === 'live' ? r.status !== 'disposed' : v.st === 'due' ? due(r) : !v.st || r.status === v.st) && (!q || [r.equip_no, r.name, r.unit_name, r.location, r.maker, r.model, r.kind].join(' ').toLowerCase().includes(q)));
    $('#eqList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>설비번호</th><th>설비명</th><th>호기</th><th>위치</th><th>제조사 · 모델</th><th>PM 항목</th><th>다음 PM</th><th>올해 고장 · 비가동</th><th>상태</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-eq-row="${r.id}" class="${due(r) ? (ipDday(r.next_pm, data.today) < 0 ? 'ip-over' : 'ip-soon') : ''}${r.status === 'disposed' ? ' row-off' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.equip_no)}</b></td><td><b>${esc(r.name)}</b>${r.kind ? `<div class="small muted">${esc(r.kind)}</div>` : ''}</td><td>${esc(r.unit_name)}</td><td>${esc(r.location)}</td><td>${esc([r.maker, r.model].filter(Boolean).join(' · '))}</td><td>${r.pm_items.length}</td><td class="nowrap">${esc(r.next_pm || '')}${qDd(r.next_pm, data.today, r.status !== 'disposed', 7)}</td><td class="nowrap">${r.fails_year}건 · ${r.downtime_year}h</td><td><span class="chip ${EQ_STATUS_CHIP[r.status]}">${esc(r.status_label)}</span></td><td><button type="button" class="btn small" data-eq-open="${r.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 설비가 없습니다.' : '등록된 설비가 없습니다. 「＋ 설비 등록」으로 세탁기·커팅기 등과 PM 항목을 넣으세요.'}</div>`;
  };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-q-tile]'); if (t) { form.elements.st.value = ['live', 'running', 'maintenance', 'due', 'live', 'live'][Number(t.dataset.qTile)]; draw(); return; }
    if (e.target.closest('#eqNewBtn')) return eqEdit().catch(fail);
    const o = e.target.closest('[data-eq-open]'); if (o) eqOpen(Number(o.dataset.eqOpen)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}
async function pagePm(main) {
  main.innerHTML = `<h1>예방보전(PM) 일정 <span class="dept">생산 · 공무</span></h1>
  <p class="muted">모든 설비의 예방보전 항목을 다음 예정일 순으로 봅니다. 「수행」으로 점검표를 체크하면 직전 수행일과 다음 예정일(수행일 + 주기)이 바뀌고 설비 이력에 남습니다. 점검 중 「이상」이 하나라도 있으면 결과가 「이상」으로 기록됩니다.</p>
  <div class="ip-tiles" id="pmTiles"></div>
  <form class="toolbar list-filters" data-read-only id="pmFilters"><label class="lf-sel">기한<select name="due"><option value="30">30일 안·지남</option><option value="7">7일 안·지남</option><option value="over">지남</option><option value="">전체</option></select></label><label class="list-search">찾기<input type="search" name="q" placeholder="설비·호기·위치·PM 항목"></label></form>
  <div id="pmList"></div>`;
  const form = $('#pmFilters', main); let data = { rows: [], today: todayStr() };
  const load = async () => { data = await api('GET', '/api/equipment'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase();
    const items = data.rows.filter(e => e.status !== 'disposed').flatMap(e => e.pm_items.map(p => ({ e, p, d: ipDday(p.next_due, data.today) }))).sort((a, b) => (a.p.next_due || '9').localeCompare(b.p.next_due || '9'));
    qTiles('pmTiles', [['PM 항목', items.length], ['지남', items.filter(x => x.d < 0).length, items.some(x => x.d < 0) ? 'red' : ''], ['7일 안', items.filter(x => x.d >= 0 && x.d <= 7).length, items.some(x => x.d >= 0 && x.d <= 7) ? 'yellow' : ''], ['30일 안', items.filter(x => x.d >= 0 && x.d <= 30).length]]);
    const rows = items.filter(x => (v.due === 'over' ? x.d < 0 : v.due ? x.d !== null && x.d <= Number(v.due) : true) && (!q || [x.e.equip_no, x.e.name, x.e.unit_name, x.e.location, x.p.name].join(' ').toLowerCase().includes(q)));
    $('#pmList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>다음 예정</th><th>설비</th><th>호기 · 위치</th><th>PM 항목</th><th>주기</th><th>점검표</th><th>직전 수행</th><th></th></tr></thead><tbody>${rows.map(x => `<tr class="${x.d < 0 ? 'ip-over' : x.d <= 7 ? 'ip-soon' : ''}"><td class="nowrap"><b>${esc(x.p.next_due || '')}</b>${qDd(x.p.next_due, data.today, true, 7)}</td><td data-card-primary><b>${esc(x.e.equip_no)}</b> ${esc(x.e.name)}${x.e.status !== 'running' ? ` <span class="chip ${EQ_STATUS_CHIP[x.e.status]}">${esc(x.e.status_label)}</span>` : ''}</td><td>${esc([x.e.unit_name, x.e.location].filter(Boolean).join(' · '))}</td><td><b>${esc(x.p.name)}</b></td><td class="nowrap">${x.p.cycle}${PM_UNIT_LABEL[x.p.unit]}</td><td class="small">${x.p.checks.map(esc).join(', ')}</td><td class="nowrap">${esc(x.p.last_done || '—')}</td><td class="nowrap">${data.can_manage ? `<button type="button" class="btn small primary" data-pm-do="${x.e.id}" data-key="${esc(x.p.key)}">수행</button> ` : ''}<button type="button" class="btn small" data-pm-eq="${x.e.id}">설비</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${items.length ? '조건에 맞는 PM이 없습니다. 「기한」을 「전체」로 바꿔 보세요.' : 'PM 항목이 있는 설비가 없습니다. 「설비 대장·이력」에서 설비와 PM 항목을 넣으세요.'}</div>`;
  };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-q-tile]'); if (t) { form.elements.due.value = ['', 'over', '7', '30'][Number(t.dataset.qTile)]; draw(); return; }
    const d = e.target.closest('[data-pm-do]'); if (d) return eqLog(data.rows.find(r => r.id === Number(d.dataset.pmDo)), 'pm', d.dataset.key).catch(fail);
    const o = e.target.closest('[data-pm-eq]'); if (o) eqOpen(Number(o.dataset.pmEq)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// C1 공정품질(PQC)
const PQC_KIND_LABEL = { process: '공정 조건·측정', env: '환경측정' };
const pqcSpec = p => p.lsl != null && p.usl != null ? `${p.lsl} ~ ${p.usl}` : p.lsl != null ? `≥ ${p.lsl}` : `≤ ${p.usl}`;
const fmtN = (v, d = 3) => v == null ? '—' : Number(v).toFixed(d).replace(/\.?0+$/, '');
async function ppEdit(p = null, kind = 'process') {
  const v0 = p || { kind };
  const v = await promptBox(p ? '관리항목 수정' : '관리항목 등록', `<div class="form-grid">
    <label>구분<select name="kind">${Object.entries(PQC_KIND_LABEL).map(([k, l]) => `<option value="${k}"${v0.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>공정 · 측정 위치 *<input name="place" required maxlength="100" list="ppPlaces" value="${esc(v0.place || '')}" placeholder="예) 세탁 · 클린룸 A존"><datalist id="ppPlaces">${['세탁', '건조', '커팅', '융착', '포장', '클린룸 A존', '클린룸 B존', '순수 제조'].map(x => `<option value="${x}">`).join('')}</datalist></label>
    <label>관리항목 *<input name="item" required maxlength="100" list="ppItems" value="${esc(v0.item || '')}"><datalist id="ppItems">${['수온', '세탁 시간', '세제 농도', '건조 온도', '커팅 속도', '융착 온도', '압력', '파티클(0.5㎛)', '온도', '습도', '차압', '비저항'].map(x => `<option value="${x}">`).join('')}</datalist></label>
    <label>단위<input name="unit" maxlength="20" value="${esc(v0.unit || '')}" placeholder="℃ · % · Pa · ea/ft³"></label><label>하한(LSL)<input type="number" step="any" name="lsl" value="${v0.lsl ?? ''}"></label><label>상한(USL)<input type="number" step="any" name="usl" value="${v0.usl ?? ''}"></label>
    <label>목표<input type="number" step="any" name="target" value="${v0.target ?? ''}"></label><label>측정 주기<input name="cycle" maxlength="50" value="${esc(v0.cycle || '')}" placeholder="예) 2시간 · 매일 · 매주"></label>
    ${p ? `<label>사용<select name="active"><option value="1"${p.active ? ' selected' : ''}>사용</option><option value="0"${p.active ? '' : ' selected'}>사용 안 함</option></select></label>` : ''}
    <label class="span3">메모<input name="note" maxlength="500" value="${esc(v0.note || '')}"></label></div>`, { wide: true,
    submit: async vals => p ? api('PUT', `/api/pqc/points/${p.id}`, { ...vals, revision: p.revision }) : api('POST', '/api/pqc/points', vals) });
  if (v) { toast('저장했습니다.'); qReload(); }
}
async function pqcRecord(points, pointId = null) {
  const live = points.filter(p => p.active); if (!live.length) return toast('먼저 관리항목을 등록하세요.', 'err');
  const row = () => `<tr data-mrow><td><input type="date" data-m="measured_on" value="${todayStr()}" max="${todayStr()}"></td><td><input type="time" data-m="measured_time"></td><td><input type="number" step="any" data-m="value" class="pqc-v"></td><td><input data-m="lot" maxlength="100"></td><td><input data-m="machine" maxlength="50"></td><td><input data-m="note" maxlength="300"></td><td data-m-judge></td><td><button type="button" class="btn small danger" data-m-del>×</button></td></tr>`;
  const m = modal(`<h3>공정 측정값 입력</h3><form class="stack" data-pqc-form>
    <label>관리항목 *<select name="point_id">${live.map(p => `<option value="${p.id}"${p.id === pointId ? ' selected' : ''}>${esc(PQC_KIND_LABEL[p.kind])} · ${esc(p.place)} · ${esc(p.item)} (${esc(pqcSpec(p))} ${esc(p.unit)})</option>`).join('')}</select></label>
    <p class="small muted">엑셀에서 「값」 또는 「값·LOT·호기」 열을 복사해 첫 칸에 붙여넣으면 줄이 늘어납니다. 기준을 벗어나면 빨갛게 표시됩니다.</p>
    <div class="table-wrap"><table class="grid pqc-grid" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>측정일</th><th>시각</th><th>측정값 *</th><th>LOT</th><th>호기</th><th>메모</th><th>판정</th><th></th></tr></thead><tbody>${row()}${row()}${row()}</tbody></table></div>
    <div class="actions"><button type="button" class="btn small" data-m-add>＋ 줄</button><span class="grow"></span><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
  const form = $('[data-pqc-form]', m.el), tb = $('tbody', form), pt = () => points.find(p => p.id === Number(form.elements.point_id.value));
  const judge = () => { const p = pt(); $$('[data-mrow]', tb).forEach(tr => { const v = $('[data-m=value]', tr).value, c = $('[data-m-judge]', tr); if (v === '') { c.innerHTML = ''; tr.classList.remove('ip-over'); return; } const n = Number(v), out = (p.lsl != null && n < p.lsl) || (p.usl != null && n > p.usl); c.innerHTML = out ? '<span class="chip red">이탈</span>' : '<span class="chip green">적합</span>'; tr.classList.toggle('ip-over', out); }); };
  form.addEventListener('input', judge); form.elements.point_id.addEventListener('change', judge);
  $('[data-m-add]', form).onclick = () => tb.insertAdjacentHTML('beforeend', row());
  $('[data-no]', form).onclick = () => m.close();
  form.addEventListener('click', e => { const d = e.target.closest('[data-m-del]'); if (d) d.closest('tr').remove(); });
  tb.addEventListener('paste', e => { const inp = e.target.closest('[data-m=value]'); if (!inp) return; const text = e.clipboardData.getData('text'); if (!/[\n\t]/.test(text.trim())) return; e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim()); let tr = inp.closest('tr');
    for (const l of lines) { if (!tr) { tb.insertAdjacentHTML('beforeend', row()); tr = tb.lastElementChild; } const [v, lot, mc] = l.split('\t'); $('[data-m=value]', tr).value = (v || '').trim().replace(/,/g, ''); if (lot != null) $('[data-m=lot]', tr).value = lot.trim(); if (mc != null) $('[data-m=machine]', tr).value = mc.trim(); tr = tr.nextElementSibling; }
    judge(); });
  form.onsubmit = async e => { e.preventDefault(); const rows = $$('[data-mrow]', tb).map(tr => Object.fromEntries($$('[data-m]', tr).filter(i => i.matches('input')).map(i => [i.dataset.m, i.value]))).filter(r => r.value !== ''); if (!rows.length) return toast('측정값을 넣으세요.', 'err');
    try { const r = await api('POST', '/api/pqc/measures', { rows: rows.map(x => ({ ...x, point_id: form.elements.point_id.value })), request_id: crypto.randomUUID() }); toast(`${r.saved}개 저장${r.out_of_spec ? ` — 기준 이탈 ${r.out_of_spec}개` : ''}.`, r.out_of_spec ? 'err' : 'ok'); m.close(); qReload(); } catch (err) { fail(err); } };
}
async function pqcAbnormal(pre = {}) {
  const v = await promptBox('공정 이상발생 등록', `<p class="small muted">등록하면 부적합·CAPA(출처: 공정 이상)로 올라가 품질이 원인분석·조치를 진행합니다.</p><div class="form-grid">
    <label>공정 · 항목<input name="source_no" maxlength="80" value="${esc(pre.source_no || '')}"></label><label>등급<select name="grade"><option value="minor">경미</option><option value="major">중대</option><option value="critical">치명</option></select></label><label>발생일<input type="date" name="found_date" value="${esc(pre.found_date || todayStr())}"></label>
    <label class="span3">이상 내용 *<input name="title" required maxlength="200" value="${esc(pre.title || '')}"></label><label class="span3">상세<textarea name="detail" rows="2" maxlength="2000">${esc(pre.detail || '')}</textarea></label>
    <label>품목<input name="item" maxlength="200"></label><label>LOT<input name="lot" maxlength="100" value="${esc(pre.lot || '')}"></label><label>수량<input type="number" step="any" name="qty"></label>
    <label class="span3">즉시 조치<input name="containment" maxlength="1000" placeholder="예) 라인 정지, 해당 LOT 격리"></label></div>`, { wide: true,
    submit: async vals => api('POST', '/api/ncs', { ...vals, source_type: 'process', kind: '공정 이상', owner_name: ME?.name || '', request_id: crypto.randomUUID() }) });
  if (v) { toast(`${v.nc_no} 이상발생을 등록했습니다.`); qReload(); }
  return v;
}
function spcSvg(c, which, point) {
  const W = 900, H = 230, L = 52, R = 70, T = 14, B = 34, pts = c.points.map(p => which === 'x' ? p.x : p.r), idx = pts.map((v, i) => [v, i]).filter(([v]) => v != null);
  const lines = which === 'x' ? [['UCL', c.ucl, 'ctl'], ['CL', c.cl, 'cl'], ['LCL', c.lcl, 'ctl'], ['USL', point.usl, 'spec'], ['LSL', point.lsl, 'spec']] : [['UCL', c.r_ucl, 'ctl'], ['CL', c.r_cl, 'cl'], ['LCL', c.r_lcl, 'ctl']];
  const vals = [...idx.map(([v]) => v), ...lines.map(l => l[1]).filter(v => v != null)], lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || 1, y0 = lo - pad, y1 = hi + pad;
  const X = i => L + (c.points.length < 2 ? (W - L - R) / 2 : i * (W - L - R) / (c.points.length - 1)), Y = v => T + (y1 - v) / (y1 - y0) * (H - T - B);
  const out = new Set(c.out), step = Math.ceil(c.points.length / 12), dup = new Set(c.points.map(p => p.label)).size < c.points.length;
  // 오른쪽 이름표가 겹치지 않게(예: LCL·LSL이 가까울 때) 13px씩 벌린다
  const labs = lines.filter(l => l[1] != null).map(([n, v, k]) => ({ n, v, k, y: Y(v) + 4 })).sort((a, b) => a.y - b.y); labs.forEach((l, i) => { if (i && l.y - labs[i - 1].y < 13) l.y = labs[i - 1].y + 13; });
  return `<svg class="spc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${which === 'x' ? (c.type === 'xbar-r' ? 'X̄ 관리도' : 'I 관리도') : (c.type === 'xbar-r' ? 'R 관리도' : 'MR 관리도')}">
    ${labs.map(({ n, v, k, y }) => `<line class="spc-${k}" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="spc-lab spc-${k}-t" x="${W - R + 6}" y="${y}">${n} ${fmtN(v)}</text>`).join('')}
    <polyline class="spc-line" points="${idx.map(([v, i]) => `${X(i)},${Y(v)}`).join(' ')}"/>
    ${idx.map(([v, i]) => `<circle class="spc-pt${out.has(i) ? ' out' : ''}" cx="${X(i)}" cy="${Y(v)}" r="${out.has(i) ? 4.5 : 3.2}"><title>${esc(c.points[i].label)}: ${fmtN(v)}</title></circle>`).join('')}
    ${c.points.map((p, i) => i % step ? '' : `<text class="spc-x" x="${X(i)}" y="${H - 12}" text-anchor="middle">${dup ? i + 1 : esc(/^\d{4}-/.test(p.label) ? String(p.label).slice(5) : p.label)}</text>`).join('')}
    <text class="spc-lab" x="6" y="${T + 8}">${which === 'x' ? (c.type === 'xbar-r' ? 'X̄' : 'I') : (c.type === 'xbar-r' ? 'R' : 'MR')}</text></svg>`;
}
async function pagePqc(main) {
  const tab0 = (() => { try { return sessionStorage.getItem('qPqcTab') || 'process'; } catch { return 'process'; } })();
  main.innerHTML = `<h1>공정품질(PQC) <span class="dept">품질</span></h1>
  <p class="muted">공정별 관리항목(온도·시간·농도 등)과 클린룸 환경(파티클·온습도·차압)의 기준과 측정값을 기록하고, 측정값으로 관리도(X̄-R·I-MR)와 공정능력(Cp·Cpk)을 봅니다. 기준은 품질이, 측정값은 생산·품질이 넣습니다. 이상이 생기면 「이상발생」으로 CAPA에 올립니다.</p>
  <div class="seg q-tabs" id="pqcTabs"><button type="button" data-tab="process">공정 조건·측정</button><button type="button" data-tab="env">환경측정</button><button type="button" data-tab="spc">SPC·공정능력</button><button type="button" data-tab="nc">이상발생</button></div>
  <div class="ip-tiles" id="pqcTiles"></div><div id="pqcBody"></div>`;
  let tab = tab0, pts = { rows: [] }, spcState = { point: null, from: addDays(todayStr(), -90), to: todayStr(), group: 'day' };
  const load = async () => { pts = await api('GET', '/api/pqc/points'); if (main.isConnected) await draw(); };
  main.qReload = () => load().catch(fail);
  const body = $('#pqcBody', main);
  const draw = async () => {
    $$('#pqcTabs button', main).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'process' || tab === 'env') {
      const list = pts.rows.filter(p => p.kind === tab), ms = (await api('GET', `/api/pqc/measures?kind=${tab}&from=${addDays(todayStr(), -30)}`)).rows; if (!main.isConnected || !['process', 'env'].includes(tab)) return;
      qTiles('pqcTiles', [['관리항목', list.filter(p => p.active).length], ['30일 측정', ms.length], ['30일 기준 이탈', ms.filter(m => m.out_of_spec).length, ms.some(m => m.out_of_spec) ? 'red' : ''], ['최근 값 이탈 항목', list.filter(p => p.last?.out_of_spec).length, list.some(p => p.last?.out_of_spec) ? 'red' : '']]);
      body.innerHTML = `<div class="toolbar list-filters"><label class="list-search">찾기<input type="search" data-pqc-q placeholder="${tab === 'env' ? '위치·항목' : '공정·항목'}·LOT·호기"></label><span class="grow"></span>${pts.can_manage ? `<button type="button" class="btn" data-pp-new>＋ ${tab === 'env' ? '측정 지점' : '관리항목'}</button>` : ''}${pts.can_record ? '<button type="button" class="btn primary" data-pqc-rec>측정값 입력</button>' : ''}</div>
        ${list.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>${tab === 'env' ? '위치' : '공정'}</th><th>관리항목</th><th>기준</th><th>측정 주기</th><th>최근 값</th><th>30일 측정 · 이탈</th><th></th></tr></thead><tbody>${list.map(p => `<tr class="${p.active ? (p.last?.out_of_spec ? 'ip-over' : '') : 'row-off'}"><td><b>${esc(p.place)}</b></td><td data-card-primary><b>${esc(p.item)}</b>${p.active ? '' : ' <span class="chip">사용 안 함</span>'}</td><td class="nowrap">${esc(pqcSpec(p))} ${esc(p.unit)}${p.target != null ? `<div class="small muted">목표 ${p.target}</div>` : ''}</td><td>${esc(p.cycle)}</td><td class="nowrap">${p.last ? `<b class="${p.last.out_of_spec ? 'txt-red' : ''}">${fmtN(p.last.value, 4)}</b> <span class="small muted">${esc(p.last.measured_on)}</span>` : '<span class="muted">—</span>'}</td><td>${p.n30} · ${p.out30 ? `<span class="chip red">${p.out30}</span>` : 0}</td><td class="nowrap">${pts.can_record && p.active ? `<button type="button" class="btn small primary" data-pqc-rec="${p.id}">입력</button> ` : ''}<button type="button" class="btn small" data-pqc-spc="${p.id}">관리도</button>${pts.can_manage ? ` <button type="button" class="btn small" data-pp-edit="${p.id}">수정</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${tab === 'env' ? '측정 지점이 없습니다. 클린룸 파티클·온습도·차압 지점을 등록하세요.' : '관리항목이 없습니다. 세탁 수온·시간, 융착 온도 같은 공정 조건을 등록하세요.'}</div>`}
        <h3 class="pqc-h">최근 30일 측정값</h3>${ms.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>측정일시</th><th>${tab === 'env' ? '위치' : '공정'} · 항목</th><th>측정값</th><th>기준</th><th>LOT · 호기</th><th>측정자</th><th></th></tr></thead><tbody data-pqc-ms>${ms.slice(0, 300).map(x => `<tr class="${x.out_of_spec ? 'ip-over' : ''}" data-text="${esc([x.place, x.item, x.lot, x.machine, x.measurer].join(' ').toLowerCase())}"><td class="nowrap">${esc(x.measured_on)} ${esc(x.measured_time)}</td><td>${esc(x.place)} · <b>${esc(x.item)}</b></td><td class="nowrap"><b>${fmtN(x.value, 4)}</b> ${esc(x.unit)} ${x.out_of_spec ? '<span class="chip red">이탈</span>' : ''}</td><td class="nowrap small">${esc(pqcSpec(x))}</td><td>${esc([x.lot, x.machine].filter(Boolean).join(' · '))}</td><td>${esc(x.measurer)}</td><td class="nowrap">${x.out_of_spec ? `<button type="button" class="btn small" data-pqc-nc="${x.id}">이상발생</button> ` : ''}${pts.can_manage || (x.created_by === ME?.name && String(x.created_at).slice(0, 10) === todayStr()) ? `<button type="button" class="btn small danger" data-pqc-del="${x.id}" title="측정값 지우기">×</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">최근 30일 측정값이 없습니다.</p>'}`;
      body.qMs = ms;
    } else if (tab === 'spc') {
      const live = pts.rows.filter(p => p.active || p.n30); if (!spcState.point && live[0]) spcState.point = live[0].id;
      body.innerHTML = `<form class="toolbar list-filters" data-read-only data-spc-form><label class="lf-sel">관리항목<select name="point">${live.map(p => `<option value="${p.id}"${p.id === spcState.point ? ' selected' : ''}>${esc(p.place)} · ${esc(p.item)}</option>`).join('')}</select></label><label>기간<input type="date" name="from" value="${spcState.from}"></label><label>~<input type="date" name="to" value="${spcState.to}"></label><label class="lf-sel">부분군<select name="group"><option value="day"${spcState.group === 'day' ? ' selected' : ''}>같은 날(X̄-R)</option><option value="lot"${spcState.group === 'lot' ? ' selected' : ''}>같은 LOT(X̄-R)</option><option value="none"${spcState.group === 'none' ? ' selected' : ''}>하나씩(I-MR)</option></select></label></form><div data-spc-out></div>`;
      qTiles('pqcTiles', []);
      const f = $('[data-spc-form]', body), outEl = $('[data-spc-out]', body);
      const run = async () => { const v = formObj(f); Object.assign(spcState, { point: Number(v.point), from: v.from, to: v.to, group: v.group }); if (!spcState.point) { outEl.innerHTML = '<div class="empty">관리항목이 없습니다.</div>'; return; }
        const s = await api('GET', `/api/pqc/spc?point_id=${spcState.point}&from=${v.from}&to=${v.to}&group=${v.group}`); if (!outEl.isConnected) return;
        if (!s.chart) { outEl.innerHTML = `<div class="empty">측정값이 ${s.n || 0}개라 관리도를 그릴 수 없습니다(2개 이상).</div>`; return; }
        const p = s.point, capCls = v2 => v2 == null ? '' : v2 >= 1.33 ? 'green' : v2 >= 1 ? 'yellow' : 'red';
        qTiles('pqcTiles', [['표본 수', s.n], ['평균', fmtN(s.mean)], ['σ(군내)', fmtN(s.sigma)], ['Cp', fmtN(s.cp, 2), capCls(s.cp)], ['Cpk', fmtN(s.cpk, 2), capCls(s.cpk)], ['Ppk', fmtN(s.ppk, 2), capCls(s.ppk)], ['규격 이탈', s.out_of_spec, s.out_of_spec ? 'red' : ''], ['관리 이탈 점', s.chart.out.length, s.chart.out.length ? 'red' : '']]);
        outEl.innerHTML = `${s.enough ? '' : `<p class="spc-note">표본이 ${s.n}개(25개 미만)라 Cp·Cpk는 <b>참고값</b>입니다.</p>`}
          <div class="spc-box"><div class="spc-title">${s.chart.type === 'xbar-r' ? `X̄ 관리도 (부분군 ${s.chart.size}개)` : 'I 관리도 (개별값)'} · ${esc(p.place)} ${esc(p.item)} ${esc(p.unit)} · 규격 ${esc(pqcSpec(p))}</div>${spcSvg(s.chart, 'x', p)}
          <div class="spc-title">${s.chart.type === 'xbar-r' ? 'R 관리도(범위)' : 'MR 관리도(이동범위)'}</div>${spcSvg(s.chart, 'r', p)}</div>
          <p class="small muted spc-formula">Cp = (USL − LSL) ÷ 6σ · Cpk = min(USL − μ, μ − LSL) ÷ 3σ · σ는 군내 산포(R̄/d₂ 또는 MR̄/1.128), Pp·Ppk는 전체 표준편차(${fmtN(s.sd)}). 1.33 이상 양호(초록), 1.0~1.33 보통(노랑), 1.0 미만 부족(빨강). 관리 한계를 벗어난 점은 빨간 점입니다.</p>`; };
      f.addEventListener('change', () => run().catch(fail)); await run();
    } else {
      const nc = await api('GET', '/api/ncs?source_type=process'); if (!main.isConnected || tab !== 'nc') return;
      const live = r => !['closed', 'void'].includes(r.status);
      qTiles('pqcTiles', [['진행 중', nc.rows.filter(live).length, nc.rows.some(live) ? 'yellow' : ''], ['종결', nc.rows.filter(r => r.status === 'closed').length, 'green']]);
      body.innerHTML = `<div class="toolbar list-filters"><span class="grow"></span>${pts.can_record ? '<button type="button" class="btn primary" data-pqc-nc-new>＋ 이상발생 등록</button>' : ''}</div>${nc.rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>발생일</th><th>공정 · 항목</th><th>이상 내용</th><th>LOT</th><th>등급</th><th>담당</th><th>단계</th><th></th></tr></thead><tbody>${nc.rows.map(r => `<tr class="${r.status === 'void' ? 'row-off' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.nc_no)}</b></td><td class="nowrap">${esc(r.found_date)}</td><td>${esc(r.source_no)}</td><td><b>${esc(r.title)}</b></td><td>${esc(r.lot)}</td><td><span class="chip ${r.grade === 'critical' ? 'red' : r.grade === 'major' ? 'yellow' : ''}">${esc(r.grade_label)}</span></td><td>${esc(r.owner_name)}</td><td><span class="chip ${NC_STATUS_CHIP[r.status] || ''}">${esc(r.status_label)}</span></td><td>${hasRole('quality') ? `<button type="button" class="btn small" data-pqc-nc-open="${r.id}">열기</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">공정 이상발생 기록이 없습니다.</div>'}`;
    }
  };
  main.addEventListener('click', async e => {
    const tb = e.target.closest('#pqcTabs [data-tab]'); if (tb) { tab = tb.dataset.tab; try { sessionStorage.setItem('qPqcTab', tab); } catch {} return draw().catch(fail); }
    if (e.target.closest('[data-pp-new]')) return ppEdit(null, tab).catch(fail);
    const pe = e.target.closest('[data-pp-edit]'); if (pe) return ppEdit(pts.rows.find(p => p.id === Number(pe.dataset.ppEdit))).catch(fail);
    const rc = e.target.closest('[data-pqc-rec]'); if (rc) return pqcRecord(pts.rows.filter(p => p.kind === tab || tab === 'spc'), Number(rc.dataset.pqcRec) || null).catch(fail);
    const sp = e.target.closest('[data-pqc-spc]'); if (sp) { spcState.point = Number(sp.dataset.pqcSpc); tab = 'spc'; return draw().catch(fail); }
    const nc = e.target.closest('[data-pqc-nc]'); if (nc) { const x = body.qMs.find(m => m.id === Number(nc.dataset.pqcNc)); return pqcAbnormal({ source_no: `${x.place} · ${x.item}`, title: `${x.item} ${fmtN(x.value, 4)}${x.unit} 기준(${pqcSpec(x)}) 이탈`, lot: x.lot, found_date: x.measured_on, detail: `${x.measured_on} ${x.measured_time} ${x.machine ? x.machine + ' ' : ''}측정자 ${x.measurer}` }).catch(fail); }
    if (e.target.closest('[data-pqc-nc-new]')) return pqcAbnormal().catch(fail);
    const no = e.target.closest('[data-pqc-nc-open]'); if (no) return ncOpen(Number(no.dataset.pqcNcOpen)).catch(fail);
    const dl = e.target.closest('[data-pqc-del]'); if (dl) { if (!await confirmBox('이 측정값을 지울까요?')) return; try { await api('DELETE', `/api/pqc/measures/${dl.dataset.pqcDel}`); toast('지웠습니다.'); load(); } catch (err) { fail(err); } }
  });
  main.addEventListener('input', e => { if (!e.target.matches('[data-pqc-q]')) return; const q = e.target.value.trim().toLowerCase(); $$('[data-pqc-ms] tr', body).forEach(tr => { tr.hidden = !!q && !tr.dataset.text.includes(q); }); });
  await load();
}

// C3 시험법·신뢰성
const REL_STATUS_LABEL = { planned: '계획', testing: '시험 중', done: '완료', void: '취소' };
const REL_CHIP = { planned: 'yellow', testing: 'yellow', done: 'green', void: '' };
async function tmEdit(t = null) {
  const inst = (await api('GET', '/api/instruments')).rows.filter(i => i.status !== 'disposed'), chosen = t?.instrument_ids || [];
  let fileEl = null;
  const v = await promptBox(t ? `${t.method_no} 시험법 수정` : '시험법 등록', `<div class="form-grid">
    <label>번호 <span class="hint">(비우면 TM-01…)</span><input name="method_no" maxlength="40" value="${esc(t?.method_no || '')}"${t ? ' disabled' : ''}></label>
    <label class="span2">시험법 이름 *<input name="name" required maxlength="200" value="${esc(t?.name || '')}" placeholder="예) 액중 파티클 시험 · 흡수속도 시험"></label>
    <label class="span2">관련 규격<input name="standard" maxlength="200" list="tmStd" value="${esc(t?.standard || '')}"><datalist id="tmStd">${['IEST-RP-CC004', 'IEST-RP-CC005', 'ASTM E2090', 'ASTM F51', 'KS K 0901', 'ISO 14644-1', '사내 규격'].map(x => `<option value="${x}">`).join('')}</datalist></label>
    ${t ? `<label>상태<select name="status"><option value="active"${t.status === 'active' ? ' selected' : ''}>사용</option><option value="obsolete"${t.status === 'obsolete' ? ' selected' : ''}>폐지</option></select></label>` : ''}
    <label class="span3">측정 항목<input name="items" maxlength="500" value="${esc(t?.items || '')}" placeholder="예) 0.5㎛ 이상 파티클 수, LPC"></label>
    <label class="span3">시험 조건·방법 요약<textarea name="conditions" rows="3" maxlength="2000">${esc(t?.conditions || '')}</textarea></label>
    <label class="span2">SOP 파일 (PDF·사진)${t?.file ? ` · 현재 ${qFileLink(t.file)}` : ''}<input type="file" data-q-file accept="application/pdf,image/jpeg,image/png,image/webp"></label>
    <label class="span3">메모<input name="note" maxlength="1000" value="${esc(t?.note || '')}"></label></div>
    <fieldset class="vendor-sec"><legend>사용 계측기 <span class="hint">(검교정 관리의 계측기)</span></legend><div class="q-chk">${inst.map(i => `<label class="chk"><input type="checkbox" name="instrument_ids" value="${i.id}"${chosen.includes(i.id) ? ' checked' : ''}> ${esc(i.mgmt_no)} ${esc(i.name)}${i.next_due ? ` <span class="small muted">교정 ${esc(i.next_due)}</span>` : ''}</label>`).join('') || '<span class="muted small">검교정 관리에 등록된 계측기가 없습니다.</span>'}</div></fieldset>
    ${t ? '<label class="chk"><input type="checkbox" name="revise" value="1"> 개정으로 저장(Rev +1)</label><label>개정 내용<input name="summary" maxlength="300"></label>' : ''}`, { wide: true,
    onOpen: el => { fileEl = $('[data-q-file]', el); },
    submit: async vals => { const files = await qFiles(fileEl); const b = { ...vals, instrument_ids: (vals.instrument_ids || []).map(Number), files, revise: (vals.revise || []).length > 0 }; return t ? api('PUT', `/api/test-methods/${t.id}`, { ...b, revision: t.revision }) : api('POST', '/api/test-methods', { ...b, request_id: crypto.randomUUID() }); } });
  if (v) { toast(`${v.method_no} 저장했습니다.`); qReload(); }
}
const relSpecRow = (s = {}) => `<tr data-spec-row><td><input data-s="name" maxlength="100" value="${esc(s.name || '')}" placeholder="예) 인장강도"></td><td><input data-s="unit" maxlength="20" value="${esc(s.unit || '')}" class="rel-unit"></td><td><input type="number" step="any" data-s="min" value="${s.min ?? ''}" class="rel-n"></td><td><input type="number" step="any" data-s="max" value="${s.max ?? ''}" class="rel-n"></td><td><button type="button" class="btn small danger" data-spec-del>×</button></td></tr>`;
async function relOpen(id = null) {
  const [list, tms] = await Promise.all([api('GET', '/api/reliability'), api('GET', '/api/test-methods')]);
  const r = id ? list.rows.find(x => x.id === id) : null; if (id && !r) return toast('시험을 찾을 수 없습니다.', 'err');
  const v0 = r || { status: 'planned', spec: [], points: [] }, can = list.can_manage, lock = !can || ['done', 'void'].includes(v0.status), dis = lock ? ' disabled' : '';
  const next = { planned: 'testing', testing: 'done' }[v0.status];
  const m = modal(`<h3>${r ? `${esc(r.test_no)} · ${esc(r.title)} <span class="chip ${REL_CHIP[r.status]}">${esc(r.status_label)}</span>${r.judge ? ` <span class="chip ${r.judge === '적합' ? 'green' : 'red'}">${esc(r.judge)}</span>` : ''}` : '신뢰성평가 계획'}</h3>
    ${r ? qStepper(['planned', 'testing', 'done'], REL_STATUS_LABEL, r.status) : ''}
    <form class="stack" data-rel-form><div class="form-grid">
      <label class="span2">시험명 *<input name="title" required maxlength="200" value="${esc(v0.title || '')}" placeholder="예) 내열 85℃ 500h · 보관 안정성 6개월"${dis}></label>
      <label>시험법<select name="method_id"${dis}><option value="">—</option>${tms.rows.filter(t => t.status === 'active' || t.id === v0.method_id).map(t => `<option value="${t.id}"${t.id === v0.method_id ? ' selected' : ''}>${esc(t.method_no)} ${esc(t.name)}</option>`).join('')}</select></label>
      <label>대상 품목<input name="item" maxlength="200" value="${esc(v0.item || '')}"${dis}></label><label>LOT<input name="lot" maxlength="100" value="${esc(v0.lot || '')}"${dis}></label><label>담당<input name="owner_name" maxlength="50" value="${esc(v0.owner_name || ME?.name || '')}"${dis}></label>
      <label class="span3">시험 조건<input name="conditions" maxlength="1000" value="${esc(v0.conditions || '')}" placeholder="예) 85℃ · 85%RH · 500시간"${dis}></label>
      <label>시작일<input type="date" name="start_date" value="${esc(v0.start_date || '')}"${dis}></label><label>종료일<input type="date" name="end_date" value="${esc(v0.end_date || '')}"${dis}></label></div>
      <fieldset class="vendor-sec"><legend>평가 항목 · 기준</legend><div class="table-wrap"><table class="grid rel-spec" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>항목</th><th>단위</th><th>하한</th><th>상한</th><th></th></tr></thead><tbody>${(v0.spec.length ? v0.spec : lock ? [] : [{}]).map(relSpecRow).join('')}</tbody></table></div>${lock ? '' : '<button type="button" class="btn small" data-spec-add>＋ 항목</button>'}</fieldset>
      <fieldset class="vendor-sec"><legend>측정 <span class="hint">(시점마다 한 줄: 초기 · 중간 · 최종. 기준 밖이면 빨강)</span></legend><div class="table-wrap" data-rel-points></div>${lock ? '' : '<button type="button" class="btn small" data-pt-add>＋ 측정 시점</button>'}<div data-rel-judge class="rel-judge"></div></fieldset>
      <label>메모<input name="note" maxlength="1000" value="${esc(v0.note || '')}"${dis}></label>
      <div class="actions">${r ? '<button type="button" class="btn" data-rel-hist>이력</button>' : ''}${r && can && !lock ? '<button type="button" class="btn danger" data-rel-to="void">취소</button>' : ''}<span class="grow"></span>${!lock ? '<button class="btn">저장</button>' : ''}${r && can && next ? `<button type="button" class="btn primary" data-rel-to="${next}">${next === 'testing' ? '저장하고 시험 시작' : '저장하고 완료(판정)'}</button>` : ''}</div>
    </form>`, { wide: true });
  const form = $('[data-rel-form]', m.el), specTb = $('.rel-spec tbody', form), ptBox = $('[data-rel-points]', form);
  let points = v0.points.map(p => ({ ...p }));
  const specs = () => $$('[data-spec-row]', specTb).map(tr => Object.fromEntries($$('[data-s]', tr).map(i => [i.dataset.s, i.value.trim()]))).filter(s => s.name);
  const readPts = () => { $$('[data-pt]', ptBox).forEach((tr, i) => { points[i] = { label: $('[data-p=label]', tr).value.trim(), date: $('[data-p=date]', tr).value, values: $$('[data-pv]', tr).map(x => x.value === '' ? null : Number(x.value)) }; }); };
  const drawPts = () => { const sp = specs(); ptBox.innerHTML = `<table class="grid rel-pts" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>측정 시점</th><th>측정일</th>${sp.map(s => `<th>${esc(s.name)}${s.unit ? ` (${esc(s.unit)})` : ''}<div class="small muted">${s.min !== '' && s.max !== '' ? `${esc(s.min)} ~ ${esc(s.max)}` : s.min !== '' ? `≥ ${esc(s.min)}` : s.max !== '' ? `≤ ${esc(s.max)}` : ''}</div></th>`).join('')}${lock ? '' : '<th></th>'}</tr></thead><tbody>${points.map((p, i) => `<tr data-pt="${i}"><td><input data-p="label" maxlength="50" value="${esc(p.label || '')}" placeholder="초기"${dis}></td><td><input type="date" data-p="date" value="${esc(p.date || '')}"${dis}></td>${sp.map((s, k) => { const v = p.values?.[k], out = v != null && ((s.min !== '' && v < Number(s.min)) || (s.max !== '' && v > Number(s.max))); return `<td class="${out ? 'rel-out' : ''}"><input type="number" step="any" data-pv="${k}" value="${v ?? ''}" class="rel-n"${dis}></td>`; }).join('')}${lock ? '' : `<td><button type="button" class="btn small danger" data-pt-del="${i}">×</button></td>`}</tr>`).join('') || `<tr><td colspan="${sp.length + 3}" class="muted">측정 시점이 없습니다.</td></tr>`}</tbody></table>`;
    judgePts(); };
  // 값 칸은 다시 그리지 않고 제자리에서 빨강·판정만 바꾼다(다시 그리면 방금 누른 칸이 사라져 입력이 날아감)
  const judgePts = () => { const sp = specs(), isOut = (v, s) => v != null && s && ((s.min !== '' && v < Number(s.min)) || (s.max !== '' && v > Number(s.max)));
    $$('[data-pv]', ptBox).forEach(inp => { const v = inp.value === '' ? null : Number(inp.value); inp.closest('td').classList.toggle('rel-out', !!isOut(v, sp[Number(inp.dataset.pv)])); });
    const vals = points.flatMap(p => (p.values || []).map((v, k) => [v, sp[k]])).filter(([v, s]) => v != null && s), bad2 = vals.some(([v, s]) => isOut(v, s));
    $('[data-rel-judge]', form).innerHTML = vals.length ? `현재 판정: <span class="chip ${bad2 ? 'red' : 'green'}">${bad2 ? '부적합' : '적합'}</span> <span class="small muted">(완료할 때 확정)</span>` : ''; };
  drawPts();
  specTb.addEventListener('change', () => { readPts(); drawPts(); });
  ptBox.addEventListener('input', () => { readPts(); judgePts(); });
  $('[data-spec-add]', form)?.addEventListener('click', () => specTb.insertAdjacentHTML('beforeend', relSpecRow()));
  $('[data-pt-add]', form)?.addEventListener('click', () => { readPts(); points.push({ label: points.length ? '' : '초기', date: todayStr(), values: [] }); drawPts(); });
  form.addEventListener('click', e => { const d = e.target.closest('[data-spec-del]'); if (d) { d.closest('tr').remove(); readPts(); drawPts(); } const p = e.target.closest('[data-pt-del]'); if (p) { readPts(); points.splice(Number(p.dataset.ptDel), 1); drawPts(); } });
  const body = () => { readPts(); const v = formObj(form); return { ...v, spec_json: specs(), points_json: points.filter(p => p.label) }; };
  const save = async (status, extra = {}) => { try { const res = r ? await api('PUT', `/api/reliability/${r.id}`, { ...body(), ...(status ? { status } : {}), revision: r.revision, ...extra }) : await api('POST', '/api/reliability', { ...body(), request_id: crypto.randomUUID() }); toast(status === 'done' ? `완료 — 판정 ${res.judge}` : status ? `「${REL_STATUS_LABEL[status]}」(으)로 넘겼습니다.` : '저장했습니다.'); m.close(); qReload(); await relOpen(res.id); } catch (e) { fail(e); } };
  form.onsubmit = e => { e.preventDefault(); save(null); };
  $$('[data-rel-to]', m.el).forEach(b => b.addEventListener('click', async () => { const to = b.dataset.relTo; if (to === 'void') { const v = await promptBox('시험 취소', '<label>사유 *<input name="reason" required maxlength="300"></label>'); if (v) save('void', v); return; } save(to); }));
  $('[data-rel-hist]', m.el)?.addEventListener('click', () => qHistory(r.test_no, r.history, REL_STATUS_LABEL));
}
async function pageMethods(main) {
  const tab0 = (() => { try { return sessionStorage.getItem('qTmTab') || 'methods'; } catch { return 'methods'; } })();
  main.innerHTML = `<h1>시험법·신뢰성 <span class="dept">품질</span></h1>
  <p class="muted">시험법 대장(번호·관련 규격·측정 항목·조건·사용 계측기·SOP·판)과 신뢰성평가(내열·수명·보관 등: 계획 → 시험 중 → 완료·판정)를 관리합니다. 사용 계측기는 검교정 관리의 다음 교정일을 함께 보여 줍니다.</p>
  <div class="seg q-tabs" id="tmTabs"><button type="button" data-tab="methods">시험법 대장</button><button type="button" data-tab="rel">신뢰성평가</button></div>
  <div class="ip-tiles" id="tmTiles"></div>
  <form class="toolbar list-filters" data-read-only id="tmFilters"><label class="list-search">찾기<input type="search" name="q" placeholder="번호·이름·규격·품목·LOT"></label><span class="grow"></span><span id="tmTools" class="ip-tools"></span></form>
  <div id="tmList"></div>`;
  const form = $('#tmFilters', main); let tab = tab0, tm = { rows: [] }, rel = { rows: [] };
  const load = async () => { [tm, rel] = await Promise.all([api('GET', '/api/test-methods'), api('GET', '/api/reliability')]); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const draw = () => {
    $$('#tmTabs button', main).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const q = (formObj(form).q || '').trim().toLowerCase();
    if (tab === 'methods') {
      const calOver = t => t.instruments.some(i => i.next_due && i.next_due < tm.today);
      qTiles('tmTiles', [['사용 중 시험법', tm.rows.filter(t => t.status === 'active').length, 'green'], ['교정 지난 계측기 사용', tm.rows.filter(t => t.status === 'active' && calOver(t)).length, tm.rows.some(t => t.status === 'active' && calOver(t)) ? 'red' : ''], ['폐지', tm.rows.filter(t => t.status === 'obsolete').length]]);
      $('#tmTools', main).innerHTML = tm.can_manage ? '<button type="button" class="btn primary" id="tmNewBtn">＋ 시험법</button>' : '';
      const rows = tm.rows.filter(t => !q || [t.method_no, t.name, t.standard, t.items].join(' ').toLowerCase().includes(q));
      $('#tmList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>시험법</th><th>관련 규격</th><th>측정 항목</th><th>사용 계측기</th><th>판</th><th>SOP</th><th>상태</th><th></th></tr></thead><tbody>${rows.map(t => `<tr class="${t.status === 'obsolete' ? 'row-off' : calOver(t) ? 'ip-over' : ''}"><td class="nowrap" data-card-primary><b>${esc(t.method_no)}</b></td><td><b>${esc(t.name)}</b>${t.conditions ? `<div class="small muted tm-cond">${esc(t.conditions)}</div>` : ''}</td><td>${esc(t.standard)}</td><td class="small">${esc(t.items)}</td><td class="small">${t.instruments.map(i => `${esc(i.mgmt_no)} ${esc(i.name)}${i.next_due ? qDd(i.next_due, tm.today, true, 30) : ''}`).join('<br>')}</td><td class="nowrap">Rev.${t.rev}</td><td>${qFileLink(t.file, '열기') || '<span class="muted small">—</span>'}</td><td><span class="chip ${t.status === 'active' ? 'green' : ''}">${t.status === 'active' ? '사용' : '폐지'}</span></td><td class="nowrap"><button type="button" class="btn small" data-tm-hist="${t.id}">이력</button>${tm.can_manage ? ` <button type="button" class="btn small" data-tm-edit="${t.id}">수정</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${tm.rows.length ? '조건에 맞는 시험법이 없습니다.' : '등록된 시험법이 없습니다. 「＋ 시험법」으로 파티클·흡수속도 시험 등을 넣으세요.'}</div>`;
    } else {
      qTiles('tmTiles', [['계획', rel.rows.filter(r => r.status === 'planned').length], ['시험 중', rel.rows.filter(r => r.status === 'testing').length, rel.rows.some(r => r.status === 'testing') ? 'yellow' : ''], ['완료 · 적합', rel.rows.filter(r => r.status === 'done' && r.judge === '적합').length, 'green'], ['완료 · 부적합', rel.rows.filter(r => r.status === 'done' && r.judge === '부적합').length, rel.rows.some(r => r.judge === '부적합') ? 'red' : '']]);
      $('#tmTools', main).innerHTML = rel.can_manage ? '<button type="button" class="btn primary" id="relNewBtn">＋ 신뢰성평가</button>' : '';
      const rows = rel.rows.filter(r => !q || [r.test_no, r.title, r.item, r.lot, r.conditions].join(' ').toLowerCase().includes(q));
      $('#tmList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>시험명</th><th>품목 · LOT</th><th>조건</th><th>기간</th><th>측정</th><th>판정</th><th>단계</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-rel-row="${r.id}" class="${r.status === 'void' ? 'row-off' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.test_no)}</b></td><td><b>${esc(r.title)}</b></td><td>${esc(r.item)}${r.lot ? `<div class="small muted">${esc(r.lot)}</div>` : ''}</td><td class="small">${esc(r.conditions)}</td><td class="nowrap">${esc(r.start_date || '')}${r.end_date ? ` ~ ${esc(r.end_date)}` : ''}</td><td>${r.points.length}회</td><td>${r.judge ? `<span class="chip ${r.judge === '적합' ? 'green' : 'red'}">${esc(r.judge)}</span>` : r.judge_now ? `<span class="small muted">현재 ${esc(r.judge_now)}</span>` : ''}</td><td><span class="chip ${REL_CHIP[r.status]}">${esc(r.status_label)}</span></td><td><button type="button" class="btn small" data-rel-open="${r.id}">열기</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${rel.rows.length ? '조건에 맞는 시험이 없습니다.' : '등록된 신뢰성평가가 없습니다.'}</div>`;
    }
  };
  main.addEventListener('click', e => {
    const tb = e.target.closest('#tmTabs [data-tab]'); if (tb) { tab = tb.dataset.tab; try { sessionStorage.setItem('qTmTab', tab); } catch {} draw(); return; }
    if (e.target.closest('#tmNewBtn')) return tmEdit().catch(fail);
    if (e.target.closest('#relNewBtn')) return relOpen().catch(fail);
    const te = e.target.closest('[data-tm-edit]'); if (te) return tmEdit(tm.rows.find(t => t.id === Number(te.dataset.tmEdit))).catch(fail);
    const th = e.target.closest('[data-tm-hist]'); if (th) { const t = tm.rows.find(x => x.id === Number(th.dataset.tmHist)); return qHistory(`${t.method_no} ${t.name}`, t.history); }
    const ro = e.target.closest('[data-rel-open]'); if (ro) relOpen(Number(ro.dataset.relOpen)).catch(fail);
  });
  form.addEventListener('input', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// ── 15.308 품질 4단계: 심사(Audit) 관리 · 밸리데이션 · 품질목표·KPI · 리스크 관리 ──
const AUD_KIND_LABEL = { customer: '고객사 수검', internal: '내부심사', supplier: '협력사 심사', cert: '인증심사' };
const AUD_STATUS_LABEL = { planned: '계획', done: '실시', correcting: '시정 중', closed: '종결', void: '취소' };
const AUD_CHIP = { planned: 'yellow', done: 'yellow', correcting: 'red', closed: 'green', void: '' };
const FND_GRADE_LABEL = { major: '중대(Major)', minor: '경미(Minor)', obs: '권고(관찰)' };
const AUD_TEMPLATE = ['품질방침·목표가 정해지고 공유되는가?', '문서는 최신판이 배포·사용되는가?', '교육·자격 기록이 유지되는가?', '계측기는 교정 기한 안에 있는가?', '부적합품은 식별·격리되는가?', '시정조치(CAPA)는 기한 안에 종결되는가?', '협력업체 평가·관리 기록이 있는가?', '고객 불만(VOC)은 기록·처리되는가?'];
const audClRow = (c = {}, dis = '') => `<tr data-cl><td><input data-c="q" maxlength="300" value="${esc(c.q || '')}"${dis}></td><td><select data-c="result"${dis}>${['', '적합', '부적합', '관찰', '해당 없음'].map(x => `<option value="${x}"${(c.result || '') === x ? ' selected' : ''}>${x || '—'}</option>`).join('')}</select></td><td><input data-c="note" maxlength="300" value="${esc(c.note || '')}"${dis}></td>${dis ? '' : '<td><button type="button" class="btn small danger" data-cl-del>×</button></td>'}</tr>`;
async function audOpen(id = null, pre = {}) {
  const list = await api('GET', '/api/audits'), a = id ? list.rows.find(x => x.id === id) : null; if (id && !a) return toast('심사를 찾을 수 없습니다.', 'err');
  const v0 = a || { kind: pre.kind || 'internal', status: 'planned', plan_date: todayStr(), checklist: [], findings: [], files: [], ...pre }, can = list.can_manage, end = ['closed', 'void'].includes(v0.status), dis = !can || end ? ' disabled' : '';
  const flow = ['planned', 'done', 'correcting', 'closed'];
  const m = modal(`<h3>${a ? `${esc(a.audit_no)} · ${esc(a.title)} <span class="chip ${AUD_CHIP[a.status]}">${esc(a.status_label)}</span>` : '심사 계획'}</h3>
    ${a ? qStepper(flow, AUD_STATUS_LABEL, a.status) : ''}
    <form class="stack" data-aud-form><div class="form-grid">
      <label class="span2">심사명 *<input name="title" required maxlength="200" value="${esc(v0.title || '')}" placeholder="예) 2026 상반기 내부심사 · 삼성 2차 수검"${dis}></label>
      <label>유형<select name="kind"${dis}>${Object.entries(AUD_KIND_LABEL).map(([k, l]) => `<option value="${k}"${v0.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>대상(부서·협력사·고객사)<input name="target" maxlength="100" value="${esc(v0.target || '')}"${dis}></label>
      <label data-aud-cert>인증서<select name="cert_id"${dis}><option value="">—</option>${list.certs.map(c => `<option value="${c.id}"${c.id === v0.cert_id ? ' selected' : ''}>${esc(c.kind)} ${esc(c.cert_no)}${c.next_audit ? ` (다음 심사 ${esc(c.next_audit)})` : ''}</option>`).join('')}</select></label>
      <label>심사원<input name="auditors" maxlength="200" value="${esc(v0.auditors || '')}"${dis}></label>
      <label>예정일 *<input type="date" name="plan_date" required value="${esc(v0.plan_date || '')}"${dis}></label><label>실시일<input type="date" name="done_date" value="${esc(v0.done_date || '')}" max="${todayStr()}"${dis}></label>
      <label class="span3">범위<input name="scope" maxlength="1000" value="${esc(v0.scope || '')}" placeholder="예) ISO 9001 7~10조 · 세탁·포장 공정"${dis}></label></div>
      <fieldset class="vendor-sec"><legend>체크리스트</legend><div class="table-wrap"><table class="grid aud-cl" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>질문·확인 사항</th><th>결과</th><th>메모·증거</th>${dis ? '' : '<th></th>'}</tr></thead><tbody>${v0.checklist.map(c => audClRow(c, dis)).join('')}</tbody></table></div>${dis ? '' : '<div class="actions"><button type="button" class="btn small" data-cl-add>＋ 질문</button><button type="button" class="btn small" data-cl-tpl>기본 체크리스트 넣기</button></div>'}</fieldset>
      ${a ? `<fieldset class="vendor-sec"><legend>지적사항 <span class="hint">(중대·경미는 CAPA가 자동으로 만들어지고, CAPA를 종결하면 닫힙니다)</span></legend>${a.findings.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>등급</th><th>조항</th><th>지적 내용</th><th>부서</th><th>시정 기한</th><th>CAPA</th><th></th></tr></thead><tbody>${a.findings.map(f => `<tr class="${f.closed ? 'row-off' : f.due_date && f.due_date < list.today ? 'ip-over' : ''}"><td class="nowrap"><span class="chip ${f.grade === 'major' ? 'red' : f.grade === 'minor' ? 'yellow' : ''}">${esc(f.grade_label)}</span></td><td>${esc(f.clause)}</td><td>${esc(f.content)}</td><td>${esc(f.dept)}</td><td class="nowrap">${esc(f.due_date || '')}${f.closed ? '' : qDd(f.due_date, list.today, true, 7)}</td><td class="nowrap">${f.nc_id ? `<a href="#/quality/capa" data-aud-nc="${f.nc_id}">${esc(f.nc_no)}</a> <span class="chip ${NC_STATUS_CHIP[f.nc_status] || ''}">${esc(f.nc_status_label)}</span>` : ''}</td><td>${f.grade === 'obs' && can && !end ? `<label class="chk"><input type="checkbox" data-obs="${f.id}"${f.obs_done ? ' checked' : ''}> 확인</label>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">지적사항이 없습니다.</p>'}${can && !end ? '<button type="button" class="btn small" data-fnd-add>＋ 지적사항</button>' : ''}</fieldset>` : ''}
      <fieldset class="vendor-sec"><legend>결과 요약 · 보고서</legend><label>요약<textarea name="summary" rows="2" maxlength="2000"${dis}>${esc(v0.summary || '')}</textarea></label>
        ${v0.files.length ? `<div class="scoa-files">${v0.files.map(f => `<label class="chk">${can && !end ? `<input type="checkbox" name="keep_files" value="${esc(f.file)}" checked> ` : ''}${qFileLink(f)}</label>`).join('')}</div>` : ''}${can && !end ? '<label>보고서·대응보고서 파일 추가 (PDF·사진)<input type="file" multiple data-q-file accept="application/pdf,image/jpeg,image/png,image/webp"></label>' : ''}</fieldset>
      <div class="actions">${a ? '<button type="button" class="btn" data-aud-hist>이력</button><button type="button" class="btn" data-aud-rpt>심사 보고서</button>' : ''}${a && can && !end && !a.findings.length ? '<button type="button" class="btn danger" data-aud-to="void">취소</button>' : ''}${a && a.cert_id ? '<a class="btn" href="#/quality/certs">인증서 관리</a>' : ''}<span class="grow"></span>${can && !end ? '<button class="btn">저장</button>' : ''}${a && can && a.status === 'planned' ? '<button type="button" class="btn primary" data-aud-to="done">저장하고 실시 완료</button>' : ''}${a && can && ['done', 'correcting'].includes(a.status) ? '<button type="button" class="btn primary" data-aud-to="closed">종결</button>' : ''}${a && list.can_manage && end && hasRole('quality_approver') && a.status === 'closed' ? '<button type="button" class="btn" data-aud-to="planned">다시 열기</button>' : ''}</div>
    </form>`, { wide: true });
  const form = $('[data-aud-form]', m.el), tb = $('.aud-cl tbody', form);
  const certVis = () => { $('[data-aud-cert]', form).hidden = form.elements.kind.value !== 'cert'; }; certVis(); form.elements.kind.addEventListener('change', certVis);
  $('[data-cl-add]', form)?.addEventListener('click', () => tb.insertAdjacentHTML('beforeend', audClRow()));
  $('[data-cl-tpl]', form)?.addEventListener('click', () => { const have = $$('[data-c=q]', tb).map(i => i.value); tb.insertAdjacentHTML('beforeend', AUD_TEMPLATE.filter(q => !have.includes(q)).map(q => audClRow({ q })).join('')); });
  form.addEventListener('click', e => { const d = e.target.closest('[data-cl-del]'); if (d) d.closest('tr').remove(); const n = e.target.closest('[data-aud-nc]'); if (n) { e.preventDefault(); m.close(); ncOpen(Number(n.dataset.audNc)).catch(fail); } });
  form.addEventListener('change', async e => { const o = e.target.closest('[data-obs]'); if (!o) return; try { await api('PUT', `/api/audits/${a.id}/findings/${o.dataset.obs}`, { obs_done: o.checked }); toast(o.checked ? '권고 사항을 확인했습니다.' : '확인을 풀었습니다.'); qReload(); } catch (err) { fail(err); } });
  const body = async () => { const v = formObj(form); v.checklist = $$('[data-cl]', tb).map(tr => Object.fromEntries($$('[data-c]', tr).map(i => [i.dataset.c, i.value.trim()]))).filter(c => c.q); v.files = await qFiles($('[data-q-file]', form)); v.keep_files = v.keep_files || []; return v; };
  const save = async (status, extra = {}) => { try { const b = await body(); const r = a ? await api('PUT', `/api/audits/${a.id}`, { ...b, ...(status ? { status } : {}), revision: a.revision, ...extra }) : await api('POST', '/api/audits', { ...b, request_id: crypto.randomUUID() }); if (!a && b.files.length) await api('PUT', `/api/audits/${r.id}`, { files: b.files, revision: r.revision }); toast(status ? `「${AUD_STATUS_LABEL[r.status]}」(으)로 넘겼습니다.` : '저장했습니다.'); m.close(); qReload(); await audOpen(r.id); } catch (e) { fail(e); } };
  form.onsubmit = e => { e.preventDefault(); save(null); };
  $$('[data-aud-to]', m.el).forEach(b => b.addEventListener('click', async () => { const to = b.dataset.audTo; if (to === 'void') { const v = await promptBox('심사 취소', '<label>사유 *<input name="reason" required maxlength="300"></label>'); if (v) save(to, v); return; } save(to); }));
  $('[data-aud-hist]', m.el)?.addEventListener('click', () => qHistory(a.audit_no, a.history, AUD_STATUS_LABEL));
  $('[data-aud-rpt]', m.el)?.addEventListener('click', () => audReport(a).catch(fail)); // 15.312
  $('[data-fnd-add]', m.el)?.addEventListener('click', async () => {
    const v = await promptBox('지적사항 등록', `<p class="small muted">중대·경미 지적은 부적합·CAPA(출처: 심사 지적)가 자동으로 만들어집니다. 시정 기한 기본값은 중대 30일, 경미 60일입니다.</p><div class="form-grid"><label>등급 *<select name="grade">${Object.entries(FND_GRADE_LABEL).map(([k, l]) => `<option value="${k}"${k === 'minor' ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label>조항<input name="clause" maxlength="100" placeholder="예) ISO 9001 7.5.3"></label><label>부서<input name="dept" maxlength="50"></label><label class="span3">지적 내용 *<textarea name="content" required rows="2" maxlength="1000"></textarea></label><label>시정 기한<input type="date" name="due_date"></label><label>CAPA 담당<input name="owner_name" maxlength="50"></label></div>`, { wide: true,
      submit: async vals => api('POST', `/api/audits/${a.id}/findings`, { ...vals, request_id: crypto.randomUUID() }) });
    if (v) { const f = v.findings.at(-1); toast(f.nc_no ? `지적사항을 등록하고 ${f.nc_no} CAPA를 만들었습니다.` : '권고 사항을 등록했습니다.'); m.close(); qReload(); await audOpen(a.id); }
  });
}
async function pageAudits(main) {
  main.innerHTML = `<h1>심사(Audit) 관리 <span class="dept">품질</span></h1>
  <p class="muted">고객사 수검·내부심사·협력사 심사·인증심사를 <b>계획 → 실시 → 시정 중 → 종결</b>로 관리합니다. 체크리스트로 실시하고, 중대·경미 지적은 부적합·CAPA로 자동 등록되며 CAPA가 모두 종결되어야 심사를 종결합니다. 대응보고서는 파일로 붙입니다.</p>
  <div class="ip-tiles" id="audTiles"></div>
  <form class="toolbar list-filters" data-read-only id="audFilters"><label class="lf-sel">유형<select name="kind"><option value="">전체</option>${Object.entries(AUD_KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">단계<select name="st"><option value="live">진행 중</option><option value="">전체</option>${Object.entries(AUD_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="list-search">찾기<input type="search" name="q" placeholder="번호·심사명·대상·심사원"></label><span class="grow"></span><span id="audTools" class="ip-tools"></span></form>
  <div id="audList"></div>`;
  const form = $('#audFilters', main); let data = { rows: [], today: todayStr() };
  const load = async () => { data = await api('GET', '/api/audits'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const live = r => !['closed', 'void'].includes(r.status);
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows, open = all.reduce((s, r) => s + (live(r) ? r.open_findings : 0), 0);
    qTiles('audTiles', [['진행 중', all.filter(live).length], ['계획', all.filter(r => r.status === 'planned').length], ['시정 중', all.filter(r => r.status === 'correcting').length, all.some(r => r.status === 'correcting') ? 'yellow' : ''], ['열린 지적', open, open ? 'red' : ''], ['종결', all.filter(r => r.status === 'closed').length, 'green']]);
    $('#audTools', main).innerHTML = data.can_manage ? '<button type="button" class="btn primary" id="audNewBtn">＋ 심사 계획</button>' : '';
    const rows = all.filter(r => (!v.kind || r.kind === v.kind) && (v.st === 'live' ? live(r) : !v.st || r.status === v.st) && (!q || [r.audit_no, r.title, r.target, r.auditors].join(' ').toLowerCase().includes(q)));
    $('#audList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>유형</th><th>심사명</th><th>대상</th><th>예정일</th><th>실시일</th><th>지적(중·경·권고)</th><th>열린 지적</th><th>단계</th><th></th></tr></thead><tbody>${rows.map(r => { const c = g => r.findings.filter(f => f.grade === g).length; return `<tr data-aud-row="${r.id}" class="${r.status === 'void' ? 'row-off' : r.status === 'planned' && r.plan_date < data.today ? 'ip-over' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.audit_no)}</b></td><td class="nowrap">${esc(r.kind_label)}${r.cert_label ? `<div class="small muted">${esc(r.cert_label)}</div>` : ''}</td><td><b>${esc(r.title)}</b></td><td>${esc(r.target)}</td><td class="nowrap">${esc(r.plan_date)}${r.status === 'planned' ? qDd(r.plan_date, data.today, true, 14) : ''}</td><td class="nowrap">${esc(r.done_date || '')}</td><td class="nowrap">${c('major')} · ${c('minor')} · ${c('obs')}</td><td>${r.open_findings ? `<span class="chip red">${r.open_findings}</span>` : 0}</td><td><span class="chip ${AUD_CHIP[r.status]}">${esc(r.status_label)}</span></td><td><button type="button" class="btn small" data-aud-open="${r.id}">열기</button></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 심사가 없습니다.' : '등록된 심사가 없습니다. 「＋ 심사 계획」으로 내부심사·고객사 수검 일정을 넣으세요.'}</div>`;
  };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-q-tile]'); if (t) { form.elements.st.value = ['live', 'planned', 'correcting', 'correcting', 'closed'][Number(t.dataset.qTile)]; draw(); return; }
    if (e.target.closest('#audNewBtn')) return audOpen().catch(fail);
    const o = e.target.closest('[data-aud-open]'); if (o) audOpen(Number(o.dataset.audOpen)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// A6 밸리데이션
const VAL_KIND_LABEL = { equipment: '설비 적격성(IQ·OQ·PQ)', process: '공정 밸리데이션', method: '시험법 밸리데이션', cleaning: '세척 밸리데이션', system: '컴퓨터 시스템' };
const VAL_STAGES = { equipment: ['IQ(설치)', 'OQ(운전)', 'PQ(성능)'], process: ['PQ 1차 배치', 'PQ 2차 배치', 'PQ 3차 배치'], method: ['특이성', '정확성', '정밀성', '직선성·범위', '검출한계'], cleaning: ['1차', '2차', '3차'], system: ['IQ', 'OQ', 'PQ'] };
const VAL_STATUS_LABEL = { planned: '계획', running: '수행', pass: '적합', fail: '부적합', void: '취소' };
const VAL_CHIP = { planned: 'yellow', running: 'yellow', pass: 'green', fail: 'red', void: '' };
const valStageRow = (s = {}, dis = '') => `<tr data-st><td><input data-v="key" maxlength="50" value="${esc(s.key || '')}"${dis}></td><td><input type="date" data-v="plan_date" value="${esc(s.plan_date || '')}"${dis}></td><td><input type="date" data-v="done_date" value="${esc(s.done_date || '')}" max="${todayStr()}"${dis}></td><td><select data-v="result"${dis}>${['', '적합', '부적합'].map(x => `<option value="${x}"${(s.result || '') === x ? ' selected' : ''}>${x || '—'}</option>`).join('')}</select></td><td><input data-v="note" maxlength="500" value="${esc(s.note || '')}"${dis}></td>${dis ? '' : '<td><button type="button" class="btn small danger" data-st-del>×</button></td>'}</tr>`;
async function valOpen(id = null, pre = {}) {
  const list = await api('GET', '/api/validations'), v = id ? list.rows.find(x => x.id === id) : null; if (id && !v) return toast('밸리데이션을 찾을 수 없습니다.', 'err');
  const v0 = v || { kind: 'equipment', target_type: 'equipment', status: 'planned', stages: VAL_STAGES.equipment.map(key => ({ key })), files: [], cycle_months: 12, ...pre }, can = list.can_manage, end = ['pass', 'fail', 'void'].includes(v0.status), dis = !can || end ? ' disabled' : '';
  const m = modal(`<h3>${v ? `${esc(v.val_no)} · ${esc(v.title)} <span class="chip ${VAL_CHIP[v.status]}">${esc(v.status_label)}</span>` : '밸리데이션 계획'}</h3>
    ${v ? `<p class="small muted">${esc(v.kind_label)} · 대상 ${esc(v.target_label)}${v.judged_by ? ` · 판정 ${esc(v.judged_by)} ${esc(String(v.judged_at || '').slice(0, 10))}` : ''}${v.valid_until ? ` · 재밸리데이션 기한 <b>${esc(v.valid_until)}</b>${qDd(v.valid_until, list.today, v.status === 'pass', 60)}` : ''}${v.change_id ? ` · 변경 #${v.change_id}` : ''}</p>` : ''}
    ${pre.change_no ? `<p class="small">변경 <b>${esc(pre.change_no)}</b>의 재밸리데이션으로 연결합니다.</p>` : ''}
    <form class="stack" data-val-form><div class="form-grid">
      <label class="span2">이름 *<input name="title" required maxlength="200" value="${esc(v0.title || '')}"${dis}></label>
      <label>종류<select name="kind"${dis}>${Object.entries(VAL_KIND_LABEL).map(([k, l]) => `<option value="${k}"${v0.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>대상 구분<select name="target_type"${dis}><option value="equipment"${v0.target_type === 'equipment' ? ' selected' : ''}>설비</option><option value="method"${v0.target_type === 'method' ? ' selected' : ''}>시험법</option><option value="process"${v0.target_type === 'process' ? ' selected' : ''}>공정</option><option value="other"${v0.target_type === 'other' ? ' selected' : ''}>기타·시스템</option></select></label>
      <label class="span2" data-tgt="equipment">설비<select name="target_id_eq"${dis}><option value="">—</option>${list.equipment.map(e => `<option value="${e.id}"${v0.target_type === 'equipment' && e.id === v0.target_id ? ' selected' : ''}>${esc(e.equip_no)} ${esc(e.name)}</option>`).join('')}</select></label>
      <label class="span2" data-tgt="method">시험법<select name="target_id_tm"${dis}><option value="">—</option>${list.methods.map(t => `<option value="${t.id}"${v0.target_type === 'method' && t.id === v0.target_id ? ' selected' : ''}>${esc(t.method_no)} ${esc(t.name)}</option>`).join('')}</select></label>
      <label class="span2" data-tgt="text">대상 이름<input name="target_label" maxlength="200" value="${esc(['process', 'other'].includes(v0.target_type) ? v0.target_label || '' : '')}" placeholder="예) 세탁 공정 · ERP 품질 모듈"${dis}></label>
      <label>재밸리데이션 주기(개월) <span class="hint">(0 = 없음)</span><input type="number" name="cycle_months" min="0" max="120" value="${v0.cycle_months ?? 12}"${dis}></label><label>담당<input name="owner_name" maxlength="50" value="${esc(v0.owner_name || ME?.name || '')}"${dis}></label>
      <label class="span3">판정 기준(합격 기준)<textarea name="criteria" rows="2" maxlength="2000"${dis}>${esc(v0.criteria || '')}</textarea></label></div>
      <fieldset class="vendor-sec"><legend>단계 <span class="hint">(수행일과 결과를 넣으면 「수행」으로)</span></legend><div class="table-wrap"><table class="grid val-st" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>단계</th><th>예정일</th><th>수행일</th><th>결과</th><th>메모</th>${dis ? '' : '<th></th>'}</tr></thead><tbody>${v0.stages.map(s => valStageRow(s, dis)).join('')}</tbody></table></div>${dis ? '' : '<div class="actions"><button type="button" class="btn small" data-st-add>＋ 단계</button><button type="button" class="btn small" data-st-tpl>종류별 기본 단계로</button></div>'}</fieldset>
      <fieldset class="vendor-sec"><legend>프로토콜 · 보고서</legend>${v0.files.length ? `<div class="scoa-files">${v0.files.map(f => `<label class="chk">${can && !end ? `<input type="checkbox" name="keep_files" value="${esc(f.file)}" checked> ` : ''}<span class="chip">${esc(f.doc || '')}</span> ${qFileLink(f)}</label>`).join('')}</div>` : ''}${can && !end ? `<div class="form-grid"><label>문서 구분<select name="file_doc">${['프로토콜', '보고서', '데이터', '기타'].map(x => `<option${x === (v ? '보고서' : '프로토콜') ? ' selected' : ''}>${x}</option>`).join('')}</select></label><label class="span2">파일 추가 (PDF·사진)<input type="file" multiple data-q-file accept="application/pdf,image/jpeg,image/png,image/webp"></label></div>` : ''}</fieldset>
      ${v?.judge_note ? `<p><b>판정 의견</b> ${esc(v.judge_note)}</p>` : ''}
      <div class="actions">${v ? '<button type="button" class="btn" data-val-hist>이력</button>' : ''}${v && can && !end ? '<button type="button" class="btn danger" data-val-void>취소</button>' : ''}${v && can && ['pass', 'fail'].includes(v.status) ? '<button type="button" class="btn" data-val-again>재밸리데이션</button>' : ''}<span class="grow"></span>${can && !end ? '<button class="btn">저장</button>' : ''}${v && list.can_judge && !end ? '<button type="button" class="btn danger" data-val-judge="fail">부적합 판정</button><button type="button" class="btn primary" data-val-judge="pass">적합 판정</button>' : ''}</div>
    </form>`, { wide: true });
  const form = $('[data-val-form]', m.el), tb = $('.val-st tbody', form);
  const tgt = () => { const t = form.elements.target_type.value; $$('[data-tgt]', form).forEach(l => { l.hidden = l.dataset.tgt !== (['process', 'other'].includes(t) ? 'text' : t); }); }; tgt(); form.elements.target_type.addEventListener('change', tgt);
  $('[data-st-add]', form)?.addEventListener('click', () => tb.insertAdjacentHTML('beforeend', valStageRow()));
  $('[data-st-tpl]', form)?.addEventListener('click', () => { tb.innerHTML = VAL_STAGES[form.elements.kind.value].map(key => valStageRow({ key })).join(''); });
  form.elements.kind.addEventListener('change', () => { if (!$$('[data-v=done_date]', tb).some(i => i.value)) tb.innerHTML = VAL_STAGES[form.elements.kind.value].map(key => valStageRow({ key })).join(''); const tt = { equipment: 'equipment', method: 'method' }[form.elements.kind.value]; if (tt) { form.elements.target_type.value = tt; tgt(); } });
  form.addEventListener('click', e => { const d = e.target.closest('[data-st-del]'); if (d) d.closest('tr').remove(); });
  const body = async () => { const x = formObj(form), t = x.target_type; return { ...x, target_id: t === 'equipment' ? x.target_id_eq : t === 'method' ? x.target_id_tm : null, stages: $$('[data-st]', tb).map(tr => Object.fromEntries($$('[data-v]', tr).map(i => [i.dataset.v, i.value.trim()]))).filter(s => s.key), files: await qFiles($('[data-q-file]', form)), keep_files: x.keep_files || [], change_id: v0.change_id || null }; };
  const reopen = async rid => { m.close(); qReload(); await valOpen(rid); };
  form.onsubmit = async e => { e.preventDefault(); try { const b = await body(); const r = v ? await api('PUT', `/api/validations/${v.id}`, { ...b, revision: v.revision }) : await api('POST', '/api/validations', { ...b, request_id: crypto.randomUUID() }); toast('저장했습니다.'); await reopen(r.id); } catch (err) { fail(err); } };
  $('[data-val-void]', m.el)?.addEventListener('click', async () => { const x = await promptBox('밸리데이션 취소', '<label>사유 *<input name="reason" required maxlength="300"></label>'); if (!x) return; try { await api('PUT', `/api/validations/${v.id}`, { ...(await body()), status: 'void', reason: x.reason, revision: v.revision }); toast('취소했습니다.'); await reopen(v.id); } catch (err) { fail(err); } });
  $$('[data-val-judge]', m.el).forEach(b => b.addEventListener('click', async () => { const res = b.dataset.valJudge; const x = await promptBox(res === 'pass' ? '적합 판정' : '부적합 판정', `<p class="small muted">판정 전에 저장하지 않은 변경은 먼저 「저장」하세요.${res === 'pass' && v.cycle_months ? ` 재밸리데이션 기한은 오늘부터 ${v.cycle_months}개월로 잡힙니다.` : ''}</p><label>판정 의견<textarea name="note" rows="2" maxlength="1000"></textarea></label>`); if (!x) return; try { await api('POST', `/api/validations/${v.id}/judge`, { result: res, note: x.note, revision: v.revision }); toast(res === 'pass' ? '적합으로 판정했습니다.' : '부적합으로 판정했습니다.'); await reopen(v.id); } catch (err) { fail(err); } }));
  $('[data-val-again]', m.el)?.addEventListener('click', () => { m.close(); valOpen(null, { title: `${v.title} (재밸리데이션)`, kind: v.kind, target_type: v.target_type, target_id: v.target_id, target_label: v.target_label, criteria: v.criteria, cycle_months: v.cycle_months, stages: v.stages.map(s => ({ key: s.key })) }).catch(fail); });
  $('[data-val-hist]', m.el)?.addEventListener('click', () => qHistory(v.val_no, v.history, VAL_STATUS_LABEL));
}
async function pageValidations(main) {
  main.innerHTML = `<h1>밸리데이션 <span class="dept">품질</span></h1>
  <p class="muted">설비 적격성(IQ·OQ·PQ), 공정·시험법·세척 밸리데이션을 단계별로 수행하고 프로토콜·보고서를 붙입니다. 판정(적합·부적합)은 품질책임자가 하며, 적합이면 재밸리데이션 기한(판정일 + 주기)을 D-day로 봅니다. 변경관리 영향평가에서 「재밸리데이션 있음」이면 바로 만들 수 있습니다.</p>
  <div class="ip-tiles" id="valTiles"></div>
  <form class="toolbar list-filters" data-read-only id="valFilters"><label class="lf-sel">종류<select name="kind"><option value="">전체</option>${Object.entries(VAL_KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">상태<select name="st"><option value="">전체</option>${Object.entries(VAL_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="due">재밸리데이션 60일 안·지남</option></select></label><label class="list-search">찾기<input type="search" name="q" placeholder="번호·이름·대상"></label><span class="grow"></span><span id="valTools" class="ip-tools"></span></form>
  <div id="valList"></div>`;
  const form = $('#valFilters', main); let data = { rows: [], today: todayStr() };
  const load = async () => { data = await api('GET', '/api/validations'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const due = r => r.status === 'pass' && r.valid_until && ipDday(r.valid_until, data.today) <= 60;
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows;
    qTiles('valTiles', [['계획·수행', all.filter(r => ['planned', 'running'].includes(r.status)).length, ''], ['적합', all.filter(r => r.status === 'pass').length, 'green'], ['부적합', all.filter(r => r.status === 'fail').length, all.some(r => r.status === 'fail') ? 'red' : ''], ['재밸리데이션 60일 안·지남', all.filter(due).length, all.some(due) ? 'yellow' : '']]);
    $('#valTools', main).innerHTML = data.can_manage ? '<button type="button" class="btn primary" id="valNewBtn">＋ 밸리데이션</button>' : '';
    const rows = all.filter(r => (!v.kind || r.kind === v.kind) && (v.st === 'due' ? due(r) : !v.st || r.status === v.st) && (!q || [r.val_no, r.title, r.target_label].join(' ').toLowerCase().includes(q)));
    $('#valList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>이름</th><th>종류</th><th>대상</th><th>단계 진행</th><th>판정</th><th>재밸리데이션 기한</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-val-row="${r.id}" class="${r.status === 'void' ? 'row-off' : due(r) ? (ipDday(r.valid_until, data.today) < 0 ? 'ip-over' : 'ip-soon') : ''}"><td class="nowrap" data-card-primary><b>${esc(r.val_no)}</b></td><td><b>${esc(r.title)}</b></td><td class="nowrap">${esc(r.kind_label)}</td><td>${esc(r.target_label)}</td><td class="nowrap">${r.stages.map(s => `<span class="val-dot ${s.result === '적합' ? 'ok' : s.result === '부적합' ? 'ng' : s.done_date ? 'on' : ''}" title="${esc(s.key)} ${esc(s.result || '')}">${esc(s.key.split('(')[0])}</span>`).join('')}</td><td><span class="chip ${VAL_CHIP[r.status]}">${esc(r.status_label)}</span></td><td class="nowrap">${esc(r.valid_until || '')}${qDd(r.valid_until, data.today, r.status === 'pass', 60)}</td><td><button type="button" class="btn small" data-val-open="${r.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 밸리데이션이 없습니다.' : '등록된 밸리데이션이 없습니다. 「＋ 밸리데이션」으로 설비 IQ·OQ·PQ나 시험법 밸리데이션을 넣으세요.'}</div>`;
  };
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-q-tile]'); if (t) { form.elements.st.value = ['running', 'pass', 'fail', 'due'][Number(t.dataset.qTile)]; draw(); return; }
    if (e.target.closest('#valNewBtn')) return valOpen().catch(fail);
    const o = e.target.closest('[data-val-open]'); if (o) valOpen(Number(o.dataset.valOpen)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// M1 품질목표·KPI
const GOAL_STATUS_LABEL = { plan: '계획', progress: '진행', achieved: '달성', missed: '미달' };
const GOAL_CHIP = { plan: '', progress: 'yellow', achieved: 'green', missed: 'red' };
function kpiSvg(g) {
  const W = 720, H = 200, L = 44, R = 16, T = 14, B = 26, pts = g.months.map(x => x.actual), tg = g.months.map(x => x.target ?? g.target);
  const vals = [...pts, ...tg].filter(v => v != null); if (!vals.length) return '<p class="muted small">아직 값이 없습니다.</p>';
  const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.1 || 1, X = i => L + i * (W - L - R) / 11, Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = arr => arr.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`).filter(Boolean).join(' ');
  const good = v => v == null || g.target == null ? '' : (g.direction === 'up' ? v >= g.target : v <= g.target) ? 'ok' : 'ng';
  return `<svg class="kpi-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(g.title)} 월별 추이">
    ${[lo, (lo + hi) / 2, hi].map(v => `<line class="kpi-grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="kpi-ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtN(v, 1)}</text>`).join('')}
    <polyline class="kpi-tg" points="${path(tg)}"/><polyline class="kpi-ac" points="${path(pts)}"/>
    ${pts.map((v, i) => v == null ? '' : `<circle class="kpi-pt ${good(v)}" cx="${X(i)}" cy="${Y(v)}" r="4"><title>${i + 1}월 실적 ${fmtN(v, 2)}${g.unit}</title></circle>`).join('')}
    ${g.months.map((x, i) => `<text class="kpi-ax" x="${X(i)}" y="${H - 8}" text-anchor="middle">${i + 1}월</text>`).join('')}</svg>
    <p class="small muted kpi-legend"><span class="kpi-key ac"></span> 실적 <span class="kpi-key tg"></span> 목표</p>`;
}
async function goalOpen(id = null, year = null, pre = {}) {
  const data = await api('GET', '/api/kpi?year=' + (year || todayStr().slice(0, 4))), g = id ? data.rows.find(x => x.id === id) : null; if (id && !g) return toast('목표를 찾을 수 없습니다.', 'err');
  const v0 = g || { year: data.year, direction: 'down', status: 'plan', months: [], ...pre }, can = data.can_manage, dis = can ? '' : ' disabled';
  const m = modal(`<h3>${g ? `${g.year} · ${esc(g.title)} <span class="chip ${GOAL_CHIP[g.status]}">${esc(g.status_label)}</span>` : '품질목표 등록'}</h3>
    <form class="stack" data-goal-form><div class="form-grid">
      <label class="span2">목표명 *<input name="title" required maxlength="200" value="${esc(v0.title || '')}" placeholder="예) 출하검사 불합격률 0.5% 이하"${dis}></label><label>연도<input type="number" name="year" min="2000" max="2100" value="${v0.year}"${dis}></label>
      <label>지표<select name="metric"${dis}><option value="">직접 입력(월 실적 입력)</option>${Object.entries(data.metrics).map(([k, x]) => `<option value="${k}"${v0.metric === k ? ' selected' : ''}>자동 · ${x.label}</option>`).join('')}</select></label>
      <label data-manual>단위<input name="unit" maxlength="20" value="${esc(v0.unit || '')}" placeholder="% · 건 · 만원"${dis}></label>
      <label data-manual>방향<select name="direction"${dis}><option value="down"${v0.direction === 'down' ? ' selected' : ''}>낮을수록 좋음</option><option value="up"${v0.direction === 'up' ? ' selected' : ''}>높을수록 좋음</option></select></label>
      <label>연간 목표값<input type="number" step="any" name="target" value="${v0.target ?? ''}"${dis}></label><label>예산(원)<input type="number" min="0" name="budget" value="${v0.budget ?? ''}"${dis}></label><label>담당<input name="owner_name" maxlength="50" value="${esc(v0.owner_name || '')}"${dis}></label>
      <label>상태<select name="status"${dis}>${Object.entries(GOAL_STATUS_LABEL).map(([k, l]) => `<option value="${k}"${v0.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="span3">전략<input name="strategy" maxlength="1000" value="${esc(v0.strategy || '')}"${dis}></label>
      <label class="span3">개선계획<textarea name="plan" rows="2" maxlength="2000"${dis}>${esc(v0.plan || '')}</textarea></label></div>
      ${g ? `<fieldset class="vendor-sec"><legend>월별 목표·실적 ${g.metric ? '<span class="hint">(실적은 자동 집계)</span>' : ''}</legend><div class="table-wrap"><table class="grid kpi-tbl" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th></th>${g.months.map(x => `<th>${x.m}월</th>`).join('')}<th>누계·평균</th></tr></thead><tbody>
        <tr><th>목표</th>${g.months.map(x => `<td><input type="number" step="any" data-mt="${x.m}" value="${x.target ?? ''}" placeholder="${g.target ?? ''}"${dis}></td>`).join('')}<td>${fmtN(g.target, 2)}</td></tr>
        <tr><th>실적</th>${g.months.map(x => `<td class="${x.actual != null && g.target != null ? ((g.direction === 'up' ? x.actual >= (x.target ?? g.target) : x.actual <= (x.target ?? g.target)) ? 'kpi-ok' : 'kpi-ng') : ''}">${g.metric ? `<b>${fmtN(x.actual, 2)}</b>${x.base && g.metric !== 'voc_count' ? `<div class="small muted">${x.base.n}/${x.base.d}</div>` : ''}` : `<input type="number" step="any" data-ma="${x.m}" value="${x.actual ?? ''}"${dis}>`}</td>`).join('')}<td><b>${fmtN(g.ytd, 2)}</b></td></tr></tbody></table></div>${kpiSvg(g)}</fieldset>` : ''}
      <label>메모<input name="note" maxlength="1000" value="${esc(v0.note || '')}"${dis}></label>
      <div class="actions">${g && can ? '<button type="button" class="btn danger" data-goal-del>삭제</button>' : ''}<span class="grow"></span>${can ? '<button class="btn primary">저장</button>' : ''}</div></form>`, { wide: true });
  const form = $('[data-goal-form]', m.el), man = () => $$('[data-manual]', form).forEach(l => { l.hidden = !!form.elements.metric.value; }); man(); form.elements.metric.addEventListener('change', man);
  form.onsubmit = async e => { e.preventDefault(); try { const v = formObj(form), values = g ? g.months.map(x => ({ month: x.m, target: $(`[data-mt="${x.m}"]`, form)?.value ?? '', actual: $(`[data-ma="${x.m}"]`, form)?.value ?? '' })) : undefined;
    const r = g ? await api('PUT', `/api/kpi/goals/${g.id}`, { ...v, values, revision: g.revision }) : await api('POST', '/api/kpi/goals', { ...v, request_id: crypto.randomUUID() }); toast('저장했습니다.'); m.close(); qReload(); await goalOpen(r.id, r.year); } catch (err) { fail(err); } };
  $('[data-goal-del]', m.el)?.addEventListener('click', async () => { if (!await confirmBox(`「${g.title}」 목표와 월별 값을 지울까요?`)) return; try { await api('DELETE', `/api/kpi/goals/${g.id}?revision=${g.revision}`); toast('지웠습니다.'); m.close(); qReload(); } catch (err) { fail(err); } });
}
async function pageKpi(main) {
  const y0 = Number(todayStr().slice(0, 4));
  main.innerHTML = `<h1>품질목표·KPI <span class="dept">품질</span></h1>
  <p class="muted">연도별 품질목표(지표·목표값)·전략·예산·개선계획을 세우고 월별 목표·실적을 봅니다. 자동 지표 4개(수입검사 불합격률·출하검사 불합격률·VOC 건수·CAPA 기한 준수율)는 검사·VOC·CAPA 기록에서 매번 집계하고, 나머지는 월 실적을 직접 넣습니다.</p>
  <div class="ip-tiles" id="kpiTiles"></div>
  <form class="toolbar list-filters" data-read-only id="kpiFilters"><label class="lf-sel">연도<select name="year">${[y0 + 1, y0, y0 - 1, y0 - 2].map(y => `<option${y === y0 ? ' selected' : ''}>${y}</option>`).join('')}</select></label><span class="grow"></span><span id="kpiTools" class="ip-tools"></span></form>
  <div id="kpiList"></div>`;
  const form = $('#kpiFilters', main); let data = { rows: [] };
  const load = async () => { data = await api('GET', '/api/kpi?year=' + form.elements.year.value); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const draw = () => {
    const all = data.rows;
    qTiles('kpiTiles', [['목표', all.length], ['목표 충족(누계)', all.filter(g => g.met === true).length, 'green'], ['미충족(누계)', all.filter(g => g.met === false).length, all.some(g => g.met === false) ? 'red' : ''], ['예산 합(원)', all.reduce((s, g) => s + (g.budget || 0), 0).toLocaleString('ko-KR')]]);
    const missing = Object.keys(data.metrics || {}).filter(k => !all.some(g => g.metric === k));
    $('#kpiTools', main).innerHTML = data.can_manage ? `${missing.length ? `<button type="button" class="btn" id="kpiAuto">자동 지표 ${missing.length}개 추가</button>` : ''}<button type="button" class="btn primary" id="kpiNew">＋ 품질목표</button>` : '';
    $('#kpiList', main).innerHTML = all.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>목표</th><th>지표</th><th>목표값</th><th>누계 실적</th><th>판정</th>${Array.from({ length: 12 }, (_, i) => `<th class="kpi-m">${i + 1}월</th>`).join('')}<th>담당</th><th>상태</th><th></th></tr></thead><tbody>${all.map(g => `<tr data-goal-row="${g.id}"><td data-card-primary><b>${esc(g.title)}</b>${g.plan ? `<div class="small muted">${esc(g.plan.slice(0, 60))}</div>` : ''}</td><td class="nowrap small">${g.metric ? `자동 · ${esc(g.metric_label)}` : '직접 입력'}</td><td class="nowrap">${g.target != null ? `${g.direction === 'up' ? '≥' : '≤'} ${fmtN(g.target, 2)}${esc(g.unit)}` : ''}</td><td class="nowrap"><b>${fmtN(g.ytd, 2)}</b>${g.ytd != null ? esc(g.unit) : ''}</td><td>${g.met == null ? '' : `<span class="chip ${g.met ? 'green' : 'red'}">${g.met ? '충족' : '미충족'}</span>`}</td>${g.months.map(x => `<td class="kpi-m ${x.actual != null && (x.target ?? g.target) != null ? ((g.direction === 'up' ? x.actual >= (x.target ?? g.target) : x.actual <= (x.target ?? g.target)) ? 'kpi-ok' : 'kpi-ng') : ''}">${x.actual == null ? '' : fmtN(x.actual, 1)}</td>`).join('')}<td>${esc(g.owner_name)}</td><td><span class="chip ${GOAL_CHIP[g.status]}">${esc(g.status_label)}</span></td><td><button type="button" class="btn small" data-goal-open="${g.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${form.elements.year.value}년 품질목표가 없습니다. 「자동 지표 추가」로 기본 KPI 4개를 넣거나 「＋ 품질목표」로 직접 만드세요.</div>`;
  };
  main.addEventListener('click', async e => {
    if (e.target.closest('#kpiNew')) return goalOpen(null, Number(form.elements.year.value), { year: Number(form.elements.year.value) }).catch(fail);
    if (e.target.closest('#kpiAuto')) { const defaults = { iqc_fail_rate: 2, oqc_fail_rate: 0.5, voc_count: 1, capa_ontime: 90 }; try { for (const k of Object.keys(data.metrics).filter(k => !data.rows.some(g => g.metric === k))) await api('POST', '/api/kpi/goals', { year: form.elements.year.value, title: data.metrics[k].label, metric: k, target: defaults[k], status: 'progress', request_id: crypto.randomUUID() }); toast('자동 지표를 넣었습니다. 목표값은 「열기」에서 고치세요.'); load(); } catch (err) { fail(err); } return; }
    const o = e.target.closest('[data-goal-open]'); if (o) goalOpen(Number(o.dataset.goalOpen), Number(form.elements.year.value)).catch(fail);
  });
  form.addEventListener('change', () => load().catch(fail)); form.onsubmit = e => e.preventDefault();
  await load();
}

// M2 리스크 관리
const RISK_STATUS_LABEL = { identified: '식별', acting: '대응 중', closed: '종결' };
const RISK_GRADE_CHIP = { 상: 'red', 중: 'yellow', 하: 'green' };
const riskGradeOf = s => s >= 15 ? '상' : s >= 8 ? '중' : '하';
async function riskOpen(r = null) {
  const can = hasRole('quality'), v0 = r || { kind: 'risk', likelihood: 3, impact: 3, status: 'identified' }, dis = can ? '' : ' disabled';
  const sel = (name, val, req = true) => `<select name="${name}"${dis}>${req ? '' : '<option value="">—</option>'}${[1, 2, 3, 4, 5].map(n => `<option${Number(val) === n ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  const next = { identified: 'acting', acting: 'closed' }[v0.status];
  const m = modal(`<h3>${r ? `${esc(r.risk_no)} · ${esc(r.content)} <span class="chip">${esc(r.status_label)}</span>` : '리스크·기회 등록'}</h3>
    ${r ? qStepper(['identified', 'acting', 'closed'], RISK_STATUS_LABEL, r.status) : ''}
    <form class="stack" data-risk-form><div class="form-grid">
      <label>구분<select name="kind"${dis}><option value="risk"${v0.kind === 'risk' ? ' selected' : ''}>위험</option><option value="opportunity"${v0.kind === 'opportunity' ? ' selected' : ''}>기회</option></select></label>
      <label>분야<input name="area" maxlength="50" list="riskAreas" value="${esc(v0.area || '')}"${dis}><datalist id="riskAreas">${['구매·공급망', '생산·설비', '품질', '고객·시장', '인력', '환경·안전', '법규', 'IT·정보'].map(x => `<option value="${x}">`).join('')}</datalist></label>
      <label>담당<input name="owner_name" maxlength="50" value="${esc(v0.owner_name || '')}"${dis}></label>
      <label class="span3">내용 *<input name="content" required maxlength="500" value="${esc(v0.content || '')}" placeholder="예) 주요 원단 단일 공급처 의존"${dis}></label>
      <label class="span3">원인·배경<input name="cause" maxlength="1000" value="${esc(v0.cause || '')}"${dis}></label>
      <label>발생가능성(1~5)${sel('likelihood', v0.likelihood)}</label><label>영향도(1~5)${sel('impact', v0.impact)}</label><div class="risk-score" data-risk-score></div>
      <label class="span3">대응계획 <span class="hint">(「대응 중」으로 갈 때 필수)</span><textarea name="plan" rows="2" maxlength="1000"${dis}>${esc(v0.plan || '')}</textarea></label>
      <label>대응 기한<input type="date" name="due_date" value="${esc(v0.due_date || '')}"${dis}></label><label>다음 재평가일<input type="date" name="next_review" value="${esc(v0.next_review || '')}"${dis}></label><span></span>
      <label>재평가 발생가능성${sel('re_likelihood', v0.re_likelihood, false)}</label><label>재평가 영향도${sel('re_impact', v0.re_impact, false)}</label><label>재평가일<input type="date" name="review_date" value="${esc(v0.review_date || '')}"${dis}></label>
      <label class="span3">메모<input name="note" maxlength="1000" value="${esc(v0.note || '')}"${dis}></label></div>
      <div class="actions">${r ? '<button type="button" class="btn" data-risk-hist>이력</button>' : ''}${r && can && r.status === 'closed' ? '<button type="button" class="btn" data-risk-to="acting">다시 열기</button>' : ''}<span class="grow"></span>${can ? '<button class="btn">저장</button>' : ''}${r && can && next ? `<button type="button" class="btn primary" data-risk-to="${next}">저장하고 「${RISK_STATUS_LABEL[next]}」로 →</button>` : ''}</div></form>`, { wide: true });
  const form = $('[data-risk-form]', m.el);
  const score = () => { const s = Number(form.elements.likelihood.value) * Number(form.elements.impact.value), rl = Number(form.elements.re_likelihood.value), ri = Number(form.elements.re_impact.value), g = riskGradeOf(s); $('[data-risk-score]', form).innerHTML = `점수 <b>${s}</b> <span class="chip ${RISK_GRADE_CHIP[g]}">${g}</span>${rl && ri ? ` → 재평가 <b>${rl * ri}</b> <span class="chip ${RISK_GRADE_CHIP[riskGradeOf(rl * ri)]}">${riskGradeOf(rl * ri)}</span>` : ''}`; };
  form.addEventListener('change', score); score();
  const save = async status => { try { const v = formObj(form), res = r ? await api('PUT', `/api/risks/${r.id}`, { ...v, ...(status ? { status } : {}), revision: r.revision }) : await api('POST', '/api/risks', { ...v, request_id: crypto.randomUUID() }); toast(status ? `「${RISK_STATUS_LABEL[status]}」(으)로 넘겼습니다.` : '저장했습니다.'); m.close(); qReload(); await riskOpen(res); } catch (e) { fail(e); } };
  form.onsubmit = e => { e.preventDefault(); save(null); };
  $$('[data-risk-to]', m.el).forEach(b => b.addEventListener('click', () => save(b.dataset.riskTo)));
  $('[data-risk-hist]', m.el)?.addEventListener('click', () => qHistory(r.risk_no, r.history, RISK_STATUS_LABEL));
}
async function pageRisks(main) {
  main.innerHTML = `<h1>리스크 관리 <span class="dept">품질</span></h1>
  <p class="muted">위험·기회를 등록하고 <b>발생가능성 × 영향도(1~5) = 점수</b>(15 이상 상 · 8 이상 중 · 그 아래 하)로 평가합니다. 대응계획·담당을 정해 「대응 중」으로, 대응 뒤 재평가해 종결합니다. 매트릭스 칸을 누르면 그 칸의 리스크만 봅니다.</p>
  <div class="ip-tiles" id="riskTiles"></div>
  <div class="risk-wrap"><div id="riskMatrix"></div><div class="risk-list-wrap">
  <form class="toolbar list-filters" data-read-only id="riskFilters"><label class="lf-sel">상태<select name="st"><option value="live">종결 빼고</option><option value="">전체</option>${Object.entries(RISK_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">구분<select name="kind"><option value="">전체</option><option value="risk">위험</option><option value="opportunity">기회</option></select></label><label class="list-search">찾기<input type="search" name="q" placeholder="번호·내용·분야·담당"></label><span class="grow"></span><span id="riskTools" class="ip-tools"></span></form>
  <div id="riskList"></div></div></div>`;
  const form = $('#riskFilters', main); let data = { rows: [], today: todayStr() }, cell = null;
  const load = async () => { data = await api('GET', '/api/risks'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const live = r => r.status !== 'closed', over = r => live(r) && r.due_date && r.due_date < data.today;
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows, open = all.filter(live).filter(r => r.kind === 'risk');
    qTiles('riskTiles', [['상', open.filter(r => r.grade === '상').length, open.some(r => r.grade === '상') ? 'red' : ''], ['중', open.filter(r => r.grade === '중').length, open.some(r => r.grade === '중') ? 'yellow' : ''], ['하', open.filter(r => r.grade === '하').length, 'green'], ['기회', all.filter(live).filter(r => r.kind === 'opportunity').length], ['대응 기한 지남', all.filter(over).length, all.some(over) ? 'red' : ''], ['종결', all.filter(r => r.status === 'closed').length]]);
    const cnt = (l, i) => open.filter(r => r.likelihood === l && r.impact === i).length;
    $('#riskMatrix', main).innerHTML = `<table class="risk-matrix" aria-label="리스크 매트릭스(진행 중 위험)"><tbody>${[5, 4, 3, 2, 1].map(l => `<tr><th>${l}</th>${[1, 2, 3, 4, 5].map(i => { const s = l * i, n = cnt(l, i); return `<td class="rm-${riskGradeOf(s)}${cell && cell[0] === l && cell[1] === i ? ' on' : ''}" data-cell="${l},${i}" title="가능성 ${l} × 영향 ${i} = ${s}">${n || ''}</td>`; }).join('')}</tr>`).join('')}<tr><th></th>${[1, 2, 3, 4, 5].map(i => `<th>${i}</th>`).join('')}</tr></tbody></table><div class="small muted risk-ax">세로 발생가능성 · 가로 영향도${cell ? ' · <button type="button" class="btn small" data-cell-clear>칸 선택 풀기</button>' : ''}</div>`;
    $('#riskTools', main).innerHTML = data.can_manage ? '<button type="button" class="btn primary" id="riskNew">＋ 리스크·기회</button>' : '';
    const rows = all.filter(r => (v.st === 'live' ? live(r) : !v.st || r.status === v.st) && (!v.kind || r.kind === v.kind) && (!cell || (r.likelihood === cell[0] && r.impact === cell[1] && r.kind === 'risk' && live(r))) && (!q || [r.risk_no, r.content, r.area, r.owner_name].join(' ').toLowerCase().includes(q)));
    $('#riskList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>구분 · 분야</th><th>내용</th><th>점수</th><th>대응계획</th><th>담당 · 기한</th><th>재평가</th><th>상태</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-risk-row="${r.id}" class="${r.status === 'closed' ? 'row-off' : over(r) ? 'ip-over' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.risk_no)}</b></td><td class="nowrap">${esc(r.kind_label)}${r.area ? `<div class="small muted">${esc(r.area)}</div>` : ''}</td><td><b>${esc(r.content)}</b></td><td class="nowrap">${r.likelihood}×${r.impact}=<b>${r.score}</b> <span class="chip ${RISK_GRADE_CHIP[r.grade]}">${r.grade}</span></td><td class="small">${esc(r.plan)}</td><td class="nowrap">${esc(r.owner_name)}${r.due_date ? `<div class="small">${esc(r.due_date)}${qDd(r.due_date, data.today, live(r), 14)}</div>` : ''}</td><td class="nowrap">${r.re_score ? `${r.re_score} <span class="chip ${RISK_GRADE_CHIP[r.re_grade]}">${r.re_grade}</span>` : ''}</td><td><span class="chip ${r.status === 'closed' ? 'green' : 'yellow'}">${esc(r.status_label)}</span></td><td><button type="button" class="btn small" data-risk-open="${r.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 리스크가 없습니다.' : '등록된 리스크가 없습니다. 공급망·설비·인력·법규 등에서 위험과 기회를 찾아 넣으세요.'}</div>`;
  };
  main.addEventListener('click', e => {
    const c = e.target.closest('[data-cell]'); if (c) { const [l, i] = c.dataset.cell.split(',').map(Number); cell = cell && cell[0] === l && cell[1] === i ? null : [l, i]; draw(); return; }
    if (e.target.closest('[data-cell-clear]')) { cell = null; draw(); return; }
    if (e.target.closest('#riskNew')) return riskOpen().catch(fail);
    const o = e.target.closest('[data-risk-open]'); if (o) riskOpen(data.rows.find(r => r.id === Number(o.dataset.riskOpen))).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}

// ── 15.312 사용 편의 ──
// (1) 목록 공통 도구: 오른쪽 도구 묶음(.ip-tools)이 있는 조회 줄에 「N건」·조건 초기화(↻)·엑셀을 한 번 붙인다(기존 목록 화면과 같은 사용법).
function tableToXlsx(table, name) {
  const ths = [...(table.tHead?.rows[0]?.cells || [])], keep = ths.map((th, i) => [i, th.textContent.replace(/[▾▴▼▲☆]/g, '').replace(/\s+/g, ' ').trim()]).filter(([, l]) => l);
  const raw = [...(table.tBodies[0]?.rows || [])].filter(tr => !tr.hidden && tr.cells.length === ths.length).map(tr => keep.map(([i]) => tr.cells[i].textContent.replace(/\s+/g, ' ').trim()));
  // 15.315 열 전체가 숫자일 때만 숫자로(LOT 007123·「1,2」 같은 글자는 그대로). 앞자리 0은 글자로 본다.
  const isNum = t => /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t) && !/^-?0\d/.test(t);
  const types = keep.map((_, j) => raw.length && raw.some(r => r[j] !== '') && raw.every(r => r[j] === '' || isNum(r[j])) ? 'number' : 'text');
  const rows = raw.map(r => r.map((t, j) => types[j] === 'number' && t !== '' ? Number(t.replace(/,/g, '')) : t));
  xlsxDownload(`${name}_${todayStr()}.xlsx`, { sheet: name.slice(0, 30), titles: [name, `${todayStr()} · ${rows.length}건`], columns: keep.map(([, label], j) => ({ label, type: types[j] })), rows });
}
function listAutoTools(form) {
  if (form.dataset.autoTools) return; const list = form.nextElementSibling; if (!list) return;
  form.dataset.autoTools = '1';
  const tools = form.querySelector(':scope > .ip-tools'), bar = document.createElement('span'); bar.className = 'lf-auto';
  bar.innerHTML = '<span class="small muted" data-auto-count role="status"></span><button type="button" class="btn icon-reset" data-auto-reset title="조건 초기화" aria-label="조건 초기화">↻</button><button type="button" class="btn" data-auto-xlsx title="지금 보이는 목록을 엑셀로">엑셀</button>';
  tools.before(bar);
  const table = () => list.querySelector('table');
  const update = () => {
    const t = table(), n = t ? [...(t.tBodies[0]?.rows || [])].filter(tr => !tr.hidden && !tr.querySelector('td[colspan]')).length : 0;
    $('[data-auto-count]', bar).textContent = `${n}건`;
    const own = [...tools.querySelectorAll('.btn')].some(b => b.textContent.trim() === '엑셀'); $('[data-auto-xlsx]', bar).hidden = own || !n;
  };
  new MutationObserver(update).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(update).observe(tools, { childList: true });
  $('[data-auto-reset]', bar).onclick = () => { form.reset(); form.querySelectorAll('select').forEach(s => s.dispatchEvent(new Event('change', { bubbles: true }))); form.dispatchEvent(new Event('input', { bubbles: true })); };
  $('[data-auto-xlsx]', bar).onclick = () => { const t = table(); if (t) tableToXlsx(t, screenTitle(document.querySelector('#main')) || '목록'); };
  update();
}
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") new MutationObserver(() => { for (const f of document.querySelectorAll('#main form.list-filters:not([data-auto-tools])')) if (f.querySelector(':scope > .ip-tools')) listAutoTools(f); }).observe(document.body, { childList: true, subtree: true });

// (2) 목록 줄 한 번 누르면 열기: 줄 안의 「열기」·「카드」 단추와 같은 동작(단추·링크·입력칸을 누른 것은 그대로).
if (typeof document !== "undefined") document.addEventListener('click', e => {
  const tr = e.target.closest?.('#main table.ip-table > tbody > tr'); if (!tr || e.target.closest('a, button, input, select, textarea, label, summary, .chip-btn')) return;
  if (getSelection && String(getSelection()).length) return; // 글자를 끌어 고르는 중이면 열지 않음
  const b = [...tr.querySelectorAll('button')].find(x => /^(열기|카드)$/.test(x.textContent.trim())); if (b) b.click();
});

// (3) 기록 찾기: 메뉴 찾기 칸에 번호·제목을 치면 그 기록을 바로 연다.
const FIND_OPEN = {
  devcost: id => costOpen(id), // 15.316
  ra: id => raOpen(id), // 15.313
  nc: id => ncOpen(id), coa: id => coaOpen(id), change: id => chgOpen(id), doc: id => qdocOpen(id), audit: id => audOpen(id), validation: id => valOpen(id), reliability: id => relOpen(id), equipment: id => eqOpen(id),
  risk: async id => { const r = (await api('GET', '/api/risks')).rows.find(x => x.id === id); if (r) riskOpen(r); },
  method: async id => { const t = (await api('GET', '/api/test-methods')).rows.find(x => x.id === id); if (t && hasRole('quality')) tmEdit(t); },
  request: async (id, hit) => { const rows = await api('GET', '/api/requests?type=' + encodeURIComponent(hit.rtype)); const r = rows.find(x => x.id === id); if (r) requestDetail(hit.rtype, r, () => {}); },
  lot: (_, hit) => { const f = document.querySelector('#ltForm'); if (f) { f.elements.lot.value = hit.no; f.requestSubmit(); } },
};
const REQ_STATE = { pending: '접수대기', waiting: '대기', progress: '진행', done: '완료', rejected: '반려' };
async function findRecords(q) {
  q = q.trim(); if (q.length < 2) return [];
  let rows = []; try { rows = (await api('GET', '/api/find?q=' + encodeURIComponent(q))).rows; } catch { return []; }
  const hits = rows.map(r => { const href = r.type === 'request' ? (REQ[r.rtype]?.list || '') : r.href; return href && canSeeRoute(href) ? { href, label: `${r.no || ''} ${r.label || ''}`.trim(), path: [r.sub + (r.state ? ` · ${REQ_STATE[r.state] || r.state}` : '')], open: { type: r.type, id: r.id }, rtype: r.rtype, no: r.no } : null; }).filter(Boolean);
  if (/\d/.test(q) && q.length >= 4 && canSeeRoute('#/prod/lot-trace')) hits.push({ href: '#/prod/lot-trace', label: `LOT 「${q}」 연결 조회`, path: ['LOT 연결 조회'], open: { type: 'lot' }, no: q });
  return hits;
}
async function openFound(hit) {
  const run = () => FIND_OPEN[hit.open.type]?.(hit.open.id, hit);
  if ((location.hash || '#/').split('?')[0] === hit.href) return run();
  location.hash = hit.href;
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); const h = document.querySelector('#main h1'); if (h && (location.hash || '#/').split('?')[0] === hit.href && !document.querySelector('#main .loading')) break; }
  await new Promise(r => setTimeout(r, 250)); try { await run(); } catch (e) { fail(e); }
}

// (4) 한꺼번에 승인(내가 처리할 일): COA 승인 · 문서 승인·배포 · 의뢰 접수 승인. 고른 건을 차례로 승인하고 결과를 보여 준다.
async function bulkApprove(kind, rtype = '') {
  let items = [], label = '';
  if (kind === 'coa') { label = 'COA 승인'; items = (await api('GET', '/api/coas')).rows.filter(c => c.status === 'draft').map(c => ({ id: c.id, rev: c.revision, text: `${c.coa_no} · ${c.item} · LOT ${c.lot}`, sub: `작성 ${c.created_by}` })); }
  else if (kind === 'docs') { label = '문서 승인·배포'; items = (await api('GET', '/api/qdocs')).rows.filter(d => d.status === 'review').map(d => ({ id: d.id, rev: d.revision, text: `${d.doc_no} Rev.${d.rev} ${d.title}`, sub: d.summary || '' })); }
  else { label = `${REQ[rtype]?.label || ''} 의뢰 승인`; items = (await api('GET', '/api/requests?type=' + encodeURIComponent(rtype))).filter(r => r.status === 'pending').map(r => ({ id: r.id, text: `${r.title}${r.customer ? ' · ' + r.customer : ''}`, sub: `의뢰 ${r.requester_name || ''} ${String(r.created_at || '').slice(0, 10)}` })); }
  if (!items.length) return toast('승인할 건이 없습니다.');
  const m = modal(`<h3>한꺼번에 ${esc(label)} <span class="chip yellow">${items.length}건</span></h3><p class="small muted">승인할 건을 고르세요. 내용을 봐야 하는 건은 체크를 풀고 화면에서 하나씩 여세요.</p>
    <form class="stack" data-bulk-form><div class="table-wrap"><table class="grid keep-table" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th><input type="checkbox" data-bulk-all checked aria-label="모두"></th><th>건</th><th>정보</th></tr></thead><tbody>${items.map((x, i) => `<tr><td><input type="checkbox" name="pick" value="${i}" checked></td><td><b>${esc(x.text)}</b></td><td class="small muted">${esc(x.sub)}</td></tr>`).join('')}</tbody></table></div>
    <div class="actions"><span class="small muted" data-bulk-msg role="status"></span><span class="grow"></span><button type="button" class="btn" data-no>취소</button><button class="btn primary">고른 건 승인</button></div></form>`, { wide: true });
  const form = $('[data-bulk-form]', m.el);
  $('[data-bulk-all]', form).onchange = e => $$('[name=pick]', form).forEach(c => { c.checked = e.target.checked; });
  $('[data-no]', form).onclick = () => m.close();
  form.onsubmit = async e => {
    e.preventDefault(); const picked = $$('[name=pick]:checked', form).map(c => items[Number(c.value)]); if (!picked.length) return toast('고른 건이 없습니다.', 'err');
    form.inert = true; let ok = 0; const bad = [], train = [];
    for (const [i, x] of picked.entries()) {
      $('[data-bulk-msg]', form).textContent = `${i + 1}/${picked.length} 승인 중…`;
      try { if (kind === 'coa') await api('POST', `/api/coas/${x.id}/approve`, { revision: x.rev }); else if (kind === 'docs') { const r = await api('POST', `/api/qdocs/${x.id}/step`, { to: 'approved', revision: x.rev }); if (r.training_suggest) train.push(r); } else await api('POST', `/api/requests/${x.id}/approve`); ok++; }
      catch (err) { bad.push(`${x.text}: ${err.message}`); }
    }
    m.close(); toast(bad.length ? `${ok}건 승인, ${bad.length}건 실패 — ${bad[0]}` : `${ok}건을 승인했습니다.`, bad.length ? 'err' : 'ok');
    if (location.hash === '#/' || location.hash === '' || location.hash === '#/tasks') render(); refreshNavBadges();
    // 15.315 하나씩 승인할 때처럼 「교육 필요」 문서는 개정 교육 계획을 권함
    for (const r of train) { if (!await confirmBox(`${r.doc_no} Rev.${r.rev} 교육이 필요한 문서입니다. 교육 계획을 지금 만들까요?${train.length > 1 ? ` (${train.indexOf(r) + 1}/${train.length})` : ''}`)) continue; await trNew({ doc_id: r.id, kind: '문서 개정 교육', title: `${r.doc_no} ${r.title} Rev.${r.rev} 개정 교육`, change_id: r.change_id }); break; }
  };
}

// (5) 기한 알림(브라우저 알림): 켜 두면 앱이 열려 있는 동안 10분마다 확인해, 새로 생긴 승인 대기·기한 알림을 컴퓨터·휴대폰 알림으로 띄운다.
const NOTIFY_KEY = () => `wpa:notify:${ME?.id || 0}`, NOTIFY_SEEN = () => `wpa:notify-seen:${ME?.id || 0}`;
const notifyOn = () => { try { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem(NOTIFY_KEY()) === '1'; } catch { return false; } };
async function notifyToggle() {
  if (typeof Notification === 'undefined') return toast('이 브라우저는 알림을 지원하지 않습니다.', 'err');
  if (notifyOn()) { try { localStorage.setItem(NOTIFY_KEY(), '0'); } catch {} toast('알림을 껐습니다.'); return render(); }
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') return toast('브라우저에서 알림을 허용해야 받을 수 있습니다(주소창 왼쪽 자물쇠 → 알림 허용).', 'err');
  try { localStorage.setItem(NOTIFY_KEY(), '1'); localStorage.removeItem(NOTIFY_SEEN()); } catch {}
  toast('알림을 켰습니다. 앱이 열려 있는 동안 새 승인 대기·기한 알림을 알려 드립니다.'); notifyCheck(true); render();
}
async function notifyCheck(first = false) {
  if (!ME || !notifyOn()) return;
  try {
    const [tasks, alerts] = await Promise.all([api('GET', '/api/my-tasks'), api('GET', '/api/alerts')]);
    const now = {}; // 15.315 항목 이름별 건수: 새로 생기거나 늘었을 때만 알림(줄어든 것은 알리지 않음)
    for (const [type, g] of Object.entries(tasks.approvals.requests || {})) if (g.count) now[`${REQ[type]?.label || type} 승인 대기`] = g.count;
    for (const q of tasks.approvals.quality || []) now[q.label] = q.count;
    if (tasks.approvals.training_attend?.count) now['교육 참석 확인'] = tasks.approvals.training_attend.count;
    for (const q of alerts.quality_alerts || []) now[q.label] = q.count;
    if (alerts.overdue_po_count) now['납기 지난 미입고 발주'] = alerts.overdue_po_count;
    let seen = {}; try { seen = JSON.parse(localStorage.getItem(NOTIFY_SEEN()) || '{}'); if (Array.isArray(seen)) seen = {}; } catch {}
    const lines = Object.entries(now).map(([l, c]) => `${l} ${c}건`), fresh = Object.entries(now).filter(([l, c]) => c > (seen[l] || 0)).map(([l, c]) => `${l} ${c}건`); try { localStorage.setItem(NOTIFY_SEEN(), JSON.stringify(now)); } catch {}
    if (!fresh.length || (first && !lines.length)) return;
    const n = new Notification('서울세미텍 · 확인할 일', { body: fresh.slice(0, 6).join('\n') + (fresh.length > 6 ? `\n외 ${fresh.length - 6}건` : ''), tag: 'wpa-tasks' });
    n.onclick = () => { window.focus(); location.hash = '#/'; n.close(); };
  } catch { /* 알림은 편의 기능 */ }
}
if (typeof setInterval !== "undefined") setInterval(() => notifyCheck(), 10 * 60 * 1000);
if (typeof setTimeout !== "undefined") setTimeout(() => notifyCheck(), 8000);

// (6) 보고서 출력: 8D 보고서(CAPA) · 교육 결과 보고서 · 심사 보고서. 창 안 양식을 그대로 인쇄·PDF로.
async function rptCompany() { try { return (await api('GET', '/api/coas')).company || {}; } catch { return {}; } }
function rptWindow(title, body, co = {}) {
  const m = modal(`<div class="rpt-sheet"><div class="rpt-top"><b>${esc(co.biz_name || '')}</b><span class="small">${esc(todayStr())} 출력 · ${esc(ME?.name || '')}</span></div><h2 class="rpt-title">${esc(title)}</h2>${body}</div>
    <div class="actions no-print"><span class="grow"></span><button type="button" class="btn" data-no>닫기</button><button type="button" class="btn primary" data-rpt-print>인쇄 · PDF</button></div>`, { wide: true });
  m.el.classList.add('rpt-modal');
  $('[data-no]', m.el).onclick = () => m.close();
  $('[data-rpt-print]', m.el).onclick = () => { document.body.classList.add('printing'); window.print(); document.body.classList.remove('printing'); };
  return m;
}
const rptRow = (pairs) => `<table class="rpt-head">${pairs.map(row => `<tr>${row.map(([k, v]) => `<th>${esc(k)}</th><td>${v == null || v === '' ? '<span class="muted">—</span>' : esc(v)}</td>`).join('')}</tr>`).join('')}</table>`;
const rptBlock = (t, html) => `<section class="rpt-block"><h3>${esc(t)}</h3>${html}</section>`;
const rptText = v => v ? `<p class="rpt-text">${esc(v)}</p>` : '<p class="muted">—</p>';
async function nc8D(n) {
  const c = n.cause || {}, co = await rptCompany();
  const whys = ['why1', 'why2', 'why3', 'why4', 'why5'].filter(k => c[k]).map((k, i) => `<li>Why ${i + 1}: ${esc(c[k])}</li>`).join('');
  const m4 = [['man', '사람'], ['machine', '설비'], ['material', '자재'], ['method', '방법'], ['env', '환경']].filter(([k]) => c[k]).map(([k, l]) => `<li>${l}: ${esc(c[k])}</li>`).join('');
  rptWindow('8D 보고서', rptRow([[['번호', n.nc_no], ['단계', n.status_label]], [['출처', `${n.source_label}${n.source_no ? ' ' + n.source_no : ''}`], ['유형·등급', `${n.kind} · ${n.grade_label}`]], [['품목', n.item], ['LOT · 수량', `${n.lot || '—'} · ${n.qty ?? '—'}`]], [['발생일', n.found_date], ['조치 기한', n.due_date]]])
    + rptBlock('D1 팀 구성', rptText(`담당 ${n.owner_name || '—'} · 등록 ${n.created_by}`))
    + rptBlock('D2 문제 기술', rptText(`${n.title}${n.detail ? '\n' + n.detail : ''}`))
    + rptBlock('D3 임시 조치(격리·선별)', rptText(n.containment))
    + rptBlock('D4 근본 원인', (whys || m4 || c.root) ? `${whys ? `<ul>${whys}</ul>` : ''}${m4 ? `<ul>${m4}</ul>` : ''}${c.root ? `<p><b>근본 원인</b> ${esc(c.root)}</p>` : ''}` : '<p class="muted">—</p>')
    + rptBlock('D5 영구 시정조치', rptText(n.corrective))
    + rptBlock('D6 실행 · 시정', rptText(`${n.correction || ''}${n.action_date ? `\n조치 완료일 ${n.action_date}` : ''}`))
    + rptBlock('D7 재발 방지(예방조치)', rptText(n.preventive))
    + rptBlock('D8 유효성 확인 · 종결', rptText(`${n.verify_result ? `검증 ${n.verify_result}` : '검증 전'}${n.verify_date ? ` (${n.verify_date})` : ''}${n.verify_note ? '\n' + n.verify_note : ''}${n.closed_by ? `\n종결 ${n.closed_by} ${String(n.closed_at || '').slice(0, 10)}` : ''}`))
    + '<div class="rpt-sign"><span>작성</span><span>검토</span><span>승인</span></div>', co);
}
async function trReport(t) {
  const co = await rptCompany(), att = t.attendees || [];
  rptWindow('교육 결과 보고서', rptRow([[['교육명', t.title], ['유형', t.kind]], [['예정일', t.plan_date], ['실시일', t.done_date]], [['시간(h)', t.hours], ['장소', t.place]], [['강사', t.instructor], ['평가 방법', t.eval_method]], [['관련 문서', t.doc_label], ['상태', t.status_label]]])
    + rptBlock('교육 내용', rptText(t.content))
    + rptBlock(`참석자 (${att.filter(a => a.attended).length}/${att.length}명)`, `<table class="rpt-list"><thead><tr><th>No</th><th>이름</th><th>부서</th><th>참석</th><th>점수</th><th>결과</th><th>서명</th></tr></thead><tbody>${att.map((a, i) => `<tr><td class="c">${i + 1}</td><td>${esc(a.user_name)}</td><td>${esc(a.dept)}</td><td class="c">${a.attended ? '○' : '×'}</td><td class="r">${a.score ?? ''}</td><td class="c">${esc(a.result)}</td><td class="rpt-signcell"></td></tr>`).join('') || '<tr><td colspan="7" class="muted">대상자가 없습니다.</td></tr>'}</tbody></table>`)
    + '<div class="rpt-sign"><span>작성</span><span>검토</span><span>승인</span></div>', co);
}
async function audReport(a) {
  const co = await rptCompany(), cl = a.checklist || [], f = a.findings || [];
  rptWindow('심사 보고서', rptRow([[['번호', a.audit_no], ['유형', a.kind_label]], [['심사명', a.title], ['대상', a.target]], [['예정일', a.plan_date], ['실시일', a.done_date]], [['심사원', a.auditors], ['단계', a.status_label]], [['범위', a.scope], ['인증서', a.cert_label]]])
    + rptBlock(`체크리스트 (${cl.length}문항 · 부적합 ${cl.filter(x => x.result === '부적합').length})`, cl.length ? `<table class="rpt-list"><thead><tr><th>No</th><th>질문·확인 사항</th><th>결과</th><th>메모·증거</th></tr></thead><tbody>${cl.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.q)}</td><td class="c">${esc(x.result || '—')}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">—</p>')
    + rptBlock(`지적사항 (${f.length}건)`, f.length ? `<table class="rpt-list"><thead><tr><th>등급</th><th>조항</th><th>지적 내용</th><th>시정 기한</th><th>CAPA</th><th>상태</th></tr></thead><tbody>${f.map(x => `<tr><td>${esc(x.grade_label)}</td><td>${esc(x.clause)}</td><td>${esc(x.content)}</td><td class="c">${esc(x.due_date || '')}</td><td>${esc(x.nc_no || '')}</td><td class="c">${x.closed ? '닫힘' : esc(x.nc_status_label || '열림')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">지적사항이 없습니다.</p>')
    + rptBlock('결과 요약', rptText(a.summary))
    + '<div class="rpt-sign"><span>심사원</span><span>피심사 부서</span><span>품질책임자</span></div>', co);
}

if (typeof document !== "undefined") document.addEventListener('click', e => {
  const b = e.target.closest?.('button[data-bulk]'); if (b) { e.preventDefault(); bulkApprove(b.dataset.bulk, b.dataset.bulkType || '').catch(fail); return; }
  if (e.target.closest?.('[data-notify]')) { e.preventDefault(); notifyToggle().catch(fail); }
});

// ── 15.313 생산 › 위험성평가: 작업 위험성평가(KOSHA) · 공정 FMEA(AIAG-VDA AP) · HAZOP · 개선 조치 추적 · 설비 신뢰도(MTBF·MTTR) ──
const RA_METHOD_LABEL = { kosha: '작업 위험성평가', fmea: '공정 FMEA', hazop: 'HAZOP' };
const RA_STATUS_LABEL = { draft: '작성', review: '검토 요청', approved: '승인', obsolete: '폐지' };
const RA_STATUS_CHIP = { draft: '', review: 'yellow', approved: 'green', obsolete: 'gray' };
const RA_KIND_LABEL = { initial: '최초평가', regular: '정기평가', adhoc: '수시평가', continuous: '상시평가' };
const RA_HAZARD_LABEL = { machine: '기계적 요인', electric: '전기적 요인', chemical: '화학(물질)적 요인', bio: '생물학적 요인', work: '작업특성 요인', env: '작업환경 요인', other: '기타' };
const RA_SCALE_LABEL = { 3: '빈도·강도 3×3', 5: '빈도·강도 5×5', 1: '3단계 판단(상·중·하)' };
const RA_GRADE_LABEL = { H: '높음', M: '보통', L: '낮음' }, RA_GRADE_CHIP = { H: 'red', M: 'yellow', L: 'green' }, RA_LVL_LABEL = { H: '상', M: '중', L: '하' };
const HZ_PARAM = ['유량', '압력', '온도', '레벨', '조성·농도', '반응', '시간', '순서·절차', '속도·회전', '전력', '기타'];
const HZ_GUIDE = ['없음(No)', '많음(More)', '적음(Less)', '반대(Reverse)', '일부(Part of)', '추가(As well as)', '다른(Other than)', '이른·늦은(Early/Late)', '앞·뒤(Before/After)'];
// 분류별 흔한 유해·위험요인(입력 칸 추천 목록). 「사업장 위험성평가에 관한 지침」 유해·위험요인 분류를 따름.
const RA_HAZARD_EX = {
  machine: ['회전체·롤러·벨트에 끼임', '날·절단기에 베임', '움직이는 설비에 부딪힘', '물체 낙하에 맞음', '지게차·운반구 충돌'],
  electric: ['충전부 접촉 감전', '누전·접지 불량 감전', '정전기 방전 화재', '과부하 배선 화재'],
  chemical: ['세제·약품 피부·눈 접촉', '유해가스·증기 흡입', '인화성 물질 화재·폭발', '물질 누출·비산'],
  bio: ['세균·곰팡이 노출', '혈액·체액 오염물 접촉'],
  work: ['중량물 취급 요통(근골격계)', '반복 동작·부적절한 자세', '야간·장시간 작업 피로', '미끄러짐·넘어짐', '높은 곳에서 떨어짐'],
  env: ['소음 노출(85dB 이상)', '고온·고열 작업', '조명 부족', '밀폐공간 산소 결핍', '바닥 젖음·통로 장애물'],
  other: [],
};
function raFmeaAP(s, o, d) {
  if (!s || !o || !d) return null;
  if (s >= 9) { if (o >= 6) return 'H'; if (o >= 4) return d >= 2 ? 'H' : 'M'; if (o >= 2) return d >= 7 ? 'H' : d >= 5 ? 'M' : 'L'; return 'L'; }
  if (s >= 7) { if (o >= 8) return 'H'; if (o >= 6) return d >= 2 ? 'H' : 'M'; if (o >= 4) return d >= 7 ? 'H' : 'M'; if (o >= 2) return d >= 5 ? 'M' : 'L'; return 'L'; }
  if (s >= 4) { if (o >= 8) return d >= 5 ? 'H' : 'M'; if (o >= 6) return d >= 2 ? 'M' : 'L'; if (o >= 4) return d >= 7 ? 'M' : 'L'; return 'L'; }
  if (s >= 2) return o >= 8 && d >= 5 ? 'M' : 'L';
  return 'L';
}
function raScoreC(method, scale, r, after = false) {
  const k = after ? '2' : '', n = v => Number(v) || 0;
  if (method === 'fmea') { const s = n(r['s' + k]), o = n(r['o' + k]), d = n(r['d' + k]); return s && o && d ? { score: s * o * d, grade: raFmeaAP(s, o, d) } : { score: null, grade: null }; }
  if (method === 'kosha' && scale === 1) return { score: null, grade: r['lvl' + k] || null };
  const a = n(method === 'hazop' ? r['l' + k] : r['f' + k]), b = n(r['s' + k]); if (!a || !b) return { score: null, grade: null };
  const s = a * b; return { score: s, grade: method === 'kosha' && scale === 3 ? (s >= 6 ? 'H' : s >= 3 ? 'M' : 'L') : (s >= 15 ? 'H' : s >= 8 ? 'M' : 'L') };
}
const raNeedsActionC = (method, g) => method === 'fmea' ? g === 'H' : g === 'H' || g === 'M';
const raMax = (method, scale) => method === 'fmea' ? 10 : method === 'hazop' ? 5 : scale === 5 ? 5 : 3;
const raChip = (method, b) => b?.grade ? `<span class="chip ${RA_GRADE_CHIP[b.grade]}" title="${method === 'fmea' ? `AP(조치 우선순위) ${RA_GRADE_LABEL[b.grade]}${b.score ? ` · RPN ${b.score}` : ''}` : `위험성 ${RA_GRADE_LABEL[b.grade]}`}">${method === 'fmea' ? 'AP ' + b.grade : RA_GRADE_LABEL[b.grade]}${b.score && method !== 'fmea' ? ' ' + b.score : ''}</span>${method === 'fmea' && b.score ? `<div class="small muted">RPN ${b.score}</div>` : ''}` : '<span class="muted">—</span>';
// 워크시트 열: k(값 키) · l(제목) · t(text 한 줄 · area 여러 줄 · rate 등급 · sel 고르기 · date · calc 계산) · w(최소 너비)
function raCols(method, scale) {
  const tail = [{ k: 'action', l: method === 'hazop' ? '권고사항(감소대책)' : method === 'fmea' ? '권고 조치' : '감소대책', t: 'area', w: 180 }, { k: 'owner', l: '담당', t: 'text', w: 70 }, { k: 'due', l: '기한', t: 'date', w: 130 }];
  if (method === 'fmea') return [{ k: 'step', l: '공정 단계', t: 'text', w: 100 }, { k: 'func', l: '기능·요구사항', t: 'area', w: 140 }, { k: 'mode', l: '고장 모드 *', t: 'area', w: 140, req: 1 }, { k: 'effect', l: '고장 영향', t: 'area', w: 140 }, { k: 's', l: 'S', t: 'rate', tip: '심각도(1~10)' }, { k: 'cls', l: '특별특성', t: 'sel', opts: [['', '—'], ['CC', 'CC'], ['SC', 'SC']], w: 64 },
    { k: 'cause', l: '고장 원인', t: 'area', w: 140 }, { k: 'prevent', l: '예방 관리', t: 'area', w: 130 }, { k: 'o', l: 'O', t: 'rate', tip: '발생도(1~10)' }, { k: 'detect', l: '검출 관리', t: 'area', w: 130 }, { k: 'd', l: 'D', t: 'rate', tip: '검출도(1~10)' }, { k: '_calc', l: 'AP · RPN', t: 'calc' }, ...tail];
  if (method === 'hazop') return [{ k: 'node', l: '노드', t: 'text', w: 100 }, { k: 'param', l: '변수', t: 'list', opts: HZ_PARAM, w: 90 }, { k: 'guide', l: '가이드워드', t: 'sel', opts: [['', '—'], ...HZ_GUIDE.map(g => [g, g])], w: 140 }, { k: 'dev', l: '이탈 *', t: 'text', w: 120, ph: '변수 + 가이드워드' },
    { k: 'cause', l: '원인', t: 'area', w: 140 }, { k: 'cons', l: '결과(영향)', t: 'area', w: 140 }, { k: 'safeguard', l: '현재 안전장치', t: 'area', w: 130 }, { k: 's', l: '심각도', t: 'rate', tip: '1~5' }, { k: 'l', l: '가능성', t: 'rate', tip: '1~5' }, { k: '_calc', l: '위험도', t: 'calc' }, ...tail];
  return [{ k: 'task', l: '세부 작업·공정', t: 'text', w: 110 }, { k: 'cat', l: '분류', t: 'sel', opts: Object.entries(RA_HAZARD_LABEL), w: 130 }, { k: 'hazard', l: '유해·위험요인(상황 → 결과) *', t: 'text', w: 220, max: 500, req: 1 }, { k: 'basis', l: '관련 근거', t: 'text', w: 90, ph: '법령·기준' }, { k: 'current', l: '현재 안전보건조치', t: 'area', w: 150 },
    ...(scale === 1 ? [{ k: 'lvl', l: '위험성 수준', t: 'sel', opts: [['', '—'], ['H', '상'], ['M', '중'], ['L', '하']], w: 72 }] : [{ k: 'f', l: '가능성(빈도)', t: 'rate', tip: `1~${scale}` }, { k: 's', l: '중대성(강도)', t: 'rate', tip: `1~${scale}` }]), { k: '_calc', l: '위험성', t: 'calc' }, ...tail];
}
const raAfterKeys = (method, scale) => method === 'fmea' ? [['s2', 'S'], ['o2', 'O'], ['d2', 'D']] : method === 'hazop' ? [['s2', '심각도'], ['l2', '가능성']] : scale === 1 ? [['lvl2', '위험성 수준']] : [['f2', '가능성(빈도)'], ['s2', '중대성(강도)']];
const raRowLabel = (method, r) => method === 'fmea' ? r.mode : method === 'hazop' ? r.dev : r.hazard;
function raCell(c, r, i, method, scale, edit) {
  const v = r[c.k] ?? '';
  if (c.t === 'calc') return `<td class="c" data-ra-calc="${i}">${raChip(method, raScoreC(method, scale, r))}</td>`;
  if (!edit) {
    if (c.t === 'sel') return `<td class="c nowrap">${esc((c.opts.find(o => o[0] === v) || ['', v])[1] || '')}</td>`;
    if (c.t === 'rate') return `<td class="c">${esc(v)}</td>`;
    return `<td class="${c.t === 'date' ? 'c nowrap' : ''}">${esc(v)}</td>`;
  }
  const at = `data-i="${i}" data-k="${c.k}" aria-label="${esc(c.l.replace(' *', ''))} ${i + 1}번 줄"`, st = c.w ? ` style="min-width:${c.w}px"` : '';
  if (c.t === 'rate') return `<td class="c"><select ${at} class="ra-rate"><option value=""></option>${Array.from({ length: raMax(method, scale) }, (_, n) => `<option${Number(v) === n + 1 ? ' selected' : ''}>${n + 1}</option>`).join('')}</select></td>`;
  if (c.t === 'sel') return `<td><select ${at}${st}>${c.opts.map(([k, l]) => `<option value="${esc(k)}"${v === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></td>`;
  if (c.t === 'area') return `<td><textarea ${at} rows="2" maxlength="1000"${st}>${esc(v)}</textarea></td>`;
  if (c.t === 'list') return `<td><input ${at} list="raParam" value="${esc(v)}" maxlength="30"${st}></td>`;
  if (c.t === 'date') return `<td><input type="date" ${at} value="${esc(v)}"${st}></td>`;
  return `<td><input ${at} value="${esc(v)}" maxlength="${c.max || 200}"${c.ph ? ` placeholder="${esc(c.ph)}"` : ''}${c.k === 'hazard' ? ' list="raHazEx"' : ''}${st}></td>`;
}
// 평가 기준(척도 설명). KOSHA 3×3·5×5·3단계 판단, AIAG-VDA S·O·D와 AP 의미, HAZOP 가이드워드.
function raCriteria(method, scale) {
  const tbl = (head, rows) => `<div class="table-wrap"><table class="grid" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? '' : ' class="c nowrap"'}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  let html = '';
  if (method === 'kosha') html = scale === 1 ? `<p>2023년 개정 지침의 <b>위험성 수준 3단계 판단법</b>: 유해·위험요인마다 바로 <b>상·중·하</b>를 정합니다.</p>${tbl(['수준', '판단', '할 일'], [['상', '중대 재해로 이어질 수 있고 자주 노출됨', '즉시 감소대책(작업 중지 검토)'], ['중', '부상 가능성이 있음', '감소대책을 세워 기한 안에 실행'], ['하', '허용 가능한 위험', '현 상태 유지·교육']])}`
    : scale === 3 ? `${tbl(['점수', '가능성(빈도)', '중대성(강도)'], [['3', '상: 자주 일어남(일상 노출)', '대: 사망·영구 장해·휴업 1개월 이상'], ['2', '중: 가끔 일어남', '중: 휴업이 필요한 부상·질병'], ['1', '하: 거의 일어나지 않음', '소: 응급처치 정도(휴업 없음)']])}<p>위험성 = 가능성 × 중대성 → <span class="chip red">6~9 높음</span> 즉시 개선 · <span class="chip yellow">3~4 보통</span> 개선 계획 · <span class="chip green">1~2 낮음</span> 허용(현 상태 유지)</p>`
    : `${tbl(['점수', '가능성(빈도)', '중대성(강도)'], [['5', '매우 높음: 일상적으로 일어남', '사망·다수 부상'], ['4', '높음: 자주 일어남', '영구 장해·휴업 1개월 이상'], ['3', '보통: 가끔 일어남', '휴업이 필요한 부상'], ['2', '낮음: 드물게 일어남', '응급처치 정도'], ['1', '매우 낮음: 거의 없음', '영향 거의 없음']])}<p>위험성 = 가능성 × 중대성 → <span class="chip red">15~25 높음</span> · <span class="chip yellow">8~12 보통</span> · <span class="chip green">1~6 낮음(허용)</span></p>`;
  else if (method === 'fmea') html = `${tbl(['점수', '심각도 S(고장 영향)', '발생도 O(원인 발생)', '검출도 D(현 검출 관리)'], [['10~9', '작업자·사용자 안전, 법규 위반', '예방 관리 없음 · 매우 자주', '검출 수단 없음·검사 안 함'], ['8~7', '제품 기능 상실·전량 폐기, 기능 저하·선별', '높음(예방 관리 효과 낮음)', '사람의 육안·샘플 검사'], ['6~5', '일부 기능 상실·부분 재작업', '보통', '계측기·자동 검출(사후)'], ['4~3', '외관·편의 영향·일부 재작업', '낮음(검증된 예방 관리)', '공정 중 자동 검출·불량 유출 차단'], ['2~1', '경미하거나 영향 없음', '매우 낮음 · 설계로 발생 불가', '원인 단계 자동 검출·실수 방지(포카요케)']])}
    <p><b>AP(조치 우선순위, AIAG-VDA 2019)</b>는 S → O → D 순으로 무게를 둔 표로 정합니다. <span class="chip red">H</span> 조치(또는 현 관리로 충분한 근거) 필수 · <span class="chip yellow">M</span> 조치 권장 · <span class="chip green">L</span> 선택. RPN(S×O×D)은 참고로만 보여 줍니다. 등급 기준은 회사 기준서·고객 요구에 맞춰 쓰세요.</p>`;
  else html = `${tbl(['가이드워드', '뜻', '예'], [['없음(No)', '설계 의도가 전혀 없음', '유량 없음'], ['많음 · 적음', '양이 늘거나 줆', '압력 높음·온도 낮음'], ['반대(Reverse)', '반대로 일어남', '역류'], ['일부 · 추가', '일부만 / 다른 것이 더해짐', '성분 일부 누락·이물 혼입'], ['다른(Other than)', '전혀 다른 일이 일어남', '다른 약품 투입'], ['이른·늦은 · 앞·뒤', '시간·순서가 어긋남', '헹굼 전에 탈수']])}
    <p>노드(배관·설비 구간)마다 <b>변수 × 가이드워드 = 이탈</b>을 만들고 원인·결과·현재 안전장치를 적은 뒤, 심각도 × 가능성(1~5)으로 위험도를 봅니다. <span class="chip red">15~25 높음</span> · <span class="chip yellow">8~12 보통</span> → 권고사항·담당·기한을 정합니다.</p>`;
  const cm = modal(`<h3>평가 기준 · ${esc(RA_METHOD_LABEL[method])}${method === 'kosha' ? ` (${esc(RA_SCALE_LABEL[scale])})` : ''}</h3>${html}<div class="actions"><span class="grow"></span><button type="button" class="btn" data-x>닫기</button></div>`, { wide: true });
  cm.el.querySelector('[data-x]').onclick = () => cm.close();
}
async function raList() { return api('GET', '/api/risk-assess'); }
async function raOpen(id = null, pre = {}) {
  const list = await raList(), a = id ? list.rows.find(x => x.id === id) : null; if (id && !a) return toast('평가서를 찾을 수 없습니다.', 'err');
  const method = a?.method || pre.method || 'kosha', can = list.can_manage, appr = list.can_approve, st = a?.status || 'draft', edit = can && st === 'draft';
  const v0 = a || { method, kind: 'regular', scale: 3, assess_date: todayStr(), rows: [], ...pre };
  let scale = method === 'kosha' ? Number(v0.scale) || 3 : method === 'fmea' ? 10 : 5;
  const rows = (v0.rows || []).map(r => ({ ...r }));
  if (!rows.length && edit) rows.push({ cat: 'machine' });
  const dis = edit ? '' : ' disabled', flow = ['draft', 'review', 'approved'];
  const m = modal(`<h3>${a ? `${esc(a.ra_no)}${a.rev ? ` Rev.${a.rev}` : ''} · ${esc(a.title)} <span class="chip ${RA_STATUS_CHIP[st]}">${esc(RA_STATUS_LABEL[st])}</span>` : `새 ${esc(RA_METHOD_LABEL[method])}`}</h3>
    ${a && st !== 'obsolete' ? qStepper(flow, RA_STATUS_LABEL, st) : ''}
    ${a?.rev_note && st !== 'approved' ? `<p class="small muted">개정 사유: ${esc(a.rev_note)}</p>` : ''}
    <form class="stack" data-ra-form><div class="form-grid">
      <label class="span2">평가명 *<input name="title" required maxlength="200" value="${esc(v0.title || '')}" placeholder="${method === 'fmea' ? '예) 세탁 공정 PFMEA' : method === 'hazop' ? '예) 세탁수 순환 계통 HAZOP' : '예) 2026 세탁·포장 공정 정기 위험성평가'}"${dis}></label>
      ${method === 'kosha' ? `<label>평가 종류<select name="kind"${dis}>${Object.entries(RA_KIND_LABEL).map(([k, l]) => `<option value="${k}"${v0.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>위험성 결정 방법<select name="scale"${dis}>${[3, 5, 1].map(k => `<option value="${k}"${scale === k ? ' selected' : ''}>${RA_SCALE_LABEL[k]}</option>`).join('')}</select></label>` : ''}
      <label>공정·작업<input name="process" maxlength="200" value="${esc(v0.process || '')}"${dis}></label>
      ${method !== 'kosha' ? `<label>품목·제품<input name="item" maxlength="200" value="${esc(v0.item || '')}"${dis}></label>` : ''}
      <label>설비<select name="equipment_id"${dis}><option value="">—</option>${list.equipment.map(e => `<option value="${e.id}"${e.id === Number(v0.equipment_id) ? ' selected' : ''}>${esc(e.equip_no)} ${esc(e.name)}</option>`).join('')}</select></label>
      <label>평가일 *<input type="date" name="assess_date" required value="${esc(v0.assess_date || '')}" max="${todayStr()}"${dis}></label>
      <label>재평가 예정일<input type="date" name="next_review" value="${esc(v0.next_review || '')}"${dis}><span class="hint">비우면 승인 때 평가일 + 1년</span></label>
      <label class="span2">참여자${method === 'kosha' ? '(관리감독자·근로자 참여)' : '(팀)'}<input name="team" maxlength="300" value="${esc(v0.team || '')}" placeholder="예) 생산팀장, 세탁 작업자 2명, 공무 담당"${dis}></label>
      <label class="span3">범위<input name="scope" maxlength="1000" value="${esc(v0.scope || '')}"${dis}></label></div>
      <fieldset class="vendor-sec"><legend>워크시트 <span class="hint">${method === 'fmea' ? '심각도·발생도·검출도(1~10)로 AP를 정합니다. AP H는 권고 조치·담당·기한이 있어야 승인됩니다.' : '위험성이 「보통」·「높음」인 줄은 감소대책·담당·기한이 있어야 검토 요청·승인됩니다.'}</span></legend>
        <div class="ra-sum" data-ra-sum></div>
        <div class="table-wrap ra-wrap"><table class="grid ra-ws" data-no-sort data-no-filter data-keep-cols data-no-reorder data-no-autoalign><thead></thead><tbody></tbody></table></div>
        <datalist id="raParam">${HZ_PARAM.map(p => `<option value="${esc(p)}">`).join('')}</datalist><datalist id="raHazEx"></datalist>
        <div class="actions">${edit ? `<button type="button" class="btn small" data-ra-add>＋ 줄</button>${method === 'hazop' ? '<button type="button" class="btn small" data-ra-guides>가이드워드로 줄 만들기</button>' : ''}` : ''}<button type="button" class="btn small" data-ra-crit>평가 기준</button></div>
      </fieldset>
      <fieldset class="vendor-sec"><legend>결과 요약 · 공유</legend><label>요약(근로자에게 알릴 내용 포함)<textarea name="summary" rows="2" maxlength="2000"${dis}>${esc(v0.summary || '')}</textarea></label></fieldset>
      <div class="actions">${a ? '<button type="button" class="btn" data-ra-hist>이력</button><button type="button" class="btn" data-ra-print>평가표 인쇄</button><button type="button" class="btn" data-ra-xlsx>엑셀</button>' : ''}${a && can && st === 'draft' && !a.rev && !a.approved_at ? '<button type="button" class="btn danger" data-ra-del>삭제</button>' : ''}${a && appr && (st === 'approved' || a.rev > 0) && st !== 'obsolete' ? '<button type="button" class="btn danger" data-ra-to="obsolete">폐지</button>' : ''}
        <span class="grow"></span>
        ${a && st === 'review' && appr ? '<button type="button" class="btn" data-ra-to="reject">반려</button><button type="button" class="btn primary" data-ra-to="approved">승인</button>' : ''}${a && st === 'review' && !appr && a.created_by === ME?.name ? '<button type="button" class="btn" data-ra-to="withdraw">검토 요청 취소</button>' : ''}
        ${a && st === 'approved' && can ? '<button type="button" class="btn" data-ra-to="revise">개정</button>' : ''}${edit ? `<button class="btn">저장</button><button type="button" class="btn primary" data-ra-to="review">저장하고 검토 요청</button>` : ''}</div>
    </form>`, { wide: true });
  m.el.classList.add('ra-modal');
  const form = $('[data-ra-form]', m.el), table = $('.ra-ws', form), touched = () => { if (m.el.parentElement) m.el.parentElement.dataset.dirty = '1'; }; // 줄 추가·삭제도 저장 안 한 변경
  const extra = !edit && a ? `<th>조치 상태</th><th>조치 후</th>${can && st !== 'obsolete' ? '<th></th>' : ''}` : '';
  const sum = () => {
    const b = rows.map(r => raScoreC(method, scale, r)), c = g => b.filter(x => x.grade === g).length;
    const need = rows.filter((r, i) => raNeedsActionC(method, b[i].grade) && !(r.action && r.owner && r.due)).length;
    $('[data-ra-sum]', form).innerHTML = `<span class="chip red">${method === 'fmea' ? 'AP H' : '높음'} ${c('H')}</span> <span class="chip yellow">${method === 'fmea' ? 'AP M' : '보통'} ${c('M')}</span> <span class="chip green">${method === 'fmea' ? 'AP L' : '낮음'} ${c('L')}</span> <span class="small muted">줄 ${rows.length}개${b.some(x => !x.grade) ? ` · 점수 안 넣음 ${b.filter(x => !x.grade).length}` : ''}${need ? ` · <b class="err-text">감소대책·담당·기한 필요 ${need}</b>` : ''}</span>`;
  };
  const draw = () => {
    const cols = raCols(method, scale);
    $('thead', table).innerHTML = `<tr><th class="c">No</th>${cols.map(c => `<th${c.tip ? ` title="${esc(c.tip)}"` : ''}>${esc(c.l)}</th>`).join('')}${extra}${edit ? '<th></th>' : ''}</tr>`;
    $('tbody', table).innerHTML = rows.map((r, i) => {
      const a2 = raScoreC(method, scale, r, true), over = r.action && !r.done && r.due && r.due < list.today;
      const stc = !edit && a ? `<td class="nowrap">${!r.action ? '<span class="muted">—</span>' : r.done ? `<span class="chip green">완료</span><div class="small muted">${esc(r.done)}${r.done_by ? ' · ' + esc(r.done_by) : ''}</div>` : `<span class="chip ${over ? 'red' : 'yellow'}">${over ? '기한 지남' : '진행'}</span>`}${r.nc_no ? `<div><a href="#/quality/capa" data-ra-nc="${r.nc_id}">${esc(r.nc_no)}</a></div>` : ''}</td><td class="c">${r.done ? raChip(method, a2) : '<span class="muted">—</span>'}</td>
        ${can && st !== 'obsolete' ? `<td class="nowrap">${r.action ? `<button type="button" class="btn small" data-ra-result="${i}">조치 결과</button>` : ''}${method !== 'kosha' && !r.nc_id ? ` <button type="button" class="btn small" data-ra-capa="${i}" title="이 줄을 부적합·CAPA로 등록">CAPA</button>` : ''}</td>` : ''}` : '';
      return `<tr class="${over ? 'ip-over' : ''}"><td class="c">${i + 1}</td>${cols.map(c => raCell(c, r, i, method, scale, edit)).join('')}${stc}${edit ? `<td class="nowrap"><button type="button" class="btn small" data-ra-dup="${i}" title="줄 복사">⧉</button> <button type="button" class="btn small" data-ra-rm="${i}" aria-label="${i + 1}번 줄 삭제">×</button></td>` : ''}</tr>`;
    }).join('') || `<tr><td colspan="${cols.length + 2}" class="empty">줄이 없습니다.</td></tr>`;
    sum();
  };
  draw();
  table.addEventListener('focusin', e => { const t = e.target.closest('[data-k="hazard"]'); if (!t) return; const cat = rows[Number(t.dataset.i)]?.cat || 'other'; $('#raHazEx', form).innerHTML = (RA_HAZARD_EX[cat] || []).map(x => `<option value="${esc(x)}">`).join(''); });
  const onEdit = e => {
    const t = e.target.closest('[data-k]'); if (!t) return; const i = Number(t.dataset.i), k = t.dataset.k, r = rows[i]; if (!r) return;
    r[k] = t.value; if (method === 'hazop' && (k === 'param' || k === 'guide')) { const dev = $(`[data-i="${i}"][data-k="dev"]`, table); const auto = [r.param, r.guide].filter(Boolean).join(' '); if (dev && (!dev.value || dev.dataset.auto === '1')) { dev.value = auto; dev.dataset.auto = '1'; r.dev = auto; } }
    if (k === 'dev') t.dataset.auto = '';
    const cell = $(`[data-ra-calc="${i}"]`, table); if (cell) cell.innerHTML = raChip(method, raScoreC(method, scale, r)); sum();
  };
  table.addEventListener('input', onEdit); table.addEventListener('change', onEdit);
  form.elements.scale?.addEventListener('change', () => { scale = Number(form.elements.scale.value); const mx = raMax(method, scale); rows.forEach(r => ['f', 's', 'f2', 's2'].forEach(k => { if (Number(r[k]) > mx) r[k] = ''; })); draw(); });
  form.addEventListener('click', async e => {
    if (e.target.closest('[data-ra-add]')) { touched(); rows.push(method === 'kosha' ? { cat: rows.at(-1)?.cat || 'machine', task: rows.at(-1)?.task || '' } : method === 'fmea' ? { step: rows.at(-1)?.step || '' } : { node: rows.at(-1)?.node || '' }); draw(); $(`[data-i="${rows.length - 1}"]`, table)?.focus(); return; }
    const d = e.target.closest('[data-ra-dup]'); if (d) { const i = Number(d.dataset.raDup), { key, done, done_by, nc_id, nc_no, result, ...rest } = rows[i]; void key; void done; void done_by; void nc_id; void nc_no; void result; rows.splice(i + 1, 0, { ...rest }); touched(); draw(); return; }
    const rm = e.target.closest('[data-ra-rm]'); if (rm) { const i = Number(rm.dataset.raRm); if (rows[i].nc_id) return toast('CAPA로 넘긴 줄은 지울 수 없습니다.', 'err'); rows.splice(i, 1); touched(); draw(); return; }
    if (e.target.closest('[data-ra-guides]')) {
      const v = await promptBox('가이드워드로 줄 만들기', `<p class="small muted">한 노드·변수에 대해 고른 가이드워드마다 줄을 만들고 이탈을 채웁니다. 뜻이 없는 조합은 만든 뒤 지우세요.</p><div class="form-grid"><label>노드 *<input name="node" required maxlength="100" value="${esc(rows.at(-1)?.node || '')}"></label><label>변수 *<input name="param" required list="raParam" maxlength="30"></label></div><div class="chk-list">${HZ_GUIDE.map((g, n) => `<label class="chk"><input type="checkbox" name="g" value="${esc(g)}"${n < 3 ? ' checked' : ''}> ${esc(g)}</label>`).join('')}</div>`);
      if (!v) return; const picked = v.g || []; if (!picked.length) return toast('가이드워드를 하나 이상 고르세요.', 'err');
      for (let n = rows.length - 1; n >= 0; n--) if (!rows[n].dev && !rows[n].cause && !rows[n].param) rows.splice(n, 1);
      picked.forEach(g => rows.push({ node: v.node, param: v.param, guide: g, dev: `${v.param} ${g}` })); touched(); draw(); return;
    }
    if (e.target.closest('[data-ra-crit]')) return raCriteria(method, scale);
    const res = e.target.closest('[data-ra-result]'); if (res) return raResult(a, Number(res.dataset.raResult), () => { m.close(); qReload(); raOpen(a.id).catch(fail); }).catch(fail);
    const cp = e.target.closest('[data-ra-capa]'); if (cp) {
      const i = Number(cp.dataset.raCapa); if (!await confirmBox(`${i + 1}번 줄 「${raRowLabel(method, rows[i])}」을(를) 부적합·CAPA로 등록할까요? 권고 조치가 시정조치로, 담당·기한이 그대로 넘어갑니다.`)) return;
      try { const r = await api('POST', `/api/risk-assess/${a.id}/rows/${rows[i].key}/nc`, { revision: a.revision }); toast(`${r.nc_no} CAPA를 만들었습니다.`); m.close(); qReload(); await raOpen(a.id); } catch (err) { fail(err); } return;
    }
    const nc = e.target.closest('[data-ra-nc]'); if (nc) { e.preventDefault(); m.close(); location.hash = '#/quality/capa'; setTimeout(() => ncOpen(Number(nc.dataset.raNc)).catch(fail), 600); }
  });
  const body = () => ({ ...formObj(form), method, rows: rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !['score', 'grade', 'score2', 'grade2', 'need', 'open', 'over'].includes(k)))) });
  const saveRaw = async () => a ? api('PUT', `/api/risk-assess/${a.id}`, { ...body(), revision: a.revision }) : api('POST', '/api/risk-assess', { ...body(), request_id: crypto.randomUUID() });
  const step = async (r, to, extra = {}) => api('POST', `/api/risk-assess/${r.id}/step`, { to, revision: r.revision, ...extra });
  const reopen = async (r, msg) => { toast(msg); m.close(); qReload(); await raOpen(r.id); };
  form.onsubmit = async e => { e.preventDefault(); try { reopen(await saveRaw(), '저장했습니다.'); } catch (err) { fail(err); } };
  $$('[data-ra-to]', m.el).forEach(b => b.addEventListener('click', async () => {
    const to = b.dataset.raTo;
    try {
      if (to === 'review') { const r = await saveRaw(); try { return reopen(await step(r, 'review'), '검토를 요청했습니다. 생산·품질 책임자가 승인합니다.'); } catch (err) { m.close(); qReload(); await raOpen(r.id); return fail(err); } } // 저장은 됐으니 저장된 평가서로 다시 열고 막힌 사유를 보여 줌(새 평가서가 두 번 만들어지지 않게)
      if (to === 'approved') return reopen(await step(a, 'approved'), '승인했습니다. 근로자에게 결과를 알리고, 감소대책은 「개선 조치 추적」에서 챙기세요.');
      if (to === 'withdraw') return reopen(await step(a, 'draft'), '검토 요청을 취소했습니다.');
      const p = { reject: ['반려', 'reason', '반려 사유'], revise: ['개정', 'rev_note', '개정 사유(무엇이 바뀌었는지: 설비·공정·물질 변경, 재해 발생 등)'], obsolete: ['폐지', 'reason', '폐지 사유'] }[to];
      const v = await promptBox(p[0], `<label>${esc(p[2])} *<input name="${p[1]}" required maxlength="300"></label>`); if (!v) return;
      reopen(await step(a, to === 'reject' ? 'draft' : to === 'revise' ? 'draft' : 'obsolete', v), to === 'revise' ? `Rev.${a.rev + 1} 개정을 시작했습니다.` : `${p[0]}했습니다.`);
    } catch (err) { fail(err); }
  }));
  $('[data-ra-del]', m.el)?.addEventListener('click', async () => { if (!await confirmBox('이 평가서를 지울까요?')) return; try { await api('DELETE', `/api/risk-assess/${a.id}?revision=${a.revision}`); toast('지웠습니다.'); m.close(); qReload(); } catch (err) { fail(err); } });
  $('[data-ra-hist]', m.el)?.addEventListener('click', () => qHistory(a.ra_no, a.history, RA_STATUS_LABEL));
  $('[data-ra-print]', m.el)?.addEventListener('click', () => raPrint(a).catch(fail));
  $('[data-ra-xlsx]', m.el)?.addEventListener('click', () => raXlsx(a));
}
async function raResult(a, i, done) {
  const r = a.rows[i], keys = raAfterKeys(a.method, a.scale), mx = raMax(a.method, a.scale);
  const sel = (k, l) => a.scale === 1 && a.method === 'kosha' ? `<label>${l} *<select name="${k}" required><option value=""></option>${['H', 'M', 'L'].map(g => `<option value="${g}"${r[k] === g ? ' selected' : ''}>${RA_LVL_LABEL[g]}</option>`).join('')}</select></label>` : `<label>${l} *<select name="${k}" required><option value=""></option>${Array.from({ length: mx }, (_, n) => `<option${Number(r[k]) === n + 1 ? ' selected' : ''}>${n + 1}</option>`).join('')}</select></label>`;
  const v = await promptBox(`조치 결과 · ${i + 1}번 줄`, `<p class="small"><b>${esc(raRowLabel(a.method, r))}</b></p><p class="small muted">감소대책: ${esc(r.action)} · 담당 ${esc(r.owner || '—')} · 기한 ${esc(r.due || '—')}</p>
    <div class="form-grid"><label>완료일 *<input type="date" name="done" required value="${esc(r.done || todayStr())}" max="${todayStr()}"></label>${keys.map(([k, l]) => sel(k, '조치 후 ' + l)).join('')}<label class="span3">조치 내용·증빙<input name="result" maxlength="500" value="${esc(r.result || '')}" placeholder="예) 도어 인터록 설치, 사진 첨부는 비고"></label></div>
    <p class="small muted">조치 후 재평가(잔여 위험)가 「${a.method === 'fmea' ? 'AP H' : '보통·높음'}」이면 추가 대책이 필요합니다.</p>${r.done ? '<label class="chk"><input type="checkbox" name="undo" value="1"> 완료 취소(다시 진행으로)</label>' : ''}`,
    { submit: vals => api('PUT', `/api/risk-assess/${a.id}/rows/${r.key}`, { revision: a.revision, ...(vals.undo ? { done: '' } : vals) }) });
  if (v) { const x = v.rows[i]; toast(x.done ? `조치 완료 · 잔여 위험 ${RA_GRADE_LABEL[x.grade2] || '—'}` : '완료를 취소했습니다.', x.done && raNeedsActionC(a.method, x.grade2) ? 'err' : 'ok'); done(); }
}
function raXlsx(a) {
  const cols = raCols(a.method, a.scale).filter(c => c.t !== 'calc'), after = raAfterKeys(a.method, a.scale);
  const val = (c, r) => c.t === 'sel' ? (c.opts.find(o => o[0] === (r[c.k] ?? ''))?.[1] || '') : c.t === 'rate' ? (r[c.k] ? Number(r[c.k]) : '') : r[c.k] || '';
  const columns = [{ label: 'No', type: 'number' }, ...cols.map(c => ({ label: c.l.replace(' *', ''), type: c.t === 'rate' ? 'number' : c.t === 'date' ? 'date' : 'text' })), { label: a.method === 'fmea' ? 'AP' : '위험성', type: 'text' }, { label: a.method === 'fmea' ? 'RPN' : '점수', type: 'number' }, ...after.map(([, l]) => ({ label: '조치 후 ' + l, type: a.scale === 1 ? 'text' : 'number' })), { label: '조치 후 등급', type: 'text' }, { label: '완료일', type: 'date' }, { label: '조치 내용', type: 'text' }, { label: 'CAPA', type: 'text' }];
  const rows = a.rows.map((r, i) => [i + 1, ...cols.map(c => val(c, r)), r.grade ? (a.method === 'fmea' ? r.grade : RA_GRADE_LABEL[r.grade]) : '', r.score ?? '', ...after.map(([k]) => a.scale === 1 ? RA_LVL_LABEL[r[k]] || '' : r[k] ? Number(r[k]) : ''), r.grade2 ? (a.method === 'fmea' ? r.grade2 : RA_GRADE_LABEL[r.grade2]) : '', r.done || '', r.result || '', r.nc_no || '']);
  xlsxDownload(`${a.ra_no}_${a.title}.xlsx`, { sheet: a.ra_no, titles: [`${RA_METHOD_LABEL[a.method]} ${a.ra_no}${a.rev ? ' Rev.' + a.rev : ''} · ${a.title}`, `${a.process || ''} · 평가일 ${a.assess_date || '-'} · ${RA_STATUS_LABEL[a.status]}${a.approved_by ? ' · 승인 ' + a.approved_by : ''}`], columns, rows });
}
async function raPrint(a) {
  const co = await rptCompany(), cols = raCols(a.method, a.scale), after = raAfterKeys(a.method, a.scale);
  const head = rptRow([[['번호', `${a.ra_no}${a.rev ? ' Rev.' + a.rev : ''}`], ['방법', `${RA_METHOD_LABEL[a.method]}${a.method === 'kosha' ? ' · ' + RA_KIND_LABEL[a.kind] + ' · ' + RA_SCALE_LABEL[a.scale] : ''}`]], [['평가명', a.title], ['공정·작업', a.process]], [['설비', a.equipment ? `${a.equipment.equip_no} ${a.equipment.name}` : ''], ['품목', a.item]], [['평가일', a.assess_date], ['재평가 예정', a.next_review]], [['참여자', a.team], ['상태', `${RA_STATUS_LABEL[a.status]}${a.approved_by ? ` · 승인 ${a.approved_by} ${String(a.approved_at || '').slice(0, 10)}` : ''}`]]]);
  const cell = (c, r) => c.t === 'calc' ? (r.grade ? `${a.method === 'fmea' ? 'AP ' + r.grade : RA_GRADE_LABEL[r.grade]}${r.score ? ` (${r.score})` : ''}` : '') : c.t === 'sel' ? (c.opts.find(o => o[0] === (r[c.k] ?? ''))?.[1] || '') : r[c.k] ?? '';
  const ws = `<table class="rpt-list ra-print"><thead><tr><th>No</th>${cols.map(c => `<th>${esc(c.l.replace(' *', ''))}</th>`).join('')}<th>조치 후</th><th>완료일</th></tr></thead><tbody>${a.rows.map((r, i) => `<tr><td class="c">${i + 1}</td>${cols.map(c => `<td${['rate', 'calc', 'date', 'sel'].includes(c.t) ? ' class="c"' : ''}>${esc(cell(c, r))}</td>`).join('')}<td class="c">${r.done ? esc(`${after.map(([k]) => a.scale === 1 ? RA_LVL_LABEL[r[k]] || '' : r[k]).join('·')} ${r.grade2 ? (a.method === 'fmea' ? 'AP ' + r.grade2 : RA_GRADE_LABEL[r.grade2]) : ''}`) : ''}</td><td class="c">${esc(r.done || '')}</td></tr>`).join('')}</tbody></table>`;
  const m = rptWindow(`${RA_METHOD_LABEL[a.method]} 평가표`, head + rptBlock(`워크시트 (${a.rows.length}줄 · ${a.method === 'fmea' ? 'AP H' : '높음'} ${a.counts.H} · ${a.method === 'fmea' ? 'AP M' : '보통'} ${a.counts.M} · ${a.method === 'fmea' ? 'AP L' : '낮음'} ${a.counts.L})`, ws) + rptBlock('결과 요약 · 공유', rptText(a.summary))
    + '<div class="rpt-sign"><span>작성</span><span>검토</span><span>승인</span></div>', co);
  m.el.querySelector('.rpt-sheet')?.classList.add('rpt-land'); m.el.classList.add('rpt-wide');
}
async function pageRiskAssess(main) {
  main.innerHTML = `<h1>위험성평가 <span class="dept">생산</span></h1>
  <p class="muted"><b>작업 위험성평가</b>(산업안전, 「사업장 위험성평가에 관한 지침」: 유해·위험요인 파악 → 위험성 결정 → 감소대책 → 공유) · <b>공정 FMEA</b>(품질, AIAG-VDA: 고장 모드·영향·원인 → S·O·D → AP) · <b>HAZOP</b>(설비·배관, 변수 × 가이드워드 → 이탈)을 한 곳에서 작성 → 검토 요청 → 책임자 승인합니다. 감소대책은 「개선 조치 추적」에서 완료·재평가하고, 설비·공정이 바뀌거나 재해가 나면 「개정」합니다.</p>
  <div class="ip-tiles" id="raTiles"></div>
  <form class="toolbar list-filters" data-read-only id="raFilters"><label class="lf-sel">방법<select name="method"><option value="">전체</option>${Object.entries(RA_METHOD_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">상태<select name="st"><option value="live">폐지 빼고</option><option value="">전체</option>${Object.entries(RA_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="list-search">찾기<input type="search" name="q" placeholder="번호·평가명·공정·설비·품목"></label><span class="grow"></span><span id="raTools" class="ip-tools"></span></form>
  <div id="raListBox"></div>`;
  const form = $('#raFilters', main); let data = { rows: [], today: todayStr() };
  const load = async () => { data = await raList(); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), all = data.rows, live = all.filter(r => r.status !== 'obsolete');
    qTiles('raTiles', [['작성·검토 중', live.filter(r => r.status !== 'approved').length, live.some(r => r.status === 'review') ? 'yellow' : ''], ['승인', live.filter(r => r.status === 'approved').length, 'green'], ['남은 높음 위험', live.reduce((n, r) => n + r.rows.filter(x => x.grade === 'H' && !(x.done && x.grade2 && x.grade2 !== 'H')).length, 0), live.some(r => r.rows.some(x => x.grade === 'H' && !x.done)) ? 'red' : ''], ['개선 조치 진행', live.reduce((n, r) => n + r.counts.open, 0)], ['조치 기한 지남', live.reduce((n, r) => n + r.counts.over, 0), live.some(r => r.counts.over) ? 'red' : ''], ['재평가 예정 지남', live.filter(r => r.review_over).length, live.some(r => r.review_over) ? 'red' : '']]);
    $('#raTools', main).innerHTML = (data.can_manage ? Object.entries(RA_METHOD_LABEL).map(([k, l]) => `<button type="button" class="btn${k === 'kosha' ? ' primary' : ''}" data-ra-new="${k}">＋ ${l}</button>`).join('') : '') + '<a class="btn" href="#/prod/risk/actions">개선 조치 추적</a>';
    const rows = all.filter(r => (!v.method || r.method === v.method) && (v.st === 'live' ? r.status !== 'obsolete' : !v.st || r.status === v.st) && (!q || [r.ra_no, r.title, r.process, r.item, r.team, r.equipment?.equip_no, r.equipment?.name].join(' ').toLowerCase().includes(q)));
    const g = r => `${r.counts.H ? `<span class="chip red">${r.method === 'fmea' ? 'H' : '높음'} ${r.counts.H}</span> ` : ''}${r.counts.M ? `<span class="chip yellow">${r.method === 'fmea' ? 'M' : '보통'} ${r.counts.M}</span> ` : ''}${r.counts.L ? `<span class="chip green">${r.method === 'fmea' ? 'L' : '낮음'} ${r.counts.L}</span>` : ''}` || '<span class="muted">—</span>';
    $('#raListBox', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>번호</th><th>방법</th><th>평가명 · 공정</th><th>설비 · 품목</th><th>평가일</th><th>위험 분포</th><th>개선 조치</th><th>재평가 예정</th><th>상태</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-ra-row="${r.id}" class="${r.status === 'obsolete' ? 'row-off' : r.counts.over || r.review_over ? 'ip-over' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.ra_no)}</b>${r.rev ? `<div class="small muted">Rev.${r.rev}</div>` : ''}</td><td class="nowrap">${esc(r.method_label)}${r.method === 'kosha' ? `<div class="small muted">${esc(r.kind_label)}</div>` : ''}</td><td><b>${esc(r.title)}</b>${r.process ? `<div class="small muted">${esc(r.process)}</div>` : ''}</td><td>${r.equipment ? esc(`${r.equipment.equip_no} ${r.equipment.name}`) : ''}${r.item ? `<div class="small muted">${esc(r.item)}</div>` : ''}</td><td class="nowrap">${esc(r.assess_date || '')}</td><td class="nowrap">${g(r)}</td><td class="nowrap">${r.counts.open || r.counts.done ? `${r.counts.open ? `진행 ${r.counts.open}` : ''}${r.counts.over ? ` <span class="chip red">지남 ${r.counts.over}</span>` : ''}${r.counts.done ? `<div class="small muted">완료 ${r.counts.done}</div>` : ''}` : '<span class="muted">—</span>'}</td><td class="nowrap">${esc(r.next_review || '')}${r.review_over ? ' <span class="chip red">지남</span>' : ''}</td><td class="nowrap"><span class="chip ${RA_STATUS_CHIP[r.status]}">${esc(r.status_label)}</span></td><td><button type="button" class="btn small" data-ra-open="${r.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${all.length ? '조건에 맞는 평가서가 없습니다.' : '등록된 위험성평가가 없습니다. 오른쪽 위 「＋ 작업 위험성평가」로 공정·작업별 유해·위험요인부터 찾아 넣으세요.'}</div>`;
  };
  main.addEventListener('click', e => {
    const n = e.target.closest('[data-ra-new]'); if (n) return raOpen(null, { method: n.dataset.raNew }).catch(fail);
    const o = e.target.closest('[data-ra-open]'); if (o) raOpen(Number(o.dataset.raOpen)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}
async function pageRiskActions(main) {
  main.innerHTML = `<h1>개선 조치 추적 <span class="dept">생산</span></h1>
  <p class="muted">위험성평가·FMEA·HAZOP 워크시트의 감소대책(권고 조치)을 모아 봅니다. 줄을 눌러 완료일과 <b>조치 후 재평가(잔여 위험)</b>를 넣으면 완료됩니다. 잔여 위험이 여전히 보통·높음(FMEA는 AP H)이면 평가서를 「개정」해 추가 대책을 세우세요.</p>
  <div class="ip-tiles" id="raaTiles"></div>
  <form class="toolbar list-filters" data-read-only id="raaFilters"><label class="lf-sel">상태<select name="st"><option value="open">진행 중</option><option value="over">기한 지남</option><option value="done">완료</option><option value="">전체</option></select></label><label class="lf-sel">방법<select name="method"><option value="">전체</option>${Object.entries(RA_METHOD_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="list-search">찾기<input type="search" name="q" placeholder="평가서·위험요인·대책·담당"></label><span class="grow"></span><span id="raaTools" class="ip-tools"><a class="btn" href="#/prod/risk">위험성평가 목록</a></span></form>
  <div id="raaList"></div>`;
  const form = $('#raaFilters', main); let data = { rows: [], today: todayStr() }, items = [];
  const load = async () => { data = await raList(); items = data.rows.filter(a => a.status !== 'obsolete').flatMap(a => a.rows.map((r, i) => ({ a, r, i })).filter(x => x.r.action)); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase();
    qTiles('raaTiles', [['진행 중', items.filter(x => !x.r.done).length], ['기한 지남', items.filter(x => x.r.over).length, items.some(x => x.r.over) ? 'red' : ''], ['7일 안 기한', items.filter(x => !x.r.done && x.r.due && x.r.due >= data.today && x.r.due <= addDaysC(data.today, 7)).length, 'yellow'], ['완료', items.filter(x => x.r.done).length, 'green'], ['완료 후에도 남은 위험', items.filter(x => x.r.done && raNeedsActionC(x.a.method, x.r.grade2)).length, items.some(x => x.r.done && raNeedsActionC(x.a.method, x.r.grade2)) ? 'red' : '']]);
    const rows = items.filter(x => (v.st === 'open' ? !x.r.done : v.st === 'over' ? x.r.over : v.st === 'done' ? !!x.r.done : true) && (!v.method || x.a.method === v.method) && (!q || [x.a.ra_no, x.a.title, raRowLabel(x.a.method, x.r), x.r.action, x.r.owner].join(' ').toLowerCase().includes(q)))
      .sort((p, n) => (p.r.done ? 1 : 0) - (n.r.done ? 1 : 0) || String(p.r.due || '9999').localeCompare(String(n.r.due || '9999')));
    $('#raaList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>평가서</th><th>위험요인 · 고장 모드 · 이탈</th><th>현재 위험</th><th>감소대책</th><th>담당</th><th>기한</th><th>상태</th><th>조치 후</th><th></th></tr></thead><tbody>${rows.map(({ a, r, i }) => `<tr class="${r.over ? 'ip-over' : r.done ? 'row-off' : ''}"><td class="nowrap" data-card-primary><b>${esc(a.ra_no)}</b><div class="small muted">${esc(a.method_label)} · ${i + 1}번 줄</div></td><td>${esc(raRowLabel(a.method, r))}${a.process ? `<div class="small muted">${esc(a.process)}</div>` : ''}</td><td class="c">${raChip(a.method, { grade: r.grade, score: r.score })}</td><td>${esc(r.action)}${r.nc_no ? `<div class="small muted">CAPA ${esc(r.nc_no)}</div>` : ''}</td><td class="nowrap">${esc(r.owner || '')}</td><td class="nowrap">${esc(r.due || '')}</td><td class="nowrap">${r.done ? `<span class="chip green">완료</span><div class="small muted">${esc(r.done)}</div>` : `<span class="chip ${r.over ? 'red' : 'yellow'}">${r.over ? '기한 지남' : '진행'}</span>`}</td><td class="c">${r.done ? raChip(a.method, { grade: r.grade2, score: r.score2 }) : '<span class="muted">—</span>'}</td><td class="nowrap">${data.can_manage ? `<button type="button" class="btn small" data-raa="${a.id}:${i}">열기</button>` : ''} <button type="button" class="btn small" data-raa-doc="${a.id}">평가서</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${items.length ? '조건에 맞는 조치가 없습니다.' : '감소대책이 있는 워크시트 줄이 없습니다.'}</div>`;
  };
  main.addEventListener('click', e => {
    const b = e.target.closest('[data-raa]'); if (b) { const [id, i] = b.dataset.raa.split(':').map(Number); const a = data.rows.find(x => x.id === id); if (a) raResult(a, i, () => qReload()).catch(fail); return; }
    const d = e.target.closest('[data-raa-doc]'); if (d) raOpen(Number(d.dataset.raaDoc)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}
const addDaysC = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
async function pageReliability(main) {
  const t = todayStr();
  main.innerHTML = `<h1>설비 신뢰도 <span class="dept">생산</span></h1>
  <p class="muted">설비 대장의 고장·수리 이력으로 계산합니다. 가동 기준 시간 = 기간 일수(설치일부터) × 하루 가동시간. <b>MTBF</b>(평균 고장 간격) = (가동 기준 − 비가동) ÷ 고장 수 · <b>MTTR</b>(평균 수리 시간) = 비가동 ÷ 고장 수 · <b>가용도</b> = MTBF ÷ (MTBF + MTTR) · <b>고장률 λ</b> = 1 ÷ MTBF · <b>신뢰도 R(t)</b> = e<sup>−t/MTBF</sup>(임무 시간 t 동안 고장 없이 돌 확률). 고장 기록에 비가동 시간을 넣어야 정확합니다.</p>
  <div class="ip-tiles" id="relTiles"></div>
  <form class="toolbar list-filters" id="relFilters"><label class="lf-sel">시작<input type="date" name="from" value="${addDaysC(t, -364)}" max="${t}"></label><label class="lf-sel">끝<input type="date" name="to" value="${t}" max="${t}"></label><label class="lf-sel">하루 가동시간<input type="number" name="hours" value="24" min="1" max="24" step="0.5" style="width:70px"></label><label class="lf-sel">임무 시간 t<input type="number" name="mission" value="8" min="1" step="1" style="width:70px"></label><label class="list-search">찾기<input type="search" name="q" placeholder="설비번호·설비명·위치"></label><span class="grow"></span><span id="relTools" class="ip-tools"><a class="btn" href="#/prod/equipment">설비 대장·이력</a></span></form>
  <div id="relList"></div>`;
  const form = $('#relFilters', main); let data = null, timer = 0;
  const load = async () => { const v = formObj(form); data = await api('GET', `/api/equipment-reliability?from=${v.from}&to=${v.to}&hours=${v.hours}&mission=${v.mission}`); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const f = (v, u = '') => v == null ? '<span class="muted">—</span>' : `${Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${u}`;
  const draw = () => {
    const q = (formObj(form).q || '').trim().toLowerCase(), tot = data.total;
    qTiles('relTiles', [['고장 건수', tot.fails, tot.fails ? 'yellow' : ''], ['전체 MTBF(시간)', tot.mtbf == null ? '고장 없음' : f(tot.mtbf)], ['전체 MTTR(시간)', tot.mttr == null ? '—' : f(tot.mttr)], ['전체 가용도', tot.availability == null ? '—' : f(tot.availability, '%'), tot.availability != null && tot.availability < 95 ? 'red' : 'green']]);
    const rows = data.rows.filter(r => !q || [r.equip_no, r.name, r.location, r.kind].join(' ').toLowerCase().includes(q));
    $('#relList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>설비번호</th><th>설비명</th><th>종류 · 위치</th><th>가동 기준(h)</th><th>고장</th><th>비가동(h)</th><th>MTBF(h)</th><th>MTTR(h)</th><th>가용도</th><th title="1,000시간당 고장 수">고장률 λ</th><th>신뢰도 R(${esc(data.mission)}h)</th><th>최근 고장</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="${r.availability != null && r.availability < 95 ? 'ip-over' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.equip_no)}</b></td><td>${esc(r.name)}</td><td>${esc([r.kind, r.location].filter(Boolean).join(' · '))}</td><td class="r">${f(r.planned)}</td><td class="r">${r.fails}</td><td class="r">${f(r.down)}</td><td class="r">${r.fails ? f(r.mtbf) : r.planned ? '<span class="small muted">고장 없음</span>' : '—'}</td><td class="r">${f(r.mttr)}</td><td class="r">${f(r.availability, '%')}</td><td class="r">${r.fails ? f(r.lambda) : '0'}</td><td class="r">${f(r.reliability, '%')}</td><td class="c nowrap">${esc(r.last_fail || '')}</td><td class="nowrap">${hasRole('production') || hasRole('quality') ? `<button type="button" class="btn small" data-rel-fmea="${r.id}" title="이 설비로 공정 FMEA 작성">FMEA</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">설비가 없습니다. 「설비 대장·이력」에서 설비를 등록하고 고장·수리를 기록하세요.</div>';
  };
  main.addEventListener('click', e => { const b = e.target.closest('[data-rel-fmea]'); if (b) { const r = data.rows.find(x => x.id === Number(b.dataset.relFmea)); raOpen(null, { method: 'fmea', equipment_id: r.id, title: `${r.name} 설비 FMEA`, process: r.location || '' }).catch(fail); } });
  form.addEventListener('input', e => { if (e.target.name === 'q') return draw(); clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 400); });
  form.onsubmit = e => e.preventDefault();
  await load();
}

// ── 15.316 연구소 › 개발원가 관리 ──
// 개발 건(개발리스트)별 원가표: 엑셀처럼 줄을 쌓고(Enter·↑↓ 이동, 엑셀에서 여러 줄 복사 → 붙여넣기), 금액·구분별 소계·판관비·총원가·단위원가·이익률을 바로 계산.
// 목록은 원가표별 합계와 누적 총원가, 「개발리스트 매칭」은 개발 건마다 원가표 수·총원가와 원가 없는 개발을 보여 준다.
const DC_CAT_LABEL = { material: '매입가(재료)', incidental: '부대비용(운송·관세·포장)', outsource: '외주가공', test: '시험·인증', tooling: '금형·지그', labor: '인건비', sga: '판관비', etc: '기타' };
const DC_STATUS_LABEL = { draft: '작성', confirmed: '확정' };
const DC_CURS = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];
const DC_VIEW_KEY = 'wpa:dc-view';
const dcFmt = (v, d = 0) => v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d });
const dcNum = v => { const n = Number(String(v ?? '').replace(/[,\s₩$]/g, '')); return Number.isFinite(n) ? n : 0; };
// 서버와 같은 계산(화면에서 바로 보여 주기용, 저장 때는 서버 값이 기준)
function dcCalcC(h, lines) {
  const amt = l => { const cur = l.currency || 'KRW', fx = cur === 'KRW' ? 1 : (dcNum(l.fx) || 1); return Math.round((l.qty === '' || l.qty == null ? 1 : dcNum(l.qty)) * dcNum(l.unit_price) * fx); };
  const by = Object.fromEntries(Object.keys(DC_CAT_LABEL).map(k => [k, 0])); for (const l of lines) by[l.cat || 'material'] += amt(l);
  const direct = lines.filter(l => (l.cat || 'material') !== 'sga').reduce((s, l) => s + amt(l), 0), sgaAuto = Math.round(direct * dcNum(h.sga_rate) / 100), sga = by.sga + sgaAuto, total = direct + sga;
  const base = dcNum(h.base_qty) > 0 ? dcNum(h.base_qty) : 1, unit = Math.round(total / base * 100) / 100, tp = h.target_price === '' || h.target_price == null ? null : dcNum(h.target_price);
  const pr = dcNum(h.profit_rate);
  return { amt, by, direct, sga_auto: sgaAuto, sga, total, unit_cost: unit, margin: tp == null ? null : Math.round((tp - unit) * 100) / 100, margin_rate: tp ? Math.round((tp - unit) / tp * 1000) / 10 : null, suggest: pr > 0 && pr < 100 ? Math.round(unit / (1 - pr / 100)) : null };
}
const DC_COLS_C = [
  { k: 'date', l: '발생일', t: 'date', w: 116 }, { k: 'cat', l: '구분', t: 'sel', w: 112 }, { k: 'item', l: '품목·내용 *', t: 'text', w: 140 }, { k: 'spec', l: '규격', t: 'text', w: 80 }, { k: 'vendor', l: '거래처', t: 'text', w: 90 },
  { k: 'qty', l: '수량', t: 'num', w: 58 }, { k: 'unit', l: '단위', t: 'text', w: 54 }, { k: 'unit_price', l: '단가', t: 'num', w: 84 }, { k: 'currency', l: '통화', t: 'cur', w: 76 }, { k: 'fx', l: '환율', t: 'num', w: 62 },
  { k: '_amt', l: '금액(원)', t: 'calc', w: 100 }, { k: 'note', l: '비고', t: 'text', w: 80 },
];
// 붙여넣기 때 구분 글자 → 키(「매입가」·「부대비용」·「운송」 등)
const dcCatOf = v => { const s = String(v || '').trim(); if (DC_CAT_LABEL[s]) return s; const hit = Object.entries(DC_CAT_LABEL).find(([, l]) => l.startsWith(s) || l.includes(s) && s.length >= 2); if (hit) return hit[0]; if (/운송|관세|포장|통관|보험|택배/.test(s)) return 'incidental'; if (/재료|원자재|매입|자재/.test(s)) return 'material'; if (/시험|인증|분석/.test(s)) return 'test'; if (/금형|지그|치구/.test(s)) return 'tooling'; if (/인건|노무/.test(s)) return 'labor'; if (/판관|영업|관리비|출장/.test(s)) return 'sga'; if (/외주|가공/.test(s)) return 'outsource'; return s ? 'etc' : 'material'; };
async function costOpen(id = null, pre = {}) {
  const list = await api('GET', '/api/dev-costs'), c = id ? list.rows.find(x => x.id === id) : null; if (id && !c) return toast('원가표를 찾을 수 없습니다.', 'err');
  const can = list.can_manage, appr = list.can_confirm, st = c?.status || 'draft', edit = can && st === 'draft', dis = edit ? '' : ' disabled';
  const h0 = c || { base_qty: 1, sga_rate: 0, profit_rate: 0, ...pre };
  const lines = (c?.lines || []).map(l => ({ ...l }));
  if (edit && !lines.length) for (let i = 0; i < 3; i++) lines.push({ cat: 'material', date: todayStr(), currency: 'KRW' });
  const devOpt = d => `${d.req_no || '#' + d.id} · ${d.title}${d.customer ? ' · ' + d.customer : ''}`;
  const m = modal(`<h3>${c ? `${esc(c.cost_no)} · ${esc(c.title)} <span class="chip ${st === 'confirmed' ? 'green' : ''}">${esc(DC_STATUS_LABEL[st])}</span>` : '새 개발원가표'}</h3>
    <form class="stack" data-dc-form><div class="form-grid">
      <label class="span2">개발리스트 매칭<select name="dev_request_id"${dis}><option value="">— 개발 건 없이(사전 검토)</option>${list.dev_requests.map(d => `<option value="${d.id}"${d.id === Number(h0.dev_request_id) ? ' selected' : ''}>${esc(devOpt(d))}</option>`).join('')}</select><span class="hint">고르면 이름·고객이 비어 있을 때 개발 건에서 채웁니다</span></label>
      <label>원가표 이름 *<input name="title" maxlength="200" value="${esc(h0.title || '')}" placeholder="예) 9인치 와이퍼 1차 시제품"${dis}></label>
      <label>고객<input name="customer" maxlength="100" value="${esc(h0.customer || '')}"${dis}></label>
      <label>제품·모델<input name="product" maxlength="200" value="${esc(h0.product || '')}"${dis}></label>
      <label>원가 기준 수량 *<input type="number" name="base_qty" min="0" step="any" value="${esc(h0.base_qty ?? 1)}"${dis}><span class="hint">단위원가 = 총원가 ÷ 이 수량</span></label>
      <label>단위<input name="unit" maxlength="20" value="${esc(h0.unit || '')}" placeholder="EA·BOX·kg"${dis}></label>
      <label>판관비율(%)<input type="number" name="sga_rate" min="0" max="99" step="any" value="${esc(h0.sga_rate ?? 0)}"${dis}><span class="hint">직접비 × 비율을 판관비로 더함</span></label>
      <label>목표 이익률(%)<input type="number" name="profit_rate" min="0" max="99" step="any" value="${esc(h0.profit_rate ?? 0)}"${dis}><span class="hint">권장 판매단가 계산</span></label>
      <label>목표 판매단가(원)<input type="number" name="target_price" min="0" step="any" value="${esc(h0.target_price ?? '')}"${dis}></label>
      <label class="span3">비고<input name="note" maxlength="1000" value="${esc(h0.note || '')}"${dis}></label></div>
      <fieldset class="vendor-sec"><legend>원가 내역 <span class="hint">${edit ? 'Enter·↑↓로 줄 이동, 엑셀에서 여러 칸·줄을 복사해 붙여넣으면 그 칸부터 채웁니다(열 순서: 발생일·구분·품목·규격·거래처·수량·단위·단가·통화·환율)' : '확정된 원가표는 잠겨 있습니다'}</span></legend>
        <div class="table-wrap dc-wrap"><table class="grid dc-grid" data-no-sort data-no-filter data-keep-cols data-no-reorder data-no-autoalign><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
        ${edit ? '<div class="actions"><button type="button" class="btn small" data-dc-add>＋ 줄</button><button type="button" class="btn small" data-dc-add5>＋ 5줄</button><span class="grow"></span></div>' : ''}
      </fieldset>
      <div class="dc-sum" data-dc-sum></div>
      <div class="actions">${c ? '<button type="button" class="btn" data-dc-hist>이력</button><button type="button" class="btn" data-dc-xlsx>엑셀</button>' : ''}${c && edit && !c.history.some(x => /확정/.test(x.what || '')) ? '<button type="button" class="btn danger" data-dc-del>삭제</button>' : ''}<span class="grow"></span>
        ${c && appr && st === 'confirmed' ? '<button type="button" class="btn" data-dc-to="draft">확정 취소</button>' : ''}${edit ? `<button class="btn${c && appr ? '' : ' primary'}">저장</button>` : ''}${c && appr && edit ? '<button type="button" class="btn primary" data-dc-to="confirmed">저장하고 확정</button>' : ''}</div>
    </form>`, { wide: true });
  m.el.classList.add('dc-modal');
  const form = $('[data-dc-form]', m.el), table = $('.dc-grid', form), touched = () => { if (m.el.parentElement) m.el.parentElement.dataset.dirty = '1'; };
  const head = () => edit ? formObj(form) : h0; // 읽기 전용(확정)이면 저장된 값으로
  // 개발 건을 고르면 비어 있는 이름·고객을 그 개발 건에서 채움
  form.elements.dev_request_id?.addEventListener('change', () => { const d = list.dev_requests.find(x => x.id === Number(form.elements.dev_request_id.value)); if (!d) return; if (!form.elements.title.value.trim()) form.elements.title.value = `${d.title}${d.cost_count ? ` ${d.cost_count + 1}차` : ''} 원가`; if (!form.elements.customer.value.trim()) form.elements.customer.value = d.customer || ''; });
  const cell = (col, l, r) => {
    const v = l[col.k] ?? '', at = `data-r="${r}" data-k="${col.k}" aria-label="${esc(col.l.replace(' *', ''))} ${r + 1}번 줄"`, st = ` style="min-width:${col.w}px"`;
    if (col.t === 'calc') return `<td class="r dc-amt" data-amt="${r}">${dcFmt(dcCalcC(head(), [l]).amt(l))}</td>`;
    if (!edit) return `<td class="${['num', 'calc'].includes(col.t) ? 'r' : col.t === 'date' || col.t === 'cur' ? 'c' : ''}">${esc(col.t === 'sel' ? DC_CAT_LABEL[v] || v : col.t === 'num' ? dcFmt(v, 4) : v)}</td>`;
    if (col.t === 'sel') return `<td><select ${at}${st}>${Object.entries(DC_CAT_LABEL).map(([k, lb]) => `<option value="${k}"${(v || 'material') === k ? ' selected' : ''}>${esc(lb)}</option>`).join('')}</select></td>`;
    if (col.t === 'cur') return `<td><select ${at}${st}>${DC_CURS.map(k => `<option${(v || 'KRW') === k ? ' selected' : ''}>${k}</option>`).join('')}</select></td>`;
    if (col.t === 'date') return `<td><input type="date" ${at} value="${esc(v)}"${st}></td>`;
    if (col.t === 'num') return `<td><input inputmode="decimal" class="r" ${at} value="${esc(v === '' || v == null ? '' : col.k === 'fx' && (l.currency || 'KRW') === 'KRW' ? '' : v)}"${col.k === 'fx' && (l.currency || 'KRW') === 'KRW' ? ' placeholder="1" disabled' : ''}${st}></td>`;
    return `<td><input ${at} value="${esc(v)}" maxlength="${col.k === 'item' || col.k === 'spec' ? 200 : col.k === 'note' ? 300 : 100}"${st}></td>`;
  };
  const sum = () => {
    const h = head(), k = dcCalcC(h, lines), cats = Object.entries(k.by).filter(([, v]) => v);
    $('tfoot', table).innerHTML = `<tr class="dc-total"><td></td><td colspan="${DC_COLS_C.findIndex(c => c.k === '_amt')}" class="r"><b>합계 ${lines.length}줄</b></td><td class="r"><b>${dcFmt(Object.values(k.by).reduce((a, b) => a + b, 0))}</b></td><td colspan="${DC_COLS_C.length - DC_COLS_C.findIndex(c => c.k === '_amt') - 1 + (edit ? 1 : 0)}"></td></tr>`;
    $('[data-dc-sum]', form).innerHTML = `<div class="dc-sum-grid"><table class="grid dc-cat" data-no-sort data-no-filter data-keep-cols data-no-reorder><thead><tr><th>구분</th><th>금액(원)</th><th>비율</th></tr></thead><tbody>${cats.map(([c, v]) => `<tr><td>${esc(DC_CAT_LABEL[c])}</td><td class="r">${dcFmt(v)}</td><td class="r">${k.total ? dcFmt(v / k.total * 100, 1) + '%' : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="muted small">원가 줄이 없습니다.</td></tr>'}${k.sga_auto ? `<tr><td>판관비(직접비 × ${dcFmt(h.sga_rate, 2)}%)</td><td class="r">${dcFmt(k.sga_auto)}</td><td class="r">${k.total ? dcFmt(k.sga_auto / k.total * 100, 1) + '%' : ''}</td></tr>` : ''}</tbody></table>
      <dl class="dc-kpi"><div><dt>직접비</dt><dd>${dcFmt(k.direct)}</dd></div><div><dt>판관비</dt><dd>${dcFmt(k.sga)}</dd></div><div class="em"><dt>총원가</dt><dd>${dcFmt(k.total)}원</dd></div>
        <div class="em"><dt>단위원가 (÷ ${dcFmt(h.base_qty || 1, 2)}${esc(h.unit || '')})</dt><dd>${dcFmt(k.unit_cost, 2)}원</dd></div>
        ${k.margin != null ? `<div class="${k.margin < 0 ? 'neg' : 'pos'}"><dt>목표가 ${dcFmt(h.target_price, 2)} 대비 이익</dt><dd>${dcFmt(k.margin, 2)}원 · ${dcFmt(k.margin_rate, 1)}%</dd></div>` : ''}
        ${k.suggest != null ? `<div><dt>이익률 ${dcFmt(h.profit_rate, 1)}% 권장 판매단가</dt><dd>${dcFmt(k.suggest)}원</dd></div>` : ''}</dl></div>`;
  };
  const draw = () => {
    $('thead', table).innerHTML = `<tr><th class="c">No</th>${DC_COLS_C.map(c => `<th>${esc(c.l)}</th>`).join('')}${edit ? '<th></th>' : ''}</tr>`;
    $('tbody', table).innerHTML = lines.map((l, r) => `<tr><td class="c">${r + 1}</td>${DC_COLS_C.map(c => cell(c, l, r)).join('')}${edit ? `<td class="nowrap"><button type="button" class="btn small" data-dc-dup="${r}" title="줄 복사">⧉</button> <button type="button" class="btn small" data-dc-rm="${r}" aria-label="${r + 1}번 줄 삭제">×</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${DC_COLS_C.length + 2}" class="empty">원가 줄이 없습니다.</td></tr>`;
    sum();
  };
  draw();
  const focus = (r, k) => { const el = $(`[data-r="${r}"][data-k="${k}"]`, table); if (el && !el.disabled) { el.focus(); el.select?.(); } };
  const newLine = () => { const last = lines.at(-1) || {}; return { date: last.date || todayStr(), cat: last.cat || 'material', currency: last.currency || 'KRW', fx: last.currency && last.currency !== 'KRW' ? last.fx : '', vendor: last.vendor || '' }; };
  const onEdit = e => {
    const t = e.target.closest('[data-k]'); if (!t) return; const r = Number(t.dataset.r), l = lines[r]; if (!l) return;
    l[t.dataset.k] = t.value; touched();
    if (t.dataset.k === 'currency') { const fx = $(`[data-r="${r}"][data-k="fx"]`, table); if (fx) { fx.disabled = t.value === 'KRW'; fx.placeholder = t.value === 'KRW' ? '1' : '환율'; if (t.value === 'KRW') { fx.value = ''; l.fx = ''; } else fx.focus(); } }
    const a = $(`[data-amt="${r}"]`, table); if (a) a.textContent = dcFmt(dcCalcC(head(), [l]).amt(l)); sum();
  };
  table.addEventListener('input', onEdit); table.addEventListener('change', onEdit);
  form.addEventListener('input', e => { if (!e.target.closest('.dc-grid')) sum(); });
  // 엑셀식 이동: Enter·↓ 다음 줄(마지막이면 줄 추가), ↑ 윗줄. 날짜·고르기 칸은 ↑↓를 값 바꾸기에 그대로 둠.
  table.addEventListener('keydown', e => {
    const t = e.target.closest('[data-k]'); if (!t || !edit) return; const r = Number(t.dataset.r), k = t.dataset.k;
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (r === lines.length - 1) { lines.push(newLine()); draw(); } focus(r + 1, k); return; }
    if (t.tagName === 'SELECT' || t.type === 'date') return;
    if (e.key === 'ArrowDown' && r < lines.length - 1) { e.preventDefault(); focus(r + 1, k); } else if (e.key === 'ArrowUp' && r > 0) { e.preventDefault(); focus(r - 1, k); }
  });
  // 엑셀에서 복사한 여러 칸(탭)·여러 줄 붙여넣기: 그 칸부터 오른쪽·아래로 채움, 모자란 줄은 추가
  table.addEventListener('paste', e => {
    const t = e.target.closest('[data-k]'); if (!t || !edit) return; const text = e.clipboardData?.getData('text/plain') || ''; if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault(); const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(x => x.split('\t'));
    const keys = DC_COLS_C.filter(c => c.t !== 'calc').map(c => c.k), start = keys.indexOf(t.dataset.k), r0 = Number(t.dataset.r);
    rows.forEach((vals, i) => {
      const r = r0 + i; while (lines.length <= r) lines.push(newLine());
      vals.forEach((v, j) => { const k = keys[start + j]; if (!k) return; v = v.trim(); lines[r][k] = k === 'cat' ? dcCatOf(v) : k === 'currency' ? (DC_CURS.includes(v.toUpperCase()) ? v.toUpperCase() : 'KRW') : ['qty', 'unit_price', 'fx'].includes(k) ? String(dcNum(v) || (v === '' ? '' : 0)) : k === 'date' ? (v.match(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/)?.[0].replace(/[./]/g, '-').replace(/-(\d)(?=-|$)/g, '-0$1') || '') : v; });
    });
    touched(); draw(); toast(`${rows.length}줄을 붙여넣었습니다.`); focus(r0, t.dataset.k);
  });
  form.addEventListener('click', async e => {
    if (e.target.closest('[data-dc-add]')) { lines.push(newLine()); touched(); draw(); focus(lines.length - 1, 'item'); return; }
    if (e.target.closest('[data-dc-add5]')) { for (let i = 0; i < 5; i++) lines.push(newLine()); touched(); draw(); return; }
    const d = e.target.closest('[data-dc-dup]'); if (d) { const r = Number(d.dataset.dcDup), { key, amount, ...rest } = lines[r]; void key; void amount; lines.splice(r + 1, 0, { ...rest }); touched(); draw(); return; }
    const x = e.target.closest('[data-dc-rm]'); if (x) { lines.splice(Number(x.dataset.dcRm), 1); touched(); draw(); }
  });
  const body = () => { const h = head(); return { ...h, lines: lines.filter(l => String(l.item || '').trim() || dcNum(l.unit_price)).map(l => Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'amount'))) }; };
  const save = async () => c ? api('PUT', `/api/dev-costs/${c.id}`, { ...body(), revision: c.revision }) : api('POST', '/api/dev-costs', { ...body(), request_id: crypto.randomUUID() });
  const reopen = async (r, msg) => { toast(msg); m.close(); qReload(); await costOpen(r.id); };
  form.onsubmit = async e => { e.preventDefault(); try { reopen(await save(), '저장했습니다.'); } catch (err) { fail(err); } };
  $$('[data-dc-to]', m.el).forEach(b => b.addEventListener('click', async () => {
    try {
      if (b.dataset.dcTo === 'confirmed') { const r = await save(); return reopen(await api('POST', `/api/dev-costs/${r.id}/step`, { to: 'confirmed', revision: r.revision }), '확정했습니다. 고치려면 「확정 취소」 하세요.'); }
      const v = await promptBox('확정 취소', '<label>사유 *<input name="reason" required maxlength="300" placeholder="예) 원단 단가 변경"></label>'); if (!v) return;
      reopen(await api('POST', `/api/dev-costs/${c.id}/step`, { to: 'draft', revision: c.revision, reason: v.reason }), '확정을 취소했습니다.');
    } catch (err) { fail(err); }
  }));
  $('[data-dc-del]', m.el)?.addEventListener('click', async () => { if (!await confirmBox('이 원가표를 지울까요?')) return; try { await api('DELETE', `/api/dev-costs/${c.id}?revision=${c.revision}`); toast('지웠습니다.'); m.close(); qReload(); } catch (err) { fail(err); } });
  $('[data-dc-hist]', m.el)?.addEventListener('click', () => qHistory(c.cost_no, c.history, DC_STATUS_LABEL));
  $('[data-dc-xlsx]', m.el)?.addEventListener('click', () => dcXlsx(c));
}
function dcXlsx(c) {
  const k = c.calc, rows = c.lines.map((l, i) => [i + 1, l.date || '', DC_CAT_LABEL[l.cat] || l.cat, l.item, l.spec, l.vendor, l.qty, l.unit, l.unit_price, l.currency, l.currency === 'KRW' ? '' : l.fx, l.amount, l.note]);
  const blank = Array(13).fill(''), put = (label, v) => { const r = [...blank]; r[3] = label; r[11] = v; return r; };
  rows.push([...blank], put('직접비', k.direct), put(`판관비${c.sga_rate ? ` (줄 + 직접비 × ${c.sga_rate}%)` : ''}`, k.sga), put('총원가', k.total), put(`단위원가 (÷ ${c.base_qty}${c.unit || ''})`, k.unit_cost));
  if (k.margin != null) rows.push(put(`목표가 ${c.target_price} 대비 이익 (${k.margin_rate}%)`, k.margin)); if (k.suggest != null) rows.push(put(`권장 판매단가 (이익률 ${c.profit_rate}%)`, k.suggest));
  xlsxDownload(`${c.cost_no}_${c.title}.xlsx`, { sheet: c.cost_no, titles: [`개발원가 ${c.cost_no} · ${c.title}`, `${c.dev ? `${c.dev.req_no} ${c.dev.title} · ` : ''}${c.customer || ''} ${c.product || ''} · ${DC_STATUS_LABEL[c.status]}${c.confirmed_by ? ' · 확정 ' + c.confirmed_by : ''}`],
    columns: ['No', '발생일', '구분', '품목·내용', '규격', '거래처', '수량', '단위', '단가', '통화', '환율', '금액(원)', '비고'].map((label, i) => ({ label, type: [0, 6, 8, 10].includes(i) ? 'number' : i === 11 ? 'money' : i === 1 ? 'date' : 'text' })), rows });
}
async function pageDevCost(main) {
  let view = (() => { try { return localStorage.getItem(DC_VIEW_KEY) === 'match' ? 'match' : 'list'; } catch { return 'list'; } })();
  main.innerHTML = `<h1>개발원가 관리 <span class="dept">연구소</span></h1>
    <p class="muted">개발 건마다 <b>매입가·부대비용(운송·관세·포장)·외주가공·시험·인증·금형·인건비·판관비</b>를 엑셀처럼 줄로 쌓으면 금액(수량 × 단가 × 환율)·구분별 소계·판관비(줄 + 직접비 × 판관비율)·총원가·단위원가·목표가 대비 이익률·권장 판매단가를 자동 계산합니다. 「개발리스트 매칭」에서 개발 건별 누적 원가와 원가표가 없는 개발을 봅니다.</p>
    <div class="ip-tiles" id="dcTiles"></div>
    <div class="seg dc-view" role="group" aria-label="보기"><button type="button" class="btn" data-dc-view="list">원가표 목록(누적)</button><button type="button" class="btn" data-dc-view="match">개발리스트 매칭</button></div>
    <form class="toolbar list-filters" data-read-only id="dcFilters"><label class="lf-sel">상태<select name="st"><option value="">전체</option>${Object.entries(DC_STATUS_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">원가 없는 개발만<select name="nocost"><option value="">아니오</option><option value="1">예</option></select></label><label class="list-search">찾기<input type="search" name="q" placeholder="번호·개발명·고객·제품·품목"></label><span class="grow"></span><span id="dcTools" class="ip-tools"></span></form>
    <div id="dcList"></div>`;
  const form = $('#dcFilters', main); let data = { rows: [], dev_requests: [] };
  const load = async () => { data = await api('GET', '/api/dev-costs'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), rows = data.rows;
    $$('[data-dc-view]', main).forEach(b => b.classList.toggle('primary', b.dataset.dcView === view));
    form.elements.nocost.closest('label').hidden = view !== 'match'; form.elements.st.closest('label').hidden = view !== 'list';
    const live = data.dev_requests.filter(d => !['done', 'rejected'].includes(d.status)), noCost = live.filter(d => !d.cost_count), loss = rows.filter(r => r.calc.margin != null && r.calc.margin < 0);
    qTiles('dcTiles', [['원가표', rows.length], ['작성 중', rows.filter(r => r.status === 'draft').length, rows.some(r => r.status === 'draft') ? 'yellow' : ''], ['확정', rows.filter(r => r.status === 'confirmed').length, 'green'], ['원가표 없는 진행 개발', noCost.length, noCost.length ? 'yellow' : ''], ['목표가 미달', loss.length, loss.length ? 'red' : ''], ['누적 총원가(원)', dcFmt(rows.reduce((s, r) => s + r.calc.total, 0))]]);
    $('#dcTools', main).innerHTML = data.can_manage ? '<button type="button" class="btn primary" data-dc-new>＋ 원가표</button>' : '';
    if (view === 'list') {
      const shown = rows.filter(r => (!v.st || r.status === v.st) && (!q || [r.cost_no, r.title, r.customer, r.product, r.dev?.req_no, r.dev?.title, ...r.lines.map(l => l.item)].join(' ').toLowerCase().includes(q)));
      // 누적: 발생일(첫 줄) 순으로 더해 간 총원가
      const order = [...shown].sort((a, b) => String(a.calc.first_date || a.created_at).localeCompare(String(b.calc.first_date || b.created_at)) || a.id - b.id); let run = 0; const cum = {}; for (const r of order) { run += r.calc.total; cum[r.id] = run; }
      const tot = k => shown.reduce((s, r) => s + (r.calc[k] || 0), 0);
      $('#dcList', main).innerHTML = shown.length ? `<div class="table-wrap"><table class="grid ip-table dc-list"><thead><tr><th>번호</th><th>개발(개발리스트)</th><th>원가표 · 제품</th><th>고객</th><th>발생 기간</th><th>직접비</th><th>판관비</th><th>총원가</th><th>단위원가</th><th>목표가 · 이익률</th><th>누적 총원가</th><th>상태</th><th></th></tr></thead><tbody>${shown.map(r => `<tr data-dc-row="${r.id}" class="${r.calc.margin != null && r.calc.margin < 0 ? 'ip-over' : ''}"><td class="nowrap" data-card-primary><b>${esc(r.cost_no)}</b></td><td>${r.dev ? `<b>${esc(r.dev.req_no || '')}</b> ${esc(r.dev.title)}` : '<span class="muted small">매칭 없음</span>'}</td><td>${esc(r.title)}${r.product ? `<div class="small muted">${esc(r.product)}</div>` : ''}</td><td>${esc(r.customer || '')}</td><td class="c nowrap">${esc(r.calc.first_date || '')}${r.calc.last_date && r.calc.last_date !== r.calc.first_date ? ` ~ ${esc(r.calc.last_date)}` : ''}</td><td class="r">${dcFmt(r.calc.direct)}</td><td class="r">${dcFmt(r.calc.sga)}</td><td class="r"><b>${dcFmt(r.calc.total)}</b></td><td class="r">${dcFmt(r.calc.unit_cost, 2)}<div class="small muted">/${dcFmt(r.base_qty, 2)}${esc(r.unit || '')}</div></td><td class="r">${r.target_price != null ? `${dcFmt(r.target_price, 2)}<div class="small ${r.calc.margin < 0 ? 'err-text' : 'muted'}">${dcFmt(r.calc.margin_rate, 1)}%</div>` : '<span class="muted">—</span>'}</td><td class="r">${dcFmt(cum[r.id])}</td><td class="c"><span class="chip ${r.status === 'confirmed' ? 'green' : ''}">${esc(r.status_label)}</span></td><td><button type="button" class="btn small" data-dc-open="${r.id}">열기</button></td></tr>`).join('')}</tbody>
        <tfoot><tr class="dc-total"><td colspan="5" class="r"><b>합계 ${shown.length}건</b></td><td class="r">${dcFmt(tot('direct'))}</td><td class="r">${dcFmt(tot('sga'))}</td><td class="r"><b>${dcFmt(tot('total'))}</b></td><td colspan="5"></td></tr></tfoot></table></div>`
        : `<div class="empty">${rows.length ? '조건에 맞는 원가표가 없습니다.' : `원가표가 없습니다.${data.can_manage ? ' 「＋ 원가표」로 개발 건을 고르고 매입가·부대비용을 넣어 보세요. 엑셀에서 복사해 붙여넣어도 됩니다.' : ''}`}</div>`;
    } else {
      const shown = data.dev_requests.filter(d => (!v.nocost || !d.cost_count) && (!q || [d.req_no, d.title, d.customer].join(' ').toLowerCase().includes(q)));
      $('#dcList', main).innerHTML = shown.length ? `<div class="table-wrap"><table class="grid ip-table dc-match"><thead><tr><th>개발 번호</th><th>개발명</th><th>고객</th><th>개발 상태</th><th>원가표</th><th>누적 총원가</th><th>최근 단위원가</th><th></th></tr></thead><tbody>${shown.map(d => { const mine = rows.filter(r => r.dev_request_id === d.id), last = mine[0]; return `<tr class="${!d.cost_count && !['done', 'rejected'].includes(d.status) ? 'ip-over' : ''}"><td class="nowrap" data-card-primary><b>${esc(d.req_no || '#' + d.id)}</b></td><td>${esc(d.title)}</td><td>${esc(d.customer || '')}</td><td class="c">${esc(REQ_STATE[d.status] || d.status || '')}</td><td class="r">${d.cost_count ? `${d.cost_count}건` : '<span class="chip yellow">없음</span>'}</td><td class="r"><b>${d.cost_total ? dcFmt(d.cost_total) : ''}</b></td><td class="r">${last ? `${dcFmt(last.calc.unit_cost, 2)}<div class="small muted">${esc(last.cost_no)}</div>` : ''}</td><td class="nowrap">${last ? `<button type="button" class="btn small" data-dc-open="${last.id}">열기</button> ` : ''}${data.can_manage ? `<button type="button" class="btn small" data-dc-start="${d.id}">＋ 원가표</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`
        : `<div class="empty">${data.dev_requests.length ? '조건에 맞는 개발 건이 없습니다.' : '개발리스트에 개발 건이 없습니다. 「개발 관리 › 개발의뢰」에서 먼저 등록하세요.'}</div>`;
    }
  };
  main.addEventListener('click', e => {
    const vb = e.target.closest('[data-dc-view]'); if (vb) { view = vb.dataset.dcView; try { localStorage.setItem(DC_VIEW_KEY, view); } catch {} draw(); return; }
    if (e.target.closest('[data-dc-new]')) return costOpen().catch(fail);
    const o = e.target.closest('[data-dc-open]'); if (o) return costOpen(Number(o.dataset.dcOpen)).catch(fail);
    const s = e.target.closest('[data-dc-start]'); if (s) { const d = data.dev_requests.find(x => x.id === Number(s.dataset.dcStart)); costOpen(null, { dev_request_id: d.id, title: `${d.title}${d.cost_count ? ` ${d.cost_count + 1}차` : ''} 원가`, customer: d.customer || '' }).catch(fail); }
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}
