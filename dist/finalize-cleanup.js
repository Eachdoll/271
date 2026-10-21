import { isSpilledLibrary } from "./library-storage.js";
const clone = (value) => (value == null ? value : structuredClone(value));

/** Keep only the small resume/revision header after the authoritative book is saved. */
export function finalizeBookRecords(state, book) {
  const draft = state.storyDrafts?.[book.storyDraftId];
  if (draft)
    state.storyDrafts[book.storyDraftId] = {
      id: draft.id,
      bookId: book.id,
      stage: "final",
      input: clone(draft.input),
      wizard: clone(draft.wizard),
      usage: clone(draft.usage),
      updatedAt: new Date().toISOString(),
    };
  const auto = state.fullAutoJobs?.[book.fullAutoRunId];
  if (auto) {
    book.fullAutoUsage = clone(auto.usage || {});
    book.fullAutoCosts = clone(auto.costs || {});
    delete state.fullAutoJobs[book.fullAutoRunId];
  }
}
/*
 * R27: the paid-call journals a FULL AUTO job keeps so a resumed run never
 * buys a call twice. Once the book is built (the text steps are all done),
 * nothing replays them, so they are dropped; the meeting's record stays on
 * outline.council. A job without a book, or whose text is unfinished (a
 * hold, a stop), keeps every journal.
 */
export const TEXT_JOURNALS = Object.freeze([
  "qualityCheckpoint",
  "councilCheckpoint",
  "writerCheckpoint",
  "enrichmentCheckpoint",
  "revisionCheckpoint",
  "childGateCheckpoint",
]);
export function pruneTextJournals(job) {
  if (!job?.book || !job.completed?.pagination) return 0;
  let pruned = 0;
  for (const key of TEXT_JOURNALS)
    if (key in job) {
      delete job[key];
      pruned++;
    }
  return pruned;
}
export function cleanupOldWorkRecords(state) {
  let cleaned = 0;
  for (const job of Object.values(state.fullAutoJobs || {}))
    if (job?.status !== "running" && pruneTextJournals(job)) cleaned++;
  for (const book of state.books || []) {
    if (book.approved === false || (book.stage && book.stage !== "final"))
      continue;
    if (
      state.storyDrafts?.[book.storyDraftId]?.pictureBook ||
      state.fullAutoJobs?.[book.fullAutoRunId]
    ) {
      finalizeBookRecords(state, book);
      cleaned++;
    }
  }
  return cleaned;
}
export function estimateLibraryStorage(storage, key, state = {}) {
  const raw = storage.getItem(key);
  // R27: a pointer to the big store is tiny; size the library itself.
  return (raw == null || isSpilledLibrary(raw) ? JSON.stringify(state) : raw).length * 2;
}
