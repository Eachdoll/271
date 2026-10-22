#!/usr/bin/env node
// Offline only: read saved outputs, rerun the deterministic book checker and
// regenerate the summary/comparison. Never loads credentials or a provider.
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {inspectStory} from "../../../dist/story-generation/pipeline.js";
import {unitKind, unitSpec} from "../../../dist/book-layout.js";
import {analyzeEstimatedPage} from "../../../dist/reading-checker.js";
import {describeReadingViolation} from "../../../dist/reading-messages.js";
import {buildStoryWords} from "../../../dist/story-reading-context.js";

const folder = new URL("../", import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, folder), "utf8"));
const cell = value => String(value ?? "").replace(/\|/gu, "\\|").replace(/\n+/gu, " ");
const runs = [];
for (const level of ["K1", "K2"]) for (const arm of ["r31a", "diet"]) {
  const data = read(`${level}-${arm}.json`);
  const pages = data.pagination?.pages || [];
  const checks = pages.length ? inspectStory(data.outline, data.pagination, data.input) : null;
  const usage = data.usageSummary;
  const calls = data.usage?.calls || [];
  const allowedNames = (data.input.characters || []).flatMap(character => [character.name, character.nameEn]).filter(Boolean);
  const storyWords = buildStoryWords(data.input, data.outline);
  // Match checkStory's frozen per-unit range. The original runner treats a
  // spread as one single page and can incorrectly reject its sentence count.
  const layoutAwareRows = pages.map(page => {
    const kind = unitKind(page);
    const check = language => analyzeEstimatedPage(page[language === "ko" ? "textKo" : "textEn"] || "", unitSpec(data.input.specs[language], kind), {language, allowedNames, storyWords});
    return {pageNo:page.pageNo, kind, koIssues:check("ko").violations.map(describeReadingViolation), enIssues:check("en").violations.map(describeReadingViolation)};
  });
  const uniqueCallIds = new Set(calls.map(row => row.callId));
  if (uniqueCallIds.size !== calls.length) throw Error(`${level}/${arm}: duplicate usage call IDs`);
  const stageCost = Object.values(usage.stages).reduce((sum, row) => sum + row.costUsd, 0);
  if (Math.abs(stageCost - usage.costUsd) > 1e-8) throw Error(`${level}/${arm}: cost sum mismatch`);
  runs.push({
    level, arm, status:data.status, error:data.error,
    workflowComplete:data.status === "text-review" && !data.error,
    seconds:data.seconds, requestedPrintedPages:data.wizard.pageCount,
    entries:pages.length, printedPages:pages.reduce((sum, page) => sum + (page.kind === "spread" ? 2 : 1), 0),
    measured:{...data.measured.totals, koIssuePages:layoutAwareRows.filter(row => row.koIssues.length).length, enIssuePages:layoutAwareRows.filter(row => row.enIssues.length).length},
    originalRunnerMeasured:data.measured.totals, layoutAwareRows, usage,
    fullBookChecks:checks,
    pageCoherence:data.pageCoherence || null,
    resume:data.resume || null,
    characters:(data.input.characters || []).map(({id,name,nameEn}) => ({id,name,nameEn})),
    backgrounds:(data.input.backgrounds || []).map(({id,name}) => ({id,name})),
    ending:pages.slice(-2).map(page => ({pageNo:page.pageNo, ko:page.textKo, en:page.textEn, scene:page.scene})),
    readingRepairMessages:(data.progress || []).filter(message => /차 수정.*쪽을 고치고/u.test(message)),
    richnessRepairMessages:(data.progress || []).filter(message => /쪽의 글 디테일/u.test(message)),
    sceneTimes:pages.map(page => ({pageNo:page.pageNo, timeOfDay:page.scene?.timeOfDay})),
    progress:data.progress,
  });
}

const summary = {
  date:"2026-10-21", topic:runs.length ? read("K1-r31a.json").input.topic : "",
  sourceCommit:"23ad38dfaf07330e37cdbd4cb719952b1b93867b",
  fixes:["a9af49502f830f367eac1615e6e931458f093cd4", "eb41ce4"],
  costMethod:"Reported token usage × app model price table. Not a provider invoice. Original failed-attempt usage is retained in resumed arms; archives must not be added again.",
  experimentLimitations:["One independently generated story per arm and level, no fixed sampling seed.", "Automatic material planning can choose different casts/backgrounds.", "K1 retained completed writing/repairs and resumed only post-pagination checks.", "K2 baseline retained materials; its original council was charged but not serialized by the original runner, so it was regenerated.", "Workflow completion is distinct from deterministic full-book validation passing.", "Original runner page counts are entries and its per-page validation ignores spread ranges. This summary recomputes violations with the app's unitSpec/unitKind and storyWords, without changing raw results.", "No paid images; final state is text review, before illustration."],
  runs, completed:runs.filter(run => run.workflowComplete).length,
  attempted:runs.length,
  totalCostUsdFromTokens:runs.reduce((sum, run) => sum + run.usage.costUsd, 0),
  totalRequests:runs.reduce((sum, run) => sum + run.usage.requests, 0),
};
writeFileSync(new URL("SUMMARY.json", folder), JSON.stringify(summary, null, 2) + "\n");

// K1's original runner table includes the separately measured Dola golden;
// retain it. Rebuild K2 after the baseline resumes, without another paid call.
const k2 = runs.filter(run => run.level === "K2");
const originals = [read("K2-r31a.json"), read("K2-diet.json")];
const lines = ["# K2 A/B · 같은 요청, 두 프롬프트", "", `요청: ${summary.topic} · 인쇄 12쪽 · 실제 모델`, "", "| 항목 | r31a | r31b 다이어트 |", "| --- | --- | --- |"];
const row = (label, get) => lines.push(`| ${label} | ${k2.map(get).map(cell).join(" | ")} |`);
row("글 검수까지 완료", run => run.workflowComplete ? "예" : `중단: ${run.error}`);
row("글 요금(토큰 × 앱 단가표)", run => `$${run.usage.costUsd.toFixed(6)}`);
row("요청 수", run => run.usage.requests);
row("시간(초, 재개 포함)", run => run.seconds);
row("인쇄 쪽 / 엔트리", run => `${run.printedPages} / ${run.entries}`);
row("한글 문장(리듬 포함)", run => `${run.measured.sentences} (${run.measured.rhythm})`);
row("어절", run => run.measured.eojeol);
row("보통 문장 평균 어절", run => run.measured.averageEojeol);
row("최장 문장 어절", run => run.measured.longest);
row("대사 문장 / 느낌표", run => `${run.measured.quotes} / ${run.measured.exclaims}`);
row("반복형 소리말 종 / 엔트리", run => `${run.measured.soundWords.length} / ${run.measured.pagesWithSounds}`);
row("반복형 소리말(휴리스틱)", run => run.measured.soundWords.join(" "));
row("쪽별 검사 지적(한글 / 영어)", run => `${run.measured.koIssuePages} / ${run.measured.enIssuePages}`);
row("영어 단어", run => run.measured.enWords);
row("책 전체 규칙 검사", run => run.fullBookChecks?.passed ? "통과" : "지적 남음");
lines.push("", "## 펼침별 원고", "", "| 펼침(인쇄쪽) | r31a 한글 | r31b 한글 |", "| --- | --- | --- |");
const openings = Math.max(...originals.flatMap(data => data.pagination?.pages?.map(page => page.openingNo || 1) || [1]));
for (let i=1; i<=openings; i++) lines.push(`| ${i} (${2*i-1}–${2*i}) | ${originals.map(data => cell((data.pagination?.pages || []).filter(page => page.openingNo === i).map(page => `[엔트리 ${page.pageNo}, ${page.kind}] ${page.textKo}`).join(" / "))).join(" | ")} |`);
lines.push("", "쪽별 검사와 책 전체 검사는 별개입니다. 펼침면은 한 엔트리가 인쇄 두 쪽을 차지합니다. 각 원고 JSON에 전체 규칙·사건 검사와 사용량이 있습니다.", "", "각 조건 1편이며 재료 자동 계획과 샘플링이 달라, 품질 우열이나 평균 절감률을 일반화할 수 없습니다.", "");
writeFileSync(new URL("K2-compare.md", folder), lines.join("\n"));
console.log(JSON.stringify({folder:fileURLToPath(folder), completed:summary.completed, totalCostUsdFromTokens:summary.totalCostUsdFromTokens, totalRequests:summary.totalRequests, runs:runs.map(({level,arm,status,printedPages,entries,usage,fullBookChecks}) => ({level,arm,status,printedPages,entries,costUsd:usage.costUsd,bookPassed:fullBookChecks?.passed}))}));
