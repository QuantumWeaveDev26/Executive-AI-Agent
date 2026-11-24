import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),runtime=path.join(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies');
const pwsh=path.join(runtime,'native/powershell/pwsh.exe'),python=path.join(runtime,'python/python.exe');
const helper=path.join(root,'scripts/phone-inbound-recovery-rehearsal.review.ps1');
const q=(v:string)=>"'"+v.replaceAll("'","''")+"'";
function invoke(worker:string,input:string,timeout:number){
 const script=`$t=$null;$e=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile(${q(helper)},[ref]$t,[ref]$e);if($e.Count){throw 'parse_failed'}
 $fn=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-OwnedProcess'},$true)
 if($null -eq $fn){throw 'function_missing'};. ([scriptblock]::Create($fn.Extent.Text))
 $watch=[Diagnostics.Stopwatch]::StartNew();$status='completed';$result=$null
 try{$result=Invoke-OwnedProcess ${q(python)} @('-I','-B','-c',${q(worker)}) (${input}) @{} ${timeout}}catch{$status=if($_.Exception.Message -eq 'child_timeout'){'timed_out'}else{'failed'}}
 @{status=$status;elapsedMs=$watch.ElapsedMilliseconds;output=$(if($result){$result.Text}else{''});code=$(if($result){$result.Code}else{$null})}|ConvertTo-Json -Compress`;
 const r=spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:15000,windowsHide:true});
 expect(r.status).toBe(0);return JSON.parse(r.stdout);
}
it('bounds a synthetic child that never reads a pipe-sized input and confirms its termination',()=>{
 const parent=path.resolve(root,'node_modules/.cache'),dir=fs.mkdtempSync(path.join(parent,'phone-owned-process-')),pidFile=path.join(dir,'pid');
 try{
  const worker=`import os,pathlib,time;pathlib.Path(${JSON.stringify(pidFile)}).write_text(str(os.getpid()));time.sleep(5)`;
  const r=invoke(worker,'[string]::new([char]120,4*1024*1024)',800);
  expect(r.status).toBe('timed_out');expect(r.elapsedMs).toBeLessThan(3000);
  expect(fs.existsSync(pidFile)).toBe(true);const pid=Number(fs.readFileSync(pidFile,'utf8'));expect(Number.isSafeInteger(pid)&&pid>0).toBe(true);expect(()=>process.kill(pid,0)).toThrow();
 }finally{
  const actual=fs.realpathSync(dir);if(!actual.startsWith(fs.realpathSync(parent)+path.sep)||!path.basename(actual).startsWith('phone-owned-process-'))throw Error('unsafe_test_cleanup');fs.rmSync(actual,{recursive:true});
 }
},20000);
it('delivers synthetic stdin normally within the same deadline and drains output',()=>{
 const r=invoke('import sys;sys.stdout.write(str(len(sys.stdin.read())))',"'synthetic-input'",3000);expect(r.status).toBe('completed');expect(r.code).toBe(0);expect(r.output).toBe('15');
},20000);
