import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const sha=b=>createHash('sha256').update(b).digest('hex');
export function reconcilePhoneChat(files){
 const output=structuredClone(files);
 function replace(file,before,after){
  if(output[file].split(before).length!==2)throw Error('baseline_patch_context_mismatch:'+file);
  output[file]=output[file].replace(before,after);
 }
 const route='routes/conversations.js',store='services/phone-calling-store.js',service='services/phone-calling.js',chat='services/chat-phone-calling.js';
 replace(route,'const earlyCalendarIntent = !automationProposal','const explicitPhoneIntent = !automationProposal ? detectPhoneCallingIntent(content) : null;\n            const earlyCalendarIntent = !automationProposal && !explicitPhoneIntent');
 replace(route,'!whatsappReplyOutcome ? detectPhoneCallingIntent(content) : null','!whatsappReplyOutcome ? explicitPhoneIntent : null');
 replace(route,'executeChatPhoneCalling(scope, phoneCallingIntent, phoneCalling)','executeChatPhoneCalling(scope, phoneCallingIntent, phoneCalling, { conversationId })');
 replace(chat,'executeChatPhoneCalling(scope, intent, service)','executeChatPhoneCalling(scope, intent, service, chatContext)');
 replace(chat,'service.prepare(scope, intent)','service.prepare(scope, intent, chatContext)');
 replace(service,'async prepare(scope, input)','async prepare(scope, input, chatContext)');
 replace(service,'this.options.store.createPrepared(scope, structuredClone(draft))','this.options.store.createPrepared(scope, structuredClone(draft), chatContext)');
 replace(store,'createPrepared: (s, draft)','createPrepared: (s, draft, chatContext)');
 replace(store,"'Prepare AI phone call (disabled)', 'Review the recipient, purpose, AI disclosure and language. Approval cannot enable real calling.', { source: 'chat_automation_orchestrator', workflowKind: 'phone_calling', liveCallingEnabled: false }","'Prepare AI phone call', 'Review the recipient, purpose, AI disclosure and language before starting one call.', { source: 'chat_automation_orchestrator', workflowKind: 'phone_calling', liveCallingEnabled: draft.mode === 'live', ...(chatContext ? { conversationId: chatContext.conversationId } : {}) }");
 replace(store,'contactRevision: draft.contactRevision, liveCallingEnabled: false','contactRevision: draft.contactRevision, liveCallingEnabled: draft.mode === \'live\'');
 return output;
}
export function prepareOverlay(baseline,dir){
 if(baseline.status!=='verified'||!/^sha256:[a-f0-9]{64}$/.test(baseline.imageId))throw Error('unverified_baseline');
 const files={};
 for(const [name,file] of Object.entries(baseline.files)){
  const bytes=Buffer.from(file.base64,'base64');if(sha(bytes)!==file.sha256)throw Error('baseline_hash_mismatch');files[name]=bytes.toString('utf8');
 }
 if(Object.keys(files).sort().join('|')!==['routes/conversations.js','services/chat-phone-calling.js','services/phone-calling-store.js','services/phone-calling.js'].sort().join('|'))throw Error('file_scope_mismatch');
 const candidate=reconcilePhoneChat(files),changes=[];
 for(const [name,body] of Object.entries(candidate)){
  const dest=path.join(dir,'overlay',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body);
  changes.push({path:'/app/apps/api/dist/'+name,before:baseline.files[name].sha256,after:sha(Buffer.from(body))});
 }
 const expected=baseline.inventory.map(([name,hash])=>[name,changes.find(x=>x.path===name)?.after??hash]);
 if(changes.some(c=>!baseline.inventory.some(([p,h])=>p===c.path&&h===c.before)))throw Error('inventory_binding_mismatch');
 const manifest={reviewOnly:true,executionAuthorized:false,baseImage:baseline.imageId,baseContainer:baseline.containerId,baseLayers:baseline.layers,protectedHashes:baseline.protectedHashes,otherServices:baseline.otherServices,changes,expectedInventory:expected};
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'Dockerfile'),`FROM ${baseline.imageId}\n`+Object.keys(candidate).map(p=>`COPY --chown=1000:1000 overlay/${p} /app/apps/api/dist/${p}`).join('\n')+'\n');
 return manifest;
}
