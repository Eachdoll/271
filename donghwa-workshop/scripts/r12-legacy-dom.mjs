// R12-P0 legacy pin: the reader of a seed (page) book, at 390px and 1280px.
// Records a sha256 of the reader dialog's markup and of its layout boxes for the
// first, second and last page. Openings books (R12) must leave page books unchanged,
// so later phases run this with --check against the file written at 5f8d2f7.
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
const BOOK = "seed-dinosaur";
const sha = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});
const report = { base: BASE, book: BOOK, runs: [] };
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

async function run(width) {
  const height = width < 500 ? 844 : 800;
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const result = { width, height, pageErrors: [], paidRequests: [], pages: {} };
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  await page.route(PAID, (route) => {
    result.paidRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page
    .locator(`[data-action="open-book"][data-id="${BOOK}"]`)
    .first()
    .click();
  await page.waitForTimeout(400);
  await page
    .locator(`[data-action="read-book"][data-id="${BOOK}"]`)
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
      if (!shot) problems.push(`${width}: no reader on page ${index + 1}`);
      else
        result.pages[index + 1] = {
          htmlSha256: sha(shot.html),
          layoutSha256: sha(shot.layout),
          layout: shot.layout,
        };
    }
    if (index < total - 1) {
      await page.locator('.modal.reader [data-action="reader-next"]').click();
      await page.waitForTimeout(150);
    }
  }
  result.pageCount = total;
  if (result.pageErrors.length)
    problems.push(`${width}: page errors ${result.pageErrors.join(" | ")}`);
  if (result.paidRequests.length)
    problems.push(`${width}: paid requests ${result.paidRequests.length}`);
  await context.close();
  return result;
}

for (const width of [390, 1280]) report.runs.push(await run(width));
await browser.close();

const pins = Object.fromEntries(
  report.runs.flatMap((run) =>
    Object.entries(run.pages).map(([pageNo, row]) => [
      `${run.width}/${pageNo}`,
      { html: row.htmlSha256, layout: row.layoutSha256 },
    ]),
  ),
);
report.readerSha256 = sha(pins);
if (check) {
  const expected = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const before = Object.fromEntries(
    expected.runs.flatMap((run) =>
      Object.entries(run.pages).map(([pageNo, row]) => [
        `${run.width}/${pageNo}`,
        { html: row.htmlSha256, layout: row.layoutSha256 },
      ]),
    ),
  );
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
