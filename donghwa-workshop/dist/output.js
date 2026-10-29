import {
  getAudioAsset,
  restoreAudioAssets,
  validateAudioBackup,
} from "./audio-playback.js";
import { sceneSVG, characterSVG } from "./engine.js";
import {
  getImageURL,
  getAsset,
  restoreImageAsset,
  hydrateImageAssets,
} from "./image-generation/assets.js";
import { layoutOf, openingsOf, splitSpreadText } from "./book-layout.js";
import { isTextOnlyPage, textOnlySVG } from "./story-generation/story-drama.js";
import { hasTextPocket, pocketOf, pocketOnHalf, pocketFrame, pocketPanel, pocketClasses, pocketStyle, isShout, POCKET_CSS, POCKET_SAMPLER_SCRIPT } from "./text-pocket.js";

const DEFAULTS = {
  layout: "single",
  textPosition: "below",
  language: "bilingual",
  color: "color",
  pages: "all",
  fontSize: "large",
  margin: "standard",
};
const encoder = new TextEncoder();
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

function options(settings = {}) {
  const result = { ...DEFAULTS, ...settings };
  if (!["bottom", "top", "below", "staged"].includes(result.textPosition))
    result.textPosition = "below";
  if (!["single", "two", "booklet"].includes(result.layout))
    result.layout = DEFAULTS.layout;
  if (!["ko", "en", "bilingual"].includes(result.language))
    result.language =
      result.language === "dual" ? "bilingual" : DEFAULTS.language;
  if (!["color", "grayscale"].includes(result.color)) result.color = "color";
  if (!["large", "normal"].includes(result.fontSize)) result.fontSize = "large";
  if (!["standard", "binding"].includes(result.margin))
    result.margin = "standard";
  // R39-F: the low-resolution feedback edition (pictures shrunk for sharing and review, never for printing).
  if (!["full", "feedback"].includes(result.quality)) result.quality = "full";
  if (!result.imageSources || typeof result.imageSources !== "object") result.imageSources = null;
  return result;
}

function protagonist(book, characters) {
  const list = [
    ...(book.generationSnapshot?.characterSheets || [])
      .map((sheet) => sheet.characterSnapshot)
      .filter(Boolean),
    ...(book.characterSnapshots || []),
    ...(Array.isArray(characters) ? characters : []),
  ];
  const ids = Array.isArray(book.characterIds) ? book.characterIds : [];
  return (
    list.find((character) => character.id === ids[0]) ||
    list.find((character) => character.role === "주인공") ||
    list[0]
  );
}

function fallbackArtwork(book, page, characters, cover = false) {
  const scene = page?.scene || {
    theme: book.theme || "dinosaur",
    beat: cover ? "cover" : "discover",
    index: 0,
  };
  // Generated artwork is embedded as an image. SVG scripts cannot execute in img context.
  const cast = (book.characterIds || [])
    .map(
      (id) =>
        book.generationSnapshot?.characterSheets?.find(
          (sheet) => sheet.characterId === id,
        )?.characterSnapshot ||
        book.characterSnapshots?.find((c) => c.id === id) ||
        characters.find((c) => c.id === id),
    )
    .filter(Boolean);
  return sceneSVG(
    scene,
    cast.length ? cast : protagonist(book, characters),
    page?.artVariant || 0,
  );
}

function imageReference(value, sources = null) {
  const swap = (url) => (sources && typeof sources[url] === "string" ? sources[url] : url);
  const id =
    value?.imageAssetId ||
    (typeof value?.imageUrl === "string" && value.imageUrl.startsWith("asset:")
      ? value.imageUrl.slice(6)
      : null);
  if (id) {
    const url = getImageURL(id);
    if (!url)
      throw new Error(
        "생성한 그림을 보관함에서 불러오지 못했어요. 새로고침 후 다시 시도하거나 그림 백업을 복원해 주세요.",
      );
    return swap(url);
  }
  if (value?.imageUrl) {
    if (!/^(data:image\/|blob:|https?:\/\/)/i.test(value.imageUrl))
      throw new Error("생성한 그림의 주소를 확인해 주세요.");
    return swap(value.imageUrl);
  }
  return null;
}

function artwork(book, page, characters, cover = false, sources = null) {
  // R39: a text-only page is a flat colour; the leaf typesets its words.
  if (!cover && isTextOnlyPage(page)) return textOnlySVG((book.pages || []).indexOf(page), { wide: page.kind === "spread" });
  const image = cover
    ? imageReference(
        book.cover ||
          (book.coverImageAssetId
            ? { imageAssetId: book.coverImageAssetId }
            : null),
        sources,
      )
    : null;
  return (
    image ||
    imageReference(page, sources) ||
    fallbackArtwork(book, page, characters, cover)
  );
}

function imageMarkup(source, description) {
  const url = String(source).trim().startsWith("<svg")
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
    : source;
  return `<img class="illustration" src="${escapeHTML(url)}" alt="${escapeHTML(description)}">`;
}

function parsePages(selection, count) {
  if (!selection || selection === "all")
    return Array.from({ length: count }, (_, index) => index);
  if (selection === "cover") return [];
  const value = String(selection)
    .trim()
    .replace(/[~～–—]/g, "-");
  if (!value || !/^[\d\s,\-]+$/.test(value))
    throw new Error("쪽 범위는 3-8 또는 1, 3, 5처럼 입력해 주세요.");
  const selected = new Set();
  const parts = value.split(",").map((part) => part.trim());
  if (parts.some((part) => !part))
    throw new Error("쪽 범위를 다시 확인해 주세요.");
  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match)
      throw new Error("쪽 범위는 3-8 또는 1, 3, 5처럼 입력해 주세요.");
    const first = Number(match[1]);
    const last = Number(match[2] || match[1]);
    if (first < 1 || first > last || last > count)
      throw new Error(`본문 쪽은 1부터 ${count}까지 선택할 수 있어요.`);
    for (let page = first; page <= last; page++) selected.add(page - 1);
  }
  return [...selected].sort((a, b) => a - b);
}

/** R40: the pocket's stylesheet and sampler, only for a book that has pockets (other books' print HTML is unchanged). */
const pocketStyles = (book, settings) =>
  hasTextPocket(book?.storyInput)
    ? `${POCKET_CSS}\n.text-pocket-leaf .picturebook-frame>.pocket-frame{width:100%;height:100%}\n.text-pocket-leaf .pocket-picture,.text-pocket-leaf .pocket-picture>.illustration{width:100%;height:100%}\n.text-pocket-leaf .pocket-picture>.illustration{object-fit:contain}\n.text-pocket{font-size:${settings.fontSize === "large" ? "17pt" : "14pt"}}\n.one .text-pocket{font-size:${settings.fontSize === "large" ? "21pt" : "17pt"}}\n.ob-art .text-pocket{font-size:var(--ob-font, ${OPENING_FONT_FLOORS.K2}pt)}\n.ob-pocket .ob-text{flex:0 0 0;padding:0}\n`
    : "";
const pocketScript = (book) => (hasTextPocket(book?.storyInput) ? POCKET_SAMPLER_SCRIPT : "");
/** R40: the page's words for the language, as plain strings (the shout test). */
const pageTexts = (page, language) =>
  [language !== "en" ? page.ko ?? page.textKo ?? "" : "", language !== "ko" ? page.en ?? page.textEn ?? "" : ""].filter((t) => String(t).trim());
function pageText(page, language) {
  const ko = `<p lang="ko" class="ko">${escapeHTML(page.ko ?? page.textKo ?? "")}</p>`;
  const en = `<p lang="en" class="en">${escapeHTML(page.en ?? page.textEn ?? "")}</p>`;
  return language === "ko" ? ko : language === "en" ? en : en + ko;
}

function textPlacement(page, settings) {
  if (settings.textPosition === "staged") {
    const side = page.staging?.textSide;
    return ["left", "right", "top", "bottom"].includes(side)
      ? `text-${side} text-staged`
      : "text-below";
  }
  if (settings.textPosition === "below") return "text-below";
  return settings.textPosition === "top" || page.printTextPosition === "top"
    ? "text-top"
    : "text-bottom";
}

function logicalPages(book, settings, characters) {
  if (!book || !Array.isArray(book.pages) || !book.pages.length)
    throw new Error("출력할 책의 본문이 없어요.");
  const title =
    settings.language === "en" ? book.titleEn || book.title : book.title;
  const cover = {
    kind: "cover",
    label: "표지",
    html: `<article class="leaf cover" aria-label="표지"><div class="cover-series">${escapeHTML(book.series || "우리 아이의 작은 이야기")}${book.episode ? ` · ${escapeHTML(book.episode)}편` : ""}</div><h1>${escapeHTML(title || "우리의 동화책")}</h1>${settings.language === "bilingual" && book.titleEn ? `<p class="cover-subtitle" lang="en">${escapeHTML(book.titleEn)}</p>` : ""}${imageMarkup(artwork(book, book.pages[0], characters, true, settings.imageSources), "이야기 표지 그림")}<p class="cover-credit">동화공방 · 함께 만든 우리 집 그림책</p></article>`,
  };
  const back = {
    kind: "back",
    label: "뒤표지",
    html: `<article class="leaf back" aria-label="뒤표지"><div class="back-mark" aria-hidden="true">✦</div><p class="back-title">오늘의 이야기가<br>내일의 추억이 돼요.</p><p lang="en">A little story.<br>A big memory.</p><span>동화공방</span></article>`,
  };
  const selected = parsePages(settings.pages, book.pages.length);
  if (settings.pages === "cover") return [cover];
  const pages = selected.map((index) => {
    const page = book.pages[index],
      picture = imageMarkup(artwork(book, page, characters, false, settings.imageSources), `${index + 1}쪽 이야기 그림`),
      // R40: a page with a text pocket sets its words on the picture's flat field; no story card below.
      pocket = pocketOf(book, page);
    return {
      kind: "page",
      label: `${index + 1}쪽`,
      html: pocket
        ? `<article class="leaf story-page text-pocket-leaf" aria-label="${index + 1}쪽"><div class="picturebook-frame">${pocketFrame(picture, pageText(page, settings.language), pocket, { shout: isShout(pageTexts(page, settings.language)) })}</div><span class="folio">${index + 1}</span></article>`
        : `<article class="leaf story-page ${textPlacement(page, settings)}" aria-label="${index + 1}쪽"><div class="picturebook-frame">${picture}<div class="story">${pageText(page, settings.language)}</div></div><span class="folio">${index + 1}</span></article>`,
    };
  });
  if (!settings.pages || settings.pages === "all")
    return [cover, ...pages, back];
  return pages;
}

const blankPage = () => ({
  kind: "blank",
  label: "빈 쪽",
  html: '<article class="leaf blank" aria-label="제본을 위한 빈 쪽"></article>',
});

/** Return sheet sides in the order to send to a duplex printer. */
export function imposeBooklet(pages) {
  const padded = [...pages];
  const hasBack = padded[padded.length - 1]?.kind === "back";
  while (padded.length % 4)
    padded.splice(hasBack ? padded.length - 1 : padded.length, 0, blankPage());
  const sides = [];
  for (let sheet = 0; sheet < padded.length / 4; sheet++) {
    sides.push([padded[padded.length - 1 - sheet * 2], padded[sheet * 2]]);
    sides.push([padded[sheet * 2 + 1], padded[padded.length - 2 - sheet * 2]]);
  }
  return sides;
}

function sheetMarkup(logical, settings) {
  let sides;
  if (settings.layout === "booklet" && logical.length > 1)
    sides = imposeBooklet(logical);
  else if (settings.layout === "two") {
    sides = [];
    let pending = [];
    for (const page of logical) {
      if (page.kind !== "page") {
        if (pending.length) {
          sides.push(pending);
          pending = [];
        }
        sides.push([page]);
      } else {
        pending.push(page);
        if (pending.length === 2) {
          sides.push(pending);
          pending = [];
        }
      }
    }
    if (pending.length) sides.push(pending);
  } else sides = logical.map((page) => [page]);
  return {
    count: sides.length,
    html: sides
      .map(
        (side, index) =>
          `<section class="sheet ${side.length === 1 ? "one" : settings.layout === "booklet" ? "spread" : "stack"}" aria-label="출력 ${index + 1}면">${side.map((page, position) => `<div class="slot ${position === 0 ? "left" : "right"}">${page.html}</div>`).join("")}</section>`,
      )
      .join(""),
  };
}

export function migratePrintSettings(settings = {}) {
  if (settings.printLayoutVersion !== 2) {
    if (!settings.defaultLayout || settings.defaultLayout === "booklet")
      settings.defaultLayout = "single";
    settings.printLayoutVersion = 2;
  }
  return settings;
}

function printStyles(settings) {
  const landscape = settings.layout !== "two";
  return `
    @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
    * { box-sizing: border-box; }
    html { color: #34372f; background: #f2f1eb; font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
    body { margin: 0; }
    .print-tools { max-width: 1000px; padding: 26px 28px; margin: 16px auto 24px; background: white; border-radius: 14px; }
    .print-tools h2 { margin: 0 0 10px; font-size: 21px; }
    .print-tools p { font-size: 14px; line-height: 1.7; margin: 7px 0; }
    .print-tools button { border: 0; border-radius: 9px; padding: 12px 22px; background: #426b4c; color: white; font-weight: 700; cursor: pointer; font-size: 16px; margin-top: 10px; }
    .print-tools button:disabled{opacity:.5;cursor:not-allowed}
    .print-warning { padding: 12px; background: #fff1dd; color: #723b18; }
    .print-warning[hidden] { display: none; }
    .sheet { width: ${landscape ? "277mm" : "190mm"}; height: ${landscape ? "190mm" : "277mm"}; display: grid; grid-template-columns: 1fr; grid-template-rows:minmax(0,1fr); overflow: hidden; background: white; margin: 0 auto 24px; box-shadow: 0 4px 28px #00000012; break-after: page; page-break-after: always; break-inside: avoid; page-break-inside: avoid; ${settings.color === "grayscale" ? "filter: grayscale(1);" : ""} }
    .sheet.spread{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    .sheet.stack{grid-template-rows:minmax(0,1fr) minmax(0,1fr)}
    .sheet:last-child { break-after: auto; page-break-after: auto; }
    .slot { min-width: 0; min-height: 0; position: relative; }
    .spread .slot:first-child { border-right: 1px dashed #dadad0; }
    .stack .slot:first-child { border-bottom: 1px dashed #dadad0; }
    .leaf { width: 100%; height: 100%; padding: 4mm; display: flex; flex-direction: column; position: relative; overflow: hidden; }
    .story-page{justify-content:center}
    ${settings.margin === "binding" ? ".one .leaf { padding-left: 12mm; } .spread .left .leaf { padding-right: 10mm; } .spread .right .leaf { padding-left: 10mm; }" : ""}
    .illustration { width: 100%; min-height: 0; object-fit: contain; display: block; }
    .picturebook-frame{position:relative;width:100%;aspect-ratio:3/2;max-height:100%;background:#f6f2e8;overflow:hidden;isolation:isolate}
    .picturebook-frame>.illustration{width:100%;height:100%;display:block;object-fit:contain}
    .story { position:absolute;left:4%;right:4%;bottom:4%;max-height:72%;padding:3% 4%;background:rgba(255,253,246,.93);border-radius:3mm;color:#292d26;line-height:1.55;font-size:${settings.fontSize === "large" ? "19pt" : "15pt"};font-weight:500;word-break:keep-all;overflow-wrap:break-word;white-space:pre-line;z-index:1; }
    .text-top .story{top:4%;bottom:auto}
    .text-staged .story{border-radius:0;background:rgba(255,253,246,.88)}
    .text-left .story,.text-right .story{top:6%;bottom:auto;width:41%;max-height:88%;padding:3%}
    .text-left .story{left:3%;right:auto}
    .text-right .story{right:3%;left:auto}
    .one .story { font-size: ${settings.fontSize === "large" ? "25pt" : "20pt"}; }
    .story p { margin: 0; }
    .story p + p { margin-top: 2.5mm; }
    .story .en { font-family: Georgia, "Times New Roman", serif; }
    .story .ko { letter-spacing: -.025em; }
    .text-below .picturebook-frame{aspect-ratio:auto;height:100%;display:flex;flex-direction:column;background:white}
    .text-below .picturebook-frame>.illustration{height:70%;flex:0 0 auto}
    .text-below .story{position:static;max-height:none;min-height:0;flex:1;left:auto;right:auto;bottom:auto;border-radius:0;background:white;padding:3mm 3mm 7mm}
    .folio { position: absolute; bottom: 1mm; left: 0; right: 0; text-align: center; font-size: 8pt; color: #72756a; }
    .cover { align-items: center; text-align: center; }
    .cover-series { font-size: 10pt; color: #6e7c67; padding-top: 2mm; }
    .cover h1 { font-size: 27pt; line-height: 1.3; margin: 3mm 0 2mm; word-break: keep-all; letter-spacing: -.04em; }
    .cover-subtitle { font-family: Georgia, serif; margin: 1mm 0 2mm; font-size: 14pt; }
    .cover .illustration { flex: 1; min-height: 0; height: 54%; }
    .cover-credit { font-size: 9pt; margin: 2mm 0; color: #798473; }
    .back { align-items: center; justify-content: center; text-align: center; color: #697b5d; gap: 4mm; }
    .back-mark { font-size: 48pt; color: #c7a461; }
    .back-title { font-size: 21pt; line-height: 1.6; font-weight: 700; margin: 0; }
    .back p[lang="en"] { font-family: Georgia, serif; line-height: 1.8; color: #859278; font-size: 15pt; }
    .back span { margin-top: 9mm; font-size: 11pt; }
    @media screen and (max-width: 1080px) { .sheet { transform-origin: top left; margin-left: 12px; } }
    @media print { html { background: white; } .print-tools { display: none !important; } .sheet { margin: 0; box-shadow: none; } .spread .slot:first-child,.stack .slot:first-child { border: 0; } .story,img { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  `;
}

function printFitScript() {
  return `<script>
(()=>{
 const fit=()=>{
  let overflow=0;
  document.querySelectorAll('.story-page').forEach(leaf=>{
   const body=leaf.querySelector('.story'),image=leaf.querySelector('.illustration');
   if(!body||!image)return;
   body.style.fontSize='';image.style.height='';
   let font=parseFloat(getComputedStyle(body).fontSize),height=70;
   const crowded=()=>body.scrollHeight>body.clientHeight+1;
   if(leaf.classList.contains('text-below'))while(crowded()&&height>22){height-=2;image.style.height=height+'%';}
   while(crowded()&&font>12){font-=.5;body.style.fontSize=font+'px';}
   if(crowded())overflow++;
  });
  const warning=document.getElementById('print-fit-warning');
  warning.hidden=!overflow;
  warning.textContent=overflow+'쪽의 본문이 출력 영역보다 깁니다. 한 면에 한 쪽을 선택하거나 본문을 나눠 주세요.';
  document.getElementById('print-now').disabled=!!overflow;
  document.documentElement.dataset.printReady=overflow?'overflow':'ready';
 };
 const ready=async()=>{
  await Promise.all(Array.from(document.images,img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});})));
  if(document.fonts)await document.fonts.ready;
  fit();
 };
 window.addEventListener('beforeprint',fit);ready();
})();
<\/script>`;
}

/* ---------- R12 openings print (펼침 구성; classes prefixed ob-) ---------- */

/** One font size per book: K2 14pt, K3 13pt, K4 12pt; never below 11pt. */
export const OPENING_FONT_FLOORS = Object.freeze({ K2: 14, K3: 13, K4: 12 });
export const OPENING_MIN_FONT = 11;
export const OPENING_BOOKLET_NOTE =
  "소책자 인쇄는 펼침 구성 책에서 다음 판에 지원해요";
/**
 * The print layout to preselect: 'single' (A4 landscape, one opening per sheet),
 * or 크게 읽기 ('two': A4 portrait, one printed page per sheet) for K4 and for a
 * bilingual or English print of an E3/E4 book. Page books keep 'single'.
 */
export function recommendedPrintLayout(book, language) {
  if (layoutOf(book) !== "openings") return "single";
  const specs = book.storyInput?.specs || {},
    lang = language || book.language;
  return specs.ko?.id === "K4" ||
    (lang !== "ko" && ["E3", "E4"].includes(specs.en?.id))
    ? "two"
    : "single";
}
/** '출력 펼침': all, cover, '2-4' or '1, 3' in openings (1..O); 0-based opening indexes. */
function parseOpenings(selection, count) {
  try {
    return parsePages(selection, count);
  } catch {
    throw new Error(
      `출력 펼침은 all, cover 또는 1부터 ${count}까지의 범위(예: 2-4)로 입력해 주세요.`,
    );
  }
}
/**
 * The leaves of one opening, one per printed page: a spread gives two leaves
 * that show the left and right half of its picture and of its text
 * (splitSpreadText per language; the stored text never changes); a pair gives
 * its two pages with whole pictures.
 */
function openingLeaves(book, opening, characters, sources = null) {
  const text = (page, lang) =>
    String(
      (lang === "ko" ? (page.ko ?? page.textKo) : (page.en ?? page.textEn)) ??
        "",
    );
  if (opening.kind === "spread") {
    const index = opening.indices[0],
      page = book.pages[index],
      src = artwork(book, page, characters, false, sources),
      // R40: a side pocket holds the whole spread's words on its own half; a top/bottom one spans both halves.
      pocket = pocketOf(book, page),
      sided = pocket && (pocket.side === "left" || pocket.side === "right"),
      [koLeft, koRight] = sided ? (pocket.side === "left" ? [text(page, "ko"), ""] : ["", text(page, "ko")]) : splitSpreadText(text(page, "ko")),
      [enLeft, enRight] = sided ? (pocket.side === "left" ? [text(page, "en"), ""] : ["", text(page, "en")]) : splitSpreadText(text(page, "en"));
    return [
      { no: opening.printedPages[0], half: "left", src, ko: koLeft, en: enLeft, pocket: pocketOnHalf(pocket, "left") },
      { no: opening.printedPages[1], half: "right", src, ko: koRight, en: enRight, pocket: pocketOnHalf(pocket, "right") },
    ];
  }
  return opening.indices.map((index, k) => ({
    no: opening.printedPages[k],
    half: null,
    src: artwork(book, book.pages[index], characters, false, sources),
    ko: text(book.pages[index], "ko"),
    en: text(book.pages[index], "en"),
    pocket: pocketOf(book, book.pages[index]),
  }));
}
function leafMarkup(leaf, language) {
  const ko = `<p lang="ko" class="ko">${escapeHTML(leaf.ko.trim())}</p>`,
    en = `<p lang="en" class="en">${escapeHTML(leaf.en.trim())}</p>`,
    body = language === "ko" ? ko : language === "en" ? en : en + ko,
    // R40: the words sit in the picture's flat field; the text block below stays empty.
    pocket = leaf.pocket && (leaf.ko.trim() || leaf.en.trim()) ? leaf.pocket : null,
    texts = [language !== "en" ? leaf.ko : "", language !== "ko" ? leaf.en : ""].filter((t) => t.trim());
  return `<article class="ob-leaf ${leaf.half ? `ob-half ob-half-${leaf.half}` : "ob-page"} ob-${leaf.no % 2 ? "left" : "right"}${pocket ? " ob-pocket" : ""}" aria-label="${leaf.no}쪽" data-leaf="${leaf.no}"><div class="ob-art-row"><div class="ob-art${pocket ? ` ${pocketClasses(pocket)}` : ""}"${pocket ? ` style="${pocketStyle(pocket)}"` : ""}>${imageMarkup(leaf.src, `${leaf.no}쪽 이야기 그림`)}${pocket ? pocketPanel(body, pocket, { shout: isShout(texts) }) : ""}</div></div><div class="ob-text">${pocket ? "" : body}</div><span class="ob-folio">${leaf.no}</span></article>`;
}
function openingStyles(settings) {
  return `
    .ob-sheet { display: flex; align-items: stretch; }
    .ob-single .ob-leaf { width: 50%; }
    .ob-large .ob-leaf { width: 100%; }
    .ob-leaf { height: 100%; display: flex; flex-direction: column; padding: 6mm 6mm 10mm; position: relative; overflow: hidden; }
    .ob-half-left { padding-right: 0; }
    .ob-half-right { padding-left: 0; }
    .ob-art-row { display: flex; flex: 0 0 auto; justify-content: center; }
    .ob-half-left .ob-art-row { justify-content: flex-end; }
    .ob-half-right .ob-art-row { justify-content: flex-start; }
    .ob-art { position: relative; overflow: hidden; width: calc(var(--ob-scale, 1) * 100%); background: #f6f2e8; }
    .ob-page .ob-art { aspect-ratio: 3 / 2; }
    .ob-half .ob-art { aspect-ratio: 1024 / 880; }
    .ob-art > .illustration { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; }
    .ob-half .ob-art > .illustration { width: 200%; object-fit: cover; }
    .ob-half-right .ob-art > .illustration { left: -100%; }
    .ob-text { flex: 1; min-height: 0; overflow: hidden; padding: 3mm 1mm 0; font-size: var(--ob-font, ${OPENING_FONT_FLOORS.K2}pt); line-height: 1.5; color: #292d26; font-weight: 500; word-break: keep-all; overflow-wrap: break-word; white-space: pre-line; }
    .ob-half-left .ob-text { padding-right: 6mm; }
    .ob-half-right .ob-text { padding-left: 6mm; }
    .ob-text p { margin: 0; }
    .ob-text p + p { margin-top: 2mm; }
    .ob-text .en { font-family: Georgia, "Times New Roman", serif; }
    .ob-text .ko { letter-spacing: -.025em; }
    .ob-folio { position: absolute; bottom: 3mm; left: 0; right: 0; text-align: center; font-size: 8pt; color: #72756a; }
    @media print { main { zoom: 1 !important; } }
  `;
}
/**
 * The openings fit (one font size per book): 1) each leaf's largest fitting size
 * at full pictures (at most 20pt); 2) book size = max(level floor, smallest of
 * those); 3) an opening that still overflows shrinks its pictures together (one
 * scale for its leaves, never below 75%); 4) the book size steps down 0.5pt to
 * 11pt, repeating 3; 5) still too long: warn, disable printing, suggest 크게 읽기.
 * On narrow screens the preview zooms to the width (never in print).
 */
function openingFitScript() {
  return `<script>
(()=>{
 const root=document.documentElement,floor=Number(root.dataset.fontFloor)||14,MIN=${OPENING_MIN_FONT},CAP=20,LOW=.75;
 const main=document.querySelector('main'),sheets=[...document.querySelectorAll('.ob-sheet')],leaves=[...document.querySelectorAll('.ob-leaf')];
 const over=leaf=>{const t=leaf.querySelector('.ob-text');return !!t&&t.scrollHeight>t.clientHeight+1;};
 const groups=()=>{const m=new Map();for(const s of sheets){const k=s.dataset.opening;if(!m.has(k))m.set(k,[]);m.get(k).push(s);}return [...m.values()];};
 const scaleOf=(g,v)=>g.forEach(s=>s.style.setProperty('--ob-scale',String(v)));
 const zoom=on=>{main.style.zoom='';if(!on)return;const w=sheets[0]?.getBoundingClientRect().width||0;if(w&&w>innerWidth-16)main.style.zoom=String(Math.max(.2,(innerWidth-16)/w));};
 const fit=()=>{
  zoom(false);root.style.removeProperty('--ob-font');sheets.forEach(s=>s.style.setProperty('--ob-scale','1'));
  let low=CAP;
  for(const leaf of leaves){let pt=CAP;leaf.style.setProperty('--ob-font',pt+'pt');while(over(leaf)&&pt>4){pt-=.5;leaf.style.setProperty('--ob-font',pt+'pt');}leaf.style.removeProperty('--ob-font');low=Math.min(low,pt);}
  const attempt=pt=>{root.style.setProperty('--ob-font',pt+'pt');let bad=0;for(const g of groups()){let v=1;scaleOf(g,v);const own=g.flatMap(s=>[...s.querySelectorAll('.ob-leaf')]);while(own.some(over)&&v>LOW+1e-9){v=Math.max(LOW,Math.round((v-.05)*100)/100);scaleOf(g,v);}if(own.some(over))bad++;}return bad;};
  let font=Math.max(floor,low),bad=attempt(font);
  while(bad&&font>MIN){font=Math.max(MIN,font-.5);bad=attempt(font);}
  root.dataset.bookFont=String(font);root.dataset.overflowOpenings=String(bad);
  const warning=document.getElementById('print-fit-warning');
  warning.hidden=!bad;
  warning.textContent=bad+'개 펼침의 글이 ${OPENING_MIN_FONT}pt로도 출력 영역보다 깁니다. ‘크게 읽기 · A4 세로’를 골라 주세요.';
  document.getElementById('print-now').disabled=!!bad;
  root.dataset.printReady=bad?'overflow':'ready';
 };
 const ready=async()=>{
  await Promise.all(Array.from(document.images,img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});})));
  if(document.fonts)await document.fonts.ready;
  fit();zoom(true);
 };
 window.addEventListener('beforeprint',()=>{zoom(false);fit();});
 window.addEventListener('afterprint',()=>zoom(true));
 window.addEventListener('resize',()=>zoom(true));
 ready();
})();
<\/script>`;
}
/** Print HTML of an openings book: 'single' or 크게 읽기 ('two'); booklet falls back to single. */
function openingsPrintHTML(book, normalized, characters, requestedLayout) {
  const settings = {
      ...normalized,
      layout: normalized.layout === "two" ? "two" : "single",
      // Openings print always sets the text below the picture.
      textPosition: "below",
    },
    bookletNote = requestedLayout === "booklet",
    openings = openingsOf(book),
    selected = parseOpenings(settings.pages, openings.length),
    title =
      settings.language === "en" ? book.titleEn || book.title : book.title,
    frame = logicalPages(book, { ...settings, pages: "all" }, characters),
    cover = frame[0],
    back = frame.at(-1),
    sheet = (inner, extra = "") =>
      `<section class="sheet ${extra}">${inner}</section>`,
    body = [];
  if (settings.pages === "cover") body.push(sheet(`<div class="slot left">${cover.html}</div>`, "one"));
  else {
    const all = !settings.pages || settings.pages === "all";
    if (all) body.push(sheet(`<div class="slot left">${cover.html}</div>`, "one"));
    for (const index of selected) {
      const leaves = openingLeaves(book, openings[index], characters, settings.imageSources);
      if (settings.layout === "two")
        for (const leaf of leaves)
          body.push(
            `<section class="sheet ob-sheet ob-large" data-opening="${index + 1}">${leafMarkup(leaf, settings.language)}</section>`,
          );
      else
        body.push(
          `<section class="sheet ob-sheet ob-single" data-opening="${index + 1}">${leaves.map((leaf) => leafMarkup(leaf, settings.language)).join("")}</section>`,
        );
    }
    if (all) body.push(sheet(`<div class="slot left">${back.html}</div>`, "one"));
  }
  const floor = OPENING_FONT_FLOORS[book.storyInput?.specs?.ko?.id] || OPENING_FONT_FLOORS.K2,
    layoutLabel =
      settings.layout === "two"
        ? "크게 읽기 · A4 세로 한 장에 한 쪽"
        : "펼침 구성 · A4 가로 한 장에 펼침 하나",
    guidance = `<p>A4 ${settings.layout === "two" ? "세로" : "가로"} · 실제 크기(100%)로 출력해 주세요.${settings.layout === "two" ? " 펼침면은 왼쪽 반과 오른쪽 반을 두 장에 나눠 마주 보게 출력해요." : " 한 장에 마주 보는 두 쪽(펼침 하나)을 출력해요. 펼침면 그림은 가운데에서 이어져요."} 책 전체를 같은 글자 크기(${floor}pt 이상)로 맞춰요.</p>${bookletNote ? `<p class="print-warning">${OPENING_BOOKLET_NOTE}. 일반 출력(A4 가로 한 장에 펼침 하나)으로 열었어요.</p>` : ""}${feedbackNote(settings)}`;
  return `<!doctype html><html lang="${settings.language === "en" ? "en" : "ko"}" data-font-floor="${floor}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title || "동화공방")} · 인쇄</title><style>${printStyles(settings)}${openingStyles(settings)}${pocketStyles(book, settings)}</style></head><body><header class="print-tools"><h2>${escapeHTML(title || "우리의 동화책")}</h2><p>${layoutLabel} · 펼침 ${openings.length}개 · ${body.length}개 출력면 · ${settings.color === "grayscale" ? "흑백" : "컬러"} · 바깥 여백 10mm</p>${guidance}<p>본문은 그림 아래에 배치됩니다. 한글·영어는 실제 글자로 조판되어 PDF에서도 또렷하게 출력됩니다.</p><p id="print-fit-warning" class="print-warning" hidden></p><p>인쇄 대화상자에서 대상을 <strong>PDF로 저장</strong>으로 고르면 파일로 보관할 수 있어요. 브라우저 머리글·바닥글은 끄고, 여백은 기본값을 유지해 주세요.</p><button id="print-now" type="button" onclick="window.print()">인쇄 · PDF로 저장</button></header><main>${body.join("")}</main>${openingFitScript()}${pocketScript(book)}</body></html>`;
}

/** Standalone portable HTML, suitable for saving and opening without this app. */
export function getPrintHTML(book, settings = {}, characters = []) {
  const normalized = options(settings);
  // R12 openings: the leaf model (page books keep everything below unchanged).
  if (layoutOf(book) === "openings")
    return openingsPrintHTML(book, normalized, characters, normalized.layout);
  const logical = logicalPages(book, normalized, characters);
  const sheets = sheetMarkup(logical, normalized);
  const title =
    normalized.language === "en" ? book.titleEn || book.title : book.title;
  const layoutLabel = {
    single: "읽는 순서 · 한 면에 한 쪽",
    two: "읽는 순서 · 두 쪽씩",
    booklet: "제본용 소책자 · 쪽 재배치",
  }[normalized.layout];
  const orientation = normalized.layout === "two" ? "세로" : "가로";
  const guidance =
    normalized.layout === "booklet"
      ? `<p>제본용 배치입니다. 빈 쪽을 포함해 4의 배수로 맞추므로 1쪽 옆이나 2쪽 옆에 빈 쪽이 보일 수 있습니다. 빈 쪽 없이 1→2쪽 순서로 보려면 일반 인쇄를 선택하세요.</p><p><strong>가로 A4 · 양면 · 짧은 쪽 뒤집기</strong>를 기본으로 선택하세요. 프린터마다 방향이 달라 첫 장을 시험 출력해 앞뒤가 같은 방향인지 확인해 주세요. 인쇄된 종이를 순서대로 포갠 뒤 반으로 접어 가운데를 제본하세요.</p>`
      : `<p>A4 ${orientation} · 실제 크기(100%)로 출력해 주세요.${normalized.layout === "two" ? " 본문은 1·2쪽, 3·4쪽 순서로 위아래에 놓고 표지·뒤표지는 별도 출력면에 둡니다. 프린터의 모아 찍기는 1로 두세요." : ""}</p>${feedbackNote(normalized)}`;
  return `<!doctype html><html lang="${normalized.language === "en" ? "en" : "ko"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title || "동화공방")} · 인쇄</title><style>${printStyles(normalized)}${pocketStyles(book, normalized)}</style></head><body><header class="print-tools"><h2>${escapeHTML(title || "우리의 동화책")}</h2><p>${layoutLabel} · ${sheets.count}개 출력면 · ${normalized.color === "grayscale" ? "흑백" : "컬러"} · 바깥 여백 10mm</p>${guidance}<p>${normalized.textPosition === "below" ? "본문은 그림 아래에 배치됩니다." : normalized.textPosition === "staged" ? "장면별로 정한 빈 공간에 본문을 배치합니다. 구도 정보가 없는 쪽은 그림 아래에 배치합니다." : "본문은 그림 안의 밝은 영역에 겹쳐 배치됩니다."} 한글·영어는 실제 글자로 조판되어 PDF에서도 또렷하게 출력됩니다.${normalized.textPosition === "below" ? "" : " 브라우저의 배경 그래픽 인쇄를 켜면 밝은 본문 영역이 그대로 나옵니다."}</p><p id="print-fit-warning" class="print-warning" hidden></p><p>인쇄 대화상자에서 대상을 <strong>PDF로 저장</strong>으로 고르면 파일로 보관할 수 있어요. 브라우저 머리글·바닥글은 끄고, 여백은 기본값을 유지해 주세요.</p><button id="print-now" type="button" onclick="window.print()">인쇄 · PDF로 저장</button></header><main>${sheets.html}</main>${printFitScript()}${pocketScript(book)}</body></html>`;
}

/* ---------- R39-F: the low-resolution feedback edition ---------- */
export const FEEDBACK_NOTE = "저용량 피드백판 · 그림을 작게 줄여 넣었어요(검증·공유용, 인쇄용이 아니에요). ‘PDF로 저장’하면 파일이 작아요.";
const feedbackNote = (settings) => (settings.quality === "feedback" ? `<p class="print-warning print-feedback-note">${FEEDBACK_NOTE}</p>` : "");
export const FEEDBACK_MAX_SIDE = 640;
export const FEEDBACK_JPEG_QUALITY = 0.55;
/** Every picture a print of this book would show (pages and cover), as the URLs artwork() would use; unreadable ones are skipped. */
function printImageUrls(book) {
  const urls = new Set();
  const add = (value) => {
    try {
      const url = imageReference(value);
      if (url) urls.add(url);
    } catch {
      /* a missing asset is reported by the print itself */
    }
  };
  add(book?.cover || (book?.coverImageAssetId ? { imageAssetId: book.coverImageAssetId } : null));
  for (const page of book?.pages || []) if (!isTextOnlyPage(page)) add(page);
  return [...urls];
}
/** One picture shrunk to a small JPEG data URL (the browser's canvas); null when it cannot be read. */
async function shrinkImage(url, maxSide, quality) {
  const image = new Image();
  image.decoding = "async";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("그림을 읽지 못했어요."));
    image.src = url;
  });
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1)),
    width = Math.max(1, Math.round((image.naturalWidth || 1) * scale)),
    height = Math.max(1, Math.round((image.naturalHeight || 1) * scale)),
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}
/**
 * The shrunk pictures of a book, keyed by the URL the print would use
 * (what getPrintHTML takes as settings.imageSources). Browser only: without
 * a document it returns {} and the print shows the originals.
 */
export async function feedbackImageSources(book, { maxSide = FEEDBACK_MAX_SIDE, quality = FEEDBACK_JPEG_QUALITY, onProgress } = {}) {
  const sources = {};
  if (typeof document === "undefined" || typeof Image === "undefined") return sources;
  const urls = printImageUrls(book);
  let done = 0;
  for (const url of urls) {
    try {
      sources[url] = await shrinkImage(url, maxSide, quality);
    } catch {
      /* the original stays */
    }
    done++;
    onProgress?.({ done, total: urls.length });
  }
  return sources;
}
const feedbackSettings = (settings, imageSources) => ({ ...settings, quality: "feedback", imageSources });
/** The feedback edition as one self-contained HTML file (shrunk pictures inline) and its file name. */
export async function feedbackBookHTML(book, settings = {}, characters = [], options = {}) {
  const imageSources = await feedbackImageSources(book, options);
  const html = getPrintHTML(book, feedbackSettings(settings, imageSources), characters);
  return { html, filename: `${archiveName(book?.title)}-피드백판.html`, pictures: Object.keys(imageSources).length };
}
/**
 * Opens the print tab synchronously (the click authorizes it), then fills it
 * with the feedback edition once the pictures are shrunk. Resolves false when
 * the popup was blocked; a build error closes the tab and rethrows.
 */
export async function printFeedbackBook(book, settings = {}, characters = [], options = {}) {
  // Validate before opening to avoid an empty tab for a malformed page range.
  getPrintHTML(book, { ...settings, quality: "feedback" }, characters);
  const tab = window.open("", "_blank");
  if (!tab) return false;
  try {
    tab.opener = null;
    tab.document.open();
    tab.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>저용량 피드백판 준비 중</title></head><body style="font-family:sans-serif;padding:24px">그림을 작게 줄이는 중이에요…</body></html>`);
    tab.document.close();
    const imageSources = await feedbackImageSources(book, options);
    const html = getPrintHTML(book, feedbackSettings(settings, imageSources), characters);
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
    tab.focus();
    return true;
  } catch (error) {
    tab.close();
    throw error;
  }
}

/** Opens synchronously so the user's click authorizes the print tab. */
export function printBook(book, settings = {}, characters = []) {
  // Validate before opening to avoid an empty tab for a malformed page range.
  const html = getPrintHTML(book, settings, characters);
  const tab = window.open("", "_blank");
  if (!tab) return false;
  try {
    tab.opener = null;
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
    tab.focus();
    return true;
  } catch (error) {
    tab.close();
    throw error;
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  return {
    bytes,
    set16: (at, value) => view.setUint16(at, value, true),
    set32: (at, value) => view.setUint32(at, value, true),
  };
}

/** A standards-compliant UTF-8, uncompressed ZIP archive. */
export function createZip(files, date = new Date()) {
  if (!Array.isArray(files) || files.length > 65535)
    throw new Error("백업 파일 수가 너무 많아요.");
  const local = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  const dosDate =
    ((Math.max(1980, Math.min(2107, date.getFullYear())) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data =
      typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    if (
      !(data instanceof Uint8Array) ||
      name.length > 65535 ||
      data.length > 0xffffffff
    )
      throw new Error("백업할 파일 형식을 확인해 주세요.");
    const crc = crc32(data);
    const item = header(30);
    item.set32(0, 0x04034b50);
    item.set16(4, 20);
    item.set16(6, 0x0800);
    item.set16(8, 0);
    item.set16(10, dosTime);
    item.set16(12, dosDate);
    item.set32(14, crc);
    item.set32(18, data.length);
    item.set32(22, data.length);
    item.set16(26, name.length);
    item.set16(28, 0);
    local.push(item.bytes, name, data);
    const entry = header(46);
    entry.set32(0, 0x02014b50);
    entry.set16(4, 20);
    entry.set16(6, 20);
    entry.set16(8, 0x0800);
    entry.set16(10, 0);
    entry.set16(12, dosTime);
    entry.set16(14, dosDate);
    entry.set32(16, crc);
    entry.set32(20, data.length);
    entry.set32(24, data.length);
    entry.set16(28, name.length);
    entry.set16(30, 0);
    entry.set16(32, 0);
    entry.set16(34, 0);
    entry.set16(36, 0);
    entry.set32(38, 0);
    entry.set32(42, offset);
    directory.push(entry.bytes, name);
    offset += 30 + name.length + data.length;
    directorySize += 46 + name.length;
    if (offset + directorySize > 0xffffffff)
      throw new Error("라이브러리가 ZIP 크기 제한을 넘었어요.");
  }
  const end = header(22);
  end.set32(0, 0x06054b50);
  end.set16(4, 0);
  end.set16(6, 0);
  end.set16(8, files.length);
  end.set16(10, files.length);
  end.set32(12, directorySize);
  end.set32(16, offset);
  end.set16(20, 0);
  return new Blob([...local, ...directory, end.bytes], {
    type: "application/zip",
  });
}

export function downloadFile(
  data,
  filename,
  mime = "application/octet-stream",
) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function archiveName(value) {
  const clean = String(value || "book")
    .normalize("NFC")
    .replace(/[\\/<>:"|?*\x00-\x1f]/g, "-")
    .replace(/\.{2,}/g, "-")
    .trim();
  return clean.slice(0, 72) || "book";
}

const MAX_BACKUP_TEXT = 250 * 1024 * 1024;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
/**
 * R41 (the parent's cloud save stopped at "그림 원본이 150MB를 넘었어요"):
 * a single backup file keeps the 150MB picture cap; the family cloud stores
 * every picture as its own media object under the family's 5GB quota, so
 * the blobs path (cloud sync) is capped at that quota instead and the
 * server's own quota answer is what stops it.
 */
const BACKUP_ASSET_CAP = 150 * 1024 * 1024;
const CLOUD_ASSET_CAP = 5 * 1024 * 1024 * 1024;
const assetCapError = (blobs) =>
  new Error(
    blobs
      ? "그림 원본이 가족 클라우드 저장 공간(5GB)을 넘었어요. 책을 나누어 저장해 주세요."
      : "그림 원본이 150MB를 넘었어요. 라이브러리를 나누어 백업해 주세요.",
  );
const ASSET_ID = /^image-[a-zA-Z0-9-]{8,120}$/;
const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};
const normalId = (value) => String(value || "").replace(/^asset:/, "");

function withoutCredentials(state, { excludePin = false } = {}) {
  return JSON.parse(
    JSON.stringify(state, (key, value) => {
      const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
      if (
        [
          "apikey",
          "key",
          "token",
          "accesstoken",
          "refreshtoken",
          "authtoken",
          "bearertoken",
          "secret",
          "secretkey",
          "privatekey",
          "clientsecret",
          "password",
          "authorization",
          "credentials",
          "credential",
          "vault",
          "encryptedcredentials",
        ].includes(normalized) ||
        (excludePin &&
          [
            "pin",
            "pinhash",
            "pinsalt",
            "pinverifier",
            "parentpin",
            "parentpinhash",
          ].includes(normalized))
      )
        return undefined;
      return value;
    }),
  );
}

/** Walk snapshots and history too; asset references are not limited to current pages. */
function referencedAssets(state) {
  const ids = new Set();
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (key === "assetId" && value.startsWith("audio-")) return;
      if (
        value.startsWith("asset:") ||
        /(?:image|sheet|character).*assetids?$/i.test(key) ||
        /imageids?$/i.test(key) ||
        key === "assetId"
      ) {
        const id = normalId(value);
        if (!ASSET_ID.test(id))
          throw new Error("그림 참조의 식별자를 확인해 주세요.");
        ids.add(id);
      }
    } else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([field, item]) => visit(item, field));
  };
  visit(state);
  return [...ids];
}

function validateDataImage(dataUrl) {
  if (
    typeof dataUrl !== "string" ||
    dataUrl.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 100
  )
    throw new Error("백업 그림은 한 장에 40MB까지 지원해요.");
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif|avif|bmp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  if (!match || match[2].length % 4 !== 0)
    throw new Error("백업 그림의 데이터 주소가 올바르지 않아요.");
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    throw new Error("백업 그림의 인코딩을 확인해 주세요.");
  }
  if (!binary.length || binary.length > MAX_IMAGE_BYTES)
    throw new Error("백업 그림의 크기를 확인해 주세요.");
  const mime = match[1];
  const signatures = {
    "image/png": binary.startsWith("\x89PNG\r\n\x1a\n"),
    "image/jpeg": binary.startsWith("\xff\xd8\xff"),
    "image/webp": binary.startsWith("RIFF") && binary.slice(8, 12) === "WEBP",
    "image/gif": /^GIF8[79]a/.test(binary),
    "image/bmp": binary.startsWith("BM"),
    "image/avif":
      binary.slice(4, 8) === "ftyp" && /avif|avis/.test(binary.slice(8, 32)),
    "image/svg+xml": false,
  };
  if (mime === "image/svg+xml") {
    const svg = new TextDecoder().decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
    signatures[mime] =
      /<svg(?:\s|>)/i.test(svg) &&
      !/<(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*(?:javascript:|https?:|\/\/)|<!DOCTYPE|<!ENTITY/i.test(
        svg,
      );
  }
  if (!signatures[mime])
    throw new Error("백업 그림의 내용과 파일 형식이 일치하지 않아요.");
  return {
    mime,
    extension: IMAGE_TYPES[mime],
    bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  };
}

function checkedInlineImage(url) {
  if (
    url.startsWith("data:image/svg+xml;") ||
    url.startsWith("data:image/svg+xml,")
  ) {
    const match = /^data:image\/svg\+xml(?:;charset=utf-8)?,(.*)$/s.exec(url);
    if (match) {
      let text;
      try {
        text = decodeURIComponent(match[1]);
      } catch {
        throw new Error("백업 SVG 그림의 인코딩을 확인해 주세요.");
      }
      const bytes = encoder.encode(text);
      const chunks = [];
      for (let at = 0; at < bytes.length; at += 0x8000)
        chunks.push(String.fromCharCode(...bytes.subarray(at, at + 0x8000)));
      const canonical = `data:image/svg+xml;base64,${btoa(chunks.join(""))}`;
      validateDataImage(canonical);
      return canonical;
    }
  }
  validateDataImage(url);
  return url;
}

function checkInlineStateImages(state, { allowStoredAssets = false } = {}) {
  if (!state || typeof state !== "object") return;
  if (Array.isArray(state)) {
    state.forEach((item) =>
      checkInlineStateImages(item, { allowStoredAssets }),
    );
    return;
  }
  if (state.imageUrl) {
    if (typeof state.imageUrl !== "string")
      throw new Error("백업 그림의 주소 형식을 확인해 주세요.");
    if (
      !state.imageUrl.startsWith("asset:") &&
      !(allowStoredAssets && state.imageUrl.startsWith("/assets/"))
    ) {
      if (!state.imageUrl.startsWith("data:image/"))
        throw new Error(
          "복원할 그림은 파일 안에 담긴 데이터 또는 보관함 식별자여야 해요.",
        );
      state.imageUrl = checkedInlineImage(state.imageUrl);
    }
  }
  for (const item of Object.values(state))
    if (item && typeof item === "object")
      checkInlineStateImages(item, { allowStoredAssets });
}

async function blobImage(blob) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_IMAGE_BYTES)
    throw new Error("생성한 그림 파일이 없거나 40MB 크기 제한을 넘었어요.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let mime = blob.type.toLowerCase().split(";")[0];
  if (!IMAGE_TYPES[mime]) {
    if (bytes[0] === 137 && bytes[1] === 80) mime = "image/png";
    else if (bytes[0] === 255 && bytes[1] === 216) mime = "image/jpeg";
    else if (new TextDecoder().decode(bytes.slice(0, 12)).startsWith("RIFF"))
      mime = "image/webp";
    else throw new Error("백업할 그림의 파일 형식을 확인해 주세요.");
  }
  const chunks = [];
  for (let at = 0; at < bytes.length; at += 0x8000)
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 0x8000)));
  const dataUrl = `data:${mime};base64,${btoa(chunks.join(""))}`;
  validateDataImage(dataUrl);
  return { bytes, mime, extension: IMAGE_TYPES[mime], dataUrl };
}

async function directImage(url) {
  if (
    typeof url !== "string" ||
    !/^(data:image\/|blob:|https?:\/\/|\/assets\/)/i.test(url)
  )
    throw new Error("백업할 생성 그림의 주소를 확인해 주세요.");
  const response = await fetch(url);
  if (!response.ok)
    throw new Error("생성한 그림 원본을 읽지 못해 백업을 중단했어요.");
  return blobImage(await response.blob());
}

/** Store direct references once in the backup, without inflating localStorage on restore. */
const directBlobCache = new Map();
const DIRECT_BLOB_CACHE_LIMIT = 64 * 1024 * 1024;
let directBlobCacheBytes = 0,
  directBlobCacheEpoch = 0;
export function clearDirectBlobCache() {
  directBlobCacheEpoch++;
  directBlobCache.clear();
  directBlobCacheBytes = 0;
}
function cacheDirectBlob(url, blob, epoch) {
  if (epoch !== directBlobCacheEpoch || blob.size > DIRECT_BLOB_CACHE_LIMIT)
    return;
  if (directBlobCache.has(url)) {
    directBlobCacheBytes -= directBlobCache.get(url).size;
    directBlobCache.delete(url);
  }
  while (
    directBlobCache.size &&
    (directBlobCacheBytes + blob.size > DIRECT_BLOB_CACHE_LIMIT ||
      directBlobCache.size >= 1000)
  ) {
    const oldest = directBlobCache.keys().next().value;
    directBlobCacheBytes -= directBlobCache.get(oldest).size;
    directBlobCache.delete(oldest);
  }
  directBlobCache.set(url, blob);
  directBlobCacheBytes += blob.size;
}
async function externalizeDirectImages(state, assets, { blobs = false } = {}) {
  const byUrl = new Map([...assets].map(([id, image]) => [image.dataUrl, id]));
  let bytes = [...assets.values()].reduce(
    (total, image) => total + (blobs ? image.size : image.bytes.length),
    0,
  );
  const storeURL = async (url) => {
    const canonical =
      !blobs && url.startsWith("data:image/") ? checkedInlineImage(url) : url;
    let id = byUrl.get(canonical);
    if (!id) {
      let image;
      if (blobs) {
        if (!/^(data:image\/|blob:|https?:\/\/|\/assets\/)/i.test(canonical))
          throw new Error("백업할 그림 주소를 확인해 주세요.");
        image = directBlobCache.get(canonical);
        if (!image) {
          const cacheEpoch = directBlobCacheEpoch;
          const response = await fetch(canonical);
          if (!response.ok) throw new Error("그림 원본을 읽지 못했어요.");
          image = await response.blob();
          if (!image.size || !/^image\//i.test(image.type))
            throw new Error("그림 원본 형식을 확인해 주세요.");
          cacheDirectBlob(canonical, image, cacheEpoch);
        } else {
          directBlobCache.delete(canonical);
          directBlobCache.set(canonical, image);
        }
      } else image = await directImage(canonical);
      bytes += blobs ? image.size : image.bytes.length;
      if (bytes > (blobs ? CLOUD_ASSET_CAP : BACKUP_ASSET_CAP)) throw assetCapError(blobs);
      id = "image-" + crypto.randomUUID();
      byUrl.set(canonical, id);
      assets.set(id, image);
    }
    return id;
  };
  const retainStyleRecord = (id) => {
    state.styleSheetImages ||= [];
    if (
      !state.styleSheetImages.some(
        (record) => record.imageAssetId === id || record.id === id,
      )
    ) {
      state.styleSheetImages.push({
        id,
        imageAssetId: id,
        imageUrl: `asset:${id}`,
        meta: { source: "backup-style-reference" },
      });
    }
  };
  const visit = async (value) => {
    if (Array.isArray(value)) {
      for (const item of value) await visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.styleRefImages)) {
      const ids = [];
      for (let index = 0; index < value.styleRefImages.length; index++) {
        const url = value.styleRefImages[index];
        if (typeof url !== "string")
          throw new Error("화풍 레퍼런스 주소를 확인해 주세요.");
        const id = url.startsWith("asset:")
          ? normalId(url)
          : await storeURL(url);
        if (!assets.has(id))
          throw new Error("화풍 레퍼런스 원본이 빠져 백업을 중단했어요.");
        value.styleRefImages[index] = `asset:${id}`;
        ids.push(id);
        retainStyleRecord(id);
      }
      if (ids.length)
        value.styleRefImageIds = [
          ...new Set([...(value.styleRefImageIds || []), ...ids]),
        ];
    }
    if (Array.isArray(value.styleRefImageIds))
      value.styleRefImageIds.forEach(retainStyleRecord);
    if (
      value.imageUrl &&
      !value.imageAssetId &&
      !value.imageUrl.startsWith("asset:")
    ) {
      const id = await storeURL(value.imageUrl);
      value.imageAssetId = id;
      value.imageUrl = "asset:" + id;
    }
    for (const item of Object.values(value))
      if (item && typeof item === "object") await visit(item);
  };
  await visit(state);
}

async function portableState(state, assets) {
  const visit = async (value) => {
    if (Array.isArray(value)) {
      for (const item of value) await visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const id =
      value.imageAssetId ||
      (typeof value.imageUrl === "string" && value.imageUrl.startsWith("asset:")
        ? normalId(value.imageUrl)
        : null);
    if (id) {
      value.imageUrl = assets.get(normalId(id)).dataUrl;
      delete value.imageAssetId;
    } else if (value.imageUrl)
      value.imageUrl = (await directImage(value.imageUrl)).dataUrl;
    if (value.coverImageAssetId) {
      value.cover = {
        ...(value.cover || {}),
        imageUrl: assets.get(normalId(value.coverImageAssetId)).dataUrl,
      };
      delete value.coverImageAssetId;
    }
    for (const [key, item] of Object.entries(value)) {
      if (
        key !== "imageUrl" &&
        typeof item === "string" &&
        item.startsWith("asset:")
      )
        value[key] = assets.get(normalId(item)).dataUrl;
      else if (item && typeof item === "object") await visit(item);
    }
  };
  const result = JSON.parse(JSON.stringify(state));
  await visit(result);
  return result;
}

function retainPortableDirectImages(state, portable) {
  if (!state || typeof state !== "object") return;
  if (Array.isArray(state)) {
    state.forEach((item, index) =>
      retainPortableDirectImages(item, portable[index]),
    );
    return;
  }
  if (
    state.imageUrl &&
    !state.imageAssetId &&
    !state.imageUrl.startsWith("asset:")
  )
    state.imageUrl = portable.imageUrl;
  for (const [key, item] of Object.entries(state))
    if (item && typeof item === "object")
      retainPortableDirectImages(item, portable[key]);
}

/** Audio references can also occur in saved drafts and immutable history. */
function referencedAudioAssets(state) {
  const ids = new Set();
  const visit = (value, key = "") => {
    if (
      typeof value === "string" &&
      (key === "assetId" || /audioAssetIds?$/i.test(key)) &&
      value.startsWith("audio-")
    ) {
      if (!/^audio-[a-zA-Z0-9-]{5,100}$/.test(value))
        throw new Error("음원 참조의 식별자를 확인해 주세요.");
      ids.add(value);
    } else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([field, item]) => visit(item, field));
  };
  visit(state);
  return [...ids];
}

async function completeAudioBackup(state) {
  const audioAssets = [];
  for (const id of referencedAudioAssets(state)) {
    const asset = await getAudioAsset(id);
    if (!asset?.blob?.size)
      throw new Error(
        "참조하는 녹음·음원 원본이 기기에 없어 백업을 중단했어요. 원래 기기의 음원 백업을 복원한 뒤 다시 시도해 주세요.",
      );
    const bytes = new Uint8Array(await asset.blob.arrayBuffer()),
      chunks = [];
    for (let at = 0; at < bytes.length; at += 0x8000)
      chunks.push(String.fromCharCode(...bytes.subarray(at, at + 0x8000)));
    audioAssets.push({
      id,
      mimeType: asset.blob.type,
      dataUrl: `data:${asset.blob.type};base64,${btoa(chunks.join(""))}`,
    });
  }
  validateAudioBackup(audioAssets);
  return audioAssets;
}

/** A complete, editable transfer file. This never generates images, text or audio. */
export async function createLibraryBackup(state, { mode = "text" } = {}) {
  if (!state || !Array.isArray(state.books) || !Array.isArray(state.characters))
    throw new Error("백업할 라이브러리를 찾을 수 없어요.");
  const snapshot = withoutCredentials(state, { excludePin: true });
  const assets = new Map();
  let assetBytes = 0;
  for (const id of referencedAssets(snapshot)) {
    const blob = await getAsset(id);
    if (!blob)
      throw new Error(
        "참조하는 생성 그림 원본이 보관함에 없어 백업을 중단했어요. 그림 백업을 복원한 뒤 다시 시도해 주세요.",
      );
    assetBytes += blob.size;
    if (assetBytes > (mode === "blobs" ? CLOUD_ASSET_CAP : BACKUP_ASSET_CAP)) throw assetCapError(mode === "blobs");
    assets.set(id, mode === "blobs" ? blob : await blobImage(blob));
  }
  await externalizeDirectImages(snapshot, assets, { blobs: mode === "blobs" });
  if (mode === "blobs") {
    for (const id of referencedAudioAssets(snapshot)) {
      const asset = await getAudioAsset(id);
      if (!asset?.blob?.size)
        throw new Error("참조하는 음원 원본이 기기에 없어 저장을 중단했어요.");
      assets.set(id, asset.blob);
    }
    return { snapshot, assets };
  }
  const exportedAt = new Date().toISOString();
  const imageAssets = [...assets].map(([id, image]) => ({
    id,
    dataUrl: image.dataUrl,
  }));
  const audioAssets = await completeAudioBackup(snapshot);
  const text = JSON.stringify(
    {
      audioAssets,
      format: "donghwa-workshop-library",
      version: 1,
      exportedAt,
      state: snapshot,
      imageAssets,
    },
    null,
    2,
  );
  if (encoder.encode(text).byteLength > MAX_BACKUP_TEXT)
    throw new Error("복원 가능한 백업 크기 250MB를 넘었어요.");
  // Validate before offering the file, including all nested asset references.
  validateImport(text);
  return {
    text,
    snapshot,
    assets,
    imageAssets,
    audioAssets,
    exportedAt,
    filename: `동화공방-기기이동-${exportedAt.slice(0, 10)}.json`,
    bookCount: snapshot.books.length,
    characterCount: snapshot.characters.length,
    backgroundCount: snapshot.backgrounds?.length || 0,
    worldCount: snapshot.worlds?.length || 0,
    imageCount: imageAssets.length,
    audioCount: audioAssets.length,
  };
}

/** Downloads original generated images, portable HTML and editable JSON without API keys. */
export async function exportLibrary(state) {
  const backup = await createLibraryBackup(state);
  const { snapshot, assets, exportedAt, text: library, imageAssets } = backup;
  // Portable print documents are built only for the full archive, not JSON transfers.
  const portable = await portableState(snapshot, assets);
  retainPortableDirectImages(snapshot, portable);
  const files = [
    { name: "library.json", data: library },
    {
      name: "README.txt",
      data: `동화공방 라이브러리 백업\n내보낸 날짜: ${exportedAt}\n\n1. ZIP을 풀고 library.json을 ‘백업 가져오기’에서 선택하면 책, World, 캐릭터 시트와 생성 그림을 원래 식별자로 복원합니다. 이전 그림과 책 생성 당시의 시트도 함께 들어 있습니다. API 키와 인증 토큰은 포함하지 않습니다. 새 기기에서는 키를 다시 등록해 주세요.\n2. books 폴더의 print.html은 실제 생성 그림을 파일 안에 담아 인터넷이나 앱 없이 읽고 A4로 인쇄할 수 있습니다.\n3. ‘인쇄 · PDF로 저장’을 누른 후 인쇄 대화상자의 ‘PDF로 저장’을 선택하세요. PDF가 자동 생성되지는 않습니다.\n4. images 폴더와 책·캐릭터 폴더의 PNG/JPG/WebP 등은 생성한 원본 그림입니다. *-fallback.svg는 앱의 기본 미리보기 그림이고 원본 생성 그림과 별개입니다. 생성 그림이 없는 책은 기본 SVG가 담깁니다.\n5. 한글·영어 글, 요청 시드와 실제 반환 시드, 생성 당시의 World 설정은 JSON에 보관됩니다.\n6. 가족 이름과 책 내용이 담겨 있으므로 가족이 관리하는 위치에 보관해 주세요.\n\n소책자: 가로 A4 양면 ‘짧은 쪽 뒤집기’를 기본으로 첫 장을 시험 출력하세요. 앞뒤 방향을 확인한 뒤 순서대로 포개어 반으로 접으세요. 바깥 여백은 10mm입니다.\n`,
    },
  ];
  for (const [id, image] of assets)
    files.push({
      name: `images/${archiveName(id)}.${image.extension}`,
      data: image.bytes,
    });
  for (const [index, character] of snapshot.characters.entries()) {
    const folder = `characters/${String(index + 1).padStart(3, "0")}-${archiveName(character.name)}`;
    files.push({
      name: `${folder}/character.json`,
      data: JSON.stringify(character, null, 2),
    });
    const sheets = portable.characters[index].characterSheets || [];
    let actual = 0;
    for (const [sheetIndex, sheet] of sheets.entries()) {
      if (!sheet.imageUrl) continue;
      const image = validateDataImage(sheet.imageUrl);
      files.push({
        name: `${folder}/sheet-${String(sheetIndex + 1).padStart(2, "0")}.${image.extension}`,
        data: image.bytes,
      });
      actual++;
    }
    files.push({
      name: `${folder}/${actual ? "sheet-fallback" : "sheet"}.svg`,
      data: characterSVG(character, character.variant || 0),
    });
  }
  for (const [index, book] of snapshot.books.entries()) {
    if (!Array.isArray(book.pages) || !book.pages.length) continue;
    const rendered = portable.books[index];
    const folder = `books/${String(index + 1).padStart(3, "0")}-${archiveName(book.title)}`;
    const language = ["ko", "en", "bilingual"].includes(book.language)
      ? book.language
      : "bilingual";
    files.push({
      name: `${folder}/book.json`,
      data: JSON.stringify(book, null, 2),
    });
    files.push({
      name: `${folder}/print.html`,
      data: getPrintHTML(
        rendered,
        {
          // R12: an openings book opens in its recommended layout ('single' otherwise).
          layout: recommendedPrintLayout(rendered, language),
          language,
          color: "color",
          pages: "all",
          fontSize: "large",
          margin: "standard",
        },
        portable.characters,
      ),
    });
    const coverUrl = rendered.cover?.imageUrl || rendered.pages[0].imageUrl;
    if (coverUrl) {
      const image = validateDataImage(coverUrl);
      files.push({
        name: `${folder}/cover.${image.extension}`,
        data: image.bytes,
      });
    }
    files.push({
      name: `${folder}/${coverUrl ? "cover-fallback" : "cover"}.svg`,
      data: fallbackArtwork(book, book.pages[0], snapshot.characters, true),
    });
    book.pages.forEach((page, pageIndex) => {
      const base = `${folder}/page-${String(pageIndex + 1).padStart(2, "0")}`;
      const url = rendered.pages[pageIndex].imageUrl;
      if (url) {
        const image = validateDataImage(url);
        files.push({ name: `${base}.${image.extension}`, data: image.bytes });
      }
      files.push({
        name: `${base}${url ? "-fallback" : ""}.svg`,
        data: fallbackArtwork(book, page, snapshot.characters),
      });
    });
  }
  const filename = `동화공방-라이브러리-${exportedAt.slice(0, 10)}.zip`;
  downloadFile(createZip(files), filename);
  return {
    filename,
    bookCount: snapshot.books.length,
    fileCount: files.length,
    imageCount: imageAssets.length,
  };
}

const FORBIDDEN_KEYS = ["__proto__", "prototype", "constructor"];
/** R45: the same key guard as the file reviver, for a backup that arrives already parsed. */
function assertSafeKeys(value, depth = 0) {
  if (depth > 200) throw new Error("백업 데이터가 너무 깊어요.");
  if (Array.isArray(value)) for (const item of value) assertSafeKeys(item, depth + 1);
  else if (value && typeof value === "object")
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.includes(key)) throw new Error("허용하지 않는 데이터 키입니다.");
      assertSafeKeys(value[key], depth + 1);
    }
}
/**
 * Accepts our ZIP's library.json or a plain state JSON; returns the checked state.
 * R45: the cloud pull passes its backup as an object ({format, version, state,
 * imageAssets, audioAssets}) — the 250MB cap is for one file's text, and
 * joining a cloud library's pictures (up to the 5GB family quota) into one
 * string refused libraries over ~180MB of pictures. Every check below is the same.
 */
export function validateImport(text, { allowStoredAssets = false } = {}) {
  let parsed;
  if (text && typeof text === "object" && !Array.isArray(text)) {
    assertSafeKeys(text.state);
    parsed = text;
  } else {
    if (typeof text !== "string" || text.length > MAX_BACKUP_TEXT)
      throw new Error("250MB 이하의 동화공방 JSON 백업 파일을 선택해 주세요.");
    try {
      parsed = JSON.parse(text, (key, value) => {
        if (FORBIDDEN_KEYS.includes(key))
          throw new Error("허용하지 않는 데이터 키입니다.");
        return value;
      });
    } catch {
      throw new Error(
        "JSON 백업 파일을 읽을 수 없어요. ZIP을 풀고 library.json을 선택해 주세요.",
      );
    }
  }
  if (
    parsed?.format &&
    (parsed.format !== "donghwa-workshop-library" || parsed.version !== 1)
  )
    throw new Error("지원하지 않는 동화공방 백업 버전이에요.");
  const state =
    parsed?.format === "donghwa-workshop-library" ? parsed.state : parsed;
  if (
    !state ||
    typeof state !== "object" ||
    !Array.isArray(state.books) ||
    !Array.isArray(state.characters)
  )
    throw new Error(
      "책과 등장인물이 들어 있는 동화공방 백업 파일을 선택해 주세요.",
    );
  if (state.books.length > 1000 || state.characters.length > 1000)
    throw new Error("백업 데이터가 너무 커요.");
  if (!state.characters.length)
    throw new Error("등장인물이 한 명 이상 들어 있는 백업을 선택해 주세요.");
  const ids = new Set();
  for (const book of state.books) {
    if (
      !book ||
      typeof book.id !== "string" ||
      !book.id ||
      ids.has(book.id) ||
      typeof book.title !== "string" ||
      !Array.isArray(book.pages) ||
      !book.pages.length ||
      book.pages.length > 100
    )
      throw new Error("책 데이터 형식이 올바르지 않아요.");
    ids.add(book.id);
    if (
      book.pages.some(
        (page) =>
          !page ||
          typeof page.ko !== "string" ||
          typeof page.en !== "string" ||
          page.ko.length > 10000 ||
          page.en.length > 10000,
      )
    )
      throw new Error("책의 본문 데이터 형식이 올바르지 않아요.");
    if (
      book.characterIds !== undefined &&
      (!Array.isArray(book.characterIds) ||
        book.characterIds.some((id) => typeof id !== "string"))
    )
      throw new Error("책의 등장인물 연결 정보가 올바르지 않아요.");
  }
  const characterIds = new Set();
  for (const character of state.characters) {
    if (
      !character ||
      typeof character.id !== "string" ||
      !character.id ||
      characterIds.has(character.id) ||
      typeof character.name !== "string"
    )
      throw new Error("등장인물 데이터 형식이 올바르지 않아요.");
    characterIds.add(character.id);
  }
  if (
    state.settings !== undefined &&
    (!state.settings ||
      typeof state.settings !== "object" ||
      Array.isArray(state.settings))
  )
    throw new Error("설정 데이터 형식이 올바르지 않아요.");
  if (state.backgrounds !== undefined && !Array.isArray(state.backgrounds))
    throw new Error("배경 데이터 형식이 올바르지 않아요.");
  const imageAssets = parsed?.format ? parsed.imageAssets || [] : [];
  if (!Array.isArray(imageAssets) || imageAssets.length > 10000)
    throw new Error("백업 그림 목록 형식을 확인해 주세요.");
  const assetIds = new Set();
  for (const image of imageAssets) {
    if (
      !image ||
      typeof image.id !== "string" ||
      !ASSET_ID.test(image.id) ||
      assetIds.has(image.id)
    )
      throw new Error("백업 그림의 식별자가 올바르지 않아요.");
    validateDataImage(image.dataUrl);
    assetIds.add(image.id);
  }
  if (
    !allowStoredAssets &&
    referencedAssets(state).some((id) => !assetIds.has(id))
  )
    throw new Error(
      "참조하는 생성 그림이 빠진 백업이에요. 이미지가 포함된 library.json을 선택해 주세요.",
    );
  const audioAssets = validateAudioBackup(
    parsed?.format ? parsed.audioAssets || [] : [],
  );
  if (!allowStoredAssets) {
    const audioIds = new Set(audioAssets.map((asset) => asset.id));
    if (referencedAudioAssets(state).some((id) => !audioIds.has(id)))
      throw new Error(
        "참조하는 녹음·음원이 빠진 백업이에요. 음원이 포함된 기기 이동 파일을 선택해 주세요.",
      );
  }
  const cleanState = withoutCredentials(state);
  Object.defineProperty(cleanState, "_restoreAudioAssets", {
    value: audioAssets,
    enumerable: false,
    configurable: true,
  });
  checkInlineStateImages(cleanState, { allowStoredAssets });
  Object.defineProperty(cleanState, "_restoreAssets", {
    value: imageAssets,
    enumerable: false,
    configurable: true,
  });
  return cleanState;
}

/** Call after import confirmation and before assigning/saving the imported state. */
export async function restoreLibraryImages(state) {
  await restoreAudioAssets(state?._restoreAudioAssets || []);
  delete state._restoreAudioAssets;
  const images = state?._restoreAssets || [];
  for (const image of images) await restoreImageAsset(image.id, image.dataUrl);
  const status = await hydrateImageAssets(state);
  if (status.missing.length)
    throw new Error("백업 그림을 모두 복원하지 못했어요. 다시 가져와 주세요.");
  delete state._restoreAssets;
  return { restored: images.length, ...status };
}
