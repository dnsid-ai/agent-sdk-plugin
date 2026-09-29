/**
 * Alice: an Agent SDK program with the DNSid plugin loaded. The guide runs it
 * with a different prompt per section; the program never changes.
 *
 *   dnsid local run alice --port 3001 -- node alice.ts '<prompt>'
 */
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';

const prompt = process.argv[2] ?? 'Say hello and stop.';
const pluginRoot = fileURLToPath(
  new URL('.', import.meta.resolve('@dnsid-ai/agent-sdk-plugin/package.json')),
);

// DNSid Local only: the registry expects its HTTPS name as the token audience,
// but `dnsid local run` sets DNSID_REGISTRY_URL to a local HTTP port.
const zone = process.env.DNSID_TESTNET_ZONE;
if (zone) {
  process.env.DNSID_AGENT_AUTH_AUDIENCE ??= `https://registry.${zone}`;
}

for await (const message of query({
  prompt,
  options: {
    plugins: [{ type: 'local', path: pluginRoot }],
    allowedTools: ['mcp__plugin_dnsid_dnsid__fetch'],
    maxTurns: 6,
  },
})) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') console.log(block.text);
    }
  }
  if (message.type === 'result' && message.subtype !== 'success') {
    console.error('result:', message.subtype);
  }
}
