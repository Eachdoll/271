/* Per-page tools for a built picture book (FULL AUTO or story workflow). State functions only: no DOM.
 * Text edits never buy an image: they mark the page image stale and the caller asks before redrawing. */
import { rewriteStoryPage, alignEnglishText } from "./pipeline.js";
import { hasOrchestrationPolicy } from "./orchestration.js";
import { checkStory } from "./checker.js";
import { checkRichness } from "./richness.js";
import { currentBookPagination } from "./book-coherence.js";
import { syncStoryDraft } from "./ui.js";
import { buildStoryWords } from "../story-reading-context.js";
import {
  layoutOf,
  textEstimateArgs,
  unitImageSize,
  unitKind,
} from "../book-layout.js";
import {
  resolveStoryStageSettings,
  resolveQualityStageSettings,
  resolveBeatWriterSettings,
  estimateStoryTextCost,
  estimateTextCost,
} from "../text-generation/models.js";
import { getTextGenerationSettings } from "../text-generation/settings-ui.js";
import {
  estimateImageCost,
  frozenImageConfig,
} from "../image-generation/models.js";
import { getStylePreset } from "../image-generation/styles.js";
import {
  getActiveWorld,
  getCharacterSheet,
  getWorldBackgroundSnapshot,
} from "../image-generation/world.js";
import { generateScene } from "../image-generation/pipeline.js";
import {
  estimateFullAutoCost,
  fullAutoJobForBook,
  jobImageSnapshot,
  recordFullAutoBookUsage,
  recordFullAutoBookImage,
  isPageImageStale,
  clearPageImageStale,
} from "../full-auto.js";

export { isPageImageStale };

const clone = (value) => (value == null ? value : structuredClone(value)),
  now = () => new Date().toISOString();
/** One page-text rewrite: outline, prose and neighbouring pages in, one page out. */
const PAGE_REWRITE_TOKENS = { input: 9000, output: 1200 };

/** Books with a page operation in flight in this tab; FULL AUTO refuses to run them meanwhile. */
const busyBooks = new Set();
/** True while a page text or image operation on this book is in flight in this tab. */
export function isPageOperationBusy(bookId) {
  return !!bookId && busyBooks.has(bookId);
}
/**
 * Books a FULL AUTO run in this tab has claimed. The runner claims the book
 * synchronously when it starts, before its first await (stop watcher, run
 * lock, credential preflight), while job.status still shows the hold; page
 * tools refuse a claimed book, so no page is bought by both.
 */
const runClaims = new Map();
/** Claim a book for a FULL AUTO run in this tab; pair every call with releaseBookForRun. */
export function claimBookForRun(bookId) {
  if (!bookId) return false;
  runClaims.set(bookId, (runClaims.get(bookId) || 0) + 1);
  return true;
}
/** Release one claimBookForRun; the book is free again once every claim is released. */
export function releaseBookForRun(bookId) {
  const count = runClaims.get(bookId) || 0;
  if (count > 1) runClaims.set(bookId, count - 1);
  else runClaims.delete(bookId);
}
/** True while a FULL AUTO run in this tab has claimed this book. */
export function isBookClaimedForRun(bookId) {
  return !!bookId && runClaims.has(bookId);
}
const RUN_OWNS_MESSAGE =
  "FULL AUTO가 이 책을 만드는 중이에요. 중지하거나 끝난 뒤에 고쳐 주세요.";
/** The Web Lock full-auto-ui holds for the whole of a run, in whichever tab runs it. */
const RUN_LOCK_PREFIX = "donghwa-full-auto-";
/**
 * Another tab may run this book's FULL AUTO job while this tab still shows
 * the hold in memory. Before a paid page tool buys anything, refuse when any
 * tab holds the job's run lock. Returns null (no await) without Web Locks
 * query support or without a job; a failed query does not block the parent.
 */
function runLockCheck(state, book) {
  const locks = globalThis.navigator?.locks,
    id = fullAutoJobForBook(state, book)?.id;
  if (!id || typeof locks?.query !== "function") return null;
  return Promise.resolve()
    .then(() => locks.query())
    .then(
      // A snapshot whose `held` is not an array lists no held locks.
      (snapshot) =>
        (Array.isArray(snapshot?.held) ? snapshot.held : []).some(
          (lock) => lock?.name === RUN_LOCK_PREFIX + id,
        ),
      () => false,
    )
    .then((held) => {
      if (held) throw Error(RUN_OWNS_MESSAGE);
    });
}
/** runLockCheck, then the same-tab check again after the wait. */
async function otherTabRunCheck(state, book) {
  const lockCheck = runLockCheck(state, book);
  if (!lockCheck) return;
  await lockCheck;
  assertNotRunning(state, book);
}
/**
 * One page operation per book at a time: two paid requests on one book could
 * each buy the same coherence review, and a text edit landing during that
 * page's drawing would be lost.
 */
async function exclusive(book, work) {
  const id = book?.id;
  if (isBookClaimedForRun(id)) throw Error(RUN_OWNS_MESSAGE);
  if (id && busyBooks.has(id))
    throw Error(
      "이 책의 다른 쪽 작업이 아직 끝나지 않았어요. 끝난 뒤에 다시 시도해 주세요.",
    );
  if (id) busyBooks.add(id);
  try {
    return await work();
  } finally {
    if (id) busyBooks.delete(id);
  }
}
const runOwnsBook = (state, book) =>
  isBookClaimedForRun(book?.id) ||
  fullAutoJobForBook(state, book)?.status === "running";

function pageIndexOf(book, pageIndex) {
  const index = Number(pageIndex);
  if (
    !Array.isArray(book?.pages) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= book.pages.length
  )
    throw Error("고칠 쪽을 찾지 못했어요.");
  return index;
}
/**
 * Paid or text-changing work must not race a FULL AUTO run that owns the same
 * book: one marked running, or one this tab is starting (claimed, not yet running).
 */
function assertNotRunning(state, book) {
  const job = fullAutoJobForBook(state, book);
  if (job?.status === "running" || isBookClaimedForRun(book?.id))
    throw Error(RUN_OWNS_MESSAGE);
  return job;
}
function textSettingsOf(state, book) {
  return book.textGenerationSettings || getTextGenerationSettings(state);
}
/**
 * Same checker inputs as the picture editor's syncDraft, including the frozen
 * story input, so the advisory catchphrase-repeat warning survives a page edit.
 */
function recheckBook(state, book) {
  if (!book.pagination || !book.outline) return;
  const storyInput =
      book.storyInput || fullAutoJobForBook(state, book)?.input || null,
    input = storyInput || {};
  book.storyCheck = checkStory(book.outline, book.pagination, {
    specs: book.readingLevelSnapshot?.specs || input.specs,
    storyWords: buildStoryWords(book, book.outline),
    allowedNames: (input.characters || [])
      .flatMap((c) => [c.name, c.nameEn])
      .filter(Boolean),
    storyInput,
  });
  if (
    book.sceneBriefs?.length &&
    book.textGenerationSettings?.storyEnrichment !== false
  ) {
    book.richnessCheck = checkRichness(
      book.pagination,
      input,
      book.outline,
      book.sceneBriefs,
    );
    book.pagination.richnessCheck = book.richnessCheck;
  }
}
/** Write one page's text everywhere the book keeps it; returns whether anything changed. */
function writePageText(state, book, index, ko, en) {
  const page = book.pages[index],
    currentKo = page.ko ?? page.textKo ?? "",
    currentEn = page.en ?? page.textEn ?? "";
  if (ko === currentKo && en === currentEn) return false;
  page.ko = ko;
  page.en = en;
  page.textKo = ko;
  page.textEn = en;
  const row = book.pagination?.pages?.[index];
  if (row) {
    row.textKo = ko;
    row.textEn = en;
  }
  book.readingCheck = null;
  delete page.reviewed;
  delete page.reviewedAt;
  if (page.imageAssetId || page.imageUrl) {
    // Bound to this image: a redraw by any path makes the mark obsolete (isPageImageStale).
    page.imageStale = true;
    page.imageStaleAt = now();
    page.imageStaleAssetId = page.imageAssetId || page.imageUrl;
  }
  recheckBook(state, book);
  return true;
}
/**
 * R13: which recorded book costs leave out a model without a catalog price.
 * Pictures say so in their own estimate; text is judged from the book's
 * frozen text settings. The book details then never show such a part as $0.
 */
export function bookPricingUnknown(book = {}) {
  const metas = [
    ...(book.pages || []).flatMap((page) => [
      page?.imageMeta,
      ...(page?.imageHistory || []).map((image) => image?.imageMeta),
    ]),
    book.cover?.meta,
    ...(book.coverHistory || []).map((image) => image?.meta),
  ];
  let text = false;
  try {
    text =
      !book.textDemo &&
      !!book.textGenerationSettings &&
      estimateStoryTextCost({
        settings: book.textGenerationSettings,
        pageCount: book.pages?.length || 12,
      }).pricingUnknown === true;
  } catch {
    text = false;
  }
  return {
    images: metas.some((meta) => meta?.costEstimate?.pricingUnknown === true),
    text,
  };
}
/** '추정 $0.120', '추정 $0.120 · 일부 요금 미확인' or '요금 정보 없음' (R13). */
export function estimatedCostText(usd, unknown) {
  const value = Number(usd) || 0;
  return unknown
    ? value > 0
      ? `추정 $${value.toFixed(3)} · 일부 요금 미확인`
      : "요금 정보 없음"
    : `추정 $${value.toFixed(3)}`;
}
/** Same totals as the book builder, so a page rewrite shows in the book's text cost. */
function refreshTextCosts(book) {
  if (!book.textCosts) return;
  const calls = book.textUsage?.calls || [],
    actual = (c) => c.costUsd ?? c.usage?.costUsd,
    actualAvailable =
      calls.length > 0 && calls.every((c) => Number.isFinite(actual(c)));
  book.textCosts = {
    requestCount: calls.reduce(
      (n, c) => n + (c.demo ? 0 : Number(c.requests) || 1),
      0,
    ),
    estimatedUsd: calls.reduce(
      (n, c) =>
        n + (Number(c.costUsdEstimated ?? c.usage?.costUsdEstimated) || 0),
      0,
    ),
    actualUsd: actualAvailable
      ? calls.reduce((n, c) => n + actual(c), 0)
      : null,
    actualAvailable,
  };
}
function recordTextUsage(state, book, row) {
  ((book.textUsage ||= { calls: [] }).calls ||= []).push(clone(row));
  refreshTextCosts(book);
  recordFullAutoBookUsage(state, book, row);
}
function usageRow(result, extra) {
  const meta = result?.meta || {};
  return {
    ...clone(result?.usage || {}),
    stage: meta.stage || "page",
    engineId: meta.engineId || null,
    model: meta.model || null,
    ...(meta.modelId ? { modelId: meta.modelId } : {}),
    requests: Number(meta.requests) || 1,
    ...extra,
    at: now(),
  };
}
async function saveOnly(save) {
  if (typeof save === "function" && (await save()) === false)
    throw Error("변경을 저장하지 못했어요. 저장 공간을 확인해 주세요.");
}
/** Keep the job's book reference, the story draft and storage in step with the edited book. */
async function commit(state, book, save) {
  // A run that started meanwhile owns job.book and the draft: only store the kept cost rows.
  if (runOwnsBook(state, book)) return saveOnly(save);
  const job = fullAutoJobForBook(state, book);
  if (job) {
    if (job.book?.id === book.id) job.book = book;
    job.updatedAt = now();
  }
  syncStoryDraft(book, state);
  await saveOnly(save);
}

/**
 * Rewrite one page's text with the book's frozen text settings (paid unless demo).
 * Only page i's ko/en/textKo/textEn change; usage is kept on the book and its
 * FULL AUTO job, including a failed paid attempt. A demo book returns
 * {changed:false, demo:true} without a request.
 */
export async function rewriteBookPage(state, book, pageIndex, options = {}) {
  const index = pageIndexOf(book, pageIndex);
  assertNotRunning(state, book);
  if (book.textDemo) return { changed: false, demo: true };
  // The book is busy from the call on, so its page buttons are disabled while
  // the lock query is still pending.
  return exclusive(book, async () => {
    await otherTabRunCheck(state, book);
    return rewritePage(state, book, index, options);
  });
}
async function rewritePage(
  state,
  book,
  index,
  { signal, save, violations, engine, rewrite = rewriteStoryPage },
) {
  if (!book.outline || !book.prose || !book.storyInput)
    throw Error(
      "이 책은 쪽 단위로 글을 다시 만들 수 없어요. 이야기 다듬기에서 직접 고쳐 주세요.",
    );
  const settings = textSettingsOf(state, book),
    stage = resolveStoryStageSettings(settings, "pagination"),
    quality = book.storyInput.storyQuality || settings.storyQuality || {},
    pagination = currentBookPagination(book),
    pageNo = pagination.pages[index].pageNo,
    extra = { action: "rewrite-page", pageNo };
  const options = {
    ...stage,
    ...(engine ? { engine } : {}),
    signal,
    qualityEngines: Object.fromEntries(
      ["outline", "prose", "cheap"].map((role) => [
        role,
        resolveQualityStageSettings(settings, role, quality),
      ]),
    ),
    proseCoherence: book.proseCoherence,
    pageCoherence: book.pageCoherence,
    coherenceOptions: {
      ...resolveStoryStageSettings(settings, "coherenceReview"),
      signal,
    },
    // R26: repairs keep the upper model.
    coherenceRepairOptions: resolveStoryStageSettings(settings, "coherence"),
    // 2026-10-20: a rewrite the reviewer still flags after its repairs keeps
    // the note on the page instead of failing the rewrite.
    acceptUnresolvedCoherence: true,
    sceneBriefs: book.sceneBriefs || undefined,
    bookId: book.id,
    stylePreset:
      book.worldSettingsSnapshot?.stylePreset ||
      getStylePreset(
        book.worldSettingsSnapshot?.stylePresetId || book.stylePresetId,
      ),
    storyEnrichment: settings.storyEnrichment !== false,
    richness: settings.storyEnrichment !== false,
    ...(violations ? { violations: clone(violations) } : {}),
  };
  let result;
  try {
    result = await rewrite(
      pagination,
      pageNo,
      book.outline,
      book.prose,
      book.storyInput,
      options,
    );
  } catch (error) {
    // A paid response that failed validation is still billed: keep its row.
    const row = error?.usage
      ? usageRow(
          { usage: error.usage, meta: error.meta },
          { ...extra, failed: true },
        )
      : error?.name === "StoryValidationError" &&
          ["page", "scene"].includes(error.stage)
        ? {
            input: 0,
            output: 0,
            stage: error.stage,
            engineId: stage.engineId,
            model: stage.config?.model || null,
            requests: 1,
            ...extra,
            failed: true,
            usageUnknown: true,
            at: now(),
          }
        : null;
    if (row) {
      recordTextUsage(state, book, row);
      try {
        await commit(state, book, save);
      } catch {
        /* Report the request failure, not the follow-up save. */
      }
    }
    throw error;
  }
  // A malformed response (pages not an array) is a billed response without a usable page.
  const pages = Array.isArray(result?.data?.pages) ? result.data.pages : [],
    next = pages.find((p) => p?.pageNo === pageNo) || pages[index],
    // Every page carries both languages (validateStoryPage): a blank one would wipe the page.
    usable =
      !!next &&
      typeof next === "object" &&
      ["textKo", "textEn"].every(
        (key) => typeof next[key] === "string" && next[key].trim(),
      ),
    paid = result?.meta?.requests !== 0,
    // A paid response without a usable page is still billed: keep its row, marked failed.
    row = usageRow(result, usable ? extra : { ...extra, failed: true });
  if (paid) recordTextUsage(state, book, row);
  // A FULL AUTO run started while the request was in flight: keep its cost, leave the page as the run sees it.
  if (runOwnsBook(state, book)) {
    try {
      await saveOnly(save);
    } catch {
      /* Report the refusal, not the follow-up save. */
    }
    throw Error(
      "FULL AUTO가 이 책을 만들기 시작해서 다시 쓴 글을 적용하지 않았어요. 사용한 요청 비용은 기록했어요.",
    );
  }
  if (!usable) {
    if (paid)
      try {
        await commit(state, book, save);
      } catch {
        /* Report the missing page, not the follow-up save. */
      }
    throw Error(
      paid
        ? "다시 쓴 쪽을 받지 못했어요. 사용한 요청 비용은 기록했어요."
        : "다시 쓴 쪽을 받지 못했어요.",
    );
  }
  const page = book.pages[index],
    changed = writePageText(state, book, index, next.textKo, next.textEn);
  await commit(state, book, save);
  return {
    changed,
    page,
    usage: row,
    storyCheck: book.storyCheck || null,
    imageStale: !!page.imageStale,
  };
}

/**
 * R30.1 영어 맞추기: the model that rewrites a page's English after a Korean
 * edit — the beat writer's model for a 정성 모드 book, else the quality
 * 'prose' (medium) role.
 */
function alignSelection(state, book) {
  const settings = textSettingsOf(state, book),
    input = book.storyInput || {},
    quality = input.storyQuality || settings.storyQuality || {};
  return hasOrchestrationPolicy(input)
    ? resolveBeatWriterSettings(settings, quality, input.orchestrationPolicy.writerTier)
    : resolveQualityStageSettings(settings, "prose", quality);
}
/** What one 영어 맞추기 costs (one request; a second only when the first misses its length). */
export function estimateAlignEnglish(state, book) {
  try {
    const selection = alignSelection(state, book),
      price = estimateTextCost({ ...selection, input: 4500, output: 900 });
    return { usd: Number(price.costUsd) || 0, ...(price.pricingUnknown ? { pricingUnknown: true } : {}) };
  } catch {
    return { usd: 0 };
  }
}
/** Whether a page offers 영어 맞추기: a real (non-demo) story book with English. */
export function canAlignEnglish(book) {
  return (
    !!book &&
    !book.textDemo &&
    book.language !== "ko" &&
    !!book.outline &&
    !!(book.storyInput?.specs?.en || book.readingLevelSnapshot?.specs?.en)
  );
}
/** The sentence band of one page's English (an openings entry by its kind; a rhythm spec's wide band). */
function pageEnglishRange(book, page, spec) {
  const unit = spec?.units ? spec.units[page?.kind === "spread" ? "spread" : "page"] : null,
    base = unit || spec?.sentencesPerPageRange || { min: 1, max: 3 },
    target = unit?.target ?? Math.round((base.min + base.max) / 2),
    wide = spec?.rhythm?.version === 1;
  return {
    min: wide ? Math.max(1, Math.floor(base.min * (spec.rhythm.pageMinShare ?? 1 / 3))) : base.min,
    max: wide ? Math.max(base.max, Math.ceil(base.max * (spec.rhythm.pageMaxFactor ?? 1.6))) : base.max,
    target,
  };
}
/**
 * Ask for one page's English matched to its (edited) Korean, without
 * writing anything. `previousKo`/`previousEn` are the page before the edit.
 * Returns {en, warnings, row} (row: the usage row to record), or throws with
 * the billed usage on error.usage.
 */
export async function requestPageEnglish(
  state,
  book,
  pageIndex,
  { signal, previousKo, previousEn, engine, align = alignEnglishText } = {},
) {
  const index = pageIndexOf(book, pageIndex);
  if (!canAlignEnglish(book))
    throw Error("이 책은 영어 맞추기를 할 수 없어요. 영어 칸을 직접 고쳐 주세요.");
  const page = book.pages[index],
    input = book.storyInput || fullAutoJobForBook(state, book)?.input || {},
    specs = book.readingLevelSnapshot?.specs || input.specs || {},
    job = fullAutoJobForBook(state, book),
    text = (row, lang) => (row ? (row[lang] ?? row[lang === "ko" ? "textKo" : "textEn"] ?? "") : ""),
    beatIndex = page.beatIndex ?? page.scene?.beatIndex,
    brief = (book.sceneBriefs || []).find((row) => Number(row?.beatIndex) === Number(beatIndex));
  const selection = alignSelection(state, book),
    extra = { action: "align-english", pageNo: page.pageNo ?? index + 1 };
  let result;
  try {
    result = await align(
      {
        ko: text(page, "ko"),
        previousKo: previousKo ?? "",
        previousEn: previousEn ?? text(page, "en"),
        before: book.pages.slice(Math.max(0, index - 2), index).map((row) => text(row, "en")),
        after: book.pages.slice(index + 1, index + 2).map((row) => text(row, "en")),
        beatIndex,
        brief,
        range: pageEnglishRange(book, page, specs.en),
        refrainEn: job?.writerReport?.refrain?.voiceCard?.en || book.writerReport?.refrain?.voiceCard?.en || "",
      },
      book.outline,
      { ...input, specs: { ...(input.specs || {}), ...specs } },
      { ...selection, ...(engine ? { engine } : {}), signal },
    );
  } catch (error) {
    if (error?.usage) error.usageRow = usageRow({ usage: error.usage, meta: error.meta }, { ...extra, failed: true });
    throw error;
  }
  return {
    en: result.data.en,
    warnings: result.meta?.warnings || [],
    row: usageRow(result, extra),
  };
}
/** Record a paid text row on a book (the pro editor's own 영어 맞추기). */
export function recordPageTextUsage(state, book, row) {
  if (row) recordTextUsage(state, book, row);
}
/**
 * R30.1: rewrite page i's English to match its Korean and save it (the
 * Korean is untouched). Same locks and bookkeeping as a page rewrite: the
 * cost is recorded even when the answer cannot be used, and the picture is
 * only marked stale (the caller asks before redrawing).
 */
export async function alignPageEnglish(state, book, pageIndex, options = {}) {
  const index = pageIndexOf(book, pageIndex);
  assertNotRunning(state, book);
  return exclusive(book, async () => {
    await otherTabRunCheck(state, book);
    let answer;
    try {
      answer = await requestPageEnglish(state, book, index, options);
    } catch (error) {
      if (error?.usageRow) {
        recordTextUsage(state, book, error.usageRow);
        try {
          await commit(state, book, options.save);
        } catch {
          /* Report the request failure, not the follow-up save. */
        }
      }
      throw error;
    }
    recordTextUsage(state, book, answer.row);
    if (runOwnsBook(state, book)) {
      try {
        await saveOnly(options.save);
      } catch {
        /* Report the refusal, not the follow-up save. */
      }
      throw Error(
        "FULL AUTO가 이 책을 만들기 시작해서 맞춘 영어를 적용하지 않았어요. 사용한 요청 비용은 기록했어요.",
      );
    }
    const page = book.pages[index],
      ko = page.ko ?? page.textKo ?? "",
      changed = writePageText(state, book, index, ko, answer.en);
    await commit(state, book, options.save);
    return {
      changed,
      page,
      en: answer.en,
      warnings: answer.warnings,
      usage: answer.row,
      storyCheck: book.storyCheck || null,
      imageStale: !!page.imageStale,
    };
  });
}

/** Apply the parent's own text for one page: same bookkeeping as a rewrite, no request. */
export async function applyPageText(
  state,
  book,
  pageIndex,
  { ko, en, save } = {},
) {
  const index = pageIndexOf(book, pageIndex);
  assertNotRunning(state, book);
  return exclusive(book, async () => {
    const page = book.pages[index],
      changed = writePageText(
        state,
        book,
        index,
        ko === undefined ? (page.ko ?? page.textKo ?? "") : String(ko),
        en === undefined ? (page.en ?? page.textEn ?? "") : String(en),
      );
    if (changed) await commit(state, book, save);
    return {
      changed,
      page,
      storyCheck: book.storyCheck || null,
      imageStale: !!page.imageStale,
    };
  });
}

/** The parent's per-page "좋아요" mark; cleared again whenever the page text changes. */
export async function setPageReviewed(
  state,
  book,
  pageIndex,
  reviewed,
  { save } = {},
) {
  const page = book.pages[pageIndexOf(book, pageIndex)];
  page.reviewed = reviewed === true;
  if (page.reviewed) page.reviewedAt = now();
  else delete page.reviewedAt;
  await commit(state, book, save);
  return page;
}

/**
 * Page indexes without a current final image (missing, draft quality or stale
 * after a text edit). A stale mark left on an image that was redrawn since is
 * dropped, so that page is not counted or bought again.
 */
export function pagesNeedingImages(book) {
  return (book?.pages || []).flatMap((page, index) =>
    !page?.imageAssetId ||
    page.imageMeta?.quality !== "final" ||
    isPageImageStale(page)
      ? [index]
      : [],
  );
}

const isBook = (value) =>
  Array.isArray(value?.pages) && !!(value.storyInput || value.pagination);
function missingSheetCount(state, book) {
  const world = getActiveWorld(state),
    characters = (book.characterIds || []).filter(
      (id) => !getCharacterSheet(state, id, world),
    ).length,
    backgrounds =
      world.imageEngine === "sample"
        ? 0
        : (book.backgroundIds || [])
            .map((id) => state.backgrounds?.find((b) => b.id === id))
            .filter(Boolean)
            .filter((b) => {
              const sheet = getWorldBackgroundSnapshot(state, b);
              return !sheet.imageAssetId && !sheet.imageUrl;
            }).length;
  return characters + backgrounds;
}
/**
 * Reference costs for the simple flow, in USD.
 * Wizard: {textUsd (all text), imageUnitUsd, imagesUsd (pages + cover), sheetsUpperUsd}
 * from estimateFullAutoCost; options {planMode, demo, imageEngine} pass through.
 * Book: textUsd is a whole-story regeneration with the book's frozen settings,
 * imagesUsd covers only pages still needing an image plus a missing cover,
 * sheetsUpperUsd is 0 once the generation snapshot exists.
 * Both add pageTextUsd (one page rewrite) and imagesNeeded.
 */
export function estimateSimpleCosts(state, wizardOrBook = {}, options = {}) {
  if (isBook(wizardOrBook)) {
    const book = wizardOrBook,
      world = getActiveWorld(state),
      engine =
        book.generationSnapshot?.imageEngine ||
        book.imageEngine ||
        world.imageEngine,
      // R13: a book prices its frozen model; a held FULL AUTO book without a
      // snapshot yet prices the model frozen on its job.
      job = book.generationSnapshot ? null : fullAutoJobForBook(state, book),
      imageConfig = frozenImageConfig(
        world.providerConfig?.[engine],
        book.generationSnapshot ||
          (job && job.imageEngine === engine
            ? jobImageSnapshot(job)
            : undefined),
      ),
      image = estimateImageCost({
        engine,
        quality: "final",
        size: "1536x1024",
        config: imageConfig,
      }),
      unit = image.costUsd,
      imagesNeeded =
        pagesNeedingImages(book).length + (book.cover?.imageAssetId ? 0 : 1),
      settings = textSettingsOf(state, book),
      // R12 openings: the exact price, Σ unit(kind) over the missing entries + cover.
      // R13: every size prices the same frozen model (imageConfig).
      openings = layoutOf(book) === "openings",
      imagesUsd = openings
        ? pagesNeedingImages(book).reduce(
            (sum, index) =>
              sum +
              estimateImageCost({
                engine,
                quality: "final",
                size: unitImageSize(book, book.pages[index]),
                config: imageConfig,
              }).costUsd,
            book.cover?.imageAssetId ? 0 : unit,
          )
        : imagesNeeded * unit,
      story = book.textDemo
        ? null
        : estimateStoryTextCost({
            settings,
            pageCount: book.pages.length,
            // R12: an openings book is sized from its frozen specs and printed pages.
            ...textEstimateArgs(book),
          }),
      page = book.textDemo
        ? null
        : pageRewrite(
            settings,
            // R12 openings: the kind of the page being rewritten (a spread by default).
            openings
              ? unitKind(book.pages[options.pageIndex]) === "page" &&
                Number.isInteger(options.pageIndex)
                ? "page"
                : "spread"
              : undefined,
          );
    return {
      textUsd: story ? story.costUsd : 0,
      pageTextUsd: page ? page.costUsd : 0,
      imageUnitUsd: unit,
      ...(openings
        ? {
            spreadUnitUsd: estimateImageCost({
              engine,
              quality: "final",
              size: unitImageSize(book, { kind: "spread" }),
              config: imageConfig,
            }).costUsd,
          }
        : {}),
      imagesUsd,
      imagesNeeded,
      sheetsUpperUsd: book.generationSnapshot
        ? 0
        : missingSheetCount(state, book) * unit,
      imageEngine: engine,
      pageCount: book.pages.length,
      ...pricingFlags({
        text: story?.pricingUnknown,
        pageText: page?.pricingUnknown,
        image: image.pricingUnknown,
      }),
      // Unpriced pictures are still paid: callers confirm by count, not by $0.
      ...(image.pricingUnknown
        ? {
            sheetsNeeded: book.generationSnapshot
              ? 0
              : missingSheetCount(state, book),
          }
        : {}),
    };
  }
  const estimate = estimateFullAutoCost(state, wizardOrBook, options),
    page =
      options.demo === true
        ? null
        : pageRewrite(getTextGenerationSettings(state));
  return {
    textUsd: estimate.textUsd,
    pageTextUsd: page ? page.costUsd : 0,
    imageUnitUsd: estimate.imageUnitUsd,
    imagesUsd: estimate.imagesUsd,
    imagesNeeded: estimate.pageCount + 1,
    // R12 openings: before the text exists the pictures are a range, and the
    // automatic text repairs have a typical count and a hard cap (2 × openings).
    ...(estimate.imageCountMax
      ? {
          imagesNeeded: estimate.imageCountMax + 1,
          imagesMinUsd: estimate.imagesMinUsd,
          imageCountMin: estimate.imageCountMin,
          imageCountMax: estimate.imageCountMax,
          repairs: estimate.repairs,
        }
      : {}),
    sheetsUpperUsd: estimate.sheetsUpperUsd,
    imageEngine: estimate.imageEngine,
    pageCount: estimate.pageCount,
    ...pricingFlags({
      text: estimate.textPricingUnknown,
      pageText: page?.pricingUnknown,
      image: estimate.imagePricingUnknown,
    }),
  };
}
/** R13: name only the parts whose model has no catalog price (legacy estimates are unchanged). */
function pricingFlags({ text, pageText, image }) {
  return {
    ...(text ? { textPricingUnknown: true } : {}),
    ...(pageText ? { pageTextPricingUnknown: true } : {}),
    ...(image ? { imagePricingUnknown: true } : {}),
  };
}
/**
 * R12 openings: a rewrite is sized per entry kind (a spread outputs about 1.9k
 * tokens, a single page about 0.9k); page books keep PAGE_REWRITE_TOKENS.
 */
const OPENING_REWRITE_OUTPUT = { spread: 1900, page: 900 };
function pageRewrite(settings, kind) {
  const stage = resolveStoryStageSettings(settings, "pagination");
  return estimateTextCost({
    ...stage,
    ...PAGE_REWRITE_TOKENS,
    ...(kind ? { output: OPENING_REWRITE_OUTPUT[kind] } : {}),
    model: stage.config.model,
  });
}

/**
 * Draw (or redraw) one page at final quality from the book's frozen snapshot.
 * Requires book.generationSnapshot: a text-review job must be released to
 * 'pages' first so the sheets exist. A paid image saved before an abort or
 * error is kept, recorded on the job and saved; the stale mark is cleared.
 */
export async function generateBookPageImage(
  state,
  book,
  pageIndex,
  {
    signal,
    changeComposition = false,
    onProgress,
    save,
    generate = generateScene,
  } = {},
) {
  const index = pageIndexOf(book, pageIndex);
  assertNotRunning(state, book);
  if (!book.generationSnapshot)
    throw Error(
      "그림 설정이 아직 준비되지 않았어요. 자동 작업을 '그림 준비' 단계(pages)까지 이어서 캐릭터·배경 시트를 먼저 준비해 주세요.",
    );
  return exclusive(book, async () => {
    await otherTabRunCheck(state, book);
    const before = book.pages[index].imageAssetId,
      reviewsBefore = book.textUsage?.calls?.length || 0;
    let failure = null;
    try {
      await generate(state, book, index, {
        quality: "final",
        signal,
        changeComposition,
        onProgress,
      });
    } catch (error) {
      failure = error;
    }
    // Bookkeeping for a paid image always happens, even if a FULL AUTO run started
    // meanwhile: a lost record or a stale mark left on it would buy the page again.
    const page = book.pages[index];
    // Success, or a paid image that was saved before an abort or error.
    if (page?.imageAssetId && (!failure || page.imageAssetId !== before)) {
      clearPageImageStale(page);
      recordFullAutoBookImage(state, book, page);
    }
    // A text edit makes generateScene buy a coherence review first; keep it on the job too.
    for (const row of (book.textUsage?.calls || []).slice(reviewsBefore))
      recordFullAutoBookUsage(state, book, row);
    try {
      await commit(state, book, save);
    } catch (saveError) {
      if (!failure) throw saveError;
    }
    if (failure) throw failure;
    return page;
  });
}
