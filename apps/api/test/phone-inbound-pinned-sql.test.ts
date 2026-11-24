import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {loadPinnedInboundFixtureSql} from './helpers/phone-inbound-pinned-sql.js';
const names=Array.from({length:12},(_,i)=>String(i+1).padStart(4,'0')+'_synthetic.sql');
function fixture(){
 const files:Record<string,string>={},texts:Record<string,string>={};
 for(const path of [...names.map(n=>'packages/db/src/migrations/'+n),'docs/migrations/112-phone-inbound-events.review.sql','docs/migrations/113-phone-inbound-principals.review.sql']){texts[path]='-- synthetic SQL only '+path;files[path]=createHash('sha256').update(texts[path]!).digest('hex');}
 return {files,texts};
}
it('loads only the exact approved twelve base files and two explicit reviewed SQL snapshots',()=>{
 const f=fixture(),r=loadPinnedInboundFixtureSql(f.files,names,path=>f.texts[path]!);expect(r.base).toHaveLength(12);expect(r.base.map(x=>x.version)).toEqual(names.map(n=>n.slice(0,4)));expect(r.journal).toContain('112-phone');expect(r.principal).toContain('113-phone');
});
it('rejects an added unlisted migration before reading or constructing any engine',()=>{
 const f=fixture();let reads=0;expect(()=>loadPinnedInboundFixtureSql(f.files,[...names,'0013_unreviewed.sql'],path=>{reads++;return f.texts[path]!;})).toThrow();expect(reads).toBe(0);
});
it('rejects missing, renamed, duplicate-version or path-escape migration sets',()=>{
 const f=fixture();expect(()=>loadPinnedInboundFixtureSql(f.files,names.slice(1),p=>f.texts[p]!)).toThrow();
 const altered={...f.files};const old='packages/db/src/migrations/'+names[11];delete altered[old];altered['packages/db/src/migrations/0011_duplicate.sql']='a'.repeat(64);
 expect(()=>loadPinnedInboundFixtureSql(altered,names,p=>f.texts[p]!)).toThrow();
 expect(()=>loadPinnedInboundFixtureSql({...f.files,'packages/db/src/migrations/../escape.sql':'a'.repeat(64)},names,p=>f.texts[p]!)).toThrow();
});
it('rejects changed SQL content and missing dependency pins',()=>{
 const f=fixture();expect(()=>loadPinnedInboundFixtureSql(f.files,names,()=> 'unreviewed replacement')).toThrow();
 delete f.files['docs/migrations/113-phone-inbound-principals.review.sql'];expect(()=>loadPinnedInboundFixtureSql(f.files,names,p=>f.texts[p]!)).toThrow();
});
