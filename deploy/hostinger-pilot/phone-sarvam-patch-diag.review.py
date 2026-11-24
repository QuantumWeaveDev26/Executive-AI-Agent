"""REVIEW ONLY until separately approved. Minimal-request (>=15s interval) diagnostic & idempotent suite-variable PATCH.
Cross-verifies suiteId from trusted root-owned VPS receipts (additive-once & paced-once), performs 1 preflight GET,
waits >=15s (or Retry-After up to 65s), sends 1 conditional PATCH for empty-default variables, captures sanitized HTTP 429
details (errorCode, errorMessage, retryAfterSeconds, rateLimitHeaders, diagnosticClassification), and never retries.
"""
import copy
import hashlib
import json
import math
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
GUARD='phone-eval-stage-b-20261103-v6-patch-diag-once'
TRUSTED_GUARDS=(
    'phone-eval-stage-b-20261103-v6-additive-once',
    'phone-eval-stage-b-20261103-v6-paced-once',
)
ID=r'[0-9A-HJKMNP-TV-Z]{26}'
PLAN_HASH='184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435'
MIN_PACE_SECONDS=15.0
MAX_HEADER_DELAY_SECONDS=65.0
ALLOWED_RATE_HEADERS=(
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-ratelimit-reset-after',
    'x-ratelimit-scope',
    'ratelimit-limit',
    'ratelimit-remaining',
    'ratelimit-reset',
    'ratelimit-policy',
)

class Stop(Exception):
    def __init__(self,category,diag=None):
        super().__init__(category)
        self.category=category
        self.diag=diag if isinstance(diag,dict) else None

def check(value,category='response_mismatch'):
    if not value: raise Stop(category)
def canonical(value): return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def identifier(value):
    check(isinstance(value,str) and re.fullmatch(ID,value),'identifier_rejected')
    return value
def integer(value,expected): return type(value) is int and value==expected

def validate_plan(plan):
    check(isinstance(plan,dict) and hashlib.sha256(canonical(plan)).hexdigest()==PLAN_HASH,'plan_checksum_mismatch')
    mapping=plan.get('mappingBody')
    check(isinstance(mapping,dict) and mapping.get('app_id')==APP and integer(mapping.get('app_version'),6),'plan_checksum_mismatch')
    var_map=mapping.get('variable_mapping')
    check(var_map=={'call_purpose':'approved_purpose','user_name':'recipient_name'},'plan_checksum_mismatch')

def empty_default_variables(plan):
    validate_plan(plan)
    raw=plan['suiteRequest']['body']['variables']
    check(isinstance(raw,list) and len(raw)==2,'plan_checksum_mismatch')
    out=[{'name':item['name'],'value':''} for item in raw]
    check([x['name'] for x in out]==['approved_purpose','recipient_name'],'plan_checksum_mismatch')
    return out

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

def sanitize_text(value,max_len=240,secret=None):
    if value is None: return None
    text=str(value)
    if isinstance(secret,str) and len(secret)>=4:
        text=text.replace(secret,'[REDACTED]')
    text=re.sub(r'(?i)\b(?:bearer|x-api-key)\s*[:=]?\s*\S+','[REDACTED]',text)
    text=re.sub(r'\bsk_[A-Za-z0-9_-]+\b','[REDACTED]',text)
    text=re.sub(re.escape(APP),'[APP_ID]',text)
    text=re.sub(r'\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b','[UUID]',text)
    text=re.sub(r'\b[0-9A-HJKMNP-TV-Z]{26}\b','[ULID]',text)
    text=re.sub(r'\b(?=[A-Za-z0-9+/=_-]{24,}\b)(?=[A-Za-z0-9+/=_-]*\d)[A-Za-z0-9+/=_-]{24,}\b','[TOKEN]',text)
    text=re.sub(r'[^\x20-\x7e]+',' ',text).strip()
    text=re.sub(r'\s+',' ',text)
    return text[:max_len] if text else None

def parse_optional_seconds(raw_value,now_epoch=None):
    if raw_value is None: return None
    try: value=float(str(raw_value).strip())
    except (ValueError,TypeError): return None
    if not math.isfinite(value) or value<0: return None
    if value>1000000000:
        current=time.time() if now_epoch is None else now_epoch
        value=max(0.0,value-current)
    return round(value,3)

def parse_bounded_seconds(raw_value,now_epoch=None):
    value=parse_optional_seconds(raw_value,now_epoch)
    check(value is not None and value<=MAX_HEADER_DELAY_SECONDS,'rate_limit_delay_exceeded')
    return value

def rate_limit_delay(headers,default_delay=MIN_PACE_SECONDS,now_epoch=None):
    delay=float(default_delay)
    if headers is None: return delay
    lower={str(k).lower():str(v).strip() for k,v in headers.items() if k is not None and v is not None}
    if 'retry-after' in lower and lower['retry-after']!='':
        delay=max(delay,parse_bounded_seconds(lower['retry-after'],now_epoch))
    if 'x-ratelimit-reset-after' in lower and lower['x-ratelimit-reset-after']!='':
        delay=max(delay,parse_bounded_seconds(lower['x-ratelimit-reset-after'],now_epoch))
    remaining=lower.get('x-ratelimit-remaining',lower.get('ratelimit-remaining'))
    if remaining=='0':
        for key in ('ratelimit-reset','x-ratelimit-reset'):
            if key in lower and lower[key]!='':
                delay=max(delay,parse_bounded_seconds(lower[key],now_epoch))
    return delay

def extract_sanitized_http_error(status_code,headers,raw_bytes,failed_op,secret=None,now_epoch=None):
    rate_hdrs={}
    if headers is not None:
        for k,v in headers.items():
            if k is None or v is None: continue
            lk=str(k).lower().strip()
            if lk in ALLOWED_RATE_HEADERS:
                sv=sanitize_text(v,64,secret)
                if sv is not None: rate_hdrs[lk]=sv
    retry_after=parse_optional_seconds(rate_hdrs.get('retry-after'),now_epoch)
    if retry_after is None:
        retry_after=parse_optional_seconds(rate_hdrs.get('x-ratelimit-reset-after'),now_epoch)
    err_code=None;err_msg=None;body_shape='empty'
    if isinstance(raw_bytes,(bytes,bytearray)) and len(raw_bytes)>0:
        try:
            parsed=json.loads(bytes(raw_bytes[:4096]).decode('utf-8',errors='replace'))
            if isinstance(parsed,dict):
                body_shape='json_object'
                nested=parsed.get('error')
                if isinstance(nested,dict):
                    err_code=sanitize_text(nested.get('code'),64,secret)
                    err_msg=sanitize_text(nested.get('message'),240,secret)
                if err_code is None and isinstance(parsed.get('code'),str):
                    err_code=sanitize_text(parsed.get('code'),64,secret)
                if err_msg is None:
                    if isinstance(parsed.get('message'),str):
                        err_msg=sanitize_text(parsed.get('message'),240,secret)
                    elif isinstance(parsed.get('detail'),str):
                        err_msg=sanitize_text(parsed.get('detail'),240,secret)
                    elif isinstance(parsed.get('details'),str):
                        err_msg=sanitize_text(parsed.get('details'),240,secret)
                    elif isinstance(parsed.get('detail'),list) and len(parsed['detail'])>0:
                        first=parsed['detail'][0]
                        if isinstance(first,dict):
                            err_code=err_code or sanitize_text(first.get('type'),64,secret)
                            err_msg=sanitize_text(first.get('msg'),240,secret)
            else:
                body_shape='json_non_object'
        except Exception:
            body_shape='non_json'
            err_msg=sanitize_text(bytes(raw_bytes[:512]).decode('utf-8',errors='replace'),240,secret)
    combined=((err_code or '')+' '+(err_msg or '')).lower()
    quota_terms=('quota','plan','tier','credit','wallet','subscription','permission','forbidden','not_allowed','disabled','feature')
    rate_terms=('rate limit','rate_limit','too many requests','too_many_requests','throttl','burst')
    if status_code in (401,403):
        classification='permission_or_auth_restriction'
    elif status_code==402:
        classification='quota_or_credit_exhausted'
    elif status_code in (400,422):
        classification='validation_or_schema_rejection'
    elif status_code==404:
        classification='resource_not_found'
    elif status_code==409:
        classification='resource_conflict'
    elif status_code==429:
        if any(term in combined for term in quota_terms):
            classification='quota_or_plan_restriction'
        elif retry_after is not None or rate_hdrs.get('x-ratelimit-remaining')=='0' or rate_hdrs.get('ratelimit-remaining')=='0':
            classification='rate_limit_window_with_retry_after'
        elif any(term in combined for term in rate_terms):
            classification='rate_limit_without_retry_after_header'
        else:
            classification='endpoint_or_burst_throttled_without_retry_after'
    else:
        classification='unclassified_http_error'
    return {
        'httpStatus':status_code,
        'failedOperation':failed_op,
        'errorBodyShape':body_shape,
        'errorCode':err_code,
        'errorMessage':err_msg,
        'retryAfterSeconds':retry_after,
        'rateLimitHeaders':rate_hdrs,
        'diagnosticClassification':classification,
    }

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

def read_trusted_suite_id():
    parent=open_private_parent(require_root=True)
    try:
        suite_ids=[]
        for guard_name in TRUSTED_GUARDS:
            gfd=None;rfd=None
            try:
                try: gfd=os.open(guard_name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
                except FileNotFoundError: raise Stop('trusted_receipt_missing') from None
                gs=os.fstat(gfd)
                check(gs.st_uid==0 and stat.S_IMODE(gs.st_mode)==0o700,'trusted_receipt_rejected')
                try: rfd=os.open('02.json',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=gfd)
                except FileNotFoundError: raise Stop('trusted_receipt_missing') from None
                rs=os.fstat(rfd)
                check(stat.S_ISREG(rs.st_mode) and rs.st_uid==0 and stat.S_IMODE(rs.st_mode)==0o600 and rs.st_nlink==1 and 1<=rs.st_size<=8192,'trusted_receipt_rejected')
                raw=os.read(rfd,8193);check(len(raw)==rs.st_size,'trusted_receipt_rejected')
                doc=json.loads(raw)
                check(isinstance(doc,dict) and doc.get('phase')=='preconditions_verified' and integer(doc.get('existingCaseCount'),6),'trusted_receipt_rejected')
                suite_ids.append(identifier(doc.get('suiteId')))
            finally:
                if rfd is not None: os.close(rfd)
                if gfd is not None: os.close(gfd)
        check(len(suite_ids)==2 and suite_ids[0]==suite_ids[1],'trusted_suite_id_mismatch')
        return suite_ids[0]
    finally:
        os.close(parent)

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
    def __init__(self):
        self.fd=None;self.sequence=0;self.last_phase=None;self.last_error_diag=None
        self.summary={
            'trustedReceiptsMatched':False,
            'variablesPatched':False,
            'variablesVerified':False,
            'variablesAlreadyPresent':False,
            'existingCasesPreserved':0,
            'runSubmissionFencePresent':False,
            'hasRunId':False,
        }
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
        phase=data.get('phase') or data.get('status')
        if isinstance(phase,str): self.last_phase=phase
        if phase=='preconditions_verified':
            self.summary['trustedReceiptsMatched']=bool(data.get('trustedReceiptsMatched'))
            self.summary['existingCasesPreserved']=int(data.get('existingCaseCount',0))
        elif phase=='variables_patched_empty_defaults':
            self.summary['variablesPatched']=True
        elif phase=='variables_verified_existing_cases_intact':
            self.summary['variablesVerified']=True
            self.summary['existingCasesPreserved']=int(data.get('existingCasesPreserved',6))
        elif phase=='variables_already_present_verified':
            self.summary['variablesAlreadyPresent']=True
            self.summary['variablesVerified']=True
            self.summary['existingCasesPreserved']=int(data.get('existingCasesPreserved',6))
        elif phase=='error_diagnostic_recorded':
            self.last_error_diag=data.get('errorDiagnostic')
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
    def __init__(self,key,plan,sleep=time.sleep):
        validate_plan(plan);self.key=key;self.plan=plan;self.sleep=sleep
        self.deadline=time.monotonic()+180;self.count=0;self.mutations=0;self.next_delay=MIN_PACE_SECONDS
        self.writes_attempted=set();self.sleep_history=[];self.last_error_diag=None
        self.empty_vars={'variables':empty_default_variables(plan)}
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    def __call__(self,method,suffix,body=None,expect_status=None,min_delay=MIN_PACE_SECONDS):
        checks=[
            ('GET','detail',r'/'+ID,None,(200,)),
            ('PATCH','suite_patch',r'/'+ID,self.empty_vars,(200,)),
        ]
        matched=[(kind,allowed) for m,kind,p,b,allowed in checks if method==m and isinstance(suffix,str) and re.fullmatch(p,suffix) and body==b]
        check(len(matched)==1,'endpoint_or_body_rejected')
        kind,allowed_statuses=matched[0]
        if expect_status is None: target_statuses=(allowed_statuses[0],)
        elif isinstance(expect_status,tuple): target_statuses=expect_status
        else: target_statuses=(expect_status,)
        check(all(s in allowed_statuses for s in target_statuses),'endpoint_or_body_rejected')
        if method!='GET':
            check(kind not in self.writes_attempted,'duplicate_write_rejected')
            self.writes_attempted.add(kind)
            self.mutations+=1
        if self.count>0:
            pace=max(float(min_delay),self.next_delay)
            check(pace<=MAX_HEADER_DELAY_SECONDS and self.deadline-time.monotonic()>pace,'rate_limit_delay_exceeded')
            self.sleep_history.append(pace)
            self.sleep(pace)
        self.count+=1;remaining=self.deadline-time.monotonic()
        check(self.count<=3 and remaining>0,'request_budget_exhausted')
        if self.key is None:self.key=read_key()
        request=urllib.request.Request(BASE+suffix,data=canonical(body) if body is not None else None,
            headers={'X-API-Key':self.key,'Content-Type':'application/json','Accept':'application/json'},method=method)
        try:
            with self.opener.open(request,timeout=min(15,remaining)) as response:
                self.next_delay=rate_limit_delay(getattr(response,'headers',None),MIN_PACE_SECONDS)
                check(response.status in target_statuses,'http_status_rejected')
                check(response.headers.get_content_type()=='application/json','response_format_rejected')
                raw=response.read(262145);check(len(raw)<=262144,'response_limit')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            code=error.code;hdrs=getattr(error,'headers',None)
            raw_err=b''
            try: raw_err=error.read(4096)
            except Exception: raw_err=b''
            finally:
                try: error.close()
                except Exception: pass
            diag=extract_sanitized_http_error(code,hdrs,raw_err,kind,self.key)
            self.last_error_diag=diag
            category={400:'http_400',401:'http_401',402:'http_402',403:'http_403',404:'http_404',409:'http_409',422:'http_422',429:'http_429'}.get(code,'http_failure')
            raise Stop(category,diag) from None
        except (TimeoutError,urllib.error.URLError):raise Stop('network_timeout_or_tls_failure') from None
        except (ValueError,UnicodeError):raise Stop('response_format_rejected') from None

def evaluate_patch_diag(plan,request,guard,suite_id_resolver=read_trusted_suite_id):
    validate_plan(plan);guard.claim()
    expected_vars=empty_default_variables(plan)
    expected_case=additive_case_body(plan)
    sid=identifier(suite_id_resolver())

    before=request('GET','/'+sid,None,200,MIN_PACE_SECONDS)
    check(isinstance(before,dict) and before.get('test_suite_id')==sid and before.get('app_id')==APP,'suite_mismatch')
    row_count=before.get('test_case_count')
    check(integer(row_count,6) or integer(row_count,7),'suite_mismatch')
    check(before.get('last_run_status') not in ('created','running') and before.get('active_run_id') is None,'run_state_unverified')
    current_vars=before.get('variables')
    if current_vars==[]: vars_present=False
    elif current_vars==expected_vars: vars_present=True
    else: raise Stop('suite_mismatch')

    before_cases=before.get('test_cases');check(isinstance(before_cases,list) and len(before_cases)==row_count,'case_mismatch')
    all_ids=[identifier(c.get('test_case_id')) for c in before_cases if isinstance(c,dict)]
    check(len(all_ids)==row_count and len(set(all_ids))==row_count,'case_mismatch')
    matching_cases=[c for c in before_cases if c.get('name')==expected_case['name']]
    if row_count==6:
        check(len(matching_cases)==0,'case_mismatch')
    else:
        check(len(matching_cases)==1 and case_matches_expected(matching_cases[0],expected_case),'case_mismatch')

    guard.record({
        'phase':'preconditions_verified',
        'suiteId':sid,
        'trustedReceiptsMatched':True,
        'existingCaseCount':6,
        'variablesAlreadyPresent':vars_present,
    })

    if not vars_present:
        patched=request('PATCH','/'+sid,{'variables':expected_vars},200,MIN_PACE_SECONDS)
        check(isinstance(patched,dict) and identifier(patched.get('test_suite_id'))==sid,'suite_mismatch')
        guard.record({'phase':'variables_patched_empty_defaults','suiteId':sid})
        patched_suite=request('GET','/'+sid,None,200,MIN_PACE_SECONDS)
        check(isinstance(patched_suite,dict) and suite_metadata_unchanged(patched_suite,before),'suite_mismatch')
        check(patched_suite.get('variables')==expected_vars and integer(patched_suite.get('test_case_count'),row_count),'suite_mismatch')
        check(patched_suite.get('test_cases')==before_cases,'case_mismatch')
        guard.record({'phase':'variables_verified_existing_cases_intact','suiteId':sid,'existingCasesPreserved':6})
    else:
        guard.record({'phase':'variables_already_present_verified','suiteId':sid,'existingCasesPreserved':6})

    req_count=getattr(request,'count',None)
    mut_count=getattr(request,'mutations',None)
    output={
        'status':'patch_diag_complete',
        'trustedReceiptsMatched':guard.summary['trustedReceiptsMatched'],
        'variablesPatched':guard.summary['variablesPatched'],
        'variablesVerified':guard.summary['variablesVerified'],
        'variablesAlreadyPresent':guard.summary['variablesAlreadyPresent'],
        'existingCasesPreserved':guard.summary['existingCasesPreserved'],
        'runSubmissionFencePresent':False,
        'hasRunId':False,
        'providerRequests':req_count if isinstance(req_count,int) else (3 if not vars_present else 1),
        'providerMutations':mut_count if isinstance(mut_count,int) else (1 if not vars_present else 0),
        'providerAcceptanceVerified':False,
        'telephoneCalls':0,
    }
    guard.record(output)
    return output

def main(args,plan):
    if not args:return {'status':'review_only','providerRequests':0,'providerMutations':0,'telephoneCalls':0}
    if args!=['--approved-patch-diag-v6-once']:return {'status':'stopped','category':'arguments_rejected','telephoneCalls':0}
    guard=DiskGuard();transport=None
    try:
        check(os.getuid()==0,'root_required');validate_plan(plan)
        transport=Transport(None,plan)
        return evaluate_patch_diag(plan,transport,guard)
    except Stop as error:
        if error.diag is not None and guard.fd is not None:
            try: guard.record({'phase':'error_diagnostic_recorded','errorDiagnostic':error.diag})
            except Exception: pass
        res={
            'status':'stopped',
            'category':str(error.category),
            'lastPhase':guard.last_phase,
            'receiptCount':guard.sequence,
            'providerRequests':transport.count if transport is not None else 0,
            'providerMutations':transport.mutations if transport is not None else 0,
            'providerAcceptanceVerified':False,
            'telephoneCalls':0,
        }
        res.update(guard.summary)
        if error.diag is not None:
            res['errorDiagnostic']=error.diag
        return res
    except Exception:
        res={
            'status':'stopped',
            'category':'unclassified_failure',
            'lastPhase':guard.last_phase,
            'receiptCount':guard.sequence,
            'providerRequests':transport.count if transport is not None else 0,
            'providerMutations':transport.mutations if transport is not None else 0,
            'providerAcceptanceVerified':False,
            'telephoneCalls':0,
        }
        res.update(guard.summary)
        return res
    finally:
        if transport is not None:transport.key=None
        guard.close()

if __name__=='__main__':
    result=main(sys.argv[1:],globals().get('PLAN'))
    print(json.dumps(result,sort_keys=True),flush=True)
    sys.exit(0 if result['status'] in ('review_only','patch_diag_complete') else 1)
