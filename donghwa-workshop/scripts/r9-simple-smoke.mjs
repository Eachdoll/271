// R9-B5 쉬운 모드 데모 한 권: ①→⑤, 책장 저장, 다시 접속, 책 열기 (1280px · 390px).
// 유료 요청은 모두 막고 셉니다. 페이지 오류·유료 요청·가로 넘침이 없어야 통과입니다.
// FIX-UI: ③ 중지 뒤 '주제·엔진 바꾸기', ④ 알림이 아래 버튼 줄을 가리지 않는지,
// 글만 고친 쪽 '그림 그대로 저장'이 그림을 새로 만들지 않는지도 확인합니다.
// FIX-UI-2: 그대로 둔 그림은 중지 뒤 책장 '이어서 만들기'에서도 다시 그리지 않고,
// 쪽 그림을 만드는 동안 프로 모드 '완성 초안 검토'는 같은 책을 열지 않습니다.
// FIX-UI-3: '이어 만들 이야기'의 FULL AUTO 초안은 '검수 열기'로만 열리고(그리는 중엔 거절),
// 다시 엮지 않아 산 그림이 그대로 남으며, 아이디어 뽑기 안내가 화면에 남는지 확인합니다.
// R11: 브라우저 뒤로 가기(②→①→②), 단계 표시로 ④→①→③→④(같은 쪽·작업 그대로), 아래 버튼 줄
// 고정, 쉬운 책장의 '제작 중인 이야기', 다시 연 ④의 마지막 쪽, 데모 '이 주제로 새로 만들기'(무료).
// 책장 카드의 실행형 '이어서 만들기'는 프로 모드 카드로 확인합니다(쉬운 카드는 열기만 해요).
// R11 리뷰 수정: 첫 ④에서 뒤로 가면 ③, 글을 고치는 중 뒤로 가기 세 번은 앱에 그대로 남고,
// 새로 만들기 뒤 뒤로 가기는 엉뚱한 알림 없이 지나가며, 책장에서 다시 연 이야기의 뒤로 가기는
// 실행 중인 글 만들기를 끊지 않고 앱 안에서 책장으로 갑니다.
// 사용: (cd dist && npx http-server -p 4180 -s .) & node scripts/r9-simple-smoke.mjs [기본주소] [출력폴더]
// 환경변수: PLAYWRIGHT_MODULE(기본 playwright), CHROMIUM_PATH(선택, 브라우저 실행 파일)
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:4180/";
const OUT = process.argv[3] || "QA/r9-simple";
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
// Known until FIX-B1 item 6 lands: the scene prompt contains the word "frozen".
const KNOWN_IMAGE_BUG =
  /forbidden_style_name|스튜디오·작가·작품·기존 캐릭터 이름/i;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});
const report = { base: BASE, runs: [] };
let failed = false;

async function run(width) {
  const height = width < 500 ? 844 : 900;
  const ctx = await browser.newContext({
    viewport: { width, height },
    locale: "ko-KR",
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  // Test-only: hold the FULL AUTO run lock while window.__smokeLockDelay is set,
  // so a demo run can be stopped before it finishes.
  // Test-only: hold a sample picture's storage while window.__smokeImageDelay
  // is set, so a page drawing is still in flight while the parent goes elsewhere.
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const delay = Number(window.__smokeImageDelay) || 0;
      if (delay && String(input?.url || input).startsWith("data:image/"))
        await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchOriginal(input, init);
    };
  });
  await page.addInitScript(() => {
    const locks = navigator.locks;
    if (!locks?.request) return;
    const request = locks.request.bind(locks);
    locks.request = async (...args) => {
      const delay = Number(window.__smokeLockDelay) || 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return request(...args);
    };
  });
  const result = {
    width,
    pageErrors: [],
    paidRequests: [],
    overflow: [],
    steps: {},
    imageBug: null,
    problems: [],
  };
  page.on("pageerror", (error) => result.pageErrors.push(error.message));
  await page.route(PAID, (route) => {
    result.paidRequests.push(route.request().url());
    return route.abort();
  });
  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(OUT, `${width}-${name}.png`),
      fullPage: true,
    });
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (over > 1) result.overflow.push({ step: name, px: over });
  };
  const step = async () =>
    Number(
      await page
        .locator(".simple-create")
        .getAttribute("data-simple-step")
        .catch(() => 0),
    );
  const click = async (selector) => {
    await page.locator(selector).first().click();
    await page.waitForTimeout(300);
  };
  const confirmIfAsked = async () => {
    const yes = page.locator("#simple-confirm-yes");
    if (await yes.isVisible().catch(() => false)) await yes.click();
  };
  const toastText = async () =>
    (await page
      .locator("#toast")
      .textContent()
      .catch(() => "")) || "";
  /** Browser Back/Forward, then let the screen settle. */
  const historyMove = async (delta) => {
    await page.evaluate((d) => history.go(d), delta);
    await page.waitForTimeout(700);
  };
  /** Clear the toast, so a toast after a move is the move's own. */
  const clearToast = () =>
    page.evaluate(() => {
      const t = document.querySelector("#toast");
      if (t) {
        t.textContent = "";
        t.classList.remove("visible");
      }
    });
  const shownToast = () =>
    page.evaluate(() =>
      document.querySelector("#toast")?.classList.contains("visible")
        ? document.querySelector("#toast").textContent
        : "",
    );
  const inApp = () => page.url().startsWith(BASE);
  const idle = async (timeout = 90000) => {
    await page.waitForFunction(
      () =>
        !document.querySelector(".simple-progress") &&
        !document.querySelector('[data-simple-action="stop"]'),
      null,
      { timeout },
    );
    await page.waitForTimeout(400);
  };
  const problem = (message) => {
    result.problems.push(message);
  };
  const library = () =>
    page.evaluate(() => localStorage.getItem("donghwa-workshop-v1"));
  /** How many FULL AUTO jobs are stored (moving between steps never adds one). */
  const jobCount = () =>
    page.evaluate(
      () =>
        Object.keys(
          JSON.parse(localStorage.getItem("donghwa-workshop-v1") || "{}")
            .fullAutoJobs || {},
        ).length,
    );
  /** One stored job as JSON (to prove a step change or a fork left it as it was). */
  const storedJob = (id) =>
    page.evaluate(
      (jobId) =>
        JSON.stringify(
          JSON.parse(localStorage.getItem("donghwa-workshop-v1") || "{}")
            .fullAutoJobs?.[jobId] ?? null,
        ),
      id,
    );
  /** ④ back to its first page (a reopened story starts on the page last shown). */
  const firstPage = async () => {
    for (let i = 0; i < 30; i++) {
      const prev = page.locator('[data-simple-action="page-prev"]');
      if (!(await prev.count()) || (await prev.isDisabled())) return;
      await prev.click();
      await page.waitForTimeout(150);
    }
  };
  /** One page of a simple job's book as stored (the newest job with a book when jobId is null). */
  const jobPage = (jobId, index) =>
    page.evaluate(
      ([id, i]) => {
        const s = JSON.parse(localStorage.getItem("donghwa-workshop-v1"));
        const job = id
          ? s.fullAutoJobs?.[id]
          : Object.values(s.fullAutoJobs || {})
              .filter((j) => j.book?.pages?.length && !j.simpleAbandoned)
              .sort((a, b) =>
                String(b.updatedAt).localeCompare(String(a.updatedAt)),
              )[0];
        const p = job?.book?.pages?.[i] || {};
        return {
          jobId: job?.id || null,
          status: job?.status || null,
          error: job?.error || null,
          asset: p.imageAssetId || null,
          marker: p.simpleTextEditedAssetId || null,
          stale: p.imageStale === true,
        };
      },
      [jobId, index],
    );
  /** Click without scrolling (Playwright's click scrolls the target into view). */
  const jsClick = (selector) =>
    page.evaluate((s) => document.querySelector(s)?.click(), selector);
  /** Show a harmless toast at the current scroll and measure it against the bottom bar. */
  const toastOverBar = async (label, scroll) => {
    await jsClick('[data-simple-action="edit-text"]');
    await page.waitForTimeout(150);
    await jsClick('[data-simple-action="save-text"]');
    await page.waitForSelector("#toast.visible", { timeout: 5000 });
    // Scroll after the toast is up (focusing the text field may have scrolled).
    await page.evaluate(scroll);
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const t = document.querySelector("#toast").getBoundingClientRect(),
        b = document
          .querySelector(".simple-create > .wizard-actions")
          .getBoundingClientRect(),
        x = Math.max(0, Math.min(t.right, b.right) - Math.max(t.left, b.left)),
        y = Math.max(0, Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top));
      return {
        overlap: Math.round(x * y),
        toast: [Math.round(t.top), Math.round(t.bottom)],
        bar: [Math.round(b.top), Math.round(b.bottom)],
      };
    });
    if (box.overlap > 0)
      problem(
        `알림이 ④ 아래 버튼 줄을 가려요 (${label}): ${JSON.stringify(box)}`,
      );
    await page.evaluate(() =>
      document.querySelector("#toast")?.classList.remove("visible"),
    );
    return box;
  };
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    result.steps.defaultMode = await page.evaluate(() =>
      localStorage.getItem("donghwa-ui-mode"),
    );
    if (
      !(await page
        .locator('.top-actions [data-action="toggle-ui-mode"]')
        .count())
    )
      problem("상단 모드 전환 버튼이 없어요.");
    // Parent PIN in a fresh profile.
    await click('button[data-action="nav"][data-view="settings"]');
    await page.fill("#pin", "1234");
    await page.fill("#pin-confirm", "1234");
    await page.click("#pin-form button[type=submit]");
    await page.waitForTimeout(800);
    result.steps.settingsGroups = await page
      .locator(".simple-settings > .panel > h3")
      .allTextContents();
    if (
      result.steps.settingsGroups.join("|") !== "우리 아이|엔진과 키|잠금|보관"
    )
      problem("쉬운 부모 설정 네 묶음이 아니에요.");
    await shot("00-settings");

    // ① topic
    await click('button[data-action="nav"][data-view="create"]');
    if ((await step()) !== 1) problem("만들기 화면이 ①로 시작하지 않아요.");
    // 아이디어 뽑기 works without a story world (built-in list), twice in a row.
    const ideas = [];
    for (let i = 0; i < 2; i++) {
      await click('[data-simple-action="idea"]');
      ideas.push(await page.locator("#topic").inputValue());
    }
    result.steps.ideas = ideas;
    if (!ideas[0] || !ideas[1] || ideas[0] === ideas[1])
      problem(`아이디어 뽑기가 새 주제를 넣지 않았어요: ${ideas.join(" / ")}`);
    // FIX-UI-3: the status line is not wiped by a redraw after the click.
    result.steps.ideaStatus = await page
      .locator("#simple-idea-status")
      .textContent();
    if (!/주제 칸에 아이디어를 넣었어요/.test(result.steps.ideaStatus || ""))
      problem(
        `아이디어 뽑기 안내가 화면에 남지 않았어요: '${result.steps.ideaStatus}'`,
      );
    // FIX-UI-3 census: ① on the forced screen (opened from a pro job card),
    // with three simple stories waiting, laid out with the real styles. The
    // render uses a copy of the stored library; nothing is saved.
    result.steps.forcedTopicCensus = await page.evaluate(async () => {
      const m = await import("./simple-create.js");
      const s = JSON.parse(localStorage.getItem("donghwa-workshop-v1"));
      s.fullAutoJobs = { ...(s.fullAutoJobs || {}) };
      for (const id of ["smoke-a", "smoke-b", "smoke-c"])
        s.fullAutoJobs[id] = {
          id,
          status: "paused",
          stopBefore: "text",
          wizard: { simpleFlow: true, topic: id },
          input: { topic: id },
          updatedAt: "2099-01-01T00:00:00Z",
        };
      const w = { step: 1, simpleStep: 1, simpleForced: true, topic: "" },
        ctx = {
          getState: () => s,
          getWizard: () => w,
          getDraft: () => null,
          setDraft() {},
        },
        slot = document.createElement("div");
      slot.innerHTML = m.renderSimpleCreate(ctx);
      document.querySelector("#page-content").append(slot);
      const visible = (e) => {
          const r = e.getBoundingClientRect(),
            st = getComputedStyle(e);
          return (
            st.display !== "none" &&
            st.visibility !== "hidden" &&
            r.width > 0 &&
            r.height > 0
          );
        },
        buttons = [...slot.querySelectorAll("button")]
          .filter(visible)
          .filter(
            (b) =>
              !b.matches(
                '.simple-card,[data-simple-nav],[data-action="toggle-ui-mode"]',
              ),
          );
      const census = {
        stepButtons: buttons.length,
        resumeCards: slot.querySelectorAll(".simple-resume-card").length,
        exitForced: slot.querySelectorAll('[data-simple-action="exit-forced"]')
          .length,
      };
      slot.remove();
      return census;
    });
    if (
      result.steps.forcedTopicCensus.stepButtons > 12 ||
      !result.steps.forcedTopicCensus.exitForced
    )
      problem(
        `프로에서 연 ①이 버튼 12개를 넘어요: ${JSON.stringify(result.steps.forcedTopicCensus)}`,
      );
    await page.fill("#topic", "공룡 친구와 숲으로 소풍 가는 날");
    await click('[data-simple-action="format"]');
    await page.selectOption("#pageCount", "8");
    result.steps.format = await page
      .locator("#simple-format-summary")
      .textContent();
    await shot("01-topic");
    await click('[data-simple-action="next"]');
    // ② materials
    if ((await step()) !== 2) problem("②로 넘어가지 않았어요.");
    result.steps.recommended = await page
      .locator(".simple-card .simple-rec")
      .count();
    result.steps.selectedCards = await page
      .locator(".simple-card.selected")
      .count();
    await shot("02-materials");
    // R11: the browser's Back goes from ② to ① inside the app (topic kept),
    // Forward comes back to ②. Nothing is started or bought.
    const backNav = { jobsBefore: await jobCount() };
    await page.evaluate(() => history.back());
    await page
      .waitForFunction(
        () =>
          document.querySelector(".simple-create")?.dataset.simpleStep === "1",
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
    backNav.afterBack = await step();
    backNav.topic = await page
      .locator("#topic")
      .inputValue()
      .catch(() => "");
    await page.evaluate(() => history.forward());
    await page
      .waitForFunction(
        () =>
          document.querySelector(".simple-create")?.dataset.simpleStep === "2",
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
    backNav.afterForward = await step();
    backNav.jobsAfter = await jobCount();
    result.steps.browserBack = backNav;
    if (
      backNav.afterBack !== 1 ||
      !backNav.topic.includes("공룡 친구와 숲으로 소풍") ||
      backNav.afterForward !== 2 ||
      backNav.jobsAfter !== backNav.jobsBefore
    )
      problem(
        `브라우저 뒤로 가기로 ②→①→② 이동이 안 돼요: ${JSON.stringify(backNav)}`,
      );
    await click('[data-simple-action="next"]');
    // ③ generate (demo text only)
    if ((await step()) !== 3) problem("③으로 넘어가지 않았어요.");
    await shot("03-generate");
    // ③ escape hatch: start, stop before the text is built, then 주제·엔진 바꾸기.
    await page.evaluate(() => {
      window.__smokeLockDelay = 4000;
    });
    await click('[data-simple-action="start-demo"]');
    await click('[data-simple-action="stop"]');
    await page.evaluate(() => {
      window.__smokeLockDelay = 0;
    });
    await page.waitForSelector('[data-simple-action="abandon"]', {
      timeout: 20000,
    });
    const escape = {
      retry: await page
        .locator('[data-simple-action="retry"]')
        .textContent()
        .catch(() => ""),
      engineLocked: await page.locator("#simple-text-engine").isDisabled(),
    };
    await shot("03b-stopped");
    await click('[data-simple-action="abandon"]');
    escape.stepAfter = await step();
    escape.topicKept = (await page.locator("#topic").inputValue()).includes(
      "공룡 친구와 숲으로 소풍",
    );
    escape.resumeCards = await page.locator(".simple-resume-card").count();
    await click('[data-simple-action="next"]');
    await click('[data-simple-action="next"]');
    escape.engineUnlocked = !(await page
      .locator("#simple-text-engine")
      .isDisabled());
    escape.stoppedJobKept = await page.evaluate(() =>
      Object.values(
        JSON.parse(localStorage.getItem("donghwa-workshop-v1")).fullAutoJobs ||
          {},
      ).some((job) => job.simpleAbandoned === true && job.status === "paused"),
    );
    result.steps.escape = escape;
    if (!/이어서 만들기/.test(escape.retry))
      problem("③ 중지 뒤 ‘이어서 만들기’가 없어요.");
    if (escape.stepAfter !== 1 || !escape.topicKept)
      problem("‘주제·엔진 바꾸기’가 주제를 지킨 채 ①로 돌아가지 않았어요.");
    if (escape.resumeCards)
      problem("버려 둔 이야기가 ① 이어서 만들기 카드에 남아 있어요.");
    if (!escape.engineUnlocked || (await step()) !== 3)
      problem("다시 온 ③에서 글 엔진을 고를 수 없어요.");
    if (!escape.stoppedJobKept)
      problem("멈춘 이야기가 ‘제작 중인 이야기’에 보관되지 않았어요.");
    await click('[data-simple-action="start-demo"]');
    await page.waitForSelector('.simple-create[data-simple-step="4"]', {
      timeout: 90000,
    });
    await page.waitForTimeout(800);
    // R11 review fix: the first ④ after the text run has its own entry, so
    // Back returns to ③ (not to the frozen ②), and Forward comes back to ④.
    {
      const firstReview = {};
      await historyMove(-1);
      firstReview.afterBack = await step();
      await historyMove(1);
      firstReview.afterForward = await step();
      firstReview.inApp = inApp();
      result.steps.backFromFirstReview = firstReview;
      if (
        firstReview.afterBack !== 3 ||
        firstReview.afterForward !== 4 ||
        !firstReview.inApp
      )
        problem(
          `처음 열린 ④에서 뒤로 가기가 ③으로 가지 않아요: ${JSON.stringify(firstReview)}`,
        );
    }
    // ④ review
    const pageKo = await page.locator("#page-ko").inputValue();
    if (!pageKo.trim()) problem("④ 첫 쪽 한글 글이 비어 있어요.");
    if (
      !(await page
        .locator("#page-ko")
        .getAttribute("readonly")
        .then((v) => v !== null))
    )
      problem("④ 글이 고치기 전부터 편집 상태예요.");
    await shot("04-review");
    await click('[data-simple-action="edit-text"]');
    await page.fill("#page-ko", pageKo.trim() + " 유하가 활짝 웃었어요.");
    // R11 review fix: Back while the page text is being edited is refused
    // and returns to the same entry, so three Backs never leave the app and
    // the edit stays.
    {
      const editBacks = [];
      // A mark on the entry the parent is on: each refused Back must come back to it.
      await page.evaluate(() =>
        history.replaceState({ ...history.state, smokeMark: "edit" }, ""),
      );
      for (let n = 1; n <= 3; n++) {
        await clearToast();
        await historyMove(-1);
        editBacks.push({
          inApp: inApp(),
          sameEntry: await page
            .evaluate(() => history.state?.smokeMark === "edit")
            .catch(() => false),
          step: await step(),
          edit: (
            await page
              .locator("#page-ko")
              .inputValue()
              .catch(() => "")
          ).includes("유하가 활짝 웃었어요."),
          toast: await shownToast(),
        });
      }
      result.steps.backWhileEditing = editBacks;
      if (
        editBacks.some(
          (b) =>
            !b.inApp ||
            !b.sameEntry ||
            b.step !== 4 ||
            !b.edit ||
            !/고치던 글을 저장하거나 취소해 주세요/.test(b.toast),
        )
      )
        problem(
          `글을 고치는 중 뒤로 가기 세 번에 앱을 떠나거나 고치던 글을 잃었어요: ${JSON.stringify(editBacks)}`,
        );
    }
    await click('[data-simple-action="save-text"]');
    await confirmIfAsked();
    const savedKo = await page.locator("#page-ko").inputValue();
    if (!savedKo.includes("활짝 웃었어요"))
      problem("고친 글이 저장되지 않았어요.");
    await click('[data-simple-action="like"]');
    if (
      (await page
        .locator('[data-simple-action="like"]')
        .getAttribute("aria-pressed")) !== "true"
    )
      problem("좋아요 표시가 남지 않았어요.");
    result.steps.badge = await page
      .locator("#simple-reading-badge")
      .textContent();
    // R11: ④ → ① → ③ → ④ through the step bar. ① shows the story's frozen
    // copy (no topic field, '이 주제로 새로 만들기'), ③ says the text is done
    // and offers 검수로 가기, and ④ comes back on the same page; the stored
    // job is unchanged.
    {
      const reviewJob = (await jobPage(null, 0)).jobId,
        round = {
          page: await page.locator(".simple-page-no").textContent(),
          job: await storedJob(reviewJob),
          jobs: await jobCount(),
        };
      await click('[data-simple-action="goto-step"][data-step="1"]');
      round.atFirst = await step();
      round.frozen = await page.locator(".simple-frozen").count();
      round.topicField = await page.locator("#topic").count();
      round.fork = await page.locator('[data-simple-action="fork"]').count();
      await shot("04a-frozen-topic");
      // Leaving from this frozen ① still asks (the book under review is kept).
      await click('button[data-action="nav"][data-view="library"]');
      round.leaveDialog = await page
        .locator("#discard-confirm")
        .isVisible()
        .catch(() => false);
      if (round.leaveDialog)
        await click('#modal-root [data-action="close-modal"]');
      round.stayed = await step();
      await click('[data-simple-action="goto-step"][data-step="3"]');
      round.atThird = await step();
      round.toReview = await page
        .locator('[data-simple-action="open-review"]')
        .count();
      round.startText = await page
        .locator('[data-simple-action="start-text"]')
        .count();
      await click('[data-simple-action="goto-step"][data-step="4"]');
      round.back = await step();
      round.pageAfter = await page.locator(".simple-page-no").textContent();
      round.liked = await page
        .locator('[data-simple-action="like"]')
        .getAttribute("aria-pressed");
      round.same = (await storedJob(reviewJob)) === round.job;
      round.jobsAfter = await jobCount();
      delete round.job;
      result.steps.stepBarRoundTrip = round;
      if (
        round.atFirst !== 1 ||
        !round.frozen ||
        round.topicField ||
        !round.fork ||
        !round.leaveDialog ||
        round.stayed !== 1 ||
        round.atThird !== 3 ||
        !round.toReview ||
        round.startText ||
        round.back !== 4 ||
        round.pageAfter !== round.page ||
        round.liked !== "true" ||
        !round.same ||
        round.jobsAfter !== round.jobs
      )
        problem(`단계 표시로 ④→①→③→④ 이동이 이상해요: ${JSON.stringify(round)}`);
      // The bottom actions stay on screen (above the phone's bottom navigation),
      // and every step link has a 40px hit area.
      const sticky = await page.evaluate(() => {
        window.scrollTo(0, 0);
        const bar = document
            .querySelector(".simple-create > .wizard-actions")
            .getBoundingClientRect(),
          nav = document.querySelector(".sidebar").getBoundingClientRect(),
          covers =
            nav.bottom >= innerHeight - 1 && nav.width >= innerWidth - 1
              ? innerHeight - nav.top
              : 0,
          links = [...document.querySelectorAll(".simple-step-link")].map(
            (link) => {
              const r = link.getBoundingClientRect();
              return [Math.round(r.width), Math.round(r.height)];
            },
          );
        return {
          bar: [Math.round(bar.top), Math.round(bar.bottom)],
          innerHeight,
          navCovers: Math.round(covers),
          links,
        };
      });
      result.steps.stickyActions = sticky;
      if (
        sticky.bar[0] < 0 ||
        sticky.bar[1] > sticky.innerHeight - sticky.navCovers + 1
      )
        problem(`④ 아래 버튼 줄이 화면에 보이지 않아요: ${JSON.stringify(sticky)}`);
      if (
        sticky.links.length !== 4 ||
        sticky.links.some(([w, h]) => w < 40 || h < 40)
      )
        problem(`단계 표시 버튼이 작거나 수가 달라요: ${JSON.stringify(sticky)}`);
      await page.screenshot({
        path: path.join(OUT, `${width}-04b-sticky-actions.png`),
      });
    }
    // The toast never covers the bottom action bar, at the top or the bottom of the page.
    const atTop = await toastOverBar("맨 위", () => window.scrollTo(0, 0));
    const atBar = await toastOverBar("버튼 줄이 화면 아래", () => {
      const bar = document
        .querySelector(".simple-create > .wizard-actions")
        .getBoundingClientRect();
      window.scrollBy(0, bar.bottom - (window.innerHeight - 72));
    });
    result.steps.toastClear = { atTop, atBar };
    // Mode switch is a screen change only, and the simple draft opens from pro mode.
    const beforeToggle = await library();
    await click('.top-actions [data-action="toggle-ui-mode"]');
    result.steps.proMode = await page.evaluate(() =>
      localStorage.getItem("donghwa-ui-mode"),
    );
    if (await page.locator(".simple-create").count())
      problem("프로 모드로 바꿨는데 쉬운 만들기 화면이 남아 있어요.");
    const proCard = page.locator('[data-full-auto-action="simple-review"]');
    if (!(await proCard.count()))
      problem("프로 모드 만들기 화면에 ‘쪽마다 검수’ 카드가 없어요.");
    else {
      await proCard.first().click();
      await page.waitForTimeout(800);
      if ((await step()) !== 4)
        problem("프로 모드에서 ‘쪽마다 검수’로 ④가 열리지 않아요.");
    }
    await click('.top-actions [data-action="toggle-ui-mode"]');
    if ((await step()) !== 4) problem("모드를 되돌린 뒤 ④가 아니에요.");
    if ((await library()) !== beforeToggle)
      problem("모드 전환이 저장된 책·초안·설정을 바꿨어요.");
    result.steps.modeRoundTrip = "pro → 쪽마다 검수 → simple · 저장 내용 같음";
    // One page image (prepares sheets first: free with the sample engine).
    await click('[data-simple-action="page-next"]');
    await click('[data-simple-action="draw-page"]');
    await confirmIfAsked();
    await idle();
    const afterOne = await toastText();
    const errorLine = await page
      .locator(".simple-review .pin-error")
      .textContent()
      .catch(() => "");
    const onePageImage = await page
      .locator(".simple-page-art img, .simple-page-art .asset-skeleton")
      .count();
    result.steps.onePage = {
      toast: afterOne,
      error: errorLine,
      image: onePageImage,
    };
    if (!onePageImage) {
      if (KNOWN_IMAGE_BUG.test(afterOne + " " + errorLine))
        result.imageBug = afterOne || errorLine;
      else problem(`한 쪽 그림을 만들지 못했어요: ${afterOne || errorLine}`);
    }
    await shot("05-one-image");
    let imagesOk = !!onePageImage;
    let jobId = null,
      keptAsset = null;
    if (imagesOk) {
      // Text edited after drawing: the parent keeps the picture (취소). The
      // keep is lasting: no runner-visible stale mark, only the kept marker.
      await click('[data-simple-action="edit-text"]');
      const drawnText = await page.locator("#page-ko").inputValue();
      await page.fill("#page-ko", drawnText.trim() + " 바람이 살랑 불었어요.");
      await click('[data-simple-action="save-text"]');
      const keepNo = page.locator("#simple-confirm-no");
      if (!(await keepNo.isVisible().catch(() => false)))
        problem("그림 있는 쪽 글을 고쳤는데 다시 만들지 묻지 않았어요.");
      else await keepNo.click();
      await page.waitForTimeout(300);
      result.steps.staleCount = await page
        .locator("#simple-image-count")
        .textContent();
      if (!/그림 1 \/ 8 · 글 바뀐 쪽 1/.test(result.steps.staleCount))
        problem(`글 바뀐 쪽 표시가 없어요: ${result.steps.staleCount}`);
      const kept = await jobPage(null, 1);
      jobId = kept.jobId;
      keptAsset = kept.asset;
      result.steps.keptAfterEdit = kept;
      if (!kept.asset || kept.marker !== kept.asset || kept.stale)
        problem(
          `그림을 그대로 둔 결정이 남지 않았어요: ${JSON.stringify(kept)}`,
        );
      await shot("06a-kept");
      // 모든 쪽 그림 만들기 → 빈 그림만 만들기, then 중지 before the run starts.
      await page.evaluate(() => {
        window.__smokeLockDelay = 4000;
      });
      await click('[data-simple-action="draw-all"]');
      const onlyMissing = page.locator("#simple-choice-missing");
      if (!(await onlyMissing.isVisible().catch(() => false))) {
        problem("모든 쪽 그림 만들기가 고친 쪽을 묻지 않았어요.");
        await confirmIfAsked();
      } else {
        result.steps.drawAllChoice = await page
          .locator(".simple-choices")
          .innerText();
        await onlyMissing.click();
      }
      await page.waitForSelector('[data-simple-action="stop"]', {
        timeout: 10000,
      });
      await click('[data-simple-action="stop"]');
      await page.evaluate(() => {
        window.__smokeLockDelay = 0;
      });
      await idle();
      const stopped = await jobPage(jobId, 1);
      result.steps.stoppedRun = stopped;
      if (stopped.status !== "paused")
        problem(`그림 만들기를 중지하지 못했어요: ${stopped.status}`);
      // The library card resumes with no question: the kept page is not redrawn.
      await click('button[data-action="nav"][data-view="library"]');
      if (
        await page
          .locator("#discard-confirm")
          .isVisible()
          .catch(() => false)
      )
        await click("#discard-confirm");
      // R11: the simple library lists the story above the books in simple
      // words, with one '이어서 만들기' that only opens it (nothing runs).
      const simpleLibrary = await page.evaluate((id) => {
        const section = document.querySelector(
            '#full-auto-jobs[data-simple="true"]',
          ),
          card = section?.querySelector(`[data-auto-job="${id}"]`),
          shelf = document.querySelector(".shelf-header");
        return {
          card: !!card,
          label: card?.querySelector(".role-tag")?.textContent || "",
          open:
            card?.querySelectorAll('[data-full-auto-action="simple-open"]')
              .length || 0,
          runs:
            card?.querySelectorAll(
              '[data-full-auto-action="resume"],[data-full-auto-action="review"]',
            ).length || 0,
          aboveBooks: !!(
            section &&
            shelf &&
            section.compareDocumentPosition(shelf) &
              Node.DOCUMENT_POSITION_FOLLOWING
          ),
        };
      }, jobId);
      result.steps.simpleLibrary = simpleLibrary;
      if (
        !simpleLibrary.card ||
        simpleLibrary.open !== 1 ||
        simpleLibrary.runs ||
        !simpleLibrary.aboveBooks ||
        /FULL AUTO/.test(simpleLibrary.label)
      )
        problem(
          `쉬운 모드 책장의 ‘제작 중인 이야기’가 달라요: ${JSON.stringify(simpleLibrary)}`,
        );
      await shot("06a2-simple-library");
      // The pro library card's 이어서 만들기 runs the job (the simple card only opens it).
      await click('.top-actions [data-action="toggle-ui-mode"]');
      const resume = page.locator(
        `[data-full-auto-action="resume"][data-id="${jobId}"]`,
      );
      if (!(await resume.count()))
        problem("책장에 멈춘 이야기의 ‘이어서 만들기’가 없어요.");
      else {
        await resume.first().click();
        await page.waitForFunction(
          (id) =>
            ["review", "failed", "paused"].includes(
              JSON.parse(localStorage.getItem("donghwa-workshop-v1"))
                .fullAutoJobs?.[id]?.status,
            ),
          jobId,
          { timeout: 180000 },
        );
        await page.waitForTimeout(400);
        result.steps.resumeAsked = await page.locator(".modal-overlay").count();
      }
      const resumed = await jobPage(jobId, 1);
      result.steps.resumedRun = resumed;
      if (resumed.status !== "review")
        problem(
          `책장에서 이어 만들기가 끝나지 않았어요: ${resumed.error || resumed.status}`,
        );
      if (
        resumed.asset !== keptAsset ||
        resumed.marker !== keptAsset ||
        resumed.stale
      )
        problem(
          `그림을 그대로 둔 쪽을 이어 만들기가 다시 그렸어요: ${JSON.stringify(resumed)}`,
        );
      await shot("06b-resumed");
      await click('.top-actions [data-action="toggle-ui-mode"]');
      // Back to ④ from the simple card: every picture is there, page 2 still
      // kept, and ④ opens on the page the parent last looked at (R11).
      await click(`[data-full-auto-action="simple-open"][data-id="${jobId}"]`);
      await page.waitForTimeout(500);
      if ((await step()) !== 4) problem("완성 초안 검토가 ④로 열리지 않아요.");
      result.steps.reopenedOnPage = await page
        .locator(".simple-page-no")
        .textContent();
      if (!/^2 \//.test(result.steps.reopenedOnPage || ""))
        problem(
          `다시 연 ④가 마지막으로 본 쪽이 아니에요: ${result.steps.reopenedOnPage}`,
        );
      result.steps.allImages = await page
        .locator("#simple-image-count")
        .textContent();
      const [done, total] = (
        result.steps.allImages.match(/(\d+)\s*\/\s*(\d+)/) || []
      )
        .slice(1)
        .map(Number);
      imagesOk = !!total && done === total;
      if (!imagesOk) {
        const message =
          (await toastText()) +
          " " +
          ((await page
            .locator(".simple-review .pin-error")
            .textContent()
            .catch(() => "")) || "");
        if (KNOWN_IMAGE_BUG.test(message)) result.imageBug ||= message;
        else problem(`모든 쪽 그림을 만들지 못했어요: ${message}`);
      }
      if (!/그림 8 \/ 8 · 글 바뀐 쪽 1/.test(result.steps.allImages))
        problem(`이어 만든 뒤 표시가 달라요: ${result.steps.allImages}`);
      await shot("06c-all-images");
    }
    if (imagesOk) {
      // While page 1 is being redrawn here, the pro library's 완성 초안 검토
      // must not open the same book in the pro editor.
      // Page 1 of the reopened story.
      await firstPage();
      const firstBefore = (await jobPage(jobId, 0)).asset;
      await page.evaluate(() => {
        window.__smokeImageDelay = 4000;
      });
      await click('[data-simple-action="redraw-page"]');
      await confirmIfAsked();
      await page.waitForSelector(".simple-progress", { timeout: 10000 });
      await click('.top-actions [data-action="toggle-ui-mode"]');
      const proReview = page.locator(
        `[data-full-auto-action="review"][data-id="${jobId}"]`,
      );
      const guard = { card: await proReview.count() };
      if (guard.card) {
        await proReview.first().click();
        await page.waitForTimeout(300);
        guard.toast = await toastText();
        guard.editor = await page.locator(".ig-editor-bar").count();
      }
      // FIX-UI-3: the '이어 만들 이야기' card of the same story is a review
      // ('검수 열기', never the story workflow's 이어서 만들기), and it is
      // refused the same way while the page is being drawn.
      const draftCard = page.locator(
        `[data-story-action="open-auto-review"][data-job-id="${jobId}"]`,
      );
      guard.draftCard = await draftCard.count();
      guard.draftResume = await page.evaluate((id) => {
        const s = JSON.parse(localStorage.getItem("donghwa-workshop-v1"));
        const storyId = s.fullAutoJobs?.[id]?.storyDraftId;
        return document.querySelectorAll(
          `[data-story-action="resume"][data-id="${storyId}"]`,
        ).length;
      }, jobId);
      if (guard.draftCard) {
        await page.evaluate(() => {
          const t = document.querySelector("#toast");
          if (t) t.textContent = "";
        });
        await draftCard.first().click();
        await page.waitForTimeout(300);
        guard.draftToast = await toastText();
        guard.draftEditor = await page.locator(".ig-editor-bar").count();
        guard.draftWorkflow = await page
          .locator("#modal-root .story-workspace")
          .count();
      }
      await page.evaluate(() => {
        window.__smokeImageDelay = 0;
      });
      await click('.top-actions [data-action="toggle-ui-mode"]');
      await idle();
      guard.step = await step();
      guard.redrawn = (await jobPage(jobId, 0)).asset !== firstBefore;
      guard.keptStill = (await jobPage(jobId, 1)).marker === keptAsset;
      result.steps.proReviewWhileDrawing = guard;
      if (!guard.card) problem("프로 모드에 ‘완성 초안 검토’ 카드가 없어요.");
      else if (
        !/진행 중인 작업이 끝난 뒤 열어 주세요/.test(guard.toast || "") ||
        guard.editor
      )
        problem(
          `그림을 만드는 중에 프로 편집기가 같은 책을 열었어요: ${JSON.stringify(guard)}`,
        );
      if (guard.step !== 4 || !guard.redrawn || !guard.keptStill)
        problem(
          `쪽 그림 다시 만들기 뒤 ④가 이상해요: ${JSON.stringify(guard)}`,
        );
      if (!guard.draftCard || guard.draftResume)
        problem(
          `‘이어 만들 이야기’에 FULL AUTO 초안이 ‘검수 열기’로 나오지 않아요: ${JSON.stringify(guard)}`,
        );
      else if (
        !/진행 중인 작업이 끝난 뒤 열어 주세요/.test(guard.draftToast || "") ||
        guard.draftEditor ||
        guard.draftWorkflow
      )
        problem(
          `그림을 만드는 중에 ‘이어 만들 이야기’가 같은 책을 열었어요: ${JSON.stringify(guard)}`,
        );
      // With nothing in flight, '검수 열기' opens the job's own book in the pro
      // editor: no rebuild, so every paid picture stays (the R9 round-4 drop).
      const stored = () =>
        page.evaluate((id) => {
          const s = JSON.parse(localStorage.getItem("donghwa-workshop-v1"));
          const job = s.fullAutoJobs?.[id];
          return {
            bookId: job?.book?.id || null,
            pages: (job?.book?.pages || []).map((p) => p.imageAssetId || null),
            final: (job?.book?.pages || []).filter(
              (p) => p.imageMeta?.quality === "final",
            ).length,
            cover: job?.book?.cover?.imageAssetId || null,
            history: (job?.book?.pages || []).reduce(
              (n, p) => n + (p.imageHistory?.length || 0),
              0,
            ),
            usage: Object.keys(job?.imageUsage || {}).length,
          };
        }, jobId);
      const beforeOpen = await stored();
      await click('.top-actions [data-action="toggle-ui-mode"]');
      const idleCard = page.locator(
        `[data-story-action="open-auto-review"][data-job-id="${jobId}"]`,
      );
      const draftOpen = { card: await idleCard.count() };
      if (draftOpen.card) {
        await idleCard.first().click();
        await page.waitForTimeout(800);
        draftOpen.editor = await page.locator(".ig-editor-bar").count();
        draftOpen.workflow = await page
          .locator("#modal-root .story-workspace")
          .count();
        // The pro editor's 이야기 글 다시 다듬기 does not rebuild it either.
        if (draftOpen.editor) {
          await page.evaluate(() => {
            const t = document.querySelector("#toast");
            if (t) t.textContent = "";
          });
          await click('[data-action="regenerate-text"]');
          draftOpen.regenerateToast = await toastText();
          draftOpen.regenerateWorkflow = await page
            .locator("#modal-root .story-workspace")
            .count();
        }
      }
      const afterOpen = await stored();
      draftOpen.same = JSON.stringify(afterOpen) === JSON.stringify(beforeOpen);
      draftOpen.before = beforeOpen;
      draftOpen.after = afterOpen;
      result.steps.storyDraftCard = draftOpen;
      if (!draftOpen.card || !draftOpen.editor || draftOpen.workflow)
        problem(
          `‘검수 열기’가 프로 편집기에서 같은 책을 열지 않았어요: ${JSON.stringify(draftOpen)}`,
        );
      if (
        !draftOpen.same ||
        afterOpen.final !== afterOpen.pages.length ||
        afterOpen.pages.some((id) => !id)
      )
        problem(
          `‘이어 만들 이야기’로 연 책의 그림이 바뀌었어요: ${JSON.stringify(draftOpen)}`,
        );
      if (
        !/다시 엮지 않아요/.test(draftOpen.regenerateToast || "") ||
        draftOpen.regenerateWorkflow
      )
        problem(
          `프로 편집기의 ‘이야기 글 다시 다듬기’가 FULL AUTO 책을 다시 엮으려 했어요: ${JSON.stringify(draftOpen)}`,
        );
      await shot("06d-story-draft-review");
      // Back to ④ in the simple screen from the library card.
      await click('.top-actions [data-action="toggle-ui-mode"]');
      await click('button[data-action="nav"][data-view="library"]');
      if (
        await page
          .locator("#discard-confirm")
          .isVisible()
          .catch(() => false)
      )
        await click("#discard-confirm");
      await click(`[data-full-auto-action="simple-open"][data-id="${jobId}"]`);
      await page.waitForTimeout(500);
      if ((await step()) !== 4)
        problem("‘검수 열기’ 뒤 책장 카드로 ④에 돌아오지 못했어요.");
    }
    // ⑤ finish
    await click('[data-simple-action="to-finish"]');
    if ((await step()) !== 5) problem("⑤로 넘어가지 않았어요.");
    const titles = page.locator('input[name="simple-title"]');
    if ((await titles.count()) > 1) {
      await titles.nth(1).check();
      await page.waitForTimeout(400);
    }
    result.steps.title = await page
      .locator('input[name="simple-title"]:checked')
      .inputValue()
      .catch(() => "");
    await shot("07-finish");
    if (imagesOk) {
      // Stale-only save: '그림 그대로 저장' approves without drawing anything.
      // A redraw would give the page a new asset id and drop its kept marker.
      const pictures = (bookId) =>
        page.evaluate((id) => {
          const s = JSON.parse(localStorage.getItem("donghwa-workshop-v1"));
          const job = Object.values(s.fullAutoJobs || {}).find((j) =>
            id
              ? j.book?.id === id
              : j.book?.pages?.length && !j.simpleAbandoned,
          );
          const saved = (s.books || []).find((b) => b.id === id),
            book = saved || job?.book,
            pages = book?.pages || [];
          return {
            bookId: book?.id || null,
            pages: pages.map((p) => p.imageAssetId || null),
            cover: book?.cover?.imageAssetId || null,
            stale: pages.filter((p) => p.imageStale === true).length,
            kept: pages.filter(
              (p) =>
                p.simpleTextEditedAssetId &&
                p.simpleTextEditedAssetId === p.imageAssetId,
            ).length,
            usage: Object.keys(job?.imageUsage || {}).length,
            saved: !!saved,
          };
        }, bookId || null);
      const beforeSave = await pictures();
      await click('[data-simple-action="save-book"]');
      const keep = page.locator("#simple-choice-keep");
      if (!(await keep.isVisible().catch(() => false))) {
        problem("글만 고친 쪽이 있는데 ‘그림 그대로 저장’을 묻지 않았어요.");
        await confirmIfAsked();
      } else {
        result.steps.staleChoice = await page
          .locator(".simple-choices")
          .innerText();
        await shot("07b-stale-choice");
        await keep.click();
      }
      await page.waitForSelector(".detail-layout", { timeout: 90000 });
      const afterSave = await pictures(beforeSave.bookId);
      result.steps.keptPictures = {
        same:
          JSON.stringify(afterSave.pages) ===
            JSON.stringify(beforeSave.pages) &&
          afterSave.cover === beforeSave.cover,
        keptBefore: beforeSave.kept,
        keptAfter: afterSave.kept,
        staleBefore: beforeSave.stale,
        staleAfter: afterSave.stale,
        imageRecordsBefore: beforeSave.usage,
        saved: afterSave.saved,
      };
      if (
        !result.steps.keptPictures.same ||
        beforeSave.kept !== 1 ||
        afterSave.kept !== 1 ||
        beforeSave.stale ||
        afterSave.stale
      )
        problem(
          "‘그림 그대로 저장’이 그림을 새로 만들었거나 둔 그림 표시를 잃었어요.",
        );
      if (!afterSave.saved) problem("책장에 저장되지 않았어요.");
      await shot("08-saved");
      // Reload, the shelf still has the book, and it opens.
      await page.reload({ waitUntil: "networkidle" });
      const card = page
        .locator(".book-card", { hasText: result.steps.title })
        .first();
      if (!(await card.count())) problem("다시 접속한 책장에 새 책이 없어요.");
      else {
        await card.locator('[data-action="open-book"]').first().click();
        await page.waitForSelector(".detail-layout", { timeout: 20000 });
        result.steps.reopened = await page
          .locator(".detail-info h2")
          .textContent();
        await shot("09-reopened");
      }
    } else {
      result.steps.saveSkipped =
        "그림 오류로 책장 저장·다시 접속·열기는 건너뛰었어요 (텍스트 단계만 검증).";
    }
    // R11: a free demo story's frozen ① and '이 주제로 새로 만들기': the old
    // story stays exactly as it was (still listed), the new one starts unbound
    // at ① with the same topic, and nothing new is made until ③ 글 만들기.
    {
      const fork = {};
      await click('button[data-action="nav"][data-view="library"]');
      if (
        await page
          .locator("#discard-confirm")
          .isVisible()
          .catch(() => false)
      )
        await click("#discard-confirm");
      await click('[data-action="new-story"]');
      // A reload above locked the parent screens again: unlock with the PIN.
      if (
        await page
          .locator("#pin-form #pin")
          .isVisible()
          .catch(() => false)
      ) {
        await page.fill("#pin-form #pin", "1234");
        await page.click("#pin-form button[type=submit]");
        await page.waitForTimeout(800);
      }
      await page.waitForSelector("#topic", { timeout: 10000 });
      fork.start = await step();
      await page.fill("#topic", "바닷가에서 조개 줍는 날");
      await click('[data-simple-action="next"]');
      await click('[data-simple-action="next"]');
      await click('[data-simple-action="start-demo"]');
      await page.waitForSelector('.simple-create[data-simple-step="4"]', {
        timeout: 90000,
      });
      await page.waitForTimeout(500);
      const forkJob = (await jobPage(null, 0)).jobId,
        before = await storedJob(forkJob),
        jobs = await jobCount();
      await click('[data-simple-action="goto-step"][data-step="1"]');
      fork.frozenTopic = await page
        .locator(".simple-frozen-topic")
        .textContent()
        .catch(() => "");
      await click('[data-simple-action="fork"]');
      fork.asked = await page
        .locator(".simple-confirm")
        .textContent()
        .catch(() => "");
      fork.okLabel = await page
        .locator("#simple-confirm-yes")
        .textContent()
        .catch(() => "");
      await shot("10-fork-confirm");
      await click("#simple-confirm-yes");
      await page.waitForTimeout(300);
      fork.step = await step();
      fork.topic = await page
        .locator("#topic")
        .inputValue()
        .catch(() => "");
      fork.idea = await page.locator('[data-simple-action="idea"]').count();
      fork.same = (await storedJob(forkJob)) === before;
      fork.newJobs = (await jobCount()) - jobs;
      await shot("11-forked");
      // R11 review fix: Back after 새로 만들기 passes over the old story's
      // entries without a word (no '③에서 글을 먼저…' toast) and stays in the app.
      await clearToast();
      await historyMove(-1);
      await page.waitForTimeout(600);
      fork.backToast = await shownToast();
      fork.backInApp = inApp();
      fork.backStep = await step();
      await click('button[data-action="nav"][data-view="library"]');
      fork.leaveDialog = await page
        .locator("#discard-confirm")
        .isVisible()
        .catch(() => false);
      if (fork.leaveDialog) await click("#discard-confirm");
      fork.listed = await page
        .locator(`[data-full-auto-action="simple-open"][data-id="${forkJob}"]`)
        .count();
      result.steps.fork = fork;
      if (
        fork.start !== 1 ||
        fork.frozenTopic.trim() !== "바닷가에서 조개 줍는 날" ||
        !/이어서 만들기/.test(fork.asked) ||
        !/데모는 무료/.test(fork.asked) ||
        fork.okLabel.trim() !== "새 이야기로 고치기" ||
        fork.step !== 1 ||
        fork.topic !== "바닷가에서 조개 줍는 날" ||
        !fork.idea ||
        !fork.same ||
        fork.newJobs !== 0 ||
        fork.leaveDialog ||
        fork.listed !== 1
      )
        problem(`‘이 주제로 새로 만들기’가 이상해요: ${JSON.stringify(fork)}`);
      if (fork.backToast || !fork.backInApp)
        problem(
          `새로 만들기 뒤 뒤로 가기가 엉뚱한 알림을 띄우거나 앱을 떠났어요: ${JSON.stringify(fork)}`,
        );
    }
    // R11 review fix: a story reopened from the library card at ③. Back while
    // its text run is live leaves inside the app (the guarded way to the
    // library), so the run goes on and holds at the text. All free (demo).
    {
      const reopen = {};
      const topic = "바닷가에서 조개 줍는 날";
      await click('button[data-action="nav"][data-view="create"]');
      reopen.start = await step();
      if (reopen.start === 1 && (await page.locator("#topic").count()))
        await page.fill("#topic", topic);
      await click('[data-simple-action="next"]');
      await click('[data-simple-action="next"]');
      await page.evaluate(() => {
        window.__smokeLockDelay = 4000;
      });
      await click('[data-simple-action="start-demo"]');
      await click('[data-simple-action="stop"]');
      await page.waitForSelector('[data-simple-action="retry"]', {
        timeout: 20000,
      });
      const stopped = await page.evaluate(
        (t) =>
          Object.values(
            JSON.parse(localStorage.getItem("donghwa-workshop-v1"))
              .fullAutoJobs || {},
          )
            .filter((j) => j.wizard?.topic === t && !j.book)
            .sort((a, b) =>
              String(b.updatedAt).localeCompare(String(a.updatedAt)),
            )[0] || null,
        topic,
      );
      reopen.stoppedStatus = stopped?.status || null;
      await click('button[data-action="nav"][data-view="library"]');
      if (
        await page
          .locator("#discard-confirm")
          .isVisible()
          .catch(() => false)
      )
        await click("#discard-confirm");
      await click(
        `[data-full-auto-action="simple-open"][data-id="${stopped?.id}"]`,
      );
      reopen.opened = await step();
      await page.evaluate(() => {
        window.__smokeLockDelay = 6000;
      });
      await click('[data-simple-action="retry"]');
      reopen.live = await page
        .locator('[data-simple-action="stop"]')
        .isVisible()
        .catch(() => false);
      await historyMove(-1);
      reopen.inApp = inApp();
      reopen.afterBack = await step();
      reopen.library = await page.locator(".shelf-header").count();
      await page.evaluate(() => {
        window.__smokeLockDelay = 0;
      });
      reopen.finished = await page
        .waitForFunction(
          (id) =>
            ["text-review", "failed", "paused"].includes(
              JSON.parse(localStorage.getItem("donghwa-workshop-v1"))
                .fullAutoJobs?.[id]?.status,
            ),
          stopped?.id,
          { timeout: 60000 },
        )
        .then(() => true)
        .catch(() => false);
      reopen.status = (await jobPage(stopped?.id, 0)).status;
      reopen.book = !!(await page.evaluate(
        (id) =>
          JSON.parse(localStorage.getItem("donghwa-workshop-v1"))
            .fullAutoJobs?.[id]?.book,
        stopped?.id,
      ));
      result.steps.reopenBackLive = reopen;
      await shot("12-reopened-back");
      if (
        reopen.stoppedStatus !== "paused" ||
        reopen.opened !== 3 ||
        !reopen.live ||
        !reopen.inApp ||
        reopen.afterBack !== 0 ||
        !reopen.library ||
        reopen.status !== "text-review" ||
        !reopen.book
      )
        problem(
          `다시 연 이야기의 뒤로 가기가 앱을 떠나거나 글 만들기를 끊었어요: ${JSON.stringify(reopen)}`,
        );
    }
  } catch (error) {
    problem("스크립트 오류: " + error.message);
    await page
      .screenshot({
        path: path.join(OUT, `${width}-error.png`),
        fullPage: true,
      })
      .catch(() => {});
  }
  if (result.pageErrors.length)
    problem("페이지 오류: " + result.pageErrors.join(" | "));
  if (result.paidRequests.length)
    problem("유료 요청: " + result.paidRequests.join(" | "));
  if (result.overflow.length)
    problem(
      "가로 넘침: " +
        result.overflow.map((o) => `${o.step} ${o.px}px`).join(", "),
    );
  if (result.problems.length) failed = true;
  report.runs.push(result);
  await ctx.close();
}

for (const width of [1280, 390]) await run(width);
await browser.close();
fs.writeFileSync(path.join(OUT, "smoke.json"), JSON.stringify(report, null, 2));
for (const r of report.runs) {
  console.log(`\n## ${r.width}px`);
  console.log(JSON.stringify(r.steps));
  if (r.imageBug)
    console.log(
      `KNOWN IMAGE BUG (FIX-B1 item 6, forbidden_style_name): ${r.imageBug}\n그림 단계는 건너뛰고 텍스트 단계만 확인했어요.`,
    );
  console.log(
    r.problems.length ? "FAIL\n- " + r.problems.join("\n- ") : "PASS",
  );
}
process.exit(failed ? 1 : 0);
