const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// 화면별 보이는 버튼·입력·선택·접힘 수와 전체 화면 캡처를 남긴다(유료 호출 차단).
// 사용: npx http-server dist -p 4178 -s & node scripts/ux-census.mjs <출력폴더> [기본주소] [결과 JSON]
// R9: 첫 번째 패스는 프로페셔널 모드('donghwa-ui-mode'='pro')로 기존 화면을 그대로 센다(작업 지시서 표와 같아야 함).
//     두 번째 패스는 새 기기(기본 쉬운 모드)에서 ①~⑤와 쉬운 부모 설정을 세고 QA/r9-ux-census.json에 쓴다.
//     모드 전환 버튼(data-action="toggle-ui-mode")은 새로 생긴 버튼이라 기존 수치와 따로 셉니다.
import fs from 'node:fs';
const OUT=process.argv[2]||'QA/ux-census', BASE=process.argv[3]||'http://127.0.0.1:4178/', JSON_OUT=process.argv[4]||'QA/r9-ux-census.json';
fs.mkdirSync(OUT,{recursive:true});
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args:['--no-sandbox'] });
const PAID = /api\.anthropic\.com|api\.openai\.com|generativelanguage|fal\.run|bfl\.ai/;
const results = { pro:{}, simple:{} }, errs=[], paid=[];
async function context(mode){
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale:'ko-KR', serviceWorkers:'block' });
  if (mode === 'pro') await ctx.addInitScript(() => { try { localStorage.setItem('donghwa-ui-mode','pro'); } catch {} });
  const page = await ctx.newPage();
  page.on('pageerror', e=>errs.push(`${mode}: ${e.message}`));
  await page.route(PAID, r=>{ paid.push(r.request().url()); return r.abort(); });
  return { ctx, page };
}
const clicker = (page) => async (sel) => { const el = await page.$(sel); if (!el) return false; await el.click(); await page.waitForTimeout(700); return true; };
const censusOf = (page, pass) => async (label, scope='#app') => {
  const r = await page.evaluate((scope) => {
    const root = document.querySelector('#modal-root .story-workspace, #modal-root [role=dialog]') && scope==='modal' ? document.querySelector('#modal-root') : document.querySelector('#page-content') || document.body;
    const vis = (e) => { const s=getComputedStyle(e); const r=e.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0; };
    const q = (s) => [...root.querySelectorAll(s)].filter(vis);
    const buttons = q('button'), toggle = buttons.filter(b=>b.matches('[data-action="toggle-ui-mode"]')), counted = buttons.filter(b=>!b.matches('[data-action="toggle-ui-mode"]'));
    // Simple steps: material cards (.simple-card), page arrows and step-bar links ([data-simple-nav]) are not counted (R9-B2 rule 3, R11).
    const stepButtons = counted.filter(b=>!b.matches('.simple-card,[data-simple-nav]'));
    return { buttons:counted.length, modeToggle:toggle.length, stepButtons:stepButtons.length, inputs:q('input:not([type=hidden]),textarea').length, selects:q('select').length, details:q('details').length, headings:q('h1,h2,h3').map(h=>h.textContent.trim().slice(0,40)).slice(0,25), buttonLabels:counted.map(b=>b.textContent.trim().replace(/\s+/g,' ').slice(0,24)).filter(Boolean).slice(0,60), scrollH: document.scrollingElement.scrollHeight, overflowX: document.documentElement.scrollWidth - window.innerWidth };
  }, scope);
  results[pass][label] = r;
  console.log(`\n### ${pass} ${label}\n`+JSON.stringify(r));
  await page.screenshot({ path: `${OUT}/${pass}-${label}.png`, fullPage: true });
};
const pin = async (page, click) => { await click('button[data-action="nav"][data-view="settings"]'); await page.fill('#pin','1234'); await page.fill('#pin-confirm','1234'); await page.click('#pin-form button[type=submit]'); await page.waitForTimeout(700); };

// ---- pass 1: professional mode, exactly the pre-R9 tour ----
{
  const { ctx, page } = await context('pro'), click = clicker(page), census = censusOf(page, 'pro');
  await page.goto(BASE, { waitUntil:'networkidle' });
  await census('01-library');
  await pin(page, click);
  for (const t of ['home','text','image']) { await click(`[data-action=settings-tab][data-tab=${t}]`); await page.evaluate(()=>document.querySelectorAll('#page-content details').forEach(d=>d.open=true)); await census('02-settings-'+t); }
  await click('button[data-action="nav"][data-view="materials"]'); await census('03-materials');
  await click('button[data-action="nav"][data-view="create"]'); await census('04-create-step1');
  for (let s=2;s<=6;s++){ await click('button[data-action="wizard-next"]'); if (await page.$('#topic')) await page.fill('#topic','유하가 공룡 친구와 함께 별을 찾아주는 이야기'); if (await page.$('#modal-root .story-workspace')) { await census('05-workspace-open','modal'); break;} await census('04-create-step'+s); }
  await page.evaluate(()=>document.querySelectorAll('#modal-root details').forEach(d=>d.open=true)); await census('06-workspace-details-open','modal');
  await click('button[data-story-action="start-demo"]'); await page.waitForTimeout(2000); await census('07-outline','modal');
  await click('#modal-root button[data-story-action="approve-outline"]'); await page.waitForTimeout(2000); await census('08-after-outline','modal');
  await click('#modal-root button[data-story-action="generate-prose"]'); await page.waitForTimeout(2500); await census('09-prose','modal');
  await click('#modal-root button[data-story-action="approve-prose"]'); await page.waitForTimeout(2500); await census('10-pages','modal');
  const acc = await page.$('#story-accept-failures'); if (acc) await acc.check();
  await click('#modal-root button[data-story-action="approve-pages"]'); await page.waitForTimeout(3000); await census('11-editor');
  await ctx.close();
}

// ---- pass 2: a new device in the default simple mode ----
{
  const { ctx, page } = await context('simple'), click = clicker(page), census = censusOf(page, 'simple');
  await page.goto(BASE, { waitUntil:'networkidle' });
  results.simple.storedMode = await page.evaluate(()=>localStorage.getItem('donghwa-ui-mode'));
  await census('01-library');
  await pin(page, click);
  await census('02-settings');
  await click('button[data-action="nav"][data-view="create"]'); await census('03-step1-topic');
  await click('[data-simple-action="format"]'); await census('03-step1-format-open');
  await page.fill('#topic','유하가 공룡 친구와 함께 숲으로 소풍 가는 이야기');
  await click('[data-simple-action="next"]'); await census('04-step2-materials');
  await click('[data-simple-action="next"]'); await census('05-step3-generate');
  await click('[data-simple-action="start-demo"]');
  await page.waitForSelector('.simple-create[data-simple-step="4"]', { timeout: 90000 }); await page.waitForTimeout(1200);
  await census('06-step4-review');
  await click('[data-simple-action="edit-text"]'); await census('06-step4-review-editing');
  await click('[data-simple-action="cancel-text"]');
  await click('[data-simple-action="to-finish"]'); await census('07-step5-finish');
  await ctx.close();
}
await browser.close();

// Pre-R9 professional numbers from the R9 work order table (1280px).
// R13 (deliberate): the text tab gains one '모델 목록 불러오기' button in the open
// provider panel (9 → 10). Its model choices are options of the existing
// medium/upper selects and the '직접 입력' field stays hidden until picked, so
// inputs and selects are unchanged. The image tab's default engine (free
// sample) has no model select, so its numbers are unchanged.
const table = {
  // R26: +1 input, the '검사는 최고 모델로' box on the text settings page.
  // R29: +2 inputs, the '정성 모드' and '정성 모드 작가는 최고 모델로' boxes.
  // R33: +1 select, the default '무대' (stage category) above the world cards.
  '02-settings-text': { buttons: 10, inputs: 102, selects: 65 },
  '02-settings-image': { buttons: 16, inputs: 10, selects: 4 },
  '03-materials': { buttons: 43, inputs: 0, selects: 0 },
  // 2026-10-21 (deliberate): each beat also offers the drawer's other places
  // (folded '다른 장소'): +4 on the start and end beats, +1 on the five middle
  // beats of the demo outline (108 → 121).
  '07-outline': { buttons: 121, inputs: 21, selects: 0 },
  '10-pages': { buttons: 162, inputs: 75, selects: 25 },
  '11-editor': { buttons: 35, inputs: 4, selects: 0 },
};
const proCheck = Object.fromEntries(Object.entries(table).map(([label, expected]) => {
  const got = results.pro[label] || {};
  return [label, { expected, got: { buttons: got.buttons, inputs: got.inputs, selects: got.selects }, same: Object.entries(expected).every(([k, v]) => got[k] === v) }];
}));
const createSteps = ['04-create-step1','04-create-step2','04-create-step3','04-create-step4'].map(l=>results.pro[l]).filter(Boolean);
proCheck['04-create-steps'] = { expected: { buttons: '3~13', inputs: '0~3', selects: '1~7' }, got: createSteps.map(r=>({ buttons:r.buttons, inputs:r.inputs, selects:r.selects })), same: createSteps.length===4 && createSteps.every(r=>r.buttons>=3&&r.buttons<=13&&r.inputs<=3&&r.selects>=1&&r.selects<=7) };
const simpleSteps = Object.fromEntries(Object.entries(results.simple).filter(([l])=>/step/.test(l)).map(([l, r]) => [l, { stepButtons: r.stepButtons, allButtons: r.buttons, inputs: r.inputs, selects: r.selects, withinLimit: r.stepButtons <= 12, overflowX: r.overflowX }]));
const summary = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  viewport: '1280x900',
  rules: '보이는 버튼 수. 모드 전환 버튼은 modeToggle로 따로 셉니다. 쉬운 모드 단계의 stepButtons는 재료 카드(.simple-card)와 쪽 이동 화살표·단계 표시 버튼([data-simple-nav])을 빼고 셉니다(R9-B2 3, R11).',
  proMatchesWorkOrderTable: Object.values(proCheck).every(r=>r.same),
  proCheck,
  simpleStepsWithinLimit: Object.values(simpleSteps).every(r=>r.withinLimit),
  simpleSteps,
  pro: results.pro,
  simple: results.simple,
  pageErrors: errs,
  paidRequests: paid,
};
fs.writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));
console.log('\nPRO SAME AS TABLE', summary.proMatchesWorkOrderTable, JSON.stringify(Object.fromEntries(Object.entries(proCheck).map(([k,v])=>[k,v.same]))));
console.log('SIMPLE STEPS', JSON.stringify(simpleSteps));
console.log('\nERRORS', JSON.stringify(errs), 'PAID', paid.length);
