/* 이야기의 드라마 (R39, 2026-10-27). The parent on a finished 16-page K2 book
 * (umbrella): "overall better, but the story is too flat; make it more
 * creative and story-like — the hero talking alone on a cut-out, a thought
 * on an empty page, the picture and the words stronger together — and why
 * is there a dinosaur on the cover?" The outline asked for a want, tries, a
 * turn and a change, but nothing kept the tries from being the same move
 * three times, nothing gave the child something to see before the hero, the
 * companion only helped, and every page was the same kind of page. A new
 * diet draft now freezes input.storyDrama {version: 1}; its outline carries a
 * kind for every try (never two alike), what each try changes, a secret the
 * child sees before the hero, the companion's own want and a flipped
 * refrain; its picture plan may put a beat on a plain single-colour
 * backdrop (a thought, a monologue) or on no picture at all (the words
 * alone on a coloured page); its cover shows only the cast of the story.
 * Drafts without the marker are unchanged. Pure module. */
import { hasStoryChange } from "./story-change.js";
import { ideaRepeatsTries, ideaInputFor } from "./idea-deck.js";
import { hasStoryManners, mannersSecretRule } from "./story-manners.js";
export const STORY_DRAMA_VERSION = 1;
export const storyDramaPolicy = () => ({ version: STORY_DRAMA_VERSION });
/** The marker, on a diet draft that also has the R38 change contract. */
export const hasStoryDrama = (input) => input?.storyDrama?.version === STORY_DRAMA_VERSION && hasStoryChange(input);
export const TRY_KINDS = Object.freeze(["force", "trick", "ask", "wait", "giveup"]);
export const BACKDROPS = Object.freeze(["scene", "plain", "none"]);
const TRY_KO = Object.freeze({ force: "힘으로", trick: "꾀로", ask: "부탁으로", wait: "기다리며", giveup: "포기하듯" });
const TRY_EN = Object.freeze({ force: "by force", trick: "by a trick", ask: "by asking", wait: "by waiting", giveup: "by giving up" });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 200) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
/** A sentence used inside another: no trailing full stop. */
const clause = (value, max = 200) => str(value, max).replace(/[.。!]+$/u, "");
const isK1 = (input) => input?.k1Policy?.version === 1 || /^K1$/u.test(String(input?.specs?.ko?.id || ""));
const pictureLedBook = (input) => input?.bookFormat?.version === 1 && input.bookFormat.id === "pictureLed";
/* ---------- the outline contract ---------- */
/** The outline request schema's fields (added to a cloned schema): per-beat tryKind and consequence, secret, companion, refrain.flip. */
export function withStoryDramaSchema(schema, input) {
  if (!hasStoryDrama(input) || !schema?.properties) return schema;
  const beat = schema.properties.beats?.items;
  if (object(beat?.properties)) {
    beat.properties.tryKind = { type: "string", enum: [...TRY_KINDS, "none"] };
    beat.properties.consequence = { type: "string", maxLength: 200 };
    beat.required = [...new Set([...(beat.required || []), "tryKind", "consequence"])];
  }
  if (!isK1(input)) {
    // R49: a manners draft may answer "" — only a story with something to hide has a secret.
    schema.properties.secret = { type: "string", ...(hasStoryManners(input) ? {} : { minLength: 1 }), maxLength: 200 };
    schema.required = [...new Set([...(schema.required || []), "secret"])];
  }
  schema.properties.companion = { type: "string", maxLength: 200 };
  schema.required = [...new Set([...(schema.required || []), "companion"])];
  const refrain = schema.properties.refrain;
  if (object(refrain?.properties)) refrain.properties.flip = { type: "string", maxLength: 150 };
  return schema;
}
/** The outline request's DRAMA paragraph (English, the writers' language there). */
export function storyDramaOutlineRule(input) {
  if (!hasStoryDrama(input)) return "";
  const k1 = isK1(input);
  return `DRAMA: the attempt beats are different kinds of trying, never the same move again a little bigger — return tryKind on every beat: "force" (push, pull, climb, chase), "trick" (a plan, a tool, a disguise), "ask" (asking someone or something for help), "wait" (waiting, listening, hiding, sneaking), "giveup" (stopping, turning away, sulking — and something happens anyway); "none" on beats that are not attempts. ${
    ideaRepeatsTries(input)
      ? "This book's device is the same plan tried again: the attempt beats may share a kind, but each try goes wrong in a new way and changes something different."
      : "Two attempt beats never share a kind."
  } Return consequence on each attempt beat — what that try changes in the world (something breaks, moves, wakes, is lost; someone notices) — so the next beat starts from it; "" on other beats.${
    k1
      ? ""
      : mannersSecretRule(input) || ` Return secret: one thing the child can see in the pictures from early on that the hero has not noticed (where the lost thing is, who is following, what the strange sound was); the turn is the hero finally seeing it, and the words never point at it before then.`
  } Return companion: what the companion wants for themselves in this story (not helping the hero) — it gets in the way or helps by accident; "" when the hero is alone. refrain.flip: when there is a refrain, the version that comes back changed at the end (one word turned); "" when there is none.`;
}
/** Clean the drama fields on an outline (in place): asked-for drafts keep clean values, others carry none. */
export function settleStoryDrama(outline, input) {
  if (!object(outline)) return outline;
  const wanted = hasStoryDrama(input);
  for (const beat of list(outline.beats)) {
    if (!object(beat)) continue;
    const kind = str(beat.tryKind, 20).toLowerCase(),
      consequence = str(beat.consequence),
      attempt = beat.type === "attempt";
    if (wanted && attempt && TRY_KINDS.includes(kind)) beat.tryKind = kind;
    else delete beat.tryKind;
    if (wanted && attempt && consequence) beat.consequence = consequence;
    else delete beat.consequence;
  }
  for (const key of ["secret", "companion"]) {
    const value = wanted ? str(outline[key]) : "";
    if (value) outline[key] = value;
    else delete outline[key];
  }
  if (object(outline.refrain)) {
    const flip = wanted ? str(outline.refrain.flip, 150) : "";
    if (flip) outline.refrain.flip = flip;
    else delete outline.refrain.flip;
  }
  return outline;
}
/** The hard outline violations: a try without a kind, two tries of one kind, a missing secret (not K1). Structure, never quality. */
export function storyDramaViolations(outline, input) {
  if (!hasStoryDrama(input)) return [];
  const out = [],
    attempts = list(outline?.beats).filter((beat) => object(beat) && beat.type === "attempt"),
    kinds = attempts.map((beat) => str(beat.tryKind, 20).toLowerCase());
  if (attempts.length && kinds.some((kind) => !TRY_KINDS.includes(kind)))
    out.push({ code: "try_kinds", message: "시도 비트마다 시도의 종류(tryKind: force·trick·ask·wait·giveup)가 필요해요." });
  // R46: the device "same plan again" lets the tries share a kind.
  else if (!ideaRepeatsTries(ideaInputFor(input, outline?.bible?.device)) && new Set(kinds).size < kinds.length)
    out.push({ code: "try_kinds", message: "시도 비트의 종류가 서로 달라야 해요(같은 방법을 되풀이하지 않아요)." });
  if (!isK1(input) && !hasStoryManners(input) && !str(outline?.secret)) out.push({ code: "secret_missing", message: "아이가 주인공보다 먼저 보는 것 한 줄(secret)이 필요해요." });
  return out;
}
/** The try kinds of an outline's attempt beats, in order. */
export const tryKindsOf = (outline) => list(outline?.beats).filter((beat) => object(beat) && beat.type === "attempt" && TRY_KINDS.includes(beat.tryKind)).map((beat) => beat.tryKind);
/**
 * The beat writers' lines for one beat: the try's kind and consequence (attempt
 * beats), the secret (before and at the turn), the companion's own want
 * (beats with a companion) and the flipped refrain (the close beat).
 */
export function storyDramaWriterLine(outline, beat, lang = "ko") {
  if (!object(outline) || !object(beat)) return "";
  const ko = lang === "ko",
    type = String(beat.type || ""),
    secret = clause(outline.secret),
    companion = clause(outline.companion),
    flip = str(outline.refrain?.flip, 150),
    lines = [];
  if (type === "attempt" && TRY_KINDS.includes(beat.tryKind)) {
    const consequence = clause(beat.consequence),
      // R46: an outline whose device is the same plan again repeats a kind; say so instead of "a different way".
      before = list(outline.beats).filter((row) => object(row) && row.type === "attempt" && Number(row.index) < Number(beat.index)).pop(),
      again = before?.tryKind === beat.tryKind;
    lines.push(
      ko
        ? again
          ? `[시도 종류] 이번에도 같은 계획을 ${TRY_KO[beat.tryKind]} 다시 해 봐요 — 이번엔 새로운 방식으로 어긋나요.${consequence ? ` 결과: ${consequence} — 다음 비트는 여기서 시작해요.` : ""}`
          : `[시도 종류] 이번 시도는 ${TRY_KO[beat.tryKind]} 해 보는 거예요 — 앞 시도와 다른 방법이에요.${consequence ? ` 결과: ${consequence} — 다음 비트는 여기서 시작해요.` : ""}`
        : again
          ? `[This try] The same plan again, ${TRY_EN[beat.tryKind]} — this time it goes wrong in a new way.${consequence ? ` What it changes: ${consequence}. The next beat starts from that.` : ""}`
          : `[This try] The hero tries ${TRY_EN[beat.tryKind]} — a different way from the try before.${consequence ? ` What it changes: ${consequence}. The next beat starts from that.` : ""}`,
    );
  }
  if (secret && ["setup", "want", "attempt"].includes(type))
    lines.push(ko ? `[비밀] 아이는 그림에서 이미 봐요: ${secret}. 글은 이것을 가리키지 않아요 — 주인공은 아직 몰라요.` : `[The secret] The child can already see it in the picture: ${secret}. The words never point at it — the hero has not noticed.`);
  if (secret && type === "turn") lines.push(ko ? `[비밀] 주인공이 드디어 봐요: ${secret}. 아이는 먼저 알고 있었으니 말은 적게, 보는 순간 하나로.` : `[The secret] Now the hero finally sees it: ${secret}. The child knew first, so keep the words few — one moment of seeing.`);
  if (companion && list(beat.characters).length > 1) lines.push(ko ? `[조연의 몫] ${companion} — 조연은 돕는 역할이 아니라 제 바람대로 움직여요.` : `[The companion's own want] ${companion} — the companion follows that, not the hero.`);
  if (flip && type === "close") lines.push(ko ? `[되풀이 뒤집기] 마지막에 되풀이 줄이 이렇게 바뀌어 돌아와요: "${flip}".` : `[The refrain, flipped] The returning line comes back changed at the end: "${flip}".`);
  return lines.join("\n");
}
/** The K1 writer's block (whole book at once). */
export function storyDramaK1Block(outline) {
  if (!object(outline)) return "";
  const tries = list(outline.beats)
      .filter((beat) => object(beat) && beat.type === "attempt" && TRY_KINDS.includes(beat.tryKind))
      .map((beat) => `${beat.index}비트 ${TRY_KO[beat.tryKind]}${clause(beat.consequence) ? ` → ${clause(beat.consequence)}` : ""}`),
    companion = clause(outline.companion),
    flip = str(outline.refrain?.flip, 150),
    rows = [
      tries.length
        ? new Set(tryKindsOf(outline)).size < tryKindsOf(outline).length
          ? `시도는 같은 계획의 되풀이예요 — 매번 새로운 방식으로 어긋나요: ${tries.join(" / ")}.`
          : `시도는 서로 다른 방법이에요: ${tries.join(" / ")}.`
        : "",
      clause(outline.secret) ? `아이가 주인공보다 먼저 보는 것: ${clause(outline.secret)} — 글은 전환 전에는 가리키지 않아요.` : "",
      companion ? `조연의 바람: ${companion} — 조연은 돕는 역할이 아니라 제 바람대로 움직여요.` : "",
      flip ? `되풀이 줄은 마지막에 이렇게 바뀌어요: "${flip}".` : "",
    ].filter(Boolean);
  return rows.length ? `[시도·비밀·조연] ${rows.join(" ")}` : "";
}
/** One line for ③, the eco outline and the pro card. */
export function storyDramaSummary(outline) {
  if (!object(outline)) return "";
  const kinds = tryKindsOf(outline).map((kind) => TRY_KO[kind].replace(/(으로|로|며|듯)$/u, "")),
    rows = [kinds.length ? `시도 · ${kinds.join("·")}` : "", str(outline.secret) ? `비밀 · ${str(outline.secret, 60)}` : "", str(outline.companion) ? `조연 · ${str(outline.companion, 60)}` : ""].filter(Boolean);
  return rows.join(" / ");
}
/* ---------- the writers' room ---------- */
/** The pitch's three extra fields (schema properties), for the writers' room of a drama draft. */
export function dramaPitchProperties(attempts) {
  return {
    tryKinds: { type: "array", items: { type: "string", enum: [...TRY_KINDS] }, minItems: attempts, maxItems: attempts },
    secret: { type: "string", maxLength: 200 },
    companion: { type: "string", maxLength: 200 },
  };
}
/** The author bot's extra instructions for a drama draft's pitches (Korean, the room's language). */
export function dramaPitchInstructions(attempts, { sameTry = false } = {}) {
  return `tryKinds(시도 ${attempts}개의 종류를 차례로 — force 힘으로·trick 꾀로·ask 부탁으로·wait 기다리며·giveup 포기하듯 — ${
    sameTry
      ? "이 책의 장치는 같은 계획 되풀이라 같은 종류를 다시 써도 되지만, 매번 새로운 방식으로 어긋나야 한다; 똑같이 어긋나는 사다리는 0점"
      : "같은 종류를 두 번 쓰지 않는다; 같은 시도를 조금 크게 되풀이하는 사다리는 0점"
  }), secret(아이는 그림에서 일찍부터 보지만 주인공은 모르는 것 한 줄 — 반전은 주인공이 그것을 드디어 보는 순간), companion(조연이 이 이야기에서 제 스스로 바라는 것 — 주인공을 돕는 역할이 아니라 방해하거나 우연히 돕는다; 조연이 없으면 빈 문자열)`;
}
/** The pitch's cleaned extra fields, or {} for a pitch without them. */
export function normalizeDramaPitch(raw, attempts) {
  if (!object(raw)) return {};
  const kinds = list(raw.tryKinds)
    .map((kind) => str(kind, 20).toLowerCase())
    .filter((kind) => TRY_KINDS.includes(kind))
    .slice(0, attempts);
  const out = {};
  if (kinds.length) out.tryKinds = kinds;
  if (str(raw.secret)) out.secret = str(raw.secret);
  if (str(raw.companion)) out.companion = str(raw.companion);
  return out;
}
/** True when a pitch's tries repeat a kind (the chair scores its ladder 0). */
export const pitchRepeatsTry = (pitch) => {
  const kinds = list(pitch?.tryKinds);
  return kinds.length > 1 && new Set(kinds).size < kinds.length;
};
/** The bible block's lines for the outline request. */
export function dramaBibleLines(bible) {
  if (!object(bible)) return "";
  const rows = [
    list(bible.tryKinds).length ? `The tries, each of a different kind: ${list(bible.tryKinds).map((kind) => TRY_EN[kind] || kind).join(" → ")}.` : "",
    str(bible.secret) ? `What the child sees before the hero: ${clause(bible.secret, 160)}.` : "",
    str(bible.companion) ? `The companion's own want: ${clause(bible.companion, 160)}.` : "",
  ].filter(Boolean);
  return rows.length ? `\n${rows.join(" ")}` : "";
}
/* ---------- the picture plan (secret placement, focus, backdrop) ---------- */
/** Add secret, focus and backdrop to a (cloned) outline schema's picturePlan. */
export function withDramaPlanSchema(schema, input) {
  if (!hasStoryDrama(input)) return schema;
  const plan = schema?.properties?.beats?.items?.properties?.picturePlan;
  if (!object(plan?.properties)) return schema;
  plan.properties.focus = { type: "string", maxLength: 80 };
  plan.properties.secret = { type: "string", maxLength: 120 };
  plan.properties.backdrop = { type: "string", enum: [...BACKDROPS] };
  plan.required = [...new Set([...(plan.required || []), "focus", "secret", "backdrop"])];
  return schema;
}
/** The outline request's addition to the PICTURE PLAN paragraph. */
export function dramaPlanRule(input) {
  if (!hasStoryDrama(input) || !pictureLedBook(input)) return "";
  return `PICTURE PLAN, three more fields: picturePlan.focus — the one thing the eye lands on in this picture (a hand, a door, the far hill; five words at most). picturePlan.secret — where the secret sits in this picture, small, in the same corner of the picture each time, "" when it is not in this picture (it is in most pictures before the turn, never pointed at). picturePlan.backdrop — "scene" (the place is painted), "plain" (the hero alone on a flat single-colour background: a thought, a line spoken to the reader, a feeling; at most two beats in the book), or "none" (no picture at all — the words stand alone on a coloured page, a thought in the child's own words; at most one beat, never the first or the last, only when carrier is "words"). Use plain and none where the story stops to think, not where something happens.`;
}
/** Clean the three plan fields in place (drama drafts) or drop them: backdrop caps (plain ≤ 2, none ≤ 1, never the first or last beat, none only on a words beat). */
export function settleDramaPlans(outline, input) {
  if (!object(outline) || !Array.isArray(outline.beats)) return outline;
  const wanted = hasStoryDrama(input) && pictureLedBook(input),
    planned = outline.beats.filter((beat) => object(beat) && object(beat.picturePlan)),
    last = planned.length - 1;
  let plain = 0,
    none = 0;
  planned.forEach((beat, i) => {
    const plan = beat.picturePlan,
      focus = wanted ? str(plan.focus, 80) : "",
      secret = wanted ? str(plan.secret, 120) : "",
      backdrop = wanted ? str(plan.backdrop, 20).toLowerCase() : "";
    if (focus) plan.focus = focus;
    else delete plan.focus;
    if (secret) plan.secret = secret;
    else delete plan.secret;
    const edge = i === 0 || i === last;
    if (backdrop === "plain" && !edge && plain < 2) {
      plan.backdrop = "plain";
      plain++;
    } else if (backdrop === "none" && !edge && none < 1 && plan.carrier === "words") {
      plan.backdrop = "none";
      none++;
    } else delete plan.backdrop;
  });
  return outline;
}
/** The picture request's parts for a plan (joined into the PICTURE PLAN line). */
export function dramaPlanPictureParts(plan) {
  if (!object(plan)) return [];
  return [
    str(plan.focus, 80) ? `the eye lands on ${str(plan.focus, 80)}` : "",
    str(plan.secret, 120) ? `what the child can see and the hero has not noticed: ${str(plan.secret, 120)} — small, in the same corner as before, never pointed at` : "",
    plan.backdrop === "plain" ? "no place at all: the character alone on a flat single-colour background (a thought, a line to the reader) with big empty space around" : "",
  ].filter(Boolean);
}
/** The parent's note parts for a plan (pro outline card, eco). */
export function dramaPlanNoteParts(plan) {
  if (!object(plan)) return [];
  return [
    str(plan.focus, 80) ? `시선 · ${str(plan.focus, 80)}` : "",
    str(plan.secret, 120) ? `비밀 · ${str(plan.secret, 120)}` : "",
    { plain: "단색 바탕 (생각·독백)", none: "그림 없이 글만" }[plan.backdrop] || "",
  ].filter(Boolean);
}
/** True when this page of a drama book is drawn on a plain single-colour backdrop (no place reference). */
export function plainBackdropFor(book, page, { cover = false } = {}) {
  if (cover || !hasStoryDrama(book?.storyInput)) return false;
  if (page?.backdrop === "plain") return true;
  const beat = list(book?.outline?.beats).find((row) => Number(row?.index) === Number(page?.beatIndex ?? page?.scene?.beatIndex));
  return object(beat?.picturePlan) && beat.picturePlan.backdrop === "plain";
}
/* ---------- the text-only page (backdrop "none") ---------- */
/** The pagination rule for the entry field. */
export function backdropRule(input) {
  if (!hasStoryDrama(input) || !pictureLedBook(input)) return "";
  return 'BACKDROP: every entry returns backdrop — "scene" (the usual picture), "plain" when that beat\'s picturePlan.backdrop is "plain" (the character alone on a flat colour), or "none" for the one entry of the beat whose picturePlan.backdrop is "none": that entry has no picture, its words stand alone on a coloured page (a thought in the child\'s own words; text in every language of the book; never the first or the last entry). "scene" everywhere else.';
}
/** The pagination request schema's entry field. */
export function withBackdropSchema(schema, input) {
  if (!hasStoryDrama(input) || !pictureLedBook(input)) return schema;
  const page = schema?.properties?.pages?.items;
  if (!object(page?.properties)) return schema;
  page.properties.backdrop = { type: "string", enum: [...BACKDROPS] };
  page.required = [...new Set([...(page.required || []), "backdrop"])];
  return schema;
}
const blank = (value) => !String(value ?? "").trim();
const planBackdropOf = (outline, beatIndex) => {
  const beat = list(outline?.beats).find((row) => Number(row?.index) === Number(beatIndex));
  return object(beat?.picturePlan) ? String(beat.picturePlan.backdrop || "") : "";
};
/**
 * Settle the entries' backdrop (in place): a drama book keeps "plain" and
 * "none" only where the beat's plan says so, never on the first or last
 * entry, one text-only entry at most and only with text, two plain at most;
 * everything else (and every other draft) carries no field.
 */
export function settleBackdrops(pagination, outline, input) {
  const pages = list(pagination?.pages);
  const wanted = hasStoryDrama(input) && pictureLedBook(input);
  let none = 0,
    plain = 0;
  pages.forEach((page, i) => {
    if (!object(page)) return;
    const value = wanted ? str(page.backdrop, 20).toLowerCase() : "",
      planned = wanted ? planBackdropOf(outline, page.beatIndex) : "",
      edge = i === 0 || i === pages.length - 1,
      hasText = !blank(page.textKo ?? page.ko) || !blank(page.textEn ?? page.en);
    if (value === "none" && planned === "none" && !edge && hasText && none < 1) {
      page.backdrop = "none";
      none++;
    } else if (value === "plain" && planned === "plain" && !edge && plain < 2) {
      page.backdrop = "plain";
      plain++;
    } else delete page.backdrop;
  });
  return pagination;
}
/** A page that has no picture by design: its words stand alone on a coloured page. */
export const isTextOnlyPage = (page) => object(page) && page.backdrop === "none";
/** The indexes of the text-only pages of a book. */
export const textOnlyPageIndexes = (pages) => list(pages).map((page, i) => (isTextOnlyPage(page) ? i : -1)).filter((i) => i >= 0);
const TINTS = Object.freeze(["#f6e7c1", "#dcebd6", "#f4d9d0", "#d9e4f1", "#ece0f2", "#fbe9b7"]);
/** The flat colour of a text-only page (from its position, the same every time). */
export const textOnlyTint = (index = 0) => TINTS[Math.abs(Number(index) || 0) % TINTS.length];
/** The flat SVG a print or PDF leaf shows for a text-only page (its words are typeset by the leaf itself). */
export function textOnlySVG(index = 0, { wide = false } = {}) {
  const w = wide ? 2048 : 1536,
    h = wide ? 880 : 1024;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${textOnlyTint(index)}"/></svg>`;
}
