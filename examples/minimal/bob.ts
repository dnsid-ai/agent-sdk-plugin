/**
 * Bob: the peer Alice calls. A plain HTTP server behind DNSid Local's proxy.
 * GET answers anyone; POST must carry a DNSid HTTP message signature, and the
 * reply names who sent it.
 *
 *   dnsid testnet run bob --port 3002 -- node bob.ts
 */
import { createServer, type IncomingMessage } from 'node:http';
import { text } from 'node:stream/consumers';
import { VerificationError } from '@dnsid-ai/sdk';
import { HttpSignaturesProfile } from '@dnsid-ai/http-signatures';
import { createVerifier } from '@dnsid-ai/agent-sdk-plugin/verify';

export function handler(domain: string, bob: HttpSignaturesProfile) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'GET') return new Response(`hello from ${domain}\n`);
    try {
      const sender = await bob.verifySignedHttpRequest(request.clone());
      console.log(
        `verified signed ${request.method} ${new URL(request.url).pathname} from ${sender.domain}`,
      );
      return Response.json({ from: sender.domain, received: await request.text() });
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error;
      return new Response(`DNSid: ${error.code}: ${error.message}\n`, { status: 401 });
    }
  };
}

// The proxy terminates TLS, so the request arrives as http. The signature
// covers the URL Alice used, which is https at Bob's domain.
async function toRequest(req: IncomingMessage, domain: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await text(req);
  return new Request(`https://${domain}${req.url ?? '/'}`, { method, headers, body });
}

if (import.meta.main) {
  const domain = process.env.DNSID_DOMAIN;
  if (!domain) throw new Error('DNSID_DOMAIN is not set');

  // DNSid Local only: see alice.ts.
  const zone = process.env.DNSID_TESTNET_ZONE;
  if (zone) {
    process.env.DNSID_PRIVATE_HOSTS ??= `.${zone},dnsid.dnsid.test`;
  }

  const respond = handler(
    domain,
    new HttpSignaturesProfile({ domain, identityResolver: await createVerifier() }),
  );
  const port = Number(process.env.PORT ?? 3002);
  createServer(async (req, res) => {
    const response = await respond(await toRequest(req, domain));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  }).listen(port, () => console.log(`${domain} listening on ${port}`));
}
