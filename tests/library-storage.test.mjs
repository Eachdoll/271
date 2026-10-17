import test from 'node:test';import assert from 'node:assert/strict';
import {readStoredLibrary,writeStoredLibrary} from '../dist/library-storage.js';
const key='library',seed=()=>({books:[],characters:[{id:'sample'}]});
function storage(value){let raw=value;return {getItem:()=>raw,setItem:(_key,next)=>{raw=next},raw:()=>raw}}
const validate=raw=>{const next=JSON.parse(raw);if(!Array.isArray(next.books))throw new Error('invalid books');return next};
test('fresh browser gets samples without writing a pretend existing library',()=>{const s=storage(null),result=readStoredLibrary(s,key,{validate,seed});assert.equal(result.kind,'fresh');assert.equal(s.raw(),null)});
test('an existing library and original raw bytes survive a read and validation',()=>{const raw=' { "books": [], "characters": [{"id":"real"}] } ',s=storage(raw),r=readStoredLibrary(s,key,{validate,seed});assert.equal(r.kind,'ready');assert.equal(r.state.characters[0].id,'real');assert.equal(s.raw(),raw)});
test('invalid JSON and invalid schema block saves without replacing originals',()=>{for(const raw of ['not-json','{"characters":[{"id":"real"}]}']){const s=storage(raw),r=readStoredLibrary(s,key,{validate,seed});assert.equal(r.kind,'blocked');assert.equal(r.raw,raw);assert.throws(()=>writeStoredLibrary(s,key,r.state,{blocked:true}),/원본/);assert.equal(s.raw(),raw)}});
test('storage access failures do not become an apparently empty fresh device',()=>{const s={getItem(){throw new Error('permission blocked')},setItem(){assert.fail('must not write')}};assert.equal(readStoredLibrary(s,key,{validate,seed}).kind,'blocked')});
test('only explicit restored state may unblock storage writes; quota errors propagate',()=>{const s=storage('original'),next={books:[],characters:[{id:'restored'}]};writeStoredLibrary(s,key,next);assert.deepEqual(JSON.parse(s.raw()),next);assert.throws(()=>writeStoredLibrary({setItem(){throw new Error('quota')}},key,next),/quota/)});

test('A-2 one malformed book is quarantined while valid books remain readable and original records survive saves', async()=>{
  const {validateStoredLibrary}=await import('../dist/library-storage.js');
  const good={id:'good',title:'좋은 책',pages:[{ko:'안녕',en:'Hi'}]},bad={...good,id:'bad',pages:[{ko:'안녕',en:'Hi',imageUrl:'javascript:bad'}]};
  const raw=JSON.stringify({books:[bad,good],characters:[{id:'c',name:'유하'}],backgrounds:[],settings:{}}),s=storage(raw);
  const result=readStoredLibrary(s,key,{validate:validateStoredLibrary,seed});assert.equal(result.kind,'ready');assert.deepEqual(result.state.books,[good]);assert.equal(result.invalidRecords.length,1);assert.equal(s.raw(),raw);
  result.state.books[0].title='바꾼 제목';writeStoredLibrary(s,key,result.state,{invalidRecords:result.invalidRecords});
  assert.deepEqual(JSON.parse(s.raw()).books[0],bad);assert.equal(JSON.parse(s.raw()).books[1].title,'바꾼 제목');
});
test('A-2 startup structure validation never decodes inline image bytes',async()=>{
  const {validateStoredLibrary}=await import('../dist/library-storage.js');const original=globalThis.atob;
  globalThis.atob=()=>assert.fail('startup must not decode base64');
  try { const result=validateStoredLibrary(JSON.stringify({books:[{id:'b',title:'그림',pages:[{ko:'안녕',en:'Hi',imageUrl:'data:image/png;base64,unvalidated'}]}],characters:[],backgrounds:[],settings:{}}));assert.equal(result.state.books.length,1); }
  finally {globalThis.atob=original;}
});
