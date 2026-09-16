import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { VerdictCache } from '../../src/verify/cache.ts';
import type { VerifyAgentIdentityOutput } from '../../src/verify/verdict.ts';

const success = (expiresAt: number) =>
  ({
    ok: true,
    state: 'ACTIVE',
    expiresAt: new Date(expiresAt).toISOString(),
  }) as unknown as VerifyAgentIdentityOutput;
const failure = (transient: boolean) =>
  ({ ok: false, code: 'LogError', transient }) as unknown as VerifyAgentIdentityOutput;

const fresh = () =>
  new VerdictCache(join(mkdtempSync(join(tmpdir(), 'dnsid-')), 'v.json'));
const t0 = 1_000_000;

describe('VerdictCache', () => {
  it('hits before expiresAt and misses after, across instances (it is a file)', () => {
    const cache = fresh();
    cache.set('a', success(t0 + 5_000), t0);
    expect(cache.get('a', t0 + 4_999)).toMatchObject({ ok: true });
    expect(cache.get('a', t0 + 5_000)).toBeUndefined();
  });

  it('caches a non-transient failure for 30s', () => {
    const cache = fresh();
    cache.set('a', failure(false), t0);
    expect(cache.get('a', t0 + 29_999)).toBeDefined();
    expect(cache.get('a', t0 + 30_000)).toBeUndefined();
  });

  it('never caches a transient failure', () => {
    const cache = fresh();
    cache.set('a', failure(true), t0);
    expect(cache.get('a', t0)).toBeUndefined();
  });

  it('drops expired entries when it writes', () => {
    const cache = fresh();
    cache.set('old', success(t0 + 1), t0);
    cache.set('new', success(t0 + 60_000), t0 + 10);
    expect(cache.get('old', t0 + 10)).toBeUndefined();
    expect(cache.get('new', t0 + 10)).toBeDefined();
  });

  it('is empty when the file is missing or garbage', () => {
    expect(fresh().get('a')).toBeUndefined();
  });
});
