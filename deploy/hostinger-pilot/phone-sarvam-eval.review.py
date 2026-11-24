"""REVIEW ONLY until separately approved. One synthetic eval; no telephony/DB/service commands.
The wrapper supplies the checksum-pinned public PLAN in memory. Never print raw exceptions/responses/key/transcripts.
"""
import hashlib
import json
import os
import re
import ssl
import stat
import sys
import time
import urllib.error
import urllib.request

APP='Thaara-AI-V-db336de4-5453'
BASE='https://apps.sarvam.ai/api/evals/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/test-suites'
PRIVATE='/opt/thaara-v2-pilot-private'
GUARD='phone-eval-stage-b-20261103-v6-once'
KEY=PRIVATE+'/secrets/sarvam_api_key'
ID=r'[0-9A-HJKMNP-TV-Z]{26}'
PLAN_HASH='184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435'

class Stop(Exception): pass
def check(value,category='response_mismatch'):
    if not value: raise Stop(category)
def canonical(value): return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def identifier(value):
    check(isinstance(value,str) and re.fullmatch(ID,value),'identifier_rejected')
    return value
def integer(value,expected):return type(value) is int and value==expected
def validate_plan(plan):
    check(isinstance(plan,dict) and hashlib.sha256(canonical(plan)).hexdigest()==PLAN_HASH,'plan_checksum_mismatch')

def validate_key_metadata(mode,uid,links):
    check(stat.S_ISREG(mode) and stat.S_IMODE(mode) in (0o400,0o600) and uid in (0,1000) and links==1,'key_permissions_rejected')

def validate_parent_metadata(mode,uid,require_root):
    check(stat.S_ISDIR(mode) and not mode & 0o022 and uid in ((0,) if require_root else (0,1000)),'private_path_rejected')

def open_private_parent(require_root=False):
    """Walk fixed ancestors through pinned directory descriptors; no symlink traversal."""
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        root=os.fstat(fd);validate_parent_metadata(root.st_mode,root.st_uid,require_root)
        for leaf in ('opt','thaara-v2-pilot-private'):
            new=os.open(leaf,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=new;s=os.fstat(fd)
            validate_parent_metadata(s.st_mode,s.st_uid,require_root)
        return fd
    except BaseException:
        os.close(fd);raise

def read_key():
    parent=open_private_parent(); directory=None; fd=None
    try:
        directory=os.open('secrets',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
        s=os.fstat(directory)
        check(s.st_uid in (0,1000) and not s.st_mode & 0o077,'key_directory_rejected')
        fd=os.open('sarvam_api_key',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)
        s=os.fstat(fd);validate_key_metadata(s.st_mode,s.st_uid,s.st_nlink)
        check(8<=s.st_size<=4096,'key_format_rejected')
        raw=os.read(fd,4097)
        check(len(raw)==s.st_size and re.fullmatch(rb'[\x21-\x7e]{8,4096}',raw),'key_format_rejected')
        return raw.decode('ascii')
    finally:
        if fd is not None:os.close(fd)
        if directory is not None:os.close(directory)
        os.close(parent)

class DiskGuard:
    def __init__(self):self.fd=None;self.sequence=0
    def claim(self):
        parent=open_private_parent(require_root=True)
        try:
            try:os.mkdir(GUARD,0o700,dir_fd=parent)
            except FileExistsError:raise Stop('already_claimed') from None
            self.fd=os.open(GUARD,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            s=os.fstat(self.fd)
            check(s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o700,'guard_permissions_rejected')
            os.fsync(parent)
            self.record({'phase':'claimed','providerAcceptanceVerified':False})
        finally:os.close(parent)
    def record(self,data):
        check(self.fd is not None,'guard_unavailable')
        self.sequence+=1
        fd=os.open(f'{self.sequence:02d}.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=self.fd)
        try:
            s=os.fstat(fd);check(s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1,'guard_permissions_rejected')
            with os.fdopen(fd,'wb',closefd=False) as output:output.write(canonical(data)+b'\n');output.flush();os.fsync(fd)
            os.fsync(self.fd)
        finally:os.close(fd)
    def close(self):
        if self.fd is not None:os.close(self.fd);self.fd=None

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise Stop('redirect_rejected')

class Transport:
    def __init__(self,key,plan):
        validate_plan(plan);self.key=key;self.plan=plan;self.deadline=time.monotonic()+180;self.count=0
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    def __call__(self,method,suffix,body=None):
        checks=[('POST',r'',self.plan['suiteRequest']['body'],201),('POST',r'/'+ID+r'/mappings',self.plan['mappingBody'],201),
            ('POST',r'/'+ID+r'/test-cases/'+ID+r'/runs',self.plan['runBody'],202),
            ('GET',r'/'+ID,None,200),('GET',r'/'+ID+r'/mappings\?app_id='+re.escape(APP),None,200),
            ('GET',r'/'+ID+r'/runs/'+ID,None,200),('GET',r'/'+ID+r'/runs/'+ID+r'/test-cases/'+ID,None,200)]
        matched=[s for m,p,b,s in checks if method==m and isinstance(suffix,str) and re.fullmatch(p,suffix) and body==b]
        check(len(matched)==1,'endpoint_or_body_rejected')
        self.count+=1;remaining=self.deadline-time.monotonic()
        check(self.count<=18 and remaining>0,'request_budget_exhausted')
        if self.key is None:self.key=read_key()
        request=urllib.request.Request(BASE+suffix,data=canonical(body) if body is not None else None,
            headers={'X-API-Key':self.key,'Content-Type':'application/json','Accept':'application/json'},method=method)
        try:
            with self.opener.open(request,timeout=min(10,remaining)) as response:
                check(response.status==matched[0],'http_status_rejected')
                check(response.headers.get_content_type()=='application/json','response_format_rejected')
                raw=response.read(262145);check(len(raw)<=262144,'response_limit')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            code=error.code;error.close()
            raise Stop({401:'http_401',402:'http_402',403:'http_403',409:'http_409',422:'http_422',429:'http_429'}.get(code,'http_failure')) from None
        except (TimeoutError,urllib.error.URLError):raise Stop('network_timeout_or_tls_failure') from None
        except (ValueError,UnicodeError):raise Stop('response_format_rejected') from None

def evaluate(plan,request,guard,sleep=time.sleep):
    validate_plan(plan);guard.claim()
    created=request('POST','',plan['suiteRequest']['body']);sid=identifier(created.get('test_suite_id'))
    guard.record({'phase':'suite_created','suiteId':sid})
    suite=request('GET','/'+sid);expected=plan['suiteRequest']['body']
    check(suite.get('test_suite_id')==sid and integer(suite.get('test_case_count'),1),'suite_mismatch')
    for key in ('name','description','app_id','variables','global_guardrails'):check(suite.get(key)==expected[key],'suite_mismatch')
    cases=suite.get('test_cases');check(isinstance(cases,list) and len(cases)==1,'case_mismatch')
    case=cases[0];cid=identifier(case.get('test_case_id'))
    check({k:v for k,v in case.items() if k!='test_case_id'}==expected['test_cases'][0],'case_mismatch')
    mapped=request('POST','/'+sid+'/mappings',plan['mappingBody']);mid=identifier(mapped.get('map_id'))
    guard.record({'phase':'mapping_created','suiteId':sid,'caseId':cid,'mapId':mid})
    mapping=request('GET','/'+sid+'/mappings?app_id='+APP)
    check(mapping.get('map_id')==mid and mapping.get('test_suite_id')==sid,'mapping_mismatch')
    for key,value in plan['mappingBody'].items():check(mapping.get(key)==value and (key!='app_version' or type(mapping[key]) is int),'mapping_mismatch')
    guard.record({'phase':'before_run','suiteId':sid,'caseId':cid,'appVersion':6,'frequency':1})
    queued=request('POST','/'+sid+'/test-cases/'+cid+'/runs',plan['runBody']);rid=identifier(queued.get('run_id'))
    guard.record({'phase':'run_id_received_unverified','suiteId':sid,'caseId':cid,'runId':rid})
    check(queued.get('test_suite_id')==sid and queued.get('scope')=='test_case' and queued.get('status') in ('created','running','completed'),'run_mismatch')
    guard.record({'phase':'run_created','suiteId':sid,'caseId':cid,'runId':rid})
    for attempt in range(12):
        progress=request('GET','/'+sid+'/runs/'+rid)
        check(progress.get('run_id')==rid and progress.get('test_suite_id')==sid and progress.get('app_id')==APP
            and integer(progress.get('app_version'),6) and progress.get('scope')=='test_case'
            and integer(progress.get('frequency'),1) and integer(progress.get('total_executions'),1),'run_mismatch')
        check(progress.get('status') in ('created','running','completed','failed'),'run_mismatch')
        if progress['status']=='failed':raise Stop('provider_run_failed')
        if progress['status']=='completed':break
        if attempt<11:sleep(5)
    else:raise Stop('poll_limit_outcome_unverified')
    check(integer(progress.get('completed_executions'),1),'run_mismatch')
    results=request('GET','/'+sid+'/runs/'+rid+'/test-cases/'+cid)
    check(results.get('run_id')==rid and results.get('test_case_id')==cid,'result_mismatch')
    executions=results.get('executions');check(isinstance(executions,list) and len(executions)==1,'result_mismatch')
    execution=executions[0]
    check(execution.get('run_id')==rid and execution.get('test_suite_id')==sid and execution.get('test_case_id')==cid
        and integer(execution.get('frequency_index'),0),'result_mismatch')
    grades=execution.get('evaluation_results');check(isinstance(grades,list) and 5<=len(grades)<=6,'grade_mismatch')
    required={x['name'] for x in expected['test_cases'][0]['expected_behaviors']}
    names=[x.get('name') for x in grades];check(set(names) in (required,required|{'Guardrails'}) and len(set(names))==len(names),'grade_mismatch')
    check(all(x.get('verdict') in ('Pass','Fail') for x in grades),'grade_mismatch')
    transcript=execution.get('transcript');check(isinstance(transcript,list) and 1<=len(transcript)<=200,'transcript_unavailable')
    output={'status':'completed_requires_manual_review','suiteId':sid,'caseId':cid,'runId':rid,'appVersion':6,
        'providerJudgePassed':all(x['verdict']=='Pass' for x in grades),'passedChecks':sum(x['verdict']=='Pass' for x in grades),
        'totalChecks':len(grades),'transcriptSha256':hashlib.sha256(canonical(transcript)).hexdigest(),
        'providerAcceptanceVerified':False,'telephoneCalls':0}
    guard.record(output)
    if not output['providerJudgePassed']:raise Stop('provider_grade_failed')
    return output

def main(args,plan):
    if not args:return {'status':'review_only','providerRequests':0,'telephoneCalls':0}
    if args!=['--approved-synthetic-eval-v6-once']:return {'status':'stopped','category':'arguments_rejected','telephoneCalls':0}
    guard=DiskGuard();transport=None
    try:
        check(os.getuid()==0,'root_required');validate_plan(plan)
        transport=Transport(None,plan)
        return evaluate(plan,transport,guard)
    except Stop as error:
        return {'status':'stopped','category':str(error),'providerAcceptanceVerified':False,'telephoneCalls':0}
    except Exception:
        return {'status':'stopped','category':'unclassified_failure','providerAcceptanceVerified':False,'telephoneCalls':0}
    finally:
        if transport is not None:transport.key=None
        guard.close()

if __name__=='__main__':
    result=main(sys.argv[1:],globals().get('PLAN'))
    print(json.dumps(result,sort_keys=True))
    sys.exit(0 if result['status'] in ('review_only','completed_requires_manual_review') else 1)
