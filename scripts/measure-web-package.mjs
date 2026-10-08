#!/usr/bin/env node
// Development-only measurement. Always installs a real tarball in an isolated
// consumer, measures allocated dependency disk, and times server-ready output.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
const argv=process.argv.slice(2);
const option=(name,fallback)=>argv.includes(name)?argv[argv.indexOf(name)+1]:fallback;
const source=resolve(option('--package-root',process.cwd()));
const output=resolve(option('--output',mkdtempSync(join(tmpdir(),'coordinate-measure-'))));
mkdirSync(output,{recursive:true});
const home=join(output,'home'),consumer=join(output,'consumer'),project=join(output,'project');
for(const path of [home,consumer,project]) mkdirSync(path,{recursive:true});
const env={...process.env,HOME:home,USERPROFILE:home,COORDINATE_AGENTS_HOME:home,CODEX_HOME:join(home,'.codex'),GEMINI_HOME:join(home,'.gemini'),NODE_PATH:'',NODE_OPTIONS:''};
const npmEntry=process.env.npm_execpath;
const npmCommand=npmEntry&&existsSync(npmEntry)?process.execPath:(process.platform==='win32'?'npm.cmd':'npm');
const npmPrefix=npmEntry&&existsSync(npmEntry)?[npmEntry]:[];
function run(command,args,cwd=source) {
  const result=spawnSync(command,args,{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  if(result.status!==0) throw new Error(result.stderr||result.stdout||result.error?.message);return result.stdout;
}
const npm=(args,cwd=source)=>run(npmCommand,[...npmPrefix,...args],cwd);
const dry=JSON.parse(npm(['pack','--dry-run','--ignore-scripts','--json']))[0];
const packed=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',output]))[0];
writeFileSync(join(output,'pack-dry-run.json'),JSON.stringify(dry,null,2)+'\n');
writeFileSync(join(output,'pack.json'),JSON.stringify(packed,null,2)+'\n');
npm(['install','--omit=dev','--no-audit','--no-fund',join(output,packed.filename)],consumer);
const installed=join(consumer,'node_modules/@hogancv/coordinate-agents');
const startupMs=[];
for(let attempt=0;attempt<5;attempt++) {
  const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));
  const port=probe.address().port;await new Promise(done=>probe.close(done));
  const begin=process.hrtime.bigint();
  const child=spawn(process.execPath,[join(installed,'bin/coordinate-agents.mjs'),'web','--root',project,'--port',String(port),'--json'],{cwd:consumer,env,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>stderr+=data);
  try {
    await new Promise((done,reject)=>{
      let buffer='';const timer=setTimeout(()=>reject(new Error(`Startup timeout: ${stderr}`)),15000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Startup exited ${code}: ${stderr}`));});
      child.stdout.on('data',data=>{
        buffer+=data;if(!buffer.includes('\n')) return;
        clearTimeout(timer);try {const ready=JSON.parse(buffer.split('\n')[0]);if(!ready.ok)throw new Error(JSON.stringify(ready));startupMs.push(Number(process.hrtime.bigint()-begin)/1e6);done();}catch(error){reject(error);}
      });
    });
  } finally {
    if(child.exitCode===null&&child.signalCode===null) {const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  }
}
const directoryBytes={};
for(const file of packed.files) {const directory=file.path.includes('/')?file.path.split('/')[0]:'(root)';directoryBytes[directory]=(directoryBytes[directory]||0)+file.size;}
const allocated=spawnSync('du',['-sk',join(consumer,'node_modules')],{encoding:'utf8',windowsHide:true});
const manifest=JSON.parse(readFileSync(join(installed,'package.json'),'utf8'));
const metrics={version:packed.version,tarballBytes:packed.size,unpackedBytes:packed.unpackedSize,fileCount:packed.entryCount,directoryBytes,directProductionDependencies:Object.keys(manifest.dependencies||{}).length,installedProductionPackages:npm(['ls','--omit=dev','--all','--parseable'],consumer).trim().split(/\r?\n/).length-1,installDiskKiB:allocated.status===0?Number(allocated.stdout.trim().split(/\s+/)[0]):null,...(allocated.status===0?{}:{installDiskReason:'du -sk unavailable on this host'}),startupMs,startupMedianMs:[...startupMs].sort((a,b)=>a-b)[2],node:process.version,npm:npm(['--version']).trim(),platform:`${process.platform} ${process.arch}`,measurement:'5 launches from installed tarball, process spawn to JSON server-ready line; independent home; node_modules allocated disk via du -sk'};
writeFileSync(join(output,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
console.log(JSON.stringify({output,metrics},null,2));
