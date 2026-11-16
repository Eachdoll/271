import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/master.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setup(){
 const nodes=new Map();
 const node=k=>{if(!nodes.has(k))nodes.set(k,{innerHTML:'',textContent:'',value:'',dataset:{},isConnected:true,children:[],handlers:{},append(v){this.children.push(v);},setAttribute(){},addEventListener(k,f){(this.handlers[k]??=[]).push(f);}});return nodes.get(k);};
 node('[data-partner-search]').elements={q:node('query')};
 let close;
 const c=vm.createContext({esc,URLSearchParams,Event,$:s=>node(s),document:{createElement:()=>node('element'+nodes.size)},modal:(html,o)=>{c.modalHtml=html;close=()=>o.onClose();return{el:node('modal'),close};}});
 vm.runInContext(source,c);return{c,node,close:()=>close()};
}
test('Partner directory search keeps scope, ignores stale results, escapes names, and resolves a selection',async()=>{
 const {c,node}=setup(),pending=[];
 c.api=(method,url)=>{assert.equal(method,'GET');return new Promise(resolve=>pending.push({url,resolve}));};
 const result=c.pickPartner({type:'sales'});
 assert.equal(new URL('https://test'+pending[0].url).searchParams.get('type'),'sales');
 node('query').value='C007';node('[data-partner-search]').onsubmit({preventDefault(){}});
 assert.equal(new URL('https://test'+pending[1].url).searchParams.get('q'),'C007');
 const selected={name:'고객 <img onerror=x>',code:'C007',contact_name:'담당',phone:'010',is_sales:1};
 pending[1].resolve([selected]);await tick();
 assert.match(node('[data-partner-results]').innerHTML,/&lt;img onerror=x&gt;/);
 pending[0].resolve([{name:'늦은 결과'}]);await tick();assert.ok(!node('[data-partner-results]').innerHTML.includes('늦은 결과'));
 node('[data-partner-results]').handlers.click[0]({target:{closest:()=>({dataset:{partnerPick:'0'}})}});
 assert.equal(await result,selected);
});
test('Partner search cancellation ignores a later response and failures allow a new query',async()=>{
 const {c,node,close}=setup();let resolve;
 c.api=()=>new Promise(r=>resolve=r);
 const result=c.pickPartner();close();assert.equal(await result,null);
 resolve([{name:'닫힌 뒤 결과'}]);await tick();assert.equal(node('[data-partner-results]').innerHTML,'');
 c.api=async()=>{throw Error('<실패>');};const retry=c.pickPartner();await tick();assert.match(node('[data-partner-results]').innerHTML,/&lt;실패&gt;/);
 c.api=async()=>[];node('[data-partner-search]').onsubmit({preventDefault(){}});await tick();assert.match(node('[data-partner-results]').innerHTML,/조건에 맞는 거래처가 없습니다/);close();await retry;
});
test('Lookup selection replaces an old partner and emits the input/change events used by dependent screens',async()=>{
 const {c,node}=setup();
 const input={value:'기존 거래처',placeholder:'검색',dataset:{partnerPrev:'기존 거래처'},isConnected:true,listeners:{},events:[],before(w){this.wrap=w;},after(){},setAttribute(){},addEventListener(k,f){(this.listeners[k]??=[]).push(f);},dispatchEvent(e){this.events.push(e.type);for(const fn of this.listeners[e.type]||[])fn(e);}};
 c.api=async()=>[];await c.bindPartnerPicker(input,null,{type:'purchase'});
 const button=input.wrap.children[1];let scope;
 c.pickPartner=async o=>{scope=o.type;return{name:'새 공급사'};};
 await button.onclick({preventDefault(){}});
 assert.equal(scope,'purchase');assert.equal(input.value,'새 공급사');assert.equal(input.dataset.partnerPrev,undefined);assert.deepEqual(input.events,['input','change']);assert.equal(button.disabled,false);
});
