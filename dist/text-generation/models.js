/** Official model IDs and standard token rates checked 2026-10-15 (USD / million). */
export const TEXT_MODELS=Object.freeze({
  openai:Object.freeze({id:'gpt-4.1-mini',name:'OpenAI · GPT-4.1 mini',input:0.4,output:1.6,docs:'https://developers.openai.com/api/docs/models/gpt-4.1-mini'}),
  google:Object.freeze({id:'gemini-2.5-flash',name:'Google · Gemini 2.5 Flash',input:0.3,output:2.5,docs:'https://ai.google.dev/gemini-api/docs/pricing'}),
  anthropic:Object.freeze({id:'claude-haiku-4-5-20251001',name:'Anthropic · Claude Haiku 4.5',input:1,output:5,docs:'https://platform.claude.com/docs/en/models/haiku-4-5/overview'}),
  local:Object.freeze({id:null,name:'로컬 · LM Studio / Ollama',input:0,output:0,docs:'https://lmstudio.ai/docs/developer/openai-compat'})
});
export function getTextModel(engine,config={}){if(!TEXT_MODELS[engine])throw new Error('지원하는 글 엔진을 선택해 주세요.');return String(config.model||TEXT_MODELS[engine].id||'').trim();}
export function estimateTextCost({engine,engineId=engine,input=0,output=0}={}){const row=TEXT_MODELS[engineId];if(!row)throw new Error('글 엔진 요금 정보를 찾을 수 없어요.');return {costUsd:(Math.max(0,Number(input)||0)*row.input+Math.max(0,Number(output)||0)*row.output)/1e6,estimated:true,checkedAt:'2026-10-15',note:'토큰 단가 기반 추정 · 실제 청구액 아님'};}
export function estimateStoryTextCost({engine='openai',engineId=engine,pageCount=12,settings={},previousTextLength=0}={}){
  const selected=settings.engine||engineId,hybrid=settings.hybrid?.enabled,final=hybrid?settings.hybrid.finalEngine||selected:selected;
  const input=6000+Math.ceil(previousTextLength/2),output=2500+pageCount*150;
  const cost=hybrid?estimateTextCost({engineId:final,input:input*2,output:output*2}):estimateTextCost({engineId:selected,input:input*3,output:output*3});
  return {...cost,inputTokensEstimated:input*3,outputTokensEstimated:output*3,requestCount:hybrid?4:3,hybrid:!!hybrid,note:'줄거리·전문·쪽 나누기 추정 · 재작성과 긴 이전 원문 입력은 추가 비용'};
}
