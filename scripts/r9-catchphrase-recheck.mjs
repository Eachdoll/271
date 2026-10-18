/** R9-A3 read-only recheck of paid r7 outputs with the new catchphrase checks. Never calls a model or rewrites results. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plotCheck } from '../story-quality/dist/plotCheck.js';
import { catchphraseCore, catchphraseRepeats, isCatchphraseFix, sharesCore } from '../story-quality/dist/catchphrase.js';
import { checkStory } from '../dist/story-generation/checker.js';
import { repeatsCatchphrase } from '../dist/story-generation/quality-adapter.js';
import { freezeReadingLevels } from '../dist/reading-levels.js';

globalThis.fetch = () => { throw Error('Offline verification: network is disabled.'); };
const root = fileURLToPath(new URL('../', import.meta.url));
const trial = 'story-quality/eval/trial-2026-10-17';
const sources = {
  outlines: resolve(root, trial, 'sonnet55-r7.jsonl'),
  prose: resolve(root, trial, 'sonnet55-r7-prose-condense.jsonl'),
  distilled: resolve(root, 'dist/story-quality/examples/approved-books.json'),
};
const output = resolve(root, process.argv[2] || 'QA/r9-catchphrase-recheck.json');
if (Object.values(sources).includes(output)) throw Error('Output must not overwrite the paid source data.');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const bytes = Object.fromEntries(Object.entries(sources).map(([key, path]) => [key, readFileSync(path)]));
const jsonl = (data) => data.toString('utf8').trim().split('\n').map((line) => JSON.parse(line));

// The r7 runs used the CLI's old hardcoded protagonist catchphrase; 초록이 had none.
const CATCHPHRASES = ['같이 가자!'];
const PROTAGONIST = '유하';

const outlineRows = jsonl(bytes.outlines).map((row) => {
  const outline = row.outline || {};
  const summaries = (outline.beats || []).map((beat) => beat.summary || '');
  const refrain = outline.refrain?.text || '';
  const beatsOnly = catchphraseRepeats(summaries, CATCHPHRASES, 1)[0];
  const check = plotCheck({ outline, topic: row.topic, protagonistName: PROTAGONIST, catchphrases: CATCHPHRASES });
  const fixes = check.fix.filter(isCatchphraseFix);
  return {
    topicId: row.topicId,
    beatOccurrences: beatsOnly?.count || 0,
    beatsWithPhrase: (beatsOnly?.at || []).map((index) => outline.beats[index]?.index ?? index + 1),
    refrain,
    refrainSharesCatchphrase: CATCHPHRASES.some((phrase) => sharesCore(refrain, phrase)),
    repeatFix: fixes.some((message) => message.startsWith('말버릇')),
    refrainFix: fixes.some((message) => message.startsWith('후렴')),
    flagged: fixes.length > 0,
    // R9 fix: with only catchphrase items (and nothing to regenerate) the app buys no fix pass.
    catchphraseOnly: fixes.length > 0 && fixes.length === check.fix.length && check.regenerate.length === 0,
    fixes,
  };
});

const specs = freezeReadingLevels({ koreanLevel: 'K1', englishLevel: 'E0' }).specs;
const outlineByTopic = new Map(jsonl(bytes.outlines).map((row) => [row.topicId, row.outline]));
const proseRows = jsonl(bytes.prose).map((row) => {
  const result = { topicId: row.topicId };
  for (const language of ['ko', 'en']) {
    const texts = row[language]?.pageTexts;
    if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) throw Error(`Missing saved pageTexts: ${row.topicId}/${language}`);
    const pages = texts.map((text, index) => ({ pageNo: index + 1, [language === 'ko' ? 'textKo' : 'textEn']: text }));
    // The app checker (advisory warning) and the shared helper must agree.
    const report = checkStory(outlineByTopic.get(row.topicId), { pages }, { specs, catchphrases: CATCHPHRASES });
    const warning = report.warnings.find((item) => item.code === 'catchphrase-repeat' && item.language === language);
    const hit = catchphraseRepeats(texts, CATCHPHRASES, 1)[0];
    if ((warning?.count || 0) !== (hit && hit.count >= 2 ? hit.count : 0)) throw Error(`App/package catchphrase count drift: ${row.topicId}/${language}`);
    result[language] = { pages: texts.length, occurrences: hit?.count || 0, pagesWithPhrase: (hit?.at || []).map((index) => index + 1), advisory: !!warning };
  }
  return result;
});

const distilled = JSON.parse(bytes.distilled.toString('utf8'));
const count = (rows, predicate) => rows.filter(predicate).length;
const summary = {
  catchphrases: CATCHPHRASES,
  core: CATCHPHRASES.map(catchphraseCore),
  outlines: {
    books: outlineRows.length,
    beatsTwoOrMore: count(outlineRows, (row) => row.beatOccurrences >= 2),
    repeatFix: count(outlineRows, (row) => row.repeatFix),
    refrainOverlap: count(outlineRows, (row) => row.refrainSharesCatchphrase),
    flagged: count(outlineRows, (row) => row.flagged),
    catchphraseOnlyNoFixPass: count(outlineRows, (row) => row.catchphraseOnly),
    maxBeatOccurrences: Math.max(0, ...outlineRows.map((row) => row.beatOccurrences)),
    meanBeatOccurrences: Math.round((outlineRows.reduce((sum, row) => sum + row.beatOccurrences, 0) / outlineRows.length) * 100) / 100,
  },
  prose: Object.fromEntries(['ko', 'en'].map((language) => [language, {
    books: proseRows.length,
    twoOrMore: count(proseRows, (row) => row[language].occurrences >= 2),
    advisoryWarnings: count(proseRows, (row) => row[language].advisory),
    anyUse: count(proseRows, (row) => row[language].occurrences >= 1),
    maxOccurrences: Math.max(0, ...proseRows.map((row) => row[language].occurrences)),
  }])),
  distilledExamples: {
    books: distilled.length,
    skippedWhenOptedIn: count(distilled, (book) => repeatsCatchphrase(book)),
    kept: count(distilled, (book) => !repeatsCatchphrase(book)),
  },
};
const result = {
  version: 1,
  purpose: 'R9-A3 offline recheck of paid r7 outlines and condensed prose with the new catchphrase checks (core match, at most once per book). No model calls; source files are read-only.',
  sources: Object.fromEntries(Object.entries(sources).map(([key, path]) => [key, { path: path.slice(root.length), sha256: sha256(bytes[key]) }])),
  rules: {
    outline: 'plotCheck fix when a catchphrase occurs 2+ times across beat summaries + refrain, or when the refrain shares its core phrase. Messages list "비트 N" per beat.',
    outlineAdvisory: 'App quality outline: catchphrase items are advisories. With only catchphrase items (catchphraseOnlyNoFixPass, rechecked without seed/ban data) no paid fix pass is made; mixed with other items they ride along in the one fix pass. Drafts frozen without a catchphrasePolicy keep the pre-R9 prompts and get no catchphrase plot check.',
    prose: 'checkStory advisory warning (never a violation) when a catchphrase occurs 2+ times across a language\'s page texts.',
    distilled: 'Opt-in distilled examples are skipped when "같이 가자" or a cast catchphrase occurs 2+ times in beats + refrain.',
  },
  summary,
  outlines: outlineRows,
  prose: proseRows,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
for (const [key, path] of Object.entries(sources)) if (sha256(readFileSync(path)) !== sha256(bytes[key])) throw Error(`Source changed during recheck: ${key}`);
console.log(JSON.stringify(summary, null, 2));
