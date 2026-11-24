"""Synthetic deployment state only. No Docker, SSH, SQL, credentials or provider access."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('current','deploy/hostinger-pilot/phone-chat-current-activation.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
BASE='sha256:d19e2e2217e8c41b8ce0eeb677b5585d7968acbd1bea6b37c69639a549d67df9'
NEW='sha256:213c9d89b6db4e3cc861f9adc548a629a0092285a9610bd147b56a3fd6bbc4e3'
REF='thaara-v2-whatsapp-enquiries:10831'

class RollbackTests(unittest.TestCase):
    def scenario(self,kind):
        with tempfile.TemporaryDirectory(dir='node_modules/.cache') as tmp:
            root=Path(tmp);pilot=root/'pilot';pilot.mkdir();stage=root/'stage';stage.mkdir()
            original=json.dumps({'services':{'api':{'image':REF,'environment':{'SYNTHETIC':'preserve'}},'other':{'image':'unchanged'}}}).encode()
            (pilot/'compose.json').write_bytes(original);(pilot/'n8n-link-v2.sh').write_bytes(b'synthetic-link')
            dockerfile=('FROM '+REF+'\n').encode();(stage/'Dockerfile').write_bytes(dockerfile)
            manifest={'candidateImage':NEW,'baseImage':BASE,'baseReference':REF,'baseContainer':'a'*64,'baseLayers':['layer0'],
              'protectedHashes':{p.name:m.digest(p.read_bytes()) for p in pilot.iterdir()},
              'otherServices':{'other':'fixed'},'packageFiles':{'Dockerfile':m.digest(dockerfile)},'expectedInventory':[]}
            state={'image':BASE,'switches':[],'builds':0}
            def command(args,*a,**kw):
                if args[:2]==['docker','build']:raise AssertionError('activation must never build')
                if args[:3]==['docker','image','inspect']:
                    if 'RootFS' in args[4]:return json.dumps(['layer0'] if args[-1]==BASE else ['layer0','new']).encode()
                    return (BASE if args[-1] in [BASE,REF] else NEW).encode()
                if args[:2]==['docker','compose']:
                    file=Path(args[args.index('-f')+1]);data=json.loads(file.read_bytes())
                    if 'config' in args:
                        if kind=='config_mismatch' and file.name=='candidate-compose.json':data['services']['other']['image']='unexpected'
                        return json.dumps(data).encode()
                    self.assertEqual(args[-1],'api');self.assertIn('--no-deps',args)
                    state['image']=BASE if data['services']['api']['image']==REF else NEW;state['switches'].append(state['image']);return b'ok'
                if args[0]=='bash':return b'n8n_to_pilot_health=200 forged_callback_status=403 public_watch=12/12 ok n8n_single_network=yes n8n_not_restarted=yes'
                if args[0]=='curl':
                    if kind in ['public_failure','rollback_conflict'] and state['image']==NEW:
                        if kind=='rollback_conflict':(pilot/'compose.json').write_bytes(b'external change')
                        return b'500'
                    return b'401' if args[-1].endswith('/requests') else b'200'
                raise AssertionError('unexpected command')
            with patch.object(m,'PILOT',pilot),patch.object(m.os,'geteuid',return_value=0,create=True),patch.object(m,'protected'),patch.object(m,'identity',side_effect=lambda n:'a'*64+'|'+state['image']+'|start|0' if n==m.API else 'fixed'),patch.object(m,'api_image',side_effect=lambda:state['image']),patch.object(m,'wait_health'),patch.object(m,'inventory'),patch.object(m,'run',command),patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'',b'No such image')),contextlib.redirect_stdout(io.StringIO()):
                error=None;result=None
                try:result=m.deploy(stage,manifest)
                except Exception as exc:error=exc
            return state,(pilot/'compose.json').read_bytes(),original,result,error
    def test_success_changes_only_api_image(self):
        state,body,old,result,error=self.scenario('success');self.assertIsNone(error);self.assertEqual(state['switches'],[NEW]);self.assertEqual(result['status'],'verified')
        a=json.loads(body);b=json.loads(old);a['services']['api']['image']=b['services']['api']['image'];self.assertEqual(a,b)
    def test_health_failure_restores_exact_current_whatsapp_baseline(self):
        state,body,old,_,error=self.scenario('public_failure');self.assertIsNotNone(error);self.assertEqual(state['switches'],[NEW,BASE]);self.assertEqual(body,old);self.assertEqual(state['builds'],0)
    def test_non_image_config_difference_never_switches(self):
        state,body,old,_,error=self.scenario('config_mismatch');self.assertEqual(str(error),'non_image_config_change');self.assertEqual(state['switches'],[]);self.assertEqual(body,old)
    def test_rollback_refuses_to_overwrite_concurrent_config_change(self):
        state,body,_,_,error=self.scenario('rollback_conflict');self.assertEqual(str(error),'rollback_compose_conflict');self.assertEqual(body,b'external change');self.assertEqual(state['switches'],[NEW])

if __name__=='__main__':unittest.main()
