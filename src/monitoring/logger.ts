// JSON structured logging，落實 spec.md 第 21 節的必要欄位與禁止紀錄清單。
// LogFields 刻意不包含 accessToken/appSecret/sessionCookie/password 等欄位，
// 從型別層面避免呼叫端不小心把機密寫進 log。
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  requestId?: string;
  webhookEventId?: string;
  automationRunId?: string;
  instagramMediaId?: string;
  instagramCommentId?: string;
  action: string;
  durationMs?: number;
  httpStatus?: number;
  metaErrorCode?: string;
  metaTraceId?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
}

export function createLogger(configuredLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[configuredLevel] ?? LEVEL_ORDER.info;

  function write(level: LogLevel, fields: LogFields): void {
    if (LEVEL_ORDER[level] < threshold) return;

    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, ...fields });
    if (level === 'warn' || level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (fields) => write('debug', fields),
    info: (fields) => write('info', fields),
    warn: (fields) => write('warn', fields),
    error: (fields) => write('error', fields),
  };
}
