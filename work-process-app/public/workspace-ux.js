// Per-user, per-tab working state. Never persist credentials or image payloads.
const UX_PREFIX = 'wpa:workspace:v1:';
const UX_TTL = 7 * 24 * 60 * 60 * 1000;
const uxDrafts = new Set();
let uxRoute = '', uxRestoring = false, uxTargetY = 0;
function uxKey(kind, id) { return UX_PREFIX + ME.id + ':' + kind + ':' + id; }
function uxRead(key) {
  try { const entry = JSON.parse(sessionStorage.getItem(key)); if (!entry || !Number.isFinite(entry.at) || Date.now() - entry.at > UX_TTL) { sessionStorage.removeItem(key); return null; } return entry.value; } catch { return null; }
}
function uxWrite(key, value) {
  try { const text = JSON.stringify({ at: Date.now(), value }); if (text.length > 200000) return false; sessionStorage.setItem(key, text); return true; } catch { return false; }
}
function uxRemove(key) { try { sessionStorage.removeItem(key); } catch {} }
function uxClearUser() {
  if (!ME) return;
  const prefix = UX_PREFIX + ME.id + ':';
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key); } catch {}
  uxDrafts.clear(); uxRoute = '';
}
function uxControlKey(input) { return input.dataset.lr || input.name || input.id; }
function uxControls(form) {
  return [...form.querySelectorAll('input,select,textarea')].filter(input => uxControlKey(input) && !['password', 'file', 'hidden', 'submit', 'button'].includes(input.type) && !/password|invite|signature|token/i.test(uxControlKey(input)));
}
function uxFormRead(form) { return uxControls(form).map(input => [uxControlKey(input), input.type === 'checkbox' || input.type === 'radio' ? input.checked : input.value]); }
function uxFormRestore(form, values) {
  const map = new Map(Array.isArray(values) ? values : []);
  for (const input of uxControls(form)) if (map.has(uxControlKey(input))) {
    const value = map.get(uxControlKey(input));
    if (input.type === 'checkbox' || input.type === 'radio') input.checked = value === true;
    else input.value = typeof value === 'string' ? value : '';
  }
}
function bindEntryDraft(form, id, options = {}) {
  const key = uxKey('draft', id), read = options.read || (() => uxFormRead(form));
  const restore = options.restore || (value => uxFormRestore(form, value));
  const box = document.createElement('div'); box.className = 'draft-state';
  box.innerHTML = '<span role="status" data-draft-status></span><button type="button" class="btn small" data-draft-restore>초안 복구</button><button type="button" class="btn small" data-draft-discard>초안 버리기</button>';
  form.prepend(box);
  const label = box.querySelector('[data-draft-status]'), recover = box.querySelector('[data-draft-restore]'), discard = box.querySelector('[data-draft-discard]');
  let pending = uxRead(key), dirty = false, paused = false, writing = false;
  const hint = ' · 이 탭에서만 보관됩니다. 사진은 다시 첨부하세요.';
  label.textContent = pending ? '보관된 입력 초안이 있습니다.' + hint : '입력 내용은 이 탭에 자동 보관됩니다. 사진은 제외됩니다.';
  recover.hidden = !pending; discard.hidden = !pending;
  const save = () => {
    if (!form.isConnected || !dirty || paused || writing) return;
    const ok = uxWrite(key, read());
    label.textContent = ok ? '초안 보관됨' + hint : '초안을 보관하지 못했습니다. 이 화면을 닫기 전에 저장하세요.';
    discard.hidden = false;
    return ok;
  };
  const changed = event => { if (event?.target?.closest?.('.draft-state') || paused || writing) return; dirty = true; pending = null; recover.hidden = true; save(); };
  form.addEventListener('input', changed); form.addEventListener('change', changed);
  // Row add/remove and picker buttons change values without an input event.
  form.addEventListener('click', event => { if (event.target.closest('button') && !event.target.closest('.draft-state')) queueMicrotask(() => changed(event)); });
  recover.onclick = () => {
    if (!pending) return;
    try { restore(pending); options.afterRestore?.(); dirty = true; pending = null; recover.hidden = true; save(); }
    catch { label.textContent = '초안을 복구하지 못했습니다. 입력 내용을 확인하세요.'; }
  };
  discard.onclick = async () => {
    if (!await confirmBox('보관된 초안을 지울까요? 현재 화면에 입력한 값은 유지됩니다.')) return;
    uxRemove(key); dirty = false; pending = null; recover.hidden = discard.hidden = true; label.textContent = '보관된 초안을 지웠습니다. 다시 입력하면 자동 보관됩니다.';
  };
  const controller = {
    form, save,
    start() { save(); writing = true; label.textContent = '저장 중…'; },
    failure() { writing = false; dirty = true; paused = false; const ok = save(); label.textContent = ok ? '저장 실패 · 입력 내용을 보관했습니다. 내용을 확인한 뒤 다시 저장하세요.' : '저장 실패 · 초안도 보관하지 못했습니다. 화면을 유지하고 다시 저장하세요.'; },
    clear(message = '저장 완료') { uxRemove(key); dirty = false; paused = true; writing = false; pending = null; recover.hidden = discard.hidden = true; label.textContent = message; },
    resume() { paused = false; },
    isDirty() { return dirty || writing; },
  };
  uxDrafts.add(controller); return controller;
}
function rememberList(form) {
  if (!form || !ME || form.dataset.viewRemembered) return;
  form.dataset.viewRemembered = 'true'; form.dataset.readOnly = 'true';
  const key = uxKey('filters', (location.hash || '#/') + ':' + form.id);
  const saved = uxRead(key); if (saved) uxFormRestore(form, saved);
  const save = () => uxWrite(key, uxFormRead(form));
  form.addEventListener('input', save); form.addEventListener('change', save);
  form.addEventListener('submit', save);
  form.addEventListener('click', () => queueMicrotask(save));
  return { save };
}
function uxBeforeRender() {
  for (const draft of uxDrafts) { if (draft.form.isConnected) draft.save(); else uxDrafts.delete(draft); }
  if (ME && uxRoute && !uxRestoring) uxWrite(uxKey('scroll', uxRoute), window.scrollY);
  uxRoute = location.hash || '#/';
  uxTargetY = ME ? uxRead(uxKey('scroll', uxRoute)) || 0 : 0;
  uxRestoring = true;
}
function uxAfterRender(route) {
  if (!ME || route !== (location.hash || '#/')) return;
  const y = uxTargetY;
  uxRestoring = true;
  requestAnimationFrame(() => { if (route !== (location.hash || '#/')) return; window.scrollTo(0, y); requestAnimationFrame(() => { uxRestoring = false; }); });
}
window.addEventListener('scroll', () => { if (ME && uxRoute && !uxRestoring) uxWrite(uxKey('scroll', uxRoute), window.scrollY); }, { passive: true });
window.addEventListener('beforeunload', event => {
  for (const draft of uxDrafts) if (draft.form.isConnected) draft.save();
  if ([...uxDrafts].some(d => d.form.isConnected && d.isDirty())) { event.preventDefault(); event.returnValue = ''; }
});

function approvalComparison(kind, c) {
  let rows = [], impact = '';
  if (kind === 'receipt') {
    rows = [['입고 상태', RECV[c.old_status] || c.old_status, c.action === 'revert' ? '미입고' : RECV[c.old_status] || c.old_status], ['실입고 수량', c.old_recv_qty, c.action === 'revert' ? 0 : c.new_recv_qty]];
    const delta = (c.action === 'revert' ? 0 : Number(c.new_recv_qty)) - Number(c.old_recv_qty);
    impact = `입고 재고 ${delta >= 0 ? '+' : ''}${fmtNum(delta)} ${c.unit || ''}. 기존 수입검사 스냅샷은 유지됩니다.`;
  } else if (kind === 'actual') {
    rows = [['생산일', c.old_date, c.action === 'void' ? '취소' : c.new_date], ['생산량', c.old_qty, c.action === 'void' ? 0 : c.new_qty], ['메모', c.old_note, c.action === 'void' ? '취소' : c.new_note]];
    impact = '승인하면 생산 실적 합계가 바뀝니다. 완제품 재고와 BOM 자재 투입량도 함께 다시 계산됩니다.';
  } else {
    const old = c.old_data, next = c.action === 'delete' ? {} : c.new_data;
    rows = Object.entries(SEMI_FIELD_LABEL).filter(([key]) => c.action === 'delete' || (old[key] ?? '') !== (next[key] ?? '')).map(([key, label]) => [label, old[key], c.action === 'delete' ? '삭제' : next[key]]);
    impact = c.process === 'wash' ? '세탁 처리량과 세탁 대기량이 다시 계산됩니다. 세탁 기록은 생산 재고를 추가하지 않습니다.' : '커팅/융착 양품 재고와 BOM 자재 투입량, 연결된 반제품 계획 실적이 다시 계산됩니다.';
  }
  return `<p><b>${esc(c.item || c.product || c.old_data?.item_name || '기록 변경')}</b></p><p>요청자: ${esc(c.requested_by)} · ${esc(c.requested_at)}<br>사유: ${esc(c.reason)}</p><div class="table-wrap"><table class="grid keep-table approval-compare"><thead><tr><th>항목</th><th>변경 전</th><th>승인 후</th></tr></thead><tbody>${rows.map(([label, old, next]) => `<tr><th>${esc(label)}</th><td>${esc(old ?? '없음')}</td><td>${esc(next ?? '없음')}</td></tr>`).join('')}</tbody></table></div><p class="approval-impact">${esc(impact)}</p><p class="small muted">위 값은 요청 당시 기준입니다. 이후 원본이 바뀌었다면 서버에서 승인을 거부합니다.</p>`;
}
async function reviewApproval(kind, id) {
  const endpoint = { receipt: 'receipt-changes', actual: 'actual-changes', semi: 'semi-changes' }[kind];
  const rows = await api('GET', `/api/${endpoint}?status=pending&id=${encodeURIComponent(id)}`);
  const change = rows.find(c => String(c.id) === String(id));
  if (!change) throw new Error('승인 대기 요청을 찾을 수 없습니다. 목록을 새로 조회하세요.');
  return new Promise(resolve => {
    const box = modal(`<h3>변경 내용 확인 후 승인</h3>${approvalComparison(kind, change)}<div class="actions"><button class="btn" data-review-cancel>돌아가기</button><button class="btn primary" data-review-confirm>승인하고 반영</button></div>`, { wide: true, onClose: () => resolve(false) });
    $('[data-review-cancel]', box.el).onclick = box.close;
    $('[data-review-confirm]', box.el).onclick = () => { resolve(true); box.close(); };
  });
}
