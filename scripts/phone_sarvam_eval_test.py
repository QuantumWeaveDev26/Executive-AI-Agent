"""Database/provider-free tests for the reviewed VPS evaluation payload."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('payload', ROOT / 'deploy/hostinger-pilot/phone-sarvam-eval.review.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PLAN = json.loads((ROOT / 'docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json').read_text())
SID, MID, CID, RID = ['01K5T8A2MZQ4VE6XCJ0RDBHW7' + str(i) for i in range(4)]

class Guard:
    def __init__(self): self.events=[]; self.used=False
    def claim(self):
        if self.used: raise m.Stop('already_claimed')
        self.used=True; self.events.append('claimed')
    def record(self, data): self.events.append(copy.deepcopy(data))

class Fake:
    def __init__(self): self.calls=[]; self.mutate=lambda phase, data: data
    def __call__(self, method, suffix, body=None):
        self.calls.append((method,suffix,copy.deepcopy(body)))
        if method=='POST' and suffix=='': phase='create'; data={'test_suite_id':SID}
        elif method=='GET' and suffix=='/'+SID:
            phase='suite'; data={'test_suite_id':SID,'test_case_count':1,**copy.deepcopy(PLAN['suiteRequest']['body'])}
            data['test_cases'][0]['test_case_id']=CID
        elif method=='POST' and suffix=='/'+SID+'/mappings': phase='map'; data={'map_id':MID}
        elif method=='GET' and suffix.startswith('/'+SID+'/mappings?'):
            phase='mapping'; data={'map_id':MID,'test_suite_id':SID,**copy.deepcopy(PLAN['mappingBody'])}
        elif method=='POST' and suffix=='/'+SID+'/test-cases/'+CID+'/runs':
            phase='start'; data={'run_id':RID,'test_suite_id':SID,'scope':'test_case','status':'running'}
        elif method=='GET' and suffix=='/'+SID+'/runs/'+RID:
            phase='poll'; data={'run_id':RID,'test_suite_id':SID,'app_id':m.APP,'app_version':6,'scope':'test_case','frequency':1,
                'status':'completed','total_executions':1,'completed_executions':1,'total_pass':1,
                'test_cases':[{'test_case_id':CID,'total_executions':1,'passed':1}]}
        else:
            phase='results'; data={'run_id':RID,'test_case_id':CID,'executions':[{'run_id':RID,'test_suite_id':SID,'test_case_id':CID,
                'frequency_index':0,'transcript':[{'role':'assistant','content':'synthetic test text'}],
                'evaluation_results':[{'name':x['name'],'verdict':'Pass','reasoning':'synthetic'} for x in PLAN['suiteRequest']['body']['test_cases'][0]['expected_behaviors']]}]}
        return self.mutate(phase,data)

class Tests(unittest.TestCase):
    def test_one_exact_run_and_no_telephony(self):
        g,f=Guard(),Fake(); result=m.evaluate(PLAN,f,g,lambda _:None)
        self.assertEqual(len(f.calls),7)
        self.assertEqual(sum(x[0]=='POST' and x[1].endswith('/runs') for x in f.calls),1)
        self.assertFalse(result['providerAcceptanceVerified'])
        self.assertEqual(result['providerJudgePassed'],True)
        self.assertNotIn('synthetic test text',json.dumps(result))
        self.assertEqual(g.events[0],'claimed')
        self.assertTrue(any(x.get('phase')=='before_run' for x in g.events if isinstance(x,dict)))
    def test_replay_stops_before_requests(self):
        g,f=Guard(),Fake();g.claim()
        with self.assertRaises(m.Stop):m.evaluate(PLAN,f,g,lambda _:None)
        self.assertEqual(f.calls,[])
    def test_tampered_plan_rejected_before_guard_or_requests(self):
        for change in [lambda p:p.update(appVersion=2),lambda p:p['mappingBody'].update(app_version=2),lambda p:p['runBody'].update(frequency=2),lambda p:p['suiteRequest']['body']['variables'][0].update(value='other')]:
            p=copy.deepcopy(PLAN);change(p);g,f=Guard(),Fake()
            with self.assertRaises(m.Stop):m.evaluate(p,f,g,lambda _:None)
            self.assertEqual(f.calls,[]); self.assertEqual(g.events,[])
    def test_scope_case_or_mapping_mismatch_never_starts_run(self):
        changes=[('suite',lambda d:d.update(app_id='other')),('suite',lambda d:d.update(test_case_count=2)),
            ('suite',lambda d:d['test_cases'][0].update(variable_overrides=[{'name':'approved_purpose','value':'other'}])),
            ('mapping',lambda d:d.update(app_version=2)),('mapping',lambda d:d['variable_mapping'].update(user_name='approved_purpose'))]
        for phase,change in changes:
            f,g=Fake(),Guard()
            def mutate(p,d):
                if p==phase:change(d)
                return d
            f.mutate=mutate
            with self.assertRaises(m.Stop):m.evaluate(PLAN,f,g,lambda _:None)
            self.assertFalse(any(x[0]=='POST' and x[1].endswith('/runs') for x in f.calls))
    def test_timeout_or_http_failure_never_retries_and_retains_claim(self):
        for phase in ['create','map','start','poll']:
            f,g=Fake(),Guard()
            def mutate(p,d):
                if p==phase:raise m.Stop('network_timeout')
                return d
            f.mutate=mutate
            with self.assertRaises(m.Stop):m.evaluate(PLAN,f,g,lambda _:None)
            self.assertTrue(g.used)
            self.assertLessEqual(sum(x[0]=='POST' and x[1].endswith('/runs') for x in f.calls),1)
    def test_result_wrong_identity_or_duplicate_execution_stops(self):
        for change in [lambda d:d.update(run_id=SID),lambda d:d['executions'].append(copy.deepcopy(d['executions'][0])),lambda d:d['executions'][0].update(test_suite_id=MID)]:
            f=Fake()
            def mutate(p,d):
                if p=='results':change(d)
                return d
            f.mutate=mutate
            with self.assertRaises(m.Stop):m.evaluate(PLAN,f,Guard(),lambda _:None)
    def test_pending_poll_is_bounded(self):
        f=Fake()
        def mutate(p,d):
            if p=='poll':d.update(status='running',completed_executions=0,total_pass=0)
            return d
        f.mutate=mutate
        with self.assertRaises(m.Stop):m.evaluate(PLAN,f,Guard(),lambda _:None)
        self.assertEqual(sum(x[0]=='GET' and x[1].endswith('/runs/'+RID) for x in f.calls),12)
    def test_transport_rejects_arbitrary_paths_and_body_before_network(self):
        t=m.Transport('synthetic-secret',PLAN)
        for method,path,body in [('GET','https://evil.example',None),('POST','/../calls',{}),('POST','',{}),('DELETE','',None),('GET','/'+SID+'/mappings?app_id=other',None)]:
            with self.assertRaises(m.Stop):t(method,path,body)
    def test_secret_metadata_rejects_public_permissions_links_nonregular_wrong_owner(self):
        for mode,uid,links in [(0o100644,1000,1),(0o120400,1000,1),(0o100400,7,1),(0o100400,1000,2)]:
            with self.assertRaises(m.Stop):m.validate_key_metadata(mode,uid,links)
        m.validate_key_metadata(0o100400,1000,1)
    def test_review_mode_does_not_read_key_or_claim(self):
        self.assertEqual(m.main([],None)['status'],'review_only')
        self.assertEqual(m.main(['--execute','synthetic-secret'],None)['category'],'arguments_rejected')
    def test_guard_parent_must_be_root_owned_even_when_private_user_owned_path_is_readable(self):
        with self.assertRaises(m.Stop):m.validate_parent_metadata(0o40700,1000,True)
        m.validate_parent_metadata(0o40700,1000,False)
        m.validate_parent_metadata(0o40700,0,True)
    def test_received_run_id_is_retained_before_unexpected_response_rejection(self):
        f,g=Fake(),Guard()
        def mutate(phase,data):
            if phase=='start':data['scope']='suite'
            return data
        f.mutate=mutate
        with self.assertRaises(m.Stop):m.evaluate(PLAN,f,g,lambda _:None)
        self.assertTrue(any(isinstance(x,dict) and x.get('runId')==RID for x in g.events))
    def test_immediately_completed_queue_response_is_reconciled_without_another_run(self):
        f=Fake()
        def mutate(phase,data):
            if phase=='start':data['status']='completed'
            return data
        f.mutate=mutate
        self.assertTrue(m.evaluate(PLAN,f,Guard(),lambda _:None)['providerJudgePassed'])
        self.assertEqual(sum(method=='POST' and path.endswith('/runs') for method,path,_ in f.calls),1)
    def test_http_errors_and_timeouts_are_sanitized_not_retried(self):
        for error,category in [(urllib.error.HTTPError('https://invalid',401,'synthetic-secret',{},None),'http_401'),(TimeoutError('synthetic-secret'),'network_timeout_or_tls_failure')]:
            t=m.Transport('synthetic-secret',PLAN);t.opener=Mock();t.opener.open.side_effect=error
            with self.assertRaises(m.Stop) as caught:t('POST','',PLAN['suiteRequest']['body'])
            self.assertEqual(str(caught.exception),category);self.assertEqual(t.opener.open.call_count,1)
    def test_redirects_are_refused(self):
        with self.assertRaises(m.Stop):m.NoRedirect().redirect_request(None,None,302,'',{},'https://evil.example')
    def test_revised_scenario_has_five_required_checks_and_missing_knowledge_grade_cannot_pass(self):
        expected=PLAN['suiteRequest']['body']['test_cases'][0]['expected_behaviors']
        self.assertEqual(len(expected),5)
        f=Fake()
        def mutate(phase,data):
            if phase=='results':
                data['executions'][0]['evaluation_results']=[x for x in data['executions'][0]['evaluation_results'] if x['name']!='Knowledge-grounded business answer']
            return data
        f.mutate=mutate
        with self.assertRaises(m.Stop):m.evaluate(PLAN,f,Guard(),lambda _:None)

if __name__=='__main__': unittest.main()
