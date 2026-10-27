import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {getPrintHTML, feedbackImageSources, FEEDBACK_NOTE, FEEDBACK_MAX_SIDE, FEEDBACK_JPEG_QUALITY} from '../dist/output.js';

/**
 * 2026-10-27 R39-F 저용량 피드백판. The parent: "a print at lower resolution
 * so I can share a small feedback copy of the book (for review) — the file
 * is over 30 MB when I try to give it to Claude." The print dialogs gain a
 * quality choice: 'feedback' opens the same print HTML with every picture
 * shrunk (longest side 640 px, JPEG) to a data URL, under a note that it is
 * for review and sharing, never for printing; a button saves the same HTML
 * as one file. getPrintHTML takes the shrunk pictures as
 * settings.imageSources (URL → data URL); without them the print is byte
 * for byte what it was (the P0 print pin).
 */
const clone = value => JSON.parse(JSON.stringify(value));
const LEGACY = JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8'));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/shrunk';
function openingsBook() {
  const base = clone(LEGACY);
  const input = normalizeStoryInput({...base.storyInput, layoutPolicy: L.openingsLayoutPolicy(), specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, {}, {layout: 'openings'}).specs, pageCount: 16});
  const prose = demoProse(base.outline, input), pagination = demoPagination(base.outline, prose, input);
  return {...base, language: 'bilingual', storyInput: input, prose, pagination, pages: toLegacyPages(pagination).map(page => ({...page, imageUrl: PNG})), cover: {imageUrl: PNG}};
}
const pageBook = () => ({...clone(LEGACY), pages: clone(LEGACY).pages.map(page => ({...page, imageUrl: PNG})), cover: {imageUrl: PNG}});
const count = (html, pattern) => [...html.matchAll(pattern)].length;

test('R39-F the feedback edition: the shrunk pictures replace every page and cover picture, the note is shown, and a print without the option is unchanged (page books and openings books)', () => {
  for (const [label, book] of [['page book', pageBook()], ['openings book', openingsBook()]]) {
    const plain = getPrintHTML(book, {layout: 'single'}, []);
    assert.ok(count(plain, /src="data:image\/png;base64,/gu) >= 2, `${label}: the originals`);
    assert.doesNotMatch(plain, /print-feedback-note/);
    const feedback = getPrintHTML(book, {layout: 'single', quality: 'feedback', imageSources: {[PNG]: JPG}}, []);
    assert.equal(count(feedback, /src="data:image\/png;base64,/gu), 0, `${label}: no original is left`);
    assert.equal(count(feedback, /src="data:image\/jpeg;base64,\/9j\/shrunk"/gu), count(plain, /src="data:image\/png;base64,/gu), `${label}: one shrunk picture per original`);
    assert.match(feedback, new RegExp(`<p class="print-warning print-feedback-note">${FEEDBACK_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`));
    assert.equal(getPrintHTML(book, {layout: 'single', quality: 'nope', imageSources: 'x'}, []), plain, `${label}: an unknown quality and a bad map are ignored`);
    // The sources alone swap the pictures; the note belongs to the quality.
    assert.doesNotMatch(getPrintHTML(book, {layout: 'single', imageSources: {[PNG]: JPG}}, []), /print-feedback-note/);
  }
  // A text-only page keeps its flat colour (it has no picture to shrink).
  const book = pageBook(); book.pages[2].backdrop = 'none';
  const html = getPrintHTML(book, {layout: 'single', quality: 'feedback', imageSources: {[PNG]: JPG}, pages: '3'}, []);
  assert.match(html, /data:image\/svg\+xml/);
  assert.doesNotMatch(html, /\/9j\/shrunk/);
});

test('R39-F outside a browser the shrinking yields nothing and the constants are what the dialog promises; both print dialogs offer the quality choice and the file button', async () => {
  assert.deepEqual(await feedbackImageSources(pageBook()), {});
  assert.equal(FEEDBACK_MAX_SIDE, 640);
  assert.ok(FEEDBACK_JPEG_QUALITY > 0.3 && FEEDBACK_JPEG_QUALITY < 0.8);
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.equal(count(app, /"p-quality",\n\s+"화질"/gu), 2, 'the page-book and the openings dialogs');
  assert.equal(count(app, /data-action="print-feedback-file"/gu), 2);
  assert.match(app, /if \(s\.quality === "feedback"\) printFeedbackBook\(b, s, state\.characters\)/);
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v8[8-9]";/);
});
