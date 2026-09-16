/**
 * If the identity is VERIFIED but not yet in the transparency log, countersign
 * its ISSUANCE and submit it. The agent authenticates with its own key, so no
 * organization credential is needed at runtime. The registry publishes DNS and
 * moves to READY on its own; this does not wait for that.
 */
import { join } from 'node:path';
import type {
  HookJSONOutput,
  SessionStartHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import {
  issueManagedIdentity,
  type DnsIdJWK,
  type KeyProvider,
  type ManagedIssuanceCoordination,
  type ManagedIssuanceRegistry,
} from '@dnsid-ai/sdk';
import {
  DEFAULT_REGISTRY_URL,
  RegistryClient,
  type AgentRegistration,
} from '@dnsid-ai/registry';

import { agentAuthFetch, mintAgentJwt } from './agent-jwt.ts';
import { issuanceFile } from './issuance-file.ts';
import { agentIdentity, dnsidFetch } from '../shared/identity.ts';

export interface Identity {
  domain: string;
  governanceId: string;
  keyProvider: KeyProvider;
}

export interface Registry extends ManagedIssuanceRegistry {
  getRegistration(domain: string): Promise<AgentRegistration | undefined>;
}

export interface BringOnlineDeps {
  fetchEntityKey: (ekUrl: string) => Promise<DnsIdJWK>;
  coordination: ManagedIssuanceCoordination;
  issue?: typeof issueManagedIdentity;
}

export async function bringOnline(
  identity: Identity,
  registry: Registry,
  { fetchEntityKey, coordination, issue = issueManagedIdentity }: BringOnlineDeps,
): Promise<string> {
  const registration = await registry.getRegistration(identity.domain);

  if (!registration) {
    return `${identity.domain} is not registered. Register it with the dnsid CLI or console first.`;
  }

  const status = registration.registryStatus.toUpperCase();
  if (status === 'READY' && registration.dnsPublished) {
    return `${identity.domain} is online (READY).`;
  }

  if (status === 'READY') {
    return `${identity.domain} is issued; the registry is publishing its DNS record.`;
  }

  if (status !== 'VERIFIED') {
    return `${identity.domain} is ${status}, not VERIFIED. The accountable entity has to finish registration before the agent can bring itself online.`;
  }

  if (registration.publicationAuthority !== 'registry') {
    return `${identity.domain} is client-published; bring-online only handles registry-managed identities.`;
  }

  const ekUrl = registration.publicationConfig?.ekUrl;
  if (!ekUrl) {
    return `${identity.domain}: the registry did not name an accountable-entity key URL; cannot validate the ISSUANCE.`;
  }

  const result = await issue({
    domain: identity.domain,
    governanceId: identity.governanceId,
    entityKey: await fetchEntityKey(ekUrl),
    operationalKeyProvider: identity.keyProvider,
    registryClient: registry,
    idempotencyKey: `bring-online:${identity.domain}`,
    ...coordination,
  });
  if (result.submission?.state === 'accepted') {
    return `${identity.domain}: ISSUANCE accepted into the transparency log (${result.logReference}); the registry is publishing its DNS record.`;
  }
  return `${identity.domain}: ISSUANCE submitted, state ${result.submission?.state ?? 'unknown'}. It will be resumed at the next session start.`;
}

export async function singleKeyFromJwks(
  fetchImpl: typeof fetch,
  url: string,
): Promise<DnsIdJWK> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`entity key fetch failed: HTTP ${response.status} from ${url}`);
  }
  const { keys } = (await response.json()) as { keys?: DnsIdJWK[] };
  if (!Array.isArray(keys) || keys.length !== 1) {
    throw new Error(
      `entity JWKS at ${url} must hold exactly one key, got ${keys?.length ?? 0}`,
    );
  }
  return keys[0]!;
}

export interface BringOnlineHookRun {
  stdin: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

export async function runBringOnlineHook({
  stdin,
  env = process.env,
  log = (line) => console.error(line),
}: BringOnlineHookRun): Promise<HookJSONOutput | undefined> {
  const input = JSON.parse(stdin) as SessionStartHookInput;
  if (input.hook_event_name !== 'SessionStart') return;

  // The registry compares the JWT audience to one exact string. Unset, assume
  // it is the registry's own origin; a wrong guess fails with "audience mismatch".
  const audience =
    env.DNSID_AGENT_AUTH_AUDIENCE ?? env.DNSID_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;

  const { idm, keyProvider } = await agentIdentity(env);
  const identity: Identity = {
    domain: idm.config.identity!.domain,
    governanceId: idm.config.identity!.governanceId,
    keyProvider,
  };

  const transport = dnsidFetch(env);
  const registry = new RegistryClient({
    baseUrl: audience,
    fetch: agentAuthFetch(transport, () => mintAgentJwt({ ...identity, audience })),
  });

  const configDir = env.DNSID_CONFIG_DIR ?? join(env.HOME ?? '', '.dnsid');
  const line = await bringOnline(identity, registry, {
    fetchEntityKey: (url) => singleKeyFromJwks(transport, url),
    coordination: issuanceFile(join(configDir, 'issuance.json')),
  });

  log(`DNSid: ${line}`);
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `DNSid: this agent is ${identity.domain}. ${line}`,
    },
  };
}
