/*
 * R55d (2026-11-08): which reference images a page's picture request carries.
 *
 * The roundtable on picture consistency read the second paid A/B: every page
 * request sent the sheets of every character in the drawer (a mother who is
 * on two of fourteen pages rode along on all fourteen), and the earlier-page
 * references were "the first and the latest page at the same place" whatever
 * camera those pages used. Neither is a rule for the writer — only what the
 * picture model is shown.
 *
 * A new draft freezes input.pictureRefs {version: 1} (inputFromWizard; kept by
 * normalizeStoryInput and the FULL AUTO input step, stripped from what the
 * text models see). A book whose storyInput carries the marker:
 *   - sends the character sheets of the characters on the page (scene.who),
 *     all of them when the page names none it can match (the cover stays the
 *     hero alone, as before);
 *   - prefers, among the earlier pages at the same place, the latest page drawn
 *     from the same camera (shot) as the recent-scene reference.
 * A book without the marker is unchanged, byte for byte.
 *
 * R59 (2026-11-10): version 2 — "request hygiene". The three-seat debate read
 * the one book made with pictures: of 7 pages that received an earlier page's
 * image showing other characters 4 drew a character who was not on the page
 * (1 of 8 otherwise), a page with only the fawn named 'Yuha' five or six times
 * (the facing-page line, the earlier-pages summary, the eye's landing place),
 * and every text-field request also said "the text is printed below, use the
 * full picture". A version 2 book (new drafts) therefore:
 *   - attaches an earlier page's image only when that page's cast is a subset
 *     of this page's cast, and none at all on a close or plain-backdrop page;
 *   - carries no name of a character who is not on the page (the facing page
 *     is described by its camera, earlier pages ride along only when their
 *     cast is on this page, a focus naming someone absent is dropped, the
 *     "not in this picture" line names nobody);
 *   - says each thing once: no "printed below" beside a text field, the camera
 *     in the opening sentence only, no CAMERA VARIETY line beside "from the
 *     same side".
 * A version 1 book keeps its R55d–R58 requests byte for byte.
 */
export const REFERENCE_POLICY_VERSION = 2;
export const referencePolicy = () => ({ version: REFERENCE_POLICY_VERSION });
export const hasReferencePolicy = (input) => input?.pictureRefs?.version === 1 || input?.pictureRefs?.version === REFERENCE_POLICY_VERSION;
/** R59: the marker as a draft froze it (version 1 stays 1). */
export const referencePolicyRef = (input) => (hasReferencePolicy(input) ? { version: input.pictureRefs.version } : null);
/** R59: request hygiene (version 2 books). */
export const hasReferenceHygiene = (input) => input?.pictureRefs?.version === REFERENCE_POLICY_VERSION;

const list = (value) => (Array.isArray(value) ? value : []);
/** The character IDs a page's scene names (strings, in order, no repeats). */
/** R61b: a kept writers' room book (weave 6) — the R61 image behaviours apply to it only, so older books ask as before. */
export const hasKeptRoom = (input) => Number(input?.writersRoom?.weave) >= 6;
export function pageCastIds(page) {
  const out = [];
  // R61a: scene.extra holds the cast beyond the five a page's who may list (a crowded picture) — they are on the page too.
  for (const id of [...list(page?.scene?.who), ...list(page?.scene?.extra)].map((v) => String(v ?? "").trim()).filter(Boolean)) if (!out.includes(id)) out.push(id);
  return out;
}
/**
 * The sheets a page request carries: those of the page's cast, in sheet order.
 * When the page names nobody the sheets know, every sheet (the old behaviour) —
 * a page is never drawn without a face to copy.
 */
export function castSheetsForPage(sheets, page, { strict = false } = {}) {
  const all = list(sheets).filter(Boolean),
    who = new Set(pageCastIds(page));
  // R61 (audit B/I, `strict` = request hygiene): a picture with no one in it carries no sheet, and a page whose cast has
  // no sheet (a one-page character drawn from its description) carries none of the others' — never "all of them".
  if (strict && page?.scene?.nobody === true) return [];
  if (!who.size) return strict ? [] : all;
  const picked = all.filter((sheet) => who.has(String(sheet?.characterId ?? "")));
  return picked.length || strict ? picked : all;
}
/**
 * R59: may an earlier page ride along with this page (its image as a
 * reference, its scene in the continuity line)? Only when everyone on it is
 * also on this page. A page that names nobody shows whoever the request lists
 * (every sheet), so anything may ride along; an earlier page that names
 * nobody may show anyone, so it does not.
 */
export function castWithin(prior, page) {
  const now = page?.scene?.nobody === true ? [] : pageCastIds(page);
  // R61: a picture with no one in it takes only an earlier picture with no one in it.
  if (!now.length) return pageCastIds(prior).length === 0 || prior?.scene?.nobody === true;
  const then = pageCastIds(prior);
  return then.length > 0 && then.every((id) => now.includes(id));
}
