/** The decision on the registration status, with the SDK's issuance step injected. */
import { describe, expect, it, vi } from 'vitest';
import type { AgentRegistration } from '@identity-digital/dnsid-registry';

import {
  bringOnline,
  singleKeyFromJwks,
  type Registry,
} from '../../src/online/online-hook.ts';
import { issuanceFile } from '../../src/online/issuance-file.ts';

const identity = {
  domain: 'alice.example.com',
  governanceId: 'example.com',
  keyProvider: {} as never,
};

function registry(registration: Partial<AgentRegistration> | undefined): Registry {
  return {
    getRegistration: vi.fn(async () => registration as AgentRegistration | undefined),
    prepareIssuance: vi.fn(),
    submitPreparedEvent: vi.fn(),
  };
}

const verified: Partial<AgentRegistration> = {
  registryStatus: 'VERIFIED',
  publicationAuthority: 'registry',
  publicationConfig: {
    ekUrl: 'https://dnsid.example.com/ek.json',
  } as AgentRegistration['publicationConfig'],
};

describe('bringOnline', () => {
  const deps = (issue = vi.fn()) => ({
    fetchEntityKey: vi.fn(async () => ({ kty: 'OKP', kid: 'ek' }) as never),
    coordination: issuanceFile('/nonexistent/never-written.json'),
    issue: issue as never,
  });

  it.each([
    [undefined, /not registered/],
    [{ registryStatus: 'READY', dnsPublished: true }, /online \(READY\)/],
    [{ registryStatus: 'READY', dnsPublished: false }, /publishing/],
    [{ registryStatus: 'PENDING' }, /PENDING, not VERIFIED/],
    [{ ...verified, publicationAuthority: 'client' }, /client-published/],
  ])('does nothing for %j', async (registration, message) => {
    const issue = vi.fn();
    expect(
      await bringOnline(identity, registry(registration as never), deps(issue)),
    ).toMatch(message);
    expect(issue).not.toHaveBeenCalled();
  });

  it('issues for a VERIFIED registry-managed identity with the entity key from the registry', async () => {
    const issue = vi.fn(async (_options: unknown) => ({
      submission: { state: 'accepted' },
      logReference: 'c2sp-tlog:x',
    }));
    const d = deps(issue);
    const line = await bringOnline(identity, registry(verified), d);
    expect(line).toMatch(/ISSUANCE accepted.*c2sp-tlog:x/);
    expect(d.fetchEntityKey).toHaveBeenCalledWith('https://dnsid.example.com/ek.json');
    expect(issue.mock.calls[0]![0]).toMatchObject({
      domain: 'alice.example.com',
      governanceId: 'example.com',
      entityKey: { kid: 'ek' },
      idempotencyKey: 'bring-online:alice.example.com',
    });
  });
});

describe('singleKeyFromJwks', () => {
  const fetchJson = (body: unknown) =>
    (async () => new Response(JSON.stringify(body))) as typeof fetch;
  it('returns the one key', async () => {
    expect(
      await singleKeyFromJwks(fetchJson({ keys: [{ kid: 'a' }] }), 'https://x'),
    ).toEqual({ kid: 'a' });
  });
  it('refuses zero or several keys', async () => {
    await expect(singleKeyFromJwks(fetchJson({ keys: [] }), 'https://x')).rejects.toThrow(
      /exactly one/,
    );
    await expect(
      singleKeyFromJwks(fetchJson({ keys: [{}, {}] }), 'https://x'),
    ).rejects.toThrow(/exactly one/);
  });
});
