/** Official model IDs and standard token rates checked 2026-10-15 (USD / million). */
const CHECKED_AT='2026-10-15';
const reasoning=(profile='none',effort=null,supportedEfforts=[])=>Object.freeze({profile,effort,supportedEfforts:Object.freeze(supportedEfforts)});
const row=value=>Object.freeze({label:value.name,supportsTemperature:true,reasoning:reasoning(),maxOutputTokens:128000,requestOutputTokens:0,timeoutMs:180000,...value});
/** Existing installations keep these defaults until a parent selects another model. */
export const TEXT_MODELS=Object.freeze({
  openai:row({id:'gpt-4.1-mini',name:'OpenAI · GPT-4.1 mini',tier:'economy',input:0.4,output:1.6,maxOutputTokens:32768,docs:'https://developers.openai.com/api/docs/models/gpt-4.1-mini'}),
  google:row({id:'gemini-2.5-flash',name:'Google · Gemini 2.5 Flash',tier:'economy',input:0.3,output:2.5,maxOutputTokens:65536,docs:'https://ai.google.dev/gemini-api/docs/pricing'}),
  anthropic:row({id:'claude-haiku-4-5-20251001',name:'Anthropic · Claude Haiku 4.5',tier:'economy',input:1,output:5,maxOutputTokens:64000,docs:'https://platform.claude.com/docs/en/models/haiku-4-5/overview'}),
  local:row({id:null,name:'로컬 · LM Studio / Ollama',tier:'local',input:0,output:0,docs:'https://lmstudio.ai/docs/developer/openai-compat'})
});
const premium={supportsTemperature:false,requestOutputTokens:32768,timeoutMs:600000};
const OPENAI_REASONING=reasoning('openai','low',['low','medium','high','xhigh','max']);
const CLAUDE_REASONING=reasoning('anthropic-adaptive','medium',['low','medium','high','xhigh','max']);
const CATALOG=Object.freeze({
  openai:Object.freeze([TEXT_MODELS.openai,
    row({...premium,id:'gpt-6.1-sol',name:'OpenAI · GPT-6.1 Sol · 고급',tier:'advanced',input:2,output:10,reasoning:OPENAI_REASONING,docs:'https://developers.openai.com/api/docs/models/gpt-6.1-sol'}),
    row({...premium,id:'gpt-6-astra',name:'OpenAI · GPT-6 Astra · 최고급',tier:'flagship',input:10,output:50,reasoning:OPENAI_REASONING,docs:'https://developers.openai.com/api/docs/models/gpt-6-astra'})]),
  google:Object.freeze([TEXT_MODELS.google,
    row({...premium,id:'gemini-4-argon',name:'Google · Gemini 4 Argon · 최고급',tier:'flagship',input:2,output:10,maxOutputTokens:32768,timeoutMs:1200000,reasoning:reasoning('google-thinking-level','low',['low','medium','high']),pricingChange:Object.freeze({effectiveAt:'2026-12-01',input:4,output:20}),docs:'https://ai.google.dev/gemini-api/docs/pricing'})]),
  anthropic:Object.freeze([TEXT_MODELS.anthropic,
    row({...premium,id:'claude-sonnet-5-5',name:'Anthropic · Claude Sonnet 5.5 · 고급',tier:'advanced',input:2,output:10,reasoning:CLAUDE_REASONING,docs:'https://platform.claude.com/docs/en/models/sonnet-5-5/overview'}),
    row({...premium,id:'claude-opus-5-5',name:'Anthropic · Claude Opus 5.5 · 상위',tier:'premium',input:4,output:20,reasoning:CLAUDE_REASONING,docs:'https://platform.claude.com/docs/en/models/opus-5-5/overview'}),
    row({...premium,id:'claude-fable-5-1',name:'Anthropic · Claude Fable 5.1 · 최고급',tier:'flagship',input:10,output:50,reasoning:CLAUDE_REASONING,docs:'https://platform.claude.com/docs/en/models/fable-5-1/overview'})]),
  local:Object.freeze([TEXT_MODELS.local])
});
export function listTextModels(engine){if(!Object.hasOwn(CATALOG,engine))throw new Error('지원하는 글 엔진을 선택해 주세요.');return CATALOG[engine];}
export function getTextModelInfo(engine,modelString){const models=listTextModels(engine);return models.find(item=>item.id===String(modelString||'').trim())||TEXT_MODELS[engine];}
export function resolveTextModel(engine,modelString){listTextModels(engine);return engine==='local'?String(modelString||'').trim():getTextModelInfo(engine,modelString).id;}
export function getTextModel(engine,config={}){return resolveTextModel(engine,config.model);}
export function estimateTextCost({engine,engineId=engine,input=0,output=0,model,config={},at=new Date()}={}){
  const info=getTextModelInfo(engineId,model??config.model),date=new Date(at),rates=info.pricingChange&&Number.isFinite(date.getTime())&&date>=new Date(info.pricingChange.effectiveAt+'T00:00:00Z')?info.pricingChange:info;
  return {costUsd:(Math.max(0,Number(input)||0)*rates.input+Math.max(0,Number(output)||0)*rates.output)/1e6,estimated:true,model:resolveTextModel(engineId,model??config.model),inputRate:rates.input,outputRate:rates.output,checkedAt:CHECKED_AT,note:'토큰 단가 기반 추정 · 실제 청구액 아님'};
}
export function estimateStoryTextCost({engine='openai',engineId=engine,pageCount=12,settings={},previousTextLength=0,at=new Date()}={}){
  const selected=settings.engine||engineId,hybrid=settings.hybrid?.enabled,final=hybrid?settings.hybrid.finalEngine||selected:selected,config=settings.providers?.[final]||{};
  const input=6000+Math.ceil(previousTextLength/2),baseOutput=2500+pageCount*150,reasoningFactor=getTextModelInfo(final,config.model).reasoning.profile==='none'?1:2,output=Math.ceil(baseOutput*reasoningFactor);
  const stages=hybrid?2:3,cost=estimateTextCost({engineId:final,config,input:input*stages,output:output*stages,at});
  return {...cost,inputTokensEstimated:input*3,outputTokensEstimated:output*stages+(hybrid?baseOutput*2:0),requestCount:hybrid?4:3,hybrid:!!hybrid,note:'줄거리·전문·쪽 나누기 추정 · 추론 토큰, 재작성과 긴 이전 원문 입력은 실제 사용량에 따라 달라져요'};
}
