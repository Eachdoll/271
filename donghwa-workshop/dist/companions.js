import {safeTopic} from './engine.js';
import {getActiveWorld,markCharacterSheetConfirmed} from './image-generation/world.js';
import {getStylePreset} from './image-generation/styles.js';
import {ENGINE_METADATA} from './image-generation/providers.js';
import {generateCharacterSheet} from './image-generation/pipeline.js';
import {deleteImageAsset} from './image-generation/assets.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groups={
  forest:[['잎새','Ipsae','dinosaur','#97b48b','작고 순한 초록 공룡, 둥근 코와 연두색 배, 나뭇잎 가방'],['도토리','Dotori','rabbit','#ded0b4','크림색 토끼, 긴 귀와 갈색 작은 조끼'],['솔이','Sori','child','#d69b79','짧은 갈색 곱슬머리의 아이, 살구색 셔츠와 갈색 반바지']],
  moon:[['달토','Dalto','rabbit','#ddd5ee','보랏빛 크림색 달토끼, 긴 귀와 노란 별 목도리'],['별이','Byori','child','#a6bacf','검은 단발머리의 아이, 하늘색 우주복과 작은 별 가방'],['꼬미','Kkomi','dinosaur','#a8bcb2','작고 둥근 민트색 공룡, 보랏빛 우주 탐험 조끼']],
  sea:[['물결이','Mulgyeol','child','#7fb7c2','짧은 검은 머리의 아이, 청록색 줄무늬 셔츠와 모래색 반바지'],['보리','Bori','rabbit','#e6d6b2','모래색 토끼, 긴 귀와 파란 조개 목걸이'],['파랑이','Parangi','dinosaur','#96b8bd','순한 하늘색 작은 공룡, 둥근 주둥이와 하얀 배']],
  rain:[['방울이','Banguli','child','#d9b84f','검은 단발머리의 아이, 노란 우비와 초록 장화'],['우비토','Ubito','rabbit','#cbbdac','크림색 토끼, 분홍 우비와 작은 파란 우산'],['촉촉이','Chokchogi','dinosaur','#9aae8c','작고 순한 연두색 공룡, 하늘색 우비와 둥근 꼬리']],
  friends:[['하루','Haru','child','#bb9bb2','짧은 갈색 머리의 아이, 연보라 셔츠와 크림색 바지'],['솜이','Somi','rabbit','#e8ddcb','하얀 크림색 토끼, 분홍 귀와 살구색 스카프'],['두리','Duri','dinosaur','#a1b49a','작고 둥근 초록 공룡, 노란 배와 작은 빨간 가방']]
};

/** Local setting suggestions. Images are generated separately by the World engine. */
export function suggestCompanions(topic,existing=[],count=3){
  const text=String(topic||'');
  const group=/달|별|우주|moon|space|star/i.test(text)?'moon':/바다|물고기|보물|sea|ocean/i.test(text)?'sea':/비\s|비가|비 오는|우산|rain/i.test(text)?'rain':/공룡|숲|소풍|dinosaur|forest/i.test(text)?'forest':'friends';
  const used=new Set(existing.map(c=>c.name));
  return groups[group].slice(0,Math.max(1,Math.min(3,Number(count)||3))).map(([base,nameEn,kind,color,description])=>{
    let name=base,index=2;while(used.has(name))name=base+index++;used.add(name);
    return {id:'character-'+crypto.randomUUID(),name,nameEn,kind,color,role:'조연',version:1,description,appearance:description,clothes:'설명에 적힌 기본 모습',hairColor:kind==='child'?'#493b34':color,skinColor:kind==='child'?'#edceb3':color,traits:['다정함','호기심 많음'],likes:text.slice(0,100),catchphrase:'우리 함께 해 보자!',wardrobe:[{id:'default',name:'기본 모습',color}],characterSheets:[],source:'topic-suggestion',createdAt:new Date().toISOString()};
  });
}

let api,flow=null;
export function cleanupCompanionFlow(){
  const previous=flow;flow=null;previous?.controller?.abort();
  for(const item of previous?.results||[])void deleteImageAsset(item.result.imageAssetId).catch(()=>{});
}
const header=title=>api.modalHeader(escape(title));
function valid(current){const world=getActiveWorld(api.getState());return flow===current&&api.getState()===current.state&&api.isParent()&&world.id===current.worldId&&world.revision===current.revision&&world.imageEngine===current.engine&&world.stylePresetId===current.style;}
function openCompanions(){
  cleanupCompanionFlow();const state=api.getState(),world=getActiveWorld(state),story=api.getStoryContext?.();
  flow={state,worldId:world.id,revision:world.revision,engine:world.imageEngine,style:world.stylePresetId,capacity:story?Math.max(0,5-story.characterIds.length):4,results:[],candidates:[],controller:null};
  api.showModal(`${header('조연 자동생성하여 추가하기')}<p class="modal-intro">주제에 맞는 조연 설정을 기기에서 추천해요. 설정을 고른 뒤 <strong>${escape(ENGINE_METADATA[world.imageEngine].name)}</strong>로 캐릭터 시트를 만들고, 확인한 친구만 서랍에 추가합니다.</p><form id="companion-topic-form"><div class="field"><label for="companion-topic">어떤 이야기의 조연인가요?</label><textarea id="companion-topic" maxlength="400" required placeholder="예: 숲에서 길을 잃은 별을 찾아주는 이야기">${escape(story?.topic||'')}</textarea></div><div class="modal-actions"><button class="btn btn-green" type="submit">조연 후보 추천하기</button></div></form>${flow.capacity===0?'<div class="notice">이 이야기에는 이미 5명이 선택되어 있어요. 추가한 조연은 서랍에 보관되며, 재료 고르기에서 친구를 바꿀 수 있어요.</div>':''}`);
}
function renderSuggestions(current){
  const world=getActiveWorld(current.state);current.candidates=suggestCompanions(current.topic,[...current.state.characters,...(current.previousSuggestions||[])]);current.previousSuggestions=[...(current.previousSuggestions||[]),...current.candidates];
  api.showModal(`${header('함께할 조연을 골라 주세요')}<p class="modal-intro">설정 추천은 무료입니다. 이름과 외모를 바꿀 수 있어요. 시트는 <strong>${escape(ENGINE_METADATA[current.engine].name)} · ${escape(getStylePreset(world.stylePresetId).name)}</strong>로 생성합니다.</p><form id="companion-generate-form"><div class="companion-grid">${current.candidates.map((c,i)=>`<article class="companion-card"><label class="companion-choice"><input type="checkbox" name="companion-selected" value="${i}" ${i===0?'checked':''}><strong>${escape(c.name)} · ${c.kind==='child'?'아이':c.kind==='rabbit'?'토끼':'공룡'}</strong></label><div class="field"><label for="companion-name-${i}">이름</label><input id="companion-name-${i}" maxlength="40" required value="${escape(c.name)}"></div><div class="field"><label for="companion-description-${i}">외모 · 옷 · 특징</label><textarea id="companion-description-${i}" maxlength="700" required>${escape(c.description)}</textarea></div><div class="field"><label for="companion-color-${i}">대표 색</label><input type="color" id="companion-color-${i}" value="${c.color}"></div></article>`).join('')}</div><div class="notice" style="margin-top:18px">${current.engine==='sample'?'무료 샘플은 종류와 색을 반영하는 고정 그림 템플릿입니다. 커버의 수채화와 자유로운 외모 표현은 AI 엔진 또는 완성 그림 가져오기를 사용해 주세요.':current.engine==='local'?'선택한 수만큼 ComfyUI에서 시트를 생성합니다. 연결한 서버의 비용은 별도입니다.':'선택한 수만큼 유료 API 생성 요청을 보냅니다. 결과를 확인하기 전에는 캐릭터가 저장되지 않아요.'}</div><div class="modal-actions"><button type="button" class="btn btn-outline" data-companion-action="suggest-again">다른 이름으로 다시 추천</button><button type="submit" class="btn btn-primary">선택한 조연 시트 생성</button></div></form>`,'wide');
}
function preview(current,error){
  api.showModal(`${header('조연 시트를 확인해 주세요')}<p class="modal-intro">확인한 친구만 재료 서랍에 저장합니다.${current.capacity?' 만들던 이야기에도 빈 자리만큼 함께 선택돼요.':''}</p>${error?`<div class="notice">일부 시트를 만들지 못했어요: ${escape(error.message)}</div>`:''}<div class="companion-grid">${current.results.map(({character,result},i)=>`<article class="companion-card"><img class="companion-sheet" src="${escape(result.imageUrl)}" alt="${escape(character.name)}의 캐릭터 시트"><label class="companion-choice"><input type="checkbox" name="companion-approved" value="${i}" checked><strong>${escape(character.name)} · 이 친구 추가</strong></label><p>${escape(character.description)}</p><small class="small-label">요청 시드 ${result.meta.requestedSeed} · ${result.seed==null?'결과 시드 미지원':'결과 시드 '+result.seed}</small></article>`).join('')}</div><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">추가하지 않기</button><button type="button" class="btn btn-primary" data-companion-action="approve">${current.engine!=='sample'&&current.results.some(item=>item.result.meta.quality==='draft')?'확인한 조연 최종 시트 생성 · 추가 요청 요금 적용':'확인한 조연 서랍에 추가'}</button></div>`,'wide');
}
async function generateSelected(override=null,quality='draft'){
  const current=flow;if(!current||current.controller)return;
  const selected=[...document.querySelectorAll('[name=companion-selected]:checked')].map(input=>Number(input.value));
  if(!override&&!selected.length){api.toast('생성할 조연을 한 명 이상 골라 주세요.');return}
  const characters=override||selected.map(index=>{const c=current.candidates[index];return {...c,name:document.querySelector('#companion-name-'+index).value.trim(),description:document.querySelector('#companion-description-'+index).value.trim(),appearance:document.querySelector('#companion-description-'+index).value.trim(),color:document.querySelector('#companion-color-'+index).value};});
  if(characters.some(c=>!c.name||!c.description)){api.toast('조연의 이름과 외모 설명을 채워 주세요.');return}
  if(!valid(current)){api.toast('World 설정이 바뀌었어요. 다시 추천해 주세요.');return}
  current.controller=new AbortController();
  api.showModal(`${header('조연 시트를 만들고 있어요')}<p class="modal-intro" id="companion-progress">0 / ${characters.length}명 생성</p><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">생성 취소</button></div>`);
  let error;
  try{
    for(const character of characters){
      const result=await generateCharacterSheet(current.state,character,{quality,signal:current.controller.signal});
      if(!valid(current)||current.controller.signal.aborted){await deleteImageAsset(result.imageAssetId);return}
      current.results.push({character,result});document.querySelector('#companion-progress').textContent=`${current.results.length} / ${characters.length}명 생성`;
    }
  }catch(problem){error=problem}
  if(!valid(current)||current.controller.signal.aborted)return;
  current.controller=null;
  if(current.results.length)preview(current,error);else{renderSuggestions(current);api.toast(error?.message||'시트를 만들지 못했어요.');}
}
async function approve(){
  const current=flow;if(!current||!valid(current)){api.toast('World 설정이 바뀌었어요. 다시 생성해 주세요.');return}
  const selected=new Set([...document.querySelectorAll('[name=companion-approved]:checked')].map(input=>Number(input.value)));
  if(!selected.size){api.toast('추가할 조연을 한 명 이상 골라 주세요.');return}
  if(current.engine!=='sample'&&current.results.some(item=>item.result.meta.quality==='draft')){const characters=current.results.filter((item,index)=>selected.has(index)).map(item=>({...item.character,sheetSeed:item.result.meta.requestedSeed}));for(const item of current.results)await deleteImageAsset(item.result.imageAssetId);current.results=[];await generateSelected(characters,'final');return}
  const previousCharacters=structuredClone(current.state.characters),previousWorlds=structuredClone(current.state.worlds),added=[];
  try{
    current.results.forEach(({character,result},index)=>{if(selected.has(index)){const savedCharacter=structuredClone(character);savedCharacter.worldId=current.worldId;current.state.characters.push(savedCharacter);markCharacterSheetConfirmed(current.state,savedCharacter.id,result);added.push(savedCharacter.id);}});
    if(api.save()===false)throw new Error('저장 공간을 확보한 뒤 다시 추가해 주세요.');
  }catch(error){current.state.characters=previousCharacters;current.state.worlds=previousWorlds;api.toast(error.message);return}
  current.results=current.results.filter((item,index)=>!selected.has(index));cleanupCompanionFlow();
  api.onAdded?.(added);api.closeModal();api.render();api.toast(`${added.length}명의 조연을 재료 서랍에 추가했어요.`);
}
export function configureCompanionUI(context){
  api=context;
  document.addEventListener('click',event=>{const button=event.target.closest('[data-companion-action]');if(!button)return;event.preventDefault();api.protectedAction(()=>{try{const action=button.dataset.companionAction;if(action==='open')openCompanions();if(action==='approve')approve();if(action==='suggest-again'&&flow)renderSuggestions(flow);}catch(error){api.toast(error.message)}});});
  document.addEventListener('submit',event=>{if(event.target.id==='companion-topic-form'){event.preventDefault();api.protectedAction(()=>{const topic=document.querySelector('#companion-topic').value.trim(),check=safeTopic(topic);if(!check.ok){api.toast(check.message||'주제를 입력해 주세요.');return}if(flow){flow.topic=topic;renderSuggestions(flow)}});}if(event.target.id==='companion-generate-form'){event.preventDefault();api.protectedAction(()=>generateSelected());}});
  window.addEventListener('pagehide',cleanupCompanionFlow);
}
