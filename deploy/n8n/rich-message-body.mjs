// Step 108.29: Graph API body for template/media messages, built only from Thaara's authorized claim response.
// The same source is embedded as the n8n HTTP Request jsonBody expression (see richMessageExpression()).
export function buildRichMessageBody(j) {
  if (!j || j.authorized !== true || j.dispatchEnabled !== true || !/^\+[1-9][0-9]{7,14}$/.test(j.recipientPhoneNumber ?? '')) throw new Error('Unauthorized claim');
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: j.recipientPhoneNumber.slice(1) };
  if (j.messageType === 'template') {
    const t = j.template ?? {}, components = [];
    if (t.headerParams?.length) components.push({ type: 'header', parameters: t.headerParams.map(text => ({ type: 'text', text })) });
    if (t.bodyParams?.length) components.push({ type: 'body', parameters: t.bodyParams.map(text => ({ type: 'text', text })) });
    return { ...base, type: 'template', template: { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) } };
  }
  if (j.messageType === 'media') {
    const m = j.media ?? {};
    if (!['image', 'document', 'audio'].includes(m.kind) || !/^[0-9]{1,64}$/.test(m.mediaId ?? '')) throw new Error('Invalid media claim');
    return { ...base, ...(j.replyToProviderMessageId ? { context: { message_id: j.replyToProviderMessageId } } : {}), type: m.kind,
      [m.kind]: { id: m.mediaId, ...(m.caption && m.kind !== 'audio' ? { caption: m.caption } : {}), ...(m.filename && m.kind === 'document' ? { filename: m.filename } : {}) } };
  }
  throw new Error('Not a rich message');
}
/** n8n expression form (IIFE over $json); kept in sync with buildRichMessageBody by test. */
export function richMessageExpression() {
  const src = buildRichMessageBody.toString().replace(/^function buildRichMessageBody\(j\) \{/, '(j => {').replace(/\}$/, '})');
  return '={{ (' + src + ')($json) }}';
}
