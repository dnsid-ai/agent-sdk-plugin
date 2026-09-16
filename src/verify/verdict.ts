/**
 * One `verifyDomain` call, reshaped into a JSON verdict. The output is a
 * union: `ok: true` when the agent verified, `ok: false` when it did not. Both
 * are normal results. Only a bug throws. Copied from dnsid-mcp on purpose,
 * until the runtime core moves into dnsid-ts.
 */
import { z } from 'zod';
import {
  DNSSECState,
  VerificationCode,
  VerificationError,
  jwkThumbprint,
  type IdentityManager,
} from '@dnsid-ai/sdk';

import { record, recordJSON } from './compliance.ts';

const verified = z.object({
  ok: z.literal(true),
  domain: z.string(),
  state: z
    .enum(['PENDING', 'PROVISIONING', 'VERIFYING', 'ACTIVE', 'RETIRED', 'REVOKED'])
    .describe('Agent state at the last status check. Only ACTIVE means a live identity.'),
  record,
  keyThumbprint: z
    .string()
    .describe('The RFC 7638 thumbprint of the verified signing key.'),
  dnssecState: z.enum(DNSSECState),
  requiresLogCheck: z
    .boolean()
    .describe(
      'True when the verified record sets `fl=logchk`: it asks for a fresh ' +
        'log non-revocation check before high-value operations. This server ' +
        'does not perform that check. You decide which operations qualify; ' +
        'tell the user rather than proceeding silently.',
    ),
  verifiedAt: z.iso.datetime(),
  expiresAt: z.iso
    .datetime()
    .describe(
      'When this result goes stale. This is the earliest of the DNS TTL, ' +
        'the TLS notAfter date, and the ka bound.',
    ),
});

const verificationFailed = z.object({
  ok: z.literal(false),
  code: z.enum(VerificationCode).describe("The SDK's VerificationCode."),
  transient: z
    .boolean()
    .describe(
      'True means verification did not complete; retry. False means verification failed; do not retry.',
    ),
  agentState: z
    .string()
    .nullable()
    .describe('The status document state, when the failure is state-related.'),
  errorCategory: z.string().nullable(),
  cannotVerify: z
    .boolean()
    .describe(
      'True when this verifier cannot check the identity at all (a log it ' +
        'does not trust, or fl=mtls). Not a verdict about the agent. The hook ' +
        'maps it to `onUnverifiable`; it never maps to allow.',
    ),
  message: z.string().describe('Context for humans; do not branch on it.'),
});

export type VerifiedOutput = z.infer<typeof verified>;
export type VerificationFailure = z.infer<typeof verificationFailed>;

/**
 * Accepts only `VerificationError`. No other error has an honest `code`, and
 * inventing one would report a bug in this server as a verdict about the agent.
 * `?? null` keeps the optional fields present, since the schema is `.nullable()`
 * and `JSON.stringify` drops `undefined`.
 */
export function verificationFailure(error: VerificationError): VerificationFailure {
  const cannotVerify = hint(error);
  return {
    ok: false,
    code: error.code,
    transient: error.transient,
    agentState: error.agentState ?? null,
    errorCategory: error.errorCategory ?? null,
    cannotVerify: cannotVerify !== '',
    message: error.message + cannotVerify,
  };
}

/**
 * Some failures mean this server cannot check the identity, not that the
 * identity is bad. It has no key material and no connection to the agent, so
 * it cannot reach a verdict when the record names a transparency log it has no
 * reader for, or when the record demands mutual TLS. Both are limits here, and
 * an agent that fails this way may be perfectly valid.
 *
 * The DNSid SDK gives these no code of their own, so `message` is the only channel.
 * Matching its prose is deliberate: the same `LogError` also carries a real
 * revocation, and nothing in the error distinguishes the two. A match that
 * drifts must therefore lose the hint, never excuse a revoked identity.
 *
 * TODO: delete this once the SDK reports "cannot check" as its own code.
 */
function hint(error: VerificationError): string {
  if (
    // A log this server does not trust leaves by three different exits. This
    // one keeps the record's own `lr`, so the SDK reports it as a malformed
    // record; the code is wrong and only the inner text identifies it. A
    // genuinely malformed `lr` says 'malformed log reference' instead, and
    // stays the agent's fault.
    /unknown DNSid managed trust selector/.test(error.message) ||
    (error.code === 'LogError' &&
      // No reader for the `lr` method, then the same for an identity whose
      // governance is delegated, where the log is the only possible proof.
      /no LogReader registered|requires verified ISSUANCE evidence/.test(error.message))
  ) {
    return (
      ' [Cannot verify: the record points at a transparency log this ' +
      'server does not trust. This is not a verdict about the agent. An ' +
      'operator can set DNSID_LOG_POLICY_URL to trust another log.]'
    );
  }
  if (error.code === 'TLSError' && error.message.startsWith('fl=mtls')) {
    return (
      ' [Out of scope: this identity requires mutual TLS, which only the ' +
      'party connecting to the agent can satisfy. This is not a verdict ' +
      'about the agent.]'
    );
  }
  return '';
}

// Use the `ok` flag to pick one schema (success vs failure).
export const verifyAgentIdentityOutput = z.discriminatedUnion('ok', [
  verified,
  verificationFailed,
]);

export type VerifyAgentIdentityOutput = z.infer<typeof verifyAgentIdentityOutput>;

/**
 * One `verifyDomain` call, reshaped into JSON. The DNSid SDK decides what
 * counts as verified.
 */
export async function verifyAgentIdentity(
  domain: string,
  idm: IdentityManager,
): Promise<VerifyAgentIdentityOutput> {
  try {
    const verified = await idm.verifyDomain(domain);
    return {
      ok: true,
      domain: verified.domain,
      state: verified.cachedState(),
      record: recordJSON(verified.record),
      keyThumbprint: await jwkThumbprint(verified.signingKey),
      dnssecState: verified.dnssecState,
      requiresLogCheck: verified.requiresLogCheck(),
      verifiedAt: verified.verifiedAt.toISOString(),
      expiresAt: verified.expiry().toISOString(),
    };
  } catch (error) {
    if (error instanceof VerificationError) return verificationFailure(error);
    // Only the SDK can classify a failure. For any other error, no honest
    // `code` exists, so it stays an exception instead of a verdict.
    throw error;
  }
}
