/**
 * The decision rule. ACTIVE allows. Any other state denies. A failure denies,
 * unless the verifier could not check at all; then `onUnverifiable` decides,
 * and that is deny or ask, never allow. Allow is returned as no output, so
 * the user's own permission rules still run.
 */
import type { HookConfig } from './config.ts';
import type { VerifyAgentIdentityOutput } from './verdict.ts';

export interface Decision {
  decision: 'allow' | 'deny' | 'ask';
  reason: string;
}

export function decide(
  verdict: VerifyAgentIdentityOutput,
  onUnverifiable: HookConfig['onUnverifiable'],
): Decision {
  if (!verdict.ok) {
    return {
      decision: verdict.cannotVerify ? onUnverifiable : 'deny',
      reason: `${verdict.code}: ${verdict.message}`,
    };
  }

  if (verdict.state !== 'ACTIVE') {
    return { decision: 'deny', reason: `state ${verdict.state}` };
  }

  return { decision: 'allow', reason: 'ACTIVE' };
}
