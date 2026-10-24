/* 책 결 (R35, 2026-10-24): the overall composition a new book is written in.
 * The reference round (PICTURE_LED_DIRECTION_2026-10-24.md) measured a
 * picture-led picture book at a median of 1.5 sentences and 13 eojeol per
 * spread (1·4·3·6·3·1·9·1·7·1·2·1·6·1·1·1 sentences over 16 spreads), three
 * same-kind events each bigger than the last, two voices in short lines and
 * the turn told by the picture; our K2 openings asked for 10–15 sentences per
 * spread. The parent's decision: not the art style — the plot and the overall
 * composition become the default. 그림책 결 (pictureLed) is now the default of
 * every new draft: few sentences per opening, a single sound word allowed on
 * a big spread, the three-step composition in the outline request, and the
 * checks judge the level sentence by sentence while the lengths are judged
 * over the book. 글이 많은 책 (wordy) keeps today's budgets. Drafts, jobs and
 * books without a format are judged exactly as before. Pure: no DOM, no network. */
export const BOOK_FORMAT_VERSION = 1;
export const BOOK_FORMAT_IDS = Object.freeze(["pictureLed", "wordy"]);
export const BOOK_FORMAT_LABELS = Object.freeze({ pictureLed: "그림책 결", wordy: "글이 많은 책" });
export const BOOK_FORMAT_OPTIONS = Object.freeze([
  ["pictureLed", "그림책 결 · 글은 짧게, 그림이 말해요 (기본)"],
  ["wordy", "글이 많은 책 · 펼침마다 10문장 넘게 (예전 규격)"],
]);
/** Sentences per unit of a picture-led openings book (the reference: median 1.5, the big dialogue spread 9). */
export const PICTURE_LED_UNITS = Object.freeze({
  ko: Object.freeze({
    page: Object.freeze({ min: 1, max: 3, target: 1 }),
    spread: Object.freeze({ min: 1, max: 7, target: 2 }),
    opening: Object.freeze({ min: 1, max: 7, target: 2 }),
  }),
  en: Object.freeze({
    page: Object.freeze({ min: 1, max: 2, target: 1 }),
    spread: Object.freeze({ min: 1, max: 3, target: 1 }),
    opening: Object.freeze({ min: 1, max: 3, target: 1 }),
  }),
});
/**
 * The marker frozen on a picture-led spec, with what the checks read from it:
 * a Korean text is split at its "…" pauses too (they are read as page-turn
 * beats, as the K1 spec does), a run of the same sound word (따각, 따각 /
 * 뿔, 뿔, 뿔) counts as one eojeol, the unit mean is judged only from
 * meanFromSentences sentences on and only against its upper bound (one short
 * line is the point), a long sentence is blocked only past the level's
 * maximum + longOver, the share of long sentences and the number of one-word
 * sound units are book-level notes, and the whole-book sentence total takes
 * the wide tolerance.
 */
export const PICTURE_LED = Object.freeze({
  version: 1,
  soundUnitsMax: 3,
  longShareCeil: 1 / 3,
  longOver: 5,
  meanFromSentences: 3,
  bookTolerance: 0.6,
  // The per-unit count band: the writer's check and the openings normalizer
  // read unitTolerance (−1 / +5 → 1..12 sentences on a spread), the page check
  // reads the rhythm band (the same 1..12 for a 1–7 spread; the reference's
  // wordiest spread reads as 11 with its pauses).
  countAbove: 5,
});
/** The format a wizard asks for: 글이 많은 책 only when chosen; everything else is 그림책 결. */
export function formatFor(wizardLike) {
  return wizardLike?.bookFormatId === "wordy" ? "wordy" : "pictureLed";
}
export const bookFormat = (id) => (BOOK_FORMAT_IDS.includes(id) ? { version: BOOK_FORMAT_VERSION, id } : null);
/** What the frozen input keeps: version and id only; null for anything unknown. */
export const bookFormatRef = (value) =>
  value && typeof value === "object" && value.version === BOOK_FORMAT_VERSION ? bookFormat(value.id) : null;
export const isPictureLed = (input) => input?.bookFormat?.version === BOOK_FORMAT_VERSION && input.bookFormat.id === "pictureLed";
export const hasPictureLedSpec = (spec) => spec?.pictureLed?.version === PICTURE_LED.version;
export const bookFormatLabel = (input) => BOOK_FORMAT_LABELS[bookFormatRef(input?.bookFormat)?.id] || "";
const clone = (value) => JSON.parse(JSON.stringify(value));
/**
 * Frozen copy of the level specs for a picture-led book. An openings spec
 * takes the picture-led units, the wide book tolerance, the wider count band
 * and the marker; a page book (K1, English-only) keeps its specs byte for
 * byte — the K1 spec already judges short rhythm lines — and its format lives
 * in input.bookFormat alone (the outline composition and the K1 writer's line
 * read that).
 */
export function withPictureLed(specs, { layout = "pages" } = {}) {
  const out = { ...(specs || {}) };
  if (layout !== "openings") return out;
  for (const lang of ["ko", "en"]) {
    const spec = out[lang];
    if (!spec || typeof spec !== "object" || !spec.units) continue;
    const units = clone(PICTURE_LED_UNITS[lang]),
      next = {
        ...spec,
        units,
        sentencesPerPage: units.page.target,
        sentencesPerPageRange: { min: units.page.min, max: units.page.max },
        pictureLed: clone(PICTURE_LED),
      };
    if (next.rhythm) next.rhythm = { ...next.rhythm, bookTolerance: PICTURE_LED.bookTolerance };
    if (next.unitTolerance) next.unitTolerance = { ...next.unitTolerance, countAbove: PICTURE_LED.countAbove, longOver: PICTURE_LED.longOver };
    out[lang] = next;
  }
  return out;
}
/** The outline request's beat line: one moment per beat on a picture-led book, else the two or three sentences of today. */
export function beatSummaryLine(input) {
  return isPictureLed(input)
    ? "Each beat summary is one or two concrete sentences: the single moment its picture shows; every beat changes the situation."
    : "Each beat summary is two or three concrete sentences a picture could show; every beat changes the situation.";
}
/** The lean outline request's composition block (English, the writers' language there); empty for other formats. */
export function compositionRule(input, { k1 = false, attempts = 3 } = {}) {
  if (!isPictureLed(input)) return "";
  const three =
    Number(attempts) >= 3
      ? "the attempt beats are THREE encounters of ONE kind (tries, doors, puddles, waves — the story shape says which), each bigger or closer than the last, and the third tips the story into the turn"
      : "the attempt beat holds three quick encounters of one kind, each bigger than the last (a sound for each is enough), and the third tips the story into the turn";
  return `PICTURE-LED BOOK: each beat is one opening with only a few sentences, so the picture carries what the words leave out. Composition: the want is clear by the second beat; ${three}; at the turn what was feared, wanted or lost turns out different, and the picture says it before the words do; then a quiet, round ending that echoes the beginning with one thing changed. ${
    k1 ? "Two voices, the small one and the big one, trade short lines." : "Two voices (the hero and one other) carry the feeling in short lines."
  } One beat may be a single big sound word. Nothing is explained and there is no lesson line.`;
}
/** The writers' room hears the composition in its direction (Korean, one clause); empty for other formats. */
export function compositionDirection(input) {
  return isPictureLed(input)
    ? "책 결: 그림책 결 — 펼침마다 글은 몇 문장뿐이고 그림이 나머지를 말해요; 같은 일이 세 번 점점 크게 닥치고 세 번째에 뒤집히며, 전환은 그림이 먼저 보여 주고, 끝은 처음을 조용히 되풀이하되 하나가 달라져요"
    : "";
}
/** The K1 writer's line on a picture-led book (the K1 page spec itself is unchanged). */
export function pictureLedK1Line(input) {
  return isPictureLed(input)
    ? "그림책 결: 글은 그림이 못 하는 것만 써요. 같은 일이 세 번, 점점 크게 닥치고 세 번째에 뒤집혀요. 큰 순간은 소리 한 단어로 끝내도 좋아요."
    : "";
}
/** The beat writer's budget line for a picture-led Korean beat (the check reads the count band and a hard length cap). */
export function pictureLedBudgetLine(budget, spec) {
  const words = Array.isArray(spec?.eojeolPerSentence) ? spec.eojeolPerSentence : null,
    cap = (words ? words[1] : 7) + Number(spec?.pictureLed?.longOver ?? PICTURE_LED.longOver);
  return `[분량] 이 비트는 펼침 하나예요: ${budget.min}~${budget.max}문장, 보통 ${budget.target}문장. 그림이 말하게 하고 글은 그림이 못 하는 것만 써요. 큰 순간이면 소리 한 단어로 끝내도 좋아요(책에 세 번까지). 한 문장은 ${cap}어절까지.`;
}
/** One sentence for the lean pagination requests of a picture-led book; empty for other formats. */
export function pictureLedPaginationLine(input) {
  return isPictureLed(input)
    ? "PICTURE-LED: keep each entry's text as short as its beat allows (the picture carries the rest); a big moment may be an entry with a single sound word; never pad a short beat to fill a range."
    : "";
}
