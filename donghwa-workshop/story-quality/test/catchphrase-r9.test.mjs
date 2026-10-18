import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const inv = read('data/inventories.json');
const patterns = read('data/plot_patterns.json');
const P = patterns.find((p) => p.id === 'journey_repeat');

const m = await import('../dist/index.js');
const {
  catchphraseCore, countCatchphrase, sharesCore, uniqueCatchphrases, catchphraseRepeats, catchphraseClause,
  CATCHPHRASE_RULE_EN, CATCHPHRASE_RULE_KO, PROSE_RICH_USER_KO, PROSE_RICH_USER_EN, OUTLINE_USER, DEFAULT_RULES,
  buildOutlinePrompt, roughTokenCount, composeSeed, plotCheck, runOutlineStage,
} = m;

test('R9-A catchphrase core ignores spacing, punctuation and one trailing Korean ending', () => {
  assert.equal(catchphraseCore('같이 가자!'), '같이가');
  assert.equal(catchphraseCore('같이 가자'), '같이가');
  assert.equal(catchphraseCore('같이 가!'), '같이가');
  assert.equal(catchphraseCore('같이가자!!'), '같이가');
  assert.equal(catchphraseCore('천천히 해도 괜찮아.'), '천천히해도괜찮');
  assert.equal(catchphraseCore('쿵쿵, 냠냠!'), '쿵쿵냠냠');
  // 너무 짧거나 빈 말버릇은 세지 않는다.
  assert.equal(catchphraseCore('응!'), '');
  assert.equal(catchphraseCore(''), '');
  assert.equal(catchphraseCore(null), '');
  // 한 단어뿐이면 어미를 떼지 않는다(핵심이 1글자가 되지 않게).
  assert.equal(catchphraseCore('가자!'), '가자');
});

test('R9-A countCatchphrase matches variants of the same phrase at token boundaries', () => {
  const phrase = '같이 가자!';
  for (const text of ['같이 가자!', '같이 가자', '같이 가!', '같이가자', '같이 가요.', '"같이 가자!"라고 말했어요.', '유하야, 같이 가자.'])
    assert.equal(countCatchphrase(text, phrase), 1, text);
  assert.equal(countCatchphrase('유하가 "같이 가자!" 하고 웃어요. 초록이도 "같이 가!" 해요. 같이 가자!', phrase), 3);
  assert.equal(countCatchphrase('Let us go together! let us GO together.', "Let us go together!"), 2);
  assert.equal(countCatchphrase('쿵쿵 냠냠, 쿵쿵, 냠냠!', '쿵쿵, 냠냠!'), 2);
  assert.equal(countCatchphrase('천천히 해도 괜찮아요.', '천천히 해도 괜찮아.'), 1);
});

test('R9-A countCatchphrase does not over-match longer words or synonyms', () => {
  const phrase = '같이 가자!';
  for (const text of ['같이 가방을 메요.', '같이 가자고 했어요.', '같이 가서 봐요.', '우리 함께 가자!', '바같이 가자', '같이 가위바위보', ''])
    assert.equal(countCatchphrase(text, phrase), 0, text);
  assert.equal(countCatchphrase('응! 응! 응!', '응!'), 0, 'one-letter core is never counted');
  assert.equal(countCatchphrase('같이 가자!', ''), 0);
  assert.equal(countCatchphrase('lettuce and outlet', 'let'), 0, 'a Latin core never matches inside a longer word');
});

test('R9-A sharesCore detects refrain/catchphrase overlap without false positives', () => {
  assert.equal(sharesCore('○○아, 같이 가자!', '같이 가!'), true);
  assert.equal(sharesCore('하나, 둘, 셋, 같이 가자!', '같이 가자!'), true);
  assert.equal(sharesCore('같이 가자!', '유하야, 같이 가자!'), true);
  assert.equal(sharesCore('같이 가자', '같이 가자!'), true);
  assert.equal(sharesCore('토독토독, 비가 와요.', '같이 가자!'), false);
  assert.equal(sharesCore('같이 가방', '같이 가자!'), false);
  assert.equal(sharesCore('우리 함께 가자!', '같이 가자!'), false);
  assert.equal(sharesCore('', '같이 가자!'), false);
});

test('R9-A uniqueCatchphrases and catchphraseRepeats count one core once across texts', () => {
  assert.deepEqual(uniqueCatchphrases(['같이 가자!', '같이 가!', '', null, '쿵쿵, 냠냠!', '응']), ['같이 가자!', '쿵쿵, 냠냠!']);
  const rows = catchphraseRepeats(['같이 가자! 같이 가자.', '없음', '쿵쿵, 냠냠!', '같이 가!'], ['같이 가자!', '같이 가!', '쿵쿵, 냠냠!']);
  assert.deepEqual(rows, [{ phrase: '같이 가자!', core: '같이가', count: 3, at: [0, 3] }]);
  assert.deepEqual(catchphraseRepeats(['같이 가자!'], ['같이 가자!']), []);
});

test('R9-A outline prompts carry one fully conditional catchphrase clause', () => {
  assert.equal(catchphraseClause('같이 가자!'), ', 말버릇 "같이 가자!"(책 전체에서 최대 1번, 꼭 쓰지 않아도 된다. 후렴으로 쓰지 않는다)');
  assert.equal(catchphraseClause('같이 가자!', true), ', 이번 책에서는 말버릇을 쓰지 않는다');
  assert.equal(catchphraseClause(''), '');
  assert.equal(catchphraseClause('  '), '');
  assert.doesNotMatch(OUTLINE_USER, /말버릇/);
  assert.equal(DEFAULT_RULES.length, 7);

  const ban = { plantedObjects: [], creatures: [], twistTypes: [], patterns: [], places: [] };
  const seed = composeSeed({ pattern: P, inventories: inv, backgroundType: 'dino_land', rngSeed: 1, ban });
  const base = {
    supporting: [{ name: '초록이', traits: ['느긋함', '먹보'], role: '공룡 친구', catchphrase: '쿵쿵, 냠냠!' }, { name: '토토', traits: ['조용함'] }],
    worldCore: ['소파 뒤 터널', '공룡은 말을 한다', '저녁밥 냄새'], topic: '공룡나라 비 오는 날', levelKo: 'K1', levelEn: 'E0', pages: 12,
    pattern: P, seed, inventories: inv, ban, approvedBooks: [], endingType: 'home_sleep',
  };
  const once = buildOutlinePrompt({ ...base, protagonist: { name: '유하', traits: ['호기심 많음'], catchphrase: '같이 가자!' } }).user;
  assert.match(once, /^\[등장인물\] 유하: 호기심 많음, 말버릇 "같이 가자!"\(책 전체에서 최대 1번, 꼭 쓰지 않아도 된다\. 후렴으로 쓰지 않는다\)$/m);
  assert.match(once, /초록이\(공룡 친구\): 느긋함, 먹보, 말버릇 "쿵쿵, 냠냠!"\(책 전체에서 최대 1번/);
  assert.match(once, /토토: 조용함( \/|$)/m);
  const empty = buildOutlinePrompt({ ...base, protagonist: { name: '유하', traits: ['호기심 많음'] } }).user;
  assert.doesNotMatch(empty, /말버릇 ""/);
  assert.match(empty, /^\[등장인물\] 유하: 호기심 많음$/m);
  const omitted = buildOutlinePrompt({ ...base, protagonist: { name: '유하', traits: ['호기심 많음'], catchphrase: '같이 가자!', catchphraseOmitted: true } }).user;
  assert.doesNotMatch(omitted, /같이 가자/);
  assert.match(omitted, /^\[등장인물\] 유하: 호기심 많음, 이번 책에서는 말버릇을 쓰지 않는다$/m);
  assert.ok(roughTokenCount(once) < 1800);
});

test('R9-A prose prompts limit catchphrases to one use in KO and EN', () => {
  assert.ok(PROSE_RICH_USER_KO.includes(CATCHPHRASE_RULE_KO));
  assert.ok(PROSE_RICH_USER_EN.includes(CATCHPHRASE_RULE_EN));
  assert.equal(CATCHPHRASE_RULE_EN, "Use each character's catchphrase at most once in the whole book, or not at all.");
  const md = readFileSync(join(root, 'prompts/prose_rich.md'), 'utf8');
  assert.ok(md.includes(CATCHPHRASE_RULE_KO) && md.includes(CATCHPHRASE_RULE_EN));
  const outlineMd = readFileSync(join(root, 'prompts/outline.v3.md'), 'utf8');
  assert.doesNotMatch(outlineMd, /말버릇 "\{\{/);
});

function outlineWith(summaries, refrain) {
  const types = ['setup', 'want', 'attempt', 'attempt', 'attempt', 'turn', 'close'];
  return {
    plan: { pattern: 'journey_repeat', planted: '노란 우산', twistReveal: 'x', funnyMoment: 'y', failureReasons: [] },
    titleCandidates: ['t'], logline: 'l', want: 'w', problem: 'p',
    beats: summaries.map((summary, i) => ({ index: i + 1, type: types[i], summary, settingKey: i === 0 || i === 6 ? 'home' : `p${i}`, newElement: `e${i}` })),
    refrain, newWordsKo: [], newWordsEn: [], endingType: 'home_sleep',
  };
}

test('R9-A3 plotCheck flags 2+ catchphrase uses with per-beat labels and passes a single use', () => {
  const three = outlineWith([
    '유하가 노란 우산을 챙겨요.', '유하가 "같이 가자!" 하고 외쳐요.', '유하가 개울을 건너요.', '유하가 "같이 가!" 해요.',
    '유하가 언덕에 올라요.', '노란 우산이 노래해요. 유하가 같이 가자 해요.', '유하가 집에 와요.',
  ], { text: '토독토독 비가 와요', usedAtBeats: [3, 5], variation: '크기' });
  const bad = plotCheck({ outline: three, topic: '비 오는 날', protagonistName: '유하', catchphrases: ['같이 가자!', '같이 가!'] });
  const issue = bad.fix.filter((f) => f.startsWith('말버릇'));
  assert.equal(issue.length, 1, bad.fix.join(' | '));
  assert.match(issue[0], /말버릇 "같이 가자!" 3회\(책 전체 최대 1회\): 비트 2·비트 4·비트 6/);
  // 앱의 부분 수정(fixedBeatIds)은 "비트 N"을 하나씩 읽는다.
  assert.deepEqual([...issue[0].matchAll(/비트\s*(\d+)/gu)].map((x) => Number(x[1])), [2, 4, 6]);
  assert.doesNotMatch(issue[0], /금지|반전 비트|실패 이유|attempt|newElement|같은 문형|배경 생물/);

  const once = outlineWith([
    '유하가 노란 우산을 챙겨요.', '유하가 "같이 가자!" 하고 외쳐요.', '유하가 개울을 건너요.', '유하가 같이 가방을 메요.',
    '유하가 언덕에 올라요.', '노란 우산이 노래해요.', '유하가 집에 와요.',
  ], { text: '토독토독 비가 와요', usedAtBeats: [3, 5], variation: '크기' });
  const ok = plotCheck({ outline: once, topic: '비 오는 날', protagonistName: '유하', catchphrases: ['같이 가자!'] });
  assert.ok(!ok.fix.some((f) => /말버릇/.test(f)), ok.fix.join(' | '));
  // 말버릇을 넘기지 않으면 예전과 같다.
  const legacy = plotCheck({ outline: three, topic: '비 오는 날', protagonistName: '유하' });
  assert.ok(!legacy.fix.some((f) => /말버릇/.test(f)));
});

test('R9-A3 plotCheck flags a refrain that shares the catchphrase core and counts the refrain', () => {
  const outline = outlineWith([
    '유하가 노란 우산을 챙겨요.', '유하가 걸어요.', '유하가 개울을 건너요. 같이 가자!', '유하가 돌을 봐요.',
    '유하가 언덕에 올라요.', '노란 우산이 노래해요.', '유하가 집에 와요.',
  ], { text: '하나, 둘, 셋, 같이 가자!', usedAtBeats: [3, 5], variation: '숫자' });
  const res = plotCheck({ outline, topic: '비 오는 날', protagonistName: '유하', catchphrases: ['같이 가자!'] });
  const repeat = res.fix.find((f) => f.startsWith('말버릇'));
  assert.match(repeat, /말버릇 "같이 가자!" 2회\(책 전체 최대 1회, 후렴 포함\): 비트 3·비트 5/);
  const overlap = res.fix.find((f) => f.startsWith('후렴'));
  assert.match(overlap, /후렴 "하나, 둘, 셋, 같이 가자!"이\(가\) 말버릇 "같이 가자!"과\(와\) 같은 구절을 씀 — 후렴을 다른 말로 바꾼다: 비트 3·비트 5/);
  const fine = plotCheck({ outline: { ...outline, refrain: { text: '토독토독 비가 와요', usedAtBeats: [3, 5], variation: '크기' } }, topic: '비 오는 날', protagonistName: '유하', catchphrases: ['같이 가자!'] });
  assert.ok(!fine.fix.some((f) => /말버릇/.test(f)), fine.fix.join(' | '));
});

test('R9-A runOutlineStage checks catchphrases and asks the cheap fix pass for the flagged beats only', async () => {
  const calls = [];
  const engine = (id) => ({
    id,
    async complete(req) {
      calls.push({ id, req });
      if (req.user.includes('[고칠 것')) {
        const j = JSON.parse(req.user.slice(req.user.lastIndexOf('\n\n{') + 2));
        j.beats = j.beats.map((b, i) => (i === 3 ? { ...b, summary: b.summary.replace('같이 가자!', '여기 있어!') } : b));
        return { text: JSON.stringify(j), usage: { input: 1, output: 1 }, costUsd: 0 };
      }
      const planted = (req.user.match(/- 심을 물건: ([^—\n]+)—/) ?? [])[1]?.trim() ?? '물건';
      const beats = ['setup', 'want', 'attempt', 'attempt', 'attempt', 'turn', 'close'].map((type, i) => ({
        index: i + 1, type, characters: ['유하'], settingKey: i === 0 || i === 6 ? 'home' : `p${i}`, newElement: `e${i}`, failureReason: null,
        summary: i === 1 || i === 3 ? `유하가 "같이 가자!" 해요. 공룡나라 비가 와요.` : `유하가 ${planted}을 봐요. 공룡나라 비.`,
      }));
      return { text: JSON.stringify({ plan: { pattern: 'journey_repeat', planted, twistReveal: 'x', funnyMoment: 'y', failureReasons: [] }, titleCandidates: ['a'], logline: 'l', want: 'w', problem: 'p', beats, refrain: { text: '토독토독', usedAtBeats: [3, 5], variation: '크기' }, newWordsKo: [], newWordsEn: [], endingType: 'home_sleep' }), usage: { input: 1, output: 1 }, costUsd: 0 };
    },
  });
  const res = await runOutlineStage({
    engines: { outline: engine('outline'), prose: engine('prose'), cheap: engine('cheap') }, bookId: 'r9-book',
    protagonist: { name: '유하', traits: ['호기심 많음'], catchphrase: '같이 가자!' }, supporting: [],
    worldCore: ['a', 'b', 'c'], topic: '공룡나라 비 오는 날', levelKo: 'K1', levelEn: 'E0', pages: 12, pattern: P, backgroundType: 'dino_land',
    inventories: inv, approvedBooks: [], endingType: 'home_sleep',
  });
  const fixCall = calls.find((c) => c.req.user.includes('[고칠 것'));
  assert.ok(fixCall, 'fix pass requested');
  assert.match(fixCall.req.user, /- 말버릇 "같이 가자!" 2회\(책 전체 최대 1회\): 비트 2·비트 4/);
  assert.ok(!res.check.fix.some((f) => /말버릇/.test(f)), res.check.fix.join(' | '));

  // 돌려 쓰느라 뺀 말버릇도 explicit catchphrases로 검사하지만 프롬프트에는 넣지 않는다.
  calls.length = 0;
  const omitted = await runOutlineStage({
    engines: { outline: engine('outline'), prose: engine('prose'), cheap: engine('cheap') }, bookId: 'r9-book-2',
    protagonist: { name: '유하', traits: ['호기심 많음'], catchphraseOmitted: true }, supporting: [], catchphrases: ['같이 가자!'],
    worldCore: ['a', 'b', 'c'], topic: '공룡나라 비 오는 날', levelKo: 'K1', levelEn: 'E0', pages: 12, pattern: P, backgroundType: 'dino_land',
    inventories: inv, approvedBooks: [], endingType: 'home_sleep',
  });
  assert.match(calls[0].req.user, /유하: 호기심 많음, 이번 책에서는 말버릇을 쓰지 않는다/);
  assert.doesNotMatch(calls[0].req.user, /같이 가자/);
  assert.ok(calls.some((c) => c.req.user.includes('[고칠 것') && c.req.user.includes('말버릇 "같이 가자!"')));
  assert.ok(omitted.outline);
});

test('R9-A2 refrain templates keep 20 entries and none repeats the old catchphrase', () => {
  assert.equal(inv.refrainTemplates.length, 20);
  for (const t of inv.refrainTemplates) assert.equal(sharesCore(t.text, '같이 가자!'), false, t.text);
  const mirror = JSON.parse(readFileSync(join(root, '..', 'dist/story-quality/data/inventories.json'), 'utf8'));
  assert.deepEqual(mirror.refrainTemplates, inv.refrainTemplates);
});

test('R9-A2 CLI tools omit the catchphrase by default and accept --catchphrase', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sq-r9-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (out, extra = []) => {
    const r = spawnSync(process.execPath, [join(root, 'dist/cli/distill.js'), '--dry-run', '--limit', '1', '--concurrency', '1', '--out', out, ...extra], {
      cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(out, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  };
  const plain = run(join(dir, 'a.jsonl'));
  for (const row of plain) {
    assert.match(row.prompt.user, /^\[등장인물\] 유하: 호기심 많음, 씩씩함, 장난꾸러기$/m);
    assert.doesNotMatch(row.prompt.user, /말버릇|같이 가자/);
  }
  const custom = run(join(dir, 'b.jsonl'), ['--catchphrase', '내가 먼저 해 볼래!']);
  assert.match(custom[0].prompt.user, /말버릇 "내가 먼저 해 볼래!"\(책 전체에서 최대 1번/);
  for (const file of ['src/cli/eval.ts', 'src/cli/distill.ts', 'src/cli/finetune.ts'])
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /같이 가자/, file);
});
