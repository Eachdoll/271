/** Recheck retained results without model calls; never modify the original JSONL/summaries. */
import {readFileSync} from 'node:fs';
import {plotCheck} from '../../dist/plotCheck.js';
import {findWorld} from '../../dist/worlds.js';
import {buildBanList} from '../../dist/banList.js';
import {composeSeed,preferObstaclesForTopic} from '../../dist/composeSeed.js';
import {hashString} from '../../dist/util.js';
// An accidental network path must fail rather than spend money.
globalThis.fetch=()=>{throw new Error('Offline verification prohibits network requests.');};
const root=new URL('../../',import.meta.url),read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const topics=read('eval/testset.json').topics,patterns=read('data/plot_patterns.json'),worlds=read('data/worlds.json'),inventories=read('data/inventories.json');
const gold=[...read('gold/gold_outlines_part1.json'),...read('gold/gold_outlines_part2.json')];
const mean=values=>values.reduce((sum,x)=>sum+x,0)/Math.max(1,values.length);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const eraCounts={};for(const topic of topics){const era=findWorld(worlds,topic.worldId).era;eraCounts[era]=(eraCounts[era]||0)+1;}
const runs=[];
for(const id of ['sonnet55-trial','opus55-trial']){
 const rows=readFileSync(new URL(`${id}.jsonl`,import.meta.url),'utf8').trim().split('\n').map(JSON.parse),original=read(`eval/trial-2026-10-17/${id}.summary.json`);
 const checks=rows.map(row=>{
  const topic=topics.find(item=>item.id===row.topicId);if(!topic||!row.outline)throw new Error('Missing retained topic/outline');
  const pattern=patterns.find(item=>item.id===topic.patternId)||patterns[0],ban=buildBanList(gold,{recentBooks:8,recentBooksForPattern:0}),world=findWorld(worlds,topic.worldId);
  const seed=composeSeed({pattern,inventories,backgroundType:topic.worldId,rngSeed:hashString(`eval-${topic.id}`),ban,preferObstacleIds:preferObstaclesForTopic(topic.topic),world});
  const check=plotCheck({outline:row.outline,topic:topic.topic,protagonistName:'유하',seed,ban,inventories});
  return {topicId:row.topicId,originalPlotOk:row.plotOk,recheckedPlotOk:check.ok,fix:check.fix,regenerate:check.regenerate};
 });
 runs.push({runId:id,generatorId:original.generatorId,judgeId:original.judgeId,rows:rows.length,errors:rows.filter(row=>row.error).length,scope:'outline only; prose/pagination/reading-level/child-review unmeasured',rubricMean:mean(rows.map(row=>row.rubricTotal)),rubricPassCount:rows.filter(row=>row.rubricPass).length,originalPlotPassCount:rows.filter(row=>row.plotOk).length,recheckedPlotPassCount:checks.filter(row=>row.recheckedPlotOk).length,costUsd:rows.reduce((sum,row)=>sum+row.costUsd,0),costPerBookUsd:mean(rows.map(row=>row.costUsd)),latencySecondsMean:mean(rows.map(row=>row.latencyMs))/1000,latencySecondsMedian:median(rows.map(row=>row.latencyMs))/1000,checks});
}
console.log(JSON.stringify({mode:'offline only; zero API calls',importedSourceCommit:'836a905900bf64670501bd479bee42b3470f5796',topicCount:topics.length,eraCounts,note:'Original summaries are retained. The Sonnet summary predates failure-reason normalization; rechecked values are separate. Time statistics use arithmetic mean and the average of the two middle observations.',runs},null,2));
