import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateCharacter,archiveCharacter,restoreCharacter,activeCharacters,
  updateBackground,deleteBackground,restoreBackground,activeBackgrounds,
  resetParentPreferences,resetWorldProviderConfig,renameWorld,deleteBook
} from '../dist/management.js';

function fixture() {
  const character = {id:'child',name:'유하',nameEn:'Yuha',kind:'child',description:'노란 옷',version:1,color:'#e9bb4e',traits:['다정함']};
  const sheet = {id:'sheet-1',characterId:'child',worldId:'world-1',worldRevision:1,imageEngine:'google',stylePresetId:'watercolor',imageUrl:'data:image/png;base64,test',confirmedAt:'2026-10-01',characterSnapshot:{...character}};
  character.characterSheets = [sheet];
  return {
    activeWorldId:'world-1',worlds:[{id:'world-1',name:'작은 세계',revision:1,characterIds:['child','friend'],characterSheetsStale:false,imageEngine:'google',stylePresetId:'watercolor',providerConfig:{local:{endpoint:'https://example.test',workflow:{node:{}}},google:{quality:'high'}}}],
    characters:[character,{id:'friend',name:'토토',nameEn:'Toto',kind:'rabbit',version:1}],
    backgrounds:[{id:'home',name:'우리 집',type:'home',description:'노란 대문',version:1}],
    books:[
      {id:'old',title:'옛 이야기',characterIds:['child'],backgroundIds:['home'],generationSnapshot:{worldId:'world-1',characterSheets:[structuredClone(sheet)]}},
      {id:'sample',title:'샘플 이야기',characterIds:['child'],backgroundIds:['home'],pages:[]}
    ],
    settings:{defaultLanguage:'ko',defaultPages:24,defaultLayout:'single',dailyLimit:1,rate:1.05,pinHash:'keep-pin',style:'watercolor',imageProviderConfig:{local:{endpoint:'https://legacy.test'}},apiKeys:{encrypted:'preserve'}},
    readingLog:[{bookId:'old',date:'today'},{bookId:'sample',date:'yesterday'}],daily:{today:2}
  };
}
function freeze(value) { if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);} return value; }

test('Character edits keep input, prior sheets, old engine book snapshots, and old sample appearances immutable', () => {
  const state = freeze(fixture()), historical = JSON.stringify(state.books[0].generationSnapshot);
  const next = updateCharacter(state,'child',{name:'새 이름',color:'#112233',id:'attempted-id',characterSheets:[]});
  assert.equal(state.characters[0].name,'유하');
  assert.equal(next.characters[0].name,'새 이름');
  assert.equal(next.characters[0].id,'child');
  assert.equal(next.characters[0].version,2);
  assert.equal(next.characters[0].sheetStale,true);
  assert.equal(next.worlds[0].characterSheetsStale,true);
  assert.equal(next.worlds[0].revision,1); // Unchanged characters do not need paid regeneration.
  assert.deepEqual(next.characters[0].characterSheets,state.characters[0].characterSheets);
  assert.equal(JSON.stringify(next.books[0].generationSnapshot),historical);
  assert.equal(next.books[1].characterSnapshots[0].name,'유하');
  assert.equal(next.books[1].characterSnapshots[0].color,'#e9bb4e');
  assert.equal(next.characters[0].characterHistory[0].name,'유하');
  assert.equal(next.characters[1].sheetStale,undefined);
});

test('Repeated name and description edits keep the first book appearance and version history', () => {
  const first = updateCharacter(fixture(),'child',{description:'초록 옷'});
  const second = updateCharacter(first,'child',{name:'민아'});
  assert.equal(second.characters[0].version,3);
  assert.equal(second.characters[0].characterHistory.length,2);
  assert.equal(second.characters[0].characterHistory[1].description,'초록 옷');
  assert.equal(second.books[1].characterSnapshots[0].description,'노란 옷');
  assert.equal(second.books[1].characterSnapshots.length,1);
  assert.strictEqual(updateCharacter(second,'child',{name:'민아'}),second);
});

test('Archiving and restoring characters removes future cast selection without breaking existing books', () => {
  const original = freeze(fixture()), deleted = archiveCharacter(original,'child');
  assert.deepEqual(activeCharacters(deleted).map(c => c.id),['friend']);
  assert.equal(deleted.books[1].characterSnapshots[0].name,'유하');
  assert.equal(deleted.characters[0].characterSheets.length,1);
  assert.deepEqual(deleted.worlds[0].characterIds,['child','friend']);
  assert.deepEqual(deleted.books[0].characterIds,['child']);
  assert.throws(() => updateCharacter(deleted,'child',{name:'불가'}),/복원/);
  const restored = restoreCharacter(deleted,'child');
  assert.equal(restored.characters[0].archivedAt,undefined);
  assert.equal(activeCharacters(restored,'world-1').length,2);
  assert.ok(deleted.characters[0].archivedAt);
});

test('Background edit, deletion, and restoration preserve settings of every existing book', () => {
  const original = freeze(fixture()), edited = updateBackground(original,'home',{name:'새 집',type:'forest',description:'초록 숲'});
  assert.equal(edited.backgrounds[0].version,2);
  assert.equal(edited.books[1].backgroundSnapshots[0].description,'노란 대문');
  assert.equal(edited.backgrounds[0].backgroundHistory[0].name,'우리 집');
  assert.equal(edited.worlds[0].characterSheetsStale,false);
  const deleted = deleteBackground(edited,'home');
  assert.equal(activeBackgrounds(deleted).length,0);
  assert.equal(deleted.books[1].backgroundSnapshots[0].name,'우리 집');
  assert.equal(restoreBackground(deleted,'home').backgrounds[0].name,'새 집');
  assert.equal(original.backgrounds[0].name,'우리 집');
});

test('Preference reset changes only five defaults and keeps PIN, credentials, books, World and counts', () => {
  const state = freeze(fixture()), next = resetParentPreferences(state);
  assert.deepEqual(Object.fromEntries(['defaultLanguage','defaultPages','defaultLayout','dailyLimit','rate'].map(k => [k,next.settings[k]])),{defaultLanguage:'dual',defaultPages:12,defaultLayout:'booklet',dailyLimit:3,rate:0.85});
  assert.equal(next.settings.pinHash,'keep-pin');
  assert.deepEqual(next.settings.apiKeys,state.settings.apiKeys);
  assert.deepEqual(next.worlds,state.worlds);
  assert.deepEqual(next.books,state.books);
  assert.deepEqual(next.daily,state.daily);
  assert.equal(state.settings.defaultPages,24);
});

test('World provider config reset clears custom local workflow while preserving credentials and engine settings', () => {
  const state = freeze(fixture()), next = resetWorldProviderConfig(state,'local');
  assert.deepEqual(next.worlds[0].providerConfig.local,{endpoint:'http://127.0.0.1:8188',workflow:null});
  assert.deepEqual(next.worlds[0].providerConfig.google,state.worlds[0].providerConfig.google);
  assert.equal(next.worlds[0].imageEngine,'google');
  assert.equal(next.worlds[0].revision,1);
  assert.deepEqual(next.settings,state.settings);
  assert.deepEqual(resetWorldProviderConfig(state,'sample').worlds[0].providerConfig.sample,{});
});

test('World rename and book deletion leave other records and reading limit counts intact', () => {
  const state = freeze(fixture()), renamed = renameWorld(state,'  달빛 세계  ');
  assert.equal(renamed.worlds[0].name,'달빛 세계');
  assert.equal(renamed.worlds[0].revision,1);
  const next = deleteBook(renamed,'old');
  assert.deepEqual(next.books.map(book => book.id),['sample']);
  assert.deepEqual(next.readingLog,[{bookId:'sample',date:'yesterday'}]);
  assert.deepEqual(next.characters,state.characters);
  assert.deepEqual(next.backgrounds,state.backgrounds);
  assert.deepEqual(next.daily,state.daily);
  assert.equal(state.books.length,2);
});

test('Validation rejects invalid edits before changing the local library', () => {
  const state = freeze(fixture());
  for (const patch of [{name:''},{nameEn:' '},{age:0},{age:2.5},{color:'red'},{variant:100},{kind:'unknown'}]) assert.throws(() => updateCharacter(state,'child',patch));
  assert.throws(() => updateBackground(state,'home',{type:'unknown'}));
  assert.throws(() => updateBackground(state,'home',{name:''}));
  assert.throws(() => archiveCharacter(state,'missing'));
  assert.throws(() => deleteBook(state,'missing'));
  assert.throws(() => renameWorld(state,''));
  assert.throws(() => resetWorldProviderConfig(state,''));
  assert.equal(state.characters[0].version,1);
});
