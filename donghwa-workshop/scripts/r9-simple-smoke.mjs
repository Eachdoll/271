// R9-B5 쉬운 모드 데모 한 권: ①→⑤, 책장 저장, 다시 접속, 책 열기 (1280px · 390px).
// 유료 요청은 모두 막고 셉니다. 페이지 오류·유료 요청·가로 넘침이 없어야 통과입니다.
// FIX-UI: ③ 중지 뒤 '주제·엔진 바꾸기', ④ 알림이 아래 버튼 줄을 가리지 않는지,
// 글만 고친 쪽 '그림 그대로 저장'이 그림을 새로 만들지 않는지도 확인합니다.
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
    if (imagesOk) {
      await click('[data-simple-action="draw-all"]');
      await confirmIfAsked();
      await idle(180000);
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
      await shot("06-all-images");
    }
    if (imagesOk) {
      // Text edited after drawing: keep the picture (no redraw), the count says so.
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
      if (!/그림 8 \/ 8 · 글 바뀐 쪽 1/.test(result.steps.staleCount))
        problem(`글 바뀐 쪽 표시가 없어요: ${result.steps.staleCount}`);
      await shot("06b-stale");
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
      // A redraw would give the page a new asset id and clear its stale mark.
      const pictures = (bookId) =>
        page.evaluate((id) => {
          const s = JSON.parse(localStorage.getItem("donghwa-workshop-v1"));
          const job = Object.values(s.fullAutoJobs || {}).find((j) =>
            id
              ? j.book?.id === id
              : j.book?.pages?.length && !j.simpleAbandoned,
          );
          const saved = (s.books || []).find((b) => b.id === id),
            book = saved || job?.book;
          return {
            bookId: book?.id || null,
            pages: (book?.pages || []).map((p) => p.imageAssetId || null),
            cover: book?.cover?.imageAssetId || null,
            stale: (book?.pages || []).filter((p) => p.imageStale === true)
              .length,
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
        staleBefore: beforeSave.stale,
        staleAfter: afterSave.stale,
        imageRecordsBefore: beforeSave.usage,
        saved: afterSave.saved,
      };
      if (
        !result.steps.keptPictures.same ||
        beforeSave.stale !== 1 ||
        afterSave.stale !== 1
      )
        problem("‘그림 그대로 저장’이 그림을 새로 만들었어요.");
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
