import {
  CalendarAgendaResult,
  CalendarEvent,
  CalendarOAuthStartResult,
  CalendarStatus,
  calendarError,
  disconnectCalendar,
  getCalendarAgenda,
  getCalendarStatus,
  isValidTimeZone,
  readCalendarEvent,
  startCalendarOAuth
} from './calendar-api';
import { CalendarRangePreset, computeCalendarPresetWindow } from './integration-ui';

export type CalendarErrorKind = ReturnType<typeof calendarError>;

export interface CalendarState {
  status: CalendarStatus | null;
  agenda: CalendarAgendaResult | null;
  selectedEvent: CalendarEvent | null;
  selectedId: string | null;
  rangePreset?: CalendarRangePreset;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  includeCancelled: boolean;
  connectionLoading: boolean;
  connecting?: boolean;
  agendaLoading: boolean;
  detailLoading: boolean;
  disconnecting: boolean;
  loaded: boolean;
  unauthorized: boolean;
  connectionError: CalendarErrorKind | null;
  agendaError: CalendarErrorKind | null;
  detailError: CalendarErrorKind | null;
}

export function defaultCalendarWindow(nowMs = Date.now()): { windowStart: string; windowEnd: string } {
  const d = new Date(nowMs);
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
  return {
    windowStart: new Date(startMs).toISOString().replace('.000Z', 'Z'),
    windowEnd: new Date(endMs).toISOString().replace('.000Z', 'Z')
  };
}

export function initialCalendarState(
  role: string,
  options: { nowMs?: number; timeZone?: string; rangePreset?: CalendarRangePreset } = {}
): CalendarState {
  const tz = options.timeZone && isValidTimeZone(options.timeZone) ? options.timeZone : 'UTC';
  const preset = options.rangePreset ?? 'next_7_days';
  const { windowStart, windowEnd } = options.rangePreset
    ? computeCalendarPresetWindow(options.rangePreset, tz, options.nowMs)
    : defaultCalendarWindow(options.nowMs);
  return {
    status: null,
    agenda: null,
    selectedEvent: null,
    selectedId: null,
    rangePreset: preset,
    windowStart,
    windowEnd,
    timeZone: tz,
    includeCancelled: false,
    connectionLoading: false,
    connecting: false,
    agendaLoading: false,
    detailLoading: false,
    disconnecting: false,
    loaded: false,
    unauthorized: !['owner', 'admin', 'member'].includes(role),
    connectionError: null,
    agendaError: null,
    detailError: null
  };
}

export const canReadCalendar = (state: CalendarState) =>
  !state.unauthorized &&
  (state.status?.mode === 'mock' || state.status?.mode === 'live') &&
  state.status.configured &&
  state.status.connected &&
  state.status.status === 'connected';

export const canDisconnectCalendar = (state: CalendarState) =>
  !state.unauthorized &&
  (state.status?.mode === 'mock' || state.status?.mode === 'live') &&
  state.status.configured &&
  ['connected', 'reconnect_required'].includes(state.status.status);

export const canConnectCalendar = (state: CalendarState) =>
  !state.unauthorized &&
  state.status?.mode === 'live' &&
  state.status.configured &&
  !state.status.connected &&
  ['disconnected', 'reconnect_required'].includes(state.status.status);

export interface CalendarApi {
  status(signal?: AbortSignal): Promise<CalendarStatus>;
  startOAuth?(signal?: AbortSignal): Promise<CalendarOAuthStartResult>;
  agenda(
    input: {
      windowStart: string;
      windowEnd: string;
      timeZone: string;
      includeCancelled?: boolean;
    },
    signal?: AbortSignal
  ): Promise<CalendarAgendaResult>;
  readEvent(id: string, signal?: AbortSignal): Promise<CalendarEvent>;
  disconnect(signal?: AbortSignal): Promise<CalendarStatus>;
}

const defaultApi: CalendarApi = {
  status: (signal) => getCalendarStatus(signal, { allowLiveMode: true }),
  startOAuth: (signal) => startCalendarOAuth(signal, { allowLiveMode: true }),
  agenda: (input, signal) => getCalendarAgenda(input, signal, { allowLiveMode: true }),
  readEvent: (id, signal) => readCalendarEvent(id, signal, { allowLiveMode: true }),
  disconnect: (signal) => disconnectCalendar(signal, { allowLiveMode: true })
};

export function createCalendarModel(
  role: string,
  publish: (state: CalendarState) => void,
  api: CalendarApi = defaultApi,
  options: { nowMs?: number; timeZone?: string; rangePreset?: CalendarRangePreset } = {}
) {
  let state = initialCalendarState(role, options);
  let presetMode = Boolean(options.rangePreset);
  let disposed = false;
  let epoch = 0;
  let agendaVersion = 0;
  let detailVersion = 0;
  let abort = new AbortController();
  const allowed = ['owner', 'admin', 'member'].includes(role);

  const emit = (next: Partial<CalendarState>) => {
    if (!disposed) {
      state = { ...state, ...next };
      publish(state);
    }
  };

  const reset = () => {
    epoch++;
    agendaVersion++;
    detailVersion++;
    abort.abort();
    abort = new AbortController();
  };

  const clearPrivate: Partial<CalendarState> = {
    agenda: null,
    selectedEvent: null,
    selectedId: null,
    agendaLoading: false,
    detailLoading: false,
    loaded: false,
    agendaError: null,
    detailError: null
  };

  const failClosed = (error: unknown) => {
    const kind = calendarError(error);
    if (kind === 'unauthorized' || kind === 'reconnect') {
      reset();
      emit({
        ...clearPrivate,
        status: null,
        connectionLoading: false,
        connecting: false,
        disconnecting: false,
        unauthorized: kind === 'unauthorized',
        connectionError: kind
      });
      return true;
    }
    return false;
  };

  async function loadAgenda(overrides?: {
    windowStart?: string;
    windowEnd?: string;
    timeZone?: string;
    includeCancelled?: boolean;
  }) {
    if (!allowed || !canReadCalendar(state) || state.connectionLoading || state.disconnecting || disposed) {
      return;
    }
    const windowStart = overrides?.windowStart ?? state.windowStart;
    const windowEnd = overrides?.windowEnd ?? state.windowEnd;
    const timeZone = overrides?.timeZone ?? state.timeZone;
    const includeCancelled = overrides?.includeCancelled ?? state.includeCancelled;
    if (!isValidTimeZone(timeZone)) {
      emit({
        ...clearPrivate,
        agendaError: 'invalid_query',
        loaded: true
      });
      return;
    }
    const current = epoch;
    const version = ++agendaVersion;
    detailVersion++;
    emit({
      ...clearPrivate,
      windowStart,
      windowEnd,
      timeZone,
      includeCancelled,
      agendaLoading: true,
      loaded: true
    });
    try {
      const agenda = await api.agenda(
        { windowStart, windowEnd, timeZone, includeCancelled },
        abort.signal
      );
      if (disposed || current !== epoch || version !== agendaVersion) return;
      emit({ agenda, agendaLoading: false, agendaError: null });
    } catch (error) {
      if (!disposed && current === epoch && version === agendaVersion && !failClosed(error)) {
        emit({ agendaLoading: false, agendaError: calendarError(error) });
      }
    }
  }

  async function loadStatus() {
    if (disposed || !allowed || state.disconnecting) return;
    reset();
    const current = epoch;
    emit({
      ...clearPrivate,
      status: null,
      connectionLoading: true,
      connecting: false,
      connectionError: null,
      unauthorized: false
    });
    try {
      const status = await api.status(abort.signal);
      if (disposed || current !== epoch) return;
      emit({ status, connectionLoading: false });
      if (canReadCalendar(state)) {
        await loadAgenda();
      }
    } catch (error) {
      if (!disposed && current === epoch && !failClosed(error)) {
        emit({ connectionLoading: false, connectionError: calendarError(error) });
      }
    }
  }

  async function shiftWindow(days: number) {
    presetMode = false;
    const deltaMs = days * 24 * 60 * 60 * 1000;
    const nextStart = new Date(Date.parse(state.windowStart) + deltaMs)
      .toISOString()
      .replace('.000Z', 'Z');
    const nextEnd = new Date(Date.parse(state.windowEnd) + deltaMs)
      .toISOString()
      .replace('.000Z', 'Z');
    emit({
      rangePreset: days < 0 ? 'prev_7_days' : 'next_7_days'
    });
    await loadAgenda({ windowStart: nextStart, windowEnd: nextEnd });
  }

  async function selectRangePreset(
    preset: CalendarRangePreset,
    nowMs = options.nowMs ?? Date.now()
  ) {
    presetMode = true;
    const { windowStart, windowEnd } = computeCalendarPresetWindow(
      preset,
      state.timeZone,
      nowMs
    );
    emit({ rangePreset: preset });
    await loadAgenda({ windowStart, windowEnd });
  }

  async function resetToToday(nowMs = options.nowMs ?? Date.now()) {
    await selectRangePreset('today', nowMs);
  }

  async function setTimeZone(timeZone: string) {
    const trimmed = timeZone.trim();
    if (presetMode && isValidTimeZone(trimmed)) {
      const activePreset = state.rangePreset ?? 'today';
      const { windowStart, windowEnd } = computeCalendarPresetWindow(
        activePreset,
        trimmed,
        options.nowMs ?? Date.now()
      );
      await loadAgenda({ timeZone: trimmed, windowStart, windowEnd });
      return;
    }
    await loadAgenda({ timeZone: trimmed });
  }

  async function toggleCancelled(includeCancelled: boolean) {
    await loadAgenda({ includeCancelled });
  }

  async function selectEvent(id: string) {
    const known = state.agenda?.days.some((d) => d.events.some((ev) => ev.id === id));
    if (disposed || !canReadCalendar(state) || state.agendaLoading || !known) return;
    const current = epoch;
    const agVer = agendaVersion;
    const version = ++detailVersion;
    emit({
      selectedEvent: null,
      selectedId: id,
      detailLoading: true,
      detailError: null
    });
    try {
      const selectedEvent = await api.readEvent(id, abort.signal);
      if (!disposed && current === epoch && agVer === agendaVersion && version === detailVersion) {
        emit({ selectedEvent, detailLoading: false });
      }
    } catch (error) {
      if (
        !disposed &&
        current === epoch &&
        agVer === agendaVersion &&
        version === detailVersion &&
        !failClosed(error)
      ) {
        emit({ detailLoading: false, detailError: calendarError(error) });
      }
    }
  }

  async function connect(): Promise<string | null> {
    if (
      disposed ||
      !allowed ||
      !canConnectCalendar(state) ||
      state.connecting ||
      state.disconnecting ||
      !api.startOAuth
    ) {
      return null;
    }
    const current = epoch;
    emit({ connecting: true, connectionError: null });
    try {
      const started = await api.startOAuth(abort.signal);
      if (disposed || current !== epoch) return null;
      emit({ connecting: false });
      return started.authorizationUrl;
    } catch (error) {
      if (!disposed && current === epoch && !failClosed(error)) {
        emit({ connecting: false, connectionError: calendarError(error) });
      }
      return null;
    }
  }

  async function disconnect() {
    if (disposed || !allowed || !canDisconnectCalendar(state) || state.disconnecting) return;
    reset();
    const current = epoch;
    emit({
      ...clearPrivate,
      status: null,
      connectionLoading: false,
      connecting: false,
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
        emit({ disconnecting: false, connectionError: calendarError(error) });
      }
    }
  }

  return {
    loadStatus,
    loadAgenda,
    shiftWindow,
    selectRangePreset,
    resetToToday,
    setTimeZone,
    toggleCancelled,
    selectEvent,
    connect,
    disconnect,
    getState: () => state,
    dispose: () => {
      disposed = true;
      reset();
    }
  };
}
