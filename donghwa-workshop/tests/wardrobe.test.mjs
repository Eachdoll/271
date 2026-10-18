import test from 'node:test';
import assert from 'node:assert/strict';
import {
  translateWardrobeDescription, recommendWardrobe, availableCharacterVariants,
  validateWardrobeSelections, copyWardrobeSelections, createVariantGenerationRequest,
  renderBookVariantSelectors, renderWardrobeCardActions
} from '../dist/wardrobe.js';
import {
  migrateWorldState, getActiveWorld, markCharacterSheetConfirmed,
  captureBookGenerationSnapshot, sceneReferenceRecords
} from '../dist/image-generation/world.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
function fixture() {
  const state={settings:{},characters:[{id:'yuha',name:'유하',nameEn:'Yuha',kind:'child',version:1,approved:false,color:'#e7bb58',characterSheets:[],wardrobe:[]}],books:[],backgrounds:[{id:'home',name:'우리 집',imageUrl:png}]};
  migrateWorldState(state);
  const sheet=markCharacterSheetConfirmed(state,'yuha',{imageUrl:png,seed:42,meta:{requestedSeed:42,source:'provider'}});
  const world=getActiveWorld(state);
  state.characters[0].wardrobe=[{id:'pajamas',characterId:'yuha',name:'잠옷',description:'soft comfortable pajamas',type:'outfit',refImageIds:['image-variant-front','image-variant-full'],sourceSheetId:sheet.id,worldId:world.id,worldRevision:world.revision,createdAt:'2026-10-15T00:00:00Z'}];
  return {state,sheet,world};
}

test('local translations preserve exact known clothes and do not pretend unknown Korean is translated',()=>{
  assert.equal(translateWardrobeDescription('잠옷'),'soft comfortable pajamas');
  assert.equal(translateWardrobeDescription('노란 우비와 장화'),'a yellow raincoat and yellow rain boots');
  assert.equal(translateWardrobeDescription('a purple T-shirt'),'a purple T-shirt');
  assert.equal(translateWardrobeDescription('알 수 없는 특별한 옷','a dotted linen jacket'),'a dotted linen jacket');
  assert.throws(()=>translateWardrobeDescription('오로라처럼 반짝이는 날개가 달린 옷'),/번역 사전/);
  assert.throws(()=>translateWardrobeDescription('잠옷','영어가 아님'),/영어/);
});

test('topic suggestions require no provider call and cover scene-specific wardrobe choices',()=>{
  assert.deepEqual(recommendWardrobe('겨울 눈 오는 밤').map(item=>item.id),['pajamas','winter']);
  assert.ok(recommendWardrobe('수영장과 바다').some(item=>item.id==='swimsuit'));
  assert.ok(recommendWardrobe('비 오는 날').some(item=>item.id==='raincoat'));
  assert.ok(recommendWardrobe('추석 명절').some(item=>item.id==='hanbok'));
});

test('wardrobe selections reject foreign, stale, overlapping and out-of-book ranges',()=>{
  const {state,sheet}=fixture();
  const wizard={characterIds:['yuha'],pageCount:12,characterVariants:{yuha:'pajamas'},variantPageRanges:{yuha:[{from:1,to:4,variantId:'pajamas'}]}};
  assert.equal(validateWardrobeSelections(state,wizard).characterVariants.yuha,'pajamas');
  assert.throws(()=>validateWardrobeSelections(state,{...wizard,characterVariants:{yuha:'someone-else'}}),/맞지/);
  assert.throws(()=>validateWardrobeSelections(state,{...wizard,variantPageRanges:{yuha:[{from:1,to:4,variantId:'pajamas'},{from:4,to:5,variantId:null}]}}),/겹쳐/);
  assert.throws(()=>validateWardrobeSelections(state,{...wizard,variantPageRanges:{yuha:[{from:10,to:13,variantId:null}]}}),/1~12/);
  state.characters[0].wardrobe[0].sourceSheetId=sheet.id+'-old';
  assert.deepEqual(availableCharacterVariants(state,state.characters[0]),[]);
  assert.throws(()=>validateWardrobeSelections(state,wizard),/맞지/);
});

test('book defaults and page-specific overrides are copied rather than shared',()=>{
  const {state}=fixture(),wizard={characterIds:['yuha'],pageCount:12,characterVariants:{yuha:null},variantPageRanges:{yuha:[{from:1,to:4,variantId:'pajamas'}]}},book={};
  copyWardrobeSelections(wizard,book,state);
  wizard.variantPageRanges.yuha[0].to=9;
  assert.equal(book.variantPageRanges.yuha[0].to,4);
});

test('approved book freezes original identity and variants even after live wardrobe deletion',()=>{
  const {state,sheet}=fixture();
  const book={characterIds:['yuha'],backgroundIds:['home'],pageCount:12,pages:Array.from({length:12},()=>({ko:'함께 걸어요.'})),characterVariants:{yuha:null},variantPageRanges:{yuha:[{from:1,to:4,variantId:'pajamas'}]}};
  const snapshot=captureBookGenerationSnapshot(state,book);
  assert.equal(snapshot.variants[0].sourceSheetId,sheet.id);
  state.characters[0].wardrobe[0].description='a spacesuit';
  state.characters[0].wardrobe[0].refImageIds[0]='image-replacement';
  state.characters[0].wardrobe[0].archivedAt='2026-10-16';
  state.characters[0].characterSheets.length=0;
  assert.equal(captureBookGenerationSnapshot(state,book),snapshot);
  assert.equal(snapshot.variants[0].description,'soft comfortable pajamas');
  assert.equal(snapshot.variants[0].refImageIds[0],'image-variant-front');
  assert.equal(snapshot.characterSheets[0].id,sheet.id);
});

test('only pages 1–4 send wardrobe references and original face remains first',()=>{
  const {state,sheet}=fixture();
  const book={characterIds:['yuha'],backgroundIds:['home'],pageCount:12,pages:Array.from({length:12},()=>({})),characterVariants:{yuha:null},variantPageRanges:{yuha:[{from:1,to:4,variantId:'pajamas'}]}};
  const snapshot=captureBookGenerationSnapshot(state,book);
  const first=sceneReferenceRecords(snapshot,0),fourth=sceneReferenceRecords(snapshot,3),fifth=sceneReferenceRecords(snapshot,4);
  assert.deepEqual(first.map(ref=>ref.role),['character_front','character_variant','character_variant','style_sheet','background']);
  assert.equal(first[0].imageUrl,sheet.imageUrl);
  assert.equal(first[1].imageUrl,'asset:image-variant-front');
  assert.equal(first[2].imageUrl,'asset:image-variant-full');
  assert.ok(first[3].imageUrl.endsWith('/assets/hero.png'));
  assert.deepEqual(fourth.map(ref=>ref.role),first.map(ref=>ref.role));
  assert.deepEqual(fifth.map(ref=>ref.role),['character_front','character_full','style_sheet','background']);
  assert.equal(fifth[1].imageUrl,sheet.imageUrl);
});

test('an explicit default-look range overrides a whole-book variant without losing base identity',()=>{
  const {state,sheet}=fixture();
  const book={characterIds:['yuha'],pageCount:12,pages:Array.from({length:12},()=>({})),characterVariants:{yuha:'pajamas'},variantPageRanges:{yuha:[{from:5,to:12,variantId:null}]}};
  const snapshot=captureBookGenerationSnapshot(state,book);
  assert.equal(sceneReferenceRecords(snapshot,0)[1].role,'character_variant');
  assert.equal(sceneReferenceRecords(snapshot,4)[1].role,'character_full');
  assert.equal(sceneReferenceRecords(snapshot,4)[0].imageUrl,sheet.imageUrl);
});

test('new variants generate two views from the same original face and style and never change the base sheet',()=>{
  const {state,sheet}=fixture(),before=JSON.stringify(sheet),variant=state.characters[0].wardrobe[0];
  const front=createVariantGenerationRequest(state,'yuha',variant,'front',123);
  const full=createVariantGenerationRequest(state,'yuha',variant,'full',124);
  assert.match(front.prompt,/head-and-shoulders portrait/);
  assert.match(full.prompt,/full-body view/);
  assert.match(front.prompt,/Identical face/);
  assert.equal(front.referenceImages[0].imageUrl,sheet.imageUrl);
  assert.equal(front.referenceImages[0].role,'character_front');
  assert.equal(front.referenceImages[1].role,'style_sheet');
  assert.deepEqual(front.referenceImages,full.referenceImages);
  assert.equal(front.seed,123);assert.equal(full.seed,124);
  assert.equal(JSON.stringify(sheet),before);
});

test('rendered selectors retain chosen defaults and escape material names',()=>{
  const {state}=fixture();state.characters[0].name='<script>child</script>';
  const html=renderBookVariantSelectors(state,{characterIds:['yuha'],characterVariants:{yuha:'pajamas'}});
  assert.ok(html.includes('value="pajamas" selected'));
  assert.ok(!html.includes('<script>'));
  assert.match(renderWardrobeCardActions(state.characters[0]),/옷장 1벌/);
});

test('the wardrobe pre-check reads parent text like a scene request does: strict, no cast-name exemption', ()=>{
  const {state}=fixture(),variant=state.characters[0].wardrobe[0];
  state.characters.push({id:'toto',name:'토토',nameEn:'Toto',kind:'animal',version:1,characterSheets:[],wardrobe:[]});
  const request=description=>createVariantGenerationRequest(state,'yuha',{...variant,description},'front',7);
  // A colour named after ice and a gift from another character, written without the film's name, are ordinary wardrobe text.
  for (const description of ['frozen-lake blue scarf','a coat the colour of a frozen pond','토토에게서 받은 목도리','유하는 토토에게서 받은 목도리'])
    assert.doesNotThrow(()=>request(description),description);
  // The title with a cue, a brand and the film's name are refused before any request, also after a cast name.
  for (const description of ['Frozen style dress','a dress like Frozen','a blue Frozen dress','Disney princess gown','토토로봇 무늬 잠옷','엘사처럼 파란 드레스','토토로부터 받은 목도리','겨울 왕국 드레스'])
    assert.throws(()=>request(description),/옷장 설명/,description);
  assert.throws(()=>createVariantGenerationRequest(state,'yuha',{...variant,name:'Frozen 2 outfit'},'front',7),/옷장 설명/);
  // The refusal says what to change: "토토로부터" (토토 + 로부터) becomes "토토에게서".
  assert.throws(()=>request('토토로부터 받은 목도리'),/‘토토에게서’/);
  // The parent's extra words count in the pre-check too.
  state.settings.forbiddenStyleWords=['MoonCat'];
  assert.throws(()=>request('mooncat pattern pajamas'),/추가한 금칙어/);
  state.settings.forbiddenStyleWords=[];
  // The request declares the same strict parts, so the provider checks exactly what was pre-checked.
  const ok=request('frozen-lake blue scarf');
  assert.deepEqual(ok.forbiddenWordCheck.text,['잠옷','frozen-lake blue scarf']);
  assert.deepEqual(ok.forbiddenWordCheck.generated,[]);
  assert.deepEqual(ok.forbiddenWordCheck.names,['유하','Yuha','토토','Toto']);
});
