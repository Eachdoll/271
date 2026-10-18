const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
// 화면별 보이는 버튼·입력·선택·접힘 수와 전체 화면 캡처를 남긴다(유료 호출 차단).
// 사용: npx http-server dist -p 4178 -s & node scripts/ux-census.mjs <출력폴더> [기본주소]
const OUT=process.argv[2]||'QA/ux-census', BASE=process.argv[3]||'http://127.0.0.1:4178/';
await import('node:fs').then(fs=>fs.mkdirSync(OUT,{recursive:true}));
const browser = await chromium.launch({ args:['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale:'ko-KR', serviceWorkers:'block' });
const page = await ctx.newPage(); const errs=[];
page.on('pageerror', e=>errs.push(e.message));
await page.route(/api\.anthropic\.com|api\.openai\.com|generativelanguage/, r=>r.abort());
const click = async (sel) => { const el = await page.$(sel); if (!el) return false; await el.click(); await page.waitForTimeout(700); return true; };
const census = async (label, scope='#app') => {
  const r = await page.evaluate((scope) => {
    const root = document.querySelector('#modal-root .story-workspace, #modal-root [role=dialog]') && scope==='modal' ? document.querySelector('#modal-root') : document.querySelector('#page-content') || document.body;
    const vis = (e) => { const s=getComputedStyle(e); const r=e.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0; };
    const q = (s) => [...root.querySelectorAll(s)].filter(vis);
    return { buttons:q('button').length, inputs:q('input:not([type=hidden]),textarea').length, selects:q('select').length, details:q('details').length, headings:q('h1,h2,h3').map(h=>h.textContent.trim().slice(0,40)).slice(0,25), buttonLabels:q('button').map(b=>b.textContent.trim().replace(/\s+/g,' ').slice(0,24)).filter(Boolean).slice(0,60), scrollH: document.scrollingElement.scrollHeight };
  }, scope);
  console.log(`\n### ${label}\n`+JSON.stringify(r));
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true });
};
await page.goto(BASE, { waitUntil:'networkidle' });
await census('01-library');
await click('button[data-action="nav"][data-view="settings"]'); await page.fill('#pin','1234'); await page.fill('#pin-confirm','1234'); await page.click('#pin-form button[type=submit]'); await page.waitForTimeout(700);
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
console.log('\nERRORS', JSON.stringify(errs));
await browser.close();
