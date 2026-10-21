/*
 * K1 짧은 문장 규격 (2026-10-21, R31a). A golden K1 manuscript ("유하와 해니,
 * 노란 버스") measured 3.0 eojeol per sentence on average and failed the old
 * K1 check on 4 of 12 pages: "부릉부릉! 띠리릭!", "해니가 왔어요.", "유치원이
 * 코앞." are what a K1 picture book sounds like, and the fix passes rewrote
 * them into stiff 3-eojeol sentences. New K1 drafts freeze
 * `spec.shortSentences` on the Korean spec (withShortSentences in
 * inputFromWizard); only such a spec is judged as below, every other spec
 * (older drafts, books, other levels) exactly as before.
 *
 *  1. Rhythm lines — a sentence of at most 2 eojeol that is a sound word, an
 *     exclamation or a short quoted line — are exempt from the length rules
 *     and the sentence count, up to 3 per page (more count as ordinary).
 *  2. Ordinary sentences are judged by the page average (2.5–5 eojeol: the
 *     golden pages average 2.67 at their lowest); a single sentence may be 1
 *     eojeol, never longer than the level maximum.
 *  3. A page has 1–4 ordinary sentences.
 *  4. An ellipsis followed by more text ("놀고 싶은데… 유하가 …") ends a
 *     sentence.
 */
import { isSoundOnlySentence } from "./reading-checker.js";

export const SHORT_SENTENCES = Object.freeze({
  version: 1,
  rhythmMaxWords: 2,
  rhythmMaxPerPage: 3,
  pageAverage: Object.freeze({ min: 2.5, max: 5 }),
  pageSentences: Object.freeze({ min: 1, max: 4 }),
});
export const hasShortSentences = (spec) => spec?.shortSentences?.version === 1;
/** Frozen copy of the specs with the K1 Korean spec carrying the policy. */
export function withShortSentences(specs) {
  const out = { ...(specs || {}) };
  const ko = out.ko;
  if (ko && typeof ko === "object" && ko.id === "K1" && !ko.units)
    out.ko = { ...ko, shortSentences: JSON.parse(JSON.stringify(SHORT_SENTENCES)) };
  return out;
}
/** Split each sentence again after an ellipsis that is followed by more text. */
export function splitAtEllipsis(sentences) {
  return sentences.flatMap((sentence) =>
    String(sentence)
      .split(/(?<=…|\.\.\.)\s+(?=\S)/u)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}
/** Indexes of the rhythm lines among a page's sentences (the first `rhythmMaxPerPage`). */
export function rhythmSentenceIndices(sentences, lengths, spec) {
  const policy = spec?.shortSentences || SHORT_SENTENCES,
    out = [];
  sentences.forEach((sentence, index) => {
    if (out.length >= policy.rhythmMaxPerPage) return;
    const text = String(sentence).trim();
    if (!(lengths[index] >= 1 && lengths[index] <= policy.rhythmMaxWords)) return;
    if (
      isSoundOnlySentence(text, spec?.id || "K1", "ko") ||
      /[!！]["'”’」]?\s*$/u.test(text) ||
      /["“'‘「]/u.test(text)
    )
      out.push(index);
  });
  return out;
}
/** The policy's sentence-count and length violations for one Korean page. */
export function shortSentenceViolations(metrics, spec) {
  const policy = spec.shortSentences,
    rhythm = new Set(metrics.rhythmSentenceIndices || []),
    core = metrics.wordsPerSentence
      .map((count, index) => ({ count, index }))
      .filter((row) => !rhythm.has(row.index)),
    out = [];
  if (core.length < policy.pageSentences.min || core.length > policy.pageSentences.max)
    out.push({
      code: "sentence-count",
      language: "ko",
      actual: core.length,
      expected: { ...policy.pageSentences },
      rhythmLines: rhythm.size,
    });
  for (const row of core)
    if (row.count > spec.wordsPerSentence.max)
      out.push({
        code: "sentence-length",
        language: "ko",
        sentenceIndex: row.index,
        actual: row.count,
        expected: { min: 1, max: spec.wordsPerSentence.max },
      });
  if (core.length) {
    const average = core.reduce((sum, row) => sum + row.count, 0) / core.length;
    if (average < policy.pageAverage.min || average > policy.pageAverage.max)
      out.push({
        code: "sentence-average",
        language: "ko",
        actual: Math.round(average * 100) / 100,
        expected: { ...policy.pageAverage },
      });
  }
  return out;
}
/** The prompt line for drafts whose Korean spec carries the policy. */
export function shortSentencePromptLine(specs) {
  if (!hasShortSentences(specs?.ko)) return "";
  const p = specs.ko.shortSentences;
  return `K1 SHORT LINES: rhythm lines of one or two eojeol (a sound word like "부릉부릉!", an exclamation like "우와!", a short quoted line like "안녕!") are welcome, up to ${p.rhythmMaxPerPage} per page, and do not count as sentences. The other Korean sentences on a page average ${p.pageAverage.min}–${p.pageAverage.max} eojeol (a single one may be very short, none longer than ${specs.ko.wordsPerSentence?.max ?? 5}); ${p.pageSentences.min}–${p.pageSentences.max} of them per page.`;
}
