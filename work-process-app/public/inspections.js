const INSPECTION_RESULT = {unconfigured:'규격 미지정',pending:'검사 대기',pass:'합격',fail:'불합격'};
const INSPECTION_CATEGORIES = ['원자재','부자재','반제품','제품','상품'];
const inspectionBadge = result => `<span class="chip ${result==='pass'?'green':result==='fail'?'red':'yellow'}">${INSPECTION_RESULT[result] || '검사 대기'}</span>`;
const inspectionRange = item => `${item.min===null?'':item.min+' ≤ '}${item.name}${item.max===null?'':' ≤ '+item.max} (${item.unit})`;
function inspectionPreview(spec, rows) {
  let missing=!rows.length,failed=false;
  for(const row of rows) for(const item of spec.items) for(const v of row.values[item.key] || []) {
    if(v===null||v===''||(typeof v==='string'&&!v.trim())) missing=true;
    else if(!Number.isFinite(Number(v))||(item.min!==null&&Number(v)<item.min)||(item.max!==null&&Number(v)>item.max)) failed=true;
  }
  return failed?'fail':missing?'pending':'pass';
}
function inspectionMatrix(spec, rows) {
  return rows.map(row=>`<div class="card"><h4>${esc(row.lot)}</h4><div class="table-wrap"><table class="grid keep-table"><thead><tr><th>항목 · 규격</th><th>측정값</th><th>평균 (참고)</th></tr></thead><tbody>${spec.items.map(item=>{
    const values=row.values[item.key]||[], numeric=values.filter(v=>v!==null&&v!=='').map(Number);
    return `<tr><th>${esc(inspectionRange(item))}</th><td>${values.map(v=>v===null||v===''?'미입력':`<span class="${(item.min!==null&&v<item.min)||(item.max!==null&&v>item.max)?'red-text':''}">${esc(v)}</span>`).join(' / ')}</td><td>${numeric.length?fmtNum(Math.round(numeric.reduce((a,b)=>a+b,0)/numeric.length*1000)/1000):'—'}</td></tr>`;
  }).join('')}</tbody></table></div></div>`).join('');
}
async function pageInspectionSpecs(main) {
  const data=await api('GET','/api/inspection-specs'); if(!main.isConnected)return;
  main.innerHTML=`<h1>검사규격 설정</h1><p class="muted">품목과 카테고리별 수입·출하 검사 기준입니다. 품질팀장이 설정하고 품질팀원이 측정값을 입력합니다. 변경한 규격은 새 의뢰부터 적용됩니다.</p>${data.can_manage?'<div class="actions wrap"><button class="btn primary" id="specNew">규격 등록</button><button class="btn" data-template="wiper">천와이퍼 흡수속도 예시</button><button class="btn" data-template="glove">심리스글러브 박리강도 예시</button></div>':'<p class="small muted">규격 변경 권한은 품질팀장과 관리자에게 있습니다.</p>'}<div class="table-wrap"><table class="grid"><thead><tr><th>검사</th><th>카테고리</th><th>품명 · 별칭</th><th>검사 항목</th><th>버전 · 사용</th><th></th></tr></thead><tbody>${data.specs.map(s=>`<tr><td>${esc(s.kind)}</td><td>${esc(s.item_category)}</td><td><b>${esc(s.product)}</b><div class="small muted">${s.aliases.map(esc).join(' · ')}</div></td><td>${s.items.map(i=>`${esc(inspectionRange(i))} · ${i.count}회`).join('<br>')}</td><td>규격 ${s.revision} · ${s.active?'사용':'중지'}</td><td>${data.can_manage?`<button class="btn small" data-edit-spec="${s.id}">수정</button>`:''}</td></tr>`).join('')}</tbody></table></div>${data.specs.length?'':'<div class="empty">등록된 검사규격이 없습니다. 품질팀장이 먼저 등록해주세요.</div>'}`;
  if(!data.can_manage)return;
  $('#specNew',main).onclick=()=>editInspectionSpec(null,()=>pageInspectionSpecs(main));
  $$('[data-edit-spec]',main).forEach(b=>b.onclick=()=>editInspectionSpec(data.specs.find(s=>s.id===Number(b.dataset.editSpec)),()=>pageInspectionSpecs(main)));
  $$('[data-template]',main).forEach(b=>b.onclick=()=>editInspectionSpec(b.dataset.template==='wiper'?{kind:'수입검사',item_category:'원자재',product:'천와이퍼 NX-7 원단',aliases:['NX-7','NX-707D','NX-707','천와이퍼(nx-7)원단'],items:[{name:'흡수속도 MD',unit:'초',min:0,max:60,count:5},{name:'흡수속도 CD',unit:'초',min:0,max:60,count:5}]}:{kind:'수입검사',item_category:'원자재',product:'스무드 심리스글러브 HD-08p 원단',aliases:['HD-08p','Coolove','스무드 심리스글러브(HD-08p)원단'],items:[{name:'박리강도',unit:'kgf',min:3,max:null,count:5}]},()=>pageInspectionSpecs(main)));
}
function editInspectionSpec(spec,done) {
  const s=spec||{kind:'수입검사',item_category:'원자재',product:'',aliases:[],items:[]};
  const m=modal(`<h3>${s.id?'검사규격 수정':'검사규격 등록'}</h3><p class="small muted">합격은 모든 측정값이 하한·상한을 충족할 때입니다. 경계값은 포함합니다. 별칭에는 실제 등록된 품명이나 제품코드를 적으세요(공백·영문 대소문자 무시). 예시의 측정 횟수는 팀장이 확인 후 저장하세요.</p><form class="stack"><div class="form-grid"><label>검사 구분<select name="kind">${['수입검사','출하검사'].map(v=>`<option ${s.kind===v?'selected':''}>${v}</option>`).join('')}</select></label><label>카테고리<select name="item_category">${INSPECTION_CATEGORIES.map(v=>`<option ${s.item_category===v?'selected':''}>${v}</option>`).join('')}</select></label><label>품명 *<input name="product" maxlength="200" value="${esc(s.product)}" required></label></div><label>품명·제품코드 별칭 (한 줄에 하나)<textarea name="aliases" rows="3">${esc(s.aliases.join('\n'))}</textarea></label><div data-spec-items></div><button type="button" class="btn" data-add>검사 항목 추가</button><label class="inline"><input type="checkbox" name="active" ${s.active!==false?'checked':''}>사용</label><button class="btn primary">규격 저장</button></form>`,{wide:true});
  const form=$('form',m.el),root=$('[data-spec-items]',form);
  const add=(item={name:'',unit:'',min:null,max:null,count:1})=>{
    if(root.children.length>=20)return toast('검사 항목은 최대 20개입니다.','err');
    const row=document.createElement('fieldset');row.className='inspection-spec-row';row.innerHTML=`<div class="form-grid"><label>항목명 *<input data-k="name" required maxlength="100" value="${esc(item.name)}"></label><label>단위 *<input data-k="unit" required maxlength="30" value="${esc(item.unit)}"></label><label>측정 횟수 *<input data-k="count" type="number" required min="1" max="20" step="1" value="${item.count}"></label><label>하한 (이상)<input data-k="min" type="number" step="any" value="${esc(item.min??'')}"></label><label>상한 (이하)<input data-k="max" type="number" step="any" value="${esc(item.max??'')}"></label></div><button type="button" class="btn small danger" data-remove>항목 제거</button>`;root.append(row);$('[data-remove]',row).onclick=()=>row.remove();
  };
  (s.items.length?s.items:[undefined]).forEach(add);$('[data-add]',form).onclick=()=>add();
  let busy=false;form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;form.inert=true;try{const body={...formObj(form),active:form.elements.active.checked,aliases:form.elements.aliases.value.split('\n').map(x=>x.trim()).filter(Boolean),items:[...root.children].map(row=>Object.fromEntries($$('[data-k]',row).map(el=>[el.dataset.k,el.value]))),revision:s.revision};await api(s.id?'PUT':'POST','/api/inspection-specs'+(s.id?'/'+s.id:''),body);m.close();toast('검사규격을 저장했습니다.');await done();}catch(error){fail(error);}finally{busy=false;form.inert=false;}};
}
async function pageInspections(main) {
  main.innerHTML=`<h1>수입·출하 검사 이력</h1><p class="muted">카테고리별 검사 내역과 품명·LOT를 검색하세요. 합격·불합격은 평균이 아닌 모든 측정값으로 판정합니다.</p>${listControls('inspection',{dateLabel:'의뢰',placeholder:'품명·제품코드 별칭·LOT·거래처',extra:`<label>검사 구분<select name="kind"><option value="">전체</option><option>수입검사</option><option>출하검사</option></select></label><label>카테고리<select name="item_category"><option value="">전체</option>${[...INSPECTION_CATEGORIES,'미분류'].map(c=>`<option>${c}</option>`).join('')}</select></label><label>판정<select name="result"><option value="">전체</option>${Object.entries(INSPECTION_RESULT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>`})}<div id="inspectionList"></div><button class="btn" id="inspectionMore" hidden>더 보기</button>`;
  const form=$('#inspectionFilters',main),more=$('#inspectionMore',main);let version=0,rows=[],next=null,busy=false;
  const draw=()=>{
    $('#inspectionList',main).innerHTML=rows.length?`<div class="table-wrap"><table class="grid"><thead><tr><th>의뢰일 · 번호</th><th>검사</th><th>카테고리</th><th>품명 · LOT</th><th>거래처</th><th>판정</th><th>입력자 · 검사일</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.created_at.slice(0,10))}<br>${esc(r.req_no||'접수대기')}</td><td>${esc(r.category)}</td><td>${esc(r.item_category||'미분류')}</td><td><b>${esc(r.title)}</b><div class="small muted">${esc(r.lot||'')}</div></td><td>${esc(r.customer)}</td><td>${inspectionBadge(r.result)}<div class="small muted">${esc(STATUS[r.status])}</div></td><td>${esc(r.updated_by||'—')}<br>${esc(r.updated_at||'')}</td><td><button class="btn small" data-inspection="${r.id}">검사 열기</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 검사 의뢰가 없습니다.</div>';
    listCount(form,rows.length);more.hidden=!next;$$('[data-inspection]',main).forEach(b=>b.onclick=()=>openInspection(Number(b.dataset.inspection),()=>load()).catch(fail));
  };
  const load=async(append=false)=>{
    if(append&&busy)return;const own=++version;busy=true;more.disabled=true;listLoading(form);
    try{const data=await api('GET','/api/inspections?'+new URLSearchParams({...formObj(form),...(append&&next?{before:next}:{})}));if(own!==version||!main.isConnected)return;rows=append?[...rows,...data.rows]:data.rows;next=data.next;draw();}
    finally{if(own===version){busy=false;more.disabled=false;}}
  };
  more.onclick=()=>load(true).catch(fail);bindListControls(form,()=>load());await load();
}
async function openInspection(id,done=()=>{}) {
  const data=await api('GET',`/api/requests/${id}/inspection`),{request:r,spec,measurement}=data;
  if(!spec){
    const choices=data.can_manage?(await api('GET','/api/inspection-specs')).specs.filter(s=>s.active&&s.kind===r.category&&(!r.data.item_category||r.data.item_category===s.item_category)):[];
    const m=modal(`<h3>${esc(r.title)} · ${esc(r.category)}</h3><p>검사규격이 아직 지정되지 않았습니다. 품질팀장이 규격을 등록하고 적용해주세요.</p>${data.can_manage?`<form class="stack"><label>적용할 규격<select name="spec_id" required><option value="">규격 선택</option>${choices.map(s=>`<option value="${s.id}">${esc(s.item_category)} · ${esc(s.product)} · 규격 ${s.revision}</option>`).join('')}</select></label><p class="small muted">적용한 규격은 이 검사에 고정되며 이후 규격 설정을 바꿔도 유지됩니다.</p><button class="btn primary">규격 적용</button></form><a href="#/quality/specs" data-spec-link>검사규격 설정으로 이동</a>`:''}`);
    if(data.can_manage){$('[data-spec-link]',m.el).onclick=m.close;const form=$('form',m.el);let busy=false;form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;form.inert=true;try{await api('POST',`/api/requests/${id}/inspection/spec`,formObj(form));m.close();await openInspection(id,done);}catch(error){fail(error);}finally{busy=false;form.inert=false;}};}return;
  }
  const m=modal(`<h3>${esc(r.title)} · ${esc(r.category)}</h3><p>${esc(spec.item_category)} · 적용 품목 ${esc(spec.product)} · 규격 ${spec.revision}</p><p class="small muted">모든 값이 규격 이내면 합격, 하나라도 벗어나면 불합격입니다. 빈 칸이 남고 규격 이탈이 없으면 검사 대기입니다. 평균은 참고용입니다.</p>${!data.can_write?'<p class="muted">승인된 의뢰에서 품질 담당자만 측정값을 입력할 수 있습니다.</p>':''}<form class="stack"><div data-measure-rows></div>${data.can_write?'<button type="button" class="btn" data-add-sample>LOT / 시료 추가</button><label>수정 사유 (판정된 결과 수정 시 필수)<input name="reason" maxlength="500"></label>':''}<div data-verdict role="status"></div>${data.can_write?'<button class="btn primary">측정값 저장 · 자동 판정</button>':''}</form><details class="card"><summary>저장 이력 (${data.history.length}건 표시)</summary>${data.history.map(h=>`<p><button class="btn small" data-history="${h.id}">기록 ${h.revision} · ${INSPECTION_RESULT[h.result]}</button> ${esc(h.saved_by)} · ${esc(h.saved_at)} ${esc(h.reason)}</p>`).join('')||'<p>저장 이력이 없습니다.</p>'}</details>`,{wide:true});
  const form=$('form',m.el),root=$('[data-measure-rows]',form);
  const read=()=>[...root.children].map(row=>({lot:$('[data-lot]',row).value,values:Object.fromEntries(spec.items.map(item=>[item.key,$$(`[data-item="${item.key}"]`,row).map(el=>el.value)]))}));
  const update=()=>{
    const rows=read();$('[data-verdict]',form).innerHTML=inspectionBadge(inspectionPreview(spec,rows))+` <span class="small muted">${data.can_write?'저장 전 미리보기':'저장된 판정'}</span>`;
    [...root.children].forEach((row,index)=>spec.items.forEach(item=>{const values=rows[index].values[item.key].filter(v=>v!=='').map(Number);$(`[data-average="${item.key}"]`,row).textContent=values.length?fmtNum(Math.round(values.reduce((a,b)=>a+b,0)/values.length*1000)/1000):'—';$$(`[data-item="${item.key}"]`,row).forEach(el=>el.classList.toggle('inspection-outside',el.value!==''&&((item.min!==null&&Number(el.value)<item.min)||(item.max!==null&&Number(el.value)>item.max))));}));
  };
  const add=(value={lot:r.lot||r.data.lot_etc||'시료 '+(root.children.length+1),values:{}})=>{
    if(root.children.length>=30)return toast('LOT·시료는 최대 30행입니다.','err');
    const row=document.createElement('fieldset');row.className='inspection-sample';row.innerHTML=`<label>LOT / 시료명 *<input data-lot required maxlength="100" value="${esc(value.lot)}" ${data.can_write?'':'readonly'}></label>${spec.items.map(item=>`<div class="inspection-measure"><b>${esc(inspectionRange(item))}</b><div class="inspection-values">${Array.from({length:item.count},(_,i)=>`<label>#${i+1}<input type="number" step="any" data-item="${item.key}" aria-label="${esc(item.name)} ${i+1}회" value="${esc(value.values[item.key]?.[i]??'')}" ${data.can_write?'':'readonly'}></label>`).join('')}</div><p class="small muted">평균 (참고): <span data-average="${item.key}"></span> ${esc(item.unit)}</p></div>`).join('')}${data.can_write?'<button type="button" class="btn small danger" data-remove-sample>시료 행 제거</button>':''}`;root.append(row);if(data.can_write)$('[data-remove-sample]',row).onclick=()=>{if(root.children.length===1)return toast('시료 행은 1개 이상 필요합니다.','err');row.remove();update();};update();
  };
  (measurement?.values||[undefined]).forEach(add);form.addEventListener('input',update);
  $$('[data-history]',m.el).forEach(b=>b.onclick=async()=>{try{const h=await api('GET',`/api/requests/${id}/inspection/history/${b.dataset.history}`);modal(`<h3>검사 기록 ${h.revision}</h3><p>${inspectionBadge(h.result)} ${esc(h.saved_by)} · ${esc(h.saved_at)}</p>${inspectionMatrix(spec,h.values)}`,{wide:true});}catch(error){fail(error);}});
  if(!data.can_write)return;
  $('[data-add-sample]',form).onclick=()=>add();
  const draft=bindEntryDraft(form,`inspection:${id}:${measurement?.revision||0}`,{read:()=>({rows:read(),reason:form.elements.reason.value}),restore:value=>{root.replaceChildren();value.rows.forEach(add);form.elements.reason.value=value.reason||'';update();}});
  let busy=false;form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;form.inert=true;draft.start();let committed=false;try{const saved=await api('PUT',`/api/requests/${id}/inspection`,{rows:read(),revision:measurement?.revision||0,reason:form.elements.reason.value});committed=true;draft.clear();m.close();toast('저장 완료 · '+INSPECTION_RESULT[saved.result]);Promise.resolve(done()).catch(fail);await openInspection(id,done);}catch(error){if(!committed)draft.failure();fail(committed?new Error('검사 결과는 저장되었습니다. 다시 조회해주세요. '+error.message):error);}finally{busy=false;form.inert=false;}};
}
