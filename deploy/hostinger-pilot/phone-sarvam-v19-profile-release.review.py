"""Bind the outbound profile transaction to the verified V4 pilot operations.

This module has no executable entry point. An owner-approved launcher must pin
the evidence, profile, this module, the transaction and the V4 helpers.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import time


V4_CONTAINER = '3bd3284fbce9ebc9e3deefa274b88ed373fd6d4f043c052af6218aae7a61182c'
PRIVATE = Path('/opt/thaara-v2-pilot-private')
IDENTITY_FORMAT = '{{.Id}}|{{.State.StartedAt}}|{{.RestartCount}}'
PROFILE_MOUNT = ('{{range .Mounts}}{{if eq .Destination "/run/secrets/sarvam_profile"}}'
                 '{{if and (eq .Type "bind") (eq .Source "/opt/thaara-v2-pilot-private/secrets/sarvam_profile") (not .RW)}}'
                 'profile_mount_verified{{end}}{{end}}{{end}}')
PARSER_PROBE = """import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseSarvamRuntimeProfile} from '/app/apps/api/dist/services/phone-sarvam-runtime.js';
const path='/run/secrets/sarvam_profile';
if(process.env.THAARA_SARVAM_PROFILE_FILE!==path)process.exit(2);
const raw=readFileSync(path),loaded=parseSarvamRuntimeProfile(JSON.parse(raw));
if(!loaded.profile)process.exit(2);
console.log(JSON.stringify({version:loaded.profile.appVersion,sha256:createHash('sha256').update(raw).digest('hex')}));"""


def release_profile(candidate, candidate_sha256, evidence_sha256, *, platform, transaction,
                    run=None, private=PRIVATE, sleep=time.sleep, verify_web=None, read_status=None):
    require = platform['require']
    run = run or platform['docker']
    verify_web = verify_web or platform['web_check']
    read_status = read_status or platform['http_status']
    api, image = platform['API'], platform['V4']
    network, alias = platform['NET'], platform['ALIAS']
    pilot = platform['PILOT']
    profile = private / 'secrets/sarvam_profile'
    identity = lambda: platform['api_identity'](run)
    topology = lambda name: platform['topology'](run, name)

    try:
        require(len(candidate) <= 8192 and re.fullmatch(r'[a-f0-9]{64}', evidence_sha256), 'release_pins_denied')
        for folder in (pilot, private, profile.parent, private / 'handoff'):
            platform['protected_directory'](folder)
        env, compose_file = pilot / '.env', pilot / 'compose.json'
        platform['protected'](env)
        platform['protected'](compose_file)
        config_bytes = (env.read_bytes(), compose_file.read_bytes())
        require(config_bytes[0] == platform['ENV_LINE'] + image.encode() + b'\n', 'live_image_pointer_changed')
        source = identity()
        require(source[:3] == [V4_CONTAINER, image, 'healthy'], 'live_api_baseline_changed')
        require(run(['inspect', '--format', PROFILE_MOUNT, source[0]]) == 'profile_mount_verified', 'profile_mount_changed')
        other = {name: run(['inspect', '--format', IDENTITY_FORMAT, name]) for name in platform['OTHER']}
        links = topology(api)
        require(set(links) == {'thaara-v2-pilot-data', 'thaara-v2-pilot-entry', network} and alias in links[network],
                'relay_topology_changed')
        require(set(topology('n8n-n8n-1')) == {network}, 'n8n_topology_changed')
        compose = ['compose', '--project-directory', str(pilot), '--env-file', str(env), '-p', 'thaara-v2-pilot',
                   '-f', str(compose_file), '--profile', 'application']
        child_env = {'PATH': os.defpath, 'LANG': 'C.UTF-8'}
        config = lambda: json.loads(run(compose + ['config', '--format', 'json'], env=child_env))
        rendered = config()
        require(rendered['services']['api']['image'] == image and
                rendered['secrets']['sarvam_profile']['file'] == str(profile), 'profile_config_changed')
        require(json.loads(run(['image', 'inspect', '--format', '{{json .Config.Volumes}}', image])) in (None, {}),
                'refresh_image_volumes_denied')
    except Exception:
        return {'status': 'stopped', 'stage': 'v4_preflight'}

    last_container = source[0]
    recreate_count = 0

    def read_profile():
        info = platform['protected'](profile)
        require(0 < info.st_size <= 8192, 'profile_size_denied')
        fd = os.open(profile, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as stream:
            content = stream.read(8193)
            require(len(content) == info.st_size and os.fstat(stream.fileno()).st_ino == info.st_ino, 'profile_changed_during_read')
        return content

    def backup_profile(content):
        target = private / 'handoff' / ('phone-sarvam-v2-rollback-' + evidence_sha256[:12] + '.json')
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        require(target.read_bytes() == content, 'rollback_backup_unverified')

    def unchanged_shared_state():
        require((env.read_bytes(), compose_file.read_bytes()) == config_bytes and config() == rendered, 'compose_configuration_changed')
        require(all(run(['inspect', '--format', IDENTITY_FORMAT, name]) == expected for name, expected in other.items()),
                'other_service_changed')

    def replace_profile(previous, replacement):
        unchanged_shared_state()
        live = identity()
        require(live[1] == image and (recreate_count or live == source), 'rollback_api_image_changed')
        platform['replace'](profile, previous, replacement)

    def recreate_api():
        nonlocal recreate_count
        unchanged_shared_state()
        require(identity()[1] == image and recreate_count < 2, 'recreate_scope_denied')
        recreate_count += 1
        run(compose + ['up', '-d', '--no-deps', '--pull', 'never', '--no-build', '--force-recreate', 'api'],
            timeout=85, env=child_env)

    def verify_api(expected_hash, version):
        nonlocal last_container
        for _ in range(35):
            try:
                facts = identity()
                if facts[1:3] == [image, 'healthy'] and (recreate_count == 0 or facts[0] != last_container):
                    cid = facts[0]
                    break
            except (platform['Stop'], subprocess.SubprocessError):
                pass
            sleep(2)
        else:
            raise platform['Stop']('api_health_unverified')
        last_container = cid
        require(run(['inspect', '--format', PROFILE_MOUNT, cid]) == 'profile_mount_verified', 'profile_mount_changed')
        observed = json.loads(run(['exec', cid, 'node', '--input-type=module', '-e', PARSER_PROBE]))
        require(observed == {'version': version, 'sha256': expected_hash}, 'mounted_profile_not_verified')
        current = topology(cid)
        if recreate_count and network not in current:
            require(set(current) == set(links) - {network}, 'api_networks_changed')
            run(['network', 'connect', '--alias', alias, network, cid])
        require(topology(cid) == links, 'relay_alias_unverified')
        probe = f"fetch('http://{alias}:3002/api/v1/health',{{signal:AbortSignal.timeout(6000)}}).then(r=>console.log(r.status)).catch(()=>process.exit(1))"
        require(run(['exec', 'n8n-n8n-1', 'node', '-e', probe]) == '200', 'private_relay_unreachable')
        unchanged_shared_state()
        if recreate_count:
            platform['stabilize_public_route'](run, read_status, sleep, rollback=version == 2)
        verify_web()
        require(identity()[:3] == [cid, image, 'healthy'], 'verified_api_changed')

    return transaction(candidate, candidate_sha256, evidence_sha256, read_profile=read_profile,
                       backup_profile=backup_profile, replace_profile=replace_profile, recreate_api=recreate_api,
                       verify_api=verify_api)
