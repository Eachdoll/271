import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {facingPageLine} from '../dist/image-generation/scene-prompt.js';
import {storyLogicOutlineRule} from '../dist/story-generation/story-logic.js';
import {POCKET_CSS, POCKET_PLACE_SOURCE, POCKET_SAMPLER_SCRIPT} from '../dist/text-pocket.js';

/**
 * R48 (2026-10-31). The parent's printed bilingual K2 book (뽀글머리) had the
 * sampled wall colour painted over the top 45% of spreads and most of each
 * left half: the R40 sampler's whole-field guess (sd ≤ 0.09) took a cream
 * wall for an empty field and the R47 fit grew that field into the art. Now
 * the words wait under the picture; the placer measures the picture's edge
 * strip by strip and moves the words up only where the edge is empty and
 * they fit (all, or the Korean alone), never painting over art, never
 * shrinking the font. Each page of a pair is asked to be a different moment
 * from its facing page, and the outline hears that no prop is in every beat.
 */
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('R48 the placer: an empty panel until the edge is measured, no card painted over art, no font change', () => {
  assert.match(POCKET_CSS, /\.text-pocket\{[^}]*display:none/);
  assert.match(POCKET_CSS, /\.pocket-on \.text-pocket\{display:flex\}/);
  assert.doesNotMatch(POCKET_CSS, /background:[^;}]*rgba\(|backdrop-filter/, 'no translucent card');
  for (const step of ['function pocketFlatEdge(img,side,crop)', 'function giveBack(', 'DOCUMENT_POSITION_PRECEDING', "host.classList.add('pocket-on')", "'pocket-split'", 'data-pocket-words', 'function placePockets(root)']) assert.ok(POCKET_PLACE_SOURCE.includes(step), step);
  assert.doesNotMatch(POCKET_PLACE_SOURCE, /grow\(|fontSize=|style\.background/);
  assert.match(POCKET_SAMPLER_SCRIPT, /window\.__placePockets=placePockets/);
  assert.match(POCKET_SAMPLER_SCRIPT, /window\.__resetPockets/);
  assert.match(POCKET_SAMPLER_SCRIPT, /window\.__notePockets/);
  assert.match(POCKET_SAMPLER_SCRIPT, /그림이 글 자리를 비워 두지 않아 글을 그림 아래에 두었어요/);
  // The three hosts: the reader page, the print page leaf and the opening leaf carry the words block.
  assert.match(src('../dist/app.js'), /<div class="reader-page"\$\{pocketHost\}>/);
  assert.match(src('../dist/app.js'), /pocketHost = hasTextPocket\(b\.storyInput\) \? " data-pocket-host" : ""/, 'other books keep the R12 reader markup');
  assert.match(src('../dist/app.js'), /<div class="reader-words" data-pocket-words>\$\{words\}<\/div>/);
  const out = src('../dist/output.js');
  assert.match(out, /text-pocket-leaf" aria-label="\$\{[^}]+\}쪽" data-pocket-host>/);
  assert.match(out, /<div class="story" data-pocket-words>/);
  assert.match(out, /<div class="ob-text"\$\{pocket \? " data-pocket-words" : ""\}>/);
  assert.match(out, /\.text-pocket-leaf\.pocket-on:not\(\.pocket-split\) \.story\{display:none\}/, 'the story card hides only when all the words moved up');
  const css = src('../dist/style.css');
  assert.match(css, /\.pocket-on \.text-pocket\{display:flex\}/);
  assert.doesNotMatch(css, /\.pocket-flat/);
});

test('R48 a pair of pages: each page of an opening is told what its facing page shows', () => {
  const book = {pages: [
    {kind: 'page', pageNo: 3, openingNo: 2, scene: {action: 'Yuha holds the hand mirror up to the braid.'}},
    {kind: 'page', pageNo: 4, openingNo: 2, en: 'Haeni peeks from behind the chair.'},
    {kind: 'page', pageNo: 5, openingNo: 3},
    {kind: 'spread', pageNo: 6, openingNo: 4},
  ]};
  assert.match(facingPageLine(book, book.pages[0]), /^FACING PAGE \(the other page of this opening\) shows: Haeni peeks from behind the chair\. This page is a clearly different moment/);
  assert.match(facingPageLine(book, book.pages[1]), /shows: Yuha holds the hand mirror up to the braid\./);
  assert.equal(facingPageLine(book, book.pages[2]), '', 'a page alone in its opening');
  assert.equal(facingPageLine(book, book.pages[3]), '', 'a spread');
  assert.equal(facingPageLine(book, null), '');
  assert.match(src('../dist/image-generation/scene-prompt.js'), /facing = framed && !cover \? facingPageLine\(book, page\) : ""/);
});

test('R48 the outline hears that no prop is in every beat', () => {
  const rule = storyLogicOutlineRule({storyLogic: {version: 1}, promptDiet: {version: 1}});
  assert.match(rule, /No one thing is in every beat: a prop that matters comes back in some beats and rests in the others/);
  assert.equal(storyLogicOutlineRule({promptDiet: {version: 1}}), '');
});
