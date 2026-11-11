import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.env.DONGHWA_APP_ROOT || process.cwd();
const out=process.env.DONGHWA_AUDIT_OUT || '/workspace/artifacts/r61';
fs.mkdirSync(out,{recursive:true});
const imp=p=>import(pathToFileURL(root+'/dist/'+p));
const [W,G,F,S,{seedState},{migrateReadingSettings},{inputFromWizard},{normalizeStoryInput,toLegacyPages},{demoOutline},{applyPageText},{getStylePreset},{pageTextKey},{renderImageRequest}]=await Promise.all(['story-generation/writers-room.js','image-generation/world.js','full-auto.js','image-generation/scene-prompt.js','engine.js','reading-ui.js','story-generation/ui.js','story-generation/pipeline.js','story-generation/demo.js','story-generation/page-tools.js','image-generation/styles.js','story-generation/picture-plan.js','image-generation/story-renderer.js'].map(imp));
let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No network in audit');};
const setup=()=>{const s=seedState();G.migrateWorldState(s);migrateReadingSettings(s.settings);return s;};
const s=setup(),wizard={characterIds:['yuha','mom'],backgroundIds:['home','forest'],topic:'숲속에서 만나는 사슴',pageCount:16,koreanLevel:'K2',englishLevel:'E2',language:'bilingual',value:'none',ending:'home',simpleFlow:true};
const input=normalizeStoryInput({...inputFromWizard(s,wizard,{layout:'openings'}).input,bookId:'r61-recheck'});
const premise={title:'숲의 하루',line:'숲에서 친구를 만나요.',engine:'reader_knows',laugh:'귀가 보여요.',picture:'나무',cast:[{name:'유하',isNew:false},{name:'엄마',isNew:false}],places:[]};
const outline={...W.roomOutline(input,{premise,pitches:[]}),writersRoom:{kind:'writersRoom',version:1,premise}};
const response=json=>({json,usage:{input:0,output:0},meta:{requests:1,model:'offline-mock'}});
const r={source:'32c854d',weave:input.writersRoom.weave};
function snapshot(book,state=s){const w=G.getActiveWorld(state);book.generationSnapshot={worldId:w.id,imageEngine:'sample',stylePresetId:w.stylePresetId,stylePreset:getStylePreset(w.stylePresetId),styleReferences:[],characterSheets:book.characterIds.map(id=>({id:'s-'+id,characterId:id,confirmedAt:'now',imageUrl:'https://qa.invalid/'+id+'.png',characterSnapshot:structuredClone(state.characters.find(c=>c.id===id))})),backgrounds:state.backgrounds.filter(b=>book.backgroundIds.includes(b.id))};}
// A: real text-edit API, only Korean changed as a parent normally edits it.
{
 const before={ko:'유하가 숲에서 큰 나무를 올라가요.',en:'Yuha climbs a tall tree in the forest.'};
 const p={...before,staging:{shot:'medium',characterSide:'left',textSide:'right'},textKo:before.ko,textEn:before.en,scene:{who:['yuha'],where:'forest',action:before.en,props:['tree'],timeOfDay:'day',emotion:'calm',textKey:pageTextKey(before.ko,before.en)}};
 const b={id:'edit',storyInput:input,outline,characterIds:['yuha','mom'],backgroundIds:['home','forest'],pages:[p],pagination:{pages:[structuredClone(p)]}};snapshot(b);
 await applyPageText(s,b,0,{ko:'엄마가 집에서 물을 마셔요.',en:before.en,save:()=>true});
 const req=G.sceneGenerationRequest(s,b,0);fs.writeFileSync(out+'/edited-page-request.txt',req.prompt);
 r.edited={ko:p.ko,en:p.en,actualEvent:req.prompt.match(/Actual event: ([\s\S]*?)Current page narrative:/)?.[1],refs:req.referenceImages.map(x=>x.label),oldPlaceStillPresent:req.prompt.includes('forest'),oldCast:p.scene.who};

}
// D: the structural case is accepted wholesale; unchanged text also accepts arbitrary art changes.
{
 const before=Array.from({length:8},(_,i)=>({ko:`원래 ${i+1}쪽이에요.`,art:'a tree'}));
 const after=structuredClone(before);after[7].ko='외계인이 유하를 화성으로 데려가요.';after.push({ko:'새 끝이에요.'});
 const scope={pages:[1,2,3],laughs:[8]};
 const structural=W.mergeRewrite(before,after,scope);
 const art=structuredClone(before);art[7].art='A monster destroys the house.';
 const artMerge=W.mergeRewrite(before,art,scope);
 const append=structuredClone(before);append[7].ko+=' 외계인이 왔어요.';
 r.rewrite={structural:structural.structural,outsideText:structural.pages[7].ko,laughProtected:structural.pages[7].ko===before[7].ko,outsideArt:artMerge.pages[7].art,outsideAppend:W.mergeRewrite(before,append,{pages:[1,2,3],laughs:[]}).pages[7].ko};

}
// H: a partial English reply and its one repair through drafts, then through the real pages wrapper.
{
 const ko=JSON.parse(fs.readFileSync(root+'/QA/r60-text/manuscript.json','utf8')).pages.map(x=>({ko:x.ko}));let englishCalls=0;
 const engine={id:'openai',async complete(req){const p=req.jsonSchema.properties,it=p.pages?.items?.properties||{};
 if(p.ties)return response({notes:[],ties:[],looks:[],placeLooks:[]});if(p.flow)return response({flow:'길을 걸어요',plants:[]});
 if(p.readers)return response({readers:W.PANEL_IDS.map((reader,i)=>({reader,favorite:1,again:true,drafts:[{draft:1,skipPage:i+1,lostPage:0,change:'',changePage:0,hardPage:0,mannersPage:0,laughPages:[]}]}))});
 if(it.en&&!it.ko){englishCalls++;return response({pages:englishCalls===1?Array.from({length:req.jsonSchema.properties.pages.minItems},(_,i)=>({pageNo:i+1,en:'Yuha looks around the forest.'})).filter(x=>x.pageNo!==3):[]});}
 return response({title:'숲의 하루',pages:ko});}};
 const draft=await W.runRoomDrafts(input,outline,{engine,engineId:'openai',roomFlowCount:1,roomPolish:false,roomRewrite:false},{engineFor:()=>engine});
 const extractor={id:'openai',async complete(req){return response({cover:{title:'숲의 하루',sceneAction:'Yuha alone'},pages:Array.from({length:req.jsonSchema.properties.pages.minItems},(_,i)=>({pageNo:i+1,who:['yuha'],where:'forest',action:'Yuha walks.',emotion:'calm',timeOfDay:'day',props:[],shot:'middle',space:'airy',carrier:'both',focus:'Yuha',backdrop:'scene',hidden:'',holdBack:'',lettering:'',letteringOn:'',seenAs:''}))});}};
 const paged=await W.runRoomPages(input,outline,draft.data,{engine:extractor,engineId:'openai'},{engineFor:()=>extractor});
 const legacy=toLegacyPages(paged.data);
 r.english={calls:englishCalls,missing:draft.data.room.englishMissing,draftEnglish:draft.data.pages[2].en??null,pageEnglish:paged.data.pages[2].textEn,legacyEnglish:legacy[2].en,ko:legacy[2].ko};

}
// B: keep the new cast in a real FULL AUTO book and see what later drawer edits do to its image.
{
 const state=setup(),job=F.createFullAutoJob(state,wizard,{allowNew:false,planMode:'selection',stopBefore:'text'}),target=4;
 const fawn={name:'폴짝이',isNew:true,nameEn:'Hoppy',kind:'fawn',want:'쉬어요'},ol={...outline,writersRoom:{...outline.writersRoom,premise:{...premise,cast:[...premise.cast,fawn]}}};
 const dp=Array.from({length:16},(_,i)=>({ko:i===target?'폴짝이가 혼자 나무 아래 쉬어요.':`유하가 ${i+1}번째 나무를 봐요.`,en:i===target?'Hoppy rests alone under a tree.':`Yuha sees tree ${i+1}.`}));
 const extract={id:'openai',async complete(req){const id=state.characters.find(c=>c.name==='폴짝이').id;return response({cover:{title:'숲의 하루',sceneAction:'Yuha alone'},pages:Array.from({length:req.jsonSchema.properties.pages.minItems},(_,i)=>({pageNo:i+1,who:i===target?[id]:['yuha'],where:'forest',action:dp[i].en,emotion:'calm',timeOfDay:'day',props:['tree'],shot:'middle',space:'airy',carrier:'both',focus:i===target?'Hoppy':'Yuha',backdrop:'scene',hidden:'',holdBack:'',lettering:'',letteringOn:'',seenAs:''}))});}};
 await F.runFullAuto(state,job,{operations:{preflight:async()=>{},outline:async inp=>({data:{...demoOutline(inp),writersRoom:ol.writersRoom},meta:{requests:0}}),roomDrafts:async()=>({data:{title:'숲의 하루',pages:dp,room:{looks:{cast:[{name:'폴짝이',build:'four-legged',look:'a tiny blue fawn with one gold ear and striped legs'}],places:[]}}},meta:{requests:0}}),roomPages:(inp,o,d,opts)=>W.runRoomPages(inp,o,d,{...opts,engine:extract,engineId:'openai'},{engineFor:()=>extract})},buildBook:p=>({id:p.bookId,title:'숲의 하루',characterIds:p.wizard.characterIds,backgroundIds:p.wizard.backgroundIds,storyInput:p.input,outline:p.outline,pagination:p.pagination,pages:toLegacyPages(p.pagination)}),save:()=>true});
 assert.equal(job.status,'text-review');const b=job.book,card=state.characters.find(c=>c.name==='폴짝이');snapshot(b,state);
 const before=G.sceneGenerationRequest(state,b,target);card.description='a tall purple dragon with three red horns';
 const changed=G.sceneGenerationRequest(state,b,target);state.characters=state.characters.filter(c=>c.id!==card.id);
 const deleted=G.sceneGenerationRequest(state,b,target);
 r.identity={beforeHasGoldEar:before.prompt.includes('gold ear'),afterHasGoldEar:changed.prompt.includes('gold ear'),afterHasDragon:changed.prompt.includes('purple dragon'),afterDeleteHasIdentity:deleted.prompt.includes('gold ear'),frozenInputHasGoldEar:JSON.stringify(b.storyInput).includes('gold ear'),beforeRefs:before.referenceImages.map(x=>x.label)};

}
// D through the actual drafts stage, not only mergeRewrite.
{
 const original=Array.from({length:8},(_,i)=>({ko:`원래 ${i+1}쪽이에요.`,art:`original art ${i+1}`}));
 const stageCalls=[];
 const engine={id:'openai',async complete(req){const p=req.jsonSchema.properties,it=p.pages?.items?.properties||{};let kind='draft';
 if(p.ties){stageCalls.push('cast');return response({notes:[],ties:[],looks:[],placeLooks:[]});}
 if(p.flow){stageCalls.push('flow');return response({flow:'유하가 숲을 걸어요.',plants:[]});}
 if(p.readers){stageCalls.push('read');return response({readers:W.PANEL_IDS.map((reader,i)=>({reader,favorite:1,again:true,drafts:[{draft:1,skipPage:i+1,lostPage:0,laughPages:i<2?[8]:[],change:i<2?'2쪽만 줄여요.':'',changePage:i<2?2:0,hardPage:0,mannersPage:0}]}))});}
 if(p.kept){stageCalls.push('threads');return response({kept:[],loose:[],unplanted:[]});}
 if(it.en&&!it.ko){stageCalls.push('english');return response({pages:Array.from({length:p.pages.minItems},(_,i)=>({pageNo:i+1,en:'Yuha walks around the forest.'}))});}
 const d=structuredClone(original);
 if(req.user.includes('[독자 반응]')){kind='rewrite';d[7]={ko:'외계인이 유하를 화성으로 데려가요.',art:'Mars'};d.push({ko:'새 끝이에요.'});}
 stageCalls.push(kind);return response({title:'숲의 하루',pages:d});}};
 const d=await W.runRoomDrafts({...input,bookId:'r61-structural'},outline,{engine,engineId:'openai',roomFlowCount:1,roomPolish:false},{engineFor:()=>engine});
 r.rewritePipeline={stageCalls,scope:d.data.room.rewriteScope,acceptedAlien:d.data.pages.some(p=>p.ko.includes('화성')),pages:d.data.pages.length};

}
// F: the end-of-request exception is fixed; builtin style positives can still forbid text.
{
 const ids=['watercolor','crayon','comic'];r.lettering=ids.map(id=>{try{const x=renderImageRequest({prompt:'LETTERING — the only writing in this picture: "APOLLO 13" on the rocket.',stylePreset:getStylePreset(id),referenceImages:[]});return {id,style:x.stylePrompt,negative:x.negativePrompt,positiveNoText:/\bno text\b/i.test(x.stylePrompt),finalException:x.composedPrompt.includes('other than the lettering')};}catch(e){return{id,error:e.message};}});
}
// Compare a frozen weave-5 input against the unchanged operating R60 functions.
if(process.env.DONGHWA_R60_ROOT){
 const oldImp=p=>import(pathToFileURL(process.env.DONGHWA_R60_ROOT+'/dist/'+p));
 const oldG=await oldImp('image-generation/world.js');
 const oldRender=(await oldImp('image-generation/story-renderer.js')).renderImageRequest;
 const p={ko:'빈 숲이에요.',en:'An empty forest.',scene:{who:[],where:'forest',action:'An empty forest.',emotion:'calm',timeOfDay:'day',props:[]},staging:{shot:'medium'}};
 const b={storyInput:{...input,writersRoom:{version:1,weave:5}},outline,characterIds:['yuha','mom'],backgroundIds:['home','forest'],pages:[p]};snapshot(b);
 const before=oldG.sceneGenerationRequest(s,b,0),after=G.sceneGenerationRequest(s,b,0);
 const letter={prompt:'LETTERING — the only writing in this picture: \"APOLLO 13\" on the rocket.',stylePreset:getStylePreset('watercolor'),referenceImages:[]};
 r.compatibility={weave:5,pictureRefs:b.storyInput.pictureRefs,oldEmptyRefs:before.referenceImages.map(x=>x.label),newEmptyRefs:after.referenceImages.map(x=>x.label),sceneRequestEqual:JSON.stringify(before)===JSON.stringify(after),letteringRequestEqual:oldRender(letter).composedPrompt===renderImageRequest(letter).composedPrompt};
}
r.acceptance={editedPageUsesCurrentKo:!r.edited.actualEvent?.includes('climbs a tall tree')&&!r.edited.oldPlaceStillPresent,scopedRewritePreservesOtherPages:!r.rewritePipeline.acceptedAlien&&r.rewrite.laughProtected&&r.rewrite.outsideArt==='a tree',missingEnglishIsNotKorean:r.english.legacyEnglish!==r.english.ko,oneOffIdentityIsFrozen:r.identity.afterHasGoldEar&&r.identity.afterDeleteHasIdentity,letteringHasNoConflictingStyle:!r.lettering.some(x=>x.positiveNoText)};
r.blockingFindings=Object.values(r.acceptance).filter(x=>!x).length;
assert.equal(calls,0);r.networkCalls=calls;fs.writeFileSync(out+'/recheck.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));
