/**
 * Alice signs, Bob verifies. No HTTP server: the signed Request goes straight
 * to the verifier, which is what a server would do with it.
 */
import { describe, expect, it } from 'vitest';
import { VerificationError } from '@dnsid-ai/sdk';
import type { HttpSignaturesProfile } from '@dnsid-ai/http-signatures';

import { fetchInput, signedFetch } from '../../src/sign/fetch-tool.ts';
import { AGENT } from '../shared/fixtures/identity.ts';
import { aliceAndBob } from '../shared/fixtures/alice-and-bob.ts';

/** A fetch that hands the request to Bob and answers with his verdict. */
const bobEndpoint =
  (bob: HttpSignaturesProfile, tamper?: (req: Request) => Request) =>
  async (input: RequestInfo | URL) => {
    try {
      const verified = await bob.verifySignedHttpRequest(
        tamper?.(input as Request) ?? (input as Request),
      );
      return new Response(`verified ${verified.domain}`, { status: 200 });
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error;
      return new Response(error.message, { status: 401 });
    }
  };

describe('signed fetch', () => {
  it('signs a POST that the peer verifies back to this agent', async () => {
    const { alice, bob } = await aliceAndBob();
    const input = fetchInput.parse({
      url: 'https://bob.example.com/a2a',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
      body: '{"hello":"bob"}',
      tag: 'a2a-dnsid-http-sig-v1',
    });
    const result = await signedFetch(alice, input, bobEndpoint(bob));
    expect(result).toMatchObject({
      status: 200,
      body: `verified ${AGENT}`,
      truncated: false,
    });
  });

  it('a body changed in flight fails verification', async () => {
    const { alice, bob } = await aliceAndBob();
    const input = fetchInput.parse({
      url: 'https://bob.example.com/a2a',
      method: 'POST',
      body: 'x',
    });
    const tamper = (req: Request) => new Request(req, { body: 'y' });
    const result = await signedFetch(alice, input, bobEndpoint(bob, tamper));
    expect(result.status).toBe(401);
    expect(result.body).toMatch(/digest/i);
  });

  it('refuses a URL that is not https', () => {
    expect(fetchInput.safeParse({ url: 'http://bob.example.com/' }).success).toBe(false);
  });
});
