import { redactSensitiveData } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  workspaceId?: string;
  userId?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

export class Logger {
  private minLevelWeight: number;

  constructor(public readonly minLevel: LogLevel = 'info') {
    this.minLevelWeight = LOG_LEVEL_WEIGHTS[minLevel] ?? 20;
  }

  private shouldLog(level: LogLevel): boolean {
    return (LOG_LEVEL_WEIGHTS[level] ?? 20) >= this.minLevelWeight;
  }

  private write(entry: LogEntry): void {
    const redactedEntry = redactSensitiveData(entry);
    const line = JSON.stringify(redactedEntry);
    if (entry.level === 'error') {
      console.error(line);
    } else if (entry.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  debug(message: string, meta?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message'>>): void {
    if (this.shouldLog('debug')) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'debug',
        message,
        ...meta
      });
    }
  }

  info(message: string, meta?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message'>>): void {
    if (this.shouldLog('info')) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'info',
        message,
        ...meta
      });
    }
  }

  warn(message: string, meta?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message'>>): void {
    if (this.shouldLog('warn')) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message,
        ...meta
      });
    }
  }

  error(message: string, meta?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message'>>): void {
    if (this.shouldLog('error')) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'error',
        message,
        ...meta
      });
    }
  }
}

export const defaultLogger = new Logger('info');
