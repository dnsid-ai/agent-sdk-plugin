#!/usr/bin/env node
/**
 * The plugin's tools, served over MCP: `verify`, the verdict on a peer without
 * calling it, and `fetch`, a request signed as this agent. The hooks are the
 * slices' `hook.ts` files; this is their tool-side counterpart.
 * stdout is the MCP wire; diagnostics go to stderr.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { HttpSignaturesProfile } from '@identity-digital/dnsid-http-signatures';

import { agentIdentity, dnsidFetch } from './shared/identity.ts';
import { verifyInput, verifyToolDescription, verifyTool } from './verify/verify-tool.ts';
import { fetchInput, fetchToolDescription, signedFetch } from './sign/fetch-tool.ts';

// A missing or malformed identity fails here, before the server starts, so
// the model never sees a broken tool.
const { idm, keyProvider } = await agentIdentity();
const profile = new HttpSignaturesProfile({
  domain: idm.config.domain,
  keyProvider,
  identityResolver: idm,
});
const fetchImpl = dnsidFetch();

function createServer() {
  const server = new McpServer(
    { name: 'dnsid', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.registerTool(
    'fetch',
    {
      title: 'Signed fetch',
      description: fetchToolDescription,
      inputSchema: fetchInput,
      annotations: { openWorldHint: true },
    },
    async (input) => {
      const result = await signedFetch(profile, input, fetchImpl);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  server.registerTool(
    'verify',
    {
      title: 'Verify a peer',
      description: verifyToolDescription,
      inputSchema: verifyInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const verdict = await verifyTool(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(verdict) }],
        structuredContent: verdict,
      };
    },
  );
  return server;
}

serveStdio(createServer, { onerror: (error) => console.error('[dnsid]', error) });
