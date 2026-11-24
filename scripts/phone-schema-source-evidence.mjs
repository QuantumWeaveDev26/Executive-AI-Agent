// Local source evidence only. Lexical boundaries, NOT a SQL semantic compiler or execution adapter.
import {createHash} from 'node:crypto';
const fail=()=>{throw Error('SOURCE_EVIDENCE_DENIED');};
const sha=b=>createHash('sha256').update(b).digest('hex');
export function sqlStatementEvidence(bytes){
 if(process.env.NODE_ENV!=='test')throw Error('Source evidence builder is test-only');
 if(!Buffer.isBuffer(bytes)||bytes.length>2097152)fail();
 const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes)||text.includes('\0'))fail();
 let i=0,start=0,significant=false;const statements=[];
 while(i<text.length){
  if(text.startsWith('--',i)){const end=text.indexOf('\n',i+2);i=end<0?text.length:end+1;continue;}
  if(text.startsWith('/*',i)){
   let depth=1;i+=2;while(i<text.length&&depth){if(text.startsWith('/*',i)){depth++;i+=2;}else if(text.startsWith('*/',i)){depth--;i+=2;}else i++;}if(depth)fail();continue;
  }
  if(text[i]==="'"||text[i]==='"'){
   // Unknown escaped/unicode literal forms are denied rather than mis-tokenized.
   if(/(?:\b[eE]|[uU]&)$/u.test(text.slice(0,i)))fail();
   significant=true;const quote=text[i++];let closed=false;
   while(i<text.length){if(text[i]===quote){if(text[i+1]===quote){i+=2;continue;}i++;closed=true;break;}i++;}if(!closed)fail();continue;
  }
  if(text[i]==='$'){
   const match=text.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/);
   if(match){const end=text.indexOf(match[0],i+match[0].length);if(end<0)fail();significant=true;i=end+match[0].length;continue;}
  }
  if(text[i]===';'){
   if(!significant)fail();i++;
   const body=text.slice(start,i),offset=Buffer.byteLength(text.slice(0,start));
   statements.push({ordinal:statements.length+1,byteOffset:offset,byteLength:Buffer.byteLength(body),sha256:sha(Buffer.from(body)),text:body});
   if(statements.length>4096)fail();start=i;significant=false;continue;
  }
  if(!/\s/u.test(text[i]))significant=true;i++;
 }
 if(significant)fail();
 return {format:'sql-source-evidence-v1',sha256:sha(bytes),statements,trailing:text.slice(start)};
}
