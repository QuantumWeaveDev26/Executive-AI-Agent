// LOCAL session model only; never executes SET or establishes an actual transaction/search_path.
const deny=()=>{throw Error('SESSION_MODEL_DENIED');};
export function createSourceSessionState(){
 if(process.env.NODE_ENV!=='test')deny();
 let transaction='external-required',localSearchPath=null;
 return {
  apply(tokens,ref){
   if(!Array.isArray(tokens)||!ref||tokens.some(t=>typeof t?.word!=='string'))deny();
   const words=tokens.map(t=>t.word),text=words.join(' ');
   if(text==='begin'){
    const blockers=transaction==='source-begin'?['nested-source-begin']:[];
    if(!blockers.length){transaction='source-begin';localSearchPath=null;}
    return {...ref,kind:'begin',sourceModeled:true,verified:false,blockers};
   }
   if(text==='commit'){transaction='outside';localSearchPath=null;return {...ref,kind:'commit',sourceModeled:true,verified:false,blockers:[]};}
   if(words[0]!=='set'||words[1]!=='local'||words[2]!=='search_path'||!['=','to'].includes(words[3]))deny();
   const tail=words.slice(4);
   if(JSON.stringify(tail)!==JSON.stringify(['pg_catalog'])&&JSON.stringify(tail)!==JSON.stringify(['pg_catalog',',','public',',','pg_temp']))deny();
   const searchPath=tail.filter(w=>w!==','),applies=transaction==='outside'?false:transaction==='external-required'?'conditional':true;
   const conditions=[{...ref,kind:'session-search-path-transaction-context',transactionContext:transaction,verified:false}];
   if(applies!==false)localSearchPath=[...searchPath];
   return {...ref,kind:'local-search-path',sourceModeled:true,verified:false,searchPath,transactionContext:transaction,applies,
    blockers:applies===false?['local-search-path-outside-transaction']:[],conditions};
  },
  snapshot(){return {transaction,localSearchPath:localSearchPath===null?null:[...localSearchPath]};}
 };
}
