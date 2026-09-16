import type { HookJSONOutput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import type { IdentityManager } from '@identity-digital/dnsid';

import { VerdictCache } from './cache.ts';
import { readHookConfig, readVerifierConfig, type HookConfig } from './config.ts';
import { decide, type Decision } from './decide.ts';
import { extractHost } from './extract-host.ts';
import { verifyAgentIdentity, type VerifyAgentIdentityOutput } from './verdict.ts';
import { createVerifier } from './verifier.ts';

export interface VerifyHookRun {
  /** The hook input, as the harness wrote it to stdin. */
  stdin: string;
  env?: NodeJS.ProcessEnv;
  /** Tests inject a verifier over fixture transport. Production builds one from `env`. */
  idm?: IdentityManager;
  log?: (line: string) => void;
}

async function cachedVerdict(
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

  const verdict = await cachedVerdict(host, config, env, idm);
  const decision = decide(verdict, config.onUnverifiable);

  if (config.mode === 'observe') {
    log(
      `DNSid (observe): ${input.tool_name} → ${host}: would ${decision.decision}: ${decision.reason}`,
    );
    return;
  }

  return answer(host, decision);
}
