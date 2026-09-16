/**
 * The `fetch` tool as a function: sign a request with this agent's operational
 * key in the DNSid HTTP Message Signatures profile (RFC 9421), send it, return
 * the response. Whether the peer may be called is the verify hook's decision.
 */
import { z } from 'zod';
import type { HttpSignaturesProfile } from '@identity-digital/dnsid-http-signatures';

export const fetchInput = z.object({
  url: z
    .string()
    .refine((v) => URL.parse(v)?.protocol === 'https:', 'must be an absolute https URL')
    .describe('Absolute https URL of the peer endpoint.'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional().describe('Request body as text. Covered by the signature.'),
  tag: z
    .string()
    .optional()
    .describe(
      'RFC 9421 signature tag, if the peer requires one. DNSid A2A peers require `a2a-dnsid-http-sig-v1`.',
    ),
});

export type FetchInput = z.infer<typeof fetchInput>;

export const fetchToolDescription = [
  'Sends an HTTPS request signed with this agent’s DNSid identity ' +
    '(RFC 9421 HTTP Message Signatures). The receiving agent can verify who ' +
    'sent it. Use this instead of WebFetch when calling another agent.',
  'The request is only sent if the DNSid verify hook allows the peer; a ' +
    'denial arrives as a `DNSid:` message before this tool runs. Redirects ' +
    'are returned as-is, not followed.',
].join('\n\n');

const MAX_BODY_CHARS = 200_000;

export async function signedFetch(
  profile: HttpSignaturesProfile,
  input: FetchInput,
  fetchImpl: typeof fetch = fetch,
) {
  // A redirect is a new peer, and the verify hook must see it.
  const request = new Request(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    redirect: 'manual',
  });

  // Every caller header is covered, so a peer can require any of them.
  const signed = await profile.createSignedHttpRequest(request, {
    additionalComponents: Object.keys(input.headers).map((name) => name.toLowerCase()),
    tag: input.tag,
  });

  const response = await fetchImpl(signed);
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: text.slice(0, MAX_BODY_CHARS),
    truncated: text.length > MAX_BODY_CHARS,
  };
}
