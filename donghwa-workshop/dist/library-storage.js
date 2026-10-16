/* Never replace unreadable browser data with a sample library on the next save. */
export function readStoredLibrary(storage,key,{validate,seed}){
  let raw=null;
  try{raw=storage.getItem(key);if(raw===null)return {state:seed(),kind:'fresh',raw:null,error:null};return {state:validate(raw),kind:'ready',raw,error:null};}
  catch(error){return {state:seed(),kind:'blocked',raw,error:String(error?.message||error)};}
}
export function writeStoredLibrary(storage,key,state,{blocked=false}={}){
  if(blocked)throw new Error('기존 데이터를 읽지 못해 원본을 보호하고 있어요. 복구 파일을 가져온 뒤 저장해 주세요.');
  storage.setItem(key,JSON.stringify(state));
}
const DB='donghwa-workshop-library-recovery',STORE='snapshots';
let pending;
function database(){
  if(!globalThis.indexedDB)return Promise.reject(new Error('이 브라우저에서 복구용 보관함을 사용할 수 없어요.'));
  if(!pending)pending=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);const timer=setTimeout(()=>reject(new Error('복구용 보관함을 여는 시간이 초과됐어요.')),8000);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});
    request.onsuccess=()=>{clearTimeout(timer);resolve(request.result)};
    request.onerror=request.onblocked=()=>{clearTimeout(timer);reject(new Error('복구용 보관함을 열지 못했어요. 기존 데이터를 바꾸지 않았어요.'))};
  }).catch(error=>{pending=null;throw error;});return pending;
}
export async function keepRecoveryPoint(text,{reason='before-import'}={}){
  if(typeof text!=='string'||!text)throw new Error('복구용 원본 데이터가 없어요.');
  const db=await database(),record={id:'recovery-'+crypto.randomUUID(),text,reason,createdAt:new Date().toISOString()};
  await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(new Error('복구용 원본을 보관하지 못했어요. 공간을 확보한 뒤 다시 시도해 주세요.'))});return record;
}
export async function latestRecoveryPoint(){
  const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]||null);r.onerror=()=>reject(new Error('복구용 보관본을 읽지 못했어요.'))});
}
