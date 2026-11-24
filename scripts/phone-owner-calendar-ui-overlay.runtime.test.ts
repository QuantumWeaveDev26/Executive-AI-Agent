// Explicit release-evidence check: requires the immutable local UI baseline; no remote operations.
import {it,expect} from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
import {reconcileOwnerCalendarUi} from './phone-owner-calendar-overlay.mjs';
const base='node_modules/.cache/phone-web-current-baseline-20261107/baseline-ui-sources/';
const sources=()=>({app:fs.readFileSync(base+'App.tsx','utf8'),phonePages:fs.readFileSync(base+'PhonePages.tsx','utf8')});
it('adds only owner-approved completed-call appointment review and preserves every other UI line',()=>{
 const input=sources(),result=reconcileOwnerCalendarUi(input);
 for(const name of ['app','phonePages']as const){
  let restored=result.files[name];
  for(const edit of [...result.edits.filter((e:any)=>e.name===name)].reverse()){
   expect(restored.split(edit.after)).toHaveLength(2);restored=restored.replace(edit.after,()=>edit.before);
  }
  expect(restored).toBe(input[name]);
  const parsed=ts.createSourceFile(name+'.tsx',result.files[name],ts.ScriptTarget.ESNext,true,ts.ScriptKind.TSX);
  expect((parsed as any).parseDiagnostics).toEqual([]);
 }
 expect(result.files.phonePages).toContain("ownerIdentity?.role==='owner'&&!c.simulated&&c.state==='completed'");
 expect(result.files.app).toContain('ownerIdentity={{role:auth.membership.role,userId:auth.user.id,workspaceId:auth.workspace.id}}');
 expect(result.whatsappSourceChanged).toBe(false);expect(result.executionAuthorized).toBe(false);
});
it('rejects another shared UI baseline or a partially applied patch',()=>{
 const input=sources();
 expect(()=>reconcileOwnerCalendarUi({...input,app:input.app+'\n'})).toThrow();
 expect(()=>reconcileOwnerCalendarUi(reconcileOwnerCalendarUi(input).files)).toThrow();
});
