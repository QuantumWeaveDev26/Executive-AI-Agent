"""Database/network-free tests. All container output below is synthetic."""
import base64
import copy
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('release_source', ROOT / 'deploy/hostinger-pilot/phone-release-source-20261107.readonly.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)

class SourceTests(unittest.TestCase):
    def facts(self):
        data = b'// synthetic compiled source; no application data\n'
        return {'status':'verified', 'files':[
            {'name':name, 'path':path, 'bytes':len(data), 'sha256':hashlib.sha256(data).hexdigest(), 'base64':base64.b64encode(data).decode()}
            for name,path in m.FILES.items()]}

    def probe(self, facts=None, first=None, last=None, code=0):
        calls=[]
        identity='a'*64+'|'+m.IMAGE+'|healthy|thaara-v2-pilot|api'
        def run(args):
            calls.append(args)
            if args[1]=='inspect':
                return 0, (first or identity) if len(calls)==1 else (last or identity)
            return code,json.dumps(self.facts() if facts is None else facts)
        return m.inspect(run),calls

    def test_exact_readonly_success(self):
        result,calls=self.probe()
        self.assertEqual(result['status'],'verified')
        self.assertEqual(result['imageId'],m.IMAGE)
        self.assertEqual(len(calls),3)
        self.assertEqual(calls[1][:7],['docker','exec','a'*64,'node','--input-type=module','-e',m.PROBE])
        self.assertFalse(result['changesMade'])
        self.assertEqual(result['providerRequests'],0)

    def test_wrong_image_stops_before_code_read(self):
        result,calls=self.probe(first='a'*64+'|sha256:'+'b'*64+'|healthy|thaara-v2-pilot|api')
        self.assertEqual(result['category'],'source_identity_or_health_mismatch')
        self.assertEqual(len(calls),1)

    def test_unhealthy_or_unrelated_container(self):
        for suffix in ['unhealthy|thaara-v2-pilot|api','healthy|other|api','healthy|thaara-v2-pilot|db']:
            result,calls=self.probe(first='a'*64+'|'+m.IMAGE+'|'+suffix)
            self.assertEqual(result['status'],'stopped');self.assertEqual(len(calls),1)

    def test_changed_baseline_discards_source(self):
        result,_=self.probe(last='b'*64+'|'+m.IMAGE+'|healthy|thaara-v2-pilot|api')
        self.assertEqual(result,{'status':'stopped','category':'live_baseline_changed_during_read'})

    def test_missing_extra_reordered_files_rejected(self):
        for edit in [lambda f:f['files'].pop(),lambda f:f['files'].append(copy.deepcopy(f['files'][0])),lambda f:f['files'].reverse()]:
            facts=self.facts();edit(facts)
            self.assertEqual(self.probe(facts)[0]['category'],'source_output_not_allowlisted')

    def test_wrong_paths_and_tampered_content(self):
        for key,value in [('path','/run/secrets/not-allowed'),('sha256','0'*64),('bytes',True),('bytes',999999),('base64','!bad!')]:
            facts=self.facts();facts['files'][0][key]=value
            result,_=self.probe(facts)
            self.assertEqual(result['category'],'source_output_not_allowlisted')
            self.assertNotIn('/run/secrets',json.dumps(result))

    def test_unexpected_fields_not_disclosed(self):
        facts=self.facts();facts['token']='synthetic-private-value'
        result,_=self.probe(facts)
        self.assertEqual(result['status'],'stopped')
        self.assertNotIn('synthetic-private-value',json.dumps(result))

    def test_failed_read_never_retains_partial_source(self):
        result,_=self.probe(code=2)
        self.assertEqual(result['status'],'stopped');self.assertNotIn('files',result)

    def test_byte_ceiling(self):
        facts=self.facts();data=b'x'*(m.FILE_LIMIT+1)
        facts['files'][0].update(bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),base64=base64.b64encode(data).decode())
        self.assertEqual(self.probe(facts)[0]['status'],'stopped')

    def node_probe(self, mode):
        # Replace only the Node filesystem import. No /app, credentials or network is accessed.
        fixture = r"""
const mode=MODE,raw=Buffer.from('// synthetic source');
let position=0;
const fs={constants:{O_RDONLY:0,O_NOFOLLOW:131072},
 realpathSync(p){if(mode==='redirect'&&p.endsWith('app.js'))return '/run/secrets/forbidden';return p;},
 openSync(p,flags){if(mode==='missing')throw Error('missing');if(flags!==131072)throw Error('nofollow missing');return 7;},
 fstatSync(){position++;return {isFile:()=>mode!=='directory',size:mode==='oversize'?196609:raw.length,
 ino:mode==='changed'?position:1,dev:1,mtimeMs:1,ctimeMs:1};},
 readSync(fd,b,offset,len){raw.copy(b,offset,offset,offset+len);return len;},closeSync(){}};
""".replace('MODE',json.dumps(mode))
        script=m.PROBE.replace("import fs from 'node:fs';",fixture).replace("fileURLToPath(import.meta.resolve('@thaara/contracts'))",json.dumps(m.FILES['contracts']))
        p=subprocess.run(['node','--input-type=module','-e',script],capture_output=True,text=True,timeout=5)
        return p.returncode,json.loads(p.stdout)

    def test_actual_node_probe_with_synthetic_files(self):
        code,facts=self.node_probe('valid')
        self.assertEqual(code,0);self.assertEqual(facts['status'],'verified')
        self.assertEqual(self.probe(facts)[0]['status'],'verified')

    def test_actual_node_probe_rejects_unsafe_files(self):
        for mode in ['redirect','missing','directory','oversize','changed']:
            code,facts=self.node_probe(mode)
            self.assertEqual(code,2);self.assertEqual(facts,{'status':'stopped','category':'compiled_code_unavailable'})

if __name__=='__main__':unittest.main()
