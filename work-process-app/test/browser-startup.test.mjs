import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script src="\/(.+?\.js)"><\/script>/g)].map(m=>m[1]);
async function boot(read) {
  const nodes=new Map();
  const document={body:{classList:{add(){},remove(){}},appendChild(){}},querySelector(selector){if(!nodes.has(selector)) nodes.set(selector,{innerHTML:'',textContent:'',classList:{add(){},remove(){}}});return nodes.get(selector);},querySelectorAll(){return [];},addEventListener(){},removeEventListener(){}};
  const c=vm.createContext({document,MutationObserver:class{observe(){}},location:{hash:''},sessionStorage:{getItem:()=>null,removeItem(){},setItem(){}},fetch:async()=>({ok:true,status:200,json:async()=>({user:null})}),addEventListener(){},requestAnimationFrame:f=>f(),setTimeout,clearTimeout,console});c.window=c;
  for(const file of scripts)new vm.Script(read(file),{filename:file}).runInContext(c);
  await new Promise(resolve=>setImmediate(resolve));
  return nodes.get('#app').innerHTML;
}
test('All HTML scripts load together without global name collisions and render the login screen',async()=>{
  const output=await boot(file=>fs.readFileSync(new URL('../public/'+file,import.meta.url),'utf8'));
  assert.match(output,/id="authForm"/);assert.match(output,/로그인/);assert.match(output,/Spotless and Safe, through Technology/);
});
