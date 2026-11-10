#!/usr/bin/env node
/**
 * R54 writers' room A/B — the same topic, the same materials, one run per text
 * engine (openai, anthropic), exactly as ③ makes a story today (작가실 on, the
 * text hold, no picture). Each run's rounds are captured in full — the twelve
 * premises, the panel's counts, the chosen premise, the three drafts, the
 * panel's reading, the rewrite notes, the English edition, the level polish,
 * the extraction — by recording the HTTP exchanges with the provider (the
 * request body and the answer body; headers are never kept). The final pages
 * are measured with the app's own deterministic checker and style report, and
 * the real cost is summed from the usage rows.
 *
 * PAID. Keys come from the environment only (OPENAI_API_KEY, ANTHROPIC_API_KEY)
 * and are handed to the pipeline's credential hook; nothing here prints or
 * writes a key, and every output file is scanned for key-shaped strings before
 * it is written.
 *
 *   node scripts/r54-room-ab.mjs QA/r54-room-ab --paid [--engines openai,anthropic]
 *   node scripts/r54-room-ab.mjs /tmp/ab --demo            (free: the demo engine, plumbing only)
 * R59 options (all with `=`): --topic=주제 (another topic), --weave=1..5 (run the room as an older
 * version froze it — 3 is the room before R59: three drafts), --premise-from=QA/…/anthropic.json
 * (take the chosen premise of a saved run: the premise round is not bought again, so two
 * versions are compared on the same premise).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preloadQualityDataForNode } from "./r31b-node-data.mjs";
import { seedState } from "../dist/engine.js";
import { migrateWorldState } from "../dist/image-generation/world.js";
import { migrateReadingSettings } from "../dist/reading-ui.js";
import { createFullAutoJob, runFullAuto, estimateFullAutoCost } from "../dist/full-auto.js";
import { jobTextBudget } from "../dist/text-generation/models.js";
import { getTextGenerationSettings } from "../dist/text-generation/settings-ui.js";
import { unitKind } from "../dist/book-layout.js";
import { pageReadingSpec } from "../dist/story-generation/checker.js";
import { hasPromptDiet } from "../dist/story-generation/prompt-diet.js";
import { buildStoryWords } from "../dist/story-reading-context.js";
import { analyzeEstimatedPage, splitSentences } from "../dist/reading-checker.js";
import { describeReadingViolation } from "../dist/reading-messages.js";
import { styleReport, styleSummaryLine } from "../dist/story-generation/style-report.js";
import { splitAtEllipsis, hasShortSentences } from "../dist/short-sentences.js";
import { ENGINE_MENU, attachWritersRoom, roomOutline, textLikeness, textWeave } from "../dist/story-generation/writers-room.js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2),
  flags = new Map(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")).map(([k, v]) => [k, v ?? true])),
  positional = args.filter((a) => !a.startsWith("--"));
const outDir = resolve(positional[0] || "QA/r54-room-ab"),
  demo = flags.has("demo"),
  paid = flags.has("paid"),
  engines = String(flags.get("engines") || "openai,anthropic").split(",").map((s) => s.trim()).filter(Boolean);
// R59: the topic, the room version and a saved premise can be fixed for a comparison.
const weaveFlag = [1, 2, 3, 4, 5].includes(Number(flags.get("weave"))) ? Number(flags.get("weave")) : null,
  premiseFrom = typeof flags.get("premise-from") === "string" ? resolve(flags.get("premise-from")) : null,
  savedRoom = premiseFrom ? JSON.parse(readFileSync(premiseFrom, "utf8")).room : null;
if (premiseFrom && !savedRoom?.premise) {
  console.error(`${premiseFrom}에 고른 전제가 없어요.`);
  process.exit(2);
}
if (!demo && !paid) {
  console.error("유료 실행입니다. 부모님 승인 뒤 --paid 를 붙여 주세요 (무료 배선 점검은 --demo).");
  process.exit(2);
}
const ENV_KEYS = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GOOGLE_API_KEY" };
const credentials = async (engine) => (ENV_KEYS[engine] && process.env[ENV_KEYS[engine]]) || null;
const KEY_SHAPE = /\b(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})/u;

// The same story for every engine: the parent's own stopped topic (2026-11-03).
const wizard = {
  characterIds: ["yuha", "mom"],
  backgroundIds: ["home", "forest"],
  topic: typeof flags.get("topic") === "string" && flags.get("topic").trim() ? flags.get("topic").trim() : "숲속에서 자꾸 숨는 아기 사슴",
  pageCount: 16,
  koreanLevel: "K2",
  englishLevel: "E2",
  value: "none",
  ending: "home",
  language: "bilingual",
  simpleFlow: true,
  allowNew: false,
};

const setup = (engine) => {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  state.settings.textGeneration = { ...getTextGenerationSettings(state), engine };
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

/* ---------- the exchanges: request and answer bodies, never headers ---------- */
function captureFetch(exchanges) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input?.url || "";
    const started = Date.now();
    const response = await original(input, options);
    if (!/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/u.test(url)) return response;
    let body = null;
    try {
      body = typeof options.body === "string" ? JSON.parse(options.body) : null;
    } catch {
      body = null;
    }
    const clone = response.clone();
    let answer = null;
    try {
      answer = await clone.text();
    } catch {
      answer = null;
    }
    exchanges.push({
      at: new Date(started).toISOString(),
      ms: Date.now() - started,
      url: url.replace(/\?.*$/u, ""),
      status: response.status,
      model: body?.model || null,
      request: body ? { model: body.model, system: body.system ?? body.instructions ?? body.messages?.find?.((m) => m.role === "system")?.content ?? null, messages: body.messages ?? body.input ?? null, temperature: body.temperature ?? null, max_tokens: body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens ?? null } : null,
      answer,
    });
    return response;
  };
  return () => {
    globalThis.fetch = original;
  };
}
/** The text of a provider answer (chat completions, responses, messages). */
function answerText(raw) {
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j.choices)) return j.choices.map((c) => c.message?.content ?? c.text ?? "").join("\n");
    if (Array.isArray(j.output)) return j.output.flatMap((o) => (o.content || []).map((c) => c.text || "")).join("\n");
    if (typeof j.output_text === "string") return j.output_text;
    if (Array.isArray(j.content)) return j.content.map((c) => c.text || "").join("\n");
    return raw;
  } catch {
    return raw;
  }
}

/* ---------- measurement (the checker, never a model's own numbers) ---------- */
const eojeol = (s) => s.trim().split(/\s+/u).filter(Boolean).length;
const sentencesOf = (text, spec) => {
  const list = splitSentences(String(text || ""));
  return hasShortSentences(spec) ? splitAtEllipsis(list) : list;
};
const soundWords = (text) => [...new Set((String(text || "").match(/([가-힣]{2,3})\1/gu) || []))];
function measurePages(pages, input, outline = null) {
  const specs = input?.specs || {},
    lean = hasPromptDiet(input),
    allowedNames = [...(input?.characters || []).flatMap((c) => [c.name, c.nameEn]).filter(Boolean)];
  let storyWords = [];
  try {
    storyWords = outline ? buildStoryWords(input, outline, [], { briefs: [], lean }) : [];
  } catch {
    storyWords = [];
  }
  const rows = pages.map((page, i) => {
    const ko = String(page.textKo ?? page.ko ?? ""),
      en = String(page.textEn ?? page.en ?? "");
    const koSpec = specs.ko ? pageReadingSpec(specs, "ko", page, { lean }) : null,
      enSpec = specs.en ? pageReadingSpec(specs, "en", page, { lean }) : null;
    const kor = analyzeEstimatedPage(ko, koSpec, { language: "ko", allowedNames, storyWords }),
      eng = en && enSpec ? analyzeEstimatedPage(en, enSpec, { language: "en", allowedNames, storyWords }) : null;
    const sentences = sentencesOf(ko, koSpec),
      lengths = sentences.map(eojeol),
      average = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
    return {
      pageNo: page.pageNo ?? i + 1,
      kind: unitKind(page),
      openingNo: page.openingNo ?? null,
      ko,
      en,
      sentences: sentences.length,
      enSentences: splitSentences(en).length,
      eojeol: lengths.reduce((a, b) => a + b, 0),
      average: Math.round(average * 10) / 10,
      longest: Math.max(0, ...lengths),
      quotes: sentences.filter((x) => /[“”"]/u.test(x)).length,
      exclaims: (ko.match(/!/gu) || []).length,
      questions: (ko.match(/\?/gu) || []).length,
      sounds: soundWords(ko),
      koIssues: (kor.violations || []).map(describeReadingViolation),
      enIssues: (eng?.violations || []).map(describeReadingViolation),
      koNotes: (kor.warnings || []).map(describeReadingViolation),
      enNotes: (eng?.warnings || []).map(describeReadingViolation),
      enWords: en ? en.trim().split(/\s+/u).filter(Boolean).length : 0,
    };
  });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return {
    rows,
    totals: {
      pages: rows.length,
      spreads: rows.filter((r) => r.kind === "spread").length,
      sentences: sum("sentences"),
      enSentences: sum("enSentences"),
      eojeol: sum("eojeol"),
      averageEojeol: rows.length ? Math.round((sum("eojeol") / Math.max(1, sum("sentences"))) * 10) / 10 : 0,
      longest: Math.max(0, ...rows.map((r) => r.longest)),
      quotes: sum("quotes"),
      exclaims: sum("exclaims"),
      questions: sum("questions"),
      soundWords: [...new Set(rows.flatMap((r) => r.sounds))],
      pagesWithSounds: rows.filter((r) => r.sounds.length).length,
      enWords: sum("enWords"),
      koIssuePages: rows.filter((r) => r.koIssues.length).length,
      enIssuePages: rows.filter((r) => r.enIssues.length).length,
      koNotePages: rows.filter((r) => r.koNotes.length).length,
      enNotePages: rows.filter((r) => r.enNotes.length).length,
    },
  };
}
/** Who appears where: the chosen cast by name on each page (never a model's count). */
function castCoverage(pages, input, extraNames = []) {
  // R54f: a new character with a drawer card is in input.characters too — count it once.
  const names = [...new Set([...(input?.characters || []).map((c) => c.name), ...extraNames].filter(Boolean))];
  return names.map((name) => ({ name, pages: pages.filter((p) => String(p.textKo ?? p.ko ?? "").includes(name)).map((p) => p.pageNo) }));
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
function writeSafe(path, text) {
  if (KEY_SHAPE.test(text)) throw Error(`키 모양의 문자열이 출력에 섞여 있어 ${path}를 쓰지 않았어요.`);
  writeFileSync(path, text);
}

/* ---------- one engine ---------- */
async function runEngine(engine) {
  const state = setup(engine);
  const job = createFullAutoJob(state, wizard, {
    allowNew: false,
    stopBefore: "text",
    planMode: "selection",
    demo,
    councilReview: false, // the room adopts the panel's first; nothing parks for a click
  });
  // R59 --weave: the job is frozen as that version of the room froze it (its requests are that version's).
  if (weaveFlag && job.input.writersRoom) {
    job.input.writersRoom = { ...job.input.writersRoom, weave: weaveFlag };
    if (weaveFlag < 4 && job.input.pictureRefs) job.input.pictureRefs = { version: 1 };
  }
  const estimate = demo ? null : estimateFullAutoCost(state, wizard, { job });
  log(`[${engine}] 시작 · 작가실 ${job.input.writersRoom?.version ? "켬" : "꺼짐"} · ${job.input.layoutPolicy?.kind === "openings" ? "펼침" : "낱쪽"} ${wizard.pageCount}쪽 · 추정 글 요금 ${estimate ? money(estimate.textUsd) : "무료(데모)"}`);
  const exchanges = [], progress = [];
  const restore = captureFetch(exchanges);
  const started = Date.now();
  let error = null;
  try {
    await runFullAuto(state, job, {
      // R59 --premise-from: the saved run's room record stands in for the premise round (no call, the same premise).
      ...(savedRoom ? { operations: { outline: async (input) => ({ data: attachWritersRoom(roomOutline(input, savedRoom), { record: savedRoom }), usage: { inputTokens: 0, outputTokens: 0, requests: 0 }, meta: { stage: "outline", requests: 0, roomOutline: true, premiseFrom: true } }) } } : {}),
      credentials,
      buildBook,
      save: () => true,
      onProgress: (p) => {
        const message = p.message || p.phase;
        if (message && message !== progress.at(-1)?.message) {
          progress.push({ at: Math.round((Date.now() - started) / 1000), stage: p.stage || null, message });
          log(`[${engine}] ${message}`);
        }
      },
    });
  } catch (e) {
    error = e;
    log(`[${engine}] 중단: ${e?.message || e}`);
  } finally {
    restore();
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  log(`[${engine}] ${error ? "실패" : "완료"} · ${job.status} · ${seconds}초 · 교신 ${exchanges.length}건`);
  const pages = job.pagination?.pages || [];
  const measured = pages.length ? measagePages(pages, job.input, job.outline) : null;
  const room = job.outline?.writersRoom || null,
    draft = job.roomDraft || null;
  const extraNames = (room?.premise?.cast || []).filter((c) => c?.isNew).map((c) => c.name);
  return {
    engine,
    state,
    job,
    estimate,
    progress,
    error: error ? String(error?.message || error) : null,
    seconds,
    exchanges: exchanges.map((x) => ({ ...x, text: answerText(x.answer) })),
    room,
    draft,
    pages,
    measured,
    spreadFit: job.spreadFit || null,
    pictureReading: job.pictureReading || null,
    roomWeave: job.roomWeave || null,
    roomPockets: job.roomPockets || null,
    roomSheets: job.roomSheets || null,
    roomLooks: job.roomDraft?.room?.looks || null,
    roomPlaces: job.roomPlaces || [],
    coverage: pages.length ? castCoverage(pages, job.input, extraNames) : [],
    style: pages.length ? styleReport(pages.map((p) => p.textKo), { names: [...(job.input.characters || []).map((c) => c.name), ...extraNames] }) : null,
    usage: usageSummary(job),
  };
}
const measagePages = measurePages;

/* ---------- reports ---------- */
const cell = (s) => String(s ?? "").replace(/\|/gu, "\\|").replace(/\n+/gu, " ");
const engineName = (id) => ENGINE_MENU.find((e) => e.id === id)?.name || id || "";
function engineReport(r) {
  const L = [];
  L.push(`# 작가실 A/B · ${r.engine} · ${wizard.topic}`, "");
  L.push(`- 결과: ${r.error ? `실패 — ${r.error}` : `완료 (${r.job.status})`} · ${r.seconds}초 · 교신 ${r.exchanges.length}건`);
  L.push(`- 모델: ${r.usage.models.join(", ") || "?"} · 실제 글 요금(토큰 실측 × 단가표): ${money(r.usage.costUsd)}${r.usage.costUnknown ? " (일부 단가 미상)" : ""} · 요청 ${r.usage.requests}회 · 입력 ${r.usage.input.toLocaleString()} / 출력 ${r.usage.output.toLocaleString()} 토큰`);
  if (r.estimate) L.push(`- 앱의 사전 추정: ${money(r.estimate.textUsd)}`);
  L.push("", "## 단계별 요금", "", "| 단계 | 요청 | 입력 | 출력 | 요금 |", "| --- | --- | --- | --- | --- |");
  for (const [k, s] of Object.entries(r.usage.stages)) L.push(`| ${k} | ${s.requests} | ${s.input.toLocaleString()} | ${s.output.toLocaleString()} | ${money(s.costUsd)} |`);
  if (r.room) {
    L.push("", "## 1부 · 전제 열두 개와 독자단", "");
    L.push(`- 걸러진 전제: ${r.room.dropped}개 (최근 책과 닮음)`);
    L.push("", "| # | 제목 | 한 줄 | 장치 | 웃음 | 웃음·궁금·또 |", "| --- | --- | --- | --- | --- | --- |");
    (r.room.premises || []).forEach((p, i) => {
      const row = (r.room.rows || []).find((x) => x.premise === i + 1) || {};
      L.push(`| ${i + 1} | ${cell(p.title)} | ${cell(p.line)} | ${cell(engineName(p.engine))} | ${cell(p.laugh)} | ${row.laughed ?? "-"}·${row.curious ?? "-"}·${row.again ?? "-"} |`);
    });
    L.push("", `- 독자단이 고른 셋: ${(r.room.pitches || []).map((p) => `'${p.title}'`).join(", ")} → 채택 ${r.room.chosen}번 '${r.room.premise?.title}'`);
    if (r.room.premise) {
      L.push(`- 채택 전제: ${cell(r.room.premise.line)} · 장치 ${engineName(r.room.premise.engine)} · 웃음: ${cell(r.room.premise.laugh)} · 그림: ${cell(r.room.premise.picture)}`);
      L.push(`- 인물: ${(r.room.premise.cast || []).map((c) => `${c.name}${c.isNew ? "(새)" : ""}${c.want ? ` — ${c.want}` : ""}`).join(" / ")}`);
    }
    L.push("", "### 결정 기록", "");
    for (const d of r.room.decisions || []) L.push(`- ${d.by} · ${d.kind}: ${cell(d.what)}${d.why ? ` — ${cell(d.why)}` : ""}`);
  }
  if (r.draft?.room) {
    const d = r.draft.room;
    L.push("", "## 2부 · 초고 셋, 독자단 읽기, 고쳐쓰기, 영어판", "");
    L.push(`- 초고: ${(d.drafts || []).map((x, i) => `${i + 1}. '${x.title}' ${x.pages}쪽`).join(" / ")}`);
    L.push(`- 독자단 읽기: ${(d.rows || []).map((x) => `${x.draft}번 웃음 ${x.laughed}·궁금 ${x.curious}·모름 ${x.lost}·또 ${x.again}${x.boredPages?.length ? ` 지루 ${x.boredPages.join(",")}쪽` : ""}${x.lostPages?.length ? ` 모름 ${x.lostPages.join(",")}쪽` : ""}`).join(" / ")} → ${d.chosen}번`);
    L.push(`- 고쳐쓰기 ${d.rewritten ? `함${d.rewriteChange ? ` (${d.rewriteChange.after}쪽 중 ${d.rewriteChange.changed}쪽 손봄)` : ""}` : d.rewriteSkipped ? "고칠 곳 없어 건너뜀" : "안 함"} · 영어판 ${d.english ? "씀" : "없음"} · 등급 참고 ${(d.levelNotes || []).length}건 → 다듬기 ${d.polished ? `함 (남은 ${(d.levelNotesAfter || []).length}건)` : "안 함"}`);
    if (d.notes) L.push("", "### 고쳐쓰기 메모 (독자단 반응을 정리한 것)", "", "```", d.notes, "```");
    if ((d.levelNotes || []).length) L.push("", "### 등급 참고", "", ...d.levelNotes.map((n) => `- ${cell(typeof n === "string" ? n : n.message || JSON.stringify(n))}`));
  }
  if (r.measured) {
    const t = r.measured.totals;
    L.push("", "## 3부 · 완성 글 실측 (앱 검사기)", "");
    L.push(`- 항목 ${t.pages}개(펼침면 ${t.spreads}) · 한글 문장 ${t.sentences} · 영어 문장 ${t.enSentences} · 어절 ${t.eojeol} · 문장당 ${t.averageEojeol}어절 · 가장 긴 문장 ${t.longest}어절`);
    L.push(`- 대화 문장 ${t.quotes} · 느낌표 ${t.exclaims} · 물음표 ${t.questions} · 소리말 ${t.soundWords.length}종(${t.soundWords.slice(0, 8).join(", ")}) ${t.pagesWithSounds}쪽 · 영어 ${t.enWords}단어`);
    L.push(`- 등급 위반 쪽: 한글 ${t.koIssuePages} / 영어 ${t.enIssuePages} · 참고 쪽: 한글 ${t.koNotePages} / 영어 ${t.enNotePages}`);
    if (r.style) L.push(`- 문체 실측: ${styleSummaryLine(r.style)}`);
    L.push(`- 인물 등장: ${r.coverage.map((c) => `${c.name} ${c.pages.length}쪽${c.pages.length ? ` (${c.pages.join(",")})` : ""}`).join(" · ")}`);
    const check = r.job.storyCheck;
    if (check) L.push(`- 이야기 검사: ${check.passed ? "통과" : "지적"} · 위반 ${(check.violations || []).length} · 참고 ${(check.warnings || []).length}${(check.violations || []).length ? ` — ${check.violations.slice(0, 5).map((v) => cell(v.message || v.type)).join(" / ")}` : ""}`);
    L.push("", "### 쪽별", "", "| 쪽 | 종류 | 문장 | 어절 | 한글 | 영어 | 지적 |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const p of r.measured.rows) L.push(`| ${p.pageNo} | ${p.kind}${p.openingNo ? ` ${p.openingNo}` : ""} | ${p.sentences}/${p.enSentences} | ${p.eojeol} | ${cell(p.ko)} | ${cell(p.en)} | ${cell([...p.koIssues, ...p.enIssues].join(" / "))} |`);
  }
  L.push("", "## 교신 전문 (요청 → 답)", "");
  r.exchanges.forEach((x, i) => {
    L.push(`### ${i + 1}. ${x.model || "?"} · ${x.status} · ${(x.ms / 1000).toFixed(1)}초`, "");
    const sys = typeof x.request?.system === "string" ? x.request.system : Array.isArray(x.request?.system) ? x.request.system.map((s) => s.text || "").join("\n") : "";
    const user = (Array.isArray(x.request?.messages) ? x.request.messages : []).filter((m) => m.role !== "system").map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text || "").join("\n") : "")).join("\n---\n");
    if (sys) L.push("<details><summary>system</summary>", "", "```", sys, "```", "", "</details>");
    if (user) L.push("<details><summary>user</summary>", "", "```", user, "```", "", "</details>");
    L.push("<details><summary>답</summary>", "", "```", String(x.text || "").slice(0, 60000), "```", "", "</details>", "");
  });
  return L.join("\n") + "\n";
}
function compareReport(results) {
  const L = ["# 작가실 A/B · 같은 주제, 두 엔진", "", `주제: ${wizard.topic} · 인물 ${wizard.characterIds.join(", ")} · 장소 ${wizard.backgroundIds.join(", ")} · K2·E2 두 권 · 16쪽 펼침`, ""];
  L.push("| 항목 | " + results.map((r) => r.engine).join(" | ") + " |", "| --- | " + results.map(() => "---").join(" | ") + " |");
  const row = (label, f) => L.push(`| ${label} | ${results.map((r) => cell(f(r))).join(" | ")} |`);
  row("결과", (r) => (r.error ? `실패 — ${r.error}` : `완료 · ${r.job.status}`));
  // R54f-2: every model the run actually called, in order (the writer first), not the usage rows' stage model.
  row("모델", (r) => [...new Set((r.exchanges || []).map((x) => x.model).filter(Boolean))].join(", ") || r.usage.models.join(", "));
  row("걸린 시간", (r) => `${r.seconds}초`);
  row("실제 글 요금", (r) => money(r.usage.costUsd));
  row("요청 수", (r) => r.usage.requests);
  row("입력/출력 토큰", (r) => `${r.usage.input.toLocaleString()} / ${r.usage.output.toLocaleString()}`);
  row("걸러진 전제", (r) => r.room?.dropped ?? "-");
  row("채택 전제", (r) => (r.room?.premise ? `'${r.room.premise.title}' · ${engineName(r.room.premise.engine)}` : "-"));
  row("초고 쪽수", (r) => (r.draft?.room?.drafts || []).map((d) => d.pages).join(" / ") || "-");
  row("독자단이 고른 초고", (r) => r.draft?.room?.chosen ?? "-");
  row("고쳐쓰기 / 영어판 / 다듬기", (r) => (r.draft?.room ? `${r.draft.room.rewritten ? `함${r.draft.room.rewriteChange ? ` (${r.draft.room.rewriteChange.changed}/${r.draft.room.rewriteChange.after}쪽)` : ""}` : r.draft.room.rewriteSkipped ? "건너뜀" : "안 함"} / ${r.draft.room.english ? "씀" : "없음"} / ${r.draft.room.polished ? "함" : "안 함"}` : "-"));
  row("전제의 폭 · 열두 개 (작은/여러 곳/여럿) → 보여 준 셋", (r) => (r.room?.scales ? `${["small", "journey", "ensemble"].map((k) => r.room.scales.filter((x) => x === k).length).join("/")} → ${(r.room.pitches || []).map((p) => ({ small: "작은", journey: "여러 곳", ensemble: "여럿" })[p.scale?.kind] || "?").join(" · ")}` : "-"));
  row("고른 전제 · 인물(새) / 장소(새) / 새 장소 카드", (r) => { const p = (r.room?.pitches || [])[(r.room?.chosen || 1) - 1]; return p?.scale ? `${p.scale.cast}명(${p.scale.newCast.length}) / ${p.scale.places}곳(${p.scale.newPlaces.length}) / ${(r.roomPlaces || []).map((b) => b.name).join(", ") || "없음"}` : "-"; });
  row("흐름 · 독자단이 고른 안 / 심고 거두기 메모", (r) => (r.draft?.room?.flowChosen ? `${(r.draft.room.treatments || []).length}안 중 ${r.draft.room.flowChosen}번 (끌림 ${(r.draft.room.flowRows || []).map((x) => x.pull).join("·") || "-"}) / ${((r.draft.room.treatments || [])[r.draft.room.flowChosen - 1]?.plants || []).length}개` : "-"));
  row("인물 노트 / 인물 사이 / 흐름에 맞춰 고침", (r) => (r.draft?.room?.castNotes ? `${r.draft.room.castNotes.length}명 / ${(r.draft.room.ties || []).length} / ${r.draft.room.castRevised ? "함" : "안 함"}` : "-"));
  row("복선 점검 · 거둔 것 / 놓기만 한 것 / 앞에 없이 나온 것", (r) => (r.draft?.room?.threads ? `${r.draft.room.threads.kept.length} / ${r.draft.room.threads.loose.length} / ${r.draft.room.threads.unplanted.length}` : "-"));
  row("펼침 표시 맞춤", (r) => (r.spreadFit ? `표시 ${r.spreadFit.marks} · ${r.spreadFit.fitted ? "맞음" : "못 맞춤"}` : "-"));
  // R59: counted from the Korean words (textWeave) — the English last-word count is shown only for a run that still made it.
  const text = (r) => r.roomWeave?.text || (r.draft?.pages ? textWeave(r.draft.pages, { cast: (r.room?.premise?.cast || []).map((c, i) => ({ id: `c${i}`, name: c.name })) }) : null);
  row("글 셈 · 인물이 글에 나온 쪽 (그림 메모에만 나온 쪽)", (r) => { const t = text(r); return t?.castText?.length ? t.castText.map((c) => `${c.name} ${c.pages.length}쪽${c.artOnly ? ` (+메모만 ${c.artOnly.length})` : ""}`).join(" · ") : "-"; });
  row("글 셈 · 조연이 글에 나온 쪽 / 전체", (r) => { const t = text(r); return t ? `${t.companions.length} / ${t.pages}` : "-"; });
  row("글 셈 · 끝 네 쪽 글에 처음 나오는 낱말 (*는 앞 그림 메모에 먼저)", (r) => { const t = text(r); return t ? `${t.lateWords.length}개${t.lateWords.length ? ` — ${t.lateWords.map((w) => `${w.word}${w.artFirst ? "*" : ""}(${w.page})`).join(", ")}` : ""}` : "-"; });
  row("글 셈 · 되풀이되는 짧은 줄 / 그림 메모 글자 ÷ 글 글자", (r) => { const t = text(r); return t ? `${t.refrains.length}줄${t.refrains.length ? ` (${t.refrains.map((x) => `${x.line} ${x.pages.join("·")}쪽`).join(", ")})` : ""} / ${t.artShare}` : "-"; });
  row("글 셈 · 흐름끼리 닮음 (2글자 자카드)", (r) => { const f = (r.draft?.room?.treatments || []).map((t) => t.flow); return f.length > 1 ? f.flatMap((a, i) => f.slice(i + 1).map((b) => textLikeness(a, b))).join(" · ") : "-"; });
  row("펼침 표시 · 고쳐쓰기 전 → 후 (앱이 되살린 수) / 글 자리를 받은 쪽", (r) => `${r.draft?.room?.spreadMarks ? `${r.draft.room.spreadMarks.before} → ${r.draft.room.spreadMarks.after} (${r.draft.room.spreadMarks.restored})` : "-"} / ${r.roomPockets ? `${r.roomPockets.placed}/${r.roomPockets.pages}` : "-"}`);
  // R60: the new cards' looks (from the cast notes) and the pages that decided their sheets.
  row("새 카드 · 생김새를 받은 인물/장소 · 시트를 살 쪽수(인물 who / 장소 넓은·중간)", (r) => `${r.roomLooks ? `${(r.roomLooks.cast || []).length}/${(r.roomLooks.places || []).length}` : "-"} · ${r.roomSheets ? [...(r.roomSheets.cast || []).map((c) => `인물 ${c.pages}쪽`), ...(r.roomSheets.places || []).map((c) => `장소 ${c.pages}쪽`)].join(", ") || "없음" : "-"}`);
  row("짜임 실측(옛 셈) · 되돌아온 것 / 한 쪽만 나온 인물 / 그림 메모", (r) => (r.roomWeave ? `${r.roomWeave.returning ? `${r.roomWeave.returning.length}개${r.roomWeave.returning.length ? ` (${r.roomWeave.returning.map((x) => `${x.prop} ${x.from}→${x.to}`).join(", ")})` : ""}` : "세지 않음"} / ${r.roomWeave.single.length}명 / ${r.roomWeave.artNotes}쪽` : "-"));
  row("그림 읽기 · 못 보는 것 / 다음 쪽까지 감출 것 / 물건의 글자", (r) => (r.pictureReading ? `${r.pictureReading.hidden}쪽 / ${r.pictureReading.holdBack}쪽 / ${r.pictureReading.lettering ?? 0}쪽` : "-"));
  row("등급 참고 (다듬기 전 → 후)", (r) => (r.draft?.room ? `${(r.draft.room.levelNotes || []).length} → ${(r.draft.room.levelNotesAfter || []).length}` : "-"));
  row("최종 항목(펼침면)", (r) => (r.measured ? `${r.measured.totals.pages} (${r.measured.totals.spreads})` : "-"));
  row("한글 문장 / 어절 / 문장당", (r) => (r.measured ? `${r.measured.totals.sentences} / ${r.measured.totals.eojeol} / ${r.measured.totals.averageEojeol}` : "-"));
  row("영어 문장 / 단어", (r) => (r.measured ? `${r.measured.totals.enSentences} / ${r.measured.totals.enWords}` : "-"));
  row("대화 / 느낌표 / 물음표", (r) => (r.measured ? `${r.measured.totals.quotes} / ${r.measured.totals.exclaims} / ${r.measured.totals.questions}` : "-"));
  row("소리말 종류 / 쪽", (r) => (r.measured ? `${r.measured.totals.soundWords.length} / ${r.measured.totals.pagesWithSounds}` : "-"));
  row("등급 위반 쪽 (한/영)", (r) => (r.measured ? `${r.measured.totals.koIssuePages} / ${r.measured.totals.enIssuePages}` : "-"));
  row("등급 참고 쪽 (한/영)", (r) => (r.measured ? `${r.measured.totals.koNotePages} / ${r.measured.totals.enNotePages}` : "-"));
  row("문체 실측", (r) => (r.style ? styleSummaryLine(r.style) : "-"));
  row("인물 등장 쪽수", (r) => r.coverage.map((c) => `${c.name} ${c.pages.length}`).join(" · ") || "-");
  row("이야기 검사", (r) => (r.job.storyCheck ? `${r.job.storyCheck.passed ? "통과" : "지적"} · 위반 ${(r.job.storyCheck.violations || []).length} · 참고 ${(r.job.storyCheck.warnings || []).length}` : "-"));
  L.push("", "## 완성 글 나란히", "");
  const max = Math.max(...results.map((r) => r.pages.length));
  L.push("| 쪽 | " + results.map((r) => r.engine).join(" | ") + " |", "| --- | " + results.map(() => "---").join(" | ") + " |");
  for (let i = 0; i < max; i++) L.push(`| ${i + 1} | ${results.map((r) => cell(r.pages[i]?.textKo || "")).join(" | ")} |`);
  L.push("", "| 쪽 | " + results.map((r) => r.engine + " (EN)").join(" | ") + " |", "| --- | " + results.map(() => "---").join(" | ") + " |");
  for (let i = 0; i < max; i++) L.push(`| ${i + 1} | ${results.map((r) => cell(r.pages[i]?.textEn || "")).join(" | ")} |`);
  return L.join("\n") + "\n";
}

/* ---------- main ---------- */
mkdirSync(outDir, { recursive: true });
await preloadQualityDataForNode();
const results = [];
for (const engine of engines) {
  if (!demo && !(await credentials(engine))) {
    log(`[${engine}] 키가 환경에 없어 건너뜀 (${ENV_KEYS[engine]})`);
    continue;
  }
  const r = await runEngine(engine);
  results.push(r);
  const json = sanitize({
    engine: r.engine,
    topic: wizard.topic,
    wizard,
    error: r.error,
    seconds: r.seconds,
    status: r.job.status,
    estimate: r.estimate,
    usage: r.usage,
    progress: r.progress,
    input: { layout: r.job.input.layoutPolicy?.kind || "pages", pageCount: r.job.input.pageCount, writersRoom: r.job.input.writersRoom || null },
    room: r.room,
    draft: r.draft,
    outline: r.job.outline,
    pagination: r.job.pagination,
    storyCheck: r.job.storyCheck,
    measured: r.measured,
    // R56 실측: these three were in compare.md only; the saved result carries them too.
    spreadFit: r.spreadFit,
    pictureReading: r.pictureReading,
    roomWeave: r.roomWeave,
    roomPockets: r.roomPockets,
    roomSheets: r.roomSheets,
    roomLooks: r.roomLooks,
    roomPlaces: r.roomPlaces,
    coverage: r.coverage,
    style: r.style,
    exchanges: r.exchanges,
  });
  writeSafe(resolve(outDir, `${engine}.json`), JSON.stringify(json, null, 1));
  writeSafe(resolve(outDir, `${engine}.md`), engineReport(r));
}
if (results.length) writeSafe(resolve(outDir, "compare.md"), compareReport(results));
log(`끝 · ${outDir}`);
