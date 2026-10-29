// R47 글 자리 맞춤, measured in Chromium on a saved print or feedback HTML
// (인쇄 창의 '저용량 HTML 파일 저장'). Offline: the file is opened from disk.
// For every text pocket it reports the field's share, whether the words were
// moved under the picture (pocket-split: English below, pocket-spill: all
// below), and whether every Korean and English line is fully visible —
// in the field or under the picture. Passes when no line is cut, no text
// block under a picture overflows and no field is marked pocket-overflow.
// 사용: node scripts/r47-pocket-fit.mjs <피드백판.html> [결과 JSON]
// 환경변수: PLAYWRIGHT_MODULE(기본 playwright), CHROMIUM_PATH(선택)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = process.argv[2];
if (!FILE) {
  console.error("사용: node scripts/r47-pocket-fit.mjs <피드백판.html> [결과 JSON]");
  process.exit(2);
}
const OUT = process.argv[3] || "";
const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright"),
  chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(pathToFileURL(path.resolve(FILE)).href);
  await page.waitForFunction(() => document.documentElement.dataset.printReady || !document.querySelector(".ob-sheet"), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const report = await page.evaluate(() => {
    const visible = (el, box) => {
      if (!el || !el.textContent.trim() || getComputedStyle(el).display === "none") return null;
      const r = el.getBoundingClientRect();
      if (!r.height) return 0;
      return Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top)) / r.height;
    };
    const rows = [...document.querySelectorAll(".pocket-frame")].map((frame) => {
      const leaf = frame.closest("[data-leaf]") || frame.closest("article"),
        panel = frame.querySelector(":scope>.text-pocket"),
        inner = panel?.querySelector(".text-pocket-inner"),
        below = leaf?.querySelector(".ob-text"),
        mode = leaf?.classList.contains("pocket-spill") ? "spill" : leaf?.classList.contains("pocket-split") ? "split" : "field",
        innerBox = inner?.getBoundingClientRect(),
        belowBox = below?.getBoundingClientRect(),
        where = (lang) => {
          const inField = inner && getComputedStyle(panel).display !== "none" ? visible(inner.querySelector(`.${lang}`), innerBox) : null,
            under = below ? visible(below.querySelector(`.${lang}`), belowBox) : null;
          return inField ?? under;
        };
      return {
        page: leaf?.dataset.leaf || leaf?.getAttribute("aria-label") || "",
        side: panel?.dataset.pocket || "",
        share: frame.style.getPropertyValue("--pocket-share"),
        mode,
        ko: where("ko"),
        en: where("en"),
        belowOverflow: !!below && below.scrollHeight > below.clientHeight + 1,
        fieldOverflow: frame.classList.contains("pocket-overflow"),
      };
    });
    return { bookFont: document.documentElement.dataset.bookFont || "", printReady: document.documentElement.dataset.printReady || "", rows };
  });
  const cut = report.rows.filter((r) => (r.ko !== null && r.ko < 0.99) || (r.en !== null && r.en < 0.99) || r.belowOverflow || r.fieldOverflow);
  const summary = {
    file: path.basename(FILE),
    bookFont: report.bookFont,
    printReady: report.printReady,
    pockets: report.rows.length,
    split: report.rows.filter((r) => r.mode === "split").length,
    spill: report.rows.filter((r) => r.mode === "spill").length,
    cut: cut.length,
    pass: cut.length === 0,
  };
  console.table(report.rows);
  console.log(JSON.stringify(summary));
  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ summary, rows: report.rows }, null, 2));
  }
  process.exitCode = summary.pass ? 0 : 1;
} finally {
  await browser.close();
}
