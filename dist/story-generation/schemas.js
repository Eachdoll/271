import {STAGING_SCHEMA} from './staging.js';
/* Story stage schemas and structural validation. Content checks live in checker.js. */
export const STORY_STAGES=Object.freeze(['outline_draft','outline_ok','prose_draft','prose_ok','paged','illustrated','final']);
export const PAGE_COUNTS=Object.freeze([8,12,16,24]);
export const BEAT_COUNTS=Object.freeze({8:6,12:7,16:8,24:8});
const string=(maxLength=2000)=>({type:'string',minLength:1,maxLength});
const strings=(maxItems=30)=>({type:'array',items:string(500),maxItems});
const integer={type:'integer',minimum:1};
export const BEAT_SCHEMA={type:'object',additionalProperties:false,required:['index','type','summary','characters','settingKey'],properties:{
  index:integer,type:{type:'string',enum:['setup','want','attempt','turn','resolution','close']},summary:string(2000),characters:strings(5),settingKey:string(300)}};
export const OUTLINE_SCHEMA={type:'object',additionalProperties:false,required:['titleCandidates','logline','want','problem','beats','twist','newWordsKo','newWordsEn','settings','emotionArc','endingType'],properties:{
  titleCandidates:{type:'array',items:string(100),minItems:3,maxItems:3},logline:string(500),want:string(500),problem:string(500),
  beats:{type:'array',items:BEAT_SCHEMA,minItems:6,maxItems:8},refrain:{type:'object',additionalProperties:false,required:['text','usedAtBeats'],properties:{text:string(150),usedAtBeats:{type:'array',items:integer,maxItems:3,uniqueItems:true}}},
  twist:string(500),newWordsKo:{...strings(5),minItems:3},newWordsEn:strings(15),
  settings:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['beatIndex'],properties:{beatIndex:integer,backgroundId:string(300),newPlace:string(300)}}},
  emotionArc:{type:'array',items:string(50),minItems:6,maxItems:8},endingType:{type:'string',enum:['home_sleep','open']}}};
export const PROSE_SCHEMA={type:'object',additionalProperties:false,required:['ko','en','usedRefrainAt'],properties:{ko:string(30000),en:string(50000),usedRefrainAt:{type:'array',items:integer,maxItems:3,uniqueItems:true},paragraphBeats:{type:'object',additionalProperties:false,required:['ko','en'],properties:{ko:{type:'array',items:integer,minItems:1,maxItems:500},en:{type:'array',items:integer,minItems:1,maxItems:500}}}}};
export const SCENE_SCHEMA={type:'object',additionalProperties:false,required:['who','where','action','emotion','timeOfDay','props'],properties:{who:strings(5),where:string(500),action:string(500),emotion:string(40),timeOfDay:{type:'string',enum:['morning','day','afternoon','evening','night']},props:strings(12)}};
export const PAGE_SCHEMA={type:'object',additionalProperties:false,required:['pageNo','beatIndex','textKo','textEn','scene','variantByCharacter','isRefrainPage'],properties:{pageNo:integer,beatIndex:integer,textKo:string(6000),textEn:string(8000),scene:SCENE_SCHEMA,staging:STAGING_SCHEMA,variantByCharacter:{type:'object',additionalProperties:{anyOf:[string(300),{type:'null'}]}},isRefrainPage:{type:'boolean'}}};
export const PAGINATION_SCHEMA={type:'object',additionalProperties:false,required:['cover','pages'],properties:{cover:{type:'object',additionalProperties:false,required:['title','sceneAction'],properties:{title:string(100),sceneAction:string(500)}},pages:{type:'array',items:PAGE_SCHEMA,minItems:8,maxItems:24}}};
export const PARAGRAPH_SCHEMA={type:'object',additionalProperties:false,required:['paragraph'],properties:{paragraph:string(8000)}};
export const SCENE_REWRITE_SCHEMA={type:'object',additionalProperties:false,required:['action'],properties:{action:string(500)}};

export class StoryValidationError extends Error {
  constructor(stage,errors){super(`이야기 ${stage} 결과를 확인해 주세요: ${errors.slice(0,5).join(' / ')}`);this.name='StoryValidationError';this.stage=stage;this.violations=errors;}
}
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const stringArray=(value,max,min=0)=>Array.isArray(value)&&value.length>=min&&value.length<=max&&value.every(v=>text(v,500));
const safeString=value=>typeof value==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const clone=value=>JSON.parse(JSON.stringify(value));
function ids(input={}){return new Set((input.characters||[]).flatMap(c=>[c.id,c.name,c.nameEn].filter(Boolean)));}
function checkSafety(value,errors){
  // Avoid executing document/instruction text, and reject malformed control characters.
  // Narrative safety is also instructed at every LLM stage; this is not a clinical classifier.
  const visit=v=>{if(typeof v==='string'&&!safeString(v))errors.push('허용되지 않는 제어 문자가 있어요.');else if(Array.isArray(v))v.forEach(visit);else if(object(v))Object.values(v).forEach(visit);};visit(value);
  const narrative=[value?.want,value?.problem,value?.twist,value?.ko,value?.en,...(Array.isArray(value?.beats)?value.beats:[]).map(b=>b?.summary),...(Array.isArray(value?.pages)?value.pages:[]).flatMap(p=>[p?.textKo,p?.textEn])].filter(Boolean).join('\n');
  if(/(?:체벌(?:을|로)|벌로.{0,8}때리|(?:아이|어린이)를.{0,6}(?:죽이|때리|고문)|(?:kill|torture|beat)\s+(?:the\s+)?(?:child|kid))/iu.test(narrative))errors.push('아이를 해치거나 벌주는 사건은 사용할 수 없어요.');
}
export function validateOutline(value,input={}){
  const errors=[];if(!object(value))return {valid:false,errors:['줄거리 JSON 객체가 필요해요.']};
  for(const field of ['logline','want','problem','twist'])if(!text(value[field],500))errors.push(`${field}는 1~500자여야 해요.`);
  if(!stringArray(value.titleCandidates,3,3)||value.titleCandidates.some(t=>t.length>100))errors.push('제목 후보는 100자 이내로 3개여야 해요.');
  const count=BEAT_COUNTS[input.pageCount]||null,beats=value.beats;
  if(!Array.isArray(beats)||beats.length<6||beats.length>8||(count&&beats.length!==count))errors.push(`비트는 ${count||'6~8'}개여야 해요.`);
  else {
    const types=['setup','want',...Array.from({length:beats.length-5},()=> 'attempt'),'turn','resolution','close'];const allowed=ids(input);
    beats.forEach((b,i)=>{if(!object(b)){errors.push(`${i+1}번 비트가 잘못됐어요.`);return;}if(b.index!==i+1)errors.push('비트 번호는 1부터 순서대로여야 해요.');if(b.type!==types[i])errors.push('비트는 시작·바람·시도·반전·해결·마무리 순서여야 해요.');if(!text(b.summary,2000)||!text(b.settingKey,300)||!stringArray(b.characters,5))errors.push(`${i+1}번 비트 필드를 확인해 주세요.`);else if(allowed.size&&b.characters.some(c=>!allowed.has(c)))errors.push(`${i+1}번 비트에 선택하지 않은 등장인물이 있어요.`);});
  }
  if(!stringArray(value.newWordsKo,5,3)||!stringArray(value.newWordsEn,15))errors.push('새 단어 목록을 확인해 주세요.');
  if(!stringArray(value.emotionArc,8,6)||value.emotionArc.length!==beats?.length)errors.push('감정 흐름은 비트마다 하나씩 필요해요.');
  if(!['home_sleep','open'].includes(value.endingType))errors.push('결말 방식을 확인해 주세요.');
  if(input.endingType&&value.endingType!==input.endingType)errors.push('선택한 결말 방식을 유지해 주세요.');
  const indices=new Set((Array.isArray(beats)?beats:[]).map(b=>b?.index)),backgroundIds=new Set((input.backgrounds||input.backgroundList||[]).map(b=>b.id));
  if(!Array.isArray(value.settings)||value.settings.length!==beats?.length)errors.push('비트마다 배경 설정이 필요해요.');
  else {const seen=new Set();value.settings.forEach(s=>{if(!object(s)){errors.push('배경 비트 설정이 잘못됐어요.');return;}if(!indices.has(s.beatIndex)||seen.has(s.beatIndex))errors.push('배경 비트 번호가 잘못됐어요.');else seen.add(s.beatIndex);if(s.backgroundId&&backgroundIds.size&&!backgroundIds.has(s.backgroundId))errors.push('선택하지 않은 배경 ID가 있어요.');if(s.newPlace!==undefined&&!text(s.newPlace,300))errors.push('새 장소 설명을 확인해 주세요.');});}
  if(value.refrain!==undefined&&value.refrain!==null){const r=value.refrain;if(!object(r)||!text(r.text,150)||!Array.isArray(r.usedAtBeats)||r.usedAtBeats.length>3||new Set(r.usedAtBeats).size!==r.usedAtBeats.length||r.usedAtBeats.some(i=>!indices.has(i)))errors.push('후렴은 계획한 비트에서 최대 3회 사용할 수 있어요.');}
  checkSafety(value,errors);return {valid:errors.length===0,errors};
}
export function validateProse(value,outline){
  const errors=[];if(!object(value))return {valid:false,errors:['전문 JSON 객체가 필요해요.']};
  if(!text(value.ko,30000)||!text(value.en,50000))errors.push('한글·영어 전문을 각각 작성해 주세요.');
  const allowed=new Set(outline?.refrain?.usedAtBeats||[]);
  if(!Array.isArray(value.usedRefrainAt)||value.usedRefrainAt.length>3||new Set(value.usedRefrainAt).size!==value.usedRefrainAt.length||value.usedRefrainAt.some(i=>!allowed.has(i)))errors.push('후렴 위치는 승인한 줄거리와 같아야 해요.');
  // Older saved prose has no labels. New generation requests this metadata and
  // validates it strictly without inserting labels into printable story text.
  if(value.paragraphBeats!==undefined){
    const beatIds=(outline?.beats||[]).map(b=>b.index);
    if(!object(value.paragraphBeats))errors.push('전문 문단의 비트 표시를 확인해 주세요.');
    else for(const language of ['ko','en']){const rows=String(value[language]||'').split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean),labels=value.paragraphBeats[language];
      if(!Array.isArray(labels)||labels.length!==rows.length||labels.length>500||labels.some(id=>!Number.isInteger(id)||!beatIds.includes(id)))errors.push(`${language} 문단마다 승인한 비트 번호가 하나씩 필요해요.`);
      else if(beatIds.some(id=>!labels.includes(id))||labels.some((id,i)=>i&&beatIds.indexOf(id)<beatIds.indexOf(labels[i-1])))errors.push(`${language} 문단은 모든 승인 비트를 순서대로 포함해야 해요.`);
    }
  }
  checkSafety(value,errors);return {valid:errors.length===0,errors};
}
function allowedVariants(input){
  const result=new Map();const add=(charId,id)=>{if(!charId||!id)return;if(!result.has(charId))result.set(charId,new Set());result.get(charId).add(id);};
  for(const c of input.characters||[])for(const v of c.variants||c.wardrobe||[])add(c.id,typeof v==='string'?v:v.id);
  for(const v of input.variants||[])add(v.characterId,v.id);
  for(const [charId,id]of Object.entries(input.variantByCharacter||input.characterVariants||{}))add(charId,id);
  if(Array.isArray(input.variantPageRanges))for(const r of input.variantPageRanges)add(r.characterId,r.variantId);
  else for(const [charId,rows]of Object.entries(input.variantPageRanges||{}))for(const r of rows||[])add(charId,r.variantId);
  return result;
}
export function validateStoryPage(page,input={},outline){
  const errors=[];if(!object(page))return {valid:false,errors:['쪽 JSON 객체가 필요해요.']};
  if(!Number.isInteger(page.pageNo)||page.pageNo<1||page.pageNo>24)errors.push('쪽 번호가 잘못됐어요.');
  if(!Number.isInteger(page.beatIndex)||!outline?.beats?.some(b=>b.index===page.beatIndex))errors.push('비트 번호가 잘못됐어요.');
  if(!text(page.textKo,6000)||!text(page.textEn,8000))errors.push('쪽에 한글·영어 글이 모두 필요해요.');
  const scene=page.scene,cast=new Set((input.characters||[]).map(c=>c.id));
  if(!object(scene))errors.push('장면 정보가 필요해요.');
  else {if(!stringArray(scene.who,5,1)||(cast.size&&scene.who.some(c=>!cast.has(c))))errors.push('장면에는 선택한 등장인물 ID만 사용할 수 있어요.');for(const [k,max]of [['where',500],['action',500],['emotion',40]])if(!text(scene[k],max))errors.push(`장면 ${k} 필드를 확인해 주세요.`);if(typeof scene.emotion==='string'&&!/^[A-Za-z]+(?:-[A-Za-z]+)?$/.test(scene.emotion))errors.push('장면 감정은 영어 한 단어여야 해요.');if(!['morning','day','afternoon','evening','night'].includes(scene.timeOfDay))errors.push('장면 시간을 확인해 주세요.');if(!stringArray(scene.props,12))errors.push('장면 소품 목록을 확인해 주세요.');}
  if(!object(page.variantByCharacter))errors.push('쪽별 옷장 모습을 확인해 주세요.');
  else {const variants=allowedVariants(input);for(const [c,id]of Object.entries(page.variantByCharacter)){if(cast.size&&!cast.has(c))errors.push('선택하지 않은 등장인물의 옷장 정보가 있어요.');if(id!==null&&(!text(id,300)||!variants.get(c)?.has(id)))errors.push('선택하지 않은 옷장 모습 ID가 있어요.');}}
  if(typeof page.isRefrainPage!=='boolean')errors.push('후렴 쪽 여부가 필요해요.');
  checkSafety({pages:[page]},errors);return {valid:errors.length===0,errors};
}
export function validatePagination(value,input={},outline,{exactCount=true}={}){
  const errors=[];if(!object(value))return {valid:false,errors:['쪽 나누기 JSON 객체가 필요해요.']};
  if(!object(value.cover)||!text(value.cover.title,100)||!text(value.cover.sceneAction,500))errors.push('표지 제목과 장면 설명을 확인해 주세요.');
  if(!Array.isArray(value.pages)||value.pages.length<8||value.pages.length>24||(exactCount&&input.pageCount&&value.pages.length!==input.pageCount))errors.push(`정확히 ${input.pageCount||'8~24'}쪽이 필요해요.`);
  if(Array.isArray(value.pages))value.pages.forEach((p,i)=>{if(p?.pageNo!==i+1)errors.push('쪽 번호는 1부터 순서대로여야 해요.');errors.push(...validateStoryPage(p,input,outline).errors.map(e=>`${i+1}쪽: ${e}`));});
  checkSafety(value,errors);return {valid:errors.length===0,errors};
}
export function assertValid(stage,value,input={},outline){
  const result=stage==='outline'?validateOutline(value,input):stage==='prose'?validateProse(value,outline):stage==='page'?validateStoryPage(value,input,outline):validatePagination(value,input,outline);
  if(!result.valid)throw new StoryValidationError(stage,result.errors);return clone(value);
}
