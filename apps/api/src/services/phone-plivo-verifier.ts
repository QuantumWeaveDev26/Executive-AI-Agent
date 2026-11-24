// Deep import of the official SDK's signature module only: the SDK's HTTP client (and its deprecated `request`
// dependency) is never loaded. Pinned to plivo@4.79.0; re-review this file on any SDK upgrade.
import {validateV3Signature} from 'plivo/dist/utils/v3Security.js';
import type {PhoneCallbackVerifier} from './phone-callback-admission.js';
import type {PhoneProviderCredentials} from './phone-plivo.js';

/** Official Plivo V3 signature check. The auth token comes from the managed-secret resolver per request and is never kept. */
export function createPlivoSdkVerifier(credentials:PhoneProviderCredentials,validate:typeof validateV3Signature=validateV3Signature):PhoneCallbackVerifier{
 return async({method,url,nonce,signature,params})=>{
  let token:string;
  try{token=(await credentials.resolve()).authToken;}catch{return false;}
  if(typeof token!=='string'||token.length<16)return false;
  try{return validate(method,url,nonce,token,signature,params)===true;}catch{return false;}
 };
}
