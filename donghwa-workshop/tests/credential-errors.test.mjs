import test from 'node:test';
import assert from 'node:assert/strict';
import {missingCredentialError,credentialToastAction} from '../dist/credential-errors.js';
test('R2-6 credential actions require an explicit error code and preserve the provider and key category',()=>{
 const calls=[];for(const [kind,engine] of [['text','google'],['image','openai']]){
  const error=missingCredentialError('API 키를 등록해 주세요.',engine,kind),action=credentialToastAction(error,(...args)=>calls.push(args));
  assert.equal(error.code,'credential_missing');assert.match(action.label,kind==='text'?/글 엔진/:/그림 엔진/);action.run();
 }
 assert.deepEqual(calls,[['text','google'],['image','openai']]);
 for(const message of ['쿠키 확인 필요','스키 키트가 없어요','글 엔진 인증 실패'])assert.equal(credentialToastAction(new Error(message),()=>assert.fail()),undefined);
});
