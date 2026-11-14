import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/operator.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function setup() {
  const elements={production_date:{value:'2026-01-12'},schedule_id:{value:''},qty:{value:''},note:{value:''}};
  const form={elements,isConnected:true,reportValidity:()=>true};
  const nodes={'#operatorActual':form,'[type=submit]':{},'#operatorPlan':{},'#operatorSaveStatus':{},'#operatorRefresh':{},'#operatorHistory':{}};
  const states=[];let draftOptions;
  const c=vm.createContext({ME:{id:1,is_admin:false,roles:['operator']},crypto,Date,encodeURIComponent,Promise,
    $:s=>nodes[s],esc:x=>String(x??'').replace(/</g,'&lt;'),fmtNum:n=>String(n),todayStr:()=> '2026-01-12',
    bindEntryDraft:(_f,_id,opts)=>{draftOptions=opts;return Object.fromEntries(['start','failure','clear','resume'].map(k=>[k,()=>states.push(k)]));},
    uxFormRead:()=>Object.entries(elements).map(([k,v])=>[k,v.value]),uxFormRestore:(_f,fields)=>fields.forEach(([k,v])=>{elements[k].value=v}),toast:()=>{},fail:()=>{},
  });vm.runInContext(source,c);
  return {c,elements,form,nodes,states,draft:()=>draftOptions};
}
test('Finished operator entry blocks repeated clicks and preserves retry identity after a failed write',async()=>{
  const {c,elements,form,states,draft}=setup();const writes=[];let rejectWrite;
  c.api=async(method,url,body)=>{
    if(method==='POST'){writes.push(body);if(writes.length===1)return new Promise((_,reject)=>{rejectWrite=reject});return {id:9};}
    return url.includes('/plans?')?[{id:7,product:'제품',spec:'S',qty:100,actual_qty:0,unit:'EA',period:'day'}]:[];
  };
  await c.operatorFinished({});elements.schedule_id.value='7';elements.qty.value='12';elements.schedule_id.onchange();
  const before=draft().read().requestId;
  const first=form.onsubmit({preventDefault(){}});await form.onsubmit({preventDefault(){}});assert.equal(writes.length,1);assert.equal(form.inert,true);
  rejectWrite(Error('offline'));await first;assert.equal(elements.qty.value,'12');assert.equal(draft().read().requestId,before);assert.ok(states.includes('failure'));
  await form.onsubmit({preventDefault(){}});assert.equal(writes.length,2);assert.equal(writes[1].request_id,before);assert.equal(elements.qty.value,'');assert.notEqual(draft().read().requestId,before);assert.ok(states.includes('clear'));assert.equal(form.inert,false);
});
test('Plan queries ignore late responses and never enable saving when no valid plan exists',async()=>{
  const {c,elements,nodes}=setup();let release;
  c.api=async(_method,url)=>url.includes('/plans?')?[{id:7,product:'제품',qty:1,unit:'EA'}]:[];
  await c.operatorFinished({});
  c.api=async(_method,url)=>{if(url.includes('/actuals?'))return [];if(url.endsWith('2026-01-11'))return new Promise(resolve=>{release=resolve});return [];};
  elements.production_date.value='2026-01-11';const old=elements.production_date.onchange();
  elements.production_date.value='2026-01-10';await elements.production_date.onchange();release([{id:99,product:'stale'}]);await old;
  assert.equal(elements.schedule_id.value,'');assert.equal(nodes['[type=submit]'].disabled,true);assert.match(nodes['#operatorPlan'].textContent,/계획이 없습니다/);assert.ok(!elements.schedule_id.innerHTML.includes('stale'));
});
test('Operator routes cannot render admin or ordinary business pages; admin is exempt from operator mode',async()=>{
  const {c}=setup();const main={};await c.operatorPage('#/admin',main);assert.match(main.innerHTML,/오늘의 작업/);assert.ok(!main.innerHTML.includes('가입 승인'));
  assert.equal(vm.runInContext('isOperatorMode()',c),true);c.ME.is_admin=true;assert.equal(vm.runInContext('isOperatorMode()',c),false);
});
test('Closing confirmation or reason dialogs resolves cancellation; explicit confirmation remains true',async()=>{
  let box,options;const nodes={};const c=vm.createContext({esc:x=>x,formObj:()=>({reason:'사유'}),$:s=>nodes[s]||=( {}),modal:(_html,opts)=>{options=opts;box={el:{},close:()=>opts.onClose()};return box;}});
  vm.runInContext(app.slice(app.indexOf('function confirmBox('),app.indexOf('// 사진 →')),c);
  let pending=c.confirmBox('확인');box.close();assert.equal(await pending,false);
  pending=c.confirmBox('확인');nodes['[data-yes]'].onclick();assert.equal(await pending,true);
  pending=c.promptBox('사유','');box.close();assert.equal(await pending,null);
  pending=c.promptBox('사유','');nodes.form.onsubmit({preventDefault(){},target:{}});assert.equal((await pending).reason,'사유');
});
test('Saving the maximum 30 semi rows resets to one usable row while retaining the last product',()=>{
  const semi=fs.readFileSync(new URL('../public/semi.js',import.meta.url),'utf8');
  let rows=Array.from({length:30},(_,i)=>({product:'p'+i,remove(){rows=rows.filter(r=>r!==this)}}));
  const c=vm.createContext({$$:()=>rows});vm.runInContext(semi.slice(semi.indexOf('function resetSemiRows('),semi.indexOf('async function pageSemi(')),c);
  c.resetSemiRows({},last=>{assert.ok(rows.length<30);rows.push({product:last.product})});assert.equal(rows.length,1);assert.equal(rows[0].product,'p29');
});
