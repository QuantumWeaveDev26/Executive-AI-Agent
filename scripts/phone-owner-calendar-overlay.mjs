// Local source reconciliation only. Never imports exported application code or contacts a service.
import {sha} from './phone-chat-overlay.mjs';
export const OWNER_CALENDAR_IMAGE='sha256:44387266137de5747b3bd68a647af0cbbbce9387cd66239dcfcdfb0dd6aab927';
const pins={
 app:'661ddf6e2f77d8357544fb31d60740401093b4a5e6d39f34014bd3b759c1b36a',
 startup:'cbffaddee7dae4918420a2942ea2bcaab5f64a6136b20e13c97ee9c52fa2528d',
 phoneStartup:'7273fc04178102049eae487793dc2b90176987adb4abada521faad73998a5430',
 contracts:'10ab922a56b468843eec0a853bea41de1dd4f60e39006593e50a4127088d8a30'
};
const modulePins=[
 ['apps/api/dist/routes/phone-outbound-appointments.js','/app/apps/api/dist/routes/phone-outbound-appointments.js','ef6ac924d3e051aa2cbf3033f0ac42abd220499de203d34aadd3ed67a210c5b0'],
 ['apps/api/dist/services/phone-outbound-appointments.js','/app/apps/api/dist/services/phone-outbound-appointments.js','fd2709e97e319e78bcc94df9068794048d1317f9cd93ff1b579d5b555d188ef7'],
 ['apps/api/dist/services/phone-appointment-calendar.js','/app/apps/api/dist/services/phone-appointment-calendar.js','916343eed1cda1d3595ec06a358067ab86cbc05e74bf013e199ac4f84d16313f'],
 ['apps/api/dist/services/phone-appointment-owner.js','/app/apps/api/dist/services/phone-appointment-owner.js','6ecd86d87cbb7dca0c94539a075a3233df5f6e75415adb9006abe2494e2e5832'],
 ['packages/contracts/dist/phone-inbound-appointments.js','/app/apps/api/node_modules/@thaara/contracts/dist/phone-inbound-appointments.js','72fa2041d40144ead6a4482738b4af5d6d4eb41237c365abf4b2f06061227104']
];
/** Five additions are mandatory even when the switch is OFF: imports resolve at module loading. */
export function collectOwnerCalendarModules(readArtifact){
 const files=modulePins.map(([source,target,expected])=>{
  const bytes=readArtifact(source);
  if(!Buffer.isBuffer(bytes)||sha(bytes)!==expected)throw Error('owner_calendar_module_hash_mismatch');
  return {source,target,sha256:expected,bytes:Buffer.from(bytes)};
 });
 return {files,runtimeValidationRequired:true,existingRuntimeExports:{
  '@thaara/contracts':['computeCanonicalParameterHash','isPhoneProviderCallId','PhoneCallingSpeechRequestSchema'],
  '@thaara/db':['ApprovalRepository','PlanRepository','PlanStepRepository','PlanStepApprovalBindingRepository','ReceiptRepository'],
  '@thaara/observability':['AppError','ForbiddenError'],
  './services/calendar-mutation-governance.js':['createGovernedCalendarMutation'],
  './services/google-calendar.js':['GOOGLE_CALENDAR_CREATE_EVENT_ACTION','parseStrictRfc3339','validateIanaTimeZone']
 }};
}
/** Shared UI SOURCE candidate only. Exact published-bundle equivalence remains a separate gate. */
export function reconcileOwnerCalendarUi(input){
 const expected={app:'07f64757bc82542297b82ab372dda2289d8b04d7eae8572ef542c5c14bc53c61',phonePages:'d45c11303509e9a79d4f2808f97f8a2c8fbc58a4698d135feb941b9ee2a774f4'};
 if(!input||Object.keys(input).sort().join('|')!=='app|phonePages')throw Error('owner_calendar_ui_scope_mismatch');
 for(const[name,hash]of Object.entries(expected))if(typeof input[name]!=='string'||sha(Buffer.from(input[name]))!==hash)throw Error('owner_calendar_ui_source_mismatch');
 const files={...input},edits=[];
 const replace=(name,before,after)=>{
  if(files[name].split(before).length!==2)throw Error('owner_calendar_ui_context_mismatch');
  files[name]=files[name].replace(before,()=>after);edits.push({name,before,after});
 };
 replace('app',"<PhoneHistoryPage key={'phone-history-' + auth.workspace.id + auth.user.id} />","<PhoneHistoryPage ownerIdentity={{role:auth.membership.role,userId:auth.user.id,workspaceId:auth.workspace.id}} key={'phone-history-' + auth.workspace.id + auth.user.id} />");
 const first="import { useEffect, useState } from 'react';";
 replace('phonePages',first,"import {PhoneAppointmentReview} from './PhoneAppointmentReview';\n"+first);
 replace('phonePages','export interface PhoneHistoryPageProps { initialState?: Partial<PhoneHistoryPageState> }','export interface PhoneHistoryPageProps { initialState?: Partial<PhoneHistoryPageState>; ownerIdentity?:{role:string;userId:string;workspaceId:string} }');
 replace('phonePages','export function PhoneHistoryPage({ initialState }: PhoneHistoryPageProps)','export function PhoneHistoryPage({ initialState, ownerIdentity }: PhoneHistoryPageProps)');
 const report='<p><strong>Report:</strong> {c.report.text}</p>';
 replace('phonePages',report,report+`\n                    {ownerIdentity?.role==='owner'&&!c.simulated&&c.state==='completed'&&c.providerCallId&&/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(c.id)&&<PhoneAppointmentReview id={c.id} direction="outbound" owner={ownerIdentity} customerName={c.draft.recipient.displayName} requestedTime={null} consentConfirmed={false}/>} `);
 return {files,edits,reviewOnly:true,executionAuthorized:false,whatsappSourceChanged:false,publishedBundleEquivalenceVerified:false};
}
export function reconcileOwnerCalendar(receipt){
 if(receipt?.status!=='verified'||receipt.imageId!==OWNER_CALENDAR_IMAGE||receipt.sourceHealthy!==true||receipt.containerId!=='5ef6bf4b4da8e3da5d849650a7dddcbb3a550c5d54d1e79efdfef57973ff8283')throw Error('owner_calendar_baseline_mismatch');
 if(!Array.isArray(receipt.files)||receipt.files.map(f=>f.name).join('|')!==Object.keys(pins).join('|'))throw Error('owner_calendar_file_scope_mismatch');
 const files={},edits=[];
 for(const f of receipt.files){
  const bytes=Buffer.from(f.base64,'base64');
  if(bytes.length!==f.bytes||sha(bytes)!==pins[f.name]||f.sha256!==pins[f.name])throw Error('owner_calendar_source_mismatch');
  files[f.name]=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }
 const replace=(name,before,after)=>{
  if(files[name].split(before).length!==2)throw Error('owner_calendar_context_mismatch:'+name);
  files[name]=files[name].replace(before,()=>after);edits.push({name,before,after});
 };
 const appImports="import { phoneOutboundAppointmentRoutes } from './routes/phone-outbound-appointments.js';\nimport { createOutboundAppointments } from './services/phone-outbound-appointments.js';\n";
 replace('app','export async function buildApp(options = {}) {',appImports+'export async function buildApp(options = {}) {');
 const config='    const config = options.config ?? loadConfig();';
 replace('app',config,config+`\n    if (options.phoneOwnerCalendarReview !== undefined && typeof options.phoneOwnerCalendarReview !== 'boolean')
        throw new Error('Invalid owner Calendar review switch.');
    if (options.phoneOwnerCalendarReview) {
        if (options.phoneCalling?.durableContacts !== true || options.phoneCalling?.durableCalls !== true || options.phoneCalling.calls)
            throw new Error('Owner Calendar review requires the existing durable Phone ledger.');
        if (options.phoneAppointments?.outbound)
            throw new Error('Use one outbound appointment review service.');
        if (config.NODE_ENV !== 'test' && options.googleCalendar?.provider?.mode !== 'live')
            throw new Error('Owner Calendar review requires the existing live Calendar connector.');
    }
    if (options.phoneAppointments && config.NODE_ENV !== 'test')
        throw new Error('Phone appointments are test-only pending production admission.');`);
 const route='        await phoneCallingRoutes(v1, phoneCalling);';
 replace('app',route,route+`\n        if (options.phoneOwnerCalendarReview && callLedger)
            await phoneOutboundAppointmentRoutes(v1, createOutboundAppointments({ db, calls: callLedger, calendar: googleCalendarService, existingOwnerCalendarReview: true }));`);
 const startup='...(phone.phoneCalling?{phoneCalling:phone.phoneCalling}:{}),';
 replace('startup',startup,startup+'...(phone.phoneOwnerCalendarReview?{phoneOwnerCalendarReview:true}:{}),');
 const switchLine="    const durable = env.THAARA_PHONE_DURABLE === 'approved', live = env.THAARA_PHONE_LIVE_CALLING === 'approved';";
 replace('phoneStartup',switchLine,switchLine+"\n    const ownerReview = env.THAARA_PHONE_OWNER_CALENDAR_REVIEW === 'approved';");
 replace('phoneStartup',"return live ? { status: 'refused'","return live || ownerReview ? { status: 'refused'");
 const base='    const base = { durableContacts: true, durableCalls: true };';
 replace('phoneStartup',base,base+'\n    const reviewOptions = ownerReview ? { phoneOwnerCalendarReview: true } : {};');
 replace('phoneStartup',"return { status: 'durable', reasons: [], phoneCalling: base };","return { status: 'durable', reasons: [], phoneCalling: base, ...reviewOptions };");
 replace('phoneStartup',"reasons: runtime.status === 'refused' ? runtime.reasons : [], phoneCalling: base };","reasons: runtime.status === 'refused' ? runtime.reasons : [], phoneCalling: base, ...reviewOptions };");
 replace('phoneStartup','sarvamWebhook: { webhookSecret: runtime.webhookSecret } } } };','sarvamWebhook: { webhookSecret: runtime.webhookSecret } } }, ...reviewOptions };');
 const lastExport="export * from './whatsapp-upload.js';";
 replace('contracts',lastExport,lastExport+"\nexport * from './phone-inbound-appointments.js';");
 return {reviewOnly:true,executionAuthorized:false,featureEnabled:false,webAssetsChanged:false,
  targets:{app:'/app/apps/api/dist/app.js',startup:'/app/apps/api/pilot-start.mjs',phoneStartup:'/app/apps/api/dist/services/phone-pilot-startup.js',contracts:'/app/apps/api/node_modules/@thaara/contracts/dist/index.js'},
  baseImage:OWNER_CALENDAR_IMAGE,baseContainer:receipt.containerId,beforeHashes:{...pins},
  afterHashes:Object.fromEntries(Object.entries(files).map(([name,body])=>[name,sha(Buffer.from(body))])),files,edits};
}
