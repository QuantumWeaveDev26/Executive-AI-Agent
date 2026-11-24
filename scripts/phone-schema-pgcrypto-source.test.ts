import fs from 'node:fs';
import {it,expect,vi} from 'vitest';
import {derivePgcryptoSourceDeclarations} from './phone-schema-pgcrypto-source.mjs';
const root='docs/integrations/phone/reference-sources/';
const sql=()=>fs.readFileSync(root+'pgcrypto--1.3.REL_16_15.sql');
const control=()=>fs.readFileSync(root+'pgcrypto.REL_16_15.control');
it('derives all36 declarations from exact upstream SQL/control rather than reference observations',()=>{
 const r=derivePgcryptoSourceDeclarations(sql(),control());expect(r.productionAdmission).toBe(false);expect(r.verified).toBe(false);expect(r.functions).toHaveLength(36);expect(r.extension.version).toBe('1.3');expect(r.extension.library).toBe('$libdir/pgcrypto');
 expect(r.functions.find(f=>f.signature==='digest(text, text)')).toMatchObject({symbol:'pg_digest',result:'bytea',strict:true,volatility:'i',parallel:'s'});
 expect(r.functions.find(f=>f.signature==='gen_random_uuid()')).toMatchObject({symbol:'pg_random_uuid',strict:false,volatility:'v'});
 expect(r.functions.find(f=>f.signature==='pgp_armor_headers(text)')).toMatchObject({symbol:'pgp_armor_headers',result:'SETOF record'});
 expect(r.functions.find(f=>f.signature==='pgp_armor_headers(text)')!.arguments).toMatchObject([{mode:'in',name:null,type:'text'},{mode:'out',name:'key',type:'text'},{mode:'out',name:'value',type:'text'}]);
 expect(r.functions.find(f=>f.signature==='gen_salt(text, integer)')).toBeDefined();
});
it.each(['sql','control','source-tail'])('rejects changed upstream evidence: %s',mode=>{
 const s=mode==='sql'?Buffer.from(sql().toString().replace('pg_digest','different_digest')):mode==='source-tail'?Buffer.concat([sql(),Buffer.from('\nSELECT 1;')]):sql();
 const c=mode==='control'?Buffer.from(control().toString().replace('1.3','9.9')):control();
 expect(()=>derivePgcryptoSourceDeclarations(s,c)).toThrow('PGCRYPTO_SOURCE_DENIED');
});
it('refuses use outside local validation',()=>{vi.stubEnv('NODE_ENV','production');try{expect(()=>derivePgcryptoSourceDeclarations(sql(),control())).toThrow();}finally{vi.unstubAllEnvs();}});
