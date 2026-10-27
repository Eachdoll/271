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
/** The share of the picture the field takes: a beat told by its words gets more. */
export const pocketShare = (plan, side) => {
  const words = plan?.carrier === "words";
  return side === "top" || side === "bottom" ? (words ? 0.4 : 0.3) : words ? 0.45 : 0.34;
};
const PART = Object.freeze({ left: "the left", right: "the right", top: "the top", bottom: "the bottom" });
const pct = (share) => `${Math.round(share * 100)}%`;
/** The picture request's sentence (empty without a pocket). */
export function pocketPromptLine(plan) {
  const side = object(plan) && SIDES.includes(plan.pocket) ? plan.pocket : null;
  if (!side) return "";
  const share = pocketShare(plan, side),
    axis = side === "top" || side === "bottom" ? "height" : "width";
  return `TEXT FIELD: leave ${PART[side]} ${pct(share)} of the picture's ${axis} as one flat, even field of a single quiet colour from the style palette with nothing drawn in it — no details, no gradients, no figures, no texture; the words of this page will be printed there. Keep the figures and the action in the rest of the picture.`;
}
/** The plan's pocket for a page of a book (its beat's plan), or null. */
export function pocketOf(book, page) {
  if (!hasTextPocket(book?.storyInput) || !page || page.backdrop === "none") return null;
  const beat = list(book?.outline?.beats).find((row) => Number(row?.index) === Number(page?.beatIndex ?? page?.scene?.beatIndex)),
    plan = object(beat?.picturePlan) ? beat.picturePlan : null;
  return plan && SIDES.includes(plan.pocket) ? { side: plan.pocket, share: pocketShare(plan, plan.pocket) } : null;
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
export const POCKET_SAMPLER_SCRIPT = `<script>(()=>{${POCKET_SAMPLER_SOURCE}\nsamplePockets(document);})();</script>`;
let sampler = null;
/** The app's sampler (browser only; a no-op elsewhere). */
export function samplePocketColours(root) {
  if (typeof document === "undefined") return;
  if (!sampler) sampler = new Function(`${POCKET_SAMPLER_SOURCE}\nreturn samplePockets;`)();
  sampler(root);
}
