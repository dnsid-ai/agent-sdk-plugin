/**
 * Alice signs, Bob verifies. Alice's identity is a DNSid CLI directory
 * (`config.json` + `private.jwk`) in a temp dir, read the way the server reads
 * it. Bob is a verify-only profile over the fixture, which serves Alice's
 * public key at `ku`.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import type { DnsIdJWK } from '@identity-digital/dnsid';
import {
  createNodeIdentityManagerFromDnsid,
  createNodeIdentityVerifier,
} from '@identity-digital/dnsid/node';
import { HttpSignaturesProfile } from '@identity-digital/dnsid-http-signatures';

import { AGENT, GOVERNANCE, identityFixture } from './identity.ts';

export const BOB = 'bob.example.com';

export async function aliceAndBob() {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const publicKey = {
    ...(await exportJWK(pair.publicKey)),
    kty: 'EC',
    alg: 'ES256',
    kid: 'operational',
    use: 'sig',
  } as DnsIdJWK;
  const fixture = await identityFixture(AGENT, GOVERNANCE, publicKey);

  // What `dnsid` writes into DNSID_CONFIG_DIR. Snake case is the CLI's.
  const dir = mkdtempSync(join(tmpdir(), 'dnsid-config-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      domain: AGENT,
      governance_id: GOVERNANCE,
      ku_url: fixture.record.ku,
      ek_url: fixture.record.ek,
      status_url: fixture.record.su,
      log_ref: fixture.record.lr,
    }),
  );
  writeFileSync(
    join(dir, 'private.jwk'),
    JSON.stringify({ ...(await exportJWK(pair.privateKey)), kid: 'operational' }),
  );

  const transport = {
    dnsResolver: fixture.dnsResolver,
    fetchJson: fixture.fetchJson,
    logRegistry: fixture.logRegistry,
  };
  const alice = HttpSignaturesProfile.fromIdentityManager(
    await createNodeIdentityManagerFromDnsid({ dnsidDir: dir, ...transport }),
  );
  const bob = new HttpSignaturesProfile({
    domain: BOB,
    identityResolver: await createNodeIdentityVerifier(transport),
  });
  return { alice, bob };
}
