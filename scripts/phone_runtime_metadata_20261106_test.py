import importlib.util
import json
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / 'deploy/hostinger-pilot/phone-runtime-metadata-20261106.readonly.py'
spec = importlib.util.spec_from_file_location('phone_metadata', path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class MetadataTests(unittest.TestCase):
    def run_probe(self, facts, identity=None, code=0):
        calls=[]
        def run(args):
            calls.append(args)
            if args[1]=='inspect':
                return 0, identity or ('a'*64+'|sha256:'+'b'*64+'|healthy|thaara-v2-pilot|api')
            return code,json.dumps(facts)
        return m.inspect(run),calls
    def test_fixed_readonly_scope(self):
        r,c=self.run_probe({'status':'verified','appVersion':2,'profileSha256':'c'*64})
        self.assertEqual(r['phoneRuntime']['appVersion'],2)
        self.assertEqual(c[1][:3],['docker','exec','a'*64])
        self.assertEqual(r['providerRequests'],0)
        self.assertFalse(r['changesMade'])
    def test_identity_failure_stops_before_profile(self):
        r,c=self.run_probe({},identity='a'*64+'|sha256:'+'b'*64+'|healthy|unrelated|api')
        self.assertEqual(r['status'],'stopped');self.assertEqual(len(c),1)
    def test_unknown_path_is_not_read(self):
        r,c=self.run_probe({'status':'profile_path_unreviewed'},code=2)
        self.assertEqual(r['phoneRuntime']['status'],'profile_path_unreviewed')
        self.assertIn("path!=='/run/secrets/sarvam_profile'",c[1][-1])
    def test_rejects_unexpected_output_without_exposing_it(self):
        r,_=self.run_probe({'status':'verified','appVersion':7,'apiKey':'synthetic-do-not-disclose'})
        self.assertEqual(r['status'],'stopped');self.assertNotIn('synthetic-do-not-disclose',json.dumps(r))
    def test_rejects_forged_version_and_knowledge(self):
        for facts in [{'status':'verified','appVersion':True,'profileSha256':'c'*64}, {'status':'verified','appVersion':7,'profileSha256':'c'*64,'knowledgeVersion':'unreviewed'}, {'status':'verified','appVersion':7,'profileSha256':'c'*64,'requiredMaxCallLengthMinutes':{'private':'synthetic'}}]:
            self.assertEqual(self.run_probe(facts)[0]['status'],'stopped')
    def test_concurrent_baseline_change_is_rejected(self):
        count=0
        def run(args):
            nonlocal count
            count+=1
            if count==1:return 0,'a'*64+'|sha256:'+'b'*64+'|healthy|thaara-v2-pilot|api'
            if count==2:return 0,json.dumps({'status':'verified','appVersion':7,'profileSha256':'c'*64})
            return 0,'d'*64+'|sha256:'+'e'*64+'|healthy|thaara-v2-pilot|api'
        self.assertEqual(m.inspect(run),{'status':'stopped','category':'live_baseline_changed_during_read'})

if __name__=='__main__':unittest.main()
