const START_TIMEOUT_MS=5000;
const withDeadline=(promise,ms)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout')),ms);timer.unref?.();promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
/* Persist stop intent separately so another tab/device cannot overwrite a running job's progress. */
export const AUTO_CONTROL_KEY='donghwa-full-auto-stop-v1';
const validId=id=>/^auto-[a-zA-Z0-9-]{8,100}$/.test(id||'');
const validNonce=value=>/^[a-zA-Z0-9-]{8,100}$/.test(value||'');
function storageDefault(){try{return globalThis.localStorage;}catch{return null;}}
export function readAutoStop(id,storage=storageDefault()){try{const row=JSON.parse(storage?.getItem(AUTO_CONTROL_KEY)||'{}')[id];return row&&validNonce(row.nonce)?row:null;}catch{return null;}}
function storeStop(id,row,storage){try{const map=JSON.parse(storage?.getItem(AUTO_CONTROL_KEY)||'{}');const next=map&&typeof map==='object'&&!Array.isArray(map)?map:{};next[id]=row;const keys=Object.keys(next);for(const old of keys.slice(0,Math.max(0,keys.length-200)))delete next[old];storage?.setItem(AUTO_CONTROL_KEY,JSON.stringify(next));return !!storage;}catch{return false;}}
async function cloudControl(id,{accountId,fetchImpl=globalThis.fetch?.bind(globalThis),method='GET',nonce,signal}={}){
 if(!accountId||!fetchImpl)return null;
 const response=await fetchImpl('/api/cloud/jobs/'+encodeURIComponent(id)+'/control',{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{Accept:'application/json','X-Cloud-Account-ID':accountId,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({nonce})}:{})});
 if(!response.ok)throw Error(response.status===401||response.status===403?'중지 요청을 보낼 계정에 다시 로그인해 주세요.':'다른 기기로 중지 요청을 보내지 못했어요.');
 const result=await response.json();if(result.jobId!==id||result.stop!==null&&!validNonce(result.stop?.nonce))throw Error('중지 응답 형식을 확인해 주세요.');return result.stop;
}
export async function requestAutoStop(id,{storage=storageDefault(),accountId,fetchImpl}={}){
 if(!validId(id))throw Error('자동 제작 식별자를 확인해 주세요.');
 const row={nonce:crypto.randomUUID(),requestedAt:new Date().toISOString()},localStored=storeStop(id,row,storage);let remoteStored=false,remoteError=null;
 try{if(accountId){await cloudControl(id,{accountId,fetchImpl,method:'POST',nonce:row.nonce});remoteStored=true;}}catch(error){remoteError=error.message;}
 if(!localStored&&!remoteStored)throw Error(remoteError||'중지 요청을 저장하지 못했어요.');
 return {...row,localStored,remoteStored,remoteError};
}
export function createAutoStopWatcher(id,{accountId,storage=storageDefault(),fetchImpl,eventTarget=globalThis.window,onStop=()=>{},pollMs=8000,setIntervalImpl=globalThis.setInterval,clearIntervalImpl=globalThis.clearInterval}={}){
 if(!validId(id))throw Error('자동 제작 식별자를 확인해 주세요.');
 let localBaseline=readAutoStop(id,storage)?.nonce||null,remoteBaseline=null,timer=null,stopped=false,polling=false,ready=false,remoteInitialized=false;
 const pending=new AbortController();
 const stop=row=>{if(stopped||!row)return;onStop(row);};
 const local=()=>{const row=readAutoStop(id,storage);if(row&&row.nonce!==localBaseline)stop(row);};
 const listener=event=>{if(event.key===AUTO_CONTROL_KEY)local();};
 return {
  async start(){eventTarget?.addEventListener('storage',listener);try{remoteBaseline=(await withDeadline(cloudControl(id,{accountId,fetchImpl,signal:pending.signal}),START_TIMEOUT_MS))?.nonce||null;remoteInitialized=true;}catch{/* Local stop stays available if signed out or offline. */}if(stopped)return;ready=true;timer=setIntervalImpl(async()=>{local();if(!accountId||polling||stopped)return;polling=true;try{const row=await cloudControl(id,{accountId,fetchImpl,signal:pending.signal});if(!remoteInitialized){remoteBaseline=row?.nonce||null;remoteInitialized=true;}else if(row&&row.nonce!==remoteBaseline){storeStop(id,row,storage);stop(row);}}catch{/* Keep checkpoints and retry the control endpoint later. */}finally{polling=false;}},pollMs);timer?.unref?.();local();},
  check(){if(ready)local();},
  close(){stopped=true;pending.abort();if(timer!==null)clearIntervalImpl(timer);eventTarget?.removeEventListener('storage',listener);},
 };
}
