import { describe, expect, it } from 'vitest';
import { isSameOriginRequest, toTrustedOrigin } from '../../src/security/csrf';

const APP = 'https://igbot.example.com';

describe('CSRF origin check', () => {
  it('allows safe methods regardless of origin', () => {
    expect(isSameOriginRequest('GET', null, null, APP)).toBe(true);
    expect(isSameOriginRequest('HEAD', 'https://evil.com', null, APP)).toBe(true);
  });

  it('allows POST from the matching origin', () => {
    expect(isSameOriginRequest('POST', 'https://igbot.example.com', null, APP)).toBe(true);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(isSameOriginRequest('POST', undefined, 'https://igbot.example.com/admin', APP)).toBe(true);
  });

  it('rejects a mismatched origin', () => {
    expect(isSameOriginRequest('POST', 'https://evil.com', null, APP)).toBe(false);
  });

  it('rejects a subdomain-suffix bypass attempt', () => {
    expect(isSameOriginRequest('POST', 'https://igbot.example.com.evil.com', null, APP)).toBe(false);
  });

  it('rejects a literal null origin', () => {
    expect(isSameOriginRequest('POST', 'null', null, APP)).toBe(false);
  });

  it('rejects when both Origin and Referer are missing (fail-closed)', () => {
    expect(isSameOriginRequest('POST', null, null, APP)).toBe(false);
  });

  it('fails closed when the request URL is malformed', () => {
    expect(isSameOriginRequest('POST', 'https://igbot.example.com', null, 'not-a-url')).toBe(false);
  });

  it('toTrustedOrigin normalizes and rejects invalid values', () => {
    expect(toTrustedOrigin('https://a.com/some/path')).toBe('https://a.com');
    expect(toTrustedOrigin('null')).toBeNull();
    expect(toTrustedOrigin(undefined)).toBeNull();
    expect(toTrustedOrigin('garbage')).toBeNull();
  });
});
