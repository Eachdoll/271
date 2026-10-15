import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createImageProxyHandler} from '../image-proxy/server.mjs';

test('text proxy uses server credentials, excludes client credentials and keeps provider failures private',async()=>{
  const calls=[];
  const handler=createImageProxyHandler({env:{IMAGE_PROXY_ALLOWED_ORIGINS:'https://story.example',OPENAI_API_KEY:'server-fixture-secret'},textEngineFactory:context=>({async complete(request){calls.push({context,request});if(request.user==='fail')throw new Error('server-fixture-secret: upstream private body');return {text:'{"story":"A new event"}',json:{story:'A new event'},usage:{input:10,output:20}};}})});
  const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/text/openai`;
  const request={system:'Write an original story',user:'A new event',temperature:.8,maxTokens:1000,jsonSchema:{type:'object'}};
  const send=(body,origin='https://story.example')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  try{
    const options=await fetch(url,{method:'OPTIONS',headers:{Origin:'https://story.example'}});assert.equal(options.status,204);
    const response=await send(request),data=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://story.example');assert.equal(data.usage.output,20);assert.equal(calls[0].context.config.apiKey,'server-fixture-secret');assert.ok(calls[0].request.signal);assert.equal(calls[0].request.maxTokens,1000);assert.doesNotMatch(JSON.stringify(data),/server-fixture-secret/);
    const credential=await send({...request,apiKey:'client-secret'});assert.equal(credential.status,400);assert.equal(calls.length,1);assert.doesNotMatch(await credential.text(),/client-secret/);
    const denied=await send(request,'https://untrusted.example');assert.equal(denied.status,403);assert.equal(calls.length,1);
    const failure=await send({...request,user:'fail'});assert.equal(failure.status,500);assert.doesNotMatch(await failure.text(),/server-fixture-secret|upstream private body/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
