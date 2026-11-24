"""Synthetic build ports only; no Docker, network, SSH or database activity."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('diag','deploy/hostinger-pilot/phone-chat-build-diagnostic.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
BODY=Path('output/THAARA_PHONE_CHAT_NARROW_DEPLOY_2026-11-05.zip').read_bytes()
with zipfile.ZipFile(io.BytesIO(BODY)) as z:FILES={n:z.read(n) for n in z.namelist()}
MANIFEST=json.loads(FILES['manifest.json'])

class BuildTests(unittest.TestCase):
    def execute(self,case='failure'):
        builds=[]
        def read(p):
            return FILES[p.relative_to(m.ROOT).as_posix()]
        expected={f:hashlib.sha256(b'config').hexdigest() for f in MANIFEST['protectedHashes']}
        # Only test configuration hashes are substituted; archive bytes remain hash-pinned.
        def digest(b):
            if b==b'config':return list(MANIFEST['protectedHashes'].values())[0]
            return hashlib.sha256(b).hexdigest()
        def identity(n):
            if n==m.API:return ('0'*64 if case=='baseline' else MANIFEST['baseContainer'])+'|'+m.BASE+'|start|0'
            return MANIFEST['otherServices'][n]
        def readonly(args):
            if args[:3]==['docker','image','inspect']:
                return json.dumps(MANIFEST['baseLayers']) if 'RootFS' in args[4] else m.BASE
            if 'Health' in args[3]:return 'healthy'
            return m.BASE
        def process(args,**kwargs):
            if args[:2]==['docker','build']:
                builds.append(args)
                if case=='timeout':raise subprocess.TimeoutExpired(args,180,stderr=b'private=SYNTHETIC')
                return subprocess.CompletedProcess(args,0 if case=='success' else 1,b'',b'SYNTHETIC_SECRET pull access denied')
            self.assertEqual(args[:3],['docker','image','inspect'])
            return subprocess.CompletedProcess(args,0 if case=='existing' else 1,b'',b'No such image')
        original_sha=m.sha
        def bytes_for_path(p):
            if p.is_relative_to(m.ROOT):return read(p)
            leaf=p.name
            return leaf.encode()
        def hash_for_bytes(b):
            if b in [x.encode() for x in MANIFEST['protectedHashes']]:return MANIFEST['protectedHashes'][b.decode()]
            return original_sha(b)
        response=SimpleNamespace(status=200,__enter__=lambda s:s,__exit__=lambda *a:False)
        from unittest.mock import MagicMock
        url=MagicMock();url.__enter__.return_value.status=200
        with patch.object(m.os,'geteuid',return_value=0,create=True),patch.object(m,'protected'),patch.object(Path,'read_bytes',bytes_for_path),patch.object(m,'sha',hash_for_bytes),patch.object(m,'identity',identity),patch.object(m,'run',readonly),patch.object(m.subprocess,'run',process),patch.object(m.urllib.request,'urlopen',return_value=url):
            result=m.main(base64.b64encode(BODY).decode())
        return result,builds
    def test_one_failure_no_retry_and_safe_error(self):
        r,b=self.execute();self.assertEqual(len(b),1);self.assertFalse(r['buildSucceeded']);self.assertEqual(r['returnCode'],1);self.assertEqual(r['sanitizedError'],['pull access denied']);self.assertNotIn('SYNTHETIC_SECRET',json.dumps(r));self.assertTrue(r['postChecksPassed'])
    def test_changed_baseline_prevents_build(self):r,b=self.execute('baseline');self.assertEqual(b,[]);self.assertEqual(r['category'],'live_baseline_changed')
    def test_existing_tag_prevents_overwrite(self):r,b=self.execute('existing');self.assertEqual(b,[]);self.assertEqual(r['category'],'candidate_tag_exists_or_unverified')
    def test_success_stops_at_image_inspection(self):r,b=self.execute('success');self.assertEqual(len(b),1);self.assertTrue(r['buildSucceeded']);self.assertEqual(r['candidateImage'],m.BASE);self.assertFalse(r['deploymentExecuted'])
    def test_timeout_never_retries(self):r,b=self.execute('timeout');self.assertEqual(len(b),1);self.assertTrue(r['timedOut']);self.assertIsNone(r['returnCode']);self.assertTrue(r['postChecksPassed'])
    def test_wrong_archive_prevents_commands(self):
        with patch.object(m.subprocess,'run') as command:r=m.main(base64.b64encode(b'not approved').decode())
        command.assert_not_called();self.assertEqual(r['category'],'original_zip_mismatch')

if __name__=='__main__':unittest.main()
