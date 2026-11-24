// Fixture only. Never inspect Docker while an admin pool/session is live.
export function phoneFixturePoolCounts(pool){
 const counts={};
 for(const key of ['totalCount','idleCount','waitingCount'])counts[key]=Number.isSafeInteger(pool?.[key])&&pool[key]>=0&&pool[key]<=100?pool[key]:null;
 return counts;
}

export async function withFreshPhoneFixtureSession({verify,createPool},work){
 verify(); // Fail closed before constructing or connecting a pool.
 const pool=createPool();
 let client,connectionError,result;
 const capture=error=>{connectionError??=error;};
 pool.on('error',capture);
 try{
  client=await pool.connect();client.on('error',capture);
  const query=async(...args)=>{
   if(connectionError)throw connectionError;
   const value=await client.query(...args);
   if(connectionError)throw connectionError;
   return value;
  };
  result=await work({query,exec:async sql=>{await query(sql);}},()=>phoneFixturePoolCounts(pool));
  if(connectionError)throw connectionError;
 }finally{
  // pg-pool removes clients from its list before their end callbacks complete.
  // Await the actual connection close first; pool.end() alone cannot prove it.
  try{await client?.end();}finally{
   // Discard even an aborted transaction; it can never return to another phase.
   try{client?.release(true);}finally{await pool.end();}
  }
 }
 if(connectionError)throw connectionError;
 return result;
}
