// 엑셀(.xlsx) 내려받기(15.81). 외부 라이브러리 없이 만든다.
// 원칙: 한 값은 한 칸(셀 병합 없음, 빈 줄 끼우지 않음), 금액·수량은 숫자 칸(합계가 바로 나옴), 날짜는 진짜 날짜 칸.
// 머리글 줄은 틀 고정 + 자동 필터. 열 머리 위의 제목 줄은 A열에만 쓴다.
const XLSX_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function xlsxCrc(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = XLSX_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// 압축 없는(stored) zip
function xlsxZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name), data = enc.encode(text), crc = xlsxCrc(data);
    const head = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, dosTime, 2], [12, dosDate, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nameBytes.length, 2], [28, 0, 2]].forEach(([at, v, n]) => n === 4 ? head.setUint32(at, v, true) : head.setUint16(at, v, true));
    parts.push(new Uint8Array(head.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, dosTime, 2], [14, dosDate, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nameBytes.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]].forEach(([at, v, n]) => n === 4 ? cen.setUint32(at, v, true) : cen.setUint16(at, v, true));
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((t, p) => t + p.length, 0), end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4], [20, 0, 2]].forEach(([at, v, n]) => n === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true));
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xlsxCol = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const xlsxText = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 스타일 번호: 0 기본, 1 굵게, 2 #,##0, 3 날짜, 4 굵게 #,##0, 5 #,##0.###, 6 제목
const XLSX_STYLE = { text: 0, bold: 1, money: 2, date: 3, boldMoney: 4, number: 5, title: 6 };
function xlsxCell(ref, value, type, bold = false) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (m) return `<c r="${ref}" s="3"><v>${(Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000}</v></c>`;
  }
  if ((type === 'money' || type === 'number') && Number.isFinite(Number(value))) return `<c r="${ref}" s="${type === 'money' ? (bold ? 4 : 2) : 5}"><v>${Number(value)}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xlsxText(value)}</t></is></c>`;
}
// columns: [{ label, type: 'text'|'money'|'number'|'date', width }], rows: [[값…]], titles: ['제목', '부제'…], totals: [값…](굵게)
function xlsxDownload(filename, { sheet = 'Sheet1', titles = [], columns, rows, totals = null }) {
  const out = []; let r = 0;
  titles.forEach((t, i) => { r++; out.push(`<row r="${r}"><c r="A${r}" t="inlineStr" s="${i === 0 ? 6 : 0}"><is><t xml:space="preserve">${xlsxText(t)}</t></is></c></row>`); });
  if (titles.length) r++; // 제목과 표 사이 한 줄(표 안에는 빈 줄 없음)
  const headRow = ++r;
  out.push(`<row r="${headRow}">${columns.map((c, i) => `<c r="${xlsxCol(i)}${headRow}" t="inlineStr" s="1"><is><t>${xlsxText(c.label)}</t></is></c>`).join('')}</row>`);
  for (const row of rows) { r++; out.push(`<row r="${r}">${columns.map((c, i) => xlsxCell(xlsxCol(i) + r, row[i], c.type)).join('')}</row>`); }
  const lastData = r;
  if (totals) { r++; out.push(`<row r="${r}">${columns.map((c, i) => xlsxCell(xlsxCol(i) + r, totals[i], i === 0 ? 'text' : c.type, true)).join('')}</row>`); }
  const last = xlsxCol(columns.length - 1);
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || (c.type === 'date' ? 12 : c.type === 'text' ? 16 : 13)}" customWidth="1"/>`).join('')}</cols><sheetData>${out.join('')}</sheetData>${rows.length ? `<autoFilter ref="A${headRow}:${last}${lastData}"/>` : ''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" fitToHeight="0"/></worksheet>`;
  const safeSheet = xlsxText(String(sheet).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets>${rows.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${safeSheet.replace(/'/g, "''")}'!$A$${headRow}:$${last}$${lastData}</definedName></definedNames>` : ''}</workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/><numFmt numFmtId="166" formatCode="#,##0.###"/></numFmts><fonts count="3"><font><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="14"/><name val="맑은 고딕"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheetXml],
  ];
  const url = URL.createObjectURL(xlsxZip(files));
  const link = document.createElement('a'); link.href = url; link.download = filename.endsWith('.xlsx') ? filename : filename + '.xlsx'; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── 기간 빠른 선택(15.81): 오늘·어제·이번 주·지난 주·이번 달·지난 달·분기·상·하반기·금년·작년 + ◀ ▶ 같은 길이만큼 이동 ──
const rpIso = d => d.toISOString().slice(0, 10);
const rpDate = s => new Date((s || todayStr()) + 'T00:00:00Z');
function rpRange(kind, base) {
  const t = rpDate(todayStr()), y = (base ? rpDate(base) : t).getUTCFullYear();
  const day = n => { const d = new Date(t); d.setUTCDate(d.getUTCDate() + n); return d; };
  const monday = d => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
  const span = (a, b, unit) => ({ from: rpIso(a), to: rpIso(b), unit });
  const months = (yy, m0, n) => span(new Date(Date.UTC(yy, m0, 1)), new Date(Date.UTC(yy, m0 + n, 0)), n === 1 ? 'month' : n === 3 ? 'quarter' : n === 6 ? 'half' : 'year');
  switch (kind) {
    case 'today': return span(t, t, 'day');
    case 'yesterday': return span(day(-1), day(-1), 'day');
    case 'week': { const m = monday(t); const s = new Date(m); s.setUTCDate(s.getUTCDate() + 6); return span(m, s, 'week'); }
    case 'lastweek': { const m = monday(t); m.setUTCDate(m.getUTCDate() - 7); const s = new Date(m); s.setUTCDate(s.getUTCDate() + 6); return span(m, s, 'week'); }
    case 'month': return months(t.getUTCFullYear(), t.getUTCMonth(), 1);
    case 'lastmonth': return months(t.getUTCFullYear(), t.getUTCMonth() - 1, 1);
    case 'q1': case 'q2': case 'q3': case 'q4': return months(y, (Number(kind[1]) - 1) * 3, 3);
    case 'h1': return months(y, 0, 6);
    case 'h2': return months(y, 6, 6);
    case 'year': return months(t.getUTCFullYear(), 0, 12);
    case 'lastyear': return months(t.getUTCFullYear() - 1, 0, 12);
  }
  return null;
}
// 지금 범위가 어떤 단위인지 알아내 그만큼 앞뒤로 옮긴다(단위를 모르면 같은 날수만큼).
function rpShift(from, to, unit, dir) {
  const a = rpDate(from), b = rpDate(to || from);
  const monthsOf = { month: 1, quarter: 3, half: 6, year: 12 }[unit];
  if (monthsOf) { const s = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + dir * monthsOf, 1)); return { from: rpIso(s), to: rpIso(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + monthsOf, 0))), unit }; }
  const days = unit === 'week' ? 7 : unit === 'day' ? 1 : Math.round((b - a) / 86400000) + 1;
  a.setUTCDate(a.getUTCDate() + dir * days); b.setUTCDate(b.getUTCDate() + dir * days);
  return { from: rpIso(a), to: rpIso(b), unit };
}
function rpGuess(from, to) {
  if (!from || !to) return '';
  if (from === to) return 'day';
  const a = rpDate(from), b = rpDate(to), end = new Date(b); end.setUTCDate(end.getUTCDate() + 1);
  if (a.getUTCDate() === 1 && end.getUTCDate() === 1) { const n = (end.getUTCFullYear() - a.getUTCFullYear()) * 12 + end.getUTCMonth() - a.getUTCMonth(); return { 1: 'month', 3: 'quarter', 6: 'half', 12: 'year' }[n] || ''; }
  if (Math.round((b - a) / 86400000) === 6 && a.getUTCDay() === 1) return 'week';
  return '';
}
// fromInput·toInput 옆(또는 place 안)에 빠른 선택 버튼을 붙인다. 고르면 두 칸을 채우고 onPick() 부름.
// 15.89 한 줄로 접음: 「◀ [이번 달 ▾] ▶」. 가운데를 누르면 일·주·월 / 분기 / 반기·년 세 열로 펼쳐 고른다(휴대폰에서 버튼 세 줄이 지저분하던 문제).
const RP_GROUPS = [['일·주·월', [['today', '오늘'], ['yesterday', '어제'], ['week', '이번 주'], ['lastweek', '지난 주'], ['month', '이번 달'], ['lastmonth', '지난 달']]], ['분기', [['q1', '1분기'], ['q2', '2분기'], ['q3', '3분기'], ['q4', '4분기']]], ['반기·년', [['h1', '상반기'], ['h2', '하반기'], ['year', '금년'], ['lastyear', '작년']]]];
const RP_LABEL = Object.fromEntries(RP_GROUPS.flatMap(([, items]) => items));
function rangePresets(fromInput, toInput, { place = null, onPick = () => {} } = {}) {
  const box = document.createElement('div'); box.className = 'range-presets'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', '기간 빠른 선택');
  box.innerHTML = `<button type="button" class="btn small rp-arrow" data-rp="prev" aria-label="이전 기간">◀</button><button type="button" class="btn small rp-toggle" data-rp-toggle aria-expanded="false" aria-haspopup="true"><span data-rp-label></span> ▾</button><button type="button" class="btn small rp-arrow" data-rp="next" aria-label="다음 기간">▶</button>
    <div class="rp-panel" data-rp-panel hidden>${RP_GROUPS.map(([title, items]) => `<div class="rp-col"><div class="rp-col-title">${title}</div>${items.map(([k, l]) => `<button type="button" class="btn small" data-rp="${k}">${l}</button>`).join('')}</div>`).join('')}</div>`;
  const panel = $('[data-rp-panel]', box), toggle = $('[data-rp-toggle]', box), labelEl = $('[data-rp-label]', box);
  let unit = '', picked = '';
  const thisYear = todayStr().slice(0, 4);
  const short = s => !s ? '' : s.slice(0, 4) === thisYear ? s.slice(5).replace('-', '/') : `${s.slice(2, 4)}.${s.slice(5).replace('-', '/')}`;
  const detect = () => { picked = ''; if (rpGuess(fromInput.value, toInput.value)) for (const k of Object.keys(RP_LABEL)) { const r = rpRange(k, fromInput.value); if (r && r.from === fromInput.value && r.to === toInput.value) { picked = k; break; } } $$('[data-rp]', panel).forEach(x => x.classList.toggle('on', x.dataset.rp === picked)); };
  const sync = () => { detect(); setLabel(); };
  const setLabel = () => { labelEl.textContent = picked ? RP_LABEL[picked] : fromInput.value || toInput.value ? `${short(fromInput.value)} ~ ${short(toInput.value)}` : '기간 선택'; };
  const open = on => { panel.hidden = !on; toggle.setAttribute('aria-expanded', String(on)); box.classList.toggle('open', on); };
  box.addEventListener('click', e => {
    if (e.target.closest('[data-rp-toggle]')) { open(panel.hidden); return; }
    const k = e.target.closest('[data-rp]')?.dataset.rp; if (!k) return;
    const shift = k === 'prev' || k === 'next';
    const r = shift ? rpShift(fromInput.value || todayStr(), toInput.value || fromInput.value || todayStr(), unit || rpGuess(fromInput.value, toInput.value), k === 'prev' ? -1 : 1) : rpRange(k, fromInput.value);
    if (!r) return; unit = r.unit; fromInput.value = r.from; toInput.value = r.to;
    picked = shift ? '' : k;
    $$('[data-rp]', panel).forEach(x => x.classList.toggle('on', x.dataset.rp === picked));
    setLabel(); open(false); onPick(r);
  });
  // 바깥을 누르거나 Esc면 닫음(이 상자가 화면에서 사라지면 리스너도 정리)
  const cleanup = () => { document.removeEventListener('click', outside, true); document.removeEventListener('keydown', esc, true); window.removeEventListener('hashchange', cleanup); };
  const outside = e => { if (!box.isConnected) return cleanup(); if (!panel.hidden && !box.contains(e.target)) open(false); };
  const esc = e => { if (e.key === 'Escape' && !panel.hidden) { open(false); toggle.focus(); e.stopPropagation(); } };
  document.addEventListener('click', outside, true); document.addEventListener('keydown', esc, true); window.addEventListener('hashchange', cleanup);
  [fromInput, toInput].forEach(i => i.addEventListener('change', () => { unit = ''; picked = ''; $$('[data-rp]', panel).forEach(x => x.classList.remove('on')); setLabel(); }));
  sync();
  setTimeout(sync, 0); // 만든 바로 뒤 화면 코드가 저장된 조건으로 날짜를 채우는 경우
  fromInput.form?.addEventListener('submit', sync, true);
  box.sync = sync;
  (place || toInput.closest('label') || fromInput.closest('form') || fromInput.parentElement)[place ? 'append' : toInput.closest('label') ? 'after' : 'append'](box);
  return box;
}

// ── 15.113 엑셀 읽기(.xlsx 첫 시트 · .csv · 붙여넣기) → 표 [[칸…]…] ──
// .xlsx는 zip(저장·deflate) 안의 xl/sharedStrings.xml과 첫 시트 XML을 읽는다. 날짜 칸은 숫자(일련번호) 그대로.
async function xlsxInflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function readXlsx(buffer) {
  const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('엑셀(.xlsx) 파일이 아닙니다.');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('엑셀 파일이 손상되었습니다.');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files[name] = { method, size, local }; p += 46 + nameLen + extra + comment;
  }
  const read = async name => {
    const f = files[name]; if (!f) return null;
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true), raw = u8.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(raw); if (f.method === 8) return dec.decode(await xlsxInflate(raw));
    throw new Error('지원하지 않는 엑셀 압축 방식입니다.');
  };
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const textOf = el => [...el.getElementsByTagName('t')].map(t => t.textContent).join('');
  const sst = await read('xl/sharedStrings.xml'); const shared = sst ? [...xml(sst).getElementsByTagName('si')].map(textOf) : [];
  // 첫 시트: workbook.xml의 첫 sheet → rels의 대상. 못 찾으면 sheet1.xml.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  try {
    const wb = xml(await read('xl/workbook.xml')), rels = xml(await read('xl/_rels/workbook.xml.rels'));
    const first = wb.getElementsByTagName('sheet')[0], rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
    if (rel) { const t = rel.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
  } catch { /* 기본 경로 */ }
  const sheet = await read(sheetPath) || await read(Object.keys(files).find(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k)) || '');
  if (!sheet) throw new Error('엑셀 시트를 찾지 못했습니다.');
  const colIndex = ref => { let c = 0; for (const ch of ref.replace(/\d+$/, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  const rows = [];
  for (const row of xml(sheet).getElementsByTagName('row')) {
    const out = []; let next = 0;
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r'), i = ref ? colIndex(ref) : next; next = i + 1;
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      out[i] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? textOf(c) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
    }
    rows[Number(row.getAttribute('r') || rows.length + 1) - 1] = Array.from(out, x => x ?? '');
  }
  return Array.from(rows, r => r || []);
}
// CSV·탭 구분(엑셀에서 복사해 붙여넣기). 따옴표 안의 쉼표·줄바꿈 허용.
function readDelimited(text) {
  text = String(text || '').replace(/^﻿/, ''); const sep = text.split('\n', 1)[0].includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && !cell) q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
// 머리글 줄을 찾아 칸 이름 → 키. columns: [[key, 머리글, 다른 이름…]…]. 머리글이 하나도 안 맞으면 순서대로.
function importMap(table, columns) {
  const norm = s => String(s ?? '').replace(/[\s*()（）]/g, '').toLowerCase();
  const rows = table.filter(r => r.some(c => String(c ?? '').trim()));
  let headIdx = rows.findIndex((r, i) => i < 10 && r.filter(c => columns.some(col => col.slice(1).some(n => norm(n) === norm(c)))).length >= 2);
  let index;
  if (headIdx >= 0) index = columns.map(col => rows[headIdx].findIndex(c => col.slice(1).some(n => norm(n) === norm(c))));
  else { headIdx = -1; index = columns.map((_, i) => i); }
  const body = rows.slice(headIdx + 1).map(r => Object.fromEntries(columns.map((col, i) => [col[0], index[i] >= 0 ? String(r[index[i]] ?? '').trim() : ''])));
  return { rows: body, matched: columns.filter((_, i) => index[i] >= 0).map(c => c[1]), missing: columns.filter((_, i) => index[i] < 0).map(c => c[1]) };
}
// 올리기 창: 파일 고르기·붙여넣기 → 검사(dry_run) → 줄별 결과 → 넣기. 오류가 하나라도 있으면 넣지 않는다.
// 15.194 CSV 글자 인코딩: UTF-8(BOM 있든 없든)이 아니면 한글 엑셀이 저장하는 EUC-KR(CP949)로 읽는다.
function decodeCsv(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { try { return new TextDecoder('euc-kr').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); } }
}
function importDialog({ title, endpoint, columns, sample, help = '', after = null, csvCols = 0 }) {
  const m = modal(`<h3>${esc(title)}</h3>
    <p class="small muted">첫 줄은 머리글(칸 이름)입니다. 칸 순서는 상관없고, 이름이 맞는 칸만 읽습니다. 한 번에 500줄까지. ${help}</p>
    <div class="actions wrap" style="justify-content:flex-start"><label class="btn">파일 고르기 (.xlsx · .csv)<input type="file" accept=".xlsx,.csv,.txt" data-imp-file hidden></label>${csvCols ? '<button type="button" class="btn" data-imp-csv>CSV 양식</button>' : ''}<button type="button" class="btn" data-imp-sample>엑셀 양식</button><span class="small muted" data-imp-name></span></div>
    <label>또는 엑셀에서 복사해 붙여넣기<textarea data-imp-paste rows="4" placeholder="${esc(columns.map(c => c[1]).join('\t'))}"></textarea></label>
    <div data-imp-result></div>
    <div class="actions"><button type="button" class="btn" data-close>닫기</button><button type="button" class="btn" data-imp-check>검사</button><button type="button" class="btn primary" data-imp-go disabled>넣기</button></div>`, { wide: true });
  let rows = [], checked = false;
  const result = $('[data-imp-result]', m.el), go = $('[data-imp-go]', m.el);
  const setTable = table => {
    const r = importMap(table, columns); rows = r.rows; checked = false; go.disabled = true;
    result.innerHTML = `<p class="small">${rows.length}줄 읽음 · 읽은 칸: ${esc(r.matched.join(', ') || '없음')}${r.missing.length ? ` · <span class="muted">비워 둔 칸: ${esc(r.missing.join(', '))}</span>` : ''}</p>`;
  };
  $('[data-close]', m.el).onclick = m.close;
  $('[data-imp-sample]', m.el).onclick = () => xlsxDownload(`${title}_양식.xlsx`, { sheet: '양식', columns: columns.map(c => ({ label: c[1], type: 'text' })), rows: sample.map(x => columns.map(c => x[c[0]] ?? '')) });
  // CSV 양식: 꼭 필요한 앞쪽 칸만(엑셀에서 바로 열리게 UTF-8 BOM).
  if (csvCols) $('[data-imp-csv]', m.el).onclick = () => { const cols = columns.slice(0, csvCols), q = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v); const text = '\ufeff' + [cols.map(c => c[1]), ...sample.map(x => cols.map(c => x[c[0]] ?? ''))].map(r => r.map(q).join(',')).join('\r\n') + '\r\n'; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = `${title}_양식.csv`.replace(/[\\/:*?"<>|]/g, ''); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  $('[data-imp-file]', m.el).onchange = async e => {
    const file = e.target.files[0]; if (!file) return; $('[data-imp-name]', m.el).textContent = file.name;
    try { setTable(/\.xlsx$/i.test(file.name) ? await readXlsx(await file.arrayBuffer()) : readDelimited(decodeCsv(await file.arrayBuffer()))); }
    catch (error) { result.innerHTML = `<p class="red-text">${esc(error.message)}</p>`; rows = []; }
  };
  $('[data-imp-paste]', m.el).oninput = e => setTable(readDelimited(e.target.value));
  const send = async dry => {
    if (!rows.length) return toast('올릴 줄이 없습니다. 파일을 고르거나 붙여넣으세요.', 'err');
    const r = await api('POST', endpoint, { rows, dry_run: dry });
    if (!dry && !r.errors.length) { toast(`${r.inserted}줄을 넣었습니다.`); m.close(); await after?.(); return; }
    // 15.194 결과 표에는 파일에 값이 있는 칸만(코드·품명·분류만 올리면 빈 칸 6개가 늘어서지 않게).
    const cols = columns.filter((c, i) => i < 2 || rows.some(row => String(row[c[0]] ?? '').trim())), keys = cols.map(c => c[0]);
    result.innerHTML = `<p class="small"><b>${r.total}줄</b> 중 정상 ${r.ok}${r.errors.length ? ` · <span class="red-text">오류 ${r.errors.length} — 고쳐서 다시 올리세요(오류가 있으면 하나도 넣지 않습니다)</span>` : ' · 모두 정상, 「넣기」를 누르세요'}</p>
      <div class="table-wrap"><table class="grid" data-keep-cols data-no-sort><thead><tr><th>줄</th><th>검사</th>${cols.map(c => `<th class="nowrap">${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${rows.map((row, i) => { const res = r.rows?.[i] || r.errors.find(x => x.row === i + 1); return `<tr${res?.error ? ' class="row-err"' : ''}><td>${i + 1}</td><td class="${res?.error ? 'red-text' : 'small muted'}" style="min-width:14em">${esc(res?.error || '정상')}</td>${keys.map(k => `<td class="nowrap">${esc(row[k])}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>`;
    checked = dry && !r.errors.length; go.disabled = !checked;
  };
  $('[data-imp-check]', m.el).onclick = () => send(true).catch(fail);
  go.onclick = () => { if (checked) send(false).catch(fail); };
}
