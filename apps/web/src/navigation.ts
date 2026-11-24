export type WorkspacePageId =
  | 'dashboard'
  | 'new-conversation'
  | 'conversation-history'
  | 'automations'
  | 'gmail'
  | 'whatsapp'
  | 'phone'
  | 'phone-contacts'
  | 'phone-history'
  | 'phone-inbound'
  | 'phone-outbound'
  | 'calendar'
  | 'drive'
  | 'bulk-campaign'
  | 'bulk-campaign-create'
  | 'bulk-campaign-history'
  | 'settings'
  | 'not-found';

export type IntegrationPageId =
  | 'gmail'
  | 'whatsapp'
  | 'phone'
  | 'phone-contacts'
  | 'phone-history'
  | 'phone-inbound'
  | 'phone-outbound'
  | 'calendar'
  | 'drive'
  | 'bulk-campaign'
  | 'bulk-campaign-create'
  | 'bulk-campaign-history';

export interface NavItemDefinition {
  id: Exclude<WorkspacePageId, 'not-found'>;
  label: string;
  path: string;
  section: 'primary' | 'integrations' | 'footer';
  description: string;
  /** Set on sub-pages shown in a dropdown under their parent item in the sidebar. */
  parent?: 'phone' | 'bulk-campaign';
}

export interface ThaaraUiVisibility {
  readonly automations: boolean;
  readonly bulkCampaigns: boolean;
  readonly n8nSettingsConnection: boolean;
}

/**
 * Recoverable UI visibility switches.
 * Flip `automations` or `bulkCampaigns` back to `true` to restore their full UI surfaces
 * without recreating backend services, components, or stored database records.
 */
export const UI_VISIBILITY: ThaaraUiVisibility = {
  automations: false,
  bulkCampaigns: true,
  n8nSettingsConnection: false,
};

export const INTEGRATION_PAGES: ReadonlyArray<IntegrationPageId> = [
  'gmail',
  'whatsapp',
  'phone',
  'phone-contacts',
  'phone-history',
  'phone-inbound',
  'phone-outbound',
  'calendar',
  'drive',
  ...(UI_VISIBILITY.bulkCampaigns
    ? (['bulk-campaign', 'bulk-campaign-create', 'bulk-campaign-history'] as const)
    : []),
];

const ALL_NAV_ITEMS: ReadonlyArray<NavItemDefinition> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/dashboard',
    section: 'primary',
    description: 'Your executive workspace at a glance.',
  },
  {
    id: 'new-conversation',
    label: 'New Conversation',
    path: '/chat',
    section: 'primary',
    description: 'Governed executive AI assistant with real-time streaming and approval gates.',
  },
  {
    id: 'conversation-history',
    label: 'Conversation History',
    path: '/history',
    section: 'primary',
    description: 'Browse, search, and resume past governed executive threads.',
  },
  {
    id: 'automations',
    label: 'Automations',
    path: '/automations',
    section: 'primary',
    description: 'Inspect offline automation plans, approval gates, and verified execution receipts.',
  },
  {
    id: 'gmail',
    label: 'Gmail',
    path: '/integrations/gmail',
    section: 'integrations',
    description: 'Read-only executive inbox inspection with strict plain-text sanitization.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp Business',
    path: '/integrations/whatsapp',
    section: 'integrations',
    description: 'Read-only WhatsApp Business threads and message history with masked phone numbers.',
  },
  {
    id: 'phone',
    label: 'Phone & Calls',
    path: '/integrations/phone',
    section: 'integrations',
    description: 'Ask Thaara to call a saved contact. Every call needs your click before it dials.',
  },
  {
    id: 'phone-contacts',
    label: 'Contacts',
    path: '/integrations/phone/contacts',
    section: 'integrations',
    parent: 'phone',
    description: 'People Thaara may call for you.',
  },
  {
    id: 'phone-history',
    label: 'Call history',
    path: '/integrations/phone/history',
    section: 'integrations',
    parent: 'phone',
    description: 'Calls Thaara made for you and what each person said.',
  },
  {id:'phone-inbound',label:'Inbound calls',path:'/integrations/phone/inbound',section:'integrations',parent:'phone',description:'Customer enquiries and team callback requests.'},
  {id:'phone-outbound',label:'Outbound calls',path:'/integrations/phone/outbound',section:'integrations',parent:'phone',description:'Owner-approved calls and their actual results.'},
  {
    id: 'calendar',
    label: 'Google Calendar',
    path: '/integrations/calendar',
    section: 'integrations',
    description: 'Read-only executive schedule, conflict detection, and agenda inspection.',
  },
  {
    id: 'drive',
    label: 'Google Drive',
    path: '/integrations/drive',
    section: 'integrations',
    description: 'Governed executive Drive search, document summarization, creation, and token-bound sharing.',
  },
  {
    id: 'bulk-campaign',
    label: 'Bulk Campaigns',
    path: '/integrations/bulk-campaign',
    section: 'integrations',
    description: 'Governed WhatsApp & Sarvam AI Phone bulk outreach with per-call approval and CSV reporting.',
  },
  {
    id: 'bulk-campaign-create',
    label: 'Create Campaign',
    path: '/integrations/bulk-campaign/create',
    section: 'integrations',
    parent: 'bulk-campaign',
    description: 'Create, review, approve, and execute governed bulk outreach campaigns.',
  },
  {
    id: 'bulk-campaign-history',
    label: 'Campaign History',
    path: '/integrations/bulk-campaign/history',
    section: 'integrations',
    parent: 'bulk-campaign',
    description: 'Browse all historical and active bulk campaigns, outcomes, recordings, and transcripts.',
  },
  {
    id: 'settings',
    label: 'Customizations / Settings',
    path: '/settings',
    section: 'footer',
    description: UI_VISIBILITY.n8nSettingsConnection
      ? 'Workspace configuration, n8n connection profiles, diagnostics, and tenant audit ledger.'
      : 'Workspace configuration, diagnostics, and tenant audit ledger.',
  },
];

export const NAV_ITEMS: ReadonlyArray<NavItemDefinition> = ALL_NAV_ITEMS.filter((item) => {
  if (item.id === 'automations' && !UI_VISIBILITY.automations) return false;
  if (
    (item.id === 'bulk-campaign' ||
      item.id === 'bulk-campaign-create' ||
      item.id === 'bulk-campaign-history') &&
    !UI_VISIBILITY.bulkCampaigns
  ) {
    return false;
  }
  return true;
});

const PATH_TO_PAGE: Record<string, WorkspacePageId> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/chat': 'new-conversation',
  '/new-conversation': 'new-conversation',
  '/history': 'conversation-history',
  '/conversation-history': 'conversation-history',
  ...(UI_VISIBILITY.automations ? { '/automations': 'automations' as const } : {}),
  '/integrations/gmail': 'gmail',
  '/gmail': 'gmail',
  '/integrations/whatsapp': 'whatsapp',
  '/whatsapp': 'whatsapp',
  '/integrations/phone': 'phone',
  '/phone': 'phone',
  '/integrations/phone/contacts': 'phone-contacts',
  '/integrations/phone/history': 'phone-history',
  '/integrations/phone/inbound': 'phone-inbound',
  '/integrations/phone/outbound': 'phone-outbound',
  '/integrations/calendar': 'calendar',
  '/calendar': 'calendar',
  '/integrations/drive': 'drive',
  '/drive': 'drive',
  '/google-drive': 'drive',
  ...(UI_VISIBILITY.bulkCampaigns
    ? {
        '/integrations/bulk-campaign': 'bulk-campaign' as const,
        '/integrations/bulk-campaigns': 'bulk-campaign' as const,
        '/bulk-campaign': 'bulk-campaign' as const,
        '/bulk-campaigns': 'bulk-campaign' as const,
        '/integrations/bulk-campaign/create': 'bulk-campaign-create' as const,
        '/bulk-campaigns/create': 'bulk-campaign-create' as const,
        '/integrations/bulk-campaign/history': 'bulk-campaign-history' as const,
        '/bulk-campaigns/history': 'bulk-campaign-history' as const,
      }
    : {}),
  '/settings': 'settings',
  '/customizations': 'settings',
};

export function isIntegrationPage(page: WorkspacePageId): page is IntegrationPageId {
  return (INTEGRATION_PAGES as ReadonlyArray<string>).includes(page);
}

export function shouldExpandIntegrations(
  activePage: WorkspacePageId,
  manualExpanded: boolean,
): boolean {
  if (isIntegrationPage(activePage)) {
    return true;
  }
  return manualExpanded;
}

export function getPathForPage(page: WorkspacePageId): string {
  const found = NAV_ITEMS.find((item) => item.id === page);
  return found ? found.path : '/dashboard';
}

export function getPageMeta(page: WorkspacePageId): { title: string; subtitle: string } {
  const found = NAV_ITEMS.find((item) => item.id === page);
  if (found) {
    return { title: found.label, subtitle: found.description };
  }
  return {
    title: 'Page Not Found',
    subtitle: 'The requested workspace route does not exist.',
  };
}

export function resolvePageFromLocation(
  pathname = '/',
  hash = '',
): WorkspacePageId {
  const cleanedHash = hash.replace(/^#/, '').trim().toLowerCase();
  if (cleanedHash) {
    const hashNormalized = cleanedHash.startsWith('/') ? cleanedHash : `/${cleanedHash}`;
    if (PATH_TO_PAGE[hashNormalized]) {
      return PATH_TO_PAGE[hashNormalized];
    }
  }

  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1).toLowerCase()
      : (pathname || '/').toLowerCase();

  if (
    UI_VISIBILITY.bulkCampaigns &&
    (normalizedPath.startsWith('/integrations/bulk-campaign/history/') ||
      normalizedPath.startsWith('/bulk-campaigns/history/'))
  ) {
    return 'bulk-campaign-history';
  }

  return PATH_TO_PAGE[normalizedPath] ?? 'not-found';
}

export function extractBulkCampaignIdFromLocation(
  pathname = typeof window !== 'undefined' ? window.location.pathname : '/',
  search = typeof window !== 'undefined' ? window.location.search : '',
): string | null {
  const match = pathname.match(/\/(?:integrations\/bulk-campaign|bulk-campaigns)\/history\/([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    return match[1];
  }
  try {
    const params = new URLSearchParams(search);
    const id = params.get('campaignId');
    return id && /^[a-zA-Z0-9_-]{3,128}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function readInitialPage(): WorkspacePageId {
  if (typeof window === 'undefined') {
    return 'dashboard';
  }
  return resolvePageFromLocation(window.location.pathname, window.location.hash);
}

export function pushWorkspaceHistory(page: WorkspacePageId, replace = false): void {
  if (typeof window === 'undefined') {
    return;
  }
  const targetPath = getPathForPage(page);
  try {
    if (replace) {
      window.history.replaceState({ thaaraPage: page }, '', targetPath);
    } else if (window.location.pathname !== targetPath) {
      window.history.pushState({ thaaraPage: page }, '', targetPath);
    }
  } catch {
    // Fallback in restricted environments
  }
}
