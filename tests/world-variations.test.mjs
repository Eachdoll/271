import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState,getCharacterSheet} from '../dist/image-generation/world.js';
import {createWorldVariation,activateWorldVariation,syncActiveWorldTextSettings,renderWorldVariations} from '../dist/world-variations.js';

function library(){const state=seedState();migrateWorldState(state);const world=state.worlds[0];world.providerConfig={google:{proxyEndpoint:'https://example.test/proxy',googlePro:true},local:{endpoint:'http://127.0.0.1:8188',workflow:{prompt:{inputs:{steps:12}}}}};state.settings.textGeneration={engine:'google',providers:{local:{baseUrl:'http://127.0.0.1:1234/v1',model:'my-local-model'},google:{proxyEndpoint:'https://example.test/text'}},hybrid:{enabled:true,finalEngine:'google'}};return state;}

test('a variation persists separate engines and membership without rewriting source or books',()=>{
  const state=library(),source=state.worlds[0],books=JSON.stringify(state.books),sheets=JSON.stringify(state.characters),configs=JSON.stringify(source.providerConfig);
  const world=createWorldVariation(state,source.id,{name:'연필 세상',imageEngine:'openai',stylePresetId:'crayon',memo:'같은 집과 친구들',textGeneration:{engine:'anthropic',hybrid:{enabled:false}}});
  assert.notEqual(world.id,source.id);assert.equal(world.parentWorldId,source.id);assert.equal(world.revision,1);assert.equal(world.textGeneration.engine,'anthropic');assert.equal(world.textGeneration.hybrid.enabled,false);
  assert.deepEqual(world.characterIds,source.characterIds);assert.deepEqual(world.backgroundIds,state.backgrounds.map(b=>b.id));assert.equal(world.characterSheetsStale,true);assert.equal(world.backgroundSheetsStale,true);
  assert.equal(getCharacterSheet(state,world.characterIds[0],world),null);assert.equal(source.imageEngine,'sample');assert.equal(source.stylePresetId,'watercolor');
  assert.equal(JSON.stringify(state.books),books);assert.equal(JSON.stringify(state.characters),sheets);assert.equal(JSON.stringify(source.providerConfig),configs);
  world.providerConfig.local.workflow.prompt.inputs.steps=24;assert.equal(source.providerConfig.local.workflow.prompt.inputs.steps,12);
});

test('switching stores outgoing text settings and restores each World after serialized reload',()=>{
  const state=library(),source=state.worlds[0];const next=createWorldVariation(state,source.id,{name:'다음 세계',imageEngine:'local',stylePresetId:'crayon',textGeneration:{engine:'local',hybrid:{enabled:false}}});
  activateWorldVariation(state,next.id);assert.equal(state.settings.textGeneration.engine,'local');assert.equal(state.settings.stylePresetId,'crayon');assert.equal(state.settings.imageEngine,'local');assert.equal(state.settings.textGeneration.providers.local.model,'my-local-model');
  state.settings.textGeneration.providers.local.model='second-model';activateWorldVariation(state,source.id);
  assert.equal(state.settings.textGeneration.engine,'google');assert.equal(state.settings.textGeneration.hybrid.finalEngine,'google');assert.equal(next.textGeneration.providers.local.model,'second-model');
  const reloaded=JSON.parse(JSON.stringify(state));activateWorldVariation(reloaded,next.id);syncActiveWorldTextSettings(reloaded,{load:true});assert.equal(reloaded.settings.textGeneration.engine,'local');assert.equal(reloaded.settings.textGeneration.providers.local.model,'second-model');
});

test('World configuration never copies plaintext secrets or authentication-bearing URLs',()=>{
  const state=library(),source=state.worlds[0];source.providerConfig.google.apiKey='test-secret';source.providerConfig.google.authorization='test-auth';source.providerConfig.local.workflow.secret='workflow-secret';source.providerConfig.openai={proxyEndpoint:'https://user:password@example.test/path?key=private',token:'test-token'};
  state.settings.textGeneration.providers.google={apiKey:'text-secret',proxyEndpoint:'https://example.test/text?access_token=private'};
  const world=createWorldVariation(state,source.id,{name:'키 없는 복사'}),serialized=JSON.stringify(world);
  for(const secret of ['test-secret','test-auth','workflow-secret','test-token','text-secret','access_token','user:password'])assert.equal(serialized.includes(secret),false,secret);
  assert.equal(world.providerConfig.google.googlePro,true);assert.equal(world.providerConfig.google.proxyEndpoint,'https://example.test/proxy');assert.equal(world.providerConfig.openai.proxyEndpoint,undefined);assert.equal(world.textGeneration.providers.google.proxyEndpoint,undefined);
});

test('rejected variation and missing switch leave all state untouched',()=>{
  for(const patch of [{name:''},{imageEngine:'missing'},{stylePresetId:'missing'},{textGeneration:{engine:'missing'}},{memo:'a'.repeat(2001)}]){const state=library(),before=JSON.stringify(state);assert.throws(()=>createWorldVariation(state,state.activeWorldId,patch));assert.equal(JSON.stringify(state),before);}
  const state=library(),before=JSON.stringify(state);assert.throws(()=>activateWorldVariation(state,'missing'));assert.equal(JSON.stringify(state),before);
});

test('same-style variants retain authoritative style references but no old cast approval',()=>{
  const state=library(),source=state.worlds[0];source.styleSheetImageIds=['image-style-1'];state.stylePresetSelections={[source.id]:{watercolor:['image-style-1']}};
  const world=createWorldVariation(state,source.id,{name:'두 번째 수채화',imageEngine:'google'});assert.deepEqual(world.styleSheetImageIds,['image-style-1']);assert.deepEqual(state.stylePresetSelections[world.id],{watercolor:['image-style-1']});
  world.styleSheetImageIds.push('image-style-2');assert.deepEqual(source.styleSheetImageIds,['image-style-1']);assert.equal(getCharacterSheet(state,world.characterIds[0],world),null);
});

test('World cards escape user text and offer switching without changing main form selectors',()=>{
  const state=library();createWorldVariation(state,state.activeWorldId,{name:'<새 세계>',memo:'<script>bad</script>'});const html=renderWorldVariations(state);assert.match(html,/&lt;새 세계&gt;/);assert.match(html,/data-world-variation="activate"/);assert.match(html,/시트 다시 생성 필요/);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/data-action="save-settings"/);
});


test('selected premium models survive World copy, switching and serialized reload',()=>{
 const state=library();state.settings.textGeneration.providers.google.model='gemini-4-argon';const source=state.worlds[0];const copy=createWorldVariation(state,source.id,{name:'상위 모델 세상'});activateWorldVariation(state,copy.id);assert.equal(state.settings.textGeneration.providers.google.model,'gemini-4-argon');state.settings.textGeneration.engine='openai';state.settings.textGeneration.providers.openai.model='gpt-6-astra';activateWorldVariation(state,source.id);const loaded=JSON.parse(JSON.stringify(state));activateWorldVariation(loaded,copy.id);assert.equal(loaded.settings.textGeneration.providers.openai.model,'gpt-6-astra');assert.equal(loaded.settings.textGeneration.providers.google.model,'gemini-4-argon');
});
