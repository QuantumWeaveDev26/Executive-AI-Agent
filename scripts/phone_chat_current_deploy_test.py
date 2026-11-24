"""No Docker, SSH, database or provider access: deploy guard/cleanup fixtures only."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('phone_chat_deploy','deploy/hostinger-pilot/phone-chat-current-deploy.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DeployTests(unittest.TestCase):
    def test_changed_base_stops_before_build_or_write(self):
        body=b'{}';manifest={'protectedHashes':{'compose.json':m.digest(body),'n8n-link-v2.sh':m.digest(body)},'baseContainer':'a'*64,'baseImage':'sha256:'+'b'*64}
        with patch.object(m.os,'geteuid',return_value=0,create=True),patch.object(m,'protected'),patch.object(Path,'read_bytes',return_value=body),patch.object(m,'identity',return_value='a'*64+'|x'),patch.object(m,'api_image',return_value='sha256:'+'c'*64),patch.object(m,'run') as command,patch.object(Path,'write_bytes') as write:
            with self.assertRaisesRegex(RuntimeError,'live_base_changed'):m.deploy(Path('/synthetic'),manifest)
            command.assert_not_called();write.assert_not_called()
    def inventory(self,mutation=None):
        calls=[];image='sha256:'+'b'*64;cid='a'*64;expected=[['fixed','hash']]
        def fake(args,*a,**k):
            calls.append(args)
            if args[1:3]==['image','inspect']: return b'{"/data":{}}' if mutation=='volume' else b'null'
            if args[1]=='create':return cid.encode()
            if args[1]=='inspect' and args[3]=='{{json .Mounts}}':return b'[{"Type":"volume"}]' if mutation=='mount' else b'[]'
            if args[1]=='start':return json.dumps([] if mutation=='content' else expected).encode()
            if args[1]=='inspect':return (cid+'|'+image+'|'+('wrong' if mutation=='ownership' else '20261105')).encode()
            if args[1]=='rm':return b''
            raise AssertionError('unexpected command')
        with patch.object(m,'run',fake),patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'',b'Error: No such object')):
            if mutation:
                with self.assertRaises(RuntimeError):m.inventory(image,expected)
            else:m.inventory(image,expected)
        return calls
    def test_inventory_success_owned_cleanup(self):self.assertTrue(any(c[1]=='rm' for c in self.inventory()))
    def test_changed_inventory_still_cleans_owned_container(self):self.assertTrue(any(c[1]=='rm' for c in self.inventory('content')))
    def test_unexpected_mount_still_cleans_owned_container(self):self.assertTrue(any(c[1]=='rm' for c in self.inventory('mount')))
    def test_unexpected_image_volume_prevents_creation(self):self.assertFalse(any(c[1]=='create' for c in self.inventory('volume')))
    def test_changed_ownership_never_deletes(self):self.assertFalse(any(c[1]=='rm' for c in self.inventory('ownership')))

if __name__=='__main__':unittest.main()
