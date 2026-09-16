import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeIdentityVerifier } from '@dnsid-ai/sdk/node';

import { verifyTool } from '../../src/verify/verify-tool.ts';
import { AGENT, identityFixture } from '../shared/fixtures/identity.ts';

describe('verify tool', () => {
  it('returns the verdict for a domain or a URL, and shares the hook cache', async () => {
    const fixture = await identityFixture(AGENT);
    const idm = await createNodeIdentityVerifier(
      {},
      {
        dnsResolver: fixture.dnsResolver,
        fetchJson: fixture.fetchJson,
        logRegistry: fixture.logRegistry,
      },
    );
    const env = {
      DNSID_CACHE_FILE: join(mkdtempSync(join(tmpdir(), 'dnsid-')), 'v.json'),
    };

    const verdict = await verifyTool({ domain: `https://${AGENT}/x` }, env, idm);
    expect(verdict.ok && verdict.state).toBe('ACTIVE');

    // Second call is served from the cache: no verifier needed.
    const again = await verifyTool({ domain: AGENT }, env, undefined);
    expect(again).toEqual(verdict);

    const missing = await verifyTool({ domain: 'nobody.example.com' }, env, idm);
    expect(missing.ok).toBe(false);
  });
});
