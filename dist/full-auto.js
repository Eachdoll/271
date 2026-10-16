/* Full Auto is a resumable client-side job. No credentials or engine responses are stored in job inputs. */
import {generateMaterialPlan,generateOutline,generateSceneBriefs,generateProse,enrichProse,paginateStory,summarizeStory,inspectStory,preflightOutlineLocations} from './story-generation/pipeline.js';
import {inspectAutoMaterialPlan,materializeAutoPlan,materialSignature} from './story-generation/auto-materials.js';
import {getActiveWorld,getCharacterSheet,getWorldBackgroundSnapshot,markCharacterSheetConfirmed,captureBookGenerationSnapshot} from './image-generation/world.js';
import {generateCharacterSheet,generateScene,generateCover} from './image-generation/pipeline.js';
import {backgroundSheetRequest,backgroundSettingsKey} from './background-sheets.js';
import {generateImage} from './image-generation/providers.js';
import {saveImage} from './image-generation/assets.js';
import {getCredential} from './image-generation/vault.js';
import {getTextGenerationSettings} from './text-generation/settings-ui.js';
import {resolveStoryStageSettings,estimateStoryTextCost,estimateTextCost} from './text-generation/models.js';
import {estimateImageCost} from './image-generation/models.js';
import {getStylePreset} from './image-generation/styles.js';
import {inputFromWizard} from './story-generation/ui.js';
import {safeTopic} from './engine.js';
const clone=value=>structuredClone(value),now=()=>new Date().toISOString(),active=list=>(list||[]).filter(item=>!item.archivedAt);
const abort=signal=>{if(signal?.aborted)throw new DOMException('FULL AUTO를 중지했어요.','AbortError');};
export function autoJobs(state){return state.fullAutoJobs||={};}
export function createFullAutoJob(state,wizard,{allowNew=true}={}){
 const check=safeTopic(wizard.topic);if(!check.ok)throw Error(check.message||'주제를 적어 주세요.');
 const selected=[...new Set(wizard.characterIds||[])];if(!selected.length||selected.length>5||selected.some(id=>!active(state.characters).some(c=>c.id===id)))throw Error('주인공을 포함해 1~5명을 골라 주세요.');
 if(wizard.value==='custom'&&!wizard.valueCustom?.trim()||wizard.ending==='custom'&&!wizard.endingCustom?.trim())throw Error('직접 선택한 가치와 결말을 채워 주세요.');
 const prepared=inputFromWizard(state,{...wizard,characterIds:selected}),world=getActiveWorld(state),previous=state.books.find(b=>b.id===wizard.previousBookId)?.generationSnapshot;
 if(previous&&(previous.worldId!==world.id||previous.worldRevision!==world.revision))throw Error('이전 편을 만든 World와 현재 설정이 달라요. 같은 World 설정으로 돌아오거나 단계별 만들기를 사용해 주세요.');
 const job={id:'auto-'+crypto.randomUUID(),bookId:'book-'+crypto.randomUUID(),storyDraftId:'story-'+crypto.randomUUID(),status:'ready',phase:'준비',wizard:clone({...wizard,characterIds:selected}),input:clone(prepared.input),readingLevels:clone(prepared.readingLevels),worldId:world.id,worldRevision:world.revision,imageEngine:world.imageEngine,stylePresetId:world.stylePresetId,worldSnapshot:clone(world),initialSignatures:Object.fromEntries(selected.map(id=>{const c=state.characters.find(c=>c.id===id);return [id,materialSignature(c)];})),textSettings:clone(getTextGenerationSettings(state)),allowNew,completed:{},usage:{calls:[]},imageUsage:{},notes:[],createdAt:now(),updatedAt:now()};
 autoJobs(state)[job.id]=job;return job;
}
export function estimateFullAutoCost(state,wizard){
 const world=getActiveWorld(state),settings=getTextGenerationSettings(state),text=estimateStoryTextCost({settings,pageCount:wizard.pageCount||12}),plan=resolveStoryStageSettings(settings,'outline'),planning=estimateTextCost({...plan,input:11000,output:5000,model:plan.config.model}),config=world.providerConfig?.[world.imageEngine]||{},unit=estimateImageCost({engine:world.imageEngine,quality:'final',size:'1536x1024',config}).costUsd,pages=Number(wizard.pageCount)||12;
 return {baseUsd:text.costUsd+planning.costUsd+(pages+1)*unit,withMaterialsAndRetryUsd:text.costUsd+planning.costUsd+(pages*2+11)*unit,imageEngine:world.imageEngine,pageCount:pages,requests:text.requestCount+1,note:'참고 단가 추정 · 새 시트 최대 10장과 유사 그림 1회 재생성 포함 상단 · 글 자동 수정·입력 참조 요금 별도'};
}
export async function preflightFullAuto(state,job){
 if(!job.allowNew){const places=preflightOutlineLocations({backgrounds:active(state.backgrounds)});if(!places.valid)throw Error(places.errors.join('\n'));}
 const engines=new Map();for(const stage of ['outline','sceneBriefs','proseDraft','prose','enrichment','pagination']){if(stage==='proseDraft'&&!job.textSettings.hybrid?.enabled)continue;const selected=resolveStoryStageSettings(job.textSettings,stage);engines.set(selected.engineId,selected.config);}
 for(const [engine,config] of engines){if(engine==='local'||config.proxyEndpoint||config.transport==='proxy')continue;if(!await getCredential(engine))throw Error(`${engine} 글 엔진의 API 키를 부모 설정에 저장해 주세요.`);}
 const world=getActiveWorld(state),config=world.providerConfig?.[job.imageEngine]||{};
 if(!['local','sample'].includes(job.imageEngine)&&!config.proxyEndpoint&&config.transport!=='proxy'&&!await getCredential(job.imageEngine))throw Error('이미지 엔진의 API 키를 부모 설정에 저장해 주세요.');
 if(job.imageEngine==='local'&&(!config.endpoint||!config.workflow))throw Error('ComfyUI 엔드포인트와 참조 이미지를 사용하는 워크플로를 부모 설정에 저장해 주세요.');
}
async function generateAutoBackground(state,background,{signal}={}){
 const world=getActiveWorld(state),config={...(state.settings.imageProviderConfig?.[world.imageEngine]||{}),...(world.providerConfig?.[world.imageEngine]||{})};delete config.apiKey;delete config.key;
 if(!config.proxyEndpoint&&config.transport!=='proxy')config.apiKey=await getCredential(world.imageEngine);
 const request=backgroundSheetRequest(state,background,{quality:'final'}),result=await generateImage(request,{engine:world.imageEngine,config:{...config,signal}}),asset=await saveImage(result.imageUrl,{signal});
 return {imageAssetId:asset.assetId,imageUrl:'asset:'+asset.assetId,seed:result.seed??null,meta:{...result.meta,requestedSeed:request.seed,quality:'final',source:'app-background-sheet',autoGenerated:true,worldId:world.id,worldRevision:world.revision,imageEngine:world.imageEngine,stylePresetId:world.stylePresetId}};
}
const DEFAULT_OPS={plan:generateMaterialPlan,outline:generateOutline,briefs:generateSceneBriefs,prose:generateProse,enrichment:enrichProse,pagination:paginateStory,characterSheet:generateCharacterSheet,backgroundSheet:generateAutoBackground,scene:generateScene,cover:generateCover,preflight:preflightFullAuto,prepare:inputFromWizard};
export function fullAutoPayload(job){const prose=resolveStoryStageSettings(job.textSettings,'prose');return {id:job.storyDraftId,bookId:job.bookId,wizard:clone(job.wizard),input:clone(job.input),outline:clone(job.outline),sceneBriefs:clone(job.sceneBriefs||[]),prose:clone(job.prose),pagination:clone(job.pagination),richnessCheck:clone(job.richnessCheck||null),textSettings:clone(job.textSettings),textEngineId:prose.engineId,textModelId:prose.config.model,summaryForNext:summarizeStory(job.outline,{...job.input,prose:job.prose,pagination:job.pagination}),readingLevels:clone(job.readingLevels),usage:clone(job.usage),storyCheck:clone(job.storyCheck||{}),demo:false,worldId:job.worldId,worldSnapshot:clone(job.worldSnapshot)};}
function recordUsage(job,result,callId){if(!result?.usage||result.meta?.requests===0)return;const row={...clone(result.usage),...clone(result.meta||{}),callId,at:now()},index=job.usage.calls.findIndex(c=>c.callId===callId);if(index<0)job.usage.calls.push(row);else job.usage.calls[index]=row;}
function recordImage(job,result){if(!result)return;const add=(id,meta)=>{if(id&&meta)job.imageUsage[id]={imageAssetId:id,engine:meta.engine||meta.imageEngine||job.imageEngine,costUsd:meta.costUsd??null,costUsdEstimated:meta.costUsdEstimated??null,quality:meta.quality,generatedAt:meta.generatedAt||now()};};add(result.imageAssetId,result.meta||result.imageMeta);for(const old of result.imageHistory||[])add(old.imageAssetId,old.imageMeta);}
function assertJobWorld(state,job){const world=getActiveWorld(state);if(world.id!==job.worldId||world.revision!==job.worldRevision||world.imageEngine!==job.imageEngine||world.stylePresetId!==job.stylePresetId)throw Error('World 설정이 바뀌었어요. 원래 World 설정으로 돌아온 뒤 이어 만들거나 새 FULL AUTO를 시작해 주세요.');for(const [id,signature] of Object.entries({...job.initialSignatures,...job.plan?.existingSignatures,...job.plan?.materialSignatures})){const item=[...state.characters,...state.backgrounds].find(x=>x.id===id);if(!item||materialSignature(item)!==signature)throw Error('사용 중인 기존 재료가 수정·삭제되었어요. 완성한 부분을 검토하거나 새 FULL AUTO를 시작해 주세요.');}}
export async function runFullAuto(state,job,{signal,save=()=>true,onProgress=()=>{},buildBook,operations={}}={}){
 const ops={...DEFAULT_OPS,...operations};if(job.status==='running')throw Error('이 자동 작업이 이미 실행 중이에요.');
 const persist=async()=>{job.updatedAt=now();if(await save()===false)throw Error('자동 작업을 저장하지 못했어요. 저장 공간을 확인해 주세요.');};
 const report=message=>onProgress({job,message,phase:job.phase});
 const step=async(key,label,operation,apply)=>{if(job.completed[key])return;abort(signal);assertJobWorld(state,job);job.phase=label;job.currentStep=key;job.operationSequence=(job.operationSequence||0)+1;const callId=job.id+':'+job.operationSequence;await persist();report(label);
  const textOptions=stage=>({...resolveStoryStageSettings(job.textSettings,stage),signal,sceneBriefs:job.sceneBriefs,bookId:job.bookId,stylePreset:getStylePreset(job.stylePresetId),storyEnrichment:job.textSettings.storyEnrichment!==false,richness:job.textSettings.storyEnrichment!==false,enrichmentCheckpoint:job.enrichmentCheckpoint,
   onProgress:p=>report(p.message||label),onCheckpoint:async cp=>{if(cp.sceneBriefs)job.sceneBriefs=clone(cp.sceneBriefs);if(cp.prose)job.prose=clone(cp.prose);if(cp.enrichmentCheckpoint)job.enrichmentCheckpoint=clone(cp.enrichmentCheckpoint);if(cp.pagination)job.pagination=clone(cp.pagination);if(cp.checks)job.storyCheck=clone(cp.checks);if(cp.richnessChecks)job.richnessCheck=clone(cp.richnessChecks);recordUsage(job,cp,callId);await persist();abort(signal);}});
  try{const result=await operation(textOptions);recordUsage(job,result,callId);if(apply)await apply(result);job.completed[key]=now();await persist();abort(signal);}
  catch(error){if(error.usage)recordUsage(job,{usage:error.usage,meta:{...error.meta,failed:true}},callId);throw error;}
 };
 try{assertJobWorld(state,job);abort(signal);await ops.preflight(state,job);job.status='running';job.error=null;await persist();
  await step('plan','주제에 맞는 등장인물·배경 고르기',opts=>ops.plan(job.input,{characters:active(state.characters),backgrounds:active(state.backgrounds),allowNew:job.allowNew},opts('outline')),result=>{const catalog={characters:active(state.characters),backgrounds:active(state.backgrounds),pinnedCharacterIds:job.wizard.characterIds,allowNew:job.allowNew},checked=inspectAutoMaterialPlan(result.data,catalog);if(!checked.valid)throw Error(checked.errors.join('\n'));job.plan=materializeAutoPlan(result.data,job,catalog);});
  assertJobWorld(state,job);for(const character of job.plan.newCharacters){if(!state.characters.some(c=>c.id===character.id))state.characters.push(clone(character));}for(const bg of job.plan.newBackgrounds){if(!state.backgrounds.some(b=>b.id===bg.id))state.backgrounds.push(clone(bg));}await persist();
  for(const id of job.plan.characterIds){const character=state.characters.find(c=>c.id===id);if(!character||character.archivedAt)throw Error('선택한 캐릭터가 없어 작업을 중지했어요.');
   if(getCharacterSheet(state,id))continue;
   await step('character:'+id,character.name+' 캐릭터 시트 만들기',()=>ops.characterSheet(state,character,{quality:'final',signal}),result=>{markCharacterSheetConfirmed(state,id,{...result,meta:{...result.meta,autoGenerated:true,autoRunId:job.id}});character.autoReviewPending=true;recordImage(job,result);});
  }
  for(const id of job.plan.backgroundIds){const background=state.backgrounds.find(b=>b.id===id);if(!background||background.archivedAt)throw Error('선택한 배경이 없어 작업을 중지했어요.');const selected=getWorldBackgroundSnapshot(state,background);if(selected.imageAssetId||selected.imageUrl)continue;
   if(job.imageEngine==='sample'){if(!job.notes.includes('무료 샘플은 배경 시트를 생성하지 않으며 본문도 고정 그림 템플릿이에요.'))job.notes.push('무료 샘플은 배경 시트를 생성하지 않으며 본문도 고정 그림 템플릿이에요.');continue;}
   await step('background:'+id,background.name+' 고정 배경 시트 만들기',()=>ops.backgroundSheet(state,background,{signal}),result=>{const world=getActiveWorld(state),meta={...result.meta,autoGenerated:true,autoRunId:job.id,worldId:world.id,worldRevision:world.revision,imageEngine:world.imageEngine,stylePresetId:world.stylePresetId,quality:'final'},sheet={...clone(result),id:result.imageAssetId,meta,settings:backgroundSettingsKey(background),confirmedAt:now()};(background.backgroundSheets||=[]).push(sheet);Object.assign(background,{imageAssetId:sheet.imageAssetId,imageUrl:sheet.imageUrl,backgroundSheetMeta:meta,backgroundSheetSettingsKey:sheet.settings,backgroundSheetConfirmedAt:sheet.confirmedAt,autoReviewPending:true});recordImage(job,sheet);});
  }
  if(!job.completed.input){job.wizard.characterIds=clone(job.plan.characterIds);job.wizard.backgroundIds=clone(job.plan.backgroundIds);const prepared=ops.prepare(state,job.wizard);job.input={...prepared.input,backgrounds:prepared.input.backgrounds.filter(b=>job.plan.backgroundIds.includes(b.id)),preferredBackgroundIds:clone(job.plan.backgroundIds),specs:clone(job.readingLevels.specs)};job.plan.materialSignatures=Object.fromEntries([...job.plan.characterIds.map(id=>state.characters.find(c=>c.id===id)),...job.plan.backgroundIds.map(id=>state.backgrounds.find(b=>b.id===id))].map(item=>[item.id,materialSignature(item)]));job.completed.input=now();await persist();}
  await step('outline','줄거리 만들기',opts=>ops.outline(job.input,opts('outline')),r=>{job.outline=r.data;job.input.title=r.data.titleCandidates[0];});
  await step('briefs','장면 디테일 만들기',opts=>ops.briefs(job.outline,job.input,opts('sceneBriefs')),r=>job.sceneBriefs=r.data);
  if(job.textSettings.hybrid?.enabled)await step('proseDraft','로컬 전문 초안 쓰기',opts=>ops.prose(job.outline,job.input,opts('proseDraft')),r=>job.localDraftProse=r.data);
  await step('prose','한글·영어 전문 쓰기',opts=>ops.prose(job.outline,{...job.input,...(job.localDraftProse?{draftProse:job.localDraftProse}:{})},opts('prose')),r=>job.prose=r.data);
  if(job.textSettings.storyEnrichment!==false)await step('enrichment','문단별 글 풍부화',opts=>ops.enrichment(job.prose,job.outline,job.input,opts('enrichment')),r=>{job.prose=r.data;job.enrichmentCheckpoint=r.meta?.enrichmentCheckpoint||job.enrichmentCheckpoint;});
  await step('pagination','쪽 나누기와 본문 검사',opts=>ops.pagination(job.outline,job.prose,job.input,opts('pagination')),r=>{job.pagination=r.data;job.storyCheck=r.meta?.checks||inspectStory(job.outline,r.data,job.input);job.richnessCheck=r.meta?.richnessChecks||null;});
  if(job.pagination.pages.length!==job.input.pageCount)throw Error(`목표 ${job.input.pageCount}쪽과 생성한 ${job.pagination.pages.length}쪽이 달라요. 완료된 글을 검토해 주세요.`);
  if(!job.book){if(typeof buildBook!=='function')throw Error('책 편집 연결을 확인해 주세요.');const payload=fullAutoPayload(job);state.storyDrafts||={};state.storyDrafts[job.storyDraftId]={...clone(payload),stage:'paged',reviewMode:'pages',selectedTitle:payload.pagination.cover?.title,createdAt:job.createdAt,fullAutoRunId:job.id};job.book=await buildBook(payload);job.book.fullAutoRunId=job.id;job.book.autoReviewPending=true;captureBookGenerationSnapshot(state,job.book);state.storyDrafts[job.storyDraftId].pictureBook=job.book;await persist();}
  for(let index=0;index<job.book.pages.length;index++){const page=job.book.pages[index];if(page.imageAssetId&&page.imageMeta?.quality==='final')continue;await step('page:'+index,`${index+1} / ${job.book.pages.length}쪽 그림 만들기`,()=>ops.scene(state,job.book,index,{quality:'final',signal,onProgress:p=>report(p.message||`${index+1}쪽 그림 · ${p.status}`)}),r=>recordImage(job,r));}
  if(!job.book.cover?.imageAssetId)await step('cover','표지 그림 만들기',()=>ops.cover(state,job.book,{quality:'final',signal}),r=>recordImage(job,r));
  job.book.stage='illustrated';job.book.approved=false;job.book.autoGenerationComplete=true;job.status='review';job.phase='완성 초안 · 부모 검토';job.currentStep=null;state.storyDrafts[job.storyDraftId].stage='illustrated';await persist();report('본문과 그림·표지 생성을 마쳤어요. 전체 내용을 확인해 주세요.');return job.book;
 }catch(error){if(job.book){for(const page of job.book.pages||[])recordImage(job,page);recordImage(job,job.book.cover);}job.status=error.name==='AbortError'||signal?.aborted?'paused':'failed';job.error=error.name==='AbortError'?null:String(error.message||error);job.phase=job.status==='paused'?'중단 · 이어 만들 수 있어요':job.phase;try{await persist();}catch(saveError){error.message=saveError.message;}report(job.error||'완료된 결과를 보관했어요.');throw error;}
}
