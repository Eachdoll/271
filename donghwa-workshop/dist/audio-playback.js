import {getCredential, hasCredential} from './image-generation/vault.js';
import {validateCredentialInput} from './image-generation/credential-validation.js';
// 데스크톱 Chromium은 약 15초가 넘는 발화를 onend 없이 끊습니다. 긴 문장은 주기적인 pause/resume으로 이어 줍니다.
const needsSpeechKeepAlive=text=>typeof navigator!=='undefined'&&/Chrome\//.test(navigator.userAgent||'')&&!/Android|Mobile/.test(navigator.userAgent||'')&&String(text).length>120;

// Audio blobs stay in IndexedDB. Book JSON contains only asset IDs and timings.
const DATABASE = 'donghwa-workshop-audio-v1';
const STORE = 'audio';
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const MAX_RECORDING_MS = 10 * 60 * 1000;
const LANGUAGES = ['ko', 'en'];
export const AUDIO_MODELS = Object.freeze({speech:'gpt-4o-mini-tts', alignment:'whisper-1', voice:'coral'});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const abortError = () => new DOMException('음성 작업을 취소했어요.', 'AbortError');
const uid = () => 'audio-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
let api, configured = false, playToken = 0, currentPlayback = null, recording = null, preparation = null, operationVersion = 0;

export function textFingerprint(text) {
  let hash = 2166136261;
  for (const char of String(text || '').normalize('NFC')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}

export function wordsWithOffsets(text) {
  return [...String(text || '').matchAll(/\S+/gu)].map((match,index) => ({index,word:match[0],startChar:match.index,endChar:match.index + match[0].length}));
}
const normalizeWord = value => String(value || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

/** Transcript alignment is used only when every word matches the displayed text. */
export function makeWordTimings(text, duration, transcriptWords = []) {
  const words = wordsWithOffsets(text);
  const validDuration = Number.isFinite(duration) && duration > 0 ? duration : Math.max(1,words.length / 2.5);
  const candidates = transcriptWords.filter(item => normalizeWord(item.word));
  const exact = candidates.length === words.length && candidates.every((item,index) =>
    normalizeWord(item.word) === normalizeWord(words[index].word) && Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end > item.start &&
    (index === 0 || item.start >= candidates[index - 1].start) && item.end <= validDuration + 1);
  return {timingSource:exact?'transcription':'approximate', duration:validDuration,
    timings:words.map((word,index) => ({...word,start:exact?candidates[index].start:index*validDuration/words.length,end:exact?candidates[index].end:(index+1)*validDuration/words.length}))};
}

function database() {
  return new Promise((resolve,reject) => {
    if (!globalThis.indexedDB) { reject(new Error('이 브라우저에서는 음원을 저장할 수 없어요.')); return; }
    const request = indexedDB.open(DATABASE,1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE,{keyPath:'id'}); };
    request.onerror = () => reject(new Error('음원 저장소를 열 수 없어요. 사이트 저장 권한을 확인해 주세요.'));
    request.onblocked = () => reject(new Error('다른 공방 탭을 닫고 다시 시도해 주세요.'));
    request.onsuccess = () => { const db=request.result; db.onversionchange=()=>db.close(); resolve(db); };
  });
}
async function audioTransaction(mode,operation) {
  const db=await database();
  try { return await new Promise((resolve,reject) => {
    const transaction=db.transaction(STORE,mode), store=transaction.objectStore(STORE); let result;
    const request=operation(store);
    request.onsuccess=()=>{result=request.result;};
    transaction.oncomplete=()=>resolve(result);
    transaction.onabort=()=>reject(new Error('음원을 저장하거나 읽지 못했어요. 기기의 저장 공간을 확인해 주세요.'));
    transaction.onerror=()=>{};
  }); } finally { db.close(); }
}
export async function saveAudioAsset(blob,{id=uid()}={}) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_AUDIO_BYTES || !/^(audio\/|video\/webm)/i.test(blob.type)) throw new Error('지원하는 30MB 이하 음원만 저장할 수 있어요.');
  if (!/^audio-[a-zA-Z0-9-]{5,100}$/.test(id)) throw new Error('음원 ID가 올바르지 않아요.');
  await audioTransaction('readwrite',store=>store.put({id,blob,mimeType:blob.type,createdAt:new Date().toISOString()}));
  return id;
}
export async function getAudioAsset(id) { return id ? await audioTransaction('readonly',store=>store.get(id)) || null : null; }
export async function deleteAudioAsset(id) { if(id)await audioTransaction('readwrite',store=>store.delete(id)); }

function audioSlot(book,index,lang,create=false) {
  if (!LANGUAGES.includes(lang) || !book?.pages?.[index]) throw new Error('읽을 쪽과 언어를 확인해 주세요.');
  if (create) { book.audio ||= {version:1,pages:{}}; book.audio.pages ||= {}; book.audio.pages[index] ||= {}; book.audio.pages[index][lang] ||= {}; }
  return book.audio?.pages?.[index]?.[lang] || null;
}
function validEntry(entry,text) { return entry?.assetId && entry.textHash === textFingerprint(text) && Array.isArray(entry.timings); }
export function audioStatus(book,index,lang) {
  const slot=audioSlot(book,index,lang), text=book.pages[index][lang];
  if (validEntry(slot?.recording,text)) return {source:'recording',cached:true,timingSource:slot.recording.timingSource,label:'부모 녹음 · 저장됨'};
  if (validEntry(slot?.tts,text)) return {source:'tts',cached:true,timingSource:slot.tts.timingSource,label:'음성 · 오프라인 저장됨'};
  return {source:'browser',cached:false,timingSource:'boundary',label:'기기 음성 · 사전 저장 안 됨'};
}
function emitWord(callback,word,approximate=false) { callback?.(word ? {...word,approximate}:null); }

/** Always stops the previous page. Child playback never opens the key vault or calls an API. */
export function stopPlayback() {
  playToken++;
  const active=currentPlayback; currentPlayback=null;
  active?.cleanup?.();
  if (active?.audio) { active.audio.pause(); active.audio.src=''; }
  if (globalThis.speechSynthesis) speechSynthesis.cancel();
  if (active?.url) URL.revokeObjectURL(active.url);
  emitWord(active?.onWord,null);
}
export async function playback(book,index,lang,{rate=1,onWord,onEnd,onError,signal}={}) {
  stopPlayback(); const token=playToken;
  const text=String(book?.pages?.[index]?.[lang] || '');
  if (!text.trim()) { onEnd?.(); return {source:'empty',cached:false}; }
  if (!LANGUAGES.includes(lang)) throw new Error('한글 또는 영어를 골라 주세요.');
  if (signal?.aborted) throw abortError();
  const slot=audioSlot(book,index,lang), candidates=[['recording',slot?.recording],['tts',slot?.tts]];
  for (const [source,entry] of candidates) {
    if (!validEntry(entry,text)) continue;
    let asset; try { asset=await getAudioAsset(entry.assetId); } catch { continue; }
    if (token!==playToken || signal?.aborted) return {source:'cancelled',cached:false};
    if (!asset?.blob) continue;
    const url=URL.createObjectURL(asset.blob), audio=new Audio(url); let lastWord=-1;
    audio.playbackRate=Math.max(.5,Math.min(1.5,Number(rate)||1));
    const sync=()=>{ if(token!==playToken)return; const word=entry.timings.find(item=>audio.currentTime>=item.start&&audio.currentTime<item.end); if ((word?.index ?? -1)!==lastWord) { lastWord=word?.index??-1; emitWord(onWord,word,entry.timingSource==='approximate'); } };
    const interval=setInterval(sync,50);
    const abort=()=>{if(token===playToken)stopPlayback();};
    const cleanup=()=>{clearInterval(interval);signal?.removeEventListener('abort',abort);audio.onended=null;audio.onerror=null;audio.ontimeupdate=null;};
    currentPlayback={audio,url,onWord,cleanup};
    audio.ontimeupdate=sync;
    audio.onended=()=>{if(token!==playToken)return;cleanup();URL.revokeObjectURL(url);currentPlayback=null;emitWord(onWord,null);onEnd?.();};
    audio.onerror=()=>{if(token!==playToken)return;stopPlayback();onError?.(new Error('저장된 음원을 재생할 수 없어요.'));};
    signal?.addEventListener('abort',abort,{once:true});
    try { await audio.play(); return {source,cached:true,timingSource:entry.timingSource}; }
    catch (error) { if(token===playToken)stopPlayback();throw new Error('재생 버튼을 다시 눌러 주세요. 기기에서 소리 재생을 허용해야 해요.'); }
  }
  if (token!==playToken || signal?.aborted) return {source:'cancelled',cached:false};
  if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) throw new Error('기기 음성을 사용할 수 없어요. 부모 모드에서 음원을 저장해 주세요.');
  const utterance=new SpeechSynthesisUtterance(text), words=wordsWithOffsets(text);
  utterance.lang=lang==='ko'?'ko-KR':'en-US';utterance.rate=Math.max(.5,Math.min(1.5,Number(rate)||1));
  utterance.voice=speechSynthesis.getVoices().find(voice=>voice.lang.toLowerCase().startsWith(lang==='ko'?'ko':'en'))||null;
  const abort=()=>{if(token===playToken)stopPlayback();};
  let keepAlive=null;
  const cleanup=()=>{signal?.removeEventListener('abort',abort);utterance.onend=null;utterance.onerror=null;utterance.onboundary=null;if(keepAlive){clearInterval(keepAlive);keepAlive=null;}};
  currentPlayback={utterance,onWord,cleanup};signal?.addEventListener('abort',abort,{once:true});
  utterance.onboundary=event=>{if(token!==playToken)return;if(event.name==='word'||!event.name){const word=words.find(item=>event.charIndex>=item.startChar&&event.charIndex<item.endChar);emitWord(onWord,word);}};
  utterance.onend=()=>{if(token!==playToken)return;cleanup();currentPlayback=null;emitWord(onWord,null);onEnd?.();};
  utterance.onerror=event=>{if(token!==playToken||event.error==='canceled'||event.error==='interrupted')return;cleanup();currentPlayback=null;emitWord(onWord,null);onError?.(new Error('기기 음성을 사용할 수 없어요. 음성 설정을 확인해 주세요.'));};
  speechSynthesis.speak(utterance);
  if(needsSpeechKeepAlive(text))keepAlive=setInterval(()=>{if(token!==playToken||!speechSynthesis.speaking||speechSynthesis.paused)return;speechSynthesis.pause();speechSynthesis.resume();},10000);
  return {source:'browser',cached:false,timingSource:'boundary'};
}

export function estimateBookAudio(book) {
  const texts=(book?.pages||[]).flatMap((page,index)=>LANGUAGES.filter(lang=>book.language!==({ko:'en',en:'ko'}[lang])).map(lang=>({index,lang,text:String(page[lang]||'')}))).filter(item=>item.text.trim());
  const needed=texts.filter(item=>!validEntry(audioSlot(book,item.index,item.lang)?.tts,item.text));
  const seconds=needed.reduce((sum,item)=>sum+Math.max(2,wordsWithOffsets(item.text).length/(item.lang==='ko'?2.2:2.5)),0);
  return {pages:book?.pages?.length||0,clips:needed.length,estimatedSeconds:seconds,costUsd:Math.ceil(seconds/60*.021*1000)/1000,estimated:true,models:AUDIO_MODELS};
}
function requireParent() { if (!api?.isParent?.()) throw new Error('음성 생성과 녹음은 부모 PIN 뒤에서 사용할 수 있어요.'); }
function endpoint(value) {
  const parsed=new URL(value || 'https://api.openai.com/v1');
  if (parsed.protocol!=='https:' && !(parsed.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))) throw new Error('음성 API 주소는 HTTPS 또는 localhost여야 해요.');
  if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('음성 API 주소에는 인증 정보나 쿼리를 넣을 수 없어요.');
  return parsed.href.replace(/\/$/,'');
}
const throwIfAborted=signal=>{if(signal?.aborted)throw abortError();};
async function fetchAudioDuration(blob) {
  if (!globalThis.Audio) return 0;
  const url=URL.createObjectURL(blob), audio=new Audio();
  try { return await new Promise(resolve=>{const timeout=setTimeout(()=>resolve(0),10000);audio.onloadedmetadata=()=>{clearTimeout(timeout);resolve(Number.isFinite(audio.duration)?audio.duration:0);};audio.onerror=()=>{clearTimeout(timeout);resolve(0);};audio.src=url;}); }
  finally {audio.src='';URL.revokeObjectURL(url);}
}

/** OpenAI speech returns audio; Whisper adds real word timestamps where alignment matches. */
export async function synthesizeSpeech(text,lang,{credential,signal,baseUrl,fetchImpl=globalThis.fetch,wordTimings=true}={}) {
  if (!LANGUAGES.includes(lang) || !String(text||'').trim())throw new Error('읽을 본문과 언어가 필요해요.');
  if (!credential)throw new Error('부모 설정에 OpenAI API 키를 먼저 저장해 주세요.');
  credential=validateCredentialInput('openai',credential);
  if (String(text).length>4000)throw new Error('한 쪽의 본문이 너무 길어요. 4,000자 이하로 나눠 주세요.');
  throwIfAborted(signal);const base=endpoint(baseUrl);
  let response;
  try { response=await fetchImpl(base+'/audio/speech',{method:'POST',credentials:'omit',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify({model:AUDIO_MODELS.speech,voice:AUDIO_MODELS.voice,input:text,response_format:'mp3',instructions:lang==='ko'?'Read this Korean picture-book page gently and clearly, in Korean, for a child. Read exactly the supplied text.':'Read this English picture-book page gently and clearly for a child. Read exactly the supplied text.'}),signal}); }
  catch(error){if(signal?.aborted)throw abortError();throw new Error('음성 API에 연결할 수 없어요. CORS가 막힌 경우 부모 설정의 로컬 프록시 주소를 확인해 주세요.');}
  if(!response.ok)throw new Error('음성 API 요청을 완료하지 못했어요 (HTTP '+response.status+'). API 키와 잔액을 확인해 주세요.');
  const raw=await response.blob();throwIfAborted(signal);
  const blob=new Blob([raw],{type:'audio/mpeg'});if(!blob.size||blob.size>MAX_AUDIO_BYTES)throw new Error('음성 API의 음원을 저장할 수 없어요.');
  let transcript=null,alignmentWarning=null;
  if(wordTimings){
    const form=new FormData();form.append('file',blob,'page.mp3');form.append('model',AUDIO_MODELS.alignment);form.append('response_format','verbose_json');form.append('timestamp_granularities[]','word');form.append('language',lang);
    try { const aligned=await fetchImpl(base+'/audio/transcriptions',{method:'POST',credentials:'omit',headers:{Authorization:'Bearer '+credential},body:form,signal});if(aligned.ok)transcript=await aligned.json();else alignmentWarning='단어 정렬을 받지 못해 하이라이트는 근사 위치예요.'; }
    catch(error){if(signal?.aborted)throw abortError();alignmentWarning='단어 정렬을 받지 못해 하이라이트는 근사 위치예요.';}
  }
  throwIfAborted(signal);
  const duration=Number(transcript?.duration)||await fetchAudioDuration(blob);
  const timing=makeWordTimings(text,duration,transcript?.words||[]);
  return {blob,...timing,model:AUDIO_MODELS.speech,alignmentModel:transcript?AUDIO_MODELS.alignment:null,alignmentWarning:alignmentWarning||(timing.timingSource==='approximate'?'하이라이트는 근사 위치예요.':null)};
}

/** Caller must obtain approval for this specific book and the displayed API estimate. */
export async function prepareBookAudio(book,{approved=false,signal,onProgress,wordTimings=true}={}) {
  requireParent();if(approved!==true)throw new Error('예상 음성 비용을 확인한 부모의 승인 후 생성할 수 있어요.');
  if (preparation)throw new Error('다른 책의 음성을 저장하고 있어요.');
  const state=api.getState(), version=operationVersion;
  const pending={book,controller:new AbortController()};preparation=pending;
  const cancel=()=>pending.controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  const estimate=estimateBookAudio(book);let cached=0,failed=0,lastError=null;
  const checkContext=()=>{
    requireParent();throwIfAborted(pending.controller.signal);
    if(api.getState()!==state||operationVersion!==version||!state.books?.includes(book))throw abortError();
  };
  try {
    checkContext();const credential=await getCredential('openai');checkContext();
    if(!credential)return {cached:0,failed:0,uncached:true,message:'OpenAI API 키가 없어 기기 음성을 사용해요. 기기 음성은 사전 저장할 수 없어요.'};
    for(let index=0;index<book.pages.length;index++)for(const lang of LANGUAGES){
      if(book.language===({ko:'en',en:'ko'}[lang]))continue;
      checkContext();
      const text=String(book.pages[index][lang]||'');if(!text.trim())continue;
      const slot=audioSlot(book,index,lang,true);if(validEntry(slot.tts,text))continue;
      try {
        const generated=await synthesizeSpeech(text,lang,{credential,signal:pending.controller.signal,baseUrl:api.getState?.().settings?.audioApiBaseUrl,wordTimings});
        checkContext();
        if(book.pages[index][lang]!==text)throw new Error('본문이 바뀌었어요. 새 본문으로 다시 저장해 주세요.');
        const assetId=await saveAudioAsset(generated.blob);
        try{checkContext();}catch(error){await deleteAudioAsset(assetId);throw error;}
        const previous=slot.tts;
        slot.tts={assetId,textHash:textFingerprint(text),timings:generated.timings,duration:generated.duration,timingSource:generated.timingSource,model:generated.model,alignmentModel:generated.alignmentModel,createdAt:new Date().toISOString()};
        if(api.save()===false){slot.tts=previous;await deleteAudioAsset(assetId);throw new Error('기기의 저장 공간이 부족해 음원을 저장하지 못했어요.');}
        if(previous?.assetId)void deleteAudioAsset(previous.assetId).catch(()=>{});
        cached++;
      }catch(error){if(error.name==='AbortError')throw error;failed++;lastError=error.message;}
      onProgress?.({cached,failed,total:estimate.clips,index,lang});
    }
    return {cached,failed,uncached:false,message:failed?`${cached}개 저장 · ${failed}개 실패: ${lastError}`:`${cached}개 음원을 기기에 저장했어요.`};
  }finally{signal?.removeEventListener('abort',cancel);if(preparation===pending)preparation=null;}
}

export function renderRecordingControls(book,index) {
  if (!book?.pages?.[index])return '';
  return `<div class="audio-recording-controls"><h4>${index+1}쪽 · 부모 목소리</h4><p class="small-label">녹음은 이 기기에만 저장됩니다. 녹음의 단어 하이라이트는 근사 위치예요.</p>${LANGUAGES.filter(lang=>book.language!==({ko:'en',en:'ko'}[lang])).map(lang=>{const status=audioStatus(book,index,lang);return `<div class="audio-recording-language"><strong>${lang==='ko'?'한글':'English'}</strong><small>${escape(status.label)}</small><button type="button" class="btn btn-outline" data-audio-action="record" data-book-id="${escape(book.id)}" data-page="${index}" data-lang="${lang}">● 녹음</button>${status.source==='recording'?`<button type="button" class="btn btn-outline" data-audio-action="preview" data-book-id="${escape(book.id)}" data-page="${index}" data-lang="${lang}">▶ 녹음 듣기</button><button type="button" class="btn btn-outline" data-audio-action="remove-recording" data-book-id="${escape(book.id)}" data-page="${index}" data-lang="${lang}">녹음 삭제</button>`:''}</div>`;}).join('')}</div>`;
}
export function renderAudioPreparationControls(book) {
  const estimate=estimateBookAudio(book);
  return `<div class="audio-preparation-controls"><p class="small-label">음원을 저장하면 오프라인에서도 들을 수 있어요. 저장되지 않은 쪽은 기기 음성을 사용하며, 브라우저 음성은 오프라인 재생을 보장하지 않아요.</p><button type="button" class="btn btn-outline" data-audio-action="prepare" data-book-id="${escape(book.id)}">${estimate.clips?'음원 미리 저장 · '+estimate.clips+'개':'음원 저장 상태 확인'}</button><button type="button" class="btn btn-outline" data-audio-action="open-recording" data-book-id="${escape(book.id)}">내 목소리로 녹음</button></div>`;
}
function findBook(button){const book=api.getState().books.find(item=>item.id===button.dataset.bookId);if(!book)throw new Error('녹음할 책을 찾지 못했어요.');return book;}
function showRecording(book,index=0) {
  requireParent();stopPlayback();
  api.showModal(`${api.modalHeader('내 목소리로 읽어 주기')}<label for="audio-recording-page">녹음할 쪽</label><select id="audio-recording-page" data-book-id="${escape(book.id)}">${book.pages.map((page,i)=>`<option value="${i}" ${i===index?'selected':''}>${i+1}쪽</option>`).join('')}</select><div class="audio-recording-text">${book.language!=='en'?`<p>${escape(book.pages[index].ko)}</p>`:''}${book.language!=='ko'?`<p>${escape(book.pages[index].en)}</p>`:''}</div>${renderRecordingControls(book,index)}<p id="audio-operation-status" role="status"></p>`);
}
function stopRecording({discard=false}={}) {
  const active=recording;if(!active)return;
  active.discard=discard;clearTimeout(active.timeout);
  if(active.recorder.state!=='inactive')active.recorder.stop();
  active.stream.getTracks().forEach(track=>track.stop());
}
export function cleanupAudioOperation() {
  operationVersion++;
  stopRecording({discard:true});preparation?.controller.abort();stopPlayback();
}
async function startRecording(book,index,lang) {
  requireParent();if(recording)throw new Error('현재 녹음을 먼저 마쳐 주세요.');stopPlayback();
  if(!globalThis.MediaRecorder||!navigator.mediaDevices?.getUserMedia)throw new Error('이 브라우저는 녹음을 지원하지 않아요. HTTPS 환경에서 최신 브라우저를 사용해 주세요.');
  const text=String(book.pages[index]?.[lang]||'');if(!text.trim())throw new Error('녹음할 본문이 없어요.');
  const state=api.getState(), version=operationVersion, stream=await navigator.mediaDevices.getUserMedia({audio:true});
  if(!api.isParent()||api.getState()!==state||version!==operationVersion){stream.getTracks().forEach(track=>track.stop());throw new Error('부모 모드에서 다시 녹음해 주세요.');}
  const mimeType=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  const recorder=new MediaRecorder(stream,mimeType?{mimeType}:{}), active={book,index,lang,text,state,stream,recorder,chunks:[],started:performance.now(),discard:false};recording=active;
  recorder.ondataavailable=event=>{if(event.data.size)active.chunks.push(event.data);};
  recorder.onerror=()=>{active.discard=true;stopRecording({discard:true});api.toast('녹음을 완료하지 못했어요. 마이크 권한을 확인해 주세요.');};
  recorder.onstop=async()=>{
    clearTimeout(active.timeout);active.stream.getTracks().forEach(track=>track.stop());if(recording===active)recording=null;
    if(active.discard||!api.isParent()||api.getState()!==state)return;
    try {
      if(book.pages[index][lang]!==text)throw new Error('본문이 바뀌어 녹음을 저장하지 않았어요.');
      const blob=new Blob(active.chunks,{type:recorder.mimeType||'audio/webm'});if(!blob.size)throw new Error('녹음된 소리가 없어요. 다시 녹음해 주세요.');
      const duration=await fetchAudioDuration(blob)||(performance.now()-active.started)/1000;
      if(active.discard||!api.isParent()||api.getState()!==state||version!==operationVersion)return;
      const assetId=await saveAudioAsset(blob), slot=audioSlot(book,index,lang,true), previous=slot.recording;
      if(active.discard||!api.isParent()||api.getState()!==state||version!==operationVersion){await deleteAudioAsset(assetId);return;}
      slot.recording={assetId,textHash:textFingerprint(text),...makeWordTimings(text,duration),createdAt:new Date().toISOString()};
      if(api.save()===false){slot.recording=previous;await deleteAudioAsset(assetId);return;}
      if(previous?.assetId)void deleteAudioAsset(previous.assetId).catch(()=>{});
      showRecording(book,index);api.onChanged?.(book);api.toast('부모 목소리를 이 기기에 저장했어요.');
    }catch(error){api.toast(error.message);}finally{active.chunks.length=0;}
  };
  recorder.start();active.timeout=setTimeout(()=>stopRecording(),MAX_RECORDING_MS);
  const status=document.querySelector('#audio-operation-status');if(status)status.innerHTML=`<strong>● ${lang==='ko'?'한글':'English'} 녹음 중</strong> <button type="button" class="btn btn-primary" data-audio-action="stop-recording">■ 녹음 마치고 저장</button> <button type="button" class="btn btn-outline" data-audio-action="discard-recording">취소</button>`;
}
async function removeRecording(book,index,lang) {
  requireParent();stopPlayback();const slot=audioSlot(book,index,lang), previous=slot?.recording;if(!previous)return;
  delete slot.recording;if(api.save()===false){slot.recording=previous;return;}
  await deleteAudioAsset(previous.assetId);showRecording(book,index);api.onChanged?.(book);api.toast('이 쪽의 녹음을 삭제했어요.');
}
async function showPreparation(book) {
  requireParent();const version=operationVersion, estimate=estimateBookAudio(book), saved=await hasCredential('openai');requireParent();if(version!==operationVersion)return;
  if(!estimate.clips){api.toast('이 책의 음원이 모두 저장되어 있어요.');return;}
  api.showModal(`${api.modalHeader('음원을 미리 저장할까요?')}<p class="modal-intro">${estimate.clips}개 음원을 OpenAI에서 생성해 기기에 저장합니다. 본문만 전송하고, 키·사진·캐릭터 정보는 본문에 넣지 않아요.</p>${saved?`<div class="notice">예상 API 비용 약 $${estimate.costUsd.toFixed(3)} · 추정<br>음성 생성과 단어 타임스탬프 정렬 비용을 포함한 대략적인 예상입니다. 실제 사용량과 요금에 따라 달라져요.</div><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">취소</button><button type="button" class="btn btn-primary" data-audio-action="approve-prepare" data-book-id="${escape(book.id)}">비용 확인 · 음원 생성</button></div>`:'<div class="notice">OpenAI API 키가 없어요. 기기 음성은 무료로 들을 수 있지만 미리 음원으로 저장할 수는 없어요. 부모 설정에서 키를 입력하거나 부모 목소리를 녹음해 주세요.</div>'}`);
}
async function approvePreparation(book) {
  requireParent();const version=operationVersion;api.showModal(`${api.modalHeader('음원을 저장하고 있어요')}<p id="audio-operation-status" role="status">시작하고 있어요…</p><button type="button" class="btn btn-outline" data-action="close-modal">중단 · 저장된 음원 유지</button>`);
  try{const result=await prepareBookAudio(book,{approved:true,onProgress:progress=>{const status=document.querySelector('#audio-operation-status');if(status)status.textContent=`${progress.cached+progress.failed} / ${progress.total}개 · ${progress.cached}개 저장`;}});if(api.isParent()&&!preparation&&version===operationVersion){api.closeModal();api.render();api.toast(result.message);}}
  catch(error){if(error.name!=='AbortError')api.toast(error.message);}
}
export function configureAudioUI(context) {
  api=context;if(configured)return;configured=true;
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-audio-action]');if(!button)return;event.preventDefault();
    api.protectedAction(async()=>{try{requireParent();const action=button.dataset.audioAction;
      if(action==='stop-recording'){stopRecording();return;}if(action==='discard-recording'){const current=recording;stopRecording({discard:true});if(current)showRecording(current.book,current.index);return;}
      const book=findBook(button), index=Number(button.dataset.page)||0, lang=button.dataset.lang||'ko';
      if(action==='open-recording')showRecording(book,index);
      if(action==='record')await startRecording(book,index,lang);
      if(action==='preview')await playback(book,index,lang,{onError:error=>api.toast(error.message)});
      if(action==='remove-recording')await removeRecording(book,index,lang);
      if(action==='prepare')await showPreparation(book);
      if(action==='approve-prepare')await approvePreparation(book);
    }catch(error){api.toast(error.name==='NotAllowedError'?'마이크 사용을 허용해 주세요.':error.message);}});
  });
  document.addEventListener('change',event=>{if(event.target.id==='audio-recording-page')api.protectedAction(()=>{stopRecording({discard:true});const book=api.getState().books.find(item=>item.id===event.target.dataset.bookId);if(book)showRecording(book,Number(event.target.value));});});
  window.addEventListener('pagehide',cleanupAudioOperation);
}

function referencedAudioIds(state) {
  const ids=new Set();for(const book of state.books||[])for(const page of Object.values(book.audio?.pages||{}))for(const lang of LANGUAGES)for(const source of ['recording','tts'])if(page[lang]?.[source]?.assetId)ids.add(page[lang][source].assetId);return [...ids];
}
async function blobDataUrl(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());let encoded='';for(let offset=0;offset<bytes.length;offset+=8192)encoded+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return 'data:'+blob.type+';base64,'+btoa(encoded);
}
export async function exportAudioAssets(state) {
  const exported=[];for(const id of referencedAudioIds(state)){const asset=await getAudioAsset(id);if(!asset?.blob)continue;exported.push({id,mimeType:asset.blob.type,dataUrl:await blobDataUrl(asset.blob)});}return exported;
}
export function validateAudioBackup(assets) {
  if(!Array.isArray(assets)||assets.length>2000)throw new Error('음원 백업 형식이 올바르지 않아요.');
  let total=0;const ids=new Set();for(const asset of assets){
    if(!/^audio-[a-zA-Z0-9-]{5,100}$/.test(asset?.id)||ids.has(asset.id)||typeof asset.dataUrl!=='string')throw new Error('음원 백업 ID가 올바르지 않아요.');ids.add(asset.id);
    const match=/^data:(audio\/[a-zA-Z0-9.+-]+|video\/webm)(?:;codecs=[a-zA-Z0-9,.-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(asset.dataUrl);
    if(!match||match[2].length>4*Math.ceil(MAX_AUDIO_BYTES/3))throw new Error('음원 백업에 지원하지 않는 데이터가 있어요.');
    total+=match[2].length;if(total>350*1024*1024)throw new Error('음원 백업이 너무 커요.');
  }return assets;
}
export async function restoreAudioAssets(assets) {
  validateAudioBackup(assets);for(const asset of assets){const split=asset.dataUrl.indexOf(','), header=asset.dataUrl.slice(5,split), binary=atob(asset.dataUrl.slice(split+1)),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));await saveAudioAsset(new Blob([bytes],{type:header.replace(/;base64$/,'')}),{id:asset.id});}return assets.length;
}
