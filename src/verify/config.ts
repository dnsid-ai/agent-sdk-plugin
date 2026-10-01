/**
 * Everything the verify feature reads from the environment. A bad value
 * throws, and the hook wrapper turns that into a deny.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DNSSECMode } from '@dnsid-ai/sdk';

const hookEnv = z.object({
  /** `observe`: log the decision, never deny. */
  DNSID_MODE: z.enum(['enforce', 'observe']).default('enforce'),
  DNSID_ON_UNVERIFIABLE: z.enum(['deny', 'ask']).default('deny'),
  /** JSON: MCP server name → agent domain that server talks to. */
  DNSID_MCP_SERVER_DOMAINS: z
    .string()
    .default('{}')
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'DNSID_MCP_SERVER_DOMAINS must be a JSON object',
        });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string(), z.string())),
  DNSID_CACHE_FILE: z.string().min(1).default(join(tmpdir(), 'dnsid-verdicts.json')),
});

export interface HookConfig {
  mode: 'enforce' | 'observe';
  onUnverifiable: 'deny' | 'ask';
  serverDomains: Record<string, string>;
  cacheFile: string;
}

export function readHookConfig(env: NodeJS.ProcessEnv = process.env): HookConfig {
  const parsed = hookEnv.parse(env);
  return {
    mode: parsed.DNSID_MODE,
    onUnverifiable: parsed.DNSID_ON_UNVERIFIABLE,
    serverDomains: parsed.DNSID_MCP_SERVER_DOMAINS,
    cacheFile: parsed.DNSID_CACHE_FILE,
  };
}

/** All optional. With none set, the verifier trusts the SDK's managed log catalog. */
const verifierEnv = z
  .object({
    DNSID_DNS_SERVER: z.string().min(1).optional(),
    DNSID_CA_BUNDLE: z.string().min(1).optional(),
    // TODO: drop the refine once the SDK ships a DNSSEC-validating resolver.
    DNSID_DNSSEC_MODE: z
      .enum(DNSSECMode)
      .default(DNSSECMode.auto)
      .refine(
        (mode) => mode === DNSSECMode.auto,
        'only `auto` works: there is no DNSSEC-validating resolver, so `validated` and `required` would refuse every lookup',
      ),
    // An operator policy replaces the managed catalog. URL or file, not both.
    DNSID_LOG_POLICY_URL: z
      .string()
      .refine(
        (value) => URL.parse(value)?.protocol === 'https:',
        'must be an absolute https URL',
      )
      .optional(),
    DNSID_LOG_POLICY_FILE: z.string().min(1).optional(),
    DNSID_LOG_CHECKPOINT_MAX_AGE: z.coerce.number().int().positive().optional(),
    // Hosts, or `.suffix` entries, allowed to resolve to loopback or private
    // addresses. DNSid Local only. The same variable the SDK and the CLI read.
    DNSID_PRIVATE_HOSTS: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
      )
      .default([]),
  })
  .refine(
    (env) => !(env.DNSID_LOG_POLICY_URL && env.DNSID_LOG_POLICY_FILE),
    'set DNSID_LOG_POLICY_URL or DNSID_LOG_POLICY_FILE, not both',
  )
  .refine(
    (env) =>
      env.DNSID_LOG_CHECKPOINT_MAX_AGE === undefined ||
      env.DNSID_LOG_POLICY_URL !== undefined ||
      env.DNSID_LOG_POLICY_FILE !== undefined,
    'DNSID_LOG_CHECKPOINT_MAX_AGE needs an operator policy. The managed catalog sets its own value.',
  );

export interface VerifierConfig {
  dnssecMode: DNSSECMode;
  dnsServer: string | undefined;
  /** PEM bundle added to the system roots, for a private CA. */
  caBundlePath: string | undefined;
  logPolicy: { url: string } | { file: string } | undefined;
  checkpointMaxAge: number | undefined;
  privateAddressHosts: string[];
}

export function readVerifierConfig(env: NodeJS.ProcessEnv = process.env): VerifierConfig {
  const parsed = verifierEnv.parse(env);
  const { DNSID_LOG_POLICY_URL: url, DNSID_LOG_POLICY_FILE: file } = parsed;

  return {
    dnssecMode: parsed.DNSID_DNSSEC_MODE,
    dnsServer: parsed.DNSID_DNS_SERVER,
    caBundlePath: parsed.DNSID_CA_BUNDLE,
    logPolicy: url ? { url } : file ? { file } : undefined,
    checkpointMaxAge: parsed.DNSID_LOG_CHECKPOINT_MAX_AGE,
    privateAddressHosts: parsed.DNSID_PRIVATE_HOSTS,
  };
}
