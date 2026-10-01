import type { HookJSONOutput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { VerificationCode, type IdentityManager } from '@dnsid-ai/sdk';

import { readHookConfig } from './config.ts';
import { decide, type Decision } from './decide.ts';
import { extractHost } from './extract-host.ts';
import { verdictFor } from './peer.ts';
import type { VerifyAgentIdentityOutput } from './verdict.ts';

export interface VerifyHookRun {
  /** The hook input, as the harness wrote it to stdin. */
  stdin: string;
  env?: NodeJS.ProcessEnv;
  /** Tests inject a verifier over fixture transport. Production builds one from `env`. */
  idm?: IdentityManager;
  log?: (line: string) => void;
  /** How long verification may take. Tests shorten it. */
  deadlineMs?: number;
}

// The harness kills the hook at its timeout (30 s in hooks/hooks.json), and a
// killed hook lets the call through. Answer well before that.
const DEADLINE_MS = 20_000;

// Cannot verify in time: not a statement about the peer, so it goes to
// `onUnverifiable`, which is deny or ask, never allow. The code matches the
// one the SDK uses for its own expired deadline.
function within(
  ms: number,
  verdict: Promise<VerifyAgentIdentityOutput>,
): Promise<VerifyAgentIdentityOutput> {
  const timedOut = new Promise<VerifyAgentIdentityOutput>((resolve) => {
    setTimeout(
      () =>
        resolve({
          ok: false,
          code: VerificationCode.RecordInvalid,
          transient: true,
          agentState: null,
          errorCategory: null,
          cannotVerify: true,
          message: `verification did not finish in ${ms / 1000} s`,
        }),
      ms,
    ).unref();
  });
  return Promise.race([verdict, timedOut]);
}

/** The hook's answer. Allow is no answer at all: the user's own rules still run. */
function answer(
  host: string,
  { decision, reason }: Decision,
): HookJSONOutput | undefined {
  if (decision === 'allow') return;

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `DNSid: ${host}: ${reason}`,
    },
  };
}

export async function runVerifyHook({
  stdin,
  env = process.env,
  idm,
  log = (line) => console.error(line),
  deadlineMs = DEADLINE_MS,
}: VerifyHookRun): Promise<HookJSONOutput | undefined> {
  const input = JSON.parse(stdin) as PreToolUseHookInput;

  if (input.hook_event_name !== 'PreToolUse') return;

  const config = readHookConfig(env);
  const host = extractHost(input.tool_name, input.tool_input, config);
  if (!host) return;

  const verdict = await within(deadlineMs, verdictFor(host, config, env, idm));
  const decision = decide(verdict, config.onUnverifiable);

  if (config.mode === 'observe') {
    log(
      `DNSid (observe): ${input.tool_name} → ${host}: would ${decision.decision}: ${decision.reason}`,
    );
    return;
  }

  return answer(host, decision);
}
