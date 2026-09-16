/**
 * Builds a verify-only `IdentityManager` from `VerifierConfig`. The hook
 * holds no identity of its own, so it never sets a `keyProvider`. Copied
 * from dnsid-mcp and since diverged: the log transport honors the configured
 * DNS server and CA, and `allowPrivateHosts` exists for testnets.
 */
import { readFile } from 'node:fs/promises';
import type { IdentityManager } from '@identity-digital/dnsid';
import { createNodeIdentityVerifier } from '@identity-digital/dnsid/node';
import {
  createC2spTlogVerificationRegistry,
  createDnsidManagedVerificationRegistry,
  createFetchBackedC2spResourceFetcher,
  requiredC2spResourceFetchGuarantees,
} from '@identity-digital/dnsid-log-c2sp-tlog';
import { createSsrfSafeFetch, fetchJson } from '@identity-digital/dnsid-transport';
import { readVerifierConfig, type VerifierConfig } from './config.ts';

/**
 * A broken operator policy must throw. The server must never use the managed
 * catalog instead. That substitution would change which anchor vouches for
 * every later result, and nothing would report the change.
 */
async function createLogRegistry(config: VerifierConfig) {
  const { logPolicy, checkpointMaxAge } = config;
  if (!logPolicy) return createDnsidManagedVerificationRegistry();

  const policy =
    'url' in logPolicy
      ? { policyUrl: logPolicy.url }
      : { policyDocument: await readFile(logPolicy.file) };

  return createC2spTlogVerificationRegistry({
    ...policy,
    checkpointMaxAge,
    resourceFetcher: logResourceFetcher(config),
  });
}

/**
 * The log registry fetches the policy and the log over its own transport,
 * which by default uses the system resolver and roots. A deployment that
 * sets DNSID_DNS_SERVER or DNSID_CA_BUNDLE (a local testnet, a private CA)
 * needs the log fetched the same way as everything else, or the policy URL
 * does not resolve. Such a deployment may also resolve its log to a private
 * address, so the policy host is exempt from the private-address block.
 * Left undefined, the SDK's default fetcher applies.
 */
function logResourceFetcher({
  dnsServer,
  caBundlePath,
  logPolicy,
  allowPrivateHosts,
}: VerifierConfig) {
  if (!dnsServer && !caBundlePath) return;
  const allowedUnsafeHosts = [
    ...(logPolicy && 'url' in logPolicy ? [new URL(logPolicy.url).hostname] : []),
    ...allowPrivateHosts,
  ];
  return createFetchBackedC2spResourceFetcher(
    createSsrfSafeFetch({ dnsServer, caBundlePath }, { allowedUnsafeHosts }),
    requiredC2spResourceFetchGuarantees(),
  );
}

export async function createVerifier(
  config: VerifierConfig = readVerifierConfig(),
): Promise<IdentityManager> {
  const logRegistry = await createLogRegistry(config);

  // The SDK reads this file on the first outbound fetch. Read it here
  // instead, so a bad path stops the server at startup.
  if (config.caBundlePath) await readFile(config.caBundlePath, 'utf8');

  const { dnsServer, caBundlePath, allowPrivateHosts } = config;
  return createNodeIdentityVerifier({
    config: { dnssecMode: config.dnssecMode, dnsServer, caBundlePath },
    logRegistry,
    // The SDK's own fetcher, with the private-host exemption threaded through.
    // Left undefined when there is nothing to exempt, so the default applies.
    fetchJson:
      allowPrivateHosts.length === 0
        ? undefined
        : (url, opts) =>
            fetchJson(url, {
              ...opts,
              dnsServer,
              caBundlePath,
              allowedUnsafeHosts: allowPrivateHosts,
            }),
  });
}
