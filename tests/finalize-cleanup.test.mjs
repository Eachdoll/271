import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeBookRecords,cleanupOldWorkRecords,estimateLibraryStorage} from '../dist/finalize-cleanup.js';
test('A-5 finalized books keep a small revision header and preserve auto usage while dropping duplicates',()=>{
 const book={id:'b',storyDraftId:'d',fullAutoRunId:'a'},draft={id:'d',input:{topic:'바람'},wizard:{step:4},usage:{calls:[1]},pictureBook:{pages:Array(12).fill({})},prose:{ko:'긴 글'},pagination:{pages:[]},snapshots:[{}],sceneBriefs:[{}],pageCoherence:{}};
 const state={books:[book],storyDrafts:{d:draft},fullAutoJobs:{a:{status:'review',usage:{calls:8},costs:{usd:1}}}};
 finalizeBookRecords(state,book);
 assert.deepEqual(Object.keys(state.storyDrafts.d).sort(),['id','bookId','stage','input','wizard','usage','updatedAt'].sort());
 assert.deepEqual(state.storyDrafts.d.input,{topic:'바람'});assert.deepEqual(state.storyDrafts.d.wizard,{step:4});assert.equal(state.fullAutoJobs.a,undefined);assert.deepEqual(book.fullAutoUsage,{calls:8});assert.equal(cleanupOldWorkRecords(state),0);
 assert.equal(estimateLibraryStorage({getItem:()=> '한글'},'x'),4);
});
test('A-5 cleanup never discards an unfinished book or its resumable work',()=>{
 const book={id:'unfinished',approved:false,stage:'paged',storyDraftId:'draft',fullAutoRunId:'auto'},state={books:[book],storyDrafts:{draft:{pictureBook:{pages:[{}]},prose:{ko:'이어서 쓸 글'}}},fullAutoJobs:{auto:{status:'paused',book}}};const before=structuredClone(state);
 assert.equal(cleanupOldWorkRecords(state),0);assert.deepEqual(state,before);
});
