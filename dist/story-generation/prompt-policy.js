/*
 * 프롬프트 정비 (2026-10-20, R23). New drafts freeze input.promptPolicy
 * {version: 1} in inputFromWizard; only drafts with it get the tidier
 * requests below. A draft without the policy sends every request byte for
 * byte as before (R12 pins), so a resumed run never buys a call twice.
 *
 * What the policy changes:
 * - the package's default outline rules and ban examples are no longer
 *   overridden by the app's empty settings arrays;
 * - when a writers' room settled a story bible, the random seed's planted
 *   object, twist type, humour beat and sub-locations come from the bible
 *   (one binding source instead of two that disagree);
 * - the outline-stage canon carries a one-line level summary instead of the
 *   frozen level-spec JSON (vocabulary lists belong to the prose stages),
 *   and the app canon keeps only the fields an outline needs;
 * - PLACES counts the places the parent chose, not the whole drawer;
 * - picture requests carry this page's event in three lines, the last two
 *   pages of continuity and a two-sentence architecture lock;
 * - the author bot writes its pitches in the reader's own words.
 */
export const PROMPT_POLICY_VERSION = 1;
export function promptPolicy() {
  return { version: PROMPT_POLICY_VERSION };
}
export function hasPromptPolicy(input) {
  return input?.promptPolicy?.version === PROMPT_POLICY_VERSION;
}
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 200) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);

/**
 * The seed slots a settled story bible decides. The package applies them
 * after composing its random seed: the planted object and the turn come
 * from the bible, the humour beat and sub-location list are dropped (the
 * bible's pictures and the drawer's places are enough), while the
 * background creature and the order of failure reasons stay random.
 */
export function bibleSeedOverrides(bible) {
  if (!object(bible)) return null;
  const planted = str(bible.planted?.name, 80),
    plantedEn = str(bible.planted?.nameEn, 80) || planted,
    seen = str(bible.turn?.seen, 200),
    realized = str(bible.turn?.realized, 200),
    overturns = str(bible.turn?.overturns, 200);
  if (!planted && !overturns && !seen) return null;
  return {
    ...(planted ? { planted: { ko: planted, en: plantedEn } } : {}),
    ...(overturns || seen
      ? {
          twist: {
            id: "bible",
            ko: `설계서의 반전 — ${overturns || seen}`,
            en: `the story bible's turn: ${overturns || seen}`,
            hint: `아이가 보는 것: ${seen || "설계서대로"}${realized ? ` → 주인공의 말: ${realized}` : ""}`,
          },
        }
      : {}),
    humor: null,
    subLocations: [],
  };
}

/** The outline canon's character: identity and voice, never colours or wardrobe. */
export function compactCanonCharacter(character) {
  if (!object(character)) return character;
  const out = {
    id: character.id,
    name: character.name,
    ...(character.nameEn ? { nameEn: character.nameEn } : {}),
    ...(character.role ? { role: character.role } : {}),
    ...(character.kind ? { kind: character.kind } : {}),
    ...(character.age !== undefined && character.age !== "" ? { age: character.age } : {}),
    ...(character.gender ? { gender: character.gender } : {}),
    traits: list(character.traits).slice(0, 3),
  };
  const catchphrase = character.catchphrase || character.speechHabit;
  if (catchphrase) out.catchphrase = catchphrase;
  return out;
}
/** The outline canon's place: name, kind and what is there; never the palette. */
export function compactCanonBackground(background) {
  if (!object(background)) return background;
  return {
    id: background.id,
    name: background.name,
    ...(background.nameEn ? { nameEn: background.nameEn } : {}),
    ...(background.kind ? { kind: background.kind } : {}),
    ...(background.type ? { type: background.type } : {}),
    description: str(background.descriptionEn || background.description || background.features, 200),
  };
}
const unitTarget = (spec) => {
  const unit = spec?.units?.opening || spec?.units?.page;
  if (unit?.target) return unit.target;
  if (Array.isArray(spec?.sentencesPerPage)) return spec.sentencesPerPage.join("-");
  return spec?.sentencesPerPage ?? "";
};
/**
 * One line for the outline stage in place of the frozen level-spec JSON: the
 * levels, the usual sentence count and the beat count. Sentence length,
 * vocabulary and grammar bind the prose stages, which still get the JSON.
 */
export function outlineLevelLine(input, beats) {
  const ko = input?.specs?.ko || {},
    en = input?.specs?.en || {},
    pages = Number(input?.pageCount) || 12,
    openings = input?.layoutPolicy?.kind === "openings" ? Math.round(pages / 2) : 0,
    koPart = input?.language === "en" ? "" : `Korean ${ko.id || "K1"} (${ko.label || ""}; about ${unitTarget(ko)} sentences per ${openings ? "opening" : "page"})`,
    enPart = input?.language === "ko" ? "" : `English ${en.id || "E0"} (${en.label || ""}; about ${unitTarget(en)} sentences per ${openings ? "opening" : "page"})`;
  return `LEVELS (summary for this outline): ${[koPart, enPart].filter(Boolean).join("; ")}. ${beats || "?"} beats for ${pages} pages${openings ? `, one beat per opening (${openings} openings)` : ""}. Sentence length, vocabulary and grammar limits bind the later prose stages, never this outline: level changes wording, not causes and consequences.`;
}

/** The picture request's event ledger in three lines (this beat only). */
export function compactPlotLines(plot) {
  if (!object(plot)) return "";
  const e = object(plot.event) ? plot.event : {};
  return `EVENT (beat ${plot.beatIndex ?? "?"}${plot.causeBeatIndex ? `, caused by beat ${plot.causeBeatIndex}` : ""}): trigger — ${str(e.trigger, 160) || "-"}; attempt — ${str(e.attempt, 160) || "-"}; result — ${str(e.result, 160) || "-"}. Draw only the moment this page narrates: never the beat's final result early, a discarded prop, a changed owner or a new structure.`;
}
export const ARCHITECTURE_LOCK_SHORT =
  "ARCHITECTURE LOCK: the approved place sheet and its first canonical scene fix this place's buildings, doors, windows, paths and their positions; change only the camera and the light. Never add an entrance, bridge, tower, staircase or any structure the place references or the story did not establish, and never move a building in from another place.";
/** How many earlier pages a picture request repeats for continuity. */
export const PICTURE_CONTINUITY_PAGES = 2;
/** The author bot's extra line: pitches in the reader's own words. */
export function readerVocabularyLine(card) {
  return `[독자 어휘] ${card?.age || "아이"} 아이가 듣고 되말할 수 있는 말로 쓴다: 한 문장은 짧게, 어려운 낱말·어른 표현·비유 없이, 보이는 물건과 행동으로.`;
}
