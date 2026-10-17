import {cp,mkdir,rm} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),runtime=root+'cloud-runtime';
const qualityBuild=spawnSync(process.execPath,[runtime+'/node_modules/typescript/bin/tsc','-p',root+'story-quality/tsconfig.json','--typeRoots',runtime+'/node_modules/@types'],{cwd:root,stdio:'inherit'});if(qualityBuild.status!==0)process.exit(qualityBuild.status??1);
await mkdir(root+'dist/story-quality',{recursive:true});await cp(root+'story-quality/dist',root+'dist/story-quality/dist',{recursive:true});await cp(root+'story-quality/data',root+'dist/story-quality/data',{recursive:true});await cp(root+'story-quality/gold',root+'dist/story-quality/gold',{recursive:true});
await mkdir(root+'dist/story-quality/examples',{recursive:true});await cp(root+'story-quality/distill/runs/2026-10-17/approved-books.json',root+'dist/story-quality/examples/approved-books.json');
await rm(runtime+'/public',{recursive:true,force:true});await cp(root+'dist',runtime+'/public',{recursive:true});await mkdir(runtime+'/.openai',{recursive:true});await cp(root+'.openai/hosting.json',runtime+'/.openai/hosting.json');
const result=spawnSync('npm',['run','build'],{cwd:runtime,stdio:'inherit',env:process.env});process.exit(result.status??1);
