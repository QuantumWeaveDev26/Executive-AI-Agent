"""Read-only absence-proof compatibility check; never creates/deletes any Docker resource."""
import datetime
import json
import re
import subprocess

def capture(args):return subprocess.run(args,capture_output=True,timeout=15)
def text(args):
    p=capture(args)
    if p.returncode:raise RuntimeError('readonly_failed')
    return p.stdout.decode().strip()

fields=text(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.State.Health.Status}}','thaara-v2-pilot-api-1']).split('|')
missing='f'*64
p=capture(['docker','inspect','--format','{{.Id}}',missing])
phrases=re.findall(r'no such (?:object|container|image)',(p.stderr+b'\n'+p.stdout).decode('utf8','replace'),re.I)
filtered=capture(['docker','ps','-a','--no-trunc','--filter','id='+missing,'--format','{{.ID}}'])
until=datetime.datetime.now(datetime.timezone.utc).isoformat()
events=text(['docker','events','--since','30m','--until',until,'--filter','type=container','--filter','label=thaara.phone-chat.current-validation=20261105','--format','{{.Action}}|{{.Actor.ID}}|{{index .Actor.Attributes "exitCode"}}'])
print(json.dumps({'status':'verified','containerId':fields[0],'imageId':fields[1],'sourceHealthy':fields[2]=='healthy',
    'nonexistentIdProbe':{'inspectExitCode':p.returncode,'sanitizedErrorPhrases':phrases,'stdoutLength':len(p.stdout),'stderrLength':len(p.stderr),
    'filteredListExitCode':filtered.returncode,'filteredListEmpty':not filtered.stdout.strip()},
    'ownedEventsRelativeWindow':[line.split('|') for line in events.splitlines() if line]}))
