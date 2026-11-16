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
