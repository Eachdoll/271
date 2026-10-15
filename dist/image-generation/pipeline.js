/* Explicit, cancellable generation. No provider retries or local-sample fallbacks. */
import {generateImage} from './providers.js';
import {getCredential} from './vault.js';
import {saveImage,deleteImageAsset} from './assets.js';
import {
  getActiveWorld, captureBookGenerationSnapshot,
  sceneGenerationRequest, commitSceneResult, createCharacterSheetRequest
} from './world.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const ENGINE_NAMES={google:'Google',openai:'OpenAI',bfl:'BFL',fal:'Fal',local:'Local ComfyUI',sample:'무료 샘플'};

export class ImageGenerationError extends Error {
  constructor(message,code='IMAGE_GENERATION_ERROR',cause) {
    super(message);
    this.name='ImageGenerationError';
    this.code=code;
    if(cause) this.cause=cause;
  }
}

function throwIfAborted(signal) {
  if(signal?.aborted) throw new DOMException('그림 만들기를 취소했어요.','AbortError');
}

function report(onProgress,value) {
  if(typeof onProgress==='function') onProgress(value);
}

function worldForSnapshot(state,snapshot) {
  return state.worlds?.find(world=>world.id===snapshot?.worldId)||getActiveWorld(state);
}

async function providerConfig(state,world,engine,signal) {
  throwIfAborted(signal);
  // Credentials supplied in imported/plain application state are deliberately ignored.
  const config={...(state.settings?.imageProviderConfig?.[engine]||{}),...(world.providerConfig?.[engine]||{})};
  delete config.apiKey;
  delete config.key;
  delete config.token;
  if(!Object.hasOwn(ENGINE_NAMES,engine)) throw new ImageGenerationError('지원하지 않는 이미지 엔진이에요.','UNKNOWN_ENGINE');
  const proxy=config.proxyEndpoint||config.transport==='proxy';const apiKey=engine==='sample'||proxy?null:await getCredential(engine);
  throwIfAborted(signal);
  if(!['local','sample'].includes(engine)&&!apiKey&&!proxy) throw new ImageGenerationError(`${ENGINE_NAMES[engine]} API 키가 필요해요. 부모 설정에서 키를 등록해 주세요.`,'MISSING_CREDENTIAL');
  return {...config,apiKey:apiKey||undefined,signal};
}

function requestOptions(options) {
  return {
    ...(options.seed!==undefined?{seed:options.seed}:{}),
    ...(options.size?{size:options.size}:{}),
    ...(options.quality?{quality:options.quality}:{})
  };
}

function validateRequest(request) {
  if(!request||typeof request.prompt!=='string'||!request.prompt.trim()) throw new ImageGenerationError('그림 장면 설명이 필요해요.','MISSING_PROMPT');
  if(!request.stylePreset||typeof request.stylePreset!=='object') throw new ImageGenerationError('세계에 사용할 화풍을 먼저 골라 주세요.','MISSING_STYLE');
  if(!Array.isArray(request.referenceImages)) throw new ImageGenerationError('캐릭터와 화풍 참조 이미지가 필요해요.','MISSING_REFERENCES');
  if(!Number.isSafeInteger(request.seed)) throw new ImageGenerationError('그림의 시드를 먼저 지정해 주세요.','INVALID_SEED');
  if(!request.size||!request.quality) throw new ImageGenerationError('그림 크기와 품질을 지정해 주세요.','MISSING_IMAGE_OPTIONS');
}

function metadata(result,request,context) {
  return {
    ...clone(result.meta||{}),...context,
    prompt:request.prompt,
    stylePreset:clone(request.stylePreset),
    requestedSeed:request.seed,
    returnedSeed:result.seed??null,
    size:request.size,quality:request.quality,
    referenceCount:request.referenceImages.length,
    generatedAt:new Date().toISOString()
  };
}

function annotate(error,context) {
  if(!error||typeof error!=='object') error=new ImageGenerationError(String(error));
  for(const [key,value] of Object.entries(context)) {
    try {error[key]=value;} catch { /* DOMException may expose read-only properties. */ }
  }
  return error;
}

function archiveCurrentPageImage(page) {
  if(!page.imageUrl&&!page.imageAssetId) return;
  page.imageHistory ||= [];
  page.imageHistory.push({
    imageAssetId:page.imageAssetId||null,
    imageUrl:page.imageAssetId?`asset:${page.imageAssetId}`:page.imageUrl,
    imageSeed:page.imageSeed??null,
    effectiveImageSeed:page.effectiveImageSeed??null,
    imageMeta:page.imageMeta?clone(page.imageMeta):null,
    imageSceneSnapshot:page.imageSceneSnapshot?clone(page.imageSceneSnapshot):null,
    archivedAt:new Date().toISOString()
  });
}

/** Regenerate exactly one selected page, preserving the rest of the book. */
export async function generateScene(state,book,pageIndex,options={}) {
  const {signal,onProgress}=options;
  const page=book.pages?.[pageIndex];
  if(!page) throw new ImageGenerationError('이야기 쪽을 찾을 수 없어요.','PAGE_NOT_FOUND');
  throwIfAborted(signal);
  const previousSeed=page.imageSeed;
  try {
    report(onProgress,{status:'preparing',completed:0,total:1,pageIndex});
    const request=sceneGenerationRequest(state,book,pageIndex,requestOptions(options));
    validateRequest(request);
    const snapshot=captureBookGenerationSnapshot(state,book);
    const world=worldForSnapshot(state,snapshot);
    const engine=snapshot.imageEngine;
    const sceneSnapshot={
      scene:clone(page.scene||{}),ko:page.ko||'',en:page.en||'',
      worldId:snapshot.worldId,worldRevision:snapshot.worldRevision,
      imageEngine:engine,stylePresetId:snapshot.stylePresetId,
      characterSheetIds:snapshot.characterSheets.map(sheet=>sheet.id),
      requestedSeed:request.seed,size:request.size,quality:request.quality,
      capturedAt:new Date().toISOString()
    };
    const config=await providerConfig(state,world,engine,signal);if(engine==='google'){config.googlePro=false;config.modelVariant='flash';}
    throwIfAborted(signal);
    report(onProgress,{status:'generating',completed:0,total:1,pageIndex,engine});
    // The six required fields from the World helper are forwarded verbatim.
    const result=await generateImage(request,{engine,config});
    throwIfAborted(signal);
    if(!result?.imageUrl) throw new ImageGenerationError('제공자가 그림을 반환하지 않았어요.','EMPTY_PROVIDER_RESULT');
    report(onProgress,{status:'saving',completed:0,total:1,pageIndex,engine});
    const asset=await saveImage(result.imageUrl,{signal});
    throwIfAborted(signal);
    // Archive the old seed rather than the seed just allocated for this request.
    const newSeed=page.imageSeed;
    if(previousSeed!==undefined) page.imageSeed=previousSeed;
    archiveCurrentPageImage(page);
    page.imageSeed=newSeed;
    const persistedResult={
      imageUrl:`asset:${asset.assetId}`,imageAssetId:asset.assetId,
      seed:result.seed,
      meta:metadata(result,request,{engine,worldId:snapshot.worldId,worldRevision:snapshot.worldRevision,stylePresetId:snapshot.stylePresetId})
    };
    commitSceneResult(state,book,pageIndex,persistedResult);
    page.imageAssetId=asset.assetId;
    page.imageUrl=`asset:${asset.assetId}`;
    page.imageSceneSnapshot=sceneSnapshot;
    book.approved=false;
    report(onProgress,{status:'complete',completed:1,total:1,pageIndex,engine,imageAssetId:asset.assetId});
    return page;
  } catch(error) {
    const cancelled=error?.name==='AbortError'||signal?.aborted;
    report(onProgress,{status:cancelled?'cancelled':'error',completed:0,total:1,pageIndex,message:error.message});
    throw annotate(error,{pageIndex});
  }
}

/** Two simultaneous requests at most. Stops scheduling immediately on error/cancel. */
export async function generateAllScenes(state,book,options={}) {
  const {signal,onProgress}=options;
  throwIfAborted(signal);
  const total=book.pages?.length||0;
  if(!total) throw new ImageGenerationError('그림을 만들 이야기 쪽이 없어요.','EMPTY_BOOK');
  captureBookGenerationSnapshot(state,book);
  const controller=new AbortController();
  const externalAbort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',externalAbort,{once:true});
  if(signal?.aborted) externalAbort();
  let nextIndex=0,completed=0,firstError=null;
  const results=[];
  report(onProgress,{status:'preparing',completed,total,pageIndex:null});
  const worker=async()=>{
    while(!firstError&&!controller.signal.aborted) {
      const pageIndex=nextIndex++;
      if(pageIndex>=total) return;
      try {
        const page=await generateScene(state,book,pageIndex,{
          ...requestOptions(options),signal:controller.signal,
          onProgress:progress=>{
            if(progress.status!=='complete'&&progress.status!=='error'&&progress.status!=='cancelled') report(onProgress,{...progress,completed,total});
          }
        });
        results.push({pageIndex,page});
        completed++;
        report(onProgress,{status:'complete',completed,total,pageIndex,imageAssetId:page.imageAssetId});
      } catch(error) {
        if(!firstError&&!signal?.aborted) firstError=annotate(error,{pageIndex});
        controller.abort(error);
        return;
      }
    }
  };
  try {
    // Await every in-flight worker so no page changes after the promise settles.
    await Promise.allSettled(Array.from({length:Math.min(2,total)},worker));
    results.sort((a,b)=>a.pageIndex-b.pageIndex);
    if(firstError) {
      report(onProgress,{status:'error',completed,total,pageIndex:firstError.pageIndex,message:firstError.message});
      throw annotate(firstError,{completed,total,partialResults:results});
    }
    if(controller.signal.aborted||signal?.aborted) {
      const error=new DOMException('그림 만들기를 취소했어요.','AbortError');
      report(onProgress,{status:'cancelled',completed,total,pageIndex:null});
      throw annotate(error,{completed,total,partialResults:results});
    }
    report(onProgress,{status:'finished',completed,total,pageIndex:null});
    if(book.prose)book.stage='illustrated';return {book,results,completed,total};
  } finally {
    signal?.removeEventListener('abort',externalAbort);
  }
}

/** Generate an unconfirmed candidate. A parent must explicitly approve it later. */
export async function generateCharacterSheet(state,characterOrId,options={}) {
  const {signal,onProgress}=options;
  throwIfAborted(signal);
  const character=typeof characterOrId==='object'?characterOrId:state.characters?.find(item=>item.id===characterOrId);
  if(!character?.id) throw new ImageGenerationError('캐릭터를 먼저 저장해 주세요.','CHARACTER_NOT_FOUND');
  const world=getActiveWorld(state);
  const context={
    worldId:world.id,worldRevision:world.revision,engine:world.imageEngine,
    stylePresetId:world.stylePresetId,characterId:character.id,
    characterSnapshot:clone({...character,characterSheets:undefined})
  };
  let savedAsset;
  try {
    report(onProgress,{status:'preparing',completed:0,total:1,pageIndex:null,characterId:character.id});
    const request=createCharacterSheetRequest(state,character,requestOptions(options));
    validateRequest(request);
    const config=await providerConfig(state,world,context.engine,signal);
    throwIfAborted(signal);
    report(onProgress,{status:'generating',completed:0,total:1,pageIndex:null,characterId:character.id,engine:context.engine});
    const result=await generateImage(request,{engine:context.engine,config});
    throwIfAborted(signal);
    if(!result?.imageUrl) throw new ImageGenerationError('제공자가 캐릭터 시트를 반환하지 않았어요.','EMPTY_PROVIDER_RESULT');
    report(onProgress,{status:'saving',completed:0,total:1,pageIndex:null,characterId:character.id});
    const asset=await saveImage(result.imageUrl,{signal});savedAsset=asset;
    throwIfAborted(signal);
    const candidate={imageUrl:asset.imageUrl,imageAssetId:asset.assetId,seed:result.seed??null,meta:metadata(result,request,context)};
    report(onProgress,{status:'complete',completed:1,total:1,pageIndex:null,characterId:character.id,imageAssetId:asset.assetId});
    return candidate;
  } catch(error) {
    if(savedAsset)await deleteImageAsset(savedAsset.assetId).catch(()=>{});
    report(onProgress,{status:error?.name==='AbortError'||signal?.aborted?'cancelled':'error',completed:0,total:1,pageIndex:null,characterId:character.id,message:error.message});
    throw annotate(error,{characterId:character.id});
  }
}

/** Separate cover artwork; shares the frozen cast, style and seed contract. */
export async function generateCover(state,book,options={}){
  const {signal}=options;throwIfAborted(signal);
  const request=sceneGenerationRequest(state,book,0,{...requestOptions(options),quality:options.quality||'final'});
  request.prompt=`Create a welcoming children's picture-book cover for this original story: ${book.topic||book.title}. ${book.pagination?.cover?.sceneAction?'Cover scene: '+book.pagination.cover.sceneAction+'. ':''}Show the selected main character and companions together in the story's setting, with clear silhouettes and generous quiet space at the upper left for a title added separately. No text, letters, logos or watermark. ${request.prompt}`;
  const snapshot=captureBookGenerationSnapshot(state,book),world=worldForSnapshot(state,snapshot),engine=snapshot.imageEngine;
  const config=await providerConfig(state,world,engine,signal);
  let asset;
  try{
    const result=await generateImage(request,{engine,config});throwIfAborted(signal);
    asset=await saveImage(result.imageUrl,{signal});throwIfAborted(signal);
    if(book.cover)book.coverHistory=[...(book.coverHistory||[]),clone(book.cover)];
    book.cover={imageAssetId:asset.assetId,imageUrl:`asset:${asset.assetId}`,seed:result.seed??null,meta:metadata(result,request,{engine,worldId:snapshot.worldId,worldRevision:snapshot.worldRevision,stylePresetId:snapshot.stylePresetId})};
    return book.cover;
  }catch(error){if(asset)await deleteImageAsset(asset.assetId).catch(()=>{});throw error;}
}
