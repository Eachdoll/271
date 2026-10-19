import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {getPrintHTML, recommendedPrintLayout, OPENING_FONT_FLOORS, OPENING_MIN_FONT, OPENING_BOOKLET_NOTE} from '../dist/output.js';

/**
 * R12-P7: openings print (leaf model). 'single' puts one opening on an A4
 * landscape sheet, 크게 읽기 ('two') one printed page on an A4 portrait sheet
 * (a spread gives two half-picture sheets), booklet falls back to single with a
 * note. The fit (one font per book, floors, picture scale) is measured in
 * Chromium by scripts/r12-print-fit.mjs (QA/r12-print-fit.json). Page books keep
 * their print HTML byte for byte (the P0 'print' pin and print-layout tests).
 */
const clone = value => JSON.parse(JSON.stringify(value));
const LEGACY = JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8'));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function openingsBook({ko = 'K2', en = 'E2', language = 'bilingual'} = {}) {
  const base = clone(LEGACY);
  const input = normalizeStoryInput({...base.storyInput, layoutPolicy: L.openingsLayoutPolicy(), specs: freezeReadingLevels({koreanLevel: ko, englishLevel: en}, {}, {layout: 'openings'}).specs, pageCount: 16});
  const prose = demoProse(base.outline, input), pagination = demoPagination(base.outline, prose, input);
  const book = {...base, language, storyInput: input, prose, pagination, pages: toLegacyPages(pagination).map(page => ({...page, imageUrl: PNG})), cover: {imageUrl: PNG}};
  return book;
}
const count = (html, pattern) => [...html.matchAll(pattern)].length;

test('R12-P7 single: one opening per A4 landscape sheet, cover and back on their own; folios 2k−1 and 2k', () => {
  const book = openingsBook(), html = getPrintHTML(book, {layout: 'single'}, []);
  assert.match(html, /@page \{ size: A4 landscape;/u);
  assert.equal(count(html, /class="sheet ob-sheet ob-single"/gu), 8);
  assert.equal(count(html, /<section class="sheet /gu), 10, 'cover + 8 openings + back');
  assert.match(html, /class="leaf cover"/u);
  assert.match(html, /class="leaf back"/u);
  assert.deepEqual([...html.matchAll(/class="ob-folio">(\d+)</gu)].map(m => Number(m[1])), Array.from({length: 16}, (_, i) => i + 1));
  assert.equal(count(html, /ob-half ob-half-left/gu), 3);
  assert.equal(count(html, /ob-half ob-half-right/gu), 3);
  assert.equal(count(html, /class="ob-leaf ob-page/gu), 10);
  assert.match(html, /data-font-floor="14"/u);
  assert.match(html, /펼침 구성 · A4 가로 한 장에 펼침 하나 · 펼침 8개/u);
  assert.doesNotMatch(html, /class="leaf story-page/u, 'no page-book leaves');
  // A spread's halves carry the whole text of each language, split once, in order.
  const spread = book.pages[0], halves = [...html.matchAll(/data-leaf="(1|2)">.*?<div class="ob-text">(.*?)<\/div>/gsu)].map(m => m[2]);
  const ko = halves.map(h => (h.match(/<p lang="ko" class="ko">(.*?)<\/p>/su)?.[1] || '')), enHalves = halves.map(h => (h.match(/<p lang="en" class="en">(.*?)<\/p>/su)?.[1] || ''));
  const unescape = text => text.replace(/&#39;/gu, "'").replace(/&quot;/gu, '"').replace(/&amp;/gu, '&');
  assert.equal(unescape(ko.join(' ')).replace(/\s+/gu, ' ').trim(), spread.ko.replace(/\s+/gu, ' ').trim());
  assert.equal(unescape(enHalves.join(' ')).replace(/\s+/gu, ' ').trim(), spread.en.replace(/\s+/gu, ' ').trim());
  assert.ok(ko.every(Boolean) && enHalves.every(Boolean), 'both halves have text');
});

test('R12-P7 크게 읽기: one printed page per A4 portrait sheet; a spread becomes two half-picture sheets', () => {
  const html = getPrintHTML(openingsBook(), {layout: 'two'}, []);
  assert.match(html, /@page \{ size: A4 portrait;/u);
  assert.equal(count(html, /class="sheet ob-sheet ob-large"/gu), 16);
  assert.equal(count(html, /<section class="sheet /gu), 18);
  assert.match(html, /크게 읽기 · A4 세로 한 장에 한 쪽/u);
  assert.equal(count(html, /data-opening="1"/gu), 2, 'the opening-1 spread prints on two sheets');
});

test('R12-P7 booklet falls back to single with a note; text is always below; the range counts openings', () => {
  const book = openingsBook();
  const booklet = getPrintHTML(book, {layout: 'booklet', textPosition: 'staged'}, []);
  assert.match(booklet, new RegExp(OPENING_BOOKLET_NOTE, 'u'));
  assert.equal(count(booklet, /class="sheet ob-sheet ob-single"/gu), 8);
  assert.doesNotMatch(booklet, /class="[^"]*(?:text-staged|text-top|blank)|제본을 위한 빈 쪽/u);
  const range = getPrintHTML(book, {layout: 'single', pages: '2-4'}, []);
  assert.equal(count(range, /<section class="sheet /gu), 3);
  assert.deepEqual([...range.matchAll(/data-opening="(\d+)"/gu)].map(m => Number(m[1])), [2, 3, 4]);
  assert.equal(count(getPrintHTML(book, {pages: 'cover'}, []), /<section class="sheet /gu), 1);
  assert.throws(() => getPrintHTML(book, {pages: '7-9'}, []), /출력 펼침은 all, cover 또는 1부터 8까지/u);
  // Level floors and the minimum.
  assert.deepEqual(OPENING_FONT_FLOORS, {K2: 14, K3: 13, K4: 12});
  assert.equal(OPENING_MIN_FONT, 11);
  assert.match(getPrintHTML(openingsBook({ko: 'K4', en: 'E4'}), {}, []), /data-font-floor="12"/u);
  assert.match(getPrintHTML(openingsBook({ko: 'K3', en: 'E3'}), {}, []), /data-font-floor="13"/u);
});

test('R12-P7 recommended layout: single; 크게 읽기 for K4 and for E3/E4 bilingual or English prints; page books single', () => {
  assert.equal(recommendedPrintLayout(openingsBook()), 'single');
  assert.equal(recommendedPrintLayout(openingsBook({ko: 'K4', en: 'E2'})), 'two');
  assert.equal(recommendedPrintLayout(openingsBook({ko: 'K2', en: 'E3'})), 'two');
  assert.equal(recommendedPrintLayout(openingsBook({ko: 'K2', en: 'E4', language: 'ko'})), 'single');
  assert.equal(recommendedPrintLayout(openingsBook({ko: 'K2', en: 'E3'}), 'ko'), 'single');
  assert.equal(recommendedPrintLayout(clone(LEGACY)), 'single');
  // The app's print dialog branches on the layout and preselects the recommended one.
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(layoutOf\(b\) === "openings"\) return showOpeningsPrintOptions\(b\);/u);
  assert.match(app, /stored === "single" \? recommendedPrintLayout\(b, language\)/u);
  assert.match(app, /<label for="p-pages">출력 펼침<\/label>/u);
  // A page book prints exactly as before (the P0 pin hashes every variant).
  const legacy = getPrintHTML(clone(LEGACY), {layout: 'single'}, []);
  assert.doesNotMatch(legacy, /ob-sheet|data-font-floor/u);
});

test('R12-P7 the Chromium fit measurement (QA/r12-print-fit.json) passed every case', () => {
  const report = JSON.parse(readFileSync(new URL('../QA/r12-print-fit.json', import.meta.url), 'utf8'));
  assert.equal(report.passed, true, report.problems.join('\n'));
  assert.deepEqual(report.cases.map(c => c.name), ['single K2 12×7', 'single K2 15×7', 'single K2 17×7', 'single K3 15×10', 'single K2+E2 15 sentences', 'single K2+E3', '크게 읽기 K4 16×13', '크게 읽기 K4+E4']);
  for (const row of report.cases) {
    assert.equal(row.fonts.length, 1, row.name);
    assert.ok(row.fonts[0] >= row.floor - 0.01, `${row.name} ${row.fonts[0]}`);
    assert.equal(row.printEnabled, true, row.name);
    assert.ok(row.phoneOverflowX <= 1, row.name);
    for (const opening of row.openings) {
      assert.deepEqual(opening.folios, [2 * opening.opening - 1, 2 * opening.opening], row.name);
      if (opening.kind === 'spread' && row.layout === 'single') {
        assert.ok(opening.artHeightMm >= row.singleArtMm - 0.5, `${row.name} ${opening.opening}`);
        assert.ok(opening.topDeltaMm <= 0.5 && opening.foldGapMm <= 0.5, `${row.name} ${opening.opening}`);
      }
    }
  }
});
