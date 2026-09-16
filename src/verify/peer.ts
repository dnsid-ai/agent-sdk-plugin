/**
 * The verdict on a peer, from the cache when it is fresh, else from the
 * verifier. The hook and the verify tool both go through here, so they never
 * disagree.
 */
import type { IdentityManager } from '@dnsid-ai/sdk';

import { VerdictCache } from './cache.ts';
import { readVerifierConfig, type HookConfig } from './config.ts';
import { verifyAgentIdentity, type VerifyAgentIdentityOutput } from './verdict.ts';
import { createVerifier } from './verifier.ts';

export async function verdictFor(
  host: string,
  config: HookConfig,
  env: NodeJS.ProcessEnv,
  idm: IdentityManager | undefined,
): Promise<VerifyAgentIdentityOutput> {
  const cache = new VerdictCache(config.cacheFile);
  const cached = cache.get(host);
  if (cached) return cached;

  const verdict = await verifyAgentIdentity(
    host,
    idm ?? (await createVerifier(readVerifierConfig(env))),
  );
  cache.set(host, verdict);

  return verdict;
}
