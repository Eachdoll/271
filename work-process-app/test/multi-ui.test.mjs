import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/multi-items.js',import.meta.url),'utf8');
function context(){return vm.createContext({document:{addEventListener(){}},esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmtNum:n=>String(n),formObj:()=>({vendor:'공급사',due_date:'2026-11-13'}),collectRequest:type=>({type,customer:'고객사',data:{purpose:'분석 요청'}}),$$:(selector,node)=>selector==='[data-multi-row]'?node.rows:node.inputs});}
test('Multi-item payload preserves separate sizes, quantities, checkbox values, request fields and production kind',()=>{
 const c=context();vm.runInContext(source,c);
 const row=(item,spec,qty,checked)=>({inputs:[['item',item],['spec',spec],['qty',qty],['coa_requested',checked]].map(([key,value])=>({dataset:{lineKey:key},value,type:key==='coa_requested'?'checkbox':'text',checked:!!value}))});
 const form={rows:[row('니트릴글러브','S','10',true),row('라텍스글러브','M','20',false),row('PVC글러브','S','30',false)]};
 const payload=c.multiPayload(form,'purchase_order','','','unique-request-key-123');assert.equal(payload.items.length,3);assert.equal(payload.common.vendor,'공급사');assert.equal(payload.items[1].qty,'20');assert.equal(payload.items[1].spec,'M');assert.equal(payload.items[1].coa_requested,false);assert.equal(payload.request_id,'unique-request-key-123');
 const request=c.multiPayload(form,'request','analysis','','unique-request-key-123');assert.equal(request.common.type,'analysis');assert.equal(request.common.data.purpose,'분석 요청');assert.equal(request.items.length,3);
 const schedule=c.multiPayload(form,'schedule','','semi','unique-request-key-123');assert.equal(schedule.common.kind,'semi');
});
test('Line metadata shows size, unit and batch identity while escaping user content',()=>{
 const c=context();vm.runInContext(source,c);
 const html=c.lineInfo({id:1,req_no:'PR',item:'글러브',spec:'<img onerror=x>',unit:'BOX',lot:'" onmouseover="x',batch_id:'abcdefgh12345678'});
 assert.ok(html.includes('&lt;img onerror=x&gt;'));assert.ok(html.includes('&quot; onmouseover=&quot;x'));assert.ok(html.includes('묶음 12345678'));assert.ok(html.includes('data-line-meta="purchase_order"'));
 assert.equal(c.lineEntity({type:'analysis',id:2}),'request');assert.equal(c.lineEntity({in_date:'2026-11-13',id:3}),'laundry');assert.equal(c.lineEntity({product:'반제품',period:'week',id:4}),'schedule');
});
