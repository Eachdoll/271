import { isCoherenceCurrent } from "./coherence.js";
import { reviewStoryCoherence } from "./pipeline.js";
import { getTextGenerationSettings } from "../text-generation/settings-ui.js";
import { resolveStoryStageSettings } from "../text-generation/models.js";

export function currentBookPagination(book) {
  return {
    ...book.pagination,
    pages: (book.pages || book.pagination?.pages || []).map((page, index) => ({
      ...book.pagination?.pages?.[index],
      ...page,
      pageNo: page.pageNo || index + 1,
      beatIndex: page.beatIndex ?? page.scene?.beatIndex,
      textKo: page.ko ?? page.textKo,
      textEn: page.en ?? page.textEn,
    })),
  };
}
/** Reuse a current review; parent text edits require review before a paid image. */
export async function ensureBookStoryCoherence(
  state,
  book,
  { signal, onProgress, review = reviewStoryCoherence } = {},
) {
  if (!book.outline?.plotContract || book.textDemo) return;
  const pagination = currentBookPagination(book);
  if (
    isCoherenceCurrent(book.pageCoherence, {
      outline: book.outline,
      prose: book.prose,
      pagination,
      stage: "pages",
    })
  )
    return;
  const settings =
      book.textGenerationSettings || getTextGenerationSettings(state),
    selection = resolveStoryStageSettings(settings, "coherence");
  const record = (result) => {
    if (result?.usage && result.meta?.requests !== 0) {
      book.textUsage ||= { calls: [] };
      book.textUsage.calls ||= [];
      book.textUsage.calls.push({
        ...result.usage,
        ...result.meta,
        at: new Date().toISOString(),
      });
    }
  };
  try {
    const result = await review(
      book.outline,
      book.prose,
      pagination,
      book.storyInput,
      {
        ...selection,
        signal,
        repair: false,
        pageCoherence: book.pageCoherence,
        onProgress: (progress) =>
          onProgress?.({ status: "story-review", message: progress.message }),
      },
    );
    record(result);
    book.pageCoherence = result.meta.coherence;
    if (
      !isCoherenceCurrent(book.pageCoherence, {
        outline: book.outline,
        prose: book.prose,
        pagination,
        stage: "pages",
      })
    )
      throw Error(
        "이야기 일관성 검사를 완료하지 못했어요. 이야기 글을 다시 검토해 주세요.",
      );
  } catch (error) {
    if (error.coherence) book.pageCoherence = error.coherence;
    if (error.usage) record({ usage: error.usage, meta: error.meta });
    throw error;
  }
}
