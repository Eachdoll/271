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
