// 조직 구성 (15.49): 관리자가 부서(상·하위)와 직급(서열)을 관리하고, 부서별 구성원을 보며 부서·직급을 바꾼다.
// 가입·사용자 추가·사용자 수정은 orgFields()로 이 목록에서 고른다. 서버 규칙은 worker.mjs 「조직 구성」.

// 부서를 상위→하위 순서로 펼친다(이름 앞에 단계 표시).
function orgTree(departments) {
  const out = [], children = id => departments.filter(d => (d.parent_id || null) === id).sort((a, b) => a.sort - b.sort || a.id - b.id);
  const walk = (id, depth) => { for (const d of children(id)) { out.push({ ...d, depth }); walk(d.id, depth + 1); } };
  walk(null, 0);
  for (const d of departments) if (!out.some(o => o.id === d.id)) out.push({ ...d, depth: 0 }); // 상위가 지워진 경우
  return out;
}
const orgIndent = d => d.depth ? '  '.repeat(d.depth) + '└ ' : '';
// 부서·직급 입력칸: 목록이 있으면 고르기, 없으면 직접 입력(조직 구성 전).
function orgPositionItems(lists, department) {
  const names = (lists.departments || []).find(d => d.name === department)?.position_names;
  return names ? names.map((name, i) => ({ name, sort: names.length - i })) : (lists.positions || []).filter(p => p.active !== 0);
}
function orgPositionField(lists, value, required) {
  const items = orgPositionItems(lists, value.department);
  const configured = (lists.departments || []).some(d => d.position_names?.length);
  if (!items.length && !configured) return `<label>직급<input name="position" maxlength="30" value="${esc(value.position || '')}"></label>`;
  return `<label>직급${required ? ' *' : ''}<select name="position" ${required ? 'required' : ''}><option value="">${!value.department && configured ? '부서를 먼저 선택하세요' : '직급 선택'}</option>${items.map(p => `<option value="${esc(p.name)}" ${value.position === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}${value.position && !items.some(p => p.name === value.position) ? `<option value="${esc(value.position)}" selected disabled>${esc(value.position)} (목록에 없음)</option>` : ''}</select></label>`;
}
function orgFields(lists, value = {}, { required = false } = {}) {
  lists = { departments: (lists.departments || []).filter(d => d.active !== 0), positions: (lists.positions || []).filter(p => p.active !== 0) };
  const departments = lists.departments;
  const dept = departments.length ? `<label>부서${required ? ' *' : ''}<select name="department" ${required ? 'required' : ''}><option value="">부서 선택</option>${orgTree(departments).map(d => `<option value="${esc(d.name)}" ${value.department === d.name ? 'selected' : ''}>${esc(orgIndent(d) + d.name)}</option>`).join('')}${value.department && !departments.some(d => d.name === value.department) ? `<option value="${esc(value.department)}" selected disabled>${esc(value.department)} (목록에 없음)</option>` : ''}</select></label>` : `<label>부서<input name="department" maxlength="50" value="${esc(value.department || '')}"></label>`;
  return `<div class="org-fields" data-org-picker data-required="${required ? '1' : '0'}" data-org-lists="${esc(JSON.stringify(lists))}">${dept}<div class="org-position-field" data-org-position>${orgPositionField(lists, value, required)}</div></div>`;
}
// 다른 화면의 사용자 추가·수정 팝업도 같은 부서별 선택 규칙을 쓴다.
document.addEventListener('change', event => {
  if (event.target.name !== 'department') return;
  const picker = event.target.closest?.('[data-org-picker]'); if (!picker) return;
  const lists = JSON.parse(picker.dataset.orgLists), position = $('[name=position]', picker)?.value || '';
  const items = orgPositionItems(lists, event.target.value);
  $('[data-org-position]', picker).innerHTML = orgPositionField(lists, { department: event.target.value, position: items.some(p => p.name === position) ? position : '' }, picker.dataset.required === '1');
}, true);

async function pageOrg(main) {
  if (!ME.is_admin) { main.innerHTML = '<div class="empty">관리자만 볼 수 있습니다.</div>'; return; }
  const data = await api('GET', '/api/admin/org'); if (!main.isConnected) return;
  const reload = () => pageOrg(main).catch(fail);
  const tree = orgTree(data.departments), rank = u => { const p = orgPositionItems(data, u.department).find(x => x.name === u.position); return p ? p.sort : -1; }; // 높은 직급(아래쪽)이 먼저, 직급 없음은 맨 뒤
  const count = (key, name) => data.users.filter(u => u[key] === name).length;
  const usedNames = data.users.some(u => u.department || u.position);
  const deptRow = d => `<li class="org-row ${d.active ? '' : 'off'}" style="--depth:${d.depth}"><span class="org-name">${esc(orgIndent(d))}<b>${esc(d.name)}</b> <span class="small muted">${count('department', d.name)}명</span>${d.active ? '' : ' <span class="chip">사용 중지</span>'}</span>
    <span class="org-tools"><button type="button" class="btn small" data-position-system="${d.id}">직급 체계${d.position_names ? ' · 별도' : ' · 공통'}</button><button type="button" class="btn small" data-move="departments:${d.id}:-1" aria-label="${esc(d.name)} 위로">↑</button><button type="button" class="btn small" data-move="departments:${d.id}:1" aria-label="${esc(d.name)} 아래로">↓</button><button type="button" class="btn small" data-edit="departments:${d.id}">변경</button><button type="button" class="btn small" data-toggle="departments:${d.id}">${d.active ? '사용 중지' : '다시 사용'}</button><button type="button" class="btn small danger" data-del="departments:${d.id}">삭제</button></span></li>`;
  const posRow = (p, i) => `<li class="org-row ${p.active ? '' : 'off'}"><span class="org-name"><span class="org-rank">${i + 1}</span><b>${esc(p.name)}</b> <span class="small muted">${count('position', p.name)}명</span>${p.active ? '' : ' <span class="chip">사용 중지</span>'}</span>
    <span class="org-tools"><button type="button" class="btn small" data-move="positions:${p.id}:-1" aria-label="${esc(p.name)} 위로">↑</button><button type="button" class="btn small" data-move="positions:${p.id}:1" aria-label="${esc(p.name)} 아래로">↓</button><button type="button" class="btn small" data-edit="positions:${p.id}">변경</button><button type="button" class="btn small" data-toggle="positions:${p.id}">${p.active ? '사용 중지' : '다시 사용'}</button><button type="button" class="btn small danger" data-del="positions:${p.id}">삭제</button></span></li>`;
  // 조직도: 부서 순서대로 구성원을 높은 직급부터. 부서가 없거나 목록에 없는 사람은 맨 아래.
  const members = list => list.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name, 'ko')).map(u => `<li class="org-member"><span><b>${esc(u.name)}</b> <span class="muted">${esc(u.position || '직급 없음')}</span>${u.is_admin ? ' <span class="tag">관리자</span>' : ''}${u.approval_status !== 'approved' ? ` <span class="chip yellow">${u.approval_status === 'pending' ? '가입 대기' : '반려'}</span>` : ''}</span>
    <span class="org-member-edit" data-user="${u.id}">${orgFields(data, u)}</span></li>`).join('');
  const groups = tree.map(d => ({ title: orgIndent(d) + d.name, off: !d.active, list: data.users.filter(u => u.department === d.name) }))
    .concat([{ title: '부서 미지정', list: data.users.filter(u => !tree.some(d => d.name === u.department)) }]).filter(g => g.list.length || !g.off);
  main.innerHTML = `<h1>조직 구성 <span class="dept">관리</span></h1>
    <p class="muted">부서와 직급 목록을 관리합니다. 부서의 「직급 체계」에서 공통 직급 또는 부서별 직급을 설정합니다. 부서별 직급은 상위 부서에서 자동 상속되지 않습니다. 가입할 때 이 목록에서 부서·직급을 고르고, 구매의뢰서의 의뢰부서·요청자 직급으로 자동 표시됩니다. 이름을 바꾸면 그 부서·직급의 사용자도 함께 바뀝니다(지난 구매의뢰서의 표시는 그대로). 사용자가 있는 항목은 삭제 대신 「사용 중지」로 바꾸면 새 가입 목록에서만 빠집니다.</p>
    ${!data.departments.length && !data.positions.length && usedNames ? '<div class="card"><p>아직 목록이 비어 있습니다. 지금 사용자들에게 입력된 부서·직급 이름으로 목록을 먼저 채울 수 있습니다.</p><div class="actions" style="justify-content:flex-start"><button class="btn" id="orgImport">사용자 정보로 목록 채우기</button></div></div>' : ''}
    <div class="org-grid">
      <section class="card"><h2>부서</h2><ul class="org-list">${tree.map(deptRow).join('') || '<li class="muted small">등록된 부서가 없습니다.</li>'}</ul>
        <form class="org-add" data-no-author data-add="departments"><div class="form-grid"><label>새 부서 이름 *<input name="name" required maxlength="50" placeholder="예: 전략영업부"></label><label>상위 부서<select name="parent_id"><option value="">없음 (최상위)</option>${tree.map(d => `<option value="${d.id}">${esc(orgIndent(d) + d.name)}</option>`).join('')}</select></label></div><div class="actions"><button class="btn primary">부서 추가</button></div></form></section>
      <section class="card"><h2>공통 직급 <span class="small muted">위가 낮은 직급, 아래가 높은 직급</span></h2><ul class="org-list">${data.positions.map(posRow).join('') || '<li class="muted small">등록된 직급이 없습니다.</li>'}</ul>
        <form class="org-add" data-no-author data-add="positions"><div class="form-grid"><label>새 직급 이름 *<input name="name" required maxlength="30" placeholder="예: 과장"></label></div><div class="actions"><button class="btn primary">직급 추가</button></div></form></section>
    </div>
    <section class="card"><h2>조직도 · 구성원 <span class="small muted">${data.users.length}명</span></h2><p class="small muted">부서·직급을 고르면 바로 저장됩니다. 권한·가입 승인은 「관리자 설정」에서 합니다.</p>
      ${groups.map(g => `<div class="org-group"><h3>${esc(g.title)} <span class="small muted">${g.list.length}명</span></h3><ul class="org-members">${members(g.list) || '<li class="muted small">구성원 없음</li>'}</ul></div>`).join('')}</section>`;
  const find = key => { const [kind, id] = key.split(':'); return { kind, id: Number(id), row: data[kind].find(x => x.id === Number(id)) }; };
  const run = async (task, message) => { try { await task(); if (message) toast(message); await reload(); } catch (error) { fail(error); } };
  $('#orgImport', main)?.addEventListener('click', () => run(() => api('POST', '/api/admin/org-import'), '사용자 정보로 목록을 채웠습니다.'));
  $$('[data-add]', main).forEach(form => form.onsubmit = event => { event.preventDefault(); const v = formObj(form); run(() => api('POST', `/api/admin/org/${form.dataset.add}`, v), `${v.name}을(를) 추가했습니다.`); });
  $$('[data-move]', main).forEach(b => b.onclick = () => { const [kind, id, dir] = b.dataset.move.split(':'); run(() => api('POST', `/api/admin/org/${kind}/${id}/move`, { dir: Number(dir) })); });
  $$('[data-toggle]', main).forEach(b => b.onclick = () => { const { kind, id, row } = find(b.dataset.toggle); run(() => api('PUT', `/api/admin/org/${kind}/${id}`, { active: !row.active }), row.active ? `${row.name} 사용을 중지했습니다.` : `${row.name}을(를) 다시 사용합니다.`); });
  $$('[data-del]', main).forEach(b => b.onclick = async () => { const { kind, id, row } = find(b.dataset.del); if (await confirmBox(`${row.name}을(를) 삭제할까요?`)) run(() => api('DELETE', `/api/admin/org/${kind}/${id}`), '삭제했습니다.'); });
  $$('[data-edit]', main).forEach(b => b.onclick = async () => {
    const { kind, id, row } = find(b.dataset.edit);
    const parentField = kind === 'departments' ? `<label>상위 부서<select name="parent_id"><option value="">없음 (최상위)</option>${tree.filter(d => d.id !== id).map(d => `<option value="${d.id}" ${row.parent_id === d.id ? 'selected' : ''}>${esc(orgIndent(d) + d.name)}</option>`).join('')}</select></label>` : '';
    const v = await promptBox(`${row.name} 변경`, `<label>이름 *<input name="name" required maxlength="${kind === 'departments' ? 50 : 30}" value="${esc(row.name)}"></label>${parentField}<p class="small muted">${kind === 'departments' ? '이름을 바꾸면 이 부서의 사용자' : '이름을 바꾸면 이 직급의 사용자'} ${count(kind === 'departments' ? 'department' : 'position', row.name)}명도 함께 바뀝니다.</p>`);
    if (v) run(() => api('PUT', `/api/admin/org/${kind}/${id}`, kind === 'departments' ? { name: v.name, parent_id: v.parent_id || null } : { name: v.name }), '변경했습니다.');
  });
  $$('[data-position-system]', main).forEach(button => button.onclick = () => {
    const d = data.departments.find(d => d.id === Number(button.dataset.positionSystem));
    const m = modal(`<h3>${esc(d.name)} 직급 체계</h3><form class="stack" data-no-author><label>직급 목록<select name="mode"><option value="common" ${d.position_names ? '' : 'selected'}>공통 직급 사용</option><option value="custom" ${d.position_names ? 'selected' : ''}>이 부서의 별도 직급 사용</option></select></label><div data-custom-positions><label>높은 직급부터 한 줄에 하나씩<textarea name="names" rows="6" maxlength="1000">${esc((d.position_names || []).join('\n'))}</textarea></label><button type="button" class="btn" data-research-template>연구소 직급 불러오기</button><p class="small muted">연구소장 → 수석 → 선임 → 연구원. 저장해도 기존 사용자의 직급과 과거 결재 기록은 바뀌지 않습니다.</p></div><div class="actions"><button class="btn primary">저장</button></div></form>`);
    const form = $('form', m.el), mode = $('[name=mode]', form), names = $('[name=names]', form);
    const show = () => { $('[data-custom-positions]', form).hidden = mode.value !== 'custom'; names.required = mode.value === 'custom'; };
    mode.onchange = show; show();
    $('[data-research-template]', form).onclick = () => { names.value = '연구소장\n수석\n선임\n연구원'; };
    let busy = false;
    form.onsubmit = async event => { event.preventDefault(); if (busy || !form.reportValidity()) return; busy = true;
      try { await api('PUT', `/api/admin/org/departments/${d.id}`, { position_names: mode.value === 'custom' ? names.value.split(/\r?\n/).map(n => n.trim()).filter(Boolean) : null }); toast('저장했습니다.'); m.close(); await reload(); } catch (error) { fail(error); } finally { busy = false; }
    };
  });
  $$('[data-user]', main).forEach(box => box.addEventListener('change', event => {
    const field = event.target; if (!field.name) return;
    run(() => api('PUT', `/api/admin/users/${box.dataset.user}`, { department: $('[name=department]', box).value, position: $('[name=position]', box).value }), '저장했습니다.');
  }));
}
