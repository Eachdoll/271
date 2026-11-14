// 입력 폼 공통 UX (15.37). 검사규격 폼(15.35)의 방식을 모든 입력 폼에 자동 적용한다.
// - 필수 칸은 빨간 *, 선택 칸은 (선택)으로 표시 (필수 칸이 하나라도 있는 폼만)
// - 저장을 누르면 브라우저 말풍선 대신 각 칸 바로 아래에 「무엇을 어떻게」 고칠지 적고 첫 오류 칸으로 이동
// - 저장 버튼: 처리 중(스피너·aria-busy) → 완료(✓) / 실패(버튼 근처 안내). 서버 오류 문구에 칸 이름이 있으면 그 칸에 붙인다.
// 폼의 필드 이름, 제출 처리 함수, API 호출은 바꾸지 않는다. 각 폼의 submit 처리 앞에서 검사만 끼워 넣는다.
// 제외: 목록 검색 폼(.list-filters, data-read-only), 자체 검사가 있는 폼(.spec-form, data-own-errors).
const FX_SKIP = '.list-filters, [data-read-only], .spec-form, [data-own-errors], [data-no-form-ux]';
const fxControls = form => [...form.elements].filter(el => el.matches('input, select, textarea') && el.type !== 'hidden' && !el.disabled);
const fxActive = form => form && form.isConnected && !form.matches(FX_SKIP);

// 칸 이름: 감싼 label의 글자(별표·(선택)·오류 문장 제외) → aria-label → placeholder → 표 머리글
function fxFieldName(el) {
  // 라디오·체크 묶음은 fieldset 제목이 칸 이름이다.
  if ((el.type === 'radio' || el.type === 'checkbox') && el.closest('fieldset')) { const lg = el.closest('fieldset').querySelector('legend'); if (lg) return lg.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); }
  const label = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
  let text = '';
  if (label) for (const node of label.childNodes) {
    if (node.nodeType === 3) text += node.nodeValue;
    else if (node.nodeType === 1 && !node.matches('input, select, textarea, button, .req, .opt, .field-error, datalist, small, .muted')) text += node.textContent;
  }
  text = text.replace(/\*/g, '').replace(/\((선택|optional)\)/g, '').replace(/\s+/g, ' ').trim();
  if (!text) text = el.getAttribute('aria-label') || el.closest('td')?.dataset.label || el.placeholder || '';
  // 칸이 하나뿐인 폼(예: 초대코드 변경)은 폼 제목을 이름으로 쓴다.
  if (!text && el.form && fxControls(el.form).length === 1) text = el.form.querySelector('h2, h3, h4, legend')?.textContent || '';
  return text.replace(/\s*\(.*?\)\s*$/, '').trim().slice(0, 40);
}
function fxMessage(el) {
  const v = el.validity, name = fxFieldName(el), q = name ? `「${name}」 ` : '';
  if (v.valueMissing) {
    if (el.tagName === 'SELECT' || el.type === 'radio') return name ? `「${name}」에서 하나를 고르세요.` : '목록에서 하나를 고르세요.';
    if (el.type === 'checkbox') return name ? `「${name}」에 체크해야 저장할 수 있습니다.` : '체크해야 저장할 수 있습니다.';
    if (el.type === 'file') return name ? `「${name}」 파일을 첨부하세요.` : '파일을 첨부하세요.';
    if (el.type === 'date') return `${q}날짜를 고르세요.`;
    if (el.type === 'time') return `${q}시간을 입력하세요. 예: 08:30`;
    if (el.type === 'number') return `${q}숫자를 입력하세요. 예: 100`;
    return name ? `「${name}」 칸을 입력하세요.` : '이 칸을 입력하세요.';
  }
  if (v.badInput) return el.type === 'number' ? '숫자만 입력하세요. 쉼표나 글자는 빼고 입력합니다. 예: 1200' : '형식이 맞지 않습니다. 다시 입력하세요.';
  if (v.rangeUnderflow) return el.type === 'date' ? `${el.min} 이후 날짜를 고르세요.` : `${q}${el.min} 이상으로 입력하세요.`;
  if (v.rangeOverflow) return el.type === 'date' ? `${el.max} 이전 날짜를 고르세요.` : `${q}${el.max} 이하로 입력하세요.`;
  if (v.stepMismatch) return Number(el.step) === 1 ? '소수점 없이 정수로 입력하세요. 예: 3' : `${el.step} 단위로 입력하세요.`;
  if (v.tooLong) return `${el.maxLength}자 이하로 줄여주세요. (지금 ${el.value.length}자)`;
  if (v.tooShort) return `${el.minLength}자 이상 입력하세요. (지금 ${el.value.length}자)`;
  if (v.typeMismatch) return el.type === 'email' ? '이메일 형식으로 입력하세요. 예: name@example.com' : '형식이 맞지 않습니다. 예시를 참고해 다시 입력하세요.';
  if (v.patternMismatch) return el.title || '형식이 맞지 않습니다. 예시를 참고해 다시 입력하세요.';
  return el.validationMessage || '입력값을 확인하세요.';
}

let fxSeq = 0;
function fxClearField(el) {
  el.removeAttribute('aria-invalid');
  const id = el.dataset.fxError; if (!id) return;
  document.getElementById(id)?.remove(); delete el.dataset.fxError;
  const rest = (el.getAttribute('aria-describedby') || '').split(' ').filter(x => x && x !== id).join(' ');
  rest ? el.setAttribute('aria-describedby', rest) : el.removeAttribute('aria-describedby');
}
function fxSubmitButton(form, submitter) {
  return submitter && submitter.form === form ? submitter : form.querySelector('button:not([type=button]):not([type=reset]), input[type=submit]') || [...document.querySelectorAll('button[form]')].find(b => b.form === form);
}
// 폼 단위 안내 상자: 저장 버튼 바로 위(버튼 묶음이 있으면 그 위)에 둔다.
function fxFormBox(form, button) {
  let box = form.querySelector(':scope [data-fx-form-error]');
  if (!box) {
    box = document.createElement('div'); box.className = 'form-error'; box.dataset.fxFormError = ''; box.setAttribute('role', 'alert'); box.hidden = true;
    const anchor = button ? (button.closest('.actions, .actionbar, .form-actions') || button) : null;
    anchor && form.contains(anchor) ? anchor.insertAdjacentElement('beforebegin', box) : form.append(box);
  }
  return box;
}
function fxClearForm(form) {
  form.querySelectorAll('[data-fx-error]').forEach(fxClearField);
  const box = form.querySelector('[data-fx-form-error]'); if (box) { box.hidden = true; box.textContent = ''; }
}
function fxShowField(el, msg) {
  if (el.dataset.fxError) return; // 한 칸에는 첫 안내만
  const id = 'fxErr' + (++fxSeq), span = document.createElement('span');
  span.className = 'field-error'; span.id = id; span.textContent = msg;
  const group = (el.type === 'radio' || el.type === 'checkbox') && el.closest('fieldset');
  const label = el.closest('label');
  if (group) group.append(span); else if (label) label.append(span); else (el.closest('.check-group, .size-grid') || el).insertAdjacentElement('afterend', span);
  el.setAttribute('aria-invalid', 'true'); el.dataset.fxError = id;
  el.setAttribute('aria-describedby', [el.getAttribute('aria-describedby') || '', id].join(' ').trim());
}
function fxReveal(el) {
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'center' });
}
// 검사: 통과하면 true. 실패하면 칸마다 안내를 붙이고 첫 칸으로 이동한다.
function fxCheck(form, submitter) {
  fxClearForm(form);
  const bad = fxControls(form).filter(el => el.willValidate && !el.checkValidity());
  if (!bad.length) return true;
  const shown = [];
  for (const el of bad) {
    // 같은 이름의 체크 묶음은 한 번만 안내
    if (el.type === 'radio' || el.type === 'checkbox') { if (shown.some(s => s.name && s.name === el.name)) continue; }
    fxShowField(el, fxMessage(el)); shown.push(el);
  }
  const hidden = shown.filter(el => !el.offsetParent && !el.closest('details:not([open])'));
  const box = fxFormBox(form, fxSubmitButton(form, submitter)); box.hidden = false;
  box.textContent = `입력 확인이 필요한 칸이 ${shown.length}개 있습니다. 빨간색 안내를 보고 고쳐주세요.` + (hidden.length ? ` (가려진 칸: ${hidden.map(fxFieldName).filter(Boolean).join(', ')})` : '');
  const first = shown.find(el => el.offsetParent || el.closest('details')) || shown[0]; fxReveal(first);
  return false;
}

// ── 저장 상태 ──
let fxPending = null; // { form, button, at, timer }
let fxLastError = null;
function fxEndLoading(state) {
  const p = fxPending; if (!p) return; fxPending = null; clearTimeout(p.timer);
  const b = p.button; if (!b) return;
  b.classList.remove('is-loading'); b.removeAttribute('aria-busy'); p.form.removeAttribute('aria-busy');
  if (state === 'done' && b.isConnected) { b.classList.add('is-done'); setTimeout(() => b.classList.remove('is-done'), 1400); }
}
function fxStartLoading(form, submitter) {
  fxEndLoading();
  const button = fxSubmitButton(form, submitter);
  fxPending = { form, button, at: Date.now(), timer: setTimeout(() => fxEndLoading(), 12000) };
  fxLastError = null;
  if (button) { button.classList.add('is-loading'); button.setAttribute('aria-busy', 'true'); }
  form.setAttribute('aria-busy', 'true');
}
// 서버 오류 → 칸 이름이 문구에 있으면 그 칸 아래, 없으면 저장 버튼 위 상자에 해결 방법과 함께 표시
function fxServerError(form, button, message) {
  const err = fxLastError || {}, msg = String(message || err.message || '');
  let text;
  if (!err.status && /fetch|network|load failed|연결/i.test(msg)) text = '서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 저장하세요. 입력한 내용은 그대로 있습니다.';
  else if (err.status >= 500) text = `서버 오류로 저장하지 못했습니다(${err.status}). 잠시 후 다시 저장하고, 계속되면 관리자에게 알려주세요. 입력한 내용은 그대로 있습니다.`;
  else if (err.status === 409) text = msg + ' 입력한 내용은 그대로 있습니다.';
  else if (err.status === 401) text = msg;
  else {
    // 문구에 들어 있는 가장 긴 칸 이름을 찾는다(예: "거래처를 입력하세요" → 거래처 칸).
    const match = fxControls(form).map(el => [el, fxFieldName(el)]).filter(([, n]) => n && n.length >= 2 && msg.includes(n)).sort((a, b) => b[1].length - a[1].length)[0];
    if (match) { fxShowField(match[0], msg); fxReveal(match[0]); }
    text = msg;
  }
  const box = fxFormBox(form, button); box.hidden = false; box.textContent = text;
  if (!form.querySelector('[aria-invalid=true]')) box.scrollIntoView?.({ block: 'nearest' });
}

(function fxStart() {
  if (typeof document === 'undefined' || typeof HTMLFormElement === 'undefined' || typeof MutationObserver === 'undefined') return;
  // api 오류의 HTTP 상태를 기억해 둔다(오류 문구만으로는 500·연결 실패를 구분할 수 없음).
  const baseApi = api;
  api = async function (...args) { try { return await baseApi(...args); } catch (error) { fxLastError = { status: error.status || 0, message: error.message }; throw error; } };
  // 알림(토스트)으로 저장 결과를 안다: 성공 → ✓, 오류 → 버튼 근처 안내.
  const baseToast = toast;
  toast = function (msg, kind = 'ok') {
    const p = fxPending;
    if (p && p.form.isConnected && Date.now() - p.at < 15000) {
      if (kind === 'err') { const b = p.button; fxEndLoading('fail'); fxServerError(p.form, b, msg); }
      else fxEndLoading('done');
    } else if (p) fxEndLoading();
    return baseToast(msg, kind);
  };
  // 각 폼의 submit 처리보다 먼저(캡처 단계) 검사한다. 통과하면 원래 처리로 그대로 넘긴다.
  document.addEventListener('submit', event => {
    const form = event.target; if (!(form instanceof HTMLFormElement) || !fxActive(form)) return;
    if (!fxCheck(form, event.submitter)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    fxStartLoading(form, event.submitter);
  }, true);
  // 다른 곳을 누르거나(확인 창 취소 등) 다시 입력하면 처리 중 표시를 푼다.
  document.addEventListener('pointerdown', () => { if (fxPending && Date.now() - fxPending.at > 400) fxEndLoading(); }, true);
  // 고친 칸은 바로 안내를 지운다.
  const fix = event => {
    const el = event.target; if (!el?.dataset?.fxError) return;
    if (el.checkValidity()) fxClearField(el);
    const form = el.form; if (form && !form.querySelector('[data-fx-error]')) { const box = form.querySelector('[data-fx-form-error]'); if (box) box.hidden = true; }
  };
  document.addEventListener('input', fix, true); document.addEventListener('change', fix, true);
  // 코드에서 form.reportValidity()를 부르는 폼(세탁 보고서·오퍼레이터 등)도 같은 안내를 쓴다.
  const nativeReport = HTMLFormElement.prototype.reportValidity;
  HTMLFormElement.prototype.reportValidity = function () { return fxActive(this) ? fxCheck(this) : nativeReport.call(this); };

  // 필수/선택 표시와 novalidate: 화면이 바뀔 때마다 새 폼·새 칸에만 적용한다.
  const mark = () => {
    for (const form of document.querySelectorAll('form')) {
      if (!fxActive(form)) continue;
      if (!form.noValidate) form.noValidate = true;
      const controls = fxControls(form), anyRequired = controls.some(el => el.required);
      // 묶음 제목(legend) 끝의 * 도 빨간 표시로 바꾼다.
      for (const legend of form.querySelectorAll('legend')) {
        const t = [...legend.childNodes].find(n => n.nodeType === 3 && /\*\s*$/.test(n.nodeValue));
        if (t && !legend.querySelector(':scope > .req')) { t.nodeValue = t.nodeValue.replace(/\s*\*\s*$/, ' '); legend.insertAdjacentHTML('beforeend', '<span class="req" aria-hidden="true">*</span>'); }
      }
      for (const el of controls) {
        const label = el.closest('label'); if (!label || label.classList.contains('inline') || el.type === 'checkbox' || el.type === 'radio') continue;
        const req = label.querySelector(':scope > .req'), opt = label.querySelector(':scope > span.opt');
        if (el.required) {
          el.setAttribute('aria-required', 'true'); opt?.remove();
          if (!req) {
            // 글자 끝의 * 를 빨간 표시로 바꾸고, 없으면 붙인다.
            const textNode = [...label.childNodes].find(n => n.nodeType === 3 && /\*\s*$/.test(n.nodeValue));
            if (textNode) textNode.nodeValue = textNode.nodeValue.replace(/\s*\*\s*$/, ' ');
            const star = document.createElement('span'); star.className = 'req'; star.setAttribute('aria-hidden', 'true'); star.textContent = '*';
            el.insertAdjacentElement('beforebegin', star);
          }
        } else {
          req?.remove(); el.removeAttribute('aria-required');
          const textNode = [...label.childNodes].find(n => n.nodeType === 3 && /\*\s*$/.test(n.nodeValue)); if (textNode) textNode.nodeValue = textNode.nodeValue.replace(/\s*\*\s*$/, ' ');
          if (anyRequired && !opt && !el.readOnly && !/선택|optional/i.test(label.textContent.split('\n')[0])) {
            const o = document.createElement('span'); o.className = 'opt'; o.textContent = '(선택)';
            el.insertAdjacentElement('beforebegin', o);
          }
        }
      }
    }
  };
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; mark(); }); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['required'] });
})();
