import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {ledgerCommand,verifyLedgerManifest} from './phone-ledger-write-fence.review.mjs';
import {INBOUND_HOSTED_GATE_FIXTURE} from './phone-inbound-runtime-config.mjs';
it('requires its separate one-use mode and exact checksum, never an old F03 approval flag',()=>{
 expect(ledgerCommand(['--prepare-review']).mode).toBe('--prepare-review');
 expect(ledgerCommand(['--approved-isolated-ledger-write-fence','--manifest-sha256','a'.repeat(64)]).pin).toBe('a'.repeat(64));
 for(const args of [[],['--approved-isolated-f03-reference','--manifest-sha256','a'.repeat(64)],['--approved-isolated-ledger-write-fence'],['--preflight-only','--manifest-sha256','bad']])expect(()=>ledgerCommand(args)).toThrow();
});
it('pins only the declared permission correction scope and fails closed on changed input or claimed production authority',()=>{
 const bytes=Buffer.from('synthetic source'),hash=createHash('sha256').update(bytes).digest('hex');
 const manifest={reviewOnly:true,productionAdmission:false,plan:'ledger-write-fence',expectedChecks:4,fixture:INBOUND_HOSTED_GATE_FIXTURE,sqlCandidate:'docs/migrations/phone-schema-migrations-write-fence.review.sql',files:{'source.ts':hash}};
 expect(verifyLedgerManifest(manifest,['source.ts'],()=>bytes)).toBe(true);
 for(const bad of [{...manifest,productionAdmission:true},{...manifest,expectedChecks:9},{...manifest,plan:'f03-reference-capture'},{...manifest,files:{}},{...manifest,sqlCandidate:'other.sql'}])expect(()=>verifyLedgerManifest(bad,['source.ts'],()=>bytes)).toThrow();
 expect(()=>verifyLedgerManifest(manifest,['source.ts'],()=>Buffer.from('changed'))).toThrow();
});
