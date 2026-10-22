import { ENGLISH_ONOMATOPOEIA } from "./reading-vocab.js";
/** Shared context: only canonical English fields are tokenized, never arbitrary notes. */
const words = (value) =>
  typeof value === "string"
    ? value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []
    : [];
export function buildStoryWords(
  source = {},
  outline = source.outline,
  characters = [],
  // R31d: on the diet the story's own things are English words a child meets
  // in this book — the scene briefs' props, creatures and sounds and the
  // backgrounds' English names — at every level, as the outline's new words.
  { briefs = [], lean = false } = {},
) {
  const input = source.storyInput || source.input || source;
  const cast = input.characters || source.characterSnapshots || characters;
  const world =
    input.storyWorld ||
    input.storyWorldSnapshot ||
    outline?.storyWorldSnapshot ||
    outline?.quality?.worldSnapshot ||
    outline?.quality?.worldMood?.world ||
    source.storyWorld ||
    source.storyWorldSnapshot ||
    {};
  const fields = [world.name?.en];
  for (const key of ["landmarks", "subLocations", "creatures"])
    for (const row of world[key] || [])
      fields.push(typeof row === "string" ? row : row.en || row.name?.en);
  const extra = [];
  if (lean) {
    for (const bg of input.backgrounds || source.backgrounds || [])
      extra.push(bg?.nameEn, bg?.name?.en);
    const rows = Array.isArray(briefs?.briefs) ? briefs.briefs : Array.isArray(briefs) ? briefs : [];
    for (const brief of rows) {
      for (const prop of brief?.props || []) extra.push(typeof prop === "string" ? prop : prop?.en);
      for (const sound of brief?.sounds || []) extra.push(typeof sound === "string" ? sound : sound?.en);
      extra.push(typeof brief?.creature === "string" ? brief.creature : brief?.creature?.en);
    }
  }
  return [
    ...new Set(
      [
        ...cast.map((c) => c.nameEn || c.englishName || c.name?.en),
        ...fields,
        ...(outline?.newWordsEn || []),
        ...extra.flatMap(words).flatMap((w) => w.split(/[-'’]/)),
      ]
        .flatMap(words)
        .map((w) => w.toLowerCase()),
    ),
  ];
}
export function englishVocabularyPrompt(spec, storyWords = []) {
  const label = spec.vocabSource || spec.vocab || "frozen selected vocabulary";
  const list = [
    ...new Set([
      ...(spec.vocabList || []),
      ...(spec.allowOnomatopoeia ? ENGLISH_ONOMATOPOEIA : []),
    ]),
  ];
  return `${(spec.vocabList || []).length <= 300 ? list.join(", ") : label}${spec.storyWordsAllowed ? `; Story words: ${storyWords.join(", ")}` : ""}`;
}
