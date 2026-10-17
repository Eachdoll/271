import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {createLibraryBackup,createZip,validateImport,restoreLibraryImages} from '../dist/output.js';
import {readLibraryBackupFile,backupSummary,MAX_TRANSFER_BYTES} from '../dist/device-transfer.js';
import {restoreImageAsset,revokeImageURLs,getAsset,getImageURL,hydrateImageAssets} from '../dist/image-generation/assets.js';
import {saveAudioAsset,getAudioAsset} from '../dist/audio-playback.js';
import {getStylePreset,validateStylePreset} from '../dist/image-generation/styles.js';
import {getWorldStyleReferences} from '../dist/image-generation/world.js';
import {renderImageSettings} from '../dist/image-generation/settings-ui.js';

const image='data:image/png;base64,iVBORw0KGgo=';
const imageId='image-device-sheet-0123456789',styleId='image-device-style-0123456789',audioId='audio-device-recording-0123456789';
const oldDB=globalThis.indexedDB;
const databases=new Map();
before(()=>{
  globalThis.indexedDB={open(name){
    const request={};
    queueMicrotask(()=>{
      if(!databases.has(name))databases.set(name,new Map());
      const records=databases.get(name);
      request.result={objectStoreNames:{contains:()=>true},close(){},transaction(){
        const tx={};
        const perform=fn=>{const operation={};queueMicrotask(()=>{operation.result=fn();operation.onsuccess?.();tx.oncomplete?.();});return operation;};
        tx.objectStore=()=>({get:id=>perform(()=>records.get(id)),put:record=>perform(()=>{records.set(record.id,record);return record.id;}),delete:id=>perform(()=>records.delete(id))});
        return tx;
      }};
      request.onsuccess?.();
    });
    return request;
  }};
});
after(()=>{globalThis.indexedDB=oldDB;revokeImageURLs();});

function state(){return {
  books:[{id:'book-family',title:'함께 만든 이야기',characterIds:['child'],pages:[{ko:'유하가 문을 열어요.',en:'Yuha opens the door.'}]}],
  characters:[{id:'child',name:'유하'}],backgrounds:[{id:'home',name:'우리 집',layout:'왼쪽 노란 문'}],
  worlds:[{id:'world-one',name:'우리 세상',textGeneration:{engine:'openai',providerConfig:{openai:{model:'gpt-6-astra'}}}}],
  activeWorldId:'world-one',stylePresets:[],readingFeedback:[{bookId:'book-family',rating:'easy'}],
  settings:{pinHash:'local-parent-pin',apiKey:'never-export-secret',readingKoLevel:'K2',readingEnLevel:'E1'},
  storyDrafts:{pending:{id:'pending',stage:'prose',prose:{paragraphs:[{ko:'아직 다 쓰지 않은 글',en:'Unfinished story.'}]}}}
};}
function file(text,name='library.json'){return new File([text],name,{type:'application/json'});}

test('a direct JSON roundtrip preserves worlds, materials, drafts, reading settings and IDs without PIN or credentials',async()=>{
  const original=state(),before=JSON.stringify(original);
  original.worlds[0].providerConfig={openai:{api_key:'nested-secret',baseUrl:'https://api.openai.com/v1'}};
  const actualBefore=JSON.stringify(original),backup=await createLibraryBackup(original),restored=await readLibraryBackupFile(file(backup.text));
  assert.equal(JSON.stringify(original),actualBefore,'export never mutates the current library');
  assert.equal(restored.books[0].id,'book-family');assert.equal(restored.backgrounds[0].layout,'왼쪽 노란 문');
  assert.deepEqual(restored.storyDrafts,original.storyDrafts);assert.deepEqual(restored.readingFeedback,original.readingFeedback);
  assert.deepEqual(restored.worlds[0].textGeneration,original.worlds[0].textGeneration);
  assert.equal(restored.settings.readingKoLevel,'K2');assert.equal(restored.settings.pinHash,undefined);
  assert.ok(!backup.text.includes('local-parent-pin'));assert.ok(!backup.text.includes('never-export-secret'));assert.ok(!backup.text.includes('nested-secret'));
  assert.match(backup.filename,/\.json$/);assert.equal(backup.imageCount,0);assert.equal(backup.audioCount,0);
  assert.deepEqual(backupSummary(restored),{bookCount:1,characterCount:1,backgroundCount:1,worldCount:1,draftCount:1,imageCount:0,audioCount:0});
  assert.equal(validateImport(before,{allowStoredAssets:true}).settings.pinHash,'local-parent-pin','normal local startup keeps its existing PIN');
});

test('media from nested sheets, style IDs and draft audio are included once and restore under their original IDs without generation calls',async()=>{
  await restoreImageAsset(imageId,image);await restoreImageAsset(styleId,image);
  await saveAudioAsset(new Blob(['family voice'],{type:'audio/webm'}),{id:audioId});
  const library=state();library.characters[0].characterSheets=[{imageAssetId:imageId,imageUrl:'asset:'+imageId}];
  library.books[0].generationSnapshot={characterSheets:[{imageAssetId:imageId}],world:{styleSheetImageIds:[styleId]}};
  library.stylePresets=[{id:'custom',styleRefImageIds:[styleId],styleRefImages:[]}];
  library.storyDrafts.pending.previousAudio={recording:{assetId:audioId,timings:[{word:'유하',start:0,end:1}]}};
  const oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('No generation or remote request should run');};
  try {
    const backup=await createLibraryBackup(library),restored=await readLibraryBackupFile(file(backup.text));
    assert.equal(backup.imageCount,2);assert.equal(backup.audioCount,1);assert.equal(calls,0);
    assert.equal(backupSummary(restored).imageCount,2);assert.equal(backupSummary(restored).audioCount,1);
    assert.equal(Object.keys(restored).includes('_restoreAssets'),false);
    // Restoring the image bytes uses a data URL fetch only, never an AI request.
    globalThis.fetch=oldFetch;await restoreLibraryImages(restored);
    assert.equal(restored.characters[0].characterSheets[0].imageAssetId,imageId);
    assert.equal((await getAsset(styleId)).size,8);assert.equal(await (await getAudioAsset(audioId)).blob.text(),'family voice');
    assert.equal(restored._restoreAssets,undefined);assert.equal(restored._restoreAudioAssets,undefined);
  }finally{globalThis.fetch=oldFetch;}
});

test('repeated large frozen style references stay in one media asset and never inflate the restored local state',async()=>{
  const bytes=new Uint8Array(2500000);bytes.set([137,80,78,71,13,10,26,10]);
  const largeImage='data:image/png;base64,'+Buffer.from(bytes).toString('base64');
  const library=state(),preset={...getStylePreset('watercolor'),styleRefImages:[largeImage]};
  library.books=Array.from({length:4},(_,index)=>({
    ...structuredClone(library.books[0]),id:'book-'+index,
    generationSnapshot:{stylePreset:structuredClone(preset),styleReferences:[{imageUrl:largeImage}]}
  }));
  library.stylePresets=[{...preset,id:'custom-paint',isBuiltIn:false}];
  const backup=await createLibraryBackup(library),restored=await readLibraryBackupFile(file(backup.text));
  assert.equal(backup.imageCount,1,'every repeated style URL shares one binary asset');
  assert.equal(restored.styleSheetImages.length,1,'one durable object reference is available to startup hydration');
  assert.ok(new TextEncoder().encode(JSON.stringify(restored)).length<20000,'restored localStorage data is compact even with four large frozen references');
  assert.ok(!JSON.stringify(restored).includes('data:image/'),'binary media lives outside persisted application state');
  for(const book of restored.books){
    assert.equal(validateStylePreset(book.generationSnapshot.stylePreset).valid,true);
    assert.match(book.generationSnapshot.stylePreset.styleRefImages[0],/^asset:image-/);
    assert.equal(book.generationSnapshot.stylePreset.styleRefImageIds.length,1);
  }
  await restoreLibraryImages(restored);
  const assetId=restored.styleSheetImages[0].imageAssetId;
  assert.equal((await getAsset(assetId)).size,bytes.length);
  revokeImageURLs();assert.equal(getImageURL(assetId),null);
  const status=await hydrateImageAssets(restored);
  assert.equal(status.loaded,1);assert.deepEqual(status.missing,[]);
  const refs=getWorldStyleReferences(restored,{...restored.worlds[0],imageEngine:'openai',styleSheetImageIds:[]},restored.books[0].generationSnapshot.stylePreset);
  assert.equal(refs.length,1);assert.match(refs[0].imageUrl,/^blob:/);
  Object.assign(restored.worlds[0],{imageEngine:'sample',characterIds:[],stylePresetId:'watercolor',revision:1});
  const html=renderImageSettings(restored);
  assert.ok(html.includes(`src="${getImageURL(assetId)}"`),'custom preset preview resolves its restored media ID');
  assert.ok(!html.includes('src="asset:'),'private asset identifiers are never used as browser image URLs');
});

test('a missing referenced image or recording rejects the transfer rather than creating an incomplete backup',async()=>{
  const library=state();library.backgrounds[0].imageAssetId='image-missing-image-0123456789';
  await assert.rejects(createLibraryBackup(library),/원본.*없어/);
  assert.throws(()=>validateImport(JSON.stringify(library)),/그림이 빠진/);
  delete library.backgrounds[0].imageAssetId;library.books[0].audio={pages:{0:{ko:{recording:{assetId:'audio-missing-recording'}}}}};
  await assert.rejects(createLibraryBackup(library),/음원 원본.*없어/);
  assert.throws(()=>validateImport(JSON.stringify(library)),/음원이 빠진/);
});

test('existing stored ZIP backups can be selected directly without unzipping',async()=>{
  const backup=await createLibraryBackup(state());
  const archive=createZip([{name:'library.json',data:backup.text},{name:'README.txt',data:'이동 안내'},{name:'images/a.png',data:new Uint8Array([1,2,3])}]);
  const imported=await readLibraryBackupFile(new File([archive],'old-backup.zip'));
  assert.equal(imported.books[0].title,'함께 만든 이야기');assert.equal(backupSummary(imported).draftCount,1);
});

function crc(bytes){let result=0xffffffff;for(const byte of bytes){result^=byte;for(let bit=0;bit<8;bit++)result=result&1?0xedb88320^(result>>>1):result>>>1;}return (result^0xffffffff)>>>0;}
function compressedZip(text,{name='library.json',declaredSize,method=8}={}){
  const nameBytes=new TextEncoder().encode(name),data=new TextEncoder().encode(text),compressed=method===8?deflateRawSync(data):data;
  const head=new Uint8Array(30+nameBytes.length),hv=new DataView(head.buffer);
  hv.setUint32(0,0x04034b50,true);hv.setUint16(4,20,true);hv.setUint16(6,0x800,true);hv.setUint16(8,method,true);hv.setUint32(14,crc(data),true);hv.setUint32(18,compressed.length,true);hv.setUint32(22,declaredSize??data.length,true);hv.setUint16(26,nameBytes.length,true);head.set(nameBytes,30);
  const directory=new Uint8Array(46+nameBytes.length),dv=new DataView(directory.buffer);
  dv.setUint32(0,0x02014b50,true);dv.setUint16(4,20,true);dv.setUint16(6,20,true);dv.setUint16(8,0x800,true);dv.setUint16(10,method,true);dv.setUint32(16,crc(data),true);dv.setUint32(20,compressed.length,true);dv.setUint32(24,declaredSize??data.length,true);dv.setUint16(28,nameBytes.length,true);directory.set(nameBytes,46);
  const end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,1,true);ev.setUint16(10,1,true);ev.setUint32(12,directory.length,true);ev.setUint32(16,head.length+compressed.length,true);
  return new File([head,compressed,directory,end],'compressed.zip');
}

test('deflate ZIP library.json works through native bounded decompression',async()=>{
  const backup=await createLibraryBackup(state());
  assert.equal((await readLibraryBackupFile(compressedZip(backup.text))).characters[0].id,'child');
  await assert.rejects(readLibraryBackupFile(compressedZip(backup.text,{declaredSize:4})),/ZIP 백업/);
});

test('corrupt CRC, truncated archives, duplicate manifests and traversal paths are rejected before import',async()=>{
  const backup=await createLibraryBackup(state()),good=createZip([{name:'library.json',data:backup.text}]);
  const bytes=new Uint8Array(await good.arrayBuffer());bytes[30+'library.json'.length+4]^=1;
  await assert.rejects(readLibraryBackupFile(file(bytes,'damaged.zip')),/손상/);
  await assert.rejects(readLibraryBackupFile(file(bytes.subarray(0,bytes.length-10),'truncated.zip')),/ZIP 백업/);
  await assert.rejects(readLibraryBackupFile(new File([createZip([{name:'library.json',data:backup.text},{name:'library.json',data:backup.text}])],'duplicates.zip')),/두 개/);
  await assert.rejects(readLibraryBackupFile(compressedZip(backup.text,{name:'../library.json'})),/ZIP 백업/);
  await assert.rejects(readLibraryBackupFile(compressedZip(backup.text,{method:12})),/ZIP 백업/);
});

test('oversized, empty, invalid JSON and prototype-shaped files never become candidate state',async()=>{
  let reads=0;await assert.rejects(readLibraryBackupFile({size:MAX_TRANSFER_BYTES+1,arrayBuffer:()=>{reads++;}}),/250MB/);assert.equal(reads,0);
  await assert.rejects(readLibraryBackupFile(file('')),/250MB/);
  await assert.rejects(readLibraryBackupFile(file('{"__proto__":{},"books":[],"characters":[]}')),/JSON 백업/);
  await assert.rejects(readLibraryBackupFile(file('not JSON')),/JSON 백업/);
});

test('A-1 Blob backup skips base64 encoding and text round trips',async()=>{
 const original=globalThis.btoa;globalThis.btoa=()=>assert.fail('Blob backup must not encode bytes');
 try {const library=state();delete library.stylePresets;const backup=await createLibraryBackup(library,{mode:'blobs'});assert.ok(backup.assets instanceof Map);assert.equal(backup.text,undefined);for(const value of backup.assets.values())assert.ok(value instanceof Blob);}
 finally{globalThis.btoa=original;}
});
