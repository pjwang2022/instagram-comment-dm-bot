import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/monitoring/logger';

describe('createLogger', () => {
  it('writes a single-line JSON entry with the expected fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger('debug');

    logger.info({ action: 'test', requestId: 'abc' });

    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({ level: 'info', action: 'test', requestId: 'abc' });
    expect(typeof entry.timestamp).toBe('string');

    spy.mockRestore();
  });

  it('filters out entries below the configured level', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('error');

    logger.info({ action: 'should-not-log' });
    logger.warn({ action: 'should-not-log' });
    logger.error({ action: 'should-log' });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('routes warn/error to console.error and debug/info to console.log', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('debug');

    logger.warn({ action: 'warn-case' });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
