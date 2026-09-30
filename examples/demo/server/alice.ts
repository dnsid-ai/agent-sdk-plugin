/**
 * Alice: a chat agent on the Agent SDK with the DNSid plugin loaded. The
 * plugin brings her DNSid identity online when the session starts, verifies
 * every peer before she calls it, and signs what she sends. All three come from
 * the `plugins` entry in the query options.
 *
 * POST /prompt streams the turn's Agent SDK messages back, one JSON object per
 * line, and the page draws the chat from them.
 *
 *   dnsid local run alice --port 3001 -- node server/alice.ts
 */
import { Resolver } from 'node:dns/promises';
import { createServer, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createNodeIdentityManagerFromEnvironment } from '@dnsid-ai/sdk/node';

const dnsid = fileURLToPath(
  new URL('.', import.meta.resolve('@dnsid-ai/agent-sdk-plugin/package.json')),
);

// One Claude session for the whole chat: each prompt resumes the last, so
// Alice remembers earlier turns.
let sessionId: string | undefined;

async function chat(prompt: string, res: ServerResponse) {
  const abortController = new AbortController();
  res.on('close', () => abortController.abort());
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });

  try {
    for await (const message of query({
      prompt,
      options: {
        plugins: [{ type: 'local', path: dnsid }],
        // Keep your Claude Code settings, memory, and claude.ai connectors out
        // of Alice's session. With no built-in tools, she acts only through the
        // plugin's two tools.
        settingSources: [],
        env: {
          ...process.env,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
        },
        tools: [],
        allowedTools: [
          'mcp__plugin_dnsid_dnsid__fetch',
          'mcp__plugin_dnsid_dnsid__verify',
        ],
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: [
            'You are Alice, an agent with a DNSid identity, talking to a person watching a demo.',
            'Bob is another agent at https://bob.dev.dnsid.test/ (POST JSON to /). Carol is at https://carol.dev.dnsid.test/.',
            'Use the dnsid verify tool to check who an agent is, and the dnsid fetch tool to call one.',
            'Answer in one or two plain sentences. Never mention files, permissions, or tools you lack.',
          ].join(' '),
        },
        maxTurns: 6,
        abortController,
        resume: sessionId,
      },
    })) {
      // The init message lists every tool and setting. The page needs none of it.
      if (message.type === 'system' && message.subtype === 'init') continue;
      res.write(JSON.stringify(message) + '\n');
      if (message.type === 'result') sessionId = message.session_id;
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      res.write(JSON.stringify({ type: 'error', error: String(error) }) + '\n');
    }
  }
  res.end();
}

// Alice's `_dnsid` record as a peer sees it, through DNSid Local's DNS server.
async function dnsidRecord(domain: string) {
  const resolver = new Resolver();
  if (process.env.DNSID_DNS_SERVER) resolver.setServers([process.env.DNSID_DNS_SERVER]);
  try {
    const [txt] = await resolver.resolveTxt(`_dnsid.${domain}`);
    return Object.fromEntries(
      txt
        .join('')
        .split(';')
        .filter(Boolean)
        .map((pair) => [
          pair.slice(0, pair.indexOf('=')),
          pair.slice(pair.indexOf('=') + 1),
        ]),
    );
  } catch {
    return null;
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// DNSid Local only: the registry expects its HTTPS name as the token audience,
// but `dnsid local run` sets DNSID_REGISTRY_URL to a local HTTP port.
const zone = process.env.DNSID_TESTNET_ZONE;
if (zone) process.env.DNSID_AGENT_AUTH_AUDIENCE ??= `https://registry.${zone}`;

const idm = await createNodeIdentityManagerFromEnvironment();
const domain = idm.config.identity!.domain;
const kid = (await idm.getKeyProvider().signingKey()).kid;

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/identity')
    return json(res, 200, { domain, kid, record: await dnsidRecord(domain) });
  if (path === '/prompt' && req.method === 'POST') {
    const { prompt } = JSON.parse(await text(req));
    return chat(prompt, res);
  }
  json(res, 404, { error: 'not found' });
}).listen(4001, () => console.log(`${domain}: alice api on 4001`));
