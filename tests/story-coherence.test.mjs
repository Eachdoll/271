import test from 'node:test';
import assert from 'node:assert/strict';
import {COHERENCE_REVIEW_SCHEMA,validateCoherenceReview,coherenceFingerprint,isCoherenceCurrent,plotContextForPage,attachPagePlotContext} from '../dist/story-generation/coherence.js';

const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const state={characters:[{characterId:'yuha',locationId:'home',knows:[]}],props:[{id:'cup',name:'물컵',ownerId:'yuha',locationId:'home',condition:'비어 있음'}],openPromises:[]};
  const after=clone(state);after.characters[0].locationId='garden';after.props[0].locationId='garden';after.props[0].condition='빗물이 담김';
  const outline={want:'유하가 꽃에 줄 빗물을 모아요.',beats:[{index:1,type:'setup',summary:'유하가 빈 물컵을 들고 정원으로 나가요.'},{index:2,type:'resolution',summary:'유하가 물컵에 모은 빗물을 꽃에 부어요.'}],plotContract:{version:1,protagonistId:'yuha',goal:'꽃에 줄 빗물을 모아요.',resolutionCriterion:'꽃뿌리가 빗물에 젖어요.',beats:[
    {beatIndex:1,becauseOfBeatIndex:null,trigger:'꽃의 흙이 말랐어요.',attempt:'유하가 빈 물컵을 정원에 가져가요.',obstacle:'창가에서는 빗물이 들어오지 않아요.',result:'정원에서 물컵에 빗물이 모여요.',nextDecision:'유하가 모은 빗물을 꽃에 주기로 해요.',stateBefore:clone(state),stateAfter:clone(after),setupIds:['water-flower'],payoffIds:[]},
    {beatIndex:2,becauseOfBeatIndex:1,trigger:'물컵에 빗물이 모였어요.',attempt:'유하가 꽃뿌리에 물을 부어요.',obstacle:'유하가 꽃잎에 물을 쏟지 않도록 살펴요.',result:'꽃뿌리가 빗물에 젖어요.',nextDecision:'유하가 빈 컵을 집에 가져가요.',stateBefore:clone(after),stateAfter:clone(state),setupIds:[],payoffIds:['water-flower']}
  ]}};
  const prose={ko:'유하가 물컵을 들고 정원으로 나가요.\n\n유하가 물컵에 모은 빗물을 꽃에 부어요.',en:'Yuha carries a cup into the garden.\n\nYuha pours the rain onto the flower.',paragraphBeats:{ko:[1,2],en:[1,2]},usedRefrainAt:[]};
  const pagination={cover:{title:'꽃에게 빗물을',sceneAction:'Yuha carries a cup to a flower.'},pages:[
    {pageNo:1,beatIndex:1,textKo:'유하가 물컵을 들고 정원으로 나가요.',textEn:'Yuha carries a cup into the garden.',scene:{who:['yuha'],where:'garden',action:'Yuha carries a cup into the garden.',props:['cup'],timeOfDay:'day',emotion:'curious'},variantByCharacter:{yuha:null},isRefrainPage:false},
    {pageNo:2,beatIndex:2,textKo:'유하가 물컵에 모은 빗물을 꽃에 부어요.',textEn:'Yuha pours the rain onto the flower.',scene:{who:['yuha'],where:'garden',action:'Yuha pours water from the cup onto the flower.',props:['cup','flower'],timeOfDay:'day',emotion:'happy'},variantByCharacter:{yuha:null},isRefrainPage:false}
  ]};
  return {outline,prose,pagination};
}
function issue(overrides={}){return {code:'state_conflict',beatIndex:1,pageNo:1,language:'ko',severity:'error',evidence:'유하가 물컵을 들고 정원으로 나가요.',suggestion:'물컵이 정원에 도착한 상태를 다음 장면에도 유지해 주세요.',...overrides};}
function report(source,stage='pages',review={passed:true,issues:[]}){return {version:1,stage,contentFingerprint:coherenceFingerprint({...source,stage}),...review,reviewedAt:'2026-10-16T10:00:00Z'};}

test('semantic reviewer cannot mark an evidenced error passed or fail without an actual error',()=>{
  const source=fixture();
  assert.equal(validateCoherenceReview({passed:true,issues:[]},source).valid,true);
  assert.equal(validateCoherenceReview({passed:false,issues:[issue()]},source).valid,true);
  assert.equal(validateCoherenceReview({passed:true,issues:[issue()]},source).valid,false);
  assert.equal(validateCoherenceReview({passed:false,issues:[]},source).valid,false);
  assert.equal(validateCoherenceReview({passed:false,issues:[issue({severity:'warning'})]},source).valid,false);
  assert.equal(validateCoherenceReview({passed:true,issues:[issue({severity:'warning'})]},source).valid,true);
});

test('review validation rejects fabricated locations, missing evidence, unsupported fields and oversized output',()=>{
  const source=fixture();
  const badIssues=[
    issue({beatIndex:99}),issue({beatIndex:2,pageNo:1}),issue({pageNo:24}),issue({pageNo:undefined}),
    issue({code:'too_boring'}),issue({language:'fr'}),issue({severity:'critical'}),
    issue({evidence:'   '}),issue({suggestion:''}),issue({suggestion:'x'.repeat(2001)}),
    issue({evidence:'유하가 갑자기 마법 지팡이를 꺼내요.'}),issue({evidence:'invented evidence'}),issue({hidden:'trust me'})
  ];
  for(const row of badIssues)assert.equal(validateCoherenceReview({passed:false,issues:[row]},source).valid,false,JSON.stringify(row));
  assert.equal(validateCoherenceReview({passed:true,issues:[],skipChecks:true},source).valid,false);
  assert.equal(validateCoherenceReview({passed:false,issues:Array.from({length:41},()=>issue())},source).valid,false);
  assert.equal(validateCoherenceReview(null,source).valid,false);
  assert.equal(COHERENCE_REVIEW_SCHEMA.additionalProperties,false);
  assert.equal(COHERENCE_REVIEW_SCHEMA.properties.issues.items.additionalProperties,false);
});

test('prose, page scenes and contract quotes anchor evidence while omissions can point at a required setup',()=>{
  const source=fixture();
  const proseIssue=issue({pageNo:null,language:'en',evidence:'Yuha carries a cup into the garden.'});
  assert.equal(validateCoherenceReview({passed:false,issues:[proseIssue]},{outline:source.outline,prose:source.prose}).valid,true);
  assert.equal(validateCoherenceReview({passed:false,issues:[issue({evidence:'Yuha carries a cup into the garden.',language:'both'})]},source).valid,true);
  assert.equal(validateCoherenceReview({passed:false,issues:[issue({code:'setup_payoff',pageNo:null,evidence:source.outline.plotContract.resolutionCriterion})]},source).valid,true);
  assert.equal(validateCoherenceReview({passed:false,issues:[issue({code:'text_scene_conflict',beatIndex:2,pageNo:2,evidence:source.pagination.pages[1].scene.action})]},source).valid,true);
  const legacy=clone(source.pagination);for(const page of legacy.pages){page.ko=page.textKo;page.en=page.textEn;delete page.textKo;delete page.textEn;}
  assert.equal(validateCoherenceReview({passed:false,issues:[issue()]},{outline:source.outline,pagination:legacy}).valid,true);
});

test('evidence cannot target a different page, beat or narration language for repair',()=>{
  const source=fixture();
  const elsewhere=issue({beatIndex:2,pageNo:2,evidence:source.pagination.pages[0].textKo});
  assert.equal(validateCoherenceReview({passed:false,issues:[elsewhere]},source).valid,false);
  const wrongLanguage=issue({language:'en',evidence:source.pagination.pages[0].textKo});
  assert.equal(validateCoherenceReview({passed:false,issues:[wrongLanguage]},source).valid,false);
  const wrongBeat=issue({beatIndex:2,pageNo:null,evidence:source.prose.ko.split('\n\n')[0]});
  assert.equal(validateCoherenceReview({passed:false,issues:[wrongBeat]},source).valid,false);
  const wrongProseLanguage=issue({pageNo:null,language:'en',evidence:source.prose.ko.split('\n\n')[0]});
  assert.equal(validateCoherenceReview({passed:false,issues:[wrongProseLanguage]},source).valid,false);
  const sceneAsProse=issue({pageNo:2,beatIndex:2,evidence:source.pagination.pages[1].scene.action,language:'both'});
  assert.equal(validateCoherenceReview({passed:false,issues:[sceneAsProse]},source).valid,false);
  assert.equal(validateCoherenceReview({passed:false,issues:[{...sceneAsProse,code:'text_scene_conflict'}]},source).valid,true);
});

test('malformed saved context structures fail safely without throwing or trusting stale snapshots',()=>{
  const source=fixture();
  for(const pagination of [{pages:null},{pages:{}},{pages:[null,0,'bad']}]){
    assert.doesNotThrow(()=>coherenceFingerprint({...source,pagination}));
    assert.doesNotThrow(()=>validateCoherenceReview({passed:false,issues:[issue()]},{outline:source.outline,pagination}));
    assert.equal(isCoherenceCurrent(report(source),{...source,pagination}),false);
    assert.doesNotThrow(()=>attachPagePlotContext(pagination,source.outline));
  }
  assert.equal(plotContextForPage({plotContract:{beats:{}}},{beatIndex:1}),null);
  assert.equal(plotContextForPage(source.outline,null),null);
  assert.equal(validateCoherenceReview({passed:false,issues:[null]},source).valid,false);
});

test('a saved review is invalidated by edits to goal, events, states, prose, scenes or pagination',()=>{
  const source=fixture(),saved=report(source);
  assert.equal(isCoherenceCurrent(saved,source),true);
  const mutations=[
    next=>next.outline.want='유하가 꽃 대신 공을 찾아요.',
    next=>next.outline.beats[1].summary='새 친구가 마법으로 꽃을 살려요.',
    next=>next.outline.plotContract.beats[0].stateAfter.props[0].ownerId=null,
    next=>next.prose.en+=' A wizard solves everything.',
    next=>next.pagination.pages[1].textKo='유하가 새 호스를 꺼내요.',
    next=>next.pagination.pages[1].scene.action='A wizard waters the flower with a new hose.',
    next=>next.pagination.pages[1].beatIndex=1,
    next=>next.pagination.pages[1].variantByCharacter.yuha='new-coat'
  ];
  for(const mutate of mutations){const next=clone(source);mutate(next);assert.equal(isCoherenceCurrent(saved,next),false);}
  assert.equal(isCoherenceCurrent({...saved,stage:'prose'},source),false);
  assert.equal(isCoherenceCurrent({...saved,version:2},source),false);
  assert.equal(isCoherenceCurrent(report(source,'pages',{passed:false,issues:[issue()]}),source),false);
  assert.equal(isCoherenceCurrent({...saved,issues:[issue()]},source),false);
});

test('fingerprints are stable across key order and media changes; prose and page approvals have separate scopes',()=>{
  const source=fixture(),saved=report(source),reordered={pagination:source.pagination,prose:{usedRefrainAt:[],paragraphBeats:source.prose.paragraphBeats,en:source.prose.en,ko:source.prose.ko},outline:source.outline};
  assert.equal(coherenceFingerprint(source),coherenceFingerprint(reordered));
  const rendered=attachPagePlotContext(source.pagination,source.outline);rendered.pages[0].imageUrl='asset:generated-picture';rendered.pages[0].seed=1234;rendered.pages[0].meta={model:'picture-model'};
  assert.equal(isCoherenceCurrent(saved,{...source,pagination:rendered}),true);
  const proseReport=report(source,'prose');
  const pageChanged=clone(source);pageChanged.pagination.pages[0].scene.action='A changed drawing.';
  assert.equal(isCoherenceCurrent(proseReport,pageChanged),true);
  assert.equal(isCoherenceCurrent(proseReport,{...source,stage:'pages'}),false);
  assert.equal(isCoherenceCurrent(saved,{...source,stage:'prose'}),false);
  const proseChanged=clone(source);proseChanged.prose.ko+=' 다른 결말이에요.';
  assert.equal(isCoherenceCurrent(proseReport,proseChanged),false);
});

test('page plot context is an independent beat-scoped snapshot and never invents page-specific state',()=>{
  const source=fixture(),before=clone(source),context=plotContextForPage(source.outline,source.pagination.pages[1]);
  assert.equal(context.version,1);assert.equal(context.scope,'beat');assert.equal(context.beatIndex,2);assert.equal(context.causeBeatIndex,1);
  assert.equal(context.event.result,source.outline.plotContract.beats[1].result);assert.equal(context.goal,source.outline.plotContract.goal);assert.equal(context.resolutionCriterion,source.outline.plotContract.resolutionCriterion);
  assert.deepEqual(context.payoffIds,['water-flower']);assert.deepEqual(context.stateBefore,source.outline.plotContract.beats[1].stateBefore);
  assert.equal('pageState' in context,false);
  const attached=attachPagePlotContext(source.pagination,source.outline);
  assert.deepEqual(source,before);assert.deepEqual(attached.pages[1].plotContext,context);
  attached.pages[1].plotContext.stateBefore.props[0].condition='tampered';
  assert.deepEqual(source,before);
  const anotherPage={...source.pagination.pages[1],pageNo:3};
  assert.deepEqual(plotContextForPage(source.outline,anotherPage),context,'two pages in one beat share beat facts without pretending to have distinct page states');
});

test('legacy or unmatched pages receive no invented contract and stale derived context is removed',()=>{
  const source=fixture(),legacy=clone(source.outline);delete legacy.plotContract;
  assert.equal(plotContextForPage(legacy,source.pagination.pages[0]),null);
  assert.equal(plotContextForPage(source.outline,{beatIndex:99}),null);
  const pages=clone(source.pagination);pages.pages[0].plotContext={scope:'page',event:'old fabricated event'};
  const result=attachPagePlotContext(pages,legacy);
  assert.equal('plotContext' in result.pages[0],false);
  assert.equal(pages.pages[0].plotContext.event,'old fabricated event');
});
