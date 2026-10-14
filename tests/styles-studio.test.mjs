import test from 'node:test';
import assert from 'node:assert/strict';
import {STYLE_PRESETS,getStylePreset,validateStylePreset,setCustomStylePresets,listStylePresets,forbiddenStyleMatches,DEFAULT_FORBIDDEN_STYLE_WORDS} from '../dist/image-generation/styles.js';
import {STYLE_TEST_SCENES,createCustomStylePreset,commitStyleSheetSelection} from '../dist/style-studio.js';

const state=()=>({activeWorldId:'w',worlds:[{id:'w',revision:3,imageEngine:'google',stylePresetId:'watercolor',stylePresetVersion:2,characterIds:['child']}],characters:[{id:'child',characterSheets:[{worldId:'w',confirmedAt:'2026-10-15'}]}],books:[{id:'old',generationSnapshot:{worldRevision:3,stylePreset:{id:'watercolor',styleRefImages:['/assets/hero.png']}}}],settings:{}});
const candidate=(id,presetId='watercolor',source='app-style-generation')=>({imageAssetId:id,imageUrl:'data:image/png;base64,AA==',meta:{source,generatedByApp:true,worldId:'w',worldRevision:3,stylePresetId:presetId}});

test('four new builtins validate, retain real watercolor cover authority and legacy lookups',()=>{
  assert.deepEqual(STYLE_PRESETS.map(p=>p.id),['watercolor','crayon','theatrical','animated3d']);
  for(const preset of STYLE_PRESETS)assert.deepEqual(validateStylePreset(preset).errors,[]);
  assert.deepEqual(getStylePreset('watercolor').styleRefImages,['/assets/hero.png']);
  assert.match(getStylePreset('watercolor').negativePrompt,/flat vector/);
  assert.equal(getStylePreset('flat').id,'flat');assert.equal(getStylePreset('cartoon').id,'comic');
  assert.match(getStylePreset('theatrical').stylePrompt,/1980s-90s Japanese theatrical animation/);
  assert.match(getStylePreset('animated3d').stylePrompt,/smooth global illumination/);
});

test('free custom labels and visual descriptions are allowed with no generated refs yet',()=>{
  const preset=createCustomStylePreset({name:'Z스타일 · 우리집',stylePrompt:'soft graphite pencil, warm paper grain, quiet light and expressive rounded faces'});
  assert.equal(preset.isBuiltIn,false);assert.deepEqual(preset.styleRefImageIds,[]);
  assert.equal(validateStylePreset(preset).valid,true);
});

test('all named prohibitions are case-insensitive and added parent words are enforced',()=>{
  for(const name of DEFAULT_FORBIDDEN_STYLE_WORDS){const preset=createCustomStylePreset({name:'허용 이름',stylePrompt:'soft pencil illustration'});preset.stylePrompt+=` ${name.toUpperCase()}`;const result=validateStylePreset(preset);assert.equal(result.valid,false,name);assert.ok(result.errors.some(error=>error.includes('금칙어')));}
  assert.throws(()=>createCustomStylePreset({name:'달빛',stylePrompt:'soft mooncat drawing'},{settings:{forbiddenStyleWords:['MoonCat']}}),/mooncat/i);
  assert.deepEqual(forbiddenStyleMatches('soft WATERcolor'),[]);
});

test('specific artist imitation syntax is rejected with a reason',()=>{
  assert.throws(()=>createCustomStylePreset({name:'연필',stylePrompt:'in the style of Somebody, pencil illustration'}),/작가/);
});

test('custom registry stays separate from builtins and supports library replacement',()=>{
  const preset=createCustomStylePreset({name:'달빛 연필',stylePrompt:'soft pencil on paper'});
  const library={settings:{},stylePresets:[preset]};setCustomStylePresets(library);
  assert.equal(listStylePresets().length,5);assert.equal(getStylePreset(preset.id).name,'달빛 연필');
  setCustomStylePresets({});assert.equal(listStylePresets().length,4);
});

test('fixed scene set contains only the three specified places',()=>{
  assert.deepEqual(STYLE_TEST_SCENES.map(scene=>scene.id),['yard','forest','bedtime']);
  assert.match(STYLE_TEST_SCENES[0].prompt,/front yard/);assert.match(STYLE_TEST_SCENES[1].prompt,/woodland path/);assert.match(STYLE_TEST_SCENES[2].prompt,/bed reading/);
});

test('parent selection persists generated assets and invalidates sheets without altering old books',()=>{
  const library=state(),before=JSON.stringify(library.books),candidates=[candidate('image-test-one'),candidate('image-test-two'),candidate('image-test-three')];
  const result=commitStyleSheetSelection(library,{worldId:'w',worldRevision:3,presetId:'watercolor',candidates,selectedIds:['image-test-one','image-test-two']});
  assert.equal(result.requiresRegeneration,true);assert.equal(library.worlds[0].revision,4);assert.equal(library.worlds[0].characterSheetsStale,true);
  assert.deepEqual(library.worlds[0].styleSheetImageIds,['image-test-one','image-test-two']);
  assert.equal(library.styleSheetImages.length,2);assert.equal(library.styleSheetImages[0].imageUrl,'asset:image-test-one');
  assert.equal(JSON.stringify(library.books),before);assert.equal(candidates[0].imageUrl,'data:image/png;base64,AA==');
});

test('selection refuses uploads, stale Worlds, zero or three sheets before mutation',()=>{
  for(const args of [{selectedIds:[]},{selectedIds:['image-test-one','image-test-two','image-test-three']},{worldRevision:2,selectedIds:['image-test-one']},{candidates:[candidate('image-test-one','watercolor','imported-illustration')],selectedIds:['image-test-one']}]){
    const library=state(),before=JSON.stringify(library);assert.throws(()=>commitStyleSheetSelection(library,{worldId:'w',worldRevision:3,presetId:'watercolor',candidates:[candidate('image-test-one'),candidate('image-test-two'),candidate('image-test-three')],...args}));assert.equal(JSON.stringify(library),before);
  }
});

test('custom style sheet selection stores preset IDs without mutating builtin preset records',()=>{
  const library=state(),preset=createCustomStylePreset({name:'달빛 연필',stylePrompt:'soft pencil on paper'});library.stylePresets=[preset];const presetId=preset.id;
  const result=commitStyleSheetSelection(library,{worldId:'w',worldRevision:3,presetId,candidates:[candidate('image-custom-one',presetId)],selectedIds:['image-custom-one']});
  assert.equal(result.world.stylePresetId,presetId);assert.deepEqual(preset.styleRefImageIds,['image-custom-one']);assert.deepEqual(STYLE_PRESETS[0].styleRefImageIds,[]);setCustomStylePresets({});
});
