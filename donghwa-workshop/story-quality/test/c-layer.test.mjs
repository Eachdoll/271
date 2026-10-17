import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, '..', p), 'utf8'));
const inv = read('data/inventories.json');
const patterns = read('data/plot_patterns.json');
const worldsLib = read('data/worlds.json');
const gold = [...read('gold/gold_outlines_part1.json'), ...read('gold/gold_outlines_part2.json')];
const bad = read('gold/bad_examples.json');
const topics = read('distill/topics.json');
const testset = read('eval/testset.json');

const m = await import('../dist/node.js');
const { plotCheck, topicKeywords, containsPlanted, findWorld, worldCoreLines, suggestWorlds, cycleWorldsByEra, composeSeed, buildBanList, runDistillation, loadExisting, runEval, summarize, compareSummaries, calibrateJudge, judgeOutline, buildExamples, writeDataset, toLine, estimateDistillCost, expandInventory, applyOverlay, allWorldStates, generateTopics, josa, fillKo } = m;

const scratch = () => mkdtempSync(join(tmpdir(), 'sq-'));
const protagonist = { name: '유하', traits: ['호기심 많음', '씩씩함'], catchphrase: '같이 가자!' };
const supporting = [{ name: '초록이', traits: ['느긋함'], role: '공룡 친구' }];

test('worlds: 100 cards across 4 eras, every card complete', () => {
  assert.equal(worldsLib.worlds.length, 100);
  const eras = {};
  for (const w of worldsLib.worlds) {
    eras[w.era] = (eras[w.era] || 0) + 1;
    assert.ok(w.landmarks.length >= 3 && w.subLocations.length >= 5 && w.creatures.length >= 3 && w.props.length >= 5, w.id);
    assert.ok(w.palette.length === 5 && w.styleHint.length > 20 && w.returnCue, w.id);
    assert.ok(!/디즈니|지브리|픽사|disney|ghibli|pixar/i.test(JSON.stringify(w)), `brand name in ${w.id}`);
  }
  assert.deepEqual(eras, { present: 40, past: 20, future: 16, fantasy: 24 });
  assert.equal(new Set(worldsLib.worlds.map((w) => w.id)).size, 100);
  assert.equal(new Set(worldsLib.worlds.map((w) => w.name.ko)).size, 100);
  // 오버레이: 계절 4 × 시간 2
  assert.deepEqual(Object.keys(worldsLib.overlays.seasons), ['spring', 'summer', 'autumn', 'winter']);
  assert.deepEqual(Object.keys(worldsLib.overlays.times), ['day', 'night']);
});

test('expand: variants, overlays, generated topics (10× by combination)', () => {
  const ex = expandInventory(inv);
  assert.ok(ex.plantedObjects.length >= 1500, String(ex.plantedObjects.length));
  assert.ok(ex.creatures.length >= 2500, String(ex.creatures.length));
  assert.equal(new Set(ex.plantedObjects.map((o) => o.ko)).size, ex.plantedObjects.length);
  const base = inv.plantedObjects.find((o) => inv.variantRules.colorableSuffixes.some((sfx) => o.ko.endsWith(sfx)) && !inv.variantRules.objectColors.some((c) => o.ko.startsWith(c.ko)));
  const red = ex.plantedObjects.find((o) => o.ko === `빨간 ${base.ko}`);
  assert.ok(red && /^(a|an) red /.test(red.en), `color variant with article: ${JSON.stringify(red)}`);
  assert.ok(ex.plantedObjects.some((o) => o.ko === `아주 작은 ${base.ko}` && /^a tiny /.test(o.en)), 'size variant');
  assert.ok(!ex.plantedObjects.some((o) => /^(빨간|파란) (빨간|파란) /.test(o.ko)), 'no double color');
  // 오버레이
  const kyoto = findWorld(worldsLib, 'kyoto_lane');
  const st = applyOverlay(worldsLib, kyoto, 'autumn', 'night');
  assert.equal(st.stateLabel.ko, '가을 밤');
  assert.ok(st.props.length > kyoto.props.length && st.creatures.length > kyoto.creatures.length);
  assert.match(st.styleHint, /autumn/);
  assert.match(worldCoreLines(worldsLib, st)[0], /때: 가을 밤/);
  const mars = applyOverlay(worldsLib, findWorld(worldsLib, 'mars_base'), 'summer', 'day');
  assert.equal(mars.season, null); // 우주에는 계절이 없다
  assert.equal(allWorldStates(worldsLib).length, 100 * 8 - 9 * 6 - 24 * 6); // 계절 없는 세계(상상 24 + 우주·바다 9)는 낮/밤 2가지
  // 조사
  assert.equal(josa('바다표범', '와'), '과');
  assert.equal(josa('나무', '와'), '와');
  assert.equal(josa('방패', '을'), '를');
  assert.equal(josa('골목', '로'), '으로');
  assert.equal(josa('마을', '로'), '로');
  assert.equal(fillKo('{creature:와} 누가 더 멋진 {prop}', { creature: '바다표범', prop: '나무 방패(장난감)' }), '바다표범과 누가 더 멋진 나무 방패');
  // 주제 생성: 결정적, 패턴 6종 모두, 괄호·빈 자리 없음
  const g1 = generateTopics(worldsLib, { perWorld: 12, seed: 1 });
  const g2 = generateTopics(worldsLib, { perWorld: 12, seed: 1 });
  assert.deepEqual(g1.map((t) => t.topic), g2.map((t) => t.topic));
  assert.ok(g1.length >= 1100, String(g1.length));
  assert.equal(new Set(g1.map((t) => t.patternId)).size, 6);
  assert.equal(new Set(g1.map((t) => t.worldId)).size, 100);
  for (const t of g1) assert.ok(!/[()]|\{|\}|  /.test(t.topic), t.topic);
  // 세계마다 패턴 6종이 모두 있다
  const byWorld = new Map();
  for (const t of g1) byWorld.set(t.worldId, (byWorld.get(t.worldId) ?? new Set()).add(t.patternId));
  for (const [w, set] of byWorld) assert.equal(set.size, 6, w);
  // composeSeed 변형
  const P = patterns[0];
  let withVariant = 0;
  for (let i = 0; i < 200; i++) {
    const s = composeSeed({ pattern: P, inventories: inv, backgroundType: 'forest', rngSeed: i, world: kyoto });
    if (inv.variantRules.objectColors.some((c) => s.planted.ko.startsWith(c.ko + ' ')) || inv.variantRules.objectSizes.some((c) => s.planted.ko.startsWith(c.ko + ' ')) || inv.variantRules.creatureTraits.some((c) => s.creature.ko.startsWith(c.ko + ' '))) withVariant++;
  }
  assert.ok(withVariant > 40 && withVariant < 160, String(withVariant));
  const none = composeSeed({ pattern: P, inventories: inv, backgroundType: 'forest', rngSeed: 3, world: kyoto, variantChance: 0 });
  assert.ok(inv.plantedObjects.some((o) => o.ko === none.planted.ko) || kyoto.props.some((o) => o.ko === none.planted.ko));
});

test('worldCoreLines gives 3 lines; suggestWorlds prefers topic match and avoids recent', () => {
  const dino = findWorld(worldsLib, 'dino_land');
  const lines = worldCoreLines(worldsLib, dino);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /모험터널이 공룡나라로 열린다/);
  const s = suggestWorlds(worldsLib, { topic: '낙타와 사막', recentWorldIds: ['egypt_nile'], k: 2 });
  assert.equal(s[0].id, 'silk_road_caravan');
  const cyc = cycleWorldsByEra(worldsLib, 8);
  assert.deepEqual(cyc.slice(0, 4).map((w) => w.era), ['present', 'past', 'future', 'fantasy']);
});

test('composeSeed with a world card draws sub-locations and creatures from that world', () => {
  const w = findWorld(worldsLib, 'mars_base');
  const seed = composeSeed({ pattern: patterns[0], inventories: inv, backgroundType: 'mars_base', rngSeed: 11, world: w });
  assert.ok(seed.subLocations.every((l) => w.subLocations.some((x) => x.ko === l.ko)));
  assert.ok(w.creatures.some((c) => c.ko === seed.creature.ko));
});

test('plotCheck helpers: particles stripped, head-noun planted match', () => {
  assert.deepEqual(topicKeywords('사바나에서 물 찾기'), ['사바나', '찾기']);
  assert.deepEqual(topicKeywords('안데스에서 누가 더 멋진지'), ['안데스', '멋진지']);
  assert.ok(containsPlanted('유하가 줄무늬 양말을 신어요', '양말 한 짝'));
  assert.ok(containsPlanted('빈 물통을 흔들어요', '빈 물통'));
  assert.ok(!containsPlanted('작은 새가 울어요', '작은 종'));
});

test('all 24 gold outlines pass plotCheck; all 3 bad examples fail', () => {
  for (const g of gold) {
    const r = plotCheck({ outline: g.outline, topic: g.topic, protagonistName: '유하', inventories: inv });
    assert.ok(r.ok, `${g.bookId}: ${[...r.fix, ...r.regenerate].join(' | ')}`);
    assert.equal(g.outline.beats.length, patterns.find((p) => p.id === g.patternId).beats.length, g.bookId);
    assert.ok(findWorld(worldsLib, g.worldId), g.worldId);
  }
  for (const b of bad) {
    const r = plotCheck({ outline: b.outline, topic: b.topic, protagonistName: '유하', inventories: inv });
    assert.ok(!r.ok, b.bookId);
  }
  assert.equal(new Set(gold.map((g) => g.worldId)).size >= 20, true);
  assert.equal(new Set(gold.map((g) => g.outline.plan.planted)).size, 24, 'planted objects all distinct');
});

test('topic sets: 50 distill + 20 eval, disjoint, valid world/pattern ids', () => {
  const pid = new Set(patterns.map((p) => p.id));
  const wid = new Set(worldsLib.worlds.map((w) => w.id));
  assert.ok(topics.topics.length >= 1200, String(topics.topics.length));
  assert.equal(topics.topics.filter((t) => t.source === 'hand').length, 50);
  assert.ok(topics.topics.filter((t) => t.source === 'generated').length >= 1100);
  assert.equal(new Set(topics.topics.map((t) => t.id)).size, topics.topics.length);
  assert.equal(new Set(topics.topics.map((t) => t.topic)).size, topics.topics.length);
  assert.equal(testset.topics.length, 20);
  for (const t of [...topics.topics, ...testset.topics]) {
    assert.ok(pid.has(t.patternId), t.id);
    assert.ok(wid.has(t.worldId), t.id);
  }
  const a = new Set(topics.topics.map((t) => t.topic));
  for (const t of testset.topics) assert.ok(!a.has(t.topic), `overlap ${t.topic}`);
  const goldTopics = new Set(gold.map((g) => g.topic));
  for (const t of topics.topics) assert.ok(!goldTopics.has(t.topic), `overlap with gold ${t.topic}`);
  // 세계 커버리지: 증류 주제는 100개 세계 전부, 평가는 20개 세계
  assert.equal(new Set(topics.topics.map((t) => t.worldId)).size, 100);
  assert.equal(new Set(testset.topics.map((t) => t.worldId)).size, 20);
});

test('estimateDistillCost: 400 cells with observed Sonnet gen + Haiku judge ≈ $15', () => {
  const est = estimateDistillCost(400, 1400, { input: 2, output: 10 }, { input: 0.1, output: 0.5 });
  assert.ok(est.usd > 13 && est.usd < 18, String(est.usd));
});

// 가짜 엔진: 프롬프트의 [정해진 재료]를 읽어 plotCheck를 통과하는 줄거리를 만든다 / 판정은 비트 수로
function fakeGenerator() {
  return {
    id: 'fake-gen',
    async complete(req) {
      const u = req.user;
      const planted = (u.match(/- 심을 물건: ([^—\n]+)—/) ?? [])[1]?.trim() ?? '물건';
      const creature = (u.match(/- 배경 생물: ([^(\n]+)\(/) ?? [])[1]?.trim() ?? '생물';
      const topic = (u.match(/\[주제\] ([^\s]+(?: [^\s\[]+)*)\s+\[가치\]/) ?? [])[1] ?? '주제';
      const reasons = [...u.matchAll(/\d차 ([^,\n]+)/g)].map((x) => x[1].trim());
      const map = { '잘못된 장소': 'wrong_place', '잘못된 방법': 'wrong_method', '거의 됐는데 방해': 'interrupted' };
      const pattern = (u.match(/"pattern": "([a-z_]+)"/) ?? [])[1];
      const slots = [...u.matchAll(/^\d+ (setup|want|attempt|turn|resolution|close) —/gm)].map((x) => x[1]);
      let ai = 0;
      const beats = slots.map((type, i) => {
        const idx = i + 1;
        let fr = null;
        if (type === 'attempt') fr = map[reasons[ai++]] ?? 'wrong_place';
        const key = i === 0 || i === slots.length - 1 ? 'home' : `place${(i % 3) + 1}`;
        const txt = type === 'setup' ? `아침, 유하가 ${planted}을 챙겨요. ${topic} 이야기가 시작돼요.` : type === 'turn' ? `${planted}이 뜻밖의 일을 해요. 유하가 알아차려요. ${creature}가 나타나요.` : `유하가 ${idx}번째 장소에서 새로운 일 ${idx}을 겪어요. 초록이가 ${idx}번 따라와요.`;
        return { index: idx, type, summary: txt, characters: ['유하'], settingKey: key, newElement: `요소${idx}`, failureReason: fr };
      });
      const o = { plan: { pattern, planted, twistReveal: 'x', funnyMoment: 'y', failureReasons: reasons.map((r) => map[r]) }, titleCandidates: ['a', 'b', 'c'], logline: 'l', want: 'w', problem: 'p', beats, refrain: { text: '후렴', usedAtBeats: [3, 5], variation: '크기' }, newWordsKo: ['a'], newWordsEn: ['a'], endingType: 'home_sleep' };
      return { text: JSON.stringify(o), usage: { input: 1400, output: 1200 }, costUsd: 0.01 };
    },
  };
}
function fakeJudge(score = 9) {
  return {
    id: 'fake-judge',
    async complete(req) {
      if (req.user.includes('[채점 기준]')) {
        const nBeats = (req.user.match(/"i":\d+/g) ?? []).length;
        const summaries = [...req.user.matchAll(/"summary":"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
        const tails = summaries.map((t) => t.split(/[.!?]/).filter(Boolean).pop()?.trim());
        const counts = {}; for (const t of tails) counts[t] = (counts[t] || 0) + 1;
        const repeated = Object.values(counts).some((c) => c >= 3);
        const turn = [...req.user.matchAll(/"type":"turn","summary":"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1])[0] ?? '';
        const trivialTurn = turn.length > 0 && turn.length < 15;
        const bad = req.user.includes('마음이 참 따뜻해요') || req.user.includes('좋은 거예요') || nBeats === 0 || repeated || trivialTurn;
        const v = bad ? 0 : score >= 10 ? 2 : 1;
        const s = bad ? { event: 0, causality: 0, repetition: 0, twist: 0, concreteness: 1 } : { event: 2, causality: 2, repetition: 2, twist: v, concreteness: 2 };
        return { text: JSON.stringify({ scores: s, worst2: ['twist'], fixes: [] }), usage: { input: 1800, output: 150 }, costUsd: 0.001 };
      }
      const j = JSON.parse(req.user.slice(req.user.indexOf('{')));
      return { text: JSON.stringify(j), usage: { input: 100, output: 100 }, costUsd: 0.001 };
    },
  };
}

test('distillation: generates, filters, resumes (skips existing), and grows the ban list', async () => {
  const dir = scratch();
  const out = join(dir, 'outlines.jsonl');
  const cfg = { generator: fakeGenerator(), judge: fakeJudge(10), topics: topics.topics.slice(0, 3), levels: [{ levelKo: 'K1', levelEn: 'E0' }], pages: 12, patterns, worlds: worldsLib, inventories: inv, protagonist, supporting, outPath: out, variantsPerCell: 1, seedBooks: gold, concurrency: 1 };
  const r1 = await runDistillation(cfg);
  assert.equal(r1.total, 3);
  assert.equal(r1.approved, 3, 'fake outlines should be approved');
  const r2 = await runDistillation(cfg);
  assert.equal(r2.total, 0);
  assert.equal(r2.skipped, 3);
  const rows = [...loadExisting(out).values()];
  assert.equal(rows.length, 3);
  assert.ok(rows.every((s) => s.plotCheck.ok && s.rubric.total === 10 && s.prompt.user.includes('[정해진 재료]')));
  // 승인된 샘플의 심은 물건이 다음 샘플의 금지 목록에 들어갔는지(같은 세계 소품이면 피했는지)
  const planted = rows.map((s) => s.outline.plan.planted);
  assert.equal(new Set(planted).size, planted.length, 'planted objects distinct across dataset');
});

test('eval harness: runs fixed set with fake engines, writes rows + summary, compare table renders', async () => {
  const dir = scratch();
  const cfg = { runId: 'fake-v1', generator: fakeGenerator(), judge: fakeJudge(10), topics: [0, 9, 15, 18, 19].map((i) => testset.topics[i]), pages: 12, patterns, worlds: worldsLib, inventories: inv, protagonist, supporting, approvedBooks: gold, outDir: dir, options: { useFixPass: true, exampleCount: 1 } };
  const s1 = await runEval(cfg);
  assert.equal(s1.n, 5);
  assert.equal(s1.errors, 0);
  assert.equal(s1.plotPassRate, 1);
  assert.equal(s1.rubricMean, 10);
  assert.ok(existsSync(join(dir, 'fake-v1.jsonl')) && existsSync(join(dir, 'fake-v1.summary.json')));
  assert.ok(Object.keys(s1.byEra).length >= 2);
  const s2 = await runEval({ ...cfg, runId: 'fake-v2', judge: fakeJudge(9) });
  assert.equal(s2.rubricMean, 9);
  const table = compareSummaries([s1, s2], 'fake-v1');
  assert.match(table, /fake-v2\tfake-gen\t9.00\t-1.00/);
  // 재개: 같은 runId로 다시 돌리면 추가 호출 없이 요약만
  const s3 = await runEval(cfg);
  assert.equal(s3.n, 5);
});

test('calibrateJudge separates gold from bad examples with the fake judge', async () => {
  const r = await calibrateJudge(fakeJudge(10), gold.slice(0, 6), bad);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.separation >= 5);
});

test('judgeOutline clamps and computes pass', async () => {
  const r = await judgeOutline(fakeJudge(9), gold[0].outline);
  assert.equal(r.total, 9);
  assert.equal(r.pass, true);
  const b = await judgeOutline(fakeJudge(9), bad[0].outline);
  assert.equal(b.pass, false);
});

test('finetune converter: gold → mlx chat jsonl, topic-level split, completions format', () => {
  const res = buildExamples({ samples: [], gold, patterns, worlds: worldsLib, inventories: inv, protagonist, supporting, validRatio: 0.1 });
  assert.equal(res.stats.total, 24);
  assert.equal(res.train.length + res.valid.length, 24);
  assert.ok(res.valid.length >= 2);
  const line = JSON.parse(toLine(res.train[0], 'mlx'));
  assert.deepEqual(line.messages.map((x) => x.role), ['system', 'user', 'assistant']);
  const answer = JSON.parse(line.messages[2].content);
  assert.ok(answer.beats.length >= 6 && answer.plan.planted);
  assert.match(line.messages[1].content, /\[정해진 재료\]/);
  assert.ok(line.messages[1].content.includes(answer.plan.planted), 'prompt seed matches the answer planted object');
  const comp = JSON.parse(toLine(res.train[0], 'completions'));
  assert.ok(comp.prompt && comp.completion);
  const dir = scratch();
  const paths = writeDataset(dir, res, 'mlx');
  assert.ok(existsSync(paths.trainPath) && existsSync(paths.validPath) && existsSync(paths.testPath) && existsSync(join(dir, 'stats.json')));
});
