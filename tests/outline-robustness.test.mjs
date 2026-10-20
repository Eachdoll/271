// 2026-10-19 글 생성 견고성 점검: a paid outline must not stop on a book-keeping slip of the
// model, and '다시 시도' must resume a stopped book from its saved responses. Every engine here
// is a fake; no provider is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateOutline,inspectOutlineRules} from '../dist/story-generation/pipeline.js';
import {inspectPlotContract} from '../dist/story-generation/plot-contract.js';
import {frozenBeatCount} from '../dist/story-generation/schemas.js';
import {getLevelSpec} from '../dist/reading-levels.js';
import {normalizeStoryQualitySettings} from '../dist/text-generation/settings-ui.js';
import {createTextEngine} from '../dist/text-generation/providers.js';
import {plotCheck,normalizeFailureReason} from '../story-quality/dist/plotCheck.js';

const clone=value=>JSON.parse(JSON.stringify(value));
// Package data loads through fetch(file:...): read it from disk, refuse everything else.
globalThis.fetch=async url=>{const href=String(url instanceof URL?url.href:url);if(!href.startsWith('file:'))throw new Error(`network refused in test: ${href}`);return new Response(await readFile(new URL(href),'utf8'),{headers:{'Content-Type':'application/json'}});};

function makeInput(over={}){
  return {bookId:over.bookId||'robust-book',topic:over.topic||'공룡 친구와 소풍',
    characters:[{id:'char-yuha',name:'유하',nameEn:'Yuha',kind:'child',traits:['호기심 많은','씩씩한'],catchphrase:'좋은 생각이 났어!'},{id:'char-choroki',name:'초록이',nameEn:'Choroki',kind:'dinosaur',description:'초록색 아기 공룡',traits:['느긋한','다정한'],catchphrase:'천천히 가도 괜찮아!'}],
    backgrounds:[{id:'bg-home',type:'home',name:'유하의 집'},{id:'bg-park',name:'동네 놀이터'},{id:'bg-forest',name:'숲 속 오솔길'}],
    pageCount:12,endingType:'home_sleep',moral:'천천히 함께 가기',specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')},
    catchphrasePolicy:{version:1,limit:1,omit:[],phrases:{},recentBookIds:[]},
    storyQuality:normalizeStoryQualitySettings(over.storyQuality||{})};
}
const REASON_KO={'잘못된 장소':'wrong_place','잘못된 방법':'wrong_method','거의 됐는데 방해':'interrupted'};
function seedFrom(user){
  return {planted:user.match(/- 심을 물건: (.*?) —/u)?.[1]||'노란 우산',creature:user.match(/- 배경 생물: (.*?) \(/u)?.[1]||'아기 다람쥐',
    reasons:[...user.matchAll(/\d차 (잘못된 장소|잘못된 방법|거의 됐는데 방해)/gu)].map(m=>REASON_KO[m[1]])};
}
/** A consistent ledger: both characters, the planted prop, one clue planted and paid off. */
function goodContract(outline,input,planted){
  const cast=input.characters.map(c=>c.id),turnAt=outline.beats.findIndex(b=>b.type==='turn');
  let state={characters:cast.map(id=>({characterId:id,locationId:'bg-home',knows:[]})),props:[],openPromises:[]};
  const beats=outline.beats.map((beat,i)=>{
    const before=clone(state),after=clone(state);
    after.characters.forEach(c=>{c.locationId=beat.settingKey;});
    if(i===0)after.props.push({id:'prop-planted',name:planted,ownerId:cast[0],locationId:beat.settingKey,condition:'깨끗해요'});
    after.props.forEach(p=>{p.locationId=beat.settingKey;});
    if(i===2)after.characters[0].knows.push('모래가 날리는 곳은 소풍 자리로 좋지 않아요.');
    if(i===turnAt)after.props[0].condition='그늘막으로 펼쳐졌어요';
    const setupIds=i===1?['clue-planted']:[],payoffIds=i===turnAt?['clue-planted']:[];
    after.openPromises=[...new Set([...before.openPromises,...setupIds])].filter(id=>!payoffIds.includes(id));
    state=after;
    return {beatIndex:beat.index,becauseOfBeatIndex:i===0?null:outline.beats[i-1].index,trigger:`앞 결과: ${beat.summary.slice(0,40)}`,attempt:beat.summary.slice(0,60),obstacle:'소풍 자리가 마땅하지 않아요.',result:`결과: ${beat.summary.slice(0,40)}`,nextDecision:'다음 자리로 가 보기로 해요.',stateBefore:before,stateAfter:clone(after),setupIds,payoffIds};
  });
  return {version:1,protagonistId:cast[0],goal:'초록이와 소풍 도시락을 먹어요.',resolutionCriterion:'그늘 아래에서 도시락을 다 먹어요.',beats};
}
/** A realistic outline that passes every package and app check. */
function goodOutline(input,{pattern,seed,topicWords=['공룡','소풍']}){
  const P=seed.planted,C=seed.creature,count=frozenBeatCount(input)||7;
  const types=['setup','want',...Array.from({length:count-5},()=>'attempt'),'turn','resolution','close'];
  const loc=types.map((t,i)=>i===0||i===count-1?'bg-home':i<3?'bg-park':'bg-forest'),tw=topicWords.join(' ');
  const S=[`아침에 유하가 거실에서 ${P}을 발견해요. 공룡 친구 초록이가 ${tw} 이야기를 꺼내요.`,`유하와 초록이는 놀이터 옆에서 ${tw} 바구니를 챙겨요. 둘은 ${P}도 함께 가방에 넣어요.`,'미끄럼틀 아래에서 유하가 바구니를 펼쳐요. 그런데 그곳은 모래가 날려서 자리를 옮겨야 해요.','숲 길 입구에서 초록이가 꼬리로 돗자리를 쓸어요. 돗자리가 둘둘 말려서 유하가 깔깔 웃어요.',`큰 나무 밑에서 ${C}이 나타나 바구니를 기웃거려요. 유하는 ${P}을 꺼내 그늘을 만들어요.`,`초록이와 유하는 그늘 아래에서 도시락을 나눠 먹어요. ${C}도 작은 빵 조각을 받아요.`,`저녁에 유하는 집으로 돌아와 ${P}을 침대 옆에 둬요. 초록이가 하품을 하며 손을 흔들어요.`];
  let a=0;
  const beats=types.map((type,i)=>({index:i+1,type,summary:S[i],characters:['char-yuha','char-choroki'],settingKey:loc[i],newElement:['반짝 단추','피크닉 바구니','모래 바람','둘둘 돗자리','나무 그늘','빵 조각','침대 옆 탁자'][i],failureReason:type==='attempt'?seed.reasons[a++]??'wrong_method':null}));
  const outline={plan:{pattern,planted:P,twistReveal:`${P}으로 그늘을 만들어요.`,funnyMoment:'돗자리가 둘둘 말려요.',failureReasons:seed.reasons.slice(0,count-5)},
    titleCandidates:['초록이와 소풍 가는 날','그늘을 만든 유하','둘둘 돗자리 소풍'],logline:'유하와 공룡 친구 초록이가 소풍 자리를 찾아요.',want:'초록이와 함께 소풍 도시락을 먹고 싶어요.',problem:'소풍 자리마다 문제가 생겨요.',twist:`처음에 챙긴 ${P}이 그늘이 되어 줘요.`,
    beats,refrain:{text:'천천히, 함께 가 보자.',usedAtBeats:[2,4],variation:'천천히, 함께 왔어.'},newWordsKo:['돗자리','그늘','도시락'],newWordsEn:['picnic','shade','basket'],
    settings:loc.map((backgroundId,i)=>({beatIndex:i+1,backgroundId})),emotionArc:['설렘','기대','당황','웃음','놀람','뿌듯','편안'].slice(0,count),endingType:input.endingType};
  outline.plotContract=goodContract(outline,input,P);
  return outline;
}
const isFix=user=>String(user).startsWith('아래 줄거리 JSON에서');
/**
 * App-level fake engine: answers like a cooperative model, then a case hook rewrites the JSON
 * (outline / fix / wrap) or the raw text. Every call is recorded.
 */
function fakeEngine(input,hooks={},opts={}){
  const calls=[];let seed={};
  return {id:'openai',calls,async complete(request){
    calls.push(request);const ctx={n:calls.length,request,input,get seed(){return seed;}};let json;
    if(/후보를 3개/u.test(request.system)){
      seed={...seed,planted:request.user.match(/심을 물건 (.*?) \/ 반전/u)?.[1]||seed.planted,creature:request.user.match(/\/ 생물 (.*?) \/ 웃음/u)?.[1]||seed.creature};
      const [,idx,type]=request.user.match(/\[이번에 쓸 비트\] (\d+) · (\w+)/u)||[],reason=JSON.parse(request.user.match(/"failureReason": (null|"[^"]+")/u)?.[1]||'null');
      json={candidates:['A','B','C'].map(L=>({summary:`유하와 초록이가 ${idx}번째 길에서 공룡 소풍을 준비해요. 유하가 ${seed.planted}을 들고 ${seed.creature}을 봐요. (${type}) ${L}`,newElement:`${idx}번째 소품 ${L}`,failureReason:reason}))};
    }else if(/후보 3개 중/u.test(request.system))json={best:'A',scores:{A:9,B:6,C:4}};
    else if(isFix(request.user)){json=clone(JSON.parse(request.user.split('\n\n').at(-1)));if(hooks.fix)json=hooks.fix(json,ctx);}
    else if(/APPROVED_BEAM_BEATS_JSON:/u.test(request.user)){
      const chosen=JSON.parse(request.user.match(/APPROVED_BEAM_BEATS_JSON: (.+)/u)[1]),planted=request.user.match(/심은 물건: (.*?)\. 반전/u)?.[1];
      json=goodOutline(input,{pattern:request.jsonSchema.properties.plan.properties.pattern.enum[0],seed:{planted,creature:seed.creature,reasons:chosen.filter(b=>b.type==='attempt').map(b=>b.failureReason)}});
      if(hooks.wrap)json=hooks.wrap(json,ctx);
    }else{
      seed=seedFrom(request.user);
      json=goodOutline(input,{pattern:request.jsonSchema?.properties?.plan?.properties?.pattern?.enum?.[0],seed,topicWords:opts.topicWords});
      if(hooks.outline)json=hooks.outline(json,ctx);
    }
    let text=JSON.stringify(json);
    if(hooks.text){text=hooks.text(text,ctx);return {text,usage:{input:100,output:50},costUsd:.01,meta:{requests:1,modelId:'fake-model'}};}
    return {json,text,usage:{input:100,output:50},costUsd:.01,meta:{requests:1,modelId:'fake-model'}};
  }};
}
/** Runs the real outline stage; on a stop, '다시 시도' with the saved checkpoint. */
async function run(hooks,{over={},opts={},plain=false}={}){
  const input=makeInput(over);if(plain)input.storyQuality.enabled=false;
  const engine=fakeEngine(input,hooks,opts);
  try{const result=await generateOutline(input,{engine});return {result,engine,input};}
  catch(error){return {error,engine,input};}
}
const ok=(r,calls)=>{assert.ok(!r.error,r.error?.message);assert.equal(r.engine.calls.length,calls,`paid calls: ${r.engine.calls.length}`);};
const pc=fn=>(o,ctx)=>{fn(o.plotContract,o,ctx);return o;};

test('F1 ledger book-keeping slips are cleaned up before the checks: one paid call, a valid ledger, and a resume replays it',async()=>{
  const slips=pc((c,o,ctx)=>{
    const names=Object.fromEntries(ctx.input.backgrounds.map(b=>[b.id,b.name]));
    c.version='1';c.protagonistId='유하';c.title='소풍 장부';
    c.beats[3].stateBefore.characters[0].knows=['모래가 날리는 곳은 소풍 자리로 좋지 않아.'];// paraphrased
    c.beats[2].stateBefore.props[0].condition='깨끗함';
    c.beats.forEach(b=>{b.summary='x';b.becauseOfBeatIndex=null;b.beatIndex=String(b.beatIndex);if(!b.setupIds.length)delete b.setupIds;if(!b.payoffIds.length)delete b.payoffIds;b.stateBefore.openPromises=[];b.stateAfter.openPromises=[];});
    for(const b of c.beats)for(const st of [b.stateBefore,b.stateAfter]){st.props.forEach(p=>{p.ownerId='엄마';p.locationId=names[p.locationId]||p.locationId;});st.characters.forEach(x=>{x.characterId={'char-yuha':'유하','char-choroki':'Choroki'}[x.characterId];});}
    const t=c.beats.findIndex(b=>(b.payoffIds||[]).length);for(let i=t+1;i<c.beats.length;i++){c.beats[i].stateBefore.props=[];c.beats[i].stateAfter.props=[];}
    c.beats[1].stateAfter.props[0].name='우산';
    c.beats[0].stateBefore.characters.pop();
  });
  const r=await run({outline:slips});ok(r,1);
  const data=r.result.data;assert.ok(inspectPlotContract(data.plotContract,data,r.input).valid);
  assert.equal(data.plotContract.protagonistId,'char-yuha');assert.equal(data.plotContract.version,1);
  assert.ok(data.plotContract.beats.every(b=>b.stateAfter.props.every(p=>p.ownerId===null)));
  assert.ok(r.result.meta.quality.normalized.some(n=>/플롯 장부/.test(n)));
  const again=await generateOutline(r.input,{engine:r.engine,qualityCheckpoint:r.result.meta.qualityCheckpoint});
  assert.equal(r.engine.calls.length,1);assert.equal(again.meta.requests,0);assert.deepEqual(again.data,data);
  // A valid ledger and outline come back unchanged.
  const {normalizeOutlineResponse}=await import('../dist/story-generation/outline-normalize.js');
  const input=makeInput(),valid=goodOutline(input,{pattern:'p',seed:{planted:'노란 우산',creature:'아기 다람쥐',reasons:['wrong_place','wrong_method']}});
  const shaped=normalizeOutlineResponse(valid,input);assert.deepEqual(shaped.outline,valid);assert.deepEqual(shaped.notes,[]);
});

test('F2 non-cast names in beat.characters are mapped to cast ids or dropped with a note, in the outline and the ledger',async()=>{
  const r=await run({outline:(o,ctx)=>{o.beats[0].characters=['유하','Choroki','엄마'];o.beats[1].characters=['char-yuha','공룡 친구'];o.beats.find(b=>b.type==='turn').characters.push(ctx.seed.creature);
    o.plotContract.beats[0].stateBefore.characters.push({characterId:'엄마',locationId:'bg-home',knows:[]});return o;}});
  ok(r,1);const {beats}=r.result.data;
  assert.deepEqual(beats[0].characters,['char-yuha','char-choroki']);assert.deepEqual(beats[1].characters,['char-yuha']);
  const notes=r.result.meta.quality.normalized.join(' ');assert.match(notes,/엄마/);assert.match(notes,/공룡 친구/);
  assert.ok(r.result.data.plotContract.beats[0].stateBefore.characters.every(c=>c.characterId.startsWith('char-')));
  // the plain path no longer buys a second outline for it
  const plain=await run({outline:(o,ctx)=>{o.beats.find(b=>b.type==='turn').characters.push(ctx.seed.creature);return o;}},{plain:true});ok(plain,1);
});

test('F3 the fix pass never throws: wrappers, partial or reordered answers, text around the JSON, count changes; only summary/newElement/failureReason are merged',async()=>{
  const trigger=o=>{o.beats[2].newElement='';return o;},fixed=o=>{o.beats[2].newElement='고친 모래 바람';return o;};
  const cases={
    wrapped:o=>({outline:fixed(o)}),
    onlyFlagged:o=>({beats:[fixed(o).beats[2]]}),
    reordered:o=>{fixed(o);o.beats.sort((a,b)=>a.type.localeCompare(b.type));return o;},
    placeName:o=>{fixed(o);o.beats[2].settingKey='동네 놀이터 미끄럼틀 아래';o.settings[2].backgroundId='bg-forest';return o;},
    creature:(o,ctx)=>{fixed(o);o.beats[2].characters=['유하','초록이',ctx.seed.creature];return o;},
  };
  for(const [name,fix] of Object.entries(cases)){
    const r=await run({outline:trigger,fix});ok(r,2);
    assert.equal(r.result.data.beats[2].newElement,'고친 모래 바람',name);
    assert.equal(r.result.data.beats[2].settingKey,'bg-park',name);assert.equal(r.result.data.settings[2].backgroundId,'bg-park',name);
    assert.deepEqual(r.result.data.beats[2].characters,['char-yuha','char-choroki'],name);
  }
  for(const [name,text] of Object.entries({commentary:t=>`${t}\n\n위와 같이 3번 비트만 고쳤어요.`,lead:t=>`수정한 줄거리입니다.\n\`\`\`json\n${t}\n\`\`\``})){
    const r=await run({outline:trigger,fix:fixed,text:(t,ctx)=>ctx.n===2?text(t):t});ok(r,2);assert.equal(r.result.data.beats[2].newElement,'고친 모래 바람',name);
  }
  // unreadable or a changed beat count: the original paid outline is kept (recorded), and a resume replays it with 0 calls
  for(const [name,hooks] of Object.entries({truncated:{outline:trigger,fix:fixed,text:(t,ctx)=>ctx.n===2?t.slice(0,Math.floor(t.length*.8)):t},added:{outline:trigger,fix:o=>{fixed(o);o.beats.push({...o.beats.at(-1),index:8});return o;}}})){
    const r=await run(hooks);ok(r,2);
    assert.equal(r.result.meta.quality.untargetedFixRestored.mode,'original',name);assert.equal(r.result.data.beats[2].newElement,'',name);
    assert.ok(r.result.meta.quality.softIssues.some(m=>/newElement/.test(m)),name);
    const again=await generateOutline(r.input,{engine:r.engine,qualityCheckpoint:r.result.meta.qualityCheckpoint});assert.equal(r.engine.calls.length,2);assert.deepEqual(again.data,r.result.data);
  }
});

test('F4 outline shape deviations are normalized before the checks (quality path, one paid call)',async()=>{
  const deviations={
    titles4:o=>{o.titleCandidates.push('네 번째 제목');},titles2:o=>{o.titleCandidates.pop();},
    words6:o=>{o.newWordsKo.push('바구니','빵','나무');},words2:o=>{o.newWordsKo.pop();},noEnglish:o=>{delete o.newWordsEn;},
    arcShort:o=>{o.emotionArc.pop();},arcLong:o=>{o.emotionArc.push('졸림');},
    settingsMissing:o=>{o.settings.pop();},settingsDup:o=>{o.settings.push(clone(o.settings[1]));},newPlaceNull:o=>{o.settings.forEach(s=>{s.newPlace=null;});},
    stringNumbers:o=>{o.beats.forEach(b=>{b.index=String(b.index);});o.settings.forEach(s=>{s.beatIndex=String(s.beatIndex);});o.refrain.usedAtBeats=o.refrain.usedAtBeats.map(String);},
    placeNames:(o,ctx)=>{const names=Object.fromEntries(ctx.input.backgrounds.map(b=>[b.id,b.name]));o.beats.forEach(b=>{b.settingKey=names[b.settingKey];});},
    twistOnlyInPlan:o=>{delete o.twist;},twistEmpty:o=>{o.twist='';},endingHome:o=>{o.endingType='home';},
    koreanTypes:o=>{const ko={setup:'시작',want:'바람',attempt:'시도',turn:'반전',resolution:'해결',close:'마무리'};o.beats.forEach(b=>{b.type=ko[b.type];});},
  };
  for(const [name,change] of Object.entries(deviations)){
    const r=await run({outline:(o,ctx)=>{change(o,ctx);return o;}});
    assert.ok(!r.error,`${name}: ${r.error?.message}`);assert.ok(r.engine.calls.length<=2,`${name}: ${r.engine.calls.length} calls`);
    const data=r.result.data;assert.equal(data.titleCandidates.length,3,name);assert.ok(data.newWordsKo.length>=3&&data.newWordsKo.length<=5,name);
    assert.equal(data.settings.length,7,name);assert.ok(data.beats.every((b,i)=>b.index===i+1&&['bg-home','bg-park','bg-forest'].includes(b.settingKey)),name);
    assert.ok(!r.engine.calls.some(c=>c.jsonSchema?.properties?.plan&&c!==r.engine.calls[0]&&!isFix(c.user)),`${name}: no second outline`);
  }
});

test('F5 the plain path cleans up the response right after complete(): a slip no longer buys a regenerated outline',async()=>{
  const deviations={
    ledger:pc(c=>{c.beats[3].stateBefore.characters[0].knows=['모래가 날리는 곳은 소풍 자리로 좋지 않아.'];}),
    owner:pc(c=>{for(const b of c.beats)for(const st of [b.stateBefore,b.stateAfter])st.props.forEach(p=>{p.ownerId='엄마';});}),
    titles:o=>{o.titleCandidates.push('네 번째');return o;},
    newPlace:o=>{o.settings.forEach(s=>{s.newPlace=null;});return o;},
  };
  for(const [name,outline] of Object.entries(deviations)){
    const r=await run({outline},{plain:true});assert.ok(!r.error,`${name}: ${r.error?.message}`);assert.equal(r.engine.calls.length,1,name);assert.equal(r.result.meta.repairAttempts,0,name);
  }
});

test('F6 a package topic item is hard only when the app finds no topic word at all; it buys no second outline',async()=>{
  for(const [topic,topicWords] of [['비 오는 날의 모험',['비','빗방울','비 오는 날']],['달에 놀러 간 날',['달나라','달에']]]){
    const r=await run({},{over:{topic},opts:{topicWords}});ok(r,1);
  }
  // a story with no topic word at all still stops after the second pattern
  const none=await run({outline:o=>{o.beats.forEach((b,i)=>{b.summary=`유하와 초록이가 ${i+1}번째 곳에서 손을 흔들어요. 초록이가 가만히 웃어요.`;});return o;}},{over:{topic:'바닷속 보물 찾기'}});
  assert.ok(none.error);assert.equal(none.engine.calls.length,2);assert.match(none.error.message,/주제 키워드/);
});

test('F7 forbidden words match only at a word start and outside everyday contexts; real hits still stop',async()=>{
  const add=sentence=>o=>{o.beats[3].summary+=` ${sentence}`;return o;};
  for(const sentence of ['유하가 길 잃은 꿀벌을 주머니 옆 꽃에 살짝 앉혀 줘요.','초록이가 커다란 잎으로 꿀벌을 받쳐 줘요.','유하는 물총으로 꽃에 물을 뿌려요.','빗방울이 창문을 톡톡 때리는 소리가 나요.','누렁이가 꼬리를 흔들며 쫓아와요.','엄마가 칼로 사과를 잘라 도시락에 넣어 줘요.']){
    const r=await run({outline:add(sentence)});ok(r,1);
    const check=plotCheck({outline:{beats:[{summary:sentence}]},topic:'x',protagonistName:'유하',inventories:{forbiddenKeywords:['벌을 주','벌을 받','총으로','때리','쫓아와','칼로']}});
    assert.ok(!check.regenerate.some(m=>m.startsWith('금지 소재')),sentence);
  }
  const real=await run({outline:add('늑대가 이빨을 드러내며 쫓아와요.')});
  assert.ok(real.error);assert.equal(real.engine.calls.length,2);assert.match(real.error.message,/금지 소재: 쫓아와/);
});

test('F8 a beam wrap that answers only its short template is redone once with the app fields named; resume replays it',async()=>{
  const short=o=>({titleCandidates:o.titleCandidates,logline:o.logline,want:o.want,problem:o.problem,twistReveal:o.plan.twistReveal,funnyMoment:o.plan.funnyMoment,refrain:o.refrain,newWordsKo:o.newWordsKo,newWordsEn:o.newWordsEn});
  let wraps=0;const r=await run({wrap:(o)=>++wraps===1?short(o):o},{over:{storyQuality:{useBeamSearch:true}}});
  ok(r,16);assert.equal(r.result.meta.quality.beamWrapRetried,true);
  const retry=r.engine.calls.at(-1);assert.match(retry.user,/The previous answer left out app fields/);assert.equal(r.engine.calls.filter(c=>/후보를 3개/u.test(c.system)).length,7);
  const again=await generateOutline(r.input,{engine:r.engine,qualityCheckpoint:r.result.meta.qualityCheckpoint});assert.equal(r.engine.calls.length,16);assert.equal(again.meta.requests,0);
  // a complete wrap is not redone, and 4 titles are trimmed
  const four=await run({wrap:o=>{o.titleCandidates.push('네 번째');return o;}},{over:{storyQuality:{useBeamSearch:true}}});ok(four,15);assert.equal(four.result.data.titleCandidates.length,3);
});

test('F9 the provider reads JSON with commentary around it without a second request, and a failed parse reports what was paid',async()=>{
  const reply=text=>({ok:true,status:200,json:async()=>({content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:1000,output_tokens:3000}})});
  for(const wrap of [t=>`${t}\n\n이 줄거리는 7개의 비트로 구성했어요.`,t=>`다음은 요청한 JSON입니다.\n\`\`\`json\n${t}\n\`\`\``]){
    let http=0;const engine=createTextEngine({engine:'anthropic',config:{apiKey:'sk-ant-test-fake',model:'claude-opus-5-5',fetch:async()=>{http++;return reply(wrap('{"a":{"b":"}"}}'));}}});
    const result=await engine.complete({system:'s',user:'u',jsonSchema:{type:'object'},maxTokens:100});
    assert.equal(http,1);assert.deepEqual(result.json,{a:{b:'}'}});assert.equal(result.meta.requests,1);
  }
  let http=0;const broken=createTextEngine({engine:'anthropic',config:{apiKey:'sk-ant-test-fake',model:'claude-opus-5-5',fetch:async()=>{http++;return reply('JSON을 만들 수 없어요.');}}});
  await assert.rejects(broken.complete({system:'s',user:'u',jsonSchema:{type:'object'},maxTokens:100}),error=>error.code==='json'&&http===2&&error.usage.input===2000&&error.usage.output===6000&&error.meta.requests===2);
});

test('F10 failure reasons in other spellings normalize to ids (no paid fix call) and are written back',async()=>{
  for(const [value,id] of [['wrong place','wrong_place'],['Wrong Place','wrong_place'],['wrong-method','wrong_method'],['잘못된 곳','wrong_place'],['엉뚱한 곳을 찾았어요','wrong_place'],['다른 곳에 있었어요','wrong_place'],['방법이 잘못됐어요','wrong_method'],['방법이 맞지 않아요','wrong_method'],['거의 성공했는데 바람이 불어요','interrupted']])
    assert.equal(normalizeFailureReason(value),id,value);
  const spell={wrong_place:'Wrong Place',wrong_method:'wrong-method',interrupted:'거의 성공했는데 바람이 불어요'};
  const r=await run({outline:o=>{o.beats.filter(b=>b.type==='attempt').forEach(b=>{b.failureReason=spell[b.failureReason];});return o;}});ok(r,1);
  assert.ok(r.result.data.beats.filter(b=>b.type==='attempt').every(b=>['wrong_place','wrong_method','interrupted'].includes(b.failureReason)));
});

test('a checkpoint saved before the robustness checks keeps the old package checks, so its paid fix pass replays with 0 calls',async()=>{
  // An outline whose reasons are spelled "Wrong Place": old checks put a failure-order item into the fix request, new ones do not.
  const spell={wrong_place:'Wrong Place',wrong_method:'wrong-method',interrupted:'interrupted'};
  const hooks={outline:o=>{o.beats[2].newElement='';o.beats.filter(b=>b.type==='attempt').forEach(b=>{b.failureReason=spell[b.failureReason];});return o;},fix:o=>{o.beats[2].newElement='고친 것';return o;}};
  const input=makeInput(),engine=fakeEngine(input,hooks);
  const fresh=await generateOutline(input,{engine});assert.equal(fresh.meta.qualityCheckpoint.checkRules,2);
  const {contextFingerprint,kind}=fresh.meta.qualityCheckpoint;
  // a pre-2026-10-19 checkpoint: no checkRules marker, one paid entry already saved
  const legacyEngine=fakeEngine(input,hooks),legacyStart={version:1,kind,contextFingerprint,completed:{older:{role:'other',response:{text:'{}'}}}};
  const legacy=await generateOutline(input,{engine:legacyEngine,qualityCheckpoint:legacyStart});
  assert.equal(legacy.meta.qualityCheckpoint.checkRules,undefined);
  const legacyFix=legacyEngine.calls.find(c=>isFix(c.user));assert.match(legacyFix.user,/실패 이유 순서/);
  assert.doesNotMatch(engine.calls.find(c=>isFix(c.user)).user,/실패 이유 순서/);
  const before=legacyEngine.calls.length,replay=await generateOutline(input,{engine:legacyEngine,qualityCheckpoint:legacy.meta.qualityCheckpoint});
  assert.equal(legacyEngine.calls.length,before);assert.equal(replay.meta.requests,0);assert.deepEqual(replay.data,legacy.data);
});
