import test from 'node:test';import assert from 'node:assert/strict';
import {createTextEngine} from '../dist/text-generation/providers.js';
const req={system:'Write an original story.',user:'A friend finds a hat.',jsonSchema:{type:'object',properties:{story:{type:'string'}}},temperature:.9,maxTokens:1000};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('OpenAI sends structured JSON, requested temperature and private header, retries JSON parsing only once',async()=>{let calls=0;const engine=createTextEngine({engine:'openai',config:{apiKey:'sk-fixture-secret',fetch:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.temperature,.9);assert.equal(body.max_completion_tokens,1000);assert.equal(body.response_format.type,'json_schema');assert.ok(!options.body.includes('sk-fixture-secret'));return json({choices:[{message:{content:calls===1?'broken json':'{"story":"An original event."}'}}],usage:{prompt_tokens:10,completion_tokens:20}});}}});const result=await engine.complete(req);assert.equal(calls,2);assert.equal(result.json.story,'An original event.');assert.equal(result.usage.input,20);assert.equal(result.usage.output,40);assert.ok(result.meta.costUsdEstimated>0);assert.equal(result.costUsd,undefined);assert.doesNotMatch(JSON.stringify(result),/sk-fixture-secret/);});
test('Google uses JSON schema and Anthropic forces one JSON tool without executing it',async()=>{for(const provider of ['google','anthropic']){const engine=createTextEngine({engine:provider,config:{apiKey:'fixture',fetch:async(_url,options)=>{const body=JSON.parse(options.body);if(provider==='google'){assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.thinkingConfig.thinkingBudget,0);return json({candidates:[{content:{parts:[{text:'{"story":"hello"}'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:20}});}assert.equal(body.tool_choice.name,'return_story_json');assert.ok(body.tools[0].input_schema);return json({content:[{type:'tool_use',name:'return_story_json',input:{story:'hello'}}],usage:{input_tokens:10,output_tokens:20}});}}});assert.equal((await engine.complete(req)).json.story,'hello');}});
test('Local model discovery accepts base URL only; proxy never forwards a browser secret',async()=>{const urls=[];const local=createTextEngine({engine:'local',config:{baseUrl:'http://127.0.0.1:1234/v1',fetch:async(url,options)=>{urls.push(url);if(url.endsWith('/models'))return json({data:[{id:'running-model'}]});assert.equal(JSON.parse(options.body).model,'running-model');assert.equal(options.headers.Authorization,undefined);return json({choices:[{message:{content:'{"story":"local"}'}}]});}}});assert.equal((await local.complete(req)).json.story,'local');assert.equal(urls.length,2);const proxy=createTextEngine({engine:'openai',config:{proxyEndpoint:'https://proxy.example.test',apiKey:'key_unused_browser_identifier',fetch:async(url,options)=>{assert.equal(url,'https://proxy.example.test/api/text/openai');assert.equal(options.headers.Authorization,undefined);assert.ok(!options.body.includes('key_unused'));return json({text:'{"story":"proxy"}',usage:{input:10,output:20}});}}});assert.equal((await proxy.complete(req)).json.story,'proxy');});
test('Tracking ID and upstream authentication failure never expose input keys',async()=>{let calls=0;await assert.rejects(createTextEngine({engine:'openai',config:{apiKey:'key_example_identifier',fetch:async()=>{calls++;}}}).complete(req),/추적 ID/);assert.equal(calls,0);await assert.rejects(createTextEngine({engine:'openai',config:{apiKey:'fixture-secret',fetch:async()=>new Response('fixture-secret rejected',{status:401})}}).complete(req),error=>error.status===401&&!error.message.includes('fixture-secret'));});

test('GPT-6 premium requests omit unsupported sampling and price the selected model',async()=>{
  for(const [model,inputRate,outputRate] of [['gpt-6.1-sol',2,10],['gpt-6-astra',10,50]]){
    const engine=createTextEngine({engine:'openai',config:{model,apiKey:'sk-fixture-secret',fetch:async(_url,options)=>{
      const body=JSON.parse(options.body);
      assert.equal(body.model,model);assert.equal(body.temperature,undefined);assert.equal(body.reasoning_effort,'low');
      assert.equal(body.max_completion_tokens,32768);assert.equal(body.response_format.type,'json_schema');
      return json({choices:[{finish_reason:'stop',message:{content:'{"story":"premium"}'}}],usage:{prompt_tokens:100,completion_tokens:200},cost_usd:.75});
    }}});
    const result=await engine.complete(req);assert.equal(result.meta.model,model);assert.equal(result.costUsd,.75);
    assert.equal(result.meta.costUsdEstimated,(100*inputRate+200*outputRate)/1e6);
  }
});

test('Gemini Argon uses thinking levels and includes billed thinking tokens in estimates',async()=>{
  const engine=createTextEngine({engine:'google',config:{model:'gemini-4-argon',apiKey:'fixture',fetch:async(url,options)=>{
    assert.ok(url.endsWith('/models/gemini-4-argon:generateContent'));
    const {generationConfig}=JSON.parse(options.body);
    assert.equal(generationConfig.temperature,undefined);assert.deepEqual(generationConfig.thinkingConfig,{thinkingLevel:'low'});
    assert.equal(generationConfig.maxOutputTokens,32768);assert.equal(generationConfig.responseMimeType,'application/json');
    return json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'hidden reasoning'},{text:'{"story":"argon"}'}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:200,thoughtsTokenCount:300}});
  }}});
  const result=await engine.complete(req);assert.equal(result.usage.output,500);assert.doesNotMatch(result.text,/hidden/);
  assert.equal(result.meta.model,'gemini-4-argon');assert.equal(result.costUsd,undefined);
});

test('current Claude models preserve dynamic schema instructions without forced tools and retry invalid JSON once',async()=>{
  for(const model of ['claude-sonnet-5-5','claude-opus-5-5','claude-fable-5-1']){
    let calls=0;const schema={type:'object',properties:{variantByCharacter:{type:'object',additionalProperties:{type:'string'}}}};
    const engine=createTextEngine({engine:'anthropic',config:{model,apiKey:'fixture',fetch:async(_url,options)=>{
      calls++;const body=JSON.parse(options.body);
      assert.equal(body.model,model);assert.equal(body.temperature,undefined);assert.equal(body.max_tokens,32768);
      assert.equal(body.tools,undefined);assert.equal(body.tool_choice,undefined);assert.equal(body.output_config.format,undefined);
      assert.deepEqual(body.thinking,{type:'adaptive'});assert.equal(body.output_config.effort,'medium');
      assert.ok(body.system.includes(JSON.stringify(schema)));
      return json({stop_reason:'end_turn',content:[{type:'thinking',thinking:'private'},{type:'text',text:calls===1?'broken':'{"variantByCharacter":{"child-1":"coat"}}'}],usage:{input_tokens:10,output_tokens:20}});
    }}});
    const result=await engine.complete({...req,jsonSchema:schema});assert.equal(calls,2);assert.equal(result.json.variantByCharacter['child-1'],'coat');
    assert.equal(result.meta.model,model);assert.equal(result.usage.output,40);assert.doesNotMatch(result.text,/private/);
  }
});

test('truncation and continuation stop after one paid request instead of retrying JSON',async()=>{
  const cases=[
    ['openai','gpt-6-astra',{choices:[{finish_reason:'length',message:{content:'{"story":'}}]},'output_limit'],
    ['google','gemini-4-argon',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"story":'}]}}]},'output_limit'],
    ['google','gemini-4-argon',{continuation_token:'opaque-token',candidates:[]},'continuation_required'],
    ['anthropic','claude-opus-5-5',{stop_reason:'max_tokens',content:[{type:'text',text:'{"story":'}]},'output_limit']
  ];
  for(const [engine,model,response,code] of cases){let calls=0;
    await assert.rejects(createTextEngine({engine,config:{model,apiKey:'fixture',fetch:async()=>{calls++;return json(response);}}}).complete(req),error=>error.code===code);
    assert.equal(calls,1);
  }
});

test('premium proxy sends the chosen model and bounded token budget without a browser secret',async()=>{
  const result=await createTextEngine({engine:'openai',config:{model:'gpt-6-astra',proxyEndpoint:'https://proxy.example.test',apiKey:'key_browser_secret_unused',fetch:async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-astra');assert.equal(body.maxTokens,32768);assert.equal(body.temperature,undefined);
    assert.ok(!options.body.includes('key_browser'));assert.equal(options.headers.Authorization,undefined);
    return json({text:'{"story":"proxy"}',usage:{input:100,output:200},meta:{model:'gpt-6-astra'}});
  }}}).complete(req);
  assert.equal(result.meta.costUsdEstimated,.011);assert.equal(result.meta.model,'gpt-6-astra');
});

test('long premium requests remain cancellable and timeout is distinct from an explicit cancel',async()=>{
  const abortable=async(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  const controller=new AbortController();const pending=createTextEngine({engine:'google',config:{model:'gemini-4-argon',apiKey:'fixture',fetch:abortable}}).complete({...req,signal:controller.signal});
  controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
  await assert.rejects(createTextEngine({engine:'openai',config:{model:'gpt-6-astra',apiKey:'fixture',timeoutMs:5,fetch:abortable}}).complete(req),error=>error.code==='timeout');
});
