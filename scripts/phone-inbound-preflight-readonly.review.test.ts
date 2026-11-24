import {it,expect} from 'vitest';
import {readOnlyPreflightCommand} from './phone-inbound-preflight-readonly.review.mjs';
it('requires the separate exact read-only approval and source hash',()=>{
 expect(readOnlyPreflightCommand(['--approved-readonly-preflight','--manifest-sha256','a'.repeat(64)]).mode).toBe('--approved-readonly-preflight');
 for(const args of [[],['--approved-owned-relay-acceptance','--manifest-sha256','a'.repeat(64)],['--approved-readonly-preflight'],['--approved-readonly-preflight','--manifest-sha256','wrong']])expect(()=>readOnlyPreflightCommand(args)).toThrow();
});
