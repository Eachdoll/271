// R64 experiment: draw page 1 first, then use it as the stage's CANONICAL first scene for later pages of the same
// stage. Uses the app's own request builders (sceneGenerationRequest, createCharacterSheetRequest) and generateImage.
// DRY=1 prints the requests without any network call. The key is read from the environment only (never written).
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const root = process.env.DONGHWA_APP_ROOT || new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const out = process.argv[2];
const DRY = process.env.DRY === '1';
const imp = (p) => import(pathToFileURL(root + '/dist/' + p));
const G = await imp('image-generation/world.js'), {seedState} = await imp('engine.js'), {migrateReadingSettings} = await imp('reading-ui.js');
const {inputFromWizard} = await imp('story-generation/ui.js'), {normalizeStoryInput} = await imp('story-generation/pipeline.js'), {getStylePreset} = await imp('image-generation/styles.js');
const W = await imp('story-generation/writers-room.js'), P = await imp('image-generation/providers.js');
const s = seedState(); G.migrateWorldState(s); migrateReadingSettings(s.settings);
const wizard = {characterIds: ['yuha'], backgroundIds: ['home'], topic: '빵 냄새를 따라가는 날', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', value: 'none', ending: 'home', simpleFlow: true};
const input = normalizeStoryInput({...inputFromWizard(s, wizard, {layout: 'pages'}).input, bookId: 'bread-r64'});
const outline = W.roomOutline(input, {premise: {title: '빵 냄새는 등 뒤에서', line: 'l', cast: [], places: []}, pitches: []});
const GATE = {name: 'village gate', map: 'the old oak with the arrow sign at the LEFT edge; the dirt road runs from left to right; the bakery with a green-and-cream striped awning at the far RIGHT end of the road'};
const SIGN = {name: 'the arrow sign', look: 'one rectangular pale-wood board hung from a short iron bracket on the old oak at Yuha\'s head height; one thick red arrow painted on it pointing straight down; no letters'};
const GIRL = {name: 'new girl', look: 'a girl smaller than Yuha, red cap, straight black bob, blue overalls, yellow backpack — clearly not Yuha'};
const page = (no, ko, en, action, mustSee, extra = {}) => ({pageNo: no, beatIndex: 1, ko, en, textKo: ko, textEn: en, staging: {shot: no === 1 ? 'wide' : 'medium', characterSide: 'left', textSide: 'right', seed: 1000 + no}, scene: {who: ['yuha'], where: 'village gate', action, emotion: 'happy', timeOfDay: 'day', props: [], mustSee, stage: GATE, things: [SIGN], ...extra}});
const pages = [
  page(1, '거꾸로 선 화살표 밑에 섰더니, 큰길 건너에서 빵 냄새가 솔솔 났어요. 유하가 외쳤어요. "간다! 이번엔 진짜!"', 'Yuha is under the arrow. Mmm, buns are out there! Yuha says, "Here I go!"', 'Yuha stands under the arrow sign at the village gate, sniffing the bread smell from the bakery far down the road.', ['Yuha under the arrow sign', 'the bakery far away at the right end of the road']),
  page(2, '하나, 둘, 셋, 넷, 다섯! 힘껏 뛰었는데…… 어?', 'One, two, three, four, five!', 'Yuha runs forward toward the bakery with all his strength.', ['Yuha running toward the bakery']),
  page(3, '빵집이 점점 작아졌어요. 유하는 화살표 밑에 쭈욱 밀려나 있었어요.', 'But he is under the arrow!', 'The bakery far down the road looks smaller; Yuha stands back under the arrow sign, surprised.', ['the bakery tiny and far at the right end of the road', 'Yuha back under the arrow sign, surprised']),
];
for (let n = 4; n <= 14; n++) pages.push(page(n, `${n}쪽 글이에요.`, `Page ${n}.`, `Page ${n}.`, [`page ${n}`], {stage: undefined, where: 'elsewhere', things: undefined}));
pages.push(page(15, '다시 마을 입구, 화살표 밑에 새로 온 아이가 앞으로 뛰려고 해요. 유하는 아이 앞에서 등을 휙 돌리고, 한 발을 든 채 기다렸어요. "하나…"', 'A new kid is under the arrow. Yuha turns back, lifts one leg, and waits: "One..."', 'Back at the village gate a new girl stands under the arrow sign, about to run forward; in front of her, Yuha has turned his back to the bakery and faces her, one leg lifted, showing her how to wait.', ['the new girl under the arrow sign, about to run forward', 'Yuha facing her with his back to the bakery, one leg up, waiting'], {extras: [GIRL]}));
const book = {id: 'bread-r64', title: '빵 냄새는 등 뒤에서', storyInput: input, outline, characterIds: ['yuha'], backgroundIds: ['home'], pages};
const world = G.getActiveWorld(s);
const key = process.env.OPENAI_API_KEY || '';
if (!DRY && !key) throw Error('no key in the environment');
const ledger = [];
const save = (name, dataUrl) => { const b = dataUrl.split(',')[1]; fs.writeFileSync(`${out}/${name}.png`, Buffer.from(b, 'base64')); };
const draw = async (label, request) => {
  const req = {...request, quality: 'medium'};
  fs.writeFileSync(`${out}/${label}-request.txt`, `REFERENCES:\n${(req.referenceImages || []).map((r) => `- ${r.role}: ${r.label}`).join('\n')}\n\nPROMPT:\n${req.prompt || req.scenePrompt || ''}\n`);
  if (DRY) { console.log(label, 'refs:', (req.referenceImages || []).map((r) => r.label).join(' | ')); return 'data:image/png;base64,iVBORw0KGgo='; }
  const started = Date.now();
  const result = await P.generateImage(req, {engine: 'openai', config: {apiKey: key, model: 'gpt-image-2'}});
  ledger.push({label, model: result.model, costUsd: result.costUsd ?? null, size: result.providerSize, seconds: Math.round((Date.now() - started) / 1000), refs: (req.referenceImages || []).length});
  save(label, result.imageUrl);
  console.log(label, 'done', JSON.stringify(ledger.at(-1)));
  return result.imageUrl;
};
// 1. Yuha's sheet (no style reference images in this offline seed).
const sheetReq = G.createCharacterSheetRequest(s, 'yuha', {quality: 'medium'});
sheetReq.referenceImages = (sheetReq.referenceImages || []).filter((r) => typeof (r.imageUrl || r.url) === 'string' && String(r.imageUrl || r.url).startsWith('data:'));
const sheetUrl = await draw('0-yuha-sheet', sheetReq);
book.generationSnapshot = {worldId: world.id, imageEngine: 'openai', stylePresetId: world.stylePresetId, stylePreset: getStylePreset(world.stylePresetId), styleReferences: [], characterSheets: [{id: 's-yuha', characterId: 'yuha', confirmedAt: 'now', imageUrl: sheetUrl, characterSnapshot: structuredClone(s.characters.find((c) => c.id === 'yuha'))}], backgrounds: []};
// 2. Page 1 first.
const p1 = await draw('1-page01', G.sceneGenerationRequest(s, book, 0));
book.pages[0].imageUrl = p1;
// 3. Later pages of the same stage: page 1 rides along as the CANONICAL first scene.
for (const i of [2, 14]) {
  const r = G.sceneGenerationRequest(s, book, i);
  if (!r.referenceImages.some((x) => /CANONICAL first scene/.test(x.label))) throw Error(`page ${i + 1}: no canonical stage reference`);
  book.pages[i].imageUrl = await draw(`${i === 2 ? '2' : '3'}-page${String(i + 1).padStart(2, '0')}`, r);
}
fs.writeFileSync(`${out}/ledger.json`, JSON.stringify(ledger, null, 2));
console.log('total', ledger.reduce((n, x) => n + (Number(x.costUsd) || 0), 0));
