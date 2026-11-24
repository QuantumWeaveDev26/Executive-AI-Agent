"""Profile replacement and rollback logic for a future approved release runner.

No command-line entry point. The caller must perform the V4 image and relay
preflight, supply the reviewed release pins, and bind the scoped API operations.
"""
import hashlib
import json
import re


V2_SHA256 = '7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447'


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def validate_profiles(previous, candidate, candidate_sha256, evidence_sha256):
    if sha256(previous) != V2_SHA256:
        raise ValueError('v2_rollback_profile_mismatch')
    if not re.fullmatch(r'[a-f0-9]{64}', candidate_sha256) or sha256(candidate) != candidate_sha256:
        raise ValueError('candidate_profile_mismatch')
    if not re.fullmatch(r'[a-f0-9]{64}', evidence_sha256):
        raise ValueError('candidate_evidence_mismatch')

    old = json.loads(previous)
    new = json.loads(candidate)
    unchanged = ('orgId', 'workspaceId', 'appId', 'connectionId', 'agentPhoneNumber', 'variableMapping')
    if any(new[key] != old[key] for key in unchanged):
        raise ValueError('profile_identity_changed')
    binding = new['companyKnowledge']
    if (new['reviewOnly'] is not False or new['runtimeProfile'] is not True or new['appVersion'] != 19 or
            new['requiredMaxCallLengthMinutes'] != 5 or new['verifiedMaxCallLengthMinutes'] != 5 or
            binding['reviewOnly'] is not False or binding['providerAcceptanceVerified'] is not True or
            binding['direction'] != 'outbound' or binding['appVersion'] != 19 or binding['inboundAppVersion'] != 21 or
            binding['maxDurationSeconds'] != 300 or binding['knowledgeVersion'] != 'qw-company-kb-v3-linktree' or
            binding['acceptanceEvidenceSha256'] != evidence_sha256):
        raise ValueError('candidate_not_admitted')


def switch_profile(candidate, candidate_sha256, evidence_sha256, *, read_profile, backup_profile,
                   replace_profile, recreate_api, verify_api):
    """Verify the old state, persist a private rollback, and verify either outcome.

    replace_profile must atomically compare the expected bytes and write the new
    bytes. verify_api must check the exact mounted profile, V4 health, shared
    relay and public route. All callbacks raise on failure.
    """
    stage = 'preflight'
    changed = False
    try:
        previous = read_profile()
        validate_profiles(previous, candidate, candidate_sha256, evidence_sha256)
        verify_api(V2_SHA256, 2)
        stage = 'backup'
        backup_profile(previous)
        stage = 'profile_replace'
        replace_profile(previous, candidate)
        changed = True
        stage = 'api_recreation'
        recreate_api()
        stage = 'postcheck'
        verify_api(candidate_sha256, 19)
        return {'status': 'verified', 'outboundVersion': 19, 'profileSha256': candidate_sha256}
    except Exception:
        if stage == 'profile_replace' and not changed:
            try:
                current = read_profile()
                if current == previous:
                    return {'status': 'stopped', 'stage': stage}
                if current != candidate:
                    return {'status': 'rollback_unverified', 'stage': stage}
                changed = True
            except Exception:
                return {'status': 'rollback_unverified', 'stage': stage}
        if not changed:
            return {'status': 'stopped', 'stage': stage}
        try:
            # The compare-before-write prevents rollback over another release.
            replace_profile(candidate, previous)
            recreate_api()
            verify_api(V2_SHA256, 2)
            return {'status': 'rolled_back', 'stage': stage, 'outboundVersion': 2, 'profileSha256': V2_SHA256}
        except Exception:
            return {'status': 'rollback_unverified', 'stage': stage}
