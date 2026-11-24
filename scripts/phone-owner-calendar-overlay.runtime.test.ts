// Explicit release-evidence check: requires the retained approved source-export fixture; no remote operations.
import {it,expect} from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
import {reconcileOwnerCalendar,collectOwnerCalendarModules,OWNER_CALENDAR_IMAGE} from './phone-owner-calendar-overlay.mjs';
const receipt=()=>JSON.parse(fs.readFileSync('node_modules/.cache/phone-release-source-20261107.result.json','utf8'));
const body=(r:any,name:string)=>Buffer.from(r.files.find((f:any)=>f.name===name).base64,'base64').toString('utf8');
it('pins the complete additional module closure required even while the feature is off',()=>{
 const modules=collectOwnerCalendarModules((p:string)=>fs.readFileSync(p));
 expect(modules.files).toHaveLength(5);
 expect(modules.files.map((f:any)=>f.target)).toContain('/app/apps/api/dist/services/phone-appointment-owner.js');
 expect(modules.files.map((f:any)=>f.target)).toContain('/app/apps/api/node_modules/@thaara/contracts/dist/phone-inbound-appointments.js');
 expect(modules.existingRuntimeExports['./services/calendar-mutation-governance.js']).toEqual(['createGovernedCalendarMutation']);
 expect(modules.runtimeValidationRequired).toBe(true);
});
it('rejects a missing or changed module rather than packaging an incomplete candidate',()=>{
 expect(()=>collectOwnerCalendarModules(()=>{throw Error('missing')})).toThrow();
 expect(()=>collectOwnerCalendarModules(()=>Buffer.from('changed'))).toThrow('owner_calendar_module_hash_mismatch');
});
it('reconciles against the exact verified current image without replacing other application code',()=>{
 const r=receipt(),o=reconcileOwnerCalendar(r);
 expect(o.baseImage).toBe(OWNER_CALENDAR_IMAGE);expect(o.executionAuthorized).toBe(false);
 expect(o.featureEnabled).toBe(false);expect(o.webAssetsChanged).toBe(false);
 const app=o.files.app,original=body(r,'app');
 for(const line of original.split('\n').filter((l:string)=>/whatsapp|WhatsApp|n8n|n8n/i.test(l)))expect(app.split('\n')).toContain(line);
 expect(app).toContain('createOutboundAppointments({ db, calls: callLedger, calendar: googleCalendarService, existingOwnerCalendarReview: true })');
 expect(app).not.toContain('phoneInboundAppointmentRoutes');
 expect(o.files.startup).toContain('...(phone.phoneOwnerCalendarReview?{phoneOwnerCalendarReview:true}:{})');
});
it('rejects a changed image, identity, incomplete export or tampered source',()=>{
 for(const edit of [(r:any)=>r.imageId='sha256:'+'a'.repeat(64),(r:any)=>r.sourceHealthy=false,(r:any)=>r.files.pop(),(r:any)=>r.files[0].base64=Buffer.from('changed').toString('base64')]){
  const r=receipt();edit(r);expect(()=>reconcileOwnerCalendar(r)).toThrow();
 }
});
it('keeps the entire original app/startup/contracts recoverable after removing only declared additions',()=>{
 const r=receipt(),o=reconcileOwnerCalendar(r);
 for(const name of ['app','startup','contracts','phoneStartup']){
  let source=o.files[name];
  for(const edit of [...o.edits.filter((e:any)=>e.name===name)].reverse()){
   expect(source.split(edit.after)).toHaveLength(2);source=source.replace(edit.after,()=>edit.before);
  }
  expect(source).toBe(body(r,name));
 }
});
it('produces the same Phone startup logic as the locally tested implementation',()=>{
 const o=reconcileOwnerCalendar(receipt());
 const parse=(source:string)=>{
  const tree=ts.createSourceFile('startup.js',source,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
  return ts.createPrinter().printFile(tree);
 };
 expect(parse(o.files.phoneStartup)).toBe(parse(fs.readFileSync('apps/api/dist/services/phone-pilot-startup.js','utf8')));
});
it('does not introduce new source syntax errors or activate approval/dialling switches',()=>{
 const o=reconcileOwnerCalendar(receipt());
 for(const [name,source]of Object.entries(o.files)){
  const parsed=ts.createSourceFile(name+'.js',source as string,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
  expect((parsed as any).parseDiagnostics).toEqual([]);
 }
 expect(o.files.phoneStartup).toContain("env.THAARA_PHONE_OWNER_CALENDAR_REVIEW === 'approved'");
 expect(o.files.phoneStartup).not.toMatch(/process\.env\.[A-Z_]+\s*=/);
});
