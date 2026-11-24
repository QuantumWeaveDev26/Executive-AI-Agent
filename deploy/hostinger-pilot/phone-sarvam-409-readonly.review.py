"""Review-only root receipt reader. No network, credential, write, cleanup or execution API."""
import json
import os
import re
import stat
import sys

class Rejected(Exception):pass
def need(ok):
 if not ok:raise Rejected()

PHASES=['claimed','suite_created','mapping_created','before_run','run_id_received_unverified','run_created']
KEYS=[{'phase','providerAcceptanceVerified'},{'phase','suiteId'},{'phase','suiteId','caseId','mapId'},
 {'phase','suiteId','caseId','appVersion','frequency'},{'phase','suiteId','caseId','runId'},{'phase','suiteId','caseId','runId'}]
CANDIDATES=[['create_suite'],['read_suite','create_mapping'],['read_mapping'],['submit_run'],
 ['inconsistent_with_http_409_sequence'],['poll_run','read_results']]

def summarize(records):
 need(isinstance(records,list) and 1<=len(records)<=6)
 ids={}
 for i,row in enumerate(records):
  need(isinstance(row,dict) and set(row)==KEYS[i] and row['phase']==PHASES[i])
  if i==0:need(row['providerAcceptanceVerified'] is False)
  if i==3:need(type(row['appVersion']) is int and row['appVersion']==6 and type(row['frequency']) is int and row['frequency']==1)
  for key in ('suiteId','caseId','mapId','runId'):
   if key in row:
    value=row[key];need(isinstance(value,str) and re.fullmatch(r'[0-9A-HJKMNP-TV-Z]{26}',value))
    if key in ids:need(ids[key]==value)
    ids[key]=value
 return {'status':'readonly_complete','receiptCount':len(records),'lastPhase':PHASES[len(records)-1],
  'hasSuiteId':'suiteId' in ids,'hasMappingId':'mapId' in ids,'hasRunId':'runId' in ids,
  'runSubmissionFencePresent':len(records)>=4,'candidateOperations':CANDIDATES[len(records)-1],
  'providerQueried':False,'billingReconciled':False}

def stamp(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)

def inspect():
 flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME
 fd=os.open('/',flags)
 try:
  for leaf in ('opt','thaara-v2-pilot-private','phone-eval-stage-b-20261103-v6-once'):
   parent=os.fstat(fd);need(stat.S_ISDIR(parent.st_mode) and parent.st_uid==0 and not parent.st_mode & 0o022)
   new=os.open(leaf,flags,dir_fd=fd);os.close(fd);fd=new
  before=os.fstat(fd);need(before.st_uid==0 and stat.S_IMODE(before.st_mode)==0o700)
  names=sorted(os.listdir(fd));need(1<=len(names)<=6 and names==[f'{n:02d}.json' for n in range(1,len(names)+1)])
  records=[]
  for name in names:
   child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME,dir_fd=fd)
   try:
    initial=os.fstat(child)
    need(stat.S_ISREG(initial.st_mode) and initial.st_uid==0 and stat.S_IMODE(initial.st_mode)==0o600 and initial.st_nlink==1 and 1<=initial.st_size<=8192)
    raw=os.read(child,8193);need(len(raw)==initial.st_size)
    records.append(json.loads(raw))
    need(stamp(initial)==stamp(os.fstat(child)))
   finally:os.close(child)
  need(names==sorted(os.listdir(fd)) and stamp(before)==stamp(os.fstat(fd)))
  result=summarize(records);result['snapshotStable']=True
  return result
 finally:os.close(fd)

def main(args):
 if not args:return {'status':'review_only','providerQueried':False,'remoteWrites':0}
 if args!=['--approved-readonly-409']:return {'status':'stopped','category':'arguments_rejected'}
 try:
  need(os.getuid()==0)
  return inspect()
 except Exception:return {'status':'stopped','category':'receipt_snapshot_rejected','providerQueried':False,'remoteWrites':0}

if __name__=='__main__':
 result=main(sys.argv[1:]);print(json.dumps(result,sort_keys=True));sys.exit(0 if result['status'] in ('review_only','readonly_complete') else 1)
