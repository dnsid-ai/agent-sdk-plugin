/**
 * A complete DNSid identity, served over fake transport.
 *
 * The fixture defines what the server believes DNS and HTTPS return:
 *
 * - one `_dnsid` TXT record, signed by a real ES256 entity key
 * - one JWKS for each of the two key URIs
 * - one ACTIVE status document
 *
 * The source is `dnsid-ts/test/helpers/current-profile.ts`, the SDK's own
 * verification harness. To create one failure, change `record` and sign it
 * again. To break the signature, change `record` and do not sign it again.
 */
import { exportJWK, generateKeyPair } from 'jose';
import { DNSID_DRAFT01_VERSION } from '@dnsid-ai/protocol';
import {
  DNSSECState,
  DnsIdTxtRecord,
  LogRegistry,
  toArrayBuffer,
  toBase64Url,
  type DNSResolver,
  type DnsIdJWK,
  type JsonFetcher,
  type LogReader,
  type LoggedStateEvidence,
  type TXTRecord,
} from '@dnsid-ai/sdk';

export const AGENT = 'agent.example.com';
export const GOVERNANCE = 'example.com';

export interface IdentityFixture {
  record: DnsIdTxtRecord;
  /** Signs `record` again after a change, so that `sg` stays valid. */
  sign(): Promise<void>;
  dnsResolver: DNSResolver;
  fetchJson: JsonFetcher;
  logRegistry: LogRegistry;
  /** The stub reader behind `logRegistry`. Spread it to override one method. */
  logReader: LogReader;
  /** A test can replace this document, to serve a state that is not ACTIVE. */
  status: { state: string; lastTransitionAt: string; revocationReason?: string };
  /** A test can replace this function, to return more than one record, or none. */
  txt: () => Promise<[TXTRecord[], DNSSECState]>;
}

/**
 * `operationalKey`: serve this public key at `ku` instead of a throwaway one,
 * so a test can sign with the matching private key and verify against it.
 */
export async function identityFixture(
  domain = AGENT,
  governanceId = GOVERNANCE,
  operationalKey?: DnsIdJWK,
): Promise<IdentityFixture> {
  const entityPair = await generateKeyPair('ES256');
  const rawEntity = await exportJWK(entityPair.publicKey);
  const entityKey = {
    ...rawEntity,
    kty: rawEntity.kty!,
    alg: 'ES256',
    kid: 'entity-key',
    use: 'sig',
  } as DnsIdJWK;

  if (!operationalKey) {
    const operationalPair = await generateKeyPair('ES256');
    const rawOperational = await exportJWK(operationalPair.publicKey);
    operationalKey = {
      ...rawOperational,
      kty: rawOperational.kty!,
      alg: 'ES256',
      kid: 'operational',
      use: 'sig',
    } as DnsIdJWK;
  }

  const record = new DnsIdTxtRecord();
  record.v = DNSID_DRAFT01_VERSION;
  record.gi = governanceId;
  record.ek = `https://${governanceId}/entity-jwks.json`;
  record.ku = `https://${domain}/.well-known/jwks.json`;
  record.lr = 'microledger:ref';
  record.su = `https://${domain}/status`;
  record.agentFQDN = domain;

  const sign = async (): Promise<void> => {
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      entityPair.privateKey,
      toArrayBuffer(new TextEncoder().encode(record.canonical())),
    );
    record.sg = toBase64Url(new Uint8Array(signature));
  };
  await sign();

  const cert = { notAfter: new Date('2099-01-01'), san: [domain, governanceId] };
  const fixture: IdentityFixture = {
    record,
    sign,
    status: { state: 'ACTIVE', lastTransitionAt: new Date().toISOString() },
    txt: async () => [
      [{ strings: [record.serialize()], ttl: 300 } satisfies TXTRecord],
      DNSSECState.UNSIGNED,
    ],
    dnsResolver: { fetchTXT: () => fixture.txt() },
    fetchJson: async (url: string) => {
      if (url === record.su) return { data: fixture.status, tlsCert: cert };
      return {
        data: { keys: [url === record.ek ? entityKey : operationalKey] },
        tlsCert: cert,
      };
    },
    logRegistry: new LogRegistry(),
    logReader: undefined as unknown as LogReader,
  };

  // This is a stub lifecycle log. It passes every check. Log behavior belongs
  // to the C2SP registry, and not to this server. A missing registry must fail
  // closed. The LogError test leaves the registry empty, and checks that.
  const logReader: LogReader = {
    canonical: async () => new Uint8Array(),
    keyTimestamp: async () => new Date(),
    verifyBilateralBinding: async () => ({
      initialOperationalThumbprint: 'initial',
      initialEntityThumbprint: 'entity',
      timestamp: new Date(),
    }),
    verifyOperationalContinuity: async () => {},
    // Mirrors dnsid-ts/test/helpers/current-profile.ts. dnsid-mcp's copy of
    // this fixture returns void here and no longer typechecks against the
    // current SDK; fix it there too.
    verifyNonRevocation: async (): Promise<LoggedStateEvidence> => ({
      logReference: fixture.record.lr ?? 'microledger:ref',
      loggedState: 'ACTIVE',
      historyStart: `${fixture.record.lr}@0`,
      historyEnd: `${fixture.record.lr}@0`,
      completeThrough: '1',
      completenessMode: 'test',
      checkpoint: new Uint8Array(),
      freshnessTime: new Date(),
    }),
    readEvent: async () => {
      throw new Error('not implemented');
    },
    rebuildHistory: async () => [],
  };
  fixture.logReader = logReader;
  fixture.logRegistry.register('microledger', () => fixture.logReader);

  return fixture;
}
