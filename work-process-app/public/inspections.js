const INSPECTION_RESULT = {unconfigured:'규격 미지정',pending:'검사 대기',pass:'합격',fail:'불합격',exempt:'검사 제외'};
const INSPECTION_CATEGORIES = ['원자재','부자재','반제품','제품','상품'];
const qualityInspectionBadge = result => `<span class="chip ${result==='pass'?'green':result==='fail'?'red':result==='exempt'?'':'yellow'}">${INSPECTION_RESULT[result] || '검사 대기'}</span>`;
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
// 검사규격 등록·수정 폼 (15.35): 기본 정보 → 검사 항목(항목명·단위 → 합격 범위 → 측정 횟수) 순서, 필수/선택 표시,
// 항목 옆 오류 안내(해결 방법 포함), 저장 중·저장됨·오류 상태, 키보드 조작. 보내는 값(name/data-k)과 API 호출은 그대로다.
function inspectionSpecCheck(form, root) {
  const errors = [], num = v => v === '' || Number.isFinite(Number(v));
  const product = form.elements.product;
  if (!product.value.trim()) errors.push([product, '품명을 입력하세요. 예: 천와이퍼 NX-7 원단']);
  const aliases = form.elements.aliases.value.split('\n').map(x => x.trim()).filter(Boolean);
  if (aliases.length > 20) errors.push([form.elements.aliases, `별칭이 ${aliases.length}개입니다. 20개 이하로 줄여주세요.`]);
  else if (aliases.some(a => a.length > 200)) errors.push([form.elements.aliases, '별칭 한 줄은 200자 이하로 입력하세요.']);
  const rows = [...root.children];
  if (!rows.length) errors.push([$('[data-add]', form), '검사 항목이 없습니다. 「항목 추가」를 눌러 1개 이상 추가하세요.']);
  let total = 0;
  rows.forEach(row => {
    const f = k => $(`[data-k="${k}"]`, row), name = f('name'), unit = f('unit'), count = f('count'), min = f('min'), max = f('max');
    if (!name.value.trim()) errors.push([name, '항목명을 입력하세요. 예: 흡수속도 MD']);
    if (!unit.value.trim()) errors.push([unit, '단위를 입력하세요. 예: 초, kgf, mm']);
    const c = Number(count.value);
    if (!Number.isInteger(c) || c < 1 || c > 20) errors.push([count, '측정 횟수는 1~20 사이의 정수로 입력하세요.']); else total += c;
    if (!num(min.value)) errors.push([min, '하한은 숫자로 입력하세요. 예: 0 또는 3.5']);
    if (!num(max.value)) errors.push([max, '상한은 숫자로 입력하세요. 예: 60']);
    if (num(min.value) && num(max.value)) {
      if (min.value === '' && max.value === '') errors.push([min, '하한이나 상한 중 하나 이상을 입력하세요. 예: 박리강도는 하한 3만 입력']);
      else if (min.value !== '' && max.value !== '' && Number(min.value) > Number(max.value)) errors.push([max, `상한(${max.value})이 하한(${min.value})보다 작습니다. 두 값을 바꾸거나 다시 입력하세요.`]);
    }
  });
  if (total > 100) errors.push([$('[data-add]', form), `시료 1개당 측정 칸이 ${total}개입니다. 측정 횟수 합계를 100 이하로 줄여주세요.`]);
  return errors;
}
// 서버가 돌려준 오류를 해당 항목 옆에 붙인다. 대응 항목이 없으면 저장 버튼 근처에 표시한다.
function inspectionSpecServerError(form, root, error) {
  const msg = error.message || String(error), first = k => $(`[data-k="${k}"]`, root);
  if (error.status === 409 && /이미 등록된/.test(msg)) return [[form.elements.aliases, msg + ' 다른 품명·별칭을 쓰거나 기존 규격을 수정하세요.']];
  if (error.status === 409) return [[null, msg + ' 입력한 내용은 그대로 있으니, 내용을 복사해 두고 창을 닫은 뒤 다시 열어 반영하세요.']];
  if (/품명/.test(msg)) return [[form.elements.product, msg]];
  if (/별칭/.test(msg)) return [[form.elements.aliases, msg]];
  if (/측정 횟수|측정 칸/.test(msg)) return [[first('count'), msg]];
  if (/하한|상한|규격은 숫자/.test(msg)) return [[first('min'), msg]];
  if (/단위/.test(msg)) return [[first('unit'), msg]];
  if (/검사 항목/.test(msg)) return [[first('name') || $('[data-add]', form), msg]];
  if (!error.status) return [[null, '서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 저장하세요. 입력한 내용은 그대로 있습니다.']];
  if (error.status >= 500) return [[null, `서버 오류로 저장하지 못했습니다(${error.status}). 잠시 후 다시 저장하고, 계속되면 관리자에게 알려주세요. 입력한 내용은 그대로 있습니다.`]];
  return [[null, msg]];
}
async function editInspectionSpec(spec,done) {
  let library;try{library=await api('GET','/api/inspection-items');}catch(error){fail(error);return;}
  const s=spec||{kind:'수입검사',item_category:'원자재',product:'',aliases:[],items:[]};
  // 저장 후 목록이 다시 그려지므로, 연 버튼을 다시 찾아 포커스를 돌려준다(키보드 사용자).
  const opener=document.activeElement,back=opener?.id?'#'+opener.id:opener?.dataset?.editSpec?`[data-edit-spec="${opener.dataset.editSpec}"]`:'#specNew';
  const m=modal(`<h3>${s.id?'검사규격 수정':'검사규격 등록'}</h3>
<form class="stack spec-form" novalidate>
  <p class="small muted form-legend"><span class="req" aria-hidden="true">*</span> 표시는 필수 항목입니다. (선택) 표시는 비워도 됩니다.</p>
  <div class="form-error" data-form-error role="alert" hidden></div>
  <fieldset class="spec-section"><legend>1. 기본 정보</legend>
    <div class="form-grid">
      <label>검사 구분 <span class="req" aria-hidden="true">*</span><select name="kind" required>${['수입검사','출하검사'].map(v=>`<option ${s.kind===v?'selected':''}>${v}</option>`).join('')}</select></label>
      <label>카테고리 <span class="req" aria-hidden="true">*</span><select name="item_category" required>${INSPECTION_CATEGORIES.map(v=>`<option ${s.item_category===v?'selected':''}>${v}</option>`).join('')}</select></label>
      <label>품명 <span class="req" aria-hidden="true">*</span><input name="product" maxlength="200" value="${esc(s.product)}" required aria-required="true" placeholder="예: 천와이퍼 NX-7 원단"></label>
    </div>
    <label>품명·제품코드 별칭 <span class="opt">(선택)</span><textarea name="aliases" rows="3" aria-describedby="aliasHelp" placeholder="NX-707D&#10;NX-707">${esc(s.aliases.join('\n'))}</textarea></label>
    <p class="small muted field-help" id="aliasHelp">한 줄에 하나, 최대 20개. 실제 등록된 품명이나 제품코드를 적으면 검사 의뢰에 자동 연결됩니다(공백·대소문자 무시).</p>
  </fieldset>
  <fieldset class="spec-section"><legend>2. 검사 항목</legend>
    <p class="small muted">모든 측정값이 하한~상한 안이면 합격입니다(경계값 포함). 항목은 1~20개입니다.</p>
    <details class="spec-library"><summary>보관함에서 항목 불러오기 <span class="opt">(선택)</span></summary>
      <div class="form-grid">
        <label>품목군<select data-library-group></select></label>
        <label>검사 항목<select data-library-item></select></label>
      </div>
      <button type="button" class="btn" data-library-load>선택 항목 추가</button>
      <p class="small muted">불러온 항목은 이 규격에 복사됩니다. 「기준 설정 필요」 항목은 단위와 하한·상한을 채워주세요.</p>
    </details>
    <div data-spec-items></div>
    <button type="button" class="btn" data-add>+ 항목 추가</button>
  </fieldset>
  <fieldset class="spec-section"><legend>3. 사용 여부</legend>
    <label class="inline"><input type="checkbox" name="active" ${s.active!==false?'checked':''}>이 규격 사용 <span class="opt">(끄면 새 의뢰에 적용되지 않습니다)</span></label>
  </fieldset>
  <div class="actions spec-actions"><button type="button" class="btn" data-cancel>취소</button><button class="btn primary" data-save>규격 저장</button></div>
  <p class="small muted" data-save-status role="status" aria-live="polite"></p>
</form>`,{wide:true});
  const form=$('form',m.el),root=$('[data-spec-items]',form),formError=$('[data-form-error]',form),saveBtn=$('[data-save]',form),status=$('[data-save-status]',form);
  let seq=0;
  const clearError=el=>{if(!el)return;el.removeAttribute('aria-invalid');const id=el.dataset.errorId;if(id){$('#'+id,form)?.remove();el.setAttribute('aria-describedby',(el.getAttribute('aria-describedby')||'').split(' ').filter(x=>x&&x!==id).join(' '));delete el.dataset.errorId;if(!el.getAttribute('aria-describedby'))el.removeAttribute('aria-describedby');}};
  const clearAll=()=>{$$('[data-error-id]',form).forEach(clearError);$$('.field-error',form).forEach(e=>e.remove());formError.hidden=true;formError.textContent='';};
  const showErrors=errors=>{
    clearAll();const general=[];
    for(const [el,msg] of errors){
      if(!el){general.push(msg);continue;}
      if(el.dataset.errorId)continue; // 한 칸에는 첫 오류만
      const id='specErr'+(++seq),p=document.createElement('span');p.className='field-error';p.id=id;p.textContent=msg;
      // 칸 바로 아래(같은 label 안)에 둔다: 격자 배치에서도 해당 칸 밑에 붙는다.
      const host=el.closest('label');host?host.append(p):el.insertAdjacentElement('afterend',p);
      if(el.matches('input,select,textarea')){el.setAttribute('aria-invalid','true');el.dataset.errorId=id;el.setAttribute('aria-describedby',[(el.getAttribute('aria-describedby')||''),id].join(' ').trim());}
      else{el.dataset.errorId=id;}
    }
    const fieldCount=errors.filter(([el])=>el).length;
    if(general.length||fieldCount){formError.hidden=false;formError.textContent=general.length?general.join(' '):`입력 확인이 필요한 칸이 ${fieldCount}개 있습니다. 빨간색 안내를 보고 고쳐주세요.`;}
    const target=errors.find(([el])=>el)?.[0];
    if(target){const d=target.closest('details');if(d)d.open=true;target.focus();target.scrollIntoView?.({block:'center'});}else formError.scrollIntoView?.({block:'center'});
  };
  // 고친 칸은 입력하는 즉시 오류 표시를 지운다.
  form.addEventListener('input',e=>{if(e.target.getAttribute('aria-invalid'))clearError(e.target);status.textContent='';if(!$$('[aria-invalid]',form).length&&!$('.field-error',form))formError.hidden=true;});
  const renumber=()=>[...root.children].forEach((row,i)=>{$('legend',row).textContent=`항목 ${i+1}`;$('[data-remove]',row).setAttribute('aria-label',`항목 ${i+1} 제거`);$('[data-store]',row).setAttribute('aria-label',`항목 ${i+1} 보관함에 저장`);});
  const add=(item={name:'',unit:'',min:null,max:null,count:1},focus=false)=>{
    if(root.children.length>=20){toast('검사 항목은 최대 20개입니다. 필요 없는 항목을 제거한 뒤 추가하세요.','err');return;}
    const row=document.createElement('fieldset');row.className='inspection-spec-row';
    row.innerHTML=`<legend></legend><div class="form-grid">
      <label>항목명 <span class="req" aria-hidden="true">*</span><input data-k="name" required aria-required="true" maxlength="100" value="${esc(item.name)}" placeholder="예: 흡수속도 MD"></label>
      <label>단위 <span class="req" aria-hidden="true">*</span><input data-k="unit" required aria-required="true" maxlength="30" value="${esc(item.unit)}" placeholder="예: 초"></label>
      <label>측정 횟수 <span class="req" aria-hidden="true">*</span><input data-k="count" type="number" inputmode="numeric" required aria-required="true" min="1" max="20" step="1" value="${item.count}"></label>
    </div>
    <div class="spec-range" role="group" aria-label="합격 범위">
      <p class="small range-title">합격 범위 <span class="req" aria-hidden="true">*</span> <span class="muted">하한·상한 중 하나 이상</span></p>
      <div class="form-grid">
        <label>하한 (이상)<input data-k="min" type="text" inputmode="decimal" value="${esc(item.min??'')}" placeholder="없으면 비움"></label>
        <label>상한 (이하)<input data-k="max" type="text" inputmode="decimal" value="${esc(item.max??'')}" placeholder="없으면 비움"></label>
      </div>
    </div>
    <div class="actions"><button type="button" class="btn small" data-store>보관함에 저장</button><button type="button" class="btn small danger" data-remove>항목 제거</button></div>`;
    root.append(row);renumber();
    $('[data-remove]',row).onclick=()=>{const rows=[...root.children],i=rows.indexOf(row);row.remove();renumber();const next=root.children[i]||root.children[i-1];($('[data-k=name]',next||form)||$('[data-add]',form)).focus();};
    $('[data-store]',row).onclick=async()=>{
      const errs=inspectionSpecCheck({elements:{product:{value:'x'},aliases:{value:''}}},{children:[row]}).filter(([el])=>el&&row.contains(el));
      if(errs.length){showErrors(errs);return;}
      const v=await promptBox('검사 항목 보관','<label>품목군 <span class="req" aria-hidden="true">*</span><input name="group" required maxlength="100" value="'+esc($('[data-library-group]',form).value||s.product)+'"></label>');if(!v)return;
      const b=$('[data-store]',row);b.disabled=true;b.textContent='저장 중…';
      try{library=await api('POST','/api/inspection-items',{revision:library.revision,item:{...Object.fromEntries($$('[data-k]',row).map(el=>[el.dataset.k,el.value])),group:v.group}});refreshLibrary(v.group);toast('검사 항목을 보관했습니다.');}catch(error){fail(error);}finally{b.disabled=false;b.textContent='보관함에 저장';}
    };
    if(focus)$('[data-k=name]',row).focus();
  };
  const groupSelect=$('[data-library-group]',form),itemSelect=$('[data-library-item]',form),loadBtn=$('[data-library-load]',form);
  const refreshItems=()=>{const opts=library.items.map((item,index)=>({item,index})).filter(({item})=>!groupSelect.value||item.group===groupSelect.value);itemSelect.innerHTML=opts.map(({item,index})=>`<option value="${index}">${esc(item.name)}${item.unit?' · '+esc(item.unit):' · 기준 설정 필요'}</option>`).join('')||'<option value="">보관된 항목 없음</option>';loadBtn.disabled=!opts.length;};
  const refreshLibrary=(chosen=groupSelect.value)=>{const groups=[...new Set(library.items.map(i=>i.group))];groupSelect.innerHTML='<option value="">전체 품목군</option>'+groups.map(g=>`<option>${esc(g)}</option>`).join('');groupSelect.value=groups.includes(chosen)?chosen:'';refreshItems();};
  groupSelect.onchange=refreshItems;refreshLibrary();
  loadBtn.onclick=()=>{if(itemSelect.value==='')return;const chosen=library.items[Number(itemSelect.value)];if(!chosen)return;const only=root.children.length===1&&!$('[data-k=name]',root).value.trim();if(only)root.replaceChildren();add(chosen);status.textContent=`「${chosen.name}」 항목을 추가했습니다.`;};
  (s.items.length?s.items:[undefined]).forEach(item=>add(item));$('[data-add]',form).onclick=()=>add(undefined,true);
  $('[data-cancel]',form).onclick=m.close;
  let busy=false;form.onsubmit=async e=>{
    e.preventDefault();if(busy)return;
    const errors=inspectionSpecCheck(form,root);if(errors.length){showErrors(errors);return;}
    clearAll();busy=true;form.setAttribute('aria-busy','true');saveBtn.disabled=true;saveBtn.classList.add('is-loading');saveBtn.textContent='저장 중…';status.textContent='저장하고 있습니다.';
    try{
      const body={...formObj(form),active:form.elements.active.checked,aliases:form.elements.aliases.value.split('\n').map(x=>x.trim()).filter(Boolean),items:[...root.children].map(row=>Object.fromEntries($$('[data-k]',row).map(el=>[el.dataset.k,el.value]))),revision:s.revision};
      await api(s.id?'PUT':'POST','/api/inspection-specs'+(s.id?'/'+s.id:''),body);
      saveBtn.classList.remove('is-loading');saveBtn.classList.add('is-done');saveBtn.textContent='저장됨 ✓';status.textContent='저장했습니다.';
      toast('검사규격을 저장했습니다.');setTimeout(async()=>{m.close();await done();document.querySelector(back)?.focus();},500);
    }catch(error){
      showErrors(inspectionSpecServerError(form,root,error));
      saveBtn.disabled=false;saveBtn.classList.remove('is-loading');saveBtn.textContent='규격 저장';status.textContent='저장하지 못했습니다.';busy=false;form.removeAttribute('aria-busy');
    }
  };
}
async function pageInspections(main) {
  main.innerHTML=`<h1>수입·출하 검사 이력</h1><p class="muted">카테고리별 검사 내역과 품명·LOT를 검색하세요. 합격·불합격은 평균이 아닌 모든 측정값으로 판정합니다. 왼쪽 연도 폴더로 해를 고르고, 「엑셀」로 내려받거나 「월별 불합격률」로 업체·품목별 추이를 봅니다.</p>${listControls('inspection',{dateLabel:'의뢰',placeholder:'품명·제품코드 별칭·LOT·거래처',extra:`<label>검사 구분<select name="kind"><option value="">전체</option><option>수입검사</option><option>출하검사</option></select></label><label>카테고리<select name="item_category"><option value="">전체</option>${[...INSPECTION_CATEGORIES,'미분류'].map(c=>`<option>${c}</option>`).join('')}</select></label><label>판정<select name="result"><option value="">전체</option>${Object.entries(INSPECTION_RESULT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>`})}<div id="inspectionList"></div><button class="btn" id="inspectionMore" hidden>더 보기</button>`;
  const form=$('#inspectionFilters',main),more=$('#inspectionMore',main);let version=0,rows=[],next=null,busy=false;
  { // 15.340 연도 폴더: 고르면 기간(시작~끝)을 그 해로 · 「전체 기간」은 기간 비움. 엑셀·월별 불합격률 단추.
    const y0 = Number(todayStr().slice(0, 4)); form.insertAdjacentHTML('afterbegin', `<label class="lf-sel">연도<select name="year"><option value="">전체 기간</option>${[0, 1, 2, 3, 4].map(i => `<option>${y0 - i}</option>`).join('')}</select></label>`);
    const rail = yearRail(main, form, { title: '연도 폴더' }); const ys = form.elements.year;
    ys.addEventListener('change', () => { const y = ys.value; if (form.elements.from) form.elements.from.value = y ? `${y}-01-01` : ''; if (form.elements.to) form.elements.to.value = y ? `${y}-12-31` : ''; form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); });
    form.querySelector('[data-clear-filters]')?.addEventListener('click', () => { ys.value = ''; rail.draw(); });
    form.querySelector('[data-list-count]')?.insertAdjacentHTML('beforebegin', '<button type="button" class="btn" data-insp-xlsx>엑셀</button><button type="button" class="btn" data-insp-trend>월별 불합격률</button>');
    form.querySelector('[data-insp-xlsx]').onclick = () => { const t = main.querySelector('#inspectionList table'); if (t) tableToXlsx(t, '수입출하검사이력'); else toast('내보낼 목록이 없습니다.', 'err'); };
    form.querySelector('[data-insp-trend]').onclick = () => inspTrend().catch(fail);
  }
  const draw=()=>{
    $('#inspectionList',main).innerHTML=rows.length?`<div class="table-wrap"><table class="grid"><thead><tr><th>의뢰일 · 번호</th><th>검사</th><th>카테고리</th><th>품명 · LOT</th><th>거래처</th><th>판정</th><th>입력자 · 검사일</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.result==='exempt'?'row-exempt':''}"><td>${esc(r.created_at.slice(0,10))}<br>${esc(r.req_no||'접수대기')}</td><td>${esc(r.category)}</td><td>${esc(r.item_category||'미분류')}</td><td><b>${esc(r.title)}</b><div class="small muted">${esc(r.lot||'')}</div></td><td>${esc(r.customer)}</td><td>${qualityInspectionBadge(r.result)}<div class="small muted">${esc(STATUS[r.status])}</div></td><td>${esc(r.updated_by||'—')}<br>${esc(r.updated_at||'')}</td><td><button class="btn small" data-inspection="${r.id}">검사 열기</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">조건에 맞는 검사 의뢰가 없습니다.</div>';
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
  if(!spec){ // 15.174 규격이 없을 때: 이름이 비슷한 규격을 먼저 추천하고 한 번에 적용, 없으면 이 품명으로 바로 등록
    const sg=data.suggest||{exact:[],partial:[]}, picked=new Set([...sg.exact,...sg.partial].map(x=>x.id));
    const all=data.can_manage?(await api('GET','/api/inspection-specs')).specs.filter(s=>s.active&&s.kind===r.category&&!picked.has(s.id)&&(!r.data.item_category||r.data.item_category===s.item_category)):[];
    const opt=(s,tag)=>`<label class="spec-pick"><input type="radio" name="spec_id" value="${s.id}" required> <span><b>${esc(s.product)}</b> ${tag} <span class="small muted">${esc(s.item_category)} · 규격 ${s.revision}${s.items?.length?` · ${esc((s.items||[]).map(x=>x.name||x).join(', '))}`:''}</span></span></label>`;
    const list=[...sg.exact.map(s=>opt(s,'<span class="chip green">이름 일치</span>')),...sg.partial.map(s=>opt(s,'<span class="chip yellow">비슷한 이름</span>')),...all.map(s=>opt(s,''))];
    const hint=sg.exact.length>1?`이름이 맞는 규격이 ${sg.exact.length}개라 자동으로 고르지 않았습니다. 하나를 고르세요.`:sg.partial.length?'이름이 정확히 같은 규격은 없고, 비슷한 규격이 있습니다.':`「${esc(r.title)}」${r.data.item_category?` (${esc(r.data.item_category)})`:''}에 맞는 ${esc(r.category)} 규격이 없습니다.`;
    const m=modal(`<h3>${esc(r.title)} · ${esc(r.category)}</h3><p>${hint}</p>
      ${data.can_manage?`<form class="stack spec-pick-form">${list.length?`<div class="spec-pick-list" role="radiogroup" aria-label="적용할 규격">${list.join('')}</div>`:''}
        <p class="small muted">적용한 규격은 이 검사에 고정되며 이후 규격 설정을 바꿔도 유지됩니다. 규격의 품명·별칭을 이 품명과 같게 해 두면 다음부터 자동으로 연결됩니다.</p>
        <div class="actions">${list.length?'<button class="btn primary">규격 적용</button>':''}<button type="button" class="btn" data-spec-new>「${esc(r.title)}」 규격 새로 등록</button></div></form>`
      :`${sg.exact.length||sg.partial.length?`<p class="small">후보: ${[...sg.exact,...sg.partial].map(s=>esc(s.product)).join(', ')}</p>`:''}<p class="small muted">규격 지정은 품질팀장이 합니다. 품질팀장에게 이 의뢰의 규격 지정을 요청하세요.</p>`}`,{wide:true});
    if(data.can_manage){
      const form=$('form',m.el);let busy=false;
      $('[name=spec_id]',form)?.click();
      $('[data-spec-new]',form).onclick=()=>{m.close();editInspectionSpec({kind:r.category,item_category:r.data.item_category||'원자재',product:r.title,aliases:r.data.product_code?[r.data.product_code]:[],items:[]},()=>openInspection(id,done));};
      form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;form.inert=true;try{await api('POST',`/api/requests/${id}/inspection/spec`,formObj(form));m.close();await openInspection(id,done);}catch(error){fail(error);}finally{busy=false;form.inert=false;}};
    }
    return;
  }

  // 15.243 측정값 입력: 분석 항목마다 행으로 구분, 원 데이터(측정 회차)는 한 줄에 10칸까지(20회면 두 줄). 「종횡 바꾸기」로 항목별 묶음 ↔ 시료별 묶음. LOT·시료는 표 위 한 곳에서 입력·추가·빼기
  const PER=10;
  let mode='item';try{if(localStorage.getItem('wpa:insp-mode3')==='sample')mode='sample';}catch{}
  const m=modal(`<h3>${esc(r.title)} · ${esc(r.category)}</h3>${r.category==='수입검사'&&hasRole('quality')?`<div class="actions wrap insp-links"><button type="button" class="btn small" data-insp-scoa>공급사 COA${r.data?.coa_requested?' (요청함)':''}</button></div>`:''}<p>${esc(spec.item_category)} · 적용 품목 ${esc(spec.product)} · 규격 ${spec.revision}</p><p class="small muted">모든 값이 규격 이내면 합격, 하나라도 벗어나면 불합격입니다. 빈 칸이 남고 규격 이탈이 없으면 검사 대기입니다. 평균은 참고용입니다.</p>${!data.can_write?'<p class="muted">승인된 의뢰에서 품질 담당자만 측정값을 입력할 수 있습니다.</p>':''}<form class="stack"><div class="insp-bar"><p class="small muted" data-insp-hint></p><button type="button" class="btn small" data-insp-mode>⇄ 종횡 바꾸기</button></div>
      <div class="insp-samples" data-samples></div>
      <div class="table-wrap insp-wrap"><table class="grid keep-table insp-grid insp-r" data-no-sort data-no-filter data-keep-cols data-no-reorder></table></div>
      ${data.can_write?'<label>수정 사유 (판정된 결과 수정 시 필수)<input name="reason" maxlength="500"></label>':''}<div data-verdict role="status"></div>${data.can_write?'<button class="btn primary">측정값 저장 · 자동 판정</button>':''}</form><details class="card"><summary>저장 이력 (${data.history.length}건 표시)</summary>${data.history.map(h=>`<p><button class="btn small" data-history="${h.id}">기록 ${h.revision} · ${INSPECTION_RESULT[h.result]}</button> ${esc(h.saved_by)} · ${esc(h.saved_at)} ${esc(h.reason)}</p>`).join('')||'<p>저장 이력이 없습니다.</p>'}</details>`,{wide:true});
  const form=$('form',m.el),table=$('table.insp-grid',form),strip=$('[data-samples]',form);
  form.closest('.modal')?.classList.add('insp-modal'); // 15.241 팝업을 옆으로 넓게
  $('[data-insp-scoa]',m.el)?.addEventListener('click',()=>scoaOpen(r.id).catch(fail)); /* 15.306 A5 공급사 COA 첨부 */
  // 상태: 시료 목록. 칸은 data-s(시료 번호)·data-f(필드 번호: 0 = LOT, 1… = 항목·회차)로 찾는다
  const F=[{lot:true},...spec.items.flatMap(item=>Array.from({length:item.count},(_,i)=>({item,i})))];
  const fOf=(item,i)=>F.findIndex(d=>d.item===item&&d.i===i);
  const norm=v=>({lot:v?.lot??'',values:Object.fromEntries(spec.items.map(item=>[item.key,Array.from({length:item.count},(_,i)=>String(v?.values?.[item.key]?.[i]??''))]))});
  let samples=(measurement?.values||[{lot:r.lot||r.data.lot_etc||'시료 1',values:{}}]).map(norm);
  const blank=()=>norm({lot:'시료 '+(samples.length+1)});
  const read=()=>samples.map(s=>({lot:s.lot,values:Object.fromEntries(spec.items.map(item=>[item.key,[...s.values[item.key]]]))}));
  const ro=data.can_write?'':'readonly';
  const W=Math.min(PER,Math.max(...spec.items.map(i=>i.count))); // 원 데이터 칸 수(한 줄)
  const lines=item=>Math.ceil(item.count/PER);
  const rangeTxt=item=>`${item.min==null&&item.max==null?'규격 없음':`${item.min==null?'':esc(fmtNum(item.min))} ~ ${item.max==null?'':esc(fmtNum(item.max))}`}${item.unit?` ${esc(item.unit)}`:''}`;
  const itemCell=(item,rs)=>`<th scope="rowgroup" rowspan="${rs}" class="insp-item-c" title="${esc(inspectionRange(item))}">${esc(item.name)}<div class="small muted insp-range-in">${rangeTxt(item)}</div></th>`;
  const sampleCell=(s,rs)=>`<th scope="rowgroup" rowspan="${rs}" class="insp-samp-c"><span class="insp-sno">시료 ${s+1}</span><div class="insp-lot-t" data-lot-text="${s}">${esc(samples[s].lot)}</div></th>`;
  const rawCells=(s,item,L)=>Array.from({length:W},(_,k)=>{const i=L*PER+k;if(i>=item.count)return '<td class="insp-blank"></td>';return `<td class="insp-cell"><input type="number" step="any" inputmode="decimal" data-item="${item.key}" data-s="${s}" data-f="${fOf(item,i)}" placeholder="#${i+1}" aria-label="시료 ${s+1} ${esc(item.name)} ${i+1}회" value="${esc(samples[s].values[item.key][i])}" ${ro}></td>`;}).join('');
  const avgCell=(s,item)=>`<td rowspan="${lines(item)}" class="r insp-avg"><span data-average="${item.key}" data-s="${s}"></span></td>`;
  const render=()=>{
    strip.innerHTML=`<span class="insp-samples-h">LOT · 시료</span>${samples.map((x,s)=>`<span class="insp-s"><b>${s+1}</b><input data-lot data-s="${s}" data-f="0" required maxlength="100" value="${esc(x.lot)}" aria-label="시료 ${s+1} LOT / 시료명" ${ro}><span data-judge="${s}"></span>${data.can_write?`<button type="button" class="btn small danger" data-remove-sample="${s}" title="이 시료 빼기" aria-label="시료 ${s+1} 빼기">×</button>`:''}</span>`).join('')}${data.can_write?'<button type="button" class="btn small" data-add-sample>+ 시료 추가</button>':''}`;
    const nums=`${Array.from({length:W},(_,k)=>`<th class="c insp-n">#${k+1}</th>`).join('')}<th class="c insp-avg-h">평균</th>`;
    if(mode==='item'){
      table.innerHTML=`<thead><tr><th class="c insp-item-c">분석 항목 · 규격</th><th class="c insp-samp-c">시료</th>${nums}</tr></thead>${spec.items.map(item=>`<tbody class="insp-grp">${samples.map((_,s)=>Array.from({length:lines(item)},(_,L)=>`<tr>${!s&&!L?itemCell(item,samples.length*lines(item)):''}${L?'':sampleCell(s,lines(item))}${rawCells(s,item,L)}${L?'':avgCell(s,item)}</tr>`).join('')).join('')}</tbody>`).join('')}`;
    }else{
      const total=spec.items.reduce((n,i)=>n+lines(i),0);
      table.innerHTML=`<thead><tr><th class="c insp-samp-c">시료</th><th class="c insp-item-c">분석 항목 · 규격</th>${nums}</tr></thead>${samples.map((_,s)=>`<tbody class="insp-grp">${spec.items.map((item,ii)=>Array.from({length:lines(item)},(_,L)=>`<tr class="${ii&&!L?'insp-sub':''}">${!ii&&!L?sampleCell(s,total):''}${L?'':itemCell(item,lines(item))}${rawCells(s,item,L)}${L?'':avgCell(s,item)}</tr>`).join('')).join('')}</tbody>`).join('')}`;
    }
    $('[data-insp-hint]',form).textContent=`${mode==='item'?'분석 항목별로 묶어 시료를 줄로 보여 줍니다.':'시료별로 묶어 분석 항목을 줄로 보여 줍니다.'} 원 데이터는 한 줄에 ${PER}칸까지(넘으면 다음 줄). Enter는 다음 칸, 방향키로 이동, 엑셀에서 한 줄을 복사해 붙여넣으면 그 칸부터 채웁니다.`;
    $('[data-insp-mode]',form).textContent=mode==='item'?'⇄ 종횡 바꾸기 (시료별로 보기)':'⇄ 종횡 바꾸기 (항목별로 보기)';
    $$('[data-remove-sample]',strip).forEach(b=>b.onclick=()=>{if(samples.length===1)return toast('시료는 1개 이상 필요합니다.','err');samples.splice(Number(b.dataset.removeSample),1);edited=true;render();});
    const add=$('[data-add-sample]',strip);if(add)add.onclick=()=>{if(addSample()){edited=true;render();focusAt(samples.length-1,0);}};
    update();
  };
  let edited=false;const update=()=>{
    const rows=read();$('[data-verdict]',form).innerHTML=qualityInspectionBadge(inspectionPreview(spec,rows))+` <span class="small muted">${data.can_write&&(edited||!measurement)?'저장 전 미리보기':'저장된 판정'}</span>`;
    rows.forEach((row,s)=>{spec.items.forEach(item=>{const values=row.values[item.key].filter(v=>v!=='').map(Number);const av=$(`[data-average="${item.key}"][data-s="${s}"]`,table);if(av)av.textContent=values.length?fmtNum(Math.round(values.reduce((a,b)=>a+b,0)/values.length*1000)/1000):'—';});
      const j=$(`[data-judge="${s}"]`,strip);if(j)j.innerHTML=qualityInspectionBadge(inspectionPreview(spec,[row]));
      $$(`[data-lot-text="${s}"]`,table).forEach(t=>{t.textContent=row.lot;});});
    $$('input[data-item]',table).forEach(el=>{const item=F[Number(el.dataset.f)].item;el.classList.toggle('inspection-outside',el.value!==''&&((item.min!==null&&Number(el.value)<item.min)||(item.max!==null&&Number(el.value)>item.max)));});
  };
  const setVal=(el,v)=>{const s=Number(el.dataset.s),d=F[Number(el.dataset.f)];if(d.lot)samples[s].lot=v;else samples[s].values[d.item.key][d.i]=v;};
  const at=(s,f)=>$(`input[data-s="${s}"][data-f="${f}"]`,form);
  const focusEl=t=>{if(t&&!t.readOnly){t.focus();t.select?.();return true;}return false;};
  const focusAt=(s,f)=>focusEl(at(s,f));
  const addSample=v=>{if(samples.length>=30){toast('LOT·시료는 최대 30개입니다.','err');return false;}samples.push(v||blank());return true;};
  form.addEventListener('input',e=>{if(e.target.matches('input[data-s]'))setVal(e.target,e.target.value);edited=true;update();});
  // 이동: Enter = 표에서 다음 칸(보이는 순서), LOT 칸은 다음 LOT(마지막이면 표 첫 칸). 방향키 = 보이는 표 기준 위·아래(같은 열)·옆
  const tableInputs=()=>$$('input[data-item]',table).filter(x=>!x.readOnly);
  const colOf=el=>el.closest('td').getBoundingClientRect().left;
  form.addEventListener('keydown',e=>{const el=e.target;if(!el.matches('input[data-s]')||e.isComposing)return;
    if(el.matches('[data-lot]')){if(e.key!=='Enter')return;e.preventDefault();const s=Number(el.dataset.s);if(!focusAt(s+1,0))focusEl(tableInputs()[0]);return;}
    const list=tableInputs(),idx=list.indexOf(el);
    if(e.key==='Enter'){e.preventDefault();focusEl(list[idx+1]);return;}
    if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const tr=el.closest('tr'),row=$$('input[data-item]',tr);const t=row[row.indexOf(el)+(e.key==='ArrowRight'?1:-1)];focusEl(t);return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const trs=$$('tbody tr',table).filter(tr=>$('input[data-item]',tr));let i=trs.indexOf(el.closest('tr'))+(e.key==='ArrowDown'?1:-1);const x=colOf(el);
      while(trs[i]){const c=$$('input[data-item]',trs[i]).find(t=>Math.abs(colOf(t)-x)<2);if(c)return void focusEl(c);i+=e.key==='ArrowDown'?1:-1;}}
  });
  // 붙여넣기(엑셀): 한 줄 = 그 칸부터 같은 시료·같은 항목의 다음 회차로(10칸 넘으면 다음 줄로 이어짐). 여러 줄이면 항목별 보기는 다음 시료, 시료별 보기는 다음 항목. 시료가 모자라면 늘린다(최대 30).
  form.addEventListener('paste',e=>{const el=e.target;if(!el.matches('input[data-item]')||el.readOnly)return;const text=(e.clipboardData||window.clipboardData)?.getData('text')||'';if(!/[\t\n]/.test(text.trim()))return;e.preventDefault();
    const grid=text.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(l=>l.split('\t'));const s0=Number(el.dataset.s),d0=F[Number(el.dataset.f)],ii0=spec.items.indexOf(d0.item);
    grid.forEach((vals,i)=>{let s=s0,item=d0.item;if(mode==='item')s=s0+i;else item=spec.items[ii0+i];if(!item)return;while(s>=samples.length)if(!addSample())return;
      vals.forEach((v,j)=>{const k=d0.i+j;if(k>=item.count)return;samples[s].values[item.key][k]=String(v).trim().replace(/,/g,'');});});
    edited=true;render();focusAt(s0,Number(el.dataset.f));toast(`${grid.length}줄 × ${Math.max(...grid.map(g=>g.length))}칸을 붙여넣었습니다.`);});
  $('[data-insp-mode]',form).onclick=()=>{mode=mode==='item'?'sample':'item';try{localStorage.setItem('wpa:insp-mode3',mode);}catch{}render();};
  render();
  $$('[data-history]',m.el).forEach(b=>b.onclick=async()=>{try{const h=await api('GET',`/api/requests/${id}/inspection/history/${b.dataset.history}`);modal(`<h3>검사 기록 ${h.revision}</h3><p>${qualityInspectionBadge(h.result)} ${esc(h.saved_by)} · ${esc(h.saved_at)}</p>${inspectionMatrix(spec,h.values)}`,{wide:true});}catch(error){fail(error);}});
  if(!data.can_write)return;
  // 시료 추가 단추는 render()에서 연결
  const draft=bindEntryDraft(form,`inspection:${id}:${measurement?.revision||0}`,{read:()=>({rows:read(),reason:form.elements.reason.value}),restore:value=>{samples=(value.rows||[]).map(norm);if(!samples.length)samples=[norm({lot:'시료 1'})];form.elements.reason.value=value.reason||'';render();}});
  let busy=false;form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;form.inert=true;draft.start();let committed=false;try{const saved=await api('PUT',`/api/requests/${id}/inspection`,{rows:read(),revision:measurement?.revision||0,reason:form.elements.reason.value});committed=true;draft.clear();m.close();toast('저장 완료 · '+INSPECTION_RESULT[saved.result]);Promise.resolve(done()).catch(fail);await openInspection(id,done);}catch(error){if(!committed)draft.failure();fail(committed?new Error('검사 결과는 저장되었습니다. 다시 조회해주세요. '+error.message):error);}finally{busy=false;form.inert=false;}};
}

