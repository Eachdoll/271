/* 주제의 장소 (R33, 2026-10-23): which drawer places a topic names. One
 * scorer for the simple screen's picks (②), the selection plan's fill, the
 * outline rules ("the story happens where the topic puts it") and the
 * outline check's note when the topic's place never appears. Pure. */
import { placeTypeLabel, isPresetPlaceType } from "../place-types.js";

/** [background text pattern, topic words that call for it, label for a missing-place hint]. */
export const PLACE_HINTS = Object.freeze([
  [/달|별|우주|space|moon/i, ["달", "별", "우주", "로켓", "밤하늘", "행성"], "달·우주"],
  [
    /바다|바닷|조개|해변|sea|beach/i,
    ["바다", "바닷", "조개", "물고기", "파도", "보물", "고래", "모래"],
    "바다",
  ],
  [/숲|나무|forest/i, ["숲", "나무", "공룡", "소풍", "산책", "곤충"], "숲"],
  [
    /빗방울|정원|웅덩이|rain|garden/i,
    ["비 오는", "빗", "우산", "무지개", "장화", "웅덩이", "정원"],
    "정원",
  ],
  [/유치원|학교|school/i, ["유치원", "학교", "선생님", "교실"], "유치원·학교"],
  [/놀이터|공원|park/i, ["놀이터", "공원", "그네", "미끄럼"], "놀이터·공원"],
  [/생일|파티|party/i, ["생일", "파티", "케이크"], ""],
]);
const ADJECTIVE_END = /(?:는|한|은|운|인|던|된|진|울)$/u;
/** The words of a Korean name or kind, particles stripped, adjectives left out. */
export function nameWords(text) {
  return String(text || "")
    .split(/[\s,·/()]+/u)
    .map((word) =>
      word.replace(
        /(?:으로|에서|이랑|에게|와|과|의|이|가|을|를|은|는|에|로)$/u,
        "",
      ),
    )
    .filter((word) => word && !ADJECTIVE_END.test(word));
}
const placeText = (background = {}) =>
  [
    background.name,
    background.nameEn,
    background.description,
    background.type,
    placeTypeLabel(background.type),
  ]
    .filter(Boolean)
    .join(" ");
/** The topic words a drawer place answers to (its name, a typed kind, and the hint words of its kind). */
export function placeKeywords(background = {}) {
  const text = placeText(background),
    // 2026-10-20: a typed kind ("도시") is itself a topic word.
    words = new Set([
      ...nameWords(background.name),
      ...(isPresetPlaceType(background.type) ? [] : nameWords(background.type)),
    ]);
  for (const [pattern, hints] of PLACE_HINTS)
    if (pattern.test(text)) hints.forEach((hint) => words.add(hint));
  return [...words].filter(Boolean);
}
export function topicScore(topic, keywords) {
  const text = String(topic || "");
  return keywords.filter((word) => word && text.includes(word)).length;
}
/** The drawer places the topic names, best match first, then drawer order (home included). */
export function topicPlaceIds(topic, backgrounds = []) {
  return (Array.isArray(backgrounds) ? backgrounds : [])
    .map((b, order) => ({ id: b?.id, order, score: topicScore(topic, placeKeywords(b || {})) }))
    .filter((row) => row.id && row.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((row) => row.id);
}
/** The same places by name, for a rule line or a note. */
export function topicPlaceNames(topic, backgrounds = []) {
  const list = Array.isArray(backgrounds) ? backgrounds : [];
  return topicPlaceIds(topic, list)
    .map((id) => list.find((b) => b?.id === id))
    .filter(Boolean)
    .map((b) => String(b.name || b.id));
}
/** Kinds of place the topic calls for that no drawer place answers to (labels for a hint). */
export function missingTopicPlaces(topic, backgrounds = []) {
  const text = String(topic || ""),
    list = Array.isArray(backgrounds) ? backgrounds : [],
    out = [];
  for (const [pattern, hints, label] of PLACE_HINTS) {
    if (!label || !hints.some((hint) => text.includes(hint))) continue;
    if (!list.some((b) => pattern.test(placeText(b || {})))) out.push(label);
  }
  return out;
}
