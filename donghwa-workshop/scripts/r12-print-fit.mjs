// R12-P7 print fit of openings books (펼침 구성), measured in Chromium. Offline:
// the print HTML is built here and loaded with setContent (no server, no network).
// Fixtures use 7+ eojeol per Korean sentence:
// - single (A4 가로 한 장에 펼침 하나): K2 12×7, 15×7 and 17×7; K3 15×10;
//   K2+E2 15 sentences (bilingual); K2+E3 (bilingual);
// - 크게 읽기 (A4 세로 한 장에 한 쪽): K4 16×13 and K4+E4 (bilingual).
// Each case: every leaf has the same font size at or above the level floor; the
// print button is enabled; a spread's art is never lower than single-page art;
// the two halves of a spread are top-aligned and meet at the fold (±0.5mm);
// folios run 2k−1, 2k; the 390px preview has no horizontal scroll.
// 사용: node scripts/r12-print-fit.mjs [결과 JSON]   (기본 QA/r12-print-fit.json)
// 환경변수: PLAYWRIGHT_MODULE(기본 playwright), CHROMIUM_PATH(선택)
import fs from "node:fs";
import path from "node:path";
import { getPrintHTML } from "../dist/output.js";
import { freezeReadingLevels } from "../dist/reading-levels.js";
import { openingsLayoutPolicy, layoutOf, printedPagesOf } from "../dist/book-layout.js";

const OUT = process.argv[2] || "QA/r12-print-fit.json";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const executablePath =
  process.env.CHROMIUM_PATH ||
  (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const FLOORS = { K2: 14, K3: 13, K4: 12 };
const svg = (width, height, hue) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="hsl(${hue},40%,85%)"/><circle cx="${width * 0.3}" cy="${height * 0.5}" r="${height * 0.3}" fill="hsl(${hue},45%,60%)"/><rect x="${width / 2 - 2}" y="0" width="4" height="${height}" fill="#c33"/></svg>`)}`;
const WORDS = "유하가 작은 숲길에서 노란 잎을 손으로 살짝 집어 바람에 날려 보내요 그리고 다시 웃어요".split(" ");
/** n Korean sentences of `eojeol` eojeol each. */
const koText = (n, eojeol, seed = 0) =>
  Array.from({ length: n }, (_, i) =>
    `${Array.from({ length: eojeol - 1 }, (_, k) => WORDS[(i + k + seed) % WORDS.length]).join(" ")} 봐요.`,
  ).join(" ");
const EN_WORDS = "Yuha finds a small yellow leaf on the quiet forest path and lifts it up to the bright warm sky again".split(" ");
const enText = (n, words, seed = 0) =>
  Array.from({ length: n }, (_, i) =>
    `${Array.from({ length: words - 1 }, (_, k) => EN_WORDS[(i + k + seed) % EN_WORDS.length]).join(" ")} today.`.replace(/^./u, (c) => c.toUpperCase()),
  ).join(" ");

/**
 * An openings book of 8 openings: openings 1, 4 and 8 are spreads with `spread`
 * Korean sentences, the others pairs of `page` sentences each; English text
 * (when `en`) as [sentences per spread, sentences per page, words per sentence].
 */
function fixtureBook({ ko, enLevel, spread, page, eojeol, en, language }) {
  const specs = freezeReadingLevels({ koreanLevel: ko, englishLevel: enLevel }, {}, { layout: "openings" }).specs;
  const pages = [];
  let pageNo = 0;
  for (let k = 1; k <= 8; k++) {
    const kind = [1, 4, 8].includes(k) ? "spread" : "page",
      sides = kind === "spread" ? ["spread"] : ["left", "right"];
    for (const side of sides) {
      pageNo++;
      const count = kind === "spread" ? spread : page,
        textKo = koText(count, eojeol, k + pageNo),
        textEn = en ? enText(kind === "spread" ? en[0] : en[1], en[2], k) : "Yuha looks.";
      pages.push({
        pageNo,
        beatIndex: k,
        kind,
        side,
        openingNo: k,
        entryId: `b${k}-${side}`,
        cue: kind === "spread" ? "highlight" : "two-moments",
        ko: textKo,
        en: textEn,
        textKo,
        textEn,
        imageUrl: kind === "spread" ? svg(2048, 880, k * 40) : svg(1536, 1024, k * 40 + 20),
        scene: { action: "Yuha walks.", who: [], where: "forest", props: [] },
      });
    }
  }
  const book = {
    id: `fit-${ko}-${spread}x${eojeol}`,
    title: "펼침 인쇄 시험",
    titleEn: "Openings print test",
    language,
    series: "시험",
    episode: 1,
    characterIds: [],
    pages,
    cover: { imageUrl: svg(1536, 1024, 200) },
    storyInput: { pageCount: 16, layoutPolicy: openingsLayoutPolicy(), specs },
    outline: { beats: Array.from({ length: 8 }, (_, i) => ({ index: i + 1 })) },
  };
  if (layoutOf(book) !== "openings" || printedPagesOf(book) !== 16) throw Error("fixture is not a 16-page openings book");
  return book;
}
const CASES = [
  { name: "single K2 12×7", layout: "single", ko: "K2", enLevel: "E2", spread: 12, page: 6, eojeol: 7, language: "ko" },
  { name: "single K2 15×7", layout: "single", ko: "K2", enLevel: "E2", spread: 15, page: 7, eojeol: 7, language: "ko" },
  { name: "single K2 17×7", layout: "single", ko: "K2", enLevel: "E2", spread: 17, page: 9, eojeol: 7, language: "ko" },
  { name: "single K3 15×10", layout: "single", ko: "K3", enLevel: "E3", spread: 15, page: 7, eojeol: 10, language: "ko" },
  { name: "single K2+E2 15 sentences", layout: "single", ko: "K2", enLevel: "E2", spread: 15, page: 7, eojeol: 7, en: [4, 2, 9], language: "bilingual" },
  { name: "single K2+E3", layout: "single", ko: "K2", enLevel: "E3", spread: 12, page: 6, eojeol: 7, en: [8, 4, 12], language: "bilingual" },
  { name: "크게 읽기 K4 16×13", layout: "two", ko: "K4", enLevel: "E4", spread: 16, page: 8, eojeol: 13, language: "ko" },
  { name: "크게 읽기 K4+E4", layout: "two", ko: "K4", enLevel: "E4", spread: 16, page: 8, eojeol: 13, en: [16, 8, 14], language: "bilingual" },
];

const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] });
const report = { generatedBy: "scripts/r12-print-fit.mjs", cases: [], problems: [] };
for (const spec of CASES) {
  const book = fixtureBook(spec),
    html = getPrintHTML(book, { layout: spec.layout, language: spec.language, pages: "all" }, []);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.printReady, null, { timeout: 30000 });
  const measured = await page.evaluate(() => {
    const mm = 96 / 25.4,
      root = document.documentElement,
      leaves = [...document.querySelectorAll(".ob-leaf")],
      fonts = [...new Set(leaves.map((leaf) => parseFloat(getComputedStyle(leaf.querySelector(".ob-text")).fontSize) * 0.75))],
      overflow = leaves.filter((leaf) => {
        const text = leaf.querySelector(".ob-text");
        return text.scrollHeight > text.clientHeight + 1;
      }).length;
    // Single-page art at 100%: the content width of a page leaf × 2/3.
    const pageLeaf = document.querySelector(".ob-page"),
      row = pageLeaf?.querySelector(".ob-art-row")?.getBoundingClientRect(),
      singleArt = row ? (row.width * 2) / 3 / mm : null;
    const sheets = [...document.querySelectorAll(".ob-sheet")],
      byOpening = new Map();
    for (const sheet of sheets) {
      const key = sheet.dataset.opening;
      if (!byOpening.has(key)) byOpening.set(key, []);
      byOpening.get(key).push(...sheet.querySelectorAll(".ob-leaf"));
    }
    const openings = [...byOpening].map(([key, list]) => {
      const arts = list.map((leaf) => leaf.querySelector(".ob-art").getBoundingClientRect()),
        halves = list.every((leaf) => leaf.classList.contains("ob-half"));
      return {
        opening: Number(key),
        kind: halves ? "spread" : "pair",
        folios: list.map((leaf) => Number(leaf.querySelector(".ob-folio").textContent)),
        artHeightMm: Math.round((Math.min(...arts.map((a) => a.height)) / mm) * 10) / 10,
        scale: Number(getComputedStyle(list[0].closest(".ob-sheet")).getPropertyValue("--ob-scale")) || 1,
        // Single layout: the halves share one sheet; compare their tops and the fold edges.
        topDeltaMm: halves && list.length === 2 && list[0].closest(".ob-sheet") === list[1].closest(".ob-sheet") ? Math.round((Math.abs(arts[0].top - arts[1].top) / mm) * 100) / 100 : null,
        foldGapMm: halves && list.length === 2 && list[0].closest(".ob-sheet") === list[1].closest(".ob-sheet") ? Math.round((Math.abs(arts[1].left - arts[0].right) / mm) * 100) / 100 : null,
      };
    });
    return {
      ready: root.dataset.printReady,
      bookFont: Number(root.dataset.bookFont),
      floor: Number(root.dataset.fontFloor),
      fonts,
      overflow,
      printEnabled: !document.getElementById("print-now").disabled,
      singleArtMm: singleArt ? Math.round(singleArt * 10) / 10 : null,
      openings,
      sheets: document.querySelectorAll(".sheet").length,
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  measured.phoneOverflowX = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const row = { ...spec, ...measured, pageErrors: errors };
  report.cases.push(row);
  const problem = (message) => report.problems.push(`${spec.name}: ${message}`);
  if (errors.length) problem(`page errors ${errors.join(" | ")}`);
  if (measured.ready !== "ready" || !measured.printEnabled || measured.overflow) problem(`인쇄 준비 ${measured.ready}, 넘친 쪽 ${measured.overflow}`);
  if (measured.fonts.length !== 1) problem(`글자 크기가 여러 개예요: ${measured.fonts.join(", ")}`);
  if (measured.fonts[0] < FLOORS[spec.ko] - 0.01) problem(`글자 ${measured.fonts[0]}pt < ${FLOORS[spec.ko]}pt`);
  for (const opening of measured.openings) {
    const want = [2 * opening.opening - 1, 2 * opening.opening];
    if (JSON.stringify(opening.folios) !== JSON.stringify(want)) problem(`펼침 ${opening.opening} 쪽 번호 ${opening.folios}`);
    if (opening.kind === "spread" && measured.singleArtMm && opening.artHeightMm < measured.singleArtMm - 0.5 && spec.layout === "single")
      problem(`펼침 ${opening.opening} 펼침면 그림 ${opening.artHeightMm}mm < 낱쪽 ${measured.singleArtMm}mm`);
    if (opening.topDeltaMm != null && opening.topDeltaMm > 0.5) problem(`펼침 ${opening.opening} 위 맞춤 ${opening.topDeltaMm}mm`);
    if (opening.foldGapMm != null && opening.foldGapMm > 0.5) problem(`펼침 ${opening.opening} 접는 선 틈 ${opening.foldGapMm}mm`);
  }
  if (measured.phoneOverflowX > 1) problem(`390px 미리보기 가로 넘침 ${measured.phoneOverflowX}px`);
  await context.close();
}
await browser.close();
report.passed = report.problems.length === 0;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, problems: report.problems, cases: report.cases.map((c) => `${c.name}: ${c.bookFont}pt · scale ${[...new Set(c.openings.map((o) => o.scale))].join("/")} · spread ${Math.min(...c.openings.filter((o) => o.kind === "spread").map((o) => o.artHeightMm))}mm / page ${c.singleArtMm}mm`) }, null, 2));
process.exit(report.passed ? 0 : 1);
