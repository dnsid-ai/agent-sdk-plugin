/**
 * What every feature that acts as this agent needs from the environment: the
 * identity in DNSID_CONFIG_DIR, the key that signs for it, and a fetch that
 * honors DNSID_DNS_SERVER and DNSID_CA_BUNDLE.
 */
import {
  constructIdentityManager,
  loadCliDirectory,
  loadEnvironment,
  mergeLoadedConfig,
} from '@dnsid-ai/sdk/node';
import { createDnsidFetch } from '@dnsid-ai/transport';

import { keyProviderFromEnv } from './key-provider.ts';

// The CLI directory holds the identity in production; `dnsid local run` sets it
// through DNSID_* instead, so those override the directory. The key is AWS KMS
// if DNSID_AWS_KMS_KEY_ID is set, else the file next to config.json.
export async function agentIdentity(env: NodeJS.ProcessEnv = process.env) {
  const [dir, fromEnv] = await Promise.all([
    loadCliDirectory(env.DNSID_CONFIG_DIR),
    loadEnvironment(env),
  ]);
  const idm = await constructIdentityManager(mergeLoadedConfig(dir, fromEnv));
  return { idm, keyProvider: (await keyProviderFromEnv(env)) ?? idm.getKeyProvider() };
}

// With neither variable set, this is the global fetch.
export const dnsidFetch = (env: NodeJS.ProcessEnv = process.env) =>
  createDnsidFetch({
    dnsServer: env.DNSID_DNS_SERVER,
    caBundlePath: env.DNSID_CA_BUNDLE,
  });
