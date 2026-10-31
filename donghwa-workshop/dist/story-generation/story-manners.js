/* 말높임·웃음·비밀 (R49, 2026-10-31). The parent on a finished bilingual K2
 * book (뽀글머리: a hair salon, the stylist 보라 an adult who is not family):
 * "보라 is a grown-up — why does she talk down to everyone? What does 'the curls
 * were hiding' even mean? And the nose-huge-in-the-mirror gag turns up in
 * every book — isn't that forced?" Read against the prompts, three things
 * made it so: nothing anywhere said who speaks politely to whom; R39 asked
 * every non-K1 outline for a `secret` (a thing the child sees before the
 * hero) and the adventure angle's turn asked for "a hidden thing revealed",
 * so a story with nothing to hide made the hero's own hair the hidden thing;
 * and the scene briefs required a `humor` line on every beat, so the writer
 * reached for the same stock gag whenever a mirror was in the room. A new
 * diet draft freezes input.storyManners {version: 1, recentHumor?: [...]}:
 * the writers hear who speaks politely (an adult outside the family, and the
 * children to them), that a laugh comes only from what happens and never from
 * a gag any book could carry, and which laughs the family's recent books
 * already used; the outline is asked for a secret only when the story has one;
 * a beat's humor may be empty. Nothing is counted or checked. Drafts without
 * the marker are unchanged. Pure module. */
export const STORY_MANNERS_VERSION = 1;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 120) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
const RECENT_MAX = 8;
/** The marker for a new draft; the family's recent laughs ride inside it (never story data). */
export const mannersPolicy = (recentHumor = []) => {
  const recent = recentHumorList(recentHumor);
  return { version: STORY_MANNERS_VERSION, ...(recent.length ? { recentHumor: recent } : {}) };
};
/** The marker as normalize keeps it; null when it is not the R49 one. */
export const mannersRef = (value) => (object(value) && value.version === STORY_MANNERS_VERSION ? mannersPolicy(value.recentHumor) : null);
/** The marker, on a diet draft. */
export const hasStoryManners = (input) => input?.storyManners?.version === STORY_MANNERS_VERSION && input?.promptDiet?.version === 1;
const recentHumorList = (values) => [...new Set(list(values).filter((v) => typeof v === "string").map((v) => str(v)).filter(Boolean))].slice(0, RECENT_MAX);
/** The laughs the family's recent approved books used (quality-gates stores them as usedElements.humor). */
export function recentHumorLines(records = [], count = 3) {
  return recentHumorList(
    list(records)
      .slice(0, count)
      .flatMap((record) => list(record?.usedElements?.humor)),
  );
}
const FAMILY = /가족|엄마|아빠|어머니|아버지|할머니|할아버지|이모|고모|삼촌|외삼촌|누나|언니|오빠|형|동생|아기|부모/u;
const isFamily = (c) => FAMILY.test(`${c?.role || ""} ${c?.name || ""}`);
/** The adults in the cast who are not family: they speak politely, and the children to them. */
export const outsideAdults = (input) => list(input?.characters).filter((c) => object(c) && c.kind === "adult" && !isFamily(c));
/** The writers' line on who speaks politely to whom (Korean for the Korean writer, English otherwise). */
export function speechLevelLine(input, lang = "ko") {
  if (!hasStoryManners(input)) return "";
  const adults = outsideAdults(input);
  if (lang !== "ko")
    return adults.length
      ? `Speech levels: family and friends speak casually; ${adults.map((c) => str(c.nameEn || c.name, 30)).join(", ")} (an adult outside the family) speaks politely to customers and other adults, and the children speak politely back.`
      : "Speech levels: family and friends speak casually; an adult outside the family speaks politely to customers and other adults, and the children speak politely back.";
  const who = adults.map((c) => `${str(c.name, 30)}${c.role ? `(${str(c.role, 20)})` : ""}`).join("·");
  return adults.length
    ? `[말높임] 가족·친구끼리는 반말이에요. ${who}는 가족이 아닌 어른이라 손님과 다른 어른에게 존댓말('~세요', '~예요')로 말하고, 아이들도 ${adults.map((c) => str(c.name, 30)).join('·')}에게는 존댓말을 써요.`
    : "[말높임] 가족·친구끼리는 반말이에요. 가족이 아닌 어른(가게·미용실·선생님)은 손님과 다른 어른에게 존댓말('~세요', '~예요')로 말하고, 아이들도 그 어른에게는 존댓말을 써요.";
}
/** The writers' line on laughs: from what happens, never a stock gag, never one a recent book used. */
export function humorWriterLine(input, lang = "ko") {
  if (!hasStoryManners(input)) return "";
  const recent = list(input.storyManners.recentHumor);
  if (lang !== "ko")
    return `A laugh comes only from what happens in this story — never a gag any book could carry (a nose huge in a mirror or a spoon); a beat with nothing funny does not try.${recent.length ? ` Not these, already in the family's recent books: ${recent.map((v) => `"${v}"`).join(", ")}.` : ""}`;
  return `[웃음] 웃음은 이 이야기에서 벌어지는 일에서만 나와요. 어느 책에나 넣을 수 있는 흔한 개그(거울이나 숟가락에 코만 커다랗게 비치기)는 쓰지 않아요. 웃길 일이 없는 쪽은 웃기려 하지 않아요.${recent.length ? ` 최근 책에서 이미 쓴 웃음: ${recent.map((v) => `"${v}"`).join(", ")} — 다시 쓰지 않아요.` : ""}`;
}
/** The scene-brief request's sentence on humor: this beat's laugh only when it has one. */
export function mannersBriefRule(input) {
  if (!hasStoryManners(input)) return "";
  const recent = list(input.storyManners.recentHumor);
  return ` humor is this beat's own laugh only when the story has one — from what happens, never a gag any book could carry (a nose huge in a mirror); "" on a beat with nothing funny.${recent.length ? ` Not these, used in the family's recent books: ${recent.map((v) => `"${v}"`).join(", ")}.` : ""}`;
}
/** The outline request's secret sentence: only when the story has one; a thing that cannot hide is not one. */
export function mannersSecretRule(input) {
  if (!hasStoryManners(input)) return "";
  return ` Return secret only when the story really has one — a thing that can be hidden or go unnoticed (where the lost thing is, who is following, what the strange sound was) that the child can see in the pictures from early on and the hero has not noticed; then the turn is the hero finally seeing it, and the words never point at it before then. "" when the story has no such thing — never make something that cannot hide (someone's own hair, a feeling) the secret.`;
}
