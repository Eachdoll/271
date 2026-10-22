#!/usr/bin/env node
/**
 * R31b A/B — the same request, two prompt sets, measured by the checker.
 *
 * Writes the bus story ("4살 유하가 스쿨버스를 타고 해니를 만나 장난치며
 * 유치원에 가는 이야기", 12 pages) with the app's own FULL AUTO text stages,
 * exactly as ③ runs them (text hold, no picture), once per arm:
 *   diet — a new draft as the app makes it today (promptDiet frozen, R31b);
 *   r31a — the same new draft with promptDiet removed (every other policy the
 *          same): the prompts every draft got before R31b.
 * Each manuscript is then measured with the deterministic reading checker
 * under the draft's own specs, and the real cost is summed from the usage
 * rows (token counts × the price table). The K1 run also measures the Dola
 * golden manuscript the same way for a third column.
 *
 * PAID. It runs only where the parent's key is: the key is read once from the
 * environment (OPENAI_API_KEY for the OpenAI engine, ANTHROPIC_API_KEY,
 * GOOGLE_API_KEY) and handed to the pipeline's credential hook; it is never
 * printed or written. Nothing here reads the PIN vault or any file for a key.
 *
 *   node scripts/r31b-ab.mjs K1 both QA/r31b-ab --paid
 *   node scripts/r31b-ab.mjs K2 both QA/r31b-ab --paid
 *   node scripts/r31b-ab.mjs K1 diet QA/r31b-ab --paid --selection   (no material plan call)
 *   node scripts/r31b-ab.mjs K1 both /tmp/ab --demo                  (free: the demo engine, plumbing only)
 *
 * Arguments: <K1|K2> <diet|r31a|both> [outDir]; flags --paid (required for a
 * real run), --demo (free demo engine), --selection (the parent's picks only,
 * no paid material plan; the default mirrors ③: 부족한 재료 자동 추가).
 * Output: <outDir>/<level>-<arm>.md and .json, <outDir>/<level>-compare.md.
 *
 * R31c: pages are measured with the unit spec of their kind (a spread is not a
 * page), the writer's original prose is kept beside the final book, and every
 * checkpoint of the pagination stage records which violations it was fixing
 * (the repair history), so the next reading needs no replay.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preloadQualityDataForNode } from "./r31b-node-data.mjs";
import { seedState } from "../dist/engine.js";
import { migrateWorldState } from "../dist/image-generation/world.js";
import { migrateReadingSettings } from "../dist/reading-ui.js";
import {
  createFullAutoJob,
  runFullAuto,
  estimateFullAutoCost,
} from "../dist/full-auto.js";
import { jobTextBudget } from "../dist/text-generation/models.js";
import { unitSpec, unitKind } from "../dist/book-layout.js";
import { generateProse, paginateStory, repairPagination } from "../dist/story-generation/pipeline.js";
import {
  analyzeEstimatedPage,
  splitSentences,
} from "../dist/reading-checker.js";
import { describeReadingViolation } from "../dist/reading-messages.js";
import {
  splitAtEllipsis,
  hasShortSentences,
} from "../dist/short-sentences.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2),
  flags = new Set(args.filter((a) => a.startsWith("--"))),
  positional = args.filter((a) => !a.startsWith("--"));
const level = (positional[0] || "K1").toUpperCase();
const armArg = positional[1] || "both";
const demo = flags.has("--demo"),
  paid = flags.has("--paid"),
  selection = flags.has("--selection");
if (!["K1", "K2"].includes(level) || !["diet", "r31a", "both"].includes(armArg)) {
  console.error("사용법: node scripts/r31b-ab.mjs <K1|K2> <diet|r31a|both> [outDir] [--paid|--demo] [--selection]");
  process.exit(2);
}
if (!demo && !paid) {
  console.error("유료 실행입니다. 부모님 승인 뒤 --paid 를 붙여 주세요 (무료 배선 점검은 --demo).");
  process.exit(2);
}
const stamp = new Date().toISOString().slice(0, 10);
const outDir = resolve(root, positional[2] || `QA/r31b-ab-${stamp}`);
mkdirSync(outDir, { recursive: true });
const arms = armArg === "both" ? ["r31a", "diet"] : [armArg];

const TOPIC = "4살 유하가 스쿨버스를 타고 해니를 만나 장난치며 유치원에 가는 이야기";
const wizard = {
  characterIds: ["yuha"],
  backgroundIds: ["home", "forest"],
  topic: TOPIC,
  pageCount: 12,
  koreanLevel: level,
  englishLevel: level === "K1" ? "E0" : "E2",
  value: "none",
  ending: "home",
  language: "bilingual",
  simpleFlow: true,
  allowNew: !selection,
};

// Where keys come from: the environment of the machine that runs this, once.
const ENV_KEYS = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GOOGLE_API_KEY" };
const credentials = async (engine) => (ENV_KEYS[engine] && process.env[ENV_KEYS[engine]]) || null;

const setup = () => {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  return state;
};
const buildBook = (p) => ({
  id: p.bookId,
  title: p.pagination?.cover?.title || p.outline?.titleCandidates?.[0] || "",
  characterIds: p.wizard.characterIds,
  backgroundIds: p.wizard.backgroundIds,
  pages: (p.pagination?.pages || []).map((x) => ({ ...x, ko: x.textKo, en: x.textEn })),
  outline: p.outline,
  prose: p.prose,
  pagination: structuredClone(p.pagination),
  storyInput: p.input,
});
const log = (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
const money = (n) => (Number.isFinite(n) ? `$${n.toFixed(3)}` : "?");

async function runArm(arm) {
  const state = setup();
  const job = createFullAutoJob(state, wizard, {
    allowNew: !selection,
    stopBefore: "text",
    planMode: selection ? "selection" : "auto",
    demo,
    councilReview: false, // the chair picks; nothing parks for a click
  });
  if (arm === "r31a") delete job.input.promptDiet;
  const estimate = demo ? null : estimateFullAutoCost(state, wizard, { job });
  log(`[${arm}] 시작 · ${level} ${wizard.pageCount}쪽 · 재료 계획 ${job.planMode} · 추정 글 요금 ${estimate ? money(estimate.textUsd) : "무료(데모)"}`);
  const progress = [], history = [], snapshot = {};
  const withHistory = (opts) => ({
    ...opts,
    onCheckpoint: async (cp) => {
      if (cp?.checks)
        history.push({
          requests: cp.meta?.requests ?? null,
          failedPageNos: cp.checks.failedPageNos || [],
          violations: (cp.checks.violations || []).map((v) => `${v.type || v.code}@${v.pageNo ?? "-"}`),
          notes: (cp.checks.warnings || []).length,
        });
      return opts.onCheckpoint?.(cp);
    },
  });
  const started = Date.now();
  let error = null;
  try {
    await runFullAuto(state, job, {
      credentials,
      buildBook,
      save: () => true,
      operations: {
        prose: async (outline, input, opts) => {
          const r = await generateProse(outline, input, opts);
          snapshot.prose = structuredClone(r.data);
          return r;
        },
        pagination: (outline, prose, input, opts) => paginateStory(outline, prose, input, withHistory(opts)),
        repairPagination: (outline, prose, pagination, input, opts) => repairPagination(outline, prose, pagination, input, withHistory(opts)),
      },
      onProgress: (p) => {
        const message = p.message || p.phase;
        if (message && message !== progress.at(-1)) {
          progress.push(message);
          log(`[${arm}] ${message}`);
        }
      },
    });
  } catch (e) {
    error = e;
    log(`[${arm}] 중단: ${e?.message || e}`);
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  log(`[${arm}] ${error ? "실패" : "완료"} · ${job.status} · ${seconds}초`);
  return { arm, state, job, estimate, progress, error, seconds, history, snapshot };
}

// ---------- measurement (the checker, never a model's own numbers) ----------
const eojeol = (s) => s.trim().split(/\s+/u).filter(Boolean).length;
const sentencesOf = (text, spec) => {
  const list = splitSentences(String(text || ""));
  return hasShortSentences(spec) ? splitAtEllipsis(list) : list;
};
// Reduplicated Korean sound/movement words (부릉부릉, 콩닥콩닥, 두리번두리번): a
// heuristic count, labelled as such.
const soundWords = (text) => [...new Set((String(text || "").match(/([가-힣]{2,3})\1/gu) || []))];
const unitOf = (spec, page) => (spec ? unitSpec(spec, unitKind(page)) : spec);
function measurePages(pages, specs, allowedNames) {
  const rows = pages.map((page, i) => {
    const ko = String(page.textKo ?? page.ko ?? ""),
      en = String(page.textEn ?? page.en ?? "");
    const koSpec = unitOf(specs.ko, page), enSpec = unitOf(specs.en, page);
    const kor = analyzeEstimatedPage(ko, koSpec, { language: "ko", allowedNames }),
      eng = en && enSpec ? analyzeEstimatedPage(en, enSpec, { language: "en", allowedNames }) : null;
    const sentences = sentencesOf(ko, koSpec),
      rhythm = new Set(kor.metrics?.rhythmSentenceIndices || []),
      lengths = sentences.map(eojeol),
      ordinary = lengths.filter((_, j) => !rhythm.has(j)),
      average = ordinary.length ? ordinary.reduce((a, b) => a + b, 0) / ordinary.length : 0;
    return {
      pageNo: page.pageNo ?? i + 1,
      kind: unitKind(page),
      ko,
      en,
      sentences: sentences.length,
      rhythm: rhythm.size,
      eojeol: lengths.reduce((a, b) => a + b, 0),
      average: Math.round(average * 10) / 10,
      longest: Math.max(0, ...lengths),
      quotes: sentences.filter((x) => /[“”"]/u.test(x)).length,
      exclaims: (ko.match(/!/gu) || []).length,
      sounds: soundWords(ko),
      koIssues: (kor.violations || []).map(describeReadingViolation),
      enIssues: (eng?.violations || []).map(describeReadingViolation),
      enWords: en ? en.trim().split(/\s+/u).filter(Boolean).length : 0,
    };
  });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const ordinaryCount = rows.reduce((a, r) => a + (r.sentences - r.rhythm), 0);
  const ordinaryEojeol = rows.reduce((a, r) => a + r.average * (r.sentences - r.rhythm), 0);
  return {
    rows,
    totals: {
      pages: rows.length,
      sentences: sum("sentences"),
      rhythm: sum("rhythm"),
      eojeol: sum("eojeol"),
      averageEojeol: ordinaryCount ? Math.round((ordinaryEojeol / ordinaryCount) * 10) / 10 : 0,
      longest: Math.max(0, ...rows.map((r) => r.longest)),
      quotes: sum("quotes"),
      exclaims: sum("exclaims"),
      soundWords: [...new Set(rows.flatMap((r) => r.sounds))],
      pagesWithSounds: rows.filter((r) => r.sounds.length).length,
      enWords: sum("enWords"),
      koIssuePages: rows.filter((r) => r.koIssues.length).length,
      enIssuePages: rows.filter((r) => r.enIssues.length).length,
    },
  };
}
function usageSummary(job) {
  const calls = job.usage?.calls || [];
  const budget = jobTextBudget(job);
  const stages = {};
  for (const row of calls) {
    const key = row.stage || row.kind || "?";
    const s = (stages[key] ||= { requests: 0, input: 0, output: 0, costUsd: 0 });
    s.requests += Number(row.requests ?? 1) || 0;
    s.input += Number(row.input) || 0;
    s.output += Number(row.output) || 0;
    s.costUsd += Number(row.costUsdEstimated ?? row.costUsd) || 0;
  }
  return {
    costUsd: budget.usedUsd,
    costUnknown: budget.usedUnknown,
    requests: Object.values(stages).reduce((a, s) => a + s.requests, 0),
    input: Object.values(stages).reduce((a, s) => a + s.input, 0),
    output: Object.values(stages).reduce((a, s) => a + s.output, 0),
    models: [...new Set(calls.map((r) => r.model).filter(Boolean))],
    stages,
  };
}
const SECRET = /apikey|api_key|secret|password|authorization|credential/iu;
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET.test(k)) out[k] = sanitize(v);
    return out;
  }
  return value;
}
const cell = (s) => String(s ?? "").replace(/\|/gu, "\\|").replace(/\n+/gu, " ");

function armReport(run, measured, usage) {
  const { arm, job, estimate, progress, error, seconds } = run;
  const o = job.outline || {};
  const lines = [];
  lines.push(`# ${level} · ${arm === "diet" ? "r31b 프롬프트 다이어트" : "r31a 프롬프트"} · ${o.titleCandidates?.[0] || "(줄거리 없음)"}`, "");
  lines.push(`- 요청: "${TOPIC}" · ${wizard.pageCount}쪽 · ${wizard.koreanLevel}/${wizard.englishLevel} · 재료 계획 ${job.planMode}${demo ? " · 데모 엔진" : ""}`);
  lines.push(`- 정책: ${["promptDiet", "k1Policy", "orchestrationPolicy", "councilPolicy", "arcPolicy", "topicEndingPolicy"].filter((k) => job.input?.[k]).join(", ") || "(없음)"}`);
  lines.push(`- 상태: ${job.status}${error ? ` · 중단: ${error.message}` : ""} · ${seconds}초`);
  lines.push(`- 실제 글 요금(토큰 실측 × 단가표): ${money(usage.costUsd)}${usage.costUnknown ? " (일부 단가 미상)" : ""} · 요청 ${usage.requests}회 · 입력 ${usage.input.toLocaleString()} / 출력 ${usage.output.toLocaleString()} 토큰${estimate ? ` · 추정 ${money(estimate.textUsd)}` : ""}`);
  if (usage.models.length) lines.push(`- 모델: ${usage.models.join(", ")}`);
  lines.push("", "| 단계 | 요청 | 입력 | 출력 | 요금 |", "| --- | --- | --- | --- | --- |");
  for (const [stage, s] of Object.entries(usage.stages)) lines.push(`| ${stage} | ${s.requests} | ${s.input.toLocaleString()} | ${s.output.toLocaleString()} | ${money(s.costUsd)} |`);
  lines.push("", "## 줄거리", "");
  if (o.logline) lines.push(`- 로그라인: ${o.logline}`);
  if (o.want) lines.push(`- 바람: ${o.want}`);
  if (o.problem) lines.push(`- 걸림돌: ${o.problem}`);
  if (o.twist) lines.push(`- 전환: ${o.twist}`);
  for (const b of o.beats || []) lines.push(`${b.index}. (${b.type}, ${b.settingKey}) ${b.summary}`);
  lines.push("", "## 원고", "", "| 쪽 | 한글 | 영어 |", "| --- | --- | --- |");
  for (const r of measured.rows) lines.push(`| ${r.pageNo} | ${cell(r.ko)} | ${cell(r.en)} |`);
  lines.push("", "## 실측 (검사기)", "", "| 쪽 | 문장 | 리듬 | 어절 | 평균 어절 | 최장 | 대사 문장 | ! | 소리말 | 한글 검사 | 영어 검사 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of measured.rows) lines.push(`| ${r.pageNo} | ${r.sentences} | ${r.rhythm} | ${r.eojeol} | ${r.average} | ${r.longest} | ${r.quotes} | ${r.exclaims} | ${r.sounds.join(" ") || "-"} | ${cell(r.koIssues.join(" / ")) || "통과"} | ${cell(r.enIssues.join(" / ")) || (r.en ? "통과" : "-")} |`);
  const t = measured.totals;
  lines.push("", `책 전체: ${t.pages}쪽 · 문장 ${t.sentences}(리듬 ${t.rhythm}) · 어절 ${t.eojeol} · 보통 문장 평균 ${t.averageEojeol}어절 · 최장 ${t.longest} · 대사 문장 ${t.quotes} · 느낌표 ${t.exclaims} · 반복형 소리말 ${t.soundWords.length}종/${t.pagesWithSounds}쪽 (${t.soundWords.join(" ") || "-"}) · 영어 ${t.enWords}단어 · 검사 걸린 쪽 한글 ${t.koIssuePages} / 영어 ${t.enIssuePages}`);
  const notes = [];
  if (job.writerReport) notes.push(`작가 리포트: ${cell(JSON.stringify(job.writerReport)).slice(0, 600)}`);
  if (job.revision) notes.push(`통독: ${cell(JSON.stringify(job.revision.report || job.revision)).slice(0, 600)}`);
  if (job.pageCoherence?.unresolved) notes.push(`사건 연결 미해결 ${job.pageCoherence.unresolved}곳`);
  for (const n of job.notes || []) notes.push(`메모: ${n}`);
  if (job.failure) notes.push(`실패 구조: ${cell(JSON.stringify(job.failure)).slice(0, 400)}`);
  if (notes.length) lines.push("", "## 작가·편집 메모", "", ...notes.map((n) => `- ${n}`));
  // R31c: the writer's own pages (K1) or paragraphs (K2+) before any check rewrote them.
  const original = run.snapshot?.prose;
  if (original?.pages?.length) {
    const changed = original.pages.filter((p, i) => String(p.ko) !== String(measured.rows[i]?.ko)).map((p) => p.pageNo);
    lines.push("", `## 작가 원문 (수정 전 · 바뀐 쪽 ${changed.length ? changed.join(", ") : "없음"})`, "", "| 쪽 | 한글 | 영어 |", "| --- | --- | --- |");
    for (const p of original.pages) lines.push(`| ${p.pageNo} | ${cell(p.ko)} | ${cell(p.en)} |`);
  } else if (original?.ko) {
    lines.push("", "## 작가 원문 (비트 문단, 수정 전)", "", ...String(original.ko).split(/\n\s*\n/u).map((para, i) => `${i + 1}. ${cell(para)}`));
  }
  if (run.history?.length) {
    lines.push("", "## 수정 기록 (쪽 나누기 단계의 검사 결과마다)", "");
    for (const h of run.history) lines.push(`- 요청 ${h.requests ?? "?"}회까지 · 걸린 쪽 [${h.failedPageNos.join(", ")}] · 위반 ${h.violations.length ? h.violations.join(" ") : "없음"} · 참고 ${h.notes}`);
  }
  lines.push("", "## 진행", "", ...progress.map((p) => `- ${p}`), "");
  return lines.join("\n");
}

function compareReport(results, golden) {
  const lines = [`# ${level} A/B · 같은 요청, 두 프롬프트`, "", `요청: "${TOPIC}" · ${wizard.pageCount}쪽 · ${demo ? "데모 엔진(배선 점검)" : "실제 모델"}`, ""];
  const cols = results.map((r) => ({ name: r.arm === "diet" ? "r31b 다이어트" : "r31a", m: r.measured.totals, u: r.usage, ok: !r.error }));
  if (golden) cols.push({ name: "Dola 골든(K1)", m: golden.totals, u: null, ok: true });
  lines.push(`| 항목 | ${cols.map((c) => c.name).join(" | ")} |`, `| --- | ${cols.map(() => "---").join(" | ")} |`);
  const row = (label, f) => lines.push(`| ${label} | ${cols.map((c) => f(c)).join(" | ")} |`);
  row("완료", (c) => (c.ok ? "예" : "중단"));
  row("실제 글 요금", (c) => (c.u ? money(c.u.costUsd) : "-"));
  row("요청 수", (c) => (c.u ? c.u.requests : "-"));
  row("쪽", (c) => c.m.pages);
  row("문장(리듬)", (c) => `${c.m.sentences} (${c.m.rhythm})`);
  row("어절", (c) => c.m.eojeol);
  row("보통 문장 평균 어절", (c) => c.m.averageEojeol);
  row("최장 문장 어절", (c) => c.m.longest);
  row("대사 문장 수", (c) => c.m.quotes);
  row("느낌표", (c) => c.m.exclaims);
  row("반복형 소리말 종/쪽", (c) => `${c.m.soundWords.length}/${c.m.pagesWithSounds}`);
  row("소리말", (c) => c.m.soundWords.join(" ") || "-");
  row("검사 걸린 쪽(한글/영어)", (c) => `${c.m.koIssuePages}/${c.m.enIssuePages}`);
  row("영어 단어", (c) => c.m.enWords);
  lines.push("", "## 쪽별 한글", "", `| 쪽 | ${cols.map((c) => c.name).join(" | ")} |`, `| --- | ${cols.map(() => "---").join(" | ")} |`);
  const pageCount = Math.max(...cols.map((c) => c.m.pages), ...results.map((r) => r.measured.rows.length));
  for (let i = 0; i < pageCount; i++)
    lines.push(`| ${i + 1} | ${results.map((r) => cell(r.measured.rows[i]?.ko || "")).concat(golden ? [cell(golden.rows[i]?.ko || "")] : []).join(" | ")} |`);
  lines.push("", "숫자는 모두 검사기 실측입니다. 재미·문맥은 원고를 읽고 판단합니다.", "");
  return lines.join("\n");
}

// Fail on missing local assets before purchasing material plans or a council.
await preloadQualityDataForNode();
const results = [];
for (const arm of arms) {
  const run = await runArm(arm);
  const input = run.job.input || {};
  const allowedNames = [...(input.characters || []).flatMap((c) => [c.name, c.nameEn]).filter(Boolean)];
  const measured = measurePages(run.job.pagination?.pages || [], input.specs || {}, allowedNames);
  const usage = usageSummary(run.job);
  results.push({ ...run, measured, usage });
  writeFileSync(resolve(outDir, `${level}-${arm}.md`), armReport(run, measured, usage));
  writeFileSync(
    resolve(outDir, `${level}-${arm}.json`),
    JSON.stringify(
      sanitize({
        level,
        arm,
        wizard,
        planMode: run.job.planMode,
        status: run.job.status,
        error: run.error ? String(run.error.message || run.error) : null,
        seconds: run.seconds,
        input: run.job.input,
        outline: run.job.outline,
        sceneBriefs: run.job.sceneBriefs,
        prose: run.job.prose,
        pagination: run.job.pagination,
        writerReport: run.job.writerReport,
        revision: run.job.revision,
        storyCheck: run.job.storyCheck,
        pageCoherence: run.job.pageCoherence,
        qualityCheckpoint: run.job.qualityCheckpoint,
        councilCheckpoint: run.job.councilCheckpoint,
        writerCheckpoint: run.job.writerCheckpoint,
        childGateCheckpoint: run.job.childGateCheckpoint,
        revisionCheckpoint: run.job.revisionCheckpoint,
        enrichmentCheckpoint: run.job.enrichmentCheckpoint,
        briefRepairs: run.job.briefRepairs,
        proseCoherence: run.job.proseCoherence,
        richnessCheck: run.job.richnessCheck,
        notes: run.job.notes,
        usage: run.job.usage,
        writerOriginal: run.snapshot?.prose || null,
        repairHistory: run.history,
        measured,
        usageSummary: usage,
        progress: run.progress,
      }),
      null,
      2,
    ),
  );
  log(`[${arm}] 저장: ${resolve(outDir, `${level}-${arm}.md`)} · 글 요금 ${money(usage.costUsd)}`);
}
let golden = null;
if (level === "K1") {
  const file = resolve(root, "story-quality/gold/golden_k1_pages.json");
  const specs = results.find((r) => r.job.input?.specs)?.job.input.specs;
  if (existsSync(file) && specs) {
    const gold = JSON.parse(readFileSync(file, "utf8"));
    golden = measurePages(gold.pages.map((p, i) => ({ pageNo: i + 1, textKo: p.ko, textEn: p.en || "" })), { ko: specs.ko }, ["유하", "해니", "Yuha", "Haeni"]);
  }
}
if (results.length > 1 || golden) writeFileSync(resolve(outDir, `${level}-compare.md`), compareReport(results, golden));
const total = results.reduce((a, r) => a + (r.usage.costUsd || 0), 0);
log(`끝 · ${results.length}편 · 실제 글 요금 합계 ${money(total)} · ${outDir}`);
process.exit(results.some((r) => r.error) ? 1 : 0);
