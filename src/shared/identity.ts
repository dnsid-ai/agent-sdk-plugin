/**
 * What every feature that acts as this agent needs from the environment: the
 * identity in DNSID_CONFIG_DIR, the key that signs for it, and a fetch that
 * honors DNSID_DNS_SERVER and DNSID_CA_BUNDLE.
 */
import { createNodeIdentityManagerFromDnsid } from '@identity-digital/dnsid/node';
import { createDnsidFetch } from '@identity-digital/dnsid-transport';

import { keyProviderFromEnv } from './key-provider.ts';

// The key is AWS KMS if DNSID_AWS_KMS_KEY_ID is set, else the file next to config.json.
export async function agentIdentity(env: NodeJS.ProcessEnv = process.env) {
  const idm = await createNodeIdentityManagerFromDnsid({ env });
  return { idm, keyProvider: (await keyProviderFromEnv(env)) ?? idm.getKeyProvider() };
}

// With neither variable set, this is the global fetch.
export const dnsidFetch = (env: NodeJS.ProcessEnv = process.env) =>
  createDnsidFetch({
    dnsServer: env.DNSID_DNS_SERVER,
    caBundlePath: env.DNSID_CA_BUNDLE,
  });
