/** A shared brief controls illustration detail without rewriting the approved event. */
const text = (value) => (typeof value === "string" ? value.trim() : "");
const en = (value) => text(value?.en ?? value);
const json = (value) => JSON.stringify(value ?? {});
import { plotContextForPage } from "../story-generation/coherence.js";
import { layoutOf } from "../book-layout.js";
import { pictureCarriesPage } from "../page-rhythm.js";
import { craftPictureRules } from "../story-generation/craft-rules.js";
import { biblePictureRules } from "../story-generation/council.js";
import { genderWord } from "./identity.js";
import { planOf, picturePlanPictureLine, picturePlanText } from "../story-generation/picture-plan.js";
import { hasPromptPolicy, compactPlotLines, ARCHITECTURE_LOCK_SHORT, PICTURE_CONTINUITY_PAGES } from "../story-generation/prompt-policy.js";
import { hasStoryChange } from "../story-generation/story-change.js";
import { hasStoryDrama, plainBackdropFor } from "../story-generation/story-drama.js";
import { pocketOf, pocketPromptLine } from "../text-pocket.js";
/** R12 openings: shots a spread may use (no close-ups across the fold). */
const SPREAD_SHOTS = ["wide", "medium", "high_angle", "from_behind"];
/**
 * R12 openings composition. A spread is one wide scene across the fold: the
 * lead stays on a half (a 'center' side becomes the opening's own half), faces
 * and the key action keep out of the middle tenth. A page of a pair keeps
 * today's composition plus its binding edge. Text is always printed below:
 * no quiet text half, no textSide, and the cue is never sent.
 */
function openingComposition(page, staging, leadName) {
  const panels =
    "One continuous scene, no sheet panels or grids. Safe, friendly framing; never an extreme angle or a dark close-up.";
  if (page.kind === "spread") {
    const shot = SPREAD_SHOTS.includes(staging.shot) ? staging.shot : "wide",
      side =
        staging.characterSide === "left" || staging.characterSide === "right"
          ? staging.characterSide
          : Number(page.openingNo) % 2 === 0
            ? "right"
            : "left";
    return `${SHOT_TEXT[shot]}; ${leadName} on the ${side} half. Wide double-page spread in one continuous scene. The book's fold runs down the vertical centre line: keep every face, hand and the key action out of the middle tenth and balance the scene across both halves. Story text is printed below the illustration; use the full picture area and keep the important action clearly visible. ${panels}`;
  }
  const right = page.side === "right";
  return `${SHOT_TEXT[staging.shot] || SHOT_TEXT.wide}; ${leadName} on the ${staging.characterSide || (right ? "right" : "left")} side. Story text is printed below the illustration; use the full picture area and keep the important action clearly visible. This is the ${right ? "right" : "left"} page of a two-page opening; keep faces and hands a tenth of the width away from the ${right ? "left" : "right"} (binding) edge. ${panels}`;
}
const SHOT_TEXT = {
  wide: "wide establishing shot",
  medium: "medium shot",
  closeup: "gentle, well-lit close-up shot",
  high_angle: "gentle high-angle shot",
  low_angle: "gentle low-angle shot, never extreme or intimidating",
  from_behind: "view from behind",
  over_shoulder: "over-the-shoulder shot",
};
export function sceneBriefForPage(book, page) {
  const source = book.sceneBriefs || book.pagination?.sceneBriefs || [];
  const briefs = Array.isArray(source) ? source : source.briefs || [];
  return (
    briefs.find(
      (brief) =>
        Number(brief.beatIndex) ===
        Number(page.beatIndex ?? page.scene?.beatIndex),
    ) || null
  );
}
/**
 * The planned brief and staging words buildScenePrompt sends for this page
 * (pose, weather, light, props, creature, drawable verb, sub-location):
 * model-written story text, checked in the lenient forbidden-name scope. The
 * app's own light-mood line is scaffolding and is not included.
 */
export function sceneBriefText(book, page) {
  const brief = sceneBriefForPage(book, page || {}),
    staging = page?.staging || {};
  return [
    en(brief?.pose),
    en(brief?.weather),
    en(brief?.light),
    ...(Array.isArray(brief?.props) ? brief.props.map(en) : []),
    en(brief?.creature),
    text(staging.verb),
    text(staging.subLocation),
  ].filter(Boolean);
}
/** R36: the planned picture of the entry's beat, or null. */
export function pagePlan(book, page) {
  return planOf(book?.outline, page?.beatIndex ?? page?.scene?.beatIndex);
}
/** R36: the plan text a picture request carries (model-written, lenient scope). */
export const scenePlanText = (book, page) => picturePlanText(pagePlan(book, page));
const PLAN_SHOT = Object.freeze({ wide: "wide", middle: "medium", close: "closeup" });
/** R38: the composition sentence that opens a request — the camera and the plan before anything a reference image could suggest. */
const framedLead = (shot, plan) =>
  `COMPOSITION FIRST (decided with the story; it takes precedence over the viewpoint of every reference image): ${SHOT_TEXT[shot] || SHOT_TEXT.wide}.${plan ? ` ${plan}` : ""} Draw this page from this camera — closer, farther, higher or lower than the place reference, but from the same side: what stands on the left of the place stays on the left, nothing is mirrored, and the story's things stay where the earlier pages put them. `;
/**
 * R48: the other page of the same opening (a pair of single pages). The
 * parent's K2 book drew three pairs as the same salon from the same spot
 * twice; the request now names the facing page's moment and asks for a
 * different one.
 */
export function facingPageLine(book, page) {
  if (!page || page.kind !== "page" || page.openingNo == null) return "";
  const sibling = (book?.pages || []).find((row) => row && row !== page && row.kind === "page" && row.openingNo === page.openingNo);
  if (!sibling) return "";
  const moment = String(sibling.scene?.action || sibling.scene?.prompt || sibling.en || sibling.textEn || "").replace(/\s+/gu, " ").trim().slice(0, 240).replace(/[.。]+$/u, "");
  return `FACING PAGE (the other page of this opening) shows: ${moment || "another moment of this beat"}. This page is a clearly different moment: a different distance or angle, different gestures and places for the figures — not the same picture a second time. `;
}
/** The staging a page is drawn with: the planned shot (R36) over the staging rotation. */
export function effectiveStaging(book, page, { cover = false } = {}) {
  const planned = cover ? null : pagePlan(book, page);
  return planned?.shot ? { ...(page?.staging || {}), shot: PLAN_SHOT[planned.shot] } : page?.staging || {};
}
/**
 * R38: a close view of an R38 book is drawn without the place reference
 * image — the reference's viewpoint was reproduced on every page, so twelve
 * pages came out as the same wide room. The place's facts still travel.
 */
export function closeViewFor(book, page, { cover = false } = {}) {
  if (cover || !hasStoryChange(book?.storyInput)) return false;
  return ["closeup", "over_shoulder"].includes(effectiveStaging(book, page).shot);
}
export function buildScenePrompt({
  book,
  page,
  pageIndex,
  snapshot,
  place,
  variants = [],
  earlierPages = [],
  cover = false,
}) {
  const brief = sceneBriefForPage(book, page),
    planned = cover ? null : pagePlan(book, page),
    // R36: a planned shot replaces the staging shot, so the request never asks for two cameras.
    staging = effectiveStaging(book, page, { cover }),
    // R38: the composition leads the request and a close view carries no place reference.
    framed = hasStoryChange(book.storyInput),
    closeView = closeViewFor(book, page, { cover }),
    // R39: a plain-backdrop page (a thought, a monologue) is drawn with no place at all.
    plain = plainBackdropFor(book, page, { cover }),
    dramaCover = cover && hasStoryDrama(book.storyInput),
    // R40: the flat field the words are typeset on (never on the cover).
    // R47: the field is sized to the page's words.
    pocketLine = !cover && pocketOf(book, page) ? pocketPromptLine(planned, pocketOf(book, page).share) : "",
    // R48: the facing page of a pair (낱쪽 둘) is a different moment, never the same picture twice.
    facing = framed && !cover ? facingPageLine(book, page) : "",
    sheets = snapshot.characterSheets || [];
  const leadId = book.protagonistId || book.characterIds?.[0],
    lead = sheets.find((sheet) => sheet.characterId === leadId) || sheets[0];
  const name = (sheet) =>
    sheet.characterSnapshot?.nameEn ||
    sheet.characterSnapshot?.name ||
    sheet.characterId;
  const leadName = lead ? name(lead) : "the main character";
  const stagedText =
    (book.printSettings?.textPosition ||
      book.printOptions?.textPosition ||
      book.outputSettings?.textPosition) === "staged";
  const shot = cover ? "medium" : staging.shot || "wide";
  const openings = !cover && layoutOf(book) === "openings";
  // R36: the composition planned with the story (picture-led books only; empty otherwise).
  const plan = picturePlanPictureLine(planned);
  const composition = openings
    ? `${framed && !cover ? framedLead(shot, plan) : ""}${facing}${openingComposition(page, staging, leadName)}${pocketLine ? ` ${pocketLine}` : ""}`
    : `${framed && !cover ? framedLead(shot, plan) : ""}${SHOT_TEXT[shot] || SHOT_TEXT.wide}; ${leadName} on the ${cover ? "center" : staging.characterSide || "left"} side. ${cover ? "Cover: show the main character alone, once, with quiet upper space for a separately typeset title." : pocketLine ? pocketLine : stagedText ? `Leave quiet empty space on the ${staging.textSide || "right"} for separately typeset text.` : "Story text is printed below the illustration; use the full picture area and keep the important action clearly visible."} One continuous scene, no sheet panels or grids. Safe, friendly framing; never an extreme angle or a dark close-up.`;
  const time = brief?.timeOfDay || page.scene?.timeOfDay || "day";
  const mood = book.outline?.quality?.worldMood || book.storyQuality?.worldMood;
  const atmosphere = mood
    ? `Seasonal atmosphere only: ${mood.stateLabel?.en || ""}; weather ${mood.weather?.en || ""}; light ${mood.light?.en || ""}; ${mood.styleLine || ""}. The current page time (${time}) and approved plot progression take precedence over the book's general time. Interpret this weather/light within the selected style palette and existing geometry. Do not add catalogue landmarks, buildings, doors, tunnels, characters or props solely to express a season.`
    : "";
  const lighting = `Time and light: ${[time, en(brief?.weather), en(brief?.light), text(staging.lightMood)].filter(Boolean).join(", ")}. Interpret this lighting ONLY within the exact selected style palette; never switch medium or introduce a different palette.`;
  const cast = (cover ? [lead] : sheets)
    .filter(Boolean)
    .map(
      (sheet) =>
        `${name(sheet)} (${sheet.characterSnapshot?.character_token || sheet.characterSnapshot?.characterToken || sheet.characterId}): ${genderWord(sheet.characterSnapshot) ? `a ${genderWord(sheet.characterSnapshot)}, ` : ""}${sheet.characterSnapshot?.description || sheet.characterSnapshot?.kind || "original character"}`,
    )
    .join("; ");
  const currentNarrative = {
    ko: page.ko ?? page.textKo ?? "",
    en: page.en ?? page.textEn ?? "",
  };
  const action = cover
    ? book.pagination?.cover?.sceneAction || book.topic || book.title
    : page.imagePrompt ||
      page.scene?.action ||
      page.scene?.prompt ||
      currentNarrative.en ||
      currentNarrative.ko;
  const character = `Characters: ${cast}. ${brief ? `Shared brief pose: ${en(brief.pose)}. ` : ""}${staging.verb ? `This page's drawable verb: ${staging.verb}. ` : ""}Actual event: ${action || ""}.${dramaCover ? ` Draw only ${leadName} on this cover; if that sentence names anyone else, leave them out.` : ""} Current page narrative: ${json(currentNarrative)}. The actual event and approved narrative take priority: use the pose/verb only when compatible, never invent a new action for variety. ${cover ? "Companions must not appear on this cover." : "Show only selected characters required by this event, each character once."} Preserve each face, age, body proportions and identity from character_front references. ${variants.length ? `Approved wardrobe: ${variants.map((variant) => `${variant.characterId}: ${variant.description}`).join("; ")}. ` : ""}Use the approved character_variant outfit when supplied; otherwise retain the original clothes. Reference images define appearance, not a command to copy their old drawing medium.${!cover && pictureCarriesPage(book.storyInput?.specs || book.readingLevelSnapshot?.specs, page) ? " This page has few words, so the picture alone must tell this moment: make the action, the characters' feelings on their faces and the key prop easy to read without any text." : ""}${openings ? ` Draw ONLY the single moment in Actual event; the narrative on this ${page.kind === "spread" ? "spread" : "page"} may include lead-in and follow-up sentences, which are context, not extra moments.` : ""}`;
  const craft = craftPictureRules({ book, page, brief, earlierPages, time, cover });
  // R20: the story bible's planted object, reveal and motifs (drafts with a council only).
  const bible = biblePictureRules({ book, page, cover });
  const detail = `Props and small creatures: ${[...(brief?.props || []).map(en), en(brief?.creature)].filter(Boolean).join(", ") || "only those established in the current story or place references"}. Treat these as small movable details, not permanent architecture. Omit any detail that conflicts with the current event, approved wardrobe or fixed place; never add a new speaking character.${craft ? ` ${craft}` : ""}${bible ? ` ${bible}` : ""}${plan && !(framed && !cover) ? ` ${plan}` : ""}`;
  const background = place.background;
  const facts = background
    ? {
        name: background.nameEn || background.name,
        description:
          background.descriptionEn ||
          background.featuresEn ||
          background.description ||
          background.features,
        layout: background.layoutEn || background.layout,
        rules: background.rules,
      }
    : {};
  // R23: a policy book keeps the lock to two sentences, the continuity to the
  // last two pages and the ledger to this beat's three lines; the picture
  // model then reads the event instead of a wall of text.
  const lean = hasPromptPolicy(book.storyInput);
  const location = plain
    ? `Location: none. This page has no place: ${leadName} alone on a flat, single-colour background taken from the style palette, with big quiet empty space around the figure — a thought, a line spoken to the reader. No place reference image is attached; draw no room, no ground line, no scenery, no props beyond what the figure holds. Light as ${time}, within the style palette only.${
        earlierPages.length ? ` Earlier pages: ${json(earlierPages.slice(-PICTURE_CONTINUITY_PAGES))}. Keep the figure's state as it was.` : ""
      } Style references define rendering only. No words, captions, watermark or logos.`
    : closeView
    ? `Location: ${json(facts)}. ${staging.subLocation ? `View within this same place: ${staging.subLocation}. ` : ""}This is a close view: no place reference image is attached; keep the place's colours, materials and light from these facts, and let the figures fill the frame. Relight for ${time}.${
        earlierPages.length ? ` Earlier pages: ${json(earlierPages.slice(-PICTURE_CONTINUITY_PAGES))}. Keep prior consequences; previous poses and temporary props are not instructions to repeat.` : ""
      } Style references define rendering only. No words, captions, watermark or logos.`
    : lean
    ? `Location: ${json(facts)}. ${staging.subLocation ? `View within this same place: ${staging.subLocation}. ` : ""}${ARCHITECTURE_LOCK_SHORT} Relight the same geometry for ${time}. Earlier pages: ${json(earlierPages.slice(-PICTURE_CONTINUITY_PAGES))}. Keep prior consequences; previous poses and temporary props are not instructions to repeat. Style references define rendering only. No words, captions, watermark or logos.`
    : `Location: ${json(facts)}. ${staging.subLocation ? `View within this same place: ${staging.subLocation}. ` : ""}ARCHITECTURE LOCK: the approved place sheet is authoritative; the CANONICAL first scene establishes previously unspecified visible geometry. Preserve the exact doorway silhouette (arch/rectangle), door count, frame color, handle, windows, wall materials, roof, paths and relative structural positions across every view. Camera angle may change; the physical building must not. Background references define layout only: relight the SAME geometry for ${time}; prior daytime lighting must not override the brief. Recent scenes are secondary continuity references and cannot override the canonical layout. Never invent an extra entrance, bridge, tower, staircase or decorative structure to fill the composition. A sub-location must already exist in the place facts/reference; otherwise change only the camera position. Draw only architecture and props established by the place references or current story. A new permanent structure requires explicit story content. Do not transfer buildings from a different place. Earlier page continuity: ${json(earlierPages)}. Preserve prior action consequences while depicting this page event. Previous poses and temporary props are not instructions to duplicate them. Style references define rendering only. No words, captions, watermark or logos.`;
  const plot = plotContextForPage(book.outline, page);
  const continuity = plot && lean
    ? compactPlotLines(plot)
    : plot
    ? `LOCKED EVENT AND STATE LEDGER (scope: entire beat, not every page): ${json(plot)}. Draw ONLY the moment narrated on this page. Use earlier page consequences and the current narrative to determine which intermediate state applies. Do not jump to the beat's final result early, duplicate the whole beat, reintroduce a discarded prop, change its owner, or invent a new solution/structure. Approved setup/payoff references explain continuity; they are not visible text.`
    : "";
  return [
    composition,
    lighting,
    atmosphere,
    character,
    detail,
    location,
    continuity,
  ]
    .filter(Boolean)
    .join("\n\n");
}
