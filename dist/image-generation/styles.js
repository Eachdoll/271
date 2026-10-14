// Original, material-based styles. Style text never names an artist or studio.
const svgDataURL = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const coverReference = '/assets/hero.png';

function styleReference(id, palette) {
  const [paper, green, warm, blue, ink] = palette;
  const textured = id === 'watercolor' || id === 'crayon';
  const stroke = id === 'comic' ? `stroke="${ink}" stroke-width="6" stroke-linejoin="round"` : '';
  const texture = textured ? `<defs><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="${id === 'crayon' ? '.32' : '.65'}" numOctaves="3" stitchTiles="stitch" result="grain"/><feColorMatrix in="grain" type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${id === 'crayon' ? '.21' : '.12'}"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>` : '';
  const opacity = id === 'watercolor' ? '.78' : '1';
  return svgDataURL(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${texture}<g${textured ? ' filter="url(#paper)"' : ''}><rect width="512" height="512" fill="${paper}"/><circle cx="394" cy="104" r="47" fill="${warm}" opacity="${opacity}"/><path d="M0 320Q117 201 244 314T512 283V512H0Z" fill="${blue}" opacity="${opacity}" ${stroke}/><path d="M0 384Q111 305 258 359T512 352V512H0Z" fill="${green}" opacity="${opacity}" ${stroke}/><path d="M139 367V222" fill="none" stroke="${ink}" stroke-width="${id === 'crayon' ? 13 : 9}" stroke-linecap="round"/><path d="M55 241Q64 130 139 119Q215 136 222 244Q151 277 55 241Z" fill="${green}" opacity="${opacity}" ${stroke}/><path d="M299 410Q283 375 306 363Q329 352 343 384Q363 359 381 375Q403 393 372 418Z" fill="${warm}" ${stroke}/>${palette.map((color, i) => `<circle cx="${76 + i * 90}" cy="467" r="23" fill="${color}" stroke="${ink}" stroke-width="1"/>`).join('')}</g></svg>`);
}

const legacyRows = [
  {
    id: 'watercolor', name: '커버의 포근한 수채화', version: 2,
    stylePrompt: 'Original children’s picture-book illustration matching the attached cover illustration’s rendering: richly layered translucent watercolor and delicate colored-pencil brushwork on warm ivory cotton paper, visible fine paper grain, softly feathered edges, nuanced pigment variations and hand-painted foliage. Warm natural sunlight, softly modeled rounded forms with subtle volume and gentle shadows, expressive softly shaded faces with rosy cheeks and fine wispy hair strands. A tender, detailed and dimensional painted storybook feeling. The cover image is the authoritative visual style reference; character identity references define appearance only and must be repainted in this rendering. Preserve requested clothing and colors rather than copying the cover character.',
    negativePrompt: 'flat vector art, geometric clip art, solid uniform color blocks, sticker graphics, icon design, rigid outlines, simplistic face dots, glossy 3D rendering, photorealism, frightening imagery, text, labels, watermark, logos, inconsistent character features',
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

const COMMON_NEGATIVE = 'text, letters, captions, watermark, logo, signature, known cartoon characters, photorealistic, extra fingers, distorted face, dark or scary imagery';
const rows = [
  {
    id:'watercolor', name:'커버의 포근한 수채화', version:2,
    stylePrompt: 'soft watercolor children\'s picture book illustration, visible paper texture, gentle wet-on-wet washes, loose ink outlines, warm pastel palette, simple friendly shapes, generous white space, cozy and calm mood, children\'s picture book scene, no text, no logos. Original children\'s picture-book illustration matching the attached cover illustration’s rendering: richly layered translucent watercolor and delicate colored-pencil brushwork on warm ivory cotton paper, visible fine paper grain, softly feathered edges, nuanced pigment variations and hand-painted foliage. Warm natural sunlight, softly modeled rounded forms with subtle volume and gentle shadows, expressive softly shaded faces with rosy cheeks and fine wispy hair strands. A tender, detailed and dimensional painted storybook feeling. The cover image is the authoritative visual style reference; character identity references define appearance only and must be repainted in this rendering. Preserve requested clothing and colors rather than copying the cover character.',
    negativePrompt: `${COMMON_NEGATIVE}, flat vector art, geometric clip art, solid uniform color blocks, sticker graphics, icon design, rigid outlines, simplistic face dots, glossy 3D rendering, inconsistent character features`,
    palette:['#f5eedc','#8ca481','#ddb07b','#a4bbc6','#60584d']
  },
  {
    id:'crayon',name:'파스텔 크레용', version:2,
    stylePrompt:'children\'s book illustration in soft pastel crayon and colored pencil, visible waxy strokes and paper grain, rounded simple characters, bright but gentle colors, naive playful style, flat perspective, children\'s picture book scene, no text, no logos',
    negativePrompt:COMMON_NEGATIVE,palette:['#fff0df','#9bb68d','#e3a487','#a8c8d4','#705b53']
  },
  {
    id:'theatrical',name:'극장 애니메이션풍 · Z스타일',version:1,
    stylePrompt:'hand-painted watercolor and gouache backgrounds, lush greenery, big soft cumulus clouds, soft diffused natural light, 1980s-90s Japanese theatrical animation look, cel-shaded characters with simple rounded faces, small dot noses, expressive but modest eyes, clean thin line art, muted earthy palette with warm highlights, nostalgic countryside atmosphere, subtle film grain, children\'s picture book scene, no text, no logos',
    negativePrompt:COMMON_NEGATIVE,palette:['#f6f1de','#799d6a','#deb476','#9abdc6','#555953']
  },
  {
    id:'animated3d',name:'3D 애니메이션풍 · D스타일',version:1,
    stylePrompt:'modern 3D animated feature film look, stylized rounded characters with large expressive eyes and soft skin, big head and small body proportions for children, smooth global illumination with warm rim light, vibrant saturated colors, polished render, shallow depth of field, friendly and cute, children\'s picture book scene, no text, no logos',
    negativePrompt:COMMON_NEGATIVE,palette:['#fff1db','#81b98c','#f1bb6e','#92c5db','#615449'],
    twoDimensionalOption:'classic 2D hand-drawn animated musical feature look, fluid expressive lines, rich painted backgrounds, 1990s aesthetic'
  }
];

const freezeRow = (row, isBuiltIn=true) => Object.freeze({...row,version:row.version||1,isBuiltIn,palette:Object.freeze([...row.palette]),styleRefImageIds:Object.freeze([...(row.styleRefImageIds||[])]),styleRefImages:Object.freeze([...(row.styleRefImages||[row.id==='watercolor'?coverReference:styleReference(row.id,row.palette)])])});
export const STYLE_PRESETS = Object.freeze(rows.map(row=>freezeRow(row)));
export const LEGACY_STYLE_PRESETS = Object.freeze(legacyRows.map(row=>freezeRow(row)));
export const DEFAULT_FORBIDDEN_STYLE_WORDS = Object.freeze(['disney','pixar','dreamworks','ghibli','miyazaki','studio ghibli','totoro','mickey','frozen','elsa','디즈니','픽사','지브리','미야자키','토토로','겨울왕국']);
const aliases = {cartoon:'comic','만화풍':'comic','다정한 만화풍':'comic','수채화 그림책풍':'watercolor','수채화 그림책':'watercolor','Z스타일':'theatrical','D스타일':'animated3d'};
let customPresets = [];
let customForbiddenWords = [];
const lower=value=>String(value||'').normalize('NFKC').toLowerCase();
export function forbiddenStyleMatches(value, extras=[]) {
  const text=lower(value);
  return [...new Set([...DEFAULT_FORBIDDEN_STYLE_WORDS,...extras].map(lower).map(word=>word.trim()).filter(Boolean))].filter(word=>text.includes(word));
}
/** Call on library changes; IDs in imported/frozen books retain their own copies. */
export function setCustomStylePresets(state={}) {
  customForbiddenWords=Array.isArray(state.settings?.forbiddenStyleWords)?state.settings.forbiddenStyleWords:[];
  customPresets=(Array.isArray(state.stylePresets)?state.stylePresets:[]).filter(row=>row && !row.isBuiltIn && !STYLE_PRESETS.some(b=>b.id===row.id) && validateStylePreset(row,{forbiddenWords:customForbiddenWords}).valid).map(row=>({...row,isBuiltIn:false,palette:[...row.palette],styleRefImageIds:[...(row.styleRefImageIds||[])],styleRefImages:[...(row.styleRefImages||[])]}));
  return customPresets;
}
export function listStylePresets(state) {
  if(state)setCustomStylePresets(state);
  return [...STYLE_PRESETS,...customPresets];
}
export function getStylePreset(id='watercolor',state) {
  if(id&&typeof id==='object')return id;
  if(state)setCustomStylePresets(state);
  const key=aliases[id]||id;
  return [...STYLE_PRESETS,...customPresets,...LEGACY_STYLE_PRESETS].find(row=>row.id===key||row.name===key)||STYLE_PRESETS[0];
}
/** Names are free parent labels; style descriptions may only describe visual elements. */
export function validateStylePreset(preset,options={}) {
  const errors=[];
  if(!preset||typeof preset!=='object')return {valid:false,errors:['화풍 프리셋이 필요해요.']};
  for(const field of ['name','stylePrompt','negativePrompt'])if(typeof preset[field]!=='string'||!preset[field].trim())errors.push(`${field} 항목을 채워 주세요.`);
  if(typeof preset.name==='string'&&preset.name.length>80)errors.push('화풍 이름은 80자 이하로 적어 주세요.');
  if(typeof preset.stylePrompt==='string'&&preset.stylePrompt.length>5000)errors.push('화풍 설명은 5000자 이하로 적어 주세요.');
  if(!Array.isArray(preset.palette)||preset.palette.length<5||preset.palette.length>6||preset.palette.some(color=>!/^#[\da-f]{6}$/i.test(color)))errors.push('palette는 6자리 색상 코드 5~6개여야 해요.');
  if(preset.styleRefImages!==undefined&&(!Array.isArray(preset.styleRefImages)||preset.styleRefImages.some(url=>typeof url!=='string'||!/^(data:image\/(?:svg\+xml|png|jpeg|webp)(?:;|,)|https?:\/\/|\/|asset:|blob:)/i.test(url))))errors.push('화풍 레퍼런스 주소를 확인해 주세요.');
  if(preset.styleRefImageIds!==undefined&&(!Array.isArray(preset.styleRefImageIds)||preset.styleRefImageIds.some(id=>typeof id!=='string'||!/^image-[a-zA-Z0-9-]+$/.test(id))))errors.push('앱에서 생성한 스타일 시트만 고정할 수 있어요.');
  const text=[preset.name,preset.stylePrompt,preset.negativePrompt].filter(v=>typeof v==='string').join('\n');
  const matches=forbiddenStyleMatches(text,options.forbiddenWords||customForbiddenWords);
  if(matches.length)errors.push(`금칙어가 들어 있어 저장할 수 없어요: ${matches.join(', ')}. 이름 대신 재료·선·색·조명·구도를 설명해 주세요.`);
  const namedReference=/\bin\s+(?:the\s+)?style\s+of\b|\binspired\s+by\s+(?!the\s+(?:scene|palette|reference|cover)\b)|\b(?:drawn|painted|illustrated)\s+by\b|(?:스튜디오|작가|화가|감독)\s*(?:의|풍|스타일)|[가-힣]{2,20}\s*의\s*(?:작품|그림)(?:\s*처럼|\s*같이)/i;
  if(namedReference.test(text))errors.push('스튜디오·작가·작품의 이름을 화풍 지시로 사용할 수 없어요. 시각 요소로 풀어 적어 주세요.');
  return {valid:errors.length===0,errors,forbiddenWords:matches};
}
