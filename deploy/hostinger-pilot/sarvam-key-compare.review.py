"""REVIEW ONLY. Read-only check: is the Sarvam key saved on the VPS the same as the owner's local key? (owner approval required, single use)
The local runner sends only a fresh random nonce and HMAC-SHA256(nonce, local key). This script computes the same HMAC over the VPS
key file and prints one Boolean. No key, hash, length or prefix is printed or stored; the nonce is used once and discarded.
No write, no restart, no provider request, no call.
"""
import base64
import hmac
import hashlib
import json
import os
import stat
import sys

KEY_FILE = '/opt/thaara-v2-pilot-private/secrets/sarvam_api_key'


def compare(supplied, read=lambda: open(KEY_FILE, 'rb').read(), info=lambda: os.lstat(KEY_FILE)):
    if not isinstance(supplied, dict) or set(supplied) != {'nonce', 'tag'}:
        raise RuntimeError('input_invalid')
    nonce = base64.b64decode(supplied['nonce'], validate=True)
    tag = bytes.fromhex(supplied['tag'])
    if len(nonce) != 32 or len(tag) != 32:
        raise RuntimeError('input_invalid')
    try:
        details = info()
    except FileNotFoundError:
        raise RuntimeError('key_file_missing') from None
    if not stat.S_ISREG(details.st_mode):
        raise RuntimeError('key_file_unexpected')
    vps = read()
    match = hmac.compare_digest(hmac.new(nonce, vps, hashlib.sha256).digest(), tag)
    del vps
    return match


def main():
    receipt = {'mode': 'sarvam-key-compare', 'status': 'failed', 'readOnly': True, 'fileWrites': 0, 'providerCalls': 0, 'callsPlaced': 0}
    if len(sys.argv) != 2 or sys.argv[1] != '--approved-sarvam-key-compare':
        print(json.dumps({'status': 'review_only', 'providerCalls': 0}))
        return 0
    try:
        if os.getuid() != 0:
            raise RuntimeError('root_required')
        receipt['keysMatch'] = compare(globals().get('KEY_COMPARE'))
        receipt['status'] = 'verified'
    except Exception as error:
        known = {'root_required', 'input_invalid', 'key_file_missing', 'key_file_unexpected'}
        receipt['category'] = str(error) if str(error) in known else 'unclassified_failure'
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt['status'] == 'verified' else 1


if __name__ == '__main__':
    sys.exit(main())
