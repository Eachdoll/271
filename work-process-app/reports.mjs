const REPORT_STATUSES = ['pending', 'rejected', 'waiting', 'progress', 'done'];
const REPORT_CATEGORIES = ['제품', '상품', '원자재', '부자재', '미분류'];
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
  const normalizedCategory = column => `COALESCE(NULLIF(${column},''),'미분류')`;
  const normalizedUnit = (column, item) => `COALESCE(NULLIF(${column},''),'${REPORT_UNKNOWN_UNIT} · ' || ${item})`;
  const filter = (date, categoryColumn, item, partner) => {
    const where = [`${date}>=?`, `${date}<=?`]; const args = [from, to];
    if (category) { where.push(`${normalizedCategory(categoryColumn)}=?`); args.push(category); }
    if (q) { where.push(`(${item} LIKE ?${partner ? ` OR ${partner} LIKE ?` : ''})`); args.push('%' + q + '%'); if (partner) args.push('%' + q + '%'); }
    return { sql: where.join(' AND '), args };
  };
  const analysisDate = "substr(r.created_at,1,10)";
  const af = filter(analysisDate, "json_extract(r.data,'$.item_category')", 'r.title', 'r.customer');
  const pf = filter('substr(p.recv_at,1,10)', 'p.item_category', 'p.item', 'p.vendor');
  const of = filter('o.received_date', 'o.item_category', 'o.item', 'o.vendor');
  const sf = filter('s.start_date', "json_extract(s.bom_snapshot,'$.item_category')", 's.product');
  const hf = filter('h.ship_date', "''", 'h.item', 'h.customer');
  const receiptCte = `WITH incoming AS (
    SELECT substr(p.recv_at,1,10) AS received_date,p.item,${normalizedCategory('p.item_category')} AS item_category,
      ${normalizedUnit("''", 'p.item')} AS unit,'purchase' AS source,COALESCE(p.recv_qty,p.qty) AS qty,
      CASE WHEN a.inspection_status='abnormal' THEN 1 ELSE 0 END AS abnormal
      FROM purchase_orders p LEFT JOIN attachments a ON a.entity_type='purchase_order' AND a.entity_id=p.id
      WHERE p.recv_status IN ('ok','mismatch') AND p.recv_at IS NOT NULL AND ${pf.sql}
    UNION ALL
    SELECT o.received_date,o.item,${normalizedCategory('o.item_category')},${normalizedUnit("json_extract(o.bom_snapshot,'$.unit')", 'o.item')},'other',o.qty,
      CASE WHEN a.inspection_status='abnormal' THEN 1 ELSE 0 END
      FROM other_receipts o LEFT JOIN attachments a ON a.entity_type='other_receipt' AND a.entity_id=o.id
      WHERE ${of.sql}
  )`;
  const queries = [
    { sql: `SELECT ${reportBucketExpression(analysisDate, grain)} AS bucket,r.status,COUNT(*) AS count FROM requests r WHERE r.type='analysis' AND ${af.sql} GROUP BY bucket,r.status ORDER BY bucket,r.status LIMIT 20001`, args: af.args },
    { sql: `${receiptCte} SELECT ${reportBucketExpression('received_date', grain)} AS bucket,item,item_category,unit,source,COUNT(*) AS count,SUM(qty) AS qty,SUM(abnormal) AS abnormal FROM incoming GROUP BY bucket,item,item_category,unit,source ORDER BY bucket,item,unit,source LIMIT 20001`, args: [...pf.args, ...of.args] },
    { sql: `SELECT ${reportBucketExpression('s.start_date', grain)} AS bucket,s.product AS item,${normalizedCategory("json_extract(s.bom_snapshot,'$.item_category')")} AS item_category,
        ${normalizedUnit("json_extract(s.bom_snapshot,'$.unit')", 's.product')} AS unit,s.kind,COUNT(*) AS plans,SUM(CASE WHEN s.done=1 THEN 1 ELSE 0 END) AS done_plans,SUM(s.qty) AS planned_qty,SUM(CASE WHEN s.done=1 THEN s.qty ELSE 0 END) AS completed_qty
        FROM schedules s WHERE s.period=? AND ${sf.sql} GROUP BY bucket,item,item_category,unit,s.kind ORDER BY bucket,item,unit LIMIT 20001`, args: [planPeriod, ...sf.args] },
    { sql: `SELECT ${reportBucketExpression('h.ship_date', grain)} AS bucket,h.item,'미분류' AS item_category,${normalizedUnit("''", 'h.item')} AS unit,COUNT(*) AS count,SUM(h.qty) AS qty FROM shipments h WHERE ${hf.sql} GROUP BY bucket,h.item ORDER BY bucket,h.item LIMIT 20001`, args: hf.args },
  ];
  const results = await db.batch(queries);
  const [analysisRows, receiptRows, productionRows, shipmentRows] = results.map(result => result.results);
  if (results.some(result => result.results.length > 20000)) throw reportError('조회 결과가 많습니다. 기간이나 품목 필터를 좁혀 주세요.');
  const buckets = reportBucketDates(from, to, grain);
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
    by_unit: productionUnits.map(unit => ({ unit, planned_qty: reportSum(productionRows.filter(row => row.unit === unit), 'planned_qty'), completed_qty: reportSum(productionRows.filter(row => row.unit === unit), 'completed_qty') })),
    series: productionRows, items: reportRanking(productionRows, ['planned_qty', 'completed_qty', 'plans']),
  };
  const shipments = { count: reportSum(shipmentRows, 'count'), by_unit: shipmentUnits.map(unit => ({ unit, qty: reportSum(shipmentRows.filter(row => row.unit === unit), 'qty') })), series: shipmentRows };
  return {
    range: { from, to, grain, plan_period: planPeriod, item_category: category, q, timezone: 'Asia/Seoul' },
    generated_at: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date()),
    buckets, units: reportUnits([...receiptRows, ...productionRows, ...shipmentRows]), analysis, receipts, production, shipments,
    definitions: {
      analysis: '선택 기간에 등록된 분석의뢰의 현재 상태입니다. 완료 건수와 완료율도 해당 등록 건을 기준으로 합니다.',
      receipts: '발주입고의 입고확인·수량상이 실입고수량과 기타입고 등록수량을 입고일 기준으로 집계합니다. 판정은 현재 검수 기록 기준입니다.',
      production: '선택한 일간·주간·월간 일정의 시작일 기준 계획수량과 현재 완료 체크된 일정수량입니다. 완료 체크 수량은 별도 실적 입력값이 아닙니다.',
      units: '수량은 단위별로 구분합니다. 단위 정보가 없는 발주입고·출하·기존 수기 일정은 단위 미지정으로 표시하고 품목별로 나눕니다.',
      categories: '분류 필터는 저장된 분류를 기준으로 합니다. 분류가 없는 기록과 출하는 미분류에 포함됩니다.',
    },
  };
}
