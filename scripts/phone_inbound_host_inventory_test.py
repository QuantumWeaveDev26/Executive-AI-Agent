import importlib.util, pathlib, subprocess, unittest
from unittest.mock import patch
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('inventory',root/'deploy/hostinger-pilot/phone-inbound-host-inventory.review.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
cid='a'*64;image='sha256:'+'b'*64
def fake(override=None):
    calls=[]
    def run(args,body=None):
        calls.append((args,body))
        if override:
            result=override(args,body)
            if result is not None:return result
        if args[3]=='image':return image
        if args[3]=='exec':
            import json
            return json.dumps({k:k in ['databaseMatched','postgres16','baseSchemaPresent'] for k in m.CATALOG_KEYS})
        if args[5]=='{{.Id}}':return cid
        return image+'|true|healthy|0|thaara-v2-pilot|postgres'
    return run,calls
class InventoryTests(unittest.TestCase):
    def test_metadata_and_readonly_catalog_only(self):
        run,calls=fake();r=m.inventory(run);self.assertEqual(r['status'],'passed')
        sql=[body for _,body in calls if body][0];self.assertTrue(sql.startswith('BEGIN READ ONLY;'));self.assertIn('COMMIT;',sql)
        self.assertNotRegex(sql,r'(?i)\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|COPY|pg_read_file|pg_ls_dir)\b')
        execs=[a for a,_ in calls if a[3]=='exec'];self.assertEqual(len(execs),1);self.assertEqual(execs[0][5],cid)
        for a,_ in calls:self.assertEqual(a[:3],['/usr/bin/docker','--host','unix:///var/run/docker.sock'])
        self.assertIn('PGPASSFILE=/dev/null',execs[0]);self.assertIn('PGSERVICEFILE=/dev/null',execs[0]);self.assertIn('PGCONNECT_TIMEOUT=5',execs[0]);self.assertIn('/var/run/postgresql',execs[0]);self.assertIn('/usr/local/bin/psql',execs[0]);self.assertIn('SET LOCAL search_path=pg_catalog;',sql)
        self.assertNotIn('containerId',r);self.assertNotIn('imageId',r)
    def test_bad_identity_stops_before_database(self):
        run,calls=fake(lambda a,b:'bad' if a[5]=='{{.Id}}' else None)
        self.assertEqual(m.inventory(run)['phase'],'container_identity');self.assertFalse(any(a[3]=='exec' for a,_ in calls))
    def test_catalog_rejects_unknown_output_without_exposing_it(self):
        run,_=fake(lambda a,b:'{"PRIVATE":"SECRET"}' if b else None);r=m.inventory(run)
        self.assertEqual(r,{'status':'stopped','phase':'readonly_catalog','kind':'validation_failed'})
    def test_timeout_is_finite(self):
        def fail(a,b):raise subprocess.TimeoutExpired('PRIVATE',12)
        run,_=fake(fail);self.assertEqual(m.inventory(run)['kind'],'timeout')
    def test_nonzero_command_is_finite(self):
        def fail(a,b):raise subprocess.CalledProcessError(1,'PRIVATE',stderr='SECRET')
        run,_=fake(fail);self.assertEqual(m.inventory(run),{'status':'stopped','phase':'container_identity','kind':'command_failed'})
    def test_database_mismatch_rejected(self):
        import json
        run,_=fake(lambda a,b:json.dumps({k:False for k in m.CATALOG_KEYS}) if b else None)
        self.assertEqual(m.inventory(run)['phase'],'readonly_catalog')
    def test_identity_rechecked_after_catalog(self):
        seen=0
        def change(a,b):
            nonlocal seen
            if a[3]=='inspect' and a[5]!='{{.Id}}':
                seen+=1
                if seen==2:return 'changed'
        run,_=fake(change);self.assertEqual(m.inventory(run)['phase'],'identity_recheck')
    def test_command_environment_does_not_inherit_remote_docker_or_libpq_variables(self):
        with patch.object(m.subprocess,'run') as run:
            run.return_value.stdout='safe';self.assertEqual(m.command(['synthetic']),'safe')
            self.assertEqual(run.call_args.kwargs['env'],{'PATH':'/usr/bin:/bin','LC_ALL':'C','HOME':'/nonexistent','DOCKER_CONFIG':'/nonexistent'})
if __name__=='__main__':unittest.main()
