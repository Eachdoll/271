import test from 'node:test';
import assert from 'node:assert/strict';
import {updateStoryDraftEngine,renderStoryEngineSelector} from '../dist/story-generation/ui.js';

const copy=value=>structuredClone(value);
function fixture(){return {id:'retained-draft',demo:false,stage:'paged',outline:{titleCandidates:['문 앞의 잎'],beats:[{index:1,summary:'유하가 둥근 문을 열어요.'}]},prose:{ko:'유하가 둥근 문을 열어요.',en:'Yuha opens the round door.'},pagination:{pages:[{pageNo:1,textKo:'문이 열려요.',textEn:'The door opens.'}]},usage:{calls:[{engine:'openai',model:'gpt-4.1-mini'}]},textSettings:{engine:'openai',providers:{openai:{model:'gpt-6-astra',proxyEndpoint:'https://gateway.example',transport:'proxy'},google:{model:'gemini-4-argon'},anthropic:{model:'claude-opus-5-5'},local:{model:'local-story-8b',baseUrl:'http://my-pc:1234/v1'}},hybrid:{enabled:false,finalEngine:'openai'}}};}

test('draft-only provider/model selection preserves original prose, outline, pages, provider connections and parent defaults',()=>{
 const draft=fixture(),before=copy(draft),defaults=copy(draft.textSettings),defaultsBefore=copy(defaults);
 let selected=updateStoryDraftEngine(draft,{engine:'google'},defaults);
 assert.equal(selected.textSettings.engine,'google');assert.equal(selected.textSettings.providers.google.model,'gemini-4-argon');
 assert.deepEqual(selected.textSettings.providers.openai,before.textSettings.providers.openai);
 assert.deepEqual(selected.textSettings.providers.local,before.textSettings.providers.local);
 selected=updateStoryDraftEngine(selected,{engine:'anthropic'});assert.equal(selected.textSettings.providers.anthropic.model,'claude-opus-5-5');
 selected=updateStoryDraftEngine(selected,{model:'claude-fable-5-1'});
 selected=updateStoryDraftEngine(selected,{engine:'openai'});assert.equal(selected.textSettings.providers.openai.model,'gpt-6-astra');
 assert.equal(selected.outline,draft.outline);assert.equal(selected.prose,draft.prose);assert.equal(selected.pagination,draft.pagination);assert.equal(selected.usage,draft.usage);
 assert.deepEqual(draft,before);assert.deepEqual(defaults,defaultsBefore);assert.equal(selected.stage,'paged');
});

test('legacy drafts hydrate missing providers from configured settings without losing frozen provider-specific config',()=>{
 const defaults=fixture().textSettings,draft={prose:{ko:'부모가 고친 글'},textSettings:{engine:'google',providers:{google:{model:'gemini-2.5-flash',proxyEndpoint:'https://old-proxy.example',transport:'proxy'}}}};
 const next=updateStoryDraftEngine(draft,{engine:'local'},defaults);assert.equal(next.textSettings.providers.local.baseUrl,'http://my-pc:1234/v1');assert.equal(next.textSettings.providers.local.model,'local-story-8b');
 assert.equal(next.textSettings.providers.google.proxyEndpoint,'https://old-proxy.example');assert.equal(next.prose,draft.prose);
 const restored=JSON.parse(JSON.stringify(next));assert.equal(updateStoryDraftEngine(restored,{engine:'google'}).textSettings.providers.google.model,'gemini-2.5-flash');
 const legacy={textSettings:{engineId:'anthropic',provider:'anthropic',configs:{anthropic:{model:'claude-opus-5-5'}}}},updated=updateStoryDraftEngine(legacy,{engine:'google'},defaults);assert.equal(updated.textSettings.engine,'google');assert.equal('engineId' in updated.textSettings,false);assert.equal('provider' in updated.textSettings,false);assert.match(renderStoryEngineSelector(updated),/value="google" selected/);
});

test('hybrid engine selection uses the selected API for final text while direct local selection explicitly leaves hybrid mode',()=>{
 let draft=fixture();draft.textSettings.engine='local';draft.textSettings.hybrid={enabled:true,finalEngine:'openai'};
 const html=renderStoryEngineSelector(draft);assert.match(html,/최종 글 엔진/);assert.match(html,/value="openai" selected/);assert.match(html,/줄거리·전문 초안은 로컬/);
 let next=updateStoryDraftEngine(draft,{engine:'google'});assert.equal(next.textSettings.engine,'google');assert.deepEqual(next.textSettings.hybrid,{enabled:true,finalEngine:'google'});
 next=updateStoryDraftEngine(next,{hybridEnabled:false});assert.equal(next.textSettings.engine,'google');assert.equal(next.textSettings.hybrid.enabled,false);
 next=updateStoryDraftEngine(next,{hybridEnabled:true});next=updateStoryDraftEngine(next,{engine:'local'});assert.equal(next.textSettings.hybrid.enabled,false);assert.equal(next.textSettings.providers.local.model,'local-story-8b');
 next=updateStoryDraftEngine(next,{model:'my-new-model'});assert.equal(next.textSettings.providers.local.model,'my-new-model');assert.throws(()=>updateStoryDraftEngine(next,{engine:'unsupported'}),/엔진/);
 assert.throws(()=>updateStoryDraftEngine(fixture(),{model:'gemini-4-argon'}),/모델/);
});

test('engine selection makes no request and keeps demo provenance until an explicit API generation action',()=>{
 const previousFetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw new Error('No network during selection');};
 try{const demo={...fixture(),demo:true},next=updateStoryDraftEngine(demo,{engine:'anthropic',model:'claude-fable-5-1'});assert.equal(next.demo,true);assert.equal(next.prose,demo.prose);const html=renderStoryEngineSelector(next);assert.match(html,/data-story-action="replace-demo-with-api"/);assert.match(html,/지금 글은 API를 호출하지 않는 데모/);assert.equal(calls,0);}finally{globalThis.fetch=previousFetch;}
});

test('rendered selections expose configured models/pricing, escape local model content, and disable every control during generation',()=>{
 const draft=fixture(),normal=renderStoryEngineSelector(draft);assert.match(normal,/id="story-text-engine"/);assert.match(normal,/id="story-text-model"/);assert.match(normal,/id="story-text-hybrid"/);assert.match(normal,/value="gpt-6-astra" selected/);assert.match(normal,/입력 \$10 \/ 출력 \$50/);assert.match(normal,/이 초안에만 저장/);assert.match(normal,/API를 호출하지 않습니다/);
 assert.doesNotMatch(normal,/type="password"|apiKey|sk-/);const busy=renderStoryEngineSelector(draft,{busy:true});for(const tag of busy.match(/<(?:select|input)\b[^>]*>/g))assert.match(tag,/disabled/);assert.doesNotMatch(busy,/data-story-action=/);
 const local=updateStoryDraftEngine(draft,{engine:'local',model:'<img src=x onerror=oops>'}),html=renderStoryEngineSelector(local);assert.match(html,/id="story-local-model"/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/http:\/\/my-pc:1234\/v1/);
});
