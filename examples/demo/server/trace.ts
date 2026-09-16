/**
 * What both servers send the browser: one event per thing that happened, over
 * server-sent events. The browser merges Alice's and Bob's streams by time.
 */
import { Resolver } from 'node:dns/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface TraceEvent {
  at: number;
  source: 'alice' | 'bob';
  kind: string;
  title: string;
  data?: unknown;
}

export class Trace {
  private clients = new Set<ServerResponse>();
  private history: TraceEvent[] = [];

  private source: TraceEvent['source'];

  constructor(source: TraceEvent['source']) {
    this.source = source;
  }

  emit(kind: string, title: string, data?: unknown) {
    const event: TraceEvent = { at: Date.now(), source: this.source, kind, title, data };
    this.history.push(event);
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) res.write(frame);
    console.log(`[${this.source}] ${kind}: ${title}`);
  }

  // Replays history so a page opened mid-run is complete.
  subscribe(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    for (const event of this.history) res.write(`data: ${JSON.stringify(event)}\n\n`);
    this.clients.add(res);
    // Lets the browser notice a dead connection behind the dev proxy.
    const heartbeat = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 10_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }
}

export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

// The `_dnsid` record as a peer sees it, through DNSid Local's DNS server.
export async function dnsidRecord(
  domain: string,
): Promise<Record<string, string> | null> {
  const resolver = new Resolver();
  const server = process.env.DNSID_DNS_SERVER;
  if (server) {
    const [host, port] = server.split(':');
    resolver.setServers([port ? `${host}:${port}` : host]);
  }
  try {
    const [txt] = await resolver.resolveTxt(`_dnsid.${domain}`);
    return Object.fromEntries(
      txt
        .join('')
        .split(';')
        .filter(Boolean)
        .map((kv) => {
          const i = kv.indexOf('=');
          return [kv.slice(0, i), kv.slice(i + 1)];
        }),
    );
  } catch {
    return null;
  }
}

// DNSid Local only: its registry has an HTTPS name only through the proxy,
// and every agent resolves to loopback, which the plugin refuses by default.
export function testnetEnv(peers: string[]) {
  const zone = process.env.DNSID_TESTNET_ZONE;
  if (!zone) return;
  process.env.DNSID_AGENT_AUTH_AUDIENCE ??= `https://registry.${zone}`;
  process.env.DNSID_ALLOW_PRIVATE_HOSTS ??= [
    ...peers.map((p) => `${p}.${zone}`),
    `registry.${zone}`,
    'dnsid.dnsid.test',
  ].join(',');
}
