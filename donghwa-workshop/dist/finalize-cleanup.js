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
export function cleanupOldWorkRecords(state) {
  let cleaned = 0;
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
export function estimateLibraryStorage(storage, key) {
  return (storage.getItem(key)?.length || 0) * 2;
}
