import {cp,mkdir,rm} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),runtime=root+'cloud-runtime';
await rm(runtime+'/public',{recursive:true,force:true});await cp(root+'dist',runtime+'/public',{recursive:true});await mkdir(runtime+'/.openai',{recursive:true});await cp(root+'.openai/hosting.json',runtime+'/.openai/hosting.json');
const result=spawnSync('npm',['run','build'],{cwd:runtime,stdio:'inherit',env:process.env});process.exit(result.status??1);
