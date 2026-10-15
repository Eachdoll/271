import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCredentialInput} from '../dist/image-generation/credential-validation.js';
import {saveCredential} from '../dist/image-generation/vault.js';

test('recognizable OpenAI UI identifiers are rejected without altering the previous saved credential',async()=>{
  const previous=globalThis.localStorage,records=new Map([['donghwa-workshop-credential-v1:openai','existing-encrypted-record']]);let writes=0;
  globalThis.localStorage={getItem:key=>records.get(key)??null,setItem:(key,value)=>{writes++;records.set(key,value);}};
  try {
    for(const value of ['key_example_tracking_identifier','sk-...masked','sk-…masked','sk-***masked'])await assert.rejects(saveCredential('openai',value),error=>error.code==='INVALID_CREDENTIAL'&&!error.message.includes(value));
    assert.equal(writes,0);assert.equal(records.get('donghwa-workshop-credential-v1:openai'),'existing-encrypted-record');
  }finally{globalThis.localStorage=previous;}
});
test('provider-specific validation preserves opaque compatible and local tokens',()=>{
  assert.equal(validateCredentialInput('openai','  sk-proj-example-full-secret  '),'sk-proj-example-full-secret');
  assert.equal(validateCredentialInput('local','key_local_token'),'key_local_token');
  assert.equal(validateCredentialInput('local','first.second.third'),'first.second.third');
  assert.equal(validateCredentialInput('openai','compatible-opaque-fixture'),'compatible-opaque-fixture');
});
