// R12-P0 legacy pin: the reader of page books, at 390px and 1280px.
// Records a sha256 of the reader dialog's markup and of its layout boxes for the
// first, second and last page of two books:
// - seed-dinosaur: the local sample book (engine.js generateBook: 12 pages, 'dual',
//   SVG pictures, no storyInput/readingLevelSnapshot/staging);
// - legacy-page-book-r12: tests/fixtures/legacy-page-book-r12.json, a generated K2/E2
//   16-page bilingual page book made at 5f8d2f7 (storyInput, readingLevelSnapshot,
//   staging, scene briefs, PNG pictures). It is written into the browser library
//   (localStorage "donghwa-workshop-v1", the served app's own seedState() plus this
//   book) before the app reads storage.
// Openings books (R12) must leave page books unchanged, so later phases run this with
// --check against the file written at 5f8d2f7.
// Layout boxes depend on the installed fonts: compare on the machine image that wrote the file.
// 사용: (cd dist && npx http-server -p 4960 -s .) & node scripts/r12-legacy-dom.mjs [기본주소] [결과 JSON] [--check]
// 환경변수: PLAYWRIGHT_MODULE(기본 playwright), CHROMIUM_PATH(선택, 브라우저 실행 파일)
// 유료 요청은 모두 막고 셉니다. 페이지 오류·유료 요청이 없어야 통과입니다.
import fs from "node:fs";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const check = args.includes("--check");
const [BASE = "http://127.0.0.1:4960/", OUT = "QA/r12-legacy-dom.json"] =
  args.filter((arg) => arg !== "--check");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const executablePath =
  process.env.CHROMIUM_PATH ||
  (fs.existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
const PAID =
  /api\.anthropic\.com|api\.openai\.com|generativelanguage|fal\.run|bfl\.ai/;
const LIBRARY_KEY = "donghwa-workshop-v1";
const FIXTURE = JSON.parse(
  fs.readFileSync(
    new URL("../tests/fixtures/legacy-page-book-r12.json", import.meta.url),
    "utf8",
  ),
);
/** The pinned books, in report order. `book` is written into the library first. */
const BOOKS = [
  { id: "seed-dinosaur" },
  { id: FIXTURE.id, book: FIXTURE, title: FIXTURE.title },
];
const sha = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
/** One key per book, width and page: what --check and the test compare. */
const pinsOf = (runs) =>
  Object.fromEntries(
    runs.flatMap((run) =>
      Object.entries(run.pages).map(([pageNo, row]) => [
        `${run.book}/${run.width}/${pageNo}`,
        { html: row.htmlSha256, layout: row.layoutSha256 },
      ]),
    ),
  );

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});
const report = { base: BASE, books: BOOKS.map((b) => b.id), runs: [] };
const problems = [];

/** Markup and boxes of the open reader dialog (one page). */
const capture = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector(".modal.reader");
    if (!dialog) return null;
    const box = (selector) => {
      const node = dialog.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect(),
        style = getComputedStyle(node);
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        font: style.fontSize,
        display: style.display,
      };
    };
    const own = dialog.getBoundingClientRect();
    return {
      // The focus ring follows requestAnimationFrame, not the markup.
      html: dialog.outerHTML,
      text: dialog.textContent,
      layout: {
        dialog: {
          x: Math.round(own.x),
          y: Math.round(own.y),
          w: Math.round(own.width),
          h: Math.round(own.height),
        },
        top: box(".reader-top"),
        picture: box(".reader-picture"),
        art: box(".reader-picture svg, .reader-picture img"),
        body: box(".reader-body"),
        ko: box(".reader-body .ko"),
        en: box(".reader-body .en"),
        pager: box(".reader-pagination"),
        options: box(".reader-play-options"),
        status: box(".reader-status"),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      },
    };
  });

/**
 * Writes the served app's own seed library plus `book` into storage, then reloads,
 * so the app reads it at start-up like a library saved on this device.
 */
async function seedLibrary(context, page, book) {
  const text = await page.evaluate(async (record) => {
    const { seedState } = await import(
      new URL("engine.js", location.href).href
    );
    const state = seedState();
    state.books = [record, ...state.books.filter((b) => b.id !== record.id)];
    return JSON.stringify(state);
  }, book);
  await context.addInitScript(
    ([key, value]) => {
      if (window.top === window) localStorage.setItem(key, value);
    },
    [LIBRARY_KEY, text],
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
}

async function run(spec, width) {
  const height = width < 500 ? 844 : 800;
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const result = {
    book: spec.id,
    width,
    height,
    pageErrors: [],
    paidRequests: [],
    pages: {},
  };
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  await page.route(PAID, (route) => {
    result.paidRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  if (spec.book) await seedLibrary(context, page, spec.book);
  await page
    .locator(`[data-action="open-book"][data-id="${spec.id}"]`)
    .first()
    .click();
  await page.waitForTimeout(400);
  await page
    .locator(`[data-action="read-book"][data-id="${spec.id}"]`)
    .first()
    .click();
  await page.locator(".modal.reader").waitFor();
  await page.waitForTimeout(400);
  const total = await page.evaluate(
    () =>
      Number(
        document
          .querySelector(".modal.reader .reader-top small")
          ?.textContent.match(/\/\s*(\d+)/)?.[1],
      ) || 0,
  );
  for (let index = 0; index < total; index++) {
    if ([0, 1, total - 1].includes(index)) {
      const shot = await capture(page);
      if (!shot)
        problems.push(`${spec.id}/${width}: no reader on page ${index + 1}`);
      else {
        if (spec.title && !shot.text.includes(spec.title))
          problems.push(`${spec.id}/${width}: the reader shows another book`);
        result.pages[index + 1] = {
          htmlSha256: sha(shot.html),
          layoutSha256: sha(shot.layout),
          layout: shot.layout,
        };
      }
    }
    if (index < total - 1) {
      await page.locator('.modal.reader [data-action="reader-next"]').click();
      await page.waitForTimeout(150);
    }
  }
  result.pageCount = total;
  if (spec.book && total !== spec.book.pages.length)
    problems.push(
      `${spec.id}/${width}: ${total} reader pages, the book has ${spec.book.pages.length}`,
    );
  if (result.pageErrors.length)
    problems.push(
      `${spec.id}/${width}: page errors ${result.pageErrors.join(" | ")}`,
    );
  if (result.paidRequests.length)
    problems.push(
      `${spec.id}/${width}: paid requests ${result.paidRequests.length}`,
    );
  await context.close();
  return result;
}

for (const spec of BOOKS)
  for (const width of [390, 1280]) report.runs.push(await run(spec, width));
await browser.close();

const pins = pinsOf(report.runs);
report.readerSha256 = sha(pins);
if (check) {
  const expected = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const before = pinsOf(expected.runs);
  for (const key of new Set([...Object.keys(before), ...Object.keys(pins)])) {
    if (before[key]?.html !== pins[key]?.html)
      problems.push(`${key}: reader markup changed`);
    if (before[key]?.layout !== pins[key]?.layout)
      problems.push(`${key}: reader layout changed`);
  }
  console.log(
    JSON.stringify(
      { readerSha256: report.readerSha256, expected: expected.readerSha256 },
      null,
      1,
    ),
  );
} else {
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n");
  console.log(`wrote ${OUT} · reader ${report.readerSha256}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
