"""REVIEW ONLY until separately approved. Non-destructive additive Stage B v6 eval on existing app-bound suite.
Preserves all 6 existing test cases and existing guard; adds empty-default suite variables, v6 mapping, 1 case with overrides, and runs ONLY that 1 case.
"""
import copy
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
LIST_SUFFIX='?app_id='+APP+'&limit=2&offset=0'
PRIVATE='/opt/thaara-v2-pilot-private'
GUARD='phone-eval-stage-b-20261103-v6-additive-once'
ID=r'[0-9A-HJKMNP-TV-Z]{26}'
PLAN_HASH='184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435'

class Stop(Exception): pass
def check(value,category='response_mismatch'):
    if not value: raise Stop(category)
def canonical(value): return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def identifier(value):
    check(isinstance(value,str) and re.fullmatch(ID,value),'identifier_rejected')
    return value
def integer(value,expected): return type(value) is int and value==expected
def validate_plan(plan):
    check(isinstance(plan,dict) and hashlib.sha256(canonical(plan)).hexdigest()==PLAN_HASH,'plan_checksum_mismatch')

def empty_default_variables(plan):
    raw=plan['suiteRequest']['body']['variables']
    check(isinstance(raw,list) and len(raw)==2,'plan_checksum_mismatch')
    return [{'name':item['name'],'value':''} for item in raw]

def additive_case_body(plan):
    case=copy.deepcopy(plan['suiteRequest']['body']['test_cases'][0])
    case['variable_overrides']=copy.deepcopy(plan['suiteRequest']['body']['variables'])
    return case

def case_matches_expected(actual,expected):
    if not isinstance(actual,dict): return False
    for key in ('name','category','user_scenario','max_turns','variable_overrides'):
        if actual.get(key)!=expected.get(key): return False
    behaviors=actual.get('expected_behaviors')
    if not isinstance(behaviors,list) or not all(isinstance(b,dict) for b in behaviors): return False
    stripped=[{'name':b.get('name'),'description':b.get('description')} for b in behaviors]
    return stripped==expected['expected_behaviors']

def suite_metadata_unchanged(actual,before):
    for key in ('test_suite_id','app_id','name','description','global_guardrails'):
        if actual.get(key)!=before.get(key): return False
    return True

def validate_key_metadata(mode,uid,links):
    check(stat.S_ISREG(mode) and stat.S_IMODE(mode) in (0o400,0o600) and uid in (0,1000) and links==1,'key_permissions_rejected')

def validate_parent_metadata(mode,uid,require_root):
    check(stat.S_ISDIR(mode) and not mode & 0o022 and uid in ((0,) if require_root else (0,1000)),'private_path_rejected')

def open_private_parent(require_root=False):
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
    def __init__(self): self.fd=None;self.sequence=0
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
        self.writes_attempted=set()
        self.empty_vars={'variables':empty_default_variables(plan)}
        self.case_body=additive_case_body(plan)
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    def __call__(self,method,suffix,body=None,expect_status=None):
        checks=[
            ('GET','list',re.escape(LIST_SUFFIX),None,200),
            ('GET','detail',r'/'+ID,None,200),
            ('GET','mapping_get',r'/'+ID+r'/mappings\?app_id='+re.escape(APP),None,200),
            ('PATCH','suite_patch',r'/'+ID,self.empty_vars,200),
            ('POST','mapping_post',r'/'+ID+r'/mappings',self.plan['mappingBody'],201),
            ('POST','case_post',r'/'+ID+r'/test-cases',self.case_body,201),
            ('POST','run_post',r'/'+ID+r'/test-cases/'+ID+r'/runs',self.plan['runBody'],202),
            ('GET','run_get',r'/'+ID+r'/runs/'+ID,None,200),
            ('GET','result_get',r'/'+ID+r'/runs/'+ID+r'/test-cases/'+ID,None,200),
        ]
        matched=[(kind,s) for m,kind,p,b,s in checks if method==m and isinstance(suffix,str) and re.fullmatch(p,suffix) and body==b]
        check(len(matched)==1,'endpoint_or_body_rejected')
        kind,default_status=matched[0]
        if method!='GET':
            check(kind not in self.writes_attempted,'duplicate_write_rejected')
            self.writes_attempted.add(kind)
        target_status=expect_status if expect_status is not None else default_status
        check(target_status==default_status or (kind=='mapping_get' and target_status==404),'endpoint_or_body_rejected')
        self.count+=1;remaining=self.deadline-time.monotonic()
        check(self.count<=23 and remaining>0,'request_budget_exhausted')
        if self.key is None:self.key=read_key()
        request=urllib.request.Request(BASE+suffix,data=canonical(body) if body is not None else None,
            headers={'X-API-Key':self.key,'Content-Type':'application/json','Accept':'application/json'},method=method)
        try:
            with self.opener.open(request,timeout=min(10,remaining)) as response:
                check(response.status==target_status,'http_status_rejected')
                check(response.headers.get_content_type()=='application/json','response_format_rejected')
                raw=response.read(262145);check(len(raw)<=262144,'response_limit')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            code=error.code;error.close()
            if code==404 and kind=='mapping_get' and target_status==404: return None
            raise Stop({401:'http_401',402:'http_402',403:'http_403',404:'http_404',409:'http_409',422:'http_422',429:'http_429'}.get(code,'http_failure')) from None
        except (TimeoutError,urllib.error.URLError):raise Stop('network_timeout_or_tls_failure') from None
        except (ValueError,UnicodeError):raise Stop('response_format_rejected') from None

def evaluate_additive(plan,request,guard,sleep=time.sleep):
    validate_plan(plan);guard.claim()
    expected_vars=empty_default_variables(plan)
    expected_case=additive_case_body(plan)
    page=request('GET',LIST_SUFFIX)
    check(isinstance(page,dict) and integer(page.get('total'),1) and page.get('next_page_uri') is None,'suite_mismatch')
    rows=page.get('items');check(isinstance(rows,list) and len(rows)==1,'suite_mismatch')
    row=rows[0];check(isinstance(row,dict) and row.get('app_id')==APP and integer(row.get('test_case_count'),6),'suite_mismatch')
    sid=identifier(row.get('test_suite_id'))

    before=request('GET','/'+sid)
    check(isinstance(before,dict) and before.get('test_suite_id')==sid and before.get('app_id')==APP and integer(before.get('test_case_count'),6),'suite_mismatch')
    check(before.get('variables')==[],'suite_mismatch')
    before_cases=before.get('test_cases');check(isinstance(before_cases,list) and len(before_cases)==6,'case_mismatch')
    existing_ids=[identifier(c.get('test_case_id')) for c in before_cases if isinstance(c,dict)]
    check(len(existing_ids)==6 and len(set(existing_ids))==6,'case_mismatch')
    check(all(c.get('name')!=expected_case['name'] for c in before_cases),'case_mismatch')

    pre_map=request('GET','/'+sid+'/mappings?app_id='+APP,None,404)
    check(pre_map is None,'mapping_mismatch')
    guard.record({'phase':'preconditions_verified','suiteId':sid,'existingCaseCount':6,'existingVariableCount':0,'mappingAbsent':True})

    patched=request('PATCH','/'+sid,{'variables':expected_vars})
    check(isinstance(patched,dict) and identifier(patched.get('test_suite_id'))==sid,'suite_mismatch')
    guard.record({'phase':'variables_patched_empty_defaults','suiteId':sid})

    patched_suite=request('GET','/'+sid)
    check(isinstance(patched_suite,dict) and suite_metadata_unchanged(patched_suite,before),'suite_mismatch')
    check(patched_suite.get('variables')==expected_vars and integer(patched_suite.get('test_case_count'),6),'suite_mismatch')
    check(patched_suite.get('test_cases')==before_cases,'case_mismatch')
    guard.record({'phase':'variables_verified_existing_cases_intact','suiteId':sid,'existingCasesPreserved':6})

    mapped=request('POST','/'+sid+'/mappings',plan['mappingBody']);mid=identifier(mapped.get('map_id'))
    guard.record({'phase':'mapping_created','suiteId':sid,'mapId':mid})
    mapping=request('GET','/'+sid+'/mappings?app_id='+APP)
    check(isinstance(mapping,dict) and mapping.get('map_id')==mid and mapping.get('test_suite_id')==sid,'mapping_mismatch')
    for key,value in plan['mappingBody'].items():
        check(mapping.get(key)==value and (key!='app_version' or type(mapping[key]) is int),'mapping_mismatch')

    added=request('POST','/'+sid+'/test-cases',expected_case);cid=identifier(added.get('test_case_id'))
    check(added.get('test_suite_id')==sid and cid not in existing_ids,'case_mismatch')
    guard.record({'phase':'case_added','suiteId':sid,'caseId':cid,'mapId':mid})

    after=request('GET','/'+sid)
    check(isinstance(after,dict) and suite_metadata_unchanged(after,before),'suite_mismatch')
    check(after.get('variables')==expected_vars and integer(after.get('test_case_count'),7),'suite_mismatch')
    after_cases=after.get('test_cases');check(isinstance(after_cases,list) and len(after_cases)==7,'case_mismatch')
    by_id={identifier(c.get('test_case_id')):c for c in after_cases if isinstance(c,dict)}
    check(len(by_id)==7 and cid in by_id and all(eid in by_id for eid in existing_ids),'case_mismatch')
    check([by_id[eid] for eid in existing_ids]==before_cases,'case_mismatch')
    check(case_matches_expected(by_id[cid],expected_case),'case_mismatch')

    guard.record({'phase':'before_run','suiteId':sid,'caseId':cid,'appVersion':6,'frequency':1,'existingCasesPreserved':6})
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
    required={x['name'] for x in expected_case['expected_behaviors']}
    names=[x.get('name') for x in grades];check(set(names) in (required,required|{'Guardrails'}) and len(set(names))==len(names),'grade_mismatch')
    check(all(x.get('verdict') in ('Pass','Fail') for x in grades),'grade_mismatch')
    transcript=execution.get('transcript');check(isinstance(transcript,list) and 1<=len(transcript)<=200,'transcript_unavailable')
    output={'status':'completed_requires_manual_review','suiteId':sid,'caseId':cid,'runId':rid,'appVersion':6,
        'existingCasesPreserved':6,'providerJudgePassed':all(x['verdict']=='Pass' for x in grades),
        'passedChecks':sum(x['verdict']=='Pass' for x in grades),'totalChecks':len(grades),
        'transcriptSha256':hashlib.sha256(canonical(transcript)).hexdigest(),
        'providerAcceptanceVerified':False,'telephoneCalls':0}
    guard.record(output)
    if not output['providerJudgePassed']:raise Stop('provider_grade_failed')
    return output

def main(args,plan):
    if not args:return {'status':'review_only','providerRequests':0,'telephoneCalls':0}
    if args!=['--approved-additive-eval-v6-once']:return {'status':'stopped','category':'arguments_rejected','telephoneCalls':0}
    guard=DiskGuard();transport=None
    try:
        check(os.getuid()==0,'root_required');validate_plan(plan)
        transport=Transport(None,plan)
        return evaluate_additive(plan,transport,guard)
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
