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
function navLayout() { try { return localStorage.getItem(NAV_KEY) === 'top' ? 'top' : 'side'; } catch { return 'side'; } }
function applyNavLayout(mode) {
  const root = document.documentElement;
  if (mode === 'top') root.setAttribute('data-nav', 'top'); else root.removeAttribute('data-nav');
  for (const b of document.querySelectorAll('.nav-layout-toggle')) { b.innerHTML = `<span class="theme-icon" aria-hidden="true">${NAV_ICON[mode]}</span> <span>${NAV_LABEL[mode]}</span>`; b.title = '메뉴 위치 바꾸기(좌측 ↔ 상단)'; b.setAttribute('aria-pressed', String(mode === 'top')); }
  document.querySelectorAll('.nav-group.drop').forEach(g => g.classList.remove('drop'));
}
function themeMode() { try { const v = localStorage.getItem(THEME_KEY); return THEME_MODES.includes(v) ? v : 'auto'; } catch { return 'auto'; } }
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
  for (const button of document.querySelectorAll('.theme-toggle:not(.nav-layout-toggle)')) { button.innerHTML = `<span class="theme-icon" aria-hidden="true">${THEME_ICON[mode]}</span> <span>${THEME_LABEL[mode]}</span>`; button.title = '화면 모드'; }
}
(function themeStart() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  applyTheme(themeMode()); applyNavLayout(navLayout());
  const place = () => {
    for (const found of document.querySelectorAll('.who, .auth-card, .side')) {
      const host = found.classList.contains('side') ? (found.querySelector(':scope > .side-prefs') || found.insertAdjacentElement('afterbegin', Object.assign(document.createElement('div'), { className: 'side-prefs' }))) : found;
      if (host.querySelector('.theme-toggle')) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn small theme-toggle'; button.setAttribute('aria-label', '화면 모드');
      button.onclick = () => { const next = THEME_MODES[(THEME_MODES.indexOf(themeMode()) + 1) % THEME_MODES.length]; try { localStorage.setItem(THEME_KEY, next); } catch { /* applies to this page only */ } applyTheme(next); };
      const lang = host.querySelector('.lang-select');
      if (host.classList.contains('who')) (lang ? lang.after(button) : host.prepend(button)); else if (host.classList.contains('side-prefs')) host.append(button); else host.append(button);
      applyTheme(themeMode());
      // 메뉴 위치 버튼: 로그인 뒤 머리줄에만(메뉴가 있는 화면)
      if (host.classList.contains('who') && document.querySelector('.side') && !host.querySelector('.nav-layout-toggle')) {
        const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'btn small theme-toggle nav-layout-toggle'; nb.setAttribute('aria-label', '메뉴 위치');
        nb.onclick = () => { const next = navLayout() === 'top' ? 'side' : 'top'; try { localStorage.setItem(NAV_KEY, next); } catch { /* 이 화면에만 */ } applyNavLayout(next); };
        button.after(nb); applyNavLayout(navLayout());
      }
    }
  };
  if (typeof MutationObserver !== 'undefined') new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
  if (typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', place);
})();
