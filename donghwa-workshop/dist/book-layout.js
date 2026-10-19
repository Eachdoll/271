/* R12 openings picture books (펼침 구성). The one place that decides and reads a
 * book's layout; every caller uses these helpers and nothing derives a layout on
 * its own. Pure: no DOM, storage, network or clock, and inputs are never mutated.
 *
 * A book is "openings" only when its frozen input says so (input.layoutPolicy,
 * written by inputFromWizard when its caller passes layout 'openings') AND its
 * entries form a valid opening structure. Everything else (K1, English-only,
 * every book, draft and job made before R12, and a book whose structure broke)
 * is a page book, exactly as before R12.
 *
 * An opening is two facing printed pages carrying one approved beat: either ONE
 * entry (a spread: kind 'spread', side 'spread') or TWO entries (a left and a
 * right page: kind 'page'). The app derives kind, side, openingNo and entryId by
 * grouping the model's entries by beatIndex; the model never numbers openings. */
import { splitSentences } from "./story-quality/dist/util.js";

/** Off until R12-P8. Tests and the browser smoke turn it on with the hook below. */
export const OPENINGS_ENABLED = false;
const OPENINGS_HOOK = "__DONGHWA_R12_OPENINGS__";
export function openingsEnabled() {
  return OPENINGS_ENABLED || globalThis[OPENINGS_HOOK] === true;
}

export const OPENING_PAGE_COUNTS = Object.freeze([12, 16]);
export const OPENING_DEFAULT_PAGES = 16;
export const SPREAD_IMAGE_SIZE = "2048x880";
export const PAGE_IMAGE_SIZE = "1536x1024";
/** Frozen into input.layoutPolicy of every new openings draft or job. */
export const OPENINGS_LAYOUT_POLICY = Object.freeze({
  version: 1,
  kind: "openings",
  spreadImageSize: SPREAD_IMAGE_SIZE,
  pageImageSize: PAGE_IMAGE_SIZE,
});
/** A fresh copy of OPENINGS_LAYOUT_POLICY for a new input. */
export function openingsLayoutPolicy() {
  return { ...OPENINGS_LAYOUT_POLICY };
}
export const OPENING_KOREAN_LEVELS = Object.freeze(["K2", "K3", "K4"]);
const KOREAN_LANGUAGES = Object.freeze(["ko", "bilingual", "dual"]);
/** Stored on every openings entry; rewrites copy them back from the original. */
export const LAYOUT_FIELDS = Object.freeze([
  "kind",
  "openingNo",
  "side",
  "entryId",
  "cue",
]);
/** The pagination model's cue enum (why this opening is a spread or a pair). */
export const MODEL_CUES = Object.freeze([
  "highlight",
  "reveal",
  "arrival",
  "turn",
  "ending",
  "wide-scene",
  "two-moments",
]);
/** Korean labels of every stored cue, including the app's own 'auto-merged'. */
export const CUES = Object.freeze({
  highlight: "하이라이트",
  reveal: "깜짝 반전",
  arrival: "새 장소에 도착",
  turn: "이야기가 바뀌는 순간",
  ending: "마지막 장면",
  "wide-scene": "넓은 풍경",
  "two-moments": "장면 두 개",
  "auto-merged": "자동으로 합침",
});
/** Free fixes normalizeOpenings records in pagination.openingAdjustments. */
export const ADJUSTMENT_LABELS = Object.freeze({
  "extra-entry": "한 비트에 쪽이 셋 이상이라 둘로 합침",
  "empty-language": "한쪽 언어 글이 비어 펼침면으로 합침",
  "page-out-of-band": "낱쪽 글 양이 맞지 않아 펼침면으로 합침",
  "all-pairs": "모두 낱쪽이라 마지막 펼침을 펼침면으로 합침",
});
const PAGE_COUNT_OPTIONS = Object.freeze([
  [8, "8쪽 · 짧은 이야기"],
  [12, "12쪽 · 기본"],
  [16, "16쪽"],
  [24, "24쪽"],
]);
const OPENING_PAGE_COUNT_OPTIONS = Object.freeze([
  [12, "12쪽 · 펼침 6개 (짧게)"],
  [16, "16쪽 · 펼침 8개 (기본)"],
]);
/** Korean sentence-count slack around a unit range: [min − 1, max + 2]. */
const COUNT_SLACK = Object.freeze({ countBelow: 1, countAbove: 2 });
const PAGE_COUNT_ERROR = "펼침 구성 책은 12쪽이나 16쪽이어야 해요.";

const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const sentenceCount = (text) => splitSentences(String(text ?? "")).length;
const blank = (text) => !String(text ?? "").trim();
const unique = (list) => [...new Set(list)];

/* ---------- policy and layout ---------- */

/** The layout a NEW draft or job from this wizard gets. Only two callers pass it on. */
export function layoutFor(wizardLike) {
  if (!openingsEnabled()) return "pages";
  const level = String(wizardLike?.koreanLevel ?? "")
      .trim()
      .toUpperCase(),
    // inputFromWizard's own default language.
    language = wizardLike?.language || "bilingual";
  return OPENING_KOREAN_LEVELS.includes(level) &&
    KOREAN_LANGUAGES.includes(language)
    ? "openings"
    : "pages";
}
/** A validated copy of a stored openings policy; throws on anything else. */
export function normalizeLayoutPolicy(policy) {
  const size = (value) =>
    typeof value === "string" && /^\d{3,4}x\d{3,4}$/u.test(value);
  if (
    !isObject(policy) ||
    policy.version !== 1 ||
    policy.kind !== "openings" ||
    !size(policy.spreadImageSize) ||
    !size(policy.pageImageSize)
  )
    throw new Error("펼침 구성 정보를 확인해 주세요.");
  return {
    version: 1,
    kind: "openings",
    spreadImageSize: policy.spreadImageSize,
    pageImageSize: policy.pageImageSize,
  };
}
/** A frozen v4 openings level spec (freezeReadingLevels with layout 'openings'). */
export function isOpeningsSpec(spec) {
  return (
    isObject(spec) &&
    spec.layout === "openings" &&
    spec.ruleVersion === 4 &&
    isObject(spec.units)
  );
}

/** Where a book, a draft or job, an input or a pagination keeps its layout data. */
function sourceOf(value) {
  if (!isObject(value)) return { input: null, outline: null, pages: null };
  if (isObject(value.storyInput))
    return {
      input: value.storyInput,
      outline: value.outline || null,
      pages: Array.isArray(value.pages)
        ? value.pages
        : (value.pagination?.pages ?? null),
    };
  if (isObject(value.input))
    return {
      input: value.input,
      outline: value.outline || null,
      pages: value.book?.pages ?? value.pagination?.pages ?? null,
    };
  return {
    input: value,
    outline: null,
    pages: Array.isArray(value.pages) ? value.pages : null,
  };
}
/**
 * { layout, layoutMismatch, errors } of a book (storyInput + pages), a draft or
 * FULL AUTO job (input + book/pagination) or a bare input. 'openings' needs the
 * frozen policy AND, once entries exist, a valid opening structure; a policy with
 * broken or legacy entries (an old tab paginated it) is a page book with
 * layoutMismatch. The value is never marked: this module does not mutate.
 */
export function layoutStatus(value) {
  const { input, outline, pages } = sourceOf(value);
  if (input?.layoutPolicy?.kind !== "openings")
    return { layout: "pages", layoutMismatch: false, errors: [] };
  const errors = Array.isArray(pages)
    ? validateOpenings(pages, input, outline).errors
    : OPENING_PAGE_COUNTS.includes(Number(input.pageCount))
      ? []
      : [PAGE_COUNT_ERROR];
  return errors.length
    ? { layout: "pages", layoutMismatch: true, errors }
    : { layout: "openings", layoutMismatch: false, errors: [] };
}
export function layoutOf(value) {
  return layoutStatus(value).layout;
}

/* ---------- counting ---------- */

const widthOf = (page) => (page?.kind === "spread" ? 2 : 1);
/**
 * The openings of a book, draft, job or entry list:
 * [{ openingNo, beatIndex, kind: 'spread'|'pair', indices, printedPages }].
 * A page book (or a mismatched one) has none. A bare entry list is trusted.
 */
export function openingsOf(value) {
  const pages = Array.isArray(value)
    ? value
    : layoutOf(value) === "openings"
      ? sourceOf(value).pages
      : null;
  const out = [];
  let printed = 0;
  for (const [index, page] of (pages || []).entries()) {
    const last = out.at(-1);
    if (last && last.openingNo === page?.openingNo) last.indices.push(index);
    else
      out.push({
        openingNo: page?.openingNo,
        beatIndex: page?.beatIndex,
        kind: page?.kind === "spread" ? "spread" : "pair",
        indices: [index],
        printedPages: [],
      });
    const width = widthOf(page);
    out.at(-1).printedPages.push(
      ...Array.from({ length: width }, (_, k) => printed + k + 1),
    );
    printed += width;
  }
  return out;
}
/**
 * Printed pages. An entry list counts a spread as 2; a book, draft or job counts
 * entries for page books and widths for openings books; a bare input (or a job
 * before pagination) gives its pageCount, which is always in printed pages.
 */
export function printedPagesOf(value) {
  if (Array.isArray(value))
    return value.reduce((sum, page) => sum + widthOf(page), 0);
  const { input, pages } = sourceOf(value);
  if (!Array.isArray(pages)) return Number(input?.pageCount) || 0;
  return layoutOf(value) === "openings"
    ? printedPagesOf(pages)
    : pages.length;
}
export function unitKind(page) {
  return page?.kind === "spread" ? "spread" : "page";
}
/**
 * The level spec for one unit ('page', 'spread' or 'opening'): the unit's
 * sentence range and target as the page range, its English words per unit
 * (blocking, as wordsPerPage is today) and its K3 characters (advisory only).
 * A spec without units (every pre-R12 spec) comes back unchanged.
 */
export function unitSpec(spec, kind) {
  const unit = spec?.units?.[kind];
  if (!isObject(unit)) return spec;
  const out = {
    ...spec,
    unit: kind,
    sentencesPerPage: unit.target,
    sentencesPerPageRange: { min: unit.min, max: unit.max },
  };
  if (unit.words) out.wordsPerPage = [unit.words.min, unit.words.max];
  if (unit.chars) out.advisoryCharsPerPage = [unit.chars.min, unit.chars.max];
  return out;
}
/** The picture size of one entry; the cover (no page) and page books keep 1536x1024. */
export function unitImageSize(book, page) {
  if (layoutOf(book) !== "openings") return PAGE_IMAGE_SIZE;
  const policy = sourceOf(book).input.layoutPolicy;
  return unitKind(page) === "spread"
    ? policy.spreadImageSize
    : policy.pageImageSize;
}

/* ---------- page-count choices ---------- */

/** The page-count select of the pro wizard and the simple format panel. */
export function pageCountOptions(wizardLike) {
  return (
    layoutFor(wizardLike) === "openings"
      ? OPENING_PAGE_COUNT_OPTIONS
      : PAGE_COUNT_OPTIONS
  ).map(([value, label]) => [value, label]);
}
/**
 * The page count a wizard should show. Openings: 16 (기본) until the parent
 * touches the select, then the nearest of 12/16 (a tie goes to 16). Pages: the
 * parent's settings default until touched, then the value as it is.
 */
export function snapPageCount(
  layout,
  value,
  { touched = false, defaultPages } = {},
) {
  if (layout !== "openings") return touched ? value : defaultPages;
  const count = Number(value);
  if (!touched || !Number.isFinite(count)) return OPENING_DEFAULT_PAGES;
  let best = OPENING_PAGE_COUNTS[0];
  for (const option of OPENING_PAGE_COUNTS)
    if (Math.abs(option - count) <= Math.abs(best - count)) best = option;
  return best;
}

/* ---------- labels ---------- */

/** '펼침 3 · 5쪽(왼쪽)', '펼침 4 · 7–8쪽 펼침면'; page books keep 'n쪽'. */
export function unitLabel(book, index) {
  if (layoutOf(book) !== "openings") return `${index + 1}쪽`;
  const pages = sourceOf(book).pages || [],
    page = pages[index];
  if (!page) return `${index + 1}쪽`;
  const first = printedPagesOf(pages.slice(0, index)) + 1;
  if (page.kind === "spread")
    return `펼침 ${page.openingNo} · ${first}–${first + 1}쪽 펼침면`;
  return `펼침 ${page.openingNo} · ${first}쪽(${page.side === "left" ? "왼쪽" : "오른쪽"})`;
}

/* ---------- structure ---------- */

/** One approved beat per opening; throws (before any paid call) when they differ. */
export function buildOpeningPlan(outline, openings) {
  const beats = Array.isArray(outline?.beats) ? outline.beats : [];
  if (!Number.isInteger(openings) || openings < 1 || beats.length !== openings)
    throw new Error(
      `승인한 줄거리 비트 ${beats.length}개가 펼침 ${openings}개와 맞지 않아요.`,
    );
  return beats.map((beat, index) => ({
    openingNo: index + 1,
    beatIndex: beat.index,
    beatType: beat.type,
    printedPages: [2 * index + 1, 2 * index + 2],
  }));
}

const rangeOf = (unit) => (Array.isArray(unit) ? unit : [unit.min, unit.max]);
const inBand = (count, [min, max]) => count >= min && count <= max;
const joinText = (a, b) =>
  [a, b]
    .map((text) => String(text ?? "").trim())
    .filter(Boolean)
    .join(" ");
/** Two entries become one: both texts in order, the scene of the one with more Korean. */
function joinEntries(a, b) {
  const longer = sentenceCount(b.textKo) > sentenceCount(a.textKo) ? b : a;
  return {
    ...longer,
    textKo: joinText(a.textKo, b.textKo),
    textEn: joinText(a.textEn, b.textEn),
    isRefrainPage: a.isRefrainPage === true || b.isRefrainPage === true,
  };
}
function placed(entry, plan, side) {
  return {
    ...entry,
    kind: side === "spread" ? "spread" : "page",
    side,
    openingNo: plan.openingNo,
    entryId: `b${plan.beatIndex}-${side}`,
    cue: Object.hasOwn(CUES, entry.cue ?? "") ? entry.cue : null,
  };
}
/**
 * Free, deterministic clean-up of a pagination response (or of a stored openings
 * pagination), in this order:
 * 1. group the entries by beatIndex (an entry of an unknown beat is kept in
 *    `unplaced` and asks for a repagination; beatIndex is never rewritten); order a
 *    group by pageNo when those are distinct integers, else by array order;
 * 2. join 3+ entries of one beat, the adjacent two with the fewest Korean sentences
 *    first, until two remain (texts joined, the longer one's scene kept);
 * 3. merge a bad pair into a spread: a page with an empty language, or a Korean page
 *    outside [page.min − 1, page.max + 2] whose joined text fits
 *    [spread.min − 1, spread.max + 2]. English length never merges, and sentences
 *    never move between pages, so the two languages cannot drift apart;
 * 4. mix guard: with 6+ openings and every opening a pair, the closing opening
 *    becomes a spread; every opening a spread is kept with mixNote 'all-spreads';
 * 5. kind, side, openingNo, entryId and pageNo are derived; cue is kept when known.
 * Only an approved beat with no entry at all sets needsRepagination (the one paid fix).
 * `units` is the frozen specs ({ ko: { units } }) or { ko: { page, spread } } ranges.
 */
export function normalizeOpenings(entries, plan, units) {
  const ko = units?.ko?.units || units?.ko;
  if (!Array.isArray(plan) || !ko?.page || !ko?.spread)
    throw new Error("펼침 정리에 펼침 계획과 한글 쪽·펼침면 문장 범위가 필요해요.");
  const slack = units.ko.unitTolerance || COUNT_SLACK,
    widen = ([min, max]) => [min - slack.countBelow, max + slack.countAbove],
    pageBand = widen(rangeOf(ko.page)),
    spreadBand = widen(rangeOf(ko.spread)),
    rows = Array.isArray(entries) ? entries : [],
    reasons = [],
    unplaced = [],
    openingAdjustments = [],
    pages = [];
  const groups = new Map(plan.map((row) => [row.beatIndex, []]));
  rows.forEach((entry, index) => {
    const group = groups.get(entry?.beatIndex);
    if (group) group.push({ entry, index });
    else {
      reasons.push(
        `${index + 1}번째 항목의 비트 ${entry?.beatIndex}는 승인한 비트가 아니에요.`,
      );
      unplaced.push(entry);
    }
  });
  for (const row of plan) {
    const group = groups.get(row.beatIndex);
    if (!group.length) {
      reasons.push(
        `승인한 비트 ${row.beatIndex}(펼침 ${row.openingNo})에 들어간 글이 없어요.`,
      );
      continue;
    }
    const byPageNo =
      group.every((item) => Number.isInteger(item.entry.pageNo)) &&
      new Set(group.map((item) => item.entry.pageNo)).size === group.length;
    let list = (
      byPageNo
        ? group.slice().sort((a, b) => a.entry.pageNo - b.entry.pageNo)
        : group
    ).map((item) => item.entry);
    while (list.length > 2) {
      let best = 0,
        fewest = Infinity;
      for (let k = 0; k + 1 < list.length; k++) {
        const count =
          sentenceCount(list[k].textKo) + sentenceCount(list[k + 1].textKo);
        if (count < fewest) [best, fewest] = [k, count];
      }
      list.splice(best, 2, joinEntries(list[best], list[best + 1]));
      openingAdjustments.push({
        openingNo: row.openingNo,
        action: "joined",
        detail: "extra-entry",
      });
    }
    if (list.length === 2) {
      const empty = list.some(
          (entry) => blank(entry.textKo) || blank(entry.textEn),
        ),
        outside = list.some(
          (entry) => !inBand(sentenceCount(entry.textKo), pageBand),
        ),
        joined = joinEntries(list[0], list[1]);
      if (
        empty ||
        (outside && inBand(sentenceCount(joined.textKo), spreadBand))
      ) {
        list = [{ ...joined, cue: "auto-merged" }];
        openingAdjustments.push({
          openingNo: row.openingNo,
          action: "merged",
          detail: empty ? "empty-language" : "page-out-of-band",
        });
      }
    }
    if (list.length === 1) pages.push(placed(list[0], row, "spread"));
    else
      list.forEach((entry, k) =>
        pages.push(placed(entry, row, k ? "right" : "left")),
      );
  }
  let mixNote = null;
  if (!reasons.length && plan.length >= 6) {
    if (pages.every((page) => page.kind === "page")) {
      const last = plan.at(-1),
        at = pages.findIndex((page) => page.openingNo === last.openingNo),
        merged = {
          ...joinEntries(pages[at], pages[at + 1]),
          cue: "auto-merged",
        };
      pages.splice(at, 2, placed(merged, last, "spread"));
      openingAdjustments.push({
        openingNo: last.openingNo,
        action: "merged",
        detail: "all-pairs",
      });
    } else if (pages.every((page) => page.kind === "spread"))
      mixNote = "all-spreads";
  }
  pages.forEach((page, index) => (page.pageNo = index + 1));
  return {
    pages,
    openingAdjustments,
    mixNote,
    needsRepagination: reasons.length > 0,
    reasons,
    unplaced,
  };
}

/**
 * The opening structure of an entry list (or pagination) for a frozen openings
 * input: O..2O entries numbered 1..n; each opening exactly [spread] or [left,
 * right] in order 1..O; every entry of opening k on approved beat k (or, with no
 * outline, on increasing beats); derived fields consistent; Σ widths = pageCount.
 */
export function validateOpenings(pagination, input = {}, outline) {
  const pages = Array.isArray(pagination) ? pagination : pagination?.pages,
    pageCount = Number(input?.pageCount),
    errors = [];
  if (!OPENING_PAGE_COUNTS.includes(pageCount))
    return { valid: false, errors: [PAGE_COUNT_ERROR], openings: [] };
  if (!Array.isArray(pages))
    return {
      valid: false,
      errors: ["쪽 나누기 항목 목록이 필요해요."],
      openings: [],
    };
  const count = pageCount / 2;
  let plan = null;
  if (Array.isArray(outline?.beats)) {
    if (outline.beats.length === count)
      plan = outline.beats.map((beat) => beat.index);
    else
      errors.push(
        `승인한 줄거리 비트 ${outline.beats.length}개가 펼침 ${count}개와 맞지 않아요.`,
      );
  }
  if (pages.length < count || pages.length > 2 * count)
    errors.push(
      `펼침 ${count}개에는 쪽 항목이 ${count}~${2 * count}개 필요해요. 지금 ${pages.length}개예요.`,
    );
  pages.forEach((page, index) => {
    const sideOk =
      page?.kind === "spread"
        ? page.side === "spread"
        : page?.kind === "page" &&
          (page.side === "left" || page.side === "right");
    if (
      !sideOk ||
      !Number.isInteger(page.openingNo) ||
      page.openingNo < 1 ||
      page.openingNo > count ||
      page.entryId !== `b${page.beatIndex}-${page.side}` ||
      (page.cue != null && !Object.hasOwn(CUES, page.cue)) ||
      page.pageNo !== index + 1
    )
      errors.push(`${index + 1}번째 항목의 펼침 정보가 맞지 않아요.`);
  });
  const openings = openingsOf(pages);
  openings.forEach((opening, k) => {
    const members = opening.indices.map((index) => pages[index]),
      sides = members.map((page) => page?.side).join("+");
    if (opening.openingNo !== k + 1)
      errors.push(`펼침 순서가 맞지 않아요: ${k + 1}번째 자리에 펼침 ${opening.openingNo}이 있어요.`);
    if (sides !== "spread" && sides !== "left+right")
      errors.push(
        `펼침 ${k + 1}은 펼침면 하나이거나 왼쪽·오른쪽 낱쪽 두 개여야 해요.`,
      );
    if (members.some((page) => page?.beatIndex !== opening.beatIndex))
      errors.push(`펼침 ${k + 1}의 쪽들이 서로 다른 비트를 담고 있어요.`);
    else if (plan && plan[k] !== opening.beatIndex)
      errors.push(`펼침 ${k + 1}에는 승인한 비트 ${plan[k]}가 들어가야 해요.`);
    else if (!plan && k > 0 && !(opening.beatIndex > openings[k - 1].beatIndex))
      errors.push(`펼침 ${k + 1}의 비트 순서가 맞지 않아요.`);
  });
  if (openings.length !== count)
    errors.push(`펼침이 ${openings.length}개예요. ${count}개가 필요해요.`);
  const printed = printedPagesOf(pages);
  if (printed !== pageCount)
    errors.push(`인쇄 쪽 수가 ${printed}쪽이에요. ${pageCount}쪽이 필요해요.`);
  return { valid: errors.length === 0, errors: unique(errors), openings };
}

/* ---------- text and rewrites ---------- */

const QUOTE_OPEN = new Set(["“", "‘", "「", "『"]),
  QUOTE_CLOSE = new Set(["”", "’", "」", "』"]),
  SENTENCE_END = /[.!?。！？…]["'”’」』)]*$/u,
  // The next half never starts with a dialogue attribution or a bare connective,
  // nor follows a quotation closed by a comma (“가자,” / “Let’s go,” Yuha says).
  ATTRIBUTION = /^(?:하며|하고|라고)|^(?:며|고)[\p{P}]*$/u,
  QUOTED_COMMA = /[,，]["'”’」』]$/u;
/** inside[i]: position i (between characters i−1 and i) lies inside a quotation. */
function quoteMask(text) {
  const inside = [];
  let depth = 0,
    straight = false;
  for (let i = 0; i <= text.length; i++) {
    inside.push(depth > 0 || straight);
    const char = text[i];
    if (char === '"') straight = !straight;
    else if (QUOTE_OPEN.has(char)) depth++;
    else if (
      QUOTE_CLOSE.has(char) &&
      depth > 0 &&
      // ’ between two letters is an apostrophe (don’t), not a closing quote.
      // (depth > 0 means a quote opened earlier, so text[i - 1] exists.)
      !(
        char === "’" &&
        /\p{L}/u.test(text[i - 1]) &&
        /\p{L}/u.test(text[i + 1] ?? "")
      )
    )
      depth--;
  }
  return inside;
}
/**
 * Splits a spread's text into its left and right half for print, at whitespace and
 * never inside a quotation or before 하며/하고/라고/며/고: the sentence boundary
 * nearest the middle within 30-70% of the (NFC) text, else the nearest allowed
 * whitespace, else no split. left + right is exactly the input (NFD included);
 * stored text never changes.
 */
export function splitSpreadText(text) {
  const source = String(text ?? ""),
    total = source.normalize("NFC").length,
    inside = quoteMask(source),
    candidates = [];
  for (const match of source.matchAll(/\s+/gu)) {
    const at = match.index + match[0].length,
      before = source.slice(0, match.index);
    if (!before.trim() || !source.slice(at).trim()) continue;
    candidates.push({
      at,
      fraction: source.slice(0, at).normalize("NFC").length / total,
      sentenceEnd: SENTENCE_END.test(before),
      allowed:
        !inside[match.index] &&
        !QUOTED_COMMA.test(before) &&
        !ATTRIBUTION.test(source.slice(at).normalize("NFC").split(/\s/u)[0]),
    });
  }
  const nearest = (list) =>
    list.reduce(
      (best, row) =>
        !best || Math.abs(row.fraction - 0.5) < Math.abs(best.fraction - 0.5)
          ? row
          : best,
      null,
    );
  const allowed = candidates.filter((row) => row.allowed),
    pick =
      nearest(
        allowed.filter(
          (row) => row.sentenceEnd && row.fraction >= 0.3 && row.fraction <= 0.7,
        ),
      ) || nearest(allowed);
  return pick
    ? [source.slice(0, pick.at), source.slice(pick.at)]
    : [source, ""];
}
/** `to` with exactly the layout fields of `from` (a rewrite keeps its entry's place). */
export function copyLayoutFields(from, to) {
  const out = { ...to };
  for (const key of LAYOUT_FIELDS)
    if (isObject(from) && Object.hasOwn(from, key)) out[key] = from[key];
    else delete out[key];
  return out;
}
