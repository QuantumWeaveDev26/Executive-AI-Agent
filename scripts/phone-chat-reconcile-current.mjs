import fs from 'node:fs';
import path from 'node:path';
import {prepareOverlay,sha} from './phone-chat-overlay.mjs';

export function prepareCurrentOverlay(baseline,dir,testDir){
 if(baseline.imageId!=='sha256:d19e2e2217e8c41b8ce0eeb677b5585d7968acbd1bea6b37c69639a549d67df9')throw Error('current_baseline_mismatch');
 if(typeof baseline.baseReference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]*:[A-Za-z0-9_.-]+$/.test(baseline.baseReference))throw Error('base_reference_missing');
 const manifest=prepareOverlay(baseline,dir);
 manifest.baseReference=baseline.baseReference;
 manifest.preservedLiveReviewFiles=Object.fromEntries(Object.entries(baseline.reviewFiles).map(([p,f])=>[p,f.sha256]));
 manifest.originalPackageReused=false;
 fs.writeFileSync(path.join(dir,'Dockerfile'),`FROM ${baseline.baseReference}\n`+manifest.changes.map(c=>{
  const rel=c.path.replace('/app/apps/api/dist/','');return `COPY --chown=1000:1000 overlay/${rel} ${c.path}`;
 }).join('\n')+'\n');
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 for(const item of manifest.changes){
  const rel=item.path.replace('/app/apps/api/dist/',''),out=path.join(testDir,rel);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(dir,'overlay',rel),out);
 }
 for(const [rel,item]of Object.entries(baseline.reviewFiles)){
  const body=Buffer.from(item.base64,'base64');if(sha(body)!==item.sha256)throw Error('live_review_source_tampered');
  const out=path.join(testDir,rel);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,body);
 }
 return manifest;
}
