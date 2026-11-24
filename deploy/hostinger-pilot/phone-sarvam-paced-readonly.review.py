"""Review-only root receipt reader for phone-eval-stage-b-20261103-v6-paced-once.
No network, credential, write, cleanup or execution API.
Handles both absent guard directory (if SSH timed out before python3 started) and 1..10 stage receipts.
"""
import json
import os
import re
import stat
import sys

class Rejected(Exception):pass
def need(ok):
 if not ok:raise Rejected()

ID_RE=re.compile(r'^[0-9A-HJKMNP-TV-Z]{26}$')
SHA_RE=re.compile(r'^[a-f0-9]{64}$')
ALLOWED_PHASES={
 'claimed',
 'preconditions_verified',
 'variables_patched_empty_defaults',
 'variables_verified_existing_cases_intact',
 'variables_already_present_verified',
 'mapping_created',
 'mapping_already_present_verified',
 'case_added',
 'case_already_present_verified',
 'before_run',
 'run_id_received_unverified',
 'run_created',
 'completed_requires_manual_review',
}

def summarize(records):
 need(isinstance(records,list) and 1<=len(records)<=10)
 ids={}
 phases=[]
 completed=None
 for i,row in enumerate(records):
  need(isinstance(row,dict))
  phase=row.get('phase') or row.get('status')
  need(isinstance(phase,str) and phase in ALLOWED_PHASES)
  if i==0:need(phase=='claimed' and row.get('providerAcceptanceVerified') is False)
  phases.append(phase)
  for key in ('suiteId','caseId','mapId','runId'):
   if key in row:
    value=row[key];need(isinstance(value,str) and bool(ID_RE.fullmatch(value)))
    if key in ids:need(ids[key]==value)
    ids[key]=value
  if phase=='completed_requires_manual_review':
   need(isinstance(row.get('transcriptSha256'),str) and bool(SHA_RE.fullmatch(row['transcriptSha256'])))
   completed=row
 out={
  'status':'readonly_complete',
  'guardDirectoryPresent':True,
  'receiptCount':len(records),
  'lastPhase':phases[-1],
  'phases':phases,
  'hasSuiteId':'suiteId' in ids,
  'variablesPatched':'variables_patched_empty_defaults' in phases,
  'variablesVerified':'variables_verified_existing_cases_intact' in phases or 'variables_already_present_verified' in phases,
  'variablesAlreadyPresent':'variables_already_present_verified' in phases,
  'hasMappingId':'mapId' in ids,
  'mappingCreated':'mapping_created' in phases,
  'mappingAlreadyPresent':'mapping_already_present_verified' in phases,
  'hasCaseId':'caseId' in ids,
  'caseAdded':'case_added' in phases,
  'caseAlreadyPresent':'case_already_present_verified' in phases,
  'runSubmissionFencePresent':'before_run' in phases,
  'hasRunId':'runId' in ids,
  'completedRunRecorded':completed is not None,
  'providerJudgePassed':bool(completed.get('providerJudgePassed')) if completed else False,
  'passedChecks':int(completed.get('passedChecks',0)) if completed else 0,
  'totalChecks':int(completed.get('totalChecks',0)) if completed else 0,
  'transcriptSha256':completed.get('transcriptSha256') if completed else None,
  'evaluationChecks':completed.get('evaluationChecks') if completed else None,
  'transcriptTurns':completed.get('transcriptTurns') if completed else None,
  'providerQueried':False,
  'billingReconciled':False,
 }
 return out

def stamp(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)

def inspect():
 flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME
 fd=os.open('/',flags)
 try:
  for leaf in ('opt','thaara-v2-pilot-private'):
   parent=os.fstat(fd);need(stat.S_ISDIR(parent.st_mode) and parent.st_uid==0 and not parent.st_mode & 0o022)
   new=os.open(leaf,flags,dir_fd=fd);os.close(fd);fd=new
  parent=os.fstat(fd);need(stat.S_ISDIR(parent.st_mode) and parent.st_uid==0 and not parent.st_mode & 0o022)
  try:
   new=os.open('phone-eval-stage-b-20261103-v6-paced-once',flags,dir_fd=fd)
  except FileNotFoundError:
   return {
    'status':'readonly_complete',
    'guardDirectoryPresent':False,
    'receiptCount':0,
    'lastPhase':'not_started_guard_absent',
    'phases':[],
    'hasSuiteId':False,
    'variablesPatched':False,
    'variablesVerified':False,
    'variablesAlreadyPresent':False,
    'hasMappingId':False,
    'mappingCreated':False,
    'mappingAlreadyPresent':False,
    'hasCaseId':False,
    'caseAdded':False,
    'caseAlreadyPresent':False,
    'runSubmissionFencePresent':False,
    'hasRunId':False,
    'completedRunRecorded':False,
    'providerJudgePassed':False,
    'passedChecks':0,
    'totalChecks':0,
    'transcriptSha256':None,
    'evaluationChecks':None,
    'transcriptTurns':None,
    'providerQueried':False,
    'billingReconciled':False,
    'snapshotStable':True,
   }
  os.close(fd);fd=new
  before=os.fstat(fd);need(before.st_uid==0 and stat.S_IMODE(before.st_mode)==0o700)
  names=sorted(os.listdir(fd));need(1<=len(names)<=10 and names==[f'{n:02d}.json' for n in range(1,len(names)+1)])
  records=[]
  for name in names:
   child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME,dir_fd=fd)
   try:
    initial=os.fstat(child)
    need(stat.S_ISREG(initial.st_mode) and initial.st_uid==0 and stat.S_IMODE(initial.st_mode)==0o600 and initial.st_nlink==1 and 1<=initial.st_size<=65536)
    raw=os.read(child,65537);need(len(raw)==initial.st_size)
    records.append(json.loads(raw))
    need(stamp(initial)==stamp(os.fstat(child)))
   finally:os.close(child)
  need(names==sorted(os.listdir(fd)) and stamp(before)==stamp(os.fstat(fd)))
  result=summarize(records);result['snapshotStable']=True
  return result
 finally:os.close(fd)

def main(args):
 if not args:return {'status':'review_only','providerQueried':False,'remoteWrites':0}
 if args!=['--approved-readonly-paced']:return {'status':'stopped','category':'arguments_rejected'}
 try:
  need(os.getuid()==0)
  return inspect()
 except Exception:return {'status':'stopped','category':'receipt_snapshot_rejected','providerQueried':False,'remoteWrites':0}

if __name__=='__main__':
 result=main(sys.argv[1:]);print(json.dumps(result,sort_keys=True));sys.exit(0 if result['status'] in ('review_only','readonly_complete') else 1)
