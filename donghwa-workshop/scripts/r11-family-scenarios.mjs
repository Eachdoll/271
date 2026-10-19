// 사용: FAMILY_SIGNUP_CODE=<서버와 같은 코드> PLAYWRIGHT_MODULE=<playwright> node scripts/r11-family-scenarios.mjs <r11-family-e2e 주소> [출력폴더] [너비들=1280,390] — 두 기기 가족 계정 흐름을 걷습니다.
//
// Walks two browser devices (A: a PC with the family's books, B: a new phone)
// against scripts/r11-family-e2e.mjs (the real server/cloud-api.js with an
// in-memory D1/R2):
//   1. A: sign-up with a wrong invite (refused, no account), then the right one;
//      the one-time recovery code stays after Escape and browser Back, even on
//      a story reopened from the library card.
//   2. A: finishes the demo book, saves it to the shelf and to the cloud; a
//      cloud pull asked from ① of the next story and cancelled shows the library.
//   3. B: logs in and receives it without a source choice (sample-only device).
//   4. B: reading in child mode is no change and no conflict; A's next change
//      reaches B without a conflict and B keeps its reading count.
//   5. A wrong password (B: password change, A: login on a locked device)
//      leaves the sync state as it was.
//   6. A: logout on the story's ④ locks the device; the right password on the
//      lock screen unlocks it to the library; after another logout,
//      '이 기기 자료로 계속 쓰기' (PIN) keeps this device's books.
//   7. A: recovery with the code (new code shown); B is signed out by it.
//   8. A: password change keeping, then signing out, the other devices.
//   9. A: account delete; A keeps its books, the server keeps nothing.
// Paid model hosts are blocked and counted; a run passes with no problem,
// no page error and no paid request.
import fs from "node:fs";
import path from "node:path";

const BASE = (process.argv[2] || "http://127.0.0.1:4800/").replace(/\/?$/, "/");
const OUT = process.argv[3] || "QA/r11-family";
const WIDTHS = String(process.argv[4] || "1280,390")
  .split(",")
  .map(Number)
  .filter((width) => width > 0);
const INVITE = process.env.FAMILY_SIGNUP_CODE || "";
const PIN = "1234";
const PAID =
  /api\.anthropic\.com|api\.openai\.com|generativelanguage|fal\.run|bfl\.ai/;
const SESSION_KEY = "donghwa-family-session-v1",
  SYNC_KEY = "donghwa-cloud-sync-v1",
  LIBRARY_KEY = "donghwa-workshop-v1";
if (INVITE.trim().length < 20) {
  console.error("FAMILY_SIGNUP_CODE(서버와 같은 20자 이상 코드)가 필요해요.");
  process.exit(2);
}
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const executablePath =
  process.env.CHROMIUM_PATH ||
  (fs.existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});
const serverJSON = async (name) =>
  (await fetch(new URL("__test/" + name, BASE))).json();
const random = () =>
  Array.from({ length: 5 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");

async function run(width) {
  const height = width < 500 ? 844 : 900;
  const result = {
    width,
    steps: {},
    problems: [],
    pageErrors: [],
    paidRequests: [],
    overflow: [],
  };
  const problem = (message, detail) =>
    result.problems.push(
      detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`,
    );
  const check = (ok, message, detail) => {
    if (!ok) problem(message, detail);
    return ok;
  };
  const USER = `mom_${width}_${random()}`,
    // Server log entries of this run only (the server keeps earlier runs).
    RUN = `${width}-${random()}`;
  const PASS = [
    "tulip-garden-42",
    "maple-river-77!",
    "cedar-lantern-58",
    "quiet-harbor-93",
  ];

  async function device(name) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      locale: "ko-KR",
      serviceWorkers: "block",
      extraHTTPHeaders: { "X-E2E-Device": `${RUN}-${name}` },
    });
    const page = await ctx.newPage();
    page.on("pageerror", (error) =>
      result.pageErrors.push(`${name}: ${error.message}`),
    );
    await ctx.route(PAID, (route) => {
      result.paidRequests.push(route.request().url());
      return route.abort();
    });
    const wait = (ms) => page.waitForTimeout(ms);
    const visible = (selector) =>
      page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false);
    const d = {
      name,
      ctx,
      page,
      wait,
      visible,
      async click(selector) {
        await page.locator(selector).first().click();
        await wait(300);
      },
      ls: (key) => page.evaluate((k) => localStorage.getItem(k), key),
      chip: () =>
        page
          .locator(".status-chip")
          .textContent()
          .catch(() => ""),
      async waitChip(pattern, timeout = 30000) {
        await page
          .waitForFunction(
            (source) =>
              new RegExp(source).test(
                document.querySelector(".status-chip")?.textContent || "",
              ),
            pattern.source,
            { timeout },
          )
          .catch(() => {});
        return d.chip();
      },
      step: async () =>
        Number(
          await page
            .locator(".simple-create")
            .getAttribute("data-simple-step", { timeout: 1000 })
            .catch(() => 0),
        ),
      modalTitle: () =>
        page.evaluate(
          () =>
            document.querySelector("#modal-root .modal h3")?.textContent ||
            null,
        ),
      async closeModal() {
        await page.evaluate(() =>
          document
            .querySelector('#modal-root .modal-header [data-action="close-modal"]')
            ?.click(),
        );
        await wait(300);
      },
      /** The parent PIN, if a PIN prompt (not the first setup) is open. */
      async pinIfAsked() {
        await wait(200);
        if (
          (await visible("#pin-form")) &&
          !(await page.locator("#pin-confirm").count())
        ) {
          await page.fill("#pin", PIN);
          await page.click("#pin-form button[type=submit]");
          await wait(900);
        }
      },
      async setPin() {
        await d.click('button[data-action="nav"][data-view="settings"]');
        await page.fill("#pin", PIN);
        await page.fill("#pin-confirm", PIN);
        await page.click("#pin-form button[type=submit]");
        await wait(900);
      },
      async openPanel() {
        if (!(await page.locator(".cloud-panel").count()))
          await d.click(".status-chip");
        await page.waitForSelector(".cloud-panel", { timeout: 10000 });
      },
      async manage(action) {
        await d.openPanel();
        await page.evaluate(() => {
          const details = document.querySelector(".cloud-panel details.family-manage");
          if (details) details.open = true;
        });
        await d.click(`.cloud-panel [data-action="${action}"]`);
        await d.pinIfAsked();
      },
      /** Focus: the app re-checks the cloud (like coming back to the tab). */
      async refresh() {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await wait(2000);
      },
      async shot(label) {
        await wait(200);
        await page.screenshot({
          path: path.join(OUT, `${width}-${name}-${label}.png`),
          fullPage: true,
        });
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (over > 1) result.overflow.push({ device: name, label, px: over });
      },
      async authError() {
        await page
          .waitForFunction(
            () =>
              document.querySelector("#family-auth-error")?.textContent.trim(),
            null,
            { timeout: 30000 },
          )
          .catch(() => {});
        return (
          (await page
            .locator("#family-auth-error")
            .textContent()
            .catch(() => "")) || ""
        ).trim();
      },
      async waitFormGone(selector = "#family-auth-form") {
        await page
          .waitForFunction((s) => !document.querySelector(s), selector, {
            timeout: 30000,
          })
          .catch(() => {});
        await wait(1200);
      },
      book: (title) =>
        page.evaluate(
          ([key, t]) =>
            (JSON.parse(localStorage.getItem(key) || "{}").books || []).find(
              (b) => b.title === t,
            ) || null,
          [LIBRARY_KEY, title],
        ),
      toast: () =>
        page.evaluate(() => document.querySelector("#toast")?.textContent || ""),
    };
    await page.goto(BASE, { waitUntil: "networkidle" });
    await wait(800);
    return d;
  }
  const deviceLog = async (name, filter = () => true) =>
    (await serverJSON("log")).filter(
      (entry) => entry.device === `${RUN}-${name}` && filter(entry),
    );
  const libraryWrites = (name) =>
    deviceLog(
      name,
      (e) =>
        e.method === "PUT" &&
        (e.path === "/api/cloud/library" ||
          e.path.startsWith("/api/cloud/media/")),
    ).then((list) => list.length);
  const libraryReads = (name) =>
    deviceLog(
      name,
      (e) => e.path.startsWith("/api/cloud/library") || e.path.startsWith("/api/cloud/media/"),
    ).then((list) => list.length);

  const A = await device("A");
  let title = "",
    bookId = "",
    code = "";
  try {
    // ---- 1. A: a story under review, reopened from the library card -------------
    await A.setPin();
    await A.click('button[data-action="nav"][data-view="create"]');
    await A.page.fill("#topic", "공룡 친구와 숲으로 소풍 가는 날");
    await A.click('[data-simple-action="format"]');
    await A.page.selectOption("#pageCount", "8");
    await A.click('[data-simple-action="next"]');
    await A.click('[data-simple-action="next"]');
    await A.click('[data-simple-action="start-demo"]');
    await A.page.waitForSelector('.simple-create[data-simple-step="4"]', {
      timeout: 90000,
    });
    await A.wait(800);
    await A.click('button[data-action="nav"][data-view="library"]');
    if (await A.visible("#discard-confirm")) await A.click("#discard-confirm");
    await A.page.waitForSelector('[data-full-auto-action="simple-open"]', {
      timeout: 10000,
    });
    await A.click('[data-full-auto-action="simple-open"]');
    await A.wait(600);
    check((await A.step()) === 4, "책장 카드로 다시 연 이야기가 ④가 아니에요", await A.step());

    // ---- sign-up from the status chip: a wrong invite, then the right one -------
    await A.openPanel();
    await A.click('.cloud-panel [data-action="family-signup"]');
    await A.page.fill("#family-username", USER);
    await A.page.fill("#family-password", PASS[0]);
    await A.page.fill("#family-invite", "wrong-invite-" + random() + "-0000");
    await A.page.click("#family-auth-submit");
    const wrongInvite = {
      error: await A.authError(),
      code: await A.page.locator("#family-recovery-code").count(),
      server: await serverJSON("state"),
    };
    result.steps.wrongInvite = wrongInvite;
    check(
      wrongInvite.error === "가족 초대 코드가 맞지 않아요." &&
        wrongInvite.code === 0,
      "틀린 초대 코드가 거절되지 않았어요",
      wrongInvite,
    );
    await A.page.fill("#family-invite", INVITE);
    await A.page.click("#family-auth-submit");
    await A.page.waitForSelector("#family-recovery-code", { timeout: 30000 });
    code = (await A.page.locator("#family-recovery-code").textContent()).trim();
    check(/^[0-9A-Z]{4}(?:-[0-9A-Z]{4}){4}$/.test(code), "복구 코드 모양이 달라요", code);
    await A.shot("01-recovery-code");
    // Escape and the browser's Back never take the one-time code away.
    await A.page.keyboard.press("Escape");
    await A.wait(400);
    const kept = { escape: await A.page.locator("#family-recovery-code").count() };
    for (let n = 1; n <= 2; n++) {
      await A.page.evaluate(() => history.back());
      await A.wait(1200);
      kept["back" + n] = {
        code: await A.page
          .locator("#family-recovery-code")
          .textContent()
          .catch(() => null),
        title: await A.modalTitle(),
        step: await A.step(),
      };
    }
    result.steps.recoveryKept = kept;
    check(
      kept.escape === 1 &&
        [kept.back1, kept.back2].every(
          (k) =>
            k.code?.trim() === code &&
            k.title === "복구 코드를 적어 두세요" &&
            k.step === 4,
        ),
      "뒤로 가기 뒤 복구 코드가 사라졌거나 단계가 바뀌었어요",
      kept,
    );
    await A.page.check("#family-recovery-saved");
    await A.click("#family-recovery-done");
    await A.wait(1500);
    result.steps.afterSignup = {
      chip: await A.chip(),
      session: !!(await A.ls(SESSION_KEY)),
      server: await serverJSON("state"),
    };
    check(
      result.steps.afterSignup.session &&
        result.steps.afterSignup.server.accounts >= 1,
      "가입 뒤 로그인 상태가 아니에요",
      result.steps.afterSignup,
    );
    check(
      (await libraryWrites("A")) === 0,
      "고르기 전에 이 기기 자료를 올렸어요",
    );
    await A.closeModal();

    // ---- 2. A: the demo book is finished, saved to the shelf and to the cloud ---
    check((await A.step()) === 4, "가입 뒤 ④가 아니에요", await A.step());
    await A.click('[data-simple-action="draw-all"]');
    if (await A.visible("#simple-confirm-yes")) await A.click("#simple-confirm-yes");
    await A.page.waitForFunction(
      () =>
        !document.querySelector(".simple-progress") &&
        !document.querySelector('[data-simple-action="stop"]') &&
        /그림 (\d+) \/ \1/.test(
          document.querySelector("#simple-image-count")?.textContent || "",
        ),
      null,
      { timeout: 120000 },
    );
    await A.wait(500);
    await A.click('[data-simple-action="to-finish"]');
    check((await A.step()) === 5, "⑤로 넘어가지 않았어요", await A.step());
    await A.click('[data-simple-action="save-book"]');
    if (await A.visible("#simple-choice-keep")) await A.click("#simple-choice-keep");
    else if (await A.visible("#simple-confirm-yes"))
      await A.click("#simple-confirm-yes");
    await A.page.waitForSelector(".detail-layout", { timeout: 90000 });
    title = (await A.page.locator(".detail-info h2").textContent()).trim();
    bookId = (await A.book(title))?.id || "";
    check(!!bookId, "책장에 저장되지 않았어요", title);
    await A.openPanel();
    await A.click('.cloud-panel [data-action="cloud-push"]');
    await A.pinIfAsked();
    await A.click("#cloud-action-confirm");
    const pushed = {
      chip: await A.waitChip(/클라우드에 저장됨/),
      baseline: JSON.parse((await A.ls(SYNC_KEY)) || "null")?.accountId || null,
      server: await serverJSON("state"),
    };
    result.steps.pushed = pushed;
    check(
      /클라우드에 저장됨/.test(pushed.chip) &&
        /^family:/.test(pushed.baseline || "") &&
        pushed.server.libraries >= 1 &&
        pushed.server.assets > 0,
      "A의 책이 클라우드에 저장되지 않았어요",
      pushed,
    );
    await A.closeModal();
    await A.shot("02-saved");

    // ---- 2b. A: a cloud pull asked from ① of a story in progress, then 취소 ----
    await A.click('button[data-action="nav"][data-view="create"]');
    await A.page.fill("#topic", "달빛 아래 숨바꼭질하는 고양이");
    await A.click('[data-simple-action="next"]');
    await A.click('[data-simple-action="next"]');
    await A.click('[data-simple-action="start-demo"]');
    await A.page.waitForSelector('.simple-create[data-simple-step="4"]', {
      timeout: 90000,
    });
    await A.click('[data-simple-action="goto-step"][data-step="1"]');
    check((await A.step()) === 1, "단계 표시로 ①에 가지 않았어요", await A.step());
    // The pull button is drawn disabled while a sync runs: open the panel when idle.
    for (let n = 0; n < 15; n++) {
      await A.openPanel();
      if (
        await A.page
          .locator('.cloud-panel [data-action="cloud-pull"]')
          .isEnabled()
      )
        break;
      await A.closeModal();
      await A.wait(1000);
    }
    await A.click('.cloud-panel [data-action="cloud-pull"]');
    await A.pinIfAsked();
    if (await A.visible("#discard-confirm")) await A.click("#discard-confirm");
    await A.page.waitForSelector("#cloud-action-confirm", { timeout: 10000 });
    await A.click('#modal-root .cloud-confirm [data-action="close-modal"]');
    const cancelled = {
      modal: await A.page.locator("#modal-root .modal-overlay").count(),
      step: await A.step(),
      breadcrumb: (await A.page.locator(".breadcrumb").textContent()) || "",
      shelf: await A.page.locator(".book-card", { hasText: title }).count(),
    };
    result.steps.pullCancelled = cancelled;
    check(
      cancelled.modal === 0 &&
        cancelled.step === 0 &&
        /우리 책장/.test(cancelled.breadcrumb) &&
        cancelled.shelf >= 1,
      "불러오기를 취소한 뒤 책장이 아니라 멈춘 단계 화면이 남았어요",
      cancelled,
    );

    // ---- 3. B: a new phone logs in and takes the family cloud without a choice --
    const B = await device("B");
    try {
      await B.setPin();
      await B.click('button[data-action="nav"][data-view="library"]');
      await B.page.evaluate(() => {
        window.__chips = [];
        setInterval(() => {
          const text = document.querySelector(".status-chip")?.textContent;
          if (text && window.__chips.at(-1) !== text) window.__chips.push(text);
        }, 40);
      });
      await B.click('[data-action="family-login"]');
      await B.page.fill("#family-username", USER);
      await B.page.fill("#family-password", PASS[0]);
      await B.page.click("#family-auth-submit");
      await B.waitFormGone();
      const received = {
        chip: await B.waitChip(/클라우드에 저장됨/),
        chips: await B.page.evaluate(() => window.__chips),
        book: !!(await B.book(title)),
        choiceModal: await B.page
          .locator("#modal-root")
          .textContent()
          .then((text) => /어느 (쪽|내용|자료)/.test(text || ""))
          .catch(() => false),
        writes: await libraryWrites("B"),
      };
      result.steps.received = received;
      check(
        /클라우드에 저장됨/.test(received.chip) &&
          received.book &&
          !received.chips.some((text) => /자료 연결하기/.test(text)) &&
          received.writes === 0,
        "B가 고르기 없이 클라우드 책장을 받지 못했어요",
        received,
      );
      await B.closeModal();
      await B.shot("03-received");

      // ---- 4. child-mode reading on B is no change and no conflict --------------
      await B.click('[data-action="toggle-mode"]');
      check(
        /부모 모드/.test(
          (await B.page.locator('[data-action="toggle-mode"]').textContent()) || "",
        ),
        "아이 모드로 바뀌지 않았어요",
      );
      await B.click(`[data-action="read-book"][data-id="${bookId}"]`);
      await B.page.waitForSelector(".reader-page", { timeout: 10000 });
      for (let n = 0; n < 3; n++) await B.click('[data-action="reader-next"]');
      await B.click('.reader-top [data-action="close-modal"]');
      await B.wait(2500);
      await B.refresh();
      const reading = {
        chip: await B.chip(),
        reads: (await B.book(title))?.reads || 0,
        writes: await libraryWrites("B"),
      };
      result.steps.childReading = reading;
      check(
        /클라우드에 저장됨/.test(reading.chip) &&
          reading.reads >= 1 &&
          reading.writes === 0,
        "아이 모드 읽기가 변경이나 충돌로 보여요",
        reading,
      );
      // A parent change on A reaches B without a conflict; B keeps its reading.
      const before = await libraryWrites("A");
      await A.click('button[data-action="nav"][data-view="library"]');
      await A.click(`.book-card [data-action="favorite"][data-id="${bookId}"]`);
      await A.pinIfAsked();
      // A saves on its own (1.5 s after the change): wait for its library PUT.
      for (let n = 0; n < 60 && (await libraryWrites("A")) <= before; n++)
        await A.wait(500);
      await A.waitChip(/클라우드에 저장됨/);
      check((await libraryWrites("A")) > before, "A의 즐겨찾기가 자동 저장되지 않았어요");
      await B.refresh();
      await B.page
        .waitForFunction(
          ([key, id]) =>
            (JSON.parse(localStorage.getItem(key) || "{}").books || []).find(
              (b) => b.id === id,
            )?.favorite === true,
          [LIBRARY_KEY, bookId],
          { timeout: 20000 },
        )
        .catch(() => {});
      const merged = {
        favorite: (await B.book(title))?.favorite === true,
        reads: (await B.book(title))?.reads || 0,
        chip: await B.chip(),
        writes: await libraryWrites("B"),
      };
      result.steps.remoteAfterReading = merged;
      check(
        merged.favorite &&
          merged.reads >= 1 &&
          /클라우드에 저장됨/.test(merged.chip) &&
          merged.writes === 0,
        "A의 변경이 B에 충돌 없이 오지 않았거나 읽기 기록이 사라졌어요",
        merged,
      );
      await B.click('[data-action="toggle-mode"]');
      await B.pinIfAsked();

      // ---- 5. a wrong password changes nothing (B: password change) -------------
      const kept5 = {
        session: await B.ls(SESSION_KEY),
        sync: await B.ls(SYNC_KEY),
        chip: await B.chip(),
      };
      await B.manage("family-password");
      await B.page.fill("#family-current-password", "not-the-password-9");
      await B.page.fill("#family-password", "another-secret-31");
      await B.page.click("#family-auth-submit");
      const wrongPassword = {
        error: await B.authError(),
        sameSession: (await B.ls(SESSION_KEY)) === kept5.session,
        sameSync: (await B.ls(SYNC_KEY)) === kept5.sync,
        chip: await B.chip(),
      };
      result.steps.wrongPasswordB = wrongPassword;
      check(
        wrongPassword.error === "아이디 또는 비밀번호가 맞지 않아요." &&
          wrongPassword.sameSession &&
          wrongPassword.sameSync &&
          wrongPassword.chip === kept5.chip,
        "틀린 비밀번호가 B의 동기화 상태를 바꿨어요",
        wrongPassword,
      );
      await B.closeModal();

      // ---- 6. A: logout locks; a wrong password keeps it so; the local escape ---
      // Locked while a parent screen (the story's ④) is open.
      await A.click('button[data-action="nav"][data-view="library"]');
      await A.click('[data-full-auto-action="simple-open"]');
      await A.wait(600);
      check((await A.step()) === 4, "책장 카드로 연 이야기가 ④가 아니에요", await A.step());
      const logout = async () => {
        await A.openPanel();
        await A.click('.cloud-panel [data-action="family-logout"]');
        await A.pinIfAsked();
        await A.page
          .waitForSelector(".cloud-lock-panel", { timeout: 20000 })
          .catch(() => {});
      };
      await logout();
      const locked = {
        lock: await A.page.locator(".cloud-lock-panel").count(),
        session: await A.ls(SESSION_KEY),
        sync: await A.ls(SYNC_KEY),
      };
      result.steps.logout = { lock: locked.lock, session: !!locked.session };
      check(locked.lock === 1 && !locked.session, "로그아웃 뒤 A가 잠기지 않았어요", result.steps.logout);
      await A.shot("06-locked");
      const readsBefore = await libraryReads("A");
      await A.click('[data-action="family-login"]');
      await A.page.fill("#family-username", USER);
      await A.page.fill("#family-password", "not-the-password-9");
      await A.page.click("#family-auth-submit");
      const wrongLogin = { error: await A.authError() };
      await A.closeModal();
      Object.assign(wrongLogin, {
        lock: await A.page.locator(".cloud-lock-panel").count(),
        session: await A.ls(SESSION_KEY),
        sameSync: (await A.ls(SYNC_KEY)) === locked.sync,
        libraryRequests: (await libraryReads("A")) - readsBefore,
      });
      result.steps.wrongPasswordA = wrongLogin;
      check(
        wrongLogin.error === "아이디 또는 비밀번호가 맞지 않아요." &&
          wrongLogin.lock === 1 &&
          wrongLogin.session === null &&
          wrongLogin.sameSync &&
          wrongLogin.libraryRequests === 0,
        "잠긴 기기에서 틀린 비밀번호가 상태를 바꿨어요",
        wrongLogin,
      );
      // The right password on the lock screen unlocks in place: the library,
      // never the parent screen that was open with parent mode now off.
      await A.click('[data-action="family-login"]');
      await A.page.fill("#family-username", USER);
      await A.page.fill("#family-password", PASS[0]);
      await A.page.click("#family-auth-submit");
      await A.waitFormGone();
      await A.closeModal();
      const unlocked = {
        lock: await A.page.locator(".cloud-lock-panel").count(),
        step: await A.step(),
        breadcrumb: (await A.page.locator(".breadcrumb").textContent()) || "",
        chip: await A.waitChip(/클라우드에 저장됨/),
      };
      result.steps.unlockInPage = unlocked;
      check(
        unlocked.lock === 0 &&
          unlocked.step === 0 &&
          /우리 책장/.test(unlocked.breadcrumb),
        "잠금이 풀린 뒤 책장이 아니라 이전 부모 화면이 보여요",
        unlocked,
      );
      await logout();
      check(
        (await A.page.locator(".cloud-lock-panel").count()) === 1,
        "다시 로그아웃한 A가 잠기지 않았어요",
      );
      await A.click('[data-action="cloud-continue-local"]');
      await A.page.waitForSelector("#pin-form", { timeout: 5000 });
      await A.page.fill("#pin", PIN);
      await A.page.click("#pin-form button[type=submit]");
      await A.page
        .waitForFunction(() => !document.querySelector(".cloud-lock-panel"), null, {
          timeout: 15000,
        })
        .catch(() => {});
      await A.wait(800);
      const local = {
        lock: await A.page.locator(".cloud-lock-panel").count(),
        sync: await A.ls(SYNC_KEY),
        shelf: await A.page.locator(".book-card", { hasText: title }).count(),
      };
      result.steps.continueLocal = local;
      check(
        local.lock === 0 && !local.sync && local.shelf >= 1,
        "‘이 기기 자료로 계속 쓰기’가 이 기기 책장을 열지 않았어요",
        local,
      );
      await A.shot("06b-local");

      // ---- 7. A: recovery with the code; every other device is signed out -------
      await A.click('[data-action="family-login"]');
      await A.click('[data-family-tab="recover"]');
      await A.page.fill("#family-username", USER);
      await A.page.fill("#family-recovery-input", code);
      await A.page.fill("#family-password", PASS[1]);
      await A.page.click("#family-auth-submit");
      await A.page.waitForSelector("#family-recovery-code", { timeout: 30000 });
      const code2 = (
        await A.page.locator("#family-recovery-code").textContent()
      ).trim();
      check(code2 && code2 !== code, "복구 뒤 새 복구 코드가 나오지 않았어요", { code, code2 });
      await A.page.check("#family-recovery-saved");
      await A.click("#family-recovery-done");
      await A.wait(1500);
      await A.closeModal();
      await B.refresh();
      const revoked = {
        lock: await B.page.locator(".cloud-lock-panel").count(),
        note: /가족 아이디 로그인이 끝났어요/.test(
          (await B.page.locator("#page-content").textContent()) || "",
        ),
      };
      result.steps.recoverSignsOutB = revoked;
      check(revoked.lock === 1 && revoked.note, "복구 뒤 B가 로그아웃되지 않았어요", revoked);
      await B.click('[data-action="family-login"]');
      await B.page.fill("#family-username", USER);
      await B.page.fill("#family-password", PASS[1]);
      await B.page.click("#family-auth-submit");
      await B.waitFormGone();
      await B.closeModal();
      const back = {
        chip: await B.waitChip(/클라우드에 저장됨/),
        lock: await B.page.locator(".cloud-lock-panel").count(),
      };
      result.steps.bSignsInAgain = back;
      check(/클라우드에 저장됨/.test(back.chip) && back.lock === 0, "B가 새 비밀번호로 다시 연결되지 않았어요", back);

      // ---- 8. A: password change keeping, then signing out, the other devices ---
      for (const [index, signOutOthers] of [
        [2, false],
        [3, true],
      ]) {
        await A.manage("family-password");
        await A.page.fill("#family-current-password", PASS[index - 1]);
        await A.page.fill("#family-password", PASS[index]);
        if (signOutOthers) await A.page.check("#family-signout-others");
        await A.page.click("#family-auth-submit");
        await A.waitFormGone("#family-password-form");
        const changed = {
          toast: await A.toast(),
          aSession: !!(await A.ls(SESSION_KEY)),
          form: await A.page.locator("#family-password-form").count(),
        };
        await B.refresh();
        changed.bLock = await B.page.locator(".cloud-lock-panel").count();
        changed.bChip = await B.chip();
        result.steps[signOutOthers ? "passwordSignOutOthers" : "passwordKeepOthers"] = changed;
        check(
          changed.form === 0 &&
            changed.aSession &&
            /비밀번호를 바꿨어요/.test(changed.toast) &&
            (signOutOthers
              ? changed.bLock === 1
              : changed.bLock === 0 && /클라우드에 저장됨/.test(changed.bChip)),
          signOutOthers
            ? "다른 기기 로그아웃을 고른 비밀번호 변경이 B를 로그아웃하지 않았어요"
            : "비밀번호만 바꿨는데 B가 로그아웃됐어요",
          changed,
        );
        await A.closeModal();
      }

      // ---- 9. A: delete the account; the device keeps its books ---------------
      await A.manage("family-delete");
      await A.page.fill("#family-delete-password", PASS[3]);
      await A.page.fill("#family-delete-confirm", "삭제");
      await A.page.click("#family-auth-submit");
      await A.waitFormGone("#family-delete-form");
      const deleted = {
        toast: await A.toast(),
        session: await A.ls(SESSION_KEY),
        lock: await A.page.locator(".cloud-lock-panel").count(),
        server: await serverJSON("state"),
      };
      await A.click('button[data-action="nav"][data-view="library"]');
      deleted.shelf = await A.page.locator(".book-card", { hasText: title }).count();
      result.steps.deleted = deleted;
      check(
        /가족 계정을 삭제했어요/.test(deleted.toast) &&
          deleted.session === null &&
          deleted.lock === 0 &&
          deleted.shelf >= 1,
        "계정 삭제 뒤 A의 상태가 달라요",
        deleted,
      );
      await A.shot("09-deleted");
      // B is still locked and the old account no longer signs in.
      await B.refresh();
      await B.click('[data-action="family-login"]');
      await B.page.fill("#family-username", USER);
      await B.page.fill("#family-password", PASS[3]);
      await B.page.click("#family-auth-submit");
      const gone = { error: await B.authError() };
      await B.closeModal();
      gone.lock = await B.page.locator(".cloud-lock-panel").count();
      result.steps.deletedAccountLogin = gone;
      check(
        gone.error === "아이디 또는 비밀번호가 맞지 않아요." && gone.lock === 1,
        "지운 계정으로 B가 로그인됐어요",
        gone,
      );
      await B.shot("09-locked");
    } finally {
      await B.ctx.close();
    }
  } catch (error) {
    problem("시나리오가 중간에 멈췄어요", String(error?.stack || error).slice(0, 600));
    await A.shot("zz-stopped").catch(() => {});
  } finally {
    await A.ctx.close();
  }
  result.pass =
    !result.problems.length &&
    !result.pageErrors.length &&
    !result.paidRequests.length &&
    !result.overflow.length;
  return result;
}

const report = { base: BASE, runs: [] };
for (const width of WIDTHS) {
  const result = await run(width);
  report.runs.push(result);
  console.log(
    `${width}px: ${result.pass ? "PASS" : "FAIL"}${result.problems.length ? "\n  - " + result.problems.join("\n  - ") : ""}${result.pageErrors.length ? "\n  page errors: " + result.pageErrors.join(" | ") : ""}${result.paidRequests.length ? "\n  paid: " + result.paidRequests.length : ""}${result.overflow.length ? "\n  overflow: " + JSON.stringify(result.overflow) : ""}`,
  );
}
await browser.close();
fs.writeFileSync(
  path.join(OUT, "r11-family-scenarios.json"),
  JSON.stringify(report, null, 2),
);
const pass = report.runs.every((run) => run.pass);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
