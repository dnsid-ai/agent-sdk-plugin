/** Production reads the CLI directory; `dnsid local run` overrides it through DNSID_*. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { agentIdentity } from '../../src/shared/identity.ts';
import { stubKms } from './fixtures/kms.ts';

async function cliDirectory() {
  const dir = mkdtempSync(join(tmpdir(), 'dnsid-config-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      domain: 'alice.example.com',
      governance_id: 'example.com',
      ku_url: 'https://alice.example.com/.well-known/jwks.json',
      ek_url: 'https://dnsid.example.com/.well-known/jwks.json',
      status_url: 'https://registry.example.com/v1/status/alice.example.com',
      log_ref: 'log.example.com:1',
    }),
  );
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  writeFileSync(
    join(dir, 'private.jwk'),
    JSON.stringify({ ...(await exportJWK(privateKey)), kid: 'operational' }),
  );
  return dir;
}

describe('agentIdentity', () => {
  it('reads DNSID_CONFIG_DIR, lets DNSID_* override it, and ignores DNSID_KEY_STORE', async () => {
    const dir = await cliDirectory();
    const statusUrl = 'https://registry.test/v1/status/alice.example.com';

    const { idm, keyProvider } = await agentIdentity({
      DNSID_CONFIG_DIR: dir,
      DNSID_STATUS_URL: statusUrl,
      DNSID_KEY_STORE: join(dir, 'no-such-keys.json'),
    });

    expect(idm.config.identity).toMatchObject({ domain: 'alice.example.com', statusUrl });
    expect((await keyProvider.signingKey()).kid).toBe('operational');
  });

  it('signs with the KMS key when there is no key file', async () => {
    const dir = await cliDirectory();
    rmSync(join(dir, 'private.jwk'));
    const { facade } = await stubKms();

    const { idm, keyProvider } = await agentIdentity(
      { DNSID_CONFIG_DIR: dir, DNSID_AWS_KMS_KEY_ID: 'alias/alice' },
      facade,
    );

    expect((await keyProvider.signingKey()).kid).toBe(
      'arn:aws:kms:eu-west-1:1:key/alias/alice',
    );
    expect(idm.getKeyProvider()).toBe(keyProvider);
  });
});
