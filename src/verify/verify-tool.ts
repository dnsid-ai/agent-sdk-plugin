/**
 * The `verify` tool: the same verdict the hook decides on, on request. It
 * calls nothing on the peer, so it is safe to expose, and it shares the
 * hook's cache so the two never disagree.
 */
import { z } from 'zod';
import type { IdentityManager } from '@identity-digital/dnsid';

import { readHookConfig } from './config.ts';
import { verdictFor } from './peer.ts';

export const verifyInput = z.object({
  domain: z
    .string()
    .min(1)
    .describe(
      'The agent domain to verify, for example bob.example.com. A URL also works.',
    ),
});

export const verifyToolDescription = [
  'Verifies another agent’s DNSid identity without calling it: the _dnsid ' +
    'DNS record, its signature, the agent key, the status document, and the ' +
    'transparency log. Returns the verdict the verify hook would apply.',
  'ok with state ACTIVE means the agent may be called. ok false means ' +
    'verification failed; branch on code, never on message. A message ' +
    'containing "Cannot verify" is not a statement about the peer.',
].join('\n\n');

export function verifyTool(
  input: z.infer<typeof verifyInput>,
  env = process.env,
  idm?: IdentityManager,
) {
  const domain = (URL.parse(input.domain)?.hostname || input.domain).toLowerCase();
  return verdictFor(domain, readHookConfig(env), env, idm);
}
