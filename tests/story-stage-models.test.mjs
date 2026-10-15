import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStoryStageSettings,getStoryStageModels,estimateStoryTextCost,estimateTextCost} from '../dist/text-generation/models.js';
import {getTextGenerationSettings,renderTextSettings} from '../dist/text-generation/settings-ui.js';

test('new stories default to medium outline and pagination, and upper prose for every API provider',()=>{
 for(const [engine,medium,upper] of [['openai','gpt-6.1-sol','gpt-6-astra'],['anthropic','claude-sonnet-5-5','claude-opus-5-5'],['google','gemini-2.5-flash','gemini-4-argon']]){
   const settings={engine,providers:{[engine]:{model:'old-single-model-setting'}}};
   for(const stage of ['outline','pagination'])assert.deepEqual(resolveStoryStageSettings(settings,stage),{engineId:engine,config:{model:medium}});
   for(const stage of ['prose','proseDraft'])assert.equal(resolveStoryStageSettings(settings,stage).config.model,upper);
 }
 assert.throws(()=>resolveStoryStageSettings({},'unrecognized'),/단계/);
});

test('stage selection preserves legacy preference, provider endpoints, and immutable draft snapshots',()=>{
 const settings={engine:'openai',providers:{openai:{model:'gpt-6-astra',stageModels:{medium:'gpt-4.1-mini',upper:'gpt-6.1-sol'},proxyEndpoint:'https://saved-gateway.example',transport:'proxy'}},hybrid:{enabled:false,finalEngine:'google'}};
 const before=structuredClone(settings),result=resolveStoryStageSettings(settings,'prose');
 assert.equal(result.config.model,'gpt-6.1-sol');assert.equal(result.config.proxyEndpoint,'https://saved-gateway.example');assert.equal(result.config.transport,'proxy');
 result.config.stageModels.upper='changed';result.config.model='changed';assert.deepEqual(settings,before);
 assert.equal(resolveStoryStageSettings(settings,'outline').config.model,'gpt-4.1-mini');
 const normalized=getTextGenerationSettings({settings:{textGeneration:settings}});
 assert.equal(normalized.providers.openai.model,'gpt-6-astra');assert.deepEqual(normalized.providers.openai.stageModels,before.providers.openai.stageModels);
 assert.equal(normalized.providers.openai.proxyEndpoint,'https://saved-gateway.example');
 assert.deepEqual(getTextGenerationSettings({settings:{textGeneration:JSON.parse(JSON.stringify(normalized))}}),normalized);
});

test('hybrid is off by default and only an explicit enabled flag routes outline and draft to local',()=>{
 const defaults=getTextGenerationSettings({settings:{}});assert.equal(defaults.hybrid.enabled,false);
 const providers={openai:{},google:{stageModels:{medium:'gemini-2.5-flash',upper:'gemini-4-argon'}},local:{model:'saved-local-14b',baseUrl:'http://my-pc:1234/v1'}};
 for(const flag of [undefined,false,'true'])assert.equal(resolveStoryStageSettings({engine:'openai',providers,hybrid:{enabled:flag,finalEngine:'google'}},'outline').engineId,'openai');
 const settings={engine:'openai',providers,hybrid:{enabled:true,finalEngine:'google'}};
 for(const stage of ['outline','proseDraft']){
   const resolved=resolveStoryStageSettings(settings,stage);assert.equal(resolved.engineId,'local');assert.equal(resolved.config.model,'saved-local-14b');assert.equal(resolved.config.baseUrl,'http://my-pc:1234/v1');
 }
 assert.deepEqual([resolveStoryStageSettings(settings,'prose').engineId,resolveStoryStageSettings(settings,'prose').config.model],['google','gemini-4-argon']);
 assert.equal(resolveStoryStageSettings(settings,'pagination').config.model,'gemini-2.5-flash');
});

test('local uses the saved user model for all stages, and invalid paid IDs fall back to stage defaults',()=>{
 const settings={engine:'local',providers:{local:{model:'my-local-model',baseUrl:'http://localhost:1234/v1'}}};
 for(const stage of ['outline','proseDraft','prose','pagination'])assert.equal(resolveStoryStageSettings(settings,stage).config.model,'my-local-model');
 assert.deepEqual(getStoryStageModels('openai',{model:'gpt-4.1-mini',stageModels:{medium:'gemini-4-argon',upper:'invented-model'}}),{medium:'gpt-6.1-sol',upper:'gpt-6-astra'});
});

test('cost estimate totals actual mixed stage rates and retains final-prose model fields',()=>{
 const settings={engine:'google',providers:{google:{stageModels:{medium:'gemini-2.5-flash',upper:'gemini-4-argon'}}}},estimate=estimateStoryTextCost({settings,pageCount:12,previousTextLength:1000,at:'2026-12-01'});
 const expectedMedium=estimateTextCost({engine:'google',model:'gemini-2.5-flash',input:6500,output:4300,at:'2026-12-01'}),expectedUpper=estimateTextCost({engine:'google',model:'gemini-4-argon',input:6500,output:8600,at:'2026-12-01'});
 assert.equal(estimate.costUsd,expectedMedium.costUsd+expectedUpper.costUsd+expectedMedium.costUsd);
 assert.equal(estimate.model,'gemini-4-argon');assert.equal(estimate.inputRate,4);assert.equal(estimate.outputRate,20);
 assert.equal(estimate.requestCount,3);assert.equal(estimate.inputTokensEstimated,19500);assert.equal(estimate.outputTokensEstimated,17200);
 assert.deepEqual(estimate.stages.map(row=>[row.stage,row.model]),[['outline','gemini-2.5-flash'],['prose','gemini-4-argon'],['pagination','gemini-2.5-flash']]);
 const hybrid=estimateStoryTextCost({settings:{...settings,hybrid:{enabled:true,finalEngine:'google'}}});
 assert.equal(hybrid.requestCount,4);assert.equal(hybrid.stages[0].costUsd,0);assert.equal(hybrid.stages[1].costUsd,0);assert.equal(hybrid.stages[2].engineId,'google');
});

test('parent form exposes stage selectors, API pricing, hybrid configuration, and escaped stored values',()=>{
 const state={settings:{textGeneration:{engine:'openai',providers:{openai:{model:'gpt-4.1-mini'},local:{model:'<img src=x onerror=bad>',baseUrl:'http://localhost:1234/v1'}},hybrid:{enabled:false,finalEngine:'anthropic'}}}};
 const html=renderTextSettings(state);
 assert.match(html,/id="tg-model-medium"[^]*?value="gpt-6.1-sol" selected/);assert.match(html,/id="tg-model-upper"[^]*?value="gpt-6-astra" selected/);
 assert.match(html,/id="tg-final-model-medium"/);assert.match(html,/id="tg-final-model-upper"/);assert.match(html,/id="tg-hybrid-fields" hidden/);
 assert.match(html,/id="tg-hybrid-local-model"/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 assert.match(html,/100만 토큰당 참고 단가/);assert.match(html,/12쪽 이야기 글 예상/);assert.match(html,/실제 청구액은 공급자/);
 assert.doesNotMatch(html,/<input id="tg-hybrid"[^>]* checked/);
 assert.equal(state.settings.textGeneration.providers.openai.model,'gpt-4.1-mini');assert.equal(state.settings.textGeneration.providers.openai.stageModels,undefined);
});
