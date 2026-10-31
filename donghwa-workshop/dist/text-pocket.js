/* 글 자리 (R40, 2026-10-27). The parent: "I want the words to sit naturally
 * inside the picture, like the reference books. Words → picture → fusion
 * (regenerate the picture)? What does it cost?" The words in those books are
 * not painted into the art: the picture leaves a flat field of one colour and
 * the words are typeset on it. So nothing is bought twice. A new diet draft
 * freezes input.textPocket {version: 1}; its picture plan decides, with the
 * story, where the words will sit on each picture (left, right, top, bottom
 * or none); the picture request asks the artist to leave that part of the
 * picture as one flat even colour with nothing drawn in it; the reader, ④ and
 * the print set the words there, in the picture's own colour (sampled from
 * the finished picture; a translucent card when the field is not flat). A
 * one- or two-word page (a sound) is set big. Drafts without the marker are
 * unchanged. Pure module except the browser-only colour sampler. */
import { hasStoryDrama } from "./story-generation/story-drama.js";
export const TEXT_POCKET_VERSION = 1;
export const textPocketPolicy = () => ({ version: TEXT_POCKET_VERSION });
/** The marker, on a diet draft that also has the R39 drama contract (the plan it rides on). */
export const hasTextPocket = (input) => input?.textPocket?.version === TEXT_POCKET_VERSION && hasStoryDrama(input);
export const POCKETS = Object.freeze(["left", "right", "top", "bottom", "none"]);
const SIDES = Object.freeze(["left", "right", "top", "bottom"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 200) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
const pictureLedBook = (input) => input?.bookFormat?.version === 1 && input.bookFormat.id === "pictureLed";
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/* ---------- the plan ---------- */
/** Add pocket to a (cloned) outline schema's picturePlan. */
export function withPocketSchema(schema, input) {
  if (!hasTextPocket(input) || !pictureLedBook(input)) return schema;
  const plan = schema?.properties?.beats?.items?.properties?.picturePlan;
  if (!object(plan?.properties)) return schema;
  plan.properties.pocket = { type: "string", enum: [...POCKETS] };
  plan.required = [...new Set([...(plan.required || []), "pocket"])];
  return schema;
}
/** The outline request's addition to the PICTURE PLAN paragraph. */
export function pocketRule(input) {
  if (!hasTextPocket(input) || !pictureLedBook(input)) return "";
  return `PICTURE PLAN, where the words sit: picturePlan.pocket — "left", "right", "top" or "bottom": the part of the picture the artist leaves as one flat, even field of a single colour with nothing drawn in it, where the words are printed (the words are never painted into the picture). Put it where the action is not: a hero on the right leaves the left; a sky above leaves the top; a beat told by its words gets a bigger field. "none" only for an entry whose words are a single sound word or when backdrop is "none".`;
}
/** Clean the pocket in place (asked-for drafts) or drop it; a text-only beat has none. */
export function settlePockets(outline, input) {
  if (!object(outline) || !Array.isArray(outline.beats)) return outline;
  const wanted = hasTextPocket(input) && pictureLedBook(input);
  for (const beat of outline.beats) {
    const plan = object(beat?.picturePlan) ? beat.picturePlan : null;
    if (!plan) continue;
    const pocket = wanted ? str(plan.pocket, 20).toLowerCase() : "";
    if (SIDES.includes(pocket) && plan.backdrop !== "none") plan.pocket = pocket;
    else delete plan.pocket;
  }
  return outline;
}
/**
 * The share of the picture the field takes: a beat told by its words gets
 * more. R47: given the page's words, a longer page gets a bigger field (the
 * parent's bilingual K2 book had three sentences in each language in a 30%
 * band, and the Korean, set after the English, was cut off on 12 of 15
 * pages). Korean letters count one each, Latin letters half.
 */
export const pocketShare = (plan, side, texts = null) => {
  const words = plan?.carrier === "words",
    band = side === "top" || side === "bottom",
    base = band ? (words ? 0.4 : 0.3) : words ? 0.45 : 0.34;
  if (!Array.isArray(texts)) return base;
  const units = texts.reduce((sum, text) => sum + [...String(text ?? "")].reduce((n, ch) => n + (/[\u3131-\uD7A3]/u.test(ch) ? 1 : 0.5), 0), 0),
    need = units <= 40 ? 0 : units <= 80 ? (band ? 0.4 : 0.42) : units <= 120 ? 0.45 : band ? 0.5 : 0.45;
  return Math.max(base, need);
};
const PART = Object.freeze({ left: "the left", right: "the right", top: "the top", bottom: "the bottom" });
const pct = (share) => `${Math.round(share * 100)}%`;
/** The picture request's sentence (empty without a pocket); R47: the share sized to the page's words when given. */
export function pocketPromptLine(plan, sized = null) {
  const side = object(plan) && SIDES.includes(plan.pocket) ? plan.pocket : null;
  if (!side) return "";
  const share = Number(sized) > 0 ? Number(sized) : pocketShare(plan, side),
    axis = side === "top" || side === "bottom" ? "height" : "width";
  return `TEXT FIELD: leave ${PART[side]} ${pct(share)} of the picture's ${axis} as one flat, even field of a single quiet colour from the style palette with nothing drawn in it — no details, no gradients, no figures, no texture; the words of this page will be printed there. Keep the figures and the action in the rest of the picture.`;
}
/** The plan's pocket for a page of a book (its beat's plan), or null. */
export function pocketOf(book, page) {
  if (!hasTextPocket(book?.storyInput) || !page || page.backdrop === "none") return null;
  const beat = list(book?.outline?.beats).find((row) => Number(row?.index) === Number(page?.beatIndex ?? page?.scene?.beatIndex)),
    plan = object(beat?.picturePlan) ? beat.picturePlan : null;
  if (!plan || !SIDES.includes(plan.pocket)) return null;
  // R47: a page whose picture exists keeps the field that picture was asked to leave (its own request says so);
  // otherwise the field is sized to the words the book prints on this page.
  const drawn = /TEXT FIELD: leave the (?:left|right|top|bottom) (\d{1,3})% /u.exec(String(page.imageMeta?.prompt || ""));
  if (drawn && Number(drawn[1]) > 0 && Number(drawn[1]) <= 100) return { side: plan.pocket, share: Number(drawn[1]) / 100 };
  const language = book?.language,
    texts = [language !== "en" ? page.ko ?? page.textKo ?? "" : "", language !== "ko" ? page.en ?? page.textEn ?? "" : ""];
  return { side: plan.pocket, share: pocketShare(plan, plan.pocket, texts) };
}
/** The parent's note part. */
export const pocketNotePart = (plan) => (object(plan) && SIDES.includes(plan.pocket) ? `글 자리 · ${{ left: "왼쪽", right: "오른쪽", top: "위", bottom: "아래" }[plan.pocket]}` : "");
/* ---------- the typesetting ---------- */
/** The field on one printed half of a spread: a side pocket lives in its own half (twice as wide there), a top/bottom one spans both. */
export function pocketOnHalf(pocket, half) {
  if (!pocket) return null;
  if (pocket.side === "top" || pocket.side === "bottom") return pocket;
  // The panel takes twice the share of its half; the sampler still reads the whole picture's share.
  if ((pocket.side === "left" && half === "left") || (pocket.side === "right" && half === "right")) return { side: pocket.side, share: Math.min(1, pocket.share * 2), sample: pocket.share };
  return null;
}
/** A page of one or two short words that is not a sentence (a sound, a shout) is set big. */
export const isShout = (texts) => {
  const rows = list(texts).map((t) => str(t)).filter(Boolean);
  return rows.length > 0 && rows.every((t) => t.split(" ").length <= 2 && t.length <= 10 && !/[.。?]$/u.test(t));
};
/**
 * The picture with its words in the pocket: the picture markup, then the
 * panel. inner is trusted HTML (already escaped by the caller).
 */
export function pocketFrame(pictureHTML, inner, pocket, { shout = false, extra = "" } = {}) {
  if (!pocket) return pictureHTML;
  return `<div class="${pocketClasses(pocket)}${extra ? ` ${extra}` : ""}" style="${pocketStyle(pocket)}"><div class="pocket-picture">${pictureHTML}</div>${pocketPanel(inner, pocket, { shout })}</div>`;
}
/** The panel alone, for a container that already is the frame (classes from pocketClasses, the picture as its own child). */
export function pocketPanel(inner, pocket, { shout = false } = {}) {
  if (!pocket) return "";
  return `<div class="text-pocket${shout ? " text-pocket-shout" : ""}" data-pocket="${pocket.side}" data-share="${pocket.sample ?? pocket.share}"><div class="text-pocket-inner">${inner}</div></div>`;
}
export const pocketClasses = (pocket) => (pocket ? `pocket-frame pocket-${pocket.side}` : "");
export const pocketStyle = (pocket) => (pocket ? `--pocket-share:${pct(pocket.share)}` : "");
/** The words as paragraphs for the panel (escaped). */
export const pocketText = (texts) =>
  list(texts)
    .filter((row) => object(row) && str(row.text))
    .map((row) => `<p lang="${escapeHTML(row.lang)}" class="${escapeHTML(row.lang)}">${escapeHTML(String(row.text).trim())}</p>`)
    .join("");
/** The frame's stylesheet (the app's style.css carries the same rules; the print and the feedback file inline this). */
export const POCKET_CSS = `
.pocket-frame{position:relative;overflow:hidden}
.pocket-frame .pocket-picture{display:block}
.pocket-frame .pocket-picture>img,.pocket-frame .pocket-picture>svg,.pocket-frame .pocket-picture>.illustration{display:block;width:100%;height:auto}
.text-pocket{position:absolute;display:none;align-items:center;justify-content:center;padding:3% 4%;box-sizing:border-box;background:var(--pocket-bg,#f6f2e8);color:var(--pocket-fg,#2b2b2b);font-weight:600;line-height:1.5;word-break:keep-all;overflow-wrap:break-word;white-space:pre-line;text-align:center;z-index:1}
.pocket-on .text-pocket{display:flex}
.pocket-left .text-pocket{top:0;bottom:0;left:0;width:var(--pocket-share,34%)}
.pocket-right .text-pocket{top:0;bottom:0;right:0;width:var(--pocket-share,34%)}
.pocket-top .text-pocket{left:0;right:0;top:0;height:var(--pocket-share,30%)}
.pocket-bottom .text-pocket{left:0;right:0;bottom:0;height:var(--pocket-share,30%)}
.text-pocket-inner{max-width:100%;max-height:100%;overflow:hidden}
.text-pocket p,.text-pocket .ko,.text-pocket .en{margin:0}
.text-pocket p+p,.text-pocket .ko+.en{margin-top:.5em}
.text-pocket .en{font-weight:500;opacity:.9}
.text-pocket-shout .text-pocket-inner{font-size:2.4em;line-height:1.15;font-weight:800;letter-spacing:-.02em}
`;
/*
 * R48 글은 그림이 비워 둔 곳에만. The parent's printed PDF (v58): the R40/R47
 * panel, painted in the sampled wall colour, hid the top 45% of every spread
 * (mirrors, plants, a window) and nine tenths of a left half — "the words
 * cover the picture". The sampler called a cream wall "flat" (sd ≤ 0.09 over
 * the whole planned field) and R47 then grew the field into the art. Now the
 * words sit on a picture only where the picture really is empty: the placer
 * measures, from the pocket's edge inward, how far the picture stays one flat
 * colour (strip by strip), uses only that much, and when the words do not fit
 * there — or there is no flat edge at all — leaves them under the picture
 * (the print's text block, the reader's body, ④'s text fields). Nothing is
 * ever painted over art, no font shrinks over art, no translucent card.
 *
 * One function body shared by the app and the print tab. Markup contract:
 * a `.pocket-frame` (the picture and its `.text-pocket` panel, hidden until
 * `pocket-on`), its host = the closest `[data-pocket-host]` (else the frame),
 * and an optional words block `[data-pocket-words]` in the host whose `.ko`
 * and `.en` children the placer moves into the panel when they fit (all of
 * them, else the Korean alone → `pocket-split`, else none). A frame whose
 * panel already holds its words (④ cards) is simply switched on or off.
 */
export const POCKET_PLACE_SOURCE = `
function pocketFlatEdge(img,side,crop){
  const N=96,M=54,c=document.createElement('canvas');c.width=N;c.height=M;
  const ctx=c.getContext('2d');ctx.drawImage(img,0,0,N,M);
  const d=ctx.getImageData(0,0,N,M).data,x0=Math.floor(N*crop.x0),x1=Math.max(x0+1,Math.ceil(N*crop.x1)),vertical=side==='left'||side==='right';
  const lum=(i)=>(.299*d[i]+.587*d[i+1]+.114*d[i+2])/255;
  const strip=(k)=>{let sum=0,sq=0,n=0,r=0,g=0,b=0;const xs=vertical?[k]:null;
    for(let y=vertical?0:k;y<(vertical?M:k+1);y++)for(let x=vertical?k:x0;x<(vertical?k+1:x1);x++){const i=(y*N+x)*4,l=lum(i);sum+=l;sq+=l*l;n++;r+=d[i];g+=d[i+1];b+=d[i+2];}
    const mean=sum/n;return {mean,sd:Math.sqrt(Math.max(0,sq/n-mean*mean)),r:r/n,g:g/n,b:b/n};};
  const order=[];if(side==='left')for(let x=x0;x<x1;x++)order.push(x);else if(side==='right')for(let x=x1-1;x>=x0;x--)order.push(x);else if(side==='top')for(let y=0;y<M;y++)order.push(y);else for(let y=M-1;y>=0;y--)order.push(y);
  const first=strip(order[0]);if(first.sd>0.06)return {extent:0};
  let n=0,prev=first.mean,r=0,g=0,b=0,lum0=0;
  for(const k of order){const s=strip(k);if(s.sd>0.06||Math.abs(s.mean-prev)>0.03||Math.abs(s.mean-first.mean)>0.1)break;n++;prev=s.mean;r+=s.r;g+=s.g;b+=s.b;lum0+=s.mean;}
  return {extent:n/order.length,rgb:n?[r/n,g/n,b/n]:null,mean:n?lum0/n:0};
}
function pocketWords(block){return block?[...block.children].filter((el)=>el.classList.contains('ko')||el.classList.contains('en')):[];}
function giveBack(words,els){for(const el of els)words.appendChild(el);const ko=words.querySelector(':scope>.ko'),en=words.querySelector(':scope>.en');if(ko&&en&&(ko.compareDocumentPosition(en)&Node.DOCUMENT_POSITION_PRECEDING))words.insertBefore(ko,en);}
function resetPocket(frame){
  const panel=frame.querySelector(':scope>.text-pocket'),inner=panel&&panel.querySelector('.text-pocket-inner'),host=frame.closest('[data-pocket-host]')||frame,words=host.querySelector('[data-pocket-words]');
  host.classList.remove('pocket-on','pocket-split');
  if(words&&inner)giveBack(words,pocketWords(inner));
  if(frame.dataset.share0)frame.style.setProperty('--pocket-share',Math.round(Number(frame.dataset.share0)*100)+'%');
}
function placePockets(root){
  let below=0;
  (root||document).querySelectorAll('.pocket-frame').forEach((frame)=>{
    const panel=frame.querySelector(':scope>.text-pocket'),inner=panel&&panel.querySelector('.text-pocket-inner'),img=frame.querySelector('img');
    if(!inner||!img)return;
    if(!frame.dataset.share0)frame.dataset.share0=String((parseFloat(frame.style.getPropertyValue('--pocket-share'))||30)/100);
    resetPocket(frame);
    if(!(img.complete&&img.naturalWidth)||!frame.getBoundingClientRect().height)return;
    const host=frame.closest('[data-pocket-host]')||frame,words=host.querySelector('[data-pocket-words]'),side=panel.dataset.pocket,band=side==='top'||side==='bottom';
    const half=frame.closest('.ob-half-left')?'left':frame.closest('.ob-half-right')?'right':'';
    const crop=half==='left'?{x0:0,x1:.5}:half==='right'?{x0:.5,x1:1}:{x0:0,x1:1};
    let flat;try{flat=pocketFlatEdge(img,side,crop);}catch(e){flat={extent:0};}
    const extent=band?flat.extent:(half?Math.min(1,flat.extent):flat.extent);
    const share=Math.min(band?.6:.65,extent-.02);
    const over=()=>{if(inner.scrollHeight>inner.clientHeight)return true;const box=inner.getBoundingClientRect(),last=[...inner.children].reverse().find((el)=>getComputedStyle(el).display!=='none');return !!last&&last.getBoundingClientRect().bottom>box.bottom+.25;};
    const on=(split)=>{host.classList.add('pocket-on');if(split)host.classList.add('pocket-split');};
    if(share<.14){below++;return;}
    frame.style.setProperty('--pocket-share',Math.round(share*100)+'%');
    if(flat.rgb){panel.style.setProperty('--pocket-bg','rgb('+Math.round(flat.rgb[0])+','+Math.round(flat.rgb[1])+','+Math.round(flat.rgb[2])+')');panel.style.setProperty('--pocket-fg',flat.mean>0.6?'#2b2b2b':'#fffaf0');}
    host.classList.add('pocket-on');
    if(!words){if(over()){host.classList.remove('pocket-on');below++;}return;}
    const all=pocketWords(words),ko=all.filter((el)=>el.classList.contains('ko')),en=all.filter((el)=>el.classList.contains('en'));
    for(const el of all)inner.appendChild(el);
    if(!over())return;
    if(ko.length&&en.length){giveBack(words,en);if(!over()){on(true);return;}}
    giveBack(words,pocketWords(inner));
    host.classList.remove('pocket-on','pocket-split');below++;
  });
  return below;
}`;
/** The print tab's script: the placer, exposed for the openings fit (window.__placePockets / __resetPockets / __notePockets); a page print runs it itself. */
export const POCKET_SAMPLER_SCRIPT = `<script>(()=>{${POCKET_PLACE_SOURCE}
window.__placePockets=placePockets;
window.__resetPockets=(root)=>(root||document).querySelectorAll('.pocket-frame').forEach(resetPocket);
const note=(n)=>{const w=document.getElementById('print-pocket-warning');if(w){w.hidden=!n;w.textContent=n+'쪽은 그림이 글 자리를 비워 두지 않아 글을 그림 아래에 두었어요.';}};
window.__notePockets=note;
if(!document.querySelector('.ob-sheet')){
 const run=()=>{note(placePockets(document));if(window.__fitPages)window.__fitPages();};
 const ready=async()=>{await Promise.all(Array.from(document.images,img=>img.complete?Promise.resolve():new Promise(r=>{img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true});})));if(document.fonts)await document.fonts.ready;run();};
 window.addEventListener('beforeprint',run);ready();
}
})();</script>`;
let placer = null,
  resizeHooked = false;
/** The app: place every pocket's words (once its picture has loaded, and again when the window changes size). Browser only; a no-op elsewhere. */
export function samplePocketColours(root) {
  if (typeof document === "undefined") return;
  if (!placer) placer = new Function(`${POCKET_PLACE_SOURCE}\nreturn placePockets;`)();
  const scope = root || document;
  scope.querySelectorAll?.(".pocket-frame").forEach((frame) => {
    const img = frame.querySelector("img");
    if (img && !(img.complete && img.naturalWidth)) img.addEventListener("load", () => placer(frame.parentNode || document), { once: true });
  });
  placer(scope);
  if (!resizeHooked && typeof window !== "undefined") {
    resizeHooked = true;
    let timer = null;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => placer(document), 150);
    });
  }
}
/** R47's name for the same thing (kept for callers). */
export const fitPocketWords = samplePocketColours;
