// Common progress discussion for all business records.
function commentButton(entity, id, title) {
  return `<button type="button" class="btn small" data-comment-entity="${esc(entity)}" data-comment-id="${esc(id)}" data-comment-title="${esc(title)}">진행 코멘트</button>`;
}
async function openComments(entity, id, title) {
  const box = modal(`<h3>진행현황 코멘트 · ${esc(title)}</h3>
    <p class="muted small">업무 진행사항과 전달 내용을 남겨 주세요. 코멘트는 진행상태 변경과 별도로 저장됩니다. 시간은 한국 시간 기준입니다.</p>
    <div class="actions"><button type="button" class="btn small" data-comment-action data-comment-refresh>새로고침</button><button type="button" class="btn small" data-comment-action data-comment-older hidden>이전 코멘트 더 보기</button></div>
    <p class="small muted" role="status" data-comment-status></p>
    <section aria-label="진행현황 코멘트 내역" class="comment-history"><ol class="comment-list" data-comment-list></ol><p class="muted" data-comment-empty hidden>아직 코멘트가 없습니다. 첫 진행사항을 남겨 주세요.</p></section>
    <form class="stack" data-comment-form><label>진행현황 코멘트<textarea name="content" rows="4" maxlength="2000" required placeholder="예) 업체에 일정 확인 요청했습니다. 11월 20일 답변 예정입니다."></textarea></label><div class="actions"><span class="small muted" data-comment-length>0 / 2,000자</span><button class="btn primary" data-comment-action>코멘트 등록</button></div></form>`, { wide: true });
  const form = $('[data-comment-form]', box.el), status = $('[data-comment-status]', box.el), list = $('[data-comment-list]', box.el), older = $('[data-comment-older]', box.el);
  const endpoint = `/api/comments/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`;
  let rows = [], next = null, busy = false;
  const setBusy = value => { busy = value; form.elements.content.readOnly = value; $$('[data-comment-action]', box.el).forEach(button => { button.disabled = value; }); };
  const display = () => {
    list.innerHTML = rows.slice().sort((a, b) => a.id - b.id).map(row => `<li class="comment-entry"><div class="comment-meta"><b>${esc(row.author_name)}</b><time datetime="${esc(row.created_at.replace(' ', 'T') + '+09:00')}">${esc(row.created_at)}</time></div><p class="comment-content">${esc(row.content)}</p></li>`).join('');
    $('[data-comment-empty]', box.el).hidden = rows.length !== 0;
    older.hidden = next === null;
  };
  const load = async (previous = false) => {
    if (busy) return;
    setBusy(true); status.textContent = '코멘트를 불러오고 있습니다…';
    try {
      const result = await api('GET', endpoint + (previous ? '?before=' + next : ''));
      if (!box.el.isConnected) return;
      rows = previous ? rows.concat(result.rows) : result.rows; next = result.next;
      display(); status.textContent = `${rows.length}개 코멘트${next ? ' · 이전 기록이 더 있습니다.' : ''}`;
    } catch (error) { status.textContent = error.message; fail(error); }
    finally { setBusy(false); }
  };
  $('[data-comment-refresh]', box.el).onclick = () => load();
  older.onclick = () => load(true);
  form.elements.content.oninput = () => { $('[data-comment-length]', box.el).textContent = `${form.elements.content.value.length.toLocaleString('ko-KR')} / 2,000자`; };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const content = form.elements.content.value.trim();
    if (!content) { status.textContent = '코멘트 내용을 입력하세요.'; form.elements.content.focus(); return; }
    setBusy(true); status.textContent = '코멘트를 저장하고 있습니다…';
    try {
      const saved = await api('POST', endpoint, { content });
      if (!box.el.isConnected) return;
      rows = rows.filter(row => row.id !== saved.id).concat(saved);
      form.reset(); form.elements.content.oninput(); display(); status.textContent = '코멘트를 등록했습니다.';
      form.elements.content.focus(); toast('진행현황 코멘트를 등록했습니다.');
    } catch (error) { status.textContent = error.message; fail(error); }
    finally { setBusy(false); }
  };
  await load();
}
// Capture prevents a comment click from selecting a receipt or opening its request detail.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-comment-entity]');
  if (!button) return;
  event.preventDefault(); event.stopPropagation();
  openComments(button.dataset.commentEntity, button.dataset.commentId, button.dataset.commentTitle).catch(fail);
}, true);
