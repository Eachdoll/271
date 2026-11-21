// ── 15.350 도움말 챗봇 ──
// 오른쪽 아래 💬. 질문하면 ① 실시간 질문(내 할 일 · 오늘 환경점검)은 시스템 숫자로, ② 사용법은 내가 쓸 수 있는 메뉴의 도움말·업무 흐름·자주 묻는 질문에서 찾아 답한다(무료, 외부 전송 없음).
// 서버에 AI(Cloudflare Workers AI 바인딩)가 붙어 있으면 찾은 자료만 근거로 문장을 다듬어 답한다. 없으면 찾은 자료를 그대로 보여 준다.
const ASSIST_FAQ = [
  { t: '특근 지정(휴무일에 점검)', k: '특근 주말 토요일 일요일 공휴일 휴무 점검 막힘 블락', a: '환경점검 › 일일 점검에서 휴무일(토·일·공휴일) 날짜를 열면 「특근 지정(점검하기)」 단추가 있습니다. 생산 담당(창고는 물류 담당도)·품질 담당이 지정하면 그날 점검을 기록할 수 있습니다. 창고와 라인은 따로 지정하며, 그날 기록이 생기면 특근 취소는 할 수 없습니다.', h: '#/prod/env' },
  { t: '라인 비가동 지정', k: '비가동 가동 안함 생산 없음 쉬는 라인 빗금', a: '환경점검 › 일일 점검(라인)에서 구역 줄의 「비가동」 또는 위쪽 「라인 전체 비가동」을 누르고 사유를 적습니다. 비가동 구역은 그날 점검 대상에서 빠지고 빗금으로 표시됩니다. 그날 점검 기록이 이미 있으면 지정할 수 없고, 확인 전까지 「비가동 취소」가 됩니다.', h: '#/prod/env' },
  { t: '회사 휴일 넣기', k: '회사 휴일 창립기념일 하계휴가 임시공휴일 휴일 관리 공휴일 표', a: '환경점검 › 구역 설정 아래 「휴일 관리」에서 「＋ 회사 휴일」로 날짜와 이름을 넣습니다. 그날은 창고·라인 모두 점검하지 않는 날(빗금)이 됩니다. 법정 공휴일·대체공휴일은 자동으로 들어가 있습니다.', h: '#/prod/env' },
  { t: '습도·온도 점검 끄기', k: '습도 끄기 온도 끄기 점검 조건 창고 습도 관리 안함', a: '환경점검 › 구역 설정에서 구역 「수정」을 눌러 「🌡 온도 점검」「💧 습도 점검」 체크를 켜고 끕니다. 하나는 켜야 하고, 창고 구역은 새로 만들 때 습도가 꺼져 있습니다.', h: '#/prod/env' },
  { t: '환경점검 결재(확인·승인·반려)', k: '환경점검 결재 확인 승인 반려 확인자 승인자 잠김 점검일지', a: '점검자가 오전·오후 온습도(라인은 청소 체크시트도)를 기록하면, 모든 구역을 점검한 뒤 확인자(생산·품질, 창고는 물류도)가 「확인」하고 승인자(생산책임자, 창고는 물류책임자도)가 「승인」합니다. 확인되면 기록이 잠기고, 확인한 사람과 승인한 사람은 달라야 합니다. 반려·확인 취소·승인 취소(사유)도 됩니다.', h: '#/prod/env' },
  { t: '여러 건 한꺼번에 승인', k: '한꺼번에 승인 일괄 승인 여러 건 승인 대기', a: '홈의 「내가 처리할 일」에서 COA 승인·문서 승인·환경점검 승인 대기가 2건 이상이면 「한꺼번에 승인」 단추가 보입니다. 환경점검 일괄 승인은 내가 확인한 일지는 빼고 보여 줍니다.', h: '#/' },
  { t: '구역 QR', k: 'QR 큐알 구역 휴대폰 카메라 바로 입력 라벨 붙이기', a: '환경점검 › 구역 설정에서 구역 줄의 「QR」 또는 「구역 QR 일괄 발행」으로 출력해 구역에 붙입니다. 휴대폰 카메라로 찍으면 로그인 뒤 그 구역의 오늘 점검 입력 창이 바로 열립니다(오퍼레이터는 오퍼레이터 화면으로).', h: '#/prod/env' },
  { t: '교육 테스트와 참석', k: '교육 테스트 시험 합격 이수 참석 확인 응시', a: '교육에 테스트를 붙이면 대상자가 교육·자격관리에서 풀고, 합격하면 이수와 참석이 자동으로 기록됩니다. 테스트가 없는 교육만 대상자 본인이 「참석 확인」을 누릅니다.', h: '#/quality/training' },
  { t: '자격 시험', k: '자격 시험 자격 부여 갱신 만료 검사원', a: '테스트 만들기에서 「자격 시험」에 자격 이름(예: 수입검사원)과 유효기간(개월)을 넣으면, 합격한 사람에게 그 자격이 부여·갱신되고 만료일이 자동으로 정해집니다. 만료 90일 전이면 재교육 계획을 권합니다.', h: '#/quality/training' },
  { t: '문제은행', k: '문제은행 문항 문제 모으기 무작위', a: '교육·자격관리의 「문제은행」 탭(품질 담당)에서 분류별로 문항을 모아 두고, 테스트를 만들 때 「📚 문제은행에서 가져오기」로 고르거나 무작위로 N개 넣습니다.', h: '#/quality/training' },
  { t: '부적합·CAPA 등록', k: 'CAPA 부적합 불합격 이탈 고장 원인분석 8D', a: '품질 › 부적합·CAPA에서 직접 등록하거나, 검사·분석·VOC 창, 설비 점검 이상·고장, 환경점검 이탈·불량에서 「CAPA 등록」으로 바로 등록합니다. 등록 → 원인분석 → 조치 → 유효성검증 → 종결 순서이고, 종결은 품질책임자가 합니다.', h: '#/quality/capa' },
  { t: '비밀번호 바꾸기', k: '비밀번호 변경 암호 로그인 내 정보 접속 기록', a: '오른쪽 위 내 이름을 눌러 「내 정보」에서 현재 비밀번호와 새 비밀번호를 넣어 바꿉니다. 같은 화면에서 최근 로그인 기록(IP·장소)도 확인할 수 있습니다.', h: '#/me' },
  { t: '다크 모드·언어·화면 설정', k: '다크 모드 어둡게 언어 영어 베트남어 글꼴 화면 설정 PC 화면', a: '오른쪽 위 「⚙ 화면 설정」에서 언어, 화면 모드(라이트·다크), 메뉴 위치, 화면 밀도, 글꼴을 바꿉니다.', h: '' },
  { t: '알림 받기', k: '알림 푸시 알림 받기 브라우저 알림 승인 대기 알림', a: '홈의 「내가 처리할 일」 제목 옆 「🔕 알림 받기」를 누르면, 앱이 열려 있는 동안 새 승인 대기·기한 알림을 컴퓨터·휴대폰 알림으로 받습니다.', h: '#/' },
  { t: '자주 쓰는 화면·크게 보기', k: '자주 쓰는 즐겨찾기 별 크게 보기 전체 화면 새 창', a: '화면 제목 옆 ☆을 누르면 「자주 쓰는 화면」에 추가되고, ⤢를 누르면 메뉴·탭을 숨기고 그 화면만 크게(새 창으로 분리도) 봅니다.', h: '' },
  { t: '엑셀 내려받기·인쇄', k: '엑셀 내려받기 다운로드 인쇄 PDF 출력', a: '목록 화면 오른쪽 위 「엑셀」로 지금 보이는 표를 내려받습니다. 보고서·점검일지·8D 같은 양식은 「인쇄」나 「인쇄 · PDF」 단추로 출력합니다.', h: '' },
  { t: '업무 흐름 막대', k: '업무 흐름 플로우차트 단계 다음 단계 순서', a: '화면 제목 아래 「업무 흐름」 막대는 지금 화면이 어느 단계인지 보여 줍니다. 단계를 누르면 그 화면으로 가고, 흐름이 여러 개면 위 칩으로 바꿔 보며, 「접기」로 줄일 수 있습니다.', h: '' },
  { t: '연도 폴더', k: '연도 폴더 작년 올해 해마다 누적 왼쪽 폴더', a: '연간 기록 화면(교육·협력업체·심사·CAPA·검사 이력·환경점검 월간 기록 등) 왼쪽 「📁 연도 폴더」에서 해를 고릅니다. 휴대폰에서는 폴더가 접혀 있어 눌러서 엽니다.', h: '' },
];
const ASSIST_TRY = ['오늘 내가 처리할 일', '오늘 환경점검 현황', '특근 지정은 어떻게 해?', '비밀번호 바꾸기'];
const asNorm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const asGrams = s => { const out = new Set(); for (const w of asNorm(s).split(' ')) { if (!w) continue; if (w.length === 1) out.add(w); for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2)); } return out; };
// 내가 볼 수 있는 메뉴만 자료로: 메뉴 이름·위치 + 그 화면 도움말(설명 문단을 본 적이 있으면) + 업무 흐름 + 자주 묻는 질문
function assistKb() {
  const kb = [], seen = new Set(), help = (() => { try { return JSON.parse(localStorage.getItem('wpa:helpcache') || '{}'); } catch { return {}; } })();
  const walk = (items, path) => items.forEach(it => { if (Array.isArray(it)) { const [h, l] = it; if (seen.has(h) || !canSeeRoute(h)) return; seen.add(h);
    const flows = PROCESS_FLOWS.filter(f => f.steps.some(s => s[0] === h)).map(f => `업무 흐름 「${f.name}」: ${f.steps.map(s => s[1]).join(' → ')}`);
    kb.push({ t: l, path: path.join(' › '), a: [ROUTE_HELP?.[h] || help[h] || '', ...flows].filter(Boolean).join('\n') || `${path.join(' › ')} › ${l} 화면입니다.`, h }); }
    else if (it.items) walk(it.items, [...path, it.sub || it.group]); });
  NAV.forEach(g => walk(g.items || [], [g.group]));
  return [...ASSIST_FAQ.filter(f => !f.h || canSeeRoute(f.h)), ...kb];
}
function assistSearch(q, kb) {
  const g = asGrams(q); if (!g.size) return [];
  return kb.map(e => { const tg = asGrams(`${e.t} ${e.k || ''}`), ag = asGrams(e.a); let s = 0; for (const x of g) { if (tg.has(x)) s += 3; else if (ag.has(x)) s += 1; } return { e, s: s / Math.sqrt(g.size + 2) }; })
    .filter(x => x.s >= 1.2).sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.e);
}
// 실시간 질문: 내 할 일 · 오늘 환경점검
async function assistLive(q) {
  const n = asNorm(q);
  if (/(할 일|할일|처리할|승인 대기|결재 대기|대기 중)/.test(n)) {
    const tasks = await api('GET', '/api/my-tasks'), total = taskTotal(tasks), a = tasks.approvals || {}, lines = [];
    for (const [type, gr] of Object.entries(a.requests || {})) if (gr.count) lines.push(`${REQ[type]?.label || type} 승인 대기 ${gr.count}건`);
    for (const x of a.quality || []) lines.push(`${x.label} ${x.count}건`);
    if (a.training_test?.count) lines.push(`응시할 교육 테스트 ${a.training_test.count}건`); if (a.training_attend?.count) lines.push(`참석 확인할 교육 ${a.training_attend.count}건`); if (a.pm_issue?.count) lines.push(`설비 점검 이상·고장 ${a.pm_issue.count}건`);
    return { t: '내가 처리할 일', a: total ? `지금 처리할 일이 ${total}건 있습니다.\n${lines.slice(0, 8).map(x => '· ' + x).join('\n')}` : '지금 처리할 일이 없습니다.', h: '#/' };
  }
  if (/(환경|온습도|온도|습도|청소)/.test(n) && /(오늘|현황|미입력|안 한|안한|빠진|상태)/.test(n)) {
    const d = await api('GET', '/api/env/today'); if (!d.rows.length) return { t: '오늘 환경점검', a: '환경점검을 볼 권한이 없습니다.', h: '' };
    return { t: '오늘 환경점검', a: d.rows.map(s => s.rest ? `${s.area_label}: 오늘 휴무(점검 없음)${s.holiday ? ` · ${s.holiday}` : ''}` : !s.zones ? `${s.area_label}: 점검할 구역이 없습니다` : `${s.area_label}: 오전 미입력 ${s.am_missing} · 오후 미입력 ${s.pm_missing}${s.area === 'line' ? ` · 청소 미체크 ${s.clean_missing}` : ''} · 이탈·불량 ${s.dev} · 승인 대기 일지 ${s.confirmed}`).join('\n'), h: '#/prod/env' };
  }
  return null;
}
async function assistAnswer(q) {
  const live = await assistLive(q).catch(() => null); if (live) return { cards: [live] };
  const kb = assistKb(), hits = assistSearch(q, kb);
  if (!hits.length) return { text: '그 질문에 맞는 도움말을 찾지 못했습니다. 메뉴 이름이나 하려는 일(예: 「특근」, 「CAPA 등록」, 「엑셀」)로 다시 물어보거나, 화면 오른쪽 위 「도움말」을 열어 보세요.', cards: [] };
  let ai = null; try { const r = await api('POST', '/api/assist', { q, context: hits.map(h => ({ title: h.t, text: h.a })) }); if (r.ai && r.answer) ai = r.answer; } catch { /* AI 없음 → 자료 그대로 */ }
  return { text: ai, cards: hits };
}
function assistMount() {
  if (document.getElementById('assistBtn') || typeof ME === 'undefined' || !ME || document.body.classList.contains('operator-mode')) return;
  document.body.insertAdjacentHTML('beforeend', `<button type="button" id="assistBtn" class="assist-btn" aria-label="도움말 챗봇 열기" aria-expanded="false" title="사용법을 물어보세요">💬</button>
    <aside id="assistPanel" class="assist-panel" hidden aria-label="도움말 챗봇"><header><b>💬 도움말 챗봇</b><span class="small muted">사용법·내 할 일·오늘 환경점검</span><button type="button" class="modal-x" data-assist-close aria-label="닫기">×</button></header>
      <div class="assist-log" aria-live="polite"><div class="assist-msg bot">무엇을 도와드릴까요? 메뉴 사용법이나 「오늘 내가 처리할 일」을 물어보세요.<div class="assist-try">${ASSIST_TRY.map(t => `<button type="button" class="btn small" data-assist-q="${esc(t)}">${esc(t)}</button>`).join('')}</div></div></div>
      <form class="assist-form" data-no-form-ux data-no-author><input name="q" maxlength="300" autocomplete="off" placeholder="예) 특근은 어떻게 지정해?" aria-label="질문"><button class="btn primary">보내기</button></form></aside>`);
  const btn = document.getElementById('assistBtn'), panel = document.getElementById('assistPanel'), log = panel.querySelector('.assist-log'), form = panel.querySelector('form');
  const open = on => { panel.hidden = !on; btn.setAttribute('aria-expanded', String(on)); btn.hidden = on; if (on) form.elements.q.focus(); else btn.focus(); };
  const say = (cls, html) => { log.insertAdjacentHTML('beforeend', `<div class="assist-msg ${cls}">${html}</div>`); log.scrollTop = log.scrollHeight; };
  const ask = async q => { q = q.trim(); if (!q) return; say('me', esc(q)); form.elements.q.value = ''; form.inert = true; say('bot wait', '찾는 중…');
    try { const r = await assistAnswer(q); log.querySelector('.wait')?.remove();
      say('bot', `${r.text ? `<p>${esc(r.text).replace(/\n/g, '<br>')}</p>` : ''}${r.cards.map(c => `<div class="assist-card"><b>${esc(c.t)}</b>${c.path ? ` <span class="small muted">${esc(c.path)}</span>` : ''}<p>${esc(c.a).replace(/\n/g, '<br>')}</p>${c.h ? `<a class="btn small" href="${c.h}" data-assist-go>바로 가기 →</a>` : ''}</div>`).join('')}`); }
    catch (err) { log.querySelector('.wait')?.remove(); say('bot', esc(err.message || '답을 가져오지 못했습니다.')); }
    finally { form.inert = false; form.elements.q.focus(); } };
  btn.onclick = () => open(true);
  panel.addEventListener('click', e => { if (e.target.closest('[data-assist-close]')) open(false); const t = e.target.closest('[data-assist-q]'); if (t) ask(t.dataset.assistQ); if (e.target.closest('[data-assist-go]') && innerWidth < 700) open(false); });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
  form.onsubmit = e => { e.preventDefault(); ask(form.elements.q.value); };
}
// 화면 설명(도움말) 문단을 본 화면은 기억해 두었다가 챗봇 자료로 씀(이 기기 안에서만)
function assistRemember(route, main) {
  const p = main.querySelector('details.help p, .report-heading p.muted'); if (!p) return;
  try { const k = 'wpa:helpcache', m = JSON.parse(localStorage.getItem(k) || '{}'); const t = p.textContent.replace(/\s+/g, ' ').trim().slice(0, 900); if (m[route] !== t) { m[route] = t; localStorage.setItem(k, JSON.stringify(m)); } } catch { /* 편의 */ }
}
