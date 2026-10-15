import test from 'node:test';
import assert from 'node:assert/strict';
import {getPrintHTML,imposeBooklet,migratePrintSettings} from '../dist/output.js';

const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#e8f0df"/></svg>');
const pageNumbers=count=>Array.from({length:count},(_,i)=>`${i+1}쪽`);
function book(count=12){
  return {title:'유하와 그린이의 초록 모험',titleEn:'Yuha and Green',cover:{imageUrl:picture},pages:Array.from({length:count},(_,i)=>({
    imageUrl:picture,...(i%2?{textKo:`한글 ${i+1}쪽 내용입니다.`,textEn:`English page ${i+1}.`}:{ko:`한글 ${i+1}쪽 내용입니다.`,en:`English page ${i+1}.`})
  }))};
}
function articles(html){return [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map(match=>match[0]);}
function labels(html){return articles(html).map(article=>article.match(/aria-label="([^"]*)"/)?.[1]);}
function sheets(html){return [...html.matchAll(/<section\b[^>]*class="[^"]*\bsheet\b[^"]*"[^>]*>([\s\S]*?)<\/section>/g)].map(match=>labels(match[1]));}
function bodyArticles(html){return articles(html).filter(article=>/class="[^"]*\bstory-page\b/.test(article));}
function hasClass(html,name){return new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`).test(html);}
function frameContent(article){
  const opening=/<div\b[^>]*class="[^"]*\bpicturebook-frame\b[^"]*"[^>]*>/.exec(article);
  assert.ok(opening,'each story page has an illustration and typeset text frame');
  const start=opening.index+opening[0].length;
  const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=start;
  let depth=1,match;
  while((match=tags.exec(article))){depth+=match[0].startsWith('</')?-1:1;if(!depth)return article.slice(start,match.index);}
  assert.fail('the picturebook frame must close');
}

test('default print is sequential single-page landscape with no inserted blank leaves',()=>{
  const input=book(),before=JSON.stringify(input),html=getPrintHTML(input);
  assert.deepEqual(labels(html),['표지',...pageNumbers(12),'뒤표지']);
  assert.deepEqual(sheets(html),['표지',...pageNumbers(12),'뒤표지'].map(label=>[label]));
  assert.equal(hasClass(html,'blank'),false);
  assert.match(html,/@page\s*\{[^}]*size:\s*A4\s+landscape/i);
  assert.equal(JSON.stringify(input),before,'printing does not change the saved book');
});

test('two-up pairs body pages in reading order and gives each cover its own sheet',()=>{
  const html=getPrintHTML(book(),{layout:'two'});
  assert.deepEqual(sheets(html),[['표지'],['1쪽','2쪽'],['3쪽','4쪽'],['5쪽','6쪽'],['7쪽','8쪽'],['9쪽','10쪽'],['11쪽','12쪽'],['뒤표지']]);
  assert.equal(sheets(html).length,8);
  assert.equal(hasClass(html,'blank'),false);
  assert.deepEqual(labels(html),['표지',...pageNumbers(12),'뒤표지']);
});

test('an odd final body page is a solo sheet rather than a fabricated empty page',()=>{
  const html=getPrintHTML(book(3),{layout:'two'});
  assert.deepEqual(sheets(html),[['표지'],['1쪽','2쪽'],['3쪽'],['뒤표지']]);
  assert.equal(hasClass(html,'blank'),false);
  assert.equal((html.match(/class="slot\b/g)||[]).length,5);
});

test('explicit booklet retains duplex imposition and reports its two necessary blank leaves',()=>{
  const input=[{kind:'cover',label:'표지'},...pageNumbers(12).map(label=>({kind:'page',label})),{kind:'back',label:'뒤표지'}];
  const before=structuredClone(input),expected=[['뒤표지','표지'],['1쪽','빈 쪽'],['빈 쪽','2쪽'],['3쪽','12쪽'],['11쪽','4쪽'],['5쪽','10쪽'],['9쪽','6쪽'],['7쪽','8쪽']];
  assert.deepEqual(imposeBooklet(input).map(side=>side.map(page=>page.label)),expected);
  assert.deepEqual(input,before,'imposition does not add padding to the caller’s pages');
  const html=getPrintHTML(book(),{layout:'booklet'});
  assert.deepEqual(sheets(html),expected.map(side=>side.map(label=>label==='빈 쪽'?'제본을 위한 빈 쪽':label)));
  assert.equal(articles(html).filter(article=>hasClass(article,'blank')).length,2);
  assert.match(html,/4의 배수/);
  assert.match(html,/빈 쪽/);
  assert.match(html,/양면/);
});

test('page ranges contain only requested body pages in every layout',()=>{
  for(const layout of ['single','two','booklet']){
    const html=getPrintHTML(book(),{layout,pages:' 5, 2, 4-5 '});
    const actual=labels(html).filter(label=>/^\d+쪽$/.test(label));
    assert.deepEqual(layout==='booklet'?[...actual].sort((a,b)=>parseInt(a)-parseInt(b)):actual,['2쪽','4쪽','5쪽'],layout);
    assert.equal(labels(html).includes('표지'),false,`${layout} must not add an unrequested cover`);
    assert.equal(labels(html).includes('뒤표지'),false,`${layout} must not add an unrequested back cover`);
    if(layout!=='booklet')assert.equal(hasClass(html,'blank'),false,layout);
  }
  assert.deepEqual(sheets(getPrintHTML(book(),{layout:'two',pages:'2,4-5'})),[['2쪽','4쪽'],['5쪽']]);
});

test('cover-only printing produces exactly one cover with no back, body or padding in every layout',()=>{
  for(const layout of ['single','two','booklet']){
    const html=getPrintHTML(book(),{layout,pages:'cover'});
    assert.deepEqual(sheets(html),[['표지']],layout);
    assert.equal(hasClass(html,'blank'),false,layout);
    assert.equal(bodyArticles(html).length,0,layout);
  }
});

test('both story schemas produce escaped selectable language text inside the picture frame',()=>{
  const input=book(2);
  input.title='<img src=x onerror="cover()">';
  input.titleEn=input.title;
  input.pages[0].ko='직접 글 <문> & "창"';input.pages[0].en='Direct <door> & "window".';
  input.pages[1].textKo='별칭 글 <script>body()</script>';input.pages[1].textEn='Alias <script>body()</script>.';
  for(const language of ['ko','en','bilingual']){
    const html=getPrintHTML(input,{language});
    assert.match(html,/&lt;img src=x onerror=&quot;cover\(\)&quot;&gt;/);
    assert.doesNotMatch(html,/<img src=x/);
    assert.doesNotMatch(html,/<script>body\(\)<\/script>/);
    const frames=bodyArticles(html).map(frameContent);
    assert.equal(frames.length,2);
    assert.ok(frames.every(frame=>hasClass(frame,'illustration')&&hasClass(frame,'story')));
    if(language!=='en'){
      assert.match(frames[0],/<p lang="ko" class="ko">직접 글 &lt;문&gt; &amp; &quot;창&quot;<\/p>/);
      assert.match(frames[1],/별칭 글 &lt;script&gt;body\(\)&lt;\/script&gt;/);
    }else assert.ok(frames.every(frame=>!frame.includes('lang="ko"')));
    if(language!=='ko'){
      assert.match(frames[0],/<p lang="en" class="en">Direct &lt;door&gt; &amp; &quot;window&quot;\.<\/p>/);
      assert.match(frames[1],/Alias &lt;script&gt;body\(\)&lt;\/script&gt;\./);
    }else assert.ok(frames.every(frame=>!frame.includes('lang="en"')));
  }
});

test('bottom overlay is the default and parents can choose top overlay or text below the picture',()=>{
  const input=book(1),defaultArticle=bodyArticles(getPrintHTML(input))[0];
  assert.equal(hasClass(defaultArticle,'text-bottom'),true);
  for(const textPosition of ['bottom','top','below']){
    const article=bodyArticles(getPrintHTML(input,{textPosition}))[0];
    assert.equal(hasClass(article,`text-${textPosition}`),true,textPosition);
    assert.equal(hasClass(frameContent(article),'story'),true,textPosition);
    assert.match(article,/English page 1\./);
    assert.match(article,/한글 1쪽 내용입니다\./);
  }
  assert.equal(bodyArticles(getPrintHTML(input,{textPosition:'unsupported'}))[0],defaultArticle);
});

test('per-page text placement survives default printing while explicit top or below applies to every page',()=>{
  const input=book(3);
  input.pages[0].printTextPosition='top';
  input.pages[1].printTextPosition='bottom';
  input.pages[2].printTextPosition='unsupported';
  const before=JSON.stringify(input),defaults=bodyArticles(getPrintHTML(input));
  assert.equal(hasClass(defaults[0],'text-top'),true);
  assert.equal(hasClass(defaults[1],'text-bottom'),true);
  assert.equal(hasClass(defaults[2],'text-bottom'),true);
  for(const textPosition of ['top','below']){
    assert.ok(bodyArticles(getPrintHTML(input,{textPosition})).every(article=>hasClass(article,`text-${textPosition}`)),`${textPosition} must override each saved page placement`);
  }
  assert.equal(JSON.stringify(input),before,'a global print override never changes saved per-page choices');
});

test('legacy booklet preference migrates once to sequential printing and preserves other preferences',()=>{
  const settings={defaultLayout:'booklet',defaultLanguage:'ko',defaultPages:12,dailyLimit:3};
  migratePrintSettings(settings);
  assert.equal(settings.defaultLayout,'single');
  assert.equal(settings.defaultLanguage,'ko');
  assert.equal(settings.defaultPages,12);
  assert.equal(settings.dailyLimit,3);
  assert.equal(settings.printLayoutVersion,2);
  const missing={};migratePrintSettings(missing);assert.equal(missing.defaultLayout,'single');
  for(const defaultLayout of ['single','two']){
    const selected={defaultLayout};migratePrintSettings(selected);assert.equal(selected.defaultLayout,defaultLayout);
  }
});

test('an explicit booklet choice after migration survives repeated startup and saved-settings reload',()=>{
  const settings={defaultLayout:'booklet'};
  migratePrintSettings(settings);
  settings.defaultLayout='booklet';
  const saved=JSON.parse(JSON.stringify(settings));
  migratePrintSettings(settings);migratePrintSettings(saved);
  assert.equal(settings.defaultLayout,'booklet');
  assert.equal(saved.defaultLayout,'booklet');
  assert.equal(saved.printLayoutVersion,2);
});

test('invalid page selections fail before producing misleading print content',()=>{
  for(const pages of ['0','13','5-2','2,,4','1<script>']){
    assert.throws(()=>getPrintHTML(book(),{pages}),Error,pages);
  }
});
