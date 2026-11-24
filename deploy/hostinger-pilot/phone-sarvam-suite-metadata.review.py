"""REVIEW ONLY: at most two documented GETs, no remote writes or raw metadata output."""
import hashlib,json,os,re,signal,ssl,stat,sys,time
import urllib.error,urllib.request

APP='Thaara-AI-V-db336de4-5453'
BASE='https://apps.sarvam.ai/api/evals/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/test-suites'
LIST_PATH='?app_id='+APP+'&limit=2&offset=0'
ID=r'[0-9A-HJKMNP-TV-Z]{26}'
PLAN_HASH='184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435'
class Rejected(Exception):pass
def need(ok,code='metadata_rejected'):
 if not ok:raise Rejected(code)
def ident(value):
 need(isinstance(value,str) and re.fullmatch(ID,value));return value
def plan_check(plan):
 need(isinstance(plan,dict) and hashlib.sha256(json.dumps(plan,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==PLAN_HASH,'plan_checksum_mismatch')
def bounded_count(value):return type(value) is int and 0<=value<=200
def variable_map(items):
 need(isinstance(items,list) and len(items)<=200)
 result={}
 for item in items:
  need(isinstance(item,dict) and isinstance(item.get('name'),str) and isinstance(item.get('value'),str) and item['name'] not in result)
  result[item['name']]=item['value']
 return result
def case_matches(case,target):
 if not isinstance(case,dict):return False
 if any(case.get(k)!=target[k] for k in ('name','category','user_scenario','max_turns')):return False
 behaviors=case.get('expected_behaviors')
 if not isinstance(behaviors,list) or not all(isinstance(x,dict) for x in behaviors):return False
 return ([{k:b.get(k) for k in ('name','description')} for b in behaviors]==target['expected_behaviors']
  and variable_map(case.get('variable_overrides',[]))==variable_map(target['variable_overrides']))

def inspect_metadata(plan,request):
 plan_check(plan);expected=plan['suiteRequest']['body'];page=request(LIST_PATH)
 need(isinstance(page,dict) and type(page.get('total')) is int and page['total'] in (0,1)
  and type(page.get('limit')) is int and page['limit']==2 and type(page.get('offset')) is int and page['offset']==0
  and page.get('next_page_uri') is None and page.get('prev_page_uri') is None)
 rows=page.get('items');need(isinstance(rows,list) and len(rows)==page['total'])
 base={'status':'metadata_readonly_complete','suiteCount':len(rows),'providerRequests':1,'providerMutations':0,
  'conflictCauseConfirmed':False,'billingReconciled':False,'versionBindingChecked':False}
 if not rows:return {**base,'finding':'no_app_suite_visible'}
 row=rows[0];need(isinstance(row,dict) and row.get('app_id')==APP)
 sid=ident(row.get('test_suite_id'));need(isinstance(row.get('name'),str) and 1<=len(row['name'])<=255 and bounded_count(row.get('test_case_count')))
 detail=request('/'+sid)
 need(isinstance(detail,dict) and detail.get('test_suite_id')==sid and detail.get('app_id')==APP and detail.get('name')==row['name']
  and bounded_count(detail.get('test_case_count')) and detail['test_case_count']==row['test_case_count'])
 cases=detail.get('test_cases');need(isinstance(cases,list) and len(cases)==detail['test_case_count'])
 variables=variable_map(detail.get('variables'));expected_variables=variable_map(expected['variables'])
 guardrails=detail.get('global_guardrails');need(isinstance(guardrails,list) and len(guardrails)<=20 and all(isinstance(x,str) for x in guardrails))
 target=expected['test_cases'][0]
 proposed_case=any(case_matches(case,target) for case in cases)
 same_name=row['name']==expected['name'];same_vars=variables==expected_variables;same_guardrails=guardrails==expected['global_guardrails']
 last=row.get('last_run_status');last=last if last in ('created','queued','running','completed','failed') else 'unknown_or_absent'
 return {**base,'providerRequests':2,'finding':'same_app_and_name_present' if same_name else 'same_app_different_name_present',
  'appBindingMatches':True,'caseCount':len(cases),'variableCount':len(variables),'suiteNameMatchesProposed':same_name,
  'suiteVariablesMatchProposed':same_vars,'guardrailsMatchProposed':same_guardrails,'proposedScenarioPresent':proposed_case,
  'fullConfigurationMatchesProposed':same_name and same_vars and same_guardrails and len(cases)==1 and proposed_case and detail.get('description')==expected['description'],
  'lastRunStatus':last}

def read_key():
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
 keyfd=None
 try:
  for leaf in ('opt','thaara-v2-pilot-private','secrets'):
   parent=os.fstat(fd);need(parent.st_uid in (0,1000) and not parent.st_mode&0o022,'key_path_rejected')
   child=os.open(leaf,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME,dir_fd=fd);os.close(fd);fd=child
  s=os.fstat(fd);need(s.st_uid in (0,1000) and not s.st_mode&0o077,'key_path_rejected')
  keyfd=os.open('sarvam_api_key',os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME,dir_fd=fd);s=os.fstat(keyfd)
  need(stat.S_ISREG(s.st_mode) and s.st_uid in (0,1000) and stat.S_IMODE(s.st_mode) in (0o400,0o600) and s.st_nlink==1 and 8<=s.st_size<=4096,'key_file_rejected')
  raw=os.read(keyfd,4097);need(len(raw)==s.st_size and re.fullmatch(rb'[\x21-\x7e]{8,4096}',raw),'key_file_rejected')
  return raw.decode('ascii')
 finally:
  if keyfd is not None:os.close(keyfd)
  os.close(fd)

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise Rejected('redirect_rejected')
class ReadOnlyTransport:
 def __init__(self,key=None):
  self.key=key;self.count=0;self.lastOperation='preflight';self.deadline=time.monotonic()+25
  self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
 def __call__(self,path):
  need(self.count<2,'request_limit')
  need(isinstance(path,str) and ((self.count==0 and path==LIST_PATH) or (self.count==1 and re.fullmatch('/'+ID,path))),'endpoint_rejected')
  remaining=self.deadline-time.monotonic();need(remaining>0,'request_deadline');self.lastOperation='list_suites' if self.count==0 else 'read_suite';self.count+=1
  if self.key is None:self.key=read_key()
  request=urllib.request.Request(BASE+path,headers={'X-API-Key':self.key,'Accept':'application/json'},method='GET')
  try:
   with self.opener.open(request,timeout=min(10,remaining)) as response:
    need(response.status==200 and response.headers.get_content_type()=='application/json','response_rejected')
    raw=response.read(262145);need(len(raw)<=262144,'response_limit');return json.loads(raw)
  except urllib.error.HTTPError as error:
   code=error.code;error.close();raise Rejected({401:'http_401',402:'http_402',403:'http_403',404:'http_404',409:'http_409',429:'http_429'}.get(code,'http_failure')) from None
  except (TimeoutError,urllib.error.URLError):raise Rejected('network_or_tls_failure') from None
  except (ValueError,UnicodeError):raise Rejected('response_rejected') from None

def main(args,plan):
 if not args:return {'status':'review_only','providerRequests':0,'providerMutations':0}
 if args!=['--approved-suite-metadata-read']:return {'status':'stopped','category':'arguments_rejected','providerMutations':0}
 transport=None
 try:
  need(os.getuid()==0,'root_required');plan_check(plan)
  def deadline(*_):raise Rejected('request_deadline')
  signal.signal(signal.SIGALRM,deadline);signal.alarm(25)
  transport=ReadOnlyTransport();return inspect_metadata(plan,transport)
 except Rejected as error:return {'status':'stopped','category':str(error),'providerMutations':0,'requestStage':transport.lastOperation if transport else 'preflight','requestStagesStarted':transport.count if transport else 0}
 except Exception:return {'status':'stopped','category':'unclassified_failure','providerMutations':0,'requestStage':transport.lastOperation if transport else 'preflight','requestStagesStarted':transport.count if transport else 0}
 finally:
  if transport is not None:transport.key=None
  if hasattr(signal,'SIGALRM'):signal.alarm(0)
if __name__=='__main__':
 result=main(sys.argv[1:],globals().get('PLAN'));print(json.dumps(result,sort_keys=True));sys.exit(0 if result['status'] in ('review_only','metadata_readonly_complete') else 1)
