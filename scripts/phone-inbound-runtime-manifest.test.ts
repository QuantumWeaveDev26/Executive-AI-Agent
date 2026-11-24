import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {verifyInboundExecutionManifest,executionFiles} from './phone-inbound-runtime-manifest.mjs';
import {fileURLToPath} from 'node:url';
import {INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
const files=['synthetic-a','synthetic-b'],read=(p:string)=>Buffer.from(p);
const manifest=()=>({reviewOnly:true,environment:'one-new-isolated-local-postgres16-only',expectedTests:9,fixture:INBOUND_RUNTIME,files:Object.fromEntries(files.map(p=>[p,createHash('sha256').update(read(p)).digest('hex')]))});
it('pins the unchanged transitive Docker metadata collector',()=>{expect(executionFiles(fileURLToPath(new URL('../',import.meta.url)))).toContain('scripts/phone-runtime-guard.mjs');});
it('verifies only the exact reviewed scope and byte snapshots',()=>{expect(()=>verifyInboundExecutionManifest(manifest(),files,read)).not.toThrow();expect(()=>verifyInboundExecutionManifest(manifest(),files,()=>Buffer.from('changed'))).toThrow();});
it('rejects changed targets, extra/missing pins and permissive flags',()=>{
 for(const change of [{expectedTests:8},{reviewOnly:false},{environment:'production'},{fixture:{...INBOUND_RUNTIME,port:5432}},{files:{}},{executionAllowed:true}])expect(()=>verifyInboundExecutionManifest({...manifest(),...change},files,read)).toThrow();
 expect(()=>verifyInboundExecutionManifest({...manifest(),files:{...manifest().files,'../private':'a'.repeat(64)}},files,read)).toThrow();
});
