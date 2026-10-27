/* 영어는 한글을 따라 (R42, 2026-10-27). The parent on a finished K2 draft:
 * "the story is strange" — on the same page the Korean said one thing and
 * the English another ("둥근 것이 쏙 보이네요" / "saw a round back paw": the
 * English gave away two pages early what the Korean kept for the turn). The
 * beat writer wrote the two languages of a beat in parallel, each from the
 * outline alone, with "never a translation of Korean" in the English system
 * line, so they drifted apart. A new diet draft freezes input.englishMirror
 * {version: 1}: its Korean is written first and its English is the short
 * English telling of that Korean — the same events in the same order, the
 * same spoken lines, nothing the Korean has not yet revealed; it may leave
 * details out, never add or change them. The same marker gives the K1
 * writer, the app prose path, the pagination requests and eco one line each.
 * Drafts without the marker are unchanged (the two calls stay parallel).
 * Pure module. */
export const ENGLISH_MIRROR_VERSION = 1;
export const englishMirrorPolicy = () => ({ version: ENGLISH_MIRROR_VERSION });
export const hasEnglishMirror = (input) => input?.englishMirror?.version === ENGLISH_MIRROR_VERSION && input?.promptDiet?.version === 1;
const str = (value, max = 4000) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
/** The beat writer's English system line (replaces "never a translation of Korean"). */
export function mirrorWriterSystem(input, level) {
  if (!hasEnglishMirror(input)) return "";
  return `You are a picture-book author writing original English at ${level || "the frozen level"} for a bilingual picture book. Write only this one beat's English: the short English telling of the Korean text you are given — the same events in the same order, the same spoken lines in plain English, and nothing the Korean has not yet revealed. Leave details out when the level needs it; never add, change or anticipate an event. No beat numbers, labels or notes. Reply in JSON only.`;
}
/** The beat writer's English rule line (leanBeatWriterRules.en). */
export function mirrorWriterRule(input) {
  if (!hasEnglishMirror(input)) return "";
  return "The English follows the Korean of the same beat: the same events in the same order, the same spoken lines, the same surprise kept for the same moment; it may say less, never something else. One idea per sentence; no semicolons.";
}
/** The user block the English call gets: this beat's finished Korean. */
export function mirrorWriterBlock(input, koText) {
  const text = str(koText);
  if (!hasEnglishMirror(input) || !text) return "";
  return `[이 비트의 한글 — 영어는 이 글을 따라요: 같은 일을 같은 순서로, 같은 대사를, 한글이 아직 말하지 않은 것은 말하지 않아요]\n${text}`;
}
/** The pagination requests' line (pages, openings, eco): the English of every entry is its Korean's short telling. */
export function mirrorPaginationLine(input) {
  if (!hasEnglishMirror(input)) return "";
  return "ENGLISH FOLLOWS KOREAN: every entry's textEn is the short English telling of that same entry's textKo — the same events in the same order, the same spoken lines, nothing that entry's Korean has not yet revealed, nothing given away early that the Korean keeps for a later entry; the two languages never tell different things.";
}
/** The K1 writer's line (Korean; replaces "번역이 아니에요"). */
export function mirrorK1Line(input) {
  if (!hasEnglishMirror(input)) return "";
  return "영어(en)는 같은 쪽 한글의 짧은 영어 판이에요: 같은 일을 같은 순서로, 같은 대사를, 한글이 아직 말하지 않은 것은 말하지 않아요. 덜 말해도 되지만 다른 말은 안 돼요. 이름은 영어 이름.";
}
/** The app prose path's sentence (whole book at once). */
export function mirrorProseLine(input) {
  if (!hasEnglishMirror(input)) return "";
  return "The English paragraph of each beat is the short English telling of that beat's Korean paragraph: the same events in the same order, the same spoken lines, nothing the Korean has not yet revealed; it may say less, never something else.";
}
