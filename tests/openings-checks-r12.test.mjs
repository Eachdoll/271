import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {analyzeEstimatedPage, analyzeBook} from '../dist/reading-checker.js';
import {freezeReadingLevels, getLevelSpec} from '../dist/reading-levels.js';
import {describeReadingViolation} from '../dist/reading-messages.js';
import {unitSpec} from '../dist/book-layout.js';
import {checkStory} from '../dist/story-generation/checker.js';
import {checkRichness} from '../dist/story-generation/richness.js';
import {collectBookChecks} from '../dist/checks-panel.js';
import {renderStoryRichness} from '../dist/story-generation/ui.js';

/**
 * R12-P2: per-unit reading checks and per-opening richness for openings drafts.
 * The branch is chosen by the frozen v4 specs (spec.layout 'openings'), never by
 * the entries; page books keep today's results (the P0 'checks' pin proves it).
 */
const V4 = (ko, en) => freezeReadingLevels({koreanLevel: ko, englishLevel: en}, {}, {layout: 'openings'}).specs;
const K2E2 = V4('K2', 'E2'), K2E1 = V4('K2', 'E1'), K3E3 = V4('K3', 'E3');
/** A Korean sentence of n eojeol (no connective endings, no sound words). */
const ko = n => `${Array.from({length: n - 1}, () => '토끼가').join(' ')} 뛰어요.`;
const text = lengths => lengths.map(ko).join(' ');
const spread = spec => unitSpec(spec, 'spread');
const run = (lengths, spec = K2E2.ko) => analyzeEstimatedPage(text(lengths), spread(spec), {language: 'ko'});
const codes = result => result.violations.map(v => v.code);

test('R12-P2 K2 spread: 12 sentences with 3 short pass with exactly one combined note', () => {
  const result = run([6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 3]);
  assert.equal(result.passed, true);
  assert.deepEqual(codes(result), []);
  assert.equal(result.warnings.length, 1);
  const [note] = result.warnings;
  assert.equal(note.code, 'unit-length-note');
  assert.equal(note.advisory, true);
  assert.equal(note.offSentences, 3);
  assert.equal(note.unit, 'spread');
  assert.equal(describeReadingViolation(note), '한글 펼침면 참고 · 짧거나 긴 문장 3개 · 평균 5.3어절 · 문장 12개(권장 10~15)');
});

test('R12-P2 K2 unit length rules block: mean 4.2, 5 of 12 long, one over max+3, 8 sentences; 9 is a note', () => {
  // Mean 4.2 eojeol (below 5 − 0.5).
  const mean = run([4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 4]);
  assert.ok(codes(mean).includes('unit-mean-length'));
  assert.match(describeReadingViolation(mean.violations.find(v => v.code === 'unit-mean-length')), /평균 4\.2어절 \(허용 4\.5~7\.5어절\)/u);
  // 5 of 12 over 7 eojeol (allowed ceil(12/3) = 4).
  const long = run([8, 8, 8, 8, 8, 6, 6, 6, 6, 6, 5, 5]);
  assert.deepEqual(codes(long), ['unit-long-sentences']);
  assert.equal(long.violations[0].max, 4);
  // 4 of 12 long is fine.
  assert.deepEqual(codes(run([8, 8, 8, 8, 6, 6, 6, 5, 5, 5, 5, 5])), []);
  // One sentence of 11 eojeol (over 7 + 3).
  const veryLong = run([11, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5]);
  assert.deepEqual(codes(veryLong), ['unit-long-sentences']);
  assert.equal(veryLong.violations[0].longest, 11);
  // 10 eojeol is the hard limit and passes as a note.
  assert.deepEqual(codes(run([10, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5])), []);
  // 9 sentences: note only; 8: blocks; 17 a note; 18 blocks.
  const nine = run([6, 6, 6, 6, 6, 6, 6, 6, 6]);
  assert.equal(nine.passed, true);
  assert.equal(nine.warnings.length, 1);
  assert.match(describeReadingViolation(nine.warnings[0]), /문장 9개\(권장 10~15\)/u);
  assert.deepEqual(codes(run([6, 6, 6, 6, 6, 6, 6, 6])), ['unit-sentence-count']);
  assert.deepEqual(codes(run(Array(17).fill(6))), []);
  assert.deepEqual(codes(run(Array(18).fill(6))), ['unit-sentence-count']);
  // A note and a blocking violation coexist.
  assert.deepEqual(codes(long), ['unit-long-sentences']);
  assert.equal(long.warnings.length, 1);
  assert.equal(long.warnings[0].offSentences, 5);
});

test('R12-P2 page units and K3 advisory characters; K4 bands; connective endings and vocabulary still block', () => {
  const page = analyzeEstimatedPage(text([6, 6, 6, 6, 6, 6]), unitSpec(K2E2.ko, 'page'), {language: 'ko'});
  assert.equal(page.passed, true);
  assert.deepEqual(page.warnings, []);
  assert.deepEqual(codes(analyzeEstimatedPage(text([6, 6, 6]), unitSpec(K2E2.ko, 'page'), {language: 'ko'})), ['unit-sentence-count']);
  assert.deepEqual(codes(analyzeEstimatedPage(text(Array(9).fill(6)), unitSpec(K2E2.ko, 'page'), {language: 'ko'})), []);
  // K3: 7-10 eojeol; characters are advisory only (folded into the note).
  const shortWords = Array.from({length: 10}, () => `${Array(6).fill('새가').join(' ')} 와요.`).join(' ');
  const k3 = analyzeEstimatedPage(shortWords, spread(K3E3.ko), {language: 'ko'});
  assert.equal(k3.passed, true);
  assert.equal(k3.warnings.length, 1);
  assert.ok(k3.warnings[0].characters, 'K3 characters fold into the note');
  assert.match(describeReadingViolation(k3.warnings[0]), /자\(권장 280~700자\)/u);
  // K4 spread band 9-18.
  const k4 = V4('K4', 'E4').ko;
  assert.deepEqual(codes(run(Array(18).fill(11), k4)), []);
  assert.deepEqual(codes(run(Array(19).fill(11), k4)), ['unit-sentence-count']);
  // Connective endings stay blocking.
  const connective = analyzeEstimatedPage(`${text(Array(10).fill(6))} 토끼가 뛰고 웃으며 노래하면서 놀아요.`, spread(K2E2.ko), {language: 'ko'});
  assert.ok(codes(connective).includes('connective-endings'));
  // Out-of-vocabulary stays blocking when the parent supplied a list.
  const vocab = analyzeEstimatedPage(text(Array(12).fill(6)), spread(K2E2.ko), {language: 'ko', koVocabulary: ['뛰다']});
  assert.ok(codes(vocab).includes('out-of-vocabulary'));
});

test('R12-P2 English stays strict in openings books: E1 spread with 3 sentences and an E1 sentence of 7 words block', () => {
  const e1 = spread(K2E1.en);
  assert.deepEqual(codes(analyzeEstimatedPage('I see a cat. The cat can run.', e1, {language: 'en'})), []);
  assert.deepEqual(codes(analyzeEstimatedPage('I see a cat. The cat can run. It is fun.', e1, {language: 'en'})), ['sentence-count']);
  assert.deepEqual(codes(analyzeEstimatedPage('I see a big red cat run. The cat can run.', e1, {language: 'en'})), ['sentence-length']);
  // A single E1 page holds one sentence, and English never gets a combined note.
  const page = analyzeEstimatedPage('I see a cat. The cat can run.', unitSpec(K2E1.en, 'page'), {language: 'en'});
  assert.deepEqual(codes(page), ['sentence-count']);
  assert.deepEqual(page.warnings, []);
  // E3 words per unit: a spread allows 80-160 words.
  const e3 = V4('K2', 'E3').en;
  assert.deepEqual(unitSpec(e3, 'spread').wordsPerPage, [80, 160]);
  assert.deepEqual(unitSpec(e3, 'page').wordsPerPage, [40, 80]);
  // A pre-R12 spec is untouched by unitSpec and keeps today's sentence-length rule.
  const legacy = getLevelSpec('K2');
  assert.equal(unitSpec(legacy, 'spread'), legacy);
  assert.deepEqual(codes(analyzeEstimatedPage(text([6, 6, 3, 6]), legacy, {language: 'ko'})), ['sentence-count', 'sentence-length']);
});

// ---------- checkStory and analyzeBook over a small openings book ----------
const NAMES = ['유하', 'Yuha'];
const OUTLINE = {beats: [1, 2, 3, 4, 5, 6].map(index => ({index, type: index === 1 ? 'setup' : index === 4 ? 'turn' : index === 6 ? 'close' : 'attempt', summary: `비트 ${index}`}))};
const ACTION = 'Yuha walks across the garden path and lifts a red ball near the old fence';
const EN_SPREAD = 'Yuha sees a red ball. She runs to the ball now.', EN_PAGE = 'Yuha sees a red ball.';
/** 6 openings: openings 1, 4 and 6 spreads, the rest pairs (9 entries = 12 printed pages). */
function openingsPages({spreadKo = text(Array(12).fill(6)), pageKo = text(Array(6).fill(6))} = {}) {
  const out = [];
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const base = {beatIndex: k, openingNo: k, scene: {who: ['yuha'], where: 'garden', action: `${ACTION} ${k}`, emotion: 'calm', timeOfDay: 'day', props: ['ball']}};
    if ([1, 4, 6].includes(k)) out.push({...base, kind: 'spread', side: 'spread', entryId: `b${k}-spread`, cue: 'highlight', textKo: spreadKo.replace('토끼가', `${'토끼가 '.repeat(0)}토끼${k}가`), textEn: EN_SPREAD});
    else for (const side of ['left', 'right']) out.push({...base, kind: 'page', side, entryId: `b${k}-${side}`, cue: 'two-moments', textKo: pageKo.replace('토끼가', `토끼${k}${side === 'left' ? '왼' : '오'}가`), textEn: EN_PAGE});
  }
  return out.map((page, index) => ({...page, pageNo: index + 1}));
}

test('R12-P2 checkStory judges each unit by its kind; notes are warnings and never enter failedPageNos', () => {
  const pages = openingsPages({spreadKo: text([6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 3])});
  const report = checkStory(OUTLINE, {pages}, {specs: K2E2, allowedNames: NAMES});
  const level = report.checks.find(c => c.id === 'level');
  assert.equal(level.passed, true, JSON.stringify(level.violations));
  // Notes never become violations (other checks may still flag these demo-like pages).
  assert.ok(!report.violations.some(v => /참고/u.test(v.message)));
  assert.ok(report.warnings.every(w => w.code !== 'unit-length-note' || w.advisory === true));
  const notes = report.warnings.filter(w => w.code === 'unit-length-note');
  assert.deepEqual(notes.map(w => w.pageNo), [1, 6, 9]);
  // The same pages under today's (v3) K2 rules fail on every entry: 2-3 sentences per page.
  const legacy = checkStory(OUTLINE, {pages}, {specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}).specs});
  assert.equal(legacy.checks.find(c => c.id === 'level').passed, false);
  assert.ok(legacy.warnings.every(w => w.code !== 'unit-length-note'));
  // A blocking unit violation is a level failure on that entry only.
  const bad = openingsPages();
  bad[0] = {...bad[0], textKo: text(Array(8).fill(6))};
  const failing = checkStory(OUTLINE, {pages: bad}, {specs: K2E2, allowedNames: NAMES});
  assert.deepEqual(failing.checks.find(c => c.id === 'level').violations.map(v => v.pageNo), [1]);
  assert.match(failing.checks.find(c => c.id === 'level').violations[0].message, /한글 펼침면 문장 8개/u);
});

test('R12-P2 the turn window counts openings for openings specs (6 openings: 4-5); page books keep entry counting', () => {
  const pages = openingsPages();
  const report = checkStory(OUTLINE, {pages}, {specs: K2E2});
  const beat = report.checks.find(c => c.id === 'beat_mapping');
  assert.ok(!beat.violations.some(v => /반전/u.test(v.message)), JSON.stringify(beat.violations));
  // Turn on opening 3 is outside 4-5.
  const early = {beats: OUTLINE.beats.map(b => ({...b, type: b.index === 3 ? 'turn' : b.index === 4 ? 'attempt' : b.type}))};
  const moved = checkStory(early, {pages}, {specs: K2E2});
  assert.ok(moved.checks.find(c => c.id === 'beat_mapping').violations.some(v => v.message === '반전은 펼침 4~5에서 시작해야 해요.'));
  // The same entries under v3 specs count entries (9 entries → window 6-7; the turn is entry 6).
  const legacy = checkStory(OUTLINE, {pages}, {specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}).specs});
  assert.ok(!legacy.checks.find(c => c.id === 'beat_mapping').violations.some(v => /펼침/u.test(v.message)));
});

test('R12-P2 analyzeBook (book readingCheck) uses unit specs; checks panel and the page badge show one combined note', async () => {
  const pages = openingsPages({spreadKo: text([6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 3, 3])}).map(page => ({...page, ko: page.textKo, en: page.textEn}));
  const book = {pages, readingLevelSnapshot: {specs: K2E2}};
  const result = await analyzeBook(book, K2E2, {allowedNames: NAMES});
  assert.equal(result.passed, true, JSON.stringify(result.violations));
  assert.deepEqual(result.warnings.map(w => [w.code, w.pageIndex]), [['unit-length-note', 0], ['unit-length-note', 5], ['unit-length-note', 8]]);
  const groups = collectBookChecks({...book, readingCheck: result, storyCheck: checkStory(OUTLINE, {pages}, {specs: K2E2, allowedNames: NAMES})});
  const reading = groups.find(g => g.id === 'reading').items;
  // One item per unit and language, even though readingCheck and storyCheck both report it.
  assert.deepEqual(reading.map(item => item.pageNo), [1, 6, 9]);
  assert.match(reading[0].message, /^한글 펼침면 참고 · 짧거나 긴 문장 3개/u);
  // A legacy book is unchanged: the same pages with v3 specs fail per page.
  const legacy = await analyzeBook({pages}, freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}).specs);
  assert.equal(legacy.passed, false);
  assert.ok(legacy.warnings.every(w => w.code !== 'unit-length-note'));
});

// ---------- richness ----------
const CAST = [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'greenie', name: '초록이', nameEn: 'Choroki'}];
const entry = (pageNo, openingNo, kind, side, textKo, textEn) => ({pageNo, openingNo, beatIndex: openingNo, kind, side, entryId: `b${openingNo}-${side}`, textKo, textEn, scene: {props: []}});

test('R12-P2 missing subject exemptions in both languages; X도 and X만 are subjects; blocks only at 2+ and 25%+', () => {
  const pages = [
    entry(1, 1, 'spread', 'spread', '"멍!" 하며 초록이가 달려요. 초록이도 공을 따라가요. 유하만 집 앞에 남아요. 유하는 바람 소리를 들어요.', '"Come with me, Choroki!" Yuha said. Choroki runs to the ball. "Wait!" Yuha shouts by the door.'),
  ];
  const report = checkRichness({pages}, {specs: K2E2, characters: CAST}, {}, []);
  assert.ok(!report.issues.some(i => i.code === 'missing_subject'), JSON.stringify(report.issues));
  assert.ok(!report.advisories.some(i => i.code === 'missing_subject'), JSON.stringify(report.advisories));
  // Today's (v3) rules flag the same '"멍!" 하며 …' and '초록이도 …' text.
  const legacy = checkRichness({pages}, {specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}).specs, characters: CAST}, {}, []);
  assert.ok(legacy.issues.some(i => i.code === 'missing_subject' && i.language === 'ko'));
  // One subjectless narration sentence is advisory; two of six block.
  const one = [entry(1, 1, 'spread', 'spread', '유하가 공을 봐요. 유하가 웃어요. 공을 굴려요. 유하가 문을 열어요.', 'Yuha sees the ball.')];
  const oneReport = checkRichness({pages: one}, {specs: K2E2, characters: CAST}, {}, []);
  assert.ok(!oneReport.issues.some(i => i.code === 'missing_subject'));
  assert.ok(oneReport.advisories.some(i => i.code === 'missing_subject' && i.advisory === true));
  assert.ok(!oneReport.failedPageNos.includes(1) || oneReport.issues.some(i => i.pageNo === 1));
  const two = [entry(1, 1, 'spread', 'spread', '유하가 공을 봐요. 유하가 웃어요. 공을 굴려요. 문을 열어요. 유하가 걸어요. 유하가 앉아요.', 'Yuha sees the ball.')];
  assert.ok(checkRichness({pages: two}, {specs: K2E2, characters: CAST}, {}, []).issues.some(i => i.code === 'missing_subject'));
});

test('R12-P2 sensory, nouns and dialogue pool per opening; a pair whose right page has the sensory word passes', () => {
  const pages = [
    entry(1, 1, 'page', 'left', '유하가 우산을 들어요. 유하가 길을 걸어요.', 'Yuha holds the umbrella.'),
    entry(2, 1, 'page', 'right', '빗방울이 토독토독 떨어져요. 유하가 웃어요.', 'Raindrops splash on the umbrella.'),
  ];
  const report = checkRichness({pages}, {specs: K3E3, characters: CAST}, {}, []);
  assert.ok(!report.issues.some(i => i.code === 'sensory'), JSON.stringify(report.issues));
  assert.equal(report.layout, 'openings');
  assert.equal(report.summary.ko.openings, 1);
  // Today's per-page rule flags the left page.
  const legacy = checkRichness({pages}, {specs: freezeReadingLevels({koreanLevel: 'K3', englishLevel: 'E3'}).specs, characters: CAST}, {}, []);
  assert.ok(legacy.issues.some(i => i.code === 'sensory' && i.pageNo === 1));
  // No sensory word in the opening: the repair targets the entry with fewer hits (the first on a tie).
  const flat = [pages[0], {...pages[1], textKo: '유하가 집으로 가요. 유하가 웃어요.', textEn: 'Yuha goes home.'}];
  const flatReport = checkRichness({pages: flat}, {specs: K3E3, characters: CAST}, {}, []);
  assert.deepEqual(flatReport.issues.filter(i => i.code === 'sensory').map(i => [i.language, i.pageNo]), [['ko', 1], ['en', 1]]);
  // K2: no two consecutive openings without a sensory word (window by openings).
  const k2 = [
    entry(1, 1, 'spread', 'spread', '유하가 공을 봐요.', 'Yuha sees the ball.'),
    entry(2, 2, 'page', 'left', '유하가 문을 열어요.', 'Yuha opens the door.'),
    entry(3, 2, 'page', 'right', '유하가 집에 가요.', 'Yuha goes home.'),
  ];
  const window = checkRichness({pages: k2}, {specs: K2E2, characters: CAST}, {}, []);
  assert.deepEqual(window.issues.filter(i => i.code === 'sensory_window' && i.language === 'ko').map(i => i.pageNo), [2]);
  // Dialogue: ceil(O/3) openings at K2.
  assert.equal(window.summary.ko.requiredDialogueOpenings, 1);
  assert.deepEqual(window.issues.filter(i => i.code === 'dialogue_pages' && i.language === 'ko').map(i => i.pageNo), [1]);
});

test('R12-P2 repeated endings reset per unit and are advisory at 4+; direct emotion blocks; advisories stay out of failedPageNos', () => {
  const pages = [entry(1, 1, 'spread', 'spread', '"가자!" 유하가 말해요. 유하가 문을 열어요. 유하가 길을 걸어요. 유하가 공을 잡아요. 빗방울이 토독토독 떨어져요.', '"Go!" Yuha said. Yuha sees the wet ball by the tree.')];
  const report = checkRichness({pages}, {specs: K2E2, characters: CAST}, {}, []);
  assert.ok(!report.issues.some(i => i.code === 'repeated_ending'));
  const advisory = report.advisories.find(i => i.code === 'repeated_ending');
  assert.ok(advisory && advisory.advisory === true && advisory.severity === 'warning');
  assert.deepEqual(report.failedPageNos, []);
  assert.equal(report.valid, true, JSON.stringify(report.issues));
  // A run of 3 is not reported at all; a run across two entries does not continue.
  const split = [
    entry(1, 1, 'page', 'left', '"가자!" 유하가 말해요. 유하가 공을 봐요. 유하가 문을 열어요.', '"Go!" Yuha said.'),
    entry(2, 1, 'page', 'right', '빗방울이 토독토독 떨어져요. 유하가 꽃을 봐요. 유하가 웃어요.', 'Yuha sees the ball.'),
  ];
  assert.ok(!checkRichness({pages: split}, {specs: K2E2, characters: CAST}, {}, []).advisories.some(i => i.code === 'repeated_ending'));
  // Direct emotion blocks on its own entry.
  const sad = [entry(1, 1, 'spread', 'spread', '"가자!" 유하가 말해요. 유하는 기뻤어요. 빗방울이 토독토독 떨어져요.', '"Go!" Yuha said. Yuha sees the ball.')];
  const sadReport = checkRichness({pages: sad}, {specs: K2E2, characters: CAST}, {}, []);
  assert.ok(sadReport.issues.some(i => i.code === 'direct_emotion' && i.pageNo === 1));
  assert.deepEqual(sadReport.failedPageNos, [1]);
  // The pro richness card lists advisories apart; a legacy report renders as before.
  assert.match(renderStoryRichness(report), /참고\(자동으로 고치지 않아요\)/u);
  const legacyReport = checkRichness({pages}, {specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}).specs, characters: CAST}, {}, []);
  assert.equal(legacyReport.advisories, undefined);
  assert.doesNotMatch(renderStoryRichness(legacyReport), /참고\(자동으로/u);
});

// ---------- the offline recheck ----------
test('R12-P2 QA/r12-openings-recheck.json reproduces the measured unit pass rates and needs fewer rewrites than today', () => {
  const report = JSON.parse(readFileSync(new URL('../QA/r12-openings-recheck.json', import.meta.url), 'utf8'));
  assert.equal(report.paidCalls, 0);
  for (const source of report.sources) {
    const bytes = readFileSync(new URL(`../story-quality/eval/trial-2026-10-17/${source.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, `${source.file} changed; rerun scripts/r12-openings-recheck.mjs`);
  }
  const k2 = report.levels['K2/E2/rich'];
  assert.ok(Math.abs(k2.unitPassPercent.ko.spread - 55) <= 3, `spread ${k2.unitPassPercent.ko.spread}`);
  assert.ok(Math.abs(k2.unitPassPercent.ko.page - 65) <= 3, `page ${k2.unitPassPercent.ko.page}`);
  assert.ok(Math.abs(k2.unitPassPercent.ko.pairBothPages - 43) <= 3, `pair ${k2.unitPassPercent.ko.pairBothPages}`);
  for (const [key, row] of Object.entries(report.levels)) {
    assert.equal(row.expectedRewritesPerBook.newNeedsFewer.ko, true, `${key} ko`);
    assert.equal(row.expectedRewritesPerBook.newNeedsFewer.en, true, `${key} en`);
    assert.ok(row.richnessPerOpening.spreads.openings > 0 && row.richnessPerOpening.pairs.openings > 0);
  }
  assert.equal(report.newNeedsFewerEverywhere, true);
});
