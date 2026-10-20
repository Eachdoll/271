import test from 'node:test';import assert from 'node:assert/strict';
import {readStoredLibrary,writeStoredLibrary} from '../dist/library-storage.js';
const key='library',seed=()=>({books:[],characters:[{id:'sample'}]});
function storage(value){let raw=value;return {getItem:()=>raw,setItem:(_key,next)=>{raw=next},raw:()=>raw}}
const validate=raw=>{const next=JSON.parse(raw);if(!Array.isArray(next.books))throw new Error('invalid books');return next};
test('fresh browser gets samples without writing a pretend existing library',()=>{const s=storage(null),result=readStoredLibrary(s,key,{validate,seed});assert.equal(result.kind,'fresh');assert.equal(s.raw(),null)});
test('an existing library and original raw bytes survive a read and validation',()=>{const raw=' { "books": [], "characters": [{"id":"real"}] } ',s=storage(raw),r=readStoredLibrary(s,key,{validate,seed});assert.equal(r.kind,'ready');assert.equal(r.state.characters[0].id,'real');assert.equal(s.raw(),raw)});
test('invalid JSON and invalid schema block saves without replacing originals',()=>{for(const raw of ['not-json','{"characters":[{"id":"real"}]}']){const s=storage(raw),r=readStoredLibrary(s,key,{validate,seed});assert.equal(r.kind,'blocked');assert.equal(r.raw,raw);assert.throws(()=>writeStoredLibrary(s,key,r.state,{blocked:true}),/원본/);assert.equal(s.raw(),raw)}});
test('storage access failures do not become an apparently empty fresh device',()=>{const s={getItem(){throw new Error('permission blocked')},setItem(){assert.fail('must not write')}};assert.equal(readStoredLibrary(s,key,{validate,seed}).kind,'blocked')});
test('only explicit restored state may unblock storage writes; quota errors become the Korean StorageQuotaError (2026-10-20) with the browser error as cause',()=>{const s=storage('original'),next={books:[],characters:[{id:'restored'}]};writeStoredLibrary(s,key,next);assert.deepEqual(JSON.parse(s.raw()),next);assert.throws(()=>writeStoredLibrary({getItem:()=>null,setItem(){throw new Error('quota')}},key,next),(error)=>error.name==='StorageQuotaError'&&/저장 한도/.test(error.message)&&error.cause?.message==='quota')});

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
test('A-2 the app World migration v2 reload keeps the real saved library instead of blocking it',async()=>{
 const {validateStoredLibrary}=await import('../dist/library-storage.js');const {seedState}=await import('../dist/engine.js');const {migrateWorldState}=await import('../dist/image-generation/world.js');
 const state=seedState();migrateWorldState(state);state.characters[0].name='저장한 유하';state.books[0].title='실제 만든 책';assert.equal(state.version,2);const s=storage(JSON.stringify(state)),result=readStoredLibrary(s,key,{validate:validateStoredLibrary,seed});assert.equal(result.kind,'ready');assert.equal(result.state.characters[0].name,'저장한 유하');assert.equal(result.state.books[0].title,'실제 만든 책');assert.equal(result.invalidRecords.length,0);
 assert.throws(()=>validateStoredLibrary(JSON.stringify({...state,version:3})),/구조/);
});
test('R2-10 legacy empty books and HTTP images remain visible while invalid records retain distinct reasons',async()=>{
 const {validateStoredLibrary}=await import('../dist/library-storage.js');
 const books=[{id:'empty',title:'쪽 없는 옛 책',pages:[]},{id:'remote',title:'옛 그림책',pages:[{ko:'안녕',en:'Hi',imageUrl:'https://example.test/image.png'}]},{id:'http',title:'이전 HTTP 그림',pages:[{ko:'안녕',en:'Hi',imageUrl:'http://example.test/image.png'}]},{id:'bad-image',title:'잘못된 그림',pages:[{ko:'안녕',en:'Hi',imageUrl:'javascript:bad'}]},{id:'bad-text',title:'잘못된 본문',pages:[{ko:3,en:'Hi'}]}];
 const raw=JSON.stringify({books,characters:[],settings:{}}),result=validateStoredLibrary(raw);
 assert.deepEqual(result.state.books.map(b=>b.id),['empty','remote','http']);assert.equal(result.invalidRecords.length,2);assert.match(result.invalidRecords[0].error,/그림 주소/);assert.match(result.invalidRecords[1].error,/본문 형식/);
 const s=storage(raw);writeStoredLibrary(s,key,result.state,{invalidRecords:result.invalidRecords});assert.deepEqual(JSON.parse(s.raw()).books,books);
});

/* ---------- 2026-10-20 저장 한도: compressed fallback and the Korean quota error ---------- */
test('a library that does not fit as plain JSON is stored compressed, read back, and kept compressed; a hopeless one fails in Korean with sizes', async () => {
  const {encodeStoredLibrary, decodeStoredLibrary, isCompressedLibrary, isQuotaError, COMPRESSED_MARK, validateStoredLibrary} = await import('../dist/library-storage.js');
  const {seedState} = await import('../dist/engine.js');
  const state = seedState();
  state.books[0].title = '압축되는 책장';
  const plain = JSON.stringify(state), packed = encodeStoredLibrary(plain);
  assert.ok(packed.startsWith(COMPRESSED_MARK));
  assert.ok(packed.length < plain.length / 2, `${packed.length} vs ${plain.length}`);
  assert.doesNotMatch(packed, /[\uD800-\uDFFF]/u, 'no surrogate: every browser stores it unchanged');
  assert.equal(decodeStoredLibrary(packed), plain);
  assert.equal(decodeStoredLibrary(plain), plain, 'plain JSON passes through');
  // Safari-style refusal: the value is longer than the quota in UTF-16 code units.
  const quotaStorage = (limit, initial = null) => {
    let raw = initial;
    return {getItem: () => raw, setItem(_key, value) {
      if (value.length > limit) { const error = new Error('The quota has been exceeded.'); error.name = 'QuotaExceededError'; error.code = 22; throw error; }
      raw = value;
    }, raw: () => raw};
  };
  const s = quotaStorage(plain.length - 1);
  writeStoredLibrary(s, key, state);
  assert.ok(isCompressedLibrary(s.raw()), 'the plain write was refused, the compressed one landed');
  const read = readStoredLibrary(s, key, {validate: validateStoredLibrary, seed});
  assert.equal(read.kind, 'ready');
  assert.equal(read.state.books[0].title, '압축되는 책장');
  assert.equal(read.raw, s.raw(), 'raw stays the stored value (for change checks and the recovery archive)');
  // Later saves stay compressed without trying the plain write first.
  let plainTries = 0;
  const s2 = {getItem: () => s.raw(), setItem(_key, value) { if (!isCompressedLibrary(value)) plainTries++; s.setItem(_key, value); }};
  read.state.books[0].title = '두 번째 저장';
  writeStoredLibrary(s2, key, read.state);
  assert.equal(plainTries, 0);
  assert.equal(JSON.parse(decodeStoredLibrary(s.raw())).books[0].title, '두 번째 저장');
  // Too big even compressed: a Korean error that names both sizes, with the browser error as its cause.
  const tiny = quotaStorage(100);
  assert.throws(() => writeStoredLibrary(tiny, key, state), (error) => {
    assert.equal(error.name, 'StorageQuotaError');
    assert.equal(error.code, 'QUOTA');
    assert.match(error.message, /^이 기기 브라우저의 저장 한도를 넘어 책장을 저장하지 못했어요 \(책장 약 \d+\.\dMB, 압축해도 약 \d+\.\dMB\)\./u);
    assert.doesNotMatch(error.message, /quota has been exceeded/u);
    assert.equal(error.cause?.name, 'QuotaExceededError');
    return true;
  });
  assert.equal(tiny.raw(), null, 'nothing half-written');
  assert.equal(isQuotaError({name: 'NS_ERROR_DOM_QUOTA_REACHED'}), true);
  assert.equal(isQuotaError({message: 'The quota has been exceeded.'}), true);
  assert.equal(isQuotaError(new Error('permission blocked')), false);
  // Any other write failure still propagates as is.
  assert.throws(() => writeStoredLibrary({getItem: () => null, setItem() { throw new Error('permission blocked'); }}, key, state), /permission blocked/u);
});

test('the compressed form round-trips every kind of text: empty, one byte, long runs, Korean, emoji, astral, control characters, dictionary resets', async () => {
  const {encodeStoredLibrary, decodeStoredLibrary} = await import('../dist/library-storage.js');
  const samples = ['', 'a', 'ab', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '한글과 English 😀 \u{10FFFF} "quotes" \\n \n\t', '\u0000\u0001\u0002'.repeat(500), 'x'.repeat(300000)];
  // A varied text long enough to fill the 65,536-entry table and force a CLEAR.
  let varied = '';
  for (let i = 0; i < 400000; i++) varied += String.fromCharCode(0x20 + ((i * 7919 + (i >> 5)) % 0xd700));
  samples.push(varied, JSON.stringify({pages: Array.from({length: 2000}, (_, i) => ({ko: `${i}쪽 한글 문장이에요.`, en: `Page ${i} English sentence.`}))}));
  for (const text of samples) {
    const packed = encodeStoredLibrary(text);
    assert.equal(decodeStoredLibrary(packed), text, `round trip of ${text.length} chars`);
    assert.doesNotMatch(packed, /[\uD800-\uDFFF]/u);
  }
  assert.throws(() => decodeStoredLibrary('\u0001dwz1:\u0000\u0000'), /손상/u);
});
