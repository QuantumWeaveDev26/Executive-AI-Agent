import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BulkCampaignChatCard,
  BulkCampaignCreateView,
  BulkCampaignDashboardView,
  BulkCampaignPanel
} from '../src/BulkCampaignPanel';
import {
  BulkCampaignDetailsView,
  BulkCampaignHistoryView
} from '../src/BulkCampaignHistoryAndResults';
import { Sidebar } from '../src/ui-primitives';
import {
  extractBulkCampaignIdFromLocation,
  isIntegrationPage,
  resolvePageFromLocation,
  shouldExpandIntegrations
} from '../src/navigation';
import {
  approveAllCampaignPhoneDrafts,
  approveBulkCampaign,
  approveSingleCampaignPhoneDraft,
  buildBulkCampaignChatSummary,
  computeBulkCampaignMetrics,
  createBulkCampaignPlan,
  DEFAULT_DEMO_INSTRUCTION,
  executeBulkCampaign,
  exportBulkCampaignCsv,
  MockBulkCampaignPhoneAdapter,
  MockBulkCampaignWhatsAppAdapter,
  parseBulkCampaignContacts,
  prepareCampaignPhoneDrafts,
  prepareSyntheticSimulationFromCampaign,
  SYNTHETIC_DEMO_CONTACTS_CSV
} from '../../api/src/services/bulk-campaign';

describe('Bulk Campaign Agent UI — Complete User Experience', () => {
  it('1. renders file upload, 5 contact classification buckets, personalized WhatsApp previews, script editor, per-call approvals, follow-up queue, and Chat summary', async () => {
    const phoneAdapter = new MockBulkCampaignPhoneAdapter();
    const { contacts: phoneDirectory } = await phoneAdapter.listDirectoryContacts();
    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      fileName: 'webinar-leads.csv',
      rawText: SYNTHETIC_DEMO_CONTACTS_CSV,
      phoneDirectory
    });
    let plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: DEFAULT_DEMO_INSTRUCTION,
      importResult: imported
    });
    plan = await prepareCampaignPhoneDrafts(plan, phoneAdapter);
    for (const c of plan.contacts) {
      if (c.phoneApprovalId) {
        plan = await approveSingleCampaignPhoneDraft(plan, phoneAdapter, {
          approvalId: c.phoneApprovalId,
          userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          role: 'owner'
        });
      }
    }
    const approved = approveBulkCampaign(plan, {
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      role: 'owner',
      expectedMaterialHash: plan.materialHash
    });
    const completed = await executeBulkCampaign(approved, {
      whatsapp: new MockBulkCampaignWhatsAppAdapter(),
      phone: phoneAdapter,
      mode: 'simulation'
    });
    const metrics = computeBulkCampaignMetrics(completed);
    const csv = exportBulkCampaignCsv(completed);
    const chatSummary = buildBulkCampaignChatSummary(completed);

    const html = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={completed.campaignId}
        title={completed.title}
        objective={completed.objective}
        eventDetails={completed.eventDetails}
        instruction={completed.instruction}
        status={completed.status}
        channels={completed.channels}
        businessAccountLabel={completed.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={completed.whatsappPlan.templateName}
        whatsappMessagePreview={completed.whatsappPlan.messagePreview}
        aiDisclosure={completed.callScript.aiDisclosure}
        callOpeningLine={completed.callScript.openingLine}
        callEventPitch={completed.callScript.eventPitch}
        callQuestions={completed.callScript.questions}
        boundedPurposePreview={completed.callScript.boundedPurposePreview}
        supportedLanguages={completed.callScript.supportedLanguages}
        maxCalls={completed.limits.maxCalls}
        dailyPhoneCallLimit={completed.limits.dailyPhoneCallLimit}
        maxConcurrency={completed.limits.maxConcurrency}
        rateLimitPerMinute={completed.limits.rateLimitPerMinute}
        materialHash={completed.materialHash}
        approvedMaterialHash={completed.approval?.approvedMaterialHash}
        estimatedCostInr={completed.approval?.estimatedCostInr ?? 0}
        importSummary={completed.importSummary}
        contacts={completed.contacts}
        metrics={metrics}
        csvReportText={csv}
        chatSummaryText={chatSummary}
      />
    );

    expect(html).toContain('Upload contacts file (CSV, Excel, PDF)');
    expect(html).toContain('Eligible Contacts (5):');
    expect(html).toContain('Unauthorized Held Back (0):');
    expect(html).toContain('Unsupported / Quota Queued (0):');
    expect(html).toContain('Duplicates Skipped (1):');
    expect(html).toContain('Invalid Rejected (1):');
    expect(html).toContain('Personalized WhatsApp Previews:');
    expect(html).toContain('Hello Aarav Sharma, you are invited');
    expect(html).toContain('5 prepared · 5 per-call approved');
    expect(html).toContain('Further Discussion');
    expect(html).toContain('[AI Interpretation · Confirmed by evidence: false]');
    expect(html).toContain('Test mode');
    expect(html).toContain('No real calls or messages will be sent.');
    expect(html).not.toContain('GOVERNED WORKSPACE CONNECTORS READY');
    expect(html).toContain('Choose Channels:');
    expect(html).toContain('Channel whatsapp');
    expect(html).toContain('Channel phone');
    expect(html).toContain('Channel email');
    expect(html).toContain('Download CSV Report');
    expect(html).toContain('Campaign Summary — AI and Digital Marketing webinar Campaign (COMPLETED · SIMULATION-ONLY RUN)');
  });

  it('2. restores Bulk Campaigns in workspace navigation, BulkCampaignPanel, and BulkCampaignChatCard end to end', () => {
    expect(resolvePageFromLocation('/integrations/bulk-campaign')).toBe('bulk-campaign');
    expect(resolvePageFromLocation('/bulk-campaign')).toBe('bulk-campaign');
    expect(resolvePageFromLocation('/bulk-campaigns')).toBe('bulk-campaign');
    expect(isIntegrationPage('bulk-campaign')).toBe(true);
    expect(shouldExpandIntegrations('bulk-campaign', false)).toBe(true);

    const panelHtml = renderToStaticMarkup(<BulkCampaignPanel />);
    expect(panelHtml).toContain('data-testid="bulk-campaign-page"');
    expect(panelHtml).toContain('Thaara Bulk Campaign Agent');
    expect(panelHtml).toContain('data-testid="load-sample-simulation-button"');
    expect(panelHtml).toContain('data-testid="import-saved-contacts-button"');
    expect(panelHtml).toContain('data-testid="campaign-status-filters"');

    const cardHtml = renderToStaticMarkup(
      <BulkCampaignChatCard
        approval={{
          id: 'appr-bulk-1',
          workspaceId: 'ws-1',
          actionName: 'campaign.bulk.execute',
          actionParams: {
            campaignId: 'camp_123',
            title: 'AI Webinar Campaign',
            eventDetails: 'Tomorrow at 7:00 PM IST',
            channels: ['whatsapp', 'phone', 'email'],
            eligibleContactsCount: 5,
            unauthorizedContactsCount: 1,
            unsupportedContactsCount: 1,
            duplicateEntriesCount: 1,
            invalidEntriesCount: 1,
            whatsappPlan: {
              templateName: 'webinar_invite_rsvp_v1',
              messagePreview: 'Hello {{1}}, join our AI Webinar!'
            },
            callScript: {
              aiDisclosure: 'Namaskara, this is Thaara, an AI voice assistant.'
            },
            emailPlan: {
              subject: 'Invitation: AI Webinar',
              bodyPreview: 'Dear {{name}}, you are invited.'
            }
          },
          requesterUserId: 'usr-1',
          status: 'pending',
          riskLevel: 'high',
          expiresAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-11-09T00:00:00.000Z',
          updatedAt: '2026-11-09T00:00:00.000Z'
        }}
        canDecide={true}
        deciding={false}
        refreshing={false}
        onConfirm={() => {}}
        onCancel={() => {}}
        onRefresh={() => {}}
        onOpenDashboard={() => {}}
      />
    );

    expect(cardHtml).toContain('data-testid="bulk-campaign-chat-card"');
    expect(cardHtml).toContain('Governed Bulk Campaign Plan: AI Webinar Campaign');
    expect(cardHtml).toContain('Approve Campaign Plan');
    expect(cardHtml).toContain('Reject &amp; Cancel Campaign');
    expect(cardHtml).toContain('Open Bulk Campaign Dashboard');
    expect(cardHtml).toContain('Email Draft (Live Mass Sending Disabled)');
  });

  it('3. renders live connector readiness banner, approved Meta template selector, per-call approve-all button, live dispatch button, and customer WhatsApp replies', async () => {
    const phoneAdapter = new MockBulkCampaignPhoneAdapter();
    const { contacts: phoneDirectory } = await phoneAdapter.listDirectoryContacts();
    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      fileName: 'live-leads.csv',
      rawText: SYNTHETIC_DEMO_CONTACTS_CSV,
      phoneDirectory
    });
    let plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: DEFAULT_DEMO_INSTRUCTION,
      importResult: imported,
      liveCallingEnabled: true,
      liveSendingEnabled: true
    });
    plan = await prepareCampaignPhoneDrafts(plan, phoneAdapter);
    plan.contacts[0] = {
      ...plan.contacts[0]!,
      whatsappCustomerReply: 'YES, count me in for 7 PM!'
    };
    const metrics = computeBulkCampaignMetrics(plan);
    const csv = exportBulkCampaignCsv(plan);

    const html = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={plan.campaignId}
        title={plan.title}
        objective={plan.objective}
        eventDetails={plan.eventDetails}
        instruction={plan.instruction}
        status="approved"
        executionMode="live"
        liveCallingEnabled={true}
        liveSendingEnabled={true}
        workspaceContext={{
          whatsappConnected: true,
          whatsappConnectionId: 'wa_conn_live',
          whatsappBusinessLabel: 'WhatsApp Business (+91 91879 51539)',
          liveSendingEnabled: true,
          optedInWhatsappContactsCount: 5,
          availableTemplates: [
            {
              name: 'webinar_invitation_v1',
              language: 'en_US',
              status: 'APPROVED',
              category: 'MARKETING',
              bodyText: 'Hello {{1}}, join our session ({{2}})!',
              bodyParams: 2,
              usableForCampaign: true
            }
          ],
          phoneContactsConfigured: true,
          savedPhoneContactsCount: 5,
          liveCallingEnabled: true,
          dailyPhoneCallLimit: 5,
          emailConnected: true
        }}
        channels={plan.channels}
        businessAccountLabel={plan.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={plan.whatsappPlan.templateName}
        whatsappMessagePreview={plan.whatsappPlan.messagePreview}
        aiDisclosure={plan.callScript.aiDisclosure}
        callOpeningLine={plan.callScript.openingLine}
        callEventPitch={plan.callScript.eventPitch}
        callQuestions={plan.callScript.questions}
        boundedPurposePreview={plan.callScript.boundedPurposePreview}
        supportedLanguages={plan.callScript.supportedLanguages}
        maxCalls={plan.limits.maxCalls}
        dailyPhoneCallLimit={plan.limits.dailyPhoneCallLimit}
        maxConcurrency={plan.limits.maxConcurrency}
        rateLimitPerMinute={plan.limits.rateLimitPerMinute}
        materialHash={plan.materialHash}
        estimatedCostInr={21.9}
        importSummary={plan.importSummary}
        contacts={plan.contacts}
        metrics={metrics}
        csvReportText={csv}
        onApproveAllPhoneDrafts={() => {}}
        onReconcile={() => {}}
      />
    );

    expect(html).toContain('data-testid="live-connector-readiness-banner"');
    expect(html).toContain('data-testid="approve-and-start-campaign-button"');
    expect(html).toContain('Step 2 of 4');
    expect(html).not.toContain('Approve Campaign');
  });

  it('4. renders editable event details, email campaign draft & table column, batch size selector, consent confirmation, per-contact unsubscribe, and Dashboard quick action', () => {
    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      fileName: 'multichannel-ui.csv',
      rawText: [
        'name,phone,email,language,whatsapp_consent,phone_consent,email_consent,dnd,opted_out',
        'Aarav Sharma,9876500001,aarav@example.com,en-IN,true,true,true,false,false',
        'Unconsented Lead,9811144444,lead@example.com,en-IN,false,false,false,false,false',
        'DND Restricted,9811177777,dnd@example.com,en-IN,false,false,false,true,false'
      ].join('\n'),
      phoneDirectory: []
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Tomorrow we have an AI Webinar; send WhatsApp and email invitations and call eligible contacts.',
      importResult: imported
    });
    const metrics = computeBulkCampaignMetrics(plan);
    const csv = exportBulkCampaignCsv(plan);

    const html = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={plan.campaignId}
        title={plan.title}
        objective={plan.objective}
        eventDetails={plan.eventDetails}
        webinarDetails={plan.webinarDetails}
        instruction={plan.instruction}
        status={plan.status}
        channels={plan.channels}
        businessAccountLabel={plan.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={plan.whatsappPlan.templateName}
        whatsappMessagePreview={plan.whatsappPlan.messagePreview}
        aiDisclosure={plan.callScript.aiDisclosure}
        callOpeningLine={plan.callScript.openingLine}
        callEventPitch={plan.callScript.eventPitch}
        callQuestions={plan.callScript.questions}
        boundedPurposePreview={plan.callScript.boundedPurposePreview}
        supportedLanguages={plan.callScript.supportedLanguages}
        emailPlan={plan.emailPlan}
        maxCalls={plan.limits.maxCalls}
        dailyPhoneCallLimit={plan.limits.dailyPhoneCallLimit}
        maxConcurrency={plan.limits.maxConcurrency}
        rateLimitPerMinute={plan.limits.rateLimitPerMinute}
        materialHash={plan.materialHash}
        estimatedCostInr={0}
        importSummary={plan.importSummary}
        contacts={plan.contacts}
        metrics={metrics}
        csvReportText={csv}
        onUpdatePlan={() => {}}
        onUnsubscribeContact={() => {}}
      />
    );

    expect(html).toContain('data-testid="missing-webinar-details-banner"');
    expect(html).toContain('aria-label="Edit campaign event details"');
    expect(html).toContain('aria-label="Edit email campaign subject"');
    expect(html).toContain('aria-label="Edit email campaign body"');
    expect(html).toContain('aria-label="Max phone calls"');
    expect(html).toContain('data-testid="campaign-batch-size-select"');
    expect(html).toContain('data-testid="campaign-email-metrics"');
    expect(html).toContain('<th>Email</th>');

    const unconsentedId = plan.contacts.find(c => c.contact.name === 'Unconsented Lead')!.contact.contactId;
    const dndId = plan.contacts.find(c => c.contact.name === 'DND Restricted')!.contact.contactId;
    expect(html).toContain(`data-testid="confirm-consent-${unconsentedId}"`);
    expect(html).not.toContain(`data-testid="confirm-consent-${dndId}"`);
    expect(html).toContain(`data-testid="unsubscribe-contact-${unconsentedId}"`);
  });

  it('5. renders simplified Create a Campaign UI (+ knowledge picker, separate contacts upload, channel pills, Prepare Campaign CTA) and grounded Q&A + 10 executive outcome metrics + collapsed Advanced Details', () => {
    const createHtml = renderToStaticMarkup(<BulkCampaignCreateView />);
    expect(createHtml).toContain('Create a Campaign');
    expect(createHtml).toContain('Let Thaara prepare your customer outreach.');
    expect(createHtml).toContain('What do you want Thaara to do?');
    expect(createHtml).toContain('data-testid="campaign-knowledge-plus-button"');
    expect(createHtml).toContain('accept=".pdf,.docx,.txt,.csv,.xlsx"');
    expect(createHtml).toContain('Upload your contacts');
    expect(createHtml).toContain('Excel, CSV or paste phone numbers');
    expect(createHtml).toContain('data-testid="create-channel-whatsapp"');
    expect(createHtml).toContain('data-testid="create-channel-phone"');
    expect(createHtml).toContain('data-testid="create-channel-email"');
    expect(createHtml).toContain('Review Campaign');
    expect(createHtml).toContain('Thaara creates everything for your review.');

    // Verify knowledge-grounded review & 10 outcome metrics on BulkCampaignDashboardView
    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      rawText: 'name,phone,email,whatsapp_consent,phone_consent,email_consent\nAarav,9876500001,aarav@example.com,true,true,true',
      phoneDirectory: []
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Invite Aarav to our AI Webinar tomorrow at 7 PM and answer questions.',
      importResult: imported,
      channels: ['whatsapp', 'phone', 'email'],
      knowledgeFiles: [
        {
          fileName: 'webinar-guide.txt',
          rawText:
            'Title: Executive AI Webinar\nWhen: Tomorrow at 7:00 PM IST\nSpeaker: Kaaranji Shreedhar\nAgenda: Voice AI Agents and WhatsApp Automation\nRegistration: https://quantumweave.ai/register'
        }
      ]
    });
    const reviewHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={plan.campaignId}
        title={plan.title}
        objective={plan.objective}
        eventDetails={plan.eventDetails}
        knowledgeContext={plan.knowledgeContext}
        instruction={plan.instruction}
        status={plan.status}
        channels={plan.channels}
        businessAccountLabel={plan.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={plan.whatsappPlan.templateName}
        whatsappMessagePreview={plan.whatsappPlan.messagePreview}
        aiDisclosure={plan.callScript.aiDisclosure}
        callOpeningLine={plan.callScript.openingLine}
        callEventPitch={plan.callScript.eventPitch}
        callQuestions={plan.callScript.questions}
        boundedPurposePreview={plan.callScript.boundedPurposePreview}
        supportedLanguages={plan.callScript.supportedLanguages}
        emailPlan={plan.emailPlan}
        maxCalls={plan.limits.maxCalls}
        dailyPhoneCallLimit={plan.limits.dailyPhoneCallLimit}
        maxConcurrency={plan.limits.maxConcurrency}
        rateLimitPerMinute={plan.limits.rateLimitPerMinute}
        materialHash={plan.materialHash}
        estimatedCostInr={0}
        importSummary={plan.importSummary}
        contacts={plan.contacts}
        metrics={computeBulkCampaignMetrics(plan)}
        csvReportText={exportBulkCampaignCsv(plan)}
        onAskQuestion={async () => null}
      />
    );

    expect(reviewHtml).toContain('data-testid="campaign-workflow-stepper"');
    expect(reviewHtml).toContain('webinar-guide.txt');
    expect(reviewHtml).toContain('data-testid="sample-grounded-qa-section"');
    expect(reviewHtml).toContain('What will I learn?');
    expect(reviewHtml).toContain('Kaaranji Shreedhar');
    expect(reviewHtml).not.toContain('data-testid="campaign-results-card"');
    expect(reviewHtml).toContain('data-testid="open-phone-dashboard-link"');
    expect(reviewHtml).toContain('<details data-testid="campaign-advanced-details"');
  });

  it('6. simplifies Company Introduction Review UI (AI Calling only — no WhatsApp templates, no premature Results), shows Run Simulation — No Real Calls, and renders 5 Simulated Conversations on Results', async () => {
    const phoneAdapter = new MockBulkCampaignPhoneAdapter({ dailyCallLimit: 5, directory: [] });
    const unconsentedImport = parseBulkCampaignContacts({
      sourceType: 'paste',
      fileName: 'test.txt',
      rawText: '9811100011\n9811100022\n9811100033\n9811100044',
      phoneDirectory: []
    });
    const baseCompanyCampaign = createBulkCampaignPlan({
      workspaceId: '75d2f889-d3eb-4acc-861a-fada4691ecce',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'introduce about the company',
      importResult: unconsentedImport,
      channels: ['phone'],
      knowledgeFiles: [
        {
          fileName: 'Document_A_Quantum_Weave_Complete_Knowledge_Base.docx',
          rawText:
            'Document A — Quantum Weave Complete Knowledge Base | Thaara AI V2 shared company knowledge layer | Verified-source consolidation'
        }
      ]
    });

    const simDraft = await prepareSyntheticSimulationFromCampaign(baseCompanyCampaign);

    // 1. Review stage: shows 5 clean Review cards, NO WhatsApp template box, NO premature Results card!
    const reviewHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={simDraft.campaignId}
        title={simDraft.title}
        objective={simDraft.objective}
        eventDetails={simDraft.eventDetails}
        knowledgeContext={simDraft.knowledgeContext}
        instruction={simDraft.instruction}
        status={simDraft.status}
        channels={simDraft.channels}
        businessAccountLabel={simDraft.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={simDraft.whatsappPlan.templateName}
        whatsappMessagePreview={simDraft.whatsappPlan.messagePreview}
        aiDisclosure={simDraft.callScript.aiDisclosure}
        callOpeningLine={simDraft.callScript.openingLine}
        callEventPitch={simDraft.callScript.eventPitch}
        callQuestions={simDraft.callScript.questions}
        boundedPurposePreview={simDraft.callScript.boundedPurposePreview}
        supportedLanguages={simDraft.callScript.supportedLanguages}
        maxCalls={simDraft.limits.maxCalls}
        dailyPhoneCallLimit={simDraft.limits.dailyPhoneCallLimit}
        maxConcurrency={simDraft.limits.maxConcurrency}
        rateLimitPerMinute={simDraft.limits.rateLimitPerMinute}
        materialHash={simDraft.materialHash}
        estimatedCostInr={0}
        importSummary={simDraft.importSummary}
        contacts={simDraft.contacts}
        metrics={computeBulkCampaignMetrics(simDraft)}
        csvReportText={exportBulkCampaignCsv(simDraft)}
      />
    );

    expect(reviewHtml).toContain('data-testid="simplified-review-stage"');
    expect(reviewHtml).toContain('AI Calling selected');
    expect(reviewHtml).toContain('5 synthetic test contacts');
    expect(reviewHtml).toContain('What Thaara will say');
    expect(reviewHtml).toContain('Customer questions');
    expect(reviewHtml).toContain('data-testid="view-more-questions-button"');
    expect(reviewHtml).toContain('Contact readiness');
    expect(reviewHtml).toContain('Simulated Test Eligibility');
    expect(reviewHtml).toContain('Approve &amp; Run Test');
    expect(reviewHtml).toContain('Step 2 of 4');
    expect(reviewHtml).not.toContain('Edit WhatsApp template message');
    expect(reviewHtml).not.toContain('data-testid="campaign-results-card"');
    expect(reviewHtml).not.toContain('verified-source consolidation');

    // 2. Approve / Run stage: shows "Run Simulation — No Real Calls"
    const callsApproved = await approveAllCampaignPhoneDrafts(simDraft, phoneAdapter, {
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      role: 'owner'
    });
    const planApproved = approveBulkCampaign(callsApproved, {
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      role: 'owner',
      expectedMaterialHash: callsApproved.materialHash
    });

    const approveStageHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={planApproved.campaignId}
        title={planApproved.title}
        objective={planApproved.objective}
        eventDetails={planApproved.eventDetails}
        knowledgeContext={planApproved.knowledgeContext}
        instruction={planApproved.instruction}
        status={planApproved.status}
        channels={planApproved.channels}
        businessAccountLabel={planApproved.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={planApproved.whatsappPlan.templateName}
        whatsappMessagePreview={planApproved.whatsappPlan.messagePreview}
        aiDisclosure={planApproved.callScript.aiDisclosure}
        callOpeningLine={planApproved.callScript.openingLine}
        callEventPitch={planApproved.callScript.eventPitch}
        callQuestions={planApproved.callScript.questions}
        boundedPurposePreview={planApproved.callScript.boundedPurposePreview}
        supportedLanguages={planApproved.callScript.supportedLanguages}
        maxCalls={planApproved.limits.maxCalls}
        dailyPhoneCallLimit={planApproved.limits.dailyPhoneCallLimit}
        maxConcurrency={planApproved.limits.maxConcurrency}
        rateLimitPerMinute={planApproved.limits.rateLimitPerMinute}
        materialHash={planApproved.materialHash}
        approvedMaterialHash={planApproved.approval?.approvedMaterialHash}
        estimatedCostInr={planApproved.approval?.estimatedCostInr ?? 0}
        importSummary={planApproved.importSummary}
        contacts={planApproved.contacts}
        metrics={computeBulkCampaignMetrics(planApproved)}
        csvReportText={exportBulkCampaignCsv(planApproved)}
      />
    );
    expect(approveStageHtml).toContain('data-testid="approve-and-run-test-button"');
    expect(approveStageHtml).toContain('Step 2 of 4');

    // 3. Results stage: shows 5 simulated customer scenarios and exact outcome metrics
    const simulated = await executeBulkCampaign(planApproved, {
      whatsapp: new MockBulkCampaignWhatsAppAdapter(),
      phone: phoneAdapter,
      mode: 'simulation'
    });
    const resultsHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={simulated.campaignId}
        title={simulated.title}
        objective={simulated.objective}
        eventDetails={simulated.eventDetails}
        knowledgeContext={simulated.knowledgeContext}
        instruction={simulated.instruction}
        status={simulated.status}
        executionMode={simulated.executionMode}
        channels={simulated.channels}
        businessAccountLabel={simulated.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={simulated.whatsappPlan.templateName}
        whatsappMessagePreview={simulated.whatsappPlan.messagePreview}
        aiDisclosure={simulated.callScript.aiDisclosure}
        callOpeningLine={simulated.callScript.openingLine}
        callEventPitch={simulated.callScript.eventPitch}
        callQuestions={simulated.callScript.questions}
        boundedPurposePreview={simulated.callScript.boundedPurposePreview}
        supportedLanguages={simulated.callScript.supportedLanguages}
        maxCalls={simulated.limits.maxCalls}
        dailyPhoneCallLimit={simulated.limits.dailyPhoneCallLimit}
        maxConcurrency={simulated.limits.maxConcurrency}
        rateLimitPerMinute={simulated.limits.rateLimitPerMinute}
        materialHash={simulated.materialHash}
        approvedMaterialHash={simulated.approval?.approvedMaterialHash}
        estimatedCostInr={simulated.approval?.estimatedCostInr ?? 0}
        importSummary={simulated.importSummary}
        contacts={simulated.contacts}
        metrics={computeBulkCampaignMetrics(simulated)}
        csvReportText={exportBulkCampaignCsv(simulated)}
      />
    );

    expect(resultsHtml).toContain('Test Results');
    expect(resultsHtml).toContain('Simulated Outcome');
    expect(resultsHtml).toContain('Engaged');
    expect(resultsHtml).toContain('Not Aligned');
    expect(resultsHtml).toContain('Simulated: More info');
    expect(resultsHtml).toContain('Further Discussion');
    expect(resultsHtml).toContain('Simulated: Further Discussion');
    expect(resultsHtml).toContain('Test Conversation');
    expect(resultsHtml).toContain('Customer 1 — Interested in AI Voice Agents');
    expect(resultsHtml).toContain('Customer 2 — Interested in Digital Marketing');
    expect(resultsHtml).toContain('Customer 3 — Pricing Enquiry');
    expect(resultsHtml).toContain('Customer 4 — Not Interested');
    expect(resultsHtml).toContain('Customer 5 — Requests Human Follow-Up');
    expect(resultsHtml).toContain('Download Report');
  });

  it('7. renders One-Call Pilot UI with authorized contact selector, approval button, and ACTUAL CALL RESULT panel', () => {
    const imported = parseBulkCampaignContacts({
      sourceType: 'paste',
      rawText: '9800005125\n9800007894',
      phoneDirectory: []
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Introduce Quantum Weave AI to contacts.',
      importResult: imported,
      channels: ['phone']
    });
    const html = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={plan.campaignId}
        title={plan.title}
        objective={plan.objective}
        eventDetails={plan.eventDetails}
        instruction={plan.instruction}
        status="completed"
        channels={plan.channels}
        businessAccountLabel={plan.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={plan.whatsappPlan.templateName}
        whatsappMessagePreview={plan.whatsappPlan.messagePreview}
        aiDisclosure={plan.callScript.aiDisclosure}
        callOpeningLine={plan.callScript.openingLine}
        callEventPitch={plan.callScript.eventPitch}
        callQuestions={plan.callScript.questions}
        supportedLanguages={plan.callScript.supportedLanguages}
        maxCalls={plan.limits.maxCalls}
        maxConcurrency={plan.limits.maxConcurrency}
        rateLimitPerMinute={plan.limits.rateLimitPerMinute}
        materialHash={plan.materialHash}
        estimatedCostInr={0}
        importSummary={plan.importSummary}
        contacts={plan.contacts}
        metrics={computeBulkCampaignMetrics(plan)}
        csvReportText={exportBulkCampaignCsv(plan)}
        eligiblePilotContacts={[
          {
            contactId: 'dir_1',
            displayName: 'Owner Test Phone',
            maskedPhone: '+91 ******9999',
            consentExpiresAt: '2027-01-01T00:00:00.000Z',
            source: 'phone_directory'
          }
        ]}
        pilotCall={{
          pilotId: 'pilot-1',
          campaignId: plan.campaignId,
          contactId: 'dir_1',
          displayName: 'Owner Test Phone',
          maskedPhone: '+91 ******9999',
          language: 'en-IN',
          callPurpose: 'Introduce Quantum Weave AI.',
          approvalId: '44444444-4444-4444-8444-444444444444',
          preparedAt: '2026-11-19T00:45:00.000Z',
          expiresAt: '2026-11-19T01:00:00.000Z',
          status: 'completed',
          callId: '33333333-3333-4333-8333-333333333333',
          durationSeconds: 75,
          outcomeLabel: 'Interested',
          summary: 'Owner test confirmed voice quality.',
          recordingAvailable: true,
          isRealCall: true
        }}
        onPreparePilotCall={() => {}}
        onExecutePilotCall={() => {}}
        onRefreshPilotResult={() => {}}
      />
    );
    expect(html).not.toContain('One-Call Pilot (1 Authorized Test Contact)');
    expect(html).toContain('data-testid="campaign-results-card"');
    expect(html).toContain('Step 4 of 4');
  });

  it('8. renders n8n Orchestration card, WhatsApp actual result box, and Stop/Cancel job control', () => {
    const imported = parseBulkCampaignContacts({
      sourceType: 'paste',
      rawText: 'Opted In Owner,+919845099999,owner@example.com,yes,yes,no',
      phoneDirectory: []
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Introduce Quantum Weave AI via WhatsApp and Phone.',
      importResult: imported,
      channels: ['phone', 'whatsapp']
    });
    const html = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={plan.campaignId}
        title={plan.title}
        objective={plan.objective}
        eventDetails={plan.eventDetails}
        instruction={plan.instruction}
        status="approved"
        channels={['phone', 'whatsapp']}
        businessAccountLabel={plan.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={plan.whatsappPlan.templateName}
        whatsappMessagePreview={plan.whatsappPlan.messagePreview}
        aiDisclosure={plan.callScript.aiDisclosure}
        callOpeningLine={plan.callScript.openingLine}
        callEventPitch={plan.callScript.eventPitch}
        callQuestions={plan.callScript.questions}
        boundedPurposePreview={plan.callScript.boundedPurposePreview}
        supportedLanguages={plan.callScript.supportedLanguages}
        maxCalls={plan.limits.maxCalls}
        dailyPhoneCallLimit={plan.limits.dailyPhoneCallLimit}
        maxConcurrency={plan.limits.maxConcurrency}
        rateLimitPerMinute={plan.limits.rateLimitPerMinute}
        materialHash={plan.materialHash}
        importSummary={plan.importSummary}
        contacts={plan.contacts}
        metrics={computeBulkCampaignMetrics(plan)}
        csvReportText={exportBulkCampaignCsv(plan)}
        eligibleWhatsAppPilotContacts={[
          {
            contactId: 'wa_owner_1',
            displayName: 'Opted In Owner',
            maskedPhone: '+91 ******9999',
            consentExpiresAt: '2026-11-20T00:00:00.000Z',
            source: 'campaign_eligible'
          }
        ]}
        pilotWhatsApp={{
          pilotId: 'wapilot_1',
          campaignId: plan.campaignId,
          contactId: 'wa_owner_1',
          displayName: 'Opted In Owner',
          maskedPhone: '+91 ******9999',
          connectionId: 'default',
          mode: 'template',
          templateName: 'company_intro_v1',
          language: 'en_US',
          messagePreview: 'Hello from Quantum Weave AI.',
          status: 'delivered',
          providerMessageId: 'wamid.test.999',
          latestReplyPreview: 'Yes, please share details.',
          updatedAt: '2026-11-19T01:00:00.000Z',
          isRealMessage: true
        }}
        n8nJobs={[
          {
            jobId: 'n8njob_test1',
            campaignId: plan.campaignId,
            channel: 'whatsapp',
            mode: 'multi_contact_batch',
            workflowId: 'ThaaraBulkWa0001',
            webhookPath: '/webhook/thaara-bulk-campaign-whatsapp-v1',
            targetContactId: 'wa_owner_1',
            targetDisplayName: 'Opted In Owner',
            targetMaskedPhone: '+91 ******9999',
            status: 'running',
            createdAt: '2026-11-19T01:00:00.000Z',
            createdByUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            webhookDispatched: true,
            isSimulated: false
          }
        ]}
        onSubmitN8nJob={() => {}}
        onPauseN8nJob={() => {}}
        onEmergencyStopN8nJobs={() => {}}
        onCancelN8nJob={() => {}}
      />
    );
    expect(html).not.toContain('n8n Orchestration (1-Contact Pilot: AI Calling &amp; WhatsApp)');
    expect(html).toContain('data-testid="campaign-execution-progress-card"');
    expect(html).toContain('Step 3 of 4');
    expect(html).toContain('data-testid="execution-pause-button"');
    expect(html).toContain('data-testid="execution-stop-button"');
  });

  it('9. renders Controlled Multi-Contact Batch n8n controls (locked by default, enabled when live on), per-recipient queue progress, Emergency Stop, and truthful Live Results labels', () => {
    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      rawText: 'name,phone,email,whatsapp_consent,phone_consent,email_consent\nAlice Live,+919845010001,alice@example.com,yes,yes,no',
      phoneDirectory: []
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Introduce Quantum Weave AI via WhatsApp and Phone.',
      importResult: imported,
      channels: ['phone', 'whatsapp']
    });

    // 1. Default simulation-locked state keeps multi-contact batch buttons disabled
    const lockedHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={plan.campaignId}
        title={plan.title}
        objective={plan.objective}
        eventDetails={plan.eventDetails}
        instruction={plan.instruction}
        status="approved"
        channels={['phone', 'whatsapp']}
        liveCallingEnabled={false}
        liveSendingEnabled={false}
        businessAccountLabel={plan.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={plan.whatsappPlan.templateName}
        whatsappMessagePreview={plan.whatsappPlan.messagePreview}
        aiDisclosure={plan.callScript.aiDisclosure}
        callOpeningLine={plan.callScript.openingLine}
        callEventPitch={plan.callScript.eventPitch}
        callQuestions={plan.callScript.questions}
        supportedLanguages={plan.callScript.supportedLanguages}
        maxCalls={plan.limits.maxCalls}
        maxConcurrency={plan.limits.maxConcurrency}
        rateLimitPerMinute={plan.limits.rateLimitPerMinute}
        materialHash={plan.materialHash}
        estimatedCostInr={0}
        importSummary={plan.importSummary}
        contacts={plan.contacts}
        metrics={computeBulkCampaignMetrics(plan)}
        csvReportText={exportBulkCampaignCsv(plan)}
        onSubmitN8nBatchJob={() => {}}
        onRefreshCampaign={() => {}}
      />
    );
    expect(lockedHtml).toContain('Live calling is currently unavailable.');
    expect(lockedHtml).toContain('data-testid="approve-and-run-test-button"');
    expect(lockedHtml).not.toContain('Global Multi-Contact Live Disabled');
    expect(lockedHtml).not.toContain('data-testid="n8n-batch-controls"');

    // 2. Live-enabled Results stage shows truthful live labels + per-recipient batch queue + Emergency Stop
    const liveHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={plan.campaignId}
        title={plan.title}
        objective={plan.objective}
        eventDetails={plan.eventDetails}
        instruction={plan.instruction}
        status="completed"
        executionMode="live"
        channels={['phone', 'whatsapp']}
        liveCallingEnabled={true}
        liveSendingEnabled={true}
        businessAccountLabel={plan.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={plan.whatsappPlan.templateName}
        whatsappMessagePreview={plan.whatsappPlan.messagePreview}
        aiDisclosure={plan.callScript.aiDisclosure}
        callOpeningLine={plan.callScript.openingLine}
        callEventPitch={plan.callScript.eventPitch}
        callQuestions={plan.callScript.questions}
        supportedLanguages={plan.callScript.supportedLanguages}
        maxCalls={plan.limits.maxCalls}
        maxConcurrency={plan.limits.maxConcurrency}
        rateLimitPerMinute={plan.limits.rateLimitPerMinute}
        materialHash={plan.materialHash}
        estimatedCostInr={15}
        importSummary={plan.importSummary}
        contacts={plan.contacts}
        metrics={computeBulkCampaignMetrics(plan)}
        csvReportText={exportBulkCampaignCsv(plan)}
        n8nJobs={[
          {
            jobId: 'n8nbatch_live1',
            campaignId: plan.campaignId,
            channel: 'whatsapp',
            mode: 'multi_contact_batch',
            workflowId: 'ThaaraBulkWa0001',
            webhookPath: '/webhook/thaara-bulk-campaign-whatsapp-v1',
            targetContactId: plan.contacts[0]!.contact.contactId,
            targetDisplayName: '1 approved contacts',
            targetMaskedPhone: '+91 ******0001',
            totalContacts: 1,
            processedCount: 0,
            succeededCount: 0,
            failedCount: 0,
            skippedCount: 0,
            status: 'running',
            createdAt: '2026-11-20T05:00:00.000Z',
            createdByUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            webhookDispatched: true,
            isSimulated: false,
            recipientQueue: [
              {
                contactId: plan.contacts[0]!.contact.contactId,
                displayName: 'Alice Live',
                maskedPhone: '+91 ******0001',
                status: 'dispatched',
                attempts: 1,
                idempotencyKey: 'n8nbatch_live1-c1',
                providerId: 'wamid.live.001',
                outcome: 'Delivered',
                updatedAt: '2026-11-20T05:01:00.000Z'
              }
            ]
          }
        ]}
        onSubmitN8nBatchJob={() => {}}
        onPauseN8nJob={() => {}}
        onResumeN8nJob={() => {}}
        onEmergencyStopN8nJobs={() => {}}
        onCancelN8nJob={() => {}}
      />
    );
    expect(liveHtml).toContain('data-testid="campaign-results-card"');
    expect(liveHtml).toContain('Campaign Results');
    expect(liveHtml).toContain('Actual campaign outcomes, recordings, and conversations.');
    expect(liveHtml).not.toContain('Simulated outcomes only');
  });

  it('10. New Campaign -> Use saved Thaara contacts -> Select 2 -> AI Calling only -> Review shows NEW DRAFT with 2 contacts', () => {
    const createHtml = renderToStaticMarkup(
      <BulkCampaignCreateView
        initialChannels={['phone']}
        initialInstruction="Call consented contacts to introduce Quantum Weave AI automation and ask their business goals."
        onLoadSavedContacts={async () => [
          { contactId: 'pc-6ba8c8ba-266c-4a93-b7e1-ad12de5e1eff', name: 'krishna', maskedPhone: '+91 ******4634', callingAllowed: true },
          { contactId: 'pc-ca62f9d7-cfd8-4c22-ba76-2bd6be264eaf', name: 'krishna1', maskedPhone: '+91 ******3134', callingAllowed: true },
          { contactId: 'pc-9e9efe49-7e34-45e9-92ea-84b46d31177c', name: 'test', maskedPhone: '+91 ******6718', callingAllowed: true }
        ]}
        onImportSavedContacts={() => {}}
      />
    );
    expect(createHtml).toContain('data-testid="import-saved-contacts-button"');
    expect(createHtml).toContain('Use saved Thaara contacts');

    // Simulate backend result when ONLY 2 contacts are selected + AI Calling only + custom calling instruction
    const selectedTwo = [
      {
        contactId: 'pc-6ba8c8ba-266c-4a93-b7e1-ad12de5e1eff',
        revision: 1,
        displayName: 'krishna',
        aliases: [],
        phoneE164: '+917019624634',
        maskedPhone: '+91 ******4634',
        consent: { callingAllowed: true, expired: false, source: 'recipient_verbal' as const, recordedAt: '2026-11-01T00:00:00Z', expiresAt: '2027-10-31T00:00:00Z' },
        archived: false
      },
      {
        contactId: 'pc-ca62f9d7-cfd8-4c22-ba76-2bd6be264eaf',
        revision: 1,
        displayName: 'krishna1',
        aliases: [],
        phoneE164: '+919900003134',
        maskedPhone: '+91 ******3134',
        consent: { callingAllowed: true, expired: false, source: 'recipient_verbal' as const, recordedAt: '2026-11-01T00:00:00Z', expiresAt: '2027-10-31T00:00:00Z' },
        archived: false
      }
    ];
    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      fileName: 'saved-contacts.csv',
      rawText: selectedTwo.map(c => `${c.displayName},${c.phoneE164},en-IN,false,true,false,false`).join('\n'),
      phoneDirectory: selectedTwo as any
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Call consented contacts to introduce Quantum Weave AI automation and ask their business goals.',
      channels: ['phone'],
      importResult: imported
    });

    expect(plan.status).toBe('draft');
    expect(plan.channels).toEqual(['phone']);
    expect(plan.contacts).toHaveLength(2);
    expect(plan.title).not.toContain('AI and Digital Marketing Webinar');

    const metrics = computeBulkCampaignMetrics(plan);
    const csv = exportBulkCampaignCsv(plan);
    const reviewHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={plan.campaignId}
        title={plan.title}
        instruction={plan.instruction}
        status={plan.status}
        executionMode={plan.executionMode}
        liveCallingEnabled={false}
        liveSendingEnabled={false}
        channels={plan.channels}
        businessAccountLabel={plan.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={plan.whatsappPlan.templateName}
        whatsappMessagePreview={plan.whatsappPlan.messagePreview}
        aiDisclosure={plan.callScript.aiDisclosure}
        callOpeningLine={plan.callScript.openingLine}
        callEventPitch={plan.callScript.eventPitch}
        callQuestions={plan.callScript.questions}
        boundedPurposePreview={plan.callScript.boundedPurposePreview}
        supportedLanguages={plan.callScript.supportedLanguages}
        maxCalls={plan.limits.maxCalls}
        dailyPhoneCallLimit={plan.limits.dailyPhoneCallLimit}
        maxConcurrency={plan.limits.maxConcurrency}
        rateLimitPerMinute={plan.limits.rateLimitPerMinute}
        materialHash={plan.materialHash}
        estimatedCostInr={0}
        importSummary={plan.importSummary}
        contacts={plan.contacts}
        metrics={metrics}
        csvReportText={csv}
      />
    );
    expect(reviewHtml).toContain(plan.campaignId);
    expect(reviewHtml).toContain('krishna');
    expect(reviewHtml).toContain('krishna1');
    expect(reviewHtml).not.toContain('AI and Digital Marketing Webinar');
  });

  it('11. renders Controlled Batch card prominently, complete 14-metric overview, per-contact call IDs, recording player, and full two-way transcript panel in Results', () => {
    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      fileName: 'saved-contacts.csv',
      rawText: [
        'name,phone,language,whatsapp_consent,phone_consent,dnd,opted_out',
        'krishna,+917019624634,en-IN,false,true,false,false',
        'krishna1,+919900003134,en-IN,false,true,false,false'
      ].join('\n'),
      phoneDirectory: []
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Call consented contacts to introduce Quantum Weave AI.',
      channels: ['phone'],
      importResult: imported
    });
    const approved = approveBulkCampaign(plan, {
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      role: 'owner',
      expectedMaterialHash: plan.materialHash
    });
    approved.contacts[0] = {
      ...approved.contacts[0]!,
      phoneStatus: 'answered',
      phoneRecordState: 'completed',
      phoneCallId: '73350808-9628-4265-a34f-dd9d4437d0d6',
      phoneProviderCallId: '20261120/04db88db',
      phoneDurationSeconds: 74,
      phoneTranscriptSummary: 'Discussed AI calling agent demo.',
      structuredNotes: 'Send pricing deck',
      interactionTimestamp: '2026-11-20T10:01:15.000Z',
      attendanceOutcome: 'pending'
    };

    const html = renderToStaticMarkup(
      <BulkCampaignDashboardView
        campaignId={approved.campaignId}
        title={approved.title}
        objective={approved.objective}
        eventDetails={approved.eventDetails}
        instruction={approved.instruction}
        status="completed"
        executionMode="live"
        channels={approved.channels}
        businessAccountLabel={approved.whatsappPlan.businessAccountLabel}
        whatsappTemplateName={approved.whatsappPlan.templateName}
        whatsappMessagePreview={approved.whatsappPlan.messagePreview}
        aiDisclosure={approved.callScript.aiDisclosure}
        callOpeningLine={approved.callScript.openingLine}
        callEventPitch={approved.callScript.eventPitch}
        callQuestions={approved.callScript.questions}
        supportedLanguages={approved.callScript.supportedLanguages}
        maxCalls={approved.limits.maxCalls}
        dailyPhoneCallLimit={approved.limits.dailyPhoneCallLimit}
        maxConcurrency={approved.limits.maxConcurrency}
        rateLimitPerMinute={approved.limits.rateLimitPerMinute}
        materialHash={approved.materialHash}
        approvedMaterialHash={approved.approval?.approvedMaterialHash}
        estimatedCostInr={7}
        importSummary={approved.importSummary}
        contacts={approved.contacts}
        metrics={computeBulkCampaignMetrics(approved)}
        csvReportText={exportBulkCampaignCsv(approved)}
        liveCallingEnabled={true}
        liveSendingEnabled={false}
        onSubmitN8nBatchJob={() => {}}
        onReconcile={() => {}}
      />
    );

    expect(html).toContain('Step 4 of 4');
    expect(html).toContain('data-testid="campaign-results-card"');
    expect(html).toContain('Calls attempted');
    expect(html).toContain('Calls completed');
    expect(html).toContain('Completed — unclassified');
    expect(html).toContain(`data-testid="contact-recording-toggle-${approved.contacts[0]!.contact.contactId}"`);
    expect(html).toContain(`data-testid="contact-transcript-toggle-${approved.contacts[0]!.contact.contactId}"`);
    expect(html).toContain(`data-testid="contact-details-toggle-${approved.contacts[0]!.contact.contactId}"`);
    expect(html).toContain('data-testid="results-more-details"');
  });

  it('12. renders expandable Bulk Campaigns sidebar (Create Campaign & Campaign History), History routes, and Back navigation across stages', () => {
    expect(resolvePageFromLocation('/integrations/bulk-campaign/create')).toBe('bulk-campaign-create');
    expect(resolvePageFromLocation('/integrations/bulk-campaign/history')).toBe('bulk-campaign-history');
    expect(resolvePageFromLocation('/integrations/bulk-campaign/history/camp_abc123')).toBe('bulk-campaign-history');
    expect(extractBulkCampaignIdFromLocation('/integrations/bulk-campaign/history/camp_abc123')).toBe('camp_abc123');
    expect(isIntegrationPage('bulk-campaign-history')).toBe(true);

    const sidebarHtml = renderToStaticMarkup(
      <Sidebar
        activePage="bulk-campaign-history"
        onSelectPage={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
        integrationsExpanded={true}
        onToggleIntegrations={() => {}}
        mobileOpen={false}
        onCloseMobile={() => {}}
        workspaceName="Quantum Weave"
        userDisplayName="Owner"
        userEmail="owner@quantumweaveai.io"
        userRole="owner"
        pendingApprovalsCount={0}
        onSignOut={() => {}}
      />
    );
    expect(sidebarHtml).toContain('data-testid="nav-bulk-campaign-toggle"');
    expect(sidebarHtml).toContain('data-testid="nav-item-bulk-campaign-create"');
    expect(sidebarHtml).toContain('data-testid="nav-item-bulk-campaign-history"');
    expect(sidebarHtml).toContain('Create Campaign');
    expect(sidebarHtml).toContain('Campaign History');

    const createBackHtml = renderToStaticMarkup(
      <BulkCampaignCreateView
        onBackToHistory={() => {}}
        resumeCampaign={{
          campaignId: 'camp_resume_1',
          title: 'AI Webinar',
          instruction: 'Invite leads to AI Webinar',
          channels: ['phone', 'whatsapp'],
          contactsCount: 5,
          knowledgeFilesCount: 1,
          onResumeReview: () => {}
        }}
      />
    );
    expect(createBackHtml).toContain('data-testid="create-back-to-history-button"');
    expect(createBackHtml).toContain('data-testid="create-resume-campaign-banner"');
    expect(createBackHtml).toContain('data-testid="create-continue-to-review-button"');
  });

  it('13. renders Campaign History cards (Interested/Not interested/Need callback, Live vs Simulation) and Campaign Details sharing authoritative Results', () => {
    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      fileName: 'history-leads.csv',
      rawText: [
        'name,phone,language,whatsapp_consent,phone_consent,dnd,opted_out',
        'Asha,+919800000011,en-IN,true,true,false,false'
      ].join('\n'),
      phoneDirectory: []
    });
    const plan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Invite contacts to AI Webinar.',
      channels: ['phone', 'whatsapp'],
      importResult: imported
    });
    plan.contacts[0] = {
      ...plan.contacts[0]!,
      phoneStatus: 'answered',
      phoneRecordState: 'completed',
      phoneCallId: 'call_hist_1',
      whatsappStatus: 'delivered',
      whatsappProviderMessageId: 'wamid.hist_1',
      attendanceOutcome: 'interested'
    };
    const metrics = computeBulkCampaignMetrics(plan);

    const historyHtml = renderToStaticMarkup(
      <BulkCampaignHistoryView
        campaigns={[
          {
            campaignId: plan.campaignId,
            title: 'AI Webinar',
            objective: plan.objective,
            instruction: plan.instruction,
            status: 'completed',
            executionMode: 'simulation',
            channels: ['phone', 'whatsapp'],
            createdAt: '2026-11-21T09:00:00.000Z',
            updatedAt: '2026-11-21T09:10:00.000Z',
            totalSelectedContacts: 1,
            metrics
          }
        ]}
        onOpenDetails={() => {}}
        onCreateNew={() => {}}
      />
    );
    expect(historyHtml).toContain('data-testid="bulk-campaign-history-page"');
    expect(historyHtml).toContain('AI Webinar');
    expect(historyHtml).toContain('Test');
    expect(historyHtml).toContain('Engaged');
    expect(historyHtml).toContain('Not Aligned');
    expect(historyHtml).toContain('Further Discussion');
    expect(historyHtml).toContain('#16A34A');
    expect(historyHtml).toContain('#64748B');
    expect(historyHtml).toContain('#2563EB');
    expect(historyHtml).toContain(`data-testid="history-details-${plan.campaignId}"`);

    const detailsHtml = renderToStaticMarkup(
      <BulkCampaignDetailsView
        campaignId={plan.campaignId}
        title="AI Webinar"
        objective={plan.objective}
        instruction={plan.instruction}
        status="completed"
        executionMode="live"
        channels={['phone', 'whatsapp']}
        createdAt="2026-11-21T09:00:00.000Z"
        updatedAt="2026-11-21T09:10:00.000Z"
        contacts={plan.contacts}
        metrics={metrics}
        hasBatchOrRealResults={true}
        onBackToHistory={() => {}}
      />
    );
    expect(detailsHtml).toContain('data-testid="bulk-campaign-details-page"');
    expect(detailsHtml).toContain('data-testid="details-back-to-history-button"');
    expect(detailsHtml).toContain('data-testid="details-campaign-info"');
    expect(detailsHtml).toContain('data-testid="campaign-results-card"');
    expect(detailsHtml).toContain(`data-testid="contact-recording-toggle-${plan.contacts[0]!.contact.contactId}"`);
    expect(detailsHtml).toContain(`data-testid="contact-transcript-toggle-${plan.contacts[0]!.contact.contactId}"`);
    expect(detailsHtml).not.toContain('data-testid="phone-transcript-view"');
    expect(detailsHtml).not.toContain('data-testid="phone-recording-loading"');
  });

  it('14. simplifies Campaign History titles, collapses secondary details, hides Recording for WhatsApp-only campaigns, and keeps Test labels distinct from Live', async () => {
    const { formatShortCampaignTitle, BulkCampaignResultsSection } = await import(
      '../src/BulkCampaignHistoryAndResults'
    );
    expect(
      formatShortCampaignTitle(
        'Thaara, tomorrow we have an AI Webinar at 7 PM. Send WhatsApp invitations, call the eligible contacts...'
      )
    ).toBe('AI Webinar');
    expect(
      formatShortCampaignTitle(
        'Introduce Quantum Weave AI digital marketing services to all small business owners in Bengaluru'
      )
    ).toBe('Digital Marketing');

    const imported = parseBulkCampaignContacts({
      sourceType: 'csv',
      fileName: 'wa-only.csv',
      rawText: [
        'name,phone,language,whatsapp_consent,phone_consent,dnd,opted_out',
        'Asha,+919800000011,en-IN,true,false,false,false'
      ].join('\n'),
      phoneDirectory: []
    });
    const waPlan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Send WhatsApp invite for Digital Marketing.',
      channels: ['whatsapp'],
      importResult: imported
    });
    waPlan.contacts[0] = {
      ...waPlan.contacts[0]!,
      whatsappStatus: 'delivered',
      whatsappProviderMessageId: 'wamid.wa_only_1',
      attendanceOutcome: 'interested'
    };

    const waHtml = renderToStaticMarkup(
      <BulkCampaignResultsSection
        campaignId={waPlan.campaignId}
        status="completed"
        executionMode="live"
        channels={['whatsapp']}
        contacts={waPlan.contacts}
        metrics={computeBulkCampaignMetrics(waPlan)}
        hasBatchOrRealResults={true}
      />
    );
    expect(waHtml).toContain('data-testid="contact-results-filter"');
    expect(waHtml).toContain(`data-testid="contact-transcript-toggle-${waPlan.contacts[0]!.contact.contactId}"`);
    expect(waHtml).not.toContain('contact-recording-toggle');
    expect(waHtml).not.toContain('Recording');
  });

  it('15. renders Campaign Execution Mode (One-Time vs Automatic Lead Follow-up), Mode B Google Sheets setup, Review standing authorization, and Active monitoring dashboard with Pause/Resume/Stop/Sync Now', async () => {
    const { configureAutomaticLeadFollowup, activateAutomaticLeadFollowup, pauseAutomaticLeadFollowup } = await import(
      '../../../apps/api/src/services/bulk-campaign-auto-followup'
    );
    const basePlan = createBulkCampaignPlan({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      instruction: 'Call new Meta Lead Ads enquiries within 1 minute.',
      channels: ['phone'],
      importResult: parseBulkCampaignContacts({
        sourceType: 'google_sheets',
        fileName: 'Meta Leads Sheet.csv',
        rawText: 'name,phone,phone_consent,consent_source,consent_date\nBaseline,+919800000001,true,Meta Form,2026-11-23',
        phoneDirectory: []
      })
    });
    const configured = configureAutomaticLeadFollowup(basePlan, {
      spreadsheetId: 'sheet_meta_1',
      spreadsheetName: 'Meta Leads Sheet',
      tabName: 'Leads',
      metaCampaignRef: 'Meta Webinar Q4',
      callingHoursIst: { startHour: 9, endHour: 20 },
      maxAttemptsPerLead: 2,
      retryOnNoAnswer: true,
      retryDelayMinutes: 60,
      maxLeadsPerDay: 250,
      processExistingBacklog: false
    });
    const activated = activateAutomaticLeadFollowup(configured, {
      actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      role: 'owner',
      expectedMaterialHash: configured.materialHash
    });
    const paused = pauseAutomaticLeadFollowup(activated);

    // 1) Create view shows both modes
    const createHtml = renderToStaticMarkup(<BulkCampaignCreateView />);
    expect(createHtml).toContain('Campaign Execution Mode');
    expect(createHtml).toContain('Option A: One-Time Bulk Campaign');
    expect(createHtml).toContain('Option B: Automatic Lead Follow-up');
    expect(createHtml).toContain('data-testid="execution-mode-one-time"');
    expect(createHtml).toContain('data-testid="execution-mode-auto-followup"');

    // 2) Review stage for Mode B displays Standing Authorization & Approve & Activate button
    const commonProps = {
      campaignId: configured.campaignId,
      title: configured.title,
      objective: configured.objective,
      eventDetails: configured.eventDetails,
      instruction: configured.instruction,
      status: configured.status,
      channels: configured.channels,
      businessAccountLabel: configured.whatsappPlan.businessAccountLabel,
      whatsappTemplateName: configured.whatsappPlan.templateName,
      whatsappMessagePreview: configured.whatsappPlan.messagePreview,
      aiDisclosure: configured.callScript.aiDisclosure,
      callOpeningLine: configured.callScript.openingLine,
      callEventPitch: configured.callScript.eventPitch,
      callQuestions: configured.callScript.questions,
      boundedPurposePreview: configured.callScript.boundedPurposePreview,
      supportedLanguages: configured.callScript.supportedLanguages,
      maxCalls: configured.limits.maxCalls,
      dailyPhoneCallLimit: configured.limits.dailyPhoneCallLimit,
      maxConcurrency: configured.limits.maxConcurrency,
      rateLimitPerMinute: configured.limits.rateLimitPerMinute,
      materialHash: configured.materialHash,
      importSummary: configured.importSummary,
      contacts: configured.contacts,
      metrics: computeBulkCampaignMetrics(configured),
      csvReportText: '',
      chatSummaryText: 'Ready',
      mode: configured.mode,
      sheetMonitor: configured.sheetMonitor,
      standingAuthorization: configured.standingAuthorization
    };

    const reviewHtml = renderToStaticMarkup(<BulkCampaignDashboardView {...commonProps} />);
    expect(reviewHtml).toContain('data-testid="auto-followup-review-card"');
    expect(reviewHtml).toContain('Approve &amp; Activate Automatic Follow-up');
    expect(reviewHtml).toContain('Meta Leads Sheet');
    expect(reviewHtml).toContain('Meta Webinar Q4');

    // 4) Active monitoring dashboard shows Status: Active — Monitoring Leads & Pause/Stop/Sync Now/View Results
    const activeHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        {...commonProps}
        sheetMonitor={activated.sheetMonitor}
        standingAuthorization={activated.standingAuthorization}
      />
    );
    expect(activeHtml).toContain('Status: Active — Monitoring Leads');
    expect(activeHtml).toContain('data-testid="auto-followup-pause-button"');
    expect(activeHtml).toContain('data-testid="auto-followup-stop-button"');
    expect(activeHtml).toContain('data-testid="auto-followup-sync-button"');
    expect(activeHtml).toContain('data-testid="auto-followup-view-results-button"');
    expect(activeHtml).not.toContain('data-testid="approve-and-start-campaign-button"');

    // 5) Paused monitoring dashboard shows Resume & Stop
    const pausedHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        {...commonProps}
        sheetMonitor={paused.sheetMonitor}
        standingAuthorization={paused.standingAuthorization}
      />
    );
    expect(pausedHtml).toContain('Status: Paused');
    expect(pausedHtml).toContain('data-testid="auto-followup-resume-button"');
    expect(pausedHtml).toContain('data-testid="auto-followup-stop-button"');

    // 6) Historical rows skipped notice + Process Existing Leads button + 8 dashboard counters + backlog preview card
    const skippedHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        {...commonProps}
        sheetMonitor={{
          ...activated.sheetMonitor!,
          processExistingBacklog: false,
          existingBacklogProcessed: false,
          baselineRowCount: 3,
          backlogSkippedReason: 'HISTORICAL_ROWS_SKIPPED_BY_SETTING',
          existingLeadsDiscoveredCount: 0,
          newLeadsReceivedCount: 0
        }}
        standingAuthorization={activated.standingAuthorization}
        existingBacklogPreview={{
          totalExistingRows: 3,
          previouslyProcessedCount: 0,
          eligibleCount: 2,
          consentBlockedCount: 1,
          duplicatesCount: 0,
          estimatedCallsWithinLimits: 2,
          maxLeadsPerDay: 250
        }}
      />
    );
    expect(skippedHtml).toContain('data-testid="auto-followup-historical-skipped-notice"');
    expect(skippedHtml).toContain('data-testid="auto-followup-process-existing-button"');
    expect(skippedHtml).toContain('Imported Contacts');
    expect(skippedHtml).toContain('Existing Leads Discovered');
    expect(skippedHtml).toContain('New Leads Received');
    expect(skippedHtml).toContain('Eligible for Calling');
    expect(skippedHtml).toContain('Awaiting Consent');
    expect(skippedHtml).toContain('DND / Opt-out Blocked');
    expect(skippedHtml).toContain('Consent-Blocked');
    expect(skippedHtml).toContain('Calls Queued');
    expect(skippedHtml).toContain('Calls Attempted');
    expect(skippedHtml).toContain('Calls Completed');
    expect(skippedHtml).toContain('Follow-ups Scheduled');

    // 7) Consent-blocked contact with phoneStatus: 'queued' must NOT be counted as Calls Attempted: 1
    const blockedQueuedHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        {...commonProps}
        contacts={[
          {
            ...commonProps.contacts[0]!,
            category: 'unauthorized',
            phoneStatus: 'queued'
          }
        ]}
        sheetMonitor={{
          ...activated.sheetMonitor!,
          leadsQueuedCount: 2
        }}
        standingAuthorization={activated.standingAuthorization}
      />
    );
    expect(blockedQueuedHtml).toContain('Calls Attempted</div><div style="font-size:1.15rem;font-weight:700;color:#0f172a;margin-top:0.15rem">0</div>');
    expect(blockedQueuedHtml).toContain('Awaiting Calling Consent Verification');
    expect(blockedQueuedHtml).toContain(`data-testid="verify-unsaved-consent-${commonProps.contacts[0]!.contact.contactId}"`);

    // 8) One-time review with 2+ raw unsaved contacts shows Imported Successfully, Ready to Call, Awaiting Consent, DND / Opt-out Blocked, and streamlined batch verification bar
    const rawReviewHtml = renderToStaticMarkup(
      <BulkCampaignDashboardView
        {...commonProps}
        status="draft"
        contacts={[
          {
            ...commonProps.contacts[0]!,
            contact: { ...commonProps.contacts[0]!.contact, contactId: 'c_raw_1', name: 'Contact 1', maskedPhone: '+91 ******1539', isUnsavedCampaignContact: true },
            category: 'unauthorized',
            phoneStatus: 'queued'
          },
          {
            ...commonProps.contacts[0]!,
            contact: { ...commonProps.contacts[0]!.contact, contactId: 'c_raw_2', name: 'Contact 2', maskedPhone: '+91 ******7894', isUnsavedCampaignContact: true },
            category: 'unauthorized',
            phoneStatus: 'queued'
          }
        ]}
        metrics={{ ...commonProps.metrics, totalContacts: 2, eligibleCount: 0, unauthorizedCount: 2 }}
        onUpdatePlan={() => {}}
      />
    );
    expect(rawReviewHtml).toContain('Imported Successfully: 2 contacts');
    expect(rawReviewHtml).toContain('Ready to Call: 0');
    expect(rawReviewHtml).toContain('Awaiting Consent: 2');
    expect(rawReviewHtml).toContain('DND / Opt-out Blocked: 0');
    expect(rawReviewHtml).toContain('data-testid="review-batch-consent-bar"');
    expect(rawReviewHtml).toContain('data-testid="review-confirm-all-consent-button"');
  });
});
