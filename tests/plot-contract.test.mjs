import test from 'node:test';
import assert from 'node:assert/strict';
import {demoOutline} from '../dist/story-generation/demo.js';
import {PLOT_CONTRACT_SCHEMA,STORY_STRUCTURE_PRESETS,resolveStructurePreset,plotContractRules,inspectPlotContract,plotContractForBeat,demoPlotContract} from '../dist/story-generation/plot-contract.js';

const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const input={topic:'바람 소리를 찾는 모험',pageCount:12,endingType:'home_sleep',characters:[{id:'yuha',name:'유하'},{id:'green',name:'그린이'}],backgrounds:[{id:'home',name:'집'},{id:'garden',name:'정원'},{id:'pond',name:'연못'}]};
  const outline=demoOutline(input),locations=['home','garden','garden','pond','pond','garden','home'];
  outline.beats.forEach((beat,i)=>{beat.settingKey=locations[i];outline.settings[i]={beatIndex:beat.index,backgroundId:locations[i]};});
  const contract=demoPlotContract(outline,input);
  for(const beat of contract.beats){
    for(const [key,locationId]of [['stateBefore',beat.stateBefore.characters[0].locationId],['stateAfter',beat.stateAfter.characters[0].locationId]])beat[key].props=[{id:'lunch-box',name:'도시락 통',ownerId:'yuha',locationId,condition:'뚜껑이 열린 빈 통'}];
  }
  outline.plotContract=contract;
  return {input,outline,contract};
}
const codes=result=>new Set(result.issues.map(row=>row.code));

test('contract schema is bounded and strict at every nested object, including nullable branches',()=>{
  const visit=schema=>{
    if(schema.type==='object'){assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,Object.keys(schema.properties));Object.values(schema.properties).forEach(visit);}
    if(schema.type==='array'){assert.ok(Number.isInteger(schema.maxItems));visit(schema.items);}
    if(schema.anyOf)schema.anyOf.forEach(visit);
    if(schema.type==='string')assert.ok(schema.maxLength<=500);
  };
  visit(PLOT_CONTRACT_SCHEMA);assert.equal(PLOT_CONTRACT_SCHEMA.properties.beats.maxItems,8);
});

test('structure presets select original principles by explicit ID or topic without copying a book plot',()=>{
  assert.deepEqual(STORY_STRUCTURE_PRESETS.map(row=>row.id),['auto','attempt_chain','discovery','relationship']);
  assert.equal(resolveStructurePreset('attempt_chain','친구와 화해').id,'attempt_chain');
  assert.equal(resolveStructurePreset('auto','친구에게 양보하기').id,'relationship');
  assert.equal(resolveStructurePreset('auto','바람 소리를 찾아요').id,'discovery');
  assert.equal(resolveStructurePreset('unknown','튼튼한 다리를 만들어요').id,'attempt_chain');
  assert.equal(resolveStructurePreset('auto','Discover a hidden sound').id,'discovery');
  const rules=plotContractRules({storyStructurePresetId:'relationship',topic:'돌 찾기'});
  assert.match(rules,/selected original structure preset is relationship/);assert.match(rules,/pages 1-2/);assert.match(rules,/pages 3-7/);assert.match(rules,/pages 8-10/);assert.match(rules,/pages 11-12/);assert.match(rules,/NOT a request for 12 beats/);assert.match(rules,/previous stateAfter/);assert.match(rules,/stateAfter is the beat endpoint/);assert.doesNotMatch(rules,/도시락|노래하는 돌|아기 돼지|애벌레|singing stone/);
});

test('a causal contract is valid and helper returns its exact scoped beat without mutation',()=>{
  const {input,outline,contract}=fixture(),before=clone(contract),result=inspectPlotContract(contract,outline,input);
  assert.equal(result.valid,true,result.errors.join('\n'));assert.deepEqual(result.issues,[]);assert.deepEqual(contract,before);
  assert.equal(plotContractForBeat(outline,3),contract.beats[2]);assert.equal(plotContractForBeat(outline,'3'),contract.beats[2]);assert.equal(plotContractForBeat({},3),null);
});

test('state continuity compares unordered character, knowledge and promise arrays',()=>{
  const {input,outline,contract}=fixture();
  for(const beat of contract.beats)for(const state of [beat.stateBefore,beat.stateAfter])for(const row of state.characters)row.knows=['바람이 불면 잎이 움직여요.','통은 비어 있어요.'];
  for(const beat of contract.beats){beat.stateBefore.characters.reverse();for(const row of beat.stateBefore.characters)row.knows.reverse();}
  assert.equal(inspectPlotContract(contract,outline,input).valid,true);
});

test('causal numbering, teleports, missing offscene characters and unknown identities fail clearly',()=>{
  const {input,outline,contract}=fixture();
  contract.beats[2].becauseOfBeatIndex=1;
  contract.beats[2].stateBefore.characters[0].locationId='pond';
  contract.beats[3].stateAfter.characters.pop();
  contract.beats[4].stateAfter.characters[0].characterId='invented-helper';
  contract.beats[4].stateAfter.props[0].ownerId='invented-helper';
  contract.beats[5].stateAfter.props[0].locationId='unselected-castle';
  const result=inspectPlotContract(contract,outline,input),found=codes(result);
  assert.equal(result.valid,false);for(const code of ['causal_link','state_discontinuity','missing_character','unknown_character','unknown_owner','unknown_location'])assert.ok(found.has(code),code);
  assert.ok(result.issues.some(row=>row.beatIndex===3&&row.code==='causal_link'));assert.ok(result.errors.every(message=>typeof message==='string'&&message.length));
});

test('prop identity, names and persistence survive ownership, condition and location changes',()=>{
  const {input,outline,contract}=fixture();
  let updated=false;for(const beat of contract.beats){if(updated)beat.stateBefore.props[0].ownerId='green';if(beat.beatIndex>=4){updated=true;beat.stateAfter.props[0].ownerId='green';}}
  assert.equal(inspectPlotContract(contract,outline,input).valid,true);
  contract.beats[4].stateAfter.props=[];
  let found=codes(inspectPlotContract(contract,outline,input));assert.ok(found.has('prop_disappeared'));
  contract.beats[4].stateAfter.props=clone(contract.beats[4].stateBefore.props);contract.beats[4].stateAfter.props[0].name='새 마법 통';
  found=codes(inspectPlotContract(contract,outline,input));assert.ok(found.has('prop_renamed'));
  contract.beats[4].stateAfter.props[0].name='도시락 통';contract.beats[4].stateAfter.props[0].id='replacement-box';
  found=codes(inspectPlotContract(contract,outline,input));assert.ok(found.has('prop_reidentified'));
});

test('duplicate character/prop IDs, ambiguous prop names and forgotten knowledge are rejected',()=>{
  const {input,outline,contract}=fixture();
  const beat=contract.beats[2];beat.stateAfter.characters.push(clone(beat.stateAfter.characters[0]));beat.stateAfter.props.push(clone(beat.stateAfter.props[0]));
  beat.stateBefore.characters[0].knows=['앞서 발견한 단서'];
  const found=codes(inspectPlotContract(contract,outline,input));for(const code of ['duplicate_character','duplicate_prop','duplicate_prop_name','knowledge_lost'])assert.ok(found.has(code),code);
});

test('payoffs require earlier setup, every setup closes and promise ledger matches transitions',()=>{
  const {input,outline,contract}=fixture();
  contract.beats[1].payoffIds=['goal-resolution'];
  contract.beats[3].setupIds=['forgotten-clue'];
  contract.beats[4].payoffIds=['unplanted-solution'];
  const found=codes(inspectPlotContract(contract,outline,input));for(const code of ['unprepared_payoff','unclosed_setup','promise_state'])assert.ok(found.has(code),code);
});

test('malformed nested fields return errors without throwing or silently accepting unknown keys',()=>{
  const {input,outline,contract}=fixture();
  assert.equal(inspectPlotContract(null,outline,input).valid,false);
  contract.beats[0].stateAfter.characters={};contract.beats[0].stateAfter.props=null;contract.beats[1].stateBefore.openPromises='not-a-list';contract.beats[1].extra='unapproved event';contract.version=2;
  const result=inspectPlotContract(contract,outline,input);assert.equal(result.valid,false);assert.ok(codes(result).has('unknown_field'));assert.ok(codes(result).has('invalid_field'));
});

test('explicit demo builds deterministic compatible ledgers for all supported lengths and legacy free places',()=>{
  for(const pageCount of [8,12,16,24])for(const hasBackgrounds of [true,false]){
    const {input}=fixture();input.pageCount=pageCount;if(!hasBackgrounds)input.backgrounds=[];
    const outline=demoOutline(input),contract=demoPlotContract(outline,input),result=inspectPlotContract(contract,outline,input);
    assert.equal(result.valid,true,`${pageCount}/${hasBackgrounds}: ${result.errors.join('\n')}`);assert.deepEqual(contract,demoPlotContract(outline,input));assert.ok(contract.beats.every(beat=>beat.stateAfter.props.length===0),'demo does not invent props');
  }
});

test('every malformed model state collection fails without a runtime TypeError',()=>{
  const malformed=[null,{},'unexpected',7,true,[null]];
  for(const value of malformed)for(const stateKey of ['stateBefore','stateAfter'])for(const field of ['characters','props','openPromises']){
    const {input,outline,contract}=fixture();contract.beats[2][stateKey][field]=value;
    assert.doesNotThrow(()=>{assert.equal(inspectPlotContract(contract,outline,input).valid,false);},`${stateKey}.${field}=${JSON.stringify(value)}`);
  }
  for(const value of malformed){const {input,outline,contract}=fixture();input.backgrounds=[];outline.settings=value;assert.doesNotThrow(()=>inspectPlotContract(contract,outline,input));assert.equal(plotContractForBeat({plotContract:{beats:value}},1),null);}
});
