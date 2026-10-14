// Original, material-based styles. Style text never names an artist or studio.
const svgDataURL = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function styleReference(id, palette) {
  const [paper, green, warm, blue, ink] = palette;
  const textured = id === 'watercolor' || id === 'crayon';
  const stroke = id === 'comic' ? `stroke="${ink}" stroke-width="6" stroke-linejoin="round"` : '';
  const texture = textured ? `<defs><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="${id === 'crayon' ? '.32' : '.65'}" numOctaves="3" stitchTiles="stitch" result="grain"/><feColorMatrix in="grain" type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${id === 'crayon' ? '.21' : '.12'}"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>` : '';
  const opacity = id === 'watercolor' ? '.78' : '1';
  return svgDataURL(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${texture}<g${textured ? ' filter="url(#paper)"' : ''}><rect width="512" height="512" fill="${paper}"/><circle cx="394" cy="104" r="47" fill="${warm}" opacity="${opacity}"/><path d="M0 320Q117 201 244 314T512 283V512H0Z" fill="${blue}" opacity="${opacity}" ${stroke}/><path d="M0 384Q111 305 258 359T512 352V512H0Z" fill="${green}" opacity="${opacity}" ${stroke}/><path d="M139 367V222" fill="none" stroke="${ink}" stroke-width="${id === 'crayon' ? 13 : 9}" stroke-linecap="round"/><path d="M55 241Q64 130 139 119Q215 136 222 244Q151 277 55 241Z" fill="${green}" opacity="${opacity}" ${stroke}/><path d="M299 410Q283 375 306 363Q329 352 343 384Q363 359 381 375Q403 393 372 418Z" fill="${warm}" ${stroke}/>${palette.map((color, i) => `<circle cx="${76 + i * 90}" cy="467" r="23" fill="${color}" stroke="${ink}" stroke-width="1"/>`).join('')}</g></svg>`);
}

const rows = [
  {
    id: 'watercolor', name: '수채화 그림책풍',
    stylePrompt: 'Original children’s picture-book illustration with translucent watercolor washes, softly bleeding edges, visible cotton-paper grain, rounded organic shapes, gentle light and a calm, welcoming composition.',
    negativePrompt: 'photorealism, glossy 3D rendering, harsh black outlines, frightening imagery, text, watermark, logos, inconsistent character features',
    palette: ['#f5eedc', '#8ca481', '#ddb07b', '#a4bbc6', '#60584d']
  },
  {
    id: 'crayon', name: '파스텔 크레용',
    stylePrompt: 'Original children’s picture-book illustration with wax-crayon and soft-pastel texture, warm paper, visible broken color strokes, friendly rounded silhouettes, gently imperfect hand-drawn lines and playful open space.',
    negativePrompt: 'photorealism, glossy surfaces, hard digital gradients, sharp threatening shapes, text, watermark, logos, inconsistent character features',
    palette: ['#fff0df', '#9bb68d', '#e3a487', '#a8c8d4', '#705b53']
  },
  {
    id: 'flat', name: '플랫 일러스트',
    stylePrompt: 'Original children’s picture-book illustration with clean flat colors, rounded geometric silhouettes, minimal interior detail, generous negative space, clear expressive faces and soft balanced color contrasts.',
    negativePrompt: 'photorealism, heavy texture, complex gradients, visual clutter, hard shadows, text, watermark, logos, inconsistent character features',
    palette: ['#f6efe2', '#90ad89', '#e6b36d', '#98bfc7', '#526255']
  },
  {
    id: 'comic', name: '다정한 만화풍',
    stylePrompt: 'Original children’s comic illustration with clear rounded ink contours, simple warm color fills, readable silhouettes, lively but gentle facial expressions, light cel shading and an uncluttered single-scene composition.',
    negativePrompt: 'photorealism, aggressive sharp linework, dark frightening imagery, complex panels, speech bubbles, text, watermark, logos, inconsistent character features',
    palette: ['#fff1d7', '#93b184', '#eda776', '#9dbcd7', '#5a5249']
  }
];

export const STYLE_PRESETS = Object.freeze(rows.map(row => Object.freeze({
  ...row,
  palette: Object.freeze([...row.palette]),
  styleRefImages: Object.freeze([styleReference(row.id, row.palette)])
})));

const aliases = {cartoon: 'comic', '만화풍': 'comic', '다정한 만화풍': 'comic'};
const descriptorVocabulary = new Set([
  ...rows.flatMap(row => [row.name, row.stylePrompt, row.negativePrompt].join(' ').toLowerCase().match(/\p{L}+/gu) || []),
  ...('pencil graphite charcoal gouache ink acrylic colored colour color sketch sketching line lines linework brush brushwork matte organic textured texture subtle smooth handmade handmade impression illustration illustrative abstract editorial whimsical cheerful quiet delicate expressive grainy grain muted earthy bright dark neutral pastel watercolor crayon comic paper palette composition perspective silhouette silhouettes foreground background diffuse lighting warm cool sunlight glow depth shadow shadows contrast proportion proportions tint tones monochrome monochromatic cream beige terracotta sage mint amber blush peach ivory ochre teal blue yellow green red pink purple white brown black gray grey beige orange lavender round soft softness hazy wash washes shading hatching crosshatching stippling broad fine loose simple clarity airy even balanced limited vibrant saturated unsaturated desaturated detail details at with without of and in for to a an the on no avoid original drawing landscape nature foliage flowers hills cotton dry wet opaque translucent transparent illustration style').split(' '),
  ...('부드러운 포근한 다정한 따뜻한 밝은 고요한 차분한 둥근 단순한 선명한 은은한 평온한 재료 선 색 색채 색감 구도 질감 종이 수채화 수채화풍 연필 크레용 파스텔 펜 잉크 목탄 과슈 아크릴 스케치 그림책 그림책풍 일러스트 일러스트풍 만화 만화풍 표현 원본 독창적').split(' ')
]);
export function getStylePreset(id = 'watercolor') {
  if (id && typeof id === 'object') return id;
  const key = aliases[id] || id;
  return STYLE_PRESETS.find(row => row.id === key || row.name === key) || STYLE_PRESETS[0];
}

/** Validate schema and block named/style-imitation language in custom records. */
export function validateStylePreset(preset) {
  const errors = [];
  if (!preset || typeof preset !== 'object') return {valid: false, errors: ['화풍 프리셋이 필요해요.']};
  for (const field of ['name', 'stylePrompt', 'negativePrompt']) {
    if (typeof preset[field] !== 'string' || !preset[field].trim()) errors.push(`${field} 항목을 채워 주세요.`);
  }
  if (!Array.isArray(preset.palette) || !preset.palette.length || preset.palette.some(color => !/^#[\da-f]{6}$/i.test(color))) errors.push('palette는 6자리 색상 코드 배열이어야 해요.');
  if (!Array.isArray(preset.styleRefImages) || !preset.styleRefImages.length || preset.styleRefImages.some(url => typeof url !== 'string' || !/^(data:image\/(?:svg\+xml|png|jpeg|webp)(?:;|,)|https?:\/\/|\/)/i.test(url))) errors.push('화풍 레퍼런스 이미지를 하나 이상 넣어 주세요.');
  const text = [preset.name, preset.stylePrompt, preset.negativePrompt].filter(value => typeof value === 'string').join('\n');
  // The UI exposes this curated table. Custom records must describe materials,
  // shapes and composition rather than invoke named people, studios or brands.
  const namedReference = /\b(?:studio|studios|artist|artists|painter|illustrator|director|copyright|franchise)\b|스튜디오|스튜디오풍|작가|화가|감독|브랜드|\bin\s+(?:the\s+)?style\s+of\b|\binspired\s+by\b|\b(?:drawn|painted|illustrated)\s+by\b|(?:의|처럼|같은)\s*(?:화풍|그림체|스타일)|[가-힣]{2,20}(?:\s*의)\s*(?:작품|그림)(?:\s*처럼|\s*같이)/i;
  if (namedReference.test(text)) errors.push('스튜디오·작가 이름과 특정 작품의 화풍 지시는 사용할 수 없어요. 재료·선·색·구도로 설명해 주세요.');
  const original = STYLE_PRESETS.find(row => row.id === preset.id);
  const curatedText = original && ['name', 'stylePrompt', 'negativePrompt'].every(field => preset[field] === original[field]);
  if (!curatedText) {
    // Uppercase words in an English custom style can encode proper names. An
    // ordinary sentence may start with a descriptive word, so allow those only.
    const descriptors = new Set(['Original', 'Children', 'Soft', 'Warm', 'Gentle', 'Rounded', 'Clean', 'Flat', 'Simple', 'Clear', 'Pastel', 'Watercolor', 'Crayon', 'Comic', 'Paper', 'Light', 'Texture', 'Muted', 'Friendly', 'Hand', 'Minimal', 'Avoid', 'No']);
    const words = text.match(/\b[A-Z][A-Za-z-]{2,}\b/g) || [];
    if (words.some(word => !descriptors.has(word))) errors.push('사용자 화풍에는 고유명사 대신 재료·선·색·구도만 입력해 주세요.');
    // A finite descriptor vocabulary also catches lowercase and Korean proper
    // names; a blocklist alone cannot reliably enforce the no-name constraint.
    const customWords = text.toLowerCase().match(/\p{L}+/gu) || [];
    if (customWords.some(word => !descriptorVocabulary.has(word))) errors.push('사용자 화풍은 허용된 재료·선·색·구도 표현으로 구성해 주세요. 스튜디오·작가 고유명사는 허용되지 않아요.');
  }
  return {valid: errors.length === 0, errors};
}
