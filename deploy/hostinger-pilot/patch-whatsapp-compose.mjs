// Pure, exact-match transforms; do not replace the pilot's app/registry with local paused Phone builds.
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw Error('Pilot patch precondition failed; no fallback rewrite');
  return source.replace(needle, () => replacement); // function form: never interpret $', $& or $1 in the injected code
}
export function patchPilotWhatsAppApp(source) {
  if (/PhoneCallingService|PHONE_AI_CALL_ACTION/.test(source)) throw Error('Unexpected paused Phone code in pilot base');
  const call = 'await whatsappDurableInboxRoutes(child, durableWhatsApp);';
  const updated = replaceOnce(source, call, `await whatsappDurableInboxRoutes(child, durableWhatsApp,
    new WhatsAppMediaPreviewService(durableWhatsApp, policyGateway, createWhatsAppMediaPreviewAudit(db), options.whatsappMedia),
    new WhatsAppTemplateService(durableWhatsApp, options.whatsappTemplates),
    new WhatsAppMediaUploadService(durableWhatsApp, createWhatsAppMediaPreviewAudit(db), options.whatsappMediaUpload, Date.now, createWhatsAppUploadAdmission(db, policyGateway)));`);
  return `import { WhatsAppMediaPreviewService, createWhatsAppMediaPreviewAudit } from './services/whatsapp-media-preview.js';
import { WhatsAppTemplateService } from './services/whatsapp-templates.js';
import { WhatsAppMediaUploadService } from './services/whatsapp-media-upload.js';
import { createWhatsAppUploadAdmission } from './services/whatsapp-upload-admission.js';\n` + updated;
}
export function patchPilotWhatsAppRegistry(source) {
  if (/PHONE_AI_CALL_ACTION|PhoneCallingDraftSchema|whatsapp\.media\.preview|whatsapp\.meta\.media\.upload/.test(source) || (source.match(/\bMetaWhatsAppSendInputSchema\b/g) ?? []).length !== 2) throw Error('Unexpected policy registry base');
  const marker = '// Step 108.1: separate Meta test send contract; no runtime transport is registered.';
  const actions = `this.register({metadata:{name:'whatsapp.media.preview',actionClass:'read',risk:'low',approvalMode:'none',idempotencyRequired:false,timeoutMs:20000,retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},requiredRole:'member',auditRequired:true,capabilityScope:'external_connector',schemaIdentifier:'whatsapp.media.preview.v1'},inputSchema:Type.Object({connectionId:Type.String({pattern:'^[a-zA-Z0-9_-]{1,128}$'}),providerMessageId:MetaProviderMessageIdSchema},{additionalProperties:false})});
    this.register({metadata:{name:WHATSAPP_MEDIA_UPLOAD_ACTION,actionClass:'write',risk:'high',approvalMode:'explicit',idempotencyRequired:true,timeoutMs:30000,retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},requiredRole:'member',auditRequired:true,capabilityScope:'external_connector',schemaIdentifier:'whatsapp.meta.media.upload.v1'},inputSchema:WhatsAppUploadIntentSchema});\n    `;
  const updated = replaceOnce(source.replace(/\bMetaWhatsAppSendInputSchema\b/g, 'MetaWhatsAppAnySendInputSchema'), marker, actions + marker);
  return "import { WHATSAPP_MEDIA_UPLOAD_ACTION, WhatsAppUploadIntentSchema, MetaProviderMessageIdSchema } from '@thaara/contracts';\n" + updated;
}
export function patchPilotContractsIndex(source) {
  if (source.includes("./whatsapp-upload.js")) throw Error('Upload contract already exported; inspect drift');
  return source + "\nexport * from './whatsapp-upload.js';\n";
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.slice(2).join(' ') !== '--approved-image-build' || dirname(fileURLToPath(import.meta.url)) !== '/app/apps/api') throw Error('Image-build-only patcher');
  const expected = JSON.parse(fs.readFileSync('/app/apps/api/pilot-compose-base.json', 'utf8'));
  const contracts = fs.realpathSync(fileURLToPath(import.meta.resolve('@thaara/contracts')));
  const policy = fs.realpathSync(join(dirname(fileURLToPath(import.meta.resolve('@thaara/policy'))), 'registry.js'));
  const db = fs.realpathSync(join(dirname(fileURLToPath(import.meta.resolve('@thaara/db'))), 'repositories/whatsapp-postgres.js'));
  for (const path of [contracts, policy, db]) if (!path.startsWith('/app/apps/api/node_modules/') && !path.startsWith('/app/packages/')) throw Error('Unexpected runtime package path');
  const paths = { app: '/app/apps/api/dist/app.js', registry: policy, index: contracts };
  for (const [part, path] of Object.entries(paths)) if (createHash('sha256').update(fs.readFileSync(path)).digest('hex') !== expected.files[part]) throw Error('Pilot module hash drift: ' + part);
  fs.writeFileSync(paths.app, patchPilotWhatsAppApp(fs.readFileSync(paths.app, 'utf8')));
  fs.writeFileSync(paths.registry, patchPilotWhatsAppRegistry(fs.readFileSync(paths.registry, 'utf8')));
  fs.writeFileSync(contracts, patchPilotContractsIndex(fs.readFileSync(contracts, 'utf8')));
  const workspaceIndex = '/app/packages/contracts/dist/index.js';
  // The pilot image holds only overlay copies under /app/packages; the runtime index lives in the installed package.
  if (fs.existsSync(workspaceIndex) && fs.realpathSync(workspaceIndex) !== contracts) fs.writeFileSync(workspaceIndex, patchPilotContractsIndex(fs.readFileSync(workspaceIndex, 'utf8')));
  for (const file of ['meta-whatsapp.js', 'whatsapp-n8n.js', 'whatsapp-upload.js']) {
    const source = '/app/packages/contracts/dist/' + file, target = join(dirname(contracts), file);
    if (source !== target) fs.copyFileSync(source, target);
  }
  const dbSource = '/app/packages/db/dist/repositories/whatsapp-postgres.js';
  if (dbSource !== db) fs.copyFileSync(dbSource, db);
  for (const file of ['/app/apps/api/dist/app.js', '/app/apps/api/dist/routes/conversations.js', policy]) if (/PhoneCallingService|PHONE_AI_CALL_ACTION/.test(fs.readFileSync(file, 'utf8'))) throw Error('Paused Phone code detected');
  console.log('Exact pilot app/registry/index patches and installed package copies verified');
}
