// 화면 모드 (15.32): 자동(기기 설정) · 라이트 · 다크. 선택은 이 기기 브라우저에 저장한다.
// <html data-theme="light|dark">가 있으면 기기 설정보다 우선한다(style.css의 다크 규칙이 이 속성도 따른다).
const THEME_KEY = 'wpa:theme', THEME_MODES = ['auto', 'light', 'dark'], THEME_LABEL = { auto: '자동', light: '라이트', dark: '다크' }, THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
function themeMode() { try { const v = localStorage.getItem(THEME_KEY); return THEME_MODES.includes(v) ? v : 'auto'; } catch { return 'auto'; } }
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
  for (const button of document.querySelectorAll('.theme-toggle')) { button.innerHTML = `<span aria-hidden="true">${THEME_ICON[mode]}</span> <span>${THEME_LABEL[mode]}</span>`; button.title = '화면 모드'; }
}
(function themeStart() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  applyTheme(themeMode());
  const place = () => {
    for (const found of document.querySelectorAll('.who, .auth-card, .side')) {
      const host = found.classList.contains('side') ? (found.querySelector(':scope > .side-prefs') || found.insertAdjacentElement('afterbegin', Object.assign(document.createElement('div'), { className: 'side-prefs' }))) : found;
      if (host.querySelector('.theme-toggle')) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn small theme-toggle'; button.setAttribute('aria-label', '화면 모드');
      button.onclick = () => { const next = THEME_MODES[(THEME_MODES.indexOf(themeMode()) + 1) % THEME_MODES.length]; try { localStorage.setItem(THEME_KEY, next); } catch { /* applies to this page only */ } applyTheme(next); };
      const lang = host.querySelector('.lang-select');
      if (host.classList.contains('who')) (lang ? lang.after(button) : host.prepend(button)); else if (host.classList.contains('side-prefs')) host.append(button); else host.append(button);
      applyTheme(themeMode());
    }
  };
  if (typeof MutationObserver !== 'undefined') new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
  if (typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', place);
})();
