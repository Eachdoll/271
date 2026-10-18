/* Per-page tools for a built picture book (FULL AUTO or story workflow). State functions only: no DOM.
 * Text edits never buy an image: they mark the page image stale and the caller asks before redrawing. */
import { rewriteStoryPage } from "./pipeline.js";
import { checkStory } from "./checker.js";
import { checkRichness } from "./richness.js";
import { currentBookPagination } from "./book-coherence.js";
import { syncStoryDraft } from "./ui.js";
import { buildStoryWords } from "../story-reading-context.js";
import {
  resolveStoryStageSettings,
  resolveQualityStageSettings,
  estimateStoryTextCost,
  estimateTextCost,
} from "../text-generation/models.js";
import { getTextGenerationSettings } from "../text-generation/settings-ui.js";
import { estimateImageCost } from "../image-generation/models.js";
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
  recordFullAutoBookUsage,
  recordFullAutoBookImage,
} from "../full-auto.js";

const clone = (value) => (value == null ? value : structuredClone(value)),
  now = () => new Date().toISOString();
/** One page-text rewrite: outline, prose and neighbouring pages in, one page out. */
const PAGE_REWRITE_TOKENS = { input: 9000, output: 1200 };

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
/** Paid or text-changing work must not race a FULL AUTO run that owns the same book. */
function assertNotRunning(state, book) {
  const job = fullAutoJobForBook(state, book);
  if (job?.status === "running")
    throw Error(
      "FULL AUTO가 이 책을 만드는 중이에요. 중지하거나 끝난 뒤에 고쳐 주세요.",
    );
  return job;
}
function textSettingsOf(state, book) {
  return book.textGenerationSettings || getTextGenerationSettings(state);
}
/** Same checker inputs as the picture editor's syncDraft. */
function recheckBook(book) {
  if (!book.pagination || !book.outline) return;
  const input = book.storyInput || {};
  book.storyCheck = checkStory(book.outline, book.pagination, {
    specs: book.readingLevelSnapshot?.specs || input.specs,
    storyWords: buildStoryWords(book, book.outline),
    allowedNames: (input.characters || [])
      .flatMap((c) => [c.name, c.nameEn])
      .filter(Boolean),
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
function writePageText(book, index, ko, en) {
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
    page.imageStale = true;
    page.imageStaleAt = now();
  }
  recheckBook(book);
  return true;
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
/** Keep the job's book reference, the story draft and storage in step with the edited book. */
async function commit(state, book, save) {
  const job = fullAutoJobForBook(state, book);
  if (job) {
    if (job.book?.id === book.id) job.book = book;
    job.updatedAt = now();
  }
  syncStoryDraft(book, state);
  if (typeof save === "function" && (await save()) === false)
    throw Error("변경을 저장하지 못했어요. 저장 공간을 확인해 주세요.");
}

/**
 * Rewrite one page's text with the book's frozen text settings (paid unless demo).
 * Only page i's ko/en/textKo/textEn change; usage is kept on the book and its
 * FULL AUTO job, including a failed paid attempt. A demo book returns
 * {changed:false, demo:true} without a request.
 */
export async function rewriteBookPage(
  state,
  book,
  pageIndex,
  { signal, save, violations, engine, rewrite = rewriteStoryPage } = {},
) {
  const index = pageIndexOf(book, pageIndex);
  assertNotRunning(state, book);
  if (book.textDemo) return { changed: false, demo: true };
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
      ...resolveStoryStageSettings(settings, "coherence"),
      signal,
    },
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
  const row = usageRow(result, extra);
  if (result?.meta?.requests !== 0) recordTextUsage(state, book, row);
  const next =
    result?.data?.pages?.find((p) => p.pageNo === pageNo) ||
    result?.data?.pages?.[index];
  if (!next) throw Error("다시 쓴 쪽을 받지 못했어요.");
  const page = book.pages[index],
    changed = writePageText(
      book,
      index,
      String(next.textKo ?? page.ko ?? ""),
      String(next.textEn ?? page.en ?? ""),
    );
  await commit(state, book, save);
  return {
    changed,
    page,
    usage: row,
    storyCheck: book.storyCheck || null,
    imageStale: !!page.imageStale,
  };
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
  const page = book.pages[index],
    changed = writePageText(
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

/** Page indexes without a current final image (missing, draft quality or stale after a text edit). */
export function pagesNeedingImages(book) {
  return (book?.pages || []).flatMap((page, index) =>
    !page?.imageAssetId ||
    page.imageMeta?.quality !== "final" ||
    page.imageStale
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
      unit = estimateImageCost({
        engine,
        quality: "final",
        size: "1536x1024",
        config: {
          ...world.providerConfig?.[engine],
          ...book.generationSnapshot?.imageModelConfig,
        },
      }).costUsd,
      imagesNeeded =
        pagesNeedingImages(book).length + (book.cover?.imageAssetId ? 0 : 1),
      settings = textSettingsOf(state, book);
    return {
      textUsd: book.textDemo
        ? 0
        : estimateStoryTextCost({ settings, pageCount: book.pages.length })
            .costUsd,
      pageTextUsd: book.textDemo ? 0 : pageRewriteUsd(settings),
      imageUnitUsd: unit,
      imagesUsd: imagesNeeded * unit,
      imagesNeeded,
      sheetsUpperUsd: book.generationSnapshot
        ? 0
        : missingSheetCount(state, book) * unit,
      imageEngine: engine,
      pageCount: book.pages.length,
    };
  }
  const estimate = estimateFullAutoCost(state, wizardOrBook, options);
  return {
    textUsd: estimate.textUsd,
    pageTextUsd:
      options.demo === true
        ? 0
        : pageRewriteUsd(getTextGenerationSettings(state)),
    imageUnitUsd: estimate.imageUnitUsd,
    imagesUsd: estimate.imagesUsd,
    imagesNeeded: estimate.pageCount + 1,
    sheetsUpperUsd: estimate.sheetsUpperUsd,
    imageEngine: estimate.imageEngine,
    pageCount: estimate.pageCount,
  };
}
function pageRewriteUsd(settings) {
  const stage = resolveStoryStageSettings(settings, "pagination");
  return estimateTextCost({
    ...stage,
    ...PAGE_REWRITE_TOKENS,
    model: stage.config.model,
  }).costUsd;
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
  const page = book.pages[index];
  // Success, or a paid image that was saved before an abort or error.
  if (page?.imageAssetId && (!failure || page.imageAssetId !== before)) {
    delete page.imageStale;
    delete page.imageStaleAt;
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
}
