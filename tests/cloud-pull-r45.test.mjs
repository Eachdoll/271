import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateImport} from '../dist/output.js';

/**
 * 2026-10-29 R45 클라우드 불러오기. After R44 the parent's other device saved
 * (cloud: 6 books · 8 characters · 12 places), and this PC's pull stopped with
 * "250MB 이하의 동화공방 JSON 백업 파일을 선택해 주세요." The pull joined every
 * cloud picture as base64 into one JSON string and handed it to the file
 * import check, whose 250MB cap is for one backup file's text; the parent's
 * pictures are over 150MB (R41), ~1.37× larger in base64. The pull now hands
 * the backup over as an object; every other check is the same.
 */
const library = () => ({books: [{id: 'book-one', title: '우리 집 모험', pages: [{ko: '유하가 문을 열어요.', en: 'Yuha opens the door.', imageAssetId: 'image-cloud-0000000001'}]}], characters: [{id: 'yuha', name: '유하'}], backgrounds: [], settings: {}});
function pngDataUrl(bytes) {
  const buf = Buffer.alloc(bytes, 7);
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(buf, 0);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

test('R45 a cloud backup handed over as an object passes whatever its pictures total; the same backup as one file text is refused at 250MB', () => {
  const dataUrl = pngDataUrl(900 * 1024); // one string, shared by every entry below
  const images = Array.from({length: 300}, (_, i) => ({id: `image-cloud-${String(i + 1).padStart(10, '0')}`, dataUrl}));
  const backup = {format: 'donghwa-workshop-library', version: 1, exportedAt: '2026-10-29T00:00:00Z', state: library(), imageAssets: images, audioAssets: []};
  const joined = images.reduce((n, image) => n + image.dataUrl.length, 0);
  assert.ok(joined > 250 * 1024 * 1024, `the pictures alone are ${Math.round(joined / 1048576)}MB of text`);
  const state = validateImport(backup);
  assert.equal(state.books[0].pages[0].imageAssetId, 'image-cloud-0000000001');
  assert.equal(state._restoreAssets.length, 300, 'every picture is handed to the restore step');
  // A file of that size is still refused by the file path (the cap is for one file's text).
  assert.throws(() => validateImport('x'.repeat(250 * 1024 * 1024 + 1)), /250MB 이하의 동화공방 JSON 백업 파일/);
});

test('R45 the object path keeps every check of the file path: forbidden keys, missing pictures, bad pictures, a bad version, credentials stripped', () => {
  const good = {format: 'donghwa-workshop-library', version: 1, state: library(), imageAssets: [{id: 'image-cloud-0000000001', dataUrl: pngDataUrl(64)}], audioAssets: []};
  // Same result as the text path.
  const fromText = validateImport(JSON.stringify(good)), fromObject = validateImport(structuredClone(good));
  assert.deepEqual(JSON.parse(JSON.stringify(fromObject)), JSON.parse(JSON.stringify(fromText)));
  // __proto__ as an own key (JSON.parse of a server reply makes one) is refused like the reviver refuses it.
  const poisoned = JSON.parse('{"format":"donghwa-workshop-library","version":1,"state":{"books":[],"characters":[{"id":"a","name":"a","__proto__":{"x":1}}]},"imageAssets":[],"audioAssets":[]}');
  assert.throws(() => validateImport(poisoned), /허용하지 않는 데이터 키/);
  assert.throws(() => validateImport({...structuredClone(good), imageAssets: []}), /그림이 빠진/);
  assert.throws(() => validateImport({...structuredClone(good), imageAssets: [{id: 'image-cloud-0000000001', dataUrl: 'data:image/png;base64,AAAA'}]}), /그림/);
  assert.throws(() => validateImport({...structuredClone(good), version: 2}), /지원하지 않는/);
  const withKey = structuredClone(good);
  withKey.state.settings.apiKey = 'never';
  assert.equal(validateImport(withKey).settings.apiKey, undefined);
  assert.throws(() => validateImport([]), /250MB 이하의 동화공방 JSON 백업 파일/, 'an array is not a backup');
});

test('R45 the cloud pull hands its backup to the check as an object, never as one joined string', () => {
  const sync = readFileSync(new URL('../dist/cloud-sync.js', import.meta.url), 'utf8');
  assert.match(sync, /const candidate = validate\(\{\n\s+format: "donghwa-workshop-library",\n\s+version: 1,[^]*?state: clone\(record\.state\),\n\s+imageAssets: images,\n\s+audioAssets: audio,\n\s+\}\);/);
  assert.doesNotMatch(sync, /validate\(\s*JSON\.stringify\(/);
});
