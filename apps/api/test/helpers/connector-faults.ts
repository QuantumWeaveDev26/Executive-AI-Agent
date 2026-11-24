import { MockConnectorKeys } from './durable-connector.js';
import type { VersionedConnectorKeyService,ConnectorKeyVersion } from '../../src/services/connector-key-rotation.js';
// Synthetic KMS: real envelope crypto through the existing mock; lifecycle failures are injected here.
export class FaultInjectedConnectorKeys extends MockConnectorKeys implements VersionedConnectorKeyService {
 activeId='test-key-v1';
 versions=new Map<string,ConnectorKeyVersion>([
  ['test-key-v1',{keyId:'test-key-v1',generation:1,state:'encrypt_decrypt'}],
  ['test-key-v2',{keyId:'test-key-v2',generation:2,state:'encrypt_decrypt'}]
 ]);
 async describeVersion(_binding:unknown,keyId:string){
  const value=this.versions.get(keyId);if(this.fail||!value)throw Error('PRIVATE-MOCK-KMS-FAILURE');return {...value};
 }
 async activeVersion(binding:any){return this.describeVersion(binding,this.activeId);}
 async wrap(key:Buffer,context:string){return this.wrapForVersion(key,context,this.activeId);}
 async wrapForVersion(key:Buffer,context:string,keyId:string){
  await this.beforeWrap?.();
  if(this.fail||this.versions.get(keyId)?.state!=='encrypt_decrypt')throw Error('PRIVATE-MOCK-KMS-FAILURE');
  return new MockConnectorKeys(this.keys,keyId).wrap(key,context);
 }
 async unwrap(input:{keyId:string;wrappedKey:string},context:string){
  await this.beforeUnwrap?.();
  const value=this.versions.get(input.keyId);
  if(this.fail||!value||value.state==='disabled')throw Error('PRIVATE-MOCK-KMS-FAILURE');
  return new MockConnectorKeys(this.keys).unwrap(input,context);
 }
}
export function faultGate(){
 let release!:()=>void,enter!:()=>void;
 const wait=new Promise<void>(r=>{release=r;}),entered=new Promise<void>(r=>{enter=r;});
 return {entered,release,pause:async()=>{enter();await wait;}};
}
