// 화면 언어 전환 (15.31). 기본은 한국어이고, 다른 언어를 고르면 화면에 그려진 한국어 문구를 사전으로 바꿔 보여 준다.
// 화면 코드는 한국어 그대로 두며(키 = 한국어 원문), 사전에 없는 문구와 사용자가 입력한 데이터는 그대로 남는다.
// 서버로 보내는 값(select의 value 등)은 바꾸지 않는다. 성적서(.cert)와 data-no-i18n 영역은 번역하지 않는다.
const I18N_LANGS = { ko: '한국어', en: 'English', vi: 'Tiếng Việt', km: 'ភាសាខ្មែរ', zh: '中文' };
const I18N_KEY = 'wpa:lang';
function i18nLang() { try { const v = localStorage.getItem(I18N_KEY); return Object.hasOwn(I18N_LANGS, v) ? v : 'ko'; } catch { return 'ko'; } }
// Pure translator, also used by tests: dict maps Korean source → translation; keys may hold {0},{1}… placeholders.
function i18nTranslator(dict) {
  const hangul = /[가-힣]/, cache = new Map();
  const plain = [], templates = [];
  for (const key of Object.keys(dict)) {
    if (!/\{\d+\}/.test(key)) { if (key.length >= 4) plain.push(key); continue; }
    const literal = key.replace(/\{\d+\}/g, '');
    const source = key.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part) ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    templates.push({ key, re: new RegExp('^' + source + '$', 's'), order: [...key.matchAll(/\{(\d+)\}/g)].map(m => Number(m[1])), weight: literal.length, strict: (literal.match(/[가-힣]/g) || []).length < 2 });
  }
  plain.sort((a, b) => b.length - a.length); templates.sort((a, b) => b.weight - a.weight);
  const join = (a, b) => a && b && /[\p{L}\p{N})\]]$/u.test(a) && /^[\p{L}\p{N}(\[]/u.test(b) ? a + ' ' + b : a + b;
  function core(text, depth) {
    if (Object.hasOwn(dict, text)) return dict[text];
    if (depth > 2) return text;
    for (const t of templates) {
      const m = t.re.exec(text); if (!m) continue;
      const groups = m.slice(1); if (t.strict && !groups.every(g => /^[\d,.\s%+-]*$/.test(g))) continue;
      const values = {}; t.order.forEach((index, i) => { values[index] = hangul.test(groups[i]) ? core(groups[i].trim(), depth + 1) : groups[i]; });
      return dict[t.key].replace(/\{(\d+)\}/g, (_, n) => values[n] ?? '');
    }
    // "(안내문)" → translate the inside.
    const paren = /^\((.+)\)$/s.exec(text); if (paren && !/[()]/.test(paren[1])) { const inner = core(paren[1].trim(), depth + 1); if (inner !== paren[1].trim()) return '(' + inner + ')'; }
    // "A · B · C": each part on its own (names and codes between the dots stay as they are).
    if (text.includes(' · ')) { const parts = text.split(' · '), out = parts.map(part => hangul.test(part) ? core(part.trim(), depth + 1) : part); if (out.some((v, i) => v !== parts[i].trim() && v !== parts[i])) return out.join(' · '); }
    // "300 매", "4시간": number + unit word.
    const amount = /^([\d,.]+)\s?([^\d\s].*)$/.exec(text); if (amount && Object.hasOwn(dict, amount[2])) return amount[1] + ' ' + dict[amount[2]];
    // "수량 300": label word + number.
    const labelled = /^(.+?)\s([\d,.]+)$/.exec(text); if (labelled && Object.hasOwn(dict, labelled[1])) return dict[labelled[1]] + ' ' + labelled[2];
    // "2026-11-14 (토)": weekday letter after a date.
    const day = /^([\d\-.: ]+)\(([월화수목금토일])\)$/.exec(text); if (day && Object.hasOwn(dict, day[2])) return day[1] + '(' + dict[day[2]] + ')';
    // A known phrase at the end or start (the rest is usually a name or number that was inserted there).
    // A half-translated sentence is worse than the original, so the rest must translate too unless the phrase is most of the text.
    const accept = (key, restOut) => !hangul.test(restOut) || key.length >= text.length * 0.6;
    for (const key of plain) {
      if (text.length <= key.length) continue;
      if (text.endsWith(key)) { const rest = text.slice(0, -key.length), restOut = hangul.test(rest) ? core(rest.trim(), depth + 1) + (/\s$/.test(rest) ? ' ' : '') : rest; if (accept(key, restOut)) return join(restOut, dict[key]); }
      if (text.startsWith(key)) { const rest = text.slice(key.length), restOut = hangul.test(rest) ? (/^\s/.test(rest) ? ' ' : '') + core(rest.trim(), depth + 1) : rest; if (accept(key, restOut)) return join(dict[key], restOut); }
    }
    return text;
  }
  return function translate(text) {
    if (typeof text !== 'string' || !hangul.test(text)) return text;
    if (cache.has(text)) return cache.get(text);
    const lead = /^\s*/.exec(text)[0], tail = /\s*$/.exec(text)[0];
    let body = text.slice(lead.length, text.length - tail.length).replace(/\s+/g, ' '), mark = '';
    const star = /\s*\*$/.exec(body); if (star) { mark = star[0]; body = body.slice(0, -mark.length); }
    const out = lead + core(body, 0) + mark + tail;
    if (cache.size < 20000) cache.set(text, out);
    return out;
  };
}
(function i18nStart() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || !document.documentElement) return;
  const lang = i18nLang(); document.documentElement.lang = lang;
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-label']; // data-label: column names on phone cards
  const done = new WeakMap(); // text node → last translation we wrote
  let translate = null;
  const skip = el => !el || el.closest?.('script,style,textarea,.cert,[data-no-i18n],[contenteditable]');
  const textNode = node => {
    if (!translate || skip(node.parentElement)) return;
    const value = node.nodeValue; if (done.get(node) === value) return;
    const out = translate(value); if (out === value) return;
    const parent = node.parentElement;
    // An <option> without a value attribute submits its text: pin the Korean value before changing the label.
    if (parent.tagName === 'OPTION' && !parent.hasAttribute('value')) parent.setAttribute('value', parent.value);
    done.set(node, out); node.nodeValue = out;
  };
  const element = el => {
    if (!translate || skip(el)) return;
    for (const name of ATTRS) { const value = el.getAttribute?.(name); if (value) { const out = translate(value); if (out !== value) el.setAttribute(name, out); } }
  };
  const walk = root => {
    if (root.nodeType === 3) return textNode(root);
    if (root.nodeType !== 1 || skip(root)) return;
    element(root);
    const walker = document.createTreeWalker(root, 5); // elements + text
    for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeType === 3 ? textNode(node) : element(node);
  };
  const sidePrefs = side => side.querySelector(':scope > .side-prefs') || side.insertAdjacentElement('afterbegin', Object.assign(document.createElement('div'), { className: 'side-prefs' }));
  // Language picker: on the login card and in the header (also the operator header).
  const picker = () => {
    // On phones the header is narrow: the slide-out menu (.side) carries a second copy.
    for (const found of document.querySelectorAll('.who, .auth-card, .side')) {
      const host = found.classList.contains('side') ? sidePrefs(found) : found;
      if (host.querySelector('.lang-select')) continue;
      const select = document.createElement('select'); select.className = 'lang-select'; select.setAttribute('aria-label', 'Language / 언어'); select.setAttribute('data-no-i18n', '');
      select.innerHTML = Object.entries(I18N_LANGS).map(([code, name]) => `<option value="${code}" ${code === lang ? 'selected' : ''}>${name}</option>`).join('');
      select.onchange = () => { try { localStorage.setItem(I18N_KEY, select.value); } catch { /* private mode: applies to this page load only */ } location.reload(); };
      host.classList.contains('who') ? host.prepend(select) : host.classList.contains('side-prefs') ? host.prepend(select) : host.append(select);
    }
  };
  new MutationObserver(records => {
    picker();
    if (!translate) return;
    for (const record of records) {
      if (record.type === 'characterData') textNode(record.target);
      else if (record.type === 'attributes') element(record.target);
      else record.addedNodes.forEach(walk);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.addEventListener('DOMContentLoaded', picker);
  if (lang === 'ko') return;
  const script = document.createElement('script'); script.src = `/i18n-${lang}.js`;
  script.onload = () => { if (!window.I18N_DICT) return; translate = i18nTranslator(window.I18N_DICT); if (document.body) walk(document.body); };
  document.head.append(script);
})();
