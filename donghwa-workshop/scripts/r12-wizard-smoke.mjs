// R12-P1 page-count wiring in the real app, with the openings test hook ON and OFF.
// - simple ① format panel: K2 starts at 16 (기본) with the 12/16 choices; a level
//   change to K1 gives the settings default and today's 8/12/16/24; a parent's pick
//   (pageCountTouched) is kept across level and language changes;
// - pro wizard ③: the same rules; '줄거리부터 함께 만들기' (startStoryWorkflow) freezes
//   layoutPolicy only when layoutFor(wizard) says openings (read back from storage);
// - pro '다음 편 만들기' (startStory(previous)): a 13-entry openings book continues at
//   16 printed pages; an 8-page K2 page book continues at 8 (off) or 12 (on);
// - simple '이 주제로 새로 만들기' of a pre-R12 24-page K2 job: 24 (off) or 16 (on),
//   and the old job is left as it was.
// - the other two new-story paths from a pre-R12 job (P1 점검 수정): ③ '주제·엔진
//   바꾸기' of a paused 24-page K2 job and ④ '이야기 전체 다시 만들기' of an 8-page
//   K2 book (its text made here with the free demo engine). The new story's summary,
//   format select and job hold 24/8 (off) or 16/12 (on), and ③ 데모로 체험 / the
//   restart make a new job (free demo) instead of failing on the page count.
// - the safety net: a 24-page K2 wizard (simple ① and pro ③) chosen with the
//   switch off, then the switch flipped on: the next render shows and holds 16.
// With the hook off every value must be today's. Nothing paid runs: paid hosts are
// blocked and counted, and the story workflow is only opened, never started.
// 사용: (cd dist && npx http-server -p 4961 -s .) & node scripts/r12-wizard-smoke.mjs [기본주소] [결과 JSON]
// 환경변수: PLAYWRIGHT_MODULE(기본 playwright), CHROMIUM_PATH(선택, 브라우저 실행 파일)
import fs from "node:fs";
import { normalizeStoryInput, toLegacyPages } from "../dist/story-generation/pipeline.js";
import { freezeReadingLevels } from "../dist/reading-levels.js";
import {
  buildOpeningPlan,
  normalizeOpenings,
  openingsLayoutPolicy,
  printedPagesOf,
  layoutOf,
} from "../dist/book-layout.js";

const [BASE = "http://127.0.0.1:4961/", OUT = "QA/r12-wizard-smoke.json"] =
  process.argv.slice(2);
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
const clone = (value) => JSON.parse(JSON.stringify(value));
const FIXTURE = JSON.parse(
  fs.readFileSync(
    new URL("../tests/fixtures/legacy-page-book-r12.json", import.meta.url),
    "utf8",
  ),
);

/** The legacy K2/E2 page book laid out as openings: spreads on beats 1, 5 and 8 (13 entries). */
function openingsBook() {
  const book = clone(FIXTURE),
    specs = freezeReadingLevels(
      { koreanLevel: "K2", englishLevel: "E2" },
      {},
      { layout: "openings" },
    ).specs,
    input = normalizeStoryInput({
      ...book.storyInput,
      layoutPolicy: openingsLayoutPolicy(),
      specs,
    });
  const joined = (rows) => ({
    ...rows[0],
    textKo: rows.map((r) => r.textKo).join(" "),
    textEn: rows.map((r) => r.textEn).join(" "),
  });
  const entries = book.outline.beats.flatMap((beat) => {
    const rows = book.pagination.pages.filter(
      (p) => p.beatIndex === beat.index,
    );
    return [1, 5, 8].includes(beat.index)
      ? [joined(rows)]
      : [joined(rows.slice(0, 1)), joined(rows.slice(1))];
  });
  const fixed = normalizeOpenings(
    entries,
    buildOpeningPlan(book.outline, 8),
    specs,
  );
  if (fixed.needsRepagination) throw Error(fixed.reasons.join("; "));
  const pagination = { ...book.pagination, pages: fixed.pages };
  const out = {
    ...book,
    id: "openings-book-r12-p1",
    title: "펼침 구성 책",
    storyInput: input,
    readingLevelSnapshot: { version: 4, layout: "openings", koreanLevel: "K2", englishLevel: "E2", specs },
    pagination,
    pages: toLegacyPages(pagination),
    pageCount: fixed.pages.length,
  };
  if (layoutOf(out) !== "openings" || printedPagesOf(out) !== 16)
    throw Error("the openings fixture is not a valid 16-page openings book");
  return out;
}
/** An 8-page K2 page book (the legacy fixture's first 8 pages). */
function shortBook() {
  const book = clone(FIXTURE);
  return {
    ...book,
    id: "short-page-book-r12-p1",
    title: "여덟 쪽 책",
    pages: book.pages.slice(0, 8),
    pageCount: 8,
  };
}
const BOOKS = [openingsBook(), shortBook()];

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});
const report = { base: BASE, runs: [] };
const problems = [];

async function run(hook) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const result = { hook, pageErrors: [], paidRequests: [], steps: {} };
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  await page.route(PAID, (route) => {
    result.paidRequests.push(route.request().url());
    return route.abort();
  });
  if (hook)
    await context.addInitScript(() => {
      window.__DONGHWA_R12_OPENINGS__ = true;
    });
  await page.goto(BASE, { waitUntil: "networkidle" });
  // The app's own seed library with K2/E2 bilingual defaults (12 pages) and the two books.
  const library = await page.evaluate(async (books) => {
    const { seedState } = await import(new URL("engine.js", location.href).href);
    const state = seedState();
    Object.assign(state.settings, {
      defaultKoreanLevel: "K2",
      defaultEnglishLevel: "E2",
      defaultLanguage: "bilingual",
      defaultPages: 12,
    });
    state.books = [...books, ...state.books];
    // A paused pre-R12 simple job (24 pages, K2): made with the hook off, as R11 made it.
    const { createFullAutoJob } = await import(new URL("full-auto.js", location.href).href);
    const hook = window.__DONGHWA_R12_OPENINGS__;
    delete window.__DONGHWA_R12_OPENINGS__;
    const job = createFullAutoJob(
      state,
      { characterIds: ["yuha", "greenie"], backgroundIds: ["forest", "garden"], topic: "바람 피리 찾기", pageCount: 24, koreanLevel: "K2", englishLevel: "E2", language: "bilingual", value: "none", ending: "home", simpleFlow: true },
      { demo: true, stopBefore: "text" },
    );
    if (hook !== undefined) window.__DONGHWA_R12_OPENINGS__ = hook;
    job.status = "paused";
    return JSON.stringify(state);
  }, BOOKS);
  await context.addInitScript(
    ([key, value]) => {
      if (window.top === window && !sessionStorage.getItem("r12-p1-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("r12-p1-seeded", "1");
      }
    },
    [LIBRARY_KEY, library],
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const click = async (selector) => {
    await page.locator(selector).first().click();
    await page.waitForTimeout(250);
  };
  const select = async (scope, id, value) => {
    await page.locator(`${scope} #${id}`).selectOption(String(value));
    await page.waitForTimeout(150);
  };
  const pageCount = (scope) =>
    page.evaluate((s) => {
      const node = document.querySelector(`${s} #pageCount`);
      return node
        ? {
            value: Number(node.value),
            options: [...node.options].map((o) => [Number(o.value), o.textContent]),
          }
        : null;
    }, scope);
  const unlock = async () => {
    if (await page.locator("#pin-form").count()) {
      await page.fill("#pin-form #pin", "1234");
      if (await page.locator("#pin-form #pin-confirm").count())
        await page.fill("#pin-form #pin-confirm", "1234");
      await page.click("#pin-form button[type=submit]");
      await page.waitForTimeout(600);
    }
  };

  // Parent PIN, then simple ① and its format panel.
  await click('button[data-action="nav"][data-view="settings"]');
  await unlock();
  await click('button[data-action="nav"][data-view="create"]');
  const simple = "#simple-format-panel";
  const summary = () => page.locator("#simple-format-summary").textContent();
  result.steps.simpleSummary = await summary();
  await click('[data-simple-action="format"]');
  const s = (result.steps.simple = {});
  s.start = await pageCount(simple);
  await select(simple, "koreanLevel", "K1");
  s.k1 = { ...(await pageCount(simple)), summary: await summary() };
  await select(simple, "koreanLevel", "K2");
  s.k2 = await pageCount(simple);
  await select(simple, "pageCount", 12);
  await select(simple, "koreanLevel", "K1");
  s.touchedK1 = await pageCount(simple);
  await select(simple, "koreanLevel", "K3");
  s.touchedK3 = await pageCount(simple);
  await select(simple, "language", "en");
  s.touchedEn = { ...(await pageCount(simple)), summary: await summary() };
  // '이 주제로 새로 만들기' from the paused 24-page job (its ③, then ①).
  const storedJobs = () =>
    page.evaluate(
      (key) => JSON.stringify(JSON.parse(localStorage.getItem(key)).fullAutoJobs),
      LIBRARY_KEY,
    );
  const jobsBefore = await storedJobs();
  await click('[data-simple-action="resume"]');
  await click('[data-simple-action="goto-step"][data-step="1"]');
  await click('[data-simple-action="fork"]');
  await click("#simple-confirm-yes");
  s.fork = { summary: await summary(), jobUnchanged: (await storedJobs()) === jobsBefore };

  // Pro: a fresh wizard (reload keeps the library and the mode), ③, then the story workflow.
  await click('[data-action="toggle-ui-mode"]');
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await click('button[data-action="nav"][data-view="create"]');
  await unlock();
  const toStep3 = async () => {
    await click('[data-action="wizard-next"]');
    await page.fill("#topic", "바람 피리 찾기");
    await click('[data-action="wizard-next"]');
  };
  await toStep3();
  const p = (result.steps.pro = {});
  p.start = await pageCount("");
  await select("", "koreanLevel", "K1");
  p.k1 = await pageCount("");
  await select("", "koreanLevel", "K2");
  p.k2 = await pageCount("");
  await select("", "pageCount", 12);
  await select("", "koreanLevel", "K1");
  p.touchedK1 = await pageCount("");
  await select("", "koreanLevel", "K4");
  p.touchedK4 = await pageCount("");
  await click('[data-action="wizard-next"]');
  await click('.full-auto-launcher [data-action="wizard-next"]');
  await page.waitForTimeout(800);
  p.draft = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const draft = Object.values(state.storyDrafts || {}).sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    )[0];
    return draft
      ? {
          koreanLevel: draft.readingLevels?.koreanLevel,
          pageCount: draft.input.pageCount,
          layoutPolicy: draft.input.layoutPolicy ?? null,
          outlineBeatCount: draft.input.outlineBeatCount,
          readingVersion: draft.readingLevels?.version,
          specVersion: draft.input.specs?.ko?.ruleVersion,
          prosePolicy: draft.input.prosePolicy,
        }
      : null;
  }, LIBRARY_KEY);

  // Pro '다음 편 만들기' from each book.
  p.series = {};
  for (const book of BOOKS) {
    // The story workflow opened in a dialog; closing it keeps the draft.
    if (await page.locator("#modal-root .modal").count()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }
    await click('button[data-action="nav"][data-view="library"]');
    const discard = page.locator("#discard-confirm");
    if (await discard.count()) await discard.click();
    await click(`[data-action="open-book"][data-id="${book.id}"]`);
    await click(`[data-action="continue-book"][data-id="${book.id}"]`);
    await unlock();
    await toStep3();
    p.series[book.id] = await pageCount("");
  }
  if (result.pageErrors.length)
    problems.push(`${hook ? "on" : "off"}: page errors ${result.pageErrors.join(" | ")}`);
  if (result.paidRequests.length)
    problems.push(`${hook ? "on" : "off"}: paid requests ${result.paidRequests.length}`);
  await context.close();
  return result;
}

/**
 * One fresh tab per new-story flow: the K2/E2 defaults and, made with the switch
 * off (as R11 made it), one paused pre-R12 simple job of `pageCount` pages.
 */
async function newStoryTab(hook, pageCount) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const out = { pageErrors: [], paidRequests: [] };
  page.on("pageerror", (error) => out.pageErrors.push(error.message));
  await page.route(PAID, (route) => {
    out.paidRequests.push(route.request().url());
    return route.abort();
  });
  await context.addInitScript((on) => {
    if (on) window.__DONGHWA_R12_OPENINGS__ = true;
    // Every toast or notice that says the page count was refused.
    window.__r12Refusals = [];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (/펼침 구성 책은/u.test(node.textContent || ""))
            window.__r12Refusals.push(node.textContent.trim());
    }).observe(document, { childList: true, subtree: true });
  }, hook);
  await page.goto(BASE, { waitUntil: "networkidle" });
  const seeded = await page.evaluate(async (pages) => {
    const { seedState } = await import(new URL("engine.js", location.href).href);
    const { createFullAutoJob } = await import(new URL("full-auto.js", location.href).href);
    const state = seedState();
    Object.assign(state.settings, {
      defaultKoreanLevel: "K2",
      defaultEnglishLevel: "E2",
      defaultLanguage: "bilingual",
      defaultPages: 12,
    });
    if (pages) {
      const hook = window.__DONGHWA_R12_OPENINGS__;
      delete window.__DONGHWA_R12_OPENINGS__;
      const job = createFullAutoJob(
        state,
        { characterIds: ["yuha", "greenie"], backgroundIds: ["forest", "garden"], topic: `바람 피리 찾기 ${pages}`, pageCount: pages, koreanLevel: "K2", englishLevel: "E2", language: "bilingual", value: "none", ending: "home", simpleFlow: true },
        { demo: true, stopBefore: "text" },
      );
      if (hook !== undefined) window.__DONGHWA_R12_OPENINGS__ = hook;
      job.status = "paused";
      return { library: JSON.stringify(state), jobId: job.id };
    }
    return { library: JSON.stringify(state), jobId: null };
  }, pageCount);
  await context.addInitScript(
    ([key, value]) => {
      if (window.top === window && !sessionStorage.getItem("r12-p1-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("r12-p1-seeded", "1");
      }
    },
    [LIBRARY_KEY, seeded.library],
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const click = async (selector) => {
    await page.locator(selector).first().click();
    await page.waitForTimeout(250);
  };
  const jobs = () =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).fullAutoJobs || {},
      LIBRARY_KEY,
    );
  /** The first job not in `before`, once its free demo text is done. */
  const newJob = async (before) => {
    for (let i = 0; i < 100; i++) {
      const fresh = Object.values(await jobs()).find((j) => !before.includes(j.id));
      if (fresh && fresh.status !== "running" && fresh.status !== "ready")
        return { pageCount: fresh.input.pageCount, wizardPageCount: fresh.wizard.pageCount, layout: fresh.input.layoutPolicy?.kind || "pages", status: fresh.status, error: fresh.error || null };
      await page.waitForTimeout(200);
    }
    return null;
  };
  const formatSelect = () =>
    page.evaluate(() => {
      const node = document.querySelector("#simple-format-panel #pageCount");
      return node ? { value: Number(node.value), options: [...node.options].map((o) => Number(o.value)) } : null;
    });
  const summary = () => page.locator("#simple-format-summary").textContent();
  const unlock = async () => {
    if (await page.locator("#pin-form").count()) {
      await page.fill("#pin-form #pin", "1234");
      if (await page.locator("#pin-form #pin-confirm").count())
        await page.fill("#pin-form #pin-confirm", "1234");
      await page.click("#pin-form button[type=submit]");
      await page.waitForTimeout(600);
    }
  };
  await click('button[data-action="nav"][data-view="settings"]');
  await unlock();
  await click('button[data-action="nav"][data-view="create"]');
  const finish = async (record) => {
    record.refusals = await page.evaluate(() => window.__r12Refusals);
    record.pageErrors = out.pageErrors;
    record.paidRequests = out.paidRequests;
    await context.close();
    return record;
  };
  return { page, click, unlock, jobs, newJob, formatSelect, summary, finish, jobId: seeded.jobId };
}
/** ③ '주제·엔진 바꾸기' of a paused pre-R12 24-page K2 job, then ③ 데모로 체험. */
async function abandonFlow(hook) {
  const tab = await newStoryTab(hook, 24),
    oldBefore = JSON.stringify((await tab.jobs())[tab.jobId].wizard);
  await tab.click(`[data-simple-action="resume"][data-id="${tab.jobId}"]`);
  await tab.click('[data-simple-action="abandon"]');
  const record = { summary: await tab.summary() };
  await tab.click('[data-simple-action="format"]');
  record.select = await tab.formatSelect();
  await tab.click('[data-simple-action="goto-step"][data-step="3"]');
  const before = Object.keys(await tab.jobs());
  await tab.click('[data-simple-action="start-demo"]');
  record.newJob = await tab.newJob(before);
  const old = (await tab.jobs())[tab.jobId];
  record.oldJob = { abandoned: !!old.simpleAbandoned, wizardUnchanged: JSON.stringify(old.wizard) === oldBefore };
  return tab.finish(record);
}
/** ④ '이야기 전체 다시 만들기' of a pre-R12 8-page K2 book (text made here, free demo). */
async function restartFlow(hook) {
  const tab = await newStoryTab(hook, 8);
  await tab.click(`[data-simple-action="resume"][data-id="${tab.jobId}"]`);
  await tab.click('[data-simple-action="retry"]');
  for (let i = 0; i < 100 && !(await tab.page.locator('[data-simple-action="restart"]').count()); i++)
    await tab.page.waitForTimeout(200);
  const old = (await tab.jobs())[tab.jobId];
  const record = { oldText: { status: old.status, pages: old.book?.pages?.length ?? 0 } };
  // The old story as its own text run left it (that run fills in its picks).
  const oldBefore = JSON.stringify({ wizard: old.wizard, input: old.input });
  const before = Object.keys(await tab.jobs());
  await tab.click('[data-simple-action="restart"]');
  await tab.click("#simple-confirm-yes");
  record.newJob = await tab.newJob(before);
  const after = (await tab.jobs())[tab.jobId];
  record.oldJob = { replaced: !!after.simpleReplacedBy, wizardUnchanged: JSON.stringify({ wizard: after.wizard, input: after.input }) === oldBefore };
  return tab.finish(record);
}
/**
 * The render safety net: 24 pages chosen for a K2 wizard with the switch off; then
 * (hook run only) the switch is flipped on and the screen drawn again.
 */
async function safetyNetFlow(flip) {
  const tab = await newStoryTab(false, 0),
    page = tab.page,
    record = { simple: {}, pro: {} };
  await tab.click('[data-simple-action="format"]');
  await page.locator("#simple-format-panel #pageCount").selectOption("24");
  await page.waitForTimeout(150);
  record.simple.before = { summary: await tab.summary(), select: await tab.formatSelect() };
  if (flip) await page.evaluate(() => (window.__DONGHWA_R12_OPENINGS__ = true));
  await tab.click('[data-simple-action="format"]');
  await tab.click('[data-simple-action="format"]');
  record.simple.after = { summary: await tab.summary(), select: await tab.formatSelect() };
  await tab.click('[data-action="toggle-ui-mode"]');
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await tab.click('button[data-action="nav"][data-view="create"]');
  await tab.unlock();
  await tab.click('[data-action="wizard-next"]');
  await page.fill("#topic", "바람 피리 찾기");
  await tab.click('[data-action="wizard-next"]');
  await page.locator("#pageCount").selectOption("24");
  await page.waitForTimeout(150);
  const proSelect = () =>
    page.evaluate(() => {
      const node = document.querySelector("#pageCount");
      return { value: Number(node.value), options: [...node.options].map((o) => Number(o.value)) };
    });
  record.pro.before = await proSelect();
  if (flip) await page.evaluate(() => (window.__DONGHWA_R12_OPENINGS__ = true));
  await tab.click('[data-action="wizard-back"]');
  await tab.click('[data-action="wizard-next"]');
  record.pro.after = await proSelect();
  await tab.click('[data-action="wizard-next"]');
  await tab.click('.full-auto-launcher [data-action="wizard-next"]');
  await page.waitForTimeout(800);
  record.pro.draft = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const draft = Object.values(state.storyDrafts || {}).sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    )[0];
    return draft ? { pageCount: draft.input.pageCount, layout: draft.input.layoutPolicy?.kind || "pages" } : null;
  }, LIBRARY_KEY);
  return tab.finish(record);
}

for (const hook of [false, true]) report.runs.push(await run(hook));
report.newStory = [];
for (const hook of [false, true])
  report.newStory.push({
    hook,
    abandon: await abandonFlow(hook),
    restart: await restartFlow(hook),
    safetyNet: await safetyNetFlow(hook),
  });
await browser.close();

// ---------- expectations ----------
const TODAY = [8, 12, 16, 24],
  OPENINGS = [12, 16];
const values = (row) => row && [row.value, row.options.map(([v]) => v)];
const expect = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    problems.push(`${label}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
};
for (const r of report.runs) {
  const on = r.hook,
    tag = on ? "on" : "off",
    { simple: s, pro: p } = r.steps;
  expect(`${tag} simple summary`, /16쪽/u.test(r.steps.simpleSummary), on);
  expect(`${tag} simple start`, values(s.start), on ? [16, OPENINGS] : [12, TODAY]);
  expect(`${tag} simple K1`, values(s.k1), [12, TODAY]);
  expect(`${tag} simple K2`, values(s.k2), on ? [16, OPENINGS] : [12, TODAY]);
  expect(`${tag} simple touched K1`, values(s.touchedK1), [12, TODAY]);
  expect(`${tag} simple touched K3`, values(s.touchedK3), on ? [12, OPENINGS] : [12, TODAY]);
  expect(`${tag} simple touched en`, values(s.touchedEn), [12, TODAY]);
  if (on) expect("on 16 is 기본", s.k2.options.find(([v]) => v === 16)?.[1], "16쪽 · 펼침 8개 (기본)");
  expect(`${tag} fork`, [s.fork.summary.match(/(\d+)쪽/u)?.[1], s.fork.jobUnchanged], [on ? "16" : "24", true]);
  expect(`${tag} pro start`, values(p.start), on ? [16, OPENINGS] : [12, TODAY]);
  expect(`${tag} pro K1`, values(p.k1), [12, TODAY]);
  expect(`${tag} pro K2`, values(p.k2), on ? [16, OPENINGS] : [12, TODAY]);
  expect(`${tag} pro touched K1`, values(p.touchedK1), [12, TODAY]);
  expect(`${tag} pro touched K4`, values(p.touchedK4), on ? [12, OPENINGS] : [12, TODAY]);
  expect(`${tag} pro draft`, p.draft && [p.draft.koreanLevel, p.draft.pageCount, !!p.draft.layoutPolicy, p.draft.outlineBeatCount, p.draft.readingVersion, p.draft.specVersion], on ? ["K4", 12, true, 6, 4, 4] : ["K4", 12, false, 7, 3, 3]);
  expect(`${tag} series openings`, values(p.series["openings-book-r12-p1"]), on ? [16, OPENINGS] : [16, TODAY]);
  expect(`${tag} series 8 pages`, values(p.series["short-page-book-r12-p1"]), on ? [12, OPENINGS] : [8, TODAY]);
}
for (const { hook: on, abandon, restart, safetyNet } of report.newStory) {
  const tag = on ? "on" : "off";
  for (const [name, flow] of Object.entries({ abandon, restart, safetyNet })) {
    expect(`${tag} ${name} page errors`, flow.pageErrors, []);
    expect(`${tag} ${name} paid requests`, flow.paidRequests, []);
    expect(`${tag} ${name} page count refused`, flow.refusals, []);
  }
  const OPTIONS = on ? OPENINGS : TODAY;
  expect(`${tag} abandon summary`, abandon.summary, `K2 · E2 · ${on ? 16 : 24}쪽 · 한 쪽에 한글 + 영어`);
  expect(`${tag} abandon select`, abandon.select, { value: on ? 16 : 24, options: OPTIONS });
  expect(`${tag} abandon new job`, abandon.newJob && [abandon.newJob.pageCount, abandon.newJob.wizardPageCount, abandon.newJob.layout, abandon.newJob.status], [on ? 16 : 24, on ? 16 : 24, on ? "openings" : "pages", "text-review"]);
  expect(`${tag} abandon old job`, abandon.oldJob, { abandoned: true, wizardUnchanged: true });
  expect(`${tag} restart old text`, restart.oldText, { status: "text-review", pages: 8 });
  expect(`${tag} restart new job`, restart.newJob && [restart.newJob.pageCount, restart.newJob.wizardPageCount, restart.newJob.layout, restart.newJob.status], [on ? 12 : 8, on ? 12 : 8, on ? "openings" : "pages", "text-review"]);
  expect(`${tag} restart old job`, restart.oldJob, { replaced: true, wizardUnchanged: true });
  const { simple: sn, pro: pn } = safetyNet;
  expect(`${tag} safety simple before`, sn.before, { summary: "K2 · E2 · 24쪽 · 한 쪽에 한글 + 영어", select: { value: 24, options: TODAY } });
  expect(`${tag} safety simple after`, sn.after, { summary: `K2 · E2 · ${on ? 16 : 24}쪽 · 한 쪽에 한글 + 영어`, select: { value: on ? 16 : 24, options: OPTIONS } });
  expect(`${tag} safety pro before`, pn.before, { value: 24, options: TODAY });
  expect(`${tag} safety pro after`, pn.after, { value: on ? 16 : 24, options: OPTIONS });
  expect(`${tag} safety pro draft`, pn.draft, { pageCount: on ? 16 : 24, layout: on ? "openings" : "pages" });
}
fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n");
console.log(`wrote ${OUT}`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
