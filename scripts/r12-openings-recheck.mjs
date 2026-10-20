/**
 * R12-P2 read-only recheck of saved paid prose under the openings rules. Never
 * generates, rewrites or sends anything (fetch is disabled).
 *
 * Each saved beat paragraph is one opening, scored two ways:
 * - as a SPREAD (the whole paragraph, units.spread);
 * - as a PAIR (the paragraph split at the sentence boundary nearest half its
 *   characters, each half units.page) — the same split today's page book gets.
 * Reported per level pair (K2/E2, K3/E3, K4/E4) and text kind (rich, simplified):
 * - unit pass rates (Korean and English reading rules);
 * - per-opening richness block rates per language and per code (no scene briefs,
 *   so sensory/noun numbers are upper bounds);
 * - expected first-pass rewrites per book under TODAY's page rules (the same
 *   halves as a page book, v3 specs, legacy richness) and the NEW openings rules
 *   (a mixed book: first, middle and last openings spreads, the others pairs),
 *   per language and in total, the new count capped at 2 × openings.
 *
 * Usage: node scripts/r12-openings-recheck.mjs [out.json]   (default QA/r12-openings-recheck.json)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeEstimatedPage, splitSentences } from "../dist/reading-checker.js";
import { freezeReadingLevels } from "../dist/reading-levels.js";
import { unitSpec } from "../dist/book-layout.js";
import { checkRichness } from "../dist/story-generation/richness.js";

globalThis.fetch = () => {
  throw Error("Offline recheck: network is disabled.");
};
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = resolve(root, "story-quality/eval/trial-2026-10-17");
const FILES = [
  "sonnet55-r7-prose.jsonl",
  "sonnet55-r7-prose-condense.jsonl",
  "sonnet55-r7-prose-sonnetsimp.jsonl",
];
const output = resolve(root, process.argv[2] || "QA/r12-openings-recheck.json");
if (FILES.some((file) => resolve(dir, file) === output))
  throw Error("Output must not overwrite the paid source data.");
const NAMES = ["유하", "Yuha", "초록이", "Choroki", "누렁이", "Nureongi"];
const CAST = [
  { id: "yuha", name: "유하", nameEn: "Yuha" },
  { id: "c", name: "초록이", nameEn: "Choroki" },
  { id: "n", name: "누렁이", nameEn: "Nureongi" },
];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const pct = (part, whole) => (whole ? Math.round((1000 * part) / whole) / 10 : null);
const strip = (paragraph) =>
  paragraph.replace(/^\s*\[(?:비트|Beat)[^\]]*\]\s*/u, "").trim();
const paragraphs = (text) =>
  String(text || "")
    .split(/\n\s*\n/u)
    .map(strip)
    .filter(Boolean);
/** Split at the sentence boundary nearest half the characters (both halves non-empty). */
function halves(text) {
  const list = splitSentences(text);
  if (list.length < 2) return [text, ""];
  const total = list.join(" ").length;
  let best = 1,
    bestDistance = Infinity,
    seen = 0;
  for (let i = 1; i < list.length; i++) {
    seen += list[i - 1].length + 1;
    const distance = Math.abs(seen - total / 2);
    if (distance < bestDistance) [best, bestDistance] = [i, distance];
  }
  return [list.slice(0, best).join(" "), list.slice(best).join(" ")];
}

const sources = FILES.map((file) => {
  const bytes = readFileSync(resolve(dir, file));
  return {
    file,
    sha256: sha256(bytes),
    rows: bytes.toString("utf8").trim().split("\n").map(JSON.parse),
  };
});
const LEVELS = [
  ["K2", "E2"],
  ["K3", "E3"],
  ["K4", "E4"],
];
const KINDS = ["rich", "simplified"];

function readingPass(text, spec, kind, language) {
  return analyzeEstimatedPage(text, unitSpec(spec, kind), {
    language,
    allowedNames: NAMES,
  });
}
/** Entries of a mixed openings book: first, middle and last openings spreads. */
function mixedEntries(ko, en) {
  const count = ko.length,
    spreads = new Set([0, Math.floor((count * 2) / 3), count - 1]),
    out = [];
  for (let k = 0; k < count; k++) {
    if (spreads.has(k))
      out.push({ kind: "spread", side: "spread", openingNo: k + 1, beatIndex: k + 1, textKo: ko[k], textEn: en[k] });
    else {
      const [koA, koB] = halves(ko[k]),
        [enA, enB] = halves(en[k]);
      out.push(
        { kind: "page", side: "left", openingNo: k + 1, beatIndex: k + 1, textKo: koA, textEn: enA },
        { kind: "page", side: "right", openingNo: k + 1, beatIndex: k + 1, textKo: koB, textEn: enB },
      );
    }
  }
  return out.map((entry, index) => ({ ...entry, pageNo: index + 1, scene: { props: [] } }));
}

const result = {
  generatedBy: "scripts/r12-openings-recheck.mjs",
  paidCalls: 0,
  sources: sources.map(({ file, sha256: hash, rows }) => ({ file, sha256: hash, rows: rows.length })),
  method: [
    "One saved beat paragraph = one opening. SPREAD = the whole paragraph (units.spread); PAIR = the paragraph halved at the sentence boundary nearest half its characters (units.page each).",
    "Reading: analyzeEstimatedPage with unitSpec(v4 openings spec, kind); Korean uses the unit tolerances, English stays strict.",
    "Richness: checkRichness with the v4 openings specs (pooled per opening); no scene briefs, so sensory and noun rates are upper bounds.",
    "Expected rewrites: first-pass entries failing reading or richness (a failing entry costs one combined rewrite). TODAY = the same text as a page book (both halves of every paragraph as pages, v3 specs, legacy richness); NEW = a mixed openings book (first, middle and last openings spreads, the others pairs), capped at 2 × openings.",
  ],
  levels: {},
};

for (const [koLevel, enLevel] of LEVELS) {
  const v4 = freezeReadingLevels({ koreanLevel: koLevel, englishLevel: enLevel }, {}, { layout: "openings" }).specs,
    v3 = freezeReadingLevels({ koreanLevel: koLevel, englishLevel: enLevel }).specs;
  for (const textKind of KINDS) {
    const unit = {
        ko: { spread: [0, 0], page: [0, 0], pairBoth: [0, 0], codes: {} },
        en: { spread: [0, 0], page: [0, 0], pairBoth: [0, 0], codes: {} },
      },
      rich = {
        spread: { openings: 0, ko: {}, en: {}, koAny: 0, enAny: 0, either: 0 },
        pair: { openings: 0, ko: {}, en: {}, koAny: 0, enAny: 0, either: 0 },
      },
      rewrites = { books: 0, today: { ko: [], en: [], total: [] }, next: { ko: [], en: [], total: [], capped: [] } },
      seen = new Set();
    for (const { rows } of sources)
      for (const row of rows) {
        const ko = paragraphs(row.ko?.[textKind]),
          en = paragraphs(row.en?.[textKind]),
          count = Math.min(ko.length, en.length);
        if (!count) continue;
        const key = `${ko.join("\n")}\u0000${en.join("\n")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Unit reading pass rates.
        for (const [language, list] of [["ko", ko], ["en", en]])
          for (const text of list.slice(0, count)) {
            const spec = v4[language],
              spread = readingPass(text, spec, "spread", language);
            unit[language].spread[1]++;
            if (spread.passed) unit[language].spread[0]++;
            for (const v of spread.violations) unit[language].codes[`spread:${v.code}`] = (unit[language].codes[`spread:${v.code}`] || 0) + 1;
            const [a, b] = halves(text);
            if (!b) continue;
            const left = readingPass(a, spec, "page", language),
              right = readingPass(b, spec, "page", language);
            unit[language].page[1] += 2;
            unit[language].page[0] += Number(left.passed) + Number(right.passed);
            unit[language].pairBoth[1]++;
            if (left.passed && right.passed) unit[language].pairBoth[0]++;
            for (const v of [...left.violations, ...right.violations]) unit[language].codes[`page:${v.code}`] = (unit[language].codes[`page:${v.code}`] || 0) + 1;
          }
        // Per-opening richness, all spreads and all pairs.
        const input = { specs: v4, characters: CAST };
        const layouts = {
          spread: ko.slice(0, count).map((text, k) => ({ pageNo: k + 1, openingNo: k + 1, beatIndex: k + 1, kind: "spread", side: "spread", textKo: text, textEn: en[k], scene: { props: [] } })),
          pair: ko.slice(0, count).flatMap((text, k) => {
            const [koA, koB] = halves(text),
              [enA, enB] = halves(en[k]);
            return [
              { openingNo: k + 1, beatIndex: k + 1, kind: "page", side: "left", textKo: koA, textEn: enA, scene: { props: [] } },
              { openingNo: k + 1, beatIndex: k + 1, kind: "page", side: "right", textKo: koB, textEn: enB, scene: { props: [] } },
            ];
          }).map((entry, index) => ({ ...entry, pageNo: index + 1 })),
        };
        for (const [layout, entries] of Object.entries(layouts)) {
          const report = checkRichness({ pages: entries }, input, {}, []),
            tally = rich[layout];
          for (let k = 1; k <= count; k++) {
            tally.openings++;
            const pageNos = new Set(entries.filter((entry) => entry.openingNo === k).map((entry) => entry.pageNo));
            let either = false;
            for (const language of ["ko", "en"]) {
              const codes = new Set(report.issues.filter((issue) => issue.language === language && pageNos.has(issue.pageNo)).map((issue) => issue.code));
              for (const code of codes) tally[language][code] = (tally[language][code] || 0) + 1;
              if (codes.size) {
                tally[`${language}Any`]++;
                either = true;
              }
            }
            if (either) tally.either++;
          }
        }
        // Expected first-pass rewrites per book, today vs new.
        rewrites.books++;
        const todayPages = ko.slice(0, count).flatMap((text, k) => {
          const [koA, koB] = halves(text),
            [enA, enB] = halves(en[k]);
          return [
            { beatIndex: k + 1, textKo: koA, textEn: enA, scene: { props: [] } },
            { beatIndex: k + 1, textKo: koB, textEn: enB, scene: { props: [] } },
          ];
        }).map((page, index) => ({ ...page, pageNo: index + 1 }));
        const failing = (pages, specs, richInput) => {
          const report = checkRichness({ pages }, richInput, {}, []),
            perLanguage = { ko: new Set(), en: new Set() };
          for (const page of pages)
            for (const language of ["ko", "en"]) {
              const verdict = readingPass(language === "ko" ? page.textKo : page.textEn, specs[language], page.kind === "spread" ? "spread" : "page", language);
              if (!verdict.passed) perLanguage[language].add(page.pageNo);
            }
          for (const issue of report.issues) perLanguage[issue.language].add(issue.pageNo);
          return {
            ko: perLanguage.ko.size,
            en: perLanguage.en.size,
            total: new Set([...perLanguage.ko, ...perLanguage.en]).size,
          };
        };
        const today = failing(todayPages, v3, { specs: v3, characters: CAST }),
          next = failing(mixedEntries(ko.slice(0, count), en.slice(0, count)), v4, input);
        for (const language of ["ko", "en", "total"]) {
          rewrites.today[language].push(today[language]);
          rewrites.next[language].push(next[language]);
        }
        rewrites.next.capped.push(Math.min(next.total, 2 * count));
      }
    const mean = (list) => (list.length ? Math.round((10 * list.reduce((s, v) => s + v, 0)) / list.length) / 10 : null);
    const rates = (tally) => ({
      openings: tally.openings,
      koBlockedPercent: pct(tally.koAny, tally.openings),
      enBlockedPercent: pct(tally.enAny, tally.openings),
      eitherBlockedPercent: pct(tally.either, tally.openings),
      koByCodePercent: Object.fromEntries(Object.entries(tally.ko).map(([code, n]) => [code, pct(n, tally.openings)])),
      enByCodePercent: Object.fromEntries(Object.entries(tally.en).map(([code, n]) => [code, pct(n, tally.openings)])),
    });
    const fewer = {
      ko: mean(rewrites.next.ko) < mean(rewrites.today.ko),
      en: mean(rewrites.next.en) < mean(rewrites.today.en),
      total: mean(rewrites.next.capped) < mean(rewrites.today.total),
    };
    result.levels[`${koLevel}/${enLevel}/${textKind}`] = {
      paragraphs: unit.ko.spread[1],
      unitPassPercent: Object.fromEntries(
        ["ko", "en"].map((language) => [
          language,
          {
            spread: pct(...unit[language].spread),
            page: pct(...unit[language].page),
            pairBothPages: pct(...unit[language].pairBoth),
            violationsByUnitAndCode: unit[language].codes,
          },
        ]),
      ),
      richnessPerOpening: { spreads: rates(rich.spread), pairs: rates(rich.pair) },
      expectedRewritesPerBook: {
        books: rewrites.books,
        today: { ko: mean(rewrites.today.ko), en: mean(rewrites.today.en), total: mean(rewrites.today.total) },
        new: {
          ko: mean(rewrites.next.ko),
          en: mean(rewrites.next.en),
          total: mean(rewrites.next.total),
          totalCapped: mean(rewrites.next.capped),
        },
        newNeedsFewer: fewer,
      },
    };
  }
}
result.newNeedsFewerEverywhere = Object.values(result.levels).every(
  (row) => row.expectedRewritesPerBook.newNeedsFewer.ko && row.expectedRewritesPerBook.newNeedsFewer.en,
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
for (const [key, row] of Object.entries(result.levels))
  console.log(
    key,
    "ko spread/page/pair",
    row.unitPassPercent.ko.spread,
    row.unitPassPercent.ko.page,
    row.unitPassPercent.ko.pairBothPages,
    "| en",
    row.unitPassPercent.en.spread,
    row.unitPassPercent.en.page,
    "| rich either spread/pair",
    row.richnessPerOpening.spreads.eitherBlockedPercent,
    row.richnessPerOpening.pairs.eitherBlockedPercent,
    "| rewrites today",
    JSON.stringify(row.expectedRewritesPerBook.today),
    "new",
    JSON.stringify(row.expectedRewritesPerBook.new),
  );
console.log("new rules need fewer rewrites in both languages everywhere:", result.newNeedsFewerEverywhere);
