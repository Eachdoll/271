import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {generateOutline,generateProse,inspectOutlineRules,preflightOutlineLocations,isHomeBackground,storyTopicKeywords,normalizeStoryInput,paragraphBeatLabels} from '../dist/story-generation/pipeline.js';
import {OUTLINE_SCHEMA,validateOutline,validateProse,StoryValidationError} from '../dist/story-generation/schemas.js';

const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const input={topic:'우산과 빗방울',characters:[{id:'yuha',name:'유하'},{id:'green',name:'그린이'}],backgrounds:[{id:'home',type:'home',name:'유하의 집',layout:'문은 오른쪽에 하나'},{id:'garden',type:'forest',name:'꽃 정원'},{id:'pond',type:'forest',name:'연못 길'}],preferredBackgroundIds:['pond'],pageCount:12,endingType:'home_sleep',specs:{ko:getLevelSpec('K2'),en:getLevelSpec('E1')}};
  const types=['setup','want','attempt','attempt','turn','resolution','close'],places=['home','garden','garden','pond','pond','garden','home'];
  const summaries=['유하와 그린이가 집에서 우산을 펴요. 빗방울이 창문을 톡톡 두드려요.','유하가 꽃 정원에서 빗방울의 소리를 모으고 싶어요. 그린이가 우산을 높이 들어요.','유하가 우산 아래에 빈 잎을 놓아요. 빗방울이 잎 밖으로 튀어요.','그린이가 연못 길에서 넓은 잎을 잡아요. 차가운 빗방울이 손 위에 떨어져요.','유하가 우산을 기울이자 빗방울이 잎으로 모여요. 그린이가 동그란 물방울을 발견해요.','그린이가 꽃 정원에 잎을 놓아요. 유하가 물방울을 꽃뿌리에 부어요.','유하와 그린이가 집으로 돌아와요. 유하가 마른 우산을 접고 포근한 이불을 덮어요.'];
  const outline={titleCandidates:['우산 아래 빗방울','작은 물방울을 모아요','톡톡 비의 선물'],logline:'유하와 그린이가 우산과 잎으로 빗방울을 모아 꽃에 선물해요.',want:'꽃에 줄 빗방울을 모으고 싶어요.',problem:'빗방울이 작은 잎 밖으로 튀어요.',twist:'우산을 기울이면 빗방울을 넓은 잎에 모을 수 있어요.',beats:types.map((type,i)=>({index:i+1,type,summary:summaries[i],characters:['yuha','green'],settingKey:places[i]})),settings:places.map((backgroundId,i)=>({beatIndex:i+1,backgroundId})),emotionArc:['기대','호기심','속상함','긴장','놀람','기쁨','편안함'],newWordsKo:['우산','빗방울','기울이다'],newWordsEn:['umbrella','drop','leaf'],endingType:'home_sleep'};
  const prose={ko:summaries.join('\n\n'),en:['Yuha opens an umbrella at home. Green hears soft rain.','Yuha says, “I want rain for our flowers.” Green feels a cool drop.','Green says, “I can hold this leaf.” The drops splash past the leaf.','Yuha feels cold water at the pond. Green holds a wider leaf.','Yuha says, “I can tilt our umbrella.” The bright drops run onto the leaf.','Green pours the water in the garden. Yuha smells the wet flowers.','Yuha and Green return home. Their dry blanket feels soft.'].join('\n\n'),usedRefrainAt:[],paragraphBeats:{ko:[1,2,3,4,5,6,7],en:[1,2,3,4,5,6,7]}};
  return {input,outline,prose};
}
function engine(responses){const calls=[];return {id:'openai',calls,async complete(request){calls.push(request);const next=responses.shift();if(next instanceof Error)throw next;return {json:clone(next),usage:{input:100,output:50},costUsdEstimated:.01,meta:{modelId:'mock-story'}};}};}

test('new outline prompt contains structure and actual input, without an example story or new-place field',async()=>{
  const {input,outline}=fixture(),mock=engine([outline]);await generateOutline(input,{engine:mock});
  const call=mock.calls[0],payload=JSON.parse(call.user);
  assert.match(call.system,/Order: setup -> want/);assert.match(call.system,/structure only/);assert.doesNotMatch(call.system,/도시락|노래하는 돌|빨간 가방|singing stone|picnic bag/);
  assert.deepEqual(payload.topicKeywords,['우산','빗방울']);assert.deepEqual(payload.homeBackgroundIds,['home']);assert.deepEqual(payload.locationBackgroundIds,['garden','pond']);assert.deepEqual(payload.input.preferredBackgroundIds,['pond']);
  assert.equal('newPlace' in call.jsonSchema.properties.settings.items.properties,false);assert.deepEqual(call.jsonSchema.properties.settings.items.required,['beatIndex','backgroundId']);
  assert.equal('newPlace' in OUTLINE_SCHEMA.properties.settings.items.properties,true,'legacy schema is unchanged');
});

test('unrelated story and single-location beats automatically regenerate with bounded cumulative usage',async()=>{
  const {input,outline}=fixture(),unrelated=clone(outline),onePlace=clone(outline),before=clone(input);
  unrelated.beats.forEach(b=>b.summary='친구들이 공원에서 공을 굴려요. 나무가 바람에 흔들려요.');
  onePlace.beats.slice(1,-1).forEach(b=>{b.settingKey='garden';onePlace.settings.find(s=>s.beatIndex===b.index).backgroundId='garden';});
  const mock=engine([unrelated,onePlace,outline]),result=await generateOutline(input,{engine:mock});
  assert.equal(mock.calls.length,3);assert.equal(result.meta.repairAttempts,2);assert.equal(result.meta.requests,3);assert.equal(result.usage.input,300);assert.equal(result.usage.output,150);assert.equal(result.usage.costUsdEstimated,.03);assert.equal(result.meta.demo,false);assert.deepEqual(result.data,outline);assert.deepEqual(input,before);
  const firstRepair=JSON.parse(mock.calls[1].user).violations;assert.ok(firstRepair.some(v=>v.code==='topic_keyword_missing'));assert.ok(firstRepair.some(v=>v.code==='character_name_missing'));assert.ok(JSON.parse(mock.calls[2].user).violations.some(v=>v.code==='middle_locations'));
});

test('persistent unrelated output fails after two repairs without substituting a demo',async()=>{
  const {input,outline}=fixture(),bad=clone(outline);bad.beats.forEach(b=>b.summary='이름 없는 두 친구가 공을 굴려요. 햇살이 길을 비춰요.');const mock=engine([bad,bad,bad]);
  await assert.rejects(generateOutline(input,{engine:mock}),error=>error instanceof StoryValidationError&&error.stage==='outline'&&error.meta.repairAttempts===2&&error.meta.requests===3&&error.usage.input===300&&/우산|유하/.test(error.message));assert.equal(mock.calls.length,3);
});

test('malformed JSON also repairs and retains usage for every response',async()=>{
  const {input,outline}=fixture();let calls=0;const mock={id:'openai',async complete(){calls++;return calls===1?{text:'invalid json',usage:{input:7,output:3}}:{json:outline,usage:{input:11,output:5}};}};
  const result=await generateOutline(input,{engine:mock});assert.equal(calls,2);assert.deepEqual(result.usage,{input:18,output:8});assert.equal(result.meta.repairAttempts,1);
});

test('generation preflight requires an actual home and two non-home drawer backgrounds before any call',async()=>{
  const {input}=fixture(),mock=engine([]),noHome={...input,backgrounds:input.backgrounds.slice(1)};
  await assert.rejects(generateOutline(noHome,{engine:mock}),/집·방/);await assert.rejects(generateOutline({...input,backgrounds:input.backgrounds.slice(0,2)},{engine:mock}),/2곳/);assert.equal(mock.calls.length,0);
  assert.equal(preflightOutlineLocations(input).valid,true);assert.equal(isHomeBackground({name:'초록이의 방'}),true);assert.equal(isHomeBackground({name:'숲속 연못'}),false);
});

test('manual approval inspector catches home, drawer, geometry-key and missing selected-name violations',()=>{
  const {input,outline}=fixture();assert.equal(inspectOutlineRules(outline,input).valid,true);
  const bad=clone(outline);bad.settings[0].backgroundId='garden';bad.beats[0].settingKey='garden';bad.beats[2].settingKey='invented';bad.settings[3]={beatIndex:4,newPlace:'모델이 만든 성'};bad.beats.forEach(b=>b.summary=b.summary.replaceAll('그린이','동생'));
  const codes=new Set(inspectOutlineRules(bad,input).violations.map(v=>v.code));for(const code of ['home_start_end','setting_mismatch','setting_unknown','character_name_missing'])assert.ok(codes.has(code));
  assert.equal(validateOutline(outline,input).valid,true);assert.equal(inspectOutlineRules({...outline,settings:null},input).valid,false);
});

test('meaningful Korean topic nouns match particles but not unrelated substrings',()=>{
  const {input,outline}=fixture();assert.deepEqual(storyTopicKeywords('친구와 작은 우산을 찾아요'),['우산']);
  const source={...input,topic:'돌을 찾아요'},bad=clone(outline);bad.beats.forEach(b=>b.summary='유하와 그린이가 집으로 돌아와요. 두 친구가 말해요.');
  assert.ok(inspectOutlineRules(bad,source).violations.some(v=>v.code==='topic_keyword_missing'&&v.keyword==='돌'));
  bad.beats[2].summary='유하가 돌을 들어요. 그린이가 돌의 거친 면을 만져요.';assert.equal(inspectOutlineRules(bad,source).violations.some(v=>v.code==='topic_keyword_missing'),false);
  bad.beats[2].summary='유하가 씨앗을 관찰해요. 그린이가 관찰한 씨앗을 잎에 놓아요.';assert.equal(inspectOutlineRules(bad,{...input,topic:'씨앗 관찰'}).violations.some(v=>v.code==='topic_keyword_missing'),false);
});

test('custom moral and ending survive input normalization and prose prompts require explicit subjects and sensory dialogue rules',async()=>{
  const {input,outline,prose}=fixture(),source={...input,value:'custom',valueCustom:'서로 기다려 주는 용기',ending:'custom',endingCustom:'집에서 창문에 모인 물방울을 함께 바라본다'},mock=engine([prose]);
  const normalized=normalizeStoryInput(source);assert.equal(normalized.moral,source.valueCustom);assert.equal(normalized.endingNote,source.endingCustom);
  const result=await generateProse(outline,source,{engine:mock}),call=mock.calls[0],payload=JSON.parse(call.user);
  assert.match(call.system,/EVERY sentence must have an explicit grammatical subject/);assert.match(call.system,/never omit the Korean subject/);assert.match(call.system,/THREE directly quoted dialogue turns PER LANGUAGE/);assert.match(call.system,/EACH approved beat must contain at least ONE specific sensory detail/);assert.match(call.system,/These paragraph labels are metadata ONLY/);
  assert.equal(payload.input.moral,source.valueCustom);assert.equal(payload.input.endingNote,source.endingCustom);assert.ok(call.jsonSchema.required.includes('paragraphBeats'));assert.deepEqual(paragraphBeatLabels(result.data,'ko',outline),[1,2,3,4,5,6,7]);assert.doesNotMatch(result.data.ko,/\[비트|beatIndex|비트\s*[1-7]/);
});

test('new prose repairs missing or incorrect paragraph labels and legacy prose remains readable',async()=>{
  const {input,outline,prose}=fixture(),legacy=clone(prose),bad=clone(prose);delete legacy.paragraphBeats;bad.paragraphBeats.ko=[1,2,3,4,5,7,6];
  assert.equal(validateProse(legacy,outline).valid,true);assert.equal(validateProse(bad,outline).valid,false);assert.deepEqual(paragraphBeatLabels(legacy,'ko',outline),[1,2,3,4,5,6,7]);
  const mock=engine([legacy,bad,prose]),result=await generateProse(outline,input,{engine:mock});assert.equal(mock.calls.length,3);assert.equal(result.meta.repairAttempts,2);assert.equal(result.usage.input,300);assert.equal(result.meta.requests,3);assert.deepEqual(result.data.paragraphBeats,prose.paragraphBeats);
});

test('new prose does not silently invent paragraph labels after repeated metadata failures',async()=>{
  const {input,outline,prose}=fixture();delete prose.paragraphBeats;const mock=engine([prose,prose,prose]);
  await assert.rejects(generateProse(outline,input,{engine:mock}),error=>error instanceof StoryValidationError&&error.stage==='prose'&&error.usage.input===300&&error.meta.repairAttempts===2);assert.equal(mock.calls.length,3);
});
