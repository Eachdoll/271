import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, deleteFullAutoJob} from '../dist/full-auto.js';
import {renderFullAutoJobs} from '../dist/full-auto-ui.js';

/** 2026-10-20: "만들던 이야기 삭제할 수 있는 기능도 필요해, 더 이상 이어가고 싶지 않은데 떠 있어." */
function setup() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '달에 놀러 간 날', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual', simpleFlow: true};
  return {state, wizard};
}

test('a stopped or failed story can be deleted with its working draft; the drawers and books stay', () => {
  const {state, wizard} = setup();
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  Object.assign(job, {status: 'failed', error: '줄거리 결과를 확인해 주세요'});
  state.storyDrafts = {[job.storyDraftId]: {id: job.storyDraftId, stage: 'outline', fullAutoRunId: job.id}};
  const books = state.books.length, characters = state.characters.length, backgrounds = state.backgrounds.length;
  const html = renderFullAutoJobs(state, {simple: true});
  assert.match(html, new RegExp(`data-full-auto-action="delete" data-id="${job.id}"[^>]*>지우기<`));
  const removed = deleteFullAutoJob(state, job.id);
  assert.deepEqual(removed, {jobId: job.id, title: '달에 놀러 간 날', draftRemoved: true, keptSavedBook: false});
  assert.equal(state.fullAutoJobs[job.id], undefined);
  assert.equal(state.storyDrafts[job.storyDraftId], undefined);
  assert.equal(renderFullAutoJobs(state, {simple: true}), '', 'the card is gone');
  assert.deepEqual([state.books.length, state.characters.length, state.backgrounds.length], [books, characters, backgrounds]);
});

test('a running story offers 중지, not 지우기, and cannot be deleted; a saved book keeps its draft', () => {
  const {state, wizard} = setup();
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  job.status = 'running';
  const html = renderFullAutoJobs(state, {simple: true});
  assert.doesNotMatch(html, /data-full-auto-action="delete"/);
  assert.match(html, /data-full-auto-action="pause"/);
  assert.throws(() => deleteFullAutoJob(state, job.id), /먼저 중지한 뒤/);
  assert.ok(state.fullAutoJobs[job.id]);
  job.status = 'paused';
  state.storyDrafts = {[job.storyDraftId]: {id: job.storyDraftId, stage: 'paged', fullAutoRunId: job.id}};
  state.books.push({id: 'saved-book', title: '저장한 책', storyDraftId: job.storyDraftId, pages: []});
  const removed = deleteFullAutoJob(state, job.id);
  assert.equal(removed.keptSavedBook, true);
  assert.equal(removed.draftRemoved, false);
  assert.ok(state.storyDrafts[job.storyDraftId], 'the saved book still points at its draft');
  assert.ok(state.books.some(book => book.id === 'saved-book'));
  assert.throws(() => deleteFullAutoJob(state, job.id), /찾지 못했어요/);
});

test('the pro list offers 지우기 for a paused job too', () => {
  const {state, wizard} = setup();
  const job = createFullAutoJob(state, {...wizard, simpleFlow: false}, {stopBefore: 'text', planMode: 'selection'});
  job.status = 'paused';
  assert.match(renderFullAutoJobs(state), new RegExp(`data-full-auto-action="delete" data-id="${job.id}"`));
});
