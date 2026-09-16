/**
 * Decides whether a tool call is a peer call, and if so, to whom.
 * This table is the attack surface of the verify hook: a tool that reaches a
 * peer but is not listed here goes unverified.
 *
 * Order:
 *   1. WebFetch                     → hostname of tool_input.url
 *   2. our own fetch tool           → same
 *   3. mcp__<server>__*             → serverDomains[server], if present
 *   4. otherwise undefined          → not our business
 *
 * Deliberately NOT handled: Bash. Parsing shell for URLs is guesswork, and a
 * guess that misses is worse than a documented gap.
 *
 * hooks.json narrows the hook to `WebFetch|mcp__.*` so the harness does not
 * spawn a process for every Read and Edit. This table is the second line;
 * the matcher is the first. Keep them in agreement.
 */
export interface ExtractHostConfig {
  /** MCP server name → the peer domain that server represents. */
  serverDomains: Record<string, string>;
}

/**
 * Our signed fetch. The harness names a plugin's MCP tools
 * `mcp__plugin_<plugin>_<server>__<tool>`; the bare form is what a host gets
 * when it declares the same server itself. Both are ours.
 */
const OUR_FETCH = /^mcp__(plugin_dnsid_)?dnsid__fetch$/;

/** `mcp__<server>__<tool>` → `<server>`, or undefined for non-MCP tools. */
export function mcpServerName(toolName: string): string | undefined {
  const match = /^mcp__([^_](?:.*?))__/.exec(toolName);
  return match?.[1];
}

export function extractHost(
  toolName: string,
  toolInput: unknown,
  config: ExtractHostConfig,
): string | undefined {
  // Two ways a call names its peer: in the call itself, or in the config.
  if (toolName === 'WebFetch' || OUR_FETCH.test(toolName)) return hostnameOf(toolInput);
  const server = mcpServerName(toolName);
  return server ? config.serverDomains[server]?.toLowerCase() : undefined;
}

function hostnameOf(toolInput: unknown): string | undefined {
  const url = (toolInput as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return;
  return URL.parse(url)?.hostname.toLowerCase() || undefined;
}
