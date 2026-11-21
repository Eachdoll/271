// 화면 모드 (15.32): 자동(기기 설정) · 라이트 · 다크. 선택은 이 기기 브라우저에 저장한다.
// <html data-theme="light|dark">가 있으면 기기 설정보다 우선한다(style.css의 다크 규칙이 이 속성도 따른다).
const THEME_KEY = 'wpa:theme', THEME_MODES = ['auto', 'light', 'dark'], THEME_LABEL = { auto: '자동', light: '라이트', dark: '다크' }, THEME_ICON = {
  auto: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/></svg>',
};
// 15.159 메뉴 위치: 좌측(기본) · 상단. <html data-nav="top">이면 넓은 화면에서 부서 메뉴가 머리줄 아래 가로 줄로(부서를 누르거나 올리면 펼침).
const NAV_KEY = 'wpa:nav-layout', NAV_LABEL = { side: '좌측 메뉴', top: '상단 메뉴' }, NAV_ICON = {
  side: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
  top: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>',
};
function navLayout() { try { return localStorage.getItem(NAV_KEY) === 'side' ? 'side' : 'top'; } catch { return 'top'; } } // 15.162 기본은 상단 메뉴
function applyNavLayout(mode) {
  const root = document.documentElement;
  if (mode === 'top') root.setAttribute('data-nav', 'top'); else root.removeAttribute('data-nav');
  for (const b of document.querySelectorAll('.nav-layout-toggle')) { b.innerHTML = `<span class="theme-icon" aria-hidden="true">${NAV_ICON[mode]}</span> <span>${NAV_LABEL[mode]}</span>`; b.title = '메뉴 위치 바꾸기(좌측 ↔ 상단)'; b.setAttribute('aria-pressed', String(mode === 'top')); }
  document.querySelectorAll('.nav-group.drop').forEach(g => g.classList.remove('drop'));
}
// 15.180 화면 밀도: 촘촘(기본) · 보통. <html data-density="compact">이면 입력칸·단추·표 줄을 줄여 한 화면에 더 많이.
const DENSITY_KEY = 'wpa:density', DENSITY_LABEL = { compact: '촘촘', normal: '보통' };
function densityMode() { try { return localStorage.getItem(DENSITY_KEY) === 'normal' ? 'normal' : 'compact'; } catch { return 'compact'; } }
// 15.326 글꼴: 기본(시스템) · Pretendard · Helvetica. 이 기기에 기억(<html data-font>). Pretendard는 고를 때만 웹 글꼴(jsDelivr)을 불러오고,
// 못 불러오면 시스템 한글 글꼴로 보인다. Helvetica는 영문·숫자에 쓰이고 한글은 Pretendard/애플 SD 고딕/맑은 고딕(Windows는 Helvetica 대신 Arial).
const FONT_KEY = 'wpa:font', FONTS = [['system', '기본(시스템)'], ['pretendard', 'Pretendard'], ['helvetica', 'Helvetica']];
const PRETENDARD_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';
function fontMode() { try { const v = localStorage.getItem(FONT_KEY); return FONTS.some(([k]) => k === v) ? v : 'system'; } catch { return 'system'; } }
function applyFont(mode) {
  document.documentElement.setAttribute('data-font', mode);
  if ((mode === 'pretendard' || mode === 'helvetica') && !document.getElementById('pretendardCss')) { const l = document.createElement('link'); l.id = 'pretendardCss'; l.rel = 'stylesheet'; l.href = PRETENDARD_CSS; l.crossOrigin = 'anonymous'; document.head.append(l); }
  for (const s of document.querySelectorAll('.font-select')) s.value = mode;
}
// 15.328 PC 화면 모드: 휴대폰에서도 PC 화면(폭 1280px)으로 보기. 브라우저의 「데스크톱 사이트」처럼 화면 폭을 바꾸고, 두 손가락으로 확대해 봅니다. 이 기기에 기억.
const PCMODE_KEY = 'wpa:pcmode', PC_VIEWPORT = 'width=1280, viewport-fit=cover', MOBILE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
function pcMode() { try { return localStorage.getItem(PCMODE_KEY) === '1'; } catch { return false; } }
function smallDevice() { try { return Math.min(screen.width, screen.height) < 820 || !!window.matchMedia?.('(pointer: coarse)').matches; } catch { return false; } }
function applyPcMode(on) {
  const root = document.documentElement; let vp = document.querySelector('meta[name=viewport]');
  if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.append(vp); }
  const want = on ? PC_VIEWPORT : MOBILE_VIEWPORT; if (vp.getAttribute('content') !== want) vp.setAttribute('content', want);
  root.toggleAttribute('data-pcmode', !!on);
  const show = on || smallDevice();
  for (const b of document.querySelectorAll('.pcmode-toggle')) { b.hidden = !show; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.innerHTML = on ? '<span aria-hidden="true">📱</span> 모바일 화면' : '<span aria-hidden="true">🖥</span> PC 화면'; b.title = on ? '휴대폰 화면으로 돌아가기' : '휴대폰에서도 PC 화면으로 보기(두 손가락으로 확대)'; }
  let chip = document.getElementById('pcmodeChip');
  if (on && smallDevice()) {
    if (!chip && document.body) { chip = document.createElement('button'); chip.type = 'button'; chip.id = 'pcmodeChip'; chip.className = 'pcmode-chip'; chip.innerHTML = '<span aria-hidden="true">📱</span> 모바일 화면'; chip.title = '휴대폰 화면으로 돌아가기'; chip.onclick = () => setPcMode(false); document.body.append(chip); }
  } else chip?.remove();
}
function setPcMode(on) {
  try { if (on) localStorage.setItem(PCMODE_KEY, '1'); else localStorage.removeItem(PCMODE_KEY); } catch { /* 이 화면에만 */ }
  applyPcMode(on);
  if (typeof toast === 'function') toast(on ? 'PC 화면으로 봅니다. 두 손가락으로 확대하세요. 왼쪽 아래 「📱 모바일 화면」으로 돌아갑니다.' : '휴대폰 화면으로 돌아왔습니다.');
}
function applyDensity(mode) {
  document.documentElement.setAttribute('data-density', mode);
  for (const b of document.querySelectorAll('.density-toggle')) { b.innerHTML = `<span class="theme-icon" aria-hidden="true">${mode === 'compact' ? '☰' : '≡'}</span> <span>${DENSITY_LABEL[mode]}</span>`; b.title = '화면 밀도(촘촘 ↔ 보통)'; b.setAttribute('aria-label', `화면 밀도: ${DENSITY_LABEL[mode]}`); }
}
// 15.220 디자인 스킨(사용자별): 기본 · 크리스마스. <html data-skin="christmas">. 계정 설정(ME.ui.skin)에 저장, 이 기기에도 기억(첫 화면 깜빡임 없이).
const SKIN_KEY = 'wpa:skin', SKINS = [['default', '기본'], ['christmas', '🎄 크리스마스'], ['ribbon', '🎀 핑크 리본'], ['penguin', '🐧 방귀니'], ['kha', '🍶 KHA'], ['pjh', '🍫 PJH'], ['cat', '💗 커스텀 캐릭터']]; // 15.228 KHA(소주 컨셉), 15.231 PJH(초코파티 컨셉) // 15.222 핑크 리본, 15.226 방귀니(회사 캐릭터)·커스텀 캐릭터(기본 하트, 그림 올리면 교체)
// 15.225 커스텀 캐릭터 스킨(키 cat)의 캐릭터 그림을 사용자가 직접 올린 파일로 바꾸기. 이 기기 브라우저에만 저장(서버·저장소에 올리지 않음).
const FACE_KEY = 'wpa:skin-face';
function skinFace() { try { const v = localStorage.getItem(FACE_KEY) || ''; return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : ''; } catch { return ''; } }
// 15.232 커스텀 캐릭터 스킨 색: 고른 색 하나로 머리줄·단추·강조색을 만든다(이 기기에만). 다크 모드용 옅은 색은 건드리지 않는다.
const COLOR_KEY = 'wpa:skin-color', SKIN_SWATCHES = ['#e60033', '#ff6f91', '#f08c00', '#2f9e44', '#1c7ed6', '#7048e8', '#495057', '#8b5a3c'];
function skinColor() { try { const v = localStorage.getItem(COLOR_KEY) || ''; return /^#[0-9a-f]{6}$/i.test(v) ? v : ''; } catch { return ''; } }
function shade(hex, f) { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)); return '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join(''); }
// 15.261 바탕까지 고른 색으로: 밝은 화면에서 바닥·메뉴줄·탭줄·조회 상자·회색 칩/단추를 그 색의 옅은 색으로, 기본 하트도 그 색. 어두운 화면은 그대로.
const isDarkNow = () => { const t = document.documentElement.dataset.theme; return t === 'dark' || (t !== 'light' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches); };
const heartSvg = (fill, w, h, d, shine) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><path d='${d}' fill='${fill}'/>${shine}</svg>`)}")`;
// 15.262 커스텀 캐릭터 스킨 머리줄 무늬(이 기기에만): <html data-top="…">
const TOP_KEY = 'wpa:skin-top', TOP_PATTERNS = [['dots', '● 땡땡이'], ['stripe', '▨ 사선 줄무늬'], ['check', '▦ 체크'], ['heart', '♥ 하트'], ['star', '★ 별'], ['wave', '〰 물결'], ['zigzag', '⩘ 지그재그'], ['grad', '◐ 그라데이션만'], ['solid', '■ 단색']];
function topPattern() { try { const v = localStorage.getItem(TOP_KEY); return TOP_PATTERNS.some(([k]) => k === v) ? v : 'dots'; } catch { return 'dots'; } }
function applyTopPattern() { const v = topPattern(), root = document.documentElement; if (v === 'dots') root.removeAttribute('data-top'); else root.setAttribute('data-top', v); for (const s of document.querySelectorAll('.skin-top')) s.value = v; }
function applySkinColor() {
  const root = document.documentElement, c = skinColor(), on = c && root.dataset.skin === 'cat', light = on && !isDarkNow();
  const tintVars = { '--bg': shade(c, 0.9), '--ns-panel': shade(c, 0.95), '--ct-bar': shade(c, 0.93) };
  for (const [k, v] of Object.entries(tintVars)) { if (light) root.style.setProperty(k, v); else root.style.removeProperty(k); }
  const heart = on ? shade(c, 0.2) : '';
  if (on) root.style.setProperty('--ct-bow', heartSvg(heart, 24, 22, 'M12 21 S1 14 1 7 C1 3 4 1 7 1 c2.4 0 4 1.4 5 3 c1-1.6 2.6-3 5-3 c3 0 6 2 6 6 c0 7-11 14-11 14z', '')); else root.style.removeProperty('--ct-bow');
  if (!skinFace()) { if (on) root.style.setProperty('--ct-face', heartSvg(heart, 32, 30, 'M16 28 S2 19.5 2 10 C2 5 5.6 2 9.6 2 c2.9 0 5 1.6 6.4 3.8 C17.4 3.6 19.5 2 22.4 2 C26.4 2 30 5 30 10 c0 9.5-14 18-14 18z', "<path d='M8 8 q2-3 5-2' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' opacity='.7'/>")); else root.style.removeProperty('--ct-face'); }
  const vars = { '--ct-main': c, '--ct-top': shade(c, 0.12), '--ct-top1': shade(c, 0.25), '--ct-top2': shade(c, -0.08), '--ns-navy': shade(c, 0.12), '--ns-navy-2': shade(c, 0.25), '--ns-pill': c, '--accent': c, '--btn-primary': c, '--btn-primary-hover': shade(c, -0.18),
    // 15.246 바탕·표 머리·줄 강조도 고른 색의 옅은 색으로(다크 모드는 style.css의 어두운 값이 이김)
    '--ct-bg': shade(c, 0.86), '--ct-soft': shade(c, 0.86), '--ct-head': shade(c, 0.89), '--ct-ink': shade(c, -0.18), '--ct-line': shade(c, 0.72), '--ct-hover': shade(c, 0.93), '--ct-zebra': shade(c, 0.97) };
  for (const [k, v] of Object.entries(vars)) { if (on) root.style.setProperty(k, v); else root.style.removeProperty(k); }
  for (const b of document.querySelectorAll('.skin-face .sw')) b.classList.toggle('on', b.dataset.sw === c);
  for (const i of document.querySelectorAll('.skin-face input[type=color]')) i.value = c || '#e60033';
}
function applyFace() {
  const v = skinFace(), root = document.documentElement;
  if (v) root.style.setProperty('--ct-face', `url("${v}")`); else { root.style.removeProperty('--ct-face'); applySkinColor(); } // 15.261 그림을 지우면 고른 색 하트
  for (const b of document.querySelectorAll('[data-face-reset]')) b.hidden = !v;
}
function setFaceFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('PNG·JPG·WEBP·GIF 그림을 고르세요.'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('그림은 10MB 이하로 고르세요.')); // 15.246 5MB → 10MB(저장은 작게 줄여서)
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 256 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const data = c.toDataURL('image/png');
      try { localStorage.setItem(FACE_KEY, data); } catch { return reject(new Error('이 기기에 저장하지 못했습니다(저장 공간).')); }
      applyFace(); resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('그림을 읽지 못했습니다.')); };
    img.src = url;
  });
}
function skinMode() { try { const v = localStorage.getItem(SKIN_KEY); return SKINS.some(([k]) => k === v) ? v : 'default'; } catch { return 'default'; } }
function applySkin(skin, { save = false } = {}) {
  const v = SKINS.some(([k]) => k === skin) ? skin : 'default';
  if (v === 'default') document.documentElement.removeAttribute('data-skin'); else document.documentElement.setAttribute('data-skin', v);
  try { localStorage.setItem(SKIN_KEY, v); } catch { /* 이 화면에만 */ }
  for (const s of document.querySelectorAll('.skin-select')) s.value = v;
  for (const f of document.querySelectorAll('.skin-face')) f.hidden = v !== 'cat'; // 15.225
  applySkinColor(); // 15.232
  if (save && typeof api === 'function' && typeof ME !== 'undefined' && ME) api('PUT', '/api/me/prefs', { skin: v }).then(p => { if (ME) ME.ui = p; }).catch(() => {});
}
function themeMode() { try { const v = localStorage.getItem(THEME_KEY); return THEME_MODES.includes(v) ? v : 'auto'; } catch { return 'auto'; } }
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
  if (typeof applySkinColor === 'function' && typeof COLOR_KEY !== 'undefined') applySkinColor(); // 15.261 밝은/어두운 화면이 바뀌면 바탕 색도
  for (const button of document.querySelectorAll('.theme-toggle:not(.nav-layout-toggle):not(.density-toggle)')) { button.innerHTML = `<span class="theme-icon" aria-hidden="true">${THEME_ICON[mode]}</span> <span>${THEME_LABEL[mode]}</span>`; button.title = '화면 모드'; }
}
(function themeStart() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  applyTheme(themeMode()); applyNavLayout(navLayout()); applyDensity(densityMode()); applyFont(fontMode()); applyPcMode(pcMode()); applySkin(skinMode()); applyFace(); applyTopPattern();
  try { window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => applySkinColor()); } catch { /* 오래된 브라우저 */ }
  const place = () => {
    for (const found of document.querySelectorAll('.who, .auth-card, .side')) {
      const host = found.classList.contains('side') ? (found.querySelector(':scope > .side-prefs') || found.insertAdjacentElement('afterbegin', Object.assign(document.createElement('div'), { className: 'side-prefs' }))) : found;
      if (host.querySelector('.theme-toggle')) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn small theme-toggle'; button.setAttribute('aria-label', '화면 모드');
      button.onclick = () => { const next = THEME_MODES[(THEME_MODES.indexOf(themeMode()) + 1) % THEME_MODES.length]; try { localStorage.setItem(THEME_KEY, next); } catch { /* applies to this page only */ } applyTheme(next); };
      const lang = host.querySelector('.lang-select');
      if (host.classList.contains('who')) (lang ? lang.after(button) : host.prepend(button)); else if (host.classList.contains('side-prefs')) host.append(button); else host.append(button);
      applyTheme(themeMode());
      if (!host.querySelector('.pcmode-toggle')) { const pc = document.createElement('button'); pc.type = 'button'; pc.className = 'btn small pcmode-toggle'; pc.setAttribute('aria-label', 'PC 화면 모드'); pc.onclick = () => setPcMode(!pcMode()); button.after(pc); applyPcMode(pcMode()); } /* 15.328 */
      // 메뉴 위치 버튼: 로그인 뒤 머리줄에만(메뉴가 있는 화면)
      if (host.classList.contains('who') && document.querySelector('.side') && !host.querySelector('.nav-layout-toggle')) {
        const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'btn small theme-toggle nav-layout-toggle'; nb.setAttribute('aria-label', '메뉴 위치');
        nb.onclick = () => { const next = navLayout() === 'top' ? 'side' : 'top'; try { localStorage.setItem(NAV_KEY, next); } catch { /* 이 화면에만 */ } applyNavLayout(next); };
        (host.querySelector('.pcmode-toggle') || button).after(nb); applyNavLayout(navLayout());
        const db = document.createElement('button'); db.type = 'button'; db.className = 'btn small theme-toggle density-toggle';
        db.onclick = () => { const next = densityMode() === 'compact' ? 'normal' : 'compact'; try { localStorage.setItem(DENSITY_KEY, next); } catch { /* 이 화면에만 */ } applyDensity(next); };
        nb.after(db); applyDensity(densityMode());
      }
      // 디자인 스킨 고르기(머리줄 「화면 설정」 상자·휴대폰 메뉴 위)
      if ((host.classList.contains('who') && document.querySelector('.side')) || host.classList.contains('side-prefs')) {
        if (!host.querySelector('.skin-select')) {
          const sk = document.createElement('select'); sk.className = 'skin-select'; sk.setAttribute('aria-label', '디자인 스킨'); sk.title = '디자인 스킨(사용자별)';
          sk.innerHTML = SKINS.map(([k, l]) => `<option value="${k}">스킨: ${l}</option>`).join('');
          sk.value = skinMode(); sk.onchange = () => applySkin(sk.value, { save: true });
          host.append(sk);
          if (!host.querySelector('.font-select')) { const fontSel = document.createElement('select'); fontSel.className = 'font-select'; fontSel.setAttribute('aria-label', '글꼴'); fontSel.title = '글꼴(이 기기에 기억)';
            fontSel.innerHTML = FONTS.map(([k, l]) => `<option value="${k}">글꼴: ${l}</option>`).join(''); fontSel.value = fontMode();
            fontSel.onchange = () => { try { localStorage.setItem(FONT_KEY, fontSel.value); } catch { /* 이 화면에만 */ } applyFont(fontSel.value); if (typeof toast === 'function') toast(`글꼴을 ${FONTS.find(([k]) => k === fontSel.value)[1]}(으)로 바꿨습니다(이 기기).`); };
            host.append(fontSel); } // 15.326
          // 15.225 캐릭터 그림 바꾸기(리본 고양이 스킨일 때만 보임)
          const fw = document.createElement('div'); fw.className = 'skin-face'; fw.hidden = skinMode() !== 'cat';
          fw.innerHTML = '<label class="btn small" title="이 기기에서만 바뀝니다">캐릭터 그림 바꾸기<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-face-file></label><button type="button" class="btn small" data-face-reset>기본 그림</button>';
          fw.querySelector('[data-face-file]').onchange = e => { const f = e.target.files[0]; e.target.value = ''; setFaceFile(f).then(() => typeof toast === 'function' && toast('캐릭터 그림을 바꿨습니다(이 기기).')).catch(err => typeof toast === 'function' ? toast(err.message, 'err') : alert(err.message)); };
          fw.querySelector('[data-face-reset]').onclick = () => { try { localStorage.removeItem(FACE_KEY); } catch { /* 없음 */ } applyFace(); };
          // 15.232 색 팔레트
          const cw = document.createElement('div'); cw.className = 'skin-colors';
          cw.innerHTML = `<span>색</span>${SKIN_SWATCHES.map(c => `<button type="button" class="sw" data-sw="${c}" style="background:${c}" aria-label="색 ${c}" title="${c}"></button>`).join('')}<input type="color" value="${skinColor() || '#e60033'}" aria-label="색 직접 고르기" title="직접 고르기"><button type="button" class="btn small" data-sw-reset>기본색</button>`;
          const setC = c => { try { if (c) localStorage.setItem(COLOR_KEY, c); else localStorage.removeItem(COLOR_KEY); } catch { /* 이 화면에만 */ } applySkinColor(); };
          cw.addEventListener('click', e => { const b = e.target.closest('[data-sw]'); if (b) setC(b.dataset.sw); if (e.target.closest('[data-sw-reset]')) setC(''); });
          cw.querySelector('input[type=color]').addEventListener('input', e => setC(e.target.value.toLowerCase()));
          fw.append(cw);
          // 15.262 머리줄 무늬 고르기
          const tw = document.createElement('label'); tw.className = 'skin-top-wrap'; tw.innerHTML = `<span>머리줄 무늬</span><select class="skin-top" aria-label="머리줄 무늬">${TOP_PATTERNS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`;
          tw.querySelector('select').onchange = e => { try { localStorage.setItem(TOP_KEY, e.target.value); } catch { /* 이 화면에만 */ } applyTopPattern(); };
          fw.append(tw);
          host.append(fw); applyFace(); applyTopPattern();
        }
      }
    }
  };
  if (typeof MutationObserver !== 'undefined') new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
  if (typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', place);
})();
