/*
 * Page rhythm (2026-10-19): a picture book lets pages breathe. A page whose
 * picture tells the moment has few words; a page where the words carry the
 * moment has more. New drafts freeze `rhythm` in their level specs
 * (inputFromWizard). For those specs:
 *   - one page (or opening unit) may hold 1/3 of its usual minimum (at least
 *     one sentence) up to 1.6 × its usual maximum;
 *   - the whole book's sentence total, per language, stays within ±20% of the
 *     sum of the usual per-page targets.
 * Sentence length, vocabulary and grammar stay per sentence. E1 keeps its one
 * sentence per page (a rule of its own) and E0 keeps its 1–2; every spec
 * without `rhythm` (all existing drafts and books) is judged as before.
 */
import { unitKind, unitSpec } from "./book-layout.js";
import { splitSentences } from "./story-quality/dist/util.js";

export const PAGE_RHYTHM = Object.freeze({
  version: 1,
  bookTolerance: 0.2,
  pageMinShare: 1 / 3,
  pageMaxFactor: 1.6,
});
const EXCLUDED = new Set(["E0", "E1"]);
/** Frozen copy of the level specs with `rhythm` on each language that takes it. */
export function withPageRhythm(specs) {
  const out = {};
  for (const [lang, spec] of Object.entries(specs || {}))
    out[lang] =
      spec && typeof spec === "object" && !EXCLUDED.has(spec.id)
        ? { ...spec, rhythm: { ...PAGE_RHYTHM } }
        : spec;
  return out;
}
export const hasRhythm = (spec) => spec?.rhythm?.version === 1;
const rangeOf = (spec) =>
  spec?.sentencesPerPageRange ||
  (typeof spec?.sentencesPerPage === "number"
    ? { min: spec.sentencesPerPage, max: spec.sentencesPerPage }
    : Array.isArray(spec?.sentencesPerPage)
      ? { min: spec.sentencesPerPage[0], max: spec.sentencesPerPage[1] }
      : null);
/** The per-page (per-unit) sentence band of a rhythm spec, else null. */
export function rhythmBand(spec) {
  if (!hasRhythm(spec)) return null;
  const range = rangeOf(spec);
  if (!range) return null;
  const r = spec.rhythm;
  return {
    min: Math.max(1, Math.floor(range.min * (r.pageMinShare ?? 1 / 3))),
    max: Math.max(range.max, Math.ceil(range.max * (r.pageMaxFactor ?? 1.6))),
  };
}
/** The usual sentence count of one page or unit (an opening unit's target, else the range middle). */
export function usualSentences(spec) {
  if (spec?.unit && typeof spec.sentencesPerPage === "number")
    return spec.sentencesPerPage;
  const range = rangeOf(spec);
  return range ? (range.min + range.max) / 2 : 0;
}
/** Whole-book budget of one language for these pages: {target, min, max}. */
export function bookBudget(spec, pages) {
  if (!hasRhythm(spec)) return null;
  const target = (pages || []).reduce(
    (sum, page) => sum + usualSentences(unitSpec(spec, unitKind(page))),
    0,
  );
  const tol = spec.rhythm.bookTolerance ?? 0.2;
  return {
    target: Math.round(target * 10) / 10,
    min: Math.floor(target * (1 - tol)),
    max: Math.ceil(target * (1 + tol)),
  };
}
const label = (lang) => (lang === "ko" ? "Korean" : "English");
/** The prompt line for a rhythm draft ("" otherwise). */
export function rhythmPromptLine(specs) {
  const parts = [];
  for (const lang of ["ko", "en"]) {
    const spec = specs?.[lang];
    if (!hasRhythm(spec)) continue;
    const kinds = spec.units ? ["page", "spread"] : ["page"];
    const ranges = kinds.map((kind) => {
      const unit = unitSpec(spec, kind),
        band = rhythmBand(unit),
        usual = rangeOf(unit);
      return `${spec.units ? `${kind} ` : ""}${band.min}–${band.max} sentences (usual ${usual.min}–${usual.max})`;
    });
    parts.push(`${label(lang)}: ${ranges.join("; ")}`);
  }
  if (!parts.length) return "";
  return `PAGE RHYTHM (this book): like a real picture book, page lengths may vary with the picture. A page whose picture tells the moment (a big action, a wordless surprise, a quiet ending) may use only a few sentences; a page where words must carry the moment (a plan, a feeling, a sound the picture cannot show, a turn in the story) may use more. Per page: ${parts.join(" / ")}. Keep each language's whole-book sentence total within ±20% of the usual total. Never three very short pages in a row; give the turn and the climax enough words. Sentence length, vocabulary and grammar limits apply to every sentence as before. When a page has few words, its scene.action must show everything the words leave out (the action, the faces, the key prop).`;
}
/**
 * True when a rhythm book's page is clearly shorter than usual (at most half of
 * its usual sentences) in its main language: the picture must carry the moment.
 */
export function pictureCarriesPage(specs, page) {
  const lang = hasRhythm(specs?.ko) ? "ko" : hasRhythm(specs?.en) ? "en" : null;
  if (!lang || !page) return false;
  const spec = unitSpec(specs[lang], unitKind(page)),
    text = lang === "ko" ? (page.ko ?? page.textKo) : (page.en ?? page.textEn),
    count = splitSentences(String(text || "")).length;
  return count > 0 && count <= usualSentences(spec) / 2;
}
