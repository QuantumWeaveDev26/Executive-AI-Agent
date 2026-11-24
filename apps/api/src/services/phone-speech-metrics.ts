/** Accuracy metrics for the speech test. Word error rate for English/Kanglish, character error rate as well (better for Kannada script). */
export function normalizeSpeech(s:string):string{
 return s.normalize('NFC').toLocaleLowerCase('en-IN').replace(/[\p{P}\p{S}]+/gu,' ').replace(/\s+/g,' ').trim();
}
function distance<T>(a:readonly T[],b:readonly T[]):number{
 let prev=Array.from({length:b.length+1},(_,j)=>j);
 for(let i=1;i<=a.length;i++){
  const cur=[i];
  for(let j=1;j<=b.length;j++)cur[j]=Math.min(prev[j]!+1,cur[j-1]!+1,prev[j-1]!+(a[i-1]===b[j-1]?0:1));
  prev=cur;
 }
 return prev[b.length]!;
}
export function wordErrorRate(expected:string,actual:string){const e=normalizeSpeech(expected).split(' ').filter(Boolean),a=normalizeSpeech(actual).split(' ').filter(Boolean);return e.length?distance(e,a)/e.length:(a.length?1:0);}
export function charErrorRate(expected:string,actual:string){const e=[...normalizeSpeech(expected).replace(/ /g,'')],a=[...normalizeSpeech(actual).replace(/ /g,'')];return e.length?distance(e,a)/e.length:(a.length?1:0);}
