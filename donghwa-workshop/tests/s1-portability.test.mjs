import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, preflightFullAuto} from '../dist/full-auto.js';
import {generateOutline} from '../dist/story-generation/pipeline.js';

/**
 * S1 (서버 오케스트레이션 준비, 2026-10-21): the text pipeline and FULL AUTO
 * take their API keys from an injected source (`credentials` /
 * `options.credentialFor`) and run with no browser globals, so a server
 * runner (Cloudflare Workers) can import the same modules. The browser keeps
 * reading the PIN vault; its requests are unchanged (R12/R13 pins).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };

test('S1 the text engine takes the injected key and never opens the PIN vault', async () => {
  const seen = [];
  const fetch = async (url, init) => { seen.push({url: String(url), headers: init.headers}); return new Response('{}', {status: 401}); };
  const input = {bookId: 's1', characters: [{id: 'yuha', name: '유하', traits: ['씩씩함']}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲'}, {id: 'pond', name: '연못'}], topic: '숲 소풍', pageCount: 12, language: 'ko', endingType: 'home_sleep', specs: {ko: {id: 'K2'}, en: {id: 'E2'}}};
  await assert.rejects(generateOutline(input, {engineId: 'anthropic', config: {model: 'claude-opus-5-5', fetch, retryDelaysMs: []}, credentialFor: async (id) => `server-key-for-${id}`}), /인증|HTTP 401|키/u);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers['x-api-key'], 'server-key-for-anthropic');
});

test('S1 the FULL AUTO preflight asks the injected source for every engine key', async () => {
  const state = setup();
  const job = createFullAutoJob(state, {characterIds: ['yuha'], backgroundIds: ['home', 'forest'], topic: '숲 소풍', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual'}, {stopBefore: 'text'});
  const asked = [];
  await preflightFullAuto(state, job, {credentials: async (id) => { asked.push(id); return 'k'; }});
  assert.ok(asked.length >= 1);
  await assert.rejects(preflightFullAuto(state, job, {credentials: async () => null}), /API 키/u);
});

test('S1 the text modules import with no browser globals at all (a Worker-like runtime)', () => {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const code = `for (const k of ['window','document','localStorage','sessionStorage','indexedDB','navigator']) { try { delete globalThis[k]; } catch {} }
  const mods = ['full-auto.js','story-generation/pipeline.js','story-generation/council.js','story-generation/quality-adapter.js','story-generation/orchestration.js','text-generation/providers.js','text-generation/models.js','transient-retry.js'];
  for (const m of mods) await import(${JSON.stringify(root)} + m);
  console.log('IMPORTED', mods.length);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /IMPORTED 8/);
});
