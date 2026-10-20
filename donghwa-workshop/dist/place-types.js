/**
 * 2026-10-20 "배경 시트 카테고리가 너무 단조로워": a place's `type` was one of
 * five ids (home, school, forest, sea, space). The forms now offer more
 * presets and a free text ("도시", "사막", "동굴" …). A preset is stored by
 * its id (the five old ids keep their old prompt words byte for byte); a
 * typed kind is stored as the parent wrote it.
 */
const PRESETS = Object.freeze([
  ["home", "집", "🏡", "home"],
  ["school", "유치원 · 학교", "🏫", "school"],
  ["forest", "숲 · 놀이터", "🌳", "forest"],
  ["sea", "바다", "🐚", "sea"],
  ["space", "우주 · 상상 세계", "🌙", "space"],
  ["city", "도시 · 거리", "🏙️", "city street"],
  ["park", "공원", "🛝", "park"],
  ["mountain", "산 · 들판", "⛰️", "mountain and meadow"],
  ["farm", "농장", "🚜", "farm"],
  ["market", "시장 · 가게", "🛒", "market"],
  ["library", "도서관 · 박물관", "📚", "library"],
  ["cave", "동굴", "🕳️", "cave"],
  ["desert", "사막", "🏜️", "desert"],
  ["snow", "눈 나라 · 겨울", "❄️", "snowy land"],
  ["station", "기차역 · 길", "🚉", "train station"],
]);
export const PLACE_TYPE_CUSTOM = "custom";
export const PLACE_TYPE_MAX = 24;
const byId = new Map(PRESETS.map((row) => [row[0], row]));
/** Select rows: presets then '직접 입력'. */
export const PLACE_TYPE_CHOICES = Object.freeze([
  ...PRESETS.map(([id, label]) => [id, label]),
  [PLACE_TYPE_CUSTOM, "직접 입력 (아래 칸에)"],
]);
export const isPresetPlaceType = (type) => byId.has(String(type ?? ""));
const CONTROL = /[\u0000-\u001f\u007f<>"'`]/u;
/** The stored value for a form: the typed kind when given, else the chosen preset. */
export function readPlaceType(selected, custom = "") {
  const typed = String(custom ?? "").trim().replace(/\s+/gu, " ");
  if (typed) return normalizePlaceType(typed);
  if (selected === PLACE_TYPE_CUSTOM)
    throw new Error("장소 종류를 아래 칸에 적어 주세요 (예: 도시, 사막, 동굴).");
  return normalizePlaceType(selected);
}
/** A preset id or a short plain text; throws otherwise. */
export function normalizePlaceType(value) {
  const text = String(value ?? "").trim().replace(/\s+/gu, " ");
  if (!text) throw new Error("장소 종류를 골라 주세요.");
  if (text.length > PLACE_TYPE_MAX)
    throw new Error(`장소 종류는 ${PLACE_TYPE_MAX}자 이내로 적어 주세요.`);
  if (CONTROL.test(text) || text === PLACE_TYPE_CUSTOM)
    throw new Error("장소 종류에는 글자와 숫자만 적어 주세요.");
  return text;
}
export const isValidPlaceType = (value) => {
  try {
    normalizePlaceType(value);
    return true;
  } catch {
    return false;
  }
};
/** What the parent reads in lists: the preset label, or the typed kind. */
export function placeTypeLabel(type) {
  const row = byId.get(String(type ?? ""));
  return row ? row[1] : String(type ?? "");
}
/** What a picture request reads: the five old ids unchanged, English for the other presets, the typed kind as is. */
export function placeTypePrompt(type) {
  const row = byId.get(String(type ?? ""));
  return row ? row[3] : String(type ?? "");
}
const GUESS = Object.freeze([
  [/도시|거리|city|town|street|빌딩|building/iu, "🏙️"],
  [/공원|놀이터|park|playground/iu, "🛝"],
  [/산|언덕|들판|초원|mountain|hill|meadow|field/iu, "⛰️"],
  [/농장|목장|farm|barn/iu, "🚜"],
  [/시장|가게|상점|market|shop|store/iu, "🛒"],
  [/도서관|박물관|library|museum/iu, "📚"],
  [/동굴|cave/iu, "🕳️"],
  [/사막|desert/iu, "🏜️"],
  [/눈|얼음|겨울|snow|ice|winter/iu, "❄️"],
  [/기차|역|길|station|train|road/iu, "🚉"],
  [/강|호수|연못|river|lake|pond/iu, "🏞️"],
  [/바다|해변|sea|beach|ocean/iu, "🐚"],
  [/숲|나무|forest|wood/iu, "🌳"],
  [/우주|달|별|space|moon|star/iu, "🌙"],
  [/집|방|home|house|room/iu, "🏡"],
  [/병원|hospital/iu, "🏥"],
  [/학교|유치원|school/iu, "🏫"],
]);
/** An emoji for a card: the preset's, else a guess from the typed kind, else leaves. */
export function placeEmoji(type) {
  const row = byId.get(String(type ?? ""));
  if (row) return row[2];
  const text = String(type ?? "");
  for (const [pattern, emoji] of GUESS) if (pattern.test(text)) return emoji;
  return "🌿";
}
/** The text input shown under a type select; `name` is set for FormData forms. */
export function placeTypeCustomField(id, { name = "", value = "" } = {}) {
  const shown = isPresetPlaceType(value) ? "" : String(value ?? "");
  return `<div class="field"><label for="${id}">장소 종류 직접 입력</label><input id="${id}"${name ? ` name="${name}"` : ""} maxlength="${PLACE_TYPE_MAX}" placeholder="예: 도시, 사막, 동굴 (비우면 위 선택)" value="${shown.replace(/"/gu, "&quot;")}"><small>적으면 위 선택 대신 이 종류로 그려요.</small></div>`;
}
