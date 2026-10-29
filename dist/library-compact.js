/* 책장 크기 정리 (R44, 2026-10-29). The parent: "cloud save does not work" —
 * the save dialog said the library text (pictures and sounds excluded) was
 * over 8MB. Measured on the paid runs Codex committed (QA/r31b–r33): every
 * text stage's usage row was built as {...result.usage, ...result.meta}, and
 * meta carries the stage's paid-response journals (councilCheckpoint,
 * qualityCheckpoint, writerCheckpoint, childGateCheckpoint …), the approved
 * prose and the richness report — 95–297KB per story, copied again into the
 * book (book.textUsage) and the pro draft (draft.usage), so three copies per
 * story. Nothing reads those copies: the usage readers take tokens, requests,
 * cost and model only, and the journals that resume a run live on the job or
 * draft itself. R27 pruned the job's own journals; the copies stayed.
 *
 * compactUsageRow keeps every primitive field, the nested usage object and
 * small objects (≤ 1KB JSON); it drops *Checkpoint keys and large reports.
 * compactStageMeta drops *Checkpoint keys and approvedProse from a stored
 * stage meta (paginationMeta, sceneBriefsMeta: readers use coherence, checks,
 * manualRedistribution). compactLibrary applies both to every book, draft and
 * job, and prunes the journals of finished jobs (the R27 rule), in place and
 * idempotently. Pure module. */
import { pruneTextJournals } from "./finalize-cleanup.js";

export const USAGE_OBJECT_MAX = 1024;
const encoder = new TextEncoder();
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const bytes = (value) => {
  try {
    return encoder.encode(JSON.stringify(value ?? null)).byteLength;
  } catch {
    return Infinity;
  }
};
const isJournal = (key) => /Checkpoint$/u.test(key);

/** One usage row without the paid-response journals and large reports it used to carry. */
export function compactUsageRow(row) {
  if (!object(row)) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || typeof value !== "object") out[key] = value;
    else if (isJournal(key)) continue;
    else if (key === "usage" || bytes(value) <= USAGE_OBJECT_MAX) out[key] = value;
  }
  return out;
}
/** A stored stage meta (paginationMeta, sceneBriefsMeta) without journals and the approved prose copy. */
export function compactStageMeta(meta) {
  if (!object(meta)) return meta;
  const out = {};
  for (const [key, value] of Object.entries(meta)) if (!isJournal(key) && key !== "approvedProse") out[key] = value;
  return out;
}
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function compactCalls(holder, key, count) {
  const usage = holder?.[key];
  if (!object(usage) || !Array.isArray(usage.calls)) return;
  usage.calls = usage.calls.map((row) => {
    const next = compactUsageRow(row);
    if (!sameJSON(next, row)) count.rows++;
    return next;
  });
}
function compactMetaField(holder, key, count) {
  if (!object(holder?.[key])) return;
  const next = compactStageMeta(holder[key]);
  if (!sameJSON(next, holder[key])) {
    holder[key] = next;
    count.metas++;
  }
}
/**
 * Compact the whole library in place: usage rows of books, drafts and jobs
 * (and a job's book), stored stage metas, and the journals of finished jobs
 * that are not running. Returns what changed; a second call changes nothing.
 */
export function compactLibrary(state) {
  const count = { rows: 0, metas: 0, journals: 0 };
  if (!object(state)) return count;
  const story = (record) => {
    if (!object(record)) return;
    compactCalls(record, "usage", count);
    compactCalls(record, "textUsage", count);
    compactMetaField(record, "paginationMeta", count);
    compactMetaField(record, "sceneBriefsMeta", count);
  };
  for (const book of Array.isArray(state.books) ? state.books : []) story(book);
  for (const draft of Object.values(object(state.storyDrafts) ? state.storyDrafts : {})) {
    story(draft);
    story(draft?.pictureBook);
  }
  for (const job of Object.values(object(state.fullAutoJobs) ? state.fullAutoJobs : {})) {
    story(job);
    story(job?.book);
    if (job?.status !== "running") count.journals += pruneTextJournals(job);
  }
  return count;
}
const MB = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
/** The biggest parts of a library's text, for the parent ("만들던 이야기 4.1MB · 책 3.2MB …"). */
export function librarySizeParts(state) {
  const parts = [
    ["책", state?.books],
    ["만들던 이야기", state?.fullAutoJobs],
    ["글 초안", state?.storyDrafts],
    ["등장인물", state?.characters],
    ["배경", state?.backgrounds],
    ["그림 세계", state?.worlds],
    ["설정", state?.settings],
  ]
    .map(([name, value]) => ({ name, bytes: value == null ? 0 : bytes(value) }))
    .filter((row) => row.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  return { total: bytes(state), parts, line: parts.slice(0, 3).map((row) => `${row.name} ${MB(row.bytes)}`).join(" · ") };
}
export const formatMB = MB;
