// R12 openings (펼침 구성) in the real app. Free only: the demo text engine and
// the sample image engine; every non-local request is blocked and counted.
// - simple flow per case: ① topic + format (level, language, 12/16쪽) → ② → ③
//   데모로 체험 → ④ every entry (labels, cue chip, counter, ≤ 12 counted buttons)
//   → 모든 그림 만들기 (sample) → ⑤ → 책장에 저장 → detail labels;
// - pro flow per case (--pro): wizard ③ → story workflow (demo) → 줄거리 승인 →
//   전문 승인 → 쪽 나누기 checks → 쪽 승인 → picture editor → 확정 (sample) → book;
// - reader of each saved book at every viewport: the bar stays visible, every
//   word is in view after the follow, no horizontal scroll, the landscape-phone
//   spread picture is at least 600px wide, the spread hint on portrait phones.
// The openings test hook is set by default (P6); with --no-hook the build's own
// OPENINGS_ENABLED decides (P8).
// 사용: (cd dist && npx http-server -p 5301 -s .) & node scripts/r12-openings-browser.mjs [기본주소] [결과 JSON] [옵션]
// 옵션: --cases=K2-bilingual-16,K4-dual-12 --widths=1280,390 --viewports=390x844,844x390 --pro --no-hook --shots=폴더
// 환경변수: PLAYWRIGHT_MODULE(기본 playwright), CHROMIUM_PATH(선택)
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2),
  positional = args.filter((arg) => !arg.startsWith("--")),
  option = (name, fallback) => {
    const hit = args.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  },
  flag = (name) => args.includes(`--${name}`);
const [BASE = "http://127.0.0.1:5301/", OUT = "QA/r12-openings-browser.json"] = positional;
const CASES = option("cases", "K2-bilingual-16").split(",").filter(Boolean);
const WIDTHS = option("widths", "1280").split(",").map(Number).filter(Boolean);
const VIEWPORTS = option("viewports", "390x844,844x390,1024x768,768x1024,1280x800")
  .split(",")
  .filter(Boolean)
  .map((value) => value.split("x").map(Number));
const PRO = flag("pro"),
  HOOK = !flag("no-hook"),
  SHOTS = option("shots", "");
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const executablePath =
  process.env.CHROMIUM_PATH ||
  (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const LOCAL = /^(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/|data:|blob:)/u;
const LIBRARY_KEY = "donghwa-workshop-v1";
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});
const report = {
  base: BASE,
  hook: HOOK,
  generatedBy: "scripts/r12-openings-browser.mjs",
  cases: CASES,
  widths: WIDTHS,
  viewports: VIEWPORTS.map(([w, h]) => `${w}x${h}`),
  runs: [],
  problems: [],
};
const caseOf = (name) => {
  const [level, language, pages] = name.split("-");
  return {
    name,
    koreanLevel: level,
    englishLevel: { K2: "E2", K3: "E3", K4: "E4" }[level] || "E2",
    language,
    pageCount: Number(pages),
  };
};

async function openTab(width, height, label) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const tab = { label, width, height, pageErrors: [], blocked: [] };
  page.on("pageerror", (error) => tab.pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (LOCAL.test(url)) return route.continue();
    tab.blocked.push(url);
    return route.abort();
  });
  if (HOOK)
    await context.addInitScript(() => {
      window.__DONGHWA_R12_OPENINGS__ = true;
    });
  return { context, page, tab };
}
const sleep = (page, ms) => page.waitForTimeout(ms);
async function click(page, selector, wait = 300) {
  await page.locator(selector).first().click();
  await sleep(page, wait);
}
async function confirmIfAsked(page) {
  for (const id of ["#simple-confirm-yes", "#simple-choice-missing", "#simple-choice-all"]) {
    const node = page.locator(id);
    if (await node.isVisible().catch(() => false)) {
      await node.click();
      await sleep(page, 300);
      return id;
    }
  }
  return null;
}
async function seedLibrary(page, extra = {}) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  const library = await page.evaluate(async (settings) => {
    const { seedState } = await import(new URL("engine.js", location.href).href);
    const state = seedState();
    Object.assign(state.settings, settings);
    return JSON.stringify(state);
  }, { defaultKoreanLevel: "K2", defaultEnglishLevel: "E2", defaultLanguage: "bilingual", defaultPages: 12, ...extra });
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [LIBRARY_KEY, library]);
  await page.reload({ waitUntil: "networkidle" });
  await sleep(page, 400);
}
async function setPin(page) {
  await click(page, 'button[data-action="nav"][data-view="settings"]');
  if (await page.locator("#pin-form").count()) {
    await page.fill("#pin-form #pin", "1234");
    if (await page.locator("#pin-form #pin-confirm").count())
      await page.fill("#pin-form #pin-confirm", "1234");
    await page.click("#pin-form button[type=submit]");
    await sleep(page, 600);
  }
}
async function unlockIfAsked(page) {
  if (await page.locator("#pin-form").count()) {
    await page.fill("#pin-form #pin", "1234");
    if (await page.locator("#pin-form #pin-confirm").count())
      await page.fill("#pin-form #pin-confirm", "1234");
    await page.click("#pin-form button[type=submit]");
    await sleep(page, 600);
  }
}
const step = (page) =>
  page
    .locator(".simple-create")
    .getAttribute("data-simple-step")
    .then(Number)
    .catch(() => 0);
async function idle(page, timeout = 240000) {
  await page.waitForFunction(
    () => !document.querySelector(".simple-progress") && !document.querySelector('[data-simple-action="stop"]'),
    null,
    { timeout },
  );
  await sleep(page, 500);
}
const overflowX = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
/** Counted buttons of the simple screen (step links, page arrows and material cards excluded). */
const census = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".simple-create button")].filter(
      (b) =>
        b.offsetParent !== null &&
        !b.matches(".simple-card,[data-simple-nav],[data-action='toggle-ui-mode']"),
    ).length,
  );
const storedBook = (page, id) =>
  page.evaluate(
    ([key, bookId]) => {
      const state = JSON.parse(localStorage.getItem(key));
      const book = (state.books || []).find((b) => b.id === bookId);
      return book
        ? {
            id: book.id,
            entries: book.pages.length,
            kinds: book.pages.map((p) => p.kind || null),
            pictures: book.pages.filter((p) => p.imageAssetId).length,
            cover: !!book.cover?.imageAssetId,
            layoutPolicy: book.storyInput?.layoutPolicy?.kind || null,
            pageCount: book.storyInput?.pageCount,
            sizes: book.pages.map((p) => p.imageMeta?.size || p.imageMeta?.requestedSize || null),
          }
        : null;
    },
    [LIBRARY_KEY, id],
  );

/* ---------- the simple flow ---------- */
async function simpleFlow(spec, width) {
  const height = width < 500 ? 844 : 900;
  const { context, page, tab } = await openTab(width, height, `simple ${spec.name} ${width}`);
  const out = { flow: "simple", case: spec.name, width, steps: {}, tab };
  const problem = (message) => report.problems.push(`${tab.label}: ${message}`);
  try {
    await seedLibrary(page);
    await setPin(page);
    await click(page, 'button[data-action="nav"][data-view="create"]');
    await page.fill("#topic", "바람 피리 찾기");
    await click(page, '[data-simple-action="format"]');
    await page.selectOption("#simple-format-panel #language", spec.language);
    await sleep(page, 150);
    await page.selectOption("#simple-format-panel #koreanLevel", spec.koreanLevel);
    await sleep(page, 150);
    await page.selectOption("#simple-format-panel #englishLevel", spec.englishLevel).catch(() => {});
    await sleep(page, 150);
    out.steps.pageOptions = await page.evaluate(() =>
      [...document.querySelectorAll("#simple-format-panel #pageCount option")].map((o) => o.textContent),
    );
    await page.selectOption("#simple-format-panel #pageCount", String(spec.pageCount));
    await sleep(page, 200);
    out.steps.summary = await page.locator("#simple-format-summary").textContent();
    await click(page, '[data-simple-action="next"]');
    await click(page, '[data-simple-action="next"]');
    if ((await step(page)) !== 3) problem(`③로 가지 못했어요 (${await step(page)})`);
    out.steps.generateLines = await page.locator(".simple-costs").innerText().catch(() => "");
    out.steps.censusGenerate = await census(page);
    await shot(page, `${spec.name}-${width}-3`);
    await click(page, '[data-simple-action="start-demo"]', 500);
    await page.waitForSelector('.simple-create[data-simple-step="4"]', { timeout: 180000 });
    await sleep(page, 800);
    // ④ every entry.
    const entries = [];
    for (let guard = 0; guard < 40; guard++) {
      const row = await page.evaluate(() => ({
        pageNo: document.querySelector(".simple-page-no")?.textContent || "",
        cue: document.querySelector(".simple-cue")?.textContent || "",
        counter: document.querySelector(".simple-sentence-count")?.textContent || "",
        counterOff: !!document.querySelector(".simple-count-off"),
        mix: document.querySelector(".simple-openings-mix")?.innerText || "",
        emptyArt: document.querySelector(".simple-empty-art")?.className || "",
        pagers: document.querySelectorAll(".simple-pager").length,
        koLabel: document.querySelector('label[for="page-ko"]')?.textContent || "",
      }));
      row.census = await census(page);
      row.overflowX = await overflowX(page);
      entries.push(row);
      if (row.census > 12) problem(`④ ${row.pageNo} 버튼 ${row.census}개`);
      if (row.overflowX > 1) problem(`④ ${row.pageNo} 가로 넘침 ${row.overflowX}px`);
      const next = page.locator('.simple-pager:not(.simple-pager-bottom) [data-simple-action="page-next"]');
      if (await next.isDisabled()) break;
      await next.click();
      await sleep(page, 200);
    }
    out.steps.review = { entries: entries.length, first: entries[0], last: entries.at(-1), census: [...new Set(entries.map((e) => e.census))] };
    out.steps.reviewRows = entries.map((e) => `${e.pageNo} | ${e.cue} | ${e.counter}${e.counterOff ? " (밖)" : ""}`);
    await shot(page, `${spec.name}-${width}-4`);
    // 모든 그림 만들기 (sample pictures).
    await click(page, '[data-simple-action="draw-all"]', 500);
    out.steps.drawConfirm = await confirmIfAsked(page);
    await idle(page);
    out.steps.imageCount = await page.locator("#simple-image-count").textContent().catch(() => "");
    await shot(page, `${spec.name}-${width}-4-drawn`);
    // ⑤ and save.
    await click(page, '[data-simple-action="to-finish"]', 500);
    if ((await step(page)) !== 5) problem("⑤로 가지 못했어요");
    out.steps.finishSummary = await page.locator(".simple-openings-summary").textContent().catch(() => "");
    out.steps.censusFinish = await census(page);
    await shot(page, `${spec.name}-${width}-5`);
    await click(page, '[data-simple-action="save-book"]', 600);
    out.steps.saveConfirm = await confirmIfAsked(page);
    await page.waitForSelector(".detail-layout", { timeout: 240000 });
    await sleep(page, 600);
    out.steps.detail = await page.locator(".detail-info .metadata").innerText().catch(() => "");
    out.bookId = await page.locator('[data-action="read-book"]').first().getAttribute("data-id");
    out.book = await storedBook(page, out.bookId);
    out.library = await page.evaluate(() => localStorage.getItem("donghwa-workshop-v1"));
    // Checks: the case's own expectations.
    const want = spec.pageCount / 2;
    if (!out.steps.pageOptions?.some((label) => /펼침/u.test(label)))
      problem(`쪽 수 선택에 펼침 안내가 없어요: ${out.steps.pageOptions.join(", ")}`);
    if (!/그림 \d+~\d+장 \+ 표지/u.test(out.steps.generateLines)) problem(`③ 그림 범위 줄이 없어요: ${out.steps.generateLines}`);
    if (!new RegExp(`펼침 ${want}개 · 펼침면 \\d+ · 낱쪽 \\d+ → 그림 \\d+장 \\+ 표지`, "u").test(entries[0]?.mix || ""))
      problem(`④ 요약 줄: ${entries[0]?.mix}`);
    if (!out.book || out.book.layoutPolicy !== "openings" || out.book.pictures !== out.book.entries || !out.book.cover)
      problem(`저장한 책: ${JSON.stringify(out.book)}`);
    if (!new RegExp(`${spec.pageCount}쪽 · 펼침 ${want}개 · 그림 ${out.book?.entries}장`, "u").test(out.steps.detail))
      problem(`상세 표시: ${out.steps.detail}`);
    if (!new RegExp(`${spec.pageCount}쪽 · 펼침 ${want}개 · 그림 ${out.book?.entries}장 \\+ 표지`, "u").test(out.steps.finishSummary || ""))
      problem(`⑤ 표시: ${out.steps.finishSummary}`);
  } catch (error) {
    problem(`흐름 오류: ${error.message.split("\n")[0]}`);
    await shot(page, `${spec.name}-${width}-error`).catch(() => {});
  }
  return { out, context, page };
}

/* ---------- the pro flow ---------- */
async function proFlow(spec, width) {
  const height = width < 500 ? 844 : 900;
  const { context, page, tab } = await openTab(width, height, `pro ${spec.name} ${width}`);
  const out = { flow: "pro", case: spec.name, width, steps: {}, tab };
  const problem = (message) => report.problems.push(`${tab.label}: ${message}`);
  const storyAction = async (action, wait = 600) => {
    await page.locator(`[data-story-action="${action}"]`).first().click();
    await sleep(page, wait);
  };
  const waitStory = async (selector, timeout = 120000) =>
    page.waitForSelector(selector, { timeout });
  try {
    await seedLibrary(page);
    await setPin(page);
    await click(page, '[data-action="toggle-ui-mode"]');
    await page.reload({ waitUntil: "networkidle" });
    await sleep(page, 300);
    await click(page, 'button[data-action="nav"][data-view="create"]');
    await unlockIfAsked(page);
    await click(page, '[data-action="wizard-next"]');
    await page.fill("#topic", "바람 피리 찾기");
    await click(page, '[data-action="wizard-next"]');
    await page.selectOption("#language", spec.language).catch(() => {});
    await sleep(page, 150);
    await page.selectOption("#koreanLevel", spec.koreanLevel);
    await sleep(page, 150);
    await page.selectOption("#englishLevel", spec.englishLevel).catch(() => {});
    await sleep(page, 150);
    await page.selectOption("#pageCount", String(spec.pageCount));
    await sleep(page, 150);
    out.steps.pageOptions = await page.evaluate(() => [...document.querySelectorAll("#pageCount option")].map((o) => o.textContent));
    await click(page, '[data-action="wizard-next"]');
    await click(page, '.full-auto-launcher [data-action="wizard-next"]', 800);
    await shot(page, `pro-${spec.name}-${width}-launch`);
    await storyAction("start-demo", 1000);
    await waitStory('[data-story-action="approve-outline"]');
    out.steps.outlineIntro = await page.locator(".story-workspace .modal-intro").first().textContent().catch(() => "");
    out.steps.beatHeading = await page.locator(".story-beat-heading small").first().textContent().catch(() => "");
    await storyAction("approve-outline", 1200);
    await waitStory('[data-story-action="approve-prose"]', 180000);
    await storyAction("approve-prose", 1500);
    await waitStory('[data-story-action="approve-pages"]', 180000);
    await sleep(page, 500);
    out.steps.pagesIntro = await page.locator(".story-workspace .modal-intro").first().textContent().catch(() => "");
    out.steps.pagesScreen = await page.evaluate(() => ({
      countSelect: !!document.querySelector("#story-page-count"),
      split: document.querySelectorAll('[data-story-action="split-page"],[data-story-action="merge-page"],[data-story-action="fit-page-count"]').length,
      cards: [...document.querySelectorAll(".story-card-head strong")].slice(0, 3).map((n) => n.textContent),
      cues: document.querySelectorAll(".opening-cue").length,
      repaginate: !!document.querySelector('[data-story-action="repaginate"]'),
    }));
    out.steps.overflowPages = await overflowX(page);
    await shot(page, `pro-${spec.name}-${width}-pages`);
    const accept = page.locator("#story-accept-failures");
    if (await accept.count()) await accept.check();
    await storyAction("approve-pages", 1500);
    await page.waitForSelector(".editor-text, .ig-editor-bar, .page-rail", { timeout: 180000 });
    await sleep(page, 600);
    out.steps.editorRail = await page.evaluate(() => [...document.querySelectorAll(".page-rail .page-thumb span")].slice(0, 3).map((n) => n.textContent));
    await shot(page, `pro-${spec.name}-${width}-editor`);
    // 확정: approve the book; the sample engine draws the missing pictures.
    await click(page, '[data-action="approve-draft"]', 800);
    out.steps.approveModal = await page.locator("#modal-root .notice").first().textContent().catch(() => "");
    const confirm = page.locator("#book-final-confirm");
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.waitForSelector(".detail-layout", { timeout: 300000 });
    await sleep(page, 800);
    out.steps.detail = await page.locator(".detail-info .metadata").innerText().catch(() => "");
    out.bookId = await page.locator('[data-action="read-book"]').first().getAttribute("data-id");
    out.book = await storedBook(page, out.bookId);
    out.library = await page.evaluate(() => localStorage.getItem("donghwa-workshop-v1"));
    const want = spec.pageCount / 2;
    if (out.steps.pagesScreen.countSelect || out.steps.pagesScreen.split) problem(`쪽 나누기 화면: ${JSON.stringify(out.steps.pagesScreen)}`);
    if (!new RegExp(`펼침 ${want}개 · ${spec.pageCount}쪽`, "u").test(out.steps.pagesIntro)) problem(`쪽 나누기 머리말: ${out.steps.pagesIntro}`);
    if (!out.book || out.book.layoutPolicy !== "openings" || out.book.pictures !== out.book.entries || !out.book.cover)
      problem(`저장한 책: ${JSON.stringify(out.book)}`);
    if (!new RegExp(`${spec.pageCount}쪽 · 펼침 ${want}개 · 그림 ${out.book?.entries}장`, "u").test(out.steps.detail)) problem(`상세 표시: ${out.steps.detail}`);
  } catch (error) {
    problem(`흐름 오류: ${error.message.split("\n")[0]}`);
    await shot(page, `pro-${spec.name}-${width}-error`).catch(() => {});
  }
  return { out, context, page };
}

/* ---------- the reader at every viewport ---------- */
/**
 * The reader of a saved book, in the tab that made it (its pictures live in that
 * tab's IndexedDB), resized to the viewport.
 */
async function readerCheck(page, bookId, [width, height], label) {
  const tab = { label: `reader ${label} ${width}x${height}`, pageErrors: [], blocked: [] };
  const out = { flow: "reader", book: label, viewport: `${width}x${height}`, entries: [], tab };
  const problem = (message) => report.problems.push(`${tab.label}: ${message}`);
  const errors = (error) => tab.pageErrors.push(error.message);
  page.on("pageerror", errors);
  try {
    await page.setViewportSize({ width, height });
    if (await page.locator(".modal.reader").count()) {
      await page.keyboard.press("Escape");
      await sleep(page, 300);
    }
    if (!(await page.locator(`[data-action="read-book"][data-id="${bookId}"]`).count())) {
      await click(page, 'button[data-action="nav"][data-view="library"]', 400);
      await click(page, `[data-action="open-book"][data-id="${bookId}"]`, 400);
    }
    await click(page, `[data-action="read-book"][data-id="${bookId}"]`, 600);
    out.pictures = await page.evaluate(() => document.querySelectorAll(".modal.reader .reader-picture img, .modal.reader .reader-picture svg").length);
    for (let guard = 0; guard < 40; guard++) {
      const row = await page.evaluate(() => {
        const modal = document.querySelector(".modal.reader"),
          bar = modal?.querySelector(".reader-pagination");
        if (!modal || !bar) return { missing: true };
        modal.scrollTop = 0;
        const visible = (rect) => rect.height > 0 && rect.top >= -1 && rect.bottom <= innerHeight + 1;
        const barAtTop = visible(bar.getBoundingClientRect());
        // The app's follow: scroll a word into view only when it is above the top or behind the bar.
        const follow = (el) => {
          const rect = el.getBoundingClientRect(),
            top = modal.getBoundingClientRect().top,
            bottom = bar.getBoundingClientRect().top;
          if (rect.top < top || rect.bottom > bottom) el.scrollIntoView({ block: "nearest" });
        };
        const words = [...modal.querySelectorAll("[data-reader-word]")];
        let hidden = 0,
          barHidden = 0;
        for (const el of words) {
          follow(el);
          const rect = el.getBoundingClientRect(),
            top = modal.getBoundingClientRect().top,
            bottom = bar.getBoundingClientRect().top;
          if (rect.top < top - 1 || rect.bottom > bottom + 1) hidden++;
          if (!visible(bar.getBoundingClientRect())) barHidden++;
        }
        modal.scrollTop = 0;
        const spread = modal.querySelector(".reader-spread .reader-picture"),
          picture = (spread || modal.querySelector(".reader-picture"))?.getBoundingClientRect(),
          hint = modal.querySelector(".reader-turn-hint");
        return {
          heading: modal.querySelector(".reader-top small")?.textContent || "",
          pager: bar.querySelector("span")?.textContent || "",
          kind: spread ? "spread" : "page",
          openingsClass: modal.classList.contains("reader-openings"),
          words: words.length,
          hidden,
          barAtTop,
          barHidden,
          pictureWidth: picture ? Math.round(picture.width) : null,
          pictureHeight: picture ? Math.round(picture.height) : null,
          hint: hint ? getComputedStyle(hint).display !== "none" : false,
          missingPicture: !!modal.querySelector(".reader-picture .image-missing, .reader-picture .image-unavailable") || /원본을 찾을 수 없어요/u.test(modal.querySelector(".reader-picture")?.textContent || ""),
          overflowX: document.documentElement.scrollWidth - innerWidth,
          modalOverflowX: modal.scrollWidth - modal.clientWidth,
        };
      });
      out.entries.push(row);
      const next = page.locator('[data-action="reader-next"]');
      if (row.missing || (await next.isDisabled())) break;
      await next.click();
      await sleep(page, 250);
    }
    await shot(page, `reader-${label}-${width}x${height}`);
    const portraitPhone = width <= 640 && height > width,
      landscapePhone = height <= 520 && width > height;
    for (const [i, row] of out.entries.entries()) {
      const name = `${i + 1}(${row.heading})`;
      if (row.missing) problem(`${name} 읽기 화면이 없어요`);
      if (!row.openingsClass) problem(`${name} 펼침 읽기 화면이 아니에요`);
      if (!row.barAtTop || row.barHidden) problem(`${name} 아래 막대가 가려져요 (${row.barHidden})`);
      if (row.hidden) problem(`${name} 따라가기 뒤 가려진 낱말 ${row.hidden}개`);
      if (row.overflowX > 1 || row.modalOverflowX > 1) problem(`${name} 가로 넘침`);
      if (row.kind === "spread" && landscapePhone && row.pictureWidth < 600) problem(`${name} 가로 폰 펼침면 그림 ${row.pictureWidth}px`);
      if (row.kind === "spread" && portraitPhone && !row.hint) problem(`${name} 세로 폰 안내가 없어요`);
      if (row.kind === "spread" && !portraitPhone && row.hint) problem(`${name} 안내가 세로 폰이 아닌데 보여요`);
    }
    if (out.entries.some((row) => row.missingPicture)) problem("그림 원본이 없는 쪽이 있어요");
    const pictures = out.entries.filter((row) => row.pictureWidth);
    out.smallestSpread = Math.min(...pictures.filter((r) => r.kind === "spread").map((r) => r.pictureWidth * r.pictureHeight));
    out.smallestPage = Math.min(...pictures.filter((r) => r.kind === "page").map((r) => r.pictureWidth * r.pictureHeight));
    if (landscapePhone && out.smallestSpread < out.smallestPage)
      problem(`가로 폰에서 펼침면 그림(${out.smallestSpread})이 낱쪽 그림(${out.smallestPage})보다 작아요`);
  } catch (error) {
    problem(`읽기 오류: ${error.message.split("\n")[0]}`);
  }
  page.off("pageerror", errors);
  return out;
}

// Each flow's book is read in its own tab at every viewport (once per case and flow).
const readers = new Set();
async function finish({ out, context, page }, kind, name) {
  report.runs.push({ ...out, library: undefined });
  const key = `${kind}-${name}`;
  if (out.bookId && !readers.has(key)) {
    readers.add(key);
    for (const viewport of VIEWPORTS)
      report.runs.push(await readerCheck(page, out.bookId, viewport, `${key}-${out.width}`));
  }
  await context.close();
}
for (const name of CASES) {
  const spec = caseOf(name);
  for (const width of WIDTHS) {
    await finish(await simpleFlow(spec, width), "simple", name);
    if (PRO) await finish(await proFlow(spec, width), "pro", name);
  }
}
for (const run of report.runs) {
  if (run.tab?.pageErrors?.length) report.problems.push(`${run.tab.label}: page errors ${run.tab.pageErrors.join(" | ")}`);
}
report.blockedRequests = report.runs.reduce((sum, run) => sum + (run.tab?.blocked?.length || 0), 0);
report.pageErrors = report.runs.reduce((sum, run) => sum + (run.tab?.pageErrors?.length || 0), 0);
report.passed = report.problems.length === 0;
await browser.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, problems: report.problems, runs: report.runs.length, blocked: report.blockedRequests }, null, 2));
process.exit(report.passed ? 0 : 1);
