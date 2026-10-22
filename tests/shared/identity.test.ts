/** Production reads the CLI directory; `dnsid local run` overrides it through DNSID_*. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DNSSECState } from '@dnsid-ai/sdk';
import * as sdk from '@dnsid-ai/sdk/node';

import { agentIdentity, loadAgentConfig } from '../../src/shared/identity.ts';
import { issuanceIdentity } from '../../src/online/online-hook.ts';
import { AGENT, GOVERNANCE, identityFixture } from './fixtures/identity.ts';
import { stubKms } from './fixtures/kms.ts';

vi.mock('@dnsid-ai/sdk/node', async (importOriginal) => {
  const actual = await importOriginal<typeof sdk>();
  return { ...actual, constructIdentityManager: vi.fn(actual.constructIdentityManager) };
});

const directories: string[] = [];
afterEach(() => {
  vi.mocked(sdk.constructIdentityManager).mockReset();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function cliDirectory(nested = false) {
  const dir = mkdtempSync(join(tmpdir(), 'dnsid-config-'));
  directories.push(dir);
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      domain: AGENT,
      governance_id: GOVERNANCE,
      ku_url: `https://${AGENT}/.well-known/jwks.json`,
      ek_url: 'https://dnsid.example.com/.well-known/jwks.json',
      status_url: 'https://registry.example.com/v1/status/alice.example.com',
      log_ref: 'microledger:ref',
    }),
  );
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const keyDir = nested ? join(dir, AGENT) : dir;
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(
    join(keyDir, 'private.jwk'),
    JSON.stringify({ ...(await exportJWK(privateKey)), kid: 'operational' }),
  );
  return dir;
}

describe('loadAgentConfig', () => {
  it('overlays environment fields without changing the CLI key source', async () => {
    const dir = await cliDirectory();
    const config = await loadAgentConfig({
      DNSID_CONFIG_DIR: dir,
      DNSID_DOMAIN: 'other.example.com',
      DNSID_KEY_STORE: join(dir, 'ignored.json'),
    });
    expect(config.dnsid?.identity).toMatchObject({
      domain: 'other.example.com',
      governanceId: GOVERNANCE,
    });
    expect(config.keySource).toEqual({ cliDirectory: dir });
  });
});

describe('agentIdentity', () => {
  it.each(['matching', 'different', 'missing'])(
    'requires a matching published key: publication is %s',
    async (publication) => {
      const dir = await cliDirectory();
      const key = await sdk.LocalKeyProvider.fromDirectory(dir);
      const fixture = await identityFixture(
        AGENT,
        GOVERNANCE,
        publication === 'matching' ? await key.signingKey() : undefined,
      );
      if (publication === 'missing') fixture.txt = async () => [[], DNSSECState.UNSIGNED];
      const actual = await vi.importActual<typeof sdk>('@dnsid-ai/sdk/node');
      vi.mocked(sdk.constructIdentityManager).mockImplementation((config, deps) =>
        actual.constructIdentityManager(config, {
          dnsResolver: fixture.dnsResolver,
          fetchJson: fixture.fetchJson,
          logRegistry: fixture.logRegistry,
          ...deps,
        }),
      );
      const statusUrl = 'https://registry.test/v1/status/alice.example.com';
      const result = agentIdentity({
        DNSID_CONFIG_DIR: dir,
        DNSID_STATUS_URL: statusUrl,
        DNSID_KEY_STORE: join(dir, 'no-such-keys.json'),
      });

      if (publication !== 'matching') {
        await expect(result).rejects.toThrow(
          publication === 'missing' ? /no _dnsid TXT/ : /key does not match/,
        );
        return;
      }

      const { idm, keyProvider } = await result;
      expect(idm.config.identity).toMatchObject({ domain: AGENT, statusUrl });
      expect((await keyProvider.signingKey()).kid).toBe('operational');
    },
  );
});

describe('issuanceIdentity', () => {
  it.each([false, true])('loads an unpublished CLI key (nested=%s)', async (nested) => {
    const dir = await cliDirectory(nested);
    const identity = await issuanceIdentity({
      DNSID_CONFIG_DIR: dir,
      DNSID_GOVERNANCE_ID: 'other.example.com',
      DNSID_KEY_STORE: join(dir, 'no-such-keys.json'),
    });

    expect(identity).toMatchObject({ domain: AGENT, governanceId: 'other.example.com' });
    expect((await identity.keyProvider.signingKey()).kid).toBe('operational');
  });

  it('rejects a missing identity', async () => {
    const dir = await cliDirectory();
    writeFileSync(join(dir, 'config.json'), '{}');
    await expect(issuanceIdentity({ DNSID_CONFIG_DIR: dir })).rejects.toThrow(
      /requires an identity/,
    );
  });

  it('does not replace a malformed root key with a domain key', async () => {
    const dir = await cliDirectory(true);
    writeFileSync(join(dir, 'private.jwk'), 'invalid JSON');
    await expect(issuanceIdentity({ DNSID_CONFIG_DIR: dir })).rejects.toThrow(
      /private\.jwk:.*JSON/,
    );
  });

  it('rejects a missing key', async () => {
    const dir = await cliDirectory();
    rmSync(join(dir, 'private.jwk'));
    await expect(issuanceIdentity({ DNSID_CONFIG_DIR: dir })).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('signs with the KMS key when there is no key file', async () => {
    const dir = await cliDirectory();
    rmSync(join(dir, 'private.jwk'));
    const { facade } = await stubKms();

    const { keyProvider } = await issuanceIdentity(
      { DNSID_CONFIG_DIR: dir, DNSID_AWS_KMS_KEY_ID: 'alias/alice' },
      facade,
    );

    expect((await keyProvider.signingKey()).kid).toBe(
      'arn:aws:kms:eu-west-1:1:key/alias/alice',
    );
  });
});
