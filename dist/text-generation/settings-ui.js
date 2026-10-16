import {getActiveWorld} from '../image-generation/world.js';
import {listTextModels,getTextModelInfo,resolveTextModel,estimateTextCost,getStoryStageModels,estimateStoryTextCost} from './models.js';
import {saveCredential,removeCredential,hasCredential} from '../image-generation/vault.js';
const ENGINES=['openai','anthropic','google','local'],NAMES={openai:'OpenAI',anthropic:'Anthropic · Claude',google:'Google · Gemini',local:'로컬 · LM Studio / Ollama'},clone=x=>JSON.parse(JSON.stringify(x));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let api,configured=false,editingSettings=null;
export function getTextGenerationSettings(state){
 const source=state.settings?.textGeneration||{},engine=ENGINES.includes(source.engine)?source.engine:'openai',providers={};
 for(const id of ENGINES){const p=source.providers?.[id]||{};providers[id]={model:resolveTextModel(id,p.model),...(id!=='local'?{stageModels:getStoryStageModels(id,p)}:{baseUrl:p.baseUrl||'http://127.0.0.1:1234/v1'}),...(p.proxyEndpoint?{proxyEndpoint:p.proxyEndpoint,transport:'proxy'}:{})};}
 return {engine,providers,storyEnrichment:source.storyEnrichment!==false,imageDiversity:source.imageDiversity!==false,hybrid:{enabled:source.hybrid?.enabled===true,finalEngine:ENGINES.slice(0,3).includes(source.hybrid?.finalEngine)?source.hybrid.finalEngine:'openai'}};
}
function options(selected,local=true){return ENGINES.filter(id=>local||id!=='local').map(id=>`<option value="${id}" ${id===selected?'selected':''}>${esc(NAMES[id])}</option>`).join('');}
function modelOptions(engine,selected){return listTextModels(engine).map(row=>`<option value="${esc(row.id)}" ${row.id===selected?'selected':''}>${esc(row.label||row.name)}</option>`).join('');}
function modelDetails(engine,model){const row=getTextModelInfo(engine,model),input=estimateTextCost({engine,model,input:1000000}).costUsd,output=estimateTextCost({engine,model,output:1000000}).costUsd;return `<p class="small-label">입력 $${input} / 출력 $${output} · 각각 100만 토큰당 참고 단가${row.pricingChange?`<br>요금 변경 예정: ${esc(row.pricingChange.effectiveAt)}부터 입력 $${row.pricingChange.input} / 출력 $${row.pricingChange.output}.`:''} · <a href="${esc(row.docs)}" target="_blank" rel="noopener noreferrer">공식 모델 안내 ↗</a></p>`;}
function providerFields(settings,engine,prefix='tg'){
 const p=settings.providers[engine];
 if(engine==='local')return `<div class="form-grid"><div class="field"><label for="${prefix}-base-url">OpenAI 호환 로컬 주소</label><input id="${prefix}-base-url" data-text-field="baseUrl" type="url" value="${esc(p.baseUrl)}" placeholder="http://127.0.0.1:1234/v1"><small>LM Studio·Ollama에서 모델과 서버를 실행하고 /v1까지 입력하세요.</small></div><div class="field"><label for="${prefix}-local-model">로컬 모델 이름 · 선택</label><input id="${prefix}-local-model" data-text-field="localModel" maxlength="200" value="${esc(p.model)}" placeholder="비우면 /v1/models의 첫 실행 모델"><small>로컬의 줄거리·초안은 이 모델을 함께 사용해요. API 요금은 없으며 컴퓨터 비용은 별도예요.</small></div></div>`;
 const models=getStoryStageModels(engine,p);
 return `<div class="form-grid"><div class="field"><label for="${prefix}-model-medium">줄거리 · 장면 디테일 · 쪽 나누기 모델</label><select id="${prefix}-model-medium" data-text-field="medium">${modelOptions(engine,models.medium)}</select><small>기본: 중간 등급</small><div data-text-price="medium">${modelDetails(engine,models.medium)}</div></div><div class="field"><label for="${prefix}-model-upper">한글·영어 전문 · 풍부화 모델</label><select id="${prefix}-model-upper" data-text-field="upper">${modelOptions(engine,models.upper)}</select><small>기본: 상위 등급</small><div data-text-price="upper">${modelDetails(engine,models.upper)}</div></div></div><div class="field"><label for="${prefix}-api-key">${esc(NAMES[engine])} API 비밀 키</label><input id="${prefix}-api-key" data-text-field="apiKey" data-text-credential-engine="${engine}" type="password" autocomplete="off" maxlength="16384" placeholder="비밀 키 전체를 입력하세요"><small>${engine==='openai'?'key_ 추적 ID나 sk-… 가려진 값 대신 생성할 때 복사한 sk- 비밀 키 전체를 입력하세요. ':''}키는 PIN으로 기기에 암호화하며 클라우드·백업에 넣지 않아요.</small></div><div class="material-add-actions"><button type="button" class="btn btn-outline" data-text-setting="save-key">키 암호화 저장</button><button type="button" class="btn btn-outline" data-text-setting="delete-key">저장된 키 삭제</button></div><div class="field" style="margin-top:15px"><label for="${prefix}-proxy">글 프록시 주소 · 선택</label><input id="${prefix}-proxy" data-text-field="proxyEndpoint" type="url" value="${esc(p.proxyEndpoint||'')}" placeholder="https://my-proxy.example"><small>프록시는 서버 환경변수 키를 사용하며 브라우저의 키를 보내지 않아요.</small></div>`;
}
function refreshCredentialLabels(){if(typeof document==='undefined')return;for(const field of document.querySelectorAll('#text-engine-form [data-text-credential-engine]'))hasCredential(field.dataset.textCredentialEngine).then(saved=>{if(field.isConnected)field.placeholder=saved?'이미지·글 엔진이 같은 저장된 키를 공유해요 · 교체 시 입력':'비밀 키 전체를 입력하세요';}).catch(()=>{});}
function providerPanel(settings,engine,prefix){if(typeof document!=='undefined')queueMicrotask(refreshCredentialLabels);return `<div data-text-provider="${engine}" data-text-prefix="${prefix}">${providerFields(settings,engine,prefix)}</div>`;}
function finalProviderFields(settings){return settings.hybrid.finalEngine===settings.engine?'<p class="small-label">위에서 고른 공급자의 전문·쪽 나누기 모델과 키를 함께 사용해요.</p>':providerPanel(settings,settings.hybrid.finalEngine,'tg-final');}
function hybridLocalFields(settings){return settings.engine==='local'?'':`<h4>하이브리드 로컬 줄거리·초안</h4>${providerPanel(settings,'local','tg-hybrid')}`;}
function priceSummary(settings){const estimate=estimateStoryTextCost({settings,pageCount:12}),enrichment=estimate.stages.find(stage=>stage.stage==='enrichment');return `<strong>12쪽 이야기 글 예상: 약 $${estimate.costUsd.toFixed(3)}</strong><br><small>약 ${estimate.requestCount}회 요청 · 장면 브리프 1회${enrichment?` + 한글·영어 문단 풍부화 ${enrichment.requestCount}회 포함`:' · 문단 풍부화 꺼짐'} (${estimate.beatCount}개 비트 가정). 검사에 걸린 장면·쪽의 최대 2회 재작성은 추가 요금이 들며, 문단 수·긴 이전 원문·실제 토큰 사용에 따라 달라져요. ${settings.imageDiversity!==false?'비슷한 이웃 그림은 한 쪽당 1회 더 생성할 수 있어 이미지 요금이 별도로 들어요. ':''}ChatGPT 등 웹 구독과 별도인 API 요금이며 실제 청구액은 공급자에서 확인하세요.</small>`;}
export function renderTextSettings(state){
 const settings=getTextGenerationSettings(state);editingSettings=clone(settings);
 return `<section class="panel" id="text-engine-settings" style="margin:24px 0"><h3>이야기 글 엔진 · 이미지 엔진과 별도</h3><p class="section-sub">줄거리·장면 디테일·쪽 나누기는 중간 등급, 전문·풍부화는 상위 모델이 기본이에요. 이 설정을 현재 World에 저장합니다.</p><form id="text-engine-form"><div class="field"><label for="tg-engine">이야기 생성 엔진</label><select id="tg-engine">${options(settings.engine)}</select></div><div id="tg-provider-fields">${providerPanel(settings,settings.engine,'tg')}</div><div class="field" style="margin-top:18px"><label><input id="tg-hybrid" type="checkbox" ${settings.hybrid.enabled?'checked':''}> 하이브리드 · 로컬 줄거리·초안 + API 전문</label><small>기본은 꺼짐이에요. 켜면 로컬 초안 후 선택한 API의 상위 모델로 전문을 다듬고 중간 모델로 쪽을 나눠요.</small></div><div id="tg-hybrid-fields" ${settings.hybrid.enabled?'':'hidden'}><div id="tg-hybrid-local-fields">${hybridLocalFields(settings)}</div><div class="field"><label for="tg-final-engine">하이브리드 최종 API 엔진</label><select id="tg-final-engine">${options(settings.hybrid.finalEngine,false)}</select></div><div id="tg-final-provider-fields">${finalProviderFields(settings)}</div></div><div class="field" style="margin-top:18px"><label><input id="tg-story-enrichment" type="checkbox" ${settings.storyEnrichment?'checked':''}> 글 풍부화</label><small>장면 디테일을 참고해 한글·영어 문단에 감각·행동·대화를 더해요. 읽기 수준과 분량은 유지하며 기본은 켜짐이에요.</small></div><div class="field"><label><input id="tg-image-diversity" type="checkbox" ${settings.imageDiversity?'checked':''}> 그림 다양성 검사</label><small>이웃한 그림이 너무 비슷하면 구도를 바꿔 한 번 더 만들어요. 본문과 고정된 배경 구조를 지키며 기본은 켜짐이에요.</small></div><div class="story-cost" id="tg-price-summary">${priceSummary(settings)}</div><p class="small-label">새 초안부터 적용해요. 이야기의 ‘변경’ 링크로 왔다면 저장 후 이야기로 돌아가 진행 중인 초안에도 적용하세요.</p><p id="tg-error" class="pin-error" role="status" aria-live="polite"></p><div class="modal-actions"><button class="btn btn-green" type="submit">글 엔진 설정 저장</button></div></form></section>`;
}
function checkedUrl(raw){if(!raw)return '';const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('주소에는 HTTP(S) 주소만 입력해 주세요.');return url.href.replace(/\/+$/,'');}
function showError(error){const el=document.querySelector('#tg-error');if(el)el.textContent=error.message;api.toast(error.message);}
function readProvider(container,{validate=false}={}){
 if(!container)return;
 const engine=container.dataset.textProvider,p=editingSettings.providers[engine],field=name=>container.querySelector(`[data-text-field="${name}"]`);
 if(engine==='local'){
   const value=field('baseUrl').value.trim();p.baseUrl=validate?checkedUrl(value):value;
   if(validate&&!p.baseUrl)throw new Error('로컬 엔드포인트 주소를 입력해 주세요.');
   p.model=field('localModel').value.trim();
 }else{
   p.stageModels={medium:resolveTextModel(engine,field('medium').value),upper:resolveTextModel(engine,field('upper').value)};
   const value=field('proxyEndpoint').value.trim(),proxy=validate?checkedUrl(value):value;
   if(proxy){p.proxyEndpoint=proxy;p.transport='proxy';}else{delete p.proxyEndpoint;delete p.transport;}
 }
}
function readProviders(validate=false){for(const container of document.querySelectorAll('#text-engine-form [data-text-provider]'))readProvider(container,{validate:validate&&!container.closest('#tg-hybrid-fields[hidden]')});}
function updatePriceSummary(){const el=document.querySelector('#tg-price-summary');if(el)el.innerHTML=priceSummary(editingSettings);}
function redrawFinal(){document.querySelector('#tg-final-provider-fields').innerHTML=finalProviderFields(editingSettings);document.querySelector('#tg-hybrid-local-fields').innerHTML=hybridLocalFields(editingSettings);}
export function configureTextSettingsUI(context){api=context;if(configured)return;configured=true;
 document.addEventListener('change',event=>{
   if(!api.isParent()||!event.target.closest('#text-engine-form'))return;
   try{
     if(!editingSettings)editingSettings=getTextGenerationSettings(api.getState());
     readProviders();
     if(event.target.id==='tg-engine'){
       editingSettings.engine=event.target.value;
       document.querySelector('#tg-provider-fields').innerHTML=providerPanel(editingSettings,editingSettings.engine,'tg');redrawFinal();
     }else if(event.target.id==='tg-final-engine'){editingSettings.hybrid.finalEngine=event.target.value;redrawFinal();}
     else if(event.target.id==='tg-hybrid'){
       editingSettings.hybrid.enabled=event.target.checked;document.querySelector('#tg-hybrid-fields').hidden=!event.target.checked;
     }else if(event.target.id==='tg-story-enrichment'){editingSettings.storyEnrichment=event.target.checked;}
     else if(event.target.id==='tg-image-diversity'){editingSettings.imageDiversity=event.target.checked;}
     else if(event.target.matches('[data-text-field="medium"],[data-text-field="upper"]')){
       const container=event.target.closest('[data-text-provider]'),level=event.target.dataset.textField;
       container.querySelector(`[data-text-price="${level}"]`).innerHTML=modelDetails(container.dataset.textProvider,event.target.value);
     }
     updatePriceSummary();
   }catch(error){showError(error);}
 });
 document.addEventListener('click',event=>{const button=event.target.closest('[data-text-setting]');if(!button)return;event.preventDefault();api.protectedAction(async()=>{try{const container=button.closest('[data-text-provider]'),engine=container.dataset.textProvider,field=container.querySelector('[data-text-field="apiKey"]');if(button.dataset.textSetting==='save-key'){await saveCredential(engine,field.value);if(field.isConnected)field.value='';api.toast('글·이미지에서 공유할 키를 암호화해 저장했어요.');}else{await removeCredential(engine);if(field)field.value='';api.toast('이 공급자의 공유 키를 삭제했어요.');}refreshCredentialLabels();const error=document.querySelector('#tg-error');if(error)error.textContent='';}catch(error){showError(error);}});});
 document.addEventListener('submit',event=>{if(event.target.id!=='text-engine-form')return;event.preventDefault();api.protectedAction(()=>{try{if(!editingSettings)editingSettings=getTextGenerationSettings(api.getState());readProviders(true);const state=api.getState(),settings=clone(editingSettings);settings.engine=document.querySelector('#tg-engine').value;settings.storyEnrichment=document.querySelector('#tg-story-enrichment').checked;settings.imageDiversity=document.querySelector('#tg-image-diversity').checked;settings.hybrid={enabled:document.querySelector('#tg-hybrid').checked,finalEngine:document.querySelector('#tg-final-engine').value};state.settings.textGeneration=clone(settings);getActiveWorld(state).textGeneration=clone(settings);if(api.save()){api.render();api.toast('이 World의 단계별 글 모델을 저장했어요.');}}catch(error){showError(error);}});});
}
