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
  const reload = () => pageOrg(main).then(() => managedTabs(main, '#/admin/org')).catch(fail); // 15.314 다시 그려도 탭 유지
  const tree = orgTree(data.departments), rank = u => { const p = orgPositionItems(data, u.department).find(x => x.name === u.position); return p ? p.sort : -1; }; // 높은 직급(아래쪽)이 먼저, 직급 없음은 맨 뒤
  const count = (key, name) => data.users.filter(u => u[key] === name).length;
  const usedNames = data.users.some(u => u.department || u.position);
  const deptRow = d => `<li class="org-row ${d.active ? '' : 'off'}" style="--depth:${d.depth}"><span class="org-name">${esc(orgIndent(d))}<b>${esc(d.name)}</b> <span class="small muted">${count('department', d.name)}명</span>${d.active ? '' : ' <span class="chip">사용 중지</span>'}</span>
    <span class="org-tools"><button type="button" class="btn small" data-dept-menus="${d.id}">메뉴 · ${esc(d.menus ? menuSummary(d.menus) : '상위·전체')}</button><button type="button" class="btn small" data-position-system="${d.id}">직급 체계${d.position_names ? ' · 별도' : ' · 공통'}</button><button type="button" class="btn small" data-move="departments:${d.id}:-1" aria-label="${esc(d.name)} 위로">↑</button><button type="button" class="btn small" data-move="departments:${d.id}:1" aria-label="${esc(d.name)} 아래로">↓</button><button type="button" class="btn small" data-edit="departments:${d.id}">변경</button><button type="button" class="btn small" data-toggle="departments:${d.id}">${d.active ? '사용 중지' : '다시 사용'}</button><button type="button" class="btn small danger" data-del="departments:${d.id}">삭제</button></span></li>`;
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
    <section class="card"><h2>구성원 배치 <span class="small muted">${data.users.length}명</span></h2><p class="small muted">부서·직급을 고르면 바로 저장됩니다. 권한·가입 승인은 「관리자 설정」에서 합니다.</p>
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
  // 15.59 부서 기본 메뉴: 「부서 기본 따름」인 구성원이 보는 메뉴. 제한 없음이면 상위 부서 설정을 따르고, 상위도 없으면 전체.
  $$('[data-dept-menus]', main).forEach(button => button.onclick = () => {
    const d = data.departments.find(x => x.id === Number(button.dataset.deptMenus));
    const m = modal(`<h3>${esc(d.name)} 기본 메뉴</h3><form class="stack" data-no-author>
      <label class="inline"><input type="checkbox" name="limit" value="1"${d.menus ? ' checked' : ''}> 이 부서의 메뉴를 제한합니다</label>
      <p class="small muted">체크하지 않으면 상위 부서의 설정을 따르고, 상위 부서도 제한이 없으면 모든 메뉴가 보입니다. 사용자별로 「관리자 설정 › 메뉴」에서 따로 정할 수 있습니다.</p>
      <div data-dept-menu-list>${menuChecks(d.menus || null)}</div>
      <div class="actions"><button class="btn primary">저장</button></div></form>`);
    const form = $('form', m.el), list = $('[data-dept-menu-list]', form);
    const sync = () => { list.hidden = !(formObj(form).limit || []).length; }; form.addEventListener('change', sync); sync();
    let busy = false;
    form.onsubmit = async event => { event.preventDefault(); if (busy) return; busy = true; const v = formObj(form);
      try { await api('PUT', `/api/admin/org/departments/${d.id}`, { menus: (v.limit || []).length ? v.menus || [] : null }); toast('저장했습니다.'); m.close(); await reload(); } catch (error) { fail(error); } finally { busy = false; }
    };
  });
  $$('[data-user]', main).forEach(box => box.addEventListener('change', event => {
    const field = event.target; if (!field.name) return;
    run(() => api('PUT', `/api/admin/users/${box.dataset.user}`, { department: $('[name=department]', box).value, position: $('[name=position]', box).value }), '저장했습니다.');
  }));
}

// ── 15.175 회원 관리(관리 › 회원 관리) ── 한 화면에 섞여 있던 것을 세 탭으로 나눈다.
//  · 회원 정보: 가입 승인·반려, 사용자 추가, 부서·직급, 비밀번호 초기화, 삭제
//  · 사용 권한: 승인·처리 같은 업무 권한(역할)과 관리자 — 사람 × 권한 표, 누르면 바로 저장
//  · 메뉴 보기: 화면 메뉴에 보이는 업무 묶음 — 사람 × 메뉴 표(부서 기본/전체/직접 지정)
// 사용 권한이 있는 업무는 그 화면이 있어야 일을 하므로 메뉴를 꺼도 보인다(표에 「권한」으로 따로 표시).
const MEMBER_ROLE_COLS = [['sales', '영업'], ['purchase', '구매'], ['quality', '품질'], ['quality_approver', '품질책임자'], ['dev', '개발'], ['dev_approver', '개발책임자'], ['production', '생산'], ['production_approver', '생산팀장'], ['logistics', '물류'], ['logistics_approver', '물류팀장'], ['operator', '오퍼레이터']];
const MEMBER_APPROVER = ['quality_approver', 'dev_approver', 'production_approver', 'logistics_approver'];
const MEMBER_STATE = { pending: ['승인 대기', 'yellow'], approved: ['승인 완료', 'green'], rejected: ['반려', 'red'] };
const memberMenuName = k => (MENU_GROUP_LABELS.find(([x]) => x === k) || [, k])[1].replace(/ \(.*\)$/, '');
// 15.236 메뉴 보기: 「전체 보임」이어도 사용 권한이 없으면 숨는 화면(서버가 막는 화면)을 사람마다 알려 준다.
// 영업 권한 화면(견적·수주·매출전표…), 구매 권한 화면(매입전표…), 관리자만 쓰는 화면(회원 관리·제품등록…).
const ROLE_NEED_LABEL = { sales: '영업', purchase: '구매' };
function roleHiddenScreens(u) {
  if (u.is_admin || typeof NAV === 'undefined' || typeof routeRoles !== 'function') return [];
  const flat = NAV.flatMap(g => g.items.flatMap(i => Array.isArray(i) ? [i] : i.items));
  const groups = new Map();
  for (const [href, label] of flat) {
    const need = routeRoles(href); if (!need || need.some(r => (u.roles || []).includes(r))) continue;
    const key = need.map(r => ROLE_NEED_LABEL[r] || r).join('·') + ' 권한';
    if (!groups.has(key)) groups.set(key, []); if (!groups.get(key).includes(label)) groups.get(key).push(label);
  }
  if (typeof NAV_ADMIN !== 'undefined') groups.set('관리자만', NAV_ADMIN.map(x => x[1]));
  return [...groups.entries()];
}
function roleHiddenRow(u, cols) {
  const g = roleHiddenScreens(u); if (!g.length) return '';
  return `<tr class="mv-hint" data-u-hint="${u.id}"><td colspan="${cols}"><span class="small muted"><b>${esc(u.name)}</b>에게 숨는 화면(메뉴를 켜도 권한이 있어야 보임) — </span>${g.map(([need, list]) => `<span class="mv-need"><span class="chip">${esc(need === '관리자만' ? '관리자만' : need + ' 필요')}</span> <span class="small">${esc(list.join(', '))}</span></span>`).join(' ')}${g.some(([n]) => n !== '관리자만') ? ' <a class="small" href="#/admin/users/roles">사용 권한에서 주기 →</a>' : ''}</td></tr>`;
}
async function pageMembers(main, tab) {
  if (!ME.is_admin) { main.innerHTML = '<h1>회원 관리</h1><div class="empty">관리자만 볼 수 있습니다.</div>'; return; }
  const org = await api('GET', '/api/org');
  const intro = {
    info: '가입 승인과 회원 기본 정보(이름·부서·직급·비밀번호)를 관리합니다. 업무 권한은 「사용 권한」, 화면 메뉴는 「메뉴 보기」 탭에서 따로 정합니다.',
    roles: '무엇을 <b>할 수 있는지</b>(입력·처리·승인)를 정합니다. 체크하면 바로 저장됩니다. 책임자(승인권자)는 가입 승인된 사람만 지정할 수 있습니다. 오퍼레이터는 입력 전용 화면으로 제한됩니다(관리자 제외).',
    menus: '화면 메뉴에 무엇이 <b>보이는지</b>만 정합니다. 숨긴 메뉴는 메뉴·대시보드에서 빠지고 주소로 들어와도 열리지 않습니다. 단, 사용 권한이 있는 업무는 일을 해야 하므로 메뉴를 꺼도 보입니다(<span class="chip">권한</span> 표시). 반대로 영업·구매의 전표·계산서·장부·달력 화면은 메뉴를 켜도 영업·구매 <b>사용 권한</b>이 있어야 보입니다. 「부서 기본」은 관리 › 조직 구성의 부서 설정을 따릅니다.',
  }[tab];
  main.innerHTML = `<h1>회원 관리</h1><p class="muted">${intro}</p>
    ${tab === 'info' ? `<details class="card member-new"><summary><b>+ 사용자 추가</b> <span class="small muted">관리자가 바로 만드는 계정은 승인된 상태입니다</span></summary>
      <form id="userNew"><div class="form-grid"><label>이름 *<input name="name" required maxlength="30" autocomplete="off"></label><label>비밀번호 * (4자 이상)<input name="password" type="password" required minlength="4" autocomplete="new-password"></label>${orgFields(org)}</div>
      <p class="small muted">만든 뒤 「사용 권한」·「메뉴 보기」 탭에서 권한과 메뉴를 정하세요.</p><div class="actions"><button class="btn primary">계정 만들기</button></div></form></details>` : ''}
    <form class="list-filters toolbar lf-oneline" data-read-only id="memberFilters">
      <label class="grow lf-q">이름·부서 검색<input type="search" name="q" placeholder="이름·부서·직급"></label>
      <label class="lf-sel">가입 상태<select name="approval"><option value="">전체</option><option value="pending">승인 대기</option><option value="approved">승인 완료</option><option value="rejected">반려</option></select></label>
      ${tab === 'roles' ? `<label class="lf-sel lf-wide">권한<select name="role"><option value="">전체</option><option value="admin">관리자</option>${MEMBER_ROLE_COLS.map(([r, l]) => `<option value="${r}">${l}</option>`).join('')}<option value="none">권한 없음</option></select></label>` : ''}
      ${tab === 'menus' ? `<label class="lf-sel lf-wide">메뉴 방식<select name="mode"><option value="">전체</option><option value="department">부서 기본</option><option value="all">전체 보임</option><option value="custom">직접 지정</option></select></label>` : ''}
      <span class="small muted" data-member-count></span></form>
    <div id="memberList"></div>`;
  const filters = $('#memberFilters', main); let users = [];
  const visible = u => { const v = formObj(filters), q = (v.q || '').trim().toLowerCase();
    if (q && ![u.name, u.department, u.position].join(' ').toLowerCase().includes(q)) return false;
    if (v.approval && u.approval_status !== v.approval) return false;
    if (v.role) { if (v.role === 'admin' ? !u.is_admin : v.role === 'none' ? (u.is_admin || u.roles.length) : !u.roles.includes(v.role)) return false; }
    if (v.mode && (u.is_admin || u.menu_mode !== v.mode)) return false;
    return true; };
  const who = u => `<b>${esc(u.name)}</b>${u.id === ME.id ? ' <span class="chip">나</span>' : ''}${u.department || u.position ? `<div class="small muted">${esc([u.department, u.position].filter(Boolean).join(' · '))}</div>` : ''}`;
  const state = u => { const [t, c] = MEMBER_STATE[u.approval_status] || ['', '']; return `<span class="chip ${c}">${t}</span>${u.approval_note ? `<div class="small muted">${esc(u.approval_note)}</div>` : ''}`; };
  const roleSummary = u => u.is_admin ? '<span class="chip">관리자 · 전체</span>' : u.roles.length ? u.roles.map(r => esc(ROLE_SHORT[r] || r)).join(' · ') : '<span class="muted">없음</span>';
  const menuSummaryOf = u => u.is_admin ? '전체(관리자)' : u.menu_mode === 'all' ? '전체 보임' : u.menu_mode === 'custom' ? `직접 · ${menuSummary(u.menu_custom || [])}` : `부서 기본 · ${u.menus_base ? menuSummary(u.menus_base) : '전체'}`;
  const tables = {
    info: list => `<table class="grid member-grid" data-no-reorder><thead><tr><th>이름</th><th>가입 상태</th><th>가입일</th><th>사용 권한</th><th>메뉴 보기</th><th></th></tr></thead><tbody>${list.map(u => `<tr data-u="${u.id}">
      <td>${who(u)}</td><td>${state(u)}</td><td class="nowrap small">${esc(String(u.created_at || '').slice(0, 10))}</td>
      <td class="small"><a href="#/admin/users/roles" data-goto-q="${esc(u.name)}">${roleSummary(u)}</a></td><td class="small"><a href="#/admin/users/menus" data-goto-q="${esc(u.name)}">${esc(menuSummaryOf(u))}</a></td>
      <td class="nowrap">${u.approval_status !== 'approved' ? '<button class="btn small primary" data-approve>가입 승인</button> ' : ''}${!u.is_admin && u.approval_status !== 'rejected' && u.id !== ME.id ? '<button class="btn small danger" data-reject>반려</button> ' : ''}<button class="btn small" data-profile>부서·직급</button> <button class="btn small" data-pw>비밀번호 초기화</button> ${u.id !== ME.id ? '<button class="btn small danger" data-del>삭제</button>' : ''}</td></tr>`).join('')}</tbody></table>`,
    roles: list => `<table class="grid member-grid matrix keep-table" data-no-reorder><thead><tr><th>이름</th><th class="c">관리자</th>${MEMBER_ROLE_COLS.map(([r, l]) => `<th class="c" title="${esc(ROLE_LABEL[r])}">${l}</th>`).join('')}</tr></thead><tbody>${list.map(u => `<tr data-u="${u.id}"><td>${who(u)}${u.approval_status !== 'approved' ? ` ${state(u)}` : ''}</td>
      <td class="c" data-label="관리자"><label class="mx-cell"><input type="checkbox" data-admin ${u.is_admin ? 'checked' : ''} ${u.id === ME.id || u.approval_status !== 'approved' ? 'disabled' : ''} aria-label="${esc(u.name)} 관리자"><span class="mx-lab" aria-hidden="true">관리자</span></label></td>
      ${MEMBER_ROLE_COLS.map(([r, l]) => `<td class="c" data-label="${esc(l)}"><label class="mx-cell"><input type="checkbox" data-role="${r}" ${u.roles.includes(r) ? 'checked' : ''} ${MEMBER_APPROVER.includes(r) && u.approval_status !== 'approved' ? 'disabled title="가입 승인 후 지정"' : ''} aria-label="${esc(u.name)} ${l}"><span class="mx-lab" aria-hidden="true">${esc(l)}</span></label></td>`).join('')}</tr>`).join('')}</tbody></table>`,
    menus: list => `<table class="grid member-grid matrix keep-table" data-no-reorder><thead><tr><th>이름</th><th>방식</th>${MENU_GROUP_LABELS.map(([k, l]) => `<th class="c">${esc(l.replace(/ \(.*\)$/, ''))}</th>`).join('')}</tr></thead><tbody>${list.map(u => {
      if (u.is_admin) return `<tr data-u="${u.id}"><td>${who(u)}</td><td colspan="${MENU_GROUP_LABELS.length + 1}" class="muted">관리자 — 모든 메뉴가 보입니다</td></tr>`;
      const base = u.menu_mode === 'custom' ? (u.menu_custom || []) : u.menu_mode === 'all' ? null : u.menus_base, eff = u.menus_effective;
      return `<tr data-u="${u.id}"><td>${who(u)}</td><td><select data-menu-mode aria-label="${esc(u.name)} 메뉴 방식"><option value="department"${u.menu_mode === 'department' ? ' selected' : ''}>부서 기본</option><option value="all"${u.menu_mode === 'all' ? ' selected' : ''}>전체 보임</option><option value="custom"${u.menu_mode === 'custom' ? ' selected' : ''}>직접 지정</option></select></td>
        ${MENU_GROUP_LABELS.map(([k, l]) => { const on = !base || base.includes(k), byRole = !on && (!eff || eff.includes(k));
          return `<td class="c" data-label="${esc(l.replace(/ \(.*\)$/, ''))}"><label class="mx-cell">${u.menu_mode === 'custom' ? `<input type="checkbox" data-menu="${k}" ${on ? 'checked' : ''} aria-label="${esc(u.name)} ${esc(l)}">` : on ? '<span class="mv-on" aria-label="보임">✓</span>' : '<span class="mv-off" aria-label="숨김">—</span>'}<span class="mx-lab" aria-hidden="true">${esc(l.replace(/ \(.*\)$/, ''))}</span></label>${byRole ? ' <span class="chip" title="사용 권한이 있어 메뉴를 꺼도 보입니다">권한</span>' : ''}</td>`; }).join('')}</tr>${roleHiddenRow(u, MENU_GROUP_LABELS.length + 2)}`; }).join('')}</tbody></table>`,
  };
  // 15.244 체크 후 다시 그려도 보던 자리(화면·표 스크롤)와 누른 칸 포커스를 그대로 둔다(맨 위로 튀지 않게)
  const draw = () => {
    const box = $('#memberList', main), wrap = $('.table-wrap', box), se = document.scrollingElement || document.documentElement;
    const keep = { y: se.scrollTop, m: main.scrollTop, t: wrap?.scrollTop || 0, l: wrap?.scrollLeft || 0, h: box.offsetHeight };
    const f = document.activeElement, ftr = f?.closest?.('tr[data-u]'), fsel = ftr && box.contains(f) ? `tr[data-u="${ftr.dataset.u}"] ${['data-role', 'data-menu', 'data-admin', 'data-menu-mode'].map(a => f.hasAttribute(a) ? `[${a}${f.getAttribute(a) ? `="${CSS.escape(f.getAttribute(a))}"` : ''}]` : '').join('')}${f.type === 'radio' ? `[value="${CSS.escape(f.value)}"]` : ''}` : '';
    box.style.minHeight = keep.h ? `${keep.h}px` : '';
    const list = users.filter(visible); $('[data-member-count]', filters).textContent = `${list.length}명`; box.innerHTML = list.length ? `<div class="table-wrap">${tables[tab](list)}</div>` : '<div class="empty">조건에 맞는 회원이 없습니다.</div>';
    const w2 = $('.table-wrap', box); if (w2) { if (wrap) w2.className = wrap.className; w2.scrollTop = keep.t; w2.scrollLeft = keep.l; } // 표 칸 높이 제한(tw-fill·tw-freeze)을 먼저 옮겨야 표 안 스크롤이 남는다
    if (fsel && fsel.includes('[')) { try { $(fsel, box)?.focus({ preventScroll: true }); } catch { /* 선택자 */ } }
    se.scrollTop = keep.y; main.scrollTop = keep.m;
    requestAnimationFrame(() => { box.style.minHeight = ''; se.scrollTop = keep.y; main.scrollTop = keep.m; });
  };
  const load = async () => { users = await api('GET', '/api/admin/users'); if (main.isConnected) draw(); };
  const save = async (id, body, msg = '저장했습니다.') => {
    try { await api('PUT', '/api/admin/users/' + id, body); toast(msg); if (Number(id) === ME.id) ME = (await api('GET', '/api/me')).user; }
    catch (e) { fail(e); }
    await load();
  };
  try { const q = sessionStorage.getItem('wpa:member-q'); if (q) { filters.elements.q.value = q; sessionStorage.removeItem('wpa:member-q'); } } catch { /* 편의 */ }
  filters.addEventListener('input', draw); filters.addEventListener('change', draw); filters.onsubmit = e => e.preventDefault();
  const list = $('#memberList', main);
  list.addEventListener('click', async e => {
    const g = e.target.closest('[data-goto-q]'); if (g) { try { sessionStorage.setItem('wpa:member-q', g.dataset.gotoQ); } catch { /* */ } return; }
    const tr = e.target.closest('tr[data-u]'); if (!tr) return; const id = Number(tr.dataset.u), u = users.find(x => x.id === id); if (!u) return;
    const review = async (status, note = '') => { try { await api('POST', `/api/admin/users/${id}/approval`, { status, note }); toast(status === 'approved' ? '가입을 승인했습니다.' : '가입을 반려했습니다.'); } catch (err) { fail(err); } await load(); };
    if (e.target.closest('[data-approve]')) { if (await confirmBox(`${u.name} 님의 가입을 승인할까요?`)) await review('approved'); return; }
    if (e.target.closest('[data-reject]')) { const v = await promptBox(`${u.name} 님의 가입 반려`, '<label>반려 사유<input name="note" maxlength="500"></label>'); if (v) await review('rejected', v.note); return; }
    if (e.target.closest('[data-profile]')) { const v = await promptBox(`${u.name} 부서·직급`, `<p class="small muted">부서·직급 목록은 「조직 구성」에서 관리합니다. 「부서 기본」 메뉴는 부서를 따라 바뀝니다.</p>${orgFields(org, u)}`); if (v) await save(id, v); return; }
    if (e.target.closest('[data-pw]')) { const v = await promptBox(`${u.name} 비밀번호 초기화`, '<label>새 비밀번호 *<input name="password" required minlength="4"></label><p class="small muted">바꾸면 이 사람은 다시 로그인해야 합니다.</p>'); if (v) await save(id, v, '비밀번호를 바꿨습니다.'); return; }
    if (e.target.closest('[data-del]')) { if (await confirmBox(`${u.name} 사용자를 삭제할까요?`)) { try { await api('DELETE', '/api/admin/users/' + id); toast('삭제했습니다.'); } catch (err) { fail(err); } await load(); } return; }
  });
  list.addEventListener('change', async e => {
    const tr = e.target.closest('tr[data-u]'); if (!tr) return; const id = Number(tr.dataset.u), u = users.find(x => x.id === id);
    if (e.target.matches('[data-role]')) return save(id, { roles: $$('[data-role]:checked', tr).map(x => x.dataset.role) }, `${u.name} 사용 권한을 저장했습니다.`);
    if (e.target.matches('[data-admin]')) { if (e.target.checked && !await confirmBox(`${u.name} 님을 관리자로 지정할까요? 관리자는 모든 화면·설정을 볼 수 있습니다.`)) { e.target.checked = false; return; } return save(id, { is_admin: e.target.checked }, '관리자 권한을 저장했습니다.'); }
    if (e.target.matches('[data-menu-mode]')) { const mode = e.target.value; const menus = mode === 'custom' ? (u.menu_mode === 'custom' ? u.menu_custom || [] : u.menus_base || MENU_GROUP_LABELS.map(([k]) => k)) : []; return save(id, { menu_mode: mode, menus }, `${u.name} 메뉴 보기를 저장했습니다.`); }
    if (e.target.matches('[data-menu]')) return save(id, { menu_mode: 'custom', menus: $$('[data-menu]:checked', tr).map(x => x.dataset.menu) }, `${u.name} 메뉴 보기를 저장했습니다.`);
  });
  const nf = $('#userNew', main);
  if (nf) nf.onsubmit = async e => { e.preventDefault(); try { const made = await api('POST', '/api/admin/users', { ...formObj(nf), roles: [] }); toast(`${made.name} 계정을 만들었습니다. 사용 권한·메뉴 보기를 정하세요.`); nf.reset(); await load(); } catch (err) { fail(err); } };
  await load();
}

// ── 15.185 결재선 설정(관리 › 결재선 설정): 문서별 「작성자 직급 → 결재·합의·참조」 기본값. 단계는 직급(작성자 부서→상위 부서에서 찾음) 또는 특정 사람.
async function pageApprovalRules(main) {
  if (!ME.is_admin) { main.innerHTML = '<h1>결재선 설정</h1><div class="empty">관리자만 볼 수 있습니다.</div>'; return; }
  const [rules, org, people] = await Promise.all([api('GET', '/api/approval-rules'), api('GET', '/api/org'), api('GET', '/api/directory')]);
  let list = JSON.parse(JSON.stringify(rules.purchase_request || []));
  const KIND = { approve: '결재', agree: '합의', cc: '참조' }, posNames = (org.positions || []).map(p => p.name);
  const stepText = st => st.type === 'position' ? `${st.position}(직급)` : (people.find(p => p.id === st.user_id)?.name || '없는 사람') + (people.find(p => p.id === st.user_id)?.position ? ` ${people.find(p => p.id === st.user_id).position}` : '');
  const adder = (i, kind) => `<select data-add="${i}:${kind}" aria-label="${KIND[kind]} 단계 추가"><option value="">+ ${KIND[kind]} 추가</option><optgroup label="직급(작성자 부서→상위 부서에서 찾음)">${posNames.map(n => `<option value="p:${esc(n)}">${esc(n)}</option>`).join('')}</optgroup><optgroup label="특정 사람">${people.map(p => `<option value="u:${p.id}">${esc(p.name)}${p.position ? ' · ' + esc(p.position) : ''}${p.department ? ' · ' + esc(p.department) : ''}</option>`).join('')}</optgroup></select>`;
  const draw = () => {
    $('#ruleList', main).innerHTML = list.length ? `<div class="table-wrap"><table class="grid ar-grid" data-no-reorder data-no-sort data-no-filter><thead><tr><th>작성자 직급</th><th>결재(순서대로)</th><th>합의</th><th>참조</th><th></th></tr></thead><tbody>${list.map((r, i) => `<tr>
      <td><select data-when="${i}" aria-label="작성자 직급"><option value="">모든 직급(기본)</option>${posNames.map(n => `<option${r.when_position === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></td>
      ${['approve', 'agree', 'cc'].map(kind => `<td><ol class="ar-steps">${(r[kind] || []).map((st, j) => `<li><span>${esc(stepText(st))}</span><button type="button" class="btn small" data-del="${i}:${kind}:${j}" aria-label="빼기">×</button></li>`).join('')}</ol>${adder(i, kind)}</td>`).join('')}
      <td><button type="button" class="btn small danger" data-rm="${i}">규칙 삭제</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">규칙이 없습니다. 「+ 규칙 추가」로 만드세요.</div>';
  };
  main.innerHTML = `<h1>결재선 설정</h1>
    <p class="muted">문서를 새로 쓸 때 결재선을 자동으로 채울 기본값입니다. 작성자 직급마다 규칙을 두고(없으면 「모든 직급」 규칙), 단계는 <b>직급</b>(작성자 부서부터 상위 부서로 올라가며 그 직급인 사람을 찾음) 또는 <b>특정 사람</b>으로 정합니다. 작성자는 채워진 결재선을 바꿀 수 있습니다.</p>
    <div class="seg class-tabs" role="tablist"><a role="tab" class="on" aria-selected="true">구매의뢰</a></div>
    <p class="small muted">예) 작성자 「사원」 → 결재 「주임」 → 「대리」, 합의 「구매팀장(특정 사람)」</p>
    <div id="ruleList"></div>
    <div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-new>+ 규칙 추가</button><button type="button" class="btn primary" data-save>저장</button></div>`;
  draw();
  main.addEventListener('change', e => {
    const w = e.target.closest('[data-when]'); if (w) { list[Number(w.dataset.when)].when_position = w.value; return; }
    const ad = e.target.closest('[data-add]'); if (ad && ad.value) { const [i, kind] = ad.dataset.add.split(':'), v = ad.value; const st = v.startsWith('p:') ? { type: 'position', position: v.slice(2) } : { type: 'user', user_id: Number(v.slice(2)) }; (list[Number(i)][kind] ||= []).push(st); draw(); }
  });
  main.addEventListener('click', async e => {
    const d = e.target.closest('[data-del]'); if (d) { const [i, kind, j] = d.dataset.del.split(':'); list[Number(i)][kind].splice(Number(j), 1); draw(); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { list.splice(Number(rm.dataset.rm), 1); draw(); return; }
    if (e.target.closest('[data-new]')) { list.push({ when_position: '', approve: [], agree: [], cc: [] }); draw(); return; }
    if (e.target.closest('[data-save]')) { try { const saved = await api('PUT', '/api/approval-rules', { purchase_request: list }); list = saved.purchase_request; draw(); toast('결재선 설정을 저장했습니다.'); } catch (err) { fail(err); } }
  });
}

// ── 15.314 조직도 · 지정 담당자 ──
// 조직도: 회사(대표) → 부서 트리(부서장 · 업무 분장 · 구성원, 이름 옆 지정 담당 배지). 트리(가로) · 목록(세로) 보기, 찾기, 인쇄.
// 지정 담당자: 정보보호·개인정보·소방·산업안전보건·환경·전기·품질 등 법정·사내 담당을 정·부로 지정하고 별도 담당 업무·법적 근거·법정교육 기한을 관리.
const DUTY_CAT_LABEL = { security: '정보보호', privacy: '개인정보', fire: '소방', safety: '산업안전보건', env: '환경·화학', elec: '전기·에너지', quality: '품질', emergency: '비상·응급', etc: '기타' };
// 지정 종류 기본값(법적 근거·교육 주기는 흔히 쓰는 기준이며 사업장 규모·법령 개정에 따라 다를 수 있어 고쳐 쓸 수 있다).
const DUTY_PRESETS = [
  { key: 'ciso', title: '정보보호 최고책임자(CISO)', short: 'CISO', cat: 'security', basis: '정보통신망법 제45조의3', tasks: '정보보호 계획 수립·시행·개선\n정보보호 실태·관행 정기 점검\n정보보호 위험 식별·평가와 대책\n정보보호 교육·모의훈련 계획·시행\n침해사고 대응 총괄' },
  { key: 'sec_officer', title: '정보보호 담당자', short: '정보보호', cat: 'security', basis: '사내 지정(정보보안 규정)', tasks: '사용자 계정·접근권한 관리\nPC·서버 보안 패치·백신 점검\n접속기록·로그 정기 점검\n보안 사고 접수·보고·조치\n저장매체·외부 반출 보안 관리' },
  { key: 'cpo', title: '개인정보 보호책임자(CPO)', short: 'CPO', cat: 'privacy', basis: '개인정보 보호법 제31조', tasks: '개인정보 처리방침 수립·공개\n개인정보 처리 실태 조사·개선\n개인정보 관련 고충 처리·피해 구제\n유출·오남용 방지 내부통제\n개인정보 보호 교육' },
  { key: 'privacy_mgr', title: '개인정보 보호 담당자', short: '개인정보', cat: 'privacy', basis: '사내 지정(내부 관리계획)', tasks: '개인정보 파일·처리 현황 관리\n개인정보 취급자 접근권한 관리\n보유기간 지난 개인정보 파기\n처리 위탁 업체 관리·점검' },
  { key: 'fire_mgr', title: '소방안전관리자', short: '소방', cat: 'fire', basis: '화재의 예방 및 안전관리에 관한 법률 제24조', cycle: 24, tasks: '소방계획서 작성·시행\n자위소방대 구성·운영\n피난시설·방화구획·방화시설 관리\n소방시설 유지·관리(작동·종합 점검)\n소방훈련·교육 실시\n화기 취급 감독\n업무 수행 기록 작성·보관' },
  { key: 'fire_asst', title: '소방안전관리보조자', short: '소방(보조)', cat: 'fire', basis: '화재의 예방 및 안전관리에 관한 법률 제24조', cycle: 24, tasks: '소방안전관리자 업무 보조\n소방시설 일상 점검\n피난통로 확보 점검' },
  { key: 'safety_chief', title: '안전보건관리책임자', short: '안전보건책임', cat: 'safety', basis: '산업안전보건법 제15조', cycle: 24, tasks: '산업재해 예방계획 수립\n안전보건관리규정 작성·변경\n근로자 안전보건교육\n작업환경측정 등 작업환경 점검·개선\n건강진단 등 건강관리\n산업재해 원인 조사·재발 방지\n위험성평가 실시 총괄' },
  { key: 'safety_mgr', title: '안전관리자', short: '안전', cat: 'safety', basis: '산업안전보건법 제17조', cycle: 24, tasks: '위험성평가 지도·조언\n안전교육 계획·실시\n사업장 순회 점검·지도\n산업재해 원인 조사·대책\n안전인증 대상 기계 적격품 선정 조언' },
  { key: 'health_mgr', title: '보건관리자', short: '보건', cat: 'safety', basis: '산업안전보건법 제18조', cycle: 24, tasks: '보건교육 계획·실시\n작업환경 점검·개선 조언\n건강진단 결과 사후관리\n응급처치·물질안전보건자료(MSDS) 관리 조언' },
  { key: 'supervisor', title: '관리감독자', short: '관리감독', cat: 'safety', basis: '산업안전보건법 제16조', cycle: 12, tasks: '담당 기계·설비 안전·보건 점검\n보호구 착용·사용 지도\n산업재해 보고·응급조치\n작업장 정리정돈·통로 확보\n위험성평가 유해·위험요인 파악 참여' },
  { key: 'sh_officer', title: '안전보건관리담당자', short: '안전보건담당', cat: 'safety', basis: '산업안전보건법 제19조', cycle: 24, tasks: '안전보건교육 실시 지원\n위험성평가 실시 지원\n작업환경측정·건강진단 지원\n산업재해 원인 조사 지원' },
  { key: 'elec_mgr', title: '전기안전관리자', short: '전기', cat: 'elec', basis: '전기안전관리법 제22조', cycle: 36, tasks: '전기설비 공사·유지·운용 안전관리\n정기 점검·측정 기록\n전기 사고 예방·대응' },
  { key: 'hazmat_mgr', title: '위험물안전관리자', short: '위험물', cat: 'env', basis: '위험물안전관리법 제15조', cycle: 24, tasks: '위험물 취급 작업 안전 감독\n위험물 시설 점검·기록\n화재 등 재해 발생 시 응급조치' },
  { key: 'chem_mgr', title: '유해화학물질 관리자', short: '화학물질', cat: 'env', basis: '화학물질관리법 제32조', cycle: 24, tasks: '유해화학물질 취급 기준 준수 관리\n취급시설 자체 점검·기록\n사고 대비·대응 계획\n취급자 교육' },
  { key: 'env_tech', title: '환경기술인', short: '환경', cat: 'env', basis: '대기환경보전법·물환경보전법', cycle: 36, tasks: '배출·방지시설 운영·관리\n운영일지 기록·보존\n자가측정·관련 신고' },
  { key: 'qmr', title: '품질경영 책임자', short: '품질책임', cat: 'quality', basis: '사내 지정(ISO 9001)', tasks: '품질경영시스템 수립·유지\n품질목표·KPI 관리\n내부심사·경영검토 주관\n고객 요구사항 인식 촉진' },
  { key: 'first_aid', title: '응급처치·비상연락 담당', short: '응급', cat: 'emergency', basis: '사내 지정', tasks: '구급함·AED 점검\n비상연락망 관리\n응급상황 초기 대응·신고' },
  { key: 'custom', title: '', short: '', cat: 'etc', basis: '', tasks: '' },
];
const dutyShort = d => (DUTY_PRESETS.find(p => p.key === d.duty_key)?.short) || d.title.replace(/\(.*\)/, '').slice(0, 8);
const dutyBadge = (d, deputy = false) => `<span class="oc-badge" data-cat="${esc(d.category)}" title="${esc(d.title)}${deputy ? ' (대리자·부)' : ''}${d.scope ? ' · ' + esc(d.scope) : ''}">${esc(dutyShort(d))}${deputy ? '<small>부</small>' : ''}</span>`;
const dutyTrainChip = d => !d.next_training ? '<span class="muted">—</span>' : `${esc(d.next_training)} ${d.train === 'over' ? '<span class="chip red">지남</span>' : d.train === 'soon' ? '<span class="chip yellow">30일 안</span>' : ''}`;
const dutyTasksHtml = t => { const l = String(t || '').split('\n').map(x => x.trim()).filter(Boolean); return l.length ? `<ul class="duty-tasks">${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="muted">—</span>'; };
const ocLayoutKey = 'wpa:oc-layout';
async function pageOrgChart(main) {
  const data = await api('GET', '/api/org/chart'); if (!main.isConnected) return;
  let layout = (() => { try { return localStorage.getItem(ocLayoutKey); } catch { return null; } })() || (innerWidth < 760 ? 'list' : 'tree');
  const depts = data.departments, users = data.users, can = data.can_manage;
  const rankOf = u => { const p = orgPositionItems({ departments: depts, positions: data.positions }, u.department).find(x => x.name === u.position); return p ? p.sort : -1; };
  const byDept = name => users.filter(u => u.department === name).sort((a, b) => rankOf(b) - rankOf(a) || a.name.localeCompare(b.name, 'ko'));
  const badges = u => data.duties.filter(d => d.user_id === u.id).map(d => dutyBadge(d)).join('') + data.duties.filter(d => d.deputy_user_id === u.id).map(d => dutyBadge(d, true)).join('');
  const isRoot = d => !d.parent_id || !depts.some(p => p.id === d.parent_id), kids = id => depts.filter(d => d.parent_id === id);
  const subCount = d => byDept(d.name).length + kids(d.id).reduce((n, k) => n + subCount(k), 0);
  main.innerHTML = `<h1>조직 구성 <span class="dept">관리</span></h1>
    <p class="muted">부서 트리(「부서·직급」 탭)와 구성원의 부서·직급으로 그립니다. 이름 옆 색 배지는 지정 담당 업무(정보보호·소방 등, 「부」는 대리자)입니다.${can ? ' 맨 위 상자를 누르면 회사명·대표를, 부서 상자를 누르면 부서장·부서 업무를 정합니다.' : ''}</p>
    <form class="toolbar oc-tools" id="ocTools" data-read-only><label class="chk"><input type="checkbox" name="members" checked> 구성원</label><label class="chk"><input type="checkbox" name="badges" checked> 지정 담당 배지</label><label class="chk"><input type="checkbox" name="tasks"> 부서 업무</label>
      <label class="list-search">찾기<input type="search" name="q" placeholder="이름·부서·담당 업무"></label><span class="grow"></span>
      <span class="seg" role="group" aria-label="보기"><button type="button" class="btn" data-oc-layout="tree">트리</button><button type="button" class="btn" data-oc-layout="list">목록</button></span><button type="button" class="btn" data-oc-print>인쇄</button>${can ? '<a class="btn" href="#/admin/org/duties">지정 담당자</a>' : ''}</form>
    <div class="oc-scroll"><div id="ocChart" class="oc-chart"></div></div>
    <section class="card"><h2>지정 담당자 <span class="small muted">${data.duties.length}건</span></h2><div id="ocDuties"></div></section>`;
  const tools = $('#ocTools', main);
  const person = (u, head = false) => `<li class="oc-person${head ? ' head' : ''}" data-oc-name="${esc(u.name)}">${head ? '<span class="oc-role">부서장</span>' : ''}<b>${esc(u.name)}</b> <span class="muted">${esc(u.position || '')}</span><span class="oc-badges">${badges(u)}</span></li>`;
  const deptBox = d => {
    const list = byDept(d.name), head = d.head || null, rest = list.filter(u => !head || u.id !== head.id);
    return `<div class="oc-node${can ? ' can' : ''}" data-oc-dept="${d.id}"${can ? ' tabindex="0" role="button"' : ''} data-oc-name="${esc(d.name)}"><div class="oc-title"><b>${esc(d.name)}</b><span class="oc-count" title="하위 부서 포함 ${subCount(d)}명">${list.length}명</span></div>
      <ul class="oc-people">${head ? person(head, true) : '<li class="oc-person head muted small"><span class="oc-role">부서장</span> 미지정</li>'}<span class="oc-more">${rest.map(u => person(u)).join('')}</span></ul>
      ${d.duties ? `<div class="oc-dtasks">${dutyTasksHtml(d.duties)}</div>` : ''}</div>`;
  };
  const treeNode = d => `<li class="oc-li">${deptBox(d)}${kids(d.id).length ? `<ul class="oc-sub">${kids(d.id).map(treeNode).join('')}</ul>` : ''}</li>`;
  const rootBox = `<div class="oc-node oc-root${can ? ' can' : ''}" data-oc-root${can ? ' tabindex="0" role="button"' : ''}><div class="oc-co">${esc(data.company || '회사명 미지정')}</div><div class="oc-ceo">${esc(data.ceo_title)} <b>${esc(data.ceo_name || '미지정')}</b>${data.ceo ? `<span class="oc-badges">${badges(data.ceo)}</span>` : ''}</div></div>`;
  const loose = users.filter(u => !depts.some(d => d.name === u.department));
  const draw = () => {
    const v = formObj(tools), chart = $('#ocChart', main), q = (v.q || '').trim().toLowerCase();
    chart.className = `oc-chart ${layout}${v.members?.length ? '' : ' no-members'}${v.badges?.length ? '' : ' no-badges'}${v.tasks?.length ? '' : ' no-tasks'}`;
    chart.innerHTML = layout === 'tree'
      ? `<ul class="oc-tree"><li class="oc-li">${rootBox}${depts.filter(isRoot).length ? `<ul class="oc-sub">${depts.filter(isRoot).map(treeNode).join('')}</ul>` : ''}</li></ul>`
      : `<div class="oc-vlist">${rootBox}<ul class="oc-vl">${depts.filter(isRoot).map(function li(d) { return `<li>${deptBox(d)}${kids(d.id).length ? `<ul class="oc-vl">${kids(d.id).map(li).join('')}</ul>` : ''}</li>`; }).join('')}</ul></div>`;
    if (loose.length) chart.insertAdjacentHTML('beforeend', `<div class="oc-loose"><div class="oc-node"><div class="oc-title"><b>부서 미지정</b><span class="oc-count">${loose.length}명</span></div><ul class="oc-people"><span class="oc-more">${loose.map(u => person(u)).join('')}</span></ul></div></div>`);
    if (!depts.length) chart.insertAdjacentHTML('beforeend', `<p class="muted small">부서가 없습니다. ${can ? '「부서·직급」 탭에서 부서를 만들고 상위 부서를 정하면 트리로 그려집니다.' : ''}</p>`);
    $$('[data-oc-layout]', main).forEach(b => b.classList.toggle('primary', b.dataset.ocLayout === layout));
    if (q) {
      const hits = $$('[data-oc-name]', chart).filter(el => el.dataset.ocName.toLowerCase().includes(q) || (el.classList.contains('oc-person') && el.textContent.toLowerCase().includes(q)));
      hits.forEach(el => el.classList.add('oc-hit')); hits[0]?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    const byCat = Object.keys(DUTY_CAT_LABEL).map(c => [c, data.duties.filter(d => d.category === c)]).filter(([, l]) => l.length);
    $('#ocDuties', main).innerHTML = byCat.length ? `<div class="duty-cards">${byCat.map(([c, l]) => `<div class="duty-card" data-cat="${c}"><h3>${esc(DUTY_CAT_LABEL[c])}</h3>${l.map(d => `<div class="duty-line"><b>${esc(d.title)}</b><div>${esc(d.person_name)}${d.user ? ` <span class="muted small">${esc([d.user.department, d.user.position].filter(Boolean).join(' · '))}</span>` : ''}${d.deputy_name ? ` <span class="small muted">· 부 ${esc(d.deputy_name)}</span>` : ''}${d.contact ? ` <span class="small">☎ ${esc(d.contact)}</span>` : ''}</div>${d.warn ? `<div class="small err-text">${esc(d.warn)}</div>` : ''}</div>`).join('')}</div>`).join('')}</div>`
      : `<p class="muted small">지정된 담당자가 없습니다.${can ? ' 「지정 담당자」 탭에서 정보보호·소방·안전보건 등 담당자를 지정하세요.' : ''}</p>`;
  };
  draw();
  tools.addEventListener('input', draw); tools.addEventListener('change', draw); tools.onsubmit = e => e.preventDefault();
  main.addEventListener('click', async e => {
    const lb = e.target.closest('[data-oc-layout]'); if (lb) { layout = lb.dataset.ocLayout; try { localStorage.setItem(ocLayoutKey, layout); } catch {} draw(); return; }
    if (e.target.closest('[data-oc-print]')) { const m = rptWindow('조직도', `<div class="oc-chart ${layout} oc-print${$('#ocChart', main).className.replace(/oc-chart|tree|list/g, '')}">${$('#ocChart', main).innerHTML}</div>${rptBlock('지정 담당자', $('#ocDuties', main).innerHTML)}`, { biz_name: data.company }); m.el.querySelector('.rpt-sheet')?.classList.add('rpt-land'); m.el.classList.add('rpt-wide'); return; }
    if (!can) return;
    if (e.target.closest('[data-oc-root]')) {
      const v = await promptBox('회사 · 대표', `<label>회사명<input name="company" maxlength="100" value="${esc(data.company)}"></label><div class="form-grid"><label>대표 직함<input name="ceo_title" maxlength="30" value="${esc(data.ceo_title)}"></label><label>대표(회원)<select name="ceo_user_id"><option value="">회원 아님 · 이름만</option>${users.map(u => `<option value="${u.id}"${data.ceo?.id === u.id ? ' selected' : ''}>${esc(u.name)} ${esc(u.position || '')}</option>`).join('')}</select></label><label>대표 이름(회원 아님)<input name="ceo_name" maxlength="50" value="${esc(data.ceo ? '' : data.ceo_name)}"></label></div>`,
        { submit: vals => api('PUT', '/api/admin/org-chart', vals) });
      if (v) { toast('저장했습니다.'); render(); } return;
    }
    const n = e.target.closest('[data-oc-dept]'); if (!n) return;
    const d = depts.find(x => x.id === Number(n.dataset.ocDept)), mine = byDept(d.name), others = users.filter(u => u.department !== d.name);
    const v = await promptBox(`${d.name} · 조직도`, `<label>부서장<select name="head_user_id"><option value="">미지정</option><optgroup label="이 부서">${mine.map(u => `<option value="${u.id}"${d.head_user_id === u.id ? ' selected' : ''}>${esc(u.name)} ${esc(u.position || '')}</option>`).join('')}</optgroup><optgroup label="다른 부서">${others.map(u => `<option value="${u.id}"${d.head_user_id === u.id ? ' selected' : ''}>${esc(u.name)} · ${esc(u.department || '부서 미지정')}</option>`).join('')}</optgroup></select></label>
      <label>부서 업무(분장) <span class="hint">한 줄에 하나</span><textarea name="duties" rows="5" maxlength="2000" placeholder="예) 구매·자재 관리\n협력업체 평가">${esc(d.duties || '')}</textarea></label><p class="small muted">부서 이름·상위 부서·순서는 「부서·직급」 탭, 구성원의 부서·직급은 「부서·직급」 탭 아래 「구성원 배치」에서 바꿉니다.</p>`,
      { submit: vals => api('PUT', `/api/admin/org-chart/departments/${d.id}`, vals) });
    if (v) { toast('저장했습니다.'); render(); }
  });
  main.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('.oc-node.can')) e.target.click(); });
}
async function pageOrgDuties(main) {
  main.innerHTML = `<h1>조직 구성 <span class="dept">관리</span></h1>
    <p class="muted">정보보호 담당자·개인정보 보호책임자·소방안전관리자·안전보건관리책임자·관리감독자처럼 법령이나 사내 규정으로 따로 맡기는 업무의 <b>담당자(정)·대리자(부)</b>를 지정하고, 별도 담당 업무·법적 근거·선임일·법정교육 기한을 관리합니다. 바뀌면 지우지 않고 「해임·종료」해 선임 이력을 남깁니다. 법적 근거·교육 주기 기본값은 사업장 규모·법령 개정에 따라 다를 수 있으니 확인해 고쳐 쓰세요.</p>
    <div class="ip-tiles" id="dutyTiles"></div>
    <form class="toolbar list-filters" data-read-only id="dutyFilters"><label class="lf-sel">구분<select name="cat"><option value="">전체</option>${Object.entries(DUTY_CAT_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="lf-sel">상태<select name="st"><option value="active">지정 중</option><option value="train">교육 30일 안·지남</option><option value="warn">확인 필요</option><option value="ended">해임·종료</option><option value="">전체</option></select></label><label class="list-search">찾기<input type="search" name="q" placeholder="담당 업무·이름·근거"></label><span class="grow"></span><span id="dutyTools" class="ip-tools"></span></form>
    <div id="dutyList"></div>`;
  const form = $('#dutyFilters', main); let data = { rows: [], users: [], departments: [] };
  const load = async () => { data = await api('GET', '/api/org/duties'); if (main.isConnected) draw(); };
  main.qReload = () => load().catch(fail);
  const draw = () => {
    const v = formObj(form), q = (v.q || '').trim().toLowerCase(), act = data.rows.filter(d => d.active);
    qTiles('dutyTiles', [['지정 중', act.length], ['법정교육 30일 안', act.filter(d => d.train === 'soon').length, act.some(d => d.train === 'soon') ? 'yellow' : ''], ['법정교육 지남', act.filter(d => d.train === 'over').length, act.some(d => d.train === 'over') ? 'red' : ''], ['확인 필요', act.filter(d => d.warn).length, act.some(d => d.warn) ? 'red' : ''], ...(data.can_manage ? [['해임·종료', data.rows.filter(d => !d.active).length]] : [])]);
    $('#dutyTools', main).innerHTML = (data.can_manage ? '<button type="button" class="btn primary" data-duty-new>＋ 담당자 지정</button>' : '') + '<button type="button" class="btn" data-duty-print>지정 현황 인쇄</button><a class="btn" href="#/admin/org/chart">조직도</a>';
    const rows = data.rows.filter(d => (!v.cat || d.category === v.cat) && (v.st === 'active' ? d.active : v.st === 'train' ? d.active && ['soon', 'over'].includes(d.train) : v.st === 'warn' ? d.active && !!d.warn : v.st === 'ended' ? !d.active : true) && (!q || [d.title, d.person_name, d.deputy_name, d.legal_basis, d.scope, d.tasks].join(' ').toLowerCase().includes(q)));
    $('#dutyList', main).innerHTML = rows.length ? `<div class="table-wrap"><table class="grid ip-table"><thead><tr><th>구분</th><th>담당 업무</th><th>담당자(정)</th><th>대리자(부)</th><th>범위</th><th>선임일</th><th>법정교육 기한</th><th>상태</th><th></th></tr></thead><tbody>${rows.map(d => `<tr class="${!d.active ? 'row-off' : d.train === 'over' || d.warn ? 'ip-over' : ''}"><td class="nowrap">${dutyBadge(d)}<div class="small muted">${esc(d.category_label)}</div></td><td data-card-primary><b>${esc(d.title)}</b>${d.legal_basis ? `<div class="small muted">${esc(d.legal_basis)}</div>` : ''}</td><td>${esc(d.person_name)}${d.user ? `<div class="small muted">${esc([d.user.department, d.user.position].filter(Boolean).join(' · '))}</div>` : '<div class="small muted">외부·비회원</div>'}</td><td>${esc(d.deputy_name || '')}</td><td>${esc(d.scope || '전사')}</td><td class="nowrap">${esc(d.appointed_date || '')}${d.report_date ? `<div class="small muted">신고 ${esc(d.report_date)}</div>` : ''}</td><td class="nowrap">${dutyTrainChip(d)}</td><td class="nowrap">${d.active ? '<span class="chip green">지정 중</span>' : `<span class="chip">종료 ${esc(d.end_date || '')}</span>`}${d.warn ? `<div class="small err-text">${esc(d.warn)}</div>` : ''}</td><td><button type="button" class="btn small" data-duty-open="${d.id}">열기</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${data.rows.length ? '조건에 맞는 담당자가 없습니다.' : `지정된 담당자가 없습니다.${data.can_manage ? ' 「＋ 담당자 지정」에서 정보보호·소방·안전보건 등 종류를 고르면 법적 근거와 기본 업무가 채워집니다.' : ''}`}</div>`;
  };
  main.addEventListener('click', e => {
    if (e.target.closest('[data-duty-new]')) return dutyOpen(null, data).catch(fail);
    const o = e.target.closest('[data-duty-open]'); if (o) return dutyOpen(data.rows.find(d => d.id === Number(o.dataset.dutyOpen)), data).catch(fail);
    if (e.target.closest('[data-duty-print]')) dutyListPrint(data.rows.filter(d => d.active)).catch(fail);
  });
  form.addEventListener('input', draw); form.addEventListener('change', draw); form.onsubmit = e => e.preventDefault();
  await load();
}
async function dutyOpen(d, list) {
  const can = list.can_manage, dis = can ? '' : ' disabled', v0 = d || { duty_key: '', category: 'etc', training_cycle: 0, active: true, scope: '전사' };
  const userOpts = (sel, name) => `<option value="">${name ? '—' : '고르세요'}</option>${list.users.map(u => `<option value="${u.id}"${sel === u.id ? ' selected' : ''}>${esc(u.name)}${u.department || u.position ? ` · ${esc([u.department, u.position].filter(Boolean).join(' '))}` : ''}</option>`).join('')}<option value="ext"${!sel && name ? ' selected' : ''}>외부·비회원(이름 직접 입력)</option>`;
  const m = modal(`<h3>${d ? `${esc(d.title)} ${d.active ? '<span class="chip green">지정 중</span>' : '<span class="chip">해임·종료</span>'}` : '담당자 지정'}</h3>
    <form class="stack" data-duty-form>
      <div class="form-grid">
        ${can ? `<label>지정 종류<select name="duty_key">${DUTY_PRESETS.map(p => `<option value="${p.key}"${(v0.duty_key || '') === p.key ? ' selected' : ''}>${p.key === 'custom' ? '직접 입력' : esc(p.title)}</option>`).join('')}${!d ? '' : ''}</select></label>` : ''}
        <label class="${can ? '' : 'span2'}">담당 업무명 *<input name="title" required maxlength="60" value="${esc(v0.title || '')}"${dis}></label>
        <label>구분<select name="category"${dis}>${Object.entries(DUTY_CAT_LABEL).map(([k, l]) => `<option value="${k}"${v0.category === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>담당자(정) *<select name="user_sel"${dis}>${userOpts(v0.user_id, v0.person_name)}</select></label>
        <label data-ext="user">외부 담당자 이름<input name="person_name" maxlength="50" value="${esc(v0.user_id ? '' : v0.person_name || '')}" placeholder="예) (주)○○안전대행 홍길동"${dis}></label>
        <label>대리자(부)<select name="deputy_sel"${dis}>${userOpts(v0.deputy_user_id, v0.deputy_name).replace('고르세요', '없음')}</select></label>
        <label data-ext="deputy">외부 대리자 이름<input name="deputy_name" maxlength="50" value="${esc(v0.deputy_user_id ? '' : v0.deputy_name || '')}"${dis}></label>
        <label>범위<select name="scope"${dis}><option value="전사">전사</option>${list.departments.map(x => `<option${v0.scope === x.name ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}${v0.scope && v0.scope !== '전사' && !list.departments.some(x => x.name === v0.scope) ? `<option selected>${esc(v0.scope)}</option>` : ''}</select></label>
        <label>연락처<input name="contact" maxlength="60" value="${esc(v0.contact || '')}" placeholder="내선·휴대폰"${dis}></label>
        <label>선임(지정)일<input type="date" name="appointed_date" value="${esc(v0.appointed_date || '')}"${dis}></label>
        <label>선임 신고일<input type="date" name="report_date" value="${esc(v0.report_date || '')}"${dis}><span class="hint">관할 기관에 신고하는 업무만</span></label>
        <label class="span2">법적 근거<input name="legal_basis" maxlength="200" value="${esc(v0.legal_basis || '')}"${dis}></label>
        <label>자격·면허<input name="qualification" maxlength="200" value="${esc(v0.qualification || '')}" placeholder="예) 소방안전관리자 2급"${dis}></label>
        <label>법정교육 주기(개월)<input type="number" name="training_cycle" min="0" max="120" value="${esc(v0.training_cycle ?? 0)}"${dis}><span class="hint">0 = 관리 안 함</span></label>
        <label>최근 교육 이수일<input type="date" name="last_training" value="${esc(v0.last_training || '')}" max="${todayStr()}"${dis}></label>
        <label>다음 교육 기한<input type="date" name="next_training" value="${esc(v0.next_training || '')}"${dis}><span class="hint">비우면 (최근 교육일 또는 선임일) + 주기</span></label>
        <label class="span3">별도 담당 업무 <span class="hint">한 줄에 하나</span><textarea name="tasks" rows="6" maxlength="3000"${dis}>${esc(v0.tasks || '')}</textarea></label>
        <label class="span3">비고<input name="note" maxlength="1000" value="${esc(v0.note || '')}"${dis}></label>
      </div>
      ${d?.warn ? `<p class="small err-text">${esc(d.warn)}</p>` : ''}
      <div class="actions">${d ? '<button type="button" class="btn" data-duty-hist>이력</button><button type="button" class="btn" data-duty-letter>지정서 인쇄</button>' : ''}${d && can && d.active ? '<button type="button" class="btn danger" data-duty-end>해임·종료</button>' : ''}${d && can && !d.active ? '<button type="button" class="btn" data-duty-reopen>다시 지정</button><button type="button" class="btn danger" data-duty-del>삭제</button>' : ''}${d && can && d.active && (!d.appointed_date || d.appointed_date >= todayStr()) ? '<button type="button" class="btn danger" data-duty-del>삭제</button>' : ''}<span class="grow"></span>${can ? `<button type="button" class="btn small" data-duty-tasks>기본 업무 넣기</button><button class="btn primary">${d ? '저장' : '지정'}</button>` : ''}</div>
    </form>`, { wide: true });
  const form = $('[data-duty-form]', m.el), el = form.elements;
  const ext = () => { $('[data-ext="user"]', form).hidden = el.user_sel.value !== 'ext'; $('[data-ext="deputy"]', form).hidden = el.deputy_sel.value !== 'ext'; }; ext();
  form.addEventListener('change', ext);
  const addM = (dt, n) => { if (!dt || !n) return ''; const [y, mo, dd] = dt.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1 + n, dd)); if (t.getUTCDate() !== dd) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
  const recalc = () => { const n = Number(el.training_cycle.value) || 0; el.next_training.value = n ? addM(el.last_training.value || el.appointed_date.value, n) : ''; };
  ['training_cycle', 'last_training', 'appointed_date'].forEach(k => el[k].addEventListener('change', recalc));
  el.duty_key?.addEventListener('change', () => {
    const p = DUTY_PRESETS.find(x => x.key === el.duty_key.value); if (!p || p.key === 'custom') return;
    el.title.value = p.title; el.category.value = p.cat; el.legal_basis.value = p.basis; el.training_cycle.value = p.cycle || 0; if (!el.tasks.value.trim()) el.tasks.value = p.tasks; recalc();
  });
  $('[data-duty-tasks]', form)?.addEventListener('click', () => { const p = DUTY_PRESETS.find(x => x.key === el.duty_key?.value); if (!p?.tasks) return toast('지정 종류를 고르면 그 업무의 기본 업무를 넣습니다.', 'err'); const have = el.tasks.value.split('\n').map(x => x.trim()); el.tasks.value = [...have.filter(Boolean), ...p.tasks.split('\n').filter(x => !have.includes(x))].join('\n'); });
  const body = () => { const v = formObj(form); const pick = (sel, name) => sel === 'ext' ? [null, name] : [sel ? Number(sel) : null, '']; const [user_id, person_name] = pick(v.user_sel, v.person_name), [deputy_user_id, deputy_name] = pick(v.deputy_sel, v.deputy_name); delete v.user_sel; delete v.deputy_sel; return { ...v, user_id, person_name, deputy_user_id, deputy_name, scope: v.scope === '전사' ? '' : v.scope }; };
  const done = (msg) => { toast(msg); m.close(); qReload(); };
  form.onsubmit = async e => { e.preventDefault(); try { d ? await api('PUT', `/api/admin/org-duties/${d.id}`, { ...body(), revision: d.revision }) : await api('POST', '/api/admin/org-duties', { ...body(), request_id: crypto.randomUUID() }); done(d ? '저장했습니다.' : `${el.title.value} 담당자를 지정했습니다.`); } catch (err) { fail(err); } };
  $('[data-duty-end]', m.el)?.addEventListener('click', async () => { const v = await promptBox('해임·종료', `<p class="small muted">기록은 남고 조직도·현황에서 빠집니다. 후임을 지정하려면 종료 뒤 「＋ 담당자 지정」을 하세요.</p><label>종료일 *<input type="date" name="end_date" required value="${todayStr()}"></label>`); if (!v) return; try { await api('PUT', `/api/admin/org-duties/${d.id}`, { active: false, end_date: v.end_date, revision: d.revision }); done('해임·종료했습니다.'); } catch (err) { fail(err); } });
  $('[data-duty-reopen]', m.el)?.addEventListener('click', async () => { try { await api('PUT', `/api/admin/org-duties/${d.id}`, { active: true, end_date: '', revision: d.revision }); done('다시 지정했습니다.'); } catch (err) { fail(err); } });
  $$('[data-duty-del]', m.el).forEach(b => b.addEventListener('click', async () => { if (!await confirmBox('이 기록을 지울까요? 선임 이력이 필요하면 지우지 말고 「해임·종료」로 두세요.')) return; try { await api('DELETE', `/api/admin/org-duties/${d.id}?revision=${d.revision}`); done('지웠습니다.'); } catch (err) { fail(err); } }));
  $('[data-duty-hist]', m.el)?.addEventListener('click', () => qHistory(d.title, d.history, {}));
  $('[data-duty-letter]', m.el)?.addEventListener('click', () => dutyLetter(d).catch(fail));
}
async function dutyLetter(d) {
  const co = await rptCompany(), org = await api('GET', '/api/org/chart').catch(() => ({}));
  const who = d.user ? `${[d.user.department, d.user.position].filter(Boolean).join(' · ')}` : '외부·비회원';
  rptWindow('담당자 지정서', rptRow([[['담당 업무', d.title], ['구분', DUTY_CAT_LABEL[d.category] || d.category]], [['성명', d.person_name], ['소속 · 직급', who]], [['대리자(부)', d.deputy_name], ['범위', d.scope || '전사']], [['선임(지정)일', d.appointed_date], ['선임 신고일', d.report_date]], [['법적 근거', d.legal_basis], ['자격·면허', d.qualification]], [['법정교육 주기', d.training_cycle ? `${d.training_cycle}개월` : ''], ['다음 교육 기한', d.next_training]]])
    + rptBlock('별도 담당 업무', dutyTasksHtml(d.tasks)) + (d.note ? rptBlock('비고', rptText(d.note)) : '')
    + `<p class="rpt-text duty-decl">위 사람을 <b>${esc(d.title)}</b>(으)로 지정하고, 위 업무를 맡깁니다.</p><p class="rpt-text duty-decl">${esc(d.appointed_date || todayStr())}</p><p class="rpt-text duty-decl">${esc(org.company || co.biz_name || '')} ${esc(org.ceo_title || '대표이사')} ${esc(org.ceo_name || co.ceo || '')} (인)</p>`
    + '<div class="rpt-sign"><span>담당자 확인</span><span>대리자 확인</span><span>지정권자</span></div>', co);
}
async function dutyListPrint(rows) {
  const co = await rptCompany();
  rptWindow('지정 담당자 현황', `<table class="rpt-list"><thead><tr><th>No</th><th>구분</th><th>담당 업무</th><th>담당자(정)</th><th>대리자(부)</th><th>범위</th><th>선임일</th><th>법적 근거</th><th>다음 교육</th><th>연락처</th></tr></thead><tbody>${rows.map((d, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(DUTY_CAT_LABEL[d.category] || '')}</td><td>${esc(d.title)}</td><td>${esc(d.person_name)}</td><td>${esc(d.deputy_name || '')}</td><td>${esc(d.scope || '전사')}</td><td class="c">${esc(d.appointed_date || '')}</td><td>${esc(d.legal_basis || '')}</td><td class="c">${esc(d.next_training || '')}</td><td>${esc(d.contact || '')}</td></tr>`).join('')}</tbody></table>`, co)
    .el.classList.add('rpt-wide');
}
// 내 정보: 본인이 정·부로 지정된 업무
async function meDutiesCard(box) {
  try {
    const rows = (await api('GET', '/api/org/duties')).rows.filter(d => d.active && (d.user_id === ME.id || d.deputy_user_id === ME.id)); if (!box.isConnected) return;
    box.innerHTML = `<h3>지정 담당 업무</h3>${rows.length ? rows.map(d => `<div class="duty-line">${dutyBadge(d, d.user_id !== ME.id)} <b>${esc(d.title)}</b>${d.user_id !== ME.id ? ' <span class="small muted">(대리자)</span>' : ''}${d.next_training ? ` <span class="small">· 다음 법정교육 ${dutyTrainChip(d)}</span>` : ''}${dutyTasksHtml(d.tasks)}</div>`).join('') : '<p class="small muted">지정된 담당 업무가 없습니다.</p>'}<div class="actions" style="justify-content:flex-start"><a class="btn" href="#/admin/org/chart">조직도 보기</a><a class="btn" href="#/admin/org/duties">지정 담당자 현황</a></div>`;
  } catch { box.remove(); }
}
