"""Local package/runner tests. No Docker, SQL, SSH or external requests."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('owner_build',ROOT/'deploy/hostinger-pilot/phone-owner-calendar-build-only-v7-20261107.review.py')
m=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
ZIP=(ROOT/'output/THAARA_PHONE_OWNER_CALENDAR_BUILD_ONLY_V7_2026-11-07.zip').read_bytes()
MANIFEST=ROOT/'docs/integrations/phone/PHONE_OWNER_CALENDAR_BUILD_ONLY_V7_20261107.review.json'
RECEIPT=ROOT/'node_modules/.cache/phone-release-refresh-v6-20261107.result.json'
MOUNTS=['/run/secrets/profile','/tmp/two|three;four']
LIVE_ID='c89cbf73b2937ce9294c7cce66d1d8fa481d46c3eef7e024a12f62e03da8a16f'

class DockerFixture:
    candidate='sha256:'+'b'*64
    layer='sha256:'+'c'*64
    cid='d'*64
    staging='f'*64
    index='/app/apps/api/node_modules/.pnpm/test/node_modules/@thaara/contracts/dist/index.js'
    config='1000:1000|/app/apps/api|null|["node","pilot-start.mjs"]|["docker-entrypoint.sh"]|null'
    def __init__(self,*,mounts=0,wrong_owner=False,fail_build=False,late_commit=False,live_mounts=None,change_before_assembly=False,fail_probe=False):
        self.commands=[];self.owner=None;self.built=False;self.containers={};self.live_calls=0
        self.mounts=mounts;self.wrong_owner=wrong_owner;self.fail_build=fail_build;self.late_commit=late_commit
        self.live_mounts=live_mounts or [MOUNTS];self.change_before_assembly=change_before_assembly;self.fail_probe=fail_probe
    @property
    def exists(self):return bool(self.containers)
    def run(self,args,data=None,timeout=15):
        self.commands.append(args)
        def out(value):return 0,value.encode(),b''
        if args[:2]==['docker','inspect']:
            if args[-1]==m.API:
                idx=min(self.live_calls,len(self.live_mounts)-1);self.live_calls+=1
                image='sha256:'+'9'*64 if (self.change_before_assembly and self.live_calls>=2) else m.BASE
                raw_mounts=self.live_mounts[idx]
                mount_str=raw_mounts if isinstance(raw_mounts,str) else json.dumps(raw_mounts)
                return out(LIVE_ID+'|'+image+'|healthy|thaara-v2-pilot|api|same-start|true|'+mount_str)
            name=args[-1] if args[-1] in self.containers else next((n for n,v in self.containers.items() if v[0]==args[-1]),None)
            if name is None:return 1,b'',b'Error: no such object: '+args[-1].encode()
            cid,image,read_only,state=self.containers[name]
            return out('|'.join([cid,image,'/'+name,'wrong' if self.wrong_owner else self.owner,
                                'none',read_only,str(self.mounts if image==self.candidate else 0),'false','1000:1000','["ALL"]','["no-new-privileges"]','268435456','64',state]))
        if args[:2]==['docker','exec']:
            assert args[2]==LIVE_ID and 'O_NOFOLLOW' in args[-1]
            if self.fail_probe:return 2,b'',b''
            return out(json.dumps({'status':'baseline_verified','index':self.index}))
        if args[:3]==['docker','image','inspect']:
            if len(args)==4 and args[-1] in (m.TAG,self.candidate):return (0,b'present',b'') if self.built else (1,b'',b'No such image')
            fmt=args[4];target=args[-1]
            if 'RootFS.Layers' in fmt:return out(json.dumps([self.layer]+(['sha256:'+'e'*64] if target==self.candidate else [])))
            if fmt==m.IMAGE_CONFIG:return out(self.config)
            if 'Config.Labels' in fmt:return out(self.candidate+'|'+self.owner if target==m.TAG else self.owner)
            return out(self.candidate if target==m.TAG else m.BASE)
        if args[:2]==['docker','create']:
            assert '--pull=never' in args and args[args.index('--network')+1]=='none'
            self.owner=args[args.index('--label')+1].split('=',1)[1]
            name=args[args.index('--name')+1]
            staged='--entrypoint' not in args;cid=self.staging if staged else self.cid
            image=m.BASE if staged else self.candidate
            assert (args[-1]==m.BASE if staged else self.candidate in args)
            self.containers[name]=(cid,image,'false' if staged else 'true','created');return out(cid)
        if args[:2]==['docker','cp']:
            assert args==['docker','cp','-a','-',self.staging+':/']
            with tarfile.open(fileobj=io.BytesIO(data)) as tar:
                members=tar.getmembers();assert len(members)==18
                assert all(f.isfile() and f.uid==1000 and f.gid==1000 and f.name.startswith('app/') for f in members)
                assert self.index[1:] in tar.getnames()
            return out('copied')
        if args[:2]==['docker','commit']:
            assert args==['docker','commit',self.staging,m.TAG]
            if self.late_commit:raise subprocess.TimeoutExpired(args,timeout)
            if self.fail_build:return 23,b'',b'permission denied; private diagnostic marker'
            self.built=True;return out(self.candidate)
        if args[:2]==['docker','start']:
            assert args==['docker','start','-a',self.cid]
            return out(json.dumps({'status':'passed','filesVerified':18,'importsVerified':True,'featureOff':True}))
        if args[:2]==['docker','rm']:
            assert args[:3]==['docker','rm','-f']
            names=[n for n,v in self.containers.items() if v[0]==args[-1]];assert len(names)==1
            del self.containers[names[0]];return out(args[-1])
        if args[:3]==['docker','image','rm']:
            assert args==['docker','image','rm',self.candidate];self.built=False;return out(self.candidate)
        raise AssertionError('unexpected command')

class PackageTests(unittest.TestCase):
    def test_exact_candidate_archive_and_no_execution_authorization(self):
        manifest,files=m.decode_package(ZIP)
        self.assertEqual(len(files),20)
        self.assertEqual(manifest['baseImage'],m.BASE)
        self.assertEqual(manifest['baseContainer'],m.API)
        self.assertFalse(manifest['executionAuthorized'])
        self.assertEqual(len(manifest['installedFiles']),18)
        self.assertEqual(len(manifest['baselineFiles']),9)

    def test_wrong_archive_hash_rejected(self):
        with self.assertRaisesRegex(m.Stop,'package_checksum_mismatch'):
            m.decode_package(ZIP+b'tampered')

    def test_extra_or_traversal_entry_rejected_even_with_matching_outer_hash(self):
        for name in ['../unexpected','unexpected']:
            data=io.BytesIO(ZIP)
            with zipfile.ZipFile(data,'a') as archive:archive.writestr(name,'synthetic')
            with self.assertRaisesRegex(m.Stop,'package_scope_mismatch'):
                m.decode_package(data.getvalue(),hashlib.sha256(data.getvalue()).hexdigest())

    def test_wrong_live_image_stops_before_build_or_probe(self):
        commands=[]
        def run(args,**_):
            commands.append(args)
            return 0,(LIVE_ID+'|sha256:'+'a'*64+'|healthy|thaara-v2-pilot|api|same-start').encode(),b''
        result=m.build_candidate(ZIP,run)
        self.assertEqual(result['category'],'live_baseline_mismatch')
        self.assertEqual(len(commands),1)
        self.assertFalse(result['buildStarted'])

    def test_validation_command_has_no_network_mounts_or_privilege(self):
        args=m.validation_command('owned-test','a'*32,'sha256:'+'b'*64,'// synthetic')
        self.assertEqual(args[:2],['docker','create'])
        self.assertEqual(args[args.index('--network')+1],'none')
        self.assertIn('--read-only',args);self.assertIn('--cap-drop',args)
        self.assertEqual(args[args.index('--user')+1],'1000:1000')
        for forbidden in ['--privileged','--mount','-v','--volume','--env-file','--env']:
            self.assertNotIn(forbidden,args)

    def test_sanitized_docker_failures_do_not_return_private_text(self):
        self.assertEqual(m.sanitize(b'private-token=synthetic; permission denied'),['permission denied'])
        self.assertEqual(m.sanitize(b'private-token=synthetic'),['unrecognized_error_output_suppressed'])

    def test_happy_path_retains_only_candidate_and_cleans_validation_container(self):
        fixture=DockerFixture();result=m.build_candidate(ZIP,fixture.run)
        self.assertEqual(result['status'],'verified');self.assertEqual(result['candidateImage'],fixture.candidate)
        self.assertEqual(result['liveContainer'],LIVE_ID)
        self.assertTrue(result['cleanupVerified']);self.assertTrue(fixture.built);self.assertFalse(fixture.exists)
        self.assertFalse(result['deploymentExecuted']);self.assertEqual(result['databaseCommands'],0)
        self.assertEqual(sum(c[:2]==['docker','commit'] for c in fixture.commands),1)

    def test_bad_mount_stops_before_start_and_cleans_owned_resources(self):
        fixture=DockerFixture(mounts=1);result=m.build_candidate(ZIP,fixture.run)
        self.assertEqual(result['category'],'validation_isolation_mismatch');self.assertTrue(result['cleanupVerified'])
        self.assertFalse(fixture.exists);self.assertFalse(fixture.built)
        self.assertFalse(any(c[:2]==['docker','start'] for c in fixture.commands))

    def test_wrong_owner_never_removes_unverified_resource(self):
        fixture=DockerFixture(wrong_owner=True);result=m.build_candidate(ZIP,fixture.run)
        self.assertEqual(result['category'],'owned_resource_cleanup_unverified');self.assertFalse(result['cleanupVerified'])
        self.assertFalse(any('rm' in c or c[:2]==['docker','start'] for c in fixture.commands))

    def test_cleanup_refuses_replaced_container_id_even_with_matching_owner_label(self):
        fixture=DockerFixture();fixture.name='owned-fixture';fixture.owner='a'*32;fixture.containers[fixture.name]=(fixture.cid,fixture.candidate,'true','created')
        with self.assertRaisesRegex(m.Stop,'validation_cleanup_name_still_exists'):
            m.cleanup_container(fixture.run,fixture.name,fixture.owner,fixture.candidate,'f'*64)
        self.assertFalse(any('rm' in c for c in fixture.commands))

    def test_failed_build_stops_and_reports_only_allowlisted_output(self):
        fixture=DockerFixture(fail_build=True);result=m.build_candidate(ZIP,fixture.run)
        self.assertEqual(result['category'],'candidate_build_failed');self.assertEqual(result['buildReturnCode'],23)
        self.assertEqual(result['buildError'],['permission denied']);self.assertTrue(result['cleanupVerified'])
        self.assertFalse(any(c[:2]==['docker','start'] for c in fixture.commands))

    def test_mutating_timeout_cannot_claim_cleanup_even_if_candidate_is_absent(self):
        fixture=DockerFixture(late_commit=True);result=m.build_candidate(ZIP,fixture.run)
        self.assertEqual(result['category'],'mutating_timeout_cleanup_unverified')
        self.assertFalse(result['cleanupVerified']);self.assertFalse(fixture.exists)
        self.assertFalse(any(c[:2]==['docker','start'] for c in fixture.commands))

    def test_overlay_rejects_redirected_installed_contract_path(self):
        _,files=m.decode_package(ZIP)
        for path in ['/run/secrets/index.js','/app/apps/api/node_modules/../private/dist/index.js']:
            with self.assertRaisesRegex(m.Stop,'installed_contract_path_denied'):m.overlay_archive(files,path)

    def test_renamed_container_id_is_not_mistaken_for_cleanup(self):
        fixture=DockerFixture();fixture.owner='a'*32;fixture.containers['renamed']=(fixture.cid,fixture.candidate,'true','created')
        with self.assertRaisesRegex(m.Stop,'validation_identity_mismatch'):
            m.cleanup_container(fixture.run,'original-name',fixture.owner,fixture.candidate,fixture.cid)
        self.assertTrue(fixture.exists);self.assertFalse(any('rm' in c for c in fixture.commands))

    def test_missing_tag_does_not_prove_known_image_removed(self):
        fixture=DockerFixture();fixture.built=True
        def run(args,**kwargs):
            if args[-1]==m.TAG:return 1,b'',b'No such image'
            return fixture.run(args,**kwargs)
        with self.assertRaisesRegex(m.Stop,'candidate_cleanup_image_still_exists'):
            m.cleanup_failed_image(run,'a'*32,fixture.candidate)
        self.assertTrue(fixture.built)

    def test_v7_zip_and_manifest_match_reconciled_whatsapp_10831_pins(self):
        receipt=json.loads(RECEIPT.read_bytes())
        inner,_=m.decode_package(ZIP)
        self.assertEqual(inner['baseImage'],'sha256:9fb2739d92ba3c5bc38c1c5927b8ef3614da816e03a9dac107497b2b842f652c')
        self.assertEqual(inner['baseContainer'],m.API)
        for entry in receipt['files']:
            self.assertEqual(inner['baselineFiles'][entry['path']],entry['sha256'])
        self.assertEqual(inner['baselineFiles']['/app/apps/api/dist/services/whatsapp-durable.js'],'c03cd80e6967b2a152680c8ab6a99ed4dd01e48c186f9e332e6bcf716612d7fa')
        self.assertEqual(inner['baselineFiles']['/app/apps/api/dist/services/whatsapp-enquiries.js'],'896e2128da8fcc53bc6d92c32c98372a8b7ea884009e88764519e56a123fb67f')
        self.assertEqual(len(inner['baselineFiles']),9)
        manifest=json.loads(MANIFEST.read_bytes())
        self.assertEqual(manifest['requiredImage'],'sha256:9fb2739d92ba3c5bc38c1c5927b8ef3614da816e03a9dac107497b2b842f652c')
        self.assertEqual(manifest['requiredContainer'],m.API)
        self.assertEqual(manifest['packageSha256'],m.ZIP_SHA)
        self.assertTrue(manifest['remoteExecutionAllowed'])
        for artifact in manifest['artifacts']:
            self.assertEqual(hashlib.sha256((ROOT/artifact['path']).read_bytes()).hexdigest(),artifact['sha256'])
        self.assertFalse((ROOT/manifest['scope']['oneRunMarker']).exists())
        self.assertFalse((ROOT/manifest['scope']['resultReceipt']).exists())

    def test_reordered_mount_destinations_pass_across_live_checks(self):
        fixture=DockerFixture(live_mounts=[MOUNTS,list(reversed(MOUNTS)),MOUNTS,list(reversed(MOUNTS)),MOUNTS])
        result=m.build_candidate(ZIP,fixture.run)
        self.assertEqual(result['status'],'verified')
        self.assertTrue(result['cleanupVerified'])

    def test_added_removed_replaced_or_unsafe_mount_destinations_fail_closed(self):
        for changed in [MOUNTS+['/tmp/third'],MOUNTS[:1],['/run/new',MOUNTS[1]]]:
            with self.subTest(changed=changed):
                fixture=DockerFixture(live_mounts=[MOUNTS,changed])
                result=m.build_candidate(ZIP,fixture.run)
                self.assertEqual(result['status'],'stopped')
                self.assertEqual(result['category'],'live_baseline_changed_before_assembly')
                self.assertFalse(result['buildStarted'])
        for invalid in [['/'],['/app'],['/app/module'],['/tmp/../app'],['/tmp//nested'],['relative'],['/tmp/control\n'],[MOUNTS[0],MOUNTS[0]],[7],'not-json']:
            with self.subTest(invalid=invalid):
                fixture=DockerFixture(live_mounts=[invalid])
                result=m.build_candidate(ZIP,fixture.run)
                self.assertEqual(result['status'],'stopped')
                self.assertEqual(result['category'],'live_app_mount_denied')
                self.assertFalse(result['buildStarted'])

    def test_changed_image_or_frontend_before_assembly_stops_before_staging(self):
        fixture=DockerFixture(change_before_assembly=True)
        result=m.build_candidate(ZIP,fixture.run)
        self.assertEqual(result['status'],'stopped')
        self.assertEqual(result['category'],'live_baseline_mismatch')
        self.assertFalse(result['buildStarted'])
        self.assertFalse(any(c[:2]==['docker','create'] for c in fixture.commands))
        probe_fail=DockerFixture(fail_probe=True)
        result2=m.build_candidate(ZIP,probe_fail.run)
        self.assertEqual(result2['status'],'stopped')
        self.assertEqual(result2['category'],'readonly_command_failed')
        self.assertFalse(result2['buildStarted'])
        self.assertFalse(any(c[:2]==['docker','create'] for c in probe_fail.commands))

    def test_v7_launcher_preserves_v2_ssh_identity_and_reviewed_auth_block(self):
        v3=(ROOT/'scripts/phone-owner-calendar-build-only-20261107.review.ps1').read_text(encoding='utf8').replace('\r\n','\n')
        v7=(ROOT/'scripts/phone-owner-calendar-build-only-v7-20261107.review.ps1').read_text(encoding='utf8').replace('\r\n','\n')
        self.assertIn(".codex/credentials/thaara-ai-v2-vps1871828",v7)
        self.assertNotIn("thaara-ai-v5",v7)
        self.assertNotIn("thaara-ai-v6",v7)
        self.assertNotIn("thaara-ai-v7",v7)
        self.assertEqual(v7[v7.index('$pin='):v7.index('$phase=')],v3[v3.index('$pin='):v3.index('$phase=')])
        self.assertEqual(v7[v7.index(" $phase='public_pin_check'"):v7.index("  $receipt=")],v3[v3.index(" $phase='public_pin_check'"):v3.index("  $receipt=")])
        stale_v4=json.loads((ROOT/'docs/integrations/phone/PHONE_OWNER_CALENDAR_BUILD_ONLY_V4_20261107.review.json').read_bytes())
        stale_v6=json.loads((ROOT/'docs/integrations/phone/PHONE_OWNER_CALENDAR_BUILD_ONLY_V6_20261107.review.json').read_bytes())
        self.assertFalse(stale_v4['remoteExecutionAllowed'])
        self.assertFalse(stale_v6['remoteExecutionAllowed'])
        pwsh=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
        if pwsh.exists():
            script=str(ROOT/'scripts/phone-owner-calendar-build-only-v7-20261107.review.ps1')
            review=subprocess.run([str(pwsh),'-NoProfile','-NonInteractive','-File',script,'-ReviewOnly'],capture_output=True,text=True,timeout=15)
            self.assertEqual(review.returncode,0)
            self.assertEqual(json.loads(review.stdout)['mode'],'review_only')
            denied=subprocess.run([str(pwsh),'-NoProfile','-NonInteractive','-File',script,'-ApprovedOwnerCalendarBuildOnly','-ManifestSha256','0'*64],capture_output=True,text=True,timeout=15)
            self.assertEqual(denied.returncode,1)
            self.assertEqual(json.loads(denied.stdout),{'status':'stopped','phase':'review','cleanupVerified':True})
            manifest=json.loads(MANIFEST.read_bytes())
            self.assertFalse((ROOT/manifest['scope']['oneRunMarker']).exists())

if __name__=='__main__':unittest.main()
