import { describe, it, expect, afterEach, vi } from 'vitest';
import { getSiteOrigin } from '../siteOrigin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSiteOrigin', () => {
  it('prefers an explicit NEXT_PUBLIC_SITE_URL over everything else', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dynasty.example.com');
    vi.stubEnv('VERCEL_URL', 'preview-abc123.vercel.app');
    expect(getSiteOrigin()).toBe('https://dynasty.example.com');
  });

  it('falls back to VERCEL_URL with an https:// prefix', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_URL', 'preview-abc123.vercel.app');
    expect(getSiteOrigin()).toBe('https://preview-abc123.vercel.app');
  });

  it('falls back to localhost when neither env var is set', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    expect(getSiteOrigin()).toBe('http://localhost:3000');
  });
});
