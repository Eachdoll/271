// ── 15.343 생산 › 환경점검 ──
// 큰 구분: 창고 · 라인. 구분마다 구역을 두고(구역 설정에서 추가·수정·순서·사용 안 함), 일별 점검일지를 쓴다.
//  · 온습도 점검(창고·라인 모두): 오전·오후 온도·습도. 구역 기준을 벗어나면 빨간색, 조치 내용 필수.
//  · 청소 체크시트(라인): 구역별 항목(편집 가능)을 양호 O · 불량 X · 해당 없음 - 로 체크. 불량이면 조치 필수.
//  · 결재: 점검자(기록한 사람) → 확인자(생산·품질, 창고는 물류도) → 승인자(생산책임자, 창고는 물류책임자도). 확인되면 기록이 잠김.
//  · 이탈·불량 → 부적합·CAPA 등록과 연결. 오퍼레이터 모드(생산 = 라인, 물류 = 창고)에서도 휴대폰으로 기록.
const ENV_AREA_L = { warehouse: '창고', line: '라인' }, ENV_AREA_IC = { warehouse: '🏬', line: '🏭' };
const ENV_ST_L = { open: '점검 중', confirmed: '확인 완료', approved: '승인 완료' }, ENV_ST_CHIP = { open: 'yellow', confirmed: 'blue', approved: 'green' };
const ENV_V_L = { O: '양호', X: '불량', '-': '해당 없음' };
const envRange = (a, b, u) => a == null && b == null ? '—' : a != null && b != null ? `${a} ~ ${b}${u}` : a != null ? `${a}${u} 이상` : `${b}${u} 이하`;
const envOutT = (z, t) => t != null && ((z.temp_min != null && t < z.temp_min) || (z.temp_max != null && t > z.temp_max));
const envOutH = (z, h) => h != null && ((z.hum_min != null && h < z.hum_min) || (z.hum_max != null && h > z.hum_max));
const envSs = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k) || ''; sessionStorage.setItem(k, v); } catch { /* 편의 */ } return ''; };
const envAddDay = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const envFmt = v => v == null ? '' : String(v);

async function pageEnv(main, { operator = false, area: fixedArea = '' } = {}) {
  let area = fixedArea || (envSs('envArea') === 'warehouse' ? 'warehouse' : 'line');
  let tab = operator ? 'day' : (['day', 'month', 'setup'].includes(envSs('envTab')) ? envSs('envTab') : 'day');
  let date = todayStr(), d = null, mon = null, setup = null, rail = null;
  main.innerHTML = `<h1>환경점검 <span class="dept">${operator ? esc(ENV_AREA_L[area]) : '생산'}</span></h1>
  ${operator ? '' : '<p class="muted">창고·라인의 구역별로 매일 <b>온습도(오전·오후)</b>를, 라인은 <b>청소 체크시트</b>도 점검합니다. 점검자가 기록하면 확인자가 확인하고 승인자가 승인합니다(확인되면 기록이 잠김). 기준을 벗어나거나 불량이면 조치 내용을 적고, 필요하면 부적합·CAPA로 넘깁니다. 구역·기준·청소 항목은 「구역 설정」에서 고칩니다.</p>'}
  <div class="seg q-tabs env-areas" id="envArea"${fixedArea ? ' hidden' : ''}>${Object.entries(ENV_AREA_L).map(([k, l]) => `<button type="button" data-area="${k}">${ENV_AREA_IC[k]} ${l}</button>`).join('')}</div>
  <div class="seg q-tabs" id="envTabs"${operator ? ' hidden' : ''}><button type="button" data-tab="day">일일 점검</button><button type="button" data-tab="month">월간 기록 · 인쇄</button><button type="button" data-tab="setup">구역 설정</button></div>
  <div class="ip-tiles" id="envTiles"></div>
  <div id="envBody"></div>`;
  const body = $('#envBody', main);
  const marks = () => { $$('#envArea button', main).forEach(b => b.classList.toggle('on', b.dataset.area === area)); $$('#envTabs button', main).forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); };
  const load = async () => {
    marks();
    if (tab === 'day') { d = await api('GET', `/api/env/day?area=${area}&date=${date}`); if (main.isConnected && tab === 'day') drawDay(); }
    else if (tab === 'month') { if (!$('#envMonthForm', body)) buildMonth(); await loadMonth(); }
    else { setup = await api('GET', `/api/env/zones?area=${area}`); if (main.isConnected && tab === 'setup') drawSetup(); }
  };
  main.qReload = () => load().catch(fail);

  // ── 일일 점검 ──
  const signHtml = (s, kind) => {
    const checkers = [...new Set(d.records.filter(r => s && r.sheet_id === s.id).map(r => r.checked_by))];
    const st = s?.status || 'open', miss = d.missing[kind] || [];
    const btn = [];
    if (s && d.can.confirm && st === 'open') btn.push(`<button type="button" class="btn small primary" data-env-act="confirm" data-sheet="${s.id}"${miss.length ? ' disabled title="아직 점검하지 않은 곳이 있습니다"' : ''}>확인</button>`);
    if (s && st === 'confirmed' && (s.confirmed_by === ME.name || d.can.approve)) btn.push(`<button type="button" class="btn small" data-env-act="unconfirm" data-sheet="${s.id}">확인 취소</button>`);
    if (s && d.can.approve && st === 'confirmed') btn.push(`<button type="button" class="btn small primary" data-env-act="approve" data-sheet="${s.id}">승인</button><button type="button" class="btn small danger" data-env-act="reject" data-sheet="${s.id}">반려</button>`);
    if (s && d.can.approve && st === 'approved') btn.push(`<button type="button" class="btn small" data-env-act="unapprove" data-sheet="${s.id}">승인 취소</button>`);
    if (s) btn.push(`<button type="button" class="btn small" data-env-hist="${s.id}">이력</button>`);
    const box = (t, who, at) => `<div class="env-sign-box${who ? ' on' : ''}"><span class="small muted">${t}</span><b>${who ? esc(who) : '—'}</b><span class="small muted">${at ? esc(String(at).slice(5, 16)) : ''}</span></div>`;
    return `<div class="env-sign"><span class="chip ${s ? ENV_ST_CHIP[st] : ''}">${s ? ENV_ST_L[st] : '기록 없음'}</span>
      <div class="env-sign-boxes">${box('점검자', checkers.join(', '))}${box('확인자', s?.confirmed_by, s?.confirmed_at)}${box('승인자', s?.approved_by, s?.approved_at)}</div>
      <span class="env-sign-btns">${btn.join('')}</span></div>
      ${s?.comment && st === 'open' ? `<p class="small env-warn">↩ 반려 사유: ${esc(s.comment)}</p>` : ''}
      ${miss.length ? `<p class="small muted">아직 점검하지 않은 곳 ${miss.length}: ${esc(miss.slice(0, 12).join(', '))}${miss.length > 12 ? ' …' : ''}</p>` : s ? '<p class="small muted">모든 구역을 점검했습니다.</p>' : ''}`;
  };
  const capaBtn = (s, bad) => !s || !bad ? '' : s.nc_id ? '<span class="chip">CAPA 연결됨</span>' : d.can.confirm ? `<button type="button" class="btn small" data-env-capa="${s.id}">⚠ 이탈 CAPA 등록</button>` : '';
  const drawDay = () => {
    const s = d.sheets.th, c = d.sheets.clean, zs = d.zones, rec = (z, slot, kind = 'th') => d.records.find(r => r.zone_id === z.id && r.slot === slot && r.sheet_id === (kind === 'th' ? s?.id : c?.id));
    const thR = d.records.filter(r => s && r.sheet_id === s.id), clR = d.records.filter(r => c && r.sheet_id === c.id);
    const nTh = d.need.th.length, am = thR.filter(r => r.slot === 'am').length, pm = thR.filter(r => r.slot === 'pm').length, dev = thR.filter(r => !r.ok).length, clBad = clR.filter(r => !r.ok).length;
    qTiles('envTiles', [['구역', zs.length], ['오전 점검', `${am}/${nTh}`, am >= nTh && nTh ? 'green' : ''], ['오후 점검', `${pm}/${nTh}`, pm >= nTh && nTh ? 'green' : ''], ['온습도 이탈', dev, dev ? 'red' : ''], ...(area === 'line' ? [['청소 점검', `${clR.length}/${d.need.clean.length}`, clR.length >= d.need.clean.length && d.need.clean.length ? 'green' : ''], ['청소 불량', clBad, clBad ? 'red' : '']] : [])]);
    const thLocked = s && s.status !== 'open', clLocked = c && c.status !== 'open';
    const cell = (z, r) => r ? r.skipped ? `<td colspan="3" class="muted">미점검 · ${esc(r.action)}</td>` : `<td class="r${envOutT(z, r.temp) ? ' env-out' : ''}">${r.temp}℃</td><td class="r${envOutH(z, r.hum) ? ' env-out' : ''}">${r.hum}%</td><td class="small">${esc(r.checked_by)} <span class="muted">${esc(String(r.updated_at || r.checked_at).slice(11, 16))}</span></td>` : '<td colspan="3" class="muted env-empty">미입력</td>';
    body.innerHTML = `<div class="toolbar env-datebar"><button type="button" class="btn" data-env-day="-1" aria-label="전날">◀</button><label class="lf-sel">점검일<input type="date" name="env_date" value="${date}" max="${d.today}"></label><button type="button" class="btn" data-env-day="1" aria-label="다음 날"${date >= d.today ? ' disabled' : ''}>▶</button>${date !== d.today ? '<button type="button" class="btn" data-env-today>오늘</button>' : ''}<span class="small muted">${ENV_AREA_IC[area]} ${ENV_AREA_L[area]} · ${esc(date)}</span></div>
    ${!zs.length ? `<div class="empty">${ENV_AREA_L[area]} 구역이 없습니다. ${d.can.setup ? '「구역 설정」에서 구역(예: ' + (area === 'line' ? '1라인·커팅실·세탁실' : '1동 원자재 창고·완제품 창고') + ')을 추가하세요.' : '생산·물류 담당자에게 구역 설정을 요청하세요.'}</div>` : `
    <section class="env-sec"><div class="env-sec-head"><h2>🌡 온습도 점검일지</h2><span class="grow"></span>${d.can.check && !thLocked ? '<button type="button" class="btn primary" data-env-th="am">오전 점검 입력</button><button type="button" class="btn primary" data-env-th="pm">오후 점검 입력</button>' : ''}${capaBtn(s, dev)}</div>
      ${signHtml(s, 'th')}
      <div class="table-wrap"><table class="grid env-table" data-keep-cols><thead><tr><th>구역</th><th>기준 온도</th><th>기준 습도</th><th class="r">오전 온도</th><th class="r">오전 습도</th><th>오전 점검자</th><th class="r">오후 온도</th><th class="r">오후 습도</th><th>오후 점검자</th><th>조치</th></tr></thead>
      <tbody>${zs.map(z => { const a = rec(z, 'am'), p = rec(z, 'pm'); const act = [a, p].filter(r => r && !r.ok && r.action).map(r => `${r.slot_label}: ${r.action}`).join(' / ');
        return `<tr class="${[a, p].some(r => r && !r.ok) ? 'ip-over' : ''}"><td data-card-primary><b>${esc(z.name)}</b>${z.active ? '' : ' <span class="chip">사용 안 함</span>'}</td><td class="nowrap">${envRange(z.temp_min, z.temp_max, '℃')}</td><td class="nowrap">${envRange(z.hum_min, z.hum_max, '%')}</td>${cell(z, a)}${cell(z, p)}<td class="small">${esc(act)}</td></tr>`; }).join('')}</tbody></table></div></section>
    ${area === 'line' ? `<section class="env-sec"><div class="env-sec-head"><h2>🧹 청소 체크시트</h2><span class="grow"></span>${capaBtn(c, clBad)}</div>
      ${signHtml(c, 'clean')}
      <div class="table-wrap"><table class="grid env-table"><thead><tr><th>구역</th><th class="r">항목</th><th class="r">양호</th><th class="r">불량</th><th class="r">해당 없음</th><th>점검자</th><th>조치</th><th></th></tr></thead>
      <tbody>${zs.filter(z => z.clean_items.length || rec(z, 'day', 'clean')).map(z => { const r = rec(z, 'day', 'clean'), n = v => r ? r.results.filter(x => x.v === v).length : '';
        return `<tr class="${r && !r.ok ? 'ip-over' : ''}"><td data-card-primary><b>${esc(z.name)}</b></td><td class="r">${r ? r.results.length : z.clean_items.length}</td>${r?.skipped ? `<td colspan="3" class="muted">미점검 · ${esc(r.action)}</td>` : `<td class="r">${n('O')}</td><td class="r${r && n('X') ? ' env-out' : ''}">${n('X')}</td><td class="r">${n('-')}</td>`}<td class="small">${r ? `${esc(r.checked_by)} <span class="muted">${esc(String(r.updated_at || r.checked_at).slice(11, 16))}</span>` : '<span class="muted env-empty">미점검</span>'}</td><td class="small">${r && !r.ok ? esc(r.action) : ''}</td>
          <td class="nowrap">${d.can.check && !clLocked ? `<button type="button" class="btn small${r ? '' : ' primary'}" data-env-clean="${z.id}">${r ? '고치기' : '체크'}</button>` : r ? `<button type="button" class="btn small" data-env-clean-view="${z.id}">보기</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="8" class="muted">청소 항목이 있는 라인 구역이 없습니다. 「구역 설정」에서 청소 항목을 넣으세요.</td></tr>`}</tbody></table></div></section>` : ''}`}`;
  };
  // 온습도 입력 창(오전/오후 한 번에): 기준 밖이면 빨간색 + 조치 칸 필수
  const thModal = slot => {
    const s = d.sheets.th, zs = d.zones.filter(z => z.active), L = slot === 'am' ? '오전' : '오후';
    const old = z => d.records.find(r => r.zone_id === z.id && r.slot === slot && s && r.sheet_id === s.id);
    const m = modal(`<h3>${ENV_AREA_IC[area]} ${ENV_AREA_L[area]} · ${L} 온습도 점검 <span class="small muted">${esc(date)}</span></h3>
      <form class="stack" data-env-th-form><p class="small muted">점검한 구역만 넣으면 됩니다(이미 넣은 값은 고쳐 씀). 점검하지 못한 구역은 「미점검」을 체크하고 사유를 적으세요.</p>
      <div class="env-in-list">${zs.map(z => { const r = old(z); return `<div class="env-in" data-z="${z.id}"><div class="env-in-name"><b>${esc(z.name)}</b><span class="small muted">${envRange(z.temp_min, z.temp_max, '℃')} · ${envRange(z.hum_min, z.hum_max, '%')}</span></div>
        <label class="env-num">온도 ℃<input type="number" step="0.1" inputmode="decimal" name="t${z.id}" value="${envFmt(r?.temp)}"${r?.skipped ? ' disabled' : ''}></label>
        <label class="env-num">습도 %<input type="number" step="0.1" min="0" max="100" inputmode="decimal" name="h${z.id}" value="${envFmt(r?.hum)}"${r?.skipped ? ' disabled' : ''}></label>
        <label class="chk env-skip"><input type="checkbox" name="s${z.id}"${r?.skipped ? ' checked' : ''}> 미점검</label>
        <label class="env-act"${r && (!r.ok || r.skipped) ? '' : ' hidden'}><span data-act-l>${r?.skipped ? '사유 *' : '조치 내용 *'}</span><input name="a${z.id}" maxlength="300" value="${esc(r?.action || '')}" placeholder="예) 제습기 가동 · 30분 뒤 재측정"></label></div>`; }).join('')}</div>
      <div class="actions"><span class="grow"></span><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
    const f = $('[data-env-th-form]', m.el);
    const sync = row => { const z = zs.find(x => x.id === Number(row.dataset.z)), t = row.querySelector('[name^=t]'), h = row.querySelector('[name^=h]'), sk = row.querySelector('[name^=s]').checked;
      t.disabled = h.disabled = sk; const tv = t.value === '' ? null : Number(t.value), hv = h.value === '' ? null : Number(h.value), ot = !sk && envOutT(z, tv), oh = !sk && envOutH(z, hv);
      t.classList.toggle('env-out', ot); h.classList.toggle('env-out', oh); row.classList.toggle('env-bad', ot || oh);
      const act = row.querySelector('.env-act'); act.hidden = !(sk || ot || oh); act.querySelector('[data-act-l]').textContent = sk ? '사유 *' : '조치 내용 *'; act.querySelector('input').required = !act.hidden; };
    $$('.env-in', f).forEach(sync); f.addEventListener('input', e => { const row = e.target.closest('.env-in'); if (row) sync(row); });
    $('[data-no]', m.el).onclick = () => m.close();
    f.onsubmit = async e => { e.preventDefault();
      const entries = $$('.env-in', f).map(row => { const id = row.dataset.z, g = n => f.elements[n + id]; return { zone_id: Number(id), slot, temp: g('t').value, hum: g('h').value, skipped: g('s').checked, action: g('a').value }; }).filter(x => x.skipped || x.temp !== '' || x.hum !== '');
      if (!entries.length) { toast('넣은 값이 없습니다.', 'err'); return; }
      f.inert = true;
      try { const r = await api('POST', '/api/env/records', { area, kind: 'th', date, entries }); m.close(); toast(`${L} ${r.saved}개 구역을 저장했습니다${r.deviations ? ` · 기준 이탈 ${r.deviations}곳` : ''}.`, r.deviations ? 'err' : undefined); load().catch(fail); }
      catch (err) { fail(err); } finally { f.inert = false; } };
  };
  // 청소 체크 창(구역 하나): 항목마다 양호·불량·해당 없음
  const cleanModal = (z, readOnly = false) => {
    const c = d.sheets.clean, r = d.records.find(x => x.zone_id === z.id && x.slot === 'day' && c && x.sheet_id === c.id);
    const items = r && (readOnly || r.results.length) ? [...new Set([...(readOnly ? [] : z.clean_items), ...r.results.map(x => x.item)])].filter(it => readOnly || z.clean_items.includes(it)) : z.clean_items;
    const val = it => r?.results.find(x => x.item === it)?.v || '';
    const m = modal(`<h3>🧹 ${esc(z.name)} · 청소 체크시트 <span class="small muted">${esc(date)}</span></h3>
      <form class="stack" data-env-clean-form>${readOnly ? `<p class="small muted">점검자 ${esc(r?.checked_by || '')} · ${esc(String(r?.updated_at || r?.checked_at || '').slice(0, 16))}</p>` : '<div class="toolbar"><button type="button" class="btn small" data-all-ok>모두 양호</button><label class="chk"><input type="checkbox" name="skip"' + (r?.skipped ? ' checked' : '') + '> 미가동·휴무(점검 안 함)</label></div>'}
      <ol class="env-clean">${items.map((it, i) => `<li class="env-ci"><span class="env-ci-t">${esc(it)}</span><span class="env-ox" role="radiogroup" aria-label="${esc(it)}">${['O', 'X', '-'].map(v => `<label class="env-ox-b v${v === '-' ? 'n' : v}"><input type="radio" name="i${i}" value="${v}"${val(it) === v ? ' checked' : ''}${readOnly ? ' disabled' : ''}><span>${v === '-' ? '–' : v} <small>${ENV_V_L[v]}</small></span></label>`).join('')}</span></li>`).join('')}</ol>
      <label class="env-act"${r && (!r.ok || r.skipped) ? '' : ' hidden'}><span data-act-l>${r?.skipped ? '사유 *' : '조치 내용 *'}</span><textarea name="action" rows="2" maxlength="300"${readOnly ? ' readonly' : ''} placeholder="예) 바닥 재청소 후 확인">${esc(r?.action || '')}</textarea></label>
      <div class="actions"><span class="grow"></span><button type="button" class="btn" data-no>${readOnly ? '닫기' : '취소'}</button>${readOnly ? '' : '<button class="btn primary">저장</button>'}</div></form>`, { wide: true });
    const f = $('[data-env-clean-form]', m.el), act = $('.env-act', f);
    const sync = () => { if (readOnly) return; const sk = f.elements.skip.checked, bad = $$('input[type=radio]:checked', f).some(x => x.value === 'X');
      $$('.env-clean input', f).forEach(x => { x.disabled = sk; }); act.hidden = !(sk || bad); act.querySelector('[data-act-l]').textContent = sk ? '사유 *' : '조치 내용 *'; f.elements.action.required = !act.hidden; };
    sync(); f.addEventListener('change', sync);
    $('[data-no]', m.el).onclick = () => m.close();
    $('[data-all-ok]', f)?.addEventListener('click', () => { $$('input[type=radio][value="O"]', f).forEach(x => { x.checked = true; }); f.closest('.modal-wrap').dataset.dirty = '1'; sync(); });
    f.onsubmit = async e => { e.preventDefault(); if (readOnly) return;
      const sk = f.elements.skip.checked, results = items.map((item, i) => ({ item, v: f.querySelector(`[name=i${i}]:checked`)?.value || '' }));
      if (!sk) { const miss = results.findIndex(x => !x.v); if (miss >= 0) { toast(`「${results[miss].item}」 결과를 고르세요.`, 'err'); return; } }
      f.inert = true;
      try { const res = await api('POST', '/api/env/records', { area, kind: 'clean', date, entries: [{ zone_id: z.id, results, skipped: sk, action: f.elements.action.value }] }); m.close(); toast(`${z.name} 청소 점검을 저장했습니다${res.deviations ? ' · 불량 있음' : ''}.`, res.deviations ? 'err' : undefined); load().catch(fail); }
      catch (err) { fail(err); } finally { f.inert = false; } };
  };
  const sheetAct = async (id, act) => {
    const s = Object.values(d.sheets).find(x => x?.id === id); if (!s) return;
    const L = { confirm: '확인', unconfirm: '확인 취소', approve: '승인', reject: '반려', unapprove: '승인 취소' }[act], need = ['reject', 'unapprove'].includes(act);
    let comment = '';
    if (need) { const v = await promptBox(`${s.kind_label} ${L}`, `<label>${L} 사유 *<input name="comment" required maxlength="300"></label>`); if (!v) return; comment = v.comment; }
    else if (!(await confirmBox(`${s.check_date} ${ENV_AREA_L[s.area]} ${s.kind_label}을(를) ${L}할까요?${act === 'confirm' ? ' 확인하면 기록이 잠깁니다.' : ''}`))) return;
    try { await api('PUT', `/api/env/sheets/${id}`, { action: act, revision: s.revision, comment }); toast(`${L}했습니다.`); load().catch(fail); } catch (err) { fail(err); }
  };
  const toCapa = async id => {
    const s = Object.values(d.sheets).find(x => x?.id === id); if (!s) return;
    const bad = d.records.filter(r => r.sheet_id === id && !r.ok), what = s.kind === 'th' ? '온습도 기준 이탈' : '청소 불량';
    const nc = await ncNew({ source_type: 'process', kind: '공정 이상', title: `${s.check_date} ${ENV_AREA_L[s.area]} ${what} · ${[...new Set(bad.map(r => r.zone_name))].join(', ')}`.slice(0, 200), item: `${ENV_AREA_L[s.area]} 환경점검`, detail: bad.map(r => s.kind === 'th' ? `${r.zone_name} ${r.slot_label} ${r.temp}℃ / ${r.hum}% · 조치: ${r.action}` : `${r.zone_name}: 불량 ${r.results.filter(x => x.v === 'X').map(x => x.item).join(', ')} · 조치: ${r.action}`).join('\n') });
    if (nc) { try { await api('POST', `/api/env/sheets/${id}/nc`, { nc_id: nc.id }); toast(`${nc.nc_no}로 등록하고 점검일지에 연결했습니다.`); load().catch(fail); } catch (err) { fail(err); } }
  };

  // ── 월간 기록 · 인쇄 (왼쪽 연도 폴더) ──
  const buildMonth = () => {
    const y0 = todayStr().slice(0, 4), m0 = Number(todayStr().slice(5, 7));
    body.innerHTML = `<div id="envMonthBox"><form class="toolbar list-filters" id="envMonthForm" data-read-only><label class="lf-sel">연도<select name="year"><option>${y0}</option></select></label>
      <label class="lf-sel">월<select name="month">${Array.from({ length: 12 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}"${i + 1 === m0 ? ' selected' : ''}>${i + 1}월</option>`).join('')}</select></label>
      <label class="lf-sel">점검<select name="kind"><option value="th">온습도</option><option value="clean">청소 체크시트</option></select></label>
      <label class="lf-sel">구역<select name="zone"><option value="">전체(일별 요약)</option></select></label>
      <span class="grow"></span><button type="button" class="btn" data-env-xlsx>엑셀</button><button type="button" class="btn primary" data-env-print>점검일지 인쇄</button></form>
      <div class="env-months" id="envMonths"></div><div id="envMonthOut"></div></div>`;
    const f = $('#envMonthForm', body); rail = yearRail(main, f, { counts: () => Object.fromEntries((mon?.years || []).map(y => [y.year, y.n])) });
    f.addEventListener('change', e => { if (['year', 'month'].includes(e.target.name)) loadMonth().catch(fail); else drawMonth(); });
    f.onsubmit = e => e.preventDefault();
  };
  const loadMonth = async () => {
    const f = $('#envMonthForm', body); const ym = `${f.elements.year.value}-${f.elements.month.value}`;
    mon = await api('GET', `/api/env/month?area=${area}&ym=${ym}`); if (!main.isConnected || tab !== 'month') return;
    yearOptions(f.elements.year, mon.years.map(y => y.year), ym.slice(0, 4)); rail?.draw();
    f.elements.kind.closest('label').hidden = area !== 'line'; if (area !== 'line') f.elements.kind.value = 'th';
    drawMonth();
  };
  const drawMonth = () => {
    const f = $('#envMonthForm', body), kind = f.elements.kind.value, ym = mon.ym, last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
    const zs = mon.zones.filter(z => kind === 'th' || z.clean_items.length || mon.records.some(r => r.kind === 'clean' && r.zone_id === z.id));
    const zsel = f.elements.zone, keep = zsel.value; zsel.innerHTML = `<option value="">전체(일별 요약)</option>${zs.map(z => `<option value="${z.id}">${esc(z.name)}${z.active ? '' : ' (사용 안 함)'}</option>`).join('')}`; zsel.value = zs.some(z => String(z.id) === keep) ? keep : '';
    if (kind === 'clean' && !zsel.value && zs[0]) zsel.value = String(zs[0].id);
    $('#envMonths', body).innerHTML = Array.from({ length: 12 }, (_, i) => { const k = `${ym.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`, x = mon.months.find(v => v.ym === k); return `<button type="button" class="env-mon${k === ym ? ' on' : ''}${x && x.n && x.approved === x.n ? ' ok' : ''}" data-env-mon="${i + 1}">${i + 1}월${x ? `<small>${x.approved}/${x.n}</small>` : ''}</button>`; }).join('');
    const sheets = mon.sheets.filter(s => s.kind === kind), recs = mon.records.filter(r => r.kind === kind), days = Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
    const sh = dd => sheets.find(s => s.check_date === dd), wd = dd => '일월화수목금토'[new Date(dd + 'T00:00:00Z').getUTCDay()];
    const signTd = s => `<td class="small">${s?.confirmed_by ? esc(s.confirmed_by) : ''}</td><td class="small">${s?.approved_by ? esc(s.approved_by) : ''}</td>`;
    const appr = sheets.filter(s => s.status === 'approved').length, bad = recs.filter(r => !r.ok).length, pastNo = days.filter(dd => dd <= mon.today && !sh(dd)).length;
    qTiles('envTiles', [['점검일지', sheets.length], ['승인 완료', appr, appr && appr === sheets.length ? 'green' : ''], ['결재 대기', sheets.length - appr, sheets.length - appr ? 'yellow' : ''], [kind === 'th' ? '기준 이탈' : '불량', bad, bad ? 'red' : ''], ['기록 없는 날', pastNo]]);
    const z = zs.find(x => String(x.id) === zsel.value); let html;
    if (!z) html = `<table class="grid keep-table env-month" data-no-filter data-no-sort data-keep-cols data-no-reorder><thead><tr><th>일자</th><th>상태</th>${kind === 'th' ? '<th class="r">오전</th><th class="r">오후</th><th class="r">이탈</th>' : '<th class="r">점검 구역</th><th class="r">불량</th>'}<th>점검자</th><th>확인</th><th>승인</th></tr></thead><tbody>${days.map(dd => { const s = sh(dd), rs = recs.filter(r => r.check_date === dd), bd = rs.filter(r => !r.ok).length;
      return `<tr class="${bd ? 'ip-over' : ''}${['일', '토'].includes(wd(dd)) ? ' env-we' : ''}"><td class="nowrap">${dd.slice(5)} (${wd(dd)})</td><td>${s ? `<span class="chip ${ENV_ST_CHIP[s.status]}">${ENV_ST_L[s.status]}</span>` : '<span class="muted">—</span>'}</td>${kind === 'th' ? `<td class="r">${rs.filter(r => r.slot === 'am').length || ''}</td><td class="r">${rs.filter(r => r.slot === 'pm').length || ''}</td>` : `<td class="r">${rs.length || ''}</td>`}<td class="r${bd ? ' env-out' : ''}">${bd || ''}</td><td class="small">${esc([...new Set(rs.map(r => r.checked_by))].join(', '))}</td>${signTd(s)}</tr>`; }).join('')}</tbody></table>`;
    else if (kind === 'th') html = `<p class="small muted">${esc(z.name)} · 기준 온도 ${envRange(z.temp_min, z.temp_max, '℃')} · 습도 ${envRange(z.hum_min, z.hum_max, '%')}</p><table class="grid keep-table env-month" data-no-filter data-no-sort data-keep-cols data-no-reorder><thead><tr><th>일자</th><th class="r">오전 온도</th><th class="r">오전 습도</th><th>점검자</th><th class="r">오후 온도</th><th class="r">오후 습도</th><th>점검자</th><th>조치</th><th>확인</th><th>승인</th></tr></thead><tbody>${days.map(dd => { const s = sh(dd), g = slot => recs.find(r => r.check_date === dd && r.zone_id === z.id && r.slot === slot), a = g('am'), p = g('pm');
      const c3 = r => !r ? '<td></td><td></td><td></td>' : r.skipped ? '<td colspan="2" class="muted">미점검</td><td class="small">' + esc(r.checked_by) + '</td>' : `<td class="r${envOutT(z, r.temp) ? ' env-out' : ''}">${r.temp}</td><td class="r${envOutH(z, r.hum) ? ' env-out' : ''}">${r.hum}</td><td class="small">${esc(r.checked_by)}</td>`;
      return `<tr class="${[a, p].some(r => r && !r.ok) ? 'ip-over' : ''}${['일', '토'].includes(wd(dd)) ? ' env-we' : ''}"><td class="nowrap">${dd.slice(5)} (${wd(dd)})</td>${c3(a)}${c3(p)}<td class="small">${esc([a, p].filter(r => r && (!r.ok || r.skipped)).map(r => `${r.slot_label}: ${r.action}`).join(' / '))}</td>${signTd(s)}</tr>`; }).join('')}</tbody></table>`;
    else { const its = [...new Set([...z.clean_items, ...recs.filter(r => r.zone_id === z.id).flatMap(r => r.results.map(x => x.item))])], R = dd => recs.find(r => r.check_date === dd && r.zone_id === z.id);
      html = `<p class="small muted">${esc(z.name)} · 청소 체크시트 (O 양호 · X 불량 · – 해당 없음 · 휴 = 미가동)</p><table class="grid keep-table env-month env-cs" data-no-filter data-no-sort data-keep-cols data-no-reorder><thead><tr><th>항목</th>${days.map(dd => `<th class="c${['일', '토'].includes(wd(dd)) ? ' env-we' : ''}">${+dd.slice(8)}</th>`).join('')}</tr></thead><tbody>
        ${its.map(it => `<tr><td>${esc(it)}</td>${days.map(dd => { const r = R(dd), v = r ? (r.skipped ? '휴' : r.results.find(x => x.item === it)?.v || '') : ''; return `<td class="c${v === 'X' ? ' env-out' : ''}">${v === '-' ? '–' : esc(v)}</td>`; }).join('')}</tr>`).join('')}
        <tr class="env-cs-sign"><td>점검자</td>${days.map(dd => `<td class="c small">${esc((R(dd)?.checked_by || '').slice(0, 3))}</td>`).join('')}</tr>
        <tr class="env-cs-sign"><td>확인</td>${days.map(dd => `<td class="c small">${esc((sh(dd)?.confirmed_by || '').slice(0, 3))}</td>`).join('')}</tr>
        <tr class="env-cs-sign"><td>승인</td>${days.map(dd => `<td class="c small">${esc((sh(dd)?.approved_by || '').slice(0, 3))}</td>`).join('')}</tr></tbody></table>
        ${recs.some(r => r.zone_id === z.id && !r.ok) ? `<p class="small"><b>불량 조치</b> ${recs.filter(r => r.zone_id === z.id && !r.ok).map(r => `${r.check_date.slice(5)} ${esc(r.action)}`).join(' / ')}</p>` : ''}`; }
    $('#envMonthOut', body).innerHTML = (zs.length || sheets.length) ? `<div class="table-wrap">${html}</div>` : `<div class="empty">${ENV_AREA_L[area]} 구역이 없습니다. 「구역 설정」에서 구역을 추가하세요.</div>`;
  };
  const monthTitle = () => { const f = $('#envMonthForm', body), z = f.elements.zone.selectedOptions[0]; return `${mon.ym.replace('-', '년 ')}월 ${ENV_AREA_L[area]} ${f.elements.kind.value === 'th' ? '온습도 점검일지' : '청소 체크시트'}${f.elements.zone.value ? ' · ' + z.textContent : ''}`; };
  const printMonth = async () => { const t = $('#envMonthOut table', body); if (!t) return; const co = await rptCompany();
    rptWindow(monthTitle(), `<div class="env-print">${t.outerHTML.replace('class="grid keep-table env-month', 'class="rpt-list env-month')}</div><div class="rpt-sign"><span>작성</span><span>검토</span><span>승인</span></div>`, co); };

  // ── 구역 설정 ──
  const drawSetup = () => {
    const zs = setup.zones.filter(z => z.area === area), can = setup.can_setup;
    qTiles('envTiles', [['구역', zs.length], ['사용 중', zs.filter(z => z.active).length, 'green'], ['사용 안 함', zs.filter(z => !z.active).length], ...(area === 'line' ? [['청소 항목 있는 구역', zs.filter(z => z.active && z.clean_items.length).length]] : [])]);
    body.innerHTML = `<div class="toolbar"><span class="small muted">${ENV_AREA_IC[area]} ${ENV_AREA_L[area]} 구역 ${zs.length}개. 기준(온도·습도 하한·상한)을 넣으면 벗어난 값이 빨간색으로 표시되고 조치 내용을 적어야 저장됩니다.${area === 'line' ? ' 청소 체크시트 항목은 구역마다 고칠 수 있고, 한 구역 항목을 다른 라인 구역에 그대로 적용할 수 있습니다.' : ''}</span><span class="grow"></span>${can ? '<button type="button" class="btn primary" data-env-zone-new>＋ 구역 추가</button>' : ''}</div>
    ${zs.length ? `<div class="table-wrap"><table class="grid env-table" data-no-filter><thead><tr><th>순서</th><th>구역</th><th>기준 온도</th><th>기준 습도</th>${area === 'line' ? '<th>청소 항목</th>' : ''}<th>사용</th><th>비고</th><th></th></tr></thead><tbody>${zs.map((z, i) => `<tr class="${z.active ? '' : 'muted'}"><td class="nowrap">${can ? `<button type="button" class="btn small" data-env-up="${z.id}"${i ? '' : ' disabled'} aria-label="위로">▲</button><button type="button" class="btn small" data-env-down="${z.id}"${i < zs.length - 1 ? '' : ' disabled'} aria-label="아래로">▼</button>` : i + 1}</td>
      <td data-card-primary><b>${esc(z.name)}</b></td><td class="nowrap">${envRange(z.temp_min, z.temp_max, '℃')}</td><td class="nowrap">${envRange(z.hum_min, z.hum_max, '%')}</td>${area === 'line' ? `<td class="small">${z.clean_items.length}개${z.clean_items.length ? ` <span class="muted">${esc(z.clean_items.slice(0, 2).join(' · '))}${z.clean_items.length > 2 ? ' …' : ''}</span>` : ''}</td>` : ''}<td>${z.active ? '<span class="chip green">사용</span>' : '<span class="chip">사용 안 함</span>'}</td><td class="small">${esc(z.note)}</td>
      <td class="nowrap">${can ? `<button type="button" class="btn small" data-env-zone="${z.id}">수정</button>${area === 'line' && z.clean_items.length ? ` <button type="button" class="btn small" data-env-apply="${z.id}">항목 다른 구역에 적용</button>` : ''}${z.used ? '' : ` <button type="button" class="btn small danger" data-env-zone-del="${z.id}">삭제</button>`}` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${ENV_AREA_L[area]} 구역이 없습니다.${can ? ' 「＋ 구역 추가」로 넣으세요.' : ''}</div>`}`;
  };
  const zoneModal = z0 => {
    const z = z0 || { area, name: '', temp_min: null, temp_max: null, hum_min: null, hum_max: null, note: '', active: true, clean_items: area === 'line' ? [...setup.clean_default] : [] };
    let items = [...z.clean_items]; const others = setup.zones.filter(x => x.area === 'line' && x.id !== z.id && x.clean_items.length);
    const m = modal(`<h3>${z0 ? '구역 수정' : '구역 추가'} · ${ENV_AREA_IC[area]} ${ENV_AREA_L[area]}</h3><form class="stack" data-env-zone-form><div class="form-grid">
      <label class="span2">구역 이름 *<input name="name" required maxlength="60" list="envZoneSug" value="${esc(z.name)}" placeholder="${area === 'line' ? '예) 1라인 · 커팅실 · 세탁실' : '예) 1동 원자재 창고 · 완제품 창고'}"><datalist id="envZoneSug">${(setup.suggest[area] || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>
      ${z0 ? `<label class="chk"><input type="checkbox" name="active"${z.active ? ' checked' : ''}> 사용(점검 대상)</label>` : ''}
      <label>온도 하한 ℃<input type="number" step="0.1" name="temp_min" value="${envFmt(z.temp_min)}" placeholder="예) 15"></label><label>온도 상한 ℃<input type="number" step="0.1" name="temp_max" value="${envFmt(z.temp_max)}" placeholder="예) 28"></label>
      <label>습도 하한 %<input type="number" step="0.1" min="0" max="100" name="hum_min" value="${envFmt(z.hum_min)}" placeholder="예) 30"></label><label>습도 상한 %<input type="number" step="0.1" min="0" max="100" name="hum_max" value="${envFmt(z.hum_max)}" placeholder="예) 70"></label>
      <label class="span3">비고<input name="note" maxlength="300" value="${esc(z.note)}" placeholder="온습도계 위치·관리번호 등"></label></div>
      ${area === 'line' ? `<fieldset class="vendor-sec"><legend>🧹 청소 체크시트 항목</legend><div class="toolbar"><button type="button" class="btn small" data-ci-add>＋ 항목</button><button type="button" class="btn small" data-ci-def>기본 항목 넣기</button>${others.length ? `<label class="lf-sel">다른 구역에서 가져오기<select data-ci-copy data-no-dirty><option value="">고르기</option>${others.map(o => `<option value="${o.id}">${esc(o.name)} (${o.clean_items.length})</option>`).join('')}</select></label>` : ''}</div><ol class="env-ci-edit" data-ci-list></ol><p class="small muted">이미 쓴 점검 기록은 그때 항목 그대로 남고, 고친 항목은 다음 점검부터 적용됩니다.</p></fieldset>` : ''}
      <div class="actions"><span class="grow"></span><button type="button" class="btn" data-no>취소</button><button class="btn primary">저장</button></div></form>`, { wide: true });
    const f = $('[data-env-zone-form]', m.el), list = $('[data-ci-list]', f);
    const read = () => { if (list) items = $$('input', list).map(x => x.value); };
    const draw = () => { if (!list) return; list.innerHTML = items.map((it, i) => `<li><input value="${esc(it)}" maxlength="100" aria-label="항목 ${i + 1}" placeholder="예) 바닥 청소 상태"><button type="button" class="btn small" data-ci-up="${i}"${i ? '' : ' disabled'} aria-label="위로">▲</button><button type="button" class="btn small" data-ci-down="${i}"${i < items.length - 1 ? '' : ' disabled'} aria-label="아래로">▼</button><button type="button" class="btn small danger" data-ci-del="${i}" aria-label="항목 지우기">✕</button></li>`).join('') || '<li class="muted small">항목이 없습니다. 이 구역은 청소 체크시트에 나오지 않습니다.</li>'; };
    draw();
    f.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !list) return; const dirty = () => { f.closest('.modal-wrap').dataset.dirty = '1'; };
      if (b.matches('[data-ci-add]')) { read(); items.push(''); draw(); dirty(); $$('input', list).at(-1)?.focus(); }
      else if (b.matches('[data-ci-def]')) { read(); items = [...new Set([...items.filter(Boolean), ...setup.clean_default])]; draw(); dirty(); }
      else if (b.dataset.ciDel != null) { read(); items.splice(Number(b.dataset.ciDel), 1); draw(); dirty(); }
      else if (b.dataset.ciUp != null || b.dataset.ciDown != null) { read(); const i = Number(b.dataset.ciUp ?? b.dataset.ciDown), j = b.dataset.ciUp != null ? i - 1 : i + 1; [items[i], items[j]] = [items[j], items[i]]; draw(); dirty(); } });
    $('[data-ci-copy]', f)?.addEventListener('change', e => { const o = others.find(x => x.id === Number(e.target.value)); if (!o) return; read(); items = [...o.clean_items]; draw(); e.target.value = ''; f.closest('.modal-wrap').dataset.dirty = '1'; toast(`${o.name} 항목 ${o.clean_items.length}개를 가져왔습니다.`); });
    $('[data-no]', m.el).onclick = () => m.close();
    f.onsubmit = async e => { e.preventDefault(); read(); const v = formObj(f);
      const o = { area, name: v.name, temp_min: v.temp_min, temp_max: v.temp_max, hum_min: v.hum_min, hum_max: v.hum_max, note: v.note, clean_items: items.map(x => x.trim()).filter(Boolean) };
      f.inert = true;
      try { if (z0) await api('PUT', `/api/env/zones/${z0.id}`, { ...o, active: !!f.elements.active?.checked, revision: z0.revision }); else await api('POST', '/api/env/zones', o); m.close(); toast('구역을 저장했습니다.'); load().catch(fail); }
      catch (err) { fail(err); } finally { f.inert = false; } };
  };
  const move = async (id, dir) => { const zs = setup.zones.filter(z => z.area === area), i = zs.findIndex(z => z.id === id), j = i + dir; if (j < 0 || j >= zs.length) return; [zs[i], zs[j]] = [zs[j], zs[i]];
    try { await api('POST', '/api/env/zones/reorder', { area, ids: zs.map(z => z.id) }); load().catch(fail); } catch (err) { fail(err); } };

  main.addEventListener('click', e => {
    const ab = e.target.closest('#envArea [data-area]'); if (ab) { area = ab.dataset.area; envSs('envArea', area); if (tab === 'month') $('#envMonthBox', body)?.remove(); load().catch(fail); return; }
    const tb = e.target.closest('#envTabs [data-tab]'); if (tb) { tab = tb.dataset.tab; envSs('envTab', tab); body.innerHTML = ''; rail = null; load().catch(fail); return; }
    if (e.target.closest('[data-q-tile]')) return;
    const b = e.target.closest('button'); if (!b || !body.contains(b)) return;
    if (b.dataset.envDay) { date = envAddDay(date, Number(b.dataset.envDay)); if (date > d.today) date = d.today; load().catch(fail); }
    else if (b.matches('[data-env-today]')) { date = d.today; load().catch(fail); }
    else if (b.dataset.envTh) thModal(b.dataset.envTh);
    else if (b.dataset.envClean) cleanModal(d.zones.find(z => z.id === Number(b.dataset.envClean)));
    else if (b.dataset.envCleanView) cleanModal(d.zones.find(z => z.id === Number(b.dataset.envCleanView)), true);
    else if (b.dataset.envAct) sheetAct(Number(b.dataset.sheet), b.dataset.envAct);
    else if (b.dataset.envHist) { const s = Object.values(d.sheets).find(x => x?.id === Number(b.dataset.envHist)); if (s) qHistory(`${s.check_date} ${ENV_AREA_L[s.area]} ${s.kind_label}`, s.history); }
    else if (b.dataset.envCapa) toCapa(Number(b.dataset.envCapa)).catch(fail);
    else if (b.dataset.envMon) { const f = $('#envMonthForm', body); f.elements.month.value = String(b.dataset.envMon).padStart(2, '0'); loadMonth().catch(fail); }
    else if (b.matches('[data-env-print]')) printMonth().catch(fail);
    else if (b.matches('[data-env-xlsx]')) { const t = $('#envMonthOut table', body); if (t) tableToXlsx(t, monthTitle()); }
    else if (b.matches('[data-env-zone-new]')) zoneModal(null);
    else if (b.dataset.envZone) zoneModal(setup.zones.find(z => z.id === Number(b.dataset.envZone)));
    else if (b.dataset.envUp) move(Number(b.dataset.envUp), -1);
    else if (b.dataset.envDown) move(Number(b.dataset.envDown), 1);
    else if (b.dataset.envApply) { const z = setup.zones.find(x => x.id === Number(b.dataset.envApply)), n = setup.zones.filter(x => x.area === 'line' && x.active && x.id !== z.id).length;
      if (!n) { toast('적용할 다른 라인 구역이 없습니다.', 'err'); return; }
      confirmBox(`${z.name}의 청소 항목 ${z.clean_items.length}개를 다른 라인 구역 ${n}곳에 그대로 적용할까요? (그 구역들의 지금 항목은 바뀜)`).then(ok => ok && api('POST', `/api/env/zones/${z.id}/apply-items`, {}).then(r => { toast(`${r.updated}개 구역에 적용했습니다.`); load().catch(fail); })).catch(fail); }
    else if (b.dataset.envZoneDel) { const z = setup.zones.find(x => x.id === Number(b.dataset.envZoneDel)); confirmBox(`구역 「${z.name}」을(를) 지울까요?`).then(ok => ok && api('DELETE', `/api/env/zones/${z.id}`).then(() => { toast('지웠습니다.'); load().catch(fail); })).catch(fail); }
  });
  main.addEventListener('change', e => { if (e.target.name === 'env_date' && e.target.value) { date = e.target.value > d.today ? d.today : e.target.value; load().catch(fail); } });
  await load();
}
