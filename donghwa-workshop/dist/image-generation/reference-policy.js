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
 */
export const REFERENCE_POLICY_VERSION = 1;
export const referencePolicy = () => ({ version: REFERENCE_POLICY_VERSION });
export const hasReferencePolicy = (input) => input?.pictureRefs?.version === REFERENCE_POLICY_VERSION;

const list = (value) => (Array.isArray(value) ? value : []);
/** The character IDs a page's scene names (strings, in order, no repeats). */
export function pageCastIds(page) {
  const out = [];
  for (const id of list(page?.scene?.who).map((v) => String(v ?? "").trim()).filter(Boolean)) if (!out.includes(id)) out.push(id);
  return out;
}
/**
 * The sheets a page request carries: those of the page's cast, in sheet order.
 * When the page names nobody the sheets know, every sheet (the old behaviour) —
 * a page is never drawn without a face to copy.
 */
export function castSheetsForPage(sheets, page) {
  const all = list(sheets).filter(Boolean),
    who = new Set(pageCastIds(page));
  if (!who.size) return all;
  const picked = all.filter((sheet) => who.has(String(sheet?.characterId ?? "")));
  return picked.length ? picked : all;
}
