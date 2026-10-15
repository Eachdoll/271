import test from 'node:test';
import assert from 'node:assert/strict';
import {AUDIO_MODELS,textFingerprint,wordsWithOffsets,makeWordTimings,audioStatus,estimateBookAudio,synthesizeSpeech,playback,stopPlayback,prepareBookAudio,validateAudioBackup,renderRecordingControls,configureAudioUI,cleanupAudioOperation} from '../dist/audio-playback.js';

test('word offsets preserve Korean text and punctuation without inserting HTML',()=>{
  assert.deepEqual(wordsWithOffsets('유하가 웃어요. <img>'),[
    {index:0,word:'유하가',startChar:0,endChar:3},
    {index:1,word:'웃어요.',startChar:4,endChar:8},
    {index:2,word:'<img>',startChar:9,endChar:14}
  ]);
  assert.equal(textFingerprint('가'),textFingerprint('가'));
});
test('matching transcription has actual word times; mismatches are labelled approximate',()=>{
  const exact=makeWordTimings('I see a cat.',2,[{word:'I',start:0,end:.2},{word:'see',start:.25,end:.7},{word:'a',start:.8,end:.9},{word:'cat',start:1,end:1.8}]);
  assert.equal(exact.timingSource,'transcription');assert.equal(exact.timings[3].start,1);assert.equal(exact.timings[3].startChar,8);
  const mismatch=makeWordTimings('I see a cat.',2,[{word:'I',start:0,end:.2},{word:'see',start:.25,end:.7}]);
  assert.equal(mismatch.timingSource,'approximate');assert.equal(mismatch.timings[3].start,1.5);
  assert.equal(makeWordTimings('I see',2,[{word:'I',start:1,end:1.5},{word:'see',start:0,end:.5}]).timingSource,'approximate');
});
test('parent recording takes priority independently per language and stale text invalidates it',()=>{
  const book={pages:[{ko:'유하가 웃어요.',en:'I see a cat.'}],audio:{pages:{0:{ko:{recording:{assetId:'audio-recording1',textHash:textFingerprint('유하가 웃어요.'),timings:[],timingSource:'approximate'},tts:{assetId:'audio-tts1',textHash:textFingerprint('유하가 웃어요.'),timings:[]}},en:{tts:{assetId:'audio-tts2',textHash:textFingerprint('I see a cat.'),timings:[],timingSource:'transcription'}}}}}};
  assert.equal(audioStatus(book,0,'ko').source,'recording');assert.equal(audioStatus(book,0,'en').source,'tts');
  book.pages[0].ko='다른 본문이에요.';assert.equal(audioStatus(book,0,'ko').source,'browser');assert.equal(audioStatus(book,0,'ko').cached,false);
});
test('cache estimate includes only book languages and pending clips',()=>{
  const book={language:'ko',pages:[{ko:'유하가 친구와 같이 숲에 가요.',en:'I see a cat.'}]};
  assert.equal(estimateBookAudio(book).clips,1);assert.equal(estimateBookAudio(book).estimated,true);assert.ok(estimateBookAudio(book).costUsd>0);
  book.audio={pages:{0:{ko:{tts:{assetId:'audio-tts1',textHash:textFingerprint(book.pages[0].ko),timings:[]}}}}};assert.equal(estimateBookAudio(book).clips,0);
});
test('OpenAI speech and word alignment send exact official contracts and omit cookies',async()=>{
  const requests=[];
  const result=await synthesizeSpeech('I see a cat.','en',{credential:'test-secret-not-real',fetchImpl:async(url,options)=>{
    requests.push({url,options});
    return requests.length===1?{ok:true,blob:async()=>new Blob(['fake mp3 bytes'],{type:'audio/mpeg'})}:{ok:true,json:async()=>({duration:2,words:[{word:'I',start:0,end:.2},{word:'see',start:.3,end:.7},{word:'a',start:.8,end:.9},{word:'cat.',start:1,end:1.8}]})};
  }});
  assert.equal(requests.length,2);assert.equal(requests[0].url,'https://api.openai.com/v1/audio/speech');
  const body=JSON.parse(requests[0].options.body);assert.equal(body.input,'I see a cat.');assert.equal(body.model,AUDIO_MODELS.speech);assert.equal(body.response_format,'mp3');assert.ok(!requests[0].options.body.includes('test-secret'));
  assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[1].options.body.get('model'),'whisper-1');assert.equal(requests[1].options.body.get('timestamp_granularities[]'),'word');assert.equal(requests[1].options.body.get('language'),'en');
  assert.equal(result.timingSource,'transcription');assert.equal(result.blob.type,'audio/mpeg');
});
test('alignment failure preserves usable audio and labels approximate highlighting',async()=>{
  let requests=0;const result=await synthesizeSpeech('유하가 웃어요.','ko',{credential:'fixture',fetchImpl:async()=>++requests===1?{ok:true,blob:async()=>new Blob(['mp3'])}:{ok:false,status:503}});
  assert.equal(result.timingSource,'approximate');assert.ok(result.alignmentWarning);assert.equal(result.timings.length,2);
});
test('failed provider responses never echo secret response bodies',async()=>{
  await assert.rejects(synthesizeSpeech('I see a cat.','en',{credential:'very-secret',fetchImpl:async()=>({ok:false,status:401,text:async()=>'very-secret'})}),error=>error.message.includes('HTTP 401')&&!error.message.includes('very-secret'));
});
test('tracking IDs and masked OpenAI secrets never start speech requests',async()=>{
  let requests=0;
  for(const credential of ['key_example_tracking_identifier','sk-…masked'])await assert.rejects(synthesizeSpeech('I see a cat.','en',{credential,fetchImpl:async()=>{requests++;assert.fail('Invalid credential must not reach speech API');}}),error=>error.code==='invalid_credential'&&!error.message.includes(credential));
  assert.equal(requests,0);
});
test('aborted or invalid speech requests never touch network',async()=>{
  let requests=0;const fetchImpl=async()=>{requests++;};const controller=new AbortController();controller.abort();
  await assert.rejects(synthesizeSpeech('I see','en',{credential:'fixture',signal:controller.signal,fetchImpl}),{name:'AbortError'});
  await assert.rejects(synthesizeSpeech('I see','en',{credential:'fixture',baseUrl:'https://user:secret@example.test',fetchImpl}),/인증 정보/);
  await assert.rejects(synthesizeSpeech('I see','en',{credential:'fixture',baseUrl:'http://example.test',fetchImpl}),/HTTPS/);
  assert.equal(requests,0);
});
test('browser playback reads only the requested page, emits safe word offsets and stops explicitly',async()=>{
  const oldSpeech=globalThis.speechSynthesis,oldUtterance=globalThis.SpeechSynthesisUtterance,oldFetch=globalThis.fetch;
  const utterances=[],events=[];let requests=0,cancels=0,ended=0;
  globalThis.fetch=async()=>{requests++;};globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  globalThis.speechSynthesis={cancel(){cancels++;},getVoices:()=>[{lang:'en-US'}],speak:u=>utterances.push(u)};
  try {
    const book={pages:[{en:'I see a cat.'},{en:'Other page.'}]};
    const status=await playback(book,0,'en',{onWord:word=>events.push(word),onEnd:()=>ended++});
    assert.equal(status.cached,false);assert.equal(utterances.length,1);assert.equal(utterances[0].text,'I see a cat.');
    utterances[0].onboundary({name:'word',charIndex:8});assert.equal(events.at(-1).word,'cat.');assert.equal(events.at(-1).startChar,8);
    utterances[0].onend();assert.equal(ended,1);assert.equal(utterances.length,1);assert.equal(events.at(-1),null);assert.equal(requests,0);
    stopPlayback();assert.ok(cancels>=2);
  }finally{stopPlayback();globalThis.speechSynthesis=oldSpeech;globalThis.SpeechSynthesisUtterance=oldUtterance;globalThis.fetch=oldFetch;}
});
test('cached parent recording plays without network or browser speech',async()=>{
  const oldDB=globalThis.indexedDB,oldAudio=globalThis.Audio,oldFetch=globalThis.fetch,oldSpeech=globalThis.speechSynthesis;
  let requests=0,speech=0,played=0;
  globalThis.fetch=async()=>{requests++;};globalThis.speechSynthesis={cancel(){},speak(){speech++;}};
  globalThis.Audio=class{constructor(url){this.url=url;this.currentTime=0;}async play(){played++;}pause(){}};
  globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={objectStoreNames:{contains:()=>true},close(){},transaction(){const transaction={};transaction.objectStore=()=>({get:id=>{const get={};queueMicrotask(()=>{get.result={id,blob:new Blob(['recording'],{type:'audio/webm'})};get.onsuccess();transaction.oncomplete();});return get;}});return transaction;}};request.onsuccess();});return request;}};
  const text='I see a cat.';
  const book={pages:[{en:text}],audio:{pages:{0:{en:{recording:{assetId:'audio-recording1',textHash:textFingerprint(text),...makeWordTimings(text,2)},tts:{assetId:'audio-tts1',textHash:textFingerprint(text),...makeWordTimings(text,2)}}}}}};
  try{const result=await playback(book,0,'en');assert.equal(result.source,'recording');assert.equal(result.cached,true);assert.equal(played,1);assert.equal(requests,0);assert.equal(speech,0);}
  finally{stopPlayback();globalThis.indexedDB=oldDB;globalThis.Audio=oldAudio;globalThis.fetch=oldFetch;globalThis.speechSynthesis=oldSpeech;}
});
test('pre-generation cannot run outside parent authorization',async()=>{
  let requests=0;const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{requests++;};
  try{await assert.rejects(prepareBookAudio({pages:[{en:'I see'}]},{approved:true}),/부모 PIN/);assert.equal(requests,0);}finally{globalThis.fetch=oldFetch;}
});
test('recording controls escape book IDs; backup rejects executable and excessive payloads',()=>{
  const html=renderRecordingControls({id:'<img onerror="x">',language:'en',pages:[{en:'I see'}]},0);
  assert.ok(!html.includes('<img onerror'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('근사 위치'));
  assert.equal(validateAudioBackup([{id:'audio-backup1',dataUrl:'data:audio/mpeg;base64,YWJj'}]).length,1);
  assert.throws(()=>validateAudioBackup([{id:'audio-backup1',dataUrl:'data:text/html;base64,YWJj'}]));
  assert.throws(()=>validateAudioBackup([{id:'audio-backup1',dataUrl:'https://example.test/voice.mp3'}]));
  assert.throws(()=>validateAudioBackup([{id:'audio-backup1',dataUrl:'data:audio/mpeg;base64,YWJj'},{id:'audio-backup1',dataUrl:'data:audio/mpeg;base64,YWJj'}]));
});
test('approval precedes vault access; no-key cache result is honest and close cancels key-loading stage',async()=>{
  const originals={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,fetch:globalThis.fetch};
  const book={language:'en',pages:[{en:'I see a cat.'}]},state={books:[book],settings:{}};let reads=0,network=0;
  globalThis.document={addEventListener(){}};globalThis.window={addEventListener(){}};
  globalThis.localStorage={getItem(){reads++;return null;}};globalThis.fetch=async()=>{network++;};
  configureAudioUI({getState:()=>state,isParent:()=>true,save:()=>true,protectedAction:fn=>fn()});
  try {
    await assert.rejects(prepareBookAudio(book),/부모의 승인/);assert.equal(reads,0);
    const result=await prepareBookAudio(book,{approved:true});assert.equal(result.uncached,true);assert.ok(result.message.includes('사전 저장할 수 없어요'));assert.equal(reads,1);assert.equal(network,0);
    const pending=prepareBookAudio(book,{approved:true});cleanupAudioOperation();await assert.rejects(pending,{name:'AbortError'});assert.equal(network,0);
  }finally{cleanupAudioOperation();for(const [key,value] of Object.entries(originals))globalThis[key]=value;}
});
