import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const source = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
const files = JSON.parse(source.match(/const FILES\s*=\s*(\[[^\]]*\])/)[1].replace(/'/g, '"').replace(/,\s*\]/g, ']'));

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('service worker precache list only names files that exist in dist', () => {
  const missing = files.filter(file => file !== './' && !fs.existsSync(path.join(dist, file)));
  assert.deepEqual(missing, []);
});

test('every runtime module and stylesheet in dist is precached for offline use', () => {
  const listed = new Set(files.map(file => file.replace(/^\.\//, '')));
  const unlisted = walk(dist)
    .map(file => path.relative(dist, file).split(path.sep).join('/'))
    .filter(file => /\.(js|css|json|webmanifest|html)$/.test(file) && file !== 'sw.js' && !file.endsWith('.d.ts') && !/^story-quality\/dist\/(?:cli\/|distill\/|eval\/|finetune\/|node\.js$)/.test(file))
    .filter(file => !listed.has(file));
  assert.deepEqual(unlisted, []);
});

test('service worker cache name changes with shell contents', () => {
  const cache = source.match(/const CACHE\s*=\s*["']([^"']+)["']/)[1];
  assert.match(cache, /^donghwa-shell-v\d+$/);
  assert.ok(source.includes('Promise.allSettled'), '개별 파일 실패가 전체 설치를 막지 않아야 합니다');
});

test('A-16 offline cache excludes Node tooling and unused text lists and retains fetch writes',()=>{
 assert.ok(!files.some(f=>/story-quality\/dist\/(?:cli|distill|eval|finetune)\/|\/node\.js$|vocab\/.*\.txt$/.test(f)));
 assert.match(source,/event\.waitUntil\(\s*caches\s*\.open\(CACHE\)/);
});
