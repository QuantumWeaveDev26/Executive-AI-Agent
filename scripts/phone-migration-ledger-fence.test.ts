import fs from 'node:fs';
import {it,expect} from 'vitest';
import {sqlStatementEvidence} from './phone-schema-source-evidence.mjs';
const sql=()=>fs.readFileSync('docs/migrations/phone-schema-migrations-write-fence.review.sql');
const statements=()=>sqlStatementEvidence(sql()).statements.map(s=>s.text.replace(/--[^\r\n]*/g,'').trim());
it('removes only ledger mutation rights while preserving SELECT and existing schema',()=>{
 const ss=statements(),revoke=ss.filter(s=>/^REVOKE\b/i.test(s));
 expect(revoke).toEqual(['REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.schema_migrations FROM thaara_app, thaara_worker, PUBLIC RESTRICT;']);
 expect(ss.some(s=>/^(GRANT|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(s))).toBe(false);
 expect(ss[0]).toBe('BEGIN;');expect(ss.at(-1)).toBe('COMMIT;');
});
it('requires separate authorization, exact target/operator and bounded exclusive lock',()=>{
 const text=sql().toString();
 for(const value of ["current_setting('thaara.phone_ledger_write_fence_approved',true)","current_database() IS DISTINCT FROM 'thaara_vps_pilot'","session_user IS DISTINCT FROM 'postgres'",'current_user IS DISTINCT FROM session_user',"SET LOCAL lock_timeout='3s'",'LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE;'])expect(text).toContain(value);
});
it('postchecks inherited and column privileges and PUBLIC rather than trusting REVOKE alone',()=>{
 const text=sql().toString();expect(text).toContain('pg_catalog.has_table_privilege');expect(text).toContain('pg_catalog.has_any_column_privilege');expect(text).toContain('a.grantee=0');
 expect(text.indexOf('pg_catalog.has_table_privilege')).toBeGreaterThan(text.indexOf('REVOKE INSERT'));
 expect(text).toContain("RAISE EXCEPTION 'Migration ledger write fence did not remove application mutation authority'");
});
it('checks SET ROLE paths as well as automatically inherited privileges',()=>{
 const text=sql().toString();expect(text).toContain("pg_catalog.pg_has_role(r.role_name,t.oid,'SET')");
 expect(text).toContain("pg_catalog.has_table_privilege(t.oid,'public.schema_migrations',p.privilege)");
 expect(text).toContain("pg_catalog.has_any_column_privilege(t.oid,'public.schema_migrations',p.privilege)");
});
