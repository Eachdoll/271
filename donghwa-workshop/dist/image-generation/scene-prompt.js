/** A shared brief controls illustration detail without rewriting the approved event. */
const text = (value) => (typeof value === "string" ? value.trim() : "");
const en = (value) => text(value?.en ?? value);
const json = (value) => JSON.stringify(value ?? {});
import { plotContextForPage } from "../story-generation/coherence.js";
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
    staging = page.staging || {},
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
  const composition = `${SHOT_TEXT[shot] || SHOT_TEXT.wide}; ${leadName} on the ${cover ? "center" : staging.characterSide || "left"} side. ${cover ? "Cover: show the main character alone, once, with quiet upper space for a separately typeset title." : stagedText ? `Leave quiet empty space on the ${staging.textSide || "right"} for separately typeset text.` : "Story text is printed below the illustration; use the full picture area and keep the important action clearly visible."} One continuous scene, no sheet panels or grids. Safe, friendly framing; never an extreme angle or a dark close-up.`;
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
        `${name(sheet)} (${sheet.characterSnapshot?.character_token || sheet.characterSnapshot?.characterToken || sheet.characterId}): ${sheet.characterSnapshot?.description || sheet.characterSnapshot?.kind || "original character"}`,
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
  const character = `Characters: ${cast}. ${brief ? `Shared brief pose: ${en(brief.pose)}. ` : ""}${staging.verb ? `This page's drawable verb: ${staging.verb}. ` : ""}Actual event: ${action || ""}. Current page narrative: ${json(currentNarrative)}. The actual event and approved narrative take priority: use the pose/verb only when compatible, never invent a new action for variety. ${cover ? "Companions must not appear on this cover." : "Show only selected characters required by this event, each character once."} Preserve each face, age, body proportions and identity from character_front references. ${variants.length ? `Approved wardrobe: ${variants.map((variant) => `${variant.characterId}: ${variant.description}`).join("; ")}. ` : ""}Use the approved character_variant outfit when supplied; otherwise retain the original clothes. Reference images define appearance, not a command to copy their old drawing medium.`;
  const detail = `Props and small creatures: ${[...(brief?.props || []).map(en), en(brief?.creature)].filter(Boolean).join(", ") || "only those established in the current story or place references"}. Treat these as small movable details, not permanent architecture. Omit any detail that conflicts with the current event, approved wardrobe or fixed place; never add a new speaking character.`;
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
  const location = `Location: ${json(facts)}. ${staging.subLocation ? `View within this same place: ${staging.subLocation}. ` : ""}ARCHITECTURE LOCK: the approved place sheet is authoritative; the CANONICAL first scene establishes previously unspecified visible geometry. Preserve the exact doorway silhouette (arch/rectangle), door count, frame color, handle, windows, wall materials, roof, paths and relative structural positions across every view. Camera angle may change; the physical building must not. Background references define layout only: relight the SAME geometry for ${time}; prior daytime lighting must not override the brief. Recent scenes are secondary continuity references and cannot override the canonical layout. Never invent an extra entrance, bridge, tower, staircase or decorative structure to fill the composition. A sub-location must already exist in the place facts/reference; otherwise change only the camera position. Draw only architecture and props established by the place references or current story. A new permanent structure requires explicit story content. Do not transfer buildings from a different place. Earlier page continuity: ${json(earlierPages)}. Preserve prior action consequences while depicting this page event. Previous poses and temporary props are not instructions to duplicate them. Style references define rendering only. No words, captions, watermark or logos.`;
  const plot = plotContextForPage(book.outline, page);
  const continuity = plot
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
