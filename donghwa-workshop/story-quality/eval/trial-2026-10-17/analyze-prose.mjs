// 전문 단계 결과 요약: node eval/trial-2026-10-17/analyze-prose.mjs <runId>
import { readFileSync } from 'node:fs';
const id = process.argv[2];
const rows = readFileSync(new URL(`${id}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const ok = rows.filter((r) => !r.error), avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const out = { runId: id, rows: rows.length, errors: rows.filter((r) => r.error).map((r) => `${r.topicId}: ${r.error}`), costUsd: +rows.reduce((s, r) => s + r.costUsd, 0).toFixed(3), costPerBookUsd: +avg(rows.map((r) => r.costUsd)).toFixed(4), latencyMeanS: +(avg(rows.map((r) => r.latencyMs)) / 1000).toFixed(1), latencyMedianS: +(med(rows.map((r) => r.latencyMs)) / 1000).toFixed(1) };
for (const lang of ['ko', 'en']) {
  const x = ok.map((r) => r[lang]), viol = {};
  for (const v of x) for (const [k, n] of Object.entries(v.violations)) viol[k] = (viol[k] || 0) + n;
  out[lang] = {
    beatsAllCovered: x.filter((v) => v.missingBeats.length === 0).length,
    sentencesMean: +avg(x.map((v) => v.sentences)).toFixed(1), sentenceBudget: x[0]?.sentenceBudget, overBudgetBooks: x.filter((v) => v.sentences > v.sentenceBudget).length,
    richCharsMean: Math.round(avg(x.map((v) => v.richChars))), simplifiedCharsMean: Math.round(avg(x.map((v) => v.simplifiedChars))), simplifyRatio: +(avg(x.map((v) => v.simplifiedChars / Math.max(1, v.richChars)))).toFixed(2),
    dialogueMean: +avg(x.map((v) => v.dialogue)).toFixed(1), booksUnder3Dialogue: x.filter((v) => v.dialogue < 3).length,
    tellHitsBooks: x.filter((v) => v.tellHitsAfter > 0).length, extraFixCallBooks: x.filter((v) => v.calls > 2).length,
    pagesPassed: `${x.reduce((s, v) => s + v.pagesPassed, 0)}/${x.reduce((s, v) => s + v.pages, 0)}`, booksAllPagesPass: x.filter((v) => v.pagesPassed === v.pages).length,
    avgWordsPerSentence: +avg(x.map((v) => v.avgWordsPerSentence)).toFixed(2), outOfVocabRatio: lang === 'en' ? +avg(x.map((v) => v.outOfVocabRatio)).toFixed(3) : null,
    violations: viol,
    questionTailParagraphs: x.reduce((s, v) => s + (v.simplified.split(/\n\s*\n/).filter((p) => /[?？]\s*$/.test(p.trim())).length), 0) + '/' + x.reduce((s, v) => s + v.labeledBeats, 0),
  };
}
const c = ok.map((r) => r.child);
const childCalls = ok.flatMap((r) => r.callLog.filter((l) => l.role === 'child-call'));
out.child = { pass: c.filter((v) => v.pass).length, curiosityPass: c.filter((v) => v.curiosityPass).length, curiosityMean: +avg(c.map((v) => v.curiosityOverall)).toFixed(2), booksWithZeroPage: c.filter((v) => v.zeroPages > 0).length, retellPass: c.filter((v) => v.retellPass).length, retellCoherenceMean: +avg(c.map((v) => v.retellCoherence)).toFixed(2), turnRewrite: c.filter((v) => v.turnRewrite).length,
  childCallsOverPackageBudget: `${childCalls.filter((l) => l.out > l.requested).length}/${childCalls.length}`, childOutMax: Math.max(...childCalls.map((l) => l.out || 0)) };
console.log(JSON.stringify(out, null, 2));
if (process.argv.includes('--per')) for (const r of rows) console.log(r.topicId, r.error ? 'ERR' : `ko ${r.ko.sentences}s ${r.ko.pagesPassed}/${r.ko.pages} dlg${r.ko.dialogue} | en ${r.en.sentences}s ${r.en.pagesPassed}/${r.en.pages} oov${r.en.outOfVocabRatio} | child ${r.child.pass ? '✓' : '✗'} cur${r.child.curiosityOverall} ret${r.child.retellCoherence} miss${JSON.stringify(r.child.missingCore)}`, r.topic);
