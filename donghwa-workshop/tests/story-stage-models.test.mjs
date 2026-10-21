import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStoryStageSettings,resolveQualityStageSettings,getStoryStageModels,estimateStoryTextCost,estimateTextCost} from '../dist/text-generation/models.js';
import {getTextGenerationSettings,renderTextSettings,normalizeStoryQualitySettings} from '../dist/text-generation/settings-ui.js';

test('new stories default to medium outline and pagination, and upper prose for every API provider',()=>{
 for(const [engine,medium,upper] of [['openai','gpt-6.1-sol','gpt-6-astra'],['anthropic','claude-sonnet-5-5','claude-opus-5-5'],['google','gemini-2.5-flash','gemini-4-argon']]){
   const settings={engine,providers:{[engine]:{model:'old-single-model-setting'}}};
   for(const stage of ['outline','plotContract','sceneBriefs','pagination'])assert.deepEqual(resolveStoryStageSettings(settings,stage),{engineId:engine,config:{model:medium}});
   for(const stage of ['prose','proseDraft','enrichment','coherence','coherenceRepair'])assert.equal(resolveStoryStageSettings(settings,stage).config.model,upper);
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
 for(const stage of ['outline','plotContract','proseDraft']){
   const resolved=resolveStoryStageSettings(settings,stage);assert.equal(resolved.engineId,'local');assert.equal(resolved.config.model,'saved-local-14b');assert.equal(resolved.config.baseUrl,'http://my-pc:1234/v1');
 }
 assert.deepEqual([resolveStoryStageSettings(settings,'prose').engineId,resolveStoryStageSettings(settings,'prose').config.model],['google','gemini-4-argon']);
 assert.equal(resolveStoryStageSettings(settings,'pagination').config.model,'gemini-2.5-flash');
 assert.deepEqual([resolveStoryStageSettings(settings,'sceneBriefs').engineId,resolveStoryStageSettings(settings,'sceneBriefs').config.model],['google','gemini-2.5-flash']);
 assert.deepEqual([resolveStoryStageSettings(settings,'enrichment').engineId,resolveStoryStageSettings(settings,'enrichment').config.model],['google','gemini-4-argon']);
 for(const stage of ['coherence','coherenceRepair'])assert.deepEqual([resolveStoryStageSettings(settings,stage).engineId,resolveStoryStageSettings(settings,stage).config.model],['google','gemini-4-argon']);
});

test('local uses the saved user model for all stages, and invalid paid IDs fall back to stage defaults',()=>{
 const settings={engine:'local',providers:{local:{model:'my-local-model',baseUrl:'http://localhost:1234/v1'}}};
 for(const stage of ['outline','plotContract','sceneBriefs','proseDraft','prose','enrichment','pagination','coherence','coherenceRepair'])assert.equal(resolveStoryStageSettings(settings,stage).config.model,'my-local-model');
 assert.deepEqual(getStoryStageModels('openai',{model:'gpt-4.1-mini',stageModels:{medium:'gemini-4-argon',upper:'invented-model'}}),{medium:'gpt-6.1-sol',upper:'gpt-6-astra'});
});

test('cost estimate totals actual mixed stage rates and retains final-prose model fields',()=>{
 const settings={engine:'google',providers:{google:{stageModels:{medium:'gemini-2.5-flash',upper:'gemini-4-argon'}}}},estimate=estimateStoryTextCost({settings,pageCount:12,previousTextLength:1000,at:'2026-12-01'});
 const expectedMedium=estimateTextCost({engine:'google',model:'gemini-2.5-flash',input:6500,output:4300,at:'2026-12-01'}),expectedUpper=estimateTextCost({engine:'google',model:'gemini-4-argon',input:6500,output:8600,at:'2026-12-01'});
 const expectedBrief=estimateTextCost({engine:'google',model:'gemini-2.5-flash',input:6500,output:3500,at:'2026-12-01'}),expectedEnrichment=estimateTextCost({engine:'google',model:'gemini-4-argon',input:3000,output:1600,at:'2026-12-01'});
 const expectedOutline=estimateTextCost({engine:'google',model:'gemini-2.5-flash',input:6500,output:7700,at:'2026-12-01'}),expectedReview=estimateTextCost({engine:'google',model:'gemini-4-argon',input:18500,output:3200,at:'2026-12-01'});
 assert.equal(estimate.costUsd,expectedOutline.costUsd+expectedBrief.costUsd+expectedUpper.costUsd+expectedEnrichment.costUsd*14+expectedMedium.costUsd+expectedReview.costUsd*2);
 assert.equal(estimate.model,'gemini-4-argon');assert.equal(estimate.inputRate,4);assert.equal(estimate.outputRate,20);
 assert.equal(estimate.requestCount,20);assert.equal(estimate.inputTokensEstimated,105000);assert.equal(estimate.outputTokensEstimated,52900);
 assert.deepEqual(estimate.stages.map(row=>[row.stage,row.model]),[['outline','gemini-2.5-flash'],['sceneBriefs','gemini-2.5-flash'],['prose','gemini-4-argon'],['enrichment','gemini-4-argon'],['pagination','gemini-2.5-flash'],['coherence','gemini-4-argon']]);
 const hybrid=estimateStoryTextCost({settings:{...settings,hybrid:{enabled:true,finalEngine:'google'}}});
 assert.equal(hybrid.requestCount,21);assert.equal(hybrid.stages[0].costUsd,0);assert.equal(hybrid.stages[2].costUsd,0);assert.equal(hybrid.stages[1].engineId,'google');assert.equal(hybrid.stages[3].engineId,'google');assert.equal(hybrid.stages.at(-1).engineId,'google');
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


test('scene options default on, persist through normalized snapshots, and can be independently disabled',()=>{
 const defaults=getTextGenerationSettings({settings:{}});
 assert.equal(defaults.storyEnrichment,true);assert.equal(defaults.imageDiversity,true);
 for(const options of [{storyEnrichment:false,imageDiversity:true},{storyEnrichment:true,imageDiversity:false},{storyEnrichment:false,imageDiversity:false}]){
   const state={settings:{textGeneration:{...defaults,...options}}};
   assert.deepEqual(getTextGenerationSettings(JSON.parse(JSON.stringify(state))),state.settings.textGeneration);
   const html=renderTextSettings(state);
   for(const [id,enabled] of [['tg-story-enrichment',options.storyEnrichment],['tg-image-diversity',options.imageDiversity]]){
     const control=html.match(new RegExp('<input id="'+id+'"[^>]*>'))?.[0];assert.ok(control);assert.equal(control.includes('checked'),enabled);
   }
 }
});

test('estimates count per-language paragraphs, mandatory brief, and additional requests without claiming a fixed bill',()=>{
 const estimate=estimateStoryTextCost({settings:{engine:'openai'},beatCount:6,paragraphCount:{ko:4,en:7}});
 assert.equal(estimate.requestCount,17);assert.equal(estimate.beatCount,6);assert.deepEqual(estimate.paragraphCount,{ko:4,en:7});
 assert.equal(estimate.stages.find(stage=>stage.stage==='enrichment').requestCount,11);
 assert.equal(estimate.requestCount,estimate.stages.reduce((total,stage)=>total+stage.requestCount,0));
 const disabled=estimateStoryTextCost({settings:{storyEnrichment:false},paragraphCount:7});
 assert.equal(disabled.requestCount,6);assert.equal(disabled.enrichment,false);assert.ok(disabled.stages.some(stage=>stage.stage==='sceneBriefs'));assert.ok(!disabled.stages.some(stage=>stage.stage==='enrichment'));
 assert.ok(disabled.costUsd<estimateStoryTextCost().costUsd);
 const local=estimateStoryTextCost({settings:{engine:'local'}});assert.equal(local.costUsd,0);assert.equal(local.requestCount,20);
 // R30: the summary prices a new story as it is frozen (writers' room, editor round, 정성 모드 while on).
 const html=renderTextSettings({settings:{textGeneration:{orchestration:false}}});assert.match(html,/장면 브리프 1회/);assert.match(html,/한글·영어 풍부화·단순화 4회/);assert.match(html,/전체 일관성 검사 2회/);assert.match(html,/아이 시뮬레이터 2회/);assert.match(html,/최대 2회 재작성/);assert.match(html,/이미지 요금이 별도/);
 assert.match(renderTextSettings({settings:{textGeneration:{orchestration:false},storyQuality:{enabled:false}}}),/문단 풍부화 14회 포함/);
 const r30=renderTextSettings({settings:{}});assert.match(r30,/정성 모드\(성장 설계·줄거리 후보 3개, 비트별 작가 약 20회·중간 모델\)/);assert.doesNotMatch(r30,/풍부화·단순화/);
 assert.match(renderTextSettings({settings:{textGeneration:{writerTier:'upper'}}}),/비트별 작가 약 20회·최고 모델/);
});

test('base cost budgets two complete-story reviews and excludes conditional contract repairs',()=>{
 const simple=estimateStoryTextCost({settings:{engine:'openai',storyEnrichment:false},pageCount:12,beatCount:6}),complex=estimateStoryTextCost({settings:{engine:'openai',storyEnrichment:false},pageCount:12,beatCount:10,previousTextLength:2000});
 const reviews=complex.stages.find(stage=>stage.stage==='coherence');
 assert.equal(reviews.requestCount,2);assert.equal(reviews.model,'gpt-6-astra');
 assert.equal(reviews.inputTokensEstimated,2*(7000+11000+4300));
 assert.ok(complex.stages.find(stage=>stage.stage==='outline').outputTokensEstimated>simple.stages.find(stage=>stage.stage==='outline').outputTokensEstimated);
 assert.equal(complex.requestCount,simple.requestCount);assert.ok(complex.costUsd>simple.costUsd);
 assert.ok(!complex.stages.some(stage=>['plotContract','coherenceRepair'].includes(stage.stage)));
 assert.match(complex.note,/일관성 검사 총 2회/);assert.match(complex.note,/검사 단계별 최대 2회 재작성/);assert.match(complex.note,/추가 요금/);
});

test('quality engine roles use separate tiers, explicit providers, and immutable saved endpoints',()=>{
 const settings={engine:'openai',providers:{openai:{stageModels:{medium:'gpt-6.1-sol',upper:'gpt-6-astra'},proxyEndpoint:'https://openai.example',transport:'proxy'},google:{proxyEndpoint:'https://google.example',transport:'proxy'},local:{model:'saved-local',baseUrl:'http://localhost:1234/v1'}}};
 const before=structuredClone(settings);
 assert.equal(resolveQualityStageSettings(settings,'outline').config.model,'gpt-6-astra');
 assert.equal(resolveQualityStageSettings(settings,'prose').config.model,'gpt-6.1-sol');
 assert.equal(resolveQualityStageSettings(settings,'cheap').config.model,'gpt-4.1-mini');
 assert.equal(resolveQualityStageSettings(settings,'coach').config.model,'gpt-6-astra');
 const quality={engines:{outline:{engine:'google',model:'gemini-4-argon'},prose:{engineId:'local',model:'custom-local'},cheap:{engine:'openai',model:'invented'}}},qualityBefore=structuredClone(quality);
 const chosen=resolveQualityStageSettings(settings,'outline',quality);
 assert.equal(chosen.engineId,'google');assert.equal(chosen.config.proxyEndpoint,'https://google.example');assert.equal(chosen.config.model,'gemini-4-argon');
 assert.equal(resolveQualityStageSettings(settings,'prose',quality).config.model,'custom-local');
 assert.equal(resolveQualityStageSettings(settings,'cheap',quality).config.model,'gpt-4.1-mini');
 chosen.config.stageModels={upper:'edited'};assert.deepEqual(settings,before);assert.deepEqual(quality,qualityBefore);
 const hybrid={...settings,hybrid:{enabled:true,finalEngine:'google'}};
 assert.equal(resolveQualityStageSettings(hybrid,'outline').engineId,'local');
 for(const role of ['prose','cheap','coach'])assert.equal(resolveQualityStageSettings(hybrid,role).engineId,'google');
 assert.equal(resolveQualityStageSettings(hybrid,'outline',quality).engineId,'google');
 assert.throws(()=>resolveQualityStageSettings(settings,'images'),/역할/);
});

test('quality costs count role-specific two-pass prose, optional beam and child reviews without duplicate enrichment',()=>{
 const settings={engine:'openai',storyQuality:{enabled:true,useBeamSearch:false,twoPass:true,childSimulator:true}},estimate=estimateStoryTextCost({settings,pageCount:12,beatCount:7});
 assert.equal(estimate.quality,true);assert.equal(estimate.twoPass,true);assert.equal(estimate.requestCount,11);assert.equal(estimate.enrichment,false);
 const stage=id=>estimate.stages.find(row=>row.stage===id);
 assert.deepEqual([stage('outline').model,stage('prose').model,stage('simplification').model],['gpt-6-astra','gpt-6.1-sol','gpt-4.1-mini']);
 assert.equal(stage('prose').requestCount,2);assert.equal(stage('simplification').requestCount,2);assert.equal(stage('childSimulator').requestCount,2);assert.ok(!stage('enrichment'));
 assert.equal(estimate.costUsd,estimate.stages.reduce((sum,row)=>sum+row.costUsd,0));
 const beam=estimateStoryTextCost({settings:{...settings,storyQuality:{...settings.storyQuality,useBeamSearch:true}},beatCount:7});
 assert.equal(beam.requestCount,25);assert.equal(beam.stages.find(row=>row.stage==='beatCandidates').requestCount,7);assert.equal(beam.stages.find(row=>row.stage==='beatJudge').requestCount,7);assert.equal(beam.stages.find(row=>row.stage==='outline').qualityRole,'cheap');
 const onePass=estimateStoryTextCost({settings:{...settings,storyEnrichment:false,storyQuality:{enabled:true,twoPass:false,childSimulator:false}}});
 assert.equal(onePass.requestCount,7);assert.ok(!onePass.stages.some(row=>['simplification','childSimulator','enrichment'].includes(row.stage)));
 const onePassWithLegacyEnrichment=estimateStoryTextCost({settings:{...settings,storyQuality:{enabled:true,twoPass:false}}});assert.equal(onePassWithLegacyEnrichment.requestCount,9);assert.equal(onePassWithLegacyEnrichment.enrichment,false);
 const explicit=estimateStoryTextCost({settings:{...settings,storyQuality:{...settings.storyQuality,engines:{outline:{engine:'local'},prose:{engine:'local'},cheap:{engine:'local'}}}}});
 assert.equal(explicit.stages.filter(row=>row.qualityRole).reduce((sum,row)=>sum+row.costUsd,0),0);assert.ok(explicit.costUsd>0);
 assert.match(estimate.note,/감정 직설어 수정/);assert.match(estimate.note,/아이 시뮬레이터 지적 쪽 수정/);assert.match(estimate.note,/추가 요금/);
});

test('new text snapshots freeze separate parent quality settings without credentials or mutating saved settings',()=>{
 const state={settings:{textGeneration:{engine:'google'},storyQuality:{enabled:true,useBeamSearch:true,twoPass:false,childSimulator:false,engines:{outline:{engine:'openai',model:'gpt-6-astra',apiKey:'must-not-copy',config:{apiKey:'nested-secret'}},cheap:{engineId:'local',model:'my-model'},bad:{engine:'google'}},rules:['one'],banExamples:['two'],banWindow:12,patternBanWindow:4,unexpectedSecret:'no-copy'}}},before=structuredClone(state);
 const result=getTextGenerationSettings(state);
 assert.equal(result.storyQuality.enabled,true);assert.equal(result.storyQuality.useBeamSearch,true);assert.equal(result.storyQuality.twoPass,false);assert.equal(result.storyQuality.childSimulator,false);
 assert.deepEqual(result.storyQuality.engines,{outline:{engine:'openai',model:'gpt-6-astra'},cheap:{engine:'local',model:'my-model'}});
 assert.equal(result.storyQuality.banWindow,12);assert.equal(result.storyQuality.patternBanWindow,4);assert.doesNotMatch(JSON.stringify(result),/must-not-copy|nested-secret|unexpectedSecret/);
 result.storyQuality.rules.push('changed');assert.deepEqual(state,before);
 const defaults=getTextGenerationSettings({settings:{}}).storyQuality;assert.equal(defaults.enabled,true);assert.equal(defaults.useBeamSearch,false);assert.equal(defaults.twoPass,true);assert.equal(defaults.childSimulator,true);assert.equal(defaults.weeklyCoach,true);
 assert.equal(getTextGenerationSettings({settings:{storyQuality:{enabled:false}}}).storyQuality.enabled,false);
 assert.equal(estimateStoryTextCost({settings:getTextGenerationSettings({settings:{}})}).requestCount,11);
 assert.equal(estimateStoryTextCost({settings:{engine:'openai'}}).quality,false);
});

test('quality snapshots preserve typed world and atmosphere choices, including disabled variants, at no extra model cost',()=>{
 const source={worldId:'world_yuha-123',season:'winter',timeOfDay:'night',variantChance:0,apiKey:'must-not-copy'},before=structuredClone(source);
 const actual=normalizeStoryQualitySettings(source);
 assert.deepEqual({worldId:actual.worldId,season:actual.season,timeOfDay:actual.timeOfDay,variantChance:actual.variantChance},{worldId:'world_yuha-123',season:'winter',timeOfDay:'night',variantChance:0});
 assert.deepEqual(source,before);assert.equal(actual.apiKey,undefined);
 const snapshot=getTextGenerationSettings({settings:{storyQuality:source}});assert.equal(snapshot.storyQuality.variantChance,0);assert.equal(snapshot.storyQuality.worldId,source.worldId);
 const defaults=normalizeStoryQualitySettings();
 assert.deepEqual({worldId:defaults.worldId,season:defaults.season,timeOfDay:defaults.timeOfDay,variantChance:defaults.variantChance},{worldId:'drawer',season:'auto',timeOfDay:'auto',variantChance:.35});
 for(const worldId of ['bad/world','이야기','x'.repeat(101),'',100,{},null])assert.equal(normalizeStoryQualitySettings({worldId}).worldId,'drawer');
 for(const season of ['summer','spring','autumn','winter','none','auto'])assert.equal(normalizeStoryQualitySettings({season}).season,season);
 for(const value of [{season:'WINTER'},{timeOfDay:'afternoon'},{variantChance:'0'},{variantChance:-1},{variantChance:1.01},{variantChance:NaN},{variantChance:Infinity}]){
   const invalid=normalizeStoryQualitySettings(value);if('season'in value)assert.equal(invalid.season,'auto');if('timeOfDay'in value)assert.equal(invalid.timeOfDay,'auto');if('variantChance'in value)assert.equal(invalid.variantChance,.35);
 }
 assert.equal(normalizeStoryQualitySettings({variantChance:1}).variantChance,1);
 const originalEstimate=estimateStoryTextCost({settings:{engine:'openai',storyQuality:defaults}}),changedEstimate=estimateStoryTextCost({settings:snapshot});
 assert.equal(changedEstimate.requestCount,originalEstimate.requestCount);assert.equal(changedEstimate.costUsd,originalEstimate.costUsd);assert.deepEqual(changedEstimate.stages,originalEstimate.stages);
});

test('evaluated Anthropic outline defaults to Sonnet while explicit Opus and other providers remain selected',()=>{const settings={engine:'anthropic',providers:{anthropic:{proxyEndpoint:'https://saved-gateway.example',transport:'proxy'}}};const before=structuredClone(settings);assert.equal(resolveQualityStageSettings(settings,'outline').config.model,'claude-sonnet-5-5');assert.equal(resolveQualityStageSettings(settings,'outline',{engines:{outline:{engine:'anthropic',model:'claude-opus-5-5'}}}).config.model,'claude-opus-5-5');assert.equal(resolveQualityStageSettings(settings,'coach').config.model,'claude-opus-5-5');assert.equal(resolveQualityStageSettings({...settings,engine:'openai'},'outline').config.model,'gpt-6-astra');assert.deepEqual(settings,before);});
