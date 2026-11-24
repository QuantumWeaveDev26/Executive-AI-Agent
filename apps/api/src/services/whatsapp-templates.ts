import type { AuthenticatedScope } from '@thaara/db';
import { AppError, ForbiddenError } from '@thaara/observability';
import { isValidWhatsAppTemplateParam, type N8nWhatsAppTemplates, type N8nWhatsAppTemplateDraftRequest } from '@thaara/contracts';
import type { DurableWhatsAppService } from './whatsapp-durable.js';
import { sanitizeWhatsAppText } from './whatsapp.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
type Template = N8nWhatsAppTemplates['templates'][number];
type TemplateButton = NonNullable<Template['buttons']>[number];
export class WhatsAppTemplateError extends Error { constructor(readonly reason: 'not_configured' | 'unavailable' | 'rejected') { super('WhatsApp templates ' + reason); } }
/** Lists templates of the WhatsApp Business Account. Receives only the stored numeric account ID; token stays server-side. */
export interface WhatsAppTemplateProvider { list(businessAccountId: string, signal: AbortSignal): Promise<unknown[]> }

export function createMetaWhatsAppTemplateProvider(options: { accessToken(): string | null; fetch?: typeof fetch }): WhatsAppTemplateProvider {
  const call = options.fetch ?? fetch;
  return {
    async list(businessAccountId, signal) {
      if (!/^[0-9]{6,24}$/.test(businessAccountId)) throw new WhatsAppTemplateError('rejected');
      const token = options.accessToken();
      if (!token) throw new WhatsAppTemplateError('not_configured');
      let res: Response;
      try { res = await call(`${GRAPH}/${businessAccountId}/message_templates?fields=name,language,status,category,components&limit=100`, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, redirect: 'error', signal }); }
      catch { throw new WhatsAppTemplateError('unavailable'); }
      if (res.status === 401 || res.status === 403) throw new WhatsAppTemplateError('not_configured');
      if (res.status !== 200) throw new WhatsAppTemplateError('unavailable');
      const text = await res.text();
      if (text.length > 512 * 1024) throw new WhatsAppTemplateError('rejected');
      let body: { data?: unknown };
      try { body = JSON.parse(text); } catch { throw new WhatsAppTemplateError('unavailable'); }
      if (!Array.isArray(body?.data)) throw new WhatsAppTemplateError('rejected');
      return body.data.slice(0, 100);
    }
  };
}

function analyzePlaceholders(text: string): { count: number; valid: boolean } {
  const found = [...text.matchAll(/\{\{(\d{1,2})\}\}/g)].map(m => Number(m[1]));
  if (!found.length) return { count: 0, valid: true };
  const max = Math.max(...found), set = new Set(found);
  if (found.some(n => n < 1)) return { count: max, valid: false };
  for (let i = 1; i <= max; i++) if (!set.has(i)) return { count: max, valid: false };
  return { count: max, valid: true };
}
const clean = (value: unknown, max: number) => typeof value === 'string' ? sanitizeWhatsAppText(value).slice(0, max) : undefined;
function normalizeButtons(rawButtons: unknown): { buttons?: TemplateButton[]; unsupported?: true } {
  if (!Array.isArray(rawButtons) || !rawButtons.length) return {};
  const buttons: TemplateButton[] = [];
  let unsupported = false;
  for (const b of rawButtons.slice(0, 10)) {
    if (!b || typeof b !== 'object') { unsupported = true; continue; }
    const item = b as Record<string, unknown>;
    const rawType = typeof item.type === 'string' ? item.type : '';
    const type: TemplateButton['type'] = rawType === 'QUICK_REPLY' || rawType === 'URL' || rawType === 'PHONE_NUMBER' ? rawType : 'OTHER';
    const text = clean(item.text, 60) || (type === 'OTHER' && rawType ? clean(rawType, 60) : undefined);
    const dynamicUrl = type === 'URL' && ((typeof item.url === 'string' && /\{\{\d+\}\}/.test(item.url)) || (Array.isArray(item.example) && item.example.length > 0));
    const dynamic = type === 'OTHER' || dynamicUrl;
    if (dynamic) unsupported = true;
    if (text) buttons.push({ type, text, ...(dynamic ? { dynamic: true as const } : {}) });
  }
  return { ...(buttons.length ? { buttons } : {}), ...(unsupported ? { unsupported: true as const } : {}) };
}
/** Provider data is untrusted: keep only bounded, sanitized fields; drop anything malformed. */
export function normalizeWhatsAppTemplates(raw: unknown[]): Template[] {
  const out: Template[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    if (typeof r.name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(r.name) || typeof r.language !== 'string' || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(r.language)) continue;
    const status = typeof r.status === 'string' && ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'].includes(r.status) ? r.status as Template['status'] : null;
    const category = typeof r.category === 'string' && ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(r.category) ? r.category as Template['category'] : null;
    if (!status || !category || !Array.isArray(r.components)) continue;
    const part = (type: string) => (r.components as Array<Record<string, unknown>>).find(c => c && c.type === type);
    const body = clean(part('BODY')?.text, 1024), header = part('HEADER'), headerText = header?.format === 'TEXT' ? clean(header.text, 60) : undefined, footer = clean(part('FOOTER')?.text, 60);
    if (!body) continue;
    const bodyInfo = analyzePlaceholders(body), headerInfo = headerText ? analyzePlaceholders(headerText) : { count: 0, valid: true };
    const buttonInfo = normalizeButtons(part('BUTTONS')?.buttons);
    const invalidPlaceholders = !bodyInfo.valid || !headerInfo.valid || headerInfo.count > 1;
    out.push({ name: r.name, language: r.language, status, category, bodyText: body, bodyParams: bodyInfo.count,
      ...(headerText ? { headerText, headerParams: Math.min(headerInfo.count, 1) } : {}), ...(header && header.format !== 'TEXT' ? { headerMedia: true } : {}), ...(footer ? { footerText: footer } : {}),
      ...(buttonInfo.buttons ? { buttons: buttonInfo.buttons } : {}), ...(buttonInfo.unsupported ? { unsupportedButtons: true } : {}), ...(invalidPlaceholders ? { invalidPlaceholders: true } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
}

/** Owner-scoped template catalog for the connection's own business account. Read-only; sending is a separate approved draft. */
export class WhatsAppTemplateService {
  constructor(private readonly durable: DurableWhatsAppService, private readonly provider?: WhatsAppTemplateProvider) {}
  /** Prepares an approval-ready template draft only for an APPROVED catalog template with the exact variable counts. */
  async prepare(scope: AuthenticatedScope, connectionId: string, request: N8nWhatsAppTemplateDraftRequest) {
    const invalid = (message: string) => new AppError(message, 'WHATSAPP_TEMPLATE_INVALID', 400);
    const catalog = await this.list(scope, connectionId);
    const sameName = catalog.templates.filter(x => x.name === request.name);
    if (!sameName.length) throw invalid('Selected WhatsApp template was not found in the connected Business Account.');
    const t = sameName.find(x => x.language === request.language);
    if (!t) throw invalid('Template language does not match an available language for this template.');
    if (t.status !== 'APPROVED') throw invalid(`Only APPROVED templates can be sent (current Meta status: ${t.status}).`);
    if (t.headerMedia) throw invalid('Templates requiring a media header cannot be sent as text-variable templates.');
    if (t.unsupportedButtons) throw invalid('Templates requiring dynamic button parameters cannot be prepared here.');
    if (t.invalidPlaceholders || t.bodyParams > 20) throw invalid('This template has unsupported variable placeholders and cannot be prepared.');
    const body = request.bodyParams ?? [], header = request.headerParams ?? [];
    if (body.length !== t.bodyParams || header.length !== (t.headerParams ?? 0))
      throw invalid('Fill in every required template variable before preparing the message.');
    if ([...header, ...body].some(p => !isValidWhatsAppTemplateParam(p)))
      throw invalid('Template variables cannot be empty or contain newlines, tabs, or more than 4 consecutive spaces.');
    return this.durable.contentDraft(scope, connectionId, request.recipientId, { template: { name: t.name, language: t.language, ...(body.length ? { bodyParams: body } : {}), ...(header.length ? { headerParams: header } : {}) } });
  }
  async list(scope: AuthenticatedScope, connectionId: string): Promise<N8nWhatsAppTemplates> {
    const account = await this.durable.accountIds(scope, connectionId).catch(error => { throw error instanceof AppError ? error : new ForbiddenError('WhatsApp templates denied.'); });
    if (!this.provider) throw new AppError('WhatsApp templates are not set up.', 'WHATSAPP_TEMPLATES_NOT_CONFIGURED', 503);
    try {
      return { connectionId, templates: normalizeWhatsAppTemplates(await this.provider.list(account.businessAccountId, AbortSignal.timeout(15000))) };
    } catch (error) {
      const reason = error instanceof WhatsAppTemplateError ? error.reason : 'unavailable';
      if (reason === 'not_configured') throw new AppError('WhatsApp templates are not set up.', 'WHATSAPP_TEMPLATES_NOT_CONFIGURED', 503);
      throw new AppError('WhatsApp templates could not be loaded.', 'WHATSAPP_TEMPLATES_UNAVAILABLE', 502);
    }
  }
}
