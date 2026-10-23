/*
 * Picture-book craft rules (2026-10-20). Reading a finished K2 book as the
 * parent of a five-year-old showed four habits the pipeline allowed: sentences
 * that explained a sound instead of sounding it, the story's answer told on
 * page 2, six pages in a row with one camera, and a picture that never showed
 * the small object the words were about. New drafts freeze input.craftPolicy
 * {version: 1}; every rule here is gated on it, so existing drafts, jobs and
 * books send byte-identical requests.
 */
import { hasPromptPolicy } from "./prompt-policy.js";
export const CRAFT_POLICY_VERSION = 1;
export const craftPolicy = () => ({ version: CRAFT_POLICY_VERSION });
export const hasCraftPolicy = (input) =>
  input?.craftPolicy?.version === CRAFT_POLICY_VERSION;
const koLevel = (input) => String(input?.specs?.ko?.id || "");
const hasKorean = (input) => input?.language !== "en";
// R31a: a K1 book (input.k1Policy) has no mystery and no fixed sound refrain;
// k1-book.js gives its own arc and sound line (inline test: no module cycle).
const k1Book = (input) => input?.k1Policy?.version === 1;
// R31b 프롬프트 다이어트: no suspense formula, no sound-refrain quota, no
// one-action-per-sentence, no per-beat sound counts; the cast and place lines
// stay as one soft sentence each (the parent asked that everyone take part).
const dieted = (input) => input?.promptDiet?.version === 1;
const K1_SOUNDS =
  "K1 SOUNDS: use at least five different sound or movement words across the book (for example 부릉부릉, 까르륵, 콩닥콩닥), spread over different pages where they happen, never piled on one page. No fixed refrain is required.";
/** K1/K2 Korean books: a sound-word refrain is part of the story's design. */
export const soundRefrainRequired = (input) =>
  hasCraftPolicy(input) && hasKorean(input) && /^K[12]$/u.test(koLevel(input)) && !k1Book(input) && !dieted(input);

const SUSPENSE_OUTLINE =
  "SUSPENSE: the story asks one question (what makes the sound, where the thing went, who did it). Beat summaries before the turn show clues, wrong guesses and small failures but never state the answer or its cause; the turn beat reveals it and the resolution uses it. plan.twistReveal belongs to the turn, never to setup or want.";
const SIDEKICK =
  "SIDEKICK: a companion character does at least one thing of its own that is funny or wrong (a wrong guess, a silly try), not only nodding or watching.";
const SOUND_REFRAIN =
  "SOUND REFRAIN (required for this K1/K2 book): refrain.text is one short Korean sound line that the key object or event makes, written as onomatopoeia with an exclamation mark (e.g. '딸랑!', '바스락!', '똑똑!'), never a sentence and never a catchphrase. Plan it at exactly 3 beat indices (one early, one in the middle, one at the turn or resolution); refrain.variation may change one word. A child should be able to shout it on the third time.";
/**
 * 2026-10-20 variety: the parent may pick up to six companions and four
 * places, and asked that they all take part. The same home test as the
 * pipeline's isHomeBackground (kept here to avoid a module cycle).
 */
const isHomePlace = (background = {}) =>
  /^(?:home|house|bedroom|livingroom|living_room|room|집|방|집·방)$/iu.test(
    String(background.type || background.kind || "").trim(),
  ) ||
  /(?:집|침실|거실|주방|아이\s*방|의\s*방|우리\s*방|\b(?:home|house|bedroom|living\s*room|kitchen)\b)/iu.test(
    [background.name, background.nameEn].filter(Boolean).join(" "),
  );
const companionCount = (input) =>
  Math.max(0, (Array.isArray(input?.characters) ? input.characters : []).length - 1);
const locationCount = (input) => {
  const all = (Array.isArray(input?.backgrounds) ? input.backgrounds : []).filter(
    (b) => !isHomePlace(b),
  );
  // R23: a policy draft counts the places the parent chose (the whole drawer
  // is only the pool); without chosen places, or without the policy, every
  // supplied place counts as before.
  const chosen = hasPromptPolicy(input)
    ? new Set((Array.isArray(input?.preferredBackgroundIds) ? input.preferredBackgroundIds : []).map(String))
    : null;
  return chosen?.size ? all.filter((b) => chosen.has(String(b.id))).length : all.length;
};
/** Every supplied companion takes part; a big cast is spread over the beats. */
export function castSpreadRule(input) {
  const companions = companionCount(input);
  if (!companions) return "";
  if (dieted(input))
    return `The ${companions} chosen companion${companions > 1 ? "s" : ""} each take part somewhere and do something of their own; not everyone needs to be in every scene.`;
  return `CAST (${companions} companion${companions > 1 ? "s" : ""} supplied): every companion is listed in beat.characters of at least two beats and does one thing of its own that matters to the story (a wrong guess, a small help, a funny mistake), never only standing by. Spread the companions over the beats instead of crowding every scene${companions >= 3 ? ": some join on the way, one may wait at home" : ""}; one beat lists at most four characters.`;
}
/** With three or more places supplied, the middle beats use three (four in a 16-page book). */
export function placeSpreadRule(input) {
  // R33: on the diet the places follow the story; no visiting quota at all.
  if (dieted(input)) return "";
  const locations = locationCount(input),
    want = Math.min(locations, Number(input?.pageCount) >= 16 ? 4 : 3);
  if (want < 3) return "";
  return `PLACES (${locations} non-home locations supplied): the middle beats visit at least ${want} distinct non-home locations, each visit changing what the protagonist knows or has; return to a place only when the story needs it.`;
}
/** Outline stage (app path, and the quality path's canon). */
export function craftOutlineRules(input) {
  if (!hasCraftPolicy(input)) return "";
  if (dieted(input)) return [castSpreadRule(input), placeSpreadRule(input)].filter(Boolean).join("\n");
  return [
    k1Book(input) ? "" : SUSPENSE_OUTLINE,
    SIDEKICK,
    castSpreadRule(input),
    placeSpreadRule(input),
    soundRefrainRequired(input) ? SOUND_REFRAIN : "",
    k1Book(input) ? K1_SOUNDS : "",
  ]
    .filter(Boolean)
    .join("\n");
}
/** Prose stages (app prose, quality rich/simplify/fix, enrichment). */
export function craftProseRules(input) {
  if (!hasCraftPolicy(input)) return "";
  if (dieted(input)) return "";
  return [
    k1Book(input) ? "" : "SUSPENSE IN PROSE: keep the answer of the story's question hidden until the turn beat's paragraph. Earlier paragraphs may show the clue (a sound, a glimpse, a wrong guess) but never explain what causes it; narration before the turn does not name the cause.",
    "SOUND WORDS: when something makes a sound, write the sound itself as onomatopoeia ('딸랑!') instead of describing it ('가는 소리가 났어요'); one or two sound words per beat, the same word for the same source every time.",
    /^K[12]$/u.test(koLevel(input))
      ? "ONE ACTION PER SENTENCE: at this level a sentence shows one thing a character does or one thing that happens; why or how goes into its own short sentence or is left to the picture."
      : "",
    soundRefrainRequired(input)
      ? "The approved sound refrain appears word for word at its planned beats only (the planned variation where it is planned)."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
/** Pagination (page and openings books). */
export function craftPaginationRules(input) {
  if (!hasCraftPolicy(input)) return "";
  return `${k1Book(input) ? "" : "SUSPENSE ON PAGES: a page before the turn never states the answer of the story's question; keep the clue sentences and the wrong guesses there. "}KEY PROP: when a page's words name a small object (a tag, a ring, a leaf), scene.action names that object and where it is (in a hand, on the floor) so the picture shows it large enough to recognise. CAMERA: three or more consecutive pages at the same place differ in distance and side (one wide, one close on the hands or the object, one from behind or from above).`;
}
/** The quality package's canon block: outline or prose rules by stage. */
export function craftCanonRules(input, stage = "outline") {
  if (!hasCraftPolicy(input)) return "";
  const body = stage === "prose" ? craftProseRules(input) : craftOutlineRules(input);
  return body ? `PICTURE-BOOK CRAFT:\n${body}` : "";
}

/* ---------- pictures ---------- */
const propText = (prop, lang) => String(prop?.[lang] || "").trim();
const headNoun = (text) => text.split(/\s+/u).filter(Boolean).at(-1) || "";
/** Props of this page's scene brief that the page's own words name (English names). */
export function keyPropsNamed(brief, page) {
  const ko = String(page?.ko ?? page?.textKo ?? ""),
    en = String(page?.en ?? page?.textEn ?? "").toLowerCase(),
    props = Array.isArray(brief?.props) ? brief.props : [];
  return [
    ...new Set(
      props
        .filter((prop) => {
          const k = headNoun(propText(prop, "ko")),
            e = propText(prop, "en").toLowerCase();
          return (k && ko.includes(k)) || (e && en.includes(e));
        })
        .map((prop) => propText(prop, "en"))
        .filter(Boolean),
    ),
  ];
}
/** How many pages immediately before this one are set in the same place. */
export function samePlaceStreak(page, earlierPages = []) {
  const where = String(page?.scene?.where || "");
  if (!where) return 0;
  let streak = 0;
  for (let i = earlierPages.length - 1; i >= 0; i--) {
    if (String(earlierPages[i]?.scene?.where || "") !== where) break;
    streak++;
  }
  return streak;
}
const DAYTIME = new Set(["morning", "day", "afternoon"]);
/** Extra lines of a page's picture request (craft drafts only; never the cover). */
export function craftPictureRules({ book, page, brief, earlierPages = [], time, cover = false }) {
  if (cover || !hasCraftPolicy(book?.storyInput)) return "";
  const lines = [],
    streak = samePlaceStreak(page, earlierPages);
  if (streak >= 2)
    lines.push(
      `CAMERA VARIETY: this is page ${streak + 1} in a row at this place. Frame it differently from the previous pages: change the distance (a close view of the hands or the key object, or a wide view from the other side), the side the characters face and the part of the place in view. Never repeat the previous page's framing.`,
    );
  const props = keyPropsNamed(brief, page);
  if (props.length)
    lines.push(
      `KEY PROPS: the words on this page name ${props.join(", ")}. Each must be clearly visible and recognisable, a small object shown large enough to read (in a hand, close to the camera), never hidden or left out.`,
    );
  if (DAYTIME.has(String(time || ""))) {
    const text = `${page?.ko ?? page?.textKo ?? ""} ${page?.en ?? page?.textEn ?? ""}`;
    lines.push(
      /달|moon|별|star/iu.test(text)
        ? "DAYTIME SKY: daytime light and no stars; the moon only as this page's words describe it."
        : "DAYTIME SKY: it is daytime; no moon and no stars in the sky.",
    );
  }
  return lines.join(" ");
}
