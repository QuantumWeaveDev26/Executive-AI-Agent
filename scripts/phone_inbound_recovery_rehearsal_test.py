import contextlib, hashlib, importlib.util, io, json, pathlib, sys, unittest, tempfile, types, os
from unittest.mock import Mock, patch
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('review',root/'deploy/hostinger-pilot/phone-inbound-recovery-rehearsal.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source=(root/'deploy/hostinger-pilot/phone-backup-restore.review.py').read_text().split('def migration_inputs():')[0].encode()
pin=hashlib.sha256(source).hexdigest();cid='a'*64;clone='b'*64
def catalog():return {'table':{'owner':'postgres','rls':True,'forced':True,'kind':'r','persistence':'p','options':None},'columns':[{'name':'synthetic'}],'constraints':[['synthetic','p',True,'PRIMARY KEY']],'indexes':[['synthetic',True,True]],'policies':[{'name':'synthetic'}],'grants':[['postgres','thaara_app','SELECT',False]],'columnGrants':[]}
def functions():
 result=[]
 for signature in ['public.phone_inbound_resolve_grant(text,text,text)','public.phone_inbound_scope_matches(uuid,uuid)','public.phone_inbound_append_event(jsonb)']:
  acl=[['thaara_phone_guard','thaara_phone_guard','EXECUTE',False]]
  if 'scope_matches' not in signature:acl.append(['thaara_phone_guard','thaara_phone_ingest','EXECUTE',False])
  result.append({'signature':signature,'owner':'thaara_phone_guard','definition':'synthetic SQL definition','acl':acl})
 return result
@contextlib.contextmanager
def hook_fixture(bad_acl=False):
 parent=(root/'node_modules/.cache').resolve()
 with tempfile.TemporaryDirectory(prefix='phone-recovery-fix-mock-',dir=parent) as directory:
  folder=pathlib.Path(directory).resolve();assert folder.is_relative_to(parent)
  seen=[];defs=functions()
  if bad_acl:defs[1]['acl'].append(['thaara_phone_guard','thaara_phone_ingest','EXECUTE',False])
  class Session:
   def __init__(self,docker,container,user):assert container==clone;seen.append(('session',user))
   def value(self,q):
    if q==m.FINAL_PRIVILEGES:return {k:True for k in ['principalsRls','roles','functionOwners','appDenied','ingestAllowed','guardSchemaCreateDenied','functionsAcl','principalsAcl','principalColumnAcl','noRoleMemberships']}
    if q==m.FUNCTION_ROLE_CATALOG:return {'functions':defs,'roles':[{},{}]}
    c=catalog()
    if 'phone_inbound_principals' in q:c['grants']=[['postgres','thaara_phone_guard','SELECT',False]]
    return c
   def close(self):seen.append(('closed',))
  class Docker:
   def fixture(self,ident):assert ident['id']==clone;seen.append(('isolation',))
   def __call__(self,args,**kwargs):assert args[4]==clone;seen.append(('apply',kwargs['input'].read()))
  def require(ok,code):
   if not ok:raise ValueError(code)
  def save(p,v):
   with p.open('x') as stream:json.dump(v,stream)
  original={json.dumps(['public','synthetic']):2}
  counts={**original,json.dumps(['public','phone_inbound_call_events']):0,json.dumps(['public','phone_inbound_principals']):0}
  core={'SOURCE_ID':cid,'DATABASE':'thaara_vps_pilot','valid_id':lambda v:isinstance(v,str) and len(v)==64,'require':require,'Snapshot':Session,
   'private_file':lambda p:p.open('xb'),'os':os,'save_json':save,'digest':lambda p:hashlib.sha256(p.read_bytes()).hexdigest(),'counts':lambda s:counts,
   'verify_counts':lambda a,b:require(a==b,'count_mismatch')}
  parts={n:(str(n).encode(),hashlib.sha256(str(n).encode()).hexdigest()) for n in [112,113]}
  yield core,parts,Docker(),folder,original,seen
class RehearsalTests(unittest.TestCase):
 def test_full_clone_hook_keeps_capture_unapproved_and_closes_mock_sessions(self):
  with hook_fixture() as (core,parts,docker,folder,original,seen):
   result=m.rehearse_clone(core,parts,docker,{'id':clone},'bootstrap',folder,original)
   self.assertFalse(result['independentBaselineVerified']);self.assertEqual(result['catalogPurpose'],'observed_unapproved_baseline')
   self.assertFalse(json.loads((folder/'clone-schema-rehearsal.json').read_text())['independentBaselineVerified'])
   self.assertEqual(len([x for x in seen if x[0]=='apply']),2);self.assertEqual(len([x for x in seen if x[0]=='session']),len([x for x in seen if x[0]=='closed']))
 def test_full_clone_hook_rejects_excessive_grant_even_if_mock_sql_flags_claim_success(self):
  with hook_fixture(True) as (core,parts,docker,folder,original,seen):
   with self.assertRaisesRegex(ValueError,'function_execute_acl'):m.rehearse_clone(core,parts,docker,{'id':clone},'bootstrap',folder,original)
   self.assertFalse((folder/'clone-schema-rehearsal.json').exists())
 def test_fresh_source_recount_is_wired_after_clone_and_closes_a_new_snapshot(self):
  core=m.prepare_core(source,pin)
  names=core['run'].__code__.co_names
  self.assertIn('recount_source',names);self.assertLess(names.index('rehearse_clone'),names.index('recount_source'))
  session=Mock();c={'SOURCE_ID':cid,'Snapshot':Mock(return_value=session),'counts':Mock(return_value={'table':2}),'require':lambda ok,code:None if ok else self.fail(code)}
  self.assertTrue(m.recount_source(c,Mock(),{'table':2}));c['Snapshot'].assert_called_once_with(unittest.mock.ANY,cid,'postgres');session.close.assert_called_once()
 def test_changed_source_counts_do_not_certify_preservation_and_failed_recounts_close(self):
  session=Mock();c={'SOURCE_ID':cid,'Snapshot':Mock(return_value=session),'counts':Mock(return_value={'table':3}),'require':lambda ok,code:None if ok else self.fail(code)}
  self.assertFalse(m.recount_source(c,Mock(),{'table':2}));session.close.assert_called_once()
  c['counts'].side_effect=ValueError('synthetic timeout')
  with self.assertRaises(ValueError):m.recount_source(c,Mock(),{'table':2})
  self.assertEqual(session.close.call_count,2)
 def test_exact_per_function_acl_rejects_ingest_scope_matches_and_grant_option(self):
  definitions=[]
  for signature in ['public.phone_inbound_resolve_grant(text,text,text)','public.phone_inbound_scope_matches(uuid,uuid)','public.phone_inbound_append_event(jsonb)']:
   acl=[['thaara_phone_guard','thaara_phone_guard','EXECUTE',False]]
   if 'scope_matches' not in signature:acl.append(['thaara_phone_guard','thaara_phone_ingest','EXECUTE',False])
   definitions.append({'signature':signature,'owner':'thaara_phone_guard','definition':'synthetic SQL definition','acl':acl})
  self.assertIsNone(m.validate_function_catalog(definitions))
  import copy
  bad=copy.deepcopy(definitions);bad[1]['acl'].append(['thaara_phone_guard','thaara_phone_ingest','EXECUTE',False])
  with self.assertRaises(ValueError):m.validate_function_catalog(bad)
  bad=copy.deepcopy(definitions);bad[0]['acl'][1][3]=True
  with self.assertRaises(ValueError):m.validate_function_catalog(bad)
  bad=copy.deepcopy(definitions);bad[2]['acl'].append(['thaara_phone_guard','PUBLIC','EXECUTE',False])
  with self.assertRaises(ValueError):m.validate_function_catalog(bad)
 def test_observed_fingerprint_is_explicitly_not_independent_baseline_approval(self):
  self.assertEqual(m.capture_status(),{'catalogPurpose':'observed_unapproved_baseline','independentBaselineVerified':False})
 def test_default_mode_has_no_runtime_or_core_access(self):
  out=io.StringIO()
  with patch.object(sys,'argv',['script']),contextlib.redirect_stdout(out):self.assertEqual(m.main(),0)
  self.assertEqual(json.loads(out.getvalue())['status'],'review_only')
 def test_checksum_and_scope_reject_before_loading_core(self):
  with self.assertRaises(ValueError):m.prepare_core(source,'0'*64)
  malicious=source+b'\ndef migrate(): pass\n'
  with self.assertRaises(ValueError):m.prepare_core(malicious,hashlib.sha256(malicious).hexdigest())
 def test_core_has_no_persistent_migration_or_deployment_entry(self):
  core=m.prepare_core(source,pin);self.assertTrue(callable(core['run']))
  for name in ['migrate','migration_inputs','run_with_migration','main']:self.assertNotIn(name,core)
  self.assertIn('search_path=pg_catalog',core['READ_OPTIONS'])
 def test_source_exec_is_always_fixed_socket_environment_and_readonly(self):
  command=m.secure_process_args(['docker','--host=unix:///var/run/docker.sock','exec','-i','--user','postgres',cid,'psql','-X'],cid,'READONLY')
  self.assertEqual(command[:2],['/usr/bin/docker','--host=unix:///var/run/docker.sock']);self.assertIn('/usr/bin/env',command);self.assertIn('PGOPTIONS=READONLY',command);self.assertIn('PGPASSFILE=/nonexistent/thaara-no-passfile',command);self.assertIn('PGCONNECT_TIMEOUT=5',command)
 def test_clone_mutation_has_no_source_target_or_inherited_options(self):
  command=m.secure_process_args(['docker','--host=unix:///var/run/docker.sock','exec','-i',clone,'psql'],cid,'READONLY')
  self.assertIn(clone,command);self.assertNotIn('PGOPTIONS=READONLY',command)
  with self.assertRaises(ValueError):m.secure_process_args(['docker','--host=tcp://other','exec',clone,'psql'],cid,'READONLY')
  with self.assertRaises(ValueError):m.secure_process_args(['docker','--host=unix:///var/run/docker.sock','exec','-e','PGSERVICE=other',clone,'psql'],cid,'READONLY')
 def test_process_proxy_refuses_inherited_or_provider_environment(self):
  core=m.prepare_core(source,pin)
  with patch.object(m.subprocess,'Popen') as spawn:
   with self.assertRaises(ValueError):core['subprocess'].Popen(['docker','--host=unix:///var/run/docker.sock','ps'],env={'SARVAM_API_KEY':'PRIVATE'})
   spawn.assert_not_called()
   core['subprocess'].Popen(['docker','--host=unix:///var/run/docker.sock','ps'],env={'PATH':'/usr/bin'})
   self.assertEqual(spawn.call_args.kwargs['env']['DOCKER_CONFIG'],'/nonexistent')
 def test_source_id_can_never_be_schema_rehearsal_target(self):
  def require(ok,code):
   if not ok:raise ValueError(code)
  core={'SOURCE_ID':cid,'valid_id':lambda x:True,'require':require};docker=Mock()
  with self.assertRaises(ValueError):m.rehearse_clone(core,{},docker,{'id':cid},'bootstrap',None,{})
  docker.fixture.assert_not_called()
 def test_schema_checksum_failure_precedes_sql_file_or_execution(self):
  def require(ok,code):
   if not ok:raise ValueError(code)
  core={'SOURCE_ID':cid,'valid_id':lambda x:True,'require':require};docker=Mock()
  with self.assertRaises(ValueError):m.rehearse_clone(core,{112:(b'SQL','0'*64)},docker,{'id':clone},'bootstrap',None,{})
  docker.assert_not_called()
 def test_catalog_hash_is_stable_and_sensitive_to_security_changes(self):
  a=catalog();b=dict(reversed(list(a.items())));self.assertEqual(m.canonical_catalog(a),m.canonical_catalog(b))
  b=catalog();b['indexes'][0][1]=False;self.assertNotEqual(m.canonical_catalog(a),m.canonical_catalog(b))
  for field in ['rls','forced']:
   b=catalog();b['table'][field]=False
   with self.assertRaises(ValueError):m.canonical_catalog(b)
 def test_catalog_refuses_unknown_internal_ids_and_missing_acl_sections(self):
  a=catalog();a['table']['oid']=123
  with self.assertRaises(ValueError):m.canonical_catalog(a)
 def test_catalog_refuses_unexpected_grantees_or_broader_permissions(self):
  for row in [['postgres','PUBLIC','SELECT',False],['postgres','thaara_app','DELETE',False],['postgres','thaara_app','SELECT',True]]:
   a=catalog();a['grants'].append(row)
   with self.assertRaises(ValueError):m.canonical_catalog(a)
  a=catalog();del a['grants']
  with self.assertRaises(ValueError):m.canonical_catalog(a)
if __name__=='__main__':unittest.main()
