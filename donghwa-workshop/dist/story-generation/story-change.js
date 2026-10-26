/* 달라지는 것 (R38, 2026-10-26). The parent on a finished picture-led book:
 * "the ending is simple and hard to follow, there is no point to it, the
 * framing never changes, and why does it start at home again?" The outline
 * request asked for a want and a turn in one soft sentence and checked
 * nothing about the end. A new diet draft now freezes input.storyChange
 * {version: 1}; its outline must say in one line what is different at the
 * end (change), what the hero expects at the want (expectation) and which
 * of two endings the last beat takes (echo: the first beat mirrored with one
 * thing changed; open: a small question or an "uh-oh" the child answers).
 * The last beat shows the change in an action and never says it. The same
 * marker gates the R38 picture rules (picture-plan.js, scene-prompt.js) and
 * the wordless page. Drafts without the marker are unchanged. Pure module. */
export const STORY_CHANGE_VERSION = 1;
export const storyChangePolicy = () => ({ version: STORY_CHANGE_VERSION });
export const hasStoryChange = (input) => input?.storyChange?.version === STORY_CHANGE_VERSION && input?.promptDiet?.version === 1;
export const ENDING_KINDS = Object.freeze(["echo", "open"]);
const str = (value, max = 200) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
/** The outline request schema's three fields (added to a cloned schema). */
export function withStoryChangeSchema(schema, input) {
  if (!hasStoryChange(input) || !schema?.properties) return schema;
  schema.properties.change = { type: "string", minLength: 1, maxLength: 200 };
  schema.properties.expectation = { type: "string", minLength: 1, maxLength: 200 };
  schema.properties.ending = { type: "string", enum: [...ENDING_KINDS] };
  schema.required = [...new Set([...(schema.required || []), "change", "expectation", "ending"])];
  return schema;
}
/** The outline request's paragraph (English, the writers' language there). */
export function storyChangeOutlineRule(input) {
  if (!hasStoryChange(input)) return "";
  return `WHAT CHANGES: return change — one sentence, "at first …; by the end …" — the one thing that is different when the book closes (what the hero knows, can do, has or feels). The want beat names what the hero expects to happen (return it as expectation); the turn beat overturns that expectation in a moment the child can see in the picture; the last beat shows the change in one action and never says it. Return ending: "echo" when the last beat mirrors the first with that one thing changed, or "open" when the last beat ends on a small question or an "uh-oh" the child answers. A story where nothing is different at the end is not finished.`;
}
/** Clean the three fields on an outline (in place): asked-for drafts keep clean values, others carry none. */
export function settleStoryChange(outline, input) {
  if (!outline || typeof outline !== "object") return outline;
  if (!hasStoryChange(input)) {
    delete outline.change;
    delete outline.expectation;
    delete outline.ending;
    return outline;
  }
  const change = str(outline.change),
    expectation = str(outline.expectation),
    ending = str(outline.ending, 20).toLowerCase();
  if (change) outline.change = change;
  else delete outline.change;
  if (expectation) outline.expectation = expectation;
  else delete outline.expectation;
  if (ENDING_KINDS.includes(ending)) outline.ending = ending;
  else delete outline.ending;
  return outline;
}
/** The hard outline violation when the asked-for change is missing (the model wrote no ending). */
export function storyChangeViolations(outline, input) {
  if (!hasStoryChange(input)) return [];
  return str(outline?.change) ? [] : [{ code: "change_missing", message: "끝에서 달라지는 것 한 줄(change)이 필요해요." }];
}
const endingLine = { ko: { echo: "끝은 첫 장면을 되비추되 하나만 달라져요.", open: "끝은 작은 물음이나 ‘어어?’로 열어 두어요." }, en: { echo: "The ending mirrors the first page with one thing changed.", open: "The ending stays open on a small question or an 'uh-oh'." } };
/**
 * The beat writers' line for one beat (the want, the turn and the close
 * beats; empty for the rest and for outlines without a change).
 */
export function storyChangeWriterLine(outline, beat, lang = "ko") {
  const change = str(outline?.change),
    expectation = str(outline?.expectation),
    type = String(beat?.type || "");
  if (!change) return "";
  const ko = lang === "ko";
  if (type === "want" && expectation) return ko ? `[기대] 여기서 ${expectation} — 아이가 그 기대를 함께 품게 써요.` : `[Expectation] Here the hero expects: ${expectation}. Let the child share it.`;
  if (type === "turn" && expectation) return ko ? `[뒤집기] "${expectation}"가 여기서 뒤집혀요. 아이가 그림에서 먼저 보게, 말은 적게.` : `[The turn] "${expectation}" is overturned here. Let the picture show it first; keep the words few.`;
  if (type === "close")
    return ko
      ? `[이 책이 끝에서 보여 줄 것] ${change} — 행동 하나로 보여 주고 말로 하지 않아요. ${endingLine.ko[outline?.ending] || ""}`.trim()
      : `[What the ending shows] ${change} — in one action, never said. ${endingLine.en[outline?.ending] || ""}`.trim();
  return "";
}
/** The K1 writer's block (whole book at once). */
export function storyChangeK1Block(outline) {
  const change = str(outline?.change);
  if (!change) return "";
  return `[달라지는 것] ${change}${str(outline?.expectation) ? ` / 처음의 기대: ${str(outline.expectation)}` : ""} — 마지막 쪽은 이것을 행동 하나로 보여 주고 말로 하지 않아요. ${endingLine.ko[outline?.ending] || ""}`.trim();
}
/** One line for ③, the eco outline and the pro card. */
export function storyChangeSummary(outline) {
  const change = str(outline?.change);
  return change ? `달라지는 것 · ${change}${outline?.ending ? ` (${outline.ending === "open" ? "열린 끝" : "되비추는 끝"})` : ""}` : "";
}
/* ---------- 어디서? (R38 C2): the parent's opening place for a simple draft ---------- */
export const STORY_PLACE_VERSION = 1;
/** The frozen reference: a drawer background id, or null. */
export function storyPlaceRef(value, backgrounds = []) {
  const id = str(value && typeof value === "object" && value.version === STORY_PLACE_VERSION ? value.id : "", 80);
  return id && (Array.isArray(backgrounds) ? backgrounds : []).some((b) => b?.id === id) ? { version: STORY_PLACE_VERSION, id } : null;
}
export const storyPlace = (id, backgrounds = []) => storyPlaceRef({ version: STORY_PLACE_VERSION, id }, backgrounds);
/** The chosen place's name for the outline request, or "". */
export function storyPlaceName(input) {
  const ref = storyPlaceRef(input?.storyPlace, input?.backgrounds);
  const background = ref ? (input.backgrounds || []).find((b) => b.id === ref.id) : null;
  return background ? str(background.nameEn || background.name, 40) : "";
}
/* ---------- R38 D·B5: the page book's voice and the wordless page ---------- */
const pictureLedBook = (input) => input?.bookFormat?.version === 1 && input.bookFormat.id === "pictureLed";
/** A picture-led R38 book's writers hear that not every page is the child speaking (twelve exclamations made one book). */
export function pageBookVoiceLine(input, lang = "ko") {
  if (!hasStoryChange(input) || !pictureLedBook(input)) return "";
  return lang === "ko"
    ? "쪽마다 아이가 외치는 말만 두지 않아요: 이야기꾼의 한 줄, 소리말 하나, 올 때마다 한 낱말만 바뀌는 되풀이 줄이 몇 쪽을 맡아요."
    : "Not every page is the child speaking: let a narrator's line, a sound, or a returning line with one word changed carry some pages.";
}
/** The pagination (and K1 writer) line that allows one wordless entry. */
export function wordlessRule(input, { k1 = false } = {}) {
  if (!hasStoryChange(input) || !pictureLedBook(input)) return "";
  return k1
    ? "말 없는 쪽: 그림이 말하는 비트(그림 계획 carrier가 picture)의 쪽 하나는 ko와 en을 빈 글(\"\")로 두어도 돼요 — 책에 한 쪽만, 첫 쪽과 마지막 쪽은 아니에요."
    : 'WORDLESS: one entry in the middle of the book whose beat is told by its picture (picturePlan carrier "picture") may carry no text at all — return "" for textKo and textEn there. At most one such entry; never the first or the last.';
}
/** The pagination request schema lets the text fields be empty (the validator decides which entry may be). */
export function withWordlessSchema(schema, input) {
  if (!hasStoryChange(input) || !pictureLedBook(input)) return schema;
  const page = schema?.properties?.pages?.items?.properties;
  if (!page) return schema;
  for (const key of ["textKo", "textEn"]) if (page[key] && typeof page[key] === "object") page[key] = { ...page[key], minLength: 0 };
  return schema;
}
const blank = (value) => !String(value ?? "").trim();
const carrierOf = (outline, beatIndex) => {
  const beat = (Array.isArray(outline?.beats) ? outline.beats : []).find((row) => Number(row?.index) === Number(beatIndex));
  return beat?.picturePlan && typeof beat.picturePlan === "object" ? String(beat.picturePlan.carrier || "") : "";
};
/**
 * The one entry a picture-led R38 book may leave without words: both texts
 * blank, a middle entry, its beat told by the picture, and the first such
 * entry in the book (a second blank entry is a missing text, as before).
 */
export function isWordlessEntry(page, index, pages, outline, input) {
  if (!hasStoryChange(input) || !pictureLedBook(input)) return false;
  const list = Array.isArray(pages) ? pages : [];
  if (!page || index <= 0 || index >= list.length - 1) return false;
  if (!blank(page.textKo ?? page.ko) || !blank(page.textEn ?? page.en)) return false;
  if (carrierOf(outline, page.beatIndex) !== "picture") return false;
  const first = list.findIndex((row) => row && blank(row.textKo ?? row.ko) && blank(row.textEn ?? row.en));
  return first === index;
}
/** The indexes of the wordless entries (0 or 1) for the ④ check. */
export function wordlessPageIndexes(pages, outline, input) {
  const list = Array.isArray(pages) ? pages : [];
  return new Set(list.map((page, i) => (isWordlessEntry(page, i, list, outline, input) ? i : -1)).filter((i) => i >= 0));
}
