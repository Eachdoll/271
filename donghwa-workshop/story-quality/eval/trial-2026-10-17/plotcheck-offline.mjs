import fs from 'node:fs';
import { findWorld } from '../../dist/worlds.js';
import { buildBanList } from '../../dist/banList.js';
import { composeSeed, preferObstaclesForTopic } from '../../dist/composeSeed.js';
import { plotCheck } from '../../dist/plotCheck.js';
import { hashString } from '../../dist/util.js';
const root=new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const read=(p)=>JSON.parse(fs.readFileSync(`${root}/${p}`,'utf8'));
const patterns=read('data/plot_patterns.json'), worlds=read('data/worlds.json'), inventories=read('data/inventories.json');
const gold=[...read('gold/gold_outlines_part1.json'),...read('gold/gold_outlines_part2.json')];
const ts=read('eval/testset.json').topics;
const rows=fs.readFileSync(`${root}/eval/trial-2026-10-17/${process.argv[2]}.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
const tally={};
for (const row of rows) {
  if(!row.outline) continue;
  const t=ts.find(x=>x.id===row.topicId);
  const pattern=patterns.find(p=>p.id===t.patternId)??patterns[0];
  const world=findWorld(worlds,t.worldId);
  const ban=buildBanList(gold,{recentBooks:8,recentBooksForPattern:0});
  const seed=composeSeed({pattern,inventories,backgroundType:t.worldId,rngSeed:hashString(`eval-${t.id}`),ban,preferObstacleIds:preferObstaclesForTopic(t.topic),world});
  const check=plotCheck({outline:row.outline,topic:t.topic,protagonistName:'유하',seed,ban,inventories});
  const issues=[...(check.regenerate||[]),...(check.fix||[])];
  console.log(`${row.topicId} ok=${check.ok} regenerate=${(check.regenerate||[]).length} fix=${(check.fix||[]).length}`);
  for (const i of issues){ const key=(i.code||i.rule||i.type||JSON.stringify(i).slice(0,40)); if(process.env.SHOW_SEED) console.log("   seed.failureReasons:", JSON.stringify(seed.failureReasons), "| beats:", row.outline.beats.map(b=>b.type+":"+(b.failureReason||"-")).join(",")); tally[key]=(tally[key]||0)+1; console.log('   -', key, '·', (i.message||i.detail||'').toString().slice(0,400)); }
}
console.log('\nTALLY', JSON.stringify(tally,null,1));
