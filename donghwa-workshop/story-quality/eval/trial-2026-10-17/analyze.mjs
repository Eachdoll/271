// Summarize eval results: per-topic table, aggregate stats, and dump a few outlines for reading.
import fs from 'node:fs';
const dir = process.argv[2];
const runs = process.argv.slice(3).filter((a) => !a.startsWith('--'));
const rows = {};
for (const id of runs) {
  const path = `${dir}/${id}.jsonl`;
  rows[id] = fs.existsSync(path) ? fs.readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
for (const id of runs) {
  const r = rows[id];
  const ok = r.filter((x) => !x.error);
  console.log(`\n## ${id}: ${r.length} rows, errors ${r.length - ok.length}`);
  const keys = ['event', 'causality', 'repetition', 'twist', 'concreteness'];
  const by = Object.fromEntries(keys.map((k) => [k, avg(ok.map((x) => (x.rubric?.scores?.[k] ?? x.rubric?.[k] ?? 0)))]));
  console.log(`rubric mean ${avg(ok.map((x) => x.rubricTotal)).toFixed(2)}/10 · pass(>=8, no zero) ${ok.filter((x) => x.rubricPass).length}/${ok.length} · plotCheck ok ${ok.filter((x) => x.plotOk).length}/${ok.length} · fixed ${ok.filter((x) => x.fixed).length} · cost $${r.reduce((s, x) => s + (x.costUsd || 0), 0).toFixed(3)} · mean latency ${Math.round(avg(ok.map((x) => x.latencyMs)) / 1000)}s`);
  console.log('per-criterion:', Object.entries(by).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · '));
  for (const x of r) console.log(`  ${x.topicId} ${x.rubricTotal.toString().padStart(2)} ${x.plotOk ? 'plot✓' : 'plot✗' + x.plotIssues} ${x.fixed ? 'fixed' : '     '} ${x.error ? 'ERR ' + x.error : ''} ${x.topic} ${x.rubric?.worst2?.length ? '· worst ' + x.rubric.worst2.join('/') : ''}`);
}
if (process.argv.includes('--dump')) {
  for (const id of runs) for (const x of rows[id].slice(0, 2)) {
    if (!x.outline) continue;
    console.log(`\n=== ${id} / ${x.topicId} ${x.topic} (rubric ${x.rubricTotal})`);
    const o = x.outline;
    console.log('logline:', o.logline, '\nwant:', o.want, '\nproblem:', o.problem, '\ntwist:', o.plan?.twistReveal, '\nplanted:', o.plan?.planted, '\nfunny:', o.plan?.funnyMoment, '\nrefrain:', JSON.stringify(o.refrain));
    for (const b of o.beats || []) console.log(` ${b.index} [${b.type}] ${b.summary}${b.newElement ? ' · new: ' + b.newElement : ''}${b.failureReason ? ' · fail: ' + b.failureReason : ''}`);
    if (x.rubric?.fixes?.length) console.log(' judge fixes:', x.rubric.fixes.join(' | '));
  }
}
