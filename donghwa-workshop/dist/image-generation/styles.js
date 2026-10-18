// Original, material-based styles. Style text never names an artist or studio.
const svgDataURL = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const coverReference = "/assets/hero.png";

function styleReference(id, palette) {
  const [paper, green, warm, blue, ink] = palette;
  const textured = id === "watercolor" || id === "crayon";
  const stroke =
    id === "comic"
      ? `stroke="${ink}" stroke-width="6" stroke-linejoin="round"`
      : "";
  const texture = textured
    ? `<defs><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="${id === "crayon" ? ".32" : ".65"}" numOctaves="3" stitchTiles="stitch" result="grain"/><feColorMatrix in="grain" type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${id === "crayon" ? ".21" : ".12"}"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>`
    : "";
  const opacity = id === "watercolor" ? ".78" : "1";
  return svgDataURL(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${texture}<g${textured ? ' filter="url(#paper)"' : ""}><rect width="512" height="512" fill="${paper}"/><circle cx="394" cy="104" r="47" fill="${warm}" opacity="${opacity}"/><path d="M0 320Q117 201 244 314T512 283V512H0Z" fill="${blue}" opacity="${opacity}" ${stroke}/><path d="M0 384Q111 305 258 359T512 352V512H0Z" fill="${green}" opacity="${opacity}" ${stroke}/><path d="M139 367V222" fill="none" stroke="${ink}" stroke-width="${id === "crayon" ? 13 : 9}" stroke-linecap="round"/><path d="M55 241Q64 130 139 119Q215 136 222 244Q151 277 55 241Z" fill="${green}" opacity="${opacity}" ${stroke}/><path d="M299 410Q283 375 306 363Q329 352 343 384Q363 359 381 375Q403 393 372 418Z" fill="${warm}" ${stroke}/>${palette.map((color, i) => `<circle cx="${76 + i * 90}" cy="467" r="23" fill="${color}" stroke="${ink}" stroke-width="1"/>`).join("")}</g></svg>`,
  );
}

const legacyRows = [
  {
    id: "watercolor",
    name: "커버의 포근한 수채화",
    version: 2,
    stylePrompt:
      "Original children’s picture-book illustration matching the attached cover illustration’s rendering: richly layered translucent watercolor and delicate colored-pencil brushwork on warm ivory cotton paper, visible fine paper grain, softly feathered edges, nuanced pigment variations and hand-painted foliage. Warm natural sunlight, softly modeled rounded forms with subtle volume and gentle shadows, expressive softly shaded faces with rosy cheeks and fine wispy hair strands. A tender, detailed and dimensional painted storybook feeling. The cover image is the authoritative visual style reference; character identity references define appearance only and must be repainted in this rendering. Preserve requested clothing and colors rather than copying the cover character.",
    negativePrompt:
      "flat vector art, geometric clip art, solid uniform color blocks, sticker graphics, icon design, rigid outlines, simplistic face dots, glossy 3D rendering, photorealism, frightening imagery, text, labels, watermark, logos, inconsistent character features",
    palette: ["#f5eedc", "#8ca481", "#ddb07b", "#a4bbc6", "#60584d"],
  },
  {
    id: "crayon",
    name: "파스텔 크레용",
    stylePrompt:
      "Original children’s picture-book illustration with wax-crayon and soft-pastel texture, warm paper, visible broken color strokes, friendly rounded silhouettes, gently imperfect hand-drawn lines and playful open space.",
    negativePrompt:
      "photorealism, glossy surfaces, hard digital gradients, sharp threatening shapes, text, watermark, logos, inconsistent character features",
    palette: ["#fff0df", "#9bb68d", "#e3a487", "#a8c8d4", "#705b53"],
  },
  {
    id: "flat",
    name: "플랫 일러스트",
    stylePrompt:
      "Original children’s picture-book illustration with clean flat colors, rounded geometric silhouettes, minimal interior detail, generous negative space, clear expressive faces and soft balanced color contrasts.",
    negativePrompt:
      "photorealism, heavy texture, complex gradients, visual clutter, hard shadows, text, watermark, logos, inconsistent character features",
    palette: ["#f6efe2", "#90ad89", "#e6b36d", "#98bfc7", "#526255"],
  },
  {
    id: "comic",
    name: "다정한 만화풍",
    stylePrompt:
      "Original children’s comic illustration with clear rounded ink contours, simple warm color fills, readable silhouettes, lively but gentle facial expressions, light cel shading and an uncluttered single-scene composition.",
    negativePrompt:
      "photorealism, aggressive sharp linework, dark frightening imagery, complex panels, speech bubbles, text, watermark, logos, inconsistent character features",
    palette: ["#fff1d7", "#93b184", "#eda776", "#9dbcd7", "#5a5249"],
  },
];

const COMMON_NEGATIVE =
  "text, letters, captions, watermark, logo, signature, known cartoon characters, photorealistic, extra fingers, distorted face, dark or scary imagery";
const rows = [
  {
    id: "watercolor",
    name: "커버의 포근한 수채화",
    version: 2,
    stylePrompt:
      "soft watercolor children's picture book illustration, visible paper texture, gentle wet-on-wet washes, loose ink outlines, warm pastel palette, simple friendly shapes, generous white space, cozy and calm mood, children's picture book scene, no text, no logos. Original children's picture-book illustration matching the attached cover illustration’s rendering: richly layered translucent watercolor and delicate colored-pencil brushwork on warm ivory cotton paper, visible fine paper grain, softly feathered edges, nuanced pigment variations and hand-painted foliage. Warm natural sunlight, softly modeled rounded forms with subtle volume and gentle shadows, expressive softly shaded faces with rosy cheeks and fine wispy hair strands. A tender, detailed and dimensional painted storybook feeling. The cover image is the authoritative visual style reference; character identity references define appearance only and must be repainted in this rendering. Preserve requested clothing and colors rather than copying the cover character.",
    negativePrompt: `${COMMON_NEGATIVE}, flat vector art, geometric clip art, solid uniform color blocks, sticker graphics, icon design, rigid outlines, simplistic face dots, glossy 3D rendering, inconsistent character features`,
    palette: ["#f5eedc", "#8ca481", "#ddb07b", "#a4bbc6", "#60584d"],
  },
  {
    id: "crayon",
    name: "파스텔 크레용",
    version: 2,
    stylePrompt:
      "children's book illustration in soft pastel crayon and colored pencil, visible waxy strokes and paper grain, rounded simple characters, bright but gentle colors, naive playful style, flat perspective, children's picture book scene, no text, no logos",
    negativePrompt: COMMON_NEGATIVE,
    palette: ["#fff0df", "#9bb68d", "#e3a487", "#a8c8d4", "#705b53"],
  },
  {
    id: "theatrical",
    name: "극장 애니메이션풍 · Z스타일",
    version: 1,
    stylePrompt:
      "hand-painted watercolor and gouache backgrounds, lush greenery, big soft cumulus clouds, soft diffused natural light, 1980s-90s Japanese theatrical animation look, cel-shaded characters with simple rounded faces, small dot noses, expressive but modest eyes, clean thin line art, muted earthy palette with warm highlights, nostalgic countryside atmosphere, subtle film grain, children's picture book scene, no text, no logos",
    negativePrompt: COMMON_NEGATIVE,
    palette: ["#f6f1de", "#799d6a", "#deb476", "#9abdc6", "#555953"],
  },
  {
    id: "animated3d",
    name: "3D 애니메이션풍 · D스타일",
    version: 1,
    stylePrompt:
      "modern 3D animated feature film look, stylized rounded characters with large expressive eyes and soft skin, big head and small body proportions for children, smooth global illumination with warm rim light, vibrant saturated colors, polished render, shallow depth of field, friendly and cute, children's picture book scene, no text, no logos",
    negativePrompt: COMMON_NEGATIVE,
    palette: ["#fff1db", "#81b98c", "#f1bb6e", "#92c5db", "#615449"],
    twoDimensionalOption:
      "classic 2D hand-drawn animated musical feature look, fluid expressive lines, rich painted backgrounds, 1990s aesthetic",
  },
];

const freezeRow = (row, isBuiltIn = true) =>
  Object.freeze({
    ...row,
    version: row.version || 1,
    isBuiltIn,
    palette: Object.freeze([...row.palette]),
    styleRefImageIds: Object.freeze([...(row.styleRefImageIds || [])]),
    styleRefImages: Object.freeze([
      ...(row.styleRefImages || [
        row.id === "watercolor"
          ? coverReference
          : styleReference(row.id, row.palette),
      ]),
    ]),
  });
export const STYLE_PRESETS = Object.freeze(rows.map((row) => freezeRow(row)));
export const LEGACY_STYLE_PRESETS = Object.freeze(
  legacyRows.map((row) => freezeRow(row)),
);
export const DEFAULT_FORBIDDEN_STYLE_WORDS = Object.freeze([
  "disney",
  "pixar",
  "dreamworks",
  "ghibli",
  "miyazaki",
  "studio ghibli",
  "totoro",
  "mickey",
  "frozen",
  "elsa",
  "디즈니",
  "픽사",
  "드림웍스",
  "지브리",
  "미야자키",
  "토토로",
  "겨울왕국",
  "엘사",
  "미키마우스",
  "미키 마우스",
]);
const aliases = {
  cartoon: "comic",
  만화풍: "comic",
  "다정한 만화풍": "comic",
  "수채화 그림책풍": "watercolor",
  "수채화 그림책": "watercolor",
  Z스타일: "theatrical",
  D스타일: "animated3d",
};
let customPresets = [];
let customForbiddenWords = [];
/** NFKC with zero-width and other format characters (\p{Cf}) removed, so "Dis\u200bney" is "Disney". */
const visible = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "");
const lower = (value) => visible(value).toLowerCase();
/**
 * Distinctive studio, artist, film and character names, also written split
 * or joined ("Dream Works", "dream-works", "DreamWorks"). No ordinary English
 * word contains them, so they count anywhere, also joined to other words
 * ("DisneyPixar", "studioghibli", "pixar3d"). "pixart" (pixel art) is another word.
 */
const BRAND_WORDS = new Map([
  ["disney", /disney/iu],
  ["pixar", /pixar(?!t)/iu],
  ["dreamworks", /dream[\s_-]*works/iu],
  ["ghibli", /ghibli/iu],
  ["miyazaki", /miyazaki/iu],
  ["studio ghibli", /studio[\s_-]*ghibli/iu],
  ["totoro", /totoro/iu],
]);
/**
 * In model-written story text "her dream works" is English: there a brand
 * split by a space counts only written as the name ("Dream Works").
 */
const STORY_BRAND_WORDS = new Map([
  ["dreamworks", [/dream[_-]*works/iu, /Dream\s+Works|DREAM\s+WORKS/u]],
]);
/** Ordinary English words that are also a film title ("the pond was frozen"). */
const TITLE_WORDS = new Set(["frozen"]);
const STYLE_SUFFIXES = new Set(["esque", "ish", "like", "style", "styled"]);
/** An optional sequel between the title and its cue: "Frozen 2 style", "Frozen II-inspired". */
const SEQUEL = String.raw`(?:[\s-]*(?:\d{1,2}|ii|iii|two)(?![a-z0-9]))?`;
// "frozen like a statue" and "a frozen look" are story English; "frozen-like", "frozen style" and "Frozen 2 style" are not.
const STYLE_CUE = new RegExp(
  String.raw`^${SEQUEL}(?:-like|[\s"'’)\]-]*(?:style|styled|movie|animation|animated|aesthetic|inspired|themed|풍|스타일|처럼|같은|같이|느낌))`,
  "iu",
);
// Cues that are ordinary words after a lowercase "frozen" ("a thin frozen film", "the frozen princess",
// "a frozen look") count only after the written title, Title-case or all caps: "Frozen princess dress",
// "Frozen look", "FROZEN THEME".
const TITLE_CUE = new RegExp(
  String.raw`^${SEQUEL}[\s"'’)\]-]*(?:films?|princess(?:es)?|look(?:s|ing)?|theme[sd]?|vibes?)(?![a-z])`,
  "iu",
);
// "Frozen 2", "Frozen II": the Title-case title with a sequel number names the film.
const TITLE_SEQUEL = /^[\s-]*(?:\d{1,2}|ii|iii)(?![\p{L}\p{N}])/iu;
// A style cue before the title: "like Frozen", "like in Frozen", "inspired by Frozen", "in the style of Frozen",
// "the movie Frozen", "a dress from Frozen", "similar to Frozen", "as seen in Frozen".
const STYLE_CUE_BEFORE =
  /(?:^|[^\p{L}\p{N}])(?:like(?:\s+in)?|inspired\s+by|style\s+of|as\s+(?:seen\s+)?in|based\s+on|similar\s+to|from|movie|film|영화|애니메이션|애니)(?:\s+the)?[\s"'“‘(\[]*$/iu;
// After such a cue, "like frozen glass" and "like frozen, he waited" still describe ice;
// "like Frozen", "like FROZEN", "like frozen." and "like frozen 2" name the film.
const NEXT_LATIN_WORD = /^[\s"'’”)\],;-]*[a-z]/i;
const TITLE_CASE = /^\p{Lu}\p{Ll}/u,
  ALL_CAPS = /^\p{Lu}{2,}$/u;
/**
 * What may follow a cast name inside one Korean token for it to stay the name:
 * one particle ("토토로" is 토토 + 로, "토토로서" is 토토 + 로서), then up to two
 * more and a polite 요 ("토토로써는", "토토로의", "토토로는요", "토토로부터").
 * "미야자키풍" (미야), "겨울왕국처럼" (겨울) or "토토로봇" (토토) is not.
 */
const NAME_PARTICLE =
  /^(?:(?:으로|로)(?:서|써)?|에게|한테|에서|에|와|과|이랑|랑|처럼|부터|까지|는|은|가|이|를|을|의|도|만)(?:의|는|은|도|만|부터|까지){0,2}요?$/u;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/u;
const ASCII_WORD = /[a-z0-9]/;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A title word ("frozen") counts outside style text only as a style reference. */
function titleUsedAsStyle(text, match, scope) {
  const suffix = (match[1] || "").toLowerCase();
  // "frozenesque", "Frozen2": a joined suffix or sequel number is never story English.
  if (STYLE_SUFFIXES.has(suffix) || /^\d+$/.test(suffix)) return true;
  const after = text.slice(match.index + match[0].length),
    title = TITLE_CASE.test(match[0]),
    caps = ALL_CAPS.test(match[0]);
  if (STYLE_CUE.test(after)) return true;
  if ((title || caps) && TITLE_CUE.test(after)) return true;
  if (title && TITLE_SEQUEL.test(after)) return true;
  // Parent-entered material also counts a cue before the title. Title-case
  // "Frozen" is the title whatever follows; "frozen" and "FROZEN" only when no
  // Latin word follows ("like FROZEN" is the title, "LIKE FROZEN SNOW" is ice).
  return (
    scope === "material" &&
    STYLE_CUE_BEFORE.test(text.slice(0, match.index)) &&
    (title || !NEXT_LATIN_WORD.test(after))
  );
}
function latinMatches(text, word, scope) {
  const brand = BRAND_WORDS.get(word);
  if (brand)
    return scope === "description" && STORY_BRAND_WORDS.has(word)
      ? STORY_BRAND_WORDS.get(word).some((pattern) => pattern.test(text))
      : brand.test(text);
  const body = word.split(/\s+/).map(escapeRegExp).join("[\\s_-]+"),
    left = ASCII_WORD.test(word[0]) ? "(?<![a-z0-9])" : "",
    right = ASCII_WORD.test(word.at(-1))
      ? "(\\d+|'?s|es|esque|ish|like|land|mouse|style|styled)?(?![a-z0-9])"
      : "()",
    pattern = new RegExp(left + body + right, "giu");
  for (const match of text.matchAll(pattern)) {
    // Style text counts every match; material and story text a title word only as a style reference.
    if (
      (scope !== "description" && scope !== "material") ||
      !TITLE_WORDS.has(word)
    )
      return true;
    if (titleUsedAsStyle(text, match, scope)) return true;
  }
  return false;
}
function hangulMatches(text, word, names) {
  // "미키 마우스" also matches "미키  마우스" and "미키-마우스".
  const pattern = new RegExp(
    word.split(/\s+/).map(escapeRegExp).join("[\\s_-]+"),
    "gu",
  );
  for (
    let match = pattern.exec(text);
    match;
    pattern.lastIndex = match.index + 1, match = pattern.exec(text)
  ) {
    const index = match.index,
      found = match[0];
    let start = index,
      end = index + found.length;
    while (start > 0 && HANGUL.test(text[start - 1])) start--;
    while (end < text.length && HANGUL.test(text[end])) end++;
    // "토토로" right after a known name such as 토토 is the name plus particles, not the film.
    const nameWithParticle =
      start === index &&
      names.some(
        (name) =>
          name.length < found.length &&
          found.startsWith(name) &&
          NAME_PARTICLE.test(text.slice(index + name.length, end)),
      );
    if (!nameWithParticle) return true;
  }
  return false;
}
/**
 * Forbidden studio, artist, work and character names found in `value`.
 * Zero-width and other format characters are ignored ("Dis\u200bney").
 * Distinctive names ("disney", "ghibli", "dreamworks") match anywhere, also
 * joined to other words or split ("Dream Works"). Names that are ordinary
 * English words ("frozen", "elsa", "mickey") and the parent's extra words
 * match whole words, plus a few suffixes such as "frozenesque" or "Frozen2".
 * Korean words match inside a token unless the token is a known character
 * name (`names`) followed only by particles ("토토로서", "토토로는요").
 * Scopes: 'style' (the default) is for style text and counts every match.
 * 'material' is for parent-entered text (character, place and wardrobe
 * descriptions, a page's own image prompt): a title that is also an ordinary
 * word ("frozen") counts only with a style cue before or after it ("like
 * Frozen", "a dress from Frozen", "Frozen 2 style", "Frozen 느낌"); weak cues
 * after it ("film", "princess", "look", "theme", "vibe") count only after
 * Title-case or all-caps "Frozen", a bare sequel number ("Frozen II") only
 * after Title-case, and a cue before lowercase or all-caps "frozen" only when
 * no Latin word follows ("LIKE FROZEN SNOW" is ice). 'description' is for
 * model-written story text and the cover action: only a cue after it counts,
 * so "the lake looked like frozen glass" passes.
 */
export function forbiddenStyleMatches(
  value,
  extras = [],
  { names = [], scope = "style" } = {},
) {
  const source = visible(value),
    text = source.toLowerCase(),
    known = [...new Set((names || []).map(lower).map((n) => n.trim()))].filter(
      Boolean,
    );
  return [
    ...new Set(
      [...DEFAULT_FORBIDDEN_STYLE_WORDS, ...(extras || [])]
        .map(lower)
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  ].filter((word) =>
    HANGUL.test(word)
      ? hangulMatches(text, word, known)
      : /[a-z0-9]/.test(word)
        ? latinMatches(source, word, scope)
        : text.includes(word),
  );
}
/** Call on library changes; IDs in imported/frozen books retain their own copies. */
export function setCustomStylePresets(state = {}) {
  customForbiddenWords = Array.isArray(state.settings?.forbiddenStyleWords)
    ? state.settings.forbiddenStyleWords
    : [];
  customPresets = (Array.isArray(state.stylePresets) ? state.stylePresets : [])
    .filter(
      (row) =>
        row &&
        !row.isBuiltIn &&
        !STYLE_PRESETS.some((b) => b.id === row.id) &&
        validateStylePreset(row, { forbiddenWords: customForbiddenWords })
          .valid,
    )
    .map((row) => ({
      ...row,
      isBuiltIn: false,
      palette: [...row.palette],
      styleRefImageIds: [...(row.styleRefImageIds || [])],
      styleRefImages: [...(row.styleRefImages || [])],
    }));
  return customPresets;
}
export function listStylePresets(state) {
  if (state) setCustomStylePresets(state);
  return [...STYLE_PRESETS, ...customPresets];
}
export function getStylePreset(id = "watercolor", state) {
  if (id && typeof id === "object") return id;
  if (state) setCustomStylePresets(state);
  const key = aliases[id] || id;
  return (
    [...STYLE_PRESETS, ...customPresets, ...LEGACY_STYLE_PRESETS].find(
      (row) => row.id === key || row.name === key,
    ) || STYLE_PRESETS[0]
  );
}
/** Names are free parent labels; style descriptions may only describe visual elements. */
export function validateStylePreset(preset, options = {}) {
  const errors = [];
  if (!preset || typeof preset !== "object")
    return { valid: false, errors: ["화풍 프리셋이 필요해요."] };
  for (const field of ["name", "stylePrompt", "negativePrompt"])
    if (typeof preset[field] !== "string" || !preset[field].trim())
      errors.push(`${field} 항목을 채워 주세요.`);
  if (typeof preset.name === "string" && preset.name.length > 80)
    errors.push("화풍 이름은 80자 이하로 적어 주세요.");
  if (
    typeof preset.stylePrompt === "string" &&
    preset.stylePrompt.length > 5000
  )
    errors.push("화풍 설명은 5000자 이하로 적어 주세요.");
  if (
    !Array.isArray(preset.palette) ||
    preset.palette.length < 5 ||
    preset.palette.length > 6 ||
    preset.palette.some((color) => !/^#[\da-f]{6}$/i.test(color))
  )
    errors.push("palette는 6자리 색상 코드 5~6개여야 해요.");
  if (
    preset.styleRefImages !== undefined &&
    (!Array.isArray(preset.styleRefImages) ||
      preset.styleRefImages.some(
        (url) =>
          typeof url !== "string" ||
          !/^(data:image\/(?:svg\+xml|png|jpeg|webp)(?:;|,)|https?:\/\/|\/|asset:|blob:)/i.test(
            url,
          ),
      ))
  )
    errors.push("화풍 레퍼런스 주소를 확인해 주세요.");
  if (
    preset.styleRefImageIds !== undefined &&
    (!Array.isArray(preset.styleRefImageIds) ||
      preset.styleRefImageIds.some(
        (id) => typeof id !== "string" || !/^image-[a-zA-Z0-9-]+$/.test(id),
      ))
  )
    errors.push("앱에서 생성한 스타일 시트만 고정할 수 있어요.");
  const text = [preset.name, preset.stylePrompt, preset.negativePrompt]
    .filter((v) => typeof v === "string")
    .join("\n");
  const matches = forbiddenStyleMatches(
    text,
    options.forbiddenWords || customForbiddenWords,
  );
  if (matches.length)
    errors.push(
      `금칙어가 들어 있어 저장할 수 없어요: ${matches.join(", ")}. 이름 대신 재료·선·색·조명·구도를 설명해 주세요.`,
    );
  const namedReference =
    /\bin\s+(?:the\s+)?style\s+of\b|\binspired\s+by\s+(?!the\s+(?:scene|palette|reference|cover)\b)|\b(?:drawn|painted|illustrated)\s+by\b|(?:스튜디오|작가|화가|감독)\s*(?:의|풍|스타일)|[가-힣]{2,20}\s*의\s*(?:작품|그림)(?:\s*처럼|\s*같이)/i;
  if (namedReference.test(text))
    errors.push(
      "스튜디오·작가·작품의 이름을 화풍 지시로 사용할 수 없어요. 시각 요소로 풀어 적어 주세요.",
    );
  return { valid: errors.length === 0, errors, forbiddenWords: matches };
}
