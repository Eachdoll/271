import {
  requestAutoStop,
  readAutoStop,
  createAutoStopWatcher,
} from "./full-auto-control.js";
import {
  autoJobs,
  createFullAutoJob,
  estimateFullAutoCost,
  runFullAuto,
  FULL_AUTO_STOPS,
} from "./full-auto.js";
import {
  isPageOperationBusy,
  isPageImageStale,
  pagesNeedingImages,
  claimBookForRun,
  releaseBookForRun,
} from "./story-generation/page-tools.js";
/** Jobs parked by a hold: nothing is running and nothing is bought until a caller releases them. */
const HOLD_LABELS = {
  "text-review": "글 검수 대기",
  "pages-ready": "그림 준비 완료",
};
const isHeld = (job) => Object.hasOwn(HOLD_LABELS, job?.status);
const PAGE_BUSY_MESSAGE =
  "이 책의 쪽 글·그림 작업이 진행 중이에요. 끝난 뒤에 이어 만들어 주세요.";
/** A page tool is rewriting or drawing this job's book in this tab. */
const pageWorkBusy = (job) =>
  isPageOperationBusy(job?.bookId) || isPageOperationBusy(job?.book?.id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const button = (label, action, id, kind = "outline") =>
  `<button type="button" class="btn btn-${kind}" data-full-auto-action="${action}" ${id ? `data-id="${esc(id)}"` : ""}>${label}</button>`;
let api,
  controller = null,
  currentJob = null,
  inspectedId = null,
  configured = false;
export const isFullAutoRunning = () => !!controller;

/* ---------- pictures kept after a text edit ---------- */
/*
 * Keeping a picture after its text changed is the parent's lasting decision.
 * The runner-visible stale mark (imageStale, imageStaleAt, imageStaleAssetId)
 * would let any later run (the library card's 이어서 만들기, a resume, the pro
 * editor) buy that page again without asking, so a kept page carries the
 * simple screen's marker instead (simpleTextEditedAssetId), bound to the
 * picture it was kept with. Only a run the parent chose to redraw named pages
 * puts the real mark back, for those pages and only for that run.
 */
/**
 * The parent keeps these pictures (all pages when `indexes` is null): the
 * runner-visible stale marks become the kept-picture marker. Returns how many
 * pages changed, so the caller saves only when something did.
 */
export function keepEditedPictures(book, indexes = null) {
  let changed = 0;
  (book?.pages || []).forEach((page, index) => {
    if (indexes && !indexes.includes(index)) return;
    if (!isPageImageStale(page)) return;
    page.simpleTextEditedAssetId = page.imageStaleAssetId;
    if (page.imageStaleAt !== undefined)
      page.simpleTextEditedAt = page.imageStaleAt;
    delete page.imageStale;
    delete page.imageStaleAt;
    delete page.imageStaleAssetId;
    changed++;
  });
  return changed;
}
/** Every page index of `book` except the ones a run was asked to redraw. */
const pagesExcept = (book, redraw = []) =>
  (book?.pages || []).map((_, i) => i).filter((i) => !redraw.includes(i));
/**
 * Where a run would end without buying anything, as [status, phase], or null
 * when only a run can get there: the hold it heads for is already reached
 * (text built for 'text', drawing setup frozen for 'pages'), or, with no
 * hold, every page has a current final picture and the cover exists.
 */
function endWithoutBuying(job) {
  const book = job?.book,
    hold = job?.stopBefore ?? null;
  if (!book) return null;
  if (hold === "text") return ["text-review", "글 완성 · 쪽 검수"];
  if (hold === "pages")
    return book.generationSnapshot ? ["pages-ready", "그림 준비 완료"] : null;
  if (
    hold === null &&
    book.generationSnapshot &&
    book.cover?.imageAssetId &&
    !pagesNeedingImages(book).length
  )
    return ["review", "완성 초안 · 부모 검토"];
  return null;
}
/**
 * Record that end here, the way the runner's own last step does, without the
 * runner: it would first ask for engine keys and check the World, which an
 * end that buys nothing does not need. Rolled back when the save fails.
 * Returns true when recorded.
 */
function settleWithoutRun(job, [status, phase]) {
  const book = job.book,
    draft = api.getState()?.storyDrafts?.[job.storyDraftId],
    finish = status === "review",
    before = {
      stage: book.stage,
      approved: book.approved,
      autoGenerationComplete: book.autoGenerationComplete,
      job: {
        status: job.status,
        phase: job.phase,
        currentStep: job.currentStep,
        error: job.error,
        updatedAt: job.updatedAt,
      },
      draftStage: draft?.stage,
    };
  if (finish) {
    book.stage = "illustrated";
    book.approved = false;
    book.autoGenerationComplete = true;
    if (draft) draft.stage = "illustrated";
  }
  Object.assign(job, {
    status,
    phase,
    currentStep: null,
    error: null,
    updatedAt: new Date().toISOString(),
  });
  if (api.save() !== false) return true;
  if (finish) {
    book.stage = before.stage;
    book.approved = before.approved;
    if (before.autoGenerationComplete === undefined)
      delete book.autoGenerationComplete;
    else book.autoGenerationComplete = before.autoGenerationComplete;
    if (draft) draft.stage = before.draftStage;
  }
  Object.assign(job, before.job);
  return false;
}
export function cleanupFullAuto(hide = false) {
  if (hide === true) {
    inspectedId = null;
    return;
  }
  controller?.abort();
}
export function renderFullAutoLauncher(state, wizard) {
  const estimate = estimateFullAutoCost(state, wizard);
  return `<section class="full-auto-launcher" aria-label="FULL AUTO MODE"><div><span class="role-tag">FULL AUTO MODE</span><h3>주제만 적고, 한 권을 한 번에</h3><p>고른 친구를 주인공으로 유지해요. 필요한 친구·장소는 서랍에서 고르고, 부족하면 새 시트부터 본문 그림과 표지까지 자동으로 만들어요.</p></div><label class="audio-cache-check"><input id="full-auto-allow-new" type="checkbox" checked> 부족한 재료 자동 추가 · 새 조연 최대 2명, 새 배경 최대 3곳</label><p class="small-label">${estimate.pageCount}쪽 · 부모 설정의 글·그림 엔진과 읽기 수준 사용<br>API 예상 약 $${estimate.baseUsd.toFixed(2)} · 새 시트 포함 약 $${estimate.withMaterialsAndRetryUsd.toFixed(2)}<br>참고 단가 추정이며 실제 한도가 아닙니다. 글 자동 수정·입력 참조 비용 별도.${estimate.imageEngine === "sample" ? "<br>현재 그림 엔진은 무료 고정 샘플입니다. AI 그림은 부모 설정에서 엔진을 변경해 주세요." : ""}</p><p class="small-label">완료 후 전체 초안을 검토해 책장에 저장해요. 제작 중에도 책장을 둘러볼 수 있어요. 브라우저를 완전히 종료하면 완료한 결과를 보관하고 다음 접속에서 이어 만들어요.</p><div class="story-start-actions"><button type="button" class="btn btn-green" data-action="wizard-next">줄거리부터 함께 만들기</button>${button("FULL AUTO로 한 번에", "start", null, "outline")}</div></section>`;
}
export function renderFullAutoJobs(state) {
  const jobs = Object.values(state.fullAutoJobs || {})
    .filter((j) => j?.id && j.status !== "final")
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!jobs.length) return "";
  return `<section class="panel full-auto-jobs" id="full-auto-jobs"><h3>제작 중인 이야기</h3><div class="story-drafts">${jobs
    .map((job) => {
      const live = currentJob?.id === job.id && !!controller,
        held = isHeld(job) && !live,
        pending = readAutoStop(job.id),
        requested =
          pending?.nonce &&
          pending.nonce !== job.stopBaselineNonce &&
          job.status !== "paused";
      return `<article class="story-draft-card" data-auto-job="${esc(job.id)}"><span class="role-tag">FULL AUTO · ${job.status === "review" ? "완성 초안" : held ? HOLD_LABELS[job.status] : requested ? "중지 요청됨" : live ? "제작 중" : job.status === "running" ? "마지막 저장 내역" : "대기"}</span><strong>${esc(job.book?.title || job.input?.topic)}</strong><p>${esc(job.phase || "준비")} · ${job.book?.pages?.filter((p) => p.imageAssetId).length || 0} / ${job.input?.pageCount || 12}쪽 그림</p>${job.status === "running" && !live ? '<p class="small-label">이 화면에서는 실행 중이 아닙니다. 이어 만들거나 중지할 수 있어요.</p>' : ""}${job.error ? `<p class="pin-error">${esc(job.error)}</p>` : ""}<div class="story-inline-actions">${job.status === "review" ? button("완성 초안 검토", "review", job.id, "green") : held ? button("쪽마다 검수", "simple-review", job.id, "green") : live ? button("진행 상황", "status", job.id) : button("이어서 만들기", "resume", job.id, "green")}${job.status !== "review" && !held ? button("중지", "pause", job.id) : ""}${job.book && job.status !== "review" && !held && !live ? button("완료된 부분 검토", "review", job.id) : ""}</div></article>`;
    })
    .join("")}</div></section>`;
}
function refreshCards() {
  const slot = document.querySelector("#full-auto-jobs");
  if (slot) slot.outerHTML = renderFullAutoJobs(api.getState());
}

function runScreen(job, busy) {
  inspectedId = job.id;
  const plan = job.plan,
    images = job.book?.pages?.filter((p) => p.imageAssetId).length || 0,
    textCalls = job.usage.calls.reduce(
      (n, c) => n + (Number(c.requests) || 0),
      0,
    ),
    imageCalls = Object.keys(job.imageUsage || {}).length;
  api.showModal(
    `${api.modalHeader("FULL AUTO · " + (job.status === "review" ? "완성 초안" : !busy && isHeld(job) ? HOLD_LABELS[job.status] : "이야기 만드는 중"))}<p class="modal-intro">${esc(job.input.topic)}</p><p id="full-auto-progress" class="notice" role="status" aria-live="polite">${esc(job.phase)}</p><p id="full-auto-count" class="small-label">그림 ${images} / ${job.input.pageCount}쪽 · 글 요청 ${textCalls}회 · 저장된 생성 이미지 ${imageCalls}장</p>${plan ? `<details class="story-card"><summary>자동으로 고른 재료</summary><p>등장인물: ${plan.characterIds.map((id) => esc(api.getState().characters.find((c) => c.id === id)?.name || plan.newCharacters.find((c) => c.id === id)?.name)).join(" · ")}</p><p>장소: ${plan.backgroundIds.map((id) => esc(api.getState().backgrounds.find((b) => b.id === id)?.name || plan.newBackgrounds.find((b) => b.id === id)?.name)).join(" · ")}</p><p>${esc(plan.reason)}</p><p class="small-label">새 조연 ${plan.newCharacters.length}명 · 새 배경 ${plan.newBackgrounds.length}곳 · 자동 생성 시트는 완료 후 함께 검토해 주세요.</p></details>` : ""}<ol class="full-auto-steps">${[
      ["plan", "재료 선택"],
      ["input", "시트 준비"],
      ["outline", "줄거리"],
      ["briefs", "장면 디테일"],
      ["prose", "한영 전문"],
      ["enrichment", "글 풍부화"],
      ["pagination", "쪽 나누기"],
      ["cover", "본문 그림·표지"],
    ]
      .map(
        ([key, label]) =>
          `<li class="${job.completed[key] ? "done" : ""}">${job.completed[key] ? "✓" : "○"} ${label}</li>`,
      )
      .join(
        "",
      )}</ol>${job.error ? `<p class="pin-error">${esc(job.error)}</p>` : ""}${job.notes.map((n) => `<p class="small-label">${esc(n)}</p>`).join("")}<p class="small-label">완료한 재료·문단·그림은 저장됩니다. 이 창을 닫아도 제작은 계속됩니다. 브라우저를 완전히 종료하면 다음 접속에서 이어 만들어요. 최종 검토 전에는 아이 책장에 공개되지 않습니다.</p><div class="modal-actions">${busy ? button("닫고 둘러보기", "close", job.id) + button("중지 · 결과 보관", "pause", job.id) : job.status === "review" ? button("완성 초안 검토", "review", job.id, "primary") : isHeld(job) ? button("쪽마다 검수", "simple-review", job.id, "primary") : button("이어서 자동 생성", "resume", job.id, "primary")}${!busy ? button("닫기", "close", job.id) : ""}</div>`,
    "wide full-auto-workspace",
  );
}
/** Completion message for the status a run ended in; a hold is not a finished book. */
function finishedToast(job, navigate) {
  if (job.status === "text-review")
    return "글이 완성됐어요. 쪽마다 글을 확인해 주세요.";
  if (job.status === "pages-ready")
    return "그림 만들 준비가 끝났어요. 쪽마다 그림을 만들어 주세요.";
  if (job.status === "review")
    return navigate
      ? "이야기가 완성됐어요. 책장에서 완성 초안을 검토해 주세요."
      : "그림과 표지까지 완성됐어요. 마지막으로 확인해 주세요.";
  return null;
}
/**
 * The only place a run starts: one live run per tab, a cross-tab lock, the
 * local/cloud stop watcher and a save that aborts when the parent locks.
 * navigate=false keeps the current view and forwards every progress event.
 * `redraw` names the pages the parent chose to redraw in this run; every other
 * page whose text changed after drawing keeps its picture (a leftover runner
 * mark is never bought without that choice). A run that would buy nothing
 * records its end here, with no key or World preflight.
 */
async function execute(job, { navigate = true, onProgress, redraw = [] } = {}) {
  if (controller) {
    api.toast(
      "이미 제작 중인 작업이 있어요. 책장에서 진행 상태를 확인해 주세요.",
    );
    return;
  }
  // A paid page rewrite or drawing in flight would race the run for the same page.
  if (pageWorkBusy(job)) {
    api.toast(PAGE_BUSY_MESSAGE);
    return;
  }
  const state = api.getState(),
    operation = new AbortController();
  controller = operation;
  currentJob = job;
  inspectedId = null;
  job.stopBaselineNonce = readAutoStop(job.id)?.nonce || null;
  const watcher = createAutoStopWatcher(job.id, {
    accountId: api.getCloudAccount?.(),
    onStop: (row) => {
      job.stopRequestedAt = row.requestedAt;
      job.stopAcknowledgedNonce = row.nonce;
      operation.abort();
    },
  });
  const work = async () => {
    // Inside the run lock: no other tab is running this job now.
    if (job.status === "running") job.status = "paused";
    // Runner marks the parent did not choose to redraw in this run (a failed
    // save, an older copy of the simple screen, a chosen redraw cut off by a
    // closed tab) become kept pictures before anything can be bought.
    if (job.book && keepEditedPictures(job.book, pagesExcept(job.book, redraw)))
      api.save();
    const end = endWithoutBuying(job);
    if (end) {
      if (!settleWithoutRun(job, end))
        throw Error(
          "자동 작업을 저장하지 못했어요. 저장 공간을 확인해 주세요.",
        );
      return job.book;
    }
    await watcher.start();
    return runFullAuto(state, job, {
      signal: operation.signal,
      save: () => {
        watcher.check();
        if (api.getState() !== state || !api.isParent()) {
          operation.abort();
          throw new DOMException("부모 작업을 중지했어요.", "AbortError");
        }
        return api.save();
      },
      buildBook: api.buildBook,
      onProgress: (event) => {
        const { message } = event;
        if (typeof onProgress === "function")
          try {
            onProgress({
              job,
              message,
              phase: event.phase,
              done: event.done,
              total: event.total,
              fraction: event.fraction,
            });
          } catch {
            /* A screen's progress renderer must never stop a paid run. */
          }
        if (currentJob !== job || operation.signal.aborted) return;
        refreshCards();
        if (
          inspectedId !== job.id ||
          !document.querySelector(".full-auto-workspace")
        )
          return;
        const progress = document.querySelector("#full-auto-progress"),
          count = document.querySelector("#full-auto-count");
        if (progress) progress.textContent = message;
        if (count)
          count.textContent = `그림 ${job.book?.pages?.filter((p) => p.imageAssetId).length || 0} / ${job.input.pageCount}쪽 · 글 요청 ${job.usage.calls.reduce((n, c) => n + (Number(c.requests) || 0), 0)}회`;
      },
    });
  };
  // Claim the book before the first await: until runFullAuto marks the job
  // running (after the stop watcher, the run lock and the credential
  // preflight), job.status still shows the hold, and a page tool started in
  // that gap would buy the same page as the run.
  const claimedBookIds = [
    ...new Set([job.bookId, job.book?.id].filter(Boolean)),
  ];
  for (const id of claimedBookIds) claimBookForRun(id);
  try {
    if (navigate) {
      api.onStarted?.(job);
      api.toast(
        "제작을 시작했어요. 책장의 제작 카드에서 진행 확인·중지를 할 수 있어요.",
      );
    }
    if (globalThis.navigator?.locks)
      await navigator.locks.request(
        "donghwa-full-auto-" + job.id,
        { ifAvailable: true },
        (lock) => {
          if (!lock)
            throw Error(
              "다른 탭에서 이 자동 작업이 실행 중이에요. 그 탭에서 이어 주세요.",
            );
          return work();
        },
      );
    else await work();
    const done = finishedToast(job, navigate);
    if (done && api.getState() === state && api.isParent()) api.toast(done);
  } catch (error) {
    if (api.getState() === state && api.isParent())
      api.toast(
        error.name === "AbortError"
          ? "제작을 중지하고 완료한 결과를 보관했어요."
          : error,
      );
  } finally {
    for (const id of claimedBookIds) releaseBookForRun(id);
    watcher.close();
    if (controller === operation) {
      controller = null;
      currentJob = null;
      if (api.getState() === state && api.isParent()) {
        refreshCards();
        if (
          inspectedId === job.id &&
          document.querySelector(".full-auto-workspace")
        )
          runScreen(job, false);
      }
    }
  }
}
/**
 * Where a job left 'running' by a closed or crashed tab goes back to: the
 * hold it had reached (text built for 'text', snapshot frozen for 'pages'),
 * otherwise 'paused'. Completed steps stay completed either way.
 */
function recoveredStatus(job) {
  if (job.stopBefore === "text" && job.book)
    return ["text-review", "글 완성 · 쪽 검수"];
  if (job.stopBefore === "pages" && job.book?.generationSnapshot)
    return ["pages-ready", "그림 준비 완료"];
  return ["paused", "중지 · 완료한 결과 보관"];
}
/**
 * Run `work` only when no tab holds this job's run lock. Without Web Locks
 * this tab can only vouch for itself, so it needs no live run here at all.
 */
async function whenRunLockFree(jobId, work) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return controller ? false : work();
  try {
    return await locks.request(
      "donghwa-full-auto-" + jobId,
      { ifAvailable: true },
      (lock) => (lock ? work() : false),
    );
  } catch {
    return false;
  }
}
async function stopJob(job) {
  const running = currentJob?.id === job.id && !!controller;
  if (running) controller.abort();
  const response = await requestAutoStop(job.id, {
    accountId: api.getCloudAccount?.(),
  });
  // A held job is already parked; keep its hold so the simple screen still knows where it stands.
  if (!running && job.status !== "running" && !isHeld(job)) {
    job.status = "paused";
    job.phase = "중지 · 완료한 결과 보관";
    job.stopRequestedAt = response.requestedAt;
    api.save();
  }
  // 'running' but not live in this tab: a closed or crashed tab left it. Release it
  // when no other tab holds the run, so page tools and resume work again.
  if (!running && job.status === "running")
    await whenRunLockFree(job.id, () => {
      if (job.status !== "running") return false;
      const [status, phase] = recoveredStatus(job);
      job.status = status;
      job.phase = phase;
      if (status !== "paused") job.currentStep = null;
      job.stopRequestedAt = response.requestedAt;
      job.updatedAt = new Date().toISOString();
      api.save();
      return true;
    });
  refreshCards();
  api.toast(
    response.remoteError
      ? `이 브라우저에 중지를 반영했어요. ${response.remoteError}`
      : response.remoteStored
        ? "중지 요청을 저장했어요. 실행 중인 기기에 전달됩니다."
        : "중지 요청을 보관했어요. 완료한 결과는 유지됩니다.",
  );
}

function connectedApi() {
  if (!api) throw Error("FULL AUTO 화면 연결을 먼저 설정해 주세요.");
  return api;
}
function jobById(jobId) {
  const job = autoJobs(connectedApi().getState())[jobId];
  if (!job) throw Error("자동 작업을 찾지 못했어요.");
  return job;
}
function assertIdleRunner(job) {
  if (controller) throw Error("현재 자동 작업이 실행 중이에요.");
  if (!connectedApi().isParent())
    throw Error("부모 잠금을 풀고 다시 시도해 주세요.");
  if (job && pageWorkBusy(job)) throw Error(PAGE_BUSY_MESSAGE);
}
/**
 * The pro editor may only open a book whose drawing setup is final. A held
 * series book gets the previous book's sheets, places and style only when
 * the hold is released to 'pages'; approving it before would freeze a plain
 * current-World snapshot and lose the series look.
 */
function assertEditorReady(job) {
  if (controller) throw Error("실행 중인 작업을 먼저 중지해 주세요.");
  if (!job.book)
    throw Error("아직 그림 단계의 초안이 없어요. 자동 생성을 이어 주세요.");
  if (job.seriesContinuityDeferred && !job.book.generationSnapshot)
    throw Error(
      "이어지는 시리즈 편이에요. 이전 편의 캐릭터·장소·화풍을 불러오도록 먼저 '그림 준비'까지 이어 만든 뒤 검토해 주세요.",
    );
}
/**
 * Create and run a FULL AUTO job through the shared runner.
 * Resolves with the job when the run ends: job.status is 'text-review' or
 * 'pages-ready' at a hold, 'review' when complete, 'paused' after a stop and
 * 'failed' (job.error) on an error. Progress events are
 * {job, message, phase, done, total, fraction}.
 */
export async function startFullAutoJob(
  wizard,
  {
    allowNew = true,
    stopBefore = null,
    demo = false,
    planMode = "auto",
    navigate = false,
    onProgress,
  } = {},
) {
  assertIdleRunner();
  const state = api.getState(),
    job = createFullAutoJob(state, wizard, {
      allowNew,
      stopBefore,
      demo,
      planMode,
    });
  if (api.save() === false) {
    delete autoJobs(state)[job.id];
    throw Error("자동 작업을 저장하지 못했어요.");
  }
  await execute(job, { navigate, onProgress });
  return job;
}
/**
 * Resume or release a job. Passing stopBefore ('text' | 'pages' | null) moves
 * the hold first; completed steps are skipped, so nothing paid is bought twice.
 * `redraw` lists the page indexes the parent chose to redraw in this run (their
 * runner marks stay); any other page whose text changed keeps its picture.
 */
export async function runFullAutoJob(
  jobId,
  { stopBefore, navigate = false, onProgress, redraw = [] } = {},
) {
  const job = jobById(jobId);
  assertIdleRunner(job);
  if (stopBefore !== undefined) {
    if (!FULL_AUTO_STOPS.includes(stopBefore))
      throw Error(
        "자동 작업을 멈출 단계는 글(text)·그림 준비(pages) 중에서 골라 주세요.",
      );
    const previous = job.stopBefore ?? null;
    job.stopBefore = stopBefore;
    if (api.save() === false) {
      job.stopBefore = previous;
      throw Error("자동 작업을 저장하지 못했어요.");
    }
  }
  await execute(job, { navigate, onProgress, redraw });
  return job;
}
/**
 * Explicit stop: aborts a live run here and leaves a stop request for other
 * tabs and devices. A job still marked 'running' by a closed or crashed tab
 * goes back to the hold it reached ('text-review' / 'pages-ready') or
 * 'paused' once no tab holds its run lock.
 */
export async function stopFullAutoJob(jobId) {
  connectedApi();
  const job = jobById(jobId);
  await stopJob(job);
  return job;
}
export function getFullAutoJob(jobId) {
  return autoJobs(connectedApi().getState())[jobId] || null;
}
/**
 * Open a job's review the way its library card does: a held job in the simple
 * review (④), any other job in the pro editor once its drawing setup is final.
 * The caller refuses first while a simple action or page operation owns the book.
 */
export async function openFullAutoReview(jobId) {
  const job = jobById(jobId);
  if (isHeld(job) && typeof api.openSimpleReview === "function")
    return api.openSimpleReview(job.id);
  assertEditorReady(job);
  return api.openReview(job);
}

export function configureFullAutoUI(context) {
  api = context;
  if (configured) return;
  configured = true;
  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-full-auto-action]");
    if (!el) return;
    event.preventDefault();
    api.protectedAction(async () => {
      try {
        const action = el.dataset.fullAutoAction;
        if (action === "close") {
          api.closeModal();
          return;
        }
        const state = api.getState();
        if (action === "start") {
          if (controller) return api.toast("현재 자동 작업이 실행 중이에요.");
          const wizard = api.getWizard(),
            allowNew =
              document.querySelector("#full-auto-allow-new")?.checked !== false,
            job = createFullAutoJob(state, wizard, { allowNew });
          if (api.save() === false) {
            delete autoJobs(state)[job.id];
            throw Error("자동 작업을 저장하지 못했어요.");
          }
          await execute(job);
          return;
        }
        const job = autoJobs(state)[el.dataset.id];
        if (!job) throw Error("자동 작업을 찾지 못했어요.");
        if (action === "pause") {
          await stopJob(job);
          return;
        }
        if (action === "status") {
          runScreen(job, currentJob?.id === job.id && !!controller);
          return;
        }
        if (action === "resume") {
          await execute(job);
          return;
        }
        if (action === "simple-review") {
          if (typeof api.openSimpleReview === "function") {
            await api.openSimpleReview(job.id);
            return;
          }
          // Fallback to the pro editor.
          assertEditorReady(job);
          await api.openReview(job);
          return;
        }
        if (action === "review") {
          assertEditorReady(job);
          await api.openReview(job);
        }
      } catch (error) {
        api.toast(error);
      }
    });
  });
  globalThis.window?.addEventListener("pagehide", cleanupFullAuto);
}
