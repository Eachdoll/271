/**
 * 2026-10-20 멈춤 리포트: why a story run stopped, or what its checks left as
 * notes, written out so the parent can hand it to whoever improves the app.
 *
 * Built only from named text fields of the job (the error, the check reports,
 * the sentences they point at, call counts). Never engine settings beyond
 * model names, never keys, media or endpoints.
 */
import { STORY_STAGE_LABELS, describeStoryError } from "./schemas.js";
import { plotContractForBeat } from "./plot-contract.js";

const list = (value) => (Array.isArray(value) ? value : []);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value, max = 2000) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
const STEP_LABELS = Object.freeze({
  plan: "재료 고르기",
  input: "시트 준비",
  outline: "줄거리",
  briefs: "장면 디테일",
  proseDraft: "글 초안",
  prose: "한글·영어 글",
  enrichment: "글 다듬기",
  proseCoherence: "전문 사건 연결 검사",
  pagination: "쪽 나누기와 본문 검사",
  cover: "표지 그림",
});
const stepLabel = (key) =>
  STEP_LABELS[key] ||
  (/^page:/u.test(String(key)) ? `${Number(key.split(":")[1]) + 1}쪽 그림` : key);
const LANG = { ko: "한글", en: "영어", both: "한글·영어" };
const ISSUE_CODE = {
  causal_gap: "원인·결과 끊김",
  state_conflict: "상태 모순",
  goal_drift: "목표 이탈",
  unsupported_event: "준비 없는 사건",
  setup_payoff: "심기·회수 불일치",
  text_scene_conflict: "글·장면 불일치",
};

/** What a failed run keeps beside job.error, for the report. */
export function captureFailure(error, job = null) {
  return {
    at: new Date().toISOString(),
    step: job?.currentStep || null,
    phase: str(job?.phase || "", 200) || null,
    name: str(error?.name || "Error", 80),
    stage: error?.stage || error?.meta?.stage || null,
    message: str(error?.message || error, 2000),
    violations: list(error?.violations)
      .slice(0, 20)
      .map((row) => str(row, 1000)),
    requests: Number(error?.meta?.requests) || 0,
    ...(error?.childGateUnreadable
      ? { childGateUnreadable: String(error.childGateUnreadable) }
      : {}),
  };
}

function pagesOf(job) {
  const pages = list(job?.pagination?.pages).length
    ? list(job.pagination.pages)
    : list(job?.book?.pages).map((page, index) => ({
        pageNo: page?.pageNo || index + 1,
        beatIndex: page?.beatIndex ?? page?.scene?.beatIndex,
        textKo: page?.ko ?? page?.textKo,
        textEn: page?.en ?? page?.textEn,
        scene: page?.scene,
        kind: page?.kind,
        openingNo: page?.openingNo,
      }));
  return pages;
}
function pageLine(page) {
  const head = `${page.pageNo}쪽${page.kind ? ` (${page.kind === "spread" ? "펼침면" : "낱쪽"}${page.openingNo ? ` · 펼침 ${page.openingNo}` : ""})` : ""}${Number.isInteger(page.beatIndex) ? ` · 비트 ${page.beatIndex}` : ""}`;
  const rows = [`- **${head}**`];
  if (page.textKo) rows.push(`  - 한글: ${str(page.textKo, 1500)}`);
  if (page.textEn) rows.push(`  - 영어: ${str(page.textEn, 1500)}`);
  if (page.scene?.action)
    rows.push(`  - 장면: ${str(page.scene.action, 600)}`);
  return rows.join("\n");
}
function coherenceSection(title, report) {
  if (!object(report)) return [];
  const issues = list(report.issues);
  const rows = [
    `### ${title}`,
    `- 결과: ${report.passed === true ? "통과" : report.pending ? "수정 중" : "미통과"} · 자동 수정 ${Number(report.repairAttempts) || 0}회${report.unresolved ? ` · 수정 뒤 남은 지적 ${report.unresolved}곳 (참고로 남김)` : ""}`,
  ];
  if (!issues.length) rows.push("- 지적 없음");
  for (const issue of issues.slice(0, 20)) {
    rows.push(
      `- [${issue.severity === "error" ? "오류" : "참고"}] ${ISSUE_CODE[issue.code] || issue.code} · 비트 ${issue.beatIndex}${issue.pageNo != null ? ` · ${issue.pageNo}쪽` : ""} · ${LANG[issue.language] || issue.language}`,
    );
    if (issue.suggestion) rows.push(`  - 지적: ${str(issue.suggestion, 1200)}`);
    if (issue.evidence) rows.push(`  - 근거 인용: "${str(issue.evidence, 600)}"`);
  }
  return rows;
}
function childSection(job) {
  const gate = job?.childGate,
    journal = job?.childGateCheckpoint;
  if (!object(gate) && !object(journal)) return [];
  const rows = ["### 아이 시뮬레이터 (되말하기·호기심)"];
  if (gate?.skipped) {
    rows.push(
      `- 건너뜀: ${gate.reason === "unreadable" ? `심사 답을 읽지 못함 (${gate.check === "retell" ? "되말하기" : gate.check === "curiosity" ? "호기심" : gate.check || ""})` : gate.reason || "비활성"}${gate.message ? ` · ${str(gate.message, 300)}` : ""}`,
    );
  }
  const source = object(gate) && !gate.skipped ? gate : journal;
  if (object(source)) {
    if (source.phase) rows.push(`- 진행: ${source.phase}`);
    if (typeof source.pass === "boolean")
      rows.push(`- 결과: ${source.pass ? "통과" : "참고 남음"}`);
    const retell = source.retell,
      curiosity = source.curiosity;
    if (object(retell)) {
      rows.push(
        `- 되말하기: ${list(retell.retell).map((line) => str(line, 300)).join(" / ")}`,
      );
      rows.push(
        `- 되말하기에 담긴 비트: ${list(retell.coveredBeats).join(", ") || "없음"} · 빠진 핵심: ${list(retell.missingCore).join(", ") || "없음"} · 연결 점수 ${retell.coherence ?? "?"}/2`,
      );
      if (list(retell.confusions).length)
        rows.push(
          `- 헷갈린 점: ${list(retell.confusions).map((line) => str(line, 300)).join(" / ")}`,
        );
    }
    if (object(curiosity)) {
      rows.push(
        `- 호기심: 전체 ${curiosity.overall ?? "?"}/10 · 0점 쪽: ${list(curiosity.dropPages).join(", ") || "없음"}`,
      );
      for (const page of list(curiosity.pages).filter((row) => row?.score === 0))
        rows.push(`  - ${page.pageNo}쪽 0점: ${str(page.why, 300)}`);
    }
    const unreadable = Object.values(object(source.rounds) ? source.rounds : {})
      .flatMap((round) =>
        Object.entries(object(round?.unreadable) ? round.unreadable : {}),
      )
      .filter(([, count]) => count > 0);
    if (unreadable.length)
      rows.push(
        `- 읽지 못한 답: ${unreadable.map(([mode, count]) => `${mode === "retell" ? "되말하기" : "호기심"} ${count}회`).join(", ")}`,
      );
    if (list(source.repairedPages).length || list(source.repairedTurnParagraphs).length)
      rows.push(
        `- 자동 수정: 끝 문장 고친 쪽 ${list(source.repairedPages).join(", ") || "없음"} · 반전 문단 ${list(source.repairedTurnParagraphs).length}곳`,
      );
  }
  return rows;
}
function storyCheckSection(job) {
  const check = job?.storyCheck;
  if (!object(check)) return [];
  const failed = list(check.checks).filter((row) => row && row.passed === false),
    warnings = list(check.warnings);
  if (!failed.length && !warnings.length) return [];
  const rows = ["### 본문 규칙 검사"];
  for (const row of failed.slice(0, 10)) {
    rows.push(`- 미통과: ${str(row.label || row.id, 200)}`);
    for (const violation of list(row.violations).slice(0, 6))
      rows.push(
        `  - ${violation.pageNo ? `${violation.pageNo}쪽 · ` : ""}${str(violation.message || violation.code, 400)}`,
      );
  }
  for (const warning of warnings.slice(0, 10))
    rows.push(
      `- 참고: ${warning.pageNo ? `${warning.pageNo}쪽 · ` : ""}${str(warning.message || warning.code, 400)}`,
    );
  return rows;
}
function briefSection(job) {
  const repairs = object(job?.briefRepairs) ? job.briefRepairs : {},
    counts = Object.entries(repairs).filter(([, row]) => {
      const n = object(row) ? Number(row.hard || 0) + Number(row.soft || 0) : Number(row);
      return n > 0;
    });
  const violations = list(job?.failure?.violations).filter((row) =>
    /번 장면/u.test(row),
  );
  if (!counts.length && !violations.length) return [];
  const rows = ["### 장면 디테일 검사"];
  if (counts.length)
    rows.push(
      `- 자동 수정 호출: ${counts
        .map(([beat, row]) =>
          object(row)
            ? `비트 ${beat} ${Number(row.hard || 0)}회(멈춤)·${Number(row.soft || 0)}회(보완)`
            : `비트 ${beat} ${row}회`,
        )
        .join(", ")}`,
    );
  const named = new Set(
    violations.flatMap((row) =>
      [...row.matchAll(/(\d+)번 장면/gu)].map((m) => Number(m[1])),
    ),
  );
  for (const brief of list(job?.sceneBriefs).filter((row) =>
    named.has(Number(row?.beatIndex)),
  ))
    rows.push(
      `- ${brief.beatIndex}번 장면: 동작 "${str(brief.action || brief.actionEn || "", 300)}"${brief.timeOfDay ? ` · 시간대 ${brief.timeOfDay}` : ""} · 소리 ${list(brief.sounds).length}개 · 소품 ${list(brief.props).length}개`,
    );
  return rows;
}
function outlineSection(job) {
  const outline = job?.outline;
  if (!object(outline)) return [];
  const rows = ["### 줄거리"];
  if (outline.logline) rows.push(`- 한 줄: ${str(outline.logline, 400)}`);
  for (const beat of list(outline.beats).slice(0, 8))
    rows.push(
      `- 비트 ${beat.index} [${beat.type}]${beat.settingKey ? ` @${beat.settingKey}` : ""}: ${str(beat.summary, 400)}`,
    );
  const quality = outline.qualityMeta || outline.quality;
  const soft = list(quality?.softIssues);
  if (soft.length)
    rows.push(
      `- 줄거리 검사 참고: ${soft.map((row) => str(row.message || row, 300)).join(" / ")}`,
    );
  if (quality?.untargetedFixRestored)
    rows.push(
      `- 수정 호출이 지적 밖을 바꿔 되돌림: ${str(JSON.stringify(quality.untargetedFixRestored), 300)}`,
    );
  if (quality?.regenerationAttempts)
    rows.push(`- 줄거리 재구성 ${quality.regenerationAttempts}회`);
  return rows;
}
function contractLines(job, beatIndexes) {
  const outline = job?.outline;
  if (!outline?.plotContract || !beatIndexes.size) return [];
  const rows = ["### 지적된 비트의 사건 장부"];
  for (const index of [...beatIndexes].sort((a, b) => a - b)) {
    let beat = null;
    try {
      beat = plotContractForBeat(outline, index);
    } catch {
      beat = null;
    }
    if (!beat) continue;
    rows.push(
      `- 비트 ${index}: 계기 "${str(beat.trigger, 300)}" → 시도 "${str(beat.attempt, 300)}" → 결과 "${str(beat.result, 300)}"${beat.nextDecision ? ` → 다음 "${str(beat.nextDecision, 300)}"` : ""}`,
    );
  }
  return rows;
}
function usageSection(job) {
  const calls = list(job?.usage?.calls);
  if (!calls.length) return [];
  const sum = (key) => calls.reduce((n, row) => n + (Number(row?.[key]) || 0), 0);
  const cost = calls.reduce(
    (n, row) =>
      n +
      (Number.isFinite(Number(row?.costUsd))
        ? Number(row.costUsd)
        : Number(row?.costUsdEstimated) || 0),
    0,
  );
  const failed = calls.filter((row) => row?.failed).length,
    requests = calls.reduce((n, row) => n + (Number(row?.requests) || 1), 0);
  return [
    "### 사용량",
    `- 글 요청 ${requests}회 (실패로 끝난 단계 ${failed}회) · 입력 ${sum("input").toLocaleString()} · 출력 ${sum("output").toLocaleString()} 토큰 · 비용 약 $${cost.toFixed(2)}`,
  ];
}
function modelLine(job) {
  const settings = job?.textSettings,
    engine = str(settings?.engine || "", 40),
    provider = object(settings?.providers?.[engine]) ? settings.providers[engine] : {};
  const models = [
    provider.model ? `경제형 ${str(provider.model, 80)}` : "",
    provider.stageModels?.medium ? `고급 ${str(provider.stageModels.medium, 80)}` : "",
    provider.stageModels?.upper ? `상위 ${str(provider.stageModels.upper, 80)}` : "",
  ].filter(Boolean);
  const quality = object(settings?.storyQuality) ? settings.storyQuality : {};
  return `- 글 엔진: ${job?.demo ? "데모 (무료 예시)" : engine || "?"}${models.length ? ` · ${models.join(" · ")}` : ""} · 품질 경로 ${quality.enabled ? "켜짐" : "꺼짐"}${quality.enabled ? ` (아이 시뮬레이터 ${quality.childSimulator === false ? "꺼짐" : "켜짐"}, 두 단계 글 ${quality.twoPass === false ? "꺼짐" : "켜짐"}, 승인 예시 ${quality.useDistilledExamples ? "켜짐" : "꺼짐"})` : ""} · 통독 ${object(job?.input?.editorPolicy) ? "켜짐" : "없음"} · 솜씨 규칙 ${object(job?.input?.craftPolicy) ? "켜짐" : "없음"} · 뼈대 규칙 ${object(job?.input?.arcPolicy) ? "켜짐" : "없음"}`;
}

/** The report as Markdown text. */
export function buildStopReport(job, { now = new Date() } = {}) {
  if (!object(job)) return "";
  const input = object(job.input) ? job.input : {},
    wizard = object(job.wizard) ? job.wizard : {},
    levels = object(job.readingLevels) ? job.readingLevels : {},
    failure = object(job.failure) ? job.failure : null,
    title = str(job.book?.title || input.topic || wizard.topic || "이야기", 200);
  const rows = [
    `# 동화공방 멈춤 리포트 · ${title}`,
    "",
    `- 만든 시각: ${now instanceof Date ? now.toISOString() : str(now)}`,
    `- 작업: ${str(job.id, 80)} · 상태 ${str(job.status, 40)}${job.phase ? ` · ${str(job.phase, 200)}` : ""}${job.stopBefore ? ` · 멈출 단계 ${job.stopBefore}` : ""}`,
    `- 주제: ${str(input.topic || wizard.topic, 300)}`,
    `- 구성: ${input.pageCount || wizard.pageCount || "?"}쪽 · 언어 ${str(input.language || wizard.language, 20)} · 한글 ${str(levels.koreanLevel || wizard.koreanLevel || "-", 10)} · 영어 ${str(levels.englishLevel || wizard.englishLevel || "-", 10)}${input.layoutPolicy?.kind ? ` · 배치 ${str(input.layoutPolicy.kind, 20)}` : ""}${input.specs?.ko?.rhythm ? " · 쪽 리듬" : ""}`,
    modelLine(job),
    `- 시작 ${str(job.createdAt, 40)} · 마지막 저장 ${str(job.updatedAt, 40)}`,
    "",
    "## 멈춘 곳",
  ];
  const completed = Object.keys(object(job.completed) ? job.completed : {});
  rows.push(
    `- 끝난 단계: ${completed.length ? completed.map(stepLabel).join(" → ") : "없음"}`,
  );
  if (job.status === "failed" || job.error || failure) {
    rows.push(
      `- 멈춘 단계: ${stepLabel(failure?.step || job.currentStep || "?")}${failure?.stage ? ` (${STORY_STAGE_LABELS[failure.stage] || failure.stage})` : ""}`,
    );
    if (job.error) rows.push(`- 오류: ${str(job.error, 2000)}`);
    if (
      failure?.message &&
      failure.message !== job.error &&
      describeStoryError(failure.message) !== job.error
    )
      rows.push(`- 원문: ${failure.message}`);
    for (const violation of list(failure?.violations)) rows.push(`  - ${violation}`);
    if (failure?.requests) rows.push(`- 이 단계의 요청 수: ${failure.requests}`);
  } else rows.push("- 멈추지 않았어요. 아래 검사 결과는 참고로 남은 항목이에요.");
  for (const note of list(job.notes)) rows.push(`- 메모: ${str(note, 500)}`);
  rows.push("", "## 검사 결과");
  const checkRows = [
    ...coherenceSection("쪽 사건 연결 검사", job.pageCoherence),
    ...coherenceSection("전문 사건 연결 검사", job.proseCoherence),
    ...childSection(job),
    ...briefSection(job),
    ...storyCheckSection(job),
  ];
  if (job.revision) {
    checkRows.push("### 편집자 통독");
    checkRows.push(
      `- 다듬은 쪽: ${list(job.revision.accepted).map((row) => row.pageNo).join(", ") || "없음"}${job.revision.rolledBack ? ` · 사건 검사와 맞지 않아 되돌림 (${list(job.revision.rolledBackPages).join(", ")})` : ""}`,
    );
  }
  rows.push(...(checkRows.length ? checkRows : ["- 저장된 검사 결과가 없어요."]));
  const issues = [
    ...list(job.pageCoherence?.issues),
    ...list(job.proseCoherence?.issues),
  ];
  const pageNos = new Set(
      [
        ...issues.map((issue) => issue.pageNo).filter((n) => Number.isInteger(n)),
        ...list(job.childGate?.curiosity?.dropPages),
      ].map(Number),
    ),
    beatIndexes = new Set(
      issues.map((issue) => Number(issue.beatIndex)).filter(Number.isInteger),
    );
  const pages = pagesOf(job),
    named = pages.filter(
      (page) =>
        pageNos.has(Number(page.pageNo)) ||
        (beatIndexes.size &&
          issues.some(
            (issue) => issue.pageNo == null && issue.beatIndex === page.beatIndex,
          )),
    );
  rows.push("", "## 관련 글");
  rows.push(...outlineSection(job));
  rows.push(...contractLines(job, beatIndexes));
  if (named.length) {
    rows.push("### 지적된 쪽");
    rows.push(...named.slice(0, 12).map(pageLine));
  } else if (pages.length && failure?.stage && /^(pagination|coherence|page)$/u.test(failure.stage)) {
    rows.push("### 쪽 글");
    rows.push(...pages.slice(0, 24).map(pageLine));
  }
  if (!pages.length && typeof job.prose?.ko === "string") {
    rows.push("### 전문 (한글)");
    rows.push(str(job.prose.ko, 6000));
    if (typeof job.prose.en === "string") {
      rows.push("### 전문 (영어)");
      rows.push(str(job.prose.en, 6000));
    }
  }
  rows.push("", ...usageSection(job));
  rows.push(
    "",
    "_이 리포트는 글과 검사 결과만 담고 있어요. API 키·엔진 설정·그림은 들어 있지 않아요._",
  );
  return rows.join("\n").replace(/\n{3,}/gu, "\n\n").trim() + "\n";
}

/** Shown when the job stopped, or finished its text with notes the checks left. */
export function stopReportAvailable(job) {
  return (
    object(job) &&
    (job.status === "failed" ||
      !!job.error ||
      !!job.failure ||
      (Number(job.pageCoherence?.unresolved) || 0) > 0 ||
      job.childGate?.reason === "unreadable")
  );
}
/** ASCII only: a browser drops a download name with Korean in it. */
export function stopReportFileName(job, now = new Date()) {
  const topic = str(job?.book?.title || job?.input?.topic || job?.wizard?.topic || "", 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 24);
  const id = str(job?.id || "", 80).replace(/[^a-z0-9]/giu, "").slice(-6).toLowerCase();
  const stamp = (now instanceof Date ? now : new Date()).toISOString().slice(0, 16).replace(/[:T]/gu, "-");
  return `donghwa-report-${stamp}${topic ? `-${topic}` : ""}${id ? `-${id}` : ""}.md`;
}
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
/** Modal body: the report in a read-only box with 복사 · 파일로 저장. */
export function renderStopReportModal(text, { title = "멈춤 리포트" } = {}) {
  return `<p class="modal-intro">${escape(title)} · 아래 내용을 복사하거나 파일로 저장해 개발자에게 전해 주세요. 글과 검사 결과만 담겨 있고 API 키나 그림은 들어 있지 않아요.</p><textarea id="stop-report-text" class="stop-report-text" readonly rows="18" spellcheck="false">${escape(text)}</textarea><div class="modal-actions"><button type="button" class="btn btn-outline" data-stop-report="copy">복사</button><button type="button" class="btn btn-outline" data-stop-report="download">파일로 저장</button><button type="button" class="btn btn-plain" data-stop-report="close">닫기</button></div>`;
}
/**
 * Open the report for a job through the caller's modal helpers
 * ({showModal, modalHeader, closeModal, toast}); copy and download are bound
 * on the opened modal. Returns the report text.
 */
export function openStopReport(ui, job, { now = new Date() } = {}) {
  const text = buildStopReport(job, { now }),
    fileName = stopReportFileName(job, now);
  ui.showModal(
    `${ui.modalHeader("멈춤 리포트")}${renderStopReportModal(text)}`,
    "stop-report-modal",
  );
  const root = typeof document !== "undefined" ? document : null;
  if (!root?.querySelector) return text;
  const box = root.querySelector("#stop-report-text");
  root.querySelector('[data-stop-report="close"]')?.addEventListener("click", () =>
    ui.closeModal(),
  );
  const selectAndCopy = () => {
    try {
      box?.focus();
      box?.select();
      return root.execCommand?.("copy") === true;
    } catch {
      return false;
    }
  };
  root.querySelector('[data-stop-report="copy"]')?.addEventListener("click", async () => {
    let copied = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) copied = selectAndCopy();
    ui.toast?.(
      copied
        ? "리포트를 복사했어요."
        : "복사하지 못했어요. 글 상자를 길게 눌러 복사해 주세요.",
    );
  });
  root.querySelector('[data-stop-report="download"]')?.addEventListener("click", () => {
    try {
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" }),
        url = URL.createObjectURL(blob),
        link = root.createElement("a");
      link.href = url;
      link.download = fileName;
      root.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ui.toast?.(`${fileName} 파일로 저장했어요.`);
    } catch {
      ui.toast?.("파일로 저장하지 못했어요. 복사해서 붙여 넣어 주세요.");
    }
  });
  return text;
}
