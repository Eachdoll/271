/** Read-only local recheck of paid r7 outputs. Never generates or rewrites prose. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEstimatedPage, splitSentences } from '../dist/reading-checker.js';
import { freezeReadingLevels } from '../dist/reading-levels.js';
import { countSentences } from '../story-quality/dist/richThenSimplify.js';

globalThis.fetch = () => { throw Error('Offline verification: network is disabled.'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'story-quality/eval/trial-2026-10-17/sonnet55-r7-prose-condense.jsonl');
const output = resolve(root, process.argv[2] || 'QA/r8-offline-recheck.json');
if (source === output) throw Error('Output must not overwrite the paid source data.');
const bytes = readFileSync(source), sha256 = data => createHash('sha256').update(data).digest('hex');
const sourceHash = sha256(bytes);
const rows = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
const snapshot = freezeReadingLevels({ koreanLevel: 'K1', englishLevel: 'E0' });
const total = (values) => values.reduce((sum, value) => sum + value, 0);
const round = value => Math.round(value * 100) / 100;
function stats(checks) {
  const violations = {}, warnings = {}, grammarWords = {};
  let minimumLengthViolations = 0, maximumLengthViolations = 0;
  for (const check of checks) {
    for (const issue of check.violations || []) {
      violations[issue.code] = (violations[issue.code] || 0) + 1;
      if (issue.code === 'sentence-length') {
        if (issue.actual < issue.expected.min) minimumLengthViolations++;
        if (issue.actual > issue.expected.max) maximumLengthViolations++;
      }
      if (issue.code === 'grammar') for (const word of String(issue.actual).split(', ')) grammarWords[word] = (grammarWords[word] || 0) + 1;
    }
    for (const warning of check.warnings || []) warnings[warning.code] = (warnings[warning.code] || 0) + 1;
  }
  return {
    pages: checks.length, pagesPassed: checks.filter(check => check.passed).length,
    sentenceCount: total(checks.map(check => check.metrics.sentenceCount)),
    zeroWordFragments: total(checks.map(check => check.metrics.wordsPerSentence.filter(count => count === 0).length)),
    minimumLengthViolations, maximumLengthViolations, violations, warnings, grammarWords,
  };
}
const books = rows.map(row => {
  const book = { topicId: row.topicId, topic: row.topic };
  for (const language of ['ko', 'en']) {
    const texts = row[language].pageTexts;
    if (!Array.isArray(texts) || !texts.length || texts.some(text => typeof text !== 'string')) throw Error(`Missing saved pageTexts: ${row.topicId}/${language}`);
    const checks = texts.map(text => analyzeEstimatedPage(text, snapshot.specs[language], {
      language, allowedNames: ['유하', 'Yuha', '초록이', 'Choroki'],
    }));
    for (const text of texts) if (splitSentences(text).length !== countSentences(text)) throw Error('App/package sentence-count drift');
    book[language] = {
      before: stats(row[language].checks), after: stats(checks),
      originalStoredWholeProseSentenceCount: row[language].sentences,
      originalPackageSentenceCount: row[language].packageSentenceCount,
      newPackageWholeProseSentenceCount: countSentences(row[language].simplified),
      pageChecks: checks,
    };
  }
  return book;
});
const summary = {};
for (const language of ['ko', 'en']) {
  summary[language] = {};
  for (const version of ['before', 'after']) {
    const values = books.map(book => book[language][version]), violations = {}, grammarWords = {};
    for (const value of values) {
      for (const [code, count] of Object.entries(value.violations)) violations[code] = (violations[code] || 0) + count;
      for (const [word, count] of Object.entries(value.grammarWords)) grammarWords[word] = (grammarWords[word] || 0) + count;
    }
    summary[language][version] = {
      sentenceMean: round(total(values.map(value => value.sentenceCount)) / books.length),
      pagesPassed: total(values.map(value => value.pagesPassed)), pages: total(values.map(value => value.pages)),
      zeroWordFragments: total(values.map(value => value.zeroWordFragments)),
      minimumLengthViolations: total(values.map(value => value.minimumLengthViolations)),
      maximumLengthViolations: total(values.map(value => value.maximumLengthViolations)),
      violations, grammarWords,
    };
  }
}
const result = {
  verification: 'Offline recheck of identical saved pageTexts; no generation or paid model calls.',
  source: 'story-quality/eval/trial-2026-10-17/sonnet55-r7-prose-condense.jsonl', sourceSha256: sourceHash,
  sourceUnchanged: sha256(readFileSync(source)) === sourceHash,
  bookCount: books.length, paidCalls: 0, networkCalls: 0, readingLevelSnapshot: snapshot,
  pagination: { approximate: true, reusedUnchanged: true, realAiPaginationRun: false },
  childGate: { reusedUnchanged: true, reevaluated: false, pass: rows.filter(row => row.child?.pass).length },
  interpretation: 'Differences are checker fixes on the same text, not improved generation or a new child-simulator score. Quote attribution is punctuation segmentation, not full syntax parsing.',
  summary, books,
};
if (!result.sourceUnchanged) throw Error('Source changed during recheck.');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, bookCount: result.bookCount, sourceUnchanged: result.sourceUnchanged, paidCalls: 0, summary }, null, 2));
