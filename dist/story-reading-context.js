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
  return [
    ...new Set(
      [
        ...cast.map((c) => c.nameEn || c.englishName || c.name?.en),
        ...fields,
        ...(outline?.newWordsEn || []),
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
