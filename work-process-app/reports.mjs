const REPORT_STATUSES = ['pending', 'rejected', 'waiting', 'progress', 'done'];
const REPORT_CATEGORIES = ['원자재', '부자재', '반제품', '제품', '상품', '미분류'];
const REPORT_UNKNOWN_UNIT = '단위 미지정';
function reportError(message) { return Object.assign(new Error(message), { status: 400 }); }
function reportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw reportError('조회 날짜를 확인하세요.');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw reportError('조회 날짜를 확인하세요.');
  return date;
}
function reportBucketExpression(column, grain) {
  if (grain === 'month') return `strftime('%Y-%m-01',${column})`;
  if (grain === 'week') return `date(${column},'-' || ((CAST(strftime('%w',${column}) AS INTEGER)+6)%7) || ' days')`;
  return `date(${column})`;
}
function reportBucketDates(from, to, grain) {
  const cursor = reportDate(from); const last = reportDate(to); const buckets = [];
  if (grain === 'week') cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  if (grain === 'month') cursor.setUTCDate(1);
  while (cursor <= last) {
    buckets.push(cursor.toISOString().slice(0, 10));
    if (grain === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1); else cursor.setUTCDate(cursor.getUTCDate() + (grain === 'week' ? 7 : 1));
  }
  return buckets;
}
function reportSum(rows, key) { return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0); }
function reportUnits(rows) { return [...new Set(rows.map(row => row.unit))].sort((a, b) => a.localeCompare(b, 'ko')); }
function reportRanking(rows, fields) {
  const map = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.item, row.unit, row.item_category]);
    if (!map.has(key)) map.set(key, { item: row.item, unit: row.unit, item_category: row.item_category, ...Object.fromEntries(fields.map(field => [field, 0])) });
    for (const field of fields) map.get(key)[field] += Number(row[field] || 0);
  }
  return [...map.values()];
}

// 반제품 커팅/융착·세탁: 생산량·양품·수율·불량률·인시당 생산량. 단위가 다른 수량은 합치지 않습니다.
const semiRound = n => Math.round((Number(n) || 0) * 1e6) / 1e6;
function semiTotals(rows, keyOf, labelOf) {
  const groups = new Map();
  for (const r of rows) {
    const key = keyOf(r); const g = groups.get(key) || { ...labelOf(r), records: 0, qty: 0, defect_qty: 0, work_hours: 0, man_hours: 0, timed_good_qty: 0 };
    // qty is the good quantity; defects are counted separately, so the total is their sum.
    for (const f of ['records', 'qty', 'defect_qty', 'work_hours', 'man_hours', 'timed_good_qty']) g[f] += Number(r[f] || 0);
    groups.set(key, g);
  }
  return [...groups.values()].map(g => {
    const qty = semiRound(g.qty), defect = semiRound(g.defect_qty), manHours = semiRound(g.man_hours);
    const total = semiRound(qty + defect);
    return { ...g, qty, defect_qty: defect, good_qty: qty, total_qty: total, work_hours: semiRound(g.work_hours), man_hours: manHours,
      yield_rate: g.process === 'wash' ? null : total ? Math.round(qty / total * 1000) / 10 : null, defect_rate: g.process === 'wash' ? null : total ? Math.round(defect / total * 1000) / 10 : null,
      per_man_hour: g.process === 'wash' ? null : manHours ? Math.round(g.timed_good_qty / manHours * 100) / 100 : null };
  });
}
async function semiReport(db, from, to, category, q, grain) {
  if (category && category !== '반제품') return { rows: [], by_product: [], by_line: [], reasons: [], series: [] };
  let rows = await db.prepare(`SELECT ${reportBucketExpression('work_date', grain)} AS bucket, process, unit_name, CASE product_group WHEN 'seamless' THEN '심리스글러브' ELSE '와이퍼' END AS product_group_label,
      (CASE WHEN product_type='' THEN CASE product_group WHEN 'seamless' THEN '심리스글러브' ELSE '와이퍼' END WHEN product_group='seamless' THEN '심리스 ' || product_type ELSE product_type END)
        || CASE WHEN item_name<>'' THEN ' · ' || item_name ELSE '' END AS product,
      spec, unit, CASE WHEN defect_qty>0 THEN COALESCE(NULLIF(defect_reason,''),'미지정') ELSE '' END AS reason,
      COUNT(*) AS records, SUM(qty) AS qty, SUM(defect_qty) AS defect_qty, SUM(COALESCE(work_hours,0)) AS work_hours,
      SUM(COALESCE(work_hours,0)*COALESCE(workers,0)) AS man_hours,
      SUM(CASE WHEN work_hours>0 AND workers>0 THEN qty ELSE 0 END) AS timed_good_qty
    FROM semi_records WHERE work_date BETWEEN ? AND ? GROUP BY 1,2,3,4,5,6,7,8 ORDER BY 1,2,3,5,6 LIMIT 20001`).all(from, to);
  if (rows.length > 20000) throw reportError('조회 결과가 많습니다. 기간이나 품목 필터를 좁혀 주세요.');
  if (q) { const needle = q.toLowerCase(); rows = rows.filter(r => [r.product, r.unit_name, r.spec].some(v => String(v || '').toLowerCase().includes(needle))); }
  // Defect reasons: share of each reason within the same process and unit.
  const reasons = semiTotals(rows.filter(r => r.defect_qty > 0), r => [r.process, r.reason, r.unit].join('\u0000'), r => ({ process: r.process, reason: r.reason, unit: r.unit }))
    .map(r => ({ process: r.process, reason: r.reason, unit: r.unit, defect_qty: r.defect_qty, records: r.records }));
  for (const r of reasons) { const total = reasons.filter(x => x.process === r.process && x.unit === r.unit).reduce((sum, x) => sum + x.defect_qty, 0); r.share = total ? Math.round(r.defect_qty / total * 1000) / 10 : null; }
  reasons.sort((a, b) => a.process.localeCompare(b.process) || a.unit.localeCompare(b.unit) || b.defect_qty - a.defect_qty);
  return {
    rows: semiTotals(rows, r => [r.process, r.unit_name, r.product, r.spec, r.unit].join('\u0000'), r => ({ process: r.process, unit_name: r.unit_name, product: r.product, spec: r.spec, unit: r.unit })),
    by_product: semiTotals(rows, r => [r.process, r.product, r.unit].join('\u0000'), r => ({ process: r.process, product: r.product, unit: r.unit })),
    by_line: semiTotals(rows, r => [r.process, r.unit_name, r.unit].join('\u0000'), r => ({ process: r.process, unit_name: r.unit_name, unit: r.unit })),
    reasons,
    // Yield per period for each product group (wipers and gloves are counted in different units, so they are separate lines).
    series: semiTotals(rows, r => [r.bucket, r.process, r.product_group_label].join('\u0000'), r => ({ bucket: r.bucket, process: r.process, group: r.product_group_label }))
      .map(r => ({ bucket: r.bucket, process: r.process, group: r.group, qty: r.qty, defect_qty: r.defect_qty, total_qty: r.total_qty, yield_rate: r.yield_rate, defect_rate: r.defect_rate })),
  };
}
export async function buildReport(db, query, today) {
  const grain = query.grain || 'day'; const planPeriod = query.plan_period || 'day';
  if (!['day', 'week', 'month'].includes(grain) || !['day', 'week', 'month'].includes(planPeriod)) throw reportError('일간·주간·월간 기준을 확인하세요.');
  const to = query.to || today;
  const from = query.from || to.slice(0, 7) + '-01';
  const start = reportDate(from), end = reportDate(to);
  const maxEnd = new Date(start); maxEnd.setUTCFullYear(start.getUTCFullYear() + 3);
  if (start > end || end > maxEnd) throw reportError('조회 기간은 시작일 이후 최대 3년까지 선택하세요.');
  const category = query.item_category || ''; const q = String(query.q || '').trim();
  if (category && !REPORT_CATEGORIES.includes(category)) throw reportError('품목 분류를 확인하세요.');
  if (q.length > 200) throw reportError('검색어는 200자까지 입력하세요.');
  const lineName = (column, spec) => `${column} || CASE WHEN ${spec}<>'' THEN ' [' || ${spec} || ']' ELSE '' END`;
  const normalizedCategory = column => `COALESCE(NULLIF(${column},''),'미분류')`;
  const normalizedUnit = (column, item) => `COALESCE(NULLIF(${column},''),'${REPORT_UNKNOWN_UNIT} · ' || ${item})`;
  const filter = (date, categoryColumn, item, partner) => {
    const where = [`${date}>=?`, `${date}<=?`]; const args = [from, to];
    if (category) { where.push(`${normalizedCategory(categoryColumn)}=?`); args.push(category); }
    if (q) { where.push(`(${item} LIKE ?${partner ? ` OR ${partner} LIKE ?` : ''})`); args.push('%' + q + '%'); if (partner) args.push('%' + q + '%'); }
    return { sql: where.join(' AND '), args };
  };
  const analysisDate = "substr(r.created_at,1,10)";
  const af = filter(analysisDate, "json_extract(r.data,'$.item_category')", lineName('r.title','r.spec'), 'r.customer');
  const pf = filter('substr(p.recv_at,1,10)', 'p.item_category', lineName('p.item','p.spec'), 'p.vendor');
  const of = filter('o.received_date', 'o.item_category', lineName('o.item','o.spec'), 'o.vendor');
  const sf = filter('s.start_date', "json_extract(s.bom_snapshot,'$.item_category')", lineName('s.product','s.spec'));
  const hf = filter('h.ship_date', "''", lineName('h.item','h.spec'), 'h.customer');
  const receiptCte = `WITH incoming AS (
    SELECT substr(p.recv_at,1,10) AS received_date,${lineName('p.item','p.spec')} AS item,${normalizedCategory('p.item_category')} AS item_category,
      ${normalizedUnit("p.unit", lineName('p.item','p.spec'))} AS unit,'purchase' AS source,COALESCE(p.recv_qty,p.qty) AS qty,
      CASE WHEN a.inspection_status='abnormal' THEN 1 ELSE 0 END AS abnormal
      FROM purchase_orders p LEFT JOIN attachments a ON a.entity_type='purchase_order' AND a.entity_id=p.id
      WHERE p.recv_status IN ('ok','mismatch') AND p.recv_at IS NOT NULL AND ${pf.sql}
    UNION ALL
    SELECT o.received_date,${lineName('o.item','o.spec')},${normalizedCategory('o.item_category')},${normalizedUnit("COALESCE(NULLIF(o.unit,''),json_extract(o.bom_snapshot,'$.unit'))", lineName('o.item','o.spec'))},'other',o.qty,
      CASE WHEN a.inspection_status='abnormal' THEN 1 ELSE 0 END
      FROM other_receipts o LEFT JOIN attachments a ON a.entity_type='other_receipt' AND a.entity_id=o.id
      WHERE ${of.sql}
  )`;
  const queries = [
    { sql: `SELECT ${reportBucketExpression(analysisDate, grain)} AS bucket,r.status,COUNT(*) AS count FROM requests r WHERE r.type='analysis' AND ${af.sql} GROUP BY bucket,r.status ORDER BY bucket,r.status LIMIT 20001`, args: af.args },
    { sql: `${receiptCte} SELECT ${reportBucketExpression('received_date', grain)} AS bucket,item,item_category,unit,source,COUNT(*) AS count,SUM(qty) AS qty,SUM(abnormal) AS abnormal FROM incoming GROUP BY bucket,item,item_category,unit,source ORDER BY bucket,item,unit,source LIMIT 20001`, args: [...pf.args, ...of.args] },
    { sql: `SELECT ${reportBucketExpression('s.start_date', grain)} AS bucket,${lineName('s.product','s.spec')} AS item,${normalizedCategory("json_extract(s.bom_snapshot,'$.item_category')")} AS item_category,
        ${normalizedUnit("COALESCE(NULLIF(s.unit,''),json_extract(s.bom_snapshot,'$.unit'))", lineName('s.product','s.spec'))} AS unit,s.kind,COUNT(*) AS plans,SUM(CASE WHEN s.done=1 THEN 1 ELSE 0 END) AS done_plans,SUM(s.qty) AS planned_qty,SUM(CASE WHEN s.done=1 THEN s.qty ELSE 0 END) AS completed_qty, SUM(COALESCE((SELECT SUM(a.qty) FROM production_actuals a WHERE a.schedule_id=s.id AND a.voided_at IS NULL),0)
          + COALESCE((SELECT SUM(c.qty) FROM semi_records c WHERE s.kind='semi' AND c.process='cut'
              AND REPLACE(LOWER(COALESCE(NULLIF(c.item_name,''), CASE c.product_group WHEN 'seamless' THEN '심리스 ' || c.product_type ELSE c.product_type END)),' ','')=REPLACE(LOWER(s.product),' ','')
              AND (s.spec='' OR c.spec=s.spec)
              AND c.work_date BETWEEN s.start_date AND CASE s.period WHEN 'day' THEN s.start_date WHEN 'week' THEN date(s.start_date,'+6 days') ELSE date(s.start_date,'+1 month','-1 day') END),0)) AS actual_qty
        FROM schedules s WHERE s.period=? AND ${sf.sql} GROUP BY 1,2,3,4,5 ORDER BY bucket,item,unit LIMIT 20001`, args: [planPeriod, ...sf.args] },
    { sql: `SELECT ${reportBucketExpression('h.ship_date', grain)} AS bucket,${lineName('h.item','h.spec')} AS item,'미분류' AS item_category,${normalizedUnit("h.unit", lineName('h.item','h.spec'))} AS unit,COUNT(*) AS count,SUM(h.qty) AS qty FROM shipments h WHERE ${hf.sql} GROUP BY bucket,h.item,h.spec,h.unit ORDER BY bucket,h.item LIMIT 20001`, args: hf.args },
  ];
  const results = await db.batch(queries);
  const [analysisRows, receiptRows, productionRows, shipmentRows] = results.map(result => result.results);
  if (results.some(result => result.results.length > 20000)) throw reportError('조회 결과가 많습니다. 기간이나 품목 필터를 좁혀 주세요.');
  const buckets = reportBucketDates(from, to, grain);
  const semi = await semiReport(db, from, to, category, q, grain);
  const statuses = Object.fromEntries(REPORT_STATUSES.map(status => [status, reportSum(analysisRows.filter(row => row.status === status), 'count')]));
  const analysisTotal = reportSum(analysisRows, 'count');
  const analysis = {
    total: analysisTotal, statuses, completion_rate: analysisTotal ? Math.round(statuses.done / analysisTotal * 1000) / 10 : 0,
    series: buckets.map(bucket => ({ bucket, total: reportSum(analysisRows.filter(row => row.bucket === bucket), 'count'), done: reportSum(analysisRows.filter(row => row.bucket === bucket && row.status === 'done'), 'count') })),
  };
  const receiptUnits = reportUnits(receiptRows), productionUnits = reportUnits(productionRows), shipmentUnits = reportUnits(shipmentRows);
  const receipts = { count: reportSum(receiptRows, 'count'), abnormal_count: reportSum(receiptRows, 'abnormal'),
    by_unit: receiptUnits.map(unit => ({ unit, qty: reportSum(receiptRows.filter(row => row.unit === unit), 'qty'), purchase_qty: reportSum(receiptRows.filter(row => row.unit === unit && row.source === 'purchase'), 'qty'), other_qty: reportSum(receiptRows.filter(row => row.unit === unit && row.source === 'other'), 'qty') })),
    series: receiptRows,
    items: reportRanking(receiptRows, ['qty', 'count', 'abnormal']),
  };
  const production = { plans: reportSum(productionRows, 'plans'), done_plans: reportSum(productionRows, 'done_plans'),
    by_unit: productionUnits.map(unit => ({ unit, planned_qty: reportSum(productionRows.filter(row => row.unit === unit), 'planned_qty'), completed_qty: reportSum(productionRows.filter(row => row.unit === unit), 'completed_qty'), actual_qty: reportSum(productionRows.filter(row => row.unit === unit), 'actual_qty') })),
    series: productionRows, items: reportRanking(productionRows, ['planned_qty', 'completed_qty', 'actual_qty', 'plans']),
  };
  for (const row of [...production.by_unit,...production.series,...production.items]) { row.variance_qty = row.actual_qty - row.planned_qty; row.achievement_rate = row.planned_qty ? Math.round(row.actual_qty / row.planned_qty * 1000) / 10 : null; }
  const shipments = { count: reportSum(shipmentRows, 'count'), by_unit: shipmentUnits.map(unit => ({ unit, qty: reportSum(shipmentRows.filter(row => row.unit === unit), 'qty') })), series: shipmentRows };
  return {
    range: { from, to, grain, plan_period: planPeriod, item_category: category, q, timezone: 'Asia/Seoul' },
    generated_at: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date()),
    buckets, units: reportUnits([...receiptRows, ...productionRows, ...shipmentRows]), analysis, receipts, production, shipments, semi,
    definitions: {
      analysis: '선택 기간에 등록된 분석의뢰의 현재 상태입니다. 완료 건수와 완료율도 해당 등록 건을 기준으로 합니다.',
      receipts: '발주입고의 입고확인·수량상이 실입고수량과 기타입고 등록수량을 입고일 기준으로 집계합니다. 판정은 현재 검수 기록 기준입니다.',
      production: '선택한 일간·주간·월간 일정의 시작일 기준 계획수량과 연결된 실제 생산실적 누적량입니다. 실제 생산일은 실적 상세에서 확인하며 취소된 실적은 제외합니다. 완료 체크 수량은 기존 계획 완료 표시로 실제 생산량과 별개입니다.',
      semi: '반제품은 작업일 기준 커팅/융착·세탁 기록입니다. 양품수량과 불량수량을 따로 기록합니다. 총 수량 = 양품 + 불량, 수율 = 양품 ÷ 총 수량, 불량률 = 불량 ÷ 총 수량입니다. 작업시간은 시작·종료 시각에서 계산합니다. 인시당 생산량은 작업시간과 생산인원을 모두 입력한 기록만으로 계산합니다(양품 ÷ (시간 × 인원)). 승인 대기 중인 수정 요청은 반영하지 않습니다.',
      units: '수량은 단위별로 구분합니다. 단위 정보가 없는 기존 발주입고·출하·수기 일정은 단위 미지정으로 표시하고 품목별로 나눕니다.',
      categories: '분류 필터는 저장된 분류를 기준으로 합니다. 분류가 없는 기록과 출하는 미분류에 포함됩니다.',
    },
  };
}
