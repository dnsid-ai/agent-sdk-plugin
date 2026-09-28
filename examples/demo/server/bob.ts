/**
 * Bob: the peer Alice calls. The same HTTP server as examples/minimal/bob.ts,
 * plus a second port that streams what he sees: the request as it arrived,
 * and who he verified it came from.
 *
 *   dnsid local run bob --port 3002 -- node server/bob.ts
 */
import { createServer, type IncomingMessage } from 'node:http';
import { text } from 'node:stream/consumers';
import { VerificationError } from '@dnsid-ai/sdk';
import { createVerifier } from '@dnsid-ai/agent-sdk-plugin/verify';
import { HttpSignaturesProfile } from '@dnsid-ai/http-signatures';

import { Trace, dnsidRecord, json, testnetEnv } from './trace.ts';

const trace = new Trace('bob');

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

function handler(domain: string, bob: HttpSignaturesProfile) {
  return async (request: Request): Promise<Response> => {
    const body = request.method === 'GET' ? undefined : await request.clone().text();
    trace.emit('request', `${request.method} ${new URL(request.url).pathname} arrives`, {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body,
    });
    if (request.method === 'GET') {
      trace.emit('response', 'GET: Bob answers anyone and verifies nothing');
      return new Response(`hello from ${domain}\n`);
    }
    try {
      const sender = await bob.verifySignedHttpRequest(request.clone());
      trace.emit('verified', `Signature verified: sent by ${sender.domain}`, {
        sender: sender.domain,
      });
      return Response.json({ from: sender.domain, received: await request.text() });
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error;
      trace.emit('rejected', `Rejected: ${error.code}`, {
        code: error.code,
        message: error.message,
      });
      return new Response(`DNSid: ${error.code}: ${error.message}\n`, { status: 401 });
    }
  };
}

const domain = process.env.DNSID_DOMAIN;
if (!domain) throw new Error('DNSID_DOMAIN is not set');
testnetEnv();

const respond = handler(
  domain,
  new HttpSignaturesProfile({ domain, identityResolver: await createVerifier() }),
);
createServer(async (req, res) => {
  const response = await respond(await toRequest(req, domain));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}).listen(Number(process.env.PORT ?? 3002), () =>
  console.log(`${domain} listening on ${process.env.PORT ?? 3002}`),
);

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/events') return trace.subscribe(req, res);
  if (path === '/identity')
    return json(res, 200, { domain, record: await dnsidRecord(domain) });
  json(res, 404, { error: 'not found' });
}).listen(4002, () => console.log(`${domain}: bob api on 4002`));
