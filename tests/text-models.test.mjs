import test from 'node:test';
import assert from 'node:assert/strict';
import {TEXT_MODELS,listTextModels,getTextModelInfo,resolveTextModel,getTextModel,estimateTextCost,estimateStoryTextCost} from '../dist/text-generation/models.js';

test('model catalog preserves existing defaults and resolves only known paid model IDs',()=>{
  assert.equal(getTextModel('openai'),'gpt-4.1-mini');
  assert.equal(getTextModel('google'),'gemini-2.5-flash');
  assert.equal(getTextModel('anthropic'),'claude-haiku-4-5-20251001');
  assert.equal(resolveTextModel('openai','not-a-real-model'),TEXT_MODELS.openai.id);
  assert.equal(resolveTextModel('google',' gpt-6-astra '),TEXT_MODELS.google.id);
  assert.equal(getTextModel('openai',{model:' gpt-6-astra '}),'gpt-6-astra');
  assert.equal(resolveTextModel('local',' my-running-model '),'my-running-model');
  assert.equal(resolveTextModel('local',''),'');
  assert.throws(()=>listTextModels('missing'),/엔진/);
  assert.ok(Object.isFrozen(listTextModels('openai')));
  assert.ok(Object.isFrozen(getTextModelInfo('openai','gpt-6-astra').reasoning.supportedEfforts));
});

test('selected premium models use their own standard rates, with dated Google pricing',()=>{
  const rates=[['openai','gpt-6.1-sol',12],['openai','gpt-6-astra',60],['anthropic','claude-sonnet-5-5',12],['anthropic','claude-opus-5-5',24],['anthropic','claude-fable-5-1',60]];
  for(const [engine,model,total] of rates){
    const cost=estimateTextCost({engine,config:{model},input:1e6,output:1e6,at:'2026-10-15'});
    assert.equal(cost.costUsd,total);assert.equal(cost.model,model);assert.equal(cost.estimated,true);
  }
  const before=estimateTextCost({engine:'google',model:'gemini-4-argon',input:1e6,output:1e6,at:'2026-11-30T23:59:59Z'});
  const after=estimateTextCost({engine:'google',model:'gemini-4-argon',input:1e6,output:1e6,at:'2026-12-01T00:00:00Z'});
  assert.equal(before.costUsd,12);assert.equal(after.costUsd,24);
  assert.equal(estimateTextCost({engine:'local',model:'my-running-model',input:1e6,output:1e6}).costUsd,0);
});

test('book estimates sum the medium and upper stage models, including hybrid API final stages',()=>{
  const settings={engine:'openai',providers:{openai:{model:'gpt-6-astra'},anthropic:{model:'claude-opus-5-5'}}};
  const normal=estimateStoryTextCost({settings,pageCount:12,at:'2026-10-15'});
  assert.equal(normal.model,'gpt-6-astra');
  const outline=estimateTextCost({engine:'openai',model:'gpt-6.1-sol',input:6000,output:7700*2}),medium=estimateTextCost({engine:'openai',model:'gpt-6.1-sol',input:6000,output:(2500+12*150)*2}),upper=estimateTextCost({engine:'openai',model:'gpt-6-astra',input:6000,output:(2500+12*150)*2});
  const brief=estimateTextCost({engine:'openai',model:'gpt-6.1-sol',input:6000,output:3500*2}),enrichment=estimateTextCost({engine:'openai',model:'gpt-6-astra',input:3000,output:800*2});
  const review=estimateTextCost({engine:'openai',model:'gpt-6-astra',input:18000,output:1600*2});
  assert.equal(normal.costUsd,outline.costUsd+brief.costUsd+upper.costUsd+enrichment.costUsd*14+medium.costUsd+review.costUsd*2);assert.equal(normal.requestCount,20);
  const hybrid=estimateStoryTextCost({settings:{...settings,engine:'local',hybrid:{enabled:true,finalEngine:'anthropic'}},pageCount:12});
  assert.equal(hybrid.model,'claude-opus-5-5');assert.equal(hybrid.requestCount,21);
  const finalProse=estimateTextCost({engine:'anthropic',model:'claude-opus-5-5',input:6000,output:(2500+12*150)*2}),finalPages=estimateTextCost({engine:'anthropic',model:'claude-sonnet-5-5',input:6000,output:(2500+12*150)*2});
  const finalBrief=estimateTextCost({engine:'anthropic',model:'claude-sonnet-5-5',input:6000,output:3500*2}),finalEnrichment=estimateTextCost({engine:'anthropic',model:'claude-opus-5-5',input:3000,output:800*2});
  const finalReview=estimateTextCost({engine:'anthropic',model:'claude-opus-5-5',input:18000,output:1600*2});
  assert.equal(hybrid.costUsd,finalBrief.costUsd+finalProse.costUsd+finalEnrichment.costUsd*14+finalPages.costUsd+finalReview.costUsd*2);
});
