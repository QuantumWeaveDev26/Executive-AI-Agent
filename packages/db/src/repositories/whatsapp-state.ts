import type { ApprovalRequest, MetaWhatsAppAnySendInput, MetaWhatsAppSendInput, MetaWhatsAppTestConfig, N8nWhatsAppReceipt, MetaWhatsAppStoredMedia, WhatsAppStoredAutoReplyMetadata, WhatsAppStoredFailureMetadata } from '@thaara/contracts';
import type { AuthenticatedScope, WhatsAppExecutionScope, WhatsAppRelayOperation, WhatsAppRelayScope } from '../client.js';

export interface WhatsAppMessageRecord {
  providerMessageId: string;
  recipientId: string;
  senderMaskedPhone: string;
  textPreview: string;
  timestamp: string;
  mode: 'offline_test';
  untrusted: true;
  media?: MetaWhatsAppStoredMedia;
  autoReply?: WhatsAppStoredAutoReplyMetadata;
}
export interface WhatsAppDispatchRecord {
  id: string;
  draft: MetaWhatsAppAnySendInput;
  parameterHash: string;
  approvalId: string;
  createdAt: number;
  expiresAt: number;
  claimedAt: number | null;
  receipt: N8nWhatsAppReceipt;
}
export interface WhatsAppStatusRecord {
  key: string;
  providerMessageId: string;
  recipientAddress: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  failure?: WhatsAppStoredFailureMetadata;
}
export interface WhatsAppDurableState {
  binding: MetaWhatsAppTestConfig;
  disconnected: boolean;
  messages: WhatsAppMessageRecord[];
  dispatches: WhatsAppDispatchRecord[];
  events: WhatsAppStatusRecord[];
}
export interface WhatsAppStateTransaction {
  state: WhatsAppDurableState;
  assertAuthorized(): Promise<void>;
  /** Resolve and lock the existing approval in this same transaction. */
  approval(id: string): Promise<ApprovalRequest | null>;
  /** Issues an approved standing ApprovalRequest ID for an eligible customer-service auto-reply draft in this transaction. */
  createAutoReplyApproval?(draft: MetaWhatsAppSendInput): Promise<string>;
  audit(action: string, details: { dispatchId?: string; revision?: number; messages?: number; statuses?: number }): Promise<void>;
}
export interface WhatsAppStateStore {
  resolveRelay?(tokenHash: string, connectionId: string, operation: WhatsAppRelayOperation): Promise<WhatsAppRelayScope>;
  resolveAutoReplyOwnerScope?(scope: WhatsAppExecutionScope, connectionId: string): Promise<AuthenticatedScope | null>;
  resolveAutoReplyOwnerScopeByConnection?(connectionId: string): Promise<AuthenticatedScope | null>;
  listOwned?(scope: AuthenticatedScope): Promise<Array<{ connectionId: string; revision: number; disconnected: boolean }>>;
  /** Serialize all work on one scoped connection; commit state and audits together. */
  transaction<T>(scope: WhatsAppExecutionScope, connectionId: string, operation: (tx: WhatsAppStateTransaction) => Promise<T>): Promise<T>;
}
