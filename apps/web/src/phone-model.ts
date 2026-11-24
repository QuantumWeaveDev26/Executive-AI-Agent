import {
  fetchPhoneStatus,
  listPhoneCalls,
  readPhoneCall,
  disconnectPhone,
  PhoneApiError,
  type PhoneStatus,
  type PhoneCallRecord,
  type PhoneCallDirection,
  type PhoneCallLifecycleState,
  type PhoneRole,
} from './phone-api';

export interface PhoneScreenState {
  workspaceId: string;
  userId: string;
  role: PhoneRole;
  loadingStatus: boolean;
  loadingCalls: boolean;
  loadingCallDetail: boolean;
  disconnecting: boolean;
  status: PhoneStatus | null;
  calls: PhoneCallRecord[];
  selectedCall: PhoneCallRecord | null;
  searchQuery: string;
  directionFilter: PhoneCallDirection | 'all';
  lifecycleFilter: PhoneCallLifecycleState | 'all';
  nextPageToken: string | undefined;
  totalCount: number;
  errorMessage: string | null;
  unauthorized: boolean;
}

const AUTHORIZED_ROLES: ReadonlySet<PhoneRole> = new Set<PhoneRole>(['owner', 'admin', 'member']);

export function canAccessPhone(role: PhoneRole): boolean {
  return AUTHORIZED_ROLES.has(role);
}

export class PhoneScreenModel {
  private state: PhoneScreenState;
  private listeners: Set<(state: PhoneScreenState) => void> = new Set();
  private requestVersion = 0;

  constructor(workspaceId: string, userId: string, role: PhoneRole) {
    const allowed = canAccessPhone(role);
    this.state = {
      workspaceId,
      userId,
      role,
      loadingStatus: false,
      loadingCalls: false,
      loadingCallDetail: false,
      disconnecting: false,
      status: null,
      calls: [],
      selectedCall: null,
      searchQuery: '',
      directionFilter: 'all',
      lifecycleFilter: 'all',
      nextPageToken: undefined,
      totalCount: 0,
      errorMessage: allowed
        ? null
        : 'Your workspace role (viewer) is not permitted to access Phone telephony.',
      unauthorized: !allowed,
    };
  }

  public getState(): PhoneScreenState {
    return { ...this.state };
  }

  public subscribe(listener: (state: PhoneScreenState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(patch: Partial<PhoneScreenState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  public async loadStatusAndCalls(): Promise<void> {
    if (!canAccessPhone(this.state.role)) {
      this.updateState({
        unauthorized: true,
        status: null,
        calls: [],
        selectedCall: null,
        totalCount: 0,
        errorMessage: `Your workspace role (${this.state.role}) is not permitted to access Phone telephony.`,
      });
      return;
    }

    const version = ++this.requestVersion;
    this.updateState({
      loadingStatus: true,
      errorMessage: null,
      unauthorized: false,
    });

    try {
      const status = await fetchPhoneStatus();
      if (version !== this.requestVersion) return;

      this.updateState({
        loadingStatus: false,
        status,
      });

      if (status.status === 'connected' && status.connected && status.mode === 'mock') {
        await this.loadCalls({ resetSelection: true });
      } else {
        this.updateState({
          calls: [],
          selectedCall: null,
          nextPageToken: undefined,
          totalCount: 0,
        });
      }
    } catch (err) {
      if (version !== this.requestVersion) return;
      this.handleApiError(err, 'loadingStatus');
    }
  }

  public async loadCalls(options?: {
    query?: string;
    direction?: PhoneCallDirection | 'all';
    lifecycleState?: PhoneCallLifecycleState | 'all';
    pageToken?: string;
    resetSelection?: boolean;
  }): Promise<void> {
    if (!canAccessPhone(this.state.role)) {
      return;
    }

    const query = options?.query !== undefined ? options.query : this.state.searchQuery;
    const direction = options?.direction !== undefined ? options.direction : this.state.directionFilter;
    const lifecycleState =
      options?.lifecycleState !== undefined ? options.lifecycleState : this.state.lifecycleFilter;

    const version = ++this.requestVersion;
    this.updateState({
      loadingCalls: true,
      searchQuery: query,
      directionFilter: direction,
      lifecycleFilter: lifecycleState,
      errorMessage: null,
      ...(options?.resetSelection ? { selectedCall: null } : {}),
    });

    try {
      const res = await listPhoneCalls({
        query: query.trim() || undefined,
        direction: direction === 'all' ? undefined : direction,
        lifecycleState: lifecycleState === 'all' ? undefined : lifecycleState,
        pageToken: options?.pageToken,
        limit: 20,
      });
      if (version !== this.requestVersion) return;

      const calls = options?.pageToken ? [...this.state.calls, ...res.calls] : res.calls;
      const firstCall = calls[0] ?? null;
      const selectedCall =
        options?.resetSelection || !this.state.selectedCall
          ? firstCall
          : calls.find((c) => c.id === this.state.selectedCall?.id) ?? firstCall;

      this.updateState({
        loadingCalls: false,
        calls,
        selectedCall,
        nextPageToken: res.nextPageToken,
        totalCount: res.totalCount,
      });
    } catch (err) {
      if (version !== this.requestVersion) return;
      this.handleApiError(err, 'loadingCalls');
    }
  }

  public async selectCall(callId: string): Promise<void> {
    if (!canAccessPhone(this.state.role)) {
      return;
    }

    const version = ++this.requestVersion;
    this.updateState({
      loadingCallDetail: true,
      errorMessage: null,
    });

    try {
      const callRecord = await readPhoneCall(callId);
      if (version !== this.requestVersion) return;

      this.updateState({
        loadingCallDetail: false,
        selectedCall: callRecord,
      });
    } catch (err) {
      if (version !== this.requestVersion) return;
      this.handleApiError(err, 'loadingCallDetail');
    }
  }

  public async disconnect(): Promise<void> {
    if (!canAccessPhone(this.state.role)) {
      return;
    }

    const version = ++this.requestVersion;
    this.updateState({
      disconnecting: true,
      errorMessage: null,
    });

    try {
      await disconnectPhone();
      if (version !== this.requestVersion) return;

      this.updateState({
        disconnecting: false,
        calls: [],
        selectedCall: null,
        nextPageToken: undefined,
        totalCount: 0,
        status: this.state.status
          ? {
              ...this.state.status,
              status: 'disconnected',
              connected: false,
              maskedLineNumber: undefined,
            }
          : null,
      });
    } catch (err) {
      if (version !== this.requestVersion) return;
      this.handleApiError(err, 'disconnecting');
    }
  }

  private handleApiError(
    err: unknown,
    loadingFlag: 'loadingStatus' | 'loadingCalls' | 'loadingCallDetail' | 'disconnecting',
  ): void {
    const resetFlags: Partial<PhoneScreenState> = {
      loadingStatus: false,
      loadingCalls: false,
      loadingCallDetail: false,
      disconnecting: false,
      [loadingFlag]: false,
    };

    if (err instanceof PhoneApiError) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        this.updateState({
          ...resetFlags,
          unauthorized: true,
          status: null,
          calls: [],
          selectedCall: null,
          nextPageToken: undefined,
          totalCount: 0,
          errorMessage: err.message || 'Access denied by workspace policy gateway.',
        });
        return;
      }

      if (err.statusCode === 409 || err.statusCode === 503) {
        this.updateState({
          ...resetFlags,
          calls: [],
          selectedCall: null,
          nextPageToken: undefined,
          totalCount: 0,
          errorMessage: err.message,
        });
        return;
      }

      this.updateState({
        ...resetFlags,
        errorMessage: err.message,
      });
      return;
    }

    this.updateState({
      ...resetFlags,
      errorMessage: err instanceof Error ? err.message : 'Unexpected Phone connector error.',
    });
  }
}
