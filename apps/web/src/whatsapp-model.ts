import {
  WhatsAppListMessagesResponse,
  WhatsAppMessage,
  WhatsAppStatus,
  WhatsAppThreadSummary,
  disconnectWhatsApp,
  getWhatsAppStatus,
  listWhatsAppMessages,
  readWhatsAppMessage,
  whatsappError
} from './whatsapp-api';

export type WhatsAppErrorKind = ReturnType<typeof whatsappError>;

export interface WhatsAppState {
  status: WhatsAppStatus | null;
  threads: WhatsAppThreadSummary[];
  messages: WhatsAppMessage[];
  preview: WhatsAppMessage | null;
  selectedThreadId: string | null;
  selectedMessageId: string | null;
  query: string;
  nextPageToken?: string;
  connectionLoading: boolean;
  listLoading: boolean;
  previewLoading: boolean;
  disconnecting: boolean;
  searched: boolean;
  unauthorized: boolean;
  connectionError: WhatsAppErrorKind | null;
  listError: WhatsAppErrorKind | null;
  previewError: WhatsAppErrorKind | null;
}

export const initialWhatsAppState = (role: string): WhatsAppState => ({
  status: null,
  threads: [],
  messages: [],
  preview: null,
  selectedThreadId: null,
  selectedMessageId: null,
  query: '',
  connectionLoading: false,
  listLoading: false,
  previewLoading: false,
  disconnecting: false,
  searched: false,
  unauthorized: !['owner', 'admin', 'member'].includes(role),
  connectionError: null,
  listError: null,
  previewError: null
});

export const canReadWhatsApp = (state: WhatsAppState): boolean =>
  !state.unauthorized &&
  state.status?.mode === 'mock' &&
  state.status.configured &&
  state.status.connected &&
  state.status.status === 'connected';

export const canDisconnectWhatsApp = (state: WhatsAppState): boolean =>
  !state.unauthorized &&
  state.status?.mode === 'mock' &&
  state.status.configured &&
  ['connected', 'reconnect_required'].includes(state.status.status);

export interface WhatsAppApi {
  status(signal?: AbortSignal): Promise<WhatsAppStatus>;
  list(
    input: { threadId?: string; query?: string; pageToken?: string },
    signal?: AbortSignal
  ): Promise<WhatsAppListMessagesResponse>;
  read(id: string, signal?: AbortSignal): Promise<WhatsAppMessage>;
  disconnect(signal?: AbortSignal): Promise<WhatsAppStatus>;
}

const defaultApi: WhatsAppApi = {
  status: getWhatsAppStatus,
  list: listWhatsAppMessages,
  read: readWhatsAppMessage,
  disconnect: disconnectWhatsApp
};

export function createWhatsAppModel(
  role: string,
  publish: (state: WhatsAppState) => void,
  api: WhatsAppApi = defaultApi
) {
  let state = initialWhatsAppState(role);
  let disposed = false;
  let epoch = 0;
  let listVersion = 0;
  let previewVersion = 0;
  let abort = new AbortController();
  const allowed = ['owner', 'admin', 'member'].includes(role);

  const emit = (next: Partial<WhatsAppState>) => {
    if (!disposed) {
      state = { ...state, ...next };
      publish(state);
    }
  };

  const reset = () => {
    epoch++;
    listVersion++;
    previewVersion++;
    abort.abort();
    abort = new AbortController();
  };

  const clearListState: Partial<WhatsAppState> = {
    threads: [],
    messages: [],
    preview: null,
    selectedMessageId: null,
    nextPageToken: undefined,
    listLoading: false,
    previewLoading: false,
    searched: false,
    listError: null,
    previewError: null
  };

  const failClosed = (error: unknown): boolean => {
    const kind = whatsappError(error);
    if (kind === 'unauthorized' || kind === 'reconnect') {
      reset();
      emit({
        ...clearListState,
        selectedThreadId: null,
        status: null,
        connectionLoading: false,
        disconnecting: false,
        unauthorized: kind === 'unauthorized',
        connectionError: kind
      });
      return true;
    }
    return false;
  };

  async function search(
    query: string,
    threadId: string | null = state.selectedThreadId,
    pageToken?: string
  ) {
    if (!allowed || !canReadWhatsApp(state) || state.connectionLoading || state.disconnecting || disposed) {
      return;
    }
    const trimmed = query.trim();
    const current = epoch;
    const version = ++listVersion;
    previewVersion++;

    emit({
      ...clearListState,
      selectedThreadId: threadId,
      listLoading: true,
      query: trimmed,
      searched: true
    });

    try {
      const response = await api.list(
        {
          ...(threadId ? { threadId } : {}),
          ...(trimmed ? { query: trimmed } : {}),
          ...(pageToken ? { pageToken } : {})
        },
        abort.signal
      );
      if (disposed || current !== epoch || version !== listVersion) {
        return;
      }
      emit({
        threads: response.threads,
        messages: response.messages,
        nextPageToken: response.nextPageToken,
        listLoading: false
      });
    } catch (error) {
      if (!disposed && current === epoch && version === listVersion && !failClosed(error)) {
        emit({ listLoading: false, listError: whatsappError(error) });
      }
    }
  }

  async function loadStatus() {
    if (disposed || !allowed || state.disconnecting) {
      return;
    }
    reset();
    const current = epoch;
    emit({
      ...clearListState,
      selectedThreadId: null,
      status: null,
      connectionLoading: true,
      connectionError: null,
      unauthorized: false
    });

    try {
      const status = await api.status(abort.signal);
      if (disposed || current !== epoch) {
        return;
      }
      emit({ status, connectionLoading: false });
      if (canReadWhatsApp(state)) {
        await search('', null);
      }
    } catch (error) {
      if (!disposed && current === epoch && !failClosed(error)) {
        emit({ connectionLoading: false, connectionError: whatsappError(error) });
      }
    }
  }

  async function selectThread(threadId: string | null) {
    if (disposed || !canReadWhatsApp(state) || state.connectionLoading || state.disconnecting) {
      return;
    }
    await search(state.query, threadId);
  }

  async function selectMessage(id: string) {
    if (
      disposed ||
      !canReadWhatsApp(state) ||
      state.listLoading ||
      !state.messages.some((m) => m.id === id)
    ) {
      return;
    }
    const current = epoch;
    const list = listVersion;
    const version = ++previewVersion;
    emit({ preview: null, selectedMessageId: id, previewLoading: true, previewError: null });

    try {
      const preview = await api.read(id, abort.signal);
      if (!disposed && current === epoch && list === listVersion && version === previewVersion) {
        emit({ preview, previewLoading: false });
      }
    } catch (error) {
      if (
        !disposed &&
        current === epoch &&
        list === listVersion &&
        version === previewVersion &&
        !failClosed(error)
      ) {
        emit({ previewLoading: false, previewError: whatsappError(error) });
      }
    }
  }

  async function disconnect() {
    if (disposed || !allowed || !canDisconnectWhatsApp(state) || state.disconnecting) {
      return;
    }
    reset();
    const current = epoch;
    emit({
      ...clearListState,
      selectedThreadId: null,
      status: null,
      connectionLoading: false,
      disconnecting: true,
      connectionError: null
    });

    try {
      const status = await api.disconnect(abort.signal);
      if (!disposed && current === epoch) {
        emit({ status, disconnecting: false });
      }
    } catch (error) {
      if (!disposed && current === epoch && !failClosed(error)) {
        emit({ disconnecting: false, connectionError: whatsappError(error) });
      }
    }
  }

  return {
    loadStatus,
    search: (q: string) => search(q, state.selectedThreadId),
    selectThread,
    selectMessage,
    disconnect,
    next: () =>
      state.nextPageToken
        ? search(state.query, state.selectedThreadId, state.nextPageToken)
        : Promise.resolve(),
    getState: () => state,
    dispose: () => {
      disposed = true;
      reset();
    }
  };
}
