/** Production reads the CLI directory; `dnsid local run` overrides it through DNSID_*. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { agentIdentity } from '../../src/shared/identity.ts';

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
  it('reads DNSID_CONFIG_DIR, and a DNSID_* variable overrides its value', async () => {
    const dir = await cliDirectory();
    const statusUrl = 'https://registry.dev.dnsid.test/v1/status/alice.example.com';

    const { idm, keyProvider } = await agentIdentity({
      DNSID_CONFIG_DIR: dir,
      DNSID_STATUS_URL: statusUrl,
    });

    expect(idm.config.identity).toMatchObject({ domain: 'alice.example.com', statusUrl });
    expect((await keyProvider.signingKey()).kid).toBe('operational');
  });
});
