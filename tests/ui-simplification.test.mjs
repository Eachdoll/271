import test from 'node:test';
import assert from 'node:assert/strict';
import {renderActionSwitch,renderCheckboxSwitch,storageStatusView} from '../dist/ui-controls.js';
import {applySimpleTextModel,getTextGenerationSettings} from '../dist/text-generation/settings-ui.js';
import {councilDecisionCosts} from '../dist/text-generation/models.js';
import {renderCouncilBudget,renderCouncilRoom,renderCouncilReviewForm} from '../dist/story-generation/council-room.js';

test('settings switches expose checked/disabled state and keep existing action and checkbox IDs',()=>{
 const button=renderActionSwitch({id:'a',label:'회의 후 부모 확인',description:'안내',action:'toggle-council-review',checked:true,disabled:true});
 assert.match(button,/role="switch" aria-checked="true" aria-labelledby="a-label" aria-describedby="a-help" data-simple-action="toggle-council-review" disabled/);
 const input=renderCheckboxSwitch({id:'full-auto-council-review',label:'<위험>',checked:false});
 assert.match(input,/type="checkbox" role="switch"/);assert.doesNotMatch(input,/ checked|<위험>/);assert.match(input,/&lt;위험&gt;/);
});
test('storage summaries never claim synced data for conflicts, disconnected devices or errors',()=>{
 assert.equal(storageStatusView({phase:'unavailable',connected:false,authenticated:false}).label,'이 기기에 보관');
 for(const phase of ['conflict','account-changed','choice'])assert.equal(storageStatusView({phase,connected:true}).state,'attention');
 assert.equal(storageStatusView({phase:'error',connected:true,authenticated:true}).state,'attention');
 assert.equal(storageStatusView({connected:true,dirty:true}).state,'pending');
 assert.equal(storageStatusView({connected:true,dirty:false,phase:'ready',updatedAt:'invalid'}).time,'');
 assert.equal(storageStatusView({connected:true,phase:'ready'},true).label,'자료 보호 중');
});
test('the council estimate separates saved usage from upcoming work instead of subtracting real spending',()=>{
 const job={input:{pageCount:12},textSettings:{engine:'openai'},usage:{calls:[{requests:1,costUsdEstimated:.02},{requests:1,costUsd:.03}]}};
 const before=councilDecisionCosts(job);assert.equal(before.usedUsd,.05);assert.equal(before.usedUnknown,false);assert.ok(before.continueUsd>0);
 job.usage.calls.push({requests:1,costUsd:10});const after=councilDecisionCosts(job);assert.equal(after.usedUsd,10.05);assert.equal(after.continueUsd,before.continueUsd);
 job.usage.calls.push({requests:1});assert.equal(councilDecisionCosts(job).usedUnknown,true);
});
test('unknown prices and demos are represented honestly without changing frozen settings',()=>{
 const source={engine:'openai'};applySimpleTextModel(source,'openai','unknown-model-test');const settings=getTextGenerationSettings({settings:{textGeneration:source}});settings.providers.openai.apiKey='secret-must-stay-private';
 const job={input:{pageCount:12},textSettings:settings,usage:{calls:[{requests:1}]}};
 const snapshot=JSON.stringify(job);const cost=councilDecisionCosts(job);assert.equal(cost.continueUnknown,true);assert.equal(JSON.stringify(job),snapshot);
 const html=renderCouncilBudget(job);assert.match(html,/요금 정보 없음/);assert.doesNotMatch(html,/secret-must-stay-private/);
 assert.deepEqual(councilDecisionCosts({...job,demo:true}),{usedUsd:0,usedUnknown:false,continueUsd:0,continueUnknown:false,meetingUsd:0,meetingUnknown:false});
});
test('a parked meeting presents one set of selectable ideas and preserves authored titles',()=>{
 const record={phase:'review',recommended:1,roles:{},pitches:[{title:'피치 맛 과일',logline:'과일을 찾아요.'},{title:'바이블이라는 이름의 새',logline:'새를 만나요.'}],scores:[]};
 const room=renderCouncilRoom(record),form=renderCouncilReviewForm(record);
 assert.doesNotMatch(room,/council-room-pitches/);assert.equal((form.match(/name="council-pick"/g)||[]).length,2);
 assert.match(form,/피치 맛 과일/);assert.match(form,/바이블이라는 이름의 새/);assert.match(room,/aria-current="step"/);
});
