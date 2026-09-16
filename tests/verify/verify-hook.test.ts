/**
 * The hook as a function: build the harness's stdin by hand, assert on the
 * decision. The identity is tests/shared/fixtures/identity.ts, a real ES256-signed
 * record over fake DNS and HTTPS. No Claude session, no network.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DNSSECState, VerificationCode } from '@dnsid-ai/sdk';
import { createNodeIdentityVerifier } from '@dnsid-ai/sdk/node';

import { runVerifyHook } from '../../src/verify/verify-hook.ts';
import {
  AGENT,
  identityFixture,
  type IdentityFixture,
} from '../shared/fixtures/identity.ts';

async function setup(
  fixture: IdentityFixture,
  env: NodeJS.ProcessEnv = {},
  { withLog = true } = {},
) {
  const idm = await createNodeIdentityVerifier(
    {},
    {
      dnsResolver: fixture.dnsResolver,
      fetchJson: fixture.fetchJson,
      ...(withLog ? { logRegistry: fixture.logRegistry } : {}),
    },
  );
  const cacheFile = join(mkdtempSync(join(tmpdir(), 'dnsid-')), 'v.json');
  const log = vi.fn();
  const run = (input: Record<string, unknown> = {}) =>
    runVerifyHook({
      stdin: JSON.stringify(webFetch(input)),
      env: { DNSID_CACHE_FILE: cacheFile, ...env },
      idm,
      log,
    });
  return { idm, run, log };
}

const webFetch = (extra: Record<string, unknown> = {}) => ({
  hook_event_name: 'PreToolUse',
  session_id: 's',
  transcript_path: '/t',
  cwd: '/',
  tool_name: 'WebFetch',
  tool_input: { url: `https://${AGENT}/` },
  tool_use_id: 'tu1',
  ...extra,
});

const decisionOf = async (out: Awaited<ReturnType<typeof runVerifyHook>>) =>
  (out as { hookSpecificOutput?: Record<string, unknown> } | undefined)
    ?.hookSpecificOutput;

describe('verify hook', () => {
  it('says nothing for a tool that is not a peer call', async () => {
    const { run, idm } = await setup(await identityFixture());
    const spy = vi.spyOn(idm, 'verifyDomain');
    expect(
      await run({ tool_name: 'Bash', tool_input: { command: 'curl x' } }),
    ).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('says nothing for a verified ACTIVE peer', async () => {
    const { run } = await setup(await identityFixture());
    expect(await run()).toBeUndefined();
  });

  it('denies a peer whose status is REVOKED', async () => {
    const fixture = await identityFixture();
    fixture.status = {
      state: 'REVOKED',
      lastTransitionAt: new Date().toISOString(),
      revocationReason: 'keyCompromise',
    };
    const { run } = await setup(fixture);
    expect(await decisionOf(await run())).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringMatching(
        new RegExp(`^DNSid: ${AGENT}: ${VerificationCode.StatusNotActive}`),
      ),
    });
  });

  it('denies a peer with no _dnsid record', async () => {
    const fixture = await identityFixture();
    fixture.txt = async () => [[], DNSSECState.UNSIGNED];
    const { run } = await setup(fixture);
    expect(await decisionOf(await run())).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringMatching(/^DNSid: /),
    });
  });

  it('maps "cannot verify" to DNSID_ON_UNVERIFIABLE (deny by default, ask when set)', async () => {
    // No log reader at all: the verifier cannot check, and says so.
    const fixture = await identityFixture();
    const { run: deny } = await setup(fixture, {}, { withLog: false });
    expect(await decisionOf(await deny())).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringMatching(/LogError.*Cannot verify/),
    });
    const { run: ask } = await setup(
      fixture,
      { DNSID_ON_UNVERIFIABLE: 'ask' },
      { withLog: false },
    );
    expect(await decisionOf(await ask())).toMatchObject({ permissionDecision: 'ask' });
  });

  it('observe mode logs the would-be decision and never returns one', async () => {
    const fixture = await identityFixture();
    fixture.status = { state: 'RETIRED', lastTransitionAt: new Date().toISOString() };
    const { run, log } = await setup(fixture, { DNSID_MODE: 'observe' });
    expect(await run()).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/observe.*would deny.*RETIRED/),
    );
  });

  it('gates an MCP peer through DNSID_MCP_SERVER_DOMAINS', async () => {
    const fixture = await identityFixture();
    fixture.status = { state: 'RETIRED', lastTransitionAt: new Date().toISOString() };
    const { run } = await setup(fixture, {
      DNSID_MCP_SERVER_DOMAINS: JSON.stringify({ bob: AGENT }),
    });
    expect(
      await decisionOf(
        await run({ tool_name: 'mcp__bob__send', tool_input: { text: 'hi' } }),
      ),
    ).toMatchObject({ permissionDecision: 'deny' });
  });

  it('rejects malformed DNSID_MCP_SERVER_DOMAINS instead of silently gating nothing', async () => {
    const { run } = await setup(await identityFixture(), {
      DNSID_MCP_SERVER_DOMAINS: '{oops',
    });
    await expect(run()).rejects.toThrow(/DNSID_MCP_SERVER_DOMAINS/);
  });

  it('caches a verdict and does not re-verify inside the window', async () => {
    const { run, idm } = await setup(await identityFixture());
    const spy = vi.spyOn(idm, 'verifyDomain');
    await run();
    await run();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fires for subagents too (agent_id set on the input)', async () => {
    const fixture = await identityFixture();
    fixture.status = { state: 'RETIRED', lastTransitionAt: new Date().toISOString() };
    const { run } = await setup(fixture);
    expect(
      await decisionOf(await run({ agent_id: 'sub-1', agent_type: 'general-purpose' })),
    ).toMatchObject({ permissionDecision: 'deny' });
  });
});
