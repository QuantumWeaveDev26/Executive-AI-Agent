"""Read-only refresh mocks; never invoke Docker or SSH."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('refresh',ROOT/'deploy/hostinger-pilot/phone-release-refresh-20261107.readonly.py')
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)

class RefreshTests(unittest.TestCase):
    def test_preserves_reviewed_authentication_and_pins_exact_sources(self):
        first=b" $phase='public_pin_check'";last=b"  $phase='pinned_readonly_ssh'"
        old=(ROOT/'scripts/phone-release-source-20261107.readonly.ps1').read_bytes()
        new=(ROOT/'scripts/phone-release-refresh-20261107.readonly.ps1').read_bytes()
        self.assertEqual(new[new.index(first):new.index(last)],old[old.index(first):old.index(last)])
        manifest=json.loads((ROOT/'docs/integrations/phone/PHONE_RELEASE_REFRESH_20261107.review.json').read_bytes())
        self.assertTrue(manifest['readOnly']);self.assertTrue(manifest['scope']['exportOnlyChangedFiles'])
        self.assertEqual(manifest['scope']['databaseCommands'],0);self.assertEqual(manifest['scope']['providerRequests'],0)
        for a in manifest['artifacts']:self.assertEqual(hashlib.sha256((ROOT/a['path']).read_bytes()).hexdigest(),a['sha256'])

    def facts(self):
        return {'status':'verified','webAssetsVerified':True,'files':[
            {'name':n,'path':p,'bytes':15,'sha256':h,'changed':False}for n,(p,h)in m.FILES.items()]}
    def inspect(self,facts=None,code=0,change=False,health='healthy',storage='true|/run/secrets/profile;'):
        calls=[]
        def run(args):
            calls.append(args)
            if args[1]=='inspect':return 0,'a'*64+'|sha256:'+'b'*64+'|'+health+'|thaara-v2-pilot|api|'+('new-start' if change and len(calls)>1 else 'old-start')+'|'+storage
            return code,json.dumps(facts if facts is not None else self.facts())
        return m.inspect(run),calls
    def test_discovers_actual_image_without_exporting_unchanged_source(self):
        r,c=self.inspect();self.assertEqual(r['imageId'],'sha256:'+'b'*64);self.assertTrue(r['webAssetsVerified'])
        self.assertEqual(c[1][:3],['docker','exec','a'*64]);self.assertEqual(len(c),3)
        self.assertTrue(all(not f['changed'] and 'base64' not in f for f in r['files']))
    def test_exports_only_a_changed_verified_compiled_file(self):
        f=self.facts();b=b'// synthetic replacement'
        f['files'][0].update(changed=True,bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),base64=base64.b64encode(b).decode())
        r,_=self.inspect(f);self.assertEqual(r['status'],'verified');self.assertEqual(sum('base64'in x for x in r['files']),1)
        f['files'][0]['base64']='bad';self.assertEqual(self.inspect(f)[0]['status'],'stopped')
    def test_refuses_unknown_fields_or_source_for_unchanged_file(self):
        f=self.facts();f['files'][0]['base64']='synthetic-private';r,_=self.inspect(f)
        self.assertEqual(r['status'],'stopped');self.assertNotIn('synthetic-private',json.dumps(r))
    def test_discards_changed_live_identity(self):
        self.assertEqual(self.inspect(change=True)[0],{'status':'stopped','category':'live_baseline_changed_during_read'})
    def test_unhealthy_service_stops_before_any_file_read(self):
        r,c=self.inspect(health='unhealthy');self.assertEqual(r['status'],'stopped');self.assertEqual(len(c),1)
    def test_writable_root_or_mounted_app_is_not_an_image_baseline(self):
        for storage in ['false|','true|/app;','true|/app/apps/web/dist;','true|/;']:
            r,c=self.inspect(storage=storage);self.assertEqual(r['category'],'image_file_provenance_denied');self.assertEqual(len(c),1)
    def test_newer_frontend_fails_closed_with_no_code_output(self):
        f={'status':'stopped','category':'public_frontend_mismatch'};r,_=self.inspect(f,2);self.assertEqual(r,f)
    def test_node_probe_checks_web_before_opening_compiled_files(self):
        mock="""const fs={constants:{O_RDONLY:0,O_NOFOLLOW:1},realpathSync:p=>p,openSync(p){if(!p.includes('/apps/web/dist/'))throw Error('unsafe');return 1;},fstatSync(){return {isFile:()=>true,size:1,ino:1,dev:1,mtimeMs:1,ctimeMs:1};},readSync(fd,b){b[0]=120;return 1;},closeSync(){}};"""
        script=m.PROBE.replace("import fs from 'node:fs';",mock)
        r=subprocess.run(['node','--input-type=module','-e',script],capture_output=True,timeout=5)
        self.assertEqual(r.returncode,2);self.assertEqual(json.loads(r.stdout),{'status':'stopped','category':'public_frontend_mismatch'})

if __name__=='__main__':unittest.main()
