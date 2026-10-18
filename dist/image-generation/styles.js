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
/**
 * Characters that render as nothing and could hide a name ("Dis\u200bney",
 * "Dis\u3164ney"): format characters (\p{Cf}) and other default-ignorable code
 * points, the combining grapheme joiner U+034F, the Hangul fillers U+115F,
 * U+1160, U+3164 and U+FFA0, and the variation selectors U+FE00-U+FE0F.
 */
const INVISIBLE =
  /[\p{Cf}\p{Default_Ignorable_Code_Point}\u034f\u115f\u1160\u3164\uffa0\ufe00-\ufe0f]/gu;
/** The text every forbidden-name check reads: invisible characters removed, then NFKC. */
export const normalizeForbiddenText = (value) =>
  String(value ?? "")
    .replace(INVISIBLE, "")
    .normalize("NFKC")
    .replace(INVISIBLE, "");
const lower = (value) => normalizeForbiddenText(value).toLowerCase();
/*
 * ONE forbidden-name policy for every image request.
 *
 * STRICT ('strict'; the older names 'style' and 'material' mean the same) is
 * text a parent typed: style preset names and descriptions, the parent's extra
 * words, character, place and wardrobe descriptions, a page's own image prompt
 * and a cover action the parent edited. It refuses
 *  - brand names anywhere, also joined to other words or split where their
 *    words meet: disney, pixar (not "pixart"), ghibli, studio ghibli,
 *    dreamworks / dream works, miyazaki, totoro, mickey mouse;
 *  - "Frozen", "Elsa" and "Mickey" written Title-case or all caps, anywhere
 *    (case-sensitive); in any other case only tied directly to a style cue
 *    ("frozen style", "frozen-esque", "frozen 영화", "inspired by frozen");
 *  - the Korean names 겨울왕국, 디즈니, 픽사, 지브리, 미야자키, 토토로, 엘사,
 *    미키마우스, 드림웍스, with or without spaces between syllables.
 *  No cast name exempts anything: "토토로부터" is refused and the advice
 *  suggests "토토에게서".
 * LENIENT ('lenient'; older name 'description') is model-written story text:
 * page text, a generated cover action, scene briefs. Only the brand names and
 * the Korean names written joined count, never the title words, so "Frozen
 * look on his face" and "the frozen princess" pass. A Korean name that is one
 * of the book's cast names plus particles ("토토로 달려가요" with 토토 in the
 * cast) is that character.
 * App scaffolding is never checked: request builders declare their parts in
 * `forbiddenWordCheck: {text, generated, names}` (strict, lenient, cast names)
 * and every path runs checkForbiddenWordCheck on them.
 */
const LENIENT_SCOPES = new Set(["lenient", "description", "generated", "story"]);
const scopeOf = (scope) => (LENIENT_SCOPES.has(scope) ? "lenient" : "strict");
const DASHES = String.raw`\-\u2010-\u2015`;
/** Between the words of a brand ("Dream Works", "mickey-mouse", "studio_ghibli"). */
const LATIN_JOIN = String.raw`[\s_${DASHES}\u00b7]*`;
/** Between the syllables of a Korean name in parent text ("겨울 왕국", "드림 웍스"). */
const HANGUL_JOIN = String.raw`[\s_${DASHES}\u00b7\u30fb]*`;
/** [strict patterns, lenient patterns]; one list serves both when they agree. */
const BRANDS = new Map([
  ["disney", [[/disney/iu]]],
  // "pixart" (pixel art, PixArt-α/Σ) is another word; "Pixartoon" is not.
  ["pixar", [[/pixar(?!t(?:$|[^a-z]|alpha|sigma))/iu]]],
  [
    "dreamworks",
    [
      [new RegExp(`dream${LATIN_JOIN}works`, "iu")],
      // Story English "her dream works": split by a space it counts only written as the name.
      [
        new RegExp(`dream[_${DASHES}]*works`, "iu"),
        /Dream\s+Works|DREAM\s+WORKS/u,
      ],
    ],
  ],
  ["ghibli", [[/ghibli/iu]]],
  ["studio ghibli", [[new RegExp(`studio${LATIN_JOIN}ghibli`, "iu")]]],
  ["miyazaki", [[/miyazaki/iu]]],
  ["totoro", [[/totoro/iu]]],
]);
/** Ordinary English words or given names that are also a film or its characters. */
const TITLE_WORDS = new Map([
  ["frozen", { written: /(?<![A-Za-z])(?:Frozen|FROZEN)/u }],
  ["elsa", { written: /(?<![A-Za-z])(?:Elsa|ELSA)/u }],
  [
    "mickey",
    {
      written: /(?<![A-Za-z])(?:Mickey|MICKEY)/u,
      brand: new RegExp(`mickey${LATIN_JOIN}mouse`, "iu"),
    },
  ],
]);
// An optional sequel between the word and its cue: "frozen 2 style", "frozen ii-inspired".
const SEQUEL = String.raw`(?:[\s${DASHES}]*(?:\d{1,2}|ii|iii|two)(?![a-z0-9]))?`;
// A style cue right after the word: "frozen style", "frozen-like", "frozen 2 movie", "frozen풍", "elsa처럼".
const CUE_AFTER = new RegExp(
  String.raw`^${SEQUEL}(?:[${DASHES}]like(?![a-z])|[\s"'’”)\]_${DASHES}]*(?:styled?|styles|movies?|films?|animation|animated|aesthetic|inspired|themed?|themes|looks?|vibes?|esque|ish|영화|애니|풍|느낌|스타일|처럼|같은|같이)(?![a-z]))`,
  "iu",
);
// A cue before the word that names a source ("inspired by frozen", "the movie frozen",
// "영화 frozen"): the word is the title unless a Latin word follows it directly.
const CUE_BEFORE_SOURCE =
  /(?:^|[^\p{L}\p{N}])(?:inspired\s+by|(?:in\s+the\s+)?style\s+of|based\s+on|as\s+seen\s+in|similar\s+to|movies?|films?|영화|애니(?:메이션)?)(?:\s+the)?[\s"'“‘(\[:]*$/iu;
// "like frozen" names the film; "like frozen glass" and "like frozen, he waited" are ice.
const CUE_BEFORE_LIKE =
  /(?:^|[^\p{L}\p{N}])like(?:\s+in)?(?:\s+the)?[\s"'“‘(\[]*$/iu;
const NEXT_WORD = /^[\s"'’”)\]-]*[a-z]/i,
  NEXT_WORD_PAST_COMMA = /^[\s"'’”)\],;-]*[a-z]/i;
/**
 * What may follow a cast name inside one Korean token for it to stay the name:
 * one particle ("토토로" is 토토 + 로, "토토로서" is 토토 + 로서), then up to two
 * more and a polite 요 ("토토로써는", "토토로의", "토토로는요", "토토로부터").
 * "미야자키풍" (미야), "겨울왕국처럼" (겨울) or "토토로봇" (토토) is not.
 */
const NAME_PARTICLE =
  /^(?:(?:으로|로)(?:서|써)?|에게|한테|에서|에|와|과|이랑|랑|처럼|부터|까지|는|은|가|이|를|을|의|도|만)(?:의|는|은|도|만|부터|까지){0,2}요?$/u;
// After a bare 로 a noun or style word makes it the film again: "토토로 인형", "토토로 같은 숲".
const IP_NOUN_AFTER =
  /^\s+(?:인형|스타일|느낌|풍|같은|같이|처럼|캐릭터|그림|영화|애니|굿즈|무늬|모양|옷|잠옷|가방|모자|티셔츠|코스튬|분장)/u;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/u;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const excerptOf = (value) =>
  value.length > 40 ? `${value.slice(0, 39)}…` : value;

function brandFinding(source, word, scope) {
  const [strict, lenient = strict] = BRANDS.get(word);
  for (const pattern of scope === "lenient" ? lenient : strict) {
    const match = pattern.exec(source);
    if (match) return { word, kind: "brand", excerpt: match[0] };
  }
  return null;
}
function titleFinding(source, word, scope) {
  const rule = TITLE_WORDS.get(word),
    brand = rule.brand?.exec(source);
  if (brand) return { word, kind: "brand", excerpt: brand[0] };
  if (scope === "lenient") return null;
  // Written as the title or name, anywhere: "a blue Frozen dress", "FROZEN II", "Elsa".
  const written = rule.written.exec(source);
  if (written) return { word, kind: "title", excerpt: written[0] };
  // Any other spelling only with a style cue directly before or after it.
  const pattern = new RegExp(
    `(?<![a-z0-9])${word}(esque|ish|like|styled?|\\d+)?(?![a-z0-9])`,
    "giu",
  );
  for (const match of source.matchAll(pattern)) {
    const before = source.slice(0, match.index),
      after = source.slice(match.index + match[0].length);
    if (
      match[1] ||
      CUE_AFTER.test(after) ||
      (CUE_BEFORE_SOURCE.test(before) && !NEXT_WORD.test(after)) ||
      (CUE_BEFORE_LIKE.test(before) && !NEXT_WORD_PAST_COMMA.test(after))
    )
      return { word, kind: "title-cue", excerpt: match[0] };
  }
  return null;
}
/** The cast name a Korean token spells with particles only ("토토로부터" → 토토), if any. */
function castNameWithParticle(compact, tail, names) {
  return (
    names.find(
      (name) =>
        name.length < compact.length &&
        compact.startsWith(name) &&
        NAME_PARTICLE.test(compact.slice(name.length) + tail),
    ) || null
  );
}
function hangulFinding(text, word, scope, names, kind) {
  const compact = word.replace(/\s+/g, ""),
    pattern =
      scope === "lenient"
        ? new RegExp(word.split(/\s+/).map(escapeRegExp).join("[\\s_-]+"), "gu")
        : new RegExp([...compact].map(escapeRegExp).join(HANGUL_JOIN), "gu");
  for (
    let match = pattern.exec(text);
    match;
    pattern.lastIndex = match.index + 1, match = pattern.exec(text)
  ) {
    const index = match.index;
    let start = index,
      end = index + match[0].length;
    while (start > 0 && HANGUL.test(text[start - 1])) start--;
    while (end < text.length && HANGUL.test(text[end])) end++;
    // A name written apart ("겨울 왕국") starts a word: "다니엘 사과" is not 엘사.
    if (match[0] !== compact && start !== index) continue;
    const tail = text.slice(index + match[0].length, end),
      castName =
        start === index && match[0] === compact
          ? castNameWithParticle(compact, tail, names)
          : null;
    // Lenient: a cast name plus particles is the character, unless a bare 로 is followed by a noun.
    if (
      scope === "lenient" &&
      castName &&
      !(
        /^(?:으로|로)$/u.test(compact.slice(castName.length) + tail) &&
        IP_NOUN_AFTER.test(text.slice(end))
      )
    )
      continue;
    return {
      word,
      kind,
      excerpt: text.slice(start, end),
      ...(castName ? { castName } : {}),
    };
  }
  return null;
}
/** A parent's extra Latin word: whole words, a few suffixes ("mooncats", "mooncat-style"). */
function extraLatinFinding(source, word) {
  const body = word.split(/\s+/).map(escapeRegExp).join(`[\\s_${DASHES}]+`),
    left = /[a-z0-9]/.test(word[0]) ? "(?<![a-z0-9])" : "",
    right = /[a-z0-9]/.test(word.at(-1))
      ? "(?:\\d+|'?s|es|esque|ish|like|land|mouse|style|styled)?(?![a-z0-9])"
      : "",
    match = new RegExp(left + body + right, "iu").exec(source);
  return match ? { word, kind: "custom", excerpt: match[0] } : null;
}
function wordFinding(source, text, word, scope, names, extra) {
  if (BRANDS.has(word)) return brandFinding(source, word, scope);
  if (TITLE_WORDS.has(word)) return titleFinding(source, word, scope);
  if (HANGUL.test(word))
    return hangulFinding(text, word, scope, names, extra ? "custom" : "korean");
  if (/[a-z0-9]/.test(word)) return extraLatinFinding(source, word);
  return text.includes(word)
    ? { word, kind: extra ? "custom" : "brand", excerpt: word }
    : null;
}
const DEFAULT_WORDS = new Set(DEFAULT_FORBIDDEN_STYLE_WORDS.map(lower));
/**
 * Every forbidden name in `value` under one scope, with where it was found:
 * [{word, kind: 'brand'|'title'|'title-cue'|'korean'|'custom', excerpt,
 * castName?, scope}]. `names` are cast names: in lenient scope a Korean name
 * that is one of them plus particles is that character; in strict scope they
 * only shape the advice ("토토로부터" → "토토에게서").
 */
export function forbiddenWordFindings(
  value,
  { scope = "strict", names = [], extras = [] } = {},
) {
  const source = normalizeForbiddenText(value),
    text = source.toLowerCase(),
    mode = scopeOf(scope),
    known = [
      ...new Set((names || []).map(lower).map((name) => name.trim())),
    ].filter(Boolean);
  return [
    ...new Set(
      [...DEFAULT_FORBIDDEN_STYLE_WORDS, ...(extras || [])]
        .map(lower)
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  ]
    .map((word) =>
      wordFinding(source, text, word, mode, known, !DEFAULT_WORDS.has(word)),
    )
    .filter(Boolean)
    .map((finding) => ({
      ...finding,
      excerpt: excerptOf(finding.excerpt),
      scope: mode,
    }));
}
/**
 * Forbidden studio, artist, work and character names found in `value`, as
 * the matched list words. Scope 'strict' (default; also 'style', 'material')
 * or 'lenient' (also 'description'); see forbiddenWordFindings.
 */
export function forbiddenStyleMatches(
  value,
  extras = [],
  { names = [], scope = "strict" } = {},
) {
  return [
    ...new Set(
      forbiddenWordFindings(value, { scope, names, extras }).map((f) => f.word),
    ),
  ];
}
const hasFinalConsonant = (name) => {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
};
function adviceFor(finding) {
  const quoted = `‘${finding.excerpt}’`,
    name = finding.castName;
  if (name)
    return `${quoted}: 캐릭터 이름 ‘${name}’ 뒤에 붙은 말이 작품 이름 ‘${finding.word}’와 겹쳐요. ‘${name}에게서’, ‘${name}${hasFinalConsonant(name) ? "과" : "와"} 함께’처럼 바꿔 적어 주세요.`;
  if (finding.kind === "title")
    return finding.word === "frozen"
      ? `${quoted}: 대문자로 쓰면 작품 이름으로 읽혀요. 얼음을 말하려면 소문자 ‘frozen’이나 ‘icy’로 쓰고, 옷·머리는 색·소재·무늬로 적어 주세요.`
      : `${quoted}: 기존 캐릭터 이름이에요. 다른 이름이나 머리 모양·색·옷 같은 생김새로 바꿔 주세요.`;
  if (finding.kind === "title-cue")
    return `${quoted}: 스타일·영화·느낌·처럼 같은 말과 함께 쓰면 작품을 가리켜요. 그 말을 빼고 색·질감·무늬로 적어 주세요.`;
  if (finding.kind === "custom")
    return `${quoted}: 부모 설정에 추가한 금칙어예요. 다른 말로 바꿔 주세요.`;
  return `${quoted}: 스튜디오·작가·작품 이름이에요(띄어 쓰거나 붙여 써도 같아요). 이름을 지우고 색·질감·빛·선으로 설명해 주세요.`;
}
/** What the parent should change, one sentence per finding (at most three). */
export function forbiddenWordAdvice(findings = []) {
  return [...new Set(findings.map(adviceFor))].slice(0, 3).join(" ");
}
const partsOf = (value) =>
  (Array.isArray(value) ? value.flat(Infinity) : [value])
    .filter((item) => item !== undefined && item !== null && item !== "")
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
/**
 * The one check every image path runs: `strict` parts (parent text, also
 * against the parent's `extras`), `lenient` parts (model-written story text)
 * and the cast `names`. Each part is read on its own.
 */
export function checkForbiddenWords({
  strict = [],
  lenient = [],
  names = [],
  extras = [],
} = {}) {
  const cast = partsOf(names),
    findings = [
      ...partsOf(strict).flatMap((part) =>
        forbiddenWordFindings(part, { scope: "strict", names: cast, extras }),
      ),
      ...partsOf(lenient).flatMap((part) =>
        forbiddenWordFindings(part, { scope: "lenient", names: cast }),
      ),
    ];
  return {
    ok: findings.length === 0,
    findings,
    words: [...new Set(findings.map((finding) => finding.word))],
    advice: forbiddenWordAdvice(findings),
  };
}
/** checkForbiddenWords on a request's declared parts, `forbiddenWordCheck: {text, generated, names}`. */
export const checkForbiddenWordCheck = (check, { extras = [] } = {}) =>
  checkForbiddenWords({
    strict: check?.text,
    lenient: check?.generated,
    names: check?.names,
    extras,
  });
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
  const parts = [preset.name, preset.stylePrompt, preset.negativePrompt].filter(
      (v) => typeof v === "string",
    ),
    text = parts.join("\n");
  // Style text is parent-typed: the strict scope, plus the parent's extra words.
  const verdict = checkForbiddenWords({
      strict: parts,
      extras: options.forbiddenWords || customForbiddenWords,
    }),
    matches = verdict.words;
  if (matches.length)
    errors.push(
      `금칙어가 들어 있어 저장할 수 없어요: ${matches.join(", ")}. 이름 대신 재료·선·색·조명·구도를 설명해 주세요. ${verdict.advice}`,
    );
  const namedReference =
    /\bin\s+(?:the\s+)?style\s+of\b|\binspired\s+by\s+(?!the\s+(?:scene|palette|reference|cover)\b)|\b(?:drawn|painted|illustrated)\s+by\b|(?:스튜디오|작가|화가|감독)\s*(?:의|풍|스타일)|[가-힣]{2,20}\s*의\s*(?:작품|그림)(?:\s*처럼|\s*같이)/i;
  if (namedReference.test(text))
    errors.push(
      "스튜디오·작가·작품의 이름을 화풍 지시로 사용할 수 없어요. 시각 요소로 풀어 적어 주세요.",
    );
  return { valid: errors.length === 0, errors, forbiddenWords: matches };
}
