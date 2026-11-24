"""REVIEW ONLY. Read-only diagnostic for the failed live call of 2 Nov 2026, 13:54 IST (separate approval required).
Reads, in one READ ONLY transaction: time, state, dispatch status, sanitized dispatch_code, whether a provider id exists, and event kinds/states.
Never reads numbers, names, purposes, drafts, reports, transcripts, provider ids, keys or tokens. No write, no restart, no call.
"""
import json
import os
import re
import subprocess
import sys

PG = 'thaara-v2-pilot-postgres-1'
QUERY = """WITH target_scope AS (
 SELECT m.workspace_id, m.user_id FROM public.memberships m
 JOIN public.workspaces w ON w.id = m.workspace_id JOIN public.users u ON u.id = m.user_id
 WHERE w.name = 'Thaara Pilot Synthetic 10812' AND u.display_name = 'Pilot Synthetic Owner' AND m.role = 'owner'
)
SELECT coalesce(json_agg(r ORDER BY r.created_ist), '[]'::json) FROM (
 SELECT to_char(c.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS" IST"') AS created_ist,
        c.state, c.dispatch_status, c.dispatch_code, (c.provider_request_id IS NOT NULL) AS has_provider_request_id,
        (SELECT coalesce(json_agg(json_build_object('sequence', e.sequence, 'kind', e.kind, 'state', e.state) ORDER BY e.sequence), '[]'::json)
           FROM public.phone_call_events e WHERE e.workspace_id = c.workspace_id AND e.owner_user_id = c.owner_user_id AND e.call_id = c.call_id) AS events
   FROM public.phone_calls c JOIN target_scope s ON c.workspace_id = s.workspace_id AND c.owner_user_id = s.user_id
  WHERE (SELECT count(*) FROM target_scope) = 1 AND c.mode = 'live'
    AND c.created_at >= timestamptz '2026-11-02 13:54:00+05:30' AND c.created_at < timestamptz '2026-11-02 13:55:00+05:30'
  LIMIT 21
) r;"""
STATES = {'queued', 'ringing', 'answered', 'completed', 'failed', 'cancelled', 'busy', 'no_answer', None}
DISPATCH = {'not_applicable', 'pending', 'claimed', 'unverified', 'failed', 'unknown'}
KINDS = {'state', 'recipient_final', 'interruption'}


def read_rows():
    args = ['docker', 'exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=10000', '--user', 'postgres', PG,
            'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'thaara_vps_pilot', '-c', 'BEGIN READ ONLY; ' + QUERY + ' COMMIT;']
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError('query_failed')
    # json_agg separates rows with line breaks, so the whole output is one JSON value spread over several lines.
    try:
        return json.loads(result.stdout.strip())
    except ValueError:
        raise RuntimeError('output_not_json') from None


def sanitize(rows):
    """Allowlisted fields and values only; anything else stops the diagnostic rather than being printed."""
    if not isinstance(rows, list) or len(rows) > 20:
        raise RuntimeError('unexpected_shape')
    calls = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'created_ist', 'state', 'dispatch_status', 'dispatch_code', 'has_provider_request_id', 'events'}:
            raise RuntimeError('unexpected_fields')
        code = row['dispatch_code']
        if not (re.fullmatch(r'2026-11-02 13:54:[0-5][0-9] IST', str(row['created_ist'])) and row['state'] in STATES - {None}
                and row['dispatch_status'] in DISPATCH and (code is None or re.fullmatch(r'[A-Z0-9_]{1,64}', str(code)))
                and isinstance(row['has_provider_request_id'], bool) and isinstance(row['events'], list) and len(row['events']) <= 100):
            raise RuntimeError('unexpected_call_value')
        events = []
        for event in row['events']:
            if not (isinstance(event, dict) and set(event) == {'sequence', 'kind', 'state'} and isinstance(event['sequence'], int)
                    and event['kind'] in KINDS and event['state'] in STATES):
                raise RuntimeError('unexpected_event_value')
            events.append({'sequence': event['sequence'], 'kind': event['kind'], 'state': event['state']})
        calls.append({'createdIst': row['created_ist'], 'state': row['state'], 'dispatchStatus': row['dispatch_status'], 'dispatchCode': code,
                      'hasProviderRequestId': row['has_provider_request_id'], 'events': events})
    return calls


def main():
    receipt = {'mode': 'phone-call-diagnostic', 'status': 'failed', 'readOnly': True, 'databaseWrites': 0, 'providerCalls': 0, 'callsPlaced': 0}
    if len(sys.argv) != 2 or sys.argv[1] != '--approved-phone-call-diagnostic':
        print(json.dumps({'status': 'review_only', 'providerCalls': 0}))
        return 0
    try:
        if os.getuid() != 0:
            raise RuntimeError('root_required')
        receipt['calls'] = sanitize(read_rows())
        receipt['status'] = 'verified'
    except Exception as error:
        receipt['category'] = str(error) if str(error) in {'root_required', 'query_failed', 'output_not_json', 'unexpected_shape', 'unexpected_fields', 'unexpected_call_value', 'unexpected_event_value'} else 'unclassified_failure'
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt['status'] == 'verified' else 1


if __name__ == '__main__':
    sys.exit(main())
