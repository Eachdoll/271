/**
 * 2026-10-20 "옷장에 옷을 추가하니 성별이 바뀌어버렸어": a character record
 * may carry a gender (the seed protagonist does), but no picture request
 * said it, so an outfit description alone (a dress, a bow) could flip the
 * drawn child. Every request that draws a character now carries one short
 * identity line built here; a record without a gender sends nothing new.
 */
const WORDS = Object.freeze([
  [/^(?:남자\s*아이|남아|남자|소년|boy|male|man|he)$/iu, { child: "boy", adult: "man" }],
  [/^(?:여자\s*아이|여아|여자|소녀|girl|female|woman|she)$/iu, { child: "girl", adult: "woman" }],
]);
/** "boy" | "girl" | "man" | "woman" | "" for a character record or sheet snapshot. */
export function genderWord(character = {}) {
  const raw = String(character?.gender ?? "").trim();
  if (!raw) return "";
  const adult =
    character?.kind === "adult" ||
    (Number.isFinite(Number(character?.age)) && Number(character.age) >= 18);
  for (const [pattern, words] of WORDS)
    if (pattern.test(raw)) return adult ? words.adult : words.child;
  return "";
}
/** The Korean label for forms: a stored value stays as the parent typed it. */
export const GENDER_CHOICES = Object.freeze([
  ["", "표시 안 함"],
  ["남자아이", "남자아이"],
  ["여자아이", "여자아이"],
]);
/**
 * One sentence a picture request can append so the clothes never decide the
 * child: "" when the record has no gender.
 */
export function identityLine(character = {}, { name = "" } = {}) {
  const word = genderWord(character);
  if (!word) return "";
  const who = name || character?.nameEn || character?.name || "The character";
  return `${who} is a ${word}; keep the same ${word} with the same face, hair and body in every view, whatever the clothes or accessories suggest.`;
}
