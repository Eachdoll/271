#!/usr/bin/env node
/**
 * Recovery used in the 2026-10-21 paid evaluation, after the headless
 * credential-forwarding bug. Refuses complete runs or failures without saved
 * pagination. Reuses all writing/reading/richness work and its usage ledger.
 * Calls only finalizeStoryPagination plus the native FULL AUTO text hold.
 *
 * node QA/r31b-ab/tools/resume-post-pagination.mjs K1 both QA/r31b-ab --paid
 * Environment credentials only. Historical outputs are archived once.
 * Measurement/report functions below are from aa28d88's original runner;
 * tools/summarize.mjs separately corrects per-unit spread validation offline.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedState } from "../../../dist/engine.js";
import { migrateWorldState } from "../../../dist/image-generation/world.js";
import { migrateReadingSettings } from "../../../dist/reading-ui.js";
import {
  createFullAutoJob,
  runFullAuto,
  estimateFullAutoCost,
} from "../../../dist/full-auto.js";
import { jobTextBudget } from "../../../dist/text-generation/models.js";
import {
  analyzeEstimatedPage,
  splitSentences,
} from "../../../dist/reading-checker.js";
import { describeReadingViolation } from "../../../dist/reading-messages.js";
import {
  splitAtEllipsis,
  hasShortSentences,
} from "../../../dist/short-sentences.js";

import {finalizeStoryPagination} from "../../../dist/story-generation/pipeline.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
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
  const savedPath=resolve(outDir, `${level}-${arm}.json`);
  if(!existsSync(savedPath))throw Error("저장된 실행 결과가 없어요. 새 원고를 구매하지 않았어요.");
  const saved=JSON.parse(readFileSync(savedPath,"utf8"));
  if(saved.status==="text-review"&&!saved.error)throw Error("이미 완료한 실행은 다시 구매하지 않아요.");
  if(!String(saved.error||"").includes("API 키 저장소")||!saved.pagination?.pages?.length)
    throw Error("이번 도구는 키 전달 오류 뒤 저장된 쪽의 마지막 검사만 이어갑니다.");
  const archive=resolve(outDir,"original-attempts");mkdirSync(archive,{recursive:true});
  for(const ext of ["json","md"]){const path=resolve(outDir,`${level}-${arm}.${ext}`),target=resolve(archive,`${level}-${arm}.${ext}`);if(existsSync(path)&&!existsSync(target))writeFileSync(target,readFileSync(path));}
  const state=setup();
  for(const [key,items] of [["characters",saved.input.characters||[]],["backgrounds",saved.input.backgrounds||[]]]){
    for(const item of items){const at=state[key].findIndex(row=>row.id===item.id);if(at>=0)state[key][at]={...state[key][at],...structuredClone(item)};else state[key].push(structuredClone(item));}
  }
  const job=createFullAutoJob(state,wizard,{allowNew:!selection,stopBefore:"text",planMode:saved.planMode||"auto",demo,councilReview:false});
  job.input=structuredClone(saved.input);job.bookId=job.input.bookId;
  for(const key of ["outline","sceneBriefs","prose","pagination","writerReport","revision","pageCoherence","storyCheck","notes","usage"])
    if(saved[key]!==undefined)job[key]=structuredClone(saved[key]);
  job.plan={characterIds:job.input.characters.map(c=>c.id),backgroundIds:job.input.backgrounds.map(b=>b.id),newCharacters:[],newBackgrounds:[]};
  job.wizard={...job.wizard,characterIds:[...job.plan.characterIds],backgroundIds:[...job.plan.backgroundIds]};
  job.completed=Object.fromEntries(["plan","input","outline","briefs","proseDraft","prose","enrichment","proseCoherence"].map(key=>[key,new Date().toISOString()]));
  const estimate=demo?null:estimateFullAutoCost(state,job.wizard,{job}),progress=[...(saved.progress||[])];
  const started=Date.now();let error=null;
  log(`[${arm}] 저장된 쪽에서 마지막 검사만 재개 · 기존 요청 ${saved.usageSummary?.requests||0}회 보존`);
  try{
    await runFullAuto(state,job,{credentials,buildBook,save:()=>true,operations:{repairPagination:finalizeStoryPagination},onProgress:p=>{const message=p.message||p.phase;if(message&&message!==progress.at(-1)){progress.push(message);log(`[${arm}] ${message}`);}}});
  }catch(e){error=e;log(`[${arm}] 재개 중단: ${e?.message||e}`);}
  const seconds=(saved.seconds||0)+Math.round((Date.now()-started)/1000);
  const resume={fromStatus:saved.status,fromError:saved.error,previousRequests:saved.usageSummary?.requests||0,previousCostUsd:saved.usageSummary?.costUsd||0,skippedPaidStages:["materials","outline","sceneBriefs","prose","readabilityRepairs","richnessRepairs"],credentialFix:"quality-gates cheap role retains credentialFor"};
  log(`[${arm}] ${error?"실패":"완료"} · ${job.status} · 기존 실행 포함 ${seconds}초`);
  return {arm,state,job,estimate,progress,error,seconds,resume};
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
function measurePages(pages, specs, allowedNames) {
  const rows = pages.map((page, i) => {
    const ko = String(page.textKo ?? page.ko ?? ""),
      en = String(page.textEn ?? page.en ?? "");
    const kor = analyzeEstimatedPage(ko, specs.ko, { language: "ko", allowedNames }),
      eng = en && specs.en ? analyzeEstimatedPage(en, specs.en, { language: "en", allowedNames }) : null;
    const sentences = sentencesOf(ko, specs.ko),
      rhythm = new Set(kor.metrics?.rhythmSentenceIndices || []),
      lengths = sentences.map(eojeol),
      ordinary = lengths.filter((_, j) => !rhythm.has(j)),
      average = ordinary.length ? ordinary.reduce((a, b) => a + b, 0) / ordinary.length : 0;
    return {
      pageNo: page.pageNo ?? i + 1,
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
        resume: run.resume,
        input: run.job.input,
        outline: run.job.outline,
        sceneBriefs: run.job.sceneBriefs,
        prose: run.job.prose,
        pagination: run.job.pagination,
        writerReport: run.job.writerReport,
        revision: run.job.revision,
        storyCheck: run.job.storyCheck,
        pageCoherence: run.job.pageCoherence,
        notes: run.job.notes,
        usage: run.job.usage,
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
