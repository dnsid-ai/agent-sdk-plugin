/** The token as the registry reads it: signed by the operational key, claims per agent_auth.go. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importJWK, jwtVerify, decodeProtectedHeader } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { LocalKeyProvider } from '@identity-digital/dnsid/node';

import { agentAuthFetch, mintAgentJwt } from '../../src/online/agent-jwt.ts';

describe('mintAgentJwt', () => {
  for (const alg of ['EdDSA', 'ES256'] as const) {
    it(`signs with the ${alg} operational key and carries the self-auth claims`, async () => {
      const keyProvider = await LocalKeyProvider.load(
        join(mkdtempSync(join(tmpdir(), 'k-')), 'keys.json'),
        true,
        alg,
      );
      const key = await keyProvider.signingKey();
      const token = await mintAgentJwt({
        domain: 'alice.example.com',
        audience: 'https://registry.example.com',
        keyProvider,
        now: () => 1_800_000_000_000,
      });
      expect(decodeProtectedHeader(token)).toEqual({ alg, typ: 'JWT', kid: key.kid });
      const { payload } = await jwtVerify(token, await importJWK(key, alg), {
        issuer: 'alice.example.com',
        subject: 'alice.example.com',
        audience: 'https://registry.example.com',
        currentDate: new Date(1_800_000_060_000),
      });
      expect(payload).toMatchObject({
        purpose: 'tlog:issuance',
        iat: 1_800_000_000,
        exp: 1_800_000_300,
      });
      expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    });
  }

  it('refuses a lifetime the registry would reject', async () => {
    const keyProvider = await LocalKeyProvider.load(
      join(mkdtempSync(join(tmpdir(), 'k-')), 'keys.json'),
      true,
    );
    await expect(
      mintAgentJwt({
        domain: 'a.example.com',
        audience: 'https://r',
        keyProvider,
        ttlSeconds: 901,
      }),
    ).rejects.toThrow(/900/);
  });
});

describe('agentAuthFetch', () => {
  it('puts a fresh token on each POST and none on GET', async () => {
    const seen: (string | null)[] = [];
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return new Response('ok');
    }) as unknown as typeof fetch;
    let n = 0;
    const f = agentAuthFetch(base, async () => `t${++n}`);
    await f('https://r/x', { method: 'POST' });
    await f('https://r/x', { method: 'POST', headers: { 'Idempotency-Key': 'k' } });
    await f('https://r/x');
    expect(seen).toEqual(['Bearer t1', 'Bearer t2', null]);
  });
});
