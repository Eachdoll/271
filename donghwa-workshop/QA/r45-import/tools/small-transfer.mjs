import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4960/',output='/workspace/artifacts/r45/transfer-local.json']=process.argv.slice(2);
const report={base,synthetic:true,pageErrors:[],paidRequests:[]};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}}:{})});
try{
 const ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage();p.on('pageerror',e=>report.pageErrors.push(e.message));
 await p.route('**/api/cloud/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'}));
 await p.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,r=>{report.paidRequests.push(r.request().url());return r.abort();});
 await p.goto(base,{waitUntil:'networkidle'});
 report.transfer=await p.evaluate(async()=>{const{seedState}=await import('./engine.js'),{createLibraryBackup,createZip}=await import('./output.js'),{readLibraryBackupFile,backupSummary}=await import('./device-transfer.js');const s=seedState(),b=await createLibraryBackup(s),j=await readLibraryBackupFile(new File([b.text],'small-library.json',{type:'application/json'})),z=await readLibraryBackupFile(new File([createZip([{name:'library.json',data:b.text}])],'small-library.zip',{type:'application/zip'}));return{jsonBytes:new TextEncoder().encode(b.text).length,json:backupSummary(j),zip:backupSummary(z),sameFirstTitle:j.books[0].title===s.books[0].title&&z.books[0].title===s.books[0].title};});
 report.passed=report.transfer.sameFirstTitle&&JSON.stringify(report.transfer.json)===JSON.stringify(report.transfer.zip)&&!report.pageErrors.length&&!report.paidRequests.length;
 if(!report.passed)throw Error('Small transfer mismatch');
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
