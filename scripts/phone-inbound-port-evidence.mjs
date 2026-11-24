// Informational, database-free metadata summary. Never authorizes a connection, fallback or guard change.
function describe(value,expectedPort){
 const result=(shape,entries='none',exactMatch=false)=>Object.freeze({shape,entries,exactMatch});
 try{
  if(value===undefined)return result('absent');if(value===null)return result('null');
  if(typeof value!=='object'||Array.isArray(value))return result('invalid_type');
  const keys=Object.keys(value);if(!keys.length)return result('empty_object');
  if(keys.length!==1||keys[0]!=='5432/tcp')return result('other_keys');
  const entries=value['5432/tcp'];if(entries===null)return result('postgres_null');
  if(!Array.isArray(entries))return result('invalid_entries');if(!entries.length)return result('postgres_empty','zero');
  if(entries.length!==1)return result('postgres_many','many');
  const entry=entries[0];return result('postgres_one','one',!!entry&&typeof entry==='object'&&!Array.isArray(entry)&&entry.HostIp==='127.0.0.1'&&entry.HostPort===String(expectedPort));
 }catch{return result('unreadable');}
}
export function summarizePhoneFixturePorts(requested,actual,expectedPort=15436){
 if(!Number.isSafeInteger(expectedPort)||expectedPort<1||expectedPort>65535)throw Error('PHONE_PORT_EVIDENCE_TARGET_INVALID');
 const request=describe(requested,expectedPort),observed=describe(actual,expectedPort);
 return Object.freeze({status:request.exactMatch&&observed.exactMatch?'matching_metadata':'unconfirmed',requested:request,actual:observed});
}
