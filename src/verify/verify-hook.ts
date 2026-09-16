import type { HookJSONOutput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import type { IdentityManager } from '@dnsid-ai/sdk';

import { readHookConfig } from './config.ts';
import { decide, type Decision } from './decide.ts';
import { extractHost } from './extract-host.ts';
import { verdictFor } from './peer.ts';

export interface VerifyHookRun {
  /** The hook input, as the harness wrote it to stdin. */
  stdin: string;
  env?: NodeJS.ProcessEnv;
  /** Tests inject a verifier over fixture transport. Production builds one from `env`. */
  idm?: IdentityManager;
  log?: (line: string) => void;
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
}: VerifyHookRun): Promise<HookJSONOutput | undefined> {
  const input = JSON.parse(stdin) as PreToolUseHookInput;

  if (input.hook_event_name !== 'PreToolUse') return;

  const config = readHookConfig(env);
  const host = extractHost(input.tool_name, input.tool_input, config);
  if (!host) return;

  const verdict = await verdictFor(host, config, env, idm);
  const decision = decide(verdict, config.onUnverifiable);

  if (config.mode === 'observe') {
    log(
      `DNSid (observe): ${input.tool_name} → ${host}: would ${decision.decision}: ${decision.reason}`,
    );
    return;
  }

  return answer(host, decision);
}
