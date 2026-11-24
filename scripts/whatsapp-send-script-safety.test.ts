import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const posix=(p:string)=>p.replace(/\\/g,'/').replace(/^([A-Za-z]):/,(_,d)=>'/'+d.toLowerCase());

// Execute the actual shell scripts against disposable files and an exported fake docker function.
// No Docker client, server, real credentials or external database is used.
function runFixture(mode:'enable'|'disable',failure:'enable-compose'|'disable-compose'|'relay-revoke'|'missing-backups'|'none'){
  const dir=mkdtempSync(path.join(tmpdir(),'thaara-send-safety-'));
  try{
    const p=path.join(dir,'pilot'),s=path.join(dir,'private/secrets');
    mkdirSync(p,{recursive:true});mkdirSync(s,{recursive:true});
    for(const [name,value] of Object.entries({'compose.json':'false','.env':'off','compose.send.json':'true','compose.json.before-10816':'false','.env.before-10816':'off'}))writeFileSync(path.join(p,name),value);
    if(failure==='missing-backups'){rmSync(path.join(p,'compose.json.before-10816'));rmSync(path.join(p,'.env.before-10816'));}
    writeFileSync(path.join(dir,'send-state'),mode==='enable'?'false':'true');
    writeFileSync(path.join(dir,'relay-state'),mode==='enable'?'events':'wide');
    if(mode==='disable'){
      writeFileSync(path.join(s,'n8n_dispatch_secret'),'synthetic-only');writeFileSync(path.join(s,'send_profile'),'synthetic-only');
      mkdirSync(path.join(dir,'private/handoff'));writeFileSync(path.join(dir,'private/handoff/n8n_dispatch_secret'),'synthetic-only');
    }
    for(const kind of ['enable','disable']){
      const source=readFileSync(path.join(root,`deploy/hostinger-pilot/pilot-send-${kind}-10816.sh`),'utf8')
        .replaceAll('/opt/thaara-v2-pilot-private',posix(path.join(dir,'private')))
        .replaceAll('/opt/thaara-v2-pilot',posix(p));
      writeFileSync(path.join(p,`pilot-send-${kind}-10816.sh`),source);
    }
    const harness=String.raw`
set -eu
export ROOT="$1" FAILURE="$2"
docker() {
 case "$1" in
  image) return 0;;
  inspect)
   case "$3" in
    *Config.Env*) printf 'THAARA_WHATSAPP_SEND_ENABLED=%s\n' "$(cat "$ROOT/send-state")";;
    *RestartCount*) echo stable-container-0;;
    *State.Status*) echo running/healthy;;
    *State.Health.Status*) echo healthy;;
    *Image*) echo sha256:synthetic;;
    *) return 98;;
   esac;;
  exec)
   case "$*" in
    *"ARRAY['events','claim','receipts']"*) echo wide > "$ROOT/relay-state";;
    *"ARRAY['events']"*) [ "$FAILURE" != relay-revoke ] || return 1; echo events > "$ROOT/relay-state";;
    *) return 98;;
   esac;;
  compose)
   local next; next=$(cat "$ROOT/pilot/compose.json")
   if { [ "$next" = true ] && [ "$FAILURE" = enable-compose ]; } || { [ "$next" = false ] && [ "$FAILURE" = disable-compose ]; }; then return 1; fi
   printf '%s' "$next" > "$ROOT/send-state";;
  *) return 98;;
 esac
}
chown() { :; }
chmod() { :; }
install() { local f; for f in "$@"; do :; done; mkdir -p "$f"; }
shred() { local f; for f in "$@"; do :; done; case "$f" in "$ROOT"/*) rm -f -- "$f";; *) return 99;; esac; }
sleep() { :; }
export -f docker chown chmod install shred sleep
bash "$ROOT/pilot/pilot-send-$3-10816.sh"
`;
    const result=spawnSync(bash,['-c',harness,'test',posix(dir),failure,mode],{encoding:'utf8',timeout:15000});
    if(result.error)throw result.error;
    return {status:result.status,output:result.stdout+result.stderr,
      send:readFileSync(path.join(dir,'send-state'),'utf8').trim(),relay:readFileSync(path.join(dir,'relay-state'),'utf8').trim(),
      secretExists:existsSync(path.join(s,'n8n_dispatch_secret')),profileExists:existsSync(path.join(s,'send_profile')),
      handoffExists:existsSync(path.join(dir,'private/handoff/n8n_dispatch_secret'))};
  }finally{
    if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'thaara-send-safety-'))throw Error('Unsafe fixture cleanup');
    rmSync(dir,{recursive:true,force:true});
  }
}

describe('controlled send shell failure safety, synthetic Docker only',()=>{
  it('cleans widened permissions and every temporary secret if enable fails after widening',()=>{
    const r=runFixture('enable','enable-compose');
    expect(r.status).not.toBe(0);expect(r.relay).toBe('events');expect(r.send).toBe('false');
    expect(r.secretExists||r.profileExists||r.handoffExists).toBe(false);
  });
  it('returns failure when shutdown cannot restore the send-off API, while still revoking and cleaning',()=>{
    const r=runFixture('disable','disable-compose');
    expect(r.status).not.toBe(0);expect(r.send).toBe('true');expect(r.relay).toBe('events');
    expect(r.secretExists||r.profileExists||r.handoffExists).toBe(false);
  });
  it('proves a normal shutdown leaves send-off, events-only and no send files',()=>{
    const r=runFixture('disable','none');
    expect(r.status,r.output).toBe(0);expect(r.send).toBe('false');expect(r.relay).toBe('events');
    expect(r.secretExists||r.profileExists||r.handoffExists).toBe(false);
  });
  it('fails truthfully on a relay revoke error while still turning the API off and removing secrets',()=>{
    const r=runFixture('disable','relay-revoke');
    expect(r.status).not.toBe(0);expect(r.send).toBe('false');expect(r.relay).toBe('wide');
    expect(r.secretExists||r.profileExists||r.handoffExists).toBe(false);
    expect(r.output).toContain('SHUTDOWN_INCOMPLETE');
  });
  it('fails truthfully when restore files are missing, but still revokes and removes secrets',()=>{
    const r=runFixture('disable','missing-backups');
    expect(r.status).not.toBe(0);expect(r.send).toBe('true');expect(r.relay).toBe('events');
    expect(r.secretExists||r.profileExists||r.handoffExists).toBe(false);
  });
});
