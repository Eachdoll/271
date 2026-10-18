import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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
  catchphraseClauses, isCatchphraseFix, catchphraseRepeatFix, refrainOverlapFix, renderFixInstructions,
  PROSE_RICH_USER_KO_R8, PROSE_RICH_USER_EN_R8, runProseStage,
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
  // 긴 제한 문장은 한 번만, 나머지 인물은 짧게(프롬프트 길이 → 참고 예시 수 유지).
  assert.match(once, /초록이\(공룡 친구\): 느긋함, 먹보, 말버릇 "쿵쿵, 냠냠!"\(최대 1번\)( \/|$)/m);
  assert.equal(once.split('꼭 쓰지 않아도 된다').length - 1, 1);
  assert.match(once, /토토: 조용함( \/|$)/m);
  const empty = buildOutlinePrompt({ ...base, protagonist: { name: '유하', traits: ['호기심 많음'] } }).user;
  assert.doesNotMatch(empty, /말버릇 ""/);
  assert.match(empty, /^\[등장인물\] 유하: 호기심 많음$/m);
  // 주인공에게 말버릇이 없으면 말버릇이 있는 첫 조연이 긴 문장을 받는다.
  assert.match(empty, /초록이\(공룡 친구\): 느긋함, 먹보, 말버릇 "쿵쿵, 냠냠!"\(책 전체에서 최대 1번, 꼭 쓰지 않아도 된다\. 후렴으로 쓰지 않는다\)/);
  const omitted = buildOutlinePrompt({ ...base, protagonist: { name: '유하', traits: ['호기심 많음'], catchphrase: '같이 가자!', catchphraseOmitted: true } }).user;
  assert.doesNotMatch(omitted, /같이 가자/);
  assert.match(omitted, /^\[등장인물\] 유하: 호기심 많음, 이번 책에서는 말버릇을 쓰지 않는다$/m);
  assert.match(omitted, /말버릇 "쿵쿵, 냠냠!"\(책 전체에서 최대 1번, 꼭 쓰지 않아도 된다/);
  assert.deepEqual(catchphraseClauses([{ catchphrase: 'a b' }, { catchphrase: '하나\n둘' }, {}, { catchphrase: 'x', catchphraseOmitted: true }]), [
    ', 말버릇 "a b"(책 전체에서 최대 1번, 꼭 쓰지 않아도 된다. 후렴으로 쓰지 않는다)', ', 말버릇 "하나 둘"(최대 1번)', '', ', 이번 책에서는 말버릇을 쓰지 않는다',
  ]);
  assert.ok(roughTokenCount(once) < 1800);
});

test('R9-A prose prompts limit catchphrases to one use in KO and EN', () => {
  assert.ok(PROSE_RICH_USER_KO.includes(CATCHPHRASE_RULE_KO));
  assert.ok(PROSE_RICH_USER_EN.includes(CATCHPHRASE_RULE_EN));
  // r8 문안(앱의 정책 없는 기존 초안)은 규칙 9만 없다.
  assert.equal(PROSE_RICH_USER_KO_R8, PROSE_RICH_USER_KO.replace(`\n9 ${CATCHPHRASE_RULE_KO}`, ''));
  assert.ok(!PROSE_RICH_USER_KO_R8.includes('말버릇') && !PROSE_RICH_USER_EN_R8.includes('catchphrase'));
  assert.match(PROSE_RICH_USER_KO_R8, /8 교훈·감상 꼬리말 금지\. 같은 문장 두 번 금지\.\n\n\[출력\]/);
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

// ---- R9 수정(FIX-A): 줄바꿈 말버릇, 권고 전용 항목, 프롬프트 길이, 기존 초안 문안 ----

test('R9 fix: a refrain or catchphrase with a newline stays one fix line and is still recognised', () => {
  const overlap = refrainOverlapFix('하나, 둘,\n같이 가자!', '같이\n가자!', [3, 5]);
  assert.equal(overlap, '후렴 "하나, 둘, 같이 가자!"이(가) 말버릇 "같이 가자!"과(와) 같은 구절을 씀 — 후렴을 다른 말로 바꾼다: 비트 3·비트 5');
  assert.equal(isCatchphraseFix(overlap), true);
  const repeat = catchphraseRepeatFix('같이\n  가자!', 3, [2, 4], true);
  assert.ok(!repeat.includes('\n'));
  assert.equal(isCatchphraseFix(repeat), true);
  // 줄바꿈이 남은 예전 항목도 알아본다.
  assert.equal(isCatchphraseFix('후렴 "하나, 둘,\n같이 가자!"이(가) 말버릇 "같이 가자!"과(와) 같은 구절을 씀 — x'), true);
  assert.equal(isCatchphraseFix('말버릇 "같이\n가자!" 2회(책 전체 최대 1회): 비트 2'), true);
  assert.equal(isCatchphraseFix('비트 3 newElement 비어 있음'), false);
  // plotCheck 항목 전체가 "- " 한 줄이라 앱의 부분 수정이 "비트 N"을 읽는다.
  const outline = outlineWith([
    '유하가 노란 우산을 챙겨요.', '유하가 걸어요.', '유하가 개울을 건너요. 같이 가자!', '유하가 돌을 봐요.',
    '유하가 언덕에 올라요.', '노란 우산이 노래해요.', '유하가 집에 와요.',
  ], { text: '하나, 둘,\n같이 가자!', usedAtBeats: [3, 5], variation: '숫자' });
  const res = plotCheck({ outline, topic: '비 오는 날', protagonistName: '유하', catchphrases: ['같이 가자!'] });
  const items = res.fix.filter(isCatchphraseFix);
  assert.equal(items.length, 2, res.fix.join(' | '));
  const lines = renderFixInstructions(res).split('\n');
  for (const item of items) assert.ok(lines.includes(`- ${item}`), item);
});

function stageEngine(calls, { blocking = false } = {}) {
  return (id) => ({
    id,
    async complete(req) {
      calls.push({ id, req });
      if (req.user.startsWith('아래 줄거리 JSON에서')) {
        const j = JSON.parse(req.user.slice(req.user.lastIndexOf('\n\n{') + 2));
        j.beats = j.beats.map((b) => ({ ...b, newElement: b.newElement || '고친 요소', summary: b.summary.replace('"같이 가자!"', '"여기야!"') }));
        return { text: JSON.stringify(j), usage: { input: 1, output: 1 }, costUsd: 0 };
      }
      // smoke.test.mjs의 깨끗한 줄거리에 말버릇만 비트 2·4에 넣는다(다른 수정 항목 없음).
      const u = req.user;
      const planted = (u.match(/- 심을 물건: ([^—\n]+)—/) ?? [])[1]?.trim() ?? '물건';
      const reasons = [...u.matchAll(/\d차 ([^,\n]+)/g)].map((x) => ({ '잘못된 장소': 'wrong_place', '잘못된 방법': 'wrong_method', '거의 됐는데 방해': 'interrupted' })[x[1].trim()]);
      const creature = (u.match(/- 배경 생물: ([^(\n]+)\(/) ?? [])[1]?.trim() ?? '생물';
      const beats = [
        { index: 1, type: 'setup', summary: `아침, 유하가 ${planted}을 챙겨요. 공룡나라 비가 와요.`, settingKey: 'home', newElement: '현관' },
        { index: 2, type: 'want', summary: `유하는 쌍봉 화산을 보고 싶어요. "같이 가자!"`, settingKey: 'dino', newElement: '화산' },
        { index: 3, type: 'attempt', summary: `유하가 호수 쪽으로 가요. 물웅덩이뿐이에요.`, settingKey: 'lake', newElement: blocking ? '' : '웅덩이', failureReason: reasons[0] },
        { index: 4, type: 'attempt', summary: `초록이가 고사리를 밀어요. ${creature}만 나와요. 유하가 "같이 가자!" 외쳐요.`, settingKey: 'fern', newElement: creature, failureReason: reasons[1] },
        { index: 5, type: 'attempt', summary: `유하가 언덕에 오르는데 바람이 모자를 날려요.`, settingKey: 'hill', newElement: '모자', failureReason: reasons[2] },
        { index: 6, type: 'turn', summary: `${planted}이 바람에 노래해요. 유하가 알아차려요.`, settingKey: 'hill', newElement: '노래' },
        { index: 7, type: 'close', summary: `유하가 집에 와서 ${planted}을 침대 옆에 둬요.`, settingKey: 'home', newElement: '침대' },
      ].map((b) => ({ characters: ['유하'], ...b }));
      return { text: JSON.stringify({ plan: { pattern: 'journey_repeat', planted, twistReveal: 'x', funnyMoment: 'y', failureReasons: reasons }, titleCandidates: ['a', 'b', 'c'], logline: 'l', want: 'w', problem: 'p', beats, refrain: { text: '토독토독', usedAtBeats: [3, 5], variation: '크기' }, newWordsKo: ['장화'], newWordsEn: ['boots'], endingType: 'home_sleep' }), usage: { input: 1, output: 1 }, costUsd: 0 };
    },
  });
}
const stageBase = {
  protagonist: { name: '유하', traits: ['호기심 많음'], catchphrase: '같이 가자!' }, supporting: [],
  worldCore: ['a', 'b', 'c'], topic: '공룡나라 비 오는 날', levelKo: 'K1', levelEn: 'E0', pages: 12, pattern: P, backgroundType: 'dino_land',
  inventories: inv, approvedBooks: [], endingType: 'home_sleep',
};
const enginesOf = (make) => ({ outline: make('outline'), prose: make('prose'), cheap: make('cheap') });

test('R9 fix: advisoryCatchphrases never spends a fix call on catchphrase items alone, but keeps them in a mixed pass', async () => {
  const calls = [];
  const alone = await runOutlineStage({ ...stageBase, engines: enginesOf(stageEngine(calls)), bookId: 'r9-fix-a', advisoryCatchphrases: true });
  assert.equal(calls.length, 1, 'only the outline call');
  assert.equal(alone.calls, 1);
  assert.ok(alone.check.fix.length > 0 && alone.check.fix.every(isCatchphraseFix), alone.check.fix.join(' | '));

  calls.length = 0;
  const mixed = await runOutlineStage({ ...stageBase, engines: enginesOf(stageEngine(calls, { blocking: true })), bookId: 'r9-fix-b', advisoryCatchphrases: true });
  const fixCall = calls.find((c) => c.req.user.startsWith('아래 줄거리 JSON에서'));
  assert.ok(fixCall, 'mixed items still get the one fix pass');
  assert.match(fixCall.req.user, /^- 말버릇 "같이 가자!" 2회/m);
  assert.match(fixCall.req.user, /newElement/);
  assert.equal(mixed.calls, 2);
  assert.deepEqual(mixed.check.fix, []);
});

test('R9 fix: a 3-character cast with catchphrases keeps the r8 retrieval example count for every pattern', async () => {
  const gold = [...read('gold/gold_outlines_part1.json'), ...read('gold/gold_outlines_part2.json')].map((b) => ({ ...b, referenceSource: 'gold' }));
  const cast = [
    { name: '유하', traits: ['호기심 많음', '씩씩함', '장난꾸러기'], catchphrase: '같이 가자!' },
    { name: '초록이', traits: ['느긋함', '먹보'], role: '공룡 친구', catchphrase: '쿵쿵, 냠냠!' },
    { name: '엄마', traits: ['다정함', '차분함'], role: '엄마', catchphrase: '천천히 해도 괜찮아.' },
  ];
  const firstRequest = async (pattern, legacy) => {
    let req;
    const engine = { id: 'x', async complete(r) { req = r; throw new Error('stop'); } };
    await assert.rejects(runOutlineStage({
      engines: { outline: engine, prose: engine, cheap: engine }, bookId: `count-${pattern.id}`, protagonist: cast[0], supporting: cast.slice(1),
      worldCore: ['소파 뒤 터널', '공룡은 말을 한다', '저녁밥 냄새'], topic: '비 오는 날 산책', levelKo: 'K1', levelEn: 'E0', pages: 12, pattern, backgroundType: 'forest',
      inventories: inv, approvedBooks: [], referenceBooks: gold, endingType: 'home_sleep', legacyCatchphrasePrompt: legacy,
    }), /stop/);
    return req;
  };
  const examples = (req) => (req.user.match(/^예시 \d+ \(/gm) ?? []).length;
  // 873bc2e(R9 이전) 패키지로 같은 입력을 잰 값.
  const r8Counts = { journey_repeat: 1, accumulate: 2, search_wrong_answers: 2, waiting: 2, escalation: 2, mystery_sound: 2 };
  assert.deepEqual(patterns.map((p) => p.id), Object.keys(r8Counts));
  for (const pattern of patterns) {
    const now = await firstRequest(pattern, false), r8 = await firstRequest(pattern, true);
    assert.equal(examples(r8), r8Counts[pattern.id], `r8 ${pattern.id}`);
    assert.equal(examples(now), examples(r8), pattern.id);
    assert.equal(now.user.split('꼭 쓰지 않아도 된다').length - 1, 1, pattern.id);
    assert.match(now.user, /엄마\(엄마\): 다정함, 차분함, 말버릇 "천천히 해도 괜찮아\."\(최대 1번\)/);
    assert.match(r8.user, /^\[등장인물\] 유하: 호기심 많음, 씩씩함, 장난꾸러기, 말버릇 "같이 가자!"$/m);
  }
});

/**
 * 같은 입력으로 줄거리(단일·수정 호출)·빔·전문(한/영) 요청을 모두 모은다. legacy=true면 R9 이전 패키지와 글자 하나
 * 다르지 않아야 한다. 해시는 873bc2e 패키지(story-quality/dist)로 이 함수를 돌린 값이다.
 * 다시 재려면: PRE_R9_STORY_QUALITY_DIST=<873bc2e의 story-quality/dist 절대 경로> npm run test:quality
 */
async function legacyRequests(pkg, legacy) {
  const requests = [];
  const levels = read('test/levels.fixture.json');
  const gold = [...read('gold/gold_outlines_part1.json'), ...read('gold/gold_outlines_part2.json')].map((b) => ({ ...b, referenceSource: 'gold' }));
  const engine = (id) => ({
    id,
    async complete(req) {
      requests.push({ id, system: req.system, user: req.user, temperature: req.temperature ?? null, maxTokens: req.maxTokens ?? null });
      const u = req.user;
      let text;
      if (u.includes('후보를 3개') || u.includes('[이번에 쓸 비트]')) {
        const idx = (u.match(/\[이번에 쓸 비트\] (\d+) · (\w+)/) ?? [])[1] ?? '1';
        text = JSON.stringify({ candidates: ['A', 'B', 'C'].map((k) => ({ summary: `유하가 ${idx}번째 일 ${k}을 해요. "같이 가자!" 공룡나라에 비가 와요.`, newElement: `요소${idx}${k}`, failureReason: null })) });
      } else if (u.includes('[후보]') && u.includes('A:')) {
        text = JSON.stringify({ best: 'B', scores: { A: 5, B: 8, C: 6 }, why: '인과' });
      } else if (u.includes('나머지 필드를 JSON')) {
        text = JSON.stringify({ titleCandidates: ['a', 'b', 'c'], logline: 'l', want: 'w', problem: 'p', twistReveal: 't', funnyMoment: 'f', refrain: { text: '하나, 둘, 같이 가자!', usedAtBeats: [3, 5], variation: '숫자' }, newWordsKo: ['장화'], newWordsEn: ['boots'] });
      } else if (u.startsWith('아래 줄거리 JSON에서')) {
        text = u.slice(u.lastIndexOf('\n\n{') + 2);
      } else if (req.system.includes('넉넉하게 쓰는 단계')) {
        text = '[비트 1 · setup] 유하가 우산을 들었어요. "같이 가자!"\n\n[비트 2 · want] 유하는 화산을 보고 싶었어요.';
      } else if (req.system.includes('그림책 편집자다. 아래 글의 사건')) {
        text = '[비트 1 · setup] 유하가 우산을 들어요.\n\n[비트 2 · want] 유하는 화산을 보고 싶어요.';
      } else {
        const planted = (u.match(/- 심을 물건: ([^—\n]+)—/) ?? [])[1]?.trim() ?? '물건';
        const beats = ['setup', 'want', 'attempt', 'attempt', 'attempt', 'turn', 'close'].map((type, i) => ({
          index: i + 1, type, characters: ['유하'], settingKey: i === 0 || i === 6 ? 'home' : `p${i}`, newElement: i === 2 ? '' : `e${i}`, failureReason: null,
          summary: i === 1 || i === 3 ? `유하가 "같이 가자!" 해요. 공룡나라 비가 와요.` : `유하가 ${planted}을 봐요. 공룡나라 비.`,
        }));
        text = JSON.stringify({ plan: { pattern: 'journey_repeat', planted, twistReveal: 'x', funnyMoment: 'y', failureReasons: [] }, titleCandidates: ['a'], logline: 'l', want: 'w', problem: 'p', beats, refrain: { text: '하나, 둘, 같이 가자!', usedAtBeats: [3, 5], variation: '숫자' }, newWordsKo: [], newWordsEn: [], endingType: 'home_sleep' });
      }
      return { text, usage: { input: 1, output: 1 }, costUsd: 0 };
    },
  });
  const engines = { outline: engine('outline'), prose: engine('prose'), cheap: engine('cheap') };
  const base = {
    engines, protagonist: { name: '유하', traits: ['호기심 많음', '씩씩함'], catchphrase: '같이 가자!' },
    supporting: [{ name: '초록이', traits: ['느긋함', '먹보'], role: '공룡 친구', catchphrase: '쿵쿵, 냠냠!' }, { name: '토토', traits: ['조용함'], role: '토끼 친구' }],
    worldCore: ['소파 뒤 터널', '공룡은 말을 한다', '저녁밥 냄새'], topic: '공룡나라 비 오는 날', levelKo: 'K1', levelEn: 'E0', pages: 12, pattern: P,
    backgroundType: 'dino_land', inventories: inv, approvedBooks: [], referenceBooks: gold, endingType: 'home_sleep',
    ...(legacy ? { legacyCatchphrasePrompt: true } : {}),
  };
  const single = await pkg.runOutlineStage({ ...base, bookId: 'legacy-single' });
  await pkg.runOutlineStage({ ...base, bookId: 'legacy-beam', useBeamSearch: true });
  await pkg.runOutlineStage({ ...base, bookId: 'legacy-empty', protagonist: { name: '유하', traits: ['호기심 많음'] } });
  for (const lang of ['ko', 'en'])
    await pkg.runProseStage({
      engines, lang, outline: single.outline, charactersCompact: '유하 / 초록이', briefsCompact: '1 아침 비 / 2 화산', emotions: ['기대'],
      gestureDict: read('data/gesture_dictionary.json'), levels, targetLevelId: lang === 'ko' ? 'K1' : 'E0', pageCount: 12,
      ...(legacy ? { legacyCatchphrasePrompt: true } : {}),
    });
  return requests;
}
const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const PRE_R9_REQUESTS_SHA256 = 'a6e73f7138153f1a2c5bf3d77e49b10703d542ee2bf4e5a253282ac0f73ec1ec';

test('R9 fix: legacyCatchphrasePrompt sends the pre-R9 requests byte for byte (outline, fix pass, beam, prose)', async () => {
  const legacy = await legacyRequests(m, true);
  const users = legacy.map((r) => r.user).join('\n');
  assert.doesNotMatch(users, /최대 1번|꼭 쓰지 않아도|catchphrase at most once/);
  assert.match(users, /^\[등장인물\] 유하: 호기심 많음, 씩씩함, 말버릇 "같이 가자!"$/m);
  assert.match(users, /^\[등장인물\] 유하: 호기심 많음, 말버릇 ""$/m);
  const fixes = legacy.filter((r) => r.user.startsWith('아래 줄거리 JSON에서'));
  assert.ok(fixes.length >= 1);
  for (const fix of fixes) assert.doesNotMatch(fix.user, /^- (말버릇|후렴 ")/m);
  if (process.env.PRE_R9_STORY_QUALITY_DIST) {
    const pre = await import(pathToFileURL(join(process.env.PRE_R9_STORY_QUALITY_DIST, 'index.js')).href);
    const expected = await legacyRequests(pre, true);
    console.log(`pre-R9 requests sha256 ${sha256(expected)} (${expected.length} requests)`);
    assert.deepEqual(legacy, expected);
  }
  assert.equal(sha256(legacy), PRE_R9_REQUESTS_SHA256);
  // R9 문안(기본)은 같은 입력에서 제한 문구·규칙 9·말버릇 수정 항목을 보낸다.
  const current = await legacyRequests(m, false);
  const currentUsers = current.map((r) => r.user).join('\n');
  assert.match(currentUsers, /말버릇 "같이 가자!"\(책 전체에서 최대 1번/);
  assert.ok(currentUsers.includes(`9 ${CATCHPHRASE_RULE_KO}`) && currentUsers.includes(CATCHPHRASE_RULE_EN));
  assert.ok(current.some((r) => r.user.startsWith('아래 줄거리 JSON에서') && /^- 말버릇 "같이 가자!"/m.test(r.user)));
});
