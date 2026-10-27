/* 글·그림 분담 (R36, 2026-10-24): a picture-led book decides, at planning
 * time, who tells each beat. The parent's point after R35: a picture book
 * like the reference is built by choosing, beat by beat, whether the words or
 * the picture carries the moment — and, when the picture does, how. The
 * outline now returns beat.picturePlan for a picture-led diet draft:
 *   carrier  words | picture | both | contrast (the words say one thing, the picture shows another)
 *   words    what only the words carry (Korean: a line of dialogue, a thought, a sound, time passing)
 *   picture  what the picture alone shows (English: faces, size, what is hidden or coming)
 *   shot     wide | middle | close        space  full | airy
 *   hook     what makes the child turn the page ("" when nothing)
 *   unit     spread | pages (openings books only)
 * It is a plan, not a rule: the writer is told it MAY leave the picture's part
 * unsaid, the pagination prefers the planned unit, the picture request adds
 * one composition line. Nothing is counted or checked against it, a missing
 * or odd plan is dropped silently and never costs a call. Pure module. */
import { isPictureLed } from "../book-format.js";
import { expressionOf, expressionFrameLine } from "./expression-deck.js";
import { hasStoryChange } from "./story-change.js";
import { dramaPlanPictureParts, dramaPlanNoteParts, hasStoryDrama } from "./story-drama.js";

export const PICTURE_PLAN_VERSION = 1;
export const CARRIERS = Object.freeze(["words", "picture", "both", "contrast"]);
export const SHOTS = Object.freeze(["wide", "middle", "close"]);
export const SPACES = Object.freeze(["full", "airy"]);
export const UNITS = Object.freeze(["spread", "pages"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value, max) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
const openingsOf = (input) => input?.layoutPolicy?.kind === "openings";

/** Only a picture-led diet draft plans its pictures (every other draft is unchanged). */
export const wantsPicturePlan = (input) => input?.promptDiet?.version === 1 && isPictureLed(input);

/** The beat's picturePlan in the outline request schema. */
export function picturePlanSchema(input) {
  const properties = {
    carrier: { type: "string", enum: [...CARRIERS] },
    words: { type: "string", maxLength: 160 },
    picture: { type: "string", maxLength: 240 },
    shot: { type: "string", enum: [...SHOTS] },
    space: { type: "string", enum: [...SPACES] },
    hook: { type: "string", maxLength: 160 },
    ...(openingsOf(input) ? { unit: { type: "string", enum: [...UNITS] } } : {}),
  };
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}
/** Add the plan to a (cloned) outline schema's beats. */
export function withPicturePlanSchema(schema, input) {
  if (!wantsPicturePlan(input)) return schema;
  const beat = schema?.properties?.beats?.items;
  if (!object(beat?.properties)) return schema;
  beat.properties.picturePlan = picturePlanSchema(input);
  beat.required = [...new Set([...(beat.required || []), "picturePlan"])];
  return schema;
}
/** A clean plan or null: unknown values are dropped, never guessed. */
export function normalizePicturePlan(plan, input) {
  if (!object(plan)) return null;
  const out = {};
  const carrier = str(plan.carrier, 20).toLowerCase();
  if (CARRIERS.includes(carrier)) out.carrier = carrier;
  const words = str(plan.words, 160),
    picture = str(plan.picture, 240),
    hook = str(plan.hook, 160);
  if (words) out.words = words;
  if (picture) out.picture = picture;
  const shot = { medium: "middle", closeup: "close", "close-up": "close" }[str(plan.shot, 20).toLowerCase()] || str(plan.shot, 20).toLowerCase();
  if (SHOTS.includes(shot)) out.shot = shot;
  const space = str(plan.space, 20).toLowerCase();
  if (SPACES.includes(space)) out.space = space;
  if (hook) out.hook = hook;
  const unit = str(plan.unit, 20).toLowerCase();
  if (openingsOf(input) && UNITS.includes(unit)) out.unit = unit;
  // R39: a drama draft's focus, secret placement and backdrop travel on (settleDramaPlans cleans and caps them).
  if (hasStoryDrama(input)) for (const key of ["focus", "secret", "backdrop"]) if (str(plan[key], 120)) out[key] = str(plan[key], 120);
  // A plan that says neither who tells the beat nor what the picture shows is no plan.
  return out.carrier || out.picture ? { version: PICTURE_PLAN_VERSION, ...out } : null;
}
/** Clean every beat's plan in place (picture-led diet drafts) or drop a plan nobody asked for. */
export function settlePicturePlans(outline, input) {
  if (!object(outline) || !Array.isArray(outline.beats)) return outline;
  const wanted = wantsPicturePlan(input);
  for (const beat of outline.beats) {
    if (!object(beat) || !("picturePlan" in beat)) continue;
    const plan = wanted ? normalizePicturePlan(beat.picturePlan, input) : null;
    if (plan) beat.picturePlan = plan;
    else delete beat.picturePlan;
  }
  // R38: a planned shot replaces the staging rotation (R36), so twelve "wide"
  // plans made twelve identical pictures. When one shot is planned for more
  // than half the beats, the repeats after the first of a run lose their
  // shot and the staging rotation takes over there; three in a row never stay.
  if (wanted && hasStoryChange(input)) settleShotVariety(outline.beats);
  return outline;
}
export function settleShotVariety(beats) {
  const rows = beats.filter((beat) => object(beat?.picturePlan));
  if (rows.length < 3) return;
  const counts = new Map();
  for (const beat of rows) if (beat.picturePlan.shot) counts.set(beat.picturePlan.shot, (counts.get(beat.picturePlan.shot) || 0) + 1);
  const [mode, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [],
    // The planned shots as they came, so a whole run collapses to its first beat.
    planned = rows.map((beat) => beat.picturePlan.shot);
  if (mode && count > Math.ceil(rows.length / 2))
    rows.forEach((beat, i) => {
      if (i > 0 && planned[i] === mode && planned[i - 1] === mode) delete beat.picturePlan.shot;
    });
  rows.forEach((beat, i) => {
    if (i >= 2 && planned[i] && planned[i - 1] === planned[i] && planned[i - 2] === planned[i]) delete beat.picturePlan.shot;
  });
}
export const planOf = (outline, beatIndex) => {
  const beat = (Array.isArray(outline?.beats) ? outline.beats : []).find((row) => Number(row?.index) === Number(beatIndex));
  return object(beat?.picturePlan) && beat.picturePlan.version === PICTURE_PLAN_VERSION ? beat.picturePlan : null;
};

/** The outline request's PICTURE PLAN paragraph (English, the writers' language there). */
export function picturePlanOutlineRule(input) {
  if (!wantsPicturePlan(input)) return "";
  const openings = openingsOf(input),
    // R37: with expression cards the example is general and the book's frame cards follow.
    expressed = !!expressionOf(input);
  return `PICTURE PLAN: for every beat return picturePlan — decide who tells this moment before anyone writes it. carrier: "words" (only words can carry it: a line, a thought, a sound, time passing), "picture" (the picture alone tells it; the words are a line or a sound), "both", or "contrast" (the words say one thing and the picture shows another${expressed ? "" : " — calm words over a huge wave"}). words: in Korean, the part only the words carry. picture: in English, what the picture alone shows (faces, size against the world, what is hidden or coming closer); the words will not repeat it. shot: wide (small figures, big world), middle, or close (faces and hands). space: full or airy (lots of empty space). hook: what makes the child turn the page here (a sentence left open, something entering at the edge), or "" when nothing.${openings ? " unit: spread for one big moment (a reveal, the turn, a new place), pages when the beat has two moments." : ""} Vary them across the book; one short phrase per field — it is a plan for the artist, not a script.${expressed ? ` ${expressionFrameLine(input)}` : ""}`;
}
/** The beat writer's line for one beat (Korean writer, then English). Permission, never a ban. */
export function picturePlanWriterLine(plan, lang = "ko") {
  if (!plan) return "";
  if (lang !== "ko")
    return plan.picture
      ? `[Picture and words] The picture shows: ${plan.picture}. You need not say that in words; tell what only words can.${plan.carrier === "picture" ? " This opening is told by its picture — one short line or a sound is enough." : ""}`
      : "";
  const who = {
    words: "이 펼침은 글이 말해요.",
    picture: "이 펼침은 그림이 말해요 — 글은 한두 문장이나 소리 하나면 돼요.",
    both: "글과 그림이 함께 말해요.",
    contrast: "글과 그림이 어긋나요 — 글은 글의 몫만, 그림은 다른 것을 보여 줘요.",
  }[plan.carrier];
  return [
    `[그림과 글의 몫]${who ? ` ${who}` : ""}`,
    plan.picture ? `그림이 보여 줘요: ${plan.picture} — 글로 다시 말하지 않아도 돼요.` : "",
    plan.words ? `글의 몫: ${plan.words}.` : "",
    plan.hook ? `넘김: ${plan.hook}.` : "",
    "읽어 주는 사람이 혼자 읽어도 무슨 일인지는 알 수 있게 써요.",
  ]
    .filter(Boolean)
    .join(" ");
}
/** The K1 writer's map suffix for one beat. */
export const picturePlanMapSuffix = (plan) =>
  plan ? ` / 그림 계획: ${[plan.carrier ? { words: "글이 말함", picture: "그림이 말함", both: "함께", contrast: "어긋남" }[plan.carrier] : "", plan.picture ? `그림 ${plan.picture}` : "", plan.words ? `글 ${plan.words}` : ""].filter(Boolean).join(" · ")}` : "";
/** The pagination rules' line (openings and page books). */
export function picturePlanPaginationLine(input) {
  if (!wantsPicturePlan(input)) return "";
  return `PICTURE PLAN: each approved beat carries picturePlan. scene.action is that beat's picturePlan.picture made into this entry's moment${openingsOf(input) ? "; picturePlan.unit is the planned shape (spread or two pages) — follow it unless the beat text clearly needs the other" : ""}. The picture's part stays in the picture; the text keeps its own part.`;
}
const SHOT_LINE = Object.freeze({
  wide: "wide view: small figures in a big world",
  middle: "middle distance",
  close: "close view: faces and hands fill the picture (gentle, well lit)",
});
const SPACE_LINE = Object.freeze({ full: "a full, busy picture", airy: "lots of quiet empty space around the figures" });
/** The picture request's composition line for one entry; empty without a plan. */
export function picturePlanPictureLine(plan) {
  if (!plan) return "";
  const parts = [
    plan.picture ? `the picture alone shows ${plan.picture}` : "",
    plan.carrier === "contrast" && plan.words ? `while the words say something else (${plan.words})` : "",
    plan.carrier === "picture" ? "there are almost no words here, so this picture tells the moment" : "",
    plan.shot ? SHOT_LINE[plan.shot] : "",
    plan.space ? SPACE_LINE[plan.space] : "",
    plan.hook ? `page turn: ${plan.hook}` : "",
    // R39: where the eye lands, where the secret sits, the plain backdrop (drama plans only; empty otherwise).
    ...dramaPlanPictureParts(plan),
  ].filter(Boolean);
  return parts.length ? `PICTURE PLAN (decided with the story): ${parts.join("; ")}. Keep it within the actual event above.` : "";
}
/** Model-written plan text a picture request carries (the lenient forbidden-word scope). */
export const picturePlanText = (plan) => (plan ? [plan.picture, plan.hook, plan.words].filter(Boolean) : []);
/** The parent's one line (pro outline card, eco). */
export function picturePlanNote(plan) {
  if (!plan) return "";
  return [
    { words: "글이 말해요", picture: "그림이 말해요", both: "글과 그림이 함께", contrast: "글과 그림이 어긋나게" }[plan.carrier] || "",
    plan.picture ? `그림 · ${plan.picture}` : "",
    plan.words ? `글 · ${plan.words}` : "",
    [{ wide: "멀리서", middle: "중간 거리", close: "가까이" }[plan.shot], { full: "꽉 찬 화면", airy: "여백 많이" }[plan.space], { spread: "펼침면 한 장", pages: "낱쪽 두 장" }[plan.unit]].filter(Boolean).join(" · "),
    plan.hook ? `넘김 · ${plan.hook}` : "",
    // R39: the eye's landing place, the secret's corner, a plain or text-only beat.
    ...dramaPlanNoteParts(plan),
  ]
    .filter(Boolean)
    .join(" / ");
}
