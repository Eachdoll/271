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
.text-pocket{position:absolute;display:flex;align-items:center;justify-content:center;padding:3% 4%;box-sizing:border-box;background:rgba(255,253,246,.88);color:#2b2b2b;font-weight:600;line-height:1.5;word-break:keep-all;overflow-wrap:break-word;white-space:pre-line;text-align:center;z-index:1}
.text-pocket.pocket-flat{background:var(--pocket-bg,#f6f2e8);color:var(--pocket-fg,#2b2b2b)}
.pocket-left .text-pocket{top:0;bottom:0;left:0;width:var(--pocket-share,34%)}
.pocket-right .text-pocket{top:0;bottom:0;right:0;width:var(--pocket-share,34%)}
.pocket-top .text-pocket{left:0;right:0;top:0;height:var(--pocket-share,30%)}
.pocket-bottom .text-pocket{left:0;right:0;bottom:0;height:var(--pocket-share,30%)}
.text-pocket-inner{max-width:100%;max-height:100%;overflow:hidden}
.text-pocket p{margin:0}
.text-pocket p+p{margin-top:.5em}
.text-pocket .en{font-weight:500;opacity:.9}
.text-pocket-shout .text-pocket-inner{font-size:2.4em;line-height:1.15;font-weight:800;letter-spacing:-.02em}
`;
/**
 * The colour sampler, as a function body shared by the app and the print
 * tab: for every pocket panel, read the finished picture's field (a 48×48
 * copy), and when it is flat (little luminance spread) paint the panel in
 * that colour with dark or light type; otherwise keep the translucent card.
 */
export const POCKET_SAMPLER_SOURCE = `
function samplePockets(root){
  const frames=(root||document).querySelectorAll('.pocket-frame');
  frames.forEach((frame)=>{
    const img=frame.querySelector('img,.illustration'),panel=frame.querySelector('.text-pocket');
    if(!img||!panel||panel.dataset.sampled==='1')return;
    const go=()=>{
      try{
        const N=48,c=document.createElement('canvas');c.width=N;c.height=N;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0,N,N);
        const side=panel.dataset.pocket,share=Math.max(.1,Math.min(1,Number(panel.dataset.share)||.34));
        const x0=side==='right'?Math.floor(N*(1-share)):0,x1=side==='left'?Math.ceil(N*share):N;
        const y0=side==='bottom'?Math.floor(N*(1-share)):0,y1=side==='top'?Math.ceil(N*share):N;
        const d=ctx.getImageData(0,0,N,N).data;let r=0,g=0,b=0,n=0,sum=0,sq=0;
        for(let y=y0+1;y<y1-1;y++)for(let x=x0+1;x<x1-1;x++){const i=(y*N+x)*4;r+=d[i];g+=d[i+1];b+=d[i+2];n++;const l=(.299*d[i]+.587*d[i+1]+.114*d[i+2])/255;sum+=l;sq+=l*l;}
        if(!n)return;r/=n;g/=n;b/=n;const mean=sum/n,sd=Math.sqrt(Math.max(0,sq/n-mean*mean));
        panel.dataset.sampled='1';
        if(sd<=0.09){panel.style.setProperty('--pocket-bg','rgb('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+')');panel.style.setProperty('--pocket-fg',mean>0.6?'#2b2b2b':'#fffaf0');panel.classList.add('pocket-flat');}
        else panel.classList.add('pocket-busy');
      }catch(e){panel.dataset.sampled='1';panel.classList.add('pocket-busy');}
    };
    if(img.complete&&img.naturalWidth)go();else img.addEventListener('load',go,{once:true});
  });
}`;
/**
 * R47: the words always fit their field. For every pocket whose words are
 * taller than the field: grow the field a little (a band by 15 points, a side
 * field by 20); in the print, where the leaf has its text block under the
 * picture, then set the English there and keep the Korean in the field, and
 * if even that does not fit, set all the words under the picture rather than
 * cover the art; where there is no block (the app, a page print), grow the
 * field up to three quarters of the picture (a side field up to the whole
 * half) and then set this page's words smaller, down to 70% of the book's
 * size. A page that still overflows is marked pocket-overflow and counted.
 * Returns the count. Run after the pictures load, on resize and before printing.
 */
export const POCKET_FIT_SOURCE = `
function resetPocket(frame){
  const panel=frame.querySelector(':scope>.text-pocket'),host=frame.closest('.ob-leaf'),below=host&&host.querySelector('.ob-text');
  if(!frame.dataset.share0)frame.dataset.share0=String((parseFloat(frame.style.getPropertyValue('--pocket-share'))||30)/100);
  frame.style.setProperty('--pocket-share',Math.round(Number(frame.dataset.share0)*100)+'%');
  frame.classList.remove('pocket-overflow');if(panel)panel.style.fontSize='';
  if(host&&(host.classList.contains('pocket-split')||host.classList.contains('pocket-spill'))){host.classList.remove('pocket-split','pocket-spill');if(below)below.innerHTML='';}
}
function fitPockets(root){
  let overflow=0;
  (root||document).querySelectorAll('.pocket-frame').forEach((frame)=>{
    const panel=frame.querySelector(':scope>.text-pocket'),inner=panel&&panel.querySelector('.text-pocket-inner');
    if(!inner)return;
    resetPocket(frame);
    const base=Number(frame.dataset.share0)||.3,side=panel.dataset.pocket,band=side==='top'||side==='bottom',max=band?.75:1,soft=Math.min(max,base+(band?.15:.2));
    const host=frame.closest('.ob-leaf'),below=host&&host.querySelector('.ob-text');
    const set=(s)=>frame.style.setProperty('--pocket-share',Math.round(s*100)+'%');
    // Sub-pixel exact: the last visible line must end inside the field.
    const over=()=>{if(inner.scrollHeight>inner.clientHeight)return true;const box=inner.getBoundingClientRect(),last=[...inner.children].reverse().find((el)=>getComputedStyle(el).display!=='none');return !!last&&last.getBoundingClientRect().bottom>box.bottom+.25;};
    const grow=(to)=>{for(let s=base;s<to-1e-9;){s=Math.min(to,s+.05);set(s);if(!over())return true;}return !over();};
    if(!frame.getBoundingClientRect().height||!over())return;
    if(grow(soft))return;
    if(below){
      const ko=inner.querySelector('.ko'),en=inner.querySelector('.en');
      set(base);
      if(ko&&en&&ko.textContent.trim()&&en.textContent.trim()){host.classList.add('pocket-split');below.innerHTML=en.outerHTML;if(!over()||grow(soft))return;set(base);host.classList.remove('pocket-split');}
      host.classList.add('pocket-spill');below.innerHTML=inner.innerHTML;return;
    }
    if(grow(max))return;
    let px=parseFloat(getComputedStyle(panel).fontSize)||16;const floor=px*.7;
    while(over()&&px>floor){px=Math.max(floor,px-.5);panel.style.fontSize=px+'px';}
    if(over()){frame.classList.add('pocket-overflow');overflow++;}
  });
  return overflow;
}`;
/** The print tab's script: colours, and the fit (an openings print calls window.__fitPockets from its own fit; a page print fits here). */
export const POCKET_SAMPLER_SCRIPT = `<script>(()=>{${POCKET_SAMPLER_SOURCE}\n${POCKET_FIT_SOURCE}\nsamplePockets(document);
window.__fitPockets=fitPockets;
window.__resetPockets=(root)=>(root||document).querySelectorAll('.pocket-frame').forEach(resetPocket);
const note=(n)=>{const w=document.getElementById('print-pocket-warning');if(w){w.hidden=!n;w.textContent=n+'쪽의 글이 그림의 글 자리보다 길어요. ④에서 글을 조금 줄이면 그림이 더 많이 보여요.';}};
window.__notePockets=note;
if(!document.querySelector('.ob-sheet')){
 const run=()=>note(fitPockets(document));
 const ready=async()=>{await Promise.all(Array.from(document.images,img=>img.complete?Promise.resolve():new Promise(r=>{img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true});})));if(document.fonts)await document.fonts.ready;run();};
 window.addEventListener('beforeprint',run);ready();
}
})();</script>`;
let sampler = null,
  fitter = null,
  resizeHooked = false;
/** The app's sampler and fit (browser only; a no-op elsewhere). */
export function samplePocketColours(root) {
  if (typeof document === "undefined") return;
  if (!sampler) sampler = new Function(`${POCKET_SAMPLER_SOURCE}\nreturn samplePockets;`)();
  sampler(root);
  fitPocketWords(root);
}
/** R47: fit every pocket's words once its picture has loaded (and again when the window changes size). */
export function fitPocketWords(root) {
  if (typeof document === "undefined") return;
  if (!fitter) fitter = new Function(`${POCKET_FIT_SOURCE}\nreturn fitPockets;`)();
  const scope = root || document;
  scope.querySelectorAll?.(".pocket-frame").forEach((frame) => {
    const img = frame.querySelector("img");
    if (img && !(img.complete && img.naturalWidth)) img.addEventListener("load", () => fitter(frame.parentNode || document), { once: true });
  });
  fitter(scope);
  if (!resizeHooked && typeof window !== "undefined") {
    resizeHooked = true;
    let timer = null;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => fitter(document), 150);
    });
  }
}
