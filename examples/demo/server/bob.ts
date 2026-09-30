/**
 * Bob: the peer Alice calls. GET answers anyone. POST must carry a DNSid HTTP
 * message signature: Bob verifies it and replies with who sent it. The
 * Verified-Signature-Input header on his reply names the signature he checked,
 * so the chat can show what it covered.
 *
 *   dnsid local run bob --port 3002 -- node server/bob.ts
 */
import { createServer, type IncomingMessage } from 'node:http';
import { text } from 'node:stream/consumers';
import { VerificationError } from '@dnsid-ai/sdk';
import { HttpSignaturesProfile } from '@dnsid-ai/http-signatures';
import { createVerifier } from '@dnsid-ai/agent-sdk-plugin/verify';

function handler(domain: string, bob: HttpSignaturesProfile) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'GET') return new Response(`hello from ${domain}\n`);
    try {
      const sender = await bob.verifySignedHttpRequest(request.clone());
      return Response.json(
        { from: sender.domain, received: await request.text() },
        {
          headers: {
            'verified-signature-input': request.headers.get('signature-input')!,
          },
        },
      );
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

const domain = process.env.DNSID_DOMAIN;
if (!domain) throw new Error('DNSID_DOMAIN is not set');

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
