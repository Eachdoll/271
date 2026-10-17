import test from 'node:test';
import assert from 'node:assert/strict';
import {resetVault,saveCredential,getCredential,listCredentialStatus,lockVault} from '../dist/image-generation/vault.js';
test('A-14 explicit vault recovery replaces corrupt metadata and preserves unrelated library data',async()=>{
 const previous=globalThis.localStorage,values=new Map([['donghwa-workshop-v1','library-original'],['donghwa-workshop-credential-v1:google','invalid encrypted record']]);
 globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 try{assert.equal((await listCredentialStatus()).google,'corrupt');await resetVault('1234');assert.equal((await listCredentialStatus()).google,false);assert.equal(values.get('donghwa-workshop-v1'),'library-original');await saveCredential('google','fixture-only');assert.equal(await getCredential('google'),'fixture-only');assert.ok(![...values.values()].some(value=>value.includes('fixture-only')));}
 finally{lockVault();globalThis.localStorage=previous;}
});
