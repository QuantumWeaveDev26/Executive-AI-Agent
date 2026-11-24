"""REVIEW ONLY: at most two documented GETs (suite list + suite mapping), no remote writes or raw mapping output."""
import hashlib,json,os,re,signal,ssl,stat,sys,time
import urllib.error,urllib.request

APP='Thaara-AI-V-db336de4-5453'
BASE='https://apps.sarvam.ai/api/evals/v1/01a10103-1b5d-78a1-9902-f391242c7537/01a10103-1b66-7123-96b1-43a6e96e016b/test-suites'
LIST_PATH='?app_id='+APP+'&limit=2&offset=0'
MAPPING_SUFFIX='/mappings?app_id='+APP
ID=r'[0-9A-HJKMNP-TV-Z]{26}'
PLAN_HASH='184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435'
class Rejected(Exception):pass
def need(ok,code='mapping_rejected'):
 if not ok:raise Rejected(code)
def ident(value):
 need(isinstance(value,str) and re.fullmatch(ID,value));return value
def plan_check(plan):
 need(isinstance(plan,dict) and hashlib.sha256(json.dumps(plan,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==PLAN_HASH,'plan_checksum_mismatch')
def bounded_count(value):return type(value) is int and 0<=value<=200
def bounded_version(value):return type(value) is int and 1<=value<=1000
def mapping_dict(items):
 need(isinstance(items,dict) and len(items)<=200)
 result={}
 for key,val in items.items():
  need(isinstance(key,str) and 1<=len(key)<=255 and isinstance(val,str) and 1<=len(val)<=255)
  result[key]=val
 return result

def inspect_mapping(plan,request):
 plan_check(plan);expected_map=plan.get('mappingBody')
 need(isinstance(expected_map,dict) and expected_map.get('app_id')==APP and bounded_version(expected_map.get('app_version')))
 expected_vars=mapping_dict(expected_map.get('variable_mapping'))
 page=request(LIST_PATH)
 need(isinstance(page,dict) and type(page.get('total')) is int and page['total'] in (0,1)
  and type(page.get('limit')) is int and page['limit']==2 and type(page.get('offset')) is int and page['offset']==0
  and page.get('next_page_uri') is None and page.get('prev_page_uri') is None)
 rows=page.get('items');need(isinstance(rows,list) and len(rows)==page['total'])
 base={'status':'mapping_readonly_complete','suiteCount':len(rows),'providerRequests':1,'providerMutations':0,
  'versionBindingChecked':False}
 if not rows:return {**base,'finding':'no_app_suite_visible'}
 row=rows[0];need(isinstance(row,dict) and row.get('app_id')==APP)
 sid=ident(row.get('test_suite_id'));need(isinstance(row.get('name'),str) and 1<=len(row['name'])<=255 and bounded_count(row.get('test_case_count')))
 mapping=request('/'+sid+MAPPING_SUFFIX)
 if mapping is None:
  return {**base,'providerRequests':2,'versionBindingChecked':True,'finding':'mapping_absent',
   'caseCount':row['test_case_count'],'mappingPresent':False,'mappedAppVersion':None,
   'mappedVersionMatchesTargetV6':False,'mappedVariableCount':0,'callPurposeMappedToProposed':False,
   'userNameMappedToProposed':False,'variableMappingMatchesProposed':False,'fullMappingMatchesProposedV6':False}
 need(isinstance(mapping,dict) and mapping.get('test_suite_id')==sid and mapping.get('app_id')==APP)
 ident(mapping.get('map_id'))
 version=mapping.get('app_version');need(bounded_version(version))
 vmap=mapping_dict(mapping.get('variable_mapping'))
 version_matches=version==expected_map['app_version']
 vars_match=vmap==expected_vars
 full_match=version_matches and vars_match
 finding='mapping_matches_proposed_v6' if full_match else ('mapping_present_v6_different_variables' if version_matches else 'mapping_present_other_version')
 return {**base,'providerRequests':2,'versionBindingChecked':True,'finding':finding,
  'caseCount':row['test_case_count'],'mappingPresent':True,'mappedAppVersion':version,
  'mappedVersionMatchesTargetV6':version_matches,'mappedVariableCount':len(vmap),
  'callPurposeMappedToProposed':vmap.get('call_purpose')==expected_vars.get('call_purpose'),
  'userNameMappedToProposed':vmap.get('user_name')==expected_vars.get('user_name'),
  'variableMappingMatchesProposed':vars_match,'fullMappingMatchesProposedV6':full_match}

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
class ReadOnlyMappingTransport:
 def __init__(self,key=None):
  self.key=key;self.count=0;self.lastOperation='preflight';self.deadline=time.monotonic()+25
  self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
 def __call__(self,path):
  need(self.count<2,'request_limit')
  need(isinstance(path,str) and ((self.count==0 and path==LIST_PATH) or (self.count==1 and re.fullmatch('/'+ID+re.escape(MAPPING_SUFFIX),path))),'endpoint_rejected')
  remaining=self.deadline-time.monotonic();need(remaining>0,'request_deadline');self.lastOperation='list_suites' if self.count==0 else 'read_mapping';self.count+=1
  if self.key is None:self.key=read_key()
  request=urllib.request.Request(BASE+path,headers={'X-API-Key':self.key,'Accept':'application/json'},method='GET')
  try:
   with self.opener.open(request,timeout=min(10,remaining)) as response:
    need(response.status==200 and response.headers.get_content_type()=='application/json','response_rejected')
    raw=response.read(262145);need(len(raw)<=262144,'response_limit');return json.loads(raw)
  except urllib.error.HTTPError as error:
   code=error.code;error.close()
   if code==404 and self.lastOperation=='read_mapping':return None
   raise Rejected({401:'http_401',402:'http_402',403:'http_403',404:'http_404',409:'http_409',422:'http_422',429:'http_429'}.get(code,'http_failure')) from None
  except (TimeoutError,urllib.error.URLError):raise Rejected('network_or_tls_failure') from None
  except (ValueError,UnicodeError):raise Rejected('response_rejected') from None

def main(args,plan):
 if not args:return {'status':'review_only','providerRequests':0,'providerMutations':0}
 if args!=['--approved-suite-mapping-read']:return {'status':'stopped','category':'arguments_rejected','providerMutations':0}
 transport=None
 try:
  need(os.getuid()==0,'root_required');plan_check(plan)
  def deadline(*_):raise Rejected('request_deadline')
  signal.signal(signal.SIGALRM,deadline);signal.alarm(25)
  transport=ReadOnlyMappingTransport();return inspect_mapping(plan,transport)
 except Rejected as error:return {'status':'stopped','category':str(error),'providerMutations':0,'requestStage':transport.lastOperation if transport else 'preflight','requestStagesStarted':transport.count if transport else 0}
 except Exception:return {'status':'stopped','category':'unclassified_failure','providerMutations':0,'requestStage':transport.lastOperation if transport else 'preflight','requestStagesStarted':transport.count if transport else 0}
 finally:
  if transport is not None:transport.key=None
  if hasattr(signal,'SIGALRM'):signal.alarm(0)
if __name__=='__main__':
 result=main(sys.argv[1:],globals().get('PLAN'));print(json.dumps(result,sort_keys=True));sys.exit(0 if result['status'] in ('review_only','mapping_readonly_complete') else 1)
